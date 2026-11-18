/* Operations-app adjustments for the Flow Hub (only loaded in the FIOS copy). */
(function(){
  if(window.FLOWHUB_HOST !== 'fios') return;
  // Clients are the operations app's pipeline deals: open them there.
  openDrawer = function(){ try{ sessionStorage.setItem('fios_view', 'practice'); }catch(_){} location.href = '/'; };
  // People, sign-in and Gmail are managed in the operations app.
  onboardingCard = function(){ return ''; };
  connErr = function(e, server){
    const c = e && e.code;
    if(server === GCAL) return 'Google Calendar sync isn’t available in the operations app yet. Events here are shared with the team.';
    if(c === 'server_not_connected') return (e && e.message && /off/.test(e.message)) ? e.message : 'Connect Gmail in Operations → Settings → Connected email, then turn on email in Projects & Team → Workspace.';
    if(c === 'rate_limited') return 'Too many emails this hour. Try again later.';
    if(c === 'tool_error') return 'Gmail refused it: ' + String(e.message||'').slice(0, 140);
    return 'That didn’t go through. Try again.';
  };
  document.addEventListener('click', ev => {
    const b = ev.target.closest && ev.target.closest('[data-act="whoami"]'); if(!b) return;
    ev.stopPropagation(); ev.preventDefault();
    toast(`Signed in as ${S.me ? mname(S.me) : 'you'}. To switch people, log out of the operations app.`);
  }, true);
  window.FIOS_HUB.ready.then(() => {
    const me = window.FIOS_HUB.me();
    if(me && me.role === 'board'){ const n = document.createElement('div'); n.className = 'demo-banner noprint'; n.setAttribute('role', 'note'); n.innerHTML = '<span><b>View only.</b> Board accounts can see projects and progress but not change them.</span>'; document.body.prepend(n); }
  });
})();
(function(){
  if(window.FLOWHUB_HOST !== 'fios') return;
  const _setup = viewSetup;
  viewSetup = function(){
    const on = !!(S.settings && S.settings.hubEmail);
    return `<section class="panel" style="display:grid;gap:8px"><h2>Email from Projects &amp; Team</h2>
      <p class="small muted">When this is on, the hub can send email from the Gmail account connected in Operations → Settings → Connected email: alerts to teammates who ask for them, the weekday morning digest to people who opt in, the client status page, and outbox messages you send. Nothing goes out to a client unless someone clicks send.</p>
      ${S.isOwner ? `<label class="switch"><input type="checkbox" id="fios-hubEmail" data-fios="hubEmail" ${on?'checked':''}>Allow Projects &amp; Team to send email</label>` : `<p class="small">Email is ${on?'on':'off'}. Only the owner can change this.</p>`}</section>` + _setup();
  };
  document.addEventListener('change', ev => {
    if(ev.target.dataset && ev.target.dataset.fios === 'hubEmail'){ saveConfig('settings', {...(S.settings||{}), hubEmail: ev.target.checked}); toast(ev.target.checked ? 'Email is on for Projects & Team' : 'Email is off for Projects & Team'); render(); }
  });
})();
(function(){
  if(window.FLOWHUB_HOST !== 'fios') return;
  const FIX = [[/and anyone you make an Editor/g, 'and other owner accounts'], [/\(the owner and Editors\)/g, '(owner accounts)'], [/the owner and Editors/g, 'owner accounts'], [/Contributor access or higher/g, 'a staff or owner account'],
    [/Linked to a claude\.ai account/g, 'Signed in with an operations account'], [/Share the hub from its claude\.ai page as Contributor so people can update their tasks\./g, 'Add people in Operations → Settings → People.'],
    [/Uploads need Editor access to the hub\.?/g, 'Board accounts can’t upload.'], [/Ask Franklin to make you a Contributor\./g, 'Board accounts are view only.'], [/Claude is available when the hub is opened on claude\.ai/g, 'Claude isn’t set up yet: turn on AI in Operations → Settings'],
    [/when the hub is opened on claude\.ai/g, 'once AI is on in Operations → Settings'], [/Sign in to claude\.ai to check in/g, 'Sign in to the operations app to check in']];
  const fix = s => FIX.reduce((a, [re, to]) => a.replace(re, to), String(s));
  const _toast = toast; toast = m => _toast(fix(m));
  const _ar = afterRender;
  afterRender = function(){ _ar(); const root = document.getElementById('main'); if(!root) return; const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n; while((n = w.nextNode())){ if(/claude\.ai|Editor|Contributor/.test(n.nodeValue)) n.nodeValue = fix(n.nodeValue); } };
})();
