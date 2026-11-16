"use strict";
// Contacts and organizations: one record per person and per organization,
// linked to every place they appear (pipeline, prospects, grant applications,
// donors, the board). sync() keeps the links current and never overwrites
// what you've typed on a contact: it only fills blanks.
//
//   /api/contacts            list (?q= search, ?role= client|prospect|grantee|donor|board)
//   /api/contacts/:id        profile with everything linked: deals, grants, gifts,
//                            board role, checklists, and messages
//   /api/contacts/:id/merge  merge a duplicate into this one {fromId}
//   /api/orgs, /api/orgs/:id organizations, same idea
//   lookupEmail()            used by checklists to know who messages go to

const F = require("./foundation");
const { todayIso, nowIso, newId, parseJson } = F;

F.SPECS.contacts = {
  required: ["name"],
  fields: { name: ["name", "s"], email: ["email", "s"], phone: ["phone", "s"], title: ["title", "s"], orgId: ["org_id", "s"], notes: ["notes", "s"] },
};
F.SPECS.organizations = {
  required: ["name"],
  fields: { name: ["name", "s"], kind: ["kind", "s"], ein: ["ein", "s"], website: ["website", "s"], city: ["city", "s"], state: ["state", "s"], notes: ["notes", "s"] },
};
F.HAS_UPDATED.contacts = 1;
F.HAS_UPDATED.organizations = 1;

const EMAIL_RE = /[^@\s<>"'(),;:]+@[^@\s<>"'(),;:]+\.[a-z]{2,}/i;
const clean = (s) => String(s || "").trim();
const isEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean(s));

async function sync(pool) {
  const q = async (sql, vals) => { try { return (await pool.query(sql, vals || [])).rows; } catch (e) { return []; } };
  const linked = new Set((await q("SELECT kind || '|' || ref_id AS k FROM contact_links")).map((r) => r.k));
  const orgCache = new Map((await q("SELECT id, lower(name) AS n FROM organizations WHERE archived_at IS NULL")).map((r) => [r.n, r.id]));
  let made = 0;

  async function org(name, extra) {
    name = clean(name); if (!name || isEmail(name)) return null;
    const key = name.toLowerCase();
    if (orgCache.has(key)) {
      const id = orgCache.get(key);
      if (extra) await pool.query("UPDATE organizations SET ein = CASE WHEN ein = '' THEN $1 ELSE ein END, website = CASE WHEN website = '' THEN $2 ELSE website END, kind = CASE WHEN $3 <> '' AND kind = 'nonprofit' THEN $3 ELSE kind END WHERE id = $4",
        [extra.ein || "", extra.website || "", extra.kind || "", id]);
      return id;
    }
    const id = newId();
    await pool.query("INSERT INTO organizations (id, name, kind, ein, website, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$6)", [id, name, (extra && extra.kind) || "nonprofit", (extra && extra.ein) || "", (extra && extra.website) || "", nowIso()]);
    orgCache.set(key, id); made++;
    return id;
  }
  async function person(name, email, orgId, extra) {
    name = clean(name); email = clean(email).toLowerCase();
    if (!name && !email) return null;
    if (isEmail(name)) { if (!email) email = name.toLowerCase(); name = ""; }
    let c = email ? (await q("SELECT id, email, org_id FROM contacts WHERE lower(email) = $1 AND archived_at IS NULL LIMIT 1", [email]))[0] : null;
    if (!c && name) c = (await q("SELECT id, email, org_id FROM contacts WHERE lower(name) = lower($1) AND archived_at IS NULL AND (org_id IS NOT DISTINCT FROM $2 OR org_id IS NULL OR $2::text IS NULL) LIMIT 1", [name, orgId]))[0];
    if (c) {
      await pool.query("UPDATE contacts SET email = CASE WHEN email = '' THEN $1 ELSE email END, org_id = COALESCE(org_id, $2), phone = CASE WHEN phone = '' THEN $3 ELSE phone END WHERE id = $4", [email, orgId, (extra && extra.phone) || "", c.id]);
      return c.id;
    }
    const id = newId();
    await pool.query("INSERT INTO contacts (id, name, email, phone, org_id, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$6)", [id, name || email, email, (extra && extra.phone) || "", orgId, nowIso()]);
    made++;
    return id;
  }
  async function link(kind, refId, contactId, orgId, role) {
    if (!contactId && !orgId) return;
    await pool.query("INSERT INTO contact_links (id, kind, ref_id, contact_id, org_id, role, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (kind, ref_id) DO NOTHING", [newId(), kind, refId, contactId, orgId, role, nowIso()]);
  }

  // Prospects first, so pipeline records can borrow an email from them.
  for (const p of await q("SELECT id, name, org, notes FROM prospects WHERE archived_at IS NULL")) {
    if (linked.has("prospect|" + p.id)) continue;
    const m = EMAIL_RE.exec(`${p.name || ""} ${p.notes || ""}`);
    const o = await org(p.org);
    const c = await person(p.name === p.org ? "" : p.name, m ? m[0] : "", o);
    await link("prospect", p.id, c, o, "prospect");
  }
  for (const p of await q("SELECT id, name, org, stage FROM pipeline WHERE archived_at IS NULL")) {
    if (linked.has("pipeline|" + p.id)) continue;
    const o = await org(p.org);
    const pr = (await q("SELECT name, notes FROM prospects WHERE (lower(org) = lower($1) AND $1 <> '') OR (lower(name) = lower($2) AND $2 <> '') ORDER BY created_at DESC LIMIT 1", [p.org || "", p.name || ""]))[0];
    const m = pr ? EMAIL_RE.exec(`${pr.name || ""} ${pr.notes || ""}`) : null;
    const c = await person(p.name === p.org ? "" : p.name, m ? m[0] : "", o);
    await link("pipeline", p.id, c, o, ["engaged", "assessment", "graduated"].includes(p.stage) ? "client" : "prospect");
  }
  for (const a of await q("SELECT id, org_name, ein, website, contact_name, contact_email, contact_phone FROM gm_applications WHERE archived_at IS NULL")) {
    if (linked.has("grant|" + a.id)) continue;
    const o = await org(a.org_name, { ein: a.ein, website: a.website });
    const c = await person(a.contact_name, a.contact_email, o, { phone: a.contact_phone });
    await link("grant", a.id, c, o, "grantee");
  }
  for (const d of await q("SELECT id, kind, name, email, phone FROM fr_donors WHERE archived_at IS NULL")) {
    if (linked.has("donor|" + d.id)) continue;
    if (["individual", "family"].includes(d.kind)) { const c = await person(d.name, d.email, null, { phone: d.phone }); await link("donor", d.id, c, null, "donor"); }
    else { const o = await org(d.name, { kind: { foundation: "foundation", corporation: "company", government: "government", daf: "other" }[d.kind] || "other" }); await link("donor", d.id, null, o, "donor"); }
  }
  for (const m of await q("SELECT id, name, email FROM gov_members WHERE archived_at IS NULL")) {
    if (linked.has("member|" + m.id)) continue;
    const c = await person(m.name, m.email, null);
    await link("member", m.id, c, null, "board");
  }
  return { created: made };
}

// The best email for a record, from its linked contact.
async function lookupEmail(pool, kind, refId) {
  const r = (await pool.query("SELECT c.name, c.email FROM contact_links l JOIN contacts c ON c.id = l.contact_id WHERE l.kind = $1 AND l.ref_id = $2", [kind, refId]).catch(() => ({ rows: [] }))).rows[0];
  return r ? { name: r.name, email: r.email } : {};
}
// When a checklist learns an email, the contact learns it too.
async function rememberEmail(pool, kind, refId, name, email) {
  if (!isEmail(email)) return;
  await sync(pool);
  const l = (await pool.query("SELECT contact_id, org_id FROM contact_links WHERE kind = $1 AND ref_id = $2", [kind, refId]).catch(() => ({ rows: [] }))).rows[0];
  if (l && l.contact_id) await pool.query("UPDATE contacts SET email = CASE WHEN email = '' THEN $1 ELSE email END WHERE id = $2", [email.toLowerCase(), l.contact_id]);
  else if (l) {
    const id = newId();
    await pool.query("INSERT INTO contacts (id, name, email, org_id, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$5)", [id, name || email, email.toLowerCase(), l.org_id, nowIso()]);
    await pool.query("UPDATE contact_links SET contact_id = $1 WHERE kind = $2 AND ref_id = $3", [id, kind, refId]);
  }
}

function mount(app, { pool, requireAuth }) {
  const wrap = F.crud(app, pool, requireAuth, "/api/orgs-raw", "organizations");
  const toC = (r) => Object.assign(F.toApi("contacts", r), { orgName: r.org_name || "", roles: r.roles ? String(r.roles).split(",").filter(Boolean) : [] });
  const toO = (r) => Object.assign(F.toApi("organizations", r), { roles: r.roles ? String(r.roles).split(",").filter(Boolean) : [], people: Number(r.people) || 0 });

  app.get("/api/contacts", requireAuth, wrap(async (req, res) => {
    await sync(pool);
    const vals = [], where = ["c.archived_at IS NULL"];
    if (req.query.q) { vals.push("%" + String(req.query.q).toLowerCase() + "%"); where.push(`(lower(c.name) LIKE $${vals.length} OR lower(c.email) LIKE $${vals.length} OR lower(COALESCE(o.name, '')) LIKE $${vals.length})`); }
    let rows = (await pool.query(`SELECT c.*, o.name AS org_name, (SELECT string_agg(DISTINCT role, ',') FROM contact_links l WHERE l.contact_id = c.id) AS roles
      FROM contacts c LEFT JOIN organizations o ON o.id = c.org_id WHERE ${where.join(" AND ")} ORDER BY lower(c.name) LIMIT 2000`, vals)).rows;
    if (req.query.role) rows = rows.filter((r) => String(r.roles || "").split(",").includes(String(req.query.role)));
    res.json({ items: rows.map(toC) });
  }));
  app.post("/api/contacts", requireAuth, wrap(async (req, res) => res.status(201).json({ item: F.toApi("contacts", await F.insertRow(pool, "contacts", req.body || {})) })));
  app.patch("/api/contacts/:id", requireAuth, wrap(async (req, res) => {
    const before = (await pool.query("SELECT email FROM contacts WHERE id = $1", [req.params.id])).rows[0];
    const row = await F.updateRow(pool, "contacts", req.params.id, req.body || {});
    if (!row) return res.status(404).json({ error: "not found" });
    // Fix an email once: the board roster, donor record and grant application
    // follow, where they were blank or still had the old address.
    const old = String((before && before.email) || "").toLowerCase();
    if (req.body && req.body.email != null && row.email && row.email.toLowerCase() !== old) {
      for (const l of (await pool.query("SELECT kind, ref_id FROM contact_links WHERE contact_id = $1", [row.id])).rows) {
        if (l.kind === "member") await pool.query("UPDATE gov_members SET email = $1 WHERE id = $2 AND (COALESCE(email, '') = '' OR lower(email) = $3)", [row.email, l.ref_id, old]);
        if (l.kind === "donor") await pool.query("UPDATE fr_donors SET email = $1 WHERE id = $2 AND (COALESCE(email, '') = '' OR lower(email) = $3)", [row.email, l.ref_id, old]);
        if (l.kind === "grant") await pool.query("UPDATE gm_applications SET contact_email = $1 WHERE id = $2 AND (COALESCE(contact_email, '') = '' OR lower(contact_email) = $3)", [row.email, l.ref_id, old]);
      }
      if (old) await pool.query("UPDATE proc_runs SET contact_email = $1 WHERE lower(contact_email) = $2 AND archived_at IS NULL", [row.email, old]);
      if (old) await pool.query("UPDATE proc_outbox SET to_email = $1 WHERE lower(to_email) = $2 AND status = 'draft'", [row.email, old]);
    }
    res.json({ item: F.toApi("contacts", row) });
  }));
  app.delete("/api/contacts/:id", requireAuth, wrap(async (req, res) => {
    await pool.query("UPDATE contacts SET archived_at = $1 WHERE id = $2", [nowIso(), req.params.id]);
    res.json({ ok: true });
  }));
  app.post("/api/contacts/:id/merge", requireAuth, wrap(async (req, res) => {
    const into = req.params.id, from = String((req.body || {}).fromId || "");
    if (!from || from === into) return res.status(400).json({ error: "Pick the duplicate to merge in." });
    const a = (await pool.query("SELECT * FROM contacts WHERE id = $1", [into])).rows[0], b = (await pool.query("SELECT * FROM contacts WHERE id = $1", [from])).rows[0];
    if (!a || !b) return res.status(404).json({ error: "not found" });
    await pool.query("UPDATE contact_links SET contact_id = $1 WHERE contact_id = $2", [into, from]);
    await pool.query(`UPDATE contacts SET email = CASE WHEN email = '' THEN $1 ELSE email END, phone = CASE WHEN phone = '' THEN $2 ELSE phone END, title = CASE WHEN title = '' THEN $3 ELSE title END,
      org_id = COALESCE(org_id, $4), notes = CASE WHEN $5 = '' THEN notes WHEN notes = '' THEN $5 ELSE notes || E'\\n' || $5 END, updated_at = $6 WHERE id = $7`, [b.email, b.phone, b.title, b.org_id, b.notes || "", nowIso(), into]);
    await pool.query("UPDATE contacts SET archived_at = $1 WHERE id = $2", [nowIso(), from]);
    res.json({ ok: true });
  }));

  async function history(where, vals) {
    const links = (await pool.query(`SELECT * FROM contact_links WHERE ${where}`, vals)).rows;
    const ids = (k) => links.filter((l) => l.kind === k).map((l) => l.ref_id);
    const q = async (sql, v) => { try { return (await pool.query(sql, v)).rows; } catch (e) { return []; } };
    const deals = ids("pipeline").length ? await q("SELECT id, name, org, stage, next_step, next_step_date, deal_value, ios_overall, ios_portal_url FROM pipeline WHERE id = ANY($1)", [ids("pipeline")]) : [];
    const grants = ids("grant").length ? await q("SELECT id, org_name, project_title, status, amount_requested, amount_awarded, created_at FROM gm_applications WHERE id = ANY($1) AND archived_at IS NULL", [ids("grant")]) : [];
    const donors = ids("donor");
    const gifts = donors.length ? await q("SELECT g.id, g.donor_id, g.amount::float AS amount, g.received_on, c.name AS campaign FROM fr_gifts g LEFT JOIN fr_campaigns c ON c.id = g.campaign_id WHERE g.donor_id = ANY($1) AND g.archived_at IS NULL ORDER BY g.received_on DESC", [donors]) : [];
    const board = ids("member").length ? await q("SELECT id, role, term_start, term_end, committees FROM gov_members WHERE id = ANY($1)", [ids("member")]) : [];
    return { links, deals, grants, donors, gifts, board };
  }
  app.get("/api/contacts/:id", requireAuth, wrap(async (req, res) => {
    const c = (await pool.query("SELECT c.*, o.name AS org_name FROM contacts c LEFT JOIN organizations o ON o.id = c.org_id WHERE c.id = $1", [req.params.id])).rows[0];
    if (!c) return res.status(404).json({ error: "not found" });
    const h = await history("contact_id = $1", [c.id]);
    const email = String(c.email || "").toLowerCase();
    const runIds = (await pool.query("SELECT id FROM proc_runs WHERE archived_at IS NULL AND ((subject_kind || '|' || subject_id) = ANY($1) OR (lower(contact_email) = $2 AND $2 <> ''))",
      [h.links.map((l) => ({ pipeline: "pipeline", grant: "grant", member: "member" }[l.kind] || "x") + "|" + l.ref_id), email]).catch(() => ({ rows: [] }))).rows.map((r) => r.id);
    const runs = runIds.length ? (await pool.query("SELECT id, process_name, subject_label, started_on, completed_on, steps FROM proc_runs WHERE id = ANY($1) ORDER BY started_on DESC", [runIds])).rows : [];
    const messages = email ? (await pool.query("SELECT id, subject, status, sent_at, replied_at, created_at FROM proc_outbox WHERE lower(to_email) LIKE $1 AND status <> 'discarded' ORDER BY created_at DESC LIMIT 50", ["%" + email + "%"]).catch(() => ({ rows: [] }))).rows : [];
    const feedback = email ? (await pool.query("SELECT rating, result, created_at FROM feedback WHERE lower(email) = $1 AND archived_at IS NULL", [email]).catch(() => ({ rows: [] }))).rows : [];
    res.json({
      item: Object.assign(F.toApi("contacts", c), { orgName: c.org_name || "" }),
      roles: [...new Set(h.links.map((l) => l.role).filter(Boolean))],
      deals: h.deals.map((d) => ({ id: d.id, label: d.org || d.name, stage: d.stage, nextStep: d.next_step, nextStepDate: d.next_step_date, score: d.ios_overall == null ? null : Number(d.ios_overall), portal: d.ios_portal_url || "" })),
      grants: h.grants.map((g) => ({ id: g.id, orgName: g.org_name, project: g.project_title, status: g.status, requested: Number(g.amount_requested) || 0, awarded: Number(g.amount_awarded) || 0, date: (g.created_at || "").slice(0, 10) })),
      giving: { donorIds: h.donors, total: h.gifts.reduce((s, g) => s + (g.amount || 0), 0), gifts: h.gifts.slice(0, 20).map((g) => ({ amount: g.amount, date: g.received_on, campaign: g.campaign || "" })) },
      board: h.board.map((b) => ({ role: b.role, termStart: b.term_start, termEnd: b.term_end, committees: b.committees })),
      checklists: runs.map((r) => { const st = parseJson(r.steps, []); return { id: r.id, processName: r.process_name, subjectLabel: r.subject_label, startedOn: r.started_on, completedOn: r.completed_on, done: st.filter((x) => x.doneOn).length, total: st.length }; }),
      messages: messages.map((m) => ({ subject: m.subject, status: m.status, sentAt: m.sent_at, repliedAt: m.replied_at, createdAt: m.created_at })),
      feedback: feedback.map((f) => ({ rating: f.rating, result: f.result, date: (f.created_at || "").slice(0, 10) })),
    });
  }));

  app.get("/api/orgs", requireAuth, wrap(async (req, res) => {
    await sync(pool);
    const vals = [], where = ["o.archived_at IS NULL"];
    if (req.query.q) { vals.push("%" + String(req.query.q).toLowerCase() + "%"); where.push(`lower(o.name) LIKE $${vals.length}`); }
    const rows = (await pool.query(`SELECT o.*, (SELECT string_agg(DISTINCT role, ',') FROM contact_links l WHERE l.org_id = o.id) AS roles, (SELECT count(*) FROM contacts c WHERE c.org_id = o.id AND c.archived_at IS NULL) AS people
      FROM organizations o WHERE ${where.join(" AND ")} ORDER BY lower(o.name) LIMIT 2000`, vals)).rows;
    res.json({ items: rows.map(toO) });
  }));
  app.post("/api/orgs", requireAuth, wrap(async (req, res) => res.status(201).json({ item: F.toApi("organizations", await F.insertRow(pool, "organizations", req.body || {})) })));
  app.patch("/api/orgs/:id", requireAuth, wrap(async (req, res) => {
    const row = await F.updateRow(pool, "organizations", req.params.id, req.body || {});
    if (!row) return res.status(404).json({ error: "not found" });
    res.json({ item: F.toApi("organizations", row) });
  }));
  app.get("/api/orgs/:id", requireAuth, wrap(async (req, res) => {
    const o = (await pool.query("SELECT * FROM organizations WHERE id = $1", [req.params.id])).rows[0];
    if (!o) return res.status(404).json({ error: "not found" });
    const people = (await pool.query("SELECT id, name, email, title FROM contacts WHERE org_id = $1 AND archived_at IS NULL ORDER BY lower(name)", [o.id])).rows;
    const h = await history("org_id = $1 OR contact_id = ANY($2)", [o.id, people.map((p) => p.id)]);
    const scan = o.ein ? (await pool.query("SELECT public_score, growth_flag, situation FROM market_orgs WHERE replace(ein, '-', '') = replace($1, '-', '') LIMIT 1", [o.ein]).catch(() => ({ rows: [] }))).rows[0] : null;
    res.json({
      item: F.toApi("organizations", o), people,
      roles: [...new Set(h.links.map((l) => l.role).filter(Boolean))],
      deals: h.deals.map((d) => ({ id: d.id, label: d.org || d.name, stage: d.stage, score: d.ios_overall == null ? null : Number(d.ios_overall) })),
      grants: h.grants.map((g) => ({ id: g.id, project: g.project_title, status: g.status, awarded: Number(g.amount_awarded) || 0, date: (g.created_at || "").slice(0, 10) })),
      giving: { total: h.gifts.reduce((s, g) => s + (g.amount || 0), 0), count: h.gifts.length },
      scan: scan ? { publicScore: scan.public_score == null ? null : Number(scan.public_score), growth: scan.growth_flag, situation: scan.situation } : null,
    });
  }));
}

module.exports = { mount, sync, lookupEmail, rememberEmail };
