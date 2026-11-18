/* ================= v10: templates, schedule integrity, date rules, digest, usability tests, benchmarks, client status ================= */

/* ---------- project templates ---------- */
const BUILTIN_PT = [
  {id:'b-retreat', name:'Board retreat', desc:'Interviews, pre-reads, facilitation, the retreat itself and the follow-up report.', days:40, sections:['Prep','Retreat','Follow-up'], tasks:[
    {title:'Kickoff call with the board chair', sec:0, est:1, s:0, d:1},
    {title:'Interview board members', sec:0, est:5, s:1, d:7, needs:[0]},
    {title:'Book venue and catering', sec:0, est:3, s:1, d:10},
    {title:'Draft pre-read packet', sec:0, est:8, s:8, d:8, needs:[1]},
    {title:'Facilitation plan and agenda', sec:0, est:6, s:16, d:6, needs:[3]},
    {title:'Send pre-reads to the board', sec:0, est:0.5, s:22, d:1, needs:[3,4], ms:true},
    {title:'Retreat days', sec:1, est:14, s:28, d:2, needs:[5], ms:true},
    {title:'Write the retreat report', sec:2, est:8, s:30, d:7, needs:[6]},
    {title:'Report review with the chair', sec:2, est:1, s:37, d:1, needs:[7]},
    {title:'Deliver the final report', sec:2, est:1, s:39, d:1, needs:[8], ms:true}]},
  {id:'b-strategy', name:'Strategic plan engagement', desc:'Discovery, stakeholder input, drafting, board approval and an implementation plan.', days:90, sections:['Discovery','Input','Drafting','Approval'], tasks:[
    {title:'Kickoff and document request', sec:0, est:2, s:0, d:3},
    {title:'Review documents and financials', sec:0, est:8, s:3, d:10, needs:[0]},
    {title:'Run the InstitutionalOS diagnostic', sec:0, est:4, s:3, d:10, needs:[0]},
    {title:'Discovery findings memo', sec:0, est:6, s:13, d:5, needs:[1,2], ms:true},
    {title:'Staff survey', sec:1, est:4, s:18, d:14, needs:[3]},
    {title:'Stakeholder interviews (8–12)', sec:1, est:12, s:18, d:21, needs:[3]},
    {title:'Community or partner focus group', sec:1, est:5, s:25, d:10, needs:[3]},
    {title:'Synthesis of input', sec:1, est:6, s:39, d:5, needs:[4,5,6]},
    {title:'Planning committee workshop', sec:2, est:6, s:45, d:2, needs:[7], ms:true},
    {title:'Draft the strategic plan', sec:2, est:16, s:47, d:14, needs:[8]},
    {title:'Committee review and revisions', sec:2, est:4, s:61, d:10, needs:[9]},
    {title:'Board approval meeting', sec:3, est:3, s:75, d:1, needs:[10], ms:true},
    {title:'Implementation plan and dashboard', sec:3, est:10, s:76, d:12, needs:[11]},
    {title:'Closeout and handoff', sec:3, est:2, s:88, d:2, needs:[12], ms:true}]},
  {id:'b-grant', name:'Grant application', desc:'Fit check, outline, budget, narrative, reviews and submission.', days:30, sections:['Plan','Write','Submit'], tasks:[
    {title:'Confirm fit and eligibility', sec:0, est:1, s:0, d:2},
    {title:'Call the program officer', sec:0, est:1, s:1, d:5, needs:[0]},
    {title:'Outline and evidence list', sec:0, est:3, s:3, d:4, needs:[0]},
    {title:'Gather attachments (990, audit, board list)', sec:0, est:2, s:3, d:12},
    {title:'Draft the budget and budget narrative', sec:1, est:5, s:7, d:8, needs:[2]},
    {title:'Draft the narrative', sec:1, est:10, s:7, d:10, needs:[2]},
    {title:'Internal review', sec:1, est:2, s:18, d:4, needs:[4,5]},
    {title:'Final edits', sec:1, est:3, s:22, d:4, needs:[6]},
    {title:'Executive director sign-off', sec:2, est:0.5, s:26, d:2, needs:[7], ms:true},
    {title:'Submit and save confirmation', sec:2, est:1, s:28, d:1, needs:[3,8], ms:true}]}];
const ptemplates = () => [...BUILTIN_PT.map(t=>({...t, builtin:true})), ...list('ptemplates').filter(t=>!t.archived)];
function tplFromProject(pid, name){
  const p = S.projects[pid]; const ts = ptasks(pid).sort((a,b)=>(a.parent?1:0)-(b.parent?1:0) || (a.start||a.due||'').localeCompare(b.start||b.due||'')); const idx = Object.fromEntries(ts.map((t,i)=>[t.id,i])); const base = p.start || today();
  return {name: name || p.name+' (template)', desc:(p.desc||'').slice(0,200), days: p.due ? Math.max(1, daysBetween(base, p.due)) : 30, sections:p.sections.map(s=>s.name), fields:p.fields||[],
    tasks: ts.map(t => { const s0 = t.start && t.start<=t.due ? t.start : t.due || base; return {title:t.title, sec:Math.max(0, p.sections.findIndex(s=>s.id===t.section)), est:+t.est||0, s:Math.max(0, daysBetween(base, s0)), d:Math.max(1, daysBetween(s0, t.due||s0)+1), ms:!!t.milestone, needs:(t.needs||[]).map(n=>idx[n]).filter(n=>n!=null), parent: t.parent && idx[t.parent]!=null ? idx[t.parent] : null, checklist:(t.checklist||[]).map(c=>c.t), role: t.owner||''}; })};
}
function projectFromTemplate(tpl, {name, start, owner, eng, keepOwners}){
  const pid = newProject({name, owner, eng, start, due:addDays(start, tpl.days||30), desc:tpl.desc||''}); const p = S.projects[pid];
  const secs = tpl.sections.map((n,i)=>({id:'s'+(i+1), name:n})); if(!secs.some(s=>/done/i.test(s.name))) secs.push({id:'sdone', name:'Done'});
  put('projects', pid, {...p, sections:secs, fields:JSON.parse(JSON.stringify(tpl.fields||[])), fromTemplate:tpl.id||''});
  const ids = [];
  tpl.tasks.forEach((t,i) => { const st0 = addDays(start, t.s||0); const due = addDays(st0, Math.max(0,(t.d||1)-1));
    ids[i] = createTask({title:t.title, owner: keepOwners && t.role && S.team[t.role] ? t.role : '', due, eng:eng||'', lane:'franklin', est:t.est||0, src:'template', extra:{project:pid, section:secs[t.sec]?secs[t.sec].id:secs[0].id, parent:'', start:t.ms?'':st0, milestone:!!t.ms, assignees:[], custom:{}, files:[], checklist:(t.checklist||[]).map(x=>({t:x, done:false}))}}); });
  tpl.tasks.forEach((t,i) => { const tk = S.tasks[ids[i]]; const up = {}; if((t.needs||[]).length) up.needs = t.needs.map(n=>ids[n]).filter(Boolean); if(t.parent!=null && ids[t.parent]) up.parent = ids[t.parent]; if(Object.keys(up).length) put('tasks', tk.id, {...tk, ...up}); });
  audit('Created a project from a template', `${name} ← ${tpl.name}`); return pid;
}
function tplDialog(){
  const ts = ptemplates();
  $('#pmBody').innerHTML = `<form id="tplForm" class="form"><h2 style="grid-column:1/-1">New project from a template</h2>
    <fieldset class="full" style="grid-column:1/-1;border:1px solid var(--line);border-radius:8px;padding:8px;display:grid;gap:6px"><legend class="small">Template</legend>
      ${ts.map((t,i)=>`<label class="switch" style="align-items:flex-start"><input type="radio" name="tpl" value="${esc(t.id)}" ${i===0?'checked':''}><span><b>${esc(t.name)}</b> <span class="small muted">${t.tasks.length} tasks · ${t.days} days${t.builtin?' · built in':''}</span><br><span class="small muted">${esc(t.desc||'')}</span></span></label>${t.builtin?'':`<button type="button" class="btn sm ghost danger" data-px="tpl-del" data-id="${esc(t.id)}" style="justify-self:start">Delete template</button>`}`).join('')}</fieldset>
    <label class="full">Project name<input id="tp-name" required placeholder="Strategic plan for Harbor Arts"></label>
    <label>Start<input id="tp-start" type="date" value="${today()}"></label>
    <label>Owner<select id="tp-owner">${team().map(m=>`<option value="${m.id}" ${m.id===S.me?'selected':''}>${esc(m.name)}</option>`).join('')}</select></label>
    <label class="full">${esc(cap(LBL.entity))} (optional)<select id="tp-eng"><option value="">None</option>${list('engagements').filter(e=>!e.archived).map(e=>`<option value="${e.id}">${esc(e.org)}</option>`).join('')}</select></label>
    <label class="switch full" style="grid-column:1/-1"><input type="checkbox" id="tp-keep">Keep the owners saved in the template (otherwise tasks start in the queue)</label>
    <p class="small muted full" style="grid-column:1/-1">Dates are set from the start date. Dependencies, milestones, sections, checklists and custom fields come across.</p>
    <div class="row" style="grid-column:1/-1;justify-content:flex-end"><button type="button" class="btn ghost" data-act="close-dlg" data-dlg="pmDlg">Cancel</button><button class="btn primary" type="submit">Create project</button></div></form>`;
  $('#pmDlg').showModal();
}

/* ---------- schedule integrity: shift dependents, baselines ---------- */
function shiftDependents(id, seen=new Set()){
  const src = S.tasks[id]; if(!src || !src.due || seen.has(id)) return 0; seen.add(id); let n = 0;
  list('tasks').filter(t => isOpen(t) && (t.needs||[]).includes(id) && t.due).forEach(t => {
    const p = t.project && S.projects[t.project]; if(p && p.autoShift===false) return; if(!p && !t.project) return;
    const s0 = t.start && t.start<=t.due ? t.start : t.due; if(s0 > src.due) return;
    const slip = daysBetween(s0, src.due) + 1; put('tasks', t.id, {...t, start: t.start ? addDays(t.start, slip) : '', due:addDays(t.due, slip), history:hist(t, st(t), `Moved ${slip} day${slip===1?'':'s'} later because “${src.title}” slipped`)});
    if(t.owner && t.owner!==S.me) notify(t.owner, `“${t.title}” moved to ${fmtDate(addDays(t.due, slip))} because “${src.title}” slipped`, {task:t.id});
    n += 1 + shiftDependents(t.id, seen); });
  return n;
}
function afterDates(id){ const t = S.tasks[id]; if(!t || !t.project) return; const n = shiftDependents(id); if(n) toast(`Moved ${n} task${n===1?'':'s'} that wait on it`); }
function baselineControls(p){
  return `<label class="switch small"><input type="checkbox" id="p-autoshift" data-pxp="autoShift" ${p.autoShift===false?'':'checked'}>Move waiting tasks when something slips</label>
    <button class="btn sm" data-px="baseline" data-id="${esc(p.id)}">${p.baseline?'Update baseline':'Save baseline'}</button>${p.baseline?`<span class="small muted">Baseline from ${fmtWhen(p.baseline.at)}</span><button class="btn sm ghost" data-px="baseline-clear" data-id="${esc(p.id)}">Clear baseline</button>`:''}`;
}
function baseBar(p, t, x, DW, y){ const b = p.baseline && p.baseline.tasks[t.id]; if(!b || !b.d) return ''; const s0 = b.s && b.s<=b.d ? b.s : b.d; return `<div class="gbase" aria-hidden="true" style="left:${x(s0)}px;top:${y+28}px;width:${Math.max(DW-4,(daysBetween(s0,b.d)+1)*DW-4)}px"></div>`; }
function afterRender(){ const g = document.getElementById('gantt'); if(!g) return; const w = g.parentElement; const key = S.projectOpen; if(w.dataset.k===key) return; const td = g.querySelector('.gtoday'); if(S._gScroll && S._gScroll[key]!=null){ w.scrollLeft = S._gScroll[key]; } else if(td){ w.scrollLeft = Math.max(0, parseFloat(td.style.left) - Math.min(w.clientWidth*0.35, 320)); } w.dataset.k = key; w.addEventListener('scroll', () => { S._gScroll = S._gScroll||{}; S._gScroll[key] = w.scrollLeft; }, {passive:true}); }
function saveBaseline(pid, quiet){ const p = S.projects[pid]; const tasks = {}; ptasks(pid).forEach(t => tasks[t.id] = {s:t.start||'', d:t.due||''}); const fin = ptasks(pid).map(t=>t.due).filter(Boolean).sort().pop() || p.due || ''; put('projects', pid, {...p, baseline:{at:nowISO(), by:S.me||'', tasks, finish:fin}}); audit('Saved a project baseline', p.name); if(!quiet) toast('Baseline saved'); }
function slipInfo(p){
  if(!p.baseline) return null; const ts = ptasks(p.id); const fin = ts.map(t=>t.due).filter(Boolean).sort().pop() || '';
  const slipped = ts.map(t => { const b = p.baseline.tasks[t.id]; return b && b.d && t.due ? {t, days:daysBetween(b.d, t.due)} : null; }).filter(x=>x && x.days>0).sort((a,b)=>b.days-a.days);
  return {finish: p.baseline.finish && fin ? daysBetween(p.baseline.finish, fin) : 0, slipped};
}
function slipBlock(p){ const s = slipInfo(p); if(!s) return ''; return `<div class="small" style="display:grid;gap:4px"><div><b>Against the baseline:</b> finish is ${s.finish>0?`<span style="color:var(--bad)">${s.finish} day${s.finish===1?'':'s'} later</span>`:s.finish<0?`<span style="color:var(--ok)">${-s.finish} day${s.finish===-1?'':'s'} earlier</span>`:'on the same date'}${s.slipped.length?`; ${s.slipped.length} task${s.slipped.length===1?' has':'s have'} slipped`:''}.</div>${s.slipped.slice(0,4).map(x=>`<div class="muted">↳ ${esc(x.t.title)}: +${x.days}d</div>`).join('')}</div>`; }

/* keyboard on the timeline */
document.addEventListener('keydown', ev => {
  const el = ev.target; if(!el.matches || !el.matches('.gbar,.gms') || !['ArrowLeft','ArrowRight','Enter'].includes(ev.key)) return; ev.preventDefault();
  const t = S.tasks[el.dataset.gid]; if(!t) return; if(ev.key==='Enter'){ openTask(t.id); return; }
  const d = ev.key==='ArrowRight' ? 1 : -1; const s0 = t.start && t.start<=t.due ? t.start : t.due;
  if(ev.shiftKey && !t.milestone){ const nd = addDays(t.due, d); if(nd < s0) return; put('tasks', t.id, {...t, due:nd, start:s0}); }
  else put('tasks', t.id, {...t, start: t.milestone ? '' : addDays(s0, d), due:addDays(t.due, d)});
  if(d>0) afterDates(t.id); render(); const n = document.querySelector(`[data-gid="${CSS.escape(t.id)}"].gbar, [data-gid="${CSS.escape(t.id)}"].gms`); if(n) n.focus();
});

/* ---------- date rules ---------- */
function runTimeRules(){
  if(S.mode==='pending' || (S.mode==='db' && !S.loaded.tasks) || !S.me) return 0;
  const rs = list('rules').filter(r => r.active!==false && (r.on==='due_soon' || r.on==='overdue')); if(!rs.length) return 0; const d = today(); let n = 0;
  rs.forEach(r => list('tasks').filter(t => isOpen(t) && t.due && !t.cancelled).forEach(t => {
    const hit = r.on==='overdue' ? t.due < d : (t.due >= d && daysBetween(d, t.due) <= (+((r.cond||{}).days)||2)); if(!hit || !ruleMatches(r, t, {})) return;
    const key = r.id+':'+t.due; if((t.fired||[]).includes(key)) return;
    put('tasks', t.id, {...t, fired:[...(t.fired||[]).slice(-19), key]}); ruleDepth++; try{ execRule(r, t.id); } finally { ruleDepth--; } n++; }));
  return n;
}
setTimeout(runTimeRules, 20000); setInterval(runTimeRules, 10*60000);

/* ---------- daily digest ---------- */
function digestData(mid){
  const d = today(); const mine = list('tasks').filter(t => isOpen(t) && !t.cancelled && (t.owner===mid || (t.assignees||[]).includes(mid)));
  const lead = mid===leadId();
  return {
    overdue: mine.filter(t=>t.due && t.due<d).sort((a,b)=>a.due.localeCompare(b.due)),
    today: mine.filter(t=>t.due===d),
    soon: mine.filter(t=>t.due>d && daysBetween(d,t.due)<=3).sort((a,b)=>a.due.localeCompare(b.due)),
    approvals: list('tasks').filter(t=>t.approval && t.approval.state==='pending' && t.approval.by===mid),
    unseen: list('tasks').filter(t=>st(t)==='assigned' && t.assignedBy===mid && t.owner!==mid && t.assignedAt && (Date.now()-new Date(t.assignedAt))>864e5),
    blocked: lead ? list('tasks').filter(t=>st(t)==='blocked') : mine.filter(t=>st(t)==='blocked'),
    requests: list('tasks').filter(t=>t.src==='form' && st(t)==='unassigned' && t.project && S.projects[t.project] && S.projects[t.project].owner===mid),
    risky: projects().filter(p=>p.owner===mid && p.status!=='done' && pHealth(p).k!=='on_track')};
}
function digestText(mid){
  const g = digestData(mid); const line = t => `• ${t.title}${t.project&&S.projects[t.project]?` [${S.projects[t.project].name}]`:''}${t.due?` (due ${fmtDate(t.due)})`:''}`;
  const sec = (h, arr, f=line) => arr.length ? `${h}\n${arr.slice(0,12).map(f).join('\n')}${arr.length>12?`\n…and ${arr.length-12} more`:''}\n` : '';
  const body = [sec('Overdue', g.overdue), sec('Due today', g.today), sec('Due in the next 3 days', g.soon), sec('Waiting on your approval', g.approvals), sec('You assigned these and they haven’t been opened', g.unseen, t=>`• ${t.title} → ${mname(t.owner)}`), sec('Blocked', g.blocked, t=>`• ${t.title} (${mname(t.owner)||'queue'})`), sec('New requests in your projects', g.requests), sec('Your projects that need attention', g.risky, p=>`• ${p.name}: ${pStatus(pHealth(p).k)[1]}, ${pHealth(p).late} late`)].filter(Boolean).join('\n');
  return `Good morning ${first(mid)},\n\n${body || 'Nothing is overdue, due today or waiting on you. A clear day.'}\n\nOpen the hub: ${typeof HUB_URL!=='undefined'?HUB_URL:''}`;
}
function digestDialog(){
  const me = mem(S.me); if(!me){ toast('Pick who you are first'); return; }
  $('#pmBody').innerHTML = `<div style="display:grid;gap:12px"><div class="spread"><div><p class="eyebrow">Daily digest</p><h2>Your morning summary</h2></div><button class="btn ghost" data-act="close-dlg" data-dlg="pmDlg" aria-label="Close">✕</button></div>
    <pre class="prompt" style="white-space:pre-wrap;font:13px/1.5 var(--f-body);margin:0">${esc(digestText(S.me))}</pre>
    <label class="switch"><input type="checkbox" id="dg-on" data-pxm="digest" ${me.digest?'checked':''}>Email me this every weekday morning${me.email?` at ${esc(me.email)}`:''}</label>
    ${me.email?'':'<p class="small" style="color:var(--warn)">Add your email on the Team page so the digest can reach you.</p>'}
    <p class="small muted">The weekday email is sent by a scheduled task Franklin runs from his Gmail. Turning this off stops yours.</p>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-px="digest-copy">Copy</button>${MCP && me.email?`<button class="btn primary" data-px="digest-send">Email it to me now</button>`:''}</div></div>`;
  $('#pmDlg').showModal();
}

/* ---------- client status page ---------- */
function clientStatusHtml(p){
  const ts = ptasks(p.id); const h = pHealth(p); const e = p.eng && S.engagements[p.eng]; const d = today(); const ago14 = addDays(d,-14), in14 = addDays(d,14);
  const vis = t => t.milestone || t.client; const done = ts.filter(t=>vis(t) && !isOpen(t) && (t.doneAt||'').slice(0,10)>=ago14); const next = ts.filter(t=>vis(t) && isOpen(t) && t.due && t.due<=in14).sort((a,b)=>a.due.localeCompare(b.due));
  const ms = ts.filter(t=>t.milestone).sort((a,b)=>(a.due||'').localeCompare(b.due||'')); const up = (p.updates||[]).slice(-1)[0]; const k = p.status||h.k;
  const asks = ts.filter(t=>t.client && isOpen(t) && /client|from you|send us|provide|approve/i.test(t.title));
  return `<article class="cstat"><header><p class="eyebrow">Project status · ${fmtDate(d)}</p><h1>${esc(p.name)}</h1>${e?`<p class="muted">Prepared for ${esc(e.org)} by ${esc(LBL.orgName||'Frankly Inspired & Associates')}</p>`:''}</header>
    <section class="kpis" style="grid-template-columns:repeat(3,minmax(0,1fr))"><div class="kpi"><span class="v" style="color:${pStatus(k)[2]}">${esc(pStatus(k)[1])}</span><span class="l">Overall</span></div><div class="kpi"><span class="v">${pct(h.prog)}</span><span class="l">Complete</span></div><div class="kpi"><span class="v">${fmtDate(p.due)||'–'}</span><span class="l">Target finish</span></div></section>
    ${up?`<section><h2>Latest update</h2><p style="white-space:pre-wrap">${esc(up.text)}</p><p class="small muted">${esc(mname(up.by))}, ${fmtDate(up.at.slice(0,10))}</p></section>`:''}
    <section><h2>Milestones</h2><table class="def"><thead><tr><th>Milestone</th><th>Date</th><th>Status</th></tr></thead><tbody>${ms.map(t=>`<tr><td>${esc(t.title)}</td><td class="num">${fmtDate(t.due)}</td><td>${isOpen(t)?(t.due<d?'<span style="color:var(--bad)">Late</span>':'Upcoming'):'<span style="color:var(--ok)">Done</span>'}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No milestones set.</td></tr>'}</tbody></table></section>
    <section class="two" style="grid-template-columns:1fr 1fr"><div><h2>Done in the last two weeks</h2><ul>${done.map(t=>`<li>${esc(t.title)}</li>`).join('') || '<li class="muted">Nothing client-facing finished in this period.</li>'}</ul></div>
    <div><h2>Coming up in the next two weeks</h2><ul>${next.map(t=>`<li>${esc(t.title)} <span class="muted">· ${fmtDate(t.due)}</span></li>`).join('') || '<li class="muted">Nothing scheduled.</li>'}</ul></div></section>
    ${asks.length?`<section><h2>What we need from you</h2><ul>${asks.map(t=>`<li>${esc(t.title)}${t.due?` <span class="muted">· by ${fmtDate(t.due)}</span>`:''}</li>`).join('')}</ul></section>`:''}</article>`;
}
function viewClientStatus(){
  const ps = projects(); const p = S.projects[S.statusProject] || S.projects[S.projectOpen] || ps[0];
  if(!p) return `<div class="empty">No projects yet.</div>`;
  const e = p.eng && S.engagements[p.eng];
  return `<section class="spread noprint"><div><a href="#project" data-pm="open" data-id="${esc(p.id)}" class="small">← Back to the project</a><h1 style="margin-top:4px">Client status page</h1><p class="muted" style="max-width:72ch">What a client or board sees: overall status, progress, milestones, recent and upcoming work, and what you need from them. Only milestones and tasks marked “Show on client status page” appear. Nothing internal (hours, costs, check-ins, comments) is included.</p></div>
    <div class="row"><select id="cs-proj" data-pxs="proj" aria-label="Project">${ps.map(x=>`<option value="${x.id}" ${x.id===p.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select><button class="btn" data-px="cs-print">Print or save as PDF</button><button class="btn" data-px="cs-html" data-id="${esc(p.id)}">Download page</button>${MCP?`<button class="btn primary" data-px="cs-email" data-id="${esc(p.id)}">Email to ${e&&e.email?esc(e.contact||e.email):'client'}</button>`:''}</div></section>
    <div class="panel">${clientStatusHtml(p)}</div>`;
}
function clientStatusFile(p){
  const css = `body{font:15px/1.55 system-ui,-apple-system,sans-serif;color:#15213a;max-width:820px;margin:32px auto;padding:0 20px}h1{font:650 30px Georgia,serif;margin:4px 0}h2{font:650 18px Georgia,serif;margin:22px 0 8px}.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#5b6579;margin:0}.muted{color:#5b6579}.small{font-size:13px}.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:18px 0}.kpi{border:1px solid #dce1e9;border-radius:10px;padding:12px;display:grid}.kpi .v{font:650 22px Georgia,serif}.kpi .l{font-size:12px;color:#5b6579}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #dce1e9}.two{display:grid;grid-template-columns:1fr 1fr;gap:24px}`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(p.name)}: status</title><style>${css}</style></head><body>${clientStatusHtml(p).replace(/var\(--ok\)/g,'#2c7a57').replace(/var\(--bad\)/g,'#b03a3a').replace(/var\(--warn\)/g,'#8a560c').replace(/var\(--navy\)/g,'#1d3461').replace(/var\(--muted\)/g,'#5b6579')}</body></html>`;
}
function clientStatusText(p){
  const ts = ptasks(p.id); const h = pHealth(p); const d = today(); const up = (p.updates||[]).slice(-1)[0]; const ms = ts.filter(t=>t.milestone).sort((a,b)=>(a.due||'').localeCompare(b.due||''));
  const next = ts.filter(t=>(t.milestone||t.client) && isOpen(t) && t.due && t.due<=addDays(d,14)).sort((a,b)=>a.due.localeCompare(b.due));
  return `Status: ${pStatus(p.status||h.k)[1]} · ${pct(h.prog)} complete · target finish ${fmtDate(p.due)||'TBD'}\n\n${up?up.text+'\n\n':''}Milestones\n${ms.map(t=>`• ${t.title}: ${isOpen(t)?fmtDate(t.due):'done'}`).join('\n')||'• None set'}\n\nNext two weeks\n${next.map(t=>`• ${t.title} (${fmtDate(t.due)})`).join('\n')||'• Nothing scheduled'}\n`;
}

/* ---------- usability tests ---------- */
const UT_TASKS = [
  {id:'u1', task:'Start a new project for a client from the “Grant application” template.', success:'Project exists with tasks and dates from the template.'},
  {id:'u2', task:'Find everything that is late across the team this week.', success:'Names the late tasks from a dashboard, the board or the digest.'},
  {id:'u3', task:'Give a task to a teammate and check whether they have seen it.', success:'Task assigned; participant reads the “seen” status.'},
  {id:'u4', task:'Record 30 minutes you spent on a task.', success:'30 minutes logged on the right task.'},
  {id:'u5', task:'A task is slipping by three days. Move it and tell me what else moved.', success:'Moves the task (timeline or table) and names the waiting tasks that shifted.'},
  {id:'u6', task:'Find out who is overloaded next week.', success:'Uses Workload (or asks Claude) and names the person.'},
  {id:'u7', task:'Post a status update on a project and produce the page you would send the client.', success:'Update posted and client status page opened, printed or emailed.'},
  {id:'u8', task:'Set up the hub so that anything marked blocked automatically alerts the lead.', success:'An active rule with that trigger and action.'}];
const SUS_Q = ['I think I would like to use this system frequently.','I found the system unnecessarily complex.','I thought the system was easy to use.','I think I would need the support of a technical person to use this system.','I found the various functions in this system were well integrated.','I thought there was too much inconsistency in this system.','I would imagine most people would learn to use this system very quickly.','I found the system very cumbersome to use.','I felt very confident using the system.','I needed to learn a lot of things before I could get going with this system.'];
const susScore = a => a && a.length===10 && a.every(x=>x>=1 && x<=5) ? a.reduce((s,x,i)=>s + (i%2===0 ? x-1 : 5-x), 0) * 2.5 : null;
const median = a => { const b = a.filter(x=>x!=null).sort((x,y)=>x-y); if(!b.length) return null; const m = Math.floor(b.length/2); return b.length%2 ? b[m] : (b[m-1]+b[m])/2; };
function utSummary(){
  const ss = list('utests').filter(s=>!s.archived); const per = UT_TASKS.map(u => { const rs = ss.map(s=>(s.results||{})[u.id]).filter(r=>r && r.outcome);
    return {u, n:rs.length, success: rs.length ? rs.filter(r=>r.outcome==='success').length/rs.length : null, helped: rs.length ? rs.filter(r=>r.outcome==='help').length/rs.length : null, sec: median(rs.map(r=>r.sec))}; });
  const all = ss.flatMap(s=>Object.values(s.results||{})).filter(r=>r && r.outcome); const sus = ss.map(s=>susScore(s.sus)).filter(x=>x!=null);
  return {ss, per, success: all.length ? all.filter(r=>r.outcome==='success').length/all.length : null, sus: sus.length ? sus.reduce((a,b)=>a+b,0)/sus.length : null};
}
function viewUsability(){
  const sm = utSummary(); const cur = S.ut && S.utests[S.ut.id];
  if(cur){ const r = cur.results||{};
    return `<section class="spread"><div><p class="eyebrow">Usability test · ${esc(cur.participant)}</p><h1>Run the session</h1><p class="muted" style="max-width:72ch">Read each task aloud, start the timer, and don’t help unless they’re stuck for 2 minutes. Mark the outcome when they say they’re done or give up.</p></div><button class="btn" data-px="ut-close">Finish later</button></section>
    <section class="panel" style="display:grid;gap:10px">${UT_TASKS.map((u,i)=>{ const x = r[u.id]; const run = S.ut.run===u.id;
      return `<div style="border-bottom:1px solid var(--line);padding:8px 0;display:grid;gap:6px"><div class="spread"><b>${i+1}. ${esc(u.task)}</b>${x&&x.outcome?`<span class="flag" style="margin:0;color:${x.outcome==='success'?'var(--ok)':x.outcome==='help'?'var(--warn)':'var(--bad)'}">${x.outcome==='success'?'Success':x.outcome==='help'?'With help':'Not completed'} · ${Math.round(x.sec||0)}s</span>`:''}</div><div class="small muted">Success looks like: ${esc(u.success)}</div>
        <div class="row">${run?`<span class="num" id="ut-clock" aria-live="off">Running…</span><button class="btn sm accent" data-px="ut-out" data-t="${u.id}" data-o="success">Success</button><button class="btn sm" data-px="ut-out" data-t="${u.id}" data-o="help">With help</button><button class="btn sm danger" data-px="ut-out" data-t="${u.id}" data-o="fail">Not completed</button>`:`<button class="btn sm" data-px="ut-start" data-t="${u.id}">${x?'Redo':'Start'} timer</button>`}
          <input id="ut-n-${u.id}" data-pxu="${u.id}" value="${esc((x&&x.notes)||'')}" placeholder="What they did, where they hesitated" style="flex:1;min-width:0;flex-basis:200px;border:1px solid var(--line);border-radius:8px;padding:6px 8px;background:var(--bg)" aria-label="Notes for task ${i+1}"></div></div>`; }).join('')}</section>
    <section class="panel"><h2 style="margin-bottom:6px">Questionnaire (System Usability Scale)</h2><p class="small muted">Ask after the tasks. 1 = strongly disagree, 5 = strongly agree.</p>
      ${SUS_Q.map((q,i)=>`<fieldset class="row" style="border:none;padding:4px 0;justify-content:space-between"><legend class="small" style="float:left;max-width:60%">${i+1}. ${esc(q)}</legend><span class="row">${[1,2,3,4,5].map(v=>`<label class="switch small"><input type="radio" name="sus-${i}" value="${v}" data-pxsus="${i}" ${(cur.sus||[])[i]===v?'checked':''}>${v}</label>`).join('')}</span></fieldset>`).join('')}
      <p><b>Score: ${susScore(cur.sus)!=null?Math.round(susScore(cur.sus)):'answer all 10'}</b> <span class="small muted">(68 is average; 80+ is good)</span></p>
      <label class="full" style="display:grid;gap:4px">Closing notes<textarea id="ut-notes" data-pxun="1" placeholder="What would make them use it every day? What confused them?">${esc(cur.notes||'')}</textarea></label></section>`; }
  return `<section class="spread"><div><p class="eyebrow">Product · Ease of use</p><h1>Usability tests</h1><p class="muted" style="max-width:72ch">Watch real people do eight core tasks, time them, and score the System Usability Scale. Target: 90% of tasks done without help and a score of 80+. Five participants find most problems.</p></div><button class="btn primary" data-px="ut-new">+ New session</button></section>
    <section class="kpis" style="grid-template-columns:repeat(3,minmax(0,1fr))"><div class="kpi"><span class="v">${sm.ss.length}</span><span class="l">Sessions</span></div><div class="kpi"><span class="v" style="color:${sm.success==null?'inherit':sm.success>=0.9?'var(--ok)':'var(--bad)'}">${sm.success==null?'–':pct(sm.success)}</span><span class="l">Tasks done without help (target 90%)</span></div><div class="kpi"><span class="v" style="color:${sm.sus==null?'inherit':sm.sus>=80?'var(--ok)':sm.sus>=68?'var(--warn)':'var(--bad)'}">${sm.sus==null?'–':Math.round(sm.sus)}</span><span class="l">Usability score (target 80)</span></div></section>
    <section class="panel"><div class="matrix-wrap"><table class="def"><thead><tr><th>Task</th><th>Tries</th><th>Done alone</th><th>With help</th><th>Median time</th></tr></thead><tbody>${sm.per.map((x,i)=>`<tr><td>${i+1}. ${esc(x.u.task)}</td><td class="v">${x.n}</td><td class="v" style="color:${x.success==null?'inherit':x.success>=0.9?'var(--ok)':x.success<0.6?'var(--bad)':'var(--warn)'}">${x.success==null?'–':pct(x.success)}</td><td class="v">${x.helped==null?'–':pct(x.helped)}</td><td class="v">${x.sec==null?'–':Math.round(x.sec)+'s'}</td></tr>`).join('')}</tbody></table></div></section>
    <section class="panel"><h2 style="margin-bottom:8px">Sessions</h2>${sm.ss.sort((a,b)=>(b.date||'').localeCompare(a.date||'')).map(s=>`<div class="row" style="justify-content:space-between;border-bottom:1px solid var(--line);padding:6px 0"><span><b>${esc(s.participant)}</b> <span class="small muted">${esc(s.role||'')} · ${fmtDate(s.date)} · ${Object.values(s.results||{}).filter(r=>r.outcome).length}/8 tasks${susScore(s.sus)!=null?` · score ${Math.round(susScore(s.sus))}`:''}</span></span><button class="btn sm" data-px="ut-open" data-id="${esc(s.id)}">Open</button></div>`).join('') || '<div class="empty">No sessions yet. The full script is in the project docs (Flow Hub usability test script).</div>'}</section>`;
}

/* ---------- benchmark metrics (the payload a peer comparison would use) ---------- */
function benchData(days=90){
  const from = addDays(today(), -days); const ts = list('tasks').filter(t=>!t.cancelled && !/^Sample:/.test(t.title||''));
  const done = ts.filter(t=>t.doneAt && t.doneAt.slice(0,10)>=from);
  const onTime = done.filter(t=>t.due); const cyc = done.filter(t=>t.startedAt).map(t=>(new Date(t.doneAt)-new Date(t.startedAt))/864e5);
  const asg = ts.filter(t=>t.assignedAt && t.assignedAt.slice(0,10)>=from && t.assignedBy && t.owner && t.assignedBy!==t.owner);
  const est = done.filter(t=>+t.est>0 && loggedMin(t)>0);
  const ps = projects().filter(p=>!/^Sample:/.test(p.name)&&p.status!=='done');
  const m = {
    onTime: onTime.length ? onTime.filter(t=>t.doneAt.slice(0,10)<=t.due).length/onTime.length : null,
    cycleDays: median(cyc),
    seen24: asg.length ? asg.filter(t=>t.seenAt && (new Date(t.seenAt)-new Date(t.assignedAt))<=864e5).length/asg.length : null,
    blockedHrsPer10: done.length ? done.reduce((a,t)=>a+(+t.blockedMin||0),0)/60/done.length*10 : null,
    estRatio: est.length ? est.reduce((a,t)=>a+loggedMin(t)/60,0)/est.reduce((a,t)=>a+(+t.est),0) : null,
    reopen: done.length ? done.filter(t=>+t.reopened>0).length/done.length : null,
    projOnTrack: ps.length ? ps.filter(p=>pHealth(p).k==='on_track').length/ps.length : null,
    throughputWk: done.length/(days/7)};
  let fn = null; try{ if(typeof fnOn==='function' && fnOn()){ const d = fnData(days); const tot = d.byFn.reduce((a,f)=>a+f.h,0); if(tot) fn = Object.fromEntries(d.byFn.map(f=>[f.k, Math.round(f.h/tot*100)/100])); } }catch(_){}
  return {m, fn, n:{done:done.length, assigned:asg.length, projects:ps.length, team:team().length}};
}
const BENCH_DEFS = [['onTime','Finished on or before the due date','pct','Share of tasks finished by their due date.'],['cycleDays','Median days from start to done','d1','How long work takes once someone starts.'],['seen24','Assignments opened within a day','pct','How quickly handoffs are picked up.'],['blockedHrsPer10','Hours blocked per 10 finished tasks','d1','Time lost waiting on others.'],['estRatio','Actual hours ÷ planned hours','x2','Above 1 means work takes longer than planned.'],['reopen','Finished tasks that were reopened','pct','Rework rate.'],['projOnTrack','Active projects on track','pct','Portfolio health.'],['throughputWk','Tasks finished per week','d1','Team throughput.']];
function viewBenchmarks(){
  const b = benchData(90); const f = (v, k) => v==null ? '–' : k==='pct' ? pct(v) : k==='x2' ? v.toFixed(2)+'×' : (Math.round(v*10)/10).toString();
  const payload = {v:1, period_days:90, size_band: b.n.team<=3?'1-3':b.n.team<=10?'4-10':'11+', template:(S.model&&S.model.template)||'consulting', metrics:Object.fromEntries(Object.entries(b.m).map(([k,v])=>[k, v==null?null:Math.round(v*100)/100])), time_split:b.fn, counts:b.n};
  return `<section><p class="eyebrow">Insights</p><h1>Benchmarks</h1><p class="muted" style="max-width:72ch">The eight operating measures your workspace would contribute to a peer comparison, computed from the last 90 days (sample data excluded). Comparison with similar organizations arrives in the standalone version, once at least 10 organizations share; until then these are your own baseline.</p></section>
    <section class="dgrid">${BENCH_DEFS.map(([k,l,t,why])=>`<div class="panel"><div class="small muted">${esc(l)}</div><div class="num" style="font:650 28px var(--f-display);margin:4px 0">${f(b.m[k], t)}</div><div class="small">${esc(why)}</div></div>`).join('')}</section>
    ${b.fn?`<section class="panel"><h2 style="margin-bottom:6px">Time split</h2><p class="small">${Object.entries(b.fn).map(([k,v])=>`${esc(k)} ${pct(v)}`).join(' · ')}</p></section>`:''}
    <section class="panel"><h2 style="margin-bottom:6px">What would be shared</h2><p class="small muted">No names, titles, clients, notes, check-ins or dollar amounts. Sharing will be opt-in per organization.</p><pre style="white-space:pre-wrap;font:12px/1.5 var(--f-mono);background:var(--bg);padding:12px;border-radius:8px;overflow:auto">${esc(JSON.stringify(payload, null, 2))}</pre></section>`;
}

/* ---------- events ---------- */
document.addEventListener('click', ev => {
  const b = ev.target.closest && ev.target.closest('[data-px]'); if(!b) return; const a = b.dataset.px, id = b.dataset.id; track('act', 'px-'+a);
  if(a==='tpl-new'){ tplDialog(); return; }
  if(a==='tpl-del'){ const t = S.ptemplates[id]; if(t && confirm2(b,'Delete this template? Projects made from it are not affected.')){ del('ptemplates', id); audit('Deleted a project template', t.name); tplDialog(); } return; }
  if(a==='tpl-save'){ const p = S.projects[id]; if(!p) return; const t = tplFromProject(id); const tid = uid(); put('ptemplates', tid, {...t, created:nowISO(), createdBy:S.me||''}); audit('Saved a project template', t.name); toast(`Saved “${t.name}” with ${t.tasks.length} tasks`); return; }
  if(a==='dup'){ const p = S.projects[id]; if(!p) return; const t = tplFromProject(id); const pid = projectFromTemplate(t, {name:p.name+' (copy)', start:today(), owner:p.owner||S.me||'', eng:p.eng||'', keepOwners:true}); put('projects', pid, {...S.projects[pid], color:p.color, doc:p.doc||'', form:{...(p.form||{}), on:false}}); toast('Project duplicated with today as the start date'); openProject(pid, 'list'); return; }
  if(a==='baseline'){ saveBaseline(id); render(); return; }
  if(a==='baseline-clear'){ const p = S.projects[id]; if(p && confirm2(b,'Clear the saved baseline?')){ const {baseline, ...rest} = p; put('projects', id, {...rest, baseline:null}); render(); } return; }
  if(a==='digest'){ digestDialog(); return; }
  if(a==='digest-copy'){ navigator.clipboard && navigator.clipboard.writeText(digestText(S.me)).then(()=>toast('Copied'), ()=>toast('Copy not available here')); return; }
  if(a==='digest-send'){ const me = mem(S.me); gmailSend(me.email, `Your Flow Hub digest · ${fmtDate(today())}`, digestText(S.me)).then(()=>toast('Sent to '+me.email), e=>toast(connErr(e, GMAIL))); return; }
  if(a==='cs-print'){ window.print(); return; }
  if(a==='cs-html'){ const p = S.projects[id]; saveFile(`${p.name.replace(/[^\w]+/g,'-').toLowerCase()}-status.html`, clientStatusFile(p), 'text/html'); return; }
  if(a==='cs-email'){ const p = S.projects[id]; const e = p.eng && S.engagements[p.eng]; if(!e || !e.email){ toast('Add the client’s email on their record first'); return; }
    gmailSend(e.email, `${p.name}: status update`, `Hi ${(e.contact||'').split(' ')[0]||'there'},\n\nHere’s where things stand.\n\n${clientStatusText(p)}\nBest,\n${S.me?mname(S.me):''}`).then(()=>{ audit('Emailed a client status page', p.name); toast('Sent to '+e.email); put('engagements', e.id, {...e, log:logTo(e,'msg',`Status page emailed for ${p.name}`), updated:nowISO()}); }, err=>toast(connErr(err, GMAIL))); return; }
  if(a==='ut-new'){ const nm = prompt2(); return; }
  if(a==='ut-open'){ S.ut = {id}; render(); return; }
  if(a==='ut-close'){ S.ut = null; render(); return; }
  if(a==='ut-start'){ S.ut.run = b.dataset.t; S.ut.at = Date.now(); render(); return; }
  if(a==='ut-out'){ const s = S.utests[S.ut.id]; const tid = b.dataset.t; const prev = (s.results||{})[tid]||{}; put('utests', s.id, {...s, results:{...(s.results||{}), [tid]:{...prev, outcome:b.dataset.o, sec:(Date.now()-S.ut.at)/1000}}}); S.ut.run = null; render(); return; }
});
function prompt2(){
  $('#pmBody').innerHTML = `<form id="utForm" class="form"><h2 style="grid-column:1/-1">New usability session</h2><label>Participant (first name or code)<input id="ut-p" required></label><label>Role<input id="ut-r" placeholder="Executive director, program manager…"></label>
    <p class="small muted full" style="grid-column:1/-1">Get their consent to observe and take notes. Use a workspace with sample data, never real client data, and keep the self-test or demo open in another tab if they need a fresh start.</p>
    <div class="row" style="grid-column:1/-1;justify-content:flex-end"><button type="button" class="btn ghost" data-act="close-dlg" data-dlg="pmDlg">Cancel</button><button class="btn primary" type="submit">Start session</button></div></form>`; $('#pmDlg').showModal();
}
document.addEventListener('change', ev => {
  const el = ev.target, ds = el.dataset;
  if(ds.pxp && S.projects[S.projectOpen]){ const p = S.projects[S.projectOpen]; put('projects', p.id, {...p, [ds.pxp]: el.type==='checkbox' ? el.checked : el.value}); render(); return; }
  if(ds.pxm){ const m = S.team[S.me]; if(m){ put('team', m.id, {...m, [ds.pxm]:el.checked}); toast(el.checked?'You’ll get the digest on weekday mornings':'Digest emails off'); } return; }
  if(ds.pxs){ S.statusProject = el.value; render(); return; }
  if(ds.pxu && S.ut){ const s = S.utests[S.ut.id]; const prev = (s.results||{})[ds.pxu]||{}; put('utests', s.id, {...s, results:{...(s.results||{}), [ds.pxu]:{...prev, notes:el.value}}}); return; }
  if(ds.pxsus && S.ut){ const s = S.utests[S.ut.id]; const a = (s.sus||Array(10).fill(0)).slice(); a[+ds.pxsus] = +el.value; put('utests', s.id, {...s, sus:a}); render(); return; }
  if(ds.pxun && S.ut){ const s = S.utests[S.ut.id]; put('utests', s.id, {...s, notes:el.value}); return; }
});
document.addEventListener('submit', ev => {
  const f = ev.target;
  if(f.id==='tplForm'){ ev.preventDefault(); const tid = (f.querySelector('[name=tpl]:checked')||{}).value; const tpl = ptemplates().find(t=>t.id===tid); if(!tpl) return; const pid = projectFromTemplate(tpl, {name:$('#tp-name').value.trim(), start:$('#tp-start').value||today(), owner:$('#tp-owner').value, eng:$('#tp-eng').value, keepOwners:$('#tp-keep').checked}); $('#pmDlg').close(); toast(`Created with ${ptasks(pid).length} tasks`); openProject(pid, 'timeline'); return; }
  if(f.id==='utForm'){ ev.preventDefault(); const sid = uid(); put('utests', sid, {participant:$('#ut-p').value.trim(), role:$('#ut-r').value.trim(), date:today(), facilitator:S.me||'', results:{}, sus:Array(10).fill(0), notes:''}); $('#pmDlg').close(); S.ut = {id:sid}; render(); return; }
});
setInterval(() => { const c = document.getElementById('ut-clock'); if(c && S.ut && S.ut.run) c.textContent = Math.round((Date.now()-S.ut.at)/1000)+'s'; }, 1000);

/* ---------- touch drag-and-drop (press and hold a card, slide, release) ---------- */
const COARSE = () => { try{ return matchMedia('(pointer:coarse)').matches; }catch(_){ return false; } };
let tDrag = null, tSuppress = 0;
function tZoneAt(x, y){ const el = document.elementFromPoint(x, y); const z = el && el.closest('[data-drop],[data-droppm]'); if(!z) return null; if(z.dataset.drop) return (typeof dropOk==='function' && dropOk(z)) ? z : null; return pmDropOk(z) ? z : null; }
function tTick(){
  const d = tDrag; if(!d || !d.fired){ return; } d.raf = 0; const x = d.lx, y = d.ly; let moved = false;
  const sc = document.elementFromPoint(x, y); const box = (sc && sc.closest('.board,.lanes-board,.matrix-wrap')) || d.el.closest('.board,.lanes-board,.matrix-wrap');
  if(box){ const r = box.getBoundingClientRect(); const L = Math.max(r.left, 0), R = Math.min(r.right, innerWidth); const before = box.scrollLeft; if(x > R-48) box.scrollLeft += 14; else if(x < L+48) box.scrollLeft -= 14; moved = box.scrollLeft !== before; }
  if(y > innerHeight-90){ window.scrollBy(0, 12); moved = true; } else if(y < 70 && scrollY > 0){ window.scrollBy(0, -12); moved = true; }
  if(moved){ const z = tZoneAt(x, y); if(z !== d.zone){ document.querySelectorAll('.drop-hover').forEach(q=>q.classList.remove('drop-hover')); if(z) z.classList.add('drop-hover'); d.zone = z; } }
  if(moved || x > innerWidth-60 || x < 60 || y > innerHeight-90 || y < 70) d.raf = requestAnimationFrame(tTick);
}
function tEnd(cancel){
  if(!tDrag) return; clearTimeout(tDrag.timer); const d = tDrag; tDrag = null;
  if(!d.fired) return; tSuppress = Date.now(); if(d.raf) cancelAnimationFrame(d.raf);
  if(d.ghost) d.ghost.remove(); d.el.classList.remove('dragging'); document.querySelectorAll('.drop-hover').forEach(x=>x.classList.remove('drop-hover')); document.body.classList.remove('tdragging');
  if(!cancel && d.zone){ d.zone.dispatchEvent(new Event('drop', {bubbles:true, cancelable:true})); }
  S.drag = null;
}
document.addEventListener('touchstart', ev => {
  if(ev.touches.length !== 1) { tEnd(true); return; }
  const el = ev.target.closest && ev.target.closest('[data-drag],[data-dragpm]'); if(!el || ev.target.closest('button,input,select,textarea,a,label,[data-gid]')) return;
  const t0 = ev.touches[0];
  tDrag = {el, x0:t0.clientX, y0:t0.clientY, fired:false, timer:setTimeout(() => {
    if(!tDrag) return; tDrag.fired = true; S.drag = {kind: el.dataset.drag || 'pmtask', id: el.dataset.id};
    const r = el.getBoundingClientRect(); const g = el.cloneNode(true); g.removeAttribute('id'); g.classList.add('tghost'); g.style.width = r.width+'px'; g.style.left = r.left+'px'; g.style.top = r.top+'px';
    tDrag.dx = tDrag.x0 - r.left; tDrag.dy = tDrag.y0 - r.top; document.body.appendChild(g); tDrag.ghost = g; el.classList.add('dragging'); document.body.classList.add('tdragging');
    try{ navigator.vibrate && navigator.vibrate(15); }catch(_){}
  }, 380)};
}, {passive:true});
document.addEventListener('touchmove', ev => {
  if(!tDrag) return; const t = ev.touches[0];
  if(!tDrag.fired){ if(Math.abs(t.clientX-tDrag.x0)>10 || Math.abs(t.clientY-tDrag.y0)>10) tEnd(true); return; }
  ev.preventDefault();
  tDrag.ghost.style.left = (t.clientX - tDrag.dx)+'px'; tDrag.ghost.style.top = (t.clientY - tDrag.dy)+'px';
  const z = tZoneAt(t.clientX, t.clientY); if(z !== tDrag.zone){ document.querySelectorAll('.drop-hover').forEach(x=>x.classList.remove('drop-hover')); if(z) z.classList.add('drop-hover'); tDrag.zone = z; }
  tDrag.lx = t.clientX; tDrag.ly = t.clientY; if(!tDrag.raf) tDrag.raf = requestAnimationFrame(tTick);
}, {passive:false});
document.addEventListener('touchend', () => tEnd(false));
document.addEventListener('touchcancel', () => tEnd(true));
document.addEventListener('contextmenu', ev => { if(tDrag || (Date.now()-tSuppress) < 600) ev.preventDefault(); });
document.addEventListener('click', ev => { if(Date.now()-tSuppress < 450){ ev.stopPropagation(); ev.preventDefault(); } }, true);
/* native HTML5 drag fights the touch version on phones, so phones use only the touch version */
const _afterRender0 = afterRender;
afterRender = function(){ _afterRender0(); if(COARSE()) document.querySelectorAll('[draggable="true"]').forEach(el => el.setAttribute('draggable','false')); };
