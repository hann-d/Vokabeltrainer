/*
 * filesave.js – automatische Sicherung in einen Ordner auf dem PC
 * ================================================================
 * Chrome erlaubt Webseiten (auch per file://), mit Erlaubnis des Nutzers in
 * einen Ordner zu schreiben ("File System Access API"). Der Nutzer wählt einmal
 * den Vokabeltrainer-Ordner aus; danach schreibt die App nach jeder Änderung
 * (gebündelt, alle paar Sekunden) die Datei "Lernstand.json" dorthin.
 *
 * Der gewählte Ordner wird in der IndexedDB des Browsers gemerkt. Nach einem
 * Neustart von Chrome muss die Erlaubnis evtl. mit einem Klick bestätigt werden
 * (Chrome bietet dabei auch „Bei jedem Besuch erlauben“ an).
 *
 * Status:
 *   'unsupported'      – Browser kann das nicht (dann bleibt nur die manuelle Sicherung)
 *   'none'             – noch kein Ordner gewählt
 *   'needs-permission' – Ordner bekannt, Erlaubnis muss bestätigt werden (ein Klick)
 *   'ready'            – aktiv, es wird automatisch gespeichert
 */
const FileSave = (function () {
  'use strict';

  const FILE_NAME = 'Lernstand.json';
  const DB_NAME = 'vokabeltrainer-files';
  const WRITE_DELAY = 2000;   // ms: mehrere Änderungen kurz hintereinander werden gebündelt

  let dirHandle = null;
  let status = 'none';
  let lastWrite = null;       // Date des letzten erfolgreichen Schreibens
  let lastError = null;
  let timer = null;
  const listeners = [];

  const supported = typeof window.showDirectoryPicker === 'function' && typeof indexedDB !== 'undefined';

  /* ---------- Ordner-Handle in der IndexedDB merken ---------- */
  function db() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('handles');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function storeHandle(h) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction('handles', 'readwrite');
      tx.objectStore('handles').put(h, 'dir');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }
  async function loadHandle() {
    const d = await db();
    return new Promise((resolve, reject) => {
      const req = d.transaction('handles').objectStore('handles').get('dir');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  function setStatus(s) {
    status = s;
    listeners.forEach(fn => fn());
  }

  /* ---------- Lesen und Schreiben ---------- */
  async function readFile() {
    try {
      const fh = await dirHandle.getFileHandle(FILE_NAME);
      const text = await (await fh.getFile()).text();
      return JSON.parse(text);
    } catch (e) {
      return null;   // Datei gibt es noch nicht (oder sie ist kaputt)
    }
  }

  async function writeNow() {
    clearTimeout(timer);
    timer = null;
    if (status !== 'ready') return false;
    try {
      const data = Data.exportData();
      const fh = await dirHandle.getFileHandle(FILE_NAME, { create: true });
      const w = await fh.createWritable();
      await w.write(JSON.stringify(data, null, 2));
      await w.close();
      lastWrite = new Date();
      lastError = null;
      Data.setLastBackup(lastWrite.toISOString());
      listeners.forEach(fn => fn());
      return true;
    } catch (e) {
      lastError = e.message;
      // Erlaubnis entzogen o. Ä. → Nutzer muss neu verbinden
      if (e.name === 'NotAllowedError' || e.name === 'SecurityError') setStatus('needs-permission');
      else listeners.forEach(fn => fn());
      return false;
    }
  }

  /** Nach einer Änderung aufrufen – schreibt gebündelt nach kurzer Zeit. */
  function scheduleWrite() {
    if (status !== 'ready') return;
    clearTimeout(timer);
    timer = setTimeout(writeNow, WRITE_DELAY);
  }

  /**
   * Nach dem Verbinden: Ist die Datei im Ordner neuer als der Stand im Browser,
   * wird sie geladen (z. B. nach dem Löschen der Browserdaten oder auf einem anderen PC).
   * Sonst wird der Browser-Stand in die Datei geschrieben.
   * Gibt 'loaded' oder 'written' zurück.
   */
  async function sync() {
    const file = await readFile();
    const local = Data.state;
    const fileTime = file && (file.savedAt || file.exportedAt) || '';
    const localTime = local.savedAt || '';
    const localEmpty = local.vocab.length === 0;
    if (file && file.vocab && file.vocab.length && (localEmpty || fileTime > localTime)) {
      Data.restoreBackup(file);
      lastWrite = new Date(fileTime || Date.now());
      return 'loaded';
    }
    await writeNow();
    return 'written';
  }

  /* ---------- Öffentliche Funktionen ---------- */

  /** Beim Start: gemerkten Ordner wiederfinden und Erlaubnis prüfen (ohne Klick). */
  async function init() {
    if (!supported) { setStatus('unsupported'); return null; }
    try {
      dirHandle = await loadHandle();
    } catch (e) {
      dirHandle = null;
    }
    if (!dirHandle) { setStatus('none'); return null; }
    const perm = await dirHandle.queryPermission({ mode: 'readwrite' });
    if (perm === 'granted') {
      setStatus('ready');
      return sync();
    }
    setStatus('needs-permission');
    return null;
  }

  /** Ordner auswählen (muss durch einen Klick ausgelöst werden). */
  async function connect() {
    if (!supported) return null;
    try {
      dirHandle = await window.showDirectoryPicker({ id: 'vokabeltrainer', mode: 'readwrite' });
    } catch (e) {
      return null;   // abgebrochen
    }
    await storeHandle(dirHandle);
    setStatus('ready');
    return sync();
  }

  /** Erlaubnis für den gemerkten Ordner erneut bestätigen (muss durch einen Klick ausgelöst werden). */
  async function reconnect() {
    if (!dirHandle) return connect();
    const perm = await dirHandle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') return null;
    setStatus('ready');
    return sync();
  }

  // Jede gespeicherte Änderung → gebündelt in die Datei schreiben
  Data.onSave(scheduleWrite);
  // Beim Verlassen/Verstecken der Seite sofort schreiben, damit nichts verloren geht
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && timer) writeNow();
  });

  return {
    FILE_NAME,
    get status() { return status; },
    get folderName() { return dirHandle ? dirHandle.name : ''; },
    get lastWrite() { return lastWrite; },
    get lastError() { return lastError; },
    init, connect, reconnect, writeNow,
    onChange(fn) { listeners.push(fn); },
  };
})();
