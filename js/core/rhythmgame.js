// Jeu « Tape le rythme » : génération de mesures rythmiques par niveau, comptage, évaluation des frappes.
// Logique pure (temps en noires pour les motifs, en secondes pour l'évaluation).
import { pick, weightedIndex } from './reading.js';

const T = 1 / 3;
/** Cellules rythmiques : durées en noires, négatif = silence. */
export const RHYTHM_CELLS = {
  w: { beats: 4, durs: [4], name: 'ronde' },
  h: { beats: 2, durs: [2], name: 'blanche' },
  q: { beats: 1, durs: [1], name: 'noire' },
  qr: { beats: 1, durs: [-1], name: 'soupir' },
  hr: { beats: 2, durs: [-2], name: 'demi-pause' },
  ee: { beats: 1, durs: [0.5, 0.5], name: '2 croches' },
  er_e: { beats: 1, durs: [-0.5, 0.5], name: 'demi-soupir + croche' },
  e_er: { beats: 1, durs: [0.5, -0.5], name: 'croche + demi-soupir' },
  dh: { beats: 3, durs: [3], name: 'blanche pointée' },
  dq_e: { beats: 2, durs: [1.5, 0.5], name: 'noire pointée + croche' },
  e_q_e: { beats: 2, durs: [0.5, 1, 0.5], name: 'syncope' },
  trip: { beats: 1, durs: [T, T, T], tuplet: 3, name: 'triolet' },
  ssss: { beats: 1, durs: [0.25, 0.25, 0.25, 0.25], name: '4 doubles croches' },
  e_ss: { beats: 1, durs: [0.5, 0.25, 0.25], name: 'croche + 2 doubles' },
  ss_e: { beats: 1, durs: [0.25, 0.25, 0.5], name: '2 doubles + croche' },
  de_s: { beats: 1, durs: [0.75, 0.25], name: 'croche pointée + double' },
};

/** 10 niveaux ; `focus` = cellules nouvelles, plus fréquentes et présentes au moins une fois. */
export const RHYTHM_LEVELS = [
  { id: 1, name: 'Noires et blanches', cells: ['q', 'h', 'w'], focus: [], tempo: 70 },
  { id: 2, name: 'Silences', cells: ['q', 'h', 'qr', 'hr'], focus: ['qr'], tempo: 72 },
  { id: 3, name: 'Croches', cells: ['q', 'h', 'ee', 'qr'], focus: ['ee'], tempo: 72 },
  { id: 4, name: 'Demi-soupirs', cells: ['q', 'ee', 'er_e', 'e_er', 'qr', 'h'], focus: ['er_e', 'e_er'], tempo: 74 },
  { id: 5, name: 'Notes pointées', cells: ['q', 'ee', 'dh', 'dq_e', 'h'], focus: ['dq_e', 'dh'], tempo: 76 },
  { id: 6, name: 'Syncopes', cells: ['q', 'ee', 'e_q_e', 'dq_e', 'qr'], focus: ['e_q_e'], tempo: 78 },
  { id: 7, name: 'Triolets', cells: ['q', 'ee', 'trip', 'h', 'qr'], focus: ['trip'], tempo: 72 },
  { id: 8, name: 'Doubles croches', cells: ['q', 'ee', 'ssss', 'e_ss', 'ss_e'], focus: ['ssss', 'e_ss', 'ss_e'], tempo: 66 },
  { id: 9, name: 'Croches pointées', cells: ['q', 'ee', 'de_s', 'ssss', 'er_e', 'e_q_e'], focus: ['de_s'], tempo: 68 },
  { id: 10, name: 'Grand mélange', cells: ['q', 'ee', 'er_e', 'dq_e', 'e_q_e', 'trip', 'ssss', 'e_ss', 'de_s', 'qr', 'h'], focus: [], tempo: 76 },
];
export const getRhythmLevel = (id) => RHYTHM_LEVELS.find((l) => l.id === Number(id)) || RHYTHM_LEVELS[0];

const EPS = 1e-6;

/** Transforme une liste de cellules en événements {start, dur, rest, cell, tuplet?}. */
export function cellsToPattern(cellIds, beats = 4) {
  const events = [];
  let t = 0;
  for (const id of cellIds) {
    const c = RHYTHM_CELLS[id];
    for (const d of c.durs) {
      events.push({ start: round(t), dur: round(Math.abs(d)), rest: d < 0, cell: id, ...(c.tuplet ? { tuplet: c.tuplet } : {}) });
      t += Math.abs(d);
    }
  }
  return { beats, cells: [...cellIds], events };
}
function round(x) {
  return Math.round(x * 1e6) / 1e6;
}

/** Génère une mesure de 4 temps pour un niveau. */
export function generateRhythm(levelId = 1, rng = Math.random, { beats = 4 } = {}) {
  const lv = getRhythmLevel(levelId);
  for (let attempt = 0; attempt < 40; attempt++) {
    const cells = [];
    let t = 0;
    while (t < beats - EPS) {
      const rem = beats - t;
      // cellules longues seulement sur un temps fort (1 ou 3) sauf la blanche pointée (1 ou 2)
      const cand = lv.cells.filter((id) => {
        const c = RHYTHM_CELLS[id];
        if (c.beats > rem + EPS) return false;
        if (c.beats === 2 && id !== 'e_q_e' && t % 2 !== 0) return false;
        if (c.beats === 4 && t !== 0) return false;
        return true;
      });
      const w = cand.map((id) => (lv.focus.includes(id) ? 2.2 : id === 'w' ? 0.3 : 1));
      const id = cand[weightedIndex(rng, w)];
      cells.push(id);
      t += RHYTHM_CELLS[id].beats;
    }
    const p = cellsToPattern(cells, beats);
    const notes = p.events.filter((e) => !e.rest).length;
    if (notes < 2) continue;
    if (lv.focus.length && !cells.some((c) => lv.focus.includes(c)) && attempt < 30) continue;
    if (p.events[0].rest && levelId < 4) continue;
    return p;
  }
  return cellsToPattern(['q', 'q', 'q', 'q'], beats);
}

/** Instants d'attaque (en temps) des notes non silencieuses. */
export function onsetsOf(pattern) {
  return pattern.events.filter((e) => !e.rest).map((e) => e.start);
}

/** Signature textuelle (pour comparer deux motifs). */
export function rhythmSignature(pattern) {
  return pattern.events.map((e) => (e.rest ? 'r' : '') + Math.round(e.dur * 1000)).join(' ');
}

/** Syllabe de comptage d'un instant : « 1 », « et », « ti » (doubles), « la »/« li » (triolets). */
export function countSyllable(start) {
  const beat = Math.floor(start + EPS);
  const f = start - beat;
  if (f < EPS || f > 1 - EPS) return String(beat + 1);
  if (Math.abs(f - 0.5) < 0.01) return 'et';
  if (Math.abs(f - 0.25) < 0.01 || Math.abs(f - 0.75) < 0.01) return 'ti';
  if (Math.abs(f - 1 / 3) < 0.01) return 'la';
  if (Math.abs(f - 2 / 3) < 0.01) return 'li';
  return '·';
}
/** Syllabe pour chaque événement (silences entre parenthèses). */
export function countLabels(pattern) {
  return pattern.events.map((e) => (e.rest ? `(${countSyllable(e.start)})` : countSyllable(e.start)));
}
/** Grille de comptage « 1 et 2 et 3 et 4 et ». */
export function countGrid(beats = 4) {
  const out = [];
  for (let b = 0; b < beats; b++) out.push({ at: b, label: String(b + 1) }, { at: b + 0.5, label: 'et' });
  return out;
}

/**
 * Compare les frappes de l'élève aux attaques attendues (secondes, même origine).
 * Vert < good (80 ms), orange < ok (150 ms), au-delà : ratée. Frappes non associées = en trop.
 * @returns {{matches:[{expected, tap, delta, grade}], extras:number[], good, ok, miss, score, stars, meanDelta}}
 */
export function evaluateTaps(expected, taps, { good = 0.08, ok = 0.15, window = 0.3 } = {}) {
  const sorted = [...taps].sort((a, b) => a - b);
  const used = new Set();
  const matches = [];
  let from = 0;
  for (let k = 0; k < expected.length; k++) {
    const e = expected[k];
    const next = expected[k + 1];
    let best = -1, bd = Infinity;
    for (let i = from; i < sorted.length; i++) {
      const d = sorted[i] - e;
      if (d < -window) continue;
      if (d > window) break;
      // une frappe plus proche de l'attaque suivante lui revient
      if (next != null && Math.abs(sorted[i] - next) < Math.abs(d)) break;
      if (Math.abs(d) < bd) {
        bd = Math.abs(d);
        best = i;
      }
    }
    if (best >= 0 && bd < ok) {
      used.add(best);
      from = best + 1;
      const delta = sorted[best] - e;
      matches.push({ expected: e, tap: sorted[best], delta, grade: Math.abs(delta) < good ? 'good' : 'ok' });
    } else if (best >= 0) {
      used.add(best);
      from = best + 1;
      matches.push({ expected: e, tap: sorted[best], delta: sorted[best] - e, grade: 'miss' });
    } else matches.push({ expected: e, tap: null, delta: null, grade: 'miss' });
  }
  const extras = sorted.filter((_, i) => !used.has(i));
  const nGood = matches.filter((m) => m.grade === 'good').length;
  const nOk = matches.filter((m) => m.grade === 'ok').length;
  const nMiss = matches.length - nGood - nOk;
  const n = Math.max(1, expected.length);
  const score = Math.max(0, Math.min(100, Math.round((100 * (nGood + 0.6 * nOk)) / n - 10 * extras.length)));
  const timed = matches.filter((m) => m.grade !== 'miss');
  const meanDelta = timed.length ? timed.reduce((s, m) => s + m.delta, 0) / timed.length : 0;
  return { matches, extras, good: nGood, ok: nOk, miss: nMiss, score, stars: starsFor(score), meanDelta };
}

export function starsFor(score) {
  return score >= 90 ? 3 : score >= 70 ? 2 : score >= 45 ? 1 : 0;
}

/** Tendance lisible : « en avance de 30 ms », « en retard… », « bien calé ». */
export function tendencyText(meanDelta) {
  const ms = Math.round(meanDelta * 1000);
  if (Math.abs(ms) < 25) return 'bien calé sur le tempo';
  return ms < 0 ? `en avance de ${-ms} ms en moyenne` : `en retard de ${ms} ms en moyenne`;
}

/** Variante différente d'un motif (pour les distracteurs de la dictée rythmique). */
export function rhythmVariants(pattern, levelId, rng, n = 3) {
  const out = [];
  const seen = new Set([rhythmSignature(pattern)]);
  for (let i = 0; i < 80 && out.length < n; i++) {
    let cand;
    if (i % 2 === 0 && pattern.cells.length > 1) {
      // on change une seule cellule de même longueur : distracteur proche
      const lv = getRhythmLevel(levelId);
      const k = Math.floor(rng() * pattern.cells.length);
      const beats = RHYTHM_CELLS[pattern.cells[k]].beats;
      const alt = lv.cells.filter((c) => RHYTHM_CELLS[c].beats === beats && c !== pattern.cells[k]);
      if (!alt.length) continue;
      const cells = [...pattern.cells];
      cells[k] = pick(rng, alt);
      cand = cellsToPattern(cells, pattern.beats);
    } else cand = generateRhythm(levelId, rng, { beats: pattern.beats });
    const sig = rhythmSignature(cand);
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(cand);
  }
  return out;
}
