// Génère automatiquement un cours progressif pour n'importe quel morceau (bibliothèque ou importé) :
// découpage en phrases musicales (silences, notes longues, levées), mains séparées puis ensemble,
// d'abord en attente puis en rythme, tempo progressif, variantes rythmiques sur les passages difficiles,
// option « travail à rebours ». Module pur.
import { prepareSong } from './song.js';
import { midiToName, FINGER_NAMES } from './notes.js';

const EPS = 1e-6;
export const STEP_PASS = 80; // % pour réussir une étape
export const STEP_STREAK = 2; // réussites consécutives pour la valider
export const COURSE_STEPS_KEY = 'pianocoach.coursesteps';

function median(a) {
  if (!a.length) return 1;
  const s = [...a].sort((x, y) => x - y);
  return s[s.length >> 1];
}

/** Notes de la mélodie (main droite si présente, sinon tout). */
function melodyOf(song) {
  const r = song.notes.filter((n) => n.hand === 'R');
  return r.length ? r : song.notes;
}

/**
 * Qualité d'une frontière de phrase au début de la mesure k (indice 0) :
 * silence avant, note longue qui se termine, levée.
 * @returns {{score:number, from:number}} from = début réel de la phrase suivante (levée incluse)
 */
export function boundaryInfo(song, k) {
  const bpm = song.beatsPerMeasure;
  const b = k * bpm;
  const mel = melodyOf(song);
  const med = median(mel.map((n) => n.dur));
  let score = 0;
  // silence juste avant la barre (rien ne sonne dans le dernier quart de temps)
  const sounding = song.notes.some((n) => n.start < b - 0.25 + EPS && n.start + n.dur > b - 0.25 + EPS);
  const before = song.notes.filter((n) => n.start < b - EPS && n.start >= b - bpm - EPS);
  // levée : notes de la mélodie dans la fin de la mesure précédente, précédées d'un silence ou d'une note longue
  let from = b;
  const pick = mel.filter((n) => n.start < b - EPS && n.start >= b - Math.min(bpm, 2) - EPS).sort((x, y) => x.start - y.start);
  if (pick.length) {
    const ps = pick[0].start;
    const prev = mel.filter((n) => n.start < ps - EPS);
    const lastPrev = prev.length ? prev.reduce((a, c) => (c.start + c.dur > a.start + a.dur ? c : a)) : null;
    const gapBefore = !lastPrev || lastPrev.start + lastPrev.dur < ps - 0.25 + EPS;
    const longBefore = lastPrev && lastPrev.dur >= Math.max(1.5, med * 2) && Math.abs(lastPrev.start + lastPrev.dur - ps) < EPS;
    if ((gapBefore || longBefore) && b - ps <= bpm / 2 + EPS) {
      from = ps;
      score += gapBefore ? 2 : 1;
    }
  }
  if (from === b && before.length && !sounding) score += 2;
  // note longue qui se termine à la barre (ou à la levée)
  const endsLong = mel.some((n) => Math.abs(n.start + n.dur - from) < EPS && n.dur >= Math.max(1.5, med * 2));
  if (endsLong) score += 2;
  else if (mel.some((n) => Math.abs(n.start + n.dur - from) < EPS && n.dur >= med * 1.5 && n.dur > med)) score += 1;
  return { score, from };
}

/**
 * Découpe le morceau en phrases musicales (2 à 6 mesures, idéalement `target`).
 * @returns {Array<{from:number,to:number,notes:Array,firstMeasure:number,lastMeasure:number}>}
 */
export function smartPhrases(song, { target, min = 2, max = 6 } = {}) {
  const M = song.measureCount;
  const bpm = song.beatsPerMeasure;
  const tgt = target || (M <= 8 ? 2 : 4);
  const mn = Math.min(min, tgt), mx = Math.max(max, tgt);
  const cuts = [];
  let start = 0;
  while (start < M) {
    if (M - start <= mx && M - start < tgt + mn) {
      cuts.push(M);
      break;
    }
    let best = Math.min(M, start + tgt), bestVal = -Infinity;
    for (let k = start + mn; k <= Math.min(M - mn, start + mx); k++) {
      const { score } = boundaryInfo(song, k);
      const val = score * 1.0 - 0.45 * Math.abs(k - start - tgt);
      if (val > bestVal + EPS) {
        best = k;
        bestVal = val;
      }
    }
    cuts.push(best);
    start = best;
  }
  const res = [];
  let prevFrom = 0, prevM = 0;
  for (const k of cuts) {
    const to = k >= M ? song.totalBeats : boundaryInfo(song, k).from;
    const from = prevFrom;
    const notes = song.notes.filter((n) => n.start >= from - EPS && n.start < to - EPS);
    if (notes.length) res.push({ from, to, notes, firstMeasure: prevM + 1, lastMeasure: Math.max(prevM + 1, k) });
    prevFrom = to;
    prevM = k;
  }
  return res;
}

/** Difficulté d'un passage (déplacements de main, densité, notes rapides). */
export function passageDifficulty(notes, beats) {
  if (!notes.length) return 0;
  const density = notes.length / Math.max(1, beats);
  const fast = notes.filter((n) => n.dur <= 0.5 + EPS).length / notes.length;
  return countShifts(notes) + density * 1.5 + fast * 2;
}

/**
 * Variante rythmique d'un passage (technique de travail des traits) :
 * 'long-short' (croche pointée-double) ou 'short-long', sur les suites de notes de même durée (≤ 1 temps).
 * @returns {object} nouveau morceau préparé
 */
export function makeRhythmVariant(song, { from = 0, to = Infinity, pattern = 'long-short' } = {}) {
  const [fa, fb] = pattern === 'short-long' ? [0.5, 1.5] : [1.5, 0.5];
  const notes = song.notes.map((n) => ({ ...n }));
  for (const hand of ['R', 'L']) {
    const seq = notes.filter((n) => n.hand === hand && n.start >= from - EPS && n.start < to - EPS).sort((a, b) => a.start - b.start);
    // regroupe par instant d'attaque
    const groups = [];
    for (const n of seq) {
      const g = groups[groups.length - 1];
      if (g && Math.abs(g.start - n.start) < EPS) g.notes.push(n);
      else groups.push({ start: n.start, notes: [n] });
    }
    let i = 0;
    while (i + 1 < groups.length) {
      const a = groups[i], b = groups[i + 1];
      const d = Math.min(...a.notes.map((n) => n.dur));
      const db = Math.min(...b.notes.map((n) => n.dur));
      const regular = d <= 1 + EPS && Math.abs(d - db) < EPS && Math.abs(b.start - a.start - d) < EPS && a.notes.every((n) => Math.abs(n.dur - d) < EPS) && b.notes.every((n) => Math.abs(n.dur - d) < EPS);
      if (!regular) {
        i++;
        continue;
      }
      for (const n of a.notes) n.dur = d * fa;
      for (const n of b.notes) {
        n.start = a.start + d * fa;
        n.dur = d * fb;
      }
      i += 2;
    }
  }
  return prepareSong({ ...song, tracks: undefined, notes: notes.map(({ id, ...n }) => n), variant: pattern, id: song.id, title: song.title });
}

/**
 * @param {object} song
 * @param {{measuresPerPhrase?:number, backwards?:boolean, variants?:boolean}} [opts]
 * @returns {Array<{id:string, title:string, desc:string, hands:'R'|'L'|'both', from:number, to:number, tempoPct:number, mode:'wait'|'tempo'|'listen', notes?:Array, variant?:string}>}
 */
export function generateSongCourse(song, { measuresPerPhrase, backwards = false, variants = true } = {}) {
  const ph = smartPhrases(song, { target: measuresPerPhrase });
  const steps = [];
  const both = song.hands.R && song.hands.L;
  const single = song.hands.R ? 'R' : 'L';
  const handName = (h) => (h === 'R' ? 'main droite' : 'main gauche');
  steps.push({
    id: 'listen', title: 'Écoute le morceau', mode: 'listen', hands: 'both', from: 0, to: song.totalBeats, tempoPct: 100,
    desc: "Écoute d'abord le morceau en entier en suivant les touches qui s'allument. Repère le rythme et les passages qui reviennent.",
  });
  const order = ph.map((p, i) => i);
  if (backwards) order.reverse();
  const diffs = ph.map((p) => passageDifficulty(p.notes, p.to - p.from));
  const hardCut = diffs.length ? [...diffs].sort((a, b) => b - a)[Math.max(0, Math.floor(diffs.length / 3) - 0)] : Infinity;
  order.forEach((i, rank) => {
    const p = ph[i];
    const label = `Phrase ${i + 1} (mesures ${p.firstMeasure}–${p.lastMeasure})`;
    const base = { from: p.from, to: p.to };
    for (const hand of ['R', 'L']) {
      if (!song.hands[hand]) continue;
      const handNotes = p.notes.filter((n) => n.hand === hand);
      if (!handNotes.length) continue;
      steps.push({
        id: `p${i}-${hand}`, title: `${label} – ${handName(hand)}`, mode: 'wait', hands: hand, ...base, tempoPct: 60, notes: handNotes,
        desc: describePosition(handNotes, hand) + ' Joue lentement : la partition attend chaque bonne note.',
      });
    }
    if (both) {
      steps.push({ id: `p${i}-both`, title: `${label} – mains ensemble`, mode: 'wait', hands: 'both', ...base, tempoPct: 60, desc: 'Assemble les deux mains. Concentre-toi sur les notes qui tombent en même temps.' });
    }
    // mains séparées en rythme avant mains ensemble en rythme
    for (const hand of ['R', 'L']) {
      if (!song.hands[hand] || !p.notes.some((n) => n.hand === hand)) continue;
      steps.push({ id: `p${i}-${hand}-tempo`, title: `${label} – ${handName(hand)} en rythme`, mode: 'tempo', hands: hand, ...base, tempoPct: 65, desc: `La partition avance au tempo : ${handName(hand)} seule, compte bien les temps.` });
    }
    if (variants && diffs[i] >= hardCut && diffs[i] > 2 && p.notes.some((n) => n.dur <= 1 + EPS)) {
      for (const [v, name] of [['long-short', 'long-court'], ['short-long', 'court-long']]) {
        steps.push({ id: `p${i}-var-${v}`, title: `${label} – variante rythmique ${name}`, mode: 'tempo', hands: both ? 'both' : single, ...base, tempoPct: 60, variant: v, desc: `Passage difficile : joue les notes régulières en rythme ${name} (pointé). Cela renforce les doigts et la mémoire ; ensuite le rythme normal paraîtra plus facile.` });
      }
    }
    steps.push({
      id: `p${i}-tempo`, title: `${label} – ${both ? 'mains ensemble ' : ''}en rythme`, mode: 'tempo', hands: both ? 'both' : single, ...base, tempoPct: 70,
      desc: `Même passage${both ? ', mains ensemble' : ''}, au tempo : vise ${STEP_PASS} % deux fois de suite avant de passer à la suite.`,
    });
    // enchaînement avec la phrase voisine déjà travaillée
    if (rank > 0 && rank % 2 === 1) {
      const j = order[rank - 1];
      const a = ph[Math.min(i, j)], b = ph[Math.max(i, j)];
      steps.push({ id: `link${Math.min(i, j)}-${Math.max(i, j)}`, title: `Enchaîner les phrases ${Math.min(i, j) + 1} et ${Math.max(i, j) + 1}`, mode: 'tempo', hands: both ? 'both' : single, from: a.from, to: b.to, tempoPct: 75, desc: "Relie les phrases sans t'arrêter entre elles." });
    }
  });
  steps.push({ id: 'full-slow', title: 'Morceau complet – tempo lent', mode: 'tempo', hands: both ? 'both' : single, from: 0, to: song.totalBeats, tempoPct: 75, desc: 'Tout le morceau à 75 % du tempo.' });
  steps.push({ id: 'full', title: 'Morceau complet – tempo réel', mode: 'tempo', hands: both ? 'both' : single, from: 0, to: song.totalBeats, tempoPct: 100, desc: "Objectif : 3 étoiles au tempo d'origine !" });
  return steps;
}

// ---------- validation des étapes : 80 % deux fois de suite ----------
function readSteps(storage) {
  try {
    const raw = (storage || globalThis.localStorage)?.getItem(COURSE_STEPS_KEY);
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/** Pur : met à jour l'état d'une étape avec un nouveau score. */
export function updateStepState(prev, score, now = Date.now()) {
  const st = { streak: 0, best: 0, validated: false, tries: 0, ...(prev || {}) };
  st.tries++;
  st.best = Math.max(st.best, score);
  st.streak = score >= STEP_PASS ? st.streak + 1 : 0;
  st.last = now;
  const justValidated = !st.validated && st.streak >= STEP_STREAK;
  if (justValidated) st.validated = now;
  return { state: st, justValidated };
}

/** Enregistre un résultat d'étape dans `pianocoach.coursesteps`. */
export function recordStepResult(key, score, storage) {
  const all = readSteps(storage);
  const { state, justValidated } = updateStepState(all[key], score);
  all[key] = state;
  try {
    (storage || globalThis.localStorage)?.setItem(COURSE_STEPS_KEY, JSON.stringify(all));
  } catch {}
  return { ...state, justValidated, remaining: Math.max(0, STEP_STREAK - state.streak) };
}

export function stepState(key, storage) {
  return readSteps(storage)[key] || null;
}

/** Défi « 3 fois juste d'affilée » (sur une mesure difficile). */
export function createRepeatChallenge(target = 3, threshold = 100) {
  return {
    target, threshold, count: 0, done: false,
    record(score) {
      if (this.done) return { count: this.count, done: true, reset: false };
      const ok = score >= this.threshold;
      const reset = !ok && this.count > 0;
      this.count = ok ? this.count + 1 : 0;
      this.done = this.count >= this.target;
      return { count: this.count, done: this.done, reset, ok };
    },
  };
}


/** Décrit la position de main (notes extrêmes, doigts) pour un passage. */
export function describePosition(notes, hand, settings = {}) {
  if (!notes.length) return '';
  const lang = settings.notation || 'fr';
  const sorted = [...notes].sort((a, b) => a.midi - b.midi);
  const lo = sorted[0], hi = sorted[sorted.length - 1];
  const first = [...notes].sort((a, b) => a.start - b.start)[0];
  const name = (m) => midiToName(m, { lang });
  const handName = hand === 'L' ? 'main gauche' : 'main droite';
  let s = `${handName[0].toUpperCase() + handName.slice(1)} : de ${name(lo.midi)} à ${name(hi.midi)}. `;
  s += `Commence sur ${name(first.midi)} avec le doigt ${first.finger || '?'}${first.finger ? ` (${FINGER_NAMES[first.finger]})` : ''}.`;
  const shifts = countShifts(notes);
  if (shifts > 0) s += ` Attention : ${shifts} déplacement${shifts > 1 ? 's' : ''} de main (passage du pouce ou saut).`;
  return s;
}

/** Nombre de changements de position (même doigt sur notes différentes, ou passage du pouce). */
export function countShifts(notes) {
  const seq = [...notes].sort((a, b) => a.start - b.start || a.midi - b.midi);
  let n = 0;
  for (let i = 1; i < seq.length; i++) {
    const a = seq[i - 1], b = seq[i];
    if (!a.finger || !b.finger || a.start === b.start) continue;
    const d = b.midi - a.midi;
    const fd = b.finger - a.finger;
    if (a.midi !== b.midi && (fd === 0 || Math.sign(d) !== Math.sign(fd) * (a.hand === 'L' ? -1 : 1))) n++;
  }
  return n;
}
