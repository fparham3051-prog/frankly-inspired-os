/* ---------- activity log (append-only per person) ---------- */
const AUDIT_SKIP = new Set(['onboardDismissed']);
function audit(action, detail){
  const k = myKey(); if(!k) return; const id = uid();
  const e = {at:nowISO(), by:S.me||'', action:String(action).slice(0,80), detail:String(detail||'').slice(0,300)};
  S.audit[k] = {...(S.audit[k]||{}), [id]:{...e, id}};
  if(DB) queueWrite(`audit/${k}/${id}`, async()=>{ await DB.doc('audit/'+k).collection('entries').doc(id).set(e); }); else saveLocal();
}
function auditRows(){ return Object.values(S.audit).flatMap(m => Object.values(m||{})).sort((a,b)=>(b.at||'').localeCompare(a.at||'')); }
function auditPanel(){
  if(!S.canCoach) return '';
  const rows = auditRows().slice(0,120);
  return `<section class="panel"><div class="spread" style="margin-bottom:8px"><div><h2>Activity log</h2><p class="small muted">Sensitive changes: setup, playbooks, rates, privacy, deletions, restores, overrides and payments. Each person’s entries are append-only; no one else can edit them.</p></div><button class="btn sm" data-act="export-audit">Export (CSV)</button></div>
    <div class="matrix-wrap" style="max-height:360px;overflow:auto"><table class="def"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Detail</th></tr></thead><tbody>
    ${rows.map(r=>`<tr><td class="small num">${fmtWhen(r.at)}</td><td class="small">${esc(mname(r.by))}</td><td><b>${esc(r.action)}</b></td><td class="small">${esc(r.detail)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nothing logged yet.</td></tr>'}
    </tbody></table></div></section>`;
}
function exportAudit(){ saveFile(`flow-hub-activity-${today()}.csv`, toCsv([['When','Who','What','Detail'], ...auditRows().map(r=>[r.at, mname(r.by), r.action, r.detail])])); }

/* ---------- usage tracking (evidence) ---------- */
let usageBuf = null, usageTimer = null;
const FEATURES = {advance:'Move an item forward', 'new':'Add an item', 'new-task':'Create a task', tstat:'Update task status', 'timer-start':'Time tracking', 'gmail-send':'Send from Gmail', 'gcal-push':'Google Calendar sync', one:'Plan a 1:1', 'pulse-save':'Daily check-in', 'client-report':'Client status update', summary:'Weekly summary', 'export-fn':'Expense allocation export', 'export-tasks':'Task export', 'inv-paid':'Record a payment', 'apply-cal':'Refine estimates', 'tpl-apply':'Apply a template', backup:'Backup'};
function track(kind, name){
  if(!S.me || !name) return; const k = myKey(); if(!k) return; const d = today(); const id = 'u-'+d;
  if(!usageBuf || usageBuf.id!==id || usageBuf.k!==k){ if(usageBuf) flushUsage(); const prev = (S.usage[k]||{})[id]; usageBuf = {id, k, doc: prev ? JSON.parse(JSON.stringify(strip(prev))) : {date:d, member:S.me, views:{}, acts:{}}}; }
  const m = usageBuf.doc[kind==='view' ? 'views' : 'acts']; m[name] = (m[name]||0)+1; usageBuf.doc.member = S.me;
  clearTimeout(usageTimer); usageTimer = setTimeout(flushUsage, 15000);
}
function flushUsage(){
  if(!usageBuf) return; const {k, id, doc} = usageBuf; clearTimeout(usageTimer);
  S.usage[k] = {...(S.usage[k]||{}), [id]:{...doc, id}};
  if(DB) queueWrite(`usage/${k}/${id}`, async()=>{ await DB.doc('usage/'+k).collection('days').doc(id).set(doc); }); else saveLocal();
}
document.addEventListener('visibilitychange', () => { if(document.hidden) flushUsage(); });
function usageDays(){ return Object.values(S.usage).flatMap(m => Object.values(m||{})); }

/* ---------- feedback + recommendation score ---------- */
function saveFeedback(kind, text, score){
  const k = myKey(); if(!k){ toast('Sign in to send feedback'); return false; } const id = uid();
  const e = {at:nowISO(), by:S.me||'', kind, text:String(text||'').trim().slice(0,1000), score: score==null ? null : +score, view:S.view};
  S.fb[k] = {...(S.fb[k]||{}), [id]:{...e, id}};
  if(DB) queueWrite(`feedback/${k}/${id}`, async()=>{ await DB.doc('feedback/'+k).collection('items').doc(id).set(e); }); else saveLocal();
  return true;
}
function fbRows(){ return Object.values(S.fb).flatMap(m => Object.values(m||{})).sort((a,b)=>(b.at||'').localeCompare(a.at||'')); }
function openFeedback(){
  $('#fbBody').innerHTML = `<form id="fbForm" style="display:grid;gap:12px"><div class="spread"><h2>Suggest an improvement</h2><button type="button" class="btn ghost" data-act="close-dlg" data-dlg="fbDlg" aria-label="Close">✕</button></div>
    <div class="seg" role="group" aria-label="Kind">${[['idea','Idea'],['problem','Something’s wrong'],['praise','This helped']].map(([k,l],i)=>`<label style="padding:6px 12px;cursor:pointer"><input type="radio" name="fbk" value="${k}" ${i===0?'checked':''}> ${l}</label>`).join('')}</div>
    <textarea id="fb-text" required placeholder="What would make the hub better for you? Mention the page or step." style="min-height:120px;border:1px solid var(--line);border-radius:8px;padding:10px;background:var(--bg)"></textarea>
    <p class="small muted">Goes to the workspace lead, with the page you were on (${esc(S.view)}).</p>
    <div class="row" style="justify-content:flex-end"><button class="btn primary" type="submit">Send</button></div></form>`;
  $('#fbDlg').showModal();
}
function npsDue(){
  if(!S.me) return false; const k = myKey(); if(!k) return false;
  try{ const snooze = localStorage.getItem('fii-nps-snooze'); if(snooze && snooze > today()) return false; }catch(_){}
  const days = Object.values(S.usage[k]||{}).length; if(days < 10) return false;
  const last = Object.values(S.fb[k]||{}).filter(f=>f.kind==='nps').sort((a,b)=>(b.at||'').localeCompare(a.at||''))[0];
  return !last || last.at.slice(0,10) < addDays(today(), -90);
}
function npsCard(){
  if(!npsDue()) return '';
  return `<section class="panel" style="display:grid;gap:10px"><div class="spread"><h2>How likely are you to recommend the hub to a colleague?</h2><button class="btn sm ghost" data-act="nps-later">Ask me later</button></div>
    <div class="scale" role="group" aria-label="0 to 10">${[...Array(11)].map((_,i)=>`<button type="button" data-act="nps" data-v="${i}" style="min-width:44px"><b>${i}</b></button>`).join('')}</div>
    <input id="nps-why" placeholder="The main reason (optional)" style="border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--bg)">
    <p class="small muted">0 = not at all likely, 10 = extremely likely. Takes 10 seconds and shapes what gets built next.</p></section>`;
}
function nps(rows){ const xs = rows.filter(f=>f.kind==='nps' && f.score!=null && (f.at||'').slice(0,10) >= addDays(today(),-90)); if(!xs.length) return {n:0}; const pro = xs.filter(f=>f.score>=9).length, det = xs.filter(f=>f.score<=6).length; return {n:xs.length, score:Math.round((pro-det)/xs.length*100)}; }

/* ---------- product health view ---------- */
function evidenceLevel(h){
  const st = S.settings || {}; const pilots = +st.pilotsActive||0, paying = +st.payingOrgs||0, ret = +st.retention6m||0;
  if(paying>=20 && ret>=90 && h.nps.n>=10 && h.nps.score>=50) return 10;
  if(paying>=20 && ret>=90) return 9; if(paying>=10) return 8; if(paying>=3) return 7; if(pilots>=3) return 5; if(pilots>=1) return 4;
  if(h.leadDays>=30 && h.realItems>=5) return 3; if(h.leadDays>=10) return 2; return 1;
}
function healthData(){
  const d = today(); const days = usageDays(); const realTeam = team().filter(m=>!/^Sample:/.test(m.name));
  const active7 = new Set(days.filter(x=>x.date>=addDays(d,-6)).map(x=>x.member)).size;
  const perPerson = realTeam.map(m => ({m, days: days.filter(x=>x.member===m.id && x.date>=addDays(d,-13)).length, total: days.filter(x=>x.member===m.id).length}));
  const acts = {}; days.filter(x=>x.date>=addDays(d,-29)).forEach(x => Object.entries(x.acts||{}).forEach(([k,v]) => acts[k] = (acts[k]||0)+v));
  const views = {}; days.filter(x=>x.date>=addDays(d,-29)).forEach(x => Object.entries(x.views||{}).forEach(([k,v]) => views[k] = (views[k]||0)+v));
  const lead = leadId(); const leadDays = days.filter(x=>x.member===lead).length;
  const realItems = list('engagements').filter(e=>!/^Sample:/.test(e.org||'')).length;
  const rows = fbRows(); const h = {active7, teamN:realTeam.length, perPerson, acts, views, leadDays, realItems, fb:rows, nps:nps(rows)};
  h.level = evidenceLevel(h); return h;
}
function viewHealth(){
  if(!S.canCoach) return `<section><h1>Product health</h1><p class="muted">Only the workspace lead sees product health. You can still <button class="btn sm" data-act="feedback">suggest an improvement</button>.</p></section>`;
  const h = healthData(); const st = S.settings||{};
  const used = Object.keys(FEATURES).map(k => ({k, n:h.acts[k]||0, l:FEATURES[k]})).sort((a,b)=>b.n-a.n);
  const ladder = [[1,'Built, no real use yet'],[2,'Lead using it 10+ days'],[3,'30 days of use in your practice, 5+ real items'],[4,'1 pilot organization active'],[5,'3 pilots active'],[7,'3 organizations paying'],[8,'10 paying'],[9,'20 paying, 90% still paying after 6 months'],[10,'Plus a recommendation score of 50+ from 10+ people']];
  return `<section class="spread"><div><p class="eyebrow">Product</p><h1>Product health</h1><p class="muted" style="max-width:72ch">The evidence that the hub works: who uses it, which features earn their place, and what people say. This is the number that moves the product score now.</p></div><button class="btn" data-act="feedback">Suggest an improvement</button></section>
  <section class="kpis">
    <div class="kpi"><span class="v">${h.active7}/${h.teamN||0}</span><span class="l">People active this week</span></div>
    <div class="kpi"><span class="v">${h.leadDays}</span><span class="l">Days you’ve used it</span></div>
    <div class="kpi"><span class="v">${h.realItems}</span><span class="l">Real ${esc(LBL.entities)} (not samples)</span></div>
    <div class="kpi"><span class="v">${h.nps.n?h.nps.score:'–'}</span><span class="l">Recommendation score${h.nps.n?` · ${h.nps.n} answers`:' · asked after 10 days of use'}</span></div>
    <div class="kpi attn"><span class="v">${h.level}/10</span><span class="l">Evidence score</span></div>
  </section>
  <section class="two">
    <div class="panel"><h2 style="margin-bottom:8px">Evidence ladder</h2><div style="display:grid;gap:6px">${ladder.map(([n,t])=>`<div class="row small" style="flex-wrap:nowrap"><span class="num" style="width:26px;color:${h.level>=n?'var(--ok)':'var(--muted)'}">${h.level>=n?'✓':n}</span><span style="${h.level>=n?'':'color:var(--muted)'}">${esc(t)}</span></div>`).join('')}</div>
      <div class="form" style="margin-top:12px"><label>Pilots active<input id="ev-p" type="number" min="0" data-ev="pilotsActive" value="${+st.pilotsActive||0}"></label><label>Paying organizations<input id="ev-pay" type="number" min="0" data-ev="payingOrgs" value="${+st.payingOrgs||0}"></label><label>Still paying after 6 months (%)<input id="ev-r" type="number" min="0" max="100" data-ev="retention6m" value="${+st.retention6m||0}"></label></div></div>
    <div class="panel"><h2 style="margin-bottom:8px">Who’s using it (last 14 days)</h2><table class="def"><tbody>${h.perPerson.map(p=>`<tr><td>${av(p.m.id)} ${esc(p.m.name)}</td><td class="v">${p.days} of 14 days</td><td><span class="meter"><span style="width:${p.days/14*100}%;background:${p.days>=7?'var(--ok)':p.days>=3?'var(--warn)':'var(--bad)'}"></span></span></td></tr>`).join('') || '<tr><td class="muted">Add teammates to see this.</td></tr>'}</tbody></table>
      <p class="small muted" style="margin-top:8px">Counted when someone opens a page or uses a feature, kept per day. Nothing about what they typed.</p></div>
  </section>
  <section class="two">
    <div class="panel"><h2 style="margin-bottom:8px">Features, last 30 days</h2><table class="def"><tbody>${used.map(u=>`<tr><td>${esc(u.l)}</td><td class="v" style="${u.n?'':'color:var(--muted)'}">${u.n||'not used'}</td></tr>`).join('')}</tbody></table>
      <p class="small muted" style="margin-top:8px">Unused features are candidates to simplify, explain better, or cut.</p></div>
    <div class="panel"><h2 style="margin-bottom:8px">What people said</h2><div style="display:grid;gap:8px;max-height:420px;overflow:auto">${h.fb.map(f=>`<div class="small" style="border-bottom:1px solid var(--line);padding-bottom:6px"><span class="flag ${f.kind==='problem'?'hi':f.kind==='praise'?'ok':''}" style="margin-right:6px">${f.kind==='nps'?`Score ${f.score}`:esc(f.kind)}</span>${esc(f.text||'(no comment)')}<div class="muted">${esc(mname(f.by))} · ${fmtWhen(f.at)}${f.view?` · on ${esc(f.view)}`:''}</div></div>`).join('') || '<div class="empty">No feedback yet. The “?” menu and this page both have a feedback button.</div>'}</div></div>
  </section>`;
}

/* ---------- guided setup ---------- */
const WIZ_PAINS = [['slip','Deadlines slip'],['owner','Unclear who owns what'],['waiting','Waiting on documents or approvals'],['reporting','Funder reporting takes too long'],['burnout','Staff stretched thin'],['cost','Don’t know the true cost of programs'],['followup','Follow-up with people falls through']];
function openWizard(){
  const w = S.wiz = S.wiz || {work:(S.model&&S.model.template)||'consulting', size:'3-5', budget:'250k-1m', pains:[], score:'', name:LBL.orgName||'', sender:LBL.sender||''};
  const opt = (k, v, l) => `<label class="switch" style="border:1px solid var(--line);border-radius:8px;padding:8px 10px"><input type="radio" name="wz-${k}" value="${v}" ${w[k]===v?'checked':''}>${l}</label>`;
  $('#wizBody').innerHTML = `<form id="wizForm" style="display:grid;gap:14px"><div class="spread"><div><span class="eyebrow">Guided setup · about 3 minutes</span><h2>Set up the hub around your organization</h2></div><button type="button" class="btn ghost" data-act="close-dlg" data-dlg="wizDlg" aria-label="Close">✕</button></div>
    <div><b>1. What does your team mostly manage?</b><div class="row" style="margin-top:6px">${opt('work','consulting','Clients you serve for a fee')}${opt('work','grants','Grants and funders')}${opt('work','programs','Participants in programs')}${opt('work','gifts','Donors and major gifts')}</div></div>
    <div><b>2. How many people will use it?</b><div class="row" style="margin-top:6px">${['1-2','3-5','6-15','16+'].map(v=>opt('size',v,v)).join('')}</div></div>
    <div><b>3. Annual budget</b><div class="row" style="margin-top:6px">${[['<250k','Under $250K'],['250k-1m','$250K–$1M'],['1m-5m','$1M–$5M'],['5m+','$5M+']].map(([v,l])=>opt('budget',v,l)).join('')}</div></div>
    <div><b>4. What hurts most right now?</b> <span class="small muted">Pick up to 3</span><div class="row" style="margin-top:6px">${WIZ_PAINS.map(([k,l])=>`<label class="switch" style="border:1px solid var(--line);border-radius:8px;padding:8px 10px"><input type="checkbox" name="wz-pain" value="${k}" ${w.pains.includes(k)?'checked':''}>${l}</label>`).join('')}</div></div>
    <div class="form"><label>5. InstitutionalOS readiness score (optional, 0–100)<input id="wz-score" type="number" min="0" max="100" value="${esc(w.score)}"></label><label>Workspace name<input id="wz-name" value="${esc(w.name)}"></label><label>Sender name for messages<input id="wz-sender" value="${esc(w.sender)}"></label></div>
    <div class="row" style="justify-content:flex-end"><button class="btn primary" type="submit">See my recommended setup</button></div></form>`;
  $('#wizDlg').showModal();
}
function wizPlan(w){
  const t = templates()[w.work] || templates().consulting; const small = w.size==='1-2'; const big = w.size==='6-15' || w.size==='16+';
  const plan = {template:t.id, changes:[], privacy:{checkins:!small, taskPulse:!small, retros:true, anon:!small, coaching:!small}, fnOn: t.id!=='consulting' || w.pains.includes('cost'), gates:[], rhythms:false, focus:''};
  plan.changes.push(`Use the <b>${esc(t.name)}</b> template: ${t.stages.map(s=>esc(s.name)).join(' → ')}`);
  plan.changes.push(small ? 'People features off for now (check-ins and 1:1s make more sense with 3+ people). Turn them on anytime in Privacy & data.' : 'Daily check-ins, task pulses and 1:1 coaching on, anonymous check-ins allowed.');
  if(plan.fnOn) plan.changes.push('Tag staff time as program, management and general, or fundraising, for Form 990 and grant reports.');
  if(w.pains.includes('waiting')){ plan.gates.push(['discovery','Documents requested'],['diagnostic','Documents received']); plan.changes.push('Add “Documents requested” and “Documents received” to the exit checklists, so items can’t stall silently.'); }
  if(w.pains.includes('slip') || w.pains.includes('owner') || big){ plan.rhythms = true; plan.changes.push('Add a daily 15-minute stand-up and a weekly pipeline review to the shared calendar.'); }
  if(w.pains.includes('owner')) plan.changes.push('Every playbook task gets an owner or lands in the team queue. Assign the role owners on the Team page next.');
  if(w.pains.includes('reporting')){ plan.fnOn = true; plan.changes.push('Turn on funding-source tagging and the grant cost report export.'); }
  if(w.pains.includes('burnout') && small){ plan.privacy.checkins = true; plan.changes.push('Keep daily check-ins on anyway, since stretched teams are why they exist.'); }
  if(w.pains.includes('followup')) plan.changes.push('Playbooks already draft follow-up messages at each stage. Review them in Setup → Playbooks.');
  const sc = w.score==='' ? null : +w.score;
  plan.focus = sc==null ? '' : sc < 50 ? 'Your readiness score suggests starting simple: use the pipeline, My day and the Team board for the first month before turning on more.' : sc < 75 ? 'Solid base. Add time tracking in week two, so Insights has data by month two.' : 'Strong base. Turn on everything, including Insights and expense allocation, from day one.';
  return plan;
}
function showWizPlan(){
  const w = S.wiz; const p = S.wizPlan = wizPlan(w);
  $('#wizBody').innerHTML = `<div class="spread"><div><span class="eyebrow">Recommended setup</span><h2>${esc(w.name||'Your workspace')}</h2></div><button type="button" class="btn ghost" data-act="close-dlg" data-dlg="wizDlg" aria-label="Close">✕</button></div>
    <ul class="agenda" style="font-size:14.5px">${p.changes.map(c=>`<li>${c}</li>`).join('')}</ul>
    ${p.focus ? `<div class="prompt">${esc(p.focus)}</div>` : ''}
    <p class="small muted">Applying replaces stages, checklists, offers and playbooks with the template’s. Your existing items, tasks and people stay.</p>
    <div class="row" style="justify-content:space-between"><button class="btn ghost" data-act="wiz-back">Back</button><button class="btn primary" data-act="wiz-apply">Apply this setup</button></div>`;
}
function applyWizard(){
  const w = S.wiz, p = S.wizPlan; if(!p) return; const t = templates()[p.template];
  const m = modelFromTemplate(p.template, {orgName:w.name, sender:w.sender});
  m.privacy = {...PRIV_DEFAULT, ...p.privacy}; m.fnOn = p.fnOn; m.diagnostic = {score: w.score===''?null:+w.score, size:w.size, budget:w.budget, pains:w.pains, at:nowISO()};
  p.gates.forEach(([sid, label]) => { const s = m.stages.find(x=>x.id===sid); if(s && !s.gates.some(g=>g.toLowerCase()===label.toLowerCase())) s.gates = [...s.gates, label]; });
  saveConfig('model', m); saveConfig('recipes', {list:JSON.parse(JSON.stringify(t.recipes))}); applyModel(m);
  if(p.rhythms && !list('events').some(e=>e.type==='rhythm')){
    const mon = (() => { const d = new Date(today()+'T12:00:00'); d.setDate(d.getDate() - ((d.getDay()+6)%7)); return iso(d); })();
    put('events', uid(), {title:'Daily stand-up: today’s work and blockers', date:mon, start:'10:30', end:'10:45', repeat:'weekdays', type:'rhythm', eng:'', att:[], createdBy:S.me||''});
    put('events', uid(), {title:`${cap(LBL.entity)} pipeline and capacity review`, date:mon, start:'11:00', end:'11:45', repeat:'weekly', type:'rhythm', eng:'', att:[], createdBy:S.me||''});
  }
  audit('Applied guided setup', `${t.name}; team ${w.size}; budget ${w.budget}; pains: ${w.pains.join(', ')||'none'}`);
  $('#wizDlg').close(); S.draftModel = null; toast('Your workspace is set up'); render();
}
