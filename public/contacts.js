/* Contacts view: one record per person and per organization, with everything
   linked to them (deals, grants, gifts, board role, checklists, messages).
   Server side is contacts.js (/api/contacts, /api/orgs). */
(function () {
  "use strict";
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fmtDate(iso) { if (!/^\d{4}-\d{2}-\d{2}/.test(iso || "")) return ""; return new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  function money(n) { n = Number(n) || 0; return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 }); }
  function api(url, opts) {
    opts = opts || {};
    if (opts.body && typeof opts.body !== "string") { opts.headers = { "Content-Type": "application/json" }; opts.body = JSON.stringify(opts.body); }
    return fetch(url, opts).then(function (res) {
      if (res.status === 401) { window.location.href = "/"; throw new Error("not signed in"); }
      return res.json().catch(function () { return {}; }).then(function (b) { if (!res.ok) throw new Error(b.error || ("request failed: " + res.status)); return b; });
    });
  }
  function pill(t, k) { return '<span class="pill' + (k ? " " + k : "") + '">' + esc(t) + "</span>"; }
  function input(n, l, type, v, a) { return "<label>" + esc(l) + '<input name="' + n + '" type="' + (type || "text") + '" value="' + esc(v == null ? "" : v) + '" ' + (a || "") + "></label>"; }
  function opt(v, l, sel) { return '<option value="' + esc(v) + '"' + (String(sel) === String(v) ? " selected" : "") + ">" + esc(l) + "</option>"; }
  function empty(t) { return '<p class="empty-note fd-empty fd-empty-art">' + ((window.FD && window.FD.art) || "") + esc(t) + "</p>"; }
  function toast(t) { var b = document.getElementById("fd-toast"); if (!b) { b = document.createElement("div"); b.id = "fd-toast"; b.className = "fd-toast"; b.setAttribute("role", "status"); document.body.appendChild(b); } b.textContent = t; b.hidden = false; clearTimeout(b._t); b._t = setTimeout(function () { b.hidden = true; }, 5000); }
  function formData(f) { var o = {}; Array.prototype.forEach.call(f.elements, function (el) { if (el.name) o[el.name] = el.value; }); return o; }

  var ROLE = { client: "Client", prospect: "Prospect", grantee: "Grantee", donor: "Donor", board: "Board" };
  var ROLE_KIND = { client: "good", grantee: "gold", donor: "gold", board: "", prospect: "" };
  var STAGE = { lead: "Lead", discovery: "Discovery call", assessment: "Diagnostic", engaged: "Engaged", graduated: "Graduated", referred: "Referred out", lost: "Lost" };
  var C = { tab: "ct-people", q: "", role: "", orgs: [] };
  function panel(k) { return document.querySelector('[data-ct-panel="' + k + '"]'); }
  function show(k) {
    document.querySelectorAll("[data-ct-panel]").forEach(function (p) { p.hidden = p.getAttribute("data-ct-panel") !== k; });
    document.querySelectorAll("[data-ct-tab]").forEach(function (b) { var on = b.getAttribute("data-ct-tab") === k; b.classList.toggle("is-active", on); b.setAttribute("aria-selected", on ? "true" : "false"); });
  }
  function render(tab) {
    tab = tab || C.tab; if (tab === "ct-person" || tab === "ct-org") tab = C.last || "ct-people"; C.tab = tab; C.last = tab; show(tab);
    var el = panel(tab); el.innerHTML = '<p class="load-note">Loading...</p>';
    (tab === "ct-people" ? people(el) : orgs(el)).catch(function (e) { el.innerHTML = empty("Couldn't load: " + e.message); });
  }
  function toolbar(placeholder) {
    return '<div class="fd-toolbar"><label>Search <input type="search" id="ct-q" value="' + esc(C.q) + '" placeholder="' + esc(placeholder) + '"></label>' +
      '<span class="filter-row">' + [["", "Everyone"]].concat(Object.keys(ROLE).map(function (k) { return [k, ROLE[k]]; })).map(function (r) { return '<button type="button" class="filter-btn' + (C.role === r[0] ? " is-active" : "") + '" data-ct-role="' + r[0] + '">' + r[1] + "</button>"; }).join("") + "</span></div>";
  }
  function people(el) {
    return api("/api/contacts?q=" + encodeURIComponent(C.q) + (C.role ? "&role=" + C.role : "")).then(function (r) {
      var noEmail = r.items.filter(function (c) { return !c.email; }).length;
      el.innerHTML = toolbar("Name, email, organization") +
        (noEmail ? '<p class="fd-small lb-note">' + pill(noEmail + " without an email", "warn") + " Checklist messages need one. Open the person and add it; it's shared everywhere they appear.</p>" : "") +
        '<div class="fw-card"><div class="table-wrap"><table class="prospect-table fd-table"><thead><tr><th>Name</th><th>Organization</th><th>Email</th><th>Roles</th></tr></thead><tbody>' +
        (r.items.length ? r.items.slice(0, 500).map(function (c) {
          return '<tr><td><a href="#" data-ct-person="' + esc(c.id) + '"><strong>' + esc(c.name) + "</strong></a>" + (c.title ? '<br><span class="fd-small fd-dim">' + esc(c.title) + "</span>" : "") + "</td><td>" + esc(c.orgName) + "</td><td>" + (c.email ? esc(c.email) : pill("No email", "warn")) + "</td><td>" + c.roles.map(function (x) { return pill(ROLE[x] || x, ROLE_KIND[x]); }).join(" ") + "</td></tr>";
        }).join("") : '<tr><td colspan="4" class="empty-note">No one matches.</td></tr>') + "</tbody></table></div></div>" +
        '<details class="fw-card fd-add"><summary><strong>Add a person</strong></summary><form class="fd-form" id="ct-new">' + input("name", "Name", "text", "", "required") + input("email", "Email", "email") + input("phone", "Phone", "tel") + input("title", "Title") +
        '<label>Organization<input name="orgName" list="ct-org-list" placeholder="Start typing"></label><datalist id="ct-org-list"></datalist><div class="fd-wide"><button type="submit" class="btn">Add</button></div></form></details>';
      fillOrgList();
    });
  }
  function fillOrgList() {
    return api("/api/orgs").then(function (r) {
      C.orgs = r.items;
      document.querySelectorAll("#ct-org-list").forEach(function (dl) { dl.innerHTML = r.items.map(function (o) { return '<option value="' + esc(o.name) + '">'; }).join(""); });
    }).catch(function () {});
  }
  function orgs(el) {
    return api("/api/orgs?q=" + encodeURIComponent(C.q)).then(function (r) {
      var list = C.role ? r.items.filter(function (o) { return o.roles.indexOf(C.role) >= 0; }) : r.items;
      el.innerHTML = toolbar("Organization name") + '<div class="fw-card"><div class="table-wrap"><table class="prospect-table fd-table"><thead><tr><th>Organization</th><th>Kind</th><th>People</th><th>Roles</th></tr></thead><tbody>' +
        (list.length ? list.slice(0, 500).map(function (o) {
          return '<tr><td><a href="#" data-ct-org="' + esc(o.id) + '"><strong>' + esc(o.name) + "</strong></a>" + (o.ein ? '<br><span class="fd-small fd-dim">EIN ' + esc(o.ein) + "</span>" : "") + "</td><td>" + esc(o.kind) + "</td><td>" + o.people + "</td><td>" + o.roles.map(function (x) { return pill(ROLE[x] || x, ROLE_KIND[x]); }).join(" ") + "</td></tr>";
        }).join("") : '<tr><td colspan="4" class="empty-note">No organizations match.</td></tr>') + "</tbody></table></div></div>";
    });
  }
  function section(title, rows, emptyText) { return '<div class="fw-card"><h3>' + esc(title) + "</h3>" + (rows ? '<ul class="fd-list">' + rows + "</ul>" : empty(emptyText)) + "</div>"; }
  function person(id) {
    var el = panel("ct-person"); show("ct-person"); el.innerHTML = '<p class="load-note">Loading...</p>'; window.scrollTo(0, 0);
    Promise.all([api("/api/contacts/" + encodeURIComponent(id)), fillOrgList()]).then(function (r) {
      var d = r[0], c = d.item;
      var html = '<div class="fd-toolbar"><button type="button" class="btn secondary" data-ct-go="ct-people">&larr; People</button></div>' +
        '<div class="fw-card"><div class="fd-row"><h3 style="margin:0">' + esc(c.name) + "</h3>" + d.roles.map(function (x) { return pill(ROLE[x] || x, ROLE_KIND[x]); }).join(" ") + "</div>" +
        '<p class="fd-dim">' + esc(c.title) + (c.title && c.orgName ? ", " : "") + (c.orgId ? '<a href="#" data-ct-org="' + esc(c.orgId) + '">' + esc(c.orgName) + "</a>" : "") + "</p>" +
        '<form class="fd-form" id="ct-edit" data-id="' + esc(c.id) + '">' + input("name", "Name", "text", c.name, "required") + input("email", "Email", "email", c.email) + input("phone", "Phone", "tel", c.phone) + input("title", "Title", "text", c.title) +
        '<label>Organization<input name="orgName" list="ct-org-list" value="' + esc(c.orgName) + '"></label><datalist id="ct-org-list"></datalist>' +
        '<label class="fd-wide">Notes<textarea name="notes" rows="2">' + esc(c.notes) + "</textarea></label>" +
        '<div class="fd-wide"><button type="submit" class="btn">Save</button> <span class="form-msg" role="status"></span></div></form></div>';
      html += '<div class="fd-grid">';
      html += section("Pipeline", d.deals.map(function (x) { return '<li><span><strong>' + esc(x.label) + "</strong>" + (x.nextStep ? '<br><span class="fd-small fd-dim">Next: ' + esc(x.nextStep) + (x.nextStepDate ? " (" + esc(fmtDate(x.nextStepDate)) + ")" : "") + "</span>" : "") + "</span><span>" + pill(STAGE[x.stage] || x.stage) + (x.score != null ? ' <span class="fd-small">Health Index ' + Math.round(x.score) + "</span>" : "") + (x.portal ? ' <a class="fd-small" href="' + esc(x.portal) + '" target="_blank" rel="noopener">Portal</a>' : "") + "</span></li>"; }).join(""), "Not in the pipeline.");
      html += section("Grants", d.grants.map(function (x) { return "<li><span>" + esc(x.project || x.orgName) + '<br><span class="fd-small fd-dim">' + esc(fmtDate(x.date)) + "</span></span><span>" + pill(x.status) + " " + (x.awarded ? money(x.awarded) : money(x.requested) + " requested") + "</span></li>"; }).join(""), "No grant applications.");
      html += section("Giving", d.giving.gifts.length ? d.giving.gifts.map(function (g) { return "<li><span>" + esc(fmtDate(g.date)) + (g.campaign ? ' <span class="fd-small fd-dim">' + esc(g.campaign) + "</span>" : "") + "</span><span>" + money(g.amount) + "</span></li>"; }).join("") + '<li><strong>Lifetime</strong><strong>' + money(d.giving.total) + "</strong></li>" : "", "No gifts recorded.");
      html += section("Board", d.board.map(function (b) { return "<li><span>" + esc(b.role) + (b.committees ? ' <span class="fd-small fd-dim">' + esc(b.committees) + "</span>" : "") + '</span><span class="fd-small">' + esc(fmtDate(b.termStart)) + (b.termEnd ? " to " + esc(fmtDate(b.termEnd)) : "") + "</span></li>"; }).join(""), "Not on the board.");
      html += section("Checklists", d.checklists.map(function (x) { return '<li><a href="#" data-ct-run="' + esc(x.id) + '">' + esc(x.processName) + '</a><span class="fd-small">' + (x.completedOn ? pill("Done " + fmtDate(x.completedOn), "good") : x.done + " of " + x.total) + "</span></li>"; }).join(""), "No checklists yet.");
      html += section("Messages", d.messages.map(function (m) { return "<li><span>" + esc(m.subject) + '</span><span class="fd-small">' + (m.status === "draft" ? pill("Waiting for approval", "warn") : m.status === "sent" || m.status === "opened" ? "sent " + esc(fmtDate(m.sentAt)) : esc(m.status)) + (m.repliedAt ? " " + pill("Replied " + fmtDate(m.repliedAt), "good") : "") + "</span></li>"; }).join(""), "No messages yet.");
      if (d.feedback.length) html += section("Feedback", d.feedback.map(function (f) { return "<li><span>" + esc(f.result || "") + '</span><span class="fd-small">' + (f.rating ? f.rating + "/5 " : "") + esc(fmtDate(f.date)) + "</span></li>"; }).join(""), "");
      html += "</div>";
      html += '<details class="fw-card fd-add"><summary><strong>Merge a duplicate into this person</strong></summary><form class="fd-form" id="ct-merge" data-id="' + esc(c.id) + '"><label class="fd-wide">Find the duplicate<input name="q" id="ct-merge-q" placeholder="Name or email"></label><div class="fd-wide" id="ct-merge-hits"></div></form></details>';
      el.innerHTML = html;
    }).catch(function (e) { el.innerHTML = empty("Couldn't open: " + e.message); });
  }
  function org(id) {
    var el = panel("ct-org"); show("ct-org"); el.innerHTML = '<p class="load-note">Loading...</p>'; window.scrollTo(0, 0);
    api("/api/orgs/" + encodeURIComponent(id)).then(function (d) {
      var o = d.item;
      var html = '<div class="fd-toolbar"><button type="button" class="btn secondary" data-ct-go="ct-orgs">&larr; Organizations</button></div>' +
        '<div class="fw-card"><div class="fd-row"><h3 style="margin:0">' + esc(o.name) + "</h3>" + d.roles.map(function (x) { return pill(ROLE[x] || x, ROLE_KIND[x]); }).join(" ") + "</div>" +
        (d.scan ? '<p class="fd-small">DMV Market Scan: public score ' + (d.scan.publicScore != null ? Math.round(d.scan.publicScore) : "&ndash;") + (d.scan.growth ? " &middot; " + esc(d.scan.growth) : "") + (d.scan.situation ? " &middot; likely " + esc(d.scan.situation) : "") + "</p>" : "") +
        '<form class="fd-form" id="ct-org-edit" data-id="' + esc(o.id) + '">' + input("name", "Name", "text", o.name, "required") +
        '<label>Kind<select name="kind">' + ["nonprofit", "foundation", "company", "government", "other"].map(function (k) { return opt(k, k.charAt(0).toUpperCase() + k.slice(1), o.kind); }).join("") + "</select></label>" +
        input("ein", "EIN", "text", o.ein) + input("website", "Website", "text", o.website) + input("city", "City", "text", o.city) + input("state", "State", "text", o.state) +
        '<label class="fd-wide">Notes<textarea name="notes" rows="2">' + esc(o.notes) + '</textarea></label><div class="fd-wide"><button type="submit" class="btn">Save</button></div></form></div><div class="fd-grid">' +
        section("People", d.people.map(function (p) { return '<li><a href="#" data-ct-person="' + esc(p.id) + '">' + esc(p.name) + '</a><span class="fd-small">' + (p.email ? esc(p.email) : pill("No email", "warn")) + "</span></li>"; }).join(""), "No people yet.") +
        section("Pipeline", d.deals.map(function (x) { return "<li><span>" + esc(x.label) + "</span><span>" + pill(STAGE[x.stage] || x.stage) + "</span></li>"; }).join(""), "Not in the pipeline.") +
        section("Grants", d.grants.map(function (x) { return "<li><span>" + esc(x.project) + '<br><span class="fd-small fd-dim">' + esc(fmtDate(x.date)) + "</span></span><span>" + pill(x.status) + (x.awarded ? " " + money(x.awarded) : "") + "</span></li>"; }).join(""), "No grants.") +
        section("Giving", d.giving.count ? "<li><span>" + d.giving.count + " gift" + (d.giving.count === 1 ? "" : "s") + "</span><strong>" + money(d.giving.total) + "</strong></li>" : "", "No gifts recorded.") + "</div>";
      el.innerHTML = html;
    }).catch(function (e) { el.innerHTML = empty("Couldn't open: " + e.message); });
  }
  function orgIdFor(name) {
    name = String(name || "").trim(); if (!name) return Promise.resolve("");
    var hit = C.orgs.filter(function (o) { return o.name.toLowerCase() === name.toLowerCase(); })[0];
    return hit ? Promise.resolve(hit.id) : api("/api/orgs", { method: "POST", body: { name: name } }).then(function (r) { return r.item.id; });
  }

  document.addEventListener("click", function (e) {
    var b;
    if ((b = e.target.closest('.rail-btn[data-view="contacts"]'))) { render(); return; }
    if ((b = e.target.closest("[data-ct-tab]"))) { C.last = b.getAttribute("data-ct-tab"); render(C.last); return; }
    if ((b = e.target.closest("[data-ct-go]"))) { e.preventDefault(); C.last = b.getAttribute("data-ct-go"); render(C.last); return; }
    if ((b = e.target.closest("[data-ct-role]"))) { C.role = b.getAttribute("data-ct-role"); render(C.tab); return; }
    if ((b = e.target.closest("[data-ct-person]"))) { e.preventDefault(); var rb = document.querySelector('.rail-btn[data-view="contacts"]'); if (rb && document.querySelector('.view[data-view="contacts"]').hidden) rb.click(); person(b.getAttribute("data-ct-person")); return; }
    if ((b = e.target.closest("[data-ct-org]"))) { e.preventDefault(); org(b.getAttribute("data-ct-org")); return; }
    if ((b = e.target.closest("[data-ct-run]"))) { e.preventDefault(); var pb = document.querySelector('.rail-btn[data-view="process"]'); if (pb) pb.click(); var id = b.getAttribute("data-ct-run"); setTimeout(function () { if (window.LB) window.LB.run(id); }, 60); return; }
    if ((b = e.target.closest("[data-ct-merge-from]"))) {
      var into = b.getAttribute("data-into"), from = b.getAttribute("data-ct-merge-from");
      if (!window.confirm("Merge " + b.getAttribute("data-name") + " into this person? Their links and details move here; blanks are filled, nothing is overwritten.")) return;
      api("/api/contacts/" + into + "/merge", { method: "POST", body: { fromId: from } }).then(function () { toast("Merged."); person(into); }).catch(function (err) { toast(err.message); });
    }
  });
  var timer;
  document.addEventListener("input", function (e) {
    if (e.target.id === "ct-q") {
      clearTimeout(timer); var v = e.target.value;
      timer = setTimeout(function () { C.q = v; render(C.tab).then && 0; setTimeout(function () { var s = document.getElementById("ct-q"); if (s) { s.focus(); s.setSelectionRange(v.length, v.length); } }, 400); }, 300);
    }
    if (e.target.id === "ct-merge-q") {
      clearTimeout(timer); var q = e.target.value, form = e.target.closest("form"), into = form.getAttribute("data-id");
      timer = setTimeout(function () {
        if (q.trim().length < 2) { document.getElementById("ct-merge-hits").innerHTML = ""; return; }
        api("/api/contacts?q=" + encodeURIComponent(q)).then(function (r) {
          document.getElementById("ct-merge-hits").innerHTML = r.items.filter(function (c) { return c.id !== into; }).slice(0, 8).map(function (c) {
            return '<button type="button" class="btn secondary fd-sm" data-ct-merge-from="' + esc(c.id) + '" data-into="' + esc(into) + '" data-name="' + esc(c.name) + '">' + esc(c.name) + (c.email ? " (" + esc(c.email) + ")" : "") + (c.orgName ? ", " + esc(c.orgName) : "") + "</button>";
          }).join(" ") || '<span class="fd-small fd-dim">No match.</span>';
        });
      }, 300);
    }
  });
  document.addEventListener("submit", function (e) {
    var f = e.target;
    if (["ct-new", "ct-edit", "ct-org-edit", "ct-merge"].indexOf(f.id) < 0) return;
    e.preventDefault();
    if (f.id === "ct-merge") return;
    var d = formData(f), id = f.getAttribute("data-id"), btn = f.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    var done = function () { if (btn) btn.disabled = false; };
    if (f.id === "ct-org-edit") { api("/api/orgs/" + id, { method: "PATCH", body: d }).then(function () { toast("Saved."); org(id); }).catch(function (err) { toast(err.message); }).then(done); return; }
    orgIdFor(d.orgName).then(function (orgId) {
      var body = { name: d.name, email: d.email, phone: d.phone, title: d.title, orgId: orgId };
      if (f.id === "ct-edit") body.notes = d.notes;
      return api(f.id === "ct-new" ? "/api/contacts" : "/api/contacts/" + id, { method: f.id === "ct-new" ? "POST" : "PATCH", body: body });
    }).then(function (r) { toast("Saved."); person(f.id === "ct-new" ? r.item.id : id); }).catch(function (err) { toast(err.message); }).then(done);
  });
  window.CT = { person: person, render: render };
  var v = document.querySelector('.view[data-view="contacts"]');
  if (v && !v.hidden) render();

  /* ---------- Settings: Connected email (Gmail) ---------- */
  function gmailCard() {
    var body = document.getElementById("gmail-body"); if (!body) return;
    api("/api/gmail/status").then(function (s) {
      var h = "";
      if (!s.configured) {
        h += '<p class="fd-small">Step 1: in Google Cloud, create an OAuth client (type "Web application") and add this exact redirect address:</p>' +
          '<p><code class="ct-code">' + esc(s.redirectUri) + '</code> <button type="button" class="btn secondary fd-sm" data-gm-copy="' + esc(s.redirectUri) + '">Copy</button></p>' +
          '<p class="fd-small">Step 2: paste the Client ID and Client secret here. The secret is stored encrypted and never shown again.</p>' +
          '<form class="fd-form settings-form" id="gm-config">' + input("clientId", "Client ID", "text", "", 'required autocomplete="off"') + input("clientSecret", "Client secret", "password", "", 'required autocomplete="off"') +
          '<div class="fd-wide"><button type="submit" class="btn">Save</button> <span class="form-msg" role="status"></span></div></form>';
      } else {
        h += '<p class="fd-small">Google app set up (' + esc(s.clientId.slice(0, 14)) + '&hellip;). Redirect address: <code class="ct-code">' + esc(s.redirectUri) + "</code></p>";
        if (s.accounts.length) {
          h += '<ul class="fd-list">' + s.accounts.map(function (a) {
            return "<li><span><strong>" + esc(a.email) + '</strong><br><span class="fd-small fd-dim">connected ' + esc(fmtDate(a.connectedAt)) + (a.sendAs.length > 1 ? " &middot; can send as " + a.sendAs.map(function (x) { return esc(x.email); }).join(", ") : "") + '</span></span><span><button type="button" class="btn secondary fd-sm" data-gm-disconnect="' + esc(a.email) + '">Disconnect</button></span></li>';
          }).join("") + "</ul>";
          var choices = [];
          s.accounts.forEach(function (a) {
            var addrs = [a.email].concat(a.sendAs.map(function (x) { return x.email; }).filter(function (e) { return e !== a.email; }));
            addrs.forEach(function (e) { choices.push({ account: a.email, from: e }); });
          });
          var cur = s.default || {};
          h += '<form class="fd-form settings-form" id="gm-default"><label class="fd-wide">Send approved messages from<select name="pick">' + choices.map(function (c) {
            var v = c.account + "|" + c.from; return opt(v, c.from + (c.from !== c.account ? " (through " + c.account + ")" : ""), (cur.account || "") + "|" + (cur.from || ""));
          }).join("") + '</select></label><div class="fd-wide"><button type="submit" class="btn">Use this address</button> <span class="form-msg" role="status"></span></div></form>';
        } else h += '<p class="fd-small">No account connected yet.</p>';
        h += '<p><a class="btn" href="/oauth/google/start">' + (s.accounts.length ? "Connect another Google account" : "Connect a Google account") + "</a></p>" +
          '<p class="fd-small fd-dim">To send from a business address that isn\'t its own Google account, add it in Gmail under Settings &rarr; Accounts &rarr; "Send mail as", then disconnect and connect again so it shows up here.</p>' +
          '<details><summary class="fd-small">Replace the Google app keys</summary><form class="fd-form settings-form" id="gm-config">' + input("clientId", "Client ID", "text", "", 'required autocomplete="off"') + input("clientSecret", "Client secret", "password", "", 'required autocomplete="off"') + '<div class="fd-wide"><button type="submit" class="btn secondary">Replace</button> <span class="form-msg" role="status"></span></div></form></details>';
      }
      body.innerHTML = h;
    }).catch(function (e) { body.innerHTML = '<p class="fd-small">' + esc(e.message) + "</p>"; });
  }
  document.addEventListener("click", function (e) {
    var b;
    if (e.target.closest('.rail-btn[data-view="settings"], [data-view-btn="settings"], #open-settings-btn')) setTimeout(gmailCard, 30);
    if ((b = e.target.closest("[data-gm-copy]"))) { try { navigator.clipboard.writeText(b.getAttribute("data-gm-copy")); toast("Copied."); } catch (x) {} }
    if ((b = e.target.closest("[data-gm-disconnect]"))) {
      var a = b.getAttribute("data-gm-disconnect");
      if (!window.confirm("Disconnect " + a + "? Messages will go back to opening in your email program until you connect again.")) return;
      api("/api/gmail/disconnect", { method: "POST", body: { account: a } }).then(function () { toast("Disconnected."); gmailCard(); }).catch(function (err) { toast(err.message); });
    }
  });
  document.addEventListener("submit", function (e) {
    var f = e.target, msg;
    if (f.id === "gm-config") {
      e.preventDefault(); msg = f.querySelector(".form-msg");
      api("/api/gmail/config", { method: "POST", body: formData(f) }).then(function () { toast("Saved. Now connect a Google account."); gmailCard(); }).catch(function (err) { msg.textContent = err.message; });
    }
    if (f.id === "gm-default") {
      e.preventDefault(); msg = f.querySelector(".form-msg"); var p = formData(f).pick.split("|");
      api("/api/gmail/default", { method: "POST", body: { account: p[0], from: p[1] } }).then(function () { msg.textContent = "Saved."; }).catch(function (err) { msg.textContent = err.message; });
    }
  });
  (function () {
    var q = new URLSearchParams(window.location.search).get("gmail");
    if (q == null) { var sv = document.querySelector('.view[data-view="settings"]'); if (sv && !sv.hidden) gmailCard(); return; }
    history.replaceState(null, "", window.location.pathname);
    toast(/^connected /.test(q) ? "Gmail " + q + ". Approved messages will go out from it." : q === "cancelled" ? "Gmail connection cancelled." : "Gmail: " + q);
    var sb = document.getElementById("open-settings-btn");
    if (sb) sb.click(); else setTimeout(gmailCard, 50);
    setTimeout(gmailCard, 80);
  })();
})();
