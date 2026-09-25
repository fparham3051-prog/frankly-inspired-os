(function(){
  "use strict";

  // Standalone on purpose: this page is never behind the login, so it never
  // loads app.js (which the server won't even serve without a session
  // cookie - see /app.js in server.js). Everything this page needs is
  // duplicated here in miniature rather than shared, so a future change to
  // the internal app can never accidentally change what a client sees on
  // their own private link.

  function esc(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c];
    });
  }
  function fmtDate(s){
    if(!s) return "";
    var d = new Date(s + (String(s).length <= 10 ? "T00:00:00" : ""));
    if(isNaN(d.getTime())) return esc(s);
    return d.toLocaleDateString(undefined, {month:"short", day:"numeric", year:"numeric"});
  }

  var MODULE_STATUS_LABELS = { "not-started": "Not Started", "scheduled": "Scheduled", "complete": "Complete" };

  function idFromPath(){
    var m = String(location.pathname).match(/\/delivery-status\/([^/]+)/);
    return m ? m[1] : "";
  }

  function notFound(){
    document.getElementById("ds-load-note").textContent = "This link isn’t active. Please check the link or reach out to Frankly Inspired and Associates directly.";
  }

  function render(data){
    var noteEl = document.getElementById("ds-load-note");
    var cardEl = document.getElementById("ds-card");
    var modulesCardEl = document.getElementById("ds-modules-card");
    var listEl = document.getElementById("ds-module-list");

    var eng = data.engagement || {};
    var mods = data.modules || [];

    document.getElementById("ds-title").textContent = eng.org ? (eng.org + " — Delivery Status") : "Delivery Status";
    document.getElementById("ds-dek").textContent = "Where this engagement stands right now — updated as sessions happen, no login needed. This link is specific to your engagement and isn’t shared with anyone else.";

    var complete = mods.filter(function(m){ return m.status === "complete"; }).length;
    var pct = mods.length ? Math.round((complete / mods.length) * 100) : 0;

    document.getElementById("ds-progress-count").textContent = complete + " of " + mods.length + " modules complete";
    document.getElementById("ds-progress-fill").style.width = pct + "%";

    var nextEl = document.getElementById("ds-next-session");
    if(data.nextSessionDate){
      nextEl.textContent = "Next session: " + fmtDate(data.nextSessionDate);
    } else {
      nextEl.textContent = "No upcoming session scheduled yet.";
    }

    if(mods.length){
      listEl.innerHTML = mods.map(function(m){
        var statusClass = m.status === "complete" ? "pill gold" : "pill";
        return '<li><span>' + esc(m.moduleName) + '</span><span class="' + statusClass + '">' +
          esc(MODULE_STATUS_LABELS[m.status] || m.status) + '</span></li>';
      }).join("");
      modulesCardEl.hidden = false;
    } else {
      modulesCardEl.hidden = true;
    }

    noteEl.hidden = true;
    cardEl.hidden = false;
  }

  var id = idFromPath();
  if(!id){
    notFound();
  } else {
    fetch("/api/public/delivery-status/" + encodeURIComponent(id))
      .then(function(r){
        if(r.status === 404) { notFound(); return null; }
        if(!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function(data){ if(data) render(data); })
      .catch(function(err){
        document.getElementById("ds-load-note").textContent = "Could not load this page right now. Please try again shortly.";
        console.error(err);
      });
  }
})();
