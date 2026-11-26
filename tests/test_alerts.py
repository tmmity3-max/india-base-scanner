"""Offline tests for the Telegram alert rules (no internet, standard library only).

Run:  python tests/test_alerts.py
"""
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import check_alerts as ca  # noqa: E402


def ts(h, m):
    """unix time of a 5-minute candle on 26 Nov 2026 at h:m IST"""
    return int(datetime(2026, 11, 26, h, m, tzinfo=ca.IST).timestamp())


BARS = [(ts(9, 15), 101, 99, 100), (ts(9, 20), 104, 100, 103), (ts(9, 25), 103, 96, 97), (ts(9, 30), 99, 95, 98)]


def created(h, m):
    return datetime(2026, 11, 26, h, m, tzinfo=ca.IST).astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def test_above_fires_on_high():
    hit, p, t = ca.price_hit({"type": "above", "price": 103.5, "created": created(9, 0)}, BARS)
    assert hit and p == 104 and t == ts(9, 20)


def test_below_fires_on_low():
    hit, p, _ = ca.price_hit({"type": "below", "price": 96, "created": created(9, 0)}, BARS)
    assert hit and p == 96


def test_no_fire_when_level_not_reached():
    hit, _, _ = ca.price_hit({"type": "above", "price": 110, "created": created(9, 0)}, BARS)
    assert not hit


def test_candles_before_alert_are_ignored():
    # the 104 high came at 9:20; an alert set at 9:30 must not fire on it
    hit, _, _ = ca.price_hit({"type": "above", "price": 103.5, "created": created(9, 31)}, BARS)
    assert not hit


def test_parse_time_javascript_iso():
    t = ca.parse_time("2026-11-26T04:01:02.345Z")
    assert t.tzinfo is not None and t.hour == 4
    assert ca.parse_time("not a date") is None


def test_money_indian_grouping():
    assert ca.money(1234567.5) == "₹12,34,567.50"
    assert ca.money(999) == "₹999.00"


LATEST = {"data_date": "2026-11-26", "screens": {
    "Base Breakout": [{"symbol": "RUBICON", "close": 1851.7, "rs_rating": 92, "base_state": "Forming"},
                      {"symbol": "ABC", "close": 100, "rs_rating": 70, "base_state": "Climbing"}],
    "VCP": [{"symbol": "XYZ", "close": 50, "rs_rating": 81}]}}
PREV = {"data_date": "2026-11-25", "screens": {"Base Breakout": [{"symbol": "ABC"}], "VCP": []}}


def test_screen_alert_named_screen():
    a = {"id": "1", "type": "screen", "symbol": "RUBICON", "screen": "Base Breakout", "status": "active"}
    hits = ca.screen_hits([a], LATEST, PREV)
    assert len(hits) == 1 and "RUBICON" in hits[0][1] and "Forming" in hits[0][1]
    assert hits[0][2]["status"] == "triggered"


def test_screen_alert_any_screen_and_miss():
    a = {"id": "1", "type": "screen", "symbol": "XYZ", "screen": "any", "status": "active"}
    b = {"id": "2", "type": "screen", "symbol": "NOPE", "screen": "any", "status": "active"}
    hits = ca.screen_hits([a, b], LATEST, PREV)
    assert [h[0]["id"] for h in hits] == ["1"]


def test_triggered_alerts_are_skipped():
    a = {"id": "1", "type": "screen", "symbol": "XYZ", "screen": "any", "status": "triggered"}
    assert ca.screen_hits([a], LATEST, PREV) == []


def test_digest_lists_only_new_stocks_once_per_scan():
    a = {"id": "d", "type": "digest", "symbol": "*", "screen": "Base Breakout", "status": "active"}
    hits = ca.screen_hits([a], LATEST, PREV)
    assert len(hits) == 1 and "RUBICON" in hits[0][1] and "ABC" not in hits[0][1]
    assert hits[0][2] == {"last_sent": "2026-11-26"}
    a["last_sent"] = "2026-11-26"
    assert ca.screen_hits([a], LATEST, PREV) == []


def test_digest_with_nothing_new_sends_nothing():
    a = {"id": "d", "type": "digest", "symbol": "*", "screen": "Base Breakout", "status": "active"}
    same = {"data_date": "2026-11-25", "screens": LATEST["screens"]}
    hits = ca.screen_hits([a], LATEST, same)
    assert len(hits) == 1 and hits[0][1] is None


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for t in tests:
        t()
        print("ok  ", t.__name__)
    print(f"{len(tests)} alert tests passed")
