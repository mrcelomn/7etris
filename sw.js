// Network first, so a new version shows up as soon as there is a connection; the cached copy
// answers when offline, or when a weak signal hasn't answered within NETWORK_WAIT.
// Own files are fetched with 'no-cache' so they revalidate instead of trusting GitHub Pages'
// 10-minute browser cache (by URL, because a navigation Request can't be re-sent with options).
const CACHE = '7etris';
const NETWORK_WAIT = 3000;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const own = new URL(e.request.url).origin === location.origin;
  const network = (own ? fetch(e.request.url, { cache: 'no-cache' }) : fetch(e.request)).then(res => {
    if (res.ok || res.type === 'opaque') {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
    }
    return res;
  });
  network.catch(() => {}); // a failure is handled below; don't report it twice
  const slow = new Promise((_, reject) => setTimeout(reject, NETWORK_WAIT));
  // No copy saved yet: keep waiting for the network after all
  const fromCache = () => caches.match(e.request, { ignoreSearch: true }).then(hit => hit || network);
  e.respondWith(Promise.race([network, slow]).catch(fromCache));
});
