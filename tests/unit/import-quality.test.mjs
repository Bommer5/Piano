// Planchers de qualité de l'import audio : un sous-ensemble rapide du banc d'essai (scripts/import-bench.mjs)
// — morceaux réels rendus en son de piano réaliste, transcrits, comparés à la partition d'origine.
// Toute régression de la reconnaissance (notes, tempo, mesure, mains) fait échouer ces tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCases, runCase, summarize, referenceOf } from '../../scripts/import-bench.mjs';
import { toRawSong, analyzePerformance } from '../../js/core/transcribe.js';

const rows = buildCases({ quick: true }).map((c) => ({ ...runCase(c), hands2: c.hands === 'both' }));
const sum = summarize(rows);

test('banc rapide : notes retrouvées (F1) — mélodie seule ≥ 0,97, deux mains ≥ 0,94, aucun cas sous 0,92', () => {
  assert.ok(sum.mono.f1 >= 0.97, `mélodie seule : F1 ${sum.mono.f1.toFixed(3)}`);
  assert.ok(sum.two.f1 >= 0.94, `deux mains : F1 ${sum.two.f1.toFixed(3)}`);
  for (const r of rows) assert.ok(r.f1 >= 0.92, `${r.name} : F1 ${r.f1.toFixed(3)}`);
  // les notes tombent exactement à leur place dans la partition (pas seulement « à une grille près »)
  assert.ok(sum.all.f1Exact >= 0.95, `F1 exact ${sum.all.f1Exact.toFixed(3)}`);
});

test('banc rapide : tempo juste à ±4 % partout, mesure, tonalité et mains', () => {
  for (const r of rows) assert.equal(r.tempoClass, 'ok', `${r.name} : tempo ${r.tempo} au lieu de ${Math.round(r.trueTempo)}`);
  assert.ok(sum.all.meter >= 0.85, `mesure ${sum.all.meter}`);
  assert.ok(sum.all.key >= 0.85, `tonalité ${sum.all.key}`);
  assert.ok(sum.two.hands >= 0.95, `mains ${sum.two.hands}`);
});

test('banc rapide : la confiance annoncée est proche de la réalité et les fausses notes sont signalées', () => {
  for (const r of rows) {
    assert.ok(r.confidence >= 0.85 && r.confidence <= 0.99, `${r.name} : confiance ${r.confidence}`);
    assert.ok(Math.abs(r.confidence - r.f1) < 0.08, `${r.name} : confiance ${r.confidence} pour F1 ${r.f1.toFixed(2)}`);
    assert.ok(r.raw.transcription && r.raw.transcription.uncertain === r.raw.notes.filter((n) => n.uncertain).length);
    assert.ok(r.result.notes.every((n) => n.confidence >= 0 && n.confidence <= 1));
  }
  // peu de notes signalées (< 6 %), et au moins la moitié des fausses notes le sont
  assert.ok(sum.flags.flagged <= 0.06 * sum.flags.notes, `${sum.flags.flagged} notes signalées sur ${sum.flags.notes}`);
  assert.ok(sum.flags.flaggedWrong >= 0.5 * sum.flags.wrong, `${sum.flags.flaggedWrong}/${sum.flags.wrong} fausses notes signalées`);
});

test('notes répétées rapides, son compressé « téléphone » : toutes retrouvées', () => {
  const r = rows.find((x) => x.name.startsWith('frere-jacques MD téléphone'));
  assert.ok(r.r >= 0.98 && r.p >= 0.98, `rappel ${r.r}, précision ${r.p}`);
});

test('réglages rapides : requantifier sans réanalyser (tempo ÷2 / ×2, grille, mesure, mélodie seule, octave, décalage)', () => {
  const r = rows.find((x) => x.name.startsWith('ode-joie 2M nominal'));
  const res = r.result;
  const base = toRawSong(res);
  assert.equal(base.tempo, 100);
  const half = toRawSong(res, { tempoScale: 0.5 });
  assert.equal(half.tempo, 50);
  assert.deepEqual(half.notes.slice(0, 6).map((n) => n.start), base.notes.slice(0, 6).map((n) => n.start / 2));
  const dbl = toRawSong(res, { tempoScale: 2 });
  assert.equal(dbl.tempo, 200);
  assert.equal(dbl.notes.at(-1).start, base.notes.at(-1).start * 2);
  assert.deepEqual(toRawSong(res, { timeSig: [3, 4] }).timeSig, [3, 4]);
  const mel = toRawSong(res, { hands: 'melody' });
  assert.ok(mel.notes.length < base.notes.length && mel.notes.every((n) => n.hand === 'R'));
  assert.deepEqual(toRawSong(res, { octave: -1 }).notes.map((n) => n.midi), base.notes.map((n) => n.midi - 12));
  assert.deepEqual(toRawSong(res, { shift: 1 }).notes.map((n) => n.start), base.notes.map((n) => n.start + 1));
  const tri = toRawSong(res, { grid: 1 / 3 });
  assert.ok(tri.notes.every((n) => Math.abs(n.start * 3 - Math.round(n.start * 3)) < 1e-4));
  assert.equal(tri.transcription.grid, 0.333333);
});

test('vitesse : plus de 20 fois le temps réel (3 min d’audio en moins de 9 s)', () => {
  const audio = rows.reduce((s, r) => s + r.audioSec, 0), ms = rows.reduce((s, r) => s + r.ms, 0);
  assert.ok(audio / (ms / 1000) > 20, `${(audio / (ms / 1000)).toFixed(0)}× le temps réel`);
});

test('analyzePerformance : un jeu libre (sans métronome) retrouve tempo, mesure et positions', () => {
  const ref = referenceOf('menuet-sol', { hands: 'both' });
  const spb = 60 / 87; // joué à 87 à la noire, avec ±10 ms d'irrégularité
  let seed = 3;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) - 0.5;
  const played = ref.notes.map((n) => ({ midi: n.midi, startSec: 0.5 + n.start * spb + rnd() * 0.02, durSec: n.dur * spb * 0.9, velocity: n.start % 3 === 0 ? 95 : 75, hand: n.hand }));
  const raw = toRawSong(analyzePerformance(played));
  assert.ok(Math.abs(raw.tempo - 87) <= 2, `tempo ${raw.tempo}`);
  assert.deepEqual(raw.timeSig, [3, 4]);
  const want = new Set(ref.notes.map((n) => `${n.midi}@${n.start}`));
  const ok = raw.notes.filter((n) => want.has(`${n.midi}@${n.start}`)).length;
  assert.ok(ok >= 0.97 * ref.notes.length, `${ok}/${ref.notes.length} notes à leur place exacte`);
  assert.ok(raw.notes.some((n) => n.hand === 'L') && raw.notes.some((n) => n.hand === 'R'), 'mains conservées');
});
