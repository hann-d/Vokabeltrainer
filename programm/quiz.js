/*
 * quiz.js – Abfrage-Ansicht (für „Langzeit lernen“, „Arbeit lernen“, Lernplan, Auswahl …)
 * ========================================================================================
 * Eine Runde wird in Blöcke aufgeteilt (Einstellung „Wörter pro Block“).
 * Pro Block:
 *   1. Einprägen: Einträge, die noch nie abgefragt wurden, werden nacheinander
 *      als Karte gezeigt (Frage + Lösung, ohne Tippen). Man klickt durch.
 *   2. Abfrage aller Einträge des Blocks. Falsche kommen ans Ende des Blocks,
 *      bis jeder einmal richtig war.
 *
 * Phasen:
 *   'card'    → Einprägen-Karte
 *   'ask'     → Nutzer tippt, Enter prüft (leer + Enter = „Ich weiß nicht“)
 *   'correct' → Rückmeldung „Richtig“, Enter geht weiter
 *   'retype'  → nach Fehler: der letzte (falsche) Versuch steht unten zum Vergleich,
 *               die Lösung muss einmal komplett richtig abgetippt werden
 *
 * Unterbrechen und Fortsetzen:
 *   Nach jedem Schritt wird der Stand der Runde gespeichert (Data.saveSession).
 *   Verlässt man die Abfrage oder schließt den Browser, kann die Runde später
 *   mit Quiz.resume() an derselben Stelle fortgesetzt werden.
 *
 * Merkliste: Mit „Merken“ (Strg+M) kommt der aktuelle Eintrag auf die Merkliste.
 *
 * Gewertet (Fach, Zähler) wird nur die ERSTE Antwort pro Eintrag in der Runde.
 * Die Regeln dafür stehen in data.js (gradeLongTerm / gradeTest).
 */
const Quiz = (function () {
  'use strict';

  const $ = id => document.getElementById(id);

  /**
   * Aktuelle Runde oder null.
   * s = { slot, title, planId, day, mode, items, blocks: [[item]], blockIdx, queue, cards, cardIdx,
   *       shown: Set, total, done, errors, phase, canAccept, onFinish, onAnswer }
   * item = { vocab, prompt, answer, label, sentence, lang ('en'|'de' = Sprache der Antwort),
   *          attempted, graded, undoable, snap }
   * Es gilt immer: total = done + queue.length + (Einträge der späteren Blöcke).
   */
  let s = null;

  /* ---------------- Start / Fortsetzen / Ende ---------------- */

  /**
   * Neue Runde starten.
   * opts = { slot, title, planId, mode, items, blockSize, onFinish, onAnswer }
   *   slot  = Name des Speicherplatzes zum Fortsetzen (z. B. 'longterm', 'test')
   *   title = Anzeigename der Runde („Arbeit lernen: Unit 5“)
   */
  function start(opts) {
    const items = opts.items.map(it =>
      Object.assign({ attempted: false, graded: false, undoable: false, snap: null }, it));
    const size = Math.max(1, opts.blockSize | 0 || items.length);
    const blocks = [];
    for (let i = 0; i < items.length; i += size) blocks.push(items.slice(i, i + size));

    s = {
      slot: opts.slot || 'runde',
      title: opts.title || 'Runde',
      planId: opts.planId || null,
      day: Data.today(),
      mode: opts.mode,
      items: items,
      blocks: blocks,
      blockIdx: 0,
      queue: [],
      cards: [],
      cardIdx: 0,
      shown: new Set(),   // IDs, deren Karte in dieser Runde schon gezeigt wurde
      total: items.length,
      done: 0,
      errors: 0,
      phase: 'ask',
      canAccept: false,
      onFinish: opts.onFinish,
      onAnswer: opts.onAnswer || null,   // (vocab, correct) – erste Antwort pro Eintrag (z. B. für Lernpläne)
    };
    startBlock();
  }

  /** Nächsten Block beginnen: zuerst Karten zum Einprägen, dann Abfrage. */
  function startBlock() {
    const block = s.blocks[s.blockIdx];
    s.cards = [];
    for (const it of block) {
      if (!it.vocab.seen && !s.shown.has(it.vocab.id)) {
        s.shown.add(it.vocab.id);
        s.cards.push(it);
      }
    }
    // Abfrage in derselben Reihenfolge wie die Karten (was man gerade eingeprägt hat, kommt gleich dran)
    s.queue = block.slice();
    s.cardIdx = 0;
    if (s.cards.length) showCard();
    else showAsk();
  }

  /** Zum nächsten Block, der noch Einträge hat – oder die Runde beenden. */
  function nextBlock() {
    do { s.blockIdx++; } while (s.blockIdx < s.blocks.length && !s.blocks[s.blockIdx].length);
    if (s.blockIdx < s.blocks.length) startBlock();
    else finish();
  }

  /** Stand der Runde speichern, damit man sie später fortsetzen kann. */
  function persist() {
    if (!s) return;
    const idx = it => s.items.indexOf(it);
    Data.saveSession(s.slot, {
      slot: s.slot, title: s.title, planId: s.planId, day: s.day, savedAt: Date.now(),
      mode: s.mode,
      items: s.items.map(it => ({
        vocabId: it.vocab.id, label: it.label, sentence: !!it.sentence, lang: it.lang,
        attempted: it.attempted, graded: it.graded,
      })),
      blocks: s.blocks.map(b => b.map(idx)),
      blockIdx: s.blockIdx,
      queue: s.queue.map(idx),
      cards: s.cards.map(idx),
      cardIdx: s.cardIdx,
      shown: Array.from(s.shown),
      total: s.total, done: s.done, errors: s.errors,
      phase: s.phase,
    });
  }

  /**
   * Unterbrochene Runde fortsetzen. data = von persist() gespeicherter Stand,
   * hooks = { onFinish, onAnswer }.
   */
  function resume(data, hooks) {
    // Einträge wiederherstellen. Gelöschte Vokabeln fallen heraus, die Texte kommen
    // frisch aus der Vokabel (falls sie inzwischen bearbeitet wurde).
    const items = data.items.map(d => {
      const vocab = Data.vocabById(d.vocabId);
      if (!vocab) return null;
      const toGerman = d.lang === 'de';
      return {
        vocab: vocab,
        prompt: toGerman ? vocab.en : vocab.de,
        answer: toGerman ? vocab.de : vocab.en,
        label: d.label, sentence: !!d.sentence, lang: d.lang,
        attempted: !!d.attempted, graded: !!d.graded, undoable: false, snap: null,
      };
    });
    const pick = list => list.map(i => items[i]).filter(Boolean);
    const firstAlive = data.queue.length > 0 && !!items[data.queue[0]];

    s = {
      slot: data.slot,
      title: data.title,
      planId: data.planId || null,
      day: data.day,
      mode: data.mode,
      items: items.filter(Boolean),
      blocks: data.blocks.map(pick),
      blockIdx: data.blockIdx,
      queue: pick(data.queue),
      cards: pick(data.cards || []),
      cardIdx: 0,
      shown: new Set(data.shown || []),
      total: 0,
      done: data.done,
      errors: data.errors,
      phase: 'ask',
      canAccept: false,
      onFinish: hooks.onFinish,
      onAnswer: hooks.onAnswer || null,
    };
    s.total = s.done + s.queue.length +
      s.blocks.slice(s.blockIdx + 1).reduce((n, b) => n + b.length, 0);

    if (data.phase === 'card' && s.cards.length) {
      s.cardIdx = Math.min(data.cardIdx || 0, s.cards.length - 1);
      showCard();
    } else if (!s.queue.length) {
      nextBlock();                        // im aktuellen Block ist nichts mehr übrig
    } else if (data.phase === 'correct' && firstAlive) {
      nextAfterCorrect();                 // die richtige Antwort war schon gegeben
    } else if (data.phase === 'retype' && firstAlive) {
      s.queue[0].attempted = true;        // der Fehler war schon gewertet → wie nach dem Abtippen
      s.queue.push(s.queue.shift());
      showAsk();
    } else {
      showAsk();
    }
  }

  /**
   * Abfrage verlassen. Der Stand ist gespeichert, die Runde kann später
   * fortgesetzt werden (der Lernstand selbst wird ohnehin nach jeder Antwort gespeichert).
   */
  function pause() {
    if (s) persist();
    s = null;
  }

  function finish() {
    const result = { words: s.total, errors: s.errors };
    const cb = s.onFinish;
    Data.clearSession(s.slot);
    s = null;
    cb(result);
  }

  /* ---------------- Wertung ---------------- */

  /** Wendet die Wertung je nach Modus an. Gibt true zurück, wenn sich der Lernstand geändert hat. */
  function grade(item, correct) {
    return s.mode === 'longterm'
      ? Data.gradeLongTerm(item.vocab, correct)
      : Data.gradeTest(item.vocab, correct);
  }

  /**
   * Erste Antwort pro Eintrag werten: Fach, Richtig/Falsch-Zähler und ggf. Lernplan.
   * Spätere Antworten (Wiederholungen nach Fehlern) zählen nicht.
   */
  function gradeFirst(item, correct) {
    grade(item, correct);
    item.graded = true;
    Data.markSeen(item.vocab);
    Data.recordAnswer(item.vocab, correct);
    if (s.onAnswer) s.onAnswer(item.vocab, correct);
  }

  /** Antwort war falsch → bei der ersten Antwort werten und Schnappschuss für „Gelten lassen“ merken. */
  function gradeWrong(item) {
    item.undoable = false;
    if (!item.graded) {
      item.snap = Data.snapshot(item.vocab);
      gradeFirst(item, false);
      item.undoable = true;   // diese Wertung kann „Gelten lassen“ zurücknehmen
    }
  }

  /** Vergleichsoptionen: Sätze (Punkt am Ende egal) und Artikel in der Antwortsprache ignorieren. */
  function compareOpts(item) {
    return { sentence: item.sentence, ignoreArticle: item.lang || 'en' };
  }

  /* ---------------- Aktionen ---------------- */

  function check() {
    const item = s.queue[0];
    const input = $('quiz-input');
    if (!input.value.trim()) return dontKnow();   // leer + Enter = „Ich weiß nicht“

    const r = VokabelCompare.check(input.value, item.answer, compareOpts(item));
    if (r.correct) {
      if (!item.graded) gradeFirst(item, true);
      s.phase = 'correct';
      showCorrect(item, r);
    } else {
      s.errors++;
      gradeWrong(item);
      s.phase = 'retype';
      s.canAccept = true;
      showWrong(item, r);
    }
  }

  function dontKnow() {
    const item = s.queue[0];
    s.errors++;
    gradeWrong(item);
    s.phase = 'retype';
    s.canAccept = false;   // „Gelten lassen“ ergibt hier keinen Sinn
    showWrong(item, null);
  }

  /** „Gelten lassen“: die falsche Antwort zählt doch als richtig. */
  function accept() {
    const item = s.queue[0];
    s.errors--;
    if (item.undoable) {
      Data.restore(item.vocab, item.snap);  // falsche Wertung (Fach + Zähler) zurücknehmen …
      gradeFirst(item, true);               // … und als richtig werten
      item.undoable = false;
    }
    nextAfterCorrect();
  }

  /** Abtippen nach einem Fehler prüfen. */
  function checkRetype() {
    const item = s.queue[0];
    const input = $('quiz-input');
    if (!input.value.trim()) {
      setHint('Bitte die Lösung abtippen.', true);
      return;
    }
    const r = VokabelCompare.check(input.value, item.answer, compareOpts(item));
    if (r.correct) {
      item.attempted = true;
      s.queue.push(s.queue.shift());   // ans Ende des Blocks
      showAsk();
    } else {
      // Den NEUEN Fehlversuch zum Vergleich anzeigen (nicht mehr den alten) …
      renderWrongBox(item, r, true);
      // … und das Feld komplett leeren: das Wort muss ganz neu geschrieben werden
      input.value = '';
      setHint('Noch nicht richtig – bitte noch einmal komplett neu schreiben.', true);
      input.classList.remove('shake');
      void input.offsetWidth; // Animation neu starten
      input.classList.add('shake');
    }
  }

  function nextAfterCorrect() {
    s.queue.shift();
    s.done++;
    if (s.queue.length) showAsk();
    else nextBlock();
  }

  function cardNext() {
    if (s.cardIdx < s.cards.length - 1) { s.cardIdx++; showCard(); }
    else showAsk();   // alle Karten gesehen → Abfrage des Blocks
  }
  function cardBack() {
    if (s.cardIdx > 0) { s.cardIdx--; showCard(); }
  }

  /* ---------------- Merkliste ---------------- */

  /** Der Eintrag, der gerade auf dem Bildschirm steht. */
  function currentItem() {
    if (!s) return null;
    return s.phase === 'card' ? s.cards[s.cardIdx] : s.queue[0];
  }

  function updateMark() {
    const item = currentItem();
    const btn = $('quiz-mark');
    const on = !!(item && item.vocab.marked);
    btn.textContent = on ? '★ Gemerkt' : '☆ Merken';
    btn.classList.toggle('on', on);
    btn.title = (on ? 'Von der Merkliste nehmen' : 'Auf die Merkliste setzen') + ' (Strg+M)';
  }

  function toggleMark() {
    const item = currentItem();
    if (!item) return;
    Data.setMarked([item.vocab.id], !item.vocab.marked);
    updateMark();
  }

  /* ---------------- Anzeige ---------------- */

  function setHint(text, isError) {
    const h = $('quiz-hint');
    h.textContent = text || '';
    h.className = 'hint' + (isError ? ' err' : '');
  }

  function setButtons(phase) {
    $('card-back').hidden = phase !== 'card';
    $('card-back').disabled = phase === 'card' && s.cardIdx === 0;
    $('card-next').hidden = phase !== 'card';
    $('card-next').textContent = phase === 'card' && s.cardIdx === s.cards.length - 1 ? 'Abfrage starten' : 'Weiter';
    $('quiz-check').hidden = phase !== 'ask' && phase !== 'retype';
    $('quiz-check').textContent = phase === 'retype' ? 'Abgetippt' : 'Prüfen';
    $('quiz-dontknow').hidden = phase !== 'ask';
    $('quiz-accept').hidden = !(phase === 'retype' && s.canAccept);
    $('quiz-next').hidden = phase !== 'correct';

    const keys = {
      card: 'Enter oder → = weiter · ← = zurück',
      ask: 'Enter = prüfen · Enter ohne Eingabe = Ich weiß nicht',
      correct: 'Enter = weiter',
      retype: 'Lösung abtippen, dann Enter',
    };
    $('quiz-keys').textContent = keys[phase] + ' · Strg+M = merken';
  }

  function blockPrefix() {
    return s.blocks.length > 1 ? 'Block ' + (s.blockIdx + 1) + ' von ' + s.blocks.length + ' · ' : '';
  }

  function updateProgress() {
    if (s.phase === 'card') {
      $('quiz-progress-text').textContent = blockPrefix() + 'Einprägen: ' + (s.cardIdx + 1) + ' von ' + s.cards.length;
    } else {
      const fresh = s.queue.filter(i => !i.attempted).length;
      const repeats = s.queue.length - fresh;
      $('quiz-progress-text').textContent = blockPrefix() +
        'Noch ' + fresh + ' neu · ' + repeats + (repeats === 1 ? ' Wiederholung' : ' Wiederholungen');
    }
    $('quiz-progress-bar').style.width = (s.total ? 100 * s.done / s.total : 0) + '%';
  }

  function setPrompt(item, showRepeat) {
    $('quiz-label').textContent = item.label;
    $('quiz-prompt').textContent = item.prompt;
    $('quiz-prompt').className = item.sentence ? 'sentence' : '';
    $('quiz-repeat').hidden = !showRepeat;
    updateMark();
  }

  /** Einprägen-Karte: Frage oben, Lösung darunter, nichts tippen. */
  function showCard() {
    const item = s.cards[s.cardIdx];
    s.phase = 'card';
    updateProgress();
    setPrompt(item, false);
    const parts = VokabelCompare.splitRemark(item.answer);
    $('card-answer').textContent = parts.main;
    $('card-answer').className = 'card-answer' + (item.sentence ? ' sentence' : '');
    $('card-remark').textContent = parts.remark;
    $('card-area').hidden = false;
    $('input-area').hidden = true;
    $('quiz-result').hidden = true;
    setButtons('card');
    if (document.activeElement) document.activeElement.blur();
    persist();
  }

  function showAsk() {
    const item = s.queue[0];
    s.phase = 'ask';
    updateProgress();
    setPrompt(item, item.attempted);
    $('card-area').hidden = true;
    $('input-area').hidden = false;
    $('quiz-result').hidden = true;
    const input = $('quiz-input');
    input.value = '';
    input.readOnly = false;
    input.className = 'quiz-input' + (item.sentence ? ' sentence' : '');
    input.placeholder = 'Antwort eingeben';
    setHint('');
    setButtons('ask');
    input.focus();
    persist();
  }

  /** Zeichenfolge mit Markierungen (Anki-Stil) aufbauen. */
  function renderMarks(marks, line) {
    const wrap = document.createElement('span');
    wrap.className = 'cmp-text';
    for (const m of marks) {
      const sp = document.createElement('span');
      let cls;
      if (m.type === 'ok') cls = 'good';
      else if (m.type === 'neutral') cls = 'plain';   // zählt nicht (Artikel, Punkt am Satzende)
      else if (m.type === 'swap') cls = 'swap';
      else if (line === 'typed') cls = m.type === 'missing' ? 'missed' : 'bad';
      else cls = 'missed';   // in der Lösung: was gefehlt hat oder falsch war
      sp.className = cls;
      sp.textContent = m.ch;
      wrap.appendChild(sp);
    }
    return wrap;
  }

  function plainText(text, cls) {
    const sp = document.createElement('span');
    sp.className = 'cmp-text';
    const inner = document.createElement('span');
    inner.className = cls;
    inner.textContent = text;
    sp.appendChild(inner);
    return sp;
  }

  function div(cls, text) {
    const d = document.createElement('div');
    d.className = cls;
    if (text != null) d.textContent = text;
    return d;
  }

  /**
   * Vergleich aufbauen – ein Raster, damit beide Zeilen exakt untereinander stehen:
   *   [Beschriftung] getippte Zeile
   *                  ↓
   *   [Richtig]      richtige Zeile
   * typed = null → nur die richtige Zeile (bei „Ich weiß nicht“).
   */
  function buildCompare(item, typed, typedLabel, solution) {
    const cmp = div('cmp' + (item.sentence ? ' sentence' : ''));
    if (typed) {
      cmp.appendChild(div('cmp-label', typedLabel));
      cmp.appendChild(typed);
      cmp.appendChild(div('cmp-arrow', '↓'));
    }
    cmp.appendChild(div('cmp-label', 'Richtig'));
    cmp.appendChild(solution);
    return cmp;
  }

  /**
   * Schrift des Vergleichs so weit verkleinern, dass auch lange Sätze in EINE Zeile
   * passen (die Zeilen brechen nie um, sonst stünden die Zeichen nicht mehr untereinander).
   */
  function fitCompare() {
    const box = $('quiz-result');
    const cmp = box.querySelector('.cmp');
    if (!cmp || box.hidden) return;
    cmp.style.fontSize = '';   // zurück auf die normale Größe
    const texts = Array.from(cmp.querySelectorAll('.cmp-text'));
    const label = cmp.querySelector('.cmp-label');
    const style = getComputedStyle(box);
    // Am PC steht die Beschriftung links neben dem Text und braucht Platz,
    // am Handy steht sie darüber (dann zählt sie nicht mit).
    const beside = label && label.offsetLeft + label.offsetWidth <= texts[0].offsetLeft + 1;
    const available = box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) -
      (beside ? label.offsetWidth : 0) - 4;
    const widest = Math.max.apply(null, texts.map(t => t.scrollWidth));
    if (available > 0 && widest > available) {
      const base = parseFloat(getComputedStyle(cmp).fontSize);
      cmp.style.fontSize = Math.max(10, Math.floor(base * available / widest * 10) / 10) + 'px';
    }
  }
  window.addEventListener('resize', () => { if (s) fitCompare(); });

  function addRemark(box, answer) {
    const remark = VokabelCompare.splitRemark(answer).remark;
    if (remark) box.appendChild(div('remark', remark));
  }

  function showCorrect(item, r) {
    const box = $('quiz-result');
    box.hidden = false;
    box.className = 'result ok';
    box.innerHTML = '';
    box.appendChild(div('result-title', 'Richtig'));
    // Bei sb./sth.-Varianten o. Ä. zeigen, wie der Eintrag gespeichert ist
    // (bei Sätzen zählt ein fehlender Punkt am Ende nicht als Unterschied)
    const strip = x => item.sentence ? x.replace(/[.!?…]+$/, '') : x;
    if (strip(r.typed) !== strip(r.solution)) {
      box.appendChild(div('muted small', 'Gespeichert als: ' + r.solution));
    }
    addRemark(box, item.answer);

    const input = $('quiz-input');
    input.readOnly = true;
    input.classList.add('ok');
    setHint('');
    setButtons('correct');
    input.focus();
    persist();
  }

  /**
   * Fehler-Kasten unter dem Eingabefeld füllen.
   * r = Ergebnis von check(), oder null bei „Ich weiß nicht“ (dann nur die Lösung).
   * retry = true → es ist ein erneuter Fehlversuch beim Abtippen.
   */
  function renderWrongBox(item, r, retry) {
    const box = $('quiz-result');
    box.hidden = false;
    box.className = 'result bad';
    box.innerHTML = '';
    if (r) {
      box.appendChild(div('result-title', retry ? 'Noch nicht richtig' : 'Falsch'));
      const label = retry ? 'Neuer Versuch' : 'Deine Antwort';
      box.appendChild(r.tooWrong
        ? buildCompare(item, plainText(r.typed, 'bad'), label, plainText(r.solution, 'good'))
        : buildCompare(item, renderMarks(r.inputMarks, 'typed'), label, renderMarks(r.solutionMarks, 'solution')));
    } else {
      box.appendChild(div('result-title', 'Lösung'));
      box.appendChild(buildCompare(item, null, '',
        plainText(VokabelCompare.splitRemark(item.answer).main, 'good')));
    }
    addRemark(box, item.answer);
    fitCompare();
  }

  /** Nach einer falschen Antwort: Vergleich zeigen und die Lösung abtippen lassen. */
  function showWrong(item, r) {
    renderWrongBox(item, r, false);
    const input = $('quiz-input');
    input.value = '';
    input.readOnly = false;
    input.className = 'quiz-input retype' + (item.sentence ? ' sentence' : '');
    input.placeholder = 'Lösung einmal abtippen';
    setHint(s.canAccept ? 'Falls deine Antwort doch stimmt: „Gelten lassen“.' : '');
    setButtons('retype');
    updateProgress();
    input.focus();
    persist();
  }

  /* ---------------- Tastatur und Buttons ---------------- */

  document.addEventListener('keydown', e => {
    if (!s || e.repeat) return;
    if (!$('view-quiz').classList.contains('active')) return;
    if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'm') {   // Strg+M = merken
      e.preventDefault();
      toggleMark();
      return;
    }
    if (s.phase === 'card') {
      if (e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); cardNext(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); cardBack(); }
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (s.phase === 'ask') check();
    else if (s.phase === 'correct') nextAfterCorrect();
    else if (s.phase === 'retype') checkRetype();
  });

  function onButton(id, fn) {
    $(id).addEventListener('click', e => {
      e.currentTarget.blur();
      if (!s) return;
      fn();
      if (s && s.phase !== 'card') $('quiz-input').focus();
    });
  }
  onButton('quiz-check', () => (s.phase === 'retype' ? checkRetype() : check()));
  onButton('quiz-dontknow', dontKnow);
  onButton('quiz-accept', accept);
  onButton('quiz-next', nextAfterCorrect);
  onButton('card-next', cardNext);
  onButton('card-back', cardBack);
  onButton('quiz-mark', toggleMark);

  return { start, resume, pause };
})();
