"""Second stage of the search: stops and exits around the best setups from
search_strategies.py, chosen on 2011-2019 again, then a portfolio simulation
(limited positions, equal-risk sizing) for the final rule, 2011 to today.

    python research/refine_strategy.py
"""
import json
import os
import pickle
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import search_strategies as S  # noqa: E402

OUT = S.OUT


def trade2(p, i, stop_atr, exit_rule):
    """Like search_strategies.trade with a choice of initial stop and more exits."""
    o, h, l, c, atr = p["o"], p["h"], p["l"], p["c"], p["atr"]
    n = len(c)
    e = i + 1
    if e >= n:
        return None
    entry = o[e]
    risk = stop_atr * atr[i] if stop_atr else entry - l[i]          # 0 = below the signal day's low
    if not (entry > 0 and risk > 0):
        return None
    stop = entry - risk
    end = min(n, e + S.MAX_HOLD + 1)
    L, C = l[e:end], c[e:end]
    if exit_rule == "50 SMA close":
        ref = p["sma50"][e:end]
    elif exit_rule == "50 EMA close":
        ref = p["ema50"][e:end]
    elif exit_rule == "30 SMA close":
        ref = p["sma30"][e:end]
    elif exit_rule.startswith("trail"):
        k = float(exit_rule.split()[1])
        ref = np.maximum.accumulate(h[e:end]) - k * atr[e:end]
    elif exit_rule == "50 SMA close, 2 closes":
        below2 = (C < p["sma50"][e:end])
        ref = None
    if exit_rule == "50 SMA close, 2 closes":
        b = below2 & np.r_[False, below2[:-1]]
        below = np.flatnonzero(b)
    else:
        below = np.flatnonzero(C < np.maximum(ref, stop) if exit_rule.startswith("trail") else C < ref)
    below = below[below >= 1]
    hit = np.flatnonzero(L <= stop)
    ks = hit[0] if len(hit) else 10 ** 9
    kc = below[0] if len(below) else 10 ** 9
    if ks == 10 ** 9 and kc == 10 ** 9:
        if end == n:
            return None
        j, px = end - 1, c[end - 1]
    elif ks <= kc:
        j = e + ks
        px = min(o[j], stop) if ks > 0 else stop
    else:
        j, px = e + kc, C[kc]
    return e, j, entry, px, risk


def collect(preps, entry, filt, stop_atr, exit_rule):
    rows = []
    for si, p in enumerate(preps):
        mask = p["E"][entry] & p["liquid"]
        for f in filt:
            mask = mask & p["F"][f]
        free = 0
        for i in np.flatnonzero(mask):
            if i < free:
                continue
            t = trade2(p, i, stop_atr, exit_rule)
            if t is None:
                continue
            e, j, entry_px, px, risk = t
            ret = px / entry_px - 1 - S.COST
            rows.append({"stock": si, "sig": p["dates"][i], "entry_date": p["dates"][e], "exit_date": p["dates"][j],
                         "ret": ret, "R": (px - entry_px) / risk - S.COST * entry_px / risk, "risk_pct": risk / entry_px,
                         "days": j - e + 1, "vol_x": p["volx"][i], "rs": p["rs_rank_raw"][i]})
            free = j + 1
    return pd.DataFrame(rows)


def portfolio(trades, start, end, max_pos=10, risk_per_trade=0.01, max_alloc=0.2):
    """Daily equity of a portfolio taking signals in date order (strongest RS first on the same day)
    while fewer than max_pos positions are open. Size: risk_per_trade of equity at the stop,
    capped at max_alloc of equity per position. Returns are compounded at exit."""
    t = trades[(trades.entry_date >= start) & (trades.entry_date < end)].sort_values(["entry_date", "rs"], ascending=[True, False])
    equity, open_pos, curve, taken = 1.0, [], [], 0
    events = sorted(set(t.entry_date) | set(t.exit_date))
    by_entry = {d: g for d, g in t.groupby("entry_date")}
    for d in events:
        # close positions exiting today
        still = []
        for pos in open_pos:
            if pos["exit_date"] <= d:
                equity += pos["alloc"] * pos["ret"]
            else:
                still.append(pos)
        open_pos = still
        for _, r in by_entry.get(d, pd.DataFrame()).iterrows():
            if len(open_pos) >= max_pos:
                break
            alloc = min(max_alloc, risk_per_trade / max(r.risk_pct, 1e-6)) * equity
            open_pos.append({"exit_date": r.exit_date, "alloc": alloc, "ret": r.ret})
            taken += 1
        curve.append((d, equity))
    for pos in open_pos:
        equity += pos["alloc"] * pos["ret"]
    c = pd.Series(dict(curve)).sort_index()
    yrs = max((c.index[-1] - c.index[0]).days / 365.25, 0.1)
    dd = (c / c.cummax() - 1).min()
    yearly = c.groupby(c.index.year).last().pct_change()
    yearly.iloc[0] = c.groupby(c.index.year).last().iloc[0] - 1
    return {"cagr_pct": round(100 * (equity ** (1 / yrs) - 1), 1), "max_dd_pct": round(100 * dd, 1),
            "trades_taken": taken, "final_x": round(equity, 2), "yearly_pct": {int(y): round(100 * v, 1) for y, v in yearly.items()}}


def main():
    with open(S.DATA, "rb") as fh:
        D = pickle.load(fh)
    bench = D["bench"]["NIFTY500"]
    preps = []
    for df in D["stocks"].values():
        p = S.prepare(df, bench, bench)
        if p is None:
            continue
        c = pd.Series(p["c"])
        v = pd.Series(df.loc[pd.to_datetime(p["dates"]), "Volume"].to_numpy())
        p["ema50"] = c.ewm(span=50, adjust=False).mean().to_numpy()
        p["sma30"] = c.rolling(30).mean().to_numpy()
        p["volx"] = (v / v.shift(1).rolling(50).mean()).to_numpy()
        b = bench.reindex(pd.to_datetime(p["dates"])).ffill().to_numpy()
        rs = c.to_numpy() / b
        p["rs_rank_raw"] = (pd.Series(rs) / pd.Series(rs).shift(63) - 1).to_numpy()   # 3-month RS change, to rank same-day signals
        preps.append(p)
    setups = [("52w high breakout", ("trend template", "Nifty500 > 200 SMA")),
              ("50d high breakout", ("trend template", "Nifty500 > 200 SMA")),
              ("ATR entry (green dot)", ("trend template", "within 15% of 52w high"))]
    stops = [1.5, 2.0, 3.0, 0]
    exits = ["50 SMA close", "50 EMA close", "30 SMA close", "50 SMA close, 2 closes", "trail 4", "trail 5"]
    rows = []
    for en, flt in setups:
        for st in stops:
            for ex in exits:
                t = collect(preps, en, flt, st, ex)
                d = pd.to_datetime(t.sig)
                si, so = S.stats(t[d < S.SPLIT].rename(columns={"sig": "date"})), S.stats(t[d >= S.SPLIT].rename(columns={"sig": "date"}))
                rows.append({"entry": en, "filters": " + ".join(flt), "stop_atr": st or "signal low", "exit": ex,
                             **{f"is_{k}": v for k, v in si.items()}, **{f"oos_{k}": v for k, v in so.items()}})
                print(f"{en[:22]:22s} stop {str(st):4s} {ex:24s} IS {si}  OOS {so}")
    res = pd.DataFrame(rows)
    res.to_csv(os.path.join(OUT, "refine_search.csv"), index=False)
    # pick on in-sample: expectancy x profit factor, enough trades
    ok = res[res.is_n >= 600].copy()
    ok["score"] = ok.is_eR * ok.is_pf
    best = ok.sort_values("score", ascending=False).iloc[0]
    print("\nBEST (chosen on 2011-2019):", best.to_dict())
    flt = tuple(best.filters.split(" + "))
    st = 0 if best.stop_atr == "signal low" else float(best.stop_atr)
    t = collect(preps, best.entry, flt, st, best.exit)
    t.to_csv(os.path.join(OUT, "final_trades.csv"), index=False)
    by_year = t.groupby(pd.to_datetime(t.sig).dt.year).apply(lambda g: pd.Series(S.stats(g.rename(columns={"sig": "date"})))).reset_index()
    port = {}
    for mp in (5, 10, 15):
        port[f"max_{mp}_positions"] = {
            "2011_2019": portfolio(t, pd.Timestamp("2011-01-01"), S.SPLIT, mp),
            "2020_on": portfolio(t, S.SPLIT, pd.Timestamp("2100-01-01"), mp),
            "all": portfolio(t, pd.Timestamp("2011-01-01"), pd.Timestamp("2100-01-01"), mp)}
    b = bench[bench.index >= "2011-01-01"]
    by = b.groupby(b.index.year).last()
    bench_y = by.pct_change()
    bench_y.iloc[0] = by.iloc[0] / b.iloc[0] - 1
    yrs = (b.index[-1] - b.index[0]).days / 365.25
    bdd = (b / b.cummax() - 1).min()
    out = {"best": {k: (v.item() if hasattr(v, "item") else v) for k, v in best.to_dict().items()},
           "by_year": by_year.to_dict("records"), "portfolio": port,
           "nifty500": {"cagr_pct": round(100 * ((b.iloc[-1] / b.iloc[0]) ** (1 / yrs) - 1), 1), "max_dd_pct": round(100 * bdd, 1),
                        "yearly_pct": {int(y): round(100 * v, 1) for y, v in bench_y.items()}}}
    with open(os.path.join(OUT, "final_strategy.json"), "w") as fh:
        json.dump(out, fh, indent=1, default=str)
    print(json.dumps(out, indent=1, default=str))


if __name__ == "__main__":
    main()
