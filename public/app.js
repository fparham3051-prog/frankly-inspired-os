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
  // Encounters: two independent classifications (how contact happened vs.
  // where it left the relationship), plus a next-step datalist keyed by
  // stage - the same quick-fill-not-enum pattern as MODULE_NAME_SUGGESTIONS,
  // just picked dynamically instead of one fixed list.
  var INTERACTION_TYPE_LABELS = { call:"Call", meeting:"Meeting", email:"Email", letter:"Letter / mail", event:"Event", social:"Social touch", other:"Other" };
  var RELATIONSHIP_STAGE_LABELS = { identification:"Identification", cultivation:"Cultivation", solicitation:"Solicitation", stewardship:"Stewardship" };
  var NEXT_STEP_SUGGESTIONS_BY_STAGE = {
    identification: ["Schedule an introductory call", "Research organization and giving history", "Identify a warm connection point", "Add to prospect pipeline"],
    cultivation: ["Schedule a follow-up meeting", "Send relevant case for support materials", "Invite to an upcoming event", "Arrange a board or staff introduction"],
    solicitation: ["Prepare and deliver a proposal", "Schedule the ask meeting", "Follow up on a pending ask", "Confirm gift terms and next steps"],
    stewardship: ["Send a thank-you and acknowledgment", "Share an impact report", "Schedule a stewardship touch", "Invite to a recognition event"]
  };

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

  // An issue that's still open (or being discussed) two weeks after it was
  // logged is flagged stale, the same derived-not-stored pattern as an
  // overdue invoice or pipeline record - never a status that needs its own
  // daily syncing. A solved issue is never stale, whatever its age.
  var ISSUE_STALE_DAYS = 14;
  function issueAgeDays(i){
    var logged = (i.createdAt || "").slice(0,10);
    if(!logged) return null;
    return Math.floor((new Date(todayStr()) - new Date(logged)) / 86400000);
  }
  function isStaleIssue(i){
    if(i.status === "solved") return false;
    var days = issueAgeDays(i);
    return days !== null && days >= ISSUE_STALE_DAYS;
  }

  // A Priority left over from a quarter other than the current one, and not
  // yet marked Done, is flagged the same way - a heuristic aid, not a
  // guarantee, since "quarter" is a free-typed field here rather than a
  // computed value.
  function isStaleRock(r){
    if(r.status === "done") return false;
    var q = (r.quarter || "").trim();
    return !!q && q !== currentQuarterLabel();
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

  var state = { pipeline:[], scorecard:[], issues:[], rocks:[], prospects:[], digest:[], gifts:[], vision:null, orgLinks:[], invoices:[], engagementModules:[], timeEntries:[], encounters:[], advancementState:{ weekProgress:{}, credPursuing:{} }, quizAttempts:[], ready:false };
  // Structural-horizon data (see renderTimeHorizon below) loads separately
  // from the rest of state: it's a cache-only read of org 990 history, not
  // part of the gifts/pipeline/etc. payload /api/state already returns, and
  // it starts null (loading) rather than an empty array (nothing found) so
  // the panel can tell those two states apart.
  var orgStructuralSummary = null;
  var pipelineFilter = "all";
  var issueFilter = "all";
  var giftCategoryFilter = "all";
  var giftHigherEdOnly = false;
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
  // Feeds the four clickable stat tiles in the global masthead, present on
  // every view. This used to live inside renderDashboard(); pulled out on
  // its own so it keeps working now that Dashboard itself is retired.
  function renderMastheadStats(){
    document.getElementById("stat-active").textContent = state.pipeline.filter(function(p){ return !CLOSED_STAGES[p.stage]; }).length;
    document.getElementById("stat-issues").textContent = state.issues.filter(function(i){ return i.status !== "solved"; }).length;
    document.getElementById("stat-rocks").textContent = state.rocks.filter(function(r){ return r.status === "on-track"; }).length;
    document.getElementById("stat-weeks").textContent = state.scorecard.length;
  }

  // Dashboard's one panel that wasn't a duplicate of something already on
  // Command Center (its "next up in the pipeline" panel was byte-identical
  // to Engagements in Motion above) — folded in here directly.
  function renderCcOpenIssues(){
    var issueEl = document.getElementById("cc-open-issues");
    if(!issueEl) return;
    var issueList = state.issues
      .filter(function(i){ return i.status !== "solved"; })
      .sort(function(a,b){ return (a.createdAt || "").localeCompare(b.createdAt || ""); })
      .slice(0,6);
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
    renderCcOpenIssues();
    renderCcTrendTiles();
    renderCcFieldIntel();
    renderCcFinanceDelivery();
  }
  // ---------- masthead stat tiles + cross-links (clickable, jump to the relevant view/tab) ----------
  function goToView(view){
    var btn = document.querySelector('#app-nav .rail-btn[data-view="' + view + '"]');
    if(btn) btn.click();
  }
  function goToTab(tabsId, dataAttr, target){
    var btn = document.querySelector('#' + tabsId + ' [' + dataAttr + '="' + target + '"]');
    if(btn) btn.click();
  }
  var ccTrendsLink = document.getElementById("cc-trends-link");
  if(ccTrendsLink) ccTrendsLink.addEventListener("click", function(e){ e.preventDefault(); goToView("practice"); goToTab("rp-tabs", "data-rp-tab", "trends"); });
  var ccFieldIntelLink = document.getElementById("cc-fieldintel-link");
  if(ccFieldIntelLink) ccFieldIntelLink.addEventListener("click", function(e){ e.preventDefault(); goToView("fieldintel"); });
  var ccIssuesLink = document.getElementById("cc-issues-link");
  if(ccIssuesLink) ccIssuesLink.addEventListener("click", function(e){ e.preventDefault(); goToView("direction"); goToTab("dir-tabs", "data-dir-tab", "issues"); });
  var ccRocksLink = document.getElementById("cc-rocks-link");
  if(ccRocksLink) ccRocksLink.addEventListener("click", function(e){ e.preventDefault(); goToView("direction"); goToTab("dir-tabs", "data-dir-tab", "priorities"); });
  var ccFinanceLink = document.getElementById("cc-finance-link");
  if(ccFinanceLink) ccFinanceLink.addEventListener("click", function(e){ e.preventDefault(); goToView("practice"); goToTab("rp-tabs", "data-rp-tab", "finance"); });
  var ccDeliveryLink = document.getElementById("cc-delivery-link");
  if(ccDeliveryLink) ccDeliveryLink.addEventListener("click", function(e){ e.preventDefault(); goToView("practice"); goToTab("rp-tabs", "data-rp-tab", "delivery"); });
  document.getElementById("stat-tile-active").addEventListener("click", function(){ goToView("practice"); goToTab("rp-tabs", "data-rp-tab", "pipeline"); });
  document.getElementById("stat-tile-rocks").addEventListener("click", function(){ goToView("direction"); goToTab("dir-tabs", "data-dir-tab", "priorities"); });
  document.getElementById("stat-tile-weeks").addEventListener("click", function(){ goToView("practice"); goToTab("rp-tabs", "data-rp-tab", "scorecard"); });
  document.getElementById("stat-tile-issues").addEventListener("click", function(){
    issueFilter = "open";
    document.querySelectorAll("#issue-filters .filter-btn").forEach(function(b){
      b.classList.toggle("is-active", b.getAttribute("data-status") === "open");
    });
    renderIssues();
    goToView("direction");
    goToTab("dir-tabs", "data-dir-tab", "issues");
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
      state.encounters = data.encounters || [];
      state.advancementState = data.advancementState || { weekProgress: {}, credPursuing: {} };
      state.quizAttempts = data.quizAttempts || [];
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
        '<td><button type="button" class="btn ps-score" title="Score this organization in InstitutionalOS">Score</button> <button type="button" class="btn ps-promote">Promote</button> <button type="button" class="btn danger ps-delete">Remove</button></td>' +
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
    var scoreBtn = e.target.closest(".ps-score");
    if(scoreBtn){
      var scoreRow = scoreBtn.closest("tr");
      var scorePid = scoreRow.getAttribute("data-id");
      var scoreProspect = state.prospects.filter(function(p){ return p.id === scorePid; })[0];
      if(!scoreProspect) return;
      if(typeof window.openInstitutionalOS !== "function") return;
      window.openInstitutionalOS({
        org: scoreProspect.org || scoreProspect.name || "",
        description: scoreProspect.notes || "",
        pipelineId: scoreProspect.id
      });
      return;
    }
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

  // ---------- Encounters (dated contact reports, built on a peer's recommendation) ----------
  function renderEncounters(){
    populatePipelineSelect(document.getElementById("en-pipeline"));
    refreshNextStepSuggestions();
    refreshLoggedBySuggestions();
    renderEncounterRows();
  }
  function refreshNextStepSuggestions(){
    var dl = document.getElementById("en-next-suggestions");
    var stageEl = document.getElementById("en-stage");
    if(!dl || !stageEl) return;
    var list = NEXT_STEP_SUGGESTIONS_BY_STAGE[stageEl.value] || [];
    dl.innerHTML = list.map(function(s){ return '<option value="' + esc(s) + '">'; }).join("");
  }
  // Built from every logged_by value already on record, not a maintained
  // staff list somewhere else - the same demand-before-infrastructure
  // reasoning behind MODULE_NAME_SUGGESTIONS: a real second table for
  // staff names isn't worth it until this one datalist actually falls short.
  function refreshLoggedBySuggestions(){
    var dl = document.getElementById("en-logged-by-suggestions");
    if(!dl) return;
    var names = [];
    state.encounters.forEach(function(e){
      if(e.loggedBy && names.indexOf(e.loggedBy) === -1) names.push(e.loggedBy);
    });
    names.sort();
    dl.innerHTML = names.map(function(n){ return '<option value="' + esc(n) + '">'; }).join("");
  }
  function renderEncounterRows(){
    var body = document.getElementById("encounter-rows");
    if(!body) return;
    var rows = state.encounters.slice().sort(function(a,b){
      return (b.occurredAt || "").localeCompare(a.occurredAt || "") || (b.createdAt || "").localeCompare(a.createdAt || "");
    });
    if(rows.length === 0){
      body.innerHTML = '<tr><td colspan="8" class="empty-note">No prospect reports logged yet.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function(en){
      return '<tr data-id="' + esc(en.id) + '">' +
        '<td class="dim">' + (en.occurredAt ? fmtDate(en.occurredAt) : "") + '</td>' +
        '<td>' + esc(pipelineLabelById(en.pipelineId)) + '</td>' +
        '<td>' + esc(en.contactName || "") + '</td>' +
        '<td>' + esc(INTERACTION_TYPE_LABELS[en.interactionType] || en.interactionType || "") + '</td>' +
        '<td>' + esc(RELATIONSHIP_STAGE_LABELS[en.relationshipStage] || en.relationshipStage || "") + '</td>' +
        '<td class="dim">' + esc(en.nextStep || "") + '</td>' +
        '<td class="dim">' + esc(en.loggedBy || "") + '</td>' +
        '<td><button type="button" class="btn danger en-delete">Remove</button></td>' +
        '</tr>';
    }).join("");
  }
  document.getElementById("en-stage").addEventListener("change", refreshNextStepSuggestions);
  document.getElementById("en-new-contact").addEventListener("change", function(e){
    var isNew = e.target.checked;
    document.getElementById("en-pipeline-field").hidden = isNew;
    document.getElementById("en-pipeline").required = !isNew;
    document.getElementById("en-new-name-field").hidden = !isNew;
    document.getElementById("en-new-org-field").hidden = !isNew;
  });
  document.getElementById("encounter-rows").addEventListener("click", function(e){
    var btn = e.target.closest(".en-delete");
    if(!btn) return;
    var id = btn.closest("tr").getAttribute("data-id");
    if(!confirm("Remove this prospect report?")) return;
    apiFetch("/api/encounters/" + id, { method: "DELETE" })
      .then(refreshAndRender)
      .catch(function(err){ console.error(err); });
  });
  document.getElementById("encounter-form").addEventListener("submit", function(e){
    e.preventDefault();
    var statusEl = document.getElementById("en-status-msg");
    var isNew = document.getElementById("en-new-contact").checked;
    var data = {
      contactName: document.getElementById("en-contact-name").value.trim(),
      occurredAt: document.getElementById("en-date").value,
      interactionType: document.getElementById("en-type").value,
      relationshipStage: document.getElementById("en-stage").value,
      reason: document.getElementById("en-reason").value.trim(),
      nextStep: document.getElementById("en-next").value.trim(),
      nextStepDate: document.getElementById("en-next-date").value,
      summary: document.getElementById("en-summary").value.trim(),
      loggedBy: document.getElementById("en-logged-by").value.trim()
    };
    if(isNew){
      var newName = document.getElementById("en-new-name").value.trim();
      if(!newName){ statusEl.textContent = "Enter the new contact's name or organization."; return; }
      data.newContactName = newName;
      data.newContactOrg = document.getElementById("en-new-org").value.trim();
    } else {
      var pipelineId = document.getElementById("en-pipeline").value;
      if(!pipelineId){ statusEl.textContent = "Pick an engagement, or check “new contact.”"; return; }
      data.pipelineId = pipelineId;
    }
    apiFetch("/api/encounters", { method: "POST", body: data }).then(function(){
      document.getElementById("encounter-form").reset();
      document.getElementById("en-pipeline-field").hidden = false;
      document.getElementById("en-new-name-field").hidden = true;
      document.getElementById("en-new-org-field").hidden = true;
      statusEl.textContent = "Submitted.";
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
    var ids = ["cc-automation-health-list"];
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
    // Direction tab's read-only snapshot - the full six fields, unlike the
    // Weekly Session's trimmed three-field "Vision check" (visionGlanceField
    // is defined further down but this still works: function declarations
    // are hoisted within this IIFE's scope).
    var glanceEl = document.getElementById("direction-vision-glance");
    if(glanceEl){
      glanceEl.innerHTML =
        visionGlanceField("Core values", v.values) +
        visionGlanceField("Core focus, the niche and the purpose", v.focus) +
        visionGlanceField("Ten year target", v.tenYear) +
        visionGlanceField("Marketing strategy", v.marketing) +
        visionGlanceField("Three year picture", v.threeYear) +
        visionGlanceField("One year plan", v.oneYear);
    }
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
      var stale = isStaleIssue(i);
      var days = issueAgeDays(i);
      var ageText = "";
      if(days !== null && i.status !== "solved"){
        ageText = ' <span class="dim">&middot; ' + (days <= 0 ? "logged today" : (days === 1 ? "1 day open" : days + " days open")) + '</span>';
      }
      return '<tr data-id="' + esc(i.id) + '"' + (stale ? ' class="row-overdue"' : '') + '>' +
        '<td><strong>' + esc(i.title || "Untitled") + '</strong></td>' +
        '<td class="dim">' + esc(i.detail || "") + '</td>' +
        '<td><select class="inline-select is-status-select">' + opts + '</select>' + (stale ? ' <span class="overdue-tag">Stale</span>' : '') + '</td>' +
        '<td class="dim">' + fmtDate((i.createdAt || "").slice(0,10)) + ageText + '</td>' +
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
      var stale = isStaleRock(r);
      return '<tr data-id="' + esc(r.id) + '"' + (stale ? ' class="row-overdue"' : '') + '>' +
        '<td><strong>' + esc(r.title || "Untitled") + '</strong></td>' +
        '<td class="dim">' + esc(r.quarter || "") + (stale ? ' <span class="overdue-tag">Past quarter</span>' : '') + '</td>' +
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

    var higherEdToggle = document.getElementById("gl-highered-toggle");
    higherEdToggle.addEventListener("click", function(){
      giftHigherEdOnly = !giftHigherEdOnly;
      higherEdToggle.classList.toggle("is-active", giftHigherEdOnly);
      higherEdToggle.setAttribute("aria-pressed", giftHigherEdOnly ? "true" : "false");
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

    // Generic version of the same pattern, for the Scorecard/Forecasting
    // and Finance/Delivery tab groups below. panelSelector defaults to
    // .fw-card but can widen to catch an example-box riding along in a tab.
    function wireTabToolbar(tabsId, viewName, dataAttr, panelSelector){
      var tabsEl = document.getElementById(tabsId);
      if(!tabsEl) return;
      panelSelector = panelSelector || ".fw-card";
      tabsEl.addEventListener("click", function(e){
        var btn = e.target.closest("[" + dataAttr + "]");
        if(!btn) return;
        var target = btn.getAttribute(dataAttr);
        tabsEl.querySelectorAll("[" + dataAttr + "]").forEach(function(b){
          var active = b === btn;
          b.classList.toggle("is-active", active);
          b.setAttribute("aria-selected", active ? "true" : "false");
        });
        var scopedSelector = panelSelector.split(",").map(function(sel){
          return '.view[data-view="' + viewName + '"] ' + sel.trim();
        }).join(", ");
        document.querySelectorAll(scopedSelector).forEach(function(card){
          if(!card.hasAttribute(dataAttr)) return;
          card.hidden = (card.getAttribute(dataAttr) !== target);
        });
      });
    }
    wireTabToolbar("rp-tabs", "practice", "data-rp-tab", ".fw-card, .example-box");
    wireTabToolbar("dir-tabs", "direction", "data-dir-tab", ".fw-card, .example-box");
    wireTabToolbar("adv-tabs", "advancement", "data-adv-tab", ".adv-panel");

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
        higherEd: document.getElementById("gf-higher-ed").checked,
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
    document.getElementById("gl-stat-highered-count").textContent = gifts.filter(function(g){ return g.higherEd; }).length;
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
      if(giftHigherEdOnly && !g.higherEd) return false;
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
        '<div class="gift-meta"><span class="pill">' + esc(GIFT_CATEGORY_LABELS[g.category] || g.category) + '</span>' + (g.higherEd ? ' <span class="pill gold">Higher ed</span>' : '') + '<span>' + fmtDate(g.announcedAt) + stateTag + '</span>' +
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
    goToView("practice");
    goToTab("rp-tabs", "data-rp-tab", "prospecting");
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
  var playbookHigherEdOnly = false;

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
    var pbHigherEdToggle = document.getElementById("pb-highered-toggle");
    pbHigherEdToggle.addEventListener("click", function(){
      playbookHigherEdOnly = !playbookHigherEdOnly;
      pbHigherEdToggle.classList.toggle("is-active", playbookHigherEdOnly);
      pbHigherEdToggle.setAttribute("aria-pressed", playbookHigherEdOnly ? "true" : "false");
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
      '<div class="gift-meta"><span class="pill">' + esc(GIFT_CATEGORY_LABELS[g.category] || g.category) + '</span>' + (g.higherEd ? ' <span class="pill gold">Higher ed</span>' : '') + '<span>' + fmtDate(g.announcedAt) + stateTag + '</span>' +
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
      if(playbookHigherEdOnly && !g.higherEd) return false;
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
    renderMastheadStats();
    renderCommandCenter();
    renderPipeline();
    renderProspecting();
    renderScorecard();
    renderForecasting();
    renderFinance();
    renderDelivery();
    renderEncounters();
    renderVision();
    renderIssues();
    renderRocks();
    renderFieldIntel();
    renderPlaybookLibrary();
    renderTimeHorizon();
    renderPracticeTrends();
    renderAutomationHealth();
    renderAdvancementDesk();
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


  // ================================================================
  // The President's Desk (originally ported from the standalone Claude
  // Artifact "Advancement Desk", https://claude.ai/artifact/2eettWspqNgnW7BvmduzYJ,
  // September 2026; renamed October 2026 to add a Policy & Leadership tab)
  // ================================================================

  // ---------- The President's Desk: ported into FIOS September 2026 ----------
  // (from the standalone artifact at claude.ai/artifact/2eettWspqNgnW7BvmduzYJ,
  // then called "Advancement Desk").
  // Nav is FIOS's own #app-nav + a #adv-tabs toolbar (wireTabToolbar, already
  // defined above for Run the Practice/Direction); esc() is FIOS's own too.

  // ---------- glossary (feeds vocabulary + glossary view) ----------
  var GLOSSARY = [
    {term:"LOI", cat:"Grants", def:"Letter of Inquiry (or Intent). A short preliminary pitch to a funder, often one to two pages, used to gauge interest before a full proposal is invited.", why:"Most foundations screen on the LOI alone. A weak one never earns the RFP.", ex:"A program officer at a regional foundation asks every applicant for a 2-page LOI before an invited full proposal. It's the same screening step outfits like the Baltimore Community Foundation use, so a small staff isn't reading full proposals from applicants who were never a fit."},
    {term:"RFP", cat:"Grants", def:"Request for Proposal. A funder's formal call for proposals, spelling out eligibility, scope, and deadline.", why:"Reading the RFP's actual priorities before writing is the exact fix your own funder feedback pointed to.", ex:"A city Department of Human Services publishes an RFP for youth workforce programming with a hard deadline and a required logic model. Missing one required attachment, like a budget narrative, is grounds for automatic disqualification. No exceptions."},
    {term:"Moves Management", cat:"Major Gifts", def:"Cornell's donor-relationship framework: identification, qualification, cultivation, solicitation, and stewardship, used to track a prospect's progress toward a gift.", why:"It's the exact spine of the free Institutional Advancement Score tool's Gift Portfolio dimension.", ex:"A university identifies an alum who gave $500 at a reunion (identification), researches her business exit for real capacity (qualification), invites her to a campus tour and small dinner with the dean (cultivation), has the dean make a personal $250,000 ask over two years (solicitation), then names a scholarship after her and sends annual student-impact letters (stewardship). The whole five-stage sequence, in one relationship."},
    {term:"LYBUNT", cat:"Donor Data", def:"Gave Last Year But Unfortunately Not This year. A donor segment flagged for renewal outreach before they fully lapse.", why:"A clean LYBUNT list is the cheapest revenue recovery a client can run this quarter.", ex:"A local food bank runs its LYBUNT report every February: 340 donors gave in 2024 but not yet in 2025. A phone-a-thon targeting just that list, instead of the whole database, recovers 60 of them in three weeks. A far higher return than a general appeal."},
    {term:"SYBUNT", cat:"Donor Data", def:"Gave Some Year But Unfortunately Not This year. A broader lapsed-donor segment than LYBUNT, looking back further than one cycle.", why:"Distinguishes a truly lapsed donor from one who simply skipped last year.", ex:"That same food bank's SYBUNT list includes a donor who gave $1,000 in 2021 and nothing since. That's a colder conversation (a re-engagement call asking what changed) than the LYBUNT donor who just gave eleven months ago."},
    {term:"DAF", cat:"Planned &amp; Major Giving", def:"Donor-Advised Fund. A giving account held at a sponsor (Fidelity Charitable, Schwab Charitable, a community foundation); the donor recommends grants out of it.", why:"DAF grants are one of the fastest-growing gift sources. An org with no DAF-sponsor relationships is invisible to this channel.", ex:"A donor recommends a $25,000 grant from her Fidelity Charitable account. The nonprofit gets a grant letter from Fidelity Charitable, not a check with her name on it, and has no idea she's the one behind it unless she chooses to disclose herself."},
    {term:"QCD", cat:"Planned Giving", def:"Qualified Charitable Distribution. A direct transfer from an IRA to a qualified charity by someone 70½ or older. The 2026 limit is $111,000 per person, indexed annually, and it counts toward a required minimum distribution without being taxed as income.", why:"A concrete number to have ready the moment an IRA gift comes up in conversation.", ex:"A 74-year-old donor with a $600,000 IRA transfers $50,000 directly from the custodian to a nonprofit's bank account. That $50,000 counts toward her required minimum distribution for the year but never shows up as taxable income, unlike a normal withdrawal she then chose to donate."},
    {term:"CRT", cat:"Planned Giving", def:"Charitable Remainder Trust. An irrevocable trust that pays income to the donor (or another beneficiary) for a term, then distributes what remains to the named charity.", why:"Part of the vehicle vocabulary behind the wealth-transfer research already on file.", ex:"A donor puts $1 million of appreciated stock into a CRT, avoids the capital-gains hit she'd have taken selling it outright, draws a 5% annual income payment for 20 years, and whatever's left in the trust when the term ends goes to the nonprofit named as remainder beneficiary."},
    {term:"CGA", cat:"Planned Giving", def:"Charitable Gift Annuity. A contract where a donor gives an asset in exchange for a fixed income stream for life, with the remainder passing to the nonprofit.", why:"Often the easiest planned-giving entry point to explain to a first-time legacy donor.", ex:"An 80-year-old donor gives $100,000 to a university in exchange for a gift annuity paying roughly $7,000 to $8,000 a year for life, rate set by her age at the time; when she dies, whatever principal remains becomes an outright gift."},
    {term:"CLT", cat:"Planned Giving", def:"Charitable Lead Trust. The mirror of a CRT: the charity receives income for a term first, then the remainder reverts to the donor's heirs, often used for estate-tax planning.", why:"Comes up with donors whose advisors are already thinking about estate-tax exposure.", ex:"A wealthy family funds a CLT that pays a nonprofit $40,000 a year for 15 years; at the end of the term, the remaining trust assets pass to the family's grandchildren, often at a steep estate-tax discount compared to a straight inheritance."},
    {term:"Case for Support", cat:"Fundraising Strategy", def:"The core document making the argument for why an organization deserves investment. The backbone most proposals and campaign pitches draw from.", why:"A weak case for support is usually the real reason a technically fine proposal reads generic.", ex:"Before a capital campaign, an organization writes a 10-page case for support answering 'why this, why now, why us.' The foundation proposal, the leadership-gift pitch, and the campaign brochure end up as different lengths of that same underlying argument."},
    {term:"Cultivation", cat:"Major Gifts", def:"The relationship-building stage between first contact and the ask. Tours, briefings, one-on-one meetings that build genuine trust.", why:"Skipping straight to the ask is the fastest way to burn a major-gift prospect.", ex:"Over eight months, a hospital foundation invites a prospect to two behind-the-scenes tours of a new cancer center and has the chief medical officer call to thank him personally for a small gift. All before anyone asks him for anything larger."},
    {term:"Stewardship", cat:"Donor Relations", def:"Everything that happens after the gift: reporting, recognition, and impact updates that earn the next one.", why:"Only 36% of nonprofits provide the regular impact updates 65% of donors say they want. A 29-point gap most orgs don't know they have.", ex:"A donor who funded a $50,000 scholarship gets a handwritten note from the student who received it, an invitation to graduation, and an annual one-page impact report: three touches a year, none of them an ask."},
    {term:"Major Gift", cat:"Major Gifts", def:"A gift large enough, relative to an organization's typical gift size, to warrant individualized cultivation. The threshold varies by org, often five figures and up for a mid-size nonprofit.", why:"The threshold is relative, not absolute, and it's worth defining explicitly with every client.", ex:"At a $2M/year nonprofit, a $10,000 gift might be a major gift warranting a personal visit; at a $200M university, the floor might start at $25,000 or $50,000. The number tracks the org's own gift table, not a fixed industry figure."},
    {term:"Principal Gift", cat:"Major Gifts", def:"The tier above major gifts. Transformational, often the single largest gifts a campaign will ever receive.", why:"Distinct enough from major gifts that it usually needs its own cultivation timeline.", ex:"A university running a $500M campaign might have a principal-gifts team whose entire portfolio is fewer than 50 prospects capable of $5 million or more, a tier often managed personally by the president or a dedicated VP."},
    {term:"Planned Giving", cat:"Planned Giving", def:"Gifts arranged now but realized later, typically through a will, trust, or beneficiary designation. Bequests are the largest category.", why:"Bequest giving grew 19.7% in the latest Giving USA report, the third year in four with 20%+ growth.", ex:"A donor updates her will to leave 10% of her estate to a nonprofit she's supported for 20 years; the organization won't see a dollar until she passes, but logs her today in its legacy society and stewards her exactly like a current donor."},
    {term:"Capital Campaign", cat:"Fundraising Strategy", def:"A time-bound effort to raise a large sum for a defined purpose, typically run in a quiet or silent phase (securing lead gifts before going public) then a public phase.", why:"A campaign that skips the quiet phase is usually one that hasn't actually tested whether the goal is realistic.", ex:"A $15 million building campaign spends 18 months quietly lining up $9 million (60%) from a handful of lead donors and the board before announcing a public number. The public phase then asks the broader base to close the remaining $6 million, with momentum already visible."},
    {term:"Cost to Raise a Dollar", cat:"Financial Health", def:"Total fundraising expense divided by dollars raised. The Greenfield framework puts a healthy blended average around $0.20, though it varies hugely by channel. Direct-mail acquisition runs $1.00 to 1.25, major gifts $0.05 to 0.10.", why:"A useful gut-check number, but a dangerous one to over-index on for any single channel.", ex:"A direct-mail acquisition letter might cost $1.10 to bring in every $1.00 of new-donor revenue, a deliberate loss-leader meant to build the file, while the same org's major-gifts program costs $0.07 per dollar. Blending those into one number hides which program is actually working."},
    {term:"Donor Retention Rate", cat:"Donor Data", def:"The share of last year's donors who give again this year. The Fundraising Effectiveness Project put the 2025 national average at 43.3%.", why:"Retention is usually cheaper to improve than acquisition, and most orgs still don't track it by segment.", ex:"An organization with 1,000 donors in 2025 that sees 433 of them give again in 2026 is sitting exactly at the national average. Below that, the org is bleeding revenue faster than new donors can replace it."},
    {term:"Gift Range Chart", cat:"Fundraising Strategy", def:"A pyramid mapping how many gifts at each size are needed to hit a campaign goal. The top few gifts do most of the work.", why:"The fastest way to show a board why five lead gifts matter more than five hundred small ones.", ex:"For a $1 million campaign, a typical gift range chart might call for 1 gift of $150,000, 2 gifts of $75,000, and 4 of $50,000 before scaling down to 200 gifts of $250, showing on paper that the top 7 gifts alone need to cover nearly a third of the goal."},
    {term:"Board Give-or-Get", cat:"Governance", def:"The expectation that every board member either gives a meaningful personal gift or helps secure one from their own network.", why:"Comes up constantly in governance assessments. A board with no give-or-get norm usually shows it in the numbers.", ex:"A board adopts a policy that every member gives $2,500 personally or helps secure it from their network. A member who can't afford $2,500 might instead host a small gathering that nets $3,000 from six guests, satisfying the 'get' half."},
    {term:"Matching Gift", cat:"Corporate Giving", def:"A gift a donor's employer multiplies, often 1:1, or a challenge gift a major donor pledges to match to spur other giving.", why:"An underused lever. Many donors don't know their employer offers one until asked.", ex:"A donor gives $500 and her employer's matching-gift program doubles it to $1,000. An estimated $4 to 7 billion in matching funds goes unclaimed industry-wide every year, simply because no one asked the question."},
    {term:"Endowment", cat:"Financial Health", def:"Invested funds where only the earnings, not the principal, are spent. A permanent, self-renewing revenue source.", why:"A common confusion point for boards: an endowment is not a rainy-day fund you can simply draw down.", ex:"A $2 million endowment invested to earn roughly 4 to 5% a year generates $80,000 to $100,000 in spendable income annually in perpetuity. Spending down the $2 million principal to cover one bad budget year would defeat the fund's whole purpose."},
    {term:"Restricted / Unrestricted Gift", cat:"Financial Health", def:"Restricted gifts carry donor-specified use; unrestricted gifts can go anywhere the organization needs them.", why:"Boards prize unrestricted revenue precisely because it's the only kind that's actually flexible.", ex:"A $100,000 gift restricted to 'youth STEM programming only' can't cover a rent increase or a payroll gap next year, no matter how urgent. Only unrestricted revenue can flex to wherever the need actually is."},
    {term:"Form 990", cat:"Governance", def:"The annual public tax filing every U.S. nonprofit above a revenue threshold must file. The primary public window into an organization's finances and governance.", why:"The real data source behind the Health Index Engine's deterministic Financial Health scoring.", ex:"Anyone (a funder, a journalist, a job candidate) can pull an organization's last three years of 990s free on ProPublica's Nonprofit Explorer or Candid's GuideStar, and see the CEO's exact salary and program-expense ratio before ever picking up the phone."},
    {term:"Appreciated Securities", cat:"Complex Assets", def:"Publicly traded stock or funds held over a year and donated directly to a charity rather than sold first. Valued for gift-crediting and deduction purposes at the mean of the high and low trading price on the date the shares are legally transferred, not the date the donor instructed the transfer or the date the charity sells them.", why:"Getting the valuation date wrong is the single most common gift-acceptance error with stock gifts, and it changes both the donor's deduction and the amount credited to campaign.", ex:"A donor emails her broker on December 28 to transfer $50,000 of stock to a university. The shares don't actually land in the university's brokerage account until January 3. The gift is valued, and counted, using the January 3 price and tax year, not December 28, even though that wasn't the donor's intent."},
    {term:"Gift of Real Property", cat:"Complex Assets", def:"A gift of land or a building, either outright, through a bargain sale, or via a retained life estate (the donor gifts the property now but keeps the right to live in or use it for life). Requires a qualified independent appraisal for any deduction over $5,000 and a documented review of title, environmental risk, and carrying costs before acceptance.", why:"Real estate is the complex-asset gift type most likely to sit unacted-on in an inbox because nobody owns the environmental and title diligence.", ex:"A donor offers a rental duplex to a nonprofit. Before accepting, the gift-acceptance committee orders a title search and a Phase I environmental assessment, confirms there's no unpaid property tax or existing tenant lease that would create ongoing liability, and gets an independent appraisal, all before the gift is ever formally accepted."},
    {term:"Closely-Held Business Interest", cat:"Complex Assets", def:"A gift of stock or membership interest in a privately held company (an S-corp, C-corp, LLC, or partnership) rather than publicly traded shares. Requires a qualified appraisal, legal review of transfer restrictions in the company's own governing documents, and an assessment of whether the gift creates Unrelated Business Taxable Income (UBTI) for the nonprofit.", why:"This is the gift type most likely to require declining or restructuring, a nonprofit can't sell a privately held interest on the open market the way it can stock.", ex:"A donor wants to give 15% of his privately held manufacturing company. Before accepting, counsel confirms the company's operating agreement doesn't bar transfers to outside parties, and the organization evaluates whether holding the interest, and any eventual profit distributions, would trigger UBTI."},
    {term:"Life Insurance Gift", cat:"Complex Assets", def:"Naming a charity as life insurance beneficiary (revocable, no current deduction, gift only realized at death) versus irrevocably transferring policy ownership to the charity (current deduction for the cash surrender value, and the charity itself becomes responsible for any ongoing premiums).", why:"Donors and even gift officers routinely conflate these two structures, and they have opposite tax and administrative consequences.", ex:"A donor names a nonprofit as beneficiary on a $250,000 policy, revocable any time, no deduction today, logged as a bequest expectancy. A different donor irrevocably transfers ownership of a paid-up $100,000 policy to the same nonprofit, takes a deduction for its cash value this year, and the nonprofit now owns an asset it could surrender for cash if it chose to."},
    {term:"Cryptocurrency Gift", cat:"Complex Assets", def:"A gift of Bitcoin, Ethereum, or another digital asset. The IRS treats cryptocurrency as property, not currency, so it follows the same rules as appreciated stock: no capital gains tax on the appreciation if held over a year, a deduction at fair market value, and a qualified appraisal required for any gift over $5,000.", why:"The fastest-growing complex-asset gift type with the least institutional readiness, most nonprofits still have no documented process for accepting or liquidating it.", ex:"A donor wants to give $30,000 of Bitcoin he's held for three years. The organization needs a crypto-accepting processor or exchange account set up before it can receive the gift at all, and, because it's over $5,000, the donor needs a qualified appraisal to substantiate the deduction, the same requirement as a stock or real estate gift."},
    {term:"Form 8283", cat:"Documentation", def:"The IRS form a donor must file with their tax return for any noncash charitable contribution deduction over $500. Gifts over $5,000 require a qualified appraiser's signature on the form (Section B), and the receiving nonprofit must sign to acknowledge receipt.", why:"A nonprofit that doesn't track which gifts need a signed 8283 leaves donors exposed to a disallowed deduction, and itself exposed to an awkward call from an unhappy donor's accountant in April.", ex:"A donor gives real estate worth $80,000. Her CPA sends over a Form 8283 with a qualified appraiser's signature already on it. The gift officer has the executive director countersign the nonprofit's acknowledgment section and files a copy before the fiscal year closes, not after the donor's tax deadline forces a scramble."},
    {term:"Gift Acceptance Policy", cat:"Governance", def:"A board-approved document setting out which asset types an organization will and won't accept, who has authority to approve exceptions, and what review (legal, appraisal, environmental) each complex gift type requires before acceptance.", why:"Without one, a real estate or closely-held-business offer becomes a case-by-case improvisation instead of a documented, defensible process; most gift-acceptance regrets trace back to skipping this.", ex:"A donor offers a rental property with a specific tenant already in place. Because the organization has a gift acceptance policy requiring board finance-committee sign-off on any real estate gift over $50,000, the offer goes through a documented review, title, environmental, and carrying-cost analysis, before anyone says yes, rather than a well-meaning verbal acceptance at a donor lunch."}
  ];

  function dayOfYear(d){
    var start = new Date(d.getFullYear(), 0, 0);
    var diff = d - start;
    return Math.floor(diff / 86400000);
  }

  function renderVocabulary(){
    var idx = dayOfYear(new Date()) % GLOSSARY.length;
    var t = GLOSSARY[idx];
    document.getElementById("vocab-term").textContent = t.term;
    document.getElementById("vocab-category").textContent = t.cat.replace(/&amp;/g, "&");
    document.getElementById("vocab-def").textContent = t.def;
    document.getElementById("vocab-why").textContent = t.why;
    document.getElementById("vocab-ex").textContent = t.ex;
  }
  document.getElementById("vocab-browse").addEventListener("click", function(){
    document.querySelector('#adv-tabs [data-adv-tab="glossary"]').click();
  });

  function renderGlossary(){
    document.getElementById("glossary-body").innerHTML = GLOSSARY.map(function(t){
      return '<div class="digest-card"><h4>' + esc(t.term) + ' <span class="pill">' + t.cat + '</span></h4>' +
        '<p>' + esc(t.def) + '</p>' +
        '<p><strong style="color:var(--ink);">Example:</strong> ' + esc(t.ex) + '</p></div>';
    }).join("");
    document.getElementById("stat-terms").textContent = GLOSSARY.length;
  }

  // ---------- this week ----------
  var WEEK_EVENTS = [
    {id:"afp-deepdive-3", title:"AFP Deep Dive: Fundamentals of Fundraising, Day 3 of 4", meta:["TUE 9/15","12:00 to 5:00 PM ET","Virtual"], status:"warn", statusLabel:"Not registered", url:"https://afpglobal.org/webinars/afp-deep-dive-fundamentals-fundraising-virtual-course-4-day-series-sept-2026", cta:"Register"},
    {id:"drg-webinar", title:"DRG Webinar: Engagement at Scale (Storytelling for Relationship)", meta:["TUE 9/15","1:00 to 2:00 PM ET","Virtual","$60"], status:"warn", statusLabel:"Not registered", url:"https://donorrelations.com/2026-webinar-series", cta:"Register"},
    {id:"afpdc-legacy", title:"AFP-DC: From Legacy to Next Gen Giving (Video &amp; Fundraising)", meta:["WED 9/16","8:30 to 9:45 AM ET","Location unpublished","CFRE credit"], status:"neutral", statusLabel:"Confirm location", url:"https://afpdc.org/upcoming-events", cta:"AFP-DC events"},
    {id:"afp-major-gift", title:"AFP Webinar: The Ask Isn't the Hard Part (Major Gift Presence)", meta:["THU 9/17","Time unpublished","Free members / $129 non-members"], status:"warn", statusLabel:"Not registered", url:"https://afpglobal.org/professional-development/webinars", cta:"Register"},
    {id:"afp-deepdive-4", title:"AFP Deep Dive: Fundamentals of Fundraising, Day 4 of 4 (final)", meta:["THU 9/17","12:00 to 5:00 PM ET","Virtual"], status:"warn", statusLabel:"Not registered", url:"https://afpglobal.org/webinars/afp-deep-dive-fundamentals-fundraising-virtual-course-4-day-series-sept-2026", cta:"Register"}
  ];

  function renderWeek(){
    document.getElementById("week-list").innerHTML = WEEK_EVENTS.map(function(ev){
      var pillClass = ev.status === "warn" ? "pill warn" : "pill";
      return '<div class="event-card" data-id="' + ev.id + '">' +
        '<div class="event-main"><div class="event-title">' + ev.title + '</div>' +
        '<div class="event-meta">' + ev.meta.map(function(m){ return '<span>' + esc(m) + '</span>'; }).join('<span>&middot;</span>') + '</div></div>' +
        '<span class="' + pillClass + '" data-role="pill">' + ev.statusLabel + '</span>' +
        '<div class="event-actions"><a class="btn" href="' + ev.url + '" target="_blank" rel="noopener">' + ev.cta + ' →</a>' +
        (ev.status === "warn" ? '<label class="check-label"><input type="checkbox" data-track="' + ev.id + '"> Done</label>' : '') +
        '</div></div>';
    }).join("");

    document.querySelectorAll('#week-list [data-track]').forEach(function(box){
      var evId = box.getAttribute("data-track");
      var weekProgress = (state.advancementState && state.advancementState.weekProgress) || {};
      if(weekProgress[evId]) box.checked = true;
      function apply(){
        var card = box.closest(".event-card");
        var pill = card.querySelector('[data-role="pill"]');
        if(box.checked){ pill.textContent = "Registered"; pill.className = "pill gold"; }
        else { pill.textContent = "Not registered"; pill.className = "pill warn"; }
      }
      apply();
      box.addEventListener("change", function(){
        apply();
        var patch = {}; patch[evId] = box.checked;
        apiFetch("/api/advancement-state", { method:"PUT", body:{ weekProgress: patch } }).then(refreshAndRender);
      });
    });
  }

  function openCount(){
    var weekProgress = (state.advancementState && state.advancementState.weekProgress) || {};
    return WEEK_EVENTS.filter(function(ev){
      return ev.status === "warn" && !weekProgress[ev.id];
    }).length;
  }
  function updateOpenStat(){ document.getElementById("stat-open").textContent = openCount(); }

  function renderGlance(){
    var open = openCount();
    var confirmNeeded = WEEK_EVENTS.filter(function(ev){ return ev.status === "neutral"; }).length;
    var items = [
      {who: open === 0 ? "All this week's registrations are handled" : (open + " registration" + (open===1?"":"s") + " still open"), when: "Sept 15 to 17"},
      {who: "Tuesday's AFP Deep Dive and DRG webinar overlap 1 to 2 PM", when: "conflict"},
      {who: confirmNeeded + " event" + (confirmNeeded===1?"":"s") + " needs a location confirmed", when: "AFP-DC"}
    ];
    document.getElementById("glance-list").innerHTML = items.map(function(i){
      return '<li><span class="who">' + esc(i.who) + '</span><span class="when">' + esc(i.when) + '</span></li>';
    }).join("");
  }

  // ---------- certifications ----------
  var DOMAIN_NOTES = {
    CFRE: [
      {domain:"Relationship Building", points:[
        "Moves management's five stages, in order: Identification, Qualification, Cultivation, Solicitation, Stewardship. Qualification confirms real capacity and interest before more cultivation time is spent; Cultivation is every touch after first contact and before the ask (tours, briefings, one-on-one meetings); Stewardship is everything after the gift (reports, recognition, impact updates).",
        "A prospect is ready to move from cultivation to solicitation when interest is confirmed, capacity is reasonably confirmed, and a specific ask has been developed, not just database tenure.",
        "\"You-focused\" donor communications (Tom Ahern) write appeals and reports from the donor's point of view, not the organization's institutional voice.",
        "A matching gift is an employer doubling (often 1:1) a donor's gift through a workplace program; an estimated $4 to 7 billion in matching funds goes unclaimed industry-wide each year because no one asks.",
        "DAF grants arrive from the sponsor (Fidelity Charitable, Schwab Charitable, a community foundation), not the donor by name, the org typically can't identify who's behind it unless the donor discloses.",
        "LYBUNT = gave Last Year But Unfortunately Not This year (a near-lapsed, high-value list to work first); SYBUNT = Some Year But Unfortunately Not This year, looking back further than one cycle, a colder segment than LYBUNT.",
        "Penelope Burk's Cygnus donor-centered research found a thank-you call within 24 to 48 hours of a gift, before any further ask, meaningfully raises the odds of a repeat gift.",
        "A donor engagement ladder (first-time &rarr; repeat &rarr; mid-level &rarr; major &rarr; legacy) exists to plan differentiated stewardship and cultivation by stage, not a uniform approach.",
        "Structured donor listening (a donor advisory council or feedback loop) hears directly from longtime donors before changing stewardship tactics.",
        "Because acquiring a new donor costs substantially more than retaining one, relationship-building investment generally pays off most in stewardship and retention of current donors.",
        "Recognition or giving societies (named donor tiers with perks) reinforce donor identity and continued giving; they support, but don't replace, personal stewardship.",
        "Peer-to-peer fundraising uses a donor as an ambassador in her own network (a giving circle she recruits into), reaching people staff alone couldn't.",
        "Donor journey mapping traces a donor's full arc of touchpoints to find exactly where communication has gone quiet.",
        "Genuine donor-centered stewardship reflects a donor's specific interests and shows impact over time, distinct from a generic, transactional thank-you.",
        "A donor who suddenly stops responding after years of consistent giving warrants a direct, personal check-in, not an automatic write-off or a louder ask.",
        "Stewardship should be proportional: a $50 annual donor and a $50,000 major donor should receive noticeably different depth and frequency of contact."
      ]},
      {domain:"Securing the Gift", points:[
        "The major-gift threshold is relative to each organization's own gift table, not a universal figure, define it explicitly for every client ($10,000 at a $2M/year org vs. $25,000 to $50,000 at a $200M university).",
        "Gift tiers run smallest to largest: annual gift &rarr; major gift (individualized cultivation) &rarr; principal gift (the transformational tier above major gifts).",
        "The case for support (\"why this, why now, why us\") is the backbone argument every proposal and campaign pitch draws from; a weak case reads as a generic ask.",
        "A campaign's quiet (silent) phase lines up roughly 50 to 60%+ of the goal from lead donors and the board before any public announcement, testing whether the goal is realistic.",
        "A gift range chart (pyramid) shows a small number of top gifts do most of the work toward a goal, in a $1M campaign, as few as 7 lead gifts can cover close to a third of the total.",
        "An endowment spends only investment earnings, never the principal, making it a permanent, self-renewing revenue source, not a rainy-day fund.",
        "Unrestricted revenue is the only kind that can flex to wherever an organization's actual need is; a gift restricted to one program can't cover, say, an unexpected rent increase.",
        "The Greenfield framework puts a healthy blended cost-to-raise-a-dollar average around $0.20, though this varies hugely by channel (direct-mail acquisition can run over $1.00; major gifts often run under $0.10).",
        "Blending very different channel-level cost ratios (a $1.10-per-dollar acquisition mailer next to a $0.07-per-dollar major-gifts program) into one org-wide number hides which specific program is actually performing.",
        "A successful major-gift close is almost always preceded by a personal visit and a specific ask amount tied to a concrete project or need, not an impersonal or generic appeal.",
        "The ask itself should be a specific dollar amount, informed by research into the donor's capacity and giving history, not left vague.",
        "Campaigns proceed through quiet phase &rarr; leadership-gifts phase (widening the circle of significant donors and volunteer leaders beyond the initial lead gifts) &rarr; public phase.",
        "Multi-year pledges let a donor commit to a larger total gift, paid over several years, than they could give in a single year.",
        "Challenge or matching gifts create urgency and a sense of amplified impact that motivates other donors to give, or give more.",
        "Thorough pre-visit preparation (full giving history, past conversations, stated interests) lets a solicitor tailor both the amount and framing of the ask.",
        "A \"no\" in the moment is often \"not now\" or \"not at this amount,\" worth gently exploring further rather than treating as a permanent rejection.",
        "Blended gifts pair an outright component with a planned or deferred component (for example, $100,000 now plus a $150,000 bequest commitment) to reach a larger total.",
        "Assumptive, confident language in a solicitation meeting, paired with real listening rather than pressure, tends to outperform tentative or apologetic asks.",
        "Recognition naming (a scholarship, a room) tied to a donor's own values and legacy can be a genuine, often decisive part of what makes a large gift meaningful, not mere decoration.",
        "For the gift-type-specific execution steps and documentation this domain assumes, stock valuation timing, real estate and closely-held-business diligence, life insurance ownership transfer versus beneficiary designation, see the <a href=\"https://claude.ai/artifact/VLQWzDuQFHRTbFM9VgTcu2\" target=\"_blank\" rel=\"noopener\">Gift Type Execution Playbook</a>, which works through identification-to-documentation for each asset type."
      ]},
      {domain:"Leadership and Management", points:[
        "Board give-or-get: every board member either gives a meaningful personal gift or helps secure one through their own network (hosting, introductions), a common governance gap when left unstated.",
        "Organization-wide, moves management gives an entire team, not just one gift officer's memory, a shared way to track every prospect's progress through the pipeline.",
        "Field voices like Mallory Erickson frame fundraiser burnout and retention as a leadership-and-culture issue rooted in organizational power dynamics, not an individual failing to push through.",
        "Leadership-development programming built for nonprofit professionals of color navigating predominantly white institutions (Kishshana Palmer's work, for example) addresses challenges specific to those institutional dynamics.",
        "A fiscal-year development plan organizes around goals, a gift range chart, and a timeline tied to those goals, the management backbone for the year.",
        "In a campaign's quiet phase, volunteer leadership's role is mainly to help secure lead gifts and lend credibility to the ask, often ahead of any staff-led public appeal.",
        "Relying on one funder for a large share of budget (70%, say) is a concentration risk leadership should actively diversify against.",
        "Keeping a principal-gifts portfolio narrow and senior (under 50 prospects at $5M+ capacity, for example) is a deliberate organizational design choice reflecting how complex those relationships are.",
        "Consulting infrastructure built by firms like Veritus Group focuses on making mid-level and major-gift cultivation repeatable across a team, not dependent on one gift officer's instincts.",
        "The community-centric fundraising movement (Vu Le) calls on leadership to make community accountability and equity explicit organizational priorities, not just institutional growth.",
        "Tracking gift-officer performance on both activity (visits, proposals) and outcomes (dollars closed) is standard major-gift management practice, giving an early read before results alone would show.",
        "High frontline turnover is a real management risk because major donor relationships are often tied to a specific gift officer; losing them can disrupt trust and momentum, not just create a staffing gap.",
        "Monitoring fundraising cost ratios against a reasonable range is a budget-management and financial-oversight responsibility distinct from frontline solicitation.",
        "Rolling out a new CRM well requires change management, staff training and a data-migration plan, since a system nobody adopts well delivers no value.",
        "Orienting new board members on the case for support and their fundraising role is a leadership function, even though the resulting activity is volunteer-led.",
        "Relying on a single major revenue stream (one large gala, say) creates revenue concentration risk; diversifying streams is standard risk management.",
        "An annual development plan (dollar goals by revenue stream, timeline, staff assignments) is a management tool that turns strategy into something leadership can actually track.",
        "Succession planning for long-tenured major-gift officers matters because an unplanned departure risks disrupting deeply personal donor relationships built over years.",
        "Reporting pipeline stage (qualified prospects at each stage), not just dollars raised, gives the board an early, forward-looking signal rather than only a lagging snapshot.",
        "Delegating mid-level solicitation to trained gift officers while the executive director focuses on top prospects reflects a deliberate resource-allocation choice matching solicitor seniority to prospect capacity."
      ]},
      {domain:"Current and Prospective Donor Research", points:[
        "Form 990 is the free, public annual tax filing (via ProPublica's Nonprofit Explorer or Candid's GuideStar) that shows a nonprofit's finances, governance, and executive pay, the starting point for researching any U.S. nonprofit.",
        "Wealth screening measures capacity to give; motivation-based research asks whether and why a prospect would actually give, capacity alone doesn't predict a gift.",
        "DAF grants are a research blind spot: the grant letter names the sponsor (Fidelity Charitable, Schwab Charitable), not the donor, unless the donor chooses to self-identify.",
        "The longer a donor has lapsed, the colder the conversation: a SYBUNT donor from years back needs a different approach than an eleven-month LYBUNT donor.",
        "Giving USA 2026: total U.S. giving crossed $600 billion for the first time in 2025 ($617.20B, up 5.7%); bequest giving grew 19.7% that year, the third year in four with 20%+ growth, a signal legacy-giving research on an aging donor file deserves real attention.",
        "The Fundraising Effectiveness Project put the 2025 national donor retention rate average at 43.3%, an organization below that figure is losing donors faster than new ones replace them.",
        "Strong legacy-conversation candidates combine a long, consistent multi-year giving history with engagement in legacy-society communications, not a single data point.",
        "LYBUNT status alone only flags a pattern (gave last year, not yet this year), it carries no context on why, which research still has to uncover.",
        "A liquidity event (a business sale, an inheritance) is a classic signal of a jump in giving capacity, worth flagging for renewed cultivation.",
        "RFM analysis (Recency, Frequency, Monetary value of past gifts) turns a donor's own giving history into a practical tool for segmenting and prioritizing the file.",
        "Real estate holdings and public securities filings are capacity indicators (evidence of wealth), distinct from affinity, which measures interest and connection to the cause.",
        "Strong documented capacity with no known mission connection doesn't justify solicitation on its own, affinity and a genuine relationship still need to be built or confirmed.",
        "Peer screening (a rated request) asks well-connected volunteers to review a prospect list and rate who they know and how generous or connected those people are, supplementing formal wealth data.",
        "A documented pattern of gifts to similar-mission organizations, found in those organizations' public annual reports, is a strong affinity signal that complements capacity data.",
        "Data hygiene (accurate, deduplicated, current records) is foundational: research built on outdated records risks wasted solicitation effort and avoidable donor-relations mistakes.",
        "A board member reviewing the prospect list and flagging their own personal and professional network is a legitimate, valuable research source that screening tools alone can miss.",
        "Predictive modeling (using variables like past giving, event attendance, engagement) surfaces a ranked shortlist of donors statistically likely to increase giving or make a major gift.",
        "A gala attendee not yet a donor, but in a senior role at a major employer, is logged as a new prospect worth further qualification, not a finished capacity assessment.",
        "Researchers treat any single strong data point (one large real estate holding, say) with caution, looking for multiple corroborating indicators before concluding real capacity."
      ]},
      {domain:"Ethics, Accountability, and Professionalism", points:[
        "Under AFP's Code of Ethical Standards, compensation for fundraising counsel and staff should be salary or fixed fees, never commission or a percentage of funds raised (a proposed 10%-of-campaign fee is a textbook conflict of interest).",
        "Form 990's public availability exists specifically for accountability and transparency, anyone can pull three years of filings free on ProPublica's Nonprofit Explorer or Candid's GuideStar, including executive pay, so leadership has real reason to review it carefully before filing.",
        "The Lilly Family School of Philanthropy at Indiana University publishes the annual Giving USA report, the field's most-cited sector benchmark data.",
        "Stewardship reporting (an impact report, recognition, outside any solicitation) demonstrates accountability, showing a donor their restricted or intended gift was actually used as promised.",
        "An organization cannot ethically redirect a restricted gift to a different purpose without the donor's permission; doing so is both an ethics and often a legal issue.",
        "AFP's Donor Bill of Rights centers donor transparency: donors have the right to be informed how their gift will be used and assured it's applied to the stated purpose.",
        "A donor's request for anonymity creates a baseline ethical obligation to honor it, regardless of gift size.",
        "Learning a major prospect has a documented history of business practices under public scrutiny calls for consulting the gift acceptance policy and leadership before proceeding, not a unilateral call either way.",
        "Selling or renting a donor mailing list without consent or an opt-out violates donor privacy and data-protection expectations embedded in professional ethics codes.",
        "A staff-level conflict of interest (a spouse's company as vendor, say) requires disclosure to leadership and recusal from that specific decision, not silence, and not automatic resignation.",
        "Claims of program impact (\"transformed thousands of lives\") must be accurate and substantiated, not inflated language unsupported by real data, a truth-in-communications standard.",
        "An independent financial audit by an outside firm gives donors, regulators, and the board an objective, external check on financial statements and controls, beyond self-reported numbers.",
        "An undisclosed \"finder's fee\" from a vendor is a conflict of interest, generally prohibited under professional fundraising ethics codes.",
        "Redirecting an old, now-obsolete restricted endowment gift generally requires a formal legal process (court approval or a variance procedure) to honor donor intent, not unilateral staff discretion.",
        "CFRE recertification's continuing-education point requirement exists to keep certified professionals current, an ongoing accountability mechanism, not a one-and-done credential.",
        "Transparency about the program-versus-fundraising/admin split of a budget lets donors and the public judge how efficiently and honestly an organization operates.",
        "A whistleblower policy, protecting staff who report ethical or financial concerns from retaliation, is an internal-accountability mechanism that surfaces problems early.",
        "AFP's Ethics Committee process for a formal complaint against a member exists to provide a structured, fair review, holding the profession accountable to its own stated Code."
      ]},
      {domain:"Volunteer Involvement", points:[
        "A campaign's quiet phase is primarily used to secure lead gifts and volunteer leadership commitment before any public announcement, often 50 to 60% of the goal.",
        "Peer-to-peer volunteer solicitation, a volunteer asking someone in their own network, drawing on real friendship or trust, is a core volunteer practice, often more effective for major gifts than a staff-only ask.",
        "Campaign committees are expected to identify, cultivate, and solicit peers within their own networks, not handle financial audits or staff-level tasks.",
        "Organizations recruit well-connected community volunteers onto campaign committees specifically because they bring credibility and networks staff alone often can't access.",
        "Board give-or-get can be satisfied either by personal giving or by \"get\", helping secure gifts through one's own network (hosting a small gathering, for example).",
        "Relying on volunteer solicitors without adequate staff support and training risks inconsistent messaging and missed follow-through.",
        "A volunteer host committee's core value is extending invitations and lending personal credibility to draw guests from their own networks, not handling event logistics.",
        "Volunteer involvement spans board members, campaign committees, event host committees, and peer solicitors well beyond the boardroom, it is not limited to board members.",
        "During the quiet phase, a volunteer campaign committee is expected to make its own lead gifts and help cultivate and solicit other lead donors.",
        "Volunteer leadership credibility matters especially in the quiet phase because lead gifts and buy-in secured quietly first are often what makes the later public phase's broader ask credible.",
        "Before asking a volunteer to solicit a peer, best practice is to first equip them with training and a clear briefing, talking points, the ask amount, the case for support.",
        "A young professionals' advisory council builds a long-term pipeline of future donors and leaders, engaging people well before they're ready for major-gift solicitation.",
        "Matching a volunteer's skill and comfort level (writing vs. in-person asking) to an appropriate role keeps them engaged; a mismatch tends to produce poor results or disengagement.",
        "Publicly recognizing volunteer solicitors, not just donors, at a campaign's closing celebration sustains volunteer engagement and goodwill for the next effort.",
        "A volunteer event committee (planning logistics) is functionally distinct from a volunteer solicitation committee (cultivating and asking individual donors), even though both are volunteer-led.",
        "Skills-based volunteering (a retired CPA reviewing financials, for example) channels professional expertise into organizational capacity, distinct from direct solicitation volunteering.",
        "Volunteer follow-through is a known risk, committing to peer visits that never happen, which is why clear expectations, staff support, and accountability structures matter.",
        "An alumni network that identifies and warmly introduces prospective major donors among former classmates is a volunteer-based prospect-identification resource staff alone couldn't replicate.",
        "Written volunteer job descriptions, spelling out time commitment and responsibilities, set clear mutual expectations and reduce overcommitment or confusion.",
        "The most effective volunteer solicitors combine genuine belief in the mission with a real, credible personal relationship to the person they're asking, credibility and connection outperform gift capacity alone."
      ]}
    ],
    ACFRE: [
      {domain:"Application", points:[
        "The Application stage is a documentation and eligibility-verification gate, proving the prerequisite credential and every other criterion, before Portfolio or exam stages begin; it comes first in the four-stage sequence.",
        "If Application isn't approved, the candidate cannot proceed to Portfolio until eligibility is resolved; incomplete or missing documentation is the most common reason an Application is sent back, typically with the chance to correct and resubmit rather than permanent disqualification.",
        "Standard eligibility: an active CFRE (or FAHP/IADF, or 20+ years of experience as an alternate pathway) as prerequisite, roughly 10 years of fundraising experience, a bachelor's degree, current membership in a professional fundraising association, and adherence to AFP's ethics code.",
        "Training-hour requirements: 30 combined contact hours of senior-management and leadership training (15 plus 15) within the last 5 years, plus 10 hours of ethics training within 5 years, all documented at Application.",
        "An alternate eligibility pathway exists for candidates without an active CFRE: a longer documented fundraising-experience requirement substitutes for the credential prerequisite.",
        "Application materials go beyond hour logs to include verification of professional experience (employer confirmation, a detailed resume of fundraising roles), reviewed by ACFRE's designated standards or credentialing committee, not an outside party.",
        "Holding CFRE alone doesn't satisfy ACFRE's eligibility if the roughly decade-long experience threshold isn't yet met, both the credential and the years are generally required together.",
        "Senior-level and leadership-specific documentation is required, rather than any fundraising experience, because ACFRE is positioned to recognize advanced, executive-level practice, not entry- or mid-level roles.",
        "Application verifies baseline eligibility to proceed; Portfolio, the next stage, is where the candidate substantively demonstrates their actual body of work, a meaningfully different function.",
        "Approval at Application authorizes moving forward to build and submit the Portfolio, it grants no part of the credential itself.",
        "Requiring multiple distinct criteria (experience, hours, ethics training, association membership) rather than one simple threshold is meant to confirm a well-rounded profile of advanced experience, ongoing development, and ethical grounding before a candidate invests in the remaining stages."
      ]},
      {domain:"Portfolio", points:[
        "The Portfolio stage documents a career narrative plus real written work samples spanning senior practice areas, not a list of job titles, and not something to start the week of the deadline, since it draws on years of accumulated work product.",
        "AFP Deep Dive and similar continuing-education hours can count toward the senior-management/leadership contact-hour requirement, later documented within the portfolio itself.",
        "Portfolio submissions go through genuine committee review, not automatic approval, to independently confirm the work demonstrates advanced practice; if not approved on first review, candidates are typically given feedback and a chance to revise and resubmit.",
        "Beyond technical fundraising skill, a strong portfolio must demonstrate senior-level leadership judgment and strategic decision-making sustained over a career, this is what reviewers are ultimately assessing.",
        "A single glowing reference letter is not a substitute for actual work samples; references corroborate a candidate's reputation and impact but supplement, rather than replace, the documented work itself.",
        "Portfolio content should span multiple competency areas, reflecting broad, advanced practice, leaning entirely on one narrow specialty, or entirely on work from many years ago, both raise doubts about whether current, well-rounded senior practice is being shown.",
        "A strong portfolio narrative includes reflective analysis, why decisions were made, what was learned, not just a description of what happened; a common weakness reviewers flag is portfolios that read as pure activity logs.",
        "Portfolio results should be tied to the candidate's own specific role and decisions, not just favorable organizational outcomes that could reflect an entire team's work.",
        "Where CFRE's baseline eligibility documentation is largely a checklist, the ACFRE portfolio is a deeper, evidence-based demonstration of senior-level career impact.",
        "Portfolio looks backward at documented, real work; the Written exam stage that follows looks forward, testing applied reasoning on new scenarios, a meaningfully different capability.",
        "Once Portfolio is approved, candidates move next to the Written exam stage."
      ]},
      {domain:"Written exam", points:[
        "The Written exam (third of four stages, after Portfolio and before Oral review) uses a case-study/essay format, not multiple choice, candidates write analytical responses to realistic senior-level scenarios, evaluated against demonstrated strategic and ethical judgment.",
        "This format is a deliberate contrast to CFRE's and GPC's multiple-choice exams: it requires constructing and justifying original reasoning in writing, not recognizing a correct answer among options, since an essay format better tests applied judgment at a senior level than a recall-based bank.",
        "Effective preparation emphasizes practicing applied analysis of realistic scenarios and articulating clear, well-reasoned responses, real senior-level case experience prepares a candidate better than memorizing definitions.",
        "Responses are evaluated by multiple independent reviewers, reducing any one reviewer's individual bias on subjective, written work; a response that identifies the core issue but offers a generic, one-size-fits-all solution is viewed as weaker than one tailored to the scenario's specific constraints.",
        "Strong performance here signals a candidate's ability to reason through new, unfamiliar scenarios in real time, a different capability than Portfolio's backward-looking, already-completed work.",
        "Passing the Written exam does not itself guarantee the credential: candidates who don't pass on the first attempt generally have a defined retake process, and even after passing, Oral review still remains before ACFRE is awarded.",
        "Scenario-based, realistic prompts are used, rather than abstract theory, specifically to simulate the kind of applied, real-world judgment an advanced practitioner actually exercises on the job; because it precedes Oral review, the panel may reference a candidate's written responses during that later live conversation."
      ]},
      {domain:"Oral review", points:[
        "Oral review, the fourth and final ACFRE stage, is a live panel interview (experienced fundraising professionals, often ACFRE holders themselves) examining a candidate on two specialty areas the candidate chooses in advance, ideally matching their actual practice for sharper, more confident answers.",
        "Choosing specialty areas, rather than testing every candidate on identical generalist content, lets the panel assess a candidate's real, practice-based depth rather than generic coverage; a follow-up question slightly outside the chosen area is still expected to be met with thoughtful, broader professional judgment.",
        "The panel poses scenario-based questions and follow-up probes, assessing real-time reasoning and communication, not reading a scripted, one-way list of questions, a structure that reveals depth and adaptability a static written document can't.",
        "Beyond subject knowledge, the panel evaluates composure, clarity, and the ability to communicate reasoning live under direct, sometimes unscripted questioning, a distinct competency from Written exam scoring.",
        "Common preparation includes mock interviews and reviewing one's own prior Portfolio and Written exam responses, since the panel may reference that material during the conversation.",
        "Oral review is scheduled last because by that point the panel has the candidate's full documentation, application, portfolio, written responses, to inform a richer live conversation, making it a decisive final gate that integrates everything already submitted with live judgment.",
        "Strong performance on paper doesn't guarantee a strong Oral review outcome: it's an independent, weighted evaluation, so struggling to articulate real-time reasoning live can still affect the overall result.",
        "If a candidate doesn't pass, there's typically a defined path to retry with feedback on areas to strengthen; successfully completing Oral review is what results in the ACFRE credential finally being awarded."
      ]}
    ],
    GPC: [
      {domain:"Crafting, constructing, and submitting", points:[
        "Crafting, constructing, and submitting carries the most weight of any GPC knowledge area (23%). An RFP (Request for Proposal) is a funder's formal call for proposals; an LOI (Letter of Inquiry or Intent) is the shorter preliminary pitch used before a full proposal is invited, to screen interest and fit.",
        "Missing even one required attachment (a budget narrative, an IRS determination letter, audited financials, letters of support) typically means automatic disqualification, regardless of narrative quality, as does missing a hard deadline, even by hours.",
        "A well-structured narrative follows a predictable order, need statement, goals and objectives, methods, evaluation plan, then budget, so time-pressed reviewers can follow the logic from problem to solution to accountability without hunting for information.",
        "The need statement establishes why the problem matters and why it's urgent, setting up the rest of the case; the case for support (\"why this, why now, why us\") is the backbone argument the whole narrative draws from, the same document that underlies major-gift pitches.",
        "SMART objectives (Specific, Measurable, Achievable, Relevant, Time-bound) give both the funder and the organization a concrete, verifiable way to know whether the program succeeded.",
        "The organizational background (\"boilerplate\") section establishes the applicant's credibility and track record to carry out the proposed work.",
        "The budget narrative must justify requested costs against the described activities, and closely match the program narrative, inconsistency between the two is a credibility red flag suggesting sloppy preparation or an inflated ask.",
        "Formatting compliance matters independent of content quality, many funders reject or deduct points for noncompliance regardless of how strong the writing is; a common, entirely avoidable failure is a technical or file-format submission error on an online portal.",
        "A fresh, unfamiliar reviewer catches gaps in clarity or logic the original writer, too close to the material, might miss; a published scoring rubric should be addressed proportionally, a section weighted 20% deserves thorough treatment, not an afterthought.",
        "Reusing a core proposal narrative across multiple funders is efficient and standard practice, as long as each version is actually tailored to that funder's stated priorities, not a lazy, untailored copy-paste.",
        "An executive summary gives a time-pressed reviewer a concise, accurate overview of the request before they read the full detail."
      ]},
      {domain:"Researching, identifying, and matching", points:[
        "Researching, identifying, and matching is weighted 18%, the second-largest knowledge area. Real matching requires researching a funder's actual giving history and stated priorities, not just surface-level topical overlap.",
        "A foundation's 990-PF filing (public) is the best resource for its actual historical grant sizes and past grantees, a funder averaging $5,000 to $15,000 awards is a poor match for a $150,000 request, no matter how strong the fit otherwise looks.",
        "Funder-research databases (Candid's Foundation Directory Online and similar) identify and screen prospective funders by giving history, focus area, and geography.",
        "Reading a funder's own published guidelines directly, rather than relying on secondhand summaries, reduces the risk of misreading eligibility or priorities, since guidelines can be nuanced or change.",
        "DAF-sourced gifts are a distinct research challenge: the grant letter typically names only the sponsoring fund, not the individual donor, unless the donor discloses.",
        "Corporate giving research goes beyond financial filings to include a company's broader business priorities, community footprint, and any employee-engagement or sponsorship angle tied to its giving.",
        "Reviewing an RFP's eligibility criteria before writing a word screens whether the organization even qualifies, preventing wasted effort; a hard geographic restriction (grants only within a specific state or county) is a disqualifying factor regardless of how strong the program fit is otherwise.",
        "A \"warm\" funder relationship has prior giving history or an existing contact; a \"cold\" prospect has neither, meaningfully changing strategy and likely success. Early, appropriate relationship-building with a program officer, well before a formal application, is legitimate research, not an attempt to bypass the process.",
        "Real \"fit\" goes beyond shared mission area to include practical factors: geographic restrictions, funding-cycle timing, and typical award size relative to the request.",
        "Government funding opportunities (posted on national or state portals) typically involve formal, published solicitations (an RFP or NOFO) with detailed, binding eligibility and compliance requirements, a more structured process than most foundation research.",
        "Reviewing a funder's board of directors for personal or professional connections can surface warm-introduction pathways a cold application alone wouldn't open.",
        "Fit runs both directions: an organization's own strategic plan should also guide which funding opportunities are actually worth pursuing, not just what a funder wants."
      ]},
      {domain:"Program and project design", points:[
        "Program and project design is weighted 17%. A logic model maps a program's inputs (resources: staff, funding, materials) and activities to its outputs (what's directly produced) and, ultimately, its measurable outcomes (the actual resulting change), a strong design section ties measurable outcomes directly to the funder's own stated priorities.",
        "A theory of change differs from a logic model: it articulates the broader narrative rationale for why activities should lead to long-term change, while the logic model maps that rationale into specific inputs, activities, outputs, and outcomes.",
        "Evaluation plans matter because funders want evidence that effectiveness will actually be measured, not just that services will be delivered; formative evaluation (during implementation, for real-time adjustment) differs from summative evaluation (after the program ends, assessing final results).",
        "Grounding a design in a documented needs assessment demonstrates the program responds to an actual, evidenced need, not an assumed one; citing an evidence-based or research-supported practice as the design's foundation reassures reviewers it isn't untested guesswork.",
        "Sustainability planning addresses what happens to the program after grant funding ends, funders want to see this even for a one-year pilot, to understand whether promising results could continue.",
        "Specific numeric targets (\"200 participants will complete the program\") give the evaluation plan something concrete and verifiable to measure against; an activity with no stated connection to a measurable outcome, or a scope wildly mismatched to the budgeted staffing (5,000 participants on a 500-person budget), both read as weak or infeasible design.",
        "A credible staffing plan (who does what, at what level of effort) shows the organization has realistically thought through implementation, not just described activities.",
        "Involving program participants or community stakeholders in shaping the design tends to produce a program better fitted to real needs and more likely to earn genuine buy-in than one designed in isolation.",
        "A plan for replicating or scaling successful elements to other sites speaks to a funder's interest in impact beyond a single, isolated pilot.",
        "A well-designed evaluation plan is built specifically to measure whether the program's own stated outcomes were actually achieved, the two sections should align tightly, not stand apart."
      ]},
      {domain:"Post-award grant management", points:[
        "Post-award grant management covers compliance, reporting, and stewardship after a grant is awarded: tracking restricted-fund spending against the approved budget, and documenting cost-share or in-kind match with the same rigor as cash, including a defensible valuation method for in-kind contributions.",
        "A grant amendment is the formal mechanism for requesting a change to an already-awarded grant's scope, budget, or timeline; spending outside the approved budget without prior funder approval, or reclassifying costs to work around a restriction, is a compliance breach regardless of the underlying need.",
        "Interim reports update the funder on progress and flag needed adjustments before the final report; if an anticipated scope change or an output shortfall arises, the organization should proactively communicate with the funder before or as it happens, not after the fact or in silence.",
        "Late reporting is one of the fastest ways to damage a funder relationship and jeopardize future funding eligibility, funders routinely weigh past compliance and reporting quality when deciding on renewals.",
        "A closeout or final report reconciles actual spending against the approved budget and formally closes the grant's compliance record.",
        "A no-cost extension, requested proactively before the original grant period ends, is the standard mechanism for gaining more time without additional funds.",
        "An organization that regrants a portion of its award to subrecipients remains accountable to the funder and must monitor those subrecipients' compliant use of the funds.",
        "Grant-related financial records (receipts, time sheets for grant-funded staff) should be retained for a defined period after the grant ends, in case of an audit or funder review.",
        "An unannounced or lightly announced funder site visit during the grant period is a normal part of post-award oversight, not cause for alarm, be prepared to show real program activity and basic records.",
        "Narrative or outcomes reporting is distinct from, and equally important as, financial reporting: it demonstrates actual program impact, not just how the money was spent.",
        "Post-award compliance tracking is typically a cross-functional responsibility, shared between the grant professional and finance/accounting staff, not one person alone; managing several simultaneous grants with different deadlines calls for systematic tracking tools, not memory.",
        "Getting the indirect cost rate or method wrong on a grant can surface as a compliance discrepancy at reporting or audit, exactly the kind of detail careful post-award management catches early."
      ]},
      {domain:"Ethical practices standards", points:[
        "Ethical practices standards (weighted 10%, tied with post-award management) govern how grant professionals conduct themselves and represent their organizations across the entire grant lifecycle, research, writing, submission, and post-award, not any single phase.",
        "Conflict-of-interest disclosure is required whenever a grant professional or organizational leader has a personal stake in a funding decision, regardless of size.",
        "Percentage-based compensation tied to award size (for a grant writer, or a colleague's proposal) raises the same conflict-of-interest concern as commission pay in individual fundraising: it can pressure inflated claims or inappropriate funder targeting.",
        "Outcomes must always be reported accurately, never inflated or selectively favorable, if leadership pressures overstating results to secure continued funding, the ethical response is to decline, report accurately, and raise the concern internally.",
        "Using another organization's proposal language without adaptation or permission, whether one's own act or a colleague's discovered afterward, is a professional ethics violation that should be addressed, not ignored because a funder might not notice.",
        "Failing to attribute a colleague's contributed data or work within a proposal is an ethics concern about honest representation, not simply a stylistic choice.",
        "Applying to a funder whose values conflict significantly with the organization's mission, purely because funding is available, raises a genuine mission-alignment ethical concern worth weighing, not just a strategic one.",
        "Confidential information, a competing organization's pending application, or a funder's internal priorities shared informally, should be treated with discretion: declined and redirected if asked to share, and never misused.",
        "Overstating an organization's staff capacity or infrastructure to appear more competitive is a misrepresentation, since funders rely on accurate information to assess risk and fit.",
        "Seeking funding for the exact same expense from two funders without disclosing the other pending request risks duplicate funding (\"double-dipping\"), which funders expect disclosed, not concealed; reclassifying restricted costs to bypass an explicit funder restriction is a direct ethical and compliance violation.",
        "GPCI maintains its own code of ethics to establish field-specific expectations for grant-seeking practice, distinct from though complementary to broader codes like AFP's.",
        "Disclosing an organization's past grant performance to a new funder should be honest, including lessons learned from grants that fell short, not a curated, misleading history.",
        "Discovering that grant funds are being spent in a way that clearly violates funder restrictions calls for raising the concern through appropriate internal (or if necessary external) channels, not silence or quiet correction.",
        "Accepting a significant personal gift or lavish hospitality from a funder's representative during an active relationship risks compromising, or appearing to compromise, independent professional judgment."
      ]},
      {domain:"Organizational development", points:[
        "Organizational development for grant seeking (weighted 9%) is about building an organization's internal readiness, systems, and staff capacity to pursue and manage grants well, not any single application or funder relationship.",
        "Core readiness infrastructure includes audited financials, a documented case for support, a grants calendar (tracking deadlines and cycles across funders), and clear internal systems for tracking deadlines and compliance, together, not any one piece alone.",
        "Grant-management software and a documented process for assigning, tracking, and reviewing reporting deadlines support consistent, reliable grant management as an organizational capacity that outlasts any one person's memory.",
        "The most common capacity gap that undermines an otherwise strong grant program is weak internal systems for tracking post-award compliance and reporting deadlines.",
        "A financial system that tracks restricted grant funds separately, by individual award, is foundational infrastructure supporting accurate compliance and reporting.",
        "Pre-negotiated memoranda of understanding (MOUs) with partner organizations let an organization move quickly on collaborative funding opportunities without scrambling to negotiate terms at the deadline.",
        "Concentrating all grant-seeking knowledge and funder relationships in one long-tenured staff member's head, with nothing documented, creates a real institutional-knowledge and continuity risk if that person leaves.",
        "A current, board-approved strategic plan gives grant seekers a credible framework to show funders how a specific request fits the organization's broader direction.",
        "Relying on one major funder for the large majority of grant revenue creates revenue concentration risk; deliberately diversifying the funder base is part of organizational development.",
        "As a grants portfolio grows from a handful to dozens of active awards, organizational development means proactively reassessing staff capacity and systems, not assuming one person can absorb unlimited growth.",
        "Building broader capacity includes training program and finance staff, not just the dedicated grant professional, since they carry out much of the actual compliance work day to day.",
        "Even organizations that already win grants regularly need ongoing investment in organizational development, since sustained success still depends on systems and capacity that can quietly erode without it.",
        "A mature, organizationally developed approach to grant seeking looks like deliberate strategy guided by readiness infrastructure and fit assessment, the opposite of an ad hoc habit of applying to whatever opportunity appears, or a governance gap where no board policy defines which opportunities need approval before submission."
      ]},
      {domain:"Cultivating funder relationships", points:[
        "Cultivating funder relationships (weighted 7%, the second-smallest knowledge area) treats a site visit as a genuine relationship-cultivation opportunity, not just a compliance formality, funder cultivation differs from individual major-donor cultivation mainly in that it typically runs through program officers and more formal, institutional touchpoints like site visits.",
        "Sustained relationships matter beyond a single grant cycle because renewal or repeat funding often depends on the relationship itself, not results alone; a purely transactional (apply, report, repeat) approach risks missing the trust that supports renewal, flexibility, or larger future funding.",
        "Low-cost, high-value, often underused cultivation practices: an unprompted thank-you note or impact update outside any required report, sharing a relevant success story unprompted between required touchpoints, and responding promptly and substantively to informal questions between formal deadlines.",
        "Inviting a program officer to an informal site visit, or to a public event outside any required visit, builds a more personal relationship and deepens the funder's firsthand understanding of the work.",
        "Sharing an organization's broader strategic updates, not just grant-specific progress, treats the funder as a genuine partner invested in the organization's overall direction, not merely a transactional source of restricted funds.",
        "Understanding a program officer's own internal pressures (needing to justify a recommendation to their own board) helps a grant professional frame communications in useful ways.",
        "A funder relationship cultivated well over several grant cycles often produces greater trust, more candid communication, and sometimes more flexible funding conversations, several consecutive years of unrestricted general operating support, rather than one-off restricted grants, is a strong signal of that kind of trust.",
        "Actively participating in a funder-hosted peer-learning convening deepens the funder relationship while also building valuable peer connections.",
        "Late or poor-quality reporting can damage a funder relationship even when unintentional, since it undermines the trust sustained cultivation depends on; conversely, a gracious, professional response to a declined application, including asking for brief feedback, preserves the relationship for future opportunities rather than treating one no as a permanent end.",
        "Cultivating relationships with appropriate members of a funder's board, beyond program staff, should be handled carefully and typically in coordination with program staff, respecting the funder's own internal protocols.",
        "Renewal conversations that begin informally well before the next formal application cycle, rather than starting cold at the RFP release, are a hallmark of proactive, ongoing cultivation."
      ]},
      {domain:"Professionalism advancement", points:[
        "Professionalism advancement (weighted 6%, the smallest GPC knowledge area) exists because GPCI expects certified professionals to contribute to advancing the profession itself, not just individual proposals, it's uniquely oriented toward the field and the practitioner's own ongoing growth, distinct from the more grant- or funder-specific knowledge areas.",
        "Continuing education keeps a GPC holder current in practice and satisfies the 5-year recertification cycle; simply holding membership in GPCI or a regional association is a starting point, while active participation (committees, mentoring, presenting) represents a deeper level of advancement.",
        "Mentoring newer grant professionals, presenting at a conference on a successful strategy, publishing an article or resource, serving on a GPCI committee or a local association board, and developing a training curriculum to onboard new practitioners are all examples of professionalism advancement.",
        "Volunteering to help write or review items for the GPC exam itself, or participating in a periodic practice-analysis survey that shapes exam content, directly strengthens the credential and the field's shared standards.",
        "Staying current on emerging tools and technology relevant to grant seeking (new funder databases, AI-assisted drafting tools) is part of professionalism advancement, since it reflects ongoing engagement with evolving practice rather than static, one-time expertise.",
        "Occasional pro bono grant-writing support for a small, under-resourced nonprofit outside one's own employer, and advocating for greater recognition of grant professionals as a distinct discipline within the broader nonprofit sector, both reflect the field-benefiting spirit of this domain.",
        "Pursuing a complementary credential (CFRE, for example) alongside GPC is a recognized form of professionalism advancement, deepening overall practice rather than diluting the original credential.",
        "Active participation in the field indirectly supports a grant professional's own career by building visibility, credibility, and a professional network, even though that's not the primary purpose.",
        "Visibly modeling strong ethical practice, not just following it privately, helps set a standard other practitioners can see and aspire to, strengthening the profession's overall reputation."
      ]}
    ],
    CAP: [
      {domain:"CAP 539 - Family Wealth", points:[
        "CAP 539 (Planning for Impact in Context of Family Wealth) is the CAP program's foundation course and standard starting point, it establishes the self, family, community impact framework and shared vocabulary that CAP 549 and CAP 559 both build directly on; completing the other two courses first deviates from the recommended sequence.",
        "Its \"self, family, community\" framework evaluates a gift's or a wealth decision's effect across three levels at once, not any single dimension, blending financial planning, estate planning, and gift planning around the donor's broader wealth picture.",
        "A CAP 539-grounded client conversation goes beyond simple asset totals to explore the client's values, family dynamics, and hopes for how wealth affects future generations and community, addressing common concerns like whether heirs are practically and emotionally prepared to receive significant wealth, and often facilitating multigenerational family meetings around those shared values.",
        "CAP 539's content is least focused on nonprofit internal gift accounting and stewardship (CAP 559's territory instead), it sits closest, in spirit, to financial and estate planning practice reframed around philanthropic impact.",
        "Impact, in CAP 539's framing, is broader than a purely charitable-giving definition: it encompasses how wealth affects the client's own life, family, and community, with charitable giving as just one possible expression.",
        "Because its framework applies broadly to wealth and legacy conversations, CAP 539 is professionally valuable even before a client has raised charitable giving specifically, and even for advisors whose conversations rarely center on philanthropy directly, it's the conceptual entry point the other two courses assume."
      ]},
      {domain:"CAP 549 - Charitable Giving Strategies", points:[
        "CAP 549 (Charitable Giving Strategies) is the course built around charitable tax strategies, tools, and techniques for achieving donor goals.",
        "Qualified Charitable Distributions (QCDs): available starting at age 70&frac12;, with a 2026 per-person limit of $111,000 (indexed annually); a QCD transfers funds directly from IRA custodian to charity, so unlike a withdraw-then-donate approach, it never counts as taxable income at all.",
        "Charitable Remainder Trust (CRT): irrevocable once funded; pays the donor or a named beneficiary income for a term, with the remainder passing to charity, donors often fund a CRT with appreciated stock specifically to avoid the capital-gains hit of selling it outright first.",
        "Charitable Lead Trust (CLT): the mirror of a CRT, the charity receives income first, for a term, then the remainder reverts to the donor's heirs, most often used as an estate-tax planning tool to pass assets to heirs at a steep tax discount.",
        "Charitable Gift Annuity (CGA): a contract exchanging an asset for a fixed income stream for life, with the remainder becoming an outright gift to the nonprofit; those fixed payments are a general obligation of the issuing charity's own assets, not tied to a segregated investment account's performance.",
        "Donor-Advised Fund (DAF): separates the timing of the tax deduction (locked in at contribution) from the timing of the actual charitable distribution (whenever the donor later recommends a grant); compared to a private foundation, a DAF offers simpler administration and generally more favorable deduction limits, in exchange for less direct donor control.",
        "Donating appreciated stock held over a year directly to charity (rather than selling and donating the cash) avoids capital gains tax on the appreciation while still allowing a deduction for the stock's full fair market value.",
        "\"Bunching\" or \"stacking\" contributions concentrates several years of giving into a single tax year specifically to clear the standard-deduction threshold and capture an itemized benefit that spreading gifts evenly might forfeit; cash gifts generally carry a higher AGI percentage deduction limit than gifts of appreciated non-cash assets.",
        "A charity named as life insurance beneficiary can be a relatively low-cost way to make a significant future gift, since the death benefit can exceed premiums paid; a retained life estate lets a donor gift real property now while continuing to live in or use it for life, with full ownership passing to the charity afterward.",
        "Choosing among a CGA, CRT, and CLT depends on the client's specific goals, need for lifetime income, desired eventual benefit to heirs, and how much flexibility versus payment certainty they want.",
        "A testamentary gift, realized only through an estate after death, doesn't generate a lifetime income-tax deduction the way an outright or planned lifetime gift can, since the deduction and gift both occur through the estate.",
        "Each vehicle here, CRT, CLT, CGA, DAF, QCD, appreciated stock, has a matching gift-type execution checklist, identification through documentation, in the <a href=\"https://claude.ai/artifact/VLQWzDuQFHRTbFM9VgTcu2\" target=\"_blank\" rel=\"noopener\">Gift Type Execution Playbook</a>."
      ]},
      {domain:"CAP 559 - Nonprofit Gift Planning", points:[
        "CAP 559 (Gift Planning in a Nonprofit Context) covers how nonprofits and advisors collaborate on structuring, accounting for, and stewarding a planned gift, the course most directly applicable to fundraising and gift-planning practice, useful to a consultant advising a nonprofit client on properly structuring and accepting a donor's proposed CRT remainder gift, for example.",
        "The division of labor: a donor's own attorney or financial advisor typically drafts and structures the legal or financial vehicle itself (trust or will language); the nonprofit's role is accepting, accounting for, and stewarding the resulting gift well.",
        "Deferred or planned gifts require the nonprofit to consider present-value accounting treatment that a simple, immediate cash gift doesn't, and a documented bequest expectancy is tracked in the fundraising pipeline for stewardship and planning purposes, distinct from how it's eventually recognized on audited financial statements once realized.",
        "A \"legacy society\" specifically recognizes donors who've committed a planned or deferred gift, distinct from an annual major-donor group, inviting a living donor to join it stewards that future commitment now, rather than waiting until after the gift is realized.",
        "Best practice stewards a bequest donor while still living just like a current donor, recognition, updates, engagement now, not deferred until the gift is eventually received.",
        "Training frontline fundraisers broadly, not only planned-giving specialists, to recognize when a conversation opens into a planned-giving topic reflects that these opportunities can surface throughout an organization's broader donor relationships; marketing planned-giving options broadly to the full donor base matters because meaningful bequests often come from loyal, long-tenured donors of modest annual giving, not just the largest current donors.",
        "A gift acceptance policy is squarely CAP 559 territory: without one, a nonprofit risks accepting a complex asset or vehicle it isn't equipped to manage, or that conflicts with its mission, a nonprofit's finance or gift-acceptance committee reviewing a proposed complex gift before accepting it reflects the board's fiduciary oversight role.",
        "After a bequest donor passes away, the nonprofit's role includes working with the donor's executor or estate attorney to confirm and receive the gift as the estate is settled, including, when a donor names multiple charities as beneficiaries, working appropriately with the executor on the organization's own specified share.",
        "A planned gift restricted to build a permanent endowment must be invested and managed according to that restriction, typically spending only a defined portion of investment earnings, never the principal.",
        "Building a mature, well-established planned-giving program requires sustained, patient investment over many years, since realized bequest revenue often lags years or decades behind the original marketing and relationship-building effort.",
        "The gift acceptance policy question raised throughout this domain, what to accept and what documentation each asset type requires, is worked through gift-type by gift-type, including real estate, closely-held business interests, and cryptocurrency, in the <a href=\"https://claude.ai/artifact/VLQWzDuQFHRTbFM9VgTcu2\" target=\"_blank\" rel=\"noopener\">Gift Type Execution Playbook</a>."
      ]}
    ]
  };

  var CREDS = [
    {abbr:"CFRE", body:"CFRE International", url:"https://www.cfre.org/certification", detail:"The field's baseline credential. Requires roughly 3 years of paid fundraising experience in the last 7, continuing-ed hours, and a proctored exam; renews every 3 years.", forNote:"Most widely recognized letters in fundraising job postings and RFPs, the one to prioritize first.",
      guide:{
        format:"200 questions (175 scored, 25 unscored pretest items), 4 hours, computer-based, scored 200 to 800 with 500 to pass. Recommended study time runs 40 to 80 hours depending on background.",
        domains:[["Relationship Building","29%"],["Securing the Gift","22%"],["Leadership and Management","18%"],["Current and Prospective Donor Research","15%"],["Ethics, Accountability, and Professionalism","10%"],["Volunteer Involvement","6%"]],
        eligibility:"Points-based across three areas: Education, Professional Practice, and Professional Performance (paid fundraising experience). Recertifies every 3 years with continuing-education points, not a repeat exam.",
        prep:"Relationship Building and Securing the Gift alone are just over half the exam, study those two domains first. CFRE International sells an official Test Content Outline and Candidate Handbook with the exact current breakdown, and several of those specific pages weren't reachable in this research pass, confirm the current domain weights and passing mechanics there before scheduling.",
        srcLabel:"cfre.org",
        srcUrl:"https://www.cfre.org/certification"
      }},
    {abbr:"ACFRE", body:"AFP / CFRE International", url:"https://afpglobal.org/credentials-degrees", detail:"The advanced, senior credential. Requires holding CFRE first, roughly 10 years of experience, a portfolio review, and an oral exam. A small, senior cohort.", forNote:"Worth targeting once CFRE is in hand and the consulting practice has a longer track record to document.",
      guide:{
        format:"Not a written exam to cram for, it's a 4-stage portfolio-and-oral process: Application, Portfolio, Written exam, Oral review. $400 per stage, $1,600 total.",
        domains:[["Application","Eligibility documentation, prerequisite credential"],["Portfolio","Career narrative + work samples across senior practice areas"],["Written exam","Case-study/essay format, not multiple choice"],["Oral review","Panel interview on 2 chosen specialty areas"]],
        eligibility:"10 years of experience (or equivalent), a bachelor's degree, CFRE (or FAHP/IADF, or 20+ years experience) as a prerequisite, 15 hours of senior-management contact hours plus 15 hours of leadership contact hours within the last 5 years, 10 hours of ethics training within 5 years, current membership in a professional fundraising association, and adherence to AFP's ethics code.",
        prep:"Start the portfolio early since it documents years of past work, not something written the week before. AFP Deep Dive CE hours can count toward the contact-hour requirement. Choose 2 oral-review specialty areas that map to actual practice, major/planned gifts and nonprofit strategy consulting are the natural pair here.",
        srcLabel:"afpglobal.org/acfre",
        srcUrl:"https://afpglobal.org/acfre/how-become-acfre"
      }},
    {abbr:"GPC", body:"Grant Professionals Certification Institute", url:"https://grantcredential.org", detail:"Points-based eligibility (experience, education, training) plus an exam; renews every 5 years with continuing ed.", forNote:"Adds specific credibility for grant-readiness engagements without over-indexing on grant-writing as the whole offer.",
      guide:{
        format:"Two parts, both electronic. A writing exam scored on 6 rubrics (persuasive argument 34%, organize ideas 22%, convey ideas clearly 18%, use information provided 12%, standard written English 10%, formatting 4%), plus a 175-question multiple-choice exam (150 scored, 25 unscored pretest).",
        domains:[["Crafting, constructing, and submitting grant applications","23%"],["Researching, identifying, and matching funding resources","18%"],["Strategies for effective program and project design","17%"],["Post-award grant management practices","10%"],["Ethical practices standards","10%"],["Organizational development for grant seeking","9%"],["Cultivating funder relationships","7%"],["Professionalism advancement practices","6%"]],
        eligibility:"Points-based: 120 of a possible 170 points across Education, Professional Experience, Continuing Education, and Community Involvement, with minimum thresholds required in Education and Professional Experience specifically, and points required from at least 3 of the 4 categories.",
        prep:"GPCI calls this a generalist, experienced-practitioner exam, not an entry-level test. Post-award grant management and funder cultivation (17 combined points of weight) are the domains furthest from day-to-day nonprofit strategy consulting, worth an honest look before scheduling. GPCI publishes a Literature Review PDF and points to informal local study groups; they don't endorse any commercial study guide.",
        srcLabel:"grantcredential.org",
        srcUrl:"https://grantcredential.org/the-exam/competencies-tested/"
      }},
    {abbr:"CAP", body:"The American College of Financial Services", url:"https://www.theamericancollege.edu/learn/professional-designations-certifications/cap", detail:"A three-course program, no prerequisite credential, built for advisors and consultants who work planned-giving and wealth-transfer conversations with donors and their families.", forNote:"Directly relevant to the wealth-transfer and bequest research already on file. A differentiator most generalist consultants don't have.",
      guide:{
        format:"Three courses, each ending in its own 2-hour final exam plus quizzes and knowledge checks along the way, no cumulative final. 100% online, self-paced, completable in as few as 6 months.",
        domains:[["CAP 539: Planning for Impact in Context of Family Wealth","Foundation course: financial/estate/gift planning for self, family, and community impact"],["CAP 549: Charitable Giving Strategies","Charitable tax strategies, tools, and techniques"],["CAP 559: Gift Planning in a Nonprofit Context","How nonprofits and advisors structure, account for, and steward a planned gift"]],
        eligibility:"No prerequisite coursework. 3 years of full-time, relevant business experience required before you can use the designation (the courses can be completed before that bar is met). Recertification: annual participation in the College's Professional Recertification Program (PRP) plus its Code of Ethics.",
        prep:"$2,050 per course individually or $4,495 bundled (nonprofit rate: $1,650 / $3,695), worth checking whether Frankly Inspired or a client qualifies for the nonprofit rate. CAP 559 is the most directly applicable of the three to fundraising practice; CAP 549 is the one that builds fluency for a room with a donor's CPA or estate attorney.",
        srcLabel:"theamericancollege.edu/cap",
        srcUrl:"https://www.theamericancollege.edu/learn/professional-designations-certifications/cap"
      }},
    {abbr:"Giving Institute", body:"Firm membership, not a personal credential", url:"https://givinginstitute.org", detail:"Membership is granted to fundraising counsel firms that adhere to its Ethical Principles, not to individuals. The credibility signal here is Frankly Inspired as a firm.", forNote:"Worth a longer-term look once the firm has an established engagement history to point to."}
  ];
  function renderGuideHTML(abbr, g){
    var domainRows = g.domains.map(function(d){
      return '<tr><td>' + esc(d[0]) + '</td><td>' + esc(d[1]) + '</td></tr>';
    }).join("");
    return '<div class="cred-guide">' +
      '<div class="guide-block"><h4>Exam / program format</h4><div class="guide-body">' + esc(g.format) + '</div></div>' +
      '<div class="guide-block"><h4>Domains &amp; weighting</h4><div class="table-wrap"><table><tbody>' + domainRows + '</tbody></table></div></div>' +
      '<div class="guide-block"><h4>Eligibility</h4><div class="guide-body">' + esc(g.eligibility) + '</div></div>' +
      '<div class="guide-block"><h4>How to prepare</h4><div class="guide-body">' + esc(g.prep) + '</div></div>' +
      '<div class="guide-src">Figures shift year to year, confirm current numbers before paying anything. Source: <a href="' + g.srcUrl + '" target="_blank" rel="noopener">' + esc(g.srcLabel) + '</a></div>' +
      '</div>';
  }
  function renderDomainNotesHTML(abbr){
    var domains = DOMAIN_NOTES[abbr] || [];
    var blocks = domains.map(function(d){
      var items = d.points.map(function(p){ return '<li>' + p + '</li>'; }).join("");
      return '<div class="guide-block"><h4>' + esc(d.domain) + '</h4><div class="guide-body"><ul>' + items + '</ul></div></div>';
    }).join("");
    return '<div class="cred-guide cred-notes">' + blocks +
      '<div class="guide-src">Synthesized from the practice-test question bank for this credential, covering every domain tested. Use it alongside official prep materials, not in place of them.</div>' +
      '</div>';
  }
  function renderCreds(){
    document.getElementById("cred-list").innerHTML = CREDS.map(function(c, i){
      var guideHtml = "";
      var toggleHtml = "";
      if(c.guide){
        var gid = "cred-guide-" + i;
        guideHtml = '<div class="cred-guide-row"><div id="' + gid + '" hidden>' + renderGuideHTML(c.abbr, c.guide) + '</div></div>';
        toggleHtml = '<div class="cred-guide-row"><button type="button" class="cred-guide-toggle" data-guide-toggle="' + gid + '" aria-expanded="false"><span class="arrow">&#9656;</span> Study guide</button></div>';
      }
      var notesHtml = "";
      var notesToggleHtml = "";
      if(DOMAIN_NOTES[c.abbr]){
        var nid = "cred-notes-" + i;
        notesHtml = '<div class="cred-guide-row"><div id="' + nid + '" hidden>' + renderDomainNotesHTML(c.abbr) + '</div></div>';
        notesToggleHtml = '<div class="cred-guide-row"><button type="button" class="cred-guide-toggle notes-toggle" data-notes-toggle="' + nid + '" aria-expanded="false"><span class="arrow">&#9656;</span> Domain study notes</button></div>';
      }
      return '<div class="cred-card">' +
        '<div><div class="cred-abbr">' + esc(c.abbr) + '</div><div class="cred-body">' + esc(c.body) + '</div><a class="cred-link" href="' + c.url + '" target="_blank" rel="noopener">visit site →</a></div>' +
        '<div class="cred-detail">' + esc(c.detail) + '<span class="for">' + esc(c.forNote) + '</span></div>' +
        '<div><label class="track-label" data-key="' + esc(c.abbr) + '"><input type="checkbox" data-track="' + esc(c.abbr) + '"> Pursuing</label></div>' +
        toggleHtml + guideHtml + notesToggleHtml + notesHtml +
        '</div>';
    }).join("");
    document.getElementById("stat-creds").textContent = CREDS.length;

    document.querySelectorAll('#cred-list [data-track]').forEach(function(box){
      var abbr = box.getAttribute("data-track");
      var credPursuing = (state.advancementState && state.advancementState.credPursuing) || {};
      if(credPursuing[abbr]) box.checked = true;
      var label = box.closest(".track-label");
      label.classList.toggle("tracked", box.checked);
      box.addEventListener("change", function(){
        label.classList.toggle("tracked", box.checked);
        var patch = {}; patch[abbr] = box.checked;
        apiFetch("/api/advancement-state", { method:"PUT", body:{ credPursuing: patch } }).then(refreshAndRender);
      });
    });

    document.querySelectorAll('#cred-list [data-guide-toggle]').forEach(function(btn){
      btn.addEventListener("click", function(){
        var panel = document.getElementById(btn.getAttribute("data-guide-toggle"));
        var open = panel.hidden;
        panel.hidden = !open;
        btn.setAttribute("aria-expanded", open ? "true" : "false");
      });
    });

    document.querySelectorAll('#cred-list [data-notes-toggle]').forEach(function(btn){
      btn.addEventListener("click", function(){
        var panel = document.getElementById(btn.getAttribute("data-notes-toggle"));
        var open = panel.hidden;
        panel.hidden = !open;
        btn.setAttribute("aria-expanded", open ? "true" : "false");
      });
    });
  }

  // ---------- practice test ----------
  var QUIZZES = {
    DOCTORAL: {label:"Ed Policy Comps", sub:"Modeled on a doctoral comprehensive exam \u00b7 4 domains, 20 questions each", questions:[
      {domain:"Theoretical Frameworks and the Policy Process", q:"Kingdon's Multiple Streams Framework explains policy change as the result of:", options:["A single dominant interest group capturing the regulatory agency","The convergence of a problem stream, a policy stream, and a politics stream at a critical window","A court order forcing legislative action","A strict cost-benefit calculation by elected officials"], correct:1, explain:"Kingdon's framework argues agenda-setting happens when the problem, policy, and politics streams converge in a policy window, not through any single mechanism."},
      {domain:"Theoretical Frameworks and the Policy Process", q:"The Advocacy Coalition Framework, developed by Sabatier and later Sabatier and Weible, explains policy change primarily through:", options:["Coalitions of actors who share core beliefs competing over policy within a subsystem","Random bureaucratic drift with no organizing logic","A single charismatic leader's agenda","Pure electoral turnover"], correct:0, explain:"The ACF models policy subsystems as arenas where belief-based coalitions compete, and it remains, by its own field's admission, a maturing but still-contested framework."},
      {domain:"Theoretical Frameworks and the Policy Process", q:"Baumgartner and Jones's Punctuated Equilibrium Theory describes policy change as:", options:["Constant, smooth, incremental adjustment","Long periods of stability interrupted by rapid, large-scale change","A fixed four-year electoral cycle","A purely judicial process"], correct:1, explain:"Punctuated Equilibrium Theory holds that policy subsystems are usually stable but occasionally undergo rapid, disproportionate change when attention shifts."},
      {domain:"Theoretical Frameworks and the Policy Process", q:"DiMaggio and Powell's institutional isomorphism argues that organizations come to resemble one another mainly because of:", options:["Coercive, mimetic, and normative pressures pursuing legitimacy rather than performance","Random chance in leadership hiring","Direct government ownership of every organization","Identical founding dates"], correct:0, explain:"Isomorphism describes convergence driven by regulatory mandate (coercive), peer-copying under uncertainty (mimetic), and professional-network norms (normative), all in pursuit of legitimacy."},
      {domain:"Theoretical Frameworks and the Policy Process", q:"Meyer and Rowan's concept of \"loosely coupled\" systems, applied to schools and districts, describes:", options:["A gap between an organization's formal structure and its actual day-to-day practice","A tightly centralized command structure with no local discretion","The physical distance between school buildings in a district","A funding formula tied to enrollment"], correct:0, explain:"Meyer and Rowan argue institutions adopt formal structures as \"myth and ceremony\" to secure legitimacy, while day-to-day practice can be decoupled from those formal rules."},
      {domain:"Theoretical Frameworks and the Policy Process", q:"Human capital theory, associated with Becker and Schultz, treats education primarily as:", options:["A signal with no bearing on productivity","An investment that raises individual productivity and future earnings","A pure public good with no private return","A mechanism of social control only"], correct:1, explain:"Human capital theory frames schooling as an investment in productivity-enhancing skills, the standard economic rationale for public and private education spending."},
      {domain:"Theoretical Frameworks and the Policy Process", q:"The signaling or credentialism critique of human capital theory argues that:", options:["Degrees only matter because they signal pre-existing ability to employers, not because schooling itself builds skill","All economic returns to schooling are fabricated","Human capital theory has been fully abandoned by economists","Signaling and human capital theory are identical claims"], correct:0, explain:"The signaling critique holds that credentials may function mainly to sort already-able workers rather than to build the skills employers pay for, putting it in tension with a Ladson-Billings-style structural critique of individually possessed capital."},
      {domain:"Theoretical Frameworks and the Policy Process", q:"Coleman's account of social capital, compared with Bourdieu's, is best described as:", options:["Functionalist, treating social capital as a resource embedded in family and community relationships that supports achievement","Identical to Bourdieu's account in every respect","Focused exclusively on financial capital","A rejection of the idea that relationships matter for outcomes"], correct:0, explain:"Coleman's functionalist framing sits closer in spirit to a causal, individual-outcomes tradition, in contrast with Bourdieu's structural account below."},
      {domain:"Theoretical Frameworks and the Policy Process", q:"Bourdieu's theory of cultural and social capital treats these forms of capital mainly as:", options:["Mechanisms of class reproduction operating through structural advantage","Purely individual attributes unrelated to social structure","Interchangeable with financial capital","Irrelevant to educational outcomes"], correct:0, explain:"Bourdieu's structural account frames capital as a mechanism reproducing class position, sitting closer to Ladson-Billings's structural critique than to Coleman's functionalism."},
      {domain:"Theoretical Frameworks and the Policy Process", q:"The genealogy running from Freire's critical pedagogy to Ladson-Billings's culturally relevant pedagogy continues most directly, in current scholarship, to:", options:["Django Paris and H. Samy Alim's culturally sustaining pedagogy","A return to pure human capital theory","Baumgartner and Jones's Punctuated Equilibrium Theory","Carver's Policy Governance model"], correct:0, explain:"Paris and Alim's culturally sustaining pedagogy is the currently active, publishing edge of this lineage, extending rather than replacing Ladson-Billings's framework."},
      {domain:"Theoretical Frameworks and the Policy Process", q:"DisCrit, developed by scholars including Subini Annamma, David Connor, and Beth Ferri, theorizes the intersection of:", options:["Race and disability labeling in schools","Gender and school funding formulas","Religion and curriculum policy","Geography and teacher licensure"], correct:0, explain:"DisCrit applies the structural-critique logic of critical race theory to how race and disability labeling intersect in special education identification and discipline."},
      {domain:"Theoretical Frameworks and the Policy Process", q:"Kimberlé Crenshaw's concept of intersectionality, as applied to education debates, is best understood as:", options:["A framework for analyzing how multiple, overlapping identities shape experiences of marginalization","A synonym for human capital theory","A specific school funding mechanism","A method exclusive to quantitative causal inference"], correct:0, explain:"Intersectionality extends critical analysis to how race, gender, class, and other identities combine, rather than operating as independent, additive categories."},
      {domain:"Theoretical Frameworks and the Policy Process", q:"Rucker Johnson's research on school finance reform is most closely associated with:", options:["Structural causal analysis of staggered school-finance and desegregation rollouts and their long-run effects","A purely qualitative ethnography of a single school","Institutional isomorphism theory","Policy Governance"], correct:0, explain:"Johnson's work exemplifies causal analysis of staggered policy rollouts, exactly the kind of study the post-2018 difference-in-differences methods overhaul directly bears on."},
      {domain:"Theoretical Frameworks and the Policy Process", q:"QuantCrit is best described as:", options:["An application of critical race theory's core commitments to quantitative research design and interpretation","A rejection of all quantitative methods","A synonym for regression discontinuity design","A funding formula used in school finance"], correct:0, explain:"QuantCrit challenges the assumption that quantitative methods are neutral, applying critical-race-theory commitments to how quantitative education research is designed and read."},
      {domain:"Theoretical Frameworks and the Policy Process", q:"The same-race-teacher-effects research associated with Dee and Penner, and separately Gershenson, primarily investigates:", options:["Whether students perform differently when taught by a teacher of the same race","School district boundary lines","Federal special-education funding formulas","Accreditation standards"], correct:0, explain:"This research examines whether racial match between student and teacher affects academic and behavioral outcomes, a key empirical strand in the middle tradition bridging causal and critical work."},
      {domain:"Theoretical Frameworks and the Policy Process", q:"Sean Reardon's research is most associated with:", options:["Documenting income-based achievement gaps and patterns of school segregation","Board governance theory","Federal accreditation policy","Youth Participatory Action Research"], correct:0, explain:"Reardon's work on income-achievement gaps and segregation is a core empirical pillar of the causal tradition your framework already draws on."},
      {domain:"Theoretical Frameworks and the Policy Process", q:"Raj Chetty's Opportunity Insights research is best known for:", options:["Using large administrative datasets to trace intergenerational economic mobility, including by school and neighborhood","Developing Policy Governance for nonprofit boards","Coining the Advocacy Coalition Framework","Establishing the 1975 IDEA funding target"], correct:0, explain:"Chetty's Opportunity Insights work uses large-scale data to map how mobility varies by place and institution, a distinctly data-intensive extension of the causal tradition."},
      {domain:"Theoretical Frameworks and the Policy Process", q:"Anthony Bryk's improvement science approach to educational change centers on:", options:["Networked Improvement Communities using rapid, iterative Plan-Do-Study-Act cycles to test changes in practice","A single randomized controlled trial run once per decade","Court-ordered desegregation remedies","Institutional isomorphism"], correct:0, explain:"Bryk's improvement science relies on networked, iterative testing across sites rather than a single large-scale causal study, offering a practice-facing bridge in your synthesis."},
      {domain:"Theoretical Frameworks and the Policy Process", q:"Robinson, Lloyd, and Rowe's widely cited 2008 meta-analysis compared:", options:["The effect sizes of different leadership types on student outcomes","State-level per-pupil funding formulas","Nonprofit board governance models","Federal Title IX enforcement mechanisms"], correct:0, explain:"Their meta-analysis remains the most-cited empirical grounding for instructional and transformational leadership research, with no confirmed post-2020 update of the same scale found."},
      {domain:"Theoretical Frameworks and the Policy Process", q:"Distributed leadership and Muhammad Khalifa's Culturally Responsive School Leadership are positioned in current practitioner literature as:", options:["A corrective to the \"myth of the superhero leader\" model of school leadership","A rejection of all leadership theory","A synonym for instructional leadership","A funding mechanism for charter schools"], correct:0, explain:"Both descend from the critical/structural and participatory traditions, offering a parallel domain running the same theoretical axis as the policy-research framework."},
      {domain:"Research Methods and the Causal Toolkit", q:"The core identifying assumption behind a basic difference-in-differences design is:", options:["Parallel trends: treated and untreated groups would have followed similar trajectories absent treatment","Random assignment of every unit to treatment","A discontinuous cutoff score determines treatment","An instrument correlated with treatment but not the outcome"], correct:0, explain:"DiD relies on the parallel-trends assumption; when it's violated, or when timing is staggered, the classic two-way fixed-effects estimate can be badly biased."},
      {domain:"Research Methods and the Causal Toolkit", q:"Andrew Goodman-Bacon's decomposition of difference-in-differences estimators showed that:", options:["Classic two-way fixed-effects DiD with staggered treatment timing can be biased because already-treated units get used as comparison groups","DiD is always unbiased regardless of treatment timing","Regression discontinuity and DiD are mathematically identical","Difference-in-differences cannot be used with panel data"], correct:0, explain:"Goodman-Bacon showed that under staggered adoption, already-treated units can act as \"bad comparisons\" for later-treated units, biasing the classic TWFE estimate."},
      {domain:"Research Methods and the Causal Toolkit", q:"Callaway and Sant'Anna's contribution to the difference-in-differences literature was to:", options:["Develop estimators designed to handle staggered treatment timing without the bias identified in classic two-way fixed effects","Prove that instrumental variables are never valid","Eliminate the need for a comparison group","Replace regression discontinuity design entirely"], correct:0, explain:"Callaway and Sant'Anna's estimators are a direct methodological response to the staggered-timing bias problem, part of the post-2018 DiD overhaul."},
      {domain:"Research Methods and the Causal Toolkit", q:"Why does the post-2018 difference-in-differences methodology overhaul matter directly for research like Rucker Johnson's school-finance work?", options:["Because that research relies on exactly the kind of staggered-rollout design the new methods were built to correct","Because Johnson's work used regression discontinuity, not DiD","Because the overhaul applies only to randomized controlled trials","Because school-finance research never uses panel data"], correct:0, explain:"Johnson's staggered school-finance and desegregation studies are precisely the design type the Goodman-Bacon and Callaway-Sant'Anna literature addresses, meaning older estimates may warrant re-estimation with modern methods."},
      {domain:"Research Methods and the Causal Toolkit", q:"A regression discontinuity design identifies a causal effect by:", options:["Comparing outcomes for units just above and just below an assignment cutoff","Randomly assigning half of all units to treatment","Using a proxy variable correlated with an unobserved confounder","Tracking the same units before and after a policy with no comparison group"], correct:0, explain:"RD exploits a sharp cutoff (an eligibility threshold, a test-score cutoff) to approximate random assignment near that boundary."},
      {domain:"Research Methods and the Causal Toolkit", q:"For an instrumental variable to produce a valid causal estimate, it generally must satisfy:", options:["Relevance (correlated with the treatment) and the exclusion restriction (affects the outcome only through treatment)","Random assignment at the individual level","A discontinuous cutoff score","Parallel pre-trends between groups"], correct:0, explain:"IV estimation depends on relevance and the exclusion restriction; without both, the instrument does not isolate a valid causal effect."},
      {domain:"Research Methods and the Causal Toolkit", q:"Relative to difference-in-differences, current methodological literature treats regression discontinuity and instrumental variables as:", options:["Comparatively stable, without the same recent overhaul DiD has undergone","Equally contested and in need of the same overhaul","Obsolete and no longer used in causal education research","Interchangeable with qualitative case study methods"], correct:0, explain:"No source treated RD or IV as currently contested the way DiD is; DiD is the area a doctoral student most needs to update on."},
      {domain:"Research Methods and the Causal Toolkit", q:"Youth Participatory Action Research (YPAR) is increasingly framed in current literature as:", options:["A direct-to-policy method in its own right, not merely a qualitative community-engagement technique","A purely statistical estimator","A synonym for regression discontinuity design","An outdated approach with no current application"], correct:0, explain:"Recent framing positions YPAR and community-based participatory research as methods with direct policy application, a third methodological pole alongside causal and critical traditions."},
      {domain:"Research Methods and the Causal Toolkit", q:"Community-based participatory research is best characterized by:", options:["Collaborative inquiry that involves the community being studied as active partners in the research process","Strict researcher control with no community input","Exclusive reliance on administrative datasets","A requirement that all findings remain confidential from participants"], correct:0, explain:"CBPR treats community members as co-investigators rather than subjects, a design commitment tied to its policy-facing repositioning."},
      {domain:"Research Methods and the Causal Toolkit", q:"The community-schools evidence base, per this research's own read, currently relies mainly on:", options:["Comparative and correlational designs rather than gold-standard causal evidence","Randomized controlled trials at every site","Regression discontinuity designs exclusively","No empirical evidence at all"], correct:0, explain:"The report explicitly flags that the community-schools literature is comparative and correlational, not yet gold-standard causal, even as more rigorous causal work is underway."},
      {domain:"Research Methods and the Causal Toolkit", q:"Preregistering a survey experiment, as in David Quinn's 2024 study on opportunity-gap versus achievement-gap framing, primarily serves to:", options:["Reduce researcher degrees of freedom and guard against selectively reporting favorable results","Guarantee a statistically significant finding","Eliminate the need for a control condition","Replace the need for any theoretical framework"], correct:0, explain:"Preregistration commits researchers to their hypotheses and analysis plan in advance, a safeguard against post hoc reinterpretation of results."},
      {domain:"Research Methods and the Causal Toolkit", q:"A violation of the parallel-trends assumption in a difference-in-differences design would most directly threaten:", options:["The claim that the estimated effect reflects treatment rather than pre-existing divergent trajectories","The external validity of a randomized controlled trial","The internal validity of a regression discontinuity design","The sample size of the study"], correct:0, explain:"If treated and untreated groups were already diverging before treatment, the post-treatment gap cannot be cleanly attributed to the treatment itself."},
      {domain:"Research Methods and the Causal Toolkit", q:"In a staggered-adoption difference-in-differences setting, using an already-treated unit as a comparison for a later-treated unit is problematic because:", options:["The already-treated unit's own treatment effect contaminates the comparison, biasing the estimate","It always produces a larger, more accurate sample","It eliminates the need for parallel trends","It is the standard, unbiased approach recommended for all DiD designs"], correct:0, explain:"This is exactly the \"bad comparison\" problem Goodman-Bacon's decomposition identified as a source of bias in classic staggered DiD."},
      {domain:"Research Methods and the Causal Toolkit", q:"Two-way fixed-effects regression in a panel dataset is designed to control for:", options:["Time-invariant unit characteristics and common time shocks, via unit and time fixed effects","Only measurement error in the outcome variable","Selection into the sample based on the outcome","Heteroskedasticity exclusively"], correct:0, explain:"Unit and time fixed effects absorb unit-specific and period-specific factors, though this alone doesn't resolve staggered-timing bias."},
      {domain:"Research Methods and the Causal Toolkit", q:"Bryk's Plan-Do-Study-Act cycles, central to improvement science, differ from a single large-scale randomized controlled trial mainly in that they:", options:["Iterate rapidly across multiple small tests of change rather than running one definitive large-scale test","Require a nationally representative sample before any testing begins","Prohibit qualitative data collection entirely","Can only be used after a policy has already been fully scaled"], correct:0, explain:"PDSA cycles are built for rapid, iterative learning within Networked Improvement Communities, a different logic than a single confirmatory RCT."},
      {domain:"Research Methods and the Causal Toolkit", q:"A Networked Improvement Community, in Bryk's framework, is best described as:", options:["A cross-site collaborative structure organized around a shared problem of practice and rapid testing","A single school's internal leadership team","A national accreditation body","A funding mechanism for charter schools"], correct:0, explain:"NICs connect multiple sites around a common problem, using structured, iterative learning rather than a single top-down mandate."},
      {domain:"Research Methods and the Causal Toolkit", q:"Reporting the Tennessee Voluntary Pre-K findings alongside classroom-quality observation data (85 percent of classrooms scoring below \"good\") is an example of:", options:["A mixed-methods approach combining quantitative outcome data with qualitative or observational quality measures","A pure randomized controlled trial with no observational component","An instrumental-variables design","A regression discontinuity design"], correct:0, explain:"Pairing quantitative achievement tracking with quality observation data lets researchers attribute a negative finding to implementation quality rather than the concept of pre-K itself."},
      {domain:"Research Methods and the Causal Toolkit", q:"Researchers report voucher effects in standard deviations (for example, negative 0.4 SD) primarily because standardized effect sizes:", options:["Allow comparison across different tests, scales, and studies on a common metric","Are required by federal law for any education study","Eliminate the need to report a comparison group","Always indicate a policy failure regardless of context"], correct:0, explain:"Standardizing effect sizes lets researchers compare a voucher program's impact against, for instance, the estimated academic-trajectory impact of COVID-19 disruption on the same scale."},
      {domain:"Research Methods and the Causal Toolkit", q:"A doctoral comprehensive exam is more likely to test a candidate's grasp of difference-in-differences by asking them to:", options:["Identify the limitations of the classic two-way fixed-effects approach under staggered treatment timing","Recite the exact command syntax for a statistical software package","List every DiD study published before 2010","Define regression discontinuity instead"], correct:0, explain:"Given the well-documented 2018-2021 overhaul, comps questions are more likely to probe known limitations of the classic method than pure historical recall."},
      {domain:"Research Methods and the Causal Toolkit", q:"Reporting a school-choice study's academic effect in standard deviation units rather than raw test-score points allows a researcher to:", options:["Compare the magnitude of that effect directly against other studies, such as the estimated academic impact of COVID-19 disruption","Avoid disclosing whether the effect was positive or negative","Skip the need for a comparison group entirely","Guarantee the finding will replicate in every state"], correct:0, explain:"Standardized effect sizes are what let Brookings describe Louisiana's voucher findings as comparable in scale to roughly a quarter of the estimated COVID-19 academic-trajectory hit."},
      {domain:"Doctoral Program Structure and the Nonprofit-Leadership Minor", q:"Compared with a PhD, an EdD program typically requires:", options:["Fewer research-methods credits (for example, 9 at the University of Vermont, against 18 for the PhD)","Identical research-methods credit totals","More research-methods credits than the PhD","No research-methods coursework at all"], correct:0, explain:"At UVM, the EdD requires 9 research-methods credits against 18 for the PhD, a pattern that generalizes across programs even where exact totals vary."},
      {domain:"Doctoral Program Structure and the Nonprofit-Leadership Minor", q:"A typical PhD comprehensive exam, compared with a typical EdD comps, is:", options:["Individualized, designed with the student's committee, and often tied to a publishable paper","Always a single multiple-choice test","Never required for either degree","Identical in format to the EdD's standardized exam"], correct:0, explain:"PhD comps are commonly individualized and committee-designed, sometimes producing a draft publication, while EdD comps are more often standardized or take-home."},
      {domain:"Doctoral Program Structure and the Nonprofit-Leadership Minor", q:"A PhD dissertation, relative to a typical EdD dissertation, is more likely to take the form of:", options:["One to three journal-article manuscripts, or a traditional monograph","A single infographic with no written analysis","A standardized multiple-choice exam","A one-page policy brief only"], correct:0, explain:"PhD dissertations commonly follow a multi-article or monograph format, while EdD programs more often require an applied \"dissertation in practice.\""},
      {domain:"Doctoral Program Structure and the Nonprofit-Leadership Minor", q:"EdD programs, compared with PhD programs, tend to frame their graduates' career destinations as:", options:["Administration, government, and nonprofit leadership roles","Exclusively tenure-track faculty positions","Elected political office only","Careers entirely outside education"], correct:0, explain:"UVM explicitly frames its EdD graduates as professional leaders for administration, government, and the nonprofit sector, and its PhD graduates as researchers and faculty."},
      {domain:"Doctoral Program Structure and the Nonprofit-Leadership Minor", q:"The University of Iowa's fully online EdD in Educational Policy and Leadership Studies uses a \"scholar-practitioner model\" in which:", options:["The dissertation-proposal course itself substitutes for a separate comprehensive exam","Students take no coursework before the dissertation","A national standardized test replaces all coursework","Comps are administered by an outside testing company"], correct:0, explain:"Iowa's model folds the comps requirement into the dissertation-proposal course, culminating in a \"dissertation in practice\" tied to a real problem in the student's own work setting."},
      {domain:"Doctoral Program Structure and the Nonprofit-Leadership Minor", q:"Vanderbilt Peabody's EdD (K-12 concentration) replaces a traditional comprehensive exam with:", options:["A capstone involving original empirical research for a client organization","No exit requirement at all","A single national licensure exam","An oral defense with no written component"], correct:0, explain:"Vanderbilt Peabody's capstone model ties the exit requirement to applied, client-based research rather than a standalone comps."},
      {domain:"Doctoral Program Structure and the Nonprofit-Leadership Minor", q:"At the University of Rochester's Warner School, the PhD methods sequence requires:", options:["A first-year research-design prerequisite (ED 506) before both qualitative and quantitative methods courses","No methods coursework until the final dissertation year","Students to choose only one of qualitative or quantitative methods, never both","An external certification exam before enrollment"], correct:0, explain:"Rochester's sequence gates ED 507 (Qualitative Methods) and ED 504 (Quantitative Methods) behind the first-year ED 506 prerequisite, with ED 504 itself gated behind an SPSS-competency course."},
      {domain:"Doctoral Program Structure and the Nonprofit-Leadership Minor", q:"Rochester's published EdD comprehensive exam guidelines specify that:", options:["Two qualifying questions are each answered in 12 to 15 pages over a ten-day window, graded Pass, Revise-and-Resubmit, or Fail","Students have unlimited time to complete the exam","A passing score requires only a single multiple-choice test","The exam is optional for students already holding a master's degree"], correct:0, explain:"Rochester's comps format is unusually concrete: two questions, 12-15 pages each, a ten-day window, three possible grades, and two fails on either question triggers withdrawal from the program."},
      {domain:"Doctoral Program Structure and the Nonprofit-Leadership Minor", q:"Across the doctoral programs synthesized in this research, Year 1 coursework is most commonly gated behind:", options:["A software-competency requirement, most often named as SPSS, with R and Stata common in practice","A foreign-language exam","A teaching-license renewal","A nonprofit board internship"], correct:0, explain:"A software-competency gate in Year 1 recurs across the programs studied, even though the specific tool named varies."},
      {domain:"Doctoral Program Structure and the Nonprofit-Leadership Minor", q:"Regarding full comprehensive-exam reading lists at flagship programs such as Harvard, Stanford, and Teachers College, this research found that:", options:["They were not found publicly posted for any of the eight flagship programs searched","They are all published in full on each program's public website","Only Harvard publishes its reading list","They no longer exist as a practice at any doctoral program"], correct:0, explain:"Comps reading lists are distributed internally to enrolled students, so any treatment of \"what to know\" is inference from published program structure, a distinction worth naming to a committee."},
      {domain:"Doctoral Program Structure and the Nonprofit-Leadership Minor", q:"Of the eight flagship Ed Policy and Leadership programs searched in this research, how many were found to publish an explicit \"nonprofit leadership minor\" track?", options:["None","All eight","Exactly two","Exactly five"], correct:0, explain:"None of the eight flagship programs searched, including Harvard, Stanford, Teachers College, Vanderbilt Peabody, USC Rossier, UCLA, Michigan State, and UW-Madison, publish an explicit nonprofit-leadership minor."},
      {domain:"Doctoral Program Structure and the Nonprofit-Leadership Minor", q:"Indiana University Bloomington's O'Neill School PhD Minor in Nonprofits and Civil Society requires:", options:["12 advisor-approved credit hours, with at least 3 of 4 courses taken at O'Neill, and a 3.0 GPA in the minor","A separate standalone doctoral degree","No coursework, only a portfolio review","60 credit hours across two schools"], correct:0, explain:"The IU O'Neill model is the one concrete, transferable minor structure found, 12 credits, at least 3 of 4 courses from O'Neill, a 3.0 GPA requirement, and a dedicated O'Neill faculty advisor on the student's exams."},
      {domain:"Doctoral Program Structure and the Nonprofit-Leadership Minor", q:"The three realistic paths this research identifies for building a nonprofit-leadership emphasis where no formal minor exists are:", options:["A joint or dual degree, an individualized cognate built ad hoc with a partner school, or self-directed mastery of the canon plus an outside minor field","Transferring entirely out of the Ed Policy program","Waiting for a flagship program to eventually publish a minor","Completing only undergraduate nonprofit coursework"], correct:0, explain:"These three paths, modeled loosely on the IU arrangement, are how this credential appears to actually get built, since it's arranged ad hoc rather than advertised."},
      {domain:"Doctoral Program Structure and the Nonprofit-Leadership Minor", q:"The Jossey-Bass Handbook of Nonprofit Leadership and Management organizes the nonprofit canon into how many parts?", options:["Five","Two","Ten","Three"], correct:0, explain:"The five parts (context and institutional setting; leading and governing nonprofits; managing operations; developing financial resources; and leading people) function as a de facto comps outline for the field."},
      {domain:"Doctoral Program Structure and the Nonprofit-Leadership Minor", q:"\"Leading and governing nonprofits,\" one part of the Jossey-Bass Handbook's five-part structure, covers:", options:["Board governance, executive leadership, ethics, strategic management, and social entrepreneurship","Only volunteer scheduling software","Federal tax law exclusively","Marketing and advocacy exclusively"], correct:0, explain:"This part addresses governance and leadership specifically, distinct from the operations, financial-resources, and people-management parts of the canon."},
      {domain:"Doctoral Program Structure and the Nonprofit-Leadership Minor", q:"John Carver's Policy Governance model is distinguished by its separation of:", options:["Organizational \"Ends\" from operational \"means,\" with Executive Limitations defining the CEO's discretion","Board members from staff entirely, with no communication permitted","Fundraising from programmatic work","Federal funding from private philanthropy"], correct:0, explain:"Carver called Policy Governance \"the only systematic theory of boards,\" built around the Ends/means distinction and defined Executive Limitations."},
      {domain:"Doctoral Program Structure and the Nonprofit-Leadership Minor", q:"Resource dependence theory, associated with Pfeffer and Salancik, explains nonprofit board-executive dynamics mainly through:", options:["An organization's dependence on external resource providers shaping its behavior and governance","Pure altruism with no strategic behavior","Random variation in board composition","Federal mandate alone"], correct:0, explain:"Resource dependence theory frames organizational behavior, including chasing funder priorities, as a response to dependence on external resource providers."},
      {domain:"Doctoral Program Structure and the Nonprofit-Leadership Minor", q:"Kania and Kramer's collective impact framework specifies how many conditions for a successful cross-sector initiative?", options:["Five: a common agenda, shared measurement, mutually reinforcing activities, continuous communication, and a backbone organization","Two: funding and leadership","Ten, covering every operational detail","One: a single charismatic convener"], correct:0, explain:"Collective impact's five conditions, especially the dedicated backbone organization, make it the dominant framework for cross-sector nonprofit-government-school partnerships."},
      {domain:"Doctoral Program Structure and the Nonprofit-Leadership Minor", q:"The reframe that treats some nonprofit-leadership theory as already embedded in an Ed Policy program's \"Leadership\" strand applies most directly to:", options:["Trans-sectoral organizational theories like institutional isomorphism, resource dependence, distributed leadership, and collective impact","Fund development and grant-writing technique","Nonprofit-specific HR and payroll law","Form 990 preparation"], correct:0, explain:"These theories are used in both educational-leadership and nonprofit-management scholarship because schools and nonprofits are the same species of organization in institutional-theory terms; the operational, practitioner-mechanics half of nonprofit leadership still requires the outside canon."},
      {domain:"Doctoral Program Structure and the Nonprofit-Leadership Minor", q:"Which of the following would still need to be picked up outside a standard Ed Policy and Leadership program's own \"Leadership\" coursework, even under the trans-sectoral reframe above?", options:["Nonprofit board governance mechanics, fund development, and nonprofit HR and financial management","Institutional isomorphism theory","Distributed leadership theory","Collective impact theory"], correct:0, explain:"The shared organizational-theory literature travels across sectors, but the practitioner-mechanics canon, governance specifics, fund development, HR, and nonprofit financial management, does not appear in educational-leadership syllabi under any label."},
      {domain:"Current Policy Landscape", q:"New Hampshire's consolidated ConVal and Rand school-funding cases produced what outcome in July 2025?", options:["A state Supreme Court ruling that the state's education funding is unconstitutionally low","A ruling that the state's funding system is fully adequate","A dismissal for lack of standing","A settlement requiring no further state spending"], correct:0, explain:"The July 2025 ruling found New Hampshire's public-education funding unconstitutionally low, with a lower court affirming insufficiency the following month."},
      {domain:"Current Policy Landscape", q:"As of the most recent reporting in this research, North Carolina's Leandro v. State adequacy litigation is:", options:["Still unresolved, awaiting a ruling from a Republican-majority state Supreme Court after February 2024 oral arguments","Fully resolved in favor of the state","Fully resolved in favor of the plaintiff districts","Withdrawn by the plaintiffs"], correct:0, explain:"As of December 2025, no ruling had issued roughly 22 months after oral arguments, drawing open frustration from advocates."},
      {domain:"Current Policy Landscape", q:"Georgetown's Edunomics Lab found that the expiration of federal ESSER relief funding led districts to cut, on average, roughly:", options:["$1,200 per student in 2024-25, concentrated in wraparound and enrichment staff","$50 per student, with no meaningful program impact","$10,000 per student, eliminating most core instruction","Nothing, since ESSER funds were fully replaced by states"], correct:0, explain:"The ESSER cliff produced real cuts concentrated in counselors, social workers, reading coaches, and enrichment programming rather than core classroom teaching first."},
      {domain:"Current Policy Landscape", q:"Tennessee v. Cardona, decided January 9, 2025, had what effect on federal Title IX enforcement?", options:["It vacated the 2024 Title IX Rule nationwide, and enforcement reverted to the 2020 rule shortly after","It expanded the 2024 Title IX Rule nationwide","It transferred Title IX enforcement entirely to state courts","It had no effect on Title IX enforcement"], correct:0, explain:"The ruling vacated the 2024 rule; a subsequent executive order reverted enforcement to the 2020 rule, effective January 31, 2025, applied retroactively to open investigations."},
      {domain:"Current Policy Landscape", q:"Research on Louisiana's and Indiana's newer, larger-scale school voucher programs found:", options:["Achievement losses as large as negative 0.4 standard deviations in Louisiana and roughly negative 0.15 SD in Indiana","Achievement gains exceeding those of the best public schools in both states","No measurable effect in either state","Effects too small to detect with available data"], correct:0, explain:"These findings mark a genuine break from smaller, means-tested 2000s-2010s voucher research that often found neutral-to-positive effects, described by Brookings as extremely large by education policy standards."},
      {domain:"Current Policy Landscape", q:"The One Big Beautiful Bill Act, signed July 4, 2025, restructured federal student aid by:", options:["Limiting new borrowers to a Repayment Assistance Plan or a Tiered Standard plan, replacing prior repayment options","Eliminating all federal student loans immediately","Making all federal loans forgivable after one year","Removing income-driven repayment entirely with no replacement"], correct:0, explain:"For loans first disbursed on or after July 1, 2026, borrowers may choose only the new income-tiered Repayment Assistance Plan or a Tiered Standard plan."},
      {domain:"Current Policy Landscape", q:"As of the most recent reporting in this research, the SAVE repayment plan is:", options:["Enjoined nationwide, after the Eighth Circuit dismissed the Department's appeal in February 2025","Fully reinstated and available to all new borrowers","Expanded to cover Parent PLUS loans","Renamed but otherwise unchanged"], correct:0, explain:"SAVE remains enjoined nationwide, and interest accrual for SAVE borrowers restarted August 1, 2025, while Havens v. U.S. Department of Education, the last live attempt to revive REPAYE, remained unresolved."},
      {domain:"Current Policy Landscape", q:"The Public Service Loan Forgiveness program was narrowed by a rule, effective July 1, 2026, that:", options:["Lets the Secretary of Education disqualify nonprofit employers found to have a \"substantial illegal purpose\"","Eliminates PSLF entirely for all borrowers","Extends PSLF automatically to all private-sector employers","Reduces the qualifying-payment requirement from 120 to 60 payments"], correct:0, explain:"This rule is now facing multi-state litigation from Maryland, Vermont, and Rhode Island attorneys general."},
      {domain:"Current Policy Landscape", q:"Two years after Students for Fair Admissions v. Harvard, 2025 admissions data show:", options:["Black student enrollment declined at 24 of 29 elite institutions reporting data, with Princeton's 2025 class just 5 percent Black","Black student enrollment increased at nearly every elite institution","No measurable change in enrollment demographics anywhere","Only Ivy League schools were affected, with no impact elsewhere"], correct:0, explain:"Princeton's incoming 2025 class was described as the lowest Black representation since 1968, with declines also at Amherst, Johns Hopkins, Caltech, and Cornell."},
      {domain:"Current Policy Landscape", q:"OBBBA's \"Workforce Pell\" provision extends Pell Grant eligibility to short-term programs under a standard requiring:", options:["70 percent completion and 70 percent job-placement rates","No completion or placement requirement at all","A four-year minimum program length","Enrollment exclusively at public institutions"], correct:0, explain:"The \"70-70\" standard opens eligibility to for-profit and even unaccredited, state-approved programs, creating a parallel state-administered quality-assurance pathway."},
      {domain:"Current Policy Landscape", q:"The administration's draft FY2026 HHS budget, reported in April 2025, proposed to:", options:["Eliminate the Head Start program entirely","Double Head Start's federal funding","Transfer Head Start to the Department of Education without funding changes","Make Head Start a state-optional block grant with increased funding"], correct:0, explain:"Head Start ultimately escaped the cut list in the formal FY2026 proposal, but advocates describe the outcome as vulnerable flat funding rather than secure restoration."},
      {domain:"Current Policy Landscape", q:"NIEER's 2025 Yearbook on state pre-K found that:", options:["Enrollment growth slowed sharply, 20 states lost enrollment year-over-year, and only six states met all 10 quality benchmarks","Every state met all quality benchmarks","Enrollment more than doubled nationally in a single year","State pre-K funding was eliminated in most states"], correct:0, explain:"Nearly 1.8 million children were enrolled nationally, but growth slowed to only about 44,000 new children, with 17 states also cutting inflation-adjusted spending."},
      {domain:"Current Policy Landscape", q:"Vanderbilt's Peabody Research Institute, tracking Tennessee's statewide Voluntary Pre-K program through sixth grade, found that:", options:["VPK attendees performed worse academically than non-attendees, with more discipline issues and higher special-education referral rates","VPK attendees substantially outperformed non-attendees on every measure","The program had no measurable effect of any kind","Quality was uniformly high across all classrooms studied"], correct:0, explain:"The lead researcher attributed the negative finding substantially to program quality, since 85 percent of observed classrooms scored below \"good\" even as the state met most benchmarks on paper."},
      {domain:"Current Policy Landscape", q:"California's AB 1159, passed in 2025, primarily addresses:", options:["Prohibiting the use of student data to train generative-AI systems absent a genuine educational purpose","Banning all AI use in California classrooms outright","Federal preemption of state AI laws","Funding for AI hardware purchases in schools"], correct:0, explain:"AB 1159 modernizes 2014's SOPIPA and adds a limited private right of action, a meaningful enforcement upgrade given SOPIPA's original weak enforcement record."},
      {domain:"Current Policy Landscape", q:"Research on the \"AI divide\" in K-12 education found that:", options:["Suburban, majority-white, low-poverty districts are roughly twice as likely to provide teacher AI training as higher-poverty districts","AI training is distributed equally across all district types","Rural districts lead the nation in teacher AI training","No meaningful gap in AI training access exists"], correct:0, explain:"Only 19 percent of teachers reported their school even had an AI policy in a separate survey, most are teaching themselves, layering onto a pre-existing access gap."},
      {domain:"Current Policy Landscape", q:"Giving USA data for 2025 showed total U.S. charitable giving and education-sector giving both:", options:["Grew, with total giving reaching a record 617.2 billion dollars and education giving up 11.7 percent to 92.01 billion dollars","Declined for the third consecutive year","Remained completely flat year over year","Grew only in the arts and culture subsector"], correct:0, explain:"Education was the fastest-growing major subsector in 2025, driven substantially by mega-gifts including MacKenzie Scott's contributions."},
      {domain:"Current Policy Landscape", q:"The Gates Foundation's 2026 K-12 strategy shift involves:", options:["Narrowing to make math roughly 100 percent of its K-12 instructional budget through 2026, alongside a planned 2045 foundation closure","Doubling funding across all K-12 subject areas equally","Exiting education funding entirely, effective immediately","Merging entirely with the Chan Zuckerberg Initiative"], correct:0, explain:"This is a sharp narrowing from roughly 40 percent math previously, concentrated on Black, Latino, and low-income students, alongside a pivot toward AI-powered tools."},
      {domain:"Current Policy Landscape", q:"MacKenzie Scott's giving to HBCUs, exceeding 1.2 billion dollars over five years, is notable for its funding model, which is:", options:["Unrestricted and trust-based, ceding control to grantees rather than retaining donor-directed control","Highly restricted, tied to specific metrics the foundation monitors continuously","Structured entirely as low-interest loans rather than grants","Contingent on matching funds from federal agencies"], correct:0, explain:"Scott's trust-based approach sits in explicit tension with the strategic, metrics-driven philanthropy critiqued in the venture-philanthropy literature, and is framed as directly answering that critique."},
      {domain:"Current Policy Landscape", q:"The Department of Education's 2025 termination of 19 Full-Service Community Schools grants, worth 167.5 million dollars, was part of:", options:["A broader disruption of at least 12 billion dollars in federal education funding and over 760 cancelled grants in the administration's first year","An isolated, one-time cut with no broader pattern","An increase in total community-schools funding elsewhere","A court-ordered funding reallocation"], correct:0, explain:"This collision struck directly at the community-schools and collective-impact model just as the evidence base for it was strengthening, leaving philanthropy structurally unable to backfill funding at the same scale."},
      {domain:"Current Policy Landscape", q:"The Chan Zuckerberg Initiative's 2026 restructuring involved:", options:["Cutting roughly 70 jobs to pivot fully toward AI-powered biomedical research, stepping back from education entirely","Doubling its education-sector staff and grantmaking","Merging with the Walton Family Foundation","Converting entirely to a for-profit venture fund"], correct:0, explain:"CZI's retreat from education, criminal justice, housing, and community development, even while doubling its basic-science investment, is part of the broader 2010s funder coalition splitting apart rather than consolidating."},
  ]},
    CFRE: {label:"CFRE", sub:"CFRE International &middot; 60 questions, 10 per domain", questions:[
      {domain:"Relationship Building", q:"A donor who gave $500 at a reunion is later invited to two private tours and a dinner with the dean, all before anyone asks her for a larger gift. This sequence of touches, before any ask, is best described as which stage of moves management?", options:["Identification","Cultivation","Solicitation","Stewardship"], correct:1, explain:"Cultivation is the relationship-building stage between first contact and the ask, tours, briefings, one-on-one meetings that build genuine trust."},
      {domain:"Relationship Building", q:"Cornell's Moves Management framework runs through five stages in order. Which sequence is correct?", options:["Solicitation, Identification, Cultivation, Qualification, Stewardship","Identification, Qualification, Cultivation, Solicitation, Stewardship","Qualification, Identification, Stewardship, Cultivation, Solicitation","Identification, Cultivation, Qualification, Stewardship, Solicitation"], correct:1, explain:"The correct order is Identification, Qualification, Cultivation, Solicitation, Stewardship, the spine of most major-gift tracking systems."},
      {domain:"Relationship Building", q:"After identifying a prospect, the \"qualification\" stage is mainly about:", options:["Making the first ask","Assessing real philanthropic capacity and interest before investing further cultivation time","Sending the annual impact report","Recruiting the prospect as a board member"], correct:1, explain:"Qualification determines whether a prospect actually has the capacity and inclination to warrant deeper cultivation, before real time is spent."},
      {domain:"Relationship Building", q:"A donor who funded a $50,000 scholarship gets a handwritten note from the recipient, a graduation invitation, and an annual impact report, three touches a year, none of them an ask. This is a textbook example of:", options:["Solicitation","Cultivation","Stewardship","Qualification"], correct:2, explain:"Stewardship is everything after the gift: reporting, recognition, and impact updates that earn the next one."},
      {domain:"Relationship Building", q:"Donor-communications specialists like Tom Ahern argue that appeals and reports should be written primarily from whose point of view?", options:["The organization's own institutional voice","The donor's point of view (\"you-focused\" messaging)","The program staff delivering services","The board chair signing the letter"], correct:1, explain:"\"You-focused\" messaging centers the donor's role in the outcome, not the organization's internal narrative, and has decades of direct-response testing behind it."},
      {domain:"Relationship Building", q:"A donor gives $500 and her employer doubles it to $1,000 through a workplace program. This gift-multiplying mechanism is a:", options:["Matching gift","Qualified Charitable Distribution","Charitable Gift Annuity","Endowment gift"], correct:0, explain:"A matching gift is a gift an employer multiplies, often 1:1. An estimated $4 to 7 billion in matching funds goes unclaimed industry-wide every year because no one asked."},
      {domain:"Relationship Building", q:"A nonprofit receives a grant letter from Fidelity Charitable for $25,000 with no donor name attached. What kind of gift is this most likely?", options:["A Charitable Remainder Trust distribution","A Donor-Advised Fund (DAF) grant","A Qualified Charitable Distribution","A matching gift"], correct:1, explain:"DAF grants come from the sponsor (Fidelity Charitable, Schwab Charitable, a community foundation); the org often has no idea who's behind it unless the donor chooses to disclose."},
      {domain:"Relationship Building", q:"A phone-a-thon targeting only donors who gave last year but not yet this year, instead of the full database, recovers donors at a much higher rate than a general appeal. This targeted list is called:", options:["A SYBUNT list","A LYBUNT list","A gift range chart","A case for support"], correct:1, explain:"LYBUNT (gave Last Year But Unfortunately Not This year) is exactly this near-lapsed segment, the cheapest revenue recovery an org can run."},
      {domain:"Relationship Building", q:"What distinguishes a SYBUNT segment from a LYBUNT segment?", options:["SYBUNT donors have never given at all","SYBUNT looks back further than one giving cycle, not just last year","SYBUNT only includes donors who gave through a DAF","There is no real difference between the two"], correct:1, explain:"SYBUNT (Some Year But Unfortunately Not This year) is the broader, colder segment, looking back multiple years rather than just the most recent one."},
      {domain:"Relationship Building", q:"A gift officer manages a portfolio of 120 donors tracked through moves management. Which of these best signals a prospect is ready to move from cultivation into solicitation?", options:["They've attended a single public event","They've shown clear interest, their capacity has been reasonably confirmed, and a specific ask has been developed","They've been in the database for five or more years with no contact","They unsubscribed from the email newsletter"], correct:1, explain:"Readiness to solicit combines confirmed interest, confirmed capacity, and a concrete, specific ask, not just tenure in the database or a single touchpoint."},
      {domain:"Securing the Gift", q:"At a $2M/year nonprofit, a $10,000 gift might warrant a personal visit as a major gift; at a $200M university, the floor might be $25,000 or $50,000. This illustrates that the major-gift threshold is:", options:["Fixed industry-wide at $10,000","Relative to each organization's own gift table, not a fixed figure","Always exactly 1% of the annual budget","Set by CFRE International"], correct:1, explain:"The major-gift threshold tracks an org's own typical gift size, not a universal industry number, worth defining explicitly with every client."},
      {domain:"Securing the Gift", q:"Ranking gift sizes from smallest to largest typical tier, which order is correct?", options:["Principal gift, major gift, annual gift","Annual gift, major gift, principal gift","Major gift, annual gift, principal gift","Principal gift, annual gift, major gift"], correct:1, explain:"Annual gifts are the broad base, major gifts warrant individualized cultivation, and principal gifts are the transformational tier above major gifts."},
      {domain:"Securing the Gift", q:"Before a capital campaign, an organization writes a document answering \"why this, why now, why us,\" which becomes the backbone of every proposal and campaign pitch that follows. This document is the:", options:["Gift range chart","Case for support","Form 990","Moves management plan"], correct:1, explain:"The case for support is the core argument for why an organization deserves investment; a weak one is usually why an otherwise fine proposal reads generic."},
      {domain:"Securing the Gift", q:"A $15 million building campaign quietly lines up $9 million (60%) from lead donors and the board before ever announcing a public goal. This describes the purpose of a campaign's:", options:["Public phase","Quiet (or silent) phase","Stewardship phase","Feasibility study only"], correct:1, explain:"The quiet phase secures lead gifts and tests whether the goal is realistic before the public phase asks the broader donor base to close the remainder."},
      {domain:"Securing the Gift", q:"For a $1 million campaign goal, a gift range chart calling for 1 gift of $150,000, 2 gifts of $75,000, and 4 gifts of $50,000 before scaling down to 200 gifts of $250 demonstrates that:", options:["Every gift size contributes equally to the goal","The top handful of gifts do most of the work toward the goal","Small gifts should be solicited before large ones","Gift range charts apply only to endowment campaigns"], correct:1, explain:"A gift range chart is a pyramid showing that the top few gifts, here just 7, can cover close to a third of the total goal, the fastest way to show a board why lead gifts matter most."},
      {domain:"Securing the Gift", q:"A $2 million endowment invested to earn 4 to 5% a year generates $80,000 to $100,000 in spendable income annually in perpetuity. What's the defining feature of an endowment?", options:["Only the principal is ever spent","Only the earnings, not the principal, are spent","It must be spent down within 10 years","It cannot be invested in the market"], correct:1, explain:"An endowment is invested so only earnings are spent, making it a permanent, self-renewing revenue source, not a rainy-day fund to draw down."},
      {domain:"Securing the Gift", q:"A $100,000 gift restricted to \"youth STEM programming only\" cannot cover an unexpected rent increase next year, no matter how urgent. Why do boards especially prize unrestricted revenue?", options:["Unrestricted gifts are always larger in size","Unrestricted revenue is the only kind that can flex to wherever the organization's need actually is","Restricted gifts are considered unethical to accept","Unrestricted gifts don't require donor acknowledgment"], correct:1, explain:"Restricted gifts carry donor-specified use; only unrestricted revenue can flex to cover whatever the organization actually needs in the moment."},
      {domain:"Securing the Gift", q:"The Greenfield framework puts a healthy blended cost-to-raise-a-dollar average around:", options:["$0.05","$0.20","$0.50","$1.00"], correct:1, explain:"Roughly $0.20 is the healthy blended average, though it varies hugely by channel, direct-mail acquisition runs far higher, major gifts far lower."},
      {domain:"Securing the Gift", q:"A direct-mail acquisition letter might cost $1.10 to bring in every $1.00 of new-donor revenue, while the same organization's major-gifts program costs $0.07 per dollar raised. What does blending these into one org-wide number risk?", options:["Nothing, blended numbers are always more accurate","Hiding which specific program is actually performing well, since acquisition is often a deliberate loss-leader","Making the major-gifts program look worse than it is","Overstating the direct-mail program's efficiency"], correct:1, explain:"Direct-mail acquisition is often a deliberate loss-leader meant to build the donor file; blending it with major gifts into one ratio obscures which program is actually working."},
      {domain:"Securing the Gift", q:"Which of these typically precedes a successful major-gift close?", options:["A cold direct-mail letter with no prior contact","A personal visit and a specific ask amount tied to a defined project or need","An anonymous online donation form only","A press release announcing the campaign"], correct:1, explain:"Major-gift solicitation is almost always a personal ask, tied to a concrete project, following cultivation, not an impersonal or generic appeal."},
      {domain:"Leadership and Management", q:"A board adopts a policy that every member either gives a meaningful personal gift or helps secure one from their own network. A member who can't afford $2,500 instead hosts a small gathering that nets $3,000. This whole norm is known as:", options:["Case for support","Board give-or-get","Gift range chart","Matching gift"], correct:1, explain:"Board give-or-get is exactly this expectation, satisfied either by personal giving or by leveraging one's own network, a common governance gap when left unstated."},
      {domain:"Leadership and Management", q:"Within a development shop, moves management is used organizationally mainly to:", options:["Set the annual audit schedule","Give a team a shared way to track every prospect's progress through the pipeline, not just one gift officer's memory","Replace the case for support","Calculate cost to raise a dollar"], correct:1, explain:"As an organizational tool, moves management gives a whole team, not just one gift officer, a consistent way to see where every prospect actually stands."},
      {domain:"Leadership and Management", q:"Coaches like Mallory Erickson argue the fundraising field's retention and burnout problem is best understood as:", options:["An individual-resilience issue fundraisers should solve on their own","A leadership-and-culture issue within organizations, not a personal failing","Purely a compensation problem with no other cause","Not a real issue in the field"], correct:1, explain:"Erickson's framing treats burnout as rooted in organizational leadership and power dynamics, not something an individual fundraiser should just push through."},
      {domain:"Leadership and Management", q:"Leadership-development programming built specifically for nonprofit professionals of color navigating predominantly white institutions, like Kishshana Palmer's work, primarily exists to:", options:["Replace general leadership training entirely","Address leadership and career challenges unique to navigating those specific institutional dynamics","Focus solely on fundraising technique","Certify board members"], correct:1, explain:"This kind of programming targets the specific leadership and career navigation challenges of being a professional of color inside majority-white nonprofit institutions."},
      {domain:"Leadership and Management", q:"A development plan built for a fiscal year typically organizes around which combination?", options:["Goals, a gift range chart, and a timeline tied to those goals","Only a list of donor names with no goals attached","The organization's tax filing deadline alone","A single fundraising event's logistics"], correct:0, explain:"A development plan ties concrete revenue goals to a gift range chart and a working timeline, the management backbone for the year's fundraising."},
      {domain:"Leadership and Management", q:"During a capital campaign's quiet phase, volunteer leadership's role is mainly to:", options:["Stay uninvolved until the public phase begins","Help secure lead gifts and lend credibility to the ask, often before staff make a single public appeal","Manage the organization's Form 990 filing","Design the campaign's marketing materials"], correct:1, explain:"Volunteer and board leadership credibility is often what secures lead gifts in the quiet phase, staff alone rarely carry that weight."},
      {domain:"Leadership and Management", q:"An organization that relies on a single funder for 70% of its budget is often flagged by fundraising leadership as a:", options:["A sign of exceptional donor loyalty with no downside","A concentration risk worth actively diversifying against","Irrelevant to overall financial health","A guarantee of multi-year stability"], correct:1, explain:"Heavy reliance on one funder is a leadership and financial-health risk; diversifying revenue sources is a standard management response."},
      {domain:"Leadership and Management", q:"A university's principal-gifts team manages fewer than 50 prospects, each capable of $5 million or more. This narrow, senior portfolio structure illustrates what kind of leadership decision?", options:["A staffing mistake that should be corrected immediately","A deliberate organizational design choice reflecting the size and complexity of principal-level relationships","An entry-level assignment given to new staff","A temporary arrangement with no strategic rationale"], correct:1, explain:"Keeping principal-gifts portfolios small and senior is a deliberate management choice, reflecting how complex and time-intensive those relationships are."},
      {domain:"Leadership and Management", q:"Firms like Veritus Group build mid-level and major-gift program infrastructure focused mainly on:", options:["Direct-mail acquisition costs","Making cultivation and relationship management repeatable across a team, not ad hoc","Board recruitment","Grant compliance reporting"], correct:1, explain:"Veritus Group's frameworks build the relationship-management systems that make cultivation consistent and scalable, a leadership and management concern, rather than dependent on one gift officer's instincts."},
      {domain:"Leadership and Management", q:"The community-centric fundraising movement, associated with writer Vu Le, calls on fundraising leadership to shift organizational priorities toward:", options:["Maximizing institutional survival above all else","Community accountability and equity as explicit leadership priorities, not just institutional growth","Eliminating donor stewardship entirely","Replacing major gifts with only small-dollar giving"], correct:1, explain:"Community-centric fundraising is as much a leadership and organizational-priorities question as a fundraising-tactics one, reframing what a development shop optimizes for."},
      {domain:"Current and Prospective Donor Research", q:"Anyone, a funder, journalist, or job candidate, can pull an organization's last three years of tax filings free on ProPublica's Nonprofit Explorer or Candid's GuideStar, and see the CEO's exact salary. What is this public filing called?", options:["A case for support","A Form 990","A gift range chart","A feasibility study"], correct:1, explain:"Form 990 is the annual public tax filing every U.S. nonprofit above a revenue threshold must file, the primary public window into its finances and governance."},
      {domain:"Current and Prospective Donor Research", q:"What's the key distinction between wealth screening and motivation-based prospect research?", options:["They are identical practices with different names","Wealth screening measures capacity to give; motivation-based research looks at whether and why a prospect would actually give","Motivation-based research is illegal to conduct","Wealth screening is only used for corporate donors"], correct:1, explain:"Capacity alone doesn't predict a gift; motivation-based research bridges the wealth data with the donor's actual interests and relationship to the cause."},
      {domain:"Current and Prospective Donor Research", q:"Why do Donor-Advised Funds (DAFs) pose a particular research challenge for nonprofit prospect researchers?", options:["DAF gifts are always smaller than direct gifts","The organization typically has no idea who's behind a DAF grant unless the donor chooses to disclose themselves","DAF sponsors never report gift amounts","DAF grants can only go to religious organizations"], correct:1, explain:"A DAF grant letter comes from the sponsor (like Fidelity Charitable), not the donor by name, making DAF donors effectively invisible to research unless they self-identify."},
      {domain:"Current and Prospective Donor Research", q:"That same food bank's SYBUNT list includes a donor who gave $1,000 in 2021 and nothing since. Compared to a LYBUNT donor who gave eleven months ago, this SYBUNT donor represents:", options:["An easier, warmer re-engagement conversation","A colder conversation, since more time has passed since any gift","The exact same outreach approach and messaging","A donor who should be removed from the database entirely"], correct:1, explain:"The longer the lapse, the colder the conversation, a SYBUNT donor from years back needs a different approach than an eleven-month LYBUNT donor."},
      {domain:"Current and Prospective Donor Research", q:"Giving USA 2026 reported bequest giving grew 19.7% in one year, the third year in four with 20%+ growth. Why is this figure especially relevant to prospect research on aging donor files?", options:["It has no research relevance","It signals planned and legacy giving is a growing, researchable opportunity within a donor base, tied to rising asset values","It only applies to donors under age 40","It means annual giving is declining"], correct:1, explain:"Strong, sustained bequest growth is a direct signal that legacy-giving prospect research and cultivation deserves real attention within an existing donor file."},
      {domain:"Current and Prospective Donor Research", q:"According to Giving USA 2026, total U.S. charitable giving crossed what threshold for the first time in 2025?", options:["$300 billion","$450 billion","$600 billion","$900 billion"], correct:2, explain:"$617.20 billion was given in 2025, up 5.7% in current dollars, the first year over the $600 billion mark."},
      {domain:"Current and Prospective Donor Research", q:"The Fundraising Effectiveness Project put the 2025 national donor retention rate average at:", options:["23.3%","33.3%","43.3%","63.3%"], correct:2, explain:"43.3% is the national average; an org below that figure is losing donors faster than new ones can replace them."},
      {domain:"Current and Prospective Donor Research", q:"Which of these data points would most directly help a gift officer identify a donor worth a legacy-giving conversation?", options:["A single first-time $25 online gift","Long, consistent multi-year giving history plus engagement with legacy-society communications","The donor's zip code alone","A drop in email open rate"], correct:1, explain:"Sustained giving history and engagement with legacy content are far stronger research signals for a bequest conversation than a single small gift or demographic detail."},
      {domain:"Current and Prospective Donor Research", q:"On its own, a donor's LYBUNT status tells a gift officer:", options:["Everything needed to craft a fully personalized re-engagement ask","Only that the donor gave last year but not yet this year, with no context on why","That the donor has died and should be removed from the file","That the donor should be permanently excluded from future appeals"], correct:1, explain:"LYBUNT flags a pattern, not a reason; real research still has to uncover why the donor hasn't given yet this year before crafting an ask."},
      {domain:"Current and Prospective Donor Research", q:"Which of the following is a research signal that often precedes a meaningful increase in a donor's giving capacity, worth flagging for cultivation?", options:["A liquidity event, such as a business sale or an inheritance","A typo in an online donation form","A decrease in newsletter email open rate","An unsubscribe from a mailing list"], correct:0, explain:"Liquidity events are classic capacity-change signals prospect researchers watch for, unlike engagement metrics like open rates or unsubscribes."},
      {domain:"Ethics, Accountability, and Professionalism", q:"Under AFP's Code of Ethical Standards and most professional fundraising ethics codes, compensation for fundraising counsel and staff should be based primarily on:", options:["A percentage of funds raised","Salary or fixed fees, not commission on gifts raised","A bonus tied to each closed major gift","A finder's fee paid by the donor"], correct:1, explain:"Percentage-based or commission compensation tied to funds raised is considered a conflict of interest under AFP's ethics code; salary or flat fees are the standard."},
      {domain:"Ethics, Accountability, and Professionalism", q:"Public availability of an organization's Form 990 primarily serves which purpose?", options:["Marketing the organization's brand","Public accountability and transparency into finances and governance","Setting the organization's fundraising goals","Replacing the need for a case for support"], correct:1, explain:"Form 990 exists as a public accountability mechanism, letting funders, journalists, and the public see an org's finances and governance."},
      {domain:"Ethics, Accountability, and Professionalism", q:"Which institution publishes the annual Giving USA report that much of the sector's benchmark data comes from?", options:["AFP Global","CFRE International","The Lilly Family School of Philanthropy (Indiana University)","The Giving Institute alone, with no academic partner"], correct:2, explain:"The Lilly Family School of Philanthropy publishes Giving USA every June, the field's most-cited annual giving research, adding a layer of sector-wide accountability to the numbers organizations cite."},
      {domain:"Ethics, Accountability, and Professionalism", q:"Sending a donor an annual impact report and recognition, outside of any solicitation, primarily serves which accountability purpose?", options:["It has no accountability function, it's purely marketing","It demonstrates the organization is accountable to how the donor's restricted or intended gift was actually used","It replaces the need for a Form 990","It's required only for gifts above $1 million"], correct:1, explain:"Stewardship reporting is a core accountability practice, showing donors their gift was used as intended, not just a goodwill gesture."},
      {domain:"Ethics, Accountability, and Professionalism", q:"Can an organization ethically redirect a restricted gift to a different purpose than the donor specified, without the donor's permission?", options:["Yes, if leadership believes it's a better use of funds","No, restricted gifts carry donor-specified use and redirecting them without permission is both an ethics and often a legal issue","Yes, but only for gifts under $10,000","Yes, once the fiscal year ends"], correct:1, explain:"Restricted gifts are legally and ethically bound to donor-specified use; redirecting them without consent breaches both donor intent and often the law."},
      {domain:"Ethics, Accountability, and Professionalism", q:"Why would a nonprofit's leadership review its Form 990 carefully before it's filed each year, as a matter of accountability rather than just compliance?", options:["It's optional and rarely reviewed","It's a public document that reveals executive pay and program-expense ratios to anyone who looks it up","It only affects internal staff, never external audiences","It replaces the annual audit entirely"], correct:1, explain:"Since anyone can pull an org's 990s free on ProPublica or GuideStar, leadership has real accountability reasons to review it closely before filing."},
      {domain:"Ethics, Accountability, and Professionalism", q:"A consulting fundraiser proposes being paid 10% of whatever a campaign raises instead of a flat fee. Under AFP's Code of Ethical Standards, this arrangement is:", options:["Standard, encouraged industry practice","A conflict of interest; compensation should be based on salary or fixed fees, not a percentage of funds raised","Only a problem if the campaign fails","Required for any campaign over $1 million"], correct:1, explain:"Percentage-based or commission compensation tied to funds raised is considered a conflict of interest under AFP's ethics code."},
      {domain:"Ethics, Accountability, and Professionalism", q:"Which of the following best reflects a core principle behind AFP's Donor Bill of Rights?", options:["Donors have no right to know how their gift is used once given","Donors have the right to be informed of how their gift will be used and assured it's used for the stated purpose","Donor anonymity is mandatory by default, regardless of the donor's own wishes","Donors have no standing to ask an organization questions"], correct:1, explain:"The Donor Bill of Rights centers donor transparency and assurance that gifts are used as intended, a core ethics and accountability principle."},
      {domain:"Ethics, Accountability, and Professionalism", q:"A donor asks that her name never be publicly associated with her gift. What is the organization's ethical obligation?", options:["Publicize it anyway, since public recognition helps future fundraising","Honor the donor's request for anonymity","Only honor it if the gift is under $10,000","Let a board member decide case by case, regardless of the donor's request"], correct:1, explain:"Respecting a donor's explicit wishes, including anonymity, is a baseline ethical obligation regardless of gift size."},
      {domain:"Ethics, Accountability, and Professionalism", q:"A gift officer learns a major prospect has a documented history of business practices under public scrutiny. What's the most appropriate first step under standard fundraising ethics guidance?", options:["Accept any gift regardless of its source with no review","Consult the organization's gift acceptance policy and leadership before proceeding","Solicit immediately, before the news cycle worsens","Ignore the concern, since due diligence isn't part of fundraising ethics"], correct:1, explain:"Reputational and source-of-funds concerns are exactly what a gift acceptance policy and leadership consultation exist to work through before soliciting or accepting."},
      {domain:"Volunteer Involvement", q:"A capital campaign's quiet (or silent) phase is primarily used to:", options:["Announce the public goal as early as possible to build momentum","Secure lead gifts and volunteer leadership commitment before a public announcement","Avoid any volunteer involvement until the public phase launches","Finalize the case for support after the public launch"], correct:1, explain:"The quiet phase lines up lead gifts and volunteer leadership, often 50 to 60% of the goal, before the public phase asks the broader base."},
      {domain:"Volunteer Involvement", q:"A capital campaign volunteer committee member personally solicits a peer for a $25,000 gift, drawing on years of friendship. This is an example of:", options:["Staff-led solicitation","Peer-to-peer volunteer solicitation","Direct-mail acquisition","Grant writing"], correct:1, explain:"Peer-to-peer solicitation, a volunteer asking someone in their own network, is a core volunteer-involvement practice, often more effective for major gifts than a staff-only ask."},
      {domain:"Volunteer Involvement", q:"Which of these is a common responsibility of a nonprofit's volunteer solicitation committee during a campaign?", options:["Auditing the annual Form 990","Identifying, cultivating, and asking peers within their own networks","Managing the CRM database's technical infrastructure","Setting executive compensation"], correct:1, explain:"Campaign committees are expected to use their own networks to identify, cultivate, and solicit peer prospects, not handle financial audits or compensation."},
      {domain:"Volunteer Involvement", q:"Why might an organization specifically recruit a well-connected community volunteer onto a campaign committee, rather than relying only on staff?", options:["Volunteers cost less to train than staff","Volunteers bring credibility and networks staff alone often can't access","Volunteers are legally required for 501(c)(3) status","Staff are prohibited from soliciting gifts"], correct:1, explain:"A volunteer's own credibility and network can open doors staff alone can't, a core reason campaigns build volunteer leadership structures."},
      {domain:"Volunteer Involvement", q:"A board member declines to give personally but instead hosts a small gathering that nets $3,000 from six guests. What volunteer-involvement principle does this satisfy?", options:["Board give-or-get, the \"get\" half","Matching gift","Cost to raise a dollar","Stewardship"], correct:0, explain:"Board give-or-get can be satisfied either by personal giving or by helping secure gifts through one's own network, exactly what hosting a gathering does."},
      {domain:"Volunteer Involvement", q:"What's a common risk of relying heavily on volunteer solicitors without adequate staff support and training?", options:["Nothing, volunteers should always work entirely independently","Inconsistent messaging or missed follow-through without a supporting staff structure","Volunteers always outperform trained staff regardless of preparation","It eliminates the need for a case for support"], correct:1, explain:"Volunteer solicitors are most effective when staff equip them with consistent messaging, materials, and follow-through support, not left entirely on their own."},
      {domain:"Volunteer Involvement", q:"A volunteer host committee for a fundraising gala is primarily valuable for which volunteer-involvement function?", options:["Extending invitations and lending personal credibility to draw guests from their own networks","Replacing the need for professional event staff entirely","Filing the event's tax documents","Negotiating vendor contracts"], correct:0, explain:"Host committees leverage volunteers' personal networks and credibility to draw guests, not to handle event logistics or paperwork."},
      {domain:"Volunteer Involvement", q:"True or false: meaningful volunteer involvement in fundraising is generally limited to board members and rarely extends to non-board community volunteers.", options:["True","False"], correct:1, explain:"False, volunteer involvement spans board members, campaign committees, event host committees, and peer solicitors well beyond the boardroom."},
      {domain:"Volunteer Involvement", q:"During a capital campaign's quiet phase, a volunteer campaign committee's typical responsibilities include:", options:["Making their own lead gifts and helping cultivate and solicit peers","Only attending the public campaign launch event","Auditing the organization's financial statements","Writing the organization's grant proposals"], correct:0, explain:"Campaign committees are expected to give personally and help cultivate and solicit other lead donors, core to the quiet phase's success."},
      {domain:"Volunteer Involvement", q:"Why is volunteer leadership credibility often described as especially important during a campaign's quiet phase specifically?", options:["It isn't especially important during the quiet phase","Lead gifts and volunteer buy-in secured quietly first often make the later public phase's broader ask credible and achievable","Volunteers are not permitted to be involved until the public phase","The quiet phase has no fundraising activity at all"], correct:1, explain:"Momentum and credibility built quietly through volunteer-secured lead gifts is often what makes the public phase's broader ask land successfully."}
,
      {domain:"Relationship Building", q:"Donor-centered fundraising research associated with Penelope Burk and the Cygnus studies found that a thank-you phone call placed within 24 to 48 hours of a gift, before any further ask, is linked to:", options:["No measurable change in future giving","A meaningfully higher likelihood the donor gives again","Donors feeling contacted too often and giving less","A benefit seen only for gifts over $10,000"], correct:1, explain:"Burk's donor-centered research found prompt, non-solicitation thank-you contact measurably increases the odds of a repeat gift, a cornerstone finding behind donor-centered stewardship practice."},
      {domain:"Relationship Building", q:"A donor engagement ladder, moving donors from first-time gift through repeat, mid-level, major, and legacy giving, is used in relationship building mainly to:", options:["Rank donors publicly by gift size","Plan differentiated stewardship and cultivation appropriate to where each donor sits, rather than treating every donor identically","Determine which donors receive a tax receipt","Replace the need for a donor database"], correct:1, explain:"The ladder's value is operational: it tells staff what kind of contact and ask is appropriate at each stage, rather than a one-size-fits-all approach."},
      {domain:"Relationship Building", q:"A nonprofit convenes a small standing group of longtime donors twice a year to hear directly what would make them feel more connected, before changing any stewardship tactics. This practice is best described as:", options:["A donor feedback loop or donor advisory council","A required IRS disclosure process","A wealth-screening exercise","A volunteer solicitation committee"], correct:0, explain:"Structured, recurring donor listening, sometimes called a donor advisory council, is a relationship-building practice built on hearing directly from donors rather than assuming what they want."},
      {domain:"Relationship Building", q:"Because acquiring a new donor typically costs substantially more than retaining an existing one, relationship-building effort is generally argued to pay off most by investing in:", options:["Aggressive new-donor acquisition mailings exclusively","Stewardship and retention of current donors","Reducing the number of stewardship touches to cut costs","One-time galas as the primary donor-contact channel"], correct:1, explain:"Because retention is cheaper than acquisition, dollars spent keeping and deepening relationships with existing donors typically outperform dollars spent chasing new ones alone."},
      {domain:"Relationship Building", q:"A giving society that publicly recognizes donors who've given at the $1,000+ level for three consecutive years, with a distinct name and small perks, functions primarily as a:", options:["Bureaucratic naming convention with no fundraising purpose","Relationship-building and stewardship tool that reinforces donor identity and continued giving","Legal requirement for gifts above a certain size","Substitute for individual donor communication"], correct:1, explain:"Recognition societies build identity and belonging around sustained giving, a stewardship tool meant to reinforce, not replace, personal relationship-building."},
      {domain:"Relationship Building", q:"A longtime donor personally invites five friends into a giving circle she helped start and stays involved cultivating them alongside staff. This is an example of:", options:["Peer-to-peer fundraising, using a donor as an ambassador within her own network","Wealth screening","A grant application process","A Form 990 disclosure requirement"], correct:0, explain:"Peer-to-peer fundraising leverages an existing donor's own trust and network, often reaching people staff could never approach directly."},
      {domain:"Relationship Building", q:"Mapping a donor's touchpoints from her very first gift through a decade of stewardship, to identify exactly where communications go quiet, is a relationship-building practice known as:", options:["Donor journey mapping","Wealth screening","Case statement drafting","Board recruitment"], correct:0, explain:"Donor journey mapping traces the full arc of a relationship to find gaps and moments worth strengthening, not just isolated transactions."},
      {domain:"Relationship Building", q:"What most clearly distinguishes genuine donor-centered stewardship from a purely transactional thank-you?", options:["Stewardship reflects the donor's specific interests and shows impact over time, rather than a generic form response after every gift","Stewardship is only required for gifts above $10,000","A transactional thank-you is always sent by mail, stewardship always by phone","There is no meaningful difference between the two"], correct:0, explain:"Transactional acknowledgment fulfills an obligation; stewardship is personalized, ongoing, and tied to what that specific donor cares about."},
      {domain:"Relationship Building", q:"A donor who has given consistently for five years suddenly stops responding to appeals and stewardship contact. Best relationship-building practice calls for:", options:["Removing her from the database immediately","A direct, personal check-in to understand what changed before writing her off as lapsed","Escalating solicitation frequency to win her back","Waiting silently until she reaches out on her own"], correct:1, explain:"A sudden silence after years of consistent giving is a signal worth a direct, low-pressure check-in, not an automatic write-off or a louder ask."},
      {domain:"Relationship Building", q:"Segmenting stewardship communications so a $50 annual donor and a $50,000 major donor receive noticeably different types and frequency of contact reflects which relationship-building principle?", options:["All donors should receive identical communications to be fair","Stewardship should be proportional and appropriate to the relationship, not uniform across every donor","Only major donors deserve any stewardship contact at all","Segmentation is primarily a data-hygiene exercise, not a relationship practice"], correct:1, explain:"Effective stewardship scales the depth and frequency of contact to the relationship, treating a modest annual donor and a principal-gift donor differently, without neglecting either."},
      {domain:"Securing the Gift", q:"When soliciting a major gift, best practice generally calls for the ask to be:", options:["Left vague so the donor can decide the amount entirely on their own","A specific dollar amount, informed by research into the donor's capacity and giving history","Always the largest amount the organization can imagine asking for","Determined only after the gift is already given"], correct:1, explain:"A specific, well-researched ask amount signals preparation and respect for the donor, and produces stronger results than an open-ended request."},
      {domain:"Securing the Gift", q:"A capital campaign typically proceeds through which general phase order?", options:["Public phase, then leadership phase, then quiet phase","Quiet phase, then leadership phase, then public phase","Public phase only, with no earlier private solicitation","Leadership phase, then public phase, then quiet phase"], correct:1, explain:"Campaigns typically build from the quiet phase (lead and leadership gifts) through a leadership phase and only then to the public phase, once a strong base is secured."},
      {domain:"Securing the Gift", q:"A donor pledges $100,000 payable over five years rather than giving the full amount today. From a gift-securing standpoint, this is best understood as:", options:["An unacceptable gift that should be declined","A legitimate multi-year pledge, a standard tool for making larger gifts achievable for the donor","Evidence the donor doesn't actually intend to give","Only valid for planned or deferred gifts, never for outright ones"], correct:1, explain:"Multi-year pledges are a standard, well-understood tool that lets donors commit to a larger total gift than they could give in a single year."},
      {domain:"Securing the Gift", q:"A board member offers to match every new gift dollar-for-dollar up to $50,000 during a year-end appeal. The primary fundraising purpose of this challenge gift is to:", options:["Reduce the total amount the organization needs to raise","Create urgency and a sense of amplified impact that motivates other donors to give or give more","Replace the need for any other solicitation that year","Satisfy a legal requirement for year-end appeals"], correct:1, explain:"Matching or challenge gifts are a solicitation tool meant to create urgency and make a donor's own gift feel amplified, driving response rates up."},
      {domain:"Securing the Gift", q:"A gift officer preparing for a solicitation visit reviews the donor's full giving history, past conversations, and stated interests beforehand. This preparation most directly supports:", options:["Filing requirements for the IRS","Making a specific, well-tailored ask that reflects what the organization already knows about the donor","Avoiding the need to ever thank the donor","Qualifying the donor for wealth screening"], correct:1, explain:"Thorough preparation lets the solicitor tailor both the amount and the framing of the ask to what's already known about that specific donor."},
      {domain:"Securing the Gift", q:"When a prospective major donor says no to an ask, best practice in securing the gift generally treats that response as:", options:["A permanent rejection that ends the relationship","Possibly a 'not now' or 'not at this amount,' worth exploring further rather than automatically closing the door","Grounds to remove the donor from all future contact","Proof the ask amount was too low"], correct:1, explain:"A no in the moment is often about timing, amount, or framing rather than a permanent rejection, and skilled solicitors probe gently rather than walking away entirely."},
      {domain:"Securing the Gift", q:"A donor considering a $250,000 gift is offered the option to give $100,000 outright now and structure the remaining $150,000 as a bequest commitment. This combination is an example of:", options:["An illegal gift structure","A blended gift, pairing an outright and a planned or deferred component to reach a larger total commitment","A gift the organization is required to reject","A gift that counts only toward the outright total, never the full $250,000"], correct:1, explain:"Blended gifts combine an outright component with a planned or deferred component, letting a donor commit to a larger total impact than cash alone might allow."},
      {domain:"Securing the Gift", q:"In a solicitation meeting, using assumptive, confident language about the gift, rather than tentative or apologetic phrasing, is a closing technique meant to:", options:["Pressure the donor into an amount they can't afford","Convey genuine confidence in the case and the ask, which tends to improve close rates without being manipulative when paired with real listening","Avoid the need to specify an amount at all","Replace the need for stewardship afterward"], correct:1, explain:"Confident, assumptive framing, paired with genuine listening rather than pressure, reflects belief in the case and tends to outperform apologetic or hesitant asks."},
      {domain:"Securing the Gift", q:"Recognition naming, such as offering to name a scholarship or a room after a lead donor, functions in a gift solicitation primarily as:", options:["A legal requirement for any gift over $25,000","A meaningful, often decisive incentive tied to the donor's own values and legacy, not merely decoration","Something only universities are permitted to offer","A replacement for stewardship after the gift closes"], correct:1, explain:"Thoughtful recognition, especially naming tied to a donor's values or legacy, can be a genuine and often decisive part of what makes a large gift meaningful to the donor."},
      {domain:"Securing the Gift", q:"A campaign's leadership-gifts phase, following the quiet phase and preceding the public phase, is primarily focused on:", options:["Broad, low-dollar direct mail to the full donor file","Securing gifts from a wider circle of significant donors and volunteer leaders, building on the quiet phase's lead gifts before the public announcement","Publicly announcing the campaign for the first time","Closing out the campaign's final report"], correct:1, explain:"The leadership-gifts phase widens the circle of significant donors and volunteer leadership beyond the initial lead gifts, still ahead of any public announcement."},
      {domain:"Leadership and Management", q:"A development director tracks gift-officer performance using metrics like qualification visits completed, proposals submitted, and dollars closed per quarter. This kind of management practice is best described as:", options:["An invasive, unnecessary layer of oversight","Activity- and outcome-based performance management, standard practice for major-gift teams","A substitute for actually visiting donors","Required only for organizations over $50 million in revenue"], correct:1, explain:"Tracking both activity (visits, proposals) and outcomes (dollars closed) is standard major-gift management practice, giving leadership an early read before results alone would show up."},
      {domain:"Leadership and Management", q:"High turnover among frontline gift officers is widely recognized in the field as a management concern primarily because:", options:["It has no real cost beyond hiring a replacement","Donor relationships are often deeply tied to a specific gift officer, and turnover can disrupt those relationships and campaign momentum","Turnover only affects entry-level annual-fund roles","It automatically triggers a loss of the organization's tax-exempt status"], correct:1, explain:"Because major donor relationships are often personal and relationship-specific, losing a gift officer can disrupt donor trust and momentum, not just create a staffing gap."},
      {domain:"Leadership and Management", q:"A nonprofit's leadership adopts a rule of thumb that fundraising expense should stay within a reasonable range relative to funds raised, monitored as part of financial oversight. This is an example of:", options:["Donor stewardship","Fundraising efficiency and budget management, a leadership responsibility distinct from frontline solicitation","A legal requirement enforced by the IRS on all nonprofits","A concept relevant only to capital campaigns"], correct:1, explain:"Monitoring fundraising cost ratios is a budget-management and oversight responsibility of fundraising leadership, separate from the act of soliciting gifts itself."},
      {domain:"Leadership and Management", q:"Before rolling out a new donor database or CRM system, effective fundraising leadership typically prioritizes:", options:["Switching systems immediately with no staff input, to save time","Change management, including staff training and a data-migration plan, since poor adoption can undermine the whole system's value","Only the sales price of the software","Nothing in particular, since any CRM functions the same way"], correct:1, explain:"A new CRM is only as useful as its adoption; leadership that skips training and migration planning often ends up with a system nobody actually uses well."},
      {domain:"Leadership and Management", q:"A board's annual fundraising orientation, walking new members through the case for support and their expected role in cultivation and solicitation, is primarily a function of:", options:["Volunteer involvement alone, with no leadership role","Leadership and management, equipping volunteer leadership to fundraise effectively","A legal requirement for 501(c)(3) status","Donor research"], correct:1, explain:"Preparing and orienting board members to fundraise effectively is a leadership and management function, even though the resulting activity is volunteer-led."},
      {domain:"Leadership and Management", q:"An organization relying on a single major revenue stream, for example one large annual gala, faces which leadership-level risk?", options:["No particular risk, concentration is generally considered a strength","Revenue concentration risk; leadership is generally advised to diversify revenue streams to protect against a single point of failure","A requirement to register as a private foundation","Automatic loss of nonprofit status"], correct:1, explain:"Revenue concentration in one source or event creates real organizational risk; diversifying streams is a standard leadership-level risk-management practice."},
      {domain:"Leadership and Management", q:"A development department's annual plan sets specific dollar goals by revenue stream, a timeline of major activities, and staff assignments. This kind of document is primarily a tool for:", options:["Donor stewardship communications","Organizational management, translating strategy into an operational plan leadership can track against","Board recruitment exclusively","Grant compliance reporting"], correct:1, explain:"An annual development plan is a management tool: it turns strategy into concrete goals, timelines, and accountability leadership can track."},
      {domain:"Leadership and Management", q:"Succession planning for a long-tenured major-gift officer who manages the organization's most significant donor relationships is important primarily because:", options:["It has no real bearing on fundraising outcomes","An abrupt, unplanned departure risks disrupting deeply personal donor relationships that took years to build","Succession planning is only relevant to the executive director role","Donors are indifferent to which staff member they work with"], correct:1, explain:"Because major-gift relationships are personal and often built over years, an unplanned departure without a transition plan is a real risk leadership should plan for."},
      {domain:"Leadership and Management", q:"A development leader reports pipeline health to the board, for example the number of qualified prospects at each stage, not just dollars raised to date. The main leadership value of reporting pipeline stage, not just totals, is that it:", options:["Makes the report longer for its own sake","Gives the board an early, forward-looking signal about future results, not just a lagging snapshot of dollars already closed","Is required by the IRS on Form 990","Replaces the need for an annual audit"], correct:1, explain:"Pipeline-stage reporting is a leading indicator, letting the board see what's coming rather than only what's already closed."},
      {domain:"Leadership and Management", q:"Delegating solicitation of mid-level donors to trained gift officers, while the executive director focuses personally on the organization's very top prospects, reflects which leadership and management principle?", options:["Executive directors should personally solicit every donor regardless of gift size","Appropriately matching solicitor seniority and time to prospect capacity, a resource-allocation decision leadership makes deliberately","Mid-level donors don't require a personal solicitor","Delegation is only appropriate in organizations with more than 20 staff"], correct:1, explain:"Matching who solicits whom to relative gift capacity and relationship fit is a deliberate resource-allocation choice leadership makes to use everyone's time well."},
      {domain:"Current and Prospective Donor Research", q:"RFM analysis, scoring donors on Recency, Frequency, and Monetary value of past gifts, is a research technique primarily used to:", options:["Determine a donor's legal name for a receipt","Segment and prioritize the existing donor file for cultivation and solicitation based on giving behavior patterns","Verify a donor's tax-exempt status","Calculate a nonprofit's overhead ratio"], correct:1, explain:"RFM scoring turns a donor's own giving history into a practical prioritization tool, flagging who's warm, who's fading, and who gives at what level."},
      {domain:"Current and Prospective Donor Research", q:"Reviewing a prospect's real estate holdings and public securities filings is a research technique most associated with assessing a prospect's:", options:["Philanthropic affinity for the organization's mission","Financial capacity to make a gift","Board eligibility under bylaws","Eligibility for a matching-gift program"], correct:1, explain:"Public records like real estate and securities filings are capacity indicators, evidence of wealth, distinct from affinity, which measures interest and connection to the cause."},
      {domain:"Current and Prospective Donor Research", q:"A prospect has strong documented capacity, substantial assets, but no known connection to the organization's mission or programs. What does prospect-research practice suggest about treating this prospect?", options:["Solicit immediately for the largest possible gift","Capacity alone doesn't justify solicitation; affinity and a genuine connection to the mission still need to be built or confirmed first","Ignore the prospect entirely since capacity without affinity is worthless","Capacity and affinity are the same thing and either alone is sufficient"], correct:1, explain:"Capacity identifies who can give; affinity and cultivation determine whether, and how, they're likely to actually give to this organization specifically."},
      {domain:"Current and Prospective Donor Research", q:"Asking a small group of well-connected volunteers to review a prospect list and rate which names they personally know, and roughly how generous or connected those people are, is a research technique known as:", options:["Peer screening, or a rated request","Wealth screening software","A capital campaign feasibility study","A donor satisfaction survey"], correct:0, explain:"Peer screening, sometimes called a rated request, draws on volunteers' personal knowledge of a community to supplement, or substitute for, formal wealth-screening data."},
      {domain:"Current and Prospective Donor Research", q:"A prospect researcher notes that a donor has previously made significant gifts to other organizations with a similar mission, discovered through those organizations' public annual reports. This finding is most useful as a signal of:", options:["The donor's legal capacity to give","The donor's affinity, demonstrated interest in this cause area, which is a strong complement to capacity data","Evidence the donor cannot give any further gifts","A conflict of interest that should end the relationship"], correct:1, explain:"A documented pattern of giving to similar causes is a strong affinity signal, evidence of genuine interest that pairs well with capacity indicators."},
      {domain:"Current and Prospective Donor Research", q:"Why is data hygiene, keeping donor and prospect records accurate, deduplicated, and current, considered foundational to prospect research?", options:["It has no real bearing on research quality","Research built on outdated or duplicated records risks wasted solicitation effort and damaged donor relationships from basic errors","It's required only for organizations using paper records","Data hygiene is solely an IT department concern, unrelated to fundraising"], correct:1, explain:"Even sophisticated research and modeling is only as good as the underlying data; poor data hygiene produces wasted effort and avoidable donor-relations mistakes."},
      {domain:"Current and Prospective Donor Research", q:"A board member offers to review the organization's prospect list and flag names from their own personal and professional network. This is best understood as:", options:["An inappropriate use of board access","A legitimate and valuable prospect-research source, since board networks often surface capacity and affinity data screening tools miss","A substitute for all other prospect-research methods","Relevant only during a capital campaign feasibility study"], correct:1, explain:"Board and volunteer networks frequently surface real, personal knowledge about a prospect's capacity and connection that no database can capture."},
      {domain:"Current and Prospective Donor Research", q:"Predictive modeling applied to a donor file, using variables like past giving patterns, event attendance, and engagement, is used in prospect research primarily to:", options:["Estimate which current donors are statistically more likely to increase their giving or make a major gift","Automatically generate tax receipts","Replace the need for any human relationship-building","Determine a donor's eligibility for board service"], correct:0, explain:"Predictive models surface a ranked, data-informed shortlist of likely major-gift or upgrade candidates, meant to focus, not replace, relationship-building."},
      {domain:"Current and Prospective Donor Research", q:"An attendee at a fundraising gala who isn't yet a donor but works in a senior role at a major regional employer, discovered through simple online research, would typically be logged by a researcher as:", options:["A disqualified prospect","A new prospect worth further qualification research, based on an early capacity clue","A current major donor","Someone who should be removed from the guest list"], correct:1, explain:"A capacity clue like a senior professional role is a starting signal for further qualification research, not a finished assessment on its own."},
      {domain:"Current and Prospective Donor Research", q:"Why do prospect researchers generally treat a single strong data point, such as one large real estate holding, with some caution rather than as conclusive proof of major-gift capacity?", options:["A single data point can be misleading; researchers typically look for multiple corroborating indicators before concluding real capacity","Real estate records are always inaccurate and should never be used","Capacity research should rely only on self-reported donor income","Single data points are actually the most reliable research method available"], correct:0, explain:"Good prospect research looks for multiple corroborating signals rather than betting a cultivation strategy on one data point that could be outdated or misleading."},
      {domain:"Ethics, Accountability, and Professionalism", q:"Selling or renting a nonprofit's donor mailing list to an unrelated third party without donor consent or an opt-out would most directly violate which ethical principle?", options:["Donor privacy and data-protection expectations embedded in professional fundraising ethics codes","Board term-limit policy","Form 990 filing requirements","Investment policy for endowed funds"], correct:0, explain:"Protecting donor data and communication preferences, including not selling lists without consent, is a core donor-privacy expectation under professional ethics codes."},
      {domain:"Ethics, Accountability, and Professionalism", q:"A development staff member's spouse owns a company being considered as a vendor for the organization's next gala. Ethical and accountable practice requires the staff member to:", options:["Say nothing, since the spouse isn't a direct employee","Disclose the conflict of interest to leadership and recuse themselves from the vendor decision","Automatically award the contract to the spouse's company","Resign from the organization immediately"], correct:1, explain:"Disclosure and recusal from the specific decision is the standard, proportionate response to a conflict of interest, not silence or automatic resignation."},
      {domain:"Ethics, Accountability, and Professionalism", q:"An annual report claims a program 'transformed thousands of lives' without any data to support that scale. This raises which ethical concern?", options:["None, impact language is always understood as marketing exaggeration","Truth in fundraising communications; claims about impact should be accurate and substantiated, not inflated","A copyright violation","A campaign-phase sequencing error"], correct:1, explain:"Professional fundraising ethics call for impact claims that are accurate and defensible, not inflated language unsupported by real data."},
      {domain:"Ethics, Accountability, and Professionalism", q:"An independent financial audit, conducted by an outside firm, primarily serves accountability by:", options:["Replacing the need to file a Form 990","Providing an objective, external check on the organization's financial statements and controls","Determining which donors receive tax deductions","Setting the organization's annual fundraising goals"], correct:1, explain:"An independent audit gives donors, regulators, and the board an outside, objective check on financial accuracy and internal controls, beyond self-reported numbers."},
      {domain:"Ethics, Accountability, and Professionalism", q:"A gift officer is offered an unofficial 'finder's fee' by a for-profit vendor for steering the organization's business their way. Ethical practice holds that this arrangement is:", options:["Acceptable as long as the vendor's product is good","A conflict of interest and generally prohibited under professional fundraising ethics codes","Only a concern if the fee exceeds $10,000","Standard practice and requires no disclosure"], correct:1, explain:"Undisclosed finder's fees create a conflict between the staff member's personal benefit and the organization's interest, and are generally prohibited by professional codes."},
      {domain:"Ethics, Accountability, and Professionalism", q:"A donor's endowment gift, restricted decades ago to a purpose the organization no longer operates, raises an accountability question about:", options:["Whether the organization must simply keep the funds unspent forever with no recourse","Honoring donor intent, often requiring a formal legal process such as court approval or a variance procedure, to redirect an obsolete restriction","Whether the gift should be immediately returned to the donor's estate","Nothing; restricted gifts have no lasting obligation once the original staff who accepted them are gone"], correct:1, explain:"Honoring donor intent on old restrictions usually requires a formal process, not unilateral staff discretion, to change how the funds are used."},
      {domain:"Ethics, Accountability, and Professionalism", q:"CFRE recertification requires certificants to accumulate continuing education points over a multi-year cycle. This requirement primarily supports:", options:["Increasing CFRE International's revenue with no other purpose","Ongoing professional competence and accountability to current ethical and technical standards over time","A one-time credential with no ongoing obligation","Replacing the need for the original CFRE exam"], correct:1, explain:"Recertification through continuing education is meant to keep certified professionals current, an accountability mechanism, not a one-and-done credential."},
      {domain:"Ethics, Accountability, and Professionalism", q:"Transparency about how much of a nonprofit's budget goes to programs versus fundraising and administration primarily serves which accountability purpose?", options:["It has no real accountability purpose","Letting donors and the public make an informed judgment about how efficiently and honestly the organization operates","Satisfying a requirement specific only to religious organizations","Determining an organization's eligibility to receive DAF grants"], correct:1, explain:"Cost transparency lets donors and watchdogs evaluate an organization's efficiency and honesty for themselves, a core accountability function."},
      {domain:"Ethics, Accountability, and Professionalism", q:"An organization's whistleblower policy, allowing staff to report ethical or financial concerns without fear of retaliation, primarily supports:", options:["Board fundraising training","Internal accountability, surfacing problems before they become larger ethical or legal failures","Donor stewardship communications","Wealth screening compliance"], correct:1, explain:"Whistleblower protections are an internal-accountability mechanism, encouraging early reporting of problems rather than letting them go unaddressed."},
      {domain:"Ethics, Accountability, and Professionalism", q:"AFP's Ethics Committee process for handling a formal complaint against a member accused of violating the Code of Ethical Standards exists primarily to:", options:["Automatically expel any member who is ever accused, regardless of findings","Provide a structured, fair process for reviewing alleged violations and holding the profession accountable to its own stated standards","Replace the need for any organization's own internal HR process","Only apply to CFRE-certified members, not all AFP members"], correct:1, explain:"A formal ethics review process gives the profession a fair, structured way to hold itself accountable to its own code, rather than leaving enforcement informal or arbitrary."},
      {domain:"Volunteer Involvement", q:"Before asking a volunteer to solicit a peer for a gift, best practice calls for the organization to first provide:", options:["No preparation; volunteers should improvise the ask entirely on their own","Training and a clear briefing, including talking points, the ask amount, and the case for support, so the volunteer solicits with confidence","A formal legal contract","Access to the organization's full financial statements"], correct:1, explain:"Volunteer solicitors typically perform far better, and feel more comfortable, when staff equip them with a clear briefing and materials before the ask, not left to improvise."},
      {domain:"Volunteer Involvement", q:"A young professionals' advisory council, engaging donors in their 20s and 30s in planning events and outreach, is an example of:", options:["A required IRS governance structure","A volunteer-engagement structure aimed at building a pipeline of future donors and leaders, not just immediate solicitation","A capital-campaign steering committee","A wealth-screening tool"], correct:1, explain:"Young-professional or affinity-based advisory councils build long-term volunteer and donor pipelines, engaging people well before they're ready for major-gift solicitation."},
      {domain:"Volunteer Involvement", q:"Matching a volunteer's specific skills and comfort level, such as writing versus in-person asking, to an appropriate volunteer role is important mainly because:", options:["It has no real bearing on outcomes","A poorly matched volunteer, asked to do something outside their comfort or skill, is more likely to underperform or disengage entirely","All volunteers are equally suited to every fundraising task","Volunteer role matching is only relevant to paid staff, not volunteers"], correct:1, explain:"Thoughtful role matching keeps volunteers engaged and effective; a mismatch between a volunteer's comfort and their assignment often leads to poor results or burnout."},
      {domain:"Volunteer Involvement", q:"Publicly recognizing a campaign's volunteer solicitors, not just its donors, at a campaign's closing celebration primarily serves to:", options:["Have no real purpose beyond ceremony","Sustain volunteer engagement and goodwill, making it more likely those volunteers stay involved for future efforts","Replace the need to thank donors","Satisfy a legal disclosure requirement"], correct:1, explain:"Recognizing volunteer effort, not only donor generosity, helps sustain the volunteer relationship and goodwill needed for the organization's next effort."},
      {domain:"Volunteer Involvement", q:"A volunteer event committee planning a fundraising gala's logistics is functionally distinct from a volunteer solicitation committee mainly because:", options:["They are actually the same committee under a different name","The event committee focuses on event planning and execution, while the solicitation committee focuses specifically on cultivating and asking individual donors","Event committees never include actual donors","Solicitation committees have no role in campaigns"], correct:1, explain:"Event committees and solicitation committees serve different functions, logistics and hosting versus direct donor cultivation and asks, even though both are volunteer-led."},
      {domain:"Volunteer Involvement", q:"Skills-based volunteering, such as a retired CPA volunteering to review the organization's financial statements, differs from solicitation volunteering in that it:", options:["Contributes professional expertise to organizational capacity, rather than direct fundraising asks","Is not considered real volunteer involvement","Always involves soliciting gifts, just using different language","Is prohibited under most nonprofit bylaws"], correct:0, explain:"Skills-based volunteering channels a volunteer's professional expertise into organizational capacity, a different but valuable form of volunteer involvement than direct solicitation."},
      {domain:"Volunteer Involvement", q:"A volunteer solicitation committee member who commits to five peer visits but completes none over an entire campaign illustrates a common risk of:", options:["Over-preparing volunteers before asking them to solicit","Volunteer follow-through, underscoring why clear expectations, staff support, and accountability structures matter","Recruiting volunteers who are too skilled for the task","Board members refusing to give personally"], correct:1, explain:"Volunteer follow-through is a known risk; setting clear expectations and providing staff support and accountability helps prevent commitments from quietly stalling out."},
      {domain:"Volunteer Involvement", q:"An alumni network organized to help a university identify and warmly introduce prospective major donors among former classmates is an example of:", options:["A wealth-screening vendor","A volunteer-based prospect identification and cultivation resource, drawing on personal relationships staff alone couldn't access","A legal requirement for accredited universities","A grant-seeking activity"], correct:1, explain:"Alumni and affinity networks are a volunteer resource for identification and warm introductions, relationships built over years that staff alone often can't replicate."},
      {domain:"Volunteer Involvement", q:"Written volunteer job descriptions, spelling out expected time commitment and specific responsibilities for a campaign committee role, primarily help by:", options:["Setting clear, mutual expectations upfront, reducing the risk of volunteer confusion, overcommitment, or disengagement","Serving no real purpose beyond paperwork","Being legally required for every volunteer role","Replacing the need for any staff support of volunteers"], correct:0, explain:"Clear written expectations upfront reduce the chance a volunteer over- or under-commits, or simply isn't sure what's actually expected of them."},
      {domain:"Volunteer Involvement", q:"The most effective volunteer solicitors in a campaign are generally described as those who:", options:["Have the largest personal gift capacity, regardless of their comfort asking others","Combine genuine belief in the mission with a real, credible personal relationship to the person they're asking","Are current paid staff members acting informally as volunteers","Avoid personally giving so as to appear neutral"], correct:1, explain:"The most effective solicitors pair authentic belief in the cause with a real relationship to the person being asked, credibility and connection outperform gift capacity alone."}
    ]},
    ACFRE: {label:"ACFRE", sub:"AFP / CFRE International &middot; 40 questions, 10 per stage", questions:[
      {domain:"Application", q:"What does the ACFRE Application stage primarily require?", options:["A timed multiple-choice test","Documentation proving eligibility and the prerequisite credential","An oral interview with a panel","A finished portfolio of past campaigns"], correct:1, explain:"The Application stage is a documentation and eligibility-verification gate, before the Portfolio or exam stages begin."},
      {domain:"Application", q:"Which stage comes first in the ACFRE process?", options:["Oral review","Written exam","Application","Portfolio"], correct:2, explain:"The sequence is Application, Portfolio, Written exam, Oral review, in that order."},
      {domain:"Application", q:"What happens if a candidate's ACFRE Application isn't approved?", options:["They automatically proceed to Portfolio anyway","They cannot proceed to the Portfolio stage until eligibility is resolved","They skip directly to Oral review","Their CFRE is revoked"], correct:1, explain:"Application approval is a gate; a candidate can't move to Portfolio without first clearing the eligibility documentation review."},
      {domain:"Application", q:"Which of the following would most likely cause an ACFRE Application to be sent back for correction?", options:["Incomplete or missing eligibility documentation","An unusually strong portfolio narrative","Already holding AFP membership","Having passed CFRE more than 10 years ago"], correct:0, explain:"The Application stage is a documentation-review gate; incomplete eligibility documentation is the most common reason it gets sent back."},
      {domain:"Application", q:"Which of the following is the prerequisite most ACFRE candidates use to qualify?", options:["A CPA license","Active CFRE certification (or FAHP/IADF, or 20+ years of experience)","A master's degree in nonprofit management","Firm membership in The Giving Institute"], correct:1, explain:"ACFRE requires holding CFRE first (or the FAHP/IADF equivalent, or 20+ years of experience as an alternate path)."},
      {domain:"Application", q:"Roughly how many years of fundraising experience does ACFRE require, absent the alternate 20-years pathway?", options:["3","5","10","15"], correct:2, explain:"Roughly 10 years of experience is the standard eligibility bar, documented at the Application stage."},
      {domain:"Application", q:"How many combined contact hours of senior-management and leadership training within the last 5 years must a candidate document at Application?", options:["10","20","30","40"], correct:2, explain:"15 hours senior-management plus 15 hours leadership, 30 combined, within the last 5 years, documented as part of eligibility."},
      {domain:"Application", q:"How many hours of ethics training within the last 5 years must a candidate document as part of ACFRE eligibility?", options:["5","10","15","20"], correct:1, explain:"10 hours of ethics training within 5 years is the requirement, verified during the Application stage."},
      {domain:"Application", q:"Does ACFRE require a bachelor's degree as part of its eligibility criteria?", options:["Yes, a bachelor's degree is required","No degree of any kind is ever considered","Only a graduate degree qualifies","Eligibility ignores education entirely"], correct:0, explain:"A bachelor's degree is one of ACFRE's stated eligibility requirements, documented and verified at the Application stage."},
      {domain:"Application", q:"Beyond experience and contact hours, which of the following is also part of ACFRE's Application-stage eligibility criteria?", options:["Current membership in a professional fundraising association and adherence to AFP's ethics code","Ownership of a fundraising consulting firm","A personal net worth above a stated threshold","Prior service as a nonprofit board chair"], correct:0, explain:"Current professional-association membership and adherence to AFP's ethics code are both explicit eligibility conditions verified at Application."},
      {domain:"Portfolio", q:"What does the ACFRE Portfolio stage primarily document?", options:["A single recent campaign's financial results","A career narrative and work samples across senior practice areas","Donor financial records","One letter of recommendation"], correct:1, explain:"The portfolio documents a career narrative and work samples spanning senior fundraising practice, not one campaign or one reference."},
      {domain:"Portfolio", q:"Should a candidate start building their ACFRE portfolio right before the deadline, or well in advance?", options:["Right before the deadline works fine, since it's a short document","Well in advance, since it documents years of past work rather than something written in a week","It doesn't matter, portfolios aren't time-sensitive","Portfolios are pre-written by AFP staff"], correct:1, explain:"Because the portfolio documents a career's worth of work and impact, starting early is the practical advice AFP itself gives candidates."},
      {domain:"Portfolio", q:"AFP Deep Dive continuing-education hours can be used toward which ACFRE requirement, later documented in the portfolio?", options:["The Written exam score","The senior-management and leadership contact-hour requirement","Reducing the total fee","Skipping the Oral review stage"], correct:1, explain:"Deep Dive and similar CE hours can count toward ACFRE's contact-hour requirements, which also get documented in the portfolio."},
      {domain:"Portfolio", q:"Is the ACFRE Portfolio stage evaluated by a review committee, or approved automatically once submitted?", options:["Automatically approved on submission","Evaluated by a review process, not automatic","Skipped entirely if the candidate already holds CFRE","Only reviewed if the Written exam is failed first"], correct:1, explain:"Like the other stages, the Portfolio goes through a real review process, it isn't a rubber stamp."},
      {domain:"Portfolio", q:"Beyond technical fundraising skill, what is a strong ACFRE portfolio generally expected to demonstrate?", options:["Nothing beyond technical skill","Senior-level leadership judgment and strategic decision-making over a career","Fluency in a single software platform","A perfect donor retention rate"], correct:1, explain:"ACFRE targets senior practitioners, so the portfolio is expected to show leadership judgment, not just technical execution."},
      {domain:"Portfolio", q:"Does the ACFRE Portfolio stage involve any written work samples, or is it purely a list of job titles?", options:["Purely a list of job titles with dates","Written work samples and documentation alongside the career narrative","Only third-party letters, no candidate-written material","A single-page resume only"], correct:1, explain:"The portfolio includes actual work samples and documentation, not just a career timeline."},
      {domain:"Portfolio", q:"True or false: the ACFRE Portfolio stage can be satisfied with a single glowing supervisor reference in place of actual work samples.", options:["True","False"], correct:1, explain:"False, the portfolio requires a career narrative plus real work samples, a single reference letter isn't a substitute."},
      {domain:"Portfolio", q:"How does the ACFRE Portfolio stage differ in purpose from the baseline CFRE eligibility documentation a candidate already holds?", options:["They're identical requirements with no real difference","Portfolio demonstrates senior-level career impact and judgment, well beyond baseline CFRE eligibility documentation","Portfolio only applies to candidates who never earned CFRE","Portfolio replaces the need for 10 years of experience"], correct:1, explain:"Where CFRE eligibility documentation is largely a checklist, the ACFRE portfolio is a deeper, evidence-based demonstration of senior career impact."},
      {domain:"Portfolio", q:"A candidate's ACFRE portfolio includes work samples from a campaign she led 12 years ago as her strongest example, with nothing more recent. What's the likely concern?", options:["None, older work is always weighted the same as recent work","It may not reflect current, senior-level practice as clearly as more recent samples would","Portfolios cannot include work older than 2 years and will be rejected outright","Older work automatically disqualifies a candidate"], correct:1, explain:"Reviewers are assessing current, senior-level capability; leaning entirely on older work risks not showing where the candidate's practice stands today."},
      {domain:"Portfolio", q:"Which best captures what ACFRE portfolio reviewers are ultimately trying to assess?", options:["Whether the candidate can pass a timed knowledge test","Whether the candidate has demonstrated sustained, senior-level fundraising leadership over a career","Whether the candidate's employer is a large organization","Whether the candidate maintains a personal fundraising blog"], correct:1, explain:"The portfolio exists to evaluate a sustained career of senior-level leadership and impact, not any single external marker."},
      {domain:"Written exam", q:"Which ACFRE stage uses a case-study or essay format rather than multiple choice?", options:["Application","Portfolio","Written exam","Oral review"], correct:2, explain:"The written exam stage is case-study/essay based, not a multiple-choice test like CFRE or GPC."},
      {domain:"Written exam", q:"What does the ACFRE Written exam primarily assess?", options:["Rote memorization of definitions","Applied judgment on senior-level fundraising scenarios","Typing speed","Knowledge of a specific donor database software"], correct:1, explain:"The essay/case-study format is designed to test applied, senior-level judgment, not memorized facts."},
      {domain:"Written exam", q:"Where does the Written exam fall in the ACFRE sequence?", options:["1st, before Application","2nd, before Portfolio","3rd, after Portfolio and before Oral review","4th and final"], correct:2, explain:"The order is Application, Portfolio, Written exam, then Oral review, so Written exam is third."},
      {domain:"Written exam", q:"What kind of preparation is generally most useful for the ACFRE Written exam?", options:["Memorizing CFRE's domain-weighting percentages","Real senior-level case experience and demonstrated strategic judgment","Practicing typing under time pressure","Studying GPC's writing rubrics instead"], correct:1, explain:"Because it's a case-study/essay format testing applied judgment, real senior practice experience prepares a candidate better than rote study."},
      {domain:"Written exam", q:"Does passing the ACFRE Written exam stage guarantee the candidate receives the ACFRE credential?", options:["Yes, it's the final stage","No, the Oral review stage still remains","Yes, but only if Portfolio was skipped","No, the candidate must restart at Application"], correct:1, explain:"Written exam is the third of four stages; Oral review still follows before certification is complete."},
      {domain:"Written exam", q:"ACFRE Written exam responses are typically evaluated against:", options:["A single correct keyword list","Demonstrated strategic and ethical judgment appropriate to a senior practitioner","Grammar and spelling alone","Word count only"], correct:1, explain:"Given the essay/case-study format, evaluation centers on judgment and reasoning appropriate to senior fundraising leadership, not surface mechanics."},
      {domain:"Written exam", q:"Compared to the GPC multiple-choice exam, the ACFRE Written exam stage differs mainly in that it:", options:["Uses an essay/case-study format testing applied judgment rather than a bank of scored multiple-choice items","Has no time limit at all","Is optional for candidates with 20+ years of experience","Is taken before the Application stage"], correct:0, explain:"ACFRE's Written exam is essay/case-study based, a fundamentally different format than GPC's scored multiple-choice bank."},
      {domain:"Written exam", q:"Why is a multiple-choice format like CFRE's or GPC's not used for the ACFRE Written exam stage?", options:["Multiple choice is cheaper to administer, that's the only reason","An essay/case-study format better tests applied, senior-level judgment than a bank of recall-based questions","ACFRE candidates are not allowed to take timed tests","Multiple choice was tried and discontinued for unrelated reasons"], correct:1, explain:"ACFRE targets senior, portfolio-level practitioners, so an essay/case-study format better fits testing judgment over recall."},
      {domain:"Written exam", q:"A strong ACFRE Written exam response would most likely include:", options:["A list of memorized definitions with no application","Reasoned analysis applying professional judgment to a realistic senior-level scenario","The shortest possible answer to save time","Direct quotes from the AFP Code of Ethics with no original analysis"], correct:1, explain:"Reviewers are looking for applied, original reasoning grounded in professional judgment, not recited definitions or quotations alone."},
      {domain:"Written exam", q:"If a candidate does not pass the Written exam stage, what generally happens next in the ACFRE process?", options:["They are permanently barred from ever pursuing ACFRE","They do not advance to Oral review until the Written exam requirement is successfully met","Their CFRE credential is also automatically revoked","They skip directly to receiving the ACFRE credential anyway"], correct:1, explain:"Written exam is a required gate before Oral review; a candidate can't move forward without meeting that stage's requirement."},
      {domain:"Oral review", q:"The ACFRE Oral review examines a candidate on how many chosen specialty areas?", options:["1","2","3","4"], correct:1, explain:"Candidates choose 2 specialty areas for the oral-review panel to examine."},
      {domain:"Oral review", q:"The ACFRE Oral review is conducted by:", options:["A single AFP staff member","A panel","An automated online assessment","The candidate's own employer"], correct:1, explain:"Oral review is a panel interview, not a one-on-one staff conversation or an automated test."},
      {domain:"Oral review", q:"A candidate whose practice spans major/planned gifts and nonprofit strategy consulting would most likely choose which pairing of ACFRE oral-review specialty areas?", options:["Direct mail and event planning","Major/planned gifts and nonprofit strategy consulting, matching their actual practice","Grant writing and volunteer management, unrelated to their work","Whichever two areas are randomly assigned"], correct:1, explain:"Candidates choose specialty areas that map to their actual practice, so the panel can go deep on real expertise rather than generalist coverage."},
      {domain:"Oral review", q:"Oral review is which stage, in sequence, of the four total ACFRE stages?", options:["1st","2nd","3rd","4th and final"], correct:3, explain:"Oral review is the fourth and final stage, after Application, Portfolio, and Written exam."},
      {domain:"Oral review", q:"Beyond subject knowledge, what does the ACFRE Oral review panel also typically evaluate?", options:["Nothing beyond memorized facts","Real-time judgment, communication, and presence under panel questioning","The candidate's handwriting","Only the candidate's resume formatting"], correct:1, explain:"An oral panel format inherently tests how a candidate communicates and reasons live, not just what they know on paper."},
      {domain:"Oral review", q:"When are a candidate's two ACFRE oral-review specialty areas typically decided?", options:["Randomly assigned the day of the interview","Chosen by the candidate in advance, tied to their actual practice areas","Decided by the panel after the interview begins","Never disclosed to the candidate at all"], correct:1, explain:"Candidates select their two specialty areas ahead of time so the panel can prepare to examine them in depth."},
      {domain:"Oral review", q:"What is the main reason ACFRE lets candidates choose specialty areas for the Oral review, rather than testing everyone on the same generalist content?", options:["It's easier to administer for AFP staff","It lets the panel evaluate a candidate's actual, real-world depth of practice rather than generic coverage","It shortens the interview to five minutes","It removes the need for a Written exam"], correct:1, explain:"Specialty-area focus lets the panel assess genuine depth in the candidate's real practice, appropriate for a senior, portfolio-based credential."},
      {domain:"Oral review", q:"What's the main reason the Oral review is scheduled as the final stage, after Written exam and Portfolio?", options:["It's alphabetically last among the four stages","By then the panel has full documentation (application, portfolio, written responses) to inform a deeper live conversation","Oral review is actually optional and rarely scheduled","There is no particular order significance"], correct:1, explain:"Placing Oral review last lets the panel draw on everything already submitted, application, portfolio, and written exam, for a richer live conversation."},
      {domain:"Oral review", q:"A candidate performs well on paper (Portfolio and Written exam) but struggles to articulate real-time reasoning in front of the Oral review panel. What does this risk?", options:["Nothing, the written stages are the only ones that count","It can still affect the overall outcome, since Oral review independently evaluates live judgment and communication","The panel is required to pass anyone who reached this stage","Oral review scores are discarded after the interview"], correct:1, explain:"Oral review is an independent, weighted evaluation, strong written work doesn't guarantee a strong outcome if live judgment and communication fall short."},
      {domain:"Oral review", q:"What is the practical benefit, for the candidate, of choosing oral-review specialty areas that closely match their actual day-to-day practice?", options:["None, all candidates are asked identical generic questions regardless of chosen areas","They can speak from direct, lived expertise rather than general theory, which tends to produce a stronger interview","It automatically shortens the interview length","It guarantees a passing result regardless of performance"], correct:1, explain:"Speaking from real, lived practice experience tends to produce sharper, more confident answers than trying to generalize outside one's actual expertise."}
,
      {domain:"Application", q:"Which of the following is generally accepted as part of ACFRE's alternate eligibility pathway for candidates who do not hold an active CFRE?", options:["No alternate pathway exists; CFRE is the only route","A longer documented fundraising experience requirement in place of the CFRE prerequisite","A doctoral degree in any field","Board membership at three or more nonprofits"], correct:1, explain:"ACFRE's eligibility structure allows for an alternate, longer experience-based pathway for candidates without an active CFRE, rather than requiring CFRE from absolutely everyone."},
      {domain:"Application", q:"Which body is primarily responsible for reviewing a candidate's ACFRE Application materials for eligibility?", options:["A designated ACFRE review body, such as the certification's standards or credentialing committee","The candidate's own employer","The IRS","A randomly assigned donor panel"], correct:0, explain:"Eligibility documentation is reviewed by the credential's designated standards or credentialing review structure, not by an outside party like an employer or the IRS."},
      {domain:"Application", q:"Typical Application-stage documentation includes which of the following, beyond contact-hour and ethics-hour logs?", options:["A completed capital-campaign feasibility study","Verification of professional experience, such as employer confirmation or a detailed resume of fundraising roles","A signed donor testimonial","A copy of the organization's most recent Form 990"], correct:1, explain:"Application materials typically include documentation verifying the candidate's actual professional fundraising experience, alongside contact-hour and ethics-hour logs."},
      {domain:"Application", q:"If an ACFRE candidate's initial Application is deemed incomplete, what is the typical next step?", options:["Automatic disqualification from ever applying again","The candidate is generally given the opportunity to correct or supplement the missing documentation","Immediate advancement to Portfolio anyway","A mandatory one-year waiting period regardless of the issue"], correct:1, explain:"An incomplete Application is typically returned for correction or additional documentation, not an automatic, permanent disqualification."},
      {domain:"Application", q:"Why does ACFRE's Application stage require documentation of senior-level or leadership experience specifically, rather than any fundraising experience?", options:["ACFRE is meant to recognize advanced, executive-level practice, not entry- or mid-level fundraising roles alone","Leadership experience has no bearing on ACFRE eligibility","Only board chairs are eligible to apply","Senior experience is required only for the Oral review stage"], correct:0, explain:"ACFRE is positioned as the field's most advanced credential, so eligibility criteria are built around demonstrated senior-level, strategic fundraising practice."},
      {domain:"Application", q:"How does the Application stage's function differ from the Portfolio stage that follows it?", options:["They are functionally identical stages under different names","Application verifies baseline eligibility to proceed, while Portfolio asks the candidate to substantively demonstrate their body of work","Application is optional if a candidate has already completed Portfolio","Portfolio verifies eligibility, and Application demonstrates work product"], correct:1, explain:"Application is a gate confirming a candidate meets baseline eligibility; Portfolio is where the candidate actually demonstrates the substance of their professional work."},
      {domain:"Application", q:"A candidate holds an active CFRE but has only 6 years of documented fundraising experience. Under ACFRE's standard eligibility criteria, absent the alternate pathway, this candidate would most likely:", options:["Qualify immediately regardless of years of experience","Not yet meet the standard experience threshold, which is generally around a decade","Automatically qualify because they hold CFRE","Be required to retake the CFRE exam first"], correct:1, explain:"Holding CFRE alone doesn't satisfy ACFRE's separate, longer experience threshold; both the credential and the years of experience are generally required together."},
      {domain:"Application", q:"What is the practical purpose of requiring documented senior-management or leadership training hours as part of ACFRE Application eligibility?", options:["To ensure candidates have exposure to organizational leadership and management, not just frontline solicitation skill","It has no practical purpose beyond paperwork","To replace the need for the Written exam stage","To qualify candidates for AFP chapter leadership roles"], correct:0, explain:"Requiring leadership and management training hours reflects ACFRE's emphasis on advanced practice that spans strategic and organizational leadership, not solicitation skill alone."},
      {domain:"Application", q:"Once a candidate's Application is approved, what does that approval specifically authorize?", options:["Automatic award of the ACFRE credential","Moving forward to build and submit the Portfolio stage","Skipping directly to the Oral review","A refund of the application fee"], correct:1, explain:"Application approval is a gate that authorizes the candidate to proceed to Portfolio, it does not itself grant any part of the credential."},
      {domain:"Application", q:"Why might ACFRE require documentation across several distinct eligibility criteria, such as experience, hours, and ethics training, rather than a single simple threshold like years of experience alone?", options:["To make the process needlessly complicated","To confirm a well-rounded profile of advanced experience, ongoing professional development, and ethical grounding before a candidate invests in Portfolio, Written exam, and Oral review","Because CFRE International requires it as a revenue mechanism","There is no real reasoning behind multiple criteria"], correct:1, explain:"Multiple criteria together paint a fuller picture of advanced, ethically grounded, continuously developing practice, more meaningful than any single threshold alone."},
      {domain:"Portfolio", q:"A strong ACFRE portfolio is generally expected to include work samples spanning:", options:["A single fundraising vehicle only, such as direct mail","Multiple competency areas and types of fundraising work, reflecting broad, advanced practice rather than one narrow specialty","Only volunteer-recruitment materials","Exclusively financial statements"], correct:1, explain:"Because ACFRE recognizes advanced, well-rounded practice, portfolios are expected to demonstrate breadth across multiple competencies, not one narrow specialty alone."},
      {domain:"Portfolio", q:"Beyond simply describing past projects, a strong ACFRE portfolio narrative is generally expected to include:", options:["Reflective analysis of decisions made, strategic reasoning, and lessons learned, not just a description of what happened","Only a bullet-point list of past job titles","A general history of the fundraising profession","No written narrative at all, only attachments"], correct:0, explain:"Reviewers are looking for evidence of strategic thinking and reflection, why decisions were made and what was learned, not just a factual account of past activities."},
      {domain:"Portfolio", q:"A common weakness reviewers cite in weaker ACFRE portfolio submissions is:", options:["Too much reflective analysis of strategic decisions","Heavy description of what was done, with little reflection on strategic reasoning or what was learned","Too many distinct work samples included","Submitting the portfolio too far in advance of the deadline"], correct:1, explain:"A common critique is portfolios that read as activity logs, describing what happened, without the reflective, strategic analysis reviewers are actually looking for."},
      {domain:"Portfolio", q:"If an ACFRE Portfolio submission is not approved on first review, what generally happens?", options:["The candidate is permanently disqualified from ACFRE","The candidate is typically given feedback and an opportunity to revise and resubmit","The Written exam stage is waived instead","The candidate's existing CFRE credential is revoked"], correct:1, explain:"Portfolio review is generally a developmental process, feedback and a path to revise and resubmit is standard, not permanent disqualification."},
      {domain:"Portfolio", q:"Letters of reference included in an ACFRE portfolio are generally meant to:", options:["Replace the need for any actual work samples","Corroborate the candidate's professional reputation and impact, supplementing, not substituting for, documented work samples","Serve as the sole basis for the entire Portfolio evaluation","Confirm the candidate's legal identity"], correct:1, explain:"References corroborate reputation and impact alongside the candidate's own documented work, they support the portfolio rather than replace its substantive content."},
      {domain:"Portfolio", q:"Why does the ACFRE Portfolio process generally recommend candidates begin compiling materials well before the submission deadline?", options:["Strong portfolios typically draw on real work product accumulated over time, which is hard to reconstruct convincingly at the last minute","There's no real advantage either way","Early submission automatically improves the score","It's only a suggestion with no practical basis"], correct:0, explain:"Because a strong portfolio draws on genuine work product built over a career, starting early lets a candidate gather and curate real materials rather than scrambling to reconstruct them."},
      {domain:"Portfolio", q:"What is the primary purpose of requiring Portfolio review by a committee rather than automatic approval upon submission?", options:["To slow down the ACFRE process unnecessarily","To ensure an independent, substantive evaluation of whether the work demonstrates advanced practice","Automatic approval was previously used and is being phased out for no reason","Committee review exists only for candidates without CFRE"], correct:1, explain:"Committee review provides an independent check that the portfolio demonstrates advanced practice, rather than accepting any submission at face value."},
      {domain:"Portfolio", q:"How does documented breadth across multiple fundraising competencies in a Portfolio differ in purpose from the Written exam stage that follows?", options:["Portfolio demonstrates past real-world work product across areas of practice; Written exam tests applied reasoning on new case scenarios","They test the exact same thing in different formats","Portfolio is a multiple-choice assessment","Written exam evaluates only past work samples"], correct:0, explain:"Portfolio looks backward at documented, real work; Written exam looks forward, testing how the candidate reasons through new scenarios."},
      {domain:"Portfolio", q:"A portfolio that includes strong campaign results but no discussion of the candidate's specific role or decisions in achieving them would likely be viewed by reviewers as:", options:["A model submission requiring no changes","Incomplete in demonstrating the candidate's own individual contribution and strategic judgment, not just organizational results","Sufficient, since only outcomes matter","Grounds for automatic ACFRE approval regardless of other content"], correct:1, explain:"Reviewers want to see the candidate's own individual judgment and contribution, not just favorable organizational results that could reflect a whole team's work."},
      {domain:"Portfolio", q:"Once a candidate's Portfolio is approved, they generally move next to:", options:["Immediate award of the ACFRE credential","The Written exam stage","Reapplying for CFRE","Back to the Application stage"], correct:1, explain:"After Portfolio approval, candidates move forward to the Written exam stage, continuing the sequence toward Oral review and the completed credential."},
      {domain:"Written exam", q:"The ACFRE Written exam presents candidates with realistic case-study scenarios and asks them to:", options:["Select the single correct answer from four options","Write analytical responses demonstrating applied judgment and strategic reasoning","List memorized definitions of fundraising terms","Submit a completed grant application"], correct:1, explain:"Rather than testing recall through multiple choice, the Written exam asks candidates to reason through realistic scenarios in writing, demonstrating applied judgment."},
      {domain:"Written exam", q:"Written exam responses are typically evaluated by:", options:["A single reviewer working alone","Multiple independent reviewers, helping reduce individual bias in scoring subjective, written responses","An automated scoring algorithm","The candidate's own portfolio committee, reusing the same reviewers"], correct:1, explain:"Using multiple independent reviewers for subjective written responses is a standard way to reduce the influence of any one reviewer's individual bias."},
      {domain:"Written exam", q:"If a candidate does not pass the Written exam on their first attempt, ACFRE's process generally allows for:", options:["No possibility of retaking the exam under any circumstances","A defined process to retake the exam, typically after some waiting period and often with guidance on the areas needing improvement","Automatic advancement to Oral review anyway","Immediate loss of the underlying CFRE credential"], correct:1, explain:"Not passing on the first attempt is not typically a dead end; a defined retake process exists, along with insight into where the response fell short."},
      {domain:"Written exam", q:"Why is the Written exam considered to test something meaningfully different from the multiple-choice CFRE or GPC exams?", options:["It doesn't; all three exams test identical content","It requires candidates to construct and justify their own reasoning in writing, rather than recognize a correct answer among options","It is entirely oral, with no written component at all","It only tests factual recall of dates and statistics"], correct:1, explain:"Constructing and justifying a reasoned written response is a fundamentally different, and generally considered more demanding, skill than selecting among given options."},
      {domain:"Written exam", q:"Effective preparation for the ACFRE Written exam is generally considered to emphasize:", options:["Memorizing definitions from a glossary","Practicing applied analysis of realistic case scenarios and articulating clear, well-reasoned strategic responses","Reviewing only the candidate's own past portfolio submission","Studying exclusively GPC exam content"], correct:1, explain:"Because the exam tests applied reasoning on case scenarios, practicing that kind of analytical, written response is more useful preparation than memorizing definitions."},
      {domain:"Written exam", q:"What does strong performance on the Written exam, specifically, signal about a candidate that Portfolio review alone might not fully capture?", options:["Nothing additional; the two stages test identical things","The candidate's ability to reason through new, unfamiliar scenarios in real time, not just document past, already-completed work","Portfolio and Written exam are graded by the same criteria and reviewers","Written exam only tests writing mechanics, not judgment"], correct:1, explain:"Written exam scenarios are new to the candidate, testing live applied reasoning, a different capability than curating and presenting already-completed past work."},
      {domain:"Written exam", q:"Where does the Written exam sit in relation to the Oral review stage that follows it?", options:["Written exam comes after Oral review","Written exam comes before Oral review, and its content often informs or is referenced during the Oral review conversation","They occur simultaneously","Written exam replaces the need for Oral review"], correct:1, explain:"Written exam precedes Oral review in the sequence, and panel members may reference a candidate's written responses during the live Oral review conversation."},
      {domain:"Written exam", q:"Why might ACFRE's Written exam use realistic, scenario-based prompts rather than abstract theoretical questions?", options:["To better simulate the kind of applied, real-world judgment an advanced practitioner actually has to exercise on the job","Scenario-based prompts are simply easier to grade","Abstract questions are prohibited under CFRE International's bylaws","There is no particular reasoning behind the format choice"], correct:0, explain:"Scenario-based prompts are meant to mirror the actual judgment calls an advanced practitioner faces, rather than testing abstract theory divorced from practice."},
      {domain:"Written exam", q:"A Written exam response that identifies a case scenario's core issue but proposes a generic, one-size-fits-all solution would likely be viewed as:", options:["An ideal model response","Weaker than a response tailored specifically to the scenario's particular constraints and context","Irrelevant to the scoring rubric","Automatically passing, since any solution is acceptable"], correct:1, explain:"Reviewers are generally looking for responses tailored to the specific scenario's constraints, not a generic answer that could apply to any situation."},
      {domain:"Written exam", q:"What is the relationship between passing the Written exam and ultimately receiving the ACFRE credential?", options:["Passing the Written exam alone completes the ACFRE process","Passing Written exam is a required step, but the candidate must still complete Oral review afterward before the credential is awarded","Written exam is optional if Portfolio was strong","Written exam is the very first stage in the ACFRE sequence"], correct:1, explain:"Written exam is a necessary but not sufficient step, Oral review still follows before the full ACFRE credential is awarded."},
      {domain:"Oral review", q:"The ACFRE Oral review is generally structured as a live conversation in which the panel:", options:["Reads pre-written questions with no follow-up allowed","Poses scenario-based questions and follow-up probes, assessing the candidate's real-time reasoning and communication","Simply reviews the candidate's Portfolio silently with no live questioning","Administers a timed multiple-choice test verbally"], correct:1, explain:"Oral review is a live, interactive conversation built around scenario questions and follow-up probing, not a scripted, one-way reading of questions."},
      {domain:"Oral review", q:"Panel members conducting the ACFRE Oral review are generally expected to be:", options:["Randomly selected members of the public","Experienced fundraising professionals, often ACFRE holders themselves, qualified to evaluate advanced practice","Exclusively CFRE International staff with no fundraising background","Selected entirely by the candidate being reviewed"], correct:1, explain:"Panelists are experienced practitioners, often ACFRE-credentialed themselves, chosen for their ability to meaningfully evaluate advanced professional judgment."},
      {domain:"Oral review", q:"Common preparation for the ACFRE Oral review includes:", options:["Avoiding any review of one's own Portfolio or Written exam responses beforehand","Mock interviews and reviewing one's own prior Portfolio and Written exam responses, since the panel may reference them","Memorizing the CFRE glossary verbatim","Submitting additional written material the week before"], correct:1, explain:"Because the panel may draw on a candidate's earlier submissions, reviewing that material and practicing through mock interviews is common, useful preparation."},
      {domain:"Oral review", q:"If a candidate does not pass the Oral review, what generally happens next in the ACFRE process?", options:["The ACFRE credential is still awarded regardless","There is typically a defined path to retry the Oral review, often with feedback on areas to strengthen","The candidate must restart the entire process from the Application stage every time","No retry is ever possible under any circumstance"], correct:1, explain:"Not passing Oral review isn't typically a permanent dead end; a structured retry path with feedback is generally part of the process, similar to the Written exam stage."},
      {domain:"Oral review", q:"Why does Oral review specifically test something that a written format like the Written exam stage cannot fully capture?", options:["It doesn't; the two stages test identical things in different formats","Live, real-time interaction tests a candidate's ability to think on their feet and communicate under direct questioning, distinct from prepared written analysis","Oral review only tests memorized trivia","Written exam already fully covers live communication skill"], correct:1, explain:"Live questioning and follow-up probe a candidate's real-time reasoning and communication under direct pressure, a different skill than composing a prepared written response."},
      {domain:"Oral review", q:"Beyond correct subject-matter knowledge, what quality does the Oral review panel specifically evaluate that's distinct from Written exam scoring?", options:["Spelling and grammar","The candidate's composure, clarity, and ability to communicate reasoning live under direct, unscripted questioning","Whether the candidate's handwriting is legible","The length of the candidate's original CFRE application"], correct:1, explain:"Composure and clear, live communication under direct, sometimes unscripted questioning is a distinct competency the Oral review specifically probes."},
      {domain:"Oral review", q:"Why is the Oral review generally understood as the final and most decisive gate before ACFRE is awarded?", options:["It carries no more weight than any other stage","By that point the panel can weigh a candidate's full body of evidence, application, portfolio, and written exam, together with live, real-time judgment, before the credential is conferred","It's actually the least important stage of the four","Oral review results are advisory only and don't affect the final outcome"], correct:1, explain:"Coming last, Oral review lets the panel integrate everything already submitted with a live assessment of real-time judgment, making it a decisive final gate."},
      {domain:"Oral review", q:"A candidate who prepares extensively for their two chosen specialty areas but is asked a follow-up question slightly outside that specific area should generally expect to:", options:["Refuse to answer since it's outside the chosen specialty","Draw on their broader professional judgment and reasoning to respond thoughtfully, even if the specific sub-topic wasn't a primary focus","Automatically fail the entire Oral review","Request the question be removed from scoring"], correct:1, explain:"Panels generally expect candidates to reason thoughtfully even slightly outside their chosen specialty, since Oral review is testing broader applied judgment, not narrow recall."},
      {domain:"Oral review", q:"What is the practical value of the Oral review being a live conversation rather than another written submission?", options:["It allows the panel to probe follow-up questions and assess reasoning in the moment, something a static written document can't reveal","There is no practical value; it's simply tradition","Live format is easier and faster for CFRE International to administer","It removes the need for any panel training"], correct:0, explain:"The interactive, follow-up nature of a live conversation reveals depth of reasoning and adaptability in ways a fixed written submission cannot."},
      {domain:"Oral review", q:"Successfully completing the Oral review, as the fourth and final ACFRE stage, results in:", options:["Eligibility to begin the Application stage","The candidate being awarded the ACFRE credential, having completed all four required stages","Automatic renewal of the underlying CFRE credential only","A requirement to immediately begin the process again for recertification"], correct:1, explain:"Successfully completing Oral review, the final of the four stages, is what results in the ACFRE credential itself being awarded."}
    ]},
    GPC: {label:"GPC", sub:"Grant Professionals Certification Institute &middot; 80 questions, 10 per knowledge area", questions:[
      {domain:"Crafting, constructing, and submitting", q:"On the GPC multiple-choice exam, which knowledge area carries the most weight?", options:["Crafting, constructing, and submitting grant applications","Post-award grant management practices","Cultivating funder relationships","Professionalism advancement practices"], correct:0, explain:"Crafting, constructing, and submitting grant applications is weighted 23%, the largest single knowledge area."},
      {domain:"Crafting, constructing, and submitting", q:"A funder's formal call for proposals, spelling out eligibility, scope, and deadline, is a(n):", options:["LOI","RFP","CGA","CLT"], correct:1, explain:"RFP, Request for Proposal. An LOI is the shorter preliminary pitch that often comes before an invited full proposal."},
      {domain:"Crafting, constructing, and submitting", q:"A short preliminary pitch to a funder, used to gauge interest before a full proposal is invited, is a(n):", options:["RFP","LOI","DAF","Case for Support"], correct:1, explain:"LOI, Letter of Inquiry (or Intent). Most foundations screen on the LOI alone before ever inviting a full proposal."},
      {domain:"Crafting, constructing, and submitting", q:"Missing one required attachment on a grant application, such as a budget narrative, typically results in:", options:["A follow-up email requesting the missing piece","Automatic disqualification, no exceptions","A reduced score but the application stays under review","No consequence if the rest of the narrative is strong"], correct:1, explain:"Most RFPs treat a missing required attachment as automatic disqualification. No exceptions is the standard, harsh as it sounds."},
      {domain:"Crafting, constructing, and submitting", q:"What role does a case for support typically play in a grant application?", options:["It's irrelevant to grant writing, only used for individual donor asks","It's the backbone argument (\"why this, why now, why us\") that the proposal narrative draws from","It replaces the need for a budget narrative","It's only required for federal grants"], correct:1, explain:"The organization's case for support underlies proposal narratives just as it underlies major-gift pitches and campaign materials."},
      {domain:"Crafting, constructing, and submitting", q:"What is the primary purpose of a budget narrative within a grant application?", options:["To list every staff member's home address","To justify the requested costs against the activities and value described in the proposal","To replace the need for a logic model","To satisfy formatting requirements only"], correct:1, explain:"The budget narrative explains and justifies costs in direct relation to the proposed activities, connecting dollars to the plan."},
      {domain:"Crafting, constructing, and submitting", q:"Why does formatting compliance matter on a grant application even when the underlying content is strong?", options:["Formatting never actually matters if content is strong","Some funders reject or deduct points for noncompliance regardless of content quality","Formatting only matters for online submissions","Formatting compliance is optional at the applicant's discretion"], correct:1, explain:"Funders often enforce formatting rules strictly; noncompliance can hurt or disqualify an otherwise strong application."},
      {domain:"Crafting, constructing, and submitting", q:"What is the main purpose of a strong \"need statement\" section within a grant proposal?", options:["To list the organization's board members","To establish why the problem matters and why it's urgent, setting up the case for funding","To describe the budget in detail","To thank the funder for past support"], correct:1, explain:"The need statement builds the urgency and rationale the rest of the proposal, including the ask, depends on."},
      {domain:"Crafting, constructing, and submitting", q:"A technically excellent grant proposal is submitted two hours after a funder's hard deadline. What is the typical outcome?", options:["It's reviewed normally since quality matters more than timing","It's typically rejected outright, regardless of quality, since deadlines are strictly enforced","The funder always grants a grace period","It's automatically funded due to the quality of the content"], correct:1, explain:"Grant deadlines are usually enforced strictly; even a strong proposal is normally rejected if submitted late."},
      {domain:"Crafting, constructing, and submitting", q:"An LOI is typically used at what point in the funder relationship, relative to a full proposal?", options:["After the full proposal has already been funded","Before a full proposal, to gauge funder interest and screen fit","Only after a grant has been awarded, as a report","It replaces the need for any full proposal"], correct:1, explain:"An LOI is a preliminary, shorter pitch used to screen interest and fit before a funder invites the longer, full proposal."},
      {domain:"Researching, identifying, and matching", q:"\"Researching, identifying, and matching funding resources\" is weighted on the GPC exam at:", options:["9%","18%","23%","7%"], correct:1, explain:"This knowledge area is weighted 18%, the second-largest of the eight."},
      {domain:"Researching, identifying, and matching", q:"Matching a prospective funder to an organization's mission primarily requires researching:", options:["Only the topic keywords in a funder's name","A funder's actual giving history and stated priorities, not just topical overlap","The funder's office address","The funder's social media follower count"], correct:1, explain:"Real matching requires understanding a funder's documented giving history and priorities, not surface-level keyword matching."},
      {domain:"Researching, identifying, and matching", q:"How can Form 990 filings be useful specifically in researching a prospective foundation funder?", options:["990s aren't available for foundations","A foundation's own 990-PF reveals its actual giving history, grant sizes, and past grantees","990s only cover individual donors, never foundations","990s are only relevant to post-award compliance"], correct:1, explain:"Foundation 990-PFs are public and show real giving patterns, useful in researching whether a prospective funder is actually a good match."},
      {domain:"Researching, identifying, and matching", q:"Why are DAF-sourced gifts a distinct research challenge compared to identifying a direct foundation funder?", options:["DAF grants are always anonymous and untraceable by definition","The nonprofit typically only sees the sponsor's name on the grant letter, not the individual donor behind it, unless disclosed","DAF grants can't be researched at all, even after receipt","DAFs never fund the same causes twice"], correct:1, explain:"Like in individual fundraising, a DAF grant letter names the sponsor, not necessarily the donor, complicating funder research."},
      {domain:"Researching, identifying, and matching", q:"What is a key practice for researching new prospective funders?", options:["Applying to every funder in a general directory regardless of fit","Reviewing a funder's published guidelines and its list of past grantees before applying","Only researching funders who have never funded similar organizations","Skipping research and relying on cold outreach only"], correct:1, explain:"Reviewing published guidelines and past grantee lists is the standard way to gauge real fit before investing proposal-writing time."},
      {domain:"Researching, identifying, and matching", q:"Why does matching resources to an organization's actual mission matter before applying?", options:["It doesn't matter, any funder is worth applying to","Poor mission fit wastes proposal-writing effort and lowers the organization's overall win rate","Mission fit only matters for government grants","Funders never check for mission alignment"], correct:1, explain:"Time spent writing proposals to poorly-aligned funders is time not spent on higher-probability matches, hurting overall grant-seeking efficiency."},
      {domain:"Researching, identifying, and matching", q:"Reviewing an RFP's eligibility criteria before writing a word of the proposal primarily serves what purpose?", options:["It's a formality with no real impact on the outcome","Screening whether the organization even qualifies before investing time in a full proposal","It's only relevant after the proposal is submitted","It replaces the need for a needs statement"], correct:1, explain:"Confirming eligibility upfront prevents wasted effort on proposals the organization was never actually eligible to submit."},
      {domain:"Researching, identifying, and matching", q:"What distinguishes a \"warm\" funder relationship from a \"cold\" prospect in grant research terms?", options:["Warm funders only give to religious organizations","A warm relationship has prior giving history or an existing contact; a cold prospect has neither","There is no meaningful difference","Cold prospects always give larger grants"], correct:1, explain:"A track record or existing relationship (warm) versus no prior contact (cold) meaningfully changes both strategy and likely success."},
      {domain:"Researching, identifying, and matching", q:"A grant professional builds a target list of 30 prospective funders before writing a single proposal. What research step should happen before adding a funder to that list?", options:["Confirming mission and program alignment with the funder's actual giving history and guidelines","Confirming the funder's office is within driving distance","Confirming the funder has a social media account","None, any funder can be added regardless of fit"], correct:0, explain:"Real alignment with a funder's documented priorities, not proximity or social presence, is what should qualify a funder for the target list."},
      {domain:"Researching, identifying, and matching", q:"Which resource would be most useful for researching a private foundation's historical grant sizes and past grantees?", options:["The foundation's own Form 990-PF filing","The applicant organization's own Form 990","A general internet search with no specific source","The applicant's own donor database"], correct:0, explain:"A foundation's 990-PF is the public filing that actually documents its historical grants and grantees, the applicant's own filings won't show that."},
      {domain:"Program and project design", q:"\"Strategies for effective program and project design\" is weighted on the GPC exam at:", options:["9%","17%","23%","10%"], correct:1, explain:"Program and project design carries 17% weight, the third-largest knowledge area."},
      {domain:"Program and project design", q:"A logic model used in grant-funded program design primarily maps:", options:["Board member responsibilities","Activities and inputs to measurable outcomes","The organization's annual budget line by line","Donor names to gift amounts"], correct:1, explain:"A logic model links what a program does (activities/outputs) to the change it's meant to produce (outcomes)."},
      {domain:"Program and project design", q:"A strong program-design section of a grant proposal must typically demonstrate:", options:["That the program has existed for at least 10 years","Clear, measurable outcomes tied to the funder's own stated priorities","That the organization has no other funding sources","A guarantee of 100% program success"], correct:1, explain:"Funders look for outcomes that are both measurable and aligned with their own funding priorities, not just activity descriptions."},
      {domain:"Program and project design", q:"Why do evaluation plans matter within grant-funded program design?", options:["Funders never actually read evaluation plans","Funders want evidence that effectiveness will be measured, not just that services will be delivered","Evaluation plans are only required for multi-year grants","They replace the need for a logic model"], correct:1, explain:"An evaluation plan shows a funder how success will actually be measured, not just described after the fact."},
      {domain:"Program and project design", q:"\"Sustainability planning\" within a grant proposal's program design refers to:", options:["How long the proposal document itself takes to write","What happens to the program after the specific grant funding period ends","The environmental impact of the program","How quickly the grant funds will be spent"], correct:1, explain:"Sustainability planning addresses the program's continuation beyond the grant period, a common funder concern."},
      {domain:"Program and project design", q:"In logic-model terms, what's the difference between an \"output\" and an \"outcome\"?", options:["They are interchangeable terms with no real difference","Outputs are what a program does or produces; outcomes are the resulting change in participants or conditions","Outputs only apply to federal grants","Outcomes are always measured in dollars"], correct:1, explain:"Outputs are the direct products of activity (e.g., 200 workshops held); outcomes are the actual change that results (e.g., improved employment rates)."},
      {domain:"Program and project design", q:"A logic model links which two core elements together?", options:["Board bylaws and staff job descriptions","Activities and measurable outcomes","Donor names and gift amounts","Funder deadlines and submission portals"], correct:1, explain:"The core function of a logic model is connecting what a program does to the measurable change it produces."},
      {domain:"Program and project design", q:"A program design section proposes an activity with no stated connection to a measurable outcome. What's the most likely funder reaction?", options:["No concern, activities alone are sufficient","Concern that the design doesn't clearly show how the activity leads to meaningful, measurable change","Automatic funding, since activities are all that matters","A request to remove the outcomes section entirely"], correct:1, explain:"Funders expect activities to connect logically to measurable outcomes; an unconnected activity reads as weak program design."},
      {domain:"Program and project design", q:"What is the purpose of specifying target numbers (for example, \"200 participants will complete the program\") within a program design section?", options:["To make measurable, verifiable claims the evaluation plan can later assess","To pad the proposal's length","It's not necessary if the narrative sounds compelling","To satisfy formatting requirements only"], correct:0, explain:"Concrete, numeric targets give the evaluation plan something specific and verifiable to actually measure against."},
      {domain:"Program and project design", q:"Why would a funder want to see a sustainability plan even for a one-year pilot grant?", options:["They don't, sustainability is irrelevant to a pilot","To understand whether promising results could continue beyond that single funded year","Sustainability plans are only required for multi-year grants","Because it's a formatting requirement in every RFP"], correct:1, explain:"Funders often want to see a path forward beyond a single pilot year, even when the grant itself is short-term."},
      {domain:"Post-award grant management", q:"\"Post-award grant management practices,\" one of the GPC knowledge areas, refers primarily to:", options:["Writing the original LOI","Compliance, reporting, and stewardship after a grant is awarded","Researching new funding prospects","Formatting the final proposal document"], correct:1, explain:"Post-award management covers what happens after the check clears, compliance, reporting to the funder, and stewarding that relationship."},
      {domain:"Post-award grant management", q:"What risk does submitting a required grant report late typically create?", options:["No risk at all, funders rarely notice late reports","Damage to the funder relationship and possible ineligibility for future funding","An automatic increase in the next grant amount","It only affects federal grants, not private foundations"], correct:1, explain:"Late reporting is one of the fastest ways to damage a funder relationship and jeopardize future funding eligibility."},
      {domain:"Post-award grant management", q:"Post-award financial compliance on a grant often includes tracking:", options:["The organization's unrelated fundraising events","Restricted-fund spending against the specific approved budget","The personal finances of program participants","Only the executive director's salary"], correct:1, explain:"Grant funds are typically restricted; compliance means tracking actual spending against the approved, specific budget."},
      {domain:"Post-award grant management", q:"A \"grant amendment\" is typically used for:", options:["Formally requesting a change to a grant's scope, budget, or timeline after it's been awarded","Writing the original LOI","Submitting the initial application","Ending the funder relationship entirely"], correct:0, explain:"A grant amendment is the formal mechanism for requesting a change to an already-awarded grant's terms."},
      {domain:"Post-award grant management", q:"A grantee organization spends restricted grant funds on an expense outside the approved budget without funder approval. What risk does this create?", options:["None, as long as the money was spent on mission-related activity","Compliance risk and potential damage to the funder relationship, since restricted funds must track the approved budget","It automatically triggers a larger next-year grant","It has no bearing on future eligibility"], correct:1, explain:"Spending outside an approved budget without prior funder approval is a compliance breach, regardless of mission intent."},
      {domain:"Post-award grant management", q:"What is the primary purpose of an interim grant report, submitted partway through a grant period?", options:["To formally end the grant early","To update the funder on progress and flag any needed adjustments before the final report","To request an entirely new grant","It's optional and rarely required"], correct:1, explain:"Interim reports keep the funder informed of real progress and surface issues early, rather than waiting until the final report."},
      {domain:"Post-award grant management", q:"A program falls short of a stated output target mid-grant. What's the recommended post-award management practice?", options:["Wait silently and hope the funder doesn't notice","Communicate proactively with the funder about the shortfall and any corrective plan","Falsify the next report to show the target was met","Return all grant funds immediately regardless of partial progress"], correct:1, explain:"Proactive, honest communication about a shortfall protects the funder relationship far better than silence or misrepresentation."},
      {domain:"Post-award grant management", q:"Who within an organization is typically responsible for post-award financial compliance tracking?", options:["Only the original grant writer, with no other involvement","A cross-functional effort, often involving finance/accounting staff alongside the grant professional","Only the executive director personally","No one, funders track this themselves"], correct:1, explain:"Post-award compliance is usually a shared responsibility between the grant professional and finance/accounting staff, not one person alone."},
      {domain:"Post-award grant management", q:"Why does post-award grant management matter for an organization's ability to win future grants from the same funder?", options:["It doesn't affect future funding decisions at all","Funders often weigh past compliance and reporting quality when considering renewal or new funding","Only the original proposal quality matters for renewals","Post-award performance is confidential and never reviewed by funders"], correct:1, explain:"Funders routinely factor a grantee's track record of compliance and reporting quality into renewal and future funding decisions."},
      {domain:"Post-award grant management", q:"A grant-funded program is closing out its final year. What is the standard purpose of a closeout or final report, beyond describing final results?", options:["To reconcile actual spending against the approved budget and formally close the grant's compliance record","To request an unrelated new grant from the same funder","To dispute the original award amount","To transfer the grant to a different organization"], correct:0, explain:"A closeout report reconciles final spending against the approved budget and formally closes out the grant's compliance obligations."},
      {domain:"Ethical practices standards", q:"\"Ethical practices standards\" is weighted on the GPC exam at:", options:["6%","10%","18%","23%"], correct:1, explain:"Ethical practices standards is weighted 10%, tied with Post-award grant management."},
      {domain:"Ethical practices standards", q:"When is a conflict-of-interest disclosure required in grant seeking?", options:["Never, conflicts of interest don't apply to grant writing","Whenever a grant professional or organizational leader has a personal stake in a funding decision","Only for grants over $1 million","Only when the funder specifically asks"], correct:1, explain:"Ethical practice requires disclosing personal stakes in funding decisions, regardless of grant size, as a standard professional obligation."},
      {domain:"Ethical practices standards", q:"Compensating a grant writer with a percentage of the award amount is generally viewed by the field as:", options:["Standard, widely encouraged practice","An ethics concern, similar to commission-based compensation in individual fundraising","Required by most funders","Only a problem for federal grants"], correct:1, explain:"Percentage-based compensation on award size raises the same conflict-of-interest concerns as commission pay in fundraising more broadly."},
      {domain:"Ethical practices standards", q:"What is the ethical standard for representing program outcomes to a funder in a report?", options:["Round outcomes up whenever it strengthens the funder relationship","Report accurately, never inflate or misrepresent actual results","Only report positive outcomes, omit anything negative","Reporting accuracy only matters for the final report"], correct:1, explain:"Accurate reporting, including shortfalls, is the ethical standard, not selectively reporting only favorable results."},
      {domain:"Ethical practices standards", q:"Using another organization's proposal language without adaptation or permission is best described as:", options:["A common, acceptable time-saving practice","An ethics violation","Required practice when facing a tight deadline","Only a concern if the funder finds out"], correct:1, explain:"Using another org's proposal content without adaptation or permission is a professional ethics violation, deadline pressure notwithstanding."},
      {domain:"Ethical practices standards", q:"A grant professional is asked by leadership to overstate program outcomes in a report to secure continued funding. What is the ethical response?", options:["Comply, since securing funding benefits the mission","Decline and report accurately, raising the concern with leadership","Comply only if the funder is unlikely to verify","Resign without raising the issue"], correct:1, explain:"The ethical response is accurate reporting plus raising the concern internally, not silent compliance or silent departure."},
      {domain:"Ethical practices standards", q:"Is it ethical for a grant professional to apply to a funder whose values conflict significantly with the organization's mission, simply because funding is available?", options:["Yes, any available funding should be pursued regardless of fit","This raises an ethical mission-alignment concern worth weighing carefully before applying","Ethics only apply to how funds are spent, not which funders are approached","Only the funder's ethics matter, not the applicant's"], correct:1, explain:"Mission-alignment is itself an ethical consideration in grant seeking, not just a strategic one."},
      {domain:"Ethical practices standards", q:"What does \"ethical practices standards\" most directly govern in the context of grant seeking?", options:["How grant professionals conduct themselves and represent their organizations throughout the entire grant lifecycle","Only the formatting of the final proposal","Only the budget narrative's accuracy","Only interactions after a grant is awarded"], correct:0, explain:"Ethical practices standards span the full grant lifecycle, research, writing, submission, and post-award, not any single phase."},
      {domain:"Ethical practices standards", q:"A grant professional discovers a colleague reused another organization's proposal language without adaptation. What is the appropriate next step?", options:["Ignore it since the proposal was successful","Address it as a professional ethics concern, since unadapted reuse of others' language is a violation","Report it only if the funder notices","Adopt the same practice since it saves time"], correct:1, explain:"Recognizing and addressing the ethics violation is the appropriate response, regardless of whether the funder ever notices."},
      {domain:"Ethical practices standards", q:"Why do most grant-seeking ethics codes discourage percentage-based compensation tied to award size?", options:["It's not actually discouraged","It creates a conflict of interest that can pressure inflated claims or inappropriate funder targeting","It's discouraged only for federal grants","It has no relationship to conflicts of interest"], correct:1, explain:"Percentage-based pay creates financial incentives that can distort judgment about which funders to pursue or how results get represented."},
      {domain:"Organizational development", q:"\"Organizational development for grant seeking\" is weighted on the GPC exam at:", options:["6%","9%","17%","23%"], correct:1, explain:"Organizational development for grant seeking is weighted 9% of the exam."},
      {domain:"Organizational development", q:"\"Organizational development for grant seeking\" primarily refers to building:", options:["A funder's own internal systems","An organization's internal readiness, systems, and staff capacity to pursue and manage grants well","A donor's personal financial plan","A logic model for a single project"], correct:1, explain:"This knowledge area is about the organization's own grant-readiness infrastructure, not any single application or funder."},
      {domain:"Organizational development", q:"A \"grants calendar\" tool primarily helps an organization:", options:["Track deadlines and application cycles across multiple funders","Replace the need for a case for support","Calculate the cost to raise a dollar","File the organization's Form 990"], correct:0, explain:"A grants calendar keeps multiple funder deadlines and cycles organized across a busy grant-seeking operation."},
      {domain:"Organizational development", q:"Building organizational grant-readiness typically includes having which two things in place before applying broadly?", options:["A celebrity spokesperson and a large marketing budget","Audited financials and a clear, ready case for support","A dedicated grant-writing consultant on permanent retainer","A five-year lease on office space"], correct:1, explain:"Audited financials and a ready case for support are foundational readiness elements many funders expect to see."},
      {domain:"Organizational development", q:"Which of the following best reflects strong organizational grant-readiness?", options:["A single staff member with informal knowledge and no documentation","Audited financials, a ready case for support, and clear internal systems for tracking deadlines and compliance","A logo and website alone","No formal systems, relying on grant writer memory"], correct:1, explain:"Documented systems and financial readiness, not one person's informal knowledge, is what real organizational grant-readiness looks like."},
      {domain:"Organizational development", q:"Why might an organization invest in grant-management software as part of organizational development for grant seeking?", options:["It has no real benefit","It helps track deadlines, reporting requirements, and compliance across many simultaneous grants","It replaces the need for a case for support","It's only useful for federal grants"], correct:1, explain:"Grant-management software supports the organizational infrastructure needed to juggle multiple funders and reporting cycles reliably."},
      {domain:"Organizational development", q:"What organizational capacity gap most commonly undermines an otherwise strong grant program?", options:["Too many staff dedicated to grants","Weak internal systems for tracking post-award compliance and reporting deadlines","Too much funder diversity","An overly detailed case for support"], correct:1, explain:"Weak post-award tracking systems are a common organizational-development gap, even at organizations that write strong proposals."},
      {domain:"Organizational development", q:"Building internal grant-seeking capacity typically includes training which staff, beyond the dedicated grant professional?", options:["No one else needs any grants knowledge","Program and finance staff who contribute content and manage compliance","Only the board chair","Only volunteers, never paid staff"], correct:1, explain:"Program staff often supply content and finance staff manage compliance, both need some grants literacy beyond the dedicated grant professional."},
      {domain:"Organizational development", q:"Why does organizational development for grant seeking matter even for organizations that already win grants regularly?", options:["It doesn't, success alone is sufficient","Sustained success still depends on systems and capacity that can break down without ongoing investment","Winning grants eliminates the need for further development","It's only relevant to brand-new organizations"], correct:1, explain:"Even a successful grants program depends on systems and capacity that need ongoing investment to stay reliable at scale."},
      {domain:"Organizational development", q:"A grants calendar, audited financials, and a documented case for support are all examples of:", options:["Post-award compliance tools only","Organizational grant-readiness infrastructure","Requirements found only in federal RFPs","Tools with no bearing on funder confidence"], correct:1, explain:"Together these represent the organizational infrastructure that signals grant-readiness to funders, not just post-award tools."},
      {domain:"Cultivating funder relationships", q:"\"Cultivating funder relationships\" is weighted on the GPC exam at:", options:["6%","7%","10%","18%"], correct:1, explain:"Cultivating funder relationships is weighted 7% of the exam, the second-smallest knowledge area."},
      {domain:"Cultivating funder relationships", q:"A site visit from a program officer is best treated by a grant professional as:", options:["Purely a compliance check with no relationship value","A relationship-cultivation opportunity, not just a compliance formality","An event to avoid scheduling if possible","Irrelevant to future funding decisions"], correct:1, explain:"Site visits are a real chance to build the funder relationship, not just satisfy a compliance requirement."},
      {domain:"Cultivating funder relationships", q:"Why do sustained funder relationships matter beyond a single grant cycle?", options:["They don't, each grant cycle is entirely independent","Renewed or repeat funding often depends on the relationship, not just prior results alone","Funders are legally required to renew every grant","Relationship-building is only relevant to individual donors, not funders"], correct:1, explain:"Ongoing funder relationships often influence renewal decisions as much as, or more than, results alone."},
      {domain:"Cultivating funder relationships", q:"Sending a funder a thank-you note or impact update outside of any formally required report is an example of:", options:["Wasted effort with no strategic value","Proactive funder cultivation and stewardship","A violation of grant reporting rules","Only appropriate for individual donors, never institutional funders"], correct:1, explain:"Unprompted, non-required communication is a classic funder-cultivation practice that builds relationship equity over time."},
      {domain:"Cultivating funder relationships", q:"How does cultivating a funder relationship differ from cultivating an individual major donor relationship?", options:["They're identical, no meaningful difference","Both involve building trust and communication over time, though funder cultivation often involves program officers and formal touchpoints like site visits","Funder relationships require no communication between grant cycles","Individual donors can never be cultivated the same way as funders"], correct:1, explain:"Both are relationship-building, but funder cultivation typically runs through program officers and more formal, institutional touchpoints."},
      {domain:"Cultivating funder relationships", q:"What's a low-cost, high-value funder cultivation practice many grant professionals underuse?", options:["Sending unsolicited, non-required project updates that show genuine progress","Only communicating during the formal reporting window","Sending gifts to program officers","Avoiding contact between grant cycles to not seem needy"], correct:0, explain:"A simple, unprompted progress update between required touchpoints costs little and builds real relationship equity."},
      {domain:"Cultivating funder relationships", q:"Why might a grant professional invite a program officer to visit a program site outside of a required, formal site visit?", options:["It's not allowed outside formal visits","To build a stronger, more personal relationship and deepen the funder's understanding of the work","To avoid a formal report requirement","It has no cultivation value"], correct:1, explain:"An informal visit deepens the funder's firsthand understanding of the work and strengthens the relationship beyond compliance requirements."},
      {domain:"Cultivating funder relationships", q:"A funder relationship cultivated well over several grant cycles often results in:", options:["No measurable difference in outcomes","Greater trust, more candid communication, and sometimes more flexible funding conversations","A legal obligation for the funder to keep funding","Reduced reporting requirements automatically"], correct:1, explain:"Well-cultivated funder relationships tend to build trust and openness that can shape future, sometimes more flexible, funding conversations."},
      {domain:"Cultivating funder relationships", q:"What risk does a purely transactional (apply, report, repeat) approach to funder relationships create?", options:["No risk, it's the most efficient approach","Missed opportunities to build the trust that supports renewal, flexibility, or larger future funding","It guarantees renewal every time","It's required by most funders"], correct:1, explain:"A purely transactional approach forgoes the relationship equity that often supports renewal and larger future funding."},
      {domain:"Cultivating funder relationships", q:"Which of these is an example of proactive funder cultivation, rather than required grant administration?", options:["Submitting the final report by its deadline","Sharing a relevant news story or success unprompted between required touchpoints","Signing the grant agreement","Submitting the original LOI"], correct:1, explain:"Sharing something unprompted and outside required deliverables is proactive cultivation; the other options are administrative requirements."},
      {domain:"Professionalism advancement", q:"\"Professionalism advancement practices\" is weighted on the GPC exam at:", options:["6%","9%","10%","17%"], correct:0, explain:"At 6%, this is the smallest of the eight multiple-choice knowledge areas."},
      {domain:"Professionalism advancement", q:"Continuing education for a certified GPC holder primarily supports:", options:["Nothing, GPC has no continuing-education component","Staying current in grants practice and satisfying recertification requirements","Replacing the need for the original exam entirely","Only satisfying employer HR requirements"], correct:1, explain:"Continuing education keeps a GPC holder current in the field and contributes toward the 5-year recertification cycle."},
      {domain:"Professionalism advancement", q:"Mentoring newer grant professionals is best classified under which GPC knowledge area?", options:["Post-award grant management practices","Professionalism advancement practices","Ethical practices standards","Researching, identifying, and matching funding resources"], correct:1, explain:"Mentoring and field-building activities fall under professionalism advancement practices."},
      {domain:"Professionalism advancement", q:"Presenting at a grant professionals' conference on a successful program strategy is an example of:", options:["Post-award management","Professionalism advancement practice","Ethical practices standards","Cultivating funder relationships"], correct:1, explain:"Contributing knowledge back to the field through presentations is a professionalism advancement practice."},
      {domain:"Professionalism advancement", q:"Why does GPCI include \"professionalism advancement\" as a distinct knowledge area, even though it's the smallest weighted domain?", options:["It reflects the field's expectation that certified professionals contribute to advancing the profession itself, not just individual proposals","It's a placeholder domain with no real content","It only applies to GPCI board members","It duplicates the ethics domain entirely"], correct:0, explain:"GPCI frames certified professionals as stewards of the field itself, not just producers of individual proposals, hence this distinct domain."},
      {domain:"Professionalism advancement", q:"Publishing an article or resource that helps other grant professionals do their jobs better falls under:", options:["Post-award grant management","Professionalism advancement practices","Researching and matching funding resources","Program design"], correct:1, explain:"Contributing resources that help the broader field falls squarely under professionalism advancement."},
      {domain:"Professionalism advancement", q:"Serving on a GPCI committee or a local grant professionals' association board is an example of:", options:["Organizational development for grant seeking","Professionalism advancement practices","Crafting grant applications","Ethical practices standards"], correct:1, explain:"Field-level service and leadership roles are a professionalism advancement practice, not an organizational-development one."},
      {domain:"Professionalism advancement", q:"What is one way a GPC holder can demonstrate professionalism advancement beyond their own organization's grant work?", options:["Declining to engage with the broader field","Mentoring, presenting, or contributing to the field's shared body of knowledge","Focusing exclusively on internal compliance","Avoiding continuing education entirely"], correct:1, explain:"Professionalism advancement is specifically about contributing to the field beyond one's own organization's immediate grant work."},
      {domain:"Professionalism advancement", q:"Why might active participation in the grant professionals' field (mentoring, presenting, volunteering) also indirectly support a grant professional's own career?", options:["It has no career benefit","It builds visibility, credibility, and a professional network within the field","It's required for the GPC exam itself to be waived","It replaces the need for continuing education credits"], correct:1, explain:"Field visibility and network-building are real career benefits of professionalism advancement activity, even though that's not their primary purpose."},
      {domain:"Professionalism advancement", q:"A newly certified GPC holder takes on a mentee who is preparing their own eligibility packet. This best reflects which knowledge area?", options:["Cultivating funder relationships","Professionalism advancement practices","Post-award grant management","Researching and matching funding resources"], correct:1, explain:"Mentoring a rising grant professional is a direct example of professionalism advancement practice."}
,
      {domain:"Crafting, constructing, and submitting", q:"A well-structured grant narrative typically follows an order such as: statement of need, goals and objectives, methods, evaluation plan, then budget. The primary purpose of this consistent structure is to:", options:["Make the proposal longer to seem more thorough","Let reviewers efficiently follow the logic from problem to solution to accountability, since they read many proposals under time pressure","Satisfy a copyright requirement","Replace the need for a cover letter"], correct:1, explain:"A predictable structure helps time-pressed reviewers follow the logical thread from problem through solution to accountability, without hunting for information."},
      {domain:"Crafting, constructing, and submitting", q:"Objectives written using the SMART framework, Specific, Measurable, Achievable, Relevant, Time-bound, are valued in grant writing primarily because they:", options:["Sound more impressive to funders regardless of content","Give reviewers and the organization itself a concrete, verifiable way to know whether the program succeeded","Are required by federal law for every grant application","Replace the need for a full evaluation plan"], correct:1, explain:"SMART objectives create concrete, checkable benchmarks, useful to both the funder assessing the proposal and the organization later assessing its own results."},
      {domain:"Crafting, constructing, and submitting", q:"An organizational background or 'boilerplate' section within a proposal primarily serves to:", options:["Pad the page count","Establish the applicant's credibility and track record to carry out the proposed work","Replace the need for a case for support","List every staff member's personal biography in detail"], correct:1, explain:"The organizational background section builds funder confidence that this particular applicant is credible and capable of delivering on what's proposed."},
      {domain:"Crafting, constructing, and submitting", q:"Why is it important that a proposal's budget narrative closely match the activities described in the program narrative?", options:["It isn't important, as long as the total dollar amount is correct","Inconsistency between the narrative and budget raises credibility concerns and can suggest the proposal wasn't carefully prepared","Funders never actually compare the two sections","Budget narratives are optional if the program narrative is strong"], correct:1, explain:"A budget that doesn't match the described activities is a red flag to reviewers, suggesting sloppy preparation or an inflated ask, and undermines the proposal's credibility."},
      {domain:"Crafting, constructing, and submitting", q:"A grant application requires uploading materials through an online portal in a specific file format by a stated deadline. A common, avoidable submission mistake is:", options:["Submitting well before the deadline","Formatting and technical errors, such as wrong file types or last-minute upload failures, that can disqualify an otherwise strong proposal","Including a case for support","Writing a clear need statement"], correct:1, explain:"Technical and formatting mistakes, especially last-minute portal or file-format issues, are a common and entirely avoidable way a strong proposal gets disqualified."},
      {domain:"Crafting, constructing, and submitting", q:"Having a colleague unfamiliar with the project review a draft proposal before submission primarily helps catch:", options:["Nothing useful; only the original author can effectively review their own work","Gaps in clarity or logic that the original writer, too close to the material, might miss","Formatting requirements, which colleagues cannot evaluate","Whether the budget totals are mathematically correct only"], correct:1, explain:"A fresh reader unfamiliar with the project is well positioned to catch confusing logic or unclear explanations the original writer may no longer notice."},
      {domain:"Crafting, constructing, and submitting", q:"A funder's scoring rubric explicitly weights 'evaluation plan' at 20% of the total score. A well-prepared applicant should:", options:["Ignore the rubric and focus only on the narrative they find most interesting","Make sure the evaluation plan is addressed thoroughly, proportional to how heavily it's actually weighted in scoring","Submit the same evaluation plan used for every other funder regardless of format","Assume the rubric is only a formality with no real bearing on scoring"], correct:1, explain:"Addressing a published scoring rubric proportionally, and thoroughly, on its heavily weighted sections is a direct, evidence-based way to strengthen a proposal's competitiveness."},
      {domain:"Crafting, constructing, and submitting", q:"Reusing the same core proposal narrative for multiple funders, while tailoring specific details to each funder's stated priorities, reflects:", options:["An unethical practice that should be avoided entirely","An efficient, common practice, as long as each version is actually tailored rather than a generic cut-and-paste with the funder's name swapped in","A guarantee of funding from every funder approached","A practice explicitly prohibited by GPCI's ethics standards"], correct:1, explain:"Reusing and adapting core content efficiently is standard practice; the key distinction is real tailoring to each funder's priorities, not a lazy, untailored copy-paste."},
      {domain:"Crafting, constructing, and submitting", q:"An executive summary at the front of a lengthy grant proposal is primarily intended to:", options:["Replace the need for the rest of the proposal","Give a time-pressed reviewer a concise, accurate overview of the request before they read the full detail","Repeat the budget narrative in full","List every citation used in the proposal"], correct:1, explain:"A concise, accurate executive summary orients a busy reviewer to the core request before they dive into the full supporting detail."},
      {domain:"Crafting, constructing, and submitting", q:"A funder's guidelines list required attachments including an IRS determination letter, audited financials, and letters of support. Omitting even one of these typically:", options:["Has no consequence as long as the narrative is strong","Risks the application being deemed incomplete or ineligible, regardless of narrative quality","Only matters for federal grants, never for private foundations","Is acceptable as long as it's explained in a cover letter"], correct:1, explain:"Required attachments are typically non-negotiable compliance items; omitting one risks the whole application being deemed incomplete, independent of narrative strength."},
      {domain:"Researching, identifying, and matching", q:"Candid's Foundation Directory Online, or a similar funder-research database, is primarily used by grant professionals to:", options:["File a nonprofit's own Form 990","Search and identify foundations by giving history, focus area, and geography to build a prospective funder list","Submit grant applications directly","Track post-award compliance spending"], correct:1, explain:"Funder-research databases like Foundation Directory Online exist specifically to help identify and screen prospective funders by their actual giving patterns and priorities."},
      {domain:"Researching, identifying, and matching", q:"Before drafting a proposal, reviewing a funder's own published guidelines and priorities directly, rather than relying only on secondhand summaries, is important because:", options:["Secondhand summaries are always more accurate","Funder guidelines can be nuanced or change, and a primary-source read reduces the risk of misreading eligibility or priorities","Direct guidelines are only available to previous grantees","It has no bearing on the eventual proposal content"], correct:1, explain:"Reading a funder's own current guidelines directly avoids relying on outdated or oversimplified secondhand summaries that could misstate eligibility or priorities."},
      {domain:"Researching, identifying, and matching", q:"A funder's past 990-PF filings show a typical award range of $5,000 to $15,000 per grant. A grant professional preparing a request for $150,000 from this funder should:", options:["Submit the $150,000 request anyway, since asking big is always the better strategy","Reconsider the request amount, or the funder itself, since it falls well outside this funder's documented typical range","Assume the 990-PF data is unreliable and irrelevant","Ask for exactly ten times the funder's average award"], correct:1, explain:"Researching a funder's typical award range before asking helps calibrate a realistic, well-matched request, rather than one wildly outside what that funder actually tends to give."},
      {domain:"Researching, identifying, and matching", q:"Compared to private foundation research, researching a corporate giving program typically also involves looking at:", options:["Only the same 990-PF filings used for foundations","The company's broader business priorities, community footprint, and any employee-engagement or sponsorship angle tied to its giving","Nothing different; the research approach is identical","Only the CEO's personal charitable interests"], correct:1, explain:"Corporate giving is often tied to business priorities, brand, and community presence, so research usefully looks beyond pure financial filings into those business connections."},
      {domain:"Researching, identifying, and matching", q:"A grant professional builds an early, informal relationship with a funder's program officer well before submitting a proposal. This is best understood as:", options:["An inappropriate attempt to bypass the formal review process","A legitimate research and relationship-building practice that can clarify fit and priorities ahead of a formal application","Prohibited under GPCI ethics standards","Only appropriate for government grants"], correct:1, explain:"Early, appropriate contact with a program officer is a legitimate way to clarify genuine fit and priorities, not an attempt to circumvent the formal process."},
      {domain:"Researching, identifying, and matching", q:"'Fit' between an organization and a prospective funder involves more than shared mission area; it should also account for:", options:["Nothing else; mission alignment alone is sufficient","Practical factors like geographic restrictions, funding cycle timing, and typical award size relative to the request","Only the funder's total asset size","The personal preferences of the grant writer"], correct:1, explain:"True fit includes practical realities, geography, timing, and award size, not just a shared topical mission area, since misalignment on any of these can sink an otherwise good match."},
      {domain:"Researching, identifying, and matching", q:"Government grant opportunities, such as those posted on a national or state grants portal, differ from private foundation research mainly in that they:", options:["Never have eligibility restrictions","Typically involve formal, published solicitations, like an RFP or NOFO, with detailed, binding eligibility and compliance requirements","Require no research at all before applying","Are always easier to win than foundation grants"], correct:1, explain:"Government funding opportunities are typically published as formal solicitations with detailed, binding eligibility and compliance requirements, a more structured process than most foundation research."},
      {domain:"Researching, identifying, and matching", q:"Reviewing a funder's board of directors for members with a personal or professional connection to the applicant organization is a research practice aimed at:", options:["Identifying warm-introduction pathways that might strengthen the funder relationship","Determining the funder's tax status","Verifying the funder's 501(c)(3) determination letter","Calculating the funder's typical award size"], correct:0, explain:"Board-member research can surface a warm connection, someone who already knows the organization, that might open a stronger introduction than a cold application alone."},
      {domain:"Researching, identifying, and matching", q:"Using an organization's own strategic plan to help decide which funders to pursue reflects which research principle?", options:["Funder research should start from the funder's priorities alone, ignoring the organization's own direction","Fit works both ways; the organization's own strategic priorities should also guide which funding opportunities are actually worth pursuing","Strategic plans are irrelevant to grant-seeking research","Only funders' priorities matter in identifying opportunities"], correct:1, explain:"Good matching research runs both directions: it's not just what a funder wants, but whether pursuing that funder actually serves the organization's own strategic direction."},
      {domain:"Researching, identifying, and matching", q:"A grant professional discovers a promising funder whose guidelines specify grants only to organizations within a particular state or county. If the applicant organization operates outside that area, this eligibility detail should:", options:["Be ignored, since program quality matters more than geography","Be treated as a disqualifying factor, ruling out that funder regardless of how strong the program fit otherwise is","Only matter for government grants, not foundations","Be resolved by contacting the funder to request an exception, which is generally granted"], correct:1, explain:"A hard geographic eligibility restriction is generally a disqualifying factor, no matter how strong the mission fit, and should be caught early in research rather than after drafting a proposal."},
      {domain:"Program and project design", q:"A theory of change differs from a logic model mainly in that it:", options:["Is identical to a logic model, just a different name","Articulates the broader, often narrative rationale for why a set of activities should lead to long-term change, while a logic model maps the specific inputs, activities, outputs, and outcomes","Only applies to government grants","Replaces the need for a logic model entirely"], correct:1, explain:"A theory of change explains the broader underlying rationale for why change should happen; a logic model then maps that rationale into specific inputs, activities, outputs, and outcomes."},
      {domain:"Program and project design", q:"Grounding a proposed program design in a documented community needs assessment primarily helps demonstrate:", options:["That the applicant organization is the largest nonprofit in the area","That the proposed program responds to an actual, evidenced need rather than an assumed one","That the funder's own priorities are irrelevant","That no evaluation plan is necessary"], correct:1, explain:"A documented needs assessment shows the proposed program responds to a real, evidenced community need, rather than one the applicant simply assumed existed."},
      {domain:"Program and project design", q:"Citing an evidence-based or research-supported practice as the foundation for a proposed program's design primarily strengthens a proposal by:", options:["Making the narrative longer","Showing reviewers the proposed approach isn't just untested guesswork, but grounded in what's already shown promise elsewhere","Replacing the need for a logic model","Guaranteeing funding regardless of other proposal weaknesses"], correct:1, explain:"Grounding design in evidence-based practice reassures reviewers the approach has some track record, rather than being an untested idea with no supporting basis."},
      {domain:"Program and project design", q:"A program design's staffing plan, specifying who will do what and at what level of effort, matters to reviewers mainly because it:", options:["Has no real bearing on whether the program can actually be implemented","Demonstrates the organization has realistically thought through who will carry out the proposed activities, not just what those activities are","Is only relevant to the budget section, never program design","Is required only for multi-year grants"], correct:1, explain:"A credible staffing plan shows the organization has thought through the practical who, not just the what, of implementation, a real test of feasibility."},
      {domain:"Program and project design", q:"Formative evaluation, conducted during a program's implementation, differs from summative evaluation mainly in that it:", options:["Happens only after the program has fully ended","Is used to monitor and adjust the program while it's still running, rather than only assessing final results afterward","Is the same as summative evaluation under a different name","Applies only to government-funded programs"], correct:1, explain:"Formative evaluation happens during implementation, informing real-time adjustments, while summative evaluation assesses final results after the program concludes."},
      {domain:"Program and project design", q:"In logic-model terms, 'inputs' refer to:", options:["The final results a program hopes to achieve","The resources, staff, funding, and materials a program draws on to carry out its activities","The specific activities delivered to participants","The number of participants served"], correct:1, explain:"Inputs are the resources fed into a program, staff time, funding, materials, that make the planned activities possible in the first place."},
      {domain:"Program and project design", q:"A program design proposing to serve 5,000 participants with a budget and staffing plan realistically suited to serving 500 would most likely be flagged by reviewers as:", options:["An ambitious but credible plan","A scope-feasibility mismatch, raising doubt about whether the program can realistically deliver as proposed","A minor detail with no real bearing on the proposal's strength","Evidence the organization deserves additional funding to match the larger number"], correct:1, explain:"A large mismatch between proposed scope and the actual resources budgeted and staffed for is a credibility red flag, suggesting the plan isn't realistically achievable."},
      {domain:"Program and project design", q:"Involving program participants or community stakeholders in shaping a proposed program's design, rather than designing it entirely in isolation, is valued because it:", options:["Has no bearing on program quality","Tends to produce a program better fitted to real community needs and more likely to achieve genuine buy-in","Is required only for arts-focused programs","Replaces the need for a needs assessment"], correct:1, explain:"Programs designed with real input from the people they're meant to serve tend to better match actual needs and earn stronger community buy-in than those designed in isolation."},
      {domain:"Program and project design", q:"A proposed program design that includes a clear plan for how successful elements could be replicated or scaled to other sites is primarily addressing which funder concern?", options:["Whether the program is a one-off, limited-value pilot or has potential for broader impact beyond this single grant","The program's compliance with post-award reporting requirements","The organization's staff turnover rate","The organization's board composition"], correct:0, explain:"A replicability or scalability plan speaks directly to a funder's interest in whether their investment could generate broader impact beyond a single, isolated pilot."},
      {domain:"Program and project design", q:"Which best describes the relationship between a program's stated outcomes and its evaluation plan within a well-designed proposal?", options:["They are unrelated sections that can be written independently","The evaluation plan should be built specifically to measure whether the stated outcomes were actually achieved","Outcomes are set only after the evaluation plan is finalized","Evaluation plans should measure activities only, never outcomes"], correct:1, explain:"A well-designed evaluation plan is built to directly test whether the program's own stated outcomes were achieved, the two sections should align tightly, not stand apart."},
      {domain:"Post-award grant management", q:"A grantee organization realizes it will need more time than originally planned to complete grant-funded activities. The appropriate post-award management step is to:", options:["Simply let the grant period lapse without comment","Proactively request a no-cost extension from the funder before the original period ends, explaining the need for more time","Wait until after the deadline has passed to explain the delay","Return all unspent funds immediately"], correct:1, explain:"A no-cost extension, requested proactively before the original period ends, is the standard mechanism for gaining more time without additional funds."},
      {domain:"Post-award grant management", q:"An organization that regrants a portion of its award to smaller subrecipient organizations has a post-award management responsibility to:", options:["Assume no further responsibility once funds are passed along","Monitor those subrecipients' compliant use of the funds, since the original grantee remains accountable to the funder","Regrant funds without any documentation","Report subrecipient spending only if specifically asked"], correct:1, explain:"When funds are passed to subrecipients, the original grantee typically remains accountable to the funder and must monitor how those funds are actually used."},
      {domain:"Post-award grant management", q:"Grant-related financial records, including receipts and time sheets tied to grant-funded staff, are generally expected to be retained for:", options:["No specific period; records can be discarded immediately after the final report","A defined retention period after the grant ends, in case of an audit or funder review","Only until the interim report is submitted","One week after the closeout report"], correct:1, explain:"Grant records are typically expected to be retained for a defined period after the grant closes, since a funder or auditor may request them well after the grant has ended."},
      {domain:"Post-award grant management", q:"A grant requires the organization to document a 20% cost share or match from non-grant sources. Post-award management responsibility includes:", options:["Ignoring the match requirement once the grant is awarded","Tracking and documenting that match, cash or in-kind, with the same rigor as the grant funds themselves","Only tracking the match if it exceeds $100,000","Assuming the funder will calculate the match independently"], correct:1, explain:"A required match or cost share must be tracked and documented just as carefully as the grant funds themselves, since it's part of the organization's compliance obligation."},
      {domain:"Post-award grant management", q:"A funder schedules an unannounced or lightly announced site visit during the grant period. From a post-award management standpoint, the grantee should:", options:["Refuse the visit as an overreach","Treat it as a normal part of post-award funder oversight and be prepared to show real program activity and basic records","Immediately assume something is wrong and pause all activities","Charge the funder a fee for the visit"], correct:1, explain:"Funder site visits are a normal, expected part of post-award oversight; being prepared to show genuine program activity and documentation is standard practice, not cause for alarm."},
      {domain:"Post-award grant management", q:"Narrative or outcomes reporting, distinct from financial reporting, is important in post-award management because it:", options:["Is purely optional and rarely reviewed by funders","Demonstrates program impact and progress toward stated outcomes, not just how the money was spent","Duplicates the financial report with no added value","Is only required for grants over $1 million"], correct:1, explain:"Narrative and outcomes reporting shows whether the program is actually achieving what it promised, a distinct and equally important accountability alongside financial reporting."},
      {domain:"Post-award grant management", q:"An organization managing five active grants with different reporting deadlines uses a shared tracking tool to stay on top of what's due when. This reflects which post-award management practice?", options:["An unnecessary layer of bureaucracy","Systematic deadline and compliance tracking, essential once an organization manages multiple simultaneous grant obligations","A practice relevant only to the organizational-development knowledge area, not post-award management","Something only large organizations with dedicated compliance staff need to do"], correct:1, explain:"Once an organization juggles multiple grants, systematic tracking of deadlines and requirements becomes essential post-award management, not optional overhead."},
      {domain:"Post-award grant management", q:"If a grant requires documentation of in-kind contributions, such as donated space or volunteer time, as part of a match, appropriate post-award practice is to:", options:["Estimate the value loosely with no supporting documentation","Document in-kind contributions with a reasonable, defensible valuation method and supporting records, just as with cash match","Exclude in-kind contributions from any tracking since they involve no actual cash","Report in-kind contributions only if the funder specifically follows up"], correct:1, explain:"In-kind match still needs a defensible valuation method and real supporting documentation, treated with the same rigor as cash match, not left as a rough guess."},
      {domain:"Post-award grant management", q:"A grantee anticipates a significant change to a funded program's scope partway through the grant period. Best post-award practice calls for:", options:["Making the change quietly and explaining it only if asked in the final report","Proactively communicating the anticipated change to the funder before implementing it, rather than surprising them after the fact","Waiting for the funder to notice the change independently","Assuming scope changes never require funder communication"], correct:1, explain:"Proactively flagging an anticipated scope change before implementing it protects the funder relationship far better than letting them discover it after the fact."},
      {domain:"Post-award grant management", q:"Why is indirect cost rate application, how overhead is charged against a grant, an important post-award management detail to get right?", options:["It has no real financial consequence either way","Applying the wrong rate or method can create a compliance discrepancy discovered during reporting or audit, requiring correction","Indirect costs are never allowed on any grant","Only the funder needs to worry about calculating indirect costs"], correct:1, explain:"Getting the indirect cost rate or method wrong can surface as a compliance problem during reporting or audit, exactly the kind of detail careful post-award management catches early."},
      {domain:"Ethical practices standards", q:"A grant professional includes program data compiled by a colleague in another department in a proposal without any attribution or credit. This raises an ethical concern most closely related to:", options:["Budget narrative accuracy","Proper attribution and honest representation of whose work contributed to the proposal","Post-award compliance tracking","Funder eligibility criteria"], correct:1, explain:"Failing to credit a colleague's contributed work, even internally, is an attribution and honesty concern, not simply a stylistic choice."},
      {domain:"Ethical practices standards", q:"A grant professional is asked by a funder's program officer, during an informal conversation, for details about a competing nonprofit's pending application to the same funder. The ethical response is to:", options:["Share whatever details are known, since the program officer asked directly","Decline to speculate or share information about another organization's confidential application, redirecting instead to the applicant's own proposal","Offer to write a negative reference about the competing organization","Ask the program officer for money in exchange for the information"], correct:1, explain:"A grant professional has no business sharing another organization's confidential application details, even if asked directly; the appropriate response is a polite decline and redirect."},
      {domain:"Ethical practices standards", q:"A grant professional learns confidential details about a funder's internal priorities during a private conversation with a program officer. Ethical practice calls for:", options:["Publicizing the information widely to help other nonprofits","Treating that information with appropriate confidentiality and not misusing it inappropriately","Using it to pressure the funder into a larger award","Sharing it freely with competing nonprofits seeking the same funder"], correct:1, explain:"Information shared in confidence during funder relationship-building should be treated with discretion, not broadcast or leveraged inappropriately."},
      {domain:"Ethical practices standards", q:"A proposal describes the applicant organization as having more staff capacity and established infrastructure than it actually has, in order to appear more competitive. This is best described as:", options:["A reasonable and common exaggeration expected by all funders","A misrepresentation of organizational capacity, an ethical concern since funders rely on accurate information to assess risk and fit","Standard practice with no ethical dimension","Something funders always independently verify, so it carries no real risk"], correct:1, explain:"Overstating organizational capacity misleads a funder assessing real risk and fit, and is an ethics concern regardless of how common the temptation might be."},
      {domain:"Ethical practices standards", q:"Submitting requests to two different funders for the exact same specific expense, without disclosing the other pending request, raises an ethical concern generally described as:", options:["Standard practice with no ethical implications","Potential duplicate funding or double-dipping, which most funders expect to be disclosed rather than concealed","A funder-side error that isn't the applicant's responsibility","Something relevant only to government grants"], correct:1, explain:"Seeking identical funding for the same specific cost from multiple funders without disclosure risks duplicate funding, an issue most funders expect applicants to disclose upfront."},
      {domain:"Ethical practices standards", q:"GPCI maintains its own code of ethics for certified grant professionals primarily to:", options:["Duplicate what AFP's Code of Ethical Standards already covers with no distinct purpose","Establish field-specific ethical expectations and accountability tailored to grant-seeking practice","Replace the need for any organizational ethics policy","Apply only to candidates still pursuing the GPC credential, not certified holders"], correct:1, explain:"GPCI's code establishes ethical expectations specific to grant-seeking practice, distinct from, though complementary to, broader fundraising ethics codes like AFP's."},
      {domain:"Ethical practices standards", q:"When disclosing an organization's past grant performance history to a new prospective funder, ethical practice calls for:", options:["Omitting any past grant that wasn't fully successful","Honest representation of past performance, including lessons learned from any grants that fell short of original goals","Only sharing history with funders who don't ask for it","Fabricating a stronger history if the real one seems unimpressive"], correct:1, explain:"Honest disclosure, including what was learned from grants that didn't fully meet original goals, reflects genuine accountability rather than a curated, misleading history."},
      {domain:"Ethical practices standards", q:"A funder's grant explicitly restricts use of funds to direct program costs, excluding administrative overhead. A grant professional who quietly reclassifies overhead costs as 'program costs' to access the funds anyway is:", options:["Using acceptable financial flexibility","Violating the funder's explicit restriction, an ethical and compliance concern regardless of the underlying budget need","Following standard nonprofit accounting practice","Acting appropriately as long as the total budget still balances"], correct:1, explain:"Reclassifying restricted costs to get around an explicit funder restriction is a direct ethical and compliance violation, not a legitimate accounting workaround."},
      {domain:"Ethical practices standards", q:"A grant professional discovers that grant funds are being spent by leadership in a way that clearly violates the funder's stated restrictions. The most appropriate ethical response is to:", options:["Say nothing to avoid conflict with leadership","Raise the concern through appropriate internal channels, or if necessary external ones, consistent with ethical accountability obligations","Quietly correct the organization's records without telling anyone","Resign immediately without raising the concern to anyone"], correct:1, explain:"Ethical accountability calls for raising a genuine compliance concern through appropriate channels, not silence, quiet correction, or simply walking away without addressing it."},
      {domain:"Ethical practices standards", q:"Accepting a significant personal gift or lavish hospitality from a funder's representative during an active grant relationship raises an ethical concern primarily because it:", options:["Has no bearing on professional judgment or the appearance of impropriety","Could compromise, or appear to compromise, the grant professional's independent, ethical judgment in that relationship","Is always explicitly illegal under federal law","Is standard, encouraged practice across the field"], correct:1, explain:"Accepting significant personal gifts from a funder representative risks compromising, or appearing to compromise, independent professional judgment in that relationship."},
      {domain:"Organizational development", q:"A nonprofit's board formally adopts a policy on which types of grant opportunities require board approval before submission. This is an example of:", options:["An unnecessary bureaucratic step with no organizational-development value","Organizational infrastructure supporting grant-readiness, clarifying governance and accountability around grant-seeking decisions","A requirement only for government grants","A post-award management task"], correct:1, explain:"A clear approval policy is organizational infrastructure: it establishes governance and accountability around grant-seeking before any proposal goes out the door."},
      {domain:"Organizational development", q:"As an organization's grants portfolio grows from a handful to dozens of active awards, organizational development for grant seeking often requires:", options:["No change to staffing or systems, since one grant professional can manage any volume","Reassessing staff capacity and possibly adding dedicated grants staff or systems to keep pace with the growing compliance workload","Reducing the number of active grants immediately","Outsourcing all grant writing permanently regardless of internal capacity"], correct:1, explain:"Growth in grant volume typically strains existing capacity; organizational development means proactively reassessing staffing and systems rather than assuming one person can absorb unlimited growth."},
      {domain:"Organizational development", q:"A financial system capable of tracking restricted grant funds separately from general operating funds, by individual grant, is an example of:", options:["A luxury most small nonprofits don't actually need","Foundational financial infrastructure that supports accurate grant compliance and reporting","A requirement only for organizations with government contracts","Something entirely unrelated to grant seeking"], correct:1, explain:"The ability to track restricted grant funds separately, by individual award, is basic financial infrastructure that underpins accurate compliance and reporting, not an optional extra."},
      {domain:"Organizational development", q:"Pre-negotiated memoranda of understanding, or MOUs, with partner organizations, ready in advance of a specific grant opportunity, primarily support organizational development by:", options:["Locking the organization into partnerships it can never exit","Allowing the organization to move quickly on collaborative funding opportunities that require documented partnerships, without scrambling at the deadline","Replacing the need for a case for support","Only being relevant to international grants"], correct:1, explain:"Having partnership agreements ready ahead of time lets an organization respond quickly to collaborative opportunities, rather than trying to negotiate an MOU under deadline pressure."},
      {domain:"Organizational development", q:"An organization whose entire grant-seeking knowledge and funder relationships live in one long-tenured staff member's head, with nothing documented, faces which organizational-development risk?", options:["No real risk, as long as that staff member stays employed indefinitely","A significant institutional-knowledge risk if that person leaves, undermining continuity and grant-readiness","This is actually the recommended organizational-development approach","A risk relevant only to very large organizations"], correct:1, explain:"Concentrating all institutional knowledge in one person, with nothing documented or shared, creates real continuity risk the moment that person leaves."},
      {domain:"Organizational development", q:"Why is having a current, board-approved strategic plan generally considered part of an organization's overall grant-readiness?", options:["It has no bearing on grant readiness","It gives grant seekers a clear, credible framework to show funders how a specific request fits into the organization's broader direction","Strategic plans are only relevant to for-profit companies","Funders never ask about organizational strategy"], correct:1, explain:"A current strategic plan gives grant seekers something credible to point to, showing funders exactly how a specific request fits the organization's broader direction, not an ad hoc idea."},
      {domain:"Organizational development", q:"Relying on a single major funder for the large majority of an organization's grant revenue creates an organizational-development concern primarily because it:", options:["Has no real downside as long as the relationship remains strong","Creates revenue concentration risk; losing or not renewing that one relationship could jeopardize a large share of funding at once","Is required under most funders' own guidelines","Only matters for organizations with annual budgets over $10 million"], correct:1, explain:"Heavy reliance on one funder concentrates risk; organizational development for grant seeking includes deliberately diversifying the funder base to avoid a single point of failure."},
      {domain:"Organizational development", q:"A documented process for how grant reporting deadlines are assigned, tracked, and reviewed internally before submission is an example of:", options:["Something relevant only to the post-award management knowledge area, with no organizational-development component","Operational infrastructure that supports consistent, reliable grant management as an organizational capacity, not just an individual habit","A requirement unique to federal grants","An unnecessary layer of process"], correct:1, explain:"A documented, repeatable process for managing deadlines is organizational infrastructure, capacity that persists beyond any one individual's personal habits or memory."},
      {domain:"Organizational development", q:"Which best reflects a mature, organizationally developed approach to grant seeking, compared to an ad hoc one?", options:["Applying to any grant opportunity that appears, regardless of mission fit or capacity to deliver","A deliberate strategy guided by readiness infrastructure, fit assessment, and realistic capacity to deliver on what's proposed","Assigning grant writing to whichever staff member happens to have free time that week","Avoiding all planning in favor of maximum flexibility"], correct:1, explain:"Organizational maturity in grant seeking looks like deliberate strategy grounded in real readiness and capacity, not opportunistic applying to anything available."},
      {domain:"Organizational development", q:"Investing in professional development, such as training program staff, not just the grant professional, on basic grant compliance requirements, supports organizational development mainly by:", options:["Having no real impact since only the grant professional needs to understand compliance","Building broader organizational capacity to actually deliver on grant-funded commitments, since program staff carry out much of the compliance work day to day","Replacing the grant professional's role entirely","Being required only for organizations with federal grants"], correct:1, explain:"Since program staff, not just the grant professional, carry out much of the actual compliance work day to day, building their understanding strengthens the organization's real capacity to deliver."},
      {domain:"Cultivating funder relationships", q:"A funder that has provided several consecutive years of unrestricted, general operating support to an organization, rather than one-off restricted project grants, most likely reflects:", options:["A funder relationship with little real trust behind it","A high level of trust built through a sustained, well-cultivated relationship over time","A funder's inability to design restricted grant programs","A one-time administrative error"], correct:1, explain:"Sustained, flexible general-operating support is often a strong signal of deep trust a funder has built in an organization over a sustained, multi-year relationship."},
      {domain:"Cultivating funder relationships", q:"Inviting a funder's program staff to attend an organization's public event or convening, outside of any required site visit, is an example of:", options:["An inappropriate use of funder time","Proactive relationship cultivation, letting the funder experience the organization's work firsthand in a lower-pressure setting","A post-award compliance requirement","Something relevant only to corporate funders"], correct:1, explain:"Inviting funder staff to organic, lower-pressure moments like a public event is a cultivation practice, letting them see the work firsthand outside a formal, required visit."},
      {domain:"Cultivating funder relationships", q:"Sharing an organization's broader strategic updates, not just grant-specific progress, with a funder between required reports reflects which cultivation principle?", options:["Funders should only ever hear about the specific grant they funded, nothing broader","Treating the funder as a genuine partner invested in the organization's overall direction, not merely a transactional source of restricted funds","This practice risks violating grant restrictions","It's relevant only during the application stage, never after"], correct:1, explain:"Sharing broader organizational context treats the funder as an invested partner in the mission, not just a transactional source tied narrowly to one grant."},
      {domain:"Cultivating funder relationships", q:"Understanding a program officer's own internal pressures and priorities, such as needing to justify a grant recommendation to their own board, can help a grant professional by:", options:["Having no practical value in the relationship","Framing communications and requests in ways that actually help the program officer advocate for the organization internally","Manipulating the program officer against their own organization's interests","Replacing the need for a strong proposal"], correct:1, explain:"Understanding what a program officer needs to advocate successfully internally lets a grant professional frame communication in useful, not manipulative, ways."},
      {domain:"Cultivating funder relationships", q:"Responding promptly and substantively to a funder's informal questions between formal reporting deadlines, rather than only when a report is due, is valued because it:", options:["Wastes staff time that should go only toward writing new proposals","Signals responsiveness and reliability, reinforcing the funder's confidence in the relationship outside of formal, required touchpoints","Is required by GPCI's ethical code","Has no bearing on the funder relationship"], correct:1, explain:"Prompt, substantive responsiveness outside formal deadlines reinforces a funder's confidence in the organization as a reliable partner, not just a report-generating grantee."},
      {domain:"Cultivating funder relationships", q:"A funder hosts a peer-learning cohort or convening for several of its grantees to share strategies with one another. Actively participating in this convening is valuable cultivation practice mainly because it:", options:["Guarantees a larger grant renewal","Deepens the relationship with the funder while also building peer relationships that can benefit the organization's broader work","Is purely optional with no relationship value","Is required only if attendance is mandatory"], correct:1, explain:"Active participation in a funder-hosted convening deepens the funder relationship and builds valuable peer connections at the same time, a genuine cultivation opportunity."},
      {domain:"Cultivating funder relationships", q:"Late, poor-quality grant reporting, even if unintentional, can damage a funder relationship primarily because it:", options:["Has no bearing on cultivation, since reporting is a purely administrative task","Undermines the trust and reliability that sustained relationship cultivation depends on","Only matters for the specific grant being reported on, never the broader relationship","Is entirely separate from cultivation and never intersects with it"], correct:1, explain:"Reporting quality and reliability are part of what sustains a funder's trust; poor reporting can quietly erode relationship capital built through other cultivation efforts."},
      {domain:"Cultivating funder relationships", q:"When an application is declined, a grant professional who sends a gracious, professional response and asks for brief feedback, rather than going silent, is:", options:["Wasting time on a relationship that's now over","Preserving the funder relationship for future opportunities, since a decline on one proposal doesn't have to end the relationship","Violating standard funder etiquette by asking for feedback","Required to never contact that funder again"], correct:1, explain:"A gracious response to a decline, including a respectful request for feedback, keeps the relationship open for future opportunities rather than treating one no as a permanent end."},
      {domain:"Cultivating funder relationships", q:"Cultivating a relationship with appropriate members of a funder's board, in addition to program staff, should generally be approached:", options:["Aggressively and without any staff coordination, to maximize access","Carefully and appropriately, often in coordination with program staff, respecting the funder's own internal relationships and protocols","Never; board members of a funder should always be avoided entirely","Only through unsolicited direct mail"], correct:1, explain:"Board-level cultivation can be valuable but should be handled carefully and typically in coordination with program staff, respecting the funder's own internal relationships and norms."},
      {domain:"Cultivating funder relationships", q:"A funder relationship where renewal conversations begin informally well before the next formal application cycle, rather than starting cold at the RFP release, reflects:", options:["A relationship problem that should be avoided","The kind of proactive, ongoing cultivation that distinguishes a well-managed funder relationship from a purely transactional one","A violation of fair-competition norms","Something relevant only to government grant cycles"], correct:1, explain:"Beginning renewal conversations informally ahead of the formal cycle is a hallmark of proactive cultivation, built on an ongoing relationship rather than starting fresh each time."},
      {domain:"Professionalism advancement", q:"Simply holding membership in GPCI or a regional grant professionals' association, without further involvement, is generally considered:", options:["The fullest expression of professionalism advancement possible","A starting point, with active participation such as committees, mentoring, or presenting representing a deeper level of professionalism advancement","Irrelevant to the professionalism advancement knowledge area","Required for GPC recertification regardless of activity level"], correct:1, explain:"Membership alone is a baseline; professionalism advancement is generally understood as active, ongoing engagement with the field beyond simply holding a membership card."},
      {domain:"Professionalism advancement", q:"A GPC holder who volunteers to help write or review items for the GPC certification exam itself is contributing to professionalism advancement by:", options:["Undermining the exam's integrity","Directly strengthening the credential and the field's shared standards through volunteer expert contribution","Guaranteeing they'll never have to recertify","Violating GPCI's conflict-of-interest policy automatically"], correct:1, explain:"Volunteering expertise to help build or review the credential's own exam content is a direct, substantive way of strengthening the profession's shared standards."},
      {domain:"Professionalism advancement", q:"Staying current on emerging tools and technology relevant to grant seeking, such as new funder databases or AI-assisted drafting tools, is considered part of professionalism advancement because it:", options:["Has no real relevance to professionalism advancement","Reflects ongoing engagement with the evolving practice of the field, not just static, one-time expertise","Is required only of GPCI board members","Replaces the need for any continuing education hours"], correct:1, explain:"Professionalism advancement includes staying current with how the field's tools and practices evolve, not treating expertise as fixed once the credential is earned."},
      {domain:"Professionalism advancement", q:"A GPC holder who offers occasional pro bono grant-writing support to a small, under-resourced nonprofit outside their own employer is best understood as:", options:["A conflict of interest that GPCI's ethics code prohibits","An example of giving back to the broader field, consistent with professionalism advancement's field-benefiting spirit","Something that should only ever be done for pay","Irrelevant to any GPC knowledge area"], correct:1, explain:"Pro bono contribution to the broader nonprofit sector reflects the same field-benefiting spirit professionalism advancement is meant to recognize, beyond one's own paid role."},
      {domain:"Professionalism advancement", q:"Advocating for greater recognition of grant professionals as a distinct, skilled discipline within the broader nonprofit sector is an example of:", options:["Something outside the scope of professionalism advancement entirely","Professionalism advancement at the level of the field itself, not just an individual's own career","A task reserved exclusively for GPCI staff","Ethical practices standards, not professionalism advancement"], correct:1, explain:"Advocating for the profession's own recognition and standing is professionalism advancement operating at the level of the whole field, not just one individual's career."},
      {domain:"Professionalism advancement", q:"A GPC holder who also pursues the CFRE credential, broadening their expertise into fundraising more generally, is demonstrating professionalism advancement by:", options:["Diluting their expertise in a way GPCI would discourage","Pursuing complementary professional development that deepens their overall practice and credibility in the broader philanthropy field","Violating GPC recertification requirements","Something that has no bearing on professionalism at all"], correct:1, explain:"Pursuing complementary credentials that deepen and broaden professional expertise is a recognized form of professionalism advancement, not a dilution of the original credential."},
      {domain:"Professionalism advancement", q:"Developing a training curriculum to help onboard new grant professionals at a regional association is best classified as:", options:["Post-award grant management","Professionalism advancement, contributing resources that strengthen the field's collective capacity","Organizational development for grant seeking, since it's internal to one organization","Ethical practices standards"], correct:1, explain:"Creating training resources that help develop the broader field's next generation of practitioners is a clear example of professionalism advancement in action."},
      {domain:"Professionalism advancement", q:"Participating in a periodic practice-analysis survey that helps GPCI determine what content the GPC exam should actually cover is an example of:", options:["An irrelevant administrative task","Contributing to the field's shared standards by helping keep the credential's content reflective of current practice","A requirement only for exam item-writers","Something unrelated to professionalism advancement"], correct:1, explain:"Practice-analysis surveys directly shape what the credential actually tests, and contributing to that process is a meaningful way of supporting the field's shared standards."},
      {domain:"Professionalism advancement", q:"Why does modeling strong ethical practice visibly, not just following it privately, matter to the broader idea of professionalism advancement?", options:["It doesn't; ethics and professionalism advancement are entirely unrelated knowledge areas","Visible ethical leadership helps set a standard other practitioners in the field can see and aspire to, strengthening the profession's overall reputation","Only GPCI staff are responsible for the field's ethical reputation","Modeling ethics visibly is considered inappropriate self-promotion"], correct:1, explain:"Visibly modeling strong ethical practice, not just quietly following it, helps set a standard for others and strengthens the whole profession's credibility and reputation."},
      {domain:"Professionalism advancement", q:"Which best distinguishes professionalism advancement from the other GPC knowledge areas?", options:["It's focused on the individual proposal in front of you, like crafting and submitting","It's oriented toward strengthening the grant profession itself and the practitioner's ongoing growth within it, beyond any single grant or funder relationship","It exclusively concerns post-award compliance","It only applies to GPCI board members, not general practitioners"], correct:1, explain:"Professionalism advancement is uniquely oriented toward the field and the practitioner's own ongoing growth, distinct from the more grant- or funder-specific knowledge areas."}
    ]},
    CAP: {label:"CAP", sub:"The American College of Financial Services &middot; 30 questions, 10 per course", questions:[
      {domain:"CAP 539 - Family Wealth", q:"CAP 539, Planning for Impact in Context of Family Wealth, is best described as:", options:["The most advanced, final course in the CAP sequence","The foundation course that sets up the self, family, and community impact framework the other two courses build on","A course exclusively about nonprofit gift accounting","An optional elective outside the core CAP sequence"], correct:1, explain:"CAP 539 is the foundation course, establishing the shared framework CAP 549 and CAP 559 both build on."},
      {domain:"CAP 539 - Family Wealth", q:"CAP 539's \"self, family, community\" framework is meant to help advisors think about impact across:", options:["Only the donor's own personal finances","Three levels at once, the donor's own goals, their family's, and their community's","Only tax-filing status","Only the donor's employer benefits"], correct:1, explain:"The framework deliberately spans three levels of impact, self, family, and community, not just one."},
      {domain:"CAP 539 - Family Wealth", q:"Which planning disciplines does CAP 539 blend together?", options:["Financial planning, estate planning, and gift planning","Grant writing, program design, and evaluation","Corporate law, HR policy, and payroll","Real estate appraisal and zoning law"], correct:0, explain:"CAP 539 integrates financial, estate, and gift planning around the donor's broader wealth picture."},
      {domain:"CAP 539 - Family Wealth", q:"A candidate new to the CAP program is deciding which course to start with. What's the standard recommended sequence?", options:["Start with CAP 559, then work backward","Start with CAP 539, since it's the foundation course","Start with CAP 549, since it's the most technical","Order doesn't matter, take them simultaneously"], correct:1, explain:"CAP 539 is designed as the entry point, establishing the framework the other two courses assume."},
      {domain:"CAP 539 - Family Wealth", q:"A family wealth conversation grounded in CAP 539 content would most likely address:", options:["Only the donor's investment portfolio performance","How charitable giving fits alongside the family's other financial and estate goals","Only the nonprofit's internal accounting for the gift","Only the tax code's corporate provisions"], correct:1, explain:"CAP 539 is about situating philanthropic planning within the donor's broader family wealth and goals, not an isolated topic."},
      {domain:"CAP 539 - Family Wealth", q:"CAP 539 content is least focused on which of the following?", options:["Estate planning tools","Family financial goal-setting","Nonprofit internal gift accounting and stewardship","Gift planning integrated with wealth goals"], correct:2, explain:"Nonprofit internal accounting and stewardship of a gift is CAP 559's focus, not CAP 539's."},
      {domain:"CAP 539 - Family Wealth", q:"CAP 539 is most closely aligned, in spirit, with which broader professional discipline?", options:["Grant writing and compliance","Financial and estate planning applied to philanthropic goals","Nonprofit board governance exclusively","Direct-mail fundraising copywriting"], correct:1, explain:"CAP 539 sits closest to financial and estate planning practice, reframed around philanthropic impact."},
      {domain:"CAP 539 - Family Wealth", q:"Why does the CAP sequence typically start with 539 rather than 549?", options:["Because 549 has a harder final exam","Because 539 establishes the shared self/family/community framework the other two courses assume","Because 539 is a shorter course","There's no particular reason, it's arbitrary"], correct:1, explain:"CAP 539's framework underlies how CAP 549 and CAP 559 each frame their own content."},
      {domain:"CAP 539 - Family Wealth", q:"A candidate who has completed only CAP 559 and CAP 549, skipping CAP 539, would be:", options:["Following the standard, recommended course order","Deviating from the standard recommended sequence, which starts with 539","Ineligible to ever take CAP 539 afterward","Required to redo all three courses"], correct:1, explain:"539 is meant to come first; completing the other two without it deviates from the recommended sequence, even if not strictly prohibited."},
      {domain:"CAP 539 - Family Wealth", q:"CAP 539's framing of \"impact\" is distinct in that it evaluates a gift's effect at which scope?", options:["Only the immediate tax-year impact","Across self, family, and community simultaneously, not just one dimension","Only impact on the receiving nonprofit's budget","Only the impact on the donor's credit score"], correct:1, explain:"The course's core contribution is evaluating impact across all three levels together, not any single one in isolation."},
      {domain:"CAP 549 - Charitable Giving Strategies", q:"Which CAP course focuses specifically on charitable tax strategies, tools, and techniques for achieving donor goals?", options:["CAP 539","CAP 549","CAP 559","All three cover this equally"], correct:1, explain:"CAP 549, Charitable Giving Strategies, is the course built around charitable tax strategies and vehicles."},
      {domain:"CAP 549 - Charitable Giving Strategies", q:"What is the 2026 per-person Qualified Charitable Distribution (QCD) limit from an IRA?", options:["$50,000","$75,000","$111,000","$150,000"], correct:2, explain:"$111,000 per person for 2026, indexed annually. Worth having ready in a donor conversation."},
      {domain:"CAP 549 - Charitable Giving Strategies", q:"At what age does a donor become eligible to make a Qualified Charitable Distribution (QCD)?", options:["59½","65","70½","72"], correct:2, explain:"QCDs are available starting at age 70½, a specific age threshold distinct from standard retirement-account ages."},
      {domain:"CAP 549 - Charitable Giving Strategies", q:"In a Charitable Remainder Trust (CRT), who typically receives income first?", options:["The charity, then the donor's heirs","The donor (or a named beneficiary), for a term, before the charity gets the remainder","Only the charity, immediately upon funding","No one; the assets stay frozen until the donor's death"], correct:1, explain:"A CRT pays the donor or another named beneficiary income for a term, then whatever remains passes to the named charity."},
      {domain:"CAP 549 - Charitable Giving Strategies", q:"A Charitable Lead Trust (CLT) is best described as:", options:["Identical to a CRT in every respect","The mirror of a CRT: the charity receives income first, then the remainder reverts to the donor's heirs","A gift annuity paying fixed income for life","A donor-advised fund held at a sponsor organization"], correct:1, explain:"A CLT flips the CRT structure: the charity gets income first, for a term, then the remainder reverts to the donor's heirs, often used for estate-tax planning."},
      {domain:"CAP 549 - Charitable Giving Strategies", q:"A Charitable Gift Annuity (CGA) is structured as:", options:["A trust with no fixed payment schedule","A contract exchanging an asset for a fixed income stream for life, with the remainder passing to the nonprofit","A revocable arrangement the donor can cancel anytime for a full refund","An outright gift with no return to the donor at all"], correct:1, explain:"A CGA is a contract: the donor gives an asset, gets a fixed income stream for life, and whatever's left at death becomes an outright gift to the nonprofit."},
      {domain:"CAP 549 - Charitable Giving Strategies", q:"Why might a donor use a CRT to give appreciated stock, rather than simply selling the stock and donating the proceeds?", options:["A CRT always pays a higher interest rate than selling outright","Funding a CRT with appreciated stock avoids the capital-gains hit the donor would face selling it outright","CRTs are simpler to set up than an outright stock gift","There is no tax difference between the two approaches"], correct:1, explain:"Donating appreciated stock into a CRT avoids realizing the capital gain on sale, a key reason donors use this vehicle."},
      {domain:"CAP 549 - Charitable Giving Strategies", q:"A Charitable Lead Trust (CLT) is most often used for which specific planning purpose?", options:["Maximizing the donor's current-year income","Estate-tax planning, often passing assets to heirs at a steep tax discount","Avoiding any interaction with the donor's heirs","Replacing the need for a will entirely"], correct:1, explain:"CLTs are a common estate-tax planning tool, letting assets pass to heirs later at a significant tax discount compared to a straight inheritance."},
      {domain:"CAP 549 - Charitable Giving Strategies", q:"How does a QCD differ from simply withdrawing IRA funds and then donating them?", options:["There is no practical difference between the two approaches","A QCD never counts as taxable income at all, while a withdrawal-then-donate approach does count as income first","A QCD requires a longer waiting period than a regular withdrawal","A QCD can only be made to religious organizations"], correct:1, explain:"A QCD transfers funds directly from custodian to charity, so the amount never shows up as taxable income, unlike a withdrawal a donor later chooses to give."},
      {domain:"CAP 549 - Charitable Giving Strategies", q:"Is a standard Charitable Remainder Trust (CRT) generally revocable or irrevocable once funded?", options:["Fully revocable, the donor can reclaim the assets anytime","Irrevocable once established","Revocable only within the first 30 days","It depends entirely on the donor's home state, with no general rule"], correct:1, explain:"A CRT is an irrevocable trust; once funded, the donor generally cannot simply reclaim the assets."},
      {domain:"CAP 559 - Nonprofit Gift Planning", q:"Which CAP course covers how nonprofits and advisors collaborate on structuring, accounting for, and stewarding a planned gift?", options:["CAP 539","CAP 549","CAP 559","None of the three"], correct:2, explain:"CAP 559, Gift Planning in a Nonprofit Context, is the nonprofit-side course, arguably the most directly applicable to fundraising practice."},
      {domain:"CAP 559 - Nonprofit Gift Planning", q:"CAP 559 content is most directly applicable to which kind of practice?", options:["Corporate tax law","Fundraising and nonprofit gift-planning work specifically","Real estate transactions","Retail financial advising with no philanthropic component"], correct:1, explain:"Of the three CAP courses, 559's nonprofit-context focus maps most directly onto fundraising and gift-planning practice."},
      {domain:"CAP 559 - Nonprofit Gift Planning", q:"When a nonprofit accounts for a deferred or planned gift on its books, what must it typically consider that a simple cash gift doesn't require?", options:["Nothing different, all gifts are recorded identically","Recognizing the gift's present value appropriately, since the funds aren't received outright and immediately","Whether the gift qualifies for a matching-gift program","Whether the donor used a credit card"], correct:1, explain:"Deferred and planned gifts require present-value accounting treatment distinct from a straightforward cash gift received today."},
      {domain:"CAP 559 - Nonprofit Gift Planning", q:"Stewarding a bequest donor while they're still living, even though the gift won't be realized for years, primarily involves:", options:["Ignoring the donor until the estate settles","Treating them like a current donor, with recognition, updates, and engagement now","Removing them from all communications to avoid seeming presumptuous","Only contacting them once a year at tax time"], correct:1, explain:"Best practice is stewarding a legacy donor as an active, valued donor now, not waiting until the gift is eventually realized."},
      {domain:"CAP 559 - Nonprofit Gift Planning", q:"A \"legacy society,\" as covered under nonprofit gift-planning content, is:", options:["A group of major annual donors only, unrelated to planned gifts","A recognition group specifically for donors who've committed a planned or deferred gift","A committee that manages the organization's endowment investments","A funder consortium that pools grant dollars"], correct:1, explain:"A legacy society specifically recognizes donors who've made a planned-giving commitment, distinct from an annual major-donor recognition group."},
      {domain:"CAP 559 - Nonprofit Gift Planning", q:"Why does CAP 559 emphasize collaboration between a nonprofit and a donor's own outside advisors?", options:["It doesn't, nonprofits should avoid outside advisors entirely","The donor's own advisor (attorney, CPA) often structures the actual planned-giving vehicle; the nonprofit's role is to accept and steward it well","Outside advisors are legally required to be nonprofit board members","Nonprofits are prohibited from speaking with a donor's advisors"], correct:1, explain:"The donor's own professional advisors typically structure vehicles like a CRT or CLT; the nonprofit's role under CAP 559 is accepting and stewarding that gift correctly."},
      {domain:"CAP 559 - Nonprofit Gift Planning", q:"A nonprofit's \"gift acceptance policy\" is most relevant to which CAP course's content?", options:["CAP 539","CAP 549","CAP 559","None of the three courses address this"], correct:2, explain:"Gift acceptance policy sits squarely within CAP 559's nonprofit-context focus on structuring and accepting planned gifts responsibly."},
      {domain:"CAP 559 - Nonprofit Gift Planning", q:"What risk does a nonprofit face by accepting a complex planned gift without a clear gift acceptance policy in place?", options:["No real risk, all gifts are equally simple to manage","Accepting an asset or vehicle the organization isn't equipped to manage, or that conflicts with its mission","Automatically losing its tax-exempt status","Being required to return the gift within 30 days by law"], correct:1, explain:"Without a gift acceptance policy, a nonprofit risks taking on complex assets or terms it isn't prepared to properly manage."},
      {domain:"CAP 559 - Nonprofit Gift Planning", q:"Logging a donor's bequest intention on an organization's internal records, before the gift is ever realized, is an example of:", options:["An accounting error that should be avoided","Planned-giving pipeline tracking, a standard nonprofit gift-planning practice","A violation of donor privacy rules","Something only publicly traded companies are required to do"], correct:1, explain:"Tracking intended future gifts, including bequests, is a normal and useful part of a nonprofit's planned-giving pipeline management."},
      {domain:"CAP 559 - Nonprofit Gift Planning", q:"CAP 559 content would be most directly useful to a consultant in which real scenario?", options:["Advising a donor purely on personal retirement account allocation","Advising a nonprofit client on how to properly structure and accept a donor's proposed CRT remainder gift","Filing a nonprofit's Form 990","Designing a direct-mail acquisition letter"], correct:1, explain:"That scenario sits directly in CAP 559's nonprofit-context wheelhouse: structuring and accepting a planned gift correctly on the receiving end."}
,
      {domain:"CAP 539 - Family Wealth", q:"CAP 539 introduces foundational concepts around wealth transfer and estate planning primarily to:", options:["Replace the need for an estate attorney entirely","Give the advisor a shared vocabulary and framework for values-based conversations about wealth before layering on specific charitable strategies in later courses","Focus exclusively on tax minimization with no values component","Prepare candidates for a separate estate-planning certification"], correct:1, explain:"CAP 539 builds foundational vocabulary and a values-based framework the later, more technical courses, CAP 549 and CAP 559, build directly on top of."},
      {domain:"CAP 539 - Family Wealth", q:"A CAP 539-grounded conversation with a client about their wealth would typically go beyond simple asset totals to also explore:", options:["Only the client's current tax bracket","The client's values, family dynamics, and hopes for how their wealth affects future generations and community","Only investment portfolio performance","Only the mechanics of trust documents"], correct:1, explain:"CAP 539's framework is explicitly values-based, exploring what wealth means to a client's family and community, not just the numbers on a balance sheet."},
      {domain:"CAP 539 - Family Wealth", q:"A common client concern CAP 539 content is designed to help advisors address is:", options:["Whether heirs are prepared, practically and emotionally, to receive significant wealth","Which mutual fund has the lowest expense ratio","How to file a nonprofit's Form 990","Which state has the lowest corporate tax rate"], correct:0, explain:"Heir preparedness, whether the next generation is ready to responsibly receive and steward significant wealth, is a classic concern CAP 539's family-wealth framework addresses."},
      {domain:"CAP 539 - Family Wealth", q:"CAP 539 is relevant to an advisor even before that advisor's client has expressed any specific interest in charitable giving, because:", options:["It has no relevance until a client raises charitable giving specifically","Its self, family, community framework applies broadly to wealth and legacy conversations, which can later open naturally into charitable planning covered in 549 and 559","CAP 539 exclusively concerns nonprofit gift acceptance","It's only useful for advisors who already specialize in philanthropy"], correct:1, explain:"Because CAP 539's framework applies broadly to wealth and legacy, not only charitable giving, it's useful groundwork even before a client has raised philanthropy specifically."},
      {domain:"CAP 539 - Family Wealth", q:"Facilitating a family meeting where multiple generations discuss shared values and future plans for family wealth is a skill CAP 539 content is most directly designed to support, because it:", options:["Focuses only on individual, not family-level, financial planning","Recognizes that significant wealth decisions often involve, and affect, the whole family, not just the primary client alone","Is unrelated to CAP 539's actual scope","Applies only to families with a family foundation already established"], correct:1, explain:"CAP 539's self, family, community framework is explicitly built around the recognition that major wealth decisions ripple across the whole family, not just one individual."},
      {domain:"CAP 539 - Family Wealth", q:"How does CAP 539's treatment of 'impact' differ from a narrower, purely charitable-giving definition?", options:["It's identical to a purely charitable definition","It frames impact broadly, encompassing how wealth affects the client's own life, their family, and their community, of which charitable giving is only one expression","CAP 539 doesn't address impact at all","It defines impact strictly in terms of investment returns"], correct:1, explain:"CAP 539 treats impact broadly, self, family, and community effects of wealth, with charitable giving as one possible expression rather than the whole definition."},
      {domain:"CAP 539 - Family Wealth", q:"Concepts and vocabulary introduced in CAP 539 are best understood as:", options:["Entirely disconnected from CAP 549 and CAP 559","A shared foundation that CAP 549's charitable-strategy content and CAP 559's nonprofit-focused content both build directly on","Relevant only to CAP 539's own final assessment, with no carryover","Optional background reading, not core content"], correct:1, explain:"CAP 539 is explicitly the foundation course; its concepts carry forward and are assumed knowledge in both CAP 549 and CAP 559."},
      {domain:"CAP 539 - Family Wealth", q:"Which best reflects the kind of advisor-client conversation CAP 539 is designed to prepare an advisor to lead?", options:["A narrow, transactional conversation focused only on this year's tax return","A broader, values-based conversation about what the client's wealth is ultimately meant to accomplish across their life and family","A conversation limited strictly to investment allocation","A conversation only relevant once a client has passed away"], correct:1, explain:"CAP 539 prepares advisors for broader, values-based conversations about the deeper purpose of a client's wealth, not narrow, transactional planning talk."},
      {domain:"CAP 539 - Family Wealth", q:"Why might an advisor who works primarily with high-net-worth families, but rarely discusses charitable giving directly, still find CAP 539 professionally valuable?", options:["It has no value outside charitable-giving-focused practices","Its family-wealth and multigenerational framework applies to broader estate and legacy planning conversations, independent of whether charitable giving comes up","CAP 539 is only valuable to nonprofit-employed advisors","It exclusively covers nonprofit accounting standards"], correct:1, explain:"Because CAP 539's framework applies to family wealth and legacy planning broadly, it has value even for advisors whose conversations don't center on charitable giving specifically."},
      {domain:"CAP 539 - Family Wealth", q:"Within the CAP designation as a whole, CAP 539 functions most like:", options:["An optional elective with no bearing on the other two courses","The conceptual entry point that establishes shared framework and vocabulary before CAP 549 and CAP 559 apply it to specific charitable strategies and nonprofit contexts","The final capstone course summarizing the entire program","A course focused solely on nonprofit compliance"], correct:1, explain:"CAP 539 functions as the program's conceptual entry point, establishing shared framework before the later courses apply it to specific charitable-strategy and nonprofit contexts."},
      {domain:"CAP 549 - Charitable Giving Strategies", q:"A Donor-Advised Fund allows a donor to claim an immediate charitable tax deduction when they contribute, even though the money isn't granted to a specific charity until later. This structure is best described as:", options:["Prohibited under current tax law","Separating the timing of the tax deduction, at contribution, from the timing of the actual charitable distribution, whenever the donor recommends a grant","Something that eliminates any tax benefit to the donor","Only available to donors giving more than $1 million"], correct:1, explain:"A DAF's defining feature is that the deduction is locked in at the time of contribution, while the donor retains advisory privileges over when and where grants actually go out later."},
      {domain:"CAP 549 - Charitable Giving Strategies", q:"Compared to a private foundation, a Donor-Advised Fund typically offers a donor:", options:["Identical administrative burden and identical deduction limits","Simpler administration and generally more favorable deduction limits, in exchange for less direct control than a private foundation provides","No tax deduction at all","Only the ability to give to religious organizations"], correct:1, explain:"DAFs are generally simpler to administer and offer more favorable deduction limits than private foundations, though donors give up some of the direct control a foundation allows."},
      {domain:"CAP 549 - Charitable Giving Strategies", q:"Donating appreciated stock held for more than a year directly to a charity, rather than selling it first and donating the cash proceeds, typically allows a donor to:", options:["Avoid capital gains tax on the appreciation while still deducting the stock's full fair market value","Pay double the tax compared to donating cash","Lose the ability to claim any deduction at all","Only benefit if the stock has lost value"], correct:0, explain:"Donating appreciated securities directly generally avoids capital gains tax on the appreciation, while the donor can still deduct the stock's full fair market value, a common tax-efficient strategy."},
      {domain:"CAP 549 - Charitable Giving Strategies", q:"'Bunching' or 'stacking' charitable contributions, concentrating several years of giving into a single tax year, is a strategy primarily used to:", options:["Avoid ever itemizing deductions","Exceed the standard deduction threshold in that bunched year, capturing an itemized charitable deduction that might otherwise go unused","Reduce the total amount given to charity over time","Qualify for a Qualified Charitable Distribution"], correct:1, explain:"Bunching concentrates giving into one tax year specifically to clear the standard-deduction threshold, capturing a real itemized benefit that spreading gifts evenly might forfeit entirely."},
      {domain:"CAP 549 - Charitable Giving Strategies", q:"Charitable deduction limits, expressed as a percentage of a donor's Adjusted Gross Income, are generally structured so that:", options:["Cash gifts and appreciated-asset gifts always share the exact same percentage limit","Cash gifts typically carry a higher AGI percentage limit than gifts of appreciated non-cash assets","Only DAF contributions are subject to any AGI limit","AGI limits apply only to gifts over $1 million"], correct:1, explain:"Cash gifts generally carry a higher AGI percentage deduction limit than gifts of appreciated non-cash property, an important distinction advisors need to plan around."},
      {domain:"CAP 549 - Charitable Giving Strategies", q:"Naming a charity as a beneficiary of a life insurance policy, rather than gifting other assets, is a planned-giving technique valued because it:", options:["Never provides any tax benefit to the donor's estate","Can offer a relatively low-cost way to make a significant future charitable gift, since the death benefit can exceed the premiums paid","Is prohibited by every state's insurance regulations","Requires no underwriting or ongoing premium payments"], correct:1, explain:"Life insurance can let a donor commit to a significant future gift, the eventual death benefit, at a comparatively modest ongoing premium cost, a distinct planned-giving tool."},
      {domain:"CAP 549 - Charitable Giving Strategies", q:"A retained life estate allows a donor to gift real property to a charity while:", options:["Immediately vacating the property with no further use","Continuing to live in or use the property for life, or a term of years, with the charity receiving full ownership only afterward","Retaining full ownership indefinitely with no actual gift occurring","Only applying to commercial, not residential, property"], correct:1, explain:"A retained life estate lets a donor gift the underlying property now while continuing to live in or use it for life, with the charity's full use and ownership following afterward."},
      {domain:"CAP 549 - Charitable Giving Strategies", q:"Choosing between a Charitable Gift Annuity, a Charitable Remainder Trust, and a Charitable Lead Trust for a given client depends most on:", options:["Whichever vehicle the advisor happens to be most familiar with","The client's specific goals, such as need for lifetime income, desired eventual benefit to heirs, and how much flexibility versus certainty of payment they want","Whichever vehicle has the lowest setup cost, regardless of client goals","There is no meaningful difference between the three vehicles"], correct:1, explain:"These vehicles serve different client goals, income certainty and simplicity, trust flexibility, or benefiting heirs after a charitable term, so the right choice follows the client's actual priorities."},
      {domain:"CAP 549 - Charitable Giving Strategies", q:"A testamentary charitable gift, made through a will or estate plan and realized only after death, differs from a lifetime gift mainly in that it:", options:["Provides no tax benefit of any kind, ever","Doesn't generate a lifetime income-tax deduction for the donor, since the deduction and gift both occur through the estate rather than during the donor's life","Is always larger than any lifetime gift by definition","Cannot be changed or revised once the will is signed"], correct:1, explain:"Because a testamentary gift is realized through the estate after death, it doesn't generate a lifetime income-tax deduction the way an outright or planned lifetime gift can."},
      {domain:"CAP 549 - Charitable Giving Strategies", q:"A Charitable Gift Annuity's fixed payments to the donor are backed by:", options:["The stock market's performance that specific year, with no guarantee","The issuing charity's general assets, making the payment a general obligation of the organization, not tied to a segregated investment account's performance","Federal government insurance","Nothing; CGA payments are not actually guaranteed"], correct:1, explain:"A CGA's fixed payments are a general obligation of the issuing charity, backed by its overall assets, which is part of why due diligence on the charity's financial strength matters to the donor."},
      {domain:"CAP 559 - Nonprofit Gift Planning", q:"In a typical CAP 559 collaboration on a planned gift, the donor's own attorney or financial advisor typically handles which part, distinct from the nonprofit's role?", options:["Deciding how the nonprofit will ultimately spend the gift","Drafting and structuring the legal and financial vehicle itself, such as the trust or will language, while the nonprofit focuses on accepting and stewarding the resulting gift","Managing the nonprofit's annual fund entirely","Filing the nonprofit's Form 990"], correct:1, explain:"The donor's own advisor typically structures the legal and financial vehicle; the nonprofit's role, per CAP 559's framing, is accepting, accounting for, and stewarding that gift well."},
      {domain:"CAP 559 - Nonprofit Gift Planning", q:"A bequest expectancy, a donor's documented intention to leave a gift through their estate, is generally treated by a nonprofit's fundraising program as:", options:["Immediately recognized as realized revenue on the current year's financial statements","A future expectancy tracked in the fundraising pipeline for stewardship and planning purposes, distinct from how it's eventually recognized on audited financial statements once realized","Irrelevant until the moment the gift is actually received","Something that should never be documented internally"], correct:1, explain:"Fundraising programs track bequest expectancies for pipeline and stewardship purposes well before the gift is realized, a distinct use from formal financial-statement recognition rules."},
      {domain:"CAP 559 - Nonprofit Gift Planning", q:"Inviting a donor who has documented a bequest intention to join the organization's legacy society, while the donor is still living, primarily serves to:", options:["Have no real stewardship value since the gift hasn't been realized yet","Recognize and steward the donor's future commitment now, reinforcing the relationship well before the gift is ever received","Replace the need to ever thank the donor again","Only apply to donors who have also made a large current, outright gift"], correct:1, explain:"Legacy society recognition while the donor is still living stewards the relationship around a future gift now, rather than waiting until after the donor has passed away to acknowledge it."},
      {domain:"CAP 559 - Nonprofit Gift Planning", q:"Training frontline fundraisers, not just planned-giving specialists, to recognize when a donor conversation naturally opens into a planned-giving topic reflects which CAP 559 principle?", options:["Planned-giving conversations should be strictly limited to specialist staff only","Planned-giving opportunities can surface throughout an organization's broader donor relationships, not only through a dedicated specialist's outreach","Frontline fundraisers have no role in planned giving whatsoever","Planned giving should never be proactively discussed with donors"], correct:1, explain:"Because planned-giving openings can surface in ordinary donor conversations, training frontline staff broadly, not relying solely on a specialist, helps the organization catch those moments."},
      {domain:"CAP 559 - Nonprofit Gift Planning", q:"Marketing planned-giving options broadly to an organization's full donor base, not only its most visible major donors, is a practice supported because:", options:["Only wealthy donors ever consider planned gifts","Meaningful bequest gifts often come from loyal, long-tenured donors of modest annual giving, not exclusively from the organization's largest current donors","Broad marketing to the full file is prohibited under most state charitable-solicitation laws","Planned giving should be marketed only during a capital campaign"], correct:1, explain:"Bequest gifts frequently come from loyal, long-tenured annual donors of otherwise modest means, which is why broad-based planned-giving marketing, not just outreach to major donors, matters."},
      {domain:"CAP 559 - Nonprofit Gift Planning", q:"After a bequest donor passes away, a nonprofit's role in actually receiving the gift typically includes:", options:["No further action; the estate handles everything automatically with no nonprofit involvement","Working with the donor's executor or estate attorney to confirm and receive the gift as the estate is settled","Immediately suing the estate to expedite payment","Declining the gift automatically upon the donor's death"], correct:1, explain:"Receiving a realized bequest typically requires the nonprofit to work directly with the estate's executor or attorney as the estate is formally settled, not an automatic, hands-off process."},
      {domain:"CAP 559 - Nonprofit Gift Planning", q:"A planned gift restricted by the donor to build a permanent endowment, rather than for current-use spending, requires the nonprofit to:", options:["Spend the full gift immediately regardless of the restriction","Invest and manage the gift according to the endowment restriction, typically spending only a defined portion of investment earnings, not the principal","Ignore the restriction if the organization has an urgent budget need","Return the gift, since permanent endowments are not legally permitted"], correct:1, explain:"An endowment-restricted planned gift must be managed according to that restriction, generally investing the principal and spending only a defined portion of earnings, honoring the donor's intent."},
      {domain:"CAP 559 - Nonprofit Gift Planning", q:"A nonprofit's finance or gift-acceptance committee reviewing a proposed complex planned gift before it's formally accepted reflects:", options:["An unnecessary delay with no real governance purpose","The board's fiduciary oversight role in accepting gifts the organization may not be equipped to manage without careful review","A task that belongs exclusively to the donor's own advisor","Something relevant only to gifts over $10 million"], correct:1, explain:"Committee-level review before accepting a complex gift reflects the board's fiduciary responsibility to evaluate whether the organization can properly manage what's being offered."},
      {domain:"CAP 559 - Nonprofit Gift Planning", q:"Building a mature, well-established planned-giving program is generally understood to require:", options:["Immediate, large results within the first year","Sustained, patient investment over many years, since realized bequest revenue often lags years or decades behind the original marketing and relationship-building effort","No meaningful ongoing investment once the program launches","Results that are always fully predictable year to year"], correct:1, explain:"Planned giving is a long-horizon investment; realized bequest revenue often arrives years or decades after the original cultivation, which is why patience and sustained effort matter."},
      {domain:"CAP 559 - Nonprofit Gift Planning", q:"A donor names three different charities as beneficiaries of a single bequest. Good CAP 559-informed practice for the nonprofit receiving one share includes:", options:["Assuming sole ownership and ignoring the other named charities entirely","Working appropriately with the estate's executor, aware that the gift will be shared among multiple named charities as the donor specified","Demanding the full bequest amount regardless of the donor's stated wishes","Refusing the gift because it's shared with other organizations"], correct:1, explain:"When a bequest names multiple charities, each nonprofit's role is to work appropriately with the estate on its own specified share, respecting the donor's stated multi-beneficiary intent."}
    ]}
  };

  var quizState = { active: null, idx: 0, answers: [], selected: null, pool: [], logged: false };

  function shuffled(arr){
    var a = arr.slice();
    for(var i = a.length - 1; i > 0; i--){
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function buildQuizRun(abbr){
    var source = QUIZZES[abbr].questions;
    var byDomain = {};
    var domainOrder = [];
    source.forEach(function(q){
      if(!byDomain[q.domain]){ byDomain[q.domain] = []; domainOrder.push(q.domain); }
      byDomain[q.domain].push(q);
    });
    var picked = [];
    domainOrder.forEach(function(d){
      var pool = shuffled(byDomain[d]);
      pool.slice(0, 10).forEach(function(q){ picked.push(q); });
    });
    picked = shuffled(picked);
    return picked.map(function(q){
      var order = shuffled(q.options.map(function(opt, i){ return i; }));
      return {
        domain: q.domain,
        q: q.q,
        explain: q.explain,
        options: order.map(function(i){ return q.options[i]; }),
        correct: order.indexOf(q.correct)
      };
    });
  }

  function attemptsForQuiz(abbr){
    return (state.quizAttempts || []).filter(function(a){ return a.examKey === abbr; });
  }

  function renderQuizPicker(){
    document.getElementById("quiz-root").innerHTML =
      '<div class="quiz-pick-grid">' + Object.keys(QUIZZES).map(function(abbr){
        var quiz = QUIZZES[abbr];
        var attempts = attemptsForQuiz(abbr);
        var lastHtml = "";
        if(attempts.length){
          var last = attempts[0];
          var dateLabel = last.takenAt ? new Date(last.takenAt).toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" }) : "";
          lastHtml = '<div class="quiz-pick-last">Last attempt: <strong>' + last.score + '/' + last.total + '</strong>' + (dateLabel ? ' &middot; ' + esc(dateLabel) : '') + '</div>' +
            (attempts.length > 1 ? '<div class="quiz-pick-history">' + attempts.length + ' attempts logged &middot; best ' + Math.max.apply(null, attempts.map(function(a){ return a.total ? Math.round(100 * a.score / a.total) : 0; })) + '%</div>' : '');
        }
        return '<button type="button" class="quiz-pick-card" data-quiz-start="' + abbr + '">' +
          '<span class="quiz-pick-abbr">' + esc(quiz.label) + '</span>' +
          '<span class="quiz-pick-meta">' + quiz.sub + '</span>' +
          lastHtml +
          '</button>';
      }).join("") + '</div>';

    document.querySelectorAll('[data-quiz-start]').forEach(function(btn){
      btn.addEventListener("click", function(){
        var abbr = btn.getAttribute("data-quiz-start");
        quizState = { active: abbr, idx: 0, answers: [], selected: null, pool: buildQuizRun(abbr), logged: false };
        renderQuizRoot();
      });
    });
  }

  function renderQuizQuestion(){
    var quiz = QUIZZES[quizState.active];
    var total = quizState.pool.length;
    var q = quizState.pool[quizState.idx];
    var pct = Math.round((quizState.idx / total) * 100);
    var answered = quizState.selected !== null;

    var optionsHtml = q.options.map(function(opt, i){
      var cls = "quiz-option";
      if(answered){
        cls += " is-disabled";
        if(i === q.correct) cls += " is-correct";
        else if(i === quizState.selected) cls += " is-wrong";
      }
      return '<button type="button" class="' + cls + '" data-opt="' + i + '"' + (answered ? " disabled" : "") + '>' +
        '<span class="opt-letter">' + String.fromCharCode(65 + i) + '</span><span>' + esc(opt) + '</span></button>';
    }).join("");

    var explainHtml = answered ?
      '<div class="quiz-explain"><span class="lbl">' + (quizState.selected === q.correct ? "Correct" : "Not quite") + '</span>' + esc(q.explain) + '</div>' : "";

    var nextLabel = (quizState.idx === total - 1) ? "See results →" : "Next question →";
    var nextBtn = answered ? '<div class="quiz-nextrow"><button type="button" class="btn" id="quiz-next-btn">' + nextLabel + '</button></div>' : "";

    document.getElementById("quiz-root").innerHTML =
      '<div class="quiz-card">' +
      '<div class="quiz-top"><button type="button" class="quiz-back" id="quiz-back-btn">&larr; Choose a different exam</button>' +
      '<span class="pill gold">Question ' + (quizState.idx + 1) + ' of ' + total + '</span></div>' +
      '<div class="quiz-progress-track"><div class="quiz-progress-fill" style="width:' + pct + '%;"></div></div>' +
      '<span class="pill quiz-domain-pill">' + esc(q.domain) + '</span>' +
      '<p class="quiz-q">' + esc(q.q) + '</p>' +
      '<div class="quiz-options">' + optionsHtml + '</div>' +
      explainHtml + nextBtn +
      '</div>';

    document.getElementById("quiz-back-btn").addEventListener("click", function(){
      quizState = { active: null, idx: 0, answers: [], selected: null, pool: [], logged: false };
      renderQuizRoot();
    });

    if(!answered){
      document.querySelectorAll('#quiz-root [data-opt]').forEach(function(btn){
        btn.addEventListener("click", function(){
          quizState.selected = Number(btn.getAttribute("data-opt"));
          renderQuizRoot();
        });
      });
    } else {
      document.getElementById("quiz-next-btn").addEventListener("click", function(){
        quizState.answers.push({ idx: quizState.idx, domain: q.domain, correct: quizState.selected === q.correct, selected: quizState.selected });
        quizState.idx++;
        quizState.selected = null;
        renderQuizRoot();
      });
    }
  }

  function renderQuizResults(){
    var quiz = QUIZZES[quizState.active];
    var total = quizState.pool.length;
    var scoreCount = quizState.answers.filter(function(a){ return a.correct; }).length;
    var pct = Math.round((scoreCount / total) * 100);

    var byDomain = {};
    quizState.answers.forEach(function(a){
      if(!byDomain[a.domain]) byDomain[a.domain] = { right: 0, total: 0 };
      byDomain[a.domain].total++;
      if(a.correct) byDomain[a.domain].right++;
    });
    var domainRows = Object.keys(byDomain).map(function(d){
      var b = byDomain[d];
      return '<tr><td>' + esc(d) + '</td><td>' + b.right + ' / ' + b.total + '</td></tr>';
    }).join("");

    var missed = quizState.answers.filter(function(a){ return !a.correct; }).map(function(a){
      var q = quizState.pool[a.idx];
      return '<div class="quiz-missed-card"><strong>' + esc(q.q) + '</strong><br>' +
        'Your answer: <span class="yours">' + esc(q.options[a.selected]) + '</span> &middot; Correct: <span class="theirs">' + esc(q.options[q.correct]) + '</span><br>' +
        esc(q.explain) + '</div>';
    }).join("");
    var missedBlock = missed ? '<h3 style="margin:20px 0 10px;">Review the misses</h3>' + missed : '<div class="example-box good"><span class="eb-label">Clean sweep</span><p class="extra">All ' + total + ' correct on ' + esc(quiz.label) + '. Try another credential, or come back in a week and retake this one cold.</p></div>';

    if(!quizState.logged){
      quizState.logged = true;
      apiFetch("/api/quiz-attempts", {
        method: "POST",
        body: { examKey: quizState.active, examLabel: quiz.label, score: scoreCount, total: total, domainBreakdown: byDomain, takenAt: new Date().toISOString() }
      }).then(refreshAndRender).catch(function(){});
    }

    document.getElementById("quiz-root").innerHTML =
      '<div class="quiz-card">' +
      '<div class="quiz-top"><button type="button" class="quiz-back" id="quiz-back-btn">&larr; Choose a different exam</button></div>' +
      '<div class="quiz-score-big">' + scoreCount + ' / ' + total + '</div>' +
      '<div class="quiz-score-sub">' + esc(quiz.label) + ' practice test &middot; ' + pct + '% correct</div>' +
      (domainRows ? '<div class="table-wrap"><table><thead><tr><th>Domain</th><th>Score</th></tr></thead><tbody>' + domainRows + '</tbody></table></div>' : '') +
      '<div class="quiz-actions"><button type="button" class="btn" id="quiz-retake-btn">Retake ' + esc(quiz.label) + '</button><button type="button" class="btn secondary" id="quiz-other-btn">Try another exam</button></div>' +
      missedBlock +
      '</div>';

    document.getElementById("quiz-back-btn").addEventListener("click", function(){
      quizState = { active: null, idx: 0, answers: [], selected: null, pool: [], logged: false };
      renderQuizRoot();
    });
    document.getElementById("quiz-other-btn").addEventListener("click", function(){
      quizState = { active: null, idx: 0, answers: [], selected: null, pool: [], logged: false };
      renderQuizRoot();
    });
    document.getElementById("quiz-retake-btn").addEventListener("click", function(){
      quizState = { active: quizState.active, idx: 0, answers: [], selected: null, pool: buildQuizRun(quizState.active), logged: false };
      renderQuizRoot();
    });
  }

  function renderQuizRoot(){
    if(quizState.active === null){ renderQuizPicker(); return; }
    if(quizState.idx >= quizState.pool.length){ renderQuizResults(); return; }
    renderQuizQuestion();
  }

  function updateQuizStat(){
    var count = 0;
    Object.keys(QUIZZES).forEach(function(k){ count += QUIZZES[k].questions.length; });
    document.getElementById("stat-quiz").textContent = count;
  }

  // ---------- chapters & communities ----------
  var ORGS = [
    {name:"AFP Global", desc:"National body. Webinars, the Deep Dive course series, and the CFRE/ACFRE credential pages live here.", url:"https://afpglobal.org", link:"afpglobal.org"},
    {name:"AFP DC Chapter", desc:"Your closest chapter for in-person networking and CFRE-credit programming.", url:"https://afpdc.org", link:"afpdc.org"},
    {name:"AFP Maryland Chapter", desc:"Baltimore-area chapter events and volunteer leadership roles.", url:"https://afpmd.memberclicks.net", link:"afpmd.memberclicks.net"},
    {name:"The Giving Institute", desc:"Publisher of Giving USA. Firm-level membership for fundraising counsel.", url:"https://givinginstitute.org", link:"givinginstitute.org"},
    {name:"Donor Relations Group", desc:"Paid webinar series on stewardship and donor communications, à la carte per session.", url:"https://donorrelations.com", link:"donorrelations.com"},
    {name:"Grant Professionals Assoc.", desc:"Membership home for grant writers/managers; parent body of the GPC credential.", url:"https://grantprofessionals.org", link:"grantprofessionals.org"},
    {name:"Chronicle of Philanthropy", desc:"The sector's paper of record: daily news, salary surveys, and major-gift reporting.", url:"https://www.philanthropy.com", link:"philanthropy.com"},
    {name:"Lilly Family School of Philanthropy", desc:"Indiana University's philanthropy research house; publishes Giving USA every June.", url:"https://philanthropy.indianapolis.iu.edu", link:"philanthropy.indianapolis.iu.edu"},
    {name:"ABFE", desc:"A Philanthropic Partnership for Black Communities. The national home for funders and practitioners advancing Black community investment. Annual Harambee Conference.", url:"https://www.abfe.org", link:"abfe.org"},
    {name:"AADO", desc:"African American Development Officers Network. Mentorship and community for Black fundraising professionals, founded by Birgit Smith Burton in 1999.", url:"https://aado.org", link:"aado.org"}
  ];
  function renderOrgs(){
    document.getElementById("org-grid").innerHTML = ORGS.map(function(o){
      return '<a class="org-card" href="' + o.url + '" target="_blank" rel="noopener">' +
        '<span class="org-name">' + esc(o.name) + '</span><span class="org-desc">' + esc(o.desc) + '</span><span class="org-link">' + esc(o.link) + '</span></a>';
    }).join("");
  }

  // ---------- field notes ----------
  var FIELD_NOTES = {
    "Sector & Giving Data": [
      {h:"Giving USA 2026: charitable giving tops $600B for the first time", s:"$617.20 billion given in 2025, up 5.7% in current dollars (3.0% inflation-adjusted), the first year over the $600B mark.", src:"Lilly Family School of Philanthropy, Jun 2026", url:"https://philanthropy.indianapolis.iu.edu/news-events/news/_news/2026/giving-usa-report-2026.html"},
      {h:"Bequests are the standout, up 19.7% in one year", s:"Now $62.19 billion, the third year in four with 20%+ bequest growth. Dean Amir Pasic ties it to strong markets and rising asset values, directly relevant to the wealth-transfer research already on file.", src:"Giving USA 2026", url:"https://philanthropy.indianapolis.iu.edu/news-events/news/_news/2026/giving-usa-report-2026.html"}
    ],
    "Major Gifts & Philanthropists": [
      {h:"Tom Golisano splits $225M gift across six children's hospitals", s:"A single major donor distributing a nine-figure gift across a coordinated set of institutions to expand healthcare access.", src:"Chronicle of Philanthropy", url:"https://www.philanthropy.com/"},
      {h:"MacKenzie Scott's giving keeps compounding", s:"Over $26 billion distributed since 2019 across 2,700+ organizations. Recent gifts include $70M to Meals on Wheels America and total HBCU giving now past $1 billion.", src:"Fortune, Apr 2026", url:"https://fortune.com/2026/04/13/billionaire-philanthropist-mackenzie-scott-donates-70-million-meals-on-wheels-america-feed-2-million-people/"}
    ],
    "Foundations & Funders": [
      {h:"Ford Foundation begins an early-stage strategy overhaul", s:"One of the largest private foundations signaling a coming shift in how it deploys its giving, its first leadership transition in over a decade.", src:"Chronicle of Philanthropy", url:"https://www.philanthropy.com/"},
      {h:"Americares receives a $50M emergency gift", s:"Funding to deliver medicines globally as international aid budgets shrink, a live example of the corporate/grant concentration risk pattern.", src:"Chronicle of Philanthropy", url:"https://www.philanthropy.com/"}
    ],
    "Field & Technology": [
      {h:"Nonprofit leaders split on AI adoption", s:"\"Bosses are bullish, staffs are wary.\" Organizational divergence on AI tools that echoes the AI-detection market signal already documented in the practice's own research.", src:"Chronicle of Philanthropy", url:"https://www.philanthropy.com/"},
      {h:"2026 QCD limit rises to $111,000 per person", s:"The IRA qualified-charitable-distribution cap is indexed annually, a concrete number worth having ready in a donor conversation.", src:"IRS-indexed limit, 2026", url:"https://q3adv.com/qualified-charitable-distributions-2026/"}
    ]
  };
  function renderFieldNotes(){
    document.getElementById("fn-refreshed").textContent = "Last refreshed Sept 14, 2026";
    document.getElementById("fn-body").innerHTML = Object.keys(FIELD_NOTES).map(function(cat){
      var cards = FIELD_NOTES[cat].map(function(d){
        return '<div class="digest-card"><h4>' + esc(d.h) + '</h4><p>' + esc(d.s) + '</p>' +
          '<div class="digest-meta"><span>' + esc(d.src) + '</span> &middot; <a href="' + d.url + '" target="_blank" rel="noopener">Read more</a></div></div>';
      }).join("");
      return '<div class="digest-group"><h3>' + esc(cat) + '</h3>' + cards + '</div>';
    }).join("");
  }

  // ---------- people to watch (full profiles) ----------
  var PEOPLE = {
    "Black Leadership in Philanthropy": {
      note:"Institution-builders and researchers whose work defines where Black philanthropy stands today. Placed first, not as a footnote.",
      list:[
        {n:"Susan Taylor Batten", t:"President & CEO, ABFE: A Philanthropic Partnership for Black Communities", bio:"Has led ABFE since 2009, building it into the national philanthropic-serving home for funders and practitioners advancing responsive investment in Black communities. Hosts the annual Harambee Conference.", notable:"Described herself as guided by \"indigenous principles of collective responsibility, self-help, and cultural pride\" in a Black Enterprise profile.", url:"https://www.abfe.org"},
        {n:"Tycely Williams, CFRE", t:"Chief Development Officer, Bipartisan Policy Center", bio:"24+ years in philanthropy across the American Red Cross National Capital Region, America's Promise Alliance, and YWCA USA before her current role. Chairs AFP Global's Inclusion, Diversity, Equity & Access Committee and is a past president of the AFP DC Metro chapter.", notable:"First Black and woman of color president of the Junior League of Washington in its 105-year history.", url:"https://afpglobal.org/large/tycely-williams-cfre"},
        {n:"Birgit Smith Burton", t:"Founder & CEO, African American Development Officers Network (AADO); 26+ years at Georgia Tech", bio:"Spent her career as a major-gifts officer at Georgia Tech, helping raise over $700 million, while building AADO from a small mentorship circle into a national network for Black fundraising professionals.", notable:"First African American woman elected Chair of the AFP Global Board.", url:"https://afpglobal.org/officers/birgit-smith-burton-0"},
        {n:"Valaida Fullwood", t:"Author, speaker, and philanthropy consultant, Charlotte, NC", bio:"Wrote the foundational text on Black giving traditions and co-founded a giving circle to put the book's thesis into practice locally.", notable:"Author of Giving Back: A Tribute to Generations of African American Philanthropists (2011); first African American Lake Distinguished Visitor at the Lilly Family School of Philanthropy; 2020 ABFE Trailblazer Award.", url:"https://valaida.com/bio/"},
        {n:"Tyrone McKinley Freeman, Ph.D.", t:"Associate Professor of Philanthropic Studies, Lilly Family School of Philanthropy; Research Associate, Smithsonian NMAAHC", bio:"The field's leading historian of African American philanthropy, tracing giving traditions back through Reconstruction-era Black churches, mutual aid societies, and entrepreneurs.", notable:"Author of Madam C.J. Walker's Gospel of Giving: Black Women's Philanthropy during Jim Crow (2020); won the 2021 AFP/Skystone Partners Research Prize. In his own words: \"I'm the son, grandson, nephew and cousin of African American Baptist preachers and First Ladies who are extremely generous.\"", url:"https://afpglobal.org/news/dr-tyrone-mckinley-freeman-wins-afpskystone-partners-research-prize-scholarly-work-surrounding"},
        {n:"Dwayne Ashley", t:"Founder & CEO, Bridge Philanthropic Consulting (BPC)", bio:"Founded BPC in 2016 describing it in his own words as \"the nation's only full-service Black Owned fundraising firm.\" The firm has since become the first Black-owned fundraising firm admitted to membership in The Giving Institute.", notable:"Has helped clients raise over $800 million collectively; author of five books on Black philanthropy and HBCU fundraising.", url:"https://bridgephilanthropicconsulting.com/about-us/"},
        {n:"La June Montgomery Tabron", t:"President & CEO, W.K. Kellogg Foundation", bio:"Has led one of the largest private foundations in the country since 2013, after rising through Kellogg's finance leadership. A frequent public voice on racial healing and reconciliation as a philanthropic strategy, not just a talking point.", notable:"First woman and first African American CEO in the Kellogg Foundation's history.", url:"https://en.wikipedia.org/wiki/La_June_Montgomery_Tabron"},
        {n:"Darren Walker", t:"President, National Gallery of Art (former President, Ford Foundation, 2013 to 2025)", bio:"Led the Ford Foundation for over a decade, becoming one of the most visible Black leaders in institutional philanthropy globally, before moving to lead the National Gallery of Art and joining the Obama Foundation board.", notable:"Widely profiled, including on 60 Minutes and in Time's 100 Most Influential, discussing growing up poor and Black in rural Texas as the throughline of his philanthropic philosophy.", url:"https://www.cbsnews.com/news/ford-foundation-darren-walker-60-minutes-overtime-2021-08-01/"},
        {n:"Trista Harris", t:"President, FutureGood", bio:"A philanthropic futurist and Howard University alum, well known within Black philanthropy professional and mentorship circles (ABFE, Emerging Practitioners in Philanthropy) as a frequent speaker and connector.", notable:"Author of FutureGood: How to Use Futurism to Save the World.", url:"https://www.wearefuturegood.com/team"}
      ]
    },
    "Major Gifts & Campaigns": {list:[
      {n:"Gail Perry, CFRE", t:"Major gifts &amp; capital campaigns consultant", bio:"Runs one of the field's longest-running major-gift training practices, focused on donor-centered engagement over transactional asks.", notable:"Has trained thousands of fundraisers globally through Gail Perry Group.", url:"https://gailperry.com"},
      {n:"Jeff Schreifels", t:"Co-founder, Veritus Group", bio:"Builds mid-level and major-gift program infrastructure for nonprofits, with a specific focus on the relationship-management systems that make cultivation repeatable rather than ad hoc.", notable:"Veritus Group's frameworks are widely used in mid-size nonprofit development shops.", url:"https://veritusgroup.com"},
      {n:"Jennifer Filla", t:"Founder, Aspire Research Group", bio:"Specializes in prospect research that bridges wealth-screening data with actual donor motivation, rather than treating capacity as the whole story.", notable:"A go-to voice on making prospect research usable by frontline gift officers, not just analysts.", url:"https://aspireresearchgroup.com"}
    ]},
    "Donor Psychology & Communications": {list:[
      {n:"Tom Ahern", t:"Donor communications &amp; copywriting consultant", bio:"The reference name in \"you-focused\" donor messaging, writing appeals and reports from the donor's point of view rather than the organization's.", notable:"Decades of direct-response testing data behind his messaging recommendations.", url:"https://aherncomm.com"},
      {n:"Claire Axelrad", t:"Founder, Clairification", bio:"A former frontline fundraiser turned consultant who balances legal precision (she has a JD) with practical stewardship and retention strategy.", notable:"Runs Clairification, a widely read blog on donor retention.", url:"https://clairification.com"},
      {n:"Jeff Brooks", t:"Creative Director, Future Fundraising Now", bio:"Applies donor-psychology research to direct-response copywriting, arguing consistently for emotional storytelling over institutional messaging.", notable:"Author of The Fundraiser's Guide to Irresistible Communications.", url:"https://futurefundraising.com"}
    ]},
    "Equity-Centered & Field Critique": {list:[
      {n:"Vu Le", t:"Writer, Nonprofit AF", bio:"A former nonprofit executive director turned full-time sector critic, whose blog became the organizing center of the community-centric fundraising movement.", notable:"Community-centric fundraising principles are now taught in AFP chapters nationally.", url:"https://nonprofitaf.com"},
      {n:"Edgar Villanueva", t:"Author &amp; philanthropic advisor", bio:"Argues for restructuring who holds decision-making power in grantor-grantee relationships, drawing on Indigenous economic principles.", notable:"Author of Decolonizing Wealth: Indigenous Wisdom to Heal Divides.", url:"https://decolonizingwealth.com"}
    ]},
    "Leadership & Mindset": {list:[
      {n:"Mallory Erickson", t:"Host, \"What the Fundraising\" podcast", bio:"Coaches fundraisers on the mindset and power dynamics behind burnout, arguing the field's retention problem is a leadership-and-culture issue, not an individual-resilience one.", notable:"One of the most-downloaded podcasts focused specifically on fundraiser psychology.", url:"https://malloryerickson.com"},
      {n:"Kishshana Palmer", t:"Leadership coach &amp; consultant", bio:"Builds leadership-development programming and community specifically for nonprofit professionals of color navigating predominantly white institutions.", notable:"Hosts the \"ManageMint Made Easy\" podcast.", url:"https://kishshanapalmer.com"}
    ]},
    "Sector Research & Big-Picture": {list:[
      {n:"Phil Buchanan", t:"President, Center for Effective Philanthropy (CEP)", bio:"Runs the leading research house studying what actually makes foundations effective from the grantee's perspective, not just the funder's.", notable:"CEP's grantee-perception surveys are a standard reference point in foundation strategy work.", url:"https://cep.org"},
      {n:"Amir Pasic", t:"Dean, Lilly Family School of Philanthropy", bio:"The named voice behind each year's Giving USA release, the report this President's Desk's own Field Notes and glossary numbers are sourced from.", notable:"Oversees the field's most-cited annual giving research.", url:"https://philanthropy.indianapolis.iu.edu"},
      {n:"Woodrow Rosenbaum", t:"Chief Data Officer, GivingTuesday", bio:"Tracks real-time shifts in how and when people give, using GivingTuesday's global data set as an early signal for broader sector trends.", notable:"GivingTuesday's data has become a proxy indicator for December year-end giving trends.", url:"https://www.givingtuesday.org"}
    ]},
    "Philanthropists at Scale": {list:[
      {n:"MacKenzie Scott", t:"Philanthropist", bio:"Redefined what a major gift can look like at scale: large, unrestricted, fast to disburse, and deliberately low-profile, in direct contrast to the branded, multi-year foundation-giving model.", notable:"Over $26 billion given since 2019 across 2,700+ organizations, including $70M to Meals on Wheels America and total HBCU giving past $1 billion.", url:"https://www.givingpledge.org/pledger/mackenzie-scott/"}
    ]},
    "Faith-Based Giving": {list:[
      {n:"David King", t:"Director, Lake Institute on Faith and Giving (Lilly Family School of Philanthropy)", bio:"Runs the field's primary research center on how faith communities give, a natural fit given the Faith block already in your own daily rhythm.", notable:"Lake Institute publishes annual research specifically on congregational and faith-based giving patterns.", url:"https://philanthropy.indianapolis.iu.edu/institutes/lake-institute/"}
    ]}
  };
  function renderPeople(){
    var total = 0;
    document.getElementById("people-body").innerHTML = Object.keys(PEOPLE).map(function(cat){
      var group = PEOPLE[cat];
      total += group.list.length;
      var cards = group.list.map(function(p){
        return '<a class="profile-card" href="' + p.url + '" target="_blank" rel="noopener" style="display:block;text-decoration:none;color:inherit;">' +
          '<div class="profile-head"><span class="profile-name">' + esc(p.n) + '</span></div>' +
          '<div class="profile-role">' + p.t + '</div>' +
          '<div class="profile-bio">' + p.bio + '</div>' +
          '<div class="profile-notable"><strong>Notable:</strong> ' + p.notable + '</div>' +
          '<span class="profile-link">Learn more →</span>' +
          '</a>';
      }).join("");
      var note = group.note ? '<p class="group-note">' + esc(group.note) + '</p>' : '';
      return '<div class="digest-group"><h3>' + esc(cat) + '</h3>' + note + cards + '</div>';
    }).join("");
    document.getElementById("stat-people").textContent = total;
  }

  // ---------- open roles, ranked by fit ----------
  var JOBS = [
    {rank:1, tier:"Strong Fit", t:"Director of Development", o:"Jeremiah Program (Baltimore site)", loc:"Baltimore, MD", sector:"Nonprofit", note:"$80,000 to $95,000. Inaugural Baltimore development hire.", fit:"The Baltimore site is 3 years old with no development staff yet. Building a function from nothing is exactly the Hidden Genius regional-director playbook. Youth/family mission, Baltimore-based, ground floor.", url:"https://www.idealist.org/en/nonprofit-job/bd19e110d51e42eb8717c8f502b5786f-director-of-development-baltimore-jeremiah-programminneapolis-baltimore"},
    {rank:2, tier:"Strong Fit", t:"Donor Engagement and Stewardship Manager", o:"Bowie State University", loc:"Bowie, MD", sector:"Higher Education", note:"HBCU.", fit:"Stewardship-focused, not a heavy solicitation quota, a realistic entry point. HBCU mission fit, and the org just closed a $128.5M campaign, so the pivot to donor retention is happening right now.", url:"https://jobs.chronicle.com/job/38033585/donor-engagement-and-stewardship-manager/"},
    {rank:3, tier:"Strong Fit", t:"Director of Development, DC", o:"Generation Hope", loc:"Washington, DC (hybrid)", sector:"Nonprofit", note:"$110,000 to $140,000. Posted deadline was Dec 2025, verify still open.", fit:"Mission overlap is close to direct: education access for young parents, similar terrain to youth/workforce development. Reports to an existing VP of Advancement, a realistic Director-level entry.", url:"https://www.idealist.org/en/nonprofit-job/6e03e9d435da46dcb6abbdc360d590ae-director-of-development-dc-generation-hope-washington"},
    {rank:4, tier:"Good Fit", t:"Director of Development, School of Business &amp; School of Engineering", o:"Morgan State University", loc:"Baltimore, MD", sector:"Higher Education", note:"HBCU. 5 to 7 yrs required.", fit:"HBCU and Baltimore fit is strong, but this is a frontline major-gifts quota role (100+ prospects, $25K+ asks), worth applying, but the experience bar is real.", url:"https://www.zrgpartners.com/jobboard/1088"},
    {rank:5, tier:"Good Fit", t:"Vice President of Advancement", o:"Baltimore Community Foundation", loc:"Baltimore, MD", sector:"Foundation", note:"", fit:"Senior, Baltimore-based, and you already have a relationship with BCF through the Baker Fund deadline on your calendar. VP-level seniority and an existing team under an AVP raise the bar.", url:"https://jobs.cof.org/job/vice-president-of-advancement/85603573/"},
    {rank:6, tier:"Good Fit", t:"Director of Foundations and Advancement Operations", o:"Issue One", loc:"Washington, DC (hybrid/remote-friendly)", sector:"Nonprofit", note:"$95,000 to $110,000. 75% foundation fundraising, 25% advancement operations.", fit:"Mission (democracy reform) doesn't overlap with your track record, but the foundations-plus-operations scope plays to strategy/consulting strengths, and no current development leader is publicly listed, likely a newly built function.", url:"https://www.idealist.org/en/nonprofit-job/7884196de78045549e98ddd27b3e6c1d-director-of-foundations-and-advancement-operations-issue-one-washington"},
    {rank:7, tier:"Good Fit", t:"Assistant Director of Development &amp; Annual Giving, Francis King Carey School of Law", o:"University of Maryland, Baltimore", loc:"Baltimore, MD", sector:"Higher Education", note:"", fit:"Solid Baltimore fit inside a well-run shop with a strong Chief Philanthropy Officer to learn from, but law-school mission is a stretch and the scope is entry/mid-level annual giving.", url:"https://jobs.chronicle.com/job/38029514/assistant-director-of-development-and-annual-giving/"},
    {rank:8, tier:"Lower Fit", t:"Associate Director of Development, Krieger School of Arts &amp; Sciences", o:"Johns Hopkins University", loc:"Baltimore, MD", sector:"Higher Education", note:"", fit:"Prestigious and Baltimore-based, but Arts & Sciences has no mission overlap and JHU's development machine is enormous and competitive to break into.", url:"https://jobs.chronicle.com/job/38029586/associate-director-of-development-krieger-school-of-arts-and-sciences/"},
    {rank:9, tier:"Lower Fit", t:"Chief Development Officer", o:"Bread for the City", loc:"Washington, DC (hybrid)", sector:"Nonprofit", note:"$180,000 to $200,000. Oversees a $20M+ diversified revenue portfolio.", fit:"Highest pay on this list and DC-based, but it's a true executive seat overseeing an existing 5-person department, a real stretch without a documented CDO-level track record.", url:"https://www.idealist.org/en/nonprofit-job/635bec5c8fdc46d0a8efa64a408d7cb0-chief-development-officer-bread-for-the-city-washington"},
    {rank:10, tier:"Lower Fit", t:"Associate Director of Donor Relations", o:"Johns Hopkins University", loc:"Baltimore, MD", sector:"Higher Education", note:"", fit:"More operational/stewardship than strategic, and sits below the level your consulting-founder background would suggest.", url:"https://jobs.chronicle.com/job/38034992/associate-director-of-donor-relations/"},
    {rank:11, tier:"Lower Fit", t:"Director of Individual Philanthropy", o:"Trust for the National Mall", loc:"Washington, DC (hybrid)", sector:"Foundation", note:"$125,000 to $135,000. Supports the \"Our Monumental Moment\" campaign.", fit:"Mission (national monuments) has no connection to your track record, and the 75 to 100 prospect major-gift portfolio wants proven solicitation history.", url:"https://www.idealist.org/en/nonprofit-job/0524c4d8851d42ee9d59bf17f3db6c5f-director-of-individual-philanthropy-trust-for-the-national-mall-washington"},
    {rank:12, tier:"Lower Fit", t:"Director of Development, Dept. of Otolaryngology, Head and Neck Surgery", o:"Johns Hopkins University", loc:"Baltimore, MD", sector:"Higher Education", note:"", fit:"Highly specialized medical major-gifts context with no documented tie to your background.", url:"https://jobs.chronicle.com/job/38019344/director-of-development-department-of-otolaryngology-head-and-neck-surgery/"},
    {rank:13, tier:"Lower Fit", t:"Director of Development", o:"Americans for Ben-Gurion University", loc:"DC/Baltimore region", sector:"Nonprofit", note:"$130,000 to $160,000. 10+ yrs experience required.", fit:"Furthest mission mismatch on the list and the steepest experience bar (10+ years, $50K+ asks). The org is flush with capacity (donations up 252% in a year), not under-resourced.", url:"https://www.evolvegivinggroup.com/searches/afbgu-director-of-development"}
  ];
  var JOB_HUBS = [
    {who:"AFP Career Center, Maryland \"Development Director\" search", when:"live search", url:"https://careers.afpglobal.org/q-development-director-l-maryland-jobs.html"},
    {who:"AFP Career Center, DC \"Development Officer\" search", when:"live search", url:"https://careers.afpglobal.org/q-development-officer-l-washington,-dc,-district-of-columbia-jobs.html"},
    {who:"Chronicle of Higher Ed Jobs, Maryland Development &amp; Advancement (20+ live)", when:"live board", url:"https://jobs.chronicle.com/jobs/development-and-advancement/maryland/"},
    {who:"HigherEdJobs.com, blocked automated search, real listings confirmed to exist", when:"search directly", url:"https://www.higheredjobs.com"},
    {who:"Foundation List, advanced search by location", when:"search directly", url:"https://www.foundationlist.org/jobs/advanced-search/?location=Baltimore%2C%20MD"}
  ];
  function tierPillClass(tier){
    if(tier === "Strong Fit") return "pill gold";
    if(tier === "Good Fit") return "pill warn";
    return "pill";
  }
  function renderJobs(){
    var sorted = JOBS.slice().sort(function(a,b){ return a.rank - b.rank; });
    document.getElementById("jobs-body").innerHTML = sorted.map(function(j){
      return '<div class="digest-card"><h4>#' + j.rank + ': ' + j.t + ' <span class="' + tierPillClass(j.tier) + '">' + esc(j.tier) + '</span> <span class="pill">' + esc(j.sector) + '</span></h4>' +
        '<p>' + esc(j.o) + ' &middot; ' + esc(j.loc) + (j.note ? '<br>' + esc(j.note) : '') + '</p>' +
        '<p><strong style="color:var(--ink);">Why this rank:</strong> ' + esc(j.fit) + '</p>' +
        '<div class="digest-meta"><a href="' + j.url + '" target="_blank" rel="noopener">View posting →</a></div></div>';
    }).join("");
    document.getElementById("stat-jobs").textContent = JOBS.length;
    document.getElementById("jobs-hubs").innerHTML = JOB_HUBS.map(function(h){
      return '<li><span class="who"><a href="' + h.url + '" target="_blank" rel="noopener">' + h.who + '</a></span><span class="when">' + esc(h.when) + '</span></li>';
    }).join("");
  }

  // ---------- org intelligence (leadership + giving trends + consulting signal) ----------
  var ORG_INTEL = [
    {org:"Jeremiah Program (Baltimore site)", posting:"Director of Development", signal:"high", signalNote:"Small, 3-year-old local site with no development staff yet. Building the function from zero, squarely inside your ICP.",
      leaders:[{n:"Chastity Lord", t:"National President & CEO"},{n:"Danielle Staton", t:"Baltimore Executive Director (since Dec 2022)", bio:"First-generation college graduate, 15 years in education, family engagement, and workforce development; grew up in a Head Start family and is a single mother herself, a lived-experience match to the population JP Baltimore serves."}],
      trend:"The Baltimore campus opened under Staton in December 2022 and served 150+ mothers and children in its first year. No org-wide fundraising totals were publicly found, but the site's youth is itself the signal: this is early-stage capacity-building, not a mature shop."},
    {org:"Bowie State University", posting:"Donor Engagement and Stewardship Manager", signal:"medium", signalNote:"Just closed a major campaign and is pivoting to stewardship, a natural strategic-support moment, though the university already has an established Philanthropic Engagement division.",
      leaders:[{n:"Dr. Aminta H. Breaux", t:"President (since 2017)", bio:"Previously VP for Advancement at Millersville University, a president who has personally run a development shop, which can make for a receptive strategic conversation."},{n:"Brent Swinton, MPA, CFRE", t:"VP for Philanthropic Engagement", bio:"Career background before Bowie State not independently verified in this research pass."}],
      trend:"BSU BOLD: The Campaign for Excellence closed December 2025 at $128.5 million against an original $50 million goal (257%), the largest campaign in school history, driven substantially by two MacKenzie Scott gifts ($25M in 2020, $50M in 2025, $75M combined). Endowment grew from $7M to over $50M under Breaux, now top-10 among HBCUs."},
    {org:"Generation Hope", posting:"Director of Development, DC", signal:"medium", signalNote:"Strong mission overlap, but an existing VP of Advancement means some in-house capacity is already there, partial ICP fit.",
      leaders:[{n:"Nicole Lynn Lewis", t:"Founder & CEO", bio:"Author and former teen mother herself; founded the organization from personal experience navigating college as a young parent."},{n:"Jessica Wisser", t:"VP of Advancement"}],
      trend:"No independently verified revenue-trend figures found in this pass; the open Director-level role reporting to an existing VP suggests a growing, not founding-stage, development operation."},
    {org:"Morgan State University", posting:"Director of Development, School of Business &amp; School of Engineering", signal:"medium", signalNote:"HBCU/Baltimore mission fit is real, but the university has a VP-led advancement division and $100M+ in recent unrestricted mega-gifts, meaningful in-house capacity already.",
      leaders:[{n:"Dr. David K. Wilson", t:"President (since 2010)", bio:"One of the longest-serving HBCU presidents nationally; Harvard-educated; has driven Morgan's push toward R1 research status."},{n:"Endia M. DeCordova, MBA", t:"VP for Institutional Advancement (since 2023)", bio:"Morgan alumna; previously Vice Chancellor for Advancement at Rutgers-Camden."},{n:"Dr. Royce D. Burnett", t:"Dean, Graves School of Business"},{n:"Dr. Oscar Barton, Jr.", t:"Dean, School of Engineering"}],
      trend:"The $254M Sesquicentennial Campaign closed around 2017 to 2019. MacKenzie Scott gave $40M (Dec 2020) and $63M (Oct 2025), the latter Morgan's largest gift ever, roughly $100M+ combined, both unrestricted. The two open school-level development roles suggest the division is building capacity to convert that momentum into sustained major-gift activity."},
    {org:"Baltimore Community Foundation", posting:"Vice President of Advancement", signal:"medium", signalNote:"Large, established foundation with an existing development team under an AVP, lower consulting-prospect value, but a strong personal-network fit given your existing Baker Fund relationship.",
      leaders:[{n:"Shanaysha M. Sauls, Ph.D.", t:"President & CEO"},{n:"Marie Lilly", t:"AVP of Development & Donor Services"},{n:"Tiffany July-Lindo", t:"Senior Advancement Officer"}],
      trend:"$300M+ in assets under management (as of 2021), $600M+ granted since 1972 across 100,000+ grants, 870+ funds under management, a large, mature community foundation."},
    {org:"Issue One", posting:"Director of Foundations and Advancement Operations", signal:"medium", signalNote:"No development leader is publicly listed. This looks like a newly created function, a real consulting-entry signal, even though the mission doesn't overlap your track record.",
      leaders:[{n:"Nick Penniman", t:"Founder & CEO", bio:"Journalism and media-reform background, co-founded the HuffPost Investigative Fund with Arianna Huffington, ran the Schumann Center for Media and Democracy with Bill Moyers, authored \"Nation on the Take\" (2016)."}],
      trend:"No current development staff name found in this research pass; the role's split scope (75% foundation fundraising, 25% advancement operations) reads as standing up a formal development function rather than backfilling one."},
    {org:"Johns Hopkins University", posting:"3 postings: Krieger School Associate Director of Development, Otolaryngology Director of Development, Associate Director of Donor Relations", signal:"low", signalNote:"Enormous, extremely well-resourced advancement operation with deep in-house capacity, not a consulting prospect, but a legitimate large employer.",
      leaders:[{n:"Ronald J. Daniels", t:"President (since 2009)"},{n:"Fritz W. Schroeder", t:"SVP for Development & Alumni Relations (since 2012)", bio:"23+ years at JHU, led the \"Rising to the Challenge\" campaign to $6.015B against a $4.5B goal."},{n:"Christopher S. Celenza", t:"Dean, Krieger School of Arts &amp; Sciences"},{n:"Dr. Maie St. John", t:"Director, Dept. of Otolaryngology, Head and Neck Surgery (since Oct 2025)"}],
      trend:"\"Rising to the Challenge\" campaign closed 2018 at $6.015B (34% above its $4.5B goal); no new named campaign since. Michael Bloomberg has given JHU over $4.5B total across three gifts (2013, 2018, and $1B in July 2024), the largest single gift to any US university at the time of the 2018 gift. JHU appears to be operating gift-by-gift between formal campaigns."},
    {org:"University of Maryland, Baltimore (UMB)", posting:"Assistant Director of Development &amp; Annual Giving, Francis King Carey School of Law", signal:"low", signalNote:"Just came off a $750M+ campaign with an experienced Chief Philanthropy Officer in place, well-resourced, not an ICP fit.",
      leaders:[{n:"Bruce E. Jarrell, MD", t:"President (since 2020)"},{n:"Greg Bowden", t:"Chief Philanthropy Officer & VP (since Dec 2023)", bio:"25+ years in philanthropy; immediately prior led development at Johns Hopkins' Carey Business School, raising over $60M in 7 years."},{n:"Renée McDonald Hutchins", t:"Dean, Francis King Carey School of Law (since 2022)", bio:"Spelman and Yale Law-educated; previously Dean at UDC David A. Clarke School of Law."}],
      trend:"The Catalyst Campaign (institution-wide, $750M goal) surpassed its goal roughly six months early, around 2022; exact final total not publicly confirmed in this pass. UMB is in a post-campaign, sustaining-momentum phase."},
    {org:"Bread for the City", posting:"Chief Development Officer, DC", signal:"low", signalNote:"Already has a 5-person development department, explicitly outside the ICP (\"large nonprofits that already have in-house development staff\"), though a real senior personal job target.",
      leaders:[{n:"George A. Jones", t:"CEO (since 1996)", bio:"Grew the organization's operating budget from $1.2M to $10.6M+ during his tenure; B.A. in Psychology, Norfolk State University."},{n:"Kristen Kozlowski", t:"Interim Chief Development Officer"}],
      trend:"Steady, long-term growth under one CEO for three decades; already staffed with an interim CDO plus associate directors for individual giving, corporate partnerships, and donor relations, a mature, well-built development department."},
    {org:"Trust for the National Mall", posting:"Director of Individual Philanthropy, DC", signal:"low", signalNote:"A $250M campaign already backed by major corporate partners, well-resourced and mission-distant from your track record.",
      leaders:[{n:"Catherine Townsend", t:"President & CEO (since 2016)", bio:"18 years at Share Our Strength working on the \"No Kid Hungry\" campaign, then led the DC Public Education Fund and ran her own nonprofit consulting practice before joining the Trust."}],
      trend:"\"Our Monumental Moment: The Campaign for the National Mall\" carries a $250 million goal tied to America's 250th anniversary (July 2026), with Humana as lead partner and HP and The Home Depot in the Leadership Circle. Amount raised to date wasn't publicly disclosed in this pass."},
    {org:"Americans for Ben-Gurion University (A4BGU)", posting:"Director of Development, DC/Baltimore region", signal:"low", signalNote:"Explosive growth and well outside the ICP's sector and budget profile, a hot org to know about, not a consulting prospect.",
      leaders:[{n:"Melissa B. Greenberg", t:"CEO", bio:"Previously Chief Philanthropy Officer at Hebrew Union College, where she grew giving roughly 300% in four years; before that, EVP/Chief Development Officer at the Jewish Federation of Greater Philadelphia."}],
      trend:"Donations surged 252% in one year, from $21M (2023) to $74M (2024), part of a broader post-October-7 surge in giving to Israeli institutions. Peer-organization CEO pay in this space runs $500K to $700K, a well-capitalized, rapidly scaling operation."}
  ];
  function signalPillClass(sig){
    if(sig === "high") return "pill gold";
    if(sig === "medium") return "pill warn";
    return "pill";
  }
  function signalLabel(sig){
    if(sig === "high") return "Strong consulting prospect";
    if(sig === "medium") return "Partial fit";
    return "Not an ICP fit";
  }
  function renderOrgIntel(){
    document.getElementById("orgintel-body").innerHTML = ORG_INTEL.map(function(o){
      var leaders = o.leaders.map(function(l){
        return '<div style="margin-bottom:8px;"><strong>' + esc(l.n) + '</strong>, ' + esc(l.t) + (l.bio ? '<div style="color:var(--ink-soft);font-size:0.86rem;margin-top:2px;">' + esc(l.bio) + '</div>' : '') + '</div>';
      }).join("");
      return '<div class="fw-card">' +
        '<div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;margin-bottom:4px;">' +
        '<h3 style="margin-bottom:0;">' + esc(o.org) + '</h3>' +
        '<span class="' + signalPillClass(o.signal) + '">' + signalLabel(o.signal) + '</span></div>' +
        '<p class="mono" style="font-size:0.78rem;margin-bottom:12px;">' + esc(o.posting) + '</p>' +
        '<div style="margin-bottom:10px;">' + leaders + '</div>' +
        '<p><strong style="color:var(--ink);">Giving trend:</strong> ' + esc(o.trend) + '</p>' +
        '<p style="color:var(--ink-soft);"><strong style="color:var(--ink);">Consulting signal:</strong> ' + esc(o.signalNote) + '</p>' +
        '</div>';
    }).join("");
  }

  // ---------- gift analysis playbook ----------
  var GIFT_PLAYBOOK = {
    framework: [
      {q:"What kind of gift is it, structurally?", body:"Outright cash, multi-year pledge, endowment, capital/naming, planned/deferred, DAF grant, matching/challenge, or in-kind. Restricted or unrestricted. Expendable or held in perpetuity. This is the mechanical shape of the gift; get this wrong and everything you say about it afterward is wrong too."},
      {q:"What problem does it solve for the institution, right now?", body:"Every major gift closes because it answers a specific, nameable gap: a missing program, a capacity ceiling, an access barrier, a building that doesn't exist yet. If you can't name the gap in one sentence, you haven't actually understood the gift; you've only summarized the press release."},
      {q:"What is the donor's relationship arc?", body:"Is this a first gift or the latest in a sequence? What did they give before, and to what? A gift is rarely a single transaction; it's a point on a curve. The curve tells you whether you're looking at a cultivation success (a new relationship converting) or a stewardship success (a returning donor re-investing because the last gift was handled well)."},
      {q:"What is the ask architecture?", body:"Who made the ask: a president, a dean, a principal-gifts officer? What documents stood behind it: a feasibility study, a formal case for support, a board resolution for naming rights? Was this solicited in the campaign's quiet/leadership phase or its public phase? The architecture tells you how much institutional machinery this gift required, a good proxy for how large and how restricted it is."},
      {q:"What's the signal?", body:"What does this gift tell you about a broader trend (donor behavior, sector conditions, institutional strategy) beyond the dollar amount? This is the \"why is this newsworthy, not just large\" question, and it's the difference between reciting a gift and understanding it."},
      {q:"What's replicable? The playbook.", body:"Strip away the specific names and dollar figure. What is the generalizable move here that another institution, another gift officer, another donor conversation could reuse? The single most valuable question for building a career or a consulting practice around gifts, because it's the only answer that transfers."},
      {q:"What's the number that matters to leadership?", body:"Not the headline dollar figure: the pipeline implication. Does this gift close a gap on the institution's gift table? Does it validate a case for support other prospects are watching? Does it lower or raise the cost-to-raise-a-dollar for the campaign? This is the answer a VP actually wants."}
    ],
    workedExample: {
      title:"Knight Foundation → University of Oregon, $1 billion (logged 2026-09-24)",
      rows: [
        {label:"Structure", body:"A multi-year pledge, restricted to capital and naming, funding construction of Oregon's first full undergraduate engineering college."},
        {label:"The problem it solves", body:"Oregon had engineering minors and graduate-level work, but no full undergraduate engineering program, a real capability gap for a flagship public research university, not a cosmetic one."},
        {label:"Relationship arc", body:"Not a new donor. Phil and Penny Knight have now given more than $2 billion to the Knight Campus at Oregon across multiple gifts since 2016, plus separate nine-figure-plus gifts this year to Providence ($1.1B) and OHSU ($2B). This gift only makes sense read as the third point on an established, escalating curve: a donor whose capacity and affinity have already been proven twice."},
        {label:"Ask architecture", body:"A gift at this scale is a leadership-phase, president-level solicitation, the kind of ask that happens after years of cultivation, not a single meeting. The public announcement is the last step in a long private process, not the first."},
        {label:"The signal", body:"The gift lands explicitly against the backdrop of the federal administration proposing roughly 57% cuts to NSF research funding. Knight framed the gift as billionaires stepping in where federal research funding is receding, a genuine sector signal: the biggest donors are starting to talk about their giving as substituting for public investment, not supplementing it."},
        {label:"The playbook", body:"A long-cultivated, multi-decade donor relationship let the university return to the same donor with a bigger, more strategic ask once a real, nameable capability gap was identified plainly. The transferable move: don't diversify away from a proven donor relationship; go back to it with a sharper, better-argued case each time."},
        {label:"What matters to leadership", body:"This single gift materially changes Oregon's gift table (very likely the single largest gift on it) and it validates that this donor relationship still has real headroom, which should reshape how the advancement office prioritizes stewardship touches for the rest of this donor's giving life."}
      ]
    },
    scripts: [
      {aud:"Gift officer (peer register)", note:"A gift officer wants the mechanics: what happened, who did it, and what they can steal for their own portfolio. Lead with the relationship arc and the playbook. Use plain, tactical language: \"moves,\" \"next touch,\" \"ask amount,\" \"what got them there.\"",
        script:"\"This wasn't a cold ask: Knight's given to this campus multiple times since 2016, over $2B total before this pledge. The move that got them from 'generous repeat donor' to 'billion-dollar pledge' was naming a specific, real gap, no undergrad engineering program, instead of a general capital ask. If you've got a donor who's already given twice, look at what capability your institution is missing that they'd recognize instantly, and bring them that instead of another general ask.\""},
      {aud:"Director briefing a VP (executive register)", note:"A VP wants pipeline and return, not narrative. Lead with what this gift changes about the campaign's numbers and what it implies about resourcing. Use gift-table position, pipeline stage counts, cost-to-raise-a-dollar, gap analysis.",
        script:"\"This is a $1B pledge from a donor we've now cultivated across three major gifts since 2016, worth flagging because it shows this relationship still has real headroom, and I'd recommend we increase stewardship investment here rather than treat it as a closed file. It also gives us a strong precedent to cite with our own capacity-gap prospects: donors are responding to the 'we're filling a real gap the institution can't fill itself right now' framing, especially with federal research funding under pressure. I'd like to bring two of our own qualified prospects a similarly specific ask this quarter instead of a general capital pitch.\""}
    ],
    stages: [
      {name:"Identification", body:"Wealth screening, but the real work is triangulating three signals, not just net worth: capacity (can they give at this level), affinity (a real connection to this institution or cause), and propensity (a giving history that shows they act on capacity and affinity together). Screen against giving history, board/volunteer history, event attendance, and the trajectory of gift sizes over time, not just the most recent one."},
      {name:"Qualification", body:"A discovery visit, not a pitch. One question answered honestly: is there a real relationship or interest here worth investing cultivation time in? Ask open questions about what the donor cares about and why, listen for what they bring up unprompted, and end the visit with at least one concrete next step, never a vague \"let's stay in touch.\""},
      {name:"Cultivation", body:"A deliberate sequence of touches, not random check-ins, building toward genuine readiness to be asked. Build a written plan per prospect with owners and dates on each move (a tour, a dean introduction, a project briefing). Treat \"no next move with a date attached\" as a hard stop-and-fix signal, not a normal lull."},
      {name:"Solicitation", body:"The right ask, from the right person, at the right moment, for the right amount and restriction, never a generic \"would you consider a gift.\" Informed by everything qualification and cultivation surfaced, reviewed by a gift committee at principal scale, delivered by whoever has the strongest relationship. Compare Gordon/UCLA ($20M, a countable 103-bed capacity ask) against Dimon/UNCF ($12M distributed across 12 HBCUs via one intermediary negotiation): both well-executed, but the tactic differs by donor type."},
      {name:"Stewardship", body:"Recognition and impact reporting that closes the loop and sets up the next ask. Report specifically on what the gift funded with real numbers: \"103 additional beds, 23% more capacity\" is stewardship, while \"your generosity made a difference\" is not, on a cadence the donor can expect. The Knight/Oregon relationship is the clearest illustration in the Ticker: three major gifts since 2016 happened because stewardship between gifts kept building the case for the next one."}
    ],
    psychology: [
      {name:"Legacy and continuity", body:"The desire to be remembered, to outlast one's own lifetime through an institution.", lang:"Shows up as naming requests, endowment structures (perpetuity is the point, not a technicality), planned/deferred gifts. Language: \"in perpetuity,\" \"for generations of students,\" naming rights."},
      {name:"Identity and self-concept", body:"The gift reflects who the donor believes themselves to be, or wants to be seen as: \"I am the kind of person who built this.\"", lang:"Shows up as gifts to the institution or field that shaped the donor's own career (Thomasson/Indiana, a self-made donor whose MBA was paid for by an employer, giving back to the exact program that launched his career). Connect the ask to the donor's own story, not a generic institutional need."},
      {name:"Reciprocity", body:"A felt debt for what the institution gave them, or a response to being treated exceptionally well already.", lang:"Shows up as repeat gifts from alumni, escalating gifts after strong stewardship. This is why stewardship quality directly predicts future gift size; reciprocity is a psychological mechanism, not a courtesy."},
      {name:"Belonging and recognition", body:"The desire for visible membership in a community of significant donors.", lang:"Shows up as gifts timed to campaign public-phase announcements, gifts that come with a visible naming or leadership-committee role attached: donor walls, campaign leadership, peer recognition."},
      {name:"Control and restriction", body:"The psychological need to direct exactly where a gift goes, rather than trust general institutional discretion.", lang:"Shows up as restricted gifts, narrowly scoped program funding, detailed gift agreements. Often a donor wanting their specific values expressed, not distrust: Ciresi Walburn/St. Thomas structured a named, perpetual leadership-fellows program rather than a general scholarship fund."},
      {name:"Rational and financial motivation", body:"Tax planning, appreciated-asset giving (stock, DAF grants), estate planning.", lang:"Real, but rarely the whole story on a principal gift; usually the mechanism that makes an emotionally-motivated gift efficient, not the reason for the gift itself."},
      {name:"Urgency and mortality salience", body:"A donor at a life stage or health/life event that makes \"what will outlast me\" concrete and immediate.", lang:"Shows up as gifts that follow a donor's own major life transition, planned gifts converted to outright gifts."},
      {name:"Values transmission to family", body:"The gift as a teaching moment or shared project with children or grandchildren, increasingly common with family foundations.", lang:"Shows up as joint-name gifts from couples or family foundations, gifts explicitly framed as modeling giving behavior for the next generation."}
    ],
    practices: [
      {name:"Discover", body:"Start from capacity-and-affinity screening, not a cold list. Ask about the donor's own story before naming an institutional need: what drew them here, what they're proud of, what they wish existed. Listen for unprompted repetition: a topic a donor returns to twice, without being asked back to it, is usually the real interest. Never let a discovery conversation end without a concrete next step captured in writing."},
      {name:"Close", body:"The ask should never be the donor's first time hearing the number or the restriction; cultivation should make it unsurprising. Bring a specific amount and use, informed by discovery and cultivation, not a round number off a gift table. Answer gift-acceptance and naming-policy questions before the ask, not during it. Close with a real next step even on a \"yes\": a closed gift with no immediate follow-through reads to the donor as the relationship ending."},
      {name:"Steward", body:"Report specific, countable impact, not sentiment: numbers the donor can picture (beds added, students funded, faculty hired), on a cadence they can expect, not only at campaign wrap-up. Treat every stewardship touch as also, quietly, a capacity-and-affinity check for what comes next; the best stewardship program and the best identification pipeline are, in practice, the same activity viewed from two different angles."}
    ],
    loop: [
      "Log the gift, as already happens, with its full case-study fields (giftType, restriction, impact, trendSignal, playbook).",
      "Run the seven-question framework against it, in writing, even briefly. This is the habit that builds gift-reading fluency.",
      "Draft both registers: one paragraph as if briefing a gift officer, one as if briefing a VP. This builds audience-calibration fluency, the single most valuable skill for a director role, a consulting practice, or nonprofit leadership.",
      "Name the moves-management stage the gift's own story reveals most clearly, and note which concrete tactic made it work.",
      "Name the donor psychology most visibly at work; it's fine, and common, for more than one to apply.",
      "Add anything new to the playbook: a tactic, a phrase, a structuring idea not already captured here, so this keeps growing with the practice instead of staying static."
    ],
    template:"Gift: [donor / org / amount / date]\n\n1. Structure: \n2. Problem it solves: \n3. Relationship arc: \n4. Ask architecture: \n5. Signal: \n6. Playbook (replicable move): \n7. What matters to leadership: \n\nGift-officer version (one paragraph):\n\nVP version (one paragraph):\n\nMoves-management stage most illustrated:\n\nDonor psychology at work:"
  };
  function renderGiftPlaybook(){
    document.getElementById("gp-framework").innerHTML = '<ol class="numbered-steps">' + GIFT_PLAYBOOK.framework.map(function(f){
      return '<li><div><strong>' + esc(f.q) + '</strong><br>' + esc(f.body) + '</div></li>';
    }).join("") + '</ol>';

    document.getElementById("gp-example").innerHTML = '<div class="cred-guide"><div class="guide-block"><h4>' + esc(GIFT_PLAYBOOK.workedExample.title) + '</h4></div>' +
      GIFT_PLAYBOOK.workedExample.rows.map(function(r){
        return '<div class="guide-block"><h4>' + esc(r.label) + '</h4><div class="guide-body">' + esc(r.body) + '</div></div>';
      }).join("") + '</div>';

    document.getElementById("gp-scripts").innerHTML = GIFT_PLAYBOOK.scripts.map(function(s, i){
      var pid = "gp-script-" + i;
      return '<div class="cred-guide-row"><button type="button" class="cred-guide-toggle" data-guide-toggle="' + pid + '" aria-expanded="false"><span class="arrow">&#9656;</span> ' + esc(s.aud) + '</button></div>' +
        '<div class="cred-guide-row"><div id="' + pid + '" hidden><div class="cred-guide"><div class="guide-block"><div class="guide-body">' + esc(s.note) + '</div></div>' +
        '<div class="example-box good" style="margin-top:0;"><span class="eb-label">Script</span><p class="extra">' + esc(s.script) + '</p></div></div></div></div>';
    }).join("");

    document.getElementById("gp-stages").innerHTML = GIFT_PLAYBOOK.stages.map(function(s){
      return '<div class="org-card"><div class="org-name">' + esc(s.name) + '</div><div class="org-desc">' + esc(s.body) + '</div></div>';
    }).join("");

    document.getElementById("gp-psychology").innerHTML = GIFT_PLAYBOOK.psychology.map(function(p){
      return '<div class="org-card"><div class="org-name">' + esc(p.name) + '</div><div class="org-desc">' + esc(p.body) + '</div><div class="org-desc" style="color:var(--ink-soft);font-size:0.8rem;">' + esc(p.lang) + '</div></div>';
    }).join("");

    document.getElementById("gp-practices").innerHTML = GIFT_PLAYBOOK.practices.map(function(p){
      return '<div class="org-card"><div class="org-name">' + esc(p.name) + '</div><div class="org-desc">' + esc(p.body) + '</div></div>';
    }).join("");

    document.getElementById("gp-loop").innerHTML = GIFT_PLAYBOOK.loop.map(function(step){
      return '<li>' + esc(step) + '</li>';
    }).join("");

    document.getElementById("gp-template-body").textContent = GIFT_PLAYBOOK.template;

    document.querySelectorAll('.adv-panel[data-adv-tab="giftplaybook"] [data-guide-toggle]').forEach(function(btn){
      btn.addEventListener("click", function(){
        var panel = document.getElementById(btn.getAttribute("data-guide-toggle"));
        var open = panel.hidden;
        panel.hidden = !open;
        btn.setAttribute("aria-expanded", open ? "true" : "false");
      });
    });
    document.querySelectorAll('.adv-panel[data-adv-tab="giftplaybook"] [data-notes-toggle]').forEach(function(btn){
      btn.addEventListener("click", function(){
        var panel = document.getElementById(btn.getAttribute("data-notes-toggle"));
        var open = panel.hidden;
        panel.hidden = !open;
        btn.setAttribute("aria-expanded", open ? "true" : "false");
      });
    });
  }

  // ---------- doctoral prep ----------
  var DOCTORAL_PREP = {
    theoryThreads: [
      {name:"The policy-process theories your framework doesn't yet name", body:"Kingdon's Multiple Streams Framework, the Advocacy Coalition Framework (Sabatier &amp; Weible), Punctuated Equilibrium Theory (Baumgartner &amp; Jones), and new institutionalism (DiMaggio &amp; Powell's isomorphism; Meyer &amp; Rowan's “loosely coupled” systems) are political-science imports explaining how education policy gets made, adopted, or stalled, a different question from the effects questions your causal/critical framework answers. Human capital theory (Becker, Schultz) remains the standard economic rationale for treating education as investment; its signaling/credentialism critique treats capital as an individually possessed asset abstracted from structural conditions, putting it in direct tension with your Ladson-Billings pole."},
      {name:"A third axis: capital theory, and the CRT-extending lineage", body:"Coleman's functionalist account of social capital sits closer to Fryer's causal/individual-outcomes tradition; Bourdieu's structural account of cultural and social capital as a mechanism of class reproduction sits closer to Ladson-Billings's structural critique, an active literature frames this explicitly as “Coleman vs. Bourdieu.” Separately, trace the genealogy explicitly: Freire's critical pedagogy through Ladson-Billings's culturally relevant pedagogy (already in your document) to Django Paris and H. Samy Alim's culturally sustaining pedagogy, the currently “live,” actively publishing edge. DisCrit (Annamma, Connor, Ferri) and intersectionality (Crenshaw) both extend your Ladson-Billings pole into disability and multiply-marginalized identity, rather than standing as independent traditions."},
      {name:"Methods: the causal toolkit just got a major upgrade", body:"The difference-in-differences method underlying much of your causal tradition, including exactly the staggered-rollout research (school-finance reform, desegregation) Rucker Johnson's work exemplifies, has undergone a real overhaul since roughly 2018-2021, driven by Andrew Goodman-Bacon's bias decomposition and Callaway &amp; Sant'Anna's estimators for staggered treatment timing. Older DiD-based claims in school-finance or desegregation research may need re-estimation with modern estimators; a comps question is more likely to probe the classic method's limitation than pure recall. Regression discontinuity and instrumental variables remain comparatively stable. Youth Participatory Action Research and community-based participatory research are being repositioned as direct-to-policy methods in their own right, not just qualitative community engagement, a third methodological pole worth sitting alongside your causal and critical traditions."},
      {name:"Where leadership theory maps onto the same fault line", body:"Instructional and transformational leadership research descends from the outcomes-measurement tradition, its most-cited empirical grounding remains Robinson, Lloyd &amp; Rowe's 2008 meta-analysis comparing effect sizes of leadership types on student outcomes. Distributed leadership and Muhammad Khalifa's Culturally Responsive School Leadership descend instead from the critical/structural and participatory traditions, with current practitioner literature explicitly framing distributed leadership as a corrective to the “myth of the superhero leader.” Treat this as a parallel, third domain running the same axis as your policy-research framework, a strong candidate for the connective section of your own comps answer."}
    ],
    nonprofitCanon: [
      {name:"The one concrete, transferable model", body:"Indiana University Bloomington's O'Neill School (SPEA) PhD Minor in Nonprofits and Civil Society: 12 advisor-approved credit hours (at least 3 of 4 courses from O'Neill), covering financial management and fund development, strategic management, nonprofit HR practices, civil-society/public-policy connections, comparative civil society, research/theoretical frameworks in nonprofit management, and program evaluation, with a 3.0 GPA requirement and a dedicated O'Neill faculty advisor sitting on the student's exams. No flagship Ed Policy program publishes anything like it; this is the model to point to."},
      {name:"Three realistic paths", body:"A joint or dual degree pairing an Ed Policy program with a public-affairs school (the IU model); an individualized cognate built ad hoc from a partner school's nonprofit-management coursework, apparently how this is actually done at universities with both an ed school and a public-affairs, business, or social-work school; or self-directed mastery of the canon here, supplemented by an outside minor field. This is evidently arranged case by case rather than advertised, so it belongs in admissions conversations, not assumed from a catalog."},
      {name:"The five-part canon (Jossey-Bass Handbook of Nonprofit Leadership and Management)", body:"Context and institutional setting (history, legal framework, accountability); leading and governing nonprofits (board governance, executive leadership, ethics, strategic management, social entrepreneurship); managing operations (marketing, advocacy/lobbying, collaboration, program and effectiveness evaluation); developing financial resources (fundraising program design, social enterprise, government contracts, risk management); and leading people (HR practices, volunteer management). This structure functions as a de facto comps outline for the field."},
      {name:"Four theory clusters, and which are most operational for you", body:"DiMaggio &amp; Powell's institutional isomorphism (organizations converge structurally via coercive, mimetic, and normative pressure, chasing legitimacy over performance); John Carver's Policy Governance model (distinguishing organizational “Ends” from operational “means,” and defining Executive Limitations); resource dependence (Pfeffer &amp; Salancik) plus stakeholder theory (Freeman) for board-executive dynamics; and Kania &amp; Kramer's collective impact framework (common agenda, shared measurement, mutually reinforcing activities, continuous communication, a dedicated backbone organization). For your InstitutionalOS work specifically: resource dependence plus isomorphism explains why nonprofits chase funder priorities and mimic peers, Policy Governance plus principal-agent framing is the standard vocabulary for board-executive dynamics, and collective impact is the dominant framework for any cross-sector nonprofit-government-school partnership engagement."},
      {name:"A reframe worth testing with an advisor: nonprofit leadership as the trans-sectoral half of “Leadership”", body:"A real chunk of this canon isn't school-specific to begin with, institutional isomorphism, resource dependence, distributed leadership, and collective impact all get used in K-12/educational-leadership scholarship and in nonprofit-management scholarship alike, because schools, districts, and nonprofits are the same species of organization in institutional-theory terms: mission-driven, resource-dependent, chasing legitimacy from funders and regulators rather than pure performance. Steering your Leadership-strand coursework and electives toward that shared organizational-theory literature, rather than the K-12-specific end of it (instructional leadership, principal-effects research), builds real nonprofit-leadership theory inside the program's existing Leadership component, no cross-school arrangement required for that half. What it doesn't absorb is the practitioner-mechanics half, board governance specifics, fund development, nonprofit HR, nonprofit financial management and law, none of which sits inside any educational-leadership syllabus under any label. Raise the theoretical half as an elective or independent-study request with an advisor directly; keep the IU-style path or self-directed reading for the operational half."}
    ],
    openQuestions: [
      "The national “universal school choice” state count is contested: 16 per EdChoice counting Wyoming (March 2025), 17 with Indiana (April 2025), versus 18 per Ballotpedia counting New Hampshire (June 2025). No single authoritative figure reconciled in this research.",
      "North Carolina's <em>Leandro v. State</em> remained unresolved as of Dec 16, 2025, roughly 22 months after Feb 2024 oral arguments before a Republican-majority state Supreme Court. Check current docket status before citing.",
      "<em>Havens v. U.S. Department of Education</em>, the last live attempt to revive REPAYE for roughly 7 million former SAVE borrowers, was unresolved as of Sept 20, 2026 (no hearing scheduled). Check for a ruling before citing as settled.",
      "HBCU/tribal-college funding figures are unreconciled: one source cites roughly $500 million redirected in Sept 2025, another cites $174 million. This research could not trace either to a single primary Department of Education source.",
      "No education-sector-specific application of Community-Centric Fundraising was found in the literature, flagged as a genuine gap in the field and a possible opening for original contribution in your own practice or dissertation work.",
      "No current (2025-26) source on charter management organizations as a nonprofit-governance model was found, despite CMOs being a major nonprofit vehicle in the choice landscape.",
      "No 2025-26-dated new publication from Sarah Reckhow or Jeffrey Henig on foundation influence was confirmed, though their earlier scholarship sits directly adjacent to the venture-philanthropy critique.",
      "No comprehensive current national teacher-shortage dataset (vacancies by subject and region) was confirmed. Treat single-state pay headlines (South Carolina, Utah) as illustrative, not a trend synthesis.",
      "Full doctoral comps reading lists were not found publicly posted for any of eight flagship programs searched. What's above is inference from published program structure and canonical literature, worth saying plainly to a committee rather than glossing over."
    ]
  };
  var POLICY_DOMAINS = [
    {key:"k12", title:"K-12: funding, civil rights, and a choice experiment turning up negative results", points:[
      "Adequacy litigation is live in multiple states: New Hampshire's consolidated ConVal/Rand case produced a July 2025 Supreme Court ruling that the state's funding is “unconstitutionally low” (the state has spent roughly $4 million defending these suits); North Carolina's <em>Leandro</em> (filed 1994) awaits a ruling from a Republican-majority Supreme Court after February 2024 oral arguments, unresolved as of Dec 16, 2025; Wisconsin saw a new coalition lawsuit in 2025.",
      "The ESSER cliff has landed: the final COVID-relief tranche had to be obligated by Sept 30, 2024, and Georgetown's Edunomics Lab found districts cutting roughly $1,200 per student in 2024-25, with layoffs concentrated in wraparound staff (counselors, social workers, reading coaches) and enrichment programming before core classroom teaching.",
      "Civil-rights enforcement contracted sharply in 2025: <em>Tennessee v. Cardona</em> (Jan 9, 2025) vacated the 2024 Title IX Rule nationwide; Trump's Jan 20, 2025 executive order reverted enforcement to the 2020 rule, retroactive to open investigations. The Office for Civil Rights lost nearly half its staff in March 2025 layoffs; resolution agreements fell 40-70% below prior-year levels even as complaints rose 9%, pushing the caseload above 25,000, a federal judge found the office “currently incapable of addressing the vast majority” of complaints.",
      "The Department of Education itself: no formal abolition, which requires Congress and hasn't occurred, but functional devolution via six interagency agreements by November 2025, Labor now administers K-12 support programs and most Higher Education Act postsecondary grants, Interior manages Indian Education, HHS handles foreign medical-school accreditation and campus childcare.",
      "ESSA accountability waivers reached Iowa (Jan 2026), Louisiana (May 2026), and Indiana (June 2026, the broadest yet), Indiana can now weight graduation rate and test scores at just 20% against 80% for AP coursework, workforce credentials, and honors enrollment, which The Education Trust warns could let states “mask underperformance.”",
      "IDEA funding remains chronically shortchanged: FY2025 federal appropriations covered only about 10.2% of the national Average Per-Pupil Expenditure against the 40% “full funding” target Congress set in 1975, never once reached in fifty years.",
      "The school-choice count is contested: EdChoice counts Wyoming (16th, March 2025) and Indiana (17th, April 2025, removed income caps) as universal-eligibility states; Ballotpedia counts New Hampshire as 18th (June 2025), no single authoritative national figure.",
      "Open enrollment, public school-to-school choice, distinct from private vouchers, expanded on a bipartisan basis in 2025 (Arkansas and Nevada enacted statewide mandates), with 75% of Democrats and 80% of Republicans with school-age children favoring stronger open-enrollment laws, a meaningfully less polarized fight than the ESA/voucher debate.",
      "The sharpest break from received wisdom: Louisiana's voucher program shows achievement losses as large as −0.4 standard deviations (Brookings calls this “extremely large by education policy standards”); Indiana's shows roughly −0.15 SD, for comparison, −0.25 SD is the estimated academic-trajectory hit from COVID-19 disruption itself. This breaks from the smaller, means-tested 2000s-2010s voucher research that often found neutral-to-positive effects; whether voucher schools face the same accountability and testing requirements as public schools appears to be a key moderator.",
      "Teacher shortages remain concentrated by subject and region, special education chronically so, rather than uniform nationally; no comprehensive current national shortage dataset was confirmed.",
      "NCTQ's June 2026 report found 51% of teacher-prep programs now align with the science of reading, up from 25% three years prior, but over 460 of 700+ reviewed programs declined to participate (up to 72% non-participation in Illinois), and roughly 1 in 5 participating programs received an F. NCTQ's president called continued reliance on outdated methods “a form of educational malpractice.”"
    ]},
    {key:"highered", title:"Higher education: repayment rebuilt, accountability politicized, admissions unwound", points:[
      "The One Big Beautiful Bill Act (OBBBA, signed July 4, 2025) rebuilt federal student aid: for loans first disbursed on or after July 1, 2026, borrowers may choose only a new income-tiered Repayment Assistance Plan (forgiveness after 30 years regardless of income, excludes Parent PLUS) or a “Tiered Standard” plan.",
      "SAVE remains enjoined nationwide (the Eighth Circuit dismissed the Department's appeal Feb 18, 2025; interest accrual restarted Aug 1, 2025). <em>Havens v. U.S. Department of Education</em>, the last live attempt to revive REPAYE for roughly 7 million former SAVE borrowers, remained unresolved as of Sept 20, 2026, named plaintiffs cite $64,000-$90,000 tax liabilities tied to the “student loan tax bomb.”",
      "PSLF narrowed: an Oct 30, 2025 rule (effective July 1, 2026) lets the Secretary of Education disqualify nonprofit employers found to have a “substantial illegal purpose,” now facing multi-state litigation from Maryland, Vermont, and Rhode Island. Borrower-defense-to-repayment provisions were also rolled back, reverting to pre-2020 rules for loans originating before July 1, 2035.",
      "FAFSA shows a genuine before/after: after the 2024-25 rollout's severe failures, both the 2025-26 and 2026-27 cycles launched on or ahead of the Oct 1 target, an important distinction for anyone still citing “the FAFSA disaster” as current.",
      "Accountability shows surprising continuity alongside sharp confrontation: the Biden-era Gainful Employment rule survived judicial challenge under the Trump administration's own Department of Education (summary judgment for the Department, Oct 2, 2025), a continuity commentators called surprising given the administration's broader deregulatory posture.",
      "Accreditation is being actively remade: Executive Order 14279 (April 23, 2025) directs accountability for “unlawful discrimination... under the guise of DEI,” requires race/sex-blind outcome reporting, and streamlines switching accreditors, with no implementation deadline set yet.",
      "Harvard functions as the clearest case study in executive-agency funding leverage: a federal task force froze $2.2 billion in research grants and $60 million in contracts (April 14, 2025); a judge ruled the freeze unconstitutional (Sept 3, 2025, final judgment Oct 17, 2025), only for the government to file a new lawsuit in March 2026 seeking to rescind the restored grants under a new legal theory. OBBBA separately raised Harvard's endowment excise tax from 1.4% toward roughly 8% starting FY2027, an estimated $300 million/year.",
      "Post-<em>SFFA</em> (2023) enrollment data settles the empirical question even if interpretation remains contested: Black student enrollment declined at 24 of 29 elite institutions reporting 2025 data; Princeton's incoming 2025 class was just 5% Black, “the lowest representation since 1968.”",
      "Affordability policy shows bipartisan durability decoupled from the admissions fight: Rhode Island made community college free in 2025; Tennessee Promise continues.",
      "OBBBA's “Workforce Pell” extends eligibility to programs as short as 8 weeks and opens it to for-profit and unaccredited, state-approved programs under a “70-70” completion/job-placement standard, creating a parallel, state-run quality-assurance track alongside the federal accreditation system being reformed at the same time.",
      "HBCU/MSI funding in Sept 2025 was a zero-sum reallocation, not a net increase: funds redirected to HBCUs and tribal colleges came directly from cutting Hispanic-Serving Institution and other minority-serving grants days earlier, alongside cuts to charter-school and American history/civics funding."
    ]},
    {key:"earlyai", title:"Early childhood & AI: near-elimination narrowly avoided, governance begins", points:[
      "Head Start survived, barely: the administration's draft FY2026 HHS budget (reported April 17, 2025) proposed eliminating it entirely, a program serving nearly 800,000 children across 17,000+ centers on roughly $12.2 billion in FY2024 funding. It escaped the formal May 2, 2025 budget proposal, but advocates describe the result as vulnerable “flat funding,” not restoration.",
      "Child care subsidies (CCDBG) are eroding more quietly: they already reached only about 15% of eligible children as of 2021, and a proposed flat-funding of CCDBG from FY2025 to FY2026 would mean roughly 50,000 fewer children served over two years per CLASP.",
      "OBBBA's 2026 child care tax changes are incremental and skew toward middle/upper-income families (a raised, still-nonrefundable Child and Dependent Care Tax Credit, a Dependent Care FSA cap increase, an enhanced employer credit), doing little for the lowest-income families CCDBG is meant to reach.",
      "State pre-K is plateauing: NIEER's 2025 Yearbook found nearly 1.8 million children enrolled nationally (37% of 4-year-olds), but growth slowed to only about 44,000 new children, 20 states lost enrollment year-over-year, and only six states met all 10 quality benchmarks.",
      "The Perry consensus is complicated: updated Perry Preschool research (Heckman, participants now past 50) shows strong intergenerational effects, but Vanderbilt's Peabody Research Institute, tracking 2,990 children through Tennessee's statewide Voluntary Pre-K program, found attendees performed worse than non-attendees by sixth grade, with more discipline issues and higher special-education referrals, 85% of Tennessee VPK classrooms scored below “good” on quality measures.",
      "The field's live debate has shifted from whether early-childhood education works, largely settled affirmatively for small, intensive, high-quality programs, to whether it works at the scale and quality states can actually deliver.",
      "AI policy: federal action is encouraging and agenda-setting, not regulatory (Trump's April 23, 2025 executive order prompted a Dept. of Education guidance letter on allowable AI uses of grant funds). The real regulatory action is at the state level: by Oct 2025, 34 states plus Puerto Rico had issued AI guidance, and the field shifted from 2023-24's permissive “AI literacy” framing to 2025-26's binding “AI governance,” with Idaho, Maryland, Oklahoma, and Virginia enacting district AI-policy mandates in 2025. California's AB 1159 (2025) is the privacy template to watch, it bars using student data to train generative-AI systems absent genuine educational purpose and adds a limited private right of action.",
      "A well-documented “AI divide”: suburban, majority-white, low-poverty districts are roughly twice as likely to provide teacher AI training as urban, rural, or high-poverty districts, and only 19% of teachers report their school even has an AI policy, most are teaching themselves."
    ]},
    {key:"philanthropy", title:"Philanthropy & the nonprofit sector: the deepest connection to your practice", points:[
      "Total U.S. charitable giving hit a record $617.2 billion in 2025 (up 5.7% over 2024); education was the fastest-growing major subsector, up 11.7% to $92.01 billion, driven substantially by mega-gifts including MacKenzie Scott's $1.1 billion in education giving.",
      "The 2010s “Big Bet” funder coalition is splitting apart, not consolidating. The Gates Foundation (on track for its planned 2045 closure) narrowed to a single K-12 lever: a $1.1 billion, four-year commitment making math roughly 100% of its K-12 instructional budget through 2026 (up from ~40%), concentrated on Black, Latino, and low-income students, alongside a pivot toward AI-powered tools.",
      "The Chan Zuckerberg Initiative went further: it cut roughly 70 jobs (about 8% of staff) in early 2026 to pivot fully to AI-powered biomedical research, stepping back from education, criminal justice, housing, and community development entirely, a CZI-founded tuition-free school for low-income students is shuttering as a direct consequence.",
      "Two funders expanded sharply against that retreat: the Walton Family Foundation committed over $220 million (May 2026) to K-8 literacy and math outcomes plus a charter-facilities expansion; MacKenzie Scott directed over $1.2 billion to HBCUs over five years, more than $700 million in 2025 alone, named gifts include Howard University, UNCF, and the Thurgood Marshall College Fund, explicitly framed as counteracting a 14.4% federal cut to Title III funding.",
      "“AI in education” is becoming the dominant philanthropic theme for 2026 onward, both Gates's and CZI's resource redirections point there, tracking directly with the AI-governance shift above.",
      "The venture-philanthropy critique (Megan Tompkins-Stange's <em>Policy Patrons</em>, adjacent to Sarah Reckhow's and Jeffrey Henig's foundation-influence scholarship) centers on power asymmetry: wealthy, unelected donors importing venture logic into public education, disproportionately targeting poorer, higher-minority districts, some critics use the word “colonization.”",
      "This research found abundant critique material but thin, explicitly named defense literature, what functions as defense in current discourse looks more like funder self-justification than an independent scholarly counter-literature (one partial exception: Jay P. Greene's market-friendly argument that philanthropic dollars are small relative to total K-12 spending).",
      "The “colonization” framing sits in real tension with Scott's own giving, which is unrestricted, trust-based, and non-programmatic, suggesting the critique literature needs to differentiate funder types (strategic/programmatic control vs. unrestricted/trust-based) more sharply than it has. This tension, strategic philanthropy (Gates, Walton) versus trust-based philanthropy (Scott), is flagged as the single most professionally load-bearing finding in this report for your own consulting practice.",
      "Community schools and collective-impact networks, led institutionally by StriveTogether's Cradle to Career Network, remain the dominant nonprofit-district partnership model, with positive associations reported against proficiency, graduation, and college-going, contingent on genuine comprehensive collaboration, not superficial adoption. The evidence base is comparative and correlational, not yet gold-standard causal.",
      "2025-26 delivered a direct federal collision with that model: the Department of Education terminated 19 Full-Service Community Schools grants worth $167.5 million in 2025, part of a broader disruption of at least $12 billion in federal education funding and 760+ cancelled grants in the administration's first year. Some terminations were found by federal judges to violate impoundment law and were partially reinstated, but the fight over executive grant-termination authority remains unsettled.",
      "The structural consequence: nonprofit and philanthropic actors are effectively being asked to backfill a federal role, but education philanthropy's record $92 billion in 2025 giving is structurally incapable of replacing $12 billion-plus in disrupted federal funding with the same programmatic continuity. No usable current source on charter management organizations as a nonprofit-governance model was found, a significant gap given CMOs are a major nonprofit vehicle in the choice landscape.",
      "Two threads connect directly to your own practice: Community-Centric Fundraising (Vu Le, NonprofitAF) mounts a critique of donor-centered fundraising that overlaps with the venture-philanthropy critique at a different point in the funding chain, but no education-sector-specific application of CCF principles was found, a genuine gap and a potential opening in your own practice area. And the federal-cuts-plus-philanthropic-backfill dynamic above is the direct, current market condition your consulting practice and InstitutionalOS diagnostic sit inside; financial-sustainability and revenue-diversification theory (Chang &amp; Tuckman, Woods Bowman) is not abstract for your clients right now."
    ]}
  ];
  function renderPolicyDomainHTML(domain){
    var items = domain.points.map(function(p){ return '<li>' + p + '</li>'; }).join("");
    return '<div class="cred-guide cred-notes"><div class="guide-block"><div class="guide-body"><ul>' + items + '</ul></div></div></div>';
  }
  function renderDoctoralPrep(){
    document.getElementById("dp-theory").innerHTML = DOCTORAL_PREP.theoryThreads.map(function(t){
      return '<div class="org-card"><div class="org-name">' + esc(t.name) + '</div><div class="org-desc">' + t.body + '</div></div>';
    }).join("");

    document.getElementById("dp-nonprofit-canon").innerHTML = DOCTORAL_PREP.nonprofitCanon.map(function(c){
      return '<div class="org-card"><div class="org-name">' + esc(c.name) + '</div><div class="org-desc">' + c.body + '</div></div>';
    }).join("");

    document.getElementById("dp-policy").innerHTML = POLICY_DOMAINS.map(function(d, i){
      var pid = "dp-domain-" + d.key;
      return '<div class="cred-guide-row"><button type="button" class="cred-guide-toggle notes-toggle" data-notes-toggle="' + pid + '" aria-expanded="false"><span class="arrow">&#9656;</span> ' + esc(d.title) + '</button></div>' +
        '<div class="cred-guide-row"><div id="' + pid + '" hidden>' + renderPolicyDomainHTML(d) + '</div></div>';
    }).join("");

    document.getElementById("dp-openq").innerHTML = DOCTORAL_PREP.openQuestions.map(function(q){
      return '<li>' + q + '</li>';
    }).join("");

    document.querySelectorAll('#dp-policy [data-notes-toggle]').forEach(function(btn){
      btn.addEventListener("click", function(){
        var panel = document.getElementById(btn.getAttribute("data-notes-toggle"));
        var open = panel.hidden;
        panel.hidden = !open;
        btn.setAttribute("aria-expanded", open ? "true" : "false");
      });
    });
  }

  // ---------- policy & leadership (legal/regulatory reference + weekly digest) ----------
  // Distinct from Doctoral Prep's POLICY_DOMAINS above: that section is static,
  // one-time comps-exam research spanning K-12/higher ed/early childhood-AI/
  // philanthropy for a doctoral committee. This section is a standing,
  // periodically-refreshed practitioner reference on the law and regulation that
  // governs running a nonprofit and the higher-ed regulatory agenda this
  // practice's clients sit inside, plus a Field-Notes-style weekly digest.
  // Researched Oct 19, 2026; reuses renderPolicyDomainHTML() above, which is
  // generic over any {key, title, points} domain object.
  var LEADERSHIP_POLICY_DOMAINS = [
    {key:"nonprofit", title:"Nonprofit tax, governance & charitable-solicitation law", points:[
      "The One Big Beautiful Bill Act (OBBBA, signed July 4, 2025) expanded the Section 4960 excise tax: the 21% tax on nonprofit/university executive pay over $1 million now applies to every covered employee, not just an organization's five highest-paid, effective for tax years beginning after Dec 31, 2025. Covered-employee status is permanent once triggered, and the review period for determining who's covered reaches back to compensation in tax years beginning after Dec 31, 2016.",
      "The private foundation excise tax on net investment income stays flat at 1.39%: the House had passed a tiered version running up to 10% for the largest foundations, but the Senate Finance Committee dropped it (released June 16, 2025) and it did not survive into the signed law.",
      "2026 brings a new permanent $1,000 (single) / $2,000 (joint) above-the-line charitable deduction for non-itemizers on cash gifts only, donor-advised-fund and supporting-organization gifts don't qualify, alongside a new 0.5%-of-AGI floor on itemized giving and a 1%-of-taxable-income floor on corporate giving, both of which make marginal giving slightly less favorable even as the non-itemizer deduction broadens who gets anything at all.",
      "Bipartisan pressure to tighten donor-advised-fund payout rules and raise the private-foundation 5% minimum payout to 6% remains stalled in Congress as of 2026; the Accelerating Charitable Efforts (ACE) Act is the longstanding vehicle discussed, but this research could not confirm its current-Congress status, treat as unconfirmed rather than pending as introduced.",
      "Florida enacted a comprehensive rewrite of its Nonprofit Corporation Act (HB 797), effective July 1, 2026: director fiduciary-duty standards are codified in statute for the first time, minimum board size drops to one director generally (three for 501(c)(3)s), director terms default to one year, and officers and directors can now bring derivative suits without first demanding board action if demand would be futile.",
      "Minnesota's Attorney General sued the nonprofit Act for Cause and its president (filed Jan 6, 2026) for alleged self-dealing, commingled personal and charity finances, and operating without a functioning board, a live, concrete illustration of exactly the fiduciary-duty exposure Florida's rewrite above is trying to get ahead of.",
      "State attorneys general are reported, per an April 2026 Georgetown Law conference panel, to be sharpening scrutiny of fiscal-sponsorship arrangements and nonprofit governance and fundraising practices generally in 2026, though no additional named case beyond Minnesota's confirms this as a count-level trend.",
      "South Carolina broadened its charitable-solicitation disclosure law (effective May 18, 2026): the duty to state a charity's legal name and purpose at the start of a solicitation now extends beyond professional solicitors to the charitable organization itself and to commercial co-venturers, while small-organization exemption thresholds rose from $7,500 to $10,000 in gross revenue.",
      "On donor privacy, nearly five years after <em>Americans for Prosperity Foundation v. Bonta</em> (2021) struck down California's compelled major-donor disclosure, no federal donor-privacy statute has passed; this research could not confirm which, if any, state disclosure bills considered in recent years were actually enacted in 2025-2026, that specific question is flagged below as unresolved."
    ]},
    {key:"highered", title:"Higher education: regulatory agenda, DEI enforcement, and institutional finance", points:[
      "OBBBA also restructured the Section 4968 endowment excise tax on private colleges and universities: the flat 1.4% rate becomes a tiered 1.4% / 4% / 8% rate based on \"student-adjusted endowment,\" and the student-count threshold for coverage rises from 500 to 3,000 tuition-paying students, effective for tax years beginning after Dec 31, 2025.",
      "The Department of Education formally rescinded the 2024 Title IX rule on Sept 29, 2026, reinstating the 2020 framework (courts had already vacated the 2024 rule, so this made the existing practice official); a further rule defining \"sex\" as biological sex is targeted for mid-2026 following the Supreme Court's <em>West Virginia v. B.P.J.</em> decision (June 30, 2026).",
      "Accreditation is being actively remade under Executive Order 14279 (April 2025): a negotiated-rulemaking committee (\"AIM\") met through April-May 2026 to lower barriers for new accreditors, bar accreditor standards that \"require or facilitate discrimination based on immutable characteristics,\" and rein in misleading \"regional accreditor\" labeling, though under federal Master Calendar rules no resulting change can take effect before July 1, 2027.",
      "DEI-related enforcement intensified through 2026: the Fourth Circuit's <em>NADOHE v. Trump</em> ruling (Feb 6, 2026) vacated the injunction that had been blocking enforcement of Executive Orders 14151/14173, clearing federal agencies to enforce DEI-related funding conditions; DOJ opened investigations into race-conscious medical-school admissions at 15 universities (June 4, 2026); and the EEOC's June 2026 enforcement plan prioritizes disparate-treatment theories against aspirational diversity goals and \"diverse slate\" hiring policies.",
      "Donor-restricted, race-based scholarships are a live institutional flashpoint: Iowa's Supreme Court (<em>In re Ezra L. Totton Scholarship</em>, decided June 5, 2026) held a public university can seek to modify a race-restricted scholarship post-<em>SFFA</em>, but rejected the University of Iowa's proposed substitute criteria for lacking support in the donor's intent, remanding with release or redirection (e.g., to an HBCU) as the available paths.",
      "ED's broader 2026 rulemaking agenda also targets Title IV financial-responsibility and cash-management rules (reportedly aimed at easing the 90/10 Rule), a Title VI disparate-impact rescission, and FERPA revisions, agency alerts caution the agenda's own target dates are described as \"aspirational,\" not binding.",
      "The NIH's proposed flat 15% indirect-cost-rate cap on research grants is dead for now: the First Circuit unanimously upheld a permanent injunction against it (Jan 5, 2026) and DOJ let its Supreme Court appeal deadline lapse (Apr 6, 2026), but the administration's FY2027 budget proposes the same cap again, so institutional research-funding exposure here is paused, not resolved."
    ]}
  ];
  var POLICY_UPDATES = {
    "Nonprofit Tax & Compliance": [
      {h:"The $1M pay threshold now covers every employee, not just the top five", s:"OBBBA's expanded Section 4960 excise tax reaches any covered employee over $1 million in compensation, effective for tax years beginning after Dec 31, 2025, a much wider net for mid-sized nonprofits and universities with more than five highly-paid staff.", src:"CPA Practice Advisor, May 28, 2026", url:"https://www.cpapracticeadvisor.com/2026/05/28/expanded-section-4960-rules-create-new-financial-planning-challenges-for-nonprofits/184105/"},
      {h:"Private foundations keep their flat 1.39% rate", s:"A House-passed tiered excise tax running up to 10% for the largest foundations was dropped by the Senate before OBBBA's final passage, foundations avoided what would have been their biggest tax increase in decades.", src:"PKF O'Connor Davies, Jun 17, 2025", url:"https://www.pkfod.com/insights/foundations-breathe-a-sigh-of-relief-senate-releases-its-version-of-the-one-big-beautiful-bill/"},
      {h:"A new above-the-line gift deduction arrives in 2026, with new floors attached", s:"Non-itemizers can now deduct $1,000 (single) or $2,000 (joint) in cash gifts without itemizing, but itemized and corporate giving now face new 0.5%-of-AGI and 1%-of-taxable-income floors before any deduction counts at all.", src:"WealthManagement.com, 2026", url:"https://www.wealthmanagement.com/philanthropy/charitable-contribution-deduction-changes-under-the-obbba"}
    ],
    "DEI Litigation & Civil Rights Enforcement": [
      {h:"Fourth Circuit clears the way for DEI executive orders to be enforced", s:"NADOHE v. Trump vacated the injunction blocking Executive Orders 14151/14173, the facial ruling doesn't resolve whether any specific program or termination is lawful, but it removes the broad block on enforcement.", src:"CalChamber HR Watchdog, Feb 2026", url:"https://hrcalifornia.calchamber.com/articles/fourth-circuit-court-vacates-injunction-against-dei-executive-order"},
      {h:"DOJ opens admissions investigations at 15 medical schools", s:"Civil Rights Division investigations into possible race discrimination in medical-school admissions, following earlier findings against UCLA and Yale, signal continued federal pressure on race-conscious admissions practices.", src:"Gibson Dunn DEI Task Force Update, Jun 8, 2026", url:"https://www.gibsondunn.com/wp-content/uploads/2026/06/dei-task-force-update-june-8-2026.pdf"},
      {h:"Iowa's high court rejects a university's workaround on a race-restricted scholarship", s:"The state Supreme Court agreed a public university can seek to modify a scholarship restricted by race post-SFFA, but rejected its proposed first-generation-student substitute as unsupported by the donor's actual intent, remanding toward release or redirection instead.", src:"Holland & Knight, Jun 2026", url:"https://www.hklaw.com/en/insights/publications/2026/06/iowa-supreme-court-addresses-race-restrictive-scholarships"}
    ],
    "Higher Ed Regulatory Agenda": [
      {h:"Title IX formally reverts to the 2020 rule", s:"ED's Sept 29, 2026 action removed the already-vacated 2024 rule from the federal code via direct final rule, codifying what institutions had already been operating under since early 2025; a further rule defining sex as biological sex is targeted next.", src:"Holland & Knight, Sep 29, 2026", url:"https://www.hklaw.com/en/insights/publications/2026/09/education-department-formally-repeals-2024-title-ix-rule"},
      {h:"Accreditation reform rulemaking runs through 2026, can't bind until mid-2027", s:"The AIM negotiated-rulemaking committee met through May 2026 to lower barriers for new accreditors and strip discrimination-facilitating standards from recognition criteria, but Master Calendar rules mean no resulting change takes effect before July 1, 2027.", src:"Saul Ewing, 2026", url:"https://www.saul.com/insights/alert/u-s-department-education-announces-rulemaking-committee-reform-accreditation-whats"},
      {h:"The NIH's 15% indirect-cost cap is dead, for now", s:"The First Circuit upheld a permanent injunction against the flat cap and DOJ let its Supreme Court appeal deadline lapse, but the FY2027 budget proposes the same cap again, research-funding institutions should treat this as paused, not resolved.", src:"CASRAI, 2026", url:"https://casrai.org/news/nih-indirect-cost-cap-litigation-how-it-ended"}
    ],
    "Governance & Charitable Solicitation": [
      {h:"Florida codifies nonprofit directors' fiduciary duties in statute", s:"HB 797's comprehensive rewrite, effective Jul 1, 2026, moves fiduciary-duty standards from case law into statute for the first time, alongside new derivative-suit and conflict-of-interest rules, a template worth watching for other states.", src:"Venable, Jul 2026", url:"https://www.venable.com/insights/publications/2026/07/florida-revamps-nonprofit-corporation-act"},
      {h:"Minnesota AG sues a nonprofit president over alleged self-dealing", s:"The complaint alleges a transferred commercial property, commingled personal and charity funds, and an organization operating without a functioning board, a concrete illustration of the exposure Florida's statute is written to guard against.", src:"Minnesota AG press release, Jan 6, 2026", url:"https://www.ag.state.mn.us/Office/Communications/2026/01/06_ActForCause.asp"},
      {h:"South Carolina widens who must disclose a charity's purpose when soliciting", s:"The disclosure duty now reaches charitable organizations and commercial co-venturers directly, not just professional solicitors, effective May 18, 2026, while raising small-org exemption thresholds.", src:"Labyrinth Inc., 2026", url:"https://labyrinthinc.com/south-carolina-expands-charitable-solicitation-disclosure-requirements-for-nonprofits/"}
    ]
  };
  var LEADERSHIP_OPEN_QUESTIONS = [
    "The private foundation excise tax's final 1.39% rate is confirmed only through secondary sources (counsel alerts and the Chronicle of Philanthropy summarizing the Senate's dropped provision), not by reading the enacted Public Law text directly. Verify against the statute or an IRS/Joint Committee on Taxation summary before treating as fully settled.",
    "The Accelerating Charitable Efforts (ACE) Act's current status in this Congress, reintroduced, amended, or still pending, could not be confirmed; available material dates to its original 2021 introduction. Treat any specific current-bill details as unconfirmed.",
    "No 2025-2026 Uniform Law Commission revision to a model nonprofit corporation act was found. That may mean there isn't one, or that it wasn't surfaced, this is a gap, not a confirmed negative.",
    "The Gainful Employment / Financial Value Transparency rule's 2026 status under the current Department of Education leadership could not be confirmed; the only detailed source describing its substance predates the 2025 administration change and the current administration's regulatory agenda is not addressed by it.",
    "Beyond Arizona's 2022 ballot measure, which specific state donor-disclosure bills (of the roughly 19 states reported considering such legislation as of 2023) were actually enacted in 2025-2026 could not be confirmed and needs a fresh state-by-state check.",
    "The EEOC's proposed rescission of EEO-1 reporting (proposed May 15, 2026) leaves the 2026 reporting cycle's status unresolved in the sources checked; confirm current requirements directly with the EEOC before relying on this for compliance planning.",
    "Several sources above (Gibson Dunn, Nixon Peabody, Loeb & Loeb, and other law-firm client alerts) summarize primary law rather than quoting it directly. Before citing any single claim as settled, pull the underlying court opinion, statute section, or Federal Register notice."
  ];
  function renderPolicyLeadership(){
    document.getElementById("pld-domains").innerHTML = LEADERSHIP_POLICY_DOMAINS.map(function(d){
      var pid = "pld-domain-" + d.key;
      return '<div class="cred-guide-row"><button type="button" class="cred-guide-toggle notes-toggle" data-notes-toggle="' + pid + '" aria-expanded="false"><span class="arrow">&#9656;</span> ' + esc(d.title) + '</button></div>' +
        '<div class="cred-guide-row"><div id="' + pid + '" hidden>' + renderPolicyDomainHTML(d) + '</div></div>';
    }).join("");

    document.getElementById("pld-refreshed").textContent = "Last refreshed Oct 19, 2026";
    document.getElementById("pld-body").innerHTML = Object.keys(POLICY_UPDATES).map(function(cat){
      var cards = POLICY_UPDATES[cat].map(function(d){
        return '<div class="digest-card"><h4>' + esc(d.h) + '</h4><p>' + esc(d.s) + '</p>' +
          '<div class="digest-meta"><span>' + esc(d.src) + '</span> &middot; <a href="' + d.url + '" target="_blank" rel="noopener">Read more</a></div></div>';
      }).join("");
      return '<div class="digest-group"><h3>' + esc(cat) + '</h3>' + cards + '</div>';
    }).join("");

    document.getElementById("pld-openq").innerHTML = LEADERSHIP_OPEN_QUESTIONS.map(function(q){
      return '<li>' + esc(q) + '</li>';
    }).join("");

    document.querySelectorAll('#pld-domains [data-notes-toggle]').forEach(function(btn){
      btn.addEventListener("click", function(){
        var panel = document.getElementById(btn.getAttribute("data-notes-toggle"));
        var open = panel.hidden;
        panel.hidden = !open;
        btn.setAttribute("aria-expanded", open ? "true" : "false");
      });
    });
  }

  // ---------- boot (called from FIOS's own renderAll(), not self-invoked) ----------
  function renderAdvancementDesk(){
    renderVocabulary();
    renderGlossary();
    renderWeek();
    renderGlance();
    updateOpenStat();
    renderCreds();
    renderQuizRoot();
    updateQuizStat();
    renderOrgs();
    renderFieldNotes();
    renderPeople();
    renderJobs();
    renderOrgIntel();
    renderGiftPlaybook();
    renderDoctoralPrep();
    renderPolicyLeadership();
  }

  renderAll();
})();
