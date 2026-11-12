// DMV market scan: every active public charity in the DC, Maryland, and
// Northern Virginia market that files a full Form 990, read from public
// records only, so Franklin knows his backyard before any outreach.
//
// 1. Roster: the IRS Exempt Organizations Business Master File (one CSV per
//    state at irs.gov/pub/irs-soi/eo_<st>.csv), filtered to 501(c)(3) public
//    charities that file a Form 990, in DMV ZIP areas, in the chosen revenue
//    range and program areas.
// 2. Filings: each organization's e-filed 990 history from ProPublica's
//    Nonprofit Explorer API, reduced to a few figures per year.
// 3. Signals: what those figures can and can't say. Only revenue and
//    financial health are visible in public filings; the other six
//    dimensions need the Diagnostic. Nothing here is shown publicly.
//
// Everything runs inside the FIOS server, one ProPublica request at a time,
// and resumes where it left off (Render's free tier sleeps when idle).

const IRS_BMF_URL = (st) => `https://www.irs.gov/pub/irs-soi/eo_${st}.csv`;
const PP_ORG_URL = (ein) => `https://projects.propublica.org/nonprofits/api/v2/organizations/${ein}.json`;

// ZIP areas (first three digits) that make up the DMV market. Areas are by
// ZIP prefix, so they approximate county lines.
const AREAS = {
  "200": "Washington, DC", "202": "Washington, DC", "203": "Washington, DC", "204": "Washington, DC", "205": "Washington, DC",
  "206": "Suburban Maryland", "207": "Suburban Maryland", "208": "Suburban Maryland", "209": "Suburban Maryland",
  "210": "Baltimore and Central Maryland", "211": "Baltimore and Central Maryland", "212": "Baltimore and Central Maryland", "214": "Baltimore and Central Maryland",
  "217": "Frederick",
  "201": "Northern Virginia", "220": "Northern Virginia", "221": "Northern Virginia", "222": "Northern Virginia", "223": "Northern Virginia",
};
const STATE_FILES = ["dc", "md", "va"];

// NTEE major groups (first letter of the NTEE code).
const NTEE_GROUPS = {
  B: "Education", O: "Youth development", J: "Employment and workforce", P: "Human services",
  A: "Arts and culture", E: "Health care", F: "Mental health", I: "Crime and legal", K: "Food and nutrition",
  L: "Housing", N: "Recreation and sports", R: "Civil rights", S: "Community improvement", T: "Philanthropy", W: "Public benefit",
  C: "Environment", D: "Animals", G: "Diseases", H: "Medical research", M: "Public safety", Q: "International", U: "Science", V: "Social science", X: "Religion", Y: "Mutual benefit", Z: "Unknown",
};
const DEFAULT_FILTERS = { minRevenue: 500000, maxRevenue: 20000000, ntee: ["B", "O", "J", "P"] };

const SITUATIONS = {
  expansion: "Expansion Readiness", funder: "Funder Readiness", founder: "Founder Dependence",
  strain: "Capacity Strain", transition: "Leadership Transition", checkup: "Check-up",
};

function parseCsvLine(line) {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

// Rows from one state's BMF CSV that belong in the market.
function filterRoster(csvText, filters) {
  const lines = csvText.split(/\r?\n/);
  const header = parseCsvLine(lines[0] || "").map((h) => h.trim().toUpperCase());
  const col = (n) => header.indexOf(n);
  const need = ["EIN", "NAME", "CITY", "STATE", "ZIP", "SUBSECTION", "FOUNDATION", "STATUS", "FILING_REQ_CD", "REVENUE_AMT", "ASSET_AMT", "NTEE_CD", "RULING", "TAX_PERIOD"];
  const missing = need.filter((n) => col(n) < 0);
  if (missing.length) throw new Error("IRS file is missing columns: " + missing.join(", "));
  const ix = Object.fromEntries(need.map((n) => [n, col(n)]));
  const ntee = new Set(filters.ntee && filters.ntee.length ? filters.ntee : Object.keys(NTEE_GROUPS));
  const rows = [];
  let scanned = 0;
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    scanned++;
    const f = parseCsvLine(lines[i]);
    const zip = (f[ix.ZIP] || "").trim();
    const area = AREAS[zip.slice(0, 3)];
    if (!area) continue;
    if ((f[ix.SUBSECTION] || "").trim() !== "03") continue;                     // 501(c)(3)
    if (["02", "03", "04"].includes((f[ix.FOUNDATION] || "").trim())) continue;  // private foundations
    if ((f[ix.STATUS] || "").trim() !== "01") continue;                          // unconditional exemption
    if ((f[ix.FILING_REQ_CD] || "").trim() !== "01") continue;                   // files a 990 or 990-EZ
    const revenue = Number(f[ix.REVENUE_AMT]) || 0;
    if (revenue < filters.minRevenue || revenue > filters.maxRevenue) continue;
    const code = (f[ix.NTEE_CD] || "").trim().toUpperCase();
    if (!ntee.has(code.slice(0, 1) || "Z")) continue;
    rows.push({
      ein: (f[ix.EIN] || "").replace(/\D/g, "").padStart(9, "0"),
      name: (f[ix.NAME] || "").trim(), city: (f[ix.CITY] || "").trim(), state: (f[ix.STATE] || "").trim(), zip: zip.slice(0, 5), area,
      ntee: code, revenue, assets: Number(f[ix.ASSET_AMT]) || 0, ruling: (f[ix.RULING] || "").trim(), taxPeriod: (f[ix.TAX_PERIOD] || "").trim(),
    });
  }
  return { rows, scanned };
}

const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

// What the public filings can say, as plain figures and flags.
function computeSignals(pp, now = new Date()) {
  const filings = ((pp && pp.filings_with_data) || []).filter((f) => f && f.tax_prd_yr)
    .sort((a, b) => a.tax_prd_yr - b.tax_prd_yr);
  const years = filings.slice(-5).map((f) => ({
    year: f.tax_prd_yr, revenue: num(f.totrevenue) || 0, expenses: num(f.totfuncexpns) || 0,
    assets: num(f.totassetsend), liabilities: num(f.totliabend), netAssets: num(f.totnetassetend),
    contributions: num(f.totcntrbgfts) || 0, programRevenue: num(f.totprgmrevnue) || 0, formType: f.formtype === undefined ? null : f.formtype,
  }));
  const org = (pp && pp.organization) || {};
  if (!years.length) return { years, noFilings: true, observations: [{ text: "No e-filed Form 990 data in ProPublica's Nonprofit Explorer yet.", question: "Ask for the last two 990s directly." }], ruling: org.ruling_date || null };
  const last = years[years.length - 1], first = years[0];
  const span = last.year - first.year;
  const margin = last.revenue > 0 ? (last.revenue - last.expenses) / last.revenue : null;
  const reserveMonths = last.netAssets !== null && last.expenses > 0 ? last.netAssets / (last.expenses / 12) : null;
  const recent = years.slice(-3);
  const deficitYears = recent.filter((y) => y.revenue - y.expenses < 0).length;
  const revenueChange = span > 0 && first.revenue > 0 ? (last.revenue - first.revenue) / first.revenue : null;
  const expenseChange = span > 0 && first.expenses > 0 ? (last.expenses - first.expenses) / first.expenses : null;
  const debtRatio = last.liabilities !== null && last.assets ? last.liabilities / last.assets : null;
  const contributionShare = last.revenue > 0 ? last.contributions / last.revenue : null;
  const prevReserve = years.length > 1 && years[0].netAssets !== null && years[0].expenses > 0 ? years[0].netAssets / (years[0].expenses / 12) : null;
  const filingAge = now.getUTCFullYear() - last.year;

  // A public financial score, 0-100, from five checks on the evidence-rubric
  // scale. Covers Revenue and Financial Health only.
  const band = (v, steps) => { for (const [min, pts] of steps) if (v >= min) return pts; return steps[steps.length - 1][1]; };
  const parts = [];
  if (reserveMonths !== null) parts.push(band(reserveMonths, [[6, 100], [3, 75], [1, 50], [0, 25], [-Infinity, 0]]));
  if (margin !== null) parts.push(band(margin, [[0.05, 100], [0, 75], [-0.05, 50], [-0.15, 25], [-Infinity, 0]]));
  parts.push([100, 75, 40, 10][deficitYears] ?? 10);
  if (debtRatio !== null) parts.push(band(-debtRatio, [[-0.25, 100], [-0.5, 75], [-0.75, 50], [-Infinity, 25]]));
  if (revenueChange !== null) parts.push(band(revenueChange, [[0, 100], [-0.1, 70], [-Infinity, 40]]));
  const publicScore = parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : null;

  // Franklin's thesis: programs growing faster than the institution can carry them.
  let growth = "steady";
  if (revenueChange !== null && revenueChange >= 0.2 && span >= 2) {
    const strained = (reserveMonths !== null && reserveMonths < 3) || (expenseChange !== null && expenseChange > revenueChange) || (margin !== null && margin < 0);
    growth = strained ? "outpacing" : "growing";
  } else if (revenueChange !== null && revenueChange <= -0.1) growth = "declining";

  let situation = "checkup";
  if (growth === "outpacing") situation = "strain";
  else if (growth === "declining" || deficitYears >= 2) situation = "funder";
  else if (growth === "growing") situation = "expansion";

  const usd = (n) => "$" + Math.round(n).toLocaleString("en-US");
  const pct = (n) => Math.round(n * 100) + "%";
  const obs = [];
  if (growth === "outpacing") obs.push({ text: `Revenue grew ${pct(revenueChange)} from ${first.year} to ${last.year}${expenseChange !== null ? ` while expenses grew ${pct(expenseChange)}` : ""}${reserveMonths !== null ? `; reserves now cover ${reserveMonths.toFixed(1)} months` : ""}.`, question: "What has that growth done to your leadership team's bandwidth? Which decisions still route to the executive director?" });
  else if (growth === "growing") obs.push({ text: `Revenue grew ${pct(revenueChange)} from ${first.year} to ${last.year} with reserves holding${reserveMonths !== null ? ` at ${reserveMonths.toFixed(1)} months` : ""}.`, question: "What's the next big move: a new site, a larger grant, a leadership change?" });
  else if (growth === "declining") obs.push({ text: `Revenue fell ${pct(-revenueChange)} from ${first.year} to ${last.year}.`, question: "Was that a grant ending or a planned change? What replaces it?" });
  if (deficitYears >= 2) obs.push({ text: `Expenses exceeded revenue in ${deficitYears} of the last ${recent.length} filed years.`, question: "Are the deficits a planned investment or a structural gap?" });
  else if (margin !== null && margin < 0) obs.push({ text: `A deficit of ${usd(last.expenses - last.revenue)} in ${last.year}.`, question: "Was last year's deficit planned?" });
  if (reserveMonths !== null && reserveMonths < 3) obs.push({ text: `Net assets cover about ${reserveMonths.toFixed(1)} months of expenses (including any restricted funds).`, question: "What would a 90-day delay in your largest grant do to operations?" });
  if (contributionShare !== null && contributionShare >= 0.9) obs.push({ text: `${pct(contributionShare)} of revenue is contributions and grants.`, question: "How concentrated is that among your top three funders?" });
  if (debtRatio !== null && debtRatio >= 0.5) obs.push({ text: `Liabilities equal ${pct(debtRatio)} of assets.`, question: "What's behind the liabilities: a facility, a line of credit, deferred grants?" });
  if (filingAge >= 3) obs.push({ text: `The latest e-filed 990 is for ${last.year}.`, question: "What has changed since that filing?" });
  if (!obs.length) obs.push({ text: `Balanced budgets${reserveMonths !== null ? ` and ${reserveMonths.toFixed(1)} months of reserves` : ""} in the filed years.`, question: "What decision are you preparing for in the next year?" });

  return {
    years, latestYear: last.year, revenue: last.revenue, expenses: last.expenses, margin, reserveMonths, prevReserveMonths: prevReserve,
    deficitYears, revenueChange, expenseChange, debtRatio, contributionShare, filingAge, publicScore, growth, situation,
    observations: obs.slice(0, 4), ruling: org.ruling_date || null, nteeCode: org.ntee_code || null,
  };
}

// How promising a conversation looks, for sorting: size in the sweet spot,
// core program areas, a visible need, a current filing.
function fitScore(row, sig) {
  let s = 0;
  const rev = (sig && sig.revenue) || row.bmf_revenue || 0;
  if (rev >= 1e6 && rev <= 1e7) s += 3; else if (rev >= 5e5 && rev <= 2e7) s += 1;
  if ("BOJ".includes((row.ntee || "Z").slice(0, 1))) s += 2; else if ((row.ntee || "").startsWith("P")) s += 1;
  if (sig && !sig.noFilings) {
    if (sig.growth === "outpacing") s += 3;
    if (sig.deficitYears >= 2) s += 2;
    if (sig.reserveMonths !== null && sig.reserveMonths < 3) s += 1;
    if (sig.growth === "growing") s += 1;
    if (sig.filingAge <= 2) s += 1;
  }
  return s;
}

function setup(app, { pool, requireAuth, requireAdminScope, ppUserAgent, newId, iosFetch, grantpassDashboard, grantpassApi }) {
  const state = { running: false, stopRequested: false, phase: "idle", done: 0, total: 0, errors: 0, lastError: "", startedAt: null };

  async function getSettings() {
    const { rows } = await pool.query("SELECT data FROM market_scan_state WHERE id = 'settings'");
    return { ...DEFAULT_FILTERS, ...(rows[0] ? JSON.parse(rows[0].data) : {}) };
  }
  async function saveSettings(data) {
    await pool.query("INSERT INTO market_scan_state (id, data) VALUES ('settings', $1) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data", [JSON.stringify(data)]);
  }

  async function fetchText(url, ms) {
    const r = await fetch(url, { headers: { "User-Agent": ppUserAgent }, signal: AbortSignal.timeout(ms) });
    if (!r.ok) throw new Error(`${url} returned HTTP ${r.status}`);
    return r.text();
  }

  async function buildRoster(filters) {
    state.phase = "roster";
    const now = new Date().toISOString();
    let kept = 0, scanned = 0;
    for (const st of STATE_FILES) {
      const text = await fetchText(IRS_BMF_URL(st), 120000);
      const out = filterRoster(text, filters);
      scanned += out.scanned;
      for (const r of out.rows) {
        await pool.query(
          `INSERT INTO market_orgs (ein, name, city, state, zip, area, ntee, bmf_revenue, bmf_assets, ruling, tax_period, roster_seen_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
           ON CONFLICT (ein) DO UPDATE SET name = EXCLUDED.name, city = EXCLUDED.city, state = EXCLUDED.state, zip = EXCLUDED.zip, area = EXCLUDED.area,
             ntee = EXCLUDED.ntee, bmf_revenue = EXCLUDED.bmf_revenue, bmf_assets = EXCLUDED.bmf_assets, ruling = EXCLUDED.ruling,
             tax_period = EXCLUDED.tax_period, roster_seen_at = EXCLUDED.roster_seen_at`,
          [r.ein, r.name, r.city, r.state, r.zip, r.area, r.ntee, r.revenue, r.assets, r.ruling, r.taxPeriod, now]
        );
        kept++;
      }
    }
    const settings = await getSettings();
    settings.rosterBuiltAt = now; settings.rosterCount = kept; settings.rosterScanned = scanned;
    settings.minRevenue = filters.minRevenue; settings.maxRevenue = filters.maxRevenue; settings.ntee = filters.ntee;
    await saveSettings(settings);
    return { kept, scanned };
  }

  async function enrichOne(row) {
    try {
      const r = await fetch(PP_ORG_URL(row.ein), { headers: { "User-Agent": ppUserAgent }, signal: AbortSignal.timeout(15000) });
      if (r.status === 404) {
        const sig = { years: [], noFilings: true, observations: [{ text: "Not found in ProPublica's Nonprofit Explorer.", question: "Ask for the last two 990s directly." }] };
        await pool.query("UPDATE market_orgs SET signals = $1, public_score = NULL, growth_flag = '', situation = 'checkup', fit = $2, enriched_at = $3, enrich_error = '' WHERE ein = $4",
          [JSON.stringify(sig), fitScore(row, sig), new Date().toISOString(), row.ein]);
        return true;
      }
      if (!r.ok) throw new Error("ProPublica HTTP " + r.status);
      const sig = computeSignals(await r.json());
      await pool.query(
        "UPDATE market_orgs SET signals = $1, public_score = $2, growth_flag = $3, situation = $4, fit = $5, enriched_at = $6, enrich_error = '' WHERE ein = $7",
        [JSON.stringify(sig), sig.publicScore, sig.growth || "", sig.situation || "checkup", fitScore(row, sig), new Date().toISOString(), row.ein]
      );
      return true;
    } catch (err) {
      await pool.query("UPDATE market_orgs SET enrich_error = $1 WHERE ein = $2", [String(err.message || err).slice(0, 200), row.ein]);
      state.errors++; state.lastError = String(err.message || err);
      return false;
    }
  }

  // Organizations still needing filings (or whose last pull is 45+ days old),
  // the most promising first by IRS revenue.
  async function pending(limit) {
    const { rows } = await pool.query(
      `SELECT * FROM market_orgs WHERE enriched_at IS NULL OR enriched_at < $1
       ORDER BY (enriched_at IS NULL) DESC, (enrich_error <> '') ASC, bmf_revenue DESC LIMIT $2`,
      [new Date(Date.now() - 45 * 864e5).toISOString(), limit]
    );
    return rows;
  }

  async function run({ rebuild, filters, max }) {
    if (state.running) return;
    Object.assign(state, { running: true, stopRequested: false, done: 0, errors: 0, lastError: "", startedAt: new Date().toISOString() });
    try {
      const settings = await getSettings();
      const stale = !settings.rosterBuiltAt || Date.now() - Date.parse(settings.rosterBuiltAt) > 30 * 864e5;
      if (rebuild || stale) await buildRoster(filters || settings);
      state.phase = "filings";
      const { rows: [{ n }] } = await pool.query("SELECT count(*)::int AS n FROM market_orgs WHERE enriched_at IS NULL OR enriched_at < $1", [new Date(Date.now() - 45 * 864e5).toISOString()]);
      state.total = Math.min(n, max || n);
      while (!state.stopRequested && state.done < state.total) {
        const batch = await pending(25);
        if (!batch.length) break;
        for (const row of batch) {
          if (state.stopRequested || state.done >= state.total) break;
          await enrichOne(row);
          state.done++;
          await new Promise((res) => setTimeout(res, 1100)); // be polite to ProPublica
        }
      }
      state.phase = state.stopRequested ? "stopped" : "done";
    } catch (err) {
      state.phase = "error"; state.lastError = String(err.message || err);
      console.error("market scan failed:", err);
    } finally {
      state.running = false;
    }
  }

  async function summary() {
    const settings = await getSettings();
    const { rows: [t] } = await pool.query(`SELECT count(*)::int AS orgs,
        count(*) FILTER (WHERE enriched_at IS NOT NULL)::int AS enriched,
        count(*) FILTER (WHERE growth_flag = 'outpacing')::int AS outpacing,
        count(*) FILTER (WHERE growth_flag = 'growing')::int AS growing,
        count(*) FILTER (WHERE growth_flag = 'declining')::int AS declining,
        count(*) FILTER (WHERE (nullif(signals, '')::jsonb->>'deficitYears')::int >= 2)::int AS deficits,
        count(*) FILTER (WHERE (nullif(signals, '')::jsonb->>'reserveMonths')::float < 3)::int AS thin_reserves,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY (nullif(signals, '')::jsonb->>'reserveMonths')::float) AS median_reserves,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY public_score) AS median_score
      FROM market_orgs`);
    const { rows: byArea } = await pool.query(`SELECT area, count(*)::int AS orgs, count(*) FILTER (WHERE growth_flag = 'outpacing')::int AS outpacing,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY public_score) AS median_score FROM market_orgs GROUP BY area ORDER BY orgs DESC`);
    const { rows: byType } = await pool.query(`SELECT left(coalesce(nullif(ntee, ''), 'Z'), 1) AS grp, count(*)::int AS orgs, count(*) FILTER (WHERE growth_flag = 'outpacing')::int AS outpacing
        FROM market_orgs GROUP BY grp ORDER BY orgs DESC`);
    return {
      settings, totals: t, byArea, byType: byType.map((r) => ({ ...r, label: NTEE_GROUPS[r.grp] || r.grp })),
      progress: { ...state }, nteeGroups: NTEE_GROUPS, situations: SITUATIONS,
    };
  }

  function rowOut(r) {
    const sig = r.signals ? JSON.parse(r.signals) : null;
    return {
      ein: r.ein, name: r.name, city: r.city, state: r.state, area: r.area, ntee: r.ntee, nteeGroup: NTEE_GROUPS[(r.ntee || "Z").slice(0, 1)] || "",
      bmfRevenue: r.bmf_revenue === null ? null : Number(r.bmf_revenue), ruling: r.ruling, publicScore: r.public_score === null ? null : Number(r.public_score),
      growth: r.growth_flag || "", situation: r.situation || "", situationLabel: SITUATIONS[r.situation] || "", fit: r.fit || 0,
      status: r.status || "new", notes: r.notes || "", prospectId: r.prospect_id || null, iosOrgId: r.ios_org_id || null,
      enrichedAt: r.enriched_at, enrichError: r.enrich_error || "", signals: sig,
      propublica: `https://projects.propublica.org/nonprofits/organizations/${r.ein}`,
    };
  }

  // ---------- routes ----------
  app.get("/api/market-scan", requireAuth, async (req, res) => {
    try { res.json(await summary()); } catch (e) { console.error(e); res.status(500).json({ error: "could not load the market scan" }); }
  });
  app.get("/api/market-scan/orgs", requireAuth, async (req, res) => {
    const q = req.query || {};
    const where = [], vals = [];
    const add = (sql, v) => { vals.push(v); where.push(sql.replace("$?", "$" + vals.length)); };
    if (q.area) add("area = $?", String(q.area));
    if (q.type) add("left(coalesce(nullif(ntee, ''), 'Z'), 1) = $?", String(q.type).slice(0, 1));
    if (q.growth) add("growth_flag = $?", String(q.growth));
    if (q.status) add("status = $?", String(q.status));
    if (q.situation) add("situation = $?", String(q.situation));
    if (q.q) add("name ILIKE $?", "%" + String(q.q).slice(0, 80) + "%");
    if (q.minRev) add("coalesce((nullif(signals, '')::jsonb->>'revenue')::numeric, bmf_revenue) >= $?", Number(q.minRev) || 0);
    if (q.maxRev) add("coalesce((nullif(signals, '')::jsonb->>'revenue')::numeric, bmf_revenue) <= $?", Number(q.maxRev) || 1e12);
    const sorts = { fit: "fit DESC NULLS LAST, bmf_revenue DESC", score: "public_score ASC NULLS LAST", revenue: "bmf_revenue DESC", name: "name ASC" };
    const order = sorts[q.sort] || sorts.fit;
    const limit = Math.min(Math.max(parseInt(q.limit, 10) || 100, 1), 1000);
    const offset = Math.max(parseInt(q.offset, 10) || 0, 0);
    try {
      const w = where.length ? "WHERE " + where.join(" AND ") : "";
      const { rows } = await pool.query(`SELECT * FROM market_orgs ${w} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`, vals);
      const { rows: [c] } = await pool.query(`SELECT count(*)::int AS n FROM market_orgs ${w}`, vals);
      res.json({ total: c.n, orgs: rows.map(rowOut) });
    } catch (e) { console.error(e); res.status(500).json({ error: "could not load organizations" }); }
  });
  app.get("/api/market-scan/export.csv", requireAuth, async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM market_orgs ORDER BY fit DESC NULLS LAST, bmf_revenue DESC");
    const q = (v) => '"' + String(v === null || v === undefined ? "" : v).replace(/"/g, '""') + '"';
    const head = ["EIN", "Name", "City", "State", "Area", "NTEE", "Program area", "Latest revenue", "Latest filed year", "Public financial score", "Reserve months", "Deficit years (last 3)", "Revenue change", "Growth signal", "Likely situation", "Fit", "Status", "Notes", "ProPublica"];
    const lines = [head.map(q).join(",")].concat(rows.map((r) => {
      const o = rowOut(r), s = o.signals || {};
      return [o.ein, o.name, o.city, o.state, o.area, o.ntee, o.nteeGroup, s.revenue ?? o.bmfRevenue, s.latestYear ?? "", o.publicScore ?? "",
        s.reserveMonths != null ? s.reserveMonths.toFixed(1) : "", s.deficitYears ?? "", s.revenueChange != null ? Math.round(s.revenueChange * 100) + "%" : "",
        o.growth, o.situationLabel, o.fit, o.status, o.notes, o.propublica].map(q).join(",");
    }));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=dmv-market-scan.csv");
    res.send("﻿" + lines.join("\r\n") + "\r\n");
  });
  app.post("/api/market-scan/run", requireAuth, async (req, res) => {
    const b = req.body || {};
    if (state.running) return res.json({ ok: true, running: true, progress: state });
    const settings = await getSettings();
    const filters = {
      minRevenue: Number.isFinite(Number(b.minRevenue)) && b.minRevenue !== "" ? Number(b.minRevenue) : settings.minRevenue,
      maxRevenue: Number.isFinite(Number(b.maxRevenue)) && b.maxRevenue !== "" ? Number(b.maxRevenue) : settings.maxRevenue,
      ntee: Array.isArray(b.ntee) ? b.ntee.filter((k) => NTEE_GROUPS[k]) : settings.ntee,
    };
    run({ rebuild: b.rebuild === true, filters, max: b.max ? Number(b.max) : 0 });
    res.json({ ok: true, started: true });
  });
  app.post("/api/market-scan/stop", requireAuth, (req, res) => { state.stopRequested = true; res.json({ ok: true }); });
  // For a scheduled task: keep the scan fresh. Starts a run if none is going.
  app.post("/api/admin/market-scan/step", requireAdminScope("status"), async (req, res) => {
    if (!state.running) run({ rebuild: false, max: Math.min(parseInt((req.body || {}).max, 10) || 400, 2000) });
    res.json({ ok: true, progress: state });
  });

  app.patch("/api/market-scan/orgs/:ein", requireAuth, async (req, res) => {
    const b = req.body || {};
    const statuses = new Set(["new", "watch", "prospect", "not_fit", "client"]);
    const sets = [], vals = [];
    if (statuses.has(b.status)) { vals.push(b.status); sets.push(`status = $${vals.length}`); }
    if (typeof b.notes === "string") { vals.push(b.notes.slice(0, 4000)); sets.push(`notes = $${vals.length}`); }
    if (!sets.length) return res.json({ ok: true });
    vals.push(new Date().toISOString()); sets.push(`updated_at = $${vals.length}`);
    vals.push(req.params.ein);
    await pool.query(`UPDATE market_orgs SET ${sets.join(", ")} WHERE ein = $${vals.length}`, vals);
    res.json({ ok: true });
  });
  app.post("/api/market-scan/orgs/:ein/refresh", requireAuth, async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM market_orgs WHERE ein = $1", [req.params.ein]);
    if (!rows[0]) return res.status(404).json({ error: "not found" });
    await enrichOne(rows[0]);
    const { rows: r2 } = await pool.query("SELECT * FROM market_orgs WHERE ein = $1", [req.params.ein]);
    res.json(rowOut(r2[0]));
  });

  // Into Prospecting, with the public picture in the notes. Nothing is sent
  // to the organization.
  app.post("/api/market-scan/orgs/:ein/prospect", requireAuth, async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM market_orgs WHERE ein = $1", [req.params.ein]);
    const r = rows[0];
    if (!r) return res.status(404).json({ error: "not found" });
    const o = rowOut(r), s = o.signals || {};
    const notes = [
      `DMV market scan (public records only). ${o.nteeGroup || ""}${o.area ? ", " + o.area : ""}.`,
      s.latestYear ? `Latest filed year ${s.latestYear}: revenue $${Math.round(s.revenue).toLocaleString("en-US")}; public financial score ${o.publicScore ?? "n/a"}.` : "",
      ...(s.observations || []).map((x) => `- ${x.text} Ask: ${x.question}`),
      o.situationLabel ? `Likely situation: ${o.situationLabel} (inferred from filings).` : "",
    ].filter(Boolean).join("\n");
    const id = newId();
    const ins = await pool.query(
      `INSERT INTO prospects (id, name, org, source, status, link, notes, created_at, source_ref, interest, org_stage, trigger_key)
       VALUES ($1,$2,$3,'market-scan','new',$4,$5,$6,$7,'institutionalos-diagnostic',$8,$9) ON CONFLICT (source_ref) DO NOTHING`,
      [id, o.name, o.name, o.propublica, notes, new Date().toISOString(), "scan-" + o.ein,
       (s.revenue || o.bmfRevenue || 0) >= 5e6 && (s.reserveMonths || 0) >= 3 ? "sustain" : "fund", ["strain", "expansion", "funder"].includes(o.situation) ? o.situation : ""]
    );
    const pid = ins.rowCount ? id : ((await pool.query("SELECT id FROM prospects WHERE source_ref = $1", ["scan-" + o.ein])).rows[0] || {}).id;
    await pool.query("UPDATE market_orgs SET status = CASE WHEN status IN ('new','watch') THEN 'prospect' ELSE status END, prospect_id = $1, updated_at = $2 WHERE ein = $3", [pid, new Date().toISOString(), o.ein]);
    res.json({ ok: true, prospectId: pid, created: ins.rowCount > 0 });
  });

  // A demo in InstitutionalOS from public data only: financial health scored
  // from the latest filing, the other six dimensions waiting on evidence.
  app.post("/api/market-scan/orgs/:ein/demo", requireAuth, async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM market_orgs WHERE ein = $1", [req.params.ein]);
    const r = rows[0];
    if (!r) return res.status(404).json({ error: "not found" });
    const o = rowOut(r), s = o.signals || {};
    const last = (s.years || [])[s.years ? s.years.length - 1 : 0];
    if (!last) return res.status(400).json({ error: "no e-filed 990 figures to load for this organization" });
    try {
      const stage = (s.revenue || 0) >= 5e6 && (s.reserveMonths || 0) >= 3 ? "SUSTAIN" : "FUND";
      const link = await iosFetch("/integration/orgs", { method: "POST", body: { externalRef: "scan-" + o.ein, name: o.name, stage, ein: o.ein } });
      await iosFetch(`/integration/orgs/${link.orgId}/financials`, { method: "POST", body: {
        source: "propublica", fiscal_year: last.year, total_revenue: last.revenue, total_expenses: last.expenses, total_assets: last.assets,
        net_assets: last.netAssets, contributions_revenue: last.contributions, program_revenue: last.programRevenue } });
      await pool.query("UPDATE market_orgs SET ios_org_id = $1, updated_at = $2 WHERE ein = $3", [link.orgId, new Date().toISOString(), o.ein]);
      const view = link.clientToken ? `${grantpassDashboard}/report.html?client=${encodeURIComponent(link.clientToken)}&api=${encodeURIComponent(grantpassApi)}` : "";
      res.json({ ok: true, orgId: link.orgId, view, console: grantpassDashboard + "/" });
    } catch (err) {
      res.status(502).json({ error: err.name === "AbortError" ? "InstitutionalOS did not answer within 60 seconds" : String(err.message || err) });
    }
  });
}

module.exports = { setup, filterRoster, computeSignals, fitScore, AREAS, NTEE_GROUPS };
