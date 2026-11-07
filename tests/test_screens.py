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


def multiyear_stock():
    # Peak at 200, then 3 years sideways 120-180, now back at 199
    return make_series([(0, 100), (250, 200), (120, 120), (200, 175), (200, 125),
                        (200, 170), (40, 199)], seed=2)


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


def test_multiyear():
    m = ibs.analyze_stock(multiyear_stock(), ibs.ScanConfig())
    assert m["multiyear_base"], m
    assert m["myb_base_years"] >= 2


def test_ipo():
    m = ibs.analyze_stock(ipo_stock(), ibs.ScanConfig())
    assert m["ipo_base"], m


def test_murphy():
    out = ibs.find_murphy(murphy_stock(), ibs.ScanConfig())
    assert out["murphy"], out
    assert out["murphy_filter_ok"] and out["murphy_days_ago"] < 5
    assert out["murphy_stop"] < out["murphy_entry"]


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


def test_indicators_in_range():
    df = vcp_stock()
    r, a = ibs.rsi(df["Close"]), ibs.adx(df)
    assert r.between(0, 100).all() and a.dropna().between(0, 100).all()


def test_full_scan_and_excel(tmp_path=None):
    data = {"VCPCO": vcp_stock(), "SKYCO": bluesky_stock(), "MYBCO": multiyear_stock(),
            "IPOCO": ipo_stock(), "DOWNCO": downtrend_stock(), "MURCO": murphy_stock()}
    cfg = ibs.ScanConfig(min_rs=0, min_turnover_cr=0)
    res = ibs.scan(data, cfg)
    s = res.screens
    assert "VCPCO" in set(s["VCP"]["symbol"])
    assert "SKYCO" in set(s["Blue Sky"]["symbol"])
    assert "MYBCO" in set(s["Multi-Year Base"]["symbol"])
    assert "IPOCO" in set(s["IPO Base"]["symbol"])
    assert "MURCO" in set(s["Murphy"]["symbol"])
    assert "DOWNCO" not in set(s["Trend Template"]["symbol"])
    path = os.path.join(str(tmp_path or "."), "test_results.xlsx")
    res.to_excel(path)
    assert os.path.exists(path)
    os.remove(path)


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok ", name)
