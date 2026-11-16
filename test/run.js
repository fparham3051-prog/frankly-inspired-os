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
  // A stand-in for Google (OAuth + Gmail API) so the Gmail connection can be tested end to end.
  const http = require("http");
  const MOCK = { sends: [], threads: {}, port: 0 };
  const mock = http.createServer((q, r) => {
    let body = ""; q.on("data", (d) => (body += d)); q.on("end", () => {
      const u = new URL(q.url, "http://x"), json = (o, st) => { r.writeHead(st || 200, { "Content-Type": "application/json" }); r.end(JSON.stringify(o)); };
      if (u.pathname === "/token") { const f = new URLSearchParams(body); return json(f.get("grant_type") === "authorization_code" ? (f.get("code") === "good-code" ? { access_token: "at1", refresh_token: "rt1", expires_in: 3600 } : { error: "invalid_grant" }) : { access_token: "at2", expires_in: 3600 }, f.get("code") === "bad" ? 400 : 200); }
      if (u.pathname === "/revoke") return json({});
      if (q.headers.authorization !== "Bearer at1" && q.headers.authorization !== "Bearer at2") return json({ error: { message: "bad token" } }, 401);
      if (u.pathname === "/gmail/v1/users/me/profile") return json({ emailAddress: "Owner@Gmail.test" });
      if (u.pathname === "/gmail/v1/users/me/settings/sendAs") return json({ sendAs: [{ sendAsEmail: "owner@gmail.test", isDefault: false }, { sendAsEmail: "franklin@biz.test", displayName: "Franklin Parham", isDefault: true, verificationStatus: "accepted" }, { sendAsEmail: "pending@biz.test", verificationStatus: "pending" }] });
      if (u.pathname === "/gmail/v1/users/me/messages/send") {
        const j = JSON.parse(body), raw = Buffer.from(j.raw, "base64url").toString("utf8"), n = MOCK.sends.length + 1;
        const threadId = j.threadId || "t" + n;
        MOCK.sends.push({ raw, threadId: j.threadId || "", id: "m" + n });
        (MOCK.threads[threadId] = MOCK.threads[threadId] || []).push({ id: "m" + n, internalDate: String(Date.now()), payload: { headers: [{ name: "From", value: "Franklin <franklin@biz.test>" }] } });
        return json({ id: "m" + n, threadId });
      }
      let m;
      if ((m = /^\/gmail\/v1\/users\/me\/messages\/(\w+)$/.exec(u.pathname))) return json({ id: m[1], payload: { headers: [{ name: "Message-ID", value: "<" + m[1] + "@mail.test>" }] } });
      if ((m = /^\/gmail\/v1\/users\/me\/threads\/(\w+)$/.exec(u.pathname))) return json({ id: m[1], messages: MOCK.threads[m[1]] || [] });
      json({ error: { message: "not found" } }, 404);
    });
  });
  await new Promise((ok) => mock.listen(0, ok)); MOCK.port = mock.address().port;
  const GURL = "http://localhost:" + MOCK.port;
  const env = Object.assign({}, process.env, { GOOGLE_AUTH_URL: GURL + "/auth", GOOGLE_TOKEN_URL: GURL + "/token", GOOGLE_REVOKE_URL: GURL + "/revoke", GMAIL_API_BASE: GURL, PUBLIC_URL: BASE + "/" }, { PORT: String(PORT), DATABASE_URL: DB, ADMIN_PASSWORD: "practice-pw", ADMIN_API_TOKEN: "test-token", SESSION_SECRET: "test-secret", GRANTPASS_INTEGRATION_KEY: "", LOGIN_MAX_ATTEMPTS: "1000" });
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
    for (const tbl of ["proc_processes", "proc_runs", "lib_materials", "gov_members", "gov_meetings", "gov_coi", "gov_checklist", "gov_policies", "gm_programs", "gm_applications", "gm_reviews", "gm_payments", "gm_reports", "fr_donors", "fr_gifts", "fr_pledges", "fr_campaigns", "fr_touches"]) assert.ok(Array.isArray(r.data.operations.tables[tbl]), tbl);
    assert.ok(r.data.operations.tables.fr_gifts.length >= 7);
  });

  // ---------------- Governance ----------------
  const V = {};
  await t("board: members, a year of meetings, and the calendar file", async () => {
    for (const [name, role, voting] of [["Avery Chair", "chair", true], ["Blake Treasurer", "treasurer", true], ["Casey Secretary", "secretary", true], ["Drew Member", "member", true], ["Ellis Staff", "staff", false]]) {
      const r = await req("owner1", "POST", "/api/gov/members", { name, role, voting, email: name.split(" ")[0].toLowerCase() + "@board.org" });
      assert.strictEqual(r.status, 201, JSON.stringify(r.data));
    }
    V.members = (await req("owner1", "GET", "/api/gov/members")).data.items;
    const plan = await req("owner1", "POST", "/api/gov/meetings/plan", { firstDate: "2027-01-14", time: "18:30", everyMonths: 3, location: "Zoom" });
    assert.strictEqual(plan.data.created, 4);
    assert.strictEqual((await req("owner1", "POST", "/api/gov/meetings/plan", { firstDate: "2027-01-14", everyMonths: 3 })).data.created, 0, "no duplicates");
    const list = (await req("owner1", "GET", "/api/gov/meetings")).data.items;
    assert.deepStrictEqual(list.map((m) => m.startsAt.slice(0, 10)).sort(), ["2027-01-14", "2027-04-14", "2027-07-14", "2027-10-14"]);
    assert.match(list[0].agenda, /Conflicts of interest/);
    V.meeting = list.find((m) => m.startsAt.startsWith("2027-01-14"));
    const ics = await (await fetch(BASE + "/api/gov/calendar.ics", { headers: { Cookie: jar.owner1 } })).text();
    assert.match(ics, /BEGIN:VCALENDAR/); assert.strictEqual((ics.match(/BEGIN:VEVENT/g) || []).length, 4); assert.match(ics, /DTSTART;TZID=America\/New_York:20270114T183000/);
  });
  await t("board: attendance sets quorum (a majority of voting members), motions and minutes print", async () => {
    const [a, b, c, d] = V.members.filter((m) => m.role !== "staff").map((m) => m.id);
    await req("owner1", "PATCH", "/api/gov/meetings/" + V.meeting.id, { attendance: { [a]: "present", [b]: "present" }, status: "held" });
    let m = (await req("owner1", "GET", "/api/gov/meetings/" + V.meeting.id)).data;
    assert.deepStrictEqual([m.quorum.voting, m.quorum.present, m.quorum.needed, m.quorum.met], [4, 2, 3, false]);
    await req("owner1", "PATCH", "/api/gov/meetings/" + V.meeting.id, { attendance: { [a]: "present", [b]: "present", [c]: "present", [d]: "absent" }, conflictsDeclared: "Blake Treasurer on item 7; stepped out.", minutes: "Treasurer reported a balanced budget." });
    m = (await req("owner1", "GET", "/api/gov/meetings/" + V.meeting.id)).data;
    assert.strictEqual(m.quorum.met, true);
    assert.strictEqual((await req("owner1", "POST", "/api/gov/motions", { meetingId: V.meeting.id, motion: "Approve the 2027 budget", movedBy: "Avery Chair", secondedBy: "Casey Secretary", yes: 3, result: "passed" })).status, 201);
    const html = await (await fetch(BASE + "/print/minutes/" + V.meeting.id, { headers: { Cookie: jar.owner1 } })).text();
    assert.match(html, /A quorum was present \(3 of 4/); assert.match(html, /Approve the 2027 budget/); assert.match(html, /DRAFT/); assert.match(html, /stepped out/);
    const ag = await (await fetch(BASE + "/print/agenda/" + V.meeting.id, { headers: { Cookie: jar.owner1 } })).text();
    assert.match(ag, /Treasurer&#39;s report|Treasurer's report/);
  });
  await t("board: conflict-of-interest statements are signed from a private link", async () => {
    const start = await req("owner1", "POST", "/api/gov/coi/start", { year: 2026 });
    assert.strictEqual(start.data.created, 5);
    const list = (await req("owner1", "GET", "/api/gov/coi?year=2026")).data;
    const row = list.items[0];
    assert.ok(row.token.length > 20);
    const page = await fetch(BASE + "/coi/" + row.token); assert.strictEqual(page.status, 200); assert.match(await page.text(), /Sign statement/);
    const bad = await fetch(BASE + "/coi/" + row.token, { method: "POST", body: new URLSearchParams({ signedName: "" }), redirect: "manual" });
    assert.strictEqual(bad.status, 400);
    const ok = await fetch(BASE + "/coi/" + row.token, { method: "POST", body: new URLSearchParams({ signedName: row.name, disclosures: "I sit on the board of a likely applicant." }), redirect: "manual" });
    assert.strictEqual(ok.status, 303);
    assert.strictEqual((await fetch(BASE + "/coi/not-a-real-token")).status, 404);
    const after = (await req("owner1", "GET", "/api/gov/coi?year=2026")).data.items.find((x) => x.id === row.id);
    assert.ok(after.signedOn); assert.strictEqual(after.noConflicts, false); assert.match(after.disclosures, /likely applicant/);
  });
  await t("board: Form 990 checklist due dates follow the fiscal year", async () => {
    const tpl = require("../governance").checklistTemplate({ from: "2026-07-01", to: "2027-07-01", label: "FY27" });
    const file = tpl.find((x) => x.itemKey === "file");
    assert.strictEqual(file.dueOn, "2027-11-15", "15th day of the 5th month after a June 30 year-end");
    assert.match(file.detail, /May 15, 2028/, "extension date");
    assert.strictEqual(tpl.find((x) => x.itemKey === "1099").dueOn, "2027-01-31");
    const cal = require("../governance").checklistTemplate({ from: "2026-01-01", to: "2027-01-01", label: "2026" });
    assert.strictEqual(cal.find((x) => x.itemKey === "file").dueOn, "2027-05-15");
    const r = await req("owner1", "POST", "/api/gov/checklist/start", { offset: -1 });
    assert.strictEqual(r.status, 200);
    assert.strictEqual((await req("owner1", "POST", "/api/gov/checklist/start", { offset: -1 })).status, 409);
    const items = (await req("owner1", "GET", "/api/gov/checklist")).data.items;
    assert.strictEqual(items.length, 14);
    await req("owner1", "PATCH", "/api/gov/checklist/" + items[0].id, { doneOn: "2026-11-14" });
  });
  await t("board: policies and the summary of what needs attention", async () => {
    assert.strictEqual((await req("owner1", "POST", "/api/gov/policies/seed", {})).data.created, 7);
    assert.strictEqual((await req("owner1", "POST", "/api/gov/policies/seed", {})).data.created, 0);
    const s = (await req("owner1", "GET", "/api/gov/summary")).data;
    assert.strictEqual(s.members, 5); assert.strictEqual(s.voting, 4);
    assert.strictEqual(s.policiesToReview.length, 7, "none adopted yet");
    assert.strictEqual(s.checklist[0].done, 1); assert.strictEqual(s.checklist[0].total, 14);
    assert.ok(s.nextMeeting && s.nextMeeting.quorumNeeded === 3);
  });
  await t("board: board accounts read governance but can't change it", async () => {
    assert.strictEqual((await req("board2", "GET", "/api/gov/summary")).status, 200);
    assert.strictEqual((await req("board2", "POST", "/api/gov/members", { name: "X" })).status, 403);
    assert.strictEqual((await req("board2", "PATCH", "/api/gov/meetings/" + V.meeting.id, { minutes: "x" })).status, 403);
  });

  await t("reminders: relayed through this app with the status key only", async () => {
    assert.strictEqual((await req("anon", "POST", "/api/admin/reminders/recheck", {})).status, 401);
    assert.strictEqual((await req("anon", "POST", "/api/admin/reminders/nope", {}, { "X-Admin-Token": "test-token" })).status, 404);
  });

  // ---------------- Process Library ----------------
  const P = {};
  await t("library: starter checklists and materials load once", async () => {
    const r = await req("owner1", "GET", "/api/proc/processes");
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.data.items.length, 10);
    P.diag = r.data.items.find((x) => x.name === "Running an InstitutionalOS Diagnostic");
    assert.ok(P.diag && P.diag.steps.length === 10 && P.diag.suggestOn === "pipeline:assessment");
    assert.match(P.diag.docLink, /^https:/, "linked to the runbook");
    const m = (await req("owner1", "GET", "/api/proc/materials")).data.items;
    assert.strictEqual(m.length, 16);
    assert.ok(m.some((x) => x.audience === "client-safe") && m.some((x) => x.audience === "internal"));
    await req("owner1", "DELETE", "/api/proc/materials/" + m[0].id);
    assert.strictEqual((await req("owner1", "GET", "/api/proc/materials")).data.items.length, 15, "removing one doesn't reload the starter set");
    assert.strictEqual((await req("owner1", "GET", "/api/proc/processes")).data.items.length, 10);
  });
  await t("library: a deal at the Diagnostic stage suggests the Diagnostic checklist", async () => {
    const d = await req("owner1", "POST", "/api/pipeline", { name: "Dana Ruiz", org: "Riverside Arts Collective", stage: "assessment" });
    assert.ok(d.status === 200 || d.status === 201, JSON.stringify(d.data));
    const s = (await req("owner1", "GET", "/api/proc/summary")).data;
    P.sugg = s.suggestions.find((x) => x.subjectLabel === "Riverside Arts Collective" && x.processId === P.diag.id);
    assert.ok(P.sugg, JSON.stringify(s.suggestions));
  });
  await t("library: start it, steps get due dates, ticking every step finishes it", async () => {
    const r = await req("owner1", "POST", "/api/proc/start", Object.assign({}, P.sugg, { startedOn: "2026-12-01" }));
    assert.strictEqual(r.status, 201);
    const run = r.data.item;
    assert.strictEqual(run.total, 10); assert.strictEqual(run.steps[0].dueOn, "2026-12-01"); assert.strictEqual(run.steps[5].dueOn, "2026-12-22");
    const s = (await req("owner1", "GET", "/api/proc/summary")).data;
    assert.ok(!s.suggestions.some((x) => x.subjectLabel === "Riverside Arts Collective" && x.processId === P.diag.id), "no longer suggested");
    let last;
    for (let i = 0; i < 10; i++) last = (await req("owner1", "PATCH", "/api/proc/runs/" + run.id, { stepIndex: i, done: true })).data.item;
    assert.ok(last.completedOn, "finished"); assert.ok(last.steps[0].by, "records who ticked it");
    const un = (await req("owner1", "PATCH", "/api/proc/runs/" + run.id, { stepIndex: 3, done: false })).data.item;
    assert.strictEqual(un.completedOn, "", "unticking reopens it");
  });
  await t("library: 'not needed' hides a suggestion; editing steps makes a new version", async () => {
    await req("owner1", "POST", "/api/pipeline", { name: "Sam", org: "Harborview Clinic", stage: "lead" });
    const s = (await req("owner1", "GET", "/api/proc/summary")).data.suggestions.find((x) => x.subjectLabel === "Harborview Clinic");
    assert.ok(s);
    await req("owner1", "POST", "/api/proc/skip", s);
    assert.ok(!(await req("owner1", "GET", "/api/proc/summary")).data.suggestions.some((x) => x.subjectLabel === "Harborview Clinic"));
    const e = await req("owner1", "PATCH", "/api/proc/processes/" + P.diag.id, { steps: "Send the letter (day 0)\nScore the areas (day 21)\nReadout" });
    assert.strictEqual(e.data.item.version, 2);
    assert.deepStrictEqual(e.data.item.steps, [{ text: "Send the letter", days: 0 }, { text: "Score the areas", days: 21 }, { text: "Readout", days: "" }]);
  });
  await t("library: board accounts can read but not start or change checklists", async () => {
    assert.strictEqual((await req("board2", "GET", "/api/proc/summary")).status, 200);
    assert.strictEqual((await req("board2", "POST", "/api/proc/start", { processId: P.diag.id })).status, 403);
  });

  // ---------------- Step automation: internal and external loops ----------------
  const Q = new Pool({ connectionString: DB });
  const AU = {}, CT = {};
  await t("loops: starting a checklist drafts its first message; nothing is sent without approval", async () => {
    const procs = (await req("owner1", "GET", "/api/proc/processes")).data.items;
    AU.lead = procs.find((x) => x.name === "Lead to first call");
    assert.strictEqual(AU.lead.steps[0].message, "lead.reply"); assert.strictEqual(AU.lead.steps[4].auto, "pipe.nextStep");
    const deal = await req("owner1", "POST", "/api/pipeline", { name: "Jordan Hale", org: "Northside Literacy", stage: "lead" });
    AU.deal = deal.data.item || deal.data;
    const r = await req("owner1", "POST", "/api/proc/start", { processId: AU.lead.id, subjectKind: "pipeline", subjectId: AU.deal.id, subjectLabel: "Northside Literacy" });
    assert.strictEqual(r.status, 201); AU.run = r.data.item;
    const out = (await req("owner1", "GET", "/api/proc/outbox")).data;
    const d = out.items.find((m) => m.runId === AU.run.id);
    assert.ok(d, "a draft is waiting"); assert.strictEqual(d.status, "draft"); assert.strictEqual(d.subject, "Thanks for reaching out");
    assert.match(d.body, /Hi Jordan/); assert.match(d.body, /calendly\.com/); assert.match(d.body, /Franklin D\. Parham/);
    assert.strictEqual(out.mail.external, false, "outside delivery not set up in tests");
    assert.strictEqual(out.items.filter((m) => m.status === "sent").length, 0);
    AU.draft = d;
  });
  await t("loops: approve needs an address; adding the contact fills waiting drafts", async () => {
    assert.strictEqual((await req("owner1", "POST", `/api/proc/outbox/${AU.draft.id}/send`, {})).status, 400);
    await req("owner1", "PATCH", "/api/proc/runs/" + AU.run.id, { contactEmail: "jordan@northside.org", contactName: "Jordan Hale" });
    const d = (await req("owner1", "GET", "/api/proc/outbox")).data.items.find((m) => m.id === AU.draft.id);
    assert.strictEqual(d.toEmail, "jordan@northside.org");
    assert.strictEqual((await req("owner1", "POST", `/api/proc/outbox/${AU.draft.id}/send`, {})).status, 409, "system sending is off until the domain is verified");
  });
  await t("loops: approved from my email ticks the step; a dated next step ticks another", async () => {
    assert.strictEqual((await req("owner1", "POST", `/api/proc/outbox/${AU.draft.id}/opened`, {})).status, 200);
    await req("owner1", "PATCH", "/api/pipeline/" + AU.deal.id, { nextStep: "Discovery call", nextStepDate: "2026-12-03" });
    const run = (await req("owner1", "GET", "/api/proc/runs")).data.items.find((x) => x.id === AU.run.id);
    assert.ok(run.steps[0].doneOn && run.steps[0].by === "Automatic", "reply step ticked");
    assert.ok(run.steps[4].doneOn, "next-step step ticked");
    const act = (await req("owner1", "GET", `/api/proc/runs/${AU.run.id}/activity`)).data.items.map((a) => a.text).join(" | ");
    assert.match(act, /Approved by .* and sent from their email/); assert.match(act, /Ticked automatically/);
  });
  await t("loops: a board member's conflict statement: drafted, sent, follow-up after five days, ticks when signed", async () => {
    const mem = (await req("owner1", "POST", "/api/gov/members", { name: "Morgan Reyes", email: "morgan@board.org", role: "member" })).data.item;
    const onboard = (await req("owner1", "GET", "/api/proc/processes")).data.items.find((x) => x.name === "Onboarding a board or staff member");
    const run = (await req("owner1", "POST", "/api/proc/start", { processId: onboard.id, subjectKind: "member", subjectId: mem.id, subjectLabel: "Morgan Reyes" })).data.item;
    assert.ok(run.steps[0].doneOn, "on the board list: ticks itself");
    let out = (await req("owner1", "GET", "/api/proc/outbox")).data.items.filter((m) => m.runId === run.id);
    const coi = out.find((m) => /conflict-of-interest/.test(m.subject));
    assert.ok(coi, JSON.stringify(out.map((m) => m.subject))); assert.strictEqual(coi.toEmail, "morgan@board.org");
    const link = /\/coi\/([\w-]+)/.exec(coi.body); assert.ok(link, "has the private signing link");
    await req("owner1", "POST", `/api/proc/outbox/${coi.id}/opened`, {});
    await Q.query("UPDATE proc_outbox SET sent_at = $1 WHERE id = $2", [new Date(Date.now() - 6 * 864e5).toISOString(), coi.id]);
    out = (await req("owner1", "GET", "/api/proc/outbox")).data.items.filter((m) => m.runId === run.id && m.kind === "reminder");
    assert.strictEqual(out.length, 1); assert.match(out[0].subject, /^Following up:/); assert.strictEqual(out[0].status, "draft");
    const signed = await fetch(BASE + "/coi/" + link[1], { method: "POST", body: new URLSearchParams({ signedName: "Morgan Reyes", noConflicts: "1" }), redirect: "manual" });
    assert.strictEqual(signed.status, 303);
    const after = (await req("owner1", "GET", "/api/proc/runs")).data.items.find((x) => x.id === run.id);
    assert.ok(after.steps[2].doneOn, "signing ticks the step");
  });
  await t("loops: grantee submits the interim report from a private link; the grant checklist ticks", async () => {
    const proc = (await req("owner1", "GET", "/api/proc/processes")).data.items.find((x) => x.name === "Grant award to close");
    const run = (await req("owner1", "POST", "/api/proc/start", { processId: proc.id, subjectKind: "grant", subjectId: G.app.id, subjectLabel: "Eastside Learning Lab" })).data.item;
    assert.strictEqual(run.contactEmail, "dana@eastside.org", "contact filled from the application");
    const d = (await req("owner1", "GET", "/api/gm/applications/" + G.app.id)).data;
    const interim = d.reports.find((x) => x.kind === "interim");
    assert.ok(interim.token, "each report has a private link");
    const page = await fetch(BASE + "/grant-report/" + interim.token); assert.strictEqual(page.status, 200);
    const post = await fetch(BASE + "/grant-report/" + interim.token, { method: "POST", body: new URLSearchParams({ done: "Tutored 64 students.", learned: "Attendance dips in winter.", name: "Dana Ruiz" }), redirect: "manual" });
    assert.strictEqual(post.status, 303);
    const rep = (await req("owner1", "GET", "/api/gm/applications/" + G.app.id)).data.reports.find((x) => x.id === interim.id);
    assert.ok(rep.receivedOn); assert.match(rep.summary, /Tutored 64 students/);
    const after = (await req("owner1", "GET", "/api/proc/runs")).data.items.find((x) => x.id === run.id);
    assert.ok(after.steps[4].doneOn, "interim step ticked");
    assert.strictEqual((await fetch(BASE + "/grant-report/not-a-real-token-1234")).status, 404);
  });
  await t("loops: board accounts can't approve messages", async () => {
    const any = (await req("owner1", "GET", "/api/proc/outbox")).data.items.find((m) => m.status === "draft");
    assert.ok(any);
    assert.strictEqual((await req("board2", "POST", `/api/proc/outbox/${any.id}/opened`, {})).status, 403);
  });

  // ---------- contacts and organizations ----------
  await t("contacts: board members, grantees and run contacts appear once, with their roles", async () => {
    const all = (await req("owner1", "GET", "/api/contacts")).data.items;
    const morgan = all.filter((c) => c.email === "morgan@board.org");
    assert.strictEqual(morgan.length, 1, "one record for Morgan"); assert.ok(morgan[0].roles.includes("board"), JSON.stringify(morgan[0].roles));
    const dana = all.find((c) => c.email === "dana@eastside.org"); assert.ok(dana && dana.roles.includes("grantee"));
    assert.strictEqual((await req("owner1", "GET", "/api/contacts?q=morgan")).data.items.length, 1);
    assert.ok((await req("owner1", "GET", "/api/contacts?role=board")).data.items.every((c) => c.roles.includes("board")));
    const again = (await req("owner1", "GET", "/api/contacts")).data.items.length;
    assert.strictEqual(again, all.length, "syncing twice adds no duplicates");
    CT.morgan = morgan[0]; CT.dana = dana;
  });
  await t("contacts: a person's profile shows board role, checklists, and messages", async () => {
    const d = (await req("owner1", "GET", "/api/contacts/" + CT.morgan.id)).data;
    assert.strictEqual(d.board.length, 1); assert.ok(d.checklists.length >= 1);
    assert.ok(d.messages.some((m) => /conflict-of-interest/.test(m.subject)));
    const g = (await req("owner1", "GET", "/api/contacts/" + CT.dana.id)).data;
    assert.ok(g.grants.length >= 1, "grant shows on the grantee");
  });
  await t("contacts: fixing an email once updates the board record too", async () => {
    await req("owner1", "PATCH", "/api/contacts/" + CT.morgan.id, { email: "morgan.reyes@board.org" });
    const m = (await req("owner1", "GET", "/api/gov/members")).data.items.find((x) => x.name === "Morgan Reyes");
    assert.strictEqual(m.email, "morgan.reyes@board.org");
  });
  await t("contacts: organizations, add a person, merge a duplicate", async () => {
    const org = (await req("owner1", "POST", "/api/orgs", { name: "Riverbend Arts" })).data.item;
    const a = (await req("owner1", "POST", "/api/contacts", { name: "Lee Park", email: "lee@riverbend.org", orgId: org.id })).data.item;
    const b = (await req("owner1", "POST", "/api/contacts", { name: "Lee Park", phone: "555-0100" })).data.item;
    assert.strictEqual((await req("owner1", "POST", `/api/contacts/${a.id}/merge`, { fromId: b.id })).status, 200);
    const merged = (await req("owner1", "GET", "/api/contacts/" + a.id)).data.item;
    assert.strictEqual(merged.phone, "555-0100"); assert.strictEqual(merged.email, "lee@riverbend.org");
    assert.ok(!(await req("owner1", "GET", "/api/contacts?q=lee park")).data.items.some((c) => c.id === b.id), "duplicate gone");
    const o = (await req("owner1", "GET", "/api/orgs/" + org.id)).data;
    assert.ok(o.people.some((p) => p.id === a.id));
    assert.strictEqual((await req("board2", "POST", "/api/contacts", { name: "X" })).status, 403);
  });

  // ---------- Gmail ----------
  await t("gmail: owner saves the Google app keys; others can't", async () => {
    let s = (await req("owner1", "GET", "/api/gmail/status")).data;
    assert.strictEqual(s.configured, false); assert.strictEqual(s.redirectUri, BASE + "/oauth/google/callback");
    assert.strictEqual((await req("owner1", "POST", "/api/gmail/config", { clientId: "nope", clientSecret: "x" })).status, 400);
    assert.strictEqual((await req("board2", "POST", "/api/gmail/config", { clientId: "1-abc.apps.googleusercontent.com", clientSecret: "secret-123456" })).status, 403);
    assert.strictEqual((await req("owner1", "POST", "/api/gmail/config", { clientId: "1-abc.apps.googleusercontent.com", clientSecret: "secret-123456" })).status, 200);
    s = (await req("owner1", "GET", "/api/gmail/status")).data; assert.strictEqual(s.configured, true);
    const raw = (await Q.query("SELECT value FROM app_settings WHERE key = 'google_client_secret'")).rows[0].value;
    assert.ok(!/secret-123456/.test(raw), "secret is stored encrypted");
  });
  await t("gmail: connect an account; Send-as addresses are picked up", async () => {
    const st = await req("owner1", "GET", "/oauth/google/start");
    assert.strictEqual(st.status, 302);
    const loc = new URL(st.headers.get("location"));
    assert.strictEqual(loc.origin + loc.pathname, GURL + "/auth"); assert.match(loc.searchParams.get("scope"), /gmail\.send/);
    const bad = await req("owner1", "GET", "/oauth/google/callback?code=good-code&state=wrong");
    assert.match(decodeURIComponent(bad.headers.get("location")), /didn't match/);
    const st2 = await req("owner1", "GET", "/oauth/google/start");
    const state = new URL(st2.headers.get("location")).searchParams.get("state");
    const cb = await req("owner1", "GET", "/oauth/google/callback?code=good-code&state=" + state);
    assert.strictEqual(cb.status, 303); assert.match(decodeURIComponent(cb.headers.get("location")), /connected owner@gmail\.test/);
    const s = (await req("owner1", "GET", "/api/gmail/status")).data;
    assert.strictEqual(s.accounts.length, 1);
    assert.deepStrictEqual(s.accounts[0].sendAs.map((x) => x.email).sort(), ["franklin@biz.test", "owner@gmail.test"], "unverified alias left out");
    assert.strictEqual(s.sender.from, "franklin@biz.test", "the account's default Send-as address is used");
    assert.strictEqual((await req("owner1", "POST", "/api/gmail/default", { account: "owner@gmail.test", from: "someone@else.test" })).status, 400);
  });
  await t("gmail: approving sends from the business address; follow-up stays in the thread; a reply is noticed", async () => {
    const mem = (await req("owner1", "POST", "/api/gov/members", { name: "Avery Cole", email: "avery@board.org", role: "member" })).data.item;
    const onboard = (await req("owner1", "GET", "/api/proc/processes")).data.items.find((x) => x.name === "Onboarding a board or staff member");
    const run = (await req("owner1", "POST", "/api/proc/start", { processId: onboard.id, subjectKind: "member", subjectId: mem.id, subjectLabel: "Avery Cole" })).data.item;
    let out = (await req("owner1", "GET", "/api/proc/outbox")).data;
    assert.strictEqual(out.mail.via, "gmail"); assert.strictEqual(out.mail.from, "franklin@biz.test");
    const coi = out.items.find((m) => m.runId === run.id && /conflict-of-interest/.test(m.subject));
    const sent = await req("owner1", "POST", `/api/proc/outbox/${coi.id}/send`, {});
    assert.strictEqual(sent.status, 200, JSON.stringify(sent.data)); assert.strictEqual(sent.data.via, "gmail");
    const first = MOCK.sends[MOCK.sends.length - 1];
    assert.match(first.raw, /^From: Franklin Parham <franklin@biz\.test>/m); assert.match(first.raw, /^To: avery@board\.org/m);
    assert.strictEqual(MOCK.sends.length, 1, "only the approved message went out");
    await Q.query("UPDATE proc_outbox SET sent_at = $1 WHERE id = $2", [new Date(Date.now() - 6 * 864e5).toISOString(), coi.id]);
    out = (await req("owner1", "GET", "/api/proc/outbox")).data.items.filter((m) => m.runId === run.id && m.kind === "reminder" && m.status === "draft");
    assert.strictEqual(out.length, 1, "follow-up drafted, waiting for approval");
    assert.strictEqual(MOCK.sends.length, 1, "follow-up not sent on its own");
    await req("owner1", "POST", `/api/proc/outbox/${out[0].id}/send`, {});
    const fu = MOCK.sends[MOCK.sends.length - 1];
    assert.strictEqual(fu.threadId, "t1", "same thread"); assert.match(fu.raw, /^In-Reply-To: <m1@mail\.test>/m);
    MOCK.threads.t1.push({ id: "r1", internalDate: String(Date.now()), payload: { headers: [{ name: "From", value: "Avery Cole <avery@board.org>" }] } });
    const tick = await req("anon", "POST", "/api/admin/tick?markNotified=1", null, { "X-Admin-Token": "test-token" });
    assert.strictEqual(tick.status, 200); assert.ok(tick.data.gmail.replies >= 1, JSON.stringify(tick.data)); assert.ok(tick.data.repliesLastDay >= 1);
    const after = (await req("owner1", "GET", "/api/proc/outbox")).data.items.find((m) => m.id === coi.id);
    assert.ok(after.repliedAt); assert.match(after.replyFrom, /avery@board\.org/);
    const act = (await req("owner1", "GET", `/api/proc/runs/${run.id}/activity`)).data.items.map((a) => a.text).join(" | ");
    assert.match(act, /Reply received from Avery Cole/);
    const sum = (await req("owner1", "GET", "/api/proc/summary")).data;
    assert.ok(sum.replies.some((r) => r.runId === run.id));
  });
  await t("tick: needs a key; reports only new drafts since the last notice", async () => {
    assert.strictEqual((await req("anon", "POST", "/api/admin/tick", null)).status, 401);
    const t2 = (await req("anon", "POST", "/api/admin/tick?markNotified=1", null, { "X-Admin-Token": "test-token" })).data;
    assert.strictEqual(t2.newSinceLastNotice, 0); assert.ok(t2.waiting >= 1);
  });
  await t("gmail: disconnect goes back to opening in my email", async () => {
    assert.strictEqual((await req("owner1", "POST", "/api/gmail/disconnect", { account: "owner@gmail.test" })).status, 200);
    const out = (await req("owner1", "GET", "/api/proc/outbox")).data;
    assert.notStrictEqual(out.mail.via, "gmail");
    assert.strictEqual((await req("owner1", "GET", "/api/gmail/status")).data.accounts.length, 0);
  });
  await Q.end();
  mock.close();

  srv.kill();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
