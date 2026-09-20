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

  // The four things Frankly Inspired actually sells, matching the pipeline
  // "track" vocabulary as closely as an invoice's offering type reasonably
  // can (an invoice is more specific than a track: a "consulting" track
  // pipeline record could later be billed as either a Retainer or a single
  // Project Based Engagement).
  var OFFERING_LABELS = { "institutionalos-diagnostic": "InstitutionalOS Diagnostic", "retainer": "Advisory and Implementation Retainer", "project": "Project Based Engagement", "coaching": "1:1 Executive Coaching", "other": "Other" };
  // Deliberately just three real, stored states - no stored "overdue", see
  // the schema.sql comment on the invoices table for why.
  var INVOICE_STATUS_LABELS = { draft: "Draft", sent: "Sent", paid: "Paid" };
  // The five pillars document 9's Runbook already sequences an engagement
  // through - offered as quick-fill suggestions on the module name field,
  // never a hard enum (see the engagement_modules schema comment).
  var MODULE_NAME_SUGGESTIONS = ["Governing Foundation", "Build Before the Ask", "Fundraising Fluency", "Zero to Portfolio", "Funding Pathway Finder"];
  var MODULE_STATUS_LABELS = { "not-started": "Not Started", "scheduled": "Scheduled", "complete": "Complete" };

  // An invoice is overdue when it's been sent (not still a draft, not
  // already paid), has a due date, and that date has passed - the same
  // derived-not-stored pattern as isOverduePipeline() above.
  function isOverdueInvoice(inv){
    return !!(inv.status === "sent" && inv.dueDate && inv.dueDate < todayStr());
  }
  function invoiceHealth(inv){
    if(inv.status === "paid") return "good";
    if(isOverdueInvoice(inv)) return "warn";
    if(inv.status === "draft") return "neutral";
    return "attn"; // sent, not yet due
  }

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

  var state = { pipeline:[], scorecard:[], issues:[], rocks:[], prospects:[], digest:[], gifts:[], vision:null, orgLinks:[], invoices:[], engagementModules:[], timeEntries:[], ready:false };
  // Structural-horizon data (see renderTimeHorizon below) loads separately
  // from the rest of state: it's a cache-only read of org 990 history, not
  // part of the gifts/pipeline/etc. payload /api/state already returns, and
  // it starts null (loading) rather than an empty array (nothing found) so
  // the panel can tell those two states apart.
  var orgStructuralSummary = null;
  var pipelineFilter = "all";
  var issueFilter = "all";
  var giftCategoryFilter = "all";
  var selectedGiftState = null;
  var apiReady = false;
  var usMapData = null;
  var usMapLoading = false;
  // Ephemeral, per-org UI state for the 990 financial-health lookup flow
  // (open/closed, search query, candidates, fetched analysis). Never comes
  // from the server and isn't part of `state` - it just needs to survive
  // renderOrgTracker() rebuilding the tracker's HTML on every data refresh.
  var orgHealthUi = {};

  // Giving USA 2026 report's recipient-subsector categories for 2025 giving
  // (the most recent year reported), as Giving USA itself published them:
  // real per-category dollar figures from the report (not a percentage share
  // multiplied back onto the total). Giving USA's recipient-category
  // estimates are compiled from different underlying data than its
  // source-side total, so the nine categories below do not sum exactly to
  // the $617.20B total giving figure - that gap is a documented feature of
  // how Giving USA models the two sides, not an error here. "growth" is the
  // inflation-adjusted year-over-year change, matching the "real" label
  // used on these bars. Gifts to individuals is tracked as a category
  // elsewhere in this app (the gift-logging form) but Giving USA has not
  // published a 2025 dollar figure for it, so it's left out of this year's
  // bars rather than guessed; see NATIONAL_GIVING_HISTORY below for the
  // years it was published.
  // Source: Giving USA 2026, the Giving USA Foundation and the Indiana
  // University Lilly Family School of Philanthropy.
  var GIVING_USA_CATEGORIES = [
    { key: "religion", label: "Religion", pct: 25, amountB: 151.58, growth: -0.2 },
    { key: "human-services", label: "Human Services", pct: 16, amountB: 99.50, growth: 2.6 },
    { key: "education", label: "Education", pct: 15, amountB: 92.01, growth: 8.9 },
    { key: "foundations", label: "Gifts to Foundations", pct: 13, amountB: 79.05, growth: -18.3 },
    { key: "public-society-benefit", label: "Public-Society Benefit", pct: 12, amountB: 72.06, growth: 8.7 },
    { key: "health", label: "Health", pct: 10, amountB: 61.43, growth: 3.3 },
    { key: "international-affairs", label: "International Affairs", pct: 5, amountB: 33.02, growth: 1.4 },
    { key: "arts-culture", label: "Arts, Culture & Humanities", pct: 4, amountB: 27.31, growth: 4.7 },
    { key: "environment-animals", label: "Environment & Animals", pct: 4, amountB: 24.57, growth: 8.2 },
    { key: "individuals", label: "Gifts to Individuals", pct: null, amountB: null, growth: null }
  ];

  // ---------- National Giving Trends (Giving USA history, 2000-2025) ----------
  // A benchmark layer, separate from Franklin's own gift ticker: real,
  // published Giving USA total-giving and recipient-category figures, so
  // his own logged gifts can be read against the national trend rather than
  // in isolation. Every number here is as originally reported in that
  // year's Giving USA release (Giving USA revises prior years in each new
  // edition; using each year's own vintage keeps this series internally
  // consistent rather than a mix of original and later-revised figures).
  // Category-level detail is complete back to 2009, matching every
  // category actually usable in the gift-logging form; totals-only go back
  // to 2000, with four years (2001, 2002, 2003, 2005) left out rather than
  // guessed, because no freely published Giving USA figure for those years
  // could be confirmed. "Gifts to Individuals" is included only for the
  // years Giving USA published a dollar figure for it (2009-2021); it has
  // not published one for 2022-2025.
  // Source throughout: Giving USA (the Giving USA Foundation and the
  // Indiana University Lilly Family School of Philanthropy), giving USA
  // annual press releases, 2000-2026 editions.
  var NATIONAL_TOTAL_GIVING_BY_YEAR = {
    2000: 203.45, 2004: 250, 2006: 295, 2007: 306.4, 2008: 315.08, 2009: 303.75,
    2010: 290.89, 2011: 298.42, 2012: 316.23, 2013: 335.17, 2014: 358.38, 2015: 373.25,
    2016: 390.05, 2017: 410.02, 2018: 427.71, 2019: 449.64, 2020: 471.44, 2021: 484.85,
    2022: 499.33, 2023: 557.16, 2024: 592.50, 2025: 617.20
  };
  var NATIONAL_CATEGORY_GIVING_BY_YEAR = {
    2009: { religion: 100.95, education: 40.01, foundations: 31, "human-services": 27.08, health: 22.46, "public-society-benefit": 22.77, "arts-culture": 12.34, "international-affairs": 8.89, "environment-animals": 6.15, individuals: 3.5 },
    2010: { religion: 100.63, education: 41.67, foundations: 33.00, "human-services": 26.49, "public-society-benefit": 24.24, health: 22.83, "international-affairs": 15.77, "arts-culture": 13.28, "environment-animals": 6.66, individuals: 4.20 },
    2011: { religion: 95.88, education: 38.87, "human-services": 35.39, foundations: 25.83, health: 24.75, "international-affairs": 22.68, "public-society-benefit": 21.37, "arts-culture": 13.12, "environment-animals": 7.81, individuals: 3.75 },
    2012: { religion: 101.54, education: 41.33, "human-services": 40.40, foundations: 30.58, health: 28.12, "international-affairs": 19.11, "public-society-benefit": 21.63, "arts-culture": 14.44, "environment-animals": 8.30, individuals: 3.96 },
    2013: { religion: 105.53, education: 52.07, "human-services": 41.51, health: 31.86, foundations: 35.74, "public-society-benefit": 23.89, "arts-culture": 16.66, "international-affairs": 14.93, "environment-animals": 9.72, individuals: 3.7 },
    2014: { religion: 114.90, education: 54.62, "human-services": 42.10, foundations: 41.62, health: 30.37, "public-society-benefit": 26.29, "arts-culture": 17.23, "international-affairs": 15.10, "environment-animals": 10.50, individuals: 6.42 },
    2015: { religion: 119.30, education: 57.48, "human-services": 45.21, foundations: 42.26, health: 29.81, "public-society-benefit": 26.95, "arts-culture": 17.07, "international-affairs": 15.75, "environment-animals": 10.68, individuals: 6.56 },
    2016: { religion: 122.94, education: 59.77, "human-services": 46.80, foundations: 40.56, health: 33.14, "public-society-benefit": 29.89, "international-affairs": 22.03, "arts-culture": 18.21, "environment-animals": 11.05, individuals: 7.12 },
    2017: { religion: 127.37, education: 58.90, "human-services": 50.06, foundations: 45.89, health: 38.27, "public-society-benefit": 29.59, "international-affairs": 22.97, "arts-culture": 19.51, "environment-animals": 11.83, individuals: 7.87 },
    2018: { religion: 124.52, education: 58.72, "human-services": 51.54, foundations: 50.29, health: 40.78, "public-society-benefit": 31.21, "international-affairs": 22.88, "arts-culture": 19.49, "environment-animals": 12.70, individuals: 9.06 },
    2019: { religion: 128.17, education: 64.11, "human-services": 55.99, foundations: 53.51, health: 41.46, "public-society-benefit": 37.16, "international-affairs": 28.89, "arts-culture": 21.64, "environment-animals": 14.16, individuals: 10.11 },
    2020: { religion: 131.08, education: 71.34, "human-services": 65.14, foundations: 58.17, health: 42.12, "public-society-benefit": 48.00, "international-affairs": 25.89, "arts-culture": 19.47, "environment-animals": 16.14, individuals: 16.22 },
    2021: { religion: 135.78, education: 70.79, "human-services": 65.33, foundations: 64.26, health: 40.58, "public-society-benefit": 55.85, "international-affairs": 27.44, "arts-culture": 23.50, "environment-animals": 16.32, individuals: 11.74 },
    2022: { religion: 143.57, education: 70.07, "human-services": 71.98, foundations: 56.84, health: 51.08, "public-society-benefit": 46.86, "international-affairs": 33.71, "arts-culture": 24.67, "environment-animals": 16.10 },
    2023: { religion: 145.81, education: 87.69, "human-services": 88.84, foundations: 80.03, health: 56.58, "public-society-benefit": 62.81, "international-affairs": 29.94, "arts-culture": 25.26, "environment-animals": 21.20 },
    2024: { religion: 146.54, education: 88.32, "human-services": 91.15, foundations: 71.92, health: 60.51, "public-society-benefit": 66.84, "international-affairs": 35.54, "arts-culture": 25.13, "environment-animals": 21.57 },
    2025: { religion: 151.58, education: 92.01, "human-services": 99.50, foundations: 79.05, health: 61.43, "public-society-benefit": 72.06, "international-affairs": 33.02, "arts-culture": 27.31, "environment-animals": 24.57 }
  };
  var NATIONAL_TREND_CATEGORY_ORDER = ["religion", "human-services", "education", "foundations", "public-society-benefit", "health", "international-affairs", "arts-culture", "environment-animals", "individuals"];
  var GIFT_CATEGORY_LABELS = { "other": "Other / unspecified" };
  GIVING_USA_CATEGORIES.forEach(function(c){ GIFT_CATEGORY_LABELS[c.key] = c.label; });

  // Fixed vocab for the case-study breakdown, so gift type and restriction
  // stay short, comparable pills rather than free text.
  var GIFT_TYPES = ["Outright cash gift", "Multi-year pledge", "Endowment gift", "Donor-advised fund grant", "Matching / challenge gift", "Planned gift / bequest", "In-kind gift", "Campaign lead gift", "Other"];
  var GIFT_RESTRICTIONS = ["Unrestricted", "Program-restricted", "Capital / naming", "Endowment", "Not stated"];

  // U.S. Census Bureau's four regions / nine divisions, used to group the state
  // grid instead of plotting states on a literal map, so a state's position on
  // the page is never a guess, only the data behind it is shown.
  var US_REGIONS = [
    { name: "Northeast", states: [["CT","Connecticut"],["ME","Maine"],["MA","Massachusetts"],["NH","New Hampshire"],["RI","Rhode Island"],["VT","Vermont"],["NJ","New Jersey"],["NY","New York"],["PA","Pennsylvania"]] },
    { name: "Midwest", states: [["IL","Illinois"],["IN","Indiana"],["MI","Michigan"],["OH","Ohio"],["WI","Wisconsin"],["IA","Iowa"],["KS","Kansas"],["MN","Minnesota"],["MO","Missouri"],["NE","Nebraska"],["ND","North Dakota"],["SD","South Dakota"]] },
    { name: "South", states: [["DE","Delaware"],["FL","Florida"],["GA","Georgia"],["MD","Maryland"],["NC","North Carolina"],["SC","South Carolina"],["VA","Virginia"],["DC","District of Columbia"],["WV","West Virginia"],["AL","Alabama"],["KY","Kentucky"],["MS","Mississippi"],["TN","Tennessee"],["AR","Arkansas"],["LA","Louisiana"],["OK","Oklahoma"],["TX","Texas"]] },
    { name: "West", states: [["AZ","Arizona"],["CO","Colorado"],["ID","Idaho"],["MT","Montana"],["NV","Nevada"],["NM","New Mexico"],["UT","Utah"],["WY","Wyoming"],["AK","Alaska"],["CA","California"],["HI","Hawaii"],["OR","Oregon"],["WA","Washington"]] }
  ];
  var STATE_NAME_BY_ABBR = {};
  US_REGIONS.forEach(function(r){ r.states.forEach(function(s){ STATE_NAME_BY_ABBR[s[0]] = s[1]; }); });

  var PROSPECT_STATUS_LABELS = {"new":"New", researching:"Researching", contacted:"Contacted", responded:"Responded", meeting:"Meeting booked", "not-fit":"Not a fit"};
  var PROSPECT_SOURCE_LABELS = {linkedin:"LinkedIn", referral:"Referral", conference:"Conference / event", warm:"Warm network", inbound:"Inbound", giving:"Giving Landscape", other:"Other"};

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

    var overdueInvoices = state.invoices.filter(function(inv){ return isOverdueInvoice(inv); });
    var financeSentence = overdueInvoices.length === 0
      ? "No overdue invoices."
      : (overdueInvoices.length + " overdue invoice" + (overdueInvoices.length === 1 ? "" : "s") + ", " +
         fmtMoneyShort(overdueInvoices.reduce(function(sum, inv){ return sum + (Number(inv.amount) || 0); }, 0)) + " outstanding.");
    lines.push(financeSentence);

    // Today's one focus draws from a single pool: an off-track Rock and an
    // overdue invoice compete on equal footing, both scored by how many days
    // past their own due date they are, rather than a Rock always winning by
    // default. A Rock flagged off-track with no due date yet (or not yet
    // overdue) still scores 0, so it's still picked when nothing is more
    // overdue - the same fallback the briefing always had.
    function daysPastDue(dateStr){
      if(!dateStr) return 0;
      var d = Math.round((new Date(todayStr()) - new Date(dateStr)) / 86400000);
      return d > 0 ? d : 0;
    }
    var focusCandidates = [];
    offTrackRocks.forEach(function(r){
      focusCandidates.push({ urgency: daysPastDue(r.dueDate), text: "Get “" + esc(r.title || "the off track priority") + "” back on track." });
    });
    overdueInvoices.forEach(function(inv){
      focusCandidates.push({
        urgency: daysPastDue(inv.dueDate),
        text: "Follow up on the overdue invoice for " + esc(pipelineLabelById(inv.pipelineId)) + ", " + fmtMoneyShort(Number(inv.amount) || 0) + " past due."
      });
    });
    focusCandidates.sort(function(a, b){ return b.urgency - a.urgency; });

    var focus = null;
    if(focusCandidates.length > 0){
      focus = focusCandidates[0].text;
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

  // ---------- command center (a synthesized rollup, distinct from the plainer Dashboard) ----------
  // Five stages an open engagement actually moves through before it's a win;
  // Referred Out and Lost are real closed outcomes but don't belong on a
  // "how far along" bar, so they're excluded here even though they're still
  // counted in the stage snapshot below.
  var CC_STAGE_PROGRESS_ORDER = ["lead", "discovery", "assessment", "engaged", "graduated"];

  function renderCcEngagements(){
    var el = document.getElementById("cc-engagements-list");
    if(!el) return;
    var list = state.pipeline
      .filter(function(p){ return p.nextStepDate && !CLOSED_STAGES[p.stage]; })
      .sort(function(a,b){ return (a.nextStepDate || "").localeCompare(b.nextStepDate || ""); })
      .slice(0, 5);
    if(list.length === 0){
      el.innerHTML = '<li class="empty-note" style="border:none;">Nothing scheduled yet. Add a next step and a date to any pipeline record.</li>';
      return;
    }
    el.innerHTML = list.map(function(p){
      var overdue = isOverduePipeline(p);
      var stepIdx = CC_STAGE_PROGRESS_ORDER.indexOf(p.stage);
      var stageLabel = STAGE_LABELS[p.stage] || p.stage;
      var progress = stepIdx >= 0 ? '<span class="pill">' + esc(stageLabel) + ' &middot; step ' + (stepIdx + 1) + ' of ' + CC_STAGE_PROGRESS_ORDER.length + '</span>' : '<span class="pill">' + esc(stageLabel) + '</span>';
      var deal = Number(p.dealValue) > 0 ? (' &middot; ' + fmtMoneyShort(Number(p.dealValue))) : '';
      var mods = state.engagementModules.filter(function(m){ return m.pipelineId === p.id; });
      var modulesPill = mods.length > 0
        ? ' <span class="pill gold">' + mods.filter(function(m){ return m.status === "complete"; }).length + ' of ' + mods.length + ' modules</span>'
        : '';
      return '<li' + (overdue ? ' class="row-overdue"' : '') + '>' +
        '<span>' + dotHtml(pipelineHealth(p)) + '<span class="who">' + esc(p.name || "Untitled") + (p.org ? (' <span class="dim">(' + esc(p.org) + ')</span>') : '') + '</span> &middot; ' + esc(p.nextStep || "next step not set") + deal + '<br>' + progress + modulesPill + '</span>' +
        '<span class="when">' + fmtDate(p.nextStepDate) + (overdue ? ' <span class="overdue-tag">Overdue</span>' : '') + '</span>' +
        '</li>';
    }).join("");
  }

  function renderCcStageStats(){
    var el = document.getElementById("cc-stage-stats");
    if(!el) return;
    var order = ["lead", "discovery", "assessment", "engaged", "graduated", "referred", "lost"];
    el.innerHTML = order.map(function(stage){
      var count = state.pipeline.filter(function(p){ return p.stage === stage; }).length;
      return '<div class="stat-card"><span class="num mono">' + count + '</span><span class="cap">' + esc(STAGE_LABELS[stage] || stage) + '</span></div>';
    }).join("");
  }

  function renderCcRocks(){
    var summaryEl = document.getElementById("cc-rocks-summary");
    var listEl = document.getElementById("cc-rocks-list");
    if(!listEl) return;
    var rocks = state.rocks;
    var onTrack = rocks.filter(function(r){ return r.status === "on-track"; }).length;
    var offTrack = rocks.filter(function(r){ return r.status === "off-track"; }).length;
    var done = rocks.filter(function(r){ return r.status === "done"; }).length;
    summaryEl.textContent = rocks.length === 0
      ? "No priorities logged for this quarter yet."
      : (onTrack + " on track, " + offTrack + " off track, " + done + " done, out of " + rocks.length + " logged this quarter.");

    var order = { "off-track": 0, "on-track": 1, "done": 2 };
    var sorted = rocks.slice().sort(function(a,b){
      var byStatus = (order[a.status] == null ? 3 : order[a.status]) - (order[b.status] == null ? 3 : order[b.status]);
      if(byStatus !== 0) return byStatus;
      return (a.dueDate || "9999").localeCompare(b.dueDate || "9999");
    });
    if(sorted.length === 0){
      listEl.innerHTML = '<li class="empty-note" style="border:none;">Nothing logged yet &mdash; add one on the Priorities view.</li>';
      return;
    }
    listEl.innerHTML = sorted.map(function(r){
      var dot = r.status === "off-track" ? "warn" : (r.status === "done" ? "good" : "neutral");
      var statusLabel = r.status === "off-track" ? "Off Track" : (r.status === "done" ? "Done" : "On Track");
      return '<li><span>' + dotHtml(dot) + '<span class="who">' + esc(r.title || "Untitled") + '</span> &middot; ' + esc(statusLabel) + '</span><span class="when">' + (r.dueDate ? fmtDate(r.dueDate) : "no due date") + '</span></li>';
    }).join("");
  }

  function renderCcTrendTiles(){
    var el = document.getElementById("cc-trend-tiles");
    if(!el) return;
    if(!practiceTrends){
      el.innerHTML = '<p class="empty-note">Loading&hellip;</p>';
      return;
    }
    var s = practiceTrendSeries();
    el.innerHTML = [s.conversion, s.dealSize, s.velocity].map(function(m){
      if(m.points.length === 0){
        return '<div class="stat-card"><span class="num mono">&mdash;</span><span class="cap">' + esc(m.title) + '</span></div>';
      }
      var sorted = m.points.slice().sort(function(a,b){ return monthIndex(a.month) - monthIndex(b.month); });
      var last = sorted[sorted.length - 1];
      var prev = sorted.length > 1 ? sorted[sorted.length - 2] : null;
      var deltaHtml = "";
      if(prev){
        var delta = last.value - prev.value;
        var cls = delta > 0 ? "up" : (delta < 0 ? "down" : "");
        deltaHtml = '<span class="chart-delta ' + cls + '">' + (delta === 0 ? "flat" : (delta > 0 ? "+" + m.fmt(delta) : "" + m.fmt(delta))) + '</span>';
      }
      return '<div class="stat-card"><span class="num mono">' + esc(m.fmt(last.value)) + '</span>' + deltaHtml + '<span class="cap">' + esc(m.title) + ' &middot; ' + esc(monthLabel(last.month)) + '</span></div>';
    }).join("");
  }

  function renderCcFieldIntel(){
    var el = document.getElementById("cc-fieldintel-list");
    if(!el) return;
    var items = state.digest.slice().sort(function(a,b){ return (b.loggedAt || "").localeCompare(a.loggedAt || ""); }).slice(0, 3);
    if(items.length === 0){
      el.innerHTML = '<p class="empty-note">Nothing logged yet, the first weekly research pass will populate this.</p>';
      return;
    }
    el.innerHTML = items.map(function(d){
      return '<div class="digest-card">' +
        '<h4>' + esc(d.headline || "Untitled") + '</h4>' +
        '<p>' + esc(d.summary || "") + '</p>' +
        '<div class="digest-meta"><span class="pill">' + esc(DIGEST_CATEGORY_LABELS[d.category] || d.category || "") + '</span><span>' + esc(d.source || "") + '</span>' + (d.url ? ' &middot; <a href="' + esc(d.url) + '" target="_blank" rel="noopener">Read more</a>' : '') + '</div>' +
        '</div>';
    }).join("");
  }

  // Finance & Delivery used to be a "not yet built" callout on this panel -
  // now that both modules are real (see Finance and Delivery views), this
  // is a summary of the same invoices and engagement_modules records, not
  // a separate calculation.
  function renderCcFinanceDelivery(){
    var statsEl = document.getElementById("cc-finance-stats");
    var summaryEl = document.getElementById("cc-delivery-summary");
    var listEl = document.getElementById("cc-delivery-list");
    if(!statsEl || !listEl) return;

    var openInvoices = state.invoices.filter(function(inv){ return inv.status === "sent"; });
    var overdueInvoices = openInvoices.filter(function(inv){ return isOverdueInvoice(inv); });
    var openTotal = openInvoices.reduce(function(sum, inv){ return sum + (Number(inv.amount) || 0); }, 0);
    var overdueTotal = overdueInvoices.reduce(function(sum, inv){ return sum + (Number(inv.amount) || 0); }, 0);
    var bounds = currentQuarterBounds();
    var collected = state.invoices
      .filter(function(inv){ return inv.status === "paid" && inv.paidDate && inv.paidDate >= bounds[0] && inv.paidDate < bounds[1]; })
      .reduce(function(sum, inv){ return sum + (Number(inv.amount) || 0); }, 0);
    statsEl.innerHTML = [
      ["Outstanding (sent, unpaid)", fmtMoneyShort(openTotal)],
      ["Overdue", fmtMoneyShort(overdueTotal) + (overdueInvoices.length ? " (" + overdueInvoices.length + ")" : "")],
      ["Collected, " + currentQuarterLabel(), fmtMoneyShort(collected)]
    ].map(function(pair){
      return '<div class="stat-card"><span class="num mono">' + pair[1] + '</span><span class="cap">' + esc(pair[0]) + '</span></div>';
    }).join("");

    var byPipeline = {};
    state.engagementModules.forEach(function(m){
      (byPipeline[m.pipelineId] = byPipeline[m.pipelineId] || []).push(m);
    });
    var pipelineIds = Object.keys(byPipeline);
    if(summaryEl){
      summaryEl.textContent = pipelineIds.length === 0
        ? "No delivery modules logged yet."
        : (pipelineIds.length + " engagement" + (pipelineIds.length === 1 ? "" : "s") + " with modules in progress.");
    }
    if(pipelineIds.length === 0){
      listEl.innerHTML = '<li class="empty-note" style="border:none;">Log modules for an active engagement on the Delivery view.</li>';
      return;
    }
    var withProgress = pipelineIds.map(function(pid){
      var mods = byPipeline[pid];
      var complete = mods.filter(function(m){ return m.status === "complete"; }).length;
      return { pid: pid, complete: complete, total: mods.length, pct: complete / mods.length };
    }).sort(function(a, b){ return a.pct - b.pct; }).slice(0, 5);
    listEl.innerHTML = withProgress.map(function(row){
      return '<li><span><span class="who">' + esc(pipelineLabelById(row.pid)) + '</span></span>' +
        '<span class="when"><span class="pill gold">' + row.complete + ' of ' + row.total + ' modules</span></span></li>';
    }).join("");
  }

  function renderCommandCenter(){
    renderCcEngagements();
    renderCcStageStats();
    renderCcRocks();
    renderCcTrendTiles();
    renderCcFieldIntel();
    renderCcFinanceDelivery();
  }
  var ccTrendsLink = document.getElementById("cc-trends-link");
  if(ccTrendsLink) ccTrendsLink.addEventListener("click", function(e){ e.preventDefault(); goToView("forecasting"); });
  var ccFieldIntelLink = document.getElementById("cc-fieldintel-link");
  if(ccFieldIntelLink) ccFieldIntelLink.addEventListener("click", function(e){ e.preventDefault(); goToView("fieldintel"); });
  var ccFinanceLink = document.getElementById("cc-finance-link");
  if(ccFinanceLink) ccFinanceLink.addEventListener("click", function(e){ e.preventDefault(); goToView("finance"); });
  var ccDeliveryLink = document.getElementById("cc-delivery-link");
  if(ccDeliveryLink) ccDeliveryLink.addEventListener("click", function(e){ e.preventDefault(); goToView("delivery"); });

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
      state.gifts = data.gifts || [];
      state.vision = data.vision || null;
      state.orgLinks = data.orgLinks || [];
      state.invoices = data.invoices || [];
      state.engagementModules = data.engagementModules || [];
      state.timeEntries = data.timeEntries || [];
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
      dealValue: Number(document.getElementById("pl-deal-value").value || 0),
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
      var row = '<tr data-id="' + esc(p.id) + '">' +
        '<td>' + dotHtml(prospectHealth(p)) + '<strong>' + nameCell + '</strong><div class="prospect-source-tag">' + esc(PROSPECT_SOURCE_LABELS[p.source] || p.source || "") + '</div></td>' +
        '<td class="dim">' + esc(p.org || "") + '</td>' +
        '<td class="dim">' + esc(PROSPECT_SOURCE_LABELS[p.source] || p.source || "") + '</td>' +
        '<td><select class="inline-select ps-stage-select">' + opts + '</select></td>' +
        '<td class="dim">' + esc(p.notes || "") + '</td>' +
        '<td><button type="button" class="btn ps-promote">Promote</button> <button type="button" class="btn danger ps-delete">Remove</button></td>' +
        '</tr>';
      // Same 990 financial-health disclosure as the Giving Landscape org
      // tracker, keyed by prospect.org instead of gift.org - a prospect tied
      // to an organization gets the same lifetime filing lookup, in its own
      // full-width row so the chart isn't squeezed into a table cell.
      if(p.org){
        row += '<tr class="oh-row"><td colspan="6" class="oh-cell">' + orgHealthHtml(p.org) + '</td></tr>';
      }
      return row;
    }).join("");
    body.querySelectorAll(".ot-pt, .oh-chart-pt").forEach(function(pt){
      pt.addEventListener("mousemove", function(e){ showChartTooltip(e, pt.getAttribute("data-tip")); });
      pt.addEventListener("mouseleave", hideChartTooltip);
    });
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
      body.innerHTML = '<tr><td colspan="11" class="empty-note">No weeks logged yet.</td></tr>';
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
        '<td class="mono">' + fmtMoneyShort(Number(s.revenueBooked) || 0) + '</td>' +
        '<td class="mono">' + fmtMoneyShort(Number(s.revenueCollected) || 0) + '</td>' +
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
      revenueBooked: Number(document.getElementById("sc-revenue-booked").value || 0),
      revenueCollected: Number(document.getElementById("sc-revenue-collected").value || 0),
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

  // ---------- Finance & Delivery: shared "pick an engagement" helpers ----------
  // Every invoice, module, and time entry belongs to a real Pipeline row
  // (see the schema.sql comment on the invoices table), so all three forms
  // share the same dropdown of engagements rather than each building their
  // own copy of "which pipeline record is this for".
  function pipelineOptionLabel(p){
    return (p.name || "Untitled") + (p.org ? " (" + p.org + ")" : "");
  }
  function populatePipelineSelect(selectEl){
    if(!selectEl) return;
    var current = selectEl.value;
    var sorted = state.pipeline.slice().sort(function(a,b){ return pipelineOptionLabel(a).localeCompare(pipelineOptionLabel(b)); });
    if(sorted.length === 0){
      selectEl.innerHTML = '<option value="">Add a Pipeline record first</option>';
      return;
    }
    selectEl.innerHTML = sorted.map(function(p){
      var closedTag = CLOSED_STAGES[p.stage] ? (" — " + STAGE_LABELS[p.stage]) : "";
      return '<option value="' + esc(p.id) + '">' + esc(pipelineOptionLabel(p) + closedTag) + '</option>';
    }).join("");
    if(current && sorted.some(function(p){ return p.id === current; })) selectEl.value = current;
  }
  function pipelineLabelById(id){
    var p = state.pipeline.filter(function(x){ return x.id === id; })[0];
    return p ? pipelineOptionLabel(p) : "Deleted engagement";
  }
  function currentQuarterBounds(){
    var d = new Date();
    var startMonth = Math.floor(d.getMonth()/3) * 3;
    var start = new Date(d.getFullYear(), startMonth, 1);
    var end = new Date(d.getFullYear(), startMonth + 3, 1);
    return [start.toISOString().slice(0,10), end.toISOString().slice(0,10)];
  }

  // ---------- Finance (invoices, AR aging, revenue) ----------
  function renderFinance(){
    populatePipelineSelect(document.getElementById("inv-pipeline"));
    renderInvoiceRows();
    renderArAging();
    renderRevenueStats();
  }
  function renderInvoiceRows(){
    var body = document.getElementById("invoice-rows");
    if(!body) return;
    var rows = state.invoices.slice().sort(function(a,b){ return (a.dueDate || "9999").localeCompare(b.dueDate || "9999"); });
    if(rows.length === 0){
      body.innerHTML = '<tr><td colspan="6" class="empty-note">No invoices logged yet.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function(inv){
      var overdue = isOverdueInvoice(inv);
      var opts = Object.keys(INVOICE_STATUS_LABELS).map(function(k){
        return '<option value="' + k + '"' + (inv.status === k ? " selected" : "") + '>' + INVOICE_STATUS_LABELS[k] + '</option>';
      }).join("");
      return '<tr data-id="' + esc(inv.id) + '"' + (overdue ? ' class="row-overdue"' : '') + '>' +
        '<td>' + dotHtml(invoiceHealth(inv)) + esc(pipelineLabelById(inv.pipelineId)) + '</td>' +
        '<td class="dim">' + esc(OFFERING_LABELS[inv.offering] || inv.offering || "") + '</td>' +
        '<td class="mono">' + fmtMoneyExact(inv.amount) + '</td>' +
        '<td><select class="inline-select inv-status-select">' + opts + '</select>' + (overdue ? ' <span class="overdue-tag">Overdue</span>' : '') + '</td>' +
        '<td class="dim">' + (inv.dueDate ? fmtDate(inv.dueDate) : "no due date") + '</td>' +
        '<td><button type="button" class="btn danger inv-delete">Remove</button></td>' +
        '</tr>';
    }).join("");
  }
  function renderArAging(){
    var el = document.getElementById("fin-ar-aging");
    if(!el) return;
    var open = state.invoices.filter(function(inv){ return inv.status === "sent"; });
    var today = todayStr();
    var buckets = { current: 0, d30: 0, d60: 0, d60plus: 0 };
    open.forEach(function(inv){
      var amt = Number(inv.amount) || 0;
      if(!inv.dueDate || inv.dueDate >= today){ buckets.current += amt; return; }
      var days = Math.round((new Date(today) - new Date(inv.dueDate)) / 86400000);
      if(days <= 30) buckets.d30 += amt;
      else if(days <= 60) buckets.d60 += amt;
      else buckets.d60plus += amt;
    });
    el.innerHTML = [
      ["Current", buckets.current], ["1–30 days overdue", buckets.d30],
      ["31–60 days overdue", buckets.d60], ["60+ days overdue", buckets.d60plus]
    ].map(function(pair){
      return '<div class="stat-card"><span class="num mono">' + fmtMoneyShort(pair[1]) + '</span><span class="cap">' + esc(pair[0]) + '</span></div>';
    }).join("");
  }
  function renderRevenueStats(){
    var el = document.getElementById("fin-revenue-stats");
    if(!el) return;
    var bounds = currentQuarterBounds();
    var qLabel = currentQuarterLabel();
    var collected = state.invoices
      .filter(function(inv){ return inv.status === "paid" && inv.paidDate && inv.paidDate >= bounds[0] && inv.paidDate < bounds[1]; })
      .reduce(function(sum, inv){ return sum + (Number(inv.amount) || 0); }, 0);
    var weeksThisQuarter = state.scorecard.filter(function(s){ return s.weekOf && s.weekOf >= bounds[0] && s.weekOf < bounds[1]; });
    var booked = weeksThisQuarter.reduce(function(sum, s){ return sum + (Number(s.revenueBooked) || 0); }, 0);
    var scorecardCollected = weeksThisQuarter.reduce(function(sum, s){ return sum + (Number(s.revenueCollected) || 0); }, 0);
    el.innerHTML = [
      ["Collected from paid invoices, " + qLabel, fmtMoneyShort(collected)],
      ["Scorecard: revenue booked, " + qLabel, fmtMoneyShort(booked)],
      ["Scorecard: revenue collected, " + qLabel, fmtMoneyShort(scorecardCollected)]
    ].map(function(pair){
      return '<div class="stat-card"><span class="num mono">' + pair[1] + '</span><span class="cap">' + esc(pair[0]) + '</span></div>';
    }).join("");
  }
  document.getElementById("invoice-rows").addEventListener("change", function(e){
    if(!e.target.classList.contains("inv-status-select")) return;
    var id = e.target.closest("tr").getAttribute("data-id");
    var newStatus = e.target.value;
    var body = { status: newStatus };
    if(newStatus === "paid"){
      var inv = state.invoices.filter(function(i){ return i.id === id; })[0];
      if(inv && !inv.paidDate) body.paidDate = todayStr();
    }
    apiFetch("/api/invoices/" + id, { method: "PATCH", body: body })
      .then(refreshAndRender)
      .catch(function(err){ console.error(err); });
  });
  document.getElementById("invoice-rows").addEventListener("click", function(e){
    var btn = e.target.closest(".inv-delete");
    if(!btn) return;
    var id = btn.closest("tr").getAttribute("data-id");
    if(!confirm("Remove this invoice?")) return;
    apiFetch("/api/invoices/" + id, { method: "DELETE" })
      .then(refreshAndRender)
      .catch(function(err){ console.error(err); });
  });
  document.getElementById("invoice-form").addEventListener("submit", function(e){
    e.preventDefault();
    var statusEl = document.getElementById("inv-status-msg");
    var pipelineId = document.getElementById("inv-pipeline").value;
    if(!pipelineId){ statusEl.textContent = "Add a Pipeline record first."; return; }
    var data = {
      pipelineId: pipelineId,
      offering: document.getElementById("inv-offering").value,
      amount: Number(document.getElementById("inv-amount").value || 0),
      status: document.getElementById("inv-status").value,
      issuedDate: document.getElementById("inv-issued").value,
      dueDate: document.getElementById("inv-due").value,
      notes: document.getElementById("inv-notes").value.trim()
    };
    apiFetch("/api/invoices", { method: "POST", body: data }).then(function(){
      document.getElementById("invoice-form").reset();
      statusEl.textContent = "Logged.";
      setTimeout(function(){ statusEl.textContent = ""; }, 2200);
      return refreshAndRender();
    }).catch(function(err){ statusEl.textContent = "Could not save: " + err.message; });
  });

  // ---------- Delivery (engagement modules, progress, time log) ----------
  function renderDelivery(){
    populatePipelineSelect(document.getElementById("dm-pipeline"));
    populatePipelineSelect(document.getElementById("te-pipeline"));
    var dl = document.getElementById("dm-name-suggestions");
    if(dl && !dl.childElementCount){
      dl.innerHTML = MODULE_NAME_SUGGESTIONS.map(function(n){ return '<option value="' + esc(n) + '">'; }).join("");
    }
    renderModuleRows();
    renderDeliveryProgress();
    renderTimeEntryRows();
  }
  function renderModuleRows(){
    var body = document.getElementById("module-rows");
    if(!body) return;
    var rows = state.engagementModules.slice().sort(function(a,b){ return (a.createdAt || "").localeCompare(b.createdAt || ""); });
    if(rows.length === 0){
      body.innerHTML = '<tr><td colspan="6" class="empty-note">No modules logged yet.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function(m){
      var opts = Object.keys(MODULE_STATUS_LABELS).map(function(k){
        return '<option value="' + k + '"' + (m.status === k ? " selected" : "") + '>' + MODULE_STATUS_LABELS[k] + '</option>';
      }).join("");
      return '<tr data-id="' + esc(m.id) + '">' +
        '<td>' + esc(pipelineLabelById(m.pipelineId)) + '</td>' +
        '<td><strong>' + esc(m.moduleName || "Untitled") + '</strong></td>' +
        '<td><select class="inline-select mod-status-select">' + opts + '</select></td>' +
        '<td class="dim">' + (m.sessionDate ? fmtDate(m.sessionDate) : "not scheduled") + '</td>' +
        '<td>' + (m.deliverableLink ? ('<a href="' + esc(m.deliverableLink) + '" target="_blank" rel="noopener">Open</a>') : '<span class="dim">none</span>') + '</td>' +
        '<td><button type="button" class="btn danger mod-delete">Remove</button></td>' +
        '</tr>';
    }).join("");
  }
  // Progress is only shown for an engagement that has at least one module
  // logged - a plain count of "0 of 0" for every other Pipeline record
  // would be noise, not information. Total is however many modules have
  // actually been logged for that engagement, not a hardcoded five, since
  // a Project Based Engagement won't always use the full five-pillar set.
  function renderDeliveryProgress(){
    var el = document.getElementById("delivery-progress-list");
    if(!el) return;
    var byPipeline = {};
    state.engagementModules.forEach(function(m){
      (byPipeline[m.pipelineId] = byPipeline[m.pipelineId] || []).push(m);
    });
    var pipelineIds = Object.keys(byPipeline);
    if(pipelineIds.length === 0){
      el.innerHTML = '<p class="empty-note">Nothing logged yet.</p>';
      return;
    }
    el.innerHTML = pipelineIds.map(function(pid){
      var mods = byPipeline[pid];
      var complete = mods.filter(function(m){ return m.status === "complete"; }).length;
      var pct = Math.round((complete / mods.length) * 100);
      var nextSession = mods.filter(function(m){ return m.status !== "complete" && m.sessionDate; })
        .sort(function(a,b){ return a.sessionDate.localeCompare(b.sessionDate); })[0];
      return '<div class="dv-progress-card">' +
        '<div class="dv-progress-head"><span class="who">' + esc(pipelineLabelById(pid)) + '</span><span class="count">' + complete + ' of ' + mods.length + ' modules complete</span></div>' +
        '<div class="dv-progress-track"><div class="dv-progress-fill" style="width:' + pct + '%"></div></div>' +
        (nextSession ? ('<div class="dv-progress-next">Next: ' + esc(nextSession.moduleName || "untitled module") + ', ' + fmtDate(nextSession.sessionDate) + '</div>') : '') +
        '</div>';
    }).join("");
  }
  function renderTimeEntryRows(){
    var body = document.getElementById("time-entry-rows");
    if(!body) return;
    var rows = state.timeEntries.slice().sort(function(a,b){ return (b.entryDate || "").localeCompare(a.entryDate || ""); });
    if(rows.length === 0){
      body.innerHTML = '<tr><td colspan="5" class="empty-note">No time logged yet.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function(t){
      return '<tr data-id="' + esc(t.id) + '">' +
        '<td>' + esc(pipelineLabelById(t.pipelineId)) + '</td>' +
        '<td class="dim">' + (t.entryDate ? fmtDate(t.entryDate) : "") + '</td>' +
        '<td class="mono">' + esc(t.minutes || 0) + '</td>' +
        '<td class="dim">' + esc(t.note || "") + '</td>' +
        '<td><button type="button" class="btn danger te-delete">Remove</button></td>' +
        '</tr>';
    }).join("");
  }
  document.getElementById("module-rows").addEventListener("change", function(e){
    if(!e.target.classList.contains("mod-status-select")) return;
    var id = e.target.closest("tr").getAttribute("data-id");
    apiFetch("/api/engagement-modules/" + id, { method: "PATCH", body: { status: e.target.value } })
      .then(refreshAndRender)
      .catch(function(err){ console.error(err); });
  });
  document.getElementById("module-rows").addEventListener("click", function(e){
    var btn = e.target.closest(".mod-delete");
    if(!btn) return;
    var id = btn.closest("tr").getAttribute("data-id");
    if(!confirm("Remove this module?")) return;
    apiFetch("/api/engagement-modules/" + id, { method: "DELETE" })
      .then(refreshAndRender)
      .catch(function(err){ console.error(err); });
  });
  document.getElementById("module-form").addEventListener("submit", function(e){
    e.preventDefault();
    var statusEl = document.getElementById("dm-status-msg");
    var pipelineId = document.getElementById("dm-pipeline").value;
    if(!pipelineId){ statusEl.textContent = "Add a Pipeline record first."; return; }
    var data = {
      pipelineId: pipelineId,
      moduleName: document.getElementById("dm-name").value.trim(),
      status: document.getElementById("dm-status").value,
      sessionDate: document.getElementById("dm-date").value,
      deliverableLink: document.getElementById("dm-link").value.trim(),
      notes: document.getElementById("dm-notes").value.trim()
    };
    if(!data.moduleName) return;
    apiFetch("/api/engagement-modules", { method: "POST", body: data }).then(function(){
      document.getElementById("module-form").reset();
      statusEl.textContent = "Logged.";
      setTimeout(function(){ statusEl.textContent = ""; }, 2200);
      return refreshAndRender();
    }).catch(function(err){ statusEl.textContent = "Could not save: " + err.message; });
  });
  document.getElementById("time-entry-rows").addEventListener("click", function(e){
    var btn = e.target.closest(".te-delete");
    if(!btn) return;
    var id = btn.closest("tr").getAttribute("data-id");
    if(!confirm("Remove this time entry?")) return;
    apiFetch("/api/time-entries/" + id, { method: "DELETE" })
      .then(refreshAndRender)
      .catch(function(err){ console.error(err); });
  });
  document.getElementById("time-form").addEventListener("submit", function(e){
    e.preventDefault();
    var statusEl = document.getElementById("te-status-msg");
    var pipelineId = document.getElementById("te-pipeline").value;
    if(!pipelineId){ statusEl.textContent = "Add a Pipeline record first."; return; }
    var data = {
      pipelineId: pipelineId,
      entryDate: document.getElementById("te-date").value || todayStr(),
      minutes: Number(document.getElementById("te-minutes").value || 0),
      note: document.getElementById("te-note").value.trim()
    };
    apiFetch("/api/time-entries", { method: "POST", body: data }).then(function(){
      document.getElementById("time-form").reset();
      statusEl.textContent = "Logged.";
      setTimeout(function(){ statusEl.textContent = ""; }, 2200);
      return refreshAndRender();
    }).catch(function(err){ statusEl.textContent = "Could not save: " + err.message; });
  });

  // ---------- Portfolio Analysis (LYBUNT/SYBUNT, gift tiers, retention) ----------
  // Deliberately client-side only, start to finish: nothing typed or
  // uploaded here ever reaches apiFetch or the server. This is a client's
  // own donor data, not Frankly Inspired's, so unlike every other view in
  // this app it is never written to Postgres - the analysis lives in
  // portfolioAnalysis (a plain JS variable) for as long as this tab is
  // open, and is gone on refresh or navigation away from the app.
  var PORTFOLIO_TIER_LABELS = { individual: "Individual", major: "Major Gift", leadership: "Leadership Gift" };
  var PORTFOLIO_STATUS_LABELS = { active: "Active", lybunt: "LYBUNT", sybunt: "SYBUNT" };
  var portfolioAnalysis = null;

  function parseCsvLine(line){
    var out = [];
    var cur = "";
    var inQuotes = false;
    for(var i = 0; i < line.length; i++){
      var ch = line[i];
      if(inQuotes){
        if(ch === '"'){
          if(line[i + 1] === '"'){ cur += '"'; i++; }
          else { inQuotes = false; }
        } else { cur += ch; }
      } else {
        if(ch === '"'){ inQuotes = true; }
        else if(ch === ','){ out.push(cur); cur = ""; }
        else { cur += ch; }
      }
    }
    out.push(cur);
    return out;
  }
  function parsePortfolioDate(s){
    if(!s) return null;
    var iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if(iso) return iso[1] + "-" + iso[2] + "-" + iso[3];
    var us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if(us){
      var mm = ("0" + us[1]).slice(-2), dd = ("0" + us[2]).slice(-2);
      return us[3] + "-" + mm + "-" + dd;
    }
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  function parsePortfolioAmount(s){
    if(s == null) return null;
    var cleaned = String(s).replace(/[$,\s]/g, "");
    if(cleaned === "") return null;
    var n = Number(cleaned);
    return isNaN(n) ? null : n;
  }
  // A header row is detected, not assumed: if the third column of the
  // first row doesn't parse as an amount, that row is a header and skipped.
  function parsePortfolioCsv(text){
    var lines = text.split(/\r\n|\r|\n/).map(function(l){ return l.trim(); }).filter(function(l){ return l.length > 0; });
    var rows = lines.map(parseCsvLine);
    if(rows.length > 0 && rows[0].length >= 3 && parsePortfolioAmount(rows[0][2]) == null){
      rows = rows.slice(1);
    }
    var gifts = [];
    var errors = 0;
    rows.forEach(function(r){
      if(r.length < 3){ errors++; return; }
      var name = (r[0] || "").trim();
      var dateStr = parsePortfolioDate((r[1] || "").trim());
      var amount = parsePortfolioAmount(r[2]);
      if(!name || !dateStr || amount == null){ errors++; return; }
      gifts.push({ donor: name, date: dateStr, amount: amount });
    });
    return { gifts: gifts, errors: errors };
  }

  // Fiscal years are keyed by the calendar year their FY starts in, so a
  // fiscal year running July 2025 to June 2026 is fyKey 2025 - avoids
  // picking a naming convention (some shops call that "FY25", others "FY26").
  function fyKeyForDate(dateStr, fyStartMonth){
    var d = new Date(dateStr + "T00:00:00");
    var y = d.getFullYear(), m = d.getMonth() + 1;
    if(fyStartMonth === 1) return y;
    return m >= fyStartMonth ? y : y - 1;
  }
  function fyLabel(fyKey, fyStartMonth){
    return fyStartMonth === 1 ? ("FY " + fyKey) : ("FY " + fyKey + "–" + (fyKey + 1));
  }

  function analyzePortfolio(gifts, opts){
    var fyStartMonth = opts.fyStartMonth, asOf = opts.asOf;
    var majorFloor = opts.majorFloor, leadershipFloor = opts.leadershipFloor;
    var currentFyKey = fyKeyForDate(asOf, fyStartMonth);
    var lastFyKey = currentFyKey - 1;
    var priorFyKey = currentFyKey - 2;

    var donors = {};
    gifts.forEach(function(g){
      var fk = fyKeyForDate(g.date, fyStartMonth);
      if(!donors[g.donor]) donors[g.donor] = { totalsByFy: {}, lastGiftDate: g.date, firstGiftFyKey: fk };
      var d = donors[g.donor];
      d.totalsByFy[fk] = (d.totalsByFy[fk] || 0) + g.amount;
      if(g.date > d.lastGiftDate) d.lastGiftDate = g.date;
      if(fk < d.firstGiftFyKey) d.firstGiftFyKey = fk;
    });

    var rows = Object.keys(donors).map(function(name){
      var d = donors[name];
      var currentTotal = d.totalsByFy[currentFyKey] || 0;
      var lastTotal = d.totalsByFy[lastFyKey] || 0;
      var priorTotal = d.totalsByFy[priorFyKey] || 0;
      var earlierTotal = 0;
      Object.keys(d.totalsByFy).forEach(function(k){
        if(Number(k) < lastFyKey) earlierTotal += d.totalsByFy[k];
      });
      // Same off-track-Rock-style priority logic as elsewhere in this app:
      // a donor giving right now is "active" regardless of history; only
      // lapsed once neither this year nor last year shows a gift.
      var status = currentTotal > 0 ? "active" : (lastTotal > 0 ? "lybunt" : "sybunt");
      var tier = lastTotal > 0
        ? (lastTotal >= leadershipFloor ? "leadership" : (lastTotal >= majorFloor ? "major" : "individual"))
        : null;
      return {
        donor: name, currentTotal: currentTotal, lastTotal: lastTotal, priorTotal: priorTotal,
        lastGiftDate: d.lastGiftDate, status: status, isNew: d.firstGiftFyKey === currentFyKey, tier: tier
      };
    });

    // Retention compares the last two COMPLETE fiscal years only (prior ->
    // last), never the in-progress current year, which would understate it.
    var priorDonors = rows.filter(function(r){ return r.priorTotal > 0; });
    var retainedDonors = priorDonors.filter(function(r){ return r.lastTotal > 0; });
    var priorDollarTotal = priorDonors.reduce(function(s, r){ return s + r.priorTotal; }, 0);
    var retainedDollarTotal = priorDonors.reduce(function(s, r){ return s + r.lastTotal; }, 0);

    var tiers = { individual: { count: 0, total: 0 }, major: { count: 0, total: 0 }, leadership: { count: 0, total: 0 } };
    rows.forEach(function(r){
      if(r.tier){ tiers[r.tier].count++; tiers[r.tier].total += r.lastTotal; }
    });

    return {
      rows: rows, currentFyKey: currentFyKey, lastFyKey: lastFyKey, priorFyKey: priorFyKey, fyStartMonth: fyStartMonth,
      donorRetentionRate: priorDonors.length > 0 ? (retainedDonors.length / priorDonors.length) : null,
      dollarRetentionRate: priorDollarTotal > 0 ? (retainedDollarTotal / priorDollarTotal) : null,
      lybuntCount: rows.filter(function(r){ return r.status === "lybunt"; }).length,
      sybuntCount: rows.filter(function(r){ return r.status === "sybunt"; }).length,
      lastFyTotalRaised: rows.reduce(function(s, r){ return s + r.lastTotal; }, 0),
      lastFyDonorCount: rows.filter(function(r){ return r.lastTotal > 0; }).length,
      tiers: tiers
    };
  }

  function renderPortfolioResults(analysis){
    document.getElementById("port-summary-card").hidden = false;
    document.getElementById("port-tier-card").hidden = false;
    document.getElementById("port-donors-card").hidden = false;

    var lastLabel = fyLabel(analysis.lastFyKey, analysis.fyStartMonth);
    var currentLabel = fyLabel(analysis.currentFyKey, analysis.fyStartMonth);
    var priorLabel = fyLabel(analysis.priorFyKey, analysis.fyStartMonth);

    document.getElementById("port-summary-note").textContent =
      analysis.rows.length + " donor" + (analysis.rows.length === 1 ? "" : "s") + " in this file, " +
      lastLabel + " (most recent complete fiscal year) compared against " + currentLabel + " to date.";

    var retentionDonorHtml = analysis.donorRetentionRate == null ? "&mdash;" : Math.round(analysis.donorRetentionRate * 100) + "%";
    var retentionDollarHtml = analysis.dollarRetentionRate == null ? "&mdash;" : Math.round(analysis.dollarRetentionRate * 100) + "%";

    document.getElementById("port-summary-stats").innerHTML = [
      ["Donors, " + lastLabel, analysis.lastFyDonorCount],
      ["Raised, " + lastLabel, fmtMoneyShort(analysis.lastFyTotalRaised)],
      ["Donor retention, " + priorLabel + " → " + lastLabel, retentionDonorHtml],
      ["Dollar retention, " + priorLabel + " → " + lastLabel, retentionDollarHtml],
      ["LYBUNT (gave " + lastLabel + ", not yet " + currentLabel + ")", analysis.lybuntCount],
      ["SYBUNT (lapsed before " + lastLabel + ")", analysis.sybuntCount]
    ].map(function(pair){
      return '<div class="stat-card"><span class="num mono">' + pair[1] + '</span><span class="cap">' + esc(pair[0]) + '</span></div>';
    }).join("");

    document.getElementById("port-tier-note").textContent = "Individual, Major Gift, and Leadership Gift, by total giving in " + lastLabel + ".";
    document.getElementById("port-tier-stats").innerHTML = ["individual", "major", "leadership"].map(function(t){
      var stat = analysis.tiers[t];
      return '<div class="stat-card"><span class="num mono">' + stat.count + '</span><span class="cap">' + PORTFOLIO_TIER_LABELS[t] + ' &middot; ' + fmtMoneyShort(stat.total) + '</span></div>';
    }).join("");

    var sorted = analysis.rows.slice().sort(function(a, b){ return b.lastTotal - a.lastTotal || b.currentTotal - a.currentTotal; });
    var body = document.getElementById("port-donor-rows");
    if(sorted.length === 0){
      body.innerHTML = '<tr><td colspan="6" class="empty-note">No gift rows parsed. Check the CSV format.</td></tr>';
      return;
    }
    body.innerHTML = sorted.map(function(r){
      var tierPill = r.tier ? ('<span class="donor-tier-pill tier-' + r.tier + '">' + PORTFOLIO_TIER_LABELS[r.tier] + '</span>') : '<span class="dim">&mdash;</span>';
      var statusPill = '<span class="donor-status-pill status-' + r.status + '">' + PORTFOLIO_STATUS_LABELS[r.status] + '</span>' + (r.isNew ? '<span class="donor-new-badge">New</span>' : '');
      return '<tr>' +
        '<td>' + esc(r.donor) + '</td>' +
        '<td>' + tierPill + '</td>' +
        '<td>' + statusPill + '</td>' +
        '<td class="mono">' + fmtMoneyShort(r.lastTotal) + '</td>' +
        '<td class="mono">' + fmtMoneyShort(r.currentTotal) + '</td>' +
        '<td class="dim">' + fmtDate(r.lastGiftDate) + '</td>' +
        '</tr>';
    }).join("");
  }

  function csvEscape(v){
    var s = String(v == null ? "" : v);
    return /[",\n]/.test(s) ? ('"' + s.replace(/"/g, '""') + '"') : s;
  }
  function exportPortfolioCsv(analysis, clientLabel){
    var header = ["Donor", "Tier", "Status", "New This Year", "Last FY Total", "This FY To Date", "Last Gift Date"];
    var lines = [header.join(",")];
    analysis.rows.slice().sort(function(a, b){ return b.lastTotal - a.lastTotal; }).forEach(function(r){
      var cells = [
        r.donor, r.tier ? PORTFOLIO_TIER_LABELS[r.tier] : "", PORTFOLIO_STATUS_LABELS[r.status], r.isNew ? "Yes" : "",
        r.lastTotal.toFixed(2), r.currentTotal.toFixed(2), r.lastGiftDate
      ];
      lines.push(cells.map(csvEscape).join(","));
    });
    var blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob);
    var safeLabel = (clientLabel || "portfolio").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "portfolio";
    var a = document.createElement("a");
    a.href = url;
    a.download = safeLabel + "-portfolio-analysis.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  }

  var portAsOfInput = document.getElementById("port-as-of");
  if(portAsOfInput && !portAsOfInput.value) portAsOfInput.value = todayStr();

  var portCsvFile = document.getElementById("port-csv-file");
  if(portCsvFile) portCsvFile.addEventListener("change", function(e){
    var file = e.target.files && e.target.files[0];
    if(!file) return;
    var reader = new FileReader();
    reader.onload = function(){ document.getElementById("port-csv-input").value = String(reader.result || ""); };
    reader.readAsText(file);
  });

  var portParseBtn = document.getElementById("port-parse-btn");
  if(portParseBtn) portParseBtn.addEventListener("click", function(){
    var statusEl = document.getElementById("port-status-msg");
    var text = document.getElementById("port-csv-input").value;
    if(!text.trim()){ statusEl.textContent = "Paste or upload gift data first."; return; }
    var parsed = parsePortfolioCsv(text);
    if(parsed.gifts.length === 0){ statusEl.textContent = "Could not parse any gift rows. Check the CSV format (donor name, gift date, amount)."; return; }
    var asOf = document.getElementById("port-as-of").value || todayStr();
    var fyStartMonth = Number(document.getElementById("port-fy-start").value || 1);
    var majorFloor = Number(document.getElementById("port-major-floor").value || 1000);
    var leadershipFloor = Number(document.getElementById("port-leadership-floor").value || 10000);
    var analysis = analyzePortfolio(parsed.gifts, { asOf: asOf, fyStartMonth: fyStartMonth, majorFloor: majorFloor, leadershipFloor: leadershipFloor });
    portfolioAnalysis = analysis;
    renderPortfolioResults(analysis);
    document.getElementById("port-export-btn").disabled = false;
    statusEl.textContent = parsed.errors > 0
      ? ("Analyzed " + parsed.gifts.length + " gift rows (" + parsed.errors + " row" + (parsed.errors === 1 ? "" : "s") + " skipped, couldn't parse).")
      : ("Analyzed " + parsed.gifts.length + " gift rows.");
  });

  var portExportBtn = document.getElementById("port-export-btn");
  if(portExportBtn) portExportBtn.addEventListener("click", function(){
    if(!portfolioAnalysis) return;
    exportPortfolioCsv(portfolioAnalysis, document.getElementById("port-client-label").value.trim());
  });

  // ---------- Practice Trends (own-data analytics: conversion, deal size, prospect velocity) ----------
  // Unlike the forecast cards above (a linear projection from recent weeks),
  // these three charts show what actually happened, month by month, pulled
  // from Franklin's own pipeline and prospecting records - the same
  // as-originally-logged discipline used for the National Giving Trends
  // benchmark on the Giving Landscape page. A month with no closed pipeline
  // record, no tracked deal value, or no prospect promotion simply isn't
  // plotted - nothing here is interpolated or estimated to fill a gap.
  // Loaded once at boot (like the org structural summary) rather than on
  // every refreshAndRender, since it's a server-aggregated read, not part
  // of the core /api/state payload.
  var practiceTrends = null;

  function loadPracticeTrends(){
    return apiFetch("/api/analytics/practice-trends").then(function(data){
      practiceTrends = data;
      renderPracticeTrends();
    }).catch(function(){
      practiceTrends = { conversion: [], dealSize: [], velocity: [] };
      renderPracticeTrends();
    });
  }

  function monthLabel(m){
    var parts = String(m).split("-");
    if(parts.length !== 2) return esc(m);
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
    return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  }
  function monthIndex(m){
    var parts = String(m).split("-");
    return Number(parts[0]) * 12 + (Number(parts[1]) - 1);
  }

  // A leaner cousin of buildForecastCard above: an actuals-only line (no
  // regression, no projection), with a dashed segment across any gap month
  // rather than implying continuous data the series doesn't have - the same
  // honesty device nationalTotalChartHtml uses for Giving USA's missing years.
  function buildTrendLineCard(title, points, fmt, emptyNote, sourceNote){
    if(!points || points.length === 0){
      return '<div class="chart-card"><h4>' + esc(title) + '</h4><p class="empty-note" style="border:none;padding-left:0;">' + esc(emptyNote) + '</p>' +
        (sourceNote ? '<p class="nt-source" style="margin-top:8px;">' + esc(sourceNote) + '</p>' : '') + '</div>';
    }
    var sorted = points.slice().sort(function(a,b){ return monthIndex(a.month) - monthIndex(b.month); });
    var last = sorted[sorted.length - 1];
    var prev = sorted.length > 1 ? sorted[sorted.length - 2] : null;
    if(sorted.length === 1){
      return '<div class="chart-card"><h4>' + esc(title) + '</h4><span class="chart-now">' + esc(fmt(last.value)) + '</span>' +
        '<p class="empty-note" style="border:none;padding-left:0;margin-top:8px;">Only ' + esc(monthLabel(last.month)) + ' logged so far' + (last.meta ? (' (' + esc(last.meta) + ')') : '') + '. This fills in as more months are logged.</p>' +
        (sourceNote ? '<p class="nt-source" style="margin-top:8px;">' + esc(sourceNote) + '</p>' : '') +
        '</div>';
    }
    var w = 260, h = 110, padL = 8, padR = 8, padT = 10, padB = 10;
    var n = sorted.length;
    var values = sorted.map(function(p){ return p.value; });
    var minY = Math.min.apply(null, values.concat([0]));
    var maxY = Math.max.apply(null, values);
    if(minY === maxY){ minY -= 1; maxY += 1; }
    var padY = (maxY - minY) * 0.15;
    minY -= padY; maxY += padY;
    if(values.every(function(v){ return v >= 0; })) minY = Math.max(minY, 0);
    var xScale = function(i){ return n === 1 ? (w/2) : (padL + (i/(n-1)) * (w - padL - padR)); };
    var yScale = function(v){ return padT + (1 - (v-minY)/(maxY-minY)) * (h - padT - padB); };
    var solidSegs = [], dashedSegs = [];
    for(var i = 1; i < n; i++){
      var seg = "M" + xScale(i-1).toFixed(1) + "," + yScale(sorted[i-1].value).toFixed(1) + " L" + xScale(i).toFixed(1) + "," + yScale(sorted[i].value).toFixed(1);
      if(monthIndex(sorted[i].month) - monthIndex(sorted[i-1].month) === 1) solidSegs.push(seg); else dashedSegs.push(seg);
    }
    var markers = sorted.map(function(p,i){
      var tipValue = fmt(p.value) + (p.meta ? (" · " + p.meta) : "");
      return '<circle class="fc-pt" cx="' + xScale(i).toFixed(1) + '" cy="' + yScale(p.value).toFixed(1) + '" r="3" fill="var(--accent-strong)" data-date="' + esc(monthLabel(p.month)) + '" data-value="' + esc(tipValue) + '"></circle>';
    }).join("");
    var svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(title) + ' by month">' +
      solidSegs.map(function(s){ return '<path d="' + s + '" fill="none" stroke="var(--accent-strong)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>'; }).join("") +
      dashedSegs.map(function(s){ return '<path d="' + s + '" fill="none" stroke="var(--accent-strong)" stroke-width="2" stroke-linecap="round" stroke-dasharray="4 3"></path>'; }).join("") +
      markers + '</svg>';
    var deltaHtml = "";
    if(prev){
      var delta = last.value - prev.value;
      var deltaClass = delta > 0 ? "up" : (delta < 0 ? "down" : "");
      deltaHtml = '<span class="chart-delta ' + deltaClass + '">' + (delta === 0 ? "flat" : (delta > 0 ? "+" + fmt(delta) : "" + fmt(delta))) + ' vs ' + esc(monthLabel(prev.month)) + '</span>';
    }
    return '<div class="chart-card">' +
      '<h4>' + esc(title) + '</h4>' +
      '<span class="chart-now">' + esc(fmt(last.value)) + '</span>' + deltaHtml +
      svg +
      '<div class="chart-proj">' + esc(monthLabel(last.month)) + (last.meta ? (' &middot; ' + esc(last.meta)) : '') + '</div>' +
      (sourceNote ? '<p class="nt-source" style="margin-top:6px;">' + esc(sourceNote) + '</p>' : '') +
      '</div>';
  }

  // Shared by the full Forecasting charts and the Command Center's headline
  // tiles, so both read the exact same three series off practiceTrends
  // rather than each having its own copy of what counts as a valid month.
  function practiceTrendSeries(){
    return {
      conversion: {
        title: "Pipeline conversion rate", fmt: function(v){ return Math.round(v*100) + "%"; },
        points: practiceTrends.conversion.filter(function(c){ return c.rate !== null; }).map(function(c){
          return { month: c.month, value: c.rate, meta: c.won + " won of " + c.closed + " closed" };
        }),
        emptyNote: "No pipeline record has reached Graduated, Lost, or Referred Out yet, so there is no closed month to show. This fills in as records move to a closed stage.",
        sourceNote: "Share of closed pipeline records (Graduated, Lost, or Referred Out) that graduated, grouped by the month each record was last moved into a closed stage."
      },
      dealSize: {
        title: "Average deal size", fmt: function(v){ return fmtMoneyShort(v); },
        points: practiceTrends.dealSize.map(function(d){
          return { month: d.month, value: d.avgValue, meta: d.count + (d.count === 1 ? " deal" : " deals") };
        }),
        emptyNote: "No Graduated pipeline record has a deal value logged yet. Fill in “Deal value” on a Pipeline record once an engagement is signed, and it shows up here.",
        sourceNote: "Average logged deal value among Graduated pipeline records, by the month each graduated. Records with no deal value logged are left out, never counted as zero."
      },
      velocity: {
        title: "Prospect velocity", fmt: function(v){ return v.toFixed(1) + " days"; },
        points: practiceTrends.velocity.filter(function(v){ return v.avgDays !== null; }).map(function(v){
          return { month: v.month, value: v.avgDays, meta: v.count + (v.count === 1 ? " prospect" : " prospects") };
        }),
        emptyNote: "No prospect has been promoted to the Pipeline yet. This tracks how long a prospect sits in Prospecting before being promoted.",
        sourceNote: "Average days from when a prospect was first logged to when it was promoted to the Pipeline, grouped by the month of promotion."
      }
    };
  }

  function renderPracticeTrends(){
    var container = document.getElementById("practice-trends-charts");
    if(container){
      if(!practiceTrends){
        container.innerHTML = '<p class="empty-note">Loading&hellip;</p>';
      } else {
        var s = practiceTrendSeries();
        var cards = [s.conversion, s.dealSize, s.velocity].map(function(m){
          return buildTrendLineCard(m.title, m.points, m.fmt, m.emptyNote, m.sourceNote);
        });
        container.innerHTML = cards.join("");
        container.querySelectorAll(".fc-pt").forEach(function(pt){
          pt.addEventListener("mousemove", function(e){ showChartTooltip(e, pt.getAttribute("data-date") + ": " + pt.getAttribute("data-value")); });
          pt.addEventListener("mouseleave", hideChartTooltip);
        });
      }
    }
    // Command Center's headline tiles read the same practiceTrends data -
    // rendered here too so they refresh the moment the fetch resolves,
    // the same way the full charts above do, not just on the next full
    // renderAll() pass.
    renderCcTrendTiles();
  }

  // ---------- automation health (Dashboard: status of the five scheduled jobs) ----------
  var automationStatus = null;

  function loadAutomationStatus(){
    return apiFetch("/api/automation-status").then(function(data){
      automationStatus = data.jobs || [];
      renderAutomationHealth();
    }).catch(function(){
      automationStatus = [];
      renderAutomationHealth();
    });
  }

  // Renders into every element id given - the same automation status feeds
  // both the Dashboard's original panel and the Command Center's copy, and
  // this way there is exactly one place that turns automationStatus into
  // markup for either of them to stay in sync with.
  function renderAutomationHealth(){
    var ids = ["automation-health-list", "cc-automation-health-list"];
    var html;
    if(automationStatus === null){
      html = '<p class="empty-note" style="border:none;">Loading&hellip;</p>';
    } else if(automationStatus.length === 0){
      html = '<p class="empty-note" style="border:none;">No automations registered yet.</p>';
    } else {
      html = automationStatus.map(function(j){
        var dot;
        if(j.staleness === "never") dot = "neutral";
        else if(j.staleness === "stale") dot = "warn";
        else dot = (j.lastStatus === "ok") ? "good" : "warn";
        var when = j.lastRanAt ? fmtDate(String(j.lastRanAt).slice(0,10)) : "Never reported";
        var detail;
        if(j.lastRanAt){
          detail = (j.lastStatus || "unknown status");
          if(j.lastItemCount !== null && j.lastItemCount !== undefined) detail += ", " + j.lastItemCount + (j.lastItemCount === 1 ? " item" : " items");
          if(j.lastMessage) detail += " — " + j.lastMessage;
          if(j.staleness === "stale") detail += " (overdue, expected every " + j.expectedCadence + ")";
        } else {
          detail = "expected every " + j.expectedCadence;
        }
        return '<div class="session-recap-line">' + dotHtml(dot) + '<span><strong>' + esc(j.label) + '</strong> &middot; ' + esc(when) + ' &middot; ' + esc(detail) + '</span></div>';
      }).join("");
    }
    ids.forEach(function(id){
      var el = document.getElementById(id);
      if(el) el.innerHTML = html;
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

  // ---------- Giving Landscape (landing page): national chart + gift ticker + state grid ----------
  function fmtMoneyShort(n){
    n = Number(n) || 0;
    if(n <= 0) return "$0";
    if(n < 1000) return "$" + Math.round(n);
    if(n < 1e6) return "$" + Math.round(n/1e3) + "K";
    if(n < 1e9) return "$" + (n/1e6).toFixed(n/1e6 < 10 ? 1 : 0) + "M";
    return "$" + (n/1e9).toFixed(2) + "B";
  }
  function fmtMoneyExact(n){
    n = Math.round(Number(n) || 0);
    return "$" + n.toLocaleString("en-US");
  }

  function initGivingLandscapeStatic(){
    var catBar = document.getElementById("gl-category-filters");
    var extra = GIVING_USA_CATEGORIES.map(function(c){
      return '<button type="button" class="filter-btn" data-cat="' + c.key + '">' + esc(c.label) + '</button>';
    }).join("") + '<button type="button" class="filter-btn" data-cat="other">Other</button>';
    catBar.insertAdjacentHTML("beforeend", extra);
    catBar.addEventListener("click", function(e){
      var btn = e.target.closest(".filter-btn");
      if(!btn) return;
      giftCategoryFilter = btn.getAttribute("data-cat");
      catBar.querySelectorAll(".filter-btn").forEach(function(b){ b.classList.toggle("is-active", b === btn); });
      renderGiftTicker();
    });

    var stateSel = document.getElementById("gf-state");
    stateSel.innerHTML = '<option value="">Not specified</option>' + US_REGIONS.map(function(r){
      return '<optgroup label="' + esc(r.name) + '">' + r.states.map(function(s){
        return '<option value="' + s[0] + '">' + esc(s[1]) + '</option>';
      }).join("") + '</optgroup>';
    }).join("");

    var catSel = document.getElementById("gf-category");
    catSel.innerHTML = GIVING_USA_CATEGORIES.map(function(c){
      return '<option value="' + c.key + '">' + esc(c.label) + '</option>';
    }).join("") + '<option value="other" selected>Other / unspecified</option>';

    var giftTypeSel = document.getElementById("gf-gifttype");
    giftTypeSel.innerHTML = '<option value="">Not specified</option>' + GIFT_TYPES.map(function(t){
      return '<option value="' + esc(t) + '">' + esc(t) + '</option>';
    }).join("");

    var restrictionSel = document.getElementById("gf-restriction");
    restrictionSel.innerHTML = '<option value="">Not specified</option>' + GIFT_RESTRICTIONS.map(function(t){
      return '<option value="' + esc(t) + '">' + esc(t) + '</option>';
    }).join("");

    var mapWrap = document.getElementById("gl-us-map-wrap");
    mapWrap.addEventListener("click", function(e){
      var pathEl = e.target.closest(".us-state");
      if(!pathEl) return;
      var abbr = pathEl.getAttribute("data-abbr");
      selectedGiftState = (selectedGiftState === abbr) ? null : abbr;
      renderStateGrid();
      renderGiftTicker();
    });
    mapWrap.addEventListener("mousemove", function(e){
      var pathEl = e.target.closest(".us-state");
      if(!pathEl){ hideChartTooltip(); return; }
      showChartTooltip(e, pathEl.getAttribute("data-tip"));
    });
    mapWrap.addEventListener("mouseleave", hideChartTooltip);

    loadUsMapData();
    bindOrgHealthEvents();

    // Sub-navigation across the six Giving Landscape panels - purely a
    // display switch, every panel still renders on every refresh so its
    // data is current the moment it's opened. Charts use viewBox-based SVG
    // sized off their own data, not the container's on-screen width, so
    // being hidden while their numbers update never leaves them stale or
    // mis-sized when a tab is opened later.
    var glTabs = document.getElementById("gl-tabs");
    if(glTabs){
      glTabs.addEventListener("click", function(e){
        var btn = e.target.closest("[data-lg-tab]");
        if(!btn) return;
        var target = btn.getAttribute("data-lg-tab");
        glTabs.querySelectorAll("[data-lg-tab]").forEach(function(b){
          var active = b === btn;
          b.classList.toggle("is-active", active);
          b.setAttribute("aria-selected", active ? "true" : "false");
        });
        document.querySelectorAll('.view[data-view="landscape"] .fw-card[data-lg-tab]').forEach(function(card){
          card.hidden = (card.getAttribute("data-lg-tab") !== target);
        });
      });
    }

    document.getElementById("gl-ticker-list").addEventListener("click", function(e){
      var delBtn = e.target.closest(".gift-delete");
      if(delBtn){
        var id = delBtn.closest(".gift-card").getAttribute("data-id");
        if(!confirm("Remove this gift from the ticker?")) return;
        apiFetch("/api/gifts/" + id, { method: "DELETE" }).then(refreshAndRender).catch(function(err){ console.error(err); });
        return;
      }
      var pubBtn = e.target.closest(".gift-public-toggle");
      if(pubBtn){
        var gid = pubBtn.closest(".gift-card").getAttribute("data-id");
        var nextVal = pubBtn.getAttribute("data-public") !== "1";
        apiFetch("/api/gifts/" + gid + "/public", { method: "POST", body: { publicOk: nextVal } }).then(refreshAndRender).catch(function(err){ console.error(err); });
      }
    });

    document.getElementById("gift-form").addEventListener("submit", function(e){
      e.preventDefault();
      var statusEl = document.getElementById("gf-status");
      var org = document.getElementById("gf-org").value.trim();
      if(!org) return;
      var data = {
        donor: document.getElementById("gf-donor").value.trim(),
        org: org,
        state: document.getElementById("gf-state").value,
        category: document.getElementById("gf-category").value,
        amount: Number(document.getElementById("gf-amount").value || 0),
        announcedAt: document.getElementById("gf-date").value,
        headline: document.getElementById("gf-headline").value.trim(),
        source: document.getElementById("gf-source").value.trim(),
        url: document.getElementById("gf-url").value.trim(),
        giftType: document.getElementById("gf-gifttype").value,
        restriction: document.getElementById("gf-restriction").value,
        impact: document.getElementById("gf-impact").value.trim(),
        trendSignal: document.getElementById("gf-trend").value.trim(),
        playbook: document.getElementById("gf-playbook").value.trim()
      };
      apiFetch("/api/gifts", { method: "POST", body: data }).then(function(){
        document.getElementById("gift-form").reset();
        document.getElementById("gf-category").value = "other";
        statusEl.textContent = "Logged.";
        setTimeout(function(){ statusEl.textContent = ""; }, 2200);
        return refreshAndRender();
      }).catch(function(err){ statusEl.textContent = "Could not save: " + err.message; });
    });
  }

  function renderNationalBars(){
    var container = document.getElementById("gl-national-bars");
    var withData = GIVING_USA_CATEGORIES.filter(function(c){ return c.amountB !== null; });
    var max = Math.max.apply(null, withData.map(function(c){ return c.amountB; }));
    var sorted = withData.slice().sort(function(a,b){ return b.amountB - a.amountB; });
    var rows = sorted.map(function(c){
      var pctWidth = Math.max(3, (c.amountB/max)*100);
      var growthHtml = c.growth === null ? "" : ('<span class="gb-growth ' + (c.growth >= 0 ? "up" : "down") + '">' + (c.growth >= 0 ? "+" : "") + c.growth.toFixed(1) + '% real</span>');
      return '<div class="gb-row">' +
        '<span class="gb-label">' + esc(c.label) + '</span>' +
        '<div class="gb-track"><div class="gb-fill" style="width:' + pctWidth.toFixed(1) + '%"></div></div>' +
        '<span class="gb-value">$' + c.amountB.toFixed(1) + 'B &middot; ' + c.pct + '%' + growthHtml + '</span>' +
        '</div>';
    }).join("");
    var skipped = GIVING_USA_CATEGORIES.filter(function(c){ return c.amountB === null; });
    var skippedNote = skipped.length ? '<p class="nt-hint" style="margin-top:10px;">Giving USA has not published a 2025 dollar figure for ' + skipped.map(function(c){ return c.label.toLowerCase(); }).join(", ") + ', so it is left off these bars.</p>' : "";
    container.innerHTML = rows + skippedNote;
  }

  function renderGiftStats(){
    var gifts = state.gifts;
    document.getElementById("gl-stat-gift-count").textContent = gifts.length;
    var total = gifts.reduce(function(sum,g){ return sum + (Number(g.amount) || 0); }, 0);
    document.getElementById("gl-stat-gift-total").textContent = fmtMoneyShort(total);
    var seen = {};
    gifts.forEach(function(g){ if(g.state) seen[g.state] = 1; });
    document.getElementById("gl-stat-state-count").textContent = Object.keys(seen).length;
  }

  function renderGiftTicker(){
    var list = document.getElementById("gl-ticker-list");
    var refreshedEl = document.getElementById("gl-ticker-refreshed");
    if(state.gifts.length === 0){
      refreshedEl.textContent = "No gifts logged yet";
    } else {
      var latest = state.gifts.reduce(function(max,g){ return (g.loggedAt || "") > max ? (g.loggedAt || "") : max; }, "");
      refreshedEl.textContent = latest ? ("Last refreshed " + fmtDate(latest.slice(0,10))) : "";
    }

    var gifts = state.gifts.filter(function(g){
      if(giftCategoryFilter !== "all" && g.category !== giftCategoryFilter) return false;
      if(selectedGiftState && g.state !== selectedGiftState) return false;
      return true;
    }).slice().sort(function(a,b){ return (b.announcedAt || b.loggedAt || "").localeCompare(a.announcedAt || a.loggedAt || ""); });

    if(gifts.length === 0){
      list.innerHTML = '<p class="empty-note">' + (state.gifts.length === 0
        ? "Nothing logged yet. Add the first major gift below, or wait for this week&rsquo;s Field Intelligence pass."
        : "No gifts match this filter.") + '</p>';
      return;
    }
    list.innerHTML = gifts.map(function(g){
      var who = g.donor ? (esc(g.donor) + " &rarr; " + esc(g.org || "Untitled")) : esc(g.org || "Untitled");
      var stateTag = g.state ? (' &middot; ' + esc(STATE_NAME_BY_ABBR[g.state] || g.state)) : "";
      return '<div class="gift-card" data-id="' + esc(g.id) + '">' +
        '<div class="gift-card-head"><h4>' + who + '</h4><span class="gift-amount">' + fmtMoneyExact(g.amount) + '</span></div>' +
        (g.headline || g.summary ? '<p>' + esc(g.headline || g.summary) + '</p>' : '') +
        '<div class="gift-meta"><span class="pill">' + esc(GIFT_CATEGORY_LABELS[g.category] || g.category) + '</span><span>' + fmtDate(g.announcedAt) + stateTag + '</span>' +
        (g.source ? (' &middot; <span>' + esc(g.source) + '</span>') : '') +
        (g.url ? (' &middot; <a href="' + esc(g.url) + '" target="_blank" rel="noopener">Read more</a>') : '') +
        ' <button type="button" class="btn public-toggle' + (g.publicOk ? ' is-on' : '') + ' gift-public-toggle" data-public="' + (g.publicOk ? "1" : "0") + '" style="margin-left:8px;" title="Show this gift (just the gift, not our case-study notes) on the public Giving Landscape page.">' + (g.publicOk ? "On public page" : "Add to public page") + '</button>' +
        ' <button type="button" class="btn danger gift-delete" style="margin-left:8px;">Remove</button></div>' +
        giftCaseStudyHtml(g) +
        '</div>';
    }).join("");
  }

  // Gift type, restriction, impact, trend signal, and a replication idea, as
  // short labeled data fields rather than a paragraph. hasCaseStudy/
  // giftCaseStudyGridHtml are shared with the Playbook Library below, which
  // is just this same content pulled out of every gift and made searchable
  // in one place instead of read one collapsed disclosure at a time.
  function hasCaseStudy(g){
    return !!(g.impact || g.trendSignal || g.playbook || g.giftType || g.restriction);
  }
  function giftCaseStudyGridHtml(g){
    var fields = [];
    if(g.impact) fields.push(["Impact", esc(g.impact)]);
    if(g.trendSignal) fields.push(["Trend signal", esc(g.trendSignal)]);
    if(g.playbook) fields.push(["Replication idea", esc(g.playbook)]);
    if(fields.length === 0 && !g.giftType && !g.restriction) return "";
    var pills = (g.giftType ? '<span class="pill">' + esc(g.giftType) + '</span>' : "") +
      (g.restriction ? '<span class="pill">' + esc(g.restriction) + '</span>' : "");
    return '<div class="gift-cs-grid">' +
      (pills ? '<div class="gift-cs-field"><span class="gift-cs-label">Gift structure</span><div class="gift-cs-pills">' + pills + '</div></div>' : "") +
      fields.map(function(f){ return '<div class="gift-cs-field"><span class="gift-cs-label">' + esc(f[0]) + '</span><span class="gift-cs-value">' + f[1] + '</span></div>'; }).join("") +
      '</div>';
  }
  // Click-to-open breakdown on the ticker card. Renders nothing (no empty
  // disclosure) when a gift has none of these filled in yet - e.g. older
  // rows logged before this was added.
  function giftCaseStudyHtml(g){
    var grid = giftCaseStudyGridHtml(g);
    if(!grid) return "";
    return '<details class="gift-cs"><summary>View case study breakdown</summary>' + grid + '</details>';
  }

  function stateAggregates(){
    var byState = {};
    state.gifts.forEach(function(g){
      if(!g.state) return;
      if(!byState[g.state]) byState[g.state] = { count: 0, total: 0, latest: null, latestDate: "" };
      var agg = byState[g.state];
      agg.count++;
      agg.total += Number(g.amount) || 0;
      var d = g.announcedAt || g.loggedAt || "";
      if(!agg.latest || d > agg.latestDate){ agg.latest = g; agg.latestDate = d; }
    });
    return byState;
  }

  function renderStateDetail(byState){
    var box = document.getElementById("gl-state-detail");
    if(!selectedGiftState){ box.hidden = true; return; }
    var agg = byState[selectedGiftState];
    var name = STATE_NAME_BY_ABBR[selectedGiftState] || selectedGiftState;
    box.hidden = false;
    if(!agg){
      box.innerHTML = '<strong>' + esc(name) + '</strong><p style="margin:8px 0 0;color:var(--ink-soft);">No gifts logged yet for this state.</p>';
      return;
    }
    box.innerHTML = '<strong>' + esc(name) + '</strong>' +
      '<p style="margin:8px 0 0;color:var(--ink-soft);">' + agg.count + ' gift' + (agg.count === 1 ? "" : "s") + ' logged, ' + fmtMoneyExact(agg.total) + ' tracked. Most recent: ' +
      esc(agg.latest.org || "Untitled") + (agg.latest.donor ? (" from " + esc(agg.latest.donor)) : "") + ', ' + fmtDate(agg.latest.announcedAt || agg.latest.loggedAt) + '.</p>';
  }

  function loadUsMapData(){
    if(usMapData || usMapLoading) return;
    usMapLoading = true;
    fetch("/us-states.json").then(function(r){
      if(!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function(data){
      usMapData = data;
      usMapLoading = false;
      renderStateGrid();
    }).catch(function(err){
      usMapLoading = false;
      console.error("Could not load map data", err);
      var wrap = document.getElementById("gl-us-map-wrap");
      if(wrap) wrap.innerHTML = '<p class="empty-note">Map data could not be loaded.</p>';
    });
  }

  function renderUsMap(byState, maxTotal){
    var wrap = document.getElementById("gl-us-map-wrap");
    if(!wrap) return;
    if(!usMapData){
      wrap.innerHTML = '<p class="empty-note">Loading map&hellip;</p>';
      return;
    }
    var paths = Object.keys(usMapData.states).map(function(abbr){
      var s = usMapData.states[abbr];
      var name = STATE_NAME_BY_ABBR[abbr] || abbr;
      var agg = byState[abbr];
      var hasData = !!agg;
      var intensity = hasData && maxTotal > 0 ? Math.max(0.18, agg.total/maxTotal) : 0;
      var selected = selectedGiftState === abbr;
      var cls = "us-state" + (hasData ? " has-data" : "") + (selected ? " is-selected" : "");
      var tip = esc(name) + (hasData ? (': ' + agg.count + ' gift' + (agg.count === 1 ? '' : 's') + ', ' + fmtMoneyExact(agg.total)) : ': no gifts logged yet');
      return '<path class="' + cls + '" data-abbr="' + abbr + '" data-tip="' + tip + '" d="' + s.d + '"' +
        (hasData ? (' style="fill-opacity:' + intensity.toFixed(2) + '"') : '') + '></path>';
    }).join("");
    wrap.innerHTML = '<svg viewBox="0 0 ' + usMapData.viewBox[0] + ' ' + usMapData.viewBox[1] + '" role="img" aria-label="Map of U.S. states shaded by total gift dollars logged, darker means more">' + paths + '</svg>';
  }

  function renderStateGrid(){
    var byState = stateAggregates();
    var maxTotal = 0;
    Object.keys(byState).forEach(function(k){ if(byState[k].total > maxTotal) maxTotal = byState[k].total; });

    renderUsMap(byState, maxTotal);

    var rows = Object.keys(byState).map(function(k){ var a = byState[k]; return { abbr: k, count: a.count, total: a.total, latest: a.latest }; })
      .sort(function(a,b){ return b.total - a.total; });
    var tableBody = document.getElementById("gl-state-table");
    if(rows.length === 0){
      tableBody.innerHTML = '<tr><td colspan="4" class="empty-note">No gifts logged yet.</td></tr>';
    } else {
      tableBody.innerHTML = rows.map(function(r){
        return '<tr><td><strong>' + esc(STATE_NAME_BY_ABBR[r.abbr] || r.abbr) + '</strong></td><td>' + r.count + '</td><td>' + fmtMoneyExact(r.total) + '</td><td class="dim">' + esc((r.latest && r.latest.org) || "") + '</td></tr>';
      }).join("");
    }

    renderStateDetail(byState);
  }

  // Each recipient organization tracked like a position: gifts logged for it,
  // in the order they were announced, rolled into a running total. "Growth"
  // is that total's history; the "move" a stock tracker would show for today
  // is, here, how much the most recent gift added to the total that came
  // before it - the only notion of a period this data actually has.
  function orgGrowthData(){
    var byOrg = {};
    state.gifts.forEach(function(g){
      var org = (g.org || "").trim();
      if(!org) return;
      (byOrg[org] = byOrg[org] || []).push(g);
    });
    var orgs = Object.keys(byOrg).map(function(org){
      var gifts = byOrg[org].slice().sort(function(a,b){
        return (a.announcedAt || a.loggedAt || "").localeCompare(b.announcedAt || b.loggedAt || "");
      });
      var running = 0;
      var cumulative = gifts.map(function(g){
        running += Number(g.amount) || 0;
        return { date: g.announcedAt || g.loggedAt || "", value: running };
      });
      var prevTotal = cumulative.length > 1 ? cumulative[cumulative.length - 2].value : 0;
      var latest = gifts[gifts.length - 1];
      var latestAmount = Number(latest.amount) || 0;
      var pctMove = prevTotal > 0 ? (latestAmount / prevTotal) * 100 : (cumulative.length > 1 ? 0 : null);
      return {
        org: org,
        state: latest.state,
        count: gifts.length,
        total: running,
        cumulative: cumulative,
        latest: latest,
        pctMove: pctMove
      };
    });
    orgs.sort(function(a,b){ return b.total - a.total; });
    return orgs;
  }

  function buildOrgSparkline(cumulative){
    var w = 96, h = 30, pad = 4;
    var n = cumulative.length;
    var label = n + " gift" + (n === 1 ? "" : "s") + " logged, running total " + fmtMoneyExact(cumulative[n-1].value);
    if(n === 1){
      return '<div class="ot-spark"><svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(label) + '">' +
        '<circle class="ot-pt ot-pt-last" cx="' + (w/2) + '" cy="' + (h/2) + '" r="3" data-tip="' + esc(fmtDate(cumulative[0].date)) + ': ' + esc(fmtMoneyExact(cumulative[0].value)) + '"></circle>' +
        '</svg></div>';
    }
    var values = cumulative.map(function(c){ return c.value; });
    var minY = Math.min.apply(null, values.concat([0]));
    var maxY = Math.max.apply(null, values);
    if(minY === maxY) maxY = minY + 1;
    var xScale = function(i){ return pad + (i/(n-1)) * (w - pad*2); };
    var yScale = function(v){ return pad + (1 - (v-minY)/(maxY-minY)) * (h - pad*2); };
    var pts = cumulative.map(function(c,i){ return { x: xScale(i), y: yScale(c.value), c: c }; });
    var linePath = pts.map(function(p,i){ return (i===0?"M":"L") + p.x.toFixed(1) + "," + p.y.toFixed(1); }).join(" ");
    var areaPath = linePath + " L" + pts[n-1].x.toFixed(1) + "," + (h-pad).toFixed(1) + " L" + pts[0].x.toFixed(1) + "," + (h-pad).toFixed(1) + " Z";
    var markers = pts.map(function(p,i){
      var isLast = i === n - 1;
      var tip = esc(fmtDate(p.c.date)) + ': ' + esc(fmtMoneyExact(p.c.value));
      return '<circle class="ot-pt' + (isLast ? ' ot-pt-last' : '') + '" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + (isLast ? 2.8 : 1.6) + '" data-tip="' + tip + '"></circle>';
    }).join("");
    return '<div class="ot-spark"><svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(label) + '">' +
      '<path class="ot-spark-area" d="' + areaPath + '"></path>' +
      '<path class="ot-spark-line" d="' + linePath + '"></path>' +
      markers +
      '</svg></div>';
  }

  function orgMoveHtml(pctMove){
    if(pctMove === null) return '<span class="ot-move is-new">New</span>';
    if(pctMove === 0) return '<span class="ot-move is-flat">&mdash; flat</span>';
    if(pctMove < 0) return '<span class="ot-move is-down">&#9660; ' + pctMove.toFixed(1) + '%</span>';
    return '<span class="ot-move is-up">&#9650; +' + pctMove.toFixed(1) + '%</span>';
  }

  function orgLinksByName(){
    var map = {};
    (state.orgLinks || []).forEach(function(l){ map[l.org] = l; });
    return map;
  }

  // ---------- organizational 990 financial health (per-org disclosure) ----------
  // A gift's org is free text, so it's never auto-matched to an EIN by name
  // alone - Franklin searches and confirms the right nonprofit once, and
  // that link is reused after that. The confirmed link lives in state
  // (from the server); the search/candidate-picking flow itself is
  // ephemeral UI state in orgHealthUi, keyed by org name.
  function orgHealthWorstFlagLevel(analysis){
    if(!analysis || !analysis.flags) return null;
    var rank = { watch: 2, info: 1, good: 0 };
    var worst = null, worstRank = -1;
    analysis.flags.forEach(function(f){
      var r = rank[f.level] || 0;
      if(r > worstRank){ worstRank = r; worst = f.level; }
    });
    return worst;
  }
  function orgHealthDotClass(level){
    if(level === "watch") return "dot-warn";
    if(level === "good") return "dot-good";
    return "dot-neutral";
  }
  function orgHealthFlagHtml(f){
    return '<div class="oh-flag"><span class="status-dot ' + orgHealthDotClass(f.level) + '"></span>' + esc(f.text) + '</div>';
  }

  function orgHealthSearchBodyHtml(orgName, ui){
    var query = ui.query !== undefined && ui.query !== null ? ui.query : orgName;
    var html = '<form class="oh-search-form" data-org="' + esc(orgName) + '">' +
      '<div class="oh-search-row">' +
      '<input type="text" class="oh-query" value="' + esc(query) + '" placeholder="Organization name">' +
      '<button type="submit" class="btn secondary">Search ProPublica</button>' +
      '</div></form>';
    if(ui.mode === "loading-search"){
      html += '<p class="empty-note" style="border:none;padding-left:0;">Searching&hellip;</p>';
    } else if(ui.mode === "error"){
      html += '<p class="save-status" style="color:var(--warn);">' + esc(ui.error || "Search failed.") + '</p>';
    } else if(ui.mode === "candidates"){
      if(!ui.candidates || ui.candidates.length === 0){
        html += '<p class="empty-note" style="border:none;padding-left:0;">No matches found on ProPublica&rsquo;s Nonprofit Explorer. Try a shorter or different spelling of the name.</p>';
      } else {
        html += '<p class="oh-hint">Pick the right organization. Matches are by name only, so confirm the city/state before choosing.</p>' +
          '<div class="oh-candidates">' + ui.candidates.map(function(c){
            var loc = esc(c.city || "") + (c.city && c.state ? ", " : "") + esc(c.state || "");
            return '<button type="button" class="oh-pick-btn" data-org="' + esc(orgName) + '" data-ein="' + esc(c.ein) + '" data-name="' + esc(c.name) + '" data-city="' + esc(c.city || "") + '" data-state="' + esc(c.state || "") + '">' +
              '<strong>' + esc(c.name) + '</strong><span>' + loc + (loc ? ' &middot; ' : '') + 'EIN ' + esc(c.strein || c.ein) + '</span>' +
              '</button>';
          }).join("") + '</div>';
      }
    }
    return html;
  }

  function orgHealthChartHtml(years){
    var w = Math.max(280, years.length * 56), h = 140, padL = 22, padR = 22, padT = 10, padB = 22;
    var vals = [];
    years.forEach(function(y){ vals.push(y.revenue, y.expenses, 0); });
    var minY = Math.min.apply(null, vals), maxY = Math.max.apply(null, vals);
    if(maxY === minY) maxY = minY + 1;
    var n = years.length;
    var xScale = function(i){ return n === 1 ? (w/2) : (padL + (i/(n-1)) * (w - padL - padR)); };
    var yScale = function(v){ return padT + (1 - (v - minY)/(maxY - minY)) * (h - padT - padB); };
    function seriesPath(key){
      return years.map(function(y,i){ return (i===0?"M":"L") + xScale(i).toFixed(1) + "," + yScale(y[key]).toFixed(1); }).join(" ");
    }
    function markers(key, cls, label){
      return years.map(function(y,i){
        var tip = y.year + ' ' + label + ': ' + fmtMoneyExact(y[key]);
        return '<circle class="oh-chart-pt ' + cls + '" cx="' + xScale(i).toFixed(1) + '" cy="' + yScale(y[key]).toFixed(1) + '" r="2.6" data-tip="' + esc(tip) + '"></circle>';
      }).join("");
    }
    var xLabels = years.map(function(y,i){
      return '<text class="oh-chart-xlabel" x="' + xScale(i).toFixed(1) + '" y="' + (h-7) + '" text-anchor="middle">' + y.year + '</text>';
    }).join("");
    var zeroY = yScale(0);
    var zeroLine = minY < 0 ? ('<line x1="' + padL + '" y1="' + zeroY.toFixed(1) + '" x2="' + (w-padR) + '" y2="' + zeroY.toFixed(1) + '" stroke="var(--line)" stroke-width="1"></line>') : "";
    return '<div class="oh-chart"><svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="Revenue and expenses by filed year">' +
      zeroLine +
      '<path d="' + seriesPath("revenue") + '" fill="none" stroke="var(--accent-2)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>' +
      '<path d="' + seriesPath("expenses") + '" fill="none" stroke="var(--ink-soft)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="3 3"></path>' +
      markers("revenue", "oh-pt-rev", "revenue") + markers("expenses", "oh-pt-exp", "expenses") +
      xLabels +
      '</svg><div class="oh-chart-legend"><span><i class="oh-swatch oh-swatch-rev"></i>Revenue</span><span><i class="oh-swatch oh-swatch-exp"></i>Expenses</span></div></div>';
  }

  function orgHealthLinkedBodyHtml(orgName, link, ui){
    var loc = (link.matchedCity || link.matchedState) ? (' &middot; ' + esc(link.matchedCity || "") + (link.matchedCity && link.matchedState ? ", " : "") + esc(link.matchedState || "")) : "";
    var head = '<div class="oh-linked-head"><span>Matched to <strong>' + esc(link.matchedName || orgName) + '</strong>' + loc + ' &middot; EIN ' + esc(link.ein) + '</span>' +
      '<span class="oh-linked-actions">' +
      '<button type="button" class="oh-refresh-btn" data-org="' + esc(orgName) + '" data-ein="' + esc(link.ein) + '">Refresh</button>' +
      '<button type="button" class="oh-relink-btn" data-org="' + esc(orgName) + '">Not this org?</button>' +
      '</span></div>';

    if(ui.mode === "error"){
      return head + '<p class="save-status" style="color:var(--warn);">' + esc(ui.error || "Could not load financials.") + '</p>';
    }
    if(!ui.analysis){
      return head + '<p class="empty-note" style="border:none;padding-left:0;">Loading filings from ProPublica&hellip;</p>';
    }
    var analysis = ui.analysis;
    var years = analysis.years;
    var flagsHtml = '<div class="oh-flags">' + analysis.flags.map(orgHealthFlagHtml).join("") + '</div>';
    if(years.length === 0){
      return head + flagsHtml;
    }
    var chart = orgHealthChartHtml(years);
    var tableRows = years.slice().reverse().map(function(y){
      var netCls = y.netIncome < 0 ? ' class="oh-neg"' : '';
      return '<tr><td>' + y.year + '</td><td>' + fmtMoneyExact(y.revenue) + '</td><td>' + fmtMoneyExact(y.expenses) + '</td>' +
        '<td' + netCls + '>' + (y.netIncome < 0 ? '&minus;' : '') + fmtMoneyExact(Math.abs(y.netIncome)) + '</td>' +
        '<td>' + (y.reserveMonths === null ? '&mdash;' : y.reserveMonths.toFixed(1) + ' mo') + '</td>' +
        '<td>' + (y.pdfUrl ? ('<a href="' + esc(y.pdfUrl) + '" target="_blank" rel="noopener">990 PDF</a>') : '&mdash;') + '</td></tr>';
    }).join("");
    var fetchedNote = ui.fetchedAt ? ('<div class="oh-fetched-note">From ProPublica&rsquo;s Nonprofit Explorer (public 990 filings), last fetched ' + esc(fmtDate(String(ui.fetchedAt).slice(0,10))) + '.</div>') : '';
    return head + flagsHtml + chart +
      '<div class="table-wrap"><table class="oh-table"><thead><tr><th>Year</th><th>Revenue</th><th>Expenses</th><th>Net</th><th>Reserve</th><th>Source</th></tr></thead><tbody>' + tableRows + '</tbody></table></div>' +
      fetchedNote;
  }

  function orgHealthHtml(orgName){
    var ui = orgHealthUi[orgName] || (orgHealthUi[orgName] = { open: false, mode: "idle", query: orgName });
    var link = orgLinksByName()[orgName];
    var showLinked = link && ui.mode !== "search" && ui.mode !== "candidates" && ui.mode !== "loading-search";
    var dotHtml = "";
    var summaryText;
    var bodyHtml;
    if(showLinked){
      var worst = orgHealthWorstFlagLevel(ui.analysis);
      if(worst) dotHtml = '<span class="status-dot ' + orgHealthDotClass(worst) + '"></span>';
      summaryText = "Financial health &middot; " + esc(link.matchedName || orgName);
      bodyHtml = orgHealthLinkedBodyHtml(orgName, link, ui);
    } else {
      summaryText = "Look up financial health (990 filings)";
      bodyHtml = orgHealthSearchBodyHtml(orgName, ui);
    }
    return '<details class="org-health"' + (ui.open ? " open" : "") + ' data-org="' + esc(orgName) + '">' +
      '<summary>' + dotHtml + summaryText + '</summary>' +
      '<div class="org-health-body">' + bodyHtml + '</div>' +
      '</details>';
  }

  // The same .org-health disclosure now renders in two different places -
  // the Giving Landscape org tracker and the Prospecting table - so any
  // state change (a fetch resolving, a pick, a refresh) re-renders whichever
  // of those containers is actually present, instead of assuming one.
  function renderOrgHealthHosts(){
    if(document.getElementById("gl-org-tracker")) renderOrgTracker();
    if(document.getElementById("prospect-rows")) renderProspecting();
  }

  function fetchOrgFinancials(org){
    var ui = orgHealthUi[org];
    apiFetch("/api/org-financials?org=" + encodeURIComponent(org)).then(function(resp){
      if(resp.linked){
        ui.mode = "linked";
        ui.analysis = resp.analysis;
        ui.fetchedAt = resp.fetchedAt;
      } else {
        ui.mode = "search";
      }
      renderOrgHealthHosts();
    }).catch(function(err){
      ui.mode = "error";
      ui.error = "Could not load financials: " + err.message;
      renderOrgHealthHosts();
    });
  }

  function bindOrgHealthEvents(){
    // Bound on <main> rather than the org tracker container alone, since the
    // same .org-health disclosure now also renders inside the Prospecting
    // table (keyed by prospect.org) - one set of delegated handlers serves
    // every org-health block in the app, wherever it's rendered.
    var el = document.querySelector("main");
    if(!el) return;
    // The 'toggle' event on <details> does not bubble, so delegation only
    // works on the capture phase (capture happens on the way down to the
    // target regardless of whether the event bubbles back up afterward).
    el.addEventListener("toggle", function(e){
      var det = e.target.closest ? e.target.closest(".org-health") : null;
      if(!det || !el.contains(det)) return;
      var org = det.getAttribute("data-org");
      var ui = orgHealthUi[org] || (orgHealthUi[org] = { open: false, mode: "idle", query: org });
      ui.open = det.open;
      if(det.open){
        var link = orgLinksByName()[org];
        if(link && !ui.analysis && ui.mode !== "loading" && ui.mode !== "error"){
          ui.mode = "loading";
          fetchOrgFinancials(org);
        }
      }
    }, true);

    el.addEventListener("submit", function(e){
      var form = e.target.closest(".oh-search-form");
      if(!form) return;
      e.preventDefault();
      var org = form.getAttribute("data-org");
      var input = form.querySelector(".oh-query");
      var query = ((input && input.value) || "").trim();
      var ui = orgHealthUi[org] || (orgHealthUi[org] = { open: true, mode: "idle", query: org });
      ui.open = true;
      ui.query = query || org;
      if(!query) return;
      ui.mode = "loading-search";
      renderOrgHealthHosts();
      apiFetch("/api/org-financials/search?q=" + encodeURIComponent(query)).then(function(resp){
        ui.mode = "candidates";
        ui.candidates = resp.results || [];
        renderOrgHealthHosts();
      }).catch(function(err){
        ui.mode = "error";
        ui.error = "Search failed: " + err.message;
        renderOrgHealthHosts();
      });
    });

    el.addEventListener("click", function(e){
      var flagBtn = e.target.closest(".ot-flag-btn");
      if(flagBtn){
        e.preventDefault();
        flagOrgAsProspect(flagBtn.getAttribute("data-org"));
        return;
      }
      var pickBtn = e.target.closest(".oh-pick-btn");
      if(pickBtn){
        var org = pickBtn.getAttribute("data-org");
        var ui = orgHealthUi[org] || (orgHealthUi[org] = { open: true, mode: "idle" });
        ui.open = true;
        ui.mode = "loading";
        renderOrgHealthHosts();
        apiFetch("/api/org-financials/link", { method: "POST", body: {
          org: org, ein: pickBtn.getAttribute("data-ein"), matchedName: pickBtn.getAttribute("data-name"),
          matchedCity: pickBtn.getAttribute("data-city"), matchedState: pickBtn.getAttribute("data-state")
        }}).then(function(resp){
          state.orgLinks = (state.orgLinks || []).filter(function(l){ return l.org !== org; });
          state.orgLinks.push({ org: org, ein: resp.ein, matchedName: resp.matchedName, matchedCity: pickBtn.getAttribute("data-city"), matchedState: pickBtn.getAttribute("data-state"), linkedAt: new Date().toISOString() });
          ui.mode = "linked";
          ui.analysis = resp.analysis;
          ui.fetchedAt = resp.fetchedAt;
          renderOrgHealthHosts();
        }).catch(function(err){
          ui.mode = "error";
          ui.error = "Could not link that organization: " + err.message;
          renderOrgHealthHosts();
        });
        return;
      }
      var relinkBtn = e.target.closest(".oh-relink-btn");
      if(relinkBtn){
        var org2 = relinkBtn.getAttribute("data-org");
        var ui2 = orgHealthUi[org2] || (orgHealthUi[org2] = {});
        ui2.open = true;
        ui2.mode = "search";
        ui2.query = org2;
        ui2.candidates = null;
        renderOrgHealthHosts();
        return;
      }
      var refreshBtn = e.target.closest(".oh-refresh-btn");
      if(refreshBtn){
        var org3 = refreshBtn.getAttribute("data-org");
        var ein3 = refreshBtn.getAttribute("data-ein");
        var ui3 = orgHealthUi[org3] || (orgHealthUi[org3] = {});
        ui3.open = true;
        ui3.mode = "loading";
        renderOrgHealthHosts();
        apiFetch("/api/org-financials/" + encodeURIComponent(ein3) + "/refresh", { method: "POST" }).then(function(resp){
          ui3.mode = "linked";
          ui3.analysis = resp.analysis;
          ui3.fetchedAt = resp.fetchedAt;
          renderOrgHealthHosts();
        }).catch(function(err){
          ui3.mode = "error";
          ui3.error = "Refresh failed: " + err.message;
          renderOrgHealthHosts();
        });
        return;
      }
    });
  }

  function renderOrgTracker(){
    var container = document.getElementById("gl-org-tracker");
    var refreshedEl = document.getElementById("gl-orgtracker-refreshed");
    if(!container || !refreshedEl) return;
    var orgs = orgGrowthData();
    if(orgs.length === 0){
      refreshedEl.textContent = "No positions open yet";
      container.innerHTML = '<p class="empty-note">Nothing to track yet. Log a gift above to open the first position.</p>';
      return;
    }
    refreshedEl.textContent = orgs.length + " organization" + (orgs.length === 1 ? "" : "s") + " tracked";
    container.innerHTML = orgs.map(function(o){
      var stateTag = o.state ? (' &middot; ' + esc(STATE_NAME_BY_ABBR[o.state] || o.state)) : '';
      return '<div class="org-position">' +
        '<div class="org-ticker-row">' +
        '<div class="ot-name"><strong>' + esc(o.org) + '</strong><span class="ot-meta">' + o.count + ' gift' + (o.count === 1 ? '' : 's') + stateTag + '</span></div>' +
        buildOrgSparkline(o.cumulative) +
        '<div class="ot-total">' + fmtMoneyExact(o.total) + '</div>' +
        '<div class="ot-move-wrap">' + orgMoveHtml(o.pctMove) + '</div>' +
        '</div>' +
        '<div class="ot-actions"><a href="#" class="ics-link ot-flag-btn" data-org="' + esc(o.org) + '">+ Flag as prospect</a></div>' +
        orgHealthHtml(o.org) +
        '</div>';
    }).join("");
    container.querySelectorAll(".ot-pt, .oh-chart-pt").forEach(function(pt){
      pt.addEventListener("mousemove", function(e){ showChartTooltip(e, pt.getAttribute("data-tip")); });
      pt.addEventListener("mouseleave", hideChartTooltip);
    });
  }

  // Flagging a tracked org as a prospect never silently creates the record -
  // the same "confirm before trusting a match" discipline as the 990 EIN
  // lookup above. It only jumps to Prospecting with the form pre-filled
  // from the gift history (and any 990 flag already loaded for that org),
  // so Franklin reviews and edits before pressing Add prospect.
  function prefillProspectForm(data){
    var nameEl = document.getElementById("ps-name");
    var orgEl = document.getElementById("ps-org");
    var sourceEl = document.getElementById("ps-source");
    var stageEl = document.getElementById("ps-stage-select");
    var linkEl = document.getElementById("ps-link");
    var notesEl = document.getElementById("ps-notes");
    if(!nameEl) return;
    nameEl.value = data.name || "";
    orgEl.value = data.org || "";
    sourceEl.value = data.source || "linkedin";
    stageEl.value = "new";
    linkEl.value = "";
    notesEl.value = data.notes || "";
    var statusEl = document.getElementById("ps-status");
    if(statusEl){
      statusEl.textContent = "Pre-filled from Giving Landscape. Check the details, then log it.";
      setTimeout(function(){ statusEl.textContent = ""; }, 4000);
    }
    var form = document.getElementById("prospect-form");
    if(form) form.scrollIntoView({ behavior: "smooth", block: "start" });
    nameEl.focus();
  }

  function flagOrgAsProspect(orgName){
    var o = orgGrowthData().filter(function(x){ return x.org === orgName; })[0];
    if(!o) return;
    var notes = [];
    notes.push(o.count + " gift" + (o.count === 1 ? "" : "s") + " tracked in the Giving Landscape ticker, " + fmtMoneyExact(o.total) + " total.");
    if(o.latest){
      notes.push("Most recent: " + fmtMoneyExact(Number(o.latest.amount) || 0) + " on " + fmtDate(o.latest.announcedAt || o.latest.loggedAt) + (o.latest.headline ? " (" + o.latest.headline + ")" : "") + ".");
    }
    var ui = orgHealthUi[orgName];
    if(ui && ui.analysis && ui.analysis.flags && ui.analysis.flags.length){
      var worst = orgHealthWorstFlagLevel(ui.analysis);
      if(worst === "watch"){
        var watchText = ui.analysis.flags.filter(function(f){ return f.level === "watch"; }).map(function(f){ return f.text; }).join(" ");
        notes.push("990 flag to check: " + watchText);
      } else if(worst === "good"){
        notes.push("990 filings look healthy.");
      }
    }
    goToView("prospecting");
    prefillProspectForm({ name: orgName, org: orgName, source: "giving", notes: notes.join(" ") });
  }

  function renderGivingLandscape(){
    renderGiftStats();
    renderNationalBars();
    renderNationalTrends();
    renderGiftTicker();
    renderStateGrid();
    renderOrgTracker();
  }
  initGivingLandscapeStatic();

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

  // ---------- playbook library ----------
  // Every gift already carries its own case-study read (impact, trend
  // signal, replication idea, gift type, restriction) - see
  // giftCaseStudyGridHtml above. This view doesn't add any new data, it
  // just pulls every gift that has that read filled in out of the ticker
  // and into one searchable list, so "which gift was the one where we led
  // with a facility tour" doesn't mean scrolling and opening disclosures
  // one at a time. Entirely client-side, off state.gifts already in memory
  // - no new endpoint, and (like the case-study fields themselves) never
  // exposed on the public Giving Landscape page.
  var playbookSearch = "";
  var playbookCategoryFilter = "all";

  function initPlaybookLibraryStatic(){
    var catBar = document.getElementById("pb-category-filters");
    var extra = GIVING_USA_CATEGORIES.map(function(c){
      return '<button type="button" class="filter-btn" data-cat="' + c.key + '">' + esc(c.label) + '</button>';
    }).join("") + '<button type="button" class="filter-btn" data-cat="other">Other</button>';
    catBar.insertAdjacentHTML("beforeend", extra);
    catBar.addEventListener("click", function(e){
      var btn = e.target.closest(".filter-btn");
      if(!btn) return;
      playbookCategoryFilter = btn.getAttribute("data-cat");
      catBar.querySelectorAll(".filter-btn").forEach(function(b){ b.classList.toggle("is-active", b === btn); });
      renderPlaybookLibrary();
    });
    document.getElementById("pb-search").addEventListener("input", function(e){
      playbookSearch = e.target.value.trim().toLowerCase();
      renderPlaybookLibrary();
    });
  }
  initPlaybookLibraryStatic();

  function playbookCardHtml(g){
    var who = g.donor ? (esc(g.donor) + " &rarr; " + esc(g.org || "Untitled")) : esc(g.org || "Untitled");
    var stateTag = g.state ? (' &middot; ' + esc(STATE_NAME_BY_ABBR[g.state] || g.state)) : "";
    return '<div class="gift-card">' +
      '<div class="gift-card-head"><h4>' + who + '</h4><span class="gift-amount">' + fmtMoneyExact(g.amount) + '</span></div>' +
      (g.headline || g.summary ? '<p>' + esc(g.headline || g.summary) + '</p>' : '') +
      '<div class="gift-meta"><span class="pill">' + esc(GIFT_CATEGORY_LABELS[g.category] || g.category) + '</span><span>' + fmtDate(g.announcedAt) + stateTag + '</span>' +
      (g.source ? (' &middot; <span>' + esc(g.source) + '</span>') : '') +
      (g.url ? (' &middot; <a href="' + esc(g.url) + '" target="_blank" rel="noopener">Read more</a>') : '') +
      '</div>' +
      giftCaseStudyGridHtml(g) +
      '</div>';
  }

  function renderPlaybookLibrary(){
    var all = state.gifts.filter(hasCaseStudy);
    var filtered = all.filter(function(g){
      if(playbookCategoryFilter !== "all" && g.category !== playbookCategoryFilter) return false;
      if(playbookSearch){
        var haystack = [g.org, g.donor, g.headline, g.summary, g.impact, g.trendSignal, g.playbook, g.giftType, g.restriction].join(" ").toLowerCase();
        if(haystack.indexOf(playbookSearch) === -1) return false;
      }
      return true;
    }).sort(function(a,b){ return (b.announcedAt || b.loggedAt || "").localeCompare(a.announcedAt || a.loggedAt || ""); });

    var filtering = !!playbookSearch || playbookCategoryFilter !== "all";
    document.getElementById("pb-count").textContent = all.length === 0
      ? "No case studies logged yet"
      : (filtering ? (filtered.length + " of " + all.length + " case studies match this search") : (all.length + " case " + (all.length === 1 ? "study" : "studies") + " logged"));

    var list = document.getElementById("pb-list");
    if(all.length === 0){
      list.innerHTML = '<p class="empty-note">No gift has a case-study read logged yet. Fill in impact, trend signal, gift type, restriction, or a replication idea when you log or edit a gift on the Giving Landscape ticker, and it shows up here automatically.</p>';
      return;
    }
    if(filtered.length === 0){
      list.innerHTML = '<p class="empty-note">Nothing matches this search or filter.</p>';
      return;
    }
    list.innerHTML = filtered.map(playbookCardHtml).join("");
  }

  // ---------- Time Horizon (Giving Landscape): current / trend / structural ----------
  // Mirrors the three-horizon framing Franklin uses in a diagnostic
  // engagement (current standing, multi-year trend, long-run structural
  // behavior), applied to what this tracker actually has on hand rather
  // than a nonprofit's own audited financials:
  //  - Current pulls from the gifts logged in the last 12 months.
  //  - Trend groups every logged gift by year, so the shape sharpens as
  //    more weeks of Field Intelligence passes and manual entries accumulate.
  //  - Structural reuses the real, multi-year 990 filing history already
  //    fetched for any org confirmed in the Organization Tracker below -
  //    the one dataset here that actually spans several years today.
  function loadOrgStructuralSummary(){
    return apiFetch("/api/org-financials/structural-summary").then(function(resp){
      orgStructuralSummary = resp.orgs || [];
      renderTimeHorizon();
    }).catch(function(){
      orgStructuralSummary = [];
      renderTimeHorizon();
    });
  }

  function timeHorizonCurrentHtml(){
    var cutoff = Date.now() - 365 * 24 * 60 * 60 * 1000;
    var recent = state.gifts.filter(function(g){
      var d = Date.parse(g.announcedAt || g.loggedAt || "");
      return !isNaN(d) && d >= cutoff;
    });
    if(recent.length === 0){
      return '<p class="empty-note">No gift logged with an announcement date in the last 12 months yet.</p>';
    }
    var total = recent.reduce(function(sum,g){ return sum + (Number(g.amount) || 0); }, 0);
    var byCategory = {};
    recent.forEach(function(g){
      var cat = g.category || "other";
      byCategory[cat] = (byCategory[cat] || 0) + (Number(g.amount) || 0);
    });
    var topCategory = Object.keys(byCategory).sort(function(a,b){ return byCategory[b] - byCategory[a]; })[0];
    var topCategoryLabel = (GIFT_CATEGORY_LABELS && GIFT_CATEGORY_LABELS[topCategory]) || topCategory;
    return '<div class="th-stat-row">' +
      '<div class="th-stat"><span class="num mono">' + recent.length + '</span><span class="cap">gifts in the last 12 months</span></div>' +
      '<div class="th-stat"><span class="num mono">' + fmtMoneyShort(total) + '</span><span class="cap">tracked over that span</span></div>' +
      '<div class="th-stat"><span class="num mono" style="font-size:1.3rem;">' + esc(topCategoryLabel) + '</span><span class="cap">leading category by dollars</span></div>' +
      '</div>';
  }

  function timeHorizonTrendHtml(){
    var byYear = {};
    state.gifts.forEach(function(g){
      var d = Date.parse(g.announcedAt || g.loggedAt || "");
      if(isNaN(d)) return;
      var y = new Date(d).getFullYear();
      if(!byYear[y]) byYear[y] = { count: 0, total: 0 };
      byYear[y].count++;
      byYear[y].total += (Number(g.amount) || 0);
    });
    var years = Object.keys(byYear).sort();
    if(years.length === 0){
      return '<p class="empty-note">No gift has an announcement date logged yet, so there is nothing to group into years.</p>';
    }
    if(years.length === 1){
      return '<p class="empty-note">Every gift logged so far falls in ' + esc(years[0]) + '. This view fills in as gifts from other years get logged, either by hand or through the weekly Field Intelligence pass, and starts showing a real multi-year trend once there is more than one year on the board.</p>';
    }
    var maxTotal = Math.max.apply(null, years.map(function(y){ return byYear[y].total; }));
    return '<div class="th-year-list">' + years.map(function(y){
      var pct = maxTotal > 0 ? Math.round((byYear[y].total / maxTotal) * 100) : 0;
      return '<div class="th-year-row">' +
        '<span class="th-year-label">' + esc(y) + '</span>' +
        '<div class="gb-track"><div class="gb-fill" style="width:' + pct + '%;"></div></div>' +
        '<span class="th-year-value">' + fmtMoneyShort(byYear[y].total) + ' &middot; ' + byYear[y].count + (byYear[y].count === 1 ? " gift" : " gifts") + '</span>' +
        '</div>';
    }).join("") + '</div>';
  }

  function timeHorizonStructuralHtml(){
    if(orgStructuralSummary === null){
      return '<p class="empty-note">Loading&hellip;</p>';
    }
    if(orgStructuralSummary.length === 0){
      return '<p class="empty-note">No organization has confirmed 990 data yet. Open a row in the Organization Tracker below and look up its financial health. Once at least one is confirmed, its real multi-year filing history shows up here.</p>';
    }
    return '<div class="th-org-list">' + orgStructuralSummary.map(function(o){
      var span = o.yearsAvailable === 0 ? "no filed years yet"
        : (o.yearsAvailable === 1 ? o.latestYear + " only" : o.earliestYear + "–" + o.latestYear + " (" + o.yearsAvailable + " years filed)");
      var changeHtml = "";
      if(o.revenueChangePct !== null){
        var pct = Math.round(o.revenueChangePct * 100);
        changeHtml = '<span class="pill ' + (pct >= 0 ? "good" : "") + '">' + (pct >= 0 ? "+" : "") + pct + "% revenue" + '</span>';
      }
      return '<div class="th-org-row">' +
        '<div class="th-org-head"><span class="th-org-name">' + esc(o.matchedName) + '</span>' + changeHtml + '</div>' +
        '<div class="th-org-span">' + esc(span) + '</div>' +
        (o.flag ? orgHealthFlagHtml(o.flag) : "") +
        '</div>';
    }).join("") + '</div>';
  }

  function renderTimeHorizon(){
    var currentEl = document.getElementById("th-current");
    var trendEl = document.getElementById("th-trend");
    var structuralEl = document.getElementById("th-structural");
    if(!currentEl) return; // panel not on this page yet
    currentEl.innerHTML = timeHorizonCurrentHtml();
    trendEl.innerHTML = timeHorizonTrendHtml();
    structuralEl.innerHTML = timeHorizonStructuralHtml();
  }

  // ---------- National Giving Trends (Giving USA benchmark, 2000-2025) ----------
  // Static reference data (NATIONAL_TOTAL_GIVING_BY_YEAR /
  // NATIONAL_CATEGORY_GIVING_BY_YEAR above), separate from anything in
  // `state` - this is what the sector as a whole did, for reading Franklin's
  // own gift ticker against.
  var NATIONAL_CATEGORY_LABELS = {
    religion: "Religion", "human-services": "Human Services", education: "Education",
    foundations: "Gifts to Foundations", "public-society-benefit": "Public-Society Benefit",
    health: "Health", "international-affairs": "International Affairs",
    "arts-culture": "Arts, Culture & Humanities", "environment-animals": "Environment & Animals",
    individuals: "Gifts to Individuals"
  };

  function nationalTotalChartHtml(){
    var years = Object.keys(NATIONAL_TOTAL_GIVING_BY_YEAR).map(Number).sort(function(a,b){ return a-b; });
    var n = years.length;
    var w = Math.max(560, n * 30), h = 180, padL = 12, padR = 12, padT = 14, padB = 26;
    var maxY = Math.max.apply(null, years.map(function(y){ return NATIONAL_TOTAL_GIVING_BY_YEAR[y]; })) * 1.08;
    var xScale = function(i){ return n === 1 ? (w/2) : (padL + (i/(n-1)) * (w - padL - padR)); };
    var yScale = function(v){ return padT + (1 - v/maxY) * (h - padT - padB); };
    // Solid segments connect consecutive years; a gap year (2001-2003, 2005)
    // gets a dashed segment instead, so the chart never implies real data
    // for a year it doesn't have.
    var linePath = years.map(function(y,i){ return (i===0?"M":"L") + xScale(i).toFixed(1) + "," + yScale(NATIONAL_TOTAL_GIVING_BY_YEAR[y]).toFixed(1); }).join(" ");
    var solidSegs = [], dashedSegs = [];
    for(var si = 1; si < n; si++){
      var seg = "M" + xScale(si-1).toFixed(1) + "," + yScale(NATIONAL_TOTAL_GIVING_BY_YEAR[years[si-1]]).toFixed(1) +
        " L" + xScale(si).toFixed(1) + "," + yScale(NATIONAL_TOTAL_GIVING_BY_YEAR[years[si]]).toFixed(1);
      if(years[si] - years[si-1] === 1) solidSegs.push(seg); else dashedSegs.push(seg);
    }
    var lastX = xScale(n-1).toFixed(1), baseY = (h-padB).toFixed(1);
    var areaPath = linePath + " L" + lastX + "," + baseY + " L" + xScale(0).toFixed(1) + "," + baseY + " Z";
    var markers = years.map(function(y,i){
      var v = NATIONAL_TOTAL_GIVING_BY_YEAR[y];
      var tip = y + ": $" + v.toFixed(1) + "B total US charitable giving (current dollars)";
      return '<circle class="nt-pt" cx="' + xScale(i).toFixed(1) + '" cy="' + yScale(v).toFixed(1) + '" r="2.8" data-tip="' + esc(tip) + '"></circle>';
    }).join("");
    var xLabels = years.map(function(y,i){
      if(i !== 0 && i !== n-1 && y % 5 !== 0) return "";
      return '<text class="nt-xlabel" x="' + xScale(i).toFixed(1) + '" y="' + (h-8) + '" text-anchor="middle">' + y + '</text>';
    }).join("");
    var allYears = [];
    for(var y2 = years[0]; y2 <= years[n-1]; y2++) allYears.push(y2);
    var missing = allYears.filter(function(y){ return NATIONAL_TOTAL_GIVING_BY_YEAR[y] === undefined; });
    var missingNote = missing.length ? ('<p class="nt-note">Not shown: ' + missing.join(", ") + ' &mdash; no freely published Giving USA total could be confirmed for ' + (missing.length === 1 ? "that year" : "those years") + '.</p>') : "";
    var solidPath = solidSegs.map(function(s){ return '<path d="' + s + '" fill="none" stroke="var(--accent-2)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>'; }).join("");
    var dashedPath = dashedSegs.map(function(s){ return '<path d="' + s + '" fill="none" stroke="var(--accent-2)" stroke-width="2" stroke-linecap="round" stroke-dasharray="4 3"></path>'; }).join("");
    return '<div class="nt-chart"><svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="Total US charitable giving by year, 2000 to 2025, current dollars">' +
      '<path class="nt-area" d="' + areaPath + '"></path>' +
      solidPath + dashedPath +
      markers + xLabels +
      '</svg></div>' + missingNote;
  }

  function nationalCategorySparkline(catKey){
    var years = Object.keys(NATIONAL_CATEGORY_GIVING_BY_YEAR).map(Number).sort(function(a,b){ return a-b; })
      .filter(function(y){ return NATIONAL_CATEGORY_GIVING_BY_YEAR[y][catKey] !== undefined; });
    if(years.length === 0) return { html: "", first: null, last: null, years: [] };
    var w = 220, h = 56, pad = 6;
    var n = years.length;
    var vals = years.map(function(y){ return NATIONAL_CATEGORY_GIVING_BY_YEAR[y][catKey]; });
    var minY = Math.min.apply(null, vals.concat([0]));
    var maxY = Math.max.apply(null, vals);
    if(minY === maxY) maxY = minY + 1;
    var xScale = function(i){ return n === 1 ? (w/2) : (pad + (i/(n-1)) * (w - pad*2)); };
    var yScale = function(v){ return pad + (1 - (v-minY)/(maxY-minY)) * (h - pad*2); };
    var linePath = years.map(function(y,i){ return (i===0?"M":"L") + xScale(i).toFixed(1) + "," + yScale(vals[i]).toFixed(1); }).join(" ");
    var areaPath = linePath + " L" + xScale(n-1).toFixed(1) + "," + (h-pad).toFixed(1) + " L" + xScale(0).toFixed(1) + "," + (h-pad).toFixed(1) + " Z";
    var markers = years.map(function(y,i){
      var tip = y + ": $" + vals[i].toFixed(1) + "B";
      var isLast = i === n-1;
      return '<circle class="ot-pt' + (isLast ? ' ot-pt-last' : '') + '" cx="' + xScale(i).toFixed(1) + '" cy="' + yScale(vals[i]).toFixed(1) + '" r="' + (isLast ? 2.6 : 1.5) + '" data-tip="' + esc(tip) + '"></circle>';
    }).join("");
    var html = '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(NATIONAL_CATEGORY_LABELS[catKey]) + ' giving trend">' +
      '<path class="ot-spark-area" d="' + areaPath + '"></path>' +
      '<path class="ot-spark-line" d="' + linePath + '"></path>' +
      markers + '</svg>';
    return { html: html, first: { year: years[0], value: vals[0] }, last: { year: years[n-1], value: vals[n-1] }, years: years };
  }

  function nationalCategoryGridHtml(){
    return '<div class="nt-cat-grid">' + NATIONAL_TREND_CATEGORY_ORDER.map(function(key){
      var spark = nationalCategorySparkline(key);
      if(!spark.first) return "";
      var changePct = spark.first.value > 0 ? ((spark.last.value - spark.first.value) / spark.first.value) * 100 : null;
      var changeHtml = changePct === null ? "" : ('<span class="gb-growth ' + (changePct >= 0 ? "up" : "down") + '">' + (changePct >= 0 ? "+" : "") + Math.round(changePct) + '% since ' + spark.first.year + '</span>');
      return '<div class="nt-cat-tile">' +
        '<div class="nt-cat-head"><span class="nt-cat-name">' + esc(NATIONAL_CATEGORY_LABELS[key]) + '</span>' + changeHtml + '</div>' +
        '<div class="nt-cat-value">$' + spark.last.value.toFixed(1) + 'B <span class="nt-cat-year">in ' + spark.last.year + '</span></div>' +
        spark.html +
        '</div>';
    }).join("") + '</div>';
  }

  function nationalTrendsTableHtml(){
    var years = Object.keys(NATIONAL_TOTAL_GIVING_BY_YEAR).map(Number).sort(function(a,b){ return b-a; });
    var head = '<th>Year</th>' + NATIONAL_TREND_CATEGORY_ORDER.map(function(k){ return '<th>' + esc(NATIONAL_CATEGORY_LABELS[k]) + '</th>'; }).join("") + '<th>Total</th>';
    var rows = years.map(function(y){
      var cats = NATIONAL_CATEGORY_GIVING_BY_YEAR[y];
      var cells = NATIONAL_TREND_CATEGORY_ORDER.map(function(k){
        var v = cats ? cats[k] : undefined;
        return '<td>' + (v === undefined ? '<span class="dim">&mdash;</span>' : '$' + v.toFixed(1) + 'B') + '</td>';
      }).join("");
      return '<tr><td><strong>' + y + '</strong></td>' + cells + '<td>$' + NATIONAL_TOTAL_GIVING_BY_YEAR[y].toFixed(1) + 'B</td></tr>';
    }).join("");
    return '<div class="table-wrap"><table><thead><tr>' + head + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function nationalTrendsAnalysisHtml(){
    var y0 = 2000, yN = 2025;
    var v0 = NATIONAL_TOTAL_GIVING_BY_YEAR[y0], vN = NATIONAL_TOTAL_GIVING_BY_YEAR[yN];
    var totalGrowthX = (vN / v0).toFixed(1);
    var peak08 = NATIONAL_TOTAL_GIVING_BY_YEAR[2008], trough09 = NATIONAL_TOTAL_GIVING_BY_YEAR[2009], trough10 = NATIONAL_TOTAL_GIVING_BY_YEAR[2010];
    var y2020 = NATIONAL_TOTAL_GIVING_BY_YEAR[2020];
    function catShare(year, key){
      var cats = NATIONAL_CATEGORY_GIVING_BY_YEAR[year];
      if(!cats) return null;
      var sum = 0;
      Object.keys(cats).forEach(function(k){ sum += cats[k]; });
      return cats[key] !== undefined ? (cats[key]/sum)*100 : null;
    }
    var relShare09 = catShare(2009, "religion"), relShare25 = catShare(2025, "religion");
    var hsShare09 = catShare(2009, "human-services"), hsShare25 = catShare(2025, "human-services");
    var psbShare09 = catShare(2009, "public-society-benefit"), psbShare25 = catShare(2025, "public-society-benefit");
    return '<div class="nt-analysis">' +
      '<p>Total US charitable giving grew from roughly $' + v0.toFixed(0) + 'B in 2000 to $' + vN.toFixed(0) + 'B in 2025, current dollars, about ' + totalGrowthX + 'x. Growth was not steady: giving fell from about $' + peak08.toFixed(0) + 'B in 2008 to $' + trough09.toFixed(0) + 'B in 2009 and stayed near $' + trough10.toFixed(0) + 'B through 2010 before resuming its climb, tracking the 2008&ndash;2009 recession. The 2020 pandemic year did not repeat that pattern: total giving grew to $' + y2020.toFixed(0) + 'B, driven in part by a jump in human services and public-society benefit giving that year.</p>' +
      (relShare09 && relShare25 ? '<p>The mix has shifted more than the total. Religion made up about ' + Math.round(relShare09) + '% of the tracked category giving above in 2009 and about ' + Math.round(relShare25) + '% in 2025, even as its own dollar total kept growing. Human services (about ' + Math.round(hsShare09) + '% in 2009, ' + Math.round(hsShare25) + '% in 2025) and public-society benefit (about ' + Math.round(psbShare09) + '% to ' + Math.round(psbShare25) + '%) picked up the share religion gave up, a broadening pattern several sector commentators have pointed to over this period, though a fuller explanation would need more than these two data points.</p>' : '') +
      '<p class="nt-source">Source: Giving USA (the Giving USA Foundation and the Indiana University Lilly Family School of Philanthropy), annual press releases, 2000&ndash;2026 editions. Figures are as each year was originally reported; Giving USA revises prior years in later editions, so a current-vintage figure for an older year may differ slightly from what is shown here.</p>' +
      '</div>';
  }

  function renderNationalTrends(){
    var totalEl = document.getElementById("nt-total-chart");
    var gridEl = document.getElementById("nt-cat-grid");
    var tableEl = document.getElementById("nt-table");
    var analysisEl = document.getElementById("nt-analysis");
    if(!totalEl) return; // panel not on this page yet
    totalEl.innerHTML = nationalTotalChartHtml();
    gridEl.innerHTML = nationalCategoryGridHtml();
    tableEl.innerHTML = nationalTrendsTableHtml();
    analysisEl.innerHTML = nationalTrendsAnalysisHtml();
    [totalEl, gridEl].forEach(function(el){
      el.querySelectorAll("[data-tip]").forEach(function(pt){
        pt.addEventListener("mousemove", function(e){ showChartTooltip(e, pt.getAttribute("data-tip")); });
        pt.addEventListener("mouseleave", hideChartTooltip);
      });
    });
  }

  // ---------- bootstrap ----------
  function renderAll(){
    renderGivingLandscape();
    renderBriefing();
    renderSessionPanel();
    renderCommandCenter();
    renderDashboard();
    renderPipeline();
    renderProspecting();
    renderScorecard();
    renderForecasting();
    renderFinance();
    renderDelivery();
    renderVision();
    renderIssues();
    renderRocks();
    renderFieldIntel();
    renderPlaybookLibrary();
    renderTimeHorizon();
    renderPracticeTrends();
    renderAutomationHealth();
  }

  function onApiUnavailable(){
    document.getElementById("db-banner").hidden = false;
    document.getElementById("load-note").hidden = true;
    ["pl-submit","sc-submit","is-submit","rk-submit","vision-save","ps-submit","sess-sc-submit","sess-is-submit","gf-submit"].forEach(function(id){
      var el = document.getElementById(id);
      if(el) el.disabled = true;
    });
    renderAll();
  }

  loadState().then(function(){
    apiReady = true;
    document.getElementById("load-note").hidden = true;
    renderAll();
    loadOrgStructuralSummary();
    loadPracticeTrends();
    loadAutomationStatus();
  }).catch(function(){
    onApiUnavailable();
  });

  renderAll();
})();
