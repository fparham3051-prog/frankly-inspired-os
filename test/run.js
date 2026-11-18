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
  const MOCK = { sends: [], threads: {}, port: 0, ai: [], inbox: [], from: {}, siteNotes: null, meet: {} };
  const mock = http.createServer((q, r) => {
    let body = ""; q.on("data", (d) => (body += d)); q.on("end", () => {
      const u = new URL(q.url, "http://x"), json = (o, st) => { r.writeHead(st || 200, { "Content-Type": "application/json" }); r.end(JSON.stringify(o)); };
      if (u.pathname === "/token") { const f = new URLSearchParams(body); return json(f.get("grant_type") === "authorization_code" ? (f.get("code") === "good-code" ? { access_token: "at1", refresh_token: "rt1", expires_in: 3600, scope: "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/drive.file" } : { error: "invalid_grant" }) : { access_token: "at2", expires_in: 3600 }, f.get("code") === "bad" ? 400 : 200); }
      if (u.pathname === "/revoke") return json({});
      // Stand-in for the website server: the AI relay and field notes.
      if (u.pathname.startsWith("/api/admin/") && q.headers["x-reminder-secret"] !== "ws") return json({ ok: false }, 401);
      if (u.pathname === "/api/admin/ai" && q.method === "GET") return json({ ok: true, configured: true, model: "test-model" });
      if (u.pathname === "/api/admin/ai") {
        const j = JSON.parse(body), parts = j.messages[0].content, text = parts.map((x) => x.text || "").join("\n");
        MOCK.ai.push({ system: j.system, text, parts });
        const out = (o) => json({ ok: true, text: typeof o === "string" ? o : JSON.stringify(o) });
        if (/A new lead came in/.test(text)) return out({ brief: { who: "Program director at a youth org", read: "Scored revenue lowest.", likelyConstraint: "Revenue concentration", nextStep: "Offer a call", fit: "strong" }, reply: { subject: "Thanks for reaching out", body: "Hi Riley,\n\nThanks for taking the check-up." } });
        if (/Draft one new field note/.test(text)) return out({ title: "When the waitlist grows faster than staff", signal: "A growing waitlist.", assumption: "We need more funding.", constraint: "Intake process capacity.", evidence: "Time from inquiry to service.", action: "Map intake steps and time them.", trigger: "strain" });
        if (/pre-call brief/.test(text)) return out({ headline: "Northside Arts, discovery call", numbers: ["Revenue $1.2M"], heard: "Board is worried.", likelyConstraint: "Founder dependence", questions: ["Q1", "Q2", "Q3"], goal: "Agree on a Diagnostic", watchFor: "Budget timing" });
        if (/call notes into records/.test(text)) return out({ summary: "Talked about board strain.", stage: "assessment", nextStep: "Send Diagnostic proposal", nextStepDate: "2030-01-15", trigger: "founder", problem: { presentingProblem: "Board disengaged", verifiedConstraint: "Founder holds all relationships", differs: true, atStake: "Succession", whoPays: "Board", orgType: "Arts", orgSize: "$1M" }, followUp: { subject: "Good talking today", body: "Thanks for the time today." } });
        if (/Someone replied/.test(text)) return out({ kind: "scheduling", summary: "Wants to meet next Tuesday", answer: { subject: "Re: time", body: "Tuesday works." } });
        if (/Read the attached documents/.test(text)) return out({ areas: [{ key: "revenue", score: 42, confidence: "medium", evidence: ["990 p.1: revenue fell 20%"], missing: "Audit" }], constraint: { area: "revenue", name: "Revenue concentration", why: "One funder is 60%.", evidenceFor: ["990"], evidenceAgainst: [], confidence: "medium" }, memo: "Draft memo.", plan: [{ action: "Diversify", owner: "ED", week: 4, evidence: "Two new funders" }], questions: ["Q?"] });
        if (/First read of a grant application/.test(text)) return out({ summary: "Solid youth program.", criteria: [{ criterion: "Impact", assessment: "Clear outcomes", rating: "strong" }], strengths: ["Track record"], concerns: [], questions: ["Budget?"], lean: "advance", leanReason: "Fits the program." });
        if (/Summarize a grantee/.test(text)) return out({ summary: "On track.", outcomes: ["120 youth served"], risks: [], followUp: "" });
        if (/Draft board meeting minutes/.test(text)) return out("MINUTES OF THE BOARD\nCalled to order [confirm].");
        if (/^Question:/m.test(text)) return out("You have 1 deal in Lead.");
        return out({});
      }
      if (u.pathname === "/api/admin/field-notes") { MOCK.siteNotes = JSON.parse(body).notes; return json({ ok: true, count: MOCK.siteNotes.length }); }
      if (q.headers.authorization === "Bearer at1" || q.headers.authorization === "Bearer at2") {
        const SH = MOCK.sheet;
        if (u.pathname === "/v4/spreadsheets" && q.method === "POST") {
          const j = JSON.parse(body); MOCK.sheet = { id: "s1", tabs: j.sheets.map((x, i) => ({ title: x.properties.title, sheetId: i })), values: {}, perms: [], creates: ((SH && SH.creates) || 0) + 1 };
          return json({ spreadsheetId: "s1", spreadsheetUrl: "https://docs.google.com/spreadsheets/d/s1/edit", sheets: MOCK.sheet.tabs.map((t) => ({ properties: t })) });
        }
        if (SH && u.pathname === "/v4/spreadsheets/s1" && q.method === "GET") return json({ spreadsheetId: "s1", spreadsheetUrl: "https://docs.google.com/spreadsheets/d/s1/edit", sheets: SH.tabs.map((t) => ({ properties: t })) });
        if (SH && u.pathname === "/v4/spreadsheets/s1:batchUpdate") {
          const replies = JSON.parse(body).requests.map((r) => { if (!r.addSheet) return {}; const t = { title: r.addSheet.properties.title, sheetId: SH.tabs.length }; SH.tabs.push(t); return { addSheet: { properties: t } }; });
          return json({ replies });
        }
        if (SH && u.pathname === "/v4/spreadsheets/s1/values:batchClear") { SH.values = {}; return json({}); }
        if (SH && u.pathname.startsWith("/v4/spreadsheets/s1/values/") && q.method === "PUT") {
          const range = decodeURIComponent(u.pathname.split("/values/")[1]), tab = /^'(.+)'!/.exec(range)[1];
          SH.values[tab] = (SH.values[tab] || []).concat(JSON.parse(body).values); return json({});
        }
        if (SH && u.pathname === "/drive/v3/files/s1/permissions") { SH.perms.push(JSON.parse(body)); return json({ id: "p" + SH.perms.length }); }
      }
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
      if (u.pathname === "/gmail/v1/users/me/messages" && q.method === "GET" && /gemini-notes/.test(u.searchParams.get("q") || "")) return json({ messages: Object.keys(MOCK.meet).map((id) => ({ id })) });
      if ((m = /^\/gmail\/v1\/users\/me\/messages\/(\w+)$/.exec(u.pathname)) && MOCK.meet[m[1]]) { const x = MOCK.meet[m[1]]; return json({ id: m[1], internalDate: String(Date.now()), payload: { mimeType: "text/plain", body: { data: Buffer.from(x.text).toString("base64url") }, headers: [{ name: "From", value: x.from }, { name: "Subject", value: x.subject }] } }); }
      if (u.pathname === "/gmail/v1/users/me/messages" && q.method === "GET") return json({ messages: MOCK.inbox.map((id) => ({ id })) });
      if ((m = /^\/gmail\/v1\/users\/me\/messages\/(\w+)$/.exec(u.pathname))) return json({ id: m[1], snippet: "Could we talk Tuesday?", payload: { mimeType: "text/plain", body: { data: Buffer.from("Could we talk Tuesday?\n\nOn Mon someone wrote:\n> old").toString("base64url") }, headers: [{ name: "Message-ID", value: "<" + m[1] + "@mail.test>" }].concat(MOCK.from[m[1]] ? [{ name: "From", value: MOCK.from[m[1]] }] : []) } });
      if ((m = /^\/gmail\/v1\/users\/me\/threads\/(\w+)$/.exec(u.pathname))) return json({ id: m[1], messages: MOCK.threads[m[1]] || [] });
      json({ error: { message: "not found" } }, 404);
    });
  });
  await new Promise((ok) => mock.listen(0, ok)); MOCK.port = mock.address().port;
  const GURL = "http://localhost:" + MOCK.port;
  const env = Object.assign({}, process.env, { GOOGLE_AUTH_URL: GURL + "/auth", GOOGLE_TOKEN_URL: GURL + "/token", GOOGLE_REVOKE_URL: GURL + "/revoke", GMAIL_API_BASE: GURL, WEBSITE_API_URL: GURL, WEBSITE_ADMIN_SECRET: "ws", SHEETS_API_BASE: GURL, DRIVE_API_BASE: GURL, PUBLIC_URL: BASE + "/" }, { PORT: String(PORT), DATABASE_URL: DB, ADMIN_PASSWORD: "practice-pw", ADMIN_API_TOKEN: "test-token", SESSION_SECRET: "test-secret", GRANTPASS_INTEGRATION_KEY: "", LOGIN_MAX_ATTEMPTS: "1000", HUB_MIRROR_MS: "0" });
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
    assert.strictEqual(r.data.items.length, 11);
    P.diag = r.data.items.find((x) => x.name === "Running an InstitutionalOS Diagnostic");
    assert.ok(P.diag && P.diag.steps.length === 10 && P.diag.suggestOn === "pipeline:assessment");
    assert.match(P.diag.docLink, /^https:/, "linked to the runbook");
    const m = (await req("owner1", "GET", "/api/proc/materials")).data.items;
    assert.strictEqual(m.length, 16);
    assert.ok(m.some((x) => x.audience === "client-safe") && m.some((x) => x.audience === "internal"));
    await req("owner1", "DELETE", "/api/proc/materials/" + m[0].id);
    assert.strictEqual((await req("owner1", "GET", "/api/proc/materials")).data.items.length, 15, "removing one doesn't reload the starter set");
    assert.strictEqual((await req("owner1", "GET", "/api/proc/processes")).data.items.length, 11);
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
  await t("setup: the System setup checklist started on its own, dated, and ticks what the system can see", async () => {
    const run = (await req("owner1", "GET", "/api/proc/runs")).data.items.find((x) => x.processName === "System setup");
    assert.ok(run, "started automatically"); assert.strictEqual(run.steps.length, 18);
    assert.ok(run.steps.every((x) => x.dueOn), "every step has a date");
    assert.ok(run.steps[0].doneOn && run.steps[0].by === "Automatic", "Gmail connected ticks step 1");
    assert.ok(run.steps[2].doneOn, "a message sent through Gmail ticks the test-message step");
    assert.strictEqual((await req("owner1", "GET", "/api/proc/processes")).data.items.filter((x) => x.name === "System setup").length, 1);
  });
  await t("report: prospect report to Google Sheets: every tab, refresh reuses the sheet, share, CSV fallback, setup step ticks", async () => {
    await req("owner1", "POST", "/api/prospects", { name: "Taylor Brooks", org: "Harbor Youth", source: "website pop-up", notes: "Email: taylor@harbor.org" });
    const before = (await req("owner1", "GET", "/api/reports/prospects")).data;
    assert.ok(before.google && before.google.sheets, JSON.stringify(before.google)); assert.strictEqual(before.sheet, null);
    const titles = before.tabs.map((x) => x.title);
    for (const tname of ["Summary", "Website leads", "All prospects", "Pipeline", "Diagnostics", "DMV market scan", "Contacts", "Grant applicants", "Donors"]) assert.ok(titles.includes(tname), tname);
    assert.strictEqual((await req("board2", "POST", "/api/reports/prospects/sheet", {})).status, 403);
    const made = await req("owner1", "POST", "/api/reports/prospects/sheet", {});
    assert.strictEqual(made.status, 200, JSON.stringify(made.data)); assert.match(made.data.url, /docs\.google\.com/);
    const web = MOCK.sheet.values["Website leads"];
    assert.strictEqual(web[0][0], "Date"); assert.ok(web.some((r) => r.includes("taylor@harbor.org")), "pop-up lead with its email");
    assert.ok(MOCK.sheet.values["Summary"].some((r) => r[0] === "Internal"));
    assert.ok(MOCK.sheet.values["Contacts"].length > 1);
    await req("owner1", "POST", "/api/reports/prospects/sheet", {});
    assert.strictEqual(MOCK.sheet.creates, 1, "refresh updates the same sheet");
    assert.strictEqual((await req("owner1", "POST", "/api/reports/prospects/share", { emails: "not-an-email" })).status, 400);
    const sh = await req("owner1", "POST", "/api/reports/prospects/share", { emails: "teammate@frankly.test, second@frankly.test", role: "reader" });
    assert.strictEqual(sh.status, 200); assert.strictEqual(MOCK.sheet.perms.length, 2); assert.strictEqual(MOCK.sheet.perms[0].role, "reader");
    const csv = await fetch(BASE + "/api/reports/prospects.csv?tab=Website%20leads", { headers: { Cookie: jar.owner1 } });
    assert.strictEqual(csv.status, 200); assert.match(await csv.text(), /taylor@harbor\.org/);
    const run = (await req("owner1", "GET", "/api/proc/runs")).data.items.find((x) => x.processName === "System setup");
    assert.ok(run.steps[5].doneOn, "creating the sheet ticks the setup step");
  });
  // ---------- AI assistance ----------
  await t("ai: status shows ready through the website relay; board can't run AI actions", async () => {
    const st = (await req("owner1", "GET", "/api/ai/status")).data;
    assert.strictEqual(st.ready, true, JSON.stringify(st)); assert.strictEqual(st.relay.model, "test-model");
    assert.strictEqual((await req("board2", "POST", "/api/ai/ask", { question: "How many deals?" })).status, 403);
  });
  await t("ai 1: a new website lead gets a brief and a first-reply draft waiting for approval (nothing sent)", async () => {
    const sends = MOCK.sends.length;
    const p = (await req("owner1", "POST", "/api/prospects", { name: "Riley Shaw", org: "Eastgate Youth", source: "assessment tool", notes: "Email: riley@eastgate.org\nTool: Health Index\nComposite score: 48" })).data;
    const pid = (p.item || p).id;
    await req("anon", "POST", "/api/admin/tick", null, { "X-Admin-Token": "test-token" });
    const row = (await req("owner1", "GET", "/api/state")).data.prospects.find((x) => x.id === pid);
    assert.ok(row.aiBrief && row.aiBrief.fit === "strong", JSON.stringify(row.aiBrief));
    const call = MOCK.ai.find((c) => /A new lead came in/.test(c.text) && /Eastgate/.test(c.text));
    assert.ok(call && /Composite score: 48/.test(call.text), "the brief is built from what they sent"); assert.match(call.system, /Never invent facts/);
    const d = (await req("owner1", "GET", "/api/proc/outbox")).data.items.find((m) => m.subjectId === pid && m.status === "draft");
    assert.ok(d && d.ai && d.toEmail === "riley@eastgate.org" && d.purpose === "First reply (AI draft)", JSON.stringify(d));
    assert.match(d.body, /Thanks for taking the check-up/);
    assert.strictEqual(MOCK.sends.length, sends, "nothing sent on its own");
    await req("owner1", "POST", "/api/ai/lead/" + pid, {});
    const drafts = (await req("owner1", "GET", "/api/proc/outbox")).data.items.filter((m) => m.subjectId === pid && m.status === "draft");
    assert.strictEqual(drafts.length, 1, "a new draft replaces the old one");
  });
  await t("ai 5: a reply is read, summarized, and answered in the same thread after approval", async () => {
    const out = (await req("owner1", "GET", "/api/proc/outbox")).data.items;
    const first = out.find((m) => m.replySummary);
    assert.ok(first, "the reply from the Gmail test was classified"); assert.strictEqual(first.replyKind, "scheduling"); assert.strictEqual(first.replySummary, "Wants to meet next Tuesday");
    const ans = out.find((m) => m.kind === "reply" && m.status === "draft");
    assert.ok(ans && ans.ai && ans.toEmail === "avery@board.org", JSON.stringify(ans));
    const call = MOCK.ai.find((c) => /Someone replied/.test(c.text));
    assert.match(call.text, /Could we talk Tuesday\?/); assert.ok(!/old/.test(call.text.split("Their reply")[1]), "quoted earlier message cut off");
    const r = await req("owner1", "POST", `/api/proc/outbox/${ans.id}/send`, {});
    assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    const last = MOCK.sends[MOCK.sends.length - 1];
    assert.strictEqual(last.threadId, "t1"); assert.match(last.raw, /^In-Reply-To: <r1@mail\.test>/m);
    const sum = (await req("owner1", "GET", "/api/proc/summary")).data;
    assert.ok(sum.replies.some((x) => x.summary === "Wants to meet next Tuesday"));
  });
  await t("ai 2: field note drafted, published to the website, emailed to subscribers with one approval; unsubscribe works", async () => {
    const n = (await req("owner1", "POST", "/api/ai/field-notes/draft", {})).data.item;
    assert.strictEqual(n.status, "draft"); assert.strictEqual(n.trigger, "strain");
    const call = MOCK.ai.find((c) => /Draft one new field note/.test(c.text));
    assert.ok(!/Northside|Harbor|Eastgate/.test(call.text), "no organization names go into the field note prompt");
    assert.strictEqual((await req("owner1", "POST", `/api/ai/field-notes/${n.id}/email`, {})).status, 409, "must publish first");
    await req("owner1", "PATCH", "/api/ai/field-notes/" + n.id, { title: "When the waitlist outgrows the staff" });
    const pub = (await req("owner1", "POST", `/api/ai/field-notes/${n.id}/publish`, {})).data;
    assert.ok(pub.site.pushed, JSON.stringify(pub)); assert.strictEqual(MOCK.siteNotes[0].title, "When the waitlist outgrows the staff");
    const list = (await req("owner1", "GET", "/api/ai/field-notes")).data;
    assert.strictEqual(list.subscribers, 1, "Taylor from the pop-up");
    const em = (await req("owner1", "POST", `/api/ai/field-notes/${n.id}/email`, {})).data;
    assert.strictEqual(em.recipients, 1);
    const b = (await req("owner1", "GET", "/api/proc/outbox")).data.items.find((m) => m.id === em.outboxId);
    assert.strictEqual(b.kind, "broadcast"); assert.strictEqual(b.recipientCount, 1); assert.match(b.body, /Reply "unsubscribe"/);
    const before = MOCK.sends.length;
    const sent = await req("owner1", "POST", `/api/proc/outbox/${b.id}/send`, {});
    assert.strictEqual(sent.status, 200, JSON.stringify(sent.data)); assert.strictEqual(sent.data.sent, 1);
    assert.strictEqual(MOCK.sends.length, before + 1); assert.match(MOCK.sends[MOCK.sends.length - 1].raw, /^To: taylor@harbor\.org/m);
    const rawB = MOCK.sends[MOCK.sends.length - 1].raw.split("\r\n\r\n").slice(1).join("").replace(/\s+/g, "");
    assert.match(Buffer.from(rawB, "base64").toString("utf8"), /Hi Taylor,/);
    MOCK.inbox.push("u1"); MOCK.from.u1 = "Taylor Brooks <taylor@harbor.org>";
    await req("anon", "POST", "/api/admin/tick", null, { "X-Admin-Token": "test-token" });
    assert.strictEqual((await req("owner1", "GET", "/api/ai/field-notes")).data.subscribers, 0, "unsubscribed");
  });
  await t("ai 6 + 4: pre-call brief, then call notes become records and a follow-up draft", async () => {
    const deal = (await req("owner1", "POST", "/api/pipeline", { name: "Northside Arts", org: "Northside Arts", stage: "discovery", nextStep: "Discovery call", nextStepDate: new Date().toISOString().slice(0, 10) })).data;
    const id = (deal.item || deal).id;
    await req("owner1", "POST", "/api/contacts", { name: "Jamie Cole", email: "jamie@northside.org", orgId: (await req("owner1", "POST", "/api/orgs", { name: "Northside Arts" })).data.item.id });
    await req("anon", "POST", "/api/admin/tick", null, { "X-Admin-Token": "test-token" });
    let d = (await req("owner1", "GET", "/api/ai/deal/" + id)).data;
    assert.ok(d.precall && d.precall.questions.length === 3, "brief written the day of the call");
    assert.ok((await req("owner1", "GET", "/api/proc/summary")).data.precalls.some((x) => x.id === id), "shows on Today");
    const prop = (await req("owner1", "POST", `/api/ai/call-notes/${id}`, { notes: "Board chair says they are disengaged; founder holds every funder relationship. Agreed to look at a Diagnostic." })).data;
    assert.strictEqual(prop.stage, "assessment"); assert.strictEqual(prop.contact.email, "jamie@northside.org");
    const ap = (await req("owner1", "POST", `/api/ai/call-notes/${id}/apply`, prop)).data;
    assert.ok(ap.problemId && ap.outboxId, JSON.stringify(ap));
    const row = (await req("owner1", "GET", "/api/state")).data.pipeline.find((x) => x.id === id);
    assert.strictEqual(row.stage, "assessment"); assert.strictEqual(row.nextStepDate, "2030-01-15"); assert.match(row.notes, /call: Talked about board strain/);
    const fu = (await req("owner1", "GET", "/api/proc/outbox")).data.items.find((m) => m.id === ap.outboxId);
    assert.strictEqual(fu.toEmail, "jamie@northside.org"); assert.strictEqual(fu.status, "draft");
    CT.deal = id;
  });
  await t("ai 3: Diagnostic first pass reads uploaded documents and stores the result (documents not kept)", async () => {
    const files = [{ name: "990-2024.pdf", type: "application/pdf", data: Buffer.from("%PDF-1.4 fake").toString("base64") }, { name: "budget.txt", type: "text/plain", data: Buffer.from("Total revenue 1,200,000").toString("base64") }];
    const r = await req("owner1", "POST", `/api/ai/diagnostic/${CT.deal}`, { files, context: "Board retreat in March" });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data)); assert.strictEqual(r.data.constraint.name, "Revenue concentration");
    const call = MOCK.ai.find((c) => /Read the attached documents/.test(c.text));
    assert.ok(call.parts.some((p) => p.type === "document" && p.source.media_type === "application/pdf"), "PDF sent as a document");
    assert.ok(call.parts.some((p) => /Total revenue 1,200,000/.test(p.text || "")), "text file included");
    const d = (await req("owner1", "GET", "/api/ai/deal/" + CT.deal)).data;
    assert.deepStrictEqual(d.diagnostic.docs, ["990-2024.pdf", "budget.txt"]);
    assert.ok(!JSON.stringify(d.diagnostic).includes("ZmFrZQ"), "document contents not stored");
    assert.strictEqual((await req("owner1", "POST", `/api/ai/diagnostic/${CT.deal}`, { files: [] })).status, 400);
  });
  await t("ai 7: grant first read, minutes draft; ai 8: ask the system", async () => {
    const apps = (await req("owner1", "GET", "/api/gm/applications")).data.items;
    const g = (await req("owner1", "POST", "/api/ai/grant-read/" + apps[0].id, {})).data;
    assert.strictEqual(g.lean, "advance");
    assert.strictEqual((await req("owner1", "GET", "/api/ai/grant-read/" + apps[0].id)).data.read.lean, "advance");
    const mt = (await req("owner1", "GET", "/api/gov/meetings")).data.items[0];
    const mn = (await req("owner1", "POST", "/api/ai/minutes/" + mt.id, { notes: "Chair opened at 6. Treasurer reported. Motion to approve budget passed." })).data;
    assert.match(mn.minutes, /MINUTES/);
    const a = (await req("owner1", "POST", "/api/ai/ask", { question: "How many deals are in Lead?" })).data;
    assert.strictEqual(a.answer, "You have 1 deal in Lead.");
    const call = MOCK.ai.find((c) => /^Question:/m.test(c.text));
    assert.match(call.text, /Northside Arts/); assert.match(call.system || "", /ONLY the data provided/);
  });
  await t("ai: daily limit stops new requests with a clear message", async () => {
    await Q.query("INSERT INTO app_settings (key, value) VALUES ('ai_usage', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [JSON.stringify({ date: new Date().toISOString().slice(0, 10), calls: 150 })]);
    const r = await req("owner1", "POST", "/api/ai/ask", { question: "Anything?" });
    assert.strictEqual(r.status, 429); assert.match(r.data.error, /limit/);
    await Q.query("DELETE FROM app_settings WHERE key = 'ai_usage'");
  });
  await t("weekly: last week's numbers fill themselves in, the brief flags issues, the meeting records a decision", async () => {
    const W = require("../weekly");
    const wk = W.lastWeek(), b = W.bounds(wk), mid = new Date(Date.parse(b.fromTs) + 2 * 864e5).toISOString(), day = wk.slice(0, 8) + String(Number(wk.slice(8)) + 0).padStart(2, "0");
    const midDay = mid.slice(0, 10);
    await Q.query("INSERT INTO prospects (id, name, org, source, status, created_at) VALUES ('wk-p1','A','Org A','referral','new',$1), ('wk-p2','B','Org B','linkedin','new',$1), ('wk-p3','C','Org C','market-scan','new',$1)", [mid]);
    await Q.query("INSERT INTO pipeline (id, name, org, source, stage, created_at, updated_at, next_step_date) VALUES ('wk-d1','D','Org D','Prospecting: referral','lead',$1,$1,'2000-01-01')", [mid]);
    await Q.query("UPDATE pipeline SET stage = 'engaged' WHERE id = 'wk-d1'");
    const ev = (await Q.query("SELECT * FROM pipeline_stage_events WHERE pipeline_id = 'wk-d1' ORDER BY id")).rows;
    assert.deepStrictEqual(ev.map((e) => e.to_stage), ["lead", "engaged"], "the database records stage changes");
    await Q.query("UPDATE pipeline_stage_events SET at = $1 WHERE pipeline_id = 'wk-d1'", [mid]);
    await Q.query("INSERT INTO encounters (id, pipeline_id, occurred_at, created_at) VALUES ('wk-e1','wk-d1',$1,$2), ('wk-e2','wk-d1',$1,$2)", [midDay, mid]);
    await Q.query("INSERT INTO invoices (id, pipeline_id, amount, issued_date, due_date, paid_date, status, created_at) VALUES ('wk-i1','wk-d1',4500,$1,$1,$1,'paid',$2), ('wk-i2','wk-d1',1200,$1,'2000-01-01','','sent',$2)", [midDay, mid]);
    const br = (await req("owner1", "GET", "/api/weekly/brief")).data;
    assert.strictEqual(br.weekOf, wk);
    assert.strictEqual(br.numbers.leads, 2, "research imports are not leads; promoted deals are not double counted");
    assert.strictEqual(br.numbers.referrals, 1); assert.strictEqual(br.numbers.calls, 2); assert.strictEqual(br.numbers.won, 1);
    assert.strictEqual(br.numbers.revenueBooked, 5700); assert.strictEqual(br.numbers.revenueCollected, 4500);
    assert.strictEqual(br.scorecard.auto, true); assert.strictEqual(br.scorecard.confirmed, false);
    assert.ok(br.flags.some((f) => /overdue/.test(f.text) && /\$1,200/.test(f.text)), JSON.stringify(br.flags));
    assert.ok(br.suggestions.some((x) => /overdue invoices/.test(x)));
    // Confirm with a correction; the system never overwrites it afterwards.
    const cf = (await req("owner1", "POST", "/api/weekly/confirm", Object.assign({}, br.numbers, { weekOf: wk, calls: 3 }))).data;
    assert.strictEqual(cf.scorecard.confirmed, true); assert.strictEqual(cf.numbers.calls, 3);
    await W.fillWeek(Q, wk);
    const sc = (await req("owner1", "GET", "/api/state")).data.scorecard.filter((x) => x.weekOf === wk);
    assert.strictEqual(sc.length, 1); assert.strictEqual(sc[0].calls, 3); assert.ok(sc[0].confirmedAt);
    // Today shows the brief until the meeting is closed.
    assert.deepStrictEqual((await req("owner1", "GET", "/api/proc/summary")).data.weekly, { weekOf: wk, ready: true, held: false });
    const is = (await req("owner1", "POST", "/api/issues", { title: br.suggestions[0], detail: "" })).data;
    assert.strictEqual((await req("owner1", "POST", "/api/weekly/decision", { weekOf: wk, decision: "" })).status, 400);
    const d = (await req("owner1", "POST", "/api/weekly/decision", { weekOf: wk, decision: "Call Org D about the invoice by Wednesday.", issueId: is.id })).data;
    assert.ok(d.heldAt); assert.strictEqual(d.issueId, is.id);
    assert.strictEqual((await req("owner1", "GET", "/api/proc/summary")).data.weekly.held, true);
    assert.match((await req("owner1", "GET", "/api/weekly/history")).data.items[0].decision, /Org D/);
    assert.strictEqual((await W.tick(Q)).status, "held", "a closed meeting isn't rebuilt");
  });
  await t("tick: needs a key; reports only new drafts since the last notice", async () => {
    assert.strictEqual((await req("anon", "POST", "/api/admin/tick", null)).status, 401);
    await req("anon", "POST", "/api/admin/tick?markNotified=1", null, { "X-Admin-Token": "test-token" });
    const t2 = (await req("anon", "POST", "/api/admin/tick?markNotified=1", null, { "X-Admin-Token": "test-token" })).data;
    assert.strictEqual(t2.newSinceLastNotice, 0); assert.ok(t2.waiting >= 1);
  });
  await t("meetings: note-taker summaries are matched to the deal, proposed, applied, and counted; private ones skipped", async () => {
    MOCK.meet.mt1 = { from: "Google Meet <gemini-notes@google.com>", subject: "Notes: Northside Arts strategy call", text: "Summary: Jamie said the board is disengaged and the founder holds every funder relationship. Next: send a Diagnostic proposal by Friday." };
    MOCK.meet.mt2 = { from: "Google Meet <gemini-notes@google.com>", subject: "Notes: Coaching session with Sam", text: "Personal matters." };
    MOCK.meet.mt3 = { from: "Zoom <no-reply@zoom.us>", subject: "Your cloud recording is available", text: "Recording link." };
    const r = (await req("owner1", "POST", "/api/meetings/check", {})).data;
    assert.strictEqual(r.added, 1, JSON.stringify(r));
    const list = (await req("owner1", "GET", "/api/meetings")).data;
    const m = list.items.find((x) => x.subject === "Notes: Northside Arts strategy call");
    assert.strictEqual(m.dealId, CT.deal); assert.strictEqual(m.status, "ready"); assert.strictEqual(m.proposal.stage, "assessment");
    const sk = list.items.find((x) => /Coaching/.test(x.subject));
    assert.strictEqual(sk.status, "skipped"); assert.strictEqual(sk.preview, "", "private text is never stored");
    assert.ok(!list.items.some((x) => /recording/.test(x.subject)), "non-summary emails ignored");
    assert.strictEqual((await req("owner1", "GET", "/api/proc/summary")).data.meetings, 1);
    const before = (await Q.query("SELECT count(*)::int AS n FROM encounters WHERE pipeline_id = $1", [CT.deal])).rows[0].n;
    const ap = (await req("owner1", "POST", "/api/meetings/" + m.id + "/apply", m.proposal)).data;
    assert.ok(ap.outboxId, JSON.stringify(ap));
    assert.strictEqual((await Q.query("SELECT count(*)::int AS n FROM encounters WHERE pipeline_id = $1", [CT.deal])).rows[0].n, before + 1, "logged as a conversation");
    const row = (await Q.query("SELECT status, text FROM meeting_notes WHERE id = $1", [m.id])).rows[0];
    assert.strictEqual(row.status, "applied"); assert.strictEqual(row.text, "", "raw text cleared once applied");
    assert.strictEqual((await req("owner1", "POST", "/api/meetings/check", {})).data.added, 0, "each email is read once");
  });
  await t("field notes: research drafts arrive as drafts only, once", async () => {
    const body = { notes: [{ title: "Test research note", signal: "s", assumption: "a", constraint: "c", evidence: "e", action: "x", trigger: "funder" }] };
    assert.strictEqual((await req("anon", "POST", "/api/admin/field-note-drafts", body)).status, 401);
    const r1 = (await req("anon", "POST", "/api/admin/field-note-drafts", body, { "X-Admin-Token": "test-token" })).data;
    const r2 = (await req("anon", "POST", "/api/admin/field-note-drafts", body, { "X-Admin-Token": "test-token" })).data;
    assert.strictEqual(r1.ids[0], r2.ids[0]);
    const n = (await Q.query("SELECT status, source FROM field_notes WHERE id = $1", [r1.ids[0]])).rows[0];
    assert.deepStrictEqual(n, { status: "draft", source: "research" });
  });
  // ---------- Projects & Team (hub.js) ----------
  const uid = async (email) => "u" + (await Q.query("SELECT id FROM app_users WHERE email = $1", [email])).rows[0].id;
  const hubW = (who, ops) => req(who, "POST", "/api/hub/write", { ops });
  const hubS = async (who, since = 0) => (await req(who, "GET", "/api/hub/sync?since=" + since + "&tab=t-" + who + "&pres=" + encodeURIComponent(JSON.stringify({ v: "projects", m: who })))).data;
  await t("hub: a fresh board account for these checks", async () => {
    assert.strictEqual((await req("owner1", "POST", "/api/users", { email: "hubboard@test.org", name: "Hub Board", role: "board", password: "board-password-2" })).status, 200);
    assert.strictEqual((await req("board", "POST", "/api/login", { email: "hubboard@test.org", password: "board-password-2" })).status, 200);
  });
  const mailText = (raw) => { const i = raw.indexOf("\r\n\r\n") >= 0 ? raw.indexOf("\r\n\r\n") : raw.indexOf("\n\n"); const head = raw.slice(0, i), body = raw.slice(i).trim(); return head + "\n" + (/base64/i.test(head) ? Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8") : body); };
  await t("hub: the page needs a sign-in; signed-in people get it", async () => {
    const anon = await fetch(BASE + "/hub/", { redirect: "manual" });
    assert.strictEqual(anon.status, 302);
    const r = await fetch(BASE + "/hub/", { headers: { Cookie: jar.staff } });
    assert.strictEqual(r.status, 200); assert.match(await r.text(), /js\/fios\.js/);
    assert.strictEqual((await fetch(BASE + "/hub/js/pm.js", { headers: { Cookie: jar.staff } })).status, 200);
  });
  await t("hub: team comes from sign-in accounts; clients come from the pipeline", async () => {
    const d = await hubS("staff");
    const names = d.team.map((m) => m.data.email);
    assert.ok(names.includes("staff@test.org") && names.includes("owner@test.org"));
    assert.ok(d.team.find((m) => m.data.email === "owner@test.org").data.lead);
    assert.strictEqual(d.me.uid, await uid("staff@test.org"));
    assert.ok(d.engagements.some((e) => e.data.org === "Northside Literacy"));
  });
  await t("hub: staff save a project and task; the owner sees them; board can't change anything", async () => {
    assert.strictEqual((await hubW("staff", [{ path: "projects", id: "hp1", data: { name: "Board retreat", sections: [{ id: "s1", name: "To do" }] } }, { path: "tasks", id: "ht1", data: { title: "Book venue", project: "hp1", status: "assigned" } }])).status, 200);
    const d = await hubS("owner1");
    assert.ok(d.docs.some((x) => x.path === "tasks" && x.id === "ht1" && x.data.title === "Book venue"));
    const bw = await hubW("board", [{ path: "tasks", id: "hb", data: { title: "x" } }]); assert.strictEqual(bw.status, 403, JSON.stringify(bw));
    const later = await hubS("owner1", d.now);
    assert.ok(!later.docs.some((x) => x.id === "ht1" && x.t <= d.now - 5000));
  });
  await t("hub: only the owner changes settings, rules and cost rates; staff can't read rates", async () => {
    assert.strictEqual((await hubW("staff", [{ path: "config", id: "settings", data: { hubEmail: true } }])).status, 403);
    assert.strictEqual((await hubW("staff", [{ path: "rules", id: "r1", data: { name: "x" } }])).status, 403);
    assert.strictEqual((await hubW("owner1", [{ path: "config", id: "rates", data: { rates: { a: 1 } } }, { path: "rules", id: "r1", data: { name: "Done moves", on: "status" } }])).status, 200);
    assert.ok(!(await hubS("staff")).docs.some((x) => x.path === "config" && x.id === "rates"));
    assert.ok((await hubS("owner1")).docs.some((x) => x.path === "config" && x.id === "rates"));
  });
  await t("hub: check-ins stay private to the person and the owner", async () => {
    const s = await uid("staff@test.org"), o = await uid("owner@test.org");
    assert.strictEqual((await hubW("staff", [{ path: "pulses/" + s + "/entries", id: "p1", data: { energy: 4 } }])).status, 200);
    assert.strictEqual((await hubW("staff", [{ path: "pulses/" + o + "/entries", id: "p2", data: { energy: 1 } }])).status, 403);
    assert.strictEqual((await hubW("owner1", [{ path: "pulses/" + o + "/entries", id: "p3", data: { energy: 3 } }])).status, 200);
    const st = await hubS("staff");
    assert.ok(st.docs.some((x) => x.id === "p1") && !st.docs.some((x) => x.id === "p3"));
    assert.ok((await hubS("owner1")).docs.some((x) => x.id === "p1"));
    assert.strictEqual((await hubW("owner1", [{ path: "audit/" + s + "/entries", id: "a1", data: { action: "x" } }])).status, 403);
  });
  await t("hub: each person edits only their own team extras; names stay from the account", async () => {
    const s = await uid("staff@test.org"), o = await uid("owner@test.org");
    assert.strictEqual((await hubW("staff", [{ path: "team", id: s, data: { capacity: 30, digest: true, name: "Hacked" } }])).status, 200);
    assert.strictEqual((await hubW("staff", [{ path: "team", id: o, data: { capacity: 1 } }])).status, 403);
    const m = (await hubS("owner1")).team.find((x) => x.id === s).data;
    assert.strictEqual(m.capacity, 30); assert.strictEqual(m.name, "staff");
  });
  await t("hub: time logged on a task linked to a deal shows up in time entries, once", async () => {
    const deal = (await Q.query("SELECT id FROM pipeline WHERE org = 'Northside Literacy' LIMIT 1")).rows[0].id;
    const task = { title: "Draft proposal", eng: deal, timeLog: [{ at: "2030-01-02T15:00:00.000Z", min: 45, by: "x" }] };
    await hubW("staff", [{ path: "tasks", id: "ht2", data: task }]);
    await hubW("staff", [{ path: "tasks", id: "ht2", data: Object.assign({}, task, { status: "done" }) }]);
    await hubW("staff", [{ path: "tasks", id: "ht2", data: Object.assign({}, task, { timeLog: task.timeLog.concat([{ at: "2030-01-03T15:00:00.000Z", min: 30 }]) }) }]);
    const rows = (await Q.query("SELECT minutes, entry_date, note FROM time_entries WHERE pipeline_id = $1 AND id LIKE 'hub-%' ORDER BY entry_date", [deal])).rows;
    assert.deepStrictEqual(rows.map((r) => r.minutes), [45, 30]);
    assert.match(rows[0].note, /Draft proposal/);
  });
  await t("hub: deletes reach other people", async () => {
    const before = await hubS("owner1");
    await hubW("staff", [{ path: "tasks", id: "ht1", data: null }]);
    const after = await hubS("owner1", before.now);
    assert.ok(after.docs.some((x) => x.id === "ht1" && x.data === null));
    assert.ok(!(await hubS("owner1")).docs.some((x) => x.id === "ht1"));
  });
  await t("hub: who's here now", async () => {
    await hubS("staff"); const d = await hubS("owner1"); const su = await uid("staff@test.org");
    assert.ok(d.peers.some((p) => p.by === su && p.presence.v === "projects"));
  });
  await t("hub: files upload, download, and only the uploader or owner deletes them", async () => {
    const up = await fetch(BASE + "/api/hub/files", { method: "POST", headers: { Cookie: jar.staff, "Content-Type": "text/plain", "X-File-Name": encodeURIComponent("notes.txt") }, body: "hello hub" });
    const f = await up.json(); assert.strictEqual(up.status, 200); assert.strictEqual(f.sizeBytes, 9);
    const dl = await fetch(BASE + f.url, { headers: { Cookie: jar.board } }); const dlt = await dl.text(); assert.strictEqual(dlt, "hello hub", dl.status + " " + dlt.slice(0, 200));
    const html = await (await fetch(BASE + "/api/hub/files", { method: "POST", headers: { Cookie: jar.staff, "Content-Type": "text/html" }, body: "<script>x</script>" })).json();
    const h = await fetch(BASE + html.url, { headers: { Cookie: jar.staff } }); assert.strictEqual(h.headers.get("content-type"), "application/octet-stream"); assert.match(h.headers.get("content-disposition"), /attachment/);
    assert.strictEqual((await fetch(BASE + "/api/hub/files", { method: "POST", headers: { Cookie: jar.board }, body: "x" })).status, 403);
    assert.strictEqual((await req("board", "DELETE", f.url)).status, 403);
    assert.strictEqual((await req("staff", "DELETE", f.url)).status, 200);
  });
  await t("hub: Claude answers through the practice's AI relay", async () => {
    const r = await req("staff", "POST", "/api/hub/ai", { prompt: "Reply with only a JSON object for the plan", json: true });
    assert.strictEqual(r.status, 200); assert.deepStrictEqual(r.data.data, {});
    assert.ok(MOCK.ai.some((x) => /Projects & Team/.test(x.system)));
  });
  await t("hub: email stays off until the owner turns it on, then sends from the connected Gmail", async () => {
    const off = await req("staff", "POST", "/api/hub/email", { to: ["pat@test.org"], subject: "Hi", body: "Status" });
    assert.strictEqual(off.status, 409, JSON.stringify(off.data));
    await hubW("owner1", [{ path: "config", id: "settings", data: { hubEmail: true } }]);
    const n = MOCK.sends.length;
    const on = await req("staff", "POST", "/api/hub/email", { to: ["pat@test.org"], subject: "Project status", body: "On track" });
    assert.strictEqual(on.status, 200, JSON.stringify(on.data)); assert.strictEqual(MOCK.sends.length, n + 1);
    assert.match(mailText(MOCK.sends[n].raw), /On track/);
    assert.strictEqual((await req("board", "POST", "/api/hub/email", { to: ["x@test.org"] })).status, 403);
  });
  await t("hub: the morning digest goes to people who opted in, once a day", async () => {
    const s = await uid("staff@test.org");
    await hubW("staff", [{ path: "tasks", id: "ht3", data: { title: "Overdue thing", owner: s, due: "2020-01-01", status: "assigned" } }]);
    const n = MOCK.sends.length;
    const r = await req("x", "POST", "/api/admin/hub-digest?force=1", null, { "X-Admin-Token": "test-token" });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data)); assert.strictEqual(r.data.count, 1);
    assert.strictEqual(MOCK.sends.length, n + 1); assert.match(mailText(MOCK.sends[n].raw), /Overdue thing/); assert.match(MOCK.sends[n].raw, /staff@test\.org/);
  });
  // ---------- Run the practice flows through Projects & Team ----------
  const hubDoc = async (who, p, id) => { const d = await hubS(who); const x = d.docs.find((y) => y.path === p && y.id === id); return x ? x.data : null; };
  const firstOwner = async () => "u" + (await Q.query("SELECT id FROM app_users WHERE role = 'owner' AND NOT disabled ORDER BY id LIMIT 1")).rows[0].id;
  let flowDeal;
  await t("flow: a deal's next step becomes a task in Pipeline next steps; edits and finishing go back to the deal", async () => {
    flowDeal = (await req("owner1", "POST", "/api/pipeline", { name: "Lee Park", org: "Eastside Youth Choir", stage: "discovery", nextStep: "Send discovery agenda", nextStepDate: "2030-02-01" })).data.id;
    const t1 = await hubDoc("staff", "tasks", "fios-deal-" + flowDeal);
    assert.ok(t1, "task missing"); assert.strictEqual(t1.title, "Send discovery agenda"); assert.strictEqual(t1.due, "2030-02-01");
    assert.strictEqual(t1.project, "fios-pipeline"); assert.strictEqual(t1.section, "discovery"); assert.strictEqual(t1.eng, flowDeal); assert.strictEqual(t1.owner, await firstOwner());
    assert.ok(await hubDoc("staff", "projects", "fios-pipeline"));
    await hubW("staff", [{ path: "tasks", id: "fios-deal-" + flowDeal, data: Object.assign({}, t1, { title: "Send agenda and pre-read", due: "2030-02-03", section: "engaged", comments: [{ text: "kept" }] }) }]);
    let d = (await Q.query("SELECT next_step, next_step_date, stage FROM pipeline WHERE id = $1", [flowDeal])).rows[0];
    assert.strictEqual(d.next_step, "Send agenda and pre-read"); assert.strictEqual(d.next_step_date, "2030-02-03"); assert.strictEqual(d.stage, "discovery");
    const t2 = await hubDoc("staff", "tasks", "fios-deal-" + flowDeal);
    assert.strictEqual(t2.section, "discovery", "stage changes only in Pipeline & Money"); assert.strictEqual(t2.comments[0].text, "kept");
    await req("owner1", "PATCH", "/api/pipeline/" + flowDeal, { nextStep: "Call back Thursday", nextStepDate: "2030-02-06" });
    const t3 = await hubDoc("staff", "tasks", "fios-deal-" + flowDeal);
    assert.strictEqual(t3.title, "Call back Thursday"); assert.strictEqual(t3.comments[0].text, "kept", "hub additions survive a change in the deal");
    await hubW("staff", [{ path: "tasks", id: "fios-deal-" + flowDeal, data: Object.assign({}, t3, { status: "done", done: true }) }]);
    d = (await Q.query("SELECT next_step, next_step_date FROM pipeline WHERE id = $1", [flowDeal])).rows[0];
    assert.strictEqual(d.next_step, ""); assert.strictEqual(d.next_step_date, "");
    const t4 = await hubDoc("staff", "tasks", "fios-deal-" + flowDeal);
    assert.strictEqual(t4.status, "done"); assert.ok(!t4.cancelled);
    await req("owner1", "PATCH", "/api/pipeline/" + flowDeal, { nextStep: "Propose the Diagnostic", nextStepDate: "2030-02-10" });
    const t5 = await hubDoc("staff", "tasks", "fios-deal-" + flowDeal);
    assert.strictEqual(t5.title, "Propose the Diagnostic"); assert.notStrictEqual(t5.status, "done", "a new next step reopens it");
  });
  await t("flow: delivery sessions become a Delivery project; finishing one marks it Complete", async () => {
    const mod = (await req("owner1", "POST", "/api/engagement-modules", { pipelineId: flowDeal, moduleName: "Board session 1", sessionDate: "2030-03-01", status: "scheduled" })).data.id;
    const tk = await hubDoc("staff", "tasks", "fios-module-" + mod);
    assert.strictEqual(tk.project, "fios-deal-" + flowDeal); assert.strictEqual(tk.section, "scheduled"); assert.strictEqual(tk.due, "2030-03-01");
    assert.match((await hubDoc("staff", "projects", "fios-deal-" + flowDeal)).name, /Delivery: Eastside Youth Choir/);
    await hubW("staff", [{ path: "tasks", id: "fios-module-" + mod, data: Object.assign({}, tk, { status: "done", done: true }) }]);
    assert.strictEqual((await Q.query("SELECT status FROM engagement_modules WHERE id = $1", [mod])).rows[0].status, "complete");
    await Q.query("UPDATE engagement_modules SET archived_at = $2 WHERE id = $1", [mod, new Date().toISOString()]);
    assert.strictEqual((await hubDoc("staff", "tasks", "fios-module-" + mod)).status, "done", "finished work stays");
  });
  await t("flow: issues become tasks; solved there or finished here stays in step; archived ones leave the lists", async () => {
    const iss = (await req("owner1", "POST", "/api/issues", { title: "Intake form confuses clients" })).data.id;
    const tk = await hubDoc("staff", "tasks", "fios-issue-" + iss);
    assert.strictEqual(tk.project, "fios-issues"); assert.strictEqual(tk.section, "open");
    await hubW("staff", [{ path: "tasks", id: "fios-issue-" + iss, data: Object.assign({}, tk, { status: "done", done: true }) }]);
    assert.strictEqual((await Q.query("SELECT status FROM issues WHERE id = $1", [iss])).rows[0].status, "solved");
    const iss2 = (await req("owner1", "POST", "/api/issues", { title: "Old issue" })).data.id;
    assert.ok(await hubDoc("staff", "tasks", "fios-issue-" + iss2));
    await Q.query("UPDATE issues SET archived_at = $2 WHERE id = $1", [iss2, new Date().toISOString()]);
    assert.strictEqual((await hubDoc("staff", "tasks", "fios-issue-" + iss2)).cancelled, true);
  });
  await t("flow: quarterly priorities become goals; a check-in sets on or off track", async () => {
    const rock = (await req("owner1", "POST", "/api/rocks", { title: "Sign 4 new clients", quarter: "Q1 2030", dueDate: "2030-03-31" })).data.id;
    const g = await hubDoc("staff", "goals", "fios-rock-" + rock);
    assert.strictEqual(g.title, "Sign 4 new clients"); assert.strictEqual(g.fiosStatus, "on-track"); assert.strictEqual(g.quarter, "Q1 2030");
    await hubW("staff", [{ path: "goals", id: "fios-rock-" + rock, data: Object.assign({}, g, { fiosStatus: "off-track", checkins: [{ note: "slow month" }] }) }]);
    assert.strictEqual((await Q.query("SELECT status FROM rocks WHERE id = $1", [rock])).rows[0].status, "off-track");
    await req("owner1", "PATCH", "/api/rocks/" + rock, { status: "done" });
    const g2 = await hubDoc("staff", "goals", "fios-rock-" + rock);
    assert.strictEqual(g2.fiosStatus, "done"); assert.strictEqual(g2.checkins[0].note, "slow month");
  });
  await t("flow: checklist steps, board items, grant reports and donor follow-ups become tasks owned by the owner", async () => {
    const now = new Date().toISOString(), owner = await firstOwner();
    await Q.query("INSERT INTO proc_runs (id, process_name, subject_kind, subject_id, subject_label, started_on, steps, created_at) VALUES ('run1', 'New client onboarding', 'pipeline', $1, 'Eastside Youth Choir', '2030-01-01', $2, $3)", [flowDeal, JSON.stringify([{ text: "Send welcome packet", dueOn: "2030-01-03", doneOn: "", by: "" }, { text: "Book kickoff", dueOn: "2030-01-05", doneOn: "", by: "" }]), now]);
    await Q.query("INSERT INTO gov_checklist (id, fiscal_year, label, due_on, created_at) VALUES ('gc1', '2030', 'File Form 990', '2030-05-15', $1)", [now]);
    await Q.query("INSERT INTO gm_programs (id, name, created_at) VALUES ('gp1', 'Youth Arts Fund', $1)", [now]).catch(async () => Q.query("INSERT INTO gm_programs (id, name) VALUES ('gp1', 'Youth Arts Fund')"));
    await Q.query("INSERT INTO gm_applications (id, program_id, org_name, created_at) VALUES ('ga1', 'gp1', 'Harbor Dance', $1)", [now]);
    await Q.query("INSERT INTO gm_reports (id, application_id, kind, due_on, created_at) VALUES ('gr1', 'ga1', 'interim', '2030-04-01', $1)", [now]);
    await Q.query("INSERT INTO fr_donors (id, name, created_at) VALUES ('fd1', 'Rosa Diaz', $1)", [now]);
    await Q.query("INSERT INTO fr_touches (id, donor_id, on_date, kind, summary, next_step, next_on, created_at) VALUES ('ft1', 'fd1', '2030-01-02', 'call', 'Great call', 'Send thank-you note', '2030-01-04', $1)", [now]);
    const d = await hubS("owner1");
    const get = (id) => (d.docs.find((x) => x.path === "tasks" && x.id === id) || {}).data;
    const step = get("fios-step-run1-s0"), gov = get("fios-gov-gc1"), rep = get("fios-report-gr1"), touch = get("fios-touch-ft1");
    assert.ok(step && gov && rep && touch, "missing: " + [!step && "step", !gov && "gov", !rep && "report", !touch && "touch"].filter(Boolean).join(","));
    for (const x of [step, gov, rep, touch]) { assert.strictEqual(x.owner, owner); assert.strictEqual(x.status, "seen"); }
    assert.strictEqual(step.project, "fios-checklists"); assert.strictEqual(step.section, "run1"); assert.strictEqual(step.eng, flowDeal);
    assert.match(rep.title, /Interim report from Harbor Dance/); assert.match(touch.title, /Send thank-you note \(Rosa Diaz\)/);
    assert.ok((d.docs.find((x) => x.path === "projects" && x.id === "fios-checklists").data.sections || []).some((x) => x.id === "run1" && /New client onboarding/.test(x.name)));
    await hubW("owner1", [{ path: "tasks", id: "fios-step-run1-s0", data: Object.assign({}, step, { status: "done", done: true }) }, { path: "tasks", id: "fios-gov-gc1", data: Object.assign({}, gov, { status: "done", done: true }) }, { path: "tasks", id: "fios-report-gr1", data: Object.assign({}, rep, { status: "done", done: true }) }, { path: "tasks", id: "fios-touch-ft1", data: Object.assign({}, touch, { status: "done", done: true }) }]);
    const steps = JSON.parse((await Q.query("SELECT steps, completed_on FROM proc_runs WHERE id = 'run1'")).rows[0].steps);
    assert.ok(steps[0].doneOn && !steps[1].doneOn);
    assert.ok((await Q.query("SELECT done_on FROM gov_checklist WHERE id = 'gc1'")).rows[0].done_on);
    assert.ok((await Q.query("SELECT received_on FROM gm_reports WHERE id = 'gr1'")).rows[0].received_on);
    assert.strictEqual((await Q.query("SELECT done FROM fr_touches WHERE id = 'ft1'")).rows[0].done, true);
    const s1 = (await hubS("owner1")).docs.find((x) => x.id === "fios-step-run1-s1").data;
    await hubW("owner1", [{ path: "tasks", id: "fios-step-run1-s1", data: Object.assign({}, s1, { status: "done", done: true }) }]);
    assert.ok((await Q.query("SELECT completed_on FROM proc_runs WHERE id = 'run1'")).rows[0].completed_on, "finishing every step completes the checklist");
  });
  await t("flow: deleting a mirrored task doesn't bring it straight back", async () => {
    const iss = (await req("owner1", "POST", "/api/issues", { title: "Delete me" })).data.id;
    assert.ok(await hubDoc("staff", "tasks", "fios-issue-" + iss));
    await hubW("staff", [{ path: "tasks", id: "fios-issue-" + iss, data: null }]);
    assert.strictEqual(await hubDoc("staff", "tasks", "fios-issue-" + iss), null);
  });
  await t("flow: the Weekly Meeting brief hears about blocked and off-track work", async () => {
    await hubW("staff", [{ path: "tasks", id: "hb-blocked", data: { title: "Waiting on board minutes", status: "blocked" } }, { path: "projects", id: "hb-off", data: { name: "Annual report", status: "off_track", sections: [] } }]);
    const b = (await req("owner1", "POST", "/api/weekly/refresh", {})).data;
    const text = (b.brief || b).flags ? (b.brief || b).flags.map((f) => f.text).join(" | ") : JSON.stringify(b).slice(0, 300);
    assert.match(text, /blocked: Waiting on board minutes/); assert.match(text, /Project off track: Annual report/);
  });
  await t("hub: bad addresses and oversized documents are refused", async () => {
    assert.strictEqual((await hubW("staff", [{ path: "../x", id: "a", data: {} }])).status, 400);
    assert.strictEqual((await hubW("staff", [{ path: "secrets", id: "a", data: {} }])).status, 403);
    assert.strictEqual((await hubW("staff", [{ path: "tasks", id: "big", data: { x: "y".repeat(500000) } }])).status, 413);
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
