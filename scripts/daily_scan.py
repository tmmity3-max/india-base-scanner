"""Daily scan for the website.

Runs the scanner and writes static JSON that the website in ``web/`` reads:

    <out>/latest.json          screens, counts, settings, scan date
    <out>/charts/<SYMBOL>.json about 2 years of candles for every match

GitHub Actions runs this after market close and force-pushes <out> to the
``data`` branch (see .github/workflows/daily-scan.yml), so ``main`` never
fills up with daily data. The site loads it from raw.githubusercontent.com.

Run it yourself with:  python scripts/daily_scan.py --universe ALL_EQ
"""
from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import sys
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import india_base_scanner as ibs  # noqa: E402

IST = timezone(timedelta(hours=5, minutes=30))
CHART_BARS = 500


def _clean(v):
    """Make a value JSON-safe (NaN -> None, numpy -> python)."""
    if isinstance(v, (np.bool_, bool)):
        return bool(v)
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating, float)):
        return None if math.isnan(v) or math.isinf(v) else round(float(v), 2)
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return v


def _records(df: pd.DataFrame) -> list:
    return [{k: _clean(v) for k, v in row.items()} for row in df.to_dict("records")]


def _series(s: pd.Series) -> list:
    return [_clean(x) for x in s.to_numpy()]


def chart_payload(sym: str, df: pd.DataFrame, result: ibs.ScanResult, fund: dict = None) -> dict:
    full = df
    tail = full.tail(CHART_BARS)
    c = full["Close"]
    payload = {
        "symbol": sym,
        "d": [d.strftime("%Y-%m-%d") for d in tail.index],
        "o": _series(tail["Open"]), "h": _series(tail["High"]),
        "l": _series(tail["Low"]), "c": _series(tail["Close"]),
        "v": [int(x) for x in tail["Volume"].fillna(0)],
    }
    for k in (10, 50, 150, 200):
        payload[f"sma{k}"] = _series(c.rolling(k).mean().tail(CHART_BARS))
    rl = ibs.rs_line(c, result.benchmark)
    if rl is not None:
        # price / index is tiny (e.g. 0.015) - rebase to 100 at the start of the
        # window so two-decimal rounding keeps the line's detail
        r = rl.reindex(tail.index)
        base = r.dropna().iloc[0] if r.notna().any() else np.nan
        payload["rs"] = _series(r / base * 100) if base == base and base else None
    else:
        payload["rs"] = None

    row = result.metrics.loc[result.metrics["symbol"] == sym].iloc[0]
    levels = []
    for key, flag, label in (("vcp_pivot", "vcp", "VCP pivot"),
                             ("myb_pivot", "multiyear_base", "Multi-year high"),
                             ("ipo_high", "ipo_base", "IPO high"),
                             ("ath", "bluesky", "All-time high"),
                             ("murphy_entry", "murphy", "Murphy entry")):
        val = row.get(key)
        if bool(row.get(flag, False)) and val == val and val is not None:
            levels.append({"label": label, "price": _clean(val)})
    payload["levels"] = levels
    payload["screens"] = [n for n, t in result.screens.items()
                          if not t.empty and sym in set(t["symbol"])]
    hi52 = float(full["High"].tail(252).max()); lo52 = float(full["Low"].tail(252).min())
    payload["hi52"], payload["lo52"] = _clean(hi52), _clean(lo52)
    payload["fund"] = {k: _clean(v) for k, v in fund.get(sym, {}).items()} if fund else {}
    return payload


def write_site_data(result: ibs.ScanResult, data: dict, out_dir: str,
                    universe_name: str, benchmark_name: str, fund: dict = None) -> dict:
    fund = fund or {}
    # market cap on every row; fill a missing industry from Yahoo's
    for t in result.screens.values():
        if t.empty:
            continue
        t["market_cap_cr"] = t["symbol"].map(lambda s: fund.get(s, {}).get("market_cap_cr"))
        miss = t["industry"].fillna("") == ""
        t.loc[miss, "industry"] = t.loc[miss, "symbol"].map(lambda s: fund.get(s, {}).get("yf_industry", ""))
    charts_dir = os.path.join(out_dir, "charts")
    if os.path.isdir(charts_dir):
        shutil.rmtree(charts_dir)          # drop charts of stocks no longer listed
    os.makedirs(charts_dir, exist_ok=True)

    matched = sorted({s for t in result.screens.values() if not t.empty for s in t["symbol"]})
    for sym in matched:
        with open(os.path.join(charts_dir, f"{sym}.json"), "w") as f:
            json.dump(chart_payload(sym, data[sym], result, fund), f, separators=(",", ":"))

    data_date = max(df.index[-1] for df in data.values()).date().isoformat()
    latest = {
        "version": ibs.__version__,
        "generated_at": datetime.now(IST).isoformat(timespec="minutes"),
        "data_date": data_date,
        "universe": universe_name,
        "benchmark": benchmark_name,
        "stocks_scanned": int(len(result.metrics)),
        "stocks_liquid": int(result.metrics["liquid"].sum()) if "liquid" in result.metrics else None,
        "min_turnover_cr": result.config.min_turnover_cr,
        "min_price": result.config.min_price,
        "summary": _records(result.summary()),
        "screens": {name: _records(t) for name, t in result.screens.items()},
        "config": result.config.to_dict(),
    }
    with open(os.path.join(out_dir, "latest.json"), "w") as f:
        json.dump(latest, f, separators=(",", ":"))
    return latest


HEATMAP_INDICES = ("NIFTY50", "NIFTYNEXT50", "MIDCAP150", "SMALLCAP250")
# Yahoo Finance symbols for the index levels (tried in order)
INDEX_TICKERS = {
    "NIFTY50": ["^NSEI"],
    "NIFTYNEXT50": ["^NSMIDCP", "NIFTY_NEXT_50.NS"],
    "MIDCAP150": ["NIFTYMIDCAP150.NS", "NIFTY_MIDCAP_150.NS"],
    "SMALLCAP250": ["NIFTYSMLCAP250.NS", "NIFTY_SMLCAP_250.NS"],
}


def index_returns(members: dict, data: dict, fund: dict) -> dict:
    """1D/1W/1M/3M return per index: from the index itself on Yahoo, or, if that
    isn't available, estimated as the market-cap-weighted return of its members."""
    periods = {"d1": 1, "w1": 5, "m1": 21, "m3": 63}
    out = {}
    for idx in HEATMAP_INDICES:
        row = None
        for tk in INDEX_TICKERS.get(idx, []):
            try:
                s = ibs.download_benchmark(tk, period="1y")
            except Exception:
                s = None
            if s is not None and len(s) > 64:
                row = {"level": _clean(float(s.iloc[-1])), "source": "index",
                       **{k: _clean((s.iloc[-1] / s.iloc[-1 - n] - 1) * 100) for k, n in periods.items()}}
                break
        if row is None and idx in members:
            row = {"level": None, "source": "estimate"}
            for k, n in periods.items():
                num = den = 0.0
                for sym in members[idx]["symbol"]:
                    df, mc = data.get(sym), fund.get(sym, {}).get("market_cap_cr")
                    if df is None or not mc or len(df) <= n:
                        continue
                    c = df["Close"]
                    num += mc * (c.iloc[-1] / c.iloc[-1 - n] - 1)
                    den += mc
                row[k] = _clean(num / den * 100) if den else None
        if row:
            out[idx] = row
    return out


RS_BENCHMARKS = {"NIFTY50": ["^NSEI"], "NIFTY500": ["^CRSLDX"],
                 "MIDCAP150": INDEX_TICKERS["MIDCAP150"], "SMALLCAP250": INDEX_TICKERS["SMALLCAP250"]}


def write_benchmarks(out_dir: str, bars: int = 800) -> dict:
    """Daily closes of the indices the website can draw the RS line against."""
    out = {}
    for name, tickers in RS_BENCHMARKS.items():
        for tk in tickers:
            try:
                s = ibs.download_benchmark(tk, period="5y")
            except Exception:
                s = None
            if s is not None and len(s) > 260:
                s = s.tail(bars)
                out[name] = {"d": [d.strftime("%Y-%m-%d") for d in s.index], "c": _series(s)}
                break
        if name not in out:
            print("RS benchmark unavailable:", name)
    with open(os.path.join(out_dir, "benchmarks.json"), "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    return out


def write_heatmap(data: dict, fund: dict, out_dir: str, members: dict) -> dict:
    """Index heatmaps: % change over 1 day to 3 months, sized by market cap, plus index returns."""
    def chg(c, k):
        return _clean((c.iloc[-1] / c.iloc[-1 - k] - 1) * 100) if len(c) > k else None
    out = {"generated_at": datetime.now(IST).isoformat(timespec="minutes"), "indices": {}}
    dates = []
    for idx, uni in members.items():
        rows = []
        for sym, ind in zip(uni["symbol"], uni["industry"]):
            df = data.get(sym)
            if df is None or len(df) < 2:
                continue
            c = df["Close"]
            dates.append(df.index[-1])
            f = fund.get(sym, {})
            rows.append({"symbol": sym, "name": f.get("name", ""), "industry": ind or f.get("yf_industry", ""),
                         "close": _clean(float(c.iloc[-1])), "d1": chg(c, 1), "w1": chg(c, 5), "m1": chg(c, 21),
                         "m3": chg(c, 63), "mcap_cr": f.get("market_cap_cr"),
                         "turnover_cr": _clean(float((c * df["Volume"]).tail(20).mean()) / 1e7)})
        out["indices"][idx] = rows
    out["data_date"] = max(dates).date().isoformat() if dates else None
    out["index_returns"] = index_returns(members, data, fund)
    with open(os.path.join(out_dir, "heatmap.json"), "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    return out


def load_universe(name: str, cache_path: str) -> pd.DataFrame:
    """Download the symbol list; fall back to the last good copy if NSE blocks us."""
    with __import__("warnings").catch_warnings(record=True) as w:
        __import__("warnings").simplefilter("always")
        uni = ibs.get_universe(name)
        failed = any("fallback" in str(x.message) for x in w)
    if failed and os.path.exists(cache_path):
        print("NSE list unavailable - using cached universe", cache_path)
        return pd.read_csv(cache_path).fillna("")
    if not failed:
        os.makedirs(os.path.dirname(cache_path), exist_ok=True)
        uni.to_csv(cache_path, index=False)
    return uni


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--universe", default="ALL_EQ")
    ap.add_argument("--benchmark", default="NIFTY500")
    ap.add_argument("--period", default="max")
    ap.add_argument("--out", default=os.path.join(ROOT, "web", "data"))
    args = ap.parse_args()

    cache = os.path.join(args.out, f"universe_{args.universe.lower()}.csv")
    uni = load_universe(args.universe, cache)
    print(f"{len(uni)} symbols in {args.universe}")
    data = ibs.download_prices(uni["symbol"], period=args.period)
    if len(data) < 0.5 * len(uni):
        sys.exit(f"Only {len(data)}/{len(uni)} stocks downloaded - aborting so the site keeps yesterday's data.")
    bench = ibs.download_benchmark(args.benchmark, period=args.period)
    result = ibs.scan(data, ibs.ScanConfig(), uni, bench)

    # heatmap members (NIFTY 50, Next 50, Midcap 150, Smallcap 250); download any not already loaded
    members = {}
    import warnings
    for idx in HEATMAP_INDICES:
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            m = ibs.get_universe(idx)
        if any("fallback" in str(x.message) for x in w):
            print("heatmap list unavailable:", idx)   # don't show the wrong stocks
            continue
        members[idx] = m
    missing = sorted({s for m in members.values() for s in m["symbol"]} - set(data))
    if missing:
        data.update(ibs.download_prices(missing, period="1y", verbose=False))

    matched = sorted({s for t in result.screens.values() if not t.empty for s in t["symbol"]})
    heat_syms = sorted({s for m in members.values() for s in m["symbol"]})
    print(f"Fetching fundamentals for {len(set(matched) | set(heat_syms))} stocks...")
    fund = ibs.fetch_fundamentals(sorted(set(matched) | set(heat_syms)))
    print(f"  got data for {sum(1 for v in fund.values() if v)} stocks")

    latest = write_site_data(result, data, args.out, args.universe, args.benchmark, fund)
    write_heatmap(data, fund, args.out, members)
    write_benchmarks(args.out)
    print(f"Scan for {latest['data_date']}:")
    print(result.summary().to_string(index=False))


if __name__ == "__main__":
    main()
