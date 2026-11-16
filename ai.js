"use strict";
// AI assistance for the operations app. Every call goes through the website
// server's relay (POST /api/admin/ai, the shared admin secret), which holds
// the Anthropic key; nothing about the key lives here.
//
// Rules every feature follows:
//   - AI drafts, summarizes, and suggests. Messages it writes go to the
//     approval queue like every other message; nothing is sent on its own.
//   - It only works from what the system already holds (or documents the
//     owner uploads for one request, which are not stored).
//   - A daily budget caps the number of calls (AI_DAILY_LIMIT, default 150).
//   - The "AI assistance" area can be turned off in Settings > Areas.

const { ORG } = require("./accounts");

const BASE = () => (process.env.WEBSITE_API_URL || "").replace(/\/+$/, "");
const SECRET = () => process.env.WEBSITE_ADMIN_SECRET || "";
const LIMIT = () => Number(process.env.AI_DAILY_LIMIT) || 150;

function voice() {
  const o = ORG.org || {}, leader = (o.leader || {}).name || "the principal";
  return `You work inside the operating system of ${o.name || "a consulting practice"}, run by ${leader}, a nonprofit strategy practice in the Washington DC, Maryland, and Virginia region. Its method: find the one binding constraint holding an organization back, verify it with evidence, and work a 90-day plan against it.

Voice for anything a person will read: warm, direct, grounded, evidence-based, plain language. Short sentences. Not salesy. No exclamation points, no emojis, no hype words ("unlock", "journey", "supercharge", "game-changer", "leverage" as a verb, "delve"). Never invent facts, numbers, names, or events: use only what you are given, and say plainly when something isn't known.`;
}

async function enabled(pool) {
  if (!BASE() || !SECRET()) return false;
  try {
    const over = JSON.parse(((await pool.query("SELECT value FROM app_settings WHERE key = 'modules'")).rows[0] || {}).value || "{}");
    if (over.ai === false) return false;
  } catch (e) { /* default on */ }
  return (ORG.modules || {}).ai !== false;
}

async function spend(pool) {
  const today = new Date().toISOString().slice(0, 10);
  let u = { date: today, calls: 0 };
  try { const v = JSON.parse(((await pool.query("SELECT value FROM app_settings WHERE key = 'ai_usage'")).rows[0] || {}).value || "{}"); if (v.date === today) u = v; } catch (e) { /* new day */ }
  if (u.calls >= LIMIT()) throw Object.assign(new Error(`Today's AI limit (${LIMIT()} requests) is used up; it resets tomorrow.`), { status: 429 });
  u.calls++;
  await pool.query("INSERT INTO app_settings (key, value) VALUES ('ai_usage', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [JSON.stringify(u)]);
  return u;
}
async function usage(pool) {
  try { const v = JSON.parse(((await pool.query("SELECT value FROM app_settings WHERE key = 'ai_usage'")).rows[0] || {}).value || "{}"); return { today: v.date === new Date().toISOString().slice(0, 10) ? v.calls : 0, limit: LIMIT() }; } catch (e) { return { today: 0, limit: LIMIT() }; }
}

// ask({system, prompt, docs:[{name, mediaType, data(base64)}], maxTokens, json})
async function ask(pool, { system, prompt, docs, maxTokens, json }) {
  if (!(await enabled(pool))) throw Object.assign(new Error("AI assistance is off or not set up."), { status: 409 });
  await spend(pool);
  const content = [];
  for (const d of docs || []) {
    if (d.mediaType === "application/pdf") content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: d.data }, title: String(d.name || "document").slice(0, 200) });
    else content.push({ type: "text", text: `--- ${d.name || "document"} ---\n` + Buffer.from(d.data, "base64").toString("utf8").slice(0, 200000) });
  }
  content.push({ type: "text", text: prompt + (json ? "\n\nReturn only one JSON object, no prose before or after it, no code fences." : "") });
  const r = await fetch(BASE() + "/api/admin/ai", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Reminder-Secret": SECRET() },
    body: JSON.stringify({ system: voice() + (system ? "\n\n" + system : ""), messages: [{ role: "user", content }], maxTokens: maxTokens || 1500 }),
    signal: AbortSignal.timeout(180000),
  });
  const j = await r.json().catch(() => ({}));
  const note = (v) => pool.query("INSERT INTO app_settings (key, value) VALUES ('ai_last', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [JSON.stringify(v)]).catch(() => {});
  if (!r.ok || !j.ok) {
    const msg = j.error || "The AI service didn't answer (status " + r.status + ").";
    await note({ ok: false, at: new Date().toISOString(), error: msg });
    throw Object.assign(new Error(/x-api-key|authentication/i.test(msg) ? "The website server's Anthropic key was rejected; replace ANTHROPIC_API_KEY on the website server (Render)." : msg), { status: 502 });
  }
  await note({ ok: true, at: new Date().toISOString() });
  if (!json) return j.text;
  const m = /\{[\s\S]*\}/.exec(j.text || "");
  try { return JSON.parse(m ? m[0] : j.text); } catch (e) { throw Object.assign(new Error("The AI answer wasn't in the expected format; try again."), { status: 502 }); }
}

async function status(pool) {
  const on = await enabled(pool);
  let relay = null;
  if (BASE() && SECRET()) {
    try { const r = await fetch(BASE() + "/api/admin/ai", { headers: { "X-Reminder-Secret": SECRET() }, signal: AbortSignal.timeout(60000) }); relay = await r.json().catch(() => null); } catch (e) { relay = null; }
  }
  let last = null; try { last = JSON.parse(((await pool.query("SELECT value FROM app_settings WHERE key = 'ai_last'")).rows[0] || {}).value || "null"); } catch (e) { last = null; }
  const keyBad = !!(last && !last.ok && /x-api-key|authentication|invalid api key/i.test(last.error || ""));
  return { enabled: on, ready: !!(on && relay && relay.configured && !keyBad), keyRejected: keyBad, last, relay: relay ? { configured: !!relay.configured, model: relay.model } : null, usage: await usage(pool) };
}

module.exports = { ask, enabled, status, usage, voice };
