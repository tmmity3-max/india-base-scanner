/* India Base Scanner - website
 *
 * Reads latest.json and charts/<SYMBOL>.json from the repo's `data` branch
 * (published daily by GitHub Actions). No framework, no chart library.
 */
(() => {
  "use strict";

  const REPO_DATA = "https://raw.githubusercontent.com/tmmity3-max/india-base-scanner/data/";
  const LOCAL = /^(localhost|127\.|\[::1\])/.test(location.hostname);
  const DATA = LOCAL ? "data/" : REPO_DATA;

  const SCREENS = {
    "VCP": "Tightening pullbacks with volume drying up, close to the pivot. Sorted by RS rating.",
    "Blue Sky": "At or breaking out to an all-time high, with strong relative strength.",
    "Murphy": "John Murphy's 10 laws: a 33–66% pullback in an uptrend, at the 50-day average, with RSI and MACD turning up on lighter volume.",
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
    pct_from_52w_high: ["From 52w high %", "signed"], pct_above_52w_low: ["Above 52w low %", "pct"],
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
    murphy_retrace: ["Retrace %", "pct"], murphy_swing_high: ["Swing high ₹", "num"],
    pct_from_sma50: ["From SMA 50 %", "signed"], rsi14: ["RSI", "num"], adx14: ["ADX", "num"],
    macd_turning_up: ["MACD turning up", "bool"], murphy_pullback_bars: ["Pullback days", "int"],
    murphy_pullback_vol: ["Pullback vol ×", "x"],
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

  async function loadChart(sym) {
    if (chartCache.has(sym)) return chartCache.get(sym);
    const v = state.data ? state.data.data_date : "";
    const p = fetch(`${DATA}charts/${encodeURIComponent(sym)}.json?v=${v}`)
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
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
      this.c = null;
      this.hover = -1;
      this.pointers = new Map();
      this.bind();
      new ResizeObserver(() => this.draw()).observe(canvas);
    }

    setData(c) { this.c = c; this.hover = -1; this.reset(); }
    clear() { this.c = null; this.draw(); }

    get n() { return this.c ? this.c.c.length : 0; }
    defaultBars() { return Math.min(this.n, this.mini ? 130 : 250); }

    reset() { this.show(this.defaultBars()); }
    show(bars) {
      if (!this.c) return;
      bars = Math.min(this.n, bars);
      this.end = this.n + 2;
      this.start = this.end - bars - 2;
      this.clamp(); this.draw();
    }
    clamp() {
      const n = this.n, minSpan = 15, maxSpan = n + 4;
      let span = Math.max(minSpan, Math.min(maxSpan, this.end - this.start));
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
      this.clamp(); this.draw();
    }
    pan(bars) { if (!this.c) return; this.start += bars; this.end += bars; this.clamp(); this.draw(); }

    plotW() { return this.cv.clientWidth - (this.mini ? 46 : 62); }
    xToIndex(x) { return Math.floor(this.start + x / this.plotW() * (this.end - this.start)); }

    bind() {
      const cv = this.cv;
      cv.addEventListener("wheel", (e) => {
        if (!this.c) return;
        if (this.mini && !(e.ctrlKey || e.metaKey)) return; // let the page scroll in the grid
        e.preventDefault();
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
        this.drag = { x: e.offsetX, start: this.start, end: this.end, moved: false };
        if (this.pointers.size === 2) this.pinch = { d: this.pinchDist(), start: this.start, end: this.end, mid: this.pinchMid() };
        cv.classList.add("grabbing");
      });
      cv.addEventListener("pointermove", (e) => {
        if (!this.c) return;
        if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
        if (this.pinch && this.pointers.size === 2) {
          const f = this.pinch.d / Math.max(10, this.pinchDist());
          const span = (this.pinch.end - this.pinch.start), a = this.pinch.mid / this.plotW();
          const ns = Math.max(15, Math.min(this.n + 4, span * f));
          const anchorIdx = this.pinch.start + span * a;
          this.start = anchorIdx - ns * a; this.end = this.start + ns;
          this.clamp(); this.draw();
          return;
        }
        if (this.drag && this.pointers.size === 1) {
          const dx = e.offsetX - this.drag.x;
          if (Math.abs(dx) > 3) this.drag.moved = true;
          const per = (this.drag.end - this.drag.start) / this.plotW();
          this.start = this.drag.start - dx * per; this.end = this.drag.end - dx * per;
          this.clamp();
        }
        const i = e.offsetX > this.plotW() ? -1 : this.xToIndex(e.offsetX);
        this.hover = i; this.draw();
      });
      const up = (e) => {
        this.pointers.delete(e.pointerId);
        if (this.pointers.size < 2) this.pinch = null;
        if (this.pointers.size === 0) { this.drag = null; cv.classList.remove("grabbing"); }
      };
      cv.addEventListener("pointerup", up);
      cv.addEventListener("pointercancel", up);
      cv.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") { this.hover = -1; this.draw(); } });
      cv.addEventListener("dblclick", () => this.reset());
      cv.addEventListener("keydown", (e) => {
        const k = e.key;
        if (k === "+" || k === "=") this.zoom(1 / 1.25);
        else if (k === "-" || k === "_") this.zoom(1.25);
        else if (k === "ArrowLeft") this.pan(-(this.end - this.start) * 0.1);
        else if (k === "ArrowRight") this.pan((this.end - this.start) * 0.1);
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
      const hasRS = !!c.rs;
      const dateH = 16, gap = mini ? 6 : 10;
      const priceH = Math.round((H - dateH) * (hasRS ? 0.66 : 0.8));
      const volH = Math.round((H - dateH) * (hasRS ? 0.14 : 0.2)) - gap;
      const rsH = hasRS ? H - dateH - priceH - volH - gap * 2 : 0;
      const span = this.end - this.start, step = plotW / span;
      const bw = Math.max(1, Math.min(14, step * 0.7));
      const X = (i) => (i - this.start + 0.5) * step;
      const i0 = Math.max(0, Math.floor(this.start)), i1 = Math.min(n - 1, Math.ceil(this.end));
      if (i1 < i0) return;

      // price scale fits the visible bars (like TradingView's auto scale)
      let lo = Infinity, hi = -Infinity, vMax = 0;
      for (let i = i0; i <= i1; i++) { lo = Math.min(lo, c.l[i]); hi = Math.max(hi, c.h[i]); vMax = Math.max(vMax, c.v[i]); }
      for (const lv of c.levels || []) if (lv.price > lo * 0.92 && lv.price < hi * 1.08) { lo = Math.min(lo, lv.price); hi = Math.max(hi, lv.price); }
      const pad = (hi - lo) * 0.07 || hi * 0.05; lo -= pad; hi += pad;
      const padT = 4;
      const Y = (p) => padT + (hi - p) / (hi - lo) * (priceH - padT);

      const ink3 = css("--ink-3"), grid = css("--grid"), up = css("--up"), down = css("--down");
      ctx.font = `${mini ? 10 : 11}px ${css("--body")}`;
      ctx.textBaseline = "middle";

      ctx.strokeStyle = grid; ctx.fillStyle = ink3; ctx.lineWidth = 1;
      for (const t of niceTicks(lo, hi, mini ? 4 : 6)) {
        const y = Math.round(Y(t)) + 0.5;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotW, y); ctx.stroke();
        ctx.fillText(fmtAxis(t), axisX, y);
      }

      const line = (arr, color, y, width, a = i0, b = i1) => {
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
      for (let i = i0; i <= i1; i++) {
        const o = c.o[i], cl = c.c[i], col = cl >= o ? up : down;
        ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
        const x = Math.round(X(i)) + 0.5;
        ctx.beginPath(); ctx.moveTo(x, Y(c.h[i])); ctx.lineTo(x, Y(c.l[i])); ctx.stroke();
        const top = Y(Math.max(o, cl)), h = Math.max(1, Math.abs(Y(o) - Y(cl)));
        ctx.fillRect(X(i) - bw / 2, top, bw, h);
      }
      ctx.restore();

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
      if (hasRS) {
        const rTop = vTop + volH + gap;
        let rlo = Infinity, rhi = -Infinity;
        for (let i = i0; i <= i1; i++) { const v = c.rs[i]; if (v !== null) { rlo = Math.min(rlo, v); rhi = Math.max(rhi, v); } }
        if (rlo < Infinity) {
          const RY = (v) => rTop + (rhi - v) / ((rhi - rlo) || 1) * rsH;
          ctx.strokeStyle = grid; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(0, rTop - gap / 2 + 0.5); ctx.lineTo(plotW, rTop - gap / 2 + 0.5); ctx.stroke();
          ctx.save(); ctx.beginPath(); ctx.rect(0, rTop - 2, plotW, rsH + 4); ctx.clip();
          line(c.rs, css("--rs"), RY, mini ? 1 : 1.3);
          ctx.restore();
          ctx.fillStyle = ink3; ctx.fillText(mini ? "RS" : "RS line", axisX, rTop + 8);
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

      // crosshair + readout
      const hv = this.hover >= i0 && this.hover <= i1 ? this.hover : -1;
      if (hv >= 0) {
        ctx.strokeStyle = ink3; ctx.globalAlpha = 0.65; ctx.setLineDash([3, 3]);
        const x = Math.round(X(hv)) + 0.5;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H - dateH); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
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
  function fmtAxis(v) {
    if (v >= 100000) return nf0.format(Math.round(v / 1000)) + "k";
    if (v >= 1000) return nf0.format(v);
    return nf2.format(v).replace(/\.00$/, "");
  }

  // =====================================================================
  // Page
  // =====================================================================
  const mainChart = new PriceChart($("chart"), { readout: $("readout") });

  async function init() {
    readHash();
    try {
      const bucket = Math.floor(Date.now() / 600000); // refresh at most every 10 minutes
      const r = await fetch(`${DATA}latest.json?v=${bucket}`, { cache: "no-cache" });
      if (!r.ok) throw new Error(r.status);
      state.data = await r.json();
    } catch (e) {
      showNoData();
      return;
    }
    const d = state.data;
    $("headline").textContent = `Setups after the close on ${longDate(d.data_date)}`;
    const liquid = d.stocks_liquid != null
      ? `${nf0.format(d.stocks_liquid)} liquid stocks (average daily turnover of ₹${d.min_turnover_cr} crore or more) out of ${nf0.format(d.stocks_scanned)} ${pretty(d.universe) === "all NSE stocks" ? "NSE stocks" : "in the " + pretty(d.universe)} scanned. `
      : `${nf0.format(d.stocks_scanned)} stocks from the ${pretty(d.universe)} scanned. `;
    $("meta").textContent = liquid + `RS line measured against the ${pretty(d.benchmark)}. Updated ${timeOf(d.generated_at)}.`;

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
        td.textContent = text;
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
    $("chartTitle").textContent = sym;
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
    $("rsLegend").hidden = !c.rs;
    mainChart.setData(c);
  }
  function clearChart() {
    state.symbol = null;
    $("chartTitle").textContent = "Pick a stock";
    $("chartSub").textContent = "Click any row to see its chart.";
    mainChart.clear();
  }
  function tvLink(sym) {
    const a = document.createElement("a");
    a.href = `https://www.tradingview.com/chart/?symbol=NSE%3A${encodeURIComponent(sym)}`;
    a.target = "_blank"; a.rel = "noopener"; a.textContent = "Open on TradingView";
    return a;
  }

  // ---------- charts-only grid ----------
  let gridObserver = null;
  function keyFact(r) {
    switch (state.screen) {
      case "VCP": return r.vcp_pivot != null ? `Pivot ₹${nf2.format(r.vcp_pivot)} (${signed(r.vcp_pct_from_pivot)}%), ${r.vcp_depths}` : "";
      case "Blue Sky": return r.ath != null ? `All-time high ₹${nf2.format(r.ath)} (${signed(r.pct_from_ath)}%)` : "";
      case "Murphy": return r.murphy_retrace != null ? `Retraced ${nf0.format(r.murphy_retrace)}%, RSI ${nf0.format(r.rsi14)}, ADX ${nf0.format(r.adx14)}` : "";
      case "Multi-Year Base": return r.myb_pivot != null ? `Old high ₹${nf2.format(r.myb_pivot)} held ${r.myb_base_years} years` : "";
      case "IPO Base": return r.ipo_high != null ? `Listing high ₹${nf2.format(r.ipo_high)} (${signed(r.ipo_pct_from_high)}%)` : "";
      default: return r.pct_from_52w_high != null ? `${signed(r.pct_from_52w_high)}% from 52-week high` : "";
    }
  }
  function renderGrid(list) {
    const grid = $("grid");
    if (gridObserver) gridObserver.disconnect();
    grid.innerHTML = "";
    setPerRow(state.perRow);
    gridObserver = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        gridObserver.unobserve(en.target);
        const card = en.target, sym = card.dataset.symbol;
        const pc = new PriceChart(card.querySelector("canvas"), { mini: true });
        loadChart(sym).then((c) => pc.setData(c))
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
          <button class="card-sym" type="button" title="Open with the table">${r.symbol}</button>
          <span class="card-px">₹${nf2.format(r.close)} ${chg != null ? `<span class="${chg >= 0 ? "pos" : "neg"}">${signed(chg)}%</span>` : ""}</span>
          ${r.rs_rating != null ? `<span class="card-rs">RS ${nf0.format(r.rs_rating)}</span>` : ""}
        </header>
        <p class="card-note">${[r.industry, keyFact(r)].filter(Boolean).join(". ")}</p>
        <canvas class="mini" tabindex="0" role="img" aria-label="${r.symbol} chart"></canvas>`;
      card.querySelector(".card-sym").addEventListener("click", () => { setView("table"); openStock(r.symbol, true); });
      card.querySelector(".card-head").append(tvLink(r.symbol));
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
