// Relecture musicale automatique de la bibliothèque et des cours :
// mesures justes, doigtés jouables, références valides, provenance documentée.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { SONGS, getSong } from '../../js/data/songs.js';
import { COURSES } from '../../js/data/lessons.js';
import { prepareSong, parseTrack, beatsPerMeasure } from '../../js/core/song.js';
import { isBlack } from '../../js/core/notes.js';

const EPS = 1e-6;
const MAX_SPAN = 16; // dixième majeure, en demi-tons
// Pouce sur touche noire autorisé au niveau 1 : aucune exception pour l'instant (id → justification).
const THUMB_ON_BLACK_OK = {};

const prepared = SONGS.map((raw) => ({ raw, song: prepareSong(raw) }));
const isMultiple = (x, m) => Math.abs(x / m - Math.round(x / m)) < EPS;

test('contenu : identifiants de morceaux uniques', () => {
  const ids = SONGS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z0-9-]+$/, id);
});

test('contenu : chaque morceau se prépare sans erreur', () => {
  for (const { raw, song } of prepared) {
    assert.ok(song.notes.length > 0, raw.id);
    assert.ok(song.measureCount >= 1, raw.id);
    if (raw.keyMode != null) assert.ok(['major', 'minor'].includes(raw.keyMode), `${raw.id} : keyMode`);
  }
});

test('contenu : chaque barre « | » tombe sur une barre de mesure, chaque main', () => {
  for (const raw of SONGS) {
    const bpm = beatsPerMeasure(raw.timeSig);
    for (const h of ['R', 'L']) {
      const str = raw.tracks?.[h];
      if (!str) continue;
      let t = 0;
      const segs = str.split('|');
      segs.forEach((seg, i) => {
        if (!seg.trim()) return;
        t += parseTrack(seg).length;
        assert.ok(isMultiple(t, bpm), `${raw.id} [${h}] : la barre n°${i + 1} tombe au temps ${t} (mesure de ${bpm} temps)`);
      });
    }
  }
});

test('contenu : levées (pickupBeats) cohérentes avec les silences de la première mesure', () => {
  for (const { raw, song } of prepared) {
    if (raw.pickupBeats == null) continue;
    const bpm = song.beatsPerMeasure;
    assert.ok(raw.pickupBeats > 0 && raw.pickupBeats < bpm, `${raw.id} : pickupBeats`);
    const first = Math.min(...song.notes.map((n) => n.start));
    assert.ok(Math.abs(first - (bpm - raw.pickupBeats)) < EPS, `${raw.id} : la levée commence au temps ${first}, attendu ${bpm - raw.pickupBeats}`);
  }
});

test('contenu : pas deux notes identiques qui se chevauchent dans une même main', () => {
  for (const { raw, song } of prepared) {
    for (const h of ['R', 'L']) {
      const ns = song.notes.filter((n) => n.hand === h);
      for (let i = 0; i < ns.length; i++) {
        for (let j = i + 1; j < ns.length && ns[j].start < ns[i].start + ns[i].dur - EPS; j++) {
          assert.notEqual(ns[j].midi, ns[i].midi, `${raw.id} [${h}] : note ${ns[i].midi} doublée au temps ${ns[j].start}`);
        }
      }
    }
  }
});

test('contenu : doigtés 1-5, accords jouables (écart ≤ une dixième, doigts dans l’ordre)', () => {
  for (const { raw, song } of prepared) {
    for (const h of ['R', 'L']) {
      const byStart = new Map();
      for (const n of song.notes.filter((x) => x.hand === h)) {
        assert.ok(Number.isInteger(n.finger) && n.finger >= 1 && n.finger <= 5, `${raw.id} : doigt ${n.finger}`);
        const k = n.start.toFixed(4);
        if (!byStart.has(k)) byStart.set(k, []);
        byStart.get(k).push(n);
      }
      for (const [k, g] of byStart) {
        const midis = g.map((n) => n.midi);
        const span = Math.max(...midis) - Math.min(...midis);
        assert.ok(span <= MAX_SPAN, `${raw.id} [${h}] temps ${k} : écart de ${span} demi-tons`);
        if (g.length < 2 || song.autoFingering) continue;
        const f = [...g].sort((a, b) => a.midi - b.midi).map((n) => n.finger);
        assert.equal(new Set(f).size, f.length, `${raw.id} [${h}] temps ${k} : doigt répété dans l’accord`);
        for (let i = 1; i < f.length; i++) {
          assert.ok(h === 'R' ? f[i] > f[i - 1] : f[i] < f[i - 1], `${raw.id} [${h}] temps ${k} : doigts ${f.join('+')} dans le désordre`);
        }
      }
    }
  }
});

test('contenu : niveau 1, jamais le pouce sur une touche noire (sauf exception justifiée)', () => {
  for (const { raw, song } of prepared) {
    if (raw.level !== 1 || THUMB_ON_BLACK_OK[raw.id]) continue;
    for (const n of song.notes) assert.ok(!(n.finger === 1 && isBlack(n.midi)), `${raw.id} : pouce sur touche noire (${n.midi}) au temps ${n.start}`);
  }
});

test('contenu : chaque référence de morceau dans les cours existe', () => {
  for (const c of COURSES) {
    for (const l of c.lessons) {
      for (const b of l.blocks) {
        if (b.type !== 'practice') continue;
        const s = getSong(b.songId);
        assert.ok(s, `${l.id} : morceau inconnu « ${b.songId} »`);
        if (b.hands !== 'both') assert.ok(s.tracks[b.hands], `${l.id} : ${b.songId} n’a pas de main ${b.hands}`);
      }
    }
  }
});

test('contenu : exercices des cours, mesures complètes et doigtés jouables', () => {
  for (const c of COURSES) {
    for (const l of c.lessons) {
      for (const b of l.blocks.filter((x) => x.type === 'exercise')) {
        const s = prepareSong({ title: b.title, tracks: b.tracks, timeSig: b.timeSig, tempo: b.tempo });
        const bpm = beatsPerMeasure(b.timeSig);
        for (const h of ['R', 'L']) if (b.tracks[h]) assert.ok(isMultiple(parseTrack(b.tracks[h]).length, bpm), `${l.id} « ${b.title} » [${h}]`);
        if (l.level === 1) for (const n of s.notes) assert.ok(!(n.finger === 1 && isBlack(n.midi)), `${l.id} « ${b.title} » : pouce sur touche noire`);
      }
    }
  }
});

test('contenu : chaque morceau a sa provenance dans docs/SOURCES.md', () => {
  const md = readFileSync(new URL('../../docs/SOURCES.md', import.meta.url), 'utf8');
  for (const s of SONGS) assert.ok(md.includes('`' + s.id + '`'), `${s.id} absent de docs/SOURCES.md`);
});
