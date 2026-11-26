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
const crypto = require("crypto");
// Growth Plan tasks partway done. Ids match the growth-plan endpoint (sha1 of the title).
const GROWTH_PROGRESS = [
  { section: "hires", seat: "Executive director", title: "Plan and fund the hire: Operations / admin coordinator", status: "in_progress", due: 21 },
  { section: "fund", seat: "Development lead", title: "Fundraising move: Build the system: a grants calendar, two appeals a year, a second-gift program, mid-level donors, and the ED's first $10K+ asks", status: "in_progress", due: 30 },
  { section: "board", seat: "Board chair", title: "Board: Get to 100% board giving", status: "done", doneAgo: 12 },
  { section: "board", seat: "Board chair", title: "Board: Adopt: Operating reserve policy", status: "done", doneAgo: 5 }
];
function growthProgressOps(pid) {
  return GROWTH_PROGRESS.map((t) => ({ path: "tasks", id: pid + "-" + crypto.createHash("sha1").update(t.title).digest("hex").slice(0, 10),
    data: Object.assign({ title: t.title, project: pid, section: t.section, seat: t.seat, status: t.status, owner: "u0", created: day(-55) },
      t.status === "done" ? { done: true, doneAt: day(-t.doneAgo) } : { due: day(t.due) }) }));
}
let cookie = "";
async function call(method, url, body, headers) {
  const r = await fetch(BASE + url, { method, headers: Object.assign({ "Content-Type": "application/json" }, cookie ? { Cookie: cookie } : {}, headers || {}), body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  const set = r.headers.get("set-cookie"); if (set) cookie = set.split(";")[0];
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${j.error || ""}`);
  return j;
}

// Legacy Readiness for each sample, at three points on the path (names match InstitutionalOS legacy.py).
const ALL_MARKERS = ["A deputy who could step in", "Key decisions written down", "Board-approved succession plan", "Six months of reserves", "No funder above 30% of revenue", "Candid Platinum Seal"];
const legacyOf = (met) => ({ met: met.length, total: 6, missing: ALL_MARKERS.filter((m) => !met.includes(m)) });
const LEGACY = {
  "Harbor Food Collective": legacyOf(["Key decisions written down"]),
  "Maple Street Literacy Project": legacyOf(["A deputy who could step in", "Key decisions written down"]),
  "Eastside Youth Arts": legacyOf(["Key decisions written down", "Six months of reserves", "No funder above 30% of revenue", "Candid Platinum Seal"])
};

const CLIENTS = [
  { org: "Maple Street Literacy Project", name: "Renee Alvarez", email: "renee@maplestreet.example", stage: "engaged", track: "institutionalos", dealValue: 2500, nextStep: "90-day review", nextStepDate: day(12),
    plan: { startDate: day(-60), target: "Three new foundation funders in active conversation", baseline: "One funder provides 62% of revenue", actionsTotal: 6, actionsDone: 4, actionsBlocked: 0, actionsOverdue: 0, review90On: day(30), nextAction: { text: "Send the board the list of 20 aligned funders" } },
    comparison: { baselineDate: day(-75), baselineLabel: "At the Diagnostic", overallBefore: 48, overallAfter: 63, overallChange: 15, dimensions: [{ name: "Revenue and Financial Health", before: 31, after: 54, change: 23 }, { name: "Board and Governance", before: 52, after: 61, change: 9 }, { name: "Leadership and Succession", before: 55, after: 58, change: 3 }, { name: "Programs and Evidence", before: 60, after: 66, change: 6 }] },
    constraint: "Revenue depends on one funder", overall: 63,
    // The Growth Pathway, matching the InstitutionalOS sample portal (stage 2, 10 -> 14 of 20).
    growth: { stage: 2, stageName: "Emerging", score: 14, outOf: 20, band: "Strengthen before adding staff", baseline: { stage: 2, score: 10, at: day(-90) },
      nextStage: { stage: 3, name: "Established", at: 1000000 },
      pillars: [{ name: "Structure", score: 2 }, { name: "Money", score: 3 }, { name: "Fundraising", score: 3 }, { name: "Board", score: 2 }, { name: "Compliance", score: 4 }],
      nextHires: ["Operations / admin coordinator", "Front-line program staff"],
      fundraising: "Build the system: a grants calendar, two appeals a year, a second-gift program, mid-level donors, and the ED's first $10K+ asks",
      boardGaps: ["The next stage needs 11 to 15 members (governing board)", "Get to 100% board giving", "Adopt: Operating reserve policy", "Adopt: Board member agreements with give-or-get"] } },
  { org: "Eastside Youth Arts", name: "Marcus Bell", email: "marcus@eastsidearts.example", stage: "engaged", track: "retainer", dealValue: 3000, nextStep: "Monthly advisory call", nextStepDate: day(5) },
  { org: "Harbor Food Collective", name: "Priya Nair", email: "priya@harborfood.example", stage: "engaged", track: "institutionalos", dealValue: 2000, nextStep: "Board votes on the first policies", nextStepDate: day(6) },
  { org: "Northgate Senior Services", name: "Tom Okafor", email: "tom@northgate.example", stage: "discovery", track: "institutionalos", dealValue: 2500, nextStep: "Discovery call", nextStepDate: day(4) },
  { org: "Riverside Housing Partners", name: "Alicia Grant", email: "alicia@riversidehousing.example", stage: "lead", track: "institutionalos", nextStep: "Reply with the booking link", nextStepDate: day(1) }
];

// Two more sample clients, one for each of the other Diagnostic stages (Maple Street is Fund).
// Build = Formation Readiness; Sustain = Institutional Durability. All fictional.
const STAGE_CLIENTS = {
  "Harbor Food Collective": { key: "b", label: "Build", orgId: 990002, decision: "Build",
    constraint: "Governance isn't in place yet: a board of four, no policies, and the founder signs every check", overall: 49,
    plan: { startDate: day(-45), target: "A working board of seven, five core policies adopted, and two signers on every check", baseline: "Board of four; no policies adopted; the founder signs every check", actionsTotal: 6, actionsDone: 3, actionsBlocked: 0, actionsOverdue: 0, review90On: day(45), nextAction: { text: "Board votes on the conflict of interest and two-signer policies" } },
    comparison: { baselineDate: day(-60), baselineLabel: "At the Diagnostic", overallBefore: 35, overallAfter: 49, overallChange: 14, dimensions: [
      { name: "Governance and Risk", before: 22, after: 47, change: 25 }, { name: "Strategy and Positioning", before: 30, after: 48, change: 18 },
      { name: "Revenue and Financial Health", before: 36, after: 43, change: 7 }, { name: "Program and Impact Evidence", before: 48, after: 53, change: 5 }] },
    growth: { stage: 1, stageName: "Founder-led", score: 9, outOf: 20, band: "Stabilize first", baseline: { stage: 1, score: 5, at: day(-60) },
      nextStage: { stage: 2, name: "Emerging", at: 250000 },
      pillars: [{ name: "Structure", score: 1 }, { name: "Money", score: 2 }, { name: "Fundraising", score: 2 }, { name: "Board", score: 1 }, { name: "Compliance", score: 3 }],
      nextHires: ["Contract bookkeeper", "Founder paid (part- to full-time)"],
      fundraising: "Prove people will give: the founder's and board's networks, 100% board giving, three to five local foundation grants, one peer-to-peer or GivingTuesday campaign",
      boardGaps: ["The next stage needs 7 to 11 members (moving to a governing board)", "Get to 100% board giving", "Adopt: Conflict of interest policy", "Adopt: Financial controls with two signers"] },
    modules: [["Diagnostic intake", -58, "complete"], ["Governance review and scoring", -52, "complete"], ["Board readout", -46, "complete"], ["Policy working session", -20, "complete"], ["90-day review", 45, "scheduled"]],
    project: { name: "Board and policies", sections: ["Board", "Policies"], tasks: [
      ["Recruit three board members with finance, legal and community ties", 0, "in_progress", 14], ["Board approves updated bylaws", 0, "done", -25],
      ["Adopt a conflict of interest policy", 1, "done", -12], ["Set up two signers at the bank", 1, "todo", 10]] },
    msgs: ["Our treasurer wants a template for the two-signer policy. Do you have one?", "Yes. It's in your Policies folder now, with a one-page cover note for the board vote."],
    growthProgress: { done: ["Board: Adopt: Conflict of interest policy"], doing: ["Plan and fund the hire: Contract bookkeeper", "Board: Get to 100% board giving"] } },
  "Eastside Youth Arts": { key: "s", label: "Sustain", orgId: 990003, decision: "Sustain",
    constraint: "Everything runs through the founding executive director, with no succession plan", overall: 72,
    plan: { startDate: day(-70), target: "An emergency succession plan adopted, a deputy director in place, and key funder relationships shared", baseline: "The founder holds every major funder relationship; no deputy; two months of reserves", actionsTotal: 7, actionsDone: 5, actionsBlocked: 0, actionsOverdue: 0, review90On: day(20), nextAction: { text: "Board approves the emergency succession plan" } },
    comparison: { baselineDate: day(-85), baselineLabel: "At the Diagnostic", overallBefore: 61, overallAfter: 72, overallChange: 11, dimensions: [
      { name: "Leadership and Organizational Capacity", before: 38, after: 61, change: 23 }, { name: "Operations and Infrastructure", before: 55, after: 66, change: 11 },
      { name: "Revenue and Financial Health", before: 59, after: 67, change: 8 }, { name: "Governance and Risk", before: 66, after: 72, change: 6 }] },
    growth: { stage: 3, stageName: "Established", score: 16, outOf: 20, band: "Ready to grow", baseline: { stage: 3, score: 13, at: day(-85) },
      nextStage: { stage: 4, name: "Large", at: 5000000 },
      pillars: [{ name: "Structure", score: 3 }, { name: "Money", score: 3 }, { name: "Fundraising", score: 3 }, { name: "Board", score: 3 }, { name: "Compliance", score: 4 }],
      nextHires: ["Development director", "Program director"],
      fundraising: "Build major gifts: a development director with a portfolio of 150 or fewer qualified donors, a planned giving launch, corporate partnerships",
      boardGaps: ["The next stage needs 15 to 21 members (institutional board)", "Adopt: ED succession plan", "Adopt: Audit committee charter", "Adopt: Yearly board self-assessment"] },
    modules: [["Diagnostic intake", -84, "complete"], ["Leadership interviews and scoring", -78, "complete"], ["Board readout", -70, "complete"], ["Succession working session", -35, "complete"], ["Quarterly re-score", 20, "scheduled"]],
    project: { name: "Leadership and succession", sections: ["Succession", "Relationships"], tasks: [
      ["Draft the emergency succession plan", 0, "done", -18], ["Write the deputy director job description", 0, "done", -30],
      ["Introduce the deputy to the top ten funders", 1, "in_progress", 21], ["Move funder notes into the shared donor database", 1, "todo", 30]] },
    msgs: ["The board chair asked whether the succession plan covers a sudden absence, not just a planned retirement.", "It covers both. The emergency section names an acting ED and who signs in the first 30 days."],
    growthProgress: { done: ["Board: Adopt: ED succession plan"], doing: ["Plan and fund the hire: Development director", "Board: Adopt: Audit committee charter"] } }
};
function stageProgressOps(pid, gp) {
  const t = (title) => pid + "-" + crypto.createHash("sha1").update(title).digest("hex").slice(0, 10);
  const meta = (title) => (title.startsWith("Board:") ? ["board", "Board chair"] : title.startsWith("Fundraising") ? ["fund", "Development lead"] : ["hires", "Executive director"]);
  return [].concat(
    gp.done.map((title, i) => ({ path: "tasks", id: t(title), data: { title, project: pid, section: meta(title)[0], seat: meta(title)[1], status: "done", done: true, doneAt: day(-6 - 5 * i), owner: "u0", created: day(-40) } })),
    gp.doing.map((title, i) => ({ path: "tasks", id: t(title), data: { title, project: pid, section: meta(title)[0], seat: meta(title)[1], status: "in_progress", due: day(14 + 7 * i), owner: "u0", created: day(-40) } })));
}
// Everything a stage client's workspace shows. Safe on an existing demo copy: ids are fixed per client.
async function fillStageClient(org, id) {
  const c = STAGE_CLIENTS[org], k = "demo-" + c.key, base = CLIENTS.find((x) => x.org === org);
  for (const [m, when, st] of c.modules) await call("POST", "/api/engagement-modules", { pipelineId: id, moduleName: m, sessionDate: day(when), status: st });
  for (const [mins, ago, note] of [[150, c.modules[0][1] * -1, "Intake and document review"], [210, c.modules[1][1] * -1, "Scoring and memo"], [90, c.modules[2][1] * -1, "Readout"], [120, c.modules[3][1] * -1, "Working session"]])
    await call("POST", "/api/time-entries", { pipelineId: id, minutes: mins, entryDate: day(-ago), note });
  await call("POST", "/api/admin/ios-sync", { orgId: c.orgId, externalRef: id, overall: c.overall, decision: c.decision, record: { verifiedConstraint: c.constraint }, plan: c.plan, comparison: c.comparison, growth: c.growth, legacy: LEGACY[org] }, { "X-Admin-Token": process.env.DEMO_TOKEN });
  const ops = [{ path: "projects", id: k + "-proj", data: { name: c.project.name, eng: id, status: "on_track", due: day(30), sections: c.project.sections.map((n, i) => ({ id: "s" + (i + 1), name: n })), fields: [], files: [], updates: [] } }]
    .concat(c.project.tasks.map(([title, sec, st, d], i) => ({ path: "tasks", id: k + "-t" + (i + 1), data: Object.assign({ title, project: k + "-proj", section: "s" + (sec + 1), status: st, owner: "u0" }, st === "done" ? { done: true, doneAt: day(d) } : { due: day(d) }) })))
    .concat([{ path: "msgs", id: k + "-m1", data: { on: "with:" + id, text: c.msgs[0], at: day(-9) + "T15:00:00.000Z", via: "client", guest: base.name, mentions: [] } },
      { path: "msgs", id: k + "-m2", data: { on: "with:" + id, parent: k + "-m1", text: c.msgs[1], at: day(-9) + "T18:10:00.000Z", decision: { by: "demo", at: new Date().toISOString() }, mentions: [] } }]);
  await call("POST", "/api/hub/write", { ops });
  const gp = await call("POST", `/api/clients/${id}/growth-plan`, {});
  await call("POST", "/api/hub/write", { ops: stageProgressOps(gp.project, c.growthProgress) });
  const link = await call("POST", `/api/clients/${id}/access`, { name: base.name, email: base.email });
  console.log(`  ${c.label} sample: ${org}, growth plan ${gp.total} tasks`);
  return link.url;
}

(async () => {
  await call("POST", "/api/login", { password: process.env.DEMO_PASSWORD });
  const only = (process.argv.find((a) => a.startsWith("--progress-only=")) || "").split("=")[1];
  if (only) { // Catch an existing demo copy's Growth Plan up; touches only those task records.
    if (!/^gp-[\w-]+$/.test(only)) { console.error("Bad Growth Plan id."); process.exit(1); }
    await call("POST", "/api/hub/write", { ops: growthProgressOps(only) });
    return console.log("Growth Plan progress added (" + only + ").");
  }
  const state = await call("GET", "/api/state");
  if (process.argv.includes("--legacy-only")) { // An existing demo copy: add Legacy Readiness, resending each sample's own data.
    const done = [];
    for (const org of Object.keys(LEGACY)) {
      const row = (state.pipeline || []).find((r) => r.org === org && /Demo data/.test(r.source || ""));
      if (!row || !row.ios) continue;
      const c = STAGE_CLIENTS[org] || Object.assign({ orgId: 990001, decision: "Fund" }, CLIENTS[0]);
      await call("POST", "/api/admin/ios-sync", { orgId: c.orgId, externalRef: row.id, overall: c.overall, decision: c.decision, record: { verifiedConstraint: c.constraint }, plan: c.plan, comparison: c.comparison, growth: c.growth, legacy: LEGACY[org] }, { "X-Admin-Token": process.env.DEMO_TOKEN });
      done.push(org + " " + LEGACY[org].met + " of 6");
    }
    return console.log("Legacy Readiness added: " + (done.join(", ") || "no filled samples found"));
  }
  if (process.argv.includes("--upgrade")) { // An existing demo copy: add the Build and Sustain samples if they aren't filled yet.
    const out = [];
    for (const org of Object.keys(STAGE_CLIENTS)) {
      const row = (state.pipeline || []).find((r) => r.org === org && /Demo data/.test(r.source || ""));
      if (!row || row.ios) continue;
      out.push(STAGE_CLIENTS[org].label + ": " + await fillStageClient(org, row.id));
    }
    return console.log(out.length ? "Stage samples added.\n  " + out.join("\n  ") : "Stage samples already present.");
  }
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
  await call("POST", "/api/admin/ios-sync", { orgId: 990001, externalRef: maple, overall: c.overall, decision: "Fund", record: { verifiedConstraint: c.constraint }, plan: c.plan, comparison: c.comparison, growth: c.growth, legacy: LEGACY[c.org] }, { "X-Admin-Token": process.env.DEMO_TOKEN });
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
  // The Growth Pathway's next steps as a Growth Plan project the client sees.
  const gp = await call("POST", `/api/clients/${maple}/growth-plan`, {});
  console.log("  growth plan", gp.made, "tasks");
  // Show the Growth Plan underway (about 60 days in), not freshly made: 2 done, 2 in progress.
  const progress = growthProgressOps(gp.project);
  await call("POST", "/api/hub/write", { ops: progress });
  console.log("  growth plan progress", progress.length, "tasks updated");
  const link = await call("POST", `/api/clients/${maple}/access`, { name: "Renee Alvarez", email: "renee@maplestreet.example" });
  const more = [];
  for (const org of Object.keys(STAGE_CLIENTS)) more.push(STAGE_CLIENTS[org].label + " (" + org + "): " + await fillStageClient(org, ids[org]));
  console.log("\nDemo data loaded.\nClient workspace for Maple Street Literacy Project (open it to show a prospect):\n  " + link.url + "\nOther stages:\n  " + more.join("\n  "));
})().catch((e) => { console.error(e.message); process.exit(1); });
