"""Search entry setups x filters x exits for swing / positional trades on Nifty
Midcap 150 + Smallcap 250 stocks (daily bars), and rank them without peeking
at the test years.

    python research/search_strategies.py

Everything is decided on a bar's CLOSE and the trade is entered at the NEXT
open, so every rule can be reproduced by a non-repainting TradingView script.

Selection uses 2011-2019 only (in-sample). 2020 onwards (out-of-sample) is
reported for the shortlist but never used to choose. Costs 0.3% round trip.
Survivorship bias: today's index members only, so absolute numbers flatter.
"""
import itertools
import json
import os
import pickle
import time

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "research", "data", "prices.pkl")
OUT = os.path.join(ROOT, "research", "results")
START, SPLIT = pd.Timestamp("2011-01-01"), pd.Timestamp("2020-01-01")
COST = 0.003
MAX_HOLD = 250


def wilder(x, n):
    return x.ewm(alpha=1 / n, adjust=False).mean()


def prepare(df, bench, mkt):
    df = df[["Open", "High", "Low", "Close", "Volume"]].dropna()
    df = df[(df["Close"] > 0) & (df["High"] >= df["Low"]) & (df["Open"] > 0)]
    if len(df) < 400:
        return None
    o, h, l, c, v = (df[k] for k in ("Open", "High", "Low", "Close", "Volume"))
    idx = df.index
    tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    atr = wilder(tr, 14)
    up, dn = h.diff(), -l.diff()
    pdm = wilder(pd.Series(np.where((up > dn) & (up > 0), up, 0.0), index=idx), 14)
    mdm = wilder(pd.Series(np.where((dn > up) & (dn > 0), dn, 0.0), index=idx), 14)
    s = {k: c.rolling(k).mean() for k in (10, 20, 50, 70, 150, 200)}
    e = {k: c.ewm(span=k, adjust=False).mean() for k in (10, 21)}
    vavg = v.shift(1).rolling(50).mean()
    b = bench.reindex(idx).ffill()
    rs = c / b
    m = mkt.reindex(idx).ffill()
    hh = lambda n: h.shift(1).rolling(n).max()      # noqa: E731  highest high of the previous n bars
    ll = lambda n: l.shift(1).rolling(n).min()      # noqa: E731
    ext = (c / s[50] - 1) / (atr / c)
    tt = (c > s[50]) & (s[50] > s[150]) & (s[150] > s[200]) & (s[200] > s[200].shift(20))
    rng = lambda n: (hh(n) - ll(n)) / c             # noqa: E731  depth of the previous n bars as a fraction of price

    def first(cond):                                  # first bar of a run of True (no repeats while it stays true)
        cond = cond.fillna(False)
        return cond & ~cond.shift(1, fill_value=False)

    zone_atr = (c >= s[70] + 2 * atr) & (pdm > mdm) & (ext <= 7) & (rs >= rs.rolling(50).mean())
    entries = {
        "ATR entry (green dot)": first(zone_atr),
        "52w high breakout": first(c > hh(252)),
        "50d high breakout": first(c > hh(50)),
        "20d high breakout": first(c > hh(20)),
        "Base breakout 20-60d, depth<=25%": first((c > hh(40)) & (rng(40) <= 0.25) & (rng(40) >= 0.08)),
        "Tight base breakout 15d, depth<=12%": first((c > hh(15)) & (rng(15) <= 0.12)),
        "VCP: 10d range < half 50d range, breakout": first((c > hh(10)) & (rng(10) < 0.5 * rng(50).shift(10)) & (rng(10) <= 0.15)),
        "Pullback to 21 EMA, bounce": (tt & (l.shift(1) <= e[21].shift(1) * 1.01) & (c > h.shift(1)) & (c > e[21])).fillna(False),
        "Pullback to 50 SMA, bounce": (tt & (l.shift(1) <= s[50].shift(1) * 1.01) & (c > h.shift(1)) & (c > s[50])).fillna(False),
        "Gap up >=4% on 3x volume (EP)": ((o / c.shift(1) - 1 >= 0.04) & (v >= 3 * vavg) & (c >= o)).fillna(False),
        "RS line new 52w high + 20d high": first((rs >= rs.rolling(252).max()) & (c > hh(20))),
        "10/50 EMA-SMA cross up": first(e[10] > s[50]),
    }
    filters = {
        "trend template": tt,
        "vol >= 1.5x": v >= 1.5 * vavg,
        "vol >= 2x": v >= 2 * vavg,
        "RS line >= 50d avg": rs >= rs.rolling(50).mean(),
        "RS line at 52w high": rs >= rs.rolling(252).max(),
        "Nifty500 > 200 SMA": m > m.rolling(200).mean(),
        "within 15% of 52w high": c >= 0.85 * h.rolling(252).max(),
        "close top 1/3 of day": (c - l) >= 0.667 * (h - l),
        "ext <= 5 ATR": ext <= 5,
        "+DI > -DI": pdm > mdm,
    }
    liquid = ((c * v).rolling(50).mean() / 1e7 >= 1.0) & (c >= 50) & (idx >= START)
    return {"o": o.to_numpy(), "h": h.to_numpy(), "l": l.to_numpy(), "c": c.to_numpy(), "atr": atr.to_numpy(),
            "ema21": e[21].to_numpy(), "ema10": e[10].to_numpy(), "sma50": s[50].to_numpy(),
            "dates": idx.to_numpy(), "liquid": liquid.to_numpy(),
            "E": {k: v_.to_numpy(bool) for k, v_ in entries.items()},
            "F": {k: v_.fillna(False).to_numpy(bool) for k, v_ in filters.items()}}


EXITS = ("21 EMA close", "50 SMA close", "3 ATR trail", "20 days")


def trade(p, i, exit_rule):
    """One trade from a signal on bar i: (exit bar, return, R) or None if still open."""
    o, h, l, c = p["o"], p["h"], p["l"], p["c"]
    n = len(c)
    e = i + 1
    if e >= n:
        return None
    entry = o[e]
    risk = 2 * p["atr"][i]
    if not (entry > 0 and risk > 0):
        return None
    stop = entry - risk
    end = min(n, e + (21 if exit_rule == "20 days" else MAX_HOLD + 1))
    L, C = l[e:end], c[e:end]
    if exit_rule == "20 days":
        if e + 20 >= n:
            return None
        j, px = e + 20, c[e + 20]
    else:
        stop_hit = np.flatnonzero(L <= stop)
        if exit_rule == "21 EMA close":
            below = np.flatnonzero(C < p["ema21"][e:end])
        elif exit_rule == "50 SMA close":
            below = np.flatnonzero(C < p["sma50"][e:end])
        else:                                              # chandelier: highest high since entry - 3 ATR, on a close
            trail = np.maximum.accumulate(h[e:end]) - 3 * p["atr"][e:end]
            below = np.flatnonzero(C < np.maximum(trail, stop))
        below = below[below >= 1]                          # close-based exits from the 2nd day
        k_stop = stop_hit[0] if len(stop_hit) else 10 ** 9
        k_cls = below[0] if len(below) else 10 ** 9
        if k_stop == 10 ** 9 and k_cls == 10 ** 9:
            if end == n:
                return None                                # still open
            j, px = end - 1, c[end - 1]
        elif k_stop <= k_cls:
            j = e + k_stop
            px = min(o[j], stop) if k_stop > 0 else stop
        else:
            j, px = e + k_cls, C[k_cls]
    ret = px / entry - 1 - COST
    return j, ret, (px - entry) / risk - COST * entry / risk


def run(preps, entry, filt, exit_rule):
    rows = []
    for p in preps:
        mask = p["E"][entry] & p["liquid"]
        for f in filt:
            mask = mask & p["F"][f]
        free = 0
        for i in np.flatnonzero(mask):
            if i < free:
                continue
            t = trade(p, i, exit_rule)
            if t is None:
                continue
            j, r, R = t
            rows.append((p["dates"][i], r, R, j - i))
            free = j + 1
    if not rows:
        return None
    return pd.DataFrame(rows, columns=["date", "ret", "R", "days"])


def stats(t):
    if t is None or len(t) == 0:
        return {"n": 0}
    r = t["ret"]
    w, lo = r[r > 0].sum(), -r[r <= 0].sum()
    return {"n": int(len(t)), "win": round(100 * (r > 0).mean(), 1), "avg": round(100 * r.mean(), 2),
            "pf": round(w / lo, 2) if lo > 0 else 99.0, "eR": round(t["R"].mean(), 3), "days": round(t["days"].mean(), 1)}


def yearly_eR(t):
    return t.groupby(pd.to_datetime(t["date"]).dt.year)["R"].mean()


def main():
    t0 = time.time()
    with open(DATA, "rb") as fh:
        D = pickle.load(fh)
    bench = D["bench"]["NIFTY500"]
    preps = [p for p in (prepare(df, bench, bench) for df in D["stocks"].values()) if p is not None]
    print(f"{len(preps)} stocks prepared in {time.time() - t0:.0f}s")
    entries = list(preps[0]["E"])
    fnames = list(preps[0]["F"])
    combos = [()] + [(f,) for f in fnames] + list(itertools.combinations(fnames, 2))
    # drop pairs that are redundant with each other
    combos = [cb for cb in combos if not ({"vol >= 1.5x", "vol >= 2x"} <= set(cb))]
    results = []
    k = 0
    for en in entries:
        for cb in combos:
            for ex in EXITS:
                k += 1
                t = run(preps, en, cb, ex)
                if t is None:
                    continue
                d = pd.to_datetime(t["date"])
                ins, oos = t[d < SPLIT], t[d >= SPLIT]
                si, so = stats(ins), stats(oos)
                yrs = yearly_eR(ins)
                results.append({"entry": en, "filters": " + ".join(cb) or "-", "exit": ex,
                                **{f"is_{a}": b for a, b in si.items()}, **{f"oos_{a}": b for a, b in so.items()},
                                "is_pos_years": int((yrs > 0).sum()), "is_years": int(len(yrs)),
                                "is_worst_year_R": round(float(yrs.min()), 3) if len(yrs) else None})
        print(f"  {en}: done ({k} runs, {time.time() - t0:.0f}s)")
    res = pd.DataFrame(results)
    os.makedirs(OUT, exist_ok=True)
    res.to_csv(os.path.join(OUT, "strategy_search.csv"), index=False)
    # rank on in-sample only: enough trades, positive most years, then expectancy and profit factor
    ok = res[(res.is_n >= 250) & (res.is_pos_years >= 6)].copy()
    ok["is_score"] = ok.is_eR * np.sqrt(ok.is_n.clip(upper=2000) / 250) * ok.is_pf.clip(upper=3)
    top = ok.sort_values("is_score", ascending=False).head(25)
    cols = ["entry", "filters", "exit", "is_n", "is_win", "is_pf", "is_eR", "is_pos_years", "is_worst_year_R",
            "oos_n", "oos_win", "oos_pf", "oos_eR", "oos_avg", "oos_days"]
    top[cols].to_csv(os.path.join(OUT, "strategy_top25.csv"), index=False)
    pd.set_option("display.width", 250)
    pd.set_option("display.max_columns", 30)
    pd.set_option("display.max_colwidth", 48)
    print(top[cols].to_string(index=False))
    print(f"total {len(res)} strategies in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
