/* Client workspace, Franklin's side (Pipeline & Money → Workspace on a deal).
   Private links for the client's people, the conversation the client sees,
   which projects they see, a preview, and the outcomes report.
   Server side: clientspace.js. */
(function () {
  "use strict";
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function api(url, opts) {
    opts = opts || {};
    if (opts.body && typeof opts.body !== "string") { opts.headers = { "Content-Type": "application/json" }; opts.body = JSON.stringify(opts.body); }
    return fetch(url, Object.assign({ credentials: "same-origin", cache: "no-store" }, opts)).then(function (res) {
      if (res.status === 401) { window.location.href = "/"; throw new Error("not signed in"); }
      return res.json().catch(function () { return {}; }).then(function (b) { if (!res.ok) throw new Error(b.error || ("request failed: " + res.status)); return b; });
    });
  }
  function when(s) { var d = new Date(s); return isNaN(d) ? "" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
  function board() { return document.body.classList.contains("role-board"); }
  function toast(t) { var b = document.getElementById("fd-toast"); if (!b) { b = document.createElement("div"); b.id = "fd-toast"; b.className = "fd-toast"; b.setAttribute("role", "status"); document.body.appendChild(b); } b.textContent = t; b.hidden = false; clearTimeout(b._t); b._t = setTimeout(function () { b.hidden = true; }, 5000); }

  var DEAL = "", FRESH = null, REPLY = "";
  function show() {
    document.querySelectorAll(".view").forEach(function (v) { v.hidden = v.getAttribute("data-view") !== "deal"; });
    document.querySelectorAll("#app-nav .rail-btn").forEach(function (b) { b.classList.toggle("is-active", b.getAttribute("data-view") === "practice"); });
    window.scrollTo(0, 0);
  }
  function open(id) { DEAL = id; FRESH = null; REPLY = ""; show(); document.getElementById("deal-panel").innerHTML = '<p class="load-note">Loading...</p>'; load(); }
  function load() {
    var id = DEAL;
    Promise.all([api("/api/clients/" + encodeURIComponent(id) + "/workspace"), api("/api/clients/" + encodeURIComponent(id) + "/access")]).then(function (r) {
      if (id !== DEAL) return;
      render(r[0], r[1].links.filter(function (l) { return !l.revoked_at; }));
    }).catch(function (e) { document.getElementById("deal-panel").innerHTML = '<p>' + esc(e.message) + "</p>"; });
  }
  function render(w, links) {
    var ro = board(), pre = "/client-preview/" + encodeURIComponent(DEAL);
    var roots = w.messages.filter(function (m) { return !m.parent; });
    function msg(m, reply) {
      return '<div class="cw-msg' + (reply ? " cw-reply" : "") + '" style="padding:8px 0;border-bottom:1px solid var(--line, #e6e1d6)' + (reply ? ";margin-left:22px" : "") + '"><strong>' + esc(m.from) + "</strong>" + (m.team ? "" : ' <span class="pill gold">Client</span>') +
        ' <span class="fd-small fd-dim">' + esc(when(m.at)) + "</span>" + (m.decision ? ' <span class="pill good">Decision</span>' : "") +
        '<div style="white-space:pre-wrap;margin-top:3px">' + (m.deleted ? '<span class="fd-dim">Message removed</span>' : esc(m.text)) + "</div>" +
        (ro || m.deleted ? "" : '<div class="fd-small">' + (reply ? "" : '<button type="button" class="btn secondary fd-sm cw-replyto" data-id="' + esc(m.id) + '">Reply</button> ') + '<button type="button" class="btn secondary fd-sm cw-decide" data-id="' + esc(m.id) + '">' + (m.decision ? "Not the decision" : "Mark as the decision") + "</button></div>") + "</div>";
    }
    var h = '<div class="fd-toolbar"><button type="button" class="btn secondary" data-go-view="practice">&larr; Pipeline &amp; Money</button></div>' +
      '<div class="view-head"><h2>' + esc(w.org) + '</h2><span class="tag">Client workspace</span></div>' +
      '<p class="view-intro">Through a private link, ' + esc(w.org) + " sees its plan's progress, the projects you share, the conversation below and its outcomes. No account or password; revoke a link any time. Your team's own discussion about this client stays private.</p>" +
      '<p><a class="btn" href="' + pre + '" target="_blank" rel="noopener">Preview what they see</a> <a class="btn secondary" href="' + pre + '#outcomes" target="_blank" rel="noopener">Outcomes report</a></p>';
    // links
    h += '<div class="fw-card"><h3>People with a link</h3>' +
      (FRESH ? '<div class="lb-note" style="padding:10px;margin-bottom:10px"><strong>Link for ' + esc(FRESH.name) + ". Copy it now; it isn't shown again.</strong>" +
        '<p style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 0"><input readonly id="cw-url" aria-label="Workspace link" value="' + esc(FRESH.url) + '" style="flex:1;min-width:220px"> <button type="button" class="btn cw-copy">Copy</button>' +
        (FRESH.email ? ' <a class="btn secondary" href="mailto:' + esc(FRESH.email) + "?subject=" + encodeURIComponent("Your workspace with Frankly Inspired") + "&body=" + encodeURIComponent("Hi " + FRESH.name.split(" ")[0] + ",\n\nHere is your private workspace for our work together. It shows your plan's progress, the work in motion, our decisions and your outcomes, and you can message us there:\n\n" + FRESH.url + "\n\nPlease keep the link to yourself; anyone with it can see the workspace.") + '">Email it</a>' : "") + "</p></div>" : "") +
      (links.length ? links.map(function (l) {
        return '<div class="fd-row" style="justify-content:space-between;border-bottom:1px solid var(--line, #e6e1d6);padding:5px 0"><span><strong>' + esc(l.name) + "</strong>" + (l.email ? " &middot; " + esc(l.email) : "") +
          ' &middot; <span class="fd-dim fd-small">' + (l.last_seen_at ? "last opened " + esc(when(l.last_seen_at)) : "not opened yet") + "</span></span>" +
          (ro ? "" : '<button type="button" class="btn danger fd-sm cw-revoke" data-id="' + esc(l.id) + '">Revoke</button>') + "</div>";
      }).join("") : '<p class="fd-small fd-dim">No links yet.</p>') +
      (ro ? "" : '<form id="cw-new" class="fd-form" style="margin-top:10px"><label>Name<input name="name" required placeholder="e.g. their executive director"></label><label>Email (optional)<input name="email" type="email"></label><p class="fd-wide"><button type="submit" class="btn">Make a link</button></p></form>') + "</div>";
    // projects
    h += '<div class="fw-card"><h3>Projects they see</h3>' + (w.projects.length ? w.projects.map(function (p) { return "<div>" + esc(p.name) + ' <span class="fd-small fd-dim">' + p.done + " of " + p.total + " done</span></div>"; }).join("") : '<p class="fd-small fd-dim">None yet.</p>') +
      '<p class="fd-small fd-dim">' + (w.hiddenProjects ? w.hiddenProjects + " linked project" + (w.hiddenProjects === 1 ? " is" : "s are") + " hidden from them. " : "") + 'Link a project to this client in Projects &amp; Team (project settings); untick "they see this project" there to keep one private.</p></div>';
    // conversation
    h += '<div class="fw-card"><h3>Conversation with the client</h3><p class="fd-small fd-dim">They see every message here. Mark the ones that settle something as the decision; decisions go into the outcomes report.</p>' +
      (roots.length ? roots.map(function (m) { return msg(m, false) + w.messages.filter(function (r) { return r.parent === m.id; }).map(function (r) { return msg(r, true); }).join(""); }).join("") : '<p class="fd-small fd-dim">No messages yet.</p>') +
      (ro ? "" : '<form id="cw-say" class="fd-form" style="margin-top:10px"><label class="fd-wide">' + (REPLY ? 'Reply <button type="button" class="btn secondary fd-sm cw-replyto" data-id="">cancel</button>' : "Write to " + esc(w.org)) + '<textarea name="text" rows="3" required></textarea></label><p class="fd-wide"><button type="submit" class="btn">Send</button></p></form>') + "</div>";
    document.getElementById("deal-panel").innerHTML = h;
  }

  document.addEventListener("click", function (e) {
    var b;
    if ((b = e.target.closest(".cw-open"))) { e.preventDefault(); open(b.getAttribute("data-deal")); return; }
    if (!DEAL || !e.target.closest("#deal-panel")) return;
    if ((b = e.target.closest(".cw-copy"))) { var u = document.getElementById("cw-url"); if (navigator.clipboard) navigator.clipboard.writeText(u.value).then(function () { b.textContent = "Copied"; }); else { u.select(); } return; }
    if ((b = e.target.closest(".cw-replyto"))) { REPLY = b.getAttribute("data-id"); load(); return; }
    if ((b = e.target.closest(".cw-revoke"))) {
      if (!confirm("Revoke this link? It stops working right away.")) return;
      api("/api/clients/access/" + encodeURIComponent(b.getAttribute("data-id")), { method: "DELETE" }).then(function () { toast("Link revoked."); load(); }).catch(function (x) { toast(x.message); });
      return;
    }
    if ((b = e.target.closest(".cw-decide"))) {
      api("/api/clients/" + encodeURIComponent(DEAL) + "/message", { method: "POST", body: { decide: b.getAttribute("data-id") } }).then(load).catch(function (x) { toast(x.message); });
    }
  });
  document.addEventListener("submit", function (e) {
    var f = e.target;
    if (f.id === "cw-new") {
      e.preventDefault();
      var name = f.elements.name.value.trim(), email = f.elements.email.value.trim();
      api("/api/clients/" + encodeURIComponent(DEAL) + "/access", { method: "POST", body: { name: name, email: email } }).then(function (r) { FRESH = { name: name, email: email, url: r.url }; load(); }).catch(function (x) { toast(x.message); });
    }
    if (f.id === "cw-say") {
      e.preventDefault();
      var btn = f.querySelector("button[type=submit]"); btn.disabled = true;
      api("/api/clients/" + encodeURIComponent(DEAL) + "/message", { method: "POST", body: { text: f.elements.text.value, parent: REPLY } }).then(function () { REPLY = ""; load(); }).catch(function (x) { btn.disabled = false; toast(x.message); });
    }
  });
  // Opened from a notice in Projects & Team: /?workspace=<deal>
  var q = new URLSearchParams(location.search).get("workspace");
  if (q) { history.replaceState(null, "", location.pathname); setTimeout(function () { open(q); }, 600); }
})();
