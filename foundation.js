"use strict";
// Foundation areas: grantmaking (giving money out) and fundraising (raising it).
// Both are switched on per organization in org.config.json "modules" or in
// Settings > Areas. Tables are in schema.sql (gm_* and fr_*). Everything here
// sits behind the normal sign-in and roles (board accounts are read-only),
// except the public grant application form at /apply/<program>.
//
// Grantmaking
//   /api/gm/programs        grant programs: budget, dates, scoring criteria, form questions
//   /api/gm/applications    applications, with reviews, payments, and reports on GET /:id
//   /api/gm/applications/:id/review   one review per reviewer (scores 1-5 per criterion)
//   /api/gm/applications/:id/award    approve: amount, period, payment schedule, reports due
//   /api/gm/payments, /api/gm/reports mark paid / received
//   /api/gm/summary         budget, committed, paid, what's due
//   /letter/grant/:id       award or decline letter, editable before printing
//   /apply/:slug            public application form (POST /api/public/apply/:slug)
//
// Fundraising
//   /api/fr/donors, /api/fr/campaigns, /api/fr/pledges, /api/fr/gifts, /api/fr/touches
//   /api/fr/donors/:id      donor profile with giving history
//   /api/fr/gifts/ack       mark gifts thanked
//   /api/fr/summary         raised this year, retention, campaign progress, to-dos
//   /letter/receipt         thank-you letters with tax receipt wording
//   /api/fr/export/{gifts,donors}.csv, POST /api/fr/import (gifts CSV)

const crypto = require("crypto");
const { ORG } = require("./accounts");

const newId = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();
const todayIso = () => new Date().toISOString().slice(0, 10);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const longDate = (iso) => isDate(iso) ? new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";
const slugify = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "program";
function parseJson(s, fallback) { try { const v = JSON.parse(s); return v == null ? fallback : v; } catch (e) { return fallback; } }
function addMonths(iso, n) {
  const d = new Date((isDate(iso) ? iso : todayIso()) + "T12:00:00Z");
  const day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}
function cfg(area) { return (ORG && ORG[area]) || {}; }
function brand() {
  const b = ORG.brand || {};
  return { navy: b.navy || "#11233D", gold: b.gold || "#B28E42" };
}

// ---------- field specs: api name -> [column, type] ----------
// s text, n number, b boolean, i integer, j JSON stored as text, d date (YYYY-MM-DD or "")
const SPECS = {
  gm_programs: {
    required: ["name"],
    fields: { name: ["name", "s"], slug: ["slug", "s"], purpose: ["purpose", "s"], eligibility: ["eligibility", "s"], budget: ["budget", "n"], maxAward: ["max_award", "n"],
      opensOn: ["opens_on", "d"], closesOn: ["closes_on", "d"], status: ["status", "s"], acceptsOnline: ["accepts_online", "b"], criteria: ["criteria", "j"], questions: ["questions", "j"] },
  },
  gm_applications: {
    required: ["orgName"],
    fields: { programId: ["program_id", "s"], orgName: ["org_name", "s"], ein: ["ein", "s"], contactName: ["contact_name", "s"], contactEmail: ["contact_email", "s"], contactPhone: ["contact_phone", "s"],
      website: ["website", "s"], annualBudget: ["annual_budget", "n"], projectTitle: ["project_title", "s"], summary: ["summary", "s"], amountRequested: ["amount_requested", "n"], answers: ["answers", "j"],
      status: ["status", "s"], source: ["source", "s"], decisionNotes: ["decision_notes", "s"], decidedAt: ["decided_at", "s"], amountAwarded: ["amount_awarded", "n"],
      awardStart: ["award_start", "d"], awardEnd: ["award_end", "d"], agreementSignedOn: ["agreement_signed_on", "d"] },
  },
  gm_payments: {
    required: ["applicationId"], hardDelete: true,
    fields: { applicationId: ["application_id", "s"], dueOn: ["due_on", "d"], amount: ["amount", "n"], paidOn: ["paid_on", "d"], reference: ["reference", "s"], condition: ["condition", "s"] },
  },
  gm_reports: {
    required: ["applicationId"], hardDelete: true,
    fields: { applicationId: ["application_id", "s"], kind: ["kind", "s"], dueOn: ["due_on", "d"], receivedOn: ["received_on", "d"], summary: ["summary", "s"], token: ["token", "ro"], link: ["link", "s"], submittedBy: ["submitted_by", "ro"] },
  },
  fr_campaigns: {
    required: ["name"],
    fields: { name: ["name", "s"], goal: ["goal", "n"], fundType: ["fund_type", "s"], startsOn: ["starts_on", "d"], endsOn: ["ends_on", "d"], notes: ["notes", "s"] },
  },
  fr_donors: {
    required: ["name"],
    fields: { kind: ["kind", "s"], name: ["name", "s"], salutation: ["salutation", "s"], email: ["email", "s"], phone: ["phone", "s"], address: ["address", "s"], city: ["city", "s"], state: ["state", "s"], zip: ["zip", "s"],
      owner: ["owner", "s"], stage: ["stage", "s"], capacity: ["capacity", "n"], notes: ["notes", "s"], noSolicit: ["no_solicit", "b"] },
  },
  fr_pledges: {
    required: ["donorId"],
    fields: { donorId: ["donor_id", "s"], campaignId: ["campaign_id", "s"], total: ["total", "n"], pledgedOn: ["pledged_on", "d"], frequency: ["frequency", "s"], installments: ["installments", "i"],
      firstDue: ["first_due", "d"], status: ["status", "s"], notes: ["notes", "s"] },
  },
  fr_gifts: {
    required: ["donorId"],
    fields: { donorId: ["donor_id", "s"], campaignId: ["campaign_id", "s"], pledgeId: ["pledge_id", "s"], amount: ["amount", "n"], receivedOn: ["received_on", "d"], method: ["method", "s"], reference: ["reference", "s"],
      restriction: ["restriction", "s"], inKindDescription: ["in_kind_description", "s"], goodsServicesValue: ["goods_services_value", "n"], ackSentOn: ["ack_sent_on", "d"], notes: ["notes", "s"], receiptNo: ["receipt_no", "ro"] },
  },
  fr_touches: {
    required: ["donorId"], hardDelete: true,
    fields: { donorId: ["donor_id", "s"], onDate: ["on_date", "d"], kind: ["kind", "s"], summary: ["summary", "s"], nextStep: ["next_step", "s"], nextOn: ["next_on", "d"], done: ["done", "b"] },
  },
};
const FK_FIELDS = { program_id: 1, campaign_id: 1, pledge_id: 1 }; // "" means none -> NULL

function coerce(type, v) {
  if (type === "n") { const n = Number(String(v == null ? "" : v).replace(/[$,\s]/g, "")); return isFinite(n) ? n : 0; }
  if (type === "i") { const n = parseInt(v, 10); return isFinite(n) ? n : 0; }
  if (type === "b") return v === true || v === "true" || v === 1 || v === "1" || v === "on";
  if (type === "j") return typeof v === "string" ? v : JSON.stringify(v == null ? null : v);
  if (type === "d") { const s = String(v || "").slice(0, 10); return isDate(s) ? s : ""; }
  return String(v == null ? "" : v).slice(0, 20000);
}
function toApi(table, row) {
  if (!row) return null;
  const out = { id: row.id };
  for (const [api, [col, type]] of Object.entries(SPECS[table].fields)) {
    let v = row[col];
    if (type === "n") v = Number(v) || 0;
    else if (type === "j") v = parseJson(v, col === "answers" || col === "scores" ? {} : []);
    else if (type === "b") v = !!v;
    else if (v == null) v = (type === "i" || type === "ro") ? null : "";
    out[api] = v;
  }
  for (const k of ["created_at", "updated_at", "archived_at"]) if (k in row) out[k.replace(/_([a-z])/g, (m, c) => c.toUpperCase())] = row[k] || "";
  return out;
}

async function insertRow(pool, table, body, extra = {}) {
  const spec = SPECS[table];
  for (const r of spec.required) if (!String(body[r] == null ? "" : body[r]).trim()) throw Object.assign(new Error(r + " is required"), { status: 400 });
  const cols = ["id"], vals = [body.id && /^[\w-]{6,80}$/.test(body.id) ? body.id : newId()];
  for (const [api, [col, type]] of Object.entries(spec.fields)) {
    if (type === "ro" || !(api in body)) continue;
    let v = coerce(type, body[api]);
    if (FK_FIELDS[col] && !v) v = null;
    cols.push(col); vals.push(v);
  }
  for (const [col, v] of Object.entries(extra)) { cols.push(col); vals.push(v); }
  const t = nowIso();
  cols.push("created_at"); vals.push(t);
  if (HAS_UPDATED[table]) { cols.push("updated_at"); vals.push(t); }
  const r = await pool.query(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map((_, i) => "$" + (i + 1)).join(",")}) RETURNING *`, vals);
  return r.rows[0];
}
const HAS_UPDATED = { gm_programs: 1, gm_applications: 1, gm_reviews: 1, fr_donors: 1 };
async function updateRow(pool, table, id, body) {
  const spec = SPECS[table];
  const sets = [], vals = [];
  for (const [api, [col, type]] of Object.entries(spec.fields)) {
    if (type === "ro" || !(api in body)) continue;
    let v = coerce(type, body[api]);
    if (FK_FIELDS[col] && !v) v = null;
    vals.push(v); sets.push(`${col} = $${vals.length}`);
  }
  if (HAS_UPDATED[table]) { vals.push(nowIso()); sets.push(`updated_at = $${vals.length}`); }
  if (!sets.length) return (await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [id])).rows[0];
  vals.push(id);
  const r = await pool.query(`UPDATE ${table} SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING *`, vals);
  return r.rows[0];
}

// Plain CRUD routes for one table. list filters: ?<apiField>=value for id fields.
function crud(app, pool, requireAuth, base, table, opts = {}) {
  const spec = SPECS[table];
  const wrap = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      if (err.code === "23503") return res.status(400).json({ error: "A linked record doesn't exist." });
      if (err.code === "23505") return res.status(409).json({ error: "That already exists." });
      console.error(base, err); res.status(500).json({ error: "server error" });
    }
  };
  app.get(base, requireAuth, wrap(async (req, res) => {
    const where = spec.hardDelete ? [] : ["archived_at IS NULL"], vals = [];
    for (const [api, [col]] of Object.entries(spec.fields)) {
      if (/_id$/.test(col) && req.query[api]) { vals.push(String(req.query[api])); where.push(`${col} = $${vals.length}`); }
    }
    const r = await pool.query(`SELECT * FROM ${table}${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY ${opts.order || "created_at DESC"} LIMIT 5000`, vals);
    res.json({ items: r.rows.map((x) => toApi(table, x)) });
  }));
  app.post(base, requireAuth, wrap(async (req, res) => {
    const body = opts.beforeCreate ? await opts.beforeCreate(req.body || {}) : (req.body || {});
    const row = await insertRow(pool, table, body);
    res.status(201).json({ item: toApi(table, row) });
  }));
  app.patch(base + "/:id", requireAuth, wrap(async (req, res) => {
    const body = opts.beforeUpdate ? opts.beforeUpdate(Object.assign({}, req.body || {})) : (req.body || {});
    const row = await updateRow(pool, table, req.params.id, body);
    if (!row) return res.status(404).json({ error: "not found" });
    res.json({ item: toApi(table, row) });
  }));
  app.delete(base + "/:id", requireAuth, wrap(async (req, res) => {
    if (spec.hardDelete) await pool.query(`DELETE FROM ${table} WHERE id = $1`, [req.params.id]);
    else await pool.query(`UPDATE ${table} SET archived_at = $1 WHERE id = $2`, [nowIso(), req.params.id]);
    res.json({ ok: true });
  }));
  return wrap;
}

// ---------- scoring ----------
function reviewAverage(review, criteria) {
  const s = parseJson(review.scores, {});
  const keys = (criteria.length ? criteria.map((c) => c.key) : Object.keys(s)).filter((k) => Number(s[k]) >= 1);
  if (!keys.length) return null;
  return keys.reduce((a, k) => a + Number(s[k]), 0) / keys.length;
}
function scoreSummary(reviews, criteria) {
  const counted = reviews.filter((r) => !r.conflict);
  const avgs = counted.map((r) => reviewAverage(r, criteria)).filter((x) => x != null);
  const rec = { fund: 0, "fund-with-changes": 0, decline: 0 };
  counted.forEach((r) => { if (rec[r.recommendation] != null) rec[r.recommendation]++; });
  return { reviews: counted.length, conflicts: reviews.length - counted.length, average: avgs.length ? Math.round((avgs.reduce((a, b) => a + b, 0) / avgs.length) * 10) / 10 : null, recommendations: rec };
}

// ---------- fiscal year ----------
function fiscalYear(offsetYears = 0, refIso) {
  const startMonth = Math.min(12, Math.max(1, Number(cfg("fundraising").fiscalYearStartMonth) || 1));
  const ref = new Date((refIso || todayIso()) + "T12:00:00Z");
  let y = ref.getUTCFullYear();
  if (ref.getUTCMonth() + 1 < startMonth) y -= 1;
  y += offsetYears;
  const from = `${y}-${String(startMonth).padStart(2, "0")}-01`;
  const to = `${y + 1}-${String(startMonth).padStart(2, "0")}-01`;
  // A July-June year that ends in 2027 is "FY27"; a calendar year is just "2026".
  return { from, to, label: startMonth === 1 ? String(y) : `FY${String(y + 1).slice(2)}` };
}
const inRange = (iso, r) => !!iso && iso >= r.from && iso < r.to;

// ---------- CSV ----------
function csvCell(v) { const s = String(v == null ? "" : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function toCsv(rows, cols) { return [cols.map((c) => c[0]).join(",")].concat(rows.map((r) => cols.map((c) => csvCell(typeof c[1] === "function" ? c[1](r) : r[c[1]])).join(","))).join("\r\n") + "\r\n"; }
function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  const s = String(text || "").replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && s[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}
function parseLooseDate(s) {
  s = String(s || "").trim();
  if (isDate(s)) return s;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`; }
  const d = new Date(s); return isNaN(d) ? "" : d.toISOString().slice(0, 10);
}

// ---------- shared letter shell ----------
function letterPage({ title, toolbar, note, body }) {
  const { navy, gold } = brand();
  const o = ORG.org || {};
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | ${esc(o.shortName || o.name || "")}</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<style>
:root{--navy:${navy};--gold:${gold};}*{box-sizing:border-box}
body{margin:0;background:#F3F5F7;color:#23282D;font:15.5px/1.6 Inter,system-ui,sans-serif}
.page{max-width:820px;margin:0 auto 40px;background:#fff;padding:48px 56px;page-break-after:always}
.page:last-child{page-break-after:auto}
.lh{display:flex;justify-content:space-between;gap:16px;border-bottom:3px solid var(--gold);padding-bottom:12px;margin-bottom:28px;flex-wrap:wrap}
.lh b{font-family:"Playfair Display",Georgia,serif;font-size:22px;color:var(--navy)}.lh span{color:#55606B;font-size:13px;text-align:right}
h1{font-family:"Playfair Display",Georgia,serif;color:var(--navy);font-size:24px;margin:0 0 6px}h2{font-size:14px;text-transform:uppercase;letter-spacing:.06em;color:var(--navy);margin:24px 0 8px}
[contenteditable]{outline:1px dashed transparent;border-radius:4px}[contenteditable]:hover{outline-color:#CBD2D9}[contenteditable]:focus{outline-color:var(--gold)}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #E3E7EB}th{color:#55606B;font-weight:600}
ul{padding-left:20px}li{margin:4px 0}.big{font-size:18px;font-weight:600;color:var(--navy)}
.receipt{margin-top:28px;padding:14px 16px;border:1px solid #CBD2D9;border-radius:8px;font-size:13.5px;background:#FAFBFC}
.sign{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:40px}.sign div{border-top:1px solid #23282D;padding-top:6px;font-size:13px;color:#55606B}
.toolbar{max-width:820px;margin:16px auto;display:flex;gap:10px;flex-wrap:wrap;justify-content:space-between;align-items:center;font-size:14px}
.toolbar select,.toolbar button,.toolbar a{font:inherit;font-weight:600;padding:8px 12px;border-radius:8px;border:1px solid #CBD2D9;background:#fff;color:var(--navy);text-decoration:none;cursor:pointer}
.note{max-width:820px;margin:0 auto 10px;color:#55606B;font-size:13px}.warn{color:#8A3B12;font-weight:600}
@media print{body{background:#fff}.toolbar,.note{display:none}.page{padding:0;margin:0}[contenteditable]{outline:none}}
@media(max-width:700px){.page{padding:28px 20px}.sign{grid-template-columns:1fr}}
</style></head><body>
<div class="toolbar">${toolbar || ""}<span><a href="/">Back to Operations</a> <button onclick="window.print()">Print or save as PDF</button></span></div>
${note ? `<p class="note">${note}</p>` : ""}
${body}
</body></html>`;
}
function letterhead() {
  const o = ORG.org || {};
  return `<div class="lh"><b>${esc(o.name || "")}</b><span>${esc(o.email || "")}${o.phone ? "<br>" + esc(o.phone) : ""}${o.region ? "<br>" + esc(o.region) : ""}</span></div>`;
}
function signature() {
  const o = ORG.org || {}, l = o.leader || {};
  return `<p contenteditable="true">With gratitude,</p><p contenteditable="true" style="margin-top:28px"><strong>${esc(l.name || "")}</strong><br>${esc(l.title || "")}, ${esc(o.name || "")}</p>`;
}

// ---------- public application form ----------
const applyHits = new Map(); // ip -> [timestamps]
function applyLimited(ip) {
  const now = Date.now(), hour = 3600000;
  const list = (applyHits.get(ip) || []).filter((t) => now - t < hour);
  list.push(now); applyHits.set(ip, list);
  return list.length > 5;
}
setInterval(() => { const cut = Date.now() - 3600000; for (const [ip, l] of applyHits) if (!l.some((t) => t > cut)) applyHits.delete(ip); }, 3600000).unref();

function programIsOpen(p) {
  const t = todayIso();
  return p && !p.archived_at && p.status === "open" && p.accepts_online && (!p.opens_on || p.opens_on <= t) && (!p.closes_on || p.closes_on >= t);
}
function applyPage(p, message) {
  const { navy, gold } = brand();
  const o = ORG.org || {};
  const qs = parseJson(p && p.questions, []);
  const open = programIsOpen(p);
  const field = (name, label, type = "text", extra = "") => `<label>${esc(label)}<input name="${name}" type="${type}" ${extra}></label>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Apply: ${esc(p ? p.name : "Grant program")} | ${esc(o.name || "")}</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<style>
:root{--navy:${navy};--gold:${gold}}*{box-sizing:border-box}body{margin:0;background:#F3F5F7;color:#23282D;font:16px/1.6 Inter,system-ui,sans-serif}
header{background:var(--navy);color:#fff;padding:18px 16px}header .in,main{max-width:760px;margin:0 auto}header b{font-family:"Playfair Display",Georgia,serif;font-size:20px}
main{background:#fff;margin:24px auto;padding:32px clamp(16px,5vw,44px);border-radius:12px}h1{font-family:"Playfair Display",Georgia,serif;color:var(--navy);margin:0 0 8px;font-size:28px}
.meta{color:#55606B;font-size:14px;margin-bottom:18px}form{display:grid;gap:14px}label{display:flex;flex-direction:column;gap:5px;font-weight:600;font-size:14px;color:#33404C}
input,textarea{font:inherit;font-weight:400;padding:10px 12px;border:1px solid #B8C1CA;border-radius:8px;width:100%}textarea{min-height:120px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:14px}@media(max-width:620px){.two{grid-template-columns:1fr}}
button{font:inherit;font-weight:700;padding:12px 18px;border-radius:8px;border:0;background:var(--navy);color:#fff;cursor:pointer;justify-self:start}
.msg{padding:14px 16px;border-radius:8px;background:#EEF6F0;color:#1E5631;font-weight:600}.closed{background:#FBF1E6;color:#7A4A12}.hp{position:absolute;left:-5000px}
.pre{white-space:pre-wrap}
</style></head><body><header><div class="in"><b>${esc(o.name || "")}</b></div></header><main>
${p ? `<h1>${esc(p.name)}</h1><div class="meta">${p.closes_on ? "Applications close " + esc(longDate(p.closes_on)) + ". " : ""}${Number(p.max_award) ? "Awards up to " + esc(money(p.max_award)) + "." : ""}</div>
${p.purpose ? `<p class="pre">${esc(p.purpose)}</p>` : ""}${p.eligibility ? `<h3>Who can apply</h3><p class="pre">${esc(p.eligibility)}</p>` : ""}` : "<h1>Program not found</h1>"}
${message ? `<p class="msg">${esc(message)}</p>` : ""}
${p && open && !message ? `<form method="post" action="/api/public/apply/${esc(p.slug)}">
<div class="two">${field("orgName", "Organization name", "text", "required maxlength=200")}${field("ein", "EIN (tax ID)", "text", "maxlength=20 placeholder=12-3456789")}</div>
<div class="two">${field("contactName", "Your name", "text", "required maxlength=120")}${field("contactEmail", "Email", "email", "required maxlength=200")}</div>
<div class="two">${field("contactPhone", "Phone", "tel", "maxlength=40")}${field("website", "Website", "text", "maxlength=300 placeholder=example.org")}</div>
<div class="two">${field("annualBudget", "Organization's annual budget ($)", "text", "inputmode=decimal maxlength=20")}${field("amountRequested", "Amount requested ($)", "text", "required inputmode=decimal maxlength=20")}</div>
${field("projectTitle", "Project or purpose", "text", "required maxlength=200")}
<label>Summary: what the grant will do and for whom<textarea name="summary" required maxlength="5000"></textarea></label>
${qs.map((q) => `<label>${esc(q.label)}<textarea name="q_${esc(q.key)}" maxlength="5000"></textarea></label>`).join("")}
<label class="hp">Leave this empty<input name="website2" tabindex="-1" autocomplete="off"></label>
<button type="submit">Submit application</button></form>` : ""}
${p && !open && !message ? `<p class="msg closed">This program isn't accepting applications right now.</p>` : ""}
</main></body></html>`;
}

function mount(app, { pool, requireAuth }) {
  // ================= Grantmaking =================
  const wrap = crud(app, pool, requireAuth, "/api/gm/programs", "gm_programs", {
    order: "created_at DESC",
    beforeCreate: async (b) => {
      let base = slugify(b.slug || b.name), slug = base, n = 2;
      while ((await pool.query("SELECT 1 FROM gm_programs WHERE slug = $1", [slug])).rows.length) slug = `${base}-${n++}`;
      return Object.assign({}, b, { slug, criteria: normalizeList(b.criteria, DEFAULT_CRITERIA), questions: normalizeList(b.questions, []) });
    },
    // keep criteria/questions well-formed on edit; the public link (slug) never changes
    beforeUpdate: (b) => {
      if ("criteria" in b) b.criteria = normalizeList(b.criteria, DEFAULT_CRITERIA);
      if ("questions" in b) b.questions = normalizeList(b.questions, []);
      delete b.slug;
      return b;
    },
  });

  // Applications list carries score summaries so the table can sort by them.
  app.get("/api/gm/applications", requireAuth, wrap(async (req, res) => {
    const vals = [], where = ["a.archived_at IS NULL"];
    if (req.query.programId) { vals.push(String(req.query.programId)); where.push(`a.program_id = $${vals.length}`); }
    const apps = (await pool.query(`SELECT a.*, p.name AS program_name, p.criteria AS program_criteria FROM gm_applications a LEFT JOIN gm_programs p ON p.id = a.program_id WHERE ${where.join(" AND ")} ORDER BY a.created_at DESC`, vals)).rows;
    const ids = apps.map((a) => a.id);
    const reviews = ids.length ? (await pool.query("SELECT * FROM gm_reviews WHERE application_id = ANY($1)", [ids])).rows : [];
    const pays = ids.length ? (await pool.query("SELECT application_id, sum(amount)::float AS total, sum(CASE WHEN paid_on <> '' THEN amount ELSE 0 END)::float AS paid FROM gm_payments WHERE application_id = ANY($1) GROUP BY application_id", [ids])).rows : [];
    const payBy = Object.fromEntries(pays.map((p) => [p.application_id, p]));
    res.json({ items: apps.map((a) => {
      const crit = parseJson(a.program_criteria, []);
      const mine = reviews.filter((r) => r.application_id === a.id);
      return Object.assign(toApi("gm_applications", a), { programName: a.program_name || "", score: scoreSummary(mine, crit), scheduled: (payBy[a.id] || {}).total || 0, paid: (payBy[a.id] || {}).paid || 0 });
    }) });
  }));
  app.get("/api/gm/applications/:id", requireAuth, wrap(async (req, res) => {
    const a = (await pool.query("SELECT * FROM gm_applications WHERE id = $1", [req.params.id])).rows[0];
    if (!a) return res.status(404).json({ error: "not found" });
    const p = a.program_id ? (await pool.query("SELECT * FROM gm_programs WHERE id = $1", [a.program_id])).rows[0] : null;
    const crit = parseJson(p && p.criteria, []);
    const reviews = (await pool.query("SELECT * FROM gm_reviews WHERE application_id = $1 ORDER BY created_at", [a.id])).rows;
    const payments = (await pool.query("SELECT * FROM gm_payments WHERE application_id = $1 ORDER BY due_on, created_at", [a.id])).rows;
    const reports = (await pool.query("SELECT * FROM gm_reports WHERE application_id = $1 ORDER BY due_on, created_at", [a.id])).rows;
    const me = await reviewerName(pool, req.session);
    const history = a.ein ? (await pool.query("SELECT id, org_name, status, amount_awarded, created_at FROM gm_applications WHERE ein = $1 AND id <> $2 AND archived_at IS NULL ORDER BY created_at DESC", [a.ein, a.id])).rows : [];
    res.json({
      item: toApi("gm_applications", a), program: p ? toApi("gm_programs", p) : null, me,
      reviews: reviews.map((r) => ({ id: r.id, reviewer: r.reviewer, scores: parseJson(r.scores, {}), recommendation: r.recommendation, comment: r.comment, conflict: !!r.conflict, average: reviewAverage(r, crit), updatedAt: r.updated_at || r.created_at })),
      score: scoreSummary(reviews, crit),
      payments: payments.map((x) => toApi("gm_payments", x)), reports: reports.map((x) => toApi("gm_reports", x)),
      history: history.map((h) => ({ id: h.id, orgName: h.org_name, status: h.status, amountAwarded: Number(h.amount_awarded) || 0, createdAt: h.created_at })),
    });
  }));
  app.post("/api/gm/applications", requireAuth, wrap(async (req, res) => {
    const row = await insertRow(pool, "gm_applications", Object.assign({}, req.body, { source: "staff", status: (req.body && req.body.status) || "received" }));
    res.status(201).json({ item: toApi("gm_applications", row) });
  }));
  app.patch("/api/gm/applications/:id", requireAuth, wrap(async (req, res) => {
    const b = Object.assign({}, req.body || {});
    if (b.status === "declined" || b.status === "approved") b.decidedAt = b.decidedAt || nowIso();
    const row = await updateRow(pool, "gm_applications", req.params.id, b);
    if (!row) return res.status(404).json({ error: "not found" });
    res.json({ item: toApi("gm_applications", row) });
  }));
  app.delete("/api/gm/applications/:id", requireAuth, wrap(async (req, res) => {
    await pool.query("UPDATE gm_applications SET archived_at = $1 WHERE id = $2", [nowIso(), req.params.id]);
    res.json({ ok: true });
  }));

  // One review per reviewer per application; saving again replaces it.
  app.post("/api/gm/applications/:id/review", requireAuth, wrap(async (req, res) => {
    const a = (await pool.query("SELECT id FROM gm_applications WHERE id = $1", [req.params.id])).rows[0];
    if (!a) return res.status(404).json({ error: "not found" });
    const b = req.body || {};
    const reviewer = await reviewerName(pool, req.session);
    const scores = {};
    for (const [k, v] of Object.entries(b.scores || {})) { const n = parseInt(v, 10); if (n >= 1 && n <= 5) scores[String(k).slice(0, 60)] = n; }
    const rec = ["fund", "fund-with-changes", "decline"].includes(b.recommendation) ? b.recommendation : "";
    const t = nowIso();
    await pool.query(`INSERT INTO gm_reviews (id, application_id, reviewer, scores, recommendation, comment, conflict, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
      ON CONFLICT (application_id, reviewer) DO UPDATE SET scores = EXCLUDED.scores, recommendation = EXCLUDED.recommendation, comment = EXCLUDED.comment, conflict = EXCLUDED.conflict, updated_at = EXCLUDED.updated_at`,
      [newId(), a.id, reviewer, JSON.stringify(scores), rec, String(b.comment || "").slice(0, 5000), !!b.conflict, t]);
    await pool.query("UPDATE gm_applications SET status = 'in-review', updated_at = $1 WHERE id = $2 AND status IN ('received','screening')", [t, a.id]);
    res.json({ ok: true });
  }));

  // Approve with an award: amount, period, payments, reports. Replaces any
  // unpaid scheduled payments and unreceived reports; paid ones stay.
  app.post("/api/gm/applications/:id/award", requireAuth, wrap(async (req, res) => {
    const a = (await pool.query("SELECT * FROM gm_applications WHERE id = $1", [req.params.id])).rows[0];
    if (!a) return res.status(404).json({ error: "not found" });
    const b = req.body || {};
    const amount = coerce("n", b.amount);
    if (!(amount > 0)) return res.status(400).json({ error: "Enter the award amount." });
    const start = coerce("d", b.start) || todayIso();
    const end = coerce("d", b.end) || addMonths(start, 12);
    let payments = Array.isArray(b.payments) ? b.payments : [];
    if (!payments.length) {
      const n = Math.min(24, Math.max(1, parseInt(b.installments, 10) || 1));
      const months = Math.max(1, Math.round(monthsBetween(start, end) / n));
      const each = Math.floor((amount / n) * 100) / 100;
      payments = Array.from({ length: n }, (_, i) => ({ dueOn: addMonths(start, i * months), amount: i === n - 1 ? Math.round((amount - each * (n - 1)) * 100) / 100 : each }));
    }
    let reports = Array.isArray(b.reports) ? b.reports : null;
    if (!reports) {
      reports = [];
      if (b.interim !== false && monthsBetween(start, end) >= 6) reports.push({ kind: "interim", dueOn: addMonths(start, Math.round(monthsBetween(start, end) / 2)) });
      reports.push({ kind: "final", dueOn: addMonths(end, 1) });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM gm_payments WHERE application_id = $1 AND paid_on = ''", [a.id]);
      await client.query("DELETE FROM gm_reports WHERE application_id = $1 AND received_on = ''", [a.id]);
      const t = nowIso();
      for (const p of payments) await client.query("INSERT INTO gm_payments (id, application_id, due_on, amount, condition, created_at) VALUES ($1,$2,$3,$4,$5,$6)", [newId(), a.id, coerce("d", p.dueOn), coerce("n", p.amount), coerce("s", p.condition || ""), t]);
      for (const r of reports) await client.query("INSERT INTO gm_reports (id, application_id, kind, due_on, created_at, token) VALUES ($1,$2,$3,$4,$5,$6)", [newId(), a.id, ["interim", "final", "other"].includes(r.kind) ? r.kind : "other", coerce("d", r.dueOn), t, crypto.randomBytes(18).toString("base64url")]);
      await client.query("UPDATE gm_applications SET status = 'approved', amount_awarded = $1, award_start = $2, award_end = $3, decision_notes = COALESCE(NULLIF($4,''), decision_notes), decided_at = $5, updated_at = $5 WHERE id = $6",
        [amount, start, end, String(b.notes || ""), t, a.id]);
      await client.query("COMMIT");
    } catch (err) { await client.query("ROLLBACK"); throw err; } finally { client.release(); }
    res.json({ ok: true });
  }));
  crud(app, pool, requireAuth, "/api/gm/payments", "gm_payments", { order: "due_on, created_at" });
  crud(app, pool, requireAuth, "/api/gm/reports", "gm_reports", { order: "due_on, created_at" });

  app.get("/api/gm/summary", requireAuth, wrap(async (req, res) => {
    const today = todayIso(), soon = addMonths(today, 1);
    const fy = fiscalYear(0);
    const programs = (await pool.query("SELECT * FROM gm_programs WHERE archived_at IS NULL ORDER BY created_at DESC")).rows;
    const apps = (await pool.query("SELECT a.id, a.program_id, a.org_name, a.status, a.amount_requested, a.amount_awarded, a.source, a.created_at, a.decided_at FROM gm_applications a WHERE a.archived_at IS NULL")).rows;
    const pays = (await pool.query("SELECT p.*, a.org_name, a.program_id FROM gm_payments p JOIN gm_applications a ON a.id = p.application_id WHERE a.archived_at IS NULL")).rows;
    const reps = (await pool.query("SELECT r.*, a.org_name FROM gm_reports r JOIN gm_applications a ON a.id = r.application_id WHERE a.archived_at IS NULL AND a.status = 'approved'")).rows;
    const reviewCounts = Object.fromEntries((await pool.query("SELECT application_id, count(*)::int AS n FROM gm_reviews WHERE NOT conflict GROUP BY application_id")).rows.map((r) => [r.application_id, r.n]));
    const byProgram = programs.map((p) => {
      const mine = apps.filter((a) => a.program_id === p.id);
      const committed = mine.filter((a) => a.status === "approved").reduce((s, a) => s + (Number(a.amount_awarded) || 0), 0);
      const paid = pays.filter((x) => x.program_id === p.id && x.paid_on).reduce((s, x) => s + (Number(x.amount) || 0), 0);
      return { id: p.id, name: p.name, slug: p.slug, status: p.status, acceptsOnline: !!p.accepts_online, closesOn: p.closes_on, budget: Number(p.budget) || 0, committed, paid,
        remaining: (Number(p.budget) || 0) - committed, applications: mine.length, pending: mine.filter((a) => ["received", "screening", "in-review"].includes(a.status)).length };
    });
    const pending = apps.filter((a) => ["received", "screening", "in-review"].includes(a.status));
    res.json({
      fiscalYear: fy.label,
      totals: {
        openPrograms: programs.filter((p) => p.status === "open").length,
        pending: pending.length,
        newOnline: apps.filter((a) => a.source === "online" && a.status === "received").length,
        awardedThisYear: apps.filter((a) => a.status === "approved" && inRange((a.decided_at || "").slice(0, 10), fy)).reduce((s, a) => s + (Number(a.amount_awarded) || 0), 0),
        paidThisYear: pays.filter((x) => inRange(x.paid_on, fy)).reduce((s, x) => s + (Number(x.amount) || 0), 0),
        owed: pays.filter((x) => !x.paid_on).reduce((s, x) => s + (Number(x.amount) || 0), 0),
        activeGrants: apps.filter((a) => a.status === "approved").length,
      },
      programs: byProgram,
      needsReview: pending.filter((a) => !reviewCounts[a.id]).map((a) => ({ id: a.id, orgName: a.org_name, received: (a.created_at || "").slice(0, 10), amountRequested: Number(a.amount_requested) || 0 })),
      paymentsDue: pays.filter((x) => !x.paid_on && x.due_on && x.due_on <= soon).sort((x, y) => x.due_on.localeCompare(y.due_on)).map((x) => ({ id: x.id, applicationId: x.application_id, orgName: x.org_name, dueOn: x.due_on, amount: Number(x.amount) || 0, overdue: x.due_on < today, condition: x.condition })),
      reportsDue: reps.filter((r) => !r.received_on && r.due_on && r.due_on <= soon).sort((x, y) => x.due_on.localeCompare(y.due_on)).map((r) => ({ id: r.id, applicationId: r.application_id, orgName: r.org_name, kind: r.kind, dueOn: r.due_on, overdue: r.due_on < today })),
    });
  }));

  // Award / decline letter
  app.get("/letter/grant/:id", requireAuth, async (req, res) => {
    const a = (await pool.query("SELECT * FROM gm_applications WHERE id = $1", [req.params.id])).rows[0];
    if (!a) return res.status(404).send("Application not found.");
    const p = a.program_id ? (await pool.query("SELECT * FROM gm_programs WHERE id = $1", [a.program_id])).rows[0] : null;
    const kind = req.query.kind === "decline" || a.status === "declined" ? (req.query.kind === "award" ? "award" : "decline") : "award";
    const pays = (await pool.query("SELECT * FROM gm_payments WHERE application_id = $1 ORDER BY due_on", [a.id])).rows;
    const reps = (await pool.query("SELECT * FROM gm_reports WHERE application_id = $1 ORDER BY due_on", [a.id])).rows;
    const g = cfg("grantmaking");
    const conditions = Array.isArray(g.conditions) && g.conditions.length ? g.conditions : DEFAULT_CONDITIONS;
    const dear = a.contact_name ? `Dear ${esc(a.contact_name)},` : `Dear ${esc(a.org_name)} team,`;
    const today = longDate(todayIso());
    const programName = p ? p.name : "our grant program";
    let body;
    if (kind === "award") {
      body = `<div class="page">${letterhead()}<p contenteditable="true">${esc(today)}</p>
<p contenteditable="true">${esc(a.contact_name || "")}${a.contact_name ? "<br>" : ""}${esc(a.org_name)}</p>
<h1 contenteditable="true">Grant award${a.project_title ? ": " + esc(a.project_title) : ""}</h1>
<p contenteditable="true">${dear}</p>
<p contenteditable="true">We are pleased to tell you that ${esc((ORG.org || {}).name || "we")} has approved a grant of <strong>${esc(money(a.amount_awarded))}</strong> to ${esc(a.org_name)} through ${esc(programName)}${a.project_title ? ", for " + esc(a.project_title) : ""}. The grant period runs from ${esc(longDate(a.award_start))} to ${esc(longDate(a.award_end))}.</p>
${a.decision_notes ? `<p contenteditable="true">${esc(a.decision_notes)}</p>` : ""}
<h2>Payments</h2>${pays.length ? `<table><thead><tr><th>Date</th><th>Amount</th><th>Condition</th></tr></thead><tbody>${pays.map((x) => `<tr><td>${esc(longDate(x.due_on))}</td><td>${esc(money(x.amount))}</td><td contenteditable="true">${esc(x.condition || "")}</td></tr>`).join("")}</tbody></table>` : "<p>Paid in one installment on signing.</p>"}
<h2>Reports</h2>${reps.length ? `<ul>${reps.map((r) => `<li contenteditable="true">${esc(r.kind === "interim" ? "Interim report" : r.kind === "final" ? "Final report" : "Report")} due ${esc(longDate(r.due_on))}</li>`).join("")}</ul>` : "<p contenteditable=\"true\">A short final report at the end of the grant period.</p>"}
<h2>Conditions</h2><ul>${conditions.map((c) => `<li contenteditable="true">${esc(c)}</li>`).join("")}</ul>
<p contenteditable="true">To accept, sign below and return a copy. Payments begin once we receive it.</p>
${signature()}
<div class="sign"><div>For ${esc(a.org_name)}: signature, name, title, date</div><div>For ${esc((ORG.org || {}).name || "")}: signature, date</div></div></div>`;
    } else {
      body = `<div class="page">${letterhead()}<p contenteditable="true">${esc(today)}</p>
<p contenteditable="true">${esc(a.contact_name || "")}${a.contact_name ? "<br>" : ""}${esc(a.org_name)}</p>
<p contenteditable="true">${dear}</p>
<p contenteditable="true">Thank you for applying to ${esc(programName)}${a.project_title ? " for " + esc(a.project_title) : ""}. We received more strong requests than we can fund, and after careful review we are not able to make a grant this cycle.</p>
<p contenteditable="true">This decision is not a judgment of the value of your work. ${a.decision_notes ? esc(a.decision_notes) : "We'd welcome hearing from you about future cycles."}</p>
${signature()}</div>`;
    }
    res.set("Content-Type", "text/html; charset=utf-8").send(letterPage({
      title: (kind === "award" ? "Grant award, " : "Grant decision, ") + a.org_name,
      toolbar: `<span><a href="/letter/grant/${encodeURIComponent(a.id)}?kind=award">Award letter</a> <a href="/letter/grant/${encodeURIComponent(a.id)}?kind=decline">Decline letter</a></span>`,
      note: "Click any text to edit it before printing. Nothing here is saved. Standard conditions live in org.config.json (grantmaking.conditions); have counsel review them once.",
      body,
    }));
  });

  // Grantee report form: one private link per report due (gm_reports.token).
  // The grantee writes what happened and can add a link to documents; the
  // report is marked received and the grant's checklist ticks itself.
  function reportPage(rep, app2, message) {
    const { navy, gold } = brand();
    const o = ORG.org || {};
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Grant report | ${esc(o.name || "")}</title><link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<style>:root{--navy:${navy};--gold:${gold}}*{box-sizing:border-box}body{margin:0;background:#F3F5F7;color:#23282D;font:16px/1.6 Inter,system-ui,sans-serif}
header{background:var(--navy);color:#fff;padding:18px 16px}header .in,main{max-width:720px;margin:0 auto}header b{font-family:"Playfair Display",Georgia,serif;font-size:20px}
main{background:#fff;margin:24px auto;padding:32px clamp(16px,5vw,44px);border-radius:12px}h1{font-family:"Playfair Display",Georgia,serif;color:var(--navy);margin:0 0 8px;font-size:26px}
form{display:grid;gap:14px;margin-top:18px}label{display:flex;flex-direction:column;gap:5px;font-weight:600;font-size:14px;color:#33404C}
input,textarea{font:inherit;font-weight:400;padding:10px 12px;border:1px solid #B8C1CA;border-radius:8px;width:100%}textarea{min-height:110px}
button{font:inherit;font-weight:700;padding:12px 18px;border-radius:8px;border:0;background:var(--navy);color:#fff;cursor:pointer;justify-self:start}
.msg{padding:14px 16px;border-radius:8px;background:#EEF6F0;color:#1E5631;font-weight:600}.muted{color:#55606B;font-size:14px}.pre{white-space:pre-wrap}</style></head>
<body><header><div class="in"><b>${esc(o.name || "")}</b></div></header><main>
${!rep ? "<h1>Link not found</h1><p>This link isn't valid. Reply to the email it came in and we'll send a new one.</p>" : `
<h1>${rep.kind === "final" ? "Final" : rep.kind === "interim" ? "Interim" : ""} grant report</h1>
<p class="muted">${esc(app2.org_name)}${app2.project_title ? " &middot; " + esc(app2.project_title) : ""}${rep.due_on ? " &middot; due " + esc(longDate(rep.due_on)) : ""}</p>
${message ? `<p class="msg">${esc(message)}</p>` : ""}
${rep.received_on ? `<p class="msg">Received ${esc(longDate(rep.received_on))}. Thank you.</p><p class="pre">${esc(rep.summary || "")}</p><p class="muted">Need to add something? Submit again below; it's added to what you sent.</p>` : ""}
<form method="post" action="/grant-report/${esc(rep.token)}">
<label>What have you done with the grant so far, and for whom?<textarea name="done" required maxlength="5000"></textarea></label>
<label>What's working, and what has been harder than expected?<textarea name="learned" maxlength="5000"></textarea></label>
<label>${rep.kind === "final" ? "What comes next for this work?" : "Anything that has changed in your plans, budget, or leadership?"}<textarea name="next" maxlength="5000"></textarea></label>
<label>Link to photos, numbers, or documents (optional)<input name="link" type="text" maxlength="500" placeholder="A shared folder or file link"></label>
<label>Your name<input name="name" required maxlength="160" value="${esc(app2.contact_name || "")}"></label>
<button type="submit">Submit report</button></form>`}
</main></body></html>`;
  }
  const reportHits = new Map();
  setInterval(() => reportHits.clear(), 3600000).unref();
  async function reportByToken(token) {
    const rep = /^[A-Za-z0-9_-]{16,80}$/.test(token) ? (await pool.query("SELECT * FROM gm_reports WHERE token = $1", [token])).rows[0] : null;
    const app2 = rep ? (await pool.query("SELECT * FROM gm_applications WHERE id = $1", [rep.application_id])).rows[0] : null;
    return rep && app2 ? { rep, app2 } : {};
  }
  app.get("/grant-report/:token", async (req, res) => {
    const { rep, app2 } = await reportByToken(String(req.params.token));
    res.status(rep ? 200 : 404).set("Content-Type", "text/html; charset=utf-8").set("Cache-Control", "no-store").send(reportPage(rep, app2, req.query.sent ? "Your report was received. Thank you." : ""));
  });
  app.post("/grant-report/:token", require("express").urlencoded({ extended: false, limit: "100kb" }), async (req, res) => {
    const n = (reportHits.get(req.ip) || 0) + 1; reportHits.set(req.ip, n);
    if (n > 20) return res.status(429).send("Too many attempts. Try again in an hour.");
    const { rep, app2 } = await reportByToken(String(req.params.token));
    if (!rep) return res.status(404).set("Content-Type", "text/html; charset=utf-8").send(reportPage(null));
    const b = req.body || {};
    const done = String(b.done || "").trim().slice(0, 5000), name = String(b.name || "").trim().slice(0, 160);
    if (!done || !name) return res.status(400).set("Content-Type", "text/html; charset=utf-8").send(reportPage(rep, app2, "Please describe what you've done and add your name."));
    const parts = [done, String(b.learned || "").trim() && "What's working and what's hard: " + String(b.learned).trim().slice(0, 5000), String(b.next || "").trim() && (rep.kind === "final" ? "What comes next: " : "Changes: ") + String(b.next).trim().slice(0, 5000)].filter(Boolean);
    const text = (rep.summary ? rep.summary + "\n\n---\n" : "") + `Submitted ${todayIso()} by ${name}:\n` + parts.join("\n\n");
    await pool.query("UPDATE gm_reports SET received_on = COALESCE(NULLIF(received_on, ''), $1), summary = $2, submitted_by = $3, link = COALESCE(NULLIF($4, ''), link) WHERE id = $5", [todayIso(), text.slice(0, 20000), name, String(b.link || "").trim().slice(0, 500), rep.id]);
    res.redirect(303, `/grant-report/${rep.token}?sent=1`);
  });

  // Public application form
  app.get("/apply/:slug", async (req, res) => {
    const p = (await pool.query("SELECT * FROM gm_programs WHERE slug = $1 AND archived_at IS NULL", [String(req.params.slug)])).rows[0];
    res.status(p ? 200 : 404).set("Content-Type", "text/html; charset=utf-8").send(applyPage(p, req.query.sent ? "Thank you. Your application was received; we'll be in touch by email." : ""));
  });
  app.post("/api/public/apply/:slug", require("express").urlencoded({ extended: false, limit: "200kb" }), async (req, res) => {
    const wantsJson = (req.get("accept") || "").includes("application/json");
    const fail = (code, msg) => wantsJson ? res.status(code).json({ error: msg }) : res.status(code).set("Content-Type", "text/html; charset=utf-8").send(applyPage(null, msg));
    try {
      const p = (await pool.query("SELECT * FROM gm_programs WHERE slug = $1 AND archived_at IS NULL", [String(req.params.slug)])).rows[0];
      if (!programIsOpen(p)) return fail(400, "This program isn't accepting applications right now.");
      const b = req.body || {};
      if (b.website2) return wantsJson ? res.json({ ok: true }) : res.redirect(303, `/apply/${p.slug}?sent=1`); // bot
      if (applyLimited(req.ip)) return fail(429, "Too many submissions from this connection. Please try again in an hour.");
      if (!String(b.orgName || "").trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(b.contactEmail || ""))) return fail(400, "Please include the organization name and a valid email.");
      const answers = {};
      for (const q of parseJson(p.questions, [])) answers[q.key] = String(b["q_" + q.key] || (b.answers || {})[q.key] || "").slice(0, 5000);
      await insertRow(pool, "gm_applications", {
        programId: p.id, orgName: b.orgName, ein: b.ein, contactName: b.contactName, contactEmail: b.contactEmail, contactPhone: b.contactPhone, website: b.website,
        annualBudget: b.annualBudget, amountRequested: b.amountRequested, projectTitle: b.projectTitle, summary: b.summary, answers, status: "received", source: "online",
      });
      return wantsJson ? res.status(201).json({ ok: true }) : res.redirect(303, `/apply/${p.slug}?sent=1`);
    } catch (err) {
      console.error("public apply", err);
      return fail(500, "Something went wrong. Please try again.");
    }
  });

  // ================= Fundraising =================
  crud(app, pool, requireAuth, "/api/fr/campaigns", "fr_campaigns", { order: "created_at DESC" });
  crud(app, pool, requireAuth, "/api/fr/pledges", "fr_pledges", { order: "pledged_on DESC, created_at DESC" });
  crud(app, pool, requireAuth, "/api/fr/touches", "fr_touches", { order: "on_date DESC, created_at DESC" });
  // gifts: create may name a new donor inline ({donorName, donorEmail} instead of donorId)
  async function resolveDonor(b) {
    if (b.donorId) return b;
    const name = String(b.donorName || "").trim(), email = String(b.donorEmail || "").trim().toLowerCase();
    if (!name && !email) return b;
    let d = email ? (await pool.query("SELECT id FROM fr_donors WHERE lower(email) = $1 AND archived_at IS NULL LIMIT 1", [email])).rows[0] : null;
    if (!d && name) d = (await pool.query("SELECT id FROM fr_donors WHERE lower(name) = lower($1) AND archived_at IS NULL LIMIT 1", [name])).rows[0];
    if (!d) d = await insertRow(pool, "fr_donors", { name: name || email, email, kind: b.donorKind || "individual" });
    return Object.assign({}, b, { donorId: d.id });
  }
  crud(app, pool, requireAuth, "/api/fr/gifts", "fr_gifts", { order: "received_on DESC, created_at DESC", beforeCreate: async (b) => resolveDonor(Object.assign({ receivedOn: todayIso() }, b)) });
  app.post("/api/fr/gifts/ack", requireAuth, wrap(async (req, res) => {
    const ids = (Array.isArray((req.body || {}).ids) ? req.body.ids : []).map(String).slice(0, 2000);
    const on = coerce("d", (req.body || {}).on) || todayIso();
    const r = ids.length ? await pool.query("UPDATE fr_gifts SET ack_sent_on = $1 WHERE id = ANY($2) AND ack_sent_on = ''", [on, ids]) : { rowCount: 0 };
    res.json({ ok: true, marked: r.rowCount });
  }));

  // Donors with giving totals; one donor's full profile.
  const fyNow = () => fiscalYear(0), fyLast = () => fiscalYear(-1);
  async function donorTotals() {
    const fy = fyNow(), ly = fyLast();
    const r = await pool.query(`SELECT donor_id, sum(amount)::float AS lifetime, count(*)::int AS gifts, max(received_on) AS last_gift, min(received_on) AS first_gift,
      sum(CASE WHEN received_on >= $1 AND received_on < $2 THEN amount ELSE 0 END)::float AS this_year,
      sum(CASE WHEN received_on >= $3 AND received_on < $4 THEN amount ELSE 0 END)::float AS last_year,
      max(amount)::float AS largest FROM fr_gifts WHERE archived_at IS NULL GROUP BY donor_id`, [fy.from, fy.to, ly.from, ly.to]);
    return Object.fromEntries(r.rows.map((x) => [x.donor_id, x]));
  }
  app.get("/api/fr/donors", requireAuth, wrap(async (req, res) => {
    const donors = (await pool.query("SELECT * FROM fr_donors WHERE archived_at IS NULL ORDER BY lower(name)")).rows;
    const tot = await donorTotals();
    const next = Object.fromEntries((await pool.query("SELECT DISTINCT ON (donor_id) donor_id, next_step, next_on FROM fr_touches WHERE NOT done AND next_step <> '' ORDER BY donor_id, next_on")).rows.map((x) => [x.donor_id, x]));
    res.json({ items: donors.map((d) => {
      const t = tot[d.id] || {};
      return Object.assign(toApi("fr_donors", d), { lifetime: t.lifetime || 0, gifts: t.gifts || 0, lastGift: t.last_gift || "", firstGift: t.first_gift || "", thisYear: t.this_year || 0, lastYear: t.last_year || 0, largest: t.largest || 0,
        nextStep: (next[d.id] || {}).next_step || "", nextOn: (next[d.id] || {}).next_on || "" });
    }) });
  }));
  app.post("/api/fr/donors", requireAuth, wrap(async (req, res) => res.status(201).json({ item: toApi("fr_donors", await insertRow(pool, "fr_donors", req.body || {})) })));
  app.patch("/api/fr/donors/:id", requireAuth, wrap(async (req, res) => {
    const row = await updateRow(pool, "fr_donors", req.params.id, req.body || {});
    if (!row) return res.status(404).json({ error: "not found" });
    res.json({ item: toApi("fr_donors", row) });
  }));
  app.delete("/api/fr/donors/:id", requireAuth, wrap(async (req, res) => {
    await pool.query("UPDATE fr_donors SET archived_at = $1 WHERE id = $2", [nowIso(), req.params.id]);
    res.json({ ok: true });
  }));
  app.get("/api/fr/donors/:id", requireAuth, wrap(async (req, res) => {
    const d = (await pool.query("SELECT * FROM fr_donors WHERE id = $1", [req.params.id])).rows[0];
    if (!d) return res.status(404).json({ error: "not found" });
    const gifts = (await pool.query("SELECT g.*, c.name AS campaign_name FROM fr_gifts g LEFT JOIN fr_campaigns c ON c.id = g.campaign_id WHERE g.donor_id = $1 AND g.archived_at IS NULL ORDER BY g.received_on DESC", [d.id])).rows;
    const pledges = (await pool.query("SELECT * FROM fr_pledges WHERE donor_id = $1 AND archived_at IS NULL ORDER BY pledged_on DESC", [d.id])).rows;
    const touches = (await pool.query("SELECT * FROM fr_touches WHERE donor_id = $1 ORDER BY on_date DESC, created_at DESC", [d.id])).rows;
    const t = (await donorTotals())[d.id] || {};
    const paidByPledge = {};
    gifts.forEach((g) => { if (g.pledge_id) paidByPledge[g.pledge_id] = (paidByPledge[g.pledge_id] || 0) + (Number(g.amount) || 0); });
    res.json({
      item: toApi("fr_donors", d),
      totals: { lifetime: t.lifetime || 0, gifts: t.gifts || 0, thisYear: t.this_year || 0, lastYear: t.last_year || 0, largest: t.largest || 0, firstGift: t.first_gift || "", lastGift: t.last_gift || "" },
      gifts: gifts.map((g) => Object.assign(toApi("fr_gifts", g), { campaignName: g.campaign_name || "" })),
      pledges: pledges.map((p) => Object.assign(toApi("fr_pledges", p), { received: paidByPledge[p.id] || 0, balance: Math.max(0, (Number(p.total) || 0) - (paidByPledge[p.id] || 0)) })),
      touches: touches.map((x) => toApi("fr_touches", x)),
    });
  }));

  app.get("/api/fr/summary", requireAuth, wrap(async (req, res) => {
    const today = todayIso(), soon = addMonths(today, 1);
    const fy = fyNow(), ly = fyLast();
    // the same stretch of last year, for a fair year-to-date comparison
    const sameDayLastYear = addMonths(today, -12);
    const gifts = (await pool.query("SELECT g.id, g.donor_id, g.campaign_id, g.pledge_id, g.amount::float AS amount, g.received_on, g.ack_sent_on, g.method, d.name AS donor_name FROM fr_gifts g JOIN fr_donors d ON d.id = g.donor_id WHERE g.archived_at IS NULL")).rows;
    const campaigns = (await pool.query("SELECT * FROM fr_campaigns WHERE archived_at IS NULL ORDER BY created_at DESC")).rows;
    const pledges = (await pool.query("SELECT p.*, d.name AS donor_name FROM fr_pledges p JOIN fr_donors d ON d.id = p.donor_id WHERE p.archived_at IS NULL AND p.status = 'open'")).rows;
    const touches = (await pool.query("SELECT t.*, d.name AS donor_name FROM fr_touches t JOIN fr_donors d ON d.id = t.donor_id WHERE NOT t.done AND t.next_step <> '' AND t.next_on <> '' AND t.next_on <= $1 ORDER BY t.next_on", [soon])).rows;
    const donorCount = (await pool.query("SELECT count(*)::int AS n FROM fr_donors WHERE archived_at IS NULL")).rows[0].n;
    const ytd = gifts.filter((g) => inRange(g.received_on, fy));
    const lytd = gifts.filter((g) => g.received_on >= ly.from && g.received_on <= sameDayLastYear);
    const sum = (list) => Math.round(list.reduce((s, g) => s + (g.amount || 0), 0) * 100) / 100;
    const donorsIn = (list) => new Set(list.map((g) => g.donor_id));
    const thisDonors = donorsIn(ytd), lastDonors = donorsIn(gifts.filter((g) => inRange(g.received_on, ly)));
    const firstGift = {};
    gifts.forEach((g) => { if (!firstGift[g.donor_id] || g.received_on < firstGift[g.donor_id]) firstGift[g.donor_id] = g.received_on; });
    const retained = [...lastDonors].filter((id) => thisDonors.has(id)).length;
    // LYBUNT: gave last year but not (yet) this year
    const lastYearTotals = {};
    gifts.filter((g) => inRange(g.received_on, ly)).forEach((g) => { lastYearTotals[g.donor_id] = lastYearTotals[g.donor_id] || { name: g.donor_name, total: 0 }; lastYearTotals[g.donor_id].total += g.amount || 0; });
    const lybunt = Object.entries(lastYearTotals).filter(([id]) => !thisDonors.has(id)).map(([id, v]) => ({ donorId: id, name: v.name, lastYear: Math.round(v.total * 100) / 100 })).sort((a, b) => b.lastYear - a.lastYear);
    const paidByPledge = {};
    gifts.forEach((g) => { if (g.pledge_id) paidByPledge[g.pledge_id] = (paidByPledge[g.pledge_id] || 0) + g.amount; });
    const pledgeRows = pledges.map((p) => {
      const total = Number(p.total) || 0, received = paidByPledge[p.id] || 0;
      const n = Math.max(1, Number(p.installments) || 1), step = { monthly: 1, quarterly: 3, annual: 12 }[p.frequency] || 0;
      const each = total / n;
      const paidCount = each > 0 ? Math.floor((received + 0.005) / each) : n;
      const nextDue = paidCount >= n ? "" : (p.first_due ? addMonths(p.first_due, step * paidCount) : "");
      return { id: p.id, donorId: p.donor_id, donorName: p.donor_name, total, received, balance: Math.max(0, total - received), nextDue, nextAmount: paidCount >= n ? 0 : Math.min(each, total - received), overdue: !!nextDue && nextDue < today };
    }).filter((p) => p.balance > 0.004);
    res.json({
      fiscalYear: fy.label, lastFiscalYear: ly.label,
      totals: {
        raised: sum(ytd), raisedLastYearToDate: sum(lytd), raisedLastYear: sum(gifts.filter((g) => inRange(g.received_on, ly))),
        gifts: ytd.length, donors: thisDonors.size, donorRecords: donorCount,
        newDonors: [...thisDonors].filter((id) => inRange(firstGift[id], fy)).length,
        averageGift: ytd.length ? Math.round(sum(ytd) / ytd.length) : 0,
        retention: lastDonors.size ? Math.round((retained / lastDonors.size) * 100) : null, retainedDonors: retained, lastYearDonors: lastDonors.size,
        pledgeBalance: Math.round(pledgeRows.reduce((s, p) => s + p.balance, 0) * 100) / 100,
      },
      campaigns: campaigns.map((c) => {
        const mine = gifts.filter((g) => g.campaign_id === c.id);
        const pledged = pledges.filter((p) => p.campaign_id === c.id).reduce((s, p) => s + Math.max(0, (Number(p.total) || 0) - (paidByPledge[p.id] || 0)), 0);
        return { id: c.id, name: c.name, goal: Number(c.goal) || 0, fundType: c.fund_type, endsOn: c.ends_on, raised: sum(mine), pledged: Math.round(pledged * 100) / 100, donors: donorsIn(mine).size };
      }),
      toThank: gifts.filter((g) => !g.ack_sent_on).sort((a, b) => (a.received_on || "").localeCompare(b.received_on || "")).map((g) => ({ id: g.id, donorId: g.donor_id, donorName: g.donor_name, amount: g.amount, receivedOn: g.received_on, daysWaiting: g.received_on ? Math.max(0, Math.round((Date.parse(today) - Date.parse(g.received_on)) / 86400000)) : null })),
      pledgesDue: pledgeRows.filter((p) => p.nextDue && p.nextDue <= soon).sort((a, b) => a.nextDue.localeCompare(b.nextDue)),
      followUps: touches.map((t) => ({ id: t.id, donorId: t.donor_id, donorName: t.donor_name, nextStep: t.next_step, nextOn: t.next_on, overdue: t.next_on < today })),
      lybunt: lybunt.slice(0, 50),
    });
  }));

  // Thank-you letters with receipt wording. ?gift=<id>, ?ids=a,b, or ?pending=1 (all not yet thanked)
  app.get("/letter/receipt", requireAuth, async (req, res) => {
    let rows;
    const base = "SELECT g.*, d.name AS donor_name, d.salutation, d.address, d.city, d.state, d.zip, d.kind AS donor_kind, c.name AS campaign_name FROM fr_gifts g JOIN fr_donors d ON d.id = g.donor_id LEFT JOIN fr_campaigns c ON c.id = g.campaign_id WHERE g.archived_at IS NULL";
    if (req.query.pending) rows = (await pool.query(base + " AND g.ack_sent_on = '' ORDER BY g.received_on", [])).rows;
    else {
      const ids = String(req.query.ids || req.query.gift || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 500);
      rows = ids.length ? (await pool.query(base + " AND g.id = ANY($1) ORDER BY g.received_on", [ids])).rows : [];
    }
    const f = cfg("fundraising");
    const o = ORG.org || {};
    const ein = f.ein || "";
    const charity = ein && f.taxStatus !== "none";
    const pages = rows.map((g) => {
      const amount = Number(g.amount) || 0, gsv = Number(g.goods_services_value) || 0;
      const inKind = g.method === "in-kind";
      const dear = g.salutation || `Dear ${g.donor_name},`;
      const addr = [g.address, [g.city, g.state].filter(Boolean).join(", ") + (g.zip ? " " + g.zip : "")].filter((x) => String(x || "").trim()).map(esc).join("<br>");
      const receipt = charity ? `<div class="receipt" contenteditable="true"><strong>Gift receipt #${esc(g.receipt_no)}</strong><br>
${esc(o.legalName || o.name || "")} is a tax-exempt organization under section 501(c)(3) of the Internal Revenue Code. EIN ${esc(ein)}.<br>
Date received: ${esc(longDate(g.received_on))}. ${inKind ? `Description of gift: ${esc(g.in_kind_description || "in-kind gift")} (no value is stated; the donor determines the value).` : `Amount: ${esc(money(amount))}.`}<br>
${gsv > 0 ? `In return for this gift you received goods or services with an estimated value of ${esc(money(gsv))}. The deductible amount is ${esc(money(Math.max(0, amount - gsv)))}.` : "No goods or services were provided in exchange for this gift."}${g.method === "daf" ? "<br>This grant was recommended from a donor-advised fund; the fund's sponsor, not the advisor, receives the tax receipt." : ""}
<br>Please keep this letter for your tax records.</div>` : `<p class="note warn">No tax receipt wording: set fundraising.ein in org.config.json once the organization is a registered charity.</p>`;
      return `<div class="page">${letterhead()}<p contenteditable="true">${esc(longDate(todayIso()))}</p>
<p contenteditable="true">${esc(g.donor_name)}${addr ? "<br>" + addr : ""}</p>
<p contenteditable="true">${esc(dear)}</p>
<p contenteditable="true">Thank you for your ${inKind ? "gift of " + esc(g.in_kind_description || "goods") : "gift of " + esc(money(amount))}${g.campaign_name ? " to " + esc(g.campaign_name) : ""}, received ${esc(longDate(g.received_on))}. ${esc(f.thankYouLine || "Your support makes this work possible, and we're grateful to have you with us.")}</p>
${g.restriction ? `<p contenteditable="true">As you asked, your gift is designated for ${esc(g.restriction)}.</p>` : ""}
${signature()}${receipt}</div>`;
    });
    const ids = rows.map((g) => g.id);
    res.set("Content-Type", "text/html; charset=utf-8").send(letterPage({
      title: rows.length === 1 ? "Thank-you letter, " + rows[0].donor_name : `Thank-you letters (${rows.length})`,
      toolbar: ids.length ? `<span><button id="mark">Mark ${ids.length === 1 ? "this gift" : "these " + ids.length + " gifts"} as thanked</button> <span id="mark-msg"></span></span>` : "",
      note: "Click any text to edit it before printing. Nothing here is saved. Receipt wording follows IRS rules for written acknowledgments (Publication 1771); the EIN and thank-you line live in org.config.json (fundraising).",
      body: (pages.join("") || `<div class="page">${letterhead()}<p>No gifts to thank.</p></div>`) +
        (ids.length ? `<script>document.getElementById("mark").onclick=function(){fetch("/api/fr/gifts/ack",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids:${JSON.stringify(ids)}})}).then(function(r){return r.json()}).then(function(d){document.getElementById("mark-msg").textContent=d.ok?(d.marked+" marked as thanked."):(d.error||"Couldn't save.")})}</script>` : ""),
    }));
  });

  // CSV export and import
  app.get("/api/fr/export/gifts.csv", requireAuth, wrap(async (req, res) => {
    const r = await pool.query("SELECT g.*, d.name AS donor_name, d.email AS donor_email, c.name AS campaign_name FROM fr_gifts g JOIN fr_donors d ON d.id = g.donor_id LEFT JOIN fr_campaigns c ON c.id = g.campaign_id WHERE g.archived_at IS NULL ORDER BY g.received_on");
    res.set("Content-Type", "text/csv; charset=utf-8").set("Content-Disposition", 'attachment; filename="gifts.csv"').send(toCsv(r.rows, [
      ["Receipt", "receipt_no"], ["Date", "received_on"], ["Donor", "donor_name"], ["Email", "donor_email"], ["Amount", (x) => Number(x.amount) || 0], ["Method", "method"], ["Reference", "reference"],
      ["Campaign", "campaign_name"], ["Restriction", "restriction"], ["Goods/services value", (x) => Number(x.goods_services_value) || 0], ["Thanked on", "ack_sent_on"], ["Notes", "notes"]]));
  }));
  app.get("/api/fr/export/donors.csv", requireAuth, wrap(async (req, res) => {
    const donors = (await pool.query("SELECT * FROM fr_donors WHERE archived_at IS NULL ORDER BY lower(name)")).rows;
    const tot = await donorTotals();
    res.set("Content-Type", "text/csv; charset=utf-8").set("Content-Disposition", 'attachment; filename="donors.csv"').send(toCsv(donors, [
      ["Name", "name"], ["Type", "kind"], ["Email", "email"], ["Phone", "phone"], ["Address", "address"], ["City", "city"], ["State", "state"], ["ZIP", "zip"], ["Stage", "stage"], ["Owner", "owner"],
      ["Lifetime giving", (d) => (tot[d.id] || {}).lifetime || 0], ["This year", (d) => (tot[d.id] || {}).this_year || 0], ["Last gift", (d) => (tot[d.id] || {}).last_gift || ""], ["Do not solicit", (d) => d.no_solicit ? "yes" : ""]]));
  }));
  // Gifts CSV with a header row. Recognized columns (any order, case-insensitive):
  // name/donor, email, amount, date, method, campaign, reference, restriction, type, address, city, state, zip, notes
  app.post("/api/fr/import", requireAuth, require("express").text({ type: ["text/csv", "text/plain"], limit: "5mb" }), wrap(async (req, res) => {
    const text = typeof req.body === "string" ? req.body : String((req.body || {}).csv || "");
    const rows = parseCsv(text);
    if (rows.length < 2) return res.status(400).json({ error: "Paste a CSV with a header row and at least one gift." });
    const head = rows[0].map((h) => String(h).trim().toLowerCase());
    const col = (...names) => head.findIndex((h) => names.includes(h));
    const ix = { name: col("name", "donor", "donor name", "full name"), email: col("email", "donor email", "e-mail"), amount: col("amount", "gift amount", "total"), date: col("date", "gift date", "received", "received on"),
      method: col("method", "payment method", "payment type"), campaign: col("campaign", "fund", "appeal"), reference: col("reference", "check number", "transaction id"), restriction: col("restriction", "designation"),
      kind: col("type", "donor type", "kind"), address: col("address", "street"), city: col("city"), state: col("state"), zip: col("zip", "postal code", "zip code"), notes: col("notes", "note", "memo") };
    if (ix.amount < 0 || (ix.name < 0 && ix.email < 0)) return res.status(400).json({ error: "The CSV needs an amount column and a name or email column." });
    const campaignsByName = Object.fromEntries((await pool.query("SELECT id, lower(name) AS n FROM fr_campaigns WHERE archived_at IS NULL")).rows.map((c) => [c.n, c.id]));
    const METHODS = ["check", "cash", "card", "ach", "wire", "stock", "daf", "in-kind", "other"];
    let created = 0, newDonors = 0, newCampaigns = 0; const errors = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i], v = (k) => (ix[k] >= 0 ? String(r[ix[k]] || "").trim() : "");
      const amount = coerce("n", v("amount"));
      if (!(amount > 0)) { errors.push(`Row ${i + 1}: no amount`); continue; }
      const name = v("name"), email = v("email").toLowerCase();
      if (!name && !email) { errors.push(`Row ${i + 1}: no name or email`); continue; }
      let d = email ? (await pool.query("SELECT id FROM fr_donors WHERE lower(email) = $1 AND archived_at IS NULL LIMIT 1", [email])).rows[0] : null;
      if (!d && name) d = (await pool.query("SELECT id FROM fr_donors WHERE lower(name) = lower($1) AND archived_at IS NULL LIMIT 1", [name])).rows[0];
      if (!d) { d = await insertRow(pool, "fr_donors", { name: name || email, email, kind: v("kind").toLowerCase() || "individual", address: v("address"), city: v("city"), state: v("state"), zip: v("zip") }); newDonors++; }
      let campaignId = null;
      const cn = v("campaign");
      if (cn) {
        campaignId = campaignsByName[cn.toLowerCase()];
        if (!campaignId) { const c = await insertRow(pool, "fr_campaigns", { name: cn }); campaignId = c.id; campaignsByName[cn.toLowerCase()] = c.id; newCampaigns++; }
      }
      const m = v("method").toLowerCase().replace(/credit card|visa|mastercard|amex/, "card").replace(/donor[- ]advised.*/, "daf");
      await insertRow(pool, "fr_gifts", { donorId: d.id, campaignId, amount, receivedOn: parseLooseDate(v("date")) || todayIso(), method: METHODS.includes(m) ? m : (m ? "other" : "check"),
        reference: v("reference"), restriction: v("restriction"), notes: v("notes"), ackSentOn: req.query.thanked ? todayIso() : "" });
      created++;
    }
    res.json({ ok: true, created, newDonors, newCampaigns, errors: errors.slice(0, 50) });
  }));
}

const DEFAULT_CRITERIA = [
  { key: "need", label: "Need and who benefits" },
  { key: "plan", label: "Strength of the plan" },
  { key: "capacity", label: "Capacity to deliver" },
  { key: "fit", label: "Fit with our priorities" },
];
const DEFAULT_CONDITIONS = [
  "Funds will be used only for the purpose described above, within the grant period. Any change needs our written approval first.",
  "Unspent funds at the end of the grant period will be returned unless we agree otherwise in writing.",
  "Your organization is, and will remain during the grant, a tax-exempt public charity or otherwise eligible to receive this grant.",
  "No part of the grant will be used for lobbying, political campaigns, or to benefit any individual's private interest.",
  "You will keep records of how the grant was spent for at least three years and share them if asked.",
  "You'll tell us promptly about any change in leadership, tax status, or anything that affects the work.",
];
function normalizeList(v, fallback) {
  let list = v;
  if (typeof v === "string") {
    const parsed = parseJson(v, null);
    list = Array.isArray(parsed) ? parsed : v.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }
  if (!Array.isArray(list) || !list.length) return fallback;
  const seen = {};
  return list.slice(0, 20).map((x) => {
    const label = typeof x === "string" ? x : String((x && x.label) || "");
    let key = typeof x === "object" && x && x.key ? slugify(x.key) : slugify(label).slice(0, 30);
    while (seen[key]) key += "-2";
    seen[key] = 1;
    return { key, label: label.slice(0, 300) };
  }).filter((x) => x.label);
}
function monthsBetween(a, b) {
  if (!isDate(a) || !isDate(b)) return 12;
  const [y1, m1] = a.split("-").map(Number), [y2, m2] = b.split("-").map(Number);
  return Math.max(1, (y2 - y1) * 12 + (m2 - m1));
}
async function reviewerName(pool, session) {
  if (!session || !session.userId) return (ORG.org && ORG.org.leader && ORG.org.leader.name) || "Owner";
  const u = (await pool.query("SELECT name, email FROM app_users WHERE id = $1", [session.userId])).rows[0];
  return u ? (u.name || u.email) : "User " + session.userId;
}

module.exports = { mount, parseCsv, fiscalYear, normalizeList, addMonths,
  // shared with governance.js
  SPECS, HAS_UPDATED, crud, insertRow, updateRow, toApi, coerce, parseJson, letterPage, letterhead, esc, money, longDate, isDate, todayIso, nowIso, newId, brand };
