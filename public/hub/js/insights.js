/* ---------- time, cost and insights ---------- */
const DEFAULT_RATE = 60;
const rcfg = () => S.rates || {};
const rateOf = id => { const r = (rcfg().rates||{})[id]; return r && +r.cost ? +r.cost : (+rcfg().defaultRate || DEFAULT_RATE); };
const targetMargin = () => { const v = rcfg().targetMargin; return v==null || isNaN(+v) ? 0.5 : +v; };
function loggedMin(t){ let m = (t.timeLog||[]).reduce((s,x)=>s+(+x.min||0),0); if(t.timerStart) m += Math.max(0,(Date.now()-new Date(t.timerStart))/60000); return m; }
const hrs = t => loggedMin(t)/60;
const fmtH = h => h==null || isNaN(h) ? '–' : h===0 ? '0h' : h<1 ? Math.round(h*60)+'m' : (Math.round(h*10)/10)+'h';
const fmtD = d => d==null || isNaN(d) ? '–' : d<1 ? Math.round(d*24)+'h' : d.toFixed(1)+'d';
const taskCost = t => (t.timeLog||[]).reduce((s,x)=>s+(+x.min||0)/60*rateOf(x.by||t.owner),0) + (t.timerStart ? Math.max(0,(Date.now()-new Date(t.timerStart))/3600000)*rateOf(t.timerBy||t.owner) : 0);
const hoursBetween = (a,b) => (!a||!b) ? null : (new Date(b)-new Date(a))/3600000;
function blockedH(t){ let m = +t.blockedMin||0; if(st(t)==='blocked' && t.blockedAt) m += Math.max(0,(Date.now()-new Date(t.blockedAt))/60000); return m/60; }
const $$ = v => v==null || isNaN(v) ? '–' : money(v);
const pct = v => v==null || isNaN(v) ? '–' : Math.round(v*100)+'%';

function stopOtherTimers(exceptId){ list('tasks').filter(x=>x.timerStart && x.timerBy===S.me && x.id!==exceptId).forEach(x=>stopTimer(x.id, true)); }
function startTimer(id){ const t = S.tasks[id]; if(!t || !S.me || t.timerStart) return; stopOtherTimers(id); put('tasks', id, {...S.tasks[id], timerStart:nowISO(), timerBy:S.me}); toast('Timer running'); }
function closeTimer(t){ if(!t.timerStart) return {}; const min = Math.max(1, Math.round((Date.now()-new Date(t.timerStart))/60000)); return {timerStart:null, timerBy:null, timeLog:[...(t.timeLog||[]).slice(-49), {at:nowISO(), by:t.timerBy||S.me||'', min, src:'timer'}]}; }
function stopTimer(id, quiet){ const t = S.tasks[id]; if(!t || !t.timerStart) return; const c = closeTimer(t); put('tasks', id, {...t, ...c}); if(!quiet) toast(`Logged ${fmtH(c.timeLog[c.timeLog.length-1].min/60)}`); }
function logTime(id, h, note){ const t = S.tasks[id]; if(!t || !(h>0)) return false; put('tasks', id, {...t, timeLog:[...(t.timeLog||[]).slice(-49), {at:nowISO(), by:S.me||t.owner||'', min:Math.round(h*60), src:'manual', note:note||''}]}); return true; }

function stageHist(e){
  if(Array.isArray(e.stageHistory) && e.stageHistory.length) return e.stageHistory;
  const out = [];
  (e.log||[]).forEach(l => { if(l.k!=='stage') return;
    if(/^Added as Lead/.test(l.t||'')) out.push({s:'lead', at:l.at});
    const m = /moved to (\w+)/i.exec(l.t||''); if(m){ const s = STAGES.find(x=>x.name.toLowerCase()===m[1].toLowerCase()); if(s) out.push({s:s.id, at:l.at}); } });
  if(!out.length && e.created) out.push({s:e.stage, at:e.created});
  return out;
}
function stageSegs(e){ const h = stageHist(e); return h.map((x,i)=>{ const end = h[i+1] ? h[i+1].at : null; return {e:e.id, s:x.s, days: Math.max(0,(new Date(end||nowISO())-new Date(x.at))/86400000), closed: !!end}; }); }

const CATS = [
  {id:'finance', name:'Invoicing & payments', re:/invoice|payment|deposit|bookkeep/i, sys:'QuickBooks Online or Stripe Invoicing', why:'Creates the deposit and final invoice automatically when a client reaches Contracted or Closeout, adds a payment link, and reconciles payments.', save:0.7},
  {id:'scheduling', name:'Scheduling', re:/schedul|calendar/i, sys:'Calendly + Google Calendar sync', why:'Clients pick their own time, and the event lands on the team calendar with no back-and-forth.', save:0.6},
  {id:'research', name:'Prospect & 990 research', re:/research|990|board list|financials/i, sys:'ProPublica Nonprofit Explorer or Candid', why:'Pulls filings and financial history in minutes instead of digging through websites and PDFs.', save:0.5},
  {id:'diagnostic', name:'Diagnostic scoring', re:/score|console|assessment|dimension|decision band|readiness/i, sys:'InstitutionalOS Console (keep), synced into Flow Hub', why:'This is your product. Sending scores straight into the client record removes retyping.', save:0.25},
  {id:'setup', name:'Project setup', re:/folder|set up|setup/i, sys:'Google Drive folder template', why:'One click copies the standard client folder and project plan.', save:0.6},
  {id:'documents', name:'Proposals & reports', re:/proposal|report|deliverable|narrative|draft/i, sys:'Google Docs templates filled from the client record, drafted with Claude', why:'Every proposal and final report starts 70% written.', save:0.4},
  {id:'comms', name:'Client communication', re:/reply|email|follow up|status note|check-in|testimonial|send/i, sys:'Gmail connected to the Outbox', why:'Drafts already exist. Sending from the hub logs the touchpoint automatically.', save:0.35},
  {id:'delivery', name:'Advisory & facilitation', re:/./, sys:'Flow Hub (keep as is)', why:'This is the work clients pay for. Protect it rather than automate it.', save:0}
];
const catOf = t => CATS.find(c => c.re.test(t.title||''));

function outputStats(id, days=14){
  const since = addDays(today(),-days);
  const all = list('tasks').filter(t=>t.owner===id);
  const done = all.filter(t=>!isOpen(t) && (t.doneAt||'').slice(0,10)>=since);
  const ontime = done.filter(t=>(t.doneAt||'').slice(0,10) <= (t.due||'9999')).length;
  const minutes = list('tasks').reduce((s,t)=>s+(t.timeLog||[]).filter(x=>(x.at||'').slice(0,10)>=since && (x.by||t.owner)===id).reduce((a,x)=>a+(+x.min||0),0),0);
  const withEst = done.filter(t=>+t.est>0 && loggedMin(t)>0);
  const ratio = withEst.length ? withEst.reduce((s,t)=>s+hrs(t),0)/withEst.reduce((s,t)=>s+(+t.est),0) : null;
  const lags = all.filter(t=>t.seenAt && t.seenAt.slice(0,10)>=since).map(t=>hoursBetween(t.assignedAt||t.created, t.seenAt)).filter(v=>v!=null && v>=0);
  const lag = lags.length ? lags.reduce((a,b)=>a+b,0)/lags.length : null;
  return {done:done.length, ontime: done.length ? ontime/done.length : null, hours:minutes/60, ratio, lag, cost:minutes/60*rateOf(id)};
}
function outputCoach(id){
  const o = outputStats(id), tips = [];
  const ds = team().map(m=>outputStats(m.id).done).sort((a,b)=>a-b); const med = ds.length ? ds[Math.floor(ds.length/2)] : 0;
  const opens = team().map(m=>list('tasks').filter(t=>t.owner===m.id && isOpen(t)).length).sort((a,b)=>a-b); const medOpen = opens.length ? opens[Math.floor(opens.length/2)] : 0;
  const myOpen = list('tasks').filter(t=>t.owner===id && isOpen(t)).length;
  if(o.ontime!=null && o.ontime<0.6) tips.push({hi:true, t:`Only ${pct(o.ontime)} of their work is done on time. Re-sort priorities together and drop or delay one thing.`});
  if(o.ratio!=null && o.ratio>1.4) tips.push({t:`Their work takes about ${o.ratio.toFixed(1)}× the estimate. Coach on scoping, or fix the playbook estimate.`});
  if(o.ratio!=null && o.ratio<0.7) tips.push({t:`They finish in ${pct(o.ratio)} of the estimated time. They're ready for more complex work.`});
  if(o.lag!=null && o.lag>24) tips.push({t:`Assignments wait ${Math.round(o.lag)}h before they open them. Agree to check My day at the 10:30 stand-up.`});
  if(myOpen < medOpen && (o.ontime==null || o.ontime>=0.8)) tips.push({t:'Load is light and work lands on time. Offer a stretch assignment.'});
  if(!tips.length && o.done) tips.push({ok:true, t:`Steady: ${o.done} done${o.ontime!=null?`, ${pct(o.ontime)} on time`:''}. Name the win specifically.`});
  return {o, tips};
}
const outputLine = o => `${o.done} done · ${pct(o.ontime)} on time · ${fmtH(o.hours)} logged · ${o.ratio!=null?o.ratio.toFixed(1)+'× estimate':'no estimates yet'}${o.lag!=null?` · opens tasks in ${fmtH(o.lag)}`:''}`;

function calibration(){
  const out = [];
  recipes().forEach(r => (r.tasks||[]).forEach((x,i) => {
    const acts = list('tasks').filter(t=>!isOpen(t) && t.tpl===x.t && t.stage===r.stage && loggedMin(t)>0).map(hrs).sort((a,b)=>a-b);
    const med = acts.length ? (acts.length%2 ? acts[(acts.length-1)/2] : (acts[acts.length/2-1]+acts[acts.length/2])/2) : null;
    out.push({stage:r.stage, i, tpl:x.t, est:+x.e||0, n:acts.length, med, sug: med!=null ? Math.max(0.25, Math.round(med*4)/4) : null});
  }));
  return out;
}
function applyCalibration(){
  const cal = calibration().filter(c=>c.n && c.sug!=null && c.sug!==c.est);
  if(!cal.length){ toast('Estimates already match actuals'); return; }
  const R = JSON.parse(JSON.stringify(recipes()));
  cal.forEach(c => { const r = R.find(x=>x.stage===c.stage); if(r && r.tasks[c.i]) r.tasks[c.i].e = c.sug; });
  saveConfig('recipes', {list:R}); toast(`${cal.length} playbook estimate${cal.length===1?'':'s'} updated from real data`); render();
}

function insightData(){
  const win = S.insWin; const since = win ? addDays(today(),-win) : '0000-00-00';
  const inWin = x => (x||'').slice(0,10) >= since;
  const tasks = list('tasks'), engs = list('engagements');
  const ent = tasks.flatMap(t => (t.timeLog||[]).filter(x=>inWin(x.at)).map(x=>({t, h:(+x.min||0)/60, by:x.by||t.owner})));
  const totalH = ent.reduce((s,x)=>s+x.h,0), totalCost = ent.reduce((s,x)=>s+x.h*rateOf(x.by),0);
  const doneT = tasks.filter(t=>!isOpen(t) && inWin(t.doneAt));
  const est = doneT.filter(t=>+t.est>0 && loggedMin(t)>0);
  const ratio = est.length ? est.reduce((s,t)=>s+hrs(t),0)/est.reduce((s,t)=>s+(+t.est),0) : null;
  const econ = engs.map(e => { const ts = tasks.filter(t=>t.eng===e.id); const h = ts.reduce((s,t)=>s+hrs(t),0), c = ts.reduce((s,t)=>s+taskCost(t),0), v = +e.value||0;
    return {e, h, c, v, margin: v ? (v-c)/v : null, eff: h ? v/h : null, won: stageIdx(e.stage)>=stageIdx('contracted'), done: stageIdx(e.stage)>=stageIdx('closeout')}; }).filter(x=>x.h>0).sort((a,b)=>b.h-a.h);
  const won = econ.filter(x=>x.won); const wonH = won.reduce((s,x)=>s+x.h,0);
  const effRate = wonH ? won.reduce((s,x)=>s+x.v,0)/wonH : null;
  const closed = econ.filter(x=>x.done);
  const avgMargin = closed.length ? closed.reduce((s,x)=>s+(x.margin||0),0)/closed.length : null;
  const segs = engs.flatMap(stageSegs);
  const stageRows = STAGES.map(s => {
    const cl = segs.filter(x=>x.s===s.id && x.closed); const days = cl.length ? cl.reduce((a,x)=>a+x.days,0)/cl.length : null;
    const ts = tasks.filter(t=>t.stage===s.id); const h = ts.reduce((a,t)=>a+hrs(t),0), c = ts.reduce((a,t)=>a+taskCost(t),0), bh = ts.reduce((a,t)=>a+blockedH(t),0);
    const lags = ts.filter(t=>t.seenAt).map(t=>hoursBetween(t.assignedAt||t.created, t.seenAt)).filter(v=>v!=null && v>=0);
    const cyc = ts.filter(t=>!isOpen(t) && t.doneAt).map(t=>hoursBetween(t.created, t.doneAt)/24);
    return {s, days, n:cl.length, live:segs.filter(x=>x.s===s.id && !x.closed).length, h, c, bh, lag: lags.length ? lags.reduce((a,b)=>a+b,0)/lags.length : null, cycle: cyc.length ? cyc.reduce((a,b)=>a+b,0)/cyc.length : null};
  });
  const catRows = CATS.map(c => { const ts = tasks.filter(t=>catOf(t)===c && loggedMin(t)>0); const h = ts.reduce((a,t)=>a+hrs(t),0), cost = ts.reduce((a,t)=>a+taskCost(t),0);
    const lead = leadId(); const leadH = ts.filter(t=>t.owner===lead).reduce((a,t)=>a+hrs(t),0);
    return {c, n:ts.length, h, cost, leadH, saveH:h*c.save, saveCost:cost*c.save}; }).filter(r=>r.n).sort((a,b)=>b.cost-a.cost);
  return {totalH, totalCost, ratio, econ, effRate, avgMargin, stageRows, catRows, doneT, tasks};
}
function recommendations(d){
  const recs = []; const seeMoney = S.canCoach;
  // 1. slowest phase vs target
  const sr = d.stageRows.filter(r=>r.days!=null && r.s.target);
  if(sr.length){ const top = sr.reduce((a,b)=> (b.days/b.s.target) > (a.days/a.s.target) ? b : a);
    if(top.days > top.s.target*1.25){ const waiting = top.bh > top.h*0.5; const prev = STAGES[Math.max(0, stageIdx(top.s.id)-1)];
      recs.push({sev: top.n>=5?'hi':'mid', n:top.n, unit:'finished client stays', title:`${top.s.name} is your bottleneck`, ev:`Clients spend ${fmtD(top.days)} in ${top.s.name} against a ${top.s.target}-day target (${(top.days/top.s.target).toFixed(1)}× over).${top.bh?` Tasks there sat blocked for ${fmtH(top.bh)}, compared with ${fmtH(top.h)} of actual work.`:''}`,
        act: waiting ? `Most of the delay is waiting on clients. Request documents during ${prev.name}, and make “documents received” part of ${prev.name}’s exit rule.` : `The work itself is heavy. Template it and split it across two people.`}); } }
  // 2. estimates drift
  const cal = calibration().filter(c=>c.n && c.med!=null && c.est);
  const under = cal.filter(c=>c.med > c.est*1.3), over = cal.filter(c=>c.med < c.est*0.7);
  if(under.length) recs.push({sev:'mid', n:under.reduce((a,c)=>a+c.n,0), unit:'finished tasks', title:'Playbook estimates are too low', ev: under.slice(0,3).map(c=>`“${c.tpl.replace(/\{\{(\w+)\}\}/g,'‹$1›')}” planned ${fmtH(c.est)}, actually ${fmtH(c.med)}`).join('; ') + (under.length>3?` and ${under.length-3} more.`:'.'), act:'Apply the learned estimates below, so capacity planning and pricing use real numbers.', applyCal:true});
  if(over.length) recs.push({sev:'low', n:over.reduce((a,c)=>a+c.n,0), unit:'finished tasks', title:'Some estimates are too high', ev: over.slice(0,2).map(c=>`“${c.tpl.replace(/\{\{(\w+)\}\}/g,'‹$1›')}” planned ${fmtH(c.est)}, actually ${fmtH(c.med)}`).join('; ')+'.', act:'Tighten these estimates to free capacity for new clients.', applyCal:true});
  // 3. delegation
  const lead = leadId(); if(lead){ const lt = d.tasks.filter(t=>t.owner===lead && loggedMin(t)>0 && (['associates','finance'].includes(t.lane) || ['research','finance','setup','scheduling'].includes((catOf(t)||{}).id)));
    const h = lt.reduce((a,t)=>a+hrs(t),0);
    if(h>=1){ const others = team().filter(m=>m.id!==lead); const alt = others.length ? Math.min(...others.map(m=>rateOf(m.id))) : rateOf(lead);
      recs.push({sev:'hi', n:lt.length, unit:'tasks', title:`${first(lead)} is doing work that could be handed off`, ev:`${fmtH(h)} logged by ${first(lead)} on research, setup, scheduling or finance tasks${seeMoney?` (${money(h*rateOf(lead))} at your rate)`:''}.`, act: seeMoney ? `Delegating these saves about ${money(h*(rateOf(lead)-alt))} and gives back ${fmtH(h)} for selling and advising.` : `Delegate these and give the time back to selling and advising.`}); } }
  // 4. margin by offer
  if(seeMoney){ Object.keys(OFFERS).forEach(k => { const xs = d.econ.filter(x=>x.done && x.e.offer===k); if(!xs.length) return; const m = xs.reduce((a,x)=>a+(x.margin||0),0)/xs.length;
    if(m < targetMargin()){ const avgH = xs.reduce((a,x)=>a+x.h,0)/xs.length; const avgV = xs.reduce((a,x)=>a+x.v,0)/xs.length; const avgC = xs.reduce((a,x)=>a+x.c,0)/xs.length;
      const needPrice = avgC/(1-targetMargin());
      recs.push({sev: xs.length>=3?'hi':'mid', n:xs.length, unit:'finished clients', title:`${k} engagements are under your ${pct(targetMargin())} margin target`, ev:`Across ${xs.length} finished ${k} engagement${xs.length===1?'':'s'}: ${money(avgV)} average fee, ${fmtH(avgH)} of work, ${money(avgC)} of labor. That's a ${pct(m)} margin.`, act:`Either price ${k} at about ${money(Math.ceil(needPrice/500)*500)}, or cut about ${fmtH(avgH*(1-(avgV*(1-targetMargin()))/avgC))} per engagement (start with the bottleneck phase).`}); } }); }
  // 5. acknowledgement lag
  const lags = d.tasks.filter(t=>t.seenAt && t.owner).map(t=>hoursBetween(t.assignedAt||t.created, t.seenAt)).filter(v=>v!=null && v>=0);
  const lag = lags.length ? lags.reduce((a,b)=>a+b,0)/lags.length : null;
  if(lag!=null && lag>12) recs.push({sev:'mid', n:lags.length, unit:'tasks', title:'Assigned work sits before anyone opens it', ev:`On average, tasks wait ${fmtH(lag)} between being assigned and the owner tapping “Got it”.`, act:'Review everyone’s “Needs your OK” list at the 10:30 stand-up, and aim for under 4 hours.'});
  // 6. automation
  d.catRows.filter(r=>r.c.save>0 && r.h>=2).slice(0,2).forEach(r => recs.push({sev:'mid', n:r.n, unit:'tasks', title:`Automate ${r.c.name.toLowerCase()}`, ev:`${fmtH(r.h)} across ${r.n} tasks${seeMoney?` (${money(r.cost)})`:''}.`, act:`${r.c.save>=0.4?'Moving it to':'Connecting it with'} ${r.c.sys.replace(/ \(keep\)/,'')} could save about ${fmtH(r.saveH)}${seeMoney?` (${money(r.saveCost)})`:''} at the same volume. That saving is an assumption; confirm it after one month.`}));
  // 7. rework
  const re = d.tasks.filter(t=>+t.reopened>0); if(re.length>=2) recs.push({sev:'low', n:re.length, unit:'tasks', title:'Work is being reopened', ev:`${re.length} tasks were reopened after being marked done.`, act:'Use “Send for review” on client-facing work so it gets checked before it’s closed.'});
  const ov = list('engagements').filter(e=>+e.overrides>0); if(ov.length>=2) recs.push({sev:'mid', n:ov.length, unit:'clients', title:'Exit checklists are being skipped', ev:`${ov.length} clients moved forward with exit items still open.`, act:'Either the checklist asks for the wrong things, or the team is rushing. Review the items at the Monday pipeline meeting.'});
  return recs;
}

function viewInsights(){
  const d = insightData(); const seeMoney = S.canCoach; const recs = recommendations(d);
  const wins = [[30,'30 days'],[90,'90 days'],[0,'All time']];
  const maxDays = Math.max(1, ...d.stageRows.map(r=>Math.max(r.days||0, r.s.target||0)));
  const stageTable = `<div class="panel"><div class="spread" style="margin-bottom:10px"><h2>Time in each phase</h2><span class="small muted">All clients, all time</span></div>
    <div class="matrix-wrap"><table class="def"><thead><tr><th>Phase</th><th>Avg time in phase vs target</th><th>Work logged</th>${seeMoney?'<th>Labor cost</th>':''}<th>Blocked</th><th>Time to open</th><th>Task cycle</th></tr></thead><tbody>
    ${d.stageRows.map(r=>{ const over = r.days!=null && r.s.target && r.days > r.s.target*1.25;
      return `<tr><td><b>${esc(r.s.name)}</b><div class="small muted">${r.n} finished${r.live?` · ${r.live} now`:''}</div></td>
      <td style="min-width:190px"><div class="bar2"><span class="tgt" style="left:${(r.s.target/maxDays*100).toFixed(1)}%" title="Target ${r.s.target} days"></span><span class="fill" style="width:${((r.days||0)/maxDays*100).toFixed(1)}%;background:${over?'var(--bad)':'var(--navy)'}"></span></div>
        <span class="small num">${fmtD(r.days)} <span class="muted">/ ${r.s.target}d target</span></span></td>
      <td class="v">${fmtH(r.h)}</td>${seeMoney?`<td class="v">${$$(r.c)}</td>`:''}<td class="v" style="${r.bh>r.h*0.5&&r.bh?'color:var(--bad)':''}">${fmtH(r.bh)}</td><td class="v">${fmtH(r.lag)}</td><td class="v">${fmtD(r.cycle)}</td></tr>`; }).join('')}
    </tbody></table></div><p class="small muted" style="margin-top:8px">“Time to open” is how long a task waits before its owner taps “Got it”. “Task cycle” runs from creation to done.</p></div>`;
  const econTable = seeMoney ? `<div class="panel"><h2 style="margin-bottom:10px">What each engagement really earned</h2><div class="matrix-wrap"><table class="def"><thead><tr><th>Client</th><th>Fee</th><th>Hours</th><th>Labor cost</th><th>Margin</th><th>Earned per hour</th></tr></thead><tbody>
    ${d.econ.map(x=>`<tr><td><a href="#" data-act="open" data-id="${esc(x.e.id)}">${esc(x.e.org)}</a><div class="small muted">${esc(x.e.offer)} · ${esc(stageName(x.e.stage))}</div></td><td class="v">${money(x.v)}</td><td class="v">${fmtH(x.h)}</td><td class="v">${money(x.c)}</td>
      <td class="v" style="color:${x.margin==null?'inherit':x.margin<targetMargin()?'var(--bad)':'var(--ok)'}">${x.won?pct(x.margin):'<span class="muted">not won yet</span>'}</td><td class="v">${x.eff?money(x.eff)+'/h':'–'}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Log time on tasks to see this.</td></tr>'}
    </tbody></table></div></div>` : '';
  const sysTable = `<div class="panel"><h2 style="margin-bottom:4px">Which system fits each kind of work</h2><p class="small muted" style="margin-bottom:10px">Tasks are grouped by what they are, then matched to the tool that fits. Savings are estimates to check after a month.</p>
    <div class="matrix-wrap"><table class="def"><thead><tr><th>Kind of work</th><th>Time spent</th>${seeMoney?'<th>Cost</th>':''}<th>Best-fit system</th><th>Possible saving</th></tr></thead><tbody>
    ${d.catRows.map(r=>`<tr><td><b>${esc(r.c.name)}</b><div class="small muted">${r.n} tasks${r.leadH?` · ${fmtH(r.leadH)} by ${esc(first(leadId()))}`:''}</div></td><td class="v">${fmtH(r.h)}</td>${seeMoney?`<td class="v">${money(r.cost)}</td>`:''}
      <td><b>${esc(r.c.sys)}</b><div class="small muted">${esc(r.c.why)}</div></td><td class="v">${r.c.save?`${fmtH(r.saveH)}${seeMoney?`<br>${money(r.saveCost)}`:''}`:'–'}</td></tr>`).join('') || `<tr><td colspan="5" class="muted">Log time on tasks to see this.</td></tr>`}
    </tbody></table></div></div>`;
  const cal = calibration();
  const calTable = `<div class="panel"><div class="spread" style="margin-bottom:4px"><h2>Refine the model</h2>${S.canCoach?`<button class="btn primary sm" data-act="apply-cal">Apply learned estimates</button>`:''}</div>
    <p class="small muted" style="margin-bottom:10px">Every finished playbook task teaches the system how long that kind of work really takes. Applying the learned estimates updates the playbooks, so future capacity planning and pricing use real numbers.</p>
    <div class="matrix-wrap"><table class="def"><thead><tr><th>Stage</th><th>Playbook task</th><th>Planned</th><th>Actual (median)</th><th>Samples</th><th>Suggested</th></tr></thead><tbody>
    ${cal.map(c=>{ const drift = c.med!=null && c.est ? c.med/c.est : null; return `<tr><td>${esc(stageName(c.stage))}</td><td class="small">${esc(c.tpl.replace(/\{\{(\w+)\}\}/g,'‹$1›'))}</td><td class="v">${fmtH(c.est)}</td>
      <td class="v" style="${drift&&drift>1.3?'color:var(--bad)':drift&&drift<0.7?'color:var(--ok)':''}">${fmtH(c.med)}</td><td class="v">${c.n||'–'}</td><td class="v">${c.sug!=null && c.sug!==c.est ? '<b>'+fmtH(c.sug)+'</b>' : '–'}</td></tr>`; }).join('')}
    </tbody></table></div></div>`;
  const people = S.canCoach ? `<div class="panel"><h2 style="margin-bottom:4px">Coaching from output</h2><p class="small muted" style="margin-bottom:10px">Last 14 days of finished work, read together with each person’s check-ins. The aim is to support people, not to rank them.</p>
    ${team().map(m=>{ const oc = outputCoach(m.id); return `<div class="person">${av(m.id,'lg')}<div style="display:grid;gap:6px;min-width:0"><div><b>${esc(m.name)}</b> <span class="small muted">${esc(m.role||'')} · ${money(rateOf(m.id))}/h</span></div>
      <div class="small">${outputLine(oc.o)} · ${money(oc.o.cost)} of time</div>${oc.tips.map(t=>`<div class="prompt" style="${t.hi?'border-left-color:var(--bad)':t.ok?'border-left-color:var(--ok)':''}">${esc(t.t)}</div>`).join('')}</div>
      <div><button class="btn sm" data-act="one" data-id="${esc(m.id)}">Plan 1:1</button></div></div>`; }).join('')}</div>` : '';
  return `<section class="spread"><div><p class="eyebrow">Efficiency</p><h1>Time, cost and where to improve</h1>
    <p class="muted" style="max-width:72ch">Built from timers and logged hours on tasks, phase changes on clients, and each person’s hourly cost.${seeMoney?'':' Dollar figures are visible to the lead only.'}</p></div>
    <div class="seg" role="group" aria-label="Period">${wins.map(([v,l])=>`<button data-act="inswin" data-v="${v}" aria-pressed="${S.insWin===v}">${l}</button>`).join('')}</div></section>
  <section class="kpis">
    <div class="kpi"><span class="v">${fmtH(d.totalH)}</span><span class="l">Hours logged</span></div>
    <div class="kpi"><span class="v">${seeMoney?money(d.totalCost):'–'}</span><span class="l">Labor cost</span></div>
    <div class="kpi"><span class="v">${seeMoney&&d.effRate?money(d.effRate):'–'}</span><span class="l">Earned per hour on won work</span></div>
    <div class="kpi ${seeMoney&&d.avgMargin!=null&&d.avgMargin<targetMargin()?'alert':''}"><span class="v">${seeMoney?pct(d.avgMargin):'–'}</span><span class="l">Avg margin, finished clients (target ${pct(targetMargin())})</span></div>
    <div class="kpi ${d.ratio&&d.ratio>1.3?'attn':''}"><span class="v">${d.ratio?d.ratio.toFixed(2)+'×':'–'}</span><span class="l">Actual time ÷ estimate</span></div>
  </section>
  ${(()=>{ const td = trendData(); const lbl = td.ws.map(w=>fmtDate(w)); return `<section class="two"><div class="panel"><h2 style="margin-bottom:6px">Hours logged per week</h2>${barSvg(td.hours.map(v=>Math.round(v*10)/10), lbl, v=>fmtH(v), 'Hours logged per week, last 12 weeks')}</div><div class="panel"><h2 style="margin-bottom:6px">Tasks finished per week</h2>${barSvg(td.done, lbl, v=>String(Math.round(v)), 'Tasks finished per week, last 12 weeks')}</div></section>`; })()}
  ${fnPanel()}
  <section class="panel"><h2 style="margin-bottom:10px">What it says we need to be more efficient</h2>
    <div style="display:grid;gap:10px">${recs.map((r,i)=>`<div class="rec ${r.sev}"><span class="num">${pad(i+1)}</span><div><div class="spread" style="align-items:center"><b>${esc(r.title)}</b>${r.n!=null?`<span class="conf ${r.n>=5?'ok':''}">${r.n>=5?`Based on ${r.n} ${r.unit}`:`Early signal: only ${r.n} ${r.unit}`}</span>`:''}</div><div class="small">${esc(r.ev)}</div><div class="small"><b>Do this:</b> ${esc(r.act)}</div></div></div>`).join('') || '<div class="empty">Not enough data yet. Recommendations appear as people log time and clients move through phases.</div>'}</div></section>
  ${stageTable}
  <section class="two">${econTable || sysTable}${econTable ? sysTable : calTable}</section>
  ${econTable ? calTable : ''}
  ${people}`;
}
