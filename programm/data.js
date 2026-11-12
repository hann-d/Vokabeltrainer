/*
 * data.js – Datenmodell, Speicherung, Sicherung, Fächer und Lernpläne
 * ====================================================================
 * Alle Daten liegen in einem einzigen Objekt `state`, das nach jeder Änderung
 * als JSON im localStorage des Browsers gespeichert wird. Zusätzlich wird
 * (über filesave.js) automatisch eine Kopie in den Programmordner geschrieben.
 *
 * Aufbau von state:
 *   {
 *     version: 1,
 *     tests:   [ { id, name } ],            // oberste Ebene: ein Test / eine Arbeit
 *     groups:  [ { id, name, testId } ],    // Gruppe = z. B. eine Buchseite; testId = null → ohne Test
 *     vocab:   [ { id, de, en, groupId,
 *                  type,         // 'vocab' | 'synonym' | 'antonym' | 'sentence'
 *                                //   bei synonym/antonym: de = Wort 1, en = Wort 2 (beide englisch)
 *                  seen,         // true, sobald der Eintrag einmal abgefragt wurde (sonst: erst einprägen)
 *                  stage,        // Fach: null = neu, sonst 1..7 (nur Typ 'vocab')
 *                  due,          // 'JJJJ-MM-TT' – wann wieder fällig (null bei neuen Wörtern)
 *                  lastGraded,   // 'JJJJ-MM-TT' – Tag der letzten gewerteten Antwort (Langzeit)
 *                  right, wrong, // wie oft richtig / falsch (erste Antwort pro Runde)
 *                  streak,       // wie oft zuletzt hintereinander richtig
 *                  lastPracticed,// 'JJJJ-MM-TT' – zuletzt geübt
 *                  marked        // true = steht auf der Merkliste
 *              } ],
 *     plans:   [ { id, name, date, ids: [vocabId], direction, learned: {id: true},
 *                  wrongIds: [vocabId], lastDone } ],   // Lernpläne zur Arbeit
 *     settings: { newPerDay: 20, blockSize: 5, theme: 'auto' },
 *     daily:    { date, newIntroduced, extra },
 *     savedAt:    ISO-Zeitstempel der letzten Änderung
 *     lastBackup: ISO-Zeitstempel der letzten Sicherung (Datei) oder null
 *   }
 *
 * Unterbrochene Runden (zum Fortsetzen) liegen getrennt davon in einem eigenen
 * Speicherplatz des Browsers – siehe „Unterbrochene Runden“ weiter unten.
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'vokabeltrainer.v1';

  /** Eintragstypen mit Anzeigenamen. */
  const TYPES = {
    vocab: 'Vokabel',
    synonym: 'Synonym',
    antonym: 'Gegenteil',
    sentence: 'Satz',
  };

  /** Typ aus CSV-Text erkennen ('' → Vokabel). Gibt null zurück, wenn unbekannt. */
  function parseType(text) {
    const t = String(text || '').trim().toLowerCase();
    if (t === '' || t === 'vokabel' || t === 'vokabeln' || t === 'wort') return 'vocab';
    if (t === 'synonym' || t === 'synonyme') return 'synonym';
    if (t === 'gegenteil' || t === 'gegenteile' || t === 'antonym') return 'antonym';
    if (t === 'satz' || t === 'sätze' || t === 'saetze') return 'sentence';
    return null;
  }

  /** Abstand in Tagen bis zur nächsten Abfrage, Index = Fach. */
  const INTERVALS = [0, 1, 2, 4, 7, 14, 30, 90];
  const MAX_STAGE = 7;

  /** Ab so vielen Fehlern ist ein Wort ein Problemwort (bis es 3-mal hintereinander richtig war). */
  const PROBLEM_WRONG = 3;
  const PROBLEM_CLEAR_STREAK = 3;

  /* ------------------------------------------------------------------
   * Datumshilfen (immer lokales Datum als 'JJJJ-MM-TT')
   * ------------------------------------------------------------------ */
  function dateStr(d) {
    const pad = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function today() { return dateStr(new Date()); }
  function addDays(str, n) {
    const [y, m, d] = str.split('-').map(Number);
    return dateStr(new Date(y, m - 1, d + n));
  }
  /** Ganze Tage von a bis b (beides 'JJJJ-MM-TT'). */
  function daysBetween(a, b) {
    const pa = a.split('-').map(Number), pb = b.split('-').map(Number);
    const ta = Date.UTC(pa[0], pa[1] - 1, pa[2]), tb = Date.UTC(pb[0], pb[1] - 1, pb[2]);
    return Math.round((tb - ta) / 86400000);
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* ------------------------------------------------------------------
   * Laden und Speichern
   * ------------------------------------------------------------------ */
  function defaultState() {
    return {
      version: 1,
      tests: [],
      groups: [],
      vocab: [],
      plans: [],
      settings: { newPerDay: 20, blockSize: 5, theme: 'auto' },
      daily: { date: today(), newIntroduced: 0, extra: 0 },
      savedAt: null,
      lastBackup: null,
    };
  }

  let state = defaultState();
  const saveListeners = [];

  /** Ältere Datenstände auf das aktuelle Format bringen. */
  function migrate(s) {
    s.settings = Object.assign({ newPerDay: 20, blockSize: 5, theme: 'auto' }, s.settings);
    if (!Array.isArray(s.plans)) s.plans = [];
    if (!Array.isArray(s.tests)) s.tests = [];
    const testIds = new Set(s.tests.map(t => t.id));
    for (const g of s.groups) {
      if (!g.testId || !testIds.has(g.testId)) g.testId = null;   // ältere Stände: Gruppen ohne Test
    }
    for (const v of s.vocab) {
      if (!v.type) v.type = 'vocab';
      if (v.seen == null) v.seen = v.stage != null;
      if (v.right == null) v.right = 0;
      if (v.wrong == null) v.wrong = 0;
      if (v.streak == null) v.streak = 0;
      if (v.lastPracticed === undefined) v.lastPracticed = v.lastGraded || null;
      if (v.marked == null) v.marked = false;
    }
    return s;
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) state = migrate(Object.assign(defaultState(), JSON.parse(raw)));
    } catch (e) {
      alert('Die gespeicherten Daten konnten nicht gelesen werden: ' + e.message);
    }
    return state;
  }

  /** Speichert im Browser und meldet die Änderung (für das automatische Speichern in den Ordner). */
  function save() {
    state.savedAt = new Date().toISOString();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      alert('Speichern fehlgeschlagen: ' + e.message);
    }
    saveListeners.forEach(fn => fn());
  }
  function onSave(fn) { saveListeners.push(fn); }

  /* ------------------------------------------------------------------
   * Tests (oberste Ebene) und Gruppen (z. B. Buchseiten)
   * ------------------------------------------------------------------
   * Ein Test enthält mehrere Gruppen. Eine Gruppe gehört zu höchstens einem
   * Test (testId) oder zu keinem (testId = null, „ohne Test“).
   * Gruppennamen müssen nur innerhalb eines Tests eindeutig sein – so kann es
   * „Bild 1“ in mehreren Tests geben.
   */
  const byName = (a, b) => a.name.localeCompare(b.name, 'de', { numeric: true, sensitivity: 'base' });

  function testById(id) { return state.tests.find(t => t.id === id) || null; }
  function testByName(name) {
    const n = name.trim();
    return state.tests.find(t => t.name === n) || null;
  }
  function sortedTests() { return state.tests.slice().sort(byName); }

  /** Legt einen Test an; gibt es den Namen schon, wird der vorhandene zurückgegeben. */
  function addTest(name) {
    const n = name.trim();
    if (!n) throw new Error('Der Name des Tests darf nicht leer sein.');
    let t = testByName(n);
    if (!t) {
      t = { id: uid(), name: n };
      state.tests.push(t);
      save();
    }
    return t;
  }

  function renameTest(id, newName) {
    const n = newName.trim();
    if (!n) throw new Error('Der Name des Tests darf nicht leer sein.');
    const other = testByName(n);
    if (other && other.id !== id) throw new Error('Einen Test mit diesem Namen gibt es schon.');
    testById(id).name = n;
    save();
  }

  /** Test auflösen: Der Test verschwindet, seine Gruppen bleiben erhalten (ohne Test). */
  function dissolveTest(id) {
    const t = testById(id);
    if (!t) return;
    for (const g of state.groups) {
      if (g.testId !== id) continue;
      // Gibt es ohne Test schon eine Gruppe mit diesem Namen, den Testnamen anhängen
      if (state.groups.some(o => o !== g && !o.testId && o.name === g.name)) g.name += ' (' + t.name + ')';
      g.testId = null;
    }
    state.tests = state.tests.filter(x => x.id !== id);
    save();
  }

  /** Test samt allen seinen Gruppen und Einträgen löschen. */
  function deleteTest(id) {
    const groupIds = new Set(state.groups.filter(g => g.testId === id).map(g => g.id));
    const removed = new Set(state.vocab.filter(v => groupIds.has(v.groupId)).map(v => v.id));
    state.groups = state.groups.filter(g => !groupIds.has(g.id));
    state.vocab = state.vocab.filter(v => !groupIds.has(v.groupId));
    state.tests = state.tests.filter(t => t.id !== id);
    cleanPlans(removed);
    save();
  }

  function groupById(id) { return state.groups.find(g => g.id === id) || null; }

  /** Gruppe mit diesem Namen innerhalb eines Tests (testId leer → Gruppen ohne Test). */
  function groupByName(name, testId) {
    const n = name.trim(), t = testId || null;
    return state.groups.find(g => g.name === n && (g.testId || null) === t) || null;
  }

  /** Gruppen eines Tests (testId leer → Gruppen ohne Test), nach Name sortiert. */
  function groupsInTest(testId) {
    const t = testId || null;
    return state.groups.filter(g => (g.testId || null) === t).sort(byName);
  }

  /**
   * Alles als Baum: [ { test: {id, name} | null, groups: [...] } ]
   * Tests nach Name sortiert; Gruppen ohne Test stehen als letzter Eintrag (test: null).
   */
  function groupTree() {
    const tree = sortedTests().map(t => ({ test: t, groups: groupsInTest(t.id) }));
    const loose = groupsInTest(null);
    if (loose.length) tree.push({ test: null, groups: loose });
    return tree;
  }

  /** Alle Gruppen in der Reihenfolge des Baums (Test für Test). */
  function sortedGroups() {
    return groupTree().reduce((all, node) => all.concat(node.groups), []);
  }

  /** Anzeigename einer Gruppe, auf Wunsch mit dem Test davor: „Test 1 › Seite 142“. */
  function groupLabel(g, withTest) {
    if (!g) return '';
    const t = withTest && g.testId ? testById(g.testId) : null;
    return (t ? t.name + ' › ' : '') + g.name;
  }

  /** Legt eine Gruppe an (im Test testId oder ohne Test); gibt es sie dort schon, wird sie zurückgegeben. */
  function addGroup(name, testId) {
    const n = name.trim();
    if (!n) throw new Error('Der Gruppenname darf nicht leer sein.');
    let g = groupByName(n, testId);
    if (!g) {
      g = { id: uid(), name: n, testId: testId || null };
      state.groups.push(g);
      save();
    }
    return g;
  }

  function renameGroup(id, newName) {
    const n = newName.trim();
    if (!n) throw new Error('Der Gruppenname darf nicht leer sein.');
    const g = groupById(id);
    const other = groupByName(n, g.testId);
    if (other && other.id !== id) throw new Error('Eine Gruppe mit diesem Namen gibt es dort schon.');
    g.name = n;
    save();
  }

  /** Gruppe in einen anderen Test einsortieren (testId leer → ohne Test). */
  function setGroupTest(groupId, testId) {
    const g = groupById(groupId);
    const t = testId || null;
    if (!g || (g.testId || null) === t) return;
    if (groupByName(g.name, t)) throw new Error('Dort gibt es schon eine Gruppe mit dem Namen „' + g.name + '“.');
    g.testId = t;
    save();
  }

  /** Löscht die Gruppe UND alle ihre Vokabeln. */
  function deleteGroup(id) {
    const removed = new Set(state.vocab.filter(v => v.groupId === id).map(v => v.id));
    state.groups = state.groups.filter(g => g.id !== id);
    state.vocab = state.vocab.filter(v => v.groupId !== id);
    cleanPlans(removed);
    save();
  }

  function vocabInGroup(id) { return state.vocab.filter(v => v.groupId === id); }

  /** Alle Einträge eines Tests (aus allen seinen Gruppen). */
  function vocabInTest(testId) {
    const ids = new Set(groupsInTest(testId).map(g => g.id));
    return state.vocab.filter(v => ids.has(v.groupId));
  }

  /* ------------------------------------------------------------------
   * Vokabeln
   * ------------------------------------------------------------------ */
  function vocabById(id) { return state.vocab.find(v => v.id === id) || null; }

  /** Gibt es schon einen Eintrag mit gleichem Typ, Deutsch + Englisch? */
  function findDuplicate(de, en, excludeId, type) {
    const d = de.trim(), e = en.trim(), t = type || 'vocab';
    return state.vocab.find(v => v.id !== excludeId && v.type === t && v.de === d && v.en === e) || null;
  }

  function addVocab(de, en, groupId, autoSave, type) {
    const v = {
      id: uid(), de: de.trim(), en: en.trim(), groupId: groupId, type: type || 'vocab',
      seen: false, stage: null, due: null, lastGraded: null,
      right: 0, wrong: 0, streak: 0, lastPracticed: null, marked: false,
    };
    state.vocab.push(v);
    if (autoSave !== false) save();
    return v;
  }

  function updateVocab(id, fields) {
    const v = vocabById(id);
    if (!v) return;
    if (fields.de != null) v.de = fields.de.trim();
    if (fields.en != null) v.en = fields.en.trim();
    if (fields.groupId != null) v.groupId = fields.groupId;
    if (fields.type != null && fields.type !== v.type) {
      v.type = fields.type;
      if (v.type !== 'vocab') { v.stage = null; v.due = null; } // Fächer gibt es nur für Vokabeln
    }
    save();
  }

  /** Löscht mehrere Einträge auf einmal. */
  function deleteVocabs(ids) {
    const set = new Set(ids);
    state.vocab = state.vocab.filter(v => !set.has(v.id));
    cleanPlans(set);
    save();
  }
  function deleteVocab(id) { deleteVocabs([id]); }

  /* ------------------------------------------------------------------
   * Merkliste: Einträge, die man sich in der Abfrage markiert hat
   * ------------------------------------------------------------------ */
  function setMarked(ids, on) {
    for (const id of ids) {
      const v = vocabById(id);
      if (v) v.marked = !!on;
    }
    save();
  }
  function markedVocab() { return state.vocab.filter(v => v.marked); }

  /* ------------------------------------------------------------------
   * Fächer (Langzeit)
   * ------------------------------------------------------------------ */
  // Langzeit-Lernen gilt nur für Einträge vom Typ 'vocab'
  function isNew(v) { return v.type === 'vocab' && v.stage == null; }
  function isDue(v, day) {
    return v.type === 'vocab' && v.stage != null && v.due != null && v.due <= (day || today());
  }

  function dueVocab() { const t = today(); return state.vocab.filter(v => isDue(v, t)); }
  function newVocab() { return state.vocab.filter(isNew); }

  /** Anzahl Vokabeln pro Fach: { new: n, 1: n, …, 7: n } */
  function stageCounts() {
    const c = { new: 0 };
    for (let i = 1; i <= MAX_STAGE; i++) c[i] = 0;
    for (const v of state.vocab) if (v.type === 'vocab') c[v.stage == null ? 'new' : v.stage]++;
    return c;
  }

  /** Fach von Hand setzen (null = wieder neu). Die nächste Abfrage richtet sich nach dem Fach. */
  function setStage(ids, stage) {
    const t = today();
    for (const id of ids) {
      const v = vocabById(id);
      if (!v || v.type !== 'vocab') continue;
      if (stage == null) {
        v.stage = null; v.due = null;
      } else {
        v.stage = Math.max(1, Math.min(MAX_STAGE, stage));
        v.due = addDays(t, INTERVALS[v.stage]);
        v.seen = true;
      }
    }
    save();
  }

  /** Einträge sofort fällig machen (nur Vokabeln mit Fach). */
  function makeDue(ids) {
    const t = today();
    for (const id of ids) {
      const v = vocabById(id);
      if (v && v.type === 'vocab' && v.stage != null) v.due = t;
    }
    save();
  }

  /** Richtig/Falsch-Zähler zurücksetzen. */
  function resetCounters(ids) {
    for (const id of ids) {
      const v = vocabById(id);
      if (v) { v.right = 0; v.wrong = 0; v.streak = 0; }
    }
    save();
  }

  /** Tageszähler holen (wird an einem neuen Tag zurückgesetzt). */
  function daily() {
    const t = today();
    if (!state.daily || state.daily.date !== t) state.daily = { date: t, newIntroduced: 0, extra: 0 };
    if (state.daily.extra == null) state.daily.extra = 0;
    return state.daily;
  }

  /** Wie viele neue Wörter heute im Langzeit-Modus noch drankommen dürfen. */
  function newAvailableCount() {
    const d = daily();
    const left = Math.max(0, (state.settings.newPerDay | 0) + d.extra - d.newIntroduced);
    return Math.min(left, newVocab().length);
  }

  /** „Heute mehr lernen“: zusätzliches Kontingent neuer Wörter nur für heute. */
  function addExtraToday(n) {
    daily().extra += Math.max(0, n | 0);
    save();
  }

  /** Eintrag wurde zum ersten Mal abgefragt → muss nicht mehr eingeprägt werden. */
  function markSeen(v) {
    if (!v.seen) { v.seen = true; save(); }
  }

  /** Richtig/Falsch-Zähler nach der ersten Antwort pro Runde. */
  function recordAnswer(v, correct) {
    if (correct) { v.right++; v.streak++; } else { v.wrong++; v.streak = 0; }
    v.lastPracticed = today();
    save();
  }

  /** Problemwort: oft falsch und seitdem noch nicht 3-mal hintereinander richtig. */
  function isProblem(v) {
    return v.wrong >= PROBLEM_WRONG && v.streak < PROBLEM_CLEAR_STREAK;
  }
  function problemVocab() { return state.vocab.filter(isProblem); }

  /** Wendet eine gewertete Antwort auf das Fach an. */
  function applyResult(v, correct) {
    const t = today();
    if (correct) {
      v.stage = v.stage == null ? 1 : Math.min(MAX_STAGE, v.stage + 1);
      v.due = addDays(t, INTERVALS[v.stage]);
    } else {
      v.stage = v.stage == null ? 1 : Math.max(1, v.stage - 2);
      v.due = addDays(t, 1);
    }
    v.lastGraded = t;
  }

  /** Langzeit-Modus: nur die erste Antwort pro Wort und Tag zählt. Gibt true zurück, wenn gewertet wurde. */
  function gradeLongTerm(v, correct) {
    const t = today();
    if (v.type !== 'vocab' || v.lastGraded === t) return false;
    if (isNew(v)) daily().newIntroduced++;
    applyResult(v, correct);
    save();
    return true;
  }

  /**
   * Arbeit-lernen-Modus (erste Antwort pro Wort in der Runde):
   * falsch → 2 Fächer zurück, fällig morgen; richtig → nur hoch, wenn heute ohnehin fällig.
   */
  function gradeTest(v, correct) {
    if (v.type !== 'vocab') return false;      // Synonyme, Gegenteile, Sätze haben keine Fächer
    if (!correct) applyResult(v, false);
    else if (isDue(v)) applyResult(v, true);
    else return false;
    save();
    return true;
  }

  /** Schnappschuss des Lernstands (für „Gelten lassen“, um eine Wertung rückgängig zu machen). */
  function snapshot(v) {
    return {
      stage: v.stage, due: v.due, lastGraded: v.lastGraded,
      right: v.right, wrong: v.wrong, streak: v.streak, lastPracticed: v.lastPracticed,
      daily: Object.assign({}, daily()),
    };
  }
  function restore(v, snap) {
    v.stage = snap.stage; v.due = snap.due; v.lastGraded = snap.lastGraded;
    v.right = snap.right; v.wrong = snap.wrong; v.streak = snap.streak; v.lastPracticed = snap.lastPracticed;
    state.daily = snap.daily;
    save();
  }

  function stageLabel(v) {
    if (v.type !== 'vocab') return '–';
    if (v.stage == null) return 'neu';
    return 'Fach ' + v.stage + (v.stage === MAX_STAGE ? ' (gelernt)' : '');
  }

  /* ------------------------------------------------------------------
   * Lernpläne zur Arbeit
   * ------------------------------------------------------------------
   * Die Wörter werden gleichmäßig auf die Tage bis zum Tag VOR der Arbeit
   * verteilt. Jeden Tag: neue Portion + Wörter, die beim letzten Mal falsch waren.
   * Am letzten Tag vor der Arbeit (und am Tag der Arbeit): Generalprobe mit allen Wörtern.
   * Verpasste Tage werden automatisch auf die restlichen Tage verteilt.
   */
  function addPlan(name, date, ids, direction) {
    const p = {
      id: uid(), name: name.trim() || 'Arbeit', date: date, ids: ids.slice(),
      direction: direction || 'de-en', learned: {}, wrongIds: [], lastDone: null, created: today(),
    };
    state.plans.push(p);
    save();
    return p;
  }
  function deletePlan(id) {
    state.plans = state.plans.filter(p => p.id !== id);
    save();
  }
  function planById(id) { return state.plans.find(p => p.id === id) || null; }
  function cleanPlans(removedIds) {
    for (const p of state.plans) {
      p.ids = p.ids.filter(id => !removedIds.has(id));
      p.wrongIds = p.wrongIds.filter(id => !removedIds.has(id));
    }
  }

  /**
   * Was steht heute im Lernplan an?
   * Ergebnis: { daysLeft, finalReview, fresh: [vocab], review: [vocab], all: [vocab],
   *             learnedCount, total, doneToday, over }
   */
  function planToday(p) {
    const t = today();
    const vocab = p.ids.map(vocabById).filter(Boolean);
    const daysLeft = daysBetween(t, p.date);           // 0 = heute ist die Arbeit
    const notLearned = vocab.filter(v => !p.learned[v.id]);
    const wrong = new Set(p.wrongIds);
    const info = {
      daysLeft: daysLeft, total: vocab.length,
      learnedCount: vocab.length - notLearned.length,
      doneToday: p.lastDone === t, over: daysLeft < 0,
      finalReview: daysLeft <= 1, fresh: [], review: [],
    };
    if (info.over) return info;
    if (info.finalReview) {
      info.fresh = notLearned;
      info.review = vocab.filter(v => p.learned[v.id]);   // Generalprobe: alles
    } else {
      const learnDays = daysLeft - 1;                     // der letzte Tag ist für die Generalprobe
      const perDay = Math.ceil(notLearned.length / learnDays);
      info.fresh = notLearned.slice(0, perDay);
      info.review = vocab.filter(v => p.learned[v.id] && wrong.has(v.id));
    }
    return info;
  }

  /** Ergebnis einer Lernplan-Antwort (erste Antwort pro Runde) merken. */
  function recordPlanAnswer(p, vocabId, correct) {
    p.learned[vocabId] = true;
    p.wrongIds = p.wrongIds.filter(id => id !== vocabId);
    if (!correct) p.wrongIds.push(vocabId);
    save();
  }
  function markPlanDone(p) {
    p.lastDone = today();
    save();
  }

  /* ------------------------------------------------------------------
   * Unterbrochene Runden
   * ------------------------------------------------------------------
   * Der Stand einer laufenden Abfrage wird nach jedem Schritt hier abgelegt,
   * damit man sie nach dem Verlassen (oder Schließen des Browsers) fortsetzen
   * kann. Eigener Speicherplatz im Browser, nicht Teil der Sicherung.
   * Aufbau: { slot: Rundenstand } – slot z. B. 'longterm', 'test', 'plan:<id>'.
   */
  const SESSION_KEY = 'vokabeltrainer.sessions';

  function loadSessions() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || {}; } catch (e) { return {}; }
  }
  function storeSessions(all) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(all)); } catch (e) { /* nicht schlimm */ }
  }
  function saveSession(slot, data) {
    const all = loadSessions();
    all[slot] = data;
    storeSessions(all);
  }
  function clearSession(slot) {
    const all = loadSessions();
    if (slot in all) { delete all[slot]; storeSessions(all); }
  }

  /* ------------------------------------------------------------------
   * Sicherung (Export / Import als JSON-Datei)
   * ------------------------------------------------------------------ */
  function exportData() {
    return Object.assign({ app: 'Vokabeltrainer', exportedAt: new Date().toISOString() }, state);
  }

  function downloadBackup() {
    const data = exportData();
    state.lastBackup = data.exportedAt;
    save();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'vokabeltrainer-sicherung-' + today() + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /** Prüft eine geladene Sicherung. Wirft einen Fehler mit verständlicher Meldung. */
  function validateBackup(obj) {
    if (!obj || typeof obj !== 'object') throw new Error('Die Datei enthält keine gültigen Daten.');
    if (!Array.isArray(obj.groups) || !Array.isArray(obj.vocab)) {
      throw new Error('Die Datei ist keine Sicherung des Vokabeltrainers.');
    }
    const ids = new Set(obj.groups.map(g => g.id));
    for (const v of obj.vocab) {
      if (typeof v.de !== 'string' || typeof v.en !== 'string' || !ids.has(v.groupId)) {
        throw new Error('Die Sicherung ist beschädigt (Vokabel ohne gültige Gruppe).');
      }
    }
  }

  /** Ersetzt den kompletten Stand durch die Sicherung. */
  function restoreBackup(obj) {
    validateBackup(obj);
    const s = defaultState();
    s.groups = obj.groups;
    s.vocab = obj.vocab;
    if (Array.isArray(obj.tests)) s.tests = obj.tests;
    if (Array.isArray(obj.plans)) s.plans = obj.plans;
    if (obj.settings) s.settings = Object.assign(s.settings, obj.settings);
    if (obj.daily) s.daily = obj.daily;
    s.lastBackup = obj.exportedAt || obj.lastBackup || null;
    state = migrate(s);
    save();
  }

  /** Tage seit der letzten Sicherung, oder null wenn es noch keine gab. */
  function daysSinceBackup() {
    if (!state.lastBackup) return null;
    return daysBetween(dateStr(new Date(state.lastBackup)), today());
  }

  /** Wird von filesave.js nach einem erfolgreichen Schreiben aufgerufen (ohne neues save-Ereignis). */
  function setLastBackup(iso) {
    state.lastBackup = iso;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* egal */ }
  }

  global.Data = {
    INTERVALS, MAX_STAGE, TYPES, parseType, PROBLEM_WRONG, PROBLEM_CLEAR_STREAK,
    get state() { return state; },
    today, addDays, daysBetween,
    load, save, onSave,
    testById, testByName, sortedTests, addTest, renameTest, dissolveTest, deleteTest,
    groupById, groupByName, groupsInTest, groupTree, sortedGroups, groupLabel,
    addGroup, renameGroup, setGroupTest, deleteGroup, vocabInGroup, vocabInTest,
    vocabById, findDuplicate, addVocab, updateVocab, deleteVocab, deleteVocabs,
    setMarked, markedVocab, loadSessions, saveSession, clearSession,
    isNew, isDue, dueVocab, newVocab, newAvailableCount, addExtraToday, markSeen,
    stageCounts, setStage, makeDue, resetCounters, recordAnswer, isProblem, problemVocab,
    gradeLongTerm, gradeTest, snapshot, restore, stageLabel,
    addPlan, deletePlan, planById, planToday, recordPlanAnswer, markPlanDone,
    exportData, downloadBackup, validateBackup, restoreBackup, daysSinceBackup, setLastBackup,
  };
})(window);
