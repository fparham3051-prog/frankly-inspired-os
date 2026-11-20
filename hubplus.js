// Projects & Team, second layer: what connects the hub to the outside and keeps it healthy.
//
//   Phone notifications   Web Push to each person's devices when something lands in their Inbox
//   Email replies         an emailed answer to a mention comes back into the thread
//   Search                every task, project, goal and message, not just what's on screen
//   API and webhooks      personal tokens for /api/v1, and outgoing webhooks (Slack, Zapier, anything)
//   Monitoring            errors from browsers and the server, a health check, and an email alert
//
// Mounted after hub.js, which exposes applyOp (every write goes through the same rules,
// history and merge) and tells this module about every saved change.

const crypto = require("crypto");
const express = require("express");
const hub = require("./hub");
const { ORG } = require("./accounts");

const ORGINFO = require("./org");
const PUBLIC = () => ORGINFO.publicUrl();
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const clip = (s, n) => String(s == null ? "" : s).slice(0, n);
let poolRef = null;

// ---------- monitoring ----------
async function recordError(source, message, detail, url, uid) {
  if (!poolRef) return;
  try { await poolRef.query("INSERT INTO app_errors (source, message, detail, url, uid) VALUES ($1, $2, $3, $4, $5)", [clip(source, 40), clip(message, 500), clip(detail, 4000), clip(url, 300), clip(uid, 40)]); }
  catch (e) { /* never let error logging cause errors */ }
}
async function getS(pool, k) { const r = (await pool.query("SELECT value FROM app_settings WHERE key = $1", [k]).catch(() => ({ rows: [] }))).rows[0]; return r ? r.value : ""; }
async function setS(pool, k, v) { await pool.query("INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [k, String(v)]); }
async function ownerEmail(pool) {
  const r = await pool.query("SELECT email FROM app_users WHERE role = 'owner' AND NOT disabled ORDER BY id LIMIT 1").catch(() => ({ rows: [] }));
  return (r.rows[0] && r.rows[0].email) || (ORG.org && ORG.org.email) || "";
}
// Five or more errors in an hour: one email to the owner, at most every six hours.
async function alertTick(pool) {
  await pool.query("DELETE FROM app_errors WHERE at < now() - interval '30 days'").catch(() => {});
  const n = (await pool.query("SELECT count(*)::int AS n FROM app_errors WHERE at > now() - interval '1 hour' AND source <> 'csp'")).rows[0].n;
  if (n < 5) return { errors: n, alerted: false };
  const last = Number(await getS(pool, "errors_alerted_at")) || 0;
  if (Date.now() - last < 6 * 3600e3) return { errors: n, alerted: false };
  const to = await ownerEmail(pool); if (!to) return { errors: n, alerted: false };
  const top = (await pool.query("SELECT source, message, count(*)::int AS n FROM app_errors WHERE at > now() - interval '1 hour' AND source <> 'csp' GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 5")).rows;
  try {
    await require("./gmail").send(pool, { to, subject: `${ORGINFO.info().shortName}: ${n} errors in the last hour`, body: `The operations app logged ${n} errors in the last hour.\n\n${top.map((x) => `${x.n} x ${x.source}: ${x.message}`).join("\n")}\n\nSee them in Projects & Team, Setup, Connections: ${PUBLIC()}hub/#setup\n` });
    await setS(pool, "errors_alerted_at", Date.now());
    return { errors: n, alerted: true };
  } catch (e) { return { errors: n, alerted: false, why: e.message }; }
}

// ---------- phone notifications (Web Push) ----------
let vapidCache = null;
async function vapid(pool) {
  if (vapidCache) return vapidCache;
  let v = null; try { v = JSON.parse(await getS(pool, "hub_vapid") || "null"); } catch (e) { v = null; }
  if (!v || !v.publicKey) { v = require("web-push").generateVAPIDKeys(); await setS(pool, "hub_vapid", JSON.stringify(v)); }
  vapidCache = v; return v;
}
async function pushTo(pool, uid, payload) {
  const subs = (await pool.query("SELECT endpoint, sub FROM hub_push WHERE uid = $1", [uid])).rows;
  if (!subs.length) return 0;
  const wp = require("web-push"), v = await vapid(pool);
  const contact = "mailto:" + ((await ownerEmail(pool)) || ORGINFO.info().email || "admin@example.org");
  let sent = 0;
  for (const s of subs) {
    try { await wp.sendNotification(s.sub, JSON.stringify(payload), { TTL: 6 * 3600, vapidDetails: { subject: contact, publicKey: v.publicKey, privateKey: v.privateKey } }); sent++; }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) await pool.query("DELETE FROM hub_push WHERE endpoint = $1", [s.endpoint]).catch(() => {}); }
  }
  return sent;
}
function notifUrl(n) {
  const on = String(n.on || ""), i = on.indexOf(":"), k = on.slice(0, i), id = on.slice(i + 1);
  if (k === "task" || (!on && n.task)) return "/hub/#task/" + encodeURIComponent(k === "task" ? id : n.task);
  if (k === "project") return "/hub/#project/" + encodeURIComponent(id);
  return "/hub/#inbox";
}

// ---------- email replies ----------
const systemMe = { uid: "fios", userId: 0, role: "owner", owner: true };
async function mailTick(pool) {
  const G = require("./gmail");
  const accts = await G.accounts(pool);
  if (!accts.length) return { threads: 0, posted: 0 };
  const ours = new Set(accts.flatMap((a) => [a.email].concat((a.sendAs || []).map((x) => x.email))).map((e) => String(e).toLowerCase()));
  const apply = poolRef && poolRef._hubApply;
  if (!apply) return { threads: 0, posted: 0 };
  const rows = (await pool.query("SELECT * FROM hub_mail WHERE sent_at > now() - interval '14 days' ORDER BY sent_at DESC LIMIT 40")).rows;
  const users = (await pool.query("SELECT id, email, name FROM app_users WHERE NOT disabled")).rows;
  let posted = 0;
  for (const row of rows) {
    const acct = row.account || accts[0].email;
    let t; try { t = await G.gapi(pool, acct, `/gmail/v1/users/me/threads/${encodeURIComponent(row.thread_id)}?format=full`); } catch (e) { continue; }
    const seen = new Set(Array.isArray(row.seen) ? row.seen : []);
    const sentMs = new Date(row.sent_at).getTime();
    let changed = false;
    for (const m of t.messages || []) {
      if (seen.has(m.id)) continue;
      seen.add(m.id); changed = true;
      const from = (((m.payload || {}).headers || []).find((h) => /^from$/i.test(h.name)) || {}).value || "";
      const addr = ((/<([^>]+)>/.exec(from) || [])[1] || from).trim().toLowerCase();
      if (!addr || ours.has(addr) || Number(m.internalDate) < sentMs - 60000) continue;
      const text = G.bodyText(m.payload) || m.snippet || "";
      if (!text.trim()) continue;
      const u = users.find((x) => String(x.email || "").toLowerCase() === addr);
      const name = (from.replace(/<.*>/, "").replace(/"/g, "").trim()) || addr;
      const at = new Date(Number(m.internalDate) || Date.now()).toISOString();
      const me = u ? { uid: "u" + u.id, userId: u.id, role: "staff", owner: false } : { uid: "email", userId: 0, role: "staff", owner: false };
      await apply({ path: "msgs", id: "em-" + String(m.id).replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 100), data: { on: row.on_ref, parent: row.parent || "", text: clip(text, 8000), at, via: "email", guest: u ? "" : clip(name, 80), mentions: [] } }, me);
      if (row.by_user && row.by_user !== me.uid) {
        await apply({ path: "notifs", id: "nm-" + String(m.id).replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 100), data: { to: row.by_user, text: `${u ? (u.name || u.email).split(" ")[0] : name} replied by email: ${clip(text.replace(/\s+/g, " "), 120)}`, on: row.on_ref, task: row.on_ref.startsWith("task:") ? row.on_ref.slice(5) : "", eng: "", by: me.uid, at, read: false } }, systemMe);
      }
      posted++;
    }
    if (changed) await pool.query("UPDATE hub_mail SET seen = $1 WHERE thread_id = $2", [JSON.stringify([...seen].slice(-200)), row.thread_id]);
  }
  return { threads: rows.length, posted };
}

// ---------- webhooks ----------
function eventFor({ path, before, after, action }) {
  if (path === "tasks") {
    if (action === "delete") return "task.deleted";
    if (!before) return "task.created";
    if (after && after.status === "done" && (!before || before.status !== "done")) return "task.completed";
    return "task.updated";
  }
  if (path === "msgs") {
    if (after && after.decision && !(before && before.decision)) return "decision.recorded";
    if (!before && after) return "message.created";
    return null;
  }
  if (path === "projects") return action === "delete" ? "project.deleted" : !before ? "project.created" : "project.updated";
  if (path === "goals") return action === "delete" ? null : "goal.updated";
  return null;
}
const EVENT_WORD = { "task.created": "New task", "task.completed": "Done", "task.updated": "Updated", "task.deleted": "Deleted", "message.created": "New message", "decision.recorded": "Decision", "project.created": "New project", "project.updated": "Project updated", "project.deleted": "Project deleted", "goal.updated": "Goal updated" };
async function deliver(pool, hook, event, body) {
  const json = JSON.stringify(body);
  const slack = /^https:\/\/hooks\.slack\.com\//.test(hook.url);
  const payload = slack ? JSON.stringify({ text: body.text }) : json;
  let status = "";
  try {
    const r = await fetch(hook.url, { method: "POST", headers: Object.assign({ "Content-Type": "application/json", "User-Agent": "FIOS-Webhooks/1" }, slack ? {} : { "X-FIOS-Event": event, "X-FIOS-Signature": "sha256=" + crypto.createHmac("sha256", hook.secret).update(payload).digest("hex") }), body: payload, signal: AbortSignal.timeout(6000) });
    status = String(r.status);
  } catch (e) { status = "error: " + clip(e.message, 80); }
  await pool.query("UPDATE hub_webhooks SET last_status = $1, last_at = now() WHERE id = $2", [status, hook.id]).catch(() => {});
  return status;
}
let hookCache = { at: 0, list: [] };
async function activeHooks(pool) {
  if (Date.now() - hookCache.at > 30000) hookCache = { at: Date.now(), list: (await pool.query("SELECT * FROM hub_webhooks WHERE active")).rows };
  return hookCache.list;
}
async function fireWebhooks(pool, change) {
  const event = eventFor(change); if (!event) return;
  const hooks = (await activeHooks(pool)).filter((h) => !h.events || !h.events.length || h.events.includes(event) || h.events.includes(event.split(".")[0] + ".*"));
  if (!hooks.length) return;
  const d = change.after || change.before || {};
  const name = d.title || d.name || clip(d.text, 140) || change.id;
  const link = change.path === "tasks" ? `${PUBLIC()}hub/#task/${encodeURIComponent(change.id)}` : change.path === "projects" ? `${PUBLIC()}hub/#project/${encodeURIComponent(change.id)}` : `${PUBLIC()}hub/#inbox`;
  const body = { event, at: new Date().toISOString(), by: change.me ? change.me.uid : "", id: change.id, data: change.after || null, before: change.action === "update" ? change.before : undefined, link, text: `${EVENT_WORD[event] || event}: ${name} <${link}|Open>` };
  for (const h of hooks) deliver(pool, h, event, body);
}

// ---------- API tokens ----------
async function tokenUser(pool, header) {
  const m = /^Bearer\s+(fios_[A-Za-z0-9_-]{20,})$/.exec(String(header || ""));
  if (!m) return null;
  const r = (await pool.query("SELECT id, uid FROM api_tokens WHERE hash = $1 AND NOT revoked", [sha(m[1])])).rows[0];
  if (!r) return null;
  pool.query("UPDATE api_tokens SET last_used_at = now() WHERE id = $1", [r.id]).catch(() => {});
  const userId = Number(String(r.uid).slice(1)) || 0;
  const u = userId ? (await pool.query("SELECT role, disabled FROM app_users WHERE id = $1", [userId])).rows[0] : { role: "owner", disabled: false };
  if (!u || u.disabled || u.role === "board") return null;
  return { uid: r.uid, userId, role: u.role, owner: u.role === "owner" };
}

// ---------- the morning: everything that needs Franklin today, from every system ----------
const q = async (pool, sql, args) => (await pool.query(sql, args || []).catch(() => ({ rows: [] }))).rows;
async function buildMorning(pool, jobRegistry) {
  const nyNow = new Date();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(nyNow);
  const in7 = new Date(Date.parse(today + "T12:00:00Z") + 7 * 864e5).toISOString().slice(0, 10);
  const owner = (await q(pool, "SELECT id FROM app_users WHERE role = 'owner' AND NOT disabled ORDER BY id LIMIT 1"))[0];
  const uid = "u" + (owner ? owner.id : 0);
  const out = { date: today, weekday: new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long" }).format(nyNow), link: PUBLIC() };
  // Calendar: today's events from the calendar the morning task posts each day.
  out.calendar = (await q(pool, "SELECT title, starts_at, ends_at, location, status_label, url FROM week_events ORDER BY starts_at")).filter((e) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(e.starts_at)) === today)
    .map((e) => ({ title: e.title, starts: e.starts_at, ends: e.ends_at || "", location: e.location || "", flag: e.status_label || "", url: e.url || "" }));
  // Projects & Team: your tasks, Inbox, projects that need attention.
  try { const d = await hub.dayFor(pool, uid); out.projects = { tasks: d.items, open: d.open, risky: d.risky, inboxUnread: d.inbox.unread, inbox: d.inbox.top }; } catch (e) { out.projects = { error: e.message }; }
  // Pipeline next steps due this week or overdue.
  out.nextSteps = (await q(pool, "SELECT id, org, name, stage, next_step, next_step_date FROM pipeline WHERE archived_at IS NULL AND COALESCE(next_step_date, '') <> '' AND next_step_date <= $1 AND stage NOT IN ('graduated', 'referred', 'lost') ORDER BY next_step_date LIMIT 10", [in7]))
    .map((p) => ({ who: p.org || p.name, step: p.next_step, due: p.next_step_date, overdue: p.next_step_date < today }));
  // Money: sent and unpaid.
  const inv = await q(pool, "SELECT i.amount, i.due_date, p.org, p.name FROM invoices i JOIN pipeline p ON p.id = i.pipeline_id WHERE i.archived_at IS NULL AND i.status = 'sent' ORDER BY i.due_date");
  out.money = { outstanding: inv.reduce((t, i) => t + (Number(i.amount) || 0), 0), overdue: inv.filter((i) => i.due_date && i.due_date < today).map((i) => ({ who: i.org || i.name, amount: Number(i.amount) || 0, due: i.due_date })), dueThisWeek: inv.filter((i) => i.due_date >= today && i.due_date <= in7).map((i) => ({ who: i.org || i.name, amount: Number(i.amount) || 0, due: i.due_date })) };
  // InstitutionalOS clients: what each 90-Day Improvement Plan needs.
  const clients = [];
  for (const d of await q(pool, "SELECT org, name, ios_plan, ios_record FROM pipeline WHERE archived_at IS NULL AND ios_org_id IS NOT NULL")) {
    let plan = null, rec = {}; try { plan = JSON.parse(d.ios_plan || "null"); } catch (e) { /* none */ } try { rec = JSON.parse(d.ios_record || "{}") || {}; } catch (e) { /* none */ }
    const who = d.org || d.name;
    if (!plan || !plan.startDate) { if (rec.verifiedConstraint) clients.push({ who, need: "Write the 90-Day Improvement Plan" }); continue; }
    if (plan.active === false) continue;
    if (plan.review90On && plan.review90On <= today && !plan.review90Done) clients.push({ who, need: "90-day review due" });
    if (plan.actionsBlocked) clients.push({ who, need: `${plan.actionsBlocked} action(s) blocked` });
    if (plan.weeklyReviewDue) clients.push({ who, need: "Weekly check-in due" });
  }
  out.clients = clients;
  // New leads since yesterday morning, and everyone waiting.
  const since = new Date(Date.now() - 26 * 3600e3).toISOString();
  out.leads = { new: (await q(pool, "SELECT name, org, source, created_at FROM prospects WHERE archived_at IS NULL AND created_at >= $1 ORDER BY created_at DESC LIMIT 10", [since])).map((p) => ({ who: [p.name, p.org].filter(Boolean).join(", "), source: p.source })),
    waiting: Number(((await q(pool, "SELECT count(*)::int AS n FROM prospects WHERE archived_at IS NULL AND status IN ('new', 'researching')"))[0] || {}).n || 0) };
  // Weekly Meeting: open issues and off-track priorities.
  const issues = await q(pool, "SELECT title, created_at FROM issues WHERE archived_at IS NULL AND status <> 'solved' ORDER BY created_at");
  out.issues = { open: issues.length, oldest: issues[0] ? issues[0].title : "" };
  out.offTrack = (await q(pool, "SELECT title FROM rocks WHERE archived_at IS NULL AND status = 'off-track'")).map((r) => r.title);
  // Messages drafted for approval (checklists and AI first replies).
  out.drafts = Number(((await q(pool, "SELECT count(*)::int AS n FROM proc_outbox o LEFT JOIN proc_runs r ON r.id = o.run_id WHERE o.status = 'draft' AND (r.id IS NULL OR r.archived_at IS NULL)"))[0] || {}).n || 0);
  // Systems: scheduled jobs that failed or went quiet, errors, and the last cross-system check.
  const last = await q(pool, "SELECT DISTINCT ON (job_key) job_key, job_label, status, message, ran_at FROM automation_runs ORDER BY job_key, ran_at DESC");
  const byKey = Object.fromEntries(last.map((r) => [r.job_key, r]));
  const problems = [];
  for (const j of jobRegistry || []) {
    const r = byKey[j.key];
    if (r && r.status === "error") problems.push(`${j.label}: ${String(r.message || "error").slice(0, 160)}`);
    else if (!r || Date.now() - Date.parse(r.ran_at) > j.cadenceHours * 3600e3) problems.push(`${j.label} hasn't reported ${r ? "since " + String(r.ran_at).slice(0, 10) : "yet"}`);
  }
  const errs = Number(((await q(pool, "SELECT count(*)::int AS n FROM app_errors WHERE at > now() - interval '1 day' AND source <> 'csp'"))[0] || {}).n || 0);
  const rec = byKey["systems-reconcile"];
  out.systems = { ok: !problems.length && !errs && !(rec && rec.status === "error"), problems, errorsLastDay: errs, reconcile: rec ? { status: rec.status, message: rec.message, at: rec.ran_at } : null };
  return out;
}

function mount(app, { pool, requireAuth, verifySession, COOKIE_NAME, requireAdminScope, jobRegistry }) {
  poolRef = pool;
  const H = () => app.locals.hub;
  pool._hubApply = (op, me) => H().applyOp(op, me);
  const sessionMe = (req) => H().meFor(req.session);
  const ownerOnly = async (req, res) => { const me = await sessionMe(req); if (!me.owner) { res.status(403).json({ error: "Only the owner can change connections." }); return null; } return me; };

  // Every saved change: phone notifications for new Inbox items, and webhooks.
  hub.onApplied(async (c) => {
    if (c.path === "notifs" && c.action === "create" && c.after && c.after.to) {
      await pushTo(pool, c.after.to, { title: ORGINFO.info().shortName, body: clip(c.after.text, 180), url: notifUrl(c.after), tag: "n-" + c.id });
    }
    if (["tasks", "msgs", "projects", "goals"].includes(c.path)) await fireWebhooks(pool, c);
  });

  // ---------- the morning ----------
  app.get("/api/admin/morning", requireAdminScope("status"), async (req, res) => {
    try { res.json(Object.assign({ ok: true }, await buildMorning(pool, jobRegistry))); } catch (e) { console.error("morning", e); res.status(500).json({ error: "Couldn't build the morning summary." }); }
  });
  app.get("/api/morning", requireAuth, async (req, res) => {
    try { res.json(Object.assign({ ok: true }, await buildMorning(pool, jobRegistry))); } catch (e) { console.error("morning", e); res.status(500).json({ error: "Couldn't build the morning summary." }); }
  });

  // ---------- health and errors ----------
  app.get("/api/health", async (req, res) => {
    try { await pool.query("SELECT 1"); res.json({ ok: true, db: true, at: new Date().toISOString(), up: Math.round(process.uptime()) }); }
    catch (e) { res.status(503).json({ ok: false, db: false }); }
  });
  const errLog = new Map();
  const tooMany = (ip) => { const now = Date.now(), l = (errLog.get(ip) || []).filter((t) => now - t < 3600e3); l.push(now); errLog.set(ip, l); return l.length > 40; };
  app.post("/api/client-error", express.json({ limit: "32kb" }), async (req, res) => {
    if (tooMany(req.ip)) return res.status(429).end();
    const s = verifySession(req.cookies[COOKIE_NAME]);
    const b = req.body || {};
    await recordError(clip(b.source || "browser", 40), b.message, b.detail, b.url, s ? "u" + (s.userId || 0) : "");
    res.status(204).end();
  });
  app.post("/api/csp-report", express.json({ type: ["application/csp-report", "application/reports+json", "application/json"], limit: "32kb" }), async (req, res) => {
    if (tooMany(req.ip)) return res.status(429).end();
    const r = (req.body && (req.body["csp-report"] || (Array.isArray(req.body) && req.body[0] && req.body[0].body))) || {};
    await recordError("csp", `${r["violated-directive"] || r.effectiveDirective || "policy"} blocked ${r["blocked-uri"] || r.blockedURL || "inline"}`, JSON.stringify(r).slice(0, 2000), r["document-uri"] || r.documentURL || "", "");
    res.status(204).end();
  });
  app.get("/api/hub/errors", requireAuth, async (req, res) => {
    const me = await ownerOnly(req, res); if (!me) return;
    const [list, counts] = await Promise.all([
      pool.query("SELECT id, at, source, message, url FROM app_errors ORDER BY id DESC LIMIT 60"),
      pool.query("SELECT count(*) FILTER (WHERE at > now() - interval '1 day' AND source <> 'csp')::int AS day, count(*) FILTER (WHERE at > now() - interval '7 days' AND source <> 'csp')::int AS week, count(*) FILTER (WHERE at > now() - interval '7 days' AND source = 'csp')::int AS csp FROM app_errors")]);
    res.json({ ok: true, items: list.rows, counts: counts.rows[0] });
  });

  // ---------- phone notifications ----------
  app.get("/api/hub/push/key", requireAuth, async (req, res) => {
    const me = await sessionMe(req);
    const n = (await pool.query("SELECT count(*)::int AS n FROM hub_push WHERE uid = $1", [me.uid])).rows[0].n;
    res.json({ ok: true, key: (await vapid(pool)).publicKey, devices: n });
  });
  app.post("/api/hub/push/subscribe", requireAuth, async (req, res) => {
    const me = await sessionMe(req), sub = req.body && req.body.sub;
    if (!sub || !/^https:\/\//.test(String(sub.endpoint || "")) || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return res.status(400).json({ error: "That isn't a notification subscription." });
    await pool.query("INSERT INTO hub_push (endpoint, uid, sub, ua) VALUES ($1, $2, $3, $4) ON CONFLICT (endpoint) DO UPDATE SET uid = EXCLUDED.uid, sub = EXCLUDED.sub",
      [clip(sub.endpoint, 900), me.uid, { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, clip(req.get("user-agent"), 200)]);
    res.json({ ok: true });
  });
  app.post("/api/hub/push/unsubscribe", requireAuth, async (req, res) => {
    const me = await sessionMe(req);
    await pool.query("DELETE FROM hub_push WHERE endpoint = $1 AND uid = $2", [String((req.body && req.body.endpoint) || ""), me.uid]);
    res.json({ ok: true });
  });
  app.post("/api/hub/push/test", requireAuth, async (req, res) => {
    const me = await sessionMe(req);
    const n = await pushTo(pool, me.uid, { title: ORGINFO.info().shortName, body: "Notifications are on. Mentions, replies and approvals will reach this device.", url: "/hub/#inbox", tag: "test" });
    res.json({ ok: true, sent: n });
  });

  // ---------- search ----------
  app.get("/api/hub/search", requireAuth, async (req, res) => {
    try {
      const me = await sessionMe(req);
      const q = clip(String(req.query.q || "").trim(), 80);
      if (q.length < 2) return res.json({ ok: true, items: [] });
      const like = "%" + q.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
      const r = await pool.query(`SELECT path, id, data FROM hub_docs WHERE NOT deleted AND path IN ('tasks', 'projects', 'msgs', 'goals') AND data::text ILIKE $1 ORDER BY t DESC LIMIT 80`, [like]);
      const low = q.toLowerCase();
      const snip = (s) => { s = String(s || "").replace(/\s+/g, " "); const i = s.toLowerCase().indexOf(low); return i < 0 ? s.slice(0, 140) : (i > 50 ? "…" : "") + s.slice(Math.max(0, i - 50), i + 90) + (i + 90 < s.length ? "…" : ""); };
      const items = r.rows.filter((x) => hub.canRead(x.path, x.id, me) && x.data && !x.data.cancelled && !(x.path === "msgs" && x.data.deleted)).map((x) => {
        const d = x.data;
        if (x.path === "msgs") return { kind: "message", id: x.id, on: d.on, title: snip(d.text), by: d.by, at: d.at };
        if (x.path === "tasks") return { kind: "task", id: x.id, title: d.title, status: d.status, due: d.due, match: (d.title || "").toLowerCase().includes(low) ? "" : snip(JSON.stringify(Object.assign({}, d, { history: undefined, timeLog: undefined }))) };
        if (x.path === "projects") return { kind: "project", id: x.id, title: d.name };
        return { kind: "goal", id: x.id, title: d.title || d.name };
      });
      res.json({ ok: true, items: items.slice(0, 30) });
    } catch (e) { console.error("hub search", e); res.status(500).json({ error: "Search isn't working right now." }); }
  });

  // ---------- tokens and webhooks (managed from Setup) ----------
  app.get("/api/hub/tokens", requireAuth, async (req, res) => {
    const me = await sessionMe(req); if (me.role === "board") return res.status(403).end();
    const r = await pool.query("SELECT id, uid, name, created_at, last_used_at FROM api_tokens WHERE NOT revoked AND ($1 OR uid = $2) ORDER BY created_at DESC", [me.owner, me.uid]);
    res.json({ ok: true, items: r.rows });
  });
  app.post("/api/hub/tokens", requireAuth, async (req, res) => {
    const me = await sessionMe(req); if (me.role === "board") return res.status(403).end();
    const token = "fios_" + crypto.randomBytes(24).toString("base64url"), id = crypto.randomUUID();
    await pool.query("INSERT INTO api_tokens (id, uid, name, hash) VALUES ($1, $2, $3, $4)", [id, me.uid, clip((req.body && req.body.name) || "API token", 80), sha(token)]);
    res.json({ ok: true, id, token });
  });
  app.delete("/api/hub/tokens/:id", requireAuth, async (req, res) => {
    const me = await sessionMe(req);
    await pool.query("UPDATE api_tokens SET revoked = true WHERE id = $1 AND ($2 OR uid = $3)", [req.params.id, me.owner, me.uid]);
    res.json({ ok: true });
  });
  app.get("/api/hub/webhooks", requireAuth, async (req, res) => {
    const me = await ownerOnly(req, res); if (!me) return;
    res.json({ ok: true, items: (await pool.query("SELECT id, url, events, active, created_at, last_status, last_at FROM hub_webhooks ORDER BY created_at")).rows, events: Object.keys(EVENT_WORD) });
  });
  app.post("/api/hub/webhooks", requireAuth, async (req, res) => {
    const me = await ownerOnly(req, res); if (!me) return;
    const url = String((req.body && req.body.url) || "").trim();
    const testOk = process.env.HUB_WEBHOOK_ALLOW_HTTP === "1" && /^http:\/\/localhost:\d+\//.test(url);
    if (!testOk && (!/^https:\/\/[^\s/]+\.[^\s]+$/.test(url) || /^https:\/\/(localhost|127\.|10\.|192\.168\.|169\.254\.)/i.test(url))) return res.status(400).json({ error: "Use a public https address." });
    const events = [].concat((req.body && req.body.events) || []).map(String).filter((e) => EVENT_WORD[e] || /^[a-z]+\.\*$/.test(e)).slice(0, 20);
    const id = crypto.randomUUID(), secret = crypto.randomBytes(24).toString("hex");
    await pool.query("INSERT INTO hub_webhooks (id, url, events, secret) VALUES ($1, $2, $3, $4)", [id, clip(url, 500), events, secret]);
    hookCache.at = 0;
    res.json({ ok: true, id, secret });
  });
  app.delete("/api/hub/webhooks/:id", requireAuth, async (req, res) => {
    const me = await ownerOnly(req, res); if (!me) return;
    await pool.query("DELETE FROM hub_webhooks WHERE id = $1", [req.params.id]); hookCache.at = 0;
    res.json({ ok: true });
  });
  app.post("/api/hub/webhooks/:id/test", requireAuth, async (req, res) => {
    const me = await ownerOnly(req, res); if (!me) return;
    const h = (await pool.query("SELECT * FROM hub_webhooks WHERE id = $1", [req.params.id])).rows[0];
    if (!h) return res.status(404).json({ error: "No such webhook." });
    const status = await deliver(pool, h, "test", { event: "test", at: new Date().toISOString(), text: `Test from ${ORGINFO.info().shortName} Projects & Team. Webhooks are working.`, link: PUBLIC() + "hub/" });
    res.json({ ok: true, status });
  });

  // ---------- the API (/api/v1, Bearer token) ----------
  const api = express.Router();
  api.use(express.json({ limit: "256kb" }));
  api.use(async (req, res, next) => {
    try { const me = await tokenUser(pool, req.get("authorization")); if (!me) return res.status(401).json({ error: "Send a valid token: Authorization: Bearer fios_…" }); req.me = me; next(); }
    catch (e) { next(e); }
  });
  const docRow = (x) => Object.assign({ id: x.id }, x.data || {}, { updated: Number(x.t) });
  const getDoc = async (p, id) => (await pool.query("SELECT path, id, data, t FROM hub_docs WHERE path = $1 AND id = $2 AND NOT deleted", [p, id])).rows[0];
  api.get("/me", (req, res) => res.json({ uid: req.me.uid, role: req.me.role }));
  api.get("/tasks", async (req, res) => {
    const since = Number(req.query.updated_since) || 0;
    const r = await pool.query("SELECT id, data, t FROM hub_docs WHERE path = 'tasks' AND NOT deleted AND t > $1 ORDER BY t DESC LIMIT 500", [since]);
    let items = r.rows.map(docRow).filter((t) => !t.cancelled);
    if (req.query.project) items = items.filter((t) => t.project === req.query.project);
    if (req.query.status) items = items.filter((t) => t.status === req.query.status);
    if (req.query.owner) items = items.filter((t) => t.owner === req.query.owner);
    res.json({ items });
  });
  api.get("/tasks/:id", async (req, res) => { const x = await getDoc("tasks", req.params.id); if (!x) return res.status(404).json({ error: "No such task." }); res.json(docRow(x)); });
  const TASK_FIELDS = ["title", "due", "start", "owner", "status", "section", "project", "priority", "notes", "est"];
  const STATUSES = ["unassigned", "assigned", "seen", "in_progress", "blocked", "review", "done"];
  api.post("/tasks", async (req, res) => {
    const b = req.body || {};
    if (!String(b.title || "").trim()) return res.status(400).json({ error: "A task needs a title." });
    if (b.status && !STATUSES.includes(b.status)) return res.status(400).json({ error: "Unknown status." });
    const id = "api" + crypto.randomBytes(6).toString("hex"), now = new Date().toISOString();
    const data = { title: clip(b.title, 300), owner: clip(b.owner, 40), assignedBy: b.owner ? req.me.uid : "", due: clip(b.due, 10) || now.slice(0, 10), start: clip(b.start, 10), status: b.status || (b.owner ? "assigned" : "unassigned"), project: clip(b.project, 120), section: clip(b.section, 60), eng: "", lane: "franklin", src: "api", est: Number(b.est) || 0, timeLog: [], history: [{ at: now, by: req.me.uid, from: "", to: b.status || (b.owner ? "assigned" : "unassigned"), note: "Created through the API" }], created: now, createdBy: req.me.uid, notes: clip(b.notes, 4000) };
    if (data.project && !data.section) { const p = await getDoc("projects", data.project); if (p && p.data && p.data.sections && p.data.sections[0]) data.section = p.data.sections[0].id; }
    const r = await H().applyOp({ path: "tasks", id, data }, req.me);
    res.status(201).json(Object.assign({ id }, data, { updated: r.t }));
  });
  api.patch("/tasks/:id", async (req, res) => {
    const x = await getDoc("tasks", req.params.id); if (!x) return res.status(404).json({ error: "No such task." });
    const b = req.body || {}, changed = TASK_FIELDS.filter((k) => k in b);
    if (!changed.length) return res.status(400).json({ error: "Send one or more of: " + TASK_FIELDS.join(", ") });
    if (b.status && !STATUSES.includes(b.status)) return res.status(400).json({ error: "Unknown status." });
    const data = Object.assign({}, x.data);
    for (const k of changed) data[k] = k === "est" ? Number(b[k]) || 0 : clip(b[k], k === "notes" ? 4000 : 300);
    if (b.status && b.status !== x.data.status) {
      data.history = (x.data.history || []).concat([{ at: new Date().toISOString(), by: req.me.uid, from: x.data.status || "", to: b.status, note: "Through the API" }]);
      changed.push("history");
      if (b.status === "done") { data.done = true; data.doneAt = new Date().toISOString(); changed.push("done", "doneAt"); }
    }
    const r = await H().applyOp({ path: "tasks", id: x.id, data, base: Number(x.t), changed }, req.me);
    res.json(Object.assign({ id: x.id }, data, { updated: r.t }));
  });
  api.get("/projects", async (req, res) => {
    const r = await pool.query("SELECT id, data, t FROM hub_docs WHERE path = 'projects' AND NOT deleted ORDER BY t DESC LIMIT 300");
    res.json({ items: r.rows.map(docRow).filter((p) => !p.archived) });
  });
  api.get("/messages", async (req, res) => {
    const on = String(req.query.on || "");
    if (!/^(task|project|client):[A-Za-z0-9_.-]{1,120}$/.test(on)) return res.status(400).json({ error: "Say which conversation: ?on=task:<id>, project:<id> or client:<id>" });
    const r = await pool.query("SELECT id, data, t FROM hub_docs WHERE path = 'msgs' AND NOT deleted AND data->>'on' = $1 ORDER BY data->>'at' LIMIT 500", [on]);
    res.json({ items: r.rows.map(docRow).filter((m) => !m.deleted) });
  });
  api.post("/messages", async (req, res) => {
    const b = req.body || {}, on = String(b.on || ""), text = String(b.text || "").trim();
    if (!/^(task|project|client):[A-Za-z0-9_.-]{1,120}$/.test(on) || !text) return res.status(400).json({ error: "Send on (task:<id>, project:<id> or client:<id>) and text." });
    const id = "api" + crypto.randomBytes(6).toString("hex");
    const data = { on, parent: clip(b.parent, 120), text: clip(text, 8000), at: new Date().toISOString(), mentions: [], via: "api" };
    const r = await H().applyOp({ path: "msgs", id, data }, req.me);
    res.status(201).json(Object.assign({ id, by: req.me.uid }, data, { updated: r.t }));
  });
  app.use("/api/v1", api);

  // While the app is awake: emailed replies and the error alert every three minutes.
  if (!process.env.HUB_NO_TIMERS) {
    const tick = async () => { try { await mailTick(pool); } catch (e) { console.error("hub mail tick", e.message); } try { await alertTick(pool); } catch (e) { /* next time */ } };
    setInterval(tick, 3 * 60 * 1000).unref();
  }
}

module.exports = { mount, mailTick, alertTick, recordError, pushTo, eventFor, buildMorning };
