"use strict";
// The funnel (website visits to revenue) and the monthly report.
//
//   GET /api/funnel?month=YYYY-MM   numbers for one month plus a six-month trend
//   GET /report/monthly?month=YYYY-MM   a printable one-page-per-section report
//                                       for the owner or the board
//
// Website visits and free-tool starts come from the website's cookie-free
// counter (page, action, and date only). Everything else comes from this
// app's own records. A step with no data shows a dash, not a zero.

const { ORG } = require("./accounts");

const STAGE_LABELS = { lead: "Lead", discovery: "Discovery call", assessment: "Diagnostic", engaged: "Engaged", graduated: "Graduated", referred: "Referred out", lost: "Lost" };
const CLOSED = { graduated: 1, referred: 1, lost: 1 };

function monthBounds(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(month || "");
  const now = new Date();
  const y = m ? Number(m[1]) : now.getUTCFullYear();
  const mo = m ? Number(m[2]) - 1 : now.getUTCMonth();
  const start = new Date(Date.UTC(y, mo, 1));
  const end = new Date(Date.UTC(y, mo + 1, 1));
  const key = `${y}-${String(mo + 1).padStart(2, "0")}`;
  const label = start.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return { key, label, from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}
function prevMonths(key, n) {
  const [y, m] = key.split("-").map(Number);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}
const inMonth = (iso, b) => !!iso && iso.slice(0, 10) >= b.from && iso.slice(0, 10) < b.to;
const money = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Leads also arrive by referral and email, so a step can be larger than the
// one before it; the share is only shown when it is a real narrowing.
const pct = (a, b) => (a != null && b && a <= b ? Math.round((100 * a) / b) + "%" : "—");

// The website's cookie-free counts (page, event, day), cached for ten minutes.
let pcCache = { at: 0, rows: null };
async function fetchPageCounts(url, secret) {
  if (!url || !secret) return null;
  if (pcCache.rows && Date.now() - pcCache.at < 10 * 60 * 1000) return pcCache.rows;
  try {
    const r = await fetch(url + "/api/admin/page-counts?days=400", { headers: { "X-Reminder-Secret": secret }, signal: AbortSignal.timeout(45000) });
    const d = await r.json();
    if (!r.ok || !d.rows) return null;
    pcCache = { at: Date.now(), rows: d.rows };
    return d.rows;
  } catch (e) { return null; }
}

// Last week's funnel for the Monday brief: the seven full days before today
// (America/New_York). Website steps are null when the website can't be read.
async function weekFunnel(pool, { url, secret, today } = {}) {
  const t = today || new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const from = new Date(Date.parse(t + "T12:00:00Z") - 7 * 864e5).toISOString().slice(0, 10);
  const b = { from, to: t };
  const inWeek = (iso) => !!iso && String(iso).slice(0, 10) >= b.from && String(iso).slice(0, 10) < b.to;
  const pc = await fetchPageCounts(url, secret);
  const sum = (ev) => (pc ? pc.filter((r) => r.day >= b.from && r.day < b.to && r.event === ev).reduce((n, r) => n + r.n, 0) : null);
  const q = async (sql) => (await pool.query(sql).catch(() => ({ rows: [] }))).rows;
  const prospects = await q("SELECT created_at FROM prospects");
  const encounters = await q("SELECT occurred_at, created_at FROM encounters WHERE archived_at IS NULL");
  const invoices = await q("SELECT offering, issued_date, created_at, paid_date, status, amount FROM invoices WHERE archived_at IS NULL");
  const diag = invoices.filter((i) => i.offering === "institutionalos-diagnostic" && inWeek(i.issued_date || i.created_at));
  return {
    from: b.from, to: b.to, websiteCounting: !!pc,
    visits: sum("view"), checkupsStarted: sum("tool_start"), checkupsDone: sum("tool_complete"),
    schedulingClicks: pc ? sum("schedule_click") + sum("schedule_inline_open") : null,
    leads: prospects.filter((p) => inWeek(p.created_at)).length,
    conversations: encounters.filter((e) => inWeek(e.occurred_at || e.created_at)).length,
    diagnosticsSold: diag.length, diagnosticRevenue: diag.reduce((n, i) => n + Number(i.amount || 0), 0),
    paid: invoices.filter((i) => i.status === "paid" && inWeek(i.paid_date)).reduce((n, i) => n + Number(i.amount || 0), 0)
  };
}

function mount(app, { pool, requireAuth, WEBSITE_API_URL, WEBSITE_ADMIN_SECRET }) {
  const pageCounts = () => fetchPageCounts(WEBSITE_API_URL, WEBSITE_ADMIN_SECRET);

  async function load() {
    const [pipeline, prospects, invoices, encounters, scorecard, rocks, issues, settings] = await Promise.all([
      pool.query("SELECT * FROM pipeline WHERE archived_at IS NULL"),
      pool.query("SELECT * FROM prospects"),
      pool.query("SELECT * FROM invoices WHERE archived_at IS NULL"),
      pool.query("SELECT * FROM encounters WHERE archived_at IS NULL"),
      pool.query("SELECT * FROM scorecard WHERE archived_at IS NULL"),
      pool.query("SELECT * FROM rocks WHERE archived_at IS NULL"),
      pool.query("SELECT * FROM issues WHERE archived_at IS NULL"),
      pool.query("SELECT key, value FROM app_settings WHERE key IN ('last_backup','last_retention')"),
    ]);
    return { pipeline: pipeline.rows, prospects: prospects.rows, invoices: invoices.rows, encounters: encounters.rows, scorecard: scorecard.rows, rocks: rocks.rows, issues: issues.rows,
      settings: Object.fromEntries(settings.rows.map((r) => { try { return [r.key, JSON.parse(r.value)]; } catch (e) { return [r.key, null]; } })) };
  }

  function funnelFor(data, pc, b) {
    const sumPc = (event, path) => (pc ? pc.filter((r) => r.day >= b.from && r.day < b.to && r.event === event && (!path || r.path === path)).reduce((t, r) => t + r.n, 0) : null);
    const diagInvoices = data.invoices.filter((i) => i.offering === "institutionalos-diagnostic" && inMonth(i.issued_date || i.created_at, b));
    const paid = data.invoices.filter((i) => i.status === "paid" && inMonth(i.paid_date, b));
    return {
      month: b.key,
      visits: sumPc("view"),
      checkupsStarted: sumPc("tool_start"),
      checkupsDone: pc ? sumPc("tool_complete") : null,
      leads: data.prospects.filter((p) => inMonth(p.created_at, b)).length,
      conversations: data.encounters.filter((e) => inMonth(e.occurred_at || e.created_at, b)).length,
      newRecords: data.pipeline.filter((p) => inMonth(p.created_at, b)).length,
      diagnostics: diagInvoices.length,
      revenue: paid.reduce((t, i) => t + Number(i.amount || 0), 0),
      invoiced: data.invoices.filter((i) => inMonth(i.issued_date, b)).reduce((t, i) => t + Number(i.amount || 0), 0),
    };
  }

  async function build(month) {
    const b = monthBounds(month);
    const [data, pc] = await Promise.all([load(), pageCounts()]);
    const current = funnelFor(data, pc, b);
    const trend = prevMonths(b.key, 6).map((k) => funnelFor(data, pc, monthBounds(k)));
    return { b, data, pc, current, trend, websiteCounting: !!pc };
  }

  app.get("/api/funnel", requireAuth, async (req, res) => {
    try {
      const { b, current, trend, websiteCounting } = await build(req.query.month);
      res.json({ month: b.key, label: b.label, current, trend, websiteCounting });
    } catch (err) {
      console.error("funnel failed", err);
      res.status(500).json({ error: "Could not build the funnel." });
    }
  });

  app.get("/report/monthly", requireAuth, async (req, res) => {
    try {
      const { b, data, current: f, trend } = await build(req.query.month);
      const today = new Date().toISOString().slice(0, 10);
      const open = data.invoices.filter((i) => i.status === "sent");
      const overdue = open.filter((i) => i.due_date && i.due_date < today);
      const active = data.pipeline.filter((p) => !CLOSED[p.stage]);
      const byStage = Object.keys(STAGE_LABELS).map((k) => [STAGE_LABELS[k], data.pipeline.filter((p) => p.stage === k).length]).filter((r) => r[1]);
      const clients = data.pipeline.filter((p) => p.ios_org_id && !CLOSED[p.stage]).map((p) => {
        let plan = null; try { plan = p.ios_plan ? JSON.parse(p.ios_plan) : null; } catch (e) {}
        const parts = [];
        if (p.ios_constraint) parts.push("Constraint: " + p.ios_constraint);
        if (plan && plan.startDate) parts.push(`${plan.actionsDone ?? 0} of ${plan.actionsTotal ?? 0} plan actions done` + (plan.actionsBlocked ? `, ${plan.actionsBlocked} blocked` : ""));
        else parts.push("No 90-day plan yet");
        if (plan && plan.review90On) parts.push("90-day review " + plan.review90On + (plan.review90Done ? " (done)" : ""));
        return [p.org || p.name, parts.join(" · ")];
      });
      const q = `Q${Math.floor((Number(b.key.slice(5)) - 1) / 3) + 1} ${b.key.slice(0, 4)}`;
      const rocks = data.rocks.filter((r) => !r.quarter || r.quarter.includes(b.key.slice(0, 4)));
      const openIssues = data.issues.filter((i) => i.status !== "solved" && i.status !== "resolved" && !i.resolved_at);
      const sc = data.scorecard.filter((s) => inMonth(s.week_of, b));
      const scSum = (k) => sc.reduce((t, s) => t + Number(s[k] || 0), 0);
      const backup = data.settings.last_backup;
      const steps = [
        ["Website visits", f.visits], ["Free check-ups started", f.checkupsStarted], ["Leads", f.leads],
        ["Conversations logged", f.conversations], ["Diagnostics invoiced", f.diagnostics],
      ];
      const orgName = (ORG.org && ORG.org.name) || "Operations";
      const navy = (ORG.brand && ORG.brand.navy) || "#11233D", gold = (ORG.brand && ORG.brand.gold) || "#B28E42";
      const row = (cells) => "<tr>" + cells.map((c) => `<td>${c}</td>`).join("") + "</tr>";
      res.set("Content-Type", "text/html; charset=utf-8").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Monthly report, ${esc(b.label)} | ${esc(orgName)}</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<style>
:root{--navy:${navy};--gold:${gold};}
*{box-sizing:border-box}body{margin:0;background:#F3F5F7;color:#23282D;font:15px/1.55 Inter,system-ui,sans-serif}
.page{max-width:900px;margin:0 auto;background:#fff;padding:40px 48px 56px}
header{border-bottom:3px solid var(--gold);padding-bottom:14px;margin-bottom:24px;display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap}
h1,h2{font-family:"Playfair Display",Georgia,serif;color:var(--navy);margin:0}h1{font-size:30px}h2{font-size:20px;margin:30px 0 10px}
.muted{color:#55606B;font-size:13px}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.kpi{border:1px solid #E2E6EA;border-left:4px solid var(--gold);border-radius:10px;padding:12px 14px}.kpi b{display:block;font-size:24px;color:var(--navy)}
table{width:100%;border-collapse:collapse;font-size:14px}td,th{padding:8px 10px;border-bottom:1px solid #E2E6EA;text-align:left;vertical-align:top}th{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#55606B}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}.bad{color:#B42828;font-weight:600}
.toolbar{max-width:900px;margin:16px auto;display:flex;gap:10px;justify-content:flex-end}.toolbar a,.toolbar button{font:inherit;font-weight:600;padding:8px 14px;border-radius:8px;border:1px solid #CBD2D9;background:#fff;color:var(--navy);text-decoration:none;cursor:pointer}
@media print{body{background:#fff}.toolbar{display:none}.page{padding:0}h2{break-after:avoid}table{break-inside:auto}tr{break-inside:avoid}}
@media(max-width:700px){.page{padding:24px 18px}.kpis{grid-template-columns:repeat(2,1fr)}}
</style></head><body>
<div class="toolbar"><a href="/report/monthly?month=${prevMonths(b.key, 2)[0]}">&larr; Previous month</a><a href="/">Back to Operations</a><button onclick="window.print()">Print or save as PDF</button></div>
<main class="page">
<header><div><p class="muted" style="margin:0 0 4px">${esc(orgName)} &middot; Monthly report</p><h1>${esc(b.label)}</h1></div><p class="muted">Prepared ${esc(new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }))}</p></header>
<div class="kpis">
<div class="kpi"><b>${money(f.revenue)}</b><span class="muted">collected this month</span></div>
<div class="kpi"><b>${money(f.invoiced)}</b><span class="muted">invoiced this month</span></div>
<div class="kpi"><b>${money(open.reduce((t, i) => t + Number(i.amount || 0), 0))}</b><span class="muted">outstanding${overdue.length ? `, <span class="bad">${money(overdue.reduce((t, i) => t + Number(i.amount || 0), 0))} overdue</span>` : ""}</span></div>
<div class="kpi"><b>${active.length}</b><span class="muted">active pipeline records</span></div>
</div>

<h2>From first visit to revenue</h2>
<table><thead><tr><th>Step</th><th class="num">This month</th><th class="num">Share of the step before</th>${trend.slice(0, 5).map((t) => `<th class="num">${esc(monthBounds(t.month).label.split(" ")[0].slice(0, 3))}</th>`).join("")}</tr></thead><tbody>
${steps.map(([label, v], i) => row([esc(label), `<span style="float:right">${v == null ? "—" : v}</span>`, `<span style="float:right">${i === 0 ? "" : pct(v, steps[i - 1][1])}</span>`,
  ...trend.slice(0, 5).map((t) => { const map = { "Website visits": t.visits, "Free check-ups started": t.checkupsStarted, "Leads": t.leads, "Conversations logged": t.conversations, "Diagnostics invoiced": t.diagnostics }; const x = map[label]; return `<span style="float:right">${x == null ? "—" : x}</span>`; })])).join("")}
${row(["Revenue collected", `<span style="float:right">${money(f.revenue)}</span>`, "", ...trend.slice(0, 5).map((t) => `<span style="float:right">${money(t.revenue)}</span>`)])}
</tbody></table>
<p class="muted">Visits and check-up starts come from the website's cookie-free counter (page and date only). A dash means no data was recorded for that step.</p>

<h2>Pipeline now</h2>
${byStage.length ? `<table><tbody>${byStage.map(([l, n]) => row([esc(l), `<span style="float:right">${n}</span>`])).join("")}</tbody></table>` : `<p class="muted">No pipeline records yet.</p>`}
${active.filter((p) => p.next_step).slice(0, 10).length ? `<h2>Next steps on active records</h2><table><thead><tr><th>Organization</th><th>Next step</th><th>Date</th></tr></thead><tbody>${active.filter((p) => p.next_step).sort((a, z) => (a.next_step_date || "9").localeCompare(z.next_step_date || "9")).slice(0, 10).map((p) => row([esc(p.org || p.name), esc(p.next_step), `<span class="${p.next_step_date && p.next_step_date < today ? "bad" : ""}">${esc(p.next_step_date || "")}</span>`])).join("")}</tbody></table>` : ""}

<h2>Clients in a Diagnostic or 90-day plan</h2>
${clients.length ? `<table><tbody>${clients.map(([n, d]) => row([esc(n), esc(d)])).join("")}</tbody></table>` : `<p class="muted">No InstitutionalOS clients yet.</p>`}

<h2>Priorities and issues</h2>
${rocks.length ? `<table><thead><tr><th>Priority (${esc(q)})</th><th>Status</th><th>Due</th></tr></thead><tbody>${rocks.map((r) => row([esc(r.title), esc(r.status || ""), esc(r.due_date || "")])).join("")}</tbody></table>` : `<p class="muted">No priorities recorded for this year.</p>`}
<p>${openIssues.length} open issue${openIssues.length === 1 ? "" : "s"}${openIssues.length ? ": " + openIssues.slice(0, 5).map((i) => esc(i.title)).join("; ") + (openIssues.length > 5 ? "; and more" : "") : ""}.</p>

${sc.length ? `<h2>Weekly log totals</h2><table><tbody>${row(["Calls", `<span style="float:right">${scSum("calls")}</span>`])}${row(["Leads", `<span style="float:right">${scSum("leads")}</span>`])}${row(["Won", `<span style="float:right">${scSum("won")}</span>`])}${row(["Lost", `<span style="float:right">${scSum("lost")}</span>`])}${row(["Referrals", `<span style="float:right">${scSum("referrals")}</span>`])}</tbody></table>` : ""}

<h2>System health</h2>
<p>${backup ? `Last full backup: ${esc(String(backup.at || "").slice(0, 16).replace("T", " "))} UTC, ${backup.ok ? "complete" : `<span class="bad">with problems: ${esc((backup.errors || []).join("; "))}</span>`}.` : `<span class="bad">No full backup recorded yet.</span>`}</p>
</main></body></html>`);
    } catch (err) {
      console.error("monthly report failed", err);
      res.status(500).send("Could not build the report.");
    }
  });
}

// ---------- proposal and engagement letter ----------
const TRACK_TO_OFFER = { institutionalos: "institutionalos-diagnostic", retainer: "retainer", consulting: "project", coaching: "coaching", speaking: "speaking" };
function mountLetter(app, { pool, requireAuth }) {
  app.get("/letter/engagement", requireAuth, async (req, res) => {
    const r = await pool.query("SELECT * FROM pipeline WHERE id = $1", [String(req.query.pipeline || "")]);
    const p = r.rows[0];
    if (!p) return res.status(404).send("Pipeline record not found.");
    const offers = (ORG.offers || []).filter((o) => o.key !== "other");
    const key = String(req.query.offer || TRACK_TO_OFFER[p.track] || "institutionalos-diagnostic");
    const offer = offers.find((o) => o.key === key) || offers[0];
    const stage = (p.diagnostic_stage || "").toLowerCase();
    let price = offer.price;
    if (price && typeof price === "object") price = price[stage] || price.default || 0;
    const priceText = price ? `${money(price)}${offer.unit && offer.unit !== "one-time" ? " " + offer.unit : ""}` : (offer.unit || "to be agreed");
    const e = ORG.engagement || {};
    const o = ORG.org || {};
    const leader = o.leader || {};
    const navy = (ORG.brand && ORG.brand.navy) || "#11233D", gold = (ORG.brand && ORG.brand.gold) || "#B28E42";
    const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const clientOrg = p.org || "Your organization";
    const clientName = p.name && !/@/.test(p.name) ? p.name : "";
    res.set("Content-Type", "text/html; charset=utf-8").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Engagement letter, ${esc(clientOrg)} | ${esc(o.shortName || o.name || "")}</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<style>
:root{--navy:${navy};--gold:${gold};}*{box-sizing:border-box}
body{margin:0;background:#F3F5F7;color:#23282D;font:15.5px/1.6 Inter,system-ui,sans-serif}
.page{max-width:820px;margin:0 auto 40px;background:#fff;padding:48px 56px}
.lh{display:flex;justify-content:space-between;gap:16px;border-bottom:3px solid var(--gold);padding-bottom:12px;margin-bottom:28px;flex-wrap:wrap}
.lh b{font-family:"Playfair Display",Georgia,serif;font-size:22px;color:var(--navy)}.lh span{color:#55606B;font-size:13px;text-align:right}
h1{font-family:"Playfair Display",Georgia,serif;color:var(--navy);font-size:26px;margin:0 0 6px}h2{font-size:15px;text-transform:uppercase;letter-spacing:.06em;color:var(--navy);margin:26px 0 8px}
[contenteditable]{outline:1px dashed transparent;border-radius:4px}[contenteditable]:hover{outline-color:#CBD2D9}[contenteditable]:focus{outline-color:var(--gold)}
ul{padding-left:20px}li{margin:4px 0}.price{font-size:18px;font-weight:600;color:var(--navy)}
.sign{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:40px}.sign div{border-top:1px solid #23282D;padding-top:6px;font-size:13px;color:#55606B}
.toolbar{max-width:820px;margin:16px auto;display:flex;gap:10px;flex-wrap:wrap;justify-content:space-between;align-items:center;font-size:14px}
.toolbar select,.toolbar button,.toolbar a{font:inherit;font-weight:600;padding:8px 12px;border-radius:8px;border:1px solid #CBD2D9;background:#fff;color:var(--navy);text-decoration:none;cursor:pointer}
.note{max-width:820px;margin:0 auto 10px;color:#55606B;font-size:13px}
@media print{body{background:#fff}.toolbar,.note{display:none}.page{padding:0;margin:0}[contenteditable]{outline:none}}
@media(max-width:700px){.page{padding:28px 20px}.sign{grid-template-columns:1fr}}
</style></head><body>
<div class="toolbar"><label>Offer <select onchange="location.search='?pipeline=${encodeURIComponent(p.id)}&offer='+this.value">${offers.map((x) => `<option value="${esc(x.key)}"${x.key === offer.key ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
<span><a href="/">Back to Operations</a> <button onclick="window.print()">Print or save as PDF</button></span></div>
<p class="note">Click any text to edit it before printing. Nothing here is saved; standard wording lives in org.config.json (offers and engagement).</p>
<main class="page">
<div class="lh"><b>${esc(o.name || "")}</b><span>${esc(leader.name || "")}, ${esc(leader.title || "")}<br>${esc(o.email || "")} &middot; ${esc(o.phone || "")}</span></div>
<p contenteditable="true">${esc(today)}</p>
<p contenteditable="true">${clientName ? esc(clientName) + "<br>" : ""}${esc(clientOrg)}</p>
<h1 contenteditable="true">Proposal and engagement letter: ${esc(offer.name)}</h1>
<p contenteditable="true">${clientName ? "Dear " + esc(clientName.split(" ")[0]) + "," : "Hello,"}</p>
<p contenteditable="true">Thank you for the conversation about ${esc(clientOrg)}. This letter sets out what ${esc(o.shortName || o.name)} will do, what it costs, and how we'll work together. When it's signed, we'll schedule the first session.</p>
<h2>What's included</h2>
<ul contenteditable="true">${(offer.scope || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
<h2>Investment</h2>
<p contenteditable="true"><span class="price">${esc(priceText)}</span>${offer.note ? `<br><span style="color:#55606B">${esc(offer.note)}</span>` : ""}${offer.key === "institutionalos-diagnostic" ? `<br><span style="color:#55606B">If a funder will cover the fee, we'll invoice the funder directly.</span>` : ""}</p>
<h2>Payment</h2><p contenteditable="true">${esc(e.payment || "")}</p>
<h2>Confidentiality</h2><p contenteditable="true">${esc(e.confidentiality || "")}</p>
<h2>Your data</h2><p contenteditable="true">${esc(e.data || "")}</p>
<h2>Ending the engagement</h2><p contenteditable="true">${esc(e.ending || "")}</p>
<p contenteditable="true" style="margin-top:22px">${esc(e.signature || "")}</p>
<div class="sign"><div>${esc(leader.name || "")}, ${esc(o.legalName || o.name || "")}<br>Date</div><div contenteditable="true">${clientName ? esc(clientName) + ", " : "Name and title, "}${esc(clientOrg)}<br>Date</div></div>
</main></body></html>`);
  });
}

module.exports = { weekFunnel, mount, mountLetter, monthBounds };
