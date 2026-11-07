/* NIFTY 50 / NIFTY Next 50 heatmap - squarified treemap grouped by sector. */
(() => {
  "use strict";
  const REPO_DATA = "https://raw.githubusercontent.com/tmmity3-max/india-base-scanner/data/";
  const LOCAL = /^(localhost|127\.|\[::1\])/.test(location.hostname);
  let DATA = LOCAL ? "data/" : REPO_DATA;
  const $ = (id) => document.getElementById(id);
  const nf2 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  const nf0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
  const RANGE = { d1: 3, w1: 6, m1: 10, m3: 20 };   // % change that gets the full colour
  const LABEL = { d1: "1 day", w1: "1 week", m1: "1 month", m3: "3 months" };
  const state = { data: null, index: "NIFTY50", period: "d1", size: "mcap" };

  const p = new URLSearchParams(location.hash.slice(1));
  const INDEX_NAMES = { NIFTY50: "NIFTY 50", NIFTYNEXT50: "NIFTY Next 50", MIDCAP150: "NIFTY Midcap 150", SMALLCAP250: "NIFTY Smallcap 250" };
  if (INDEX_NAMES[p.get("index")]) state.index = p.get("index");
  if (RANGE[p.get("period")]) state.period = p.get("period");

  const mcapText = (cr) => cr == null ? "–" : cr >= 100000 ? `₹${nf2.format(cr / 100000)} lakh cr` : `₹${nf0.format(cr)} cr`;
  const signed = (v) => v == null ? "–" : (v > 0 ? "+" : "") + nf2.format(v) + "%";

  // red -> grey -> green, symmetric around 0
  function color(v) {
    if (v == null) return "#7d8797";
    const t = Math.max(-1, Math.min(1, v / RANGE[state.period]));
    const neutral = [92, 102, 120], up = [22, 140, 84], down = [200, 50, 45];
    const to = t >= 0 ? up : down, a = Math.pow(Math.abs(t), 0.75);
    const c = neutral.map((n, i) => Math.round(n + (to[i] - n) * a));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }

  // ---- squarified treemap (Bruls et al.) ----
  function squarify(items, x, y, w, h) {
    const total = items.reduce((s, d) => s + d.value, 0);
    if (!total || w <= 0 || h <= 0) return [];
    const scale = (w * h) / total;
    const nodes = items.map((d) => ({ ...d, area: d.value * scale })).sort((a, b) => b.area - a.area);
    const out = [];
    let row = [], rect = { x, y, w, h };
    const worst = (r, side) => {
      const s = r.reduce((a, d) => a + d.area, 0), mx = Math.max(...r.map((d) => d.area)), mn = Math.min(...r.map((d) => d.area));
      return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
    };
    const layoutRow = (r) => {
      const s = r.reduce((a, d) => a + d.area, 0);
      if (rect.w >= rect.h) {
        const cw = s / rect.h; let cy = rect.y;
        for (const d of r) { const ch = d.area / cw; out.push({ ...d, x: rect.x, y: cy, w: cw, h: ch }); cy += ch; }
        rect = { x: rect.x + cw, y: rect.y, w: rect.w - cw, h: rect.h };
      } else {
        const ch = s / rect.w; let cx = rect.x;
        for (const d of r) { const cw = d.area / ch; out.push({ ...d, x: cx, y: rect.y, w: cw, h: ch }); cx += cw; }
        rect = { x: rect.x, y: rect.y + ch, w: rect.w, h: rect.h - ch };
      }
    };
    for (const n of nodes) {
      const side = Math.min(rect.w, rect.h);
      if (!row.length || worst([...row, n], side) <= worst(row, side)) row.push(n);
      else { layoutRow(row); row = [n]; }
    }
    if (row.length) layoutRow(row);
    return out;
  }

  function rows() {
    return (state.data.indices || {})[state.index] || [];
  }

  function render() {
    const box = $("hm"), W = box.clientWidth, H = box.clientHeight;
    box.innerHTML = "";
    const list = rows().filter((r) => r.close != null);
    const title = `${INDEX_NAMES[state.index]} heatmap`;
    $("hmTitle").textContent = title;
    document.title = `${title} – India Base Scanner`;
    if (!list.length) {
      box.innerHTML = `<div class="empty" style="position:absolute;inset:0;margin:auto;height:max-content;max-width:520px"><h3>No data for this index yet</h3><p>The heatmap fills in after the next daily scan.</p></div>`;
      $("hmStats").textContent = "";
      return;
    }
    const k = state.period;
    const val = (r) => state.size === "equal" ? 1 : Math.max(r.mcap_cr || r.turnover_cr * 50 || 1, 1);

    // stats
    const ch = list.map((r) => r[k]).filter((v) => v != null);
    const up = ch.filter((v) => v > 0).length, dn = ch.filter((v) => v < 0).length;
    const best = list.reduce((a, r) => (r[k] != null && (a == null || r[k] > a[k]) ? r : a), null);
    const worstR = list.reduce((a, r) => (r[k] != null && (a == null || r[k] < a[k]) ? r : a), null);
    const avg = ch.reduce((a, v) => a + v, 0) / (ch.length || 1);
    $("hmStats").innerHTML =
      `<span>${LABEL[k]}: <b class="pos">${up} up</b>, <b class="neg">${dn} down</b></span>` +
      `<span>Average <b class="${avg >= 0 ? "pos" : "neg"}">${signed(avg)}</b></span>` +
      (best ? `<span>Best <b>${best.symbol}</b> <span class="pos">${signed(best[k])}</span></span>` : "") +
      (worstR ? `<span>Worst <b>${worstR.symbol}</b> <span class="neg">${signed(worstR[k])}</span></span>` : "");

    // group by sector
    const groups = new Map();
    for (const r of list) {
      const g = r.industry || "Other";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(r);
    }
    const sectors = [...groups].map(([name, items]) => ({ name, items, value: items.reduce((s, r) => s + val(r), 0) }));
    for (const s of squarify(sectors, 0, 0, W, H)) {
      const el = document.createElement("div");
      el.className = "hm-sector";
      Object.assign(el.style, { left: s.x + "px", top: s.y + "px", width: s.w + "px", height: s.h + "px" });
      const head = s.h > 60 && s.w > 70 ? 17 : 0;
      if (head) { const lab = document.createElement("span"); lab.textContent = s.name; el.appendChild(lab); }
      box.appendChild(el);
      const tiles = squarify(s.items.map((r) => ({ r, value: val(r) })), s.x, s.y + head, s.w, s.h - head);
      for (const t of tiles) {
        const r = t.r, a = document.createElement("a");
        a.className = "hm-tile";
        a.href = `https://www.tradingview.com/chart/?symbol=NSE%3A${encodeURIComponent(r.symbol)}`;
        a.target = "_blank"; a.rel = "noopener";
        a.setAttribute("aria-label", `${r.symbol} ${signed(r[k])}`);
        Object.assign(a.style, { left: t.x + "px", top: t.y + "px", width: t.w + "px", height: t.h + "px", background: color(r[k]) });
        const f = fitLabel(r.symbol, t.w, t.h);
        if (f) {
          a.innerHTML = `<span class="s" style="font-size:${f.fs}px">${f.parts.join("<br>")}</span>` +
            (f.pct ? `<span class="p" style="font-size:${f.pctFs}px">${signed(r[k])}</span>` : "");
        }
        a.addEventListener("mousemove", (e) => tip(e, r));
        a.addEventListener("mouseleave", () => ($("hmTip").hidden = true));
        box.appendChild(a);
      }
    }
  }

  // Pick a font size so the symbol fits the tile, measuring the real text
  // width and splitting long names onto up to three lines when the tile is
  // narrow but tall enough.
  const measureCtx = document.createElement("canvas").getContext("2d");
  let symFont = null;
  function textW(t, fs) {
    if (!symFont) symFont = getComputedStyle(document.documentElement).getPropertyValue("--display").trim() || "sans-serif";
    measureCtx.font = `700 100px ${symFont}`;
    return (measureCtx.measureText(t).width / 100) * fs;
  }
  function split(sym, lines) {
    const n = Math.ceil(sym.length / lines), out = [];
    for (let i = 0; i < sym.length; i += n) out.push(sym.slice(i, i + n));
    return out;
  }
  function fitLabel(sym, w, h) {
    const LH = 1.1, availW = (w - 8) * 0.9, availH = h - 6;   // 10% margin: bold text renders a little wider
    let best = null;
    const maxLines = sym.length >= 10 ? 3 : sym.length >= 7 ? 2 : 1;   // never split short names
    for (let lines = 1; lines <= maxLines; lines++) {
      const parts = split(sym, lines);
      const widest = Math.max(...parts.map((t) => textW(t, 1)));
      let fs = Math.min(19, availW / widest, availH / (LH * parts.length));
      if (fs < 7) continue;
      if (lines > 1 && best && fs < best.fs * 1.15) continue;   // only wrap if it really helps
      best = { fs, parts };
    }
    if (!best) return null;                                       // too small to read: tooltip only
    const pctFs = Math.max(8, best.fs * 0.82);
    const pct = availH >= best.fs * LH * best.parts.length + pctFs * 1.15 && availW >= textW("+00.00%", pctFs) * 0.8;
    return { fs: +best.fs.toFixed(1), parts: best.parts, pct, pctFs: +pctFs.toFixed(1) };
  }

  function tip(e, r) {
    const t = $("hmTip");
    t.innerHTML = `<b>${r.symbol}</b>${r.name ? `<div style="color:var(--ink-3);margin-bottom:4px">${r.name}</div>` : ""}` +
      `<div class="row"><span>Close</span><span>₹${nf2.format(r.close)}</span></div>` +
      ["d1", "w1", "m1", "m3"].map((k) => `<div class="row"><span>${LABEL[k]}</span><span class="${r[k] >= 0 ? "pos" : "neg"}">${signed(r[k])}</span></div>`).join("") +
      `<div class="row"><span>Market cap</span><span>${mcapText(r.mcap_cr)}</span></div>` +
      `<div class="row"><span>Sector</span><span>${r.industry || "–"}</span></div>`;
    t.hidden = false;
    const x = Math.min(e.clientX + 14, window.innerWidth - t.offsetWidth - 8);
    const y = Math.min(e.clientY + 14, window.innerHeight - t.offsetHeight - 8);
    t.style.left = x + "px"; t.style.top = y + "px";
  }

  function legend() {
    const r = RANGE[state.period];
    const stops = [-1, -0.5, 0, 0.5, 1].map((t) => color(t * r)).join(",");
    $("hmLegend").innerHTML = `<span>−${r}%</span><span class="bar" style="background:linear-gradient(90deg,${stops})"></span><span>+${r}%</span>`;
  }

  function press(attr, v) {
    for (const b of document.querySelectorAll(`[data-${attr}]`)) b.setAttribute("aria-pressed", b.dataset[attr] === v ? "true" : "false");
  }
  function cards() {
    const box = $("idxCards"), ret = (state.data && state.data.index_returns) || {};
    box.innerHTML = "";
    for (const idx of Object.keys(INDEX_NAMES)) {
      const r = ret[idx];
      const b = document.createElement("button");
      b.type = "button"; b.className = "idx-card"; b.dataset.index = idx;
      b.setAttribute("aria-pressed", idx === state.index ? "true" : "false");
      const main = r ? r[state.period] : null;
      const cls = (v) => (v == null ? "" : v >= 0 ? "pos" : "neg");
      b.innerHTML =
        `<div class="idx-name">${INDEX_NAMES[idx]}</div>` +
        `<div class="idx-level">${r && r.level != null ? nf2.format(r.level) : r && r.source === "estimate" ? "Estimated from members" : ""}</div>` +
        `<div class="idx-main ${cls(main)}">${signed(main)}</div>` +
        `<div class="idx-sub">${["d1", "w1", "m1", "m3"].map((k) => `<div class="${k === state.period ? "on" : ""}"><span>${{ d1: "1D", w1: "1W", m1: "1M", m3: "3M" }[k]}</span><b class="${cls(r && r[k])}">${signed(r ? r[k] : null)}</b></div>`).join("")}</div>`;
      b.title = `Show the ${INDEX_NAMES[idx]} heatmap`;
      b.addEventListener("click", () => { state.index = idx; update(); });
      box.appendChild(b);
    }
  }

  function update() {
    press("index", state.index); press("period", state.period); press("size", state.size);
    cards();
    history.replaceState(null, "", `#index=${state.index}&period=${state.period}`);
    legend(); render();
  }

  async function init() {
    for (const b of document.querySelectorAll("[data-index]")) b.addEventListener("click", () => { state.index = b.dataset.index; update(); });
    for (const b of document.querySelectorAll("[data-period]")) b.addEventListener("click", () => { state.period = b.dataset.period; update(); });
    for (const b of document.querySelectorAll("[data-size]")) b.addEventListener("click", () => { state.size = b.dataset.size; update(); });
    let t; window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(render, 120); });
    try {
      DATA = await window.ibsDataBase();
      const r = await fetch(`${DATA}heatmap.json?v=${Math.floor(Date.now() / 600000)}`, { cache: "no-cache" });
      if (!r.ok) throw new Error(r.status);
      state.data = await r.json();
    } catch (e) {
      $("hmMeta").textContent = "The heatmap hasn't been published yet. It appears after the next daily scan.";
      return;
    }
    const d = state.data.data_date ? new Date(state.data.data_date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "";
    $("hmMeta").textContent = `Close of ${d}. Tiles are sized by market cap and coloured by price change.`;
    update();
  }
  init();
})();
