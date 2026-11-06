// Vérifie la cohérence des données de contenu : bibliothèque de morceaux et cours.
import test from 'node:test';
import assert from 'node:assert/strict';

import { SONGS, GENRES, getSong, songsByGenre } from '../../js/data/songs.js';
import { COURSES, getCourse, getLesson, allLessons } from '../../js/data/lessons.js';
import { prepareSong, parseTrack, beatsPerMeasure } from '../../js/core/song.js';

const EPS = 1e-6;
const isMultiple = (x, m) => Math.abs(x / m - Math.round(x / m)) < EPS;

/** Vérifie une piste : longueur totale et chaque segment entre « | » multiples de la mesure. */
function checkTrack(str, timeSig, where) {
  const bpm = beatsPerMeasure(timeSig);
  const { length } = parseTrack(str);
  assert.ok(length > 0, `${where} : piste vide`);
  assert.ok(isMultiple(length, bpm), `${where} : longueur ${length} n'est pas un multiple de ${bpm}`);
  str.split('|').forEach((seg, i) => {
    if (!seg.trim()) return;
    const l = parseTrack(seg).length;
    assert.ok(l > EPS && isMultiple(l, bpm), `${where} : segment n°${i + 1} « ${seg.trim()} » dure ${l} temps (mesure = ${bpm})`);
  });
  // Doigtés explicites dans la notation : 1 à 5
  for (const tok of str.split(/\s+/).filter((t) => t && t !== '|')) {
    const parts = tok.split(':');
    if (parts[2]) {
      for (const f of parts[2].split('+')) {
        assert.ok(/^[1-5]$/.test(f), `${where} : doigt invalide « ${f} » dans « ${tok} »`);
      }
      assert.equal(parts[2].split('+').length, parts[0].split('+').length, `${where} : nombre de doigts ≠ nombre de notes dans « ${tok} »`);
    }
  }
  return length;
}

function checkTracks(tracks, timeSig, where) {
  assert.ok(tracks && (tracks.R || tracks.L), `${where} : aucune piste`);
  const lens = {};
  for (const h of ['R', 'L']) if (tracks[h]) lens[h] = checkTrack(tracks[h], timeSig, `${where} [${h}]`);
  if (lens.R != null && lens.L != null) assert.ok(Math.abs(lens.R - lens.L) < EPS, `${where} : MD (${lens.R}) et MG (${lens.L}) de longueurs différentes`);
}

test('genres : identifiants uniques et champs requis', () => {
  const ids = GENRES.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const g of GENRES) {
    assert.ok(g.name && g.emoji && g.description, g.id);
    assert.match(g.color, /^#[0-9a-f]{6}$/i, g.id);
  }
  for (const id of ['debutant', 'classique', 'comptines', 'noel', 'folk', 'gospel', 'jazz', 'ragtime', 'pop', 'technique']) {
    assert.ok(ids.includes(id), `genre manquant : ${id}`);
  }
});

test('morceaux : identifiants uniques, métadonnées valides', () => {
  const ids = SONGS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'identifiants en double');
  const genreIds = new Set(GENRES.map((g) => g.id));
  for (const s of SONGS) {
    assert.ok(genreIds.has(s.genre), `${s.id} : genre inconnu ${s.genre}`);
    assert.ok(Number.isInteger(s.level) && s.level >= 1 && s.level <= 5, `${s.id} : niveau`);
    assert.ok(s.tempo > 20 && s.tempo < 300, `${s.id} : tempo`);
    assert.ok(Array.isArray(s.timeSig) && s.timeSig.length === 2, `${s.id} : mesure`);
    assert.ok(Number.isInteger(s.keyFifths) && Math.abs(s.keyFifths) <= 7, `${s.id} : armure`);
    assert.ok(s.title && s.composer && s.description && Array.isArray(s.tags), `${s.id} : champs`);
    assert.equal(getSong(s.id), s);
  }
  assert.equal(getSong('nexiste-pas'), null);
});

test('chaque genre a au moins 3 morceaux, et tous les niveaux 1 à 5 sont représentés', () => {
  for (const g of GENRES) assert.ok(songsByGenre(g.id).length >= 3, `${g.id} : ${songsByGenre(g.id).length} morceau(x)`);
  const levels = new Set(SONGS.map((s) => s.level));
  for (let l = 1; l <= 5; l++) assert.ok(levels.has(l), `aucun morceau de niveau ${l}`);
});

test('morceaux : mesures complètes pour chaque main', () => {
  for (const s of SONGS) checkTracks(s.tracks, s.timeSig, s.id);
});

test('morceaux : prepareSong, doigtés 1-5, tessiture du piano', () => {
  for (const raw of SONGS) {
    const song = prepareSong(raw);
    assert.ok(song.notes.length > 0, raw.id);
    for (const n of song.notes) {
      assert.ok(n.midi >= 21 && n.midi <= 108, `${raw.id} : note hors clavier ${n.midi}`);
      assert.ok(Number.isInteger(n.finger) && n.finger >= 1 && n.finger <= 5, `${raw.id} : doigt ${n.finger}`);
      assert.ok(n.hand === 'R' || n.hand === 'L');
    }
  }
});

test('morceaux débutants (niveaux 1-2) : doigtés explicites', () => {
  for (const s of SONGS.filter((x) => x.level <= 2)) {
    assert.equal(prepareSong(s).autoFingering, false, `${s.id} : doigtés manquants`);
  }
});

test('cours : structure, identifiants uniques', () => {
  const genreIds = new Set(GENRES.map((g) => g.id));
  const courseIds = COURSES.map((c) => c.id);
  assert.equal(new Set(courseIds).size, courseIds.length);
  assert.ok(courseIds.includes('bases'));
  for (const c of COURSES) {
    assert.ok(genreIds.has(c.genre), `${c.id} : genre ${c.genre}`);
    assert.ok(c.title && c.description && c.lessons.length >= 3, c.id);
    assert.equal(getCourse(c.id), c);
  }
  for (const g of GENRES) assert.ok(COURSES.some((c) => c.genre === g.id), `pas de cours pour ${g.id}`);
  const lessonIds = allLessons().map((l) => l.id);
  assert.equal(new Set(lessonIds).size, lessonIds.length, 'identifiants de leçon en double');
  for (const id of lessonIds) {
    const r = getLesson(id);
    assert.ok(r && r.course && r.lesson.id === id);
  }
  assert.equal(getLesson('inconnue'), null);
});

test('leçons : blocs valides', () => {
  const types = new Set(['text', 'keys', 'tip', 'warning', 'quiz', 'practice', 'exercise']);
  for (const c of COURSES) {
    for (const l of c.lessons) {
      const where = `${c.id}/${l.id}`;
      assert.ok(l.title && l.duration > 0 && l.level >= 1 && l.level <= 5, where);
      assert.ok(Array.isArray(l.blocks) && l.blocks.length > 0, where);
      for (const [i, b] of l.blocks.entries()) {
        const w = `${where} bloc ${i} (${b.type})`;
        assert.ok(types.has(b.type), w);
        if (b.type === 'text' || b.type === 'tip' || b.type === 'warning') assert.ok(typeof b.html === 'string' && b.html.length > 10, w);
        if (b.type === 'quiz') {
          assert.ok(b.question && Array.isArray(b.choices) && b.choices.length >= 2, w);
          assert.ok(Number.isInteger(b.answer) && b.answer >= 0 && b.answer < b.choices.length, `${w} : réponse invalide`);
          assert.ok(b.explain, w);
        }
        if (b.type === 'practice') {
          assert.ok(getSong(b.songId), `${w} : morceau inconnu ${b.songId}`);
          assert.ok(['R', 'L', 'both'].includes(b.hands), w);
          if (b.hands !== 'both') assert.ok(getSong(b.songId).tracks[b.hands], `${w} : la main ${b.hands} n'existe pas`);
          assert.ok(b.tempoPct > 0 && b.tempoPct <= 150, w);
        }
        if (b.type === 'exercise') {
          assert.ok(b.title && b.tempo > 0 && Array.isArray(b.timeSig), w);
          assert.ok(['R', 'L', 'both'].includes(b.hands), w);
          checkTracks(b.tracks, b.timeSig, w);
          const song = prepareSong({ title: b.title, tracks: b.tracks, timeSig: b.timeSig, tempo: b.tempo });
          for (const n of song.notes) assert.ok(n.midi >= 21 && n.midi <= 108 && n.finger >= 1 && n.finger <= 5, w);
        }
        if (b.type === 'keys') {
          assert.ok(Array.isArray(b.notes) && b.notes.length > 0, w);
          for (const n of b.notes) {
            const t = parseTrack(n.name);
            assert.equal(t.notes.length, 1, `${w} : note ${n.name}`);
            if (n.finger != null) assert.ok(n.finger >= 1 && n.finger <= 5, w);
            if (n.hand != null) assert.ok(n.hand === 'R' || n.hand === 'L', w);
          }
        }
      }
    }
  }
});
