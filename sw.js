/* Service worker: true offline support for the deployed site.
 *
 * Two caches, keyed on the versions index.html registers us with
 * (sw.js?app=N&data=M — a changed query string is what triggers the update):
 *   - the APP cache (index.html, css, js, vendor) is small and cheap to refill
 *     on every APP_VERSION bump;
 *   - the DATA cache (~17 MB of compiled data/*.js) survives app releases and
 *     is only refilled when DATA_VERSION changes.
 * Precached URLs carry the exact ?v= query the page requests, so cache.match
 * hits without any ignoreSearch tricks.
 */
'use strict';

const params = new URLSearchParams(self.location.search);
const APP_V = params.get('app') || '0';
const DATA_V = params.get('data') || '0';
const APP_CACHE = 'pf1e-app-v' + APP_V;
const DATA_CACHE = 'pf1e-data-v' + DATA_V;

const DATA_FILES = [
  'data/skills.js', 'data/races.js', 'data/racialtraits.js', 'data/classes.js',
  'data/archetypes.js', 'data/classabilities.js', 'data/mythicabilities.js',
  'data/mythicpaths.js', 'data/mythicspells.js', 'data/feats.js', 'data/spells.js',
  'data/weapons.js', 'data/armors.js', 'data/items.js', 'data/traits.js',
  'data/companions.js', 'data/buffs.js', 'data/bundles.js',
].map(f => f + '?v=' + DATA_V);

const APP_FILES = [
  './',
  'manifest.webmanifest',
  'icon.svg',
  'icon-maskable.svg',
  'css/styles.css?v=' + APP_V,
  'vendor/jspdf.umd.min.js?v=' + APP_V,
  'js/engine.js?v=' + APP_V, 'js/library.js?v=' + APP_V, 'js/custom.js?v=' + APP_V,
  'js/pdf.js?v=' + APP_V, 'js/sheet.js?v=' + APP_V, 'js/generator.js?v=' + APP_V,
  'js/app.js?v=' + APP_V,
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const app = await caches.open(APP_CACHE);
    await app.addAll(APP_FILES);
    const data = await caches.open(DATA_CACHE);
    // only fetch data files not already in the (possibly reused) data cache
    for (const url of DATA_FILES) {
      if (!(await data.match(url))) await data.add(url);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== APP_CACHE && key !== DATA_CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  // navigations: network first (so a deploy shows up on next visit), cached
  // shell as the offline fallback
  if (e.request.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(e.request);
        const app = await caches.open(APP_CACHE);
        app.put('./', fresh.clone());
        return fresh;
      } catch (err) {
        return (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }

  // everything else: cache first (both caches), network fallback that
  // back-fills the right cache
  e.respondWith((async () => {
    const hit = await caches.match(e.request);
    if (hit) return hit;
    const resp = await fetch(e.request);
    if (resp.ok) {
      const cache = await caches.open(url.pathname.includes('/data/') ? DATA_CACHE : APP_CACHE);
      cache.put(e.request, resp.clone());
    }
    return resp;
  })());
});
