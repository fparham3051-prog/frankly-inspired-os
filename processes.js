"use strict";
// Process Library: "How we work" (processes as checklists you can start for a
// client, grant, meeting, or month) and "What we deliver" (client materials,
// internal or client-safe).
//
//   /api/proc/processes        the checklists (owner, when used, steps, review date)
//   /api/proc/runs             one use of a checklist; PATCH {stepIndex, done} ticks a step
//   /api/proc/start            start a checklist {processId, subjectKind, subjectId, subjectLabel}
//   /api/proc/skip             "not needed" for a suggestion
//   /api/proc/summary          suggestions, open checklists, steps due, reviews due
//   /api/proc/materials        client materials
//
// Suggestions are worked out from the data, not from events: a pipeline
// record at a stage, an approved grant, a board meeting in the next three
// weeks, a new board member, month-end, and year-end each suggest the
// matching checklist once (until it's started or marked not needed).
// The starter set loads once, the first time the library is opened.

const F = require("./foundation");
const { ORG } = require("./accounts");
const { todayIso, nowIso, newId, parseJson, toApi, insertRow, coerce } = F;
const AUTO = require("./processes-auto");
const GMAIL = require("./gmail");

F.SPECS.proc_processes = {
  required: ["name"],
  fields: { name: ["name", "s"], area: ["area", "s"], purpose: ["purpose", "s"], usedWhen: ["used_when", "s"], owner: ["owner", "s"], steps: ["steps", "j"], docLink: ["doc_link", "s"],
    suggestOn: ["suggest_on", "s"], reviewEveryMonths: ["review_every_months", "i"], lastReviewed: ["last_reviewed", "d"], version: ["version", "i"] },
};
F.SPECS.proc_runs = {
  required: ["processId"],
  fields: { processId: ["process_id", "s"], processName: ["process_name", "s"], subjectKind: ["subject_kind", "s"], subjectId: ["subject_id", "s"], subjectLabel: ["subject_label", "s"],
    startedOn: ["started_on", "d"], steps: ["steps", "j"], completedOn: ["completed_on", "d"], skipped: ["skipped", "b"], owner: ["owner", "s"] },
};
F.SPECS.lib_materials = {
  required: ["title"],
  fields: { title: ["title", "s"], kind: ["kind", "s"], audience: ["audience", "s"], area: ["area", "s"], link: ["link", "s"], notes: ["notes", "s"] },
};
F.HAS_UPDATED.proc_processes = 1;
F.HAS_UPDATED.lib_materials = 1;

function addDays(iso, n) { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
const s = (text, days) => ({ text, days: days == null ? "" : days });

// ---------- the starter set ----------
const STARTER = [
  { name: "Lead to first call", area: "consulting", suggestOn: "pipeline:lead", usedWhen: "A new lead arrives from the website, a referral, or the market scan.",
    purpose: "Answer fast, arrive prepared, and leave every first call with a dated next step.", steps: [
      s("Reply within one business day with the booking link", 1), s("Look up their 990s and their DMV Market Scan entry before the call", 3),
      s("Send the free check-up link if they haven't taken it", 3), s("Hold the call: the decision they face, by when, and who decides", 7),
      s("Log notes and a dated next step on the pipeline record", 7), s("If it's a fit, send the Diagnostic proposal and engagement letter (Pipeline > Letter)", 10)] },
  { name: "Running an InstitutionalOS Diagnostic", area: "institutionalos", suggestOn: "pipeline:assessment", docTitle: "The InstitutionalOS Runbook", usedWhen: "A client signs for a Diagnostic.",
    purpose: "The same evidence-based Diagnostic every time, from signed letter to readout.", steps: [
      s("Engagement letter signed; Diagnostic invoice sent", 0), s("Link the deal to InstitutionalOS (Link to InstitutionalOS on the deal)", 1),
      s("Intake with the executive director (and board chair): the decision and its date", 5), s("Request evidence: 990s, budget, policies, org chart, how work actually runs", 5),
      s("Send the leader survey to the executive director, board, and senior staff", 7), s("Score the seven areas on evidence, with a note for each", 21),
      s("Confirm the binding constraint and write the memo", 24), s("Draft the 90-Day Improvement Plan: three to six actions, each with an owner, a date, and its evidence", 26),
      s("Hold the readout with leadership and open the client portal", 28), s("Book the 90-day review", 28)] },
  { name: "90-day plan and weekly check-ins", area: "institutionalos", suggestOn: "pipeline:engaged", usedWhen: "A client starts working their 90-Day Improvement Plan.",
    purpose: "Keep the plan moving week to week and end the 90 days with evidence, not impressions.", steps: [
      s("Turn on weekly check-in reminders in the portal and agree the weekday", 0), s("First weekly check-in done", 7),
      s("Unblock anything marked blocked within a week", 14), s("Month one: does the diagnosis still hold?", 30), s("Month two: does the diagnosis still hold?", 60),
      s("90-day review: what moved, with the evidence logged", 90), s("Decide together: next plan, retainer, or close out", 92)] },
  { name: "Closing out an engagement", area: "consulting", suggestOn: "pipeline:graduated", usedWhen: "An engagement ends.",
    purpose: "End well: paid, thanked, learned from, and set up for the six-month reassessment.", steps: [
      s("Final invoice sent", 0), s("Ask for feedback (the website's feedback form)", 3), s("Ask permission to use the work as a case study (named or anonymous)", 7),
      s("Set the six-month reassessment date", 7), s("Final invoice paid", 15), s("Thank-you note with a referral ask", 14)] },
  { name: "Monthly invoicing and close", area: "operations", suggestOn: "month:end", usedWhen: "The last week of every month.",
    purpose: "Every invoice out, every payment recorded, and the month's numbers in front of you.", steps: [
      s("Send retainer and milestone invoices", 0), s("Follow up anything overdue (Money due on Today)", 3), s("Record payments received", 5),
      s("Reconcile the bank account against the Money tab", 7), s("Print the monthly report (Insights > Funnel) and review it", 7)] },
  { name: "Grant award to close", area: "grants", suggestOn: "grant:approved", usedWhen: "A grant is approved.",
    purpose: "Every grant documented from award letter to final report.", steps: [
      s("Send the award letter and agreement (open the application > Award letter)", 0), s("Record the date the signed agreement came back", 14),
      s("Confirm the grantee is still eligible (tax status) before the first payment", 14), s("Make the first payment and mark it paid", 21),
      s("When the interim report arrives, mark it received with a note", ""), s("When the final report arrives, mark it received and close the grant", ""),
      s("Ask the grantee for a story or photo to share, with permission", "")] },
  { name: "Gift to thank-you", area: "fundraising", suggestOn: "", usedWhen: "A gift arrives (start it for larger or first gifts).",
    purpose: "Thank every donor within 48 hours and report back on what their gift did.", steps: [
      s("Record the gift the day it arrives", 0), s("Send the thank-you letter with receipt, then mark it thanked", 2),
      s("Personal call or note for first gifts and gifts of $1,000 or more", 3), s("Log the conversation and a next step on the donor's page", 3),
      s("Report back on what the gift did", 90)] },
  { name: "Board meeting cycle", area: "board", suggestOn: "meeting:upcoming", usedWhen: "Three weeks before every board meeting.",
    purpose: "A prepared board, a clean record, and minutes approved on time.", steps: [
      s("Confirm the date, place, and agenda with the chair", 0), s("Collect reports: executive director, treasurer, committees", 7),
      s("Send the board packet a week ahead: agenda, last minutes, financials", 14), s("Hold the meeting: attendance, conflicts check, motions recorded", 21),
      s("Write the draft minutes within three days", 24), s("Get the minutes approved at the next meeting and record the date", "")] },
  { name: "Year-end and Form 990", area: "board", suggestOn: "year:end", usedWhen: "December, every year.",
    purpose: "Close the year and file on time with the governance answers already documented.", steps: [
      s("Start the year's Form 990 checklist (Board & Governance > Form 990)", 0), s("Create and send this year's conflict-of-interest statements", 7),
      s("Review any policies due for review", 30), s("Send year-end giving letters to donors", 30), s("Work the 990 checklist through to filing", "")] },
  { name: "System setup", area: "operations", suggestOn: "", usedWhen: "Once, when the system is first set up for an organization (it starts on its own).",
    purpose: "Everything only the owner can do to take the system from built to fully working: email, security, the domain, real data, and the professional reviews.", steps: [
      // Week 1: email and security
      s("Finish the Google Cloud setup (Branding, publish the app, create the Web client, enable the Gmail API) and connect Gmail in Settings > Connected email", 1),
      s("Find out where the business email is hosted: connect it directly if it's Google Workspace, otherwise add it in Gmail as a \"Send mail as\" address; then choose it as the sender", 2),
      s("Approve one test message to yourself and confirm it arrives from the right address", 2),
      s("Turn on two-step sign-in for the owner account (Settings > Your account)", 2),
      s("Open last night's backup in Google Drive (Frankly Inspired Backups) and confirm it's there", 4),
      // Week 2: the domain
      s("In Resend, add the sending domain and copy its DNS records (SPF, DKIM) into the domain registrar", 7),
      s("Add a DMARC record at the registrar (start with p=none)", 7),
      s("Confirm the domain and its www address both show the current website", 7),
      s("When Resend shows Verified: switch the website's sender to the business address and send a test reminder", 9),
      // Weeks 3-4: real data
      s("Contacts: add an email for everyone missing one and merge duplicates", 14),
      s("Pipeline: every live deal has a contact, a stage, and a dated next step", 14),
      s("Money: enter open invoices and payments so Today and the monthly report are accurate", 14),
      s("Run one real or practice case through each checklist you use and fix any step that doesn't fit", 18),
      // Weeks 4-5: professional reviews
      s("Attorney review: engagement letter terms, website privacy policy and terms, client data handling, grant agreement and conflict-of-interest templates", 30),
      s("CPA review: invoicing and revenue tracking, bookkeeping and bank reconciliation, gift receipt wording, the Form 990 checklist", 30),
      // By year end
      s("Decide whether to move the operations app to a paid Render plan so it doesn't sleep (first load after idle takes up to a minute)", 45),
      s("Plan the next organization's copy of the system (docs/NEW-ORGANIZATION.md): start date and which areas to turn on", 45)] },
  { name: "Onboarding a board or staff member", area: "board", suggestOn: "member:new", usedWhen: "Someone joins the board or staff.",
    purpose: "Ready to contribute by their first meeting.", steps: [
      s("Add them to Board members with their term dates", 0), s("Create their sign-in (Settings > People: Board or Staff)", 1),
      s("Send this year's conflict-of-interest statement", 1), s("Share the bylaws, policies, last 990, budget, and the last three sets of minutes", 3),
      s("Orientation with the executive director and the chair", 14), s("Check in after their first meeting", 45)] },
];

async function ensureStarter(pool) {
  const flag = (await pool.query("SELECT value FROM app_settings WHERE key = 'library_seeded'")).rows[0];
  if (flag) return;
  const have = (await pool.query("SELECT (SELECT count(*) FROM proc_processes)::int + (SELECT count(*) FROM lib_materials)::int AS n")).rows[0].n;
  if (!have) {
    const mats = ((ORG.library || {}).materials || []);
    const byTitle = {};
    for (const m of mats) { const row = await insertRow(pool, "lib_materials", m); byTitle[m.title] = row.link; }
    for (const p of STARTER) {
      const auto = AUTO.AUTOMATION[p.name] || [];
      const steps = p.steps.map((x, i) => Object.assign({}, x, auto[i] || {}));
      await insertRow(pool, "proc_processes", Object.assign({ reviewEveryMonths: 12, docLink: p.docTitle ? byTitle[p.docTitle] || "" : "" }, p, { steps }));
    }
  }
  await pool.query("INSERT INTO app_settings (key, value) VALUES ('library_seeded', '1') ON CONFLICT (key) DO NOTHING");
}

function runToApi(r) {
  const a = toApi("proc_runs", r);
  a.contactName = r.contact_name || ""; a.contactEmail = r.contact_email || "";
  const today = todayIso();
  const steps = a.steps || [];
  a.done = steps.filter((x) => x.doneOn).length;
  a.total = steps.length;
  const open = steps.map((x, i) => Object.assign({ i }, x)).filter((x) => !x.doneOn);
  a.nextStep = open[0] || null;
  a.overdue = open.filter((x) => x.dueOn && x.dueOn < today).length;
  return a;
}

function mount(app, { pool, requireAuth }) {
  const wrap = F.crud(app, pool, requireAuth, "/api/proc/materials", "lib_materials", { order: "audience, lower(title)" });
  // processes: list carries how often each was used; steps kept well-formed
  const cleanSteps = (v) => {
    let list = typeof v === "string" ? (parseJson(v, null) || v.split(/\r?\n/).map((t) => t.trim()).filter(Boolean)) : v;
    if (!Array.isArray(list)) return [];
    return list.slice(0, 40).map((x) => {
      if (typeof x === "string") { const m = /^(.*?)\s*\((?:day\s*)?(\d{1,3})\)\s*$/i.exec(x); return m ? { text: m[1].slice(0, 400), days: Number(m[2]) } : { text: x.slice(0, 400), days: "" }; }
      const out = { text: String(x.text || "").slice(0, 400), days: x.days === "" || x.days == null || isNaN(Number(x.days)) ? "" : Math.max(0, Math.min(999, Number(x.days))) };
      for (const k of ["auto", "action", "message", "to"]) if (x[k]) out[k] = String(x[k]).slice(0, 60);
      return out;
    }).filter((x) => x.text);
  };
  app.get("/api/proc/processes", requireAuth, wrap(async (req, res) => {
    await ensureStarter(pool);
    await AUTO.upgradeStarter(pool);
    const rows = (await pool.query("SELECT * FROM proc_processes WHERE archived_at IS NULL ORDER BY area, lower(name)")).rows;
    const uses = Object.fromEntries((await pool.query("SELECT process_id, count(*) FILTER (WHERE NOT skipped)::int AS n, count(*) FILTER (WHERE NOT skipped AND completed_on = '' AND archived_at IS NULL)::int AS open FROM proc_runs GROUP BY process_id")).rows.map((r) => [r.process_id, r]));
    res.json({ items: rows.map((r) => Object.assign(toApi("proc_processes", r), { runs: (uses[r.id] || {}).n || 0, openRuns: (uses[r.id] || {}).open || 0 })) });
  }));
  app.post("/api/proc/processes", requireAuth, wrap(async (req, res) => {
    const b = Object.assign({}, req.body || {}, { steps: cleanSteps((req.body || {}).steps) });
    res.status(201).json({ item: toApi("proc_processes", await insertRow(pool, "proc_processes", b)) });
  }));
  app.patch("/api/proc/processes/:id", requireAuth, wrap(async (req, res) => {
    const b = Object.assign({}, req.body || {});
    if ("steps" in b) {
      b.steps = cleanSteps(b.steps);
      const cur = (await pool.query("SELECT version, steps FROM proc_processes WHERE id = $1", [req.params.id])).rows[0];
      // A step that keeps its words keeps its automation.
      const before = Object.fromEntries(parseJson(cur ? cur.steps : "[]", []).map((x) => [x.text, x]));
      b.steps.forEach((x) => { const o = before[x.text]; if (o) for (const k of ["auto", "action", "message", "to"]) if (o[k]) x[k] = o[k]; });
      const plain = (list) => JSON.stringify(list.map((x) => [x.text, x.days]));
      if (cur && plain(parseJson(cur.steps, [])) !== plain(b.steps)) b.version = (Number(cur.version) || 1) + 1;
    }
    const row = await F.updateRow(pool, "proc_processes", req.params.id, b);
    if (!row) return res.status(404).json({ error: "not found" });
    res.json({ item: toApi("proc_processes", row) });
  }));
  app.delete("/api/proc/processes/:id", requireAuth, wrap(async (req, res) => {
    await pool.query("UPDATE proc_processes SET archived_at = $1 WHERE id = $2", [nowIso(), req.params.id]);
    res.json({ ok: true });
  }));

  // ----- runs -----
  async function whoAmI(session) {
    if (!session || !session.userId) return (ORG.org && ORG.org.leader && ORG.org.leader.firstName) || "Owner";
    const u = (await pool.query("SELECT name, email FROM app_users WHERE id = $1", [session.userId])).rows[0];
    return u ? (u.name || u.email) : "";
  }
  app.post("/api/proc/start", requireAuth, wrap(async (req, res) => {
    const b = req.body || {};
    const p = (await pool.query("SELECT * FROM proc_processes WHERE id = $1 AND archived_at IS NULL", [String(b.processId || "")])).rows[0];
    if (!p) return res.status(404).json({ error: "Process not found." });
    const start = coerce("d", b.startedOn) || todayIso();
    const steps = parseJson(p.steps, []).map((x) => {
      const st = { text: x.text, dueOn: x.days === "" || x.days == null ? "" : addDays(start, Number(x.days)), doneOn: "", by: "" };
      for (const k of ["auto", "action", "message", "to"]) if (x[k]) st[k] = x[k];
      return st;
    });
    const c = await AUTO.contactFor(pool, b.subjectKind || "other", b.subjectId || "");
    const row = await insertRow(pool, "proc_runs", { processId: p.id, processName: p.name, subjectKind: b.subjectKind || "other", subjectId: b.subjectId || "", subjectLabel: String(b.subjectLabel || "").slice(0, 200),
      startedOn: start, steps, owner: b.owner || p.owner || "" });
    await pool.query("UPDATE proc_runs SET contact_name = $1, contact_email = $2 WHERE id = $3", [String(b.contactName || c.name || "").slice(0, 160), String(b.contactEmail || c.email || "").slice(0, 200), row.id]);
    await pool.query("INSERT INTO proc_activity (id, run_id, at, text) VALUES ($1,$2,$3,$4)", [newId(), row.id, nowIso(), "Started"]);
    await AUTO.evaluate(pool);
    res.status(201).json({ item: runToApi((await pool.query("SELECT * FROM proc_runs WHERE id = $1", [row.id])).rows[0]) });
  }));
  app.post("/api/proc/skip", requireAuth, wrap(async (req, res) => {
    const b = req.body || {};
    const p = (await pool.query("SELECT id, name FROM proc_processes WHERE id = $1", [String(b.processId || "")])).rows[0];
    if (!p) return res.status(404).json({ error: "Process not found." });
    await insertRow(pool, "proc_runs", { processId: p.id, processName: p.name, subjectKind: b.subjectKind || "other", subjectId: b.subjectId || "", subjectLabel: b.subjectLabel || "", startedOn: todayIso(), steps: [], skipped: true, completedOn: todayIso() });
    res.json({ ok: true });
  }));
  app.get("/api/proc/runs", requireAuth, wrap(async (req, res) => {
    await AUTO.upgradeStarter(pool); await AUTO.evaluate(pool);
    const where = ["archived_at IS NULL", "NOT skipped"];
    if (req.query.open) where.push("completed_on = ''");
    const rows = (await pool.query(`SELECT * FROM proc_runs WHERE ${where.join(" AND ")} ORDER BY completed_on = '' DESC, started_on DESC LIMIT 500`)).rows;
    res.json({ items: rows.map(runToApi) });
  }));
  app.patch("/api/proc/runs/:id", requireAuth, wrap(async (req, res) => {
    const r = (await pool.query("SELECT * FROM proc_runs WHERE id = $1", [req.params.id])).rows[0];
    if (!r) return res.status(404).json({ error: "not found" });
    const b = req.body || {};
    const steps = parseJson(r.steps, []);
    if (b.stepIndex != null) {
      const st = steps[Number(b.stepIndex)];
      if (!st) return res.status(400).json({ error: "No such step." });
      st.doneOn = b.done ? todayIso() : ""; st.by = b.done ? await whoAmI(req.session) : "";
    }
    if (typeof b.addStep === "string" && b.addStep.trim()) steps.push({ text: b.addStep.trim().slice(0, 400), dueOn: coerce("d", b.addStepDue), doneOn: "", by: "" });
    const allDone = steps.length > 0 && steps.every((x) => x.doneOn);
    const completed = b.complete === true || allDone ? (r.completed_on || todayIso()) : (b.complete === false ? "" : (allDone ? r.completed_on : ""));
    let row = (await pool.query("UPDATE proc_runs SET steps = $1, completed_on = $2, owner = COALESCE($3, owner) WHERE id = $4 RETURNING *",
      [JSON.stringify(steps), completed, b.owner != null ? String(b.owner).slice(0, 120) : null, r.id])).rows[0];
    if (b.contactEmail != null || b.contactName != null) {
      const email = b.contactEmail != null ? String(b.contactEmail).trim().slice(0, 200) : r.contact_email, name = b.contactName != null ? String(b.contactName).trim().slice(0, 160) : r.contact_name;
      row = (await pool.query("UPDATE proc_runs SET contact_email = $1, contact_name = $2 WHERE id = $3 RETURNING *", [email, name, r.id])).rows[0];
      // the contact record learns the address too
      if (email && ["pipeline", "grant", "member"].includes(r.subject_kind)) await require("./contacts").rememberEmail(pool, r.subject_kind, r.subject_id, name, email).catch(() => {});
      // drafts to "the contact" that had no address yet pick it up
      await pool.query("UPDATE proc_outbox SET to_email = $1, to_name = CASE WHEN to_name = '' THEN $2 ELSE to_name END WHERE run_id = $3 AND status = 'draft' AND to_email = ''", [email, name, r.id]);
    }
    if (b.stepIndex != null) await pool.query("INSERT INTO proc_activity (id, run_id, at, text) VALUES ($1,$2,$3,$4)", [newId(), r.id, nowIso(), `${b.done ? "Ticked" : "Unticked"} by ${await whoAmI(req.session)}: ${(steps[Number(b.stepIndex)] || {}).text || ""}`]);
    res.json({ item: runToApi(row) });
  }));
  app.delete("/api/proc/runs/:id", requireAuth, wrap(async (req, res) => {
    await pool.query("UPDATE proc_runs SET archived_at = $1 WHERE id = $2", [nowIso(), req.params.id]);
    res.json({ ok: true });
  }));

  // ----- messages waiting for approval (nothing is sent without it) -----
  const WEBSITE_API_URL = (process.env.WEBSITE_API_URL || "").replace(/\/+$/, "");
  const WEBSITE_ADMIN_SECRET = process.env.WEBSITE_ADMIN_SECRET || "";
  let mailCache = null, mailAt = 0;
  async function mailStatus() {
    if (mailCache && Date.now() - mailAt < 600000) return mailCache;
    if (!WEBSITE_API_URL || !WEBSITE_ADMIN_SECRET) return { external: false, reason: "not configured" };
    try {
      const r = await fetch(WEBSITE_API_URL + "/api/admin/mail-status", { headers: { "X-Reminder-Secret": WEBSITE_ADMIN_SECRET }, signal: AbortSignal.timeout(60000) });
      const j = await r.json().catch(() => ({}));
      mailCache = { external: !!j.external, from: j.from || "" }; mailAt = Date.now();
    } catch (e) { return { external: false, reason: "website server unreachable" }; }
    return mailCache;
  }
  async function mailAll() {
    const g = await GMAIL.sender(pool).catch(() => null);
    const w = await mailStatus();
    return { gmail: g ? { account: g.account, from: g.from } : null, external: !!g || w.external, via: g ? "gmail" : (w.external ? "website" : "own-email"), from: g ? g.from : (w.from || "") };
  }
  app.get("/api/proc/mail-status", requireAuth, wrap(async (req, res) => res.json(await mailAll())));
  const outApi = (o) => ({ id: o.id, runId: o.run_id, stepIndex: o.step_index, kind: o.kind, toEmail: o.to_email, toName: o.to_name, subject: o.subject, body: o.body, status: o.status, approvedBy: o.approved_by, sentAt: o.sent_at, error: o.error, createdAt: o.created_at,
    processName: o.process_name, subjectLabel: o.subject_label, stepText: o.step_text, sentVia: o.sent_via || "", repliedAt: o.replied_at || "", replyFrom: o.reply_from || "" });
  app.get("/api/proc/outbox", requireAuth, wrap(async (req, res) => {
    await AUTO.upgradeStarter(pool); await AUTO.evaluate(pool);
    const rows = (await pool.query(`SELECT o.*, r.process_name, r.subject_label, (r.steps::json -> o.step_index ->> 'text') AS step_text FROM proc_outbox o JOIN proc_runs r ON r.id = o.run_id
      WHERE r.archived_at IS NULL AND (o.status = 'draft' OR o.created_at >= $1) ORDER BY o.status = 'draft' DESC, o.created_at DESC LIMIT 300`, [addDays(todayIso(), -60)])).rows;
    res.json({ items: rows.map(outApi), mail: await mailAll() });
  }));
  const getDraft = async (id) => (await pool.query("SELECT * FROM proc_outbox WHERE id = $1", [id])).rows[0];
  const logRun = (runId, text) => pool.query("INSERT INTO proc_activity (id, run_id, at, text) VALUES ($1,$2,$3,$4)", [newId(), runId, nowIso(), text]);
  app.patch("/api/proc/outbox/:id", requireAuth, wrap(async (req, res) => {
    const o = await getDraft(req.params.id);
    if (!o || o.status !== "draft") return res.status(409).json({ error: "Only drafts can be edited." });
    const b = req.body || {};
    await pool.query("UPDATE proc_outbox SET to_email = $1, subject = $2, body = $3 WHERE id = $4", [String(b.toEmail != null ? b.toEmail : o.to_email).slice(0, 1000), String(b.subject != null ? b.subject : o.subject).slice(0, 200), String(b.body != null ? b.body : o.body).slice(0, 20000), o.id]);
    res.json({ ok: true });
  }));
  // Approve and send through the website server (once outside delivery is set up).
  app.post("/api/proc/outbox/:id/send", requireAuth, wrap(async (req, res) => {
    const b = req.body || {};
    if (b.toEmail != null || b.subject != null || b.body != null) await pool.query("UPDATE proc_outbox SET to_email = COALESCE($1, to_email), subject = COALESCE($2, subject), body = COALESCE($3, body) WHERE id = $4 AND status = 'draft'", [b.toEmail != null ? String(b.toEmail) : null, b.subject != null ? String(b.subject) : null, b.body != null ? String(b.body) : null, req.params.id]);
    const o = await getDraft(req.params.id);
    if (!o || o.status !== "draft") return res.status(409).json({ error: "This message isn't waiting for approval." });
    if (!/@/.test(o.to_email || "")) return res.status(400).json({ error: "Add who it goes to first." });
    if (/\[[^\]]*(link|paste|sentences)[^\]]*\]/i.test(o.body)) return res.status(400).json({ error: "Fill in the bracketed placeholder in the message first." });
    const who = await whoAmI(req.session);
    const gm = await GMAIL.sender(pool).catch(() => null);
    try {
      if (gm) {
        // Follow-ups go in the same thread as the first message.
        const first = o.kind === "reminder" ? (await pool.query("SELECT * FROM proc_outbox WHERE run_id = $1 AND step_index = $2 AND kind = 'first' AND sent_via LIKE 'gmail:%' AND gmail_thread_id <> '' ORDER BY created_at LIMIT 1", [o.run_id, o.step_index])).rows[0] : null;
        const subject = first ? (/^re:/i.test(first.subject) ? first.subject : "Re: " + first.subject) : o.subject;
        const sent = await GMAIL.send(pool, { to: o.to_email, subject, body: o.body, threadId: first ? first.gmail_thread_id : undefined, inReplyTo: first ? first.gmail_message_id : undefined });
        await pool.query("UPDATE proc_outbox SET status = 'sent', sent_at = $1, approved_by = $2, error = '', sent_via = $3, gmail_thread_id = $4, gmail_message_id = $5, subject = $6 WHERE id = $7",
          [nowIso(), who, "gmail:" + sent.account, sent.threadId || "", sent.messageId || "", subject, o.id]);
        await logRun(o.run_id, `Approved by ${who} and sent from ${sent.from}: ${subject} (to ${o.to_email})`);
        await AUTO.evaluate(pool);
        return res.json({ ok: true, via: "gmail", from: sent.from });
      }
      const ms = await mailStatus();
      if (!ms.external) return res.status(409).json({ error: "Sending from the system isn't set up yet. Connect Gmail in Settings, or use \"Approve and open in my email\"." });
      const r = await fetch(WEBSITE_API_URL + "/api/admin/send-message", { method: "POST", headers: { "Content-Type": "application/json", "X-Reminder-Secret": WEBSITE_ADMIN_SECRET },
        body: JSON.stringify({ to: o.to_email, subject: o.subject, text: o.body, replyTo: (ORG.org || {}).email || undefined }), signal: AbortSignal.timeout(120000) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || "website server returned " + r.status);
      await pool.query("UPDATE proc_outbox SET status = 'sent', sent_at = $1, approved_by = $2, error = '', sent_via = 'website' WHERE id = $3", [nowIso(), who, o.id]);
      await logRun(o.run_id, `Approved by ${who} and sent: ${o.subject} (to ${o.to_email})`);
      await AUTO.evaluate(pool);
      res.json({ ok: true });
    } catch (err) {
      await pool.query("UPDATE proc_outbox SET error = $1 WHERE id = $2", [String(err.message || err).slice(0, 300), o.id]);
      res.status(502).json({ error: "Couldn't send: " + (err.message || err) });
    }
  }));
  // Approved and sent from the owner's own email (the screen opens it prefilled).
  app.post("/api/proc/outbox/:id/opened", requireAuth, wrap(async (req, res) => {
    const o = await getDraft(req.params.id);
    if (!o || o.status !== "draft") return res.status(409).json({ error: "This message isn't waiting for approval." });
    const who = await whoAmI(req.session);
    await pool.query("UPDATE proc_outbox SET status = 'opened', sent_at = $1, approved_by = $2 WHERE id = $3", [nowIso(), who, o.id]);
    await logRun(o.run_id, `Approved by ${who} and sent from their email: ${o.subject}${o.to_email ? " (to " + o.to_email + ")" : ""}`);
    await AUTO.evaluate(pool);
    res.json({ ok: true });
  }));
  app.post("/api/proc/outbox/:id/discard", requireAuth, wrap(async (req, res) => {
    const o = await getDraft(req.params.id);
    if (!o || o.status !== "draft") return res.status(409).json({ error: "This message isn't waiting for approval." });
    await pool.query("UPDATE proc_outbox SET status = 'discarded' WHERE id = $1", [o.id]);
    await logRun(o.run_id, `Not sent (discarded by ${await whoAmI(req.session)}): ${o.subject}`);
    res.json({ ok: true });
  }));
  app.get("/api/proc/runs/:id/activity", requireAuth, wrap(async (req, res) => {
    const rows = (await pool.query("SELECT at, text FROM proc_activity WHERE run_id = $1 ORDER BY at DESC LIMIT 200", [req.params.id])).rows;
    const out = (await pool.query("SELECT id, step_index, kind, status, subject, to_email, sent_at FROM proc_outbox WHERE run_id = $1 ORDER BY created_at", [req.params.id])).rows;
    res.json({ items: rows, messages: out.map((o) => ({ id: o.id, stepIndex: o.step_index, kind: o.kind, status: o.status, subject: o.subject, toEmail: o.to_email, sentAt: o.sent_at })) });
  }));

  // ----- summary: suggestions, open checklists, steps due, reviews due -----
  app.get("/api/proc/summary", requireAuth, wrap(async (req, res) => {
    await ensureStarter(pool);
    await AUTO.upgradeStarter(pool);
    await AUTO.evaluate(pool);
    const today = todayIso(), in7 = addDays(today, 7), in21 = addDays(today, 21);
    const procs = (await pool.query("SELECT * FROM proc_processes WHERE archived_at IS NULL")).rows;
    const runs = (await pool.query("SELECT * FROM proc_runs WHERE archived_at IS NULL")).rows;
    const used = new Set(runs.map((r) => `${r.process_id}|${r.subject_kind}|${r.subject_id}`));
    const bySuggest = {};
    procs.forEach((p) => { if (p.suggest_on) (bySuggest[p.suggest_on] = bySuggest[p.suggest_on] || []).push(p); });
    const suggestions = [];
    const offer = (key, kind, id, label, why) => (bySuggest[key] || []).forEach((p) => {
      if (!used.has(`${p.id}|${kind}|${id}`)) suggestions.push({ processId: p.id, processName: p.name, area: p.area, subjectKind: kind, subjectId: id, subjectLabel: label, why });
    });
    const q = async (sql, vals) => { try { return (await pool.query(sql, vals || [])).rows; } catch (e) { return []; } };
    // pipeline stages (only records touched in the last 60 days, so old records don't flood the list)
    const since = addDays(today, -60);
    for (const p of await q("SELECT id, name, org, stage, updated_at, created_at FROM pipeline WHERE COALESCE(archived_at::text, '') = '' AND COALESCE(updated_at, created_at, '') >= $1", [since])) {
      const label = p.org || p.name || "Pipeline record";
      if (p.stage === "lead" || p.stage === "discovery") offer("pipeline:lead", "pipeline", p.id, label, "New lead in the pipeline");
      if (p.stage === "assessment") offer("pipeline:assessment", "pipeline", p.id, label, "Moved to the Diagnostic stage");
      if (p.stage === "engaged") offer("pipeline:engaged", "pipeline", p.id, label, "Engaged and working a plan");
      if (p.stage === "graduated") offer("pipeline:graduated", "pipeline", p.id, label, "Engagement finished");
    }
    for (const a of await q("SELECT id, org_name, decided_at FROM gm_applications WHERE archived_at IS NULL AND status = 'approved' AND COALESCE(decided_at, '') >= $1", [since])) offer("grant:approved", "grant", a.id, a.org_name, "Grant approved");
    for (const m of await q("SELECT id, title, starts_at FROM gov_meetings WHERE archived_at IS NULL AND status <> 'cancelled' AND left(starts_at, 10) >= $1 AND left(starts_at, 10) <= $2", [today, in21])) offer("meeting:upcoming", "meeting", m.id, `${m.title}, ${m.starts_at.slice(0, 10)}`, "Board meeting in the next three weeks");
    for (const m of await q("SELECT id, name FROM gov_members WHERE archived_at IS NULL AND created_at >= $1", [since])) offer("member:new", "member", m.id, m.name, "Joined recently");
    const d = new Date(today + "T12:00:00Z"), last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    if (d.getUTCDate() >= last - 6) offer("month:end", "month", today.slice(0, 7), "Month ending " + today.slice(0, 7), "Last week of the month");
    if (d.getUTCMonth() === 11) offer("year:end", "year", String(d.getUTCFullYear()), "Year " + d.getUTCFullYear(), "December");

    const open = runs.filter((r) => !r.skipped && !r.completed_on).map(runToApi);
    const stepsDue = [];
    open.forEach((r) => r.steps.forEach((st, i) => { if (!st.doneOn && st.dueOn && st.dueOn <= in7) stepsDue.push({ runId: r.id, stepIndex: i, text: st.text, dueOn: st.dueOn, overdue: st.dueOn < today, processName: r.processName, subjectLabel: r.subjectLabel }); }));
    stepsDue.sort((a, b) => a.dueOn.localeCompare(b.dueOn));
    const reviews = procs.map((p) => {
      const base = p.last_reviewed || (p.created_at || "").slice(0, 10);
      const due = base ? F.addMonths(base, Number(p.review_every_months) || 12) : "";
      return { id: p.id, name: p.name, owner: p.owner, nextReview: due };
    }).filter((p) => p.nextReview && p.nextReview <= addDays(today, 30));
    const drafts = (await pool.query("SELECT count(*)::int AS n FROM proc_outbox o JOIN proc_runs r ON r.id = o.run_id WHERE o.status = 'draft' AND r.archived_at IS NULL")).rows[0].n;
    const replies = (await pool.query("SELECT o.run_id, o.subject, o.reply_from, o.replied_at, r.subject_label FROM proc_outbox o JOIN proc_runs r ON r.id = o.run_id WHERE o.replied_at >= $1 AND r.archived_at IS NULL ORDER BY o.replied_at DESC LIMIT 10", [addDays(today, -7)])).rows
      .map((x) => ({ runId: x.run_id, subject: x.subject, from: (x.reply_from || "").replace(/<.*>/, "").trim() || x.reply_from, at: x.replied_at, subjectLabel: x.subject_label }));
    res.json({ suggestions, open, stepsDue, reviews, drafts, replies, counts: { processes: procs.length, open: open.length, completed: runs.filter((r) => !r.skipped && r.completed_on).length } });
  }));
}

module.exports = { mount, STARTER };
