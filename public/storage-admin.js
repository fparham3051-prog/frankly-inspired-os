/* Settings > Storage (owner). Server side: storage.js. */
(function () {
  "use strict";
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function api(u, o) { o = o || {}; if (o.body) { o.headers = { "Content-Type": "application/json" }; o.body = JSON.stringify(o.body); } return fetch(u, Object.assign({ credentials: "same-origin", cache: "no-store" }, o)).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "failed"); return j; }); }); }
  var M = null, NOTE = "", Y = new Date().getFullYear() - 1, PREV = null;
  function card() {
    var host = document.querySelector('[data-view="settings"]'); if (!host || !document.body.classList.contains("role-owner")) return null;
    var el = document.getElementById("storage-card");
    if (!el) { el = document.createElement("div"); el.className = "fw-card"; el.id = "storage-card"; host.appendChild(el); }
    return el;
  }
  function render() {
    var el = card(); if (!el || !M) return;
    var col = M.pct >= 90 ? "#c0392b" : M.pct >= 70 ? "#d9822b" : "#2c7a57";
    var years = []; for (var y = new Date().getFullYear(); y >= new Date().getFullYear() - 8; y--) years.push(y);
    el.innerHTML = '<h3>Storage</h3>' +
      '<p class="view-intro">How full the database is, where attachments live, and a yearly archive of finished work. At 70% full, the morning brief says so.</p>' +
      '<p><strong>' + M.usedMb + ' MB</strong> of ' + M.planMb + ' MB (' + M.pct + '%)</p>' +
      '<div style="height:10px;background:rgba(255,255,255,.12);border-radius:6px;overflow:hidden;max-width:520px"><i style="display:block;height:100%;width:' + Math.min(100, M.pct) + '%;background:' + col + '"></i></div>' +
      '<details style="margin:8px 0"><summary class="fd-small">Largest parts</summary><ul class="fd-small">' + M.tables.map(function (t) { return "<li>" + esc(t.name) + ": " + t.mb + " MB, about " + t.rows + " rows</li>"; }).join("") + '</ul></details>' +
      '<form id="st-plan" class="settings-form"><label>Your database plan\'s size (MB)<input type="number" min="100" name="planMb" value="' + M.planMb + '"></label><button class="btn secondary" type="submit">Save</button></form>' +
      '<h4 class="settings-h4">Attachments</h4>' +
      '<p class="fd-small">' + M.files.inDrive + " in Google Drive, " + M.files.inDatabase + " in the database (" + M.files.inDatabaseMb + " MB). " +
      (M.driveAccount ? "New attachments go to a Drive folder in " + esc(M.driveAccount) + "'s Drive, so they don't fill the database." : "Connect a Google account (Connected email, above) and new attachments go to Google Drive instead of the database.") + "</p>" +
      (M.driveAccount ? '<label class="fd-small"><input type="checkbox" id="st-drive" ' + (M.filesInDrive ? "checked" : "") + '> Save new attachments to Google Drive</label>' +
        (M.files.inDatabase ? ' <button class="btn secondary fd-sm" id="st-move" type="button">Move ' + M.files.inDatabase + " file" + (M.files.inDatabase === 1 ? "" : "s") + " to Drive</button>" : "") : "") +
      '<h4 class="settings-h4">Yearly archive</h4>' +
      '<p class="fd-small">One file per year with everything finished that year: closed projects with their tasks and messages, paid invoices and closed pipeline records. Keep it with your records. After downloading, you can trim that year\'s project history from the live system; invoices and client records always stay.</p>' +
      '<p><select id="st-year" aria-label="Year">' + years.map(function (y) { return '<option ' + (y === Y ? "selected" : "") + ">" + y + "</option>"; }).join("") + '</select> ' +
      '<a class="btn secondary fd-sm" id="st-dl" href="/api/settings/archive?year=' + Y + '">Download ' + Y + "</a> " +
      (Y < new Date().getFullYear() - 1 ? '<button type="button" class="btn danger fd-sm" id="st-trim">Trim ' + Y + "…</button>" : "") + "</p>" +
      (PREV ? '<p class="fd-small fd-dim">' + Y + ": " + PREV.projects + " closed projects, " + PREV.tasks + " tasks, " + PREV.messages + " messages, " + PREV.paidInvoices + " paid invoices, " + PREV.closedPipeline + " closed pipeline records.</p>" : "") +
      (NOTE ? '<p class="form-msg" role="status">' + esc(NOTE) + "</p>" : "");
  }
  function preview() { PREV = null; api("/api/settings/archive?preview=1&year=" + Y).then(function (j) { PREV = j.counts; render(); }).catch(function () {}); }
  function load() { api("/api/settings/storage").then(function (j) { M = j; render(); preview(); }).catch(function () {}); }
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (t.id === "st-move") { t.disabled = true; NOTE = "Moving…"; render(); (function step() { api("/api/settings/storage/move-files", { method: "POST", body: {} }).then(function (j) { NOTE = j.error || ((j.errors && j.errors.length) ? "Stopped: " + j.errors[0] : j.left ? "Moved " + j.moved + ", " + j.left + " to go…" : "All attachments are in Google Drive."); if (j.left && j.moved && !(j.errors && j.errors.length)) { render(); step(); } else load(); }).catch(function (x) { NOTE = x.message; load(); }); })(); }
    if (t.id === "st-trim") {
      var c = prompt("This removes " + Y + "'s closed projects, their tasks and messages from the live system. Download the archive first. Type DELETE " + Y + " to confirm."); if (!c) return;
      api("/api/settings/archive/trim", { method: "POST", body: { year: Y, confirm: c } }).then(function (j) { NOTE = "Removed " + j.removed.projects + " projects, " + j.removed.tasks + " tasks and " + j.removed.messages + " messages from " + Y + "."; load(); }).catch(function (x) { NOTE = x.message; render(); });
    }
  });
  document.addEventListener("change", function (e) {
    if (e.target.id === "st-drive") api("/api/settings/storage", { method: "POST", body: { filesInDrive: e.target.checked } }).then(function (j) { M = j; NOTE = e.target.checked ? "New attachments go to Google Drive." : "New attachments stay in the database."; render(); });
    if (e.target.id === "st-year") { Y = Number(e.target.value); render(); preview(); }
  });
  document.addEventListener("submit", function (e) {
    if (e.target.id !== "st-plan") return; e.preventDefault();
    api("/api/settings/storage", { method: "POST", body: { planMb: Number(e.target.elements.planMb.value) } }).then(function (j) { M = j; NOTE = "Saved."; render(); }).catch(function (x) { NOTE = x.message; render(); });
  });
  // Load whenever Settings is opened.
  var sv = document.querySelector('section.view[data-view="settings"]');
  if (sv) { new MutationObserver(function () { if (!sv.hidden) load(); }).observe(sv, { attributes: true, attributeFilter: ["hidden"] }); if (!sv.hidden) load(); }
})();
