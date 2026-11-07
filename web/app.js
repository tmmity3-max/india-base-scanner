/* India Base Scanner - website
 * Reads data/latest.json (written daily by scripts/daily_scan.py) and
 * data/charts/<SYMBOL>.json. No framework, no chart library.
 */
(() => {
  "use strict";

  const SCREENS = {
    "VCP": "Tightening pullbacks with volume drying up, close to the pivot. Sorted by RS rating.",
    "Blue Sky": "At or breaking out to an all-time high, with strong relative strength.",
    "Multi-Year Base": "Back at a high that held for two years or more. Sorted by base length.",
    "IPO Base": "Recent listings basing just under their post-listing high.",
    "Trend Template": "Every stock in a Stage-2 uptrend with RS 70 or more. The pool the VCP screen draws from.",
  };
  const ORDER = ["VCP", "Blue Sky", "Multi-Year Base", "IPO Base", "Trend Template"];

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
  };

  const $ = (id) => document.getElementById(id);
  const state = { data: null, screen: "VCP", sort: null, dir: -1, query: "", symbol: null, chart: null };
  const chartCache = new Map();

  // ---------- formatting ----------
  const nf2 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  const nf0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
  function fmt(v, kind) {
    if (v === null || v === undefined || v === "") return ["–", "dim"];
    switch (kind) {
      case "txt": return [String(v), ""];
      case "int": return [nf0.format(v), ""];
      case "num": return [nf2.format(v), ""];
      case "pct": return [nf2.format(v), ""];
      case "x": return [nf2.format(v) + "×", v >= 1.5 ? "pos" : ""];
      case "signed": return [(v > 0 ? "+" : "") + nf2.format(v), v > 0 ? "pos" : v < 0 ? "neg" : ""];
      case "bool": return v ? ["Yes", "yes"] : ["–", "dim"];
      default: return [String(v), ""];
    }
  }
  const longDate = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN",
    { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  // ---------- URL state ----------
  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    if (p.get("screen") && SCREENS[p.get("screen")]) state.screen = p.get("screen");
    if (p.get("stock")) state.symbol = p.get("stock").toUpperCase();
  }
  function writeHash() {
    const p = new URLSearchParams({ screen: state.screen });
    if (state.symbol) p.set("stock", state.symbol);
    history.replaceState(null, "", "#" + p.toString());
  }

  // ---------- load ----------
  async function init() {
    readHash();
    try {
      const r = await fetch("data/latest.json", { cache: "no-cache" });
      if (!r.ok) throw new Error(r.status);
      state.data = await r.json();
    } catch (e) {
      showNoData();
      return;
    }
    const d = state.data;
    $("headline").textContent = `Setups after the close on ${longDate(d.data_date)}`;
    $("meta").textContent =
      `${nf0.format(d.stocks_scanned)} stocks from the ${pretty(d.universe)} scanned. ` +
      `RS line measured against the ${pretty(d.benchmark)}. Updated ${timeOf(d.generated_at)}.`;
    renderScreens();
    selectScreen(state.screen, true);
    $("search").addEventListener("input", (e) => { state.query = e.target.value.trim().toLowerCase(); renderTable(); });
    $("closeChart").addEventListener("click", () => $("chartPanel").classList.remove("open"));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("chartPanel").classList.remove("open"); });
  }
  const pretty = (u) => (u || "").replace(/^NIFTY(\d+)$/, "NIFTY $1").replace("ALL_EQ", "all NSE stocks");
  const timeOf = (iso) => {
    const t = new Date(iso);
    return isNaN(t) ? iso : t.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) + " IST";
  };

  function showNoData() {
    $("headline").textContent = "No scan published yet";
    $("meta").textContent = "The daily scan hasn't run for this site yet.";
    $("workspace").hidden = true;
    $("screens").hidden = true;
    const box = document.createElement("div");
    box.className = "empty";
    box.innerHTML = `<h3>Run the first scan</h3>
      <p>Open the repository on GitHub, go to <b>Actions → Daily scan → Run workflow</b>. When it finishes (about 5 minutes), Vercel redeploys and today's setups appear here.</p>
      <p>After that it runs on its own every weekday after the market closes.</p>`;
    $("screenNote").replaceWith(box);
  }

  // ---------- screens ----------
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
    renderTable();
    const rows = state.data.screens[name] || [];
    const keep = initial && state.symbol && rows.some((r) => r.symbol === state.symbol);
    if (keep) openStock(state.symbol, false);
    else if (rows.length && window.matchMedia("(min-width: 1081px)").matches) openStock(rows[0].symbol, false);
    else if (!rows.length) clearChart();
    writeHash();
  }

  // ---------- table ----------
  function renderTable() {
    const rows = (state.data.screens[state.screen] || []).slice();
    const cols = rows.length ? Object.keys(rows[0]).filter((c) => COLS[c]) : [];
    const thead = $("table").tHead, tbody = $("table").tBodies[0];
    thead.innerHTML = ""; tbody.innerHTML = "";

    let list = rows;
    if (state.query) list = rows.filter((r) => (r.symbol + " " + (r.industry || "")).toLowerCase().includes(state.query));
    if (state.sort) {
      const k = state.sort, dir = state.dir;
      list.sort((a, b) => {
        const x = a[k], y = b[k];
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        return (typeof x === "string" ? x.localeCompare(y) : x - y) * dir;
      });
    }

    $("empty").hidden = rows.length > 0;
    $("table").hidden = rows.length === 0;
    if (!rows.length) {
      $("empty").innerHTML = `<h3>No stocks pass ${state.screen} today</h3><p>That's normal in a weak market, since bases form when leaders rest. Check the Trend Template list for stocks in an uptrend, or run the Colab notebook with looser settings.</p>`;
      $("count").textContent = "";
      return;
    }

    const tr = document.createElement("tr");
    for (const c of cols) {
      const th = document.createElement("th");
      th.textContent = COLS[c][0];
      th.scope = "col";
      th.tabIndex = 0;
      if (COLS[c][1] === "txt") th.className = "txt";
      if (state.sort === c) th.setAttribute("aria-sort", state.dir > 0 ? "ascending" : "descending");
      const sortBy = () => {
        if (state.sort === c) state.dir = -state.dir;
        else { state.sort = c; state.dir = COLS[c][1] === "txt" ? 1 : -1; }
        renderTable();
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
    $("count").textContent = list.length === rows.length ? `${rows.length} ${rows.length === 1 ? "stock" : "stocks"}` : `${list.length} of ${rows.length} stocks`;
  }

  // ---------- chart ----------
  async function openStock(sym, userAction) {
    state.symbol = sym;
    writeHash();
    for (const tr of $("table").tBodies[0].rows) tr.setAttribute("aria-selected", tr.dataset.symbol === sym ? "true" : "false");
    if (userAction) $("chartPanel").classList.add("open");
    $("chartTitle").textContent = sym;
    $("chartSub").textContent = "Loading chart…";
    let c = chartCache.get(sym);
    if (!c) {
      try {
        const r = await fetch(`data/charts/${encodeURIComponent(sym)}.json`);
        if (!r.ok) throw new Error(r.status);
        c = await r.json();
        chartCache.set(sym, c);
      } catch (e) {
        $("chartSub").textContent = "Chart data is missing for this stock. It will appear after the next scan.";
        state.chart = null; draw();
        return;
      }
    }
    if (state.symbol !== sym) return;
    state.chart = c;
    const row = (state.data.screens[state.screen] || []).find((r) => r.symbol === sym) || {};
    const bits = [];
    if (row.industry) bits.push(row.industry);
    if (c.screens && c.screens.length) bits.push("In: " + c.screens.join(", "));
    $("chartSub").innerHTML = "";
    const tv = document.createElement("a");
    tv.href = `https://www.tradingview.com/chart/?symbol=NSE%3A${encodeURIComponent(sym)}`;
    tv.target = "_blank"; tv.rel = "noopener"; tv.textContent = "Open on TradingView";
    $("chartSub").append(bits.join(". ") + (bits.length ? ". " : ""), tv);
    $("rsLegend").hidden = !c.rs;
    hover = -1;
    draw();
  }

  function clearChart() {
    state.chart = null; state.symbol = null;
    $("chartTitle").textContent = "Pick a stock";
    $("chartSub").textContent = "Click any row to see its chart.";
    draw();
  }

  const canvas = $("chart");
  const ctx = canvas.getContext("2d");
  let hover = -1, geom = null;
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) return;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const c = state.chart;
    const ink3 = css("--ink-3"), grid = css("--grid");
    if (!c) { geom = null; $("readout").textContent = ""; return; }

    const n = c.c.length, axisW = 62, padT = 6;
    const hasRS = !!c.rs;
    const priceH = Math.round(H * (hasRS ? 0.62 : 0.78)), gap = 10;
    const volH = Math.round(H * (hasRS ? 0.14 : 0.18));
    const rsH = hasRS ? H - priceH - volH - gap * 2 - 18 : 0;
    const plotW = W - axisW;
    const step = plotW / n, bw = Math.max(1, Math.min(9, step * 0.68));
    const X = (i) => i * step + step / 2;

    // price scale (include levels if they're close to the range)
    let lo = Math.min(...c.l), hi = Math.max(...c.h);
    for (const lv of c.levels || []) if (lv.price > lo * 0.85 && lv.price < hi * 1.15) { lo = Math.min(lo, lv.price); hi = Math.max(hi, lv.price); }
    const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
    const Y = (p) => padT + (hi - p) / (hi - lo) * (priceH - padT);

    ctx.font = `11px ${css("--body")}`;
    ctx.textBaseline = "middle";
    // grid + price axis
    const ticks = niceTicks(lo, hi, 6);
    ctx.strokeStyle = grid; ctx.fillStyle = ink3; ctx.lineWidth = 1;
    for (const t of ticks) {
      const y = Math.round(Y(t)) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotW, y); ctx.stroke();
      ctx.fillText(nf2.format(t).replace(/\.00$/, ""), plotW + 6, y);
    }

    // SMAs and candles are clipped to the price pane
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, plotW, priceH); ctx.clip();
    const line = (arr, color, y, width = 1.4) => {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
      let on = false;
      arr.forEach((v, i) => { if (v === null) { on = false; return; } const px = X(i), py = y(v); on ? ctx.lineTo(px, py) : ctx.moveTo(px, py); on = true; });
      ctx.stroke();
    };
    line(c.sma200, css("--sma200"), Y); line(c.sma150, css("--sma150"), Y); line(c.sma50, css("--sma50"), Y);

    // candles
    const up = css("--up"), down = css("--down");
    for (let i = 0; i < n; i++) {
      const o = c.o[i], cl = c.c[i];
      const col = cl >= o ? up : down;
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
      const x = Math.round(X(i)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, Y(c.h[i])); ctx.lineTo(x, Y(c.l[i])); ctx.stroke();
      const top = Y(Math.max(o, cl)), h = Math.max(1, Math.abs(Y(o) - Y(cl)));
      ctx.fillRect(X(i) - bw / 2, top, bw, h);
    }

    ctx.restore();

    // key levels - merge levels at (almost) the same price, stagger close labels
    const merged = [];
    for (const lv of (c.levels || []).slice().sort((a, b) => b.price - a.price)) {
      const m = merged.find((x) => Math.abs(x.price - lv.price) / lv.price < 0.004);
      if (m) m.label += " / " + lv.label; else merged.push({ ...lv });
    }
    ctx.setLineDash([5, 4]);
    let lastLabelY = -99;
    for (const lv of merged) {
      if (lv.price < lo || lv.price > hi) continue;
      const y = Math.round(Y(lv.price)) + 0.5;
      ctx.strokeStyle = css("--saffron"); ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotW, y); ctx.stroke();
      ctx.fillStyle = css("--saffron-ink");
      let ly = y - 9;
      if (ly - lastLabelY < 14) ly = lastLabelY + 14;
      ctx.fillText(`${lv.label} ${nf2.format(lv.price)}`, 6, ly);
      lastLabelY = ly;
    }
    ctx.setLineDash([]);

    // volume
    const vTop = priceH + gap, vMax = Math.max(...c.v) || 1;
    for (let i = 0; i < n; i++) {
      const h = c.v[i] / vMax * volH;
      ctx.fillStyle = (c.c[i] >= c.o[i] ? up : down);
      ctx.globalAlpha = 0.55;
      ctx.fillRect(X(i) - bw / 2, vTop + volH - h, bw, h);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = ink3; ctx.fillText("Volume", plotW + 6, vTop + 8);

    // RS line
    if (hasRS) {
      const rTop = vTop + volH + gap;
      const vals = c.rs.filter((v) => v !== null);
      const rlo = Math.min(...vals), rhi = Math.max(...vals);
      const RY = (v) => rTop + (rhi - v) / ((rhi - rlo) || 1) * rsH;
      ctx.strokeStyle = grid; ctx.beginPath(); ctx.moveTo(0, rTop - gap / 2); ctx.lineTo(plotW, rTop - gap / 2); ctx.stroke();
      line(c.rs, css("--rs"), RY, 1.3);
      ctx.fillStyle = ink3; ctx.fillText("RS line", plotW + 6, rTop + 8);
    }

    // date axis
    ctx.fillStyle = ink3; ctx.textBaseline = "alphabetic";
    let lastM = "", nextFree = 0;
    for (let i = 0; i < n; i++) {
      const m = c.d[i].slice(0, 7);
      if (m !== lastM && i > 3) {
        const dt = new Date(c.d[i] + "T00:00:00");
        const label = dt.getMonth() === 0 ? String(dt.getFullYear()) : dt.toLocaleDateString("en-IN", { month: "short" });
        const w = ctx.measureText(label).width, x = X(i) - w / 2;
        if (x >= nextFree && x + w < plotW) { ctx.fillText(label, x, H - 2); nextFree = x + w + 12; }
      }
      lastM = m;
    }

    // crosshair
    const i = hover >= 0 && hover < n ? hover : n - 1;
    if (hover >= 0 && hover < n) {
      ctx.strokeStyle = ink3; ctx.globalAlpha = 0.6; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(Math.round(X(i)) + 0.5, 0); ctx.lineTo(Math.round(X(i)) + 0.5, H - 14); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    geom = { step, n, plotW };
    const chg = i > 0 ? (c.c[i] / c.c[i - 1] - 1) * 100 : 0;
    const date = new Date(c.d[i] + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
    $("readout").innerHTML =
      `<span><b>${date}</b></span><span>O <b>${nf2.format(c.o[i])}</b></span><span>H <b>${nf2.format(c.h[i])}</b></span>` +
      `<span>L <b>${nf2.format(c.l[i])}</b></span><span>C <b>${nf2.format(c.c[i])}</b></span>` +
      `<span class="${chg >= 0 ? "pos" : "neg"}">${chg >= 0 ? "+" : ""}${nf2.format(chg)}%</span>` +
      `<span>Vol <b>${nf0.format(c.v[i])}</b></span>`;
  }

  function niceTicks(lo, hi, count) {
    const raw = (hi - lo) / count, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const stepV = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
    const out = [];
    for (let t = Math.ceil(lo / stepV) * stepV; t <= hi; t += stepV) out.push(+t.toFixed(6));
    return out;
  }

  canvas.addEventListener("mousemove", (e) => {
    if (!geom) return;
    const x = e.offsetX;
    const i = x > geom.plotW ? -1 : Math.floor(x / geom.step);
    if (i !== hover) { hover = i; draw(); }
  });
  canvas.addEventListener("mouseleave", () => { hover = -1; draw(); });
  canvas.addEventListener("touchmove", (e) => {
    if (!geom) return;
    const r = canvas.getBoundingClientRect(), x = e.touches[0].clientX - r.left;
    hover = Math.max(0, Math.min(geom.n - 1, Math.floor(x / geom.step))); draw();
  }, { passive: true });
  window.addEventListener("resize", () => requestAnimationFrame(draw));
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", draw);
  new ResizeObserver(() => draw()).observe(canvas);

  init();
})();
