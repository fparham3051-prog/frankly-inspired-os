/* Runs the Flow Hub inside the Frankly Inspired operations app (FIOS).
   The hub was built on claude.ai, where the page reaches its database, sign-in,
   Gmail, Claude, files and live presence through window.claude.use(name).
   This file provides the same calls, backed by the operations app's own
   endpoints (hub.js on the server), so the rest of the hub runs unchanged. */
(function(){
  window.FLOWHUB_HOST = 'fios';
  const TAB = Math.random().toString(36).slice(2, 12);
  const SYNTH = ['team', 'engagements'];
  const cache = new Map();          // collection path -> Map(id -> data)
  const colL = new Map();           // collection path -> Set(listener)
  const docL = new Map();           // "path|id" -> Set(listener)
  const peerFns = new Set();
  let since = 0, me = null, started = false, busy = false, timer = null, fails = 0, pres = {}, peers = [];
  const synthSeen = {};
  let readyResolve; const ready = new Promise(r => readyResolve = r);

  const col = p => { if(!cache.has(p)) cache.set(p, new Map()); return cache.get(p); };
  const colSnap = p => { const m = col(p); return {size:m.size, empty:!m.size, docs:[...m].map(([id, d]) => ({id, exists:true, data:() => d})), metadata:{fromCache:false}}; };
  const docSnap = (p, id) => { const d = col(p).get(id); return {id, exists:d != null, data:() => d}; };
  const fire = (set, arg) => (set||[]).forEach(fn => { try{ fn(arg); }catch(e){ console.error(e); } });
  const emitCol = p => fire(colL.get(p), colSnap(p));
  const emitDoc = k => { const i = k.lastIndexOf('|'); fire(docL.get(k), docSnap(k.slice(0, i), k.slice(i+1))); };

  async function sync(){
    if(busy) return; busy = true;
    try{
      const q = new URLSearchParams({since:String(since ? Math.max(0, since - 5000) : 0), tab:TAB, pres:JSON.stringify(pres).slice(0, 1900)});
      const r = await fetch('/api/hub/sync?' + q, {credentials:'same-origin', cache:'no-store'});
      if(r.status === 401){ location.href = '/'; return; }
      if(!r.ok) throw new Error('sync ' + r.status);
      const j = await r.json(); me = j.me;
      const cc = new Set(), cd = new Set();
      for(const d of j.docs){
        if(SYNTH.includes(d.path)) continue;
        const m = col(d.path), old = m.get(d.id);
        if(d.data == null){ if(m.has(d.id)){ m.delete(d.id); cc.add(d.path); cd.add(d.path+'|'+d.id); } }
        else if(JSON.stringify(old) !== JSON.stringify(d.data)){ m.set(d.id, d.data); cc.add(d.path); cd.add(d.path+'|'+d.id); }
      }
      for(const k of SYNTH){ const s = JSON.stringify(j[k]); if(s !== synthSeen[k]){ synthSeen[k] = s; cache.set(k, new Map(j[k].map(x => [x.id, x.data]))); cc.add(k); } }
      since = Math.max(since, j.now || 0); fails = 0;
      const first = !started; started = true; readyResolve();
      if(first){ colL.forEach((_, p) => emitCol(p)); docL.forEach((_, k) => emitDoc(k)); }
      else { cc.forEach(emitCol); cd.forEach(emitDoc); }
      peers = (j.peers||[]).map(x => ({peer:x.peer, by:x.by, isMe:x.by === me.uid, sameTab:x.peer === TAB, kind:'viewer', guest:false, presence:x.presence||{}, updatedAt:x.at}));
      fire(peerFns, {peers, joined:[], left:[], updated:peers});
    }catch(e){ fails++; if(fails === 3 && typeof setStatus === 'function') setStatus('warn', 'Can’t reach the operations app. Retrying…'); }
    finally{ busy = false; schedule(); }
  }
  function schedule(ms){ clearTimeout(timer); const base = document.hidden ? 20000 : 4000; timer = setTimeout(sync, ms != null ? ms : Math.min(60000, base * Math.pow(2, Math.min(fails, 4)))); }
  document.addEventListener('visibilitychange', () => { if(!document.hidden) schedule(50); });
  window.addEventListener('focus', () => schedule(50));
  window.addEventListener('online', () => schedule(50));

  // ---------- writes: batched, applied locally at once ----------
  let pending = [], flushT = null, waiters = [];
  function write(p, id, data){
    const m = col(p);
    if(data == null) m.delete(id); else m.set(id, SYNTH.includes(p) ? Object.assign({}, m.get(id), data) : data);
    pending = pending.filter(o => !(o.path === p && o.id === id)); pending.push({path:p, id, data:data == null ? null : JSON.parse(JSON.stringify(data))});
    clearTimeout(flushT); flushT = setTimeout(flush, 120);
    return new Promise((ok, no) => waiters.push({ok, no}));
  }
  async function flush(){
    const ops = pending, ws = waiters; pending = []; waiters = [];
    if(!ops.length) return;
    try{
      const r = await fetch('/api/hub/write', {method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ops})});
      const j = await r.json().catch(() => ({}));
      if(r.status === 401){ location.href = '/'; return; }
      if(!r.ok){ const err = {code: r.status >= 500 ? 'unavailable' : 'invalid_argument', message:j.error || ('HTTP ' + r.status)}; ws.forEach(w => w.no(err)); if(r.status < 500){ ops.forEach(o => { if(SYNTH.includes(o.path)) synthSeen[o.path] = ''; else cache.set(o.path, new Map()); }); since = 0; } schedule(50); return; }
      ws.forEach(w => w.ok()); schedule(400);
    }catch(e){ ws.forEach(w => w.no({code:'unavailable', message:String(e.message||e)})); schedule(2000); }
  }

  const listen = (map, key, fn, now) => { if(!map.has(key)) map.set(key, new Set()); map.get(key).add(fn); if(started) setTimeout(now, 0); return () => map.get(key).delete(fn); };
  const colRef = p => ({ doc:id => docRef(p, id), onSnapshot:(fn) => listen(colL, p, fn, () => fn(colSnap(p))) });
  const docRef = (p, id) => ({ set:data => write(p, id, data), delete:() => write(p, id, null), collection:sub => colRef(p + '/' + id + '/' + sub), onSnapshot:(fn) => listen(docL, p + '|' + id, fn, () => fn(docSnap(p, id))) });
  const db = { collection:p => colRef(p), doc:full => { const s = String(full).split('/'); const id = s.pop(); return docRef(s.join('/'), id); } };

  const user = { id:async () => { await ready; return me.uid; }, isOwner:async () => { await ready; return !!me.owner; }, canEdit:async () => { await ready; return !!me.owner; }, role:async () => { await ready; return me.role; } };

  async function post(url, body, signal){
    let r; try{ r = await fetch(url, {method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body), signal}); }
    catch(e){ throw {code: e && e.name === 'AbortError' ? 'cancelled' : 'upstream_error', message:String(e.message||e)}; }
    const j = await r.json().catch(() => ({}));
    if(!r.ok) throw {code:j.code || (r.status === 429 ? 'rate_limited' : r.status === 409 ? 'not_granted' : 'upstream_error'), message:j.error || ('HTTP ' + r.status)};
    return j;
  }
  const asPrompt = input => typeof input === 'string' ? input : (input||[]).map(t => (t.role === 'assistant' ? 'Earlier reply: ' : '') + t.content).join('\n\n');
  const sample = async (input, opts={}) => { const j = await post('/api/hub/ai', {prompt:asPrompt(input), json:false}, opts.signal); if(opts.onText) try{ opts.onText({text:j.text, delta:j.text}); }catch(_){} return {text:j.text, truncated:false, modelTierApplied:'default'}; };
  sample.json = async (input, opts={}) => (await post('/api/hub/ai', {prompt:asPrompt(input), json:true}, opts.signal)).data;
  sample.limits = async () => ({maxPromptBytes:200000});

  const mcp = {
    callTool: async (server, tool, args) => {
      if(tool === 'send_message'){ const j = await post('/api/hub/email', {to:args.to, subject:args.subject, body:args.body}); return {payload:{id:j.id}}; }
      throw {code:'server_not_connected', message:'Not available in the operations app yet.'};
    },
    watchTool: (server, tool, args, fn) => { setTimeout(() => fn({type:'error', error:{code:'server_not_connected'}}), 0); return () => {}; }
  };

  const assets = {
    upload: async blob => {
      const r = await fetch('/api/hub/files', {method:'POST', credentials:'same-origin', headers:{'Content-Type':blob.type || 'application/octet-stream', 'X-File-Name':encodeURIComponent(blob.name || 'file')}, body:blob});
      const j = await r.json().catch(() => ({}));
      if(!r.ok) throw {code: r.status === 403 ? 'not_permitted' : r.status === 413 ? 'too_large' : 'upstream_error', message:j.error};
      return j;
    },
    delete: async id => { await fetch('/api/hub/files/' + encodeURIComponent(id), {method:'DELETE', credentials:'same-origin'}); },
    list: async () => ({assets:[], usage:{}})
  };

  const room = {
    presence: async patch => { for(const [k, v] of Object.entries(patch||{})){ if(v === null) delete pres[k]; else pres[k] = v; } },
    onPeers: fn => { peerFns.add(fn); if(started) setTimeout(() => fn({peers, joined:peers, left:[], updated:[]}), 0); return () => peerFns.delete(fn); },
    peers: () => peers, emit: async () => {}, on: () => () => {}, connected: () => true
  };

  const downloads = { save: async ({filename, data}) => {
    const blob = data instanceof Blob ? data : new Blob([data], {type: /\.csv$/i.test(filename) ? 'text/csv' : /\.json$/i.test(filename) ? 'application/json' : /\.html?$/i.test(filename) ? 'text/html' : 'text/plain'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  } };

  const impl = {db, user, sample, mcp, assets, room, downloads};
  window.claude = { use: async name => { if(!impl[name]) return null; if(!started && !busy) sync(); return impl[name]; } };
  window.FIOS_HUB = { ready, me: () => me, sync, _cache: cache };
})();
