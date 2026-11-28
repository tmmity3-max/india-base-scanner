"""Portfolio test of the final rule (research/results/final_trades.csv from
refine_strategy.py), valued at every day's close, without borrowing.

Sizing: risk RISK_PER_TRADE of current equity between entry and the initial
stop, capped at MAX_ALLOC of equity per stock and at the cash available.
Same-day signals are taken strongest 3-month RS first while a slot is free.

    python research/portfolio_sim.py
"""
import json
import os
import pickle
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import search_strategies as S  # noqa: E402

RISK_PER_TRADE = 0.01
MAX_ALLOC = 0.20


def simulate(trades, closes, days, max_pos):
    by_entry = {d: g.sort_values("rs", ascending=False) for d, g in trades.groupby("entry_date")}
    cash, pos, curve, taken = 1.0, [], [], 0
    for d in days:
        # exits at today's close (the trade's exit price is already in ret)
        keep = []
        for p in pos:
            if p["exit_date"] <= d:
                cash += p["alloc"] * (1 + p["ret"])
            else:
                keep.append(p)
        pos = keep
        # entries at today's open: equity valued at yesterday's closes
        eq_prev = cash + sum(p["alloc"] * p["last"] / p["entry_close0"] for p in pos)
        for _, r in by_entry.get(d, pd.DataFrame()).iterrows():
            if len(pos) >= max_pos or cash <= 0:
                break
            alloc = min(MAX_ALLOC, RISK_PER_TRADE / max(r.risk_pct, 1e-6)) * eq_prev
            alloc = min(alloc, cash)
            if alloc <= 0:
                break
            cash -= alloc
            cser = closes[int(r.stock)]
            ep = r.entry_px if "entry_px" in r else None
            pos.append({"exit_date": r.exit_date, "alloc": alloc, "ret": r.ret, "stock": int(r.stock),
                        "entry_close0": r.entry_px, "last": r.entry_px})
            taken += 1
        # mark to market at today's close
        for p in pos:
            px = closes[p["stock"]].get(d)
            if px is not None and np.isfinite(px):
                p["last"] = px
        curve.append((d, cash + sum(p["alloc"] * p["last"] / p["entry_close0"] for p in pos)))
    c = pd.Series(dict(curve))
    yrs = (c.index[-1] - c.index[0]).days / 365.25
    yearly = c.groupby(c.index.year).last()
    yr_ret = yearly.pct_change()
    yr_ret.iloc[0] = yearly.iloc[0] / c.iloc[0] - 1
    invested = 1 - pd.Series([0])  # placeholder for symmetry
    return {"cagr_pct": round(100 * ((c.iloc[-1] / c.iloc[0]) ** (1 / yrs) - 1), 1),
            "max_dd_pct": round(100 * (c / c.cummax() - 1).min(), 1), "final_x": round(float(c.iloc[-1] / c.iloc[0]), 2),
            "trades_taken": taken, "yearly_pct": {int(y): round(100 * v, 1) for y, v in yr_ret.items()}}, c


def main():
    with open(S.DATA, "rb") as fh:
        D = pickle.load(fh)
    bench = D["bench"]["NIFTY500"]
    t = pd.read_csv(os.path.join(S.OUT, "final_trades.csv"), parse_dates=["sig", "entry_date", "exit_date"])
    # entry prices: the next open after the signal, recovered from the stock's data
    preps = [p for p in (S.prepare(df, bench, bench) for df in D["stocks"].values()) if p is not None]
    closes, opens = {}, {}
    for si, p in enumerate(preps):
        idx = pd.to_datetime(p["dates"])
        closes[si] = dict(zip(idx, p["c"]))
        opens[si] = dict(zip(idx, p["o"]))
    t["entry_px"] = [opens[int(s)].get(d, np.nan) for s, d in zip(t.stock, t.entry_date)]
    t = t.dropna(subset=["entry_px"])
    days = bench[bench.index >= "2011-01-01"].index
    out = {}
    for mp in (5, 10, 15, 20):
        res, curve = simulate(t, closes, days, mp)
        out[f"max_{mp}_positions"] = res
        curve.to_csv(os.path.join(S.OUT, f"equity_max{mp}.csv"), header=["equity"])
        print(mp, {k: v for k, v in res.items() if k != "yearly_pct"})
    b = bench[bench.index >= "2011-01-01"]
    yrs = (b.index[-1] - b.index[0]).days / 365.25
    by = b.groupby(b.index.year).last()
    byr = by.pct_change()
    byr.iloc[0] = by.iloc[0] / b.iloc[0] - 1
    out["nifty500"] = {"cagr_pct": round(100 * ((b.iloc[-1] / b.iloc[0]) ** (1 / yrs) - 1), 1),
                       "max_dd_pct": round(100 * (b / b.cummax() - 1).min(), 1),
                       "yearly_pct": {int(y): round(100 * v, 1) for y, v in byr.items()}}
    with open(os.path.join(S.OUT, "portfolio.json"), "w") as fh:
        json.dump(out, fh, indent=1)
    yrs_all = sorted(out["nifty500"]["yearly_pct"])
    print("year  " + "  ".join(f"max{mp:>3}" for mp in (5, 10, 15, 20)) + "  nifty500")
    for y in yrs_all:
        print(y, "  ".join(f"{out[f'max_{mp}_positions']['yearly_pct'].get(y, float('nan')):6.1f}" for mp in (5, 10, 15, 20)),
              f"{out['nifty500']['yearly_pct'][y]:8.1f}")
    print("nifty500", out["nifty500"]["cagr_pct"], out["nifty500"]["max_dd_pct"])


if __name__ == "__main__":
    main()
