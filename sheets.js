"use strict";
// Prospect report: every prospect-related record across the system, written
// to one Google Sheet the owner can share with the team. The sheet lives in
// the connected Google account's Drive (Settings > Connected email); the app
// can only see files it created itself (drive.file).
//
//   GET  /api/reports/prospects            sheet status and row counts
//   POST /api/reports/prospects/sheet      create the sheet, or refresh it
//   POST /api/reports/prospects/share      {emails, role} share with the team
//   GET  /api/reports/prospects.csv?tab=   one tab as CSV (works without Google)
//
// The sheet also refreshes on its own once a day from the background pass.
// It is internal: the market scan's named ratings must not leave the team.

const GMAIL = require("./gmail");
const F = require("./foundation");
const { ORG } = require("./accounts");

const SHEETS = (process.env.SHEETS_API_BASE || "https://sheets.googleapis.com").replace(/\/$/, "");
const DRIVE = (process.env.DRIVE_API_BASE || "https://www.googleapis.com").replace(/\/$/, "");
const KEY = "report_prospects_sheet";

const STAGE = { lead: "Lead", discovery: "Discovery call", assessment: "InstitutionalOS Diagnostic", engaged: "Engaged", graduated: "Graduated", referred: "Referred out", lost: "Lost, no fit" };
const TRACK = { undecided: "Undecided", institutionalos: "InstitutionalOS Diagnostic", retainer: "Advisory retainer", consulting: "Project", coaching: "Executive coaching", speaking: "Speaking and board service" };
const PSTATUS = { new: "New", researching: "Researching", contacted: "Contacted", responded: "Responded", meeting: "Meeting booked", "not-fit": "Not a fit" };
const SOURCE = { linkedin: "LinkedIn", referral: "Referral", conference: "Conference / event", warm: "Warm network", inbound: "Inbound", giving: "Giving Landscape", "market-scan": "DMV market scan", other: "Other" };
const INTEREST = { "institutionalos-diagnostic": "Diagnostic", retainer: "Retainer", project: "Project", coaching: "Coaching", speaking: "Speaking" };
const ORGSTAGE = { build: "Build", fund: "Fund", sustain: "Sustain" };
const TRIGGER = { expansion: "Expansion", funder: "Funder readiness", founder: "Founder dependence", strain: "Capacity strain", transition: "Leadership transition", checkup: "Check-up" };
const SITUATION = { expansion: "Expansion Readiness", funder: "Funder Readiness", founder: "Founder Dependence", strain: "Capacity Strain", transition: "Leadership Transition", checkup: "Check-up" };
const SIGNAL = { outpacing: "Growth outpacing", growing: "Growing", steady: "Steady", declining: "Declining" };
const MSTATUS = { new: "New", watch: "Watch", prospect: "In Prospecting", not_fit: "Not a fit", client: "Client" };
const DIMS = [["strategy", "Strategy"], ["program", "Program & evidence"], ["revenue", "Revenue"], ["leadership", "Leadership"], ["operations", "Operations"], ["partnerships", "Partnerships"], ["governance", "Governance"]];
const NTEE = { B: "Education", O: "Youth development", J: "Employment and workforce", P: "Human services", A: "Arts and culture", E: "Health care", F: "Mental health", I: "Crime and legal", K: "Food and nutrition", L: "Housing", N: "Recreation and sports", R: "Civil rights", S: "Community improvement", T: "Philanthropy", W: "Public benefit", C: "Environment", D: "Animals", G: "Diseases", H: "Medical research", M: "Public safety", Q: "International", U: "Science", V: "Social science", X: "Religion", Y: "Mutual benefit", Z: "Unknown" };
const SCHOOLS = "(left(ntee, 3) IN ('B20','B21','B24','B25','B28','B40','B41','B42','B43','B50','B94') OR ntee IN ('B2','B4'))";

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const pj = (s) => { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } };
const d10 = (s) => String(s || "").slice(0, 10);
const num = (v) => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? "" : Number(v));
const lineOf = (notes, label) => { const m = new RegExp("^" + label + ":\\s*(.+)$", "mi").exec(notes || ""); return m ? m[1].trim() : ""; };
const isWebsite = (src) => /website|assessment|pop-up|tool/i.test(src || "");

async function q(pool, sql, vals) { try { return (await pool.query(sql, vals || [])).rows; } catch (e) { return []; } }

// Every tab as {title, note, head, rows}. Rows are arrays of plain values.
async function build(pool) {
  const mods = ORG.modules || {};
  let over = {}; try { over = JSON.parse(((await q(pool, "SELECT value FROM app_settings WHERE key = 'modules'"))[0] || {}).value || "{}"); } catch (e) { /* defaults */ }
  const on = (k) => (k in over ? over[k] !== false : mods[k] !== false);
  const prospects = await q(pool, "SELECT * FROM prospects WHERE archived_at IS NULL ORDER BY created_at DESC");
  const pipeline = await q(pool, "SELECT * FROM pipeline WHERE archived_at IS NULL ORDER BY updated_at DESC NULLS LAST");
  const contacts = await q(pool, `SELECT c.*, o.name AS org_name, (SELECT string_agg(DISTINCT role, ', ') FROM contact_links l WHERE l.contact_id = c.id) AS roles
    FROM contacts c LEFT JOIN organizations o ON o.id = c.org_id WHERE c.archived_at IS NULL ORDER BY lower(c.name)`);
  const emailFor = (name, org, notes) => {
    const m = EMAIL_RE.exec(`${name || ""} ${notes || ""}`); if (m) return m[0];
    const c = contacts.find((x) => x.email && name && x.name.toLowerCase() === String(name).toLowerCase());
    return c ? c.email : "";
  };
  const selfCols = (ss) => DIMS.map(([k]) => (ss && typeof ss[k] === "number" ? ss[k] : ""));
  const tabs = [];

  // 1. Website leads: contact form, free tools, pop-up sign-ups.
  const web = prospects.filter((p) => isWebsite(p.source));
  tabs.push({ title: "Website leads", note: "Everyone who reached out, took a free tool, or signed up on the website.",
    head: ["Date", "Name", "Email", "Organization", "How they came in", "Status", "Wants", "Stage", "Situation", "Tool", "Composite score", ...DIMS.map((x) => "Self-score: " + x[1]), "Notes"],
    rows: web.map((p) => { const ss = pj(p.self_scores); return [d10(p.created_at), EMAIL_RE.test(p.name) ? "" : p.name, emailFor(p.name, p.org, p.notes), p.org, p.source, PSTATUS[p.status] || p.status, INTEREST[p.interest] || p.interest || "", ORGSTAGE[p.org_stage] || "", TRIGGER[p.trigger_key] || "",
      lineOf(p.notes, "Tool"), lineOf(p.notes, "Composite score"), ...selfCols(ss), String(p.notes || "").slice(0, 1000)]; }) });

  // 2. All prospects, every source.
  tabs.push({ title: "All prospects", note: "Prospecting: every lead from every source (website, LinkedIn, referrals, events, the market scan).",
    head: ["Date", "Name", "Email", "Organization", "Source", "Status", "Wants", "Stage", "Situation", "Link", "Notes"],
    rows: prospects.map((p) => [d10(p.created_at), EMAIL_RE.test(p.name) ? "" : p.name, emailFor(p.name, p.org, p.notes), p.org, SOURCE[p.source] || p.source, PSTATUS[p.status] || p.status,
      INTEREST[p.interest] || p.interest || "", ORGSTAGE[p.org_stage] || "", TRIGGER[p.trigger_key] || "", p.link || "", String(p.notes || "").slice(0, 1000)]) });

  // 3. Pipeline.
  const contactFor = (p) => { const l = contacts.find((c) => c.org_name && p.org && c.org_name.toLowerCase() === p.org.toLowerCase() && c.email); return l ? [l.name, l.email] : [p.name !== p.org ? p.name : "", ""]; };
  tabs.push({ title: "Pipeline", note: "Deals in Pipeline & Money, newest activity first.",
    head: ["Organization", "Contact", "Email", "Stage", "Offer", "Deal value", "Next step", "Next step date", "Source", "Situation", "Health Index", "Last updated", "Notes"],
    rows: pipeline.map((p) => { const [cn, ce] = contactFor(p); return [p.org || p.name, cn, ce, STAGE[p.stage] || p.stage, TRACK[p.track] || p.track, num(p.deal_value), p.next_step, p.next_step_date, p.source, TRIGGER[p.trigger_key] || "",
      p.ios_overall == null ? "" : Math.round(Number(p.ios_overall)), d10(p.updated_at), String(p.notes || "").slice(0, 1000)]; }) });

  // 4. Diagnostics (InstitutionalOS results on linked deals).
  const diag = pipeline.filter((p) => p.ios_org_id || p.ios_overall != null || p.self_scores);
  tabs.push({ title: "Diagnostics", note: "InstitutionalOS results and self-scores for deals that have them.",
    head: ["Organization", "Stage", "Health Index (verified)", "Decision", "Binding constraint", "Next session", "90-day plan started", "Portal", ...DIMS.map((x) => "Self-score: " + x[1])],
    rows: diag.map((p) => { const plan = pj(p.ios_plan) || {}; return [p.org || p.name, STAGE[p.stage] || p.stage, p.ios_overall == null ? "" : Math.round(Number(p.ios_overall)), p.ios_decision || "", p.ios_constraint || "", d10(p.ios_next_session), plan.startDate || "", p.ios_portal_url || "", ...selfCols(pj(p.self_scores))]; }) });

  // 5. DMV market scan (internal ratings).
  const scan = await q(pool, `SELECT * FROM market_orgs WHERE NOT ${SCHOOLS} ORDER BY fit DESC NULLS LAST, bmf_revenue DESC NULLS LAST LIMIT 20000`);
  tabs.push({ title: "DMV market scan", note: "INTERNAL: named public-filing ratings. Don't share outside the team.",
    head: ["EIN", "Organization", "City", "State", "Area", "Program area", "Latest revenue", "Latest year filed", "Public financial score", "Reserve months", "Deficit years (last 3)", "Revenue change", "Growth signal", "Likely situation", "Fit", "Status", "Notes", "ProPublica"],
    rows: scan.map((r) => { const s = pj(r.signals) || {}; return [r.ein, r.name, String(r.city || "").toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()), r.state, r.area, NTEE[(r.ntee || "Z").slice(0, 1)] || "", num(s.revenue != null ? s.revenue : r.bmf_revenue), s.latestYear || "",
      num(r.public_score), s.reserveMonths != null ? Math.round(s.reserveMonths * 10) / 10 : "", s.deficitYears != null ? s.deficitYears : "", s.revenueChange != null ? Math.round(s.revenueChange * 100) + "%" : "",
      SIGNAL[r.growth_flag] || "", SITUATION[r.situation] || "", r.fit || 0, MSTATUS[r.status] || r.status, r.notes || "", `https://projects.propublica.org/nonprofits/organizations/${r.ein}`]; }) });

  // 6. Contacts.
  tabs.push({ title: "Contacts", note: "One row per person (Contacts view), with every role they hold.",
    head: ["Name", "Email", "Phone", "Title", "Organization", "Roles", "Added"],
    rows: contacts.map((c) => [c.name, c.email, c.phone, c.title, c.org_name || "", c.roles || "", d10(c.created_at)]) });

  // 7-8. Foundation areas, when on.
  if (on("grantmaking")) {
    const apps = await q(pool, "SELECT * FROM gm_applications WHERE archived_at IS NULL ORDER BY created_at DESC");
    tabs.push({ title: "Grant applicants", note: "Grantmaking: every application.",
      head: ["Organization", "EIN", "Contact", "Email", "Project", "Requested", "Awarded", "Status", "Received"],
      rows: apps.map((a) => [a.org_name, a.ein, a.contact_name, a.contact_email, a.project_title, num(a.amount_requested), num(a.amount_awarded), a.status, d10(a.created_at)]) });
  }
  if (on("fundraising")) {
    const donors = await q(pool, `SELECT d.*, (SELECT COALESCE(sum(amount), 0) FROM fr_gifts g WHERE g.donor_id = d.id AND g.archived_at IS NULL) AS total, (SELECT max(received_on) FROM fr_gifts g WHERE g.donor_id = d.id AND g.archived_at IS NULL) AS last_gift
      FROM fr_donors d WHERE d.archived_at IS NULL ORDER BY lower(d.name)`);
    tabs.push({ title: "Donors", note: "Fundraising: donors and donor prospects with lifetime giving.",
      head: ["Name", "Kind", "Email", "Phone", "Lifetime giving", "Last gift", "Stage", "Capacity", "Do not solicit"],
      rows: donors.map((d) => [d.name, d.kind, d.email, d.phone, num(d.total), d10(d.last_gift), d.stage || "", d.capacity || "", d.no_solicit ? "Yes" : ""]) });
  }

  // Summary first.
  const count = (arr, f) => arr.filter(f).length;
  const sum = [
    ["Prospect report", (ORG.org || {}).name || ""],
    ["Updated", new Date().toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }) + " ET"],
    ["Internal", "For the team only. The DMV market scan tab names organizations with private ratings."],
    [],
    ["Tab", "Rows", "What it is"],
    ...tabs.map((t) => [t.title, t.rows.length, t.note]),
    [],
    ["Pipeline by stage", "Deals"],
    ...Object.keys(STAGE).map((k) => [STAGE[k], count(pipeline, (p) => p.stage === k)]),
    [],
    ["Prospects by status", "People"],
    ...Object.keys(PSTATUS).map((k) => [PSTATUS[k], count(prospects, (p) => p.status === k)]),
    [],
    ["Website leads, last 30 days", count(web, (p) => d10(p.created_at) >= new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10))],
  ];
  return [{ title: "Summary", head: null, rows: sum }].concat(tabs);
}

// ---------- Google Sheets ----------
const cell = (v) => (v === null || v === undefined ? "" : typeof v === "number" ? v : String(v).slice(0, 49000));
async function writeSheet(pool, account, existingId, tabs) {
  const g = (url, opts) => GMAIL.gapi(pool, account, url, opts);
  const json = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const title = ((ORG.org || {}).name || "Organization") + " — Prospect report";
  let id = existingId, meta;
  if (id) { try { meta = await g(`${SHEETS}/v4/spreadsheets/${id}?fields=spreadsheetId,spreadsheetUrl,sheets.properties`); } catch (e) { if (/not found|404|permission/i.test(e.message)) id = null; else throw e; } }
  if (!id) {
    meta = await g(`${SHEETS}/v4/spreadsheets`, json("POST", { properties: { title }, sheets: tabs.map((t, i) => ({ properties: { title: t.title, index: i } })) }));
    id = meta.spreadsheetId;
  }
  const have = Object.fromEntries((meta.sheets || []).map((s) => [s.properties.title, s.properties.sheetId]));
  const add = tabs.filter((t) => !(t.title in have)).map((t) => ({ addSheet: { properties: { title: t.title } } }));
  if (add.length) {
    const r = await g(`${SHEETS}/v4/spreadsheets/${id}:batchUpdate`, json("POST", { requests: add }));
    (r.replies || []).forEach((x) => { if (x.addSheet) have[x.addSheet.properties.title] = x.addSheet.properties.sheetId; });
  }
  await g(`${SHEETS}/v4/spreadsheets/${id}/values:batchClear`, json("POST", { ranges: tabs.map((t) => `'${t.title}'`) }));
  // Write in chunks so a big market scan stays under request limits.
  for (const t of tabs) {
    const rows = (t.head ? [t.head] : []).concat(t.rows).map((r) => r.map(cell));
    for (let i = 0; i < rows.length; i += 4000) {
      await g(`${SHEETS}/v4/spreadsheets/${id}/values/${encodeURIComponent(`'${t.title}'!A${i + 1}`)}?valueInputOption=RAW`, json("PUT", { values: rows.slice(i, i + 4000) }));
    }
  }
  const fmt = [];
  for (const t of tabs) {
    const sid = have[t.title]; if (sid == null) continue;
    if (t.head) {
      fmt.push({ updateSheetProperties: { properties: { sheetId: sid, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } });
      fmt.push({ repeatCell: { range: { sheetId: sid, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.07, green: 0.13, blue: 0.24 }, horizontalAlignment: "LEFT" } }, fields: "userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)" } });
      fmt.push({ repeatCell: { range: { sheetId: sid, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } } } }, fields: "userEnteredFormat.textFormat" } });
      fmt.push({ setBasicFilter: { filter: { range: { sheetId: sid, startRowIndex: 0, endRowIndex: t.rows.length + 1, startColumnIndex: 0, endColumnIndex: t.head.length } } } });
    } else {
      fmt.push({ repeatCell: { range: { sheetId: sid, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 14 } } }, fields: "userEnteredFormat.textFormat" } });
    }
    fmt.push({ autoResizeDimensions: { dimensions: { sheetId: sid, dimension: "COLUMNS", startIndex: 0, endIndex: Math.min(t.head ? t.head.length : 3, 26) } } });
  }
  if (fmt.length) await g(`${SHEETS}/v4/spreadsheets/${id}:batchUpdate`, json("POST", { requests: fmt })).catch(() => {});
  return { id, url: meta.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${id}/edit` };
}

async function state(pool) { try { return JSON.parse(((await q(pool, "SELECT value FROM app_settings WHERE key = $1", [KEY]))[0] || {}).value || "{}"); } catch (e) { return {}; } }
async function save(pool, v) { await pool.query("INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [KEY, JSON.stringify(v)]); }

async function account(pool) {
  const s = await GMAIL.sender(pool);
  if (!s) throw Object.assign(new Error("Connect a Google account first (Settings > Connected email)."), { status: 409 });
  const a = (await GMAIL.accounts(pool)).find((x) => x.email === s.account);
  if (a && a.scope && !/drive\.file/.test(a.scope)) throw Object.assign(new Error("This Google connection doesn't include Google Sheets. In Settings > Connected email, disconnect and connect again, and allow the Drive permission."), { status: 409 });
  return s.account;
}
// Create or refresh. Returns the saved state.
async function refresh(pool) {
  const acct = await account(pool);
  const st = await state(pool);
  const tabs = await build(pool);
  const out = await writeSheet(pool, acct, st.account === acct ? st.id : null, tabs);
  const next = { id: out.id, url: out.url, account: acct, updatedAt: new Date().toISOString(), counts: Object.fromEntries(tabs.filter((t) => t.head).map((t) => [t.title, t.rows.length])), shared: st.account === acct ? st.shared || [] : [] };
  await save(pool, next);
  return next;
}
// Background: refresh once a day if a sheet exists.
async function dailyRefresh(pool) {
  const st = await state(pool);
  if (!st.id || (st.updatedAt && Date.now() - Date.parse(st.updatedAt) < 20 * 3600 * 1000)) return { skipped: true };
  const r = await refresh(pool); return { refreshed: true, at: r.updatedAt };
}

function csv(tab) {
  const qv = (v) => '"' + String(v === null || v === undefined ? "" : v).replace(/"/g, '""') + '"';
  return "﻿" + (tab.head ? [tab.head] : []).concat(tab.rows).map((r) => r.map(qv).join(",")).join("\r\n") + "\r\n";
}

function mount(app, { pool, requireAuth }) {
  const wrap = (fn) => async (req, res) => { try { await fn(req, res); } catch (err) { if (!err.status) console.error("sheets", err); res.status(err.status || 502).json({ error: String(err.message || err) }); } };
  const writer = (req, res, next) => (req.session && req.session.role !== "board" ? next() : res.status(403).json({ error: "Board accounts can view the report but not change it." }));
  app.get("/api/reports/prospects", requireAuth, wrap(async (req, res) => {
    const st = await state(pool), tabs = await build(pool), s = await GMAIL.sender(pool).catch(() => null);
    const a = s ? (await GMAIL.accounts(pool)).find((x) => x.email === s.account) : null;
    res.json({ sheet: st.id ? { url: st.url, updatedAt: st.updatedAt, account: st.account, shared: st.shared || [] } : null,
      google: s ? { account: s.account, sheets: !a || !a.scope || /drive\.file/.test(a.scope) } : null,
      tabs: tabs.map((t) => ({ title: t.title, rows: t.head ? t.rows.length : null, note: t.note || "" })) });
  }));
  app.post("/api/reports/prospects/sheet", requireAuth, writer, wrap(async (req, res) => {
    const r = await refresh(pool); res.json({ ok: true, url: r.url, updatedAt: r.updatedAt, counts: r.counts });
  }));
  app.post("/api/reports/prospects/share", requireAuth, (req, res, next) => (req.session && req.session.role === "owner" ? next() : res.status(403).json({ error: "Only the owner can share the report." })), wrap(async (req, res) => {
    const st = await state(pool);
    if (!st.id) return res.status(409).json({ error: "Create the sheet first." });
    const emails = String((req.body || {}).emails || "").split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter((e) => EMAIL_RE.test(e)).slice(0, 25);
    if (!emails.length) return res.status(400).json({ error: "Add at least one email address." });
    const role = (req.body || {}).role === "writer" ? "writer" : "reader";
    const done = [];
    for (const e of emails) {
      await GMAIL.gapi(pool, st.account, `${DRIVE}/drive/v3/files/${st.id}/permissions?sendNotificationEmail=true`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "user", role, emailAddress: e }) });
      done.push({ email: e, role, at: new Date().toISOString() });
    }
    st.shared = (st.shared || []).filter((x) => !emails.includes(x.email)).concat(done);
    await save(pool, st);
    res.json({ ok: true, shared: st.shared });
  }));
  app.get("/api/reports/prospects.csv", requireAuth, wrap(async (req, res) => {
    const tabs = await build(pool);
    const tab = tabs.find((t) => t.title === req.query.tab) || tabs[1];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${tab.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv"`);
    res.send(csv(tab));
  }));
}

module.exports = { mount, build, refresh, dailyRefresh };
