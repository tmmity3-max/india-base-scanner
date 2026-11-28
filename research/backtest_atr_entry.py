"""Backtest of the ATR Entry signal (the green circle of the "RS Line + Buy
Signals" indicator, the website's ATR Entry screen) on Nifty Midcap 150 and
Smallcap 250 stocks, and of filters that might make it more reliable.

Run after research/download_data.py:
    python research/backtest_atr_entry.py

Signal (as india_base_scanner.find_atr_entry): first close of the zone
    close >= SMA70 + 2 x ATR14, +DI > -DI, RS line (vs Nifty 500) >= its 50-day SMA,
    and (close / SMA50 - 1) / (ATR / close) <= 7.

Trades: buy at the next day's open. Stop 2 x ATR below entry (filled at the
stop, or at the open if it gaps through). After that, exit at the close when
it closes below the 21-day EMA (from the 2nd day), or after 250 days. One
position per stock at a time. 0.3% round-trip cost. Also a plain 20-day hold
(no stop) to measure the signal alone.

Filters are picked on 2011-2019 (in-sample) and checked on 2020 onwards
(out-of-sample). The stock lists are today's index members, so results carry
survivorship bias; compare variants with each other and with the baseline.
"""
import json
import os
import pickle
import sys

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "research", "data", "prices.pkl")
OUT = os.path.join(ROOT, "research", "results")
START, SPLIT = pd.Timestamp("2011-01-01"), pd.Timestamp("2020-01-01")
COST = 0.003
MIN_TURNOVER_CR = 1.0      # 50-day average turnover, like the scanner's liquidity floor
MIN_PRICE = 50.0


def wilder(x, n):
    return x.ewm(alpha=1 / n, adjust=False).mean()


def prepare(df, bench, mkt):
    """Indicators, the signal, and the features used by the filters, for one stock."""
    df = df[["Open", "High", "Low", "Close", "Volume"]].dropna()
    df = df[(df["Close"] > 0) & (df["High"] >= df["Low"])]
    if len(df) < 300:
        return None
    o, h, l, c, v = (df[k] for k in ("Open", "High", "Low", "Close", "Volume"))
    idx = df.index
    tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    atr = wilder(tr, 14)
    up, dn = h.diff(), -l.diff()
    pdm = wilder(pd.Series(np.where((up > dn) & (up > 0), up, 0.0), index=idx), 14)
    mdm = wilder(pd.Series(np.where((dn > up) & (dn > 0), dn, 0.0), index=idx), 14)
    pdi, mdi = 100 * pdm / atr, 100 * mdm / atr
    adx = wilder(100 * (pdi - mdi).abs() / (pdi + mdi).replace(0, np.nan), 14)
    sma = {k: c.rolling(k).mean() for k in (20, 50, 70, 150, 200)}
    ema21 = c.ewm(span=21, adjust=False).mean()
    line = sma[70] + 2 * atr
    ext = (c / sma[50] - 1) / (atr / c)
    b = bench.reindex(idx).ffill()
    rs = c / b
    m = mkt.reindex(idx).ffill()
    zone = (c >= line) & (pdm > mdm) & (ext <= 7) & (rs >= rs.rolling(50).mean())
    zone = zone.fillna(False)
    sig = zone & ~zone.shift(1, fill_value=False)
    # features, all known at the signal day's close
    sig_pos = np.flatnonzero(sig.to_numpy())
    last_sig = pd.Series(np.nan, index=idx)
    last_sig.iloc[sig_pos] = sig_pos
    prev_sig_gap = pd.Series(np.arange(len(idx)), index=idx) - last_sig.shift(1).ffill()
    f = pd.DataFrame({
        "gap_prev_sig": prev_sig_gap,                                      # bars since the previous green dot
        "mkt_up": m > m.rolling(200).mean(),                                # Nifty 50 above its 200-day SMA
        "mkt_50_200": m.rolling(50).mean() > m.rolling(200).mean(),
        "hh20": c > h.shift(1).rolling(20).max(),                          # close above the last 20 days' high
        "hh50": c > h.shift(1).rolling(50).max(),
        "hh252": c > h.shift(1).rolling(252).max(),
        "vol_x": v / v.shift(1).rolling(50).mean(),                        # volume vs 50-day average
        "rs_hi50": rs >= rs.rolling(50).max(),
        "rs_hi250": rs >= rs.rolling(250).max(),
        "close_pos": ((c - l) / (h - l)).where(h > l, 0.5),                 # where it closed in the day's range
        "trend_tmpl": (c > sma[50]) & (sma[50] > sma[150]) & (sma[150] > sma[200]) & (sma[200] > sma[200].shift(20)),
        "ext": ext,
        "off_hi": c / h.rolling(252).max() - 1,
        "adx": adx,
        "base20": (h.shift(1).rolling(20).max() - l.shift(1).rolling(20).min()) / c,   # depth of the last 20 days
        "chg1": c / c.shift(1) - 1,
        "turnover": (c * v).rolling(50).mean() / 1e7,
    }, index=idx)
    return {"o": o.to_numpy(), "h": h.to_numpy(), "l": l.to_numpy(), "c": c.to_numpy(),
            "atr": atr.to_numpy(), "ema21": ema21.to_numpy(), "idx": idx, "sig": sig.to_numpy(), "f": f}


def simulate(p, sig_mask, mode):
    """Trades for one stock from the signals in sig_mask. mode: 'trend' or 'hold20'."""
    o, h, l, c, atr, ema = p["o"], p["h"], p["l"], p["c"], p["atr"], p["ema21"]
    n, trades, free_from = len(c), [], 0
    for i in np.flatnonzero(sig_mask):
        if i < free_from or i + 1 >= n:
            continue
        e = i + 1
        entry = o[e]
        if not entry > 0:
            continue
        risk = 2 * atr[i]
        stop = entry - risk
        exit_px, j, why = None, None, ""
        last = min(n - 1, e + (20 if mode == "hold20" else 250))
        mfe = mae = 0.0
        for k in range(e, last + 1):
            mfe = max(mfe, h[k] / entry - 1)
            mae = min(mae, l[k] / entry - 1)
            if mode == "trend":
                if l[k] <= stop:                                     # stopped out
                    exit_px, j, why = (min(o[k], stop) if k > e else stop), k, "stop"
                    break
                if k > e and c[k] < ema[k]:                          # close below the 21 EMA
                    exit_px, j, why = c[k], k, "ema21"
                    break
        if exit_px is None:
            if last < e + (20 if mode == "hold20" else 250) and last == n - 1 and mode == "trend":
                continue                                              # still open at the end of the data: leave out
            exit_px, j, why = c[last], last, "time"
        ret = exit_px / entry - 1 - COST
        trades.append({"i": i, "date": p["idx"][i], "ret": ret, "r": (exit_px - entry) / risk - COST * entry / risk,
                       "days": j - e + 1, "why": why, "mfe": mfe, "mae": mae})
        free_from = j + 1
    return trades


def stats(t):
    if len(t) == 0:
        return {"trades": 0}
    r, R = t["ret"], t["r"]
    wins, losses = r[r > 0], r[r <= 0]
    pf = wins.sum() / -losses.sum() if losses.sum() < 0 else np.inf
    return {"trades": int(len(t)), "win_pct": round(100 * (r > 0).mean(), 1), "avg_ret_pct": round(100 * r.mean(), 2),
            "median_ret_pct": round(100 * r.median(), 2), "avg_win_pct": round(100 * wins.mean(), 2) if len(wins) else 0,
            "avg_loss_pct": round(100 * losses.mean(), 2) if len(losses) else 0, "profit_factor": round(pf, 2),
            "expectancy_R": round(R.mean(), 3), "avg_days": round(t["days"].mean(), 1)}


def main():
    with open(DATA, "rb") as fh:
        D = pickle.load(fh)
    bench = D["bench"].get("NIFTY500")
    mkt = D["bench"].get("NIFTY50", bench)
    if bench is None or bench.index[0] > pd.Timestamp("2010-06-01"):
        bench = mkt                                   # Nifty 500 history too short on Yahoo: use Nifty 50 for RS
    os.makedirs(OUT, exist_ok=True)
    preps, rows = {}, []
    for sym, df in D["stocks"].items():
        p = prepare(df, bench, mkt)
        if p is None:
            continue
        preps[sym] = p
        f = p["f"]
        ok = p["sig"] & (f.index >= START) & (f["turnover"] >= MIN_TURNOVER_CR).to_numpy() & (p["c"] >= MIN_PRICE)
        for i in np.flatnonzero(ok):
            rows.append({"sym": sym, "i": i, "date": f.index[i], **f.iloc[i].to_dict()})
    sigs = pd.DataFrame(rows)
    print(f"{len(preps)} stocks, {len(sigs)} green-dot signals since {START.date()}")

    def run(mask_fn, mode="trend"):
        out = []
        for sym, p in preps.items():
            s = sigs[sigs.sym == sym] if "_by" not in run.__dict__ else run._by.get(sym)
            if s is None or s.empty:
                continue
            keep = s[mask_fn(s)]
            m = np.zeros(len(p["c"]), bool)
            m[keep["i"].to_numpy(int)] = True
            for t in simulate(p, m, mode):
                t["sym"] = sym
                out.append(t)
        return pd.DataFrame(out)
    run._by = {k: g for k, g in sigs.groupby("sym")}

    def split(t):
        return {"all": stats(t), "in_sample_2011_19": stats(t[t.date < SPLIT]), "out_of_sample_2020_on": stats(t[t.date >= SPLIT])}

    report = {"universe": {k: len(v) for k, v in D["members"].items()}, "stocks_tested": len(preps), "signals": int(len(sigs)),
              "period": f"{START.date()} to {max(p['idx'][-1] for p in preps.values()).date()}"}
    ALL = lambda s: np.ones(len(s), bool)  # noqa: E731
    base_trend, base_20 = run(ALL, "trend"), run(ALL, "hold20")
    report["baseline_trend"] = split(base_trend)
    report["baseline_hold20"] = split(base_20)
    # drift baseline: 20-day return from every liquid day (what "just buying" these stocks gave)
    drift = []
    for p in preps.values():
        c, f = p["c"], p["f"]
        okd = ((f.index >= START) & (f["turnover"] >= MIN_TURNOVER_CR).to_numpy() & (c >= MIN_PRICE))[:-21]
        r = (c[21:] / p["o"][1:-20] - 1 - COST)[okd]
        drift.append(r[::5])
    drift = np.concatenate(drift)
    report["any_day_hold20_avg_ret_pct"] = round(100 * float(np.nanmean(drift)), 2)
    report["any_day_hold20_win_pct"] = round(100 * float(np.nanmean(drift > 0)), 1)
    base_trend.to_csv(os.path.join(OUT, "trades_baseline.csv"), index=False)

    FILTERS = {
        "first dot in 20 bars": lambda s: ~(s.gap_prev_sig <= 20),
        "first dot in 60 bars": lambda s: ~(s.gap_prev_sig <= 60),
        "Nifty above 200 SMA": lambda s: s.mkt_up.astype(bool),
        "Nifty 50 SMA > 200 SMA": lambda s: s.mkt_50_200.astype(bool),
        "close > 20-day high": lambda s: s.hh20.astype(bool),
        "close > 50-day high": lambda s: s.hh50.astype(bool),
        "close > 52-week high": lambda s: s.hh252.astype(bool),
        "volume >= 1.5x avg": lambda s: s.vol_x >= 1.5,
        "volume >= 2x avg": lambda s: s.vol_x >= 2.0,
        "RS line at 50-day high": lambda s: s.rs_hi50.astype(bool),
        "RS line at 52-week high": lambda s: s.rs_hi250.astype(bool),
        "close in top 30% of day": lambda s: s.close_pos >= 0.7,
        "trend template": lambda s: s.trend_tmpl.astype(bool),
        "ext <= 4 ATR": lambda s: s.ext <= 4,
        "within 15% of 52w high": lambda s: s.off_hi >= -0.15,
        "ADX >= 20": lambda s: s.adx >= 20,
        "tight base (20d range <= 15%)": lambda s: s.base20 <= 0.15,
        "day gain <= 5%": lambda s: s.chg1 <= 0.05,
    }
    single = {}
    for name, fn in FILTERS.items():
        single[name] = split(run(fn))
        print(f"  {name:32s} IS {single[name]['in_sample_2011_19']}  OOS {single[name]['out_of_sample_2020_on']}")
    report["single_filters"] = single

    # greedy combination, chosen on in-sample expectancy (R), at least 400 in-sample trades
    chosen, best = [], report["baseline_trend"]["in_sample_2011_19"]["expectancy_R"]
    while True:
        cand = None
        for name, fn in FILTERS.items():
            if name in chosen:
                continue
            fns = [FILTERS[c] for c in chosen] + [fn]
            mask = lambda s, fns=fns: np.logical_and.reduce([np.asarray(g(s), bool) for g in fns])  # noqa: E731
            t = run(mask)
            st = stats(t[t.date < SPLIT])
            if st.get("trades", 0) >= 400 and st["expectancy_R"] > best + 0.02 and (cand is None or st["expectancy_R"] > cand[1]):
                cand = (name, st["expectancy_R"], t)
        if cand is None or len(chosen) >= 4:
            break
        chosen.append(cand[0])
        best = cand[1]
        print(f"  + {cand[0]} -> in-sample expectancy {best}R")
    if chosen:
        fns = [FILTERS[c] for c in chosen]
        mask = lambda s: np.logical_and.reduce([np.asarray(g(s), bool) for g in fns])  # noqa: E731
        combo = run(mask)
        combo.to_csv(os.path.join(OUT, "trades_improved.csv"), index=False)
        report["improved"] = {"filters": chosen, **split(combo), "hold20": split(run(mask, "hold20"))}
        yr = combo.groupby(combo.date.dt.year).apply(lambda g: pd.Series(stats(g))).reset_index()
        report["improved_by_year"] = yr.to_dict("records")
    yb = base_trend.groupby(base_trend.date.dt.year).apply(lambda g: pd.Series(stats(g))).reset_index()
    report["baseline_by_year"] = yb.to_dict("records")
    with open(os.path.join(OUT, "atr_entry_backtest.json"), "w") as fh:
        json.dump(report, fh, indent=1, default=str)
    print(json.dumps({k: report[k] for k in ("universe", "stocks_tested", "signals", "period", "baseline_trend", "baseline_hold20",
                                             "any_day_hold20_avg_ret_pct", "any_day_hold20_win_pct")}, indent=1, default=str))
    if "improved" in report:
        print(json.dumps(report["improved"], indent=1, default=str))


if __name__ == "__main__":
    main()
