/*
 * sw.js – „Service Worker“: macht den Vokabeltrainer offline nutzbar.
 * =====================================================================
 * Beim ersten Öffnen werden alle Programmdateien im Browser zwischengespeichert.
 * Danach startet die App auch ohne Internet (aus dem Zwischenspeicher).
 *
 * WICHTIG BEI JEDEM UPDATE: Die Nummer in VERSION erhöhen. Nur dann merkt der
 * Browser, dass es eine neue Version gibt, und die App zeigt „Neue Version
 * verfügbar – jetzt laden“.
 *
 * Der Lernstand selbst liegt NICHT hier, sondern im Speicher des Browsers
 * (localStorage) – er bleibt bei Updates erhalten.
 */
const VERSION = 'v2';
const CACHE = 'vokabeltrainer-' + VERSION;

const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './programm/style.css',
  './programm/compare.js',
  './programm/data.js',
  './programm/filesave.js',
  './programm/quiz.js',
  './programm/app.js',
  './programm/pwa.js',
  './programm/icons/icon.svg',
  './programm/icons/icon-32.png',
  './programm/icons/icon-180.png',
  './programm/icons/icon-192.png',
  './programm/icons/icon-512.png',
  './programm/icons/icon-maskable-512.png',
];

// Neue Version: alle Dateien holen (am Server vorbei, damit nichts Altes hängen bleibt)
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))));
  // Nicht sofort aktiv werden – erst wenn der Nutzer „jetzt laden“ klickt (siehe pwa.js)
});

// Die App sagt Bescheid, wenn die neue Version übernommen werden soll
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

// Alte Zwischenspeicher aufräumen
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('vokabeltrainer-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()));
});

// Anfragen: zuerst aus dem Zwischenspeicher, sonst aus dem Internet
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).catch(() =>
      // Offline und nicht im Speicher: bei Seitenaufrufen die App zeigen
      req.mode === 'navigate' ? caches.match('./index.html') : Response.error())));
});
