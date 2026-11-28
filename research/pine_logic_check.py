"""Check that pine/momentum_breakout_swing.pine trades like the research.

Replays the indicator's bar-by-bar state machine (signal on a closed bar,
entry at the next open, 3 ATR stop, 5 ATR trailing exit on a close from the
2nd day, one trade at a time) in Python and compares every trade with the
vectorised research engine (refine_strategy.collect).

    python research/pine_logic_check.py
"""
import os
import pickle
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import refine_strategy as R  # noqa: E402
import search_strategies as S  # noqa: E402

FILTERS = ("trend template", "Nifty500 > 200 SMA")
ENTRY = "52w high breakout"


def pine_replay(p, stop_mult=3.0, trail_mult=5.0):
    o, h, l, c, atr = p["o"], p["h"], p["l"], p["c"], p["atr"]
    setup = p["E"][ENTRY] & p["liquid"]
    for f in FILTERS:
        setup = setup & p["F"][f]
    in_pos = pending = False
    sig_atr = entry = stop = hh = None
    entry_bar, exit_bar, sig_bar = None, -1, None
    trades = []
    for i in range(len(c)):
        exit_sig, exit_px = False, None
        if pending:
            pending, in_pos = False, True
            entry, entry_bar = o[i], i
            stop = entry - stop_mult * sig_atr
            hh = h[i]
            if l[i] <= stop:
                exit_sig, exit_px = True, stop
        elif in_pos:
            hh = max(hh, h[i])
            trail = max(hh - trail_mult * atr[i], stop)
            if l[i] <= stop:
                exit_sig, exit_px = True, min(o[i], stop)
            elif c[i] < trail:
                exit_sig, exit_px = True, c[i]
        if exit_sig:
            trades.append((p["dates"][sig_bar], p["dates"][entry_bar], p["dates"][i], round(exit_px / entry - 1 - S.COST, 6)))
            in_pos, exit_bar = False, i
        elif in_pos and i - entry_bar >= S.MAX_HOLD:          # the research caps a trade at 250 days
            trades.append((p["dates"][sig_bar], p["dates"][entry_bar], p["dates"][i], round(c[i] / entry - 1 - S.COST, 6)))
            in_pos, exit_bar = False, i
        if setup[i] and not in_pos and not pending and i > exit_bar:
            pending, sig_atr, sig_bar = True, atr[i], i
    return trades


def main():
    with open(S.DATA, "rb") as fh:
        D = pickle.load(fh)
    bench = D["bench"]["NIFTY500"]
    preps = [p for p in (S.prepare(df, bench, bench) for df in D["stocks"].values()) if p is not None]
    for p in preps:                                   # ranking columns collect() records; not used here
        p["volx"] = p["rs_rank_raw"] = np.zeros(len(p["c"]))
    ref = R.collect(preps, ENTRY, FILTERS, 3.0, "trail 5")
    ref_set = {(pd.Timestamp(a), pd.Timestamp(b), pd.Timestamp(x), round(r, 6))
               for a, b, x, r in zip(ref.sig, ref.entry_date, ref.exit_date, ref.ret)}
    rep = set()
    for p in preps:
        for a, b, x, r in pine_replay(p):
            rep.add((pd.Timestamp(a), pd.Timestamp(b), pd.Timestamp(x), r))
    same = ref_set & rep
    print(f"research trades {len(ref_set)}, indicator replay trades {len(rep)}, identical {len(same)}")
    only_ref, only_rep = sorted(ref_set - rep)[:5], sorted(rep - ref_set)[:5]
    if only_ref or only_rep:
        print("only in research:", only_ref)
        print("only in replay:", only_rep)


if __name__ == "__main__":
    main()
