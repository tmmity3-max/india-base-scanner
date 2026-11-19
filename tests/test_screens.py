"""Offline tests on synthetic price paths (no internet needed).

Run:  python -m pytest -q   (or)   python tests/test_screens.py
"""
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import india_base_scanner as ibs  # noqa: E402


def make_series(waypoints, noise=0.004, seed=0, volume=None, start="2015-01-01"):
    """Build OHLCV from (bars, price) waypoints with small daily noise."""
    rng = np.random.default_rng(seed)
    closes = [waypoints[0][1]]
    for bars, price in waypoints[1:]:
        closes.extend(np.linspace(closes[-1], price, bars + 1)[1:])
    c = np.array(closes) * (1 + rng.normal(0, noise, len(closes)))
    o = np.r_[c[0], c[:-1]]
    h = np.maximum(o, c) * (1 + abs(rng.normal(0, noise, len(c))))
    lo = np.minimum(o, c) * (1 - abs(rng.normal(0, noise, len(c))))
    v = np.full(len(c), 1_000_000.0) if volume is None else np.asarray(volume, float)
    idx = pd.bdate_range(start, periods=len(c))
    return pd.DataFrame({"Open": o, "High": h, "Low": lo, "Close": c, "Volume": v}, index=idx)


def vcp_stock():
    # Long uptrend, then a base: -25%, -14%, -7%, -3% pullbacks, now near pivot
    wp = [(0, 100), (300, 300),          # stage 2 advance
          (20, 225), (20, 296),          # contraction 1 (-25%)
          (15, 255), (15, 293),          # contraction 2 (-13%)
          (10, 272), (10, 291),          # contraction 3 (-7%)
          (6, 283), (6, 289)]            # contraction 4 (-3%), sitting under pivot
    n = 1 + sum(b for b, _ in wp[1:])
    vol = np.full(n, 1_000_000.0)
    vol[-12:] = 500_000                  # volume dry-up
    return make_series(wp, noise=0.002, volume=vol)


def bluesky_stock():
    return make_series([(0, 100), (500, 160), (150, 120), (300, 250)], seed=1)


def ep_stock(days_ago=1, gap=0.08, vol_mult=6.0, after=1.01):
    """A quiet, sideways stock that gaps up 8% on 6x volume ``days_ago`` sessions ago."""
    df = make_series([(0, 100), (200, 104), (100, 101)], noise=0.004, seed=7)
    d = len(df) - 1 - days_ago
    pc = df["Close"].iloc[d - 1]
    df.iloc[d, df.columns.get_loc("Open")] = pc * (1 + gap)
    df.iloc[d, df.columns.get_loc("Low")] = pc * (1 + gap) * 0.99
    df.iloc[d, df.columns.get_loc("Close")] = pc * (1 + gap) * 1.03
    df.iloc[d, df.columns.get_loc("High")] = pc * (1 + gap) * 1.035
    df.iloc[d, df.columns.get_loc("Volume")] = 1_000_000 * vol_mult
    for j in range(d + 1, len(df)):                  # holds above the EP day afterwards
        base = df["Close"].iloc[d] * after
        df.iloc[j, :4] = [base, base * 1.01, base * 0.995, base]
    return df


def ipo_stock():
    # Listed ~140 bars ago, ran up, based 20% deep, back near the high
    return make_series([(0, 100), (40, 150), (40, 122), (55, 147)], seed=3)


def murphy_stock():
    # Long uptrend, a two-month rest (10 SMA dips under 50 SMA), then a fresh
    # breakout over the last few sessions while above the rising 40-week SMA
    return make_series([(0, 100), (350, 230), (45, 205), (25, 212), (4, 240)], noise=0.004, seed=5)


def downtrend_stock():
    return make_series([(0, 300), (600, 120)], seed=4)


def test_zigzag_alternates():
    df = vcp_stock()
    piv = ibs.zigzag(df["High"].to_numpy(), df["Low"].to_numpy(), 4)
    kinds = [p[2] for p in piv]
    assert all(a != b for a, b in zip(kinds, kinds[1:]))


def test_vcp_detected():
    out = ibs.find_vcp(vcp_stock(), ibs.ScanConfig())
    assert out["vcp"], out
    assert out["vcp_contractions"] >= 3


def test_vcp_not_in_downtrend():
    assert not ibs.find_vcp(downtrend_stock(), ibs.ScanConfig())["vcp"]


def test_bluesky():
    m = ibs.analyze_stock(bluesky_stock(), ibs.ScanConfig())
    assert m["bluesky"] and m["pct_from_ath"] > -3


def test_episodic_pivot():
    cfg = ibs.ScanConfig()
    m = ibs.find_ep(ep_stock(days_ago=1), cfg)
    assert m["ep"] and m["ep_days_ago"] == 1 and m["ep_type"] == "Gap up", m
    assert m["ep_gap"] >= 7.9 and m["ep_rvol"] >= 5 and m["ep_neglected"]
    assert ibs.find_ep(ep_stock(days_ago=0), cfg)["ep_days_ago"] == 0
    # outside the 3-session window, on normal volume, or broke the EP day's low: no EP
    assert ibs.find_ep(ep_stock(days_ago=15), cfg)["ep_days_ago"] == 15   # within the month
    assert not ibs.find_ep(ep_stock(days_ago=25), cfg)["ep"]                # older than 21 sessions
    assert not ibs.find_ep(ep_stock(vol_mult=1.5), cfg)["ep"]
    assert not ibs.find_ep(ep_stock(days_ago=2, after=0.9), cfg)["ep"]
    # no real gap but a well above-average day (+4% vs a ~1% usual range): a "Big move"
    m = ibs.find_ep(ep_stock(gap=0.01), cfg)
    assert m["ep"] and m["ep_type"] == "Big move", m
    # an ordinary day on heavy volume (+2%) is not an EP
    assert not ibs.find_ep(ep_stock(gap=-0.01), cfg)["ep"]
    assert ibs.earnings_on("2026-11-18", [pd.Timestamp("2026-11-17 16:00", tz="Asia/Kolkata")])
    assert not ibs.earnings_on("2026-11-18", [pd.Timestamp("2026-08-10")])
    assert not ibs.earnings_on("", [pd.Timestamp("2026-11-17")])


def test_ipo():
    m = ibs.analyze_stock(ipo_stock(), ibs.ScanConfig())
    assert m["ipo_base"], m


def test_murphy():
    out = ibs.find_murphy(murphy_stock(), ibs.ScanConfig())
    assert out["murphy"], out
    assert out["murphy_filter_ok"] and out["murphy_days_ago"] < 5
    assert "murphy_stop" not in out and out["murphy_entry"] > 0


def test_murphy_weekly_no_lookahead():
    # weekly values for a day must come from the previous completed week
    df = murphy_stock()
    w = ibs._weekly_on_daily(df, ibs.ScanConfig())
    d = df.index[-1]
    prev_week_end = (d.to_period("W-FRI").start_time - pd.Timedelta(days=1))
    expected = df.loc[:prev_week_end, "High"].resample("W-FRI").max().tail(4).max()
    assert abs(w["w_high_n"].iloc[-1] - expected) < 1e-9


def test_murphy_not_in_downtrend():
    assert not ibs.find_murphy(downtrend_stock(), ibs.ScanConfig())["murphy"]


def base_forming_stock():
    # Uptrend, then six weeks below the high with a 12% pullback, now 2% under the pivot
    return make_series([(0, 100), (300, 200), (15, 176), (15, 196)], noise=0.002, seed=5)


def base_breakout_stock():
    # The same base, then a close through the pivot two sessions ago
    return make_series([(0, 100), (300, 200), (15, 176), (13, 198), (2, 208)], noise=0.002, seed=5)


def test_base_forming():
    out = ibs.find_base(base_forming_stock(), ibs.ScanConfig())
    assert out["base_bo"] and out["base_state"] == "Forming", out
    assert 195 < out["base_pivot"] < 205 and -5 <= out["base_pct_from_pivot"] <= 0
    assert out["base_weeks"] >= 3 and 5 <= out["base_depth"] <= 35
    assert "Sky" in out["base_tags"]


def test_base_breakout():
    out = ibs.find_base(base_breakout_stock(), ibs.ScanConfig())
    assert out["base_bo"] and out["base_state"] == "Fresh breakout", out
    assert out["base_no"] >= 1 and out["base_days_ago"] <= 5
    assert out["base_pct_from_pivot"] >= 0


def test_base_no_lookahead():
    # ten sessions earlier the breakout has not happened yet: still a forming base
    df = base_breakout_stock()
    cut = df.iloc[:-10]
    assert ibs.find_base(cut, ibs.ScanConfig())["base_state"] == "Forming"


def test_base_not_in_downtrend():
    assert not ibs.find_base(downtrend_stock(), ibs.ScanConfig())["base_bo"]


def _after_breakout(*more):
    return make_series([(0, 100), (300, 200), (15, 176), (13, 198), (2, 208), *more], noise=0.002, seed=5)


def test_base_stages_after_breakout():
    cfg = ibs.ScanConfig()
    # three weeks on, 12% above the pivot and never back under it: climbing
    out = ibs.find_base(_after_breakout((20, 225)), cfg)
    assert out["base_state"] == "Climbing" and out["base_bo"], out
    # 35% above the pivot and still holding: that is still climbing, not played out
    assert ibs.find_base(_after_breakout((20, 270)), cfg)["base_state"] == "Climbing"
    # held for a month, then closed back under the pivot: the breakout failed late
    assert ibs.find_base(_after_breakout((20, 225), (15, 192)), cfg)["base_state"] == "Played out"
    # closed back under the pivot within days: the breakout failed straight away
    out = ibs.find_base(_after_breakout((8, 190)), cfg)
    assert out["base_state"] == "Played out" and out["base_pct_from_pivot"] < 0, out
    # a breakout already more than 7% beyond the pivot is not "fresh"
    df = make_series([(0, 100), (300, 200), (15, 176), (13, 198), (2, 225)], noise=0.002, seed=5)
    assert ibs.find_base(df, cfg)["base_state"] == "Climbing"
    assert set(ibs.BASE_STAGES) >= {"Forming", "Fresh breakout", "Climbing", "Played out"}
    # broke out, dipped under the pivot for a day, ran up, now resting in a new
    # base above the 50 EMA (like ROSSTECH on 16 Nov): Forming, not Played out
    df = _after_breakout((1, 199), (25, 270), (20, 240))
    out = ibs.find_base(df, cfg)
    assert out["base_state"] == "Forming" and out["base_bo"] and out["base_pivot"] > 260, out


def test_base_boxes():
    df = base_breakout_stock()
    boxes = ibs.base_boxes(df, ibs.ScanConfig(), since=df.index[0])
    b = boxes[-1]
    assert b["bo"] == 1 and b["t"].startswith("Sky · B1") and b["l"] < b["p"], b
    assert b["s"] < b["e"] == df.index[-2].strftime("%Y-%m-%d")
    # the base still forming is the last box and has no breakout
    f = ibs.base_boxes(base_forming_stock(), ibs.ScanConfig())[-1]
    assert f["bo"] == 0 and f["e"] == base_forming_stock().index[-1].strftime("%Y-%m-%d")
    # bases that ended before `since` are dropped
    assert ibs.base_boxes(df, ibs.ScanConfig(), since=df.index[-1]) == []


def test_market_cap_filter():
    data = {"BASECO": base_breakout_stock(), "FORMCO": base_forming_stock(), "SKYCO": bluesky_stock()}
    cfg = ibs.ScanConfig(min_rs=0, min_turnover_cr=0, base_min_rs=0)
    assert cfg.min_mcap_cr == 500
    res = ibs.scan(data, cfg)
    assert {"BASECO", "FORMCO"} <= set(res.screens["Base Breakout"]["symbol"])
    assert "SKYCO" in set(res.screens["Blue Sky"]["symbol"])
    ibs.apply_market_cap_filter(res, {})                       # no fundamentals: nothing dropped
    assert {"BASECO", "FORMCO"} <= set(res.screens["Base Breakout"]["symbol"])
    # the floor applies to every screen; a stock with no market cap is dropped as well
    ibs.apply_market_cap_filter(res, {"BASECO": {"market_cap_cr": 5000}, "FORMCO": {"market_cap_cr": 300}})
    for name, table in res.screens.items():
        assert set(table["symbol"]) <= {"BASECO"}, name
    assert "BASECO" in set(res.screens["Base Breakout"]["symbol"])


def _run_up(*more):
    # a steady climb, then a fast leg that leaves price well above its 50 EMA
    return make_series([(0, 100), (250, 150), (40, 205), *more], noise=0.002, seed=5)


def pullback_stock():
    return _run_up((16, 185))


def test_pullback_stages():
    cfg = ibs.ScanConfig()
    out = ibs.find_pullback(pullback_stock(), cfg)
    assert out["pullback"] and out["pb_stage"] == "At the 50 EMA", out
    assert abs(out["pb_pct_from_ema"]) <= 1 and out["pb_from_high"] < -5
    assert ibs.find_pullback(_run_up((16, 184.5), (2, 189)), cfg)["pb_stage"] == "Bouncing"
    assert ibs.find_pullback(_run_up((12, 189.5)), cfg)["pb_stage"] == "Approaching"


def test_pullback_rejects():
    cfg = ibs.ScanConfig()
    assert not ibs.find_pullback(_run_up((5, 210)), cfg)["pullback"]        # still far above the EMA
    assert not ibs.find_pullback(_run_up((20, 165)), cfg)["pullback"]       # fell through it
    assert not ibs.find_pullback(downtrend_stock(), cfg)["pullback"]
    # a slow grinder that never ran away from its EMA is not a pullback
    assert not ibs.find_pullback(make_series([(0, 100), (300, 160)], noise=0.002, seed=5), cfg)["pullback"]


def ichimoku_stock():
    # Uptrend, a four-month drift lower that leaves price under the cloud, then
    # a turn up through the cloud top over the last few sessions on heavy volume
    wp = [(0, 100), (250, 200), (30, 172), (90, 160), (8, 165), (4, 182)]
    n = 1 + sum(b for b, _ in wp[1:])
    vol = np.full(n, 1_000_000.0)
    vol[-5:] = 2_500_000
    return make_series(wp, noise=0.003, seed=7, volume=vol)


def test_ichimoku_signal():
    out = ibs.find_ichimoku(ichimoku_stock(), ibs.ScanConfig())
    assert out["ichimoku"], out
    assert out["ich_signal"] in ibs.ICH_SIGNAL_NAMES.values() and out["ich_days_ago"] <= 5
    # the setup has its stop under the entry and its first target above it
    assert out["ich_sl"] < out["ich_entry"] < out["ich_tp1"], out


def test_ichimoku_needs_volume():
    # the same price path on flat volume: no cloud breakout, and the TK cross fails the volume filter
    df = ichimoku_stock()
    df["Volume"] = 1_000_000.0
    assert not ibs.find_ichimoku(df, ibs.ScanConfig())["ichimoku"]


def test_ichimoku_no_lookahead():
    # signals on past bars must not change when later bars arrive
    df = ichimoku_stock()
    cfg = ibs.ScanConfig(ich_bars=len(df))          # same window start for both runs
    full = ibs._ichimoku_engine(df, cfg)
    cut = ibs._ichimoku_engine(df.iloc[:-3], cfg)
    last = len(df) - 4 - cfg.ich_div_len             # divergences are dated back to their pivot
    key = lambda e: [(x["i"], x["k"]) for x in e["events"] if x["i"] <= last]  # noqa: E731
    assert key(full) == key(cut)


def test_ichimoku_not_in_downtrend():
    assert not ibs.find_ichimoku(downtrend_stock(), ibs.ScanConfig())["ichimoku"]


def test_ichimoku_chart_payload():
    df = ichimoku_stock()
    p = ibs.ichimoku_chart(df, ibs.ScanConfig(), 200)
    assert len(p["tenkan"]) == len(p["kijun"]) == len(p["spanA"]) == len(p["spanB"]) == 200
    assert p["shift"] == 25 and any(e["k"] in ibs.ICH_BULL_KINDS for e in p["events"])
    t = p["trade"]
    assert t["dir"] == 1 and t["sl"] < t["entry"] < t["tp"][0] < t["tp"][1] < t["tp"][2]
    import json
    json.dumps(p)                                    # plain types only


def test_indicators_in_range():
    df = vcp_stock()
    r, a = ibs.rsi(df["Close"]), ibs.adx(df)
    assert r.between(0, 100).all() and a.dropna().between(0, 100).all()


def test_full_scan_and_excel(tmp_path=None):
    data = {"VCPCO": vcp_stock(), "SKYCO": bluesky_stock(), "EPCO": ep_stock(), "ATRCO": atr_entry_stock(),
            "IPOCO": ipo_stock(), "DOWNCO": downtrend_stock(), "MURCO": murphy_stock(),
            "BASECO": base_breakout_stock(), "ICHCO": ichimoku_stock(), "PULLCO": pullback_stock()}
    cfg = ibs.ScanConfig(min_rs=0, min_turnover_cr=0, base_min_rs=0, pb_min_rs=0)
    res = ibs.scan(data, cfg)
    s = res.screens
    assert "VCPCO" in set(s["VCP"]["symbol"])
    assert "SKYCO" in set(s["Blue Sky"]["symbol"])
    assert "EPCO" in set(s["Episodic Pivot"]["symbol"])
    assert "ATRCO" in set(s["ATR Entry"]["symbol"])
    assert "IPOCO" in set(s["IPO Base"]["symbol"])
    assert "MURCO" in set(s["Murphy"]["symbol"])
    assert "BASECO" in set(s["Base Breakout"]["symbol"])
    assert "DOWNCO" not in set(s["Base Breakout"]["symbol"])
    assert "ICHCO" in set(s["Ichimoku"]["symbol"])
    assert "DOWNCO" not in set(s["Ichimoku"]["symbol"])
    assert "PULLCO" in set(s["50 EMA Pullback"]["symbol"])
    assert "DOWNCO" not in set(s["50 EMA Pullback"]["symbol"])
    assert "DOWNCO" not in set(s["Trend Template"]["symbol"])
    path = os.path.join(str(tmp_path or "."), "test_results.xlsx")
    res.to_excel(path)
    assert os.path.exists(path)
    os.remove(path)


def test_quarter_summary():
    cols = pd.to_datetime(["2026-09-30", "2026-06-30", "2026-03-31", "2025-12-31", "2025-09-30"])
    stmt = pd.DataFrame({c: {"Total Revenue": r * 1e7, "Operating Income": o * 1e7, "Net Income": p * 1e7}
                         for c, r, o, p in zip(cols, [200, 160, 150, 140, 125], [50, 32, 30, 28, 20],
                                               [30, 20, 18, 17, 10])})
    q = ibs.quarter_summary(stmt)
    assert q["q"] == "Sep-26" and q["sales_cr"] == 200 and q["opm"] == 25.0
    assert q["sales_qoq"] == 25.0 and q["sales_yoy"] == 60.0      # vs 160 and vs 125
    assert q["pat_qoq"] == 50.0 and q["pat_yoy"] == 200.0
    assert q["opm_qoq"] == 5.0 and q["opm_yoy"] == 9.0            # 25% vs 20% and vs 16%
    short = ibs.quarter_summary(stmt.iloc[:, :2])                  # no year-ago quarter
    assert short["sales_yoy"] is None and short["opm_qoq"] == 5.0
    assert ibs.quarter_summary(None) == {} and ibs.quarter_summary(pd.DataFrame()) == {}


def atr_entry_stock():
    """Quiet for a year, then six +1% days that clear SMA70 + 2 ATR."""
    df = make_series([(0, 100), (260, 100)], noise=0.003, seed=11)
    n = len(df)
    for j in range(n - 6, n):                               # six up days of +1%
        base = df["Close"].iloc[j - 1] * 1.01
        df.iloc[j, :4] = [base * 0.997, base * 1.003, base * 0.995, base]
    return df


def test_atr_entry():
    cfg = ibs.ScanConfig(atr_use_rs=False)
    df = atr_entry_stock()
    m = ibs.find_atr_entry(df, cfg)
    assert m["atr_entry"] and m["atr_in_zone"] and 0 <= m["atr_days_ago"] <= 4, m
    assert m["atr_pct_from_line"] >= 0 and m["atr_ext"] <= 7
    # 10 flat sessions later the signal is outside the 5-session window
    longer = pd.concat([df, df.iloc[-1:].reindex(pd.bdate_range(df.index[-1], periods=11)[1:]).ffill()])
    assert not ibs.find_atr_entry(longer, cfg)["atr_entry"]
    # over-extended: a 7-ATR cap of 0.5 blocks it
    assert not ibs.find_atr_entry(df, ibs.ScanConfig(atr_use_rs=False, atr_max_ext=0.5))["atr_entry"]
    # a flat stock never signals
    assert not ibs.find_atr_entry(make_series([(0, 100), (300, 100)], seed=3), cfg)["atr_entry"]
    # RS filter: the stock rose 6% while the index rose 20% over those days -> RS below its average
    bench = pd.Series(np.r_[np.full(len(df) - 6, 100.0), np.linspace(104, 125, 6)], index=df.index)
    assert not ibs.find_atr_entry(df, ibs.ScanConfig(), bench)["atr_entry"]


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok ", name)
