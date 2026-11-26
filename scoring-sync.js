"use strict";
// Do the free check-up and the paid Diagnostic score the same way?
// The website publishes its model at /scoring-model.json and InstitutionalOS
// at /scoring-model, in one shape:
//   { version, stages: { BUILD|FUND|SUSTAIN: { weights: {area: n}, minimums: {area: n} } }, legacyMarkers: [key] }
// compare() lists every difference in plain words; an empty list means they agree.

const LABEL = { strategy: "Strategy", program: "Program", financial: "Revenue/financial", leadership: "Leadership", operations: "Operations", partnerships: "Partnerships", governance: "Governance" };
const name = (k) => LABEL[k] || k;
const title = (s) => s.charAt(0) + s.slice(1).toLowerCase();

function compare(site, ios) {
  const diffs = [];
  const sa = (site && site.stages) || {}, ia = (ios && ios.stages) || {};
  for (const st of new Set([...Object.keys(sa), ...Object.keys(ia)])) {
    if (!sa[st] || !ia[st]) { diffs.push(`${title(st)} path is only in ${sa[st] ? "the website" : "InstitutionalOS"}`); continue; }
    for (const part of ["weights", "minimums"]) {
      const a = sa[st][part] || {}, b = ia[st][part] || {};
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (a[k] !== b[k]) diffs.push(`${title(st)} ${part === "weights" ? "weight" : "minimum"} for ${name(k)}: website ${a[k] == null ? "none" : a[k]}, InstitutionalOS ${b[k] == null ? "none" : b[k]}`);
      }
    }
  }
  const la = (site && site.legacyMarkers) || [], lb = (ios && ios.legacyMarkers) || [];
  for (const k of la) if (!lb.includes(k)) diffs.push(`Legacy marker "${k}" is only on the website`);
  for (const k of lb) if (!la.includes(k)) diffs.push(`Legacy marker "${k}" is only in InstitutionalOS`);
  return diffs;
}

async function getJson(url, ms) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms || 60000) });
  if (!r.ok) throw new Error(`${url} answered ${r.status}`);
  return r.json();
}

// The reconcile check. siteUrl is the public website; iosUrl the InstitutionalOS API.
async function check({ siteUrl, iosUrl }) {
  if (!siteUrl || !iosUrl) return { status: "skipped", error: "website or InstitutionalOS address not set" };
  try {
    const [site, ios] = await Promise.all([getJson(siteUrl.replace(/\/+$/, "") + "/scoring-model.json", 30000), getJson(iosUrl.replace(/\/+$/, "") + "/scoring-model", 70000)]);
    const differences = compare(site, ios);
    return { status: differences.length ? "mismatch" : "ok", differences };
  } catch (e) {
    return { status: "error", error: e.name === "TimeoutError" ? "timed out" : String(e.message || e) };
  }
}

module.exports = { compare, check };
