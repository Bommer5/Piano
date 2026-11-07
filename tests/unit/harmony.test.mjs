// Tests : harmonie (symboles, reconnaissance, degrés, voicings, grilles), théorie (tonalité,
// accords par mesure, cadences, carrure, quiz), édition (opérations, quantification, historique,
// doigtés personnalisés) et partage par lien (aller-retour).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as H from '../../js/core/harmony.js';
import * as T from '../../js/core/theory.js';
import * as E from '../../js/core/edit.js';
import * as Sh from '../../js/core/share.js';
import { prepareSong } from '../../js/core/song.js';
import { SONGS, getSong } from '../../js/data/songs.js';

const pcs = (s) => H.parseChord(s)?.pcs.join(',');

test('harmony : symboles -> classes de hauteurs', () => {
  const cases = {
    C: '0,4,7', Cm: '0,3,7', C7: '0,4,7,10', Cmaj7: '0,4,7,11', CM7: '0,4,7,11', 'CΔ': '0,4,7,11', Cm7: '0,3,7,10', 'C-7': '0,3,7,10',
    Cdim: '0,3,6', 'C°': '0,3,6', Cdim7: '0,3,6,9', Cm7b5: '0,3,6,10', 'Cø': '0,3,6,10', Caug: '0,4,8', 'C+': '0,4,8',
    Csus2: '0,2,7', Csus4: '0,5,7', Csus: '0,5,7', C6: '0,4,7,9', Cm6: '0,3,7,9', C9: '0,2,4,7,10', Cmaj9: '0,2,4,7,11', Cm9: '0,2,3,7,10',
    C11: '0,2,4,5,7,10', C13: '0,2,4,7,9,10', Cadd9: '0,2,4,7', Cmadd9: '0,2,3,7', 'C6/9': '0,2,4,7,9',
    C7b9: '0,1,4,7,10', 'C7#9': '0,3,4,7,10', 'C7#11': '0,4,6,7,10', C7b13: '0,4,7,8,10', 'C7(b9,#11)': '0,1,4,6,7,10',
    'C7#5': '0,4,8,10', C7sus4: '0,5,7,10', CmMaj7: '0,3,7,11', C5: '0,7',
    Bb7: '2,5,8,10', 'F#m7b5': '0,4,6,9', Ebmaj7: '2,3,7,10', 'Do': '0,4,7', 'Rém7': '0,2,5,9', 'Sib7': '2,5,8,10',
  };
  for (const [s, p] of Object.entries(cases)) assert.equal(pcs(s), p, s);
  const sl = H.parseChord('Dm7/F');
  assert.equal(sl.root, 2);
  assert.equal(sl.bass, 5);
  assert.equal(sl.bassName, 'F');
  assert.equal(H.parseChord('C/Bb').bass, 10);
  assert.deepEqual(H.chordPcs('C/Bb'), [0, 4, 7, 10]);
  assert.equal(H.parseChord('C6/9').bass, null);
  for (const bad of ['', 'H7', 'Cxyz', 'c', 'b', '7']) assert.equal(H.parseChord(bad), null, bad);
});

test('harmony : reconnaissance d’accords et renversements', () => {
  const id = (a, o) => H.identifyChord(a, o)?.symbol;
  assert.equal(id([60, 64, 67]), 'C');
  assert.equal(id([64, 67, 72]), 'C/E');
  assert.equal(id([67, 72, 76]), 'C/G');
  assert.equal(id([57, 60, 64]), 'Am');
  assert.equal(id([53, 57, 62]), 'Dm/F');
  assert.equal(id([55, 59, 62, 65]), 'G7');
  assert.equal(id([59, 62, 65, 67]), 'G7/B');
  assert.equal(id([62, 65, 69, 72]), 'Dm7');
  assert.equal(id([48, 52, 55, 59]), 'Cmaj7');
  assert.equal(id([60, 63, 66, 69]), 'Cdim7');
  assert.equal(id([59, 62, 65, 69]), 'Bm7b5');
  assert.equal(id([60, 64, 68]), 'Caug');
  assert.equal(id([60, 65, 67]), 'Csus4');
  assert.equal(id([48, 55, 64, 70, 74]), 'C9');
  assert.equal(id([60, 64, 67, 69]), 'C6');
  assert.equal(id([60, 64, 67, 74]), 'Cadd9');
  assert.equal(id([65, 69, 72, 76]), 'Fmaj7');
  assert.equal(id([58, 62, 65], { flats: true }), 'Bb');
  assert.equal(id([60]), 'C');
  assert.equal(H.identifyChord([]), null);
  assert.equal(H.identifyChord([64, 67, 72]).inversion, 1);
  assert.equal(H.identifyChord([67, 72, 76]).inversion, 2);
  assert.equal(H.identifyChord([53, 55, 59, 62]).inversion, 3); // G7/F
  assert.equal(H.inversion([64, 67, 72], 'C'), 1);
  assert.equal(H.inversion([60, 64, 67], 'C'), 0);
  assert.equal(H.INVERSION_NAMES[1], '1er renversement');
  // classes de hauteurs seules (sans basse) : pas de « / »
  assert.ok(H.identifyChord([0, 4, 7]).symbol === 'C');
});

test('harmony : correspondance jeu / accord attendu', () => {
  const ok = (p, s, o) => H.chordMatches(p, s, o).ok;
  assert.ok(ok([60, 64, 67], 'C'));
  assert.ok(ok([64, 67, 72], 'C'), 'renversement libre');
  assert.ok(ok([52, 60, 67, 76], 'C'), 'voicing écarté');
  assert.ok(ok([60, 64, 70], 'C7'), 'quinte facultative');
  assert.ok(!ok([60, 64], 'C'), 'triade incomplète');
  assert.ok(ok([60, 64, 67, 74], 'C'), '9e tolérée');
  assert.ok(!ok([60, 64, 67, 74], 'C', { tolerateExtensions: false }));
  assert.ok(!ok([60, 64, 67, 71], 'C'), 'septième majeure non tolérée sur une triade');
  assert.ok(ok([60, 64, 70, 61], 'C7'), 'b9 tolérée sur dominante');
  assert.ok(!ok([64, 70, 74], 'C9'), 'fondamentale exigée par défaut');
  assert.ok(ok([64, 70, 74], 'C9', { allowRootless: true }), 'fondamentale omise en option');
  assert.ok(ok([52, 58, 62], 'C7', { allowRootless: true }));
  assert.ok(!ok([60, 63, 67], 'C'));
  assert.ok(ok([53, 62, 65, 69, 72], 'Dm7/F', { requireBass: true }));
  assert.ok(!ok([50, 62, 65, 69, 72], 'Dm7/F', { requireBass: true }));
  assert.ok(ok([0, 4, 7], 'C'), 'classes de hauteurs (micro)');
  const r = H.chordMatches([60, 64, 66], 'C');
  assert.deepEqual(r.missing, [7]);
  assert.deepEqual(r.extra, [6]);
  assert.ok(!H.chordMatches([], 'C').ok);
  assert.ok(!H.chordMatches([60], 'zz').ok);
});

test('harmony : tonalités, degrés et fonctions', () => {
  const C = { tonic: 0, mode: 'major' };
  const rn = (s, k = C) => H.romanNumeral(s, k).roman;
  assert.equal(rn('C'), 'I');
  assert.equal(rn('Dm7'), 'ii7');
  assert.equal(rn('Em'), 'iii');
  assert.equal(rn('F'), 'IV');
  assert.equal(rn('G7'), 'V7');
  assert.equal(rn('Am'), 'vi');
  assert.equal(rn('Bm7b5'), 'viiø7');
  assert.equal(rn('Bdim'), 'vii°');
  assert.equal(rn('Cmaj7'), 'Imaj7');
  assert.equal(rn('D7'), 'V7/V');
  assert.equal(rn('A7'), 'V7/ii');
  assert.equal(rn('E7'), 'V7/vi');
  assert.equal(rn('Bb'), '♭VII');
  assert.equal(rn('Fm'), 'iv');
  const am = { tonic: 9, mode: 'minor' };
  assert.equal(rn('Am', am), 'i');
  assert.equal(rn('E7', am), 'V7');
  assert.equal(rn('Dm', am), 'iv');
  assert.equal(rn('F', am), 'VI');
  assert.equal(rn('C', am), 'III');
  assert.equal(rn('G#dim7', am), 'vii°7');
  assert.equal(H.romanNumeral('G7', C).func, 'D');
  assert.equal(H.romanNumeral('F', C).func, 'SD');
  assert.equal(H.romanNumeral('Am', C).func, 'T');
  assert.equal(H.romanNumeral('G7', C).degree, 5);
  assert.equal(H.romanNumeral('Dm7', C).diatonic, true);
  assert.equal(H.romanNumeral('D7', C).diatonic, false);
  // armures
  assert.deepEqual(H.keyFromFifths(0), { tonic: 0, mode: 'major', fifths: 0 });
  assert.equal(H.keyFromFifths(-3).tonic, 3);
  assert.equal(H.keyFromFifths(1, 'minor').tonic, 4);
  assert.equal(H.fifthsOfKey({ tonic: 9, mode: 'minor' }), 0);
  assert.equal(H.fifthsOfKey({ tonic: 5, mode: 'major' }), -1);
  assert.equal(H.fifthsOfKey({ tonic: 2, mode: 'minor' }), -1);
  assert.equal(H.keyName({ tonic: 3, mode: 'major' }), 'Mi♭ majeur');
  assert.equal(H.keyName({ tonic: 4, mode: 'minor' }), 'mi mineur');
  assert.equal(H.keyName({ tonic: 7, mode: 'major' }, { lang: 'en' }), 'G major');
  // accords diatoniques
  assert.equal(H.diatonicChord(C, 2, { seventh: true }), 'Dm7');
  assert.equal(H.diatonicChord(C, 5, { seventh: true }), 'G7');
  assert.equal(H.diatonicChord(C, 7), 'Bdim');
  assert.equal(H.diatonicChord(am, 5, { seventh: true }), 'E7');
  assert.equal(H.romanToChord('ii7', C), 'Dm7');
  assert.equal(H.romanToChord('V7', { tonic: 5, mode: 'major' }), 'C7');
  assert.equal(H.romanToChord('viiø7', C), 'Bm7b5');
  assert.equal(H.romanToChord('♭VII', C), 'Bb');
});

test('harmony : voicings', () => {
  const v = H.voicing('Cmaj7');
  assert.deepEqual(v.notes.map(H.mod12), [0, 4, 7, 11]);
  assert.equal(H.mod12(v.bass), 0);
  assert.ok(v.bass < v.notes[0]);
  const sh = H.voicing('G7', { type: 'shell' });
  assert.deepEqual(sh.notes.map((n) => H.mod12(n - sh.notes[0])), [0, 4, 10]);
  const slash = H.voicing('C/E');
  assert.equal(H.mod12(slash.bass), 4);
  const big = H.voicing('C13', { maxNotes: 4 });
  assert.ok(big.notes.length <= 4);
  // renversement le plus proche : mouvement minimal
  const prog = H.voiceProgression(['Dm7', 'G7', 'Cmaj7'], { type: 'nearest' });
  for (let i = 1; i < prog.length; i++) {
    const a = prog[i - 1].notes, b = prog[i].notes;
    const move = b.reduce((s, n) => s + Math.min(...a.map((x) => Math.abs(x - n))), 0);
    assert.ok(move <= 4, `mouvement ${move} trop grand`);
    assert.ok(Math.max(...b) - Math.min(...b) <= 12, 'position serrée');
  }
  for (const v2 of prog) for (const n of v2.notes) assert.ok(n >= 48 && n <= 80);
  assert.equal(H.nearestMidi(0, 62), 60);
  assert.equal(H.nearestMidi(7, 62), 67);
  assert.deepEqual(H.voicing('zz').notes, []);
});

test('harmony : grilles d’accords en texte, transposition', () => {
  const p = H.parseProgression('| Dm7 G7 | Cmaj7 % |\n| % | C . . F |');
  assert.equal(p.errors.length, 0);
  assert.equal(p.measures.length, 4);
  assert.deepEqual(p.measures[0].chords.map((c) => [c.symbol, c.beats]), [['Dm7', 2], ['G7', 2]]);
  assert.deepEqual(p.measures[1].chords.map((c) => [c.symbol, c.beats]), [['Cmaj7', 4]]);
  assert.deepEqual(p.measures[2].chords.map((c) => c.symbol), ['Cmaj7']);
  assert.deepEqual(p.measures[3].chords.map((c) => [c.symbol, c.beats]), [['C', 3], ['F', 1]]);
  assert.equal(p.items.length, 6);
  assert.equal(p.items[5].start, 15);
  const bad = H.parseProgression('| C Xyz | % |');
  assert.equal(bad.errors.length, 1);
  assert.equal(bad.measures.length, 2);
  assert.equal(H.parseProgression('|: C | G :|| Am |').measures.length, 3);
  assert.equal(H.parseProgression('| C D E |', { beatsPerMeasure: 3 }).items[2].beats, 1);
  assert.equal(H.progressionToText(p.measures), '| Dm7 G7 | Cmaj7 | % | C F |');
  assert.equal(H.transposeProgression('| Dm7 G7 | Cmaj7/E % |', 3), '| Fm7 Bb7 | Ebmaj7/G % |');
  assert.equal(H.transposeChord('F#m7b5', 1), 'Gm7b5');
  assert.equal(H.transposeChord('C', 6), 'F#');
  assert.equal(H.transposeChord('C7', 2, { flats: true }), 'D7');
  for (const g of H.EXAMPLE_GRIDS) assert.equal(H.parseProgression(g.text).errors.length, 0, g.id);
  assert.equal(H.parseProgression(H.EXAMPLE_GRIDS.find((g) => g.id === 'blues').text).measures.length, 12);
});

// ---------- théorie ----------
function mk(tracks, extra = {}) {
  return prepareSong({ title: 't', tracks, ...extra });
}

test('théorie : estimation de tonalité (Krumhansl)', () => {
  const cMaj = T.estimateKey(mk({ R: 'C4 D4 E4 F4 G4 A4 B4 C5 G4 E4 C4:2' }).notes);
  assert.deepEqual([cMaj.tonic, cMaj.mode], [0, 'major']);
  const aMin = T.estimateKey(mk({ R: 'A3 B3 C4 D4 E4 F4 G#4 A4 E4 C4 A3:2', L: 'A2:4 E2:4 A2:4' }).notes);
  assert.deepEqual([aMin.tonic, aMin.mode], [9, 'minor']);
  const gMaj = T.estimateKey(mk({ R: 'G4 A4 B4 C5 D5 E5 F#5 G5 D5 B4 G4:2', L: 'G2:4 D3:4 G2:4' }).notes);
  assert.deepEqual([gMaj.tonic, gMaj.mode], [7, 'major']);
  const ebMaj = T.estimateKey(mk({ R: 'Eb4 F4 G4 Ab4 Bb4 C5 D5 Eb5 Bb4 G4 Eb4:2', L: 'Eb3:4 Bb2:4 Eb3:4' }).notes);
  assert.equal(ebMaj.tonic, 3);
  assert.equal(T.rankKeys([]).length, 24);
  // armure fournie : respectée, mode déduit
  const s = mk({ R: 'A3 C4 E4 A4 G#4 B4 E4 A3:2', L: 'A2:4 E2:4 A2:4' }, { keyFifths: 0 });
  const k = T.songKey(s);
  assert.deepEqual([k.tonic, k.mode], [9, 'minor']);
  assert.equal(T.songKey(mk({ R: 'C4 E4 G4' }, { keyFifths: 0, keyMode: 'minor' })).mode, 'minor');
  // armure par défaut (0) mais notes nettement en Ré majeur : estimation
  const d = T.songKey(mk({ R: 'D4 E4 F#4 G4 A4 B4 C#5 D5 A4 F#4 D4:2', L: 'D3:4 A2:4 D3:4' }));
  assert.deepEqual([d.tonic, d.mode, d.source], [2, 'major', 'estimation']);
});

test('théorie : accords par mesure (main gauche), degrés, cadences', () => {
  const s = mk({
    R: 'E4:4 | F4:4 | D4:4 | E4:4 | E4:2 D4:2 | C4:4 | B3:4 | C4:4',
    L: 'C3+G3:4 | F2+C3+A3:4 | G2+D3+F3:4 | C3+G3:4 | A2+C3+E3:4 | F2+A2+C3:4 | G2+D3+F3:4 | C3+G3+E3:4',
  });
  const an = T.analyzeSong(s);
  assert.equal(an.keyName, 'Do majeur');
  const syms = an.chords.map((c) => c.symbol);
  assert.deepEqual(syms, ['C', 'F', 'G7', 'C', 'Am', 'F', 'G7', 'C']);
  assert.deepEqual(an.chords.map((c) => c.roman), ['I', 'IV', 'V7', 'I', 'vi', 'IV', 'V7', 'I']);
  const types = an.cadences.map((c) => `${c.type}@${c.measure}`);
  assert.ok(types.includes('parfaite@3'), types.join());
  assert.ok(types.includes('parfaite@7'), types.join());
  // demi-cadence et plagale
  const s2 = mk({ L: 'C3+E3+G3:4 | F2+A2+C3:4 | C3+E3+G3:4 | G2+B2+D3:4 | C3+E3+G3:4 | C3+E3+G3:4 | F2+A2+C3:4 | C3+E3+G3:4' });
  const an2 = T.analyzeSong(s2);
  assert.deepEqual(an2.chords.map((c) => c.symbol), ['C', 'F', 'C', 'G', 'C', 'C', 'F', 'C']);
  const t2 = an2.cadences.map((c) => c.type);
  assert.ok(t2.includes('demi-cadence'), t2.join());
  assert.ok(t2.includes('plagale'), t2.join());
  // rompue
  const cad = T.findCadences([{ symbol: 'C', measure: 0 }, { symbol: 'G7', measure: 2 }, { symbol: 'Am', measure: 3 }], { tonic: 0, mode: 'major' });
  assert.equal(cad.find((c) => c.type === 'rompue')?.measure, 3);
  // basse renversée
  const inv = T.analyzeSong(mk({ L: 'E2+G2+C3:4 | G2+C3+E3:4' }));
  assert.deepEqual(inv.chords.map((c) => c.symbol), ['C/E', 'C/G']);
  // changement d'harmonie à mi-mesure
  const half = T.chordsByMeasure(mk({ L: 'C3+E3+G3:2 G2+B2+D3+F3:2 | C3+E3+G3:4' }));
  assert.deepEqual(half.map((c) => [c.symbol, c.measure, c.beat]), [['C', 0, 0], ['G7', 0, 2], ['C', 1, 0]]);
  // symboles fournis par la partition
  const given = T.chordsByMeasure({ ...mk({ R: 'C4:4 | D4:4' }), chords: [{ beat: 0, symbol: 'Cmaj7' }, { beat: 4, symbol: 'Dm7' }] });
  assert.deepEqual(given.map((c) => [c.symbol, c.roman, c.source]), [['Cmaj7', 'Imaj7', 'partition'], ['Dm7', 'ii7', 'partition']]);
  // fenêtre vide
  assert.equal(T.bestChordForWeights(new Array(12).fill(0)), null);
});

test('théorie : carrure et structure', () => {
  const phrase = 'C4 D4 E4 C4 | C4 D4 E4 C4 | E4 F4 G4:2 | E4 F4 G4:2';
  const other = 'G4 A4 G4 F4 | E4 C4 C4:2 | D4 G3 C4:2 | D4 G3 C4:2';
  const s = mk({ R: [phrase, phrase, other, phrase].join(' | ') });
  const st = T.analyzeStructure(s);
  assert.equal(s.measureCount, 16);
  assert.equal(st.square, true);
  assert.equal(st.phraseLength, 4);
  assert.equal(st.form, 'A A B A');
  assert.equal(st.sections[2].from, 8);
  const odd = T.analyzeStructure(mk({ R: 'C4:4 | D4:4 | E4:4 | F4:4 | G4:4 | A4:4' }));
  assert.equal(odd.square, false);
  // phrase variée : A'
  const varied = 'C4 D4 E4 C4 | C4 D4 E4 C4 | G4 F4 E4:2 | D4 E4 C4:2';
  assert.equal(T.analyzeStructure(mk({ R: [phrase, varied].join(' | ') })).form, "A A'");
});

test('théorie : intervalles et quiz', () => {
  assert.equal(T.intervalName(0), 'unisson');
  assert.equal(T.intervalName(4), 'tierce majeure');
  assert.equal(T.intervalName(-7), 'quinte juste');
  assert.equal(T.intervalName(12), 'octave');
  assert.equal(T.intervalName(16), 'tierce majeure + octave');
  assert.equal(T.intervalName(24), '2 octaves');
  const r1 = T.rng(5), r2 = T.rng(5);
  assert.equal(r1(), r2());
  const s = prepareSong(getSong('prelude-do') || SONGS[0]);
  const q1 = T.generateQuiz(s, { seed: 7, count: 6 });
  const q2 = T.generateQuiz(s, { seed: 7, count: 6 });
  assert.deepEqual(q1, q2, 'déterministe');
  assert.equal(q1[0].type, 'tonalite');
  assert.ok(q1.length >= 3 && q1.length <= 6);
  for (const q of q1) {
    assert.ok(q.prompt.length > 5);
    assert.ok(q.choices.length >= 2 && q.choices.length <= 4, q.prompt);
    assert.equal(new Set(q.choices).size, q.choices.length, 'choix distincts');
    assert.ok(q.answer >= 0 && q.answer < q.choices.length);
    assert.ok(q.explain);
  }
  const iv = q1.find((q) => q.type === 'intervalle');
  if (iv) assert.equal(iv.choices[iv.answer], T.intervalName(iv.notes[1] - iv.notes[0]));
  // tous les morceaux de la bibliothèque s'analysent sans erreur
  for (const raw of SONGS) {
    const song = prepareSong(raw);
    const an = T.analyzeSong(song);
    assert.ok(an.keyName && Array.isArray(an.chords), raw.id);
    for (const c of an.chords) assert.ok(H.parseChord(c.symbol), `${raw.id}: ${c.symbol}`);
    const qs = T.generateQuiz(song, { seed: 2, analysis: an });
    assert.ok(qs.every((q) => q.answer >= 0), raw.id);
  }
});

// ---------- édition ----------
const notes0 = () => [
  { id: 1, midi: 60, start: 0, dur: 1, hand: 'R', finger: 1 },
  { id: 2, midi: 62, start: 1, dur: 1, hand: 'R', finger: 2 },
  { id: 3, midi: 48, start: 0, dur: 2, hand: 'L', finger: 5 },
];

test('édition : opérations de base (immutables)', () => {
  const n = notes0();
  const frozen = JSON.stringify(n);
  assert.equal(E.setHand(n, [1], 'L').find((x) => x.id === 1).hand, 'L');
  assert.equal(E.setHand(n, [1], 'L').find((x) => x.id === 1).finger, null, 'doigté effacé en changeant de main');
  assert.equal(E.setFinger(n, new Set([2]), 4).find((x) => x.id === 2).finger, 4);
  assert.equal(E.setFinger(n, [2], 9).find((x) => x.id === 2).finger, null);
  assert.deepEqual(E.shiftPitch(n, [1, 2], 2).filter((x) => x.hand === 'R').map((x) => x.midi), [62, 64]);
  assert.equal(E.shiftPitch(n, [1], -100).find((x) => x.id === 1).midi, 21);
  assert.equal(E.setDuration(n, [1], 0.5).find((x) => x.id === 1).dur, 0.5);
  assert.equal(E.setDuration(n, [1], 0), n);
  assert.equal(E.moveTime(n, [2], -5).find((x) => x.id === 2).start, 0);
  assert.equal(E.deleteNotes(n, [1, 3]).length, 1);
  const { notes: added, note } = E.addNote(n, { midi: 40, start: 2, dur: 1 });
  assert.equal(added.length, 4);
  assert.equal(note.hand, 'L');
  assert.ok(note.id > 3);
  assert.equal(E.addNote(n, { midi: 72, start: 3 }).note.hand, 'R');
  assert.equal(JSON.stringify(n), frozen, 'arguments non modifiés');
});

test('édition : partage des mains, doublons', () => {
  const n = [...notes0(), { id: 4, midi: 57, start: 2, dur: 1, hand: 'R', finger: 3 }];
  const s = E.splitHands(n, 60);
  assert.equal(s.find((x) => x.id === 4).hand, 'L');
  assert.equal(s.find((x) => x.id === 4).finger, null);
  assert.equal(s.find((x) => x.id === 1).finger, 1, 'inchangé si même main');
  assert.equal(E.splitHands(n, 55).find((x) => x.id === 4).hand, 'R');
  assert.equal(E.splitHands(n, 64, [1]).find((x) => x.id === 1).hand, 'L');
  assert.equal(E.splitHands(n, 64, [1]).find((x) => x.id === 2).hand, 'R');
  // point de partage : trou entre les mains
  const two = [48, 50, 52, 55, 67, 69, 71, 72].map((m, i) => ({ id: i, midi: m, start: i, dur: 1, hand: 'R' }));
  const sp = E.suggestSplitPoint(two);
  assert.ok(sp > 55 && sp <= 67, String(sp));
  assert.equal(E.suggestSplitPoint([]), 60);
  const d = E.dedupe([{ midi: 60, start: 0, dur: 1, hand: 'R' }, { midi: 60, start: 0, dur: 2, hand: 'R' }, { midi: 60, start: 0, dur: 1, hand: 'L' }, { midi: 61, start: 0, dur: 0, hand: 'R' }]);
  assert.equal(d.length, 2);
  assert.equal(d.find((x) => x.hand === 'R').dur, 2);
});

test('édition : quantification, triolets et swing', () => {
  const sloppy = [0.03, 0.52, 0.98, 1.27, 1.49, 2.02].map((s, i) => ({ id: i, midi: 60 + i, start: s, dur: 0.46, hand: 'R' }));
  const q = E.quantize(sloppy, { grid: 0.5, swing: false });
  assert.deepEqual(q.notes.map((n) => n.start), [0, 0.5, 1, 1.5, 1.5, 2]);
  assert.ok(q.notes.every((n) => n.dur === 0.5));
  const q16 = E.quantize(sloppy, { grid: 0.25, swing: false });
  assert.deepEqual(q16.notes.map((n) => n.start), [0, 0.5, 1, 1.25, 1.5, 2]);
  // triolets
  const trip = [0, 0.34, 0.65, 1, 1.32, 1.68].map((s, i) => ({ id: i, midi: 60 + i, start: s, dur: 0.3, hand: 'R' }));
  const qt = E.quantize(trip, { grid: 1 / 3 });
  assert.deepEqual(qt.notes.map((n) => Math.round(n.start * 3)), [0, 1, 2, 3, 4, 5]);
  assert.equal(qt.swing, false, 'pas de swing sur une grille de triolets');
  const mixed = E.quantize([...trip.slice(0, 3), { id: 9, midi: 70, start: 2.26, dur: 0.24, hand: 'R' }], { grid: 'mixed', swing: false });
  assert.deepEqual(mixed.notes.map((n) => Math.round(n.start * 12)), [0, 4, 8, 27]);
  // swing : croches « longue-brève »
  const swung = [];
  for (let b = 0; b < 4; b++) swung.push({ id: 2 * b, midi: 60, start: b + 0.01, dur: 0.6, hand: 'R' }, { id: 2 * b + 1, midi: 62, start: b + 0.67, dur: 0.3, hand: 'R' });
  const sw = E.detectSwing(swung);
  assert.equal(sw.swing, true);
  assert.ok(sw.ratio > 0.6 && sw.ratio < 0.7);
  assert.equal(E.detectSwing(sloppy.slice(0, 3)).swing, false);
  const qs = E.quantize(swung, { grid: 0.25, swing: 'auto' });
  assert.equal(qs.swing, true);
  assert.deepEqual(qs.notes.map((n) => n.start), [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
  const straight = E.quantize(swung, { grid: 0.25, swing: false });
  assert.ok(straight.notes.some((n) => n.start % 1 === 0.75));
  // force partielle
  assert.equal(E.quantize([{ id: 1, midi: 60, start: 0.2, dur: 1, hand: 'R' }], { grid: 1, strength: 0.5, swing: false }).notes[0].start, 0.1);
});

test('édition : historique annuler / rétablir', () => {
  const hst = new E.EditHistory(notes0());
  assert.equal(hst.canUndo, false);
  hst.apply((n) => E.deleteNotes(n, [1]));
  hst.apply((n) => E.shiftPitch(n, [2], 1));
  assert.equal(hst.current.length, 2);
  assert.equal(hst.current.find((x) => x.id === 2).midi, 63);
  hst.undo();
  assert.equal(hst.current.find((x) => x.id === 2).midi, 62);
  hst.undo();
  assert.equal(hst.current.length, 3);
  assert.equal(hst.canUndo, false);
  hst.undo();
  assert.equal(hst.current.length, 3);
  hst.redo();
  assert.equal(hst.current.length, 2);
  hst.apply((n) => E.setFinger(n, [2], 5));
  assert.equal(hst.canRedo, false, 'nouvelle action : rétablir oublié');
  const lim = new E.EditHistory(0, 3);
  for (let i = 1; i <= 10; i++) lim.push(i);
  assert.equal(lim.stack.length, 3);
  assert.equal(lim.current, 10);
});

test('édition : doigtés personnalisés et sauvegarde', () => {
  const song = prepareSong(getSong('prelude-do') || SONGS[0]);
  const orig = song.notes.map((n) => ({ ...n }));
  const edited = E.setFinger(orig, [orig[0].id, orig[3].id], 5);
  const changed = [orig[0], orig[3]].filter((n) => n.finger !== 5).length;
  const ov = E.fingeringOverrides(orig, edited);
  assert.equal(Object.keys(ov).length, changed);
  assert.ok(E.onlyFingeringsChanged(orig, edited));
  assert.ok(!E.onlyFingeringsChanged(orig, E.shiftPitch(edited, [orig[1].id], 1)));
  const fresh = prepareSong(getSong('prelude-do') || SONGS[0]);
  assert.equal(E.applyFingeringOverrides(fresh.notes, ov), changed);
  assert.equal(fresh.notes.find((n) => E.noteKey(n) === E.noteKey(orig[0])).finger, 5);
  assert.equal(E.applyFingeringOverrides(fresh.notes, null), 0);
  const raw = E.toRawSong({ ...song, keyMode: 'major', chords: [{ beat: 0, symbol: 'C' }] }, [{ id: 7, midi: 60, start: 0, dur: 1, hand: 'R', finger: 1, velocity: 90 }]);
  assert.equal(raw.notes[0].velocity, 90);
  assert.equal(raw.notes[0].id, undefined);
  assert.equal(raw.keyMode, 'major');
  assert.equal(raw.chords.length, 1);
  assert.equal(prepareSong(raw).notes.length, 1);
});

// ---------- partage ----------
const noteSig = (s, fingers = true) => s.notes.map((n) => `${n.hand}${n.midi}@${Math.round(n.start * 1e4)}:${Math.round(n.dur * 1e4)}${fingers ? 'f' + n.finger : ''}`).sort().join(' ');

test('partage : base64url et compression', async () => {
  const bytes = new Uint8Array(300).map((_, i) => (i * 37) & 255);
  assert.deepEqual(Sh.base64urlToBytes(Sh.bytesToBase64url(bytes)), bytes);
  assert.ok(!/[+/=]/.test(Sh.bytesToBase64url(bytes)));
  assert.ok(Sh.compressionSupported());
  const txt = new TextEncoder().encode('do ré mi '.repeat(200));
  const z = await Sh.deflate(txt);
  assert.ok(z.length < txt.length / 5);
  assert.deepEqual(await Sh.inflate(z), txt);
});

test('partage : aller-retour de tous les morceaux -> mêmes notes', async () => {
  for (const raw of SONGS) {
    const s = prepareSong(raw);
    const enc = await Sh.encodeSong(s);
    assert.ok(enc.d.startsWith('z'), raw.id);
    assert.ok(!enc.tooLong, raw.id);
    const back = prepareSong(await Sh.decodeSong(enc.d));
    assert.equal(noteSig(back, !s.autoFingering), noteSig(s, !s.autoFingering), raw.id);
    assert.equal(back.title, s.title);
    assert.equal(back.tempo, s.tempo);
    assert.deepEqual(back.timeSig, s.timeSig);
    assert.equal(back.keyFifths || 0, s.keyFifths || 0);
  }
});

test('partage : notes polyphoniques, métadonnées, sans compression', async () => {
  // main droite polyphonique (note tenue sous d'autres notes) : la notation texte serait infidèle -> JSON
  const s = prepareSong({
    title: 'Poly « é » #1', composer: 'Moi', tempo: 72, timeSig: [3, 4], keyFifths: -2, keyMode: 'minor', genre: 'jazz', level: 3,
    chords: [{ beat: 0, symbol: 'Gm7' }, { beat: 3, symbol: 'C7b9' }],
    notes: [
      { midi: 67, start: 0, dur: 3, hand: 'R', finger: 5 }, { midi: 62, start: 0, dur: 1, hand: 'R', finger: 1 }, { midi: 63, start: 1, dur: 0.5, hand: 'R', finger: 2 },
      { midi: 65, start: 1.5, dur: 1 / 3, hand: 'R', finger: 3 }, { midi: 43, start: 0, dur: 2.75, hand: 'L', finger: 5 }, { midi: 50, start: 0.25, dur: 1.2, hand: 'L', finger: 2 },
    ],
  });
  assert.equal(Sh.serializeForShare(s)[0], 'J');
  for (const compress of [true, false]) {
    const enc = await Sh.encodeSong(s, { compress });
    assert.equal(enc.d[0], compress ? 'z' : 'p');
    const raw = await Sh.decodeSong(enc.d);
    const back = prepareSong(raw);
    assert.equal(noteSig(back), noteSig(s));
    for (const k of ['title', 'composer', 'tempo', 'keyFifths', 'keyMode', 'genre', 'level']) assert.equal(back[k], s[k], k);
    assert.deepEqual(back.timeSig, [3, 4]);
    assert.deepEqual(back.chords, s.chords);
  }
  // mélodie simple : notation texte de l'application
  const simple = prepareSong({ title: 'Simple', keyFifths: 1, tracks: { R: 'G4:1:1 A4:1:2 B4:2:3', L: 'G2:4:5' }, chords: [{ beat: 0, symbol: 'G' }] });
  const ser = Sh.serializeForShare(simple);
  assert.equal(ser[0], 'T');
  const back = prepareSong(Sh.deserializeShare(ser));
  assert.equal(noteSig(back), noteSig(simple));
  assert.equal(back.keyFifths, 1);
  assert.deepEqual(back.chords, [{ beat: 0, symbol: 'G' }]);
});

test('partage : URL, paramètres, erreurs, limite de taille', async () => {
  const s = prepareSong(SONGS[0]);
  const { url, d } = await Sh.buildShareUrl(s, 'https://exemple.fr/piano/', { from: 2, to: 4, tempo: 80, hands: 'R' });
  assert.ok(url.startsWith('https://exemple.fr/piano/#/partage?d='));
  const qs = Object.fromEntries(new URLSearchParams(url.split('?')[1]));
  assert.equal(qs.d, d);
  const p = Sh.parseShareQuery(qs);
  assert.deepEqual([p.from, p.to, p.tempo, p.hands], [2, 4, 80, 'R']);
  assert.deepEqual(Sh.parseShareQuery({ d: 'x', hands: 'zz', from: 'abc' }), { d: 'x', from: null, to: null, tempo: null, hands: null });
  const back = prepareSong(await Sh.decodeSong(qs.d));
  assert.equal(noteSig(back, false), noteSig(s, false));
  await assert.rejects(Sh.decodeSong(''));
  await assert.rejects(Sh.decodeSong('q123'));
  await assert.rejects(Sh.decodeSong('zAAAA'));
  // un très long morceau dépasse la limite
  const notes = [];
  const rand = T.rng(42);
  for (let i = 0; i < 4000; i++) notes.push({ midi: 30 + Math.floor(rand() * 60), start: i * 0.5 + Math.round(rand() * 1000) / 1000, dur: 0.1 + Math.round(rand() * 2000) / 1000, hand: rand() < 0.5 ? 'R' : 'L' });
  const enc = await Sh.encodeSong(prepareSong({ title: 'long', notes }));
  assert.ok(enc.tooLong);
  assert.ok(enc.chars > Sh.SHARE_MAX_CHARS);
});
