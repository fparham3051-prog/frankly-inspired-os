/* ---------- events ---------- */
let armed = null;
function arm(el, text, reset){ if(armed!==el){ armed=el; const orig=el.textContent; el.textContent=text; setTimeout(()=>{ if(armed===el){ armed=null; el.textContent=reset||orig; } },3200); return false; } armed=null; return true; }
document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]'); if(!el) return;
  const act = el.dataset.act, id = el.dataset.id;
  if(act!=='close-dlg' && act!=='close-drawer') track('act', act);
  if(el.tagName==='A' && act!=='close-drawer') ev.preventDefault();
  if(el.tagName!=='A') ev.stopPropagation();
  if(el.closest('#gres')){ $('#gres').hidden = true; $('#gsearch').value = ''; }
  switch(act){
    case 'advance': tryAdvance(id, el.dataset.to, el); break;
    case 'export-audit': exportAudit(); break;
    case 'feedback': if($('#helpDlg').open) $('#helpDlg').close(); openFeedback(); break;
    case 'nps': { const why = ($('#nps-why')||{}).value||''; if(saveFeedback('nps', why, +el.dataset.v)){ toast('Thank you'); render(); } break; }
    case 'nps-later': try{ localStorage.setItem('fii-nps-snooze', addDays(today(),7)); }catch(_){} render(); break;
    case 'wizard': openWizard(); break;
    case 'wiz-back': openWizard(); break;
    case 'wiz-apply': applyWizard(); break;
    case 'help': openHelp(); break;
    case 'export-fn': exportFn(); break;
    case 'export-grant': exportGrant(); break;
    case 'fn-untagged': S.boardMode = 'list'; S.lf = {...S.lf, fn:'none', status:''}; if(location.hash==='#board') render(); else location.hash = 'board'; break;
    case 'retain-run': if(!arm(el, 'Click again to delete old alerts and check-ins')) break; runRetention(); break;
    case 'backup': doBackup(); break;
    case 'restore-go': if(!arm(el, 'Click again to restore')) break; doRestore(); break;
    case 'copy-notice': { const tx = ($('#notice-text')||{}).textContent||''; try{ navigator.clipboard.writeText(tx).then(()=>toast('Copied'),()=>toast('Copy blocked here. Select the text instead.')); }catch(_){ toast('Copy blocked here'); } break; }
    case 'tpl-apply': { const t = templates()[id]; if(!t) break; if(!arm(el, `Click again: replace stages and playbooks with ${t.name}`)) break; applyTemplate(id); break; }
    case 'dm-reset': S.draftModel = null; render(); break;
    case 'dm-save': saveDraftModel(); break;
    case 'of-add': S.draftModel.offers.push({code:'NEW', name:'New offer'}); render(); break;
    case 'of-del': S.draftModel.offers.splice(+el.dataset.i,1); render(); break;
    case 'clear-samples': if(!arm(el, 'Click again to permanently remove all sample data')) break; clearSamples(); break;
    case 'onb-dismiss': saveConfig('settings', {...S.settings, onboardDismissed:true}); render(); break;
    case 'onb-manual': saveConfig('settings', {...S.settings, [el.dataset.k]:true}); render(); break;
    case 'pmode': S.pipeMode = el.dataset.v; render(); break;
    case 'bmode': S.boardMode = el.dataset.v; render(); break;
    case 'ctab': S.coachTab = el.dataset.v; render(); break;
    case 'lsort': S.ls = {k:el.dataset.k, dir: S.ls.k===el.dataset.k ? -S.ls.dir : 1}; render(); break;
    case 'gmail-send': sendViaGmail(id); break;
    case 'gcal-push': pushToGcal(id); break;
    case 'gcal-load': loadGcal(); break;
    case 'gcal-off': S.gcalOn = false; try{ localStorage.removeItem('fii-gcal'); }catch(_){} watchGcal(); render(); break;
    case 'gcal-push-week': { const {d0} = gcalRange(); const days = [...Array(7)].map((_,i)=>addDays(d0,i)); const ids = [...new Set(days.flatMap(dd => eventsOn(dd).filter(e2 => (!e2.att || !e2.att.length || e2.att.includes(S.me)) && !(e2.gcal||{})[S.me]).map(e2=>e2.id)))];
      if(!ids.length){ toast('This week’s team events are already on your Google Calendar'); break; }
      (async()=>{ for(const x of ids){ await pushToGcal(x); } })(); break; }
    case 'gcal-import': openEvent(null, el.dataset.d, {title:el.dataset.t, start:el.dataset.s, end:el.dataset.e}); break;
    case 'inv-sent': updateInvoice(el.dataset.e, el.dataset.i, {issued:today(), due:addDays(today(),15)}); render(); break;
    case 'inv-paid': updateInvoice(el.dataset.e, el.dataset.i, {paid:today()}); render(); break;
    case 'inv-remind': reminderDraft(el.dataset.e, el.dataset.i); render(); break;
    case 'inv-add': { const e2 = S.engagements[el.dataset.e]; if(e2){ put('engagements', e2.id, {...e2, invoices:[...(e2.invoices||[]), {id:uid(), kind:'other', label:'Invoice', amount:0, issued:null, due:null, paid:null}]}); render(); } break; }
    case 'export-inv': exportInvoices(); break;
    case 'export-tasks': exportTasks(); break;
    case 'client-report': clientReport(id); render(); break;
    case 'lost': { const r = ($('#lost-reason')||{}).value || 'Not recorded'; if(!arm(el, `Click again to mark lost (${r})`)) break; markLost(id, r); render(); break; }
    case 'reopen': reopenLost(id); render(); break;
    case 'summary': openSummary(); break;
    case 'sum-copy': { const t2 = weeklySummary(); try{ navigator.clipboard.writeText(t2.subject+'\n\n'+t2.text).then(()=>toast('Copied'),()=>toast('Copy blocked here')); }catch(_){ toast('Copy blocked here'); } break; }
    case 'sum-email': { if(S.sending.sum) break; if(!MCP){ toast(connErr({code:'not_granted'}, GMAIL)); break; } const t2 = weeklySummary(); const to = team().map(m=>m.email).filter(Boolean); S.sending.sum = true; el.textContent = 'Sending…';
      gmailSend(to, t2.subject, t2.text).then(()=>{ toast(`Summary emailed to ${to.length} teammate${to.length>1?'s':''}`); $('#sumDlg').close(); }).catch(e2=>toast(connErr(e2, GMAIL))).finally(()=>{ delete S.sending.sum; }); break; }
    case 'dep-del': { const tk = S.tasks[id]; if(tk){ put('tasks', id, {...tk, needs:(tk.needs||[]).filter(x=>x!==el.dataset.dep)}); renderTask(); safeRender(); } break; }
    case 'cl-del': { const tk = S.tasks[id]; if(tk){ const c = (tk.checklist||[]).slice(); c.splice(+el.dataset.i,1); put('tasks', id, {...tk, checklist:c}); renderTask(); safeRender(); } break; }
    case 'link-del': { const tk = S.tasks[id]; if(tk){ const c = (tk.links||[]).slice(); c.splice(+el.dataset.i,1); put('tasks', id, {...tk, links:c}); renderTask(); } break; }
    case 'person-tasks': S.boardMode = 'list'; S.lf = {...S.lf, owner:id, status:'open'}; if(location.hash==='#board') render(); else location.hash = 'board'; break;
    case 'new': { const s=$('#nf-lead'); s.innerHTML = team().map(m=>`<option value="${m.id}" ${m.id===(S.me||leadId())?'selected':''}>${esc(m.name)}</option>`).join(''); $('#newForm').reset(); s.value = S.me||leadId();
      document.querySelectorAll('#newDlg [data-l]').forEach(x => x.textContent = LBL[x.dataset.l]); $('#nf-h').textContent = 'New '+LBL.entity; $('#nf-go').textContent = `Add and run the ${STAGES[0].name} playbook`;
      $('#nf-offer').innerHTML = Object.entries(OFFERS).map(([k,v])=>`<option value="${esc(k)}">${esc(k)} · ${esc(v)}</option>`).join(''); $('#newDlg').showModal(); break; }
    case 'close-dlg': $('#'+el.dataset.dlg).close(); if(el.dataset.dlg==='taskDlg') S.taskOpen=null; break;
    case 'open': if($('#taskDlg').open){ $('#taskDlg').close(); S.taskOpen=null; } openDrawer(id); break;
    case 'close-drawer': closeDrawer(); break;
    case 'move': moveTo(id, el.dataset.to); render(); break;
    case 'task': openTask(id); break;
    case 'new-task': S.newTaskEng = el.dataset.eng || ''; openTask('new'); break;
    case 'tstat': {
      if(el.dataset.to==='take'){ assignTask(id, S.me); toast('It’s yours'); }
      else if(setTaskStatus(id, el.dataset.to)){ toast(stName(el.dataset.to)); maybeTaskPulse(id, el.dataset.to); }
      safeRender(); break; }
    case 'tstat-note': { const note = ($('#td-note')||{}).value||''; const ok = setTaskStatus(id, el.dataset.to, note.trim()); if(ok){ toast(stName(el.dataset.to)); renderTask(); safeRender(); if(['done','blocked'].includes(el.dataset.to)){ $('#taskDlg').close(); maybeTaskPulse(id, el.dataset.to); } } break; }
    case 'del-task': if(!arm(el,'Click again to delete')) break; del('tasks', id); $('#taskDlg').close(); S.taskOpen=null; render(); break;
    case 'bfilter': S.boardFilter = el.dataset.f; render(); break;
    case 'calweek': S.calWeek = el.dataset.d==='0' ? 0 : S.calWeek + (+el.dataset.d); render(); break;
    case 'calmine': S.calMine = el.dataset.v==='1'; render(); break;
    case 'new-event': openEvent(null, el.dataset.date); break;
    case 'event': openEvent(id); break;
    case 'del-event': if(!arm(el,'Click again to delete')) break; del('events', id); $('#evDlg').close(); render(); break;
    case 'alert': { const n=S.notifs[id]; if(!n) break; if(!n.read) put('notifs', id, {...n, read:true}); if(n.task && S.tasks[n.task]) openTask(n.task); else if(n.eng && S.engagements[n.eng]) openDrawer(n.eng); safeRender(); break; }
    case 'read-all': { const old = addDays(today(),-14); myAlerts().forEach(n=>{ if(!n.read) put('notifs', n.id, {...n, read:true}); else if((n.at||'').slice(0,10) < old) del('notifs', n.id); }); render(); break; }
    case 'whoami': { $('#whoBody').innerHTML = `<h2>Who are you?</h2><p class="small muted">This picks whose tasks, calendar and alerts you see on this device.</p><div style="display:grid;gap:6px">${team().map(m=>`<button class="btn" data-act="claim" data-id="${esc(m.id)}">${av(m.id)} ${esc(m.name)} <span class="small muted">${esc(m.role||'')}</span></button>`).join('')}</div><div class="row" style="justify-content:flex-end"><button class="btn ghost" data-act="close-dlg" data-dlg="whoDlg">Close</button></div>`; $('#whoDlg').showModal(); break; }
    case 'claim': claimMe(id); if($('#whoDlg').open) $('#whoDlg').close(); break;
    case 'rm-member': { if(!arm(el,'Click again: their open tasks go to the queue')) break; list('tasks').filter(t=>t.owner===id && isOpen(t)).forEach(t=>assignTask(t.id,'')); const m=S.team[id]; if(m) put('team', id, {...m, inactive:true}); audit('Removed a teammate', m?m.name:id); render(); break; }
    case 'pe': case 'pl': { const dr=S.pulseDraft; const n=$('#pulse-note'), sp=$('#pulse-support'), an=$('#pulse-anon'); if(n) dr.note=n.value; if(sp) dr.support=sp.checked; if(an) dr.anon=an.checked; if(act==='pe') dr.energy=+el.dataset.v; else dr.load=el.dataset.v; render(); break; }
    case 'pulse-save': savePulse(); break;
    case 'pulse-edit': S.editPulse = true; S.pulseDraft = {}; render(); break;
    case 'tp': if(S.tpCtx){ const n=($('#tp-note')||{}).value||''; S.tpCtx.v=+el.dataset.v; renderTaskPulse(); $('#tp-note').value=n; } break;
    case 'tp-save': saveTaskPulse(); break;
    case 'one': openOne(id); break;
    case 'timer-start': startTimer(id); safeRender(); if($('#taskDlg').open) renderTask(); break;
    case 'timer-stop': stopTimer(id); safeRender(); if($('#taskDlg').open) renderTask(); break;
    case 'log-time': { const h = +(($('#tl-h')||{}).value||0); if(logTime(id, h)){ toast(`Logged ${fmtH(h)}`); renderTask(); safeRender(); } else toast('Enter hours to log'); break; }
    case 'apply-cal': applyCalibration(); break;
    case 'inswin': S.insWin = +el.dataset.v; render(); break;
    case 'ack': ackSupport(id); break;
    case 'outtab': S.outTab = el.dataset.tab; render(); break;
    case 'copy': { const m = S.messages[id]; if(!m) break; const text = (m.ch==='email' ? 'Subject: '+m.subj+'\n\n' : '') + m.body;
      try{ navigator.clipboard.writeText(text).then(()=>toast('Copied'),()=>toast('Copy blocked here. Select the text instead.')); }catch(_){ toast('Copy blocked here. Select the text instead.'); } break; }
    case 'sent': markSent(id); render(); break;
    case 'discard': if(!arm(el,'Click again to discard')) break; del('messages', id); render(); break;
    case 'archive': { const e=S.engagements[id]; if(e){ put('engagements', id, {...e, archived:!e.archived, log:logTo(e,'stage', e.archived?'Restored to pipeline':'Archived'), updated:nowISO()}); closeDrawer(); render(); } break; }
    case 'delete': if(!arm(el,'Click again to delete everything for this client')) break;
      audit('Deleted', (S.engagements[id]||{}).org||id); list('tasks').filter(t=>t.eng===id).forEach(t=>del('tasks',t.id)); list('messages').filter(m=>m.eng===id).forEach(m=>del('messages',m.id)); del('engagements', id); closeDrawer(); render(); toast('Engagement deleted'); break;
    case 'r-add-task': S.draftRecipes[+el.dataset.r].tasks.push({t:'', d:1, e:1, lane:'franklin'}); render(); break;
    case 'r-del-task': S.draftRecipes[+el.dataset.r].tasks.splice(+el.dataset.i,1); render(); break;
    case 'r-add-msg': S.draftRecipes[+el.dataset.r].msgs.push({lane:'client', ch:'email', s:'', b:''}); render(); break;
    case 'r-del-msg': S.draftRecipes[+el.dataset.r].msgs.splice(+el.dataset.i,1); render(); break;
    case 'r-reset': if(!arm(el,'Click again to restore defaults')) break; S.draftRecipes = JSON.parse(JSON.stringify(DEFAULT_RECIPES)); saveConfig('recipes',{list:S.draftRecipes}); render(); toast('Default playbooks restored'); break;
    case 'r-save': saveConfig('recipes',{list:JSON.parse(JSON.stringify(S.draftRecipes))}); toast('Playbooks saved'); break;
  }
});
document.addEventListener('keydown', ev => {
  if(ev.key==='/' && !typing()){ ev.preventDefault(); $('#gsearch').focus(); return; }
  if(ev.key==='Escape' && !$('#gres').hidden){ $('#gres').hidden = true; }
  if((ev.key==='Enter' || ev.key===' ') && ev.target.matches('[role="button"]:not(button)')){ ev.preventDefault(); ev.target.click(); }
  if(ev.key==='Escape' && S.drawer && !document.querySelector('dialog[open]')) closeDrawer();
});
$('#taskDlg').addEventListener('close', ()=>{ S.taskOpen=null; });
document.addEventListener('input', ev => {
  const t = ev.target;
  if(t.id==='gsearch'){ runSearch(t.value); return; }
  if(t.id==='lf-q'){ S.lf = {...S.lf, q:t.value}; const pos = t.selectionStart; render(); const n = $('#lf-q'); if(n){ n.focus(); try{ n.setSelectionRange(pos,pos); }catch(_){} } }
});
document.addEventListener('focusin', ev => { if(ev.target.id==='gsearch' && ev.target.value) runSearch(ev.target.value); });
document.addEventListener('click', ev => { if(!ev.target.closest('.gs')) { const g=$('#gres'); if(g) g.hidden = true; } }, true);
document.addEventListener('dragstart', ev => { const el = ev.target.closest && ev.target.closest('[data-drag]'); if(!el) return; S.drag = {kind:el.dataset.drag, id:el.dataset.id}; try{ ev.dataTransfer.setData('text/plain', el.dataset.id); ev.dataTransfer.effectAllowed = 'move'; }catch(_){} el.classList.add('dragging'); });
document.addEventListener('dragend', ev => { S.drag = null; document.querySelectorAll('.dragging,.drop-hover').forEach(x=>x.classList.remove('dragging','drop-hover')); });
const dropOk = z => S.drag && z && ((S.drag.kind==='eng' && z.dataset.drop==='stage') || (S.drag.kind==='task' && z.dataset.drop==='owner'));
document.addEventListener('dragover', ev => { const z = ev.target.closest && ev.target.closest('[data-drop]'); if(!dropOk(z)) return; ev.preventDefault(); document.querySelectorAll('.drop-hover').forEach(x=>{ if(x!==z) x.classList.remove('drop-hover'); }); z.classList.add('drop-hover'); });
document.addEventListener('drop', ev => { const z = ev.target.closest && ev.target.closest('[data-drop]'); if(!dropOk(z)) return; ev.preventDefault(); const d = S.drag; S.drag = null; z.classList.remove('drop-hover');
  if(d.kind==='eng'){ const e = S.engagements[d.id]; if(e && e.stage!==z.dataset.stage){ if(stageIdx(z.dataset.stage) > stageIdx(e.stage)+1){ toast('Move one stage at a time so each playbook runs in order'); return; } tryAdvance(d.id, z.dataset.stage, null); } }
  if(d.kind==='task'){ const t = S.tasks[d.id]; const o = z.dataset.owner||''; if(t && (t.owner||'')!==o){ assignTask(d.id, o); toast(o ? `Assigned to ${mname(o)}` : 'Moved to the team queue'); render(); } } });
document.addEventListener('change', ev => {
  const t = ev.target;
  if(t.dataset.ef && S.drawer){
    const e = S.engagements[S.drawer]; if(!e) return;
    if(t.dataset.ef==='stage'){ moveTo(e.id, t.value); render(); return; }
    const val = t.dataset.ef==='value' ? (+t.value||0) : t.value;
    if(e[t.dataset.ef] === val) return;
    put('engagements', e.id, {...e, [t.dataset.ef]:val, updated:nowISO()});
    if(t.dataset.ef==='lead' && val) notify(val, `You are now account lead for ${e.org}`, {eng:e.id});
    if(t.dataset.ef==='email'){ list('messages').filter(m=>m.eng===e.id && m.status==='draft' && m.lane==='client' && !m.to).forEach(m=>put('messages',m.id,{...m,to:val})); }
    return;
  }
  if(t.dataset.td){ const tk = S.tasks[t.dataset.id]; if(!tk) return;
    if(t.dataset.td==='owner'){ assignTask(tk.id, t.value); toast(t.value?`Assigned to ${mname(t.value)}`:'Moved to queue'); }
    if(t.dataset.td==='est'){ put('tasks', tk.id, {...tk, est:+t.value||0}); }
    if(['fn','prog','fund'].includes(t.dataset.td)){ put('tasks', tk.id, {...tk, [t.dataset.td]:t.value}); }
    if(t.dataset.td==='repeat'){ put('tasks', tk.id, {...tk, repeat:t.value}); toast(t.value ? `Repeats ${t.value}. The next one is created when this is done.` : 'No longer repeats'); }
    if(t.dataset.td==='dep' && t.value){ put('tasks', tk.id, {...tk, needs:[...new Set([...(tk.needs||[]), t.value])]}); toast('It now waits for that task'); }
    if(t.dataset.td==='due' && t.value && t.value!==tk.due){ put('tasks', tk.id, {...tk, due:t.value, history:hist(tk, st(tk), `Due date moved to ${fmtDate(t.value)}`)}); if(tk.owner) notify(tk.owner, `Due date for “${tk.title}” moved to ${fmtDate(t.value)}`, {task:tk.id}); if(typeof afterDates==='function') afterDates(tk.id); }
    renderTask(); safeRender(); return; }
  if(t.dataset.gate !== undefined && t.dataset.eid){ toggleGate(t.dataset.eid, t.dataset.sid, +t.dataset.gate); safeRender(); return; }
  if(S.draftModel && (t.dataset.dmt || t.dataset.dml)){ if(t.dataset.dmt) S.draftModel[t.dataset.dmt] = t.checked; if(t.dataset.dml) S.draftModel[t.dataset.dml] = t.value.split('\n').map(x=>x.trim()).filter(Boolean); return; }
  if(t.id==='restore-file'){ previewRestore(t.files && t.files[0]); return; }
  if(t.dataset.pv){ savePrivacy({[t.dataset.pv]:t.checked}); toast('Privacy setting saved'); return; }
  if(t.dataset.pvN){ savePrivacy({[t.dataset.pvN]:Math.max(1,+t.value||1)}); toast('Retention saved'); return; }
  if(S.draftModel && (t.dataset.dm || t.dataset.of!==undefined || t.dataset.sg!==undefined || t.dataset.ln!==undefined)){
    const dm = S.draftModel;
    if(t.dataset.dm){ const [a,b] = t.dataset.dm.split('.'); dm[a] = dm[a] || {}; dm[a][b] = t.type==='checkbox' ? t.checked : (b==='pct' ? Math.max(0,Math.min(100,+t.value||0))/100 : t.value); }
    if(t.dataset.of!==undefined){ const o = dm.offers[+t.dataset.of]; if(o) o[t.dataset.k] = t.dataset.k==='code' ? t.value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g,'') : t.value; }
    if(t.dataset.sg!==undefined){ const sg = dm.stages[+t.dataset.sg]; const k = t.dataset.k; if(sg){ sg[k] = k==='target' ? Math.max(1,+t.value||1) : k==='prob' ? Math.max(0,Math.min(100,+t.value||0))/100 : k==='gates' ? t.value.split('\n').map(x=>x.trim()).filter(Boolean) : t.value; if(k==='gates') sg.gate = sg.gates[sg.gates.length-1]||''; } }
    if(t.dataset.ln!==undefined){ dm.lanes = dm.lanes || LANES.map(l=>l.name); dm.lanes[+t.dataset.ln] = t.value; }
    return;
  }
  if(t.dataset.ev){ saveConfig('settings', {...S.settings, [t.dataset.ev]:Math.max(0,+t.value||0)}); toast('Saved'); return; }
  if(t.dataset.lf){ S.lf = {...S.lf, [t.dataset.lf]:t.value}; render(); return; }
  if(t.dataset.cl !== undefined && t.dataset.id){ const tk = S.tasks[t.dataset.id]; if(!tk) return; const c = (tk.checklist||[]).map((x,i)=> i===+t.dataset.cl ? {...x, done:t.checked} : x); put('tasks', tk.id, {...tk, checklist:c}); safeRender(); return; }
  if(t.dataset.inv && t.dataset.eid){ updateInvoice(t.dataset.eid, t.dataset.inv, {amount:+t.value||0}); return; }
  if(t.dataset.rate){ const r = {...(rcfg().rates||{})}; r[t.dataset.rate] = {...(r[t.dataset.rate]||{}), cost:+t.value||0}; saveConfig('rates', {...rcfg(), rates:r}); toast('Rate saved'); return; }
  if(t.dataset.rc){ const v = +t.value||0; saveConfig('rates', {...rcfg(), [t.dataset.rc]: t.dataset.rc==='targetMargin' ? v/100 : v}); toast('Saved'); return; }
  if(t.dataset.tm){ const m = S.team[t.dataset.id]; if(!m) return; const v = t.type==='checkbox' ? t.checked : t.dataset.tm==='capacity' ? (+t.value||0) : t.value; if(m[t.dataset.tm]===v) return; put('team', m.id, {...m, [t.dataset.tm]:v}); resolveMe(); return; }
  if(t.dataset.lo){ const lo = {...((S.settings&&S.settings.laneOwners)||{}), [t.dataset.lo]:t.value}; saveConfig('settings', {...S.settings, laneOwners:lo}); toast('Saved'); return; }
  if(t.dataset.field && t.dataset.id){ const m = S.messages[t.dataset.id]; if(!m || m[t.dataset.field]===t.value) return; put('messages', m.id, {...m, [t.dataset.field]:t.value}); return; }
  if(t.dataset.r !== undefined && S.draftRecipes){
    const r = S.draftRecipes[+t.dataset.r];
    if(t.dataset.rf==='on'){ r.on = t.checked; return; }
    if(t.dataset.rt !== undefined){ const x=r.tasks[+t.dataset.rt]; x[t.dataset.k] = (t.dataset.k==='d'||t.dataset.k==='e') ? (+t.value||0) : t.value; }
    if(t.dataset.rm !== undefined){ r.msgs[+t.dataset.rm][t.dataset.k] = t.value; }
  }
});
document.addEventListener('submit', ev => {
  const f = ev.target; ev.preventDefault();
  if(f.id==='newForm'){
    const org = $('#nf-org').value.trim(); if(!org) return;
    const id = createEngagement({org, contact:$('#nf-contact').value.trim(), email:$('#nf-email').value.trim(), offer:$('#nf-offer').value, value:$('#nf-value').value, source:$('#nf-source').value.trim(), lead:$('#nf-lead').value});
    $('#newDlg').close(); render(); openDrawer(id);
  }
  if(f.id==='newTask'){
    const title = $('#nt-title').value.trim(); if(!title) return;
    const owner = $('#nt-owner').value;
    createTask({title, owner, due:$('#nt-due').value||today(), eng:$('#nt-eng').value, lane:'franklin', est:+$('#nt-est').value||0});
    $('#taskDlg').close(); S.taskOpen=null; render(); if(S.drawer) renderDrawer();
    toast(owner && owner!==S.me ? `Sent to ${mname(owner)}. They’ll see it in My day.` : owner ? 'Added to your list' : 'Added to the team queue');
  }
  if(f.id==='evForm'){
    const id = f.dataset.id || uid(); const isNew = !f.dataset.id;
    const att = [...document.querySelectorAll('.ev-att:checked')].map(x=>x.value);
    const ev2 = {title:$('#ev-title').value.trim(), date:$('#ev-date').value||today(), start:$('#ev-start').value, end:$('#ev-end').value, repeat:$('#ev-repeat').value, type:$('#ev-type').value, eng:$('#ev-eng').value, att, createdBy:(S.events[id]||{}).createdBy||S.me||''};
    if(!ev2.title) return;
    put('events', id, ev2);
    (att.length ? att : team().map(m=>m.id)).forEach(p => notify(p, `${isNew?'New':'Updated'} on the calendar: ${ev2.title}, ${fmtDate(ev2.date)} ${fmtTime(ev2.start)}${ev2.repeat?' (repeats)':''}`, {eng:ev2.eng}));
    $('#evDlg').close(); render();
  }
  if(f.id==='oneForm'){ saveOne(f.dataset.id); }
  if(f.id==='fbForm'){ const k = (f.querySelector('input[name=fbk]:checked')||{}).value||'idea'; const tx = $('#fb-text').value; if(!tx.trim()) return; if(saveFeedback(k, tx)){ $('#fbDlg').close(); toast('Thanks. Your feedback went to the lead.'); } }
  if(f.id==='wizForm'){ const g = n => (f.querySelector(`input[name=wz-${n}]:checked`)||{}).value; const pains = [...f.querySelectorAll('input[name=wz-pain]:checked')].map(x=>x.value);
    if(pains.length>3){ toast('Pick up to 3 pain points'); return; }
    S.wiz = {work:g('work')||'consulting', size:g('size')||'3-5', budget:g('budget')||'250k-1m', pains, score:$('#wz-score').value, name:$('#wz-name').value.trim(), sender:$('#wz-sender').value.trim()}; showWizPlan(); }
  if(f.id==='clForm'){ const v = $('#cl-new').value.trim(); const tk = S.tasks[f.dataset.id]; if(v && tk){ put('tasks', tk.id, {...tk, checklist:[...(tk.checklist||[]), {t:v, done:false}]}); renderTask(); safeRender(); setTimeout(()=>{ const x=$('#cl-new'); if(x) x.focus(); },0); } }
  if(f.id==='cmForm'){ const v = $('#cm-new').value; if(v.trim()){ addComment(f.dataset.id, v); renderTask(); safeRender(); } }
  if(f.id==='lkForm'){ const url = $('#lk-url').value.trim(); const tk = S.tasks[f.dataset.id]; if(!/^https?:\/\//i.test(url)){ toast('Links need to start with https://'); return; } if(tk){ put('tasks', tk.id, {...tk, links:[...(tk.links||[]), {label:$('#lk-label').value.trim()||url.replace(/^https?:\/\//,'').slice(0,40), url}]}); renderTask(); } }
  if(f.id==='prepForm'){ const k=myKey(); if(!k){ toast('Sign in to save'); return; } saveSub('coach', k, 'prep', {member:S.me, text:$('#prep-text').value.trim(), at:nowISO()}); toast('Saved for your next 1:1'); }
  if(f.id==='retroForm'){ const k=myKey(); const v=+$('#rt-v').value; if(!k||!v){ toast('Pick how it felt (1–5)'); return; } const e=S.engagements[f.dataset.eng];
    saveSub('pulses', k, 'r-'+f.dataset.eng, {member:S.me, kind:'retro', date:today(), energy:v, eng:f.dataset.eng, stage:e?e.stage:'closeout', well:$('#rt-well').value.trim(), hard:$('#rt-hard').value.trim(), change:$('#rt-change').value.trim(), note:$('#rt-hard').value.trim(), at:nowISO()});
    toast('Retro submitted. Thank you.'); renderDrawer(); }
  if(f.id==='addMember'){
    const name = $('#am-name').value.trim(); if(!name) return;
    const used = team().map(m=>m.color);
    put('team', uid(), {name, role:$('#am-role').value.trim(), email:$('#am-email').value.trim(), color: PALETTE.find(c=>!used.includes(c)) || PALETTE[0], lead:false, fiveF:false, uid:'', joined:nowISO()});
    toast(`${name} added`); render();
  }
});
function route(){
  let h = (location.hash||'').slice(1);
  h = {flow:'pipeline', recipes:'playbooks'}[h] || h;
  S.view = ['today','health','setup','privacy','revenue','insights','coaching','board','calendar','pipeline','outbox','playbooks','team','projects','project','workload','goals','dashboards','automations','request','clientview','benchmarks','usability'].includes(h) ? h : 'today';
  if(S.view!=='playbooks') S.draftRecipes = null;
  track('view', S.view); render(); window.scrollTo(0,0);
}
window.addEventListener('hashchange', route);
setInterval(()=>{ if(S.view==='today' || S.view==='calendar' || list('tasks').some(t=>t.timerStart)) safeRender(); }, 60000);
try{ S.gcalOn = localStorage.getItem('fii-gcal')==='1'; }catch(_){}
route();
initStore();
initExtras();
if(typeof initPM==='function') initPM();
