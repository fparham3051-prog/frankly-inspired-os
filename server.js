"use strict";

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const cookieParser = require("cookie-parser");
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

function requireAdminToken(req, res, next) {
  const provided = req.get("X-Admin-Token") || "";
  if (timingSafeStringEqual(provided, ADMIN_API_TOKEN)) return next();
  // Also accept the same signed session cookie the rest of the app uses, so the
  // backup/restore endpoints can be driven from an already-logged-in browser
  // session during a database migration without anyone having to type the
  // admin token anywhere. Automated callers (the lead-import scheduled task,
  // the weekly digest job) keep using the header token as before.
  const sessionToken = req.cookies[COOKIE_NAME];
  if (verify(sessionToken)) return next();
  return res.status(401).json({ error: "invalid admin token" });
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
    const [pipeline, scorecard, issues, rocks, prospects, digest, gifts, visionRes, orgLinks] = await Promise.all([
      pool.query("SELECT * FROM pipeline WHERE archived_at IS NULL ORDER BY created_at DESC"),
      pool.query("SELECT * FROM scorecard WHERE archived_at IS NULL ORDER BY week_of DESC"),
      pool.query("SELECT * FROM issues WHERE archived_at IS NULL ORDER BY created_at DESC"),
      pool.query("SELECT * FROM rocks WHERE archived_at IS NULL ORDER BY due_date ASC NULLS LAST"),
      pool.query("SELECT * FROM prospects WHERE archived_at IS NULL ORDER BY created_at DESC"),
      pool.query("SELECT * FROM digest ORDER BY id ASC"),
      pool.query("SELECT * FROM gifts WHERE archived_at IS NULL ORDER BY announced_at DESC NULLS LAST, logged_at DESC"),
      pool.query("SELECT * FROM vision WHERE id = 'main'"),
      pool.query("SELECT * FROM org_ein_links")
    ]);
    res.json({
      pipeline: pipeline.rows.map(rowToPipeline),
      scorecard: scorecard.rows.map(rowToScorecard),
      issues: issues.rows.map(rowToIssue),
      rocks: rocks.rows.map(rowToRock),
      prospects: prospects.rows.map(rowToProspect),
      digest: digest.rows.map(rowToDigest),
      gifts: gifts.rows.map(rowToGift),
      vision: visionRes.rows[0] ? rowToVision(visionRes.rows[0]) : null,
      orgLinks: orgLinks.rows.map(rowToOrgLink)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "failed to load state" });
  }
});

function rowToPipeline(r) {
  return { id: r.id, name: r.name, org: r.org, source: r.source, track: r.track, stage: r.stage, nextStep: r.next_step, nextStepDate: r.next_step_date, notes: r.notes, createdAt: r.created_at, updatedAt: r.updated_at };
}
function rowToScorecard(r) {
  return { id: r.id, weekOf: r.week_of, calls: r.calls, leads: r.leads, active: r.active, won: r.won, lost: r.lost, referrals: r.referrals, notes: r.notes, createdAt: r.created_at };
}
function rowToIssue(r) {
  return { id: r.id, title: r.title, detail: r.detail, status: r.status, createdAt: r.created_at, resolvedAt: r.resolved_at };
}
function rowToRock(r) {
  return { id: r.id, title: r.title, quarter: r.quarter, dueDate: r.due_date, notes: r.notes, status: r.status, createdAt: r.created_at };
}
function rowToProspect(r) {
  return { id: r.id, name: r.name, org: r.org, source: r.source, status: r.status, link: r.link, notes: r.notes, createdAt: r.created_at, sourceRef: r.source_ref };
}
function rowToDigest(r) {
  return { id: r.id, category: r.category, headline: r.headline, summary: r.summary, source: r.source, url: r.url, loggedAt: r.logged_at };
}
function rowToGift(r) {
  return { id: r.id, donor: r.donor, org: r.org, state: r.state, category: r.category, amount: r.amount === null ? 0 : Number(r.amount), headline: r.headline, summary: r.summary, source: r.source, url: r.url, announcedAt: r.announced_at, loggedAt: r.logged_at, giftType: r.gift_type, restriction: r.restriction, impact: r.impact, trendSignal: r.trend_signal, playbook: r.playbook, publicOk: r.public_ok === true };
}
function rowToVision(r) {
  return { values: r.values_text, focus: r.focus, tenYear: r.ten_year, marketing: r.marketing, threeYear: r.three_year, oneYear: r.one_year, updatedAt: r.updated_at };
}
function rowToOrgLink(r) {
  return { org: r.org_name, ein: r.ein, matchedName: r.matched_name, matchedCity: r.matched_city, matchedState: r.matched_state, linkedAt: r.linked_at };
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
app.post("/api/pipeline", requireAuth, async (req, res) => {
  const b = req.body || {};
  const id = newId();
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO pipeline (id, name, org, source, track, stage, next_step, next_step_date, notes, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
    [id, b.name || "", b.org || "", b.source || "", b.track || "undecided", b.stage || "lead", b.nextStep || "", b.nextStepDate || "", b.notes || "", now]
  );
  res.json({ id });
});
app.patch("/api/pipeline/:id", requireAuth, async (req, res) => {
  const b = req.body || {};
  const fields = [];
  const values = [];
  let i = 1;
  const map = { stage: "stage", nextStep: "next_step", nextStepDate: "next_step_date", notes: "notes", name: "name", org: "org", source: "source", track: "track" };
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
  res.json({ ok: true });
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
    `INSERT INTO scorecard (id, week_of, calls, leads, active, won, lost, referrals, notes, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, b.weekOf || "", Number(b.calls || 0), Number(b.leads || 0), Number(b.active || 0), Number(b.won || 0), Number(b.lost || 0), Number(b.referrals || 0), b.notes || "", now]
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
    `INSERT INTO pipeline (id, name, org, source, track, stage, next_step, next_step_date, notes, created_at, updated_at)
     VALUES ($1,$2,$3,$4,'undecided','lead','First outreach','',$5,$6,$6)`,
    [id, p.name || "", p.org || "", "Prospecting: " + (p.source || ""), p.notes || "", now]
  );
  await archiveRow("prospects", req.params.id);
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

// ---------- automated lead capture (admin-only; used by the lead-import scheduled task) ----------
// Upserts prospects by source_ref (e.g. a Gmail message id) so re-scanning the same
// emails never creates duplicates. Rows with no source_ref (added by hand in the UI)
// are unaffected, since Postgres treats every NULL as distinct for uniqueness.
app.post("/api/admin/prospects", requireAdminToken, async (req, res) => {
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
      `INSERT INTO prospects (id, name, org, source, status, link, notes, created_at, source_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (source_ref) DO NOTHING`,
      [id, item.name || "", item.org || "", item.source || "inbound", item.status || "new", item.link || "", item.notes || "", now, item.sourceRef]
    );
    if (result.rowCount > 0) created++; else skipped++;
  }
  res.json({ ok: true, created, skipped });
});

// ---------- digest (read via /api/state; admin-only write for the weekly refresh) ----------
app.post("/api/admin/digest", requireAdminToken, async (req, res) => {
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
    `INSERT INTO gifts (id, donor, org, state, category, amount, headline, summary, source, url, announced_at, logged_at, gift_type, restriction, impact, trend_signal, playbook)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [id, b.donor || "", b.org || "", b.state || "", b.category || "other", Number(b.amount || 0), b.headline || "", b.summary || "", b.source || "", b.url || "", b.announcedAt || "", now, b.giftType || "", b.restriction || "", b.impact || "", b.trendSignal || "", b.playbook || ""]
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
app.post("/api/admin/gifts", requireAdminToken, async (req, res) => {
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
        `INSERT INTO gifts (id, donor, org, state, category, amount, headline, summary, source, url, announced_at, logged_at, gift_type, restriction, impact, trend_signal, playbook)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (id) DO UPDATE SET donor=$2, org=$3, state=$4, category=$5, amount=$6, headline=$7, summary=$8, source=$9, url=$10, announced_at=$11, logged_at=$12, gift_type=$13, restriction=$14, impact=$15, trend_signal=$16, playbook=$17`,
        [item.id, item.donor || "", item.org, item.state || "", item.category || "other", Number(item.amount || 0), item.headline || "", item.summary || "", item.source || "", item.url || "", item.announcedAt || "", item.loggedAt || new Date().toISOString(), item.giftType || "", item.restriction || "", item.impact || "", item.trendSignal || "", item.playbook || ""]
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
const BACKUP_TABLES = ["pipeline", "scorecard", "issues", "rocks", "prospects", "digest", "gifts"];
app.get("/api/admin/backup", requireAdminToken, async (req, res) => {
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

app.post("/api/admin/restore", requireAdminToken, async (req, res) => {
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
