"use strict";
// Storage: keeping a copy of the stack small for years (docs/DATA-RETENTION.md, "Storage").
//
//   Files in Google Drive. Attachments on tasks and projects go to a Drive folder
//   ("<name> Files") through the connected Google account, and only the name and the
//   Drive id stay in the database. Without a Google connection they stay in the
//   database, as before. "Move files to Drive" moves the ones already there.
//   Storage meter. How big the database is, against the plan's size (Settings > Storage).
//   At 70% the morning brief says so.
//   Compressed backups. /api/admin/backup-all?gzip=1 sends the full backup gzipped.
//   Yearly archive. Everything finished in a given year (closed projects with their
//   tasks and messages, paid invoices, closed pipeline records), as one file to keep.
//   Trimming that year from the live system is a separate step the owner confirms.
//
//   GET  /api/settings/storage                 meter (owner)
//   POST /api/settings/storage                 {planMb, filesInDrive}
//   POST /api/settings/storage/move-files      move database files to Drive (a batch at a time)
//   GET  /api/settings/archive?year=YYYY       the year's archive (gzipped JSON download)
//   POST /api/settings/archive/trim            {year, confirm:"DELETE <year>"} remove that year's closed work history
const zlib = require("zlib");
const crypto = require("crypto");
const ORGINFO = require("./org");

const DRIVE = () => (process.env.DRIVE_API_BASE || "https://www.googleapis.com").replace(/\/$/, "");
async function getS(pool, k) { try { const r = (await pool.query("SELECT value FROM app_settings WHERE key = $1", [k])).rows[0]; return r ? r.value : ""; } catch (e) { return ""; } }
async function setS(pool, k, v) { await pool.query("INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [k, String(v)]); }

// ---------- Google Drive ----------
async function driveAccount(pool) {
  const G = require("./gmail");
  let d = {}; try { d = JSON.parse(await getS(pool, "gmail_default") || "{}"); } catch (e) {}
  const list = await G.accounts(pool).catch(() => []);
  if (!list.length) return "";
  return (d.account && list.some((a) => a.email === d.account)) ? d.account : list[0].email;
}
async function wantDrive(pool) { return (await getS(pool, "files_in_drive")) !== "0" && !!(await driveAccount(pool)); }
async function token(pool, email) { return require("./gmail").accessToken(pool, email); }
async function folder(pool, email) {
  const have = await getS(pool, "drive_files_folder");
  if (have) return have;
  const t = await token(pool, email);
  const r = await fetch(DRIVE() + "/drive/v3/files?fields=id", { method: "POST", headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" }, body: JSON.stringify({ name: ORGINFO.info().shortName + " Files", mimeType: "application/vnd.google-apps.folder" }), signal: AbortSignal.timeout(30000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id) throw new Error("Couldn't make the Drive folder: " + ((j.error && j.error.message) || r.status));
  await setS(pool, "drive_files_folder", j.id);
  return j.id;
}
async function driveUpload(pool, email, name, type, buf) {
  const parent = await folder(pool, email), t = await token(pool, email), b = "fios" + crypto.randomBytes(8).toString("hex");
  const body = Buffer.concat([
    Buffer.from(`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [parent] })}\r\n--${b}\r\nContent-Type: ${type}\r\n\r\n`),
    buf, Buffer.from(`\r\n--${b}--`)
  ]);
  const r = await fetch(DRIVE() + "/upload/drive/v3/files?uploadType=multipart&fields=id", { method: "POST", headers: { Authorization: "Bearer " + t, "Content-Type": "multipart/related; boundary=" + b }, body, signal: AbortSignal.timeout(120000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id) throw new Error("Drive upload failed: " + ((j.error && j.error.message) || r.status));
  return j.id;
}
async function driveDownload(pool, email, id) {
  const t = await token(pool, email);
  const r = await fetch(DRIVE() + "/drive/v3/files/" + encodeURIComponent(id) + "?alt=media", { headers: { Authorization: "Bearer " + t }, signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error("Drive returned " + r.status);
  return Buffer.from(await r.arrayBuffer());
}

// Save an attachment: Drive when connected, otherwise the database. Returns where it went.
async function saveFile(pool, { id, name, type, buf, by }) {
  const now = new Date().toISOString();
  if (await wantDrive(pool)) {
    try {
      const email = await driveAccount(pool);
      const did = await driveUpload(pool, email, name, type, buf);
      await pool.query("INSERT INTO hub_files (id, name, type, size, data, by_user, created_at, drive_id, drive_account) VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8)", [id, name, type, buf.length, by, now, did, email]);
      return "drive";
    } catch (e) { console.error("drive upload, keeping the file in the database instead:", e.message); }
  }
  await pool.query("INSERT INTO hub_files (id, name, type, size, data, by_user, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)", [id, name, type, buf.length, buf, by, now]);
  return "database";
}
async function readFile(pool, id) {
  const f = (await pool.query("SELECT name, type, data, drive_id, drive_account FROM hub_files WHERE id = $1", [id])).rows[0];
  if (!f) return null;
  if (f.data || !f.drive_id) return { name: f.name, type: f.type, data: f.data || Buffer.alloc(0) };
  return { name: f.name, type: f.type, data: await driveDownload(pool, f.drive_account, f.drive_id) };
}
async function moveFiles(pool, limit) {
  if (!(await driveAccount(pool))) return { moved: 0, left: 0, error: "Connect a Google account first (Settings > Connected email)." };
  const email = await driveAccount(pool); let moved = 0; const errors = [];
  const rows = (await pool.query("SELECT id, name, type FROM hub_files WHERE data IS NOT NULL AND drive_id IS NULL ORDER BY created_at LIMIT $1", [limit || 20])).rows;
  for (const r of rows) {
    try {
      const buf = (await pool.query("SELECT data FROM hub_files WHERE id = $1", [r.id])).rows[0].data;
      const did = await driveUpload(pool, email, r.name, r.type || "application/octet-stream", buf);
      await pool.query("UPDATE hub_files SET drive_id = $1, drive_account = $2, data = NULL WHERE id = $3", [did, email, r.id]);
      moved++;
    } catch (e) { errors.push(r.name + ": " + e.message); break; }
  }
  const left = Number((await pool.query("SELECT count(*)::int AS n FROM hub_files WHERE data IS NOT NULL AND drive_id IS NULL")).rows[0].n);
  return { moved, left, errors };
}

// ---------- meter ----------
async function meter(pool) {
  const size = Number((await pool.query("SELECT pg_database_size(current_database())::bigint AS n")).rows[0].n);
  const tables = (await pool.query(`SELECT c.relname AS name, pg_total_relation_size(c.oid)::bigint AS bytes, c.reltuples::bigint AS rows
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 2 DESC LIMIT 8`)).rows
    .map((t) => ({ name: t.name, mb: Math.round(Number(t.bytes) / 1048576 * 10) / 10, rows: Math.max(0, Number(t.rows)) }));
  const f = (await pool.query("SELECT count(*) FILTER (WHERE data IS NOT NULL)::int AS db_n, COALESCE(sum(size) FILTER (WHERE data IS NOT NULL), 0)::bigint AS db_b, count(*) FILTER (WHERE drive_id IS NOT NULL)::int AS drive_n FROM hub_files")).rows[0];
  const planMb = Number(await getS(pool, "storage_plan_mb")) || Number(process.env.DB_PLAN_MB) || 1024;
  const usedMb = Math.round(size / 1048576 * 10) / 10;
  return { usedMb, planMb, pct: Math.round((usedMb / planMb) * 100), tables, files: { inDatabase: f.db_n, inDatabaseMb: Math.round(Number(f.db_b) / 1048576 * 10) / 10, inDrive: f.drive_n },
    filesInDrive: (await getS(pool, "files_in_drive")) !== "0", driveAccount: await driveAccount(pool) };
}
async function warning(pool) {
  try { const m = await meter(pool); return m.pct >= 70 ? `The database is ${m.pct}% full (${m.usedMb} of ${m.planMb} MB); see Settings > Storage` : ""; } catch (e) { return ""; }
}

// ---------- yearly archive ----------
function inYear(s, y) { return String(s || "").slice(0, 4) === String(y); }
async function archive(pool, year) {
  const y = String(year);
  const docs = async (p) => (await pool.query("SELECT id, data, t FROM hub_docs WHERE path = $1 AND NOT deleted", [p])).rows.map((r) => Object.assign({ id: r.id }, r.data || {}));
  // Closed projects: archived or every task done, last touched in that year.
  const projects = await docs("projects"), tasks = await docs("tasks"), msgs = await docs("msgs");
  const closed = projects.filter((p) => {
    const ts = tasks.filter((t) => t.project === p.id);
    const finished = p.archived || (ts.length && ts.every((t) => t.done || t.status === "done" || t.cancelled));
    const last = [p.archivedAt, p.updatedAt, ...ts.map((t) => t.doneAt || t.updatedAt)].filter(Boolean).sort().pop() || "";
    return finished && inYear(last, y);
  });
  const ids = new Set(closed.map((p) => p.id));
  const ctasks = tasks.filter((t) => ids.has(t.project)), tids = new Set(ctasks.map((t) => t.id));
  const cmsgs = msgs.filter((m) => (m.on && ((m.on.startsWith("project:") && ids.has(m.on.slice(8))) || (m.on.startsWith("task:") && tids.has(m.on.slice(5))))));
  const invoices = (await pool.query("SELECT * FROM invoices WHERE status = 'paid' AND left(COALESCE(paid_date, ''), 4) = $1", [y])).rows;
  const pipeline = (await pool.query("SELECT * FROM pipeline WHERE stage IN ('graduated', 'referred', 'lost') AND left(COALESCE(updated_at::text, created_at::text, ''), 4) = $1", [y]).catch(() => ({ rows: [] }))).rows;
  return { kind: "yearly-archive", year: Number(y), organization: ORGINFO.info().name, exportedAt: new Date().toISOString(),
    counts: { projects: closed.length, tasks: ctasks.length, messages: cmsgs.length, paidInvoices: invoices.length, closedPipeline: pipeline.length },
    projects: closed, tasks: ctasks, messages: cmsgs, paidInvoices: invoices, closedPipeline: pipeline };
}

function mount(app, { pool, requireAuth }) {
  const owner = (req, res) => { if (!req.session || req.session.role !== "owner") { res.status(403).json({ error: "Only the owner can do this." }); return false; } return true; };
  app.get("/storage-admin.js", requireAuth, (req, res) => res.sendFile(require("path").join(__dirname, "public", "storage-admin.js")));
  app.get("/api/settings/storage", requireAuth, async (req, res) => { try { res.json(Object.assign({ ok: true }, await meter(pool))); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post("/api/settings/storage", requireAuth, async (req, res) => {
    if (!owner(req, res)) return;
    const b = req.body || {};
    if (b.planMb != null) { const n = Math.round(Number(b.planMb)); if (!(n >= 100 && n <= 10000000)) return res.status(400).json({ error: "Plan size must be at least 100 MB." }); await setS(pool, "storage_plan_mb", n); }
    if (b.filesInDrive != null) await setS(pool, "files_in_drive", b.filesInDrive ? "1" : "0");
    res.json(Object.assign({ ok: true }, await meter(pool)));
  });
  app.post("/api/settings/storage/move-files", requireAuth, async (req, res) => { if (!owner(req, res)) return; try { res.json(Object.assign({ ok: true }, await moveFiles(pool, 20))); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.get("/api/settings/archive", requireAuth, async (req, res) => {
    if (!owner(req, res)) return;
    const y = Number(req.query.year);
    if (!(y >= 2000 && y <= new Date().getFullYear())) return res.status(400).json({ error: "Pick a year." });
    const a = await archive(pool, y);
    if (req.query.preview) return res.json({ ok: true, year: y, counts: a.counts });
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify(a)));
    res.set({ "Content-Type": "application/gzip", "Content-Disposition": `attachment; filename="archive-${y}.json.gz"` }).send(gz);
  });
  app.post("/api/settings/archive/trim", requireAuth, async (req, res) => {
    if (!owner(req, res)) return;
    const y = Number((req.body || {}).year);
    if (!(y >= 2000 && y < new Date().getFullYear() - 1)) return res.status(400).json({ error: "Only years that ended more than a year ago can be trimmed." });
    if ((req.body || {}).confirm !== "DELETE " + y) return res.status(400).json({ error: `Type DELETE ${y} to confirm. Download the archive first; trimming can't be undone except from a backup.` });
    const a = await archive(pool, y);
    const ids = [...a.projects.map((p) => ["projects", p.id]), ...a.tasks.map((t) => ["tasks", t.id]), ...a.messages.map((m) => ["msgs", m.id])];
    const hub = app.locals.hub; if (!hub) return res.status(503).json({ error: "Not available." });
    const me = await hub.meFor(req.session);
    for (const [p, id] of ids) await hub.applyOp({ path: p, id, data: null }, me);
    // Paid invoices and closed pipeline records stay: they are financial and client records.
    res.json({ ok: true, removed: { projects: a.projects.length, tasks: a.tasks.length, messages: a.messages.length } });
  });
}

module.exports = { mount, saveFile, readFile, moveFiles, meter, warning, archive };
