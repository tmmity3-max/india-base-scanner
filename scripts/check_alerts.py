"""Check the website's alerts and send Telegram messages.

The alerts live in alerts.json on the repo's `alerts` branch (the website
writes them through /api/alerts). Two modes:

  --mode price   price alerts (goes above / goes below), every 15 minutes
                 while NSE is open, from Yahoo Finance's 5-minute candles
  --mode scan    screen alerts, after the daily scan, from its latest.json

A price alert fires when any 5-minute candle after the alert was set (or
re-armed) reaches the level, so a move between two checks is not missed.
It then turns to "triggered" and stays quiet until re-armed on the website.
A "daily list" alert stays active and sends the stocks that are new on its
screen each day.

Environment: GITHUB_TOKEN, GITHUB_REPOSITORY (set by GitHub Actions),
TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, optional SITE_URL and ALERTS_BRANCH.
Standard library only, so the workflow needs no pip install.
"""
import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))
BRANCH = os.environ.get("ALERTS_BRANCH", "alerts")
SITE = (os.environ.get("SITE_URL") or "https://india-base-scanner-web.vercel.app").rstrip("/")
UA = "Mozilla/5.0 (compatible; india-base-scanner-alerts)"


# ---------------------------------------------------------------- helpers
def _req(method, url, body=None, headers=None, timeout=30):
    data = json.dumps(body).encode() if body is not None else None
    h = {"User-Agent": UA, **(headers or {})}
    if data is not None:
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            return r.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except Exception:
            return e.code, {}


def parse_time(iso):
    """ISO time from JavaScript (2026-11-26T09:41:12.345Z) -> aware datetime."""
    if not iso:
        return None
    try:
        t = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def money(v):
    """Indian grouping: 1,23,456.70"""
    neg, v = v < 0, abs(float(v))
    whole, frac = f"{v:.2f}".split(".")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        whole = ",".join(parts + [tail])
    return ("-" if neg else "") + "₹" + whole + "." + frac


def esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


# ---------------------------------------------------------------- GitHub
class Store:
    def __init__(self):
        self.repo = os.environ.get("GITHUB_REPOSITORY", "tmmity3-max/india-base-scanner")
        self.token = os.environ.get("GITHUB_TOKEN", "")
        self.base = f"https://api.github.com/repos/{self.repo}/contents/alerts.json"

    def _h(self):
        return {"Authorization": f"Bearer {self.token}", "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28"}

    def read(self):
        st, j = _req("GET", f"{self.base}?ref={urllib.parse.quote(BRANCH)}", headers=self._h())
        if st == 404:
            return None, None
        if st != 200:
            raise RuntimeError(f"GitHub answered {st} reading alerts.json")
        data = json.loads(base64.b64decode(j.get("content") or b"e30=").decode() or "{}")
        if not isinstance(data.get("alerts"), list):
            data["alerts"] = []
        return data, j.get("sha")

    def write(self, data, sha, message):
        body = {"message": message, "branch": BRANCH, "sha": sha,
                "content": base64.b64encode((json.dumps(data, indent=1, ensure_ascii=False) + "\n").encode()).decode()}
        st, _ = _req("PUT", self.base, body=body, headers=self._h())
        if st in (409, 422):
            return False
        if st not in (200, 201):
            raise RuntimeError(f"GitHub answered {st} saving alerts.json")
        return True

    def apply(self, updates, message):
        """updates: {id: {field: value}}; re-read and retry if the website saved meanwhile."""
        if not updates:
            return
        for _ in range(4):
            data, sha = self.read()
            if data is None:
                return
            for a in data["alerts"]:
                if a.get("id") in updates:
                    a.update(updates[a["id"]])
            if self.write(data, sha, message):
                return
            time.sleep(1.5)
        print("Could not save the alert changes (the file kept changing); they will be sent again next time.")


# ---------------------------------------------------------------- Telegram
def telegram(text):
    token, chat = os.environ.get("TELEGRAM_BOT_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chat:
        raise RuntimeError("TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID secrets are not set")
    st, j = _req("POST", f"https://api.telegram.org/bot{token}/sendMessage",
                 body={"chat_id": chat, "text": text, "parse_mode": "HTML", "disable_web_page_preview": True})
    if st != 200:
        raise RuntimeError(f"Telegram refused the message ({st}): {j.get('description', '')}")


def stock_link(sym):
    return f'<a href="{SITE}/#stock={urllib.parse.quote(sym)}">Open the chart</a>'


# ---------------------------------------------------------------- price alerts
def yahoo_bars(sym):
    """5-minute candles of the last 5 sessions: list of (unix time, high, low, close)."""
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}.NS"
           "?range=5d&interval=5m&includePrePost=false")
    st, j = _req("GET", url, headers={"Accept": "application/json"})
    if st != 200:
        return None
    try:
        res = j["chart"]["result"][0]
        q = res["indicators"]["quote"][0]
        out = []
        for t, h, lo, c in zip(res["timestamp"], q["high"], q["low"], q["close"]):
            if h is not None and lo is not None and c is not None:
                out.append((int(t), float(h), float(lo), float(c)))
        return out
    except (KeyError, IndexError, TypeError):
        return None


def price_hit(alert, bars):
    """Did a candle after the alert was set reach its level? -> (hit, price, unix time).

    For "above" the price is the candle's high, for "below" its low. A candle
    is counted when it closed after the alert was set (5-minute candles are
    stamped at their start).
    """
    since = parse_time(alert.get("created"))
    t0 = since.timestamp() - 300 if since else 0
    level = float(alert["price"])
    for t, h, lo, _c in bars:
        if t < t0:
            continue
        if alert["type"] == "above" and h >= level:
            return True, h, t
        if alert["type"] == "below" and lo <= level:
            return True, lo, t
    return False, None, None


def price_message(alert, hit_price, t, last):
    word = "went above" if alert["type"] == "above" else "went below"
    when = datetime.fromtimestamp(t, IST).strftime("%d %b %H:%M IST")
    lines = [f"🔔 <b>{esc(alert['symbol'])}</b> {word} {money(alert['price'])}",
             f"{'High' if alert['type'] == 'above' else 'Low'} {money(hit_price)} in the candle of {when}; last {money(last)}"]
    if alert.get("note"):
        lines.append(f"Note: {esc(alert['note'])}")
    lines.append(stock_link(alert["symbol"]))
    return "\n".join(lines)


def run_price(store, dry=False):
    data, _ = store.read()
    if not data:
        print("No alerts list yet.")
        return 0
    todo = [a for a in data["alerts"] if a.get("status") != "triggered" and a.get("type") in ("above", "below")]
    print(f"{len(todo)} active price alerts")
    if not todo:
        return 0
    bars_of, updates, sent = {}, {}, 0
    for a in todo:
        sym = a["symbol"]
        if sym not in bars_of:
            bars_of[sym] = yahoo_bars(sym)
            time.sleep(0.3)
        bars = bars_of[sym]
        if not bars:
            print(f"  {sym}: no intraday data from Yahoo")
            continue
        hit, p, t = price_hit(a, bars)
        if not hit:
            continue
        msg = price_message(a, p, t, bars[-1][3])
        print(f"  {sym}: {a['type']} {a['price']} hit at {p}")
        if dry:
            print(msg)
            continue
        try:
            telegram(msg)
        except RuntimeError as e:
            print("  ", e)
            continue                                   # not marked: tried again next run
        sent += 1
        updates[a["id"]] = {"status": "triggered", "triggered_price": round(p, 2),
                            "triggered_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    store.apply(updates, f"Alerts sent: {', '.join(sorted({a['symbol'] for a in todo if a['id'] in updates}))}")
    print(f"Sent {sent} alerts")
    return sent


# ---------------------------------------------------------------- screen alerts
def screen_symbols(latest, screen):
    screens = (latest or {}).get("screens") or {}
    names = list(screens) if screen in (None, "", "any") else [screen]
    out = {}
    for n in names:
        for r in screens.get(n) or []:
            out.setdefault(r.get("symbol"), []).append((n, r))
    return out


def screen_hits(alerts, latest, prev):
    """-> list of (alert, message, update) for screen and daily-list alerts."""
    out = []
    date = (latest or {}).get("data_date") or ""
    for a in alerts:
        if a.get("status") == "triggered":
            continue
        if a.get("type") == "screen":
            on = screen_symbols(latest, a.get("screen")).get(a.get("symbol"))
            if not on:
                continue
            where = ", ".join(sorted({n for n, _ in on}))
            r = on[0][1]
            bits = [f"close {money(r['close'])}" if r.get("close") is not None else "",
                    f"RS {r['rs_rating']:.0f}" if r.get("rs_rating") is not None else ""]
            stage = next((r.get(k) for k in ("base_state", "pb_stage", "ich_signal", "murphy_signal", "ep_type") if r.get(k)), "")
            lines = [f"📋 <b>{esc(a['symbol'])}</b> is on {esc(where)}{' (' + esc(stage) + ')' if stage else ''}",
                     ", ".join(b for b in bits if b) + f" · scan of {date}"]
            if a.get("note"):
                lines.append(f"Note: {esc(a['note'])}")
            lines.append(stock_link(a["symbol"]))
            out.append((a, "\n".join(l for l in lines if l),
                        {"status": "triggered", "triggered_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                         "triggered_price": r.get("close")}))
        elif a.get("type") == "digest":
            if a.get("last_sent") == date:
                continue                                   # already sent for this scan
            now = screen_symbols(latest, a.get("screen"))
            before = screen_symbols(prev, a.get("screen")) if prev and prev.get("data_date") != date else {}
            new = sorted(s for s in now if s and s not in before)
            label = "any screen" if a.get("screen") in (None, "", "any") else a["screen"]
            if not new:
                out.append((a, None, {"last_sent": date}))
                continue
            rows = []
            for s in new[:40]:
                r = now[s][0][1]
                rows.append(f"• <b>{esc(s)}</b> {money(r['close']) if r.get('close') is not None else ''}"
                            + (f" · RS {r['rs_rating']:.0f}" if r.get("rs_rating") is not None else ""))
            more = f"\n…and {len(new) - 40} more" if len(new) > 40 else ""
            text = f"🆕 New on {esc(label)} after the scan of {date}: {len(new)}\n" + "\n".join(rows) + more + f'\n<a href="{SITE}/">Open the site</a>'
            out.append((a, text, {"last_sent": date}))
    return out


def run_scan(store, latest_path, prev_path, dry=False):
    data, _ = store.read()
    if not data:
        print("No alerts list yet.")
        return 0
    with open(latest_path, encoding="utf-8") as fh:
        latest = json.load(fh)
    prev = None
    if prev_path and os.path.exists(prev_path):
        try:
            with open(prev_path, encoding="utf-8") as fh:
                prev = json.load(fh)
        except Exception:
            prev = None
    hits = screen_hits(data["alerts"], latest, prev)
    updates, sent = {}, 0
    for a, msg, upd in hits:
        if msg:
            if dry:
                print(msg)
            else:
                try:
                    telegram(msg)
                except RuntimeError as e:
                    print("  ", e)
                    continue
            sent += 1
        updates[a["id"]] = upd
    if not dry:
        store.apply(updates, f"Screen alerts after the scan of {latest.get('data_date')}")
    print(f"Sent {sent} screen alerts")
    return sent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=("price", "scan"), default="price")
    ap.add_argument("--latest", default="out/latest.json")
    ap.add_argument("--prev", default="")
    ap.add_argument("--dry-run", action="store_true", help="print the messages instead of sending them")
    args = ap.parse_args()
    store = Store()
    if not store.token:
        sys.exit("GITHUB_TOKEN is not set")
    if args.mode == "price":
        run_price(store, args.dry_run)
    else:
        run_scan(store, args.latest, args.prev, args.dry_run)


if __name__ == "__main__":
    main()
