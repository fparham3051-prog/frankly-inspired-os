/* Projects & Team service worker: shows phone and desktop notifications
   (Web Push) and opens the right page when one is tapped. It does not cache
   pages, so the app is always the current version. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', e => {
  let d = {}; try{ d = e.data ? e.data.json() : {}; }catch(_){ d = {body: e.data ? e.data.text() : ''}; }
  e.waitUntil(self.registration.showNotification(d.title || 'Frankly Inspired', {
    body: d.body || 'Something needs you in Projects & Team.', tag: d.tag || undefined,
    icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: {url: d.url || '/hub/#inbox'}
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/hub/#inbox', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(ws => {
    for(const w of ws){ if(w.url.startsWith(self.location.origin + '/hub/')){ return w.navigate(url).then(x => (x || w).focus()).catch(() => w.focus()); } }
    return self.clients.openWindow(url);
  }));
});
