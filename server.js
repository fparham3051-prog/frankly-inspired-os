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
  return res.status(401).json({ error: "invalid admin token" });
}

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// ---------- auth routes ----------
app.post("/api/login", (req, res) => {
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
    const [pipeline, scorecard, issues, rocks, prospects, digest, visionRes] = await Promise.all([
      pool.query("SELECT * FROM pipeline ORDER BY created_at DESC"),
      pool.query("SELECT * FROM scorecard ORDER BY week_of DESC"),
      pool.query("SELECT * FROM issues ORDER BY created_at DESC"),
      pool.query("SELECT * FROM rocks ORDER BY due_date ASC NULLS LAST"),
      pool.query("SELECT * FROM prospects ORDER BY created_at DESC"),
      pool.query("SELECT * FROM digest ORDER BY id ASC"),
      pool.query("SELECT * FROM vision WHERE id = 'main'")
    ]);
    res.json({
      pipeline: pipeline.rows.map(rowToPipeline),
      scorecard: scorecard.rows.map(rowToScorecard),
      issues: issues.rows.map(rowToIssue),
      rocks: rocks.rows.map(rowToRock),
      prospects: prospects.rows.map(rowToProspect),
      digest: digest.rows.map(rowToDigest),
      vision: visionRes.rows[0] ? rowToVision(visionRes.rows[0]) : null
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
function rowToVision(r) {
  return { values: r.values_text, focus: r.focus, tenYear: r.ten_year, marketing: r.marketing, threeYear: r.three_year, oneYear: r.one_year, updatedAt: r.updated_at };
}

function newId() {
  return crypto.randomUUID();
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
  await pool.query("DELETE FROM pipeline WHERE id = $1", [req.params.id]);
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
  await pool.query("DELETE FROM scorecard WHERE id = $1", [req.params.id]);
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
  await pool.query("DELETE FROM issues WHERE id = $1", [req.params.id]);
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
  await pool.query("DELETE FROM rocks WHERE id = $1", [req.params.id]);
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
  await pool.query("DELETE FROM prospects WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});
app.post("/api/prospects/:id/promote", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM prospects WHERE id = $1", [req.params.id]);
  const p = rows[0];
  if (!p) return res.status(404).json({ error: "not found" });
  const id = newId();
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO pipeline (id, name, org, source, track, stage, next_step, next_step_date, notes, created_at, updated_at)
     VALUES ($1,$2,$3,$4,'undecided','lead','First outreach','',$5,$6,$6)`,
    [id, p.name || "", p.org || "", "Prospecting: " + (p.source || ""), p.notes || "", now]
  );
  await pool.query("DELETE FROM prospects WHERE id = $1", [req.params.id]);
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

// ---------- static assets (icons, css, js) always served ----------
app.use("/icons", express.static(path.join(__dirname, "public", "icons"), { maxAge: "30d" }));
app.get("/favicon.ico", (req, res) => res.sendFile(path.join(__dirname, "public", "icons", "favicon.ico")));
app.get("/manifest.webmanifest", (req, res) => res.sendFile(path.join(__dirname, "public", "manifest.webmanifest")));
app.get("/styles.css", (req, res) => res.sendFile(path.join(__dirname, "public", "styles.css")));
app.get("/app.js", (req, res) => {
  const token = req.cookies[COOKIE_NAME];
  if (!verify(token)) return res.status(401).end();
  res.sendFile(path.join(__dirname, "public", "app.js"));
});
app.get("/login.js", (req, res) => res.sendFile(path.join(__dirname, "public", "login.js")));

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
