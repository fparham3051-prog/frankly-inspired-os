/* ---------- v5: connectors (Gmail, Google Calendar), downloads ---------- */
const HUB_URL = window.FLOWHUB_HOST==='fios' ? location.origin + '/hub/' : 'https://claude.ai/artifact/Gpq1EkLQD5Lh3ZXjQHPx5b';
const GMAIL = 'Gmail', GCAL = 'Google Calendar';
let MCP = null, DL = null;
async function initExtras(){
  try{ if(!window.FLOWHUB_TEST && !window.FLOWHUB_DEMO && window.claude && typeof window.claude.use==='function'){ MCP = await window.claude.use('mcp'); DL = await window.claude.use('downloads'); } }catch(_){ }
  safeRender();
}
function connErr(e, server){
  const c = e && e.code;
  if(c==='needs_reauth') return `Reconnect ${server} in claude.ai Settings → Connectors.`;
  if(c==='server_not_connected' || c==='selection_required' || c==='server_not_found') return `Add ${server} in claude.ai Settings → Connectors.`;
  if(c==='approval_required') return `${server} needs your approval. Open the hub on claude.ai and allow it.`;
  if(c==='not_in_manifest') return `${server} is turned off for this page.`;
  if(c==='blocked_by_policy') return `Your organization blocks this ${server} action.`;
  if(c==='tool_error') return `${server} refused it: ${String(e.message||'').slice(0,140)}`;
  if(c==='server_unavailable' || c==='upstream_error' || c==='cancelled') return `${server} didn’t confirm. Check ${server} before trying again, so nothing goes twice.`;
  if(c==='not_granted' || c==='capability_disabled' || c==='capability_removed') return `${server} isn’t available in this view. Open the hub on claude.ai.`;
  return `${server} isn’t available right now.`;
}
async function gmailSend(to, subject, body){
  if(!MCP) throw {code:'not_granted'};
  const r = await MCP.callTool(GMAIL, 'send_message', {to:[].concat(to).filter(Boolean), subject, body});
  return r ? r.payload : null;
}
async function sendViaGmail(id){
  const m = S.messages[id]; if(!m || !m.to || S.sending[id]) return;
  S.sending[id] = true; render();
  try{
    const p = await gmailSend(m.to, m.subj, m.body);
    markSent(id); const mm = S.messages[id];
    if(mm) put('messages', id, {...mm, via:'gmail', gmailId:(p && (p.id||p.messageId)) || ''});
    toast('Sent from your Gmail and logged');
  }catch(e){ toast(connErr(e, GMAIL)); }
  finally{ delete S.sending[id]; render(); }
}
let alertErrShown = false;
function emailAlert(to, text){
  const me = mem(S.me), r = mem(to);
  if(!MCP || !me || !me.emailAlerts || !r || !r.email || to===S.me) return;
  gmailSend(r.email, `[Flow Hub] ${text.length>72 ? text.slice(0,70)+'…' : text}`, `${text}\n\nOpen Flow Hub: ${HUB_URL}\n\nSent from the Frankly Inspired Flow Hub by ${me.name}.`)
    .catch(e => { if(!alertErrShown){ alertErrShown = true; toast('Alert email not sent. '+connErr(e, GMAIL)); } });
}
function gcalPayload(ev){
  const start = ev.start || '09:00';
  let end = ev.end; if(!end || end <= start){ const [h,m] = start.split(':').map(Number); const t = h*60+m+30; end = pad(Math.min(23,Math.floor(t/60)))+':'+pad(t%60); }
  const e = ev.eng && S.engagements[ev.eng];
  const p = {summary:ev.title, startTime:`${ev.date}T${start}:00`, endTime:`${ev.date}T${end}:00`, description:`From the Frankly Inspired Flow Hub team calendar${e?` · ${e.org}`:''}\n${HUB_URL}`};
  if(ev.repeat==='weekdays') p.recurrenceData = ['RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'];
  if(ev.repeat==='weekly') p.recurrenceData = ['RRULE:FREQ=WEEKLY'];
  if(ev.createdBy===S.me){ const att = (ev.att && ev.att.length ? ev.att : team().map(m=>m.id)).map(mem).filter(m=>m && m.email && m.id!==S.me).map(m=>({email:m.email, displayName:m.name.replace(/^Sample:\s*/,'')})); if(att.length) p.attendees = att; }
  return p;
}
async function pushToGcal(id){
  const ev = S.events[id]; if(!ev || !S.me) return;
  if(!MCP){ toast(connErr({code:'not_granted'}, GCAL)); return; }
  if((ev.gcal||{})[S.me]){ toast('Already on your Google Calendar'); return; }
  if(S.sending['ev'+id]) return; S.sending['ev'+id] = true;
  try{
    const r = await MCP.callTool(GCAL, 'create_event', gcalPayload(ev));
    const pid = (r && r.payload && (r.payload.id || r.payload.eventId)) || 'added';
    const cur = S.events[id]; if(cur) put('events', id, {...cur, gcal:{...(cur.gcal||{}), [S.me]:String(pid)}});
    toast(ev.createdBy===S.me ? 'Added to your Google Calendar. Invites go to teammates with an email on file.' : 'Added to your Google Calendar');
  }catch(e){ toast(connErr(e, GCAL)); }
  finally{ delete S.sending['ev'+id]; render(); }
}
function parseGcal(p){
  let arr = Array.isArray(p) ? p : (p && (p.events || p.items || p.results)) || [];
  if(!Array.isArray(arr)) arr = [];
  const ours = new Set(list('events').flatMap(e => Object.values(e.gcal||{})));
  return arr.map(e => {
    const s = e.start && typeof e.start==='object' ? (e.start.dateTime || e.start.date) : (e.startTime || e.start);
    const en = e.end && typeof e.end==='object' ? (e.end.dateTime || e.end.date) : (e.endTime || e.end);
    return {id:String(e.id||e.eventId||''), title:String(e.summary||e.title||'Busy'), start:String(s||''), end:String(en||''), allDay:/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))};
  }).filter(e => e.start && !ours.has(e.id));
}
function gcalRange(){ const base = new Date(today()+'T12:00:00'); const off = (base.getDay()+6)%7; base.setDate(base.getDate()-off+S.calWeek*7); const d0 = iso(base); return {d0, d1:addDays(d0,7)}; }
async function loadGcal(){
  if(!MCP){ toast(connErr({code:'not_granted'}, GCAL)); return; }
  const {d0, d1} = gcalRange();
  try{ const r = await MCP.callTool(GCAL, 'list_events', {startTime:`${d0}T00:00:00`, endTime:`${d1}T00:00:00`, orderBy:'startTime', pageSize:100}); S.gcalEvents = parseGcal(r && r.payload); S.gcalErr=''; S.gcalOn = true; try{ localStorage.setItem('fii-gcal','1'); }catch(_){} S.gcalKey=''; watchGcal(); }
  catch(e){ S.gcalErr = connErr(e, GCAL); }
  render();
}
function watchGcal(){
  if(!MCP || !S.gcalOn){ if(S.gcalUnsub){ S.gcalUnsub(); S.gcalUnsub=null; S.gcalKey=''; } return; }
  const {d0, d1} = gcalRange(); if(S.gcalKey===d0) return;
  if(S.gcalUnsub) S.gcalUnsub(); S.gcalKey = d0;
  try{
    S.gcalUnsub = MCP.watchTool(GCAL, 'list_events', {startTime:`${d0}T00:00:00`, endTime:`${d1}T00:00:00`, orderBy:'startTime', pageSize:100}, ev => {
      if(ev.type==='data'){ S.gcalEvents = parseGcal(ev.result && ev.result.payload); S.gcalErr = ''; }
      else { const c = ev.error && ev.error.code; if(['needs_reauth','server_not_connected','blocked_by_policy','approval_required','not_in_manifest','selection_required'].includes(c)) S.gcalEvents = []; S.gcalErr = connErr(ev.error, GCAL); }
      safeRender();
    }, {refetchInterval:300000});
  }catch(_){ }
}
async function saveFile(filename, text, mime){
  if(DL){ try{ await DL.save({filename, data:text}); toast(`${filename} saved`); return; }catch(e){ try{ await DL.save({filename, data:new Blob([text],{type:mime||'text/csv'})}); toast(`${filename} saved`); return; }catch(e2){ } } }
  try{ await navigator.clipboard.writeText(text); toast('Download not available here, so the file was copied to your clipboard'); }catch(_){ toast('Download not available in this view'); }
}
const csvCell = v => { const s = v==null ? '' : String(v); return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; };
const toCsv = rows => rows.map(r => r.map(csvCell).join(',')).join('\n');

/* ---------- v5: stage exit checklists, outcomes, forecasting ---------- */
const GATES = {
  lead:['Fit confirmed: mission, budget, timing','Discovery call booked'],
  discovery:['Discovery call held','Assessment link sent','Documents requested: 990s, financials, board list'],
  diagnostic:['Documents received','Console scoring complete','Results reviewed with client'],
  proposal:['Proposal sent','Agreement signed'],
  contracted:['Deposit invoice sent','Kickoff scheduled'],
  delivery:['Deposit paid','All deliverables accepted'],
  closeout:['Final report delivered','Final invoice sent','Retro collected'],
  sustain:['Renewal or exit decided']
};
const PROB = {lead:0.1, discovery:0.2, diagnostic:0.35, proposal:0.5, contracted:0.9, delivery:1, closeout:1, sustain:1};
const LOST_REASONS = ['Price','Timing','Chose another firm','No funding','Not a fit','Went quiet'];
function gateState(e, sid){ const g = (e.gates||{})[sid] || []; return (GATES[sid]||[]).map((t,i)=>({t, i, done:!!g[i]})); }
function setGate(e, sid, label, val=true){ const i = (GATES[sid]||[]).indexOf(label); if(i<0) return e; const g = {...(e.gates||{})}; const arr = (g[sid]||[]).slice(); if(!!arr[i]===val) return e; arr[i] = val; g[sid] = arr; return {...e, gates:g}; }
function toggleGate(eid, sid, i){
  const e = S.engagements[eid]; if(!e) return; const g = {...(e.gates||{})}; const arr = (g[sid]||[]).slice(); arr[i] = !arr[i]; g[sid] = arr;
  put('engagements', eid, {...e, gates:g, updated:nowISO(), log:logTo(e, 'stage', `${arr[i]?'Checked':'Unchecked'}: ${GATES[sid][i]}`)});
}
function tryAdvance(eid, to, el){
  const e = S.engagements[eid]; if(!e) return;
  if(stageIdx(to) > stageIdx(e.stage)){
    const open = gateState(e, e.stage).filter(x=>!x.done);
    if(open.length){
      if(!el){ toast(`${open.length} exit item${open.length>1?'s':''} still open for ${stageName(e.stage)}. Use the ▶ button to override.`); return; }
      if(!arm(el, `${open.length} exit item${open.length>1?'s':''} open. Click again to advance anyway`)) return;
      moveTo(eid, to, open.map(x=>x.t)); render(); return;
    }
  }
  moveTo(eid, to); render();
}
function markLost(eid, reason){
  const e = S.engagements[eid]; if(!e) return;
  list('tasks').filter(t=>t.eng===eid && isOpen(t)).forEach(t => put('tasks', t.id, {...t, cancelled:true, ...(t.timerStart ? closeTimer(t) : {})}));
  put('engagements', eid, {...e, outcome:'lost', lostReason:reason, lostAt:nowISO(), lostStage:e.stage, archived:true, updated:nowISO(), log:logTo(e,'stage',`Marked lost at ${stageName(e.stage)}: ${reason}`)});
  audit('Marked lost', `${e.org}: ${reason}`); toast(`${e.org} marked lost (${reason})`);
}
function reopenLost(eid){
  const e = S.engagements[eid]; if(!e) return;
  list('tasks').filter(t=>t.eng===eid && t.cancelled).forEach(t => put('tasks', t.id, {...t, cancelled:false}));
  put('engagements', eid, {...e, outcome:null, archived:false, updated:nowISO(), log:logTo(e,'stage','Reopened')});
}

/* ---------- v5: invoices ---------- */
const invStatus = i => i.paid ? 'paid' : !i.issued ? 'draft' : (i.due && i.due < today()) ? 'overdue' : 'sent';
const INV_LABEL = {draft:'Not sent', sent:'Sent', overdue:'Overdue', paid:'Paid'};
function invList(){ return list('engagements').flatMap(e => (e.invoices||[]).map(i => ({...i, e}))); }
function withInvoice(e, kind){
  const invs = e.invoices || []; if(invs.some(i=>i.kind===kind)) return e;
  const billed = invs.reduce((s,i)=>s+(+i.amount||0),0);
  const pctv = BILL.pct==null ? 0.5 : +BILL.pct; const amount = kind==='deposit' ? Math.round((+e.value||0)*pctv) : Math.max(0, (+e.value||0) - billed);
  return {...e, invoices:[...invs, {id:uid(), kind, label: kind==='deposit' ? (BILL.depositLabel||'Deposit') : kind==='final' ? (BILL.finalLabel||'Final invoice') : 'Invoice', amount, issued:null, due:null, paid:null}]};
}
function updateInvoice(eid, iid, patch, quiet){
  const e = S.engagements[eid]; if(!e) return;
  const invs = (e.invoices||[]).map(i => i.id===iid ? {...i, ...patch} : i); const inv = invs.find(i=>i.id===iid); if(!inv) return;
  let next = {...e, invoices:invs, updated:nowISO()};
  if(patch.issued && inv.kind==='deposit') next = setGate(next, 'contracted', 'Deposit invoice sent');
  if(patch.paid && inv.kind==='deposit') next = setGate(next, 'delivery', 'Deposit paid');
  if(patch.issued && inv.kind==='final') next = setGate(next, 'closeout', 'Final invoice sent');
  next.log = logTo(e, 'comm', patch.paid ? `Payment received: ${inv.label} ${money(inv.amount)}` : patch.issued ? `Invoice sent: ${inv.label} ${money(inv.amount)}, due ${fmtDate(inv.due)}` : `Invoice updated: ${inv.label} ${money(inv.amount)}`);
  put('engagements', eid, next); if(patch.paid) audit('Recorded a payment', `${e.org}: ${inv.label} ${money(inv.amount)}`);
  if(!quiet) toast(patch.paid ? 'Marked paid' : patch.issued ? 'Marked sent, due in 15 days' : 'Invoice updated');
}
function autoInvoiceFromTask(t){
  if(!t.eng || !t.tpl) return; const e = S.engagements[t.eng]; if(!e) return;
  const kind = /Issue deposit invoice/.test(t.tpl) ? 'deposit' : /Issue final invoice/.test(t.tpl) ? 'final' : null; if(!kind) return;
  let cur = e; if(!(cur.invoices||[]).some(i=>i.kind===kind)){ cur = withInvoice(cur, kind); put('engagements', cur.id, cur); }
  const inv = (S.engagements[t.eng].invoices||[]).find(i=>i.kind===kind);
  if(inv && !inv.issued) updateInvoice(t.eng, inv.id, {issued:today(), due:addDays(today(),15)}, true);
}
function reminderDraft(eid, iid){
  const e = S.engagements[eid]; const inv = e && (e.invoices||[]).find(i=>i.id===iid); if(!inv) return;
  const firstName = (e.contact||'').split(/\s+/)[0] || 'there';
  put('messages', uid(), {eng:eid, lane:'client', ch:'email', to:e.email||'', toName:e.contact||e.org, subj:`Friendly reminder: ${inv.label} for ${e.org}`,
    body:`Hi ${firstName},\n\nA quick reminder that the ${inv.label.toLowerCase()} for ${OFFERS[e.offer]||'our engagement'} (${money(inv.amount)}) was due on ${fmtDate(inv.due)}. If it’s already on its way, thank you, and please ignore this note.\n\nHappy to resend the invoice or answer any questions.\n\nWith gratitude,\nFranklin D. Parham\nFrankly Inspired & Associates`,
    status:'draft', stage:e.stage, created:nowISO()});
  toast('Reminder drafted in the Outbox');
}

function revenueData(){
  const engs = list('engagements'); const d = today();
  const open = engs.filter(e => !e.archived && e.outcome!=='lost' && stageIdx(e.stage) < stageIdx('contracted'));
  const byStage = STAGES.slice(0,4).map(s => { const xs = open.filter(e=>e.stage===s.id); const v = xs.reduce((a,e)=>a+(+e.value||0),0); return {s, n:xs.length, v, p:PROB[s.id], w:v*PROB[s.id]}; });
  const weighted = byStage.reduce((a,r)=>a+r.w,0), openValue = byStage.reduce((a,r)=>a+r.v,0);
  const reachedIdx = e => Math.max(stageIdx(e.outcome==='lost' && e.lostStage ? e.lostStage : e.stage), ...stageHist(e).map(h=>stageIdx(h.s)));
  const funnel = STAGES.map((s,i) => ({s, n:engs.filter(e=>reachedIdx(e) >= i).length}));
  const won = engs.filter(e => stageIdx(e.stage) >= stageIdx('contracted') && e.outcome!=='lost');
  const lost = engs.filter(e => e.outcome==='lost');
  const winRate = (won.length+lost.length) ? won.length/(won.length+lost.length) : null;
  const cycles = won.map(e => { const h = stageHist(e); const a = h.find(x=>x.s==='lead'), b = h.find(x=>x.s==='contracted'); return a && b ? (new Date(b.at)-new Date(a.at))/86400000 : null; }).filter(v=>v!=null);
  const cycle = cycles.length ? cycles.reduce((a,b)=>a+b,0)/cycles.length : null;
  const src = {}; engs.forEach(e => { const k = (e.source||'').trim() || 'Not recorded'; const r = src[k] || (src[k] = {k, n:0, won:0, lost:0, rev:0}); r.n++; if(won.includes(e)){ r.won++; r.rev += +e.value||0; } if(e.outcome==='lost') r.lost++; });
  const reasons = {}; lost.forEach(e => { const k = e.lostReason || 'Not recorded'; reasons[k] = (reasons[k]||0)+1; });
  const invs = invList();
  const openInv = invs.filter(i => ['sent','overdue'].includes(invStatus(i)));
  const aging = {'Not yet due':0, '1–30 days late':0, '31–60 days late':0, '61–90 days late':0, '90+ days late':0};
  openInv.forEach(i => { const late = i.due ? daysBetween(i.due, d) : 0; const k = late<=0 ? 'Not yet due' : late<=30 ? '1–30 days late' : late<=60 ? '31–60 days late' : late<=90 ? '61–90 days late' : '90+ days late'; aging[k] += +i.amount||0; });
  const outstanding = openInv.reduce((a,i)=>a+(+i.amount||0),0);
  const overdue = openInv.filter(i=>invStatus(i)==='overdue').reduce((a,i)=>a+(+i.amount||0),0);
  const collected30 = invs.filter(i => i.paid && i.paid >= addDays(d,-30)).reduce((a,i)=>a+(+i.amount||0),0);
  const cash = [30,60,90].map(n => ({n, v: openInv.filter(i => !i.due || i.due <= addDays(d,n)).reduce((a,i)=>a+(+i.amount||0),0)}));
  const drafts$ = invs.filter(i=>invStatus(i)==='draft').reduce((a,i)=>a+(+i.amount||0),0);
  const unbilled = drafts$ + won.filter(e=>!e.archived).reduce((a,e)=>a+Math.max(0,(+e.value||0)-(e.invoices||[]).reduce((s,i)=>s+(+i.amount||0),0)),0);
  const alerts = [];
  engs.forEach(e => { if(e.archived || e.outcome==='lost') return; const i = stageIdx(e.stage); const dep = (e.invoices||[]).find(x=>x.kind==='deposit');
    if(i >= stageIdx('delivery') && i < stageIdx('sustain') && (!dep || !dep.paid)) alerts.push({sev:'hi', e, t:`Delivery has started but the deposit ${!dep ? 'was never invoiced' : invStatus(dep)==='draft' ? 'hasn’t been sent' : 'isn’t paid'}.`});
    if(i === stageIdx('contracted') && dep && invStatus(dep)==='draft' && e.stageAt && daysBetween(e.stageAt, d) >= 2) alerts.push({sev:'mid', e, t:`Signed ${daysBetween(e.stageAt,d)} days ago and the deposit invoice hasn’t gone out.`}); });
  openInv.filter(i=>invStatus(i)==='overdue').forEach(i => alerts.push({sev:'hi', e:i.e, inv:i, t:`${i.label} (${money(i.amount)}) is ${daysBetween(i.due,d)} days overdue.`}));
  return {byStage, weighted, openValue, funnel, won, lost, winRate, cycle, src:Object.values(src).sort((a,b)=>b.rev-a.rev || b.n-a.n), reasons, invs, openInv, aging, outstanding, overdue, collected30, cash, unbilled, alerts};
}
function viewRevenue(){
  const r = revenueData(); const d = today();
  const invRows = r.invs.filter(i=>i.e && !i.e.archived || invStatus(i)!=='paid').sort((a,b)=>({overdue:0,sent:1,draft:2,paid:3}[invStatus(a)] - {overdue:0,sent:1,draft:2,paid:3}[invStatus(b)]) || (a.due||'').localeCompare(b.due||''));
  const maxF = Math.max(1, ...r.funnel.map(f=>f.n));
  return `<section class="spread"><div><p class="eyebrow">Revenue</p><h1>Forecast, invoices and cash</h1>
    <p class="muted" style="max-width:72ch">What the pipeline is likely worth, where deals are won and lost, and what money is owed to you.</p></div>
    <button class="btn" data-act="export-inv">Export invoices (CSV)</button></section>
  <section class="kpis">
    <div class="kpi"><span class="v">${money(r.weighted)}</span><span class="l">Weighted pipeline (of ${money(r.openValue)} open)</span></div>
    <div class="kpi"><span class="v">${pct(r.winRate)}</span><span class="l">Win rate · ${r.won.length} won, ${r.lost.length} lost</span></div>
    <div class="kpi"><span class="v">${r.cycle!=null?Math.round(r.cycle)+'d':'–'}</span><span class="l">Lead to signed, average</span></div>
    <div class="kpi ${r.overdue?'alert':''}"><span class="v">${money(r.outstanding)}</span><span class="l">Owed to you${r.overdue?` · <b style="color:var(--bad)">${money(r.overdue)} overdue</b>`:''}</span></div>
    <div class="kpi"><span class="v">${money(r.collected30)}</span><span class="l">Collected, last 30 days</span></div>
  </section>
  ${r.alerts.length ? `<section class="panel"><h2 style="margin-bottom:10px">Needs attention</h2><div style="display:grid;gap:8px">${r.alerts.map(a=>`<div class="rec ${a.sev}"><span class="num">!</span><div><b><a href="#" data-act="open" data-id="${esc(a.e.id)}">${esc(a.e.org)}</a></b><div class="small">${esc(a.t)}</div>${a.inv?`<div><button class="btn sm" data-act="inv-remind" data-e="${esc(a.e.id)}" data-i="${esc(a.inv.id)}">Draft a reminder</button></div>`:''}</div></div>`).join('')}</div></section>` : ''}
  <section class="two">
    <div class="panel"><h2 style="margin-bottom:10px">Pipeline forecast</h2>
      <div class="matrix-wrap"><table class="def"><thead><tr><th>Stage</th><th>Clients</th><th>Value</th><th>Chance to sign</th><th>Weighted</th></tr></thead><tbody>
      ${r.byStage.map(x=>`<tr><td>${esc(x.s.name)}</td><td class="v">${x.n}</td><td class="v">${money(x.v)}</td><td class="v">${pct(x.p)}</td><td class="v"><b>${money(x.w)}</b></td></tr>`).join('')}
      <tr><td><b>Total</b></td><td class="v">${r.byStage.reduce((a,x)=>a+x.n,0)}</td><td class="v">${money(r.openValue)}</td><td></td><td class="v"><b>${money(r.weighted)}</b></td></tr></tbody></table></div>
      <p class="small muted" style="margin-top:8px">Chances are starting assumptions. Once 10+ clients have a decision, compare them with the real conversion rates on the right.</p></div>
    <div class="panel"><h2 style="margin-bottom:10px">Conversion by stage</h2>
      <div style="display:grid;gap:6px">${r.funnel.map((f,i)=>{ const prev = i ? r.funnel[i-1].n : null; return `<div class="row" style="gap:10px;flex-wrap:nowrap"><span class="small" style="width:84px">${esc(f.s.name)}</span><span class="bar2" style="flex:1;margin:0"><span class="fill" style="width:${(f.n/maxF*100).toFixed(0)}%;background:var(--navy)"></span></span><span class="num small" style="width:90px;text-align:right">${f.n}${prev?` · ${pct(f.n/prev)}`:''}</span></div>`; }).join('')}</div>
      <p class="small muted" style="margin-top:8px">How many clients ever reached each stage, and the share that made it from the stage before.</p></div>
  </section>
  <section class="two">
    <div class="panel"><h2 style="margin-bottom:10px">Where clients come from</h2>
      <table class="def"><thead><tr><th>Source</th><th>Leads</th><th>Won</th><th>Lost</th><th>Win rate</th><th>Revenue won</th></tr></thead><tbody>
      ${r.src.map(x=>`<tr><td>${esc(x.k)}</td><td class="v">${x.n}</td><td class="v">${x.won}</td><td class="v">${x.lost}</td><td class="v">${(x.won+x.lost)?pct(x.won/(x.won+x.lost)):'–'}</td><td class="v">${money(x.rev)}</td></tr>`).join('')}</tbody></table>
      ${Object.keys(r.reasons).length ? `<h3 style="margin:14px 0 6px">Why deals were lost</h3><div>${Object.entries(r.reasons).map(([k,v])=>`<span class="flag">${esc(k)} · ${v}</span>`).join('')}</div>` : ''}</div>
    <div class="panel"><h2 style="margin-bottom:10px">Cash</h2>
      <table class="def"><tbody>${Object.entries(r.aging).map(([k,v])=>`<tr><td>${esc(k)}</td><td class="v" style="${v&&k!=='Not yet due'?'color:var(--bad)':''}">${money(v)}</td></tr>`).join('')}</tbody></table>
      <h3 style="margin:14px 0 6px">Expected in</h3><div class="row">${r.cash.map(c=>`<span class="kpi" style="padding:8px 12px"><span class="v" style="font-size:18px">${money(c.v)}</span><span class="l">next ${c.n} days</span></span>`).join('')}</div>
      <p class="small muted" style="margin-top:8px">Counts invoices already sent, by due date. Another ${money(r.unbilled)} of signed work isn’t billed yet.</p></div>
  </section>
  <section class="panel"><h2 style="margin-bottom:10px">Invoices</h2><div class="matrix-wrap"><table class="def"><thead><tr><th>Client</th><th>Invoice</th><th>Amount</th><th>Status</th><th>Sent</th><th>Due</th><th>Paid</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
    ${invRows.map(i=>{ const s = invStatus(i); return `<tr><td><a href="#" data-act="open" data-id="${esc(i.e.id)}">${esc(i.e.org)}</a></td><td>${esc(i.label)}</td><td class="v">${money(i.amount)}</td>
      <td><span class="st" data-s="${s==='paid'?'done':s==='overdue'?'blocked':s==='sent'?'seen':'unassigned'}">${INV_LABEL[s]}</span></td><td class="v">${fmtDate(i.issued)||'–'}</td><td class="v">${fmtDate(i.due)||'–'}</td><td class="v">${fmtDate(i.paid)||'–'}</td>
      <td class="row" style="gap:4px;flex-wrap:nowrap">${s==='draft'?`<button class="btn sm" data-act="inv-sent" data-e="${esc(i.e.id)}" data-i="${esc(i.id)}">Mark sent</button>`:''}${s==='sent'||s==='overdue'?`<button class="btn sm accent" data-act="inv-paid" data-e="${esc(i.e.id)}" data-i="${esc(i.id)}">Mark paid</button>`:''}${s==='overdue'?`<button class="btn sm ghost" data-act="inv-remind" data-e="${esc(i.e.id)}" data-i="${esc(i.id)}">Remind</button>`:''}</td></tr>`; }).join('') || '<tr><td colspan="8" class="muted">Invoices appear when a client reaches Contracted (deposit) and Closeout (final).</td></tr>'}
  </tbody></table></div></section>`;
}

/* ---------- v5: task depth ---------- */
const depsOf = t => (t.needs||[]).map(id=>S.tasks[id]).filter(Boolean);
// A start-to-start link (t.depOpts[id].type === 'ss') only waits until the other task has started.
const openDeps = t => depsOf(t).filter(d => ((t.depOpts||{})[d.id]||{}).type === 'ss' ? !['in_progress','review','done','blocked'].includes(st(d)) : isOpen(d));
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function addComment(id, text){
  const t = S.tasks[id]; text = (text||'').trim(); if(!t || !text) return;
  const mentions = team().filter(m => new RegExp('@'+escRe(first(m.id))+'\\b','i').test(text)).map(m=>m.id);
  put('tasks', id, {...t, comments:[...(t.comments||[]).slice(-49), {at:nowISO(), by:S.me||'', text, mentions}]});
  const who = S.me ? first(S.me) : 'Someone';
  new Set([...mentions, t.owner, t.assignedBy].filter(Boolean)).forEach(p => notify(p, mentions.includes(p) ? `${who} mentioned you on “${t.title}”: ${text.slice(0,120)}` : `${who} commented on “${t.title}”: ${text.slice(0,120)}`, {task:id, eng:t.eng}, {email:mentions.includes(p)}));
}
function spawnRepeat(t){
  if(!t.repeat) return;
  const base = new Date((t.due||today())+'T12:00:00');
  if(t.repeat==='monthly') base.setMonth(base.getMonth()+1); else base.setDate(base.getDate() + (t.repeat==='biweekly' ? 14 : 7));
  const nid = createTask({title:t.title, eng:t.eng, owner:t.owner, due:iso(base), lane:t.lane, stage:t.stage, src:'repeat', est:t.est, tpl:t.tpl, extra: t.project ? {project:t.project, section:(S.projects[t.project]&&S.projects[t.project].sections[0].id)||t.section||'', parent:t.parent||'', assignees:t.assignees||[], custom:{...(t.custom||{})}, files:[]} : null});
  const n = S.tasks[nid]; put('tasks', nid, {...n, repeat:t.repeat, checklist:(t.checklist||[]).map(c=>({t:c.t, done:false}))});
}
function onTaskDone(id){
  const t = S.tasks[id]; if(!t) return;
  list('tasks').filter(x => (x.needs||[]).includes(id) && isOpen(x)).forEach(x => { if(!openDeps(x).length && x.owner) notify(x.owner, `Ready to start: ${x.title} (“${t.title}” is done)`, {task:x.id, eng:x.eng}, {email:true}); });
  spawnRepeat(t); autoInvoiceFromTask(t);
}

/* ---------- v5: list view, timelines, search ---------- */
function filteredTasks(){
  const f = S.lf, q = f.q.trim().toLowerCase(), d = today();
  let xs = list('tasks').filter(t => !t.cancelled);
  if(f.status==='open') xs = xs.filter(isOpen); else if(f.status) xs = xs.filter(t=>st(t)===f.status);
  if(f.owner) xs = xs.filter(t => (t.owner||'') === (f.owner==='_q' ? '' : f.owner));
  if(f.eng) xs = xs.filter(t => t.eng===f.eng);
  if(f.fn==='none') xs = xs.filter(t => !t.fn && loggedMin(t)>0); else if(f.fn) xs = xs.filter(t => t.fn===f.fn);
  if(f.due==='late') xs = xs.filter(t => isOpen(t) && t.due < d); else if(f.due==='week') xs = xs.filter(t => t.due >= d && t.due <= addDays(d,7));
  if(q) xs = xs.filter(t => (t.title||'').toLowerCase().includes(q) || ((S.engagements[t.eng]||{}).org||'').toLowerCase().includes(q) || mname(t.owner).toLowerCase().includes(q));
  const k = S.ls.k, dir = S.ls.dir;
  const val = t => k==='title' ? (t.title||'') : k==='client' ? ((S.engagements[t.eng]||{}).org||'~') : k==='owner' ? mname(t.owner) : k==='status' ? STATUSES.findIndex(s=>s.id===st(t)) : k==='est' ? (+t.est||0) : k==='logged' ? loggedMin(t) : (t.due||'9999');
  return xs.sort((a,b) => { const A = val(a), B = val(b); return (A>B?1:A<B?-1:0)*dir; });
}
function listView(){
  const f = S.lf; const xs = filteredTasks(); const ms = team();
  const th = (k,l) => `<th><button class="btn sm ghost" data-act="lsort" data-k="${k}" style="padding:2px 4px">${l}${S.ls.k===k?(S.ls.dir>0?' ▲':' ▼'):''}</button></th>`;
  const totH = xs.reduce((a,t)=>a+hrs(t),0), totE = xs.reduce((a,t)=>a+(+t.est||0),0);
  return `<section class="panel" style="display:grid;gap:12px">
    <div class="row">
      <input id="lf-q" placeholder="Search tasks, clients, people" value="${esc(f.q)}" style="flex:1;min-width:0;flex-basis:200px;border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--bg)">
      <select id="lf-owner" data-lf="owner" aria-label="Owner"><option value="">Anyone</option><option value="_q" ${f.owner==='_q'?'selected':''}>Team queue</option>${ms.map(m=>`<option value="${m.id}" ${f.owner===m.id?'selected':''}>${esc(m.name)}</option>`).join('')}</select>
      <select id="lf-status" data-lf="status" aria-label="Status"><option value="open" ${f.status==='open'?'selected':''}>All open</option><option value="" ${f.status===''?'selected':''}>Any status</option>${STATUSES.map(s=>`<option value="${s.id}" ${f.status===s.id?'selected':''}>${s.name}</option>`).join('')}</select>
      <select id="lf-eng" data-lf="eng" aria-label="Client"><option value="">Any client</option>${list('engagements').map(e=>`<option value="${e.id}" ${f.eng===e.id?'selected':''}>${esc(e.org)}</option>`).join('')}</select>
      ${fnOn() ? `<select id="lf-fn" data-lf="fn" aria-label="Function"><option value="">Any function</option><option value="none" ${f.fn==='none'?'selected':''}>Time not tagged</option>${FNS.map(([k,n])=>`<option value="${k}" ${f.fn===k?'selected':''}>${n}</option>`).join('')}</select>` : ''}
      <select id="lf-due" data-lf="due" aria-label="Due"><option value="">Any date</option><option value="late" ${f.due==='late'?'selected':''}>Late</option><option value="week" ${f.due==='week'?'selected':''}>Due this week</option></select>
      <button class="btn" data-act="export-tasks">Export CSV</button>
    </div>
    <div class="small muted">${xs.length} task${xs.length===1?'':'s'} · ${fmtH(totH)} logged of ${fmtH(totE)} planned</div>
    <div class="matrix-wrap"><table class="def"><thead><tr>${th('title','Task')}${th('client','Client')}${th('owner','Owner')}${th('status','Status')}${th('due','Due')}${th('est','Planned')}${th('logged','Logged')}</tr></thead><tbody>
      ${xs.slice(0,300).map(t=>{ const e=S.engagements[t.eng]; const w=openDeps(t); return `<tr class="trow" data-act="task" data-id="${esc(t.id)}" style="cursor:pointer"><td>${esc(t.title)}${w.length?` <span class="small muted">· waiting on ${w.length}</span>`:''}${(typeof msgCount==='function'?msgCount('task:'+t.id):(t.comments||[]).length)?` <span class="small muted">· ${typeof msgCount==='function'?msgCount('task:'+t.id):(t.comments||[]).length} comment${(typeof msgCount==='function'?msgCount('task:'+t.id):(t.comments||[]).length)>1?'s':''}</span>`:''}</td><td class="small">${e?esc(e.org.replace(/^Sample:\s*/,'')):'–'}</td><td><span class="row" style="gap:6px;flex-wrap:nowrap">${av(t.owner)}<span class="small">${esc(t.owner?first(t.owner):'Queue')}</span></span></td><td>${stPill(st(t))}</td><td><span class="due ${lateCls(t)}">${isOpen(t)?fmtDate(t.due):'Done'}</span></td><td class="v">${+t.est?fmtH(+t.est):'–'}</td><td class="v">${loggedMin(t)?fmtH(hrs(t)):'–'}</td></tr>`; }).join('') || '<tr><td colspan="7" class="muted">No tasks match.</td></tr>'}
    </tbody></table></div></section>`;
}
function exportTasks(){
  const rows = [['Task','Client','Owner','Status','Stage','Due','Done','Planned hours','Logged hours',...(S.canCoach?['Cost ($)']:[]),'Waiting on','Comments']];
  filteredTasks().forEach(t => { const e = S.engagements[t.eng]; rows.push([t.title, e?e.org:'', mname(t.owner), stName(st(t)), stageName(t.stage||''), t.due||'', (t.doneAt||'').slice(0,10), +t.est||0, +hrs(t).toFixed(2), ...(S.canCoach?[Math.round(taskCost(t))]:[]), openDeps(t).map(x=>x.title).join('; '), (t.comments||[]).length]); });
  saveFile(`flow-hub-tasks-${today()}.csv`, toCsv(rows));
}
function exportInvoices(){
  const rows = [['Client','Offer','Invoice','Amount','Status','Sent','Due','Paid']];
  invList().forEach(i => rows.push([i.e.org, i.e.offer, i.label, +i.amount||0, INV_LABEL[invStatus(i)], i.issued||'', i.due||'', i.paid||'']));
  saveFile(`flow-hub-invoices-${today()}.csv`, toCsv(rows));
}
const stageColor = i => `color-mix(in srgb, var(--accent) ${Math.round(i/7*100)}%, var(--navy))`;
function timelineView(){
  const d = today(); const start = addDays(d, -91), end = addDays(d, 28); const span = daysBetween(start, end);
  const x = s => Math.max(0, Math.min(100, daysBetween(start, (s||d).slice(0,10)) / span * 100));
  const engs = list('engagements').filter(e => { const h = stageHist(e); return !(e.archived && h.length && h[h.length-1].at.slice(0,10) < start); })
    .sort((a,b) => (stageHist(a)[0]||{at:''}).at.localeCompare((stageHist(b)[0]||{at:''}).at));
  const ticks = []; for(let i=0;i<=span;i+=14) ticks.push(addDays(start,i));
  const rows = engs.map(e => { const segs = stageSegs(e);
    const bars = segs.map(sg => { const h = stageHist(e).find(z=>z.s===sg.s); const s0 = h ? h.at : e.created; const s1 = sg.closed ? new Date(new Date(s0).getTime()+sg.days*86400000).toISOString() : (e.archived||e.outcome==='lost' ? (e.lostAt||e.updated) : nowISO());
      const l = x(s0), r = x(s1); if(r<=0 || l>=100) return ''; const over = sg.days > (STAGES[stageIdx(sg.s)]||{}).target*1.25;
      return `<span class="tl-seg" style="left:${l}%;width:${Math.max(0.6,r-l)}%;background:${stageColor(stageIdx(sg.s))};${over?'outline:2px solid var(--bad);outline-offset:-2px':''}" title="${esc(stageName(sg.s))}: ${fmtD(sg.days)}${over?' (over target)':''}"></span>`; }).join('');
    return `<div class="tl-row"><button class="tl-label" data-act="open" data-id="${esc(e.id)}">${esc(e.org.replace(/^Sample:\s*/,''))}<span class="small muted"> · ${e.outcome==='lost'?'Lost':esc(stageName(e.stage))}</span></button><div class="tl-track">${bars}<span class="tl-today" style="left:${x(d)}%"></span></div></div>`; }).join('');
  return `<section class="panel"><div class="spread" style="margin-bottom:10px"><h2>Client timeline</h2><div class="legend">${STAGES.map((s,i)=>`<span><i style="background:${stageColor(i)}"></i>${s.name}</span>`).join('')}<span><i style="outline:2px solid var(--bad)"></i>Over target</span></div></div>
    <div class="tl"><div class="tl-row tl-axis"><span class="tl-label"></span><div class="tl-track">${ticks.map(t=>`<span class="tl-tick" style="left:${x(t)}%">${fmtDate(t)}</span>`).join('')}<span class="tl-tick" style="left:${x(d)}%;color:var(--accent);font-weight:600">Today</span></div></div>${rows || '<div class="empty">No clients in this window.</div>'}</div></section>`;
}
function clientTimeline(e){
  const segs = stageSegs(e); if(!segs.length) return '';
  const h = stageHist(e); const start = h[0].at.slice(0,10); const tasks = list('tasks').filter(t=>t.eng===e.id && !t.cancelled);
  const endD = [today(), ...tasks.map(t=>t.due||'')].sort().pop(); const span = Math.max(7, daysBetween(start, endD)+2);
  const x = s => Math.max(0, Math.min(100, daysBetween(start, (s||today()).slice(0,10))/span*100));
  const stageBar = segs.map((sg,i) => { const s0 = h[i].at, s1 = h[i+1] ? h[i+1].at : nowISO(); return `<span class="tl-seg" style="left:${x(s0)}%;width:${Math.max(0.8,x(s1)-x(s0))}%;background:${stageColor(stageIdx(sg.s))}" title="${esc(stageName(sg.s))}: ${fmtD(sg.days)}"></span>`; }).join('');
  const tbars = tasks.sort((a,b)=>(a.created||'').localeCompare(b.created||'')).slice(-14).map(t => { const o = mem(t.owner); const a = x(t.created), b = x(isOpen(t) ? (t.due > today() ? t.due : today()) : t.doneAt);
    return `<div class="tl-row mini"><span class="tl-label small" title="${esc(t.title)}">${esc(t.title.length>34?t.title.slice(0,32)+'…':t.title)}</span><div class="tl-track"><span class="tl-seg" style="left:${a}%;width:${Math.max(0.8,b-a)}%;background:${o?esc(o.color):'var(--muted)'};opacity:${isOpen(t)?1:.45}"></span></div></div>`; }).join('');
  return `<div><h3 style="margin-bottom:8px">Timeline</h3><div class="tl"><div class="tl-row mini"><span class="tl-label small"><b>Stages</b></span><div class="tl-track">${stageBar}<span class="tl-today" style="left:${x(today())}%"></span></div></div>${tbars}</div></div>`;
}
function runSearch(q){
  const box = $('#gres'); q = (q||'').trim().toLowerCase();
  if(!q){ box.hidden = true; box.innerHTML = ''; return; }
  const cs = list('engagements').filter(e => (e.org+' '+(e.contact||'')).toLowerCase().includes(q)).slice(0,5);
  const ts = list('tasks').filter(t => !t.cancelled && (t.title||'').toLowerCase().includes(q)).sort((a,b)=>isOpen(b)-isOpen(a)).slice(0,6);
  const ps = team().filter(m => m.name.toLowerCase().includes(q)).slice(0,3);
  box.innerHTML = [...cs.map(e=>`<button data-act="open" data-id="${esc(e.id)}"><span class="eyebrow">Client</span> ${esc(e.org)} <span class="small muted">${esc(stageName(e.stage))}</span></button>`),
    ...ts.map(t=>`<button data-act="task" data-id="${esc(t.id)}"><span class="eyebrow">Task</span> ${esc(t.title)} <span class="small muted">${esc(stName(st(t)))}</span></button>`),
    ...ps.map(m=>`<button data-act="person-tasks" data-id="${esc(m.id)}"><span class="eyebrow">Person</span> ${esc(m.name)} <span class="small muted">open tasks</span></button>`)].join('') || '<div class="small muted" style="padding:10px">No matches</div>';
  box.hidden = false;
}

/* ---------- v5: outputs ---------- */
function weeklySummary(){
  const d = today(), since = addDays(d,-7), engs = list('engagements'), tasks = list('tasks').filter(t=>!t.cancelled);
  const doneT = tasks.filter(t => !isOpen(t) && (t.doneAt||'').slice(0,10) >= since);
  const byP = {}; doneT.forEach(t => { const k = t.owner ? first(t.owner) : 'Queue'; byP[k] = (byP[k]||0)+1; });
  const moves = engs.flatMap(e => stageHist(e).filter(h => h.s!=='lead' && h.at.slice(0,10) >= since).map(h => `${e.org.replace(/^Sample:\s*/,'')} → ${stageName(h.s)}`));
  const leads = engs.filter(e => (e.created||'').slice(0,10) >= since);
  const lost = engs.filter(e => e.outcome==='lost' && (e.lostAt||'').slice(0,10) >= since);
  const blocked = tasks.filter(t => st(t)==='blocked');
  const late = tasks.filter(t => isOpen(t) && t.due < d);
  const next = tasks.filter(t => isOpen(t) && t.due >= d && t.due <= addDays(d,7));
  const paid = invList().filter(i => i.paid && i.paid >= since);
  const overdue = invList().filter(i => invStatus(i)==='overdue');
  const hoursWk = tasks.reduce((a,t)=>a+(t.timeLog||[]).filter(x=>(x.at||'').slice(0,10)>=since).reduce((s,x)=>s+(+x.min||0),0),0)/60;
  const rv = revenueData();
  const L = [];
  L.push(`Frankly Inspired weekly summary: ${fmtDate(since)} to ${fmtDate(d)}`, '');
  L.push('PIPELINE', `- Weighted pipeline: ${money(rv.weighted)} across ${rv.byStage.reduce((a,x)=>a+x.n,0)} open clients`, `- New leads: ${leads.length}${leads.length?` (${leads.map(e=>e.org.replace(/^Sample:\s*/,'')).join(', ')})`:''}`);
  if(moves.length) L.push(`- Moved forward: ${moves.join('; ')}`); if(lost.length) L.push(`- Lost: ${lost.map(e=>`${e.org.replace(/^Sample:\s*/,'')} (${e.lostReason})`).join('; ')}`);
  L.push('', 'WORK', `- Finished: ${doneT.length} tasks${Object.keys(byP).length?` (${Object.entries(byP).map(([k,v])=>`${k} ${v}`).join(', ')})`:''}`, `- Hours logged: ${fmtH(hoursWk)}`, `- Late right now: ${late.length}`);
  if(blocked.length) L.push(`- Blocked: ${blocked.map(t=>{ const h=(t.history||[]).slice().reverse().find(x=>x.to==='blocked'); return `${t.title}${h&&h.note?` (${h.note})`:''}`; }).join('; ')}`);
  L.push('', 'MONEY', `- Collected this week: ${money(paid.reduce((a,i)=>a+(+i.amount||0),0))}`, `- Owed to us: ${money(rv.outstanding)}${overdue.length?`, overdue: ${overdue.map(i=>`${i.e.org.replace(/^Sample:\s*/,'')} ${money(i.amount)}`).join('; ')}`:''}`);
  if(rv.alerts.length) L.push(`- Watch: ${rv.alerts.slice(0,3).map(a=>`${a.e.org.replace(/^Sample:\s*/,'')}: ${a.t}`).join(' ')}`);
  L.push('', 'NEXT 7 DAYS', `- ${next.length} tasks due${next.length?`: ${next.slice(0,8).map(t=>`${t.title} (${t.owner?first(t.owner):'queue'}, ${fmtDate(t.due)})`).join('; ')}`:''}`, '', `Open Flow Hub: ${HUB_URL}`);
  return {subject:`Weekly summary: ${fmtDate(since)} to ${fmtDate(d)}`, text:L.join('\n')};
}
function openSummary(){
  const s = weeklySummary(); const to = team().map(m=>m.email).filter(Boolean);
  $('#sumBody').innerHTML = `<div class="spread"><h2>${esc(s.subject)}</h2><button class="btn ghost" data-act="close-dlg" data-dlg="sumDlg" aria-label="Close">✕</button></div>
    <pre style="white-space:pre-wrap;font:13px/1.5 var(--f-body);background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:12px;max-height:55vh;overflow:auto">${esc(s.text)}</pre>
    <div class="row" style="justify-content:space-between"><span class="small muted">${to.length?`Goes to ${to.length} teammate${to.length>1?'s':''} with an email on file.`:'Add teammate emails on the Team page to email this.'}</span>
    <span class="row"><button class="btn" data-act="sum-copy">Copy</button>${to.length?`<button class="btn primary" data-act="sum-email">Email the team from my Gmail</button>`:''}</span></div>`;
  $('#sumDlg').showModal();
}
function clientReport(eid){
  const e = S.engagements[eid]; if(!e) return; const d = today(); const since = addDays(d,-14);
  const ts = list('tasks').filter(t => t.eng===eid && !t.cancelled && t.lane!=='finance');
  const done = ts.filter(t => !isOpen(t) && (t.doneAt||'').slice(0,10) >= since);
  const next = ts.filter(t => isOpen(t)).sort((a,b)=>(a.due||'').localeCompare(b.due||'')).slice(0,5);
  const need = [];
  gateState(e, e.stage).filter(g => !g.done && /Documents|received|Agreement signed|Deposit paid|accepted/.test(g.t)).forEach(g => need.push(g.t==='Documents received' ? 'Your last three 990s, current financials and board list' : g.t==='Agreement signed' ? 'Your signature on the agreement' : g.t==='Deposit paid' ? 'Payment of the deposit invoice' : 'Your sign-off on the deliverables'));
  ts.filter(t=>st(t)==='blocked').forEach(t => { const h=(t.history||[]).slice().reverse().find(x=>x.to==='blocked'); if(h && h.note) need.push(h.note); });
  const invs = (e.invoices||[]).filter(i=>['sent','overdue'].includes(invStatus(i)));
  const firstName = (e.contact||'').split(/\s+/)[0] || 'there';
  const body = [`Hi ${firstName},`, '', `Here is where we are on ${OFFERS[e.offer]||'our work together'} for ${e.org.replace(/^Sample:\s*/,'')}.`, '', `Current stage: ${stageName(e.stage)}`, '',
    'Done in the last two weeks:', ...(done.length ? done.map(t=>'- '+t.title.replace(e.org,'').replace(/ for\s*$| with\s*$/,'').trim()) : ['- Groundwork and preparation']), '',
    'Coming up next:', ...(next.length ? next.map(t=>`- ${t.title.replace(e.org,'').replace(/ for\s*$| with\s*$/,'').trim()} (by ${fmtDate(t.due)})`) : ['- We will confirm next steps together']), '',
    ...(need.length ? ['What we need from you:', ...[...new Set(need)].map(n=>'- '+n), ''] : []),
    ...(invs.length ? ['Invoices:', ...invs.map(i=>`- ${i.label}: ${money(i.amount)}, due ${fmtDate(i.due)}`), ''] : []),
    'Thank you for the partnership. Reply with any questions, or grab time here: '+CAL, '', 'With gratitude,', 'Franklin D. Parham', 'Frankly Inspired & Associates'].join('\n');
  put('messages', uid(), {eng:eid, lane:'client', ch:'email', to:e.email||'', toName:e.contact||e.org, subj:`${e.org.replace(/^Sample:\s*/,'')}: project update, ${fmtDate(d)}`, body, status:'draft', stage:e.stage, created:nowISO(), kind:'status-report'});
  toast('Status update drafted in the Outbox');
}

/* ---------- v5: anonymous pulse, trends ---------- */
function anonStats(days=7){
  const since = addDays(today(), -days+1); const xs = Object.values(S.anon||{}).filter(a => (a.date||'') >= since);
  if(xs.length < 3) return {n:xs.length, ok:false};
  const avg = xs.reduce((s,a)=>s+(+a.energy||0),0)/xs.length; const heavy = xs.filter(a=>a.load==='heavy').length/xs.length;
  return {n:xs.length, ok:true, avg, heavy};
}
function weeksBack(n=12){ const base = new Date(today()+'T12:00:00'); const off = (base.getDay()+6)%7; base.setDate(base.getDate()-off); const ws = []; for(let i=n-1;i>=0;i--){ const d = new Date(base); d.setDate(base.getDate()-i*7); ws.push(iso(d)); } return ws; }
function trendData(){
  const ws = weeksBack(12); const hours = ws.map(()=>0), done = ws.map(()=>0);
  const idx = s => { const d = (s||'').slice(0,10); for(let i=ws.length-1;i>=0;i--){ if(d >= ws[i]) return d < addDays(ws[i],7) ? i : -1; } return -1; };
  list('tasks').forEach(t => { (t.timeLog||[]).forEach(x => { const i = idx(x.at); if(i>=0) hours[i] += (+x.min||0)/60; }); if(!isOpen(t) && t.doneAt && !t.cancelled){ const i = idx(t.doneAt); if(i>=0) done[i]++; } });
  return {ws, hours, done};
}
function barSvg(vals, labels, fmt, title){
  const w = 520, h = 160, pl = 40, pb = 24, pt = 14, pr = 8; const max = Math.max(1, ...vals); const nice = Math.ceil(max/ (max>20?10:max>5?5:1)) * (max>20?10:max>5?5:1);
  const bw = (w-pl-pr)/vals.length; const y = v => pt + (h-pt-pb)*(1-v/nice);
  const grid = [0, nice/2, nice].map(g => `<line x1="${pl}" x2="${w-pr}" y1="${y(g)}" y2="${y(g)}" stroke="var(--line)"/><text x="${pl-6}" y="${y(g)+4}" text-anchor="end" font-size="10" fill="var(--muted)">${fmt(g)}</text>`).join('');
  const bars = vals.map((v,i) => `<rect x="${(pl+i*bw+bw*0.18).toFixed(1)}" y="${y(v).toFixed(1)}" width="${(bw*0.64).toFixed(1)}" height="${Math.max(0,(h-pb)-y(v)).toFixed(1)}" rx="2" fill="${i===vals.length-1?'var(--accent)':'var(--navy)'}" opacity="${i===vals.length-1?1:.75}"><title>${esc(labels[i])}: ${fmt(v)}</title></rect>`).join('');
  const xl = labels.map((l,i) => i%3===0 || i===labels.length-1 ? `<text x="${(pl+i*bw+bw/2).toFixed(1)}" y="${h-6}" text-anchor="middle" font-size="10" fill="var(--muted)">${esc(l)}</text>` : '').join('');
  const last = vals[vals.length-1];
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="${esc(title)}" style="max-width:560px;display:block">${grid}${bars}${xl}<text x="${w-pr}" y="${Math.max(10,y(last)-4)}" text-anchor="end" font-size="11" font-weight="600" fill="var(--accent)">${fmt(last)}</text></svg>`;
}
