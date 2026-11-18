/* Demo workspace: a fictional nonprofit, kept only in this browser. Never touches the team hub. */
(function(){
  function seed(){
    const d = today(); const ago = n => addDays(d, -n); const at = (day, h=15) => day+'T'+String(h).padStart(2,'0')+':00:00.000Z';
    put('team','dm_dana',{name:'Dana Ortiz',role:'Executive Director',color:'#1d3461',lead:true,capacity:40,email:''});
    put('team','dm_marcus',{name:'Marcus Bell',role:'Program Manager',color:'#2a7473',capacity:40});
    put('team','dm_priya',{name:'Priya Shah',role:'Development Associate',color:'#7a3e8c',capacity:30});
    put('team','dm_leo',{name:'Leo Kim',role:'Operations',color:'#2c7a57',capacity:20});
    claimMe('dm_dana');
    try{ applyTemplate('grants'); const m = {...S.model, labels:{...(S.model.labels||{}), orgName:'Riverbend Youth Arts (demo)'}}; saveConfig('model', m); applyModel(m); }catch(_){}
    saveConfig('settings', {...S.settings, laneOwners:{associates:'dm_priya', finance:'dm_leo'}});
    saveConfig('rates', {rates:{dm_dana:62, dm_marcus:38, dm_priya:31, dm_leo:29}});
    const offers = Object.keys(OFFERS);
    [['Hartwell Foundation','Ruth Alvarez',75000,3],['City Arts Council','Ben Ott',25000,2],['Lakeshore Community Fund','Ama Mensah',40000,1],['Northgate Bank Giving','Tom Reyes',15000,0]].forEach(([org,contact,value,stg],i) => {
      const id = createEngagement({org, contact, email:'', offer:offers[i%offers.length], value, source:'Demo', lead:i%2?'dm_priya':'dm_dana'});
      for(let s=1; s<=stg; s++){ try{ moveTo(id, STAGES[s].id); }catch(_){} } });
    const ppl = ['dm_dana','dm_marcus','dm_priya','dm_leo'];
    const mk = (tplId, name, startAgo, owner, eng) => { const tpl = BUILTIN_PT.find(t=>t.id===tplId); const pid = projectFromTemplate(tpl, {name, start:ago(startAgo), owner, eng}); return pid; };
    const p1 = mk('b-grant', 'Hartwell Foundation application', 18, 'dm_priya', list('engagements').find(e=>e.org==='Hartwell Foundation').id);
    const p2 = mk('b-retreat', 'Spring board retreat', 12, 'dm_dana', '');
    const p3 = mk('b-strategy', '2027–2030 strategic plan', 30, 'dm_dana', '');
    [p1,p2,p3].forEach((pid, pi) => ptasks(pid).sort((a,b)=>(a.due||'').localeCompare(b.due||'')).forEach((t, i) => {
      const owner = ppl[(i+pi) % ppl.length]; const past = t.due < d; const late = past && i%5===3; const doneDay = past ? (i%4===0 ? addDays(t.due,1) : t.due) : null;
      const base = {...t, owner, assignedBy:'dm_dana', assignedAt:at(addDays(t.start||t.due,-2)), seenAt:at(addDays(t.start||t.due,-1)), history:[]};
      if(past && !late){ const mins = Math.round((+t.est||1)*60*(0.8 + (i%3)*0.25)); put('tasks', t.id, {...base, status:'done', done:true, startedAt:at(t.start||t.due,14), doneAt:at(doneDay,20), timeLog:[{at:at(doneDay,19), min:mins, by:owner}]}); }
      else if(late){ put('tasks', t.id, {...base, status: i%2 ? 'blocked' : 'in_progress', startedAt:at(t.start||t.due,14), blockedAt: i%2 ? at(ago(2)) : null, history: i%2 ? [{at:at(ago(2)), by:owner, from:'in_progress', to:'blocked', note:'Waiting on numbers from finance'}] : []}); }
      else if((t.start||t.due) <= addDays(d,3)) put('tasks', t.id, {...base, status: i%3 ? 'in_progress' : 'seen', startedAt: i%3 ? at(ago(1)) : null});
      else put('tasks', t.id, {...base, status: i%4===0 ? 'assigned' : 'seen', seenAt: i%4===0 ? null : base.seenAt});
      if(i===2) put('tasks', t.id, {...S.tasks[t.id], client:true});
    }));
    const ask = ptasks(p1).find(t=>isOpen(t) && /review|edits/i.test(t.title)); if(ask) put('tasks', ask.id, {...ask, approval:{by:'dm_dana', state:'pending', reqBy:ask.owner, reqAt:at(ago(1))}, status:'review'});
    const pp1 = S.projects[p1]; put('projects', p1, {...pp1, status:'at_risk', updates:[{at:at(ago(3)), by:'dm_priya', status:'at_risk', text:'Narrative draft is in review. Budget is waiting on final numbers from finance, which puts the internal review two days behind. Submission date still holds if numbers arrive this week.'}], fields:[{id:'fpri', name:'Priority', type:'select', options:['High','Medium','Low']}]});
    saveBaseline(p3, true); const late3 = ptasks(p3).filter(t=>isOpen(t) && t.due>d).slice(0,1); late3.forEach(t => { put('tasks', t.id, {...t, due:addDays(t.due,4)}); shiftDependents(t.id); });
    put('goals','dg1',{title:'Raise $400K in new grants this year', owner:'dm_priya', mode:'number', startVal:0, target:400000, current:145000, unit:'$', start:ago(200), due:addDays(d,165), projects:[], parent:'', checkins:[{at:at(ago(7)), by:'dm_priya', val:145000, status:'on_track', note:'Hartwell and City Arts in progress.'}]});
    put('goals','dg2',{title:'Board adopts a 3-year strategic plan', owner:'dm_dana', mode:'projects', projects:[p2,p3], parent:'', start:ago(30), due:addDays(d,75), checkins:[]});
    put('rules','dr1',{...JSON.parse(JSON.stringify(RULE_RECIPES[0])), active:true, runs:3, created:at(ago(20))});
    put('rules','dr2',{name:'Grant deadlines: heads-up 3 days out', on:'due_soon', cond:{project:p1, days:3}, actions:[{type:'notify', v:'owner'},{type:'notify', v:'projowner'}], active:true, runs:5, created:at(ago(18))});
    put('projects', p1, {...S.projects[p1], form:{on:true, intro:'Need something for a grant (data, a letter, a photo)? Ask here.'}});
    S.view = 'projects'; S.statusProject = p1;
  }
  function banner(){
    const b = document.createElement('div'); b.className = 'demo-banner noprint'; b.setAttribute('role','note');
    b.innerHTML = `<span><b>Demo workspace.</b> <span class="demo-long">Riverbend Youth Arts is fictional. Everything stays in this browser and never reaches a real team hub. Emails, calendar and Claude are turned off here.</span><span class="demo-short">Fictional data, this browser only.</span></span> <button class="btn sm" id="demoReset">Reset the demo</button>`;
    document.body.prepend(b); document.getElementById('demoReset').onclick = () => { try{ localStorage.removeItem(LS_KEY); localStorage.removeItem(ME_KEY); }catch(_){} location.hash = 'projects'; location.reload(); };
  }
  window.addEventListener('load', () => { banner(); if(!team().length){ try{ seed(); }catch(e){ console.error(e); } if(!location.hash || location.hash==='#today'){ location.hash = 'projects'; } route(); } setStatus('warn','Demo: fictional data, this browser only'); });
})();
