"use strict";
// Meeting summaries into records. The note-taker in Google Meet (Gemini),
// Zoom (AI Companion), Fathom, Otter, Fireflies, or Read.ai emails a summary
// after each call. The connected Gmail account is checked for those emails;
// each one is matched to a deal (by the attendees' email addresses, then by
// the organization's name in the subject), and AI turns it into the same
// proposal "call notes to records" makes: a dated summary, the stage, the
// next step, a problem log entry, and a follow-up draft.
//
// Nothing is applied on its own. Each summary waits in Meeting notes until
// the owner applies it (or dismisses it). Applying also logs the meeting as a
// conversation, so the Weekly Log counts it.
//
// Privacy: anything whose subject says coaching, confidential, or private is
// skipped and its text is never stored.

const crypto = require("crypto");
const AI = require("./ai");
const GMAIL = require("./gmail");
const newId = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

const SENDERS = [
  ["gemini-notes@google.com", "Google Meet"], ["meetings-noreply@google.com", "Google Meet"],
  ["no-reply@zoom.us", "Zoom"], ["noreply@zoom.us", "Zoom"],
  ["no-reply@fathom.video", "Fathom"], ["no-reply@otter.ai", "Otter"], ["fred@fireflies.ai", "Fireflies"],
  ["notifications@read.ai", "Read.ai"], ["no-reply@read.ai", "Read.ai"],
];
const SUMMARY_SUBJECT = /notes|summary|recap|meeting assets|transcript|highlights|action items/i;
const PRIVATE = /coaching|confidential|private/i;
const EMAIL_RE_G = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const q = async (pool, sql, vals) => { try { return (await pool.query(sql, vals || [])).rows; } catch (e) { return []; } };
const clip = (s, n) => String(s == null ? "" : s).slice(0, n);

function sourceOf(from) {
  const addr = ((/<([^>]+)>/.exec(from) || [])[1] || from).trim().toLowerCase();
  const hit = SENDERS.find(([a]) => addr === a);
  return hit ? hit[1] : "";
}

// Which deal is this meeting about? Attendee emails first, then the org name.
async function matchDeal(pool, { subject, text, ours }) {
  const emails = [...new Set((String(text).match(EMAIL_RE_G) || []).map((e) => e.toLowerCase()))].filter((e) => !ours.has(e) && !SENDERS.some(([a]) => a === e));
  for (const e of emails) {
    const r = (await q(pool, `SELECT p.id FROM contacts c JOIN contact_links l ON l.contact_id = c.id AND l.kind = 'pipeline' JOIN pipeline p ON p.id = l.ref_id
      WHERE lower(c.email) = $1 AND c.archived_at IS NULL AND p.archived_at IS NULL ORDER BY p.updated_at DESC NULLS LAST LIMIT 1`, [e]))[0];
    if (r) return { dealId: r.id, how: "attendee " + e };
    const d = (await q(pool, "SELECT id FROM pipeline WHERE archived_at IS NULL AND position(lower($1) in lower(COALESCE(notes, ''))) > 0 ORDER BY updated_at DESC NULLS LAST LIMIT 1", [e]))[0];
    if (d) return { dealId: d.id, how: "attendee " + e };
  }
  const deals = await q(pool, "SELECT id, org, name FROM pipeline WHERE archived_at IS NULL AND stage NOT IN ('lost', 'referred') ORDER BY updated_at DESC NULLS LAST LIMIT 300");
  const subj = String(subject || "").toLowerCase();
  const hit = deals.find((d) => (d.org || "").length >= 4 && subj.includes(d.org.toLowerCase())) || deals.find((d) => (d.name || "").length >= 5 && subj.includes(d.name.toLowerCase()));
  return hit ? { dealId: hit.id, how: "name in the subject" } : { dealId: "", how: "" };
}

async function propose(pool, id) {
  const m = (await q(pool, "SELECT * FROM meeting_notes WHERE id = $1", [id]))[0];
  if (!m) throw Object.assign(new Error("Meeting not found."), { status: 404 });
  if (!m.deal_id) throw Object.assign(new Error("Choose the deal this meeting belongs to first."), { status: 400 });
  const F = require("./ai-features");
  const prop = await F.callNotes(pool, m.deal_id, `Meeting summary from ${m.source} (${m.subject}, ${String(m.received_at).slice(0, 10)}):\n\n${m.text}`);
  await pool.query("UPDATE meeting_notes SET proposal = $1, status = 'ready', error = '' WHERE id = $2", [JSON.stringify(prop), id]);
  return prop;
}

async function ingest(pool, { maxAi = 5 } = {}) {
  const list = await GMAIL.accounts(pool);
  if (!list.length) return { checked: 0, added: 0 };
  const ours = new Set(list.flatMap((a) => [a.email].concat((a.sendAs || []).map((x) => x.email))).map((e) => e.toLowerCase()));
  const query = `from:(${SENDERS.map(([a]) => a).join(" OR ")}) newer_than:7d`;
  let checked = 0, added = 0, ai = 0;
  const aiOn = await AI.enabled(pool);
  for (const acct of list) {
    let msgs = [];
    try { msgs = (await GMAIL.gapi(pool, acct.email, `/gmail/v1/users/me/messages?maxResults=25&q=${encodeURIComponent(query)}`)).messages || []; } catch (e) { continue; }
    for (const { id: gid } of msgs) {
      checked++;
      if ((await q(pool, "SELECT 1 FROM meeting_notes WHERE gmail_id = $1", [gid])).length) continue;
      let full;
      try { full = await GMAIL.gapi(pool, acct.email, `/gmail/v1/users/me/messages/${encodeURIComponent(gid)}?format=full`); } catch (e) { continue; }
      const hdr = (n) => ((((full.payload || {}).headers) || []).find((h) => h.name.toLowerCase() === n) || {}).value || "";
      const from = hdr("from"), subject = hdr("subject"), source = sourceOf(from);
      if (!source || !SUMMARY_SUBJECT.test(subject)) continue;
      const received = new Date(Number(full.internalDate) || Date.now()).toISOString();
      const rowId = newId();
      if (PRIVATE.test(subject)) {
        await pool.query("INSERT INTO meeting_notes (id, account, gmail_id, received_at, source, subject, text, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,'','skipped',$7) ON CONFLICT (gmail_id) DO NOTHING",
          [rowId, acct.email, gid, received, source, clip(subject, 300), nowIso()]);
        continue;
      }
      const text = clip(GMAIL.bodyText(full.payload) || full.snippet || "", 30000);
      const match = await matchDeal(pool, { subject, text, ours });
      await pool.query(`INSERT INTO meeting_notes (id, account, gmail_id, received_at, source, subject, text, deal_id, match_how, status, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (gmail_id) DO NOTHING`,
        [rowId, acct.email, gid, received, source, clip(subject, 300), text, match.dealId, match.how, match.dealId ? "matched" : "unmatched", nowIso()]);
      added++;
      if (match.dealId && aiOn && ai < maxAi) {
        ai++;
        try { await propose(pool, rowId); } catch (e) { await pool.query("UPDATE meeting_notes SET error = $1 WHERE id = $2", [clip(e.message, 300), rowId]); }
      }
    }
  }
  // Matched earlier while AI was off or out of budget: propose now.
  if (aiOn) {
    for (const m of await q(pool, "SELECT id FROM meeting_notes WHERE status = 'matched' AND COALESCE(error, '') = '' ORDER BY received_at LIMIT $1", [Math.max(0, maxAi - ai)])) {
      try { await propose(pool, m.id); } catch (e) { await pool.query("UPDATE meeting_notes SET error = $1 WHERE id = $2", [clip(e.message, 300), m.id]); }
    }
  }
  return { checked, added };
}

const toApi = (m, deals) => ({
  id: m.id, source: m.source, subject: m.subject, receivedAt: m.received_at, status: m.status, dealId: m.deal_id || "",
  dealLabel: m.deal_id && deals[m.deal_id] ? deals[m.deal_id] : "", matchHow: m.match_how || "", error: m.error || "",
  preview: clip(m.text, 1200), proposal: m.proposal ? JSON.parse(m.proposal) : null, appliedAt: m.applied_at || "",
});

function mount(app, { pool, requireAuth }) {
  const wrap = (fn) => async (req, res) => { try { await fn(req, res); } catch (err) { if (!err.status) console.error("meetings", err); res.status(err.status || 500).json({ error: String(err.message || err) }); } };
  const who = async (req) => { const s = req.session || {}; if (s.userId) { const u = (await q(pool, "SELECT name, email FROM app_users WHERE id = $1", [s.userId]))[0]; if (u) return u.name || u.email; } return "Owner"; };

  app.get("/api/meetings", requireAuth, wrap(async (req, res) => {
    const rows = await q(pool, "SELECT * FROM meeting_notes WHERE status IN ('ready', 'matched', 'unmatched') OR (status IN ('applied', 'skipped') AND created_at >= $1) ORDER BY received_at DESC LIMIT 60", [new Date(Date.now() - 30 * 864e5).toISOString()]);
    const deals = {};
    (await q(pool, "SELECT id, org, name, stage FROM pipeline WHERE archived_at IS NULL ORDER BY COALESCE(org, name)")).forEach((d) => { deals[d.id] = d.org || d.name; });
    res.json({ items: rows.map((m) => toApi(m, deals)), deals: Object.keys(deals).map((id) => ({ id, label: deals[id] })), gmail: (await GMAIL.accounts(pool)).length > 0 });
  }));
  app.post("/api/meetings/check", requireAuth, wrap(async (req, res) => res.json(await ingest(pool))));
  app.post("/api/meetings/:id/match", requireAuth, wrap(async (req, res) => {
    const dealId = String((req.body || {}).dealId || "");
    if (!(await q(pool, "SELECT 1 FROM pipeline WHERE id = $1", [dealId])).length) return res.status(400).json({ error: "Choose a deal." });
    await pool.query("UPDATE meeting_notes SET deal_id = $1, match_how = 'chosen by you', status = 'matched', proposal = '', error = '' WHERE id = $2", [dealId, req.params.id]);
    let prop = null;
    if (await AI.enabled(pool)) prop = await propose(pool, req.params.id);
    res.json({ ok: true, proposal: prop });
  }));
  app.post("/api/meetings/:id/propose", requireAuth, wrap(async (req, res) => res.json(await propose(pool, req.params.id))));
  app.post("/api/meetings/:id/apply", requireAuth, wrap(async (req, res) => {
    const m = (await q(pool, "SELECT * FROM meeting_notes WHERE id = $1", [req.params.id]))[0];
    if (!m || !m.deal_id) return res.status(400).json({ error: "This meeting isn't matched to a deal." });
    const F = require("./ai-features");
    const out = await F.applyCallNotes(pool, m.deal_id, req.body || {}, await who(req));
    // Count it as a conversation for the Weekly Log.
    await pool.query(`INSERT INTO encounters (id, pipeline_id, contact_name, occurred_at, interaction_type, relationship_stage, reason, next_step, next_step_date, summary, logged_by, created_at)
      VALUES ($1,$2,$3,$4,'meeting','cultivation',$5,$6,$7,$8,$9,$10)`,
      [newId(), m.deal_id, clip(((req.body || {}).contact || {}).name, 120), String(m.received_at).slice(0, 10), clip(m.subject, 200), clip((req.body || {}).nextStep, 300), out.nextStepDate || "", clip((req.body || {}).summary, 3000), m.source + " summary", nowIso()]);
    // The summary now lives on the deal; the raw email text isn't kept.
    await pool.query("UPDATE meeting_notes SET status = 'applied', applied_at = $1, text = '' WHERE id = $2", [nowIso(), m.id]);
    res.json(out);
  }));
  app.post("/api/meetings/:id/dismiss", requireAuth, wrap(async (req, res) => {
    // Dismissed summaries keep no text.
    await pool.query("UPDATE meeting_notes SET status = 'dismissed', text = '', proposal = '' WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  }));
}

module.exports = { mount, ingest, propose, matchDeal, SENDERS };
