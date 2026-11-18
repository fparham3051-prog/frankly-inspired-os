"use strict";
// Projects & Team (the Flow Hub) inside the operations app.
//
// The page in public/hub/ is the Flow Hub built and tested on claude.ai. Its
// storage layer talks to the endpoints below instead of claude.ai, through
// public/hub/js/fios.js. Everything it keeps lives in two tables:
//
//   hub_docs   one row per document: (path, id) -> JSON. "path" is the
//              collection, e.g. "tasks", "projects", "config", or a person's
//              own subtree such as "pulses/u3/entries". Deletes keep a
//              tombstone so every open page hears about them.
//   hub_files  files attached to tasks and projects (10 MB each).
//
// What comes from the rest of the operations app instead of being copied:
//   team         = active sign-in accounts (app_users). The hub stores only
//                  extras per person (color, weekly hours, digest opt-in).
//   engagements  = pipeline deals. Projects and tasks link to a deal; the hub
//                  stores only its own notes per deal.
//   time         = minutes logged on a task linked to a deal are also written
//                  to time_entries, so Pipeline & Money sees them.
//
// Who can see and change what (mirrors the rules the hub had on claude.ai):
//   owner   everything, including settings, rules, cost rates, and everyone's
//           check-ins and coaching notes
//   staff   all shared work; only their own check-ins, coaching, usage,
//           feedback, activity log and private notes; their own team extras
//   board   read the shared work; no changes
//
//   GET    /api/hub/sync?since=&tab=&pres=   changed documents + team, deals, who's here
//   POST   /api/hub/write                    {ops:[{path, id, data|null}]}
//   POST   /api/hub/ai                       {prompt, json, maxTokens}
//   POST   /api/hub/email                    {to, subject, body} (only when the owner turned hub email on)
//   POST   /api/hub/files                    raw body, X-File-Name header
//   GET    /api/hub/files/:id
//   DELETE /api/hub/files/:id
//   POST   /api/admin/hub-digest             send today's digests now (also runs inside the tick)
const crypto = require("crypto");
const path = require("path");
const express = require("express");
const { ORG } = require("./accounts");

const SELF_ROOTS = ["pulses", "coaching", "usage", "feedback", "audit"];
const SHARED = ["engagements", "tasks", "messages", "events", "notifs", "projects", "goals", "dashboards", "ptemplates", "utests", "anon", "team"];
const PATH_RE = /^[a-z]+(\/[A-Za-z0-9_-]{1,80}){0,3}$/;
const ID_RE = /^[A-Za-z0-9_.-]{1,120}$/;
const MAX_DOC = 400 * 1024;
const STAGE_MAP = { lead: "lead", discovery: "discovery", assessment: "diagnostic", engaged: "delivery", graduated: "sustain", referred: "closeout", lost: "lead" };

let lastT = 0;
const nextT = () => (lastT = Math.max(Date.now(), lastT + 1));
const presence = new Map(); // tab -> { uid, pres, at }

function canRead(p, id, me) {
  const s = p.split("/");
  if (s[0] === "config" && id === "rates") return me.owner;
  if (SELF_ROOTS.includes(s[0]) && s.length >= 2) return me.owner || s[1] === me.uid;
  if (s[0] === "data") return s[1] === "users" && s[2] === me.uid;
  return true;
}
function canWrite(p, id, me) {
  if (me.role === "board") return false;
  const s = p.split("/");
  if (s[0] === "config" || s[0] === "rules") return me.owner && s.length === 1;
  if (s[0] === "audit") return s.length === 3 && s[1] === me.uid;
  if (SELF_ROOTS.includes(s[0])) return s.length === 3 && (me.owner || s[1] === me.uid);
  if (s[0] === "data") return s.length === 3 && s[1] === "users" && s[2] === me.uid;
  if (s[0] === "team") return s.length === 1 && (me.owner || id === me.uid);
  return s.length === 1 && SHARED.includes(s[0]);
}

function mount(app, { pool, requireAuth, verifySession, COOKIE_NAME, requireAdminScope }) {
  const G = () => require("./gmail");
  const AI = () => require("./ai");

  // The shared practice password signs in as user 0; treat that as the first owner account so there is one Franklin.
  let ownerCache = { at: 0, id: null };
  async function meFor(session) {
    let userId = session.userId || 0;
    if (!userId) {
      if (Date.now() - ownerCache.at > 60000) {
        const r = await pool.query("SELECT id FROM app_users WHERE role = 'owner' AND NOT disabled ORDER BY id LIMIT 1");
        ownerCache = { at: Date.now(), id: r.rows[0] ? r.rows[0].id : null };
      }
      if (ownerCache.id) userId = ownerCache.id;
    }
    return { uid: "u" + userId, userId, role: session.role, owner: session.role === "owner" };
  }

  async function overlays(p) {
    const r = await pool.query("SELECT id, data FROM hub_docs WHERE path = $1 AND NOT deleted", [p]);
    return Object.fromEntries(r.rows.map((x) => [x.id, x.data || {}]));
  }
  async function teamList() {
    const [users, extra] = await Promise.all([pool.query("SELECT id, email, name, role, disabled FROM app_users ORDER BY id"), overlays("team")]);
    const lead = ORG.org && ORG.org.leader ? ORG.org.leader : {};
    const rows = users.rows.length ? users.rows : [{ id: 0, email: ORG.org ? ORG.org.email || "" : "", name: lead.name || "Owner", role: "owner", disabled: false }];
    return rows.filter((u) => !u.disabled).map((u) => {
      const id = "u" + u.id, x = extra[id] || {};
      return { id, data: Object.assign({}, x, { name: u.name || u.email, email: u.email, uid: id, lead: u.role === "owner", fiosRole: u.role, role: x.role || (u.role === "owner" ? (lead.title || "Owner") : u.role === "board" ? "Board" : "Team") }) };
    });
  }
  async function engagementList() {
    const [deals, extra] = await Promise.all([pool.query("SELECT id, name, org, stage, deal_value, next_step, next_step_date, created_at, archived_at FROM pipeline ORDER BY created_at DESC"), overlays("engagements")]);
    return deals.rows.map((d) => {
      const x = extra[d.id] || {};
      return { id: d.id, data: Object.assign({ log: [], gates: {}, invoices: [] }, x, { org: d.org || d.name || "Untitled deal", contact: x.contact || (d.org ? d.name : ""), stage: STAGE_MAP[d.stage] || "lead", fiosStage: d.stage, value: Number(d.deal_value) || 0, outcome: d.stage === "lost" ? "lost" : "", archived: !!d.archived_at, nextStep: d.next_step || "", nextStepDate: d.next_step_date || "", created: d.created_at, fios: true }) };
    });
  }

  // ---------- page ----------
  app.use("/hub", (req, res, next) => (verifySession(req.cookies[COOKIE_NAME]) ? next() : res.redirect("/")), express.static(path.join(__dirname, "public", "hub"), { index: "index.html", maxAge: 0 }));

  // ---------- sync ----------
  app.get("/api/hub/sync", requireAuth, async (req, res) => {
    try {
      const me = await meFor(req.session);
      const since = Math.max(0, Number(req.query.since) || 0);
      const r = await pool.query("SELECT path, id, data, deleted, t FROM hub_docs WHERE t > $1 ORDER BY t LIMIT 20000", [since]);
      const docs = r.rows.filter((x) => !(since === 0 && x.deleted) && canRead(x.path, x.id, me)).map((x) => ({ path: x.path, id: x.id, data: x.deleted ? null : x.data, t: Number(x.t) }));
      const now = r.rows.length ? Math.max(...r.rows.map((x) => Number(x.t))) : since;
      const tab = String(req.query.tab || "").slice(0, 40);
      if (tab) {
        let pres = {};
        try { pres = JSON.parse(String(req.query.pres || "{}").slice(0, 2000)); } catch (e) { /* keep empty */ }
        presence.set(tab, { uid: me.uid, pres, at: Date.now() });
      }
      const cutoff = Date.now() - 40000;
      for (const [k, v] of presence) if (v.at < cutoff) presence.delete(k);
      const peers = [...presence.entries()].map(([k, v]) => ({ peer: k, by: v.uid, presence: v.pres, at: v.at }));
      const [team, engagements] = await Promise.all([teamList(), engagementList()]);
      res.json({ ok: true, now: Math.max(now, since), me: { uid: me.uid, role: me.role, owner: me.owner }, docs, team, engagements, peers });
    } catch (e) { console.error("hub sync", e); res.status(500).json({ error: "The hub couldn't load. Try again." }); }
  });

  // ---------- writes ----------
  async function syncTime(prev, next, taskId) {
    if (!next || !next.eng || !Array.isArray(next.timeLog)) return 0;
    const deal = await pool.query("SELECT id FROM pipeline WHERE id = $1", [String(next.eng)]);
    if (!deal.rows[0]) return 0;
    const old = new Set(((prev && prev.timeLog) || []).map((l) => l && l.at));
    let n = 0;
    for (const l of next.timeLog) {
      if (!l || old.has(l.at) || !(Number(l.min) > 0)) continue;
      const id = "hub-" + crypto.createHash("sha256").update(taskId + "|" + l.at).digest("hex").slice(0, 24);
      const r = await pool.query("INSERT INTO time_entries (id, pipeline_id, entry_date, minutes, note, created_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING",
        [id, String(next.eng), String(l.at || "").slice(0, 10), Math.round(Number(l.min)), ("Projects & Team: " + String(next.title || "") + (l.note ? " — " + String(l.note) : "")).slice(0, 400), new Date().toISOString()]);
      n += r.rowCount;
    }
    return n;
  }
  app.post("/api/hub/write", requireAuth, async (req, res) => {
    try {
      const me = await meFor(req.session);
      const ops = Array.isArray(req.body && req.body.ops) ? req.body.ops : [];
      if (!ops.length || ops.length > 500) return res.status(400).json({ error: "Send between 1 and 500 changes." });
      for (const op of ops) {
        if (!op || !PATH_RE.test(String(op.path)) || !ID_RE.test(String(op.id))) return res.status(400).json({ error: "Bad document address." });
        if (!canWrite(op.path, op.id, me)) return res.status(403).json({ error: "You can't change that.", path: op.path, id: op.id });
        if (op.data != null && (typeof op.data !== "object" || Array.isArray(op.data))) return res.status(400).json({ error: "A document must be an object." });
        if (op.data != null && JSON.stringify(op.data).length > MAX_DOC) return res.status(413).json({ error: "That document is too large." });
      }
      let t = 0, time = 0;
      for (const op of ops) {
        t = nextT();
        let data = op.data == null ? null : Object.assign({}, op.data);
        if (data) { delete data.id; }
        if (op.path === "team" && data) { for (const k of ["name", "email", "uid", "lead", "fiosRole"]) delete data[k]; }
        if (op.path === "engagements" && data) { for (const k of ["org", "stage", "fiosStage", "value", "outcome", "archived", "nextStep", "nextStepDate", "created", "fios"]) delete data[k]; }
        let prev = null;
        if (op.path === "tasks") { const p = await pool.query("SELECT data FROM hub_docs WHERE path = 'tasks' AND id = $1", [op.id]); prev = p.rows[0] ? p.rows[0].data : null; }
        await pool.query(`INSERT INTO hub_docs (path, id, data, deleted, t, by_user) VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (path, id) DO UPDATE SET data = EXCLUDED.data, deleted = EXCLUDED.deleted, t = EXCLUDED.t, by_user = EXCLUDED.by_user`,
          [op.path, op.id, data, !data, t, me.uid]);
        if (op.path === "tasks" && data) { try { time += await syncTime(prev, data, op.id); } catch (e) { console.error("hub time sync", e.message); } }
      }
      res.json({ ok: true, t, timeEntries: time });
    } catch (e) { console.error("hub write", e); res.status(500).json({ error: "Couldn't save. Try again." }); }
  });

  // ---------- Claude ----------
  app.post("/api/hub/ai", requireAuth, async (req, res) => {
    try {
      const prompt = String((req.body && req.body.prompt) || "").slice(0, 200000);
      if (!prompt.trim()) return res.status(400).json({ error: "Nothing to ask." });
      const json = !!(req.body && req.body.json);
      const out = await AI().ask(pool, { system: "You are helping inside the practice's Projects & Team workspace (projects, tasks, workload and goals).", prompt, json, maxTokens: Math.min(4000, Number(req.body.maxTokens) || (json ? 4000 : 1500)) });
      res.json(json ? { ok: true, data: out } : { ok: true, text: out });
    } catch (e) { res.status(e.status || 500).json({ error: String(e.message || e), code: e.status === 409 ? "not_granted" : e.status === 429 ? "rate_limited" : "upstream_error" }); }
  });

  // ---------- email (off until the owner turns it on in the hub's settings) ----------
  async function hubEmailOn() {
    const r = await pool.query("SELECT data FROM hub_docs WHERE path = 'config' AND id = 'settings' AND NOT deleted");
    return !!(r.rows[0] && r.rows[0].data && r.rows[0].data.hubEmail);
  }
  const sendLog = [];
  app.post("/api/hub/email", requireAuth, async (req, res) => {
    try {
      if (req.session.role === "board") return res.status(403).json({ error: "Board accounts are view only." });
      if (!(await hubEmailOn())) return res.status(409).json({ error: "Email from Projects & Team is off. The owner can turn it on in Projects & Team → Workspace.", code: "server_not_connected" });
      const to = [].concat((req.body && req.body.to) || []).map(String).filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)).slice(0, 10);
      if (!to.length) return res.status(400).json({ error: "No valid email address." });
      const cutoff = Date.now() - 3600000; while (sendLog.length && sendLog[0] < cutoff) sendLog.shift();
      if (sendLog.length >= 80) return res.status(429).json({ error: "Too many emails this hour.", code: "rate_limited" });
      sendLog.push(Date.now());
      const r = await G().send(pool, { to: to.join(", "), subject: String(req.body.subject || "").slice(0, 300), body: String(req.body.body || "").slice(0, 20000) });
      res.json({ ok: true, id: r.id });
    } catch (e) { res.status(/isn't connected/.test(String(e.message)) ? 409 : 502).json({ error: String(e.message || e), code: /isn't connected/.test(String(e.message)) ? "server_not_connected" : "tool_error" }); }
  });

  // ---------- files ----------
  app.post("/api/hub/files", requireAuth, express.raw({ type: () => true, limit: "10mb" }), async (req, res) => {
    try {
      if (req.session.role === "board") return res.status(403).json({ error: "Board accounts are view only." });
      const me = await meFor(req.session);
      const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!buf.length) return res.status(400).json({ error: "The file is empty." });
      const id = "f" + crypto.randomBytes(9).toString("hex");
      const name = decodeURIComponent(String(req.get("X-File-Name") || "file")).replace(/[\r\n"]/g, "").slice(0, 200);
      const type = String(req.get("Content-Type") || "application/octet-stream").slice(0, 100);
      await pool.query("INSERT INTO hub_files (id, name, type, size, data, by_user, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)", [id, name, type, buf.length, buf, me.uid, new Date().toISOString()]);
      res.json({ id, url: "/api/hub/files/" + id, sizeBytes: buf.length, contentType: type });
    } catch (e) { console.error("hub file", e); res.status(500).json({ error: "Upload failed." }); }
  });
  app.get("/api/hub/files/:id", requireAuth, async (req, res) => {
    const r = await pool.query("SELECT name, type, data FROM hub_files WHERE id = $1", [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: "Not found" });
    const f = r.rows[0]; const safe = /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain|text\/csv)$/.test(f.type);
    res.set({ "Content-Type": safe ? f.type : "application/octet-stream", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox", "Content-Disposition": (safe ? "inline" : "attachment") + "; filename=\"" + encodeURIComponent(f.name) + "\"" });
    res.send(f.data);
  });
  app.delete("/api/hub/files/:id", requireAuth, async (req, res) => {
    const me = await meFor(req.session);
    const r = await pool.query("DELETE FROM hub_files WHERE id = $1 AND ($2 OR by_user = $3)", [req.params.id, me.owner, me.uid]);
    res.status(r.rowCount ? 200 : 404).json({ ok: !!r.rowCount });
  });

  // ---------- daily digest ----------
  app.post("/api/admin/hub-digest", requireAdminScope("status"), async (req, res) => {
    try { res.json(Object.assign({ ok: true }, await digestTick(pool, { force: !!(req.query.force) }))); }
    catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
  });
}

// ---------- digest (weekday mornings, to people who opted in) ----------
function nyNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false, weekday: "short" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, weekday: p.weekday };
}
const fmt = (d) => { if (!d) return ""; const x = new Date(d + "T12:00:00"); return x.toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
const addDays = (d, n) => { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
function digestText(uid, name, docs, today, hubUrl) {
  const tasks = Object.values(docs.tasks || {}).filter((t) => t && !t.cancelled && t.status !== "done" && !t.done && !/^Sample:/.test(t.title || ""));
  const projects = docs.projects || {};
  const mine = tasks.filter((t) => t.owner === uid || (t.assignees || []).includes(uid));
  const pn = (t) => (t.project && projects[t.project] ? ` [${projects[t.project].name}]` : "");
  const line = (t) => `• ${t.title}${pn(t)}${t.due ? ` (due ${fmt(t.due)})` : ""}`;
  const sec = (h, arr, f = line) => (arr.length ? `${h}\n${arr.slice(0, 12).map(f).join("\n")}${arr.length > 12 ? `\n…and ${arr.length - 12} more` : ""}\n` : "");
  const soon = addDays(today, 3);
  const ownProjects = Object.entries(projects).map(([id, p]) => Object.assign({ id }, p)).filter((p) => p.owner === uid && !p.archived && p.status !== "done" && !/^Sample:/.test(p.name || ""));
  const body = [
    sec("Overdue", mine.filter((t) => t.due && t.due < today).sort((a, b) => a.due.localeCompare(b.due))),
    sec("Due today", mine.filter((t) => t.due === today)),
    sec("Due in the next 3 days", mine.filter((t) => t.due > today && t.due <= soon).sort((a, b) => a.due.localeCompare(b.due))),
    sec("Waiting on your approval", tasks.filter((t) => t.approval && t.approval.state === "pending" && t.approval.by === uid)),
    sec("Blocked", tasks.filter((t) => t.status === "blocked" && (t.owner === uid || (docs.team || {})[uid] && (docs.team[uid].lead))), (t) => `• ${t.title}${pn(t)}`),
    sec("Your projects that need attention", ownProjects.filter((p) => ["at_risk", "off_track"].includes(p.status) || tasks.some((t) => t.project === p.id && t.due && t.due < today)), (p) => `• ${p.name}`),
  ].filter(Boolean).join("\n");
  return `Good morning ${String(name || "").split(" ")[0]},\n\n${body || "Nothing is overdue, due today or waiting on you. A clear day."}\n\nOpen Projects & Team: ${hubUrl}`;
}
async function digestTick(pool, { force } = {}) {
  const now = nyNow();
  if (!force && (["Sat", "Sun"].includes(now.weekday) || now.hour < 7)) return { digest: "not due" };
  const set = (await pool.query("SELECT data FROM hub_docs WHERE path = 'config' AND id = 'settings' AND NOT deleted")).rows[0];
  if (!(set && set.data && set.data.hubEmail)) return { digest: "email off" };
  const sentRow = (await pool.query("SELECT value FROM app_settings WHERE key = 'hub_digest_sent'")).rows[0];
  const sent = sentRow ? JSON.parse(sentRow.value || "{}") : {};
  if (!force && sent.date === now.date) return { digest: "already sent", count: (sent.to || []).length };
  const rows = (await pool.query("SELECT path, id, data FROM hub_docs WHERE path IN ('tasks', 'projects', 'team') AND NOT deleted")).rows;
  const docs = { tasks: {}, projects: {}, team: {} };
  for (const r of rows) docs[r.path][r.id] = r.data || {};
  const users = (await pool.query("SELECT id, email, name, role FROM app_users WHERE NOT disabled")).rows;
  for (const u of users) docs.team["u" + u.id] = Object.assign({}, docs.team["u" + u.id], { lead: u.role === "owner" });
  const hubUrl = (process.env.PUBLIC_URL || "https://frankly-inspired-os.onrender.com/").replace(/\/?$/, "/") + "hub/";
  const out = [];
  for (const u of users) {
    const x = docs.team["u" + u.id] || {};
    if (!x.digest || !u.email) continue;
    try { await require("./gmail").send(pool, { to: u.email, subject: `Your Projects & Team digest · ${fmt(now.date)}`, body: digestText("u" + u.id, u.name || u.email, docs, now.date, hubUrl) }); out.push(u.email); }
    catch (e) { out.push(u.email + " (failed: " + String(e.message || e).slice(0, 80) + ")"); }
  }
  await pool.query("INSERT INTO app_settings (key, value) VALUES ('hub_digest_sent', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [JSON.stringify({ date: now.date, to: out })]);
  return { digest: "sent", count: out.length, to: out };
}

module.exports = { mount, digestTick, digestText, canRead, canWrite };
