"use strict";
// Check-up follow-up: the loop for a visitor who takes the free check-up on
// the website and leaves an email.
//
// When the lead arrives, a short checklist starts on that prospect (it shows
// in Checklists, on Projects & Team, and in the morning brief):
//   1. Send a personal first note (today; the AI draft waits in the Outbox)
//   2. Day 3: send one resource for their path
//   3. Day 10: a final check-in
// Steps tick themselves as notes to that address go out. The checklist closes
// as soon as they reply, book, are marked responded or meeting, unsubscribe,
// or the prospect is archived. Day 3 and day 10 notes are drafted only after
// the first note has gone out. NOTHING is sent from here: every note waits
// for the owner's approval. This is personal follow-up, not a mailing list.

const crypto = require("crypto");
const { ORG } = require("./accounts");

const NAME = "Check-up follow-up";
const SOURCES = /assessment tool|scorecard|check-?up/i;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const STEPS = [
  { text: "Send a personal first note (draft waiting in the Outbox)", days: 0 },
  { text: "Day 3: send one resource for their path", days: 3 },
  { text: "Day 10: a short, final check-in", days: 10 },
];
const PATHS = { build: "Build: get the foundation right", fund: "Fund: get ready for bigger money", sustain: "Sustain: make it last beyond one person" };
const TRIGGER_PATH = { expansion: "fund", funder: "fund", strain: "fund", founder: "sustain", transition: "sustain" };

const nyToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const emailIn = (...xs) => { const m = EMAIL_RE.exec(xs.join(" ")); return m ? m[0].toLowerCase() : ""; };
const firstName = (p) => (EMAIL_RE.test(p.name || "") ? "" : String(p.name || "").trim().split(/\s+/)[0]);
const pathOf = (p) => p.org_stage || TRIGGER_PATH[p.trigger_key] || "";
const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
const signature = () => { const o = ORG.org || {}, l = o.leader || {}; return `\n\n${l.name || ""}${l.title ? "\n" + l.title : ""}\n${o.name || ""}`.replace(/\n{3,}/g, "\n\n"); };

const isCheckupLead = (source) => SOURCES.test(String(source || ""));

// ---------- the debrief call ----------
// A 30-minute script built from what this lead's results page told them
// (the lines the website writes into the prospect's notes), added to the
// notes once so it's there when the call is booked. The rule for the one
// recommendation, after the call: the Diagnostic when the gap is confirmed
// (they can't show the evidence), it's under their path's minimum, and the
// decision is within six months; otherwise the free 90-day step and a
// re-check in 90 days.
const DEBRIEF_MARK = "DEBRIEF SCRIPT";
const VERB = {
  expansion: "the new site or program", funder: "the larger grant", founder: "handing work off",
  strain: "your next hire", transition: "the leadership change",
};
const line = (notes, label) => { const m = new RegExp("^" + label + ":\\s*(.+)$", "mi").exec(notes || ""); return m ? m[1].trim() : ""; };
function debriefScript(p) {
  const n = p.notes || "";
  const gap = line(n, "Gap that will break first \\(check-up rule\\)") || "the lowest-scoring area";
  const situation = line(n, "Situation");
  const answer = line(n, "Short answer shown");
  const rec = line(n, "Recommendation shown");
  const legacy = /Legacy Readiness:\s*(\d) of 6(?:\s*\(missing:\s*([^)]*)\))?/i.exec(n);
  const met = legacy ? Number(legacy[1]) : null;
  const about = VERB[p.trigger_key] || "the decision in front of you";
  const out = [
    `${DEBRIEF_MARK} (30 minutes; built from their check-up)`,
    `1. Their question (2 min). ${situation ? `They picked: "${situation}." ` : ""}Is that still the decision in front of you, and by when? Who else decides?`,
    `2. Confirm the gap (8 min). Their answers point to ${gap}. Ask: "What could you show me there?" If they can't name a document, the gap is real.`,
    `3. What it's costing (8 min). "If ${gap} stays where it is for six more months, what happens to ${about}? Who notices first: staff, the board, or a funder?"`,
  ];
  if (met != null && met < 4) out.push(`4. Legacy (5 min). They have ${met} of 6 markers${legacy[2] ? ` (missing: ${legacy[2]})` : ""}. "Which missing one worries you most?"`);
  const k = out.length; // the header line counts, so this is the next step's number
  out.push(
    `${k}. One recommendation (5 min). ${answer ? `Their results said: "${answer}" ` : ""}${rec ? `Recommended on the page: ${rec}. ` : ""}Rule: recommend the Diagnostic when the gap is confirmed, it's under their path's minimum, and the decision is within six months. Otherwise give them the free 90-day step and set a 90-day re-check.`,
    `${k + 1}. Close (2 min). Diagnostic: "Would it help if I sent a one-page proposal by tomorrow?" Not yet: "I'll send the 90-day step in writing and check back in 90 days." Log the outcome on the deal.`
  );
  return out.join("\n");
}
async function addDebriefScript(pool, p) {
  if ((p.notes || "").includes(DEBRIEF_MARK)) return;
  await pool.query("UPDATE prospects SET notes = COALESCE(notes, '') || $2 WHERE id = $1 AND COALESCE(notes, '') NOT LIKE '%' || $3 || '%'", [p.id, "\n\n" + debriefScript(p), DEBRIEF_MARK]);
}

// Start the loop for a new prospect. Safe to call twice.
async function start(pool, prospectId) {
  const p = (await pool.query("SELECT * FROM prospects WHERE id = $1", [prospectId])).rows[0];
  if (!p || !isCheckupLead(p.source)) return null;
  const email = emailIn(p.name, p.notes);
  if (!email) return null;
  const ex = (await pool.query("SELECT id FROM proc_runs WHERE process_name = $1 AND subject_kind = 'prospect' AND subject_id = $2", [NAME, p.id])).rows[0];
  if (ex) return ex.id;
  const today = nyToday(), id = crypto.randomUUID(), now = new Date().toISOString();
  const label = [EMAIL_RE.test(p.name) ? "" : p.name, p.org].filter(Boolean).join(", ") || email;
  const steps = STEPS.map((s) => ({ text: s.text, dueOn: addDays(today, s.days), doneOn: "", by: "" }));
  await pool.query(`INSERT INTO proc_runs (id, process_id, process_name, subject_kind, subject_id, subject_label, started_on, steps, owner, created_at, contact_name, contact_email)
    VALUES ($1, NULL, $2, 'prospect', $3, $4, $5, $6, '', $7, $8, $9)`,
  [id, NAME, p.id, label, today, JSON.stringify(steps), now, EMAIL_RE.test(p.name) ? "" : p.name, email]);
  await pool.query("INSERT INTO proc_activity (id, run_id, at, text) VALUES ($1, $2, $3, $4)", [crypto.randomUUID(), id, now, "Started when the check-up lead arrived from the website."]).catch(() => {});
  await addDebriefScript(pool, p).catch(() => {});
  // The AI brief and first-note draft (never sent; waits in the Outbox).
  try {
    const AIF = require("./ai-features");
    if (await require("./ai").enabled(pool)) await AIF.leadBrief(pool, p.id);
    else await fallbackFirstNote(pool, p, email);
  } catch (e) { await fallbackFirstNote(pool, p, email).catch(() => {}); }
  return id;
}

// Without AI: a plain first note to edit, so the loop still has a draft.
async function fallbackFirstNote(pool, p, email) {
  const has = (await pool.query("SELECT 1 FROM proc_outbox WHERE subject_kind = 'prospect' AND subject_id = $1 AND status = 'draft'", [p.id])).rows[0];
  if (has) return;
  const L = ORG.links || {};
  const body = `Hi${firstName(p) ? " " + firstName(p) : ""},\n\nThanks for taking the free check-up${p.org ? " for " + p.org : ""}. I read your results. [One specific observation about their lowest area.]\n\nIf it would help, I'm glad to spend 20 minutes walking through what the scores suggest and the gap most likely to break first.${L.booking ? " You can pick a time here: " + L.booking : ""}` + signature();
  await draftNote(pool, { email, p, subject: "Your check-up results", body, purpose: "First note (draft to edit)" });
}

async function draftNote(pool, { email, p, subject, body, purpose, runId, stepIndex }) {
  await pool.query(`INSERT INTO proc_outbox (id, run_id, step_index, kind, to_email, to_name, subject, body, created_at, purpose, subject_kind, subject_id, subject_label, ai)
    VALUES ($1, $2, $3, 'first', $4, $5, $6, $7, $8, $9, 'prospect', $10, $11, $12)`,
  [crypto.randomUUID(), runId || null, stepIndex == null ? null : stepIndex, email, EMAIL_RE.test(p.name) ? "" : p.name, String(subject).slice(0, 200), String(body).slice(0, 20000), new Date().toISOString(), purpose, p.id, String(p.org || p.name).slice(0, 200), /AI/.test(purpose)]);
}

// Day 3 and day 10 notes, written only once the first note has gone out.
async function followNote(pool, p, email, run, idx) {
  const path = PATHS[pathOf(p)] || "";
  const L = ORG.links || {};
  const fn = firstName(p);
  let subject = idx === 1 ? "One resource for where you are" : "Closing the loop";
  let body = idx === 1
    ? `Hi${fn ? " " + fn : ""},\n\n${path ? `Your check-up pointed to the ${path.split(":")[0]} path (${path.split(": ")[1]}). ` : ""}Here is one resource that organizations in that spot tend to find useful: [link to a field note or guide for their path].\n\nNo need to reply unless it's useful.`
    : `Hi${fn ? " " + fn : ""},\n\nA last note from me on your check-up. If the timing is ever right to look at the gap most likely to break first, I'm glad to talk.${L.booking ? " " + L.booking : ""} Either way, I won't keep writing.`;
  let purpose = idx === 1 ? "Day 3 resource (draft to edit)" : "Day 10 check-in (draft to edit)";
  try {
    const AI = require("./ai");
    if (await AI.enabled(pool)) {
      const r = await AI.ask(pool, {
        maxTokens: 700, json: true,
        prompt: `Write a short personal follow-up from the principal of a nonprofit consulting practice to someone who took his free organizational check-up ${idx === 1 ? "three" : "ten"} days ago and has not replied.
Who: ${fn || "unknown first name"}${p.org ? " at " + p.org : ""}. Path: ${path || "not stated"}. Situation they named: ${p.trigger_key || "not stated"}.
What the tool recorded:
${String(p.notes || "").slice(0, 2500)}
${idx === 1 ? `Purpose: offer ONE useful resource for their path (leave a placeholder "[link]" for the resource; the principal picks it). Field notes live at ${(L.website || "").replace(/\/?$/, "/")}insights. Two to four sentences. No sales ask, no pricing.` : `Purpose: a final, gracious check-in. Two or three sentences. Offer the booking link ${L.booking || ""} once and say this is the last note. No pricing.`}
Greet by first name if known. Do not sign it.
JSON shape: {"subject": "", "body": ""}`,
      });
      if (r && r.body) { subject = r.subject || subject; body = r.body.trim(); purpose = purpose.replace("draft to edit", "AI draft"); }
    }
  } catch (e) { /* fall back to the template */ }
  await draftNote(pool, { email, p, subject, body: body + signature(), purpose, runId: run.id, stepIndex: idx });
}

// Every automation pass: tick steps, close the loop, write due drafts.
async function tick(pool) {
  const out = { started: 0, ticked: 0, closed: 0, drafted: 0 };
  // Catch any check-up lead that arrived without starting (e.g. the app was asleep).
  const since = new Date(Date.now() - 3 * 864e5).toISOString();
  for (const p of (await pool.query("SELECT id, source FROM prospects WHERE archived_at IS NULL AND status = 'new' AND created_at >= $1", [since])).rows) {
    if (!isCheckupLead(p.source)) continue;
    const has = (await pool.query("SELECT 1 FROM proc_runs WHERE process_name = $1 AND subject_kind = 'prospect' AND subject_id = $2", [NAME, p.id])).rows[0];
    if (!has && await start(pool, p.id)) out.started++;
  }
  const today = nyToday();
  // While the owner is marked out, no day-3/day-10 drafts are written; they catch up on return.
  const away = await require("./out-mode").isOn(pool).catch(() => false);
  const runs = (await pool.query("SELECT * FROM proc_runs WHERE process_name = $1 AND subject_kind = 'prospect' AND archived_at IS NULL AND NOT skipped AND COALESCE(completed_on, '') = ''", [NAME])).rows;
  for (const run of runs) {
    const steps = parse(run.steps || "[]", []);
    const p = (await pool.query("SELECT * FROM prospects WHERE id = $1", [run.subject_id])).rows[0];
    const email = (run.contact_email || (p ? emailIn(p.name, p.notes) : "")).toLowerCase();
    const msgs = email ? (await pool.query("SELECT step_index, run_id, status, sent_at, replied_at, created_at FROM proc_outbox WHERE lower(to_email) LIKE $1 AND status <> 'discarded' ORDER BY created_at", ["%" + email + "%"])).rows : [];
    const sent = msgs.filter((m) => m.status === "sent" || m.status === "opened");
    const replied = msgs.some((m) => m.replied_at);
    let reason = "";
    if (!p || p.archived_at) reason = "prospect archived";
    else if (p.unsubscribed_at) reason = "they asked not to be emailed";
    else if (replied) reason = "they replied";
    else if (["responded", "meeting"].includes(p.status)) reason = p.status === "meeting" ? "they booked" : "they responded";
    let changed = false;
    const log = [];
    if (reason) {
      steps.forEach((s) => { if (!s.doneOn) { s.doneOn = today; s.by = "Closed: " + reason; changed = true; } });
      log.push("Loop closed: " + reason + ".");
    } else {
      steps.forEach((s, i) => {
        if (s.doneOn) return;
        const done = sent.length >= i + 1 || (i === 0 && p.status === "contacted");
        if (done) { s.doneOn = today; s.by = "Automatic"; changed = true; out.ticked++; log.push("Ticked: " + s.text); }
      });
      // Write the next note once the first has gone out and its day has come.
      for (let i = 1; i < steps.length; i++) {
        const s = steps[i];
        if (away || s.doneOn || !steps[0].doneOn || s.dueOn > today) continue;
        if (msgs.some((m) => m.run_id === run.id && m.step_index === i)) continue;
        if (i === 2 && !steps[1].doneOn) continue;
        await followNote(pool, p, email, run, i); out.drafted++; log.push("Drafted for approval: " + s.text);
      }
    }
    const complete = steps.every((s) => s.doneOn);
    if (changed || complete) {
      await pool.query("UPDATE proc_runs SET steps = $2, completed_on = $3 WHERE id = $1", [run.id, JSON.stringify(steps), complete ? today : ""]);
      if (complete) out.closed++;
    }
    for (const t of log) await pool.query("INSERT INTO proc_activity (id, run_id, at, text) VALUES ($1, $2, $3, $4)", [crypto.randomUUID(), run.id, new Date().toISOString(), t]).catch(() => {});
  }
  return out;
}

// For the morning brief: follow-ups due today or overdue, by name.
async function due(pool) {
  const today = nyToday(), list = [];
  for (const r of (await pool.query("SELECT subject_label, steps FROM proc_runs WHERE process_name = $1 AND archived_at IS NULL AND NOT skipped AND COALESCE(completed_on, '') = ''", [NAME]).catch(() => ({ rows: [] }))).rows) {
    const s = parse(r.steps || "[]", []).find((x) => !x.doneOn && x.dueOn && x.dueOn <= today);
    if (s) list.push({ who: r.subject_label, step: s.text, due: s.dueOn, overdue: s.dueOn < today });
  }
  return list;
}

module.exports = { NAME, start, tick, due, isCheckupLead, debriefScript };
