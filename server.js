"use strict";

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const cookieParser = require("cookie-parser");
const compression = require("compression");
const helmet = require("helmet");
const { Pool } = require("pg");

const PORT = process.env.PORT || 10000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const COOKIE_NAME = "fios_session";
const COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

if (!ADMIN_PASSWORD || !ADMIN_API_TOKEN || !SESSION_SECRET) {
  console.error("Missing required env vars: ADMIN_PASSWORD, ADMIN_API_TOKEN, SESSION_SECRET must all be set.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("localhost")
    ? { rejectUnauthorized: false }
    : undefined
});

async function initSchema() {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(schema);
  console.log("Schema ready.");
}

// ---------- signed cookie session (shared password, no per-user accounts) ----------
function sign(value) {
  const h = crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
  return `${value}.${h}`;
}
function verify(token) {
  if (!token || typeof token !== "string") return false;
  const idx = token.lastIndexOf(".");
  if (idx < 0) return false;
  const value = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  const expiry = Number(value);
  if (!Number.isFinite(expiry) || Date.now() > expiry) return false;
  return true;
}
function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA); // keep timing roughly constant
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireAuth(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  if (verify(token)) return next();
  return res.status(401).json({ error: "not authenticated" });
}

// Per-automation scoped tokens, layered on top of the one shared
// ADMIN_API_TOKEN rather than replacing it. Every one of these env vars is
// optional and empty by default - until Franklin actually sets one on
// Render, its scope simply has no scoped token and only the master token
// (or a logged-in session) opens it, exactly like before this existed. The
// master token keeps working everywhere on purpose: it's the backward
// compatible fallback for every automation prompt that hasn't been swapped
// to its own scoped token yet, and it's what Franklin uses himself for a
// manual/emergency call from a terminal.
const ADMIN_SCOPE_TOKENS = {
  gifts: process.env.ADMIN_TOKEN_GIFTS || "",
  prospects: process.env.ADMIN_TOKEN_PROSPECTS || "",
  digest: process.env.ADMIN_TOKEN_DIGEST || "",
  backup: process.env.ADMIN_TOKEN_BACKUP || "",
  restore: process.env.ADMIN_TOKEN_RESTORE || "",
  status: process.env.ADMIN_TOKEN_STATUS || "",
  calendar: process.env.ADMIN_TOKEN_CALENDAR || "",
  giftPatterns: process.env.ADMIN_TOKEN_GIFT_PATTERNS || "",
  // InstitutionalOS pushes Diagnostic results back here (POST /api/admin/ios-sync).
  // Same value as OS_IOS_TOKEN on the grantpass-backend service.
  ios: process.env.ADMIN_TOKEN_IOS || ""
};
function requireAdminScope(scope) {
  return function (req, res, next) {
    const provided = req.get("X-Admin-Token") || "";
    if (timingSafeStringEqual(provided, ADMIN_API_TOKEN)) return next();
    const scoped = ADMIN_SCOPE_TOKENS[scope];
    if (scoped && timingSafeStringEqual(provided, scoped)) return next();
    // Also accept the same signed session cookie the rest of the app uses, so the
    // backup/restore endpoints can be driven from an already-logged-in browser
    // session during a database migration without anyone having to type the
    // admin token anywhere.
    const sessionToken = req.cookies[COOKIE_NAME];
    if (verify(sessionToken)) return next();
    return res.status(401).json({ error: "invalid admin token" });
  };
}

// ---------- login rate limiting ----------
// There are no per-user accounts here, just one shared password (see above),
// which means the login endpoint is the entire attack surface for a guessed
// or leaked password. This is a plain in-memory limiter, not a distributed
// one - fine for a single-instance app like this, and cheap enough that it
// costs nothing if the deployment ever changes. Counts are per source IP;
// `app.set("trust proxy", 1)` below is what makes req.ip the real visitor
// address rather than Render's edge proxy for every request.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;
const loginAttempts = new Map(); // ip -> { count, windowStart }
function loginRateLimited(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now - entry.windowStart > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count++;
  return entry.count > LOGIN_MAX_ATTEMPTS;
}
setInterval(() => {
  const cutoff = Date.now() - LOGIN_WINDOW_MS;
  for (const [ip, entry] of loginAttempts) {
    if (entry.windowStart < cutoff) loginAttempts.delete(ip);
  }
}, LOGIN_WINDOW_MS).unref();

const app = express();
app.set("trust proxy", 1);
// CSP is deliberately left off - index.html uses inline style="..." attributes
// throughout, and helmet's default CSP would block them and break the page's
// layout. Turning on a real CSP is real follow-up work (move those onto
// classes first), not something to ship blind. Everything else helmet does
// by default still applies: X-Content-Type-Options: nosniff, a frame-options
// header, dropping the X-Powered-By: Express fingerprint, and a few others.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// ---------- auth routes ----------
app.post("/api/login", (req, res) => {
  if (loginRateLimited(req.ip)) {
    return res.status(429).json({ error: "Too many attempts. Wait a few minutes and try again." });
  }
  const { password } = req.body || {};
  if (!password || !timingSafeStringEqual(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ error: "incorrect password" });
  }
  const expiry = Date.now() + COOKIE_MAX_AGE_MS;
  const token = sign(String(expiry));
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE_MS
  });
  res.json({ ok: true });
});

app.post("/api/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

app.get("/api/session", (req, res) => {
  const token = req.cookies[COOKIE_NAME];
  res.json({ authenticated: verify(token) });
});

// ---------- bootstrap: everything the app needs in one call ----------
app.get("/api/state", requireAuth, async (req, res) => {
  try {
    const [pipeline, scorecard, issues, rocks, prospects, digest, gifts, visionRes, orgLinks, invoices, engagementModules, timeEntries, encounters, advancementStateRes, quizAttempts, weekEventsRes, giftPatternsRes, problemLog, feedbackRes] = await Promise.all([
      pool.query("SELECT * FROM pipeline WHERE archived_at IS NULL ORDER BY created_at DESC"),
      pool.query("SELECT * FROM scorecard WHERE archived_at IS NULL ORDER BY week_of DESC"),
      pool.query("SELECT * FROM issues WHERE archived_at IS NULL ORDER BY created_at DESC"),
      pool.query("SELECT * FROM rocks WHERE archived_at IS NULL ORDER BY due_date ASC NULLS LAST"),
      pool.query("SELECT * FROM prospects WHERE archived_at IS NULL ORDER BY created_at DESC"),
      pool.query("SELECT * FROM digest ORDER BY id ASC"),
      pool.query("SELECT * FROM gifts WHERE archived_at IS NULL ORDER BY announced_at DESC NULLS LAST, logged_at DESC"),
      pool.query("SELECT * FROM vision WHERE id = 'main'"),
      pool.query("SELECT * FROM org_ein_links"),
      pool.query("SELECT * FROM invoices WHERE archived_at IS NULL ORDER BY due_date ASC NULLS LAST"),
      pool.query("SELECT * FROM engagement_modules WHERE archived_at IS NULL ORDER BY created_at ASC"),
      pool.query("SELECT * FROM time_entries WHERE archived_at IS NULL ORDER BY entry_date DESC"),
      pool.query("SELECT * FROM encounters WHERE archived_at IS NULL ORDER BY occurred_at DESC NULLS LAST, created_at DESC"),
      pool.query("SELECT * FROM advancement_state WHERE id = 'main'"),
      pool.query("SELECT * FROM quiz_attempts WHERE archived_at IS NULL ORDER BY taken_at DESC NULLS LAST, created_at DESC LIMIT 200"),
      pool.query("SELECT * FROM week_events ORDER BY starts_at ASC"),
      pool.query("SELECT * FROM gift_pattern_digests WHERE id = 'main'")
    ,
      pool.query("SELECT * FROM problem_log WHERE archived_at IS NULL ORDER BY logged_on DESC NULLS LAST, created_at DESC"),
      pool.query("SELECT * FROM feedback WHERE archived_at IS NULL ORDER BY created_at DESC")]);
    res.json({
      pipeline: pipeline.rows.map(rowToPipeline),
      scorecard: scorecard.rows.map(rowToScorecard),
      issues: issues.rows.map(rowToIssue),
      rocks: rocks.rows.map(rowToRock),
      prospects: prospects.rows.map(rowToProspect),
      digest: digest.rows.map(rowToDigest),
      gifts: gifts.rows.map(rowToGift),
      vision: visionRes.rows[0] ? rowToVision(visionRes.rows[0]) : null,
      orgLinks: orgLinks.rows.map(rowToOrgLink),
      invoices: invoices.rows.map(rowToInvoice),
      engagementModules: engagementModules.rows.map(rowToEngagementModule),
      timeEntries: timeEntries.rows.map(rowToTimeEntry),
      encounters: encounters.rows.map(rowToEncounter),
      problemLog: problemLog.rows.map(rowToProblem),
      feedback: feedbackRes.rows.map(rowToFeedback),
      advancementState: advancementStateRes.rows[0] ? rowToAdvancementState(advancementStateRes.rows[0]) : { weekProgress: {}, credPursuing: {} },
      quizAttempts: quizAttempts.rows.map(rowToQuizAttempt),
      weekEvents: weekEventsRes.rows.map(rowToWeekEvent),
      giftPatterns: giftPatternsRes.rows[0] ? rowToGiftPatternDigest(giftPatternsRes.rows[0]) : null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "failed to load state" });
  }
});

function rowToPipeline(r) {
  return { id: r.id, name: r.name, org: r.org, source: r.source, track: r.track, stage: r.stage, nextStep: r.next_step, nextStepDate: r.next_step_date, notes: r.notes, dealValue: r.deal_value === null ? 0 : Number(r.deal_value), diagnosticStage: r.diagnostic_stage || "", createdAt: r.created_at, updatedAt: r.updated_at,
    trigger: r.trigger_key || "", selfScores: safeJsonParse(r.self_scores || "", null),
    ios: r.ios_org_id ? {
      orgId: r.ios_org_id, portalUrl: r.ios_portal_url || "", overall: r.ios_overall === null || r.ios_overall === undefined ? null : Number(r.ios_overall),
      decision: r.ios_decision || "", constraint: r.ios_constraint || "", nextSession: r.ios_next_session || "",
      record: safeJsonParse(r.ios_record || "", null), syncedAt: r.ios_synced_at || null
    } : null,
    iosLinkError: r.ios_link_error || "" };
}
function rowToFeedback(r) {
  return { id: r.id, sourceRef: r.source_ref, name: r.name, email: r.email, role: r.role, organization: r.organization, rating: r.rating, result: r.result, quote: r.quote, permission: r.permission, status: r.status, createdAt: r.created_at };
}
function rowToScorecard(r) {
  return { id: r.id, weekOf: r.week_of, calls: r.calls, leads: r.leads, active: r.active, won: r.won, lost: r.lost, referrals: r.referrals, notes: r.notes, revenueBooked: r.revenue_booked === null ? 0 : Number(r.revenue_booked), revenueCollected: r.revenue_collected === null ? 0 : Number(r.revenue_collected), createdAt: r.created_at };
}
function rowToIssue(r) {
  return { id: r.id, title: r.title, detail: r.detail, status: r.status, createdAt: r.created_at, resolvedAt: r.resolved_at };
}
function rowToRock(r) {
  return { id: r.id, title: r.title, quarter: r.quarter, dueDate: r.due_date, notes: r.notes, status: r.status, createdAt: r.created_at };
}
function rowToProspect(r) {
  return { id: r.id, name: r.name, org: r.org, source: r.source, status: r.status, link: r.link, notes: r.notes, createdAt: r.created_at, sourceRef: r.source_ref, interest: r.interest || "", orgStage: r.org_stage || "", trigger: r.trigger_key || "", selfScores: safeJsonParse(r.self_scores || "", null) };
}
function rowToDigest(r) {
  return { id: r.id, category: r.category, headline: r.headline, summary: r.summary, source: r.source, url: r.url, loggedAt: r.logged_at };
}
function rowToGift(r) {
  return { id: r.id, donor: r.donor, org: r.org, state: r.state, category: r.category, amount: r.amount === null ? 0 : Number(r.amount), headline: r.headline, summary: r.summary, source: r.source, url: r.url, announcedAt: r.announced_at, loggedAt: r.logged_at, giftType: r.gift_type, restriction: r.restriction, impact: r.impact, trendSignal: r.trend_signal, playbook: r.playbook, publicOk: r.public_ok === true, higherEd: r.higher_ed === true };
}
function rowToVision(r) {
  return { values: r.values_text, focus: r.focus, tenYear: r.ten_year, marketing: r.marketing, threeYear: r.three_year, oneYear: r.one_year, updatedAt: r.updated_at };
}
function rowToOrgLink(r) {
  return { org: r.org_name, ein: r.ein, matchedName: r.matched_name, matchedCity: r.matched_city, matchedState: r.matched_state, linkedAt: r.linked_at };
}
function rowToInvoice(r) {
  return { id: r.id, pipelineId: r.pipeline_id, offering: r.offering, amount: r.amount === null ? 0 : Number(r.amount), issuedDate: r.issued_date, dueDate: r.due_date, paidDate: r.paid_date, status: r.status, notes: r.notes, createdAt: r.created_at, updatedAt: r.updated_at };
}
function rowToEngagementModule(r) {
  return { id: r.id, pipelineId: r.pipeline_id, moduleName: r.module_name, status: r.status, sessionDate: r.session_date, deliverableLink: r.deliverable_link, notes: r.notes, createdAt: r.created_at, updatedAt: r.updated_at };
}
function rowToTimeEntry(r) {
  return { id: r.id, pipelineId: r.pipeline_id, entryDate: r.entry_date, minutes: r.minutes === null ? 0 : Number(r.minutes), note: r.note, createdAt: r.created_at };
}
const TRIGGER_KEYS = new Set(["expansion", "funder", "founder", "strain", "transition", "checkup"]);
const PROBLEM_KINDS = new Set(["interview", "discovery", "diagnostic"]);
const WHO_PAYS = new Set(["organization", "board", "funder", "unknown"]);
function rowToProblem(r) {
  return { id: r.id, loggedOn: r.logged_on, kind: r.kind, organization: r.organization, orgType: r.org_type, orgSize: r.org_size, trigger: r.trigger_key, presentingProblem: r.presenting_problem, verifiedConstraint: r.verified_constraint, differs: r.differs, atStake: r.at_stake, whoPays: r.who_pays, notes: r.notes, createdAt: r.created_at, sourceRef: r.source_ref || "" };
}
function rowToEncounter(r) {
  return { id: r.id, pipelineId: r.pipeline_id, contactName: r.contact_name, occurredAt: r.occurred_at, interactionType: r.interaction_type, relationshipStage: r.relationship_stage, reason: r.reason, nextStep: r.next_step, nextStepDate: r.next_step_date, summary: r.summary, loggedBy: r.logged_by, createdAt: r.created_at };
}
function safeJsonParse(s, fallback) {
  try { return JSON.parse(s); } catch (e) { return fallback; }
}
function rowToAdvancementState(r) {
  return { weekProgress: safeJsonParse(r.week_progress, {}), credPursuing: safeJsonParse(r.cred_pursuing, {}), updatedAt: r.updated_at };
}
function rowToWeekEvent(r) {
  return { id: r.id, title: r.title, startsAt: r.starts_at, endsAt: r.ends_at, location: r.location, url: r.url, status: r.status, statusLabel: r.status_label, cta: r.cta };
}
function rowToGiftPatternDigest(r) {
  return { content: r.content, windowLabel: r.window_label, giftCount: r.gift_count === null ? 0 : Number(r.gift_count), updatedAt: r.updated_at };
}
function rowToQuizAttempt(r) {
  return { id: r.id, examKey: r.exam_key, examLabel: r.exam_label, score: r.score, total: r.total, domainBreakdown: safeJsonParse(r.domain_breakdown, {}), takenAt: r.taken_at, createdAt: r.created_at };
}

function newId() {
  return crypto.randomUUID();
}

// Soft delete: every "Remove" action in the UI lands here instead of a real
// DELETE, so a misclick (or a bad automated import) never actually destroys
// data - it just stops showing up in /api/state. `table` is always one of a
// fixed set of literals from the call sites below, never request input.
function archiveRow(table, id) {
  return pool.query(`UPDATE ${table} SET archived_at = $1 WHERE id = $2`, [new Date().toISOString(), id]);
}

// ---------- pipeline ----------
// Offer alignment with franklyinspired.associates: a website lead's
// interest (an invoices.offering key) maps onto the pipeline track it
// belongs to, and its lifecycle stage carries over as diagnostic_stage.
const DIAGNOSTIC_STAGES = new Set(["build", "fund", "sustain"]);
const INTEREST_KEYS = new Set(["institutionalos-diagnostic", "retainer", "project", "coaching", "speaking"]);
const INTEREST_TO_TRACK = { "institutionalos-diagnostic": "institutionalos", retainer: "retainer", project: "consulting", coaching: "coaching", speaking: "speaking" };

app.post("/api/pipeline", requireAuth, async (req, res) => {
  const b = req.body || {};
  const id = newId();
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO pipeline (id, name, org, source, track, stage, next_step, next_step_date, notes, deal_value, diagnostic_stage, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)`,
    [id, b.name || "", b.org || "", b.source || "", b.track || "undecided", b.stage || "lead", b.nextStep || "", b.nextStepDate || "", b.notes || "", Number(b.dealValue || 0), DIAGNOSTIC_STAGES.has(b.diagnosticStage) ? b.diagnosticStage : "", now]
  );
  res.json({ id });
});
app.patch("/api/pipeline/:id", requireAuth, async (req, res) => {
  const b = req.body || {};
  const fields = [];
  const values = [];
  let i = 1;
  const map = { stage: "stage", nextStep: "next_step", nextStepDate: "next_step_date", notes: "notes", name: "name", org: "org", source: "source", track: "track", dealValue: "deal_value", diagnosticStage: "diagnostic_stage" };
  for (const key of Object.keys(map)) {
    if (Object.prototype.hasOwnProperty.call(b, key)) {
      fields.push(`${map[key]} = $${i++}`);
      values.push(b[key]);
    }
  }
  fields.push(`updated_at = $${i++}`);
  values.push(new Date().toISOString());
  values.push(req.params.id);
  if (fields.length === 1) return res.json({ ok: true });
  await pool.query(`UPDATE pipeline SET ${fields.join(", ")} WHERE id = $${i}`, values);
  // Moving a deal into the InstitutionalOS Diagnostic stage opens its client
  // record in InstitutionalOS (once), so the two systems share one record.
  if (b.stage === "assessment") {
    const { rows } = await pool.query("SELECT ios_org_id FROM pipeline WHERE id = $1", [req.params.id]);
    if (rows[0] && !rows[0].ios_org_id) {
      const link = await linkToIOS(req.params.id);
      return res.json({ ok: true, ios: link });
    }
  }
  res.json({ ok: true });
});
app.post("/api/pipeline/:id/link-ios", requireAuth, async (req, res) => {
  const link = await linkToIOS(req.params.id);
  res.status(link.ok ? 200 : 502).json(link);
});
app.delete("/api/pipeline/:id", requireAuth, async (req, res) => {
  await archiveRow("pipeline", req.params.id);
  res.json({ ok: true });
});

// ---------- scorecard ----------
app.post("/api/scorecard", requireAuth, async (req, res) => {
  const b = req.body || {};
  const id = newId();
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO scorecard (id, week_of, calls, leads, active, won, lost, referrals, notes, revenue_booked, revenue_collected, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [id, b.weekOf || "", Number(b.calls || 0), Number(b.leads || 0), Number(b.active || 0), Number(b.won || 0), Number(b.lost || 0), Number(b.referrals || 0), b.notes || "", Number(b.revenueBooked || 0), Number(b.revenueCollected || 0), now]
  );
  res.json({ id });
});
app.delete("/api/scorecard/:id", requireAuth, async (req, res) => {
  await archiveRow("scorecard", req.params.id);
  res.json({ ok: true });
});

// ---------- issues ----------
app.post("/api/issues", requireAuth, async (req, res) => {
  const b = req.body || {};
  const id = newId();
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO issues (id, title, detail, status, created_at) VALUES ($1,$2,$3,'open',$4)`,
    [id, b.title || "", b.detail || "", now]
  );
  res.json({ id });
});
app.patch("/api/issues/:id", requireAuth, async (req, res) => {
  const b = req.body || {};
  if (b.status === "solved") {
    await pool.query("UPDATE issues SET status = $1, resolved_at = $2 WHERE id = $3", [b.status, new Date().toISOString(), req.params.id]);
  } else if (b.status) {
    await pool.query("UPDATE issues SET status = $1 WHERE id = $2", [b.status, req.params.id]);
  }
  res.json({ ok: true });
});
app.delete("/api/issues/:id", requireAuth, async (req, res) => {
  await archiveRow("issues", req.params.id);
  res.json({ ok: true });
});

// ---------- rocks ----------
app.post("/api/rocks", requireAuth, async (req, res) => {
  const b = req.body || {};
  const id = newId();
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO rocks (id, title, quarter, due_date, notes, status, created_at) VALUES ($1,$2,$3,$4,$5,'on-track',$6)`,
    [id, b.title || "", b.quarter || "", b.dueDate || "", b.notes || "", now]
  );
  res.json({ id });
});
app.patch("/api/rocks/:id", requireAuth, async (req, res) => {
  const b = req.body || {};
  if (b.status) {
    await pool.query("UPDATE rocks SET status = $1 WHERE id = $2", [b.status, req.params.id]);
  }
  res.json({ ok: true });
});
app.delete("/api/rocks/:id", requireAuth, async (req, res) => {
  await archiveRow("rocks", req.params.id);
  res.json({ ok: true });
});

// ---------- prospects ----------
app.post("/api/prospects", requireAuth, async (req, res) => {
  const b = req.body || {};
  const id = newId();
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO prospects (id, name, org, source, status, link, notes, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, b.name || "", b.org || "", b.source || "linkedin", b.status || "new", b.link || "", b.notes || "", now]
  );
  res.json({ id });
});
app.patch("/api/prospects/:id", requireAuth, async (req, res) => {
  const b = req.body || {};
  if (b.status) {
    await pool.query("UPDATE prospects SET status = $1 WHERE id = $2", [b.status, req.params.id]);
  }
  res.json({ ok: true });
});
app.delete("/api/prospects/:id", requireAuth, async (req, res) => {
  await archiveRow("prospects", req.params.id);
  res.json({ ok: true });
});
app.post("/api/prospects/:id/promote", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM prospects WHERE id = $1 AND archived_at IS NULL", [req.params.id]);
  const p = rows[0];
  if (!p) return res.status(404).json({ error: "not found" });
  const id = newId();
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO pipeline (id, name, org, source, track, stage, next_step, next_step_date, notes, diagnostic_stage, created_at, updated_at, trigger_key, self_scores)
     VALUES ($1,$2,$3,$4,$5,'lead',$6,'',$7,$8,$9,$9,$10,$11)`,
    [id, p.name || "", p.org || "", "Prospecting: " + (p.source || ""), INTEREST_TO_TRACK[p.interest] || "undecided",
     p.interest ? "Discovery call" : "First outreach", p.notes || "", DIAGNOSTIC_STAGES.has(p.org_stage) ? p.org_stage : "", now,
     p.trigger_key || "", p.self_scores || ""]
  );
  // A dedicated update rather than the shared archiveRow() helper, so this
  // archival is tagged 'promoted' - distinct from an ordinary manual Remove
  // (which leaves archived_reason at its default ''). The prospect-velocity
  // trend on Forecasting depends on that distinction to know which archived
  // prospects actually became pipeline records, and when.
  await pool.query("UPDATE prospects SET archived_at = $1, archived_reason = 'promoted' WHERE id = $2", [now, req.params.id]);
  res.json({ ok: true, pipelineId: id });
});

// ---------- vision ----------
app.put("/api/vision", requireAuth, async (req, res) => {
  const b = req.body || {};
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO vision (id, values_text, focus, ten_year, marketing, three_year, one_year, updated_at)
     VALUES ('main',$1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (id) DO UPDATE SET values_text=$1, focus=$2, ten_year=$3, marketing=$4, three_year=$5, one_year=$6, updated_at=$7`,
    [b.values || "", b.focus || "", b.tenYear || "", b.marketing || "", b.threeYear || "", b.oneYear || "", now]
  );
  res.json({ ok: true });
});

// ---------- finance: invoices ----------
// Every invoice belongs to a real Pipeline row - see the schema.sql comment
// above this table for why. A pipelineId that doesn't exist yet fails the
// foreign key at the database level rather than silently creating an
// orphan invoice, so that check is left to Postgres instead of duplicated
// here.
app.post("/api/invoices", requireAuth, async (req, res) => {
  const b = req.body || {};
  if (!b.pipelineId) return res.status(400).json({ error: "pipelineId required" });
  const id = newId();
  const now = new Date().toISOString();
  try {
    await pool.query(
      `INSERT INTO invoices (id, pipeline_id, offering, amount, issued_date, due_date, paid_date, status, notes, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
      [id, b.pipelineId, b.offering || "", Number(b.amount || 0), b.issuedDate || "", b.dueDate || "", b.paidDate || "", b.status || "draft", b.notes || "", now]
    );
    res.json({ id });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: "could not save invoice, check the pipeline record still exists" });
  }
});
app.patch("/api/invoices/:id", requireAuth, async (req, res) => {
  const b = req.body || {};
  const fields = [];
  const values = [];
  let i = 1;
  const map = { offering: "offering", amount: "amount", issuedDate: "issued_date", dueDate: "due_date", paidDate: "paid_date", status: "status", notes: "notes" };
  for (const key of Object.keys(map)) {
    if (Object.prototype.hasOwnProperty.call(b, key)) {
      fields.push(`${map[key]} = $${i++}`);
      values.push(key === "amount" ? Number(b[key] || 0) : b[key]);
    }
  }
  fields.push(`updated_at = $${i++}`);
  values.push(new Date().toISOString());
  values.push(req.params.id);
  if (fields.length === 1) return res.json({ ok: true });
  await pool.query(`UPDATE invoices SET ${fields.join(", ")} WHERE id = $${i}`, values);
  res.json({ ok: true });
});
app.delete("/api/invoices/:id", requireAuth, async (req, res) => {
  await archiveRow("invoices", req.params.id);
  res.json({ ok: true });
});

// ---------- delivery: engagement modules ----------
app.post("/api/engagement-modules", requireAuth, async (req, res) => {
  const b = req.body || {};
  if (!b.pipelineId) return res.status(400).json({ error: "pipelineId required" });
  const id = newId();
  const now = new Date().toISOString();
  try {
    await pool.query(
      `INSERT INTO engagement_modules (id, pipeline_id, module_name, status, session_date, deliverable_link, notes, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
      [id, b.pipelineId, b.moduleName || "", b.status || "not-started", b.sessionDate || "", b.deliverableLink || "", b.notes || "", now]
    );
    res.json({ id });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: "could not save module, check the pipeline record still exists" });
  }
});
app.patch("/api/engagement-modules/:id", requireAuth, async (req, res) => {
  const b = req.body || {};
  const fields = [];
  const values = [];
  let i = 1;
  const map = { moduleName: "module_name", status: "status", sessionDate: "session_date", deliverableLink: "deliverable_link", notes: "notes" };
  for (const key of Object.keys(map)) {
    if (Object.prototype.hasOwnProperty.call(b, key)) {
      fields.push(`${map[key]} = $${i++}`);
      values.push(b[key]);
    }
  }
  fields.push(`updated_at = $${i++}`);
  values.push(new Date().toISOString());
  values.push(req.params.id);
  if (fields.length === 1) return res.json({ ok: true });
  await pool.query(`UPDATE engagement_modules SET ${fields.join(", ")} WHERE id = $${i}`, values);
  res.json({ ok: true });
});
app.delete("/api/engagement-modules/:id", requireAuth, async (req, res) => {
  await archiveRow("engagement_modules", req.params.id);
  res.json({ ok: true });
});

// ---------- delivery: time entries (a manual log, not a stopwatch) ----------
app.post("/api/time-entries", requireAuth, async (req, res) => {
  const b = req.body || {};
  if (!b.pipelineId) return res.status(400).json({ error: "pipelineId required" });
  const id = newId();
  const now = new Date().toISOString();
  try {
    await pool.query(
      `INSERT INTO time_entries (id, pipeline_id, entry_date, minutes, note, created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, b.pipelineId, b.entryDate || now.slice(0, 10), Number(b.minutes || 0), b.note || "", now]
    );
    res.json({ id });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: "could not save time entry, check the pipeline record still exists" });
  }
});
app.delete("/api/time-entries/:id", requireAuth, async (req, res) => {
  await archiveRow("time_entries", req.params.id);
  res.json({ ok: true });
});

// ---------- problem log (interviews, discovery calls, Diagnostics) ----------
app.post("/api/problem-log", requireAuth, async (req, res) => {
  const b = req.body || {};
  const clip = (v, n) => String(v || "").trim().slice(0, n);
  const id = newId();
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO problem_log (id, logged_on, kind, organization, org_type, org_size, trigger_key, presenting_problem, verified_constraint, differs, at_stake, who_pays, notes, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [id, /^\d{4}-\d{2}-\d{2}$/.test(b.loggedOn || "") ? b.loggedOn : now.slice(0, 10),
     PROBLEM_KINDS.has(b.kind) ? b.kind : "interview", clip(b.organization, 200), clip(b.orgType, 120), clip(b.orgSize, 60),
     TRIGGER_KEYS.has(b.trigger) ? b.trigger : "", clip(b.presentingProblem, 1000), clip(b.verifiedConstraint, 1000),
     typeof b.differs === "boolean" ? b.differs : null, clip(b.atStake, 1000), WHO_PAYS.has(b.whoPays) ? b.whoPays : "", clip(b.notes, 2000), now]
  );
  res.json({ id });
});
app.delete("/api/problem-log/:id", requireAuth, async (req, res) => {
  await archiveRow("problem_log", req.params.id);
  res.json({ ok: true });
});

// ---------- encounters (dated contact reports, built on a peer's recommendation) ----------
// Either pipelineId (an existing Pipeline record) or newContactName is
// required. When newContactName is given instead, a lightweight Pipeline
// row is created on the spot (stage 'lead', track 'undecided', same shape
// POST /api/prospects/:id/promote already uses) so a first-ever touch
// never has to wait on adding the contact to Pipeline as a separate step.
// When a next step is logged, it's also written onto the parent Pipeline
// record's own next_step/next_step_date - an encounter report is meant to
// move that forward, not just sit in a separate log nobody re-reads.
app.post("/api/encounters", requireAuth, async (req, res) => {
  const b = req.body || {};
  let pipelineId = b.pipelineId || "";
  const now = new Date().toISOString();
  try {
    if (!pipelineId) {
      const newName = (b.newContactName || "").trim();
      if (!newName) return res.status(400).json({ error: "pipelineId or newContactName required" });
      pipelineId = newId();
      await pool.query(
        `INSERT INTO pipeline (id, name, org, source, track, stage, next_step, next_step_date, notes, created_at, updated_at)
         VALUES ($1,$2,$3,'Encounter log','undecided','lead',$4,$5,'',$6,$6)`,
        [pipelineId, newName, (b.newContactOrg || "").trim(), b.nextStep || "", b.nextStepDate || "", now]
      );
    }
    const id = newId();
    await pool.query(
      `INSERT INTO encounters (id, pipeline_id, contact_name, occurred_at, interaction_type, relationship_stage, reason, next_step, next_step_date, summary, logged_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [id, pipelineId, b.contactName || "", b.occurredAt || now.slice(0, 10), b.interactionType || "call", b.relationshipStage || "identification", b.reason || "", b.nextStep || "", b.nextStepDate || "", b.summary || "", b.loggedBy || "", now]
    );
    if ((b.nextStep || "").trim()) {
      await pool.query(
        "UPDATE pipeline SET next_step = $1, next_step_date = $2, updated_at = $3 WHERE id = $4",
        [b.nextStep.trim(), b.nextStepDate || "", now, pipelineId]
      );
    }
    res.json({ id, pipelineId });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: "could not save encounter, check the pipeline record still exists" });
  }
});
app.delete("/api/encounters/:id", requireAuth, async (req, res) => {
  await archiveRow("encounters", req.params.id);
  res.json({ ok: true });
});

// ---------- The President's Desk (formerly Advancement Desk) ----------
// See the schema.sql comment above advancement_state/quiz_attempts for why these
// are shaped the way they are. weekProgress/credPursuing arrive as a partial patch
// (one event id or one credential abbreviation at a time) and get merged into
// whatever's already stored, so one checkbox toggle never clobbers another.
app.put("/api/advancement-state", requireAuth, async (req, res) => {
  const b = req.body || {};
  const now = new Date().toISOString();
  const existing = await pool.query("SELECT * FROM advancement_state WHERE id = 'main'");
  const current = existing.rows[0] ? rowToAdvancementState(existing.rows[0]) : { weekProgress: {}, credPursuing: {} };
  const weekProgress = b.weekProgress ? Object.assign({}, current.weekProgress, b.weekProgress) : current.weekProgress;
  const credPursuing = b.credPursuing ? Object.assign({}, current.credPursuing, b.credPursuing) : current.credPursuing;
  await pool.query(
    `INSERT INTO advancement_state (id, week_progress, cred_pursuing, updated_at)
     VALUES ('main', $1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET week_progress = $1, cred_pursuing = $2, updated_at = $3`,
    [JSON.stringify(weekProgress), JSON.stringify(credPursuing), now]
  );
  res.json({ weekProgress, credPursuing, updatedAt: now });
});

app.post("/api/quiz-attempts", requireAuth, async (req, res) => {
  const b = req.body || {};
  const id = newId();
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO quiz_attempts (id, exam_key, exam_label, score, total, domain_breakdown, taken_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, b.examKey || "", b.examLabel || "", Number(b.score) || 0, Number(b.total) || 0, JSON.stringify(b.domainBreakdown || {}), b.takenAt || now, now]
  );
  res.json({ id });
});

app.delete("/api/quiz-attempts/:id", requireAuth, async (req, res) => {
  await archiveRow("quiz_attempts", req.params.id);
  res.json({ ok: true });
});

// ---------- automated lead capture (admin-only; used by the lead-import scheduled task) ----------
// Upserts prospects by source_ref (e.g. a Gmail message id) so re-scanning the same
// emails never creates duplicates. Rows with no source_ref (added by hand in the UI)
// are unaffected, since Postgres treats every NULL as distinct for uniqueness.
app.post("/api/admin/prospects", requireAdminScope("prospects"), async (req, res) => {
  const items = (req.body && req.body.items) || [];
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "items array required" });
  }
  let created = 0;
  let skipped = 0;
  for (const item of items) {
    if (!item.sourceRef || !item.name) continue;
    const id = newId();
    const now = new Date().toISOString();
    const result = await pool.query(
      `INSERT INTO prospects (id, name, org, source, status, link, notes, created_at, source_ref, interest, org_stage, trigger_key, self_scores)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (source_ref) DO NOTHING`,
      [id, item.name || "", item.org || "", item.source || "inbound", item.status || "new", item.link || "", item.notes || "", now, item.sourceRef,
       INTEREST_KEYS.has(item.interest) ? item.interest : "", DIAGNOSTIC_STAGES.has(item.orgStage) ? item.orgStage : "",
       TRIGGER_KEYS.has(item.trigger) ? item.trigger : "", cleanSelfScores(item.selfScores)]
    );
    if (result.rowCount > 0) created++; else skipped++;
  }
  res.json({ ok: true, created, skipped });
});

// ---------- InstitutionalOS link (one client record across FIOS and InstitutionalOS) ----------
// FIOS is the system of record for the relationship; InstitutionalOS is the
// system of record for the Diagnostic. The pipeline id is the shared key
// (InstitutionalOS stores it as external_ref), so either side can find the
// other and the daily reconcile can prove they agree.
const SITE_DIMENSIONS = ["strategy", "program", "revenue", "leadership", "operations", "partnerships", "governance"];
function cleanSelfScores(v) {
  if (!v || typeof v !== "object") return "";
  const out = {};
  for (const k of SITE_DIMENSIONS) {
    const n = Number(v[k]);
    if (Number.isFinite(n) && n >= 0 && n <= 100) out[k] = Math.round(n);
  }
  return Object.keys(out).length ? JSON.stringify(out) : "";
}
const GRANTPASS_API = (process.env.GRANTPASS_API || "https://grantpass-backend.onrender.com").replace(/\/+$/, "");
const GRANTPASS_DASHBOARD = (process.env.GRANTPASS_DASHBOARD || "https://grantpass-dashboard.onrender.com").replace(/\/+$/, "");
const GRANTPASS_INTEGRATION_KEY = process.env.GRANTPASS_INTEGRATION_KEY || "";
async function iosFetch(pathname, opts = {}) {
  // grantpass-backend sleeps on Render's free tier; a cold start can take ~50s.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs || 60000);
  try {
    const r = await fetch(GRANTPASS_API + pathname, {
      method: opts.method || "GET",
      headers: { "Content-Type": "application/json", "X-Integration-Key": GRANTPASS_INTEGRATION_KEY },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal
    });
    const text = await r.text();
    const data = safeJsonParse(text, {});
    if (!r.ok) throw new Error((data && data.error) || ("InstitutionalOS returned " + r.status));
    return data;
  } finally {
    clearTimeout(timer);
  }
}
async function linkToIOS(pipelineId) {
  if (!GRANTPASS_INTEGRATION_KEY) return { ok: false, error: "GRANTPASS_INTEGRATION_KEY is not set" };
  const { rows } = await pool.query("SELECT * FROM pipeline WHERE id = $1", [pipelineId]);
  const d = rows[0];
  if (!d) return { ok: false, error: "deal not found" };
  const orgName = (d.org || d.name || "").trim();
  if (!orgName) return { ok: false, error: "the deal needs an organization name first" };
  // The presenting problem comes from the Problem Log entry for this
  // organization, when one was logged on the discovery call.
  const pl = await pool.query(
    "SELECT presenting_problem FROM problem_log WHERE archived_at IS NULL AND lower(organization) = lower($1) AND presenting_problem <> '' ORDER BY logged_on DESC NULLS LAST, created_at DESC LIMIT 1",
    [orgName]
  );
  try {
    const out = await iosFetch("/integration/orgs", {
      method: "POST",
      body: {
        externalRef: d.id,
        name: orgName,
        stage: DIAGNOSTIC_STAGES.has(d.diagnostic_stage) ? d.diagnostic_stage.toUpperCase() : "",
        trigger: d.trigger_key || "",
        presentingProblem: pl.rows[0] ? pl.rows[0].presenting_problem : "",
        selfScores: safeJsonParse(d.self_scores || "", null) || undefined
      }
    });
    const portal = out.clientToken
      ? `${GRANTPASS_DASHBOARD}/report.html?client=${encodeURIComponent(out.clientToken)}&api=${encodeURIComponent(GRANTPASS_API)}`
      : "";
    await pool.query(
      "UPDATE pipeline SET ios_org_id = $1, ios_portal_url = $2, ios_link_error = '', updated_at = $3 WHERE id = $4",
      [out.orgId, portal, new Date().toISOString(), d.id]
    );
    return { ok: true, orgId: out.orgId, portalUrl: portal, created: !!out.created };
  } catch (err) {
    const msg = err.name === "AbortError" ? "InstitutionalOS did not answer within 60 seconds" : String(err.message || err);
    await pool.query("UPDATE pipeline SET ios_link_error = $1 WHERE id = $2", [msg.slice(0, 300), d.id]);
    return { ok: false, error: msg };
  }
}

// InstitutionalOS calls this whenever a Diagnostic's scores, record, portal
// session, or Candid Seal change. It updates the deal and keeps exactly one
// Problem Log entry per Diagnostic (source_ref 'ios:<org id>'), so the
// hidden-problem rate is counted in one place.
app.post("/api/admin/ios-sync", requireAdminScope("ios"), async (req, res) => {
  const b = req.body || {};
  const orgId = Number(b.orgId);
  if (!Number.isInteger(orgId) || orgId <= 0) return res.status(400).json({ error: "orgId required" });
  const clip = (v, n) => String(v === null || v === undefined ? "" : v).trim().slice(0, n);
  const now = new Date().toISOString();
  const rec = b.record && typeof b.record === "object" ? b.record : {};
  let deal = null;
  if (b.externalRef) deal = (await pool.query("SELECT * FROM pipeline WHERE id = $1", [String(b.externalRef)])).rows[0] || null;
  if (!deal) deal = (await pool.query("SELECT * FROM pipeline WHERE ios_org_id = $1 ORDER BY created_at DESC LIMIT 1", [orgId])).rows[0] || null;
  if (deal) {
    await pool.query(
      `UPDATE pipeline SET ios_org_id = $1, ios_overall = $2, ios_decision = $3, ios_constraint = $4, ios_next_session = $5,
         ios_record = $6, ios_synced_at = $7, ios_link_error = '' WHERE id = $8`,
      [orgId, Number.isFinite(Number(b.overall)) ? Number(b.overall) : null, clip(b.decision, 120),
       clip(rec.verifiedConstraint || b.lowestDimension, 300), clip(b.nextSessionAt, 40),
       JSON.stringify({ ...rec, dimensions: b.dimensions || null, lowestDimension: b.lowestDimension || "" }).slice(0, 20000), now, deal.id]
    );
  }
  // Problem Log: only once there's something to log.
  let problemLogged = false;
  if (rec.presentingProblem || rec.verifiedConstraint) {
    const differs = typeof rec.differs === "boolean" ? rec.differs : null;
    const notes = [rec.nextInLine ? "Next in line: " + rec.nextInLine : "",
      rec.closeout && rec.closeout.reassessOn ? "Reassess on " + rec.closeout.reassessOn : "",
      b.overall !== undefined && b.overall !== null ? "Overall " + b.overall + (b.decision ? " (" + b.decision + ")" : "") : ""].filter(Boolean).join("\n");
    const params = [newId(), now.slice(0, 10),
      clip(b.name, 200), TRIGGER_KEYS.has(rec.trigger) ? rec.trigger : (deal && deal.trigger_key) || "",
      clip(rec.presentingProblem, 1000), clip(rec.verifiedConstraint, 1000), differs, clip(rec.atStake, 1000),
      WHO_PAYS.has(rec.whoPays) ? rec.whoPays : "", clip(notes, 2000), now, "ios:" + orgId, clip(b.stage, 60)];
    await pool.query(
      `INSERT INTO problem_log (id, logged_on, kind, organization, trigger_key, presenting_problem, verified_constraint, differs, at_stake, who_pays, notes, created_at, source_ref, org_size)
       VALUES ($1,$2,'diagnostic',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (source_ref) DO UPDATE SET organization = EXCLUDED.organization, trigger_key = EXCLUDED.trigger_key,
         presenting_problem = EXCLUDED.presenting_problem, verified_constraint = EXCLUDED.verified_constraint, differs = EXCLUDED.differs,
         at_stake = EXCLUDED.at_stake, who_pays = EXCLUDED.who_pays, notes = EXCLUDED.notes, org_size = EXCLUDED.org_size, archived_at = NULL`,
      params
    );
    problemLogged = true;
  }
  res.json({ ok: true, matchedDeal: deal ? deal.id : null, problemLogged });
});

// Client feedback from franklyinspired.associates/feedback. Pushed by the
// website backend; deduped on its feedback id.
const FEEDBACK_PERMISSIONS = new Set(["named", "anonymous", "private"]);
app.post("/api/admin/feedback", requireAdminScope("prospects"), async (req, res) => {
  const b = req.body || {};
  const clip = (v, n) => String(v || "").trim().slice(0, n);
  if (!b.sourceRef || !(b.quote || b.result)) return res.status(400).json({ error: "sourceRef and quote or result required" });
  const rating = Number(b.rating);
  const r = await pool.query(
    `INSERT INTO feedback (id, source_ref, name, email, role, organization, rating, result, quote, permission, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (source_ref) DO NOTHING`,
    [newId(), clip(b.sourceRef, 120), clip(b.name, 200), clip(b.email, 200), clip(b.role, 200), clip(b.organization, 200),
     Number.isInteger(rating) && rating >= 0 && rating <= 10 ? rating : null, clip(b.result, 2000), clip(b.quote, 2000),
     FEEDBACK_PERMISSIONS.has(b.permission) ? b.permission : "private", new Date().toISOString()]
  );
  res.json({ ok: true, created: r.rowCount > 0 });
});
const FEEDBACK_STATUSES = new Set(["new", "approved", "published", "hold"]);
app.patch("/api/feedback/:id", requireAuth, async (req, res) => {
  const b = req.body || {};
  if (!FEEDBACK_STATUSES.has(b.status)) return res.status(400).json({ error: "bad status" });
  await pool.query("UPDATE feedback SET status = $1 WHERE id = $2", [b.status, req.params.id]);
  res.json({ ok: true });
});
app.delete("/api/feedback/:id", requireAuth, async (req, res) => {
  await archiveRow("feedback", req.params.id);
  res.json({ ok: true });
});

// Daily reconciliation: do the website, FIOS and InstitutionalOS agree?
// Read-only. Each check reports what it found or why it couldn't run, so a
// missing setting shows up as "skipped" rather than as a false all-clear.
const WEBSITE_API_URL = (process.env.WEBSITE_API_URL || "").replace(/\/+$/, "");
const WEBSITE_ADMIN_SECRET = process.env.WEBSITE_ADMIN_SECRET || "";
async function buildReconcile(hours) {
  const out = { generatedAt: new Date().toISOString(), hours, checks: {}, issues: 0 };
  // 1. Every website lead the API says it pushed exists in FIOS.
  if (WEBSITE_API_URL && WEBSITE_ADMIN_SECRET) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 60000);
      const r = await fetch(`${WEBSITE_API_URL}/api/admin/lead-log?hours=${hours}`, { headers: { "X-Reminder-Secret": WEBSITE_ADMIN_SECRET }, signal: ctrl.signal });
      clearTimeout(t);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "status " + r.status);
      const all = (data.leads || []).map((l) => ({ ...l, sourceRef: l.sourceRef || l.ref }));
      const leads = all.filter((l) => l.kind !== "feedback");
      const fb = all.filter((l) => l.kind === "feedback");
      const refs = leads.map((l) => l.sourceRef).filter(Boolean);
      const fbRefs = fb.map((l) => l.sourceRef).filter(Boolean);
      const have = refs.length ? new Set((await pool.query("SELECT source_ref FROM prospects WHERE source_ref = ANY($1)", [refs])).rows.map((x) => x.source_ref)) : new Set();
      const haveFb = fbRefs.length ? new Set((await pool.query("SELECT source_ref FROM feedback WHERE source_ref = ANY($1)", [fbRefs])).rows.map((x) => x.source_ref)) : new Set();
      const missing = leads.filter((l) => l.sourceRef && !have.has(l.sourceRef));
      const missingFb = fb.filter((l) => l.sourceRef && !haveFb.has(l.sourceRef));
      out.checks.websiteLeads = { status: missing.length || missingFb.length ? "mismatch" : "ok", websiteLeads: leads.length, missingInFios: missing, feedback: fb.length, feedbackMissingInFios: missingFb };
      out.issues += missing.length + missingFb.length;
    } catch (err) {
      out.checks.websiteLeads = { status: "error", error: err.name === "AbortError" ? "website API timed out" : String(err.message || err) };
      out.issues++;
    }
  } else {
    out.checks.websiteLeads = { status: "skipped", error: "WEBSITE_API_URL / WEBSITE_ADMIN_SECRET not set" };
  }
  // 2. Every Diagnostic-stage deal has an InstitutionalOS client.
  const unlinked = (await pool.query("SELECT id, name, org, ios_link_error FROM pipeline WHERE archived_at IS NULL AND stage = 'assessment' AND ios_org_id IS NULL")).rows;
  out.checks.diagnosticDealsLinked = { status: unlinked.length ? "mismatch" : "ok", unlinked: unlinked.map((d) => ({ id: d.id, org: d.org || d.name, error: d.ios_link_error || "" })) };
  out.issues += unlinked.length;
  // 3. Linked deals have heard back from InstitutionalOS at least once.
  const neverSynced = (await pool.query("SELECT id, org, name, ios_org_id FROM pipeline WHERE archived_at IS NULL AND ios_org_id IS NOT NULL AND ios_synced_at IS NULL")).rows;
  out.checks.resultsFlowing = { status: neverSynced.length ? "warn" : "ok", neverSynced: neverSynced.map((d) => ({ id: d.id, org: d.org || d.name, orgId: d.ios_org_id })) };
  // 4. InstitutionalOS clients and FIOS deals point at each other; rechecks aren't overdue.
  if (GRANTPASS_INTEGRATION_KEY) {
    try {
      const data = await iosFetch("/integration/orgs");
      const orgs = data.organizations || data.orgs || [];
      const deals = (await pool.query("SELECT id, ios_org_id FROM pipeline WHERE ios_org_id IS NOT NULL")).rows;
      const byOrg = new Map(deals.map((d) => [Number(d.ios_org_id), d.id]));
      const dealIds = new Set(deals.map((d) => d.id));
      const orphanOrgs = orgs.filter((o) => !byOrg.has(Number(o.orgId)) && !(o.externalRef && dealIds.has(o.externalRef)));
      const brokenLinks = orgs.filter((o) => o.externalRef && byOrg.has(Number(o.orgId)) && byOrg.get(Number(o.orgId)) !== o.externalRef);
      const orgIds = new Set(orgs.map((o) => Number(o.orgId)));
      const missingOrgs = deals.filter((d) => !orgIds.has(Number(d.ios_org_id)));
      const today = new Date().toISOString().slice(0, 10);
      const overdue = orgs.filter((o) => o.reassessOn && o.reassessOn < today);
      out.checks.iosClients = {
        status: brokenLinks.length || missingOrgs.length ? "mismatch" : (orphanOrgs.length ? "warn" : "ok"),
        clients: orgs.length, notInFios: orphanOrgs.map((o) => ({ orgId: o.orgId, name: o.name })),
        linkDisagrees: brokenLinks.map((o) => ({ orgId: o.orgId, name: o.name, externalRef: o.externalRef })),
        dealPointsToMissingClient: missingOrgs.map((d) => ({ id: d.id, orgId: d.ios_org_id }))
      };
      out.issues += brokenLinks.length + missingOrgs.length;
      out.checks.rechecksDue = { status: overdue.length ? "due" : "ok", overdue: overdue.map((o) => ({ orgId: o.orgId, name: o.name, reassessOn: o.reassessOn })) };
      // Hidden-problem rate from the one Problem Log.
    } catch (err) {
      out.checks.iosClients = { status: "error", error: err.name === "AbortError" ? "InstitutionalOS timed out" : String(err.message || err) };
      out.issues++;
    }
  } else {
    out.checks.iosClients = { status: "skipped", error: "GRANTPASS_INTEGRATION_KEY not set" };
  }
  const pr = (await pool.query("SELECT count(*) FILTER (WHERE differs IS TRUE) AS hidden, count(*) FILTER (WHERE differs IS NOT NULL) AS judged FROM problem_log WHERE archived_at IS NULL AND kind = 'diagnostic'")).rows[0];
  out.hiddenProblemRate = { diagnostics: Number(pr.judged), hidden: Number(pr.hidden), rate: Number(pr.judged) ? Math.round((100 * Number(pr.hidden)) / Number(pr.judged)) : null };
  out.ok = out.issues === 0;
  return out;
}
app.get("/api/admin/reconcile", requireAdminScope("status"), async (req, res) => {
  const hours = Math.min(Math.max(parseInt(req.query.hours, 10) || 48, 1), 24 * 14);
  try { res.json(await buildReconcile(hours)); } catch (err) { console.error(err); res.status(500).json({ error: "reconcile failed" }); }
});
app.get("/api/reconcile", requireAuth, async (req, res) => {
  try { res.json(await buildReconcile(48)); } catch (err) { console.error(err); res.status(500).json({ error: "reconcile failed" }); }
});

// ---------- digest (read via /api/state; admin-only write for the weekly refresh) ----------
app.post("/api/admin/digest", requireAdminScope("digest"), async (req, res) => {
  const items = (req.body && req.body.items) || [];
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "items array required" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const item of items) {
      if (!item.id || !item.category || !item.headline) continue;
      await client.query(
        `INSERT INTO digest (id, category, headline, summary, source, url, logged_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET category=$2, headline=$3, summary=$4, source=$5, url=$6, logged_at=$7`,
        [item.id, item.category, item.headline, item.summary || "", item.source || "", item.url || "", item.loggedAt || new Date().toISOString()]
      );
    }
    await client.query("COMMIT");
    res.json({ ok: true, count: items.length });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "failed to update digest" });
  } finally {
    client.release();
  }
});

// ---------- gifts (the Giving Landscape ticker) ----------
// Manual entry, for a gift Franklin hears about directly. Every automatically
// imported row (from the weekly Field Intelligence pass) goes through
// /api/admin/gifts below instead, keyed by a stable id so re-running that
// pass never creates duplicates.
app.post("/api/gifts", requireAuth, async (req, res) => {
  const b = req.body || {};
  const id = newId();
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO gifts (id, donor, org, state, category, amount, headline, summary, source, url, announced_at, logged_at, gift_type, restriction, impact, trend_signal, playbook, higher_ed)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [id, b.donor || "", b.org || "", b.state || "", b.category || "other", Number(b.amount || 0), b.headline || "", b.summary || "", b.source || "", b.url || "", b.announcedAt || "", now, b.giftType || "", b.restriction || "", b.impact || "", b.trendSignal || "", b.playbook || "", !!b.higherEd]
  );
  res.json({ id });
});
app.delete("/api/gifts/:id", requireAuth, async (req, res) => {
  await archiveRow("gifts", req.params.id);
  res.json({ ok: true });
});

// Toggles whether one gift appears on the public, no-login Giving Landscape
// page (see /api/public/giving-landscape below). Off by default for every
// gift - this is the only way it turns on, and it's an explicit per-row
// decision, never a bulk switch.
app.post("/api/gifts/:id/public", requireAuth, async (req, res) => {
  const publicOk = !!(req.body && req.body.publicOk);
  await pool.query("UPDATE gifts SET public_ok = $1 WHERE id = $2", [publicOk, req.params.id]);
  res.json({ ok: true, publicOk });
});

// Admin-only bulk upsert, used by the weekly Field Intelligence research pass
// to log newly announced major gifts alongside that week's digest refresh.
// Upserts by id, same pattern as /api/admin/digest, so re-running the same
// week's pass is always safe.
app.post("/api/admin/gifts", requireAdminScope("gifts"), async (req, res) => {
  const items = (req.body && req.body.items) || [];
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "items array required" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const item of items) {
      if (!item.id || !item.org) continue;
      await client.query(
        `INSERT INTO gifts (id, donor, org, state, category, amount, headline, summary, source, url, announced_at, logged_at, gift_type, restriction, impact, trend_signal, playbook, higher_ed)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT (id) DO UPDATE SET donor=$2, org=$3, state=$4, category=$5, amount=$6, headline=$7, summary=$8, source=$9, url=$10, announced_at=$11, logged_at=$12, gift_type=$13, restriction=$14, impact=$15, trend_signal=$16, playbook=$17, higher_ed=$18`,
        [item.id, item.donor || "", item.org, item.state || "", item.category || "other", Number(item.amount || 0), item.headline || "", item.summary || "", item.source || "", item.url || "", item.announcedAt || "", item.loggedAt || new Date().toISOString(), item.giftType || "", item.restriction || "", item.impact || "", item.trendSignal || "", item.playbook || "", !!item.higherEd]
      );
    }
    await client.query("COMMIT");
    res.json({ ok: true, count: items.length });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "failed to update gifts" });
  } finally {
    client.release();
  }
});

// ---------- gifts read + gift-patterns synthesis (Field Intelligence tab) ----------
// GET mirrors the existing POST /api/admin/gifts upsert below, returning the
// same fields (including the internal case-study ones the public site never
// shows) so the Weekly Gift Patterns synthesis task can read before it
// writes - this route never existed, which is the main reason that task has
// 404'd every run since it was created.
app.get("/api/admin/gifts", requireAdminScope("gifts"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM gifts WHERE archived_at IS NULL ORDER BY announced_at DESC NULLS LAST, logged_at DESC LIMIT 100"
    );
    res.json({ items: rows.map(rowToGift) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "failed to read gifts" });
  }
});

// Admin-only write for the standing "Gift Patterns & Portfolio Implications"
// panel in the Field Intelligence tab, right below the weekly news digest -
// a single replace-in-full row (read via /api/state), not a growing log,
// matching how the Weekly Gift Patterns synthesis task's own prompt already
// describes it.
app.post("/api/admin/gift-patterns", requireAdminScope("giftPatterns"), async (req, res) => {
  const b = req.body || {};
  if (!b.content) {
    return res.status(400).json({ error: "content required" });
  }
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO gift_pattern_digests (id, content, window_label, gift_count, updated_at)
     VALUES ('main', $1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET content = $1, window_label = $2, gift_count = $3, updated_at = $4`,
    [b.content, b.windowLabel || "", Number(b.giftCount || 0), now]
  );
  res.json({ ok: true });
});

// ---------- week events (the President's Desk "This Week" panel) ----------
// Admin-only bulk upsert, used by the Weekly calendar prep briefing scheduled
// task to push the real Google Calendar pull it already does each Monday.
// Upserts by id (a stable "gcal-" + calendar event id), same pattern as
// /api/admin/digest and /api/admin/gifts, so re-running the same week's
// pull is always safe. Also prunes anything more than 21 days past so this
// table never grows unbounded - nothing is "deleted" from Franklin's real
// calendar, just dropped from this one small mirror of it.
app.post("/api/admin/week-events", requireAdminScope("calendar"), async (req, res) => {
  const items = (req.body && req.body.items) || [];
  if (!Array.isArray(items)) {
    return res.status(400).json({ error: "items array required" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const now = new Date().toISOString();
    for (const item of items) {
      if (!item.id || !item.title || !item.startsAt) continue;
      await client.query(
        `INSERT INTO week_events (id, title, starts_at, ends_at, location, url, status, status_label, cta, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
         ON CONFLICT (id) DO UPDATE SET title=$2, starts_at=$3, ends_at=$4, location=$5, url=$6, status=$7, status_label=$8, cta=$9, updated_at=$10`,
        [item.id, item.title, item.startsAt, item.endsAt || "", item.location || "", item.url || "", item.status || "neutral", item.statusLabel || "", item.cta || "", now]
      );
    }
    const cutoff = new Date(Date.now() - 21 * 24 * 3600 * 1000).toISOString();
    await client.query("DELETE FROM week_events WHERE starts_at < $1", [cutoff]);
    await client.query("COMMIT");
    res.json({ ok: true, count: items.length });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "failed to update week events" });
  } finally {
    client.release();
  }
});

// ---------- automation health (admin-only write; read via /api/automation-status) ----------
// Every scheduled job behind this app closes its run with one small POST
// here reporting what happened - not proof it worked (a job that never
// gets this far, because it crashed or was never fired, just stays
// "never reported" or goes stale), but enough to catch the biggest gap a
// silent, unattended job can have: nobody finding out it broke until
// something downstream looks wrong. Append-only by design - each run adds
// a row rather than overwriting the last one, so a history exists if it's
// ever needed, and GET /api/automation-status below only reads the latest
// per job.
app.post("/api/admin/automation-runs", requireAdminScope("status"), async (req, res) => {
  const b = req.body || {};
  if (!b.jobKey || !b.status) {
    return res.status(400).json({ error: "jobKey and status required" });
  }
  const id = newId();
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO automation_runs (id, job_key, job_label, status, message, item_count, ran_at, logged_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, b.jobKey, b.jobLabel || "", b.status, b.message || "", (b.itemCount === undefined || b.itemCount === null || b.itemCount === "") ? null : Number(b.itemCount), b.ranAt || now, now]
  );
  res.json({ ok: true, id });
});

// The fixed list of automations this app expects to hear from, and roughly
// how often - used only to flag staleness (a job that hasn't reported in
// well past its own cadence), never to require every job to exist. A job
// removed from Claude's scheduled tasks still shows here as staler and
// staler over time rather than silently vanishing from the health view.
const JOB_REGISTRY = [
  { key: "gift-ticker", label: "Weekly Gift Ticker refresh", cadenceHours: 7 * 24 + 24 },
  { key: "lead-import", label: "Website + Calendly + assessment lead import", cadenceHours: 24 + 6 },
  { key: "field-intel", label: "Weekly Field Intelligence refresh", cadenceHours: 7 * 24 + 24 },
  { key: "calendar-briefing", label: "Weekly calendar prep briefing", cadenceHours: 7 * 24 + 24 },
  { key: "pipeline-review", label: "Weekly pipeline review", cadenceHours: 7 * 24 + 24 },
  { key: "gift-patterns", label: "Weekly Gift Patterns synthesis", cadenceHours: 7 * 24 + 24 },
  { key: "prospect-research", label: "Weekly Prospect Research", cadenceHours: 7 * 24 + 24 }
];

app.get("/api/automation-status", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (job_key) job_key, job_label, status, message, item_count, ran_at
       FROM automation_runs ORDER BY job_key, ran_at DESC`
    );
    const byKey = {};
    rows.forEach((r) => { byKey[r.job_key] = r; });
    const now = Date.now();
    const jobs = JOB_REGISTRY.map((j) => {
      const last = byKey[j.key];
      let staleness = "never";
      if (last && last.ran_at) {
        const ageHours = (now - new Date(last.ran_at).getTime()) / 3600000;
        staleness = Number.isFinite(ageHours) && ageHours <= j.cadenceHours ? "ok" : "stale";
      }
      return {
        key: j.key,
        label: j.label,
        expectedCadence: j.cadenceHours % 24 === 0 ? (j.cadenceHours / 24) + "d" : Math.round(j.cadenceHours / 24) + "d (approx.)",
        lastStatus: last ? last.status : null,
        lastMessage: last ? last.message : null,
        lastItemCount: last && last.item_count !== null && last.item_count !== undefined ? Number(last.item_count) : null,
        lastRanAt: last ? last.ran_at : null,
        staleness
      };
    });
    res.json({ jobs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "failed to load automation status" });
  }
});

// ---------- practice trend analytics (Franklin's own pipeline & prospecting data) ----------
// The same as-it-actually-happened discipline as the National Giving Trends
// benchmark on the Giving Landscape page, applied to Franklin's own sales
// data instead of a national one. Each series is grouped by the month the
// underlying event actually happened (a record closing, a prospect getting
// promoted) and a month with nothing real to report is simply absent from
// the series, never interpolated or shown as zero. Nothing here is a
// projection - see the linear-regression forecast cards above for that;
// this is what actually happened.
app.get("/api/analytics/practice-trends", requireAuth, async (req, res) => {
  try {
    const [conversionRes, dealRes, velocityRes] = await Promise.all([
      pool.query(`
        SELECT substr(updated_at,1,7) AS month,
          COUNT(*) FILTER (WHERE stage='graduated') AS won,
          COUNT(*) FILTER (WHERE stage='lost') AS lost,
          COUNT(*) FILTER (WHERE stage='referred') AS referred
        FROM pipeline
        WHERE archived_at IS NULL AND stage IN ('graduated','lost','referred')
          AND updated_at IS NOT NULL AND updated_at <> ''
        GROUP BY 1 ORDER BY 1
      `),
      pool.query(`
        SELECT substr(updated_at,1,7) AS month,
          COUNT(*) AS count, AVG(deal_value) AS avg_value, SUM(deal_value) AS total_value
        FROM pipeline
        WHERE archived_at IS NULL AND stage='graduated' AND deal_value > 0
          AND updated_at IS NOT NULL AND updated_at <> ''
        GROUP BY 1 ORDER BY 1
      `),
      pool.query(`
        SELECT substr(archived_at,1,7) AS month,
          COUNT(*) AS count,
          AVG(EXTRACT(EPOCH FROM (archived_at::timestamptz - created_at::timestamptz)) / 86400) AS avg_days
        FROM prospects
        WHERE archived_reason = 'promoted' AND archived_at IS NOT NULL AND created_at IS NOT NULL AND created_at <> ''
        GROUP BY 1 ORDER BY 1
      `)
    ]);
    res.json({
      conversion: conversionRes.rows.map((r) => {
        const won = Number(r.won), lost = Number(r.lost), referred = Number(r.referred);
        const closed = won + lost + referred;
        return { month: r.month, won, lost, referred, closed, rate: closed > 0 ? won / closed : null };
      }),
      dealSize: dealRes.rows.map((r) => ({ month: r.month, count: Number(r.count), avgValue: Number(r.avg_value) || 0, totalValue: Number(r.total_value) || 0 })),
      velocity: velocityRes.rows.map((r) => ({ month: r.month, count: Number(r.count), avgDays: r.avg_days === null ? null : Number(r.avg_days) }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "failed to load practice trends" });
  }
});

// ---------- public, no-login Giving Landscape ----------
// Deliberately outside requireAuth - this is the one piece of this app meant
// for an anonymous visitor. Two things keep it safe: (1) it only ever
// selects gifts with public_ok = true, which starts false for every row and
// is only ever flipped one at a time from the authenticated app (see
// POST /api/gifts/:id/public above); (2) the column list below is a fixed
// whitelist of gift-fact fields. It does not select gift_type, restriction,
// impact, trend_signal, or playbook - Frankly Inspired's own case-study
// analysis of a gift - and it has no route into org_financials or
// org_ein_links at all, so nothing from the 990 lookup can reach this page
// however those tables change in the future.
app.get("/api/public/giving-landscape", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, donor, org, state, category, amount, headline, summary, source, url, announced_at
       FROM gifts WHERE archived_at IS NULL AND public_ok = true
       ORDER BY announced_at DESC NULLS LAST, logged_at DESC LIMIT 200`
    );
    res.json({
      gifts: rows.map((r) => ({
        id: r.id, donor: r.donor, org: r.org, state: r.state, category: r.category,
        amount: r.amount === null ? 0 : Number(r.amount), headline: r.headline,
        summary: r.summary, source: r.source, url: r.url, announcedAt: r.announced_at
      }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "failed to load public giving landscape" });
  }
});

// ---------- organizational 990 health (ProPublica Nonprofit Explorer) ----------
// A gift's "org" field is free text, so it is never auto-linked to a specific
// EIN by name alone - a name match can be ambiguous (there are dozens of
// similarly-named orgs for any given cause) and silently attaching the wrong
// nonprofit's financials would be worse than showing none. Franklin searches
// and confirms the right match once per org name; that link is stored in
// org_ein_links and reused from then on. The filing data itself is cached in
// org_financials for 30 days so the tracker isn't re-fetching ProPublica on
// every page load - "Refresh" forces an early re-fetch.
const PP_USER_AGENT = "FranklyInspiredOS/1.0 (nonprofit gift tracker; github.com/fparham3051-prog/frankly-inspired-os)";
const ORG_FINANCIALS_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

async function ppFetchJson(url) {
  const resp = await fetch(url, { headers: { "User-Agent": PP_USER_AGENT }, signal: AbortSignal.timeout(10000) });
  if (!resp.ok) throw new Error(`ProPublica request failed: HTTP ${resp.status}`);
  return resp.json();
}

function fmtUsd(n) {
  n = Number(n) || 0;
  return "$" + Math.round(n).toLocaleString("en-US");
}

// Turns ProPublica's raw filing extracts into a clean year-by-year series
// plus a short list of plain-language signals. Deliberately does not compute
// a "program expense ratio" - that split (program vs. management vs.
// fundraising cost) isn't present in this data source at this granularity,
// and fabricating it would be worse than leaving it out. Flags are signals
// to check, not a verdict - the year-by-year figures are always shown too.
function analyzeOrgFinancials(ppOrg) {
  const filings = ((ppOrg && ppOrg.filings_with_data) || [])
    .filter(function (f) { return f && f.tax_prd_yr; })
    .sort(function (a, b) { return a.tax_prd_yr - b.tax_prd_yr; });

  const years = filings.map(function (f) {
    const revenue = Number(f.totrevenue) || 0;
    const expenses = Number(f.totfuncexpns) || 0;
    const netAssets = (f.totnetassetend === null || f.totnetassetend === undefined) ? null : Number(f.totnetassetend);
    const liabilities = (f.totliabend === null || f.totliabend === undefined) ? null : Number(f.totliabend);
    const assets = (f.totassetsend === null || f.totassetsend === undefined) ? null : Number(f.totassetsend);
    const contributions = Number(f.totcntrbgfts) || 0;
    return {
      year: f.tax_prd_yr,
      revenue: revenue,
      expenses: expenses,
      netIncome: revenue - expenses,
      netAssets: netAssets,
      liabilities: liabilities,
      assets: assets,
      contributions: contributions,
      contributionShare: revenue > 0 ? contributions / revenue : null,
      reserveMonths: (netAssets !== null && expenses > 0) ? netAssets / (expenses / 12) : null,
      debtRatio: (liabilities !== null && assets) ? liabilities / assets : null,
      formType: f.formtype === undefined ? null : f.formtype,
      pdfUrl: f.pdf_url || null
    };
  });

  const flags = [];
  if (years.length === 0) {
    flags.push({ level: "info", text: "No e-filed Form 990 data found for this EIN in ProPublica's Nonprofit Explorer. It may file a paper return, a 990-N postcard (too small to require full detail), or not yet be indexed." });
    return { years: years, flags: flags };
  }

  const last = years[years.length - 1];
  if (last.netIncome < 0) {
    flags.push({ level: "watch", text: "Ran a deficit of " + fmtUsd(Math.abs(last.netIncome)) + " in " + last.year + ": expenses exceeded revenue." });
  }
  if (last.reserveMonths !== null && last.reserveMonths < 3) {
    flags.push({ level: "watch", text: "Net assets cover about " + last.reserveMonths.toFixed(1) + " months of expenses as of " + last.year + ", under the 3-6 months most nonprofit finance guidance treats as a healthy operating reserve." });
  }
  const recent = years.slice(-3);
  const deficitYears = recent.filter(function (y) { return y.netIncome < 0; }).length;
  if (deficitYears >= 2) {
    flags.push({ level: "watch", text: "Ran a deficit in " + deficitYears + " of the last " + recent.length + " filed years." });
  }
  if (years.length >= 2) {
    const first = years[0];
    if (first.revenue > 0) {
      const change = (last.revenue - first.revenue) / first.revenue;
      flags.push({
        level: change >= 0 ? "good" : "watch",
        text: "Revenue " + (change >= 0 ? "grew" : "fell") + " " + (Math.abs(change) * 100).toFixed(0) + "% from " + first.year + " (" + fmtUsd(first.revenue) + ") to " + last.year + " (" + fmtUsd(last.revenue) + ")."
      });
    }
  }
  if (years.length === 1) {
    flags.push({ level: "info", text: "Only one filed year available. Not enough history yet to show a trend." });
  }
  if (flags.length === 0) {
    flags.push({ level: "good", text: "No deficit or thin-reserve signal in the filed years available." });
  }
  return { years: years, flags: flags };
}

async function loadOrCacheFinancials(ein, force) {
  if (!force) {
    const { rows } = await pool.query("SELECT data, fetched_at FROM org_financials WHERE ein = $1", [ein]);
    if (rows[0]) {
      const age = Date.now() - new Date(rows[0].fetched_at).getTime();
      if (age < ORG_FINANCIALS_MAX_AGE_MS) {
        return { data: JSON.parse(rows[0].data), fetchedAt: rows[0].fetched_at };
      }
    }
  }
  const data = await ppFetchJson("https://projects.propublica.org/nonprofits/api/v2/organizations/" + encodeURIComponent(ein) + ".json");
  const fetchedAt = new Date().toISOString();
  await pool.query(
    `INSERT INTO org_financials (ein, data, fetched_at) VALUES ($1,$2,$3)
     ON CONFLICT (ein) DO UPDATE SET data = $2, fetched_at = $3`,
    [String(ein), JSON.stringify(data), fetchedAt]
  );
  return { data: data, fetchedAt: fetchedAt };
}

app.get("/api/org-financials/search", requireAuth, async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.status(400).json({ error: "q required" });
  try {
    const data = await ppFetchJson("https://projects.propublica.org/nonprofits/api/v2/search.json?q=" + encodeURIComponent(q));
    const results = (data.organizations || []).slice(0, 8).map(function (o) {
      return { ein: String(o.ein), strein: o.strein || "", name: o.name || "", city: o.city || "", state: o.state || "" };
    });
    res.json({ results });
  } catch (err) {
    console.error("org-financials search failed:", err.message);
    res.status(502).json({ error: "ProPublica search failed. Try again in a moment." });
  }
});

app.get("/api/org-financials", requireAuth, async (req, res) => {
  const org = String(req.query.org || "").trim();
  if (!org) return res.status(400).json({ error: "org required" });
  try {
    const { rows } = await pool.query("SELECT * FROM org_ein_links WHERE org_name = $1", [org]);
    if (!rows[0]) return res.json({ linked: false });
    const link = rows[0];
    const { data, fetchedAt } = await loadOrCacheFinancials(link.ein, false);
    res.json({
      linked: true,
      ein: link.ein,
      matchedName: link.matched_name,
      matchedCity: link.matched_city,
      matchedState: link.matched_state,
      fetchedAt: fetchedAt,
      analysis: analyzeOrgFinancials(data)
    });
  } catch (err) {
    console.error("org-financials fetch failed:", err.message);
    res.status(502).json({ error: "Could not load financials right now. Try again in a moment." });
  }
});

app.post("/api/org-financials/link", requireAuth, async (req, res) => {
  const b = req.body || {};
  const org = String(b.org || "").trim();
  const ein = String(b.ein || "").trim();
  if (!org || !ein) return res.status(400).json({ error: "org and ein required" });
  const now = new Date().toISOString();
  try {
    await pool.query(
      `INSERT INTO org_ein_links (org_name, ein, matched_name, matched_city, matched_state, linked_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (org_name) DO UPDATE SET ein=$2, matched_name=$3, matched_city=$4, matched_state=$5, linked_at=$6`,
      [org, ein, b.matchedName || "", b.matchedCity || "", b.matchedState || "", now]
    );
    const { data, fetchedAt } = await loadOrCacheFinancials(ein, false);
    res.json({ ok: true, ein: ein, matchedName: b.matchedName || "", fetchedAt: fetchedAt, analysis: analyzeOrgFinancials(data) });
  } catch (err) {
    console.error("org-financials link failed:", err.message);
    res.status(502).json({ error: "Linked, but could not fetch financials for that EIN yet. Try refreshing in a moment." });
  }
});

app.delete("/api/org-financials/link", requireAuth, async (req, res) => {
  const org = String(req.query.org || "").trim();
  if (!org) return res.status(400).json({ error: "org required" });
  await pool.query("DELETE FROM org_ein_links WHERE org_name = $1", [org]);
  res.json({ ok: true });
});

app.post("/api/org-financials/:ein/refresh", requireAuth, async (req, res) => {
  try {
    const { data, fetchedAt } = await loadOrCacheFinancials(req.params.ein, true);
    res.json({ ok: true, fetchedAt: fetchedAt, analysis: analyzeOrgFinancials(data) });
  } catch (err) {
    console.error("org-financials refresh failed:", err.message);
    res.status(502).json({ error: "Refresh failed. Try again in a moment." });
  }
});

// Backs the "Structural" card in Time Horizon (see below): a compact,
// cache-only summary of every org that already has a confirmed EIN link and
// a cached 990 filing history. Deliberately never calls loadOrCacheFinancials
// or hits ProPublica - it only reads what's already in org_financials, so
// opening Time Horizon never triggers a wave of outbound fetches for every
// tracked org. An org with a link but no cached filings yet (never opened in
// the Organization Tracker) is left out; the UI explains that gap rather
// than treating it as a zero.
app.get("/api/org-financials/structural-summary", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.org_name, l.ein, l.matched_name, f.data
       FROM org_ein_links l JOIN org_financials f ON f.ein = l.ein`
    );
    const orgs = rows.map(function (r) {
      const analysis = analyzeOrgFinancials(JSON.parse(r.data));
      const years = analysis.years;
      const first = years[0] || null;
      const last = years[years.length - 1] || null;
      const notable = analysis.flags.find(function (fl) { return fl.level === "watch"; }) || analysis.flags[0] || null;
      return {
        org: r.org_name,
        matchedName: r.matched_name || r.org_name,
        ein: r.ein,
        yearsAvailable: years.length,
        earliestYear: first ? first.year : null,
        latestYear: last ? last.year : null,
        revenueChangePct: (first && last && first !== last && first.revenue > 0) ? (last.revenue - first.revenue) / first.revenue : null,
        flag: notable
      };
    });
    res.json({ orgs: orgs });
  } catch (err) {
    console.error("org-financials structural summary failed:", err.message);
    res.status(500).json({ error: "Could not load structural summary right now. Try again in a moment." });
  }
});

// ---------- full backup / restore (admin-only) ----------
// GET returns every row from every table, including archived ones, as plain
// JSON - a full point-in-time snapshot. POST restores from that same shape,
// upserting by primary key (id, or 'main' for vision) so it's safe to run
// more than once. This exists for two reasons: it's the migration path
// whenever the database itself has to move (free-tier Postgres hosts expire
// or get retired from time to time), and it doubles as an on-demand backup -
// something this app didn't have any way to produce before.
const BACKUP_TABLES = ["pipeline", "scorecard", "issues", "rocks", "prospects", "digest", "gifts", "invoices", "engagement_modules", "time_entries", "encounters", "problem_log", "feedback"];
app.get("/api/admin/backup", requireAdminScope("backup"), async (req, res) => {
  try {
    const out = {};
    for (const table of BACKUP_TABLES) {
      const { rows } = await pool.query(`SELECT * FROM ${table}`);
      out[table] = rows;
    }
    const visionRes = await pool.query("SELECT * FROM vision WHERE id = 'main'");
    out.vision = visionRes.rows[0] || null;
    // org_ein_links is real, hand-confirmed state (which EIN Franklin picked
    // for which org name) and worth carrying across a migration; its cache
    // table org_financials is deliberately left out - it's just a 30-day
    // cache of public ProPublica data, trivially re-fetched, not worth the
    // backup's weight.
    out.orgEinLinks = (await pool.query("SELECT * FROM org_ein_links")).rows;
    out.exportedAt = new Date().toISOString();
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "backup failed" });
  }
});

app.post("/api/admin/restore", requireAdminScope("restore"), async (req, res) => {
  const body = req.body || {};
  const client = await pool.connect();
  const counts = {};
  try {
    await client.query("BEGIN");
    for (const table of BACKUP_TABLES) {
      const rows = Array.isArray(body[table]) ? body[table] : [];
      counts[table] = 0;
      for (const r of rows) {
        if (!r || !r.id) continue;
        // Every column keeps the same $N placeholder in both the VALUES list
        // and the SET clause (indexed by position in `cols`, not re-numbered
        // after filtering) - getting that wrong silently writes values into
        // the wrong columns, so this has to stay index-for-index correct
        // regardless of what order the source JSON's keys happen to be in.
        const cols = Object.keys(r).filter((k) => r[k] !== undefined);
        const insertCols = cols.join(", ");
        const insertPlaceholders = cols.map((_, i) => `$${i + 1}`).join(", ");
        const setClause = cols.map((c, i) => (c === "id" ? null : `${c} = $${i + 1}`)).filter(Boolean).join(", ");
        const values = cols.map((c) => r[c]);
        await client.query(
          `INSERT INTO ${table} (${insertCols}) VALUES (${insertPlaceholders})
           ON CONFLICT (id) DO UPDATE SET ${setClause}`,
          values
        );
        counts[table]++;
      }
    }
    if (body.vision && body.vision.id) {
      const v = body.vision;
      await client.query(
        `INSERT INTO vision (id, values_text, focus, ten_year, marketing, three_year, one_year, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO UPDATE SET values_text=$2, focus=$3, ten_year=$4, marketing=$5, three_year=$6, one_year=$7, updated_at=$8`,
        [v.id, v.values_text || "", v.focus || "", v.ten_year || "", v.marketing || "", v.three_year || "", v.one_year || "", v.updated_at || new Date().toISOString()]
      );
      counts.vision = 1;
    }
    if (Array.isArray(body.orgEinLinks)) {
      counts.orgEinLinks = 0;
      for (const link of body.orgEinLinks) {
        if (!link || !link.org_name || !link.ein) continue;
        await client.query(
          `INSERT INTO org_ein_links (org_name, ein, matched_name, matched_city, matched_state, linked_at)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (org_name) DO UPDATE SET ein=$2, matched_name=$3, matched_city=$4, matched_state=$5, linked_at=$6`,
          [link.org_name, link.ein, link.matched_name || "", link.matched_city || "", link.matched_state || "", link.linked_at || new Date().toISOString()]
        );
        counts.orgEinLinks++;
      }
    }
    await client.query("COMMIT");
    res.json({ ok: true, counts });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "restore failed" });
  } finally {
    client.release();
  }
});

// ---------- static assets (icons, css, js) always served ----------
app.use("/icons", express.static(path.join(__dirname, "public", "icons"), { maxAge: "30d" }));
app.get("/favicon.ico", (req, res) => res.sendFile(path.join(__dirname, "public", "icons", "favicon.ico")));
app.get("/manifest.webmanifest", (req, res) => res.sendFile(path.join(__dirname, "public", "manifest.webmanifest")));
app.get("/styles.css", (req, res) => res.sendFile(path.join(__dirname, "public", "styles.css")));
app.get("/us-states.json", (req, res) => res.sendFile(path.join(__dirname, "public", "us-states.json")));
app.get("/app.js", (req, res) => {
  const token = req.cookies[COOKIE_NAME];
  if (!verify(token)) return res.status(401).end();
  res.sendFile(path.join(__dirname, "public", "app.js"));
});
app.get("/login.js", (req, res) => res.sendFile(path.join(__dirname, "public", "login.js")));
app.get("/giving-landscape", (req, res) => res.sendFile(path.join(__dirname, "public", "giving-landscape-public.html")));
app.get("/giving-landscape-public.js", (req, res) => res.sendFile(path.join(__dirname, "public", "giving-landscape-public.js")));

// ---------- page routes ----------
app.get("/", (req, res) => {
  const token = req.cookies[COOKIE_NAME];
  if (verify(token)) {
    return res.sendFile(path.join(__dirname, "public", "index.html"));
  }
  return res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.use((req, res) => res.status(404).send("Not found"));

initSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`Listening on ${PORT}`));
  })
  .catch((err) => {
    console.error("Failed to initialize schema", err);
    process.exit(1);
  });
