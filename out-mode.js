"use strict";
// Out mode: the "you're unexpectedly out" emergency procedure, automated.
//
// The owner approves one client notice ahead of time. Turning Out mode on
// (in Settings, from the backup contact's private link, or by the admin API)
// sends THAT notice, word for word with only the name, return date and backup
// filled in, once to each active client (Engaged or Diagnostic stage, with a
// linked contact email). It also pauses the check-up day-3/day-10 drafts.
// Nothing AI-written goes out, and editing the wording withdraws approval
// until it is approved again. Turning Out mode off sends nothing.

const crypto = require("crypto");
const { ORG } = require("./accounts");

const KEY = "out_mode";
const ACTIVE_STAGES = ["engaged", "assessment"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_SUBJECT = "A quick note from {me}";
const DEFAULT_BODY = "Hi {first},\n\nI'm unexpectedly out until {until}. Anything due from me in that time will move, and I'll confirm new dates as soon as I'm back.\n\nIf something can't wait, please contact {backupName} at {backupEmail}.\n\nThank you for your patience.";

const nowIso = () => new Date().toISOString();
const hash = (s, b) => crypto.createHash("sha256").update(String(s) + "\n" + String(b)).digest("hex").slice(0, 16);
const leader = () => ((ORG.org || {}).leader || {});
const signature = () => { const o = ORG.org || {}, l = leader(); return `\n\n${l.name || ""}${l.title ? "\n" + l.title : ""}\n${o.name || ""}`.replace(/\n{3,}/g, "\n\n"); };
const fmtDate = (iso) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return ""; const d = new Date(iso + "T12:00:00Z"); return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }); };

async function load(pool) {
  let v = {};
  try { v = JSON.parse(((await pool.query("SELECT value FROM app_settings WHERE key = $1", [KEY])).rows[0] || {}).value || "{}"); } catch (e) { v = {}; }
  return Object.assign({ on: false, since: "", until: "", backupName: "", backupEmail: "", subject: DEFAULT_SUBJECT, body: DEFAULT_BODY, approvedAt: "", approvedBy: "", approvedHash: "", backupKey: "", history: [] }, v);
}
async function save(pool, v) {
  await pool.query("INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [KEY, JSON.stringify(v)]);
}
const approved = (v) => !!v.approvedAt && v.approvedHash === hash(v.subject, v.body);
async function isOn(pool) { return (await load(pool)).on; }

// Active clients with an email, one row per address.
async function recipients(pool) {
  const rows = (await pool.query(`SELECT p.id, p.org, p.name AS deal, c.name, c.email FROM pipeline p
    JOIN contact_links l ON l.kind = 'pipeline' AND l.ref_id = p.id JOIN contacts c ON c.id = l.contact_id
    WHERE p.stage = ANY($1) AND p.archived_at IS NULL AND c.archived_at IS NULL AND c.email <> ''`, [ACTIVE_STAGES]).catch(() => ({ rows: [] }))).rows;
  const seen = new Set(), out = [];
  for (const r of rows) { const e = r.email.trim().toLowerCase(); if (!EMAIL_RE.test(e) || seen.has(e)) continue; seen.add(e); out.push({ dealId: r.id, org: r.org || r.deal, name: r.name, email: e }); }
  // Deals in those stages that have no contact email (so the owner can fix them).
  const missing = (await pool.query(`SELECT p.id, COALESCE(NULLIF(p.org, ''), p.name) AS label FROM pipeline p WHERE p.stage = ANY($1) AND p.archived_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM contact_links l JOIN contacts c ON c.id = l.contact_id WHERE l.kind = 'pipeline' AND l.ref_id = p.id AND c.email <> '' AND c.archived_at IS NULL)`, [ACTIVE_STAGES]).catch(() => ({ rows: [] }))).rows;
  return { list: out, missing: missing.map((m) => m.label) };
}

function fill(text, v, r) {
  const first = String(r.name || "").trim().split(/\s+/)[0] || "there";
  return String(text).replace(/\{first\}/g, first).replace(/\{org\}/g, r.org || "your organization")
    .replace(/\{until\}/g, fmtDate(v.until) || "further notice").replace(/\{backupName\}/g, v.backupName).replace(/\{backupEmail\}/g, v.backupEmail)
    .replace(/\{me\}/g, (leader().name || "").split(/\s+/)[0] || "me");
}

// Send one pre-approved notice: Gmail if connected, else the website server.
async function deliver(pool, { to, subject, body }) {
  const GMAIL = require("./gmail");
  const gm = await GMAIL.sender(pool).catch(() => null);
  if (gm) { const s = await GMAIL.send(pool, { to, subject, body }); return { via: "gmail:" + s.account, threadId: s.threadId || "", messageId: s.messageId || "" }; }
  const url = (process.env.WEBSITE_API_URL || "").replace(/\/+$/, ""), secret = process.env.WEBSITE_ADMIN_SECRET || "";
  if (!url || !secret) throw new Error("No way to send email: connect Gmail in Settings.");
  const r = await fetch(url + "/api/admin/send-message", { method: "POST", headers: { "Content-Type": "application/json", "X-Reminder-Secret": secret }, body: JSON.stringify({ to, subject, text: body, replyTo: (ORG.org || {}).email || undefined }), signal: AbortSignal.timeout(90000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error || "status " + r.status);
  return { via: "website", threadId: "", messageId: "" };
}

async function turnOn(pool, { until, by }) {
  const v = await load(pool);
  if (!approved(v)) throw Object.assign(new Error("The client notice hasn't been approved yet. Approve its wording in Settings first."), { status: 409 });
  if (!v.backupName || !EMAIL_RE.test(v.backupEmail)) throw Object.assign(new Error("Add a backup contact in Settings first."), { status: 409 });
  if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) throw Object.assign(new Error("Return date should look like 2026-12-08."), { status: 400 });
  if (v.on) { if (until) { v.until = until; await save(pool, v); } return { ok: true, already: true, sent: 0, failed: [] }; }
  v.on = true; v.since = nowIso(); v.until = until || v.until || ""; v.onBy = by || "";
  await save(pool, v);
  const { list, missing } = await recipients(pool);
  let sent = 0; const failed = [];
  for (const r of list) {
    const subject = fill(v.subject, v, r), body = fill(v.body, v, r) + signature();
    const id = crypto.randomUUID();
    try {
      const d = await deliver(pool, { to: r.email, subject, body });
      await pool.query(`INSERT INTO proc_outbox (id, kind, to_email, to_name, subject, body, created_at, purpose, subject_kind, subject_id, subject_label, status, sent_at, approved_by, sent_via, gmail_thread_id, gmail_message_id)
        VALUES ($1, 'first', $2, $3, $4, $5, $6, 'Out of office notice (pre-approved)', 'pipeline', $7, $8, 'sent', $6, $9, $10, $11, $12)`,
      [id, r.email, r.name, subject, body, nowIso(), r.dealId, r.org, "Pre-approved by " + (v.approvedBy || "owner") + " on " + v.approvedAt.slice(0, 10), d.via, d.threadId, d.messageId]);
      sent++;
    } catch (e) { failed.push(r.email + " (" + String(e.message || e).slice(0, 80) + ")"); }
  }
  v.history = [{ on: v.since, by: by || "", until: v.until, sent, failed: failed.length, missing }].concat(v.history || []).slice(0, 20);
  await save(pool, v);
  return { ok: true, sent, failed, missing };
}

async function turnOff(pool, { by }) {
  const v = await load(pool);
  if (!v.on) return { ok: true, already: true };
  v.on = false;
  if (v.history && v.history[0] && !v.history[0].off) { v.history[0].off = nowIso(); v.history[0].offBy = by || ""; }
  await save(pool, v);
  return { ok: true };
}

const publicView = async (pool) => {
  const v = await load(pool), r = await recipients(pool);
  return { on: v.on, since: v.since, until: v.until, backupName: v.backupName, backupEmail: v.backupEmail, subject: v.subject, body: v.body,
    approved: approved(v), approvedAt: approved(v) ? v.approvedAt : "", hasBackupLink: !!v.backupKey, history: v.history || [],
    recipients: r.list.map((x) => ({ name: x.name, email: x.email, org: x.org })), missing: r.missing,
    preview: r.list[0] ? { subject: fill(v.subject, v, r.list[0]), body: fill(v.body, v, r.list[0]) + signature() } : null };
};

const page = (title, inner) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:40px auto;padding:0 20px;color:#1d2733;line-height:1.5}h1{font-size:22px}button{font-size:17px;padding:12px 18px;border-radius:8px;border:0;background:#1f3a5f;color:#fff;width:100%;margin-top:12px}button.off{background:#8a6d1d}label{display:block;margin-top:14px;font-weight:600}input{font-size:16px;padding:10px;width:100%;box-sizing:border-box;margin-top:6px;border:1px solid #c7cdd3;border-radius:6px}.note{color:#5b6672;font-size:14px}.ok{background:#eef6ee;padding:12px;border-radius:8px}</style></head><body>${inner}</body></html>`;
const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function mount(app, { pool, requireAuth, requireAdminScope }) {
  const wrap = (fn) => (req, res) => fn(req, res).catch((e) => res.status(e.status || 500).json({ error: e.message || String(e) }));
  const who = (req) => (req.session && (req.session.name || req.session.email)) || "owner";

  // Owner only (the /api/settings prefix is owner-only).
  app.get("/api/settings/out-mode", requireAuth, wrap(async (req, res) => res.json(await publicView(pool))));
  app.post("/api/settings/out-mode", requireAuth, wrap(async (req, res) => {
    const b = req.body || {}, v = await load(pool);
    if (b.backupName != null) v.backupName = String(b.backupName).trim().slice(0, 80);
    if (b.backupEmail != null) { const e = String(b.backupEmail).trim(); if (e && !EMAIL_RE.test(e)) return res.status(400).json({ error: "That backup email doesn't look right." }); v.backupEmail = e; }
    if (b.subject != null) v.subject = String(b.subject).slice(0, 200);
    if (b.body != null) v.body = String(b.body).slice(0, 4000);
    if (b.approve) {
      if (!v.backupName || !v.backupEmail) return res.status(400).json({ error: "Add the backup contact before approving." });
      v.approvedAt = nowIso(); v.approvedBy = who(req); v.approvedHash = hash(v.subject, v.body);
    }
    if (b.newBackupLink) v.backupKey = crypto.randomBytes(18).toString("base64url");
    await save(pool, v);
    const out = await publicView(pool);
    if (b.newBackupLink) out.backupLink = (process.env.PUBLIC_URL || "").replace(/\/?$/, "/") + "out/" + v.backupKey;
    res.json(out);
  }));
  app.post("/api/settings/out-mode/on", requireAuth, wrap(async (req, res) => res.json(await turnOn(pool, { until: (req.body || {}).until, by: who(req) }))));
  app.post("/api/settings/out-mode/off", requireAuth, wrap(async (req, res) => res.json(await turnOff(pool, { by: who(req) }))));

  // Admin token (so Claude can flip it from a phone conversation).
  if (requireAdminScope) {
    app.get("/api/admin/out-mode", requireAdminScope("status"), wrap(async (req, res) => res.json(await publicView(pool))));
    app.post("/api/admin/out-mode", requireAdminScope("status"), wrap(async (req, res) => {
      const b = req.body || {};
      res.json(b.on ? await turnOn(pool, { until: b.until, by: "admin API" }) : await turnOff(pool, { by: "admin API" }));
    }));
  }

  // The backup contact's private link: no account needed, can only turn Out mode on or off.
  const keyOk = async (k) => { const v = await load(pool); return v.backupKey && k && k.length === v.backupKey.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(v.backupKey)) ? v : null; };
  app.get("/out/:key", wrap(async (req, res) => {
    const v = await keyOk(req.params.key);
    if (!v) return res.status(404).send(page("Not found", "<p>This link isn't active.</p>"));
    const name = esc((leader().name || "Franklin").split(/\s+/)[0]);
    res.set("Cache-Control", "no-store").send(page("Out of office", v.on
      ? `<h1>${name} is marked out</h1><p class="ok">Since ${esc(v.since.slice(0, 10))}${v.until ? ", back " + esc(fmtDate(v.until)) : ""}. Clients were told.</p><form method="post"><input type="hidden" name="action" value="off"><button class="off">${name} is back: turn Out mode off</button></form>`
      : `<h1>Is ${name} unexpectedly out?</h1><p>Turning this on sends ${name}'s pre-approved note to each active client, says you're the contact for anything urgent, and pauses follow-up emails to new leads.</p><form method="post"><input type="hidden" name="action" value="on"><label>Expected back (optional)<input type="date" name="until"></label><button>Turn Out mode on</button></form><p class="note">Only use this if ${name} can't do it himself.</p>`));
  }));
  app.post("/out/:key", require("express").urlencoded({ extended: false }), wrap(async (req, res) => {
    const v = await keyOk(req.params.key);
    if (!v) return res.status(404).send(page("Not found", "<p>This link isn't active.</p>"));
    const b = req.body || {}, by = "backup contact (" + v.backupName + ")";
    try {
      if (b.action === "on") { const r = await turnOn(pool, { until: String(b.until || ""), by }); return res.send(page("Done", `<h1>Out mode is on</h1><p class="ok">The note went to ${r.sent} client${r.sent === 1 ? "" : "s"}.${r.failed && r.failed.length ? " " + r.failed.length + " couldn't be reached." : ""}</p><p><a href="">Back</a></p>`)); }
      await turnOff(pool, { by }); return res.send(page("Done", `<h1>Out mode is off</h1><p class="ok">Welcome back. Nothing was sent.</p>`));
    } catch (e) { return res.status(e.status || 500).send(page("Couldn't do that", `<p>${esc(e.message)}</p>`)); }
  }));
}

module.exports = { mount, isOn, load, turnOn, turnOff, recipients, DEFAULT_BODY };
