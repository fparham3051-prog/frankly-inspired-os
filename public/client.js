// Client workspace: what one client organization sees. The link is the key.
(function () {
  "use strict";
  const parts = location.pathname.split("/").filter(Boolean);
  const preview = parts[0] === "client-preview";
  const key = decodeURIComponent(parts[1] || "");
  const api = preview ? "/api/clients/" + encodeURIComponent(key) + "/workspace" : "/api/client/" + encodeURIComponent(key);
  const app = document.getElementById("app");
  let W = null, tab = (location.hash || "#overview").slice(1), replyTo = "", draft = "";

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const day = (s) => { if (!s) return ""; const d = new Date(String(s).length === 10 ? s + "T12:00:00" : s); return isNaN(d) ? esc(s) : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); };
  const when = (s) => { const d = new Date(s); return isNaN(d) ? "" : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); };
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const bar = (a, b) => `<div class="bar" role="img" aria-label="${pct(a, b)}% done"><i style="width:${pct(a, b)}%"></i></div>`;
  const signed = (n) => (n > 0 ? "+" : "") + n;

  async function load() {
    try {
      const r = await fetch(api, { credentials: "same-origin", cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "This workspace could not be opened.");
      W = j; render();
    } catch (e) { app.innerHTML = `<div class="card"><h2>We couldn't open this workspace</h2><p>${esc(e.message)}</p></div>`; }
  }

  function growth() {
    const g = W.growth;
    if (!g) return "";
    const moved = g.baseline && g.baseline.score !== g.score ? ` That's ${g.score > g.baseline.score ? "up" : "down"} ${Math.abs(g.score - g.baseline.score)} from where you started.` : "";
    return `<div class="card"><h2>Your Growth Pathway</h2>
      <p>You're at <b>stage ${esc(g.stage)}, ${esc(g.stageName)}</b>. Stage Readiness Score: <b>${esc(g.score)} of ${esc(g.outOf)}</b> (${esc(String(g.band || "").toLowerCase())}).${moved}</p>
      <p class="small">${g.pillars.map((p) => esc(p.name) + " " + esc(p.score) + "/4").join(" · ")}</p>
      ${g.nextHires.length ? `<p><b>What to build next:</b> ${g.nextHires.map(esc).join("; ")}</p>` : ""}
      ${g.fundraising ? `<p><b>How to fund it:</b> ${esc(g.fundraising)}</p>` : ""}
      ${g.boardGaps.length ? `<p><b>Your board:</b> ${g.boardGaps.map(esc).join("; ")}</p>` : ""}
      <p class="small muted">Planning guidance, not legal or accounting advice.</p></div>`;
  }

  function overview() {
    const p = W.plan;
    return `${p ? `<div class="card"><h2>Your 90-Day Improvement Plan</h2>
      ${p.target ? `<p><b>Target:</b> ${esc(p.target)}</p>` : ""}${p.baseline ? `<p class="muted small">Where you started: ${esc(p.baseline)}</p>` : ""}
      <p class="small">${p.actionsDone} of ${p.actionsTotal} actions done${p.actionsBlocked ? ` · ${p.actionsBlocked} waiting on something` : ""}${p.actionsOverdue ? ` · ${p.actionsOverdue} past due` : ""}</p>${bar(p.actionsDone, p.actionsTotal)}
      ${p.next ? `<p><b>Next:</b> ${esc(p.next)}</p>` : ""}
      <p class="small muted">Started ${day(p.startDate)}${p.review90On ? ` · 90-day review ${p.review90Done ? "held" : day(p.review90On)}` : ""}${p.reassessOn ? ` · six-month reassessment ${p.reassessDone ? "held" : day(p.reassessOn)}` : ""}</p></div>`
      : `<div class="card"><h2>Your plan</h2><p class="muted">Your 90-Day Improvement Plan will show here once it's set.</p>${W.constraint ? `<p><b>What we're working on:</b> ${esc(W.constraint)}</p>` : ""}</div>`}
    ${growth()}
    <div class="stats">
      <div class="stat"><b>${W.projects.reduce((a, x) => a + x.done, 0)}/${W.projects.reduce((a, x) => a + x.total, 0)}</b><span class="small muted">tasks done</span></div>
      <div class="stat"><b>${W.outcomes.sessions.done}</b><span class="small muted">sessions delivered</span></div>
      <div class="stat"><b>${W.decisions.length}</b><span class="small muted">decisions recorded</span></div>
      ${W.outcomes.comparison ? `<div class="stat"><b>${signed(W.outcomes.comparison.overallChange)}</b><span class="small muted">change in your overall score</span></div>` : ""}
    </div>
    ${W.portalUrl ? `<div class="card" style="margin-top:14px"><h2>Your Diagnostic report</h2><p class="small">Your full scores, the constraint we found and the plan's details live in your InstitutionalOS report.</p><a class="btn" href="${esc(W.portalUrl)}" target="_blank" rel="noopener noreferrer">Open your report</a></div>` : ""}
    <p class="small muted">Questions? Write in Conversation, or email ${W.consultant.email ? `<a href="mailto:${esc(W.consultant.email)}">${esc(W.consultant.name)}</a>` : esc(W.consultant.name)}.</p>`;
  }

  function work() {
    if (!W.projects.length) return `<div class="card"><p class="muted">The work we're doing together will show here.</p></div>`;
    return W.projects.map((p) => `<div class="card"><h2>${esc(p.name)}</h2>
      <p class="small muted">${p.done} of ${p.total} done${p.due ? ` · due ${day(p.due)}` : ""}</p>${bar(p.done, p.total)}
      ${p.tasks.map((t) => `<div class="task ${t.done ? "done" : ""}"><div><div class="t">${esc(t.title)}</div><div class="small muted">${[t.section, t.who, t.done && t.doneAt ? "done " + day(t.doneAt) : t.due ? "due " + day(t.due) : ""].filter(Boolean).map(esc).join(" · ")}</div></div>
        <span class="pill ${t.done ? "ok" : t.status === "Waiting on something" ? "wait" : ""}">${esc(t.status)}</span></div>`).join("")}</div>`).join("");
  }

  function talk() {
    const roots = W.messages.filter((m) => !m.parent);
    const one = (m, reply) => `<div class="msg ${reply ? "reply" : ""}"><span class="who">${esc(m.from)}</span>${m.team ? ' <span class="small muted">' + esc(W.consultant.short || W.consultant.firm) + '</span>' : ""} <span class="small muted">${when(m.at)}</span>${m.decision ? '<span class="flag">Decision</span>' : ""}
      <div class="text">${m.deleted ? '<span class="muted">Message removed</span>' : esc(m.text)}</div>
      ${!reply && !preview ? `<button class="linkbtn small noprint" data-reply="${esc(m.id)}">Reply</button>` : ""}</div>`;
    const box = preview ? `<p class="small muted">Preview: your team answers from Projects & Team, in “Conversation with the client”.</p>` : `<form id="say" class="noprint" style="margin-top:12px">
      ${replyTo ? `<p class="small">Replying to ${esc((W.messages.find((m) => m.id === replyTo) || {}).from || "a message")} · <button type="button" class="linkbtn" data-reply="">cancel</button></p>` : ""}
      <label class="small muted" for="say-text">${replyTo ? "Your reply" : "Write to the " + esc(W.consultant.short || W.consultant.firm) + " team"}</label>
      <textarea id="say-text" required maxlength="8000">${esc(draft)}</textarea>
      <div style="margin-top:8px"><button class="btn" type="submit">Send</button> <span class="small muted" id="say-note"></span></div></form>`;
    return `<div class="card"><h2>Conversation</h2>
      ${roots.length ? roots.map((m) => one(m, false) + W.messages.filter((r) => r.parent === m.id).map((r) => one(r, true)).join("")).join("") : '<p class="muted">No messages yet.</p>'}
      ${box}</div>
      ${W.decisions.length ? `<div class="card"><h2>Decisions</h2>${W.decisions.map((d) => `<div class="msg"><span class="small muted">${day(d.at)} · ${esc(d.from)}</span><div class="text">${esc(d.text)}</div></div>`).join("")}</div>` : ""}`;
  }

  function outcomes() {
    const o = W.outcomes, c = o.comparison;
    const scores = c ? `<div class="card"><h2>Scores: ${esc(c.baselineLabel || "at the start")} and today</h2>
      <p>Overall <b>${c.overallBefore}</b> → <b>${c.overallAfter}</b> <span class="${c.overallChange >= 0 ? "up" : "down"}">(${signed(c.overallChange)})</span></p>
      <table class="cmp"><thead><tr><th>Area</th><th>${day(c.baselineDate)}</th><th>Today</th><th>Change</th></tr></thead><tbody>
      ${(c.dimensions || []).map((d) => `<tr><td>${esc(d.name)}</td><td>${d.before}</td><td>${d.after}</td><td class="${d.change > 0 ? "up" : d.change < 0 ? "down" : ""}">${signed(d.change)}</td></tr>`).join("")}</tbody></table>
      <p class="small muted">Scores out of 100 from the InstitutionalOS Diagnostic.</p></div>`
      : `<div class="card"><h2>Scores</h2><p class="muted">${o.overallNow != null ? `Your overall score is <b>${o.overallNow}</b>${o.decisionBand ? ` (${esc(o.decisionBand)})` : ""}. ` : ""}The before-and-after comparison appears once you've been rescored after the Diagnostic.</p></div>`;
    const plan = o.plan ? `<p><b>${o.plan.done} of ${o.plan.total}</b> plan actions done${o.plan.review90Done ? " · 90-day review held" : ""}${o.plan.reassessDone ? " · six-month reassessment held" : ""}${o.plan.standardizeTotal ? ` · ${o.plan.standardizeDone} of ${o.plan.standardizeTotal} changes made standard practice` : ""}</p>${bar(o.plan.done, o.plan.total)}` : "";
    return `<div class="noprint" style="text-align:right;margin-bottom:8px"><button class="btn ghost" id="print">Print or save as PDF</button></div>
      <div class="card"><h2>Outcomes report: ${esc(W.org)}</h2><p class="small muted">Since ${day(o.since)} · as of ${day(W.asOf)} · prepared by ${esc(W.consultant.firm)}</p>
      ${W.constraint ? `<p><b>The constraint we set out to fix:</b> ${esc(W.constraint)}</p>` : ""}${W.plan && W.plan.target ? `<p><b>The 90-day target:</b> ${esc(W.plan.target)}</p>` : ""}${plan}</div>
      ${scores}
      <div class="card"><h2>What was delivered</h2><div class="stats">
        <div class="stat"><b>${o.sessions.done}${o.sessions.total ? "/" + o.sessions.total : ""}</b><span class="small muted">sessions delivered</span></div>
        <div class="stat"><b>${o.tasksDone}/${o.tasksTotal}</b><span class="small muted">tasks done</span></div>
        <div class="stat"><b>${o.hours}</b><span class="small muted">hours of support</span></div>
        <div class="stat"><b>${o.decisions}</b><span class="small muted">decisions recorded</span></div></div>
        ${o.sessions.list.length ? `<div style="margin-top:10px">${o.sessions.list.map((s) => `<div class="task"><span>${esc(s.name || "Session")}</span><span class="small muted">${esc(s.status)}${s.date ? " · " + day(s.date) : ""}</span></div>`).join("")}</div>` : ""}</div>
      ${W.decisions.length ? `<div class="card"><h2>Decisions made</h2>${W.decisions.map((d) => `<div class="msg"><span class="small muted">${day(d.at)}</span><div class="text">${esc(d.text)}</div></div>`).join("")}</div>` : ""}`;
  }

  const TABS = [["overview", "Overview", overview], ["work", "Work", work], ["talk", "Conversation", talk], ["outcomes", "Outcomes", outcomes]];
  function render() {
    if (!TABS.some((t) => t[0] === tab)) tab = "overview";
    const keep = document.getElementById("say-text"); if (keep) draft = keep.value;
    app.innerHTML = `${preview ? `<div class="banner small"><b>Preview.</b> This is what ${esc(W.org)} sees with their link${W.hiddenProjects ? ` (${W.hiddenProjects} project${W.hiddenProjects === 1 ? "" : "s"} hidden from them)` : ""}.</div>` : ""}
      <h1>${esc(W.org)}</h1><p class="sub">${W.me ? `Welcome, ${esc(W.me)}. ` : ""}Your work with ${esc(W.consultant.firm)}.</p>
      <nav role="tablist">${TABS.map(([id, name]) => `<button role="tab" aria-selected="${id === tab}" data-go="${id}">${name}${id === "talk" && W.messages.length ? ` (${W.messages.filter((m) => !m.deleted).length})` : ""}</button>`).join("")}</nav>
      ${TABS.map(([id, , fn]) => `<section data-tab="${id}" ${id === tab ? "" : "hidden"}>${fn()}</section>`).join("")}`;
    document.title = W.org + " | Client workspace";
  }

  app.addEventListener("click", (ev) => {
    const b = ev.target.closest("button"); if (!b) return;
    if (b.dataset.go) { tab = b.dataset.go; history.replaceState(null, "", "#" + tab); render(); return; }
    if (b.id === "print") { tab = "outcomes"; render(); window.print(); return; }
    if ("reply" in b.dataset) { replyTo = b.dataset.reply; render(); const t = document.getElementById("say-text"); if (t) t.focus(); }
  });
  app.addEventListener("submit", async (ev) => {
    if (ev.target.id !== "say") return; ev.preventDefault();
    const t = document.getElementById("say-text"), note = document.getElementById("say-note"), btn = ev.target.querySelector("button[type=submit]");
    btn.disabled = true; note.textContent = "Sending…";
    try {
      const r = await fetch(api + "/message", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: t.value, parent: replyTo }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Not sent. Try again.");
      draft = ""; replyTo = ""; t.value = ""; await load();
    } catch (e) { note.textContent = e.message; btn.disabled = false; }
  });
  // New messages from the team show up without reloading.
  setInterval(() => { if (!document.hidden && !(document.getElementById("say-text") || {}).value) load(); }, 60000);
  load();
})();
