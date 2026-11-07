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
    "Multi-Year Base": "Back at a high that held for two years or more. Sorted by base length.",
    "IPO Base": "Recent listings basing just under their post-listing high.",
    "Trend Template": "Every liquid stock in a Stage-2 uptrend with RS 70 or more. The pool the VCP screen draws from.",
  };
  const ORDER = ["VCP", "Blue Sky", "Murphy", "Multi-Year Base", "IPO Base", "Trend Template"];

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
    myb_pivot: ["Old high ₹", "num"], myb_pct_from_pivot: ["From old high %", "signed"],
    myb_base_years: ["Base years", "num"], myb_depth: ["Base depth %", "pct"],
    listed_days: ["Days listed", "int"], ipo_high: ["Listing high ₹", "num"],
    ipo_pct_from_high: ["From high %", "signed"], ipo_base_days: ["Base days", "int"],
    ipo_depth: ["Base depth %", "pct"],
    murphy_signal: ["Signal", "txt"], murphy_signal_date: ["Signal date", "txt"],
    murphy_days_ago: ["Days ago", "int"], murphy_entry: ["Entry ₹", "num"],
    murphy_pct_from_entry: ["From entry %", "signed"],
    murphy_sma40w: ["40-week SMA ₹", "num"], murphy_weekly_macd_ok: ["Weekly MACD > signal", "bool"],
    adx14: ["ADX", "num"], murphy_rs_score: ["RS score vs index %", "signed"],
  };

  const $ = (id) => document.getElementById(id);
  const state = { data: null, screen: "VCP", sort: null, dir: -1, query: "", symbol: null, view: "table", perRow: 2 };
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
    wrap.style.height = sideBySide ? `${panel.offsetHeight}px` : "";
    wrap.style.maxHeight = sideBySide ? "none" : "";
  }
  new ResizeObserver(syncHeights).observe($("chartPanel"));
  window.addEventListener("resize", syncHeights);

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
  // Chart: candles, SMAs, key levels, volume, RS line, with zoom and pan
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
      this.bind();
      new ResizeObserver(() => this.draw()).observe(canvas);
    }

    setData(c, o = {}) {
      this.c = c; this.hover = -1; this.showSma10 = !!o.sma10 && !!c.sma10;
      this.auto = true; this.reset(); this.emit();
    }
    clear() { this.c = null; this.draw(); }
    emit() { if (this.onScale) this.onScale({ auto: this.auto, log: this.log }); }

    get n() { return this.c ? this.c.c.length : 0; }
    defaultBars() { return Math.min(this.n, this.mini ? 130 : 250); }
    reset() { this.auto = true; this.show(this.defaultBars()); this.emit(); }
    show(bars) {
      if (!this.c) return;
      bars = Math.min(this.n, bars);
      this.end = this.n + 2; this.start = this.end - bars - 2;
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
      const n = this.n, span = Math.max(15, Math.min(n + 4, this.end - this.start));
      if (this.start < -2) this.start = -2;
      this.end = this.start + span;
      if (this.end > n + 8) { this.end = n + 8; this.start = this.end - span; }
      if (this.start < -2) this.start = -2;
    }
    zoom(factor, anchor = 0.85) {
      if (!this.c) return;
      const span = this.end - this.start, a = this.start + span * anchor;
      const ns = Math.max(15, Math.min(this.n + 4, span * factor));
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
        for (const lv of c.levels || []) if (lv.price > lo * 0.92 && lv.price < hi * 1.08) { lo = Math.min(lo, lv.price); hi = Math.max(hi, lv.price); }
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
      line(c.sma200, css("--sma200"), Y, lw); line(c.sma150, css("--sma150"), Y, lw); line(c.sma50, css("--sma50"), Y, lw);
      if (this.showSma10) line(c.sma10, css("--sma10"), Y, lw);
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

      // key levels: merge near-equal prices, stagger labels
      const merged = [];
      for (const lv of (c.levels || []).slice().sort((a, b) => b.price - a.price)) {
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
      ? `${nf0.format(d.stocks_liquid)} liquid stocks (price of ₹${d.min_price ?? 50} or more and average daily turnover of ₹${d.min_turnover_cr} crore or more) out of ${nf0.format(d.stocks_scanned)} ${pretty(d.universe) === "all NSE stocks" ? "NSE stocks" : "in the " + pretty(d.universe)} scanned. `
      : `${nf0.format(d.stocks_scanned)} stocks from the ${pretty(d.universe)} scanned. `;
    $("meta").textContent = liquid + `RS line drawn against the ${BENCH ? BENCH.name : pretty(d.benchmark)} (change it in Settings). Updated ${timeOf(d.generated_at)}.`;

    renderScreens();
    setView(state.view, true);
    selectScreen(state.screen, true);

    $("search").addEventListener("input", (e) => { state.query = e.target.value.trim().toLowerCase(); refreshList(); });
    $("closeChart").addEventListener("click", () => $("chartPanel").classList.remove("open"));
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
      const rows = state.data.screens[name] || [];
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
    state.sort = null;
    for (const b of $("screens").children) b.setAttribute("aria-selected", b.dataset.screen === name ? "true" : "false");
    $("screenNote").textContent = SCREENS[name];
    $("pineGift").hidden = name !== "Murphy";
    if (name === "Murphy") loadPine();
    refreshList();
    if (state.view === "table") {
      const rows = state.data.screens[name] || [];
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

  function currentRows() {
    let list = (state.data.screens[state.screen] || []).slice();
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
    $("count").textContent = !all.length ? "" : list.length === all.length
      ? `${all.length} ${all.length === 1 ? "stock" : "stocks"}` : `${list.length} of ${all.length} stocks`;
    $("empty").hidden = all.length > 0;
    if (!all.length) {
      $("empty").innerHTML = `<h3>No stocks pass ${state.screen} today</h3><p>That's normal in a weak market, since bases form when leaders rest. Check the Trend Template list for stocks in an uptrend, or run the Colab notebook with looser settings.</p>`;
    }
    if (state.view === "table") renderTable(list, all.length);
    else renderGrid(list);
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
  function renderTable(list, total) {
    const cols = total ? Object.keys((state.data.screens[state.screen] || [])[0]).filter((c) => COLS[c]) : [];
    const thead = $("table").tHead, tbody = $("table").tBodies[0];
    thead.innerHTML = ""; tbody.innerHTML = "";
    $("table").hidden = total === 0;
    if (!total) return;

    const tr = document.createElement("tr");
    for (const c of cols) {
      const th = document.createElement("th");
      th.textContent = COLS[c][0];
      th.scope = "col"; th.tabIndex = 0;
      if (COLS[c][1] === "txt") th.className = "txt";
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
    $("sma10Legend").hidden = !(murphy && c.sma10);
    mainChart.setData(c, { sma10: murphy });
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
    if (!shown.length) { box.hidden = true; return; }
    box.hidden = false;
    const sector = [f.sector, f.yf_industry].filter(Boolean).join(" · ");
    box.innerHTML = `<h3>Fundamentals${f.name ? ` <span>${f.name}</span>` : ""}</h3>` +
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
      case "Multi-Year Base": return r.myb_pivot != null ? `Old high ₹${nf2.format(r.myb_pivot)} held ${r.myb_base_years} years` : "";
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
        loadChart(sym).then((c) => pc.setData(c, { sma10: state.screen === "Murphy" }))
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
