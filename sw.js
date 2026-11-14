// Service worker del Cançoner de Taverna: fa que la web funcioni sense connexió.
//
// - En instal·lar-se, desa al mòbil tots els fitxers de l'aplicació i les llibreries
//   externes (tipografies, Tailwind, icones).
// - Les pàgines escanejades del mode Facsímil es desen a mesura que es veuen
//   (no canvien mai, i així no cal baixar els 9 MB de cop).
// - Els fitxers propis es demanen primer a la xarxa (així sempre tens l'última versió)
//   i, si no hi ha connexió o tarda massa, es fan servir els desats.
// - Les llibreries externes es fan servir des del mòbil i s'actualitzen en segon pla.
//
// Si afegeixes un fitxer nou a l'aplicació, posa'l a APP_FILES i canvia VERSION.

const VERSION = '2026-11-14f';
const APP_CACHE = 'canconer-app-' + VERSION;
const EXT_CACHE = 'canconer-externs-v1';
const FAC_CACHE = 'canconer-facsimil-v1';
const NETWORK_TIMEOUT_MS = 3000;

const APP_FILES = [
  './',
  'index.html',
  'css/app.css',
  'css/tailwind.css',
  'js/canconer-data.js',
  'js/app.js',
  'js/taula.js',
  'js/autoscroll.js',
  'js/vendor/qrcode.js',
  'js/vendor/jsQR.js',
  'img/portada-coberta.jpg',
  'img/acords.jpg',
  'img/icona-192.png',
  'img/icona-512.png',
  'img/icona-apple-180.png',
  'img/favicon-32.png',
  'manifest.webmanifest',
];

// mode: com les demana la pàgina ('cors' si l'etiqueta porta crossorigin; 'no-cors' si no)
const EXTERNAL_FILES = [
  { url: 'https://cdn.tailwindcss.com', mode: 'no-cors' },
  { url: 'https://unpkg.com/lucide@latest', mode: 'cors' },
];
const FONTS_CSS = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,600;0,700;1,400;1,600;1,700&family=EB+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700&family=Source+Sans+3:ital,wght@0,400;0,500;0,600;1,400;1,600&display=swap';

async function cacheExternals() {
  const cache = await caches.open(EXT_CACHE);
  await Promise.all(EXTERNAL_FILES.map(async ({ url, mode }) => {
    try {
      const res = await fetch(url, { mode, credentials: 'omit' });
      if (res.ok || res.type === 'opaque') await cache.put(url, res);
    } catch (e) { /* sense xarxa: ja es desarà en el pròxim ús */ }
  }));
  // Tipografies: es desa el CSS de Google Fonts i també els fitxers de lletra que enllaça
  try {
    const res = await fetch(FONTS_CSS, { mode: 'cors', credentials: 'omit' });
    if (res.ok) {
      const css = await res.clone().text();
      await cache.put(FONTS_CSS, res);
      const fontUrls = [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map(m => m[1]);
      await Promise.all(fontUrls.map(async u => {
        try { const f = await fetch(u, { mode: 'cors', credentials: 'omit' }); if (f.ok) await cache.put(u, f); } catch (e) {}
      }));
    }
  } catch (e) {}
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    await cache.addAll(APP_FILES.map(f => new Request(f, { cache: 'reload' })));
    await cacheExternals();
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.startsWith('canconer-app-') && n !== APP_CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

// Fitxers propis: primer xarxa (amb temps límit), si no, el desat.
async function networkFirst(request) {
  const cache = await caches.open(APP_CACHE);
  const fromNetwork = fetch(request).then(res => {
    if (res.ok) cache.put(request, res.clone());
    return res;
  });
  fromNetwork.catch(() => {});   // si falla més tard, ja hem respost amb el desat
  const timeout = new Promise(resolve => setTimeout(resolve, NETWORK_TIMEOUT_MS, null));
  try {
    const res = await Promise.race([fromNetwork, timeout]);
    if (res) return res;
  } catch (e) { /* sense xarxa */ }
  const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' })
    || (request.mode === 'navigate' ? await cache.match('index.html') : null);
  if (cached) return cached;
  return fromNetwork;   // no hi ha res desat: esperam la xarxa
}

// Pàgines escanejades: si ja estan desades, d'allà; si no, de la xarxa i es desen.
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

// Llibreries externes: primer el desat i s'actualitza en segon pla.
async function staleWhileRevalidate(event) {
  const cache = await caches.open(EXT_CACHE);
  const cached = await cache.match(event.request);
  const update = fetch(event.request).then(res => {
    if (res.ok || res.type === 'opaque') cache.put(event.request, res.clone());
    return res;
  }).catch(() => null);
  if (cached) { event.waitUntil(update); return cached; }
  const res = await update;
  return res || Response.error();
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.endsWith('.pdf')) return;    // el PDF no es desa
    if (url.pathname.includes('/img/facsimil/')) { event.respondWith(cacheFirst(req, FAC_CACHE)); return; }
    event.respondWith(networkFirst(req));
  } else if (/^(fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.tailwindcss\.com|unpkg\.com|cdnjs\.cloudflare\.com)$/.test(url.hostname)) {
    event.respondWith(staleWhileRevalidate(event));
  }
});
