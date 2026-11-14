"use strict";
// Governance: the board's own records, in one place.
//
//   /api/gov/members            board roster (role, voting, committees, term)
//   /api/gov/meetings           calendar of meetings; GET /:id adds motions and quorum
//   /api/gov/meetings/plan      add a year of regular meetings in one step
//   /api/gov/motions            motions and votes recorded at a meeting
//   /api/gov/coi                yearly conflict-of-interest statements
//   /api/gov/coi/start          create this year's statement (and private link) for every member
//   /coi/:token                 the page a board member opens to sign (no sign-in needed)
//   /api/gov/checklist          Form 990 checklist items; /start builds a year's list with due dates
//   /api/gov/policies           policy register; /seed adds the policies the 990 asks about
//   /api/gov/summary            what's next, what's missing
//   /print/agenda/:id, /print/minutes/:id   printable, editable before printing
//   /api/gov/meetings/:id.ics, /api/gov/calendar.ics   calendar files
//
// Everything sits behind sign-in (board accounts read-only) except /coi/<token>.
// Module key: governance (org.config.json "modules", or Settings > Areas).

const crypto = require("crypto");
const F = require("./foundation");
const { ORG } = require("./accounts");
const { esc, money, longDate, isDate, todayIso, nowIso, newId, letterPage, letterhead, parseJson, coerce, toApi, insertRow, updateRow } = F;

F.SPECS.gov_members = {
  required: ["name"],
  fields: { name: ["name", "s"], email: ["email", "s"], role: ["role", "s"], voting: ["voting", "b"], committees: ["committees", "s"], termStart: ["term_start", "d"], termEnd: ["term_end", "d"], notes: ["notes", "s"] },
};
F.SPECS.gov_meetings = {
  required: ["title"],
  fields: { title: ["title", "s"], kind: ["kind", "s"], startsAt: ["starts_at", "s"], durationMin: ["duration_min", "i"], location: ["location", "s"], agenda: ["agenda", "s"], status: ["status", "s"],
    attendance: ["attendance", "j"], guests: ["guests", "s"], conflictsDeclared: ["conflicts_declared", "s"], minutes: ["minutes", "s"], minutesApprovedOn: ["minutes_approved_on", "d"] },
};
F.SPECS.gov_motions = {
  required: ["meetingId", "motion"], hardDelete: true,
  fields: { meetingId: ["meeting_id", "s"], motion: ["motion", "s"], movedBy: ["moved_by", "s"], secondedBy: ["seconded_by", "s"], result: ["result", "s"], yes: ["yes_votes", "i"], no: ["no_votes", "i"], abstain: ["abstain_votes", "i"] },
};
F.SPECS.gov_checklist = {
  required: ["fiscalYear", "label"], hardDelete: true,
  fields: { fiscalYear: ["fiscal_year", "s"], itemKey: ["item_key", "s"], label: ["label", "s"], detail: ["detail", "s"], dueOn: ["due_on", "d"], doneOn: ["done_on", "d"], owner: ["owner", "s"], notes: ["notes", "s"], sort: ["sort", "i"] },
};
F.SPECS.gov_policies = {
  required: ["name"],
  fields: { name: ["name", "s"], adoptedOn: ["adopted_on", "d"], lastReviewed: ["last_reviewed", "d"], reviewEveryMonths: ["review_every_months", "i"], link: ["link", "s"], notes: ["notes", "s"] },
};
F.HAS_UPDATED.gov_members = 1;
F.HAS_UPDATED.gov_meetings = 1;

const cfg = () => (ORG && ORG.governance) || {};
const VOTING_ROLES_LABEL = { chair: "Chair", "vice-chair": "Vice chair", treasurer: "Treasurer", secretary: "Secretary", member: "Member", staff: "Staff (non-voting)" };
const KIND_LABEL = { regular: "Board meeting", annual: "Annual meeting", special: "Special meeting", committee: "Committee meeting" };

function addMonths(iso, n) { return F.addMonths(iso, n); }
function addDays(iso, n) { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function dateTimeLabel(local) {
  if (!local) return "";
  const [d, t] = String(local).split("T");
  if (!isDate(d)) return local;
  let out = longDate(d);
  if (t && /^\d{2}:\d{2}/.test(t)) {
    const [h, m] = t.split(":").map(Number);
    out += `, ${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "a.m." : "p.m."}`;
  }
  return out;
}

// Quorum: a majority of voting members unless governance.quorum sets a number.
function quorumFor(members, attendance) {
  const voting = members.filter((m) => m.voting !== false && m.role !== "staff");
  const present = voting.filter((m) => attendance[m.id] === "present").length;
  const q = Number(cfg().quorum);
  const needed = q > 0 ? q : Math.floor(voting.length / 2) + 1;
  return { voting: voting.length, present, needed, met: voting.length > 0 && present >= needed };
}

// ---------- the Form 990 checklist ----------
// Due dates follow the organization's fiscal year (fundraising.fiscalYearStartMonth).
// Form 990 is due the 15th day of the 5th month after the year ends; Form 8868
// gives an automatic six-month extension. The Part VI lines named below are the
// governance questions on the 990 that these records answer.
function checklistTemplate(fy) {
  const end = addDays(fy.to, -1);
  const [ty, tm] = fy.to.split("-").map(Number);
  const due990 = new Date(Date.UTC(ty, tm - 1 + 4, 15)).toISOString().slice(0, 10);
  const extended = new Date(Date.UTC(ty, tm - 1 + 10, 15)).toISOString().slice(0, 10);
  const startYear = Number(fy.from.slice(0, 4));
  const jan31 = `${startYear + 1}-01-31`;
  return [
    ["coi", "Collect a signed conflict-of-interest statement from every board member and key staff", "Form 990 Part VI, line 12. Use the Conflict of interest tab.", addDays(end, 30)],
    ["minutes", "Confirm minutes were written and approved for every board and committee meeting", "Form 990 Part VI, line 8.", addDays(end, 30)],
    ["1099", "Send 1099-NEC forms to contractors paid $600 or more in the calendar year", "Due to recipients and the IRS by January 31.", jan31],
    ["close", "Close the books and reconcile every account for the year", "", addMonths(end, 1)],
    ["policies", "Confirm the conflict-of-interest, whistleblower, and document retention policies are adopted and current", "Form 990 Part VI, lines 12 to 14. Use the Policies tab.", addMonths(end, 2)],
    ["pay", "Record how the board set the executive director's pay (comparable data, approval, minutes)", "Form 990 Part VI, line 15.", addMonths(end, 2)],
    ["scheduleb", "Gather the list of major contributors for Schedule B", "Kept confidential; not part of the public copy.", addMonths(end, 2)],
    ["statements", "Board approves the year's financial statements (and an audit or review if your state or funders require one)", "Check your state's thresholds and your grant agreements.", addMonths(end, 3)],
    ["draft", "Preparer drafts the Form 990", "", addMonths(end, 3)],
    ["board-copy", "Give every board member a copy of the final 990 before it's filed", "Form 990 Part VI, line 11.", addDays(due990, -14)],
    ["file", "File Form 990, or Form 8868 for an automatic six-month extension", `Due ${longDate(due990)}; with the extension, ${longDate(extended)}.`, due990],
    ["990t", "If gross unrelated business income was $1,000 or more, file Form 990-T", "Same due date as the 990.", due990],
    ["state", "Renew charitable solicitation registration in each state where you raise money", "Deadlines and forms differ by state (Maryland, DC, and Virginia each have their own). Check each state's office.", due990],
    ["public", "Keep the last three years of 990s available to anyone who asks", "Required for public inspection; posting them online also works.", addMonths(due990, 1)],
  ].map(([key, label, detail, due], i) => ({ itemKey: key, label, detail, dueOn: due, sort: i + 1 }));
}

const SEED_POLICIES = [
  ["Conflict of interest", 12, "Form 990 Part VI, line 12. Reviewed yearly; every board member signs a statement."],
  ["Whistleblower", 24, "Form 990 Part VI, line 13."],
  ["Document retention and destruction", 24, "Form 990 Part VI, line 14."],
  ["Executive compensation review", 12, "Form 990 Part VI, line 15."],
  ["Gift acceptance", 36, ""],
  ["Expense reimbursement", 36, ""],
  ["Investment", 36, "If the organization holds reserves or an endowment."],
];

// ---------- calendar file ----------
function icsEscape(s) { return String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
function icsLocal(local, addMin) {
  const [d, t = "18:00"] = String(local).split("T");
  const [y, mo, da] = d.split("-").map(Number), [h, mi] = t.split(":").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, da, h, mi + (addMin || 0)));
  return dt.toISOString().replace(/[-:]/g, "").slice(0, 15);
}
function ics(meetings, tz) {
  const o = ORG.org || {};
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//" + icsEscape(o.shortName || "Operations") + "//Board//EN", "CALSCALE:GREGORIAN"];
  for (const m of meetings) {
    if (!m.starts_at || !isDate(m.starts_at.slice(0, 10)) || m.status === "cancelled") continue;
    lines.push("BEGIN:VEVENT", "UID:" + m.id + "@board", "DTSTAMP:" + new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z",
      `DTSTART;TZID=${tz}:${icsLocal(m.starts_at)}`, `DTEND;TZID=${tz}:${icsLocal(m.starts_at, Number(m.duration_min) || 90)}`,
      "SUMMARY:" + icsEscape(m.title), "LOCATION:" + icsEscape(m.location), "DESCRIPTION:" + icsEscape(m.agenda ? "Agenda:\n" + m.agenda : ""), "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

// ---------- public conflict-of-interest page ----------
function coiStatement() {
  const o = ORG.org || {};
  return cfg().coiStatement || `I have received and read ${o.name || "the organization"}'s conflict-of-interest policy, I agree to follow it, and I understand the organization is charitable and must engage primarily in activities that accomplish its tax-exempt purposes. Below I list any financial interest, family relationship, or other position (as an owner, officer, director, employee, or adviser) that could create, or look like, a conflict with my duties to the organization. If something changes during the year, I'll tell the board chair right away and step out of any discussion or vote it affects.`;
}
function coiPage(row, member, message) {
  const { navy, gold } = F.brand();
  const o = ORG.org || {};
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Conflict-of-interest statement | ${esc(o.name || "")}</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<style>:root{--navy:${navy};--gold:${gold}}*{box-sizing:border-box}body{margin:0;background:#F3F5F7;color:#23282D;font:16px/1.6 Inter,system-ui,sans-serif}
header{background:var(--navy);color:#fff;padding:18px 16px}header .in,main{max-width:720px;margin:0 auto}header b{font-family:"Playfair Display",Georgia,serif;font-size:20px}
main{background:#fff;margin:24px auto;padding:32px clamp(16px,5vw,44px);border-radius:12px}h1{font-family:"Playfair Display",Georgia,serif;color:var(--navy);margin:0 0 8px;font-size:26px}
.stmt{background:#F6F7F9;border-left:4px solid var(--gold);padding:14px 16px;border-radius:6px}form{display:grid;gap:14px;margin-top:18px}
label{display:flex;flex-direction:column;gap:5px;font-weight:600;font-size:14px;color:#33404C}label.row{flex-direction:row;align-items:flex-start;gap:10px;font-weight:500;font-size:15px}
input[type=text],textarea{font:inherit;font-weight:400;padding:10px 12px;border:1px solid #B8C1CA;border-radius:8px;width:100%}textarea{min-height:120px}input[type=checkbox]{width:20px;height:20px;margin-top:3px}
button{font:inherit;font-weight:700;padding:12px 18px;border-radius:8px;border:0;background:var(--navy);color:#fff;cursor:pointer;justify-self:start}
.msg{padding:14px 16px;border-radius:8px;background:#EEF6F0;color:#1E5631;font-weight:600}.muted{color:#55606B;font-size:14px}</style></head>
<body><header><div class="in"><b>${esc(o.name || "")}</b></div></header><main>
${!row ? "<h1>Link not found</h1><p>This link isn't valid. Ask the board chair or executive director for a new one.</p>" : `
<h1>Conflict-of-interest statement, ${esc(row.year)}</h1>
<p class="muted">For ${esc(member ? member.name : "board member")}</p>
${message ? `<p class="msg">${esc(message)}</p>` : ""}
<div class="stmt">${esc(coiStatement())}</div>
${row.signed_on ? `<p class="msg">Signed by ${esc(row.signed_name)} on ${esc(longDate(row.signed_on))}. Thank you.</p>${row.no_conflicts ? "<p>No conflicts disclosed.</p>" : `<p><strong>Disclosed:</strong></p><p style="white-space:pre-wrap">${esc(row.disclosures)}</p>`}<p class="muted">Need to change something? Sign again below; the newest statement replaces this one.</p>` : ""}
<form method="post" action="/coi/${esc(row.token)}">
<label class="row"><input type="checkbox" name="noConflicts" value="1"${row.no_conflicts ? " checked" : ""}> I have nothing to disclose.</label>
<label>Interests, relationships, or positions to disclose<textarea name="disclosures" maxlength="5000" placeholder="For example: I serve on the board of a nonprofit that may apply for a grant; my spouse works for a vendor we use.">${esc(row.disclosures || "")}</textarea></label>
<label>Type your full name to sign<input type="text" name="signedName" required maxlength="160" value="${esc(member ? member.name : "")}"></label>
<button type="submit">Sign statement</button></form>`}
</main></body></html>`;
}

function mount(app, { pool, requireAuth }) {
  const wrap = F.crud(app, pool, requireAuth, "/api/gov/members", "gov_members", { order: "lower(name)" });
  F.crud(app, pool, requireAuth, "/api/gov/motions", "gov_motions", { order: "created_at" });
  F.crud(app, pool, requireAuth, "/api/gov/checklist", "gov_checklist", { order: "fiscal_year DESC, sort, due_on" });
  F.crud(app, pool, requireAuth, "/api/gov/policies", "gov_policies", { order: "lower(name)" });
  const activeMembers = async () => (await pool.query("SELECT * FROM gov_members WHERE archived_at IS NULL AND (term_end = '' OR term_end >= $1) ORDER BY lower(name)", [todayIso()])).rows;

  // Meetings: list (with motion counts) and one meeting with quorum and motions.
  app.get("/api/gov/meetings", requireAuth, wrap(async (req, res) => {
    const rows = (await pool.query("SELECT * FROM gov_meetings WHERE archived_at IS NULL ORDER BY starts_at DESC")).rows;
    const members = await activeMembers();
    const counts = Object.fromEntries((await pool.query("SELECT meeting_id, count(*)::int AS n FROM gov_motions GROUP BY meeting_id")).rows.map((r) => [r.meeting_id, r.n]));
    res.json({ items: rows.map((m) => Object.assign(toApi("gov_meetings", m), { motions: counts[m.id] || 0, quorum: quorumFor(members.map((x) => toApi("gov_members", x)), parseJson(m.attendance, {})) })) });
  }));
  app.post("/api/gov/meetings", requireAuth, wrap(async (req, res) => {
    const b = Object.assign({ agenda: cfg().defaultAgenda || DEFAULT_AGENDA }, req.body || {});
    res.status(201).json({ item: toApi("gov_meetings", await insertRow(pool, "gov_meetings", b)) });
  }));
  app.get("/api/gov/meetings/:id", requireAuth, wrap(async (req, res, next) => {
    if (req.params.id.endsWith(".ics")) return icsOne(req, res);
    const m = (await pool.query("SELECT * FROM gov_meetings WHERE id = $1", [req.params.id])).rows[0];
    if (!m) return res.status(404).json({ error: "not found" });
    const members = (await activeMembers()).map((x) => toApi("gov_members", x));
    const attendance = parseJson(m.attendance, {});
    // people recorded at this meeting who have since left the board still show
    const extra = Object.keys(attendance).filter((id) => !members.some((x) => x.id === id));
    const former = extra.length ? (await pool.query("SELECT * FROM gov_members WHERE id = ANY($1)", [extra])).rows.map((x) => toApi("gov_members", x)) : [];
    const motions = (await pool.query("SELECT * FROM gov_motions WHERE meeting_id = $1 ORDER BY created_at", [m.id])).rows.map((x) => toApi("gov_motions", x));
    res.json({ item: toApi("gov_meetings", m), members: members.concat(former), motions, quorum: quorumFor(members, attendance) });
  }));
  app.patch("/api/gov/meetings/:id", requireAuth, wrap(async (req, res) => {
    const row = await updateRow(pool, "gov_meetings", req.params.id, req.body || {});
    if (!row) return res.status(404).json({ error: "not found" });
    res.json({ item: toApi("gov_meetings", row) });
  }));
  app.delete("/api/gov/meetings/:id", requireAuth, wrap(async (req, res) => {
    await pool.query("UPDATE gov_meetings SET archived_at = $1 WHERE id = $2", [nowIso(), req.params.id]);
    res.json({ ok: true });
  }));
  // A year of regular meetings: every N months from a first date, at one time and place.
  app.post("/api/gov/meetings/plan", requireAuth, wrap(async (req, res) => {
    const b = req.body || {};
    const first = coerce("d", b.firstDate);
    if (!first) return res.status(400).json({ error: "Pick the date of the first meeting." });
    const every = Math.min(12, Math.max(1, parseInt(b.everyMonths, 10) || 3));
    const count = Math.min(24, Math.max(1, parseInt(b.count, 10) || Math.floor(12 / every)));
    const time = /^\d{2}:\d{2}$/.test(b.time || "") ? b.time : "18:00";
    const made = [];
    for (let i = 0; i < count; i++) {
      const d = addMonths(first, i * every);
      const exists = (await pool.query("SELECT 1 FROM gov_meetings WHERE archived_at IS NULL AND left(starts_at, 10) = $1", [d])).rows.length;
      if (exists) continue;
      made.push(await insertRow(pool, "gov_meetings", { title: b.title || "Board meeting", kind: "regular", startsAt: `${d}T${time}`, durationMin: b.durationMin || 90, location: b.location || "", agenda: cfg().defaultAgenda || DEFAULT_AGENDA }));
    }
    res.json({ ok: true, created: made.length });
  }));
  const tz = () => cfg().timeZone || "America/New_York";
  async function icsOne(req, res) {
    const m = (await pool.query("SELECT * FROM gov_meetings WHERE id = $1", [req.params.id.replace(/\.ics$/, "")])).rows[0];
    if (!m) return res.status(404).send("Not found");
    res.set("Content-Type", "text/calendar; charset=utf-8").set("Content-Disposition", 'attachment; filename="board-meeting.ics"').send(ics([m], tz()));
  }
  app.get("/api/gov/calendar.ics", requireAuth, wrap(async (req, res) => {
    const rows = (await pool.query("SELECT * FROM gov_meetings WHERE archived_at IS NULL AND starts_at >= $1 ORDER BY starts_at", [todayIso()])).rows;
    res.set("Content-Type", "text/calendar; charset=utf-8").set("Content-Disposition", 'attachment; filename="board-meetings.ics"').send(ics(rows, tz()));
  }));

  // ----- conflict of interest -----
  app.get("/api/gov/coi", requireAuth, wrap(async (req, res) => {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const members = await activeMembers();
    const rows = Object.fromEntries((await pool.query("SELECT * FROM gov_coi WHERE year = $1", [year])).rows.map((r) => [r.member_id, r]));
    res.json({ year, statement: coiStatement(), items: members.map((m) => {
      const r = rows[m.id];
      return { memberId: m.id, name: m.name, email: m.email, role: m.role, id: r ? r.id : "", token: r ? r.token : "", sentOn: r ? r.sent_on : "", signedOn: r ? r.signed_on : "", signedName: r ? r.signed_name : "", noConflicts: r ? !!r.no_conflicts : false, disclosures: r ? r.disclosures : "" };
    }) });
  }));
  app.post("/api/gov/coi/start", requireAuth, wrap(async (req, res) => {
    const year = parseInt((req.body || {}).year, 10) || new Date().getFullYear();
    let created = 0;
    for (const m of await activeMembers()) {
      const r = await pool.query("INSERT INTO gov_coi (id, member_id, year, token, created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (member_id, year) DO NOTHING", [newId(), m.id, year, crypto.randomBytes(18).toString("base64url"), nowIso()]);
      created += r.rowCount;
    }
    res.json({ ok: true, created });
  }));
  app.patch("/api/gov/coi/:id", requireAuth, wrap(async (req, res) => {
    const b = req.body || {};
    const sets = [], vals = [];
    if ("sentOn" in b) { vals.push(coerce("d", b.sentOn)); sets.push(`sent_on = $${vals.length}`); }
    if (b.newLink) { vals.push(crypto.randomBytes(18).toString("base64url")); sets.push(`token = $${vals.length}`); }
    if (!sets.length) return res.json({ ok: true });
    vals.push(req.params.id);
    await pool.query(`UPDATE gov_coi SET ${sets.join(", ")} WHERE id = $${vals.length}`, vals);
    res.json({ ok: true });
  }));
  const coiHits = new Map();
  setInterval(() => coiHits.clear(), 3600000).unref();
  app.get("/coi/:token", async (req, res) => {
    const row = (await pool.query("SELECT * FROM gov_coi WHERE token = $1", [String(req.params.token)])).rows[0];
    const member = row ? (await pool.query("SELECT * FROM gov_members WHERE id = $1", [row.member_id])).rows[0] : null;
    res.status(row ? 200 : 404).set("Content-Type", "text/html; charset=utf-8").set("Cache-Control", "no-store").send(coiPage(row, member, req.query.signed ? "Your statement was saved." : ""));
  });
  app.post("/coi/:token", require("express").urlencoded({ extended: false, limit: "50kb" }), async (req, res) => {
    const n = (coiHits.get(req.ip) || 0) + 1; coiHits.set(req.ip, n);
    if (n > 20) return res.status(429).send("Too many attempts. Try again in an hour.");
    const row = (await pool.query("SELECT * FROM gov_coi WHERE token = $1", [String(req.params.token)])).rows[0];
    if (!row) return res.status(404).set("Content-Type", "text/html; charset=utf-8").send(coiPage(null));
    const b = req.body || {};
    const name = String(b.signedName || "").trim().slice(0, 160);
    const disclosures = String(b.disclosures || "").trim().slice(0, 5000);
    const none = !!b.noConflicts && !disclosures;
    if (!name || (!none && !disclosures)) {
      const member = (await pool.query("SELECT * FROM gov_members WHERE id = $1", [row.member_id])).rows[0];
      return res.status(400).set("Content-Type", "text/html; charset=utf-8").send(coiPage(row, member, "Type your name, and either tick \"nothing to disclose\" or describe what to disclose."));
    }
    await pool.query("UPDATE gov_coi SET signed_on = $1, signed_name = $2, no_conflicts = $3, disclosures = $4 WHERE id = $5", [todayIso(), name, none, none ? "" : disclosures, row.id]);
    res.redirect(303, `/coi/${row.token}?signed=1`);
  });

  // ----- Form 990 checklist -----
  app.post("/api/gov/checklist/start", requireAuth, wrap(async (req, res) => {
    const offset = parseInt((req.body || {}).offset, 10) || 0; // 0 = the year in progress, -1 = last year
    const fy = F.fiscalYear(offset);
    const have = (await pool.query("SELECT count(*)::int AS n FROM gov_checklist WHERE fiscal_year = $1", [fy.label])).rows[0].n;
    if (have) return res.status(409).json({ error: `The ${fy.label} checklist already exists.` });
    for (const it of checklistTemplate(fy)) await insertRow(pool, "gov_checklist", Object.assign({ fiscalYear: fy.label }, it));
    res.json({ ok: true, fiscalYear: fy.label });
  }));
  app.post("/api/gov/policies/seed", requireAuth, wrap(async (req, res) => {
    let created = 0;
    for (const [name, months, notes] of SEED_POLICIES) {
      const exists = (await pool.query("SELECT 1 FROM gov_policies WHERE lower(name) = lower($1) AND archived_at IS NULL", [name])).rows.length;
      if (!exists) { await insertRow(pool, "gov_policies", { name, reviewEveryMonths: months, notes }); created++; }
    }
    res.json({ ok: true, created });
  }));

  // ----- summary -----
  app.get("/api/gov/summary", requireAuth, wrap(async (req, res) => {
    const today = todayIso(), year = new Date().getFullYear();
    const members = await activeMembers();
    const meetings = (await pool.query("SELECT * FROM gov_meetings WHERE archived_at IS NULL ORDER BY starts_at")).rows;
    const next = meetings.find((m) => m.status !== "cancelled" && m.starts_at && m.starts_at.slice(0, 10) >= today);
    const past = meetings.filter((m) => m.status !== "cancelled" && m.starts_at && m.starts_at.slice(0, 10) < today);
    const coi = (await pool.query("SELECT member_id, signed_on FROM gov_coi WHERE year = $1", [year])).rows;
    const signed = new Set(coi.filter((c) => c.signed_on).map((c) => c.member_id));
    const checklist = (await pool.query("SELECT * FROM gov_checklist ORDER BY fiscal_year DESC, sort")).rows;
    const fyLabels = [...new Set(checklist.map((c) => c.fiscal_year))];
    const policies = (await pool.query("SELECT * FROM gov_policies WHERE archived_at IS NULL ORDER BY lower(name)")).rows;
    const reviewDue = policies.map((p) => {
      const base = p.last_reviewed || p.adopted_on;
      return { id: p.id, name: p.name, adopted: !!p.adopted_on, nextReview: base ? addMonths(base, Number(p.review_every_months) || 24) : "" };
    }).filter((p) => !p.adopted || (p.nextReview && p.nextReview <= addMonths(today, 1)));
    const termsEnding = members.filter((m) => m.term_end && m.term_end <= addMonths(today, 3)).map((m) => ({ id: m.id, name: m.name, termEnd: m.term_end }));
    const nextQuorum = next ? quorumFor(members.map((x) => toApi("gov_members", x)), parseJson(next.attendance, {})) : null;
    res.json({
      year,
      members: members.length, voting: members.filter((m) => m.voting !== false && m.role !== "staff").length,
      nextMeeting: next ? { id: next.id, title: next.title, startsAt: next.starts_at, location: next.location, quorumNeeded: nextQuorum.needed } : null,
      meetingsThisYear: meetings.filter((m) => m.status === "held" && (m.starts_at || "").startsWith(String(year))).length,
      minutesMissing: past.filter((m) => !String(m.minutes || "").trim()).map((m) => ({ id: m.id, title: m.title, startsAt: m.starts_at })),
      minutesToApprove: past.filter((m) => String(m.minutes || "").trim() && !m.minutes_approved_on).map((m) => ({ id: m.id, title: m.title, startsAt: m.starts_at })),
      coi: { year, signed: members.filter((m) => signed.has(m.id)).length, total: members.length, started: coi.length > 0, unsigned: members.filter((m) => !signed.has(m.id)).map((m) => ({ id: m.id, name: m.name })) },
      checklist: fyLabels.slice(0, 2).map((fy) => {
        const items = checklist.filter((c) => c.fiscal_year === fy);
        const open = items.filter((c) => !c.done_on);
        const fileItem = items.find((c) => c.item_key === "file");
        return { fiscalYear: fy, done: items.length - open.length, total: items.length, dueOn: fileItem ? fileItem.due_on : "", filed: fileItem ? !!fileItem.done_on : false,
          next: open.filter((c) => c.due_on).sort((a, b) => a.due_on.localeCompare(b.due_on)).slice(0, 4).map((c) => ({ id: c.id, label: c.label, dueOn: c.due_on, overdue: c.due_on < today })) };
      }),
      currentFiscalYear: F.fiscalYear(0).label, lastFiscalYear: F.fiscalYear(-1).label,
      policiesToReview: reviewDue, policies: policies.length,
      termsEnding,
    });
  }));

  // ----- printable agenda and minutes -----
  async function meetingBundle(id) {
    const m = (await pool.query("SELECT * FROM gov_meetings WHERE id = $1", [id])).rows[0];
    if (!m) return null;
    const attendance = parseJson(m.attendance, {});
    const ids = Object.keys(attendance);
    const all = (await pool.query("SELECT * FROM gov_members WHERE archived_at IS NULL OR id = ANY($1) ORDER BY lower(name)", [ids])).rows;
    const motions = (await pool.query("SELECT * FROM gov_motions WHERE meeting_id = $1 ORDER BY created_at", [id])).rows;
    return { m, attendance, all, motions };
  }
  const roleText = (r) => (r && r !== "member" ? `, ${VOTING_ROLES_LABEL[r] || r}` : "");
  app.get("/print/agenda/:id", requireAuth, async (req, res) => {
    const b = await meetingBundle(req.params.id);
    if (!b) return res.status(404).send("Meeting not found.");
    const { m } = b;
    const items = String(m.agenda || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    res.set("Content-Type", "text/html; charset=utf-8").send(letterPage({
      title: "Agenda, " + m.title,
      note: "Click any text to edit it before printing. Nothing here is saved; change the agenda on the meeting itself.",
      body: `<div class="page">${letterhead()}<h1 contenteditable="true">${esc(m.title)}</h1>
<p class="big" contenteditable="true">${esc(dateTimeLabel(m.starts_at))}${m.location ? "<br>" + esc(m.location) : ""}</p>
<h2>Agenda</h2><ol>${items.map((i) => `<li contenteditable="true">${esc(i)}</li>`).join("")}</ol>
<p contenteditable="true" style="margin-top:28px;color:#55606B;font-size:13px">If you have a conflict of interest with any item, tell the chair before the meeting or when the item comes up, and step out of the discussion and vote.</p></div>`,
    }));
  });
  app.get("/print/minutes/:id", requireAuth, async (req, res) => {
    const b = await meetingBundle(req.params.id);
    if (!b) return res.status(404).send("Meeting not found.");
    const { m, attendance, all, motions } = b;
    const list = (state) => all.filter((x) => attendance[x.id] === state).map((x) => esc(x.name) + esc(roleText(x.role))).join("; ") || "None";
    const voting = all.filter((x) => (x.archived_at == null) && x.voting !== false && x.role !== "staff");
    const q = quorumFor(voting.map((x) => ({ id: x.id, voting: x.voting, role: x.role })), attendance);
    res.set("Content-Type", "text/html; charset=utf-8").send(letterPage({
      title: "Minutes, " + m.title,
      note: m.minutes_approved_on ? `Approved by the board on ${esc(longDate(m.minutes_approved_on))}.` : "Draft: not yet approved by the board. Click any text to edit before printing; nothing here is saved.",
      body: `<div class="page">${letterhead()}<h1 contenteditable="true">Minutes: ${esc(m.title)}</h1>
<p contenteditable="true">${esc(dateTimeLabel(m.starts_at))}${m.location ? ", " + esc(m.location) : ""}${m.minutes_approved_on ? "" : " &middot; <strong>DRAFT</strong>"}</p>
<h2>Attendance</h2>
<p contenteditable="true"><strong>Present:</strong> ${list("present")}<br><strong>Absent:</strong> ${list("absent")}${all.some((x) => attendance[x.id] === "excused") ? "<br><strong>Excused:</strong> " + list("excused") : ""}${m.guests ? "<br><strong>Also present:</strong> " + esc(m.guests) : ""}</p>
<p contenteditable="true">${q.met ? `A quorum was present (${q.present} of ${q.voting} voting members; ${q.needed} needed).` : `A quorum was not present (${q.present} of ${q.voting} voting members; ${q.needed} needed). No binding votes should be recorded.`}</p>
<h2>Conflicts of interest</h2><p contenteditable="true">${m.conflicts_declared ? esc(m.conflicts_declared) : "None declared."}</p>
<h2>Discussion</h2><div contenteditable="true" style="white-space:pre-wrap">${esc(m.minutes || "")}</div>
<h2>Motions and votes</h2>${motions.length ? `<table><thead><tr><th>Motion</th><th>Moved / seconded</th><th>Vote</th><th>Result</th></tr></thead><tbody>${motions.map((x) => `<tr><td contenteditable="true">${esc(x.motion)}</td><td>${esc(x.moved_by)}${x.seconded_by ? " / " + esc(x.seconded_by) : ""}</td><td>${Number(x.yes_votes) || 0} yes, ${Number(x.no_votes) || 0} no, ${Number(x.abstain_votes) || 0} abstain</td><td>${esc(x.result === "passed" ? "Passed" : x.result === "failed" ? "Failed" : "Tabled")}</td></tr>`).join("")}</tbody></table>` : "<p>No motions.</p>"}
<div class="sign"><div>Secretary: signature and date</div><div>Approved by the board on</div></div></div>`,
    }));
  });
}

const DEFAULT_AGENDA = [
  "Call to order and quorum",
  "Conflicts of interest: anyone with a conflict on today's items?",
  "Approve minutes of the last meeting",
  "Executive director's report",
  "Treasurer's report and financial statements",
  "Committee reports",
  "Decisions needed",
  "Other business",
  "Adjourn",
].join("\n");

module.exports = { mount, checklistTemplate, quorumFor };
