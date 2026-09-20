#!/usr/bin/env node
"use strict";

// Smoke tests for the admin write endpoints (gifts, prospects, digest,
// backup/restore) the five scheduled automations depend on. Run this after
// any deploy, before the next unattended job fires, to catch a broken auth
// check, a broken route, or a lost database connection early - not a full
// test suite, just enough to know the automations won't hit a wall.
//
// Deliberately non-destructive: every check here either reads (the backup
// and public giving-landscape endpoints) or sends a payload built to fail
// validation before it ever reaches the database (an empty items array), so
// this never writes a row to the live app and needs no cleanup step. It
// also never calls restore for real - that endpoint overwrites real data by
// design, so it is checked for auth only, and an actual restore should be
// run and verified by hand, not from an automated script.
//
// Usage:
//   ADMIN_TOKEN=<the live admin token> node scripts/smoke-test.js [base-url]
//   (base-url defaults to https://frankly-inspired-os.onrender.com)
//
// A non-zero exit code means something failed - wire this into whatever
// you run right after a deploy.

const BASE = (process.argv[2] || process.env.SMOKE_BASE_URL || "https://frankly-inspired-os.onrender.com").replace(/\/$/, "");
const TOKEN = process.env.ADMIN_TOKEN || "";

if (!TOKEN) {
  console.error("Set ADMIN_TOKEN in the environment before running this script (the master ADMIN_API_TOKEN, or any one scoped admin token).");
  process.exit(1);
}

let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log("  ok   - " + name);
    passed++;
  } catch (err) {
    console.log("FAIL   - " + name + ": " + err.message);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  console.log("Smoke testing " + BASE + " ...\n");

  // ---- every admin endpoint rejects a missing or wrong token ----
  await check("POST /api/admin/gifts rejects a missing token", async () => {
    const r = await fetch(BASE + "/api/admin/gifts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: [] }) });
    assert(r.status === 401, "expected 401, got " + r.status);
  });
  await check("POST /api/admin/prospects rejects a missing token", async () => {
    const r = await fetch(BASE + "/api/admin/prospects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: [] }) });
    assert(r.status === 401, "expected 401, got " + r.status);
  });
  await check("POST /api/admin/digest rejects a missing token", async () => {
    const r = await fetch(BASE + "/api/admin/digest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: [] }) });
    assert(r.status === 401, "expected 401, got " + r.status);
  });
  await check("GET /api/admin/backup rejects a missing token", async () => {
    const r = await fetch(BASE + "/api/admin/backup");
    assert(r.status === 401, "expected 401, got " + r.status);
  });
  await check("POST /api/admin/restore rejects a missing token", async () => {
    const r = await fetch(BASE + "/api/admin/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    assert(r.status === 401, "expected 401, got " + r.status);
  });
  await check("POST /api/admin/automation-runs rejects a missing token", async () => {
    const r = await fetch(BASE + "/api/admin/automation-runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    assert(r.status === 401, "expected 401, got " + r.status);
  });
  await check("An obviously wrong token is also rejected", async () => {
    const r = await fetch(BASE + "/api/admin/backup", { headers: { "X-Admin-Token": "definitely-not-the-token" } });
    assert(r.status === 401, "expected 401, got " + r.status);
  });

  // ---- with a real token, each write route validates its body before touching the database ----
  await check("POST /api/admin/gifts with an empty items array is rejected (no row written)", async () => {
    const r = await fetch(BASE + "/api/admin/gifts", { method: "POST", headers: { "Content-Type": "application/json", "X-Admin-Token": TOKEN }, body: JSON.stringify({ items: [] }) });
    assert(r.status === 400, "expected 400, got " + r.status);
  });
  await check("POST /api/admin/prospects with an empty items array is rejected (no row written)", async () => {
    const r = await fetch(BASE + "/api/admin/prospects", { method: "POST", headers: { "Content-Type": "application/json", "X-Admin-Token": TOKEN }, body: JSON.stringify({ items: [] }) });
    assert(r.status === 400, "expected 400, got " + r.status);
  });
  await check("POST /api/admin/digest with an empty items array is rejected (no row written)", async () => {
    const r = await fetch(BASE + "/api/admin/digest", { method: "POST", headers: { "Content-Type": "application/json", "X-Admin-Token": TOKEN }, body: JSON.stringify({ items: [] }) });
    assert(r.status === 400, "expected 400, got " + r.status);
  });
  await check("POST /api/admin/automation-runs without jobKey/status is rejected (no row written)", async () => {
    const r = await fetch(BASE + "/api/admin/automation-runs", { method: "POST", headers: { "Content-Type": "application/json", "X-Admin-Token": TOKEN }, body: JSON.stringify({}) });
    assert(r.status === 400, "expected 400, got " + r.status);
  });

  // ---- the real token is actually accepted, and the database is reachable ----
  await check("GET /api/admin/backup succeeds with the real token and returns every table", async () => {
    const r = await fetch(BASE + "/api/admin/backup", { headers: { "X-Admin-Token": TOKEN } });
    assert(r.status === 200, "expected 200, got " + r.status);
    const body = await r.json();
    ["pipeline", "scorecard", "issues", "rocks", "prospects", "digest", "gifts"].forEach((t) => {
      assert(Array.isArray(body[t]), "backup response missing array for table: " + t);
    });
    assert(typeof body.exportedAt === "string", "backup response missing exportedAt");
  });

  // ---- the public, no-login endpoint the ticker feeds is up ----
  await check("GET /api/public/giving-landscape is reachable with no auth", async () => {
    const r = await fetch(BASE + "/api/public/giving-landscape");
    assert(r.status === 200, "expected 200, got " + r.status);
    const body = await r.json();
    assert(Array.isArray(body.gifts), "public giving-landscape response missing gifts array");
  });

  console.log("\n" + passed + " passed, " + failed + " failed.");
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Smoke test run itself failed: " + err.message);
  process.exit(1);
});
