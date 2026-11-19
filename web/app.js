/* India Base Scanner - website
 *
 * Reads latest.json and charts/<SYMBOL>.json from the repo's `data` branch
 * (published daily by GitHub Actions). No framework, no chart library.
 */
(() => {
  "use strict";

  const REPO_DATA = "https://raw.githubusercontent.com/tmmity3-max/india-base-scanner/data/";
  const LOCAL = /^(localhost|127\.|\[::1\])/.test(location.hostname);
  let DATA = LOCAL ? "data/" : REPO_DATA;   // replaced in init() by the current data commit

  const SCREENS = {
    "VCP": "Tightening pullbacks with volume drying up, close to the pivot. Sorted by RS rating.",
    "Blue Sky": "At or breaking out to an all-time high, with strong relative strength.",
    "Murphy": "John Murphy's trend-following: above a rising 40-week SMA, with a fresh 10/50 crossover, 4-week-rule breakout or crossover + 2-week breakout in the last 5 sessions. Newest signals first.",
    "Base Breakout": "Numbered bases with a pivot: at least 3 weeks below a high with a 5–35% pullback. Pick a stage: forming, fresh breakout, climbing or played out. RS 65 or more.",
    "Ichimoku": "Adaptive Ichimoku: a bullish signal in the last 5 sessions (a scored Tenkan/Kijun cross, a cloud breakout on volume, or a retest of the cloud) with nothing bearish since. Newest first.",
    "50 EMA Pullback": "Leaders resting on their 50-day EMA: RS 80 or more, in an uptrend, ran at least 8% above the EMA in the last 40 sessions and now back within 3% of it. Strongest RS first.",
    "Episodic Pivot": "Pradeep Bonde's EP: in the last month the stock gapped up or made a well above-average move on at least 3× its usual volume (earnings or other news), and is still above that day's low. Newest first, heaviest volume first.",
    "ATR Entry": "The green circle of the RS Line + Buy Signals indicator: the first close at least 2 ATR above the 70-day SMA, with +DI above −DI, the RS line above its 50-day average and no more than 7 ATR above the 50-day SMA. Signals in the last 5 sessions, newest first.",
    "IPO Base": "Recent listings basing just under their post-listing high.",
    "Trend Template": "Every liquid stock in a Stage-2 uptrend with RS 70 or more. The pool the VCP screen draws from.",
  };
  const ORDER = ["VCP", "Blue Sky", "Murphy", "Base Breakout", "50 EMA Pullback", "Ichimoku", "Episodic Pivot", "ATR Entry", "IPO Base", "Trend Template"];

  // Stages: each screen splits into a few groups. `of` names a row's stage,
  // `list` is the order the cards appear in, with a one-line note for each.
  const STAGES = {
    "Base Breakout": {
      of: (r) => r.base_state,
      list: [["Forming", "resting under the pivot"], ["Fresh breakout", "cleared the pivot in the last 5 sessions"],
             ["Climbing", "broke out earlier and still holding"], ["Played out", "the breakout failed: closed back under the pivot"]],
    },
    "VCP": {
      of: (r) => (r.vcp_pct_from_pivot > 0 ? "Breaking out" : "Setting up"),
      list: [["Setting up", "tight, just under the pivot"], ["Breaking out", "already above the pivot"]],
    },
    "Blue Sky": {
      of: (r) => (r.new_ath_recent ? "New high this week" : "Just under the high"),
      list: [["New high this week", "made an all-time high in the last 5 sessions"], ["Just under the high", "within 3% of the all-time high"]],
    },
    "Murphy": {
      of: (r) => (r.murphy_days_ago === 0 ? "Signal today" : r.murphy_days_ago <= 2 ? "1–2 sessions ago" : "3–5 sessions ago"),
      list: [["Signal today", "entry signal on the latest bar"], ["1–2 sessions ago", "still close to the entry"], ["3–5 sessions ago", "check how far it has moved"]],
    },
    "Ichimoku": {
      of: (r) => r.ich_signal,
      list: [["TK cross", "Tenkan crossed above Kijun with a score of 50+"], ["Cloud breakout", "closed up through the cloud on volume"],
             ["Cloud retest", "came back to the cloud edge and held"]],
    },
    "50 EMA Pullback": {
      of: (r) => r.pb_stage,
      list: [["At the 50 EMA", "touching it, or within 1%"], ["Bouncing", "touched it and closed above yesterday's high"],
             ["Approaching", "within 3% and still coming down"]],
    },
    "Episodic Pivot": {
      of: (r) => (r.ep_days_ago === 0 ? "Today" : r.ep_days_ago <= 4 ? "This week" : "This month"),
      list: [["Today", "the EP day is the latest bar"], ["This week", "EP day in the last 5 sessions, still holding"],
             ["This month", "EP day in the last month, still above its low"]],
    },
    "ATR Entry": {
      of: (r) => (r.atr_days_ago === 0 ? "Signal today" : r.atr_days_ago <= 2 ? "1–2 sessions ago" : "3–5 sessions ago"),
      list: [["Signal today", "first close above the entry line"], ["1–2 sessions ago", "still close to the entry"], ["3–5 sessions ago", "check how far it has moved"]],
    },
    "IPO Base": {
      of: (r) => (r.ipo_pct_from_high >= 0 ? "Above the listing high" : "Under the listing high"),
      list: [["Under the listing high", "still basing"], ["Above the listing high", "breaking out"]],
    },
    "Trend Template": {
      of: (r) => (r.rs_rating >= 90 ? "RS 90+" : r.rs_rating >= 80 ? "RS 80–89" : "RS 70–79"),
      list: [["RS 90+", "the top tenth"], ["RS 80–89", "strong"], ["RS 70–79", "above average"]],
    },
  };
  // The chart shows only the key level of the screen you are on, so the lines don't pile up.
  const SCREEN_LEVEL = {
    "VCP": "VCP pivot", "Blue Sky": "All-time high", "Murphy": "Murphy entry",
    "Episodic Pivot": "EP day low", "ATR Entry": "ATR entry line", "IPO Base": "IPO high",
  };
  // Filters that apply to every screen: [key, label, test(row, value)]
  const FILTERS = [
    ["rs", "RS rating at least", (r, v) => r.rs_rating != null && r.rs_rating >= v],
    ["mcap", "Market cap at least (₹ cr)", (r, v) => r.market_cap_cr != null && r.market_cap_cr >= v],
    ["turnover", "Daily turnover at least (₹ cr)", (r, v) => r.turnover_cr != null && r.turnover_cr >= v],
    ["price", "Price at least (₹)", (r, v) => r.close != null && r.close >= v],
    ["near", "Within % of 52-week high", (r, v) => r.pct_from_52w_high != null && -r.pct_from_52w_high <= v],
  ];
  const FKEY = "ibs-filters";
  // Filters are kept separately for each screen: { "VCP": {rs: 80}, "Murphy": {...} }
  function loadFilters() {
    let all = {};
    try { all = JSON.parse(localStorage.getItem(FKEY) || "{}") || {}; } catch (e) { return {}; }
    const old = FILTERS.some(([k]) => k in all) || "rsHigh" in all;   // the earlier one-for-all format
    return old ? {} : all;
  }
  function saveFilters() {
    try { localStorage.setItem(FKEY, JSON.stringify(state.filtersAll)); } catch (e) { /* private window */ }
  }
  const filtersFor = (screen) => state.filtersAll[screen] || {};
  function passes(r, f) {
    for (const [key, , test] of FILTERS) if (f[key] != null && !test(r, f[key])) return false;
    if (f.rsHigh && r.rs_line_new_high !== undefined && !r.rs_line_new_high) return false;
    return true;
  }
  const activeFilters = (f = filtersFor(state.screen)) => FILTERS.filter(([k]) => f[k] != null).length + (f.rsHigh ? 1 : 0);
  const screenRows = (name) => { const f = filtersFor(name); return (state.data.screens[name] || []).filter((r) => passes(r, f)); };

  // column: [label, kind]  kind: txt | num | pct | signed | x | bool | int
  const COLS = {
    symbol: ["Stock", "txt"], industry: ["Industry", "txt"],
    close: ["Close ₹", "num"], "chg_1d_%": ["Day %", "signed"],
    rs_rating: ["RS", "int"], rs_line_new_high: ["RS line high", "bool"],
    pct_from_52w_high: ["From 52w high %", "signed"], pct_above_52w_low: ["Above 52w low %", "signed"],
    market_cap_cr: ["M.cap ₹ cr", "int"],
    vol_ratio: ["Volume ×", "x"], turnover_cr: ["Turnover ₹ cr", "num"],
    vcp_pivot: ["Pivot ₹", "num"], vcp_pct_from_pivot: ["From pivot %", "signed"],
    vcp_contractions: ["Pullbacks", "int"], vcp_depths: ["Pullback depths", "txt"],
    vcp_base_days: ["Base days", "int"], vol_dryup: ["Vol dry-up ×", "x"],
    ath: ["All-time high ₹", "num"], pct_from_ath: ["From ATH %", "signed"],
    new_ath_recent: ["New ATH this week", "bool"],
    ep_date: ["EP day", "txt"], ep_days_ago: ["Days ago", "int"], ep_type: ["Type", "txt"],
    ep_catalyst: ["Catalyst", "txt"], ep_gap: ["Gap %", "signed"], ep_chg: ["EP day %", "signed"],
    ep_rvol: ["Volume ×", "x"], ep_low: ["EP day low ₹", "num"], ep_pct_since: ["Since EP close %", "signed"],
    ep_neglected: ["Neglected before", "bool"],
    atr_signal_date: ["Signal date", "txt"], atr_days_ago: ["Days ago", "int"], atr_line: ["Entry line ₹", "num"],
    atr_pct_from_line: ["From line %", "signed"], atr_in_zone: ["Above line now", "bool"], atr_ext: ["ATRs over 50 SMA", "num"],
    listed_days: ["Days listed", "int"], ipo_high: ["Listing high ₹", "num"],
    ipo_pct_from_high: ["From high %", "signed"], ipo_base_days: ["Base days", "int"],
    ipo_depth: ["Base depth %", "pct"],
    murphy_signal: ["Signal", "txt"], murphy_signal_date: ["Signal date", "txt"],
    murphy_days_ago: ["Days ago", "int"], murphy_entry: ["Entry ₹", "num"],
    murphy_pct_from_entry: ["From entry %", "signed"],
    murphy_sma40w: ["40-week SMA ₹", "num"], murphy_weekly_macd_ok: ["Weekly MACD > signal", "bool"],
    adx14: ["ADX", "num"], murphy_rs_score: ["RS score vs index %", "signed"],
    base_state: ["State", "txt"], base_no: ["Base no.", "int"],
    base_pivot: ["Pivot ₹", "num"], base_pct_from_pivot: ["From pivot %", "signed"],
    base_weeks: ["Base weeks", "num"], base_depth: ["Base depth %", "pct"],
    base_tags: ["Tags", "txt"], base_days_ago: ["Breakout days ago", "int"],
    pb_stage: ["Stage", "txt"], pb_ema50: ["50 EMA ₹", "num"], pb_pct_from_ema: ["From 50 EMA %", "signed"],
    pb_days_since_touch: ["Days since touch", "int"], pb_from_high: ["Off recent high %", "signed"],
    ich_signal: ["Signal", "txt"], ich_days_ago: ["Days ago", "int"], ich_score: ["Score", "int"],
    ich_trend: ["Trend", "txt"], ich_momentum: ["Momentum", "txt"], ich_cloud: ["Price vs cloud", "txt"],
    ich_entry: ["Entry ₹", "num"], ich_sl: ["Stop ₹", "num"], ich_tp1: ["Target 1 ₹", "num"],
  };

  const $ = (id) => document.getElementById(id);
  const state = { data: null, screen: "VCP", sort: null, dir: -1, query: "", symbol: null, view: "table", perRow: 2,
                  stage: null, filters: {}, showBases: true, page: 0, perPage: 20, listKey: "" };
  state.filtersAll = loadFilters();
  state.draft = {};                                         // edits in the open filter box, applied on Apply
  try { state.showBases = localStorage.getItem("ibs-bases") !== "0"; } catch (e) { /* private window */ }
  const chartCache = new Map();

  // ---------- formatting ----------
  const nf2 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  const nf0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
  function fmt(v, kind) {
    if (v === null || v === undefined || v === "") return ["–", "dim"];
    switch (kind) {
      case "txt": return [String(v), ""];
      case "int": return [nf0.format(v), ""];
      case "num": case "pct": return [nf2.format(v), ""];
      case "x": return [nf2.format(v) + "×", v >= 1.5 ? "pos" : ""];
      case "signed": return [(v > 0 ? "+" : "") + nf2.format(v), v > 0 ? "pos" : v < 0 ? "neg" : ""];
      case "bool": return v ? ["Yes", "yes"] : ["–", "dim"];
      default: return [String(v), ""];
    }
  }
  const signed = (v) => (v > 0 ? "+" : "") + nf2.format(v);
  const nf1 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  function mcapText(cr) {
    if (cr == null) return "";
    if (cr >= 100000) return `₹${nf2.format(cr / 100000)} lakh cr`;
    return `₹${nf0.format(cr)} cr`;
  }
  function hiLoText(r) {
    const bits = [];
    if (r.pct_from_52w_high != null) bits.push(`${signed(r.pct_from_52w_high)}% from 52w high`);
    if (r.pct_above_52w_low != null) bits.push(`${signed(r.pct_above_52w_low)}% above 52w low`);
    return bits.join(", ");
  }
  const longDate = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN",
    { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const pretty = (u) => (u || "").replace(/^NIFTY(\d+)$/, "NIFTY $1").replace("ALL_EQ", "all NSE stocks");
  const timeOf = (iso) => {
    const t = new Date(iso);
    return isNaN(t) ? iso : t.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) + " IST";
  };
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  // ---------- URL state ----------
  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    if (p.get("screen") && SCREENS[p.get("screen")]) state.screen = p.get("screen");
    if (p.get("stock")) state.symbol = p.get("stock").toUpperCase();
    if (p.get("view") === "charts") state.view = "charts";
  }
  function writeHash() {
    const p = new URLSearchParams({ screen: state.screen });
    if (state.view === "charts") p.set("view", "charts");
    else if (state.symbol) p.set("stock", state.symbol);
    history.replaceState(null, "", "#" + p.toString());
  }

  // ---------- RS line against the benchmark chosen in Settings ----------
  const SETTINGS = window.ibsSettings ? window.ibsSettings() : { rsBench: "NIFTY500", rsMa: 50, rsHi: 250, showRsMa: true, showRsDots: true };
  let BENCH = null;                    // { d: [...dates], c: [...closes] } for the chosen index
  async function loadBenchmark() {
    try {
      const r = await fetch(`${DATA}benchmarks.json`);
      if (!r.ok) throw new Error(r.status);
      const all = await r.json();
      const b = all[SETTINGS.rsBench] || all.NIFTY500 || all.NIFTY50;
      if (b) BENCH = { map: new Map(b.d.map((d, i) => [d, b.c[i]])), name: (window.IBS_BENCH_NAMES || {})[all[SETTINGS.rsBench] ? SETTINGS.rsBench : "NIFTY500"] || "" };
    } catch (e) { BENCH = null; }   // no benchmark file yet: charts use the scan's RS line
  }
  function withRS(c) {
    if (!BENCH || c.rsv !== undefined) return c;
    const n = c.c.length, rsv = new Array(n).fill(null);
    let last = null;
    for (let i = 0; i < n; i++) {
      const b = BENCH.map.get(c.d[i]);
      if (b) last = b;
      if (last) rsv[i] = (c.c[i] / last) * 100;
    }
    if (rsv.filter((v) => v != null).length < 20) { c.rsv = null; return c; }
    const L = SETTINGS.rsMa, H = SETTINGS.rsHi;
    const rsma = new Array(n).fill(null), rshi = new Array(n).fill(false), rslead = new Array(n).fill(false);
    let sum = 0, cnt = 0;
    for (let i = 0; i < n; i++) {
      if (rsv[i] != null) { sum += rsv[i]; cnt++; }
      if (i >= L && rsv[i - L] != null) { sum -= rsv[i - L]; cnt--; }
      if (i >= L - 1 && cnt === L) rsma[i] = sum / L;
      if (i >= H - 1 && rsv[i] != null) {
        let mx = -Infinity, pmx = -Infinity;
        for (let j = i - H + 1; j <= i; j++) { if (rsv[j] != null) mx = Math.max(mx, rsv[j]); pmx = Math.max(pmx, c.c[j]); }
        rshi[i] = rsv[i] >= mx;
        rslead[i] = rshi[i] && c.c[i] < pmx;       // RS leads price: RS at a high, price isn't yet
      }
    }
    Object.assign(c, { rsv, rsma, rshi, rslead, rsName: BENCH.name });
    return c;
  }

  function setChartType(t) {
    SETTINGS.chartType = t;
    if (window.ibsSaveSettings) window.ibsSaveSettings({ ...window.ibsSettings(), chartType: t });
    for (const b of document.querySelectorAll("[data-chart-type]")) b.setAttribute("aria-pressed", b.dataset.chartType === t ? "true" : "false");
    mainChart.draw();
    for (const pc of gridCharts) pc.draw();
  }
  const gridCharts = new Set();

  // Make the table end exactly where the chart panel ends (side-by-side layout only).
  function syncHeights() {
    const wrap = document.querySelector(".table-wrap"), panel = $("chartPanel");
    if (!wrap || !panel) return;
    const sideBySide = window.matchMedia("(min-width: 1081px)").matches && !$("workspace").hidden;
    // side by side, CSS makes the table and the chart panel the screen's height
    wrap.style.height = ""; wrap.style.maxHeight = sideBySide ? "none" : "";
    requestAnimationFrame(fitRows);
  }
  // shadow on the table's right edge while columns are hidden past it
  function edgeHint() {
    const wrap = document.querySelector(".table-wrap"), list = document.querySelector(".list");
    if (!wrap || !list) return;
    const more = wrap.scrollWidth - wrap.clientWidth - wrap.scrollLeft > 4;
    list.classList.toggle("more-right", more);
    list.style.setProperty("--wrap-h", `${wrap.offsetHeight - 2}px`);
  }
  document.querySelector(".table-wrap").addEventListener("scroll", edgeHint, { passive: true });
  new ResizeObserver(edgeHint).observe(document.querySelector(".table-wrap"));
  new ResizeObserver(edgeHint).observe($("table"));
  new ResizeObserver(syncHeights).observe($("chartPanel"));
  window.addEventListener("resize", syncHeights);

  // Drag handles: the bar between the table and the chart sets the chart
  // panel's width, the bar under the chart sets its height. Both are kept in
  // this browser; double-click a bar to go back to the default size.
  (function resizers() {
    const ws = $("workspace"), split = $("splitter"), grip = $("chartResize"), canvas = $("chart");
    if (!ws || !split || !grip || !canvas) return;
    const load = (k) => { try { return +localStorage.getItem(k) || 0; } catch (e) { return 0; } };
    const save = (k, v) => { try { v ? localStorage.setItem(k, String(Math.round(v))) : localStorage.removeItem(k); } catch (e) { /* private window */ } };
    const setW = (w) => {
      if (!w) { ws.style.removeProperty("--chart-w"); return; }
      const max = Math.max(360, ws.clientWidth - 400);     // the table keeps at least ~400px
      ws.style.setProperty("--chart-w", `${Math.round(Math.min(Math.max(w, 360), max))}px`);
    };
    const wide = () => window.matchMedia("(min-width: 1081px)").matches;   // side-by-side layout only
    // the chart can grow only while it still fits on the screen with the table beside it
    const maxH = () => { const pn = $("chartPanel");
      return Math.max(260, pn.clientHeight - (canvas.getBoundingClientRect().top - pn.getBoundingClientRect().top + pn.scrollTop) - 60); };
    const setH = (h) => { canvas.style.height = h && wide() ? `${Math.round(Math.min(Math.max(h, 260), maxH()))}px` : ""; };
    setW(load("ibs-chart-w")); setH(load("ibs-chart-h"));

    function drag(el, onMove, onEnd) {
      el.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault(); el.setPointerCapture(e.pointerId);
        el.classList.add("dragging"); document.body.classList.add("resizing");
        const move = (ev) => onMove(ev);
        const up = () => {
          el.classList.remove("dragging"); document.body.classList.remove("resizing");
          el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up);
          onEnd();
        };
        el.addEventListener("pointermove", move); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
      });
    }
    const panel = $("chartPanel");
    drag(split, (e) => setW(ws.getBoundingClientRect().right - e.clientX - 7), () => save("ibs-chart-w", panel.offsetWidth));
    drag(grip, (e) => setH(e.clientY - canvas.getBoundingClientRect().top), () => save("ibs-chart-h", canvas.offsetHeight));
    split.addEventListener("dblclick", () => { setW(0); save("ibs-chart-w", 0); });
    grip.addEventListener("dblclick", () => { setH(0); save("ibs-chart-h", 0); });
    // keyboard: arrow keys nudge by 40px
    split.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault(); setW(panel.offsetWidth + (e.key === "ArrowLeft" ? 40 : -40)); save("ibs-chart-w", panel.offsetWidth);
    });
    grip.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault(); setH(canvas.offsetHeight + (e.key === "ArrowDown" ? 40 : -40)); save("ibs-chart-h", canvas.offsetHeight);
    });
    window.addEventListener("resize", () => { setW(load("ibs-chart-w")); setH(load("ibs-chart-h")); });
  })();

  async function loadChart(sym) {
    if (chartCache.has(sym)) return chartCache.get(sym);
    const v = state.data ? state.data.data_date : "";
    const p = fetch(`${DATA}charts/${encodeURIComponent(sym)}.json?v=${v}`)
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(withRS);
    chartCache.set(sym, p);
    p.catch(() => chartCache.delete(sym));
    return p;
  }

  // =====================================================================
  // Ichimoku view. The scan sends the adaptive lines, the signals, the Kijun
  // support/resistance zones and the tracked setup in `c.ich`. Without it (an
  // older data file) the classic 9 / 26 / 52 lines are worked out here, with no
  // signals. The cloud is shifted forward and the Chikou span shifted back.
  function computeIchimoku(c) {
    const n = c.c.length, src = c.ich || null, shift = src ? src.shift : 25;
    let tenkan, kijun, sa, sb;
    if (src) {
      // the scan sends these lines for its last ~700 bars only; line them up
      // with the end of the chart (which holds up to 5 years) by padding the front
      const pad = (a) => (a.length < n ? new Array(n - a.length).fill(null).concat(a) : a.slice(a.length - n));
      tenkan = pad(src.tenkan); kijun = pad(src.kijun); sa = pad(src.spanA); sb = pad(src.spanB);
    } else {
      const mid = (k) => {
        const out = new Array(n).fill(null);
        for (let i = k - 1; i < n; i++) {
          let hi = -Infinity, lo = Infinity;
          for (let j = i - k + 1; j <= i; j++) { if (c.h[j] > hi) hi = c.h[j]; if (c.l[j] < lo) lo = c.l[j]; }
          out[i] = (hi + lo) / 2;
        }
        return out;
      };
      tenkan = mid(9); kijun = mid(26); sb = mid(52);
      sa = tenkan.map((t, i) => (t != null && kijun[i] != null ? (t + kijun[i]) / 2 : null));
    }
    const cloudA = new Array(n + shift).fill(null), cloudB = new Array(n + shift).fill(null);
    const chikou = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      if (sa[i] != null) cloudA[i + shift] = sa[i];
      if (sb[i] != null) cloudB[i + shift] = sb[i];
      if (i + shift < n) chikou[i] = c.c[i + shift];
    }
    const at = new Map(c.d.map((d, i) => [d, i]));
    const idx = (d) => (at.has(d) ? at.get(d) : null);
    const events = [], zones = [];
    for (const e of (src && src.events) || []) { const i = idx(e.d); if (i != null) events.push({ ...e, i }); }
    for (const z of (src && src.zones) || []) {
      const i1 = idx(z.e);
      if (i1 != null) zones.push({ ...z, i0: idx(z.s) == null ? 0 : idx(z.s), i1 });
    }
    let trade = null;
    if (src && src.trade && idx(src.trade.d) != null) {
      trade = { ...src.trade, i: idx(src.trade.d), iEnd: src.trade.end ? idx(src.trade.end) : null };
    }
    return { shift, tenkan, kijun, cloudA, cloudB, chikou, events, zones, trade,
             info: src ? { trend: src.trend, momentum: src.momentum, score: src.score, stats: src.stats } : null };
  }
  // Ichimoku colours, brighter on a dark page and deeper on a light one
  function ichColors() {
    const m = /^#?([0-9a-f]{2})/i.exec(css("--paper").trim());
    const dark = m ? parseInt(m[1], 16) < 128 : false;
    return dark
      ? { bull: "#00E676", bear: "#FF5252", tenkan: "#5B8CFF", kijun: "#F06292", chikou: "#FF9800", brk: "#00BCD4", div: "#AB47BC", twist: "#FFD54F",
          entry: "#5C8AAE", sl: "#E57373", tp: "#66BB6A", hit: "#4DB6AC", tagText: "#1A1A1A" }
      : { bull: "#00A152", bear: "#D32F2F", tenkan: "#2962FF", kijun: "#E91E63", chikou: "#F57C00", brk: "#0097A7", div: "#8E24AA", twist: "#F9A825",
          entry: "#34495E", sl: "#B71C1C", tp: "#388E3C", hit: "#00695C", tagText: "#FFFFFF" };
  }

  // Chart: candles, SMAs or Ichimoku, key levels, volume, RS line, with zoom and pan
  // =====================================================================
  class PriceChart {
    constructor(canvas, opts = {}) {
      this.cv = canvas;
      this.ctx = canvas.getContext("2d");
      this.mini = !!opts.mini;
      this.readout = opts.readout || null;
      this.onScale = opts.onScale || null;   // called when auto/log changes
      this.c = null;
      this.hover = -1; this.hoverY = -1;
      this.auto = true; this.log = false;
      this.yLo = 0; this.yHi = 1;            // price range (in scale units) when auto is off
      this.pointers = new Map();
      this.showSma10 = false;
      this.ich = null;                       // Ichimoku lines, when the chart is in Ichimoku style
      this.bind();
      new ResizeObserver(() => this.draw()).observe(canvas);
    }

    setData(c, o = {}) {
      this.c = c; this.hover = -1; this.showSma10 = !!o.sma10 && !!c.sma10;
      this.showEma50 = !!o.ema50 && !!c.ema50;
      this.ich = o.ichimoku ? computeIchimoku(c) : null;
      // only the levels asked for; bases as boxes when wanted
      this.levels = (c.levels || []).filter((lv) => !o.levels || o.levels.includes(lv.label));
      this.bases = [];
      if (o.bases && c.bases) {
        const at = new Map(c.d.map((d, i) => [d, i]));
        for (const b of c.bases) {
          const e = at.get(b.e);
          if (e === undefined) continue;
          this.bases.push({ ...b, i0: at.has(b.s) ? at.get(b.s) : 0, i1: e });
        }
      }
      this.auto = true; this.reset(); this.emit();
    }
    clear() { this.c = null; this.draw(); }
    emit() { if (this.onScale) this.onScale({ auto: this.auto, log: this.log }); }

    get n() { return this.c ? this.c.c.length : 0; }
    // empty bars kept to the right of the last candle: room for the forward cloud
    get lead() { return this.ich ? this.ich.shift + 3 : 2; }
    defaultBars() { return Math.min(this.n, this.mini ? 130 : 250); }
    reset() { this.auto = true; this.show(this.defaultBars()); this.emit(); }
    show(bars) {
      if (!this.c) return;
      bars = Math.min(this.n, bars);
      this.end = this.n + this.lead; this.start = this.end - bars - this.lead;
      this.auto = true; this.clampX(); this.draw(); this.emit();
    }
    setAuto(v) { this.auto = v; this.draw(); this.emit(); }
    setLog(v) {
      // keep the same visible prices when switching scale type
      const lo = this.inv(this.yLo), hi = this.inv(this.yHi);
      this.log = v; this.yLo = this.fwd(lo); this.yHi = this.fwd(hi);
      this.draw(); this.emit();
    }
    fwd(p) { return this.log ? Math.log(Math.max(p, 1e-6)) : p; }
    inv(v) { return this.log ? Math.exp(v) : v; }

    clampX() {
      const n = this.n, span = Math.max(15, Math.min(n + this.lead + 2, this.end - this.start));
      if (this.start < -2) this.start = -2;
      this.end = this.start + span;
      if (this.end > n + this.lead + 6) { this.end = n + this.lead + 6; this.start = this.end - span; }
      if (this.start < -2) this.start = -2;
    }
    zoom(factor, anchor = 0.85) {
      if (!this.c) return;
      const span = this.end - this.start, a = this.start + span * anchor;
      const ns = Math.max(15, Math.min(this.n + this.lead + 2, span * factor));
      this.start = a - ns * anchor; this.end = this.start + ns;
      this.clampX(); this.draw();
    }
    zoomY(factor) {  // stretch or squeeze the price scale around its middle
      const mid = (this.yLo + this.yHi) / 2, half = (this.yHi - this.yLo) / 2 * factor;
      this.yLo = mid - half; this.yHi = mid + half;
      if (this.auto) { this.auto = false; this.emit(); }
      this.draw();
    }
    pan(bars) { if (!this.c) return; this.start += bars; this.end += bars; this.clampX(); this.draw(); }

    // Ichimoku signals and the tracked setup, drawn over the candles
    drawIchimokuMarks(ctx, K, { X, Y, i0, i1, n, plotW, step, mini }) {
      const c = this.c, { events, trade } = this.ich;
      const fs = mini ? 9 : 10.5;
      ctx.save();
      ctx.font = `600 ${fs}px ${css("--body")}`; ctx.textBaseline = "middle";
      const pill = (x, y, text, bg, up) => {   // a small label with a pointer towards the bar
        const w = ctx.measureText(text).width + 8, h = fs + 6, top = up ? y : y - h;
        ctx.fillStyle = bg;
        ctx.beginPath(); ctx.moveTo(x, up ? y - 4 : y + 4); ctx.lineTo(x - 4, up ? y : y); ctx.lineTo(x + 4, up ? y : y); ctx.closePath(); ctx.fill();
        ctx.fillRect(x - w / 2, top, w, h);
        ctx.fillStyle = "#FFFFFF"; ctx.fillText(text, x - w / 2 + 4, top + h / 2 + 0.5);
        return h + 5;
      };
      const below = new Map(), above = new Map();   // stack several marks on one bar
      for (const e of events) {
        if (e.i < i0 || e.i > i1) continue;
        const x = X(e.i), up = /up$|^long$/.test(e.k);
        const used = up ? below : above, off = used.get(e.i) || 0;
        const y = up ? Y(c.l[e.i]) + 8 + off : Y(c.h[e.i]) - 8 - off;
        let adv = 12;
        if (e.k === "long" || e.k === "short") {
          const text = (e.k === "long" ? "Long" : "Short") + (e.s != null && !mini ? ` ${e.s}%` : "");
          adv = pill(x, y, text, e.k === "long" ? K.bull : K.bear, up);
        } else if (e.k === "div_up" || e.k === "div_down") {
          if (!mini) adv = pill(x, y, up ? "Div ▲" : "Div ▼", K.div, up);
        } else if (e.k.startsWith("break")) {         // cloud breakout: diamond
          const r = mini ? 4 : 5.5, cy = up ? y + r : y - r;
          ctx.fillStyle = K.brk; ctx.beginPath();
          ctx.moveTo(x, cy - r); ctx.lineTo(x + r, cy); ctx.lineTo(x, cy + r); ctx.lineTo(x - r, cy); ctx.closePath(); ctx.fill();
          if (!mini) { ctx.fillStyle = K.brk; const t = up ? "☁▲" : "☁▼"; ctx.fillText(t, x - ctx.measureText(t).width / 2, up ? cy + r + 8 : cy - r - 8); }
          adv = mini ? 12 : 30;
        } else if (e.k.startsWith("retest")) {        // retest of the cloud edge: small dot
          ctx.fillStyle = K.brk; ctx.globalAlpha = 0.7; ctx.beginPath(); ctx.arc(x, up ? y + 3 : y - 3, mini ? 2.2 : 3, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
          adv = 10;
        } else if (e.k.startsWith("twist")) {         // the cloud ahead changes colour: cross
          const r = mini ? 2.5 : 3.5, cy = up ? y + r : y - r;
          ctx.strokeStyle = K.twist; ctx.lineWidth = 1.6; ctx.beginPath();
          ctx.moveTo(x - r, cy - r); ctx.lineTo(x + r, cy + r); ctx.moveTo(x + r, cy - r); ctx.lineTo(x - r, cy + r); ctx.stroke();
          if (!mini) { ctx.fillStyle = K.twist; const t = up ? "⚡▲" : "⚡▼"; ctx.fillText(t, x - ctx.measureText(t).width / 2, up ? cy + r + 8 : cy - r - 8); }
          adv = mini ? 10 : 26;
        }
        used.set(e.i, off + adv);
      }
      // the tracked setup: entry, stop and three targets from the signal bar
      if (trade && trade.i <= i1 + 1) {
        const xa = X(trade.i), xb = Math.min(plotW, trade.open || trade.iEnd == null ? X(n - 1 + 5) : Math.max(X(trade.iEnd), xa + step * 6));
        const pct = (p) => { const v = (p / trade.entry - 1) * 100; return ` (${v >= 0 ? "+" : ""}${v.toFixed(2)}%)`; };
        const rows = [
          ["ENTRY", trade.entry, K.entry, [2, 3], 1, ""],
          [trade.result === "sl" ? "SL ✗" : "SL", trade.sl, K.sl, [], 2, pct(trade.sl)],
          ...trade.tp.map((p, k) => [`TP${k + 1}${trade.hit[k] ? " ✓" : ""}`, p, trade.hit[k] ? K.hit : K.tp, trade.hit[k] ? [] : [5, 4], 1, pct(p)]),
        ];
        for (const [name, p, col, dash, w, extra] of rows) {
          const y = Math.round(Y(p)) + 0.5;
          ctx.strokeStyle = col; ctx.lineWidth = w; ctx.setLineDash(dash);
          ctx.beginPath(); ctx.moveTo(xa, y); ctx.lineTo(xb, y); ctx.stroke(); ctx.setLineDash([]);
          const text = mini ? name : `${name} ${nf2.format(p)}${extra}`;
          const tw = ctx.measureText(text).width + 8, th = fs + 5, tx = Math.max(2, Math.min(xb - tw, plotW - tw - 2));
          ctx.fillStyle = col; ctx.fillRect(tx, y - th / 2, tw, th);
          ctx.fillStyle = K.tagText; ctx.fillText(text, tx + 4, y + 0.5);
        }
      }
      ctx.restore();
    }

    axisW() { return this.mini ? 46 : 64; }
    plotW() { return this.cv.clientWidth - this.axisW(); }
    layout() {
      const H = this.cv.clientHeight, hasRS = this.c && !!(this.c.rsv || this.c.rs);
      const dateH = 16, gap = this.mini ? 6 : 10;
      const priceH = Math.round((H - dateH) * (hasRS ? 0.66 : 0.8));
      const volH = Math.round((H - dateH) * (hasRS ? 0.14 : 0.2)) - gap;
      const rsH = hasRS ? H - dateH - priceH - volH - gap * 2 : 0;
      return { H, dateH, gap, priceH, volH, rsH, hasRS };
    }
    xToIndex(x) { return Math.floor(this.start + x / this.plotW() * (this.end - this.start)); }
    inPriceAxis(x, y) { return x > this.plotW() && y < this.layout().priceH; }

    bind() {
      const cv = this.cv;
      cv.addEventListener("wheel", (e) => {
        if (!this.c) return;
        e.preventDefault();
        if (this.inPriceAxis(e.offsetX, e.offsetY)) { this.zoomY(e.deltaY > 0 ? 1.08 : 1 / 1.08); return; }
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
          const d = e.shiftKey ? e.deltaY : e.deltaX;
          this.pan(d / this.plotW() * (this.end - this.start));
        } else {
          this.zoom(e.deltaY > 0 ? 1.12 : 1 / 1.12, Math.min(1, Math.max(0, e.offsetX / this.plotW())));
        }
      }, { passive: false });

      cv.addEventListener("pointerdown", (e) => {
        if (!this.c) return;
        cv.setPointerCapture(e.pointerId);
        this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
        if (this.inPriceAxis(e.offsetX, e.offsetY) && this.pointers.size === 1) {
          this.axisDrag = { y: e.offsetY, lo: this.yLo, hi: this.yHi };
          return;
        }
        this.drag = { x: e.offsetX, y: e.offsetY, start: this.start, end: this.end, lo: this.yLo, hi: this.yHi };
        if (this.pointers.size === 2) this.pinch = { d: this.pinchDist(), start: this.start, end: this.end, mid: this.pinchMid() };
        cv.classList.add("grabbing");
      });
      cv.addEventListener("pointermove", (e) => {
        if (!this.c) return;
        const x = e.offsetX, y = e.offsetY;
        if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x, y });
        cv.classList.toggle("on-axis", this.inPriceAxis(x, y));

        if (this.axisDrag) {   // drag the price scale: down squeezes, up stretches
          const f = Math.exp((y - this.axisDrag.y) / 160);
          const mid = (this.axisDrag.lo + this.axisDrag.hi) / 2, half = (this.axisDrag.hi - this.axisDrag.lo) / 2 * f;
          this.yLo = mid - half; this.yHi = mid + half;
          if (this.auto) { this.auto = false; this.emit(); }
          this.draw();
          return;
        }
        if (this.pinch && this.pointers.size === 2) {
          const f = this.pinch.d / Math.max(10, this.pinchDist());
          const span = this.pinch.end - this.pinch.start, a = this.pinch.mid / this.plotW();
          const ns = Math.max(15, Math.min(this.n + 4, span * f));
          const anchorIdx = this.pinch.start + span * a;
          this.start = anchorIdx - ns * a; this.end = this.start + ns;
          this.clampX(); this.draw();
          return;
        }
        if (this.drag && this.pointers.size === 1) {
          const dx = x - this.drag.x, per = (this.drag.end - this.drag.start) / this.plotW();
          this.start = this.drag.start - dx * per; this.end = this.drag.end - dx * per;
          this.clampX();
          if (!this.auto) {   // with a fixed scale, dragging also moves the chart up and down
            const dy = y - this.drag.y, pp = (this.drag.hi - this.drag.lo) / this.layout().priceH;
            this.yLo = this.drag.lo + dy * pp; this.yHi = this.drag.hi + dy * pp;
          }
        }
        this.hover = x > this.plotW() ? -1 : this.xToIndex(x);
        this.hoverY = y;
        this.draw();
      });
      const up = (e) => {
        this.pointers.delete(e.pointerId);
        if (this.pointers.size < 2) this.pinch = null;
        if (this.pointers.size === 0) { this.drag = null; this.axisDrag = null; cv.classList.remove("grabbing"); }
      };
      cv.addEventListener("pointerup", up);
      cv.addEventListener("pointercancel", up);
      cv.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") { this.hover = -1; this.hoverY = -1; this.draw(); } });
      cv.addEventListener("dblclick", (e) => {
        if (this.inPriceAxis(e.offsetX, e.offsetY)) this.setAuto(true);  // like TradingView: double-click the scale to reset it
        else this.reset();
      });
      cv.addEventListener("keydown", (e) => {
        const k = e.key;
        if (k === "+" || k === "=") this.zoom(1 / 1.25);
        else if (k === "-" || k === "_") this.zoom(1.25);
        else if (k === "ArrowLeft") this.pan(-(this.end - this.start) * 0.1);
        else if (k === "ArrowRight") this.pan((this.end - this.start) * 0.1);
        else if (k === "ArrowUp") this.zoomY(1 / 1.1);
        else if (k === "ArrowDown") this.zoomY(1.1);
        else if (k === "a" || k === "A") this.setAuto(!this.auto);
        else if (k === "l" || k === "L") this.setLog(!this.log);
        else if (k === "0") this.reset();
        else return;
        e.preventDefault();
      });
    }
    pinchDist() { const [a, b] = [...this.pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); }
    pinchMid() { const [a, b] = [...this.pointers.values()]; return (a.x + b.x) / 2; }

    draw() {
      const cv = this.cv, ctx = this.ctx, c = this.c;
      const dpr = window.devicePixelRatio || 1;
      const W = cv.clientWidth, H = cv.clientHeight;
      if (!W || !H) return;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (!c) { if (this.readout) this.readout.textContent = ""; return; }

      const mini = this.mini, n = this.n;
      const plotW = this.plotW(), axisX = plotW + 6;
      const { dateH, gap, priceH, volH, rsH, hasRS } = this.layout();
      const span = this.end - this.start, step = plotW / span;
      const bw = Math.max(1, Math.min(14, step * 0.7));
      const X = (i) => (i - this.start + 0.5) * step;
      const i0 = Math.max(0, Math.floor(this.start)), i1 = Math.min(n - 1, Math.ceil(this.end));
      if (i1 < i0) return;

      // price scale: auto fits the visible bars, otherwise stays where you put it
      let vMax = 0;
      for (let i = i0; i <= i1; i++) vMax = Math.max(vMax, c.v[i]);
      if (this.auto) {
        let lo = Infinity, hi = -Infinity;
        for (let i = i0; i <= i1; i++) { lo = Math.min(lo, c.l[i]); hi = Math.max(hi, c.h[i]); }
        if (this.ich) {   // keep the visible cloud, including the part ahead of price, on the scale
          const jEnd = Math.min(this.ich.cloudA.length - 1, Math.ceil(this.end));
          for (let j = i0; j <= jEnd; j++) {
            for (const v of [this.ich.cloudA[j], this.ich.cloudB[j]]) if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
          }
          const t = this.ich.trade;       // the tracked setup: stop and targets stay in view
          if (t && t.i <= i1) for (const v of [t.sl, ...t.tp]) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
        }
        for (const lv of this.levels) if (lv.price > lo * 0.92 && lv.price < hi * 1.08) { lo = Math.min(lo, lv.price); hi = Math.max(hi, lv.price); }
        const L = this.fwd(lo), Hh = this.fwd(hi), pad = (Hh - L) * 0.07 || Math.abs(Hh) * 0.05;
        this.yLo = L - pad; this.yHi = Hh + pad;
      }
      const yLo = this.yLo, yHi = this.yHi, padT = 4;
      const Y = (p) => padT + (yHi - this.fwd(p)) / (yHi - yLo) * (priceH - padT);
      const priceAt = (y) => this.inv(yHi - (y - padT) / (priceH - padT) * (yHi - yLo));
      const lo = this.inv(yLo), hi = this.inv(yHi);

      const ink = css("--ink"), ink3 = css("--ink-3"), grid = css("--grid"), up = css("--up"), down = css("--down");
      const surface = css("--surface");
      ctx.font = `${mini ? 10 : 11}px ${css("--body")}`;
      ctx.textBaseline = "middle";

      ctx.strokeStyle = grid; ctx.fillStyle = ink3; ctx.lineWidth = 1;
      const ticks = this.log ? logTicks(lo, hi, mini ? 4 : 7) : niceTicks(lo, hi, mini ? 4 : 6);
      for (const t of ticks) {
        const y = Math.round(Y(t)) + 0.5;
        if (y < 0 || y > priceH) continue;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotW, y); ctx.stroke();
        ctx.fillText(fmtAxis(t), axisX, y);
      }
      // price-axis divider
      ctx.beginPath(); ctx.moveTo(plotW + 0.5, 0); ctx.lineTo(plotW + 0.5, H - dateH); ctx.stroke();

      const line = (arr, color, y, width, a = i0, b = i1) => {
        if (!arr) return;
        ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
        let on = false;
        for (let i = Math.max(0, a - 1); i <= Math.min(n - 1, b + 1); i++) {
          const v = arr[i];
          if (v === null || v === undefined) { on = false; continue; }
          const px = X(i), py = y(v);
          on ? ctx.lineTo(px, py) : ctx.moveTo(px, py); on = true;
        }
        ctx.stroke();
      };

      // price pane (clipped)
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, plotW, priceH); ctx.clip();
      const lw = mini ? 1.1 : 1.4;
      // bases: a shaded box from the starting high to the breakout (or to today
      // while it is still forming), with the pivot along the top edge
      const baseMarks = [];
      for (const b of this.bases) {
        if (b.i1 < i0 - 1 || b.i0 > i1 + 1) continue;
        const x0 = X(b.i0) - step / 2, x1 = X(b.i1) + step / 2, yT = Y(b.p), yB = Y(b.l);
        ctx.fillStyle = ink; ctx.globalAlpha = b.bo ? 0.06 : 0.09;
        ctx.fillRect(x0, yT, x1 - x0, yB - yT);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = up; ctx.lineWidth = 1.2; ctx.setLineDash([4, 3]);
        const yy = Math.round(yT) + 0.5;
        ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(b.bo ? x1 : plotW, yy); ctx.stroke();
        ctx.setLineDash([]);
        baseMarks.push({ b, x0, x1, yT });
      }
      const K = this.ich ? ichColors() : null;
      if (this.ich) {
        const { tenkan, kijun, cloudA, cloudB, chikou, zones } = this.ich;
        const j0 = Math.max(1, i0), j1 = Math.min(cloudA.length - 1, Math.ceil(this.end) + 1);
        // cloud fill: green where Senkou A is above Senkou B, red where it is below
        ctx.globalAlpha = mini ? 0.16 : 0.14;
        for (let j = j0; j <= j1; j++) {
          const a0 = cloudA[j - 1], b0 = cloudB[j - 1], a1 = cloudA[j], b1 = cloudB[j];
          if (a0 == null || b0 == null || a1 == null || b1 == null) continue;
          ctx.fillStyle = a0 + a1 >= b0 + b1 ? K.bull : K.bear;
          ctx.beginPath();
          ctx.moveTo(X(j - 1), Y(a0)); ctx.lineTo(X(j), Y(a1)); ctx.lineTo(X(j), Y(b1)); ctx.lineTo(X(j - 1), Y(b0));
          ctx.closePath(); ctx.fill();
        }
        // Kijun support/resistance zones: where the Kijun sat flat
        for (const z of zones) {
          if (z.i1 < i0 || z.i0 > i1 + 12) continue;
          const x0 = X(z.i0), x1 = X(z.i1), yT = Y(z.p + z.b), yB = Y(z.p - z.b);
          ctx.fillStyle = K.kijun; ctx.globalAlpha = 0.12; ctx.fillRect(x0, yT, x1 - x0, Math.max(2, yB - yT));
          ctx.strokeStyle = K.kijun; ctx.globalAlpha = 0.45; ctx.lineWidth = 1; ctx.strokeRect(x0, yT, x1 - x0, Math.max(2, yB - yT));
        }
        ctx.globalAlpha = 1;
        line(chikou, K.chikou, Y, mini ? 1 : 1.1);
        line(kijun, K.kijun, Y, lw); line(tenkan, K.tenkan, Y, lw);
      } else {
        line(c.sma200, css("--sma200"), Y, lw); line(c.sma150, css("--sma150"), Y, lw); line(c.sma50, css("--sma50"), Y, lw);
        if (this.showSma10) line(c.sma10, css("--sma10"), Y, lw);
        if (this.showEma50) line(c.ema50, css("--ema50"), Y, mini ? 1.6 : 2.2);
      }
      const bars = SETTINGS.chartType === "bars";
      const tick = Math.max(1.5, Math.min(6, step * 0.4));      // open/close tick length for OHLC bars
      for (let i = i0; i <= i1; i++) {
        const o = c.o[i], cl = c.c[i], col = cl >= o ? up : down;
        ctx.strokeStyle = col; ctx.fillStyle = col;
        const x = Math.round(X(i)) + 0.5;
        if (bars) {   // OHLC bar: high-low line, open tick left, close tick right
          ctx.lineWidth = step > 6 ? 1.5 : 1;
          ctx.beginPath();
          ctx.moveTo(x, Y(c.h[i])); ctx.lineTo(x, Y(c.l[i]));
          const yo = Math.round(Y(o)) + 0.5, yc = Math.round(Y(cl)) + 0.5;
          ctx.moveTo(x - tick, yo); ctx.lineTo(x, yo);
          ctx.moveTo(x, yc); ctx.lineTo(x + tick, yc);
          ctx.stroke();
        } else {
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(x, Y(c.h[i])); ctx.lineTo(x, Y(c.l[i])); ctx.stroke();
          const top = Y(Math.max(o, cl)), h = Math.max(1, Math.abs(Y(o) - Y(cl)));
          ctx.fillRect(X(i) - bw / 2, top, bw, h);
        }
      }

      // base labels and breakout markers, drawn over the candles
      for (const { b, x0, x1, yT } of baseMarks) {
        ctx.fillStyle = b.bo ? ink3 : css("--up");
        const text = b.bo ? b.t : `${b.t} · pivot ${mini ? fmtAxis(b.p) : "₹" + nf2.format(b.p)}`;
        // keep the label inside the plot when the base sits against the right edge
        const tx = Math.max(4, Math.min(x0 + 3, plotW - ctx.measureText(text).width - 6));
        if (x1 - x0 > 28 || !b.bo) ctx.fillText(text, tx, Math.max(8, yT - 8));
        if (b.bo) {   // green triangle over the breakout bar (hollow when it closed weak)
          const x = X(b.i1), y = Y(c.h[b.i1]) - (mini ? 6 : 9), r = mini ? 3.5 : 5;
          ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y + r * 0.8); ctx.lineTo(x - r, y + r * 0.8); ctx.closePath();
          ctx.fillStyle = up; ctx.strokeStyle = up; ctx.lineWidth = 1.3;
          b.sq ? ctx.stroke() : ctx.fill();
        }
      }

      if (this.ich) this.drawIchimokuMarks(ctx, K, { X, Y, i0, i1, n, plotW, step, mini });

      // key levels: merge near-equal prices, stagger labels
      const merged = [];
      for (const lv of this.levels.slice().sort((a, b) => b.price - a.price)) {
        const m = merged.find((x) => Math.abs(x.price - lv.price) / lv.price < 0.004);
        if (m) m.label += " / " + lv.label; else merged.push({ ...lv });
      }
      ctx.setLineDash([5, 4]);
      let lastLY = -99;
      for (const lv of merged) {
        if (lv.price < lo || lv.price > hi) continue;
        const y = Math.round(Y(lv.price)) + 0.5;
        ctx.strokeStyle = css("--saffron"); ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotW, y); ctx.stroke();
        ctx.fillStyle = css("--saffron-ink");
        let ly = y - 9; if (ly - lastLY < 13) ly = lastLY + 13;
        ctx.fillText(mini ? `${lv.label} ${fmtAxis(lv.price)}` : `${lv.label} ${nf2.format(lv.price)}`, 6, ly);
        lastLY = ly;
      }
      ctx.setLineDash([]);
      ctx.restore();

      // volume pane
      const vTop = priceH + gap;
      ctx.save(); ctx.beginPath(); ctx.rect(0, vTop, plotW, volH); ctx.clip();
      ctx.globalAlpha = 0.55;
      for (let i = i0; i <= i1; i++) {
        const h = (c.v[i] / (vMax || 1)) * volH;
        ctx.fillStyle = c.c[i] >= c.o[i] ? up : down;
        ctx.fillRect(X(i) - bw / 2, vTop + volH - h, bw, h);
      }
      ctx.restore();
      ctx.fillStyle = ink3;
      if (!mini) ctx.fillText("Volume", axisX, vTop + 8);

      // RS line pane
      // like the TradingView indicator: blue RS line, orange RS average,
      // blue dots = RS at a new high, pink dots = RS at a new high before price
      if (hasRS) {
        const rs = c.rsv || c.rs, ma = c.rsv && SETTINGS.showRsMa ? c.rsma : null;
        const rTop = vTop + volH + gap;
        let rlo = Infinity, rhi = -Infinity;
        for (let i = i0; i <= i1; i++) {
          for (const v of [rs[i], ma ? ma[i] : null]) if (v != null) { rlo = Math.min(rlo, v); rhi = Math.max(rhi, v); }
        }
        if (rlo < Infinity) {
          const pad = (rhi - rlo) * 0.08; rlo -= pad; rhi += pad;
          const RY = (v) => rTop + (rhi - v) / ((rhi - rlo) || 1) * rsH;
          ctx.strokeStyle = grid; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(0, rTop - gap / 2 + 0.5); ctx.lineTo(plotW, rTop - gap / 2 + 0.5); ctx.stroke();
          ctx.save(); ctx.beginPath(); ctx.rect(0, rTop - 2, plotW, rsH + 4); ctx.clip();
          if (ma) line(ma, css("--rs-ma"), RY, mini ? 1 : 1.2);
          line(rs, css("--rs"), RY, mini ? 1.3 : 1.8);
          if (c.rsv && SETTINGS.showRsDots) {
            const rad = mini ? 1.8 : 2.6;
            for (let i = i0; i <= i1; i++) {
              if (!c.rshi[i] || rs[i] == null) continue;
              ctx.fillStyle = c.rslead[i] ? css("--rs-lead") : css("--rs");
              ctx.beginPath(); ctx.arc(X(i), RY(rs[i]), rad, 0, Math.PI * 2); ctx.fill();
            }
          }
          ctx.restore();
          ctx.fillStyle = ink3;
          ctx.fillText(mini ? "RS" : "RS line", axisX, rTop + 8);
        }
      }

      // date axis: months, or years when zoomed far out
      ctx.fillStyle = ink3; ctx.textBaseline = "alphabetic";
      let lastKey = "", nextFree = 0;
      const yearsOnly = span > 420;
      for (let i = i0; i <= i1; i++) {
        const key = yearsOnly ? c.d[i].slice(0, 4) : c.d[i].slice(0, 7);
        if (key !== lastKey && i > i0) {
          const dt = new Date(c.d[i] + "T00:00:00");
          const label = dt.getMonth() === 0 || yearsOnly ? String(dt.getFullYear()) : dt.toLocaleDateString("en-IN", { month: "short" });
          const w = ctx.measureText(label).width, x = X(i) - w / 2;
          if (x >= nextFree && x > 0 && x + w < plotW) { ctx.fillText(label, x, H - 3); nextFree = x + w + 12; }
        }
        lastKey = key;
      }

      // last-price tag on the scale
      ctx.textBaseline = "middle";
      const tag = (y, text, bg, fg) => {
        const th = mini ? 15 : 18, tw = this.axisW() - 2;
        ctx.fillStyle = bg; ctx.fillRect(plotW + 1, y - th / 2, tw, th);
        ctx.fillStyle = fg; ctx.fillText(text, axisX, y);
      };
      const lastC = c.c[n - 1], lastY = Y(lastC);
      if (lastY >= 0 && lastY <= priceH) {
        const col = lastC >= c.o[n - 1] ? up : down;
        ctx.strokeStyle = col; ctx.globalAlpha = 0.5; ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(0, Math.round(lastY) + 0.5); ctx.lineTo(plotW, Math.round(lastY) + 0.5); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
        tag(lastY, fmtAxis(lastC), col, "#fff");
      }

      // crosshair with price label
      const hv = this.hover >= i0 && this.hover <= i1 ? this.hover : -1;
      if (hv >= 0) {
        ctx.strokeStyle = ink3; ctx.globalAlpha = 0.7; ctx.setLineDash([3, 3]);
        const x = Math.round(X(hv)) + 0.5;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H - dateH); ctx.stroke();
        if (this.hoverY >= 0 && this.hoverY <= priceH) {
          const yy = Math.round(this.hoverY) + 0.5;
          ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(plotW, yy); ctx.stroke();
          ctx.setLineDash([]); ctx.globalAlpha = 1;
          tag(this.hoverY, fmtAxis(priceAt(this.hoverY)), ink, surface);
        }
        ctx.setLineDash([]); ctx.globalAlpha = 1;
      }
      if (!this.auto || this.log) {   // small badge so it's obvious the scale is fixed or logarithmic
        const badge = [this.auto ? "" : "Fixed scale", this.log ? "Log scale" : ""].filter(Boolean).join(", ");
        ctx.fillStyle = ink3; ctx.textBaseline = "top";
        ctx.fillText(badge, plotW - ctx.measureText(badge).width - 6, 4);
      }
      if (this.readout) {
        const i = hv >= 0 ? hv : n - 1;
        const chg = i > 0 ? (c.c[i] / c.c[i - 1] - 1) * 100 : 0;
        const date = new Date(c.d[i] + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
        this.readout.innerHTML =
          `<span><b>${date}</b></span><span>O <b>${nf2.format(c.o[i])}</b></span><span>H <b>${nf2.format(c.h[i])}</b></span>` +
          `<span>L <b>${nf2.format(c.l[i])}</b></span><span>C <b>${nf2.format(c.c[i])}</b></span>` +
          `<span class="${chg >= 0 ? "pos" : "neg"}">${signed(chg)}%</span><span>Vol <b>${nf0.format(c.v[i])}</b></span>`;
      }
    }
  }

  function niceTicks(lo, hi, count) {
    const raw = (hi - lo) / count, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const stepV = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
    const out = [];
    for (let t = Math.ceil(lo / stepV) * stepV; t <= hi; t += stepV) out.push(+t.toFixed(6));
    return out;
  }
  function logTicks(lo, hi, count) {
    // nice ticks on a log scale: 1, 2, 5 x 10^k, thinned to about `count`
    const out = [];
    for (let k = Math.floor(Math.log10(lo)) - 1; k <= Math.ceil(Math.log10(hi)); k++)
      for (const m of [1, 1.5, 2, 3, 5, 7]) { const t = m * Math.pow(10, k); if (t >= lo && t <= hi) out.push(t); }
    if (out.length <= count) return out.length >= 4 ? out : niceTicks(lo, hi, count);
    const stepK = Math.ceil(out.length / count);
    return out.filter((_, i) => i % stepK === 0);
  }
  function fmtAxis(v) {
    if (v >= 100000) return nf0.format(Math.round(v / 1000)) + "k";
    if (v >= 1000) return nf0.format(v);
    return nf2.format(v).replace(/\.00$/, "");
  }

  // =====================================================================
  // Page
  // =====================================================================
  const mainChart = new PriceChart($("chart"), {
    readout: $("readout"),
    onScale: ({ auto, log }) => {
      $("scaleAuto").setAttribute("aria-pressed", auto ? "true" : "false");
      $("scaleLog").setAttribute("aria-pressed", log ? "true" : "false");
    },
  });

  async function init() {
    readHash();
    try {
      const bucket = Math.floor(Date.now() / 600000); // refresh at most every 10 minutes
      DATA = await window.ibsDataBase();
      const benchReady = loadBenchmark();
      const r = await fetch(`${DATA}latest.json?v=${bucket}`, { cache: "no-cache" });
      if (!r.ok) throw new Error(r.status);
      state.data = await r.json();
      await benchReady;
    } catch (e) {
      showNoData();
      return;
    }
    const d = state.data;
    $("headline").textContent = `Setups after the close on ${longDate(d.data_date)}`;
    const liquid = d.stocks_liquid != null
      ? `${nf0.format(d.stocks_liquid)} liquid stocks (price of ₹${d.min_price ?? 50} or more and average daily turnover of ₹${d.min_turnover_cr} crore or more${d.min_mcap_cr ? `; the screens also need a market cap of ₹${nf0.format(d.min_mcap_cr)} crore or more` : ""}) out of ${nf0.format(d.stocks_scanned)} ${pretty(d.universe) === "all NSE stocks" ? "NSE stocks" : "in the " + pretty(d.universe)} scanned. `
      : `${nf0.format(d.stocks_scanned)} stocks from the ${pretty(d.universe)} scanned. `;
    $("meta").textContent = liquid + `RS line drawn against the ${BENCH ? BENCH.name : pretty(d.benchmark)} (change it in Settings). Updated ${timeOf(d.generated_at)}.`;

    renderScreens();
    setView(state.view, true);
    selectScreen(state.screen, true);

    $("search").addEventListener("input", (e) => { state.query = e.target.value.trim().toLowerCase(); refreshList(); });
    $("closeChart").addEventListener("click", () => $("chartPanel").classList.remove("open"));
    updateFilterBtn();
    $("filterBtn").addEventListener("click", () => showFilters($("filters").hidden));
    $("filterApply").addEventListener("click", applyFilters);
    $("filterCancel").addEventListener("click", () => showFilters(false));
    // the filter box floats over the page: a click outside it or Escape closes it
    // (composedPath, because a clicked quick button is redrawn before this runs)
    document.addEventListener("click", (e) => { if (!$("filters").hidden && !e.composedPath().includes($("filterWrap"))) showFilters(false); });
    document.addEventListener("keydown", (e) => {
      if ($("filters").hidden) return;
      if (e.key === "Escape") showFilters(false);
      if (e.key === "Enter" && e.target.matches && e.target.matches("#filters input")) { e.preventDefault(); applyFilters(); }
    });
    $("filterReset").addEventListener("click", resetFilters);
    $("basesBtn").setAttribute("aria-pressed", state.showBases ? "true" : "false");
    $("basesBtn").addEventListener("click", () => setBases(!state.showBases));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("chartPanel").classList.remove("open"); });
    for (const b of document.querySelectorAll("[data-view]")) b.addEventListener("click", () => setView(b.dataset.view));
    for (const b of document.querySelectorAll("[data-per-row]")) b.addEventListener("click", () => setPerRow(+b.dataset.perRow));
    $("zoomIn").addEventListener("click", () => mainChart.zoom(1 / 1.3));
    $("zoomOut").addEventListener("click", () => mainChart.zoom(1.3));
    $("zoomReset").addEventListener("click", () => mainChart.reset());
    for (const b of document.querySelectorAll("[data-range]")) b.addEventListener("click", () => mainChart.show(+b.dataset.range));
    $("scaleAuto").addEventListener("click", () => mainChart.setAuto(!mainChart.auto));
    for (const b of document.querySelectorAll("[data-chart-type]")) {
      b.setAttribute("aria-pressed", b.dataset.chartType === (SETTINGS.chartType || "candles") ? "true" : "false");
      b.addEventListener("click", () => setChartType(b.dataset.chartType));
    }
    $("pineCopy").addEventListener("click", copyPine);
    $("scaleLog").addEventListener("click", () => mainChart.setLog(!mainChart.log));
  }

  function showNoData() {
    $("headline").textContent = "No scan published yet";
    $("meta").textContent = "The daily scan hasn't published results for this site yet.";
    for (const id of ["workspace", "screens", "tools", "grid"]) $(id).hidden = true;
    const box = document.createElement("div");
    box.className = "empty";
    box.innerHTML = `<h3>Run the first scan</h3>
      <p>Open the repository on GitHub and go to <b>Actions → Daily scan → Run workflow</b>. When it finishes, refresh this page and today's setups appear here.</p>
      <p>After that it runs on its own every weekday after the market closes.</p>`;
    $("screenNote").replaceWith(box);
  }

  // ---------- screens & view ----------
  function renderScreens() {
    const nav = $("screens");
    nav.innerHTML = "";
    for (const name of ORDER) {
      const rows = screenRows(name);
      const b = document.createElement("button");
      b.className = "screen";
      b.setAttribute("role", "tab");
      b.dataset.screen = name;
      b.innerHTML = `<span class="n">${rows.length}</span><span class="name">${name}</span>`;
      b.addEventListener("click", () => selectScreen(name));
      nav.appendChild(b);
    }
  }

  function selectScreen(name, initial = false) {
    state.screen = name;
    if (!$("filters").hidden) showFilters(false);            // the box belongs to the screen it was opened on
    updateFilterBtn();
    state.sort = null;
    state.stage = defaultStage(name);
    for (const b of $("screens").children) b.setAttribute("aria-selected", b.dataset.screen === name ? "true" : "false");
    $("screenNote").textContent = SCREENS[name];
    $("pineGift").hidden = name !== "Murphy";
    if (name === "Murphy") loadPine();
    refreshList();
    if (state.view === "table") {
      const rows = currentRows();
      const keep = initial && state.symbol && rows.some((r) => r.symbol === state.symbol);
      if (keep) openStock(state.symbol, false);
      else if (rows.length && window.matchMedia("(min-width: 1081px)").matches) openStock(rows[0].symbol, false);
      else if (!rows.length) clearChart();
    }
    writeHash();
  }

  function setView(view, initial = false) {
    state.view = view;
    for (const b of document.querySelectorAll("[data-view]")) b.setAttribute("aria-pressed", b.dataset.view === view ? "true" : "false");
    $("workspace").hidden = view !== "table";
    $("grid").hidden = view !== "charts";
    $("perRow").hidden = view !== "charts";
    requestAnimationFrame(syncHeights);
    if (!initial) {
      refreshList();
      if (view === "table") {
        const rows = currentRows();
        const sym = state.symbol && rows.some((r) => r.symbol === state.symbol) ? state.symbol : rows[0] && rows[0].symbol;
        if (sym && window.matchMedia("(min-width: 1081px)").matches) openStock(sym, false);
      }
      writeHash();
    }
  }

  function setPerRow(n) {
    state.perRow = n;
    $("grid").style.setProperty("--per-row", n);
    for (const b of document.querySelectorAll("[data-per-row]")) b.setAttribute("aria-pressed", +b.dataset.perRow === n ? "true" : "false");
  }

  // ---------- stages & filters ----------
  function renderStages() {
    const box = $("stages"), def = STAGES[state.screen];
    box.innerHTML = "";
    box.hidden = !def;
    if (!def) return;
    const rows = screenRows(state.screen);
    const cards = def.list.map(([name, note]) => [name, note, rows.filter((r) => def.of(r) === name).length]);
    for (const [name, note, n] of cards) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "stage";
      b.setAttribute("aria-pressed", state.stage === name ? "true" : "false");
      b.innerHTML = `<span class="n">${n}</span><span class="name">${name}</span><span class="note">${note}</span>`;
      b.addEventListener("click", () => selectStage(name));
      box.appendChild(b);
    }
  }
  // a screen opens on its first stage that has stocks
  function defaultStage(screen) {
    const def = STAGES[screen];
    if (!def) return null;
    const rows = screenRows(screen);
    const hit = def.list.find(([name]) => rows.some((r) => def.of(r) === name));
    return (hit || def.list[0])[0];
  }
  function selectStage(name) {
    state.stage = name;
    refreshList();
    if (state.view === "table") {
      const rows = currentRows();
      if (rows.length && !rows.some((r) => r.symbol === state.symbol) && window.matchMedia("(min-width: 1081px)").matches) openStock(rows[0].symbol, false);
    }
  }
  function renderFilters() {
    const box = $("filterFields");
    box.innerHTML = "";
    for (const [key, label] of FILTERS) {
      const l = document.createElement("label");
      l.innerHTML = `<span>${label}</span><input type="number" inputmode="decimal" min="0" step="any" data-filter="${key}" placeholder="Any">`;
      const inp = l.querySelector("input");
      if (state.draft[key] != null) inp.value = state.draft[key];
      inp.addEventListener("input", () => {
        const v = parseFloat(inp.value);
        if (Number.isFinite(v)) state.draft[key] = v; else delete state.draft[key];
        renderQuick();
      });
      box.appendChild(l);
    }
    const l = document.createElement("label");
    l.className = "check";
    l.innerHTML = `<input type="checkbox" data-filter="rsHigh"><span>RS line at a 52-week high</span>`;
    const cb = l.querySelector("input");
    cb.checked = !!state.draft.rsHigh;
    cb.addEventListener("change", () => { if (cb.checked) state.draft.rsHigh = true; else delete state.draft.rsHigh; });
    box.appendChild(l);
  }
  // quick buttons inside the filter box: the scan's own floor, or a higher one.
  // They set the same filter as the matching number field.
  function quickSeg(boxId, key, label, floor, steps) {
    const box = $(boxId);
    const f = state.draft;
    const cur = f[key] != null && f[key] > floor ? f[key] : floor;
    box.innerHTML = `<span class="seg-label">${label}</span>`;
    for (const v of [floor, ...steps.filter((x) => x > floor)]) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = `₹${nf0.format(v)} cr+`;
      b.setAttribute("aria-pressed", cur === v ? "true" : "false");
      b.addEventListener("click", () => {
        if (v === floor) delete f[key]; else f[key] = v;
        const inp = document.querySelector(`[data-filter="${key}"]`);
        if (inp) inp.value = v === floor ? "" : v;
        renderQuick();
      });
      box.appendChild(b);
    }
  }
  function renderQuick() {
    const d = state.data || {};
    quickSeg("mcapSeg", "mcap", "Market cap", d.min_mcap_cr || 500, [1000, 2000]);
    quickSeg("turnoverSeg", "turnover", "Daily turnover", d.min_turnover_cr || 1, [5, 10, 50]);
  }
  function updateFilterBtn() {
    const n = activeFilters();
    $("filterBtnText").textContent = n ? `Filters (${n})` : "Filters";
    $("filterBtn").classList.toggle("on", n > 0);
  }
  // open the box with a copy of this screen's filters; nothing changes until Apply
  function showFilters(open) {
    if (open) {
      state.draft = { ...filtersFor(state.screen) };
      $("filterTitle").textContent = `Filters for ${state.screen}`;
      renderFilters(); renderQuick();
    }
    $("filters").hidden = !open;
    $("filterBtn").setAttribute("aria-expanded", open ? "true" : "false");
  }
  function applyFilters() {
    const d = { ...state.draft };
    if (Object.keys(d).length) state.filtersAll[state.screen] = d; else delete state.filtersAll[state.screen];
    showFilters(false);
    filtersChanged();
  }
  function filtersChanged() {
    saveFilters();
    updateFilterBtn();
    for (const b of $("screens").children) b.querySelector(".n").textContent = screenRows(b.dataset.screen).length;
    refreshList();
  }
  function resetFilters() {                                  // clears the box; Apply to use it
    state.draft = {};
    renderFilters(); renderQuick();
  }

  function currentRows() {
    let list = screenRows(state.screen);
    const def = STAGES[state.screen];
    if (def && state.stage) list = list.filter((r) => def.of(r) === state.stage);
    if (state.query) list = list.filter((r) => (r.symbol + " " + (r.industry || "")).toLowerCase().includes(state.query));
    if (state.sort) {
      const k = state.sort, dir = state.dir;
      list.sort((a, b) => {
        const x = a[k], y = b[k];
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        return (typeof x === "string" ? x.localeCompare(y) : x - y) * dir;
      });
    }
    return list;
  }

  function refreshList() {
    const all = state.data.screens[state.screen] || [];
    const list = currentRows();
    renderStages();
    $("count").textContent = !all.length ? "" : list.length === all.length
      ? `${all.length} ${all.length === 1 ? "stock" : "stocks"}` : `${list.length} of ${all.length} stocks`;
    $("empty").hidden = all.length > 0;
    if (!all.length) {
      $("empty").innerHTML = `<h3>No stocks pass ${state.screen} today</h3><p>That's normal in a weak market, since bases form when leaders rest. Check the Trend Template list for stocks in an uptrend, or run the Colab notebook with looser settings.</p>`;
    }
    if (state.view === "table") {
      // a new screen, stage, filter, search or sort starts again at page 1
      const key = [state.screen, state.stage, state.query, state.sort, state.dir, JSON.stringify(filtersFor(state.screen))].join("|");
      if (key !== state.listKey) { state.listKey = key; state.page = 0; }
      const pages = Math.max(1, Math.ceil(list.length / state.perPage));
      state.page = Math.min(state.page, pages - 1);
      const from = state.page * state.perPage;
      renderTable(list.slice(from, from + state.perPage), all.length, from);
      renderPager(list.length, pages, from);
    } else { $("pager").hidden = true; renderGrid(list); }
  }

  // ---------- pages: as many rows as fit on screen, so the table never scrolls up and down ----------
  function renderPager(n, pages, from) {
    const pg = $("pager");
    pg.hidden = n === 0;
    $("pgInfo").textContent = `${from + 1}–${Math.min(from + state.perPage, n)} of ${n} · page ${state.page + 1} of ${pages}`;
    $("pgPrev").disabled = state.page === 0;
    $("pgNext").disabled = state.page >= pages - 1;
  }
  function gotoPage(d) { state.page += d; refreshList(); }
  $("pgPrev").addEventListener("click", () => gotoPage(-1));
  $("pgNext").addEventListener("click", () => gotoPage(1));
  document.querySelector(".table-wrap").addEventListener("keydown", (e) => {
    if (e.key === "PageDown" && !$("pgNext").disabled) { e.preventDefault(); gotoPage(1); }
    if (e.key === "PageUp" && !$("pgPrev").disabled) { e.preventDefault(); gotoPage(-1); }
  });
  // work out how many rows fit in the table's height
  function fitRows() {
    if (!state.data || state.view !== "table") return;
    const wrap = document.querySelector(".table-wrap"), table = $("table");
    const head = table.tHead ? table.tHead.offsetHeight : 34;
    const row = (table.tBodies[0].rows[0] || {}).offsetHeight || 30;
    const per = Math.max(5, Math.floor((wrap.clientHeight - head - 2) / row));
    if (per !== state.perPage) {
      const first = state.page * state.perPage;           // keep the same rows in view
      state.perPage = per; state.page = Math.floor(first / per);
      refreshList();
    }
  }

  // ---------- Murphy TradingView indicator ----------
  const PINE_URL = "https://raw.githubusercontent.com/tmmity3-max/india-base-scanner/main/pine/murphy_trend_following.pine";
  let pineLoaded = false;
  async function loadPine() {
    if (pineLoaded) return;
    pineLoaded = true;
    try {
      const r = await fetch(PINE_URL);
      if (!r.ok) throw new Error(r.status);
      $("pineCode").textContent = await r.text();
      $("pineCopy").disabled = false;
    } catch (e) {
      pineLoaded = false;
      $("pineCode").textContent = "Couldn't load the code here. Open it on GitHub with the link above.";
    }
  }
  async function copyPine() {
    const txt = $("pineCode").textContent;
    try { await navigator.clipboard.writeText(txt); }
    catch (e) {
      const ta = document.createElement("textarea"); ta.value = txt; document.body.appendChild(ta);
      ta.select(); document.execCommand("copy"); ta.remove();
    }
    $("pineCopy").textContent = "Copied";
    setTimeout(() => ($("pineCopy").textContent = "Copy code"), 2000);
  }

  // ---------- table ----------
  function renderTable(list, total, from = 0) {
    const cols = total ? Object.keys((state.data.screens[state.screen] || [])[0]).filter((c) => COLS[c]) : [];
    const thead = $("table").tHead, tbody = $("table").tBodies[0];
    thead.innerHTML = ""; tbody.innerHTML = "";
    $("table").hidden = total === 0;
    if (!total) return;

    const tr = document.createElement("tr");
    const slh = document.createElement("th");            // serial number, counted across pages
    slh.textContent = "#"; slh.scope = "col"; slh.className = "sl"; slh.style.cursor = "default";
    tr.appendChild(slh);
    for (const c of cols) {
      const th = document.createElement("th");
      th.textContent = COLS[c][0];
      th.scope = "col"; th.tabIndex = 0;
      if (COLS[c][1] === "txt") th.className = "txt";
      if (c === "symbol") th.classList.add("sym");
      if (state.sort === c) th.setAttribute("aria-sort", state.dir > 0 ? "ascending" : "descending");
      const sortBy = () => {
        if (state.sort === c) state.dir = -state.dir;
        else { state.sort = c; state.dir = COLS[c][1] === "txt" ? 1 : -1; }
        refreshList();
      };
      th.addEventListener("click", sortBy);
      th.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); sortBy(); } });
      tr.appendChild(th);
    }
    thead.appendChild(tr);

    const frag = document.createDocumentFragment();
    for (const r of list) {
      const row = document.createElement("tr");
      row.tabIndex = 0;
      row.dataset.symbol = r.symbol;
      if (r.symbol === state.symbol) row.setAttribute("aria-selected", "true");
      const sl = document.createElement("td");
      sl.className = "sl"; sl.textContent = from + list.indexOf(r) + 1;
      row.appendChild(sl);
      for (const c of cols) {
        const td = document.createElement("td");
        const [text, cls] = fmt(r[c], COLS[c][1]);
        if (c === "symbol") {
          const a = document.createElement("a");
          a.href = tvUrl(r.symbol); a.target = "_blank"; a.rel = "noopener";
          a.textContent = text; a.className = "tv-sym"; a.title = `Open ${r.symbol} on TradingView`;
          a.addEventListener("click", (e) => e.stopPropagation());
          td.appendChild(a);
        } else td.textContent = text;
        td.className = [cls, COLS[c][1] === "txt" ? "txt" : "", c === "symbol" ? "sym" : "", c === "industry" ? "ind" : ""].join(" ").trim();
        if (c === "industry") td.title = r[c] || "";
        row.appendChild(td);
      }
      row.addEventListener("click", () => openStock(r.symbol, true));
      row.addEventListener("keydown", (e) => { if (e.key === "Enter") openStock(r.symbol, true); });
      frag.appendChild(row);
    }
    tbody.appendChild(frag);
  }

  // ---------- big chart ----------
  async function openStock(sym, userAction) {
    state.symbol = sym;
    writeHash();
    for (const tr of $("table").tBodies[0].rows) tr.setAttribute("aria-selected", tr.dataset.symbol === sym ? "true" : "false");
    if (userAction) $("chartPanel").classList.add("open");
    $("chartTitle").innerHTML = "";
    const ta = document.createElement("a");
    ta.href = tvUrl(sym); ta.target = "_blank"; ta.rel = "noopener"; ta.textContent = sym;
    ta.title = `Open ${sym} on TradingView`;
    $("chartTitle").appendChild(ta);
    $("chartSub").textContent = "Loading chart…";
    let c;
    try { c = await loadChart(sym); }
    catch (e) {
      if (state.symbol !== sym) return;
      $("chartSub").textContent = "Chart data is missing for this stock. It will appear after the next scan.";
      mainChart.clear();
      return;
    }
    if (state.symbol !== sym) return;
    const row = (state.data.screens[state.screen] || []).find((r) => r.symbol === sym) || {};
    const bits = [];
    if (row.industry) bits.push(row.industry);
    if (c.screens && c.screens.length) bits.push("In: " + c.screens.join(", "));
    $("chartSub").innerHTML = "";
    $("chartSub").append(bits.join(". ") + (bits.length ? ". " : ""), tvLink(sym));
    $("rsLegend").hidden = !(c.rsv || c.rs);
    $("rsLegend").innerHTML = c.rsv
      ? `<i class="k-rs"></i>RS line vs ${c.rsName}` + (SETTINGS.showRsMa ? ` <i class="k-rsma"></i>RS ${SETTINGS.rsMa}-day average` : "") +
        (SETTINGS.showRsDots ? ` <i class="k-dot"></i>RS new high <i class="k-dot lead"></i>RS leads price` : "") +
        ` <a href="settings.html">Change</a>`
      : `<i class="k-rs"></i>RS line vs index`;
    const mc = (c.fund && c.fund.market_cap_cr) || row.market_cap_cr;
    $("chartMcap").innerHTML = mc != null ? `<span>Market cap</span><b>${mcapText(mc)}</b>` : "";
    renderFund(c, row);
    const murphy = state.screen === "Murphy";
    const ich = state.screen === "Ichimoku";
    const info = ich && c.ich ? c.ich : null;
    $("ichInfo").hidden = !info;
    if (info) {
      const st = info.stats || {}, rate = (k) => (st.closed ? Math.round((st[k] / st.closed) * 100) + "%" : "–");
      $("ichInfo").innerHTML = `<b>Trend</b> ${info.trend} · <b>Momentum</b> ${info.momentum} · <b>Score</b> ${info.score}%` +
        (st.closed ? ` · <b>Past setups on this stock</b> ${st.closed} closed, ${rate("tp1")} reached target 1, ${rate("sl")} stopped out, average ${st.avg_r >= 0 ? "+" : ""}${st.avg_r}R. ` +
          `That count assumes a third is sold at each target and takes the stop first when one bar touches both. It is not a backtest.` : "");
    }
    $("sma10Legend").hidden = !(murphy && c.sma10);
    $("ema50Legend").hidden = !(state.screen === "50 EMA Pullback" && c.ema50);
    for (const el of document.querySelectorAll(".legend .k-ma")) el.hidden = ich;
    for (const el of document.querySelectorAll(".legend .k-ich")) el.hidden = !ich;
    mainChart.setData(c, chartOptions());
  }
  // what the chart draws depends on the screen: its own key level only, and
  // bases as boxes on the Base Breakout screen or whenever "Bases" is switched on
  function chartOptions() {
    const s = state.screen, lv = SCREEN_LEVEL[s];
    return { sma10: s === "Murphy", ema50: s === "50 EMA Pullback", ichimoku: s === "Ichimoku", levels: lv ? [lv] : [],
             bases: s !== "Ichimoku" && (s === "Base Breakout" || state.showBases) };
  }
  function setBases(on) {
    state.showBases = on;
    try { localStorage.setItem("ibs-bases", on ? "1" : "0"); } catch (e) { /* private window */ }
    $("basesBtn").setAttribute("aria-pressed", on ? "true" : "false");
    if (state.symbol && mainChart.c) mainChart.setData(mainChart.c, chartOptions());
    if (state.view === "charts") refreshList();
  }

  function renderFund(c, row) {
    const f = c.fund || {}, box = $("fund");
    const pct = (v) => (v == null ? null : `${nf1.format(v)}%`);
    const num = (v, d = 2) => (v == null ? null : new Intl.NumberFormat("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d }).format(v));
    const items = [
      ["Market cap", mcapText(f.market_cap_cr || row.market_cap_cr) || null],
      ["P/E (TTM)", num(f.pe, 1)], ["P/B", num(f.pb, 2)], ["EPS (TTM) ₹", num(f.eps, 2)],
      ["ROE", pct(f.roe)], ["Debt / equity", num(f.debt_to_equity, 1)],
      ["Profit margin", pct(f.profit_margin)], ["Revenue growth (YoY)", pct(f.revenue_growth)],
      ["Earnings growth (YoY)", pct(f.earnings_growth)], ["Dividend yield", pct(f.dividend_yield)],
      ["Book value ₹", num(f.book_value, 2)], ["Beta", num(f.beta, 2)],
      ["52-week high ₹", num(c.hi52, 2)], ["52-week low ₹", num(c.lo52, 2)],
      ["From 52w high", row.pct_from_52w_high != null ? `${signed(row.pct_from_52w_high)}%` : null],
      ["Above 52w low", row.pct_above_52w_low != null ? `${signed(row.pct_above_52w_low)}%` : null],
    ];
    const shown = items.filter(([, v]) => v != null && v !== "");
    const q = f.qtr && f.qtr.q ? f.qtr : null;
    if (!shown.length && !q) { box.hidden = true; return; }
    box.hidden = false;
    const sector = [f.sector, f.yf_industry].filter(Boolean).join(" · ");
    // latest quarter: value, change vs the quarter before and vs the same quarter last year
    const chg = (v, unit) => (v == null ? `<td class="na">–</td>` :
      `<td class="${v >= 0 ? "pos" : "neg"}">${v > 0 ? "+" : ""}${nf1.format(v)}${unit}</td>`);
    const qRow = (label, v, txt, a, b, unit) => (v == null ? "" : `<tr><th>${label}</th><td>${txt}</td>${chg(a, unit)}${chg(b, unit)}</tr>`);
    const qTable = q ? `<table class="qtr"><caption>Latest quarter (${q.q})</caption>` +
      `<thead><tr><th></th><th>Value</th><th>vs last qtr</th><th>vs year ago</th></tr></thead><tbody>` +
      qRow("Sales ₹ cr", q.sales_cr, q.sales_cr == null ? "" : nf1.format(q.sales_cr), q.sales_qoq, q.sales_yoy, "%") +
      qRow("Net profit ₹ cr", q.pat_cr, q.pat_cr == null ? "" : nf1.format(q.pat_cr), q.pat_qoq, q.pat_yoy, "%") +
      qRow("Operating margin", q.opm, q.opm == null ? "" : nf1.format(q.opm) + "%", q.opm_qoq, q.opm_yoy, " pts") +
      `</tbody></table>` : "";
    box.innerHTML = `<h3>Fundamentals${f.name ? ` <span>${f.name}</span>` : ""}</h3>` + qTable +
      `<dl>${shown.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>` +
      `<p class="fund-src">${sector ? sector + ". " : ""}Source: Yahoo Finance, may be out of date. Check the company's filings before relying on it.</p>`;
  }

  function clearChart() {
    $("chartMcap").innerHTML = ""; $("fund").hidden = true;
    state.symbol = null;
    $("chartTitle").textContent = "Pick a stock";
    $("chartSub").textContent = "Click any row to see its chart.";
    mainChart.clear();
  }
  function tvUrl(sym) { return `https://www.tradingview.com/chart/?symbol=NSE%3A${encodeURIComponent(sym)}`; }
  function tvLink(sym) {
    const a = document.createElement("a");
    a.href = tvUrl(sym);
    a.target = "_blank"; a.rel = "noopener"; a.textContent = "Open on TradingView";
    return a;
  }

  // ---------- charts-only grid ----------
  let gridObserver = null;
  function keyFact(r) {
    switch (state.screen) {
      case "VCP": return r.vcp_pivot != null ? `Pivot ₹${nf2.format(r.vcp_pivot)} (${signed(r.vcp_pct_from_pivot)}%), ${r.vcp_depths}` : "";
      case "Blue Sky": return r.ath != null ? `All-time high ₹${nf2.format(r.ath)} (${signed(r.pct_from_ath)}%)` : "";
      case "Murphy": return r.murphy_signal ? `${r.murphy_signal}, ${r.murphy_days_ago === 0 ? "today" : r.murphy_days_ago + "d ago"}, entry ₹${nf2.format(r.murphy_entry)}` : "";
      case "Base Breakout": return r.base_pivot != null ? `${r.base_state}, B${r.base_no}, pivot ₹${nf2.format(r.base_pivot)} (${signed(r.base_pct_from_pivot)}%), ${r.base_weeks}w${r.base_tags ? ", " + r.base_tags : ""}` : "";
      case "Ichimoku": return r.ich_signal ? `${r.ich_signal} ${r.ich_days_ago === 0 ? "today" : r.ich_days_ago + "d ago"}, score ${r.ich_score}, stop ₹${nf2.format(r.ich_sl)}` : "";
      case "50 EMA Pullback": return r.pb_ema50 != null ? `${r.pb_stage}, 50 EMA ₹${nf2.format(r.pb_ema50)} (${signed(r.pb_pct_from_ema)}%), RS ${r.rs_rating}` : "";
      case "Episodic Pivot": return r.ep_date ? `${r.ep_type} ${r.ep_days_ago === 0 ? "today" : r.ep_days_ago + "d ago"}: ${signed(r.ep_chg)}% on ${r.ep_rvol}× volume` +
        `${r.ep_catalyst ? ", " + r.ep_catalyst : ""}${r.ep_neglected ? ", was neglected" : ""}, EP low ₹${nf2.format(r.ep_low)}` : "";
      case "ATR Entry": return r.atr_signal_date ? `Signal ${r.atr_days_ago === 0 ? "today" : r.atr_days_ago + "d ago"}, entry line ₹${nf2.format(r.atr_line)} (${signed(r.atr_pct_from_line)}%), ${r.atr_ext} ATR over 50 SMA` : "";
      case "IPO Base": return r.ipo_high != null ? `Listing high ₹${nf2.format(r.ipo_high)} (${signed(r.ipo_pct_from_high)}%)` : "";
      default: return "";
    }
  }
  function renderGrid(list) {
    const grid = $("grid");
    if (gridObserver) gridObserver.disconnect();
    gridCharts.clear();
    grid.innerHTML = "";
    setPerRow(state.perRow);
    gridObserver = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        gridObserver.unobserve(en.target);
        const card = en.target, sym = card.dataset.symbol;
        const pc = new PriceChart(card.querySelector("canvas"), { mini: true });
        gridCharts.add(pc);
        card.querySelector('[data-act="in"]').addEventListener("click", () => pc.zoom(1 / 1.3));
        card.querySelector('[data-act="out"]').addEventListener("click", () => pc.zoom(1.3));
        card.querySelector('[data-act="reset"]').addEventListener("click", () => pc.reset());
        loadChart(sym).then((c) => pc.setData(c, chartOptions()))
          .catch(() => { card.querySelector(".card-note").textContent = "Chart data missing - it will appear after the next scan."; });
      }
    }, { rootMargin: "400px 0px" });

    const frag = document.createDocumentFragment();
    for (const r of list) {
      const card = document.createElement("article");
      card.className = "card";
      card.dataset.symbol = r.symbol;
      const chg = r["chg_1d_%"];
      card.innerHTML = `
        <header class="card-head">
          <a class="card-sym" href="${tvUrl(r.symbol)}" target="_blank" rel="noopener" title="Open ${r.symbol} on TradingView">${r.symbol}</a>
          <span class="card-px">₹${nf2.format(r.close)} ${chg != null ? `<span class="${chg >= 0 ? "pos" : "neg"}">${signed(chg)}%</span>` : ""}</span>
          ${r.rs_rating != null ? `<span class="card-rs">RS ${nf0.format(r.rs_rating)}</span>` : ""}
          ${r.market_cap_cr != null ? `<span class="card-mcap" title="Market capitalisation">M.cap ${mcapText(r.market_cap_cr)}</span>` : ""}
        </header>
        <p class="card-note">${[r.industry, keyFact(r)].filter(Boolean).join(". ")}</p>
        <p class="card-note card-hilo">${hiLoText(r)}</p>
        <canvas class="mini" tabindex="0" role="img" aria-label="${r.symbol} chart. Scroll to zoom, drag to move."></canvas>
        <div class="card-tools">
          <div class="zoom" role="group" aria-label="Zoom ${r.symbol}">
            <button type="button" data-act="out" aria-label="Zoom out">−</button>
            <button type="button" data-act="in" aria-label="Zoom in">+</button>
            <button type="button" data-act="reset">Reset</button>
          </div>
          <button type="button" class="card-open">Open with table</button>
        </div>`;
      card.querySelector(".card-open").addEventListener("click", () => { setView("table"); openStock(r.symbol, true); window.scrollTo({ top: $("tools").offsetTop - 12 }); });
      frag.appendChild(card);
      gridObserver.observe(card);
    }
    grid.appendChild(frag);
  }

  window.addEventListener("resize", () => requestAnimationFrame(() => mainChart.draw()));
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  if (mq.addEventListener) mq.addEventListener("change", () => mainChart.draw());

  init();
})();
