/* ---------- v6: configurable workspace model + templates ---------- */
const SLOTS = ['lead','discovery','diagnostic','proposal','contracted','delivery','closeout','sustain'];
const BASE = { stages: JSON.parse(JSON.stringify(STAGES)), gates: JSON.parse(JSON.stringify(GATES)), prob: {...PROB}, offers: {...OFFERS}, lanes: LANES.map(l=>l.name) };
const BASE_LBL = {entity:'engagement', entities:'engagements', org:'Organization', contact:'Contact', value:'Fee ($)', offer:'Offer', client:'Client', orgName:'Frankly Inspired & Associates', sender:''};
let LBL = {...BASE_LBL};
let BILL = {on:true, depositLabel:'Deposit (50%)', finalLabel:'Final invoice', pct:0.5};
const cap = s => s ? s[0].toUpperCase()+s.slice(1) : s;
const T = (t,d,lane,e,n) => ({t, d, lane, e, ...(n?{n}:{})});
const M = (lane,ch,s,b) => ({lane, ch, s, b});
const R = (stage,tasks,msgs) => ({stage, on:true, tasks, msgs:msgs||[]});
const ST = (id,name,target,prob,src,gates) => ({id, name, target, prob, src, gates, gate:gates[gates.length-1]});
function templates(){
  return {
    consulting:{ id:'consulting', name:'Consulting practice', desc:'Your Frankly Inspired model: lead to diagnostic to signed engagement, delivery and retainer.',
      labels:{...BASE_LBL}, billing:{on:true, depositLabel:'Deposit (50%)', finalLabel:'Final invoice', pct:0.5},
      lanes:BASE.lanes, offers:Object.entries(BASE.offers).map(([code,name])=>({code,name})),
      stages:BASE.stages.map(s=>({...s, prob:BASE.prob[s.id], gates:BASE.gates[s.id]})), recipes:JSON.parse(JSON.stringify(DEFAULT_RECIPES)) },
    grants:{ id:'grants', name:'Grants pipeline', desc:'For a development team: prospect funders, LOI, proposal, award, implementation and reporting.',
      labels:{entity:'grant', entities:'grants', org:'Funder', contact:'Program officer', value:'Amount requested ($)', offer:'Funding type', client:'Funder'},
      billing:{on:true, depositLabel:'Award payment 1', finalLabel:'Final payment', pct:0.5},
      lanes:['Funder','Grant lead','Program team','Finance'],
      offers:[{code:'GEN',name:'General operating'},{code:'PROG',name:'Program or project'},{code:'CAP',name:'Capacity building'},{code:'CAPEX',name:'Capital'}],
      stages:[ST('lead','Prospect',14,0.05,'Research, referrals, funder databases',['Mission and geography fit confirmed','Deadline and amount noted']),
        ST('discovery','Qualify',14,0.15,'Guidelines review, program officer call',['Guidelines reviewed','Program officer contacted','Go / no-go decided']),
        ST('diagnostic','Letter of inquiry',21,0.25,'LOI or concept paper',['LOI drafted','Budget estimate ready','LOI submitted']),
        ST('proposal','Proposal',30,0.4,'Full application',['Narrative final','Budget and attachments final','Submitted before deadline']),
        ST('contracted','Awarded',7,0.95,'Award letter and agreement',['Award letter received','Agreement signed','Payment schedule recorded']),
        ST('delivery','Implementation',180,1,'Funded work underway',['Activities on track','Interim report submitted']),
        ST('closeout','Reporting',30,1,'Final report and reconciliation',['Final report submitted','Final payment received','Thank-you sent']),
        ST('sustain','Renewal',90,1,'Relationship and next cycle',['Renewal decision made'])],
      recipes:[R('lead',[T('Research {{org}}: priorities, past grants, 990',2,'associates',1.5),T('Add the {{org}} deadline to the calendar',0,'franklin',0.25)]),
        R('discovery',[T('Review {{org}} guidelines and eligibility',2,'associates',1),T('Reach out to {{first}} at {{org}}',5,'franklin',0.5)],[M('client','email','Introduction from {{sender}}','Hi {{first}},\n\nI lead development at our organization and would value a few minutes to learn whether our work fits {{org}}’s priorities this cycle.\n\nWould a short call in the next two weeks work?\n\nThank you,\n{{sender}}')]),
        R('diagnostic',[T('Draft letter of inquiry for {{org}}',7,'franklin',3),T('Prepare a budget estimate for {{org}}',7,'finance',1.5)],[M('client','email','Letter of inquiry: {{offer}}','Dear {{first}},\n\nPlease find attached our letter of inquiry for {{offer}} support. We would welcome the opportunity to submit a full proposal.\n\nWith appreciation,\n{{sender}}')]),
        R('proposal',[T('Write proposal narrative for {{org}}',14,'franklin',8),T('Prepare budget and budget justification for {{org}}',14,'finance',3),T('Gather attachments for {{org}}: 990, audit, board list',10,'associates',1.5),T('Submit the {{org}} proposal before the deadline',28,'franklin',0.5,'Write proposal narrative for {{org}}')]),
        R('contracted',[T('Record award terms and payment schedule for {{org}}',2,'finance',0.75),T('Send a thank-you to {{first}}',1,'franklin',0.25),T('Put {{org}} report due dates on the calendar',3,'associates',0.5)],[M('client','email','Thank you, {{org}}','Dear {{first}},\n\nThank you for {{org}}’s investment of {{value}}. We are grateful for the partnership and will keep you updated on progress.\n\nWith gratitude,\n{{sender}}'),M('finance','internal','Award: {{org}} {{value}}','Record the {{org}} award ({{value}}) and payment schedule. Set up restricted-fund tracking if required.')]),
        R('delivery',[T('Monthly progress check on the {{org}} grant',30,'franklin',0.5),T('Draft the {{org}} interim report',90,'associates',3)]),
        R('closeout',[T('Write the {{org}} final report',14,'franklin',5),T('Reconcile {{org}} grant spending',10,'finance',2)],[M('client','email','Final report: {{offer}}','Dear {{first}},\n\nAttached is our final report on the {{offer}} grant, including outcomes and financials. Thank you for making this work possible.\n\n{{sender}}')]),
        R('sustain',[T('Plan the renewal conversation with {{first}}',60,'franklin',1)])] },
    programs:{ id:'programs', name:'Program delivery', desc:'For program teams: inquiry, intake, assessment, enrollment, services, completion and alumni follow-up.',
      labels:{entity:'participant', entities:'participants', org:'Participant', contact:'Guardian or contact', value:'Program value ($)', offer:'Program', client:'Participant'},
      billing:{on:false, depositLabel:'Payment 1', finalLabel:'Final payment', pct:0.5},
      lanes:['Participant','Case lead','Program staff','Operations'],
      offers:[{code:'CORE',name:'Core program'},{code:'MENTOR',name:'Mentoring'},{code:'WORK',name:'Workforce'}],
      stages:[ST('lead','Inquiry',3,0.3,'Website, referral, outreach event',['Contact information captured','Eligibility screened']),
        ST('discovery','Intake',7,0.5,'Intake meeting',['Intake form complete','Consent forms signed']),
        ST('diagnostic','Assessment',7,0.6,'Baseline assessment',['Baseline assessment done','Goals identified']),
        ST('proposal','Plan',7,0.75,'Service plan',['Service plan written','Plan agreed with participant']),
        ST('contracted','Enrolled',3,0.9,'Enrollment',['Enrolled in program','Schedule confirmed']),
        ST('delivery','Services',90,1,'Sessions and support',['Attendance on track','Mid-point check-in done']),
        ST('closeout','Completion',14,1,'Outcome assessment',['Outcome assessment done','Completion recognized']),
        ST('sustain','Alumni',90,1,'Follow-up',['Follow-up contact made'])],
      recipes:[R('lead',[T('Call {{first}} back within 24 hours',1,'franklin',0.25)],[M('client','email','Thanks for your interest in {{offer}}','Hi {{first}},\n\nThank you for reaching out about {{offer}}. I would love to set up a short intake conversation. What times work this week?\n\n{{sender}}')]),
        R('discovery',[T('Complete intake for {{org}}',3,'associates',1),T('Collect signed consent forms for {{org}}',5,'associates',0.25)]),
        R('diagnostic',[T('Run the baseline assessment with {{org}}',5,'franklin',1)]),
        R('proposal',[T('Write the service plan for {{org}}',5,'franklin',1)]),
        R('contracted',[T('Add {{org}} to the program schedule',1,'associates',0.25)],[M('client','email','Welcome to {{offer}}','Hi {{first}},\n\nWelcome! Your schedule is attached. Reach out any time with questions.\n\n{{sender}}')]),
        R('delivery',[T('Mid-point check-in with {{org}}',45,'franklin',0.5)]),
        R('closeout',[T('Outcome assessment for {{org}}',7,'franklin',1),T('Prepare completion recognition for {{org}}',10,'associates',0.5)]),
        R('sustain',[T('90-day follow-up with {{org}}',90,'associates',0.25)])] },
    gifts:{ id:'gifts', name:'Major gifts', desc:'For relationship-based fundraising: identify, qualify, cultivate, solicit, steward and renew.',
      labels:{entity:'prospect', entities:'prospects', org:'Donor or household', contact:'Primary contact', value:'Ask amount ($)', offer:'Gift type', client:'Donor'},
      billing:{on:true, depositLabel:'Pledge payment 1', finalLabel:'Final pledge payment', pct:0.5},
      lanes:['Donor','Relationship manager','Development team','Gift processing'],
      offers:[{code:'ANNUAL',name:'Annual gift'},{code:'MAJOR',name:'Major gift'},{code:'PLANNED',name:'Planned gift'},{code:'CAMP',name:'Campaign gift'}],
      stages:[ST('lead','Identify',14,0.05,'Prospect research, board referrals',['Capacity researched','Connection identified']),
        ST('discovery','Qualify',21,0.15,'Qualifying visit',['Qualifying visit held','Interest confirmed']),
        ST('diagnostic','Cultivate',60,0.3,'Cultivation touches',['Two or more cultivation touches','Ask amount set']),
        ST('proposal','Solicit',21,0.5,'The ask',['Ask made','Proposal or letter sent']),
        ST('contracted','Committed',7,0.95,'Pledge or gift agreement',['Pledge or gift agreement signed','Payment schedule recorded']),
        ST('delivery','Stewardship',90,1,'Acknowledgment and impact',['Gift acknowledged within 48 hours','Impact update sent']),
        ST('closeout','Fulfilled',14,1,'Final payment and recognition',['Final payment received','Recognition delivered']),
        ST('sustain','Renewal',180,1,'Next ask',['Next ask planned'])],
      recipes:[R('lead',[T('Research {{org}}: capacity and connections',3,'associates',1)]),
        R('discovery',[T('Schedule a qualifying visit with {{first}}',7,'franklin',0.25)],[M('client','email','Coffee soon, {{first}}?','Hi {{first}},\n\nI would love to hear what draws you to our work. Could we grab coffee in the next few weeks?\n\n{{sender}}')]),
        R('diagnostic',[T('Plan two cultivation touches for {{org}}',14,'franklin',0.5),T('Set the ask amount for {{org}}',30,'franklin',0.5)]),
        R('proposal',[T('Prepare the ask for {{org}}',7,'franklin',2),T('Follow up on the ask with {{first}}',14,'franklin',0.25)]),
        R('contracted',[T('Send a thank-you to {{first}} within 48 hours',2,'franklin',0.25),T('Record the pledge schedule for {{org}}',2,'finance',0.5)],[M('client','email','Thank you, {{first}}','Dear {{first}},\n\nThank you for your generous commitment of {{value}}. Your gift will make a real difference, and I look forward to sharing its impact with you.\n\nWith gratitude,\n{{sender}}')]),
        R('delivery',[T('Send an impact update to {{first}}',60,'associates',0.5)]),
        R('closeout',[T('Deliver recognition for {{org}}',7,'associates',0.5)]),
        R('sustain',[T('Plan the renewal conversation with {{first}}',150,'franklin',0.5)])] }
  };
}
function applyModel(m){
  const base = templates().consulting; const src = m && Array.isArray(m.stages) && m.stages.length ? m : base;
  const stages = SLOTS.map(id => { const b = base.stages.find(s=>s.id===id); const x = (src.stages||[]).find(s=>s.id===id) || {}; return {...b, ...x, id}; });
  STAGES.splice(0, STAGES.length, ...stages.map(s=>({id:s.id, name:s.name, target:+s.target||1, src:s.src||'', gate:s.gate || (s.gates||[]).slice(-1)[0] || ''})));
  Object.keys(GATES).forEach(k=>delete GATES[k]); stages.forEach(s => GATES[s.id] = (s.gates||[]).filter(Boolean));
  Object.keys(PROB).forEach(k=>delete PROB[k]); stages.forEach(s => PROB[s.id] = Math.max(0, Math.min(1, +s.prob||0)));
  Object.keys(OFFERS).forEach(k=>delete OFFERS[k]); (src.offers||base.offers).forEach(o => { if(o.code) OFFERS[o.code] = o.name||o.code; });
  const ln = src.lanes || base.lanes; LANES.forEach((l,i) => { if(ln[i]) l.name = ln[i]; });
  LBL = {...BASE_LBL, ...(src.labels||{})}; BILL = {...base.billing, ...(src.billing||{})};
  const b = document.querySelector('.brand span'); if(b) b.textContent = LBL.orgName || BASE_LBL.orgName;
}
function modelFromTemplate(id, keep){
  const t = templates()[id]; if(!t) return null;
  const prev = S.model || {};
  return {template:id, fnOn: id!=='consulting', programs: prev.programs||[], funds: prev.funds||[], privacy: prev.privacy, labels:{...t.labels, orgName:(keep&&keep.orgName)||LBL.orgName, sender:(keep&&keep.sender)||LBL.sender||''}, billing:t.billing, lanes:t.lanes, offers:t.offers, stages:t.stages.map(s=>({id:s.id, name:s.name, target:s.target, prob:s.prob, src:s.src, gates:s.gates, gate:s.gate}))};
}
function applyTemplate(id){
  const t = templates()[id]; const m = modelFromTemplate(id); if(!t || !m) return;
  saveConfig('model', m); saveConfig('recipes', {list:JSON.parse(JSON.stringify(t.recipes))}); applyModel(m); S.draftModel = null; S.draftRecipes = null;
  toast(`${t.name} template applied. Stages, checklists, offers and playbooks updated.`); render();
}
function saveDraftModel(){
  const dm = S.draftModel; if(!dm) return;
  const codes = dm.offers.map(o=>o.code).filter(Boolean); if(new Set(codes).size !== codes.length || codes.length !== dm.offers.length){ toast('Each offer needs a unique code'); return; }
  if(dm.stages.some(x=>!String(x.name||'').trim())){ toast('Every stage needs a name'); return; }
  const m = JSON.parse(JSON.stringify(dm)); m.template = m.template || (S.model && S.model.template) || 'consulting';
  saveConfig('model', m); applyModel(m); S.draftModel = null; toast('Setup saved'); render();
}
const isSample = e => /^Sample:/.test((e && (e.org||e.name)) || '');
function sampleCounts(){ const se = list('engagements').filter(isSample), sm = list('team').filter(isSample); return {e:se.length, m:sm.length}; }
function clearSamples(){
  const eids = new Set(list('engagements').filter(isSample).map(e=>e.id)), mids = new Set(list('team').filter(isSample).map(m=>m.id));
  const tids = new Set(list('tasks').filter(t => eids.has(t.eng) || (t.owner && mids.has(t.owner) && !t.eng)).map(t=>t.id));
  list('tasks').forEach(t => { if(tids.has(t.id)) del('tasks', t.id); else if(t.owner && mids.has(t.owner)) put('tasks', t.id, {...t, owner:'', status: isOpen(t) ? 'unassigned' : st(t)}); });
  list('messages').filter(m => eids.has(m.eng)).forEach(m => del('messages', m.id));
  list('events').filter(ev => eids.has(ev.eng) || (ev.att||[]).some(a=>mids.has(a))).forEach(ev => del('events', ev.id));
  list('notifs').filter(n => eids.has(n.eng) || tids.has(n.task) || mids.has(n.to) || mids.has(n.by)).forEach(n => del('notifs', n.id));
  const pids = new Set(list('projects').filter(isSample).map(p=>p.id)); list('tasks').filter(t=>pids.has(t.project)).forEach(t=>del('tasks', t.id)); pids.forEach(id=>del('projects', id));
  list('goals').filter(g=>/^Sample:/.test(g.title||'')).forEach(g=>del('goals', g.id)); list('rules').filter(r=>r.cond && pids.has(r.cond.project)).forEach(r=>del('rules', r.id));
  eids.forEach(id => del('engagements', id));
  mids.forEach(id => { const k = (S.team[id]||{}).uid; if(DB && k){ Object.keys(S.pulses[k]||{}).forEach(pid => queueWrite(`pulses/${k}/${pid}`, async()=>{ await DB.doc('pulses/'+k).collection('entries').doc(pid).delete(); })); Object.keys(S.coach[k]||{}).forEach(sid => queueWrite(`coaching/${k}/${sid}`, async()=>{ await DB.doc('coaching/'+k).collection('sessions').doc(sid).delete(); })); } delete S.pulses[k]; delete S.coach[k]; del('team', id); });
  const r = {...(rcfg().rates||{})}; let ch = false; mids.forEach(id => { if(r[id]){ delete r[id]; ch = true; } }); if(ch) saveConfig('rates', {...rcfg(), rates:r});
  const lo = {...((S.settings||{}).laneOwners||{})}; Object.keys(lo).forEach(k => { if(mids.has(lo[k])) lo[k] = ''; }); saveConfig('settings', {...S.settings, laneOwners:lo});
  audit('Removed sample data', `${eids.size} items, ${mids.size} teammates`); toast(`Removed ${eids.size} sample ${eids.size===1?LBL.entity:LBL.entities}, ${mids.size} sample teammates and their tasks`); render();
}
function onboarding(){
  const real = list('team').filter(m=>!isSample(m) && !m.inactive);
  const items = [
    {t:'Run guided setup (3 minutes)', done: !!(S.model && S.model.template), act:'wizard'},
    {t:'Name your workspace and set the sender name', done: !!(S.model && S.model.labels && S.model.labels.sender), go:'setup'},
    {t:'Add your teammates', done: real.length >= 2, go:'team'},
    {t:`Add your first real ${LBL.entity}`, done: list('engagements').some(e=>!isSample(e)), go:'pipeline'},
    {t:'Clear the sample data', done: sampleCounts().e===0 && sampleCounts().m===0, go:'setup'},
    {t:'Share the hub with your team as Contributors (from its page on claude.ai)', done: !!(S.settings||{}).shared, manual:'shared'}
  ];
  return {items, done:items.filter(i=>i.done).length};
}
function onboardingCard(){
  if(!S.canCoach || (S.settings||{}).onboardDismissed) return '';
  const o = onboarding(); if(o.done===o.items.length) return '';
  return `<section class="panel" style="border-left:4px solid var(--accent);display:grid;gap:8px"><div class="spread"><h2>Get your workspace ready</h2><span class="small muted">${o.done} of ${o.items.length} done · <button class="btn sm ghost" data-act="onb-dismiss">Hide</button></span></div>
    <div class="bar2" style="margin:0"><span class="fill" style="width:${o.done/o.items.length*100}%;background:var(--accent)"></span></div>
    ${o.items.map(i=>`<div class="row" style="justify-content:space-between"><span class="small">${i.done?'✓':'○'} ${i.done?`<span class="muted">${esc(i.t)}</span>`:esc(i.t)}</span>${i.done?'':i.manual?`<button class="btn sm" data-act="onb-manual" data-k="${i.manual}">Mark done</button>`:i.act?`<button class="btn sm primary" data-act="${i.act}">Start</button>`:`<a class="btn sm" href="#${i.go}">Go</a>`}</div>`).join('')}</section>`;
}
function viewSetup(){
  const cur = (S.model && S.model.template) || 'consulting'; const tps = templates();
  if(!S.draftModel) S.draftModel = JSON.parse(JSON.stringify(S.model || modelFromTemplate(cur)));
  const dm = S.draftModel; dm.labels = dm.labels || {}; dm.offers = dm.offers || []; dm.billing = dm.billing || {...BILL};
  const sc = sampleCounts(); const owner = S.canCoach;
  const lbl = (k, l, ph) => `<label>${l}<input id="lb-${k}" data-dm="labels.${k}" value="${esc(dm.labels[k]||'')}" placeholder="${esc(ph||'')}"></label>`;
  return `<section class="spread"><div><p class="eyebrow">Setup</p><h1>Workspace setup</h1>
    <p class="muted" style="max-width:72ch">Shape the hub to the work you do: a template to start from, your stage names and exit checklists, your offers and the words people see.${owner?'':' Only the lead can change these.'}</p></div>
    ${owner?`<div class="row"><button class="btn" data-act="wizard">Guided setup</button><button class="btn ghost" data-act="dm-reset">Discard changes</button><button class="btn primary" data-act="dm-save">Save setup</button></div>`:''}</section>
  ${onboardingCard()}
  <section class="panel"><h2 style="margin-bottom:10px">1. Start from a template</h2><div class="recipes">${Object.values(tps).map(t=>`<div class="panel" style="display:grid;gap:8px;${t.id===cur?'border-color:var(--accent);box-shadow:inset 0 3px 0 var(--accent)':''}">
      <div class="spread"><h3>${esc(t.name)}</h3>${t.id===cur?'<span class="flag ok" style="margin:0">In use</span>':''}</div><p class="small muted">${esc(t.desc)}</p>
      <div class="small">${t.stages.map(s=>esc(s.name)).join(' → ')}</div>
      ${owner && t.id!==cur ? `<div><button class="btn sm" data-act="tpl-apply" data-id="${t.id}">Use this template</button></div>` : ''}</div>`).join('')}</div>
    <p class="small muted" style="margin-top:8px">Applying a template replaces stage names, checklists, offers and playbooks. Existing ${esc(LBL.entities)} keep their place, because every template uses the same 8 stage positions.</p></section>
  <section class="two">
    <div class="panel form"><h2 style="grid-column:1/-1">2. Names and labels</h2>
      ${lbl('orgName','Workspace name','Frankly Inspired & Associates')}${lbl('sender','Sender name in messages', mname(leadId()))}
      ${lbl('entity','One item is called','engagement')}${lbl('entities','Several are called','engagements')}
      ${lbl('org','Name field','Organization')}${lbl('contact','Contact field','Contact')}
      ${lbl('value','Value field','Fee ($)')}${lbl('offer','Offer field','Offer')}
      <label class="switch full" style="grid-column:1/-1"><input type="checkbox" id="dm-bill" data-dm="billing.on" ${dm.billing.on!==false?'checked':''}>Track payments and invoices</label>
      <label>First payment label<input id="dm-dl" data-dm="billing.depositLabel" value="${esc(dm.billing.depositLabel||'')}"></label>
      <label>Final payment label<input id="dm-fl" data-dm="billing.finalLabel" value="${esc(dm.billing.finalLabel||'')}"></label>
      <label>First payment share (%)<input id="dm-pct" type="number" min="0" max="100" data-dm="billing.pct" value="${Math.round((dm.billing.pct??0.5)*100)}"></label>
    </div>
    <div class="panel" style="display:grid;gap:8px"><h2>3. Offers</h2><p class="small muted">What you sell or run. Shown on each ${esc(LBL.entity)} and used to compare margins.</p>
      ${dm.offers.map((o,i)=>`<div class="row" style="flex-wrap:nowrap"><input id="of-c-${i}" data-of="${i}" data-k="code" value="${esc(o.code)}" style="width:90px;border:1px solid var(--line);border-radius:6px;padding:5px 7px;background:var(--bg)" aria-label="Code"><input id="of-n-${i}" data-of="${i}" data-k="name" value="${esc(o.name)}" style="flex:1;min-width:0;border:1px solid var(--line);border-radius:6px;padding:5px 7px;background:var(--bg)" aria-label="Name"><button class="btn sm ghost danger" data-act="of-del" data-i="${i}" aria-label="Remove offer">✕</button></div>`).join('')}
      <div><button class="btn sm" data-act="of-add">+ Offer</button></div>
      <h2 style="margin-top:10px">4. Roles</h2><p class="small muted">The four lanes in playbooks and the who-hears-what map.</p>
      ${(dm.lanes||LANES.map(l=>l.name)).map((n,i)=>`<label class="small">${['Outside party','Lead','Team','Finance'][i]}<input id="ln-${i}" data-ln="${i}" value="${esc(n)}" style="width:100%;border:1px solid var(--line);border-radius:6px;padding:5px 7px;background:var(--bg)"></label>`).join('')}
    </div>
  </section>
  <section class="panel"><h2 style="margin-bottom:4px">5. Stages and exit checklists</h2><p class="small muted" style="margin-bottom:10px">Rename each stage, set its target days and chance to close, and list what must be true before an item moves on (one per line).</p>
    <div class="recipes">${(dm.stages||[]).map((s,i)=>`<div class="panel" style="display:grid;gap:6px;padding:12px">
      <div class="row" style="flex-wrap:nowrap"><span class="num small muted">${i+1}</span><input id="sg-n-${i}" data-sg="${i}" data-k="name" value="${esc(s.name)}" style="flex:1;min-width:0;font-weight:600;border:1px solid var(--line);border-radius:6px;padding:5px 7px;background:var(--bg)" aria-label="Stage name"></div>
      <div class="row small"><label>Target days <input id="sg-t-${i}" type="number" min="1" data-sg="${i}" data-k="target" value="${+s.target||1}" style="width:64px;border:1px solid var(--line);border-radius:6px;padding:4px 6px;background:var(--bg)"></label><label>Chance % <input id="sg-p-${i}" type="number" min="0" max="100" data-sg="${i}" data-k="prob" value="${Math.round((+s.prob||0)*100)}" style="width:64px;border:1px solid var(--line);border-radius:6px;padding:4px 6px;background:var(--bg)"></label></div>
      <label class="small muted">Comes from<input id="sg-s-${i}" data-sg="${i}" data-k="src" value="${esc(s.src||'')}" style="width:100%;border:1px solid var(--line);border-radius:6px;padding:4px 6px;background:var(--bg)"></label>
      <label class="small muted">Exit checklist<textarea id="sg-g-${i}" data-sg="${i}" data-k="gates" style="width:100%;min-height:70px;border:1px solid var(--line);border-radius:6px;padding:6px;background:var(--bg);font-size:13px">${esc((s.gates||[]).join('\n'))}</textarea></label></div>`).join('')}</div>
    <p class="small muted" style="margin-top:8px">Stages 5–7 drive billing and win rates: stage 5 counts as won and creates the first payment, stage 7 creates the final payment and asks the team for a retro.</p></section>
  <section class="panel form"><h2 style="grid-column:1/-1">6. Nonprofit cost tracking</h2>
    <label class="switch full" style="grid-column:1/-1"><input type="checkbox" id="dm-fn" data-dmt="fnOn" ${dm.fnOn?'checked':''}>Tag time by function (program, management and general, fundraising) for Form 990 and grant reports</label>
    <label>Programs (one per line)<textarea id="dm-prog" data-dml="programs" placeholder="Youth tech&#10;Workforce readiness">${esc((dm.programs||[]).join('\n'))}</textarea></label>
    <label>Funding sources (one per line)<textarea id="dm-fund" data-dml="funds" placeholder="Kresge 2026 program grant&#10;General operating">${esc((dm.funds||[]).join('\n'))}</textarea></label></section>
  <section class="panel" style="display:grid;gap:8px"><h2>7. Sample data</h2>
    ${sc.e||sc.m ? `<p class="small">There are ${sc.e} sample ${esc(LBL.entities)} and ${sc.m} sample teammates (names start with “Sample:”). Removing them also removes their tasks, messages, alerts, check-ins and 1:1 notes. Team rhythms on the calendar stay.</p>${owner?`<div><button class="btn danger" data-act="clear-samples">Remove all sample data</button></div>`:''}` : '<p class="small muted">No sample data left. Everything here is real.</p>'}</section>
  <section class="row"><a class="btn" href="#playbooks">Edit playbooks for each stage</a></section>`;
}

/* ---------- v7: functional expense allocation ---------- */
const FNS = [['program','Program services'],['mgmt','Management & general'],['fund','Fundraising']];
const fnName = k => (FNS.find(f=>f[0]===k)||[,'Not tagged'])[1];
const fnOn = () => !!(S.model && S.model.fnOn);
const programsList = () => (S.model && Array.isArray(S.model.programs) ? S.model.programs : []).filter(Boolean);
const fundsList = () => (S.model && Array.isArray(S.model.funds) ? S.model.funds : []).filter(Boolean);
function defaultFn(lane, tpl){ const t = (S.model && S.model.template) || 'consulting'; if(lane==='finance') return 'mgmt'; if(t==='grants' || t==='gifts') return 'fund'; if(t==='programs') return 'program'; return ''; }
function fnData(sinceDays){
  const since = sinceDays ? addDays(today(), -sinceDays) : '0000-00-00';
  const rows = []; list('tasks').forEach(t => (t.timeLog||[]).forEach(x => { if((x.at||'').slice(0,10) < since) return; const by = x.by||t.owner; const h = (+x.min||0)/60; rows.push({t, by, h, c:h*rateOf(by), fn:t.fn||'', prog:t.prog||'', fund:t.fund||'', month:(x.at||'').slice(0,7)}); }));
  const sum = (xs, k) => xs.reduce((a,r)=>a+r[k],0);
  const byFn = FNS.map(([k,n]) => { const xs = rows.filter(r=>r.fn===k); return {k, n, h:sum(xs,'h'), c:sum(xs,'c')}; });
  const un = rows.filter(r=>!r.fn); const totalH = sum(rows,'h'), totalC = sum(rows,'c');
  const group = key => { const m = {}; rows.forEach(r => { const k = r[key] || ''; if(!k) return; (m[k] = m[k] || {k, h:0, c:0, people:{}}); m[k].h += r.h; m[k].c += r.c; m[k].people[r.by] = (m[k].people[r.by]||0) + r.h; }); return Object.values(m).sort((a,b)=>b.c-a.c); };
  return {rows, byFn, unH:sum(un,'h'), unC:sum(un,'c'), unTasks:new Set(un.map(r=>r.t.id)).size, totalH, totalC, byProg:group('prog'), byFund:group('fund')};
}
function fnPanel(){
  if(!fnOn()) return '';
  const d = fnData(S.insWin); const seeMoney = S.canCoach; const tagged = d.totalH - d.unH;
  const colors = {program:'var(--ok)', mgmt:'var(--navy)', fund:'var(--accent)'};
  const bar = `<div class="bar2" style="height:14px;display:flex;overflow:hidden">${d.byFn.map(f=>`<span style="position:static;display:block;height:100%;width:${tagged?f.h/tagged*100:0}%;background:${colors[f.k]}" title="${esc(f.n)}"></span>`).join('')}</div>`;
  const tbl = (title, xs, empty) => `<div><h3 style="margin:12px 0 6px">${title}</h3>${xs.length ? `<table class="def"><thead><tr><th>Name</th><th>Hours</th>${seeMoney?'<th>Labor cost</th>':''}<th>Who</th></tr></thead><tbody>${xs.map(x=>`<tr><td>${esc(x.k)}</td><td class="v">${fmtH(x.h)}</td>${seeMoney?`<td class="v">${money(x.c)}</td>`:''}<td class="small">${Object.entries(x.people).map(([p,h])=>`${esc(first(p))} ${fmtH(h)}`).join(', ')}</td></tr>`).join('')}</tbody></table>` : `<p class="small muted">${empty}</p>`}</div>`;
  return `<section class="panel"><div class="spread" style="margin-bottom:8px"><div><h2>Functional expenses (staff time)</h2><p class="small muted">Logged hours split into the three functions on IRS Form 990 Part IX. Labor only. Add non-labor costs in your accounting system.</p></div>
    <div class="row"><button class="btn sm" data-act="export-fn">Export allocation (CSV)</button><button class="btn sm" data-act="export-grant">Grant cost report (CSV)</button></div></div>
    ${bar}
    <div class="row" style="gap:18px;margin-top:8px">${d.byFn.map(f=>`<span class="small"><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${colors[f.k]};margin-right:5px"></i><b>${esc(f.n)}</b> ${tagged?pct(f.h/tagged):'–'} · ${fmtH(f.h)}${seeMoney?` · ${money(f.c)}`:''}</span>`).join('')}</div>
    ${d.unH ? `<p class="small" style="margin-top:8px;color:var(--warn)">${fmtH(d.unH)} across ${d.unTasks} task${d.unTasks===1?'':'s'} isn’t tagged yet. <a href="#board" data-act="fn-untagged">Tag them in the list view</a>.</p>` : ''}
    <div class="two" style="gap:16px">${tbl('By program', d.byProg, 'Tag tasks with a program (add program names in Setup) to see this.')}${tbl('By funding source', d.byFund, 'Tag tasks with a funding source (add sources in Setup) to see grant-level costs.')}</div></section>`;
}
function exportFn(){
  const d = fnData(S.insWin); const rows = [['Month','Person','Function','Program','Funding source','Task','Hours',...(S.canCoach?['Labor cost ($)']:[])]];
  d.rows.sort((a,b)=>a.month.localeCompare(b.month)).forEach(r => rows.push([r.month, mname(r.by), fnName(r.fn), r.prog, r.fund, r.t.title, +r.h.toFixed(2), ...(S.canCoach?[Math.round(r.c)]:[])]));
  saveFile(`functional-expense-allocation-${today()}.csv`, toCsv(rows));
}
function exportGrant(){
  const d = fnData(0); const rows = [['Funding source','Month','Person','Function','Task','Hours',...(S.canCoach?['Labor cost ($)']:[])]];
  d.rows.filter(r=>r.fund).sort((a,b)=>a.fund.localeCompare(b.fund) || a.month.localeCompare(b.month)).forEach(r => rows.push([r.fund, r.month, mname(r.by), fnName(r.fn), r.t.title, +r.h.toFixed(2), ...(S.canCoach?[Math.round(r.c)]:[])]));
  if(rows.length===1){ toast('No time is tagged to a funding source yet'); return; }
  saveFile(`grant-cost-report-${today()}.csv`, toCsv(rows));
}
function fnFields(t){
  if(!fnOn()) return '';
  return `<label>Function<select id="td-fn" data-td="fn" data-id="${esc(t.id)}"><option value="">Not tagged</option>${FNS.map(([k,n])=>`<option value="${k}" ${t.fn===k?'selected':''}>${n}</option>`).join('')}</select></label>
    <label>Program<select id="td-prog" data-td="prog" data-id="${esc(t.id)}"><option value="">None</option>${programsList().map(p=>`<option ${t.prog===p?'selected':''}>${esc(p)}</option>`).join('')}</select></label>
    <label class="full">Funding source<select id="td-fund" data-td="fund" data-id="${esc(t.id)}"><option value="">None</option>${fundsList().map(p=>`<option ${t.fund===p?'selected':''}>${esc(p)}</option>`).join('')}</select></label>`;
}

/* ---------- v7: privacy center ---------- */
const PRIV_DEFAULT = {checkins:true, taskPulse:true, retros:true, anon:true, coaching:true, alertDays:90, pulseMonths:12};
const priv = () => ({...PRIV_DEFAULT, ...((S.model && S.model.privacy) || {})});
function savePrivacy(patch){ const m = {...(S.model || modelFromTemplate((S.model && S.model.template) || 'consulting')), privacy:{...priv(), ...patch}}; saveConfig('model', m); applyModel(m); render(); }
function viewPrivacy(){
  const p = priv(); const owner = S.canCoach;
  const sw = (k, l, d) => `<label class="switch" style="align-items:flex-start"><input type="checkbox" id="pv-${k}" data-pv="${k}" ${p[k]?'checked':''} ${owner?'':'disabled'}><span><b>${l}</b><br><span class="small muted">${d}</span></span></label>`;
  const who = [['Clients, tasks, calendar, messages, invoices','Everyone on the team who has Contributor access or higher'],
    ['Hourly rates and labor costs','The lead only (the owner and Editors)'],
    ['Your daily check-ins, task pulses and retros','You, and your coach (the owner and Editors). Never teammates.'],
    ['Anonymous check-ins','No name is attached. The coach only sees a team average once 3 or more are in. Teammates could technically read the raw rows, so treat these as low-sensitivity.'],
    ['1:1 notes','You and your coach'],
    ['Your Google Calendar events','Only you, on your own screen. They aren’t stored in the hub.'],
    ['Emails sent from the hub','They go from the sender’s own Gmail, which keeps its own copy']];
  const notice = `How we use the Flow Hub check-ins\n\nWhy: to notice early when the work feels heavy and get you support. Not to evaluate you.\n\nWhat: a daily 1–5 energy score, a workload rating, an optional note, quick 1–5 pulses when you finish or get stuck on a task, and a short retro when a project closes.\n\nWho sees it: you and your coach. Never your teammates. You can check in anonymously; anonymous answers only count toward a team average once three or more come in.\n\nWhat it is never used for: pay, ratings, performance reviews, or discipline. Work data (tasks, hours) is kept on a separate screen and never uses your check-in answers.\n\nIt is optional. Skipping a day carries no consequence. Asking for support gets a human reply within one working day.\n\nRetention: check-ins are deleted after ${p.pulseMonths} months. Ask your coach anytime to see or delete your data.`;
  return `<section class="spread"><div><p class="eyebrow">Setup</p><h1>Privacy and data</h1><p class="muted" style="max-width:72ch">What the hub collects, who can see it, how long it is kept, and how to take it with you.${owner?'':' Only the lead can change these settings.'}</p></div></section>
  <section class="two">
    <div class="panel" style="display:grid;gap:12px"><h2>People features</h2>
      ${sw('checkins','Daily check-ins','The 20-second energy and workload check on My day.')}
      ${sw('taskPulse','Task pulses','A quick 1–5 when someone marks their task done or blocked.')}
      ${sw('retros','Retros','A short reflection when a client reaches the closing stage.')}
      ${sw('anon','Anonymous check-ins','Lets people check in with no name attached.')}
      ${sw('coaching','Coaching notes and 1:1s','GROW notes shared between a person and their coach.')}
      <p class="small muted">Turning a feature off hides it for everyone and stops new data. It doesn’t delete what was already collected. Use the retention tools for that.</p></div>
    <div class="panel"><h2 style="margin-bottom:8px">Who sees what</h2><table class="def"><tbody>${who.map(([a,b])=>`<tr><td><b>${esc(a)}</b></td><td class="small">${esc(b)}</td></tr>`).join('')}</tbody></table></div>
  </section>
  <section class="two">
    <div class="panel" style="display:grid;gap:10px"><h2>Retention</h2>
      <label class="small">Delete read alerts older than <input id="pv-ad" type="number" min="7" data-pv-n="alertDays" value="${p.alertDays}" ${owner?'':'disabled'} style="width:70px;border:1px solid var(--line);border-radius:6px;padding:4px 6px;background:var(--bg)"> days</label>
      <label class="small">Delete check-ins older than <input id="pv-pm" type="number" min="1" data-pv-n="pulseMonths" value="${p.pulseMonths}" ${owner?'':'disabled'} style="width:70px;border:1px solid var(--line);border-radius:6px;padding:4px 6px;background:var(--bg)"> months</label>
      ${owner?`<div class="row"><button class="btn" data-act="retain-run">Apply retention now</button></div>`:''}</div>
    <div class="panel" style="display:grid;gap:10px"><h2>Backup and restore</h2>
      <p class="small muted">A backup is one JSON file with every client, task, message, event, team record, alert and setting you can see.${owner?' Rates and check-ins are included for the lead.':''}</p>
      <div class="row"><button class="btn primary" data-act="backup">Download backup</button>${owner?`<label class="btn" for="restore-file">Restore from a backup…</label><input id="restore-file" type="file" accept="application/json,.json" hidden>`:''}</div>
      <div id="restore-preview"></div></div>
  </section>
  ${auditPanel()}
  <section class="panel" style="display:grid;gap:8px"><div class="spread"><h2>Staff notice</h2><button class="btn sm" data-act="copy-notice">Copy</button></div><p class="small muted">Share this with your team before turning on check-ins.</p>
    <pre id="notice-text" style="white-space:pre-wrap;font:13.5px/1.55 var(--f-body);background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:12px;margin:0">${esc(notice)}</pre></section>`;
}
function runRetention(){
  const p = priv(); const cutA = addDays(today(), -p.alertDays); let nA = 0, nP = 0;
  list('notifs').filter(n => n.read && (n.at||'').slice(0,10) < cutA).forEach(n => { del('notifs', n.id); nA++; });
  const cutP = (() => { const d = new Date(today()+'T12:00:00'); d.setMonth(d.getMonth()-p.pulseMonths); return iso(d); })();
  Object.entries(S.pulses).forEach(([k, m]) => Object.values(m||{}).forEach(x => { if((x.date||'') < cutP){ delete S.pulses[k][x.id]; nP++; if(DB) queueWrite(`pulses/${k}/${x.id}`, async()=>{ await DB.doc('pulses/'+k).collection('entries').doc(x.id).delete(); }); } }));
  list('anon').filter(a => (a.date||'') < cutP).forEach(a => { delete S.anon[a.id]; nP++; if(DB) queueWrite('anon/'+a.id, async()=>{ await DB.collection('anon').doc(a.id).delete(); }); });
  if(!DB) saveLocal();
  audit('Applied retention', `${nA} alerts, ${nP} check-ins`); toast(`Removed ${nA} old alert${nA===1?'':'s'} and ${nP} old check-in${nP===1?'':'s'}`); render();
}
function backupData(){
  const out = {format:'flow-hub-backup', version:7, exported:nowISO(), workspace:LBL.orgName};
  COLS.forEach(c => out[c] = S[c]);
  out.config = {recipes:S.recipes, settings:S.settings, model:S.model, ...(S.canCoach ? {rates:S.rates} : {})};
  if(S.canCoach){ out.pulses = S.pulses; out.coach = S.coach; }
  return out;
}
function doBackup(){ saveFile(`flow-hub-backup-${today()}.json`, JSON.stringify(backupData(), null, 1), 'application/json'); }
let restoreData = null;
function previewRestore(file){
  const box = $('#restore-preview'); if(!file || !box) return;
  const r = new FileReader();
  r.onload = () => { try{ const d = JSON.parse(r.result); if(d.format!=='flow-hub-backup') throw new Error('not a Flow Hub backup');
      restoreData = d; const n = COLS.map(c => `${Object.keys(d[c]||{}).length} ${c}`).join(', ');
      box.innerHTML = `<div class="rec mid"><span class="num">!</span><div><b>Backup from ${esc(fmtWhen(d.exported))}${d.workspace?` (${esc(d.workspace)})`:''}</b><div class="small">${esc(n)}. Restoring adds or overwrites these records. It doesn’t delete records that aren’t in the backup.</div><div><button class="btn sm danger" data-act="restore-go">Restore these records</button></div></div></div>`;
    }catch(e){ restoreData = null; box.innerHTML = `<p class="small" style="color:var(--bad)">That file isn’t a Flow Hub backup.</p>`; } };
  r.readAsText(file);
}
function doRestore(){
  const d = restoreData; if(!d) return; let n = 0;
  COLS.forEach(c => Object.entries(d[c]||{}).forEach(([id, doc]) => { if(doc && typeof doc==='object'){ put(c, id, strip(doc)); n++; } }));
  const cf = d.config || {}; if(cf.recipes) saveConfig('recipes', {list:cf.recipes}); if(cf.settings) saveConfig('settings', cf.settings); if(cf.model){ saveConfig('model', cf.model); applyModel(cf.model); } if(cf.rates && S.canCoach) saveConfig('rates', cf.rates);
  audit('Restored from backup', `${n} records from ${d.exported||'unknown date'}`); restoreData = null; toast(`Restored ${n} records`); render();
}

/* ---------- v7: in-app help ---------- */
const HELP = {
  today:['Your day starts here: anything waiting for your OK, what you’re doing, items to review, alerts and today’s calendar.','Tap “Got it” on new assignments so whoever assigned it knows you’ve seen it.','The check-in takes 20 seconds. Only you and your coach see it.'],
  pipeline:['Each item sits in one stage. The ▶ button moves it forward and runs that stage’s playbook once: tasks go to their owners and drafts go to the Outbox.','An item can’t leave a stage until its exit checklist is done. A second click overrides that, and the override is logged.','Switch to Timeline to see how long each item spent in every stage.'],
  revenue:['The weighted pipeline is each open item’s value times its stage’s chance to close. Change those chances in Setup.','Invoices are created automatically at the won stage and the closing stage. Mark them sent and paid here.'],
  outbox:['Playbooks write these drafts for you. Edit, send from your Gmail (or copy), then mark sent so it lands on the timeline.'],
  board:['One column per person. Drag a card onto someone to hand it to them.','Switch to List to search, filter, sort and export.'],
  calendar:['Team rhythms, meetings and every due date in one week.','“Show my Google Calendar” shows your own events on your screen only.'],
  coaching:['Wellbeing and Work are deliberately separate views. Check-in answers never feed the Work view.','Plan 1:1 builds an agenda from the last two weeks and turns commitments into tasks.'],
  team:['Add people, set their weekly hours and, for the lead, their hourly cost.','Share the hub from its claude.ai page as Contributor so people can update their tasks.'],
  insights:['Every finding shows how much data it rests on. Treat “Early signal” as a hypothesis.','“Refine the model” updates playbook estimates from real time logged.'],
  setup:['Start from a template, then rename stages, edit exit checklists, offers and labels.','Remove the sample data when you’re ready to go live.'],
  playbooks:['Each stage’s playbook creates tasks (with owners, due dates, planned hours and what they wait for) and message drafts when an item enters that stage.'],
  health:['Shows whether the hub is working: who uses it, which features get used, and what people say.','Update pilots and paying organizations by hand as they happen; the evidence score follows.'],
  privacy:['Turn people features on or off, see who can see what, set retention, and back up or restore everything.']
};
function openHelp(){
  const items = HELP[S.view] || HELP.today;
  $('#helpBody').innerHTML = `<div class="spread"><h2>How this page works</h2><button class="btn ghost" data-act="close-dlg" data-dlg="helpDlg" aria-label="Close">✕</button></div>
    <ul class="agenda" style="font-size:14.5px">${items.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>
    <p class="small muted">Press “/” to search anywhere. Questions about the setup? Open Setup → Workspace.</p>
    <div><button class="btn" data-act="feedback">Suggest an improvement</button></div>`;
  $('#helpDlg').showModal();
}
