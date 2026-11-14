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

  srv.kill();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
