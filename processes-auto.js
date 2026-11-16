"use strict";
// Step automation for the Process Library: the internal and external loops.
//
// Each checklist step can carry:
//   auto     what ticks it: something recorded elsewhere in the system, or
//            "sent" (its message went out). Ticked by "Automatic".
//   action   a one-click link for the step (drawn by the screen).
//   message  a message template. When the step comes up, a draft is written
//            to proc_outbox. NOTHING is sent until the owner approves it.
//   to       who the message goes to: contact (default), chair, officers,
//            board, member, unsignedCoi (one draft per board member).
//
// The loop: draft -> approved (sent, or opened in the owner's email) -> the
// step ticks when the person responds (a check-in, a signed statement, a
// grant report, feedback). If they haven't responded five days after a
// message went out, a follow-up draft is written, at most two, each again
// waiting for approval. Every tick, draft, and send is logged on the
// checklist. evaluate() runs whenever the library or Today is opened.

const crypto = require("crypto");
const F = require("./foundation");
const { ORG } = require("./accounts");
const { todayIso, nowIso, newId, parseJson } = F;

function addDays(iso, n) { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
const daysBetween = (a, b) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86400000);

// ---------- automation for the starter checklists, step by step ----------
const A = (auto, extra) => Object.assign({ auto }, extra || {});
const AUTOMATION = {
  "Lead to first call": [
    { message: "lead.reply", auto: "sent" }, { action: "scan" }, { message: "lead.checkup", auto: "sent" }, {},
    A("pipe.nextStep"), A("pipe.diagnostic", { action: "letter.engagement" })],
  "Running an InstitutionalOS Diagnostic": [
    A("pipe.invoiceSent", { action: "letter.engagement" }), A("ios.linked"), {}, { message: "diag.evidence", auto: "sent" },
    { message: "diag.survey", auto: "sent" }, A("ios.scored"), A("ios.constraint"), A("ios.plan"),
    { message: "diag.portal", auto: "sent" }, { message: "diag.book90", auto: "sent" }],
  "90-day plan and weekly check-ins": [
    {}, { message: "plan.checkin", auto: "ios.checkin" }, {}, {}, {}, A("ios.review90"), {}],
  "Closing out an engagement": [
    A("pipe.invoiceSent"), { message: "close.feedback", auto: "feedback.received" }, { message: "close.casestudy", auto: "sent" }, {},
    A("pipe.invoicePaid"), { message: "close.thanks", auto: "sent" }],
  "Monthly invoicing and close": [A("month.invoices"), { action: "today" }, {}, {}, { action: "report.monthly" }],
  "Grant award to close": [
    { action: "grant.letter", message: "grant.award", auto: "sent" }, A("grant.agreement"), { action: "grant.990" }, A("grant.paid1"),
    { message: "grant.interim", auto: "grant.interim" }, { message: "grant.final", auto: "grant.final" }, { message: "grant.story", auto: "sent" }],
  "Gift to thank-you": [{}, { action: "receipts" }, {}, {}, { message: "gift.reportback", auto: "sent" }],
  "Board meeting cycle": [
    { message: "board.chair", to: "chair", auto: "sent" }, { message: "board.reports", to: "officers", auto: "sent" },
    { action: "print.agenda", message: "board.packet", to: "board", auto: "sent" }, A("meeting.attendance"), A("meeting.minutes", { action: "print.minutes" }), A("meeting.approved")],
  "Year-end and Form 990": [
    A("year.990", { action: "gov.990" }), { action: "gov.coi", message: "coi.request", to: "unsignedCoi", auto: "year.coiAll" }, { action: "gov.policies" }, { action: "receipts" }, A("year.990filed")],
  "Onboarding a board or staff member": [
    A("member.exists"), A("member.account", { action: "settings" }), { message: "coi.request", to: "member", auto: "member.coi" },
    { message: "onboard.docs", auto: "sent" }, {}, { message: "onboard.checkin", auto: "sent" }],
};

// ---------- message templates (plain text; the owner edits before approving) ----------
const T = {
  "lead.reply": ["Thanks for reaching out", "Hi {first},\n\nThank you for reaching out about {org}. I'd welcome a conversation about what you're working through.\n\nYou can pick a time that suits you here: {booking}\n\nIf it's easier, reply with two or three times that work and I'll send an invitation."],
  "lead.checkup": ["A five-minute check-up before we talk", "Hi {first},\n\nBefore we talk, you may find our free check-up useful. It takes about five minutes and shows where {org} is strong and where growth is likely to strain first:\n\n{checkup}\n\nWe'll use your results as a starting point in our conversation."],
  "diag.evidence": ["Documents for your Diagnostic", "Hi {first},\n\nThank you again for starting the InstitutionalOS Diagnostic with us. To score {org} on evidence rather than impressions, please send what you have of the following:\n\n- Your last two filed Form 990s\n- This year's budget and last year's actuals\n- Board-approved policies (conflict of interest, whistleblower, document retention, any others)\n- Your organization chart\n- Anything that shows how work actually runs: a recent board packet, a dashboard, a program report\n\nWhatever is easiest is fine; a shared folder or email attachments both work. If something doesn't exist yet, that's useful to know too."],
  "diag.survey": ["A short survey for your leadership team", "Hi {first},\n\nAs part of the Diagnostic, we ask the executive director, board members, and senior staff to complete a short survey (about ten minutes). Please share this link with them:\n\n[paste the survey link]\n\nResponses are confidential and reported only as patterns."],
  "diag.portal": ["Your Diagnostic results and client portal", "Hi {first},\n\nThank you for the time your team gave the Diagnostic. Your results, the binding constraint, and your 90-Day Improvement Plan are in your private client portal:\n\n{portal}\n\nThe portal is also where you'll log your weekly check-ins. I'm glad to walk anyone on your team through it."],
  "diag.book90": ["Scheduling your 90-day review", "Hi {first},\n\nLet's put the 90-day review on the calendar now so it's protected. Please choose a time about 90 days out here:\n\n{booking}\n\nWe'll look at what moved, with the evidence, and decide what comes next."],
  "plan.checkin": ["Your weekly check-in", "Hi {first},\n\nA quick reminder to log this week's check-in on your 90-Day Improvement Plan. It takes about fifteen minutes:\n\n{portal}\n\nIf anything is blocked, say so in the check-in and I'll follow up."],
  "close.feedback": ["How did our work together go?", "Hi {first},\n\nIt's been a privilege to work with {org}. Would you take two minutes to tell me how our work together went? Your honest view helps me get better:\n\n{feedback}"],
  "close.casestudy": ["May we share your story?", "Hi {first},\n\nThe progress {org} made is the kind of story that helps other nonprofits see what's possible. Would you be comfortable with me sharing it as a short case study, either with your name or anonymously?\n\nNothing would be published without your review and approval."],
  "close.thanks": ["Thank you", "Hi {first},\n\nThank you for trusting me with this work. I'll be in touch around the six-month mark for your reassessment.\n\nIf you know another leader whose organization is growing faster than its systems, I'd be grateful for an introduction."],
  "grant.award": ["Your grant from {orgName}", "Dear {first},\n\nI'm pleased to share that {orgName} has approved a grant to {org}. Your award letter and grant agreement are attached. Please review the terms, sign, and return a copy; the first payment is made once we receive it.\n\nCongratulations, and thank you for the work you do."],
  "grant.interim": ["Your interim grant report", "Dear {first},\n\nYour interim report for the grant from {orgName} is coming due. You can submit it here; it takes about fifteen minutes:\n\n{reportLink}\n\nTell us what you've done so far, what's working, and anything that's changed. Short and candid is perfect."],
  "grant.final": ["Your final grant report", "Dear {first},\n\nAs your grant period closes, please submit your final report here:\n\n{reportLink}\n\nWe'd like to hear what the grant made possible, what you learned, and what comes next."],
  "grant.story": ["A story we could share?", "Dear {first},\n\nWould you be willing to share a short story or photo about what the grant made possible at {org}? With your permission, we'd love to include it in our updates to our board and supporters."],
  "gift.reportback": ["What your gift made possible", "Dear {first},\n\nA few months ago you made a gift to {orgName}. I wanted you to know what it made possible:\n\n[two or three sentences about the work your gift supported]\n\nThank you for being part of it."],
  "board.chair": ["Agenda for the {meetingDate} board meeting", "Hi {first},\n\nOur next board meeting is {meetingWhen}{meetingWhere}. Here's the draft agenda; let me know what you'd change:\n\n{agenda}"],
  "board.reports": ["Reports for the {meetingDate} board meeting", "Hi {first},\n\nFor the {meetingDate} board meeting, please send your report by {reportsDue} so it can go out in the board packet a week ahead. A page or less is perfect.\n\nThank you."],
  "board.packet": ["Board packet: {meetingDate} meeting", "Dear board members,\n\nOur next meeting is {meetingWhen}{meetingWhere}.\n\nAgenda:\n{agenda}\n\nThe minutes from our last meeting and the financial statements are attached. If you have a conflict of interest with any item, please tell the chair before the meeting.\n\nThank you."],
  "coi.request": ["Your {year} conflict-of-interest statement", "Hi {first},\n\nEach year every board member reads and signs our conflict-of-interest statement. It takes about two minutes:\n\n{coiLink}\n\nThank you."],
  "onboard.docs": ["Welcome to the board: the essentials", "Hi {first},\n\nWelcome. Here are the documents every board member should have:\n\n- Bylaws\n- Board policies\n- Our most recent Form 990\n- This year's budget\n- Minutes from the last three meetings\n\n[paste the shared folder link]\n\nI'm glad to walk you through any of it."],
  "onboard.checkin": ["How was your first meeting?", "Hi {first},\n\nThank you for your engagement at your first board meeting. How did it feel? Is there anything that would help you get up to speed faster?"],
};
const REMINDER_PREFIX = "Following up on my note from {sentDate}.\n\n";

function signature() {
  const o = ORG.org || {}, l = o.leader || {};
  return `\n\nWith gratitude,\n${l.firstName || l.name || ""}\n\n${l.name || ""}${l.title ? ", " + l.title : ""}\n${o.name || ""}${o.phone ? " | " + o.phone : ""}`;
}
function fill(str, v) { return String(str).replace(/\{(\w+)\}/g, (m, k) => (v[k] != null && v[k] !== "" ? v[k] : m)); }
function publicBase() { return String(((ORG.links || {}).operations) || "https://frankly-inspired-os.onrender.com/").replace(/\/?$/, "/"); }
function siteBase() { return String(((ORG.links || {}).website) || "").replace(/\/?$/, "/"); }

// ---------- what the system knows, loaded once per pass ----------
async function loadCtx(pool, runs) {
  const q = async (sql, vals) => { try { return (await pool.query(sql, vals || [])).rows; } catch (e) { return []; } };
  const ids = (kind) => [...new Set(runs.filter((r) => r.subject_kind === kind && r.subject_id).map((r) => r.subject_id))];
  const year = new Date().getFullYear();
  const pIds = ids("pipeline"), gIds = ids("grant"), mIds = ids("meeting"), memIds = ids("member");
  const ctx = {
    pipeline: Object.fromEntries((pIds.length ? await q("SELECT * FROM pipeline WHERE id = ANY($1)", [pIds]) : []).map((r) => [r.id, r])),
    invoices: pIds.length ? await q("SELECT * FROM invoices WHERE pipeline_id = ANY($1) AND archived_at IS NULL", [pIds]) : [],
    feedback: await q("SELECT email, organization, created_at FROM feedback WHERE archived_at IS NULL AND created_at >= $1", [addDays(todayIso(), -365)]),
    grants: Object.fromEntries((gIds.length ? await q("SELECT * FROM gm_applications WHERE id = ANY($1)", [gIds]) : []).map((r) => [r.id, r])),
    payments: gIds.length ? await q("SELECT * FROM gm_payments WHERE application_id = ANY($1)", [gIds]) : [],
    reports: gIds.length ? await q("SELECT * FROM gm_reports WHERE application_id = ANY($1) ORDER BY due_on", [gIds]) : [],
    meetings: Object.fromEntries((mIds.length ? await q("SELECT * FROM gov_meetings WHERE id = ANY($1)", [mIds]) : []).map((r) => [r.id, r])),
    members: await q("SELECT * FROM gov_members WHERE archived_at IS NULL AND (term_end = '' OR term_end >= $1) ORDER BY lower(name)", [todayIso()]),
    memberById: Object.fromEntries((memIds.length ? await q("SELECT * FROM gov_members WHERE id = ANY($1)", [memIds]) : []).map((r) => [r.id, r])),
    coi: await q("SELECT * FROM gov_coi WHERE year >= $1", [year - 1]),
    users: new Set((await q("SELECT lower(email) AS e FROM app_users WHERE NOT COALESCE(disabled, false)")).map((r) => r.e)),
    checklist: await q("SELECT fiscal_year, item_key, done_on FROM gov_checklist"),
    monthInvoices: await q("SELECT issued_date FROM invoices WHERE archived_at IS NULL AND issued_date >= $1", [addDays(todayIso(), -40)]),
    outbox: await q("SELECT * FROM proc_outbox WHERE run_id = ANY($1) ORDER BY created_at", [runs.map((r) => r.id)]),
    year,
  };
  return ctx;
}

// ---------- detectors: return true when the thing has happened ----------
function detect(key, run, ctx, stepIndex) {
  const p = ctx.pipeline[run.subject_id], plan = p ? parseJson(p.ios_plan, null) || {} : {}, rec = p ? parseJson(p.ios_record, null) || {} : {};
  const since = addDays(run.started_on || todayIso(), -3);
  const g = ctx.grants[run.subject_id], m = ctx.meetings[run.subject_id], mem = ctx.memberById[run.subject_id];
  const coiFor = (memberId, year) => ctx.coi.find((c) => c.member_id === memberId && c.year === year);
  switch (key) {
    case "sent": return ctx.outbox.some((o) => o.run_id === run.id && o.step_index === stepIndex && (o.status === "sent" || o.status === "opened"));
    case "pipe.nextStep": return !!(p && p.next_step && p.next_step_date && (p.updated_at || "") >= since);
    case "pipe.diagnostic": return !!(p && ["assessment", "engaged", "graduated"].includes(p.stage));
    case "pipe.invoiceSent": return ctx.invoices.some((i) => i.pipeline_id === run.subject_id && ["sent", "paid"].includes(i.status) && (i.issued_date || (i.created_at || "").slice(0, 10)) >= since);
    case "pipe.invoicePaid": return ctx.invoices.some((i) => i.pipeline_id === run.subject_id && i.status === "paid" && (i.paid_date || (i.updated_at || "").slice(0, 10)) >= since);
    case "ios.linked": return !!(p && p.ios_org_id);
    case "ios.scored": return !!(p && p.ios_overall != null);
    case "ios.constraint": return !!(rec.verifiedConstraint || (p && p.ios_constraint));
    case "ios.plan": return !!plan.startDate;
    case "ios.checkin": return !!(plan.lastReviewOn && plan.lastReviewOn >= (run.started_on || ""));
    case "ios.review90": return !!plan.review90Done;
    case "feedback.received": {
      const org = String((p && p.org) || run.subject_label || "").toLowerCase().trim(), email = String(run.contact_email || "").toLowerCase();
      return ctx.feedback.some((f) => (f.created_at || "") >= since && ((email && String(f.email).toLowerCase() === email) || (org && String(f.organization || "").toLowerCase().trim() === org)));
    }
    case "grant.agreement": return !!(g && g.agreement_signed_on);
    case "grant.paid1": return ctx.payments.some((x) => x.application_id === run.subject_id && x.paid_on);
    case "grant.interim": return ctx.reports.some((x) => x.application_id === run.subject_id && x.kind === "interim" && x.received_on);
    case "grant.final": return ctx.reports.some((x) => x.application_id === run.subject_id && x.kind === "final" && x.received_on);
    case "meeting.attendance": return !!(m && Object.keys(parseJson(m.attendance, {})).length);
    case "meeting.minutes": return !!(m && String(m.minutes || "").trim());
    case "meeting.approved": return !!(m && m.minutes_approved_on);
    case "member.exists": return !!mem;
    case "member.account": return !!(mem && mem.email && ctx.users.has(String(mem.email).toLowerCase()));
    case "member.coi": { const c = mem && coiFor(mem.id, ctx.year); return !!(c && c.signed_on); }
    case "year.990": return ctx.checklist.some((c) => c.fiscal_year === F.fiscalYear(-1, run.started_on).label || c.fiscal_year === F.fiscalYear(0, run.started_on).label);
    case "year.990filed": { const fy = F.fiscalYear(-1, addDays(run.started_on, 40)).label; return ctx.checklist.some((c) => c.fiscal_year === fy && c.item_key === "file" && c.done_on); }
    case "year.coiAll": { const y = Number(run.subject_id) || ctx.year; return ctx.members.length > 0 && ctx.members.every((x) => { const c = coiFor(x.id, y); return c && c.signed_on; }); }
    case "month.invoices": return ctx.monthInvoices.some((i) => (i.issued_date || "").slice(0, 7) === String(run.subject_id || "").slice(0, 7) || (i.issued_date || "") >= run.started_on);
    default: return false;
  }
}

// ---------- recipients and the words for one draft ----------
function recipients(spec, run, ctx) {
  const who = spec.to || "contact";
  const pick = (roles) => ctx.members.filter((x) => roles.includes(x.role) && x.email);
  if (who === "contact") return [{ email: run.contact_email || "", name: run.contact_name || "" }];
  if (who === "chair") { const c = pick(["chair"])[0]; return [{ email: c ? c.email : "", name: c ? c.name : "" }]; }
  if (who === "officers") { const o = pick(["chair", "treasurer", "secretary"]); return [{ email: o.map((x) => x.email).join(", "), name: o.map((x) => x.name.split(" ")[0]).join(", ") }]; }
  if (who === "board") { const b = ctx.members.filter((x) => x.email && x.role !== "staff"); return [{ email: b.map((x) => x.email).join(", "), name: "" }]; }
  if (who === "member") { const m = ctx.memberById[run.subject_id]; return m ? [{ email: m.email || "", name: m.name, memberId: m.id }] : []; }
  if (who === "unsignedCoi") {
    const y = Number(run.subject_id) || ctx.year;
    return ctx.members.filter((x) => { const c = ctx.coi.find((r) => r.member_id === x.id && r.year === y); return c && !c.signed_on; }).map((x) => ({ email: x.email || "", name: x.name, memberId: x.id }));
  }
  return [];
}
function draftText(key, run, ctx, rcpt, extra) {
  const o = ORG.org || {}, links = ORG.links || {};
  const p = ctx.pipeline[run.subject_id], g = ctx.grants[run.subject_id], m = ctx.meetings[run.subject_id];
  const y = Number(run.subject_id) || ctx.year;
  const when = m && m.starts_at ? new Date(m.starts_at.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }) + (m.starts_at.length > 10 ? " at " + (() => { const [h, mi] = m.starts_at.slice(11, 16).split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(mi).padStart(2, "0")} ${h < 12 ? "a.m." : "p.m."}`; })() : "") : "";
  const coi = rcpt.memberId ? ctx.coi.find((c) => c.member_id === rcpt.memberId && c.year === (key === "coi.request" && run.subject_kind === "member" ? ctx.year : y)) : null;
  const report = g ? ctx.reports.find((r) => r.application_id === g.id && r.kind === (key === "grant.final" ? "final" : "interim") && !r.received_on) : null;
  const v = {
    first: (rcpt.name || "").split(/[ ,]/)[0] || "there", org: (p && (p.org || p.name)) || (g && g.org_name) || run.subject_label || "your organization",
    orgName: o.name || "", booking: links.booking || "", checkup: links.freeCheckup || "", feedback: siteBase() + "feedback/",
    portal: (p && p.ios_portal_url) || "[client portal link]", coiLink: coi ? publicBase() + "coi/" + coi.token : "[conflict-of-interest link]",
    reportLink: report && report.token ? publicBase() + "grant-report/" + report.token : "[report link]",
    meetingDate: m && m.starts_at ? new Date(m.starts_at.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" }) : "",
    meetingWhen: when, meetingWhere: m && m.location ? " at " + m.location : "", agenda: m ? String(m.agenda || "").split(/\r?\n/).filter((x) => x.trim()).map((x, i) => `${i + 1}. ${x.trim()}`).join("\n") : "",
    reportsDue: m && m.starts_at ? new Date(addDays(m.starts_at.slice(0, 10), -10) + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }) : "",
    year: String(key === "coi.request" && run.subject_kind === "member" ? ctx.year : y), sentDate: extra && extra.sentDate ? new Date(extra.sentDate.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" }) : "",
  };
  const [subj, body] = T[key] || ["", ""];
  const reminder = extra && extra.reminder;
  return { subject: (reminder ? "Following up: " : "") + fill(subj, v), body: fill((reminder ? REMINDER_PREFIX : "") + body, v) + signature() };
}

// ---------- one pass: tick what's done, write drafts and follow-ups ----------
let running = null;
async function evaluate(pool) {
  if (running) return running;
  running = (async () => {
    const runs = (await pool.query("SELECT * FROM proc_runs WHERE archived_at IS NULL AND NOT skipped AND completed_on = ''")).rows;
    if (!runs.length) return { ticked: 0, drafted: 0 };
    // keep the private links the messages point to in place
    await pool.query("UPDATE gm_reports SET token = md5(random()::text || id) || substr(md5(random()::text), 1, 8) WHERE token IS NULL").catch(() => {});
    const year = new Date().getFullYear();
    for (const r of runs) {
      if (r.subject_kind === "member" && r.subject_id) {
        await pool.query("INSERT INTO gov_coi (id, member_id, year, token, created_at) SELECT $1, $2, $3, $4, $5 WHERE EXISTS (SELECT 1 FROM gov_members WHERE id = $2) ON CONFLICT (member_id, year) DO NOTHING",
          [newId(), r.subject_id, year, crypto.randomBytes(18).toString("base64url"), nowIso()]).catch(() => {});
      }
    }
    const ctx = await loadCtx(pool, runs);
    const today = todayIso(), soon = addDays(today, 2);
    let ticked = 0, drafted = 0;
    for (const r of runs) {
      const steps = parseJson(r.steps, []);
      let changed = false;
      const log = [];
      steps.forEach((st, i) => {
        if (st.doneOn || !st.auto) return;
        if (detect(st.auto, r, ctx, i)) { st.doneOn = today; st.by = "Automatic"; changed = true; ticked++; log.push(`Ticked automatically: ${st.text}`); }
      });
      for (let i = 0; i < steps.length; i++) {
        const st = steps[i];
        if (st.doneOn || !st.message || !T[st.message]) continue;
        const prevDone = steps.slice(0, i).every((x) => x.doneOn || !x.text);
        const due = st.dueOn ? st.dueOn <= soon : prevDone;
        const mine = ctx.outbox.filter((o) => o.run_id === r.id && o.step_index === i);
        for (const rc of recipients(st, r, ctx)) {
          const forThem = mine.filter((o) => (o.to_name || "") === (rc.name || "") || (rc.email && o.to_email === rc.email));
          const pending = forThem.some((o) => o.status === "draft");
          const sentList = forThem.filter((o) => o.status === "sent" || o.status === "opened");
          if (pending) continue;
          if (!forThem.some((o) => o.kind === "first" && o.status !== "discarded")) {
            if (!due || forThem.some((o) => o.kind === "first" && o.status === "discarded")) continue;
            const t = draftText(st.message, r, ctx, rc);
            await pool.query("INSERT INTO proc_outbox (id, run_id, step_index, kind, to_email, to_name, subject, body, created_at) VALUES ($1,$2,$3,'first',$4,$5,$6,$7,$8)", [newId(), r.id, i, rc.email || "", rc.name || "", t.subject, t.body, nowIso()]);
            drafted++; log.push(`Drafted a message for approval: ${t.subject}${rc.name ? " (to " + rc.name + ")" : ""}`);
          } else if (st.auto && st.auto !== "sent" && sentList.length && sentList.length <= 2) {
            const last = sentList[sentList.length - 1];
            if (last.sent_at && daysBetween(last.sent_at, today) >= 5) {
              const t = draftText(st.message, r, ctx, rc, { reminder: true, sentDate: last.sent_at });
              await pool.query("INSERT INTO proc_outbox (id, run_id, step_index, kind, to_email, to_name, subject, body, created_at) VALUES ($1,$2,$3,'reminder',$4,$5,$6,$7,$8)", [newId(), r.id, i, rc.email || last.to_email || "", rc.name || "", t.subject, t.body, nowIso()]);
              drafted++; log.push(`Drafted a follow-up for approval: ${t.subject}`);
            }
          }
        }
      }
      if (changed) {
        const allDone = steps.length > 0 && steps.every((x) => x.doneOn);
        await pool.query("UPDATE proc_runs SET steps = $1, completed_on = $2 WHERE id = $3", [JSON.stringify(steps), allDone ? today : "", r.id]);
        if (allDone) log.push("All steps done; checklist finished.");
      }
      for (const text of log) await pool.query("INSERT INTO proc_activity (id, run_id, at, text) VALUES ($1,$2,$3,$4)", [newId(), r.id, nowIso(), text]);
    }
    return { ticked, drafted };
  })();
  try { return await running; } finally { running = null; }
}

// Prefill who a checklist's messages go to, from what the system already knows.
async function contactFor(pool, kind, id) {
  const q = async (sql, vals) => { try { return (await pool.query(sql, vals)).rows[0]; } catch (e) { return null; } };
  if (kind === "grant") { const g = await q("SELECT contact_name, contact_email FROM gm_applications WHERE id = $1", [id]); return g ? { name: g.contact_name, email: g.contact_email } : {}; }
  if (kind === "member") { const m = await q("SELECT name, email FROM gov_members WHERE id = $1", [id]); return m ? { name: m.name, email: m.email } : {}; }
  if (kind === "pipeline") {
    const p = await q("SELECT name, org FROM pipeline WHERE id = $1", [id]);
    if (!p) return {};
    // Prospects keep the address inside the name (assessment leads) or the notes.
    const pr = await q("SELECT name, notes FROM prospects WHERE (lower(org) = lower($1) OR lower(name) = lower($2)) ORDER BY created_at DESC LIMIT 1", [p.org || "", p.name || ""]);
    const m = pr ? /[^@\s<>"'(),;:]+@[^@\s<>"'(),;:]+\.[a-z]{2,}/i.exec(`${pr.name || ""} ${pr.notes || ""}`) : null;
    return { name: /@/.test(p.name || "") ? "" : p.name || "", email: m ? m[0] : (/@/.test(p.name || "") ? p.name : "") };
  }
  return {};
}

// Apply the automation to the starter checklists (and checklists already
// started from them), matching steps by their text so edits are respected.
async function upgradeStarter(pool) {
  const done = (await pool.query("SELECT value FROM app_settings WHERE key = 'library_auto_v1'")).rows[0];
  if (done) return;
  if (!(await pool.query("SELECT 1 FROM proc_processes LIMIT 1")).rows.length) return; // starter set not loaded yet
  const apply = (name, steps) => {
    const spec = AUTOMATION[name];
    if (!spec) return null;
    const { STARTER } = require("./processes");
    const starter = STARTER.find((x) => x.name === name);
    let changed = false;
    steps.forEach((st) => {
      const i = starter ? starter.steps.findIndex((x) => x.text === st.text) : -1;
      if (i >= 0 && spec[i]) for (const k of ["auto", "action", "message", "to"]) if (spec[i][k] && st[k] == null) { st[k] = spec[i][k]; changed = true; }
    });
    return changed ? steps : null;
  };
  for (const p of (await pool.query("SELECT id, name, steps FROM proc_processes")).rows) {
    const s = apply(p.name, parseJson(p.steps, [])); if (s) await pool.query("UPDATE proc_processes SET steps = $1 WHERE id = $2", [JSON.stringify(s), p.id]);
  }
  for (const r of (await pool.query("SELECT id, process_name, steps FROM proc_runs")).rows) {
    const s = apply(r.process_name, parseJson(r.steps, [])); if (s) await pool.query("UPDATE proc_runs SET steps = $1 WHERE id = $2", [JSON.stringify(s), r.id]);
  }
  await pool.query("INSERT INTO app_settings (key, value) VALUES ('library_auto_v1', '1') ON CONFLICT (key) DO NOTHING");
}

module.exports = { AUTOMATION, TEMPLATES: T, evaluate, contactFor, upgradeStarter, detect };
