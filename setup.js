"use strict";
// Setup checklist for a new copy of the stack (another organization's).
// Shown on Today to the owner until every step is done or it's dismissed.
// Frankly Inspired's own copy never shows it (set SETUP_CHECKLIST=1 to see it anyway).
//   GET  /api/setup                     {show, items:[{key, label, help, done, go}]}
//   POST /api/settings/setup-dismiss    hide it (owner only)
const ORGINFO = require("./org");
const { ORG } = require("./accounts");

async function count(pool, sql, args) { try { return Number((await pool.query(sql, args || [])).rows[0].n) || 0; } catch (e) { return 0; } }
async function setting(pool, k) { try { const r = (await pool.query("SELECT value FROM app_settings WHERE key = $1", [k])).rows[0]; return r ? r.value : ""; } catch (e) { return ""; } }

async function items(pool) {
  const i = ORGINFO.info();
  const owners = await count(pool, "SELECT count(*) AS n FROM app_users WHERE role = 'owner' AND NOT disabled");
  const ownersTwoStep = await count(pool, "SELECT count(*) AS n FROM app_users WHERE role = 'owner' AND NOT disabled AND totp_on");
  const people = await count(pool, "SELECT count(*) AS n FROM app_users WHERE NOT disabled");
  let mail = []; try { mail = JSON.parse(await setting(pool, "gmail_accounts") || "[]"); } catch (e) { mail = ["?"]; }
  const records = await count(pool, "SELECT ((SELECT count(*) FROM pipeline WHERE archived_at IS NULL) + (SELECT count(*) FROM contacts) + COALESCE((SELECT count(*) FROM fr_donors), 0))::int AS n");
  const backup = await count(pool, "SELECT count(*) AS n FROM automation_runs WHERE job_key = 'nightly-backup' AND status = 'ok' AND ran_at > $1", [new Date(Date.now() - 3 * 864e5).toISOString()]);
  const hasPlace = !!(i.website || (ORG.org || {}).email);
  return [
    { key: "profile", label: `Name and brand: ${i.name}`, help: "Your name, leader, colors and links come from the organization profile (ORG_CONFIG). Change them there.", done: !!(ORG.org && ORG.org.name) && hasPlace, go: "" },
    { key: "owner", label: "Add yourself as Owner with your own email", help: "Settings > People. Then sign in with your email instead of the shared password.", done: owners > 0, go: "settings" },
    { key: "twostep", label: "Turn on two-step sign-in", help: "Settings > Your account. This also turns off the shared setup password.", done: ownersTwoStep > 0, go: "settings" },
    { key: "team", label: "Invite your team", help: "Settings > People: Staff for your team, Board for view-only board members.", done: people > 1, go: "settings" },
    { key: "email", label: "Connect the email account messages go out from", help: "Settings > Connected email. Follow the steps shown there for the Google connection.", done: mail.length > 0, go: "settings" },
    { key: "records", label: "Load your contacts, clients or donors", help: "Contacts, Pipeline or Fundraising each take a CSV from a spreadsheet.", done: records > 0, go: "contacts" },
    { key: "library", label: "Look over your starter checklists and library", help: "Process Library: the checklists and materials this copy started with. Edit them to fit how you work.", done: (await setting(pool, "library_seeded")) === "1" && (await setting(pool, "setup_library_seen")) === "1", go: "process" },
    { key: "areas", label: "Choose which areas you use", help: "Settings > Areas: turn off what you don't need so the menu stays short.", done: !!(await setting(pool, "modules")) && (await setting(pool, "modules")) !== "{}", go: "settings" },
    { key: "backup", label: "Nightly backup is running", help: "Set up the scheduled tasks in the setup guide; this ticks itself after the first good backup.", done: backup > 0, go: "" }
  ];
}

function mount(app, { pool, requireAuth }) {
  app.get("/api/setup", requireAuth, async (req, res) => {
    const want = ORGINFO.active() || process.env.SETUP_CHECKLIST === "1";
    if (!want || (req.session && req.session.role !== "owner") || (await setting(pool, "setup_dismissed")) === "1") return res.json({ ok: true, show: false, items: [] });
    const list = await items(pool);
    res.json({ ok: true, show: list.some((x) => !x.done), done: list.filter((x) => x.done).length, items: list, guide: "/setup-guide" });
  });
  // Owner-only by path (/api/settings).
  app.post("/api/settings/setup-dismiss", requireAuth, async (req, res) => {
    await pool.query("INSERT INTO app_settings (key, value) VALUES ('setup_dismissed', '1') ON CONFLICT (key) DO UPDATE SET value = '1'");
    res.json({ ok: true });
  });
  app.post("/api/setup/seen", requireAuth, async (req, res) => {
    const k = String((req.body || {}).key || "");
    if (k !== "library") return res.status(400).json({ error: "Unknown step." });
    await pool.query("INSERT INTO app_settings (key, value) VALUES ('setup_library_seen', '1') ON CONFLICT (key) DO UPDATE SET value = '1'");
    res.json({ ok: true });
  });
  app.get("/setup-guide", requireAuth, (req, res) => { res.type("text/plain; charset=utf-8"); res.sendFile(require("path").join(__dirname, "docs", "NEW-ORGANIZATION.md")); });
  app.get("/setup-checklist.js", requireAuth, (req, res) => res.sendFile(require("path").join(__dirname, "public", "setup-checklist.js")));
}
module.exports = { mount, items };
