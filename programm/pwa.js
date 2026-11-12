/*
 * pwa.js – alles rund um die installierte App
 * ============================================
 * 1. Offline-Teil (sw.js) anmelden – nur wenn die App aus dem Internet kommt
 *    (z. B. GitHub Pages). Beim Öffnen per Doppelklick (file://) geht das nicht,
 *    dann passiert hier einfach nichts.
 * 2. Gibt es eine neue Version, erscheint unten ein Hinweis „Neue Version
 *    verfügbar – jetzt laden“.
 * 3. Den Browser bitten, den Lernstand dauerhaft zu behalten (und ihn nicht
 *    bei Speichermangel zu löschen).
 */
(function () {
  'use strict';

  /* ---------- 3. Dauerhafter Speicher ---------- */
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persisted().then(already => { if (!already) navigator.storage.persist(); });
  }

  /* ---------- 1. + 2. Offline-Teil und Updates ---------- */
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;

  let reloading = false;
  // Sobald die neue Version übernommen ist, die Seite einmal neu laden
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });

  function showUpdateBar(worker) {
    if (document.getElementById('update-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'update-bar';
    bar.className = 'update-bar';
    const text = document.createElement('span');
    text.textContent = 'Neue Version des Vokabeltrainers verfügbar.';
    const btn = document.createElement('button');
    btn.className = 'primary small';
    btn.textContent = 'Jetzt laden';
    btn.addEventListener('click', () => {
      // Eine laufende Runde vorher merken, damit sie danach fortgesetzt werden kann
      if (typeof Quiz !== 'undefined' && document.getElementById('view-quiz').classList.contains('active')) Quiz.pause();
      worker.postMessage('skipWaiting');
    });
    const later = document.createElement('button');
    later.className = 'link small';
    later.textContent = 'Später';
    later.addEventListener('click', () => bar.remove());
    bar.append(text, btn, later);
    document.body.appendChild(bar);
  }

  navigator.serviceWorker.register('sw.js').then(reg => {
    // Liegt schon eine neue Version bereit (z. B. vom letzten Besuch)?
    if (reg.waiting && navigator.serviceWorker.controller) showUpdateBar(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', () => {
        // „installed“ + schon eine alte Version aktiv = Update (beim allerersten Mal kein Hinweis)
        if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdateBar(w);
      });
    });
    // Bei länger offener App ab und zu nach Updates schauen
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch(() => { /* ohne Offline-Teil geht die App trotzdem */ });
})();
