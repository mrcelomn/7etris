// Network first, so a new version shows up as soon as there is a connection;
// the cached copy only answers when offline. Own files are fetched with 'no-cache' so they
// revalidate instead of trusting GitHub Pages' 10-minute browser cache (by URL, because a
// navigation Request can't be re-sent with options).
const CACHE = '7etris';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const own = new URL(e.request.url).origin === location.origin;
  e.respondWith(
    (own ? fetch(e.request.url, { cache: 'no-cache' }) : fetch(e.request))
      .then(res => {
        if (res.ok || res.type === 'opaque') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
