/* /api/alerts - read and change the alerts list (see _lib.js for the settings).
 *
 *   GET                              -> { alerts, telegram }
 *   POST { action: "add", alert }    -> { alerts }
 *   POST { action: "delete", id }    -> { alerts }
 *   POST { action: "rearm", id }     -> { alerts }
 *   POST { action: "test" }          -> sends a Telegram test message
 *
 * Every call needs the header X-Alerts-Key with the ALERTS_KEY value.
 */
"use strict";
const crypto = require("crypto");
const { send, keyOk, readAlerts, updateAlerts, telegram, readBody } = require("./_lib");

const TYPES = new Set(["above", "below", "screen", "digest"]);
const MAX_ALERTS = 300;
const SYMBOL = /^[A-Z0-9&_.-]{1,24}$/;

function clean(a) {
  if (!a || typeof a !== "object") throw new Error("No alert sent.");
  const type = String(a.type || "");
  if (!TYPES.has(type)) throw new Error("Unknown alert type.");
  const out = { id: crypto.randomBytes(5).toString("hex"), type, status: "active", created: new Date().toISOString() };
  if (type === "digest") out.symbol = "*";
  else {
    const s = String(a.symbol || "").trim().toUpperCase();
    if (!SYMBOL.test(s)) throw new Error("Enter the stock's NSE symbol, for example RELIANCE.");
    out.symbol = s;
  }
  if (type === "above" || type === "below") {
    const p = Number(a.price);
    if (!(p > 0 && p < 1e7)) throw new Error("Enter a price for the alert.");
    out.price = Math.round(p * 100) / 100;
  } else {
    const sc = String(a.screen || "any").slice(0, 40);
    out.screen = sc || "any";
  }
  const note = String(a.note || "").trim().slice(0, 200);
  if (note) out.note = note;
  return out;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!process.env.ALERTS_KEY || !process.env.GITHUB_TOKEN) {
    return send(res, 503, { error: "Alerts aren't set up on the server yet: add GITHUB_TOKEN and ALERTS_KEY in Vercel, then redeploy." });
  }
  if (!keyOk(req.headers["x-alerts-key"])) return send(res, 401, { error: "Wrong alerts key." });
  const tg = !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
  try {
    if (req.method === "GET") {
      const { data } = await readAlerts();
      return send(res, 200, { alerts: data.alerts, telegram: tg });
    }
    if (req.method !== "POST") return send(res, 405, { error: "Use GET or POST." });
    const body = await readBody(req);
    if (body.action === "add") {
      const a = clean(body.alert);
      const data = await updateAlerts((d) => {
        if (d.alerts.length >= MAX_ALERTS) throw new Error(`You already have ${MAX_ALERTS} alerts. Delete some first.`);
        d.alerts.push(a);
      }, `Add alert: ${a.symbol} ${a.type}`);
      return send(res, 200, { alerts: data.alerts, telegram: tg });
    }
    if (body.action === "delete" || body.action === "rearm") {
      const id = String(body.id || "");
      const data = await updateAlerts((d) => {
        const a = d.alerts.find((x) => x.id === id);
        if (!a) return false;
        if (body.action === "delete") d.alerts = d.alerts.filter((x) => x.id !== id);
        else {
          a.status = "active"; a.created = new Date().toISOString();
          delete a.triggered_at; delete a.triggered_price;
        }
      }, `${body.action === "delete" ? "Delete" : "Re-arm"} alert ${id}`);
      return send(res, 200, { alerts: data.alerts, telegram: tg });
    }
    if (body.action === "test") {
      await telegram("✅ <b>India Base Scanner</b>\nAlerts are connected. Price alerts are checked every 15 minutes while NSE is open, screen alerts after the daily scan.");
      return send(res, 200, { ok: true });
    }
    return send(res, 400, { error: "Unknown action." });
  } catch (e) {
    return send(res, 400, { error: e.message || "Something went wrong." });
  }
};
