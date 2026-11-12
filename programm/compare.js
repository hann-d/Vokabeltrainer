/*
 * compare.js – Vergleichs- und Fehlerlogik des Vokabeltrainers
 * =============================================================
 * Diese Datei hat keine Abhängigkeiten zur Oberfläche und kann darum
 * eigenständig in test.html getestet werden.
 *
 * Öffentliche Funktionen (unter window.VokabelCompare):
 *   normalizeBasic(text)      – Leerzeichen und Apostrophe vereinheitlichen
 *   canonical(text)           – zusätzlich sb./sth.-Varianten vereinheitlichen
 *   splitRemark(text)         – Klammertext abtrennen (wird nicht abgefragt)
 *   isCorrect(input, solution, opts) – true, wenn die Eingabe als richtig zählt
 *   align(a, b)               – Damerau-Levenshtein-Alignment (Liste von Operationen)
 *   check(input, solution, opts)     – vollständiges Ergebnis inkl. Zeichenmarkierungen
 *   opts = { sentence: true }        → Satz: Satzzeichen am Ende und Groß-/Kleinschreibung egal
 *   Kurzformen: don't = dont = don t = do not; andere Apostrophe dürfen fehlen
 *   opts = { ignoreArticle: 'en' }   → the/a/an am Anfang egal ('de': der/die/das/ein/eine)
 */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------
   * 1. Normalisierung
   * ------------------------------------------------------------------ */

  // Typografische Apostrophe (’ ‘ ‛ ′) → normaler Apostroph '
  const APOSTROPHE_RE = /[‘’‛′]/g;

  // Wortgrenzen für die Abkürzungen: davor Anfang/Leerzeichen/Klammer/Schrägstrich,
  // danach Ende/Leerzeichen/Satzzeichen/Apostroph (für "sb.'s" bzw. "somebody's").
  const BEFORE = '(?<=^|[\\s(/])';
  const AFTER = '(?=$|[\\s)/,;:!?\'])';

  // Gruppen gleichwertiger Schreibweisen. Die erste Form ist die "kanonische".
  const FAMILIES = [
    { canonical: 'sb.', re: new RegExp(BEFORE + '(?:somebody|sb\\.?)' + AFTER, 'g') },
    { canonical: 'sth.', re: new RegExp(BEFORE + '(?:something|sth\\.?)' + AFTER, 'g') },
  ];

  /** Leerzeichen am Rand entfernen, mehrfache Leerzeichen zu einem, Apostrophe vereinheitlichen. */
  function normalizeBasic(text) {
    return String(text == null ? '' : text)
      .replace(APOSTROPHE_RE, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Wie normalizeBasic, zusätzlich werden sb/sb./somebody und sth/sth./something vereinheitlicht. */
  function canonical(text) {
    let s = normalizeBasic(text);
    for (const fam of FAMILIES) s = s.replace(fam.re, fam.canonical);
    return s;
  }

  /**
   * Trennt Text in Klammern ab: "to go (went, gone)" → { main: "to go", remark: "(went, gone)" }.
   * Der Klammertext wird nicht abgefragt, sondern nur als Bemerkung angezeigt.
   * Besteht der ganze Eintrag nur aus Klammern, bleibt er unverändert.
   */
  function splitRemark(text) {
    const s = String(text == null ? '' : text);
    const remarks = [];
    const main = normalizeBasic(s.replace(/\(([^)]*)\)/g, (m, inner) => {
      if (inner.trim()) remarks.push('(' + normalizeBasic(inner) + ')');
      return ' ';
    }));
    if (!main) return { main: normalizeBasic(s), remark: '' };
    return { main: main, remark: remarks.join(' ') };
  }

  // Satzzeichen am Satzende (bei Sätzen egal)
  const END_PUNCT = /\s*[.!?…]+$/;

  /** Zerlegt in den zu prüfenden Teil und (bei Sätzen) das Satzzeichen am Ende. */
  function prepare(text, opts) {
    let main = splitRemark(text).main;
    let tail = '';
    if (opts && opts.sentence) {
      const m = main.match(END_PUNCT);
      if (m && m.index > 0) { tail = m[0]; main = main.slice(0, m.index); }
    }
    return { main: main, tail: tail };
  }

  /*
   * Artikel am Anfang werden ignoriert (opts.ignoreArticle = 'en' oder 'de'),
   * damit man nicht immer "the" davor schreiben muss: "house" = "the house".
   * Gilt nicht für Sätze.
   */
  const ARTICLES = {
    en: /^(?:the|a|an) (?=\S)/i,
    de: /^(?:der|die|das|ein|eine) (?=\S)/i,
  };
  function articleRe(opts) {
    if (!opts || opts.sentence || !opts.ignoreArticle) return null;
    return ARTICLES[opts.ignoreArticle] || null;
  }
  function stripArticle(text, opts) {
    const re = articleRe(opts);
    return re ? text.replace(re, '') : text;
  }

  /* ------------------------------------------------------------------
   * 1b. Kurzformen und Apostroph
   * ------------------------------------------------------------------
   * Erlaubt ist bei Kurzformen jede dieser Schreibweisen:
   *   don't  =  dont  =  don t  =  do not
   * Bei mehrdeutigen Kurzformen zählen alle Bedeutungen:
   *   he's = he is / he has,   I'd = I would / I had
   * Andere Apostrophe (Tom's, o'clock) dürfen weggelassen oder durch ein
   * Leerzeichen ersetzt werden.
   */
  const CONTRACTIONS = [
    ["don't", 'do not'], ["doesn't", 'does not'], ["didn't", 'did not'],
    ["isn't", 'is not'], ["aren't", 'are not'], ["wasn't", 'was not'], ["weren't", 'were not'],
    ["hasn't", 'has not'], ["haven't", 'have not'], ["hadn't", 'had not'],
    ["can't", 'can not'], ["couldn't", 'could not'], ["shouldn't", 'should not'],
    ["wouldn't", 'would not'], ["won't", 'will not'], ["mustn't", 'must not'],
    ["needn't", 'need not'], ["shan't", 'shall not'],
    ["I'm", 'I am'],
    ["you're", 'you are'], ["we're", 'we are'], ["they're", 'they are'],
    ["it's", 'it is|it has'], ["he's", 'he is|he has'], ["she's", 'she is|she has'],
    ["that's", 'that is|that has'], ["what's", 'what is|what has'], ["there's", 'there is|there has'],
    ["who's", 'who is|who has'], ["here's", 'here is'], ["where's", 'where is'], ["how's", 'how is'],
    ["let's", 'let us'],
    ["I've", 'I have'], ["you've", 'you have'], ["we've", 'we have'], ["they've", 'they have'],
    ["I'll", 'I will'], ["you'll", 'you will'], ["he'll", 'he will'], ["she'll", 'she will'],
    ["it'll", 'it will'], ["we'll", 'we will'], ["they'll", 'they will'], ["that'll", 'that will'],
    ["I'd", 'I would|I had'], ["you'd", 'you would|you had'], ["he'd", 'he would|he had'],
    ["she'd", 'she would|she had'], ["we'd", 'we would|we had'], ["they'd", 'they would|they had'],
  ];

  // Ohne Apostroph wären diese Formen andere echte Wörter ("its", "were", "well" …).
  // Sie zählen nur dann als Kurzform, wenn die Lösung genau diese Kurzform enthält.
  const REAL_WORDS = new Set(['its', 'were', 'hell', 'shell', 'well', 'ill', 'id', 'wed', 'shed', 'lets']);

  const NOT_LETTER_BEFORE = "(?<![\\p{L}'])";
  const NOT_LETTER_AFTER = "(?![\\p{L}'])";
  const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordRe = (alternatives, flags) => new RegExp(NOT_LETTER_BEFORE + '(?:' +
    alternatives.slice().sort((x, y) => y.length - x.length).map(escapeRe).join('|') + ')' + NOT_LETTER_AFTER, flags);

  const RULES = CONTRACTIONS.map(([short, exp]) => {
    const expansions = exp.split('|');
    const bare = short.replace("'", '');
    const shortForms = [short, short.replace("'", ' ')];
    if (!REAL_WORDS.has(bare.toLowerCase())) shortForms.push(bare);
    return {
      short: short,
      bare: bare,
      expansions: expansions,
      shortForms: shortForms.map(x => x.toLowerCase()),
      re: wordRe(shortForms.concat(expansions), 'giu'),        // alle Schreibweisen
      shortRe: wordRe([short], 'iu'),                          // nur die Kurzform mit Apostroph
      bareRe: REAL_WORDS.has(bare.toLowerCase()) ? wordRe([bare], 'gu') : null,
    };
  });

  /** Groß-/Kleinschreibung des ersten Buchstabens von `like` übernehmen. */
  function matchCase(text, like) {
    const first = like[0];
    return (first !== first.toLowerCase() ? text[0].toUpperCase() : text[0].toLowerCase()) + text.slice(1);
  }

  /** Alle Bedeutungen eines gefundenen Treffers (Kurzform → Langformen, Langform → sich selbst). */
  function meanings(rule, found) {
    const isShort = rule.shortForms.includes(found.toLowerCase());
    return (isShort ? rule.expansions : [found]).map(e => matchCase(e, found));
  }

  /**
   * Erzeugt alle gleichwertigen Langformen eines Textes, ohne Apostrophe.
   * "He's got it" → ["He is got it", "He has got it"]
   */
  function variants(text) {
    const slots = [];
    let s = text.replace(new RegExp(NOT_LETTER_BEFORE + 'cannot' + NOT_LETTER_AFTER, 'giu'),
      m => m[0] + 'an not');
    for (const rule of RULES) {
      s = s.replace(rule.re, found => {
        slots.push(meanings(rule, found));
        return '' + (slots.length - 1) + '';
      });
    }
    let results = [s];
    slots.forEach((choices, idx) => {
      const next = [];
      for (const r of results) {
        for (const c of choices) if (next.length < 64) next.push(r.replace('' + idx + '', c));
      }
      results = next;
    });
    // Übrige Apostrophe: weglassen oder Leerzeichen ist beides erlaubt
    return results.map(r => r
      .replace(/'/g, '')
      .replace(/(\p{L}) s(?!\p{L})/gu, '$1s')                       // "Tom s" = "Toms"
      .replace(/(?<!\p{L})([oO]) clock(?!\p{L})/gu, '$1clock'));    // "o clock" = "oclock"
  }

  /**
   * "its"/"were"/… in der Eingabe als Kurzform werten, wenn die Lösung genau
   * diese Kurzform ("it's"/"we're"/…) enthält.
   */
  function restoreRealWordShortForms(input, solution) {
    let s = input;
    for (const rule of RULES) {
      if (rule.bareRe && rule.shortRe.test(solution)) s = s.replace(rule.bareRe, rule.short);
    }
    return s;
  }

  /** Bereitet beide Seiten vor und liefert die Vergleichs-Varianten. */
  function comparable(input, solution, opts) {
    const b = canonical(stripArticle(prepare(solution, opts).main, opts));
    const a = restoreRealWordShortForms(canonical(stripArticle(prepare(input, opts).main, opts)), b);
    const lower = opts && opts.sentence ? (x => x.toLowerCase()) : (x => x);
    return { a: variants(a).map(lower), b: variants(b).map(lower) };
  }

  /**
   * Zählt die Eingabe als richtig?
   * Groß-/Kleinschreibung zählt bei Vokabeln, bei Sätzen nicht.
   * opts.sentence = true      → Satz: Satzzeichen am Ende und Groß-/Kleinschreibung egal.
   * opts.ignoreArticle = 'en' → the/a/an am Anfang egal; 'de' → der/die/das/ein/eine egal.
   * Kurzformen: don't = dont = don t = do not (siehe oben).
   */
  function isCorrect(input, solution, opts) {
    const c = comparable(input, solution, opts);
    return c.a.some(x => c.b.includes(x));
  }

  /**
   * Für die Zeichenmarkierung soll die Eingabe genau so angezeigt werden,
   * wie sie getippt wurde. Hat der Nutzer eine gleichwertige Schreibweise benutzt
   * ("somebody" statt "sb.", "do not" statt "don't", "Toms" statt "Tom's"),
   * wird darum die LÖSUNG auf die Schreibweise des Nutzers umgeschrieben –
   * dann gilt dieser Teil als richtig und wird grün.
   */
  function adaptSolutionToInput(input, solution) {
    let sol = solution;
    for (const fam of FAMILIES) {
      const m = input.match(fam.re);      // erste Schreibweise des Nutzers
      if (m) sol = sol.replace(fam.re, m[0]);
    }
    for (const rule of RULES) {
      // Wie hat der Nutzer diese Kurzform geschrieben?
      let typedText, typedMeanings;
      const typed = input.match(rule.re);
      if (typed) {
        typedText = typed[0];
        typedMeanings = meanings(rule, typedText);
      } else if (rule.bareRe && rule.shortRe.test(sol) && input.match(rule.bareRe)) {
        typedText = input.match(rule.bareRe)[0];   // "its" für "it's"
        typedMeanings = rule.expansions;
      } else continue;
      const lowerTyped = typedMeanings.map(x => x.toLowerCase());
      sol = sol.replace(rule.re, found =>
        meanings(rule, found).some(x => lowerTyped.includes(x.toLowerCase())) ? typedText : found);
    }
    // Apostroph in anderen Wörtern (Tom's, o'clock) weggelassen oder als Leerzeichen getippt
    sol = sol.replace(/(\p{L}+)'(\p{L}+)/gu, (m, x, y) => {
      if (wordRe([x + y], 'u').test(input)) return x + y;
      if (wordRe([x + ' ' + y], 'u').test(input)) return x + ' ' + y;
      return m;
    });
    return sol;
  }

  /* ------------------------------------------------------------------
   * 2. Damerau-Levenshtein-Alignment (Variante "Optimal String Alignment")
   * ------------------------------------------------------------------
   * a = Eingabe, b = Lösung. Ergebnis ist eine Liste von Operationen:
   *   { op: 'match',   a: 'x', b: 'x' }      Zeichen stimmt
   *   { op: 'sub',     a: 'x', b: 'y' }      falsches Zeichen (ersetzt)
   *   { op: 'extra',   a: 'x' }              überflüssiges Zeichen in der Eingabe
   *   { op: 'missing', b: 'y' }              Zeichen fehlt in der Eingabe
   *   { op: 'swap',    a: 'xy', b: 'yx' }    zwei benachbarte Zeichen vertauscht
   */
  function align(a, b, ignoreCase) {
    // Array.from zerlegt korrekt in Unicode-Zeichen. Bei ignoreCase wird auf
    // Kleinbuchstaben verglichen, angezeigt werden aber die Originalzeichen.
    const origA = Array.from(a), origB = Array.from(b);
    const A = ignoreCase ? origA.map(c => c.toLowerCase()) : origA;
    const B = ignoreCase ? origB.map(c => c.toLowerCase()) : origB;
    const n = A.length;
    const m = B.length;

    // Kosten (in Zehnteln): Eine Ersetzung ist minimal teurer als die anderen Fehler.
    // So wird bei Gleichstand ein Dreher oder eine Lücke angezeigt statt eines
    // „falschen Zeichens“ (z. B. "sht" statt "sth." → Dreher + fehlender Punkt).
    const GAP = 10, SUB = 11, SWAP = 10;

    // d[i][j] = minimale Kosten zwischen A[0..i) und B[0..j)
    const d = [];
    for (let i = 0; i <= n; i++) {
      d.push(new Array(m + 1).fill(0));
      d[i][0] = i * GAP;
    }
    for (let j = 0; j <= m; j++) d[0][j] = j * GAP;

    const canSwap = (i, j) =>
      i > 1 && j > 1 && A[i - 1] === B[j - 2] && A[i - 2] === B[j - 1] && A[i - 1] !== B[j - 1];

    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        const cost = A[i - 1] === B[j - 1] ? 0 : SUB;
        let best = Math.min(
          d[i - 1][j] + GAP,      // überflüssiges Zeichen
          d[i][j - 1] + GAP,      // fehlendes Zeichen
          d[i - 1][j - 1] + cost  // Treffer bzw. Ersetzung
        );
        if (canSwap(i, j)) best = Math.min(best, d[i - 2][j - 2] + SWAP); // Dreher
        d[i][j] = best;
      }
    }

    // Rückverfolgung vom Ende zum Anfang. Reihenfolge der Bevorzugung:
    // Treffer > Dreher > Ersetzung > fehlend > überflüssig.
    const ops = [];
    let errors = 0;   // Anzahl Fehler (jede Operation außer Treffer zählt 1)
    let i = n;
    let j = m;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && A[i - 1] === B[j - 1] && d[i][j] === d[i - 1][j - 1]) {
        ops.push({ op: 'match', a: origA[i - 1], b: origB[j - 1] });
        i--; j--;
        continue;
      }
      errors++;
      if (canSwap(i, j) && d[i][j] === d[i - 2][j - 2] + SWAP) {
        ops.push({ op: 'swap', a: origA[i - 2] + origA[i - 1], b: origB[j - 2] + origB[j - 1] });
        i -= 2; j -= 2;
      } else if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + SUB) {
        ops.push({ op: 'sub', a: origA[i - 1], b: origB[j - 1] });
        i--; j--;
      } else if (j > 0 && d[i][j] === d[i][j - 1] + GAP) {
        ops.push({ op: 'missing', b: origB[j - 1] });
        j--;
      } else {
        ops.push({ op: 'extra', a: origA[i - 1] });
        i--;
      }
    }
    ops.reverse();
    return { distance: errors, ops: ops };
  }

  /* ------------------------------------------------------------------
   * 3. Gesamtprüfung mit Markierungen für die Anzeige
   * ------------------------------------------------------------------
   * Ergebnis:
   *   correct       – zählt als richtig
   *   tooWrong      – mehr als die Hälfte falsch → keine Zeichenmarkierung zeigen
   *   distance      – Anzahl Fehler laut Alignment
   *   inputMarks    – Zeile 1: [{ ch, type }] mit type ok|wrong|extra|swap|missing
   *   solutionMarks – Zeile 2: [{ ch, type }] mit type ok|wrong|swap|missing
   *   solution      – die Lösung ohne Klammertext
   *   remark        – Klammertext der Lösung (Bemerkung), sonst ''
   *   typed         – die Eingabe, wie sie verglichen wurde
   * Zeichen, die nicht zählen (ignorierter Artikel, Satzzeichen am Satzende),
   * haben type 'neutral'.
   * opts wie bei isCorrect().
   */
  function check(input, solution, opts) {
    const pi = prepare(input, opts);
    const ps = prepare(solution, opts);
    const inp = pi.main;
    const correct = isCorrect(input, solution, opts);

    // Artikel: Hat nur eine Seite einen Artikel, wird er beim Markieren nicht verglichen,
    // sondern neutral angezeigt. ("hous" vs "the house" → nur das fehlende e ist ein Fehler)
    let inpHead = '', solHead = '', a = inp, b = ps.main;
    const re = articleRe(opts);
    if (re) {
      const ma = a.match(re), mb = b.match(re);
      if (ma && !mb) { inpHead = ma[0]; a = a.slice(ma[0].length); }
      if (mb && !ma) { solHead = mb[0]; b = b.slice(mb[0].length); }
    }
    const sol = adaptSolutionToInput(a, b);

    const result = align(a, sol, !!(opts && opts.sentence));
    const inputMarks = [];
    const solutionMarks = [];
    for (const c of Array.from(inpHead)) inputMarks.push({ ch: c, type: 'neutral' });
    for (const c of Array.from(solHead)) solutionMarks.push({ ch: c, type: 'neutral' });

    for (const o of result.ops) {
      switch (o.op) {
        case 'match':
          inputMarks.push({ ch: o.a, type: 'ok' });
          solutionMarks.push({ ch: o.b, type: 'ok' });
          break;
        case 'sub':
          inputMarks.push({ ch: o.a, type: 'wrong' });
          solutionMarks.push({ ch: o.b, type: 'wrong' });
          break;
        case 'extra':
          inputMarks.push({ ch: o.a, type: 'extra' });
          break;
        case 'missing':
          inputMarks.push({ ch: '-', type: 'missing' });
          solutionMarks.push({ ch: o.b, type: 'missing' });
          break;
        case 'swap':
          for (const c of Array.from(o.a)) inputMarks.push({ ch: c, type: 'swap' });
          for (const c of Array.from(o.b)) solutionMarks.push({ ch: c, type: 'swap' });
          break;
      }
    }

    // Satzzeichen am Satzende zählen bei Sätzen nicht → neutral anzeigen
    for (const c of Array.from(pi.tail)) inputMarks.push({ ch: c, type: 'neutral' });
    for (const c of Array.from(ps.tail)) solutionMarks.push({ ch: c, type: 'neutral' });

    const solLength = Array.from(sol).length;
    const distance = correct ? 0 : result.distance;
    const tooWrong = !correct && (a.length === 0 || distance > solLength / 2);

    return {
      correct: correct,
      tooWrong: tooWrong,
      distance: distance,
      inputMarks: inputMarks,
      solutionMarks: solutionMarks,
      solution: ps.main + ps.tail,
      remark: splitRemark(solution).remark,
      typed: inp + pi.tail,
    };
  }

  global.VokabelCompare = {
    normalizeBasic: normalizeBasic,
    canonical: canonical,
    splitRemark: splitRemark,
    isCorrect: isCorrect,
    align: align,
    check: check,
  };
})(window);
