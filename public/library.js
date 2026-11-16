/* Process Library view. Server side is processes.js (/api/proc/*).
   "How we work": checklists with an owner, when they're used, steps with due
   days, and a review date; start one for a client, grant, meeting, or month.
   "In progress": the checklists you've started. "What we deliver": materials. */
(function () {
  "use strict";
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function today() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function fmtDate(iso) { if (!/^\d{4}-\d{2}-\d{2}/.test(iso || "")) return ""; return new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  function api(url, opts) {
    opts = opts || {};
    if (opts.body && typeof opts.body !== "string") { opts.headers = { "Content-Type": "application/json" }; opts.body = JSON.stringify(opts.body); }
    return fetch(url, opts).then(function (res) {
      if (res.status === 401) { window.location.href = "/"; throw new Error("not signed in"); }
      return res.json().catch(function () { return {}; }).then(function (b) { if (!res.ok) throw new Error(b.error || ("request failed: " + res.status)); return b; });
    });
  }
  function formData(f) { var o = {}; Array.prototype.forEach.call(f.elements, function (el) { if (!el.name) return; o[el.name] = el.type === "checkbox" ? el.checked : el.value; }); return o; }
  function pill(t, k) { return '<span class="pill' + (k ? " " + k : "") + '">' + esc(t) + "</span>"; }
  function opt(v, l, sel) { return '<option value="' + esc(v) + '"' + (String(sel) === String(v) ? " selected" : "") + ">" + esc(l) + "</option>"; }
  function input(n, l, type, v, a) { return "<label>" + esc(l) + '<input name="' + n + '" type="' + (type || "text") + '" value="' + esc(v == null ? "" : v) + '" ' + (a || "") + "></label>"; }
  function area(n, l, v, a) { return '<label class="fd-wide">' + esc(l) + '<textarea name="' + n + '" ' + (a || "") + ">" + esc(v || "") + "</textarea></label>"; }
  function empty(t) { return '<p class="empty-note fd-empty fd-empty-art">' + ((window.FD && window.FD.art) || "") + esc(t) + "</p>"; }
  function bar(a, b) { var p = b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0; return '<div class="fd-bar" role="img" aria-label="' + p + ' percent"><span style="width:' + p + '%"></span></div>'; }
  function toast(t) {
    var b = document.getElementById("fd-toast");
    if (!b) { b = document.createElement("div"); b.id = "fd-toast"; b.className = "fd-toast"; b.setAttribute("role", "status"); document.body.appendChild(b); }
    b.textContent = t; b.hidden = false; clearTimeout(b._t); b._t = setTimeout(function () { b.hidden = true; }, 5000);
  }
  function addMonths(iso, n) { var d = new Date(iso + "T12:00:00"); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 10); }

  var AREA = { consulting: "Consulting", institutionalos: "InstitutionalOS", operations: "Running the business", grants: "Grants", fundraising: "Fundraising", board: "Board & governance" };
  var AREA_MODULE = { consulting: "consulting", institutionalos: "institutionalos", grants: "grantmaking", fundraising: "fundraising", board: "governance" };
  var SUGGEST = { "": "Only when I start it", "pipeline:lead": "A new lead in the pipeline", "pipeline:assessment": "A deal moves to the Diagnostic stage", "pipeline:engaged": "A deal moves to Engaged", "pipeline:graduated": "An engagement finishes",
    "grant:approved": "A grant is approved", "meeting:upcoming": "Three weeks before a board meeting", "member:new": "A new board or staff member", "month:end": "The last week of each month", "year:end": "December each year" };
  var AUTO_LABEL = { sent: "when its message is sent", "pipe.nextStep": "when the pipeline record has a dated next step", "pipe.diagnostic": "when the deal moves to the Diagnostic stage",
    "pipe.invoiceSent": "when an invoice is marked sent", "pipe.invoicePaid": "when the invoice is marked paid", "ios.linked": "when the deal is linked to InstitutionalOS", "ios.scored": "when InstitutionalOS has the scores",
    "ios.constraint": "when the constraint is confirmed in InstitutionalOS", "ios.plan": "when the 90-day plan starts in InstitutionalOS", "ios.checkin": "when the client logs a check-in in their portal",
    "ios.review90": "when the 90-day review is logged", "feedback.received": "when they submit the feedback form", "grant.agreement": "when the signed agreement date is recorded",
    "grant.paid1": "when the first payment is marked paid", "grant.interim": "when the grantee submits the interim report", "grant.final": "when the grantee submits the final report",
    "meeting.attendance": "when attendance is taken", "meeting.minutes": "when the minutes are written", "meeting.approved": "when the minutes' approval date is recorded",
    "member.exists": "when they're on the board list", "member.account": "when they have a sign-in", "member.coi": "when they sign their conflict statement",
    "year.990": "when the 990 checklist is started", "year.coiAll": "when every board member has signed", "year.990filed": "when the 990 is marked filed", "month.invoices": "when this month's invoices are sent" };
  var ACTIONS = { scan: ["Open the market scan", "view:practice"], "letter.engagement": ["Engagement letter", "url:/letter/engagement?pipeline={id}", "pipeline"], today: ["Open Today", "view:today"],
    "report.monthly": ["Monthly report", "url:/report/monthly"], "grant.letter": ["Award letter", "url:/letter/grant/{id}?kind=award", "grant"], "grant.990": ["Open the grant", "grant:{id}", "grant"],
    receipts: ["Thank-you letters", "url:/letter/receipt?pending=1"], "print.agenda": ["Agenda", "url:/print/agenda/{id}", "meeting"], "print.minutes": ["Minutes", "url:/print/minutes/{id}", "meeting"],
    "gov.990": ["Form 990 checklist", "board:gv-990"], "gov.coi": ["Conflict statements", "board:gv-coi"], "gov.policies": ["Policies", "board:gv-policies"], settings: ["Settings", "settings"] };
  var KIND = { curriculum: "Curriculum", workbook: "Workbook", playbook: "Playbook", strategy: "Strategy", template: "Template", policy: "Policy", other: "Other" };
  var L = { tab: "lb-work", search: "" };
  function moduleOn(a) { var m = (window.ORG && window.ORG.modules) || {}; var k = AREA_MODULE[a]; return !k || m[k] !== false; }
  function panel(k) { return document.querySelector('[data-lb-panel="' + k + '"]'); }
  function show(k) {
    document.querySelectorAll("[data-lb-panel]").forEach(function (p) { p.hidden = p.getAttribute("data-lb-panel") !== k; });
    document.querySelectorAll("[data-lb-tab]").forEach(function (b) { var on = b.getAttribute("data-lb-tab") === k; b.classList.toggle("is-active", on); b.setAttribute("aria-selected", on ? "true" : "false"); });
  }
  function render(tab) {
    tab = tab || L.tab; L.tab = tab; show(tab);
    var el = panel(tab); el.innerHTML = '<p class="load-note">Loading...</p>';
    ({ "lb-work": work, "lb-running": running, "lb-deliver": deliver, "lb-outbox": outbox })[tab](el).catch(function (e) { el.innerHTML = empty("Couldn't load: " + e.message); });
  }
  function isPrivate(link) { return /claude\.ai\/(code\/)?artifact\//.test(link || ""); }

  // ---------- How we work ----------
  function work(el) {
    return Promise.all([api("/api/proc/processes"), api("/api/proc/summary")]).then(function (r) {
      var procs = r[0].items.filter(function (p) { return moduleOn(p.area); }), s = r[1];
      var sugg = s.suggestions.filter(function (x) { return moduleOn(x.area); });
      var reviewDue = {}; s.reviews.forEach(function (x) { reviewDue[x.id] = x.nextReview; });
      var html = "";
      if (sugg.length) {
        html += '<div class="fw-card lb-suggest"><h3>Ready to start</h3><p class="fd-small fd-dim">Something in the system calls for one of your checklists. Start it, or mark it not needed.</p><ul class="fd-list">' + sugg.slice(0, 12).map(function (x, i) {
          return '<li><span><strong>' + esc(x.processName) + "</strong> for " + esc(x.subjectLabel) + '<br><span class="fd-small fd-dim">' + esc(x.why) + '</span></span><span class="lb-btns"><button type="button" class="btn fd-sm" data-lb-start-sugg="' + i + '">Start</button> <button type="button" class="btn secondary fd-sm" data-lb-skip="' + i + '">Not needed</button></span></li>';
        }).join("") + "</ul>" + (sugg.length > 12 ? '<p class="fd-small fd-dim">and ' + (sugg.length - 12) + " more</p>" : "") + "</div>";
      }
      L.sugg = sugg;
      var areas = Object.keys(AREA).filter(function (a) { return procs.some(function (p) { return p.area === a; }); });
      html += '<div class="fd-grid lb-grid">' + areas.map(function (a) {
        return '<div class="fw-card"><h3>' + esc(AREA[a]) + "</h3>" + procs.filter(function (p) { return p.area === a; }).map(function (p) {
          var due = reviewDue[p.id];
          return '<div class="lb-proc"><div class="fd-row"><a href="#" data-lb-proc="' + esc(p.id) + '"><strong>' + esc(p.name) + "</strong></a>" + (p.openRuns ? pill(p.openRuns + " in progress", "gold") : "") + (due ? pill("Review due", "warn") : "") + "</div>" +
            '<p class="fd-small fd-dim">' + esc(p.usedWhen) + "</p>" +
            '<div class="fd-row fd-small fd-dim">' + (p.steps || []).length + " steps" + (p.owner ? " &middot; owner " + esc(p.owner) : " &middot; no owner yet") + " &middot; used " + p.runs + " time" + (p.runs === 1 ? "" : "s") +
            '<span class="fd-push"><button type="button" class="btn secondary fd-sm" data-lb-start="' + esc(p.id) + '" data-name="' + esc(p.name) + '">Start</button></span></div></div>';
        }).join("") + "</div>";
      }).join("") + "</div>";
      if (!procs.length) html += empty("No processes yet. Add the first one below.");
      html += '<details class="fw-card fd-add"><summary><strong>Add a process</strong></summary>' + procForm({ area: "consulting", reviewEveryMonths: 12, steps: [] }, "lb-proc-new") + "</details>";
      el.innerHTML = html;
    });
  }
  function procForm(p, id) {
    var stepsText = (p.steps || []).map(function (x) { return x.text + (x.days !== "" && x.days != null ? " (day " + x.days + ")" : ""); }).join("\n");
    return '<form class="fd-form" id="' + id + '" data-id="' + esc(p.id || "") + '">' + input("name", "Name", "text", p.name, "required maxlength=200") +
      '<label>Area<select name="area">' + Object.keys(AREA).map(function (k) { return opt(k, AREA[k], p.area); }).join("") + "</select></label>" + input("owner", "Owner", "text", p.owner, 'placeholder="Who keeps this current"') +
      '<label>Suggest it when<select name="suggestOn">' + Object.keys(SUGGEST).map(function (k) { return opt(k, SUGGEST[k], p.suggestOn || ""); }).join("") + "</select></label>" +
      input("usedWhen", "Used when (plain words)", "text", p.usedWhen) + input("reviewEveryMonths", "Review every (months)", "number", p.reviewEveryMonths || 12, "min=1 max=60") +
      area("purpose", "Why it matters", p.purpose, "rows=2") +
      area("steps", 'Steps, one per line. Add "(day 7)" to give a step a due date that many days after starting.', stepsText, 'rows=9 required placeholder="Reply within one business day (day 1)"') +
      input("docLink", "Link to the full write-up (optional)", "url", p.docLink, 'placeholder="https://drive.google.com/..."') +
      '<div class="fd-wide"><button type="submit" class="btn">' + (p.id ? "Save" : "Add process") + '</button> <span class="form-msg" role="status"></span></div></form>';
  }
  function processDetail(id) {
    var el = panel("lb-process"); show("lb-process"); el.innerHTML = '<p class="load-note">Loading...</p>'; window.scrollTo(0, 0);
    Promise.all([api("/api/proc/processes"), api("/api/proc/runs")]).then(function (r) {
      var p = r[0].items.filter(function (x) { return x.id === id; })[0];
      if (!p) { el.innerHTML = empty("Process not found."); return; }
      var runs = r[1].items.filter(function (x) { return x.processId === id; });
      var base = p.lastReviewed || (p.createdAt || "").slice(0, 10), next = base ? addMonths(base, p.reviewEveryMonths || 12) : "";
      el.innerHTML = '<div class="fd-toolbar"><button type="button" class="btn secondary" data-lb-go="lb-work">&larr; How we work</button><span><button type="button" class="btn" data-lb-start="' + esc(p.id) + '" data-name="' + esc(p.name) + '">Start this checklist</button></span></div>' +
        '<div class="fw-card"><div class="fd-row"><h3 style="margin:0">' + esc(p.name) + "</h3>" + pill(AREA[p.area] || p.area) + pill("Version " + (p.version || 1)) + "</div>" +
        (p.purpose ? "<p>" + esc(p.purpose) + "</p>" : "") + '<p class="fd-small fd-dim">' + esc(p.usedWhen) + (p.suggestOn ? " Suggested automatically: " + esc((SUGGEST[p.suggestOn] || "").toLowerCase()) + "." : "") + "</p>" +
        '<ol class="lb-steps">' + (p.steps || []).map(function (x) { return "<li>" + esc(x.text) + (x.days !== "" && x.days != null ? ' <span class="fd-dim fd-small">day ' + x.days + "</span>" : "") +
          (x.auto && x.auto !== "sent" ? ' <span class="lb-tag lb-auto">&#8635; ticks itself ' + esc(AUTO_LABEL[x.auto] || "") + "</span>" : "") + (x.message ? ' <span class="lb-tag lb-msg">&#9993; drafts a message for your approval</span>' : "") + "</li>"; }).join("") + "</ol>" +
        (p.docLink ? '<p><a href="' + esc(p.docLink) + '" target="_blank" rel="noopener">Full write-up</a>' + (isPrivate(p.docLink) ? " " + pill("Private link: only you can open it", "warn") : "") + "</p>" : "") +
        '<div class="fd-row fd-small fd-dim">Owner: ' + (p.owner ? esc(p.owner) : "not set") + " &middot; last reviewed " + (p.lastReviewed ? esc(fmtDate(p.lastReviewed)) : "never") + " &middot; next review " + esc(fmtDate(next)) +
        '<span class="fd-push"><button type="button" class="btn secondary fd-sm" data-lb-reviewed="' + esc(p.id) + '">Reviewed today</button></span></div></div>' +
        '<div class="fw-card"><h3>Times used</h3>' + (runs.length ? '<ul class="fd-list">' + runs.map(function (x) {
          return '<li><a href="#" data-lb-run="' + esc(x.id) + '">' + esc(x.subjectLabel || "Untitled") + '</a><span class="fd-small">' + (x.completedOn ? pill("Done " + fmtDate(x.completedOn), "good") : x.done + " of " + x.total + " steps") + "</span></li>";
        }).join("") + "</ul>" : empty("Not used yet.")) + "</div>" +
        '<details class="fw-card fd-add"><summary><strong>Edit this process</strong> <span class="fd-dim">(changing the steps makes a new version; checklists already started keep their steps)</span></summary>' + procForm(p, "lb-proc-edit") +
        '<div class="fd-actions"><button type="button" class="btn danger" data-lb-del-proc="' + esc(p.id) + '">Remove process</button></div></details>';
    }).catch(function (e) { el.innerHTML = empty("Couldn't open: " + e.message); });
  }

  // ---------- In progress ----------
  function running(el) {
    return api("/api/proc/runs").then(function (r) {
      var open = r.items.filter(function (x) { return !x.completedOn; }), done = r.items.filter(function (x) { return x.completedOn; });
      function rows(list) {
        return list.map(function (x) {
          return '<tr><td><a href="#" data-lb-run="' + esc(x.id) + '"><strong>' + esc(x.subjectLabel || "Untitled") + '</strong></a><br><span class="fd-small fd-dim">' + esc(x.processName) + "</span></td><td>" + x.done + " of " + x.total + bar(x.done, x.total) + "</td><td class=\"fd-small\">" +
            (x.completedOn ? pill("Done " + fmtDate(x.completedOn), "good") : x.nextStep ? esc(x.nextStep.text) + (x.nextStep.dueOn ? " (" + esc(fmtDate(x.nextStep.dueOn)) + ")" : "") + (x.overdue ? " " + pill(x.overdue + " overdue", "warn") : "") : "") + '</td><td class="fd-small">' + esc(x.owner) + "</td></tr>";
        }).join("");
      }
      var head = "<thead><tr><th>For</th><th>Progress</th><th>Next step</th><th>Owner</th></tr></thead>";
      el.innerHTML = '<div class="fw-card"><h3>In progress</h3>' + (open.length ? '<div class="table-wrap"><table class="prospect-table fd-table">' + head + "<tbody>" + rows(open) + "</tbody></table></div>" : empty("No checklists in progress. Start one from How we work.")) + "</div>" +
        (done.length ? '<details class="fw-card"><summary><strong>Finished</strong> <span class="fd-dim">(' + done.length + ")</span></summary><div class=\"table-wrap\"><table class=\"prospect-table fd-table\">" + head + "<tbody>" + rows(done.slice(0, 100)) + "</tbody></table></div></details>" : "");
    });
  }
  function actionBtn(key, run) {
    var a = ACTIONS[key]; if (!a) return "";
    if (a[2] && a[2] !== run.subjectKind) return "";
    var target = a[1].replace("{id}", encodeURIComponent(run.subjectId || ""));
    if (target.indexOf("url:") === 0) return '<a class="btn secondary fd-sm" href="' + esc(target.slice(4)) + '" target="_blank" rel="noopener">' + esc(a[0]) + "</a>";
    return '<button type="button" class="btn secondary fd-sm" data-lb-act="' + esc(target) + '">' + esc(a[0]) + "</button>";
  }
  function runDetail(id) {
    var el = panel("lb-run"); show("lb-run"); el.innerHTML = '<p class="load-note">Loading...</p>'; window.scrollTo(0, 0);
    Promise.all([api("/api/proc/runs"), api("/api/proc/runs/" + encodeURIComponent(id) + "/activity")]).then(function (r) {
      var x = r[0].items.filter(function (y) { return y.id === id; })[0];
      if (!x) { el.innerHTML = empty("Checklist not found."); return; }
      var act = r[1], t = today();
      var msgFor = function (i) { return act.messages.filter(function (m) { return m.stepIndex === i; }); };
      var needsContact = x.steps.some(function (st) { return st.message && (!st.to || st.to === "contact"); });
      el.innerHTML = '<div class="fd-toolbar"><button type="button" class="btn secondary" data-lb-go="lb-running">&larr; In progress</button></div>' +
        '<div class="fw-card"><div class="fd-row"><h3 style="margin:0">' + esc(x.subjectLabel || "Untitled") + "</h3>" + (x.completedOn ? pill("Done " + fmtDate(x.completedOn), "good") : pill(x.done + " of " + x.total + " done", "gold")) + "</div>" +
        '<p class="fd-dim fd-small"><a href="#" data-lb-proc="' + esc(x.processId) + '">' + esc(x.processName) + "</a> &middot; started " + esc(fmtDate(x.startedOn)) + "</p>" + bar(x.done, x.total) +
        (needsContact ? '<form class="fd-form fd-inline lb-contact" id="lb-contact" data-id="' + esc(x.id) + '">' + input("contactName", "Messages go to", "text", x.contactName, 'placeholder="Name"') + input("contactEmail", "Email", "email", x.contactEmail, 'placeholder="name@organization.org"') +
          '<div><button type="submit" class="btn secondary">Save</button></div></form>' + (!x.contactEmail ? '<p class="fd-small lb-note">' + pill("No email yet", "warn") + " Add who this checklist's messages go to; drafts waiting for an address pick it up.</p>" : "") : "") +
        '<ul class="lb-check">' + x.steps.map(function (st, i) {
          var late = !st.doneOn && st.dueOn && st.dueOn < t, msgs = msgFor(i);
          var draft = msgs.filter(function (m) { return m.status === "draft"; }).length, sent = msgs.filter(function (m) { return m.status === "sent" || m.status === "opened"; });
          var tags = [];
          if (st.auto && st.auto !== "sent") tags.push('<span class="lb-tag lb-auto" title="This step ticks itself">&#8635; Ticks itself ' + esc(AUTO_LABEL[st.auto] || "") + "</span>");
          if (st.message) tags.push(draft ? '<a href="#" class="lb-tag lb-msg is-wait" data-lb-tab="lb-outbox">&#9993; ' + (draft === 1 ? "Message" : draft + " messages") + " waiting for your approval</a>"
            : sent.length ? '<span class="lb-tag lb-msg is-sent">&#9993; Sent ' + esc(fmtDate(sent[sent.length - 1].sentAt)) + (sent.length > 1 ? " (" + sent.length + ")" : "") + (st.auto === "sent" ? "" : "; ticks when they respond") + "</span>"
            : '<span class="lb-tag lb-msg">&#9993; A message is drafted for your approval ' + (st.dueOn ? "near " + esc(fmtDate(st.dueOn)) : "when the step comes up") + "</span>");
          return '<li class="' + (st.doneOn ? "is-done" : "") + '"><label><input type="checkbox" data-lb-step="' + i + '" data-run="' + esc(x.id) + '"' + (st.doneOn ? " checked" : "") + "> <span>" + esc(st.text) + "</span></label>" +
            '<span class="fd-small fd-dim">' + (st.doneOn ? "done " + esc(fmtDate(st.doneOn)) + (st.by ? " by " + esc(st.by) : "") : st.dueOn ? "due " + esc(fmtDate(st.dueOn)) : "") + (late ? " " + pill("Overdue", "warn") : "") + "</span>" +
            (tags.length || st.action ? '<div class="lb-tags">' + tags.join("") + (st.action && !st.doneOn ? actionBtn(st.action, x) : "") + "</div>" : "") + "</li>";
        }).join("") + "</ul>" +
        '<form class="fd-form fd-inline" id="lb-addstep" data-id="' + esc(x.id) + '">' + input("addStep", "Add a step for this one only", "text", "", "required") + input("addStepDue", "Due", "date") + '<div><button type="submit" class="btn secondary">Add</button></div></form>' +
        '<form class="fd-form fd-inline" id="lb-owner" data-id="' + esc(x.id) + '">' + input("owner", "Owner", "text", x.owner) + '<div><button type="submit" class="btn secondary">Save</button></div></form>' +
        '<div class="fd-actions">' + (x.completedOn ? '<button type="button" class="btn secondary" data-lb-complete="0" data-id="' + esc(x.id) + '">Reopen</button>' : '<button type="button" class="btn secondary" data-lb-complete="1" data-id="' + esc(x.id) + '">Mark finished</button>') +
        ' <button type="button" class="btn danger" data-lb-del-run="' + esc(x.id) + '">Remove</button></div></div>' +
        '<details class="fw-card"><summary><strong>Activity</strong> <span class="fd-dim">(' + act.items.length + ")</span></summary>" + (act.items.length ? '<ul class="fd-list">' + act.items.map(function (a) { return '<li><span class="fd-small">' + esc(a.text) + '</span><span class="fd-small fd-dim">' + esc(fmtDate(a.at)) + "</span></li>"; }).join("") + "</ul>" : empty("Nothing yet.")) + "</details>";
    }).catch(function (e) { el.innerHTML = empty("Couldn't open: " + e.message); });
  }

  // ---------- Messages to approve ----------
  function outbox(el) {
    return api("/api/proc/outbox").then(function (r) {
      var drafts = r.items.filter(function (m) { return m.status === "draft"; }), done = r.items.filter(function (m) { return m.status !== "draft"; });
      var ext = r.mail && r.mail.external;
      setCount(drafts.length);
      L.drafts = {}; drafts.forEach(function (m) { L.drafts[m.id] = m; });
      el.innerHTML = (ext ? "" : '<p class="fd-small lb-note">' + pill("Sending from your own email", "gold") + " Approving opens the message in your email app with everything filled in, ready to send. Sending straight from the system switches on once your domain is verified with Resend.</p>") +
        (drafts.length ? drafts.map(function (m) {
          return '<form class="fw-card lb-draft" data-draft="' + esc(m.id) + '"><p class="fd-small fd-dim">' + esc(m.processName) + " &middot; " + esc(m.subjectLabel) + (m.stepText ? " &middot; " + esc(m.stepText) : "") + (m.kind === "reminder" ? " " + pill("Follow-up", "gold") : "") + "</p>" +
            '<div class="fd-form">' + input("toEmail", "To", "text", m.toEmail, 'placeholder="name@organization.org" required') + input("subject", "Subject", "text", m.subject, "required") +
            area("body", "Message", m.body, 'rows="16"') + "</div>" +
            '<div class="fd-actions">' + (ext ? '<button type="button" class="btn" data-lb-send="' + esc(m.id) + '">Approve and send</button> ' : "") +
            '<button type="button" class="btn' + (ext ? " secondary" : "") + '" data-lb-open="' + esc(m.id) + '">Approve and open in my email</button> <button type="button" class="btn secondary" data-lb-save="' + esc(m.id) + '">Save changes</button> <button type="button" class="btn danger" data-lb-discard="' + esc(m.id) + '">Don\'t send</button></div>' +
            (m.error ? '<p class="fd-small lb-note">' + pill("Last try failed", "warn") + " " + esc(m.error) + "</p>" : "") + "</form>";
        }).join("") : empty("Nothing waiting for your approval.")) +
        (done.length ? '<details class="fw-card"><summary><strong>Recently approved or set aside</strong> <span class="fd-dim">(' + done.length + ")</span></summary><ul class=\"fd-list\">" + done.map(function (m) {
          return "<li><span><strong>" + esc(m.subject) + '</strong><br><span class="fd-small fd-dim">' + esc(m.subjectLabel) + (m.toEmail ? " &middot; " + esc(m.toEmail) : "") + "</span></span><span>" +
            (m.status === "sent" ? pill("Sent " + fmtDate(m.sentAt), "good") : m.status === "opened" ? pill("Sent from your email " + fmtDate(m.sentAt), "good") : pill("Not sent")) + (m.approvedBy ? '<br><span class="fd-small fd-dim">approved by ' + esc(m.approvedBy) + "</span>" : "") + "</span></li>";
        }).join("") + "</ul></details>" : "");
    });
  }
  function setCount(n) { var c = document.getElementById("lb-outbox-count"); if (c) c.textContent = n ? "(" + n + ")" : ""; }
  function draftValues(id) {
    var f = document.querySelector('[data-draft="' + id + '"]');
    return f ? { toEmail: f.elements.toEmail.value.trim(), subject: f.elements.subject.value, body: f.elements.body.value } : {};
  }

  // ---------- What we deliver ----------
  function deliver(el, editId) {
    return api("/api/proc/materials").then(function (r) {
      var q = L.search.toLowerCase();
      var list = r.items.filter(function (m) { return !q || (m.title + " " + m.notes + " " + m.kind).toLowerCase().indexOf(q) >= 0; });
      var e = r.items.filter(function (m) { return m.id === editId; })[0] || { kind: "curriculum", audience: "client-safe", area: "consulting" };
      var priv = r.items.filter(function (m) { return isPrivate(m.link); }).length;
      function group(aud, title, sub) {
        var g = list.filter(function (m) { return m.audience === aud; });
        return '<div class="fw-card"><h3>' + title + '</h3><p class="fd-small fd-dim">' + sub + "</p>" + (g.length ? '<div class="table-wrap"><table class="prospect-table fd-table"><thead><tr><th>Material</th><th>Kind</th><th>Area</th><th></th></tr></thead><tbody>' + g.map(function (m) {
          return "<tr><td>" + (m.link ? '<a href="' + esc(m.link) + '" target="_blank" rel="noopener"><strong>' + esc(m.title) + "</strong></a>" : "<strong>" + esc(m.title) + "</strong>") + (isPrivate(m.link) ? " " + pill("Private link", "warn") : "") + (m.notes ? '<br><span class="fd-small fd-dim">' + esc(m.notes) + "</span>" : "") +
            "</td><td>" + esc(KIND[m.kind] || m.kind) + "</td><td>" + esc(AREA[m.area] || m.area) + '</td><td><button type="button" class="btn secondary fd-sm" data-lb-edit-mat="' + esc(m.id) + '">Edit</button> <button type="button" class="btn danger" data-lb-del-mat="' + esc(m.id) + '">Remove</button></td></tr>';
        }).join("") + "</tbody></table></div>" : empty("Nothing here yet.")) + "</div>";
      }
      el.innerHTML = '<div class="fd-toolbar"><label>Search <input type="search" id="lb-search" value="' + esc(L.search) + '" placeholder="Title, kind, notes"></label></div>' +
        (priv ? '<p class="fd-small lb-note">' + pill(priv + " private link" + (priv === 1 ? "" : "s"), "warn") + " These open only for you. Move the files to a shared Drive folder and paste the new links, so staff, board members, and clients can open them.</p>" : "") +
        group("client-safe", "Client-safe", "Fine to send to clients and funders.") + group("internal", "Internal", "For you and your team only.") +
        '<div class="fw-card" id="lb-mat-card"><h3>' + (e.id ? "Edit " + esc(e.title) : "Add material") + '</h3><form class="fd-form" id="lb-mat-form" data-id="' + esc(e.id || "") + '">' + input("title", "Title", "text", e.title, "required") +
        '<label>Kind<select name="kind">' + Object.keys(KIND).map(function (k) { return opt(k, KIND[k], e.kind); }).join("") + "</select></label>" +
        '<label>Who can see it<select name="audience">' + opt("client-safe", "Client-safe", e.audience) + opt("internal", "Internal only", e.audience) + "</select></label>" +
        '<label>Area<select name="area">' + Object.keys(AREA).map(function (k) { return opt(k, AREA[k], e.area); }).join("") + "</select></label>" +
        input("link", "Link", "url", e.link, 'placeholder="https://drive.google.com/..."') + input("notes", "Notes", "text", e.notes) +
        '<div class="fd-wide"><button type="submit" class="btn">' + (e.id ? "Save" : "Add") + "</button>" + (e.id ? ' <button type="button" class="btn secondary" data-lb-go="lb-deliver">Cancel</button>' : "") + "</div></form></div>";
    });
  }

  // ---------- events ----------
  function guard(b, p, after) { if (b) b.disabled = true; return p.then(after || function () {}).catch(function (e) { toast(e.message); }).then(function () { if (b) b.disabled = false; }); }
  function startFor(processId, name, btn) {
    var label = window.prompt("Start \"" + name + "\" for whom or what? (a client, grant, meeting, or month)", "");
    if (label === null) return;
    guard(btn, api("/api/proc/start", { method: "POST", body: { processId: processId, subjectKind: "other", subjectLabel: label || name } }), function (r) { runDetail(r.item.id); });
  }
  document.addEventListener("click", function (e) {
    var b;
    if ((b = e.target.closest('.rail-btn[data-view="process"]'))) { render(L.tab === "lb-process" || L.tab === "lb-run" ? "lb-work" : L.tab); return; }
    if ((b = e.target.closest("[data-lb-tab]"))) { render(b.getAttribute("data-lb-tab")); return; }
    if ((b = e.target.closest("[data-lb-go]"))) { e.preventDefault(); render(b.getAttribute("data-lb-go")); return; }
    if ((b = e.target.closest("[data-lb-proc]"))) { e.preventDefault(); processDetail(b.getAttribute("data-lb-proc")); return; }
    if ((b = e.target.closest("[data-lb-run]"))) { e.preventDefault(); runDetail(b.getAttribute("data-lb-run")); return; }
    if ((b = e.target.closest("[data-lb-start]"))) { startFor(b.getAttribute("data-lb-start"), b.getAttribute("data-name"), b); return; }
    if ((b = e.target.closest("[data-lb-start-sugg]"))) { var s = L.sugg[Number(b.getAttribute("data-lb-start-sugg"))]; guard(b, api("/api/proc/start", { method: "POST", body: s }), function (r) { runDetail(r.item.id); }); return; }
    if ((b = e.target.closest("[data-lb-skip]"))) { var k = L.sugg[Number(b.getAttribute("data-lb-skip"))]; guard(b, api("/api/proc/skip", { method: "POST", body: k }), function () { render("lb-work"); }); return; }
    if ((b = e.target.closest("[data-lb-reviewed]"))) { var pid = b.getAttribute("data-lb-reviewed"); guard(b, api("/api/proc/processes/" + pid, { method: "PATCH", body: { lastReviewed: today() } }), function () { processDetail(pid); }); return; }
    if ((b = e.target.closest("[data-lb-del-proc]"))) { if (window.confirm("Remove this process? Checklists already started stay.")) guard(b, api("/api/proc/processes/" + b.getAttribute("data-lb-del-proc"), { method: "DELETE" }), function () { render("lb-work"); }); return; }
    if ((b = e.target.closest("[data-lb-complete]"))) { var rid = b.getAttribute("data-id"); guard(b, api("/api/proc/runs/" + rid, { method: "PATCH", body: { complete: b.getAttribute("data-lb-complete") === "1" } }), function () { runDetail(rid); }); return; }
    if ((b = e.target.closest("[data-lb-del-run]"))) { if (window.confirm("Remove this checklist?")) guard(b, api("/api/proc/runs/" + b.getAttribute("data-lb-del-run"), { method: "DELETE" }), function () { render("lb-running"); }); return; }
    if ((b = e.target.closest("[data-lb-send]"))) { var sid = b.getAttribute("data-lb-send"); guard(b, api("/api/proc/outbox/" + sid + "/send", { method: "POST", body: draftValues(sid) }), function () { toast("Sent."); render("lb-outbox"); }); return; }
    if ((b = e.target.closest("[data-lb-open]"))) {
      var oid = b.getAttribute("data-lb-open"), v = draftValues(oid);
      if (/\[[^\]]*(link|paste|sentences)[^\]]*\]/i.test(v.body)) { toast("Fill in the bracketed placeholder first."); return; }
      guard(b, api("/api/proc/outbox/" + oid, { method: "PATCH", body: v }).then(function () {
        var a = document.createElement("a");
        a.href = "mailto:" + encodeURIComponent(v.toEmail).replace(/%40/g, "@").replace(/%2C/g, ",") + "?subject=" + encodeURIComponent(v.subject) + "&body=" + encodeURIComponent(v.body);
        document.body.appendChild(a); a.click(); a.remove();
        return api("/api/proc/outbox/" + oid + "/opened", { method: "POST", body: {} });
      }), function () { toast("Opened in your email. Press send there."); render("lb-outbox"); });
      return;
    }
    if ((b = e.target.closest("[data-lb-save]"))) { var vid = b.getAttribute("data-lb-save"); guard(b, api("/api/proc/outbox/" + vid, { method: "PATCH", body: draftValues(vid) }), function () { toast("Saved."); }); return; }
    if ((b = e.target.closest("[data-lb-discard]"))) { if (window.confirm("Don't send this message?")) guard(b, api("/api/proc/outbox/" + b.getAttribute("data-lb-discard") + "/discard", { method: "POST", body: {} }), function () { render("lb-outbox"); }); return; }
    if ((b = e.target.closest("[data-lb-act]"))) {
      var t = b.getAttribute("data-lb-act"), parts = t.split(":");
      if (parts[0] === "view") { var rb = document.querySelector('.rail-btn[data-view="' + parts[1] + '"]'); if (rb) rb.click(); }
      else if (parts[0] === "board") { var bb = document.querySelector('.rail-btn[data-view="board"]'); if (bb) bb.click(); setTimeout(function () { if (window.GV) window.GV.render(parts[1]); }, 40); }
      else if (parts[0] === "grant") { var gb = document.querySelector('.rail-btn[data-view="grants"]'); if (gb) gb.click(); setTimeout(function () { if (window.FD && window.FD.openGrant) window.FD.openGrant(decodeURIComponent(parts[1])); }, 60); }
      else if (parts[0] === "settings") { var st2 = document.getElementById("open-settings-btn"); if (st2) st2.click(); }
      return;
    }
    if ((b = e.target.closest("[data-lb-edit-mat]"))) { deliver(panel("lb-deliver"), b.getAttribute("data-lb-edit-mat")).then(function () { document.getElementById("lb-mat-card").scrollIntoView({ behavior: "smooth" }); }); return; }
    if ((b = e.target.closest("[data-lb-del-mat]"))) { if (window.confirm("Remove this material from the list?")) guard(b, api("/api/proc/materials/" + b.getAttribute("data-lb-del-mat"), { method: "DELETE" }), function () { render("lb-deliver"); }); return; }
  });
  document.addEventListener("change", function (e) {
    var t = e.target;
    if (t.hasAttribute && t.hasAttribute("data-lb-step")) {
      var rid = t.getAttribute("data-run");
      api("/api/proc/runs/" + rid, { method: "PATCH", body: { stepIndex: Number(t.getAttribute("data-lb-step")), done: t.checked } }).then(function () { runDetail(rid); }).catch(function (err) { toast(err.message); t.checked = !t.checked; });
    }
  });
  var st;
  document.addEventListener("input", function (e) {
    if (e.target.id !== "lb-search") return;
    clearTimeout(st); var v = e.target.value;
    st = setTimeout(function () { L.search = v; deliver(panel("lb-deliver")).then(function () { var s = document.getElementById("lb-search"); if (s) { s.focus(); s.setSelectionRange(v.length, v.length); } }); }, 250);
  });
  document.addEventListener("submit", function (e) {
    var f = e.target, id = f.id;
    if (["lb-proc-new", "lb-proc-edit", "lb-addstep", "lb-owner", "lb-mat-form", "lb-contact"].indexOf(id) < 0) return;
    e.preventDefault();
    var d = formData(f), rid = f.getAttribute("data-id"), btn = f.querySelector('button[type="submit"]'), msg = f.querySelector(".form-msg");
    function go(p, after) { if (btn) btn.disabled = true; p.then(after).catch(function (err) { if (msg) { msg.textContent = err.message; msg.className = "form-msg is-bad"; } else toast(err.message); }).then(function () { if (btn) btn.disabled = false; }); }
    if (id === "lb-proc-new") go(api("/api/proc/processes", { method: "POST", body: d }), function (r) { processDetail(r.item.id); });
    else if (id === "lb-proc-edit") go(api("/api/proc/processes/" + rid, { method: "PATCH", body: d }), function () { processDetail(rid); toast("Saved."); });
    else if (id === "lb-addstep") go(api("/api/proc/runs/" + rid, { method: "PATCH", body: d }), function () { runDetail(rid); });
    else if (id === "lb-owner") go(api("/api/proc/runs/" + rid, { method: "PATCH", body: { owner: d.owner } }), function () { toast("Saved."); });
    else if (id === "lb-contact") go(api("/api/proc/runs/" + rid, { method: "PATCH", body: { contactName: d.contactName, contactEmail: d.contactEmail } }), function () { toast("Saved."); runDetail(rid); });
    else if (id === "lb-mat-form") go(api(rid ? "/api/proc/materials/" + rid : "/api/proc/materials", { method: rid ? "PATCH" : "POST", body: d }), function () { render("lb-deliver"); });
  });
  window.LB = { render: render, run: runDetail, setCount: setCount };
  document.addEventListener("click", function (e) { if (e.target.closest('.rail-btn[data-view="process"]')) api("/api/proc/summary").then(function (s) { setCount(s.drafts); }).catch(function () {}); });
  var v = document.querySelector('.view[data-view="process"]');
  if (v && !v.hidden) render("lb-work");
})();
