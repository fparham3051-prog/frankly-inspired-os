"use strict";
// Gmail connection: approved checklist messages go out from the owner's own
// Google account (Gmail or Google Workspace), replies thread normally, and the
// app notices when someone replies.
//
// Setup (owner, once): create a Google Cloud OAuth client (Web application)
// with the redirect address shown in Settings > Connected email, paste its
// Client ID and Client secret there, then "Connect a Google account". More
// than one account can be connected; pick which one (and which of its "Send
// mail as" addresses) messages go out from.
//
// Scopes: gmail.send (send approved messages) and gmail.readonly (read the
// threads of messages we sent, to notice replies; and list Send-as addresses).
// Nothing is ever sent without approval; this module only sends what the
// approval screen hands it. Tokens are stored encrypted in app_settings.
//
//   GET  /api/gmail/status            configured?, redirect address, accounts, default sender
//   POST /api/gmail/config            {clientId, clientSecret}
//   GET  /oauth/google/start          connect an account (owner)
//   GET  /oauth/google/callback       Google returns here
//   POST /api/gmail/default           {account, from}
//   POST /api/gmail/disconnect        {account}

const crypto = require("crypto");
const { ORG } = require("./accounts");

const AUTH_URL = process.env.GOOGLE_AUTH_URL || "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = process.env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";
const REVOKE_URL = process.env.GOOGLE_REVOKE_URL || "https://oauth2.googleapis.com/revoke";
const GMAIL = (process.env.GMAIL_API_BASE || "https://gmail.googleapis.com").replace(/\/$/, "");
// drive.file: only files this app creates (the prospect report sheet); it
// can't see anything else in the Drive.
const SCOPES = ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/drive.file"];

// ---------- encrypted settings ----------
function key() { return crypto.createHash("sha256").update(String(process.env.SESSION_SECRET || "dev") + "|gmail").digest(); }
function seal(text) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const out = Buffer.concat([c.update(String(text), "utf8"), c.final()]);
  return [iv, c.getAuthTag(), out].map((b) => b.toString("base64url")).join(".");
}
function open(sealed) {
  try {
    const [iv, tag, data] = String(sealed).split(".").map((s) => Buffer.from(s, "base64url"));
    const d = crypto.createDecipheriv("aes-256-gcm", key(), iv); d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]).toString("utf8");
  } catch (e) { return ""; }
}
async function getS(pool, k) { const r = (await pool.query("SELECT value FROM app_settings WHERE key = $1", [k]).catch(() => ({ rows: [] }))).rows[0]; return r ? r.value : ""; }
async function setS(pool, k, v) { await pool.query("INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [k, v]); }
async function delS(pool, k) { await pool.query("DELETE FROM app_settings WHERE key = $1", [k]); }

async function config(pool) {
  const id = await getS(pool, "google_client_id"), secret = open(await getS(pool, "google_client_secret"));
  return { clientId: id, clientSecret: secret, ok: !!(id && secret) };
}
async function accounts(pool) { try { return JSON.parse(open(await getS(pool, "gmail_accounts")) || "[]"); } catch (e) { return []; } }
async function saveAccounts(pool, list) { await setS(pool, "gmail_accounts", seal(JSON.stringify(list))); }
async function defaults(pool) { try { return JSON.parse(await getS(pool, "gmail_default") || "{}"); } catch (e) { return {}; } }

function redirectUri() {
  const base = String(process.env.PUBLIC_URL || (ORG.links || {}).operations || "http://localhost:5088/").replace(/\/?$/, "/");
  return base + "oauth/google/callback";
}

// ---------- tokens ----------
const tokenCache = new Map(); // email -> {token, exp}
async function accessToken(pool, email) {
  const hit = tokenCache.get(email);
  if (hit && hit.exp > Date.now() + 60000) return hit.token;
  const cfg = await config(pool);
  const acct = (await accounts(pool)).find((a) => a.email === email);
  if (!cfg.ok || !acct) throw new Error("Gmail isn't connected.");
  const r = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: acct.refresh, grant_type: "refresh_token" }), signal: AbortSignal.timeout(30000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    const why = j.error === "invalid_grant" ? "Google says the connection was revoked or expired; reconnect it in Settings." : (j.error_description || j.error || "token refresh failed");
    throw new Error(why);
  }
  tokenCache.set(email, { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3000) * 1000 });
  return j.access_token;
}
async function gapi(pool, email, path, opts) {
  const t = await accessToken(pool, email);
  const r = await fetch(/^https?:/.test(path) ? path : GMAIL + path, Object.assign({ signal: AbortSignal.timeout(60000) }, opts || {}, { headers: Object.assign({ Authorization: "Bearer " + t }, (opts && opts.headers) || {}) }));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && (j.error.message || j.error.status)) || "Gmail returned " + r.status);
  return j;
}

// ---------- sending ----------
function encodeHeader(s) { return /^[\x20-\x7e]*$/.test(s) ? s : "=?UTF-8?B?" + Buffer.from(s, "utf8").toString("base64") + "?="; }
function mime({ from, fromName, to, subject, body, inReplyTo }) {
  const lines = [
    `From: ${fromName ? encodeHeader(fromName) + " " : ""}<${from}>`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ];
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`);
  return lines.join("\r\n") + "\r\n\r\n" + Buffer.from(body, "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
}
async function sender(pool) {
  const list = await accounts(pool);
  if (!list.length) return null;
  const d = await defaults(pool);
  const acct = list.find((a) => a.email === d.account) || list[0];
  const from = d.account === acct.email && d.from && (acct.sendAs || []).some((x) => x.email === d.from) ? d.from : acct.email;
  const alias = (acct.sendAs || []).find((x) => x.email === from);
  return { account: acct.email, from, fromName: (alias && alias.displayName) || ((ORG.org || {}).leader || {}).name || "" };
}
// Send one approved message. threadId/inReplyTo keep follow-ups in the same thread.
async function send(pool, { to, subject, body, threadId, inReplyTo }) {
  const s = await sender(pool);
  if (!s) throw new Error("Gmail isn't connected.");
  const raw = Buffer.from(mime({ from: s.from, fromName: s.fromName, to, subject, body, inReplyTo })).toString("base64url");
  const sent = await gapi(pool, s.account, "/gmail/v1/users/me/messages/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(threadId ? { raw, threadId } : { raw }) });
  let messageId = "";
  try {
    const m = await gapi(pool, s.account, `/gmail/v1/users/me/messages/${encodeURIComponent(sent.id)}?format=metadata&metadataHeaders=Message-ID`);
    const h = ((m.payload || {}).headers || []).find((x) => /^message-id$/i.test(x.name));
    messageId = h ? h.value : "";
  } catch (e) { /* threading still works without it */ }
  return { id: sent.id, threadId: sent.threadId, messageId, from: s.from, account: s.account };
}

// Notice replies to messages we sent: anything in the thread, after our
// message, from someone other than us.
async function checkReplies(pool) {
  const list = await accounts(pool);
  if (!list.length) return { checked: 0, replies: 0 };
  const ours = new Set(list.flatMap((a) => [a.email].concat((a.sendAs || []).map((x) => x.email))).map((e) => e.toLowerCase()));
  const since = new Date(Date.now() - 60 * 864e5).toISOString();
  const rows = (await pool.query("SELECT id, run_id, gmail_thread_id, sent_at, subject, to_email FROM proc_outbox WHERE sent_via LIKE 'gmail:%' AND gmail_thread_id <> '' AND replied_at = '' AND sent_at >= $1 ORDER BY sent_at DESC LIMIT 40", [since])).rows;
  let replies = 0;
  for (const o of rows) {
    const acct = (await pool.query("SELECT sent_via FROM proc_outbox WHERE id = $1", [o.id])).rows[0].sent_via.slice(6);
    if (!list.some((a) => a.email === acct)) continue;
    try {
      const t = await gapi(pool, acct, `/gmail/v1/users/me/threads/${encodeURIComponent(o.gmail_thread_id)}?format=metadata&metadataHeaders=From`);
      const sentMs = Date.parse(o.sent_at);
      const reply = (t.messages || []).find((m) => {
        const from = (((m.payload || {}).headers || []).find((h) => /^from$/i.test(h.name)) || {}).value || "";
        const addr = ((/<([^>]+)>/.exec(from) || [])[1] || from).trim().toLowerCase();
        return Number(m.internalDate) > sentMs + 1000 && addr && !ours.has(addr);
      });
      if (reply) {
        const from = (((reply.payload || {}).headers || []).find((h) => /^from$/i.test(h.name)) || {}).value || "";
        const when = new Date(Number(reply.internalDate)).toISOString();
        await pool.query("UPDATE proc_outbox SET replied_at = $1, reply_from = $2 WHERE id = $3", [when, from.slice(0, 200), o.id]);
        await pool.query("INSERT INTO proc_activity (id, run_id, at, text) VALUES ($1,$2,$3,$4)", [crypto.randomUUID(), o.run_id, when, `Reply received from ${from.replace(/<.*>/, "").trim() || from}: ${o.subject}`]);
        replies++;
      }
    } catch (e) { /* try again next pass */ }
  }
  return { checked: rows.length, replies };
}

function mount(app, { pool, requireAuth }) {
  const ownerOnly = (req, res, next) => (req.session && req.session.role === "owner" ? next() : res.status(403).json({ error: "Only the owner can manage the email connection." }));
  const wrap = (fn) => async (req, res) => { try { await fn(req, res); } catch (err) { console.error("gmail", err); res.status(500).json({ error: String(err.message || err) }); } };

  app.get("/api/gmail/status", requireAuth, wrap(async (req, res) => {
    const cfg = await config(pool), list = await accounts(pool), d = await defaults(pool), s = await sender(pool);
    res.json({ configured: cfg.ok, clientId: cfg.clientId, redirectUri: redirectUri(), sender: s,
      accounts: list.map((a) => ({ email: a.email, connectedAt: a.connectedAt, sheets: /drive\.file/.test(a.scope || ""), sendAs: (a.sendAs || []).map((x) => ({ email: x.email, displayName: x.displayName, isDefault: !!x.isDefault })) })), default: d });
  }));
  app.post("/api/gmail/config", requireAuth, ownerOnly, wrap(async (req, res) => {
    const b = req.body || {};
    const id = String(b.clientId || "").trim(), secret = String(b.clientSecret || "").trim();
    if (!/\.apps\.googleusercontent\.com$/.test(id)) return res.status(400).json({ error: "That doesn't look like a Google OAuth Client ID (it ends in .apps.googleusercontent.com)." });
    if (secret.length < 10) return res.status(400).json({ error: "Paste the Client secret too." });
    await setS(pool, "google_client_id", id);
    await setS(pool, "google_client_secret", seal(secret));
    tokenCache.clear();
    res.json({ ok: true });
  }));
  app.get("/oauth/google/start", requireAuth, ownerOnly, wrap(async (req, res) => {
    const cfg = await config(pool);
    if (!cfg.ok) return res.status(400).send("Add the Google Client ID and secret in Settings first.");
    const state = crypto.randomBytes(18).toString("base64url");
    await setS(pool, "gmail_oauth_state", JSON.stringify({ state, exp: Date.now() + 15 * 60000 }));
    const u = new URL(AUTH_URL);
    u.search = new URLSearchParams({ client_id: cfg.clientId, redirect_uri: redirectUri(), response_type: "code", scope: SCOPES.join(" "), access_type: "offline", prompt: "consent", include_granted_scopes: "true", state }).toString();
    res.redirect(302, u.toString());
  }));
  app.get("/oauth/google/callback", requireAuth, ownerOnly, async (req, res) => {
    const back = (msg) => res.redirect(303, "/?gmail=" + encodeURIComponent(msg));
    try {
      const saved = JSON.parse(await getS(pool, "gmail_oauth_state") || "{}");
      await delS(pool, "gmail_oauth_state");
      if (req.query.error) return back(req.query.error === "access_denied" ? "cancelled" : "error: " + req.query.error);
      if (!saved.state || saved.state !== req.query.state || saved.exp < Date.now()) return back("error: the sign-in took too long or didn't match; try again");
      const cfg = await config(pool);
      const r = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code: String(req.query.code || ""), client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: redirectUri(), grant_type: "authorization_code" }), signal: AbortSignal.timeout(30000) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.refresh_token) return back("error: " + (j.error_description || j.error || "Google didn't return a long-lived token; remove the app's access in your Google account and connect again"));
      const prof = await fetch(GMAIL + "/gmail/v1/users/me/profile", { headers: { Authorization: "Bearer " + j.access_token } }).then((x) => x.json());
      const email = String(prof.emailAddress || "").toLowerCase();
      if (!email) return back("error: couldn't read the account's address");
      let sendAs = [];
      try {
        const sa = await fetch(GMAIL + "/gmail/v1/users/me/settings/sendAs", { headers: { Authorization: "Bearer " + j.access_token } }).then((x) => x.json());
        sendAs = (sa.sendAs || []).filter((x) => !x.verificationStatus || x.verificationStatus === "accepted").map((x) => ({ email: String(x.sendAsEmail).toLowerCase(), displayName: x.displayName || "", isDefault: !!x.isDefault }));
      } catch (e) { /* the account address still works */ }
      const list = (await accounts(pool)).filter((a) => a.email !== email);
      list.push({ email, refresh: j.refresh_token, sendAs, scope: String(j.scope || ""), connectedAt: new Date().toISOString() });
      await saveAccounts(pool, list);
      tokenCache.set(email, { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3000) * 1000 });
      const d = await defaults(pool);
      if (!d.account) await setS(pool, "gmail_default", JSON.stringify({ account: email, from: (sendAs.find((x) => x.isDefault) || {}).email || email }));
      back("connected " + email);
    } catch (err) { console.error("gmail callback", err); back("error: " + (err.message || err)); }
  });
  app.post("/api/gmail/default", requireAuth, ownerOnly, wrap(async (req, res) => {
    const b = req.body || {}, list = await accounts(pool);
    const acct = list.find((a) => a.email === String(b.account || "").toLowerCase());
    if (!acct) return res.status(400).json({ error: "That account isn't connected." });
    const from = String(b.from || acct.email).toLowerCase();
    if (from !== acct.email && !(acct.sendAs || []).some((x) => x.email === from)) return res.status(400).json({ error: "That address isn't one of the account's Send-as addresses." });
    await setS(pool, "gmail_default", JSON.stringify({ account: acct.email, from }));
    res.json({ ok: true, sender: await sender(pool) });
  }));
  app.post("/api/gmail/disconnect", requireAuth, ownerOnly, wrap(async (req, res) => {
    const email = String((req.body || {}).account || "").toLowerCase();
    const list = await accounts(pool), acct = list.find((a) => a.email === email);
    if (acct) fetch(REVOKE_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: acct.refresh }) }).catch(() => {});
    await saveAccounts(pool, list.filter((a) => a.email !== email));
    tokenCache.delete(email);
    const d = await defaults(pool);
    if (d.account === email) { const next = list.find((a) => a.email !== email); if (next) await setS(pool, "gmail_default", JSON.stringify({ account: next.email, from: next.email })); else await delS(pool, "gmail_default"); }
    res.json({ ok: true });
  }));
}

module.exports = { mount, send, sender, checkReplies, accounts, gapi, _mime: mime };
