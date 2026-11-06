// Doigté automatique (programmation dynamique, inspiré du modèle de Parncutt).
// Sert quand une partition importée ne contient pas de doigtés.
import { isBlack } from './notes.js';

// Écarts (en demi-tons) pour la main droite entre deux doigts a<b :
// [MinPrac, MinComf, MinRel, MaxRel, MaxComf, MaxPrac]
const SPANS = {
  '1-2': [-5, -3, 1, 2, 8, 10],
  '1-3': [-4, -2, 3, 4, 10, 12],
  '1-4': [-3, -1, 5, 6, 12, 14],
  '1-5': [-1, 1, 7, 8, 13, 15],
  '2-3': [1, 1, 1, 2, 3, 5],
  '2-4': [1, 1, 3, 4, 5, 7],
  '2-5': [2, 2, 5, 6, 8, 10],
  '3-4': [1, 1, 1, 2, 2, 4],
  '3-5': [1, 1, 3, 4, 5, 7],
  '4-5': [1, 1, 1, 2, 3, 5],
};

/** Coût de passage du doigt f1 (note n1) au doigt f2 (note n2), main droite. */
export function transitionCost(n1, f1, n2, f2) {
  let d = n2 - n1;
  if (f1 === f2) return d === 0 ? 0 : 4 + Math.abs(d);
  if (Math.abs(d) > 15) return 4; // saut : la main se déplace, peu importe le doigt
  let a = f1, b = f2;
  if (a > b) {
    [a, b] = [b, a];
    d = -d;
  }
  const [minP, minC, minR, maxR, maxC, maxP] = SPANS[`${a}-${b}`];
  let cost = 0;
  if (d < minR) cost += minR - d;
  if (d > maxR) cost += d - maxR;
  if (d < minC) cost += 2 * (minC - d);
  if (d > maxC) cost += 2 * (d - maxC);
  if (d < minP || d > maxP) cost += 10;
  // Passage du pouce / croisement : acceptable mais pas gratuit
  if ((f1 === 1 && n2 < n1 && f2 > 1) || (f2 === 1 && n2 > n1 && f1 > 1)) cost += 1;
  // Les doigts 3-4-5 ensemble sont peu indépendants
  if ((a === 3 && b === 4) || (a === 4 && b === 5)) cost += 1;
  return cost;
}

function noteCost(midi, f) {
  if (!isBlack(midi)) return 0;
  return f === 1 ? 3 : f === 5 ? 1 : 0;
}

/** Doigté d'un accord (notes triées vers le haut), main droite. */
export function chordFingers(midis) {
  const n = midis.length;
  if (n === 1) return [1];
  const span = midis[n - 1] - midis[0];
  if (n === 2) return span <= 2 ? [1, 2] : span <= 4 ? [1, 3] : span <= 6 ? [1, 4] : [1, 5];
  if (n === 3) {
    const mid = midis[1] - midis[0];
    if (span <= 5) return [1, 2, 4];
    return mid <= 4 ? [1, 3, 5] : [1, 2, 5];
  }
  if (n === 4) return span <= 9 ? [1, 2, 3, 5] : [1, 2, 4, 5];
  return [1, 2, 3, 4, 5].slice(0, n);
}

/**
 * Remplit `finger` sur les notes (d'une seule main) qui n'en ont pas. Mutation en place.
 * La main gauche est traitée comme le miroir de la main droite.
 */
export function autoFingering(notes, hand = 'R') {
  if (!notes.length) return notes;
  const mirror = hand === 'L' ? -1 : 1;
  // Groupes de notes simultanées
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.midi - b.midi);
  const groups = [];
  for (const n of sorted) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(g.start - n.start) < 1e-6) g.notes.push(n);
    else groups.push({ start: n.start, end: n.start + n.dur, notes: [n] });
  }
  // Chaque groupe : options (doigt « représentatif » + doigts de l'accord)
  const options = groups.map((g) => {
    const ns = [...g.notes].sort((a, b) => mirror * (a.midi - b.midi));
    const pitches = ns.map((n) => n.midi * mirror);
    if (ns.length === 1) {
      const fixed = ns[0].finger;
      const fs = fixed ? [fixed] : [1, 2, 3, 4, 5];
      return fs.map((f) => ({ rep: pitches[0], f, assign: [f], cost: noteCost(ns[0].midi, f) }));
    }
    const fs = chordFingers(pitches.map((p) => p - pitches[0]).map((x) => x + 60));
    return [{ rep: pitches[0], f: fs[0], assign: fs, cost: 0, top: pitches[pitches.length - 1], topF: fs[fs.length - 1] }];
  });

  // Viterbi
  const best = options.map((opts) => opts.map(() => ({ cost: Infinity, prev: -1 })));
  options[0].forEach((o, i) => (best[0][i].cost = o.cost));
  for (let k = 1; k < options.length; k++) {
    const gap = groups[k].start - groups[k - 1].end;
    const relax = gap > 0.9 ? 0.4 : 1; // après un silence, la main a le temps de se replacer
    options[k].forEach((o, i) => {
      options[k - 1].forEach((p, j) => {
        // on relie la note la plus proche de l'accord précédent
        const fromPitch = p.top != null && o.rep > p.rep ? p.top : p.rep;
        const fromF = p.top != null && o.rep > p.rep ? p.topF : p.f;
        const c = best[k - 1][j].cost + relax * transitionCost(fromPitch, fromF, o.rep, o.f) + o.cost;
        if (c < best[k][i].cost) best[k][i] = { cost: c, prev: j };
      });
    });
  }
  // Remontée
  let k = options.length - 1;
  let i = best[k].reduce((bi, b, idx, arr) => (b.cost < arr[bi].cost ? idx : bi), 0);
  for (; k >= 0; k--) {
    const o = options[k][i];
    const ns = [...groups[k].notes].sort((a, b) => mirror * (a.midi - b.midi));
    ns.forEach((n, idx) => {
      if (!n.finger) n.finger = o.assign[idx] ?? o.assign[o.assign.length - 1];
    });
    i = best[k][i].prev;
  }
  return notes;
}
