// ---------- InstitutionalOS embed + two-way sync with Prospecting ----------
// The nav button below opens InstitutionalOS's live scorecard in an iframe.
// A finished score there gets posted back here (via postMessage, checked
// against InstitutionalOS's own origin) and saved as a new Prospecting
// record through the same /api/prospects endpoint the rest of the app uses.
(function(){
  var IOS_ORIGIN = "https://grantpass-landing.onrender.com";
  var btn = document.querySelector('#app-nav .rail-btn[data-view="institutionalos"]');
  var frame = document.getElementById("ios-frame");
  var note = document.getElementById("ios-sync-note");
  if (!btn || !frame) return;

  function loadFrame(prefill){
    var url = new URL(IOS_ORIGIN + "/");
    url.searchParams.set("fios", "1");
    if (prefill && prefill.org) url.searchParams.set("org", prefill.org);
    if (prefill && prefill.description) url.searchParams.set("prefill", prefill.description);
    if (prefill && prefill.pipelineId) url.searchParams.set("pipeline_id", prefill.pipelineId);
    url.hash = "demo";
    frame.src = url.toString();
  }

  // Exposed for a future "Score in InstitutionalOS" action on an existing
  // Prospecting/Pipeline row: window.openInstitutionalOS({org, description,
  // pipelineId}) opens this view pre-filled with that record instead of a
  // blank scorer. Not wired to a specific row yet.
  window.openInstitutionalOS = function(prefill){
    loadFrame(prefill);
    btn.click();
  };

  btn.addEventListener("click", function(){
    if (!frame.src || frame.src === "about:blank") loadFrame();
  });

  window.addEventListener("message", function(ev){
    if (ev.origin !== IOS_ORIGIN) return;
    var data = ev.data;
    if (!data || data.type !== "institutionalos-score") return;

    fetch("/api/prospects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        org: data.org || "",
        source: "InstitutionalOS score",
        status: "new",
        notes: "InstitutionalOS " + (data.stage || "") + " score: " + data.overall + " (" + data.status + ")."
      })
    })
      .then(function(r){ return r.json(); })
      .then(function(){
        if (!note) return;
        note.hidden = false;
        note.textContent = 'Added "' + (data.org || "this organization") + '" to Prospecting. Score ' + data.overall + " (" + data.status + ").";
      })
      .catch(function(err){
        if (!note) return;
        note.hidden = false;
        note.textContent = "Scored, but couldn't sync to Prospecting: " + err.message;
      });
  });
})();
