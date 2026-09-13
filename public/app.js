(function(){
  "use strict";

  function esc(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c];
    });
  }
  function fmtDate(s){
    if(!s) return "";
    var d = new Date(s + (s.length <= 10 ? "T00:00:00" : ""));
    if(isNaN(d.getTime())) return esc(s);
    return d.toLocaleDateString(undefined, {month:"short", day:"numeric", year:"numeric"});
  }
  function currentQuarterLabel(){
    var d = new Date();
    var q = Math.floor(d.getMonth()/3) + 1;
    return "Q" + q + " " + d.getFullYear();
  }
  function todayStr(){
    return new Date().toISOString().slice(0,10);
  }
  // A pipeline record is overdue when it has a next-step date, is not in a
  // closed stage, and that date has already passed. ISO date strings
  // (YYYY-MM-DD, what the <input type="date"> fields produce) compare
  // correctly with a plain string comparison.
  function isOverduePipeline(p){
    return !!(p.nextStepDate && !CLOSED_STAGES[p.stage] && p.nextStepDate < todayStr());
  }

  var STAGE_LABELS = {lead:"Lead", discovery:"Discovery Call", assessment:"InstitutionalOS Assessment", engaged:"Engaged", graduated:"Graduated", referred:"Referred Out", lost:"Lost, No Fit"};
  var TRACK_LABELS = {undecided:"Undecided", coaching:"Coaching", consulting:"Project Consulting", institutionalos:"InstitutionalOS Assessment"};
  var CLOSED_STAGES = {graduated:1, referred:1, lost:1};

  // A small status-health dot, generalizing the overdue highlighting into a
  // glance indicator used on Pipeline rows, Prospecting rows, and the
  // Dashboard next-actions list. Returns "" for records that don't need one
  // (closed pipeline stages).
  function dotHtml(kind){
    return kind ? '<span class="status-dot dot-' + kind + '"></span>' : "";
  }
  function pipelineHealth(p){
    if(CLOSED_STAGES[p.stage]) return null;
    if(!p.nextStepDate) return "neutral";
    var today = todayStr();
    if(p.nextStepDate < today) return "warn";
    var days = Math.round((new Date(p.nextStepDate) - new Date(today)) / 86400000);
    return days <= 3 ? "attn" : "good";
  }
  function prospectHealth(p){
    if(p.status === "not-fit") return "neutral";
    if(p.status === "responded" || p.status === "meeting") return "good";
    if(p.status === "new"){
      var created = (p.createdAt || "").slice(0,10);
      var days = created ? (new Date(todayStr()) - new Date(created)) / 86400000 : 0;
      return days > 7 ? "warn" : "neutral";
    }
    return "attn"; // researching, contacted
  }

  var state = { pipeline:[], scorecard:[], issues:[], rocks:[], prospects:[], digest:[], vision:null, ready:false };
  var pipelineFilter = "all";
  var issueFilter = "all";
  var apiReady = false;

  var PROSPECT_STATUS_LABELS = {"new":"New", researching:"Researching", contacted:"Contacted", responded:"Responded", meeting:"Meeting booked", "not-fit":"Not a fit"};
  var PROSPECT_SOURCE_LABELS = {linkedin:"LinkedIn", referral:"Referral", conference:"Conference / event", warm:"Warm network", inbound:"Inbound", other:"Other"};

  // ---------- nav ----------
  var navButtons = document.querySelectorAll("#app-nav .rail-btn");
  var views = document.querySelectorAll(".view");
  navButtons.forEach(function(btn){
    btn.addEventListener("click", function(){
      navButtons.forEach(function(b){ b.classList.remove("is-active"); });
      btn.classList.add("is-active");
      var target = btn.getAttribute("data-view");
      views.forEach(function(v){ v.hidden = (v.getAttribute("data-view") !== target); });
      if(target !== "fieldintel") stopReadAloud();
    });
  });

  // ---------- logout ----------
  var logoutBtn = document.getElementById("logout-btn");
  if(logoutBtn){
    logoutBtn.addEventListener("click", function(){
      fetch("/api/logout", { method: "POST" }).then(function(){
        window.location.href = "/";
      }).catch(function(){
        window.location.href = "/";
      });
    });
  }

  // ---------- daily briefing ----------
  function generateBriefing(){
    var lines = [];
    var today = new Date();
    var greeting = today.getHours() < 12 ? "Good morning." : (today.getHours() < 17 ? "Good afternoon." : "Good evening.");

    var openPipeline = state.pipeline.filter(function(p){ return !CLOSED_STAGES[p.stage]; });
    var dueSoon = openPipeline
      .filter(function(p){ return p.nextStepDate; })
      .sort(function(a,b){ return (a.nextStepDate || "").localeCompare(b.nextStepDate || ""); });
    var pipelineSentence = openPipeline.length === 0
      ? "The pipeline is empty right now, no active records."
      : (openPipeline.length + " active pipeline record" + (openPipeline.length === 1 ? "" : "s") + (dueSoon.length
          ? ". The nearest next step is " + esc(dueSoon[0].nextStep || "a next step") + " with " + esc(dueSoon[0].name || "an unnamed contact") + " on " + fmtDate(dueSoon[0].nextStepDate) + "."
          : ", none with a next step date set."));
    lines.push(greeting + " " + pipelineSentence);

    var openIssues = state.issues.filter(function(i){ return i.status !== "solved"; })
      .sort(function(a,b){ return (a.createdAt || "").localeCompare(b.createdAt || ""); });
    var issuesSentence = openIssues.length === 0
      ? "No open issues on the list."
      : (openIssues.length + " open issue" + (openIssues.length === 1 ? "" : "s") + ", the oldest is “" + esc(openIssues[0].title || "untitled") + "”.");
    lines.push(issuesSentence);

    var offTrackRocks = state.rocks.filter(function(r){ return r.status === "off-track"; });
    var onTrackRocks = state.rocks.filter(function(r){ return r.status === "on-track"; });
    var rocksSentence;
    if(state.rocks.length === 0){
      rocksSentence = "No priorities logged for this quarter yet.";
    } else if(offTrackRocks.length > 0){
      rocksSentence = offTrackRocks.length + " of this quarter's priorities " + (offTrackRocks.length === 1 ? "is" : "are") + " off track, starting with “" + esc(offTrackRocks[0].title || "untitled") + "”.";
    } else {
      rocksSentence = onTrackRocks.length + " of this quarter's priorities on track, none flagged off track.";
    }
    lines.push(rocksSentence);

    var weeks = state.scorecard.slice().sort(function(a,b){ return (a.weekOf || "").localeCompare(b.weekOf || ""); });
    var scorecardSentence;
    if(weeks.length === 0){
      scorecardSentence = "No scorecard weeks logged yet, log this week's numbers to start tracking trend.";
    } else {
      var latest = weeks[weeks.length - 1];
      var prev = weeks.length > 1 ? weeks[weeks.length - 2] : null;
      scorecardSentence = "Last logged week: " + esc(latest.calls || 0) + " discovery calls and " + esc(latest.leads || 0) + " new leads.";
      if(prev){
        var callsDelta = Number(latest.calls || 0) - Number(prev.calls || 0);
        var leadsDelta = Number(latest.leads || 0) - Number(prev.leads || 0);
        scorecardSentence += " That is " + (callsDelta >= 0 ? "up " + callsDelta : "down " + Math.abs(callsDelta)) + " call" + (Math.abs(callsDelta) === 1 ? "" : "s") + " and " + (leadsDelta >= 0 ? "up " + leadsDelta : "down " + Math.abs(leadsDelta)) + " lead" + (Math.abs(leadsDelta) === 1 ? "" : "s") + " from the week before.";
      }
    }
    lines.push(scorecardSentence);

    var activeProspects = state.prospects.filter(function(p){ return p.status !== "not-fit"; });
    var prospectsSentence = activeProspects.length === 0
      ? "Nothing waiting in Prospecting."
      : (activeProspects.length + " prospect" + (activeProspects.length === 1 ? "" : "s") + " in the Prospecting list waiting on research or outreach.");
    lines.push(prospectsSentence);

    var focus = null;
    if(offTrackRocks.length > 0){
      focus = "Get “" + esc(offTrackRocks[0].title || "the off track priority") + "” back on track.";
    } else if(dueSoon.length > 0){
      focus = esc(dueSoon[0].nextStep || "Follow up") + " with " + esc(dueSoon[0].name || "the next contact") + ", due " + fmtDate(dueSoon[0].nextStepDate) + ".";
    } else if(openIssues.length > 0){
      focus = "Discuss and solve “" + esc(openIssues[0].title || "the oldest open issue") + "”.";
    } else if(activeProspects.length > 0){
      focus = "Move a prospect forward, " + activeProspects.length + " waiting.";
    }

    var plainLines = lines.map(function(html){ return html.replace(/<[^>]+>/g, "").replace(/&middot;/g, ",").replace(/&amp;/g,"&").replace(/&quot;/g,"\"").replace(/&#39;/g,"'"); });
    return { html: lines, plain: plainLines.join(" "), focus: focus };
  }

  var briefingSpeakText = "";
  function renderBriefing(){
    var b = generateBriefing();
    document.getElementById("briefing-text").innerHTML = b.html.map(function(l){ return "<p>" + l + "</p>"; }).join("");
    var focusEl = document.getElementById("briefing-focus");
    if(b.focus){
      focusEl.hidden = false;
      document.getElementById("briefing-focus-text").innerHTML = b.focus;
    } else {
      focusEl.hidden = true;
    }
    briefingSpeakText = b.plain + (b.focus ? " Today's one focus: " + b.focus.replace(/<[^>]+>/g,"") : "");
  }

  (function(){
    var speakBtn = document.getElementById("briefing-speak");
    var stopBtn = document.getElementById("briefing-stop");
    var statusEl = document.getElementById("briefing-speak-status");
    var supported = typeof window !== "undefined" && "speechSynthesis" in window;
    if(!supported){
      speakBtn.disabled = true;
      statusEl.textContent = "Read aloud is not supported in this browser.";
      return;
    }
    speakBtn.addEventListener("click", function(){
      window.speechSynthesis.cancel();
      var utter = new SpeechSynthesisUtterance(briefingSpeakText || "Nothing to read yet.");
      utter.rate = 1;
      utter.onend = function(){ stopBtn.hidden = true; speakBtn.hidden = false; };
      utter.onerror = function(){ stopBtn.hidden = true; speakBtn.hidden = false; };
      window.speechSynthesis.speak(utter);
      speakBtn.hidden = true;
      stopBtn.hidden = false;
    });
    stopBtn.addEventListener("click", function(){
      window.speechSynthesis.cancel();
      stopBtn.hidden = true;
      speakBtn.hidden = false;
    });
  })();

  // ---------- dashboard ----------
  function renderDashboard(){
    document.getElementById("stat-active").textContent = state.pipeline.filter(function(p){ return !CLOSED_STAGES[p.stage]; }).length;
    document.getElementById("stat-issues").textContent = state.issues.filter(function(i){ return i.status !== "solved"; }).length;
    document.getElementById("stat-rocks").textContent = state.rocks.filter(function(r){ return r.status === "on-track"; }).length;
    document.getElementById("stat-weeks").textContent = state.scorecard.length;

    var nextList = state.pipeline
      .filter(function(p){ return p.nextStepDate && !CLOSED_STAGES[p.stage]; })
      .sort(function(a,b){ return (a.nextStepDate || "").localeCompare(b.nextStepDate || ""); })
      .slice(0,5);
    var nextEl = document.getElementById("dashboard-next-actions");
    if(nextList.length === 0){
      nextEl.innerHTML = '<li class="empty-note" style="border:none;">Nothing scheduled yet. Add a next step and a date to any pipeline record.</li>';
    } else {
      nextEl.innerHTML = nextList.map(function(p){
        var overdue = isOverduePipeline(p);
        return '<li' + (overdue ? ' class="row-overdue"' : '') + '><span>' + dotHtml(pipelineHealth(p)) + '<span class="who">' + esc(p.name || "Untitled") + '</span> &middot; ' + esc(p.nextStep || "next step not set") + '</span><span class="when">' + fmtDate(p.nextStepDate) + (overdue ? ' <span class="overdue-tag">Overdue</span>' : '') + '</span></li>';
      }).join("");
    }

    var issueList = state.issues
      .filter(function(i){ return i.status !== "solved"; })
      .sort(function(a,b){ return (a.createdAt || "").localeCompare(b.createdAt || ""); })
      .slice(0,6);
    var issueEl = document.getElementById("dashboard-open-issues");
    if(issueList.length === 0){
      issueEl.innerHTML = '<li class="empty-note" style="border:none;">No open issues logged.</li>';
    } else {
      issueEl.innerHTML = issueList.map(function(i){
        return '<li><span class="who">' + esc(i.title || "Untitled") + '</span><span class="when">' + esc(i.status) + '</span></li>';
      }).join("");
    }
  }

  // ---------- dashboard stat tiles (clickable, jump to the relevant view) ----------
  function goToView(view){
    var btn = document.querySelector('#app-nav .rail-btn[data-view="' + view + '"]');
    if(btn) btn.click();
  }
  document.getElementById("stat-tile-active").addEventListener("click", function(){ goToView("pipeline"); });
  document.getElementById("stat-tile-rocks").addEventListener("click", function(){ goToView("rocks"); });
  document.getElementById("stat-tile-weeks").addEventListener("click", function(){ goToView("scorecard"); });
  document.getElementById("stat-tile-issues").addEventListener("click", function(){
    issueFilter = "open";
    document.querySelectorAll("#issue-filters .filter-btn").forEach(function(b){
      b.classList.toggle("is-active", b.getAttribute("data-status") === "open");
    });
    renderIssues();
    goToView("issues");
  });

  // ---------- api helpers ----------
  function apiFetch(url, opts){
    opts = opts || {};
    if(opts.body && typeof opts.body !== "string"){
      opts.headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
      opts.body = JSON.stringify(opts.body);
    }
    return fetch(url, opts).then(function(res){
      if(res.status === 401){
        window.location.href = "/";
        throw new Error("not authenticated");
      }
      if(!res.ok){
        return res.json().catch(function(){ return {}; }).then(function(body){
          throw new Error(body.error || ("request failed: " + res.status));
        });
      }
      if(res.status === 204) return {};
      return res.json().catch(function(){ return {}; });
    });
  }

  function loadState(){
    return apiFetch("/api/state").then(function(data){
      state.pipeline = data.pipeline || [];
      state.scorecard = data.scorecard || [];
      state.issues = data.issues || [];
      state.rocks = data.rocks || [];
      state.prospects = data.prospects || [];
      state.digest = data.digest || [];
      state.vision = data.vision || null;
      state.ready = true;
    });
  }

  function refreshAndRender(){
    return loadState().then(renderAll);
  }

  // ---------- pipeline ----------
  document.getElementById("pipeline-filters").addEventListener("click", function(e){
    var btn = e.target.closest(".filter-btn");
    if(!btn) return;
    pipelineFilter = btn.getAttribute("data-stage");
    this.querySelectorAll(".filter-btn").forEach(function(b){ b.classList.toggle("is-active", b === btn); });
    renderPipeline();
  });

  function renderPipeline(){
    var rows = state.pipeline.filter(function(p){ return pipelineFilter === "all" || p.stage === pipelineFilter; });
    rows = rows.slice().sort(function(a,b){ return (b.createdAt || "").localeCompare(a.createdAt || ""); });
    var body = document.getElementById("pipeline-rows");
    if(rows.length === 0){
      body.innerHTML = '<tr><td colspan="7" class="empty-note">No pipeline records in this view yet.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function(p){
      var stageOptions = Object.keys(STAGE_LABELS).map(function(k){
        return '<option value="' + k + '"' + (p.stage === k ? " selected" : "") + '>' + STAGE_LABELS[k] + '</option>';
      }).join("");
      var overdue = isOverduePipeline(p);
      return '<tr data-id="' + esc(p.id) + '"' + (overdue ? ' class="row-overdue"' : '') + '>' +
        '<td>' + dotHtml(pipelineHealth(p)) + '<strong>' + esc(p.name || "Untitled") + '</strong>' + (p.org ? '<div class="dim">' + esc(p.org) + '</div>' : '') + '</td>' +
        '<td>' + esc(TRACK_LABELS[p.track] || "Undecided") + '</td>' +
        '<td><select class="inline-select pl-stage-select">' + stageOptions + '</select></td>' +
        '<td>' + esc(p.nextStep || "") + '</td>' +
        '<td>' + fmtDate(p.nextStepDate) + (overdue ? ' <span class="overdue-tag">Overdue</span>' : '') + '</td>' +
        '<td class="dim">' + esc(p.source || "") + '</td>' +
        '<td><button type="button" class="btn danger pl-delete">Remove</button></td>' +
        '</tr>';
    }).join("");
  }

  document.getElementById("pipeline-rows").addEventListener("change", function(e){
    if(!e.target.classList.contains("pl-stage-select")) return;
    var id = e.target.closest("tr").getAttribute("data-id");
    apiFetch("/api/pipeline/" + id, { method: "PATCH", body: { stage: e.target.value } })
      .then(refreshAndRender)
      .catch(function(err){ console.error(err); });
  });
  document.getElementById("pipeline-rows").addEventListener("click", function(e){
    var btn = e.target.closest(".pl-delete");
    if(!btn) return;
    var id = btn.closest("tr").getAttribute("data-id");
    if(!confirm("Remove this pipeline record?")) return;
    apiFetch("/api/pipeline/" + id, { method: "DELETE" })
      .then(refreshAndRender)
      .catch(function(err){ console.error(err); });
  });

  document.getElementById("pipeline-form").addEventListener("submit", function(e){
    e.preventDefault();
    var statusEl = document.getElementById("pl-status");
    var name = document.getElementById("pl-name").value.trim();
    if(!name) return;
    var data = {
      name: name,
      org: document.getElementById("pl-org").value.trim(),
      source: document.getElementById("pl-source").value.trim(),
      track: document.getElementById("pl-track").value,
      stage: document.getElementById("pl-stage").value,
      nextStep: document.getElementById("pl-next").value.trim(),
      nextStepDate: document.getElementById("pl-next-date").value,
      notes: document.getElementById("pl-notes").value.trim()
    };
    apiFetch("/api/pipeline", { method: "POST", body: data }).then(function(){
      document.getElementById("pipeline-form").reset();
      document.getElementById("pl-stage").value = "lead";
      document.getElementById("pl-track").value = "undecided";
      statusEl.textContent = "Added.";
      setTimeout(function(){ statusEl.textContent = ""; }, 2200);
      return refreshAndRender();
    }).catch(function(err){ statusEl.textContent = "Could not save: " + err.message; });
  });

  // ---------- prospecting ----------
  function renderProspecting(){
    var rows = state.prospects.slice().sort(function(a,b){ return (b.createdAt || "").localeCompare(a.createdAt || ""); });
    var body = document.getElementById("prospect-rows");
    if(rows.length === 0){
      body.innerHTML = '<tr><td colspan="6" class="empty-note">No prospects logged yet.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function(p){
      var opts = Object.keys(PROSPECT_STATUS_LABELS).map(function(k){
        return '<option value="' + k + '"' + (p.status === k ? " selected" : "") + '>' + PROSPECT_STATUS_LABELS[k] + '</option>';
      }).join("");
      var nameCell = p.link
        ? '<a href="' + esc(p.link) + '" target="_blank" rel="noopener">' + esc(p.name || "Untitled") + '</a>'
        : esc(p.name || "Untitled");
      return '<tr data-id="' + esc(p.id) + '">' +
        '<td>' + dotHtml(prospectHealth(p)) + '<strong>' + nameCell + '</strong><div class="prospect-source-tag">' + esc(PROSPECT_SOURCE_LABELS[p.source] || p.source || "") + '</div></td>' +
        '<td class="dim">' + esc(p.org || "") + '</td>' +
        '<td class="dim">' + esc(PROSPECT_SOURCE_LABELS[p.source] || p.source || "") + '</td>' +
        '<td><select class="inline-select ps-stage-select">' + opts + '</select></td>' +
        '<td class="dim">' + esc(p.notes || "") + '</td>' +
        '<td><button type="button" class="btn ps-promote">Promote</button> <button type="button" class="btn danger ps-delete">Remove</button></td>' +
        '</tr>';
    }).join("");
  }
  document.getElementById("prospect-rows").addEventListener("change", function(e){
    if(!e.target.classList.contains("ps-stage-select")) return;
    var id = e.target.closest("tr").getAttribute("data-id");
    apiFetch("/api/prospects/" + id, { method: "PATCH", body: { status: e.target.value } })
      .then(refreshAndRender)
      .catch(function(err){ console.error(err); });
  });
  document.getElementById("prospect-rows").addEventListener("click", function(e){
    var delBtn = e.target.closest(".ps-delete");
    var promoteBtn = e.target.closest(".ps-promote");
    if(delBtn){
      var id = delBtn.closest("tr").getAttribute("data-id");
      if(!confirm("Remove this prospect?")) return;
      apiFetch("/api/prospects/" + id, { method: "DELETE" })
        .then(refreshAndRender)
        .catch(function(err){ console.error(err); });
      return;
    }
    if(promoteBtn){
      var row = promoteBtn.closest("tr");
      var pid = row.getAttribute("data-id");
      var prospect = state.prospects.filter(function(p){ return p.id === pid; })[0];
      if(!prospect) return;
      if(!confirm("Promote " + (prospect.name || "this prospect") + " to the Pipeline?")) return;
      apiFetch("/api/prospects/" + pid + "/promote", { method: "POST" })
        .then(refreshAndRender)
        .catch(function(err){ console.error(err); });
    }
  });
  document.getElementById("prospect-form").addEventListener("submit", function(e){
    e.preventDefault();
    var statusEl = document.getElementById("ps-status");
    var name = document.getElementById("ps-name").value.trim();
    if(!name) return;
    var data = {
      name: name,
      org: document.getElementById("ps-org").value.trim(),
      source: document.getElementById("ps-source").value,
      status: document.getElementById("ps-stage-select").value,
      link: document.getElementById("ps-link").value.trim(),
      notes: document.getElementById("ps-notes").value.trim()
    };
    apiFetch("/api/prospects", { method: "POST", body: data }).then(function(){
      document.getElementById("prospect-form").reset();
      document.getElementById("ps-source").value = "linkedin";
      document.getElementById("ps-stage-select").value = "new";
      statusEl.textContent = "Added.";
      setTimeout(function(){ statusEl.textContent = ""; }, 2200);
      return refreshAndRender();
    }).catch(function(err){ statusEl.textContent = "Could not save: " + err.message; });
  });

  // ---------- scorecard ----------
  function renderScorecard(){
    var rows = state.scorecard;
    var body = document.getElementById("scorecard-rows");
    if(rows.length === 0){
      body.innerHTML = '<tr><td colspan="9" class="empty-note">No weeks logged yet.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function(s){
      var won = Number(s.won || 0), lost = Number(s.lost || 0);
      var denom = won + lost;
      var closeRate = denom > 0 ? Math.round((won/denom)*100) + "%" : "n/a";
      return '<tr data-id="' + esc(s.id) + '">' +
        '<td>' + fmtDate(s.weekOf) + '</td>' +
        '<td>' + esc(s.calls || 0) + '</td>' +
        '<td>' + esc(s.leads || 0) + '</td>' +
        '<td>' + esc(s.active || 0) + '</td>' +
        '<td>' + esc(s.won || 0) + '</td>' +
        '<td>' + esc(s.lost || 0) + '</td>' +
        '<td>' + esc(s.referrals || 0) + '</td>' +
        '<td>' + closeRate + '</td>' +
        '<td><button type="button" class="btn danger sc-delete">Remove</button></td>' +
        '</tr>';
    }).join("");
  }
  document.getElementById("scorecard-rows").addEventListener("click", function(e){
    var btn = e.target.closest(".sc-delete");
    if(!btn) return;
    var id = btn.closest("tr").getAttribute("data-id");
    if(!confirm("Remove this week?")) return;
    apiFetch("/api/scorecard/" + id, { method: "DELETE" })
      .then(refreshAndRender)
      .catch(function(err){ console.error(err); });
  });
  document.getElementById("scorecard-form").addEventListener("submit", function(e){
    e.preventDefault();
    var statusEl = document.getElementById("sc-status");
    var week = document.getElementById("sc-week").value;
    if(!week) return;
    var data = {
      weekOf: week,
      calls: Number(document.getElementById("sc-calls").value || 0),
      leads: Number(document.getElementById("sc-leads").value || 0),
      active: Number(document.getElementById("sc-active").value || 0),
      won: Number(document.getElementById("sc-won").value || 0),
      lost: Number(document.getElementById("sc-lost").value || 0),
      referrals: Number(document.getElementById("sc-referrals").value || 0),
      notes: document.getElementById("sc-notes").value.trim()
    };
    apiFetch("/api/scorecard", { method: "POST", body: data }).then(function(){
      document.getElementById("scorecard-form").reset();
      statusEl.textContent = "Logged.";
      setTimeout(function(){ statusEl.textContent = ""; }, 2200);
      return refreshAndRender();
    }).catch(function(err){ statusEl.textContent = "Could not save: " + err.message; });
  });

  // ---------- forecasting ----------
  function linreg(points){
    var n = points.length;
    var sumX=0,sumY=0,sumXY=0,sumXX=0;
    points.forEach(function(p){ sumX+=p[0]; sumY+=p[1]; sumXY+=p[0]*p[1]; sumXX+=p[0]*p[0]; });
    var denom = (n*sumXX - sumX*sumX);
    var slope = denom !== 0 ? (n*sumXY - sumX*sumY)/denom : 0;
    var intercept = (sumY - slope*sumX)/n;
    return { slope: slope, intercept: intercept, predict: function(x){ return slope*x + intercept; } };
  }
  function stddev(nums){
    if(nums.length === 0) return 0;
    var mean = nums.reduce(function(a,b){ return a+b; },0)/nums.length;
    var variance = nums.reduce(function(a,b){ return a+Math.pow(b-mean,2); },0)/nums.length;
    return Math.sqrt(variance);
  }
  function showChartTooltip(e, text){
    var tip = document.getElementById("chart-tooltip");
    tip.textContent = text;
    tip.style.left = e.clientX + "px";
    tip.style.top = e.clientY + "px";
    tip.hidden = false;
  }
  function hideChartTooltip(){
    document.getElementById("chart-tooltip").hidden = true;
  }
  function buildForecastCard(title, weeks, valueFn, fmt){
    var pts = [];
    weeks.forEach(function(w){
      var v = valueFn(w);
      if(v === null || v === undefined || isNaN(v)) return;
      pts.push({ x: pts.length, y: v, date: w.weekOf });
    });
    if(pts.length < 2){
      return '<div class="chart-card"><h4>' + esc(title) + '</h4><p class="empty-note" style="border:none;padding-left:0;">Not enough weeks logged yet.</p></div>';
    }
    var reg = linreg(pts.map(function(p){ return [p.x, p.y]; }));
    var resid = pts.map(function(p){ return p.y - reg.predict(p.x); });
    var sd = stddev(resid);
    var lastX = pts[pts.length-1].x;
    var projX = lastX + 1;
    var projY = reg.predict(projX);

    var allY = pts.map(function(p){ return p.y; }).concat([projY+sd, projY-sd]);
    var minY = Math.min.apply(null, allY), maxY = Math.max.apply(null, allY);
    if(minY === maxY){ minY -= 1; maxY += 1; }
    var padY = (maxY - minY) * 0.15;
    minY -= padY; maxY += padY;
    if(pts.every(function(p){ return p.y >= 0; })) minY = Math.max(minY, 0);

    var w = 260, h = 110, padL = 8, padR = 8, padT = 8, padB = 8;
    var xScale = function(x){ return padL + (x/projX) * (w - padL - padR); };
    var yScale = function(y){ return padT + (1 - (y-minY)/(maxY-minY)) * (h - padT - padB); };

    var linePath = pts.map(function(p,i){ return (i===0?"M":"L") + xScale(p.x).toFixed(1) + "," + yScale(p.y).toFixed(1); }).join(" ");
    var lastPt = pts[pts.length-1];
    var dashedPath = "M" + xScale(lastX).toFixed(1) + "," + yScale(lastPt.y).toFixed(1) + " L" + xScale(projX).toFixed(1) + "," + yScale(projY).toFixed(1);

    var markers = pts.map(function(p){
      return '<circle class="fc-pt" cx="' + xScale(p.x).toFixed(1) + '" cy="' + yScale(p.y).toFixed(1) + '" r="3.5" fill="var(--accent-strong)" data-date="' + esc(fmtDate(p.date)) + '" data-value="' + esc(fmt(p.y)) + '"></circle>';
    }).join("");

    var projTop = yScale(projY+sd), projBottom = yScale(projY-sd);
    var px = xScale(projX).toFixed(1);
    var errBar = '<line x1="' + px + '" y1="' + projTop.toFixed(1) + '" x2="' + px + '" y2="' + projBottom.toFixed(1) + '" stroke="var(--ink-soft)" stroke-width="1.5"></line>' +
      '<line x1="' + (xScale(projX)-4).toFixed(1) + '" y1="' + projTop.toFixed(1) + '" x2="' + (xScale(projX)+4).toFixed(1) + '" y2="' + projTop.toFixed(1) + '" stroke="var(--ink-soft)" stroke-width="1.5"></line>' +
      '<line x1="' + (xScale(projX)-4).toFixed(1) + '" y1="' + projBottom.toFixed(1) + '" x2="' + (xScale(projX)+4).toFixed(1) + '" y2="' + projBottom.toFixed(1) + '" stroke="var(--ink-soft)" stroke-width="1.5"></line>';
    var projMarker = '<circle class="fc-pt" cx="' + px + '" cy="' + yScale(projY).toFixed(1) + '" r="3.5" fill="none" stroke="var(--accent-2)" stroke-width="2" data-date="Projected" data-value="' + esc(fmt(projY)) + '"></circle>';

    var prevPt = pts.length > 1 ? pts[pts.length-2] : null;
    var delta = prevPt ? (lastPt.y - prevPt.y) : 0;
    var deltaClass = delta > 0 ? "up" : (delta < 0 ? "down" : "");
    var deltaLabel = prevPt ? ((delta === 0 ? "flat" : (delta > 0 ? "+" + fmt(delta) : "" + fmt(delta))) + " vs prior week") : "";

    var svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(title) + ' trend">' +
      '<line x1="' + padL + '" y1="' + (h-padB) + '" x2="' + (w-padR) + '" y2="' + (h-padB) + '" stroke="var(--line)" stroke-width="1"></line>' +
      '<path d="' + linePath + '" fill="none" stroke="var(--accent-strong)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>' +
      '<path d="' + dashedPath + '" fill="none" stroke="var(--accent-2)" stroke-width="2" stroke-linecap="round" stroke-dasharray="4 3"></path>' +
      errBar + markers + projMarker +
      '</svg>';

    return '<div class="chart-card">' +
      '<h4>' + esc(title) + '</h4>' +
      '<span class="chart-now">' + esc(fmt(lastPt.y)) + '</span>' + (prevPt ? '<span class="chart-delta ' + deltaClass + '">' + esc(deltaLabel) + '</span>' : '') +
      svg +
      '<div class="chart-proj">Projected next week: ' + esc(fmt(projY)) + ' &plusmn; ' + esc(fmt(sd)) + '</div>' +
      '</div>';
  }
  function renderForecasting(){
    var weeks = state.scorecard.slice().sort(function(a,b){ return (a.weekOf || "").localeCompare(b.weekOf || ""); });
    var container = document.getElementById("forecast-charts");
    if(weeks.length < 2){
      container.innerHTML = '<p class="empty-note">Log at least two weeks of Scorecard data to see trend charts here.</p>';
      return;
    }
    var intFmt = function(v){ return String(Math.round(v)); };
    var pctFmt = function(v){ return Math.round(v) + "%"; };
    var cards = [
      buildForecastCard("Discovery calls", weeks, function(w){ return Number(w.calls || 0); }, intFmt),
      buildForecastCard("New leads", weeks, function(w){ return Number(w.leads || 0); }, intFmt),
      buildForecastCard("Close rate", weeks, function(w){ var won=Number(w.won||0), lost=Number(w.lost||0); var d=won+lost; return d > 0 ? (won/d)*100 : null; }, pctFmt),
      buildForecastCard("Active engagements", weeks, function(w){ return Number(w.active || 0); }, intFmt)
    ];
    container.innerHTML = cards.join("");
    container.querySelectorAll(".fc-pt").forEach(function(pt){
      pt.addEventListener("mousemove", function(e){ showChartTooltip(e, pt.getAttribute("data-date") + ": " + pt.getAttribute("data-value")); });
      pt.addEventListener("mouseleave", hideChartTooltip);
    });
  }

  // ---------- vision ----------
  function renderVision(){
    var v = state.vision || {};
    document.getElementById("v-values").value = v.values || "";
    document.getElementById("v-focus").value = v.focus || "";
    document.getElementById("v-ten").value = v.tenYear || "";
    document.getElementById("v-marketing").value = v.marketing || "";
    document.getElementById("v-three").value = v.threeYear || "";
    document.getElementById("v-one").value = v.oneYear || "";
  }
  document.getElementById("vision-save").addEventListener("click", function(){
    var statusEl = document.getElementById("vision-status");
    var data = {
      values: document.getElementById("v-values").value.trim(),
      focus: document.getElementById("v-focus").value.trim(),
      tenYear: document.getElementById("v-ten").value.trim(),
      marketing: document.getElementById("v-marketing").value.trim(),
      threeYear: document.getElementById("v-three").value.trim(),
      oneYear: document.getElementById("v-one").value.trim()
    };
    apiFetch("/api/vision", { method: "PUT", body: data }).then(function(){
      statusEl.textContent = "Saved.";
      setTimeout(function(){ statusEl.textContent = ""; }, 2200);
      return refreshAndRender();
    }).catch(function(err){ statusEl.textContent = "Could not save: " + err.message; });
  });

  // ---------- issues ----------
  document.getElementById("issue-filters").addEventListener("click", function(e){
    var btn = e.target.closest(".filter-btn");
    if(!btn) return;
    issueFilter = btn.getAttribute("data-status");
    this.querySelectorAll(".filter-btn").forEach(function(b){ b.classList.toggle("is-active", b === btn); });
    renderIssues();
  });
  function renderIssues(){
    var rows = state.issues.filter(function(i){ return issueFilter === "all" || i.status === issueFilter; });
    rows = rows.slice().sort(function(a,b){ return (b.createdAt || "").localeCompare(a.createdAt || ""); });
    var body = document.getElementById("issue-rows");
    if(rows.length === 0){
      body.innerHTML = '<tr><td colspan="5" class="empty-note">No issues in this view.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function(i){
      var opts = ["open","discussing","solved"].map(function(k){
        return '<option value="' + k + '"' + (i.status === k ? " selected" : "") + '>' + (k.charAt(0).toUpperCase()+k.slice(1)) + '</option>';
      }).join("");
      return '<tr data-id="' + esc(i.id) + '">' +
        '<td><strong>' + esc(i.title || "Untitled") + '</strong></td>' +
        '<td class="dim">' + esc(i.detail || "") + '</td>' +
        '<td><select class="inline-select is-status-select">' + opts + '</select></td>' +
        '<td class="dim">' + fmtDate((i.createdAt || "").slice(0,10)) + '</td>' +
        '<td><button type="button" class="btn danger is-delete">Remove</button></td>' +
        '</tr>';
    }).join("");
  }
  document.getElementById("issue-rows").addEventListener("change", function(e){
    if(!e.target.classList.contains("is-status-select")) return;
    var id = e.target.closest("tr").getAttribute("data-id");
    apiFetch("/api/issues/" + id, { method: "PATCH", body: { status: e.target.value } })
      .then(refreshAndRender)
      .catch(function(err){ console.error(err); });
  });
  document.getElementById("issue-rows").addEventListener("click", function(e){
    var btn = e.target.closest(".is-delete");
    if(!btn) return;
    var id = btn.closest("tr").getAttribute("data-id");
    if(!confirm("Remove this issue?")) return;
    apiFetch("/api/issues/" + id, { method: "DELETE" })
      .then(refreshAndRender)
      .catch(function(err){ console.error(err); });
  });
  document.getElementById("issue-form").addEventListener("submit", function(e){
    e.preventDefault();
    var statusEl = document.getElementById("is-status");
    var title = document.getElementById("is-title").value.trim();
    if(!title) return;
    var data = {
      title: title,
      detail: document.getElementById("is-detail").value.trim()
    };
    apiFetch("/api/issues", { method: "POST", body: data }).then(function(){
      document.getElementById("issue-form").reset();
      statusEl.textContent = "Added.";
      setTimeout(function(){ statusEl.textContent = ""; }, 2200);
      return refreshAndRender();
    }).catch(function(err){ statusEl.textContent = "Could not save: " + err.message; });
  });

  // ---------- rocks: calendar export ----------
  // A lightweight "add to calendar" for a Rock's due date - a standalone .ics
  // file built and downloaded client-side, no backend involved.
  function icsDateStamp(iso){ return iso.replace(/-/g,""); }
  function buildICS(rock){
    var dtStart = icsDateStamp(rock.dueDate);
    var endDate = new Date(rock.dueDate + "T00:00:00");
    endDate.setDate(endDate.getDate() + 1);
    var dtEnd = icsDateStamp(endDate.toISOString().slice(0,10));
    var stamp = new Date().toISOString().replace(/[-:]/g,"").split(".")[0] + "Z";
    var esc2 = function(s){ return String(s || "").replace(/([,;])/g, "\\$1").replace(/\n/g, "\\n"); };
    var lines = [
      "BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Frankly Inspired OS//Priorities//EN",
      "BEGIN:VEVENT",
      "UID:" + rock.id + "@frankly-inspired-os",
      "DTSTAMP:" + stamp,
      "DTSTART;VALUE=DATE:" + dtStart,
      "DTEND;VALUE=DATE:" + dtEnd,
      "SUMMARY:" + esc2("Priority due: " + (rock.title || "Untitled")),
      rock.notes ? "DESCRIPTION:" + esc2(rock.notes) : "",
      "END:VEVENT","END:VCALENDAR"
    ].filter(Boolean);
    return lines.join("\r\n");
  }
  function downloadICS(rock){
    var blob = new Blob([buildICS(rock)], { type: "text/calendar;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = (rock.title || "priority").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"") + ".ics";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  }

  // ---------- rocks ----------
  function renderRocks(){
    var rows = state.rocks.slice().sort(function(a,b){ return (a.dueDate || "9999").localeCompare(b.dueDate || "9999"); });
    var body = document.getElementById("rock-rows");
    if(rows.length === 0){
      body.innerHTML = '<tr><td colspan="6" class="empty-note">No priorities logged for this quarter yet.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function(r){
      var opts = ["on-track","off-track","done"].map(function(k){
        var label = k === "on-track" ? "On Track" : (k === "off-track" ? "Off Track" : "Done");
        return '<option value="' + k + '"' + (r.status === k ? " selected" : "") + '>' + label + '</option>';
      }).join("");
      return '<tr data-id="' + esc(r.id) + '">' +
        '<td><strong>' + esc(r.title || "Untitled") + '</strong></td>' +
        '<td class="dim">' + esc(r.quarter || "") + '</td>' +
        '<td><select class="inline-select rk-status-select">' + opts + '</select></td>' +
        '<td class="dim">' + fmtDate(r.dueDate) + (r.dueDate ? ' <a href="#" class="ics-link rk-ics" data-id="' + esc(r.id) + '">+ Calendar</a>' : '') + '</td>' +
        '<td class="dim">' + esc(r.notes || "") + '</td>' +
        '<td><button type="button" class="btn danger rk-delete">Remove</button></td>' +
        '</tr>';
    }).join("");
  }
  document.getElementById("rock-rows").addEventListener("change", function(e){
    if(!e.target.classList.contains("rk-status-select")) return;
    var id = e.target.closest("tr").getAttribute("data-id");
    apiFetch("/api/rocks/" + id, { method: "PATCH", body: { status: e.target.value } })
      .then(refreshAndRender)
      .catch(function(err){ console.error(err); });
  });
  document.getElementById("rock-rows").addEventListener("click", function(e){
    var icsBtn = e.target.closest(".rk-ics");
    if(icsBtn){
      e.preventDefault();
      var rock = state.rocks.filter(function(r){ return r.id === icsBtn.getAttribute("data-id"); })[0];
      if(rock) downloadICS(rock);
      return;
    }
    var btn = e.target.closest(".rk-delete");
    if(!btn) return;
    var id = btn.closest("tr").getAttribute("data-id");
    if(!confirm("Remove this priority?")) return;
    apiFetch("/api/rocks/" + id, { method: "DELETE" })
      .then(refreshAndRender)
      .catch(function(err){ console.error(err); });
  });
  document.getElementById("rock-form").addEventListener("submit", function(e){
    e.preventDefault();
    var statusEl = document.getElementById("rk-status");
    var title = document.getElementById("rk-title").value.trim();
    if(!title) return;
    var data = {
      title: title,
      quarter: document.getElementById("rk-quarter").value.trim() || currentQuarterLabel(),
      dueDate: document.getElementById("rk-due").value,
      notes: document.getElementById("rk-notes").value.trim()
    };
    apiFetch("/api/rocks", { method: "POST", body: data }).then(function(){
      document.getElementById("rock-form").reset();
      document.getElementById("rk-quarter").value = "";
      statusEl.textContent = "Added.";
      setTimeout(function(){ statusEl.textContent = ""; }, 2200);
      return refreshAndRender();
    }).catch(function(err){ statusEl.textContent = "Could not save: " + err.message; });
  });
  document.getElementById("rk-quarter").placeholder = currentQuarterLabel();

  // ---------- weekly session (guided L10-style flow) ----------
  var sessionStep = 0;
  var SESSION_STEP_COUNT = 5;

  function mondayOf(dstr){
    var d = dstr ? new Date(dstr + "T00:00:00") : new Date();
    var day = d.getDay();
    var diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0,10);
  }

  function goToSessionStep(n){
    sessionStep = Math.max(0, Math.min(SESSION_STEP_COUNT - 1, n));
    document.querySelectorAll(".session-step").forEach(function(btn){
      btn.classList.toggle("is-active", Number(btn.getAttribute("data-step")) === sessionStep);
    });
    document.querySelectorAll(".session-panel").forEach(function(p){
      p.hidden = Number(p.getAttribute("data-panel")) !== sessionStep;
    });
    document.getElementById("session-back").disabled = sessionStep === 0;
    document.getElementById("session-next").textContent = sessionStep === SESSION_STEP_COUNT - 1 ? "Start over" : "Next";
    renderSessionPanel();
  }

  function renderSessionPanel(){
    if(sessionStep === 0) renderSessionScorecard();
    else if(sessionStep === 1) renderSessionRocks();
    else if(sessionStep === 2) renderSessionIssues();
    else if(sessionStep === 3) renderSessionVision();
    else renderSessionRecap();
  }

  function renderSessionScorecard(){
    var wk = mondayOf();
    var existing = state.scorecard.filter(function(s){ return s.weekOf === wk; })[0];
    var loggedEl = document.getElementById("session-scorecard-logged");
    var formEl = document.getElementById("session-scorecard-form");
    var weekInput = document.getElementById("sess-week");
    if(weekInput && !weekInput.value) weekInput.value = wk;
    if(existing){
      loggedEl.hidden = false;
      formEl.hidden = true;
      document.getElementById("session-week-label").textContent = fmtDate(existing.weekOf);
      document.getElementById("session-week-summary").textContent =
        (existing.calls||0) + " calls, " + (existing.leads||0) + " new leads, " + (existing.won||0) + " won, " + (existing.lost||0) + " lost";
    } else {
      loggedEl.hidden = true;
      formEl.hidden = false;
    }
  }
  document.getElementById("session-scorecard-form").addEventListener("submit", function(e){
    e.preventDefault();
    var statusEl = document.getElementById("sess-sc-status");
    var week = document.getElementById("sess-week").value;
    if(!week) return;
    var data = {
      weekOf: week,
      calls: Number(document.getElementById("sess-calls").value || 0),
      leads: Number(document.getElementById("sess-leads").value || 0),
      active: 0,
      won: Number(document.getElementById("sess-won").value || 0),
      lost: Number(document.getElementById("sess-lost").value || 0),
      referrals: 0,
      notes: ""
    };
    apiFetch("/api/scorecard", { method: "POST", body: data }).then(function(){
      statusEl.textContent = "Logged.";
      setTimeout(function(){ statusEl.textContent = ""; }, 2200);
      return refreshAndRender();
    }).then(function(){
      if(sessionStep === 0) renderSessionScorecard();
    }).catch(function(err){ statusEl.textContent = "Could not save: " + err.message; });
  });

  function renderSessionRocks(){
    var list = document.getElementById("session-rocks-list");
    var rows = state.rocks.slice().sort(function(a,b){ return (a.dueDate || "9999").localeCompare(b.dueDate || "9999"); });
    if(rows.length === 0){
      list.innerHTML = '<li class="session-empty">No priorities logged for this quarter yet. Add some from the Priorities tab.</li>';
      return;
    }
    list.innerHTML = rows.map(function(r){
      var dot = r.status === "on-track" ? "good" : (r.status === "off-track" ? "warn" : "neutral");
      var opts = ["on-track","off-track","done"].map(function(k){
        var label = k === "on-track" ? "On Track" : (k === "off-track" ? "Off Track" : "Done");
        return '<option value="' + k + '"' + (r.status === k ? " selected" : "") + '>' + label + '</option>';
      }).join("");
      return '<li data-id="' + esc(r.id) + '">' +
        '<span>' + dotHtml(dot) + '<span class="who">' + esc(r.title || "Untitled") + '</span></span>' +
        '<span><select class="inline-select session-rock-status">' + opts + '</select></span>' +
        '</li>';
    }).join("");
  }
  document.getElementById("session-rocks-list").addEventListener("change", function(e){
    if(!e.target.classList.contains("session-rock-status")) return;
    var id = e.target.closest("li").getAttribute("data-id");
    apiFetch("/api/rocks/" + id, { method: "PATCH", body: { status: e.target.value } })
      .then(refreshAndRender)
      .then(function(){ if(sessionStep === 1) renderSessionRocks(); })
      .catch(function(err){ console.error(err); });
  });

  function renderSessionIssues(){
    var list = document.getElementById("session-issues-list");
    var rows = state.issues.filter(function(i){ return i.status !== "solved"; })
      .sort(function(a,b){ return (a.createdAt || "").localeCompare(b.createdAt || ""); });
    if(rows.length === 0){
      list.innerHTML = '<li class="session-empty">No open issues. Clean list.</li>';
      return;
    }
    list.innerHTML = rows.map(function(i){
      return '<li data-id="' + esc(i.id) + '">' +
        '<span>' + dotHtml("warn") + '<span class="who">' + esc(i.title || "Untitled") + '</span></span>' +
        '<span><button type="button" class="btn secondary session-issue-solve" data-id="' + esc(i.id) + '">Mark solved</button></span>' +
        '</li>';
    }).join("");
  }
  document.getElementById("session-issues-list").addEventListener("click", function(e){
    var btn = e.target.closest(".session-issue-solve");
    if(!btn) return;
    apiFetch("/api/issues/" + btn.getAttribute("data-id"), { method: "PATCH", body: { status: "solved" } })
      .then(refreshAndRender)
      .then(function(){ if(sessionStep === 2) renderSessionIssues(); })
      .catch(function(err){ console.error(err); });
  });
  document.getElementById("session-issue-form").addEventListener("submit", function(e){
    e.preventDefault();
    var statusEl = document.getElementById("sess-is-status");
    var titleEl = document.getElementById("sess-is-title");
    var title = titleEl.value.trim();
    if(!title) return;
    apiFetch("/api/issues", { method: "POST", body: { title: title, detail: "" } }).then(function(){
      titleEl.value = "";
      statusEl.textContent = "Added.";
      setTimeout(function(){ statusEl.textContent = ""; }, 2200);
      return refreshAndRender();
    }).then(function(){ if(sessionStep === 2) renderSessionIssues(); })
      .catch(function(err){ statusEl.textContent = "Could not save: " + err.message; });
  });

  function visionGlanceField(label, value){
    var v = (value || "").trim();
    return '<div class="vg-field"><span class="vg-label">' + esc(label) + '</span><span class="vg-value' + (v ? '' : ' is-empty') + '">' +
      (v ? esc(v) : "Not set yet, edit from the Vision tab.") + '</span></div>';
  }
  function renderSessionVision(){
    var v = state.vision || {};
    document.getElementById("session-vision-view").innerHTML =
      visionGlanceField("Core values", v.values) +
      visionGlanceField("Core focus", v.focus) +
      visionGlanceField("One year plan", v.oneYear);
  }

  function renderSessionRecap(){
    var openIssues = state.issues.filter(function(i){ return i.status !== "solved"; });
    var offTrack = state.rocks.filter(function(r){ return r.status === "off-track"; });
    var onTrack = state.rocks.filter(function(r){ return r.status === "on-track"; });
    var wk = mondayOf();
    var thisWeek = state.scorecard.filter(function(s){ return s.weekOf === wk; })[0];
    var waiting = state.prospects.filter(function(p){ return p.status !== "not-fit"; }).length;

    var lines = [
      { dot: thisWeek ? "good" : "neutral", text: thisWeek
        ? (thisWeek.calls||0) + " calls and " + (thisWeek.leads||0) + " new leads logged this week."
        : "This week's numbers are not logged yet." },
      { dot: offTrack.length ? "warn" : "good", text: offTrack.length
        ? offTrack.length + " priorit" + (offTrack.length === 1 ? "y" : "ies") + " off track this quarter."
        : onTrack.length + " priorit" + (onTrack.length === 1 ? "y" : "ies") + " on track, none off track." },
      { dot: openIssues.length ? "attn" : "good", text: openIssues.length
        ? openIssues.length + " open issue" + (openIssues.length === 1 ? "" : "s") + " still on the list."
        : "Issues list is clean." },
      { dot: waiting ? "attn" : "neutral", text: waiting
        ? waiting + " prospect" + (waiting === 1 ? "" : "s") + " waiting on research or outreach."
        : "Nothing waiting in Prospecting." }
    ];
    document.getElementById("session-recap").innerHTML = lines.map(function(l){
      return '<div class="session-recap-line">' + dotHtml(l.dot) + '<span>' + esc(l.text) + '</span></div>';
    }).join("");
  }

  document.getElementById("session-steps").addEventListener("click", function(e){
    var btn = e.target.closest(".session-step");
    if(!btn) return;
    goToSessionStep(Number(btn.getAttribute("data-step")));
  });
  document.getElementById("session-back").addEventListener("click", function(){ goToSessionStep(sessionStep - 1); });
  document.getElementById("session-next").addEventListener("click", function(){
    goToSessionStep(sessionStep === SESSION_STEP_COUNT - 1 ? 0 : sessionStep + 1);
  });

  // ---------- field intelligence ----------
  var DIGEST_CATEGORY_ORDER = ["philanthropy", "daf", "fundraising", "sector"];
  var DIGEST_CATEGORY_LABELS = {philanthropy:"Philanthropy", daf:"Donor-advised funds", fundraising:"Fundraising", sector:"Nonprofit sector"};
  var speechSupported = (typeof window.speechSynthesis !== "undefined") && (typeof window.SpeechSynthesisUtterance !== "undefined");

  // Groups the current digest by category in the same order/sort the cards
  // render in, so what's read aloud matches what's on screen.
  function digestByCategory(){
    var byCategory = {};
    state.digest.forEach(function(d){
      var cat = d.category || "philanthropy";
      (byCategory[cat] = byCategory[cat] || []).push(d);
    });
    return DIGEST_CATEGORY_ORDER.filter(function(cat){ return byCategory[cat] && byCategory[cat].length; }).map(function(cat){
      return { cat: cat, items: byCategory[cat].slice().sort(function(a,b){ return (a.id || "").localeCompare(b.id || ""); }) };
    });
  }

  function setReadAloudButton(speaking){
    var btn = document.getElementById("digest-readaloud-btn");
    if(!btn) return;
    btn.classList.toggle("is-speaking", speaking);
    btn.innerHTML = speaking ? "⏹ Stop reading" : "🔈 Read Aloud";
  }

  function stopReadAloud(){
    if(speechSupported && window.speechSynthesis.speaking) window.speechSynthesis.cancel();
    setReadAloudButton(false);
  }

  function toggleReadAloud(){
    if(!speechSupported) return;
    if(window.speechSynthesis.speaking){
      stopReadAloud();
      return;
    }
    var groups = digestByCategory();
    if(groups.length === 0) return;
    var parts = [];
    groups.forEach(function(g){
      parts.push(DIGEST_CATEGORY_LABELS[g.cat] || g.cat);
      g.items.forEach(function(d){
        parts.push((d.headline || "Untitled") + ". " + (d.summary || ""));
      });
    });
    var utter = new SpeechSynthesisUtterance(parts.join(". "));
    utter.rate = 0.95;
    utter.onend = function(){ setReadAloudButton(false); };
    utter.onerror = function(){ setReadAloudButton(false); };
    setReadAloudButton(true);
    window.speechSynthesis.speak(utter);
  }

  var readAloudBtnEl = document.getElementById("digest-readaloud-btn");
  if(readAloudBtnEl) readAloudBtnEl.addEventListener("click", toggleReadAloud);

  function renderFieldIntel(){
    var body = document.getElementById("digest-body");
    var refreshedEl = document.getElementById("digest-refreshed");
    var readBtn = document.getElementById("digest-readaloud-btn");
    if(state.digest.length === 0){
      body.innerHTML = '<p class="empty-note">Nothing logged yet, the first weekly research pass will populate this list.</p>';
      refreshedEl.textContent = "";
      if(readBtn) readBtn.hidden = true;
      return;
    }
    var latest = state.digest.reduce(function(max, d){ return (d.loggedAt || "") > max ? (d.loggedAt || "") : max; }, "");
    refreshedEl.textContent = latest ? ("Last refreshed " + fmtDate(latest.slice(0,10))) : "";
    if(readBtn) readBtn.hidden = !speechSupported;

    var groups = digestByCategory();
    body.innerHTML = groups.map(function(g){
      var cards = g.items.map(function(d){
        return '<div class="digest-card">' +
          '<h4>' + esc(d.headline || "Untitled") + '</h4>' +
          '<p>' + esc(d.summary || "") + '</p>' +
          '<div class="digest-meta"><span>' + esc(d.source || "") + '</span>' + (d.url ? ' &middot; <a href="' + esc(d.url) + '" target="_blank" rel="noopener">Read more</a>' : '') + '</div>' +
          '</div>';
      }).join("");
      return '<div class="digest-group"><h3>' + esc(DIGEST_CATEGORY_LABELS[g.cat] || g.cat) + '</h3>' + cards + '</div>';
    }).join("");
  }

  // ---------- process library (static reference) ----------
  var PROCESS_DOCS = [
    {title:"Fundraising Fluency", type:"Client curriculum, internal", feeds:"Delivery material", url:"https://claude.ai/code/artifact/3685944c-47a2-43b8-9e43-5b5061caa685"},
    {title:"The Build Before the Ask", type:"Client curriculum, internal", feeds:"Delivery material", url:"https://claude.ai/code/artifact/f4a695e3-709c-418c-8b67-ba3401224b3a"},
    {title:"Zero to Portfolio", type:"Client curriculum, internal", feeds:"Delivery material", url:"https://claude.ai/code/artifact/f8bde11d-1bcc-4814-8cdb-2e53387fd63c"},
    {title:"The Funding Pathway Finder", type:"Client curriculum, internal", feeds:"Delivery material", url:"https://claude.ai/code/artifact/c82a297b-f31c-4235-88b5-50bb4ee4fe4c"},
    {title:"The Governing Foundation", type:"Client curriculum, internal", feeds:"Delivery material", url:"https://claude.ai/code/artifact/8e82bfc1-080d-429c-8cce-4a859deb5ac8"},
    {title:"Signal Before System", type:"Practice strategy", feeds:"Vision, packaging rules", url:"https://claude.ai/code/artifact/c12391ca-aa22-431a-9531-8002beca1626"},
    {title:"Before Scale", type:"Practice strategy", feeds:"Data, the validation gate", url:"https://claude.ai/code/artifact/f9ef9433-9743-4044-86ea-d2272fcb4c09"},
    {title:"Call Before You Build", type:"Practice playbook", feeds:"Data, Pipeline sourcing", url:"https://claude.ai/code/artifact/c934e1fd-4577-490c-a364-7a3d8e26c5b4"},
    {title:"The InstitutionalOS Runbook", type:"Practice playbook", feeds:"Process, the run of show", url:"https://claude.ai/code/artifact/b971a0f8-1f32-4f84-a575-429b0430db4b"},
    {title:"Your Governing Foundation", type:"Client curriculum, client safe", feeds:"Delivery material", url:"https://claude.ai/code/artifact/c96f2946-a928-47b3-b49e-cfbc554c523d"},
    {title:"The InstitutionalOS Workbook", type:"Client workbook", feeds:"Process, the paper trail", url:"https://claude.ai/code/artifact/7b0513a3-678a-43f7-9e86-ba58b20909f6"},
    {title:"Your Fundraising Fluency", type:"Client curriculum, client safe", feeds:"Delivery material", url:"https://claude.ai/code/artifact/057b68e9-111e-48b7-a0e7-44f2298f2209"},
    {title:"Your Build Before the Ask", type:"Client curriculum, client safe", feeds:"Delivery material", url:"https://claude.ai/code/artifact/ae21622f-3a7f-42ba-a2e6-a828b3689197"},
    {title:"Your Zero to Portfolio", type:"Client curriculum, client safe", feeds:"Delivery material", url:"https://claude.ai/code/artifact/99638d09-1324-4f56-a745-268d9d6a9d58"},
    {title:"Your Funding Pathway Finder", type:"Client curriculum, client safe", feeds:"Delivery material", url:"https://claude.ai/code/artifact/85faf60e-ee5c-4f8c-b7d6-d16879100fe1"},
    {title:"The Offering Map", type:"Practice strategy", feeds:"Vision, how it all connects", url:"https://claude.ai/code/artifact/d1094121-cd04-4ae1-b2d3-ab99be088102"}
  ];
  document.getElementById("process-rows").innerHTML = PROCESS_DOCS.map(function(d){
    return '<tr><td><strong>' + esc(d.title) + '</strong></td><td class="dim">' + esc(d.type) + '</td><td><span class="pill">' + esc(d.feeds) + '</span></td><td><a href="' + esc(d.url) + '" target="_blank" rel="noopener">Open</a></td></tr>';
  }).join("") + '<tr><td><strong>The Frankly Inspired Operating System</strong></td><td class="dim">Operating system</td><td><span class="pill gold">All five components, live</span></td><td class="dim">You are here</td></tr>';

  // ---------- bootstrap ----------
  function renderAll(){
    renderBriefing();
    renderSessionPanel();
    renderDashboard();
    renderPipeline();
    renderProspecting();
    renderScorecard();
    renderForecasting();
    renderVision();
    renderIssues();
    renderRocks();
    renderFieldIntel();
  }

  function onApiUnavailable(){
    document.getElementById("db-banner").hidden = false;
    document.getElementById("load-note").hidden = true;
    ["pl-submit","sc-submit","is-submit","rk-submit","vision-save","ps-submit","sess-sc-submit","sess-is-submit"].forEach(function(id){
      var el = document.getElementById(id);
      if(el) el.disabled = true;
    });
    renderAll();
  }

  loadState().then(function(){
    apiReady = true;
    document.getElementById("load-note").hidden = true;
    renderAll();
  }).catch(function(){
    onApiUnavailable();
  });

  renderAll();
})();
