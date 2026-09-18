(function(){
  "use strict";

  // Standalone on purpose: this page is never behind the login, so it never
  // loads app.js (which the server won't even serve without a session
  // cookie - see /app.js in server.js). Everything this page needs is
  // duplicated here in miniature rather than shared, so a future change to
  // the internal app can never accidentally change what an anonymous
  // visitor sees.

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

  var STATE_NAME_BY_ABBR = {AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",CT:"Connecticut",DE:"Delaware",FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming",DC:"District of Columbia"};

  var CATEGORY_LABELS = {religion:"Religion",education:"Education","human-services":"Human services",health:"Health","public-society-benefit":"Public-society benefit","arts-culture-humanities":"Arts, culture & humanities","international-affairs":"International affairs","environment-animals":"Environment & animals",foundations:"Foundations",other:"Other / unspecified"};

  function render(gifts){
    var listEl = document.getElementById("gp-ticker-list");
    var cardEl = document.getElementById("gp-card");
    var noteEl = document.getElementById("gp-load-note");

    var total = gifts.reduce(function(sum,g){ return sum + (Number(g.amount) || 0); }, 0);
    var states = {};
    gifts.forEach(function(g){ if(g.state) states[g.state] = 1; });
    document.getElementById("gp-stat-count").textContent = gifts.length;
    document.getElementById("gp-stat-total").textContent = fmtMoneyShort(total);
    document.getElementById("gp-stat-states").textContent = Object.keys(states).length;

    if(gifts.length === 0){
      noteEl.textContent = "Nothing shared on this public page yet. Check back soon.";
      cardEl.hidden = true;
      return;
    }
    noteEl.hidden = true;
    cardEl.hidden = false;

    listEl.innerHTML = gifts.map(function(g){
      var who = g.donor ? (esc(g.donor) + " &rarr; " + esc(g.org || "Untitled")) : esc(g.org || "Untitled");
      var stateTag = g.state ? (' &middot; ' + esc(STATE_NAME_BY_ABBR[g.state] || g.state)) : "";
      return '<div class="gift-card">' +
        '<div class="gift-card-head"><h4>' + who + '</h4><span class="gift-amount">' + fmtMoneyExact(g.amount) + '</span></div>' +
        (g.headline || g.summary ? '<p>' + esc(g.headline || g.summary) + '</p>' : '') +
        '<div class="gift-meta"><span class="pill">' + esc(CATEGORY_LABELS[g.category] || g.category || "Other") + '</span><span>' + fmtDate(g.announcedAt) + stateTag + '</span>' +
        (g.source ? (' &middot; <span>' + esc(g.source) + '</span>') : '') +
        (g.url ? (' &middot; <a href="' + esc(g.url) + '" target="_blank" rel="noopener">Read more</a>') : '') +
        '</div></div>';
    }).join("");
  }

  fetch("/api/public/giving-landscape")
    .then(function(r){ if(!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(function(data){ render(data.gifts || []); })
    .catch(function(err){
      document.getElementById("gp-load-note").textContent = "Could not load this page right now. Please try again shortly.";
      console.error(err);
    });
})();
