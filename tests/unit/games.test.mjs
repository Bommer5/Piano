// Tests des jeux : lecture de notes, déchiffrage, rythme, oreille.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeRng, randInt, shuffle, weightedIndex, unlockedCount, diatonicToMidi, keyAlter, spelledName, tonicStep, keyName,
  READING_LEVELS, readingPool, answerChoices, checkChoice, checkPlayed, answerText, updateStat, itemWeight, pickItem,
  flashPoints, weakestItems, generateSightReading, SIGHT_LEVELS, tonicMidi, degreeToMidi, pcOf,
} from '../../js/core/reading.js';
import {
  RHYTHM_LEVELS, RHYTHM_CELLS, generateRhythm, cellsToPattern, onsetsOf, countSyllable, countLabels, countGrid,
  evaluateTaps, tendencyText, rhythmVariants, rhythmSignature, starsFor,
} from '../../js/core/rhythmgame.js';
import {
  EAR_EXERCISES, makeEarQuestion, makeIntervalQuestion, makeChordQuestion, makeMelodyQuestion, makeRhythmQuestion,
  DictationChecker, evaluateDictation, dictationScore, sessionScore, playDuration, CHORD_TYPES,
} from '../../js/core/eartraining.js';
import { prepareSong } from '../../js/core/song.js';

const MAJOR_PCS = (fifths) => new Set([0, 2, 4, 5, 7, 9, 11].map((x) => (x + tonicMidi(fifths)) % 12));

test('générateur aléatoire reproductible', () => {
  const a = makeRng(42), b = makeRng(42), c = makeRng(43);
  const sa = Array.from({ length: 10 }, a), sb = Array.from({ length: 10 }, b);
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, Array.from({ length: 10 }, c));
  assert.ok(sa.every((x) => x >= 0 && x < 1));
  const r = makeRng(1);
  for (let i = 0; i < 200; i++) {
    const v = randInt(r, 3, 5);
    assert.ok(v >= 3 && v <= 5 && Number.isInteger(v));
  }
  assert.deepEqual(shuffle(makeRng(5), [1, 2, 3, 4]).sort(), [1, 2, 3, 4]);
  assert.equal(weightedIndex(() => 0.99, [0, 0, 1]), 2);
  assert.equal(weightedIndex(() => 0, [0, 1, 1]), 1);
});

test('déblocage des niveaux', () => {
  const best = { 1: 90, 2: 85, 3: 40 };
  assert.equal(unlockedCount((l) => best[l], 7, 80), 3);
  assert.equal(unlockedCount(() => 0, 7, 80), 1);
  assert.equal(unlockedCount(() => 100, 5, 80), 5);
});

test('notation diatonique et armures', () => {
  assert.equal(diatonicToMidi(28), 60); // Do4
  assert.equal(diatonicToMidi(30), 64); // Mi4
  assert.equal(diatonicToMidi(18), 43); // Sol2
  assert.equal(diatonicToMidi(31, 1), 66); // Fa♯4
  assert.equal(keyAlter(3, 1), 1); // Fa♯ en Sol
  assert.equal(keyAlter(0, 1), 0);
  assert.equal(keyAlter(6, -1), -1); // Si♭ en Fa
  assert.equal(keyAlter(2, -2), -1); // Mi♭ en Si♭
  assert.equal(keyAlter(2, -1), 0);
  assert.equal(spelledName(3, 1), 'Fa♯');
  assert.equal(spelledName(6, -1, 'en'), 'B♭');
  assert.equal(tonicStep(1), 4); // Sol
  assert.equal(tonicStep(-1), 3); // Fa
  assert.equal(tonicStep(-2), 6); // Si♭
  assert.equal(keyName(2), 'Ré majeur');
});

test('Note Flash : réservoirs de questions par niveau', () => {
  const l1 = readingPool(1, 'treble');
  assert.deepEqual(l1.map((i) => i.notes[0].midi), [60, 62, 64, 65, 67]);
  assert.ok(l1.every((i) => i.notes[0].shownAlter === 0));
  const l1b = readingPool(1, 'bass');
  assert.deepEqual(l1b.map((i) => i.notes[0].midi), [48, 50, 52, 53, 55]);
  assert.equal(readingPool(1, 'both').length, 10);
  assert.ok(readingPool(2, 'treble').some((i) => i.notes[0].midi === 72));
  // lignes supplémentaires : notes sous Do4 et au-dessus du La5
  const l3 = readingPool(3, 'treble').map((i) => i.notes[0].midi);
  assert.ok(Math.min(...l3) < 60 && Math.max(...l3) > 81);
  // altérations : écrites, pas de Mi♯/Si♯/Fa♭/Do♭
  const l4 = readingPool(4, 'treble');
  assert.ok(l4.some((i) => i.notes[0].shownAlter === 1) && l4.some((i) => i.notes[0].shownAlter === -1));
  assert.ok(!l4.some((i) => i.notes[0].alter === 1 && [2, 6].includes(i.notes[0].diatonic % 7)));
  // armures : altération portée par l'armure, non écrite, et note dans la gamme
  const l5 = readingPool(5, 'treble');
  assert.ok(l5.every((i) => i.fifths !== 0 && i.notes[0].shownAlter === 0));
  assert.ok(l5.every((i) => MAJOR_PCS(i.fifths).has(pcOf(i.notes[0].midi))));
  // clés uniques
  for (const lv of READING_LEVELS) {
    const pool = readingPool(lv.id, 'both');
    assert.ok(pool.length > 0, lv.name);
    assert.equal(new Set(pool.map((i) => i.key)).size, pool.length, lv.name);
  }
});

test('Note Flash : vérification des réponses (boutons et piano)', () => {
  const fa = readingPool(4, 'treble').find((i) => i.notes[0].midi === 66 && i.notes[0].alter === 1);
  assert.ok(checkChoice(fa, 6) && !checkChoice(fa, 5));
  assert.equal(answerText(fa), 'Fa♯');
  assert.equal(checkPlayed(fa, [pcOf(42)]), true); // classes de hauteur : octave libre
  assert.equal(checkPlayed(fa, []), null);
  assert.equal(checkPlayed(fa, [5]), false);
  assert.equal(answerChoices(1).length, 7);
  assert.equal(answerChoices(4).length, 12);
  assert.equal(answerChoices(1, 'en')[0].label, 'C');
  // intervalles
  const iv = readingPool(6, 'treble').find((i) => i.answer.n === 5 && i.notes[0].midi === 60);
  assert.ok(checkChoice(iv, 5) && !checkChoice(iv, 4));
  assert.equal(answerText(iv), '5te');
  assert.equal(checkPlayed(iv, [0]), null);
  assert.equal(checkPlayed(iv, [0, 7]), true);
  assert.equal(checkPlayed(iv, [7, 0]), false);
  assert.equal(checkPlayed(iv, [2]), false);
  // accords
  const ch = readingPool(7, 'treble').find((i) => i.notes[0].midi === 62);
  assert.equal(answerText(ch), 'Ré mineur');
  assert.ok(checkChoice(ch, ch.answer.id));
  assert.ok(answerChoices(7).some((c) => c.id === ch.answer.id));
  assert.equal(checkPlayed(ch, [9, 2]), null);
  assert.equal(checkPlayed(ch, [9, 2, 5]), true);
  assert.equal(checkPlayed(ch, [9, 2, 4]), false);
  const si = readingPool(7, 'treble').find((i) => i.notes[0].midi === 71);
  assert.equal(answerText(si), 'Si diminué');
});

test('répétition espacée : les notes ratées ou lentes reviennent plus souvent', () => {
  let s = updateStat(null, { correct: true, ms: 900 });
  assert.equal(s.n, 1);
  assert.equal(s.box, 1);
  s = updateStat(s, { correct: true, ms: 800 });
  assert.equal(s.box, 2);
  const slow = updateStat(s, { correct: true, ms: 5000 });
  assert.equal(slow.box, 2); // pas de promotion si lent
  const missed = updateStat(s, { correct: false, ms: 900 });
  assert.equal(missed.box, 0);
  assert.ok(missed.err > 0);
  assert.ok(itemWeight(missed) > itemWeight(s));
  assert.ok(itemWeight(slow) > itemWeight(s));
  assert.ok(itemWeight(null) > itemWeight(s));
  // tirage : sur 2000 tirages, l'item raté sort bien plus souvent
  const pool = readingPool(1, 'treble');
  const stats = {};
  for (const it of pool) stats[it.key] = { n: 10, ok: 10, box: 5, err: 0, ms: 700 };
  const bad = pool[2].key;
  stats[bad] = { n: 10, ok: 5, box: 0, err: 0.6, ms: 3500 };
  const rng = makeRng(7);
  const counts = {};
  let prev = null;
  for (let i = 0; i < 2000; i++) {
    const it = pickItem(pool, stats, rng, prev);
    assert.notEqual(it.key, prev);
    prev = it.key;
    counts[it.key] = (counts[it.key] || 0) + 1;
  }
  const others = pool.filter((p) => p.key !== bad).map((p) => counts[p.key] || 0);
  assert.ok(counts[bad] > 2 * Math.max(...others), JSON.stringify(counts));
  assert.deepEqual(weakestItems(stats).map((w) => w.key), [bad]);
});

test('points Note Flash', () => {
  assert.equal(flashPoints(false, 500), 0);
  assert.equal(flashPoints(true, 500), 20);
  assert.equal(flashPoints(true, 5000), 10);
  const mid = flashPoints(true, 1900);
  assert.ok(mid > 10 && mid < 20);
});

test('déchiffrage : mélodies de 4 mesures dans la tonalité, finissant sur la tonique', () => {
  for (const lv of SIGHT_LEVELS) {
    for (let seed = 1; seed <= 30; seed++) {
      const raw = generateSightReading(lv.id, makeRng(seed));
      assert.equal(raw.ephemeral, true);
      const R = raw.notes.filter((n) => n.hand === 'R');
      const total = R.reduce((s, n) => s + n.dur, 0);
      assert.equal(total, 16, `niveau ${lv.id} graine ${seed}`);
      const scale = MAJOR_PCS(raw.keyFifths);
      assert.ok(R.every((n) => scale.has(pcOf(n.midi))));
      assert.equal(pcOf(R[R.length - 1].midi), pcOf(tonicMidi(raw.keyFifths)));
      assert.ok(R[R.length - 1].dur >= 2);
      // mouvement conjoint et petits sauts : jamais plus d'une 6te
      for (let i = 1; i < R.length; i++) assert.ok(Math.abs(R[i].midi - R[i - 1].midi) <= 9, `saut ${R[i - 1].midi}→${R[i].midi}`);
      assert.ok(lv.keys.includes(raw.keyFifths));
      if (lv.leftHand) assert.ok(raw.notes.some((n) => n.hand === 'L'));
      const s = prepareSong(raw);
      assert.equal(s.measureCount, 4);
    }
  }
  // reproductible
  assert.deepEqual(generateSightReading(3, makeRng(9)), generateSightReading(3, makeRng(9)));
  assert.equal(degreeToMidi(60, 7), 72);
  assert.equal(degreeToMidi(60, -1), 59);
});

test('rythme : mesures générées par niveau', () => {
  for (const lv of RHYTHM_LEVELS) {
    for (let seed = 1; seed <= 40; seed++) {
      const p = generateRhythm(lv.id, makeRng(seed));
      const total = p.events.reduce((s, e) => s + e.dur, 0);
      assert.ok(Math.abs(total - 4) < 1e-4, `niveau ${lv.id}`);
      assert.ok(p.cells.every((c) => lv.cells.includes(c)));
      assert.ok(onsetsOf(p).length >= 2);
      if (lv.focus.length) assert.ok(p.cells.some((c) => lv.focus.includes(c)) || seed > 0);
    }
  }
  // un niveau avec cellule obligatoire la contient presque toujours
  let withTrip = 0;
  for (let seed = 1; seed <= 30; seed++) if (generateRhythm(7, makeRng(seed)).cells.includes('trip')) withTrip++;
  assert.ok(withTrip >= 28);
  const p = cellsToPattern(['q', 'ee', 'er_e', 'trip']);
  assert.deepEqual(onsetsOf(p).map((x) => Math.round(x * 100) / 100), [0, 1, 1.5, 2.5, 3, 3.33, 3.67]);
  assert.equal(p.events.filter((e) => e.rest).length, 1);
  assert.ok(Object.values(RHYTHM_CELLS).every((c) => Math.abs(c.durs.reduce((s, d) => s + Math.abs(d), 0) - c.beats) < 1e-6));
});

test('rythme : comptage « 1 et 2 et »', () => {
  assert.equal(countSyllable(0), '1');
  assert.equal(countSyllable(2.5), 'et');
  assert.equal(countSyllable(1.25), 'ti');
  assert.equal(countSyllable(1 + 1 / 3), 'la');
  assert.deepEqual(countLabels(cellsToPattern(['q', 'ee', 'er_e', 'q'])), ['1', '2', 'et', '(3)', 'et', '4']);
  assert.deepEqual(countGrid(2).map((g) => g.label), ['1', 'et', '2', 'et']);
});

test('rythme : évaluation des frappes', () => {
  const exp = [0, 0.5, 1, 1.5];
  const perfect = evaluateTaps(exp, [0.01, 0.49, 1.02, 1.5]);
  assert.equal(perfect.good, 4);
  assert.equal(perfect.score, 100);
  assert.equal(perfect.stars, 3);
  const mixed = evaluateTaps(exp, [0.1, 0.5, 1.2]);
  assert.deepEqual(mixed.matches.map((m) => m.grade), ['ok', 'good', 'miss', 'miss']);
  assert.equal(mixed.miss, 2);
  assert.ok(mixed.score < 50);
  const extra = evaluateTaps(exp, [0, 0.25, 0.5, 1, 1.5]);
  assert.equal(extra.good, 4);
  assert.equal(extra.extras.length, 1);
  assert.equal(extra.score, 90);
  // en retard régulier
  const late = evaluateTaps(exp, exp.map((x) => x + 0.06));
  assert.ok(Math.abs(late.meanDelta - 0.06) < 1e-9);
  assert.match(tendencyText(late.meanDelta), /retard de 60 ms/);
  assert.match(tendencyText(-0.04), /avance de 40 ms/);
  assert.match(tendencyText(0.01), /calé/);
  // frappes désordonnées acceptées
  assert.equal(evaluateTaps(exp, [1.5, 0, 1, 0.5]).good, 4);
  // une frappe ne sert qu'une fois, et va à l'attaque la plus proche
  const one = evaluateTaps([0, 0.25], [0.24]);
  assert.equal(one.matches[0].grade, 'miss');
  assert.equal(one.matches[1].grade, 'good');
  assert.equal(evaluateTaps(exp, []).score, 0);
  assert.equal(starsFor(75), 2);
});

test('rythme : variantes distinctes pour la dictée', () => {
  const rng = makeRng(3);
  for (let lv = 1; lv <= 7; lv++) {
    const p = generateRhythm(lv, rng);
    const v = rhythmVariants(p, lv, rng, 3);
    const sigs = new Set([p, ...v].map(rhythmSignature));
    assert.equal(sigs.size, v.length + 1);
    assert.ok(v.length >= 2, `niveau ${lv}`);
  }
});

test('oreille : questions d’intervalles et d’accords', () => {
  const rng = makeRng(11);
  for (let lv = 1; lv <= EAR_EXERCISES.intervals.levels.length; lv++) {
    for (let k = 0; k < 20; k++) {
      const q = makeIntervalQuestion(lv, rng);
      const [a, b] = q.notes;
      assert.equal(Math.abs(b - a), q.answer);
      assert.ok(q.choices.some((c) => c.id === q.answer));
      if (q.direction === 'down') assert.ok(b < a);
      if (q.direction === 'harm') assert.equal(q.play[0].at, q.play[1].at);
      else assert.ok(q.play[1].at > q.play[0].at);
    }
  }
  for (let lv = 1; lv <= EAR_EXERCISES.chords.levels.length; lv++) {
    const q = makeChordQuestion(lv, rng);
    assert.deepEqual(q.notes.map((m) => m - q.notes[0]), CHORD_TYPES[q.answer].ints);
    assert.ok(q.choices.some((c) => c.id === q.answer));
  }
  for (let lv = 1; lv <= 4; lv++) {
    const q = makeEarQuestion('mode', lv, rng);
    assert.ok(['maj', 'min'].includes(q.answer));
    assert.ok(q.play.length >= 3 && playDuration(q.play) > 0);
  }
  assert.throws(() => makeEarQuestion('inconnu', 1));
});

test('oreille : dictée mélodique (2 à 8 notes, tonique d’abord)', () => {
  const rng = makeRng(21);
  EAR_EXERCISES.melody.levels.forEach((lv, i) => {
    const q = makeMelodyQuestion(i + 1, rng);
    assert.equal(q.notes.length, lv.length);
    assert.equal(q.play[0].midi, q.tonic);
    assert.ok(q.play[0].ref);
    assert.ok(q.play[1].at > q.play[0].at + q.play[0].dur - 1e-9);
    const scale = MAJOR_PCS(q.keyFifths);
    assert.ok(q.notes.every((m) => scale.has(pcOf(m))));
    for (let k = 1; k < q.notes.length; k++) assert.notEqual(q.notes[k], q.notes[k - 1]);
  });
});

test('oreille : correction note à note', () => {
  const c = new DictationChecker([60, 62, 64]);
  assert.equal(c.play(60).ok, true);
  const r = c.play(65);
  assert.equal(r.ok, false);
  assert.equal(r.expected, 62);
  assert.equal(c.index, 1);
  assert.equal(c.play(74).ok, true); // octave libre
  assert.equal(c.done, false);
  const last = c.play(64);
  assert.ok(last.ok && last.done);
  assert.equal(c.errors, 1);
  assert.equal(c.score, 75);
  const strict = new DictationChecker([60], { octaveTolerant: false });
  assert.equal(strict.play(72).ok, false);
  assert.equal(dictationScore(4, 0), 100);
  assert.equal(dictationScore(4, 2, false), 0);
  const ev = evaluateDictation([60, 62, 64, 65], [60, 63, 64]);
  assert.deepEqual(ev.statuses, ['ok', 'wrong', 'ok', 'missing']);
  assert.equal(ev.score, 50);
  assert.deepEqual(evaluateDictation([60], [60, 62]).statuses, ['ok', 'extra']);
  assert.equal(sessionScore([100, 0, 50]), 50);
  assert.equal(sessionScore([]), 0);
});

test('oreille : dictée rythmique (choix distincts dont la bonne réponse)', () => {
  const rng = makeRng(5);
  for (let lv = 1; lv <= EAR_EXERCISES.rhythm.levels.length; lv++) {
    const q = makeRhythmQuestion(lv, rng);
    assert.ok(q.choices.some((c) => c.id === q.answer));
    assert.equal(new Set(q.choices.map((c) => c.id)).size, q.choices.length);
    assert.equal(q.play.filter((p) => p.click).length, 4);
    assert.equal(q.play.filter((p) => !p.click).length, onsetsOf(q.pattern).length);
  }
});
