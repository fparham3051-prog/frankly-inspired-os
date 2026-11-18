/* ================= Automation, approvals, goals, dashboards, Claude, presence, files ================= */
let ASSETS = null, ROOM = null, SAMPLE = null;
async function initPM(){
  if(window.FLOWHUB_TEST || window.FLOWHUB_DEMO || !window.claude || typeof window.claude.use!=='function') return;
  try{ ASSETS = await window.claude.use('assets'); }catch(_){ ASSETS = null; }
  try{ SAMPLE = await window.claude.use('sample'); }catch(_){ SAMPLE = null; }
  try{ ROOM = await window.claude.use('room'); }catch(_){ ROOM = null; }
  if(ROOM){ try{ ROOM.onPeers(ch => { S.peers = ch.peers; if(S.view==='project' || (S.taskOpen && $('#taskDlg').open)) safeRender(); }, ()=>{ ROOM = null; }); }catch(_){ ROOM = null; } sharePresence(); }
  safeRender();
}
function sharePresence(){ if(!ROOM) return; try{ ROOM.presence({v:S.view||'', p:S.view==='project'?(S.projectOpen||''):'', t:S.taskOpen && $('#taskDlg') && $('#taskDlg').open ? S.taskOpen : '', m:S.me||''}).catch(()=>{}); }catch(_){} }
const othersOn = (k, v) => [...new Set((S.peers||[]).filter(x=>!x.sameTab && x.presence && x.presence[k]===v && x.presence.m).map(x=>x.presence.m))];

/* ---------- task dialog: project, subtasks, people, approvals, files ---------- */
function pmTaskBlock(t){
  const p = t.project && S.projects[t.project]; const subs = subtasksOf(t.id); const ap = t.approval; const viewers = othersOn('t', t.id);
  const parent = t.parent && S.tasks[t.parent];
  const srcNote = t.link ? `<div class="prompt small">${{deal:'This is the next step on a deal in Pipeline &amp; Money. Renaming or re-dating it here changes it there; finishing it clears it there so you can set the next one. Change the deal’s stage in Pipeline &amp; Money.', module:'This is a delivery session from Pipeline &amp; Money → Delivery. Its name, date and status stay in step both ways.', issue:'This is an issue from Priorities &amp; Vision. Finishing it here marks it solved there.'}[t.link.kind]||''}</div>` : '';
  return `${srcNote}${viewers.length?`<div class="small muted">Also looking at this: ${viewers.map(m=>av(m)+' '+esc(first(m))).join(', ')}</div>`:''}
  ${parent?`<div class="small">Subtask of <span data-act="task" data-id="${esc(parent.id)}" role="button" tabindex="0" style="text-decoration:underline">${esc(parent.title)}</span></div>`:''}
  <div class="form">
    <label>Project<select id="ptd-project" data-ptd="project" data-id="${esc(t.id)}"><option value="">No project</option>${projects().map(x=>`<option value="${x.id}" ${x.id===t.project?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label>
    ${p?`<label>Section<select id="ptd-section" data-ptd="section" data-id="${esc(t.id)}">${p.sections.map(s=>`<option value="${s.id}" ${s.id===t.section?'selected':''}>${esc(s.name)}</option>`).join('')}</select></label>`:''}
    <label>Start<input id="ptd-start" type="date" data-ptd="start" data-id="${esc(t.id)}" value="${esc(t.start||'')}"></label>
    <label>Planned hours<input id="ptd-est" type="number" min="0" step="0.25" data-ptd="est" data-id="${esc(t.id)}" value="${+t.est||''}"></label>
    <label class="switch"><input type="checkbox" id="ptd-ms" data-ptd="milestone" data-id="${esc(t.id)}" ${t.milestone?'checked':''}>Milestone</label>
    <label class="switch"><input type="checkbox" id="ptd-cl" data-ptd="client" data-id="${esc(t.id)}" ${t.client?'checked':''}>Show on client status page</label>
    <label>Add a collaborator<select id="ptd-asg" data-ptd="assignee" data-id="${esc(t.id)}"><option value="">Choose…</option>${team().filter(m=>m.id!==t.owner && !(t.assignees||[]).includes(m.id)).map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select></label>
    ${p ? p.fields.map(f=>`<label>${esc(f.name)}${fieldInput(f,t)}</label>`).join('') : ''}
  </div>
  ${(t.assignees||[]).length?`<div class="row small">Collaborators: ${t.assignees.map(a=>`<span class="flag" style="margin:0">${av(a)} ${esc(first(a))} <button class="btn sm ghost" data-pm="asg-del" data-id="${esc(t.id)}" data-m="${esc(a)}" aria-label="Remove ${esc(mname(a))}" style="padding:0 3px">✕</button></span>`).join(' ')}</div>`:''}
  <div class="panel" style="padding:12px;display:grid;gap:8px"><div class="spread"><h3>Subtasks</h3><span class="small muted">${subs.filter(x=>!isOpen(x)).length}/${subs.length}</span></div>
    ${subs.map(x=>`<div class="row" style="justify-content:space-between"><label class="switch"><input type="checkbox" id="sub-${esc(x.id)}" data-pmdone="${esc(x.id)}" ${isOpen(x)?'':'checked'}><span data-act="task" data-id="${esc(x.id)}" role="button" tabindex="0">${esc(x.title)}</span></label><span class="row small">${av(x.owner)}<span class="due ${lateCls(x)}">${fmtDate(x.due)}</span></span></div>`).join('')}
    <form class="row" id="subForm" data-id="${esc(t.id)}"><input id="sub-new" placeholder="Add a subtask (it gets its own owner and due date)" style="flex:1;min-width:0;border:1px solid var(--line);border-radius:8px;padding:6px 8px;background:var(--bg)"><select id="sub-owner" aria-label="Subtask owner" style="border:1px solid var(--line);border-radius:8px;padding:6px;background:var(--bg)"><option value="">Queue</option>${team().map(m=>`<option value="${m.id}" ${m.id===t.owner?'selected':''}>${esc(first(m.id))}</option>`).join('')}</select><button class="btn sm" type="submit">Add</button></form></div>
  <div class="panel" style="padding:12px;display:grid;gap:8px"><h3>Approval</h3>
    ${ap ? `<div class="row small">${ap.state==='pending'?`<span class="flag" style="margin:0">Waiting on ${esc(mname(ap.by))}</span>`:ap.state==='approved'?`<span style="color:var(--ok)">✓ Approved by ${esc(mname(ap.by))} ${fmtWhen(ap.at)}</span>`:`<span style="color:var(--bad)">Changes requested by ${esc(mname(ap.by))} ${fmtWhen(ap.at)}</span>`}${ap.note?` <span class="muted">“${esc(ap.note)}”</span>`:''}</div>
      ${ap.state==='pending' && ap.by===S.me ? `<div class="row"><input id="ap-note" placeholder="Note (optional)" style="flex:1;min-width:0;border:1px solid var(--line);border-radius:8px;padding:6px 8px;background:var(--bg)"><button class="btn sm accent" data-pm="approve" data-id="${esc(t.id)}">Approve</button><button class="btn sm danger" data-pm="reject" data-id="${esc(t.id)}">Request changes</button></div>` : ''}` : ''}
    ${!ap || ap.state!=='pending' ? `<div class="row"><select id="ap-by" aria-label="Approver" style="border:1px solid var(--line);border-radius:8px;padding:6px;background:var(--bg)">${team().filter(m=>m.id!==S.me).map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select><button class="btn sm" data-pm="ask-approval" data-id="${esc(t.id)}">Ask for approval</button></div><p class="small muted">The task can’t be marked done until the approver signs off.</p>` : ''}</div>
  <div class="panel" style="padding:12px;display:grid;gap:8px"><div class="spread"><h3>Files</h3>${ASSETS?`<label class="btn sm" for="tfile-${esc(t.id)}">Attach a file</label><input id="tfile-${esc(t.id)}" type="file" hidden data-pmup="task" data-id="${esc(t.id)}">`:''}</div>
    ${(t.files||[]).map((f,i)=>`<div class="row" style="justify-content:space-between"><a href="${esc(f.url)}" target="_blank" rel="noopener">📎 ${esc(f.name)}</a><span class="row small muted">${f.size?Math.round(f.size/1024)+' KB · ':''}${esc(first(f.by))}<button class="btn sm ghost" data-pm="file-del" data-id="${esc(t.id)}" data-i="${i}" aria-label="Remove file">✕</button></span></div>`).join('') || `<div class="small muted">${ASSETS?'No files yet.':'File uploads need Editor access to the hub; add a link below instead.'}</div>`}</div>`;
}
async function uploadFile(file, where, id){
  if(!ASSETS){ toast('File uploads aren’t available in this view'); return; }
  if(file.size > 20*1024*1024){ toast('Files must be under 20 MB'); return; }
  toast('Uploading '+file.name+'…');
  try{
    const r = await ASSETS.upload(file); const f = {id:r.id, url:r.url || ('/_blob/'+r.id), name:file.name, size:r.sizeBytes||file.size, type:r.contentType||file.type, by:S.me||'', at:nowISO()};
    if(where==='task'){ const t = S.tasks[id]; if(!t) return; put('tasks', id, {...t, files:[...(t.files||[]), f]}); if(t.owner && t.owner!==S.me) notify(t.owner, `${S.me?first(S.me):'Someone'} attached ${file.name} to “${t.title}”`, {task:id}); }
    else { const p = S.projects[id]; if(!p) return; put('projects', id, {...p, files:[...(p.files||[]), f]}); }
    audit('Uploaded a file', file.name); toast('Attached '+file.name); render();
  }catch(e){ toast(e && e.code==='not_permitted' ? 'Your access level can’t upload files' : 'Upload failed. Try a smaller file'); }
}
function requestApproval(id, by){
  const t = S.tasks[id]; if(!t || !by) return;
  put('tasks', id, {...t, approval:{by, state:'pending', reqBy:S.me||'', reqAt:nowISO()}, status: st(t)==='done' ? 'review' : st(t)==='in_progress' ? 'review' : t.status, history:hist(t, st(t)==='done'||st(t)==='in_progress'?'review':st(t), `Approval requested from ${mname(by)}`)});
  notify(by, `${S.me?first(S.me):'Someone'} asked for your approval: ${t.title}`, {task:id}, {email:true}); audit('Requested approval', t.title); toast('Approval requested from '+mname(by));
}
function decideApproval(id, ok, note){
  const t = S.tasks[id]; if(!t || !t.approval) return;
  const ap = {...t.approval, state: ok?'approved':'changes', at:nowISO(), note:note||''};
  put('tasks', id, {...t, approval:ap, history:hist(t, st(t), ok?'Approved':'Changes requested'+(note?`: ${note}`:''))});
  if(!ok && st(S.tasks[id])==='review') setTaskStatus(id, 'in_progress', 'Changes requested');
  const tell = new Set([ap.reqBy, t.owner].filter(x=>x && x!==S.me)); tell.forEach(p => notify(p, `${S.me?first(S.me):'Someone'} ${ok?'approved':'requested changes on'}: ${t.title}${note?` — “${note}”`:''}`, {task:id}, {email:!ok}));
  audit(ok?'Approved':'Requested changes', t.title); runRules('approval', id, {ok});
}

/* ---------- rule builder ---------- */
const TRIGGERS = [['created','A task is created'],['due_soon','A due date is coming up'],['overdue','A task becomes overdue'],['status','A task’s status changes'],['assigned','A task is assigned'],['approval','An approval is decided'],['form','A request form comes in']];
const ACTIONS = [['assign','Assign it to'],['add_assignee','Add a collaborator'],['status','Set status to'],['section','Move to section'],['due','Set due date to N days from now'],['notify','Notify'],['email','Email (via alerts)'],['comment','Post a comment'],['subtask','Add a subtask'],['checklist','Add a checklist step'],['milestone','Mark as milestone']];
let ruleDepth = 0;
const canAdminRules = () => S.mode!=='db' || S.canEdit || S.isOwner;
function ruleMatches(r, t, ctx){
  const c = r.cond || {};
  if(c.project && t.project!==c.project) return false;
  if(c.to && ctx.to!==c.to) return false;
  if(c.text && !String(t.title||'').toLowerCase().includes(String(c.text).toLowerCase())) return false;
  if(c.owner && t.owner!==c.owner) return false;
  if(r.on==='approval' && c.ok!=null && c.ok!=='' && String(!!ctx.ok)!==String(c.ok)) return false;
  return true;
}
function whoFor(v, t){ const p = t.project && S.projects[t.project]; return v==='owner' ? t.owner : v==='assigner' ? t.assignedBy : v==='projowner' ? p && p.owner : v==='lead' ? leadId() : v; }
function runRules(trig, id, ctx={}){
  if(ruleDepth > 2) return; const t0 = S.tasks[id]; if(!t0) return;
  const rs = list('rules').filter(r => r.active!==false && (r.on===trig || (trig==='created' && r.on==='form' && t0.src==='form')) && ruleMatches(r, t0, ctx)); if(!rs.length) return;
  ruleDepth++;
  try{ rs.forEach(r => execRule(r, id)); } finally { ruleDepth--; }
}
function execRule(r, id){
    (r.actions||[]).forEach(a => { const t = S.tasks[id]; if(!t) return; const v = a.v;
      try{
        if(a.type==='assign'){ const w = whoFor(v,t); if(w!==undefined && w!==t.owner) assignTask(id, w||''); }
        else if(a.type==='add_assignee'){ const w = whoFor(v,t); if(w && w!==t.owner && !(t.assignees||[]).includes(w)){ put('tasks', id, {...t, assignees:[...(t.assignees||[]), w]}); notify(w, `You were added to “${t.title}” by a rule: ${r.name}`, {task:id}); } }
        else if(a.type==='status'){ if(v && v!==st(t)) setTaskStatus(id, v, v==='blocked' ? `Rule: ${r.name}` : ''); }
        else if(a.type==='section'){ const p = t.project && S.projects[t.project]; const sec = p && p.sections.find(s=>s.id===v || s.name.toLowerCase()===String(v).toLowerCase()); if(sec && sec.id!==t.section) put('tasks', id, {...t, section:sec.id}); }
        else if(a.type==='due'){ const n = parseInt(v,10); if(!isNaN(n)) put('tasks', id, {...t, due:addDays(today(), n)}); }
        else if(a.type==='notify' || a.type==='email'){ const w = whoFor(v,t); if(w) notify(w, `${r.name}: ${t.title}`, {task:id, eng:t.eng}, {email:a.type==='email'}); }
        else if(a.type==='comment'){ if(v) put('tasks', id, {...t, comments:[...(t.comments||[]).slice(-49), {at:nowISO(), by:'', text:`⚙ ${v}`, mentions:[], rule:r.id}]}); }
        else if(a.type==='checklist'){ if(v) put('tasks', id, {...t, checklist:[...(t.checklist||[]), {t:v, done:false}]}); }
        else if(a.type==='milestone'){ put('tasks', id, {...t, milestone:true}); }
        else if(a.type==='subtask'){ if(v) createTask({title:v, owner:t.owner||'', due:t.due, eng:t.eng, lane:t.lane, src:'rule', extra:{project:t.project||'', section:t.section||'', parent:id, assignees:[], files:[], custom:{}}}); }
      }catch(_){ }
    });
    const rr = S.rules[r.id]; if(rr && canAdminRules()) put('rules', r.id, {...rr, runs:(+rr.runs||0)+1, lastRun:nowISO()});
}
function ruleSentence(r){
  const trig = (TRIGGERS.find(x=>x[0]===r.on)||[,''])[1]; const c = r.cond||{}; const cs = [];
  if(c.project) cs.push(`in ${S.projects[c.project] ? S.projects[c.project].name : 'a removed project'}`); if(c.to) cs.push(`and it moves to ${STATUSES.find(s=>s.id===c.to)?.name||c.to}`); if(r.on==='due_soon') cs.push(`(${+c.days||2} day${(+c.days||2)===1?'':'s'} before)`); if(c.text) cs.push(`and the title contains “${c.text}”`); if(c.owner) cs.push(`and ${mname(c.owner)} owns it`);
  if(r.on==='approval' && c.ok!=null && c.ok!=='') cs.push(c.ok==='true'?'and it was approved':'and changes were requested');
  const who = v => ({owner:'the owner', assigner:'whoever assigned it', projowner:'the project owner', lead:'the lead'}[v] || mname(v) || 'the queue');
  const as = (r.actions||[]).map(a => { const l = (ACTIONS.find(x=>x[0]===a.type)||[,a.type])[1];
    if(['assign','add_assignee','notify','email'].includes(a.type)) return `${l.toLowerCase()} ${who(a.v)}`; if(a.type==='status') return `set status to ${STATUSES.find(s=>s.id===a.v)?.name||a.v}`; if(a.type==='milestone') return 'mark it as a milestone';
    if(a.type==='section'){ const p = c.project && S.projects[c.project]; const s = p && p.sections.find(x=>x.id===a.v); return `move it to ${s?s.name:a.v}`; } if(a.type==='due') return `make it due in ${a.v} days`; return `${l.toLowerCase()} “${a.v}”`; });
  return `<b>When</b> ${esc(trig.toLowerCase())} ${esc(cs.join(' '))} <b>then</b> ${esc(as.join(', then ')) || 'do nothing yet'}`;
}
const RULE_RECIPES = [
  {name:'Blocked work goes to the lead', on:'status', cond:{to:'blocked'}, actions:[{type:'notify', v:'lead'},{type:'comment', v:'Lead notified automatically.'}]},
  {name:'Review means ask the assigner', on:'status', cond:{to:'review'}, actions:[{type:'email', v:'assigner'}]},
  {name:'Done tasks move to the Done section', on:'status', cond:{to:'done'}, actions:[{type:'section', v:'Done'}]},
  {name:'New requests get a 3-day due date and the project owner', on:'form', cond:{}, actions:[{type:'due', v:'3'},{type:'assign', v:'projowner'}]},
  {name:'Proposal tasks need a QA step', on:'created', cond:{text:'proposal'}, actions:[{type:'checklist', v:'Second reader QA'},{type:'add_assignee', v:'lead'}]},
  {name:'Changes requested reopens and tells the owner', on:'approval', cond:{ok:'false'}, actions:[{type:'notify', v:'owner'}]}];
function viewAutomations(){
  const rs = list('rules').sort((a,b)=>(a.created||'').localeCompare(b.created||'')); const d = S.ruleDraft;
  const whoOpts = sel => [['owner','The task owner'],['assigner','Whoever assigned it'],['projowner','The project owner'],['lead','The lead'],...team().map(m=>[m.id,m.name])].map(([v,l])=>`<option value="${esc(v)}" ${v===sel?'selected':''}>${esc(l)}</option>`).join('');
  const valInput = (a,i) => { const at = `data-rd="av" data-i="${i}" id="rd-av-${i}" aria-label="Action value"`;
    if(['assign','add_assignee','notify','email'].includes(a.type)) return `<select ${at}>${whoOpts(a.v)}</select>`;
    if(a.type==='status') return `<select ${at}>${STATUSES.map(s=>`<option value="${s.id}" ${s.id===a.v?'selected':''}>${esc(s.name)}</option>`).join('')}</select>`;
    if(a.type==='section'){ const p = d.cond.project && S.projects[d.cond.project]; return p ? `<select ${at}>${p.sections.map(s=>`<option value="${s.id}" ${s.id===a.v?'selected':''}>${esc(s.name)}</option>`).join('')}</select>` : `<input ${at} value="${esc(a.v||'')}" placeholder="Section name">`; }
    if(a.type==='milestone') return '';
    return `<input ${at} value="${esc(a.v||'')}" ${a.type==='due'?'type="number" min="0" placeholder="Days"':'placeholder="Text"'}>`; };
  return `<section class="spread"><div><p class="eyebrow">Automation</p><h1>Rules</h1><p class="muted" style="max-width:72ch">When something happens, the hub does the follow-up: assigns, moves, nudges, adds steps. Rules run for everyone on the team, in the browser of whoever made the change. Date rules (coming up, overdue) run whenever anyone has the hub open, once per task and due date.</p>${canAdminRules()?'':'<p class="small muted">Only Editors can create or change rules.</p>'}</div>${canAdminRules()?'<button class="btn primary" data-pm="rule-new">+ Rule</button>':''}</section>
  ${d ? `<section class="panel form" style="border-color:var(--accent)"><h2 style="grid-column:1/-1">${d.id?'Edit rule':'New rule'}</h2>
    <label class="full">Name<input id="rd-name" data-rd="name" value="${esc(d.name||'')}" placeholder="e.g. Blocked work goes to the lead"></label>
    <label>When<select id="rd-on" data-rd="on">${TRIGGERS.map(([v,l])=>`<option value="${v}" ${v===d.on?'selected':''}>${esc(l)}</option>`).join('')}</select></label>
    <label>In project<select id="rd-proj" data-rd="project"><option value="">Any project or none</option>${projects().map(p=>`<option value="${p.id}" ${p.id===d.cond.project?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label>
    ${d.on==='status'?`<label>Moves to<select id="rd-to" data-rd="to"><option value="">Any status</option>${STATUSES.map(s=>`<option value="${s.id}" ${s.id===d.cond.to?'selected':''}>${esc(s.name)}</option>`).join('')}</select></label>`:''}
    ${d.on==='due_soon'?`<label>Days before due<input id="rd-days" type="number" min="0" max="30" data-rd="days" value="${esc(d.cond.days||2)}"></label>`:''}
    ${d.on==='approval'?`<label>Outcome<select id="rd-ok" data-rd="ok"><option value="">Either</option><option value="true" ${d.cond.ok==='true'?'selected':''}>Approved</option><option value="false" ${d.cond.ok==='false'?'selected':''}>Changes requested</option></select></label>`:''}
    <label>Title contains (optional)<input id="rd-text" data-rd="text" value="${esc(d.cond.text||'')}"></label>
    <div class="full" style="grid-column:1/-1;display:grid;gap:6px"><b class="small">Then</b>${d.actions.map((a,i)=>`<div class="row"><select id="rd-at-${i}" data-rd="at" data-i="${i}" aria-label="Action">${ACTIONS.map(([v,l])=>`<option value="${v}" ${v===a.type?'selected':''}>${esc(l)}</option>`).join('')}</select>${valInput(a,i)}<button type="button" class="btn sm ghost" data-pm="rule-act-del" data-i="${i}" aria-label="Remove action">✕</button></div>`).join('')}
      <button type="button" class="btn sm" data-pm="rule-act-add" style="justify-self:start">+ Action</button></div>
    <p class="small" style="grid-column:1/-1">${ruleSentence(d)}</p>
    <div class="row" style="grid-column:1/-1;justify-content:flex-end"><button type="button" class="btn ghost" data-pm="rule-cancel">Cancel</button><button type="button" class="btn primary" data-pm="rule-save">Save rule</button></div></section>` : ''}
  <section class="panel" style="display:grid;gap:8px">${rs.map(r=>`<div class="row" style="justify-content:space-between;border-bottom:1px solid var(--line);padding:8px 0"><div><b>${esc(r.name||'Untitled rule')}</b><div class="small">${ruleSentence(r)}</div><div class="small muted">Ran ${+r.runs||0} time${(+r.runs||0)===1?'':'s'}${r.lastRun?` · last ${fmtWhen(r.lastRun)}`:''}</div></div>
    ${canAdminRules()?`<div class="row"><label class="switch"><input type="checkbox" id="ru-${esc(r.id)}" data-pmrule="${esc(r.id)}" ${r.active!==false?'checked':''}>On</label><button class="btn sm" data-pm="rule-edit" data-id="${esc(r.id)}">Edit</button><button class="btn sm ghost danger" data-pm="rule-del" data-id="${esc(r.id)}">Delete</button></div>`:`<span class="small muted">${r.active!==false?'On':'Off'}</span>`}</div>`).join('') || '<div class="empty">No rules yet. Start from a recipe below.</div>'}</section>
  <section class="panel"><h2 style="margin-bottom:8px">Recipes</h2><div class="dgrid">${RULE_RECIPES.map((r,i)=>`<div class="card" style="display:grid;gap:6px"><b>${esc(r.name)}</b><span class="small">${ruleSentence(r)}</span>${canAdminRules()?`<button class="btn sm" data-pm="rule-recipe" data-i="${i}" style="justify-self:start">Use this</button>`:''}</div>`).join('')}</div></section>`;
}

/* ---------- goals ---------- */
function goalProgress(g){
  if(g.fiosStatus==='done') return 1;
  if(g.mode==='projects'){ const ps = (g.projects||[]).map(i=>S.projects[i]).filter(Boolean); return ps.length ? ps.reduce((a,p)=>a+pProgress(p.id),0)/ps.length : 0; }
  if(g.mode==='children'){ const cs = list('goals').filter(x=>x.parent===g.id); return cs.length ? cs.reduce((a,c)=>a+goalProgress(c),0)/cs.length : 0; }
  const t = +g.target||0; const s = +g.startVal||0; return t===s ? 0 : Math.max(0, Math.min(1, ((+g.current||0)-s)/(t-s)));
}
function goalHealth(g){ if(g.fiosStatus) return {'on-track':'on_track','off-track':'off_track','done':'done'}[g.fiosStatus] || 'on_track'; const pr = goalProgress(g); if(!g.start || !g.due) return pr>=1?'done':'on_track'; const el = Math.max(0, Math.min(1, daysBetween(g.start, today())/Math.max(1,daysBetween(g.start, g.due)))); return pr>=1?'done': pr < el-0.25 ? 'off_track' : pr < el-0.1 ? 'at_risk' : 'on_track'; }
function viewGoals(){
  const gs = list('goals').filter(g=>!g.archived); const tops = gs.filter(g=>!g.parent || !S.goals[g.parent]);
  const row = (g, depth) => { const pr = goalProgress(g); const h = goalHealth(g); const kids = gs.filter(x=>x.parent===g.id); const last = (g.checkins||[]).slice(-1)[0];
    return `<div class="prow" style="padding-left:${10+depth*24}px;align-items:flex-start"><div style="flex:1"><b data-pm="goal-edit" data-id="${esc(g.id)}" role="button" tabindex="0">${depth?'↳ ':''}${esc(g.title)}</b>
      <div class="small muted">${esc(mname(g.owner))}${g.due?` · by ${fmtDate(g.due)}`:''} · ${g.link?`Quarterly priority${g.quarter?' '+esc(g.quarter):''} · Priorities &amp; Vision${g.mode==='projects'?` · ${(g.projects||[]).length} linked project${(g.projects||[]).length===1?'':'s'}`:''}`:g.mode==='projects'?`from ${(g.projects||[]).length} project${(g.projects||[]).length===1?'':'s'}`:g.mode==='children'?'from sub-goals':`${+g.current||0} of ${+g.target||0} ${esc(g.unit||'')}`}${last?` · checked in ${fmtWhen(last.at)}`:''}</div></div>
      <span class="pmeta">${pChip(h)}<span class="meter" style="width:90px"><span style="width:${Math.round(pr*100)}%;background:${pStatus(h)[2]}"></span></span><span class="num small" style="width:38px">${pct(pr)}</span><button class="btn sm" data-pm="goal-checkin" data-id="${esc(g.id)}">Check in</button></span></div>${kids.map(k=>row(k, depth+1)).join('')}`; };
  return `<section class="spread"><div><p class="eyebrow">Strategy</p><h1>Goals</h1><p class="muted" style="max-width:72ch">Outcomes the practice is working toward. A goal can track a number, roll up from projects, or roll up from sub-goals, so daily work connects to the result it serves.</p></div><button class="btn primary" data-pm="goal-new">+ Goal</button></section>
  <section class="panel" style="padding:8px 0">${tops.map(g=>row(g,0)).join('') || '<div class="empty" style="margin:12px">No goals yet. Try “Sign 4 new clients this quarter” or “Raise $250K for partners”.</div>'}</section>`;
}
function goalDialog(id){
  const g = id ? S.goals[id] : {title:'', owner:S.me||'', mode:'number', target:'', startVal:0, current:0, unit:'', start:today(), due:addDays(today(),90), projects:[], parent:''};
  $('#pmBody').innerHTML = `<form id="goalForm" data-id="${esc(id||'')}" class="form"><h2 style="grid-column:1/-1">${id?'Edit goal':'New goal'}</h2>
    <label class="full">Goal<input id="gl-title" required value="${esc(g.title)}" placeholder="Sign 4 new clients this quarter"></label>
    <label>Owner<select id="gl-owner">${team().map(m=>`<option value="${m.id}" ${m.id===g.owner?'selected':''}>${esc(m.name)}</option>`).join('')}</select></label>
    <label>Part of<select id="gl-parent"><option value="">Top-level goal</option>${list('goals').filter(x=>x.id!==id).map(x=>`<option value="${x.id}" ${x.id===g.parent?'selected':''}>${esc(x.title)}</option>`).join('')}</select></label>
    <label>Start<input id="gl-start" type="date" value="${esc(g.start||'')}"></label><label>Due<input id="gl-due" type="date" value="${esc(g.due||'')}"></label>
    <label class="full">Progress comes from<select id="gl-mode"><option value="number" ${g.mode==='number'?'selected':''}>A number we update</option><option value="projects" ${g.mode==='projects'?'selected':''}>Linked projects</option><option value="children" ${g.mode==='children'?'selected':''}>Its sub-goals</option></select></label>
    <label>Start value<input id="gl-sv" type="number" value="${esc(g.startVal||0)}"></label><label>Target<input id="gl-target" type="number" value="${esc(g.target||'')}"></label><label>Current<input id="gl-cur" type="number" value="${esc(g.current||0)}"></label><label>Unit<input id="gl-unit" value="${esc(g.unit||'')}" placeholder="clients, $, hours"></label>
    <fieldset class="full" style="grid-column:1/-1;border:1px solid var(--line);border-radius:8px;padding:8px"><legend class="small">Linked projects</legend>${projects().map(p=>`<label class="switch"><input type="checkbox" name="gl-p" value="${p.id}" ${(g.projects||[]).includes(p.id)?'checked':''}>${esc(p.name)}</label>`).join('') || '<span class="small muted">No projects yet.</span>'}</fieldset>
    <div class="row" style="grid-column:1/-1;justify-content:space-between">${id?`<button type="button" class="btn ghost danger" data-pm="goal-del" data-id="${esc(id)}">Archive</button>`:'<span></span>'}<span class="row"><button type="button" class="btn ghost" data-act="close-dlg" data-dlg="pmDlg">Cancel</button><button class="btn primary" type="submit">Save goal</button></span></div></form>`;
  $('#pmDlg').showModal();
}
function checkinDialog(id){
  const g = S.goals[id]; if(!g) return;
  $('#pmBody').innerHTML = `<form id="ciForm" data-id="${esc(id)}" class="form"><h2 style="grid-column:1/-1">Check in: ${esc(g.title)}</h2>
    ${g.mode==='number'?`<label>Current value<input id="ci-val" type="number" value="${esc(g.current||0)}"></label>`:`<p class="small muted full" style="grid-column:1/-1">Progress is calculated (${pct(goalProgress(g))}).</p>`}
    <label>How is it going?<select id="ci-st">${P_STATUS.filter(s=>g.link ? ['on_track','off_track','done'].includes(s[0]) : ['on_track','at_risk','off_track'].includes(s[0])).map(([k,l])=>`<option value="${k}" ${k===goalHealth(g)?'selected':''}>${l}</option>`).join('')}</select></label>
    <label class="full">Note<textarea id="ci-note" placeholder="What moved, what’s in the way"></textarea></label>
    <div class="small full" style="grid-column:1/-1">${(g.checkins||[]).slice(-5).reverse().map(c=>`<div>${pChip(c.status)} ${esc(first(c.by))} ${fmtWhen(c.at)}${c.val!=null?` · ${c.val}`:''}${c.note?` — ${esc(c.note)}`:''}</div>`).join('')}</div>
    <div class="row" style="grid-column:1/-1;justify-content:flex-end"><button type="button" class="btn ghost" data-act="close-dlg" data-dlg="pmDlg">Cancel</button><button class="btn primary" type="submit">Save check-in</button></div></form>`;
  $('#pmDlg').showModal();
}

/* ---------- dashboards ---------- */
const WIDGETS = [['kpis','Headline numbers'],['by_status','Open work by status'],['by_owner','Open work by person'],['late','Late tasks'],['projects','Project health'],['goals','Goals'],['milestones','Upcoming milestones'],['hours','Hours logged, last 8 weeks'],['done','Tasks finished, last 8 weeks'],['approvals','Waiting on approval'],['workload','This week’s load']];
function dashTasks(w){ return list('tasks').filter(t=>!t.cancelled && (!w.project || t.project===w.project) && (!w.owner || t.owner===w.owner || (t.assignees||[]).includes(w.owner))); }
function weekBuckets(n){ const base = new Date(today()+'T12:00:00'); base.setDate(base.getDate()-((base.getDay()+6)%7)); return [...Array(n)].map((_,i)=>{ const d = new Date(base); d.setDate(base.getDate()-(n-1-i)*7); return iso(d); }); }
function widgetHtml(w){
  const ts = dashTasks(w); const open = ts.filter(isOpen); const d = today();
  if(w.type==='kpis'){ const late = open.filter(t=>t.due && t.due<d).length; const wk = addDays(d,-7); const done7 = ts.filter(t=>t.doneAt && t.doneAt.slice(0,10)>=wk).length; const blocked = open.filter(t=>st(t)==='blocked').length; const unseen = open.filter(t=>st(t)==='assigned').length;
    return `<div class="kpis" style="margin:0">${[[open.length,'Open'],[late,'Late'],[blocked,'Blocked'],[unseen,'Not yet seen'],[done7,'Done this week']].map(([v,l])=>`<div class="kpi"><span class="v">${v}</span><span class="l">${l}</span></div>`).join('')}</div>`; }
  if(w.type==='by_status'){ const ss = STATUSES.filter(s=>s.id!=='done'); return hbars(ss.map(s=>[s.name, open.filter(t=>st(t)===s.id).length])); }
  if(w.type==='by_owner'){ return hbars([...team().map(m=>[m.name, open.filter(t=>t.owner===m.id).length]), ['Queue', open.filter(t=>!t.owner).length]]); }
  if(w.type==='late'){ const l = open.filter(t=>t.due && t.due<d).sort((a,b)=>a.due.localeCompare(b.due)).slice(0,8); return l.map(t=>`<div class="row small" style="justify-content:space-between;padding:3px 0"><span data-act="task" data-id="${esc(t.id)}" role="button" tabindex="0">${esc(t.title)}</span><span>${av(t.owner)} <span class="due over">${fmtDate(t.due)}</span></span></div>`).join('') || '<div class="small muted">Nothing late. 🎉</div>'; }
  if(w.type==='projects'){ return projects().filter(p=>!w.project || p.id===w.project).map(p=>{ const h = pHealth(p); return `<div class="row small" style="justify-content:space-between;padding:3px 0"><span data-pm="open" data-id="${esc(p.id)}" role="button" tabindex="0">${esc(p.name)}</span><span class="row">${pChip(p.status||h.k)}<span class="meter" style="width:70px"><span style="width:${Math.round(h.prog*100)}%;background:var(--ok)"></span></span></span></div>`; }).join('') || '<div class="small muted">No projects.</div>'; }
  if(w.type==='goals'){ return list('goals').filter(g=>!g.archived && !g.parent).map(g=>`<div class="row small" style="justify-content:space-between;padding:3px 0"><span>${esc(g.title)}</span><span class="row">${pChip(goalHealth(g))}<span class="num">${pct(goalProgress(g))}</span></span></div>`).join('') || '<div class="small muted">No goals.</div>'; }
  if(w.type==='milestones'){ return ts.filter(t=>t.milestone && isOpen(t)).sort((a,b)=>(a.due||'').localeCompare(b.due||'')).slice(0,8).map(t=>`<div class="row small" style="justify-content:space-between;padding:3px 0"><span data-act="task" data-id="${esc(t.id)}" role="button" tabindex="0">◆ ${esc(t.title)}</span><span class="due ${lateCls(t)}">${fmtDate(t.due)}</span></div>`).join('') || '<div class="small muted">No open milestones.</div>'; }
  if(w.type==='hours' || w.type==='done'){ const ws = weekBuckets(8); const vals = ws.map(a => { const b = addDays(a,7); return w.type==='done' ? ts.filter(t=>t.doneAt && t.doneAt.slice(0,10)>=a && t.doneAt.slice(0,10)<b).length : ts.reduce((s,t)=>s+(t.timeLog||[]).filter(l=>(l.at||'').slice(0,10)>=a && (l.at||'').slice(0,10)<b).reduce((x,l)=>x+(+l.min||0),0)/60, 0); });
    return barSvg(vals, ws.map(x=>fmtDate(x)), w.type==='done'?(v=>String(Math.round(v))):(v=>fmtH(v)), WIDGETS.find(x=>x[0]===w.type)[1]); }
  if(w.type==='approvals'){ return ts.filter(t=>t.approval && t.approval.state==='pending').map(t=>`<div class="row small" style="justify-content:space-between;padding:3px 0"><span data-act="task" data-id="${esc(t.id)}" role="button" tabindex="0">${esc(t.title)}</span><span>waiting on ${esc(first(t.approval.by))}</span></div>`).join('') || '<div class="small muted">Nothing waiting.</div>'; }
  if(w.type==='workload'){ const {grid} = workloadData(1); return hbars(team().map(m=>[m.name, Math.round(grid[m.id][0].h*10)/10, +m.capacity||0]), true); }
  return '';
}
function hbars(rows, withCap){ const mx = Math.max(1, ...rows.map(r=>Math.max(r[1], r[2]||0))); return `<div style="display:grid;gap:5px">${rows.map(([l,v,c])=>`<div class="row small" style="gap:8px"><span style="width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l)}</span><span style="flex:1;height:12px;background:var(--line);border-radius:6px;position:relative;overflow:hidden"><span style="position:absolute;inset:0 auto 0 0;width:${v/mx*100}%;background:${withCap&&c&&v>c?'var(--bad)':'var(--navy)'};border-radius:6px"></span>${withCap&&c?`<span style="position:absolute;top:0;bottom:0;left:${c/mx*100}%;width:2px;background:var(--ink)"></span>`:''}</span><span class="num" style="width:48px;text-align:right">${withCap?fmtH(v):v}</span></div>`).join('')}</div>`; }
const DEFAULT_DASH = [{type:'kpis', w:2},{type:'projects'},{type:'by_owner'},{type:'late'},{type:'milestones'},{type:'done'},{type:'goals'}];
function viewDashboards(){
  const ds = list('dashboards').sort((a,b)=>(a.created||'').localeCompare(b.created||'')); const cur = (S.dashOpen && S.dashboards[S.dashOpen]) || ds[0]; const ws = cur ? cur.widgets : DEFAULT_DASH;
  return `<section class="spread"><div><p class="eyebrow">Reporting</p><h1>Dashboards</h1></div><div class="row">${ds.length?`<select id="dash-pick" data-pmdash="pick" aria-label="Dashboard">${ds.map(d=>`<option value="${d.id}" ${cur&&d.id===cur.id?'selected':''}>${esc(d.name)}</option>`).join('')}</select>`:''}<button class="btn" data-pm="dash-new">+ Dashboard</button>${cur?`<button class="btn" data-pm="dash-add">+ Widget</button>`:''}<button class="btn" data-px="digest">Daily digest</button><button class="btn" data-pm="ai-ask">✦ Ask about our work</button></div></section>
  ${!cur?`<div class="prompt">This is the starter dashboard. Make your own with “+ Dashboard” to choose widgets, filter them by project or person, and arrange them.</div>`:''}
  ${S.dashAdd && cur ? `<section class="panel row"><select id="dw-type" aria-label="Widget">${WIDGETS.map(([v,l])=>`<option value="${v}">${esc(l)}</option>`).join('')}</select><select id="dw-proj" aria-label="Project filter"><option value="">All projects</option>${projects().map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select><select id="dw-own" aria-label="Person filter"><option value="">Everyone</option>${team().map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select><label class="switch"><input type="checkbox" id="dw-wide">Wide</label><button class="btn primary sm" data-pm="dash-add-go">Add</button><button class="btn ghost sm" data-pm="dash-add-x">Cancel</button></section>`:''}
  <section class="dgrid">${ws.map((w,i)=>`<div class="panel dwid" style="${w.w===2?'grid-column:1/-1':''}"><div class="spread" style="margin-bottom:8px"><h2 class="h3">${esc((WIDGETS.find(x=>x[0]===w.type)||[,''])[1])}${w.project&&S.projects[w.project]?` · ${esc(S.projects[w.project].name)}`:''}${w.owner?` · ${esc(first(w.owner))}`:''}</h2>${cur?`<span class="row"><button class="btn sm ghost" data-pm="dw-up" data-i="${i}" aria-label="Move earlier">↑</button><button class="btn sm ghost" data-pm="dw-del" data-i="${i}" aria-label="Remove widget">✕</button></span>`:''}</div>${widgetHtml(w)}</div>`).join('')}</section>`;
}

/* ---------- Claude: plan, break down, status, ask ---------- */
function aiErr(e){ const c = e && e.code; if(c==='not_granted' || c==='sampling_disabled' || c==='not_declared' || c==='capability_disabled') return 'Claude isn’t available for this hub right now.'; if(c==='rate_limited') return 'Claude is busy. Try again in a minute.'; if(c==='cancelled') return 'Stopped.'; if(c==='invalid_json') return 'Claude’s answer didn’t come back in the right shape. Try again.'; return 'Claude didn’t answer. Try again.'; }
function aiDialog(mode, id){
  if(!SAMPLE){ toast('Claude is available when the hub is opened on claude.ai'); return; }
  S.ai = {mode, id, busy:false, out:'', plan:null};
  const p = id && S.projects[id];
  const head = {plan:['Plan a project with Claude','Describe the project. Claude drafts sections, tasks, hours, dates and dependencies. You review before anything is created.'], break:['Suggest tasks for '+(p?p.name:''),'Claude reads the project and suggests tasks that are missing. You pick which to add.'], status:['Draft a status update','Claude reads the project’s tasks, dates and blocks and drafts an update with risks. You edit before posting.'], ask:['Ask about our work','Ask anything about projects, tasks, workload or goals. Claude reads a snapshot of the hub.']}[mode];
  $('#pmBody').innerHTML = `<div style="display:grid;gap:12px"><div class="spread"><div><p class="eyebrow">✦ Claude</p><h2>${esc(head[0])}</h2></div><button class="btn ghost" data-act="close-dlg" data-dlg="pmDlg" aria-label="Close">✕</button></div><p class="small muted">${esc(head[1])}</p>
    ${mode==='plan'?`<form id="aiForm" class="form"><label class="full">Project name<input id="ai-name" required placeholder="Board retreat for Harbor Arts"></label><label class="full">What should it achieve? Any constraints?<textarea id="ai-brief" required placeholder="Two-day strategic planning retreat for 12 board members in March. Need venue, pre-reads, facilitation plan, follow-up report."></textarea></label><label>Start<input id="ai-start" type="date" value="${today()}"></label><label>Due<input id="ai-due" type="date" value="${addDays(today(),45)}"></label><div class="row" style="grid-column:1/-1;justify-content:flex-end"><button class="btn primary" type="submit">Draft the plan</button></div></form>`
    : mode==='ask'?`<form id="aiForm" class="row"><input id="ai-q" required placeholder="Who is overloaded next week? What’s at risk this month?" style="flex:1;min-width:0;border:1px solid var(--line);border-radius:8px;padding:8px;background:var(--bg)"><button class="btn primary" type="submit">Ask</button></form>`
    : `<div class="row"><button class="btn primary" data-pm="ai-go">${mode==='status'?'Draft the update':'Suggest tasks'}</button></div>`}
    <div id="aiOut"></div></div>`;
  $('#pmDlg').showModal();
}
function aiBusy(on, txt){ S.ai.busy = on; const o = $('#aiOut'); if(o && on) o.innerHTML = `<div class="row"><span class="small muted">${esc(txt||'Thinking…')}</span><button class="btn sm ghost" data-pm="ai-stop">Stop</button></div>`; }
function projectSnapshot(p){
  const ts = ptasks(p.id); const d = today();
  return `Project: ${p.name}\nGoal: ${(p.doc||p.desc||'').slice(0,1200)}\nDates: ${p.start||'?'} to ${p.due||'?'} (today ${d})\nStatus set: ${pStatus(p.status).at(1)}\nSections: ${p.sections.map(s=>s.name).join(', ')}\nTasks:\n` +
    ts.slice(0,120).map(t=>`- [${st(t)}] ${t.parent?'(subtask) ':''}${t.milestone?'(milestone) ':''}${t.title} | owner ${t.owner?mname(t.owner):'none'} | due ${t.due||'-'}${t.due&&isOpen(t)&&t.due<d?' LATE':''} | planned ${+t.est||0}h, logged ${Math.round(hrs(t)*10)/10}h${openDeps(t).length?` | waits on ${openDeps(t).map(x=>x.title).join('; ')}`:''}${st(t)==='blocked'&&t.history?` | blocked: ${([...t.history].reverse().find(h=>h.to==='blocked')||{}).note||''}`:''}`).join('\n');
}
function hubSnapshot(){
  const d = today(); const {ws, grid} = workloadData(3);
  return `Today: ${d}\nTeam: ${team().map(m=>`${m.name} (${+m.capacity||'?'} h/week; planned next 3 weeks: ${grid[m.id].map(c=>Math.round(c.h)).join(', ')}h; open tasks ${list('tasks').filter(t=>isOpen(t)&&t.owner===m.id).length})`).join('; ')}\n` +
    `Projects:\n${projects().map(p=>{ const h = pHealth(p); return `- ${p.name}: ${pStatus(p.status).at(1)}, ${Math.round(h.prog*100)}% done, due ${p.due||'-'}, ${h.late} late, ${h.blocked} blocked, owner ${mname(p.owner)}`; }).join('\n')}\n` +
    `Goals:\n${list('goals').filter(g=>!g.archived).map(g=>`- ${g.title}: ${Math.round(goalProgress(g)*100)}%, due ${g.due||'-'}, owner ${mname(g.owner)}`).join('\n')}\n` +
    `Open tasks (up to 150):\n${list('tasks').filter(isOpen).slice(0,150).map(t=>`- [${st(t)}] ${t.title} | ${t.project&&S.projects[t.project]?S.projects[t.project].name:(t.eng&&S.engagements[t.eng]?S.engagements[t.eng].org:'no project')} | owner ${t.owner?mname(t.owner):'queue'} | due ${t.due||'-'}${t.due&&t.due<d?' LATE':''} | ${+t.est||0}h planned`).join('\n')}`;
}
async function aiRun(extra){
  const m = S.ai.mode; const ctl = new AbortController(); S.ai.ctl = ctl; const out = () => $('#aiOut');
  try{
    if(m==='plan' || m==='break'){
      aiBusy(true, m==='plan'?'Claude is drafting the plan. This can take up to a minute.':'Claude is reading the project…');
      const p = m==='break' && S.projects[S.ai.id];
      const prompt = (m==='plan' ? `You are planning a project for a small nonprofit consulting practice (team: ${team().map(x=>x.name+(x.role?` – ${x.role}`:'')).join('; ')}).\nProject: ${extra.name}\nBrief: ${extra.brief}\nStart ${extra.start}, due ${extra.due}.\n`
        : `Here is an existing project. Suggest 4–10 tasks that are missing to deliver it well. Don't repeat existing tasks.\n${projectSnapshot(p)}\n`) +
        `Reply with only JSON: {"sections":[{"name":string,"tasks":[{"title":string,"hours":number,"startDay":number,"days":number,"milestone":boolean,"owner":string|null,"after":[string]}]}]}\n` +
        `startDay is days after the project start; days is duration. "after" lists titles of tasks it waits for. owner is a team member's first name or null. Use 2–5 sections and 6–25 tasks total. Keep titles short and actionable.`;
      const r = await SAMPLE.json(prompt, {signal:ctl.signal});
      const secs = Array.isArray(r && r.sections) ? r.sections.filter(s=>s && s.name && Array.isArray(s.tasks)) : [];
      if(!secs.length) throw {code:'invalid_json'};
      S.ai.plan = {secs, extra}; S.ai.busy = false;
      out().innerHTML = `<form id="aiApply" style="display:grid;gap:10px">${secs.map((s,si)=>`<div><b>${esc(s.name)}</b>${s.tasks.map((t,ti)=>`<label class="switch small" style="display:flex"><input type="checkbox" name="ai-t" value="${si}.${ti}" checked>${t.milestone?'◆ ':''}${esc(String(t.title||''))} <span class="muted">· ${+t.hours||0}h${t.owner?` · ${esc(String(t.owner))}`:''}${(t.after||[]).length?` · after ${esc(t.after.join(', '))}`:''}</span></label>`).join('')}</div>`).join('')}
        <div class="row" style="justify-content:flex-end"><button class="btn ghost" type="button" data-pm="ai-go">Try again</button><button class="btn primary" type="submit">${m==='plan'?'Create the project':'Add selected tasks'}</button></div></form>`;
    } else {
      const txt = m==='status' ? `Write a short project status update for the team and a client-friendly sponsor. Use plain language.\nFormat: one line "Status: On track|At risk|Off track", then sections "Progress", "Next two weeks", "Risks and asks" with 2–4 bullets each. Name owners. Flag late, blocked, or unstarted work near its due date, and whether the finish date is realistic given planned hours.\n\n${projectSnapshot(S.projects[S.ai.id])}`
        : `Answer the question using only this snapshot of our team's project hub. Be specific and brief (under 200 words). Name people, projects and dates. If the data can't answer it, say what's missing.\n\nQuestion: ${extra.q}\n\n${hubSnapshot()}`;
      aiBusy(true); let started = false;
      const {text} = await SAMPLE(txt.slice(0, 200000), {signal:ctl.signal, cache:false, onText:({text}) => { if(!started){ started = true; out().innerHTML = `<div id="aiText" class="prompt" style="white-space:pre-wrap"></div>`; } $('#aiText').textContent = text; }});
      S.ai.busy = false; S.ai.out = text;
      if(m==='status') out().innerHTML = `<textarea id="ai-edit" style="width:100%;min-height:260px;border:1px solid var(--line);border-radius:8px;padding:10px;background:var(--bg);font:14px/1.5 var(--f-body)">${esc(text)}</textarea><div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn ghost" data-pm="ai-go">Redo</button><button class="btn primary" data-pm="ai-post" data-id="${esc(S.ai.id)}">Post update</button></div>`;
    }
  }catch(e){ S.ai.busy = false; const o = out(); if(o) o.innerHTML = `${e && e.text ? `<div class="prompt" style="white-space:pre-wrap">${esc(e.text)}</div>`:''}<p class="small" style="color:var(--bad)">${esc(aiErr(e))}</p>`; }
}
function applyAiPlan(picked){
  const {secs, extra} = S.ai.plan; const m = S.ai.mode; let pid = S.ai.id;
  if(m==='plan'){ pid = newProject({name:extra.name, desc:extra.brief, start:extra.start, due:extra.due}); const p = S.projects[pid]; put('projects', pid, {...p, doc:extra.brief, sections:[...secs.map((s,i)=>({id:'s'+(i+1), name:String(s.name).slice(0,60)})), {id:'sdone', name:'Done'}]}); }
  const p = S.projects[pid]; const byTitle = {}; const created = [];
  const ownerOf = n => { if(!n) return ''; const m2 = team().find(x=>first(x.id).toLowerCase()===String(n).toLowerCase() || x.name.toLowerCase()===String(n).toLowerCase()); return m2 ? m2.id : ''; };
  secs.forEach((s, si) => { const sec = m==='plan' ? 's'+(si+1) : (p.sections.find(x=>x.name.toLowerCase()===String(s.name).toLowerCase()) || p.sections[0]).id;
    s.tasks.forEach((t, ti) => { if(!picked.has(si+'.'+ti)) return; const st0 = addDays(p.start||today(), Math.max(0, +t.startDay||0)); const due = addDays(st0, Math.max(0, (+t.days||1)-1));
      const id = pmTask(pid, String(t.title).slice(0,140), {section:sec, est:+t.hours||0, start: t.milestone?'':st0, due, milestone:!!t.milestone, owner:ownerOf(t.owner), src:'claude'}); byTitle[String(t.title).toLowerCase()] = id; created.push([id, t]); }); });
  const all = Object.fromEntries(ptasks(pid).map(t=>[t.title.toLowerCase(), t.id]));
  created.forEach(([id, t]) => { const needs = (t.after||[]).map(a=>byTitle[String(a).toLowerCase()] || all[String(a).toLowerCase()]).filter(x=>x && x!==id); if(needs.length){ const tk = S.tasks[id]; put('tasks', id, {...tk, needs:[...new Set([...(tk.needs||[]), ...needs])]}); } });
  audit(m==='plan'?'Created a project with Claude':'Added tasks suggested by Claude', `${created.length} tasks`); $('#pmDlg').close(); toast(`${created.length} tasks added`); openProject(pid, m==='plan'?'timeline':'list');
}
function postUpdate(pid, text, status){
  const p = S.projects[pid]; if(!p || !text.trim()) return; const m = /Status:\s*(On track|At risk|Off track)/i.exec(text); const k = status || (m ? m[1].toLowerCase().replace(' ','_') : p.status||'on_track');
  put('projects', pid, {...p, status:k, updates:[...(p.updates||[]).slice(-29), {at:nowISO(), by:S.me||'', text:text.trim(), status:k}]});
  new Set([p.owner, ...ptasks(pid).map(t=>t.owner)].filter(x=>x && x!==S.me)).forEach(x => notify(x, `Status update on ${p.name}: ${pStatus(k)[1]}`, {}));
  audit('Posted a project update', p.name); toast('Update posted');
}

/* ---------- export ---------- */
function exportProject(pid){
  const p = S.projects[pid]; const ts = ptasks(pid);
  const rows = [['Task','Parent','Section','Owner','Collaborators','Status','Start','Due','Milestone','Planned h','Logged h', ...p.fields.map(f=>f.name)], ...ts.map(t=>[t.title, t.parent&&S.tasks[t.parent]?S.tasks[t.parent].title:'', (p.sections.find(s=>s.id===t.section)||{}).name||'', mname(t.owner)||'', (t.assignees||[]).map(mname).join('; '), st(t), t.start||'', t.due||'', t.milestone?'yes':'', +t.est||0, Math.round(hrs(t)*100)/100, ...p.fields.map(f=>{ const v = (t.custom||{})[f.id]; return f.type==='person' ? mname(v)||'' : v==null?'':v; })])];
  saveFile(`${p.name.replace(/[^\w]+/g,'-').toLowerCase()}-tasks.csv`, toCsv(rows));
}

/* ---------- events ---------- */
document.addEventListener('click', ev => {
  const b = ev.target.closest && ev.target.closest('[data-pm]'); if(!b) return; const a = b.dataset.pm, id = b.dataset.id; track('act', 'pm-'+a);
  const p = S.projects[S.projectOpen];
  if(a==='open'){ openProject(id); return; }
  if(a==='open-status'){ S.statusProject = id; location.hash = 'clientview'; return; }
  if(a==='new'){ projectDialog(null); return; } if(a==='edit'){ projectDialog(id); return; }
  if(a==='archive'){ const x = S.projects[id]; if(x && confirm2(b, 'Archive this project?')){ put('projects', id, {...x, archived:true}); audit('Archived a project', x.name); $('#pmDlg').close(); location.hash='projects'; } return; }
  if(a==='ptab'){ S.pTab = b.dataset.v; render(); return; }
  if(a==='gzoom'){ S.gZoom = b.dataset.v; try{ localStorage.setItem('fii-gzoom', b.dataset.v); }catch(_){} const w = document.querySelector('.gwrap'); if(w) delete w.dataset.k; if(S._gScroll) delete S._gScroll[S.projectOpen]; render(); return; }
  if(a==='gtoday'){ const w = document.querySelector('.gwrap'), td = document.querySelector('.gtoday'); if(w && td) w.scrollTo({left:Math.max(0, parseFloat(td.style.left) - w.clientWidth*0.35), behavior:'smooth'}); return; }
  if(a==='add-task'){ const tid = pmTask(id, 'New task', {owner:S.me||''}); openTask(tid); return; }
  if(a==='add-section' && p){ put('projects', p.id, {...p, sections:[...p.sections, {id:'s'+uid().slice(0,6), name:'New section'}]}); render(); return; }
  if(a==='add-field'){ fieldDialog(); return; }
  if(a==='del-field' && p){ if(!confirm2(b,'Remove this field from the project?')) return; put('projects', p.id, {...p, fields:p.fields.filter(f=>f.id!==b.dataset.f)}); render(); return; }
  if(a==='export-proj' && p){ exportProject(p.id); return; }
  if(a==='post-update'){ $('#pmBody').innerHTML = `<form id="updForm" data-id="${esc(id)}" class="form"><h2 style="grid-column:1/-1">Post an update</h2><label>Status<select id="up-st">${P_STATUS.map(([k,l])=>`<option value="${k}" ${k===(S.projects[id].status||'on_track')?'selected':''}>${l}</option>`).join('')}</select></label><label class="full">Update<textarea id="up-text" required style="min-height:160px" placeholder="Progress, next two weeks, risks and asks"></textarea></label><div class="row" style="grid-column:1/-1;justify-content:flex-end"><button type="button" class="btn ghost" data-act="close-dlg" data-dlg="pmDlg">Cancel</button><button class="btn primary" type="submit">Post</button></div></form>`; $('#pmDlg').showModal(); return; }
  if(a==='wl'){ const k = {m:b.dataset.m, w:+b.dataset.w}; S.wlCell = S.wlCell && S.wlCell.m===k.m && S.wlCell.w===k.w ? null : k; render(); return; }
  if(a==='asg-del'){ const t = S.tasks[id]; if(t) put('tasks', id, {...t, assignees:(t.assignees||[]).filter(x=>x!==b.dataset.m)}); renderTask(); return; }
  if(a==='file-del'){ const t = S.tasks[id]; if(!t || !confirm2(b,'Remove this file from the task?')) return; const f = t.files[+b.dataset.i]; put('tasks', id, {...t, files:t.files.filter((_,i)=>i!==+b.dataset.i)}); if(ASSETS && f && f.id && f.by===S.me) ASSETS.delete(f.id).catch(()=>{}); renderTask(); return; }
  if(a==='ask-approval'){ requestApproval(id, $('#ap-by').value); renderTask(); return; }
  if(a==='approve' || a==='reject'){ const n = ($('#ap-note')||{}).value||''; if(a==='reject' && !n){ toast('Say what needs to change'); $('#ap-note').focus(); return; } decideApproval(id, a==='approve', n); renderTask(); render(); return; }
  if(a==='rule-new'){ S.ruleDraft = {name:'', on:'status', cond:{}, actions:[{type:'notify', v:'owner'}]}; render(); return; }
  if(a==='rule-recipe'){ const r = RULE_RECIPES[+b.dataset.i]; S.ruleDraft = JSON.parse(JSON.stringify(r)); render(); return; }
  if(a==='rule-edit'){ S.ruleDraft = JSON.parse(JSON.stringify(S.rules[id])); S.ruleDraft.cond = S.ruleDraft.cond||{}; render(); return; }
  if(a==='rule-cancel'){ S.ruleDraft = null; render(); return; }
  if(a==='rule-act-add'){ S.ruleDraft.actions.push({type:'notify', v:'owner'}); render(); return; }
  if(a==='rule-act-del'){ S.ruleDraft.actions.splice(+b.dataset.i,1); render(); return; }
  if(a==='rule-save'){ const d = S.ruleDraft; if(!d.name){ toast('Give the rule a name'); return; } if(!d.actions.length){ toast('Add at least one action'); return; } const rid = d.id || uid(); put('rules', rid, {...d, active:d.active!==false, created:d.created||nowISO(), createdBy:d.createdBy||S.me||''}); audit(d.id?'Edited a rule':'Created a rule', d.name); S.ruleDraft = null; toast('Rule saved'); render(); return; }
  if(a==='rule-del'){ const r = S.rules[id]; if(r && confirm2(b,'Delete this rule?')){ del('rules', id); audit('Deleted a rule', r.name); render(); } return; }
  if(a==='goal-new'){ goalDialog(null); return; } if(a==='goal-edit'){ goalDialog(id); return; } if(a==='goal-checkin'){ checkinDialog(id); return; }
  if(a==='goal-del'){ const g = S.goals[id]; if(g){ put('goals', id, {...g, archived:true}); audit('Archived a goal', g.title); $('#pmDlg').close(); render(); } return; }
  if(a==='dash-new'){ const did = uid(); put('dashboards', did, {name:'Dashboard '+(list('dashboards').length+1), widgets:JSON.parse(JSON.stringify(DEFAULT_DASH)), created:nowISO(), createdBy:S.me||''}); S.dashOpen = did; toast('Dashboard created from the starter widgets. Rename it in Setup later, or just use it.'); render(); return; }
  const cur = (S.dashOpen && S.dashboards[S.dashOpen]) || list('dashboards').sort((x,y)=>(x.created||'').localeCompare(y.created||''))[0];
  if(a==='dash-add'){ S.dashAdd = true; render(); return; } if(a==='dash-add-x'){ S.dashAdd = false; render(); return; }
  if(a==='dash-add-go' && cur){ put('dashboards', cur.id, {...cur, widgets:[...cur.widgets, {type:$('#dw-type').value, project:$('#dw-proj').value, owner:$('#dw-own').value, w:$('#dw-wide').checked?2:1}]}); S.dashAdd = false; render(); return; }
  if(a==='dw-del' && cur){ put('dashboards', cur.id, {...cur, widgets:cur.widgets.filter((_,i)=>i!==+b.dataset.i)}); render(); return; }
  if(a==='dw-up' && cur){ const i = +b.dataset.i; if(i>0){ const w = cur.widgets.slice(); [w[i-1], w[i]] = [w[i], w[i-1]]; put('dashboards', cur.id, {...cur, widgets:w}); render(); } return; }
  if(a==='ai-new'){ aiDialog('plan'); return; } if(a==='ai-break'){ aiDialog('break', id); return; } if(a==='ai-status'){ aiDialog('status', id); return; } if(a==='ai-ask'){ aiDialog('ask'); return; }
  if(a==='ai-go'){ aiRun(S.ai.extra||{}); return; }
  if(a==='ai-stop'){ S.ai.ctl && S.ai.ctl.abort(); return; }
  if(a==='ai-post'){ postUpdate(id, $('#ai-edit').value); $('#pmDlg').close(); render(); return; }
});
function confirm2(b, msg){ if(b.dataset.armed){ return true; } b.dataset.armed = '1'; const old = b.textContent; b.textContent = 'Click again to confirm'; toast(msg); setTimeout(()=>{ delete b.dataset.armed; b.textContent = old; }, 3000); return false; }
document.addEventListener('change', ev => {
  const el = ev.target; const ds = el.dataset;
  if(ds.pmdone){ const t = S.tasks[ds.pmdone]; if(!t) return; const ok = el.checked ? setTaskStatus(t.id, 'done') : setTaskStatus(t.id, t.owner?'in_progress':'unassigned'); if(ok===false) el.checked = !el.checked; render(); if($('#taskDlg').open) renderTask(); return; }
  if(ds.pmt){ const t = S.tasks[ds.id]; if(!t) return; const k = ds.pmt; const v = el.type==='checkbox' ? el.checked : el.value;
    if(k==='owner'){ assignTask(t.id, v); } else if(k==='status'){ if(setTaskStatus(t.id, v, v==='blocked'?'Flagged from the table':'')===false) el.value = st(t); }
    else if(k.startsWith('custom:')){ put('tasks', t.id, {...t, custom:{...(t.custom||{}), [k.slice(7)]: el.type==='number' ? (v===''?'':+v) : v}}); }
    else if(k==='title'){ if(v.trim()) put('tasks', t.id, {...t, title:v.trim()}); }
    else if(k==='est'){ put('tasks', t.id, {...t, est:+v||0}); }
    else put('tasks', t.id, {...t, [k]:v});
    if(k==='due' || k==='start') afterDates(t.id);
    if($('#taskDlg').open && S.taskOpen===t.id) renderTask(); return; }
  if(ds.ptd){ const t = S.tasks[ds.id]; if(!t) return; const k = ds.ptd;
    if(k==='project'){ const p = S.projects[el.value]; put('tasks', t.id, {...t, project:el.value, section:p?p.sections[0].id:'', eng: t.eng || (p&&p.eng) || ''}); subtasksOf(t.id).forEach(x=>put('tasks', x.id, {...x, project:el.value, section:p?p.sections[0].id:''})); }
    else if(k==='assignee'){ if(el.value){ put('tasks', t.id, {...t, assignees:[...(t.assignees||[]), el.value]}); notify(el.value, `${S.me?first(S.me):'Someone'} added you to “${t.title}”`, {task:t.id}, {email:true}); } }
    else if(k==='milestone'){ put('tasks', t.id, {...t, milestone:el.checked}); }
    else if(k==='client'){ put('tasks', t.id, {...t, client:el.checked}); }
    else if(k==='est'){ put('tasks', t.id, {...t, est:+el.value||0}); }
    else put('tasks', t.id, {...t, [k]:el.value});
    renderTask(); render(); return; }
  if(ds.pmp && S.projects[S.projectOpen]){ const p = S.projects[S.projectOpen]; if(ds.pmp==='doc'){ if(el.value!==(p.doc||'')) put('projects', p.id, {...p, doc:el.value, docBy:S.me||'', docAt:nowISO()}); } else { put('projects', p.id, {...p, [ds.pmp]:el.value}); audit('Changed project status', `${p.name}: ${el.value}`); render(); } return; }
  if(ds.pmform && S.projects[S.projectOpen]){ const p = S.projects[S.projectOpen]; put('projects', p.id, {...p, form:{...(p.form||{}), [ds.pmform]: el.type==='checkbox' ? el.checked : el.value}}); render(); return; }
  if(ds.pmsec && S.projects[S.projectOpen]){ const p = S.projects[S.projectOpen]; const nm = el.value.trim(); if(!nm){ if(!topTasks(p.id).some(t=>t.section===ds.pmsec) && p.sections.length>1){ put('projects', p.id, {...p, sections:p.sections.filter(s=>s.id!==ds.pmsec)}); } render(); return; } put('projects', p.id, {...p, sections:p.sections.map(s=>s.id===ds.pmsec?{...s, name:nm}:s)}); return; }
  if(ds.pmup){ const f = el.files && el.files[0]; if(f) uploadFile(f, ds.pmup, ds.id); el.value = ''; return; }
  if(ds.pmreq){ S.reqProject = el.value; render(); return; }
  if(ds.pmrule){ const r = S.rules[ds.pmrule]; if(r) put('rules', r.id, {...r, active:el.checked}); return; }
  if(ds.pmdash){ S.dashOpen = el.value; render(); return; }
  if(ds.pmcap){ const m = S.team[ds.pmcap]; if(m) put('team', m.id, {...m, capacity:+el.value||0}); render(); return; }
  if(ds.rd && S.ruleDraft){ const d = S.ruleDraft; const k = ds.rd, v = el.value;
    if(k==='name') d.name = v; else if(k==='on'){ d.on = v; d.cond = {project:d.cond.project}; } else if(k==='project'){ d.cond.project = v; } else if(k==='to') d.cond.to = v; else if(k==='text') d.cond.text = v; else if(k==='days') d.cond.days = +v||0; else if(k==='ok') d.cond.ok = v;
    else if(k==='at'){ d.actions[+ds.i] = {type:v, v:['assign','add_assignee','notify','email'].includes(v)?'owner':v==='status'?'in_progress':v==='due'?'3':''}; } else if(k==='av') d.actions[+ds.i].v = v;
    render(); return; }
});
document.addEventListener('submit', ev => {
  const f = ev.target; const id = f.dataset && f.dataset.id;
  if(f.id==='pmProjForm'){ ev.preventDefault(); const v = {name:$('#pp-name').value.trim(), owner:$('#pp-owner').value, eng:$('#pp-eng').value, start:$('#pp-start').value, due:$('#pp-due').value, desc:$('#pp-desc').value};
    if(id){ const p = S.projects[id]; put('projects', id, {...p, ...v}); audit('Edited a project', v.name); $('#pmDlg').close(); render(); } else { const pid = newProject(v); $('#pmDlg').close(); openProject(pid, 'list'); } return; }
  if(f.id==='pmFieldForm'){ ev.preventDefault(); const p = S.projects[S.projectOpen]; if(!p) return; const fl = {id:'f'+uid().slice(0,6), name:$('#pf-name').value.trim(), type:$('#pf-type').value, options:$('#pf-opts').value.split('\n').map(x=>x.trim()).filter(Boolean)}; put('projects', p.id, {...p, fields:[...p.fields, fl]}); $('#pmDlg').close(); render(); return; }
  if(f.dataset && f.dataset.pmadd){ ev.preventDefault(); const inp = f.querySelector('input'); const tt = inp.value.trim(); if(!tt || !S.projectOpen) return; pmTask(S.projectOpen, tt, {section:f.dataset.pmadd, owner:''}); inp.value = ''; render(); setTimeout(()=>{ const n = document.getElementById(inp.id); if(n) n.focus(); }, 0); return; }
  if(f.id==='subForm'){ ev.preventDefault(); const t = S.tasks[id]; const tt = $('#sub-new').value.trim(); if(!t || !tt) return; createTask({title:tt, owner:$('#sub-owner').value, due:t.due, eng:t.eng, lane:t.lane, src:'subtask', extra:{project:t.project||'', section:t.section||'', parent:t.id, assignees:[], files:[], custom:{}}}); renderTask(); render(); setTimeout(()=>{ const n = $('#sub-new'); if(n) n.focus(); }, 0); return; }
  if(f.id==='reqForm'){ ev.preventDefault(); const p = S.projects[id]; if(!p) return; const nm = $('#rq-name').value.trim(); const tid = pmTask(p.id, $('#rq-title').value.trim(), {owner:'', due:$('#rq-due').value||addDays(today(),7), src:'form', more:{requester:nm, desc:$('#rq-desc').value}});
    const t = S.tasks[tid]; if($('#rq-desc').value.trim()) put('tasks', tid, {...t, comments:[{at:nowISO(), by:S.me||'', text:`Request details: ${$('#rq-desc').value.trim()}`, mentions:[]}]});
    if(p.owner) notify(p.owner, `New request for ${p.name} from ${nm||'someone'}: ${$('#rq-title').value.trim()}`, {task:tid}, {email:true}); toast('Request sent. The team has been notified.'); f.reset(); return; }
  if(f.id==='goalForm'){ ev.preventDefault(); const v = {title:$('#gl-title').value.trim(), owner:$('#gl-owner').value, parent:$('#gl-parent').value, start:$('#gl-start').value, due:$('#gl-due').value, mode:$('#gl-mode').value, startVal:+$('#gl-sv').value||0, target:+$('#gl-target').value||0, current:+$('#gl-cur').value||0, unit:$('#gl-unit').value, projects:[...f.querySelectorAll('[name=gl-p]:checked')].map(x=>x.value)};
    const gid = id || uid(); put('goals', gid, {...(S.goals[gid]||{checkins:[], created:nowISO()}), ...v}); audit(id?'Edited a goal':'Created a goal', v.title); $('#pmDlg').close(); render(); return; }
  if(f.id==='ciForm'){ ev.preventDefault(); const g = S.goals[id]; if(!g) return; const val = $('#ci-val') ? +$('#ci-val').value : null; put('goals', id, {...g, ...(g.link ? {fiosStatus:{on_track:'on-track',off_track:'off-track',at_risk:'off-track',done:'done'}[$('#ci-st').value]||'on-track'} : {}), current: val!=null ? val : g.current, checkins:[...(g.checkins||[]).slice(-29), {at:nowISO(), by:S.me||'', val, status:$('#ci-st').value, note:$('#ci-note').value}]}); $('#pmDlg').close(); toast('Check-in saved'); render(); return; }
  if(f.id==='updForm'){ ev.preventDefault(); postUpdate(id, $('#up-text').value, $('#up-st').value); $('#pmDlg').close(); render(); return; }
  if(f.id==='aiForm'){ ev.preventDefault(); S.ai.extra = S.ai.mode==='plan' ? {name:$('#ai-name').value.trim(), brief:$('#ai-brief').value.trim(), start:$('#ai-start').value||today(), due:$('#ai-due').value||addDays(today(),45)} : {q:$('#ai-q').value.trim()}; aiRun(S.ai.extra); return; }
  if(f.id==='aiApply'){ ev.preventDefault(); applyAiPlan(new Set([...f.querySelectorAll('[name=ai-t]:checked')].map(x=>x.value))); return; }
});
/* project list drag: rows and cards into sections */
document.addEventListener('dragstart', ev => { const el = ev.target.closest && ev.target.closest('[data-dragpm]'); if(el){ S.drag = {kind:'pmtask', id:el.dataset.id}; try{ ev.dataTransfer.setData('text/plain', el.dataset.id); }catch(_){} } });
const pmDropOk = z => S.drag && z && (S.drag.kind==='pmtask' || S.drag.kind==='task');
document.addEventListener('dragover', ev => { const z = ev.target.closest && ev.target.closest('[data-droppm]'); if(!pmDropOk(z)) return; ev.preventDefault(); z.classList.add('drop-hover'); });
document.addEventListener('dragleave', ev => { const z = ev.target.closest && ev.target.closest('[data-droppm]'); if(z && !z.contains(ev.relatedTarget)) z.classList.remove('drop-hover'); });
document.addEventListener('drop', ev => { const z = ev.target.closest && ev.target.closest('[data-droppm]'); if(!pmDropOk(z)) return; ev.preventDefault(); z.classList.remove('drop-hover'); const t = S.tasks[S.drag.id]; S.drag = null; if(!t || t.section===z.dataset.sec) return;
  put('tasks', t.id, {...t, section:z.dataset.sec}); subtasksOf(t.id).forEach(x=>put('tasks', x.id, {...x, section:z.dataset.sec}));
  const p = S.projects[t.project]; const sec = p && p.sections.find(s=>s.id===z.dataset.sec); if(sec && /done|complete/i.test(sec.name) && isOpen(t)) setTaskStatus(t.id, 'done'); render(); });
