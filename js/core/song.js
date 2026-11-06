// Modèle de morceau + notation texte compacte.
//
// Notation compacte (utilisée par la bibliothèque et le format d'import « texte ») :
//   NOTE:DURÉE:DOIGT       ex. « E4:1:3 » = Mi4, une noire, doigt 3
//   accords                ex. « C3+E3+G3:2:5+3+1 »
//   silences               ex. « r:1 »
//   « | » barres de mesure (ignorées, juste pour la lisibilité)
// Durées en temps (noire = 1, croche = 0.5, blanche = 2, « 1/3 » pour un triolet…).
import { nameToMidi, midiToName } from './notes.js';
import { autoFingering } from './fingering.js';

const EPS = 1e-6;

export function parseDuration(s) {
  if (s == null || s === '') return 1;
  if (s.includes('/')) {
    const [a, b] = s.split('/').map(Number);
    if (!b) throw new Error(`Durée invalide : « ${s} »`);
    return a / b;
  }
  const v = Number(s);
  if (!Number.isFinite(v) || v <= 0) throw new Error(`Durée invalide : « ${s} »`);
  return v;
}

/**
 * Lit une piste en notation compacte.
 * @returns {{notes: Array, length: number}}
 */
export function parseTrack(str, hand = 'R', startAt = 0) {
  const notes = [];
  let t = startAt;
  const tokens = String(str || '').split(/\s+/).filter((x) => x && x !== '|' && x !== '||');
  for (const tok of tokens) {
    const parts = tok.split(':');
    const head = parts[0];
    const dur = parseDuration(parts[1]);
    if (/^(r|z|-|_)$/i.test(head)) {
      t += dur;
      continue;
    }
    const names = head.split('+');
    const fingers = parts[2] ? parts[2].split('+').map((f) => (f === '' || f === '?' ? null : Number(f))) : [];
    names.forEach((nm, i) => {
      const midi = nameToMidi(nm);
      if (midi == null) throw new Error(`Note inconnue : « ${nm} » (dans « ${tok} »)`);
      const f = fingers[i];
      notes.push({ midi, start: t, dur, hand, finger: f >= 1 && f <= 5 ? f : null });
    });
    t += dur;
  }
  return { notes, length: t - startAt };
}

/** Réécrit une liste de notes (une main) en notation compacte. */
export function serializeTrack(notes, { fingers = true } = {}) {
  const groups = groupByStart(notes);
  const out = [];
  let t = 0;
  for (const g of groups) {
    if (g.start > t + EPS) out.push(`r:${fmt(g.start - t)}`);
    const sorted = [...g.notes].sort((a, b) => a.midi - b.midi);
    const dur = Math.min(...sorted.map((n) => n.dur));
    let tok = sorted.map((n) => midiToName(n.midi, { lang: 'en' })).join('+') + ':' + fmt(dur);
    if (fingers && sorted.some((n) => n.finger)) tok += ':' + sorted.map((n) => n.finger || '?').join('+');
    out.push(tok);
    t = g.start + dur;
  }
  return out.join(' ');
}

function fmt(x) {
  return String(Math.round(x * 1000) / 1000);
}

export function groupByStart(notes) {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.midi - b.midi);
  const groups = [];
  for (const n of sorted) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(last.start - n.start) < EPS) {
      last.notes.push(n);
      last.dur = Math.max(last.dur, n.dur);
    } else groups.push({ start: n.start, dur: n.dur, notes: [n] });
  }
  return groups;
}

export function beatsPerMeasure(timeSig = [4, 4]) {
  return (timeSig[0] * 4) / timeSig[1];
}

let uid = 0;

/**
 * Normalise un morceau (bibliothèque ou import) : notes triées, doigtés complétés, mesures calculées.
 */
export function prepareSong(raw) {
  const song = { timeSig: [4, 4], tempo: 90, level: 1, genre: 'divers', composer: 'Inconnu', keyFifths: 0, ...raw };
  let notes = [];
  if (raw.tracks) {
    if (raw.tracks.R) notes.push(...parseTrack(raw.tracks.R, 'R').notes);
    if (raw.tracks.L) notes.push(...parseTrack(raw.tracks.L, 'L').notes);
  }
  if (Array.isArray(raw.notes)) notes.push(...raw.notes.map((n) => ({ hand: 'R', finger: null, ...n })));
  notes = notes
    .filter((n) => Number.isFinite(n.midi) && n.midi >= 0 && n.midi <= 127 && n.dur > 0)
    .sort((a, b) => a.start - b.start || a.midi - b.midi)
    .map((n) => ({ ...n, id: ++uid }));

  const missing = notes.some((n) => !n.finger);
  if (missing) {
    for (const hand of ['R', 'L']) autoFingering(notes.filter((n) => n.hand === hand), hand);
  }
  song.autoFingering = missing;
  song.notes = notes;
  song.beatsPerMeasure = beatsPerMeasure(song.timeSig);
  song.totalBeats = notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0);
  song.measureCount = Math.max(1, Math.ceil(song.totalBeats / song.beatsPerMeasure - EPS));
  song.hands = { R: notes.some((n) => n.hand === 'R'), L: notes.some((n) => n.hand === 'L') };
  const midis = notes.map((n) => n.midi);
  song.range = midis.length ? { lo: Math.min(...midis), hi: Math.max(...midis) } : { lo: 60, hi: 72 };
  return song;
}

/** Événements (notes simultanées regroupées) filtrés par main et intervalle de temps. */
export function buildEvents(song, { hands = 'both', from = 0, to = Infinity } = {}) {
  const notes = song.notes.filter(
    (n) => (hands === 'both' || n.hand === hands) && n.start >= from - EPS && n.start < to - EPS,
  );
  return groupByStart(notes).map((g, i) => ({ ...g, index: i, midis: [...new Set(g.notes.map((n) => n.midi))] }));
}

export function transposeSong(song, semis) {
  if (!semis) return song;
  return prepareSong({
    ...song,
    tracks: undefined,
    notes: song.notes.map((n) => ({ ...n, midi: n.midi + semis, finger: song.autoFingering ? null : n.finger })),
    title: song.title,
    transposed: (song.transposed || 0) + semis,
  });
}

export function measureOf(song, beat) {
  return Math.floor(beat / song.beatsPerMeasure + EPS);
}

/** Découpe le morceau en phrases de N mesures (pour les cours progressifs). */
export function phrases(song, measuresPerPhrase = 4) {
  const res = [];
  const span = measuresPerPhrase * song.beatsPerMeasure;
  for (let from = 0; from < song.totalBeats - EPS; from += span) {
    const to = Math.min(from + span, song.totalBeats);
    const notes = song.notes.filter((n) => n.start >= from - EPS && n.start < to - EPS);
    if (notes.length) res.push({ from, to, notes, firstMeasure: Math.round(from / song.beatsPerMeasure) + 1, lastMeasure: Math.ceil(to / song.beatsPerMeasure - EPS) });
  }
  return res;
}

/** Format texte simple, lisible et éditable à la main (import / export). */
export function parseTextSong(text) {
  const meta = {};
  const R = [], L = [];
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-zéèêÉ ]+)\s*:\s*(.*)$/);
    if (m && !/^[A-Ga-g][#b]?-?\d/.test(line)) {
      const key = m[1].trim().toLowerCase();
      const val = m[2].trim();
      if (['md', 'rh', 'r', 'main droite'].includes(key)) R.push(val);
      else if (['mg', 'lh', 'l', 'main gauche'].includes(key)) L.push(val);
      else if (['titre', 'title'].includes(key)) meta.title = val;
      else if (['compositeur', 'composer', 'auteur'].includes(key)) meta.composer = val;
      else if (['tempo', 'bpm'].includes(key)) meta.tempo = Number(val) || 90;
      else if (['mesure', 'time', 'signature'].includes(key)) {
        const [a, b] = val.split('/').map(Number);
        if (a && b) meta.timeSig = [a, b];
      } else if (['genre', 'style'].includes(key)) meta.genre = val;
      else if (['niveau', 'level'].includes(key)) meta.level = Number(val) || 1;
      continue;
    }
    R.push(line);
  }
  if (!R.length && !L.length) throw new Error('Aucune note trouvée dans le texte.');
  return { title: 'Morceau importé', ...meta, tracks: { R: R.join(' '), L: L.join(' ') } };
}

export function songToText(song) {
  const lines = [
    `titre: ${song.title}`,
    `compositeur: ${song.composer || ''}`,
    `tempo: ${song.tempo}`,
    `mesure: ${song.timeSig[0]}/${song.timeSig[1]}`,
  ];
  const R = song.notes.filter((n) => n.hand === 'R');
  const L = song.notes.filter((n) => n.hand === 'L');
  if (R.length) lines.push(`MD: ${serializeTrack(R)}`);
  if (L.length) lines.push(`MG: ${serializeTrack(L)}`);
  return lines.join('\n') + '\n';
}
