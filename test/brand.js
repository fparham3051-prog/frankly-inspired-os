#!/usr/bin/env node
// Copies of the stack for other organizations.
//   1. Frankly Inspired's own profile: every page, script and style is served exactly as it is on disk.
//   2. Another organization's profile (ORG_CONFIG): its name, leader, links, mark and colors everywhere,
//      and none of Frankly Inspired's; its starter library loads in its own name.
//   3. A starter pack exported from one copy loads into a new copy.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { Pool } = require("pg");
const DB = process.env.TEST_DATABASE_URL;
if (!DB) { console.error("Set TEST_DATABASE_URL"); process.exit(1); }
const ROOT = path.join(__dirname, "..");
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log("  ok   " + name); } catch (e) { failed++; console.log("  FAIL " + name + "\n       " + e.message); } }

const OTHER = {
  version: 1,
  org: { type: "nonprofit", name: "Riverbend Youth Alliance", shortName: "Riverbend", legalName: "Riverbend Youth Alliance, Inc.", leader: { name: "Dana Okafor", firstName: "Dana", title: "Executive Director" }, email: "dana@riverbend.example", region: "Ohio" },
  brand: { mark: "R", navy: "#1E3A2F", navyDeep: "#132720", gold: "#D9822B", goldLight: "#E9A55E", goldAccessible: "#A35F17" },
  links: { website: "https://riverbend.example", operations: "", clients: "", booking: "https://cal.example/riverbend" },
  modules: JSON.parse(fs.readFileSync(path.join(ROOT, "org.config.json"), "utf8")).modules,
  offers: []
};

async function fresh() { const p = new Pool({ connectionString: DB }); await p.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"); await p.end(); }
async function start(extra) {
  const port = 6000 + Math.floor(Math.random() * 900);
  const env = Object.assign({}, process.env, { PORT: String(port), DATABASE_URL: DB, ADMIN_PASSWORD: "pw", ADMIN_API_TOKEN: "tok", SESSION_SECRET: "s", HUB_MIRROR_MS: "0", HUB_NO_TIMERS: "1", WEBSITE_API_URL: "http://127.0.0.1:9", PUBLIC_URL: `http://localhost:${port}/` }, extra);
  const srv = spawn(process.execPath, [path.join(ROOT, "server.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 80 && !/Listening on/.test(log); i++) await new Promise((r) => setTimeout(r, 250));
  if (!/Listening on/.test(log)) { console.error(log); process.exit(1); }
  const base = `http://localhost:${port}`;
  const login = await fetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "pw" }), redirect: "manual" });
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  const get = async (u, auth) => { const r = await fetch(base + u, { headers: auth ? { Cookie: cookie } : {}, redirect: "manual" }); return { status: r.status, type: r.headers.get("content-type") || "", text: await r.text() }; };
  return { srv, get, base, cookie };
}
const FILES = [["/", "login.html", false], ["/styles.css", "styles.css", false], ["/manifest.webmanifest", "manifest.webmanifest", false], ["/giving-landscape", "giving-landscape-public.html", false],
  ["/client/" + "A".repeat(32), "client.html", false], ["/", "index.html", true], ["/app.js", "app.js", true], ["/hub/", "hub/index.html", true], ["/hub/js/core.js", "hub/js/core.js", true], ["/hub/js/connect.js", "hub/js/connect.js", true], ["/hub/sw.js", "hub/sw.js", true]];
const FI = /Frankly Inspired|franklyinspired|Franklin|Parham|fparham/;

(async () => {
  console.log("Copies for other organizations");
  // 1. Frankly Inspired: untouched.
  await fresh();
  let s = await start({});
  await t("Frankly Inspired's copy serves every page, script and style exactly as written", async () => {
    for (const [u, f, auth] of FILES) {
      const r = await s.get(u, auth);
      assert.strictEqual(r.status, 200, u + " " + r.status);
      assert.strictEqual(r.text, fs.readFileSync(path.join(ROOT, "public", f), "utf8"), u + " differs from public/" + f);
    }
  });
  let pack = null;
  await t("the starter pack exports this copy's checklists and library (owner only)", async () => {
    await s.get("/api/proc/summary", true); // opening the library loads the starter set
    const r = await s.get("/api/settings/starter-pack", true);
    assert.strictEqual(r.status, 200, r.text.slice(0, 200)); pack = JSON.parse(r.text);
    assert.ok(pack.processes.length >= 5, "processes: " + pack.processes.length);
    assert.ok(pack.processes.every((p) => p.name && Array.isArray(p.steps) && !p.id && p.owner === ""));
    assert.strictEqual((await s.get("/api/settings/starter-pack", false)).status, 401);
  });
  await t("Frankly Inspired's copy shows no setup checklist", async () => {
    assert.strictEqual(JSON.parse((await s.get("/api/setup", true)).text).show, false);
  });
  s.srv.kill();

  // 2. Another organization.
  await fresh();
  pack.processes.push({ name: "Riverbend-only checklist", area: "foundation", purpose: "Proves the pack loaded", steps: [{ text: "Call Franklin's office", days: 1 }] });
  s = await start({ ORG_CONFIG: JSON.stringify(OTHER), STARTER_PACK: JSON.stringify(pack) });
  await t("another organization's copy shows its own name, leader, links and mark, and none of Frankly Inspired's", async () => {
    for (const [u, , auth] of FILES) {
      const r = await s.get(u, auth);
      assert.strictEqual(r.status, 200, u + " " + r.status);
      const hits = r.text.split("\n").filter((l) => FI.test(l) && !/^\s*(\/\/|\/\*|\*|<!--|--)/.test(l));
      assert.deepStrictEqual(hits.slice(0, 3), [], u + " still shows Frankly Inspired");
    }
    const login = await s.get("/"); assert.match(login.text, /Riverbend Youth Alliance/); assert.match(login.text, /class="login-f">R</);
    const hub = await s.get("/hub/js/core.js", true); assert.match(hub.text, /cal\.example\/riverbend/); assert.match(hub.text, /Dana Okafor/);
    assert.match((await s.get("/hub/", true)).type, /text\/html/);
  });
  await t("its brand colors replace Frankly Inspired's", async () => {
    const css = (await s.get("/styles.css")).text;
    assert.match(css, /#1E3A2F/); assert.ok(!/#11233D/i.test(css)); assert.ok(!/#B28E42/i.test(css));
  });
  await t("its starter library loads in its own name, from the pack", async () => {
    await s.get("/api/proc/summary", true);
    const p = new Pool({ connectionString: DB });
    const rows = (await p.query("SELECT name, steps FROM proc_processes")).rows; await p.end();
    assert.ok(rows.some((r) => r.name === "Riverbend-only checklist"));
    assert.ok(!rows.some((r) => FI.test(r.name + JSON.stringify(r.steps))), "starter text still names Frankly Inspired");
    assert.ok(rows.some((r) => /Dana's office/.test(JSON.stringify(r.steps))));
  });
  await t("the client workspace and errors speak in its name", async () => {
    const r = await fetch(s.base + "/api/client/" + "A".repeat(32)); const j = await r.json();
    assert.match(j.error, /Ask Riverbend/);
  });
  await t("a new copy shows its owner the setup checklist; Frankly Inspired's never does", async () => {
    const r = JSON.parse((await s.get("/api/setup", true)).text);
    assert.strictEqual(r.show, true); assert.ok(r.items.length >= 8);
    assert.ok(r.items.find((x) => x.key === "profile").done, "profile is set");
    assert.ok(!r.items.find((x) => x.key === "records").done, "no records yet");
    assert.strictEqual((await s.get("/setup-checklist.js", true)).status, 200);
  });
  await t("the demo loader fills a demo copy with a fictional client, outcomes and a workspace link", async () => {
    const out = await new Promise((ok) => { const p = spawn(process.execPath, [path.join(ROOT, "scripts", "demo-seed.js"), s.base], { env: Object.assign({}, process.env, { DEMO_PASSWORD: "pw", DEMO_TOKEN: "tok" }) }); let o = ""; p.stdout.on("data", (d) => (o += d)); p.stderr.on("data", (d) => (o += d)); p.on("close", (code) => ok({ code, o })); });
    assert.strictEqual(out.code, 0, out.o);
    const url = (out.o.match(/\/client\/([A-Za-z0-9_-]{32,})/) || [])[1]; assert.ok(url, out.o);
    const w = await (await fetch(s.base + "/api/client/" + url)).json();
    assert.strictEqual(w.org, "Maple Street Literacy Project"); assert.strictEqual(w.outcomes.comparison.overallChange, 15);
    assert.strictEqual(w.outcomes.sessions.done, 4); assert.strictEqual(w.outcomes.hours, 11.5); assert.strictEqual(w.decisions.length, 1);
    assert.strictEqual(w.growth.score, 14); assert.strictEqual(w.growth.baseline.score, 10);
    assert.ok(w.projects.some((p) => /^Growth Plan: /.test(p.name) && p.total === 7 && p.done === 2), "the Growth Plan project shows underway: 7 tasks, 2 done");
    assert.strictEqual(w.consultant.firm, "Riverbend Youth Alliance");
    const again = await new Promise((ok) => { const p = spawn(process.execPath, [path.join(ROOT, "scripts", "demo-seed.js"), s.base], { env: Object.assign({}, process.env, { DEMO_PASSWORD: "pw", DEMO_TOKEN: "tok" }) }); p.on("close", (code) => ok(code)); });
    assert.strictEqual(again, 1, "refuses to add demo data to a copy that already has records");
  });
  s.srv.kill();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
