/* India Base Scanner - drawing tools for the price chart
 *
 * Trend line, ray, extended line, horizontal line and ray, vertical line,
 * arrow, arrow marks, rectangle, ellipse, parallel channel, Fibonacci
 * retracement, path, brush, text and a ruler that measures price, % and time.
 *
 * Drawings are kept in this browser, one list per stock. Each point is stored
 * as a date plus a bar offset and a price, so a drawing stays on the same
 * candles when new days are added to the chart.
 */
(() => {
  "use strict";

  const TOOLS = [
    // id, title, keyboard shortcut (Alt+key), how it is drawn, icon
    ["cursor", "Select and move drawings", "", "none", '<path d="M6 3l12 9-5.2 1.1L15.5 20l-2.4 1-2.7-6.8L6 18z"/>'],
    ["trend", "Trend line", "T", "two", '<path d="M4 19L20 5"/><circle cx="4" cy="19" r="1.7"/><circle cx="20" cy="5" r="1.7"/>'],
    ["ray", "Ray", "", "two", '<path d="M5 19L22 3"/><circle cx="5" cy="19" r="1.7"/><circle cx="12" cy="12.4" r="1.7"/>'],
    ["extended", "Extended line", "", "two", '<path d="M2 21L22 3"/><circle cx="8.5" cy="15" r="1.7"/><circle cx="15.5" cy="9" r="1.7"/>'],
    ["hline", "Horizontal line", "H", "one", '<path d="M2 12h20"/><circle cx="12" cy="12" r="1.7"/>'],
    ["hray", "Horizontal ray", "J", "one", '<path d="M7 12h15"/><circle cx="7" cy="12" r="1.7"/>'],
    ["vline", "Vertical line", "V", "one", '<path d="M12 2v20"/><circle cx="12" cy="12" r="1.7"/>'],
    ["arrow", "Arrow", "", "two", '<path d="M4 20L19 5M19 5h-7.5M19 5v7.5"/>'],
    ["arrowUp", "Arrow mark up", "", "one", '<path d="M12 4l6 7h-3.6v8H9.6v-8H6z"/>'],
    ["arrowDown", "Arrow mark down", "", "one", '<path d="M12 20l6-7h-3.6V5H9.6v8H6z"/>'],
    ["rect", "Rectangle", "R", "two", '<rect x="4" y="6" width="16" height="12" rx="1"/>'],
    ["ellipse", "Ellipse", "E", "two", '<ellipse cx="12" cy="12" rx="9" ry="6"/>'],
    ["channel", "Parallel channel", "C", "channel", '<path d="M3 15L15 3M9 21L21 9"/>'],
    ["fib", "Fibonacci retracement", "F", "two", '<path d="M3 4h18M3 9h18M3 13.5h18M3 20h18"/>'],
    ["path", "Path (click each point, double-click to finish)", "P", "path", '<path d="M3 18l5-8 5 5 8-11"/><circle cx="3" cy="18" r="1.4"/><circle cx="21" cy="4" r="1.4"/>'],
    ["brush", "Brush", "B", "brush", '<path d="M21 3l-8.6 8.6"/><path d="M12.4 11.6c-1.6-.5-3.3.2-3.9 1.8-.6 1.5-.1 2.9-2.5 4.1 3 1.2 6.4.4 7.6-1.8.7-1.3.3-2.8-1.2-4.1z"/><path d="M3 21c1.6-.9 3.1-1 4.6-.4"/>'],
    ["text", "Text", "X", "text", '<path d="M5 5h14M12 5v15M9 20h6"/>'],
    ["ruler", "Ruler: measure price, % and time (or Shift + drag)", "M", "two", '<path d="M3 16L16 3l5 5L8 21z"/><path d="M7 12l2 2M10 9l2 2M13 6l2 2"/>'],
  ];
  const KIND = Object.fromEntries(TOOLS.map((t) => [t[0], t[3]]));
  const TITLE = Object.fromEntries(TOOLS.map((t) => [t[0], t[1]]));
  const COLORS = [["ink", "Ink"], ["#2962FF", "Blue"], ["#F23645", "Red"], ["#089981", "Green"], ["#FF9800", "Orange"], ["#AB47BC", "Purple"], ["#F9C80E", "Yellow"]];
  const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  const FIB_COL = ["#787B86", "#F23645", "#FF9800", "#4CAF50", "#089981", "#00BCD4", "#787B86"];
  const TOL = 7;                     // how close (px) a pointer must be to pick a drawing
  const SKEY = (sym) => `ibs-draw:${sym}`;
  const PKEY = "ibs-draw-prefs";

  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const colorOf = (c) => (c === "ink" || !c ? css("--ink") : c === "up" ? css("--up") : c === "down" ? css("--down") : c);
  const fmtP = (v) => (v == null || !isFinite(v) ? "" : v.toLocaleString("en-IN", { maximumFractionDigits: Math.abs(v) >= 1000 ? 1 : 2, minimumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2 }));
  const uid = () => Math.random().toString(36).slice(2, 10);

  function load(sym) {
    try { const v = JSON.parse(localStorage.getItem(SKEY(sym)) || "[]"); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }
  function save(sym, items) {
    try { items.length ? localStorage.setItem(SKEY(sym), JSON.stringify(items)) : localStorage.removeItem(SKEY(sym)); }
    catch (e) { /* storage full or private window */ }
  }

  // ---------- points: date + bar offset + price <-> chart index ----------
  function lowerBound(arr, v) {
    let lo = 0, hi = arr.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; }
    return lo;
  }
  function makeConv(g, dates, dmap) {
    const idxOf = (a) => { let b = dmap.get(a.d); if (b === undefined) b = Math.min(dates.length - 1, lowerBound(dates, a.d)); return b + (a.f || 0); };
    return {
      idxOf,
      x: (a) => g.X(idxOf(a)),
      y: (a) => g.Y(a.p),
      anchor(idx, p) {
        const n = dates.length; const b = Math.max(0, Math.min(n - 1, Math.round(idx)));
        return { d: dates[b], f: Math.round((idx - b) * 1000) / 1000, p: Math.round(p * 100) / 100 };
      },
      idxAt: (x) => g.start + x / g.step - 0.5,
    };
  }

  // ---------- geometry helpers ----------
  function distSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }
  // a line through a and b, stretched far past b (ray) or both ways (extended)
  function stretch(ax, ay, bx, by, back, fwd) {
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, F = 20000;
    return [back ? ax - ux * F : ax, back ? ay - uy * F : ay, fwd ? bx + ux * F : bx, fwd ? by + uy * F : by];
  }

  // screen points of a drawing
  function screenPts(it, cv) { return it.pts.map((a) => [cv.x(a), cv.y(a)]); }

  // ---------- drawing one item ----------
  function drawItem(ctx, g, cv, it, selected, ghost) {
    const P = screenPts(it, cv), col = colorOf(it.color);
    const w = it.type === "brush" ? (it.width || 2) * 2 + 1 : it.width || 2;   // brush strokes are drawn thicker
    ctx.save();
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = w; ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (ghost) ctx.globalAlpha = 0.85;
    const seg = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
    const t = it.type;
    if (t === "trend" || t === "ray" || t === "extended" || t === "arrow") {
      const [a, b] = P;
      const s = stretch(a[0], a[1], b[0], b[1], t === "extended", t === "ray" || t === "extended");
      seg(...s);
      if (t === "arrow") {
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), L = 9 + w * 2;
        ctx.beginPath(); ctx.moveTo(b[0], b[1]);
        ctx.lineTo(b[0] - L * Math.cos(ang - 0.45), b[1] - L * Math.sin(ang - 0.45));
        ctx.lineTo(b[0] - L * Math.cos(ang + 0.45), b[1] - L * Math.sin(ang + 0.45));
        ctx.closePath(); ctx.fill();
      }
    } else if (t === "hline") {
      seg(0, Math.round(P[0][1]) + 0.5, g.plotW, Math.round(P[0][1]) + 0.5);
    } else if (t === "hray") {
      seg(P[0][0], Math.round(P[0][1]) + 0.5, g.plotW, Math.round(P[0][1]) + 0.5);
    } else if (t === "vline") {
      seg(Math.round(P[0][0]) + 0.5, 0, Math.round(P[0][0]) + 0.5, g.priceH);
    } else if (t === "arrowUp" || t === "arrowDown") {
      const [x, y] = P[0], up = t === "arrowUp", s = 7 + w;
      ctx.beginPath();
      if (up) { ctx.moveTo(x, y); ctx.lineTo(x + s, y + s * 1.1); ctx.lineTo(x + s * 0.4, y + s * 1.1); ctx.lineTo(x + s * 0.4, y + s * 2.2); ctx.lineTo(x - s * 0.4, y + s * 2.2); ctx.lineTo(x - s * 0.4, y + s * 1.1); ctx.lineTo(x - s, y + s * 1.1); }
      else { ctx.moveTo(x, y); ctx.lineTo(x + s, y - s * 1.1); ctx.lineTo(x + s * 0.4, y - s * 1.1); ctx.lineTo(x + s * 0.4, y - s * 2.2); ctx.lineTo(x - s * 0.4, y - s * 2.2); ctx.lineTo(x - s * 0.4, y - s * 1.1); ctx.lineTo(x - s, y - s * 1.1); }
      ctx.closePath(); ctx.fill();
    } else if (t === "rect") {
      const [a, b] = P, x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]), W = Math.abs(a[0] - b[0]), H = Math.abs(a[1] - b[1]);
      ctx.globalAlpha = 0.12; ctx.fillRect(x, y, W, H); ctx.globalAlpha = ghost ? 0.85 : 1;
      ctx.strokeRect(x, y, W, H);
    } else if (t === "ellipse") {
      const [a, b] = P, cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2, rx = Math.abs(a[0] - b[0]) / 2, ry = Math.abs(a[1] - b[1]) / 2;
      ctx.beginPath(); ctx.ellipse(cx, cy, Math.max(rx, 0.5), Math.max(ry, 0.5), 0, 0, Math.PI * 2);
      ctx.globalAlpha = 0.12; ctx.fill(); ctx.globalAlpha = ghost ? 0.85 : 1; ctx.stroke();
    } else if (t === "channel") {
      const [a, b] = P, c = P[2] || P[1], dy = c[1] - b[1] - (c[0] - b[0]) * ((b[1] - a[1]) / ((b[0] - a[0]) || 1));
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(b[0], b[1] + dy); ctx.lineTo(a[0], a[1] + dy); ctx.closePath();
      ctx.globalAlpha = 0.1; ctx.fill(); ctx.globalAlpha = ghost ? 0.85 : 1;
      seg(a[0], a[1], b[0], b[1]); seg(a[0], a[1] + dy, b[0], b[1] + dy);
      ctx.setLineDash([4, 4]); ctx.lineWidth = 1; seg(a[0], a[1] + dy / 2, b[0], b[1] + dy / 2); ctx.setLineDash([]);
    } else if (t === "fib") {
      const [a, b] = P, x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]);
      const p1 = it.pts[0].p, p2 = it.pts[1].p;
      ctx.font = `500 11px ${css("--body")}`; ctx.textBaseline = "bottom";
      let prevY = null;
      FIB.forEach((lv, k) => {
        const price = p2 + (p1 - p2) * lv, y = Math.round(g.Y(price)) + 0.5;
        if (prevY != null) { ctx.fillStyle = FIB_COL[k]; ctx.globalAlpha = 0.08; ctx.fillRect(x0, Math.min(prevY, y), x1 - x0, Math.abs(y - prevY)); }
        ctx.globalAlpha = ghost ? 0.85 : 1; ctx.strokeStyle = FIB_COL[k]; ctx.lineWidth = 1.2;
        seg(x0, y, x1, y);
        ctx.fillStyle = FIB_COL[k];
        ctx.fillText(`${lv} (${fmtP(price)})`, x0 + 3, y - 2);
        prevY = y;
      });
      ctx.strokeStyle = col; ctx.setLineDash([3, 4]); ctx.lineWidth = 1; seg(a[0], a[1], b[0], b[1]); ctx.setLineDash([]);
    } else if (t === "path" || t === "brush") {
      ctx.beginPath(); P.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
      if (t === "path" && P.length > 1) {   // small arrowhead at the end, like a path drawing
        const a = P[P.length - 2], b = P[P.length - 1], ang = Math.atan2(b[1] - a[1], b[0] - a[0]), L = 8 + w * 1.5;
        ctx.beginPath(); ctx.moveTo(b[0], b[1]);
        ctx.lineTo(b[0] - L * Math.cos(ang - 0.45), b[1] - L * Math.sin(ang - 0.45));
        ctx.moveTo(b[0], b[1]); ctx.lineTo(b[0] - L * Math.cos(ang + 0.45), b[1] - L * Math.sin(ang + 0.45)); ctx.stroke();
      }
    } else if (t === "text") {
      const [x, y] = P[0], size = 11 + (it.width || 2) * 2;
      ctx.font = `500 ${size}px ${css("--body")}`; ctx.textBaseline = "middle";
      const lines = String(it.text || "").split("\n");
      lines.forEach((ln, k) => {
        ctx.lineWidth = 3; ctx.strokeStyle = css("--surface"); ctx.globalAlpha = 0.85; ctx.strokeText(ln, x, y + k * size * 1.25);
        ctx.globalAlpha = 1; ctx.fillStyle = col; ctx.fillText(ln, x, y + k * size * 1.25);
      });
    }
    if (selected) {
      ctx.globalAlpha = 1; ctx.lineWidth = 1.5; ctx.strokeStyle = css("--focus") || col; ctx.fillStyle = css("--surface");
      for (const [x, y] of handlePts(it, P, g)) { ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    }
    ctx.restore();
  }
  // where the drag handles sit
  function handlePts(it, P, g) {
    if (it.type === "hline") return [[Math.min(g.plotW - 24, Math.max(24, P[0][0])), P[0][1]]];
    if (it.type === "vline") return [[P[0][0], Math.min(g.priceH - 20, Math.max(20, P[0][1]))]];
    if (it.type === "brush" || it.type === "text" || it.type === "arrowUp" || it.type === "arrowDown") return it.type === "brush" ? [] : [P[0]];
    return P;
  }

  // price tags on the scale for horizontal lines
  function drawAxisTags(ctx, g, cv, items, sel) {
    ctx.save(); ctx.font = `${g.mini ? 10 : 11}px ${css("--body")}`; ctx.textBaseline = "middle";
    for (const it of items) {
      if (it.type !== "hline" && it.type !== "hray" && !(it === sel && it.pts.length)) continue;
      const pts = it.type === "hline" || it.type === "hray" ? [it.pts[0]] : it === sel ? it.pts : [];
      for (const a of pts) {
        const y = cv.y(a); if (y < 0 || y > g.priceH) continue;
        const th = g.mini ? 15 : 18;
        ctx.fillStyle = colorOf(it.color); ctx.fillRect(g.plotW + 1, y - th / 2, g.axisW - 2, th);
        ctx.fillStyle = it.color === "#F9C80E" ? "#1A1A1A" : (it.color === "ink" || !it.color ? css("--surface") : "#FFFFFF");
        ctx.fillText(fmtP(a.p), g.plotW + 6, y);
      }
    }
    ctx.restore();
  }

  // the ruler: a shaded box with the price change, % change, bars and days
  function drawRuler(ctx, g, cv, r, dates) {
    const [a, b] = r.pts, x1 = cv.x(a), y1 = cv.y(a), x2 = cv.x(b), y2 = cv.y(b);
    const upMove = b.p >= a.p, col = upMove ? "#2962FF" : "#F23645";
    ctx.save();
    ctx.fillStyle = col; ctx.globalAlpha = 0.14;
    ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    ctx.globalAlpha = 1; ctx.strokeStyle = col; ctx.lineWidth = 1.3;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    ctx.beginPath(); ctx.moveTo(mx, y1); ctx.lineTo(mx, y2); ctx.moveTo(x1, my); ctx.lineTo(x2, my); ctx.stroke();
    // arrowheads at the end of the move
    const head = (x, y, dx, dy) => { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - dx * 6 - dy * 4, y - dy * 6 + dx * 4); ctx.lineTo(x - dx * 6 + dy * 4, y - dy * 6 - dx * 4); ctx.closePath(); ctx.fill(); };
    ctx.fillStyle = col;
    if (Math.abs(y2 - y1) > 10) head(mx, y2, 0, Math.sign(y2 - y1));
    if (Math.abs(x2 - x1) > 10) head(x2, my, Math.sign(x2 - x1), 0);
    const i1 = cv.idxOf(a), i2 = cv.idxOf(b), bars = Math.round(i2 - i1);
    const dP = b.p - a.p, pct = a.p ? (dP / a.p) * 100 : 0;
    let days;
    const k1 = Math.round(i1), k2 = Math.round(i2);
    if (k1 >= 0 && k2 >= 0 && k1 < dates.length && k2 < dates.length) days = Math.round((new Date(dates[k2]) - new Date(dates[k1])) / 864e5);
    else days = Math.round(bars * 7 / 5);
    const l1 = `${dP >= 0 ? "+" : ""}${fmtP(dP)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`;
    const l2 = `${bars} bars, ${days}d`;
    ctx.font = `500 12px ${css("--body")}`; ctx.textBaseline = "middle";
    const w = Math.max(ctx.measureText(l1).width, ctx.measureText(l2).width) + 16, h = 38;
    let bx = mx - w / 2, by = upMove ? Math.min(y1, y2) - h - 6 : Math.max(y1, y2) + 6;
    bx = Math.max(2, Math.min(g.plotW - w - 2, bx)); by = Math.max(2, Math.min(g.priceH - h - 2, by));
    ctx.fillStyle = col; ctx.globalAlpha = 0.92; ctx.fillRect(bx, by, w, h); ctx.globalAlpha = 1;
    ctx.fillStyle = "#FFFFFF"; ctx.fillText(l1, bx + 8, by + 12); ctx.fillText(l2, bx + 8, by + 27);
    ctx.restore();
  }

  // alert levels for the stock on the chart: dotted orange line with a bell tag
  function drawAlerts(ctx, g, alerts) {
    if (!alerts || !alerts.length) return;
    ctx.save(); ctx.font = `500 11px ${css("--body")}`; ctx.textBaseline = "middle";
    for (const al of alerts) {
      if (al.price == null) continue;
      const y = Math.round(g.Y(al.price)) + 0.5;
      if (y < 0 || y > g.priceH) continue;
      ctx.strokeStyle = "#FF9800"; ctx.lineWidth = 1.2; ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(g.plotW, y); ctx.stroke(); ctx.setLineDash([]);
      const label = `🔔 ${al.type === "below" ? "below" : "above"} ${fmtP(al.price)}`;
      const w = ctx.measureText(label).width + 10;
      ctx.fillStyle = "#FF9800"; ctx.fillRect(g.plotW - w - 4, y - 9, w, 18);
      ctx.fillStyle = "#1A1A1A"; ctx.fillText(label, g.plotW - w + 1, y + 0.5);
    }
    ctx.restore();
  }

  // ---------- hit testing ----------
  function hitItem(it, x, y, g, cv, ctx) {
    const P = screenPts(it, cv), t = it.type;
    if (t === "trend" || t === "arrow" || t === "ray" || t === "extended") {
      const s = stretch(P[0][0], P[0][1], P[1][0], P[1][1], t === "extended", t === "ray" || t === "extended");
      return distSeg(x, y, ...s) < TOL;
    }
    if (t === "hline") return Math.abs(y - P[0][1]) < TOL;
    if (t === "hray") return Math.abs(y - P[0][1]) < TOL && x >= P[0][0] - TOL;
    if (t === "vline") return Math.abs(x - P[0][0]) < TOL;
    if (t === "arrowUp") return Math.abs(x - P[0][0]) < 12 && y > P[0][1] - 4 && y < P[0][1] + 26;
    if (t === "arrowDown") return Math.abs(x - P[0][0]) < 12 && y < P[0][1] + 4 && y > P[0][1] - 26;
    if (t === "rect") {
      const x0 = Math.min(P[0][0], P[1][0]) - TOL, x1 = Math.max(P[0][0], P[1][0]) + TOL;
      const y0 = Math.min(P[0][1], P[1][1]) - TOL, y1 = Math.max(P[0][1], P[1][1]) + TOL;
      return x >= x0 && x <= x1 && y >= y0 && y <= y1;
    }
    if (t === "ellipse") {
      const cx = (P[0][0] + P[1][0]) / 2, cy = (P[0][1] + P[1][1]) / 2;
      const rx = Math.abs(P[0][0] - P[1][0]) / 2 + TOL, ry = Math.abs(P[0][1] - P[1][1]) / 2 + TOL;
      return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
    }
    if (t === "channel") {
      const [a, b] = P, c = P[2] || P[1], dy = c[1] - b[1] - (c[0] - b[0]) * ((b[1] - a[1]) / ((b[0] - a[0]) || 1));
      if (distSeg(x, y, a[0], a[1], b[0], b[1]) < TOL || distSeg(x, y, a[0], a[1] + dy, b[0], b[1] + dy) < TOL) return true;
      const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]);
      if (x < x0 || x > x1) return false;
      const yl = a[1] + (b[1] - a[1]) * ((x - a[0]) / ((b[0] - a[0]) || 1));
      return (y - yl) * (y - yl - dy) <= 0;
    }
    if (t === "fib") {
      const x0 = Math.min(P[0][0], P[1][0]) - TOL, x1 = Math.max(P[0][0], P[1][0]) + TOL;
      if (x < x0 || x > x1) return false;
      const p1 = it.pts[0].p, p2 = it.pts[1].p;
      return FIB.some((lv) => Math.abs(g.Y(p2 + (p1 - p2) * lv) - y) < TOL);
    }
    if (t === "path" || t === "brush") {
      for (let k = 1; k < P.length; k++) if (distSeg(x, y, P[k - 1][0], P[k - 1][1], P[k][0], P[k][1]) < TOL) return true;
      return false;
    }
    if (t === "text") {
      const size = 11 + (it.width || 2) * 2, lines = String(it.text || "").split("\n");
      ctx.save(); ctx.font = `500 ${size}px ${css("--body")}`;
      const w = Math.max(...lines.map((l) => ctx.measureText(l).width)); ctx.restore();
      return x >= P[0][0] - 4 && x <= P[0][0] + w + 4 && y >= P[0][1] - size && y <= P[0][1] + size * 1.25 * (lines.length - 1) + size;
    }
    return false;
  }

  // =====================================================================
  // The layer that lives on the main chart
  // =====================================================================
  class Layer {
    constructor(chart, bar) {
      this.chart = chart; this.bar = bar; this.cv = chart.cv;
      this.tool = "cursor"; this.items = []; this.sel = null; this.temp = null; this.ruler = null; this.drag = null;
      this.sym = null; this.dates = []; this.dmap = new Map(); this.undo = []; this.alerts = [];
      const p = (() => { try { return JSON.parse(localStorage.getItem(PKEY) || "{}"); } catch (e) { return {}; } })();
      this.color = p.color || "#2962FF"; this.width = p.width || 2; this.magnet = !!p.magnet; this.keep = !!p.keep; this.hidden = !!p.hidden;
      this.onAlertLine = null;           // set by the page: (symbol, price) => open the alert form
      if (bar) this.buildBar();
      document.addEventListener("keydown", (e) => this.key(e));
      if (window.ibsAlerts) window.ibsAlerts.onChange(() => this.refreshAlerts());
    }
    prefs() { try { localStorage.setItem(PKEY, JSON.stringify({ color: this.color, width: this.width, magnet: this.magnet, keep: this.keep, hidden: this.hidden })); } catch (e) { /* ignore */ } }
    refreshAlerts() { this.alerts = window.ibsAlerts && this.sym ? window.ibsAlerts.forSymbol(this.sym) : []; this.redraw(); }

    setData(c) {
      this.dates = c.d; this.dmap = new Map(c.d.map((d, i) => [d, i]));
      const sym = c.symbol || null;
      if (sym !== this.sym) {
        this.sym = sym; this.items = sym ? load(sym) : []; this.sel = null; this.temp = null; this.ruler = null; this.undo = [];
        this.closeText();
      }
      this.alerts = window.ibsAlerts && sym ? window.ibsAlerts.forSymbol(sym) : [];
      this.syncBar();
    }
    get g() { return this.chart.geo; }
    conv() { return makeConv(this.g, this.dates, this.dmap); }
    redraw() { this.chart.draw(); }
    persist() { if (this.sym) save(this.sym, this.items); }
    snapshot() { this.undo.push(JSON.stringify(this.items)); if (this.undo.length > 60) this.undo.shift(); }
    undoLast() {
      if (!this.undo.length) return;
      this.items = JSON.parse(this.undo.pop()); this.sel = null; this.persist(); this.syncBar(); this.redraw();
    }

    // a chart point under the pointer: snapped to a bar, and with the magnet on to its open, high, low or close
    pointAt(x, y, snap = true) {
      const g = this.g, cv = this.conv();
      let idx = cv.idxAt(x); if (snap) idx = Math.round(idx);
      let p = g.priceAt(y);
      const c = this.chart.c, i = Math.round(idx);
      if (this.magnet && c && i >= 0 && i < c.c.length) {
        let best = null, bd = 30;
        for (const v of [c.o[i], c.h[i], c.l[i], c.c[i]]) { const d = Math.abs(g.Y(v) - y); if (d < bd) { bd = d; best = v; } }
        if (best != null) p = best;
      }
      return cv.anchor(idx, p);
    }
    inPrice(x, y) { const g = this.g; return !!g && x >= 0 && x <= g.plotW && y >= 0 && y <= g.priceH; }

    setTool(id) {
      if (this.temp && this.temp.type === "path" && this.temp.pts.length > 2) this.finishPath();
      this.temp = null; this.tool = id; this.closeText();
      if (id !== "cursor") this.sel = null;
      this.cv.classList.toggle("drawing", id !== "cursor");
      this.syncBar(); this.redraw();
    }

    // ---------- pointer events (called by the chart; return true when used) ----------
    down(e) {
      const g = this.g; if (!g || !this.chart.c) return false;
      if (e.pointerType === "mouse" && e.button !== 0) return false;
      const x = e.offsetX, y = e.offsetY;
      if (this.ruler && !this.temp) { this.ruler = null; this.redraw(); }
      if (this.tool === "cursor") {
        if (e.shiftKey && this.inPrice(x, y)) {          // Shift + drag: quick ruler
          const pt = this.pointAt(x, y);
          this.temp = { type: "ruler", pts: [pt, { ...pt }], quick: true }; this.press = { x, y, moved: false };
          return true;
        }
        if (this.hidden) return false;
        const cv = this.conv();
        if (this.sel) {
          const P = screenPts(this.sel, cv), H = handlePts(this.sel, P, g);
          const hk = H.findIndex(([hx, hy]) => Math.hypot(hx - x, hy - y) < 8);
          if (hk >= 0) { this.snapshot(); this.drag = { kind: "handle", item: this.sel, h: hk }; return true; }
        }
        const hit = this.hitAt(x, y);
        if (hit) {
          this.snapshot();
          this.sel = hit; this.drag = { kind: "move", item: hit, x, y, orig: JSON.parse(JSON.stringify(hit.pts)), moved: false };
          this.syncBar(); this.redraw();
          return true;
        }
        if (this.sel) { this.sel = null; this.syncBar(); this.redraw(); }
        return false;                                     // nothing here: let the chart pan
      }
      if (!this.inPrice(x, y)) return false;
      const kind = KIND[this.tool], pt = this.pointAt(x, y, this.tool !== "brush");
      if (kind === "one") { this.commit({ type: this.tool, pts: [pt] }); return true; }
      if (kind === "text") { this.openText(x, y, pt); return true; }
      if (kind === "brush") { this.temp = { type: "brush", pts: [pt] }; this.press = { x, y }; return true; }
      if (kind === "path") {
        if (!this.temp) this.temp = { type: "path", pts: [pt, { ...pt }] };
        else { this.temp.pts[this.temp.pts.length - 1] = pt; this.temp.pts.push({ ...pt }); }
        this.redraw(); return true;
      }
      if (kind === "channel" && this.temp && this.temp.stage === 2) { this.temp.pts[2] = pt; this.finish(); return true; }
      // two-point tools: drag from the first point to the second, or click twice
      if (this.temp) { this.temp.pts[1] = pt; this.afterSecond(); return true; }
      this.temp = { type: this.tool, pts: [pt, { ...pt }] }; this.press = { x, y, moved: false };
      this.redraw();
      return true;
    }
    move(e, pressed) {
      const g = this.g; if (!g || !this.chart.c) return false;
      const x = e.offsetX, y = e.offsetY;
      if (this.drag) {
        const it = this.drag.item, cv = this.conv();
        if (this.drag.kind === "handle") {
          const keepX = it.type === "hline", keepY = it.type === "vline";
          const pt = this.pointAt(x, y, it.type !== "brush");
          const old = it.pts[this.drag.h];
          it.pts[this.drag.h] = { d: keepX ? old.d : pt.d, f: keepX ? old.f : pt.f, p: keepY ? old.p : pt.p };
        } else {
          const dx = x - this.drag.x, dy = y - this.drag.y;
          if (Math.abs(dx) + Math.abs(dy) > 2) this.drag.moved = true;
          const dI = it.type === "brush" ? dx / g.step : Math.round(dx / g.step);
          it.pts = this.drag.orig.map((o) => cv.anchor(cv.idxOf(o) + dI, g.priceAt(g.Y(o.p) + dy)));
        }
        this.redraw(); return true;
      }
      if (this.temp) {
        const t = this.temp;
        if (t.type === "brush") {
          if (!pressed) return true;
          const last = t.pts[t.pts.length - 1], cv = this.conv();
          if (Math.hypot(cv.x(last) - x, cv.y(last) - y) > 2) t.pts.push(this.pointAt(x, y, false));
        } else if (t.stage === 2) t.pts[2] = this.pointAt(x, y);
        else {
          t.pts[t.pts.length - 1] = this.pointAt(x, y);
          if (this.press && pressed && Math.hypot(x - this.press.x, y - this.press.y) > 4) this.press.moved = true;
        }
        this.redraw(); return true;
      }
      // hover feedback in select mode
      if (this.tool === "cursor" && !this.hidden && !pressed) {
        const over = this.inPrice(x, y) && !!this.hitAt(x, y);
        this.cv.classList.toggle("over-drawing", over);
      }
      return false;
    }
    up() {
      if (this.drag) {
        const d = this.drag; this.drag = null;
        if (d.kind === "move" && !d.moved) this.undo.pop();   // just a click to select
        this.persist(); this.redraw(); return true;
      }
      const t = this.temp;
      if (!t) return false;
      if (t.type === "brush") { if (t.pts.length > 1) this.commit(t); else this.temp = null; this.redraw(); return true; }
      if (t.type === "path" || t.stage === 2) return true;
      if (this.press && this.press.moved) { this.press = null; this.afterSecond(); return true; }
      this.press = null;                                       // a click: wait for the second click
      return true;
    }
    dblclick(e) {
      if (this.temp && this.temp.type === "path") { this.finishPath(); return true; }
      if (this.tool !== "cursor") return true;
      const hit = this.inPrice(e.offsetX, e.offsetY) && this.hitAt(e.offsetX, e.offsetY);
      if (hit && hit.type === "text") { this.sel = hit; this.openText(e.offsetX, e.offsetY, hit.pts[0], hit); return true; }
      return !!hit;
    }
    afterSecond() {
      const t = this.temp;
      if (t.type === "channel" && !t.stage) { t.stage = 2; t.pts[2] = { ...t.pts[1] }; this.redraw(); return; }
      this.finish();
    }
    finish() {
      const t = this.temp; this.temp = null;
      if (!t) return;
      if (t.type === "ruler") { this.ruler = t; if (!t.quick && !this.keep) this.setTool("cursor"); else this.redraw(); return; }
      const cv = this.conv(), [a, b] = t.pts;
      if (KIND[t.type] === "two" && Math.hypot(cv.x(a) - cv.x(b), cv.y(a) - cv.y(b)) < 3) { this.redraw(); return; }  // nothing drawn
      this.commit(t);
    }
    finishPath() {
      const t = this.temp; this.temp = null;
      if (t) { t.pts.pop(); if (t.pts.length >= 2) this.commit(t); }
      this.redraw();
    }
    commit(t) {
      this.snapshot();
      const isMark = t.type === "arrowUp" || t.type === "arrowDown";
      const it = { id: uid(), type: t.type, pts: t.pts, color: isMark && this.color === "ink" ? (t.type === "arrowUp" ? "up" : "down") : this.color, width: this.width };
      if (t.text != null) it.text = t.text;
      this.items.push(it); this.temp = null; this.persist();
      if (!this.keep) { this.tool = "cursor"; this.cv.classList.remove("drawing"); this.sel = it; }
      this.syncBar(); this.redraw();
    }
    hitAt(x, y) {
      const g = this.g, cv = this.conv(), ctx = this.chart.ctx;
      for (let k = this.items.length - 1; k >= 0; k--) if (hitItem(this.items[k], x, y, g, cv, ctx)) return this.items[k];
      return null;
    }
    deleteSel() {
      if (!this.sel) return;
      this.snapshot(); this.items = this.items.filter((i) => i !== this.sel); this.sel = null;
      this.persist(); this.syncBar(); this.redraw();
    }
    clearAll() {
      if (!this.items.length) return;
      if (!confirm(`Remove all ${this.items.length} drawings on ${this.sym}? You can undo with Ctrl+Z.`)) return;
      this.snapshot(); this.items = []; this.sel = null; this.persist(); this.syncBar(); this.redraw();
    }

    // ---------- text box ----------
    openText(x, y, pt, editing) {
      this.closeText();
      const box = document.createElement("textarea");
      box.className = "draw-text"; box.rows = 1; box.value = editing ? editing.text || "" : "";
      box.placeholder = "Type, then Enter";
      box.style.left = `${this.cv.offsetLeft + x}px`; box.style.top = `${this.cv.offsetTop + y - 14}px`;
      box.style.color = colorOf(editing ? editing.color : this.color);
      this.cv.parentElement.appendChild(box);
      this.textBox = box;
      const done = (keep) => {
        if (this.textBox !== box) return;
        const v = box.value.trim(); this.closeText();
        if (!keep) return;
        if (editing) {
          this.snapshot();
          if (v) editing.text = v; else this.items = this.items.filter((i) => i !== editing);
          this.persist(); this.redraw();
        } else if (v) this.commit({ type: "text", pts: [pt], text: v });
        else if (!this.keep) this.setTool("cursor");
      };
      box.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); done(true); }
        if (e.key === "Escape") { e.preventDefault(); done(false); }
      });
      box.addEventListener("blur", () => done(true));
      setTimeout(() => box.focus(), 0);
    }
    closeText() { if (this.textBox) { const b = this.textBox; this.textBox = null; b.remove(); } }

    // ---------- keyboard ----------
    key(e) {
      const tg = e.target;
      if (tg && (tg.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName))) return;
      if (!this.chart.c || !this.cv.offsetParent) return;      // chart not on screen
      if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
        if (this.undo.length) { e.preventDefault(); this.undoLast(); }
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const tool = TOOLS.find((x) => x[2] && (e.code === `Key${x[2]}` || (e.key || "").toUpperCase() === x[2]));
        if (tool) { e.preventDefault(); this.setTool(tool[0]); }
        return;
      }
      if (e.key === "Escape") {
        if (this.temp && this.temp.type === "path") { this.finishPath(); e.stopImmediatePropagation(); return; }
        if (this.temp || this.ruler || this.tool !== "cursor" || this.sel) {
          this.temp = null; this.ruler = null; this.sel = null; this.setTool("cursor");
          e.stopImmediatePropagation();
        }
        return;
      }
      if (e.key === "Enter" && this.temp && this.temp.type === "path") { e.preventDefault(); this.finishPath(); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && this.sel) { e.preventDefault(); this.deleteSel(); }
    }

    // ---------- drawing on the chart ----------
    render(ctx, g) {
      if (!this.dates.length) return;
      const cv = makeConv(g, this.dates, this.dmap);
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, g.plotW, g.priceH); ctx.clip();
      drawAlerts(ctx, g, this.alerts);
      if (!this.hidden) for (const it of this.items) drawItem(ctx, g, cv, it, it === this.sel, false);
      if (this.temp && this.temp.type !== "ruler") drawItem(ctx, g, cv, { ...this.temp, color: this.color, width: this.width }, false, true);
      const r = this.temp && this.temp.type === "ruler" ? this.temp : this.ruler;
      if (r) drawRuler(ctx, g, cv, r, this.dates);
      ctx.restore();
      if (!this.hidden) drawAxisTags(ctx, g, cv, this.items, this.sel);
    }

    // ---------- toolbar ----------
    buildBar() {
      const bar = this.bar;
      bar.innerHTML = "";
      bar.setAttribute("role", "toolbar"); bar.setAttribute("aria-label", "Drawing tools");
      const icon = (paths, fill) => `<svg viewBox="0 0 24 24" aria-hidden="true" class="${fill ? "fill" : ""}">${paths}</svg>`;
      let into = bar;                     // where the next buttons go
      const mk = (cls, title, html, onClick) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = cls; b.title = title; b.setAttribute("aria-label", title); b.innerHTML = html;
        b.addEventListener("click", onClick); into.appendChild(b); return b;
      };
      const sep = () => { const s = document.createElement("span"); s.className = "draw-sep"; s.setAttribute("aria-hidden", "true"); into.appendChild(s); };
      this.toolBtns = {};
      for (const [id, title, key, , paths] of TOOLS) {
        const filled = id === "arrowUp" || id === "arrowDown" || id === "cursor";
        this.toolBtns[id] = mk("draw-btn", key ? `${title} (Alt+${key})` : title, icon(paths, filled), () => this.setTool(this.tool === id && id !== "cursor" ? "cursor" : id));
        if (id === "cursor" || id === "vline" || id === "arrowDown" || id === "fib") sep();
      }
      sep();
      // switches that apply to all drawings
      this.magnetBtn = mk("draw-btn", "Magnet: snap points to open, high, low or close", icon('<path d="M6 3v8a6 6 0 0 0 12 0V3h-4v8a2 2 0 0 1-4 0V3z"/><path d="M6 7h4M14 7h4"/>'), () => { this.magnet = !this.magnet; this.prefs(); this.syncBar(); });
      this.keepBtn = mk("draw-btn", "Keep drawing: stay on the tool after each drawing", icon('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'), () => { this.keep = !this.keep; this.prefs(); this.syncBar(); });
      this.hideBtn = mk("draw-btn", "Hide drawings", icon('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'), () => { this.hidden = !this.hidden; this.sel = null; this.prefs(); this.syncBar(); this.redraw(); });
      this.undoBtn = mk("draw-btn", "Undo (Ctrl+Z)", icon('<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'), () => this.undoLast());
      this.clearBtn = mk("draw-btn draw-clear", "Remove all drawings on this stock", icon('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11l4 5M14 11l-4 5"/>'), () => this.clearAll());
      // edit box: shown only while a drawing is selected or being drawn, like TradingView
      this.editBox = document.createElement("span");
      this.editBox.className = "draw-edit"; this.editBox.setAttribute("role", "group"); this.editBox.setAttribute("aria-label", "Edit drawing");
      bar.appendChild(this.editBox);
      into = this.editBox;
      const sw = document.createElement("span"); sw.className = "draw-colors"; sw.setAttribute("role", "group"); sw.setAttribute("aria-label", "Colour");
      this.swatches = COLORS.map(([c, name]) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "draw-sw"; b.title = name; b.setAttribute("aria-label", `Colour: ${name}`);
        b.style.setProperty("--sw", c === "ink" ? "var(--ink)" : c);
        b.addEventListener("click", () => {
          this.color = c; this.prefs();
          if (this.sel) { this.snapshot(); this.sel.color = c; this.persist(); }
          this.syncBar(); this.redraw();
        });
        sw.appendChild(b); return [c, b];
      });
      this.editBox.appendChild(sw);
      this.widthBtn = mk("draw-btn draw-width", "Line width", "", () => {
        this.width = this.width >= 4 ? 1 : this.width + 1; this.prefs();
        if (this.sel) { this.snapshot(); this.sel.width = this.width; this.persist(); }
        this.syncBar(); this.redraw();
      });
      this.alertBtn = mk("draw-btn draw-alert", "Set a Telegram alert at the selected horizontal line", icon('<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>'), () => {
        const it = this.sel;
        if (it && (it.type === "hline" || it.type === "hray") && this.onAlertLine) this.onAlertLine(this.sym, it.pts[0].p);
      });
      this.delBtn = mk("draw-btn", "Delete the selected drawing (Delete)", icon('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'), () => this.deleteSel());
      this.syncBar();
    }
    syncBar() {
      if (!this.bar || !this.toolBtns) return;
      for (const [id, b] of Object.entries(this.toolBtns)) b.setAttribute("aria-pressed", id === this.tool ? "true" : "false");
      const cur = this.sel ? this.sel.color : this.color;
      for (const [c, b] of this.swatches) b.setAttribute("aria-pressed", c === cur ? "true" : "false");
      const w = this.sel ? this.sel.width || 2 : this.width;
      this.widthBtn.innerHTML = `<span class="draw-w" style="--w:${w}px"></span>`;
      this.widthBtn.title = `Line width ${w}px (click to change)`;
      this.magnetBtn.setAttribute("aria-pressed", this.magnet ? "true" : "false");
      this.keepBtn.setAttribute("aria-pressed", this.keep ? "true" : "false");
      this.hideBtn.setAttribute("aria-pressed", this.hidden ? "true" : "false");
      this.hideBtn.title = this.hidden ? "Show drawings" : "Hide drawings";
      const canAlert = !!(this.sel && (this.sel.type === "hline" || this.sel.type === "hray") && this.onAlertLine);
      this.alertBtn.hidden = !canAlert;
      this.delBtn.hidden = !this.sel;
      this.editBox.hidden = !(this.sel || this.tool !== "cursor");
      this.delBtn.disabled = !this.sel;
      this.undoBtn.disabled = !this.undo.length;
      this.clearBtn.disabled = !this.items.length;
      const status = this.bar.parentElement && this.bar.parentElement.querySelector(".draw-status");
      if (status) {
        status.textContent = this.tool === "cursor"
          ? (this.items.length ? `${this.items.length} drawing${this.items.length > 1 ? "s" : ""} on this stock, saved in this browser` : "")
          : this.tool === "path" ? "Path: click each point, double-click or Enter to finish"
          : this.tool === "ruler" ? "Ruler: drag from one point to another (Shift + drag works any time)"
          : `${TITLE[this.tool]}: ${KIND[this.tool] === "one" ? "click on the chart" : KIND[this.tool] === "text" ? "click where the text goes" : KIND[this.tool] === "channel" ? "drag the first line, then click to set the width" : "drag, or click two points"}. Esc to cancel.`;
      }
    }
  }

  // drawings on a small chart in the charts-only grid: shown, not editable
  function renderSaved(ctx, g, c) {
    if (!c.symbol) return;
    let prefsHidden = false;
    try { prefsHidden = !!JSON.parse(localStorage.getItem(PKEY) || "{}").hidden; } catch (e) { /* ignore */ }
    if (prefsHidden) return;
    const items = load(c.symbol);
    if (!items.length) return;
    const cv = makeConv(g, c.d, new Map(c.d.map((d, i) => [d, i])));
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, g.plotW, g.priceH); ctx.clip();
    for (const it of items) drawItem(ctx, g, cv, it, false, false);
    ctx.restore();
    drawAxisTags(ctx, g, cv, items, null);
  }

  window.IBSDraw = { Layer, renderSaved };
})();
