/* ---------- render ---------- */
function render(){
  pendingRender = false;
  const dc = drafts().length;
  const cc = S.canCoach ? team().filter(m=>m.id!==S.me && signals(m.id).sup.length).length : 0;
  const ac = myAlerts().filter(n=>!n.read).length;
  const counts = {today:ac, outbox:dc, coaching:cc};
  const groups = [{name:'My day', v:[['today','My day']]},{name:cap(LBL.entities), v:[['pipeline','Pipeline'],['revenue','Revenue'],['outbox','Outbox']]},{name:'Projects', v:[['projects','Portfolio'],['workload','Workload'],['goals','Goals'],['dashboards','Dashboards'],['automations','Rules'],['request','Requests'],['clientview','Client status']]},{name:'Work', v:[['board','Team board'],['calendar','Calendar']]},{name:'People', v:[['coaching','Coaching'],['team','Team']]},{name:'Insights', v:[['insights','Work insights'],['benchmarks','Benchmarks'],['health','Product health']]},{name:'Setup', v:[['setup','Workspace'],['playbooks','Playbooks'],['privacy','Privacy & data'],['usability','Usability tests']]}];
  if(window.FLOWHUB_HOST==='fios'){ groups.splice(groups.findIndex(x=>x.v.some(y=>y[0]==='pipeline')),1); groups.forEach(x=>{ x.v = x.v.filter(y=>y[0]!=='playbooks'); }); }
  const gv = S.view==='project' ? 'projects' : S.view; const g = groups.find(x=>x.v.some(y=>y[0]===gv)) || groups[0];
  $('#tabs').innerHTML = groups.map(x => { const n = x.v.reduce((a,y)=>a+(counts[y[0]]||0),0); return `<a href="#${x.v[0][0]}" aria-current="${x===g?'page':'false'}">${esc(x.name)}${n?` <span class="badge">${n}</span>`:''}</a>`; }).join('');
  $('#subnav').innerHTML = g.v.length>1 ? `<div class="seg" role="group" aria-label="${esc(g.name)} views">${g.v.map(([id,l])=>`<a href="#${id}" ${S.view===id?'aria-current="page"':''} class="segl">${esc(l)}${counts[id]?` <span class="badge">${counts[id]}</span>`:''}</a>`).join('')}</div>` : '';
  const v = {today:viewToday, health:viewHealth, setup:viewSetup, privacy:viewPrivacy, revenue:viewRevenue, insights:viewInsights, coaching:viewCoaching, board:viewBoard, calendar:viewCalendar, pipeline:viewPipeline, outbox:viewOutbox, playbooks:viewRecipes, team:viewTeam, projects:viewProjects, project:viewProject, workload:viewWorkload, goals:viewGoals, dashboards:viewDashboards, automations:viewAutomations, request:viewRequest, clientview:viewClientStatus, benchmarks:viewBenchmarks, usability:viewUsability}[S.view] || viewToday;
  $('#main').innerHTML = v();
  if(S.drawer) renderDrawer();
  if(S.taskOpen && $('#taskDlg').open && !typing()) renderTask();
  if(typeof sharePresence==='function') sharePresence();
  if(typeof afterRender==='function') afterRender();
}

function tcard(t, {showOwner=true, showEng=true}={}){
  const s = st(t); const e = t.eng && S.engagements[t.eng]; const na = nextAction(t);
  const owner = mem(t.owner);
  let seen = '';
  if(s==='assigned') seen = `Not opened yet · assigned ${ago(t.history && t.history.length ? t.history[t.history.length-1].at : t.created)} ago`;
  else if(t.seenAt && s!=='done') seen = `Seen by ${esc(first(t.owner))} ${fmtWhen(t.seenAt)}`;
  const lastBlock = s==='blocked' && t.history ? [...t.history].reverse().find(h=>h.to==='blocked') : null;
  const waits = openDeps(t); const cl = t.checklist||[]; const nc = (t.comments||[]).length;
  return `<div class="tcard ${s==='done'?'done':''}" style="border-left-color:${owner?esc(owner.color):'var(--line)'}" draggable="true" data-drag="task" data-id="${esc(t.id)}">
    <div class="tt" data-act="task" data-id="${esc(t.id)}" role="button" tabindex="0">${esc(t.title)}</div>
    ${waits.length ? `<div class="small" style="color:var(--warn)">Waiting on: ${waits.map(w=>esc(w.title)+(w.owner?` (${esc(first(w.owner))})`:'')).join('; ')}</div>` : ''}
    ${cl.length || nc || t.repeat || (t.links||[]).length ? `<div class="seenline">${cl.length?`☑ ${cl.filter(c=>c.done).length}/${cl.length}`:''}${nc?` · 💬 ${nc}`:''}${(t.links||[]).length?` · 🔗 ${t.links.length}`:''}${t.repeat?` · repeats ${esc(t.repeat)}`:''}</div>` : ''}
    ${lastBlock && lastBlock.note ? `<div class="small" style="color:var(--bad)">Blocked: ${esc(lastBlock.note)}</div>` : ''}
    <div class="line">${stPill(s)}<span class="due ${lateCls(t)}">${dueLabel(t)}</span></div>
    <div class="line"><span class="row" style="gap:6px">${showOwner ? av(t.owner)+`<span class="small">${esc(owner?owner.name:'Team queue')}</span>` : ''}</span>
      ${showEng && e ? `<a href="#" class="small" data-act="open" data-id="${esc(e.id)}">${esc(e.org.replace(/^Sample:\s*/,''))}</a>` : ''}</div>
    ${seen ? `<div class="seenline">${seen}</div>` : ''}
    ${(loggedMin(t) || +t.est) ? `<div class="seenline num">${t.timerStart?'<b style="color:var(--accent)">● </b>':''}${fmtH(hrs(t))} logged${+t.est?` of ${fmtH(+t.est)} planned`:''}</div>` : ''}
    <div class="row" style="gap:6px">
      ${t.owner===S.me && isOpen(t) && s!=='unassigned' ? (t.timerStart ? `<button class="btn sm" data-act="timer-stop" data-id="${esc(t.id)}">■ Stop</button>` : `<button class="btn sm ghost" data-act="timer-start" data-id="${esc(t.id)}" aria-label="Start timer">▶ Time</button>`) : ''}
      ${na ? `<button class="btn sm ${na.to==='done'?'accent':'primary'}" data-act="tstat" data-id="${esc(t.id)}" data-to="${na.to}">${na.label}</button>` : ''}
      <button class="btn sm ghost" data-act="task" data-id="${esc(t.id)}">Details</button>
    </div>
  </div>`;
}

function whoBanner(){
  if(S.me) return '';
  const ms = team();
  return `<section class="banner"><b>Who are you?</b><span class="small">Pick your name once so your tasks, calendar and alerts follow you on every device.</span>
    <div class="row">${ms.map(m=>`<button class="btn" data-act="claim" data-id="${esc(m.id)}">${av(m.id)} ${esc(m.name)}</button>`).join('') || '<span class="small">No team members yet. Add them on the <a href="#team">Team</a> page.</span>'}</div></section>`;
}

function viewToday(){
  const now = new Date(); const hm = pad(now.getHours())+':'+pad(now.getMinutes()); const d = today();
  const hour = now.getHours(); const greet = hour<12 ? 'Good morning' : hour<17 ? 'Good afternoon' : 'Good evening';
  const me = mem(S.me);
  const mine = openTasks().filter(t=>t.owner===S.me);
  const toAck = mine.filter(t=>st(t)==='assigned');
  const active = mine.filter(t=>['seen','in_progress','blocked'].includes(st(t)) && t.due<=addDays(d,2));
  const reviews = openTasks().filter(t=>st(t)==='review' && (t.assignedBy===S.me || (!t.assignedBy && me && me.lead)));
  const later = mine.filter(t=>!toAck.includes(t) && !active.includes(t)).slice(0,6);
  const queue = openTasks().filter(t=>st(t)==='unassigned');
  const blockedAll = openTasks().filter(t=>st(t)==='blocked');
  const alerts = myAlerts().slice(0,12);
  const evs = eventsOn(d).filter(ev => !S.calMine || !ev.att || !ev.att.length || ev.att.includes(S.me));
  const act = activeEng();
  const pipe = act.filter(e=>stageIdx(e.stage) <= stageIdx('proposal')).reduce((s,e)=>s+(+e.value||0),0);
  const late = openTasks().filter(t=>t.due<d);
  const cur = BLOCKS.find(b => hm>=b.s && hm<b.e);
  const fiveF = me && me.fiveF;

  const sec = (title, items, empty, extra='') => `<div class="panel"><div class="spread" style="margin-bottom:10px"><h2>${title}</h2>${extra}</div><div class="tasks">${items.length ? items.map(t=>tcard(t,{showOwner:false})).join('') : `<div class="empty">${empty}</div>`}</div></div>`;

  return `${whoBanner()}${onboardingCard()}${pulseCard()}${npsCard()}
  <section class="spread">
    <div><p class="eyebrow">${now.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})}</p><h1>${greet}${me?', '+esc(me.name.split(/\s+/)[0]):''}</h1>
    <p class="muted">${fiveF && cur ? `You are in your <b>${cur.f}</b> block until ${cur.e}. ` : ''}${mine.length} open task${mine.length===1?'':'s'} are yours${toAck.length?`, <b>${toAck.length} waiting for you to acknowledge</b>`:''}.</p></div>
    <div class="row">${S.canCoach?'<button class="btn" data-act="summary">Weekly summary</button>':''}<button class="btn" data-act="new-task">+ Task</button>${window.FLOWHUB_HOST==='fios' ? '<a class="btn primary" href="#projects">Projects</a>' : `<button class="btn primary" data-act="new">+ ${esc(cap(LBL.entity))}</button>`}</div>
  </section>
  <section class="kpis" aria-label="Team at a glance">
    <div class="kpi"><span class="v">${money(pipe)}</span><span class="l">Open pipeline</span></div>
    <div class="kpi ${queue.length?'attn':''}"><span class="v">${queue.length}</span><span class="l"><a href="#board">Unassigned in queue</a></span></div>
    <div class="kpi ${blockedAll.length?'alert':''}"><span class="v">${blockedAll.length}</span><span class="l">Blocked across team</span></div>
    <div class="kpi ${late.length?'alert':''}"><span class="v">${late.length}</span><span class="l">Late across team</span></div>
    ${window.FLOWHUB_HOST==='fios' ? `<div class="kpi"><span class="v">${projects().filter(p=>pHealth(p).k!=='on_track'&&p.status!=='done').length}</span><span class="l"><a href="#projects">Projects needing attention</a></span></div>` : `<div class="kpi ${drafts().length?'attn':''}"><span class="v">${drafts().length}</span><span class="l"><a href="#outbox">Messages to send</a></span></div>`}
  </section>
  <section class="three">
    <div style="display:grid;gap:22px;align-content:start">
      ${sec('Needs your OK', toAck, 'Nothing new assigned to you.', `<span class="small muted">Tap “Got it” so the team sees you have it</span>`)}
      ${reviews.length ? sec('Waiting on your review', reviews, '') : ''}
    </div>
    <div style="display:grid;gap:22px;align-content:start">
      ${sec('Doing now and due soon', active, S.me ? 'Clear for the next two days.' : 'Pick who you are to see your tasks.')}
      ${later.length ? sec('Coming up', later, '') : ''}
    </div>
    <div style="display:grid;gap:22px;align-content:start">
      <div class="panel"><div class="spread" style="margin-bottom:10px"><h2>Alerts</h2>${alerts.some(n=>!n.read)?'<button class="btn sm ghost" data-act="read-all">Mark all read</button>':''}</div>
        <div class="alerts">${alerts.length ? alerts.map(n=>`<button class="alert ${n.read?'':'unread'}" data-act="alert" data-id="${esc(n.id)}">${av(n.by)}<span>${esc(n.text)}</span><time>${ago(n.at)}</time></button>`).join('') : '<div class="empty">No alerts yet. You will hear here when work is assigned to you, finished, blocked, or sent for your review.</div>'}</div></div>
      <div class="panel"><div class="spread" style="margin-bottom:10px"><h2>Today on the team calendar</h2><a class="small" href="#calendar">Week</a></div>
        <div style="display:grid;gap:6px">${evs.length ? evs.map(evChip).join('') : '<div class="empty">Nothing scheduled.</div>'}</div></div>
      ${fiveF ? `<div class="panel"><h2>Your 5 F’s</h2><div class="blocks">${BLOCKS.map(b=>`<div class="block ${cur===b?'now':''}"><div class="t">${b.s}–${b.e}</div><div><span class="fpill">${b.f}</span><span class="small">${esc(b.label)}</span></div></div>`).join('')}</div></div>` : ''}
    </div>
  </section>`;
}

function viewBoard(){
  const ms = team(); const all = list('tasks');
  const f = S.boardFilter;
  const show = t => f==='all' ? isOpen(t) : f==='done' ? !isOpen(t) && (t.doneAt||'') >= addDays(today(),-7) : st(t)===f && isOpen(t);
  const colFor = (ownerId, title, sub) => {
    const items = all.filter(t => (t.owner||'')===ownerId && show(t)).sort((a,b)=>(a.due||'').localeCompare(b.due||''));
    const open = all.filter(t => (t.owner||'')===ownerId && isOpen(t));
    const counts = ['assigned','seen','in_progress','blocked','review'].map(s=>[s, open.filter(t=>st(t)===s).length]);
    const late = open.filter(t=>t.due<today()).length;
    const tot = open.length || 1;
    const colors = {assigned:'var(--warn)',seen:'var(--navy)',in_progress:'var(--accent)',blocked:'var(--bad)',review:'var(--lane-associates)'};
    const m = mem(ownerId); const wkEst = open.filter(t=>t.due<=addDays(today(),7)).reduce((a,t)=>a+Math.max(0,(+t.est||0)-hrs(t)),0);
    const capLine = m && +m.capacity ? `<div class="meta" style="${wkEst>m.capacity?'color:var(--bad)':''}">${fmtH(wkEst)} planned this week of ${m.capacity}h</div>` : '';
    return `<div class="pcol" data-drop="owner" data-owner="${esc(ownerId)}"><div class="pcol-h">${ownerId ? av(ownerId,'lg') : '<span class="av empty lg">Q</span>'}<div><b>${esc(title)}</b><div class="meta">${esc(sub)} · ${open.length} open${late?` · <span style="color:var(--bad)">${late} late</span>`:''}</div>
      ${capLine}${ownerId ? `<div class="load" title="Workload by status">${counts.filter(c=>c[1]).map(([s,n])=>`<span style="width:${n/tot*100}%;background:${colors[s]}"></span>`).join('')}</div>` : ''}</div></div>
      ${items.map(t=>tcard(t,{showOwner:false})).join('') || '<div class="empty small">Nothing here.</div>'}
      ${!ownerId ? '' : ''}</div>`;
  };
  const filters = [['all','All open'],['assigned','Not yet seen'],['in_progress','In progress'],['blocked','Blocked'],['review','In review'],['done','Done this week']];
  const mode = `<div class="seg" role="group" aria-label="View"><button data-act="bmode" data-v="board" aria-pressed="${S.boardMode==='board'}">Board</button><button data-act="bmode" data-v="list" aria-pressed="${S.boardMode==='list'}">List</button></div>`;
  return `${whoBanner()}<section class="spread"><div><p class="eyebrow">Allocation</p><h1>Team board</h1>
    <p class="muted" style="max-width:72ch">One column per person. Every card shows its owner, its status and whether the owner has seen it. Drag a card onto a person to hand it to them.</p></div>
    <div class="row">${mode}${S.boardMode==='board' ? `<div class="seg" role="group" aria-label="Filter">${filters.map(([k,l])=>`<button data-act="bfilter" data-f="${k}" aria-pressed="${f===k}">${l}</button>`).join('')}</div>` : ''}<button class="btn primary" data-act="new-task">+ Task</button></div></section>
    ${S.boardMode==='list' ? listView() : `<section class="lanes-board">${colFor('', 'Team queue', 'Unassigned')}${ms.map(m=>colFor(m.id, m.name, m.role||'')).join('')}</section>`}`;
}

function eventsOn(day){
  return list('events').filter(ev => {
    if(!ev.date || day < ev.date) return false;
    if(ev.repeat==='weekdays') return dow(day)>=1 && dow(day)<=5 && (!ev.until || day<=ev.until);
    if(ev.repeat==='weekly') return dow(day)===dow(ev.date) && (!ev.until || day<=ev.until);
    return ev.date===day;
  }).sort((a,b)=>(a.start||'').localeCompare(b.start||''));
}
function evChip(ev){
  const e = ev.eng && S.engagements[ev.eng];
  return `<div class="ev ${ev.type==='rhythm'?'rhythm':''}" data-act="event" data-id="${esc(ev.id)}" role="button" tabindex="0"><span class="k">${fmtTime(ev.start)}${ev.end?'–'+fmtTime(ev.end):''}${ev.repeat?` · ${ev.repeat==='weekdays'?'weekdays':'weekly'}`:''}</span>${esc(ev.title)}${e?` · ${esc(e.org.replace(/^Sample:\s*/,''))}`:''}
    ${(ev.att&&ev.att.length)?`<div class="row" style="gap:2px;margin-top:4px">${ev.att.map(a=>av(a)).join('')}</div>`:''}</div>`;
}
function viewCalendar(){
  setTimeout(watchGcal, 0);
  const base = new Date(today()+'T12:00:00'); const off = (base.getDay()+6)%7; base.setDate(base.getDate()-off+S.calWeek*7);
  const days = [...Array(7)].map((_,i)=>{ const d=new Date(base); d.setDate(base.getDate()+i); return iso(d); });
  const cols = days.map(day => {
    const evs = eventsOn(day).filter(ev => !S.calMine || !ev.att || !ev.att.length || ev.att.includes(S.me));
    const ts = list('tasks').filter(t=>t.due===day && isOpen(t) && (!S.calMine || t.owner===S.me));
    const gs = S.gcalOn ? (S.gcalEvents||[]).filter(g => g.start.slice(0,10)===day) : [];
    const dd = new Date(day+'T12:00:00');
    return `<div class="day ${day===today()?'today':''}"><h2><span>${dd.toLocaleDateString('en-US',{weekday:'short'})}</span><b>${dd.getDate()}</b></h2>
      ${evs.map(evChip).join('')}
      ${gs.map(g=>`<div class="ev gcal"><span class="k">YOUR GOOGLE · ${g.allDay?'all day':fmtTime(g.start.slice(11,16))}</span>${esc(g.title)}<button class="btn sm ghost" data-act="gcal-import" data-t="${esc(g.title)}" data-d="${esc(g.start.slice(0,10))}" data-s="${esc(g.allDay?'09:00':g.start.slice(11,16))}" data-e="${esc(g.allDay?'09:30':g.end.slice(11,16))}" style="padding:0 4px;margin-left:4px" aria-label="Add to team calendar">+ team</button></div>`).join('')}
      ${ts.map(t=>{ const o=mem(t.owner); return `<div class="ev task" style="border-left-color:${o?esc(o.color):'var(--muted)'}" data-act="task" data-id="${esc(t.id)}" role="button" tabindex="0"><span class="k">DUE · ${esc(o?first(t.owner):'Queue')} · ${esc(stName(st(t)))}</span>${esc(t.title)}</div>`; }).join('')}
      <button class="btn sm ghost" data-act="new-event" data-date="${day}" style="margin-top:auto">+ Add</button></div>`;
  }).join('');
  const label = `${fmtDate(days[0])} – ${fmtDate(days[6])}`;
  return `${whoBanner()}<section class="spread"><div><p class="eyebrow">Shared calendar</p><h1>Team week</h1>
    <p class="muted" style="max-width:72ch">Meetings, team rhythms and every task due date in one place, for everyone. Colored edges show the owner.</p></div>
    <div class="row"><div class="seg" role="group" aria-label="Whose calendar"><button data-act="calmine" data-v="0" aria-pressed="${!S.calMine}">Everyone</button><button data-act="calmine" data-v="1" aria-pressed="${S.calMine}">Just me</button></div>
    <button class="btn" data-act="calweek" data-d="-1" aria-label="Previous week">◀</button><span class="num small">${label}</span><button class="btn" data-act="calweek" data-d="1" aria-label="Next week">▶</button>
    ${S.calWeek?'<button class="btn ghost" data-act="calweek" data-d="0">This week</button>':''}<button class="btn primary" data-act="new-event" data-date="${today()}">+ Event</button></div></section>
    ${MCP ? `<section class="row small" style="gap:10px">${S.gcalOn ? `<span class="muted">Showing your Google Calendar alongside the team’s${S.gcalErr?`: <span style="color:var(--bad)">${esc(S.gcalErr)}</span>`:''}</span><button class="btn sm ghost" data-act="gcal-off">Hide</button><button class="btn sm" data-act="gcal-push-week">Add this week’s team events to my Google Calendar</button>` : `<button class="btn sm" data-act="gcal-load">Show my Google Calendar here</button><span class="muted">Only you see your own events.</span>`}</section>` : ''}
    <section class="cal">${cols}</section>`;
}

function viewPipeline(){
  const act = activeEng();
  const cols = STAGES.map((s,i) => {
    const items = act.filter(e=>e.stage===s.id).sort((a,b)=>(a.updated||'').localeCompare(b.updated||''));
    const sum = items.reduce((t,e)=>t+(+e.value||0),0);
    return `<div class="col" data-drop="stage" data-stage="${s.id}"><div class="col-h"><b>${i+1}. ${s.name}</b><span class="num">${items.length} · ${money(sum)}</span></div>
      <div class="col-src">Exit when: ${esc(s.gate)} · ${pct(PROB[s.id])} to sign</div>
      ${items.map(e => {
        const open = list('tasks').filter(t=>t.eng===e.id && isOpen(t));
        const blocked = open.filter(t=>st(t)==='blocked').length, unseen = open.filter(t=>st(t)==='assigned').length, q = open.filter(t=>st(t)==='unassigned').length;
        const age = e.stageAt ? daysBetween(e.stageAt, today()) : 0;
        const people = [...new Set(open.map(t=>t.owner).filter(Boolean))];
        const gs = gateState(e, e.stage); const gd = gs.filter(g=>g.done).length;
        const dep = (e.invoices||[]).find(x=>x.kind==='deposit'); const depBad = dep && stageIdx(e.stage)>=stageIdx('delivery') && !dep.paid;
        return `<div class="card" data-act="open" data-id="${esc(e.id)}" draggable="true" data-drag="eng">
          <button class="org linkbtn" data-act="open" data-id="${esc(e.id)}">${esc(e.org)}</button>
          <div class="line small"><span style="color:${gd===gs.length?'var(--ok)':'var(--muted)'}">☑ ${gd}/${gs.length} exit items</span>${depBad?'<span class="flag hi" style="margin:0">Deposit unpaid</span>':''}</div>
          <div class="line"><span class="offer ${esc(e.offer)}">${esc(e.offer)}</span><span class="num">${money(e.value)}</span></div>
          <div class="line"><span class="row" style="gap:3px">${av(e.lead)}${people.filter(p=>p!==e.lead).map(p=>av(p)).join('')}</span><span class="num muted">${age}d here</span></div>
          <div class="line muted small">${open.length} open${blocked?` · <span style="color:var(--bad)">${blocked} blocked</span>`:''}${unseen?` · ${unseen} unseen`:''}${q?` · ${q} in queue`:''}</div>
          <div class="acts">
            ${i>0 ? `<button class="btn sm ghost" data-act="move" data-id="${esc(e.id)}" data-to="${STAGES[i-1].id}" aria-label="Move back">◀</button>` : '<span></span>'}
            ${i<STAGES.length-1 ? `<button class="btn sm accent" data-act="advance" data-id="${esc(e.id)}" data-to="${STAGES[i+1].id}">${STAGES[i+1].name} ▶</button>` : ''}
          </div></div>`; }).join('')}
    </div>`;
  }).join('');
  const R = recipes();
  const owners = (S.settings && S.settings.laneOwners) || {};
  const rows = LANES.map(l => `<tr data-lane="${l.id}"><th class="lane">${l.name}${l.id!=='client'?`<div class="small muted" style="font-weight:400">${l.id==='franklin'?'Account lead':esc(owners[l.id]?mname(owners[l.id]):'Team queue')}</div>`:''}</th>${STAGES.map(s=>{
    const r = R.find(x=>x.stage===s.id) || {tasks:[],msgs:[]};
    const ms = (r.msgs||[]).filter(m=>m.lane===l.id).map(m=>`<span class="chip msg"><span class="k">${m.ch==='email'?'EMAIL':m.ch==='text'?'TEXT':'NOTE'}</span>${esc(m.s.replace(/\{\{(\w+)\}\}/g,'‹$1›'))}</span>`).join('');
    const ts = (r.tasks||[]).filter(t=>(t.lane||'franklin')===l.id).map(t=>`<span class="chip"><span class="k">TASK · +${+t.d||0}d</span>${esc(t.t.replace(/\{\{(\w+)\}\}/g,'‹$1›'))}</span>`).join('');
    return `<td style="${r.on===false?'opacity:.4':''}">${ms}${ts}</td>`;
  }).join('')}</tr>`).join('');
  return `<section class="spread"><div><p class="eyebrow">Workflow</p><h1>${esc(cap(LBL.entity))} pipeline</h1>
    <p class="muted" style="max-width:72ch">Each client sits in one stage. Moving it forward runs that stage’s playbook once: tasks go to their owners (or the queue), and drafts go to the Outbox.</p></div>
    <div class="row"><div class="seg" role="group" aria-label="View"><button data-act="pmode" data-v="board" aria-pressed="${S.pipeMode==='board'}">Board</button><button data-act="pmode" data-v="timeline" aria-pressed="${S.pipeMode==='timeline'}">Timeline</button></div><button class="btn primary" data-act="new">+ New ${esc(LBL.entity)}</button></div></section>
    ${S.pipeMode==='timeline' ? timelineView() : `<section class="board">${cols}</section>`}
    <section class="panel"><div class="spread" style="margin-bottom:10px"><h2>Who hears what at each stage</h2><a class="small" href="#playbooks">Edit playbooks</a></div>
      <div class="matrix-wrap"><table class="matrix"><thead><tr><th>Role</th>${STAGES.map((s,i)=>`<th>${i+1}. ${s.name}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function viewOutbox(){
  const tab = S.outTab;
  const items = tab==='draft' ? drafts() : list('messages').filter(m=>m.status==='sent').sort((a,b)=>(b.sentAt||'').localeCompare(a.sentAt||'')).slice(0,60);
  const cards = items.map(m => {
    const e = m.eng && S.engagements[m.eng];
    const gmail = m.ch==='email' && m.to ? `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(m.to)}&su=${encodeURIComponent(m.subj)}&body=${encodeURIComponent(m.body)}` : '';
    if(tab==='sent') return `<div class="msg" data-lane="${esc(m.lane)}"><div class="spread"><b>${esc(m.subj)}</b><span class="small muted num">${fmtDate(m.sentAt)}</span></div><div class="small muted">${esc(m.toName||'')}${e?` · ${esc(e.org)}`:''} · ${esc(stageName(m.stage))}${m.sentBy?` · sent by ${esc(mname(m.sentBy))}`:''}</div></div>`;
    return `<div class="msg" data-lane="${esc(m.lane)}">
      <div><span class="eyebrow">${m.ch==='email'?'Email':m.ch==='text'?'Text':'Internal note'} → ${esc(laneName(m.lane))}</span>
        <div class="small muted">${esc(m.toName||'')}${m.to?` &lt;${esc(m.to)}&gt;`:''}${e?` · <a href="#" data-act="open" data-id="${esc(e.id)}">${esc(e.org)}</a>`:''} · ${esc(stageName(m.stage))}</div></div>
      <input class="subj" id="ms-${esc(m.id)}" data-field="subj" data-id="${esc(m.id)}" value="${esc(m.subj)}" aria-label="Subject">
      <textarea id="mb-${esc(m.id)}" data-field="body" data-id="${esc(m.id)}" aria-label="Message body">${esc(m.body)}</textarea>
      <div class="row">
        ${MCP && m.ch==='email' && m.to ? `<button class="btn primary" data-act="gmail-send" data-id="${esc(m.id)}" ${S.sending[m.id]?'disabled':''}>${S.sending[m.id]?'Sending…':'Send from my Gmail'}</button>` : ''}
        ${gmail ? `<a class="btn ${MCP?'':'primary'}" href="${gmail}" target="_blank" rel="noopener">Open in Gmail</a>` : (m.ch==='email' && m.lane==='client' ? '<span class="small muted">Add the contact’s email to send it</span>' : '')}
        <button class="btn" data-act="copy" data-id="${esc(m.id)}">Copy text</button>
        <button class="btn accent" data-act="sent" data-id="${esc(m.id)}">Mark sent</button>
        <button class="btn ghost danger" data-act="discard" data-id="${esc(m.id)}">Discard</button>
      </div></div>`;
  }).join('');
  return `<section class="spread"><div><p class="eyebrow">Communication</p><h1>Outbox</h1>
    <p class="muted">Drafts written by your playbooks, already filled in. Edit, send from Gmail, then mark sent so it lands in the client’s timeline.</p></div>
    <div class="seg" role="group" aria-label="Filter"><button data-act="outtab" data-tab="draft" aria-pressed="${tab==='draft'}">To send (${drafts().length})</button><button data-act="outtab" data-tab="sent" aria-pressed="${tab==='sent'}">Sent</button></div></section>
    <section class="msgs">${cards || `<div class="empty">${tab==='draft' ? 'Nothing waiting. New drafts appear here when an engagement changes stage.' : 'Nothing sent yet.'}</div>`}</section>`;
}

function viewRecipes(){
  if(!S.draftRecipes) S.draftRecipes = JSON.parse(JSON.stringify(recipes()));
  const R = S.draftRecipes;
  const laneOpts = (sel, withClient) => LANES.filter(l=>withClient||l.id!=='client').map(l=>`<option value="${l.id}" ${l.id===sel?'selected':''}>${l.name}</option>`).join('');
  const cards = STAGES.map((s,si) => {
    let r = R.find(x=>x.stage===s.id); if(!r){ r={stage:s.id,on:true,tasks:[],msgs:[]}; R.push(r); }
    r.tasks = r.tasks||[]; r.msgs = r.msgs||[];
    const ri = R.indexOf(r);
    return `<div class="panel recipe">
      <div class="spread"><h2 class="h3">${si+1}. ${s.name}</h2><label class="switch"><input type="checkbox" id="ron-${ri}" data-r="${ri}" data-rf="on" ${r.on?'checked':''}>Active</label></div>
      <p class="when">When an engagement enters ${s.name}, create:</p>
      <div class="eyebrow">Tasks · due in days · planned hours · role</div>
      ${r.tasks.map((t,ti)=>`<div class="ritem"><input id="rt-${ri}-${ti}" data-r="${ri}" data-rt="${ti}" data-k="t" value="${esc(t.t)}" aria-label="Task"><input id="rd-${ri}-${ti}" type="number" data-r="${ri}" data-rt="${ti}" data-k="d" value="${+t.d||0}" aria-label="Due in days"><input id="re-${ri}-${ti}" type="number" step="0.25" min="0" data-r="${ri}" data-rt="${ti}" data-k="e" value="${+t.e||0}" aria-label="Planned hours"><select id="rl-${ri}-${ti}" data-r="${ri}" data-rt="${ti}" data-k="lane" aria-label="Role">${laneOpts(t.lane||'franklin')}</select><button class="btn sm ghost danger" data-act="r-del-task" data-r="${ri}" data-i="${ti}" aria-label="Remove task">✕</button></div>`).join('')}
      <div><button class="btn sm" data-act="r-add-task" data-r="${ri}">+ Task</button></div>
      <div class="eyebrow">Messages</div>
      ${r.msgs.map((m,mi)=>`<div class="rmsg"><div class="ritem m"><select id="rml-${ri}-${mi}" data-r="${ri}" data-rm="${mi}" data-k="lane" aria-label="To">${laneOpts(m.lane,true)}</select><select id="rmc-${ri}-${mi}" data-r="${ri}" data-rm="${mi}" data-k="ch" aria-label="Channel"><option value="email" ${m.ch==='email'?'selected':''}>Email</option><option value="text" ${m.ch==='text'?'selected':''}>Text</option><option value="internal" ${m.ch==='internal'?'selected':''}>Note</option></select><input id="rms-${ri}-${mi}" data-r="${ri}" data-rm="${mi}" data-k="s" value="${esc(m.s)}" aria-label="Subject"><button class="btn sm ghost danger" data-act="r-del-msg" data-r="${ri}" data-i="${mi}" aria-label="Remove message">✕</button></div><textarea id="rmb-${ri}-${mi}" data-r="${ri}" data-rm="${mi}" data-k="b" aria-label="Body">${esc(m.b)}</textarea></div>`).join('')}
      <div><button class="btn sm" data-act="r-add-msg" data-r="${ri}">+ Message</button></div>
    </div>`;
  }).join('');
  return `<section class="spread"><div><p class="eyebrow">Automation</p><h1>Stage playbooks</h1>
    <p class="muted" style="max-width:72ch">Each stage is a “when this happens, do that” rule. Tasks go to the person who owns that role (set on the Team page). Merge fields: {{org}} {{first}} {{contact}} {{offer}} {{offerCode}} {{value}} {{deposit}} {{calendly}} {{sender}}.</p></div>
    <div class="row"><button class="btn ghost" data-act="r-reset">Restore defaults</button><button class="btn primary" data-act="r-save">Save playbooks</button></div></section>
    <section class="recipes">${cards}</section>`;
}

function viewTeam(){
  const ms = team(); const owners = (S.settings && S.settings.laneOwners) || {};
  const wk = addDays(today(),-7);
  const memberCards = ms.map(m => {
    const open = list('tasks').filter(t=>t.owner===m.id && isOpen(t));
    const doneWk = list('tasks').filter(t=>t.owner===m.id && !isOpen(t) && (t.doneAt||'')>=wk).length;
    const unseen = open.filter(t=>st(t)==='assigned').length;
    return `<div class="panel member">${av(m.id,'lg')}<div style="display:grid;gap:10px">
      <div class="spread"><div><b>${esc(m.name)}</b>${m.lead?' <span class="fpill">Lead</span>':''}<div class="small muted">${esc(m.role||'')}</div></div>
        <div class="small muted num">${open.length} open · ${unseen} unseen · ${doneWk} done this week</div></div>
      <div class="form">
        <label>Name<input id="tm-n-${esc(m.id)}" data-tm="name" data-id="${esc(m.id)}" value="${esc(m.name)}"></label>
        <label>Role<input id="tm-r-${esc(m.id)}" data-tm="role" data-id="${esc(m.id)}" value="${esc(m.role)}"></label>
        <label>Email<input id="tm-e-${esc(m.id)}" type="email" data-tm="email" data-id="${esc(m.id)}" value="${esc(m.email)}"></label>
        <label>Hours per week<input id="tm-cap-${esc(m.id)}" type="number" min="0" data-tm="capacity" data-id="${esc(m.id)}" value="${+m.capacity||''}" placeholder="e.g. 30"></label>
        ${S.canCoach ? `<label>Hourly cost ($, lead only)<input id="tm-rate-${esc(m.id)}" type="number" min="0" data-rate="${esc(m.id)}" value="${((rcfg().rates||{})[m.id]||{}).cost||''}" placeholder="${rateOf(m.id)}"></label>` : ''}
        <label>Color<select id="tm-c-${esc(m.id)}" data-tm="color" data-id="${esc(m.id)}">${PALETTE.map(c=>`<option value="${c}" ${c===m.color?'selected':''}>${c}</option>`).join('')}</select></label>
      </div>
      <div class="row small"><span class="muted">${m.uid ? 'Linked to a claude.ai account' : 'Not linked yet: they pick their name once when they open the hub'}</span>
        <label class="switch"><input type="checkbox" id="tm-f-${esc(m.id)}" data-tm="fiveF" data-id="${esc(m.id)}" ${m.fiveF?'checked':''}>Show 5 F's day plan</label>
        ${m.id===S.me ? `<label class="switch" title="When you assign work, block it, send it for review or @mention someone, they also get an email from your Gmail"><input type="checkbox" id="tm-ea-${esc(m.id)}" data-tm="emailAlerts" data-id="${esc(m.id)}" ${m.emailAlerts?'checked':''}>Email my alerts to teammates from my Gmail</label>` : ''}
        <button class="btn sm ghost danger" data-act="rm-member" data-id="${esc(m.id)}">Remove</button></div>
    </div></div>`;
  }).join('');
  const ownerSel = lane => `<select id="lo-${lane}" data-lo="${lane}"><option value="">Team queue (unassigned)</option>${ms.map(m=>`<option value="${m.id}" ${owners[lane]===m.id?'selected':''}>${esc(m.name)}</option>`).join('')}</select>`;
  return `${whoBanner()}<section><p class="eyebrow">People and rules</p><h1>Team and how we work</h1></section>
  <section class="two">
    <div style="display:grid;gap:14px;align-content:start">
      <h2>Members</h2>${memberCards || '<div class="empty">No members yet.</div>'}
      ${window.FLOWHUB_HOST==='fios' ? '<div class="panel"><h3>Add or remove people</h3><p class="small muted">People come from the operations app’s sign-in accounts. Add them in Operations → Settings → People, and they appear here.</p></div>' : `      <form class="panel form" id="addMember"><h3 style="grid-column:1/-1">Add a member</h3>
        <label>Name<input id="am-name" required></label><label>Role<input id="am-role" placeholder="Associate Consultant"></label>
        <label>Email<input id="am-email" type="email"></label><div style="display:flex;align-items:end"><button class="btn primary" type="submit">Add member</button></div>
        <p class="small muted" style="grid-column:1/-1">To let them update tasks, share this hub with them from its page on claude.ai as a Contributor or Editor.</p></form>`}
      ${S.canCoach ? `<div class="panel form"><h3 style="grid-column:1/-1">Cost model (lead only)</h3>
        <label>Default hourly cost ($)<input id="rc-def" type="number" min="0" data-rc="defaultRate" value="${rcfg().defaultRate||''}" placeholder="${DEFAULT_RATE}"></label>
        <label>Target margin (%)<input id="rc-tm" type="number" min="0" max="95" data-rc="targetMargin" value="${Math.round(targetMargin()*100)}"></label>
        <p class="small muted" style="grid-column:1/-1">Hourly cost is what an hour of that person costs the business (pay plus overhead). For yourself, use the rate your time is worth. Teammates cannot see these numbers.</p></div>` : ''}
      <div class="panel form"><h3 style="grid-column:1/-1">Who owns each role’s playbook tasks</h3>
        <label>Principal<input disabled value="The engagement’s account lead"></label>
        <label>Associates${ownerSel('associates')}</label>
        <label>Finance &amp; Ops${ownerSel('finance')}</label>
      </div>
    </div>
    <div style="display:grid;gap:14px;align-content:start">
      <h2>The framework</h2>
      <div class="panel"><h3 style="margin-bottom:8px">1. Every client is in one stage</h3>
        <table class="def"><thead><tr><th>Stage</th><th>Exit when</th></tr></thead><tbody>${STAGES.map((s,i)=>`<tr><td>${i+1}. ${s.name}</td><td>${esc(s.gate)}</td></tr>`).join('')}</tbody></table></div>
      <div class="panel"><h3 style="margin-bottom:8px">2. Every task has one owner and one status</h3>
        <div class="lifecycle" style="margin-bottom:10px">${['unassigned','assigned','seen','in_progress','review','done'].map(s=>stPill(s)).join('<span class="arrow">→</span>')}<span class="muted small">(any open task can go</span>${stPill('blocked')}<span class="muted small">)</span></div>
        <table class="def"><thead><tr><th>Status</th><th>Means</th><th>Next move</th></tr></thead><tbody>${STATUSES.map(s=>`<tr><td>${stPill(s.id)}</td><td>${esc(s.def)}</td><td>${esc(s.who)}</td></tr>`).join('')}</tbody></table></div>
      <div class="panel"><h3 style="margin-bottom:8px">3. Who gets an alert</h3>
        <table class="def"><tbody>
          <tr><td>Task assigned or reassigned</td><td>The new owner (and the old one)</td></tr>
          <tr><td>Owner taps “Got it”</td><td>Whoever assigned it, so they know it was seen</td></tr>
          <tr><td>Started or finished</td><td>Whoever assigned it</td></tr>
          <tr><td>Blocked</td><td>Whoever assigned it and the team lead, with the reason</td></tr>
          <tr><td>Sent for review</td><td>Whoever assigned it, to approve</td></tr>
          <tr><td>Client changes stage</td><td>Account lead and anyone with open tasks on that client</td></tr>
        </tbody></table></div>
      <div class="panel"><h3 style="margin-bottom:8px">4. Team rhythm</h3>
        <p class="small muted" style="margin-bottom:8px">Recurring meetings live on the shared calendar so the whole team sees the same week.</p>
        <div style="display:grid;gap:6px">${list('events').filter(e=>e.type==='rhythm').map(evChip).join('') || '<div class="empty">No team rhythms yet. Add a repeating event on the Calendar.</div>'}</div></div>
    </div>
  </section>`;
}

/* ---------- drawer (engagement) ---------- */
function renderDrawer(){
  const e = S.engagements[S.drawer]; const d = $('#drawer');
  if(!e){ closeDrawer(); return; }
  const tasks = list('tasks').filter(t=>t.eng===e.id && !t.cancelled).sort((a,b)=>(isOpen(b)-isOpen(a))||(a.due||'').localeCompare(b.due||''));
  const gs = gateState(e, e.stage); const nextS = STAGES[stageIdx(e.stage)+1];
  const invs = e.invoices||[];
  const msgs = list('messages').filter(m=>m.eng===e.id);
  const log = (e.log||[]).slice().reverse();
  d.innerHTML = `
    <div class="spread"><div><p class="eyebrow">${e.outcome==='lost'?`<span style="color:var(--bad)">Lost at ${esc(stageName(e.lostStage||e.stage))}: ${esc(e.lostReason||'')}</span>`:esc(stageName(e.stage))} · ${esc(OFFERS[e.offer]||'')}</p><h2>${esc(e.org)}</h2></div><button class="btn ghost" data-act="close-drawer" aria-label="Close">✕</button></div>
    ${e.outcome!=='lost' ? `<div class="panel" style="padding:12px;display:grid;gap:8px"><div class="spread"><h3>Exit checklist: ${esc(stageName(e.stage))}</h3><span class="small muted">${gs.filter(g=>g.done).length}/${gs.length} done</span></div>
      ${gs.map(g=>`<label class="switch"><input type="checkbox" id="gate-${g.i}" data-gate="${g.i}" data-eid="${esc(e.id)}" data-sid="${esc(e.stage)}" ${g.done?'checked':''}>${esc(g.t)}</label>`).join('')}
      ${nextS ? `<div><button class="btn sm accent" data-act="advance" data-id="${esc(e.id)}" data-to="${nextS.id}">Move to ${esc(nextS.name)} ▶</button></div>` : ''}</div>` : ''}
    <div class="form">
      <label class="full">${esc(LBL.org)}<input id="ef-org" data-ef="org" value="${esc(e.org)}"></label>
      <label>${esc(LBL.contact)}<input id="ef-contact" data-ef="contact" value="${esc(e.contact)}"></label>
      <label>Email<input id="ef-email" type="email" data-ef="email" value="${esc(e.email)}"></label>
      <label>Account lead<select id="ef-lead" data-ef="lead"><option value="">None</option>${team().map(m=>`<option value="${m.id}" ${m.id===e.lead?'selected':''}>${esc(m.name)}</option>`).join('')}</select></label>
      <label>${esc(LBL.value)}<input id="ef-value" type="number" data-ef="value" value="${+e.value||0}"></label>
      <label>${esc(LBL.offer)}<select id="ef-offer" data-ef="offer">${Object.keys(OFFERS).map(k=>`<option value="${k}" ${k===e.offer?'selected':''}>${k} · ${OFFERS[k]}</option>`).join('')}</select></label>
      <label>Stage<select id="ef-stage" data-ef="stage">${STAGES.map(s=>`<option value="${s.id}" ${s.id===e.stage?'selected':''}>${s.name}</option>`).join('')}</select></label>
      <label class="full">Notes<textarea id="ef-notes" data-ef="notes">${esc(e.notes)}</textarea></label>
    </div>
    <div><div class="spread" style="margin-bottom:8px"><h3>Tasks</h3><button class="btn sm" data-act="new-task" data-eng="${esc(e.id)}">+ Task</button></div>
      <div class="tasks">${tasks.map(t=>tcard(t,{showEng:false})).join('') || '<div class="empty">No tasks yet.</div>'}</div></div>
    <div><div class="spread" style="margin-bottom:8px"><h3>Invoices</h3><span class="small muted">${money(invs.filter(i=>i.paid).reduce((a,i)=>a+(+i.amount||0),0))} paid of ${money(e.value)}</span></div>
      ${invs.length ? `<div style="display:grid;gap:6px">${invs.map(i=>{ const s2=invStatus(i); return `<div class="row" style="justify-content:space-between;border-bottom:1px solid var(--line);padding:4px 0"><span class="small"><b>${esc(i.label)}</b> · <span class="st" data-s="${s2==='paid'?'done':s2==='overdue'?'blocked':s2==='sent'?'seen':'unassigned'}">${INV_LABEL[s2]}</span>${i.due?` · due ${fmtDate(i.due)}`:''}</span>
        <span class="row" style="gap:4px"><input type="number" min="0" step="50" id="inv-a-${esc(i.id)}" data-inv="${esc(i.id)}" data-eid="${esc(e.id)}" value="${+i.amount||0}" style="width:90px;border:1px solid var(--line);border-radius:6px;padding:4px 6px;background:var(--bg)" aria-label="Amount" ${i.paid?'disabled':''}>
        ${s2==='draft'?`<button class="btn sm" data-act="inv-sent" data-e="${esc(e.id)}" data-i="${esc(i.id)}">Mark sent</button>`:''}${s2==='sent'||s2==='overdue'?`<button class="btn sm accent" data-act="inv-paid" data-e="${esc(e.id)}" data-i="${esc(i.id)}">Mark paid</button>`:''}${s2==='overdue'?`<button class="btn sm ghost" data-act="inv-remind" data-e="${esc(e.id)}" data-i="${esc(i.id)}">Remind</button>`:''}</span></div>`; }).join('')}</div>` : '<div class="empty small">The deposit invoice is created when the client reaches Contracted.</div>'}
      <div style="margin-top:6px"><button class="btn sm ghost" data-act="inv-add" data-e="${esc(e.id)}">+ Invoice</button></div></div>
    ${clientTimeline(e)}
    <div><div class="spread" style="margin-bottom:8px"><h3>Messages</h3><button class="btn sm" data-act="client-report" data-id="${esc(e.id)}">Draft client status update</button></div>
      ${msgs.length ? msgs.map(m=>`<div class="small" style="padding:4px 0;border-bottom:1px solid var(--line)"><b>${m.status==='sent'?'Sent':'Draft'}</b> · ${esc(laneName(m.lane))} · ${esc(m.subj)}</div>`).join('') : '<div class="empty">None yet.</div>'}
      ${msgs.some(m=>m.status==='draft') ? '<p style="margin-top:8px"><a href="#outbox" data-act="close-drawer">Open the Outbox to send drafts</a></p>' : ''}</div>
    ${retroBlock(e)}
    <div><h3 style="margin-bottom:10px">Timeline</h3><div class="log">${log.map(l=>`<div data-k="${esc(l.k==='block'?'stage':l.k)}"><time>${fmtWhen(l.at)}</time>${esc(l.t)}</div>`).join('') || '<div>No activity yet.</div>'}</div></div>
    <div class="row" style="justify-content:space-between;border-top:1px solid var(--line);padding-top:14px">
      ${e.outcome==='lost' ? `<button class="btn ghost" data-act="reopen" data-id="${esc(e.id)}">Reopen</button>` : `<span class="row" style="gap:6px"><select id="lost-reason" aria-label="Why it was lost">${LOST_REASONS.map(r=>`<option>${r}</option>`).join('')}</select><button class="btn ghost danger" data-act="lost" data-id="${esc(e.id)}">Mark lost</button><button class="btn ghost" data-act="archive" data-id="${esc(e.id)}">${e.archived?'Restore':'Archive'}</button></span>`}
      <button class="btn ghost danger" data-act="delete" data-id="${esc(e.id)}">Delete</button>
    </div>`;
}
function openDrawer(id){ S.drawer=id; renderDrawer(); $('#drawer').classList.add('on'); $('#scrim').classList.add('on'); }
function closeDrawer(){ S.drawer=null; $('#drawer').classList.remove('on'); $('#scrim').classList.remove('on'); }

/* ---------- task dialog ---------- */
function openTask(id){ S.taskOpen = id; renderTask(); const d=$('#taskDlg'); if(!d.open) d.showModal(); }
function renderTask(){
  const id = S.taskOpen; const body = $('#taskBody');
  const opts = (sel) => `<option value="">Team queue (unassigned)</option>${team().map(m=>`<option value="${m.id}" ${m.id===sel?'selected':''}>${esc(m.name)}</option>`).join('')}`;
  const engOpts = sel => `<option value="">No client</option>${activeEng().map(e=>`<option value="${e.id}" ${e.id===sel?'selected':''}>${esc(e.org)}</option>`).join('')}`;
  if(id==='new'){
    body.innerHTML = `<form id="newTask" class="form"><h2 style="grid-column:1/-1">New task</h2>
      <label class="full">What needs doing<input id="nt-title" required></label>
      <label>Owner<select id="nt-owner">${opts(S.me||'')}</select></label>
      <label>Due<input id="nt-due" type="date" value="${today()}"></label>
      <label>Planned hours<input id="nt-est" type="number" min="0" step="0.25" placeholder="e.g. 1.5"></label>
      <label class="full">Client<select id="nt-eng">${engOpts(S.newTaskEng||'')}</select></label>
      <div class="row" style="grid-column:1/-1;justify-content:flex-end"><button type="button" class="btn ghost" data-act="close-dlg" data-dlg="taskDlg">Cancel</button><button class="btn primary" type="submit">Create and notify owner</button></div></form>`;
    return;
  }
  const t = S.tasks[id]; if(!t){ $('#taskDlg').close(); return; }
  const s = st(t); const e = t.eng && S.engagements[t.eng];
  const moves = {unassigned:[], assigned:['seen','in_progress'], seen:['in_progress','blocked'], in_progress:['review','done','blocked'], blocked:['in_progress'], review:['done','in_progress'], done:['in_progress']}[s] || [];
  const label = {seen:'Got it', in_progress: s==='blocked'?'Unblock':s==='review'?'Send back':s==='done'?'Reopen':'Start', blocked:'Flag blocked', review:'Send for review', done: s==='review'?'Approve':'Mark done'};
  body.innerHTML = `
    <div class="spread"><div><p class="eyebrow">${e?esc(e.org)+' · ':''}${t.stage?esc(stageName(t.stage))+' stage':'Task'}</p><h2>${esc(t.title)}</h2></div><button class="btn ghost" data-act="close-dlg" data-dlg="taskDlg" aria-label="Close">✕</button></div>
    <div class="row">${stPill(s)}<span class="due ${lateCls(t)}">${dueLabel(t)}</span>${t.seenAt?`<span class="small muted">Seen ${fmtWhen(t.seenAt)}</span>`:''}</div>
    <div class="form">
      <label>Owner<select id="td-owner" data-td="owner" data-id="${esc(t.id)}">${opts(t.owner||'')}</select></label>
      <label>Due<input id="td-due" type="date" data-td="due" data-id="${esc(t.id)}" value="${esc(t.due)}"></label>
      ${fnFields(t)}
      <label>Repeats<select id="td-repeat" data-td="repeat" data-id="${esc(t.id)}"><option value="">Does not repeat</option>${['weekly','biweekly','monthly'].map(r=>`<option value="${r}" ${t.repeat===r?'selected':''}>${r[0].toUpperCase()+r.slice(1)}</option>`).join('')}</select></label>
      <label>Waits for<select id="td-dep" data-td="dep" data-id="${esc(t.id)}"><option value="">Add a task it waits for…</option>${list('tasks').filter(x=>x.id!==t.id && isOpen(x) && (!t.eng || x.eng===t.eng) && !(t.needs||[]).includes(x.id)).slice(0,60).map(x=>`<option value="${x.id}">${esc(x.title.slice(0,70))}</option>`).join('')}</select></label>
      <label class="full">Note (required when flagging blocked)<input id="td-note" placeholder="e.g. Waiting on 990 from client"></label>
    </div>
    ${depsOf(t).length ? `<div class="small" style="display:grid;gap:4px">${depsOf(t).map(x=>`<div class="row" style="justify-content:space-between"><span>${isOpen(x)?'⏳ Waiting on':'✓ Done:'} ${esc(x.title)} ${x.owner?`(${esc(first(x.owner))})`:''}</span><button class="btn sm ghost" data-act="dep-del" data-id="${esc(t.id)}" data-dep="${esc(x.id)}" aria-label="Remove dependency">✕</button></div>`).join('')}</div>` : ''}
    ${typeof pmTaskBlock==='function' ? pmTaskBlock(t) : ''}
    <div class="row">${moves.map(m=>`<button class="btn ${m==='done'?'accent':m==='blocked'?'danger':'primary'}" data-act="tstat-note" data-id="${esc(t.id)}" data-to="${m}">${label[m]}</button>`).join('')}
      ${s==='unassigned' && S.me ? `<button class="btn primary" data-act="tstat" data-id="${esc(t.id)}" data-to="take">Take it</button>` : ''}
      <button class="btn ghost danger" data-act="del-task" data-id="${esc(t.id)}" style="margin-left:auto">Delete</button></div>
    <div class="panel" style="padding:12px;display:grid;gap:8px"><div class="spread"><h3>Checklist</h3><span class="small muted">${(t.checklist||[]).filter(c=>c.done).length}/${(t.checklist||[]).length}</span></div>
      ${(t.checklist||[]).map((c,i)=>`<div class="row" style="justify-content:space-between"><label class="switch"><input type="checkbox" id="cl-${i}" data-cl="${i}" data-id="${esc(t.id)}" ${c.done?'checked':''}>${esc(c.t)}</label><button class="btn sm ghost" data-act="cl-del" data-id="${esc(t.id)}" data-i="${i}" aria-label="Remove item">✕</button></div>`).join('')}
      <form class="row" id="clForm" data-id="${esc(t.id)}"><input id="cl-new" placeholder="Add a step" style="flex:1;min-width:0;border:1px solid var(--line);border-radius:8px;padding:6px 8px;background:var(--bg)"><button class="btn sm" type="submit">Add</button></form></div>
    <div class="panel" style="padding:12px;display:grid;gap:8px"><h3>Comments</h3>
      ${(t.comments||[]).map(c=>`<div class="small" style="border-bottom:1px solid var(--line);padding-bottom:6px">${av(c.by)} <b>${esc(mname(c.by))}</b> <span class="muted">${fmtWhen(c.at)}</span><div style="margin-top:3px">${esc(c.text).replace(/@(\w+)/g,'<b style="color:var(--navy)">@$1</b>')}</div></div>`).join('') || '<div class="small muted">No comments yet. Type @ and a first name to notify someone.</div>'}
      <form class="row" id="cmForm" data-id="${esc(t.id)}"><input id="cm-new" placeholder="Comment… (@${esc(team().filter(m=>m.id!==S.me).map(m=>first(m.id))[0]||'Name')} to notify)" style="flex:1;min-width:0;border:1px solid var(--line);border-radius:8px;padding:6px 8px;background:var(--bg)"><button class="btn sm primary" type="submit">Post</button></form></div>
    <div class="panel" style="padding:12px;display:grid;gap:8px"><h3>Links</h3>
      ${(t.links||[]).map((l,i)=>`<div class="row" style="justify-content:space-between"><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label||l.url)}</a><button class="btn sm ghost" data-act="link-del" data-id="${esc(t.id)}" data-i="${i}" aria-label="Remove link">✕</button></div>`).join('') || '<div class="small muted">Link the Drive folder, the proposal doc, or the Console scorecard.</div>'}
      <form class="row" id="lkForm" data-id="${esc(t.id)}"><input id="lk-label" placeholder="Label" style="width:120px;border:1px solid var(--line);border-radius:8px;padding:6px 8px;background:var(--bg)"><input id="lk-url" type="url" placeholder="https://…" style="flex:1;min-width:140px;border:1px solid var(--line);border-radius:8px;padding:6px 8px;background:var(--bg)"><button class="btn sm" type="submit">Add</button></form></div>
    <div class="panel" style="padding:12px;display:grid;gap:8px"><div class="spread"><h3>Time</h3><span class="num small">${fmtH(hrs(t))} logged${+t.est?` · ${fmtH(+t.est)} planned`:''}${S.canCoach&&loggedMin(t)?` · ${money(taskCost(t))}`:''}</span></div>
      <div class="row">${t.timerStart ? `<button class="btn" data-act="timer-stop" data-id="${esc(t.id)}">■ Stop timer (${fmtH(hrs(t))})</button>` : `<button class="btn" data-act="timer-start" data-id="${esc(t.id)}">▶ Start timer</button>`}
        <input id="tl-h" type="number" min="0" step="0.25" placeholder="Hours" style="width:90px;border:1px solid var(--line);border-radius:8px;padding:6px 8px;background:var(--bg)" aria-label="Hours to log">
        <button class="btn" data-act="log-time" data-id="${esc(t.id)}">Log time</button>
        <label class="small muted" style="display:flex;gap:6px;align-items:center;margin-left:auto">Planned h<input id="td-est" type="number" min="0" step="0.25" data-td="est" data-id="${esc(t.id)}" value="${+t.est||''}" style="width:70px;border:1px solid var(--line);border-radius:8px;padding:6px 8px;background:var(--bg)"></label></div>
      ${(t.timeLog||[]).length ? `<div class="small muted">${t.timeLog.slice(-4).reverse().map(x=>`${fmtWhen(x.at)} · ${esc(first(x.by||t.owner))} · ${fmtH(x.min/60)}${x.src==='timer'?' (timer)':''}`).join('<br>')}</div>` : ''}
      ${blockedH(t) ? `<div class="small" style="color:var(--bad)">Blocked for ${fmtH(blockedH(t))} in total</div>` : ''}</div>
    <div><h3 style="margin-bottom:10px">Status trail</h3><div class="hist">${(t.history||[]).slice().reverse().map(h=>`<div><time>${fmtWhen(h.at)}</time><b>${esc(h.by?mname(h.by):'System')}</b> → ${stPill(h.to)}${h.note?` <span class="small">${esc(h.note)}</span>`:''}</div>`).join('') || '<div>No history.</div>'}</div></div>`;
}

/* ---------- event dialog ---------- */
function openEvent(id, date, pre){
  const ev = id ? S.events[id] : {title:'', date:date||today(), start:'10:30', end:'11:00', repeat:'', type:'meeting', att:[], eng:'', ...(pre||{})};
  if(!ev) return;
  $('#evBody').innerHTML = `<form id="evForm" class="form" data-id="${esc(id||'')}"><h2 style="grid-column:1/-1">${id?'Edit event':'New event'}</h2>
    <label class="full">Title<input id="ev-title" required value="${esc(ev.title)}"></label>
    <label>Date<input id="ev-date" type="date" value="${esc(ev.date)}"></label>
    <label>Repeats<select id="ev-repeat"><option value="">Does not repeat</option><option value="weekdays" ${ev.repeat==='weekdays'?'selected':''}>Every weekday</option><option value="weekly" ${ev.repeat==='weekly'?'selected':''}>Weekly</option></select></label>
    <label>Start<input id="ev-start" type="time" value="${esc(ev.start)}"></label>
    <label>End<input id="ev-end" type="time" value="${esc(ev.end)}"></label>
    <label>Kind<select id="ev-type"><option value="meeting" ${ev.type==='meeting'?'selected':''}>Client or internal meeting</option><option value="rhythm" ${ev.type==='rhythm'?'selected':''}>Team rhythm</option><option value="deadline" ${ev.type==='deadline'?'selected':''}>Deadline</option></select></label>
    <label>Client<select id="ev-eng"><option value="">None</option>${activeEng().map(e=>`<option value="${e.id}" ${e.id===ev.eng?'selected':''}>${esc(e.org)}</option>`).join('')}</select></label>
    <fieldset class="full" style="grid-column:1/-1;border:1px solid var(--line);border-radius:8px;padding:8px 10px"><legend class="small muted">Who attends (none = everyone)</legend>
      <div class="row">${team().map(m=>`<label class="switch"><input type="checkbox" class="ev-att" id="ev-att-${esc(m.id)}" value="${esc(m.id)}" ${(ev.att||[]).includes(m.id)?'checked':''}>${esc(m.name)}</label>`).join('')}</div></fieldset>
    ${id ? `<div class="row" style="grid-column:1/-1">${(ev.gcal||{})[S.me] ? '<span class="small muted">✓ On your Google Calendar</span>' : `<button type="button" class="btn" data-act="gcal-push" data-id="${esc(id)}">Add to my Google Calendar</button><span class="small muted">${ev.createdBy===S.me?'Invites teammates who have an email on file.':'Adds it to your calendar only.'}</span>`}</div>` : ''}
    <div class="row" style="grid-column:1/-1;justify-content:space-between">${id?`<button type="button" class="btn ghost danger" data-act="del-event" data-id="${esc(id)}">Delete</button>`:'<span></span>'}
      <span class="row"><button type="button" class="btn ghost" data-act="close-dlg" data-dlg="evDlg">Cancel</button><button class="btn primary" type="submit">Save${id?'':' and notify attendees'}</button></span></div></form>`;
  $('#evDlg').showModal();
}
