/* ---------- people: pulses and coaching ---------- */
const ENERGY = ['', 'Drained', 'Low', 'Steady', 'Good', 'Energized'];
const LOADS = [['light','Light'],['right','About right'],['heavy','Heavy']];
const REFLECT = [
  'What is one thing that would make tomorrow lighter?',
  'Where did you feel most like yourself at work today?',
  'Who helped you this week, and have you told them?',
  'What are you avoiding, and what is the smallest first step?',
  'What did a client teach you recently?',
  'What would you stop doing if no one would notice?',
  'What are you proud of from the last few days?'
];
const OPENERS = {
  low:'You’ve sounded tired the last few check-ins. What’s draining you, and what would help?',
  dip:'How are you really doing today?',
  heavy:'Let’s look at your list together. What can we drop, delay, or hand off?',
  support:'You asked for support. What would be most helpful right now?',
  late:'What’s getting in the way of these? Is the due date wrong, or the scope?',
  blocked:'Who or what are you waiting on? How can I clear the path?',
  quiet:'I haven’t heard from you in a bit. How is the work landing for you?',
  oneone:'It’s time for a 1:1. Open with: “What’s on your mind?”',
  burn:'You’ve been carrying a lot and getting it done. How are you feeling about the pace?'
};
const peopleSubs = {};
function myKey(){ if(S.mode==='local') return S.me ? 'local-'+S.me : null; return S.myUid || null; }
function keyFor(memberId){ const m = mem(memberId); if(!m) return null; if(S.mode==='local') return 'local-'+memberId; return m.uid || null; }
function entriesFor(memberId){ const k = keyFor(memberId); const base = k ? Object.values(S.pulses[k]||{}).filter(p=>!p.member || p.member===memberId) : []; return memberId===S.me ? base.concat(Object.values(S.priv||{}).filter(p=>p.kind==='daily')) : base; }
function subscribeAnon(){ if(!DB || !S.canCoach || subscribeAnon.on) return; subscribeAnon.on = true; DB.collection('anon').onSnapshot(snap => { const m={}; snap.docs.forEach(d=>m[d.id]={...d.data(), id:d.id}); S.anon=m; safeRender(); }, ()=>{}); }
function sessionsFor(memberId){ const k = keyFor(memberId); return k ? Object.values(S.coach[k]||{}).filter(x=>x.id!=='prep').sort((a,b)=>(b.date||'').localeCompare(a.date||'')) : []; }
function prepFor(memberId){ const k = keyFor(memberId); return k ? (S.coach[k]||{}).prep : null; }
function saveSub(store, key, id, obj){
  S[store][key] = {...(S[store][key]||{}), [id]:{...obj, id}};
  if(!DB){ saveLocal(); return; }
  const root = store==='pulses' ? 'pulses' : 'coaching', sub = store==='pulses' ? 'entries' : 'sessions';
  queueWrite(`${root}/${key}/${id}`, async()=>{ await DB.doc(root+'/'+key).collection(sub).doc(id).set(obj); });
}
function subscribePeople(){
  if(!DB || !S.myUid) return;
  const keys = S.canCoach ? [...new Set([S.myUid, ...team().map(m=>m.uid).filter(Boolean)])] : [S.myUid];
  keys.forEach(k => {
    if(peopleSubs[k]) return; peopleSubs[k] = true;
    DB.doc('pulses/'+k).collection('entries').onSnapshot(snap => { const m={}; snap.docs.forEach(d=>m[d.id]={...d.data(), id:d.id}); S.pulses[k]=m; safeRender(); }, ()=>{});
    DB.doc('coaching/'+k).collection('sessions').onSnapshot(snap => { const m={}; snap.docs.forEach(d=>m[d.id]={...d.data(), id:d.id}); S.coach[k]=m; safeRender(); }, ()=>{});
    DB.doc('audit/'+k).collection('entries').onSnapshot(snap => { const m={}; snap.docs.forEach(d=>m[d.id]={...d.data(), id:d.id}); S.audit[k]=m; safeRender(); }, ()=>{});
    DB.doc('usage/'+k).collection('days').onSnapshot(snap => { const m={}; snap.docs.forEach(d=>m[d.id]={...d.data(), id:d.id}); S.usage[k]=m; }, ()=>{});
    DB.doc('feedback/'+k).collection('items').onSnapshot(snap => { const m={}; snap.docs.forEach(d=>m[d.id]={...d.data(), id:d.id}); S.fb[k]=m; safeRender(); }, ()=>{});
  });
}
function signals(memberId){
  const d = today(); const es = entriesFor(memberId);
  const daily = es.filter(p=>p.kind==='daily').sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  const flags = [];
  const last3 = daily.slice(-3), lastD = daily[daily.length-1];
  if(last3.length===3 && last3.every(p=>p.energy<=2)) flags.push({k:'low', hi:true, t:'Low energy 3 check-ins running'});
  else if(lastD && lastD.energy<=2 && lastD.date>=addDays(d,-1)) flags.push({k:'dip', t:'Energy dipped'});
  if(daily.filter(p=>p.date>=addDays(d,-7) && p.load==='heavy').length>=3) flags.push({k:'heavy', hi:true, t:'Heavy load 3+ days this week'});
  { const wk0 = daily.filter(p=>p.date>=addDays(d,-6)), pv0 = daily.filter(p=>p.date<addDays(d,-6) && p.date>=addDays(d,-13)); const av0 = a => a.length ? a.reduce((s,p)=>s+(+p.energy||0),0)/a.length : null;
    const a1 = av0(wk0), a0 = av0(pv0); const od = outputStats(memberId).done; if(a1!=null && a0!=null && a1 < a0-0.4 && od>=3) flags.push({k:'burn', hi:true, t:'Working hard while energy falls'}); }
  const sup = es.filter(p=>p.support && !p.ack && (p.date||'')>=addDays(d,-14));
  if(sup.length) flags.unshift({k:'support', hi:true, t:'Asked for support'});
  const open = list('tasks').filter(t=>t.owner===memberId && isOpen(t));
  const late = open.filter(t=>t.due<d).length, blocked = open.filter(t=>st(t)==='blocked').length;
  if(late>=2) flags.push({k:'late', t:`${late} tasks late`});
  if(blocked>=2) flags.push({k:'blocked', t:`${blocked} tasks blocked`});
  const linked = !!keyFor(memberId);
  if(linked && (!lastD || lastD.date < addDays(d,-4))) flags.push({k:'quiet', t:'No check-in in 5 days'});
  const sess = sessionsFor(memberId), lastS = sess[0];
  if(!lastS || lastS.date < addDays(d,-14)) flags.push({k:'oneone', t: lastS ? '1:1 overdue' : 'No 1:1 yet'});
  const wk = daily.filter(p=>p.date>=addDays(d,-6)), prev = daily.filter(p=>p.date<addDays(d,-6) && p.date>=addDays(d,-13));
  const avg = a => a.length ? a.reduce((s,p)=>s+(+p.energy||0),0)/a.length : null;
  return {flags, daily, sup, open:open.length, late, blocked, lastS, sess, linked, avg:avg(wk), prevAvg:avg(prev), lastD};
}
function spark(daily){
  const pts = []; for(let i=13;i>=0;i--){ const day = addDays(today(),-i); const p = daily.find(x=>x.date===day); pts.push(p ? +p.energy : null); }
  const w=140, h=32, x=i=>4+i*(w-8)/13, y=v=>h-4-(v-1)*(h-8)/4;
  let path='', on=false; pts.forEach((v,i)=>{ if(v==null){ on=false; return; } path += (on?'L':'M')+x(i).toFixed(1)+' '+y(v).toFixed(1)+' '; on=true; });
  const dots = pts.map((v,i)=> v==null ? '' : `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${i===13?3.2:2}" fill="${v<=2?'var(--bad)':'var(--navy)'}"/>`).join('');
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Energy over the last 14 days"><line x1="4" x2="${w-4}" y1="${y(3)}" y2="${y(3)}" stroke="var(--line)" stroke-dasharray="2 3"/>${path?`<path d="${path}" fill="none" stroke="var(--navy)" stroke-width="1.5"/>`:''}${dots}</svg>`;
}
const fmtAvg = v => v==null ? '–' : v.toFixed(1);

function pulseCard(){
  if(!S.me || !priv().checkins) return '';
  const k = myKey();
  if(!k) return `<section class="panel"><b>Daily check-in</b><p class="small muted">Check-ins need you signed in to claude.ai so only you and your coach can read them. Open the hub while signed in.</p></section>`;
  const p = (S.pulses[k]||{})['d-'+today()] || (S.priv||{})['p-'+today()];
  const me = mem(S.me); const lead = mem(leadId());
  const audience = me && me.lead ? 'Visible to you only (and anyone you make an Editor).' : `Visible only to you and ${lead ? esc(first(lead.id)) : 'your coach'}. Never used for performance reviews.`;
  const prompt = REFLECT[Math.floor(Date.now()/86400000) % REFLECT.length];
  if(p && !S.editPulse){
    const followed = p.support && p.ack;
    return `<section class="panel pulse"><div class="spread"><div><span class="eyebrow">Today’s check-in</span>
      <div><b>${esc(ENERGY[p.energy]||'')}</b> energy · ${esc((LOADS.find(l=>l[0]===p.load)||['',''])[1])} load${p.support?` · <span class="flag ${followed?'ok':''}">${followed?'Coach followed up':'Support requested'}</span>`:''}</div></div>
      <button class="btn sm ghost" data-act="pulse-edit">Edit</button></div>
      <div class="prompt"><b>Reflection:</b> ${esc(prompt)}</div></section>`;
  }
  const dr = S.pulseDraft; if(p && dr.energy===undefined){ dr.energy=p.energy; dr.load=p.load; dr.support=p.support; dr.note=p.note; }
  return `<section class="panel pulse"><div class="spread"><div><span class="eyebrow">Daily check-in · 20 seconds</span><h2>How are you arriving today?</h2></div><span class="privacy">${audience}</span></div>
    <div class="scale" role="group" aria-label="Energy">${[1,2,3,4,5].map(v=>`<button type="button" data-act="pe" data-v="${v}" aria-pressed="${dr.energy===v}"><b>${v}</b>${ENERGY[v]}</button>`).join('')}</div>
    <div class="row"><span class="small muted">Workload</span><div class="seg" role="group" aria-label="Workload">${LOADS.map(([v,l])=>`<button type="button" data-act="pl" data-v="${v}" aria-pressed="${dr.load===v}">${l}</button>`).join('')}</div></div>
    <div class="row" style="align-items:flex-start"><input id="pulse-note" placeholder="Anything on your mind? (optional)" value="${esc(dr.note||'')}" style="flex:1;min-width:0;flex-basis:200px;border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--bg)">
      <label class="switch"><input type="checkbox" id="pulse-support" ${dr.support?'checked':''}>I’d like support</label>
      ${priv().anon ? `<label class="switch" title="Only counted in the team average. Support requests can’t be anonymous."><input type="checkbox" id="pulse-anon" ${dr.anon?'checked':''}>Check in anonymously</label>` : ''}
      <button class="btn primary" data-act="pulse-save">Check in</button></div></section>`;
}
function savePulse(){
  const k = myKey(); const dr = S.pulseDraft;
  if(!k){ toast('Sign in to claude.ai to check in'); return; }
  if(!dr.energy || !dr.load){ toast('Pick your energy and workload'); return; }
  dr.note = ($('#pulse-note')||{}).value || ''; dr.support = !!($('#pulse-support')||{}).checked; dr.anon = !!($('#pulse-anon')||{}).checked;
  if(dr.anon && dr.support){ toast('Support requests can’t be anonymous. Untick one of them.'); return; }
  if(dr.anon){
    const priv = {member:S.me, kind:'daily', date:today(), energy:dr.energy, load:dr.load, note:dr.note.trim(), anon:true, at:nowISO()};
    S.priv = {...S.priv, ['p-'+today()]:{...priv, id:'p-'+today()}};
    if(DB && S.myUid){ queueWrite('priv/'+today(), async()=>{ await DB.collection('data/users/'+S.myUid).doc('p-'+today()).set(priv); }); const aid = uid(); queueWrite('anon/'+aid, async()=>{ await DB.collection('anon').doc(aid).set({date:today(), energy:dr.energy, load:dr.load}); }); }
    else { const aid = uid(); S.anon = {...S.anon, [aid]:{date:today(), energy:dr.energy, load:dr.load, id:aid}}; saveLocal(); }
    S.pulseDraft = {}; S.editPulse = false; toast('Checked in anonymously. Only the team average uses it.'); render(); return;
  }
  const prev = (S.pulses[k]||{})['d-'+today()];
  saveSub('pulses', k, 'd-'+today(), {member:S.me, kind:'daily', date:today(), energy:dr.energy, load:dr.load, note:dr.note.trim(), support:dr.support, ack: prev && prev.support && dr.support ? !!prev.ack : false, at:nowISO()});
  S.pulseDraft = {}; S.editPulse = false;
  toast(dr.support ? 'Checked in. Your coach will see you asked for support.' : 'Checked in. Thank you.');
  render();
}
function maybeTaskPulse(id, to){
  const t = S.tasks[id]; if(!t || !priv().taskPulse || !['done','blocked'].includes(to) || t.owner!==S.me || !myKey()) return;
  S.tpCtx = {id, to, v:null};
  renderTaskPulse(); $('#pulseDlg').showModal();
}
function renderTaskPulse(){
  const c = S.tpCtx; const t = c && S.tasks[c.id]; if(!t) return;
  $('#pulseBody').innerHTML = `<span class="eyebrow">${c.to==='done'?'Finished':'Blocked'} · quick pulse</span><h2>${c.to==='done'?'How did that one feel?':'How are you holding up with this?'}</h2>
    <p class="small muted">${esc(t.title)}</p>
    <div class="scale" role="group" aria-label="How it felt">${[1,2,3,4,5].map(v=>`<button type="button" data-act="tp" data-v="${v}" aria-pressed="${c.v===v}"><b>${v}</b>${['','Rough','Hard','Fine','Good','Great'][v]}</button>`).join('')}</div>
    <input id="tp-note" placeholder="What made it that way? (optional)" style="border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--bg)">
    <p class="privacy">Feeds the “temperature across the workflow” view. Only you and your coach see your answers.</p>
    <div class="row" style="justify-content:flex-end"><button class="btn ghost" data-act="close-dlg" data-dlg="pulseDlg">Skip</button><button class="btn primary" data-act="tp-save">Save</button></div>`;
}
function saveTaskPulse(){
  const c = S.tpCtx; const t = c && S.tasks[c.id]; const k = myKey(); if(!t || !k) return;
  if(!c.v){ toast('Pick a number, or skip'); return; }
  const e = t.eng && S.engagements[t.eng];
  saveSub('pulses', k, 't-'+t.id+'-'+c.to, {member:S.me, kind:'task', date:today(), energy:c.v, note:(($('#tp-note')||{}).value||'').trim(), outcome:c.to, task:t.id, title:t.title, eng:t.eng||'', stage:t.stage || (e?e.stage:''), at:nowISO()});
  $('#pulseDlg').close(); S.tpCtx=null; toast('Thanks. Logged.'); safeRender();
}
function retroBlock(e){
  if(!priv().retros || stageIdx(e.stage) < stageIdx('closeout')) return '';
  const k = myKey(); const mine = k ? (S.pulses[k]||{})['r-'+e.id] : null;
  let html = `<div class="panel" style="padding:14px"><h3 style="margin-bottom:8px">Engagement retro</h3>`;
  if(!S.me || !k) html += `<p class="small muted">Sign in and pick your name to add your retro.</p>`;
  else if(mine) html += `<p class="small">Your retro is in (${esc(['','Rough','Hard','Fine','Good','Great'][mine.energy]||'')}). Thank you.</p>`;
  else html += `<form id="retroForm" data-eng="${esc(e.id)}" class="form">
      <label class="full">How did this engagement feel for you? (1–5)<select id="rt-v"><option value="">Choose</option>${[5,4,3,2,1].map(v=>`<option value="${v}">${v} · ${['','Rough','Hard','Fine','Good','Great'][v]}</option>`).join('')}</select></label>
      <label class="full">What went well<textarea id="rt-well"></textarea></label>
      <label>What was hard<textarea id="rt-hard"></textarea></label>
      <label>One thing to change next time<textarea id="rt-change"></textarea></label>
      <div class="row full" style="grid-column:1/-1;justify-content:space-between"><span class="privacy">Shared with your coach.</span><button class="btn primary" type="submit">Submit retro</button></div></form>`;
  if(S.canCoach){
    const all = team().flatMap(m => entriesFor(m.id).filter(p=>p.kind==='retro' && p.eng===e.id).map(p=>({...p, m:m.id})));
    if(all.length) html += `<div style="display:grid;gap:8px;margin-top:12px"><span class="eyebrow">Team retros (${all.length})</span>${all.map(p=>`<div class="small" style="border-top:1px solid var(--line);padding-top:8px">${av(p.m)} <b>${esc(mname(p.m))}</b> · ${p.energy}/5<br><b>Well:</b> ${esc(p.well||'–')}<br><b>Hard:</b> ${esc(p.hard||'–')}<br><b>Change:</b> ${esc(p.change||'–')}</div>`).join('')}</div>`;
  }
  return html + '</div>';
}

function viewCoaching(){
  const me = mem(S.me);
  const principles = `<div class="panel"><h2 style="margin-bottom:10px">How we coach</h2>
    <table class="def"><tbody>
      <tr><td><b>Purpose</b></td><td>Check-ins exist to catch strain early and get people help. They never feed pay, ratings or reviews.</td></tr>
      <tr><td><b>Privacy</b></td><td>Your check-ins and 1:1 notes are visible to you and your coach only. Teammates never see them. You can also check in anonymously; anonymous answers only show as a team average, and only once three or more come in.</td></tr>
      <tr><td><b>Separation</b></td><td>Wellbeing and Work are separate screens. Check-in answers never feed the Work view, Insights or anything about performance. Work data can prompt a wellbeing conversation, never the other way round.</td></tr>
      <tr><td><b>Rhythm</b></td><td>Daily 20-second check-in. Quick pulse when you finish or get stuck on a task. Retro at every Closeout. A 1:1 every two weeks.</td></tr>
      <tr><td><b>Response</b></td><td>“I’d like support” gets a human reply within one working day. A flag is a reason to ask, not a conclusion.</td></tr>
      <tr><td><b>1:1 shape</b></td><td><b>G</b>oal: what do you want from this time? <b>R</b>eality: what is actually happening? <b>O</b>ptions: what could you try? <b>W</b>ill: what will you do, by when, and what do you need from me?</td></tr>
    </tbody></table></div>`;

  if(!S.canCoach){
    if(!me) return `${whoBanner()}<section><h1>Coaching</h1></section>${principles}`;
    const sg = signals(S.me); const prep = prepFor(S.me);
    return `${whoBanner()}<section><p class="eyebrow">Your growth</p><h1>Coaching</h1><p class="muted">Your check-in trend, your 1:1 notes, and space to prepare for the next one.</p></section>
    <section class="two">
      <div style="display:grid;gap:22px;align-content:start">
        <div class="panel"><h2 style="margin-bottom:8px">Your energy, last 14 days</h2>${spark(sg.daily)}<p class="small muted" style="margin-top:6px">This week ${fmtAvg(sg.avg)} · last week ${fmtAvg(sg.prevAvg)} (out of 5)</p><p class="small" style="margin-top:6px"><b>Your output, 14 days:</b> ${outputLine(outputStats(S.me))}</p></div>
        <form class="panel form" id="prepForm"><h2 style="grid-column:1/-1">Prep for your next 1:1</h2>
          <label class="full">What do you want to talk about?<textarea id="prep-text" placeholder="A win, a worry, something you want to learn…">${esc(prep?prep.text:'')}</textarea></label>
          <div class="row" style="grid-column:1/-1;justify-content:space-between"><span class="privacy">Your coach sees this when planning your 1:1.</span><button class="btn primary" type="submit">Save</button></div></form>
      </div>
      <div style="display:grid;gap:22px;align-content:start">
        <div class="panel"><h2 style="margin-bottom:10px">Your 1:1s</h2>${sg.sess.length ? sg.sess.map(sessionHtml).join('') : '<div class="empty">No 1:1s logged yet.</div>'}</div>
        ${principles}
      </div></section>`;
  }

  const ms = team().filter(m=>m.id!==S.me);
  const sigs = Object.fromEntries(ms.map(m=>[m.id, signals(m.id)]));
  const linked = ms.filter(m=>sigs[m.id].linked);
  const checkedToday = linked.filter(m=>sigs[m.id].lastD && sigs[m.id].lastD.date===today()).length;
  const avgs = linked.map(m=>sigs[m.id].avg).filter(v=>v!=null);
  const teamAvg = avgs.length ? avgs.reduce((a,b)=>a+b,0)/avgs.length : null;
  const supportOpen = ms.filter(m=>sigs[m.id].sup.length).length;
  const due1 = ms.filter(m=>sigs[m.id].flags.some(f=>f.k==='oneone')).length;

  const rows = ms.map(m => {
    const sg = sigs[m.id]; const lead = sg.flags.find(f=>f.hi) || sg.flags[0];
    const ld = sg.lastD;
    return `<div class="person">${av(m.id,'lg')}
      <div style="display:grid;gap:6px;min-width:0">
        <div><b>${esc(m.name)}</b> <span class="small muted">${esc(m.role||'')}</span></div>
        ${sg.linked ? `<div class="row" style="gap:14px">${spark(sg.daily)}<span class="small">${ld ? `Last: <b>${esc(ENERGY[ld.energy])}</b>, ${esc((LOADS.find(l=>l[0]===ld.load)||['',''])[1].toLowerCase())} load · ${fmtDate(ld.date)}` : 'No check-ins yet'}<br><span class="muted">Week avg ${fmtAvg(sg.avg)} (was ${fmtAvg(sg.prevAvg)}) · ${sg.open} open · ${sg.late} late · ${sg.blocked} blocked</span></span></div>`
                     : `<div class="small muted">Not linked yet. Check-ins start once they open the hub signed in and pick their name.</div>`}
        <div>${sg.flags.map(f=>`<span class="flag ${f.hi?'hi':''}">${esc(f.t)}</span>`).join('') || '<span class="flag ok">No flags</span>'}</div>
        ${sg.sup.map(p=>`<div class="small" style="color:var(--bad)">${fmtDate(p.date)}: “${esc(p.note||'Asked for support')}”</div>`).join('')}
        ${lead ? `<div class="prompt"><b>Try opening with:</b> ${esc(OPENERS[lead.k]||'')}</div>` : ''}
      </div>
      <div style="display:grid;gap:6px;justify-items:end">
        <button class="btn primary sm" data-act="one" data-id="${esc(m.id)}">Plan 1:1</button>
        ${sg.sup.length ? `<button class="btn sm" data-act="ack" data-id="${esc(m.id)}">I’ve reached out</button>` : ''}
        <span class="small muted">${sg.lastS ? 'Last 1:1 '+fmtDate(sg.lastS.date) : 'No 1:1 yet'}</span>
      </div></div>`;
  }).join('');

  // temperature across the workflow
  const entries = team().flatMap(m => entriesFor(m.id).filter(p=>(p.kind==='task'||p.kind==='retro') && p.stage));
  const byStage = STAGES.map(s => { const es = entries.filter(p=>p.stage===s.id); const avg = es.length ? es.reduce((a,p)=>a+(+p.energy||0),0)/es.length : null;
    return {s, n:es.length, avg, low:es.filter(p=>p.energy<=2).length, blocked:es.filter(p=>p.outcome==='blocked').length, notes:es.filter(p=>p.note).slice(-2)}; });
  const minAvg = Math.min(...byStage.filter(x=>x.avg!=null).map(x=>x.avg));
  const heat = v => v==null ? 'var(--line)' : v<2.5 ? 'var(--bad)' : v<3.5 ? 'var(--warn)' : 'var(--ok)';
  const temp = `<div class="panel"><div class="spread" style="margin-bottom:10px"><h2>Temperature across the workflow</h2><span class="small muted">From task pulses and retros, all clients</span></div>
    <div class="matrix-wrap"><table class="def"><thead><tr><th>Stage</th><th>How work felt</th><th>Pulses</th><th>Rough moments</th><th>Blocked</th><th>What people said</th></tr></thead><tbody>
    ${byStage.map(x=>`<tr style="${x.avg!=null && x.avg===minAvg && x.avg<3.5?'background:color-mix(in srgb,var(--bad) 7%,transparent)':''}"><td>${esc(x.s.name)}</td>
      <td class="v"><span class="meter"><span style="width:${x.avg?x.avg/5*100:0}%;background:${heat(x.avg)}"></span></span>${fmtAvg(x.avg)}</td><td class="v">${x.n}</td><td class="v">${x.low}</td><td class="v">${x.blocked}</td>
      <td class="small">${x.notes.map(p=>`“${esc(p.note)}”`).join('<br>') || '<span class="muted">–</span>'}</td></tr>`).join('')}
    </tbody></table></div>
    ${minAvg<3.5 ? `<p class="small" style="margin-top:8px">The lowest stage is where to look first. Is the playbook asking too much there, or is the handoff into it unclear?</p>` : ''}</div>`;

  const myS = me ? signals(S.me) : null;
  const tabs = `<div class="seg" role="group" aria-label="Coaching view"><button data-act="ctab" data-v="wellbeing" aria-pressed="${S.coachTab==='wellbeing'}">Wellbeing</button><button data-act="ctab" data-v="work" aria-pressed="${S.coachTab==='work'}">Work</button></div>`;
  if(S.coachTab==='work'){
    const wrows = ms.map(m => { const oc = outputCoach(m.id); return `<div class="person">${av(m.id,'lg')}<div style="display:grid;gap:6px;min-width:0"><div><b>${esc(m.name)}</b> <span class="small muted">${esc(m.role||'')}</span></div>
      <div class="small">${outputLine(oc.o)}</div>${oc.tips.map(t=>`<div class="prompt" style="border-left-color:${t.hi?'var(--bad)':t.ok?'var(--ok)':'var(--navy)'}">${esc(t.t)}</div>`).join('') || '<div class="small muted">No finished work in the last 14 days.</div>'}</div>
      <div><button class="btn primary sm" data-act="one" data-id="${esc(m.id)}">Plan 1:1</button></div></div>`; }).join('');
    return `${whoBanner()}<section class="spread"><div><p class="eyebrow">People</p><h1>Coaching: the work</h1>
      <p class="muted" style="max-width:72ch">Last 14 days of finished work: on-time rate, hours, estimate accuracy and how quickly assignments get opened. Nothing here uses check-in answers.</p></div>${tabs}</section>
      <section class="two"><div class="panel"><h2 style="margin-bottom:4px">Your people</h2>${wrows || '<div class="empty">Add teammates on the Team page.</div>'}</div>
      <div style="display:grid;gap:22px;align-content:start"><div class="panel"><h2 style="margin-bottom:8px">Using this well</h2><table class="def"><tbody>
        <tr><td><b>Start from curiosity</b></td><td>“Work is running 1.6× the estimate. What are you running into?” works better than “You’re slow.”</td></tr>
        <tr><td><b>Fix the system first</b></td><td>If everyone runs over on the same playbook task, change the estimate or the process, not the person. See Insights → Refine the model.</td></tr>
        <tr><td><b>Name wins specifically</b></td><td>Point to the task and its effect on the client.</td></tr></tbody></table></div>${principles}</div></section>`;
  }
  const an = anonStats(7);
  const anonPanel = `<div class="panel"><h2 style="margin-bottom:8px">Anonymous team pulse, last 7 days</h2>${an.ok ? `<div class="row" style="gap:18px"><span class="kpi" style="padding:8px 12px"><span class="v" style="font-size:20px">${fmtAvg(an.avg)}</span><span class="l">Average energy</span></span><span class="kpi" style="padding:8px 12px"><span class="v" style="font-size:20px">${pct(an.heavy)}</span><span class="l">Said workload is heavy</span></span><span class="small muted">${an.n} anonymous check-ins</span></div>` : `<p class="small muted">${an.n ? `${an.n} anonymous check-in${an.n>1?'s':''} so far. Results show once there are at least 3, so no one can be singled out.` : 'No anonymous check-ins yet. Anyone can choose “Check in anonymously” on My day.'}</p>`}</div>`;
  return `${whoBanner()}<section class="spread"><div><p class="eyebrow">People</p><h1>Coaching: wellbeing</h1>
    <p class="muted" style="max-width:72ch">How people are doing as work moves through the pipeline, who needs a conversation, and what to say to open it.</p></div>${tabs}</section>
    <section class="kpis">
      <div class="kpi"><span class="v">${fmtAvg(teamAvg)}</span><span class="l">Team energy this week (of 5)</span></div>
      <div class="kpi"><span class="v">${checkedToday}/${linked.length}</span><span class="l">Checked in today</span></div>
      <div class="kpi ${supportOpen?'alert':''}"><span class="v">${supportOpen}</span><span class="l">Support requests open</span></div>
      <div class="kpi ${due1?'attn':''}"><span class="v">${due1}</span><span class="l">1:1s due</span></div>
      <div class="kpi"><span class="v">${myS?fmtAvg(myS.avg):'–'}</span><span class="l">Your own energy this week</span></div>
    </section>
    <section class="two">
      <div class="panel"><h2 style="margin-bottom:4px">Your people</h2>${rows || '<div class="empty">Add teammates on the Team page to start coaching.</div>'}</div>
      <div style="display:grid;gap:22px;align-content:start">${anonPanel}${temp}${principles}</div>
    </section>`;
}
function sessionHtml(x){
  return `<div style="border-top:1px solid var(--line);padding:10px 0;display:grid;gap:4px;font-size:13.5px"><b>${fmtDate(x.date)}${x.coach?` with ${esc(mname(x.coach))}`:''}</b>
    ${x.goal?`<div><b>Goal:</b> ${esc(x.goal)}</div>`:''}${x.reality?`<div><b>Reality:</b> ${esc(x.reality)}</div>`:''}${x.options?`<div><b>Options:</b> ${esc(x.options)}</div>`:''}
    ${(x.commitments||[]).length?`<div><b>Will:</b><ul class="agenda">${x.commitments.map(c=>`<li>${esc(c)}</li>`).join('')}</ul></div>`:''}
    ${x.next?`<div class="small muted">Next 1:1: ${fmtDate(x.next)}</div>`:''}</div>`;
}
function openOne(memberId){
  if(!priv().coaching){ toast('1:1 notes are turned off in Setup → Privacy & data'); return; }
  const m = mem(memberId); if(!m) return; const sg = signals(memberId); const d = today(); const wk = addDays(d,-14);
  const wins = list('tasks').filter(t=>t.owner===memberId && !isOpen(t) && (t.doneAt||'')>=wk).slice(0,6);
  const stuck = list('tasks').filter(t=>t.owner===memberId && st(t)==='blocked');
  const rough = entriesFor(memberId).filter(p=>p.kind==='task' && p.energy<=2 && (p.date||'')>=wk);
  const notes = sg.daily.filter(p=>p.note && p.date>=wk).slice(-4);
  const prep = prepFor(memberId);
  const lastB = t => { const h=(t.history||[]).slice().reverse().find(x=>x.to==='blocked'); return h&&h.note ? ` (${h.note})` : ''; };
  $('#oneBody').innerHTML = `<form id="oneForm" data-id="${esc(memberId)}" style="display:grid;gap:14px">
    <div class="spread"><div><span class="eyebrow">1:1 · ${fmtDate(d)}</span><h2>${esc(m.name)}</h2></div><button type="button" class="btn ghost" data-act="close-dlg" data-dlg="oneDlg" aria-label="Close">✕</button></div>
    ${prep && prep.text ? `<div class="prompt"><b>Their topic first:</b> ${esc(prep.text)}</div>` : ''}
    <div class="two" style="gap:12px"><div class="panel" style="padding:12px"><span class="eyebrow">How they’re doing</span>
      <ul class="agenda" style="margin-top:6px">
        <li><b>Energy:</b> ${fmtAvg(sg.avg)} this week, ${fmtAvg(sg.prevAvg)} last week${sg.daily.filter(p=>p.date>=addDays(d,-7)&&p.load==='heavy').length?`, heavy load on ${sg.daily.filter(p=>p.date>=addDays(d,-7)&&p.load==='heavy').length} days`:''}</li>
        ${sg.sup.map(p=>`<li style="color:var(--bad)"><b>Asked for support ${fmtDate(p.date)}:</b> ${esc(p.note||'')}</li>`).join('')}
        ${notes.filter(p=>!p.support).map(p=>`<li>${fmtDate(p.date)}: “${esc(p.note)}”</li>`).join('')}
        ${rough.map(p=>`<li><b>Felt rough:</b> ${esc(p.title||'')}${p.note?` — “${esc(p.note)}”`:''}</li>`).join('')}
      </ul></div>
      <div class="panel" style="padding:12px"><span class="eyebrow">The work</span><ul class="agenda" style="margin-top:6px">
        ${(()=>{ const oc = outputCoach(memberId); return `<li><b>Output:</b> ${outputLine(oc.o)}</li>${oc.tips.map(x=>`<li>${esc(x.t)}</li>`).join('')}`; })()}
        <li><b>Wins to name:</b> ${wins.length ? wins.map(t=>esc(t.title)).join('; ') : 'none logged. Ask what they are proud of.'}</li>
        ${stuck.length ? `<li><b>Stuck on:</b> ${stuck.map(t=>esc(t.title+lastB(t))).join('; ')}</li>` : ''}
      </ul></div></div>
    <div class="form">
      <label class="full">Goal: what do they want from this conversation?<input id="oo-goal"></label>
      <label class="full">Reality: what is actually happening?<textarea id="oo-reality"></textarea></label>
      <label class="full">Options: what could they try?<textarea id="oo-options"></textarea></label>
      <label class="full">Will: commitments, one per line (from either of you)<textarea id="oo-will" placeholder="Jordan: block Thursday mornings for Console scoring&#10;Franklin: call Eastside about the financials"></textarea></label>
      <label class="switch full"><input type="checkbox" id="oo-tasks" checked>Turn each commitment into a task (assigned to ${esc(first(memberId))} unless the line starts with your name)</label>
      <label>Next 1:1<input id="oo-next" type="date" value="${addDays(d,14)}"></label>
      <label>Time<input id="oo-time" type="time" value="11:00"></label>
    </div>
    <div class="row" style="justify-content:space-between"><span class="privacy">Saved notes are shared with ${esc(first(memberId))} and no one else.</span><button class="btn primary" type="submit">Save 1:1</button></div></form>`;
  $('#oneDlg').showModal();
}
function saveOne(memberId){
  const m = mem(memberId); const k = keyFor(memberId);
  if(!k){ toast(`${first(memberId)} needs to open the hub signed in before 1:1 notes can be saved for them`); return; }
  const will = ($('#oo-will').value||'').split('\n').map(x=>x.trim()).filter(Boolean);
  const next = $('#oo-next').value; const time = $('#oo-time').value || '11:00';
  saveSub('coach', k, uid(), {member:memberId, coach:S.me||'', date:today(), goal:$('#oo-goal').value.trim(), reality:$('#oo-reality').value.trim(), options:$('#oo-options').value.trim(), commitments:will, next, at:nowISO()});
  if($('#oo-tasks').checked){
    const meFirst = S.me ? first(S.me).toLowerCase() : '';
    will.forEach(w => { const mine = meFirst && w.toLowerCase().startsWith(meFirst); createTask({title: w.replace(/^[^:]{1,30}:\s*/,''), owner: mine ? S.me : memberId, due: addDays(today(),7), lane: mine?'franklin':'associates', src:'coaching'}); });
  }
  if(next){ const [h,mi] = time.split(':').map(Number); const end = pad(Math.min(23,h+(mi+30>=60?1:0)))+':'+pad((mi+30)%60);
    put('events', uid(), {title:`1:1: ${S.me?first(S.me):'Coach'} & ${first(memberId)}`, date:next, start:time, end, repeat:'', type:'meeting', eng:'', att:[S.me, memberId].filter(Boolean), createdBy:S.me||''});
    notify(memberId, `Your next 1:1 is on the calendar: ${fmtDate(next)} ${fmtTime(time)}`, {}); }
  ackSupport(memberId, true);
  $('#oneDlg').close(); toast('1:1 saved'); render();
}
function ackSupport(memberId, quiet){
  const k = keyFor(memberId); if(!k) return;
  signals(memberId).sup.forEach(p => saveSub('pulses', k, p.id, {...strip(p), ack:true, ackBy:S.me||'', ackAt:nowISO()}));
  if(!quiet){ toast('Marked as followed up'); render(); }
}
