"use strict";
// Weekly Meeting automation. The system prepares; the owner decides.
//
// Every week (early Monday, Eastern time, from the automation tick):
//   1. Fill in the Weekly Log for the week that just ended, from data the
//      system already holds. The row stays "not confirmed" (and keeps
//      refreshing) until the owner confirms or edits it in the meeting.
//   2. Prepare the meeting brief: the numbers against the last four weeks,
//      what needs attention, up to three suggested issues, and the
//      priorities that need a status. With AI on, a short plain summary.
// The meeting itself stays human: confirm the numbers, mark each priority,
// pick the one issue to solve, and write down the decision.

const crypto = require("crypto");
const AI = require("./ai");
const newId = () => crypto.randomUUID();
const TZ = "America/New_York";
const RESEARCH_SOURCES = ["market-scan", "giving"];  // bulk research, not leads
const ACTIVE = ["discovery", "assessment", "engaged"];
const WON_TO = ["assessment", "engaged"];

// ---------- dates (weeks run Monday to Sunday, Eastern time) ----------
const etDate = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d || new Date());
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function mondayOf(iso) { const d = new Date(iso + "T12:00:00Z"); const day = d.getUTCDay(); return addDays(iso, day === 0 ? -6 : 1 - day); }
function lastWeek(now) { return addDays(mondayOf(etDate(now)), -7); }
function etMidnightIso(iso) {
  const noon = new Date(iso + "T12:00:00Z");
  const etHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(noon));
  return new Date(Date.parse(iso + "T00:00:00Z") + (12 - etHour) * 3600e3).toISOString();
}
function bounds(weekOf) {
  const end = addDays(weekOf, 7);
  return { weekOf, sunday: addDays(weekOf, 6), end, fromTs: etMidnightIso(weekOf), toTs: etMidnightIso(end) };
}
const q = async (pool, sql, vals) => { try { return (await pool.query(sql, vals || [])).rows; } catch (e) { return []; } };
const one = async (pool, sql, vals) => (await q(pool, sql, vals))[0] || {};
const nice = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(iso || "") ? new Date(iso.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : iso);
const money = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");

// ---------- 1. the week's numbers ----------
async function compute(pool, weekOf) {
  const b = bounds(weekOf);
  const prospects = await q(pool, "SELECT source FROM prospects WHERE created_at >= $1 AND created_at < $2 AND NOT (COALESCE(source, '') = ANY($3))", [b.fromTs, b.toTs, RESEARCH_SOURCES]);
  const direct = await q(pool, "SELECT source FROM pipeline WHERE created_at >= $1 AND created_at < $2 AND COALESCE(source, '') NOT LIKE 'Prospecting:%'", [b.fromTs, b.toTs]);
  const leadsIn = prospects.concat(direct);
  const calls = (await one(pool, "SELECT count(*)::int AS n FROM encounters WHERE archived_at IS NULL AND left(occurred_at, 10) >= $1 AND left(occurred_at, 10) <= $2", [b.weekOf, b.sunday])).n || 0;
  const active = (await one(pool, "SELECT count(*)::int AS n FROM pipeline WHERE archived_at IS NULL AND stage = ANY($1)", [ACTIVE])).n || 0;
  const won = (await one(pool, "SELECT count(DISTINCT pipeline_id)::int AS n FROM pipeline_stage_events WHERE at >= $1 AND at < $2 AND to_stage = ANY($3) AND (from_stage IS NULL OR NOT (from_stage = ANY($4)))", [b.fromTs, b.toTs, WON_TO, WON_TO.concat(["graduated"])])).n || 0;
  const lost = (await one(pool, "SELECT count(DISTINCT pipeline_id)::int AS n FROM pipeline_stage_events WHERE at >= $1 AND at < $2 AND to_stage = 'lost' AND from_stage IS NOT NULL", [b.fromTs, b.toTs])).n || 0;
  const booked = Number((await one(pool, "SELECT COALESCE(sum(amount), 0) AS s FROM invoices WHERE archived_at IS NULL AND status IN ('sent', 'paid') AND issued_date >= $1 AND issued_date <= $2", [b.weekOf, b.sunday])).s) || 0;
  const collected = Number((await one(pool, "SELECT COALESCE(sum(amount), 0) AS s FROM invoices WHERE archived_at IS NULL AND COALESCE(paid_date, '') <> '' AND paid_date >= $1 AND paid_date <= $2", [b.weekOf, b.sunday])).s) || 0;
  const tracking = (await one(pool, "SELECT min(at) AS first FROM pipeline_stage_events")).first || "";
  return {
    weekOf, calls, leads: leadsIn.length, active, won, lost,
    referrals: leadsIn.filter((x) => /referr/i.test(x.source || "")).length,
    revenueBooked: booked, revenueCollected: collected,
    // Wins and losses come from stage changes, which are recorded from the day this shipped.
    stageTrackingSince: tracking ? tracking.slice(0, 10) : "",
  };
}

// Fill in (or refresh) the week's row. Never touches a row the owner typed
// or confirmed.
async function fillWeek(pool, weekOf) {
  const rows = await q(pool, "SELECT * FROM scorecard WHERE week_of = $1 AND archived_at IS NULL ORDER BY created_at", [weekOf]);
  const mine = rows.find((r) => !r.auto || r.confirmed_at);
  if (mine) return { id: mine.id, status: "kept" };
  const n = await compute(pool, weekOf), now = new Date().toISOString();
  const auto = rows.find((r) => r.auto);
  if (auto) {
    await pool.query("UPDATE scorecard SET calls=$1, leads=$2, active=$3, won=$4, lost=$5, referrals=$6, revenue_booked=$7, revenue_collected=$8, updated_at=$9 WHERE id=$10",
      [n.calls, n.leads, n.active, n.won, n.lost, n.referrals, n.revenueBooked, n.revenueCollected, now, auto.id]);
    return { id: auto.id, status: "refreshed" };
  }
  const id = newId();
  await pool.query(`INSERT INTO scorecard (id, week_of, calls, leads, active, won, lost, referrals, notes, revenue_booked, revenue_collected, created_at, auto, confirmed_at, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'',$9,$10,$11,true,'',$11)`,
    [id, weekOf, n.calls, n.leads, n.active, n.won, n.lost, n.referrals, n.revenueBooked, n.revenueCollected, now]);
  return { id, status: "created" };
}

// ---------- 2. the brief ----------
const FIELDS = ["calls", "leads", "active", "won", "lost", "referrals", "revenueBooked", "revenueCollected"];
const COL = { calls: "calls", leads: "leads", active: "active", won: "won", lost: "lost", referrals: "referrals", revenueBooked: "revenue_booked", revenueCollected: "revenue_collected" };

async function buildBrief(pool, weekOf) {
  const today = etDate();
  const row = (await q(pool, "SELECT * FROM scorecard WHERE week_of = $1 AND archived_at IS NULL ORDER BY (NOT auto OR confirmed_at <> '') DESC, created_at LIMIT 1", [weekOf]))[0];
  const numbers = row ? Object.fromEntries(FIELDS.map((f) => [f, Number(row[COL[f]]) || 0])) : await compute(pool, weekOf);
  const prior = await q(pool, "SELECT DISTINCT ON (week_of) * FROM scorecard WHERE archived_at IS NULL AND week_of < $1 AND week_of >= $2 ORDER BY week_of, (NOT auto OR confirmed_at <> '') DESC, created_at", [weekOf, addDays(weekOf, -28)]);
  const average = prior.length ? Object.fromEntries(FIELDS.map((f) => [f, Math.round(10 * prior.reduce((s, r) => s + (Number(r[COL[f]]) || 0), 0) / prior.length) / 10])) : null;

  const flags = [];
  const flag = (level, text, issue, go) => flags.push({ level, text, issue: issue || "", go: go || "" });

  // Leads: anything new in the last 14 days?
  const since14 = etMidnightIso(addDays(today, -14));
  const recentLeads = (await one(pool, "SELECT (SELECT count(*) FROM prospects WHERE created_at >= $1 AND NOT (COALESCE(source, '') = ANY($2))) + (SELECT count(*) FROM pipeline WHERE created_at >= $1 AND COALESCE(source, '') NOT LIKE 'Prospecting:%') AS n", [since14, RESEARCH_SOURCES])).n;
  if (Number(recentLeads) === 0) flag("warn", "No new leads in the last two weeks.", "No new leads in two weeks: what fills the pipeline next?", "pipeline");

  // Money: overdue invoices.
  const overdue = await q(pool, "SELECT i.amount, i.due_date, p.org, p.name FROM invoices i LEFT JOIN pipeline p ON p.id = i.pipeline_id WHERE i.archived_at IS NULL AND i.status = 'sent' AND COALESCE(i.due_date, '') <> '' AND i.due_date < $1 ORDER BY i.due_date", [today]);
  if (overdue.length) {
    const sum = overdue.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    flag("warn", `${overdue.length} invoice${overdue.length === 1 ? "" : "s"} overdue, ${money(sum)} in all (oldest due ${nice(overdue[0].due_date)}).`, `Collect ${money(sum)} in overdue invoices`, "finance");
  }

  // Deals: next steps past due, or nothing touched in three weeks.
  const deals = await q(pool, "SELECT id, org, name, stage, next_step, next_step_date, updated_at FROM pipeline WHERE archived_at IS NULL AND stage = ANY($1)", [["lead"].concat(ACTIVE)]);
  const late = deals.filter((d) => d.next_step_date && d.next_step_date < today);
  const quiet = deals.filter((d) => !(d.next_step_date && d.next_step_date >= today) && (d.updated_at || "") < etMidnightIso(addDays(today, -21)));
  if (late.length) flag("attn", `${late.length} deal${late.length === 1 ? " has a next step" : "s have next steps"} past due: ${late.slice(0, 3).map((d) => d.org || d.name).join(", ")}${late.length > 3 ? ", and more" : ""}.`, late.length === 1 ? `Move ${late[0].org || late[0].name} forward or close it` : `${late.length} deals with next steps past due`, "pipeline");
  const quietOnly = quiet.filter((d) => !late.includes(d));
  if (quietOnly.length) flag("attn", `${quietOnly.length} deal${quietOnly.length === 1 ? "" : "s"} untouched for three weeks or more with no next step booked.`, "Decide which quiet deals to revive and which to close", "pipeline");

  // Priorities.
  const rocks = await q(pool, "SELECT id, title, status, due_date FROM rocks WHERE archived_at IS NULL AND status <> 'done' ORDER BY due_date NULLS LAST");
  rocks.filter((r) => r.status === "off-track").forEach((r) => flag("warn", `Priority off track: ${r.title}.`, `Get "${r.title}" back on track`, "direction"));
  rocks.filter((r) => r.status !== "off-track" && r.due_date && r.due_date <= addDays(today, 14)).forEach((r) => flag("attn", `Priority due ${r.due_date < today ? "already (" + nice(r.due_date) + ")" : "within two weeks (" + nice(r.due_date) + ")"}: ${r.title}.`, r.due_date < today ? `"${r.title}" is past due: finish it, move the date, or drop it` : "", "direction"));

  // Checklist steps overdue.
  let stepsLate = 0;
  for (const r of await q(pool, "SELECT steps FROM proc_runs WHERE archived_at IS NULL AND NOT skipped AND COALESCE(completed_on, '') = ''")) {
    try { (JSON.parse(r.steps || "[]") || []).forEach((s) => { if (!s.doneOn && s.dueOn && s.dueOn < today) stepsLate++; }); } catch (e) { /* skip */ }
  }
  if (stepsLate) flag("attn", `${stepsLate} checklist step${stepsLate === 1 ? "" : "s"} overdue.`, stepsLate >= 3 ? "Checklist steps keep slipping: what's in the way?" : "", "process");

  const waiting = (await one(pool, "SELECT count(*)::int AS n FROM proc_outbox o LEFT JOIN proc_runs r ON r.id = o.run_id WHERE o.status = 'draft' AND (r.id IS NULL OR r.archived_at IS NULL)")).n || 0;
  if (waiting) flag("attn", `${waiting} message${waiting === 1 ? "" : "s"} waiting for your approval.`, "", "process");

  const stale = await q(pool, "SELECT title FROM issues WHERE archived_at IS NULL AND status <> 'solved' AND created_at < $1", [etMidnightIso(addDays(today, -30))]);
  if (stale.length) flag("attn", `${stale.length} issue${stale.length === 1 ? " has" : "s have"} been open more than 30 days.`, "", "session");

  // Week-over-week: a number well below its average.
  if (average) {
    if (average.leads >= 2 && numbers.leads <= average.leads / 2) flag("attn", `New leads (${numbers.leads}) were less than half the recent average (${average.leads}).`, "", "pipeline");
    if (average.calls >= 2 && numbers.calls <= average.calls / 2) flag("attn", `Conversations logged (${numbers.calls}) were less than half the recent average (${average.calls}).`, "", "pipeline");
  }

  const open = new Set((await q(pool, "SELECT lower(title) AS t FROM issues WHERE archived_at IS NULL AND status <> 'solved'")).map((r) => r.t));
  const suggestions = flags.filter((f) => f.issue && !open.has(f.issue.toLowerCase())).map((f) => f.issue).filter((v, i, a) => a.indexOf(v) === i).slice(0, 3);

  return {
    weekOf, sunday: addDays(weekOf, 6), generatedAt: new Date().toISOString(),
    numbers, average, priorWeeks: prior.length,
    scorecard: row ? { id: row.id, auto: !!row.auto, confirmed: !row.auto || !!row.confirmed_at, confirmedAt: row.confirmed_at || "" } : null,
    flags: flags.sort((a, b) => (a.level === "warn" ? 0 : 1) - (b.level === "warn" ? 0 : 1)),
    suggestions,
    priorities: rocks.map((r) => ({ id: r.id, title: r.title, status: r.status, dueDate: r.due_date || "" })),
  };
}

async function aiSummary(pool, brief) {
  if (!(await AI.enabled(pool))) return "";
  const n = brief.numbers, a = brief.average;
  const text = await AI.ask(pool, {
    system: "Write a short summary of a consulting practice's week for the owner's weekly meeting.",
    prompt: `Week of ${brief.weekOf} to ${brief.sunday}.
Numbers: ${FIELDS.map((f) => `${f} ${n[f]}${a ? ` (4-week average ${a[f]})` : ""}`).join("; ")}.
What needs attention:
${brief.flags.map((f) => "- " + f.text).join("\n") || "- nothing flagged"}
Priorities not done: ${brief.priorities.map((p) => `${p.title} (${p.status})`).join("; ") || "none"}.

In three or four sentences: what happened, what changed against the average, and the one thing most worth the owner's attention. Use only these facts. No headings, no lists.`,
    maxTokens: 400,
  });
  return String(text || "").trim();
}

async function prepare(pool, weekOf, { ai } = {}) {
  await fillWeek(pool, weekOf);
  const brief = await buildBrief(pool, weekOf);
  const existing = (await q(pool, "SELECT * FROM weekly_meetings WHERE week_of = $1", [weekOf]))[0];
  let summary = existing ? existing.ai_summary : "";
  if (ai && !summary) { try { summary = await aiSummary(pool, brief); } catch (e) { summary = ""; } }
  await pool.query(`INSERT INTO weekly_meetings (week_of, brief, ai_summary, generated_at) VALUES ($1, $2, $3, $4)
    ON CONFLICT (week_of) DO UPDATE SET brief = EXCLUDED.brief, ai_summary = EXCLUDED.ai_summary, generated_at = EXCLUDED.generated_at`,
    [weekOf, JSON.stringify(brief), summary, brief.generatedAt]);
  return getMeeting(pool, weekOf);
}

async function getMeeting(pool, weekOf) {
  const m = (await q(pool, "SELECT * FROM weekly_meetings WHERE week_of = $1", [weekOf]))[0];
  if (!m) return null;
  let brief = {}; try { brief = JSON.parse(m.brief || "{}"); } catch (e) { brief = {}; }
  return Object.assign(brief, { weekOf, aiSummary: m.ai_summary || "", decision: m.decision || "", issueId: m.issue_id || "", heldAt: m.held_at || "" });
}

// Run from the automation tick. Prepares last week's meeting once the week
// is over, keeps it current until the meeting is held, and writes the AI
// summary once.
async function tick(pool) {
  const wk = lastWeek();
  const m = (await q(pool, "SELECT held_at, generated_at FROM weekly_meetings WHERE week_of = $1", [wk]))[0];
  if (m && m.held_at) return { weekOf: wk, status: "held" };
  await prepare(pool, wk, { ai: true });
  return { weekOf: wk, status: m ? "refreshed" : "prepared" };
}

function mount(app, { pool, requireAuth }) {
  const wrap = (fn) => async (req, res) => { try { await fn(req, res); } catch (err) { if (!err.status) console.error("weekly", err); res.status(err.status || 500).json({ error: String(err.message || err) }); } };
  const week = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || "") ? mondayOf(v) : lastWeek());

  // The meeting brief for a week (last week by default).
  app.get("/api/weekly/brief", requireAuth, wrap(async (req, res) => {
    const wk = week(req.query.week);
    let m = await getMeeting(pool, wk);
    // Until the meeting is closed, opening it recounts (cheap) so late entries show up.
    if (!m || !m.heldAt) m = await prepare(pool, wk, { ai: false });
    res.json(m);
  }));
  app.post("/api/weekly/refresh", requireAuth, wrap(async (req, res) => res.json(await prepare(pool, week((req.body || {}).weekOf), { ai: !!(req.body || {}).ai }))));
  app.get("/api/weekly/compute", requireAuth, wrap(async (req, res) => res.json(await compute(pool, week(req.query.week)))));

  // Confirm (and optionally correct) a week's numbers.
  app.post("/api/weekly/confirm", requireAuth, wrap(async (req, res) => {
    const b = req.body || {}, wk = week(b.weekOf), now = new Date().toISOString();
    const vals = FIELDS.map((f) => Math.max(0, Number(b[f]) || 0));
    const row = (await q(pool, "SELECT id FROM scorecard WHERE week_of = $1 AND archived_at IS NULL ORDER BY (NOT auto OR confirmed_at <> '') DESC, created_at LIMIT 1", [wk]))[0];
    if (row) await pool.query("UPDATE scorecard SET calls=$1, leads=$2, active=$3, won=$4, lost=$5, referrals=$6, revenue_booked=$7, revenue_collected=$8, confirmed_at=$9, updated_at=$9 WHERE id=$10", vals.concat([now, row.id]));
    else await pool.query(`INSERT INTO scorecard (id, week_of, calls, leads, active, won, lost, referrals, notes, revenue_booked, revenue_collected, created_at, auto, confirmed_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'',$9,$10,$11,false,$11,$11)`, [newId(), wk].concat(vals).concat([now]));
    res.json(await prepare(pool, wk, { ai: false }));
  }));

  // Record the meeting: the one issue picked and the decision made.
  app.post("/api/weekly/decision", requireAuth, wrap(async (req, res) => {
    const b = req.body || {}, wk = week(b.weekOf), decision = String(b.decision || "").trim().slice(0, 2000);
    if (!decision) return res.status(400).json({ error: "Write down the decision first." });
    if (!(await getMeeting(pool, wk))) await prepare(pool, wk, { ai: false });
    await pool.query("UPDATE weekly_meetings SET decision = $1, issue_id = $2, held_at = $3 WHERE week_of = $4", [decision, String(b.issueId || ""), new Date().toISOString(), wk]);
    if (b.issueId) await pool.query("UPDATE issues SET detail = CASE WHEN COALESCE(detail, '') = '' THEN $1 ELSE detail || E'\\n' || $1 END WHERE id = $2", [`Week of ${wk}: ${decision}`, b.issueId]).catch(() => {});
    res.json(await getMeeting(pool, wk));
  }));

  // Past meetings, newest first.
  app.get("/api/weekly/history", requireAuth, wrap(async (req, res) => {
    const rows = await q(pool, "SELECT m.week_of, m.decision, m.held_at, i.title AS issue FROM weekly_meetings m LEFT JOIN issues i ON i.id = m.issue_id WHERE m.held_at <> '' ORDER BY m.week_of DESC LIMIT 26");
    res.json({ items: rows.map((r) => ({ weekOf: r.week_of, decision: r.decision, heldAt: r.held_at, issue: r.issue || "" })) });
  }));
}

module.exports = { mount, tick, compute, fillWeek, buildBrief, prepare, getMeeting, lastWeek, mondayOf, bounds };
