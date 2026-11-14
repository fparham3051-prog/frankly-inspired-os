"use strict";
// Accounts, roles, two-step sign-in, the organization profile, and one
// sign-in into the InstitutionalOS console.
//
// Roles
//   owner  everything, including people, settings, My Desk, and backups
//   staff  runs the practice day to day; no people, settings, or My Desk
//   board  view only: can read everything except My Desk, can't change data
//
// Sign-in
//   Each person signs in with email + password (+ a 6-digit code from an
//   authenticator app once two-step sign-in is on). The original shared
//   password (ADMIN_PASSWORD) still signs in as the owner until the owner
//   turns it off in Settings, or turns on two-step sign-in, which turns it
//   off automatically so it can't be used to get around the code.
//
// Sessions are the same signed cookie as before. The value is
// "<expiry>~<userId>~<role>"; an old cookie that holds only "<expiry>" is
// the shared-password owner session and keeps working until it expires.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROLES = ["owner", "staff", "board"];
const OWNER_ONLY_PREFIXES = ["/api/users", "/api/settings", "/api/advancement-state", "/api/quiz-attempts"];
const BOARD_ALLOWED_WRITES = ["/api/logout", "/api/me/password", "/api/me/2fa"];

// ---------- organization profile ----------
const ORG_PATH = path.join(__dirname, "org.config.json");
let ORG = {};
try { ORG = JSON.parse(fs.readFileSync(ORG_PATH, "utf8")); } catch (e) { console.error("org.config.json missing or invalid:", e.message); }

// ---------- passwords (scrypt) ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 32);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}
function checkPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "base64");
  const expected = Buffer.from(parts[2], "base64");
  const got = crypto.scryptSync(String(password || ""), salt, expected.length);
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

// ---------- TOTP (RFC 6238, 30-second steps, 6 digits, SHA-1) ----------
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Encode(buf) {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  const clean = String(str || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function totpAt(secret, counter) {
  const key = base32Decode(secret);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", key).update(msg).digest();
  const off = h[h.length - 1] & 15;
  const code = ((h.readUInt32BE(off) & 0x7fffffff) % 1000000).toString();
  return code.padStart(6, "0");
}
function checkTotp(secret, code, now = Date.now()) {
  const c = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(c) || !secret) return false;
  const step = Math.floor(now / 30000);
  for (const d of [-1, 0, 1]) {
    const a = Buffer.from(totpAt(secret, step + d)), b = Buffer.from(c);
    if (crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}

// ---------- session values ----------
function sessionValue(expiry, userId, role) { return `${expiry}~${userId}~${role}`; }
function parseSessionValue(value) {
  const parts = String(value).split("~");
  const expiry = Number(parts[0]);
  if (!Number.isFinite(expiry) || Date.now() > expiry) return null;
  if (parts.length === 1) return { expiry, userId: 0, role: "owner", legacy: true };
  const role = ROLES.includes(parts[2]) ? parts[2] : null;
  if (!role) return null;
  return { expiry, userId: Number(parts[1]) || 0, role };
}

function mount(app, ctx) {
  const { pool, sign, verifySession, requireAuth, onUserChanged, COOKIE_NAME, COOKIE_MAX_AGE_MS, ADMIN_PASSWORD, timingSafeStringEqual, loginRateLimited } = ctx;

  async function getSetting(key, fallback = "") {
    const r = await pool.query("SELECT value FROM app_settings WHERE key = $1", [key]);
    return r.rows[0] ? r.rows[0].value : fallback;
  }
  async function setSetting(key, value) {
    await pool.query("INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [key, String(value)]);
  }
  function setCookie(res, userId, role) {
    const expiry = Date.now() + COOKIE_MAX_AGE_MS;
    res.cookie(COOKIE_NAME, sign(sessionValue(expiry, userId, role)), { httpOnly: true, secure: true, sameSite: "lax", maxAge: COOKIE_MAX_AGE_MS });
  }
  const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, twoStep: !!u.totp_on, disabled: !!u.disabled, lastLoginAt: u.last_login_at || "", createdAt: u.created_at || "" });
  function requireOwner(req, res, next) {
    if (req.session && req.session.role === "owner") return next();
    return res.status(403).json({ error: "Only the owner can do this." });
  }

  // ---- sign in ----
  app.post("/api/login", async (req, res) => {
    if (loginRateLimited(req.ip)) return res.status(429).json({ error: "Too many attempts. Wait a few minutes and try again." });
    const { email, password, code } = req.body || {};
    try {
      if (email && String(email).trim()) {
        const r = await pool.query("SELECT * FROM app_users WHERE lower(email) = lower($1)", [String(email).trim()]);
        const u = r.rows[0];
        if (!u || u.disabled || !checkPassword(password, u.pass_hash)) return res.status(401).json({ error: "Email or password is incorrect." });
        if (u.totp_on) {
          if (!code) return res.status(401).json({ error: "Enter the 6-digit code from your authenticator app.", needCode: true });
          if (!checkTotp(u.totp_secret, code)) return res.status(401).json({ error: "That code didn't match. Codes change every 30 seconds.", needCode: true });
        }
        await pool.query("UPDATE app_users SET last_login_at = $1 WHERE id = $2", [new Date().toISOString(), u.id]);
        setCookie(res, u.id, u.role);
        return res.json({ ok: true });
      }
      // Shared password: the original owner sign-in, until it's turned off.
      if ((await getSetting("shared_password_off")) === "1") return res.status(401).json({ error: "Sign in with your email and password." });
      if (!password || !timingSafeStringEqual(password, ADMIN_PASSWORD)) return res.status(401).json({ error: "incorrect password" });
      setCookie(res, 0, "owner");
      return res.json({ ok: true });
    } catch (err) {
      console.error("login failed", err);
      return res.status(500).json({ error: "Sign-in is unavailable right now." });
    }
  });

  // ---- who am I ----
  app.get("/api/me", async (req, res) => {
    const s = verifySession(req.cookies[COOKIE_NAME]);
    if (!s) return res.status(401).json({ error: "not authenticated" });
    let user = { id: 0, email: "", name: ORG.org && ORG.org.leader ? ORG.org.leader.name : "Owner", role: "owner", twoStep: false, shared: true };
    if (s.userId) {
      const r = await pool.query("SELECT * FROM app_users WHERE id = $1", [s.userId]);
      if (!r.rows[0] || r.rows[0].disabled) return res.status(401).json({ error: "account disabled" });
      user = publicUser(r.rows[0]);
    }
    const accounts = await pool.query("SELECT count(*)::int AS n FROM app_users WHERE role = 'owner' AND NOT disabled");
    res.json({ user, sharedPasswordOff: (await getSetting("shared_password_off")) === "1", ownerAccounts: accounts.rows[0].n });
  });

  app.post("/api/me/password", requireAuth, async (req, res) => {
    const s = req.session;
    if (!s.userId) return res.status(400).json({ error: "Create your own account first (Settings > People)." });
    const { current, next } = req.body || {};
    if (!next || String(next).length < 10) return res.status(400).json({ error: "Use at least 10 characters." });
    const r = await pool.query("SELECT * FROM app_users WHERE id = $1", [s.userId]);
    if (!r.rows[0] || !checkPassword(current, r.rows[0].pass_hash)) return res.status(400).json({ error: "Current password is incorrect." });
    await pool.query("UPDATE app_users SET pass_hash = $1 WHERE id = $2", [hashPassword(next), s.userId]);
    res.json({ ok: true });
  });

  // Two-step sign-in: start (returns a secret to add to an authenticator
  // app), confirm with a code (turns it on), or turn off with a code.
  app.post("/api/me/2fa", requireAuth, async (req, res) => {
    const s = req.session;
    if (!s.userId) return res.status(400).json({ error: "Create your own account first (Settings > People)." });
    const { action, code } = req.body || {};
    const r = await pool.query("SELECT * FROM app_users WHERE id = $1", [s.userId]);
    const u = r.rows[0];
    if (!u) return res.status(404).json({ error: "account not found" });
    if (action === "start") {
      const secret = base32Encode(crypto.randomBytes(20));
      await pool.query("UPDATE app_users SET totp_secret = $1, totp_on = false WHERE id = $2", [secret, u.id]);
      const issuer = encodeURIComponent((ORG.org && ORG.org.shortName) || "Operations");
      const label = encodeURIComponent(`${(ORG.org && ORG.org.shortName) || "Operations"}:${u.email}`);
      return res.json({ secret, otpauth: `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&period=30&digits=6` });
    }
    if (action === "confirm") {
      if (!checkTotp(u.totp_secret, code)) return res.status(400).json({ error: "That code didn't match. Try the newest one." });
      await pool.query("UPDATE app_users SET totp_on = true WHERE id = $1", [u.id]);
      let sharedTurnedOff = false;
      if (u.role === "owner") { await setSetting("shared_password_off", "1"); sharedTurnedOff = true; }
      return res.json({ ok: true, sharedTurnedOff });
    }
    if (action === "off") {
      if (!checkTotp(u.totp_secret, code)) return res.status(400).json({ error: "Enter a current code to turn this off." });
      await pool.query("UPDATE app_users SET totp_on = false, totp_secret = '' WHERE id = $1", [u.id]);
      return res.json({ ok: true });
    }
    res.status(400).json({ error: "unknown action" });
  });

  // ---- people (owner only) ----
  app.get("/api/users", requireAuth, requireOwner, async (req, res) => {
    const r = await pool.query("SELECT * FROM app_users ORDER BY created_at ASC");
    res.json({ users: r.rows.map(publicUser) });
  });
  app.post("/api/users", requireAuth, requireOwner, async (req, res) => {
    const { email, name, role, password } = req.body || {};
    const e = String(email || "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return res.status(400).json({ error: "Enter a valid email." });
    if (!ROLES.includes(role)) return res.status(400).json({ error: "Choose owner, staff, or board." });
    if (!password || String(password).length < 10) return res.status(400).json({ error: "Temporary password: at least 10 characters." });
    try {
      const r = await pool.query("INSERT INTO app_users (email, name, role, pass_hash, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING *",
        [e, String(name || "").slice(0, 120), role, hashPassword(password), new Date().toISOString()]);
      res.json({ user: publicUser(r.rows[0]) });
    } catch (err) {
      if (err.code === "23505") return res.status(409).json({ error: "Someone already has that email." });
      throw err;
    }
  });
  app.patch("/api/users/:id", requireAuth, requireOwner, async (req, res) => {
    const id = Number(req.params.id);
    const { role, disabled, name, password, resetTwoStep } = req.body || {};
    const r = await pool.query("SELECT * FROM app_users WHERE id = $1", [id]);
    const u = r.rows[0];
    if (!u) return res.status(404).json({ error: "not found" });
    if (id === req.session.userId && (disabled || (role && role !== "owner"))) return res.status(400).json({ error: "You can't remove your own owner access." });
    if (role && !ROLES.includes(role)) return res.status(400).json({ error: "Choose owner, staff, or board." });
    await pool.query(
      "UPDATE app_users SET role = COALESCE($1, role), disabled = COALESCE($2, disabled), name = COALESCE($3, name), pass_hash = COALESCE($4, pass_hash), totp_on = CASE WHEN $5 THEN false ELSE totp_on END, totp_secret = CASE WHEN $5 THEN '' ELSE totp_secret END WHERE id = $6",
      [role || null, typeof disabled === "boolean" ? disabled : null, typeof name === "string" ? name.slice(0, 120) : null,
       password ? (String(password).length >= 10 ? hashPassword(password) : null) : null, !!resetTwoStep, id]);
    if (onUserChanged) onUserChanged(id);
    const out = await pool.query("SELECT * FROM app_users WHERE id = $1", [id]);
    res.json({ user: publicUser(out.rows[0]) });
  });

  // ---- settings (owner only) ----
  // Areas (modules) can be switched on or off here without editing
  // org.config.json; the file stays the default for a fresh copy.
  async function effectiveModules() {
    const over = (() => { try { return JSON.parse(cache.modules || "{}"); } catch (e) { return {}; } })();
    const out = {};
    for (const [k, v] of Object.entries(ORG.modules || {})) if (k.charAt(0) !== "_") out[k] = k in over ? !!over[k] : !!v;
    return out;
  }
  const cache = { modules: null, at: 0 };
  async function loadModules() {
    if (cache.modules == null || Date.now() - cache.at > 30000) { cache.modules = await getSetting("modules", "{}").catch(() => "{}"); cache.at = Date.now(); }
    return effectiveModules();
  }
  app.get("/api/settings", requireAuth, requireOwner, async (req, res) => {
    res.json({ sharedPasswordOff: (await getSetting("shared_password_off")) === "1", modules: await loadModules() });
  });
  app.post("/api/settings", requireAuth, requireOwner, async (req, res) => {
    const { sharedPasswordOff } = req.body || {};
    if (typeof sharedPasswordOff === "boolean") {
      if (sharedPasswordOff) {
        const owners = await pool.query("SELECT count(*)::int AS n FROM app_users WHERE role = 'owner' AND NOT disabled");
        if (!owners.rows[0].n) return res.status(400).json({ error: "Create your own owner account first, or you'd be locked out." });
      }
      await setSetting("shared_password_off", sharedPasswordOff ? "1" : "0");
    }
    if (req.body && req.body.modules && typeof req.body.modules === "object") {
      const current = JSON.parse((await getSetting("modules", "{}")) || "{}");
      for (const [k, v] of Object.entries(req.body.modules)) if (k in (ORG.modules || {}) && k.charAt(0) !== "_") current[k] = !!v;
      await setSetting("modules", JSON.stringify(current));
      cache.modules = null;
    }
    res.json({ ok: true, sharedPasswordOff: (await getSetting("shared_password_off")) === "1", modules: await loadModules() });
  });

  // ---- organization profile (the same file the console and website use) ----
  app.get("/org.config.json", async (req, res) => {
    let modules = ORG.modules;
    try { modules = Object.assign({ _about: (ORG.modules || {})._about }, await loadModules()); } catch (e) {}
    res.json(Object.assign({}, ORG, { modules }));
  });
  app.get("/org.js", (req, res) => res.sendFile(path.join(__dirname, "public", "org.js")));

  // ---- one sign-in into the InstitutionalOS console ----
  app.get("/api/sso/clients", async (req, res) => {
    const s = verifySession(req.cookies[COOKIE_NAME]);
    const clientsUrl = (ORG.links && ORG.links.clients) || "https://grantpass-dashboard.onrender.com/";
    if (!s || s.role === "board") return res.redirect(clientsUrl);
    const api = process.env.GRANTPASS_API || "https://grantpass-backend.onrender.com";
    const key = process.env.GRANTPASS_INTEGRATION_KEY || "";
    if (!key) return res.redirect(clientsUrl);
    try {
      const r = await fetch(api.replace(/\/$/, "") + "/integration/session", { method: "POST", headers: { "X-Integration-Key": key, "Content-Type": "application/json" }, body: "{}" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.token) throw new Error(d.error || ("HTTP " + r.status));
      return res.redirect(`${clientsUrl}#sso=${encodeURIComponent(d.token)}&api=${encodeURIComponent(api)}`);
    } catch (err) {
      console.error("sso to console failed:", err.message);
      return res.redirect(clientsUrl);
    }
  });
}

// Role rules applied to every signed-in API call (see requireAuth in server.js).
function roleAllows(session, req) {
  if (!session) return { ok: false, status: 401, error: "not authenticated" };
  const p = req.path;
  if (OWNER_ONLY_PREFIXES.some((x) => p.startsWith(x)) && session.role !== "owner") return { ok: false, status: 403, error: "Only the owner can do this." };
  if (session.role === "board" && req.method !== "GET" && !BOARD_ALLOWED_WRITES.some((x) => p.startsWith(x))) {
    return { ok: false, status: 403, error: "Board accounts are view only." };
  }
  return { ok: true };
}

module.exports = { mount, roleAllows, parseSessionValue, hashPassword, checkPassword, checkTotp, totpAt, base32Encode, ORG, ROLES };
