/* Foundation areas: Grants (giving money out) and Fundraising (raising it).
   Server side is foundation.js; this file only draws the two views and talks
   to /api/gm/* and /api/fr/*. Board accounts see everything read-only (the
   forms and row buttons are hidden by the role-board styles). */
(function () {
  "use strict";

  // ---------- helpers ----------
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function money(n) { n = Number(n) || 0; return "$" + n.toLocaleString("en-US", { maximumFractionDigits: n % 1 ? 2 : 0, minimumFractionDigits: n % 1 ? 2 : 0 }); }
  function pct(a, b) { return b > 0 ? Math.round((a / b) * 100) : 0; }
  function today() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function fmtDate(iso) {
    if (!/^\d{4}-\d{2}-\d{2}/.test(iso || "")) return "";
    var d = new Date(iso.slice(0, 10) + "T12:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  function api(url, opts) {
    opts = opts || {};
    if (opts.body && typeof opts.body !== "string") {
      opts.headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
      opts.body = JSON.stringify(opts.body);
    }
    return fetch(url, opts).then(function (res) {
      if (res.status === 401) { window.location.href = "/"; throw new Error("not signed in"); }
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) throw new Error(body.error || ("request failed: " + res.status));
        return body;
      });
    });
  }
  function formData(form) {
    var out = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name || el.disabled) return;
      if (el.type === "checkbox") out[el.name] = el.checked;
      else out[el.name] = el.value;
    });
    return out;
  }
  function flash(el, text, bad) { if (!el) return; el.textContent = text; el.className = "form-msg" + (bad ? " is-bad" : ""); if (!bad) setTimeout(function () { if (el.textContent === text) el.textContent = ""; }, 4000); }
  function empty(text) { return '<p class="empty-note fd-empty fd-empty-art">' + (typeof EMPTY_ART === "string" ? EMPTY_ART : "") + esc(text) + "</p>"; }
  function kpi(label, value, sub) { return '<div class="fd-kpi"><span class="fd-kpi-v">' + value + '</span><span class="fd-kpi-l">' + esc(label) + "</span>" + (sub ? '<span class="fd-kpi-s">' + sub + "</span>" : "") + "</div>"; }
  function bar(part, whole, extra) {
    var p = Math.min(100, pct(part, whole)), e = extra ? Math.min(100 - p, pct(extra, whole)) : 0;
    return '<div class="fd-bar" role="img" aria-label="' + p + ' percent"><span style="width:' + p + '%"></span>' + (e ? '<span class="fd-bar-2" style="width:' + e + '%"></span>' : "") + "</div>";
  }
  function pill(text, kind) { return '<span class="pill' + (kind ? " " + kind : "") + '">' + esc(text) + "</span>"; }
  function opt(value, label, sel) { return '<option value="' + esc(value) + '"' + (String(sel) === String(value) ? " selected" : "") + ">" + esc(label) + "</option>"; }
  function input(name, label, type, value, attrs) {
    return '<label>' + esc(label) + '<input name="' + name + '" type="' + (type || "text") + '" value="' + esc(value == null ? "" : value) + '" ' + (attrs || "") + "></label>";
  }
  function area(name, label, value, attrs) { return '<label class="fd-wide">' + esc(label) + '<textarea name="' + name + '" ' + (attrs || "") + ">" + esc(value || "") + "</textarea></label>"; }
  function panel(view, key) { return document.querySelector('.view[data-view="' + view + '"] [data-fd-panel="' + key + '"]'); }
  function showPanel(view, key) {
    var sec = document.querySelector('.view[data-view="' + view + '"]');
    if (!sec) return;
    sec.querySelectorAll("[data-fd-panel]").forEach(function (p) { p.hidden = p.getAttribute("data-fd-panel") !== key; });
    sec.querySelectorAll("[data-fd-tab]").forEach(function (b) {
      var on = b.getAttribute("data-fd-tab") === key;
      b.classList.toggle("is-active", on); b.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  var STATUS_LABEL = { received: "Received", screening: "Screening", "in-review": "In review", approved: "Approved", declined: "Declined", withdrawn: "Withdrawn" };
  var STATUS_KIND = { approved: "good", declined: "", withdrawn: "", "in-review": "gold", received: "gold", screening: "gold" };
  var REC_LABEL = { fund: "Fund", "fund-with-changes": "Fund with changes", decline: "Decline" };
  var METHOD_LABEL = { check: "Check", cash: "Cash", card: "Card", ach: "Bank transfer (ACH)", wire: "Wire", stock: "Stock", daf: "Donor-advised fund", "in-kind": "In-kind", other: "Other" };
  var KIND_LABEL = { individual: "Individual", family: "Family", foundation: "Foundation", corporation: "Company", government: "Government", daf: "Donor-advised fund", other: "Other" };
  var STAGE_LABEL = { "": "Not set", identify: "Identify", qualify: "Qualify", cultivate: "Cultivate", solicit: "Ask", steward: "Thank and keep" };
  var FUND_LABEL = { unrestricted: "Unrestricted", restricted: "Restricted", capital: "Capital", endowment: "Endowment", event: "Event" };
  var TOUCH_LABEL = { meeting: "Meeting", call: "Call", email: "Email", event: "Event", ask: "Ask", note: "Note" };

  // ===================================================================
  // GRANTS
  // ===================================================================
  var GM = { programs: [], apps: [], filterProgram: "", filterStatus: "open" };

  function gmLoad() {
    return Promise.all([api("/api/gm/programs"), api("/api/gm/applications"), api("/api/gm/summary")]).then(function (r) {
      GM.programs = r[0].items || []; GM.apps = r[1].items || []; GM.summary = r[2];
      var fy = document.getElementById("gm-fy"); if (fy) fy.textContent = "Year " + (GM.summary.fiscalYear || "");
    });
  }
  function gmRender(tab) {
    tab = tab || GM.tab || "gm-overview";
    GM.tab = tab;
    showPanel("grants", tab);
    var el = panel("grants", tab);
    if (!el) return;
    el.innerHTML = '<p class="load-note">Loading...</p>';
    gmLoad().then(function () {
      if (tab === "gm-overview") gmOverview(el);
      else if (tab === "gm-apps") gmApps(el);
      else if (tab === "gm-awards") gmAwards(el);
      else if (tab === "gm-programs") gmPrograms(el);
    }).catch(function (e) { el.innerHTML = empty("Couldn't load grants: " + e.message); });
  }
  function programName(id) { var p = GM.programs.filter(function (x) { return x.id === id; })[0]; return p ? p.name : ""; }

  function gmOverview(el) {
    var s = GM.summary, t = s.totals;
    if (!GM.programs.length) {
      el.innerHTML = '<div class="fw-card fd-start"><h3>Start with a grant program</h3><p>A program is a pot of money with a purpose, a budget, dates, and the criteria every application is scored on. Once it\'s set up you can take applications online with a link, or enter them by hand.</p>' +
        '<div class="fd-actions"><button type="button" class="btn" data-fd-go="gm-programs">Create a program</button></div></div>';
      return;
    }
    var html = '<div class="fd-kpis">' +
      kpi("Open programs", String(t.openPrograms)) +
      kpi("Waiting for a decision", String(t.pending), t.newOnline ? t.newOnline + " new online" : "") +
      kpi("Awarded this year", money(t.awardedThisYear)) +
      kpi("Paid this year", money(t.paidThisYear)) +
      kpi("Still to pay", money(t.owed), t.activeGrants + " active grant" + (t.activeGrants === 1 ? "" : "s")) + "</div>";
    html += '<div class="fd-grid">';
    html += '<div class="fw-card"><h3>Programs</h3>' + s.programs.map(function (p) {
      return '<div class="fd-prog"><div class="fd-row"><strong>' + esc(p.name) + "</strong> " + pill(p.status === "open" ? "Open" : p.status === "closed" ? "Closed" : "Draft", p.status === "open" ? "good" : "") +
        '<span class="fd-dim">' + money(p.committed) + " of " + money(p.budget) + " committed</span></div>" + bar(p.paid, p.budget, p.committed - p.paid) +
        '<div class="fd-dim fd-small">' + money(p.paid) + " paid &middot; " + money(Math.max(0, p.remaining)) + " left to award &middot; " + p.pending + " waiting" +
        (p.acceptsOnline && p.status === "open" ? ' &middot; <a href="/apply/' + encodeURIComponent(p.slug) + '" target="_blank" rel="noopener">application form</a>' : "") + "</div></div>";
    }).join("") + "</div>";
    html += '<div class="fw-card"><h3>Needs a first review</h3>' + (s.needsReview.length ? '<ul class="fd-list">' + s.needsReview.map(function (a) {
      return '<li><a href="#" data-gm-open="' + esc(a.id) + '">' + esc(a.orgName) + '</a><span class="fd-dim">' + money(a.amountRequested) + " &middot; received " + esc(fmtDate(a.received)) + "</span></li>";
    }).join("") + "</ul>" : empty("Every waiting application has at least one review.")) + "</div>";
    html += '<div class="fw-card"><h3>Payments due in the next month</h3>' + (s.paymentsDue.length ? '<table class="prospect-table fd-table"><tbody>' + s.paymentsDue.map(function (p) {
      return "<tr><td>" + esc(fmtDate(p.dueOn)) + (p.overdue ? " " + pill("Overdue", "warn") : "") + '</td><td><a href="#" data-gm-open="' + esc(p.applicationId) + '">' + esc(p.orgName) + "</a>" + (p.condition ? '<br><span class="fd-dim fd-small">' + esc(p.condition) + "</span>" : "") + "</td><td>" + money(p.amount) +
        '</td><td><button type="button" class="btn secondary fd-sm" data-pay="' + esc(p.id) + '">Mark paid</button></td></tr>';
    }).join("") + "</tbody></table>" : empty("Nothing due.")) + "</div>";
    html += '<div class="fw-card"><h3>Reports due in the next month</h3>' + (s.reportsDue.length ? '<table class="prospect-table fd-table"><tbody>' + s.reportsDue.map(function (r) {
      return "<tr><td>" + esc(fmtDate(r.dueOn)) + (r.overdue ? " " + pill("Overdue", "warn") : "") + '</td><td><a href="#" data-gm-open="' + esc(r.applicationId) + '">' + esc(r.orgName) + "</a></td><td>" + esc(r.kind === "interim" ? "Interim" : r.kind === "final" ? "Final" : "Report") +
        '</td><td><button type="button" class="btn secondary fd-sm" data-report-in="' + esc(r.id) + '">Mark received</button></td></tr>';
    }).join("") + "</tbody></table>" : empty("Nothing due.")) + "</div>";
    html += "</div>";
    el.innerHTML = html;
  }

  function gmApps(el) {
    var statuses = [["open", "Waiting"], ["approved", "Approved"], ["declined", "Declined"], ["all", "All"]];
    var list = GM.apps.filter(function (a) {
      if (GM.filterProgram && a.programId !== GM.filterProgram) return false;
      if (GM.filterStatus === "open") return ["received", "screening", "in-review"].indexOf(a.status) >= 0;
      if (GM.filterStatus === "all") return true;
      return a.status === GM.filterStatus;
    });
    var html = '<div class="fd-toolbar"><label>Program <select id="gm-filter-program">' + opt("", "All programs", GM.filterProgram) + GM.programs.map(function (p) { return opt(p.id, p.name, GM.filterProgram); }).join("") + "</select></label>" +
      '<span class="filter-row">' + statuses.map(function (s) { return '<button type="button" class="filter-btn' + (GM.filterStatus === s[0] ? " is-active" : "") + '" data-gm-status="' + s[0] + '">' + s[1] + "</button>"; }).join("") + "</span></div>";
    html += '<div class="fw-card"><div class="table-wrap"><table class="prospect-table fd-table"><thead><tr><th>Organization</th><th>Program</th><th>Requested</th><th>Score</th><th>Status</th><th>Received</th></tr></thead><tbody>' +
      (list.length ? list.map(function (a) {
        var sc = a.score || {};
        return '<tr><td><a href="#" data-gm-open="' + esc(a.id) + '"><strong>' + esc(a.orgName) + "</strong></a>" + (a.projectTitle ? '<br><span class="fd-dim fd-small">' + esc(a.projectTitle) + "</span>" : "") + (a.source === "online" ? " " + pill("Online") : "") + "</td><td>" + esc(a.programName || "") + "</td><td>" + money(a.amountRequested) +
          "</td><td>" + (sc.average != null ? "<strong>" + sc.average.toFixed(1) + "</strong> / 5 " : "") + '<span class="fd-dim fd-small">' + (sc.reviews || 0) + " review" + (sc.reviews === 1 ? "" : "s") + "</span></td><td>" + pill(STATUS_LABEL[a.status] || a.status, STATUS_KIND[a.status]) + "</td><td>" + esc(fmtDate(a.createdAt)) + "</td></tr>";
      }).join("") : '<tr><td colspan="6" class="empty-note">No applications here.</td></tr>') + "</tbody></table></div></div>";
    html += '<details class="fw-card fd-add"><summary><strong>Add an application by hand</strong> <span class="fd-dim">(for one that came by email or mail)</span></summary>' +
      '<form class="fd-form" id="gm-app-form"><label>Program<select name="programId" required>' + GM.programs.map(function (p) { return opt(p.id, p.name, GM.filterProgram); }).join("") + "</select></label>" +
      input("orgName", "Organization", "text", "", "required maxlength=200") + input("ein", "EIN", "text", "", "maxlength=20") + input("contactName", "Contact name") + input("contactEmail", "Contact email", "email") + input("contactPhone", "Phone", "tel") +
      input("website", "Website", "url") + input("annualBudget", "Annual budget ($)", "text", "", "inputmode=decimal") + input("amountRequested", "Amount requested ($)", "text", "", "inputmode=decimal required") + input("projectTitle", "Project or purpose") +
      area("summary", "Summary", "", "rows=4") + '<div class="fd-wide"><button type="submit" class="btn">Add application</button> <span class="form-msg" role="status"></span></div></form></details>';
    el.innerHTML = html;
    if (!GM.programs.length) el.querySelector("#gm-app-form").innerHTML = empty("Create a program first (Programs tab).");
  }

  function gmAwards(el) {
    var list = GM.apps.filter(function (a) { return a.status === "approved"; });
    var total = list.reduce(function (s, a) { return s + a.amountAwarded; }, 0), paid = list.reduce(function (s, a) { return s + a.paid; }, 0);
    el.innerHTML = '<div class="fd-kpis">' + kpi("Active grants", String(list.length)) + kpi("Awarded", money(total)) + kpi("Paid", money(paid)) + kpi("Still to pay", money(Math.max(0, total - paid))) + "</div>" +
      '<div class="fw-card"><div class="table-wrap"><table class="prospect-table fd-table"><thead><tr><th>Grantee</th><th>Program</th><th>Awarded</th><th>Paid</th><th>Grant period</th><th>Agreement</th></tr></thead><tbody>' +
      (list.length ? list.map(function (a) {
        return '<tr><td><a href="#" data-gm-open="' + esc(a.id) + '"><strong>' + esc(a.orgName) + "</strong></a></td><td>" + esc(a.programName) + "</td><td>" + money(a.amountAwarded) + "</td><td>" + money(a.paid) + bar(a.paid, a.amountAwarded) + "</td><td>" +
          esc(fmtDate(a.awardStart)) + " to " + esc(fmtDate(a.awardEnd)) + (a.awardEnd && a.awardEnd < today() ? " " + pill("Ended") : "") + "</td><td>" + (a.agreementSignedOn ? pill("Signed " + fmtDate(a.agreementSignedOn), "good") : pill("Not signed yet", "gold")) + "</td></tr>";
      }).join("") : '<tr><td colspan="6" class="empty-note">No approved grants yet.</td></tr>') + "</tbody></table></div></div>";
  }

  function gmPrograms(el, editId) {
    var editing = GM.programs.filter(function (p) { return p.id === editId; })[0];
    var p = editing || { status: "draft", criteria: [], questions: [] };
    var html = '<div class="fw-card"><div class="table-wrap"><table class="prospect-table fd-table"><thead><tr><th>Program</th><th>Status</th><th>Budget</th><th>Largest award</th><th>Dates</th><th>Online form</th><th></th></tr></thead><tbody>' +
      (GM.programs.length ? GM.programs.map(function (x) {
        return "<tr><td><strong>" + esc(x.name) + "</strong></td><td>" + pill(x.status === "open" ? "Open" : x.status === "closed" ? "Closed" : "Draft", x.status === "open" ? "good" : "") + "</td><td>" + money(x.budget) + "</td><td>" + (x.maxAward ? money(x.maxAward) : "") + "</td><td>" +
          esc(fmtDate(x.opensOn)) + (x.closesOn ? " to " + esc(fmtDate(x.closesOn)) : "") + "</td><td>" + (x.acceptsOnline ? '<a href="/apply/' + encodeURIComponent(x.slug) + '" target="_blank" rel="noopener">/apply/' + esc(x.slug) + "</a>" + (x.status !== "open" ? '<br><span class="fd-dim fd-small">opens when status is Open</span>' : "") : '<span class="fd-dim">off</span>') +
          '</td><td><button type="button" class="btn secondary fd-sm" data-gm-edit="' + esc(x.id) + '">Edit</button> <button type="button" class="btn danger" data-gm-archive="' + esc(x.id) + '">Remove</button></td></tr>';
      }).join("") : '<tr><td colspan="7" class="empty-note">No programs yet.</td></tr>') + "</tbody></table></div></div>";
    html += '<div class="fw-card"><h3>' + (editing ? "Edit " + esc(editing.name) : "New program") + "</h3>" +
      '<form class="fd-form" id="gm-program-form" data-id="' + esc(p.id || "") + '">' + input("name", "Name", "text", p.name, "required maxlength=200") +
      '<label>Status<select name="status">' + opt("draft", "Draft (not taking applications)", p.status) + opt("open", "Open", p.status) + opt("closed", "Closed", p.status) + "</select></label>" +
      input("budget", "Budget for this cycle ($)", "text", p.budget || "", "inputmode=decimal") + input("maxAward", "Largest single award ($)", "text", p.maxAward || "", "inputmode=decimal") +
      input("opensOn", "Opens", "date", p.opensOn) + input("closesOn", "Closes", "date", p.closesOn) +
      '<label class="check-row fd-wide"><input type="checkbox" name="acceptsOnline"' + (p.acceptsOnline ? " checked" : "") + "> Take applications online (a public form anyone with the link can fill in)</label>" +
      area("purpose", "Purpose (shown on the application form)", p.purpose, "rows=3") + area("eligibility", "Who can apply (shown on the form)", p.eligibility, "rows=3") +
      area("criteria", "Scoring criteria, one per line (each reviewer scores 1 to 5)", (p.criteria || []).map(function (c) { return c.label; }).join("\n"), 'rows=4 placeholder="Need and who benefits\nStrength of the plan\nCapacity to deliver\nFit with our priorities"') +
      area("questions", "Extra questions on the form, one per line (optional)", (p.questions || []).map(function (c) { return c.label; }).join("\n"), 'rows=3 placeholder="How will you measure success?"') +
      '<div class="fd-wide"><button type="submit" class="btn">' + (editing ? "Save changes" : "Create program") + "</button>" + (editing ? ' <button type="button" class="btn secondary" data-gm-edit="">Cancel</button>' : "") + ' <span class="form-msg" role="status"></span></div></form></div>';
    el.innerHTML = html;
  }

  function gmDetail(id) {
    var el = panel("grants", "gm-detail");
    showPanel("grants", "gm-detail");
    el.innerHTML = '<p class="load-note">Loading...</p>';
    window.scrollTo(0, 0);
    api("/api/gm/applications/" + encodeURIComponent(id)).then(function (d) {
      var a = d.item, prog = d.program || { criteria: [], questions: [] }, crit = prog.criteria || [];
      var mine = d.reviews.filter(function (r) { return r.reviewer === d.me; })[0] || { scores: {} };
      var html = '<div class="fd-toolbar"><button type="button" class="btn secondary" data-fd-back="' + esc(GM.tab || "gm-apps") + '">&larr; Back</button>' +
        '<span><a class="btn secondary" href="/letter/grant/' + encodeURIComponent(a.id) + '?kind=award" target="_blank" rel="noopener">Award letter</a> <a class="btn secondary" href="/letter/grant/' + encodeURIComponent(a.id) + '?kind=decline" target="_blank" rel="noopener">Decline letter</a></span></div>';
      html += '<div class="fw-card"><div class="fd-row"><h3 style="margin:0">' + esc(a.orgName) + "</h3> " + pill(STATUS_LABEL[a.status] || a.status, STATUS_KIND[a.status]) + (a.source === "online" ? " " + pill("Applied online") : "") + "</div>" +
        '<p class="fd-dim">' + esc(prog.name || "No program") + (a.projectTitle ? " &middot; " + esc(a.projectTitle) : "") + "</p>" +
        '<dl class="fd-dl"><dt>Requested</dt><dd>' + money(a.amountRequested) + "</dd><dt>Annual budget</dt><dd>" + (a.annualBudget ? money(a.annualBudget) + (a.amountRequested && a.annualBudget ? ' <span class="fd-dim">(' + pct(a.amountRequested, a.annualBudget) + "% of budget)</span>" : "") : "") + "</dd>" +
        "<dt>Contact</dt><dd>" + esc(a.contactName) + (a.contactEmail ? ' &middot; <a href="mailto:' + esc(a.contactEmail) + '">' + esc(a.contactEmail) + "</a>" : "") + (a.contactPhone ? " &middot; " + esc(a.contactPhone) : "") + "</dd>" +
        "<dt>EIN</dt><dd>" + esc(a.ein) + (a.ein ? ' &middot; <a href="https://projects.propublica.org/nonprofits/organizations/' + esc(a.ein.replace(/\D/g, "")) + '" target="_blank" rel="noopener">990 filings</a>' : "") + "</dd>" +
        "<dt>Website</dt><dd>" + (a.website ? '<a href="' + esc(/^https?:/.test(a.website) ? a.website : "https://" + a.website) + '" target="_blank" rel="noopener">' + esc(a.website) + "</a>" : "") + "</dd>" +
        "<dt>Received</dt><dd>" + esc(fmtDate(a.createdAt)) + "</dd></dl>" +
        (a.summary ? '<h4 class="settings-h4">Summary</h4><p class="fd-pre">' + esc(a.summary) + "</p>" : "") +
        (prog.questions || []).map(function (q) { return (a.answers || {})[q.key] ? '<h4 class="settings-h4">' + esc(q.label) + '</h4><p class="fd-pre">' + esc(a.answers[q.key]) + "</p>" : ""; }).join("") +
        (d.history.length ? '<h4 class="settings-h4">Earlier applications from this organization</h4><ul class="fd-list">' + d.history.map(function (h) { return '<li><a href="#" data-gm-open="' + esc(h.id) + '">' + esc(fmtDate(h.createdAt)) + "</a><span>" + pill(STATUS_LABEL[h.status] || h.status, STATUS_KIND[h.status]) + (h.amountAwarded ? " " + money(h.amountAwarded) : "") + "</span></li>"; }).join("") + "</ul>" : "") + "</div>";

      // Reviews
      html += '<div class="fw-card"><h3>Reviews</h3>' + (d.score.average != null ? '<p><strong>' + d.score.average.toFixed(1) + " / 5</strong> average from " + d.score.reviews + " review" + (d.score.reviews === 1 ? "" : "s") +
        " &middot; " + Object.keys(REC_LABEL).filter(function (k) { return d.score.recommendations[k]; }).map(function (k) { return d.score.recommendations[k] + " " + REC_LABEL[k].toLowerCase(); }).join(", ") + (d.score.conflicts ? " &middot; " + d.score.conflicts + " stepped aside (conflict)" : "") + "</p>" : "") +
        (d.reviews.length ? '<div class="table-wrap"><table class="prospect-table fd-table"><thead><tr><th>Reviewer</th>' + crit.map(function (c) { return "<th>" + esc(c.label) + "</th>"; }).join("") + "<th>Average</th><th>Recommends</th><th>Comment</th></tr></thead><tbody>" +
          d.reviews.map(function (r) {
            return "<tr><td>" + esc(r.reviewer) + "</td>" + (r.conflict ? '<td colspan="' + (crit.length + 2) + '"><em>Declared a conflict of interest; not counted.</em></td>' : crit.map(function (c) { return "<td>" + (r.scores[c.key] || "") + "</td>"; }).join("") + "<td>" + (r.average != null ? r.average.toFixed(1) : "") + "</td><td>" + esc(REC_LABEL[r.recommendation] || "") + "</td>") + '<td class="fd-small">' + esc(r.comment) + "</td></tr>";
          }).join("") + "</tbody></table></div>" : empty("No reviews yet."));
      html += '<form class="fd-form" id="gm-review-form" data-id="' + esc(a.id) + '"><h4 class="settings-h4 fd-wide">Your review (' + esc(d.me) + ")</h4>" +
        crit.map(function (c) { return '<label>' + esc(c.label) + '<select name="s_' + esc(c.key) + '">' + opt("", "Score", mine.scores[c.key] || "") + [5, 4, 3, 2, 1].map(function (n) { return opt(n, n + (n === 5 ? " (strong)" : n === 1 ? " (weak)" : ""), mine.scores[c.key] || ""); }).join("") + "</select></label>"; }).join("") +
        '<label>Recommendation<select name="recommendation">' + opt("", "Choose", mine.recommendation) + opt("fund", "Fund", mine.recommendation) + opt("fund-with-changes", "Fund with changes", mine.recommendation) + opt("decline", "Decline", mine.recommendation) + "</select></label>" +
        area("comment", "Comment", mine.comment, "rows=2") + '<label class="check-row fd-wide"><input type="checkbox" name="conflict"' + (mine.conflict ? " checked" : "") + "> I have a conflict of interest and am stepping aside</label>" +
        '<div class="fd-wide"><button type="submit" class="btn">Save my review</button> <span class="form-msg" role="status"></span></div></form></div>';

      // Decision
      var start = a.awardStart || today(), end = a.awardEnd || "";
      html += '<div class="fw-card"><h3>Decision</h3>' +
        '<form class="fd-form" id="gm-award-form" data-id="' + esc(a.id) + '">' + input("amount", "Award amount ($)", "text", a.amountAwarded || a.amountRequested || "", "inputmode=decimal required") +
        input("start", "Grant starts", "date", start) + input("end", "Grant ends", "date", end, 'placeholder="12 months after start"') +
        '<label>Payments<select name="installments">' + [1, 2, 3, 4, 6, 12].map(function (n) { return opt(n, n === 1 ? "One payment" : n + " equal payments", d.payments.length || 1); }).join("") + "</select></label>" +
        '<label class="check-row"><input type="checkbox" name="interim" checked> Ask for an interim report (grants of 6+ months)</label>' +
        area("notes", "Note for the letter (optional)", a.decisionNotes, "rows=2") +
        '<div class="fd-wide"><button type="submit" class="btn">' + (a.status === "approved" ? "Update award" : "Approve and set up payments") + '</button> <span class="form-msg" role="status"></span>' +
        (a.status === "approved" ? '<p class="fd-dim fd-small">Updating replaces unpaid payments and unreceived reports; anything already paid or received stays.</p>' : "") + "</div></form>" +
        '<div class="fd-actions fd-row">' + (a.status !== "declined" ? '<button type="button" class="btn secondary" data-gm-set="declined" data-id="' + esc(a.id) + '">Decline</button>' : "") +
        (["received", "screening", "in-review"].indexOf(a.status) < 0 ? '<button type="button" class="btn secondary" data-gm-set="in-review" data-id="' + esc(a.id) + '">Move back to review</button>' : "") +
        (a.status !== "withdrawn" ? '<button type="button" class="btn secondary" data-gm-set="withdrawn" data-id="' + esc(a.id) + '">Withdrawn by applicant</button>' : "") +
        '<button type="button" class="btn danger" data-gm-remove="' + esc(a.id) + '">Remove application</button></div></div>';

      if (a.status === "approved") {
        var paid = d.payments.filter(function (p) { return p.paidOn; }).reduce(function (s, p) { return s + p.amount; }, 0);
        html += '<div class="fw-card"><h3>Payments</h3><p>' + money(paid) + " of " + money(a.amountAwarded) + " paid</p>" + bar(paid, a.amountAwarded) +
          '<div class="table-wrap"><table class="prospect-table fd-table"><thead><tr><th>Due</th><th>Amount</th><th>Condition</th><th>Paid</th><th></th></tr></thead><tbody>' +
          d.payments.map(function (p) {
            return "<tr><td>" + esc(fmtDate(p.dueOn)) + "</td><td>" + money(p.amount) + '</td><td class="fd-small">' + esc(p.condition) + "</td><td>" + (p.paidOn ? pill("Paid " + fmtDate(p.paidOn), "good") + (p.reference ? ' <span class="fd-dim fd-small">' + esc(p.reference) + "</span>" : "") : '<button type="button" class="btn secondary fd-sm" data-pay="' + esc(p.id) + '">Mark paid</button>') +
              '</td><td><button type="button" class="btn danger" data-del-payment="' + esc(p.id) + '">Remove</button></td></tr>';
          }).join("") + "</tbody></table></div>" +
          '<form class="fd-form fd-inline" id="gm-payment-form" data-id="' + esc(a.id) + '">' + input("dueOn", "Due", "date", "", "required") + input("amount", "Amount ($)", "text", "", "inputmode=decimal required") + input("condition", "Condition (optional)") + '<div><button type="submit" class="btn secondary">Add payment</button></div></form></div>';
        html += '<div class="fw-card"><h3>Reports from the grantee</h3><div class="table-wrap"><table class="prospect-table fd-table"><thead><tr><th>Report</th><th>Due</th><th>Received</th><th>What it said</th><th></th></tr></thead><tbody>' +
          (d.reports.length ? d.reports.map(function (r) {
            return "<tr><td>" + esc(r.kind === "interim" ? "Interim" : r.kind === "final" ? "Final" : "Other") + "</td><td>" + esc(fmtDate(r.dueOn)) + (!r.receivedOn && r.dueOn && r.dueOn < today() ? " " + pill("Overdue", "warn") : "") + "</td><td>" + (r.receivedOn ? pill(fmtDate(r.receivedOn), "good") : '<button type="button" class="btn secondary fd-sm" data-report-in="' + esc(r.id) + '">Mark received</button>') +
              '</td><td class="fd-small">' + esc(r.summary) + '</td><td><button type="button" class="btn secondary fd-sm" data-report-note="' + esc(r.id) + '">Add note</button> <button type="button" class="btn danger" data-del-report="' + esc(r.id) + '">Remove</button></td></tr>';
          }).join("") : '<tr><td colspan="5" class="empty-note">No reports scheduled.</td></tr>') + "</tbody></table></div>" +
          '<form class="fd-form fd-inline" id="gm-report-form" data-id="' + esc(a.id) + '"><label>Kind<select name="kind">' + opt("interim", "Interim") + opt("final", "Final") + opt("other", "Other") + "</select></label>" + input("dueOn", "Due", "date", "", "required") + '<div><button type="submit" class="btn secondary">Add report</button></div></form>' +
          '<form class="fd-form fd-inline" id="gm-signed-form" data-id="' + esc(a.id) + '">' + input("agreementSignedOn", "Signed agreement received on", "date", a.agreementSignedOn) + '<div><button type="submit" class="btn secondary">Save</button> <span class="form-msg" role="status"></span></div></form></div>';
      }
      el.innerHTML = html;
      el.querySelectorAll(".fd-dl dd").forEach(function (dd) { if (!dd.textContent.trim()) { dd.previousElementSibling.remove(); dd.remove(); } });
    }).catch(function (e) { el.innerHTML = empty("Couldn't open the application: " + e.message); });
  }

  // ===================================================================
  // FUNDRAISING
  // ===================================================================
  var FR = { donors: [], campaigns: [], gifts: [], pledges: [], search: "", stage: "" };

  function frLoad() {
    return Promise.all([api("/api/fr/donors"), api("/api/fr/campaigns"), api("/api/fr/gifts"), api("/api/fr/pledges"), api("/api/fr/summary")]).then(function (r) {
      FR.donors = r[0].items || []; FR.campaigns = r[1].items || []; FR.gifts = r[2].items || []; FR.pledges = r[3].items || []; FR.summary = r[4];
      FR.donorById = {}; FR.donors.forEach(function (d) { FR.donorById[d.id] = d; });
      FR.campaignById = {}; FR.campaigns.forEach(function (c) { FR.campaignById[c.id] = c; });
      var fy = document.getElementById("fr-fy"); if (fy) fy.textContent = "Year " + (FR.summary.fiscalYear || "");
    });
  }
  function frRender(tab) {
    tab = tab || FR.tab || "fr-overview";
    FR.tab = tab;
    showPanel("fundraising", tab);
    var el = panel("fundraising", tab);
    if (!el) return;
    el.innerHTML = '<p class="load-note">Loading...</p>';
    frLoad().then(function () {
      if (tab === "fr-overview") frOverview(el);
      else if (tab === "fr-gifts") frGifts(el);
      else if (tab === "fr-donors") frDonors(el);
      else if (tab === "fr-pledges") frPledges(el);
      else if (tab === "fr-campaigns") frCampaigns(el);
    }).catch(function (e) { el.innerHTML = empty("Couldn't load fundraising: " + e.message); });
  }
  function donorLink(id, name) { return '<a href="#" data-fr-donor="' + esc(id) + '">' + esc(name || (FR.donorById[id] || {}).name || "Donor") + "</a>"; }
  function donorList() { return '<datalist id="fr-donor-names">' + FR.donors.map(function (d) { return '<option value="' + esc(d.name) + '">' + (d.email ? esc(d.email) : "") + "</option>"; }).join("") + "</datalist>"; }
  function findDonor(name) { name = String(name || "").trim().toLowerCase(); return FR.donors.filter(function (d) { return d.name.toLowerCase() === name; })[0]; }
  function campaignSelect(sel, required) { return '<label>Campaign or fund<select name="campaignId"' + (required ? " required" : "") + ">" + opt("", "None (general)", sel) + FR.campaigns.map(function (c) { return opt(c.id, c.name, sel); }).join("") + "</select></label>"; }
  function pledgeReceived(pid) { return FR.gifts.filter(function (g) { return g.pledgeId === pid; }).reduce(function (s, g) { return s + g.amount; }, 0); }

  function frOverview(el) {
    var s = FR.summary, t = s.totals;
    if (!FR.donors.length && !FR.gifts.length) {
      el.innerHTML = '<div class="fw-card fd-start"><h3>Start with your first gift</h3><p>Record a gift and the donor is created with it. Already keep gifts in a spreadsheet? Bring them all in at once with a CSV (Gifts tab, "Bring in gifts from a spreadsheet").</p>' +
        '<div class="fd-actions"><button type="button" class="btn" data-fd-go="fr-gifts">Record a gift</button> <button type="button" class="btn secondary" data-fd-go="fr-campaigns">Set up a campaign</button></div></div>';
      return;
    }
    var change = t.raisedLastYearToDate > 0 ? Math.round(((t.raised - t.raisedLastYearToDate) / t.raisedLastYearToDate) * 100) : null;
    var html = '<div class="fd-kpis">' +
      kpi("Raised this year", money(t.raised), t.raisedLastYearToDate > 0 ? money(t.raisedLastYearToDate) + " at this point last year" + (change != null && Math.abs(change) <= 300 ? " (" + (change >= 0 ? "+" : "") + change + "%)" : "") : "") +
      kpi("Donors this year", String(t.donors), t.newDonors + " new") +
      kpi("Average gift", money(t.averageGift), t.gifts + " gift" + (t.gifts === 1 ? "" : "s")) +
      kpi("Donors who gave again", t.retention == null ? "&ndash;" : t.retention + "%", t.lastYearDonors ? t.retainedDonors + " of " + t.lastYearDonors + " from last year" : "no gifts last year") +
      kpi("Pledged, not yet paid", money(t.pledgeBalance)) + "</div>";
    html += '<div class="fd-grid">';
    html += '<div class="fw-card"><h3>Thank-you letters to send</h3>' + (s.toThank.length ? '<p><a class="btn" href="/letter/receipt?pending=1" target="_blank" rel="noopener">Print all ' + s.toThank.length + " letter" + (s.toThank.length === 1 ? "" : "s") + "</a></p>" +
      '<ul class="fd-list">' + s.toThank.slice(0, 12).map(function (g) {
        return "<li>" + donorLink(g.donorId, g.donorName) + "<span>" + money(g.amount) + ' <span class="fd-dim fd-small">' + (g.daysWaiting != null ? g.daysWaiting + " day" + (g.daysWaiting === 1 ? "" : "s") : "") + "</span>" + (g.daysWaiting > 2 ? " " + pill("Waiting", "warn") : "") + "</span></li>";
      }).join("") + "</ul>" + (s.toThank.length > 12 ? '<p class="fd-dim fd-small">and ' + (s.toThank.length - 12) + " more</p>" : "") : empty("Everyone has been thanked.")) +
      '<p class="fd-dim fd-small">Aim to thank every donor within 48 hours of the gift.</p></div>';
    html += '<div class="fw-card"><h3>Campaigns</h3>' + (s.campaigns.length ? s.campaigns.map(function (c) {
      return '<div class="fd-prog"><div class="fd-row"><strong>' + esc(c.name) + '</strong><span class="fd-dim">' + money(c.raised) + (c.goal ? " of " + money(c.goal) + " (" + pct(c.raised, c.goal) + "%)" : "") + "</span></div>" + (c.goal ? bar(c.raised, c.goal, c.pledged) : "") +
        '<div class="fd-dim fd-small">' + c.donors + " donor" + (c.donors === 1 ? "" : "s") + (c.pledged ? " &middot; " + money(c.pledged) + " more pledged" : "") + (c.endsOn ? " &middot; ends " + esc(fmtDate(c.endsOn)) : "") + "</div></div>";
    }).join("") : empty("No campaigns yet. Gifts without one count as general support.")) + "</div>";
    html += '<div class="fw-card"><h3>Who to contact next</h3>' + (s.followUps.length ? '<ul class="fd-list">' + s.followUps.map(function (f) {
      return "<li>" + donorLink(f.donorId, f.donorName) + "<span>" + esc(f.nextStep) + ' <span class="fd-dim fd-small">' + esc(fmtDate(f.nextOn)) + "</span>" + (f.overdue ? " " + pill("Overdue", "warn") : "") + "</span></li>";
    }).join("") + "</ul>" : empty("No follow-ups due. Add a next step on a donor's page.")) + "</div>";
    html += '<div class="fw-card"><h3>Pledge payments due</h3>' + (s.pledgesDue.length ? '<ul class="fd-list">' + s.pledgesDue.map(function (p) {
      return "<li>" + donorLink(p.donorId, p.donorName) + "<span>" + money(p.nextAmount) + ' <span class="fd-dim fd-small">' + esc(fmtDate(p.nextDue)) + "</span>" + (p.overdue ? " " + pill("Overdue", "warn") : "") + "</span></li>";
    }).join("") + "</ul>" : empty("No pledge payments due in the next month.")) + "</div>";
    html += '<div class="fw-card"><h3>Gave last year, not yet this year</h3>' + (s.lybunt.length ? '<ul class="fd-list">' + s.lybunt.slice(0, 10).map(function (d) {
      return "<li>" + donorLink(d.donorId, d.name) + "<span>" + money(d.lastYear) + ' <span class="fd-dim fd-small">last year</span></span></li>';
    }).join("") + "</ul>" + (s.lybunt.length > 10 ? '<p class="fd-dim fd-small">' + s.lybunt.length + " donors in all; see the Donors tab.</p>" : "") : empty("Every donor from last year has given again.")) +
      '<p class="fd-dim fd-small">These are the easiest gifts to bring back: a call or a note from you.</p></div>';
    html += "</div>";
    el.innerHTML = html;
  }

  function frGiftForm() {
    var openPledges = FR.pledges.filter(function (p) { return p.status === "open"; });
    return '<div class="fw-card"><h3>Record a gift</h3><form class="fd-form" id="fr-gift-form">' + donorList() +
      '<label>Donor<input name="donorName" list="fr-donor-names" required autocomplete="off" placeholder="Start typing a name"></label>' +
      input("donorEmail", "Donor email (new donors)", "email") + input("amount", "Amount ($)", "text", "", "inputmode=decimal required") + input("receivedOn", "Received", "date", today(), "required") +
      '<label>Method<select name="method">' + Object.keys(METHOD_LABEL).map(function (k) { return opt(k, METHOD_LABEL[k], "check"); }).join("") + "</select></label>" + campaignSelect("") +
      (openPledges.length ? '<label>Pays toward a pledge<select name="pledgeId">' + opt("", "No") + openPledges.map(function (p) { return opt(p.id, ((FR.donorById[p.donorId] || {}).name || "Donor") + ", " + money(p.total), ""); }).join("") + "</select></label>" : "") +
      '<label class="check-row fd-wide"><input type="checkbox" name="thanked"> Already thanked</label>' +
      '<details class="fd-wide fd-more"><summary>More details (check number, designation, gala ticket value, in-kind)</summary><div class="fd-form">' +
      input("reference", "Check number or reference") + input("restriction", "Designated for (if the donor said)") +
      input("goodsServicesValue", "Value of anything they got in return ($)", "text", "", 'inputmode=decimal placeholder="e.g. a gala dinner"') + input("inKindDescription", "In-kind: what was given") +
      area("notes", "Notes", "", "rows=2") + "</div></details>" +
      '<div class="fd-wide"><button type="submit" class="btn">Save gift</button> <span class="form-msg" role="status"></span></div></form></div>';
  }
  function frGifts(el) {
    var unthanked = FR.gifts.filter(function (g) { return !g.ackSentOn; }).length;
    var html = frGiftForm();
    html += '<div class="fw-card"><div class="fd-row"><h3 style="margin:0">Gifts</h3><span class="fd-dim">' + FR.gifts.length + " recorded</span>" +
      '<span class="fd-push"><a class="btn secondary fd-sm" href="/api/fr/export/gifts.csv">Download CSV</a>' + (unthanked ? ' <a class="btn fd-sm" href="/letter/receipt?pending=1" target="_blank" rel="noopener">Print ' + unthanked + " thank-you letter" + (unthanked === 1 ? "" : "s") + "</a>" : "") + "</span></div>" +
      '<div class="table-wrap"><table class="prospect-table fd-table"><thead><tr><th>Date</th><th>Donor</th><th>Amount</th><th>Method</th><th>Campaign</th><th>Receipt</th><th>Thanked</th><th></th></tr></thead><tbody>' +
      (FR.gifts.length ? FR.gifts.slice(0, 300).map(function (g) {
        return "<tr><td>" + esc(fmtDate(g.receivedOn)) + "</td><td>" + donorLink(g.donorId) + (g.restriction ? '<br><span class="fd-dim fd-small">for ' + esc(g.restriction) + "</span>" : "") + "</td><td>" + money(g.amount) + "</td><td>" + esc(METHOD_LABEL[g.method] || g.method) + "</td><td>" + esc((FR.campaignById[g.campaignId] || {}).name || "") + "</td><td>#" + esc(g.receiptNo) +
          '</td><td>' + (g.ackSentOn ? pill(fmtDate(g.ackSentOn), "good") : '<a href="/letter/receipt?gift=' + encodeURIComponent(g.id) + '" target="_blank" rel="noopener">Letter</a> <button type="button" class="btn secondary fd-sm" data-ack="' + esc(g.id) + '">Mark thanked</button>') +
          '</td><td><button type="button" class="btn danger" data-del-gift="' + esc(g.id) + '">Remove</button></td></tr>';
      }).join("") : '<tr><td colspan="8" class="empty-note">No gifts yet.</td></tr>') + "</tbody></table></div>" + (FR.gifts.length > 300 ? '<p class="fd-dim fd-small">Showing the latest 300; download the CSV for all.</p>' : "") + "</div>";
    html += '<details class="fw-card fd-add"><summary><strong>Bring in gifts from a spreadsheet</strong> <span class="fd-dim">(CSV)</span></summary>' +
      '<p class="fd-small">Save your spreadsheet as CSV with a header row. Columns it understands: <code>name</code>, <code>email</code>, <code>amount</code>, <code>date</code>, <code>method</code>, <code>campaign</code>, <code>reference</code>, <code>restriction</code>, <code>type</code>, <code>address</code>, <code>city</code>, <code>state</code>, <code>zip</code>, <code>notes</code>. Donors are matched by email, then name; new campaigns are created by name.</p>' +
      '<form class="fd-form" id="fr-import-form"><label class="fd-wide">CSV file<input type="file" name="file" accept=".csv,text/csv"></label>' + area("csv", "Or paste it here", "", 'rows=5 placeholder="name,email,amount,date,method,campaign\nJordan Lee,jordan@example.org,250,2026-10-02,check,Annual Fund"') +
      '<label class="check-row fd-wide"><input type="checkbox" name="thanked"> These donors have already been thanked</label><div class="fd-wide"><button type="submit" class="btn">Import gifts</button> <span class="form-msg" role="status"></span></div></form></details>';
    el.innerHTML = html;
  }

  function frDonors(el) {
    var q = FR.search.toLowerCase();
    var lybunt = {}; (FR.summary.lybunt || []).forEach(function (d) { lybunt[d.donorId] = 1; });
    var list = FR.donors.filter(function (d) {
      if (FR.stage === "lybunt") return lybunt[d.id];
      if (FR.stage && d.stage !== FR.stage) return false;
      return !q || (d.name + " " + d.email + " " + d.city).toLowerCase().indexOf(q) >= 0;
    });
    var html = '<div class="fd-toolbar"><label>Search <input type="search" id="fr-search" value="' + esc(FR.search) + '" placeholder="Name, email, city"></label><label>Show <select id="fr-stage">' + opt("", "Everyone", FR.stage) + opt("lybunt", "Gave last year, not this year", FR.stage) +
      Object.keys(STAGE_LABEL).filter(Boolean).map(function (k) { return opt(k, "Stage: " + STAGE_LABEL[k], FR.stage); }).join("") + '</select></label><a class="btn secondary fd-sm" href="/api/fr/export/donors.csv">Download CSV</a></div>';
    html += '<div class="fw-card"><div class="table-wrap"><table class="prospect-table fd-table"><thead><tr><th>Donor</th><th>Type</th><th>Lifetime</th><th>This year</th><th>Last gift</th><th>Stage</th><th>Next step</th></tr></thead><tbody>' +
      (list.length ? list.slice(0, 500).map(function (d) {
        return "<tr><td>" + donorLink(d.id, d.name) + (d.noSolicit ? " " + pill("Do not ask") : "") + (d.email ? '<br><span class="fd-dim fd-small">' + esc(d.email) + "</span>" : "") + "</td><td>" + esc(KIND_LABEL[d.kind] || d.kind) + "</td><td>" + money(d.lifetime) + "</td><td>" + (d.thisYear ? money(d.thisYear) : "") + "</td><td>" + esc(fmtDate(d.lastGift)) +
          "</td><td>" + esc(d.stage ? STAGE_LABEL[d.stage] : "") + '</td><td class="fd-small">' + esc(d.nextStep) + (d.nextOn ? " (" + esc(fmtDate(d.nextOn)) + ")" : "") + "</td></tr>";
      }).join("") : '<tr><td colspan="7" class="empty-note">No donors match.</td></tr>') + "</tbody></table></div></div>";
    html += '<details class="fw-card fd-add"><summary><strong>Add a donor</strong> <span class="fd-dim">(or a prospect who hasn\'t given yet)</span></summary>' + donorForm({ kind: "individual" }, "fr-donor-form") + "</details>";
    el.innerHTML = html;
  }
  function donorForm(d, id) {
    return '<form class="fd-form" id="' + id + '" data-id="' + esc(d.id || "") + '">' + input("name", "Name", "text", d.name, "required maxlength=200") + input("salutation", "Letter greeting", "text", d.salutation, 'placeholder="Dear Ms. Lee,"') +
      '<label>Type<select name="kind">' + Object.keys(KIND_LABEL).map(function (k) { return opt(k, KIND_LABEL[k], d.kind); }).join("") + "</select></label>" +
      input("email", "Email", "email", d.email) + input("phone", "Phone", "tel", d.phone) + input("address", "Street address", "text", d.address) + input("city", "City", "text", d.city) + input("state", "State", "text", d.state, "maxlength=20") + input("zip", "ZIP", "text", d.zip, "maxlength=12") +
      '<label>Stage<select name="stage">' + Object.keys(STAGE_LABEL).map(function (k) { return opt(k, STAGE_LABEL[k], d.stage || ""); }).join("") + "</select></label>" +
      input("capacity", "Possible ask ($)", "text", d.capacity || "", "inputmode=decimal") + input("owner", "Relationship owner", "text", d.owner) +
      area("notes", "Notes", d.notes, "rows=2") + '<label class="check-row fd-wide"><input type="checkbox" name="noSolicit"' + (d.noSolicit ? " checked" : "") + "> Do not ask this donor for gifts</label>" +
      '<div class="fd-wide"><button type="submit" class="btn">' + (d.id ? "Save" : "Add donor") + '</button> <span class="form-msg" role="status"></span></div></form>';
  }
  function frDonorDetail(id) {
    var el = panel("fundraising", "fr-detail");
    showPanel("fundraising", "fr-detail");
    el.innerHTML = '<p class="load-note">Loading...</p>';
    window.scrollTo(0, 0);
    Promise.all([api("/api/fr/donors/" + encodeURIComponent(id)), FR.campaigns.length ? Promise.resolve() : frLoad()]).then(function (r) {
      var d = r[0], dn = d.item, t = d.totals;
      var html = '<div class="fd-toolbar"><button type="button" class="btn secondary" data-fd-back="' + esc(FR.tab || "fr-donors") + '">&larr; Back</button></div>';
      html += '<div class="fw-card"><div class="fd-row"><h3 style="margin:0">' + esc(dn.name) + "</h3> " + pill(KIND_LABEL[dn.kind] || dn.kind) + (dn.stage ? " " + pill(STAGE_LABEL[dn.stage], "gold") : "") + (dn.noSolicit ? " " + pill("Do not ask") : "") + "</div>" +
        '<div class="fd-kpis">' + kpi("Lifetime", money(t.lifetime), t.gifts + " gift" + (t.gifts === 1 ? "" : "s")) + kpi("This year", money(t.thisYear)) + kpi("Last year", money(t.lastYear)) + kpi("Largest gift", money(t.largest)) + kpi("Giving since", t.firstGift ? fmtDate(t.firstGift) : "&ndash;") + "</div></div>";
      html += '<div class="fw-card"><h3>Gifts</h3><div class="table-wrap"><table class="prospect-table fd-table"><thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Campaign</th><th>Thanked</th></tr></thead><tbody>' +
        (d.gifts.length ? d.gifts.map(function (g) {
          return "<tr><td>" + esc(fmtDate(g.receivedOn)) + "</td><td>" + money(g.amount) + "</td><td>" + esc(METHOD_LABEL[g.method] || g.method) + "</td><td>" + esc(g.campaignName) + "</td><td>" + (g.ackSentOn ? pill(fmtDate(g.ackSentOn), "good") : '<a href="/letter/receipt?gift=' + encodeURIComponent(g.id) + '" target="_blank" rel="noopener">Letter</a> <button type="button" class="btn secondary fd-sm" data-ack="' + esc(g.id) + '">Mark thanked</button>') + "</td></tr>";
        }).join("") : '<tr><td colspan="5" class="empty-note">No gifts yet.</td></tr>') + "</tbody></table></div>" + "</div>";
      if (d.pledges.length) html += '<div class="fw-card"><h3>Pledges</h3><table class="prospect-table fd-table"><thead><tr><th>Pledged</th><th>Total</th><th>Received</th><th>Balance</th><th>Status</th></tr></thead><tbody>' + d.pledges.map(function (p) {
        return "<tr><td>" + esc(fmtDate(p.pledgedOn)) + "</td><td>" + money(p.total) + "</td><td>" + money(p.received) + "</td><td>" + money(p.balance) + "</td><td>" + esc(p.status) + "</td></tr>";
      }).join("") + "</tbody></table></div>";
      html += '<div class="fw-card"><h3>Conversations and next steps</h3>' + (d.touches.length ? '<ul class="fd-list fd-touches">' + d.touches.map(function (x) {
        return '<li><span><strong>' + esc(TOUCH_LABEL[x.kind] || x.kind) + "</strong> " + esc(fmtDate(x.onDate)) + (x.summary ? ": " + esc(x.summary) : "") + (x.nextStep ? '<br><span class="fd-small">Next: ' + esc(x.nextStep) + (x.nextOn ? " by " + esc(fmtDate(x.nextOn)) : "") + "</span>" : "") + "</span>" +
          (x.nextStep && !x.done ? '<button type="button" class="btn secondary fd-sm" data-touch-done="' + esc(x.id) + '">Done</button>' : x.nextStep ? pill("Done", "good") : "") + "</li>";
      }).join("") + "</ul>" : empty("Nothing logged yet.")) +
        '<form class="fd-form" id="fr-touch-form" data-id="' + esc(dn.id) + '">' + input("onDate", "Date", "date", today()) + '<label>Kind<select name="kind">' + Object.keys(TOUCH_LABEL).map(function (k) { return opt(k, TOUCH_LABEL[k], "call"); }).join("") + "</select></label>" +
        area("summary", "What happened", "", "rows=2") + input("nextStep", "Next step") + input("nextOn", "Next step by", "date") + '<div class="fd-wide"><button type="submit" class="btn">Log it</button></div></form></div>';
      html += '<details class="fw-card fd-add"><summary><strong>Edit details</strong></summary>' + donorForm(dn, "fr-donor-edit") + '<div class="fd-actions"><button type="button" class="btn danger" data-del-donor="' + esc(dn.id) + '">Remove donor</button></div></details>';
      el.innerHTML = html;
    }).catch(function (e) { el.innerHTML = empty("Couldn't open the donor: " + e.message); });
  }

  function frPledges(el) {
    var html = '<div class="fw-card"><div class="table-wrap"><table class="prospect-table fd-table"><thead><tr><th>Donor</th><th>Campaign</th><th>Pledged</th><th>Total</th><th>Received</th><th>Balance</th><th>Schedule</th><th>Status</th></tr></thead><tbody>' +
      (FR.pledges.length ? FR.pledges.map(function (p) {
        var rec = pledgeReceived(p.id);
        return "<tr><td>" + donorLink(p.donorId) + "</td><td>" + esc((FR.campaignById[p.campaignId] || {}).name || "") + "</td><td>" + esc(fmtDate(p.pledgedOn)) + "</td><td>" + money(p.total) + "</td><td>" + money(rec) + bar(rec, p.total) + "</td><td>" + money(Math.max(0, p.total - rec)) + "</td><td>" +
          esc(p.frequency === "one-time" ? "One payment" : p.installments + " " + p.frequency + " payments") + (p.firstDue ? '<br><span class="fd-dim fd-small">from ' + esc(fmtDate(p.firstDue)) + "</span>" : "") +
          '</td><td><select data-pledge-status="' + esc(p.id) + '">' + opt("open", "Open", p.status) + opt("fulfilled", "Fulfilled", p.status) + opt("written-off", "Written off", p.status) + "</select></td></tr>";
      }).join("") : '<tr><td colspan="8" class="empty-note">No pledges yet.</td></tr>') + "</tbody></table></div><p class=\"fd-dim fd-small\">When a pledge payment comes in, record it as a gift and choose the pledge it pays toward.</p></div>";
    html += '<div class="fw-card"><h3>Record a pledge</h3><form class="fd-form" id="fr-pledge-form">' + donorList() + '<label>Donor<input name="donorName" list="fr-donor-names" required autocomplete="off"></label>' + campaignSelect("") +
      input("total", "Total pledged ($)", "text", "", "inputmode=decimal required") + input("pledgedOn", "Pledged on", "date", today()) +
      '<label>Paid<select name="frequency">' + opt("one-time", "In one payment") + opt("monthly", "Monthly") + opt("quarterly", "Quarterly") + opt("annual", "Yearly") + "</select></label>" +
      input("installments", "Number of payments", "number", "1", "min=1 max=120") + input("firstDue", "First payment due", "date") + area("notes", "Notes", "", "rows=2") +
      '<div class="fd-wide"><button type="submit" class="btn">Save pledge</button> <span class="form-msg" role="status"></span></div></form></div>';
    el.innerHTML = html;
  }

  function frCampaigns(el) {
    var byId = {}; (FR.summary.campaigns || []).forEach(function (c) { byId[c.id] = c; });
    var html = '<div class="fw-card"><div class="table-wrap"><table class="prospect-table fd-table"><thead><tr><th>Campaign or fund</th><th>Type</th><th>Goal</th><th>Raised</th><th>Pledged</th><th>Dates</th><th></th></tr></thead><tbody>' +
      (FR.campaigns.length ? FR.campaigns.map(function (c) {
        var s = byId[c.id] || { raised: 0, pledged: 0 };
        return "<tr><td><strong>" + esc(c.name) + "</strong></td><td>" + esc(FUND_LABEL[c.fundType] || c.fundType) + "</td><td>" + (c.goal ? money(c.goal) : "") + "</td><td>" + money(s.raised) + (c.goal ? bar(s.raised, c.goal, s.pledged) : "") + "</td><td>" + (s.pledged ? money(s.pledged) : "") + "</td><td>" +
          esc(fmtDate(c.startsOn)) + (c.endsOn ? " to " + esc(fmtDate(c.endsOn)) : "") + '</td><td><button type="button" class="btn danger" data-del-campaign="' + esc(c.id) + '">Remove</button></td></tr>';
      }).join("") : '<tr><td colspan="7" class="empty-note">No campaigns yet.</td></tr>') + "</tbody></table></div></div>";
    html += '<div class="fw-card"><h3>New campaign or fund</h3><form class="fd-form" id="fr-campaign-form">' + input("name", "Name", "text", "", 'required maxlength=200 placeholder="2027 Annual Fund"') +
      '<label>Type<select name="fundType">' + Object.keys(FUND_LABEL).map(function (k) { return opt(k, FUND_LABEL[k], "unrestricted"); }).join("") + "</select></label>" +
      input("goal", "Goal ($)", "text", "", "inputmode=decimal") + input("startsOn", "Starts", "date") + input("endsOn", "Ends", "date") + area("notes", "Notes", "", "rows=2") +
      '<div class="fd-wide"><button type="submit" class="btn">Create</button> <span class="form-msg" role="status"></span></div></form></div>';
    el.innerHTML = html;
  }

  // ===================================================================
  // events
  // ===================================================================
  function refresh(view) { if (view === "grants") gmRender(); else frRender(); }
  function currentView(node) { var v = node.closest(".view"); return v ? v.getAttribute("data-view") : ""; }
  function guard(btn, promise, after) {
    if (btn) btn.disabled = true;
    return promise.then(after || function () {}).catch(function (e) { alertMsg(e.message); }).then(function () { if (btn) btn.disabled = false; });
  }
  function alertMsg(text) {
    var bar = document.getElementById("fd-toast");
    if (!bar) { bar = document.createElement("div"); bar.id = "fd-toast"; bar.className = "fd-toast"; bar.setAttribute("role", "status"); document.body.appendChild(bar); }
    bar.textContent = text; bar.hidden = false;
    clearTimeout(bar._t); bar._t = setTimeout(function () { bar.hidden = true; }, 5000);
  }

  document.addEventListener("click", function (e) {
    var b;
    if ((b = e.target.closest(".rail-btn[data-view]"))) {
      var v = b.getAttribute("data-view");
      if (v === "grants") gmRender(GM.tab === "gm-detail" ? "gm-overview" : GM.tab);
      if (v === "fundraising") frRender(FR.tab === "fr-detail" ? "fr-overview" : FR.tab);
      return;
    }
    if ((b = e.target.closest("[data-fd-tab]"))) { var t = b.getAttribute("data-fd-tab"); if (t.indexOf("gm-") === 0) gmRender(t); else frRender(t); return; }
    if ((b = e.target.closest("[data-fd-go]"))) { var g = b.getAttribute("data-fd-go"); if (g.indexOf("gm-") === 0) gmRender(g); else frRender(g); return; }
    if ((b = e.target.closest("[data-fd-back]"))) { var k = b.getAttribute("data-fd-back"); if (k.indexOf("gm-") === 0) gmRender(k); else frRender(k); return; }
    if ((b = e.target.closest("[data-gm-open]"))) { e.preventDefault(); gmDetail(b.getAttribute("data-gm-open")); return; }
    if ((b = e.target.closest("[data-fr-donor]"))) { e.preventDefault(); frDonorDetail(b.getAttribute("data-fr-donor")); return; }
    if ((b = e.target.closest("[data-gm-status]"))) { GM.filterStatus = b.getAttribute("data-gm-status"); gmApps(panel("grants", "gm-apps")); return; }
    if ((b = e.target.closest("[data-gm-edit]"))) { gmPrograms(panel("grants", "gm-programs"), b.getAttribute("data-gm-edit")); var f = document.getElementById("gm-program-form"); if (f && b.getAttribute("data-gm-edit")) f.scrollIntoView({ behavior: "smooth" }); return; }
    if ((b = e.target.closest("[data-gm-archive]"))) { if (confirmRemove("this program")) guard(b, api("/api/gm/programs/" + b.getAttribute("data-gm-archive"), { method: "DELETE" }), function () { gmRender("gm-programs"); }); return; }
    if ((b = e.target.closest("[data-pay]"))) {
      var ref = window.prompt("Paid today. Check number or payment reference (optional):", "");
      if (ref === null) return;
      guard(b, api("/api/gm/payments/" + b.getAttribute("data-pay"), { method: "PATCH", body: { paidOn: today(), reference: ref } }), function () { afterGm(b); });
      return;
    }
    if ((b = e.target.closest("[data-report-in]"))) { guard(b, api("/api/gm/reports/" + b.getAttribute("data-report-in"), { method: "PATCH", body: { receivedOn: today() } }), function () { afterGm(b); }); return; }
    if ((b = e.target.closest("[data-report-note]"))) { var note = window.prompt("What did the report say? (a sentence or two for the record)", ""); if (note) guard(b, api("/api/gm/reports/" + b.getAttribute("data-report-note"), { method: "PATCH", body: { summary: note } }), function () { afterGm(b); }); return; }
    if ((b = e.target.closest("[data-del-payment]"))) { if (confirmRemove("this payment")) guard(b, api("/api/gm/payments/" + b.getAttribute("data-del-payment"), { method: "DELETE" }), function () { afterGm(b); }); return; }
    if ((b = e.target.closest("[data-del-report]"))) { if (confirmRemove("this report")) guard(b, api("/api/gm/reports/" + b.getAttribute("data-del-report"), { method: "DELETE" }), function () { afterGm(b); }); return; }
    if ((b = e.target.closest("[data-gm-set]"))) { var id = b.getAttribute("data-id"); guard(b, api("/api/gm/applications/" + id, { method: "PATCH", body: { status: b.getAttribute("data-gm-set") } }), function () { gmDetail(id); }); return; }
    if ((b = e.target.closest("[data-gm-remove]"))) { if (confirmRemove("this application")) guard(b, api("/api/gm/applications/" + b.getAttribute("data-gm-remove"), { method: "DELETE" }), function () { gmRender("gm-apps"); }); return; }
    if ((b = e.target.closest("[data-ack]"))) { guard(b, api("/api/fr/gifts/ack", { method: "POST", body: { ids: [b.getAttribute("data-ack")] } }), function () { afterFr(b); }); return; }
    if ((b = e.target.closest("[data-del-gift]"))) { if (confirmRemove("this gift")) guard(b, api("/api/fr/gifts/" + b.getAttribute("data-del-gift"), { method: "DELETE" }), function () { frRender("fr-gifts"); }); return; }
    if ((b = e.target.closest("[data-del-campaign]"))) { if (confirmRemove("this campaign (its gifts stay)")) guard(b, api("/api/fr/campaigns/" + b.getAttribute("data-del-campaign"), { method: "DELETE" }), function () { frRender("fr-campaigns"); }); return; }
    if ((b = e.target.closest("[data-del-donor]"))) { if (confirmRemove("this donor")) guard(b, api("/api/fr/donors/" + b.getAttribute("data-del-donor"), { method: "DELETE" }), function () { frRender("fr-donors"); }); return; }
    if ((b = e.target.closest("[data-touch-done]"))) { guard(b, api("/api/fr/touches/" + b.getAttribute("data-touch-done"), { method: "PATCH", body: { done: true } }), function () { afterFr(b); }); return; }
  });
  // "Remove" archives, so a plain confirm keeps it from being a one-tap accident.
  function confirmRemove(what) { return window.confirm("Remove " + what + "? It's kept in backups but disappears from these lists."); }
  function afterGm(node) { var d = node.closest('[data-fd-panel="gm-detail"]'); var f = d && d.querySelector("form[data-id]"); if (d && f) gmDetail(f.getAttribute("data-id")); else gmRender(); }
  function afterFr(node) { var d = node.closest('[data-fd-panel="fr-detail"]'); var f = d && d.querySelector("#fr-touch-form"); if (d && f) frDonorDetail(f.getAttribute("data-id")); else frRender(); }

  document.addEventListener("change", function (e) {
    var t = e.target;
    if (t.id === "gm-filter-program") { GM.filterProgram = t.value; gmApps(panel("grants", "gm-apps")); }
    else if (t.id === "fr-stage") { FR.stage = t.value; frDonors(panel("fundraising", "fr-donors")); }
    else if (t.hasAttribute && t.hasAttribute("data-pledge-status")) api("/api/fr/pledges/" + t.getAttribute("data-pledge-status"), { method: "PATCH", body: { status: t.value } }).catch(function (err) { alertMsg(err.message); });
    else if (t.closest && t.closest("#areas-list") && t.type === "checkbox") saveAreas();
  });
  var searchTimer;
  document.addEventListener("input", function (e) {
    if (e.target.id !== "fr-search") return;
    clearTimeout(searchTimer);
    var val = e.target.value;
    searchTimer = setTimeout(function () {
      FR.search = val; frDonors(panel("fundraising", "fr-donors"));
      var s = document.getElementById("fr-search"); if (s) { s.focus(); s.setSelectionRange(val.length, val.length); }
    }, 250);
  });

  document.addEventListener("submit", function (e) {
    var f = e.target, id = f.id;
    if (["gm-program-form", "gm-app-form", "gm-review-form", "gm-award-form", "gm-payment-form", "gm-report-form", "gm-signed-form",
      "fr-gift-form", "fr-import-form", "fr-donor-form", "fr-donor-edit", "fr-touch-form", "fr-pledge-form", "fr-campaign-form"].indexOf(id) < 0) return;
    e.preventDefault();
    var msg = f.querySelector(".form-msg"), btn = f.querySelector('button[type="submit"]'), d = formData(f), rid = f.getAttribute("data-id");
    var done = function (text, then) { return function () { flash(msg, text); if (then) then(); }; };
    var fail = function (err) { flash(msg, err.message, true); if (!msg) alertMsg(err.message); };
    var go = function (p, after) { if (btn) btn.disabled = true; p.then(after).catch(fail).then(function () { if (btn) btn.disabled = false; }); };

    if (id === "gm-program-form") go(api(rid ? "/api/gm/programs/" + rid : "/api/gm/programs", { method: rid ? "PATCH" : "POST", body: d }), done("Saved.", function () { gmRender("gm-programs"); }));
    else if (id === "gm-app-form") go(api("/api/gm/applications", { method: "POST", body: d }), function (r) { gmDetail(r.item.id); });
    else if (id === "gm-review-form") {
      var scores = {}; Object.keys(d).forEach(function (k) { if (k.indexOf("s_") === 0 && d[k]) scores[k.slice(2)] = Number(d[k]); });
      go(api("/api/gm/applications/" + rid + "/review", { method: "POST", body: { scores: scores, recommendation: d.recommendation, comment: d.comment, conflict: d.conflict } }), function () { gmDetail(rid); });
    }
    else if (id === "gm-award-form") go(api("/api/gm/applications/" + rid + "/award", { method: "POST", body: d }), function () { gmDetail(rid); });
    else if (id === "gm-payment-form") go(api("/api/gm/payments", { method: "POST", body: Object.assign(d, { applicationId: rid }) }), function () { gmDetail(rid); });
    else if (id === "gm-report-form") go(api("/api/gm/reports", { method: "POST", body: Object.assign(d, { applicationId: rid }) }), function () { gmDetail(rid); });
    else if (id === "gm-signed-form") go(api("/api/gm/applications/" + rid, { method: "PATCH", body: d }), done("Saved."));
    else if (id === "fr-gift-form") {
      var donor = findDonor(d.donorName);
      var body = Object.assign({}, d, donor ? { donorId: donor.id } : {});
      if (d.thanked) body.ackSentOn = today();
      delete body.thanked;
      go(api("/api/fr/gifts", { method: "POST", body: body }), function () { flash(msg, "Saved."); frRender("fr-gifts"); });
    }
    else if (id === "fr-import-form") {
      var file = f.querySelector('input[type="file"]').files[0];
      var read = file ? file.text() : Promise.resolve(d.csv || "");
      go(read.then(function (text) {
        return fetch("/api/fr/import" + (d.thanked ? "?thanked=1" : ""), { method: "POST", headers: { "Content-Type": "text/csv" }, body: text }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "Import failed"); return j; }); });
      }), function (r) {
        alertMsg("Imported " + r.created + " gift" + (r.created === 1 ? "" : "s") + ", " + r.newDonors + " new donor" + (r.newDonors === 1 ? "" : "s") + (r.newCampaigns ? ", " + r.newCampaigns + " new campaign" + (r.newCampaigns === 1 ? "" : "s") : "") + (r.errors.length ? ". Skipped: " + r.errors.join("; ") : "."));
        frRender("fr-gifts");
      });
    }
    else if (id === "fr-donor-form") go(api("/api/fr/donors", { method: "POST", body: d }), function (r) { frDonorDetail(r.item.id); });
    else if (id === "fr-donor-edit") go(api("/api/fr/donors/" + rid, { method: "PATCH", body: d }), function () { frDonorDetail(rid); });
    else if (id === "fr-touch-form") go(api("/api/fr/touches", { method: "POST", body: Object.assign(d, { donorId: rid }) }), function () { frDonorDetail(rid); });
    else if (id === "fr-pledge-form") {
      var pd = findDonor(d.donorName);
      var make = pd ? Promise.resolve({ item: pd }) : api("/api/fr/donors", { method: "POST", body: { name: d.donorName } });
      go(make.then(function (r) { var b2 = Object.assign({}, d, { donorId: r.item.id }); delete b2.donorName; return api("/api/fr/pledges", { method: "POST", body: b2 }); }), function () { frRender("fr-pledges"); });
    }
    else if (id === "fr-campaign-form") go(api("/api/fr/campaigns", { method: "POST", body: d }), function () { frRender("fr-campaigns"); });
  });

  // ---------- Settings > Areas ----------
  var AREA_LABEL = { consulting: "Consulting practice (pipeline, money, delivery)", institutionalos: "InstitutionalOS (client diagnostics)", marketScan: "DMV market scan", donorAnalysis: "Donor analysis",
    givingLandscape: "Giving landscape", fieldIntelligence: "Field intelligence", myDesk: "My Desk", grantmaking: "Grants (give money out)", fundraising: "Fundraising (donors and gifts)", governance: "Board & governance" };
  function renderAreas() {
    var box = document.getElementById("areas-list");
    if (!box) return;
    api("/api/settings").then(function (s) {
      var m = s.modules || {};
      box.innerHTML = Object.keys(m).map(function (k) { return '<label class="check-row"><input type="checkbox" data-area="' + esc(k) + '"' + (m[k] ? " checked" : "") + "> " + esc(AREA_LABEL[k] || k) + "</label>"; }).join("");
    }).catch(function () { box.innerHTML = ""; });
  }
  function saveAreas() {
    var mods = {};
    document.querySelectorAll("#areas-list [data-area]").forEach(function (c) { mods[c.getAttribute("data-area")] = c.checked; });
    api("/api/settings", { method: "POST", body: { modules: mods } }).then(function () {
      flash(document.getElementById("areas-msg"), "Saved. Reloading to apply...");
      setTimeout(function () { window.location.reload(); }, 900);
    }).catch(function (e) { flash(document.getElementById("areas-msg"), e.message, true); });
  }
  document.addEventListener("click", function (e) { if (e.target.closest("#open-settings-btn")) setTimeout(renderAreas, 50); });

  // ---------- Today: grants, gifts & board in one list ----------
  function renderTodayFoundation() {
    var card = document.getElementById("today-foundation-card");
    var list = document.getElementById("today-foundation");
    if (!card || !list) return;
    var m = (window.ORG && window.ORG.modules) || {};
    var on = { gm: m.grantmaking !== false, fr: m.fundraising !== false, gv: m.governance !== false };
    card.hidden = !(on.gm || on.fr || on.gv);
    var grid = card.parentElement; if (grid) grid.classList.toggle("has-four", !card.hidden);
    if (card.hidden) return;
    var skip = Promise.resolve(null);
    Promise.all([on.gm ? api("/api/gm/summary").catch(function () { return null; }) : skip, on.fr ? api("/api/fr/summary").catch(function () { return null; }) : skip, on.gv ? api("/api/gov/summary").catch(function () { return null; }) : skip]).then(function (r) {
      var gm = r[0], fr = r[1], gv = r[2], items = [], t = today();
      var soon = new Date(); soon.setDate(soon.getDate() + 14); var in14 = soon.toISOString().slice(0, 10);
      function add(rank, area, text, go) { items.push({ rank: rank, area: area, text: text, go: go }); }
      if (gm) {
        gm.paymentsDue.forEach(function (p) { add(p.overdue ? 0 : 1, "Grants", (p.overdue ? "Payment overdue: " : "Payment due " + fmtDate(p.dueOn) + ": ") + p.orgName + ", " + money(p.amount), "grants:gm-overview"); });
        gm.reportsDue.filter(function (x) { return x.overdue; }).forEach(function (x) { add(0, "Grants", (x.kind === "final" ? "Final" : "Interim") + " report overdue from " + x.orgName, "grants:gm-overview"); });
        if (gm.needsReview.length) add(1, "Grants", gm.needsReview.length + " application" + (gm.needsReview.length === 1 ? " needs" : "s need") + " a first review", "grants:gm-apps");
        else if (gm.totals.newOnline) add(2, "Grants", gm.totals.newOnline + " new online application" + (gm.totals.newOnline === 1 ? "" : "s"), "grants:gm-apps");
      }
      if (fr) {
        var late = fr.toThank.filter(function (g) { return g.daysWaiting > 2; }).length;
        if (fr.toThank.length) add(late ? 0 : 1, "Fundraising", fr.toThank.length + " donor" + (fr.toThank.length === 1 ? "" : "s") + " to thank" + (late ? " (" + late + " waiting more than 2 days)" : ""), "fundraising:fr-overview");
        var pOver = fr.pledgesDue.filter(function (p) { return p.overdue; }).length;
        if (fr.pledgesDue.length) add(pOver ? 0 : 1, "Fundraising", fr.pledgesDue.length + " pledge payment" + (fr.pledgesDue.length === 1 ? "" : "s") + " due" + (pOver ? ", " + pOver + " overdue" : ""), "fundraising:fr-pledges");
        fr.followUps.slice(0, 3).forEach(function (f) { add(f.overdue ? 0 : 1, "Fundraising", f.donorName + ": " + f.nextStep + (f.overdue ? "" : " (" + fmtDate(f.nextOn) + ")"), "donor:" + f.donorId); });
      }
      if (gv) {
        gv.minutesMissing.slice(0, 2).forEach(function (x) { add(0, "Board", "Write the minutes: " + x.title + ", " + fmtDate(x.startsAt), "meeting:" + x.id); });
        if (gv.nextMeeting && gv.nextMeeting.startsAt.slice(0, 10) <= in14) add(1, "Board", gv.nextMeeting.title + " " + fmtDate(gv.nextMeeting.startsAt) + ": send the agenda", "meeting:" + gv.nextMeeting.id);
        (gv.checklist[0] ? gv.checklist[0].next : []).filter(function (c) { return c.overdue || c.dueOn <= in14; }).slice(0, 2).forEach(function (c) { add(c.overdue ? 0 : 1, "Form 990", c.label, "board:gv-990"); });
        if (gv.coi.started && gv.coi.unsigned.length) add(1, "Board", gv.coi.unsigned.length + " conflict statement" + (gv.coi.unsigned.length === 1 ? "" : "s") + " unsigned for " + gv.coi.year, "board:gv-coi");
        if (gv.minutesToApprove.length) add(2, "Board", gv.minutesToApprove.length + " set" + (gv.minutesToApprove.length === 1 ? "" : "s") + " of minutes to approve at the next meeting", "board:gv-meetings");
      }
      items.sort(function (a, b) { return a.rank - b.rank; });
      var over = items.filter(function (i) { return i.rank === 0; }).length;
      var sub = document.getElementById("today-foundation-sub");
      if (sub) sub.textContent = items.length ? (over ? over + " overdue, " : "") + items.length + " item" + (items.length === 1 ? "" : "s") + " in all." : "Nothing due.";
      list.innerHTML = items.length ? items.slice(0, 8).map(function (i) {
        return "<li" + (i.rank === 0 ? ' class="row-overdue"' : "") + '><span><span class="who">' + esc(i.area) + '</span><br><a href="#" data-today-go="' + esc(i.go) + '">' + esc(i.text) + "</a></span>" + (i.rank === 0 ? '<span class="when"><span class="overdue-tag">Overdue</span></span>' : "") + "</li>";
      }).join("") + (items.length > 8 ? '<li class="fd-small fd-dim" style="border:none">and ' + (items.length - 8) + " more</li>" : "")
        : '<li class="empty-note fd-empty-art" style="border:none;">' + EMPTY_ART + "Nothing due for grants, gifts, or the board.</li>";
    });
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-today-go]");
    if (b) {
      e.preventDefault();
      var parts = b.getAttribute("data-today-go").split(":"), kind = parts[0], arg = parts[1];
      var view = { grants: "grants", fundraising: "fundraising", donor: "fundraising", board: "board", meeting: "board" }[kind];
      var rail = document.querySelector('.rail-btn[data-view="' + view + '"]');
      if (rail) rail.click();
      setTimeout(function () {
        if (kind === "grants") gmRender(arg);
        else if (kind === "fundraising") frRender(arg);
        else if (kind === "donor") frDonorDetail(arg);
        else if (window.GV) { if (kind === "board") window.GV.render(arg); else window.GV.meeting(arg); }
      }, 30);
      return;
    }
    if (e.target.closest('.rail-btn[data-view="today"]')) setTimeout(renderTodayFoundation, 30);
  });
  // A small line drawing for empty lists: a ledger and a check mark, in the brand colors.
  var EMPTY_ART = '<svg class="fd-art" viewBox="0 0 120 80" aria-hidden="true" focusable="false"><rect x="22" y="10" width="62" height="60" rx="6" fill="none" stroke="currentColor" stroke-width="2.5" opacity=".45"/><path d="M34 28h38M34 40h30M34 52h22" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" opacity=".45"/><circle cx="86" cy="54" r="15" fill="var(--accent,#B28E42)" opacity=".18"/><path d="M79 54l5 5 10-11" fill="none" stroke="var(--accent,#B28E42)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  window.FD = { renderToday: renderTodayFoundation, art: EMPTY_ART };

  // ---------- startup ----------
  function applyModules(cfg) {
    var m = (cfg && cfg.modules) || {};
    var label = document.querySelector('[data-module-group="foundation"]');
    if (label) label.hidden = m.grantmaking === false && m.fundraising === false && m.governance === false;
  }
  document.addEventListener("org:ready", function (e) { applyModules(e.detail); renderTodayFoundation(); });
  if (window.ORG) { applyModules(window.ORG); renderTodayFoundation(); }
  // If the page reopened on one of these views, draw it.
  var gv = document.querySelector('.view[data-view="grants"]'), fv = document.querySelector('.view[data-view="fundraising"]');
  if (gv && !gv.hidden) gmRender("gm-overview");
  if (fv && !fv.hidden) frRender("fr-overview");
  var sv = document.querySelector('.view[data-view="settings"]');
  if (sv && !sv.hidden) renderAreas();
})();
