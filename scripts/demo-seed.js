#!/usr/bin/env node
// Fills a copy of the operations app with a fictional organization's work, for
// showing prospects what the stack does. Every name, number and email here is
// made up (emails end in .example, which can never receive mail).
//
//   DEMO_PASSWORD=<the copy's ADMIN_PASSWORD> DEMO_TOKEN=<its ADMIN_API_TOKEN> \
//     node scripts/demo-seed.js https://ops-demo.onrender.com
//
// Use it on a demo copy only, never on a real organization's copy. It refuses
// to run against a copy that already has pipeline records unless --force.
"use strict";
const BASE = (process.argv[2] || "").replace(/\/+$/, "");
const FORCE = process.argv.includes("--force");
if (!/^https?:\/\//.test(BASE) || !process.env.DEMO_PASSWORD || !process.env.DEMO_TOKEN) {
  console.error("Usage: DEMO_PASSWORD=... DEMO_TOKEN=... node scripts/demo-seed.js <base-url> [--force]");
  process.exit(1);
}
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
let cookie = "";
async function call(method, url, body, headers) {
  const r = await fetch(BASE + url, { method, headers: Object.assign({ "Content-Type": "application/json" }, cookie ? { Cookie: cookie } : {}, headers || {}), body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  const set = r.headers.get("set-cookie"); if (set) cookie = set.split(";")[0];
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${j.error || ""}`);
  return j;
}

const CLIENTS = [
  { org: "Maple Street Literacy Project", name: "Renee Alvarez", email: "renee@maplestreet.example", stage: "contracted", track: "institutionalos", dealValue: 2500, nextStep: "90-day review", nextStepDate: day(12),
    plan: { startDate: day(-60), target: "Three new foundation funders in active conversation", baseline: "One funder provides 62% of revenue", actionsTotal: 6, actionsDone: 4, actionsBlocked: 0, actionsOverdue: 0, review90On: day(30), nextAction: { text: "Send the board the list of 20 aligned funders" } },
    comparison: { baselineDate: day(-75), baselineLabel: "At the Diagnostic", overallBefore: 48, overallAfter: 63, overallChange: 15, dimensions: [{ name: "Revenue and Financial Health", before: 31, after: 54, change: 23 }, { name: "Board and Governance", before: 52, after: 61, change: 9 }, { name: "Leadership and Succession", before: 55, after: 58, change: 3 }, { name: "Programs and Evidence", before: 60, after: 66, change: 6 }] },
    constraint: "Revenue depends on one funder", overall: 63 },
  { org: "Eastside Youth Arts", name: "Marcus Bell", email: "marcus@eastsidearts.example", stage: "contracted", track: "retainer", dealValue: 3000, nextStep: "Monthly advisory call", nextStepDate: day(5) },
  { org: "Harbor Food Collective", name: "Priya Nair", email: "priya@harborfood.example", stage: "assessment", track: "institutionalos", dealValue: 2500, nextStep: "Send the Diagnostic proposal", nextStepDate: day(2) },
  { org: "Northgate Senior Services", name: "Tom Okafor", email: "tom@northgate.example", stage: "discovery", track: "institutionalos", dealValue: 2500, nextStep: "Discovery call", nextStepDate: day(4) },
  { org: "Riverside Housing Partners", name: "Alicia Grant", email: "alicia@riversidehousing.example", stage: "lead", track: "institutionalos", nextStep: "Reply with the booking link", nextStepDate: day(1) }
];

(async () => {
  await call("POST", "/api/login", { password: process.env.DEMO_PASSWORD });
  const state = await call("GET", "/api/state");
  if ((state.pipeline || []).length && !FORCE) { console.error("This copy already has pipeline records. It looks like a real copy; not adding demo data. Use --force on a demo copy."); process.exit(1); }
  const ids = {};
  for (const c of CLIENTS) {
    const d = await call("POST", "/api/pipeline", { name: c.name, org: c.org, stage: c.stage, track: c.track, dealValue: c.dealValue || 0, nextStep: c.nextStep, nextStepDate: c.nextStepDate, source: "Demo data", notes: "Fictional demo organization." });
    ids[c.org] = d.id;
    await call("POST", "/api/contacts", { name: c.name, email: c.email, title: "Executive Director", notes: c.org + " (demo)" }).catch(() => {});
    console.log("  client", c.org);
  }
  // Money: an invoice paid, one due.
  const maple = ids["Maple Street Literacy Project"], east = ids["Eastside Youth Arts"];
  await call("POST", "/api/invoices", { pipelineId: maple, offering: "InstitutionalOS Diagnostic", amount: 2500, issuedDate: day(-70), dueDate: day(-40), paidDate: day(-45), status: "paid" });
  await call("POST", "/api/invoices", { pipelineId: east, offering: "Advisory retainer", amount: 3000, issuedDate: day(-10), dueDate: day(20), status: "sent" });
  // Delivery and time for the client with outcomes.
  for (const [m, when, st] of [["Diagnostic intake", -74, "complete"], ["Evidence review and scoring", -68, "complete"], ["Leadership readout", -62, "complete"], ["Funder strategy session", -30, "complete"], ["90-day review", 30, "scheduled"]])
    await call("POST", "/api/engagement-modules", { pipelineId: maple, moduleName: m, sessionDate: day(when), status: st });
  for (const [mins, ago, note] of [[180, 74, "Intake and document review"], [240, 68, "Scoring and memo"], [90, 62, "Readout"], [120, 30, "Funder research"], [60, 14, "Check-in"]])
    await call("POST", "/api/time-entries", { pipelineId: maple, minutes: mins, entryDate: day(-ago), note });
  // Plan progress and before-and-after scores, as InstitutionalOS would send them.
  const c = CLIENTS[0];
  await call("POST", "/api/admin/ios-sync", { orgId: 990001, externalRef: maple, overall: c.overall, decision: "Fund", record: { verifiedConstraint: c.constraint }, plan: c.plan, comparison: c.comparison }, { "X-Admin-Token": process.env.DEMO_TOKEN });
  // Projects & Team: a delivery project the client sees, with a conversation and a decision.
  const now = new Date().toISOString();
  const ops = [
    { path: "projects", id: "demo-funders", data: { name: "Funder pipeline build", eng: maple, status: "on_track", due: day(30), sections: [{ id: "s1", name: "Research" }, { id: "s2", name: "Outreach" }], fields: [], files: [], updates: [] } },
    { path: "tasks", id: "demo-t1", data: { title: "List 20 aligned foundations", project: "demo-funders", section: "s1", status: "done", done: true, doneAt: day(-20), owner: "u0" } },
    { path: "tasks", id: "demo-t2", data: { title: "Board members each name three contacts", project: "demo-funders", section: "s1", status: "done", done: true, doneAt: day(-9), owner: "u0" } },
    { path: "tasks", id: "demo-t3", data: { title: "Draft the case for support", project: "demo-funders", section: "s2", status: "in_progress", due: day(7), owner: "u0" } },
    { path: "tasks", id: "demo-t4", data: { title: "First five introduction emails", project: "demo-funders", section: "s2", status: "todo", due: day(14), owner: "u0" } },
    { path: "msgs", id: "demo-m1", data: { on: "with:" + maple, text: "Could we add the Lee Family Foundation? Our board chair knows their director.", at: day(-8) + "T15:00:00.000Z", via: "client", guest: "Renee Alvarez", mentions: [] } },
    { path: "msgs", id: "demo-m2", data: { on: "with:" + maple, parent: "demo-m1", text: "Yes. Adding them, and we'll ask your chair for a warm introduction this month.", at: day(-8) + "T17:30:00.000Z", decision: { by: "demo", at: now }, mentions: [] } }
  ];
  await call("POST", "/api/hub/write", { ops });
  const link = await call("POST", `/api/clients/${maple}/access`, { name: "Renee Alvarez", email: "renee@maplestreet.example" });
  console.log("\nDemo data loaded.\nClient workspace for Maple Street Literacy Project (open it to show a prospect):\n  " + link.url);
})().catch((e) => { console.error(e.message); process.exit(1); });
