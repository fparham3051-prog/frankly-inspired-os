// Browser test of Projects & Team: two people (desktop and phone) working at once.
// Starts its own server against E2E_DATABASE_URL (an empty database) and fails loudly.
//   E2E_DATABASE_URL=postgres://... node test/e2e.js        (CHROME_PATH=... to use an installed Chrome)
const path = require("path"), { spawn } = require("child_process"), assert = require("assert");
let pw; try { pw = require("playwright"); } catch (e) { pw = require("/opt/npm-tools/node_modules/playwright"); }
const PORT = 6100 + Math.floor(Math.random() * 800), B = `http://localhost:${PORT}`;
const DB = process.env.E2E_DATABASE_URL;
if (!DB) { console.error("Set E2E_DATABASE_URL to an empty Postgres database."); process.exit(2); }
const OUT = process.env.E2E_SHOTS || "";
const results = [];
const step = async (name, fn) => { try { await fn(); results.push(["ok", name]); console.log("  ok   " + name); } catch (e) { results.push(["FAIL", name, e.message]); console.log("  FAIL " + name + "\n       " + e.message.split("\n")[0]); } };

(async () => {
  const env = Object.assign({}, process.env, { PORT: String(PORT), DATABASE_URL: DB, ADMIN_PASSWORD: "practice-pw", ADMIN_API_TOKEN: "e2e", SESSION_SECRET: "e2e", WEBSITE_API_URL: "http://127.0.0.1:9", GRANTPASS_API: "http://127.0.0.1:9", HUB_MIRROR_MS: "0", HUB_NO_TIMERS: "1" });
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 60 && !/Listening/.test(log); i++) await new Promise((r) => setTimeout(r, 250));
  const br = await pw.chromium.launch(Object.assign({ args: ["--no-sandbox"] }, process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}));
  const errs = [];
  const A = await br.newContext({ viewport: { width: 1280, height: 860 } }), pa = await A.newPage();
  pa.on("pageerror", (e) => errs.push("owner: " + e.message));
  await pa.request.post(B + "/api/login", { data: { password: "practice-pw" } });
  await pa.request.post(B + "/api/users", { data: { email: "assoc@test.org", name: "Ava Associate", role: "staff", password: "assoc-password-1" } });
  const Bc = await br.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }), pb = await Bc.newPage();
  pb.on("pageerror", (e) => errs.push("associate: " + e.message));
  await pb.request.post(B + "/api/login", { data: { email: "assoc@test.org", password: "assoc-password-1" } });
  const shot = async (p, n) => { if (OUT) await p.screenshot({ path: path.join(OUT, n + ".png") }); };
  let ids;

  await step("the in-browser self-test passes", async () => {
    await pa.goto(B + "/hub/tests.html"); await pa.waitForSelector("text=/Self-test:/", { timeout: 15000 });
    const t = await pa.locator("text=/Self-test:/").first().textContent();
    const m = /(\d+) of (\d+) passed/.exec(t); assert.ok(m && m[1] === m[2], t);
  });
  await step("the owner stays on the team after an associate account exists", async () => {
    await pa.goto(B + "/hub/#projects"); await pa.waitForFunction(() => typeof S !== "undefined" && S.me && S.team[S.me], null, { timeout: 15000 });
    ids = await pa.evaluate(() => { const pid = uid(); put("projects", pid, { name: "Board retreat", status: "on_track", sections: [{ id: "s1", name: "To do" }, { id: "s2", name: "Done" }], fields: [], files: [], updates: [], owner: S.me, start: today(), due: addDays(today(), 30) }); const a = pmTask(pid, "Book the venue", { owner: S.me, start: today(), due: addDays(today(), 2) }); const b = pmTask(pid, "Send invitations", { owner: S.me, start: addDays(today(), 3), due: addDays(today(), 4) }); return { pid, tid: a, tid2: b }; });
    await pa.waitForTimeout(800);
  });
  await step("a mention reaches the other person live and lands in their Inbox", async () => {
    await pb.goto(B + "/hub/#inbox"); await pb.waitForFunction(() => typeof S !== "undefined" && S.me, null, { timeout: 15000 });
    await pa.evaluate((id) => openTask(id), ids.tid);
    await pa.fill('#taskDlg form[data-talknew] textarea', "Ava, can you hold Saturday at the Hillcrest venue? @Ava");
    const t0 = Date.now(); await pa.click('#taskDlg form[data-talknew] button[type=submit]');
    await pb.waitForFunction(() => list("msgs").some((m) => /Hillcrest/.test(m.text)), null, { timeout: 8000 });
    assert.ok(Date.now() - t0 < 6000, "took " + (Date.now() - t0) + " ms");
    await pb.waitForFunction(() => myAlerts().some((n) => /mentioned you/.test(n.text)), null, { timeout: 8000 });
  });
  await step("a reply, a reaction and a decision show for both", async () => {
    await pb.evaluate(() => { const m = list("msgs").find((x) => /Hillcrest/.test(x.text)); openTask(m.on.slice(5)); S.talkReply = m.id; rerenderTalk(); });
    await pb.fill("form[data-talkreply] textarea", "Held until Friday. $1,200 for the day.");
    await pb.press("form[data-talkreply] textarea", "Enter");
    await pa.waitForFunction(() => list("msgs").some((m) => m.parent && /Held until/.test(m.text)), null, { timeout: 8000 });
    await pa.evaluate(() => rerenderTalk());
    await pa.locator("#taskDlg .talk-msg.reply button[data-talk=decide]").first().click();
    await pa.locator("#taskDlg .talk-msg.reply button[data-e=ok]").first().click();
    await pb.waitForFunction(() => list("msgs").some((m) => m.decision) && list("reacts").length === 1, null, { timeout: 8000 });
    await shot(pa, "task-conversation");
  });
  await step("a message becomes a task in the same project", async () => {
    await pa.locator("#taskDlg .talk-thread > .talk-msg:not(.reply) button[data-talk=make-task]").first().click();
    await pa.waitForTimeout(400);
    const r = await pa.evaluate((pid) => { const m = list("msgs").find((x) => x.taskRef); return m && S.tasks[m.taskRef] && S.tasks[m.taskRef].project === pid; }, ids.pid);
    assert.ok(r);
    await pa.evaluate(() => $("#taskDlg").close()); await pb.evaluate(() => { const d = $("#taskDlg"); if (d.open) d.close(); });
  });
  await step("two people editing one task at the same moment both keep their change", async () => {
    await pa.waitForTimeout(1200);
    await Promise.all([pa.evaluate((id) => put("tasks", id, { ...S.tasks[id], notes: "Parking is free" }), ids.tid), pb.evaluate((id) => put("tasks", id, { ...S.tasks[id], title: "Book the venue (Hillcrest)" }), ids.tid)]);
    await pa.waitForTimeout(2500);
    for (const p of [pa, pb]) { const t = await p.evaluate((id) => S.tasks[id], ids.tid); assert.strictEqual(t.title, "Book the venue (Hillcrest)"); assert.strictEqual(t.notes, "Parking is free"); }
  });
  await step("a dependency with lag moves the waiting task when the first one slips", async () => {
    await pa.evaluate((x) => { put("tasks", x.tid2, { ...S.tasks[x.tid2], needs: [x.tid], depOpts: { [x.tid]: { type: "fs", lag: 2 } } }); }, ids);
    await pa.evaluate((id) => openTask(id), ids.tid2);
    assert.strictEqual(await pa.locator('#taskDlg [data-dp-dep=lag]').inputValue(), "2");
    await pa.evaluate(() => $("#taskDlg").close());
    const due = await pa.evaluate((x) => { const t = S.tasks[x.tid]; put("tasks", x.tid, { ...t, due: addDays(t.due, 3) }); afterDates(x.tid); return { a: S.tasks[x.tid].due, b: S.tasks[x.tid2].start }; }, ids);
    assert.strictEqual(due.b, await pa.evaluate((d) => addDays(d, 3), due.a), JSON.stringify(due));
  });
  await step("delete, then Undo brings the task back", async () => {
    await pa.evaluate((id) => del("tasks", id), ids.tid);
    await pa.waitForSelector("#undoBar.on >> text=Task deleted", { timeout: 6000 });
    await pa.click("#undoBar button");
    await pa.waitForFunction((id) => !!S.tasks[id], ids.tid, { timeout: 8000 });
  });
  await step("history lists the changes with Undo", async () => {
    await pa.evaluate((id) => openTask(id), ids.tid);
    await pa.locator("#taskDlg button[data-talk=hist]").click();
    await pa.waitForSelector("#taskDlg button[data-talk=undo]", { timeout: 6000 });
    await pa.evaluate(() => $("#taskDlg").close());
  });
  await step("search finds words inside messages", async () => {
    await pa.goto(B + "/hub/#today"); await pa.waitForFunction(() => typeof S !== "undefined" && S.me, null, { timeout: 15000 });
    await pa.fill("#gsearch", "twelve hundred"); await pa.fill("#gsearch", "1,200");
    await pa.waitForSelector('#gres [data-dp=open-on]', { timeout: 6000 });
  });
  await step("Connections shows tokens, webhooks and health; Inbox offers notifications", async () => {
    await pa.goto(B + "/hub/#setup"); await pa.waitForFunction(() => typeof S !== "undefined" && S.me, null, { timeout: 15000 });
    await pa.click("[data-dp=conn-load]"); await pa.waitForSelector("text=/database connected/", { timeout: 6000 });
    await shot(pa, "connections");
    await pb.goto(B + "/hub/#inbox"); await pb.waitForTimeout(1500); await shot(pb, "inbox-phone");
    assert.ok(await pb.locator(".inbox-row").count() >= 1);
  });
  await step("the operations app opens without errors", async () => {
    await pa.goto(B + "/"); await pa.waitForTimeout(1500);
  });
  await step("no page errors along the way", async () => { assert.deepStrictEqual(errs, []); });
  await br.close(); srv.kill();
  const bad = results.filter((r) => r[0] === "FAIL");
  console.log(`\n${results.length - bad.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
