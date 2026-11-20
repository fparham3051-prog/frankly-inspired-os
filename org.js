"use strict";
// One place for "who is this organization". Everything reads org.config.json
// through here, so a copy of the stack for another organization changes only
// that file (see docs/NEW-ORGANIZATION.md).
//
// Branding layer. The pages and scripts were written for Frankly Inspired, and
// that text is the default. When org.config.json describes a different
// organization, brand() swaps Frankly Inspired's name, leader, links, mark and
// colors for the configured ones as each page, script or stylesheet is served.
// When the config IS Frankly Inspired's, active() is false and nothing is
// rewritten: files are served exactly as they are on disk.
const fs = require("fs");
const path = require("path");
const { ORG } = require("./accounts");

// The defaults the code was written with. Keep in step with Frankly Inspired's org.config.json.
const DEFAULTS = {
  name: "Frankly Inspired and Associates", shortName: "Frankly Inspired", legalName: "Frankly Inspired and Associates, LLC",
  leaderName: "Franklin D. Parham", leaderFirst: "Franklin", email: "franklin@franklyinspired.associates", phone: "240-391-8283",
  mark: "F", website: "https://franklyinspired.associates", operations: "https://frankly-inspired-os.onrender.com",
  clients: "https://grantpass-dashboard.onrender.com", booking: "https://calendly.com/fparham/30min",
  colors: { navy: "#11233D", navyDeep: "#0B1A2D", gold: "#B28E42", goldLight: "#CBA869", goldAccessible: "#8E7134" }
};
const noSlash = (u) => String(u || "").replace(/\/+$/, "");
const o = () => ORG.org || {}, L = () => ORG.links || {}, B = () => ORG.brand || {};

function info() {
  const org = o(), lead = org.leader || {};
  return {
    name: org.name || DEFAULTS.name, shortName: org.shortName || org.name || DEFAULTS.shortName, legalName: org.legalName || org.name || DEFAULTS.legalName,
    leaderName: lead.name || DEFAULTS.leaderName, leaderFirst: lead.firstName || String(lead.name || DEFAULTS.leaderFirst).split(" ")[0],
    email: org.email || "", phone: org.phone || "", mark: B().mark || String(org.shortName || org.name || "F").charAt(0),
    website: noSlash(L().website || ""), operations: noSlash(process.env.PUBLIC_URL || L().operations || DEFAULTS.operations),
    clients: noSlash(L().clients || ""), booking: noSlash(L().booking || ""),
    colors: Object.assign({}, DEFAULTS.colors, Object.fromEntries(Object.keys(DEFAULTS.colors).filter((k) => B()[k]).map((k) => [k, B()[k]])))
  };
}
const publicUrl = () => info().operations + "/";

// Is this copy branded as someone other than Frankly Inspired?
let ACTIVE = null;
function active() {
  if (ACTIVE !== null) return ACTIVE;
  const i = info();
  ACTIVE = i.name !== DEFAULTS.name || i.shortName !== DEFAULTS.shortName || i.leaderName !== DEFAULTS.leaderName || i.mark !== DEFAULTS.mark ||
    (i.website && i.website !== DEFAULTS.website) || (i.booking && i.booking !== DEFAULTS.booking) || (i.clients && i.clients !== DEFAULTS.clients) ||
    (i.email && i.email !== DEFAULTS.email) || Object.keys(DEFAULTS.colors).some((k) => i.colors[k].toLowerCase() !== DEFAULTS.colors[k].toLowerCase());
  return ACTIVE;
}

function pairs(kind) {
  const i = info(), esc = (s) => kind === "json" ? JSON.stringify(String(s)).slice(1, -1) : kind === "html" ? String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;") : kind === "js" ? String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/`/g, "\\`") : String(s);
  const host = (u) => String(u || "").replace(/^https?:\/\//, "");
  const p = [
    [DEFAULTS.email, i.email || DEFAULTS.email],
    [DEFAULTS.booking, i.booking || DEFAULTS.booking], [host(DEFAULTS.booking), host(i.booking || DEFAULTS.booking)],
    [DEFAULTS.operations, i.operations], [DEFAULTS.clients, i.clients || DEFAULTS.clients],
    [DEFAULTS.website, i.website || DEFAULTS.website], [host(DEFAULTS.website), host(i.website || DEFAULTS.website)],
    [DEFAULTS.legalName, esc(i.legalName)], [DEFAULTS.name, esc(i.name)],
    ["Frankly Inspired &amp; Associates", esc(i.name)], ["Frankly Inspired & Associates", esc(i.name)],
    ['Frankly Inspired <span class="brandmark-tail">and Associates</span>', esc(i.name)],
    [DEFAULTS.leaderName, esc(i.leaderName)], [DEFAULTS.shortName, esc(i.shortName)],
    ['class="brandmark-f">F<', `class="brandmark-f">${esc(i.mark)}<`], ['class="login-f">F<', `class="login-f">${esc(i.mark)}<`]
  ];
  if (i.phone) p.push([DEFAULTS.phone, i.phone]);
  return p;
}
function brand(text, kind) {
  if (!active()) return text;
  let s = String(text);
  for (const [a, b] of pairs(kind)) if (a !== b) s = s.split(a).join(b);
  const i = info();
  if (i.leaderFirst !== DEFAULTS.leaderFirst) s = s.replace(/\bFranklin\b/g, i.leaderFirst);
  if (kind === "css" || kind === "html") for (const k of Object.keys(DEFAULTS.colors)) s = s.replace(new RegExp(DEFAULTS.colors[k], "gi"), i.colors[k]);
  return s;
}

// Express: serve branded copies of pages, scripts, styles and manifests.
const KINDS = { ".html": "html", ".js": "js", ".css": "css", ".webmanifest": "json" };
const TYPES = { html: "text/html; charset=utf-8", js: "application/javascript; charset=utf-8", css: "text/css; charset=utf-8", json: "application/manifest+json; charset=utf-8" };
const cache = new Map();
function branded(file) {
  const kind = KINDS[path.extname(file)];
  const st = fs.statSync(file), key = file + ":" + st.mtimeMs;
  if (!cache.has(key)) cache.set(key, brand(fs.readFileSync(file, "utf8"), kind));
  return { kind, body: cache.get(key) };
}
function middleware(publicDir) {
  return (req, res, next) => {
    if (!active()) return next();
    // Files sent by routes (res.sendFile)
    const send = res.sendFile.bind(res);
    res.sendFile = (file, opts, cb) => {
      if (typeof file === "string" && KINDS[path.extname(file)] && file.startsWith(publicDir) && fs.existsSync(file)) {
        try { const b = branded(file); res.type(TYPES[b.kind]); return res.send(b.body); } catch (e) { /* fall through */ }
      }
      return send(file, opts, cb);
    };
    // Files served straight from /hub (express.static)
    if (req.method === "GET" && req.path.startsWith("/hub")) {
      let rel = req.path.slice(4) || "/"; if (rel.endsWith("/")) rel += "index.html";
      const file = path.join(publicDir, "hub", path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
      if (file.startsWith(path.join(publicDir, "hub")) && KINDS[path.extname(file)] && fs.existsSync(file)) {
        // /hub still needs a signed-in user; hub.js checks that before static files, so only brand here and let it decide.
        res.locals.brandedFile = file;
      }
    }
    next();
  };
}
// Placed after hub.js's sign-in check: sends the branded /hub file it found.
function hubSender() {
  return (req, res, next) => {
    const f = res.locals && res.locals.brandedFile; if (!f || !active()) return next();
    try { const b = branded(f); res.setHeader("Cache-Control", "no-cache"); res.type(TYPES[b.kind]); return res.send(b.body); } catch (e) { return next(); }
  };
}

module.exports = { info, publicUrl, active, brand, middleware, hubSender, DEFAULTS, _reset: () => { ACTIVE = null; cache.clear(); } };
