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


def chart_payload(sym: str, df: pd.DataFrame, result: ibs.ScanResult) -> dict:
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
    payload["rs"] = _series(rl.reindex(tail.index)) if rl is not None else None

    row = result.metrics.loc[result.metrics["symbol"] == sym].iloc[0]
    levels = []
    for key, flag, label in (("vcp_pivot", "vcp", "VCP pivot"),
                             ("myb_pivot", "multiyear_base", "Multi-year high"),
                             ("ipo_high", "ipo_base", "IPO high"),
                             ("ath", "bluesky", "All-time high"),
                             ("murphy_entry", "murphy", "Murphy entry"),
                             ("murphy_stop", "murphy", "Stop (2-week low)")):
        val = row.get(key)
        if bool(row.get(flag, False)) and val == val and val is not None:
            levels.append({"label": label, "price": _clean(val)})
    payload["levels"] = levels
    payload["screens"] = [n for n, t in result.screens.items()
                          if not t.empty and sym in set(t["symbol"])]
    return payload


def write_site_data(result: ibs.ScanResult, data: dict, out_dir: str,
                    universe_name: str, benchmark_name: str) -> dict:
    charts_dir = os.path.join(out_dir, "charts")
    if os.path.isdir(charts_dir):
        shutil.rmtree(charts_dir)          # drop charts of stocks no longer listed
    os.makedirs(charts_dir, exist_ok=True)

    matched = sorted({s for t in result.screens.values() if not t.empty for s in t["symbol"]})
    for sym in matched:
        with open(os.path.join(charts_dir, f"{sym}.json"), "w") as f:
            json.dump(chart_payload(sym, data[sym], result), f, separators=(",", ":"))

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
    latest = write_site_data(result, data, args.out, args.universe, args.benchmark)
    print(f"Scan for {latest['data_date']}:")
    print(result.summary().to_string(index=False))


if __name__ == "__main__":
    main()
