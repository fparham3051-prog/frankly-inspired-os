"use strict";
// Client workspace and outcomes report.
//
// Each client organization (a Pipeline deal) can get private links to its own
// workspace: no account or password, just a long random link Franklin sends
// and can revoke at any time. The workspace shows, for that one client only:
//
//   the 90-Day Improvement Plan's progress (from InstitutionalOS)
//   the projects and tasks Franklin shares (projects linked to the deal;
//     any project can be hidden from the client)
//   the conversation with Franklin's team: on = "with:<deal id>" in the hub.
//     The team's own "Discussion about this client" (client:<id>) is never shown.
//   decisions recorded in that conversation
//   the outcomes report: scores at the Diagnostic vs. today, plan actions done,
//     sessions delivered, hours of support, decisions made
//
//   owner/staff (signed in):
//     GET    /api/clients/:deal/access          links for a client
//     POST   /api/clients/:deal/access          {name, email} -> {url} (shown once)
//     DELETE /api/clients/access/:id            revoke
//     GET    /api/clients/:deal/workspace       what the client sees (preview)
//     GET    /client-preview/:deal              the same page, as a preview
//   the client (the link is the key):
//     GET    /client/:token                     the page
//     GET    /api/client/:token                 the workspace
//     POST   /api/client/:token/message         {text, parent}
const crypto = require("crypto");
const path = require("path");
const { ORG } = require("./accounts");

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const clip = (s, n) => String(s == null ? "" : s).slice(0, n);
const json = (s, d) => { try { const v = JSON.parse(s || ""); return v == null ? d : v; } catch (e) { return d; } };
const ORGINFO = require("./org");
const PUBLIC = () => ORGINFO.publicUrl();
const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;
const DONE = (t) => t.status === "done" || t.done === true;
const STATUS_FOR_CLIENT = (t) => DONE(t) ? "Done" : t.status === "blocked" ? "Waiting on something" : ["in_progress", "review"].includes(t.status) ? "In progress" : "Not started";

async function docs(pool, p) {
  return (await pool.query("SELECT id, data FROM hub_docs WHERE path = $1 AND NOT deleted", [p])).rows.map((r) => Object.assign({}, r.data || {}, { id: r.id }));
}
async function names(pool) {
  const rows = (await pool.query("SELECT id, name, email FROM app_users").catch(() => ({ rows: [] }))).rows;
  const m = new Map(rows.map((u) => ["u" + u.id, clip(u.name || String(u.email || "").split("@")[0], 80)]));
  return (uid) => m.get(uid) || ORGINFO.info().leaderName;
}

// The Growth Pathway as InstitutionalOS last sent it, trimmed to what the client may see.
// The client's path (messaging system, Nov 2026): the Diagnostic stage set on the
// deal wins; otherwise the growth stage suggests one (1 Build, 2 Fund, 3+ Sustain).
const PATHS = {
  build: { key: "build", name: "Build", line: "Get the foundation right" },
  fund: { key: "fund", name: "Fund", line: "Get ready for bigger money" },
  sustain: { key: "sustain", name: "Sustain", line: "Make it last beyond one person" }
};
function pathFor(diagnosticStage, g) {
  const k = String(diagnosticStage || "").toLowerCase();
  if (PATHS[k]) return PATHS[k];
  const s = g && Number(g.stage);
  if (!s) return null;
  return s <= 1 ? PATHS.build : s === 2 ? PATHS.fund : PATHS.sustain;
}

function growthFor(g) {
  if (!g || !g.stage) return null;
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    stage: n(g.stage), stageName: clip(g.stageName, 60), score: n(g.score), outOf: n(g.outOf) || 20, band: clip(g.band, 80),
    baseline: g.baseline && n(g.baseline.score) != null ? { stage: n(g.baseline.stage), score: n(g.baseline.score), at: clip(g.baseline.at, 40) } : null,
    nextStage: g.nextStage && g.nextStage.name ? { name: clip(g.nextStage.name, 60), at: n(g.nextStage.at) } : null,
    pillars: (Array.isArray(g.pillars) ? g.pillars : []).slice(0, 5).map((p) => ({ name: clip(p.name, 40), score: n(p.score) })),
    nextHires: (Array.isArray(g.nextHires) ? g.nextHires : []).slice(0, 3).map((h) => clip(h, 120)),
    fundraising: clip(g.fundraising, 400),
    boardGaps: (Array.isArray(g.boardGaps) ? g.boardGaps : []).slice(0, 6).map((x) => clip(x, 200))
  };
}

function legacyFor(l) {
  if (!l || !Number.isFinite(Number(l.met))) return null;
  return { met: Number(l.met), total: Number(l.total) || 6, missing: (Array.isArray(l.missing) ? l.missing : []).slice(0, 6).map((x) => clip(x, 80)) };
}

// Everything the client may see, built in one place so the preview and the client get the same thing.
async function workspace(pool, dealId) {
  const d = (await pool.query("SELECT * FROM pipeline WHERE id = $1 AND archived_at IS NULL", [dealId])).rows[0];
  if (!d) return null;
  const nameOf = await names(pool);
  const plan = json(d.ios_plan, null), rec = json(d.ios_record, {}) || {}, cmp = json(d.ios_comparison, null), gr = json(d.ios_growth, null), lg = json(d.ios_legacy, null);
  const allProjects = (await docs(pool, "projects")).filter((p) => p.eng === dealId && !p.archived);
  const projects = allProjects.filter((p) => !p.clientHidden);
  const pids = new Set(projects.map((p) => p.id));
  const tasks = (await docs(pool, "tasks")).filter((t) => pids.has(t.project) && !t.parent && !t.cancelled);
  const on = "with:" + dealId;
  const msgs = (await docs(pool, "msgs")).filter((m) => m.on === on).sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
  const msgOut = msgs.filter((m) => !m.deleted || msgs.some((r) => r.parent === m.id && !r.deleted)).map((m) => ({
    id: m.id, parent: m.parent || "", at: m.at || "", text: m.deleted ? "" : clip(m.text, 8000), deleted: !!m.deleted,
    from: m.guest || (m.by === "client" ? "Client" : nameOf(m.by)), team: !m.guest && m.by !== "client", decision: !!m.decision
  }));
  const modules = (await pool.query("SELECT module_name, status, session_date FROM engagement_modules WHERE pipeline_id = $1 AND archived_at IS NULL ORDER BY session_date, created_at", [dealId]).catch(() => ({ rows: [] }))).rows;
  const minutes = Number((await pool.query("SELECT COALESCE(SUM(minutes), 0)::int AS m FROM time_entries WHERE pipeline_id = $1 AND archived_at IS NULL", [dealId]).catch(() => ({ rows: [{ m: 0 }] }))).rows[0].m) || 0;
  const done = tasks.filter(DONE);
  const sessionsDone = modules.filter((m) => /complete/i.test(m.status || "")).length;
  const p = plan && plan.startDate ? plan : null;
  return {
    org: d.org || d.name || "Your organization",
    consultant: { name: ORGINFO.info().leaderName, firm: ORGINFO.info().name, short: ORGINFO.info().shortName, email: ORGINFO.info().email },
    portalUrl: d.ios_portal_url || "",
    plan: p ? {
      startDate: p.startDate, target: clip(p.target, 400), baseline: clip(p.baseline, 400),
      actionsDone: p.actionsDone || 0, actionsTotal: p.actionsTotal || 0, actionsBlocked: p.actionsBlocked || 0, actionsOverdue: p.actionsOverdue || 0,
      review90On: p.review90On || "", review90Done: !!p.review90Done, reassessOn: p.reassessOn || "", reassessDone: !!p.reassessDone,
      lastReviewOn: p.lastReviewOn || "", next: p.nextAction && p.nextAction.text ? clip(p.nextAction.text, 300) : ""
    } : null,
    constraint: clip(rec.verifiedConstraint || d.ios_constraint || "", 400),
    projects: projects.map((pr) => {
      const ts = tasks.filter((t) => t.project === pr.id);
      const secName = (id) => ((pr.sections || []).find((s) => s.id === id) || (pr.sections || [])[0] || {}).name || "";
      return {
        id: pr.id, name: clip(pr.name, 200), due: pr.due || "",
        done: ts.filter(DONE).length, total: ts.length,
        tasks: ts.sort((a, b) => (DONE(a) - DONE(b)) || String(a.due || "9").localeCompare(String(b.due || "9"))).slice(0, 200)
          .map((t) => ({ title: clip(t.title, 300), status: STATUS_FOR_CLIENT(t), done: DONE(t), due: t.due || "", doneAt: t.doneAt || "", section: secName(t.section), who: t.owner ? nameOf(t.owner) : "" }))
      };
    }),
    growth: growthFor(gr),
    legacy: legacyFor(lg),
    path: pathFor(d.diagnostic_stage, gr),
    hiddenProjects: allProjects.length - projects.length,
    messages: msgOut,
    decisions: msgOut.filter((m) => m.decision && !m.deleted).map((m) => ({ at: m.at, text: m.text, from: m.from })),
    outcomes: {
      comparison: cmp && cmp.overallBefore != null ? cmp : null,
      overallNow: d.ios_overall != null ? Number(d.ios_overall) : null,
      decisionBand: clip(d.ios_decision, 120),
      plan: p ? { done: p.actionsDone || 0, total: p.actionsTotal || 0, review90Done: !!p.review90Done, reassessDone: !!p.reassessDone, standardizeDone: p.standardizeDone || 0, standardizeTotal: p.standardizeTotal || 0 } : null,
      sessions: { done: sessionsDone, total: modules.length, list: modules.map((m) => ({ name: clip(m.module_name, 200), status: m.status || "", date: m.session_date || "" })) },
      tasksDone: done.length, tasksTotal: tasks.length,
      hours: Math.round(minutes / 6) / 10,
      decisions: msgOut.filter((m) => m.decision && !m.deleted).length,
      since: (p && p.startDate) || (cmp && cmp.baselineDate) || String(d.created_at || "").slice(0, 10)
    },
    asOf: new Date().toISOString()
  };
}

function mount(app, { pool, requireAuth }) {
  const page = (res) => {
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(path.join(__dirname, "public", "client.html"));
  };
  const staff = (req, res) => { if (!req.session || req.session.role === "board") { res.status(403).json({ error: "Only the owner and staff can manage client links." }); return false; } return true; };
  const byToken = async (token) => {
    if (!TOKEN_RE.test(String(token || ""))) return null;
    const r = (await pool.query("SELECT a.*, p.archived_at AS deal_archived FROM client_access a JOIN pipeline p ON p.id = a.pipeline_id WHERE a.token_hash = $1 AND a.revoked_at IS NULL", [sha(token)])).rows[0];
    return r && !r.deal_archived ? r : null;
  };

  // ---------- Franklin's side ----------
  app.get("/api/clients/:deal/access", requireAuth, async (req, res) => {
    const r = await pool.query("SELECT id, name, email, created_at, last_seen_at, revoked_at FROM client_access WHERE pipeline_id = $1 ORDER BY created_at DESC", [req.params.deal]);
    res.json({ ok: true, links: r.rows });
  });
  app.post("/api/clients/:deal/access", requireAuth, async (req, res) => {
    if (!staff(req, res)) return;
    const d = (await pool.query("SELECT id FROM pipeline WHERE id = $1 AND archived_at IS NULL", [req.params.deal])).rows[0];
    if (!d) return res.status(404).json({ error: "No such client." });
    const name = clip(String((req.body || {}).name || "").trim(), 120), email = clip(String((req.body || {}).email || "").trim(), 200);
    if (!name) return res.status(400).json({ error: "Add the person's name, so their messages show who wrote them." });
    const token = crypto.randomBytes(24).toString("base64url"), id = crypto.randomBytes(8).toString("hex");
    await pool.query("INSERT INTO client_access (id, pipeline_id, name, email, token_hash, created_by) VALUES ($1, $2, $3, $4, $5, $6)", [id, d.id, name, email, sha(token), String(req.session.userId || 0)]);
    res.json({ ok: true, id, url: PUBLIC() + "client/" + token });
  });
  app.delete("/api/clients/access/:id", requireAuth, async (req, res) => {
    if (!staff(req, res)) return;
    const r = await pool.query("UPDATE client_access SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL", [req.params.id]);
    res.json({ ok: true, revoked: r.rowCount });
  });
  app.get("/api/clients/:deal/workspace", requireAuth, async (req, res) => {
    const w = await workspace(pool, req.params.deal);
    if (!w) return res.status(404).json({ error: "No such client." });
    res.json(Object.assign({ ok: true, preview: true, me: "" }, w));
  });
  app.get("/client-preview/:deal", requireAuth, (req, res) => page(res));
  // The team answers in the shared conversation, and can mark a message as the decision.
  app.post("/api/clients/:deal/message", requireAuth, async (req, res) => {
    if (!staff(req, res)) return;
    const hub = app.locals.hub; if (!hub) return res.status(503).json({ error: "Not available." });
    const d = (await pool.query("SELECT id FROM pipeline WHERE id = $1 AND archived_at IS NULL", [req.params.deal])).rows[0];
    if (!d) return res.status(404).json({ error: "No such client." });
    const on = "with:" + d.id, me = await hub.meFor(req.session), b = req.body || {};
    if (b.decide) {
      const m = (await pool.query("SELECT data FROM hub_docs WHERE path = 'msgs' AND id = $1 AND NOT deleted", [String(b.decide)])).rows[0];
      if (!m || !m.data || m.data.on !== on) return res.status(404).json({ error: "No such message." });
      const data = Object.assign({}, m.data); if (data.decision) delete data.decision; else data.decision = { by: me.uid, at: new Date().toISOString() };
      await hub.applyOp({ path: "msgs", id: String(b.decide), data }, me);
      return res.json({ ok: true, decision: !!data.decision });
    }
    const text = String(b.text || "").trim(), parent = clip(String(b.parent || ""), 120);
    if (!text) return res.status(400).json({ error: "Write a message first." });
    if (parent) { const p = (await pool.query("SELECT data FROM hub_docs WHERE path = 'msgs' AND id = $1 AND NOT deleted", [parent])).rows[0]; if (!p || !p.data || p.data.on !== on) return res.status(400).json({ error: "That conversation isn't here." }); }
    const id = "ct-" + crypto.randomBytes(8).toString("hex");
    await hub.applyOp({ path: "msgs", id, data: { on, parent, text: clip(text, 8000), at: new Date().toISOString(), mentions: [] } }, me);
    res.json({ ok: true, id });
  });
  // Turn the Growth Pathway's next steps into a project the client sees, one task each.
  // Safe to run again: tasks already made are left as they are (ids come from the text).
  app.post("/api/clients/:deal/growth-plan", requireAuth, async (req, res) => {
    if (!staff(req, res)) return;
    const hub = app.locals.hub; if (!hub) return res.status(503).json({ error: "Not available." });
    const d = (await pool.query("SELECT id, org, name, ios_growth FROM pipeline WHERE id = $1 AND archived_at IS NULL", [req.params.deal])).rows[0];
    if (!d) return res.status(404).json({ error: "No such client." });
    const g = growthFor(json(d.ios_growth, null));
    if (!g) return res.status(400).json({ error: "No Growth Pathway yet. Score the client in InstitutionalOS (Growth Pathway panel) first." });
    const me = await hub.meFor(req.session), pid = "gp-" + d.id;
    const proj = (await pool.query("SELECT data FROM hub_docs WHERE path = 'projects' AND id = $1 AND NOT deleted", [pid])).rows[0];
    if (!proj) {
      await hub.applyOp({ path: "projects", id: pid, data: {
        name: "Growth Plan: " + clip(d.org || d.name || "client", 120), eng: d.id, owner: me.uid, status: "on_track", color: "#B28E42",
        desc: "Next steps from the Growth Pathway (stage " + g.stage + ", " + g.stageName + "). Each task names the seat that owns it.",
        sections: [{ id: "hires", name: "Next hires" }, { id: "fund", name: "Fundraising" }, { id: "board", name: "Board" }],
        start: new Date().toISOString().slice(0, 10), due: "", fields: [], files: [], updates: [], doc: "", form: { on: false, intro: "" }, created: new Date().toISOString(), createdBy: me.uid
      } }, me);
    }
    const want = [].concat(
      g.nextHires.map((h) => ({ section: "hires", seat: "Executive director", title: "Plan and fund the hire: " + h })),
      g.fundraising ? [{ section: "fund", seat: "Development lead", title: "Fundraising move: " + g.fundraising }] : [],
      g.boardGaps.map((x) => ({ section: "board", seat: "Board chair", title: "Board: " + x }))
    );
    const have = new Set((await pool.query("SELECT id FROM hub_docs WHERE path = 'tasks' AND id LIKE $1 AND NOT deleted", [pid + "-%"])).rows.map((r) => r.id));
    let made = 0;
    for (const t of want) {
      const id = pid + "-" + crypto.createHash("sha1").update(t.title).digest("hex").slice(0, 10);
      if (have.has(id)) continue;
      await hub.applyOp({ path: "tasks", id, data: { title: clip(t.title, 300), project: pid, section: t.section, seat: t.seat, status: "unassigned", created: new Date().toISOString() } }, me);
      made++;
    }
    res.json({ ok: true, project: pid, made, total: want.length });
  });
  app.get("/workspace-admin.js", requireAuth, (req, res) => res.sendFile(path.join(__dirname, "public", "workspace-admin.js")));

  // ---------- the client's side ----------
  app.get("/client/:token", (req, res) => page(res));
  app.get("/client.js", (req, res) => res.sendFile(path.join(__dirname, "public", "client.js")));
  app.get("/api/client/:token", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const a = await byToken(req.params.token);
    if (!a) return res.status(404).json({ error: `This link isn't active. Ask ${ORGINFO.info().shortName} for a new one.` });
    pool.query("UPDATE client_access SET last_seen_at = now() WHERE id = $1", [a.id]).catch(() => {});
    const w = await workspace(pool, a.pipeline_id);
    if (!w) return res.status(404).json({ error: `This link isn't active. Ask ${ORGINFO.info().shortName} for a new one.` });
    res.json(Object.assign({ ok: true, preview: false, me: a.name }, w));
  });
  const recent = new Map(); // link id -> times of recent messages (at most 20 an hour)
  app.post("/api/client/:token/message", async (req, res) => {
    const a = await byToken(req.params.token);
    if (!a) return res.status(404).json({ error: "This link isn't active." });
    const text = String((req.body || {}).text || "").trim(), parent = clip(String((req.body || {}).parent || ""), 120);
    if (!text) return res.status(400).json({ error: "Write a message first." });
    const times = (recent.get(a.id) || []).filter((t) => t > Date.now() - 3600e3);
    if (times.length >= 20) return res.status(429).json({ error: "That's a lot of messages in an hour. Try again a little later." });
    times.push(Date.now()); recent.set(a.id, times);
    const hub = app.locals.hub;
    if (!hub) return res.status(503).json({ error: "Messages are not available right now." });
    const on = "with:" + a.pipeline_id, at = new Date().toISOString(), id = "cl-" + crypto.randomBytes(8).toString("hex");
    if (parent) {
      const p = (await pool.query("SELECT data FROM hub_docs WHERE path = 'msgs' AND id = $1 AND NOT deleted", [parent])).rows[0];
      if (!p || !p.data || p.data.on !== on) return res.status(400).json({ error: "That conversation isn't here." });
    }
    const me = { uid: "client", userId: 0, role: "staff", owner: false };
    await hub.applyOp({ path: "msgs", id, data: { on, parent, text: clip(text, 8000), at, via: "client", guest: clip(a.name, 80), mentions: [] } }, me);
    // Let the account lead (or the owner) know, in their Inbox and on their phone.
    const d = (await pool.query("SELECT org, name FROM pipeline WHERE id = $1", [a.pipeline_id])).rows[0] || {};
    const eng = (await pool.query("SELECT data FROM hub_docs WHERE path = 'engagements' AND id = $1 AND NOT deleted", [a.pipeline_id])).rows[0];
    let to = eng && eng.data && eng.data.lead;
    if (!to) { const o = (await pool.query("SELECT id FROM app_users WHERE role = 'owner' AND NOT disabled ORDER BY id LIMIT 1")).rows[0]; to = o ? "u" + o.id : ""; }
    if (to) await hub.applyOp({ path: "notifs", id: "nc-" + id.slice(3), data: { to, text: `${clip(a.name, 60)} (${clip(d.org || d.name || "client", 60)}) wrote in the client workspace: ${clip(text.replace(/\s+/g, " "), 120)}`, on, task: "", eng: a.pipeline_id, by: "client", at, read: false } }, { uid: "fios", userId: 0, role: "owner", owner: true });
    res.json({ ok: true, id });
  });
}

module.exports = { mount, workspace };
