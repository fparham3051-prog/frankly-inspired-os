/* ================= Projects: the project-management core ================= */
const P_STATUS = [['on_track','On track','var(--ok)'],['at_risk','At risk','var(--warn)'],['off_track','Off track','var(--bad)'],['on_hold','On hold','var(--muted)'],['done','Done','var(--navy)']];
const pStatus = k => P_STATUS.find(s=>s[0]===k) || P_STATUS[0];
const FIELD_TYPES = [['text','Text'],['number','Number'],['select','Choice list'],['date','Date'],['person','Person'],['checkbox','Checkbox']];
const projects = () => list('projects').filter(p=>!p.archived).sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999'));
const ptasks = pid => list('tasks').filter(t=>t.project===pid && !t.cancelled);
const topTasks = pid => ptasks(pid).filter(t=>!t.parent);
const subtasksOf = tid => list('tasks').filter(t=>t.parent===tid && !t.cancelled);
const isMine = t => t.owner===S.me || (t.assignees||[]).includes(S.me);
function pProgress(pid){ const ts = ptasks(pid); if(!ts.length) return 0; const w = t => Math.max(+t.est||1, 0.25); const tot = ts.reduce((a,t)=>a+w(t),0); return ts.filter(t=>!isOpen(t)).reduce((a,t)=>a+w(t),0)/tot; }
function pHealth(p){
  const ts = ptasks(p.id), d = today(); const late = ts.filter(t=>isOpen(t) && t.due && t.due < d).length; const blocked = ts.filter(t=>st(t)==='blocked').length;
  const prog = pProgress(p.id); let elapsed = null; if(p.start && p.due && p.due > p.start) elapsed = Math.max(0, Math.min(1, daysBetween(p.start, d)/daysBetween(p.start, p.due)));
  const behind = elapsed!=null && prog < elapsed - 0.2;
  const k = p.status==='done' ? 'done' : (p.due && p.due < d && prog < 1) || late >= 3 ? 'off_track' : late || blocked || behind ? 'at_risk' : 'on_track';
  return {k, late, blocked, prog, elapsed, behind};
}
const pChip = k => { const s = pStatus(k); return `<span class="st" style="color:${s[2]}">${esc(s[1])}</span>`; };
function newProject(f){
  const id = uid();
  put('projects', id, {name:f.name, owner:f.owner||S.me||'', eng:f.eng||'', start:f.start||today(), due:f.due||'', status:'on_track', desc:f.desc||'', color:f.color||PALETTE[Object.keys(S.projects).length % PALETTE.length],
    sections:[{id:'s1',name:'To do'},{id:'s2',name:'In progress'},{id:'s3',name:'Done'}], fields:[], files:[], updates:[], doc:'', form:{on:false, intro:''}, created:nowISO(), createdBy:S.me||''});
  audit('Created a project', f.name); return id;
}
function pmTask(pid, title, extra={}){
  const p = S.projects[pid]; const sec = extra.section || (p && p.sections[0] && p.sections[0].id) || '';
  return createTask({title, owner:extra.owner||'', due:extra.due||(p&&p.due)||addDays(today(),7), eng:(p&&p.eng)||'', lane:'franklin', est:extra.est||0, src:extra.src||'project',
    extra:{project:pid, section:sec, parent:extra.parent||'', start:extra.start||'', milestone:!!extra.milestone, assignees:extra.assignees||[], custom:{}, files:[], ...(extra.more||{})}});
}
function openProject(id, tab){ S.projectOpen = id; S.pTab = tab || S.pTab || 'list'; if(location.hash==='#project') render(); else location.hash = 'project'; }

/* ---------- portfolio (all projects) ---------- */
function viewProjects(){
  const ps = projects(); const d = today();
  const rows = ps.map(p => { const h = pHealth(p); const o = mem(p.owner); const ms = ptasks(p.id).filter(t=>t.milestone && isOpen(t)).sort((a,b)=>(a.due||'').localeCompare(b.due||''))[0]; const e = p.eng && S.engagements[p.eng];
    return `<tr class="trow" data-pm="open" data-id="${esc(p.id)}" style="cursor:pointer"><td><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${esc(p.color||'var(--navy)')};margin-right:6px"></span><b>${esc(p.name)}</b>${e?`<div class="small muted">${esc(e.org)}</div>`:''}</td>
      <td data-label="Status">${pChip(p.status||'on_track')}${h.k!==p.status && p.status!=='done' && h.k!=='on_track' ? `<div class="small" style="color:${pStatus(h.k)[2]}">Signals: ${esc(pStatus(h.k)[1].toLowerCase())}</div>`:''}</td>
      <td data-label="Owner">${o?av(o.id)+' <span class="small">'+esc(first(o.id))+'</span>':'<span class="muted small">No owner</span>'}</td>
      <td data-label="Progress" style="min-width:140px"><span class="meter" style="width:100px"><span style="width:${Math.round(h.prog*100)}%;background:var(--ok)"></span></span><span class="num small">${pct(h.prog)}</span></td>
      <td data-label="Dates" class="num small">${fmtDate(p.start)||'–'} → ${p.due?`<span class="${p.due<d&&h.prog<1?'due over':''}">${fmtDate(p.due)}</span>`:'–'}</td>
      <td data-label="Late" class="v">${h.late?`<span style="color:var(--bad)">${h.late}</span>`:'0'}</td>
      <td data-label="Next milestone" class="small">${ms?`◆ ${esc(ms.title)} · ${fmtDate(ms.due)}`:'<span class="muted">–</span>'}</td></tr>`; }).join('');
  const counts = P_STATUS.map(([k,l]) => [l, ps.filter(p=>(p.status||'on_track')===k).length]);
  return `<section class="spread"><div><p class="eyebrow">Portfolio</p><h1>Projects</h1><p class="muted" style="max-width:72ch">Every project with its health, owner, progress, dates, late work and next milestone. Health signals come from late tasks, blocks and progress against time elapsed.</p></div>
    <div class="row"><button class="btn" data-px="digest">Daily digest</button><button class="btn" data-pm="ai-new">✦ Plan a project with Claude</button><button class="btn" data-px="tpl-new">+ From template</button><button class="btn primary" data-pm="new">+ Project</button></div></section>
  <section class="kpis">${counts.map(([l,n])=>`<div class="kpi"><span class="v">${n}</span><span class="l">${esc(l)}</span></div>`).join('')}</section>
  <section class="panel"><div class="matrix-wrap"><table class="def resp"><thead><tr><th>Project</th><th>Status</th><th>Owner</th><th>Progress</th><th>Dates</th><th>Late</th><th>Next milestone</th></tr></thead><tbody>${rows || `<tr><td colspan="7"><div class="empty">No projects yet. Start one with “+ Project”, or let Claude draft the plan.</div></td></tr>`}</tbody></table></div></section>`;
}
function projectDialog(id){
  const p = id ? S.projects[id] : {name:'', owner:S.me||'', eng:'', start:today(), due:addDays(today(),30), desc:''};
  $('#pmBody').innerHTML = `<form id="pmProjForm" data-id="${esc(id||'')}" class="form"><h2 style="grid-column:1/-1">${id?'Edit project':'New project'}</h2>
    <label class="full">Name<input id="pp-name" required value="${esc(p.name)}"></label>
    <label>Owner<select id="pp-owner">${team().map(m=>`<option value="${m.id}" ${m.id===p.owner?'selected':''}>${esc(m.name)}</option>`).join('')}</select></label>
    <label>${esc(cap(LBL.entity))} (optional)<select id="pp-eng"><option value="">None</option>${list('engagements').filter(e=>!e.archived).map(e=>`<option value="${e.id}" ${e.id===p.eng?'selected':''}>${esc(e.org)}</option>`).join('')}</select></label>
    <label>Start<input id="pp-start" type="date" value="${esc(p.start||'')}"></label><label>Due<input id="pp-due" type="date" value="${esc(p.due||'')}"></label>
    <label class="full">What is this project for?<textarea id="pp-desc" placeholder="Goal, scope, what done looks like">${esc(p.desc||'')}</textarea></label>
    <div class="row" style="grid-column:1/-1;justify-content:space-between">${id?`<button type="button" class="btn ghost danger" data-pm="archive" data-id="${esc(id)}">Archive project</button>`:'<span></span>'}<span class="row"><button type="button" class="btn ghost" data-act="close-dlg" data-dlg="pmDlg">Cancel</button><button class="btn primary" type="submit">${id?'Save':'Create project'}</button></span></div></form>`;
  $('#pmDlg').showModal();
}

/* ---------- one project ---------- */
function viewProject(){
  const p = S.projects[S.projectOpen]; if(!p) return `<section><a href="#projects">← All projects</a><div class="empty" style="margin-top:12px">Pick a project.</div></section>`;
  const h = pHealth(p); const tabs = [['overview','Overview'],['list','List'],['board','Board'],['timeline','Timeline'],['table','Table'],['talk','Discussion'],['files','Files'],['form','Request form']];
  const here = (S.peers||[]).filter(x=>!x.sameTab && x.presence && x.presence.p===p.id && x.presence.m).map(x=>x.presence.m);
  const body = {overview:pOverview, list:pList, board:pBoard, timeline:pTimeline, table:pTable, files:pFiles, form:pFormSetup, talk:typeof pTalk==='function' ? pTalk : pList}[S.pTab] || pList;
  return `<section class="spread"><div><a href="#projects" class="small">← All projects</a><h1 style="margin-top:4px"><span style="display:inline-block;width:14px;height:14px;border-radius:4px;background:${esc(p.color||'var(--navy)')};margin-right:8px"></span>${esc(p.name)}</h1>
    <div class="row small" style="margin-top:4px">${pChip(p.status||'on_track')}<span class="muted">${pct(h.prog)} done · ${fmtDate(p.start)||'–'} → ${fmtDate(p.due)||'–'}</span>${p.owner?`<span>${av(p.owner)} ${esc(mname(p.owner))}</span>`:''}${here.length?`<span class="muted">Here now: ${[...new Set(here)].map(m=>av(m)).join('')}</span>`:''}</div></div>
    <div class="row"><button class="btn" data-pm="open-status" data-id="${esc(p.id)}">Client page</button><button class="btn" data-pm="edit" data-id="${esc(p.id)}">Edit</button><button class="btn primary" data-pm="add-task" data-id="${esc(p.id)}">+ Task</button></div></section>
    <div class="seg" role="group" aria-label="Project views">${tabs.map(([k,l])=>`<button data-pm="ptab" data-v="${k}" aria-pressed="${S.pTab===k}">${l}</button>`).join('')}</div>
    ${body(p)}`;
}
function taskRowPm(t, depth){
  const subs = subtasksOf(t.id); const s = st(t); const waits = openDeps(t).length; const ap = t.approval && t.approval.state==='pending';
  return `<div class="prow" style="padding-left:${10+depth*24}px" data-dragpm="task" data-id="${esc(t.id)}" draggable="true">
    <input type="checkbox" id="pc-${esc(t.id)}" data-pmdone="${esc(t.id)}" ${s==='done'?'checked':''} aria-label="Mark done">
    <span class="ptitle ${s==='done'?'done':''}" data-act="task" data-id="${esc(t.id)}" role="button" tabindex="0">${t.milestone?'◆ ':''}${esc(t.title)}${t.eng && S.engagements[t.eng] && !(S.projects[t.project]||{}).eng ? ` <span class="small muted">· ${esc(S.engagements[t.eng].org)}</span>` : ''}</span>
    <span class="pmeta">${subs.length?`<span class="small muted">☑ ${subs.filter(x=>!isOpen(x)).length}/${subs.length}</span>`:''}${waits?'<span class="small" style="color:var(--warn)">⏳</span>':''}${ap?'<span class="flag" style="margin:0">Approval</span>':''}${(t.files||[]).length?`<span class="small muted">📎${t.files.length}</span>`:''}
      ${stPill(s)}<span class="row" style="gap:2px">${av(t.owner)}${(t.assignees||[]).filter(a=>a!==t.owner).slice(0,3).map(a=>av(a)).join('')}</span><span class="due ${lateCls(t)}" style="min-width:56px;text-align:right">${t.due?fmtDate(t.due):''}</span></span></div>
    ${subs.sort((a,b)=>(a.created||'').localeCompare(b.created||'')).map(x=>taskRowPm(x, depth+1)).join('')}`;
}
function pList(p){
  return p.sections.map(sec => { const ts = topTasks(p.id).filter(t=>(t.section||p.sections[0].id)===sec.id).sort((a,b)=>(isOpen(b)-isOpen(a)) || (a.due||'9').localeCompare(b.due||'9'));
    return `<section class="panel psec" data-droppm="section" data-sec="${esc(sec.id)}" style="padding:10px 0"><div class="spread" style="padding:0 12px 6px"><input class="secname" id="sn-${esc(sec.id)}" data-pmsec="${esc(sec.id)}" value="${esc(sec.name)}" aria-label="Section name"><span class="small muted">${ts.filter(isOpen).length} open</span></div>
      ${ts.map(t=>taskRowPm(t,0)).join('') || '<div class="small muted" style="padding:4px 12px">No tasks.</div>'}
      <form class="row pmadd" data-pmadd="${esc(sec.id)}" style="padding:6px 12px 0"><input placeholder="Add a task to ${esc(sec.name)}…" id="pa-${esc(sec.id)}" style="flex:1;min-width:0;border:1px dashed var(--line);border-radius:8px;padding:6px 10px;background:transparent"><button class="btn sm" type="submit">Add</button></form></section>`; }).join('') +
    `<div class="row"><button class="btn sm" data-pm="add-section">+ Section</button><button class="btn sm" data-pm="ai-break" data-id="${esc(p.id)}">✦ Suggest tasks with Claude</button></div>`;
}
function pBoard(p){
  return `<section class="lanes-board">${p.sections.map(sec => { const ts = topTasks(p.id).filter(t=>(t.section||p.sections[0].id)===sec.id);
    return `<div class="pcol" data-droppm="section" data-sec="${esc(sec.id)}"><div class="pcol-h"><b>${esc(sec.name)}</b><span class="meta">${ts.filter(isOpen).length} open</span></div>${ts.sort((a,b)=>(isOpen(b)-isOpen(a))||(a.due||'9').localeCompare(b.due||'9')).map(t=>tcard(t,{showEng:!p.eng})).join('') || '<div class="empty small">Drop tasks here.</div>'}</div>`; }).join('')}</section>`;
}
function ganttRange(ts, p){ const ds = ts.flatMap(t=>[t.start||t.due, t.due]).concat([p.start, p.due, today()]).filter(Boolean).sort(); return {a:addDays(ds[0]||today(),-3), b:addDays(ds[ds.length-1]||today(),7)}; }
function criticalPath(ts){
  const by = Object.fromEntries(ts.map(t=>[t.id,t])); const memo = {};
  const dur = t => Math.max(1, t.start && t.due ? daysBetween(t.start, t.due)+1 : 1);
  const ef = (t, seen=new Set()) => { if(memo[t.id]) return memo[t.id]; if(seen.has(t.id)) return {v:dur(t), prev:null}; seen.add(t.id); let best = {v:0, prev:null}; (t.needs||[]).map(i=>by[i]).filter(Boolean).forEach(d => { const r = ef(d, seen); if(r.v > best.v) best = {v:r.v, prev:d.id}; }); return memo[t.id] = {v:best.v + dur(t), prev:best.prev}; };
  let end = null, mx = 0; ts.forEach(t => { const r = ef(t); if(r.v > mx){ mx = r.v; end = t.id; } });
  const path = new Set(); let cur = end; while(cur){ path.add(cur); cur = memo[cur] && memo[cur].prev; }
  return ts.some(t=>(t.needs||[]).length) ? path : new Set();
}
const G_ZOOM = {day:{l:'Days', dw:26, ndw:22}, week:{l:'Weeks', dw:10, ndw:10}, month:{l:'Months', dw:4, ndw:4}};
function gZoom(){ let z = S.gZoom; if(!z){ try{ z = localStorage.getItem('fii-gzoom'); }catch(_){} } if(!G_ZOOM[z]) z = (window.innerWidth||1200) < 700 ? 'week' : 'day'; return z; }
function pTimeline(p){
  const ts = ptasks(p.id).filter(t=>t.due).sort((a,b)=>(a.start||a.due).localeCompare(b.start||b.due)); if(!ts.length) return `<div class="empty">Give tasks due dates (and start dates) to see them on the timeline.</div>`;
  const {a, b} = ganttRange(ts, p); const days = daysBetween(a, b)+1; const narrow = (window.innerWidth||1200) < 700; const z = gZoom(); const DW = narrow ? G_ZOOM[z].ndw : G_ZOOM[z].dw, RH = narrow ? 38 : 34, LW = narrow ? 118 : 230; const W = days*DW;
  const x = d => daysBetween(a, d)*DW; const idx = Object.fromEntries(ts.map((t,i)=>[t.id,i])); const crit = criticalPath(ts); const minW = Math.max(8, Math.min(DW-4, 22));
  const head = [...Array(days)].map((_,i)=>{ const d = addDays(a,i); const dt = new Date(d+'T12:00:00'); const wk = dt.getDay(); const md = dt.getDate();
    const lab = z==='month' ? (md===1 || i===0 ? dt.toLocaleDateString('en-US',{month:'short'}) + (dt.getMonth()===0||i===0?` ’${String(dt.getFullYear()).slice(2)}`:'') : '') : z==='week' ? (wk===1 || i===0 ? dt.toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '') : (md===1||i===0||wk===1 ? dt.toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '');
    const line = z==='month' ? md===1 : z==='week' ? wk===1 : true;
    return `<div class="gday ${z==='day'&&(wk===0||wk===6)?'we':''} ${line?'':'nol'}" style="left:${i*DW}px;width:${DW}px">${lab?`<span>${lab}</span>`:''}</div>`; }).join('');
  const labels = ts.map((t,i) => `<div class="glabel" style="top:${40+i*RH}px;height:${RH-8}px;line-height:${RH-8}px;width:${LW-12}px" data-act="task" data-id="${esc(t.id)}" role="button" tabindex="0" title="${esc(t.title)}">${t.parent?'↳ ':''}${t.milestone?'◆ ':''}${esc(t.title)}</div>`).join('');
  const bars = ts.map((t,i) => { const s0 = t.start && t.start<=t.due ? t.start : t.due; const l = x(s0), w = Math.max(minW, (daysBetween(s0, t.due)+1)*DW-(DW>8?4:1)); const o = mem(t.owner); const y = 40 + i*RH;
    if(t.milestone) return baseBar(p, t, x, DW, y) + `<div class="gms" tabindex="0" role="button" aria-label="Milestone ${esc(t.title)}, ${fmtDate(t.due)}. Arrow keys move it a day." data-gid="${esc(t.id)}" data-gmode="move" style="left:${x(t.due)+DW/2-9}px;top:${y+6}px" title="${esc(t.title)} · ${fmtDate(t.due)}"></div>`;
    return baseBar(p, t, x, DW, y) + `<div tabindex="0" role="button" aria-label="${esc(t.title)}, ${fmtDate(s0)} to ${fmtDate(t.due)}. Arrow keys move it a day; Shift with arrows changes the due date." class="gbar ${isOpen(t)?'':'gdone'} ${crit.has(t.id)?'gcrit':''}" data-gid="${esc(t.id)}" data-gmode="move" style="left:${l}px;top:${y+5}px;width:${w}px;background:${o?esc(o.color):'var(--muted)'}" title="${esc(t.title)}: ${fmtDate(s0)} → ${fmtDate(t.due)}${crit.has(t.id)?' · on the critical path':''}"><span>${esc(o&&w>40?first(t.owner):'')}</span><i data-gid="${esc(t.id)}" data-gmode="resize"></i></div>`; }).join('');
  const arrows = ts.flatMap(t => (t.needs||[]).filter(d=>idx[d]!=null).map(d => { const dt = S.tasks[d]; const x1 = x(dt.due)+DW-(DW>8?4:1), y1 = 40+idx[d]*RH+RH/2-2, s0 = t.start && t.start<=t.due ? t.start : t.due, x2 = x(s0), y2 = 40+idx[t.id]*RH+RH/2-2; const mx = Math.max(x1+6, x2-6);
    return `<path d="M${x1} ${y1} H${mx} V${y2} H${x2-2}" fill="none" stroke="${crit.has(t.id)&&crit.has(d)?'var(--bad)':'var(--muted)'}" stroke-width="1.5" marker-end="url(#ah)"/>`; })).join('');
  const H = 40 + ts.length*RH + 10;
  return `<section class="panel" style="padding:0"><div class="spread" style="padding:10px 14px"><div class="seg" role="group" aria-label="Timeline scale">${Object.entries(G_ZOOM).map(([k,v])=>`<button data-pm="gzoom" data-v="${k}" aria-pressed="${k===z}">${v.l}</button>`).join('')}</div><button class="btn sm" data-pm="gtoday">Today</button></div>
    <div class="gsplit" style="grid-template-columns:${LW}px minmax(0,1fr)"><div class="glabels" style="height:${H}px">${labels}</div>
    <div class="gwrap"><div class="gantt" id="gantt" style="width:${W}px;height:${H}px" data-a="${a}" data-dw="${DW}">${head}<div class="gtoday" style="left:${x(today())+DW/2}px;height:${H}px"></div>
    <svg width="${W}" height="${H}" style="position:absolute;inset:0;pointer-events:none"><defs><marker id="ah" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="var(--muted)"/></marker></defs>${arrows}</svg>${bars}<div class="gtip" id="gtip" hidden></div></div></div></div>
    <div class="row" style="padding:10px 14px 0">${baselineControls(p)}</div><p class="small muted" style="padding:10px 14px">${narrow?'Press and hold a bar, then slide to move it; hold its right edge to change the due date. Swipe anywhere else to scroll.':'Drag a bar (or focus it and use the arrow keys) to move it, or drag its right edge to change the due date.'} Arrows show “waits for”. ${p.autoShift===false?'Tasks that wait on a moved task stay put.':'When a task slips, the tasks that wait on it move later too.'} ${p.baseline?'Grey lines under the bars are the saved baseline.':''} ${crit.size?'Red outlines mark the critical path: the longest chain of dependent work, so any slip there moves the finish date.':'Add “waits for” links between tasks to see the critical path.'}</p></section>`;
}
function fieldInput(f, t){
  const v = (t.custom||{})[f.id]; const a = `aria-label="${esc(f.name)}" data-pmt="custom:${esc(f.id)}" data-id="${esc(t.id)}" id="cf-${esc(t.id)}-${esc(f.id)}"`;
  if(f.type==='select') return `<select ${a}><option value=""></option>${(f.options||[]).map(o=>`<option ${o===v?'selected':''}>${esc(o)}</option>`).join('')}</select>`;
  if(f.type==='person') return `<select ${a}><option value=""></option>${team().map(m=>`<option value="${m.id}" ${m.id===v?'selected':''}>${esc(m.name)}</option>`).join('')}</select>`;
  if(f.type==='checkbox') return `<input type="checkbox" ${a} ${v?'checked':''}>`;
  return `<input ${a} type="${f.type==='number'?'number':f.type==='date'?'date':'text'}" value="${esc(v==null?'':v)}">`;
}
function pTable(p){
  const ts = ptasks(p.id).sort((a,b)=>(a.parent?1:0)-(b.parent?1:0) || (a.due||'9').localeCompare(b.due||'9'));
  const opt = (sel, items) => items.map(([v,l])=>`<option value="${esc(v)}" ${v===sel?'selected':''}>${esc(l)}</option>`).join('');
  return `<section class="panel"><div class="spread" style="margin-bottom:8px"><span class="small muted">Edit any cell. Changes save as you leave the cell.</span><div class="row"><button class="btn sm" data-pm="add-field">+ Field</button><button class="btn sm" data-pm="export-proj">Export CSV</button></div></div>
    <div class="matrix-wrap"><table class="def ptable"><thead><tr><th>Task</th><th>Section</th><th>Owner</th><th>Status</th><th>Start</th><th>Due</th><th>Planned h</th><th>Logged</th>${p.fields.map(f=>`<th>${esc(f.name)} <button class="btn sm ghost" data-pm="del-field" data-f="${esc(f.id)}" aria-label="Remove field ${esc(f.name)}" style="padding:0 4px">✕</button></th>`).join('')}</tr></thead><tbody>
    ${ts.map(t=>`<tr><td><input aria-label="Task name" data-pmt="title" data-id="${esc(t.id)}" id="tt-${esc(t.id)}" value="${esc(t.title)}" style="min-width:220px;${t.parent?'padding-left:18px':''}"></td>
      <td><select aria-label="Section for ${esc(t.title)}" data-pmt="section" data-id="${esc(t.id)}" id="ts-${esc(t.id)}">${opt(t.section, p.sections.map(s=>[s.id,s.name]))}</select></td>
      <td><select aria-label="Owner for ${esc(t.title)}" data-pmt="owner" data-id="${esc(t.id)}" id="to-${esc(t.id)}"><option value="">Queue</option>${opt(t.owner, team().map(m=>[m.id,m.name]))}</select></td>
      <td><select aria-label="Status for ${esc(t.title)}" data-pmt="status" data-id="${esc(t.id)}" id="tst-${esc(t.id)}">${opt(st(t), STATUSES.map(s=>[s.id,s.name]))}</select></td>
      <td><input type="date" aria-label="Start date for ${esc(t.title)}" data-pmt="start" data-id="${esc(t.id)}" id="tsd-${esc(t.id)}" value="${esc(t.start||'')}"></td>
      <td><input type="date" aria-label="Due date for ${esc(t.title)}" data-pmt="due" data-id="${esc(t.id)}" id="tdd-${esc(t.id)}" value="${esc(t.due||'')}"></td>
      <td><input type="number" step="0.25" min="0" aria-label="Planned hours for ${esc(t.title)}" data-pmt="est" data-id="${esc(t.id)}" id="te-${esc(t.id)}" value="${+t.est||''}" style="width:70px"></td>
      <td class="v">${loggedMin(t)?fmtH(hrs(t)):'–'}</td>${p.fields.map(f=>`<td>${fieldInput(f,t)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${8+p.fields.length}" class="muted">No tasks yet.</td></tr>`}
    </tbody></table></div></section>`;
}
function fieldDialog(){
  $('#pmBody').innerHTML = `<form id="pmFieldForm" class="form"><h2 style="grid-column:1/-1">New custom field</h2><label>Name<input id="pf-name" required placeholder="Priority"></label><label>Type<select id="pf-type">${FIELD_TYPES.map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select></label>
    <label class="full">Choices (for a choice list, one per line)<textarea id="pf-opts" placeholder="High&#10;Medium&#10;Low"></textarea></label>
    <div class="row" style="grid-column:1/-1;justify-content:flex-end"><button type="button" class="btn ghost" data-act="close-dlg" data-dlg="pmDlg">Cancel</button><button class="btn primary" type="submit">Add field</button></div></form>`; $('#pmDlg').showModal();
}
function pFiles(p){
  const tf = ptasks(p.id).flatMap(t => (t.files||[]).map(f => ({...f, task:t})));
  return `<section class="panel" style="display:grid;gap:10px"><div class="spread"><h2>Files</h2>${ASSETS?`<label class="btn primary" for="pfile-up">Upload to project</label><input id="pfile-up" type="file" hidden data-pmup="project" data-id="${esc(p.id)}">`:'<span class="small muted">Uploads need Editor access to the hub.</span>'}</div>
    ${[...(p.files||[]).map(f=>({...f})), ...tf].map(f=>`<div class="row" style="justify-content:space-between;border-bottom:1px solid var(--line);padding:6px 0"><span>📎 <a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.name)}</a> <span class="small muted">${f.size?Math.round(f.size/1024)+' KB':''}${f.task?` · on “${esc(f.task.title)}”`:''} · ${esc(mname(f.by))} · ${fmtDate((f.at||'').slice(0,10))}</span></span></div>`).join('') || '<div class="empty">No files yet. Attach files to tasks, or upload here.</div>'}</section>`;
}
function pOverview(p){
  const h = pHealth(p); const ms = ptasks(p.id).filter(t=>t.milestone).sort((a,b)=>(a.due||'').localeCompare(b.due||'')); const ups = (p.updates||[]).slice().reverse();
  return `<section class="two"><div style="display:grid;gap:16px;align-content:start">
    <div class="panel" style="display:grid;gap:10px"><div class="spread"><h2>Status</h2><select id="ps-status" data-pmp="status" aria-label="Project status">${P_STATUS.map(([k,l])=>`<option value="${k}" ${k===(p.status||'on_track')?'selected':''}>${l}</option>`).join('')}</select></div>
      <div class="row small"><span>${pct(h.prog)} done</span>${h.elapsed!=null?`<span class="muted">${pct(h.elapsed)} of time used</span>`:''}<span style="color:${h.late?'var(--bad)':'inherit'}">${h.late} late</span><span>${h.blocked} blocked</span></div>
      ${h.k!=='on_track' && p.status!=='done' ? `<div class="prompt">Signals say <b>${esc(pStatus(h.k)[1].toLowerCase())}</b>${h.behind?': progress trails the calendar':''}${h.late?`: ${h.late} task${h.late>1?'s are':' is'} late`:''}.</div>`:''}
      ${slipBlock(p)}
      <div class="row"><button class="btn sm" data-pm="ai-status" data-id="${esc(p.id)}">✦ Draft a status update</button><button class="btn sm" data-pm="post-update" data-id="${esc(p.id)}">Post an update</button><button class="btn sm" data-px="tpl-save" data-id="${esc(p.id)}">Save as template</button><button class="btn sm" data-px="dup" data-id="${esc(p.id)}">Duplicate</button></div></div>
    <div class="panel"><h2 style="margin-bottom:8px">Milestones</h2>${ms.map(t=>`<div class="row" style="justify-content:space-between;padding:4px 0"><span data-act="task" data-id="${esc(t.id)}" role="button" tabindex="0">◆ ${esc(t.title)}</span><span class="due ${lateCls(t)}">${isOpen(t)?fmtDate(t.due):'Done'}</span></div>`).join('') || '<div class="small muted">Mark key tasks as milestones in the task dialog.</div>'}</div>
    <div class="panel"><h2 style="margin-bottom:8px">Updates</h2>${ups.map(u=>`<div class="small" style="border-bottom:1px solid var(--line);padding:6px 0">${pChip(u.status)} <b>${esc(mname(u.by))}</b> <span class="muted">${fmtWhen(u.at)}</span><div style="white-space:pre-wrap;margin-top:4px">${esc(u.text)}</div></div>`).join('') || '<div class="small muted">No updates yet.</div>'}</div></div>
    <div class="panel" style="display:grid;gap:8px;align-content:start"><div class="spread"><h2>Project brief and notes</h2><span class="small muted">${p.docBy?`Last edited by ${esc(first(p.docBy))} ${fmtWhen(p.docAt)}`:''}</span></div>
      <textarea id="pdoc" data-pmp="doc" style="min-height:420px;border:1px solid var(--line);border-radius:8px;padding:12px;background:var(--bg);line-height:1.55;font:14px/1.55 var(--f-body)" placeholder="Goals, scope, decisions, links, meeting notes…">${esc(p.doc || p.desc || '')}</textarea>
      <p class="small muted">Saves when you click away. Everyone on the project can edit.</p></div></section>`;
}
function pFormSetup(p){
  const f = p.form || {on:false, intro:''};
  return `<section class="two"><div class="panel form"><h2 style="grid-column:1/-1">Request form</h2>
    <label class="switch full" style="grid-column:1/-1"><input type="checkbox" id="pf-on" data-pmform="on" ${f.on?'checked':''}>Accept requests into this project</label>
    <label class="full">Intro shown on the form<textarea id="pf-intro" data-pmform="intro" placeholder="What can people ask for, and how fast will you respond?">${esc(f.intro||'')}</textarea></label>
    <p class="small muted" style="grid-column:1/-1">Requests land in “${esc(p.sections[0].name)}” unassigned, and the project owner gets an alert. Anyone with access to the hub can open the form from Projects → Requests.</p></div>
    <div class="panel"><h2 style="margin-bottom:8px">Recent requests</h2>${ptasks(p.id).filter(t=>t.src==='form').slice(-10).reverse().map(t=>`<div class="small" style="padding:4px 0;border-bottom:1px solid var(--line)"><span data-act="task" data-id="${esc(t.id)}" role="button" tabindex="0">${esc(t.title)}</span> <span class="muted">from ${esc(t.requester||'someone')} · ${fmtDate((t.created||'').slice(0,10))}</span></div>`).join('') || '<div class="small muted">None yet.</div>'}</div></section>`;
}
function viewRequest(){
  const ps = projects().filter(p=>p.form && p.form.on); const pid = S.reqProject && ps.some(p=>p.id===S.reqProject) ? S.reqProject : (ps[0]||{}).id; const p = pid && S.projects[pid];
  return `<section><p class="eyebrow">Requests</p><h1>Ask the team for something</h1></section>
    ${ps.length ? `<section class="panel form" style="max-width:720px"><label class="full">Which team or project?<select id="rq-proj" data-pmreq="proj">${ps.map(x=>`<option value="${x.id}" ${x.id===pid?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label>
      ${p && p.form.intro ? `<p class="full small" style="grid-column:1/-1;white-space:pre-wrap">${esc(p.form.intro)}</p>`:''}
      <form id="reqForm" data-id="${esc(pid)}" class="form" style="grid-column:1/-1"><label class="full">What do you need?<input id="rq-title" required></label><label class="full">Details<textarea id="rq-desc"></textarea></label>
      <label>Needed by<input id="rq-due" type="date"></label><label>Your name<input id="rq-name" value="${esc(S.me?mname(S.me):'')}"></label>
      <div class="row" style="grid-column:1/-1;justify-content:flex-end"><button class="btn primary" type="submit">Send request</button></div></form></section>` : '<div class="empty">No project accepts requests yet. Turn on a request form from a project’s “Request form” tab.</div>'}`;
}

/* ---------- workload ---------- */
function workloadData(weeks=6){
  const base = new Date(today()+'T12:00:00'); base.setDate(base.getDate() - ((base.getDay()+6)%7)); const ws = [...Array(weeks)].map((_,i)=>{ const d = new Date(base); d.setDate(base.getDate()+i*7); return iso(d); });
  const grid = {}; team().forEach(m => grid[m.id] = ws.map(()=>({h:0, tasks:[]})));
  list('tasks').filter(t=>isOpen(t) && t.due).forEach(t => {
    const rem = Math.max(0, (+t.est||0) - hrs(t)); if(!rem) return; const people = [t.owner, ...(t.assignees||[])].filter((v,i,a)=>v && a.indexOf(v)===i && grid[v]); if(!people.length) return;
    let s = t.start && t.start<=t.due ? t.start : t.due; if(s < today()) s = today(); const e = t.due < s ? s : t.due;
    const bdays = []; for(let d=s; d<=e; d=addDays(d,1)){ const w = dow(d); if(w!==0 && w!==6) bdays.push(d); if(bdays.length>120) break; } if(!bdays.length) bdays.push(e);
    const per = rem / bdays.length / people.length;
    bdays.forEach(d => { const wi = ws.findIndex(w => d >= w && d < addDays(w,7)); if(wi<0) return; people.forEach(pp => { const c = grid[pp][wi]; c.h += per; if(!c.tasks.includes(t)) c.tasks.push(t); }); });
  });
  return {ws, grid};
}
function viewWorkload(){
  const {ws, grid} = workloadData(6); const sel = S.wlCell;
  const rows = team().map(m => { const capH = +m.capacity||0; return `<tr><td>${av(m.id)} <b>${esc(m.name)}</b><div class="small muted"><input type="number" min="0" max="80" id="cap-${esc(m.id)}" data-pmcap="${esc(m.id)}" value="${capH||''}" placeholder="h" style="width:52px" aria-label="${esc(m.name)} hours per week"> h/week</div></td>${grid[m.id].map((c,i)=>{ const r = capH ? c.h/capH : null; const col = r==null ? 'var(--line)' : r>1.1 ? 'var(--bad)' : r>0.85 ? 'var(--warn)' : 'var(--ok)';
    return `<td class="wcell" role="button" tabindex="0" aria-label="${esc(m.name)}, week of ${fmtDate(ws[i])}: ${fmtH(c.h)} planned" data-pm="wl" data-m="${esc(m.id)}" data-w="${i}" style="cursor:pointer;${sel&&sel.m===m.id&&sel.w===i?'outline:2px solid var(--accent);':''}"><div class="wbar"><span style="height:${Math.min(100,(r||0)*100)}%;background:${col}"></span></div><span class="num small">${fmtH(c.h)}${capH?` / ${capH}h`:''}</span></td>`; }).join('')}</tr>`; }).join('');
  const cell = sel && grid[sel.m] && grid[sel.m][sel.w];
  return `<section class="spread"><div><p class="eyebrow">Capacity</p><h1>Workload</h1><p class="muted" style="max-width:72ch">Remaining planned hours per person per week, spread across each task’s working days from start to due. Red means over capacity.</p></div></section>
  <section class="panel"><div class="matrix-wrap"><table class="def wtable"><thead><tr><th>Person</th>${ws.map(w=>`<th>Week of ${fmtDate(w)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
  <p class="small muted" style="margin-top:8px">Only tasks with planned hours and a due date count. Click a cell to see what’s in it.</p></section>
  ${cell ? `<section class="panel"><h2 style="margin-bottom:8px">${esc(mname(sel.m))} · week of ${fmtDate(ws[sel.w])}</h2><div class="tasks">${cell.tasks.map(t=>tcard(t)).join('') || '<div class="empty">Nothing planned.</div>'}</div></section>` : ''}`;
}

/* ---------- Gantt drag ---------- */
let gDrag = null, gHold = null;
function gStart(ev, el){
  const t = S.tasks[el.dataset.gid]; if(!t) return; const bar = el.closest('.gbar,.gms') || el;
  gDrag = {id:t.id, mode:ev.target.dataset.gmode||el.dataset.gmode, x0:ev.clientX, bar, left:parseFloat(bar.style.left), width:parseFloat(bar.style.width||0), dw:+$('#gantt').dataset.dw, start:t.start&&t.start<=t.due?t.start:t.due, due:t.due, moved:false, touch:ev.pointerType==='touch'};
  try{ bar.setPointerCapture(ev.pointerId); }catch(_){} bar.classList.add('glift');
}
function gTip(){ const tip = $('#gtip'); if(!tip || !gDrag) return; const g = gDrag; const dd = g.dd||0;
  const s1 = g.mode==='resize' ? g.start : addDays(g.start, dd), d1 = g.mode==='resize' ? (addDays(g.due, dd) < g.start ? g.start : addDays(g.due, dd)) : addDays(g.due, dd);
  tip.hidden = false; tip.textContent = (S.tasks[g.id]&&S.tasks[g.id].milestone ? fmtDate(d1) : `${fmtDate(s1)} → ${fmtDate(d1)}`) + (dd ? ` (${dd>0?'+':''}${dd}d)` : '');
  tip.style.left = Math.max(0, parseFloat(g.bar.style.left))+'px'; tip.style.top = (parseFloat(g.bar.style.top)-26)+'px'; }
document.addEventListener('pointerdown', ev => { const el = ev.target.closest && ev.target.closest('[data-gid]'); if(!el || !$('#gantt')) return; if(!S.tasks[el.dataset.gid]) return;
  if(ev.pointerType==='touch'){ const x0 = ev.clientX, y0 = ev.clientY; clearTimeout(gHold && gHold.timer); gHold = {el, x0, y0, id:el.dataset.gid, fired:false, timer:setTimeout(() => { gHold.fired = true; gStart({clientX:x0, pointerType:'touch', pointerId:ev.pointerId, target:ev.target}, el); try{ navigator.vibrate && navigator.vibrate(12); }catch(_){} gTip(); }, 280)}; return; }
  ev.preventDefault(); gStart(ev, el); });
document.addEventListener('pointermove', ev => {
  if(gHold && !gHold.fired && (Math.abs(ev.clientX-gHold.x0)>8 || Math.abs(ev.clientY-gHold.y0)>8)){ clearTimeout(gHold.timer); gHold = null; }
  if(!gDrag) return; const dd = Math.round((ev.clientX-gDrag.x0)/gDrag.dw); if(dd) gDrag.moved = true; gDrag.dd = dd;
  if(gDrag.mode==='resize') gDrag.bar.style.width = Math.max(8, gDrag.width + dd*gDrag.dw)+'px'; else gDrag.bar.style.left = (gDrag.left + dd*gDrag.dw)+'px';
  gTip(); const w = gDrag.bar.closest('.gwrap'); if(w){ const r = w.getBoundingClientRect(); if(ev.clientX > r.right-30) w.scrollLeft += 12; else if(ev.clientX < r.left+30) w.scrollLeft -= 12; } });
document.addEventListener('touchmove', ev => { if(gDrag || (gHold && gHold.fired)) ev.preventDefault(); }, {passive:false});
document.addEventListener('pointercancel', () => { if(gHold && !gHold.fired){ clearTimeout(gHold.timer); gHold = null; } if(gDrag){ gDrag.bar.classList.remove('glift'); gDrag = null; render(); } });
document.addEventListener('pointerup', () => {
  if(gHold && !gHold.fired){ clearTimeout(gHold.timer); const id = gHold.id; gHold = null; openTask(id); return; } gHold = null;
  if(!gDrag) return; const g = gDrag; gDrag = null; g.bar.classList.remove('glift'); const tip = $('#gtip'); if(tip) tip.hidden = true;
  if(!g.moved || !g.dd){ if(!g.moved && !g.touch) openTask(g.id); return; } const t = S.tasks[g.id]; if(!t) return;
  if(g.mode==='resize'){ const nd = addDays(g.due, g.dd); put('tasks', t.id, {...t, due: nd < g.start ? g.start : nd, start:g.start}); }
  else put('tasks', t.id, {...t, start: t.milestone ? '' : addDays(g.start, g.dd), due:addDays(g.due, g.dd)});
  const nt = S.tasks[t.id]; if(nt.owner && nt.owner!==S.me) notify(nt.owner, `Dates moved on “${nt.title}”: due ${fmtDate(nt.due)}`, {task:t.id}); afterDates(t.id); render(); });
