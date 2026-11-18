/* ---------- constants ---------- */
const CAL = 'calendly.com/fparham/30min';
const STAGES = [
  {target:3, id:'lead', name:'Lead',       src:'Website form · referral · InstitutionalOS landing', gate:'Fit confirmed, call booked'},
  {target:5, id:'discovery',  name:'Discovery',  src:'Calendly 30-min call', gate:'Need understood, assessment sent'},
  {target:7, id:'diagnostic', name:'Diagnostic', src:'InstitutionalOS Console score + Evidence Vault', gate:'Score reviewed with client'},
  {target:7, id:'proposal',   name:'Proposal',   src:'Scope, fee, timeline', gate:'Signed agreement'},
  {target:5, id:'contracted', name:'Contracted', src:'Signed agreement + deposit invoice', gate:'Deposit paid, kickoff held'},
  {target:45, id:'delivery',   name:'Delivery',   src:'BUILD / FUND / SUSTAIN work', gate:'Deliverables accepted'},
  {target:7, id:'closeout',   name:'Closeout',   src:'Final report + final invoice', gate:'Final invoice paid'},
  {target:90, id:'sustain',    name:'Sustain',    src:'Retainer · 90-day reassessment', gate:'Renewal or graceful exit'}
];
const LANES = [
  {id:'client', name:'Client'},
  {id:'franklin', name:'Principal'},
  {id:'associates', name:'Associates'},
  {id:'finance', name:'Finance & Ops'}
];
const STATUSES = [
  {id:'unassigned',  name:'Unassigned',  def:'In the team queue. Nobody owns it yet.', who:'Anyone can take it; the lead allocates.'},
  {id:'assigned',    name:'Assigned',    def:'Has an owner who has not opened it yet.', who:'Owner taps “Got it”.'},
  {id:'seen',        name:'Seen',        def:'Owner acknowledged it and the due date.', who:'Owner starts when ready.'},
  {id:'in_progress', name:'In progress', def:'Owner is actively working on it.', who:'Owner.'},
  {id:'blocked',     name:'Blocked',     def:'Stuck. A note says what is needed and from whom.', who:'Owner flags; lead clears.'},
  {id:'review',      name:'In review',   def:'Done by owner, waiting on a second look.', who:'Whoever assigned it approves.'},
  {id:'done',        name:'Done',        def:'Finished and accepted.', who:'Owner or reviewer.'}
];
const OFFERS = {BUILD:'Formation Readiness', FUND:'Grant Readiness', SUSTAIN:'Institutional Durability'};
const PALETTE = ['#1d3461','#c27a1f','#2a7473','#2c7a57','#7a3e8c','#a33d5a','#4a6b8a','#8a6a2a'];
const BLOCKS = [
  {f:'Faith',   s:'06:00', e:'07:00', label:'Devotional'},
  {f:'Fitness', s:'07:00', e:'08:30', label:'Training'},
  {f:'Finance', s:'08:30', e:'09:30', label:'Statements, bills, invoices to issue', lane:'finance'},
  {f:'Family',  s:'09:30', e:'10:30', label:'Scripture and encouragement to the family group chat'},
  {f:'Work',    s:'10:30', e:'19:30', label:'Team stand-up, client delivery, pipeline', lane:'work'},
  {f:'Family',  s:'20:00', e:'22:00', label:'Time with your wife, recap the day'},
  {f:'Faith',   s:'22:30', e:'23:00', label:'Prayer and reading'}
];
const DEFAULT_RECIPES = [
  {stage:'lead', on:true,
   tasks:[{t:'Research {{org}}: 990, website, board list', d:1, lane:'associates'},{t:'Reply to {{first}} within 24 hours', d:0, lane:'franklin'}],
   msgs:[{lane:'client', ch:'email', s:'Thank you for reaching out, {{first}}',
     b:'Hi {{first}},\n\nThank you for reaching out about {{org}}. I would love to learn where you are and where you want to go.\n\nYou can grab 30 minutes on my calendar here: {{calendly}}\n\nIn the meantime, the free InstitutionalOS readiness check gives us a shared starting point.\n\nWith gratitude,\n{{sender}}\nFrankly Inspired & Associates'}]},
  {stage:'discovery', on:true,
   tasks:[{t:'Prep discovery questions for {{org}}', d:0, lane:'franklin'},{t:'Send InstitutionalOS assessment link after the call', d:1, lane:'associates'}],
   msgs:[{lane:'client', ch:'email', s:'Great speaking with you, {{first}}',
     b:'Hi {{first}},\n\nThank you for the time today. As promised, the next step is the InstitutionalOS readiness assessment for {{org}}. It takes about 20 minutes and scores seven dimensions of institutional health.\n\nOnce it is in, I will walk you through the results and where {{offer}} fits.\n\n{{sender}}'}]},
  {stage:'diagnostic', on:true,
   tasks:[{t:'Score 7 dimensions + evidence notes in the Console for {{org}}', d:3, lane:'associates'},{t:'Review decision band and open gates for {{org}}', d:4, lane:'franklin'}],
   msgs:[{lane:'associates', ch:'internal', s:'Diagnostic underway: {{org}}',
     b:'Team, {{org}} is in diagnostic for {{offer}}. Estimated value {{value}}. Flag capacity for a possible kickoff in about 3 weeks.'},
         {lane:'client', ch:'email', s:'Your readiness results for {{org}}',
     b:'Hi {{first}},\n\nYour InstitutionalOS scorecard is ready. Let\'s walk through it together: what is strong, which gates are open, and the shortest path to closing them.\n\nBook a review: {{calendly}}\n\n{{sender}}'}]},
  {stage:'proposal', on:true,
   tasks:[{t:'Draft {{offerCode}} proposal for {{org}}', d:2, lane:'franklin'},{t:'Follow up on proposal with {{first}}', d:7, lane:'franklin'}],
   msgs:[{lane:'client', ch:'email', s:'Proposal: {{offer}} for {{org}}',
     b:'Hi {{first}},\n\nAttached is our proposal for {{offer}}, built directly from your readiness results. It covers scope, timeline, and an investment of {{value}}.\n\nHappy to adjust anything. A 50% deposit starts the work.\n\n{{sender}}'}]},
  {stage:'contracted', on:true,
   tasks:[{t:'Issue deposit invoice to {{org}} ({{deposit}})', d:0, lane:'finance'},{t:'Schedule kickoff with {{first}}', d:2, lane:'franklin'},{t:'Set up client folder and project plan for {{org}}', d:1, lane:'associates'}],
   msgs:[{lane:'client', ch:'email', s:'Welcome aboard, {{org}}',
     b:'Hi {{first}},\n\nWe are officially underway. Here is what happens next:\n\n1. Deposit invoice ({{deposit}}) arrives separately.\n2. Kickoff call this week. Choose a time: {{calendly}}\n3. You will get a short status note from me every two weeks.\n\nGrateful to build this with you.\n\n{{sender}}'},
         {lane:'finance', ch:'internal', s:'Invoice: {{org}} deposit {{deposit}}',
     b:'Issue deposit invoice to {{org}} for {{deposit}} (50% of {{value}}). Net 15. Record in books on payment.'},
         {lane:'associates', ch:'internal', s:'Staffing: {{org}} kickoff',
     b:'{{org}} signed for {{offer}}. Kickoff within 2 weeks. Please confirm availability and review the diagnostic in the Console.'}]},
  {stage:'delivery', on:true,
   tasks:[{t:'Run kickoff with {{org}}', d:0, lane:'franklin'},{t:'Biweekly status note to {{first}}', d:14, lane:'associates'}],
   msgs:[{lane:'client', ch:'email', s:'{{org}} status: weeks 1–2',
     b:'Hi {{first}},\n\nQuick status on {{offer}}:\n\nDone:\n- \n\nNext two weeks:\n- \n\nNeed from you:\n- \n\n{{sender}}'}]},
  {stage:'closeout', on:true,
   tasks:[{t:'Deliver final report to {{org}}', d:0, lane:'franklin'},{t:'Issue final invoice to {{org}} ({{deposit}})', d:0, lane:'finance'},{t:'Ask {{first}} for a testimonial', d:7, lane:'associates'}],
   msgs:[{lane:'client', ch:'email', s:'Final deliverables for {{org}}',
     b:'Hi {{first}},\n\nAttached are the final deliverables for {{offer}}. It has been a privilege to work alongside your team.\n\nThe final invoice ({{deposit}}) follows separately. In 90 days I will re-run your readiness score so we can see the movement.\n\n{{sender}}'},
         {lane:'finance', ch:'internal', s:'Invoice: {{org}} final {{deposit}}',
     b:'Issue final invoice to {{org}} for {{deposit}}. Mark engagement paid when received.'}]},
  {stage:'sustain', on:true,
   tasks:[{t:'Retainer check-in with {{first}}', d:30, lane:'franklin'},{t:'Re-run InstitutionalOS score for {{org}}', d:90, lane:'associates'}],
   msgs:[{lane:'client', ch:'email', s:'Checking in on {{org}}',
     b:'Hi {{first}},\n\nIt has been a few weeks since we wrapped. How is the team carrying the work forward? I would be glad to set a quarterly rhythm to keep momentum.\n\n{{sender}}'}]}
];

const DEFAULT_EST = {'Research {{org}}: 990, website, board list':1.5,'Reply to {{first}} within 24 hours':0.25,'Prep discovery questions for {{org}}':0.75,'Send InstitutionalOS assessment link after the call':0.25,
 'Score 7 dimensions + evidence notes in the Console for {{org}}':4,'Review decision band and open gates for {{org}}':1,'Draft {{offerCode}} proposal for {{org}}':3,'Follow up on proposal with {{first}}':0.25,
 'Issue deposit invoice to {{org}} ({{deposit}})':0.5,'Schedule kickoff with {{first}}':0.25,'Set up client folder and project plan for {{org}}':1,'Run kickoff with {{org}}':1.5,'Biweekly status note to {{first}}':0.5,
 'Deliver final report to {{org}}':4,'Issue final invoice to {{org}} ({{deposit}})':0.5,'Ask {{first}} for a testimonial':0.25,'Retainer check-in with {{first}}':0.5,'Re-run InstitutionalOS score for {{org}}':2};
DEFAULT_RECIPES.forEach(r => r.tasks.forEach(x => { if(x.e==null) x.e = DEFAULT_EST[x.t] ?? 1; }));
(() => { const R = s => DEFAULT_RECIPES.find(r=>r.stage===s); const T = (s,t) => R(s).tasks.find(x=>x.t===t);
  R('discovery').tasks.push({t:'Collect 990s, financials and board list from {{first}}', d:3, lane:'associates', e:0.5});
  T('diagnostic','Score 7 dimensions + evidence notes in the Console for {{org}}').n = 'Collect 990s, financials and board list from {{first}}';
  T('diagnostic','Review decision band and open gates for {{org}}').n = 'Score 7 dimensions + evidence notes in the Console for {{org}}';
  T('proposal','Draft {{offerCode}} proposal for {{org}}').n = 'Review decision band and open gates for {{org}}';
  T('delivery','Run kickoff with {{org}}').n = 'Schedule kickoff with {{first}}'; })();

/* ---------- state ---------- */
const S = {engagements:{}, tasks:{}, messages:{}, events:{}, team:{}, notifs:{}, projects:{}, goals:{}, rules:{}, dashboards:{}, ptemplates:{}, utests:{}, ut:null, projectOpen:null, pTab:'list', peers:[], wlCell:null, dashOpen:null, ai:{}, recipes:null, settings:{},
           mode:'pending', loaded:{}, view:'today', drawer:null, outTab:'draft', draftRecipes:null,
           me:null, myUid:null, isOwner:false, canEdit:false, canCoach:false, pulses:{}, coach:{}, pulseDraft:{}, editPulse:false, tpCtx:null, rates:null, insWin:90, sending:{}, gcalOn:false, gcalEvents:[], gcalErr:'', gcalKey:'', gcalUnsub:null, boardMode:'board', pipeMode:'board', lf:{q:'',owner:'',status:'open',eng:'',due:'',fn:''}, ls:{k:'due',dir:1}, coachTab:'wellbeing', anon:{}, priv:{}, drag:null, model:null, draftModel:null, audit:{}, usage:{}, fb:{}, wiz:null, wizPlan:null, boardFilter:'all', calWeek:0, calMine:false, taskOpen:null};
let DB = null, USER = null;
const LS_KEY = window.FLOWHUB_TEST ? 'fii-flowhub-selftest' : window.FLOWHUB_DEMO ? 'fii-flowhub-demo' : 'fii-flowhub-v2', ME_KEY = window.FLOWHUB_TEST ? 'fii-flowhub-selftest-me' : window.FLOWHUB_DEMO ? 'fii-flowhub-demo-me' : 'fii-flowhub-me';

/* ---------- utils ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);
const pad = n => String(n).padStart(2,'0');
const iso = d => d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const today = () => iso(new Date());
const addDays = (s,n) => { const d = new Date(s+'T12:00:00'); d.setDate(d.getDate()+n); return iso(d); };
const dow = s => new Date(s+'T12:00:00').getDay();
const daysBetween = (a,b) => Math.round((new Date(b+'T12:00:00') - new Date(a+'T12:00:00'))/86400000);
const nowISO = () => new Date().toISOString();
const money = v => '$' + Math.round(+v||0).toLocaleString('en-US');
const fmtDate = s => { if(!s) return ''; const d = new Date(s.length>10 ? s : s+'T12:00:00'); return d.toLocaleDateString('en-US',{month:'short',day:'numeric'}); };
const fmtWhen = s => { if(!s) return ''; const d=new Date(s); return d.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); };
const ago = s => { const m = Math.round((Date.now()-new Date(s))/60000); if(m<1) return 'now'; if(m<60) return m+'m'; const h=Math.round(m/60); if(h<24) return h+'h'; return Math.round(h/24)+'d'; };
const fmtTime = t => { if(!t) return ''; const [h,m]=t.split(':').map(Number); return ((h%12)||12)+(m?':'+pad(m):'')+(h<12?'a':'p'); };
const stageIdx = id => STAGES.findIndex(s => s.id === id);
const stageName = id => (STAGES.find(s=>s.id===id)||{}).name || id;
const laneName = id => (LANES.find(l=>l.id===id)||{}).name || id;
const stName = id => (STATUSES.find(s=>s.id===id)||{}).name || id;
const recipes = () => (S.recipes && S.recipes.length) ? S.recipes : DEFAULT_RECIPES;
const list = col => Object.values(S[col]);
const st = t => t.status || (t.done ? 'done' : (t.owner ? 'assigned' : 'unassigned'));
const isOpen = t => st(t) !== 'done' && !t.cancelled;
const team = () => list('team').filter(m=>!m.inactive).sort((a,b)=>(b.lead?1:0)-(a.lead?1:0) || (a.name||'').localeCompare(b.name||''));
const mem = id => id ? S.team[id] : null;
const mname = id => (mem(id)||{}).name || (id ? 'Former member' : 'Unassigned');
const first = id => mname(id).replace(/^Sample:\s*/,'').split(/\s+/)[0];
const initials = n => (n||'?').replace(/^Sample:\s*/,'').split(/\s+/).map(w=>w[0]).slice(0,2).join('').toUpperCase();
const av = (id, cls='') => { const m = mem(id); return m ? `<span class="av ${cls}" style="background:${esc(m.color||'#5b6579')}" title="${esc(m.name)}">${esc(initials(m.name))}</span>` : `<span class="av empty ${cls}" title="Unassigned">?</span>`; };
const stPill = s => `<span class="st" data-s="${s}">${esc(stName(s))}</span>`;
const leadId = () => (team().find(m=>m.lead)||{}).id || '';

function fill(str, e){
  const firstName = (e.contact||'').trim().split(/\s+/)[0] || 'there';
  const map = {org:e.org||'your organization', contact:e.contact||'', first:firstName, offer:OFFERS[e.offer]||e.offer||'', offerCode:e.offer||'',
               value:money(e.value), deposit:money((+e.value||0)/2), calendly:CAL, sender:(typeof LBL!=='undefined' && LBL.sender) || (leadId() ? mname(leadId()).replace(/^Sample:\s*/,'') : 'Franklin D. Parham')};
  return String(str||'').replace(/\{\{(\w+)\}\}/g, (m,k) => map[k] !== undefined ? map[k] : m);
}
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('on'); clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove('on'),2800); }

/* ---------- persistence ---------- */
const chains = {};
const COLS = ['engagements','tasks','messages','events','team','notifs','projects','goals','rules','dashboards','ptemplates','utests'];
function strip(o){ const c = {...o}; delete c.id; return c; }
function saveLocal(){ try{ const o={}; COLS.forEach(c=>o[c]=S[c]); o.recipes=S.recipes; o.settings=S.settings; o.pulses=S.pulses; o.coach=S.coach; o.rates=S.rates; o.anon=S.anon; o.priv=S.priv; o.model=S.model; o.audit=S.audit; o.usage=S.usage; o.fb=S.fb; localStorage.setItem(LS_KEY, JSON.stringify(o)); }catch(_){} }
function loadLocal(){ try{ const d = JSON.parse(localStorage.getItem(LS_KEY)||'null'); if(d){ COLS.forEach(c=>S[c]=d[c]||{}); S.recipes=d.recipes||null; S.settings=d.settings||{}; S.pulses=d.pulses||{}; S.coach=d.coach||{}; S.rates=d.rates||null; S.anon=d.anon||{}; S.priv=d.priv||{}; S.model=d.model||null; S.audit=d.audit||{}; S.usage=d.usage||{}; S.fb=d.fb||{}; } }catch(_){} }
function handleErr(err){
  const code = err && err.code;
  if(code==='quota_exceeded') toast('Storage is full. Clear old alerts or archived engagements.');
  else if(code==='revoked' || code==='not_granted') setStatus('warn','Read-only in this view');
  else if(code==='invalid_argument') toast('That change was not saved. Your access may be view-only. Ask Franklin to make you a Contributor.');
  else toast('Could not save just now. Try again in a moment.');
}
function queueWrite(path, fn){ chains[path] = (chains[path]||Promise.resolve()).then(async()=>{ try{ await fn(); }catch(err){ if(err && err.code==='unavailable'){ await new Promise(r=>setTimeout(r,600+Math.random()*800)); try{ await fn(); }catch(e2){ handleErr(e2); } } else handleErr(err); } }); }
function persist(col, id){
  if(!DB){ saveLocal(); return; }
  queueWrite(col+'/'+id, async()=>{ const ref = DB.collection(col).doc(id); const data = S[col][id]; if(data) await ref.set(strip(data)); else await ref.delete(); });
}
function put(col, id, obj){ S[col][id] = {...obj, id}; persist(col,id); }
function del(col, id){ delete S[col][id]; persist(col,id); }
function saveConfig(name, data){
  if(typeof audit==='function'){ const keys = name==='settings' ? Object.keys(data||{}).filter(k => JSON.stringify((S.settings||{})[k]) !== JSON.stringify(data[k]) && !AUDIT_SKIP.has(k)) : null; if(name!=='settings' || keys.length) audit(`Changed ${name==='model'?'workspace setup':name==='recipes'?'playbooks':name==='rates'?'cost rates':'settings'}`, keys ? keys.join(', ') : ''); }
  if(name==='recipes') S.recipes = data.list; else if(name==='rates') S.rates = data; else if(name==='model') S.model = data; else S.settings = data;
  if(!DB){ saveLocal(); return; }
  queueWrite('config/'+name, async()=>{ await DB.doc('config/'+name).set(data); });
}
function setStatus(kind, text){ $('#status').innerHTML = `<span class="dot ${kind}"></span><span>${esc(text)}</span>`; }

let pendingRender = false;
function typing(){ const a = document.activeElement; return a && a.matches && a.matches('input:not([type=checkbox]),textarea,select'); }
function safeRender(){ if(typing()){ pendingRender = true; return; } render(); }
document.addEventListener('focusout', () => { if(pendingRender){ setTimeout(()=>{ if(!typing()){ pendingRender=false; render(); } },0);} });

async function initStore(){
  let db = null;
  try{ if(!window.FLOWHUB_TEST && !window.FLOWHUB_DEMO && window.claude && typeof window.claude.use==='function'){ db = await window.claude.use('db'); USER = await window.claude.use('user'); } }catch(_){ db = null; }
  if(USER){ try{ S.myUid = await USER.id(); S.isOwner = await USER.isOwner(); S.canEdit = await USER.canEdit(); }catch(_){} }
  if(!db){ S.mode='local'; loadLocal(); applyModel(S.model); setStatus('warn','Preview: saved in this browser only'); resolveMe(); render(); return; }
  DB = db; S.mode='db';
  const timer = setTimeout(()=>{ if(!S.loaded.tasks) setStatus('warn','Can’t reach your saved data yet'); }, 10000);
  const done = () => { if(COLS.every(c=>S.loaded[c])){ clearTimeout(timer); setStatus('ok','Synced for the whole team'); } };
  COLS.forEach(col => {
    DB.collection(col).onSnapshot(snap => {
      const m = {}; snap.docs.forEach(d => { m[d.id] = {...d.data(), id:d.id}; });
      S[col] = m; if(!snap.metadata.fromCache) S.loaded[col] = true; done();
      if(col==='team'){ resolveMe(); subscribePeople(); subscribeAnon(); }
      safeRender();
    }, err => { clearTimeout(timer); S.loaded[col]=true; setStatus('warn', err.code==='revoked' ? 'Read-only in this view' : 'Sync paused. Reload to reconnect'); safeRender(); });
  });
  if(S.myUid){ DB.collection('data/users/'+S.myUid).onSnapshot(snap => { const m={}; snap.docs.forEach(d=>m[d.id]={...d.data(), id:d.id}); S.priv=m; safeRender(); }, ()=>{}); }
  DB.doc('config/recipes').onSnapshot(snap => { const d = snap.exists ? snap.data() : null; S.recipes = d && Array.isArray(d.list) ? d.list : null; safeRender(); }, ()=>{});
  DB.doc('config/rates').onSnapshot(snap => { S.rates = snap.exists ? (snap.data()||{}) : null; safeRender(); }, ()=>{});
  DB.doc('config/model').onSnapshot(snap => { S.model = snap.exists ? (snap.data()||null) : null; applyModel(S.model); S.draftModel = null; safeRender(); }, ()=>{});
  DB.doc('config/settings').onSnapshot(snap => { S.settings = snap.exists ? (snap.data()||{}) : {}; safeRender(); }, ()=>{});
}

/* ---------- identity ---------- */
function resolveMe(){
  const ms = team();
  let me = S.myUid ? ms.find(m => m.uid === S.myUid) : null;
  if(!me && S.me && S.team[S.me] && !S.team[S.me].inactive) me = S.team[S.me];
  if(!me){ let saved=null; try{ saved = localStorage.getItem(ME_KEY); }catch(_){} if(saved && S.team[saved]) me = S.team[saved]; }
  if(!me && S.isOwner){ const lead = ms.find(m => m.lead && !m.uid); if(lead){ me = lead; if(S.myUid) put('team', lead.id, {...lead, uid:S.myUid}); } }
  S.me = me ? me.id : null;
  S.canCoach = S.mode==='local' ? !!(me && me.lead) : (S.isOwner || S.canEdit);
  const b = $('#whoBtn');
  b.innerHTML = me ? `${av(me.id)}<span>${esc(me.name.split(/\s+/)[0])}</span>` : `<span class="av empty">?</span><span>Who are you?</span>`;
}
function claimMe(id){
  try{ localStorage.setItem(ME_KEY, id); }catch(_){}
  const m = S.team[id];
  if(m && S.myUid && !m.uid) put('team', id, {...m, uid:S.myUid});
  S.me = id; resolveMe(); render(); toast(`Viewing as ${mname(id)}`);
}

/* ---------- domain: notifications ---------- */
function notify(to, text, ref={}, opt={}){
  if(!to || to===S.me || !S.team[to]) return;
  put('notifs', uid(), {to, text, task:ref.task||'', eng:ref.eng||'', by:S.me||'', at:nowISO(), read:false});
  if(opt.email) emailAlert(to, text);
}
function myAlerts(){ return list('notifs').filter(n=>n.to===S.me).sort((a,b)=>(b.at||'').localeCompare(a.at||'')); }

/* ---------- domain: tasks ---------- */
function hist(t, to, note){ const h = Array.isArray(t.history) ? t.history.slice(-29) : []; h.push({at:nowISO(), by:S.me||'', from:st(t), to, note:note||''}); return h; }
function createTask({title, eng='', owner='', due=today(), lane='franklin', stage='', src='manual', est=0, tpl='', fn='', extra=null}){
  const id = uid();
  const status = owner ? (owner===S.me ? 'seen' : 'assigned') : 'unassigned';
  const t = {title, eng, owner, assignedBy: owner ? (S.me||'') : '', assignedAt: owner ? nowISO() : null, due, lane, stage, src, status, est:+est||0, tpl, fn: fn || (fnOn() ? defaultFn(lane, tpl) : ''), timeLog:[], created:nowISO(), createdBy:S.me||'',
             history:[{at:nowISO(), by:S.me||'', from:'', to:status, note: src==='playbook' ? `Created by the ${stageName(stage)} playbook` : 'Created'}]};
  if(status==='seen') t.seenAt = nowISO();
  if(extra) Object.assign(t, extra);
  put('tasks', id, t);
  if(typeof runRules==='function') runRules('created', id);
  if(owner) notify(owner, `${S.me?first(S.me):'A playbook'} assigned you: ${title} (due ${fmtDate(due)})`, {task:id, eng}, {email: src!=='playbook' && src!=='repeat'});
  return id;
}
function assignTask(id, owner){
  const t = S.tasks[id]; if(!t || t.owner===owner) return;
  const status = owner ? (owner===S.me ? 'seen' : 'assigned') : 'unassigned';
  const next = {...t, owner, assignedBy:S.me||'', assignedAt: owner ? nowISO() : null, status, seenAt: status==='seen' ? nowISO() : null, ...(t.timerStart ? closeTimer(t) : {}),
                history: hist(t, status, owner ? `Assigned to ${mname(owner)}` : 'Moved back to the team queue')};
  put('tasks', id, next);
  if(owner) notify(owner, `${S.me?first(S.me):'Someone'} assigned you: ${t.title} (due ${fmtDate(t.due)})`, {task:id, eng:t.eng}, {email:true});
  if(t.owner && t.owner!==owner) notify(t.owner, `${t.title} was reassigned to ${mname(owner)}`, {task:id, eng:t.eng});
  if(typeof runRules==='function') runRules('assigned', id, {owner});
}
function setTaskStatus(id, to, note=''){
  const t = S.tasks[id]; if(!t) return;
  const from = st(t); if(from===to) return;
  if(to==='blocked' && !note){ toast('Add a note saying what is blocking it'); openTask(id); return false; }
  if(to==='done' && t.approval && t.approval.state==='pending'){ toast('Waiting on approval from '+mname(t.approval.by)); return false; }
  if(to==='in_progress' && openDeps(t).length){ toast(`Waiting on: ${openDeps(t).map(x=>x.title).join('; ')}`); return false; }
  const next = {...t, status:to, done: to==='done', history: hist(t, to, note)};
  if(to==='seen') next.seenAt = nowISO();
  if(to==='in_progress' && !t.startedAt) next.startedAt = nowISO();
  if(to==='done') next.doneAt = nowISO();
  if(to==='done' && !t.seenAt) next.seenAt = nowISO();
  if(t.timerStart && to!=='in_progress') Object.assign(next, closeTimer(t));
  if(to==='in_progress' && S.me && t.owner===S.me && !t.timerStart){ stopOtherTimers(id); next.timerStart = nowISO(); next.timerBy = S.me; }
  if(to==='blocked') next.blockedAt = nowISO();
  if(from==='blocked'){ next.blockedMin = (+t.blockedMin||0) + Math.max(0,(Date.now()-new Date(t.blockedAt||Date.now()))/60000); next.blockedAt = null; }
  if(from==='done') next.reopened = (+t.reopened||0)+1;
  put('tasks', id, next);
  const actor = S.me ? first(S.me) : 'Someone';
  const verb = {seen:'saw', in_progress:'started', blocked:'is blocked on', review:'sent for review', done:'finished', assigned:'reopened', unassigned:'returned to the queue'}[to] || 'updated';
  const text = `${actor} ${verb}: ${t.title}${note?` — “${note}”`:''}`;
  const tell = new Set();
  if(t.assignedBy) tell.add(t.assignedBy);
  if(to==='blocked' || to==='review') tell.add(t.assignedBy || leadId());
  if(to==='blocked') tell.add(leadId());
  if(from==='review' && t.owner) tell.add(t.owner);
  if(to==='seen') { tell.clear(); if(t.assignedBy) tell.add(t.assignedBy); }
  tell.forEach(p => notify(p, text, {task:id, eng:t.eng}, {email: to==='blocked' || to==='review'}));
  if(to==='done') onTaskDone(id);
  if(typeof runRules==='function') runRules('status', id, {from, to});
  const e = t.eng && S.engagements[t.eng];
  if(e && (to==='done' || to==='blocked')) put('engagements', e.id, {...e, log:logTo(e, to==='done'?'task':'block', `${actor} ${verb}: ${t.title}`), updated:nowISO()});
  return true;
}
function nextAction(t){
  const s = st(t), mine = t.owner && t.owner===S.me;
  if(s==='unassigned') return S.me ? {to:'take', label:'Take it'} : null;
  if(s==='assigned') return mine ? {to:'seen', label:'Got it'} : null;
  if(s==='seen') return openDeps(t).length ? null : {to:'in_progress', label:'Start'};
  if(s==='in_progress') return {to:'done', label:'Done'};
  if(s==='blocked') return {to:'in_progress', label:'Unblock'};
  if(s==='review') return (t.assignedBy===S.me || !t.assignedBy) ? {to:'done', label:'Approve'} : null;
  return null;
}

/* ---------- domain: engagements ---------- */
function logTo(e, kind, text){ const log = Array.isArray(e.log) ? e.log.slice(-39) : []; log.push({at:nowISO(), k:kind, t:text, by:S.me||''}); return log; }
function fireRecipe(e, stageId){
  const r = recipes().find(x => x.stage === stageId);
  if(!r || !r.on) return {t:0, m:0};
  const owners = (S.settings && S.settings.laneOwners) || {};
  let t=0, m=0;
  (r.tasks||[]).forEach(x => { if(!x.t) return; const lane = x.lane||'franklin';
    const owner = lane==='franklin' ? (e.lead || owners.franklin || leadId()) : (owners[lane] || '');
    const dep = x.n ? list('tasks').find(z=>z.eng===e.id && z.tpl===x.n && !z.cancelled) : null; const nid = createTask({title:fill(x.t,e), eng:e.id, owner: S.team[owner] ? owner : '', due:addDays(today(), +x.d||0), lane, stage:stageId, src:'playbook', est:+x.e||0, tpl:x.t}); if(dep){ const nt=S.tasks[nid]; put('tasks', nid, {...nt, needs:[dep.id]}); } t++; });
  (r.msgs||[]).forEach(x => {
    const toClient = x.lane==='client';
    put('messages', uid(), {eng:e.id, lane:x.lane, ch:x.ch, to: toClient ? (e.email||'') : '', toName: toClient ? (e.contact||e.org) : laneName(x.lane),
      subj:fill(x.s,e), body:fill(x.b,e), status:'draft', stage:stageId, created:nowISO()}); m++;
  });
  return {t, m};
}
function moveTo(id, stageId, overrides){
  const e = S.engagements[id]; if(!e || e.stage===stageId) return;
  const fired = Array.isArray(e.fired) ? e.fired.slice() : [];
  let next = {...e, stage:stageId, stageAt:today(), updated:nowISO(), stageHistory:[...stageHist(e), {s:stageId, at:nowISO()}].slice(-30)};
  next.log = logTo(e, 'stage', `${S.me?first(S.me)+' moved':'Moved'} to ${stageName(stageId)}${overrides&&overrides.length?` with open exit items: ${overrides.join('; ')}`:''}`);
  if(overrides && overrides.length){ next.overrides = (+e.overrides||0)+1; audit('Moved past open exit items', `${e.org} → ${stageName(stageId)}: ${overrides.join('; ')}`); }
  if(stageId==='contracted' && BILL.on!==false) next = withInvoice(next, 'deposit');
  if(stageId==='closeout' && BILL.on!==false) next = withInvoice(next, 'final');
  let res = {t:0,m:0};
  if(!fired.includes(stageId)){ res = fireRecipe(next, stageId); fired.push(stageId); }
  next.fired = fired;
  put('engagements', id, next);
  const watchers = new Set([e.lead, ...list('tasks').filter(t=>t.eng===id && isOpen(t)).map(t=>t.owner)].filter(Boolean));
  watchers.forEach(p => notify(p, `${e.org} moved to ${stageName(stageId)}`, {eng:id}));
  if(stageId==='delivery'){ const dep = (next.invoices||[]).find(i=>i.kind==='deposit'); if(!dep || !dep.paid){ const fin = ((S.settings||{}).laneOwners||{}).finance; new Set([e.lead||leadId(), fin].filter(Boolean)).forEach(p => notify(p, `Heads up: delivery started for ${e.org} but the deposit isn’t paid yet`, {eng:id}, {email:true})); } }
  if(stageId==='closeout'){ const crew = new Set(list('tasks').filter(t=>t.eng===id).map(t=>t.owner).concat(e.lead).filter(Boolean)); crew.forEach(p => notify(p, `Share a 2-minute retro on ${e.org}. Open the client from the Pipeline.`, {eng:id})); }
  toast(res.t||res.m ? `${stageName(stageId)}: ${res.t} task${res.t===1?'':'s'} and ${res.m} message${res.m===1?'':'s'} queued` : `Moved to ${stageName(stageId)}`);
}
function createEngagement(f){
  const id = uid();
  const e = {org:f.org, contact:f.contact, email:f.email, phone:'', offer:f.offer, value:+f.value||0, source:f.source, lead:f.lead||leadId(), notes:'', stage:'lead', stageAt:today(), created:nowISO(), updated:nowISO(), fired:['lead'], stageHistory:[{s:'lead', at:nowISO()}],
             log:[{at:nowISO(),k:'stage',t:`Added as Lead${f.source?` (${f.source})`:''}`, by:S.me||''}]};
  e.id = id;
  const res = fireRecipe(e, 'lead');
  put('engagements', id, e);
  if(e.lead) notify(e.lead, `You are account lead for ${e.org}`, {eng:id});
  toast(`${f.org} added: ${res.t} tasks and ${res.m} message queued`);
  return id;
}
function markSent(id){
  const m = S.messages[id]; if(!m) return;
  put('messages', id, {...m, status:'sent', sentAt:nowISO(), sentBy:S.me||''});
  const e = m.eng && S.engagements[m.eng];
  if(e){ let ne = {...e, log:logTo(e,'comm',`${S.me?first(S.me)+' ':''}${m.ch==='email'?'emailed':'sent'} ${m.toName||''}: ${m.subj}`), updated:nowISO()};
    if(m.lane==='client' && m.stage==='discovery') ne = setGate(ne, 'discovery', 'Assessment link sent');
    if(m.lane==='client' && m.stage==='proposal') ne = setGate(ne, 'proposal', 'Proposal sent');
    put('engagements', e.id, ne); }
  toast('Logged as sent');
}

/* ---------- derived ---------- */
const openTasks = () => list('tasks').filter(isOpen).sort((a,b)=>(a.due||'').localeCompare(b.due||''));
const activeEng = () => list('engagements').filter(e=>!e.archived);
const drafts = () => list('messages').filter(m=>m.status==='draft').sort((a,b)=>(b.created||'').localeCompare(a.created||''));
const lateCls = t => !isOpen(t) ? '' : t.due < today() ? 'over' : t.due === today() ? 'today' : '';
const dueLabel = t => { if(!isOpen(t)) return 'Done '+fmtDate((t.doneAt||'').slice(0,10)); const d=today(); return t.due<d ? daysBetween(t.due,d)+'d late' : t.due===d ? 'Due today' : 'Due '+fmtDate(t.due); };
