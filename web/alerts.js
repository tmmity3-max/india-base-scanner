/* India Base Scanner - alerts drawer
 *
 * Alerts live in alerts.json on the repo's `alerts` branch. The site reads and
 * changes them through /api/alerts (a Vercel function that holds the GitHub
 * token), and a GitHub Action checks them and sends Telegram messages:
 *   - price alerts every 15 minutes while NSE is open
 *   - screen alerts after the daily scan
 * Only someone with the alerts key (ALERTS_KEY in Vercel) can see or change them.
 */
(() => {
  "use strict";
  const API = "/api/alerts";
  const KKEY = "ibs-alerts-key";
  const TYPES = {
    above: "Price goes above",
    below: "Price goes below",
    screen: "Stock appears on a screen",
    digest: "Daily list of new stocks on a screen",
  };
  const st = { alerts: null, telegram: null, err: "", msg: "", busy: false, prefill: null, open: false, setup: false };
  const askedToOpen = /(^|[#&])alerts\b/.test(location.hash);   // read before app.js rewrites the address
  const subs = new Set();
  const $ = (id) => document.getElementById(id);
  const nf2 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const getKey = () => { try { return localStorage.getItem(KKEY) || ""; } catch (e) { return ""; } };
  const setKey = (k) => { try { k ? localStorage.setItem(KKEY, k) : localStorage.removeItem(KKEY); } catch (e) { /* private window */ } };

  async function call(method, body) {
    const r = await fetch(API, {
      method, cache: "no-store",
      headers: { "Content-Type": "application/json", "X-Alerts-Key": getKey() },
      body: body ? JSON.stringify(body) : undefined,
    });
    let j = {};
    try { j = await r.json(); } catch (e) { /* not JSON */ }
    if (!r.ok) {
      const err = new Error(j.error || (r.status === 404 ? "The alerts service isn't deployed on this site yet." : `The server answered ${r.status}.`));
      err.status = r.status; throw err;
    }
    return j;
  }
  function changed() { for (const fn of subs) { try { fn(); } catch (e) { /* ignore */ } } updateBadge(); }
  function updateBadge() {
    const n = (st.alerts || []).filter((a) => a.status !== "triggered").length;
    const b = $("alertsN"); if (!b) return;
    b.hidden = !n; b.textContent = n;
  }

  async function refresh() {
    if (!getKey()) { st.alerts = null; render(); changed(); return; }
    st.busy = true; render();
    try {
      const j = await call("GET");
      st.alerts = j.alerts || []; st.telegram = j.telegram; st.err = ""; st.setup = false;
    } catch (e) {
      st.err = e.message;
      if (e.status === 401) { setKey(""); st.alerts = null; st.err = "That alerts key isn't right. Enter the ALERTS_KEY you set in Vercel."; }
      if (e.status === 503 || e.status === 404) st.setup = true;
    }
    st.busy = false; render(); changed();
  }

  async function act(body, okMsg) {
    st.busy = true; st.msg = ""; st.err = ""; render();
    try {
      const j = await call("POST", body);
      if (j.alerts) st.alerts = j.alerts;
      st.msg = okMsg || "";
    } catch (e) { st.err = e.message; }
    st.busy = false; render(); changed();
  }

  // ---------- drawer ----------
  function open(prefill) {
    st.prefill = prefill || null; st.msg = ""; st.err = st.err && st.setup ? st.err : "";
    st.open = true;
    $("alerts").hidden = false; $("scrim").hidden = false;
    $("alertsBtn").setAttribute("aria-expanded", "true");
    render();
    if (getKey()) refresh();
    setTimeout(() => { const f = $("alerts").querySelector(st.prefill ? "#alPrice, #alSym" : "input, select, button"); if (f) f.focus(); }, 30);
  }
  function close() {
    st.open = false;
    $("alerts").hidden = true; $("scrim").hidden = true;
    $("alertsBtn").setAttribute("aria-expanded", "false");
    $("alertsBtn").focus({ preventScroll: true });
  }

  function condText(a) {
    if (a.type === "above" || a.type === "below") return `${a.type === "above" ? "Goes above" : "Goes below"} ₹${nf2.format(a.price)}`;
    if (a.type === "screen") return `Appears on ${a.screen === "any" ? "any screen" : a.screen}`;
    if (a.type === "digest") return `New stocks on ${a.screen === "any" ? "any screen" : a.screen}, every day after the scan`;
    return a.type;
  }
  const when = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }); };

  function render() {
    const body = $("alBody");
    if (!body || !st.open) return;
    const key = getKey();
    if (!key || st.setup) { body.innerHTML = setupHtml(!!key); bindSetup(); return; }
    const p = st.prefill || {};
    const screens = window.IBS_SCREEN_NAMES || [];
    const list = (st.alerts || []).slice().sort((a, b) => (a.status === "triggered") - (b.status === "triggered") || String(b.created).localeCompare(String(a.created)));
    body.innerHTML = `
      <p>Get a Telegram message when a stock crosses a price or shows up on a screen. Price alerts are checked every 15 minutes while NSE is open; screen alerts after the daily scan.</p>
      ${st.telegram === false ? `<p class="al-msg err">Telegram isn't set up on the server yet, so alerts are saved but no message can be sent from here. See step 3 in the README section “Telegram alerts”.</p>` : ""}
      <h3>New alert</h3>
      <form class="al-form" id="alForm" novalidate>
        <label>Stock (NSE symbol)<input id="alSym" list="alSyms" autocomplete="off" spellcheck="false" placeholder="RELIANCE" value="${esc(p.symbol || "")}"></label>
        <label>Condition<select id="alType">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}"${(p.type || "above") === k ? " selected" : ""}>${v}</option>`).join("")}</select></label>
        <label id="alPriceWrap">Price ₹<input id="alPrice" type="number" inputmode="decimal" step="any" min="0" value="${p.price != null ? (+p.price).toFixed(2) : ""}"></label>
        <label id="alScreenWrap" hidden>Screen<select id="alScreen"><option value="any">Any screen</option>${screens.map((s) => `<option${p.screen === s ? " selected" : ""}>${esc(s)}</option>`).join("")}</select></label>
        <label class="wide">Note (optional)<input id="alNote" maxlength="200" placeholder="e.g. pivot of B3, buy above with stop at 1,780"></label>
        <div class="al-actions">
          <button type="submit" class="btn-apply" ${st.busy ? "disabled" : ""}>Add alert</button>
          <span class="al-hint" id="alHint">${p.last != null ? `Last close ₹${nf2.format(p.last)}` : ""}</span>
        </div>
      </form>
      <datalist id="alSyms"></datalist>
      ${st.err ? `<p class="al-msg err">${esc(st.err)}</p>` : ""}${st.msg ? `<p class="al-msg ok">${esc(st.msg)}</p>` : ""}
      <h3>Your alerts ${st.busy ? `<span class="al-hint">updating…</span>` : ""}</h3>
      ${list.length ? `<ul class="al-list">${list.map((a) => `
        <li class="al-item${a.status === "triggered" ? " done" : ""}">
          <div>${a.symbol && a.symbol !== "*" ? `<button type="button" class="al-sym" data-open="${esc(a.symbol)}">${esc(a.symbol)}</button>` : `<b class="al-sym">All stocks</b>`}
            <span class="al-chip ${a.status === "triggered" ? "hit" : "on"}">${a.status === "triggered" ? "Sent" : "Active"}</span></div>
          <div class="al-cond">${esc(condText(a))}</div>
          <div class="al-meta">${a.note ? esc(a.note) + " · " : ""}${a.status === "triggered"
            ? `Sent ${esc(when(a.triggered_at))}${a.triggered_price != null ? ` at ₹${nf2.format(a.triggered_price)}` : ""}`
            : `Set ${esc(when(a.created))}${a.last_sent ? ` · last list ${esc(a.last_sent)}` : ""}`}</div>
          <div class="al-acts">${a.status === "triggered" ? `<button type="button" data-rearm="${esc(a.id)}" title="Watch for it again">Re-arm</button>` : ""}<button type="button" data-del="${esc(a.id)}" title="Delete this alert">Delete</button></div>
        </li>`).join("")}</ul>` : `<p class="al-hint">${st.alerts ? "No alerts yet." : st.busy ? "Loading…" : ""}</p>`}
      <div class="al-foot">
        <button type="button" class="btn-ghost" id="alTest" ${st.busy ? "disabled" : ""}>Send a test message</button>
        <button type="button" class="link-btn" id="alForget">Forget the key on this device</button>
      </div>`;
    bindMain();
  }

  function setupHtml(hasKey) {
    return `
      ${st.err ? `<p class="al-msg err">${esc(st.err)}</p>` : ""}
      ${st.setup ? "" : `<p>Alerts are private: only someone with your alerts key can see or change them. Enter the key you set as <code>ALERTS_KEY</code> in Vercel. It is kept in this browser.</p>
      <form class="al-form" id="alKeyForm" novalidate>
        <label class="wide">Alerts key<input id="alKey" type="password" autocomplete="current-password" spellcheck="false"></label>
        <div class="al-actions"><button type="submit" class="btn-apply">Unlock alerts</button></div>
      </form>`}
      <h3>One-time setup</h3>
      <ol>
        <li>In Telegram, talk to <b>@BotFather</b>, send <code>/newbot</code> and copy the bot token. Send your new bot any message, then open <code>https://api.telegram.org/bot&lt;token&gt;/getUpdates</code> and copy <code>chat.id</code>.</li>
        <li>On GitHub, in the repository's <b>Settings → Secrets and variables → Actions</b>, add the secrets <code>TELEGRAM_BOT_TOKEN</code> and <code>TELEGRAM_CHAT_ID</code>.</li>
        <li>Create a fine-grained GitHub token for this repository only, with <b>Contents: Read and write</b>. In Vercel, under <b>Settings → Environment Variables</b>, add <code>GITHUB_TOKEN</code> (that token), <code>ALERTS_KEY</code> (any long password you choose), and, for the test button, <code>TELEGRAM_BOT_TOKEN</code> and <code>TELEGRAM_CHAT_ID</code>. Redeploy.</li>
        <li>Come back here and enter your <code>ALERTS_KEY</code>.</li>
      </ol>
      ${hasKey && st.setup ? `<div class="al-foot"><button type="button" class="btn-ghost" id="alRetry">Try again</button><button type="button" class="link-btn" id="alForget">Forget the key on this device</button></div>` : ""}`;
  }
  function bindSetup() {
    const f = $("alKeyForm");
    if (f) f.addEventListener("submit", (e) => {
      e.preventDefault();
      const k = $("alKey").value.trim();
      if (!k) return;
      setKey(k); st.err = ""; refresh();
    });
    const r = $("alRetry"); if (r) r.addEventListener("click", () => { st.setup = false; st.err = ""; refresh(); });
    const fg = $("alForget"); if (fg) fg.addEventListener("click", forget);
  }
  function forget() { setKey(""); st.alerts = null; st.setup = false; st.err = ""; render(); changed(); }

  function bindMain() {
    const type = $("alType");
    const sync = () => {
      const t = type.value, price = t === "above" || t === "below";
      $("alPriceWrap").hidden = !price; $("alScreenWrap").hidden = price;
      $("alSym").disabled = t === "digest"; $("alSym").placeholder = t === "digest" ? "All stocks" : "RELIANCE";
    };
    type.addEventListener("change", sync); sync();
    $("alSym").addEventListener("input", (e) => { e.target.value = e.target.value.toUpperCase(); });
    if (window.ibsSymbols) window.ibsSymbols().then((all) => {
      const dl = $("alSyms"); if (!dl || dl.childElementCount) return;
      dl.innerHTML = all.slice(0, 4000).map((x) => `<option value="${esc(x.s)}">${esc(x.n || x.i)}</option>`).join("");
    });
    $("alForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const t = type.value, sym = $("alSym").value.trim().toUpperCase();
      const v = parseFloat($("alPrice").value);
      // what was typed, so a failed check or save doesn't wipe the form
      st.prefill = { symbol: sym, type: t, price: v > 0 ? v : null, screen: $("alScreen").value, last: (st.prefill || {}).last, note: $("alNote").value };
      const a = { type: t, note: $("alNote").value.trim() };
      if (t === "digest") a.symbol = "*";
      else {
        if (!/^[A-Z0-9&_.-]{1,24}$/.test(sym)) { st.err = "Enter the stock's NSE symbol, for example RELIANCE."; st.msg = ""; render(); return; }
        a.symbol = sym;
      }
      if (t === "above" || t === "below") {
        if (!(v > 0)) { st.err = "Enter the price for the alert."; st.msg = ""; render(); return; }
        a.price = v;
      } else a.screen = $("alScreen").value;
      await act({ action: "add", alert: a }, `Alert added: ${a.symbol === "*" ? "all stocks" : a.symbol}, ${condText(a).toLowerCase()}.`);
      if (!st.err) { st.prefill = null; render(); }
    });
    if (st.prefill && st.prefill.note) $("alNote").value = st.prefill.note;
    for (const b of document.querySelectorAll("[data-del]")) b.addEventListener("click", () => act({ action: "delete", id: b.dataset.del }, "Alert deleted."));
    for (const b of document.querySelectorAll("[data-rearm]")) b.addEventListener("click", () => act({ action: "rearm", id: b.dataset.rearm }, "Alert is active again."));
    for (const b of document.querySelectorAll("[data-open]")) b.addEventListener("click", () => { if (window.ibsOpenStock) { close(); window.ibsOpenStock(b.dataset.open); } });
    $("alTest").addEventListener("click", () => act({ action: "test" }, "Test message sent. Check Telegram."));
    $("alForget").addEventListener("click", forget);
  }

  // ---------- public ----------
  window.ibsAlerts = {
    open,
    // active price alerts of one stock, for the lines on its chart
    forSymbol: (sym) => (st.alerts || []).filter((a) => a.symbol === sym && a.status !== "triggered" && (a.type === "above" || a.type === "below")),
    onChange: (fn) => subs.add(fn),
  };

  function boot() {
    const btn = $("alertsBtn"); if (!btn) return;
    btn.addEventListener("click", () => (st.open ? close() : open()));
    $("alClose").addEventListener("click", close);
    $("scrim").addEventListener("click", close);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && st.open) { e.stopImmediatePropagation(); close(); } }, true);
    if (askedToOpen) open();
    else if (getKey()) refresh();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
