/* AI assistance screens. Server side is ai-features.js (/api/ai/*).
   Everything AI writes for someone else lands in Messages to approve. */
(function () {
  "use strict";
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fmtDate(iso) { if (!/^\d{4}-\d{2}-\d{2}/.test(iso || "")) return ""; return new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  function api(url, opts) {
    opts = opts || {};
    if (opts.body && typeof opts.body !== "string") { opts.headers = { "Content-Type": "application/json" }; opts.body = JSON.stringify(opts.body); }
    return fetch(url, opts).then(function (res) {
      if (res.status === 401) { window.location.href = "/"; throw new Error("not signed in"); }
      return res.json().catch(function () { return {}; }).then(function (b) { if (!res.ok) throw new Error(b.error || ("request failed: " + res.status)); return b; });
    });
  }
  function pill(t, k) { return '<span class="pill' + (k ? " " + k : "") + '">' + esc(t) + "</span>"; }
  function toast(t) { var b = document.getElementById("fd-toast"); if (!b) { b = document.createElement("div"); b.id = "fd-toast"; b.className = "fd-toast"; b.setAttribute("role", "status"); document.body.appendChild(b); } b.textContent = t; b.hidden = false; clearTimeout(b._t); b._t = setTimeout(function () { b.hidden = true; }, 5000); }
  function lines(t) { return esc(t).replace(/\n/g, "<br>"); }
  function list(a) { return (a || []).filter(Boolean).length ? "<ul>" + a.filter(Boolean).map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : ""; }
  function busy(btn, text) { btn.disabled = true; btn._t = btn.textContent; btn.textContent = text || "Working..."; return function () { btn.disabled = false; btn.textContent = btn._t; }; }
  function board() { return document.body.classList.contains("role-board"); }
  var STATUS = null;
  function status() { return STATUS ? Promise.resolve(STATUS) : api("/api/ai/status").then(function (s) { STATUS = s; return s; }); }
  var AI_TAG = '<span class="pill ai-pill" title="Written with AI">AI</span>';

  /* ---------- 1. prospect rows ---------- */
  var FIT = { strong: "good", possible: "gold", unclear: "" };
  function briefHtml(p) {
    var b = p.aiBrief;
    var btn = board() ? "" : '<button type="button" class="btn secondary fd-sm aix-lead" data-id="' + esc(p.id) + '">' + (b ? "New draft reply" : "AI brief and reply") + "</button>";
    if (p.unsubscribedAt) return '<div class="ai-brief">' + pill("Unsubscribed " + fmtDate(p.unsubscribedAt)) + "</div>";
    if (!b) return '<div class="ai-brief ai-brief-empty">' + btn + "</div>";
    return '<details class="ai-brief"><summary>' + AI_TAG + " " + (b.fit ? pill("Fit: " + b.fit, FIT[b.fit]) + " " : "") + esc(b.who || "Brief") + "</summary>" +
      "<p>" + esc(b.read) + "</p>" + (b.likelyConstraint ? "<p><strong>Likely constraint (a guess to test):</strong> " + esc(b.likelyConstraint) + "</p>" : "") +
      (b.nextStep ? "<p><strong>Next:</strong> " + esc(b.nextStep) + "</p>" : "") + '<p class="fd-small fd-dim">A reply draft is in Messages to approve. ' + btn + "</p></details>";
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest(".aix-lead"); if (!b) return;
    var done = busy(b, "Reading the lead...");
    api("/api/ai/lead/" + b.getAttribute("data-id"), { method: "POST", body: {} }).then(function (r) {
      toast(r.outboxId ? "Brief written. The reply is waiting in Process Library > Messages to approve." : "Brief written. No email on file, so no reply was drafted.");
      if (window.LB && window.LB.setCount) window.LB.setCount();
      var rb = document.querySelector('.rail-btn[data-view="practice"]'); if (rb && !document.querySelector('.view[data-view="practice"]').hidden) rb.click();
    }).catch(function (err) { toast(err.message); }).then(done);
  });

  /* ---------- deal workspace (pre-call brief, call notes, Diagnostic first pass) ---------- */
  function showDeal() {
    document.querySelectorAll(".view").forEach(function (v) { v.hidden = v.getAttribute("data-view") !== "deal"; });
    document.querySelectorAll("#app-nav .rail-btn").forEach(function (b) { b.classList.toggle("is-active", b.getAttribute("data-view") === "practice"); });
    try { sessionStorage.setItem("fios_view", "practice"); } catch (e) {}
    window.scrollTo(0, 0);
  }
  var DEAL = null;
  function deal(id) {
    showDeal();
    var el = document.getElementById("deal-panel");
    el.innerHTML = '<p class="load-note">Loading...</p>';
    Promise.all([api("/api/ai/deal/" + encodeURIComponent(id)), status()]).then(function (r) {
      var d = r[0], s = r[1]; DEAL = d;
      var ro = board();
      var h = '<div class="fd-toolbar"><button type="button" class="btn secondary" data-go-view="practice">&larr; Pipeline &amp; Money</button></div>' +
        '<div class="view-head"><h2>' + esc(d.deal.org || d.deal.name) + '</h2><span class="tag">AI assistant</span></div>' +
        '<p class="view-intro">Next step: ' + esc(d.deal.nextStep || "none set") + (d.deal.nextStepDate ? " &middot; " + esc(fmtDate(d.deal.nextStepDate)) : "") + ". AI works only from what the system holds and the documents you add; you check and decide.</p>" +
        (s.ready ? "" : '<p class="fd-small lb-note">' + pill("AI isn't available", "warn") + " " + esc(!s.enabled ? "AI assistance is off in Settings > Areas." : s.keyRejected ? "The website server's Anthropic key was rejected; see Settings > AI assistance." : "The website server isn't answering or has no AI key.") + "</p>");
      // pre-call
      var pc = d.precall;
      h += '<div class="fw-card"><div class="fd-row"><h3 style="margin:0">Pre-call brief</h3>' + (ro ? "" : '<button type="button" class="btn secondary fd-sm" id="aix-precall">' + (pc ? "Refresh" : "Write the brief") + "</button>") + "</div>" +
        (pc ? '<p class="fd-small fd-dim">' + AI_TAG + " Written " + esc(fmtDate(pc.at)) + (pc.forDate ? " for " + esc(fmtDate(pc.forDate)) : "") + '</p><p class="ai-headline">' + esc(pc.headline) + "</p>" +
          (pc.numbers && pc.numbers.length ? "<h4 class=\"settings-h4\">The numbers</h4>" + list(pc.numbers) : "") +
          (pc.heard ? '<h4 class="settings-h4">What they\'ve told us</h4><p>' + esc(pc.heard) + "</p>" : "") +
          (pc.likelyConstraint ? '<h4 class="settings-h4">Likely constraint (a hypothesis)</h4><p>' + esc(pc.likelyConstraint) + "</p>" : "") +
          '<h4 class="settings-h4">Three questions</h4><ol>' + (pc.questions || []).map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ol>" +
          (pc.goal ? "<p><strong>A good outcome:</strong> " + esc(pc.goal) + "</p>" : "") + (pc.watchFor ? "<p><strong>Watch for:</strong> " + esc(pc.watchFor) + "</p>" : "")
          : '<p class="fd-small">Written automatically the day before a call (when the next step has a date), or any time with the button.</p>') + "</div>";
      // call notes
      if (!ro) h += '<div class="fw-card"><h3>After the call: notes to records</h3><p class="fd-small">Paste your notes or a transcript. AI proposes the stage, next step, a problem log entry, and a follow-up email. Nothing changes until you press Apply.</p>' +
        '<form id="aix-notes-form" class="fd-form"><label class="fd-wide">Call notes<textarea name="notes" rows="7" placeholder="What they said, what you noticed, what you agreed."></textarea></label><p class="fd-wide"><button type="submit" class="btn">Turn into records</button></p></form><div id="aix-notes-out"></div></div>';
      // diagnostic
      var dg = d.diagnostic;
      h += '<div class="fw-card"><h3>Diagnostic first pass</h3><p class="fd-small">Add the organization\'s documents (990s, budget, audit, strategic plan, board minutes, policies, org chart; PDF or text, up to about 25 MB together). AI pre-scores the seven areas with the evidence it used, proposes the binding constraint, and drafts the memo and 90-day plan for you to verify. Documents are read for this one request and not stored.</p>' +
        (ro ? "" : '<form id="aix-diag-form" class="fd-form"><label class="fd-wide">Documents<input type="file" name="files" multiple accept=".pdf,.txt,.md,.csv,application/pdf,text/plain"></label><label class="fd-wide">Anything AI should know (optional)<textarea name="context" rows="2"></textarea></label><p class="fd-wide"><button type="submit" class="btn">Run the first pass</button> <span class="fd-small fd-dim">Takes one to three minutes.</span></p></form>') +
        '<div id="aix-diag-out">' + (dg ? diagHtml(dg) : "") + "</div></div>";
      el.innerHTML = h;
    }).catch(function (err) { el.innerHTML = '<p class="empty-note">' + esc(err.message) + "</p>"; });
  }
  var AREA = { strategy: "Strategy and Positioning", program: "Program and Impact Evidence", revenue: "Revenue and Financial Health", leadership: "Leadership and Capacity", operations: "Operations and Infrastructure", partnerships: "Partnerships and Ecosystem", governance: "Governance and Risk" };
  function band(n) { return n >= 80 ? "good" : n >= 60 ? "" : n >= 40 ? "gold" : "warn"; }
  function diagHtml(dg) {
    var c = dg.constraint || {};
    return '<p class="fd-small fd-dim">' + AI_TAG + " First pass " + esc(fmtDate(dg.at)) + " from " + esc((dg.docs || []).join(", ")) + ". Verify before anything goes to the client.</p>" +
      '<div class="table-wrap"><table class="prospect-table fd-table"><thead><tr><th>Area</th><th>Score</th><th>Confidence</th><th>Evidence</th><th>Missing</th></tr></thead><tbody>' +
      (dg.areas || []).map(function (a) { return "<tr><td><strong>" + esc(AREA[a.key] || a.key) + "</strong></td><td>" + pill(Math.round(a.score), band(a.score)) + "</td><td>" + esc(a.confidence) + '</td><td class="fd-small">' + list(a.evidence) + '</td><td class="fd-small">' + esc(a.missing) + "</td></tr>"; }).join("") + "</tbody></table></div>" +
      '<h4 class="settings-h4">Proposed binding constraint: ' + esc(c.name || AREA[c.area] || "") + (c.confidence ? " (" + esc(c.confidence) + " confidence)" : "") + "</h4><p>" + esc(c.why) + "</p>" +
      '<div class="fd-grid"><div><strong>Evidence for</strong>' + list(c.evidenceFor) + "</div><div><strong>Evidence against</strong>" + list(c.evidenceAgainst) + "</div></div>" +
      '<h4 class="settings-h4">Draft constraint memo <button type="button" class="btn secondary fd-sm aix-copy" data-copy="memo">Copy</button></h4><div class="ai-doc" data-copy-src="memo">' + lines(dg.memo) + "</div>" +
      '<h4 class="settings-h4">Draft 90-Day Improvement Plan <button type="button" class="btn secondary fd-sm aix-copy" data-copy="plan">Copy</button></h4><div data-copy-src="plan"><ol>' + (dg.plan || []).map(function (p) { return "<li>" + esc(p.action) + ' <span class="fd-small fd-dim">(' + esc(p.owner) + ", week " + esc(p.week) + "; done when: " + esc(p.evidence) + ")</span></li>"; }).join("") + "</ol></div>" +
      '<h4 class="settings-h4">Questions to verify</h4>' + list(dg.questions);
  }
  function fileToB64(f) {
    return new Promise(function (ok, bad) { var r = new FileReader(); r.onload = function () { ok({ name: f.name, type: f.type || (/\.pdf$/i.test(f.name) ? "application/pdf" : "text/plain"), data: String(r.result).split(",")[1] || "" }); }; r.onerror = bad; r.readAsDataURL(f); });
  }
  document.addEventListener("click", function (e) {
    var b;
    if ((b = e.target.closest(".ai-deal-open"))) { e.preventDefault(); deal(b.getAttribute("data-deal")); return; }
    if ((b = e.target.closest("#aix-precall"))) {
      var done = busy(b, "Writing...");
      api("/api/ai/precall/" + DEAL.deal.id, { method: "POST", body: {} }).then(function () { deal(DEAL.deal.id); }).catch(function (err) { toast(err.message); done(); });
      return;
    }
    if ((b = e.target.closest(".aix-copy"))) {
      var src = document.querySelector('[data-copy-src="' + b.getAttribute("data-copy") + '"]');
      if (src && navigator.clipboard) navigator.clipboard.writeText(src.innerText).then(function () { b.textContent = "Copied"; setTimeout(function () { b.textContent = "Copy"; }, 1800); });
      return;
    }
    if ((b = e.target.closest("#aix-apply"))) {
      var f = document.getElementById("aix-prop"), prop = JSON.parse(f.getAttribute("data-prop"));
      ["stage", "nextStep", "nextStepDate", "summary"].forEach(function (k) { var i = f.querySelector('[name="' + k + '"]'); if (i) prop[k] = i.value; });
      prop.followUp = { subject: f.querySelector('[name="fuSubject"]').value, body: f.querySelector('[name="fuBody"]').value };
      prop.to = f.querySelector('[name="to"]').value;
      prop.sendFollowUp = f.querySelector('[name="sendFollowUp"]').checked;
      if (!f.querySelector('[name="logProblem"]').checked) prop.problem = {};
      var d2 = busy(b, "Applying...");
      api("/api/ai/call-notes/" + DEAL.deal.id + "/apply", { method: "POST", body: prop }).then(function (r) {
        toast("Deal updated" + (r.problemId ? ", problem logged" : "") + (r.outboxId ? ", follow-up waiting in Messages to approve" : "") + ".");
        if (window.LB && window.LB.setCount) window.LB.setCount();
        document.getElementById("aix-notes-out").innerHTML = '<p class="fd-small">' + pill("Applied", "good") + "</p>";
      }).catch(function (err) { toast(err.message); d2(); });
    }
  });
  var STAGES = { lead: "Lead", discovery: "Discovery call", assessment: "InstitutionalOS Diagnostic", engaged: "Engaged", graduated: "Graduated", referred: "Referred out", lost: "Lost, no fit" };
  document.addEventListener("submit", function (e) {
    var f = e.target;
    if (f.id === "aix-notes-form") {
      e.preventDefault();
      var btn = f.querySelector("button"), done = busy(btn, "Reading your notes...");
      api("/api/ai/call-notes/" + DEAL.deal.id, { method: "POST", body: { notes: f.notes.value } }).then(function (p) {
        var c = p.contact || {}, pr = p.problem || {};
        document.getElementById("aix-notes-out").innerHTML = '<form id="aix-prop" class="fd-form ai-proposal" data-prop="' + esc(JSON.stringify(p)) + '"><h4 class="settings-h4 fd-wide">' + AI_TAG + " Proposed changes (edit anything)</h4>" +
          '<label>Stage<select name="stage">' + Object.keys(STAGES).map(function (k) { return '<option value="' + k + '"' + (k === p.stage ? " selected" : "") + ">" + STAGES[k] + "</option>"; }).join("") + "</select></label>" +
          '<label>Next step<input name="nextStep" value="' + esc(p.nextStep) + '"></label><label>Next step date<input type="date" name="nextStepDate" value="' + esc(p.nextStepDate) + '"></label>' +
          '<label class="fd-wide">Added to the deal notes<textarea name="summary" rows="3">' + esc(p.summary) + "</textarea></label>" +
          '<label class="check-row fd-wide"><input type="checkbox" name="logProblem"' + (pr.presentingProblem ? " checked" : "") + "> Add to the problem log: presented “" + esc(pr.presentingProblem) + "”" + (pr.verifiedConstraint ? ", likely “" + esc(pr.verifiedConstraint) + "”" : "") + "</label>" +
          '<label class="check-row fd-wide"><input type="checkbox" name="sendFollowUp" checked> Put this follow-up in Messages to approve</label>' +
          '<label>To<input type="email" name="to" value="' + esc(c.email) + '" placeholder="their email"></label><label>Subject<input name="fuSubject" value="' + esc((p.followUp || {}).subject) + '"></label>' +
          '<label class="fd-wide">Follow-up<textarea name="fuBody" rows="7">' + esc((p.followUp || {}).body) + "</textarea></label>" +
          '<div class="fd-wide"><button type="button" class="btn" id="aix-apply">Apply</button></div></form>';
      }).catch(function (err) { toast(err.message); }).then(done);
    }
    if (f.id === "aix-diag-form") {
      e.preventDefault();
      var files = Array.prototype.slice.call(f.files.files || []);
      if (!files.length) { toast("Add at least one document."); return; }
      var total = files.reduce(function (n, x) { return n + x.size; }, 0);
      if (total > 25 * 1024 * 1024) { toast("Those files add up to more than 25 MB; run it on fewer at a time."); return; }
      var b2 = f.querySelector("button"), d3 = busy(b2, "Reading the documents...");
      Promise.all(files.map(fileToB64)).then(function (docs) {
        return api("/api/ai/diagnostic/" + DEAL.deal.id, { method: "POST", body: { files: docs, context: f.context.value } });
      }).then(function (dg) { document.getElementById("aix-diag-out").innerHTML = diagHtml(dg); toast("First pass ready."); }).catch(function (err) { toast(err.message); }).then(d3);
    }
  });

  /* ---------- 2. Field Notes ---------- */
  var TRIG = { expansion: "Expansion", funder: "Funder readiness", founder: "Founder dependence", strain: "Capacity strain", transition: "Leadership transition", checkup: "Check-up" };
  function fieldNotes() {
    var el = document.getElementById("fn-panel"); if (!el) return;
    el.innerHTML = '<p class="load-note">Loading...</p>';
    api("/api/ai/field-notes").then(function (r) {
      var ro = board();
      var h = '<div class="fw-card"><div class="fd-row"><span>' + pill(r.subscribers + " subscriber" + (r.subscribers === 1 ? "" : "s"), "good") + (r.unsubscribed ? " " + pill(r.unsubscribed + " unsubscribed") : "") +
        '</span><span>' + (ro ? "" : '<button type="button" class="btn" id="fn-draft">Write a draft with AI</button> <button type="button" class="btn secondary" id="fn-new">Write one myself</button>') + '</span></div><p class="fd-small fd-dim">Sign-ups come from the box on your website. Anyone who replies "unsubscribe" is taken off the list automatically.</p></div>';
      h += r.notes.length ? r.notes.map(function (n) {
        return '<div class="fw-card fn-card"><form class="fd-form fn-form" data-id="' + esc(n.id) + '"><div class="fd-row fd-wide">' + (n.status === "published" ? pill("Published " + fmtDate(n.publishedOn), "good") : pill("Draft", "gold")) + (n.source === "ai" ? " " + AI_TAG : "") + "</div>" +
          '<label class="fd-wide">Title<input name="title" value="' + esc(n.title) + '"' + (ro ? " disabled" : "") + "></label>" +
          [["signal", "The signal (what a leader notices)"], ["assumption", "What they usually assume"], ["constraint", "What it often turns out to be"], ["evidence", "What to check"], ["action", "A first 90-day action"]].map(function (x) {
            return '<label class="fd-wide">' + x[1] + '<textarea name="' + x[0] + '" rows="2"' + (ro ? " disabled" : "") + ">" + esc(n[x[0]]) + "</textarea></label>";
          }).join("") +
          '<label>Situation<select name="trigger"' + (ro ? " disabled" : "") + ">" + Object.keys(TRIG).map(function (k) { return '<option value="' + k + '"' + (n.trigger === k ? " selected" : "") + ">" + TRIG[k] + "</option>"; }).join("") + "</select></label>" +
          (ro ? "" : '<div class="fd-wide"><button type="submit" class="btn secondary">Save</button> ' + (n.status === "published" ? '<button type="button" class="btn" data-fn="email">Email to subscribers</button> <button type="button" class="btn secondary" data-fn="unpublish">Take off the website</button>' : '<button type="button" class="btn" data-fn="publish">Publish to the website</button>') +
            ' <button type="button" class="btn danger" data-fn="delete">Delete</button> <span class="form-msg" role="status"></span></div>') + "</form></div>";
      }).join("") : '<p class="empty-note">No field notes yet. The first AI draft is written automatically on the 3rd of each month, or write one now.</p>';
      el.innerHTML = h;
    }).catch(function (err) { el.innerHTML = '<p class="empty-note">' + esc(err.message) + "</p>"; });
  }
  document.addEventListener("click", function (e) {
    var b;
    if (e.target.closest('.rail-btn[data-view="fieldnotes"]')) { fieldNotes(); return; }
    if ((b = e.target.closest("#fn-draft"))) { var d = busy(b, "Writing a draft..."); api("/api/ai/field-notes/draft", { method: "POST", body: {} }).then(function () { toast("Draft ready. Edit it, then publish."); fieldNotes(); }).catch(function (err) { toast(err.message); d(); }); return; }
    if ((b = e.target.closest("#fn-new"))) { api("/api/ai/field-notes", { method: "POST", body: {} }).then(fieldNotes).catch(function (err) { toast(err.message); }); return; }
    if ((b = e.target.closest("[data-fn]"))) {
      var f = b.closest("form"), id = f.getAttribute("data-id"), act = b.getAttribute("data-fn"), msg = f.querySelector(".form-msg");
      if (act === "delete" && !window.confirm("Delete this field note? If it's on the website, it comes off.")) return;
      var save = act === "delete" ? Promise.resolve() : api("/api/ai/field-notes/" + id, { method: "PATCH", body: formData(f) });
      var dn = busy(b);
      save.then(function () {
        if (act === "delete") return api("/api/ai/field-notes/" + id, { method: "DELETE" });
        return api("/api/ai/field-notes/" + id + "/" + act, { method: "POST", body: {} });
      }).then(function (r) {
        if (act === "publish") toast(r.site && r.site.pushed ? "Published. It's on the Insights page now." : "Published here, but the website didn't take it yet (" + ((r.site || {}).reason || "unreachable") + "); it'll go with the next change.");
        else if (act === "email") toast("The email to " + r.recipients + " subscriber" + (r.recipients === 1 ? " is" : "s is") + " waiting in Process Library > Messages to approve.");
        else if (act === "unpublish") toast("Taken off the website.");
        if (window.LB && window.LB.setCount) window.LB.setCount();
        fieldNotes();
      }).catch(function (err) { if (msg) msg.textContent = err.message; dn(); });
    }
  });
  function formData(f) { var o = {}; Array.prototype.forEach.call(f.elements, function (el) { if (el.name && !el.disabled) o[el.name] = el.value; }); return o; }
  document.addEventListener("submit", function (e) {
    if (!e.target.classList || !e.target.classList.contains("fn-form")) return;
    e.preventDefault();
    var f = e.target, msg = f.querySelector(".form-msg");
    api("/api/ai/field-notes/" + f.getAttribute("data-id"), { method: "PATCH", body: formData(f) }).then(function () { msg.textContent = "Saved."; }).catch(function (err) { msg.textContent = err.message; });
  });

  /* ---------- 7. foundation: grant first read, report summaries, minutes ---------- */
  var LEAN = { advance: "good", discuss: "gold", decline: "warn" };
  function grantBox(el) {
    var id = el.getAttribute("data-ai-grant"); el.setAttribute("data-done", "1");
    api("/api/ai/grant-read/" + id).then(function (r) {
      var g = r.read, ro = board();
      var h = '<div class="fw-card ai-card"><div class="fd-row"><h3 style="margin:0">AI first read</h3>' + (ro ? "" : '<button type="button" class="btn secondary fd-sm" data-ai-grant-run="' + esc(id) + '">' + (g ? "Read again" : "Read this application") + "</button>") + "</div>";
      if (g) {
        h += '<p class="fd-small fd-dim">' + AI_TAG + " " + esc(fmtDate(g.at)) + ". A starting point for reviewers, not a review: scores and the decision stay with people.</p><p>" + esc(g.summary) + "</p>" +
          (g.criteria && g.criteria.length ? '<div class="table-wrap"><table class="prospect-table fd-table"><thead><tr><th>Criterion</th><th>Reads as</th><th>Why</th></tr></thead><tbody>' + g.criteria.map(function (c) { return "<tr><td>" + esc(c.criterion) + "</td><td>" + pill(c.rating, c.rating === "strong" ? "good" : c.rating === "partial" ? "gold" : "warn") + '</td><td class="fd-small">' + esc(c.assessment) + "</td></tr>"; }).join("") + "</tbody></table></div>" : "") +
          '<div class="fd-grid"><div><strong>Strengths</strong>' + list(g.strengths) + "</div><div><strong>Concerns</strong>" + list(g.concerns) + "</div></div><strong>Questions for the applicant</strong>" + list(g.questions) +
          (g.lean ? "<p>" + pill("Leans: " + g.lean, LEAN[g.lean]) + " " + esc(g.leanReason) + "</p>" : "");
      } else h += '<p class="fd-small">AI reads the application against this program\'s criteria and the applicant\'s public filings, and lists strengths, concerns, and questions. Reviewers still score.</p>';
      (r.reports || []).forEach(function (rp) {
        var s = rp.summary || {};
        h += '<h4 class="settings-h4">' + AI_TAG + " " + esc(rp.kind === "final" ? "Final" : "Interim") + " report summary</h4><p>" + esc(s.summary) + "</p>" + (s.outcomes && s.outcomes.length ? "<strong>Outcomes</strong>" + list(s.outcomes) : "") + (s.risks && s.risks.length ? "<strong>Watch</strong>" + list(s.risks) : "") + (s.followUp ? "<p><strong>Suggested follow-up:</strong> " + esc(s.followUp) + "</p>" : "");
      });
      el.innerHTML = h + "</div>";
    }).catch(function () { el.innerHTML = ""; });
  }
  function minutesBox(el) {
    el.setAttribute("data-done", "1");
    if (board()) return;
    el.innerHTML = '<details class="ai-minutes"><summary>' + AI_TAG + ' Draft the minutes from my notes</summary><p class="fd-small">Paste your notes. AI writes the minutes in standard form using the agenda, attendance, conflicts, and motions already recorded, and marks anything it can\'t confirm as [confirm]. It fills the box below; nothing is saved until you press Save minutes.</p>' +
      '<textarea class="ai-min-notes" rows="6" placeholder="Your notes from the meeting"></textarea><p><button type="button" class="btn secondary" data-ai-minutes-run="' + esc(el.getAttribute("data-ai-minutes")) + '">Draft the minutes</button></p></details>';
  }
  document.addEventListener("click", function (e) {
    var b;
    if ((b = e.target.closest("[data-ai-grant-run]"))) {
      var d = busy(b, "Reading...");
      api("/api/ai/grant-read/" + b.getAttribute("data-ai-grant-run"), { method: "POST", body: {} }).then(function () { var box = b.closest("[data-ai-grant]"); grantBox(box); }).catch(function (err) { toast(err.message); d(); });
      return;
    }
    if ((b = e.target.closest("[data-ai-minutes-run]"))) {
      var notes = b.closest("details").querySelector(".ai-min-notes").value;
      if (notes.trim().length < 20) { toast("Paste your notes first."); return; }
      var d2 = busy(b, "Drafting...");
      api("/api/ai/minutes/" + b.getAttribute("data-ai-minutes-run"), { method: "POST", body: { notes: notes } }).then(function (r) {
        var ta = document.querySelector('#gv-minutes-form textarea[name="minutes"]');
        if (ta) { if (ta.value.trim() && !window.confirm("Replace what's in the minutes box with the draft?")) return; ta.value = r.minutes; ta.focus(); }
        toast("Draft is in the minutes box. Check the [confirm] spots, then Save minutes.");
      }).catch(function (err) { toast(err.message); }).then(d2);
    }
  });
  new MutationObserver(function () {
    document.querySelectorAll("[data-ai-grant]:not([data-done])").forEach(function (el) { status().then(function (s) { if (s.enabled) grantBox(el); else el.setAttribute("data-done", "1"); }); });
    document.querySelectorAll("[data-ai-minutes]:not([data-done])").forEach(function (el) { status().then(function (s) { if (s.enabled) minutesBox(el); else el.setAttribute("data-done", "1"); }); });
  }).observe(document.body, { childList: true, subtree: true });

  /* ---------- 8. Ask the system ---------- */
  document.addEventListener("submit", function (e) {
    if (e.target.id !== "ai-ask-form") return;
    e.preventDefault();
    var q = document.getElementById("ai-ask-q").value.trim(), out = document.getElementById("ai-ask-answer"), btn = e.target.querySelector("button");
    if (q.length < 4) return;
    var d = busy(btn, "Thinking..."); out.hidden = false; out.innerHTML = '<p class="load-note">Looking through the system...</p>';
    api("/api/ai/ask", { method: "POST", body: { question: q } }).then(function (r) { out.innerHTML = '<p class="fd-small fd-dim">' + AI_TAG + " From the system's data just now</p><div>" + lines(r.answer) + "</div>"; })
      .catch(function (err) { out.innerHTML = '<p class="fd-small">' + esc(err.message) + "</p>"; }).then(d);
  });

  /* ---------- Settings card ---------- */
  function settingsCard() {
    var body = document.getElementById("ai-body"); if (!body) return;
    STATUS = null;
    status().then(function (s) {
      body.innerHTML = '<p class="fd-small">' + (s.ready ? pill("Ready", "good") + " Working through your website server" + (s.relay && s.relay.model ? " (" + esc(s.relay.model) + ")" : "") + "."
        : !s.enabled ? pill("Off") + " Turn on “AI assistance” under Areas."
        : s.keyRejected ? pill("Key rejected", "warn") + " Anthropic turned down the website server's key. Create a new key at console.anthropic.com and put it in ANTHROPIC_API_KEY on the frankly-inspired-api service in Render. It starts working on the next request."
        : pill("Not reachable", "warn") + " The website server " + (s.relay ? "has no AI key (ANTHROPIC_API_KEY on its Render service)." : "didn't answer; it may be waking up. Try again in a minute.")) + "</p>" +
        '<p class="fd-small">Used today: ' + s.usage.today + " of " + s.usage.limit + " requests (the limit resets daily).</p>" +
        '<p class="fd-small fd-dim">What it does: briefs and first replies for new website leads; pre-call briefs; call notes into records; Diagnostic first passes from documents; reading replies; a monthly field note draft; grant first reads, report summaries, and minutes drafts; and Ask the system on Today. Every message it writes waits in Messages to approve. Client documents are sent to the AI service (Anthropic) for that one request and not kept.</p>';
    }).catch(function (err) { body.innerHTML = '<p class="fd-small">' + esc(err.message) + "</p>"; });
  }
  document.addEventListener("click", function (e) { if (e.target.closest("#open-settings-btn")) setTimeout(settingsCard, 40); });

  // Startup: show Ask on Today when AI is on.
  status().then(function (s) { var c = document.getElementById("ai-ask-card"); if (c && s.enabled) c.hidden = false; }).catch(function () {});
  if (document.querySelector('.view[data-view="fieldnotes"]') && !document.querySelector('.view[data-view="fieldnotes"]').hidden) fieldNotes();
  var sv = document.querySelector('.view[data-view="settings"]'); if (sv && !sv.hidden) settingsCard();

  /* ---------- meeting notes (summaries emailed by note-takers) ---------- */
  var MEET = null;
  function propForm(p, mid) {
    var c = p.contact || {}, pr = p.problem || {};
    return '<form class="fd-form ai-proposal mt-prop" data-mid="' + esc(mid) + '" data-prop="' + esc(JSON.stringify(p)) + '"><h4 class="settings-h4 fd-wide">' + AI_TAG + " Proposed changes (edit anything)</h4>" +
      '<label>Stage<select name="stage">' + Object.keys(STAGES).map(function (k) { return '<option value="' + k + '"' + (k === p.stage ? " selected" : "") + ">" + STAGES[k] + "</option>"; }).join("") + "</select></label>" +
      '<label>Next step<input name="nextStep" value="' + esc(p.nextStep) + '"></label><label>Next step date<input type="date" name="nextStepDate" value="' + esc(p.nextStepDate) + '"></label>' +
      '<label class="fd-wide">Added to the deal notes<textarea name="summary" rows="3">' + esc(p.summary) + "</textarea></label>" +
      '<label class="check-row fd-wide"><input type="checkbox" name="logProblem"' + (pr.presentingProblem ? " checked" : "") + "> Add to the problem log: presented “" + esc(pr.presentingProblem) + "”" + (pr.verifiedConstraint ? ", likely “" + esc(pr.verifiedConstraint) + "”" : "") + "</label>" +
      '<label class="check-row fd-wide"><input type="checkbox" name="sendFollowUp" checked> Put this follow-up in Messages to approve</label>' +
      '<label>To<input type="email" name="to" value="' + esc(c.email) + '" placeholder="their email"></label><label>Subject<input name="fuSubject" value="' + esc((p.followUp || {}).subject) + '"></label>' +
      '<label class="fd-wide">Follow-up<textarea name="fuBody" rows="6">' + esc((p.followUp || {}).body) + "</textarea></label>" +
      '<div class="fd-wide"><button type="button" class="btn mt-apply">Apply to the deal</button></div></form>';
  }
  function meetings() {
    showDeal();
    var el = document.getElementById("deal-panel");
    el.innerHTML = '<p class="load-note">Loading...</p>';
    Promise.all([api("/api/meetings"), status()]).then(function (r) {
      var d = r[0], s = r[1]; MEET = d;
      var ro = board();
      var open = d.items.filter(function (m) { return ["ready", "matched", "unmatched"].indexOf(m.status) >= 0; });
      var done = d.items.filter(function (m) { return open.indexOf(m) < 0; });
      var dealOpts = '<option value="">Choose the deal</option>' + d.deals.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.label) + "</option>"; }).join("");
      var h = '<div class="fd-toolbar"><button type="button" class="btn secondary" data-go-view="practice">&larr; Pipeline &amp; Money</button>' + (ro ? "" : ' <button type="button" class="btn secondary" id="mt-check">Check email now</button>') + "</div>" +
        '<div class="view-head"><h2>Meeting notes</h2><span class="tag">from your note-taker</span></div>' +
        '<p class="view-intro">When Google Meet, Zoom, Fathom, Otter, Fireflies, or Read.ai emails you a meeting summary, it shows up here, matched to the deal by who attended. AI turns it into a deal update, a problem log entry, and a follow-up draft. Nothing changes until you press Apply. Summaries with "coaching", "confidential", or "private" in the title are skipped and never stored. Ask everyone on the call before you record it.</p>' +
        (d.gmail ? "" : '<p class="fd-small lb-note">' + pill("Gmail isn't connected", "warn") + " Connect it in Settings &gt; Connected email so summaries can be picked up.</p>") +
        (s.ready ? "" : '<p class="fd-small lb-note">' + pill("AI isn't available", "warn") + " Summaries are still collected and matched; the proposal is written once AI is working.</p>");
      h += open.length ? open.map(function (m) {
        var head = '<div class="fd-row"><h3 style="margin:0">' + esc(m.subject || "Meeting") + '</h3><span class="fd-small fd-dim">' + esc(m.source) + " &middot; " + esc(fmtDate(m.receivedAt)) + "</span></div>";
        var match = m.dealId ? '<p class="fd-small">Deal: <strong>' + esc(m.dealLabel) + "</strong> " + (m.matchHow ? '<span class="fd-dim">(matched by ' + esc(m.matchHow) + ")</span>" : "") + "</p>" : "";
        var body = "";
        if (!ro) {
          if (!m.dealId || m.status === "unmatched") body += '<div class="fd-form"><label>Which deal is this?<select class="mt-deal" data-mid="' + esc(m.id) + '">' + dealOpts + '</select></label><p class="fd-wide"><button type="button" class="btn mt-match" data-mid="' + esc(m.id) + '">Match</button></p></div>';
          else if (m.proposal) body += propForm(m.proposal, m.id);
          else body += '<p><button type="button" class="btn mt-propose" data-mid="' + esc(m.id) + '">Write the proposal</button>' + (m.error ? ' <span class="fd-small fd-dim">' + esc(m.error) + "</span>" : "") + "</p>";
        }
        return '<div class="fw-card">' + head + match + body +
          '<details class="fd-small"><summary>The summary as emailed</summary><div class="ai-doc">' + lines(m.preview) + "</div></details>" +
          (ro ? "" : '<p class="fd-small"><button type="button" class="btn secondary fd-sm mt-dismiss" data-mid="' + esc(m.id) + '">Dismiss (not a client meeting)</button></p>') + "</div>";
      }).join("") : '<div class="fw-card"><p class="empty-note" style="border:none">No meeting summaries waiting.</p></div>';
      if (done.length) h += '<div class="fw-card"><h3>Last 30 days</h3><ul class="action-list">' + done.map(function (m) {
        return "<li><span>" + esc(m.subject || "Meeting") + ' <span class="fd-dim fd-small">' + esc(m.source) + " &middot; " + esc(fmtDate(m.receivedAt)) + "</span></span><span>" + (m.status === "applied" ? pill("Applied to " + (m.dealLabel || "deal"), "good") : pill("Skipped: private")) + "</span></li>";
      }).join("") + "</ul></div>";
      el.innerHTML = h;
    }).catch(function (err) { el.innerHTML = '<p class="empty-note">' + esc(err.message) + "</p>"; });
  }
  document.addEventListener("click", function (e) {
    var b;
    if ((b = e.target.closest("#mt-check"))) { var d0 = busy(b, "Checking..."); api("/api/meetings/check", { method: "POST", body: {} }).then(function (r) { toast(r.added ? r.added + " new summar" + (r.added === 1 ? "y" : "ies") + " found." : "No new summaries."); meetings(); }).catch(function (err) { toast(err.message); d0(); }); return; }
    if ((b = e.target.closest(".mt-match"))) {
      var mid = b.getAttribute("data-mid"), sel = document.querySelector('.mt-deal[data-mid="' + mid + '"]');
      if (!sel || !sel.value) { toast("Choose the deal first."); return; }
      var d1 = busy(b, "Matching..."); api("/api/meetings/" + mid + "/match", { method: "POST", body: { dealId: sel.value } }).then(meetings).catch(function (err) { toast(err.message); d1(); }); return;
    }
    if ((b = e.target.closest(".mt-propose"))) { var d2 = busy(b, "Reading the summary..."); api("/api/meetings/" + b.getAttribute("data-mid") + "/propose", { method: "POST", body: {} }).then(meetings).catch(function (err) { toast(err.message); d2(); }); return; }
    if ((b = e.target.closest(".mt-dismiss"))) { api("/api/meetings/" + b.getAttribute("data-mid") + "/dismiss", { method: "POST", body: {} }).then(meetings).catch(function (err) { toast(err.message); }); return; }
    if ((b = e.target.closest(".mt-apply"))) {
      var f = b.closest(".mt-prop"), prop = JSON.parse(f.getAttribute("data-prop"));
      ["stage", "nextStep", "nextStepDate", "summary"].forEach(function (k) { var i = f.querySelector('[name="' + k + '"]'); if (i) prop[k] = i.value; });
      prop.followUp = { subject: f.querySelector('[name="fuSubject"]').value, body: f.querySelector('[name="fuBody"]').value };
      prop.to = f.querySelector('[name="to"]').value;
      prop.sendFollowUp = f.querySelector('[name="sendFollowUp"]').checked;
      if (!f.querySelector('[name="logProblem"]').checked) prop.problem = {};
      var d3 = busy(b, "Applying...");
      api("/api/meetings/" + f.getAttribute("data-mid") + "/apply", { method: "POST", body: prop }).then(function (r) {
        toast("Deal updated" + (r.problemId ? ", problem logged" : "") + (r.outboxId ? ", follow-up waiting in Messages to approve" : "") + ".");
        if (window.LB && window.LB.setCount) window.LB.setCount();
        meetings();
      }).catch(function (err) { toast(err.message); d3(); });
    }
  });

  window.AIX = { briefHtml: briefHtml, deal: deal, fieldNotes: fieldNotes, meetings: meetings };
})();
