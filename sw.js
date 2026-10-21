// FUCustomer offline cache: hashed assets cache-first, the page itself network-first.
const CACHE = 'fucustomer-v1';
// The game code is split: the menu loads first and the 3D game (three.js) on demand. Precache every chunk the entry
// script can load (its import map lists them) so solo play works offline even if no game was started online.
async function precacheChunks(c) {
  const html = await (await fetch('./index.html', { cache: 'no-cache' })).text();
  const entry = [...html.matchAll(/(?:src|href)="\.\/(assets\/[\w.-]+\.(?:js|css))"/g)].map(m => m[1]);
  const lazy = [];
  for (const u of entry.filter(u => /\/index-[\w-]+\.js$/.test(u))) {
    const js = await (await fetch('./' + u)).text();
    for (const m of js.matchAll(/"\.\/([\w.-]+\.(?:js|css))"/g)) lazy.push('assets/' + m[1]);
  }
  // both UI font files (menu + game, unicode-range split; URLs carry a content hash ?v=…)
  const fonts = [...html.matchAll(/url\(["']?\.?\/?(fonts\/[\w.-]+\.woff2(?:\?v=\w+)?)["']?\)/g)].map(m => m[1]);
  const all = [...new Set([...entry, ...lazy, ...fonts])].map(u => './' + u);
  const have = await Promise.all(all.map(u => c.match(u)));
  await c.addAll(all.filter((_, i) => !have[i]));
}
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await c.addAll(['./', './index.html', './manifest.webmanifest', './icon.svg']).catch(() => {});
    await precacheChunks(c).catch(() => { /* best effort: chunks are also cached as they load */ });
  }));
  self.skipWaiting();
});
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.endsWith('/ws') || url.pathname.endsWith('/health')) return;
  // UI font files: cache-first by their ?v= content hash; a rebuilt font replaces the older copy of the same file
  if (url.pathname.includes('/fonts/') && url.searchParams.has('v')) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(async c => {
          for (const k of await c.keys()) { const ku = new URL(k.url); if (ku.pathname === url.pathname && ku.search !== url.search) await c.delete(k); }
          await c.put(e.request, copy);
        });
      }
      return res;
    })));
    return;
  }
  if (url.pathname.includes('/assets/')) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res; })));
    return;
  }
  e.respondWith(fetch(e.request).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res; }).catch(() => caches.match(e.request).then(hit => hit || caches.match('./index.html'))));
});
