// Entraîneur avancé : carte de tempo, relâchement / legato, rythme seul, accords, nuances, pédale,
// prises (take), suivi de partition (follower), méthode de travail (coursegen).
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareSong } from '../../js/core/song.js';
import { PracticeEngine, Timeline, holdVerdict, judgeDynamics, judgePedal, dynamicAt } from '../../js/core/practice.js';
import {
  createTake, takeNoteOn, takeNoteOff, takePedal, addAnchor, closeTake, judgeOf, takeBeatAt, takeTimeAt, takeOverlay, takeToSong,
  packTake, unpackTake, saveTake, loadTakes, analyzeTake, histogram, stdDev, TAKE_PREFIX,
} from '../../js/core/take.js';
import { ScoreFollower } from '../../js/core/follower.js';
import { smartPhrases, generateSongCourse, makeRhythmVariant, updateStepState, recordStepResult, createRepeatChallenge, COURSE_STEPS_KEY } from '../../js/core/coursegen.js';
import { exportMidi, parseMidi } from '../../js/parsers/midi.js';

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}

test('carte de tempo : conversion temps <-> secondes par segments', () => {
  const s = prepareSong({ tempo: 60, tracks: { R: 'C4 D4 E4 F4 G4 A4' }, tempoMap: [{ beat: 0, bpm: 60 }, { beat: 2, bpm: 120 }] });
  const tl = new Timeline(s, 60);
  assert.equal(tl.secAt(2), 2);
  assert.equal(tl.secAt(4), 3);
  assert.equal(tl.beatAt(3), 4);
  assert.ok(Math.abs(tl.beatAt(tl.secAt(5.3)) - 5.3) < 1e-9);
  // à 50 % du tempo, tout dure deux fois plus longtemps
  const half = new Timeline(s, 30);
  assert.equal(half.secAt(4), 6);
  // sans carte : linéaire
  const plain = new Timeline(prepareSong({ tempo: 120, tracks: { R: 'C4' } }), 120);
  assert.equal(plain.secAt(4), 2);
  assert.equal(plain.secAt(-2), -1); // décompte : extrapolation
});

test('moteur tempo : carte de tempo prise en compte pour le jugement', () => {
  const s = prepareSong({ tempo: 60, tracks: { R: 'C4 D4 E4 F4' }, tempoMap: [{ beat: 0, bpm: 60 }, { beat: 2, bpm: 120 }] });
  const e = new PracticeEngine(s, { mode: 'tempo' });
  assert.equal(e.input(60, 0).grade, 'perfect');
  assert.equal(e.input(62, 1).grade, 'perfect');
  assert.equal(e.input(64, 2).grade, 'perfect');
  assert.equal(e.input(65, 2.5).grade, 'perfect'); // Fa au temps 3 = 2,5 s (120 BPM à partir du temps 2)
  e.setTempo(30);
  assert.equal(e.timeOf(3), 5);
});

test('moteur tempo : index de départ (pas de retour en arrière) et tick', () => {
  const s = prepareSong({ tempo: 60, tracks: { R: 'C4 '.repeat(200) } });
  const e = new PracticeEngine(s, { mode: 'tempo' });
  const missed = e.tick(50.5);
  assert.equal(missed.length, 51);
  assert.ok(e.tIdx >= 51);
  assert.equal(e.input(60, 51.02).grade, 'perfect');
  assert.equal(e.tick(51.5).length, 0);
});

test('release : durée tenue (trop tôt / trop long / pédale)', () => {
  assert.equal(holdVerdict(0.5), 'short');
  assert.equal(holdVerdict(1.0), 'ok');
  assert.equal(holdVerdict(1.5), 'long');
  assert.equal(holdVerdict(1.5, true), 'ok');
  const s = prepareSong({ tempo: 60, tracks: { R: 'C4:2 D4:2 E4:2' } });
  const e = new PracticeEngine(s, { mode: 'tempo' });
  e.input(60, 0);
  assert.equal(e.release(60, 0.8).verdict, 'short'); // 0,8 s sur 2 s
  e.input(62, 2);
  assert.equal(e.release(62, 4.0).verdict, 'ok');
  e.input(64, 4);
  e.pedal(true, 4.5);
  assert.equal(e.release(64, 7.5).verdict, 'ok'); // tenu trop longtemps mais avec pédale
  assert.equal(e.release(99, 1), null);
  const sum = e.summary();
  assert.equal(sum.holdsShort, 1);
  assert.equal(sum.holds.length, 3);
});

test('legato manquant sur des notes liées', () => {
  const s = prepareSong({ tempo: 60, notes: [
    { midi: 60, start: 0, dur: 1, hand: 'R', slur: 'start' },
    { midi: 62, start: 1, dur: 1, hand: 'R', slur: 'continue' },
    { midi: 64, start: 2, dur: 1, hand: 'R', slur: 'stop' },
  ] });
  const e = new PracticeEngine(s, { mode: 'tempo' });
  e.input(60, 0);
  e.release(60, 0.7); // coupe avant la note suivante
  assert.equal(e.input(62, 1).legatoMissed, true);
  // Ré tenu jusqu'à Mi : legato correct
  assert.equal(e.input(64, 2).legatoMissed, false);
  e.release(62, 2.05);
  assert.equal(e.summary().legatoMissed.length, 1);
});

test('rythme seul : toute touche acceptée, seul le placement compte', () => {
  const s = prepareSong({ tempo: 60, tracks: { R: 'C4 D4 E4' } });
  const e = new PracticeEngine(s, { mode: 'tempo', rhythmOnly: true });
  assert.equal(e.input(40, 0.01).type, 'hit');
  assert.equal(e.input(90, 1.15).grade, 'good');
  assert.equal(e.input(72, 1.5).type, 'offtime'); // entre deux notes : pas une fausse note
  const w = new PracticeEngine(s, { rhythmOnly: true });
  assert.equal(w.input(30).type, 'advance');
});

test('accords en mode attente : limite de temps (accord pas plaqué ensemble, sans bloquer)', () => {
  const s = prepareSong({ tracks: { R: 'C4+E4+G4 D4+F4' } });
  const e = new PracticeEngine(s);
  e.input(60, 10);
  e.input(64, 10.5);
  const r = e.input(67, 11.6);
  assert.equal(r.type, 'advance');
  assert.equal(r.chordNotTogether, true);
  e.input(62, 12);
  const r2 = e.input(65, 12.03);
  assert.equal(r2.type, 'finish');
  assert.ok(!r2.chordNotTogether);
  assert.equal(e.summary().chordIssues.length, 1);
});

test('nuances : p nettement plus doux que f', () => {
  const s = prepareSong({ tracks: { R: 'C4 D4 E4 F4' }, dynamics: [{ beat: 0, mark: 'p' }, { beat: 2, mark: 'f' }] });
  assert.equal(dynamicAt(s.dynamics, 2.5), 'f');
  const e = new PracticeEngine(s);
  [0.3, 0.32, 0.8, 0.85].forEach((v, i) => e.input([60, 62, 64, 65][i], i, { velocity: v }));
  assert.equal(e.summary().dynamics.ok, true);
  const bad = judgeDynamics([{ mark: 'p', v: 0.6 }, { mark: 'f', v: 0.62 }]);
  assert.equal(bad.ok, false);
  assert.match(bad.message, /plus doux/);
  // calibrage : 0.5..0.7 couvre toute l'échelle de cet élève
  assert.equal(judgeDynamics([{ mark: 'p', v: 0.52 }, { mark: 'f', v: 0.6 }], { soft: 0.5, loud: 0.7 }).ok, true);
});

test('pédale : changements attendus', () => {
  const r = judgePedal([{ t: 0, down: true }, { t: 2, down: false }], [{ t: 0.1, down: true }, { t: 3, down: false }], 0.3);
  assert.equal(r.matched, 1);
  assert.equal(r.missed.length, 1);
  const s = prepareSong({ tempo: 60, tracks: { R: 'C4 D4' }, pedal: [{ beat: 0, down: true }, { beat: 2, down: false }] });
  const e = new PracticeEngine(s, { mode: 'tempo' });
  e.pedal(true, 0.05);
  e.pedal(false, 2.1);
  assert.equal(e.summary().pedal.ok, true);
});

test('seek : navigation par mesure (les notes sautées ne comptent pas)', () => {
  const s = prepareSong({ tempo: 60, tracks: { R: 'C4 D4 E4 F4 G4 A4 B4 C5' } });
  const e = new PracticeEngine(s, { mode: 'tempo' });
  e.seek(4);
  assert.equal(e.tIdx, 4);
  assert.equal(e.tick(4.2).length, 0);
  assert.equal(e.summary().total, 0);
  const w = new PracticeEngine(s);
  w.seek(4);
  assert.equal(w.current.midis[0], 67);
});

test('prise : enregistrement, relâchement, ancrage, export .mid', () => {
  const s = prepareSong({ id: 'x', title: 'Essai', tempo: 120, tracks: { R: 'C4 D4 E4 F4' } });
  const take = createTake({ songId: 'x', tempo: 120, from: 0, to: 4 });
  const i = takeNoteOn(take, { midi: 60, t: 0, vel: 0.5, src: 'midi' });
  takeNoteOn(take, { midi: 62, t: 0.5, src: 'keyboard' });
  assert.equal(takeNoteOff(take, 60, 0.4).t1, 0.4);
  takePedal(take, true, 0.1);
  closeTake(take, 2);
  assert.equal(take.notes[1].t1, 2);
  assert.equal(i, 0);
  assert.equal(takeBeatAt(take, 1), 2); // 120 BPM, sans ancres
  addAnchor(take, 0, 0);
  addAnchor(take, 4, 2); // jeu deux fois plus lent (mode attente)
  assert.equal(takeBeatAt(take, 2), 1);
  assert.equal(takeTimeAt(take, 1), 2);
  addAnchor(take, 3, 1); // ignorée (temps antérieur)
  assert.equal(take.anchors.length, 2);
  const ov = takeOverlay(take);
  assert.equal(ov.length, 2);
  const song = takeToSong(take, s);
  assert.equal(song.notes.length, 2);
  const parsed = parseMidi(exportMidi(song).buffer);
  assert.ok(parsed.notes.length === 2 || parsed.tracks?.length > 0);
  assert.equal(judgeOf({ type: 'hit', delta: 0.02 }), 'ok');
  assert.equal(judgeOf({ type: 'hit', delta: -0.2 }), 'early');
  assert.equal(judgeOf({ type: 'hit', delta: 0.2 }), 'late');
  assert.equal(judgeOf({ type: 'wrong' }), 'wrong');
});

test('prise : stockage des 5 dernières, taille limitée', () => {
  const st = memStorage();
  for (let k = 0; k < 7; k++) {
    const t = createTake({ songId: 'abc', tempo: 100 });
    takeNoteOn(t, { midi: 60 + k, t: k, judge: 'ok', nb: k, hand: 'R', delta: 0.01 });
    closeTake(t, k + 1);
    assert.ok(saveTake('abc', t, { storage: st }));
  }
  const all = loadTakes('abc', st);
  assert.equal(all.length, 5);
  assert.equal(all[4].notes[0].midi, 66);
  assert.equal(all[4].notes[0].judge, 'ok');
  assert.ok(st._m.has(TAKE_PREFIX + 'abc'));
  // une très longue prise est tronquée pour tenir dans la limite
  const big = createTake({ songId: 'big' });
  for (let k = 0; k < 3000; k++) takeNoteOn(big, { midi: 60, t: k * 0.1 });
  closeTake(big, 400);
  saveTake('big', big, { storage: st, maxBytes: 20000 });
  assert.ok(st.getItem(TAKE_PREFIX + 'big').length <= 20000);
  const back = unpackTake(packTake(big));
  assert.ok(back.notes.length === 3000);
});

test('analyse : écarts par main, régularité, dérive, accords arpégés, durées, legato, confusions', () => {
  const s = prepareSong({ tempo: 60, notes: [
    { midi: 60, start: 0, dur: 1, hand: 'R', slur: 'start' },
    { midi: 62, start: 1, dur: 1, hand: 'R', slur: 'stop' },
    { midi: 48, start: 0, dur: 2, hand: 'L' }, { midi: 52, start: 0, dur: 2, hand: 'L' },
    { midi: 64, start: 4, dur: 1, hand: 'R' }, { midi: 65, start: 5, dur: 1, hand: 'R' }, { midi: 67, start: 6, dur: 1, hand: 'R' },
  ] });
  const take = createTake({ tempo: 60 });
  const add = (midi, t0, t1, nb, hand, delta, judge = 'ok') => {
    const i = takeNoteOn(take, { midi, t: t0, nb, hand, delta, judge });
    take.notes[i].t1 = t1;
  };
  add(60, 0.02, 0.6, 0, 'R', 0.02); // relâché tôt + legato coupé
  add(62, 1.0, 2.0, 1, 'R', 0);
  add(48, 0.0, 2.0, 0, 'L', 0);
  add(52, 0.09, 2.0, 0, 'L', 0.09, 'late'); // accord MG arpégé (90 ms)
  add(64, 4.1, 5, 4, 'R', 0.1, 'late');
  add(65, 5.2, 6, 5, 'R', 0.2, 'late');
  add(67, 6.3, 7, 6, 'R', 0.3, 'late'); // ralentit dans la mesure 2
  for (const t of [7, 8]) {
    const i = takeNoteOn(take, { midi: 65, t, judge: 'wrong', exp: [64, 67] });
    take.notes[i].t1 = t + 0.3;
  }
  const a = analyzeTake(take, s);
  assert.ok(a.hands.R && a.hands.L);
  assert.equal(a.timing.length, 7);
  assert.ok(a.regularity.sd > 0);
  assert.equal(a.arpeggios.length, 1);
  assert.equal(a.arpeggios[0].spreadMs, 90);
  assert.ok(a.durations.some((d) => d.verdict === 'short' && d.midi === 60));
  assert.equal(a.legato.length, 1);
  assert.equal(a.extras.length, 2);
  assert.deepEqual(a.confusions[0], { played: 65, expected: 64, count: 2 });
  const m2 = a.drift.find((d) => d.measure === 2);
  assert.ok(m2.tempoPct < 95 && m2.meanMs > 0);
  assert.equal(histogram([0, 5, 199, -500]).reduce((x, b) => x + b.count, 0), 4);
  assert.equal(stdDev([1, 1, 1]), 0);
});

test('suivi de partition : tolère fausses notes, notes oubliées et rubato', () => {
  const s = prepareSong({ tempo: 60, tracks: { R: 'C4 D4 E4 F4 G4 A4 B4 C5 D5 E5' } });
  const f = new ScoreFollower(s.notes, { tempo: 60 });
  assert.equal(f.push(60, 0).index, 0);
  assert.equal(f.push(62, 1.3).index, 1); // rubato
  assert.equal(f.push(61, 2).matched, false); // fausse note
  assert.equal(f.push(65, 3).index, 3); // Mi oublié
  assert.equal(f.pos, 4);
  assert.ok(f.beatAt(3.5) > 3 && f.beatAt(3.5) <= 4);
  assert.equal(f.beatAt(100), 4); // ne dépasse pas la note suivante
  // perdu : se resitue grâce aux dernières notes jouées
  const g = new ScoreFollower(s.notes, { tempo: 60, window: 2 });
  g.push(60, 0);
  [71, 72, 74, 76].forEach((m, i) => g.push(m, 1 + i));
  assert.ok(g.pos >= 9, 'position retrouvée : ' + g.pos);
  assert.ok(g.stats.jumps >= 1);
  assert.ok(f.coverage() > 0.2 && f.coverage() < 0.5);
});

test('cours : phrases selon silences / notes longues / levées', () => {
  const s = prepareSong({ tracks: { R: 'C4 D4 E4 F4 G4 A4 B4 C5 D5:4 '.repeat(4) } });
  const ph = smartPhrases(s, { target: 4 });
  assert.deepEqual(ph.map((p) => p.lastMeasure), [3, 6, 9, 12]);
  const up = prepareSong({ tracks: { R: 'r:3 G4 C5 D5 E5 F5 G5:3 G4 C5 D5 E5 F5 G5:3 G4 C5 D5 E5 F5 G5:4' } });
  const p2 = smartPhrases(up, { target: 2 });
  assert.ok(p2.some((p) => p.from === 11), 'la phrase commence sur la levée');
});

test('cours : mains séparées en rythme avant mains ensemble, travail à rebours, variantes', () => {
  const s = prepareSong({ title: 'x', tracks: { R: 'C4:0.5 D4:0.5 E4:0.5 F4:0.5 G4:0.5 F4:0.5 E4:0.5 D4:0.5 '.repeat(8), L: 'C3:4 '.repeat(8) } });
  const steps = generateSongCourse(s);
  const ids = steps.map((x) => x.id);
  assert.ok(ids.indexOf('p0-R-tempo') < ids.indexOf('p0-tempo'));
  assert.ok(ids.indexOf('p0-L-tempo') < ids.indexOf('p0-tempo'));
  assert.ok(steps.some((x) => x.variant === 'long-short'));
  const back = generateSongCourse(s, { backwards: true });
  const firstPhrase = back.find((x) => /^p\d+-R$/.test(x.id));
  const last = smartPhrases(s).length - 1;
  assert.equal(firstPhrase.id, `p${last}-R`);
  const v = makeRhythmVariant(prepareSong({ tracks: { R: 'C4:0.5 D4:0.5 E4:1' } }), { pattern: 'short-long' });
  assert.deepEqual(v.notes.map((n) => [n.start, n.dur]), [[0, 0.25], [0.25, 0.75], [1, 1]]);
});

test('cours : validation d’étape = 80 % deux fois de suite ; défi 3 fois juste', () => {
  let r = updateStepState(null, 85);
  assert.equal(r.justValidated, false);
  r = updateStepState(r.state, 70);
  assert.equal(r.state.streak, 0);
  r = updateStepState(r.state, 90);
  r = updateStepState(r.state, 80);
  assert.equal(r.justValidated, true);
  const st = memStorage();
  recordStepResult('k', 90, st);
  assert.equal(recordStepResult('k', 95, st).validated > 0, true);
  assert.ok(JSON.parse(st.getItem(COURSE_STEPS_KEY)).k.validated);
  const c = createRepeatChallenge(3);
  c.record(100);
  assert.equal(c.record(90).reset, true);
  c.record(100);
  c.record(100);
  assert.equal(c.record(100).done, true);
});
