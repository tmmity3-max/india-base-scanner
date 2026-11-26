/* Shared helpers for the site's Vercel functions (files starting with _ are
 * not deployed as functions of their own).
 *
 * Environment variables (Vercel → Settings → Environment Variables):
 *   GITHUB_TOKEN        fine-grained token for this repository, Contents: read and write
 *   ALERTS_KEY          the password the website asks for before showing alerts
 *   GITHUB_REPO         optional, default tmmity3-max/india-base-scanner
 *   ALERTS_BRANCH       optional, default "alerts"
 *   TELEGRAM_BOT_TOKEN  optional here, only for the "Send a test message" button
 *   TELEGRAM_CHAT_ID    optional here, as above
 */
"use strict";
const crypto = require("crypto");

const REPO = process.env.GITHUB_REPO || "tmmity3-max/india-base-scanner";
const BRANCH = process.env.ALERTS_BRANCH || "alerts";
const FILE = "alerts.json";

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

// constant-time compare, so the key can't be guessed one character at a time
function keyOk(given) {
  const want = process.env.ALERTS_KEY || "";
  if (!want || typeof given !== "string") return false;
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(want).digest();
  return crypto.timingSafeEqual(a, b);
}

async function gh(path, opts = {}) {
  const headers = {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "india-base-scanner-site",
  };
  if (opts.body) headers["Content-Type"] = "application/json";
  return fetch(`https://api.github.com/repos/${REPO}${path}`, { ...opts, headers });
}

// The alerts branch holds only alerts.json. Make it (with no history from main) the first time.
async function createBranch() {
  const tree = await gh("/git/trees", {
    method: "POST",
    body: JSON.stringify({ tree: [{ path: FILE, mode: "100644", type: "blob", content: JSON.stringify({ alerts: [] }, null, 1) + "\n" }] }),
  });
  if (!tree.ok) throw new Error(`GitHub refused to create the alerts branch (${tree.status}). Check that GITHUB_TOKEN has Contents: read and write.`);
  const commit = await gh("/git/commits", {
    method: "POST",
    body: JSON.stringify({ message: "Start the alerts list", tree: (await tree.json()).sha, parents: [] }),
  });
  if (!commit.ok) throw new Error(`GitHub refused to create the alerts branch (${commit.status}).`);
  const ref = await gh("/git/refs", { method: "POST", body: JSON.stringify({ ref: `refs/heads/${BRANCH}`, sha: (await commit.json()).sha }) });
  if (!ref.ok && ref.status !== 422) throw new Error(`GitHub refused to create the alerts branch (${ref.status}).`);   // 422: made meanwhile
}

async function readAlerts(retry = true) {
  const r = await gh(`/contents/${FILE}?ref=${encodeURIComponent(BRANCH)}`);
  if (r.status === 404 && retry) {
    const b = await gh(`/git/ref/heads/${encodeURIComponent(BRANCH)}`);
    if (b.status === 404) { await createBranch(); return readAlerts(false); }
    return { data: { alerts: [] }, sha: null };          // branch there, file not yet
  }
  if (r.status === 401 || r.status === 403) throw new Error(`GitHub refused the token (${r.status}). Check GITHUB_TOKEN in Vercel.`);
  if (!r.ok) throw new Error(`GitHub answered ${r.status} while reading the alerts.`);
  const j = await r.json();
  let data = {};
  try { data = JSON.parse(Buffer.from(j.content || "", "base64").toString("utf8") || "{}"); } catch (e) { data = {}; }
  if (!Array.isArray(data.alerts)) data.alerts = [];
  return { data, sha: j.sha };
}

// false when the file changed since it was read (try again)
async function writeAlerts(data, sha, message) {
  const body = { message, branch: BRANCH, content: Buffer.from(JSON.stringify(data, null, 1) + "\n").toString("base64") };
  if (sha) body.sha = sha;
  const r = await gh(`/contents/${FILE}`, { method: "PUT", body: JSON.stringify(body) });
  if (r.status === 409 || r.status === 422) return false;
  if (!r.ok) throw new Error(`GitHub answered ${r.status} while saving the alerts.`);
  return true;
}

// read, change, save; again from the top if someone else saved in between
async function updateAlerts(change, message) {
  for (let i = 0; i < 4; i++) {
    const { data, sha } = await readAlerts();
    const out = change(data);
    if (out === false) return data;                       // nothing to save
    if (await writeAlerts(data, sha, message)) return data;
  }
  throw new Error("The alerts list kept changing while saving. Try again.");
}

async function telegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) throw new Error("Add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in Vercel to send a test from here. The GitHub Action uses its own copies in the repository's secrets.");
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  if (!r.ok) {
    let why = "";
    try { why = (await r.json()).description || ""; } catch (e) { /* ignore */ }
    throw new Error(`Telegram refused the message${why ? ": " + why : ""}. Check the bot token and chat id, and that you have sent the bot a message first.`);
  }
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body || "{}"); } catch (e) { return {}; } }
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch (e) { return {}; }
}

module.exports = { send, keyOk, readAlerts, updateAlerts, telegram, readBody };
