/* ---------- v13: the conversation lives on the work ----------
   Every message is its own record (path "msgs"), attached to a task, a project
   or a client: on = "task:<id>" | "project:<id>" | "client:<id>". Replies point
   at their first message (parent). A message can be marked as the decision, or
   turned into a task. Reactions are records of their own ("reacts"), one per
   person per reaction (id = message.person.reaction), so two people reacting at once never collide.
   The Inbox lists what needs you; History shows every change and can undo it. */

const TALK_REACTS = [['ok', '👍', 'Agree'], ['done', '✅', 'Done'], ['q', '❓', 'Question']];
const byAt = (a, b) => (a.at || '').localeCompare(b.at || '');
function msgsOn(on){ return list('msgs').filter(m => m.on === on).sort(byAt); }
function rootsOn(on){ return msgsOn(on).filter(m => !m.parent && (!m.deleted || repliesTo(m.id).length)); }
function repliesTo(id){ return list('msgs').filter(m => m.parent === id && !m.deleted).sort(byAt); }
function msgCount(on){ return list('msgs').filter(m => m.on === on && !m.deleted).length; }
function decisionsOn(on){ return msgsOn(on).filter(m => m.decision && !m.deleted); }
function reactsOf(id){ return list('reacts').filter(r => r.msg === id); }
function mentionsIn(text){ return team().filter(m => new RegExp('@' + escRe(first(m.id)) + '\\b', 'i').test(text)).map(m => m.id); }
function talkTarget(on){
  const i = String(on || '').indexOf(':'), k = on.slice(0, i), id = on.slice(i + 1);
  if(k === 'task'){ const t = S.tasks[id]; return t ? {kind:k, id, title:t.title, eng:t.eng || '', project:t.project || '', people:[t.owner, t.assignedBy, ...(t.assignees || [])]} : null; }
  if(k === 'project'){ const p = S.projects[id]; return p ? {kind:k, id, title:p.name, eng:p.eng || '', project:id, people:[p.owner]} : null; }
  if(k === 'client'){ const e = S.engagements[id]; return e ? {kind:k, id, title:e.org, eng:id, project:'', people:[e.lead]} : null; }
  return null;
}
function notifyOn(to, text, on, email, parent){
  if(!to || to === S.me || !S.team[to]) return;
  const tg = talkTarget(on) || {};
  put('notifs', uid(), {to, text, on, task:tg.kind === 'task' ? tg.id : '', eng:tg.eng || '', by:S.me || '', at:nowISO(), read:false});
  if(!email) return;
  if(window.FLOWHUB_HOST === 'fios') mailAlert(to, text, on, parent); else if(typeof emailAlert === 'function') emailAlert(to, text);
}
// In the operations app, a mention goes out by email with the conversation attached,
// so the person can answer by replying to the email; the answer lands in the thread.
function mailAlert(to, text, on, parent){
  const me = mem(S.me), r = mem(to);
  if(!me || !me.emailAlerts || !r || !r.email) return;
  const tg = talkTarget(on) || {};
  const link = location.origin + '/hub/#' + (tg.kind === 'task' ? 'task/' + encodeURIComponent(tg.id) : tg.kind === 'project' ? 'project/' + encodeURIComponent(tg.id) : 'inbox');
  fetch('/api/hub/email', {method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify({to:r.email, on, parent:parent || '',
    subject:`[Frankly Inspired] ${text.length > 72 ? text.slice(0, 70) + '…' : text}`,
    body:`${text}\n\nReply to this email to answer in the conversation, or open it here: ${link}\n\nSent from Projects & Team by ${me.name}.`})})
    .then(x => { if(!x.ok && !mailAlert._warned){ mailAlert._warned = true; toast('Mention saved; the email alert was not sent.'); } }).catch(() => {});
}
function postMsg(on, text, {parent = '', by, rule = '', quiet = false} = {}){
  text = String(text || '').trim(); if(!text || !on) return null;
  const id = uid(), who = by != null ? by : (S.me || ''), mentions = mentionsIn(text);
  put('msgs', id, {on, parent, by:who, text, at:nowISO(), mentions, rule});
  if(quiet || !who) return id;
  const tg = talkTarget(on) || {title:'a conversation', people:[]};
  const name = first(who) || 'Someone', snip = text.slice(0, 120);
  const thread = parent ? [S.msgs[parent] && S.msgs[parent].by, ...repliesTo(parent).map(r => r.by)] : [];
  new Set([...mentions, ...thread, ...tg.people].filter(Boolean)).forEach(p => notifyOn(p,
    mentions.includes(p) ? `${name} mentioned you on “${tg.title}”: ${snip}` : parent ? `${name} replied on “${tg.title}”: ${snip}` : `${name} wrote on “${tg.title}”: ${snip}`,
    on, mentions.includes(p), parent || id));
  return id;
}
// Older code calls addComment(taskId, text); it now posts a message on the task.
addComment = function(id, text){ return postMsg('task:' + id, text); };

/* ---------- actions ---------- */
function talkDecide(id){
  const m = S.msgs[id]; if(!m) return;
  put('msgs', id, {...m, decision: m.decision ? null : {by:S.me || '', at:nowISO()}});
  if(!m.decision){ const tg = talkTarget(m.on); if(tg) tg.people.concat(m.by).filter(Boolean).forEach(p => notifyOn(p, `${first(S.me) || 'Someone'} recorded a decision on “${tg.title}”: ${(m.text || '').slice(0, 120)}`, m.on, false)); }
}
function talkMakeTask(id){
  const m = S.msgs[id]; if(!m || m.taskRef) return;
  const tg = talkTarget(m.on) || {}, src = tg.kind === 'task' ? S.tasks[tg.id] : null;
  const title = (m.text || '').split('\n')[0].replace(/@\w+/g, '').trim().slice(0, 90) || 'Follow up';
  const due = addDays(today(), 3);
  const nid = tg.project && typeof pmTask === 'function' && S.projects[tg.project]
    ? pmTask(tg.project, title, {due, section:src ? src.section : ''})
    : createTask({title, eng:tg.eng || '', due, src:'message'});
  if(!nid) return;
  put('msgs', id, {...m, taskRef:nid});
  postMsg('task:' + nid, `From ${mname(m.by) || 'a message'} on “${tg.title || 'a conversation'}”: ${m.text}`, {quiet:true});
  toast('Task created from the message.');
  return nid;
}
function talkReact(id, code){
  const rid = `${id}.${S.me}.${code}`;
  if(S.reacts[rid]) del('reacts', rid); else put('reacts', rid, {msg:id, by:S.me || '', e:code, at:nowISO()});
}
function talkDelete(id){ const m = S.msgs[id]; if(m) put('msgs', id, {...m, deleted:true, text:'', edited:nowISO()}); }
function talkEdit(id, text){ const m = S.msgs[id]; text = String(text || '').trim(); if(m && text) put('msgs', id, {...m, text, mentions:mentionsIn(text), edited:nowISO()}); }

/* ---------- views ---------- */
const talkText = s => esc(s).replace(/@(\w+)/g, '<b style="color:var(--navy)">@$1</b>').replace(/\n/g, '<br>');
function msgHtml(m, reply){
  const mine = m.by && m.by === S.me, sys = !m.by;
  if(m.deleted) return `<div class="talk-msg${reply ? ' reply' : ''}"><span class="small muted">Message deleted</span></div>`;
  const rs = reactsOf(m.id);
  const chips = TALK_REACTS.map(([k, e, l]) => { const n = rs.filter(r => r.e === k); const on = n.some(r => r.by === S.me);
    return `<button type="button" class="talk-chip${on ? ' on' : ''}" data-talk="react" data-id="${esc(m.id)}" data-e="${k}" aria-pressed="${on}" title="${l}${n.length ? ': ' + esc(n.map(r => first(r.by)).join(', ')) : ''}">${e}${n.length ? ' ' + n.length : ''}</button>`; }).join('');
  const editing = S.talkEdit === m.id;
  const tref = m.taskRef && S.tasks[m.taskRef];
  return `<div class="talk-msg${reply ? ' reply' : ''}${m.decision ? ' decided' : ''}" id="msg-${esc(m.id)}">
    <div class="talk-head">${sys ? '<span class="av empty" title="Automation">⚙</span>' : m.guest ? '<span class="av empty" title="Replied by email">@</span>' : av(m.by)} <b>${esc(sys ? 'Automation' : m.guest || mname(m.by))}</b>${m.via === 'email' ? ' <span class="small muted">by email</span>' : m.via === 'api' ? ' <span class="small muted">via API</span>' : ''} <span class="muted small">${fmtWhen(m.at)}${m.edited ? ' · edited' : ''}</span>${m.decision ? ` <span class="flag" style="margin:0" title="Recorded by ${esc(mname(m.decision.by))}">Decision</span>` : ''}</div>
    ${editing ? `<form class="talk-form" id="talkedit-${esc(m.id)}" data-talkedit="${esc(m.id)}"><textarea aria-label="Edit message" rows="2">${esc(m.text)}</textarea><span class="row"><button class="btn sm primary" type="submit">Save</button><button type="button" class="btn sm ghost" data-talk="edit-cancel">Cancel</button></span></form>`
      : `<div class="talk-body">${talkText(m.text)}</div>`}
    <div class="talk-acts">${chips}
      ${!reply ? `<button type="button" class="btn sm ghost" data-talk="reply" data-id="${esc(m.id)}">Reply</button>` : ''}
      <button type="button" class="btn sm ghost" data-talk="decide" data-id="${esc(m.id)}">${m.decision ? 'Not the decision' : 'Mark as decision'}</button>
      ${tref ? `<a href="#" class="small" data-talk="open-task" data-id="${esc(m.taskRef)}">Task: ${esc(tref.title)}</a>` : `<button type="button" class="btn sm ghost" data-talk="make-task" data-id="${esc(m.id)}">Make a task</button>`}
      ${mine && !editing ? `<button type="button" class="btn sm ghost" data-talk="edit" data-id="${esc(m.id)}">Edit</button><button type="button" class="btn sm ghost danger" data-talk="delete" data-id="${esc(m.id)}">Delete</button>` : ''}
    </div></div>`;
}
function threadHtml(on, {placeholder} = {}){
  const roots = rootsOn(on), decs = decisionsOn(on);
  const hint = team().filter(m => m.id !== S.me).map(m => first(m.id))[0] || 'Name';
  const fid = 'talknew-' + on.replace(/[^\w-]/g, '_');
  return `<div class="talk" data-on="${esc(on)}">
    ${decs.length ? `<div class="talk-decs"><b class="small">Decisions</b>${decs.map(m => `<div class="small">✔ <a href="#msg-${esc(m.id)}" data-talk="jump" data-id="${esc(m.id)}">${esc((m.text || '').slice(0, 160))}</a> <span class="muted">· ${esc(mname(m.decision.by))}, ${fmtWhen(m.decision.at)}</span></div>`).join('')}</div>` : ''}
    ${roots.map(m => `<div class="talk-thread">${msgHtml(m, false)}${repliesTo(m.id).map(r => msgHtml(r, true)).join('')}
      ${S.talkReply === m.id ? `<form class="talk-form reply" id="talkreply-${esc(m.id)}" data-talkreply="${esc(m.id)}" data-on="${esc(on)}"><textarea aria-label="Reply" rows="2" placeholder="Reply…"></textarea><span class="row"><button class="btn sm primary" type="submit">Reply</button><button type="button" class="btn sm ghost" data-talk="reply-cancel">Cancel</button></span></form>` : ''}</div>`).join('')
      || '<div class="small muted">No messages yet. Ask a question, share an update, or type @ and a first name to bring someone in.</div>'}
    <form class="talk-form" id="${fid}" data-talknew="${esc(on)}"><textarea aria-label="New message" rows="2" placeholder="${esc(placeholder || `Message… (@${hint} to notify)`)}"></textarea><button class="btn sm primary" type="submit">Post</button></form>
  </div>`;
}
function talkPanel(t){
  return `<div class="panel" style="padding:12px;display:grid;gap:8px"><div class="spread"><h3>Conversation</h3><span class="small muted">${msgCount('task:' + t.id) || ''}</span></div>${threadHtml('task:' + t.id)}</div>${historyPanel('tasks', t.id)}`;
}
function talkBlock(on, title){ return `<div><h3 style="margin-bottom:8px">${esc(title || 'Discussion')}</h3>${threadHtml(on)}</div>`; }
// Project tab: the project's own discussion, then every decision made on it or its tasks.
function pTalk(p){
  const tids = new Set(list('tasks').filter(t => t.project === p.id).map(t => t.id));
  const decs = list('msgs').filter(m => m.decision && !m.deleted && (m.on === 'project:' + p.id || (m.on.startsWith('task:') && tids.has(m.on.slice(5))))).sort(byAt).reverse();
  return `<div class="grid2" style="align-items:start"><div class="panel"><h2 style="margin-bottom:10px">Discussion</h2>${threadHtml('project:' + p.id, {placeholder:'Start a thread about this project…'})}</div>
    <div class="panel"><h2 style="margin-bottom:10px">Decisions on this project</h2>${decs.length ? decs.map(m => { const tg = talkTarget(m.on) || {};
      return `<div class="small" style="padding:6px 0;border-bottom:1px solid var(--line)">✔ ${esc(m.text)}<div class="muted">${esc(mname(m.decision.by))} · ${fmtWhen(m.decision.at)}${tg.kind === 'task' ? ` · on <a href="#" data-talk="open-task" data-id="${esc(tg.id)}">${esc(tg.title)}</a>` : ''}</div></div>`; }).join('')
      : '<div class="small muted">None yet. Press “Mark as decision” on any message and it is recorded here, with who decided and when.</div>'}</div></div>`;
}

/* ---------- history and undo ---------- */
const ACT_WORD = {create:'Created', update:'Changed', delete:'Deleted', restore:'Restored'};
const FIELD_WORD = {title:'title', due:'due date', owner:'owner', status:'status', section:'section', start:'start', est:'estimate', checklist:'checklist', needs:'dependencies', assignees:'assignees', desc:'description', notes:'notes', history:'status trail', timeLog:'time', priority:'priority', text:'words', decision:'decision'};
function historyPanel(path, id){
  if(window.FLOWHUB_HOST !== 'fios') return '';
  const key = path + '|' + id, h = (S.talkHist || {})[key];
  return `<div class="panel" style="padding:12px;display:grid;gap:8px"><div class="spread"><h3>History</h3>${h ? '' : `<button type="button" class="btn sm" data-talk="hist" data-path="${esc(path)}" data-id="${esc(id)}">Show changes</button>`}</div>
    ${!h ? '<div class="small muted">Every change, who made it and when. Any change can be undone.</div>' : h.loading ? '<div class="small muted">Loading…</div>' : h.error ? `<div class="small muted">${esc(h.error)}</div>`
      : h.items.length ? h.items.map(a => `<div class="row small" style="justify-content:space-between;border-bottom:1px solid var(--line);padding:4px 0"><span>${av(a.by)} ${ACT_WORD[a.action] || a.action}${a.action === 'update' && a.changed.length ? ' ' + esc(a.changed.slice(0, 4).map(k => FIELD_WORD[k] || k).join(', ')) : ''}${a.merged ? ' <span class="muted" title="Saved from an older copy and merged with a newer change">(merged)</span>' : ''} <span class="muted">· ${fmtWhen(a.at)}</span></span><button type="button" class="btn sm ghost" data-talk="undo" data-actid="${a.id}" title="Put it back the way it was before this change">Undo</button></div>`).join('')
      : '<div class="small muted">No changes recorded yet.</div>'}</div>`;
}
function loadHist(path, id){
  S.talkHist = S.talkHist || {}; const key = path + '|' + id;
  S.talkHist[key] = {loading:true}; rerenderTalk();
  window.FIOS_HUB.activity(path, id).then(j => { S.talkHist[key] = {items:j.items || []}; rerenderTalk(); })
    .catch(e => { S.talkHist[key] = {error:'History is not available right now.'}; rerenderTalk(); });
}
async function talkUndo(act){
  try{ const j = await window.FIOS_HUB.restore(act); toast(j.back ? 'Put back.' : 'Undone.'); S.talkHist = {}; S.talkDeleted = null; setTimeout(rerenderTalk, 400); }
  catch(e){ toast('Could not undo that: ' + (e.message || 'try again')); }
}
// An undo bar after deleting a task, project or goal.
function undoBar(text, acts){
  let bar = document.getElementById('undoBar');
  if(!bar){ bar = document.createElement('div'); bar.id = 'undoBar'; bar.className = 'undo-bar'; bar.setAttribute('role', 'status'); document.body.appendChild(bar); }
  bar.innerHTML = `<span>${esc(text)}</span><button type="button" class="btn sm">Undo</button>`;
  bar.querySelector('button').onclick = async () => { bar.classList.remove('on'); for(const a of acts.slice().reverse()) await talkUndo(a); };
  bar.classList.add('on'); clearTimeout(undoBar._t); undoBar._t = setTimeout(() => bar.classList.remove('on'), 9000);
}
if(window.FIOS_HUB && window.FIOS_HUB.onActivity){
  window.FIOS_HUB.onActivity(acts => {
    const big = acts.filter(a => ['tasks', 'projects', 'goals'].includes(a.path));
    const gone = big.filter(a => a.data == null);
    // Only deletions get the bar; any other change is undone from its History panel, on purpose.
    if(gone.length) undoBar(gone.length === 1 ? `${{tasks:'Task', projects:'Project', goals:'Goal'}[gone[0].path]} deleted.` : `${gone.length} items deleted.`, gone.map(a => a.act));
  });
}

/* ---------- Inbox ---------- */
function viewInbox(){
  const all = myAlerts(), unread = all.filter(n => !n.read), show = S.inboxAll ? all : unread;
  if(window.FLOWHUB_HOST === 'fios' && S.talkDeleted == null){ S.talkDeleted = {loading:true}; window.FIOS_HUB.deleted().then(j => { S.talkDeleted = {items:j.items || []}; safeRender(); }).catch(() => { S.talkDeleted = {items:[]}; }); }
  const del = S.talkDeleted && S.talkDeleted.items ? S.talkDeleted.items : [];
  const where = n => { const tg = n.on ? talkTarget(n.on) : (n.task && S.tasks[n.task] ? talkTarget('task:' + n.task) : null); return tg ? `${{task:'Task', project:'Project', client:'Client'}[tg.kind]}: ${tg.title}` : ''; };
  return `<section class="spread"><div><h1>Inbox</h1><p class="muted">Mentions, replies, decisions, assignments and approvals that need you. ${window.FIOS_HUB && window.FIOS_HUB.isLive && window.FIOS_HUB.isLive() ? 'Updates arrive live.' : ''}</p></div>
    <div class="row"><div class="seg" role="group" aria-label="Show"><button data-talk="inbox-unread" aria-pressed="${!S.inboxAll}">Unread${unread.length ? ' ' + unread.length : ''}</button><button data-talk="inbox-all" aria-pressed="${!!S.inboxAll}">All</button></div>
      <button class="btn" data-talk="inbox-read-all" ${unread.length ? '' : 'disabled'}>Mark all read</button></div></section>
    <div class="panel">${show.length ? show.slice(0, 120).map(n => `<button type="button" class="inbox-row${n.read ? '' : ' unread'}" data-talk="inbox-open" data-id="${esc(n.id)}"><span class="inbox-dot" aria-hidden="true"></span>${av(n.by)}<span class="inbox-text"><span>${esc(n.text)}</span><span class="small muted">${esc(where(n))}${where(n) ? ' · ' : ''}${fmtWhen(n.at)}</span></span></button>`).join('')
      : `<div class="empty">${S.inboxAll ? 'Nothing here yet.' : 'All caught up.'}</div>`}</div>
    ${del.length ? `<div class="panel" style="margin-top:16px"><h2 style="margin-bottom:8px">Recently deleted</h2><p class="small muted" style="margin-bottom:8px">Kept for 30 days. Restore brings it back exactly as it was.</p>${del.map(a => `<div class="row small" style="justify-content:space-between;border-bottom:1px solid var(--line);padding:6px 0"><span><b>${esc({tasks:'Task', projects:'Project', goals:'Goal', msgs:'Message'}[a.path] || a.path)}:</b> ${esc(a.title)} <span class="muted">· ${esc(mname(a.by))}, ${fmtWhen(a.at)}</span></span><button type="button" class="btn sm" data-talk="undo" data-actid="${a.id}">Restore</button></div>`).join('')}</div>` : ''}`;
}
function inboxOpen(id){
  const n = S.notifs[id]; if(!n) return;
  if(!n.read) put('notifs', id, {...n, read:true});
  const tg = n.on ? talkTarget(n.on) : null;
  if(tg && tg.kind === 'project'){ S.pTab = 'talk'; openProject(tg.id, 'talk'); return; }
  if(tg && tg.kind === 'client'){ openDrawer(tg.id); return; }
  const tid = tg ? tg.id : n.task; if(tid && S.tasks[tid]){ openTask(tid); safeRender(); return; }
  if(n.eng && S.engagements[n.eng]) openDrawer(n.eng); else safeRender();
}

/* ---------- wiring ---------- */
function rerenderTalk(){ if(S.taskOpen && $('#taskDlg') && $('#taskDlg').open) renderTask(); if(S.drawer) renderDrawer(); safeRender(); }
function talkAfterPost(){ const a = document.activeElement; if(a && a.blur) a.blur(); rerenderTalk(); }
document.addEventListener('click', ev => {
  const b = ev.target.closest('[data-talk]'); if(!b) return;
  const k = b.dataset.talk, id = b.dataset.id;
  if(b.tagName === 'A') ev.preventDefault();
  if(k === 'react') talkReact(id, b.dataset.e);
  else if(k === 'reply'){ S.talkReply = id; rerenderTalk(); setTimeout(() => { const f = document.getElementById('talkreply-' + id); if(f) f.querySelector('textarea').focus(); }, 30); return; }
  else if(k === 'reply-cancel'){ S.talkReply = null; }
  else if(k === 'decide') talkDecide(id);
  else if(k === 'make-task'){ talkMakeTask(id); rerenderTalk(); return; }
  else if(k === 'open-task'){ if(S.tasks[id]) openTask(id); return; }
  else if(k === 'jump'){ const el = document.getElementById('msg-' + id); if(el) el.scrollIntoView({block:'center', behavior:'smooth'}); return; }
  else if(k === 'edit'){ S.talkEdit = id; }
  else if(k === 'edit-cancel'){ S.talkEdit = null; }
  else if(k === 'delete'){ if(confirm('Delete this message? It can be restored from the Inbox for 30 days.')) talkDelete(id); else return; }
  else if(k === 'hist'){ loadHist(b.dataset.path, id); return; }
  else if(k === 'undo'){ talkUndo(Number(b.dataset.actid)); return; }
  else if(k === 'inbox-all'){ S.inboxAll = true; }
  else if(k === 'inbox-unread'){ S.inboxAll = false; }
  else if(k === 'inbox-read-all'){ myAlerts().filter(n => !n.read).forEach(n => put('notifs', n.id, {...n, read:true})); }
  else if(k === 'inbox-open'){ inboxOpen(id); return; }
  rerenderTalk();
});
document.addEventListener('submit', ev => {
  const f = ev.target, ta = f.querySelector && f.querySelector('textarea'); if(!ta) return;
  if(f.dataset.talknew){ ev.preventDefault(); if(postMsg(f.dataset.talknew, ta.value)){ ta.value = ''; talkAfterPost(); } }
  else if(f.dataset.talkreply){ ev.preventDefault(); const p = f.dataset.talkreply, m = S.msgs[p]; if(m && postMsg(m.on, ta.value, {parent:p})){ S.talkReply = null; talkAfterPost(); } }
  else if(f.dataset.talkedit){ ev.preventDefault(); talkEdit(f.dataset.talkedit, ta.value); S.talkEdit = null; talkAfterPost(); }
}, true);
// Enter posts, Shift+Enter adds a line.
document.addEventListener('keydown', ev => {
  if(ev.key !== 'Enter' || ev.shiftKey || ev.isComposing) return;
  const ta = ev.target; if(!ta.matches || !ta.matches('.talk-form textarea')) return;
  ev.preventDefault(); const f = ta.closest('form'); if(f.requestSubmit) f.requestSubmit(); else f.dispatchEvent(new Event('submit', {cancelable:true, bubbles:true}));
});
(function(){
  const css = `.talk{display:grid;gap:10px}.talk-thread{display:grid;gap:6px;border-bottom:1px solid var(--line);padding-bottom:8px}
.talk-msg{display:grid;gap:4px}.talk-msg.reply{margin-left:28px;padding-left:10px;border-left:2px solid var(--line)}.talk-msg.decided .talk-body{background:var(--accent-soft);border-radius:6px;padding:4px 6px}
.talk-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:13px}.talk-body{font-size:14px;line-height:1.45;overflow-wrap:anywhere}
.talk-acts{display:flex;gap:4px;flex-wrap:wrap;align-items:center}.talk-acts .btn.sm{padding:2px 8px;font-size:12px}
.talk-chip{border:1px solid var(--line);background:var(--bg);border-radius:99px;padding:1px 8px;font-size:12px;cursor:pointer;min-height:26px}.talk-chip.on{border-color:var(--navy);background:var(--accent-soft)}
.talk-form{display:flex;gap:6px;align-items:flex-end}.talk-form.reply{margin-left:28px}.talk-form textarea{flex:1;min-width:0;border:1px solid var(--line);border-radius:8px;padding:6px 8px;background:var(--bg);font:inherit;resize:vertical}
.talk-form .row{display:flex;gap:4px}.talk-decs{display:grid;gap:4px;background:var(--accent-soft);border-radius:8px;padding:8px 10px}
.inbox-row{display:flex;gap:10px;align-items:flex-start;width:100%;text-align:left;background:none;border:0;border-bottom:1px solid var(--line);padding:10px 4px;cursor:pointer;font:inherit;color:inherit}
.inbox-row:hover{background:var(--accent-soft)}.inbox-text{display:grid;gap:2px}.inbox-dot{width:8px;height:8px;border-radius:50%;margin-top:9px;flex:none;background:transparent}.inbox-row.unread .inbox-dot{background:var(--navy)}.inbox-row.unread .inbox-text>span:first-child{font-weight:600}
.undo-bar{position:fixed;left:50%;bottom:20px;transform:translate(-50%,40px);opacity:0;pointer-events:none;transition:.2s;background:#11233D;color:#fff;border-radius:10px;padding:8px 10px 8px 14px;display:flex;gap:12px;align-items:center;z-index:99;box-shadow:0 6px 24px rgba(0,0,0,.25)}
.undo-bar.on{transform:translate(-50%,0);opacity:1;pointer-events:auto}.undo-bar .btn{background:#CBA869;color:#11233D;border:0}`;
  const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
})();
