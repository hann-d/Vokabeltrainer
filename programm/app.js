/*
 * app.js – Oberfläche: Navigation, Startseite, Runden starten und fortsetzen,
 *          Import, Verwalter (Tests, Gruppen, Einträge), Lernplan,
 *          Hell/Dunkel und automatisches Speichern.
 * Die eigentliche Abfrage steckt in quiz.js, die Daten in data.js.
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  /** Kleiner Helfer zum Erzeugen von Elementen: el('td', {className: 'x'}, 'Text', kindElement) */
  function el(tag, props, ...children) {
    const e = document.createElement(tag);
    if (props) {
      for (const k in props) {
        if (k.startsWith('on')) e.addEventListener(k.slice(2), props[k]);
        else e[k] = props[k];
      }
    }
    for (const c of children) {
      if (c == null || c === false) continue;
      e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return e;
  }

  function setMessage(elem, text, ok) {
    elem.textContent = text;
    elem.className = 'message ' + (ok ? 'ok' : 'err');
  }

  /** Deutsches Datum aus 'JJJJ-MM-TT' */
  function formatDate(str) {
    if (!str) return '–';
    const [y, m, d] = str.split('-');
    return d + '.' + m + '.' + y;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  const shorten = (text, max) => (text.length > max ? text.slice(0, max - 1) + '…' : text);
  const TYPE_PLURAL = { vocab: 'Vokabeln', synonym: 'Synonyme', antonym: 'Gegenteile', sentence: 'Sätze' };

  /** Auswahlliste mit allen Eintragstypen */
  function typeOptions(select, selected, withAll) {
    select.innerHTML = '';
    if (withAll) select.appendChild(el('option', { value: '', textContent: 'Alle Typen' }));
    for (const key in Data.TYPES) {
      select.appendChild(el('option', { value: key, textContent: Data.TYPES[key], selected: key === selected }));
    }
  }

  /** Auswahlliste mit allen Gruppen, nach Tests gegliedert. */
  function groupOptions(select, selectedId, placeholder) {
    select.innerHTML = '';
    if (placeholder) select.appendChild(el('option', { value: '', textContent: placeholder }));
    const tree = Data.groupTree();
    const hasTests = tree.some(n => n.test);
    for (const node of tree) {
      if (!node.groups.length) continue;
      const parent = hasTests ? el('optgroup', { label: node.test ? node.test.name : 'Ohne Test' }) : select;
      for (const g of node.groups) {
        parent.appendChild(el('option', { value: g.id, textContent: g.name, selected: g.id === selectedId }));
      }
      if (parent !== select) select.appendChild(parent);
    }
  }

  /**
   * Gruppen zum Ankreuzen, nach Tests gegliedert. Das Häkchen am Test wählt alle seine Gruppen.
   * selected = Set mit Gruppen-IDs; onChange wird nach jeder Änderung aufgerufen.
   */
  function renderGroupChecklist(box, selected, onChange) {
    box.innerHTML = '';
    const tree = Data.groupTree().filter(n => n.groups.length);
    const hasTests = tree.some(n => n.test);
    if (!tree.length) box.appendChild(el('p', { className: 'muted' }, 'Noch keine Gruppen vorhanden.'));

    for (const node of tree) {
      const counts = new Map(node.groups.map(g => [g.id, Data.vocabInGroup(g.id).length]));
      if (hasTests) {
        const ids = node.groups.filter(g => counts.get(g.id) > 0).map(g => g.id);
        const chosen = ids.filter(id => selected.has(id)).length;
        const total = ids.reduce((n, id) => n + counts.get(id), 0);
        const cb = el('input', {
          type: 'checkbox', disabled: !ids.length,
          checked: ids.length > 0 && chosen === ids.length,
          indeterminate: chosen > 0 && chosen < ids.length,
          onchange: () => { ids.forEach(id => (cb.checked ? selected.add(id) : selected.delete(id))); onChange(); },
        });
        box.appendChild(el('label', { className: 'check-test' }, cb, ' ' + (node.test ? node.test.name : 'Ohne Test') + ' ',
          el('span', { className: 'muted' }, '(' + total + ')')));
      }
      const list = el('div', { className: 'checklist' + (hasTests ? ' indented' : '') });
      for (const g of node.groups) {
        const n = counts.get(g.id);
        const cb = el('input', {
          type: 'checkbox', checked: selected.has(g.id), disabled: n === 0,
          onchange: () => { cb.checked ? selected.add(g.id) : selected.delete(g.id); onChange(); },
        });
        list.appendChild(el('label', null, cb, ' ' + g.name + ' ', el('span', { className: 'muted' }, '(' + n + ')')));
      }
      box.appendChild(list);
    }
  }

  /** Kurzer Name für eine Auswahl von Gruppen: der Test, wenn alle dazugehören, sonst die Gruppennamen. */
  function groupsSummary(groups) {
    if (!groups.length) return '';
    const names = groups.map(g => g.name).join(', ');
    const sameTest = groups.every(g => g.testId && g.testId === groups[0].testId);
    if (!sameTest) return names;
    const t = Data.testById(groups[0].testId);
    return Data.groupsInTest(t.id).length === groups.length ? t.name : t.name + ' (' + names + ')';
  }

  /* ================================================================
   * Navigation zwischen den Ansichten
   * ================================================================ */
  let currentView = null;
  const renderers = {};

  function show(name) {
    // Beim Verlassen der Abfrage wird die Runde gemerkt – man kann sie später fortsetzen
    if (currentView === 'quiz' && name !== 'quiz' && name !== 'done') Quiz.pause();

    currentView = name;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    $('view-' + name).classList.add('active');
    document.querySelectorAll('#mainnav button').forEach(b =>
      b.classList.toggle('active', b.dataset.nav === name));
    document.body.dataset.view = name;   // fürs CSS: der Verwalter darf z. B. breiter sein
    if (renderers[name]) renderers[name]();
    window.scrollTo(0, 0);
  }

  document.addEventListener('click', e => {
    const nav = e.target.closest('[data-nav]');
    if (nav) show(nav.dataset.nav);
  });

  /* ================================================================
   * Runden starten, unterbrechen und fortsetzen
   * ================================================================
   * Jede Art von Runde hat einen eigenen Speicherplatz („slot“):
   *   'longterm'   Langzeit lernen        (nur am selben Tag fortsetzbar)
   *   'test'       Arbeit lernen
   *   'plan:<id>'  Lernplan               (nur am selben Tag fortsetzbar)
   *   'selection'  Auswahl aus dem Verwalter
   *   'problems'   Problemwörter
   *   'marked'     Merkliste
   * Eine neue Runde derselben Art ersetzt die unterbrochene.
   */

  /** Rückmeldungen einer Runde (auch nach dem Fortsetzen): Lernplan-Fortschritt und Abschluss. */
  function roundHooks(planId) {
    const p = planId ? Data.planById(planId) : null;
    return {
      onAnswer: p ? (v, correct) => Data.recordPlanAnswer(p, v.id, correct) : null,
      onFinish: result => {
        if (p) Data.markPlanDone(p);
        showDone(result);
      },
    };
  }

  /** Neue Runde starten. opts = { slot, title, mode, items, planId } */
  function startRound(opts) {
    if (!opts.items.length) return;
    show('quiz');
    Quiz.start(Object.assign({ blockSize: Data.state.settings.blockSize }, opts, roundHooks(opts.planId)));
  }

  /** Unterbrochene Runden, die man noch fortsetzen kann (veraltete werden entfernt). */
  function pausedRounds() {
    const all = Data.loadSessions();
    const today = Data.today();
    const list = [];
    for (const slot in all) {
      const d = all[slot];
      const sameDayOnly = d.mode === 'longterm' || !!d.planId;
      const planGone = d.planId && !Data.planById(d.planId);
      const alive = Array.isArray(d.items) && d.items.some(it => Data.vocabById(it.vocabId));
      if (!alive || planGone || (sameDayOnly && d.day !== today)) {
        Data.clearSession(slot);
        continue;
      }
      list.push(d);
    }
    return list.sort((a, b) => b.savedAt - a.savedAt);
  }
  function pausedRound(slot) {
    return pausedRounds().find(d => d.slot === slot) || null;
  }
  /** „7 von 15 erledigt“ – eine gerade richtig beantwortete Frage zählt schon mit. */
  function pausedProgress(d) {
    return (d.done + (d.phase === 'correct' ? 1 : 0)) + ' von ' + d.total + ' erledigt';
  }

  function resumeRound(slot) {
    const d = pausedRound(slot);
    if (!d) {
      if (renderers[currentView]) renderers[currentView]();
      return;
    }
    show('quiz');
    Quiz.resume(d, roundHooks(d.planId));
  }

  /** „heute 14:32“ / „gestern“ / Datum */
  function whenText(timestamp) {
    const d = new Date(timestamp);
    const pad = n => String(n).padStart(2, '0');
    const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(timestamp).setHours(0, 0, 0, 0)) / 86400000);
    if (days === 0) return 'heute ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (days === 1) return 'gestern';
    return 'am ' + d.toLocaleDateString('de-DE');
  }

  /** Kasten „Unterbrochene Runden“ oben auf der Startseite. */
  function renderPaused() {
    const box = $('home-paused');
    const list = pausedRounds();
    box.hidden = !list.length;
    box.innerHTML = '';
    if (!list.length) return;
    box.appendChild(el('h2', null, list.length === 1 ? 'Unterbrochene Runde' : 'Unterbrochene Runden'));
    for (const d of list) {
      box.appendChild(el('div', { className: 'paused-row' },
        el('span', null,
          el('strong', null, d.title),
          el('span', { className: 'muted' }, ' · ' + pausedProgress(d) + ' · unterbrochen ' + whenText(d.savedAt))),
        el('span', { className: 'button-row' },
          el('button', { className: 'primary', textContent: 'Fortsetzen', onclick: () => resumeRound(d.slot) }),
          el('button', { textContent: 'Verwerfen', onclick: () => { Data.clearSession(d.slot); renderers.home(); } }))));
    }
  }

  function showDone(result) {
    $('done-text').textContent = 'Einträge: ' + result.words + ' · Fehler: ' + result.errors;
    show('done');
  }

  /* ================================================================
   * Startseite
   * ================================================================ */
  renderers.home = function () {
    renderPaused();

    // Langzeit lernen
    const due = Data.dueVocab().length;
    const fresh = Data.newAvailableCount();
    const allNew = Data.newVocab().length;
    $('home-stats').textContent =
      'Heute fällig: ' + plural(due, 'Wort', 'Wörter') + ' · Neu verfügbar: ' + fresh;

    const pausedLong = pausedRound('longterm');
    $('btn-longterm').textContent = pausedLong ? 'Fortsetzen' : 'Starten';
    $('btn-longterm').disabled = !pausedLong && due + fresh === 0;
    let note = '';
    if (!Data.state.vocab.length) note = 'Noch keine Vokabeln – zuerst importieren.';
    else if (due + fresh === 0) note = 'Für heute ist alles erledigt.';
    if (allNew > fresh) note += (note ? ' ' : '') + plural(allNew - fresh, 'weiteres neues Wort wartet', 'weitere neue Wörter warten') + '.';
    $('longterm-note').textContent = note;
    $('btn-more').disabled = allNew <= fresh;

    // Arbeit lernen
    const total = Data.state.vocab.length;
    const nTests = Data.state.tests.length;
    $('home-total').textContent = plural(total, 'Eintrag', 'Einträge') + ' in ' +
      plural(Data.state.groups.length, 'Gruppe', 'Gruppen') + (nTests ? ' (' + plural(nTests, 'Test', 'Tests') + ')' : '');
    $('btn-test').disabled = total === 0;

    // Lernpläne (nur die, deren Arbeit noch nicht vorbei ist)
    const plansBox = $('home-plans');
    plansBox.innerHTML = '';
    const active = Data.state.plans.filter(p => !Data.planToday(p).over)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!active.length) plansBox.appendChild(el('p', { className: 'muted' }, 'Kein Lernplan. Lege einen an, wenn eine Arbeit ansteht.'));
    active.forEach(p => plansBox.appendChild(planCard(p, false)));

    // Problemwörter
    const problems = Data.problemVocab().length;
    $('home-problems').textContent = problems ? plural(problems, 'Problemwort', 'Problemwörter') : 'Keine – sehr gut!';
    $('btn-problems-practice').disabled = problems === 0;
    $('btn-problems-show').disabled = problems === 0;

    // Merkliste
    const marked = Data.markedVocab().length;
    $('home-marked').textContent = marked ? plural(marked, 'Eintrag', 'Einträge') : 'Noch nichts gemerkt.';
    $('btn-marked-practice').disabled = marked === 0;
    $('btn-marked-show').disabled = marked === 0;

    renderBoxChart();
    renderAutosave();

    $('set-newperday').value = Data.state.settings.newPerDay;
    $('set-blocksize').value = Data.state.settings.blockSize;
  };

  /** Karteikasten: ein Balken pro Fach, Klick zeigt die Wörter darin im Verwalter. */
  function renderBoxChart() {
    const box = $('home-box');
    box.innerHTML = '';
    const counts = Data.stageCounts();
    const keys = ['new', 1, 2, 3, 4, 5, 6, 7];
    const max = Math.max(1, ...keys.map(k => counts[k]));
    const due = Data.dueVocab();
    for (const k of keys) {
      const n = counts[k];
      const dueHere = k === 'new' ? 0 : due.filter(v => v.stage === k).length;
      box.appendChild(el('button', {
        className: 'box-col' + (k === 'new' ? ' new' : '') + (k === 7 ? ' done' : ''),
        title: n + ' Vokabeln' + (dueHere ? ', davon ' + dueHere + ' heute fällig' : ''),
        disabled: n === 0,
        onclick: () => openManage({ stage: String(k) }),
      },
        el('span', { className: 'box-count' }, n),
        el('span', { className: 'box-bar-wrap' },
          el('span', { className: 'box-bar', style: 'height:' + Math.max(n ? 4 : 0, Math.round(100 * n / max)) + '%' })),
        el('span', { className: 'box-label' }, k === 'new' ? 'Neu' : 'Fach ' + k),
        el('span', { className: 'box-sub' }, k === 'new' ? '' : k === 7 ? 'gelernt' : Data.INTERVALS[k] + (Data.INTERVALS[k] === 1 ? ' Tag' : ' Tage'))));
    }
  }

  $('btn-problems-practice').addEventListener('click', () => startRound({
    slot: 'problems', title: 'Problemwörter üben', mode: 'test',
    items: buildTestItems(Data.problemVocab(), 'de-en'),
  }));
  $('btn-problems-show').addEventListener('click', () => openManage({ problems: true }));

  $('btn-marked-practice').addEventListener('click', () => startRound({
    slot: 'marked', title: 'Merkliste üben', mode: 'test',
    items: buildTestItems(Data.markedVocab(), 'de-en'),
  }));
  $('btn-marked-show').addEventListener('click', () => openManage({ marked: true }));

  function numberSetting(id, key, min, max) {
    $(id).addEventListener('change', e => {
      const n = Math.max(min, Math.min(max, parseInt(e.target.value, 10) || min));
      Data.state.settings[key] = n;
      Data.save();
      e.target.value = n;
      if (currentView === 'home') renderers.home();
    });
  }
  numberSetting('set-newperday', 'newPerDay', 0, 500);
  numberSetting('set-blocksize', 'blockSize', 1, 100);
  numberSetting('test-blocksize', 'blockSize', 1, 100);

  $('btn-more').addEventListener('click', () => {
    const n = Math.max(1, Math.min(200, parseInt($('more-count').value, 10) || 0));
    Data.addExtraToday(n);
    renderers.home();
  });

  /* ---------- Langzeit lernen starten (oder die unterbrochene Runde fortsetzen) ---------- */
  $('btn-longterm').addEventListener('click', () => {
    if (pausedRound('longterm')) return resumeRound('longterm');
    const due = shuffle(Data.dueVocab());
    const fresh = Data.newVocab().slice(0, Data.newAvailableCount()); // neue in Import-Reihenfolge
    const items = due.concat(fresh).map(v => ({
      vocab: v, prompt: v.de, answer: v.en, label: 'Deutsch → Englisch', sentence: false, lang: 'en',
    }));
    startRound({ slot: 'longterm', title: 'Langzeit lernen', mode: 'longterm', items: items });
  });

  /* ---------- Sicherung von Hand (Download / Datei laden) ---------- */
  $('btn-backup-save').addEventListener('click', () => {
    Data.downloadBackup();
    renderers.home();
  });

  $('btn-backup-load').addEventListener('click', () => $('backup-file').click());
  $('backup-file').addEventListener('change', e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(reader.result);
        Data.validateBackup(obj);
        const msg = 'Sicherung laden?\n\nDie Sicherung enthält ' + obj.vocab.length + ' Einträge in ' +
          obj.groups.length + ' Gruppen.\n\nACHTUNG: Der aktuelle Stand (' + Data.state.vocab.length +
          ' Einträge) wird dabei komplett überschrieben!';
        if (!confirm(msg)) return;
        Data.restoreBackup(obj);
        alert('Sicherung wurde geladen.');
        applyTheme();
        renderers.home();
      } catch (err) {
        alert('Die Sicherung konnte nicht geladen werden:\n' + err.message);
      }
    };
    reader.readAsText(file, 'UTF-8');
  });

  /* ================================================================
   * Arbeit lernen – Auswahl von Tests/Gruppen, Typen und Richtung
   * ================================================================ */
  const testGroups = new Set();
  const testTypes = new Set(['vocab']);

  renderers.testsetup = function () {
    // Hinweis auf eine unterbrochene Runde
    const paused = pausedRound('test');
    const hint = $('test-paused');
    hint.hidden = !paused;
    hint.innerHTML = '';
    if (paused) {
      hint.appendChild(el('span', null, 'Du hast noch eine unterbrochene Runde (' + pausedProgress(paused) +
        '). Eine neue Runde ersetzt sie.'));
      hint.appendChild(el('button', { className: 'small primary', textContent: 'Fortsetzen', onclick: () => resumeRound('test') }));
    }

    // Tests und Gruppen
    for (const id of Array.from(testGroups)) if (!Data.groupById(id)) testGroups.delete(id);
    renderGroupChecklist($('test-groups'), testGroups, renderers.testsetup);

    // Typen (Anzahl bezogen auf die gewählten Gruppen)
    const tbox = $('test-types');
    tbox.innerHTML = '';
    const inGroups = Data.state.vocab.filter(v => testGroups.has(v.groupId));
    for (const key in Data.TYPES) {
      const n = inGroups.filter(v => v.type === key).length;
      const cb = el('input', {
        type: 'checkbox', checked: testTypes.has(key),
        onchange: () => { cb.checked ? testTypes.add(key) : testTypes.delete(key); activePart = null; renderTestEntries(); },
      });
      tbox.appendChild(el('label', null, cb, ' ' + TYPE_PLURAL[key] + ' ', el('span', { className: 'muted' }, '(' + n + ')')));
    }

    $('test-blocksize').value = Data.state.settings.blockSize;
    renderTestEntries();
  };

  /* ---------- Einzelne Einträge auswählen / in Teile aufteilen ---------- */
  const testExcluded = new Set();   // IDs, bei denen das Häkchen entfernt wurde
  let activePart = null;            // Nummer des zuletzt gewählten Teils (nur zur Anzeige)

  /** Alle Einträge der gewählten Gruppen und Typen, Gruppe für Gruppe, sonst in Import-Reihenfolge. */
  function listedEntries() {
    const result = [];
    for (const g of Data.sortedGroups()) {
      if (!testGroups.has(g.id)) continue;
      for (const v of Data.vocabInGroup(g.id)) if (testTypes.has(v.type)) result.push(v);
    }
    return result;
  }

  function renderTestEntries() {
    const box = $('test-entries');
    box.innerHTML = '';
    const list = listedEntries();
    if (!list.length) {
      box.appendChild(el('div', { className: 'empty' }, 'Wähle oben mindestens eine Gruppe und einen Typ aus.'));
    }
    let lastGroup = null;
    list.forEach((v, idx) => {
      if (v.groupId !== lastGroup) {
        lastGroup = v.groupId;
        box.appendChild(el('div', { className: 'entry-group' }, Data.groupLabel(Data.groupById(v.groupId), true)));
      }
      const cb = el('input', { type: 'checkbox', checked: !testExcluded.has(v.id) });
      const label = el('label', { className: testExcluded.has(v.id) ? 'off' : '', title: 'Nr. ' + (idx + 1) },
        cb, el('span', null, v.de), el('span', null, v.en),
        el('span', { className: 'type' }, v.type === 'vocab' ? '' : Data.TYPES[v.type]));
      cb.addEventListener('change', () => {
        cb.checked ? testExcluded.delete(v.id) : testExcluded.add(v.id);
        label.classList.toggle('off', !cb.checked);
        activePart = null;
        renderPartButtons();
        updateTestCount();
      });
      box.appendChild(label);
    });
    renderPartButtons();
    updateTestCount();
  }

  /** Buttons „Teil 1 (1–10)“, „Teil 2 (11–20)“ … – ein Klick wählt nur diesen Teil aus. */
  function renderPartButtons() {
    const box = $('part-buttons');
    box.innerHTML = '';
    const list = listedEntries();
    const size = Math.max(1, parseInt($('part-size').value, 10) || 10);
    if (list.length <= size) return;
    for (let start = 0, nr = 1; start < list.length; start += size, nr++) {
      const end = Math.min(list.length, start + size);
      const part = nr;
      box.appendChild(el('button', {
        className: 'small' + (activePart === part ? ' active' : ''),
        textContent: 'Teil ' + part + ' (' + (start + 1) + '–' + end + ')',
        onclick: () => {
          list.forEach((v, i) => ((i >= start && i < end) ? testExcluded.delete(v.id) : testExcluded.add(v.id)));
          activePart = part;
          renderTestEntries();
        },
      }));
    }
  }

  $('part-size').addEventListener('input', () => { activePart = null; renderPartButtons(); });
  $('entries-all').addEventListener('click', () => {
    listedEntries().forEach(v => testExcluded.delete(v.id));
    activePart = null;
    renderTestEntries();
  });
  $('entries-none').addEventListener('click', () => {
    listedEntries().forEach(v => testExcluded.add(v.id));
    activePart = null;
    renderTestEntries();
  });

  function selectedTestVocab() {
    return listedEntries().filter(v => !testExcluded.has(v.id));
  }

  /**
   * Abfrage-Einträge bauen. Synonyme/Gegenteile: immer Wort 1 → Wort 2 (eine Richtung).
   * lang = Sprache der Antwort (für das Ignorieren des Artikels).
   * keepOrder = true → Reihenfolge der Liste behalten (sonst gemischt).
   */
  function buildTestItems(list, dir, keepOrder) {
    const items = [];
    for (const v of list) {
      if (v.type === 'synonym' || v.type === 'antonym') {
        const label = v.type === 'synonym' ? 'Synonym zu' : 'Gegenteil von';
        items.push({ vocab: v, prompt: v.de, answer: v.en, label: label, sentence: false, lang: 'en' });
      } else {
        const sentence = v.type === 'sentence';
        const what = sentence ? 'Satz übersetzen · ' : '';
        items.push(dir === 'de-en'
          ? { vocab: v, prompt: v.de, answer: v.en, label: what + 'Deutsch → Englisch', sentence: sentence, lang: 'en' }
          : { vocab: v, prompt: v.en, answer: v.de, label: what + 'Englisch → Deutsch', sentence: sentence, lang: 'de' });
      }
    }
    return keepOrder ? items : shuffle(items);
  }

  function updateTestCount() {
    const n = selectedTestVocab().length;
    $('test-count').textContent = plural(n, 'Abfrage', 'Abfragen') + ' ausgewählt';
    $('test-start').disabled = n === 0;
  }

  $('btn-test').addEventListener('click', () => show('testsetup'));
  $('test-all').addEventListener('click', () => {
    Data.state.groups.forEach(g => testGroups.add(g.id));
    renderers.testsetup();
  });
  $('test-none').addEventListener('click', () => { testGroups.clear(); renderers.testsetup(); });

  $('test-start').addEventListener('click', () => {
    const dir = document.querySelector('input[name=direction]:checked').value;
    const chosen = selectedTestVocab();
    const groupIds = new Set(chosen.map(v => v.groupId));
    const groups = Data.sortedGroups().filter(g => groupIds.has(g.id));
    startRound({
      slot: 'test', mode: 'test',
      title: 'Arbeit lernen: ' + shorten(groupsSummary(groups), 60),
      items: buildTestItems(chosen, dir),
    });
  });

  /* ================================================================
   * Import (CSV mit Vorschau) und einzelne Einträge hinzufügen
   * ================================================================ */

  /** Einfacher CSV-Parser für Semikolon-Dateien (unterstützt "Anführungszeichen"). */
  function parseCSV(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);   // BOM (unsichtbares Startzeichen) entfernen
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
        } else field += c;
      } else if (c === '"' && field === '') {
        inQuotes = true;
      } else if (c === ';') {
        row.push(field); field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else {
        field += c;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    // Komplett leere Zeilen ignorieren
    return rows.filter(r => r.some(f => f.trim() !== ''));
  }

  let importRows = null; // [{ de, en, group, type, typeText, cols, fixed, extra, ok, tr, noteTd }]

  function handleImportFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCSV(reader.result);
      const head = rows.length ? rows[0].map(f => f.trim().toLowerCase()) : [];
      if (head[0] === 'deutsch' && head[1] === 'englisch' && head[2] === 'gruppe') rows.shift(); // Kopfzeile

      importRows = rows.map(r => ({
        de: (r[0] || '').trim(), en: (r[1] || '').trim(), group: (r[2] || '').trim(),
        typeText: (r[3] || '').trim(), type: Data.parseType(r[3]),
        cols: r.length, fixed: false, extra: r.slice(4).join(';'),
      }));
      $('import-filename').textContent = '(' + file.name + ')';
      $('import-message').textContent = '';
      renderImportPreview();
    };
    reader.readAsText(file, 'UTF-8');
  }

  function renderImportPreview() {
    const tbody = $('import-rows');
    tbody.innerHTML = '';
    $('import-preview').hidden = !importRows;
    if (!importRows) return;

    importRows.forEach((row, idx) => {
      const makeInput = key => el('input', {
        type: 'text', value: row[key],
        oninput: e => { row[key] = e.target.value; row.fixed = true; validateImport(); },
      });
      const typeSel = el('select', {
        onchange: e => { row.type = e.target.value; row.fixed = true; validateImport(); },
      });
      typeOptions(typeSel, row.type || 'vocab');
      if (!row.type) typeSel.value = ''; // unbekannter Typ → Auswahl leer, bis korrigiert

      row.noteTd = el('td', { className: 'note' });
      row.tr = el('tr', null,
        el('td', { className: 'muted' }, idx + 1),
        el('td', null, makeInput('de')),
        el('td', null, makeInput('en')),
        el('td', null, makeInput('group')),
        el('td', null, typeSel),
        row.noteTd,
        el('td', null, el('button', {
          className: 'small', title: 'Zeile löschen', textContent: '✕',
          onclick: () => { importRows.splice(importRows.indexOf(row), 1); renderImportPreview(); },
        })));
      tbody.appendChild(row.tr);
    });
    validateImport();
  }

  /** Markiert fehlerhafte Zeilen (rot) und Duplikate (gelb). Beides wird nicht übernommen. */
  function validateImport() {
    const seen = new Set();
    let bad = 0;
    for (const row of importRows) {
      const notes = [];
      let level = '';
      if ((row.cols < 3 || row.cols > 4) && !row.fixed) {
        notes.push('Spaltenanzahl falsch (' + row.cols + ' statt 3 oder 4)' + (row.extra ? ': „' + row.extra + '“' : ''));
        level = 'err';
      }
      if (!row.type) {
        notes.push('Unbekannter Typ „' + row.typeText + '“');
        level = 'err';
      }
      if (!row.de.trim() || !row.en.trim() || !row.group.trim()) {
        notes.push('Leeres Feld');
        level = 'err';
      }
      const key = JSON.stringify([row.type, row.de.trim(), row.en.trim()]);
      if (row.de.trim() && row.en.trim() && row.type) {
        if (Data.findDuplicate(row.de, row.en, null, row.type)) {
          notes.push('Schon vorhanden'); level = level || 'warn';
        } else if (seen.has(key)) {
          notes.push('Doppelt in der Datei'); level = level || 'warn';
        }
        seen.add(key);
      }
      row.ok = notes.length === 0;
      if (!row.ok) bad++;
      row.tr.className = level;
      row.noteTd.textContent = notes.join(' · ');
    }
    $('import-summary').textContent = importRows.length + ' Zeilen' +
      (bad ? ', davon ' + bad + ' markiert (werden nicht übernommen, außer du korrigierst sie)' : ' – alles in Ordnung');
    $('import-apply').disabled = importRows.length - bad === 0;
  }

  $('import-apply').addEventListener('click', () => {
    const good = importRows.filter(r => r.ok);
    const bad = importRows.length - good.length;
    if (bad && !confirm(bad + ' markierte Zeile(n) werden NICHT übernommen.\n' + good.length +
        ' Einträge werden gespeichert. Fortfahren?')) return;

    // Alle Gruppen dieser Datei kommen unter den angegebenen Test (falls einer eingetragen ist)
    const testName = $('import-test').value.trim();
    const test = testName ? Data.addTest(testName) : null;
    const groupsBefore = Data.state.groups.length;
    for (const r of good) {
      const g = Data.addGroup(r.group, test ? test.id : null);
      Data.addVocab(r.de, r.en, g.id, false, r.type);
    }
    Data.save();
    const newGroups = Data.state.groups.length - groupsBefore;
    importRows = null;
    $('import-test').value = '';
    renderImportPreview();
    setMessage($('import-message'), good.length + ' Einträge übernommen' +
      (newGroups ? ', ' + newGroups + ' neue Gruppe(n) angelegt' : '') +
      (test ? ' – im Test „' + test.name + '“' : '') + '.', true);
    renderDatalists();
  });

  $('import-cancel').addEventListener('click', () => {
    importRows = null;
    renderImportPreview();
  });

  // Datei-Auswahl und Drag & Drop
  $('import-choose').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', e => {
    handleImportFile(e.target.files[0]);
    e.target.value = '';
  });
  const dz = $('dropzone');
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.classList.remove('over');
    handleImportFile(e.dataTransfer.files[0]);
  });
  // Versehentliches Fallenlassen außerhalb der Zone soll die Datei nicht im Browser öffnen
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => e.preventDefault());

  /* ---------- Einzelner Eintrag ---------- */
  const FIELD_LABELS = {
    vocab: ['Deutsch', 'Englisch'],
    synonym: ['Wort', 'Synonym'],
    antonym: ['Wort', 'Gegenteil'],
    sentence: ['Deutscher Satz', 'Englischer Satz'],
  };

  /** Vorschlagslisten für die Felder „Gruppe“ und „Test“. */
  function renderDatalists() {
    const groups = $('group-list');
    groups.innerHTML = '';
    const names = Array.from(new Set(Data.sortedGroups().map(g => g.name)));
    names.forEach(n => groups.appendChild(el('option', { value: n })));
    const tests = $('test-list');
    tests.innerHTML = '';
    Data.sortedTests().forEach(t => tests.appendChild(el('option', { value: t.name })));
  }

  function updateAddLabels() {
    const t = $('add-type').value;
    $('add-de-label').textContent = FIELD_LABELS[t][0];
    $('add-en-label').textContent = FIELD_LABELS[t][1];
    $('add-form').classList.toggle('sentence', t === 'sentence');
  }
  typeOptions($('add-type'), 'vocab');
  $('add-type').addEventListener('change', updateAddLabels);

  $('add-form').addEventListener('submit', e => {
    e.preventDefault();
    const type = $('add-type').value;
    const de = $('add-de').value.trim(), en = $('add-en').value.trim();
    const gname = $('add-group').value.trim(), tname = $('add-test').value.trim();
    const msg = $('add-message');
    if (!de || !en || !gname) return setMessage(msg, 'Bitte Deutsch, Englisch und Gruppe ausfüllen.', false);
    if (Data.findDuplicate(de, en, null, type)) return setMessage(msg, 'Diesen Eintrag gibt es schon.', false);
    const test = tname ? Data.addTest(tname) : null;
    const testId = test ? test.id : null;
    const isNewGroup = !Data.groupByName(gname, testId);
    const g = Data.addGroup(gname, testId);
    Data.addVocab(de, en, g.id, true, type);
    setMessage(msg, Data.TYPES[type] + ' „' + de + ' – ' + en + '“ zu „' + Data.groupLabel(g, true) + '“ hinzugefügt' +
      (isNewGroup ? ' (neue Gruppe angelegt).' : '.'), true);
    $('add-de').value = '';
    $('add-en').value = '';
    $('add-de').focus();
    renderDatalists();
  });

  renderers.import = function () {
    renderDatalists();
    renderImportPreview();
    updateAddLabels();
  };

  /* ================================================================
   * Verwalter: Tests, Gruppen und Einträge
   * ================================================================
   * Links ein Baum: „Alle Gruppen“, darunter die Tests mit ihren Gruppen
   * (z. B. Buchseiten) und zuletzt die Gruppen ohne Test.
   * Rechts eine Tabelle mit den Einträgen der Auswahl: Fach, Fälligkeit,
   * wie oft richtig/falsch, zuletzt geübt, Merkliste.
   * Sortieren per Klick auf die Spaltenüberschrift, filtern, mehrere Einträge
   * auswählen und dann üben, Fach setzen, verschieben, löschen …
   */
  const ALL = '__all__';
  let scope = ALL;             // ALL | 'test:<id>' | 'group:<id>' – was links gewählt ist
  let editingId = null;
  let sortKey = null;
  let sortDir = 1;
  const selectedIds = new Set();

  const scopeKind = () => (scope === ALL ? 'all' : scope.slice(0, scope.indexOf(':')));
  const scopeId = () => (scope === ALL ? null : scope.slice(scope.indexOf(':') + 1));
  const scopeGroup = () => (scopeKind() === 'group' ? Data.groupById(scopeId()) : null);
  const scopeTest = () => (scopeKind() === 'test' ? Data.testById(scopeId()) : null);

  function setScope(newScope) {
    scope = newScope;
    editingId = null;
    selectedIds.clear();
    renderers.manage();
  }

  typeOptions($('manage-type'), '', true);

  /** Auswahlliste „Neu, Fach 1 … Fach 7“ (optional mit Platzhalter als erstem Eintrag). */
  function stageOptions(select, current, placeholder) {
    select.innerHTML = '';
    if (placeholder) select.appendChild(el('option', { value: '', textContent: placeholder }));
    select.appendChild(el('option', { value: 'new', textContent: 'Neu', selected: current === null }));
    for (let i = 1; i <= Data.MAX_STAGE; i++) {
      select.appendChild(el('option', { value: String(i), textContent: 'Fach ' + i, selected: current === i }));
    }
  }
  stageOptions($('manage-stage'), undefined, 'Alle Fächer');
  stageOptions($('bulk-stage'), undefined, 'Fach setzen …');

  /** Verwalter mit bestimmten Filtern öffnen (z. B. von der Startseite aus). */
  function openManage(filters) {
    scope = ALL;
    editingId = null;
    selectedIds.clear();
    $('manage-search').value = '';
    $('manage-type').value = '';
    $('manage-stage').value = filters.stage || '';
    $('manage-problems').checked = !!filters.problems;
    $('manage-due').checked = !!filters.due;
    $('manage-marked').checked = !!filters.marked;
    show('manage');
  }

  /** Baum links: Alle Gruppen → Tests → Gruppen. Gruppen lassen sich auf einen Test ziehen. */
  function renderTree() {
    const ul = $('group-items');
    ul.innerHTML = '';
    const hasTests = Data.state.tests.length > 0;

    const row = (cls, text, count, target) => el('li', {
      className: cls + (scope === target ? ' active' : ''),
      title: text,
      onclick: () => setScope(target),
    }, el('span', { className: 'name' }, text), el('span', { className: 'count' }, count));

    // Ziel, auf das man eine Gruppe ziehen kann (testId = null → „Ohne Test“)
    const dropTarget = (li, testId) => {
      li.addEventListener('dragover', e => { e.preventDefault(); li.classList.add('drop'); });
      li.addEventListener('dragleave', () => li.classList.remove('drop'));
      li.addEventListener('drop', e => {
        e.preventDefault();
        li.classList.remove('drop');
        const id = e.dataTransfer.getData('text/plain');
        if (!Data.groupById(id)) return;
        try { Data.setGroupTest(id, testId); } catch (err) { return alert(err.message); }
        renderers.manage();
      });
      return li;
    };

    ul.appendChild(row('all', 'Alle Gruppen', Data.state.vocab.length, ALL));
    for (const node of Data.groupTree()) {
      if (node.test) {
        ul.appendChild(dropTarget(
          row('test', node.test.name, Data.vocabInTest(node.test.id).length, 'test:' + node.test.id), node.test.id));
      } else if (hasTests) {
        ul.appendChild(dropTarget(el('li', { className: 'loose-head' }, 'Ohne Test'), null));
      }
      for (const g of node.groups) {
        const li = row(hasTests ? 'sub' : '', g.name, Data.vocabInGroup(g.id).length, 'group:' + g.id);
        li.draggable = true;
        li.addEventListener('dragstart', e => {
          e.dataTransfer.setData('text/plain', g.id);
          e.dataTransfer.effectAllowed = 'move';
        });
        ul.appendChild(li);
      }
    }
  }

  renderers.manage = function () {
    // Auswahl prüfen – der Test oder die Gruppe könnte inzwischen gelöscht sein
    if ((scopeKind() === 'group' && !scopeGroup()) || (scopeKind() === 'test' && !scopeTest())) scope = ALL;

    renderTree();

    const g = scopeGroup(), t = scopeTest();
    // „Neue Gruppe“ landet im gerade gewählten Test
    const target = t || (g && g.testId ? Data.testById(g.testId) : null);
    $('new-group-name').placeholder = target ? 'Neue Gruppe in „' + target.name + '“' : 'Neue Gruppe';
    $('new-group-name').title = $('new-group-name').placeholder;
    $('tree-tip').hidden = !Data.state.tests.length || !Data.state.groups.length;

    const empty = !Data.state.groups.length && !Data.state.vocab.length && !Data.state.tests.length;
    $('manage-empty').hidden = !empty;
    $('manage-content').hidden = empty;
    if (empty) return;

    $('manage-title').textContent = g ? Data.groupLabel(g, true) : t ? t.name : 'Alle Gruppen';
    $('group-actions').hidden = !g;
    $('test-actions').hidden = !t;
    if (g) {
      const sel = $('group-test');
      sel.innerHTML = '';
      sel.appendChild(el('option', { value: '', textContent: 'Ohne Test' }));
      for (const x of Data.sortedTests()) sel.appendChild(el('option', { value: x.id, textContent: x.name }));
      sel.value = g.testId || '';
    }
    groupOptions($('bulk-move'), null, 'Verschieben nach …');
    renderVocabTable();
  };

  /** Alle Einträge der links gewählten Auswahl (ohne Filter). */
  function scopeVocab() {
    if (scopeKind() === 'group') return Data.vocabInGroup(scopeId());
    if (scopeKind() === 'test') return Data.vocabInTest(scopeId());
    return Data.state.vocab;
  }

  /** Einträge nach den aktuellen Filtern. */
  function filteredList() {
    const q = $('manage-search').value.trim().toLowerCase();
    const type = $('manage-type').value;
    const stage = $('manage-stage').value;
    const onlyProblems = $('manage-problems').checked;
    const onlyDue = $('manage-due').checked;
    const onlyMarked = $('manage-marked').checked;
    return scopeVocab().filter(v =>
      (!type || v.type === type) &&
      (!stage || (stage === 'new' ? Data.isNew(v) : v.type === 'vocab' && v.stage === +stage)) &&
      (!onlyProblems || Data.isProblem(v)) &&
      (!onlyDue || Data.isDue(v)) &&
      (!onlyMarked || v.marked) &&
      (!q || v.de.toLowerCase().includes(q) || v.en.toLowerCase().includes(q)));
  }

  /** Wert, nach dem in einer Spalte sortiert wird. */
  function sortValue(v, key) {
    switch (key) {
      case 'group': return Data.groupLabel(Data.groupById(v.groupId), true);
      case 'type': return Data.TYPES[v.type];
      case 'stage': return v.type !== 'vocab' ? -1 : v.stage == null ? 0 : v.stage;
      case 'due': return v.due || '9999';
      case 'last': return v.lastPracticed || '';
      case 'right': return v.right;
      case 'wrong': return v.wrong;
      case 'marked': return v.marked ? 0 : 1;
      default: return v[key];
    }
  }

  function sortedList(list) {
    if (!sortKey) return list;
    return list.slice().sort((a, b) => {
      const x = sortValue(a, sortKey), y = sortValue(b, sortKey);
      const c = typeof x === 'number' && typeof y === 'number'
        ? x - y
        : String(x).localeCompare(String(y), 'de', { numeric: true, sensitivity: 'base' });
      return c * sortDir;
    });
  }

  let shownList = [];   // aktuell angezeigte Einträge (für „alle auswählen“)

  function renderVocabTable() {
    // Gelöschte Einträge aus der Auswahl entfernen
    for (const id of Array.from(selectedIds)) if (!Data.vocabById(id)) selectedIds.delete(id);

    const all = scopeVocab();
    shownList = sortedList(filteredList());

    const tbody = $('manage-rows');
    tbody.innerHTML = '';
    for (const v of shownList) tbody.appendChild(v.id === editingId ? editRow(v) : viewRow(v));
    if (!shownList.length) {
      tbody.appendChild(el('tr', null, el('td', { colSpan: 12, className: 'muted empty-row' }, 'Keine Einträge gefunden.')));
    }

    // Sortier-Pfeile in den Überschriften
    document.querySelectorAll('.manage-table th[data-sort]').forEach(th => {
      th.classList.toggle('sorted-asc', th.dataset.sort === sortKey && sortDir === 1);
      th.classList.toggle('sorted-desc', th.dataset.sort === sortKey && sortDir === -1);
    });

    $('manage-count').textContent = shownList.length === all.length
      ? plural(all.length, 'Eintrag', 'Einträge')
      : shownList.length + ' von ' + plural(all.length, 'Eintrag', 'Einträgen');
    updateBulkBar();
  }

  function updateBulkBar() {
    const n = selectedIds.size;
    $('bulk-bar').hidden = n === 0;
    $('bulk-count').textContent = plural(n, 'Eintrag', 'Einträge') + ' ausgewählt:';
    const visibleSelected = shownList.filter(v => selectedIds.has(v.id)).length;
    const head = $('manage-all');
    head.checked = shownList.length > 0 && visibleSelected === shownList.length;
    head.indeterminate = visibleSelected > 0 && visibleSelected < shownList.length;
  }

  function relDate(str) {
    if (!str) return '–';
    const d = Data.daysBetween(str, Data.today());
    if (d === 0) return 'heute';
    if (d === 1) return 'gestern';
    return formatDate(str);
  }

  /** Auswahl „Fach“ direkt in der Zeile – ändert das Fach sofort. */
  function stageCell(v) {
    if (v.type !== 'vocab') return el('td', { className: 'muted' }, '–');
    const sel = el('select', {
      className: 'stage-select stage-' + (v.stage == null ? 'new' : v.stage),
      title: 'Fach ändern',
      onchange: () => {
        Data.setStage([v.id], sel.value === 'new' ? null : +sel.value);
        renderVocabTable();
      },
    });
    stageOptions(sel, v.stage);
    return el('td', null, sel);
  }

  function dueCell(v) {
    if (v.type !== 'vocab' || v.stage == null) return el('td', { className: 'muted' }, '–');
    const due = Data.isDue(v);
    return el('td', { className: 'nowrap' + (due ? ' due-now' : '') }, due ? 'fällig' : formatDate(v.due));
  }

  function selectCell(v, tr) {
    const cb = el('input', {
      type: 'checkbox', checked: selectedIds.has(v.id),
      onchange: () => {
        cb.checked ? selectedIds.add(v.id) : selectedIds.delete(v.id);
        tr.classList.toggle('selected', cb.checked);
        updateBulkBar();
      },
    });
    return el('td', { className: 'cb' }, cb);
  }

  /** Stern: Eintrag auf die Merkliste setzen oder herunternehmen. */
  function markCell(v) {
    return el('td', { className: 'mark-cell' }, el('button', {
      className: 'star' + (v.marked ? ' on' : ''),
      textContent: v.marked ? '★' : '☆',
      title: v.marked ? 'Von der Merkliste nehmen' : 'Auf die Merkliste setzen',
      onclick: () => { Data.setMarked([v.id], !v.marked); renderVocabTable(); },
    }));
  }

  /** Gruppenname für die Tabelle – bei „Alle Gruppen“ mit dem Test davor. */
  function groupCellText(v) {
    return Data.groupLabel(Data.groupById(v.groupId), scopeKind() === 'all');
  }

  function viewRow(v) {
    const tr = el('tr', { className: selectedIds.has(v.id) ? 'selected' : '' });
    const problem = Data.isProblem(v);
    [
      selectCell(v, tr),
      markCell(v),
      el('td', null, v.de),
      el('td', null, v.en),
      el('td', { className: 'muted' }, Data.TYPES[v.type]),
      el('td', { className: 'muted group-cell', title: Data.groupLabel(Data.groupById(v.groupId), true) }, groupCellText(v)),
      stageCell(v),
      dueCell(v),
      el('td', { className: 'num' }, v.right),
      el('td', { className: 'num' + (problem ? ' problem' : ''), title: problem ? 'Problemwort' : '' }, v.wrong),
      el('td', { className: 'nowrap muted' }, relDate(v.lastPracticed)),
      el('td', { className: 'row-actions' },
        el('button', { className: 'small', textContent: 'Bearbeiten', onclick: () => { editingId = v.id; renderVocabTable(); } }),
        ' ',
        el('button', {
          className: 'small danger', textContent: 'Löschen',
          onclick: () => {
            if (confirm('„' + v.de + ' – ' + v.en + '“ wirklich löschen?')) {
              Data.deleteVocab(v.id);
              renderers.manage();
            }
          },
        })),
    ].forEach(td => tr.appendChild(td));
    return tr;
  }

  function editRow(v) {
    const de = el('input', { type: 'text', value: v.de });
    const en = el('input', { type: 'text', value: v.en });
    const type = el('select');
    typeOptions(type, v.type);
    const group = el('select');
    groupOptions(group, v.groupId);
    const cancel = () => { editingId = null; renderVocabTable(); };
    const saveEdit = () => {
      if (!de.value.trim() || !en.value.trim()) return alert('Die Felder dürfen nicht leer sein.');
      if (Data.findDuplicate(de.value, en.value, v.id, type.value)) return alert('Diesen Eintrag gibt es schon.');
      if (type.value !== v.type && v.type === 'vocab' && v.stage != null &&
          !confirm('Beim Ändern des Typs geht das Fach verloren. Fortfahren?')) return;
      Data.updateVocab(v.id, { de: de.value, en: en.value, type: type.value, groupId: group.value });
      editingId = null;
      renderers.manage();
    };
    const onKey = e => {
      if (e.key === 'Enter') saveEdit();
      if (e.key === 'Escape') cancel();
    };
    de.addEventListener('keydown', onKey);
    en.addEventListener('keydown', onKey);
    setTimeout(() => de.focus(), 0);
    return el('tr', { className: 'editing' },
      el('td'), markCell(v), el('td', null, de), el('td', null, en), el('td', null, type), el('td', null, group),
      stageCell(v), dueCell(v),
      el('td', { className: 'num' }, v.right), el('td', { className: 'num' }, v.wrong),
      el('td', { className: 'nowrap muted' }, relDate(v.lastPracticed)),
      el('td', { className: 'row-actions' },
        el('button', { className: 'small primary', textContent: 'Speichern', onclick: saveEdit }), ' ',
        el('button', { className: 'small', textContent: 'Abbrechen', onclick: cancel })));
  }

  // Filter
  ['manage-search', 'manage-type', 'manage-stage', 'manage-problems', 'manage-due', 'manage-marked'].forEach(id =>
    $(id).addEventListener(id === 'manage-search' ? 'input' : 'change', renderVocabTable));

  // Sortieren per Klick auf die Überschrift (nochmal klicken = andersherum, dritter Klick = aus)
  document.querySelectorAll('.manage-table th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (sortKey !== key) { sortKey = key; sortDir = 1; }
      else if (sortDir === 1) sortDir = -1;
      else sortKey = null;
      renderVocabTable();
    });
  });

  // Alle angezeigten auswählen / abwählen
  $('manage-all').addEventListener('change', e => {
    shownList.forEach(v => (e.target.checked ? selectedIds.add(v.id) : selectedIds.delete(v.id)));
    renderVocabTable();
  });

  /** Ausgewählte Einträge in der Reihenfolge der Tabelle. */
  function selectedVocab() {
    const inOrder = shownList.filter(v => selectedIds.has(v.id));
    const rest = Data.state.vocab.filter(v => selectedIds.has(v.id) && !inOrder.includes(v));
    return inOrder.concat(rest);
  }

  /* ---------- Aktionen für ausgewählte Einträge ---------- */
  $('bulk-practice').addEventListener('click', () => {
    const list = selectedVocab();
    startRound({
      slot: 'selection', mode: 'test',
      title: 'Auswahl üben (' + plural(list.length, 'Eintrag', 'Einträge') + ')',
      items: buildTestItems(list, 'de-en', true),
    });
  });
  $('bulk-stage').addEventListener('change', e => {
    if (!e.target.value) return;
    Data.setStage(Array.from(selectedIds), e.target.value === 'new' ? null : +e.target.value);
    e.target.value = '';
    renderVocabTable();
  });
  $('bulk-due').addEventListener('click', () => {
    Data.makeDue(Array.from(selectedIds));
    renderVocabTable();
  });
  $('bulk-move').addEventListener('change', e => {
    if (!e.target.value) return;
    for (const id of selectedIds) Data.updateVocab(id, { groupId: e.target.value });
    e.target.value = '';
    renderers.manage();
  });
  $('bulk-mark').addEventListener('change', e => {
    if (!e.target.value) return;
    Data.setMarked(Array.from(selectedIds), e.target.value === 'on');
    e.target.value = '';
    renderVocabTable();
  });
  $('bulk-reset').addEventListener('click', () => {
    Data.resetCounters(Array.from(selectedIds));
    renderVocabTable();
  });
  $('bulk-delete').addEventListener('click', () => {
    if (!confirm(plural(selectedIds.size, 'Eintrag', 'Einträge') + ' wirklich löschen? Das kann nicht rückgängig gemacht werden.')) return;
    Data.deleteVocabs(Array.from(selectedIds));
    selectedIds.clear();
    renderers.manage();
  });
  $('bulk-clear').addEventListener('click', () => { selectedIds.clear(); renderVocabTable(); });

  /* ---------- Tests und Gruppen anlegen, umbenennen, löschen ---------- */
  $('new-test-form').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('new-test-name').value.trim();
    if (!name) return;
    if (Data.testByName(name)) return alert('Einen Test mit diesem Namen gibt es schon.');
    $('new-test-name').value = '';
    setScope('test:' + Data.addTest(name).id);
  });

  $('new-group-form').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('new-group-name').value.trim();
    if (!name) return;
    // Die neue Gruppe kommt in den gerade gewählten Test (oder den Test der gewählten Gruppe)
    const g = scopeGroup(), t = scopeTest();
    const testId = t ? t.id : g ? g.testId : null;
    if (Data.groupByName(name, testId)) return alert('Eine Gruppe mit diesem Namen gibt es dort schon.');
    $('new-group-name').value = '';
    setScope('group:' + Data.addGroup(name, testId).id);
  });

  // Gruppe einem Test zuordnen (Auswahlliste „Test:“ über der Tabelle)
  $('group-test').addEventListener('change', e => {
    const g = scopeGroup();
    if (!g) return;
    try { Data.setGroupTest(g.id, e.target.value || null); } catch (err) { alert(err.message); }
    renderers.manage();
  });

  $('group-rename').addEventListener('click', () => {
    const g = scopeGroup();
    if (!g) return;
    const name = prompt('Neuer Name für die Gruppe „' + g.name + '“:', g.name);
    if (name == null || name.trim() === g.name) return;
    try { Data.renameGroup(g.id, name); } catch (err) { return alert(err.message); }
    renderers.manage();
  });

  $('group-delete').addEventListener('click', () => {
    const g = scopeGroup();
    if (!g) return;
    const n = Data.vocabInGroup(g.id).length;
    if (!confirm('Gruppe „' + g.name + '“ wirklich löschen?\n\nDabei werden auch ihre ' + n +
        ' Einträge gelöscht (samt Lernstand). Das kann nicht rückgängig gemacht werden.')) return;
    Data.deleteGroup(g.id);
    setScope(ALL);
  });

  $('test-rename').addEventListener('click', () => {
    const t = scopeTest();
    if (!t) return;
    const name = prompt('Neuer Name für den Test „' + t.name + '“:', t.name);
    if (name == null || name.trim() === t.name) return;
    try { Data.renameTest(t.id, name); } catch (err) { return alert(err.message); }
    renderers.manage();
  });

  $('test-dissolve').addEventListener('click', () => {
    const t = scopeTest();
    if (!t) return;
    if (!confirm('Test „' + t.name + '“ auflösen?\n\nDie Gruppen und alle Einträge bleiben erhalten, sie stehen danach unter „Ohne Test“.')) return;
    Data.dissolveTest(t.id);
    setScope(ALL);
  });

  $('test-delete').addEventListener('click', () => {
    const t = scopeTest();
    if (!t) return;
    const groups = Data.groupsInTest(t.id).length;
    const n = Data.vocabInTest(t.id).length;
    if (!confirm('Test „' + t.name + '“ wirklich löschen?\n\nDabei werden auch seine ' + plural(groups, 'Gruppe', 'Gruppen') +
        ' mit ' + plural(n, 'Eintrag', 'Einträgen') + ' gelöscht (samt Lernstand). Das kann nicht rückgängig gemacht werden.')) return;
    Data.deleteTest(t.id);
    setScope(ALL);
  });

  /* ================================================================
   * Lernplan zur Arbeit
   * ================================================================ */
  const planGroups = new Set();
  const planTypes = new Set(['vocab']);

  function planEntries() {
    const result = [];
    for (const g of Data.sortedGroups()) {
      if (!planGroups.has(g.id)) continue;
      for (const v of Data.vocabInGroup(g.id)) if (planTypes.has(v.type)) result.push(v);
    }
    return result;
  }

  /** Text „in 3 Tagen“ / „morgen“ / „heute“ / „vorbei“ */
  function daysText(n) {
    if (n < 0) return 'vorbei';
    if (n === 0) return 'heute';
    if (n === 1) return 'morgen';
    return 'in ' + n + ' Tagen';
  }

  /** Kurzbeschreibung, was heute im Plan dran ist. */
  function planTodayText(info) {
    if (info.over) return 'Die Arbeit ist vorbei.';
    const n = info.fresh.length + info.review.length;
    if (info.finalReview) return 'Generalprobe: alle ' + plural(n, 'Eintrag', 'Einträge');
    if (!n) return 'Heute nichts zu tun – alles für die Generalprobe bereit.';
    return 'Heute: ' + plural(info.fresh.length, 'neuer Eintrag', 'neue Einträge') +
      (info.review.length ? ' + ' + plural(info.review.length, 'Wiederholung', 'Wiederholungen') : '');
  }

  function startPlan(p) {
    const info = Data.planToday(p);
    const review = info.review.filter(v => !info.fresh.includes(v));
    // Neue Einträge in Buch-Reihenfolge (zum Einprägen), Wiederholungen gemischt dahinter
    startRound({
      slot: 'plan:' + p.id, planId: p.id, mode: 'test',
      title: 'Lernplan: ' + p.name,
      items: buildTestItems(info.fresh, p.direction, true).concat(buildTestItems(review, p.direction)),
    });
  }

  /** Eine Karte für einen Lernplan (auf der Startseite und in der Lernplan-Ansicht). */
  function planCard(p, withDelete) {
    const info = Data.planToday(p);
    const n = info.fresh.length + info.review.length;
    const pct = info.total ? Math.round(100 * info.learnedCount / info.total) : 0;
    const paused = pausedRound('plan:' + p.id);
    const startBtn = el('button', {
      className: info.doneToday && !paused ? '' : 'primary',
      textContent: paused ? 'Fortsetzen' : info.doneToday ? 'Schon weiterlernen' : 'Heute lernen',
      title: !paused && info.doneToday ? 'Startet schon die nächste Portion' : '',
      disabled: !paused && (info.over || n === 0),
      onclick: () => (paused ? resumeRound('plan:' + p.id) : startPlan(p)),
    });
    const todayText = paused
      ? 'Runde unterbrochen (' + pausedProgress(paused) + ').'
      : info.doneToday && !info.finalReview
        ? 'Heute erledigt ✓ – morgen geht es weiter.'
        : planTodayText(info) + (info.doneToday ? ' · heute erledigt ✓' : '');
    return el('div', { className: 'plan-card' + (info.over ? ' over' : '') },
      el('div', { className: 'plan-head' },
        el('strong', null, p.name),
        el('span', { className: 'muted' }, ' · Arbeit am ' + formatDate(p.date) + ' (' + daysText(info.daysLeft) + ')')),
      el('div', { className: 'plan-progress' }, el('div', { style: 'width:' + pct + '%' })),
      el('div', { className: 'muted small' },
        info.learnedCount + ' von ' + plural(info.total, 'Eintrag', 'Einträgen') + ' gelernt'),
      el('div', { className: 'plan-today' },
        el('span', null, todayText),
        el('span', { className: 'button-row' }, startBtn,
          withDelete ? el('button', {
            className: 'small danger', textContent: 'Löschen',
            onclick: () => {
              if (confirm('Lernplan „' + p.name + '“ löschen? Die Vokabeln selbst bleiben erhalten.')) {
                Data.deletePlan(p.id);
                renderers.plan();
              }
            },
          }) : null)));
  }

  renderers.plan = function () {
    // Vorhandene Pläne (nächste Arbeit zuerst, vorbei ganz unten)
    const list = $('plan-list');
    list.innerHTML = '';
    const plans = Data.state.plans.slice().sort((a, b) => a.date.localeCompare(b.date));
    const t = Data.today();
    plans.sort((a, b) => (a.date < t) - (b.date < t));
    if (!plans.length) list.appendChild(el('p', { className: 'muted' }, 'Noch kein Lernplan angelegt.'));
    plans.forEach(p => list.appendChild(planCard(p, true)));

    // Formular
    if (!$('plan-date').value) $('plan-date').value = Data.addDays(t, 7);
    $('plan-date').min = t;
    for (const id of Array.from(planGroups)) if (!Data.groupById(id)) planGroups.delete(id);
    renderGroupChecklist($('plan-groups'), planGroups, renderers.plan);

    const tbox = $('plan-types');
    tbox.innerHTML = '';
    const inGroups = Data.state.vocab.filter(v => planGroups.has(v.groupId));
    for (const key in Data.TYPES) {
      const cb = el('input', {
        type: 'checkbox', checked: planTypes.has(key),
        onchange: () => { cb.checked ? planTypes.add(key) : planTypes.delete(key); renderers.plan(); },
      });
      tbox.appendChild(el('label', null, cb, ' ' + TYPE_PLURAL[key] + ' ',
        el('span', { className: 'muted' }, '(' + inGroups.filter(v => v.type === key).length + ')')));
    }
    updatePlanInfo();
  };

  function updatePlanInfo() {
    const n = planEntries().length;
    const date = $('plan-date').value;
    let text = plural(n, 'Eintrag', 'Einträge');
    if (date && n) {
      const days = Data.daysBetween(Data.today(), date);
      if (days >= 2) text += ' · ca. ' + Math.ceil(n / (days - 1)) + ' neue pro Tag, Generalprobe am ' + formatDate(Data.addDays(date, -1));
      else if (days >= 0) text += ' · direkt Generalprobe (Arbeit ist ' + daysText(days) + ')';
    }
    $('plan-info').textContent = text;
    $('plan-create').disabled = !n || !date || Data.daysBetween(Data.today(), date) < 0;
  }
  $('plan-date').addEventListener('change', updatePlanInfo);

  $('plan-create').addEventListener('click', () => {
    const ids = planEntries().map(v => v.id);
    const date = $('plan-date').value;
    if (!ids.length || !date) return;
    const dir = document.querySelector('input[name=plan-direction]:checked').value;
    // Ohne eigenen Namen heißt der Plan wie der Test bzw. wie die gewählten Gruppen
    const groups = Data.sortedGroups().filter(g => planGroups.has(g.id));
    const p = Data.addPlan($('plan-name').value || shorten(groupsSummary(groups), 60), date, ids, dir);
    setMessage($('plan-message'), 'Lernplan „' + p.name + '“ angelegt.', true);
    $('plan-name').value = '';
    planGroups.clear();
    renderers.plan();
  });

  /* ================================================================
   * Hell / Dunkel
   * ================================================================ */
  const THEME_LABEL = { auto: '◐ Automatisch', light: '☀ Hell', dark: '☾ Dunkel' };
  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

  function applyTheme() {
    const t = Data.state.settings.theme || 'auto';
    const dark = t === 'dark' || (t === 'auto' && darkQuery.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    $('theme-toggle').textContent = THEME_LABEL[t];
  }
  $('theme-toggle').addEventListener('click', () => {
    const order = ['auto', 'light', 'dark'];
    const t = Data.state.settings.theme || 'auto';
    Data.state.settings.theme = order[(order.indexOf(t) + 1) % order.length];
    Data.save();
    applyTheme();
  });
  darkQuery.addEventListener('change', applyTheme);

  /* ================================================================
   * Automatisches Speichern in den Ordner
   * ================================================================ */
  function timeText(d) {
    const pad = n => String(n).padStart(2, '0');
    const day = d.toDateString() === new Date().toDateString() ? 'heute' : d.toLocaleDateString('de-DE');
    return day + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function renderAutosave() {
    const st = FileSave.status;
    const p = $('autosave-status');
    const btn = $('btn-autosave');
    btn.hidden = st === 'unsupported';
    btn.className = st === 'ready' ? '' : 'primary';
    if (st === 'unsupported') {
      p.textContent = 'Automatisches Speichern in einen Ordner geht nur in Chrome oder Edge am PC. Hier bitte die Sicherung unten von Hand herunterladen.';
      p.className = 'backup-hint old';
    } else if (st === 'none') {
      p.textContent = 'Noch nicht eingerichtet. Klick auf „Ordner auswählen“ und wähle den Vokabeltrainer-Ordner.';
      p.className = 'backup-hint old';
      btn.textContent = 'Ordner auswählen';
    } else if (st === 'needs-permission') {
      p.textContent = 'Pausiert – Chrome möchte einmal bestätigt haben, dass in den Ordner „' + FileSave.folderName + '“ gespeichert werden darf.';
      p.className = 'backup-hint old';
      btn.textContent = 'Speichern erlauben';
    } else {
      p.textContent = 'Aktiv: speichert automatisch in „' + FileSave.folderName + '/' + FileSave.FILE_NAME + '“' +
        (FileSave.lastWrite ? ' · zuletzt ' + timeText(FileSave.lastWrite) : '') +
        (FileSave.lastError ? ' · Fehler: ' + FileSave.lastError : '');
      p.className = 'backup-hint' + (FileSave.lastError ? ' old' : '');
      btn.textContent = 'Anderen Ordner wählen';
    }

    // Hinweisleiste oben auf der Startseite, wenn das Speichern nicht aktiv ist
    let banner = $('autosave-banner');
    if (!banner) {
      banner = el('div', { id: 'autosave-banner', className: 'banner' });
      $('view-home').prepend(banner);
    }
    banner.hidden = st === 'ready' || st === 'unsupported';
    banner.innerHTML = '';
    if (!banner.hidden) {
      banner.appendChild(el('span', null, st === 'none'
        ? 'Automatisches Speichern in den Ordner ist noch nicht eingerichtet.'
        : 'Automatisches Speichern ist pausiert.'));
      banner.appendChild(el('button', {
        className: 'small primary', textContent: st === 'none' ? 'Jetzt einrichten' : 'Speichern erlauben',
        onclick: autosaveClick,
      }));
    }

    // Hinweis zur manuellen Sicherung
    const days = Data.daysSinceBackup();
    $('backup-hint').textContent = days === null ? 'Letzte Sicherung: noch keine'
      : days === 0 ? 'Letzte Sicherung: heute'
      : days === 1 ? 'Letzte Sicherung: vor 1 Tag'
      : 'Letzte Sicherung: vor ' + days + ' Tagen';
  }

  async function autosaveClick() {
    const result = FileSave.status === 'needs-permission' ? await FileSave.reconnect() : await FileSave.connect();
    if (result === 'loaded') {
      alert('Im Ordner lag ein neuerer Lernstand – er wurde geladen.');
      applyTheme();
      show(currentView === 'quiz' ? 'home' : currentView);
    }
    renderAutosave();
  }
  $('btn-autosave').addEventListener('click', autosaveClick);
  FileSave.onChange(renderAutosave);

  /* ================================================================
   * Start
   * ================================================================ */
  Data.load();
  applyTheme();
  show('home');
  renderAutosave();
  FileSave.init().then(result => {
    if (result === 'loaded' && currentView !== 'quiz') { applyTheme(); show(currentView); }
    renderAutosave();
  });
})();
