/* ---------- v14: depth ----------
   Phone notifications (Web Push), search across everything, Connections
   (API tokens, webhooks, error monitoring) and dependency lag. */

const FIOS = () => window.FLOWHUB_HOST === 'fios' && window.FIOS_HUB;
const jget = async url => { const r = await fetch(url, {credentials:'same-origin', cache:'no-store'}); const j = await r.json().catch(() => ({})); if(!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; };
const jsend = async (url, method, body) => { const r = await fetch(url, {method, credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:body ? JSON.stringify(body) : undefined}); const j = await r.json().catch(() => ({})); if(!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; };

/* ---------- phone notifications ---------- */
S.push = S.push || {state:'unknown'};
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const standalone = () => window.matchMedia && (matchMedia('(display-mode: standalone)').matches || navigator.standalone);
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
async function pushRefresh(){
  if(!FIOS() || !pushSupported()){ S.push = {state:'unsupported'}; return; }
  try{
    const reg = await navigator.serviceWorker.register('/hub/sw.js', {scope:'/hub/'});
    const sub = await reg.pushManager.getSubscription();
    S.push = {state: Notification.permission === 'denied' ? 'denied' : sub ? 'on' : 'off'};
  }catch(e){ S.push = {state:'unsupported'}; }
}
const b64key = s => { const p = '='.repeat((4 - s.length % 4) % 4), raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...raw].map(c => c.charCodeAt(0))); };
async function pushOn(){
  try{
    if(Notification.permission !== 'granted' && (await Notification.requestPermission()) !== 'granted'){ S.push = {state:'denied'}; safeRender(); return; }
    const reg = await navigator.serviceWorker.register('/hub/sw.js', {scope:'/hub/'}); await navigator.serviceWorker.ready;
    const {key} = await jget('/api/hub/push/key');
    const sub = await reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:b64key(key)});
    await jsend('/api/hub/push/subscribe', 'POST', {sub:sub.toJSON()});
    await jsend('/api/hub/push/test', 'POST', {});
    S.push = {state:'on'}; toast('Notifications are on for this device.');
  }catch(e){ toast('Could not turn on notifications: ' + (e.message || 'try again')); }
  safeRender();
}
async function pushOff(){
  try{ const reg = await navigator.serviceWorker.getRegistration('/hub/'); const sub = reg && await reg.pushManager.getSubscription(); if(sub){ await jsend('/api/hub/push/unsubscribe', 'POST', {endpoint:sub.endpoint}); await sub.unsubscribe(); } S.push = {state:'off'}; toast('Notifications are off for this device.'); }
  catch(e){ toast('Could not turn them off just now.'); }
  safeRender();
}
function pushCard(){
  if(!FIOS()) return '';
  const s = S.push.state;
  if(s === 'unknown'){ pushRefresh().then(safeRender); return ''; }
  if(s === 'unsupported') return isIOS() && !standalone() ? `<div class="panel small" style="margin-bottom:12px"><b>Get notifications on this iPhone:</b> tap Share, then Add to Home Screen, open Projects & Team from the new icon, and come back here.</div>` : '';
  if(s === 'on') return `<div class="row small" style="margin-bottom:12px;gap:8px"><span>🔔 Notifications are on for this device.</span><button class="btn sm ghost" data-dp="push-off">Turn off</button></div>`;
  if(s === 'denied') return `<div class="panel small" style="margin-bottom:12px">Notifications are blocked for this site. Allow them in the browser's site settings, then reload.</div>`;
  return `<div class="panel row" style="margin-bottom:12px;justify-content:space-between;gap:8px"><span class="small"><b>Get mentions, replies and approvals on this device</b>, even when Projects & Team is closed.${isIOS() && !standalone() ? ' On iPhone, add it to your Home Screen first.' : ''}</span><button class="btn primary sm" data-dp="push-on">Turn on notifications</button></div>`;
}
if(typeof viewInbox === 'function'){ const _vi = viewInbox; viewInbox = function(){ const h = _vi(); const i = h.indexOf('<div class="panel">'); return i < 0 ? pushCard() + h : h.slice(0, i) + pushCard() + h.slice(i); }; }

/* ---------- search everything ---------- */
if(typeof runSearch === 'function'){
  const _rs = runSearch; let seq = 0, tmr = null;
  runSearch = function(q){
    _rs(q);
    if(!FIOS()) return;
    const term = (q || '').trim(); clearTimeout(tmr);
    if(term.length < 2) return;
    const my = ++seq;
    tmr = setTimeout(async () => {
      let j; try{ j = await jget('/api/hub/search?q=' + encodeURIComponent(term)); }catch(e){ return; }
      if(my !== seq) return;
      const box = $('#gres'); if(!box || box.hidden) return;
      const shown = new Set([...box.querySelectorAll('[data-act=task]')].map(b => b.dataset.id));
      const extra = (j.items || []).filter(x => !(x.kind === 'task' && shown.has(x.id))).slice(0, 10).map(x => {
        if(x.kind === 'message'){ const tg = talkTarget(x.on); return `<button data-dp="open-on" data-on="${esc(x.on)}" data-id="${esc(x.id)}"><span class="eyebrow">Message</span> ${esc(x.title)} <span class="small muted">${esc(tg ? tg.title : '')}${x.by ? ' · ' + esc(first(x.by) || '') : ''}</span></button>`; }
        if(x.kind === 'task') return `<button data-act="task" data-id="${esc(x.id)}"><span class="eyebrow">Task</span> ${esc(x.title)} <span class="small muted">${esc(x.match || '')}</span></button>`;
        if(x.kind === 'project') return `<button data-dp="open-project" data-id="${esc(x.id)}"><span class="eyebrow">Project</span> ${esc(x.title)}</button>`;
        return `<button data-dp="open-goal" data-id="${esc(x.id)}"><span class="eyebrow">Goal</span> ${esc(x.title)}</button>`;
      });
      if(!extra.length) return;
      const empty = box.querySelector('.empty, .small.muted:only-child'); if(empty && !box.querySelector('button')) box.innerHTML = '';
      box.insertAdjacentHTML('beforeend', `<div class="eyebrow" style="padding:6px 10px 2px">Everywhere</div>` + extra.join(''));
    }, 220);
  };
}
function openOn(on, msgId){
  const tg = talkTarget(on); if(!tg) return;
  const jump = () => setTimeout(() => { const el = document.getElementById('msg-' + msgId); if(el){ el.scrollIntoView({block:'center'}); el.style.outline = '2px solid var(--accent)'; setTimeout(() => el.style.outline = '', 2000); } }, 250);
  if(tg.kind === 'task'){ openTask(tg.id); jump(); }
  else if(tg.kind === 'project'){ openProject(tg.id, 'talk'); jump(); }
  else if(tg.kind === 'with' && window.FLOWHUB_HOST === 'fios'){ location.href = '/?workspace=' + encodeURIComponent(tg.id); }
  else if(tg.kind === 'client' || tg.kind === 'with'){ openDrawer(tg.id); jump(); }
}

/* ---------- Connections: API tokens, webhooks, monitoring ---------- */
S.conn = S.conn || null;
async function connLoad(){
  S.conn = {loading:true}; safeRender();
  const c = {};
  try{ c.tokens = (await jget('/api/hub/tokens')).items; }catch(e){ c.tokens = []; }
  if(S.isOwner || S.canCoach){
    try{ const w = await jget('/api/hub/webhooks'); c.hooks = w.items; c.events = w.events; }catch(e){ c.hooks = null; }
    try{ const e = await jget('/api/hub/errors'); c.errors = e.items; c.counts = e.counts; }catch(e){ c.errors = null; }
  }
  try{ const h = await jget('/api/health'); c.health = h; }catch(e){ c.health = {ok:false}; }
  S.conn = c; safeRender();
}
function connectionsPanel(){
  if(!FIOS()) return '';
  const c = S.conn;
  const head = `<div class="spread"><h2>Connections</h2>${c && !c.loading ? '<button class="btn sm ghost" data-dp="conn-load">Refresh</button>' : ''}</div><p class="small muted" style="margin:4px 0 12px">Connect other tools to Projects & Team, and see how the system is running.</p>`;
  if(!c) return `<div class="panel" style="margin-top:16px">${head}<button class="btn" data-dp="conn-load">Show connections</button></div>`;
  if(c.loading) return `<div class="panel" style="margin-top:16px">${head}<div class="small muted">Loading…</div></div>`;
  const fresh = S.connNew ? `<div class="panel small" style="background:var(--accent-soft);margin-bottom:10px"><b>${esc(S.connNew.label)}</b> Copy it now; it won't be shown again.<div class="row" style="margin-top:6px"><code style="overflow-wrap:anywhere;flex:1">${esc(S.connNew.value)}</code><button class="btn sm" data-dp="copy" data-v="${esc(S.connNew.value)}">Copy</button></div></div>` : '';
  const api = `<h3 style="margin:8px 0 6px">API tokens</h3><p class="small muted">For Zapier, scripts or another app. Send <code>Authorization: Bearer &lt;token&gt;</code> to <code>${esc(location.origin)}/api/v1/tasks</code>, <code>/api/v1/projects</code> or <code>/api/v1/messages</code>.</p>
    ${(c.tokens || []).map(t => `<div class="row small" style="justify-content:space-between;border-bottom:1px solid var(--line);padding:5px 0"><span><b>${esc(t.name)}</b> · ${esc(mname(t.uid))} · made ${fmtWhen(t.created_at)}${t.last_used_at ? ' · last used ' + fmtWhen(t.last_used_at) : ' · not used yet'}</span><button class="btn sm ghost danger" data-dp="tok-del" data-id="${esc(t.id)}">Revoke</button></div>`).join('') || '<div class="small muted">No tokens yet.</div>'}
    <form class="row" id="tokForm" data-dpform="tok" style="margin-top:8px"><input id="tok-name" placeholder="What it's for, e.g. Zapier" style="flex:1;min-width:0;border:1px solid var(--line);border-radius:8px;padding:6px 8px;background:var(--bg)"><button class="btn sm" type="submit">Make a token</button></form>`;
  const hooks = c.hooks == null ? '' : `<h3 style="margin:18px 0 6px">Webhooks</h3><p class="small muted">Projects & Team calls these addresses when work changes. A Slack incoming-webhook address gets a readable line in the channel; anything else gets JSON signed with the secret (header <code>X-FIOS-Signature</code>).</p>
    ${c.hooks.map(h => `<div class="row small" style="justify-content:space-between;border-bottom:1px solid var(--line);padding:5px 0;gap:6px"><span style="overflow-wrap:anywhere"><b>${esc(h.url.replace(/^https:\/\//, '').slice(0, 60))}</b><br><span class="muted">${h.events && h.events.length ? esc(h.events.join(', ')) : 'every event'}${h.last_status ? ' · last ' + esc(h.last_status) + ' ' + fmtWhen(h.last_at) : ''}</span></span><span class="row" style="gap:4px"><button class="btn sm" data-dp="hook-test" data-id="${esc(h.id)}">Test</button><button class="btn sm ghost danger" data-dp="hook-del" data-id="${esc(h.id)}">Remove</button></span></div>`).join('') || '<div class="small muted">No webhooks yet.</div>'}
    <form id="hookForm" data-dpform="hook" style="display:grid;gap:6px;margin-top:8px"><input id="hook-url" type="url" placeholder="https://hooks.slack.com/services/…" style="border:1px solid var(--line);border-radius:8px;padding:6px 8px;background:var(--bg)">
      <div class="row small" style="flex-wrap:wrap;gap:8px">${(c.events || []).map(e => `<label class="switch"><input type="checkbox" name="hook-ev" value="${esc(e)}" ${['task.completed', 'decision.recorded'].includes(e) ? 'checked' : ''}>${esc(e)}</label>`).join('')}</div>
      <div><button class="btn sm" type="submit">Add webhook</button></div></form>`;
  const health = `<h3 style="margin:18px 0 6px">Health</h3><div class="small">${c.health && c.health.ok ? `✓ Running, database connected, up ${Math.round((c.health.up || 0) / 60)} min.` : '✕ The health check failed.'} Uptime checkers can use <code>${esc(location.origin)}/api/health</code>.</div>
    ${c.errors == null ? '' : `<div class="small" style="margin-top:6px">${c.counts ? `${c.counts.day} error${c.counts.day === 1 ? '' : 's'} today, ${c.counts.week} this week; ${c.counts.csp} security-policy report${c.counts.csp === 1 ? '' : 's'} this week. Five or more in an hour emails the owner.` : ''}</div>
      ${c.errors.slice(0, 12).map(e => `<div class="small" style="border-bottom:1px solid var(--line);padding:4px 0"><span class="muted">${fmtWhen(e.at)} · ${esc(e.source)}</span> ${esc(e.message)}</div>`).join('') || '<div class="small muted" style="margin-top:4px">No errors recorded.</div>'}`}`;
  return `<div class="panel" style="margin-top:16px">${head}${fresh}${api}${hooks}${health}</div>`;
}
if(typeof viewSetup === 'function'){ const _vs = viewSetup; viewSetup = function(){ return _vs() + connectionsPanel(); }; }

/* ---------- dependency lag and start-to-start ---------- */
// t.depOpts = { <taskId>: { type:'fs' | 'ss', lag:<days> } }; missing = finish-to-start, no lag.
const depOpt = (t, id) => Object.assign({type:'fs', lag:0}, (t.depOpts || {})[id] || {});
// When something slips, move what waits on it, keeping each link's type and lag.
if(typeof shiftDependents === 'function'){
  shiftDependents = function(id, seen = new Set()){
    const src = S.tasks[id]; if(!src || !src.due || seen.has(id)) return 0; seen.add(id); let n = 0;
    list('tasks').filter(t => isOpen(t) && (t.needs || []).includes(id) && t.due).forEach(t => {
      const p = t.project && S.projects[t.project]; if(p && p.autoShift === false) return; if(!p && !t.project) return;
      const o = depOpt(t, id), lag = +o.lag || 0;
      const s0 = t.start && t.start <= t.due ? t.start : t.due;
      const earliest = o.type === 'ss' ? addDays(src.start && src.start <= src.due ? src.start : src.due, lag) : addDays(src.due, lag + 1);
      if(s0 >= earliest) return;
      const slip = daysBetween(s0, earliest);
      put('tasks', t.id, {...t, start:t.start ? addDays(t.start, slip) : '', due:addDays(t.due, slip), history:hist(t, st(t), `Moved ${slip} day${slip === 1 ? '' : 's'} later because “${src.title}” slipped`)});
      if(t.owner && t.owner !== S.me) notify(t.owner, `“${t.title}” moved to ${fmtDate(addDays(t.due, slip))} because “${src.title}” slipped`, {task:t.id});
      n += 1 + shiftDependents(t.id, seen);
    });
    return n;
  };
}
// The critical path counts lag days and start-to-start overlap.
if(typeof criticalPath === 'function'){
  criticalPath = function(ts){
    const by = Object.fromEntries(ts.map(t => [t.id, t])), memo = {};
    const dur = t => Math.max(1, t.start && t.due ? daysBetween(t.start, t.due) + 1 : 1);
    const ef = (t, seen = new Set()) => {
      if(memo[t.id]) return memo[t.id]; if(seen.has(t.id)) return {v:dur(t), prev:null}; seen.add(t.id);
      let best = {v:0, prev:null};
      (t.needs || []).map(i => by[i]).filter(Boolean).forEach(d => { const o = depOpt(t, d.id), r = ef(d, seen); const v = (o.type === 'ss' ? r.v - dur(d) : r.v) + (+o.lag || 0); if(v > best.v) best = {v, prev:d.id}; });
      return (memo[t.id] = {v:best.v + dur(t), prev:best.prev});
    };
    let end = null, mx = 0; ts.forEach(t => { const r = ef(t); if(r.v > mx){ mx = r.v; end = t.id; } });
    const path = new Set(); let cur = end; while(cur){ path.add(cur); cur = memo[cur] && memo[cur].prev; }
    return ts.some(t => (t.needs || []).length) ? path : new Set();
  };
}
function depCtl(t, d){
  const o = depOpt(t, d.id);
  return `<span class="row small" style="gap:4px"><select aria-label="How it waits" data-dp-dep="type" data-id="${esc(t.id)}" data-dep="${esc(d.id)}" style="border:1px solid var(--line);border-radius:6px;padding:2px 4px;background:var(--bg)"><option value="fs" ${o.type === 'fs' ? 'selected' : ''}>after it finishes</option><option value="ss" ${o.type === 'ss' ? 'selected' : ''}>once it starts</option></select>
    <label class="row" style="gap:2px">+<input type="number" min="0" max="90" aria-label="Days of lag" data-dp-dep="lag" data-id="${esc(t.id)}" data-dep="${esc(d.id)}" value="${+o.lag || 0}" style="width:48px;border:1px solid var(--line);border-radius:6px;padding:2px 4px;background:var(--bg)">d</label></span>`;
}

/* ---------- wiring ---------- */
document.addEventListener('click', async ev => {
  const b = ev.target.closest('[data-dp]'); if(!b) return;
  const k = b.dataset.dp, id = b.dataset.id;
  if(k === 'push-on') return pushOn();
  if(k === 'push-off') return pushOff();
  if(k === 'open-on'){ $('#gres').hidden = true; return openOn(b.dataset.on, id); }
  if(k === 'open-project'){ $('#gres').hidden = true; return openProject(id, 'list'); }
  if(k === 'open-goal'){ $('#gres').hidden = true; location.hash = 'goals'; return; }
  if(k === 'conn-load'){ S.connNew = null; return connLoad(); }
  if(k === 'copy'){ try{ await navigator.clipboard.writeText(b.dataset.v); toast('Copied.'); }catch(e){ toast('Select it and copy.'); } return; }
  try{
    if(k === 'tok-del'){ if(!confirm('Revoke this token? Anything using it stops working.')) return; await jsend('/api/hub/tokens/' + encodeURIComponent(id), 'DELETE'); }
    if(k === 'hook-del'){ if(!confirm('Remove this webhook?')) return; await jsend('/api/hub/webhooks/' + encodeURIComponent(id), 'DELETE'); }
    if(k === 'hook-test'){ const j = await jsend('/api/hub/webhooks/' + encodeURIComponent(id) + '/test', 'POST', {}); toast('Test sent: ' + j.status); }
    connLoad();
  }catch(e){ toast(e.message); }
});
document.addEventListener('submit', async ev => {
  const f = ev.target; if(!f.dataset || !f.dataset.dpform) return; ev.preventDefault();
  try{
    if(f.dataset.dpform === 'tok'){ const j = await jsend('/api/hub/tokens', 'POST', {name:$('#tok-name').value.trim() || 'API token'}); S.connNew = {label:'Your new token.', value:j.token}; }
    if(f.dataset.dpform === 'hook'){ const url = $('#hook-url').value.trim(); const events = [...f.querySelectorAll('input[name=hook-ev]:checked')].map(x => x.value); const j = await jsend('/api/hub/webhooks', 'POST', {url, events}); S.connNew = /hooks\.slack\.com/.test(url) ? null : {label:'Signing secret for this webhook.', value:j.secret}; toast('Webhook added. Press Test to try it.'); }
    const keep = S.connNew; await connLoad(); S.connNew = keep; safeRender();
  }catch(e){ toast(e.message); }
}, true);
document.addEventListener('change', ev => {
  const el = ev.target; if(!el.dataset || !el.dataset.dpDep) return;
  const t = S.tasks[el.dataset.id]; if(!t) return;
  const opts = {...(t.depOpts || {})}, cur = depOpt(t, el.dataset.dep);
  if(el.dataset.dpDep === 'type') cur.type = el.value === 'ss' ? 'ss' : 'fs'; else cur.lag = Math.max(0, Math.min(90, Math.round(+el.value || 0)));
  opts[el.dataset.dep] = cur; put('tasks', t.id, {...t, depOpts:opts});
  if(typeof afterDates === 'function') afterDates(el.dataset.dep);
  renderTask(); safeRender();
});
