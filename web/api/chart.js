/* /api/chart?symbol=RELIANCE - a chart for any NSE stock, live from Yahoo Finance.
 *
 * The daily scan writes chart files only for stocks on today's screens. For
 * any other stock the website asks here: about 5 years of daily candles plus
 * the same moving averages, in the format of the scan's chart files (without
 * bases, levels or fundamentals, which come from the scan).
 */
"use strict";
const { send } = require("./_lib");

const SYMBOL = /^[A-Z0-9&_.-]{1,24}$/;
const BARS = 1260;

function sma(c, n) {
  const out = new Array(c.length).fill(null);
  let s = 0;
  for (let i = 0; i < c.length; i++) {
    s += c[i];
    if (i >= n) s -= c[i - n];
    if (i >= n - 1) out[i] = r2(s / n);
  }
  return out;
}
function ema(c, n) {               // like pandas ewm(span=n, adjust=False)
  const a = 2 / (n + 1), out = new Array(c.length).fill(null);
  let e = null;
  for (let i = 0; i < c.length; i++) { e = e == null ? c[i] : a * c[i] + (1 - a) * e; out[i] = r2(e); }
  return out;
}
const r2 = (v) => Math.round(v * 100) / 100;

async function yahoo(sym) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}.NS?range=10y&interval=1d&includePrePost=false&events=div%2Csplit`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; india-base-scanner)", Accept: "application/json" } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Yahoo Finance answered ${r.status}`);
  const j = await r.json();
  const res = j && j.chart && j.chart.result && j.chart.result[0];
  if (!res || !res.timestamp) return null;
  return res;
}

module.exports = async (req, res) => {
  const q = (req.query && req.query.symbol) || new URL(req.url, "http://x").searchParams.get("symbol") || "";
  const sym = String(q).trim().toUpperCase();
  if (!SYMBOL.test(sym)) return send(res, 400, { error: "Not an NSE symbol" });
  let y;
  try { y = await yahoo(sym); }
  catch (e) { return send(res, 502, { error: e.message }); }
  if (!y) return send(res, 404, { error: `Yahoo Finance has no NSE stock called ${sym}` });

  const q0 = y.indicators.quote[0], ts = y.timestamp;
  const off = (y.meta && y.meta.gmtoffset) || 19800;      // IST
  const d = [], o = [], h = [], l = [], c = [], v = [];
  for (let i = 0; i < ts.length; i++) {
    if (q0.close[i] == null || q0.open[i] == null || q0.high[i] == null || q0.low[i] == null) continue;
    const day = new Date((ts[i] + off) * 1000).toISOString().slice(0, 10);
    if (d.length && d[d.length - 1] === day) {           // Yahoo sometimes repeats today's bar
      h[h.length - 1] = Math.max(h[h.length - 1], r2(q0.high[i])); l[l.length - 1] = Math.min(l[l.length - 1], r2(q0.low[i]));
      c[c.length - 1] = r2(q0.close[i]); v[v.length - 1] += q0.volume[i] || 0; continue;
    }
    d.push(day); o.push(r2(q0.open[i])); h.push(r2(q0.high[i])); l.push(r2(q0.low[i])); c.push(r2(q0.close[i])); v.push(q0.volume[i] || 0);
  }
  if (c.length < 2) return send(res, 404, { error: `Not enough price history for ${sym}` });
  const s10 = sma(c, 10), s50 = sma(c, 50), s150 = sma(c, 150), s200 = sma(c, 200), e50 = ema(c, 50);
  const k = Math.max(0, c.length - BARS), tail = (a) => a.slice(k);
  const last = Math.max(0, c.length - 252);
  const payload = {
    symbol: sym,
    d: tail(d), o: tail(o), h: tail(h), l: tail(l), c: tail(c), v: tail(v),
    sma10: tail(s10), sma50: tail(s50), sma150: tail(s150), sma200: tail(s200), ema50: tail(e50),
    rs: null, levels: [], bases: [], screens: [],
    hi52: r2(Math.max(...h.slice(last))), lo52: r2(Math.min(...l.slice(last))),
    fund: { name: (y.meta && (y.meta.longName || y.meta.shortName)) || "" },
    source: "yahoo-live",
  };
  // an hour on Vercel's cache; candles only change once a day after the close
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");
  return send(res, 200, payload);
};
