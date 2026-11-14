#!/usr/bin/env node
"use strict";
// Automated tests for the operations app. Starts the real server against a
// throwaway Postgres database, exercises sign-in, roles, two-step sign-in,
// the main data endpoints, the organization profile, and the backup, then
// stops it. Run before every deploy:
//
//   TEST_DATABASE_URL=postgres://postgres@localhost:5432/fios_test npm test
//
// The database is emptied first, so never point this at real data.
const { spawn } = require("child_process");
const path = require("path");
const assert = require("assert");
const { Pool } = require("pg");
const accounts = require("../accounts");

const DB = process.env.TEST_DATABASE_URL;
if (!DB) { console.error("Set TEST_DATABASE_URL to an empty test database."); process.exit(1); }
const PORT = 5000 + Math.floor(Math.random() * 900);
const BASE = `http://localhost:${PORT}`;
let passed = 0, failed = 0;
const jar = {};

async function req(who, method, url, body, headers = {}) {
  const h = Object.assign({ "Content-Type": "application/json" }, headers);
  if (jar[who]) h.Cookie = jar[who];
  const r = await fetch(BASE + url, { method, headers: h, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  const set = r.headers.get("set-cookie");
  if (set) jar[who] = set.split(";")[0];
  let data = null; try { data = await r.json(); } catch (e) {}
  return { status: r.status, data, headers: r.headers };
}
async function t(name, fn) {
  try { await fn(); passed++; console.log("  ok   " + name); }
  catch (err) { failed++; console.log("  FAIL " + name + "\n       " + err.message); }
}

(async () => {
  const pool = new Pool({ connectionString: DB });
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await pool.end();
  const env = Object.assign({}, process.env, { PORT: String(PORT), DATABASE_URL: DB, ADMIN_PASSWORD: "practice-pw", ADMIN_API_TOKEN: "test-token", SESSION_SECRET: "test-secret", GRANTPASS_INTEGRATION_KEY: "", LOGIN_MAX_ATTEMPTS: "1000" });
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 60 && !/Listening on/.test(log); i++) await new Promise((r) => setTimeout(r, 250));
  if (!/Listening on/.test(log)) { console.error("server did not start:\n" + log); process.exit(1); }

  console.log("Operations app tests");
  await t("pages: sign-in page for visitors", async () => {
    const r = await fetch(BASE + "/"); const html = await r.text();
    assert.match(html, /id="login-form"/);
  });
  await t("api: unauthenticated state is refused", async () => {
    assert.strictEqual((await req("anon", "GET", "/api/state")).status, 401);
  });
  await t("sign-in: wrong practice password refused", async () => {
    assert.strictEqual((await req("x", "POST", "/api/login", { password: "nope" })).status, 401);
  });
  await t("sign-in: practice password signs in as owner", async () => {
    assert.strictEqual((await req("owner0", "POST", "/api/login", { password: "practice-pw" })).status, 200);
    const me = await req("owner0", "GET", "/api/me");
    assert.strictEqual(me.data.user.role, "owner");
  });
  await t("state: loads with every collection", async () => {
    const r = await req("owner0", "GET", "/api/state");
    assert.strictEqual(r.status, 200);
    for (const k of ["pipeline", "invoices", "issues", "rocks", "prospects"]) assert.ok(Array.isArray(r.data[k]), k);
  });
  await t("people: owner adds owner, staff, and board accounts", async () => {
    for (const [email, role] of [["owner@test.org", "owner"], ["staff@test.org", "staff"], ["board@test.org", "board"]]) {
      const r = await req("owner0", "POST", "/api/users", { email, name: role, role, password: role + "-password-1" });
      assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    }
    assert.strictEqual((await req("owner0", "POST", "/api/users", { email: "owner@test.org", role: "staff", password: "x-password-1" })).status, 409);
  });
  await t("roles: board can read but not write", async () => {
    assert.strictEqual((await req("board", "POST", "/api/login", { email: "board@test.org", password: "board-password-1" })).status, 200);
    assert.strictEqual((await req("board", "GET", "/api/state")).status, 200);
    assert.strictEqual((await req("board", "POST", "/api/issues", { title: "x" })).status, 403);
    assert.strictEqual((await req("board", "GET", "/api/users")).status, 403);
  });
  await t("roles: staff can write, but not people, settings, or My Desk", async () => {
    assert.strictEqual((await req("staff", "POST", "/api/login", { email: "staff@test.org", password: "staff-password-1" })).status, 200);
    const issue = await req("staff", "POST", "/api/issues", { title: "Test issue" });
    assert.ok(issue.status < 300, "staff create issue " + issue.status);
    assert.strictEqual((await req("staff", "GET", "/api/users")).status, 403);
    assert.strictEqual((await req("staff", "PUT", "/api/advancement-state", {})).status, 403);
    const st = await req("staff", "GET", "/api/state");
    assert.deepStrictEqual(st.data.quizAttempts, []);
  });
  await t("roles: staff session can't use admin endpoints", async () => {
    assert.strictEqual((await req("staff", "GET", "/api/admin/backup-all")).status, 401);
  });
  await t("two-step: code required after turning on; practice password turned off", async () => {
    assert.strictEqual((await req("owner1", "POST", "/api/login", { email: "owner@test.org", password: "owner-password-1" })).status, 200);
    const start = await req("owner1", "POST", "/api/me/2fa", { action: "start" });
    const code = accounts.totpAt(start.data.secret, Math.floor(Date.now() / 30000));
    const on = await req("owner1", "POST", "/api/me/2fa", { action: "confirm", code });
    assert.strictEqual(on.status, 200); assert.strictEqual(on.data.sharedTurnedOff, true);
    const noCode = await req("y", "POST", "/api/login", { email: "owner@test.org", password: "owner-password-1" });
    assert.strictEqual(noCode.status, 401); assert.strictEqual(noCode.data.needCode, true);
    assert.strictEqual((await req("y", "POST", "/api/login", { email: "owner@test.org", password: "owner-password-1", code: "000000" })).status, 401);
    assert.strictEqual((await req("y", "POST", "/api/login", { email: "owner@test.org", password: "owner-password-1", code: accounts.totpAt(start.data.secret, Math.floor(Date.now() / 30000)) })).status, 200);
    assert.strictEqual((await req("z", "POST", "/api/login", { password: "practice-pw" })).status, 401);
  });
  await t("people: turning an account off locks it out", async () => {
    const users = (await req("owner1", "GET", "/api/users")).data.users;
    const board = users.find((u) => u.email === "board@test.org");
    assert.strictEqual((await req("owner1", "PATCH", "/api/users/" + board.id, { disabled: true })).status, 200);
    assert.strictEqual((await req("board", "GET", "/api/state")).status, 401);
  });
  await t("profile: org.config.json is served and complete", async () => {
    const r = await req("anon", "GET", "/org.config.json");
    assert.strictEqual(r.status, 200);
    for (const k of ["org", "brand", "links", "modules", "offers"]) assert.ok(r.data[k], k);
    assert.ok(r.data.offers.every((o) => o.key && o.name), "every offer has a key and name");
  });
  await t("backup: full-system backup includes every table here", async () => {
    const r = await req("anon", "GET", "/api/admin/backup-all", null, { "X-Admin-Token": "test-token" });
    assert.strictEqual(r.status, 200);
    for (const tbl of ["pipeline", "invoices", "app_users", "issues"]) assert.ok(Array.isArray(r.data.operations.tables[tbl]), tbl);
    assert.ok(r.data.operations.tables.issues.length >= 1, "the staff issue is in the backup");
  });
  await t("funnel: numbers for a month and a six-month trend", async () => {
    const r = await req("owner1", "GET", "/api/funnel?month=2026-11");
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.data.trend.length, 6);
    for (const k of ["leads", "conversations", "diagnostics", "revenue"]) assert.ok(k in r.data.current, k);
  });
  await t("report: monthly report renders for owner and board-free staff", async () => {
    const r = await fetch(BASE + "/report/monthly?month=2026-11", { headers: { Cookie: jar.owner1 } });
    const html = await r.text();
    assert.strictEqual(r.status, 200); assert.match(html, /Monthly report/); assert.match(html, /From first visit to revenue/);
  });
  await t("letter: engagement letter for a pipeline record", async () => {
    const created = await req("owner1", "POST", "/api/pipeline", { name: "Pat Lee", org: "Test Youth Alliance", track: "institutionalos", stage: "discovery", diagnosticStage: "build" });
    assert.ok(created.status < 300, "create pipeline " + created.status);
    const id = (created.data && (created.data.id || (created.data.record && created.data.record.id))) || (await req("owner1", "GET", "/api/state")).data.pipeline[0].id;
    const r = await fetch(BASE + "/letter/engagement?pipeline=" + encodeURIComponent(id), { headers: { Cookie: jar.owner1 } });
    const html = await r.text();
    assert.strictEqual(r.status, 200); assert.match(html, /Test Youth Alliance/); assert.match(html, /What's included/);
  });
  await t("retention: deletes only old logs and reports the rest", async () => {
    const r = await req("anon", "POST", "/api/admin/retention", {}, { "X-Admin-Token": "test-token" });
    assert.strictEqual(r.status, 200); assert.ok("deleted" in r.data && "review" in r.data);
  });
  await t("today: the Today view and switcher are in the page", async () => {
    const r = await fetch(BASE + "/", { headers: { Cookie: jar.owner1 } }); const html = await r.text();
    assert.match(html, /data-view="today"/); assert.match(html, /fi-switcher/); assert.match(html, /data-view="settings"/);
  });

  // ---------------- Foundation: grantmaking ----------------
  const G = {};
  await t("grants: create a program with criteria and an online form", async () => {
    const r = await req("owner1", "POST", "/api/gm/programs", { name: "Community Builders Fund", budget: 100000, maxAward: 25000, status: "open", acceptsOnline: true, criteria: "Need\nPlan\nCapacity", questions: "How will you measure success?" });
    assert.strictEqual(r.status, 201, JSON.stringify(r.data));
    G.program = r.data.item;
    assert.strictEqual(G.program.slug, "community-builders-fund");
    assert.deepStrictEqual(G.program.criteria.map((c) => c.key), ["need", "plan", "capacity"]);
    assert.strictEqual(G.program.questions.length, 1);
  });
  await t("grants: public form accepts an application (no sign-in), bots are ignored", async () => {
    const page = await fetch(BASE + "/apply/community-builders-fund"); assert.strictEqual(page.status, 200);
    assert.match(await page.text(), /Submit application/);
    const q = G.program.questions[0].key;
    const form = new URLSearchParams({ orgName: "Eastside Learning Lab", ein: "52-1234567", contactName: "Dana Ruiz", contactEmail: "dana@eastside.org", amountRequested: "$20,000", annualBudget: "400000", projectTitle: "After-school tutoring", summary: "Tutoring for 120 students.", ["q_" + q]: "Reading levels each term." });
    const r = await fetch(BASE + "/api/public/apply/community-builders-fund", { method: "POST", body: form, redirect: "manual" });
    assert.strictEqual(r.status, 303);
    const bot = await fetch(BASE + "/api/public/apply/community-builders-fund", { method: "POST", body: new URLSearchParams({ orgName: "Spam", contactEmail: "s@s.co", website2: "x" }), redirect: "manual" });
    assert.strictEqual(bot.status, 303);
    const apps = (await req("owner1", "GET", "/api/gm/applications")).data.items;
    assert.strictEqual(apps.length, 1, "only the real application is saved");
    G.app = apps[0];
    assert.strictEqual(G.app.source, "online"); assert.strictEqual(G.app.amountRequested, 20000);
    assert.strictEqual(G.app.answers[q], "Reading levels each term.");
  });
  await t("grants: closed program refuses applications", async () => {
    const c = await req("owner1", "POST", "/api/gm/programs", { name: "Closed Fund", status: "closed", acceptsOnline: true });
    const r = await fetch(BASE + "/api/public/apply/" + c.data.item.slug, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ orgName: "X", contactEmail: "x@x.org" }) });
    assert.strictEqual(r.status, 400);
  });
  await t("grants: reviews average across reviewers; a conflict isn't counted", async () => {
    assert.strictEqual((await req("owner1", "POST", `/api/gm/applications/${G.app.id}/review`, { scores: { need: 5, plan: 4, capacity: 3 }, recommendation: "fund", comment: "Strong" })).status, 200);
    assert.strictEqual((await req("staff", "POST", `/api/gm/applications/${G.app.id}/review`, { scores: { need: 3, plan: 3, capacity: 3 }, recommendation: "fund-with-changes" })).status, 200);
    // saving again replaces the reviewer's earlier review
    assert.strictEqual((await req("staff", "POST", `/api/gm/applications/${G.app.id}/review`, { scores: { need: 4, plan: 4, capacity: 4 }, recommendation: "fund" })).status, 200);
    const d = (await req("owner1", "GET", "/api/gm/applications/" + G.app.id)).data;
    assert.strictEqual(d.reviews.length, 2); assert.strictEqual(d.score.average, 4); assert.strictEqual(d.score.recommendations.fund, 2);
    assert.strictEqual(d.item.status, "in-review");
    await req("owner1", "POST", `/api/gm/applications/${G.app.id}/review`, { scores: { need: 1, plan: 1, capacity: 1 }, conflict: true });
    const c = (await req("owner1", "GET", "/api/gm/applications/" + G.app.id)).data.score;
    assert.strictEqual(c.reviews, 1); assert.strictEqual(c.conflicts, 1); assert.strictEqual(c.average, 4);
  });
  await t("grants: award sets up payments and reports; summary tracks budget", async () => {
    const r = await req("owner1", "POST", `/api/gm/applications/${G.app.id}/award`, { amount: 18000, start: "2027-01-01", end: "2027-12-31", installments: 2 });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    const d = (await req("owner1", "GET", "/api/gm/applications/" + G.app.id)).data;
    assert.strictEqual(d.item.status, "approved"); assert.strictEqual(d.item.amountAwarded, 18000);
    assert.deepStrictEqual(d.payments.map((p) => [p.dueOn, p.amount]), [["2027-01-01", 9000], ["2027-07-01", 9000]]);
    assert.deepStrictEqual(d.reports.map((x) => x.kind), ["interim", "final"]);
    assert.strictEqual((await req("owner1", "PATCH", "/api/gm/payments/" + d.payments[0].id, { paidOn: "2027-01-05", reference: "ACH 1" })).status, 200);
    const s = (await req("owner1", "GET", "/api/gm/summary")).data;
    const prog = s.programs.find((p) => p.id === G.program.id);
    assert.strictEqual(prog.committed, 18000); assert.strictEqual(prog.paid, 9000); assert.strictEqual(prog.remaining, 82000);
    assert.strictEqual(s.totals.owed, 9000);
  });
  await t("grants: award and decline letters render", async () => {
    const a = await (await fetch(BASE + `/letter/grant/${G.app.id}?kind=award`, { headers: { Cookie: jar.owner1 } })).text();
    assert.match(a, /Eastside Learning Lab/); assert.match(a, /\$18,000/); assert.match(a, /Interim report/);
    const dcl = await (await fetch(BASE + `/letter/grant/${G.app.id}?kind=decline`, { headers: { Cookie: jar.owner1 } })).text();
    assert.match(dcl, /not able to make a grant/);
  });

  // ---------------- Foundation: fundraising ----------------
  const F = {};
  await t("fundraising: campaign, then a gift that creates its donor", async () => {
    const c = await req("owner1", "POST", "/api/fr/campaigns", { name: "Annual Fund", goal: 50000 });
    assert.strictEqual(c.status, 201); F.campaign = c.data.item;
    const g = await req("owner1", "POST", "/api/fr/gifts", { donorName: "Jordan Lee", donorEmail: "jordan@example.org", amount: "1,000", receivedOn: new Date().toISOString().slice(0, 10), method: "check", campaignId: F.campaign.id });
    assert.strictEqual(g.status, 201, JSON.stringify(g.data)); F.gift = g.data.item;
    assert.ok(F.gift.receiptNo >= 1001, "gets a receipt number");
    const again = await req("owner1", "POST", "/api/fr/gifts", { donorName: "jordan lee", amount: 250, method: "card" });
    assert.strictEqual(again.data.item.donorId, F.gift.donorId, "same donor matched by name");
  });
  await t("fundraising: pledge, payment toward it, and donor totals", async () => {
    const p = await req("owner1", "POST", "/api/fr/pledges", { donorId: F.gift.donorId, campaignId: F.campaign.id, total: 1200, frequency: "monthly", installments: 12, firstDue: "2026-01-15" });
    assert.strictEqual(p.status, 201); F.pledge = p.data.item;
    await req("owner1", "POST", "/api/fr/gifts", { donorId: F.gift.donorId, pledgeId: F.pledge.id, campaignId: F.campaign.id, amount: 100, method: "ach" });
    const d = (await req("owner1", "GET", "/api/fr/donors/" + F.gift.donorId)).data;
    assert.strictEqual(d.totals.lifetime, 1350); assert.strictEqual(d.totals.gifts, 3);
    assert.strictEqual(d.pledges[0].received, 100); assert.strictEqual(d.pledges[0].balance, 1100);
  });
  await t("fundraising: summary counts raised, retention, pledges, and who to thank", async () => {
    const lastYear = String(new Date().getUTCFullYear() - 1) + "-06-01";
    await req("owner1", "POST", "/api/fr/gifts", { donorName: "Sam Ortiz", amount: 500, receivedOn: lastYear, ackSentOn: lastYear });
    await req("owner1", "POST", "/api/fr/gifts", { donorId: F.gift.donorId, amount: 50, receivedOn: lastYear, ackSentOn: lastYear });
    const s = (await req("owner1", "GET", "/api/fr/summary")).data;
    assert.strictEqual(s.totals.raised, 1350); assert.strictEqual(s.totals.donors, 1);
    assert.strictEqual(s.totals.retention, 50, "1 of 2 last-year donors gave again");
    assert.deepStrictEqual(s.lybunt.map((x) => x.name), ["Sam Ortiz"]);
    assert.strictEqual(s.totals.pledgeBalance, 1100);
    assert.strictEqual(s.toThank.length, 3);
    assert.strictEqual(s.campaigns[0].raised, 1100, "the $250 gift had no campaign"); assert.strictEqual(s.campaigns[0].pledged, 1100);
  });
  await t("fundraising: thank-you letters, then marked as thanked", async () => {
    const html = await (await fetch(BASE + "/letter/receipt?pending=1", { headers: { Cookie: jar.owner1 } })).text();
    assert.match(html, /Thank you for your gift of \$1,000/); assert.match(html, /Mark these 3 gifts as thanked/);
    assert.match(html, /No tax receipt wording/, "warns until an EIN is set");
    const ids = (await req("owner1", "GET", "/api/fr/summary")).data.toThank.map((g) => g.id);
    const r = await req("owner1", "POST", "/api/fr/gifts/ack", { ids });
    assert.strictEqual(r.data.marked, 3);
    assert.strictEqual((await req("owner1", "GET", "/api/fr/summary")).data.toThank.length, 0);
  });
  await t("fundraising: CSV import matches donors and creates campaigns; export works", async () => {
    const csv = "Name,Email,Amount,Date,Method,Campaign\nJordan Lee,jordan@example.org,75,10/02/2026,Credit Card,Annual Fund\nRiley Chen,riley@example.org,\"1,500\",2026-09-30,check,Gala 2026\n,,,,,\n";
    const r = await fetch(BASE + "/api/fr/import", { method: "POST", headers: { Cookie: jar.owner1, "Content-Type": "text/csv" }, body: csv });
    const d = await r.json();
    assert.strictEqual(r.status, 200, JSON.stringify(d));
    assert.strictEqual(d.created, 2); assert.strictEqual(d.newDonors, 1); assert.strictEqual(d.newCampaigns, 1);
    const out = await (await fetch(BASE + "/api/fr/export/gifts.csv", { headers: { Cookie: jar.owner1 } })).text();
    assert.match(out, /^Receipt,Date,Donor/); assert.match(out, /Riley Chen/); assert.match(out, /1500/);
  });
  await t("foundation: board can read but not change grants or gifts", async () => {
    assert.strictEqual((await req("owner1", "POST", "/api/users", { email: "board2@test.org", name: "Board Two", role: "board", password: "board2-password" })).status, 200);
    assert.strictEqual((await req("board2", "POST", "/api/login", { email: "board2@test.org", password: "board2-password" })).status, 200);
    assert.strictEqual((await req("board2", "GET", "/api/fr/summary")).status, 200);
    assert.strictEqual((await req("board2", "GET", "/api/gm/summary")).status, 200);
    assert.strictEqual((await req("board2", "POST", "/api/fr/gifts", { donorName: "X", amount: 5 })).status, 403);
    assert.strictEqual((await req("board2", "POST", `/api/gm/applications/${G.app.id}/review`, { scores: {} })).status, 403);
  });
  await t("areas: owner switches an area off in Settings and the profile reflects it", async () => {
    const r = await req("owner1", "POST", "/api/settings", { modules: { fundraising: false } });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.data.modules.fundraising, false); assert.strictEqual(r.data.modules.grantmaking, true);
    assert.strictEqual((await req("anon", "GET", "/org.config.json")).data.modules.fundraising, false);
    await req("owner1", "POST", "/api/settings", { modules: { fundraising: true } });
    assert.strictEqual((await req("staff", "POST", "/api/settings", { modules: { grantmaking: false } })).status, 403);
  });
  await t("foundation: new tables are in the full backup", async () => {
    const r = await req("anon", "GET", "/api/admin/backup-all", null, { "X-Admin-Token": "test-token" });
    for (const tbl of ["gm_programs", "gm_applications", "gm_reviews", "gm_payments", "gm_reports", "fr_donors", "fr_gifts", "fr_pledges", "fr_campaigns", "fr_touches"]) assert.ok(Array.isArray(r.data.operations.tables[tbl]), tbl);
    assert.ok(r.data.operations.tables.fr_gifts.length >= 7);
  });

  srv.kill();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
