"use strict";
// The AI features, each built on ai.js. Everything an AI writes for someone
// else goes to the approval queue (proc_outbox); nothing is sent on its own.
//
//   1. Lead brief + first reply      tick, POST /api/ai/lead/:id
//   2. Field notes engine            /api/ai/field-notes..., monthly draft in tick
//   3. Diagnostic first pass         POST /api/ai/diagnostic/:dealId (documents)
//   4. Call notes to records         POST /api/ai/call-notes/:dealId (+ /apply)
//   5. Reading replies               onReply() from gmail.checkReplies; unsubscribes
//   6. Pre-call brief                tick, POST /api/ai/precall/:dealId
//   7. Foundation                    grant first read, report summaries, minutes draft
//   8. Ask the system                POST /api/ai/ask
//
// GET /api/ai/status and GET /api/ai/deal/:id feed the screens.

const crypto = require("crypto");
const AI = require("./ai");
const F = require("./foundation");
const GMAIL = require("./gmail");
const { ORG } = require("./accounts");
const { todayIso, nowIso, parseJson } = F;
const newId = () => crypto.randomUUID();
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const WEB_SOURCES = /website|assessment|pop-up|tool/i;

async function q(pool, sql, vals) { try { return (await pool.query(sql, vals || [])).rows; } catch (e) { return []; } }
const one = async (pool, sql, vals) => (await q(pool, sql, vals))[0];
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const clip = (s, n) => String(s == null ? "" : s).slice(0, n);
const emailIn = (...xs) => { const m = EMAIL_RE.exec(xs.join(" ")); return m ? m[0].toLowerCase() : ""; };
const signature = () => { const o = ORG.org || {}, l = o.leader || {}; return `\n\n${l.name || ""}${l.title ? "\n" + l.title : ""}\n${o.name || ""}${o.phone ? "\n" + o.phone : ""}`.replace(/\n{3,}/g, "\n\n"); };
const links = () => ORG.links || {};

async function draft(pool, d) {
  const id = newId();
  await pool.query(`INSERT INTO proc_outbox (id, run_id, step_index, kind, to_email, to_name, subject, body, created_at, purpose, subject_kind, subject_id, subject_label, ai, gmail_thread_id, reply_to_message, recipients)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, true, $14, $15, $16)`,
  [id, d.runId || null, d.stepIndex == null ? null : d.stepIndex, d.kind || "first", d.to || "", d.toName || "", clip(d.subject, 200), clip(d.body, 20000), nowIso(), d.purpose || "", d.subjectKind || "", d.subjectId || "", clip(d.subjectLabel, 200), d.threadId || "", d.replyTo || "", d.recipients ? JSON.stringify(d.recipients) : ""]);
  return id;
}

// ---------- context builders ----------
async function scanFor(pool, { ein, org }) {
  if (ein) { const r = await one(pool, "SELECT * FROM market_orgs WHERE ein = $1", [String(ein).replace(/\D/g, "")]); if (r) return r; }
  if (org) return one(pool, "SELECT * FROM market_orgs WHERE lower(name) = lower($1) LIMIT 1", [org]);
  return null;
}
function scanText(r) {
  if (!r) return "Not in the DMV market scan.";
  const s = parseJson(r.signals, {}) || {};
  return [`DMV market scan: ${r.name} (${r.city || ""} ${r.state || ""}), EIN ${r.ein}`,
    s.revenue != null || r.bmf_revenue != null ? `latest revenue $${Math.round(Number(s.revenue != null ? s.revenue : r.bmf_revenue)).toLocaleString("en-US")}${s.latestYear ? " (" + s.latestYear + ")" : ""}` : "",
    r.public_score != null ? `public financial score ${Math.round(r.public_score)}/100` : "",
    s.reserveMonths != null ? `reserves ${Number(s.reserveMonths).toFixed(1)} months` : "",
    s.deficitYears != null ? `deficit years in last 3: ${s.deficitYears}` : "",
    s.revenueChange != null ? `revenue change ${Math.round(s.revenueChange * 100)}%` : "",
    r.growth_flag ? `growth signal: ${r.growth_flag}` : "", r.situation ? `likely situation from filings: ${r.situation}` : ""].filter(Boolean).join("; ");
}
function selfText(ss) {
  ss = typeof ss === "string" ? parseJson(ss, null) : ss;
  if (!ss) return "";
  return "Self-scores on the free tools (0-100): " + Object.keys(ss).map((k) => `${k} ${ss[k]}`).join(", ");
}
async function dealContext(pool, id) {
  const p = await one(pool, "SELECT * FROM pipeline WHERE id = $1", [id]);
  if (!p) throw Object.assign(new Error("Deal not found."), { status: 404 });
  const pros = p.org ? await q(pool, "SELECT * FROM prospects WHERE (lower(org) = lower($1) OR lower(name) = lower($2)) AND archived_at IS NULL ORDER BY created_at DESC LIMIT 3", [p.org, p.name]) : [];
  const scan = await scanFor(pool, { ein: p.scan_ein, org: p.org });
  const probs = p.org ? await q(pool, "SELECT * FROM problem_log WHERE lower(organization) = lower($1) AND archived_at IS NULL ORDER BY logged_on DESC LIMIT 5", [p.org]) : [];
  const contact = await one(pool, `SELECT c.name, c.email, c.title FROM contacts c JOIN contact_links l ON l.contact_id = c.id WHERE l.kind = 'pipeline' AND l.ref_id = $1 AND c.archived_at IS NULL LIMIT 1`, [id])
    || (p.org ? await one(pool, "SELECT c.name, c.email, c.title FROM contacts c JOIN organizations o ON o.id = c.org_id WHERE lower(o.name) = lower($1) AND c.email <> '' LIMIT 1", [p.org]) : null)
    || { name: p.name !== p.org ? p.name : "", email: emailIn(...pros.map((x) => x.notes)), title: "" };
  const text = [
    `Organization: ${p.org || p.name}. Contact: ${contact.name || "unknown"}${contact.title ? ", " + contact.title : ""}${contact.email ? " <" + contact.email + ">" : ""}.`,
    `Stage: ${p.stage}. Offer: ${p.track}. Deal value: ${p.deal_value || 0}. Next step: ${p.next_step || "none"}${p.next_step_date ? " on " + p.next_step_date : ""}. Source: ${p.source || "unknown"}. Situation they named: ${p.trigger_key || "none"}.`,
    selfText(p.self_scores),
    p.ios_overall != null ? `InstitutionalOS verified Health Index ${Math.round(p.ios_overall)}${p.ios_decision ? ", decision " + p.ios_decision : ""}${p.ios_constraint ? ", binding constraint: " + p.ios_constraint : ""}.` : "",
    p.notes ? "Deal notes:\n" + clip(p.notes, 4000) : "",
    pros.length ? "What came in with the lead:\n" + pros.map((x) => clip(x.notes, 2500)).join("\n---\n") : "",
    scanText(scan),
    probs.length ? "Problem log:\n" + probs.map((x) => `${x.logged_on}: presenting "${x.presenting_problem}", verified constraint "${x.verified_constraint}", at stake "${x.at_stake}"`).join("\n") : "",
  ].filter(Boolean).join("\n");
  return { p, contact, scan, text };
}

// ---------- 1. lead brief + first reply ----------
async function leadBrief(pool, id, { force } = {}) {
  const p = await one(pool, "SELECT * FROM prospects WHERE id = $1", [id]);
  if (!p) throw Object.assign(new Error("Prospect not found."), { status: 404 });
  const email = emailIn(p.name, p.notes);
  const ein = (/organizations\/(\d{9})/.exec(p.link || "") || [])[1] || (/EIN (\d{2}-?\d{7})/.exec(p.notes || "") || [])[1];
  const scan = await scanFor(pool, { ein, org: p.org });
  const popup = /pop-up/i.test(p.source);
  const L = links();
  const r = await AI.ask(pool, {
    maxTokens: 1400, json: true,
    prompt: `A new lead came in. Write (a) a brief for the principal and (b) a first reply from the principal to the lead.

Lead: ${p.name}${p.org ? " at " + p.org : ""}. Source: ${p.source}. Wants: ${p.interest || "not stated"}. Stage: ${p.org_stage || "not stated"}. Situation: ${p.trigger_key || "not stated"}.
${selfText(p.self_scores)}
What they sent or what the tool recorded:
${clip(p.notes, 4000)}
${scanText(scan)}

Links the reply may use: booking ${L.booking || "(none)"}; free check-up ${L.freeCheckup || "(none)"}; field notes ${(L.website || "").replace(/\/?$/, "/")}insights.

Brief: who they are in one line; what their scores or message suggest (two lines at most, specific); the likely binding constraint as a hypothesis (one line, labeled as a guess when evidence is thin); the recommended next step (one line); fit as "strong", "possible", or "unclear".
Reply: ${popup ? "they signed up for field notes; a two- to four-sentence welcome that thanks them, says what to expect, and points to the free check-up. No sales ask." : "three to six sentences; acknowledge exactly what they said or scored, name one specific observation, and offer the booking link for a short conversation. No pricing."} Greet them by first name if known. Do not sign it (a signature is added).

JSON shape: {"brief": {"who": "", "read": "", "likelyConstraint": "", "nextStep": "", "fit": ""}, "reply": {"subject": "", "body": ""}}`,
  });
  const brief = Object.assign({}, r.brief || {}, { at: nowIso() });
  await pool.query("UPDATE prospects SET ai_brief = $1, ai_at = $2 WHERE id = $3", [JSON.stringify(brief), nowIso(), id]);
  let outboxId = null;
  const existing = await one(pool, "SELECT id FROM proc_outbox WHERE subject_kind = 'prospect' AND subject_id = $1 AND status = 'draft'", [id]);
  if (r.reply && r.reply.body && (!existing || force)) {
    if (existing) await pool.query("UPDATE proc_outbox SET status = 'discarded' WHERE id = $1", [existing.id]);
    outboxId = await draft(pool, { to: email, toName: EMAIL_RE.test(p.name) ? "" : p.name, subject: r.reply.subject || "Thanks for reaching out", body: r.reply.body.trim() + signature(),
      purpose: popup ? "Welcome (AI draft)" : "First reply (AI draft)", subjectKind: "prospect", subjectId: id, subjectLabel: p.org || p.name });
  }
  return { brief, outboxId };
}

// ---------- 2. field notes ----------
const NOTE_FIELDS = { title: "title", signal: "signal", assumption: "assumption", constraint: "constraint_text", evidence: "evidence", action: "action", trigger: "trigger_key" };
const noteApi = (n) => ({ id: n.id, title: n.title, signal: n.signal, assumption: n.assumption, constraint: n.constraint_text, evidence: n.evidence, action: n.action, trigger: n.trigger_key, status: n.status, publishedOn: n.published_on, createdAt: n.created_at, source: n.source });
async function fieldNoteDraft(pool) {
  const probs = await q(pool, "SELECT org_type, org_size, trigger_key, presenting_problem, verified_constraint, differs, at_stake FROM problem_log WHERE archived_at IS NULL AND logged_on >= $1 ORDER BY logged_on DESC LIMIT 40", [addDays(todayIso(), -365)]);
  const digest = await q(pool, "SELECT headline, summary FROM digest ORDER BY logged_at DESC NULLS LAST LIMIT 12");
  const prior = await q(pool, "SELECT title FROM field_notes ORDER BY created_at DESC LIMIT 30");
  const r = await AI.ask(pool, {
    maxTokens: 1200, json: true,
    prompt: `Draft one new field note for the practice's website and email list. Field notes always use the same five parts:
- signal: what a leader notices (one sentence, concrete)
- assumption: what organizations usually assume it means
- constraint: what it often turns out to be (the real binding constraint)
- evidence: what to check to know (specific documents, numbers, or patterns)
- action: one first 90-day action, concrete enough to do Monday

Ground it in the patterns below. Never name or identify any organization or person; generalize. Pick a pattern that recurs, not a one-off. Avoid repeating these earlier titles: ${prior.map((x) => x.title).join("; ") || "(none yet)"}.
Also choose the closest trigger key: expansion, funder, founder, strain, transition, or checkup. Title: four to eight words, plain, no colon.

Patterns from the practice's problem log (anonymous):
${probs.length ? probs.map((x) => `- [${x.trigger_key || "?"}; ${x.org_type || "?"}, ${x.org_size || "?"}] presented "${x.presenting_problem}", turned out "${x.verified_constraint}"${x.differs ? " (different from what they assumed)" : ""}${x.at_stake ? "; at stake: " + x.at_stake : ""}`).join("\n") : "(no entries yet; use the sector news below and the practice's method)"}

Recent sector news the practice tracked:
${digest.map((x) => "- " + x.headline + (x.summary ? ": " + clip(x.summary, 200) : "")).join("\n") || "(none)"}

JSON shape: {"title": "", "signal": "", "assumption": "", "constraint": "", "evidence": "", "action": "", "trigger": ""}`,
  });
  const id = newId();
  await pool.query("INSERT INTO field_notes (id, title, signal, assumption, constraint_text, evidence, action, trigger_key, status, source, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft','ai',$9,$9)",
    [id, clip(r.title, 160), clip(r.signal, 600), clip(r.assumption, 600), clip(r.constraint, 800), clip(r.evidence, 800), clip(r.action, 800), ["expansion", "funder", "founder", "strain", "transition", "checkup"].includes(r.trigger) ? r.trigger : "checkup", nowIso()]);
  return noteApi(await one(pool, "SELECT * FROM field_notes WHERE id = $1", [id]));
}
async function pushNotesToSite(pool) {
  const base = (process.env.WEBSITE_API_URL || "").replace(/\/+$/, ""), secret = process.env.WEBSITE_ADMIN_SECRET || "";
  if (!base || !secret) return { pushed: false, reason: "website server not configured" };
  const notes = (await q(pool, "SELECT * FROM field_notes WHERE status = 'published' ORDER BY published_on DESC, created_at DESC LIMIT 50")).map((n) => ({ id: "fn-" + n.id.slice(0, 8), title: n.title, signal: n.signal, assumption: n.assumption, constraint: n.constraint_text, evidence: n.evidence, action: n.action, trigger: n.trigger_key, publishedOn: n.published_on }));
  const r = await fetch(base + "/api/admin/field-notes", { method: "POST", headers: { "Content-Type": "application/json", "X-Reminder-Secret": secret }, body: JSON.stringify({ notes }), signal: AbortSignal.timeout(90000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw Object.assign(new Error("The website didn't accept the notes: " + (j.error || r.status)), { status: 502 });
  return { pushed: true, count: notes.length };
}
async function subscribers(pool) {
  return (await q(pool, "SELECT id, name, notes FROM prospects WHERE source = 'website pop-up' AND archived_at IS NULL AND COALESCE(unsubscribed_at, '') = ''"))
    .map((p) => ({ email: emailIn(p.notes, p.name), name: EMAIL_RE.test(p.name) ? "" : p.name })).filter((x) => x.email)
    .filter((x, i, a) => a.findIndex((y) => y.email === x.email) === i);
}

// ---------- 3. Diagnostic first pass ----------
const AREAS = [["strategy", "Strategy and Positioning"], ["program", "Program and Impact Evidence"], ["revenue", "Revenue and Financial Health"], ["leadership", "Leadership and Organizational Capacity"], ["operations", "Operations and Infrastructure"], ["partnerships", "Partnerships and Ecosystem"], ["governance", "Governance and Risk"]];
async function diagnostic(pool, dealId, files, context) {
  const { p, text } = await dealContext(pool, dealId);
  const docs = (files || []).filter((f) => f && f.data).slice(0, 12).map((f) => ({ name: clip(f.name, 120), mediaType: /pdf/i.test(f.type || f.name) ? "application/pdf" : "text/plain", data: String(f.data) }));
  if (!docs.length) throw Object.assign(new Error("Add at least one document (PDF or text)."), { status: 400 });
  const r = await AI.ask(pool, {
    maxTokens: 6000, json: true, docs,
    system: "You are preparing a first pass of an InstitutionalOS Diagnostic for the principal to verify. You never decide; you propose, with evidence, and you flag what the documents can't show.",
    prompt: `Read the attached documents for ${p.org || p.name} and prepare the first pass of the Diagnostic.

What the system already knows:
${text}
${context ? "\nThe principal's note: " + clip(context, 2000) : ""}

Score each of the seven areas 0-100 (0-39 fragile, 40-59 developing, 60-79 established, 80-100 strong) ONLY from evidence in the documents or the facts above. For each: the score, confidence (low/medium/high), two to four evidence points each citing the document name (and page or section when visible), and what's missing to be sure. Then propose the binding constraint (the one area most likely to break first and hold back the rest): name, why, evidence for, evidence against, confidence. Then a draft constraint memo (four to six short paragraphs, plain text, to the executive director and board). Then a draft 90-Day Improvement Plan: three to six actions, each with an owner role, a due week (1-13), and the evidence that will show it's done. Finally, five questions the principal should ask to verify.

Areas: ${AREAS.map((a) => a[0] + " = " + a[1]).join("; ")}.

JSON shape: {"areas": [{"key": "", "score": 0, "confidence": "", "evidence": [""], "missing": ""}], "constraint": {"area": "", "name": "", "why": "", "evidenceFor": [""], "evidenceAgainst": [""], "confidence": ""}, "memo": "", "plan": [{"action": "", "owner": "", "week": 0, "evidence": ""}], "questions": [""]}`,
  });
  const out = Object.assign({}, r, { docs: docs.map((d) => d.name), at: nowIso() });
  await pool.query("UPDATE pipeline SET ai_diagnostic = $1 WHERE id = $2", [JSON.stringify(out), dealId]);
  return out;
}

// ---------- 4. call notes ----------
async function callNotes(pool, dealId, notes) {
  if (String(notes || "").trim().length < 20) throw Object.assign(new Error("Paste your notes from the call first."), { status: 400 });
  const { p, contact, text } = await dealContext(pool, dealId);
  const r = await AI.ask(pool, {
    maxTokens: 2000, json: true,
    prompt: `Turn the principal's call notes into records and a follow-up email. Today is ${todayIso()}.

Deal so far:
${text}

Call notes:
${clip(notes, 12000)}

Return:
- summary: three to five lines for the deal record (dated, factual)
- stage: one of lead, discovery, assessment, engaged, graduated, referred, lost (the stage the deal should now be in)
- nextStep and nextStepDate (YYYY-MM-DD; a real date implied by the notes, or within 7 days if none)
- trigger: expansion, funder, founder, strain, transition, checkup, or "" if unclear
- problem: {presentingProblem, verifiedConstraint (what the notes suggest it really is, or "" if not yet clear), differs (true/false), atStake, whoPays, orgType, orgSize}
- followUp: {subject, body} a short follow-up from the principal to ${contact.name || "the contact"}: thank them, recap the two or three things that matter in their words, confirm the next step and date. No signature.

JSON shape: {"summary": "", "stage": "", "nextStep": "", "nextStepDate": "", "trigger": "", "problem": {"presentingProblem": "", "verifiedConstraint": "", "differs": false, "atStake": "", "whoPays": "", "orgType": "", "orgSize": ""}, "followUp": {"subject": "", "body": ""}}`,
  });
  return Object.assign(r, { contact });
}
async function applyCallNotes(pool, dealId, prop, who) {
  const p = await one(pool, "SELECT * FROM pipeline WHERE id = $1", [dealId]);
  if (!p) throw Object.assign(new Error("Deal not found."), { status: 404 });
  const stages = ["lead", "discovery", "assessment", "engaged", "graduated", "referred", "lost"];
  const stage = stages.includes(prop.stage) ? prop.stage : p.stage;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(prop.nextStepDate || "") ? prop.nextStepDate : p.next_step_date;
  const notes = (p.notes ? p.notes + "\n\n" : "") + `${todayIso()} call: ${clip(prop.summary, 3000)}`;
  await pool.query("UPDATE pipeline SET stage = $1, next_step = $2, next_step_date = $3, notes = $4, trigger_key = CASE WHEN $5 <> '' THEN $5 ELSE trigger_key END, updated_at = $6 WHERE id = $7",
    [stage, clip(prop.nextStep || p.next_step, 300), date || "", notes.slice(-20000), ["expansion", "funder", "founder", "strain", "transition", "checkup"].includes(prop.trigger) ? prop.trigger : "", nowIso(), dealId]);
  const pr = prop.problem || {};
  let problemId = null;
  if (pr.presentingProblem) {
    problemId = newId();
    await pool.query(`INSERT INTO problem_log (id, logged_on, kind, organization, org_type, org_size, trigger_key, presenting_problem, verified_constraint, differs, at_stake, who_pays, notes, created_at)
      VALUES ($1,$2,'interview',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [problemId, todayIso(), p.org || p.name, clip(pr.orgType, 80), clip(pr.orgSize, 80), prop.trigger || "", clip(pr.presentingProblem, 600), clip(pr.verifiedConstraint, 600), pr.verifiedConstraint ? !!pr.differs : null, clip(pr.atStake, 400), clip(pr.whoPays, 200), "From call notes (" + who + ")", nowIso()]);
  }
  let outboxId = null;
  if (prop.followUp && prop.followUp.body && prop.sendFollowUp !== false) {
    const c = prop.contact || {};
    outboxId = await draft(pool, { to: prop.to || c.email || "", toName: c.name || "", subject: prop.followUp.subject || "Following up on our conversation", body: prop.followUp.body.trim() + signature(), purpose: "Call follow-up (AI draft)", subjectKind: "pipeline", subjectId: dealId, subjectLabel: p.org || p.name });
  }
  return { stage, nextStepDate: date, problemId, outboxId };
}

// ---------- 5. reading replies ----------
async function onReply(pool, o, reply) {
  if (!(await AI.enabled(pool))) return;
  const label = o.subject_label || (o.run_id ? ((await one(pool, "SELECT subject_label FROM proc_runs WHERE id = $1", [o.run_id])) || {}).subject_label : "") || "";
  let r;
  try {
    r = await AI.ask(pool, {
      maxTokens: 1200, json: true,
      prompt: `Someone replied to a message the practice sent. Classify the reply and draft the principal's answer.

Our message (subject "${o.subject}"):
${clip(o.body, 3000)}

Their reply from ${reply.from}:
${clip(reply.text, 6000)}

kind: "yes" (they want to move ahead), "scheduling" (picking a time), "question", "not_now", "no", "unsubscribe" (asks to stop emails), "out_of_office", or "other".
summary: one line in plain words.
answer: a short reply from the principal (skip it, empty strings, for out_of_office and unsubscribe). If scheduling, offer the booking link ${links().booking || ""}. No signature.

JSON shape: {"kind": "", "summary": "", "answer": {"subject": "", "body": ""}}`,
    });
  } catch (e) { return; }
  await pool.query("UPDATE proc_outbox SET reply_kind = $1, reply_summary = $2 WHERE id = $3", [clip(r.kind, 20), clip(r.summary, 300), o.id]);
  if (r.kind === "unsubscribe") await unsubscribe(pool, reply.addr);
  if (r.answer && r.answer.body && !["unsubscribe", "out_of_office"].includes(r.kind)) {
    await draft(pool, { kind: "reply", to: reply.addr, toName: reply.from.replace(/<.*>/, "").trim(), subject: /^re:/i.test(o.subject) ? o.subject : "Re: " + o.subject, body: r.answer.body.trim() + signature(),
      purpose: "Answer to a reply (AI draft)", subjectKind: o.subject_kind || (o.run_id ? "run" : ""), subjectId: o.subject_id || o.run_id || "", subjectLabel: label, runId: o.run_id, stepIndex: o.step_index, threadId: o.gmail_thread_id, replyTo: reply.messageId });
  }
  // A yes or a scheduling reply moves an early-stage deal to "Discovery call".
  if (["yes", "scheduling"].includes(r.kind)) {
    const run = o.run_id ? await one(pool, "SELECT subject_kind, subject_id FROM proc_runs WHERE id = $1", [o.run_id]) : null;
    const dealId = o.subject_kind === "pipeline" ? o.subject_id : run && run.subject_kind === "pipeline" ? run.subject_id : null;
    if (dealId) {
      const moved = await q(pool, "UPDATE pipeline SET stage = 'discovery', updated_at = $1 WHERE id = $2 AND stage = 'lead' RETURNING id", [nowIso(), dealId]);
      if (moved.length && o.run_id) await pool.query("INSERT INTO proc_activity (id, run_id, at, text) VALUES ($1,$2,$3,$4)", [newId(), o.run_id, nowIso(), "Moved to Discovery call: they replied " + (r.kind === "yes" ? "yes" : "to pick a time")]);
    }
  }
}
async function unsubscribe(pool, addr) {
  addr = String(addr || "").toLowerCase(); if (!addr) return 0;
  const rows = await q(pool, "UPDATE prospects SET unsubscribed_at = $1 WHERE source = 'website pop-up' AND COALESCE(unsubscribed_at, '') = '' AND (lower(notes) LIKE $2 OR lower(name) = $3) RETURNING id", [nowIso(), "%" + addr + "%", addr]);
  return rows.length;
}
// Field-note emails go out one by one without threads, so "unsubscribe"
// replies are found by searching the inbox.
async function scanUnsubscribes(pool) {
  const s = await GMAIL.sender(pool).catch(() => null); if (!s) return { checked: 0 };
  const subs = new Set((await subscribers(pool)).map((x) => x.email)); if (!subs.size) return { checked: 0 };
  let found = 0;
  try {
    const list = await GMAIL.gapi(pool, s.account, "/gmail/v1/users/me/messages?q=" + encodeURIComponent("unsubscribe newer_than:14d -from:me") + "&maxResults=50");
    for (const m of list.messages || []) {
      const msg = await GMAIL.gapi(pool, s.account, `/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From`);
      const from = (((msg.payload || {}).headers || []).find((h) => /^from$/i.test(h.name)) || {}).value || "";
      const addr = (((/<([^>]+)>/.exec(from) || [])[1]) || from).trim().toLowerCase();
      if (subs.has(addr)) found += await unsubscribe(pool, addr);
    }
  } catch (e) { return { error: e.message }; }
  return { found };
}

// ---------- 6. pre-call brief ----------
async function precall(pool, dealId) {
  const { p, text } = await dealContext(pool, dealId);
  const r = await AI.ask(pool, {
    maxTokens: 1500, json: true,
    prompt: `The principal has a call with ${p.org || p.name} (${p.next_step || "next step"}${p.next_step_date ? " on " + p.next_step_date : ""}). Write a one-page pre-call brief from what the system holds.

${text}

Return: headline (one line: who and why now); numbers (two to five short facts with figures, only from the data); heard (what they've told us, one or two lines); likelyConstraint (a hypothesis, labeled as such); questions (exactly three, open, specific to them); goal (what a good outcome of this call is); watchFor (one line).

JSON shape: {"headline": "", "numbers": [""], "heard": "", "likelyConstraint": "", "questions": ["", "", ""], "goal": "", "watchFor": ""}`,
  });
  const out = Object.assign({}, r, { at: nowIso(), forDate: p.next_step_date || "" });
  await pool.query("UPDATE pipeline SET ai_precall = $1, ai_precall_for = $2 WHERE id = $3", [JSON.stringify(out), p.next_step_date || todayIso(), dealId]);
  return out;
}

// ---------- 7. foundation ----------
async function grantRead(pool, appId) {
  const a = await one(pool, "SELECT * FROM gm_applications WHERE id = $1", [appId]);
  if (!a) throw Object.assign(new Error("Application not found."), { status: 404 });
  const prog = a.program_id ? await one(pool, "SELECT * FROM gm_programs WHERE id = $1", [a.program_id]) : null;
  const scan = await scanFor(pool, { ein: a.ein, org: a.org_name });
  const r = await AI.ask(pool, {
    maxTokens: 2000, json: true,
    system: "You do a first read of grant applications for a foundation's reviewers. You never decide; you organize the evidence and flag what to verify.",
    prompt: `First read of a grant application.

Program: ${prog ? prog.name : "(none)"}. Purpose: ${prog ? clip(prog.purpose, 1500) : ""}. Eligibility: ${prog ? clip(prog.eligibility, 1500) : ""}. Maximum award: ${prog ? prog.max_award || "" : ""}.
Criteria: ${prog ? clip(prog.criteria, 3000) : "(none listed)"}

Applicant: ${a.org_name} (EIN ${a.ein || "?"}), budget ${a.annual_budget || "?"}, requesting ${a.amount_requested || "?"} for "${a.project_title || ""}".
Summary: ${clip(a.summary, 4000)}
Answers: ${clip(typeof a.answers === "string" ? a.answers : JSON.stringify(a.answers || {}), 8000)}
${scanText(scan)}

Return: summary (three lines); criteria (each criterion: how the application meets it, rated "strong", "partial", "weak", or "not addressed"); strengths (up to three); concerns (up to three, including any eligibility or budget-ratio flags); questions (up to four to ask the applicant); lean ("advance", "discuss", or "decline"), with a one-line reason.

JSON shape: {"summary": "", "criteria": [{"criterion": "", "assessment": "", "rating": ""}], "strengths": [""], "concerns": [""], "questions": [""], "lean": "", "leanReason": ""}`,
  });
  const out = Object.assign({}, r, { at: nowIso() });
  await pool.query("UPDATE gm_applications SET ai_read = $1 WHERE id = $2", [JSON.stringify(out), appId]);
  return out;
}
async function reportSummary(pool, reportId) {
  const rp = await one(pool, "SELECT r.*, a.org_name, a.project_title, a.amount_awarded FROM gm_reports r JOIN gm_applications a ON a.id = r.application_id WHERE r.id = $1", [reportId]);
  if (!rp || !String(rp.summary || "").trim()) return null;
  const r = await AI.ask(pool, {
    maxTokens: 900, json: true,
    prompt: `Summarize a grantee's ${rp.kind} report for the foundation's board.
Grantee: ${rp.org_name}; project "${rp.project_title}"; award ${rp.amount_awarded || "?"}.
Report:
${clip(rp.summary, 10000)}
Return: summary (two or three lines), outcomes (facts with numbers, only from the report), risks (anything off track), followUp (one suggested step for the foundation, or "").
JSON shape: {"summary": "", "outcomes": [""], "risks": [""], "followUp": ""}`,
  });
  const out = Object.assign({}, r, { at: nowIso() });
  await pool.query("UPDATE gm_reports SET ai_summary = $1 WHERE id = $2", [JSON.stringify(out), reportId]);
  return out;
}
async function minutesDraft(pool, meetingId, notes) {
  const m = await one(pool, "SELECT * FROM gov_meetings WHERE id = $1", [meetingId]);
  if (!m) throw Object.assign(new Error("Meeting not found."), { status: 404 });
  const members = await q(pool, "SELECT id, name, role FROM gov_members WHERE archived_at IS NULL");
  const att = parseJson(m.attendance, {}) || {};
  const motions = await q(pool, "SELECT * FROM gov_motions WHERE meeting_id = $1 ORDER BY created_at", [meetingId]);
  const text = await AI.ask(pool, {
    maxTokens: 2500,
    prompt: `Draft board meeting minutes in standard nonprofit form from the facts below. Plain text, no markdown symbols. Include: organization, meeting type, date, time, place; called to order (by whom, if known); attendance (present, absent, guests) and whether quorum was present; conflicts of interest declared; each agenda item with a short neutral summary of discussion; each motion with mover, seconder, and vote; next meeting if mentioned; adjournment. Record decisions, not debate. Where a fact is missing, write [confirm] rather than inventing it.

Organization: ${(ORG.org || {}).name || ""}
Meeting: ${m.title} (${m.kind}), ${m.starts_at}, ${m.location || "location not recorded"}
Agenda:
${m.agenda || "(none)"}
Attendance recorded: ${members.map((x) => `${x.name} (${x.role}): ${att[x.id] || "not recorded"}`).join("; ") || "(none)"}
Guests: ${m.guests || "none"}
Conflicts declared: ${m.conflicts_declared || "none recorded"}
Motions recorded: ${motions.map((x) => `"${x.motion}" moved by ${x.moved_by || "?"}, seconded by ${x.seconded_by || "?"}, ${x.result || "?"} (${x.yes_votes || 0}-${x.no_votes || 0}-${x.abstain_votes || 0})`).join("; ") || "(none)"}

Secretary's notes:
${clip(notes, 15000)}`,
  });
  return { minutes: text };
}

// ---------- 8. ask the system ----------
async function askSystem(pool, question) {
  question = String(question || "").trim();
  if (question.length < 4) throw Object.assign(new Error("Ask a question."), { status: 400 });
  const pipe = await q(pool, "SELECT org, name, stage, track, next_step, next_step_date, deal_value, source, trigger_key, ios_overall, ios_constraint, updated_at, created_at FROM pipeline WHERE archived_at IS NULL ORDER BY updated_at DESC NULLS LAST LIMIT 150");
  const pros = await q(pool, "SELECT name, org, source, status, interest, trigger_key, created_at, ai_brief FROM prospects WHERE archived_at IS NULL ORDER BY created_at DESC LIMIT 150");
  const inv = await q(pool, "SELECT i.*, p.org FROM invoices i LEFT JOIN pipeline p ON p.id = i.pipeline_id WHERE i.archived_at IS NULL ORDER BY i.issued_date DESC NULLS LAST LIMIT 80");
  const runs = await q(pool, "SELECT process_name, subject_label, started_on, completed_on, steps FROM proc_runs WHERE archived_at IS NULL AND NOT skipped ORDER BY started_on DESC LIMIT 60");
  const drafts = await q(pool, "SELECT purpose, subject, to_email, created_at FROM proc_outbox WHERE status = 'draft' LIMIT 60");
  const probs = await q(pool, "SELECT logged_on, organization, trigger_key, presenting_problem, verified_constraint FROM problem_log WHERE archived_at IS NULL ORDER BY logged_on DESC LIMIT 60");
  const scanTop = await q(pool, "SELECT name, city, state, public_score, growth_flag, situation, fit, status FROM market_orgs WHERE fit > 0 ORDER BY fit DESC LIMIT 40");
  const grants = await q(pool, "SELECT org_name, project_title, status, amount_requested, amount_awarded, created_at FROM gm_applications WHERE archived_at IS NULL ORDER BY created_at DESC LIMIT 60");
  const gifts = await q(pool, "SELECT d.name, g.amount, g.received_on FROM fr_gifts g JOIN fr_donors d ON d.id = g.donor_id WHERE g.archived_at IS NULL ORDER BY g.received_on DESC LIMIT 60");
  const today = todayIso();
  const data = {
    today,
    pipeline: pipe.map((x) => ({ org: x.org || x.name, stage: x.stage, offer: x.track, nextStep: x.next_step, nextStepDate: x.next_step_date, value: Number(x.deal_value) || 0, source: x.source, situation: x.trigger_key, healthIndex: x.ios_overall == null ? null : Math.round(x.ios_overall), constraint: x.ios_constraint, lastUpdated: String(x.updated_at || "").slice(0, 10), created: String(x.created_at || "").slice(0, 10) })),
    prospects: pros.map((x) => ({ name: EMAIL_RE.test(x.name) ? "(email only)" : x.name, org: x.org, source: x.source, status: x.status, wants: x.interest, situation: x.trigger_key, created: String(x.created_at || "").slice(0, 10), fit: (parseJson(x.ai_brief, {}) || {}).fit || "" })),
    invoices: inv.map((x) => ({ client: x.org || "", offering: x.offering || "", amount: Number(x.amount) || 0, status: x.status, issued: x.issued_date, due: x.due_date, paid: x.paid_date })),
    checklists: runs.map((r) => { const st = parseJson(r.steps, []) || []; const open = st.filter((s) => !s.doneOn); return { name: r.process_name, for: r.subject_label, started: r.started_on, finished: r.completed_on || null, openSteps: open.length, overdue: open.filter((s) => s.dueOn && s.dueOn < today).map((s) => s.text).slice(0, 5) }; }),
    messagesWaitingForApproval: drafts.map((d) => ({ purpose: d.purpose, subject: d.subject, to: d.to_email })),
    problemLog: probs, marketScanTopFit: scanTop, grants, gifts,
  };
  const answer = await AI.ask(pool, {
    maxTokens: 1200,
    system: "You answer the principal's questions about the practice using ONLY the data provided. If the data can't answer it, say exactly what's missing. Be concise: a direct answer first, then a short list if helpful. Plain text; simple dashes for lists; no markdown headings or bold.",
    prompt: `Question: ${clip(question, 600)}\n\nData (JSON, as of ${today}):\n${JSON.stringify(data).slice(0, 90000)}`,
  });
  return { answer };
}

// ---------- background work (from the automation pass) ----------
async function tick(pool) {
  if (!(await AI.enabled(pool))) return { skipped: "AI off or not set up" };
  const out = { leads: 0, precall: 0, reports: 0, note: false };
  const since = new Date(Date.now() - 14 * 864e5).toISOString();
  for (const p of await q(pool, "SELECT id, source FROM prospects WHERE archived_at IS NULL AND COALESCE(ai_at, '') = '' AND created_at >= $1 AND status = 'new' ORDER BY created_at DESC LIMIT 4", [since])) {
    if (!WEB_SOURCES.test(p.source || "")) continue;
    try { await leadBrief(pool, p.id); out.leads++; } catch (e) { out.error = e.message; if (e.status === 429) return out; }
  }
  const today = todayIso(), tomorrow = addDays(today, 1);
  for (const d of await q(pool, "SELECT id FROM pipeline WHERE archived_at IS NULL AND stage IN ('lead','discovery','assessment') AND next_step_date IN ($1, $2) AND COALESCE(ai_precall_for, '') <> next_step_date LIMIT 3", [today, tomorrow])) {
    try { await precall(pool, d.id); out.precall++; } catch (e) { out.error = e.message; if (e.status === 429) return out; }
  }
  for (const r of await q(pool, "SELECT id FROM gm_reports WHERE COALESCE(received_on, '') <> '' AND COALESCE(summary, '') <> '' AND COALESCE(ai_summary, '') = '' LIMIT 3")) {
    try { if (await reportSummary(pool, r.id)) out.reports++; } catch (e) { out.error = e.message; if (e.status === 429) return out; }
  }
  // One field note draft a month, after the 3rd.
  if (new Date().getUTCDate() >= 3 && !(await one(pool, "SELECT 1 FROM field_notes WHERE created_at >= $1", [today.slice(0, 7) + "-01"]))) {
    try { await fieldNoteDraft(pool); out.note = true; } catch (e) { out.error = e.message; }
  }
  out.unsubscribes = await scanUnsubscribes(pool);
  return out;
}

// ---------- routes ----------
function mount(app, { pool, requireAuth }) {
  GMAIL.onReply(onReply);
  const wrap = (fn) => async (req, res) => { try { await fn(req, res); } catch (err) { if (!err.status) console.error("ai", err); res.status(err.status || 500).json({ error: String(err.message || err) }); } };
  const who = async (req) => { const s = req.session || {}; if (s.userId) { const u = await one(pool, "SELECT name, email FROM app_users WHERE id = $1", [s.userId]); if (u) return u.name || u.email; } return "Owner"; };

  app.get("/api/ai/status", requireAuth, wrap(async (req, res) => res.json(await AI.status(pool))));
  app.post("/api/ai/lead/:id", requireAuth, wrap(async (req, res) => res.json(await leadBrief(pool, req.params.id, { force: true }))));
  app.get("/api/ai/deal/:id", requireAuth, wrap(async (req, res) => {
    const p = await one(pool, "SELECT id, name, org, stage, next_step, next_step_date, ai_precall, ai_diagnostic FROM pipeline WHERE id = $1", [req.params.id]);
    if (!p) return res.status(404).json({ error: "Deal not found." });
    res.json({ deal: { id: p.id, name: p.name, org: p.org, stage: p.stage, nextStep: p.next_step, nextStepDate: p.next_step_date }, precall: parseJson(p.ai_precall, null), diagnostic: parseJson(p.ai_diagnostic, null) });
  }));
  app.post("/api/ai/precall/:id", requireAuth, wrap(async (req, res) => res.json(await precall(pool, req.params.id))));
  app.post("/api/ai/diagnostic/:id", requireAuth, wrap(async (req, res) => res.json(await diagnostic(pool, req.params.id, (req.body || {}).files, (req.body || {}).context))));
  app.post("/api/ai/call-notes/:id", requireAuth, wrap(async (req, res) => res.json(await callNotes(pool, req.params.id, (req.body || {}).notes))));
  app.post("/api/ai/call-notes/:id/apply", requireAuth, wrap(async (req, res) => res.json(await applyCallNotes(pool, req.params.id, req.body || {}, await who(req)))));
  app.post("/api/ai/ask", requireAuth, wrap(async (req, res) => res.json(await askSystem(pool, (req.body || {}).question))));
  app.post("/api/ai/grant-read/:id", requireAuth, wrap(async (req, res) => res.json(await grantRead(pool, req.params.id))));
  app.get("/api/ai/grant-read/:id", requireAuth, wrap(async (req, res) => {
    const a = await one(pool, "SELECT ai_read FROM gm_applications WHERE id = $1", [req.params.id]);
    const reps = await q(pool, "SELECT id, kind, ai_summary FROM gm_reports WHERE application_id = $1", [req.params.id]);
    res.json({ read: a ? parseJson(a.ai_read, null) : null, reports: reps.filter((r) => r.ai_summary).map((r) => ({ id: r.id, kind: r.kind, summary: parseJson(r.ai_summary, null) })) });
  }));
  app.post("/api/ai/report-summary/:id", requireAuth, wrap(async (req, res) => { const r = await reportSummary(pool, req.params.id); if (!r) return res.status(409).json({ error: "This report has no text to summarize yet." }); res.json(r); }));
  app.post("/api/ai/minutes/:meetingId", requireAuth, wrap(async (req, res) => res.json(await minutesDraft(pool, req.params.meetingId, (req.body || {}).notes))));

  // field notes
  app.get("/api/ai/field-notes", requireAuth, wrap(async (req, res) => {
    const notes = (await q(pool, "SELECT * FROM field_notes WHERE status <> 'archived' ORDER BY status = 'draft' DESC, created_at DESC LIMIT 100")).map(noteApi);
    const subs = await subscribers(pool);
    const unsub = (await one(pool, "SELECT count(*)::int AS n FROM prospects WHERE source = 'website pop-up' AND COALESCE(unsubscribed_at, '') <> ''")) || { n: 0 };
    res.json({ notes, subscribers: subs.length, unsubscribed: unsub.n });
  }));
  app.post("/api/ai/field-notes/draft", requireAuth, wrap(async (req, res) => res.json({ item: await fieldNoteDraft(pool) })));
  app.post("/api/ai/field-notes", requireAuth, wrap(async (req, res) => {
    const id = newId();
    await pool.query("INSERT INTO field_notes (id, title, status, source, created_at, updated_at) VALUES ($1, $2, 'draft', 'manual', $3, $3)", [id, clip((req.body || {}).title || "New field note", 160), nowIso()]);
    res.status(201).json({ item: noteApi(await one(pool, "SELECT * FROM field_notes WHERE id = $1", [id])) });
  }));
  app.patch("/api/ai/field-notes/:id", requireAuth, wrap(async (req, res) => {
    const b = req.body || {}, sets = [], vals = [];
    for (const [k, col] of Object.entries(NOTE_FIELDS)) if (b[k] != null) { vals.push(clip(b[k], 1200)); sets.push(`${col} = $${vals.length}`); }
    if (!sets.length) return res.status(400).json({ error: "Nothing to change." });
    vals.push(nowIso(), req.params.id);
    await pool.query(`UPDATE field_notes SET ${sets.join(", ")}, updated_at = $${vals.length - 1} WHERE id = $${vals.length}`, vals);
    const n = await one(pool, "SELECT * FROM field_notes WHERE id = $1", [req.params.id]);
    if (n && n.status === "published") await pushNotesToSite(pool).catch(() => {});
    res.json({ item: n ? noteApi(n) : null });
  }));
  app.post("/api/ai/field-notes/:id/publish", requireAuth, wrap(async (req, res) => {
    const n = await one(pool, "SELECT * FROM field_notes WHERE id = $1", [req.params.id]);
    if (!n) return res.status(404).json({ error: "Not found." });
    if (!n.title || !n.signal || !n.constraint_text || !n.action) return res.status(400).json({ error: "Fill in the title, signal, constraint, and action first." });
    await pool.query("UPDATE field_notes SET status = 'published', published_on = CASE WHEN published_on = '' THEN $1 ELSE published_on END, updated_at = $2 WHERE id = $3", [todayIso(), nowIso(), n.id]);
    let site;
    try { site = await pushNotesToSite(pool); } catch (e) { site = { pushed: false, reason: e.message }; }
    res.json({ ok: true, site });
  }));
  app.post("/api/ai/field-notes/:id/unpublish", requireAuth, wrap(async (req, res) => {
    await pool.query("UPDATE field_notes SET status = 'draft', updated_at = $1 WHERE id = $2", [nowIso(), req.params.id]);
    let site; try { site = await pushNotesToSite(pool); } catch (e) { site = { pushed: false, reason: e.message }; }
    res.json({ ok: true, site });
  }));
  app.delete("/api/ai/field-notes/:id", requireAuth, wrap(async (req, res) => {
    await pool.query("UPDATE field_notes SET status = 'archived', updated_at = $1 WHERE id = $2", [nowIso(), req.params.id]);
    await pushNotesToSite(pool).catch(() => {});
    res.json({ ok: true });
  }));
  // One broadcast draft to every subscriber; it waits for approval like any message.
  app.post("/api/ai/field-notes/:id/email", requireAuth, wrap(async (req, res) => {
    const n = await one(pool, "SELECT * FROM field_notes WHERE id = $1", [req.params.id]);
    if (!n || n.status !== "published") return res.status(409).json({ error: "Publish the note before emailing it." });
    const subs = await subscribers(pool);
    if (!subs.length) return res.status(409).json({ error: "No one has signed up yet." });
    const site = (links().website || "https://franklyinspired.associates").replace(/\/?$/, "/");
    const body = `Hi {first},\n\nA new field note: ${n.title}\n\nThe signal: ${n.signal}\n\nWhat organizations usually assume: ${n.assumption}\n\nWhat it often turns out to be: ${n.constraint_text}\n\nWhat to check: ${n.evidence}\n\nA first 90-day action: ${n.action}\n\nMore field notes: ${site}insights\nWhere does your organization stand? The free check-up takes seven minutes: ${(links().freeCheckup || site + "assessment")}` + signature() + `\n\nYou're getting this because you signed up for field notes on our website. Reply "unsubscribe" and I'll take you off the list.`;
    const existing = await one(pool, "SELECT id FROM proc_outbox WHERE subject_kind = 'fieldnote' AND subject_id = $1 AND status = 'draft'", [n.id]);
    if (existing) await pool.query("UPDATE proc_outbox SET status = 'discarded' WHERE id = $1", [existing.id]);
    const id = await draft(pool, { kind: "broadcast", to: `${subs.length} field notes subscribers`, subject: "Field note: " + n.title, body, purpose: "Field note to subscribers", subjectKind: "fieldnote", subjectId: n.id, subjectLabel: n.title, recipients: subs });
    res.json({ ok: true, outboxId: id, recipients: subs.length });
  }));
}

module.exports = { mount, tick, onReply, leadBrief, fieldNoteDraft, precall, diagnostic, callNotes, applyCallNotes, grantRead, reportSummary, minutesDraft, askSystem, subscribers, unsubscribe };
