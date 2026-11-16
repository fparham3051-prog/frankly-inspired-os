/* Board & Governance view. Server side is governance.js (/api/gov/*).
   Board accounts see everything read-only; forms and row buttons are hidden
   for them by the role-board styles. */
(function () {
  "use strict";
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function today() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function fmtDate(iso) { if (!/^\d{4}-\d{2}-\d{2}/.test(iso || "")) return ""; return new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  function fmtWhen(local) {
    if (!local) return "";
    var parts = String(local).split("T"), out = fmtDate(parts[0]);
    if (parts[1] && /^\d{2}:\d{2}/.test(parts[1])) { var h = Number(parts[1].slice(0, 2)), m = parts[1].slice(3, 5); out += ", " + (((h + 11) % 12) + 1) + ":" + m + (h < 12 ? " a.m." : " p.m."); }
    return out;
  }
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
  function kpi(l, v, s) { return '<div class="fd-kpi"><span class="fd-kpi-v">' + v + '</span><span class="fd-kpi-l">' + esc(l) + "</span>" + (s ? '<span class="fd-kpi-s">' + s + "</span>" : "") + "</div>"; }
  function bar(a, b) { var p = b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0; return '<div class="fd-bar" role="img" aria-label="' + p + ' percent"><span style="width:' + p + '%"></span></div>'; }
  function toast(t) {
    var b = document.getElementById("fd-toast");
    if (!b) { b = document.createElement("div"); b.id = "fd-toast"; b.className = "fd-toast"; b.setAttribute("role", "status"); document.body.appendChild(b); }
    b.textContent = t; b.hidden = false; clearTimeout(b._t); b._t = setTimeout(function () { b.hidden = true; }, 5000);
  }
  function addMonths(iso, n) { var d = new Date(iso + "T12:00:00"); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 10); }

  var ROLE = { chair: "Chair", "vice-chair": "Vice chair", treasurer: "Treasurer", secretary: "Secretary", member: "Member", staff: "Staff (non-voting)" };
  var KIND = { regular: "Board meeting", annual: "Annual meeting", special: "Special meeting", committee: "Committee meeting" };
  var S = { tab: "gv-overview", year: new Date().getFullYear(), fy: "" };
  function panel(k) { return document.querySelector('[data-gv-panel="' + k + '"]'); }
  function show(k) {
    document.querySelectorAll("[data-gv-panel]").forEach(function (p) { p.hidden = p.getAttribute("data-gv-panel") !== k; });
    document.querySelectorAll("[data-gv-tab]").forEach(function (b) { var on = b.getAttribute("data-gv-tab") === k; b.classList.toggle("is-active", on); b.setAttribute("aria-selected", on ? "true" : "false"); });
  }
  function render(tab) {
    tab = tab || S.tab; if (tab === "gv-meeting") tab = "gv-meetings";
    S.tab = tab; show(tab);
    var el = panel(tab); el.innerHTML = '<p class="load-note">Loading...</p>';
    var y = document.getElementById("gv-year"); if (y) y.textContent = String(new Date().getFullYear());
    var fn = { "gv-overview": overview, "gv-meetings": meetings, "gv-members": members, "gv-coi": coi, "gv-990": checklist, "gv-policies": policies }[tab];
    fn(el).catch(function (e) { el.innerHTML = empty("Couldn't load: " + e.message); });
  }

  // ---------- Overview ----------
  function overview(el) {
    return api("/api/gov/summary").then(function (s) {
      if (!s.members && !s.nextMeeting && !s.policies && !s.checklist.length) {
        el.innerHTML = '<div class="fw-card fd-start"><h3>Set up the board</h3><p>Three steps: add the board members, put the year\'s meetings on the calendar, and add the policies the Form 990 asks about. Then send this year\'s conflict-of-interest statements.</p>' +
          '<div class="fd-actions"><button type="button" class="btn" data-gv-go="gv-members">Add board members</button> <button type="button" class="btn secondary" data-gv-go="gv-meetings">Plan meetings</button> <button type="button" class="btn secondary" data-gv-go="gv-policies">Policies</button></div></div>';
        return;
      }
      var cy = s.checklist[0];
      var html = '<div class="fd-kpis">' +
        kpi("Next meeting", s.nextMeeting ? esc(fmtDate(s.nextMeeting.startsAt)) : "&ndash;", s.nextMeeting ? esc(s.nextMeeting.title) + " &middot; quorum " + s.nextMeeting.quorumNeeded : "none scheduled") +
        kpi("Board members", String(s.members), s.voting + " voting") +
        kpi("Conflict statements " + s.coi.year, s.coi.signed + " of " + s.coi.total, s.coi.total && s.coi.signed === s.coi.total ? "all signed" : (s.coi.started ? "waiting on " + (s.coi.total - s.coi.signed) : "not sent yet")) +
        kpi("Meetings held this year", String(s.meetingsThisYear)) +
        kpi("Form 990" + (cy ? " " + esc(cy.fiscalYear) : ""), cy ? (cy.filed ? "Filed" : cy.done + " of " + cy.total) : "&ndash;", cy && cy.dueOn && !cy.filed ? "due " + esc(fmtDate(cy.dueOn)) : (cy ? "" : "checklist not started")) + "</div>";
      html += '<div class="fd-grid">';
      var todo = [];
      s.minutesMissing.forEach(function (m) { todo.push('<li><a href="#" data-gv-meeting="' + esc(m.id) + '">' + esc(m.title) + ", " + esc(fmtDate(m.startsAt)) + "</a><span>" + pill("Minutes not written", "warn") + "</span></li>"); });
      s.minutesToApprove.forEach(function (m) { todo.push('<li><a href="#" data-gv-meeting="' + esc(m.id) + '">' + esc(m.title) + ", " + esc(fmtDate(m.startsAt)) + "</a><span>" + pill("Minutes to approve", "gold") + "</span></li>"); });
      if (s.coi.unsigned.length) todo.push('<li><a href="#" data-gv-go="gv-coi">' + (s.coi.unsigned.length === s.coi.total ? "No one has" : s.coi.unsigned.length + " member" + (s.coi.unsigned.length === 1 ? " hasn't" : "s haven't")) + " signed the " + s.coi.year + " conflict statement</a><span class=\"fd-small fd-dim\">" + esc(s.coi.unsigned.slice(0, 4).map(function (m) { return m.name.split(" ")[0]; }).join(", ")) + (s.coi.unsigned.length > 4 ? "..." : "") + "</span></li>");
      var notAdopted = s.policiesToReview.filter(function (p) { return !p.adopted; }), dueReview = s.policiesToReview.filter(function (p) { return p.adopted; });
      if (notAdopted.length) todo.push('<li><a href="#" data-gv-go="gv-policies">' + notAdopted.length + " polic" + (notAdopted.length === 1 ? "y" : "ies") + " not adopted yet</a><span>" + pill("Board vote needed", "warn") + "</span></li>");
      dueReview.forEach(function (p) { todo.push("<li><span>" + esc(p.name) + " policy</span><span>" + pill("Review due " + fmtDate(p.nextReview), "gold") + "</span></li>"); });
      s.termsEnding.forEach(function (m) { todo.push("<li><span>" + esc(m.name) + "</span><span>" + pill("Term ends " + fmtDate(m.termEnd), "gold") + "</span></li>"); });
      html += '<div class="fw-card"><h3>Needs attention</h3>' + (todo.length ? '<ul class="fd-list">' + todo.join("") + "</ul>" : empty("Nothing outstanding.")) + "</div>";
      html += '<div class="fw-card"><h3>Form 990</h3>' + (s.checklist.length ? s.checklist.map(function (c) {
        return '<div class="fd-prog"><div class="fd-row"><strong>Year ' + esc(c.fiscalYear) + "</strong>" + (c.filed ? " " + pill("Filed", "good") : "") + '<span class="fd-dim">' + c.done + " of " + c.total + " done" + (c.dueOn ? " &middot; due " + esc(fmtDate(c.dueOn)) : "") + "</span></div>" + bar(c.done, c.total) +
          (c.next.length ? '<ul class="fd-list">' + c.next.map(function (n) { return "<li><span class=\"fd-small\">" + esc(n.label) + '</span><span class="fd-small">' + esc(fmtDate(n.dueOn)) + (n.overdue ? " " + pill("Overdue", "warn") : "") + "</span></li>"; }).join("") + "</ul>" : "") + "</div>";
      }).join("") : empty("No checklist yet. Start one on the Form 990 tab.")) + "</div>";
      html += "</div>";
      el.innerHTML = html;
    });
  }

  // ---------- Meetings ----------
  function meetings(el) {
    return api("/api/gov/meetings").then(function (d) {
      var t = today();
      var up = d.items.filter(function (m) { return (m.startsAt || "").slice(0, 10) >= t; }).reverse();
      var past = d.items.filter(function (m) { return (m.startsAt || "").slice(0, 10) < t; });
      function rows(list) {
        return list.map(function (m) {
          var minutes = m.status === "cancelled" ? pill("Cancelled") : m.minutesApprovedOn ? pill("Approved " + fmtDate(m.minutesApprovedOn), "good") : m.minutes ? pill("Draft", "gold") : ((m.startsAt || "") < t ? pill("Not written", "warn") : "");
          return '<tr><td><a href="#" data-gv-meeting="' + esc(m.id) + '"><strong>' + esc(m.title) + "</strong></a><br><span class=\"fd-dim fd-small\">" + esc(KIND[m.kind] || m.kind) + "</span></td><td>" + esc(fmtWhen(m.startsAt)) + '</td><td class="fd-small">' + esc(m.location) + "</td><td>" +
            (m.status === "held" ? m.quorum.present + " of " + m.quorum.voting + (m.quorum.met ? "" : " " + pill("No quorum", "warn")) : "") + "</td><td>" + minutes + "</td></tr>";
        }).join("");
      }
      var head = "<thead><tr><th>Meeting</th><th>When</th><th>Where</th><th>Present</th><th>Minutes</th></tr></thead>";
      el.innerHTML = '<div class="fw-card"><div class="fd-row"><h3 style="margin:0">Coming up</h3><span class="fd-push"><a class="btn secondary fd-sm" href="/api/gov/calendar.ics">Add all to your calendar</a></span></div>' +
        (up.length ? '<div class="table-wrap"><table class="prospect-table fd-table">' + head + "<tbody>" + rows(up) + "</tbody></table></div>" : empty("No meetings scheduled.")) + "</div>" +
        '<div class="fw-card"><h3>Past meetings</h3>' + (past.length ? '<div class="table-wrap"><table class="prospect-table fd-table">' + head + "<tbody>" + rows(past) + "</tbody></table></div>" : empty("None yet.")) + "</div>" +
        '<div class="fd-grid"><div class="fw-card"><h3>Plan the year</h3><p class="fd-small">Adds regular board meetings at the same time and place. Days that already have a meeting are skipped.</p><form class="fd-form" id="gv-plan-form">' +
        input("firstDate", "First meeting", "date", "", "required") + input("time", "Time", "time", "18:00") +
        '<label>How often<select name="everyMonths">' + opt(1, "Monthly", 3) + opt(2, "Every two months", 3) + opt(3, "Quarterly", 3) + opt(6, "Twice a year", 3) + "</select></label>" +
        input("location", "Where (address or video link)") + '<div class="fd-wide"><button type="submit" class="btn">Add a year of meetings</button></div></form></div>' +
        '<div class="fw-card"><h3>One meeting</h3><form class="fd-form" id="gv-meeting-form">' + input("title", "Title", "text", "", 'required placeholder="Special meeting: budget"') +
        '<label>Kind<select name="kind">' + Object.keys(KIND).map(function (k) { return opt(k, KIND[k], "special"); }).join("") + "</select></label>" +
        input("startsAt", "When", "datetime-local", "", "required") + input("location", "Where") + '<div class="fd-wide"><button type="submit" class="btn">Add meeting</button></div></form></div></div>';
    });
  }

  function meetingDetail(id) {
    var el = panel("gv-meeting"); show("gv-meeting"); el.innerHTML = '<p class="load-note">Loading...</p>'; window.scrollTo(0, 0);
    api("/api/gov/meetings/" + encodeURIComponent(id)).then(function (d) {
      var m = d.item, att = m.attendance || {}, q = d.quorum;
      var names = d.members.map(function (x) { return x.name; });
      var html = '<div class="fd-toolbar"><button type="button" class="btn secondary" data-gv-go="gv-meetings">&larr; Meetings</button><span>' +
        '<a class="btn secondary" href="/print/agenda/' + encodeURIComponent(m.id) + '" target="_blank" rel="noopener">Agenda</a> <a class="btn secondary" href="/print/minutes/' + encodeURIComponent(m.id) + '" target="_blank" rel="noopener">Minutes</a> <a class="btn secondary" href="/api/gov/meetings/' + encodeURIComponent(m.id) + '.ics">Calendar file</a></span></div>';
      html += '<div class="fw-card"><div class="fd-row"><h3 style="margin:0">' + esc(m.title) + "</h3> " + pill(m.status === "held" ? "Held" : m.status === "cancelled" ? "Cancelled" : "Scheduled", m.status === "held" ? "good" : "") + "</div>" +
        '<form class="fd-form" id="gv-meeting-edit" data-id="' + esc(m.id) + '">' + input("title", "Title", "text", m.title, "required") +
        '<label>Kind<select name="kind">' + Object.keys(KIND).map(function (k) { return opt(k, KIND[k], m.kind); }).join("") + "</select></label>" +
        input("startsAt", "When", "datetime-local", m.startsAt) + input("durationMin", "Minutes long", "number", m.durationMin || 90, "min=15 max=600") + input("location", "Where", "text", m.location) +
        '<label>Status<select name="status">' + opt("scheduled", "Scheduled", m.status) + opt("held", "Held", m.status) + opt("cancelled", "Cancelled", m.status) + "</select></label>" +
        area("agenda", "Agenda, one item per line", m.agenda, "rows=7") + '<div class="fd-wide"><button type="submit" class="btn">Save</button> <span class="form-msg" role="status"></span></div></form></div>';
      html += '<div class="fw-card"><h3>Attendance</h3><p>' + (q.voting ? (q.met ? pill("Quorum present", "good") : pill("No quorum yet", "warn")) + " " + q.present + " of " + q.voting + " voting members present; " + q.needed + " needed." : "Add board members to take attendance.") + "</p>" +
        (d.members.length ? '<form class="fd-form" id="gv-attend-form" data-id="' + esc(m.id) + '">' + d.members.map(function (x) {
          return "<label>" + esc(x.name) + (x.role && x.role !== "member" ? ' <span class="fd-dim">(' + esc(ROLE[x.role] || x.role) + ")</span>" : "") + '<select name="' + esc(x.id) + '">' + opt("", "Not recorded", att[x.id] || "") + opt("present", "Present", att[x.id] || "") + opt("absent", "Absent", att[x.id] || "") + opt("excused", "Excused", att[x.id] || "") + "</select></label>";
        }).join("") + input("guests", "Also present (staff, guests)", "text", m.guests) + '<div class="fd-wide"><button type="submit" class="btn">Save attendance</button> <span class="form-msg" role="status"></span></div></form>' : "") + "</div>";
      html += '<div class="fw-card"><h3>Minutes</h3><form class="fd-form" id="gv-minutes-form" data-id="' + esc(m.id) + '">' +
        area("conflictsDeclared", "Conflicts of interest declared (who, on which item, and that they stepped out)", m.conflictsDeclared, 'rows=2 placeholder="None declared."') +
        area("minutes", "Discussion: what was reported and discussed, item by item", m.minutes, "rows=10") +
        input("minutesApprovedOn", "Board approved these minutes on", "date", m.minutesApprovedOn) +
        '<div class="fd-wide"><button type="submit" class="btn">Save minutes</button> <span class="form-msg" role="status"></span><p class="fd-dim fd-small">Minutes are approved at the next meeting. Record that date here, and the printed minutes drop the "draft" mark.</p></div></form></div>';
      html += '<div class="fw-card"><h3>Motions and votes</h3>' + (d.motions.length ? '<div class="table-wrap"><table class="prospect-table fd-table"><thead><tr><th>Motion</th><th>Moved / seconded</th><th>Vote</th><th>Result</th><th></th></tr></thead><tbody>' + d.motions.map(function (x) {
        return "<tr><td>" + esc(x.motion) + "</td><td>" + esc(x.movedBy) + (x.secondedBy ? " / " + esc(x.secondedBy) : "") + "</td><td>" + x.yes + " yes, " + x.no + " no, " + x.abstain + " abstain</td><td>" + pill(x.result === "passed" ? "Passed" : x.result === "failed" ? "Failed" : "Tabled", x.result === "passed" ? "good" : "") +
          '</td><td><button type="button" class="btn danger" data-gv-del-motion="' + esc(x.id) + '">Remove</button></td></tr>';
      }).join("") + "</tbody></table></div>" : empty("No motions recorded.")) +
        '<form class="fd-form" id="gv-motion-form" data-id="' + esc(m.id) + '"><datalist id="gv-names">' + names.map(function (n) { return '<option value="' + esc(n) + '">'; }).join("") + "</datalist>" +
        area("motion", "Motion", "", 'rows=2 required placeholder="To approve the 2027 budget as presented."') + input("movedBy", "Moved by", "text", "", 'list="gv-names"') + input("secondedBy", "Seconded by", "text", "", 'list="gv-names"') +
        input("yes", "Yes", "number", q.present || "", "min=0") + input("no", "No", "number", 0, "min=0") + input("abstain", "Abstain", "number", 0, "min=0") +
        '<label>Result<select name="result">' + opt("passed", "Passed") + opt("failed", "Failed") + opt("tabled", "Tabled") + "</select></label>" +
        '<div class="fd-wide"><button type="submit" class="btn">Record motion</button></div></form></div>';
      html += '<div class="fd-actions"><button type="button" class="btn danger" data-gv-del-meeting="' + esc(m.id) + '">Remove meeting</button></div>';
      el.innerHTML = html;
    }).catch(function (e) { el.innerHTML = empty("Couldn't open the meeting: " + e.message); });
  }

  // ---------- Members ----------
  function members(el, editId) {
    return api("/api/gov/members").then(function (d) {
      var t = today();
      var e = d.items.filter(function (x) { return x.id === editId; })[0] || { role: "member", voting: true };
      el.innerHTML = '<div class="fw-card"><div class="table-wrap"><table class="prospect-table fd-table"><thead><tr><th>Name</th><th>Role</th><th>Committees</th><th>Term</th><th></th></tr></thead><tbody>' +
        (d.items.length ? d.items.map(function (x) {
          var ended = x.termEnd && x.termEnd < t;
          return "<tr><td><strong>" + esc(x.name) + "</strong>" + (x.email ? '<br><span class="fd-dim fd-small">' + esc(x.email) + "</span>" : "") + "</td><td>" + esc(ROLE[x.role] || x.role) + (x.voting === false && x.role !== "staff" ? " " + pill("Non-voting") : "") + '</td><td class="fd-small">' + esc(x.committees) + "</td><td>" +
            esc(fmtDate(x.termStart)) + (x.termEnd ? " to " + esc(fmtDate(x.termEnd)) : "") + (ended ? " " + pill("Term ended") : x.termEnd && x.termEnd <= addMonths(t, 3) ? " " + pill("Ending soon", "gold") : "") +
            '</td><td><button type="button" class="btn secondary fd-sm" data-gv-edit-member="' + esc(x.id) + '">Edit</button> <button type="button" class="btn danger" data-gv-del-member="' + esc(x.id) + '">Remove</button></td></tr>';
        }).join("") : '<tr><td colspan="5" class="empty-note">No board members yet.</td></tr>') + "</tbody></table></div>" +
        '<p class="fd-dim fd-small">Board members who also need to sign in get a Board account in Settings &gt; People (view only).</p></div>' +
        '<div class="fw-card"><h3>' + (e.id ? "Edit " + esc(e.name) : "Add a board member") + '</h3><form class="fd-form" id="gv-member-form" data-id="' + esc(e.id || "") + '">' + input("name", "Name", "text", e.name, "required") + input("email", "Email", "email", e.email) +
        '<label>Role<select name="role">' + Object.keys(ROLE).map(function (k) { return opt(k, ROLE[k], e.role); }).join("") + "</select></label>" + input("committees", "Committees", "text", e.committees, 'placeholder="Finance, Governance"') +
        input("termStart", "Term starts", "date", e.termStart) + input("termEnd", "Term ends", "date", e.termEnd) + '<label class="check-row"><input type="checkbox" name="voting"' + (e.voting !== false ? " checked" : "") + "> Votes</label>" +
        area("notes", "Notes", e.notes, "rows=2") + '<div class="fd-wide"><button type="submit" class="btn">' + (e.id ? "Save" : "Add member") + "</button>" + (e.id ? ' <button type="button" class="btn secondary" data-gv-go="gv-members">Cancel</button>' : "") + ' <span class="form-msg" role="status"></span></div></form></div>';
    });
  }

  // ---------- Conflict of interest ----------
  function coi(el) {
    return api("/api/gov/coi?year=" + S.year).then(function (d) {
      var signed = d.items.filter(function (x) { return x.signedOn; }).length;
      var started = d.items.some(function (x) { return x.token; });
      var base = location.origin + "/coi/";
      var orgName = (window.ORG && window.ORG.org && window.ORG.org.name) || "";
      var html = '<div class="fd-toolbar"><label>Year <select id="gv-coi-year">' + [S.year + 1, new Date().getFullYear(), new Date().getFullYear() - 1, new Date().getFullYear() - 2].filter(function (v, i, a) { return a.indexOf(v) === i; }).sort().reverse().map(function (y) { return opt(y, y, S.year); }).join("") + "</select></label>" +
        (d.items.length ? '<span class="fd-push"><button type="button" class="btn" id="gv-coi-start">' + (started ? "Add links for new members" : "Create " + d.year + " statements") + "</button></span>" : "") + "</div>";
      html += '<div class="fd-kpis">' + kpi("Signed", signed + " of " + d.items.length) + kpi("Disclosed something", String(d.items.filter(function (x) { return x.signedOn && !x.noConflicts; }).length)) + "</div>";
      html += '<div class="fw-card"><p class="fd-small">Each member gets a private link to read the statement and sign. No sign-in needed. Send it by email; the "Email" button opens a ready-made message.</p><div class="table-wrap"><table class="prospect-table fd-table"><thead><tr><th>Member</th><th>Status</th><th>Disclosed</th><th>Link</th></tr></thead><tbody>' +
        (d.items.length ? d.items.map(function (x) {
          var link = x.token ? base + x.token : "";
          var mail = x.token && x.email ? "mailto:" + encodeURIComponent(x.email) + "?subject=" + encodeURIComponent(d.year + " conflict-of-interest statement") + "&body=" + encodeURIComponent("Hi " + x.name.split(" ")[0] + ",\n\nPlease read and sign " + orgName + "'s " + d.year + " conflict-of-interest statement here (it takes two minutes):\n\n" + link + "\n\nThank you.") : "";
          return "<tr><td><strong>" + esc(x.name) + "</strong><br><span class=\"fd-dim fd-small\">" + esc(ROLE[x.role] || "") + "</span></td><td>" +
            (x.signedOn ? pill("Signed " + fmtDate(x.signedOn), "good") : x.sentOn ? pill("Sent " + fmtDate(x.sentOn), "gold") : x.token ? pill("Not sent") : '<span class="fd-dim">&ndash;</span>') + '</td><td class="fd-small">' + (x.signedOn ? (x.noConflicts ? "Nothing" : esc(x.disclosures)) : "") + "</td><td>" +
            (x.token ? '<button type="button" class="btn secondary fd-sm" data-gv-copy="' + esc(link) + '" data-coi="' + esc(x.id) + '">Copy link</button>' + (mail ? ' <a class="btn secondary fd-sm" href="' + esc(mail) + '" data-coi-sent="' + esc(x.id) + '">Email</a>' : "") + ' <a class="fd-small" href="' + esc(link) + '" target="_blank" rel="noopener">Open</a>' : "") + "</td></tr>";
        }).join("") : '<tr><td colspan="4" class="empty-note">Add board members first.</td></tr>') + "</tbody></table></div></div>";
      html += '<details class="fw-card"><summary><strong>The statement members sign</strong></summary><p class="fd-pre fd-small">' + esc(d.statement) + '</p><p class="fd-dim fd-small">Change the wording in org.config.json (governance.coiStatement) to match your adopted policy.</p></details>';
      el.innerHTML = html;
    });
  }

  // ---------- Form 990 ----------
  function checklist(el) {
    return Promise.all([api("/api/gov/checklist"), api("/api/gov/summary")]).then(function (r) {
      var items = r[0].items, s = r[1];
      var years = []; items.forEach(function (i) { if (years.indexOf(i.fiscalYear) < 0) years.push(i.fiscalYear); });
      if (!S.fy || years.indexOf(S.fy) < 0) S.fy = years[0] || "";
      var list = items.filter(function (i) { return i.fiscalYear === S.fy; }).sort(function (a, b) { return (a.dueOn || "").localeCompare(b.dueOn || "") || a.sort - b.sort; });
      var t = today(), done = list.filter(function (i) { return i.doneOn; }).length;
      var startBtns = [[s.lastFiscalYear, -1], [s.currentFiscalYear, 0]].filter(function (y) { return years.indexOf(y[0]) < 0; })
        .map(function (y) { return '<button type="button" class="btn' + (y[1] === -1 ? "" : " secondary") + '" data-gv-start990="' + y[1] + '">Start the ' + esc(y[0]) + " checklist</button>"; }).join(" ");
      var html = '<div class="fd-toolbar">' + (years.length ? '<label>Year <select id="gv-fy">' + years.map(function (y) { return opt(y, y, S.fy); }).join("") + "</select></label>" : "<span></span>") + '<span class="fd-push">' + startBtns + "</span></div>";
      if (!list.length) {
        html += '<div class="fw-card fd-start"><h3>The Form 990 checklist</h3><p>Everything to do between year-end and filing, with due dates worked out from your fiscal year: the conflict-of-interest statements and policies Part VI asks about, minutes, the board\'s copy before filing, the filing (or extension) itself, state registration, and public inspection.</p><p class="fd-small">The 990 is due on the 15th day of the fifth month after your year ends; Form 8868 gives an automatic six-month extension.</p></div>';
        el.innerHTML = html; return;
      }
      html += '<div class="fw-card"><div class="fd-row"><h3 style="margin:0">Year ' + esc(S.fy) + '</h3><span class="fd-dim">' + done + " of " + list.length + " done</span></div>" + bar(done, list.length) +
        '<div class="table-wrap"><table class="prospect-table fd-table"><thead><tr><th></th><th>What</th><th>Due</th><th>Who</th><th></th></tr></thead><tbody>' + list.map(function (i) {
          return '<tr><td><input type="checkbox" aria-label="Done" data-gv-done="' + esc(i.id) + '"' + (i.doneOn ? " checked" : "") + "></td><td" + (i.doneOn ? ' class="fd-dim"' : "") + "><strong>" + esc(i.label) + "</strong>" + (i.detail ? '<br><span class="fd-small fd-dim">' + esc(i.detail) + "</span>" : "") + (i.notes ? '<br><span class="fd-small">' + esc(i.notes) + "</span>" : "") +
            (i.itemKey === "coi" ? ' <a href="#" class="fd-small" data-gv-go="gv-coi">Statements</a>' : i.itemKey === "policies" ? ' <a href="#" class="fd-small" data-gv-go="gv-policies">Policies</a>' : i.itemKey === "minutes" ? ' <a href="#" class="fd-small" data-gv-go="gv-meetings">Meetings</a>' : "") +
            "</td><td>" + esc(fmtDate(i.dueOn)) + (!i.doneOn && i.dueOn && i.dueOn < t ? " " + pill("Overdue", "warn") : "") + (i.doneOn ? '<br><span class="fd-small fd-dim">done ' + esc(fmtDate(i.doneOn)) + "</span>" : "") + '</td><td class="fd-small">' + esc(i.owner) +
            '</td><td><button type="button" class="btn secondary fd-sm" data-gv-note="' + esc(i.id) + '">Owner / note</button></td></tr>';
        }).join("") + "</tbody></table></div>" +
        '<form class="fd-form fd-inline" id="gv-item-form">' + input("label", "Add an item", "text", "", "required") + input("dueOn", "Due", "date") + input("owner", "Who") + '<div><button type="submit" class="btn secondary">Add</button></div></form></div>';
      el.innerHTML = html;
    });
  }

  // ---------- Policies ----------
  function policies(el, editId) {
    return api("/api/gov/policies").then(function (d) {
      var t = today();
      var e = d.items.filter(function (x) { return x.id === editId; })[0] || { reviewEveryMonths: 24 };
      el.innerHTML = '<div class="fw-card"><div class="fd-row"><h3 style="margin:0">Policy register</h3>' + (d.items.length < 7 ? '<span class="fd-push"><button type="button" class="btn secondary fd-sm" id="gv-seed">Add the standard policies</button></span>' : "") + "</div>" +
        '<div class="table-wrap"><table class="prospect-table fd-table"><thead><tr><th>Policy</th><th>Adopted</th><th>Last reviewed</th><th>Next review</th><th></th></tr></thead><tbody>' +
        (d.items.length ? d.items.map(function (p) {
          var base = p.lastReviewed || p.adoptedOn, next = base ? addMonths(base, p.reviewEveryMonths || 24) : "";
          return "<tr><td><strong>" + (p.link ? '<a href="' + esc(p.link) + '" target="_blank" rel="noopener">' + esc(p.name) + "</a>" : esc(p.name)) + "</strong>" + (p.notes ? '<br><span class="fd-dim fd-small">' + esc(p.notes) + "</span>" : "") + "</td><td>" + (p.adoptedOn ? esc(fmtDate(p.adoptedOn)) : pill("Not adopted", "warn")) + "</td><td>" + esc(fmtDate(p.lastReviewed)) + "</td><td>" +
            (next ? esc(fmtDate(next)) + (next <= t ? " " + pill("Due", "warn") : "") : "") + '</td><td><button type="button" class="btn secondary fd-sm" data-gv-reviewed="' + esc(p.id) + '">Reviewed today</button> <button type="button" class="btn secondary fd-sm" data-gv-edit-policy="' + esc(p.id) + '">Edit</button> <button type="button" class="btn danger" data-gv-del-policy="' + esc(p.id) + '">Remove</button></td></tr>';
        }).join("") : '<tr><td colspan="5" class="empty-note">No policies yet. "Add the standard policies" adds the ones the Form 990 asks about.</td></tr>') + "</tbody></table></div></div>" +
        '<div class="fw-card"><h3>' + (e.id ? "Edit " + esc(e.name) : "Add a policy") + '</h3><form class="fd-form" id="gv-policy-form" data-id="' + esc(e.id || "") + '">' + input("name", "Policy", "text", e.name, "required") + input("adoptedOn", "Adopted by the board on", "date", e.adoptedOn) +
        input("lastReviewed", "Last reviewed", "date", e.lastReviewed) + input("reviewEveryMonths", "Review every (months)", "number", e.reviewEveryMonths || 24, "min=1 max=120") + input("link", "Link to the document", "url", e.link, 'placeholder="https://drive.google.com/..."') +
        area("notes", "Notes", e.notes, "rows=2") + '<div class="fd-wide"><button type="submit" class="btn">' + (e.id ? "Save" : "Add policy") + '</button> <span class="form-msg" role="status"></span></div></form></div>';
    });
  }

  // ---------- events ----------
  function guard(btn, p, after) { if (btn) btn.disabled = true; return p.then(after || function () {}).catch(function (e) { toast(e.message); }).then(function () { if (btn) btn.disabled = false; }); }
  function sure(what) { return window.confirm("Remove " + what + "? It's kept in backups but disappears from these lists."); }
  document.addEventListener("click", function (e) {
    var b;
    if ((b = e.target.closest('.rail-btn[data-view="board"]'))) { render(S.tab); return; }
    if ((b = e.target.closest("[data-gv-tab]"))) { render(b.getAttribute("data-gv-tab")); return; }
    if ((b = e.target.closest("[data-gv-go]"))) { e.preventDefault(); render(b.getAttribute("data-gv-go")); return; }
    if ((b = e.target.closest("[data-gv-meeting]"))) { e.preventDefault(); meetingDetail(b.getAttribute("data-gv-meeting")); return; }
    if ((b = e.target.closest("[data-gv-edit-member]"))) { members(panel("gv-members"), b.getAttribute("data-gv-edit-member")).then(function () { document.getElementById("gv-member-form").scrollIntoView({ behavior: "smooth" }); }); return; }
    if ((b = e.target.closest("[data-gv-del-member]"))) { if (sure("this board member")) guard(b, api("/api/gov/members/" + b.getAttribute("data-gv-del-member"), { method: "DELETE" }), function () { render("gv-members"); }); return; }
    if ((b = e.target.closest("[data-gv-del-meeting]"))) { if (sure("this meeting")) guard(b, api("/api/gov/meetings/" + b.getAttribute("data-gv-del-meeting"), { method: "DELETE" }), function () { render("gv-meetings"); }); return; }
    if ((b = e.target.closest("[data-gv-del-motion]"))) { var mid = b.closest("[data-gv-panel]").querySelector("#gv-motion-form").getAttribute("data-id"); guard(b, api("/api/gov/motions/" + b.getAttribute("data-gv-del-motion"), { method: "DELETE" }), function () { meetingDetail(mid); }); return; }
    if ((b = e.target.closest("#gv-coi-start"))) { guard(b, api("/api/gov/coi/start", { method: "POST", body: { year: S.year } }), function (r) { toast(r.created + " link" + (r.created === 1 ? "" : "s") + " created."); render("gv-coi"); }); return; }
    if ((b = e.target.closest("[data-gv-copy]"))) {
      var link = b.getAttribute("data-gv-copy"), cid = b.getAttribute("data-coi");
      (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(function () { toast("Link copied. Paste it into an email to the member."); }, function () { window.prompt("Copy this link:", link); });
      api("/api/gov/coi/" + cid, { method: "PATCH", body: { sentOn: today() } }).then(function () { setTimeout(function () { render("gv-coi"); }, 600); }).catch(function () {});
      return;
    }
    if ((b = e.target.closest("[data-coi-sent]"))) { api("/api/gov/coi/" + b.getAttribute("data-coi-sent"), { method: "PATCH", body: { sentOn: today() } }).then(function () { setTimeout(function () { render("gv-coi"); }, 800); }).catch(function () {}); return; }
    if ((b = e.target.closest("[data-gv-start990]"))) { guard(b, api("/api/gov/checklist/start", { method: "POST", body: { offset: Number(b.getAttribute("data-gv-start990")) } }), function (r) { S.fy = r.fiscalYear; render("gv-990"); }); return; }
    if ((b = e.target.closest("[data-gv-note]"))) {
      var owner = window.prompt("Who's responsible? (leave as is to keep)", ""); if (owner === null) return;
      var note = window.prompt("A note for this item (optional)", ""); if (note === null) return;
      var body = {}; if (owner) body.owner = owner; if (note) body.notes = note;
      guard(b, api("/api/gov/checklist/" + b.getAttribute("data-gv-note"), { method: "PATCH", body: body }), function () { render("gv-990"); }); return;
    }
    if ((b = e.target.closest("#gv-seed"))) { guard(b, api("/api/gov/policies/seed", { method: "POST", body: {} }), function () { render("gv-policies"); }); return; }
    if ((b = e.target.closest("[data-gv-reviewed]"))) { guard(b, api("/api/gov/policies/" + b.getAttribute("data-gv-reviewed"), { method: "PATCH", body: { lastReviewed: today() } }), function () { render("gv-policies"); }); return; }
    if ((b = e.target.closest("[data-gv-edit-policy]"))) { policies(panel("gv-policies"), b.getAttribute("data-gv-edit-policy")).then(function () { document.getElementById("gv-policy-form").scrollIntoView({ behavior: "smooth" }); }); return; }
    if ((b = e.target.closest("[data-gv-del-policy]"))) { if (sure("this policy")) guard(b, api("/api/gov/policies/" + b.getAttribute("data-gv-del-policy"), { method: "DELETE" }), function () { render("gv-policies"); }); return; }
  });
  document.addEventListener("change", function (e) {
    var t = e.target;
    if (t.id === "gv-coi-year") { S.year = Number(t.value); render("gv-coi"); }
    else if (t.id === "gv-fy") { S.fy = t.value; render("gv-990"); }
    else if (t.hasAttribute && t.hasAttribute("data-gv-done")) api("/api/gov/checklist/" + t.getAttribute("data-gv-done"), { method: "PATCH", body: { doneOn: t.checked ? today() : "" } }).then(function () { render("gv-990"); }).catch(function (err) { toast(err.message); t.checked = !t.checked; });
  });
  document.addEventListener("submit", function (e) {
    var f = e.target, id = f.id;
    if (["gv-plan-form", "gv-meeting-form", "gv-meeting-edit", "gv-attend-form", "gv-minutes-form", "gv-motion-form", "gv-member-form", "gv-item-form", "gv-policy-form"].indexOf(id) < 0) return;
    e.preventDefault();
    var d = formData(f), rid = f.getAttribute("data-id"), btn = f.querySelector('button[type="submit"]'), msg = f.querySelector(".form-msg");
    function ok(text) { if (msg) { msg.textContent = text; msg.className = "form-msg"; setTimeout(function () { msg.textContent = ""; }, 3000); } }
    function go(p, after) { if (btn) btn.disabled = true; p.then(after).catch(function (err) { if (msg) { msg.textContent = err.message; msg.className = "form-msg is-bad"; } else toast(err.message); }).then(function () { if (btn) btn.disabled = false; }); }
    if (id === "gv-plan-form") go(api("/api/gov/meetings/plan", { method: "POST", body: d }), function (r) { toast(r.created + " meeting" + (r.created === 1 ? "" : "s") + " added."); render("gv-meetings"); });
    else if (id === "gv-meeting-form") go(api("/api/gov/meetings", { method: "POST", body: d }), function (r) { meetingDetail(r.item.id); });
    else if (id === "gv-meeting-edit") go(api("/api/gov/meetings/" + rid, { method: "PATCH", body: d }), function () { ok("Saved."); });
    else if (id === "gv-attend-form") {
      var att = {}; Object.keys(d).forEach(function (k) { if (k !== "guests" && d[k]) att[k] = d[k]; });
      go(api("/api/gov/meetings/" + rid, { method: "PATCH", body: { attendance: att, guests: d.guests, status: "held" } }), function () { meetingDetail(rid); });
    }
    else if (id === "gv-minutes-form") go(api("/api/gov/meetings/" + rid, { method: "PATCH", body: d }), function () { ok("Saved."); });
    else if (id === "gv-motion-form") go(api("/api/gov/motions", { method: "POST", body: Object.assign(d, { meetingId: rid }) }), function () { meetingDetail(rid); });
    else if (id === "gv-member-form") go(api(rid ? "/api/gov/members/" + rid : "/api/gov/members", { method: rid ? "PATCH" : "POST", body: d }), function () { render("gv-members"); });
    else if (id === "gv-item-form") go(api("/api/gov/checklist", { method: "POST", body: Object.assign(d, { fiscalYear: S.fy, sort: 100 }) }), function () { render("gv-990"); });
    else if (id === "gv-policy-form") go(api(rid ? "/api/gov/policies/" + rid : "/api/gov/policies", { method: rid ? "PATCH" : "POST", body: d }), function () { render("gv-policies"); });
  });
  window.GV = { render: render, meeting: meetingDetail };
  var v = document.querySelector('.view[data-view="board"]');
  if (v && !v.hidden) render("gv-overview");
})();
