/* Setup checklist on Today, for a new organization's copy (server: setup.js).
   Frankly Inspired's own copy gets {show:false} and nothing appears. */
(function () {
  "use strict";
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function api(u, o) { o = o || {}; if (o.body) { o.headers = { "Content-Type": "application/json" }; o.body = JSON.stringify(o.body); } return fetch(u, Object.assign({ credentials: "same-origin", cache: "no-store" }, o)).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "failed"); return j; }); }); }
  var last = 0;
  function draw() {
    if (Date.now() - last < 30000) return; last = Date.now();
    var anchor = document.getElementById("start-day"); if (!anchor) return;
    api("/api/setup").then(function (s) {
      var el = document.getElementById("setup-checklist");
      if (!s.show) { if (el) el.remove(); return; }
      if (!el) { el = document.createElement("div"); el.id = "setup-checklist"; el.className = "fw-card"; anchor.parentNode.insertBefore(el, anchor); }
      el.innerHTML = '<div class="fd-row" style="justify-content:space-between"><h3 style="margin:0">Set up your system</h3><span class="fd-small fd-dim">' + s.done + " of " + s.items.length + " done</span></div>" +
        '<ol style="margin:10px 0 6px;padding-left:20px">' + s.items.map(function (x) {
          return '<li style="margin:6px 0' + (x.done ? ";opacity:.6" : "") + '"><strong>' + (x.done ? "✓ " : "") + esc(x.label) + "</strong>" + (x.done ? "" : '<br><span class="fd-small fd-dim">' + esc(x.help) + "</span>" + (x.go ? ' <a href="#" class="fd-small" data-go-view="' + esc(x.go) + '" data-setup="' + esc(x.key) + '">Go there</a>' : "")) + "</li>";
        }).join("") + "</ol>" +
        '<p class="fd-small fd-dim" style="margin:0"><a href="' + esc(s.guide) + '" target="_blank" rel="noopener">Setup guide</a> · <a href="#" id="setup-hide">Hide this list</a></p>';
    }).catch(function () {});
  }
  document.addEventListener("click", function (e) {
    var a = e.target.closest("[data-setup]"); if (a && a.getAttribute("data-setup") === "library") api("/api/setup/seen", { method: "POST", body: { key: "library" } }).catch(function () {});
    if (e.target.id === "setup-hide") { e.preventDefault(); if (!confirm("Hide the setup list? You can still follow the setup guide.")) return; api("/api/settings/setup-dismiss", { method: "POST", body: {} }).then(function () { var el = document.getElementById("setup-checklist"); if (el) el.remove(); }); }
  });
  document.addEventListener("visibilitychange", function () { if (!document.hidden) { last = 0; draw(); } });
  setTimeout(draw, 800); setInterval(draw, 60000);
})();
