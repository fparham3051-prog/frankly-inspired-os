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
// "Run the practice" flows through the hub as real tasks and goals (mirror()):
//   deal next steps   -> tasks in the "Pipeline next steps" project, one per
//                        open deal, section = stage. Rename, re-date or finish
//                        the task and the deal's next step changes to match
//                        (finishing clears it, so a new one can be set).
//   delivery modules  -> tasks in a "Delivery: <client>" project per deal;
//                        done = Complete, due = session date.
//   issues            -> tasks in "Issues (Weekly Meeting)"; done = solved.
//   quarterly priorities (rocks) -> goals; a check-in sets on/off track.
//   checklist steps   -> tasks in "Checklists", one section per running
//                        checklist; ticking a step ticks it there.
//   board checklist   -> tasks in "Board & Governance checklist".
//   grant reports due -> tasks in "Grant reports due"; done = received.
//   donor follow-ups  -> tasks in "Donor follow-ups"; done = done.
//   prospects         -> "Reach out to …" tasks in "Prospects to reach", section =
//                        prospect status; finishing one marks it contacted.
// Each mirrored document carries link {kind, id} and _src (a fingerprint of
// the source fields). The mirror only overwrites when the source changed, so
// owners, comments, checklists and time added in the hub are kept.
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
const SHARED = ["engagements", "tasks", "messages", "events", "notifs", "projects", "goals", "dashboards", "ptemplates", "utests", "anon", "team", "msgs", "reacts"];
// Paths whose changes go into the activity log (history, undo, restore).
const LOGGED = new Set(["tasks", "projects", "goals", "msgs", "events", "dashboards", "ptemplates", "rules"]);
// Lists that people only ever add to: on a stale save, keep entries from both sides.
const APPEND_ONLY = new Set(["history", "timeLog", "comments", "updates"]);
// On someone else's message, these are the only fields you can change.
const MSG_SHARED_KEYS = new Set(["decision", "taskRef", "pinned"]);
const applied = []; // listeners told about every saved change: fn({ path, id, before, after, me, action })
const onApplied = (fn) => applied.push(fn);
const changes = new (require("events").EventEmitter)();
changes.setMaxListeners(500);
let changeT = null;
function announce() { clearTimeout(changeT); changeT = setTimeout(() => changes.emit("change"), 60); }
const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
function unionList(a, b) {
  const out = Array.isArray(a) ? a.slice() : [], seen = new Set(out.map((x) => JSON.stringify(x)));
  for (const x of Array.isArray(b) ? b : []) { const k = JSON.stringify(x); if (!seen.has(k)) { seen.add(k); out.push(x); } }
  return out.sort((x, y) => String((x && x.at) || "").localeCompare(String((y && y.at) || "")));
}
// A save made from an out-of-date copy: start from what's stored now and apply only
// the fields this person actually changed, so their colleague's edit survives.
function mergeStale(stored, incoming, changed) {
  const out = Object.assign({}, stored);
  for (const k of changed) {
    if (!(k in incoming)) { delete out[k]; continue; }
    out[k] = APPEND_ONLY.has(k) ? unionList(stored[k], incoming[k]) : incoming[k];
  }
  return out;
}
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

const STAGE_SECTIONS = [["lead", "Lead"], ["discovery", "Discovery"], ["assessment", "Assessment"], ["engaged", "Engaged"]];
const PROSPECT_SECTIONS = [["new", "New"], ["researching", "Researching"], ["contacted", "Contacted"], ["responded", "Responded"], ["meeting", "Meeting booked"]];
const MODULE_SECTIONS = [["not-started", "Not started"], ["scheduled", "Scheduled"], ["complete", "Complete"]];
const hash = (o) => crypto.createHash("sha1").update(JSON.stringify(o)).digest("hex").slice(0, 16);
const dateOnly = (v) => String(v || "").slice(0, 10);

async function defaultOwner(pool) {
  const r = await pool.query("SELECT id FROM app_users WHERE role = 'owner' AND NOT disabled ORDER BY id LIMIT 1");
  return "u" + (r.rows[0] ? r.rows[0].id : 0);
}
// The source fields of one linked record, as the hub would show them. null = no longer belongs in the hub.
async function sourceFields(pool, link) {
  if (!link || !link.id) return null;
  if (link.kind === "deal") {
    const d = (await pool.query("SELECT id, org, name, stage, next_step, next_step_date, archived_at FROM pipeline WHERE id = $1", [link.id])).rows[0];
    if (!d || d.archived_at || !STAGE_SECTIONS.some((x) => x[0] === d.stage) || !String(d.next_step || "").trim()) return null;
    return { title: String(d.next_step).trim(), due: dateOnly(d.next_step_date), section: d.stage, project: "fios-pipeline", eng: d.id, done: false };
  }
  if (link.kind === "module") {
    const m = (await pool.query("SELECT m.id, m.pipeline_id, m.module_name, m.status, m.session_date, m.archived_at, p.archived_at AS deal_archived FROM engagement_modules m LEFT JOIN pipeline p ON p.id = m.pipeline_id WHERE m.id = $1", [link.id])).rows[0];
    if (!m || m.archived_at || m.deal_archived) return null;
    const status = MODULE_SECTIONS.some((x) => x[0] === m.status) ? m.status : "not-started";
    return { title: m.module_name || "Delivery session", due: dateOnly(m.session_date), section: status, project: "fios-deal-" + m.pipeline_id, eng: m.pipeline_id, done: status === "complete" };
  }
  if (link.kind === "issue") {
    const i = (await pool.query("SELECT id, title, status, archived_at FROM issues WHERE id = $1", [link.id])).rows[0];
    if (!i || i.archived_at) return null;
    return { title: i.title || "Untitled issue", due: "", section: i.status === "solved" ? "solved" : "open", project: "fios-issues", eng: "", done: i.status === "solved" };
  }
  if (link.kind === "step") {
    const [runId, idx] = String(link.id).split(":");
    const r = (await pool.query("SELECT id, process_name, subject_kind, subject_id, subject_label, steps, skipped, archived_at FROM proc_runs WHERE id = $1", [runId])).rows[0];
    if (!r || r.archived_at || r.skipped) return null;
    let steps = []; try { steps = JSON.parse(r.steps || "[]"); } catch (e) { /* none */ }
    const st = steps[Number(idx)]; if (!st) return null;
    return { title: String(st.text || "Checklist step"), due: dateOnly(st.dueOn), section: r.id, project: "fios-checklists", eng: r.subject_kind === "pipeline" ? r.subject_id : "", done: !!st.doneOn, sectionName: [r.process_name, r.subject_label].filter(Boolean).join(" · ") };
  }
  if (link.kind === "gov") {
    const g = (await pool.query("SELECT id, fiscal_year, label, due_on, done_on FROM gov_checklist WHERE id = $1", [link.id])).rows[0];
    if (!g) return null;
    return { title: g.label || "Board item", due: dateOnly(g.due_on), section: "fy-" + String(g.fiscal_year || "").replace(/[^A-Za-z0-9_-]/g, ""), project: "fios-board", eng: "", done: !!g.done_on, sectionName: "Fiscal year " + (g.fiscal_year || "") };
  }
  if (link.kind === "report") {
    const g = (await pool.query("SELECT r.id, r.kind, r.due_on, r.received_on, a.org_name FROM gm_reports r JOIN gm_applications a ON a.id = r.application_id WHERE r.id = $1", [link.id])).rows[0];
    if (!g) return null;
    return { title: `${g.kind === "interim" ? "Interim" : g.kind === "final" ? "Final" : "Grantee"} report from ${g.org_name || "grantee"}`, due: dateOnly(g.due_on), section: ["interim", "final"].includes(g.kind) ? g.kind : "other", project: "fios-grants", eng: "", done: !!g.received_on };
  }
  if (link.kind === "touch") {
    const g = (await pool.query("SELECT t.id, t.next_step, t.next_on, t.done, d.name FROM fr_touches t JOIN fr_donors d ON d.id = t.donor_id WHERE t.id = $1", [link.id])).rows[0];
    if (!g || !String(g.next_step || "").trim()) return null;
    return { title: `${String(g.next_step).trim()} (${g.name || "donor"})`, due: dateOnly(g.next_on), section: "followups", project: "fios-donors", eng: "", done: !!g.done };
  }
  if (link.kind === "prospect") {
    const g = (await pool.query("SELECT id, name, org, status, archived_at FROM prospects WHERE id = $1", [link.id])).rows[0];
    if (!g || g.archived_at || !PROSPECT_SECTIONS.some((x) => x[0] === g.status)) return null;
    const who = [g.name, g.org].filter(Boolean).join(", ") || "prospect";
    return { title: "Reach out to " + who, due: "", section: g.status, project: "fios-prospects", eng: "", done: ["contacted", "responded", "meeting"].includes(g.status) };
  }
  if (link.kind === "client") {
    // InstitutionalOS follow-ups on a linked deal: id = <deal id>:<checkin|review90|blocked|plan>.
    const [dealId, which] = String(link.id).split(":");
    const d = (await pool.query("SELECT id, org, name, ios_org_id, ios_plan, ios_record, archived_at FROM pipeline WHERE id = $1", [dealId])).rows[0];
    if (!d || d.archived_at || !d.ios_org_id) return null;
    let plan = null, rec = {}; try { plan = JSON.parse(d.ios_plan || "null"); } catch (e) { plan = null; } try { rec = JSON.parse(d.ios_record || "{}") || {}; } catch (e) { rec = {}; }
    const who = d.org || d.name || "client", today = new Date().toISOString().slice(0, 10);
    const base = { project: "fios-clients", eng: d.id, done: false };
    if (which === "plan") return (!plan || !plan.startDate) && rec.verifiedConstraint ? Object.assign(base, { title: `Write the 90-Day Improvement Plan: ${who}`, due: today, section: "plan", key: String(rec.verifiedConstraint).slice(0, 80) }) : null;
    if (!plan || !plan.startDate || plan.active === false) return null;
    if (which === "checkin") return plan.weeklyReviewDue ? Object.assign(base, { title: `Weekly check-in with ${who}`, due: today, section: "checkin", key: plan.lastReviewOn || "" }) : null;
    if (which === "review90") return plan.review90On && plan.review90On <= today && !plan.review90Done ? Object.assign(base, { title: `90-day review with ${who}`, due: dateOnly(plan.review90On), section: "review", key: plan.review90On }) : null;
    if (which === "blocked") return plan.actionsBlocked ? Object.assign(base, { title: `Unblock ${plan.actionsBlocked} action${plan.actionsBlocked === 1 ? "" : "s"} for ${who}${plan.nextAction && plan.nextAction.text ? ": " + String(plan.nextAction.text).slice(0, 120) : ""}`, due: today, section: "blocked", key: String(plan.actionsBlocked) }) : null;
    return null;
  }
  if (link.kind === "rock") {
    const r = (await pool.query("SELECT id, title, quarter, due_date, status, created_at, archived_at FROM rocks WHERE id = $1", [link.id])).rows[0];
    if (!r || r.archived_at) return null;
    return { title: r.title || "Untitled priority", due: dateOnly(r.due_date), start: dateOnly(r.created_at), quarter: r.quarter || "", fiosStatus: r.status || "on-track" };
  }
  return null;
}
function applyTask(doc, f, owner, now) {
  const wasDone = doc.status === "done" || doc.done;
  const out = Object.assign({}, doc, { title: f.title, due: f.due || doc.due || "", section: f.section, project: f.project, eng: f.eng || doc.eng || "", cancelled: false });
  // The owner wrote these records in Run the practice, so they start as already seen.
  if (!out.owner && owner) { out.owner = owner; if (!out.status || out.status === "unassigned" || out.status === "assigned") { out.status = "seen"; out.seenAt = out.seenAt || now; } }
  if (f.done && !wasDone) Object.assign(out, { status: "done", done: true, doneAt: now });
  if (!f.done && wasDone) Object.assign(out, { status: out.owner ? "seen" : "unassigned", done: false, doneAt: null });
  if (!out.status) out.status = out.owner ? "seen" : "unassigned";
  return out;
}
// Bring Run-the-practice records into the hub. Cheap when nothing changed.
let mirrorAt = 0, mirroring = null;
const MIRROR_MS = process.env.HUB_MIRROR_MS != null ? Number(process.env.HUB_MIRROR_MS) : 15000;
async function mirror(pool, { force } = {}) {
  if (mirroring) return mirroring;
  if (!force && Date.now() - mirrorAt < MIRROR_MS) return { skipped: true };
  mirrorAt = Date.now();
  if (force) pool.query("DELETE FROM hub_activity WHERE at < now() - interval '180 days'").catch(() => {});
  mirroring = (async () => {
    await migrateComments(pool);
    const now = new Date().toISOString(), owner = await defaultOwner(pool);
    const existing = new Map((await pool.query("SELECT path, id, data, deleted FROM hub_docs WHERE (path = 'tasks' AND id LIKE 'fios-%') OR (path = 'goals' AND id LIKE 'fios-%') OR (path = 'projects' AND id LIKE 'fios-%')")).rows.map((r) => [r.path + "/" + r.id, r]));
    const put = async (p, id, data) => { await pool.query(`INSERT INTO hub_docs (path, id, data, deleted, t, by_user) VALUES ($1, $2, $3, false, $4, 'fios')
      ON CONFLICT (path, id) DO UPDATE SET data = EXCLUDED.data, deleted = false, t = EXCLUDED.t, by_user = 'fios'`, [p, id, data, nextT()]); n++; announce(); };
    let n = 0;
    const ensureProject = async (id, base) => {
      const ex = existing.get("projects/" + id);
      if (ex && !ex.deleted) {
        const d = ex.data || {}, secs = Array.isArray(d.sections) ? d.sections.slice() : [];
        let changed = false;
        for (const sct of base.sections || []) { const hit = secs.find((x) => x.id === sct.id); if (!hit) { secs.push(sct); changed = true; } else if (sct.name !== hit._name && hit.name === (hit._name || hit.name)) { hit.name = sct.name; hit._name = sct.name; changed = true; } }
        if (base.name && d._name !== base.name) { d.name = base.name; d._name = base.name; changed = true; }
        if (changed) { const nd = Object.assign({}, d, { sections: secs }); existing.set("projects/" + id, { data: nd }); await put("projects", id, nd); }
        return;
      }
      await put("projects", id, Object.assign({ owner, start: dateOnly(now), due: "", status: "on_track", color: "#11233D", fields: [], files: [], updates: [], doc: "", form: { on: false, intro: "" }, created: now, createdBy: "fios", fios: true, _name: base.name }, base));
    };
    // Which records belong in the hub right now.
    const want = [];
    for (const d of (await pool.query("SELECT id FROM pipeline WHERE archived_at IS NULL AND stage = ANY($1) AND COALESCE(next_step, '') <> ''", [STAGE_SECTIONS.map((x) => x[0])])).rows) want.push({ kind: "deal", id: d.id });
    const modules = (await pool.query("SELECT m.id, m.pipeline_id, p.org, p.name FROM engagement_modules m JOIN pipeline p ON p.id = m.pipeline_id WHERE m.archived_at IS NULL AND p.archived_at IS NULL")).rows;
    for (const m of modules) want.push({ kind: "module", id: m.id });
    for (const i of (await pool.query("SELECT id FROM issues WHERE archived_at IS NULL")).rows) want.push({ kind: "issue", id: i.id });
    const rocks = (await pool.query("SELECT id FROM rocks WHERE archived_at IS NULL")).rows;
    // Checklists still running, or finished in the last 30 days.
    const runs = (await pool.query("SELECT id, process_name, subject_label, steps FROM proc_runs WHERE archived_at IS NULL AND NOT skipped AND (COALESCE(completed_on, '') = '' OR completed_on >= $1)", [dateOnly(new Date(Date.now() - 30 * 864e5).toISOString())]).catch(() => ({ rows: [] }))).rows;
    const runSections = [];
    for (const r of runs) { let st = []; try { st = JSON.parse(r.steps || "[]"); } catch (e) { /* none */ } if (!st.length) continue; runSections.push({ id: r.id, name: [r.process_name, r.subject_label].filter(Boolean).join(" · ") || "Checklist" }); st.forEach((_, i) => want.push({ kind: "step", id: r.id + ":" + i })); }
    const gov = (await pool.query("SELECT id, fiscal_year FROM gov_checklist ORDER BY sort").catch(() => ({ rows: [] }))).rows;
    gov.forEach((g) => want.push({ kind: "gov", id: g.id }));
    const reports = (await pool.query("SELECT r.id FROM gm_reports r JOIN gm_applications a ON a.id = r.application_id WHERE COALESCE(r.due_on, '') <> '' AND (COALESCE(r.received_on, '') = '' OR r.received_on >= $1)", [dateOnly(new Date(Date.now() - 30 * 864e5).toISOString())]).catch(() => ({ rows: [] }))).rows;
    reports.forEach((g) => want.push({ kind: "report", id: g.id }));
    const touches = (await pool.query("SELECT id FROM fr_touches WHERE COALESCE(next_step, '') <> '' AND (NOT done OR on_date >= $1)", [dateOnly(new Date(Date.now() - 30 * 864e5).toISOString())]).catch(() => ({ rows: [] }))).rows;
    touches.forEach((g) => want.push({ kind: "touch", id: g.id }));
    if (runSections.length) await ensureProject("fios-checklists", { name: "Checklists", desc: "Steps from running checklists (Process Library). Ticking a step here ticks it there.", sections: runSections });
    if (gov.length) await ensureProject("fios-board", { name: "Board & Governance checklist", desc: "The board's annual checklist from Board & Governance.", sections: [...new Set(gov.map((g) => String(g.fiscal_year || "")))].map((fy) => ({ id: "fy-" + fy.replace(/[^A-Za-z0-9_-]/g, ""), name: "Fiscal year " + fy })) });
    if (reports.length) await ensureProject("fios-grants", { name: "Grant reports due", desc: "Grantee reports from Grants. Finishing one marks it received.", sections: [{ id: "interim", name: "Interim" }, { id: "final", name: "Final" }, { id: "other", name: "Other" }] });
    const prospects = (await pool.query("SELECT id FROM prospects WHERE archived_at IS NULL AND status = ANY($1)", [PROSPECT_SECTIONS.map((x) => x[0])]).catch(() => ({ rows: [] }))).rows;
    prospects.forEach((g) => want.push({ kind: "prospect", id: g.id }));
    // InstitutionalOS client follow-ups (weekly check-ins, 90-day reviews, blocked actions, plans to write).
    const iosDeals = (await pool.query("SELECT id FROM pipeline WHERE archived_at IS NULL AND ios_org_id IS NOT NULL").catch(() => ({ rows: [] }))).rows;
    iosDeals.forEach((d) => ["checkin", "review90", "blocked", "plan"].forEach((w) => want.push({ kind: "client", id: d.id + ":" + w })));
    if (iosDeals.length) await ensureProject("fios-clients", { name: "Client follow-ups (InstitutionalOS)", desc: "What each client's 90-Day Improvement Plan needs from you: weekly check-ins, 90-day reviews, blocked actions, plans to write. Do the work in InstitutionalOS; the task clears itself.", sections: [{ id: "checkin", name: "Weekly check-ins" }, { id: "blocked", name: "Blocked actions" }, { id: "review", name: "90-day reviews" }, { id: "plan", name: "Plans to write" }] });
    if (prospects.length) await ensureProject("fios-prospects", { name: "Prospects to reach", desc: "Prospects from Pipeline & Money → Prospecting. Finishing a task marks the prospect contacted; moving it to another section changes the prospect's status. Promote a prospect to a deal there.", sections: PROSPECT_SECTIONS.map(([id, name]) => ({ id, name })) });
    if (touches.length) await ensureProject("fios-donors", { name: "Donor follow-ups", desc: "Next steps logged on donor touches in Fundraising.", sections: [{ id: "followups", name: "Follow-ups" }] });
    if (want.some((w) => w.kind === "deal")) await ensureProject("fios-pipeline", { name: "Pipeline next steps", desc: "Every open deal's next step, from Pipeline & Money. Change the stage there; rename, re-date or finish the step here.", sections: STAGE_SECTIONS.map(([id, name]) => ({ id, name })) });
    if (want.some((w) => w.kind === "issue")) await ensureProject("fios-issues", { name: "Issues (Weekly Meeting)", desc: "Open issues from Priorities & Vision. Finishing one marks it solved there.", sections: [{ id: "open", name: "Open" }, { id: "solved", name: "Solved" }] });
    const deals = new Map(modules.map((m) => [m.pipeline_id, m.org || m.name || "client"]));
    for (const [dealId, org] of deals) await ensureProject("fios-deal-" + dealId, { name: "Delivery: " + org, eng: dealId, desc: "Delivery sessions from Pipeline & Money → Delivery.", sections: MODULE_SECTIONS.map(([id, name]) => ({ id, name })) });
    const seen = new Set();
    for (const w of want) {
      const id = "fios-" + w.kind + "-" + String(w.id).replace(/:/g, "-s"); seen.add("tasks/" + id);
      const f = await sourceFields(pool, w), ex = existing.get("tasks/" + id);
      if (!f) { seen.delete("tasks/" + id); continue; } // no longer needed there: leaves the lists below
      const fp = hash(f);
      if (ex && ex.data && ex.data._src === fp && (ex.deleted || !ex.data.cancelled)) continue;
      const base = ex && !ex.deleted && ex.data ? ex.data : { created: now, createdBy: "fios", src: "fios", history: [], timeLog: [], assignees: [], custom: {}, files: [], lane: "franklin" };
      await put("tasks", id, Object.assign(applyTask(base, f, owner, now), { link: w, _src: fp }));
    }
    for (const r of rocks) {
      const id = "fios-rock-" + r.id; seen.add("goals/" + id);
      const f = await sourceFields(pool, { kind: "rock", id: r.id }), ex = existing.get("goals/" + id); if (!f) continue;
      const fp = hash(f);
      if (ex && !ex.deleted && ex.data && ex.data._src === fp && !ex.data.archived) continue;
      const base = ex && !ex.deleted && ex.data ? ex.data : { owner, mode: "number", startVal: 0, target: 1, current: 0, unit: "", projects: [], parent: "", checkins: [], created: now };
      await put("goals", id, Object.assign({}, base, { title: f.title, due: f.due, start: base.start || f.start, quarter: f.quarter, fiosStatus: f.fiosStatus, current: f.fiosStatus === "done" ? (Number(base.target) || 1) : base.mode === "number" && base.current >= (Number(base.target) || 1) ? 0 : base.current, archived: false, link: { kind: "rock", id: r.id }, _src: fp }));
    }
    // Records that left Run the practice: keep the task (and anything added to it), but take it out of the lists.
    for (const [k, ex] of existing) {
      if (seen.has(k) || ex.deleted || !ex.data || k.startsWith("projects/")) continue;
      if (k.startsWith("tasks/") && !ex.data.cancelled && !(ex.data.status === "done")) await put("tasks", ex.id, Object.assign({}, ex.data, { cancelled: true, _src: "" }));
      if (k.startsWith("goals/") && !ex.data.archived) await put("goals", ex.id, Object.assign({}, ex.data, { archived: true, _src: "" }));
    }
    // Google Calendar (the week's events the calendar task posts to the operations app) on the hub calendar.
    try {
      const evs = (await pool.query("SELECT id, title, starts_at, ends_at, location, url, status_label FROM week_events")).rows;
      const have = new Map((await pool.query("SELECT id, data, deleted FROM hub_docs WHERE path = 'events' AND id LIKE 'fios-cal-%'")).rows.map((r) => [r.id, r]));
      const ny = (iso) => { const d = new Date(iso); if (isNaN(d)) return null; const f = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d); const g = (t) => (f.find((x) => x.type === t) || {}).value; return { date: `${g("year")}-${g("month")}-${g("day")}`, time: `${g("hour")}:${g("minute")}` }; };
      const keep = new Set();
      for (const e of evs) {
        const s = ny(e.starts_at); if (!s) continue; const en = e.ends_at ? ny(e.ends_at) : null;
        const id = "fios-cal-" + String(e.id).replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 100); keep.add(id);
        const data = { title: e.title, date: s.date, start: /T/.test(e.starts_at) ? s.time : "", end: en && en.date === s.date ? en.time : "", type: "gcal", loc: e.location || "", url: e.url || "", note: e.status_label || "", eng: "", att: [], src: "gcal" };
        const ex = have.get(id);
        if (ex && !ex.deleted && JSON.stringify(ex.data) === JSON.stringify(data)) continue;
        await put("events", id, data);
      }
      for (const [id, r] of have) if (!keep.has(id) && !r.deleted) { await pool.query("UPDATE hub_docs SET deleted = true, t = $2 WHERE path = 'events' AND id = $1", [id, nextT()]); n++; announce(); }
    } catch (e) { console.error("hub calendar mirror", e.message); }
    return { mirrored: n };
  })();
  try { return await mirroring; } finally { mirroring = null; }
}
// A hub change to a linked task or goal goes back to its source. Returns the new fingerprint.
async function writeBack(pool, p, prev, next) {
  const link = next && next.link; if (!link || !link.id || !prev) return null;
  const now = new Date().toISOString();
  const isDone = (d) => !!d && (d.status === "done" || d.done === true);
  const changed = (k) => (prev[k] || "") !== (next[k] || "");
  if (p === "tasks" && link.kind === "deal") {
    if (isDone(next) && !isDone(prev)) await pool.query("UPDATE pipeline SET next_step = '', next_step_date = '', updated_at = $2 WHERE id = $1", [link.id, now]);
    else if (changed("title") || changed("due")) await pool.query("UPDATE pipeline SET next_step = $2, next_step_date = $3, updated_at = $4 WHERE id = $1", [link.id, String(next.title || "").slice(0, 500), dateOnly(next.due), now]);
  } else if (p === "tasks" && link.kind === "module") {
    const status = isDone(next) ? "complete" : MODULE_SECTIONS.some((x) => x[0] === next.section) && next.section !== "complete" ? next.section : (next.due ? "scheduled" : "not-started");
    if (changed("title") || changed("due") || isDone(next) !== isDone(prev) || changed("section"))
      await pool.query("UPDATE engagement_modules SET module_name = $2, session_date = $3, status = $4, updated_at = $5 WHERE id = $1", [link.id, String(next.title || "").slice(0, 300), dateOnly(next.due), status, now]);
  } else if (p === "tasks" && link.kind === "issue") {
    const solved = isDone(next) || next.section === "solved";
    if (changed("title")) await pool.query("UPDATE issues SET title = $2 WHERE id = $1", [link.id, String(next.title || "").slice(0, 500)]);
    if (solved && !(isDone(prev) || prev.section === "solved")) await pool.query("UPDATE issues SET status = 'solved', resolved_at = $2 WHERE id = $1", [link.id, now]);
    if (!solved && (isDone(prev) || prev.section === "solved")) await pool.query("UPDATE issues SET status = 'open' WHERE id = $1", [link.id]);
  } else if (p === "tasks" && link.kind === "step") {
    if (isDone(next) !== isDone(prev) || changed("due") || changed("title")) {
      const [runId, idx] = String(link.id).split(":");
      const r = (await pool.query("SELECT steps, completed_on FROM proc_runs WHERE id = $1", [runId])).rows[0];
      if (r) {
        const steps = JSON.parse(r.steps || "[]"), st = steps[Number(idx)];
        if (st) {
          const today = dateOnly(now);
          if (isDone(next) !== isDone(prev)) { st.doneOn = isDone(next) ? today : ""; st.by = isDone(next) ? "Projects & Team" : ""; }
          if (changed("due")) st.dueOn = dateOnly(next.due);
          if (changed("title") && String(next.title || "").trim()) st.text = String(next.title).trim().slice(0, 400);
          const all = steps.length > 0 && steps.every((x) => x.doneOn);
          await pool.query("UPDATE proc_runs SET steps = $2, completed_on = $3 WHERE id = $1", [runId, JSON.stringify(steps), all ? (r.completed_on || today) : ""]);
          if (isDone(next) !== isDone(prev)) await pool.query("INSERT INTO proc_activity (id, run_id, at, text) VALUES ($1, $2, $3, $4)", [crypto.randomUUID(), runId, now, `${isDone(next) ? "Ticked" : "Unticked"} in Projects & Team: ${st.text}`]).catch(() => {});
        }
      }
    }
  } else if (p === "tasks" && link.kind === "gov") {
    if (isDone(next) !== isDone(prev) || changed("due")) await pool.query("UPDATE gov_checklist SET done_on = $2, due_on = $3 WHERE id = $1", [link.id, isDone(next) ? dateOnly(now) : "", dateOnly(next.due)]);
  } else if (p === "tasks" && link.kind === "report") {
    if (isDone(next) && !isDone(prev)) await pool.query("UPDATE gm_reports SET received_on = $2 WHERE id = $1 AND COALESCE(received_on, '') = ''", [link.id, dateOnly(now)]);
    else if (!isDone(next) && isDone(prev)) await pool.query("UPDATE gm_reports SET received_on = '' WHERE id = $1", [link.id]);
    if (changed("due")) await pool.query("UPDATE gm_reports SET due_on = $2 WHERE id = $1", [link.id, dateOnly(next.due)]);
  } else if (p === "tasks" && link.kind === "touch") {
    if (isDone(next) !== isDone(prev) || changed("due")) await pool.query("UPDATE fr_touches SET done = $2, next_on = $3 WHERE id = $1", [link.id, isDone(next), dateOnly(next.due)]);
  } else if (p === "tasks" && link.kind === "prospect") {
    const cur = (await pool.query("SELECT status FROM prospects WHERE id = $1", [link.id])).rows[0];
    if (cur) {
      let status = cur.status;
      if (changed("section") && PROSPECT_SECTIONS.some((x) => x[0] === next.section)) status = next.section;
      if (isDone(next) && !isDone(prev) && ["new", "researching"].includes(status)) status = "contacted";
      if (!isDone(next) && isDone(prev) && ["contacted", "responded", "meeting"].includes(status)) status = "researching";
      if (status !== cur.status) await pool.query("UPDATE prospects SET status = $2 WHERE id = $1", [link.id, status]);
    }
  } else if (p === "goals" && link.kind === "rock") {
    if (changed("title") || changed("due") || changed("fiosStatus")) await pool.query("UPDATE rocks SET title = $2, due_date = $3, status = $4 WHERE id = $1", [link.id, String(next.title || "").slice(0, 500), dateOnly(next.due), ["on-track", "off-track", "done"].includes(next.fiosStatus) ? next.fiosStatus : "on-track"]);
  } else return null;
  const f = await sourceFields(pool, link);
  return f ? hash(f) : "";
}

// One person's day in Projects & Team: tasks that need them, their Inbox, today's calendar.
async function dayFor(pool, uid) {
  const rows = (await pool.query("SELECT path, id, data FROM hub_docs WHERE path IN ('tasks', 'projects', 'notifs', 'events') AND NOT deleted")).rows;
  const projects = Object.fromEntries(rows.filter((r) => r.path === "projects").map((r) => [r.id, r.data || {}]));
  const tasks = rows.filter((r) => r.path === "tasks").map((r) => Object.assign({ id: r.id }, r.data || {}))
    .filter((t) => !t.cancelled && t.status !== "done" && !t.done && !/^Sample:/.test(t.title || ""));
  const ny = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const soon = addDays(ny, 3);
  // Deal next steps and checklist steps already have their own cards on Today.
  const mine = tasks.filter((t) => (t.owner === uid || (t.assignees || []).includes(uid)) && !(t.link && ["deal", "step"].includes(t.link.kind)));
  const row = (t, why) => ({ id: t.id, title: t.title || "Untitled task", due: t.due || "", project: t.project && projects[t.project] ? projects[t.project].name : "", status: t.status || "", why });
  const items = [];
  mine.filter((t) => t.status === "blocked").forEach((t) => items.push(row(t, "blocked")));
  tasks.filter((t) => t.approval && t.approval.state === "pending" && t.approval.by === uid).forEach((t) => items.push(row(t, "approval")));
  mine.filter((t) => t.due && t.due < ny && t.status !== "blocked").sort((a, b) => a.due.localeCompare(b.due)).forEach((t) => items.push(row(t, "overdue")));
  mine.filter((t) => t.due === ny && t.status !== "blocked").forEach((t) => items.push(row(t, "today")));
  mine.filter((t) => t.due > ny && t.due <= soon && t.status !== "blocked").sort((a, b) => a.due.localeCompare(b.due)).forEach((t) => items.push(row(t, "soon")));
  const seen = new Set(); const out = items.filter((x) => !seen.has(x.id) && seen.add(x.id));
  const risky = Object.entries(projects).filter(([, p]) => !p.archived && ["at_risk", "off_track"].includes(p.status) && !/^Sample:/.test(p.name || "")).map(([id, p]) => ({ id, name: p.name, status: p.status }));
  const inbox = rows.filter((r) => r.path === "notifs" && r.data && r.data.to === uid && !r.data.read).map((r) => Object.assign({ id: r.id }, r.data)).sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  const calendar = rows.filter((r) => r.path === "events" && r.data && r.data.date === ny).map((r) => ({ id: r.id, title: r.data.title, start: r.data.start || "", end: r.data.end || "", loc: r.data.loc || "", note: r.data.note || "", url: r.data.url || "" })).sort((a, b) => a.start.localeCompare(b.start));
  return { date: ny, items: out.slice(0, 12), more: Math.max(0, out.length - 12), open: mine.length, risky, inbox: { unread: inbox.length, top: inbox.slice(0, 5).map((n) => ({ id: n.id, text: n.text, at: n.at, on: n.on || "", task: n.task || "" })) }, calendar };
}

// Comments used to live inside each task (and could be overwritten by a save of the
// same task). Move them into their own message records, once.
let migrated = null;
async function migrateComments(pool) {
  if (migrated) return migrated;
  migrated = (async () => {
    const r = await pool.query("SELECT id, data FROM hub_docs WHERE path = 'tasks' AND NOT deleted AND data ? 'comments'");
    let n = 0;
    for (const row of r.rows) {
      const list = Array.isArray(row.data.comments) ? row.data.comments : [];
      for (let i = 0; i < list.length; i++) {
        const c = list[i] || {}; if (!c.text) continue;
        const id = "mc-" + hash([row.id, i, c.at, c.text]);
        await pool.query(`INSERT INTO hub_docs (path, id, data, deleted, t, by_user) VALUES ('msgs', $1, $2, false, $3, $4) ON CONFLICT (path, id) DO NOTHING`,
          [id, { on: "task:" + row.id, parent: "", by: c.by || "", text: String(c.text), at: c.at || new Date().toISOString(), mentions: c.mentions || [], rule: c.rule || "" }, nextT(), c.by || "fios"]);
        n++;
      }
      const data = Object.assign({}, row.data); delete data.comments;
      await pool.query("UPDATE hub_docs SET data = $1, t = $2 WHERE path = 'tasks' AND id = $3", [data, nextT(), row.id]);
    }
    if (r.rows.length) announce();
    return n;
  })().catch((e) => { console.error("hub comment move", e.message); return 0; }).finally(() => { migrated = null; });
  return migrated;
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
    // The shared practice password signs in as user 0. Until there's a named owner account, keep that
    // person on the team, or adding the first associate would make Franklin a "former member".
    const fallback = { id: 0, email: ORG.org ? ORG.org.email || "" : "", name: lead.name || "Owner", role: "owner", disabled: false };
    const rows = users.rows.some((u) => u.role === "owner" && !u.disabled) ? users.rows : [fallback].concat(users.rows);
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
  app.use("/hub", (req, res, next) => (verifySession(req.cookies[COOKIE_NAME]) ? next() : res.redirect("/")), require("./org").hubSender(), express.static(path.join(__dirname, "public", "hub"), { index: "index.html", maxAge: 0 }));

  // ---------- sync ----------
  app.get("/api/hub/sync", requireAuth, async (req, res) => {
    try {
      const me = await meFor(req.session);
      const since = Math.max(0, Number(req.query.since) || 0);
      try { await mirror(pool); } catch (e) { console.error("hub mirror", e.message); }
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
  // One document change, as the person `me`. op = { path, id, data, base?, changed? }:
  // base = the version (t) their copy came from; changed = the top-level fields they edited.
  // Saves to the same document take turns, so two at the same moment can't both read the old copy.
  const locks = new Map();
  function applyOp(op, me, opts = {}) {
    const key = op.path + "|" + op.id, prior = locks.get(key) || Promise.resolve();
    const run = prior.catch(() => {}).then(() => applyOpNow(op, me, opts));
    const tail = run.catch(() => {}).then(() => { if (locks.get(key) === tail) locks.delete(key); });
    locks.set(key, tail);
    return run;
  }
  async function applyOpNow(op, me, opts = {}) {
    const t = nextT();
    let data = op.data == null ? null : Object.assign({}, op.data);
    if (data) { delete data.id; }
    if (op.path === "team" && data) { for (const k of ["name", "email", "uid", "lead", "fiosRole"]) delete data[k]; }
    if (op.path === "engagements" && data) { for (const k of ["org", "stage", "fiosStage", "value", "outcome", "archived", "nextStep", "nextStepDate", "created", "fios"]) delete data[k]; }
    const cur = (await pool.query("SELECT data, deleted, t FROM hub_docs WHERE path = $1 AND id = $2", [op.path, op.id])).rows[0];
    const stored = cur && !cur.deleted ? cur.data : null;
    const prev = op.path === "tasks" || op.path === "goals" ? stored : null;
    let merged = false;
    // Out-of-date copy: keep what changed since, apply only this person's edits.
    const base = Number(op.base);
    if (data && stored && op.base != null && Number.isFinite(base) && Number(cur.t) > base && Array.isArray(op.changed)) {
      data = mergeStale(stored, data, op.changed.map(String).filter((k) => k !== "id" && k !== "link" && k !== "_src"));
      merged = true;
    }
    // Messages: only the author edits or deletes the words; others can mark a decision, pin, or turn it into a task.
    if (op.path === "msgs" && stored && stored.by && stored.by !== me.uid && !opts.restore) {
      if (!data) { if (!me.owner) return { refused: true }; }
      else { const keep = Object.assign({}, stored); for (const k of MSG_SHARED_KEYS) { if (k in data) keep[k] = data[k]; else delete keep[k]; } data = keep; }
    }
    if (op.path === "msgs" && data && !stored) data.by = me.uid;
    if (op.path === "reacts" && String(op.id).split(".")[1] !== me.uid) return { refused: true };
    if (data && prev && prev.link) {
      data.link = prev.link;
      if (data.link.kind === "deal") data.section = prev.section; // a deal's stage changes in Pipeline & Money
      try { const fp = await writeBack(pool, op.path, prev, data); if (fp !== null) data._src = fp; } catch (e) { console.error("hub write-back", e.message); }
    } else if (data) { delete data.link; delete data._src; }
    // Deleting a mirrored task keeps its link, so the mirror doesn't bring it back until the source changes.
    const keepTomb = !data && prev && prev.link ? { link: prev.link, _src: prev._src || "" } : null;
    const toStore = data || keepTomb;
    if (!data && !stored && !keepTomb && !cur) return { t, act: null, noop: true };
    await pool.query(`INSERT INTO hub_docs (path, id, data, deleted, t, by_user) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (path, id) DO UPDATE SET data = EXCLUDED.data, deleted = EXCLUDED.deleted, t = EXCLUDED.t, by_user = EXCLUDED.by_user`,
      [op.path, op.id, toStore, !data, t, me.uid]);
    let act = null;
    if (LOGGED.has(op.path.split("/")[0]) && !same(stored, data)) {
      const keys = [...new Set([...Object.keys(stored || {}), ...Object.keys(data || {})])].filter((k) => !same((stored || {})[k], (data || {})[k]));
      const action = opts.restore ? "restore" : !stored ? "create" : !data ? "delete" : "update";
      const r = await pool.query("INSERT INTO hub_activity (by_user, path, doc_id, action, changed, merged, before, after) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
        [me.uid, op.path, op.id, action, keys.slice(0, 40), merged, stored, data]);
      act = Number(r.rows[0].id);
    }
    for (const fn of applied) { try { Promise.resolve(fn({ path: op.path, id: op.id, before: stored, after: data, me, action: opts.restore ? "restore" : !stored ? "create" : !data ? "delete" : "update" })).catch((e) => console.error("hub hook", e.message)); } catch (e) { console.error("hub hook", e.message); } }
    let time = 0;
    if (op.path === "tasks" && data) { try { time = await syncTime(prev, data, op.id); } catch (e) { console.error("hub time sync", e.message); } }
    announce();
    return { t, act, merged, time };
  }

  app.locals.hub = { applyOp, meFor };

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
      let t = 0, time = 0, merged = 0;
      const results = [];
      for (const op of ops) {
        const r = await applyOp(op, me);
        if (r.refused) { results.push({ path: op.path, id: op.id, refused: true }); continue; }
        t = Math.max(t, r.t || 0); time += r.time || 0; if (r.merged) merged++;
        results.push({ path: op.path, id: op.id, t: r.t, act: r.act, merged: !!r.merged });
      }
      res.json({ ok: true, t, timeEntries: time, merged, results });
    } catch (e) { console.error("hub write", e); res.status(500).json({ error: "Couldn't save. Try again." }); }
  });

  // ---------- history, undo and restore ----------
  const actRow = (r) => ({ id: Number(r.id), at: r.at, by: r.by_user, path: r.path, docId: r.doc_id, action: r.action, changed: r.changed || [], merged: r.merged,
    title: ((r.after || r.before || {}).title || (r.after || r.before || {}).name || String((r.after || r.before || {}).text || "").slice(0, 80) || r.doc_id) });
  app.get("/api/hub/activity", requireAuth, async (req, res) => {
    try {
      const me = await meFor(req.session);
      if (me.role === "board") return res.status(403).json({ error: "Board accounts see history in the operations app." });
      let r;
      if (req.query.path && req.query.id) {
        r = await pool.query("SELECT id, at, by_user, path, doc_id, action, changed, merged, before, after FROM hub_activity WHERE path = $1 AND doc_id = $2 ORDER BY id DESC LIMIT 60", [String(req.query.path), String(req.query.id)]);
      } else if (req.query.deleted) {
        r = await pool.query(`SELECT a.id, a.at, a.by_user, a.path, a.doc_id, a.action, a.changed, a.merged, a.before, a.after FROM hub_activity a
          JOIN hub_docs d ON d.path = a.path AND d.id = a.doc_id AND d.deleted
          WHERE a.action = 'delete' AND a.path IN ('tasks', 'projects', 'goals', 'msgs') AND a.at > now() - interval '30 days' ORDER BY a.id DESC LIMIT 60`);
      } else {
        r = await pool.query("SELECT id, at, by_user, path, doc_id, action, changed, merged, before, after FROM hub_activity ORDER BY id DESC LIMIT 100");
      }
      res.json({ ok: true, items: r.rows.map(actRow) });
    } catch (e) { console.error("hub activity", e); res.status(500).json({ error: "Couldn't load the history." }); }
  });
  // Put a document back the way it was just before one logged change (undo), or bring back a deleted one.
  app.post("/api/hub/restore", requireAuth, async (req, res) => {
    try {
      const me = await meFor(req.session);
      if (me.role === "board") return res.status(403).json({ error: "You can't change that." });
      const a = (await pool.query("SELECT * FROM hub_activity WHERE id = $1", [Number(req.body && req.body.act) || 0])).rows[0];
      if (!a) return res.status(404).json({ error: "That change isn't in the history." });
      if (!canWrite(a.path, a.doc_id, me)) return res.status(403).json({ error: "You can't change that." });
      const r = await applyOp({ path: a.path, id: a.doc_id, data: a.before }, me, { restore: true });
      // Undoing a deleted task brings back the messages deleted with it in the same minute.
      res.json({ ok: true, t: r.t, act: r.act, path: a.path, id: a.doc_id, back: a.before != null });
    } catch (e) { console.error("hub restore", e); res.status(500).json({ error: "Couldn't restore that." }); }
  });

  // ---------- live updates ----------
  // Open pages hold this stream; any saved change tells them to sync at once.
  let streams = 0;
  app.get("/api/hub/stream", requireAuth, (req, res) => {
    if (streams >= 200) return res.status(503).end();
    streams++;
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.write("retry: 5000\n\n");
    const onChange = () => res.write("event: change\ndata: " + Date.now() + "\n\n");
    const beat = setInterval(() => res.write(": keep-alive\n\n"), 25000);
    changes.on("change", onChange);
    req.on("close", () => { streams--; clearInterval(beat); changes.removeListener("change", onChange); });
  });

  // ---------- my work, for the operations app's Today page ----------
  app.get("/api/hub/today", requireAuth, async (req, res) => {
    try {
      const me = await meFor(req.session);
      try { await mirror(pool); } catch (e) { /* show what's there */ }
      res.json(Object.assign({ ok: true }, await dayFor(pool, me.uid)));
    } catch (e) { console.error("hub today", e); res.status(500).json({ error: "Couldn't load your tasks." }); }
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
      // A mention or reply sent by email: remember the thread, so an emailed answer comes back into the conversation.
      const on = String((req.body && req.body.on) || "");
      if (on && r.threadId && /^(task|project|client|with):[A-Za-z0-9_.-]{1,120}$/.test(on)) {
        const me = await meFor(req.session);
        await pool.query(`INSERT INTO hub_mail (thread_id, account, on_ref, parent, by_user, to_email, sent_at) VALUES ($1, $2, $3, $4, $5, $6, now())
          ON CONFLICT (thread_id) DO UPDATE SET sent_at = now()`, [r.threadId, r.account || "", on, String(req.body.parent || "").slice(0, 120), me.uid, to.join(", ")]).catch((e) => console.error("hub mail", e.message));
      }
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

// ---------- what the Weekly Meeting brief should hear from Projects & Team ----------
async function hubFlags(pool, today) {
  const rows = (await pool.query("SELECT path, id, data FROM hub_docs WHERE path IN ('tasks', 'projects') AND NOT deleted")).rows;
  const tasks = rows.filter((r) => r.path === "tasks").map((r) => r.data || {}).filter((t) => !t.cancelled && t.status !== "done" && !t.done && !/^Sample:/.test(t.title || ""));
  const projects = rows.filter((r) => r.path === "projects").map((r) => Object.assign({ id: r.id }, r.data || {})).filter((p) => !p.archived && p.status !== "done" && !/^Sample:/.test(p.name || ""));
  const flags = [];
  const late = tasks.filter((t) => t.due && t.due < today && !(t.link && t.link.kind === "deal"));
  if (late.length) flags.push({ level: late.length >= 5 ? "warn" : "attn", text: `${late.length} project task${late.length === 1 ? " is" : "s are"} past due in Projects & Team.`, issue: late.length >= 5 ? "Project work keeps slipping: what's in the way?" : "", go: "hub" });
  const blocked = tasks.filter((t) => t.status === "blocked");
  if (blocked.length) flags.push({ level: "warn", text: `${blocked.length} task${blocked.length === 1 ? " is" : "s are"} blocked: ${blocked.slice(0, 3).map((t) => t.title).join("; ")}${blocked.length > 3 ? "; and more" : ""}.`, issue: blocked.length === 1 ? `Unblock "${blocked[0].title}"` : `${blocked.length} blocked tasks`, go: "hub" });
  const off = projects.filter((p) => p.status === "off_track"), risk = projects.filter((p) => p.status === "at_risk");
  off.forEach((p) => flags.push({ level: "warn", text: `Project off track: ${p.name}.`, issue: `Get "${p.name}" back on track`, go: "hub" }));
  if (risk.length) flags.push({ level: "attn", text: `${risk.length} project${risk.length === 1 ? "" : "s"} at risk: ${risk.slice(0, 3).map((p) => p.name).join(", ")}.`, issue: "", go: "hub" });
  const waiting = tasks.filter((t) => t.approval && t.approval.state === "pending" && t.approval.reqAt && t.approval.reqAt.slice(0, 10) <= addDays(today, -2));
  if (waiting.length) flags.push({ level: "attn", text: `${waiting.length} approval${waiting.length === 1 ? " has" : "s have"} waited two days or more.`, issue: "", go: "hub" });
  return { flags, summary: { openTasks: tasks.length, late: late.length, blocked: blocked.length, projects: projects.length, offTrack: off.length, atRisk: risk.length } };
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
  const hubUrl = require("./org").publicUrl() + "hub/";
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

module.exports = { mount, digestTick, digestText, canRead, canWrite, mirror, hubFlags, onApplied, dayFor };
