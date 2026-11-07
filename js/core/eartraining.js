// Formation de l'oreille : intervalles, accords, majeur/mineur, dictées mélodique et rythmique.
// Logique pure : chaque générateur renvoie une question {play:[{midi, at, dur}], answer, choices}
// où `at`/`dur` sont en secondes depuis le début de l'écoute.
import { pick, shuffle, randInt, degreeToMidi, tonicMidi, pcOf } from './reading.js';
import { generateRhythm, rhythmVariants, rhythmSignature, getRhythmLevel } from './rhythmgame.js';

export const INTERVAL_NAMES = {
  1: '2de mineure', 2: '2de majeure', 3: '3ce mineure', 4: '3ce majeure', 5: '4te juste', 6: 'Triton',
  7: '5te juste', 8: '6te mineure', 9: '6te majeure', 10: '7e mineure', 11: '7e majeure', 12: 'Octave',
};
export const CHORD_TYPES = {
  maj: { name: 'Majeur', ints: [0, 4, 7] },
  min: { name: 'Mineur', ints: [0, 3, 7] },
  dim: { name: 'Diminué', ints: [0, 3, 6] },
  aug: { name: 'Augmenté', ints: [0, 4, 8] },
  dom7: { name: '7e de dominante', ints: [0, 4, 7, 10] },
  maj7: { name: '7e majeure', ints: [0, 4, 7, 11] },
  m7: { name: 'Mineur 7', ints: [0, 3, 7, 10] },
};
const ALL_INTERVALS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const COMMON = [2, 3, 4, 5, 7, 9, 12];

/** Exercices et niveaux (débloqués un par un : 80 % au niveau précédent). */
export const EAR_EXERCISES = {
  intervals: {
    name: 'Intervalles', icon: '↕️',
    tip: 'Associe chaque intervalle au début d’un air connu : 4te juste = « Il est né le divin enfant », 5te = « Star Wars », octave = « Over the rainbow ».',
    levels: [
      { name: '3ce, 5te, octave (montants)', set: [4, 7, 12], dirs: ['up'] },
      { name: '+ 2de et 4te', set: [2, 4, 5, 7, 12], dirs: ['up'] },
      { name: '+ 3ce mineure et 6te', set: COMMON, dirs: ['up'] },
      { name: 'Tous, montants', set: ALL_INTERVALS, dirs: ['up'] },
      { name: 'Descendants', set: COMMON, dirs: ['down'] },
      { name: 'Montants et descendants', set: ALL_INTERVALS, dirs: ['up', 'down'] },
      { name: 'Harmoniques (ensemble)', set: [3, 4, 5, 7, 12], dirs: ['harm'] },
      { name: 'Tous, harmoniques', set: ALL_INTERVALS, dirs: ['harm'] },
    ],
  },
  chords: {
    name: 'Accords', icon: '🎹',
    tip: 'Majeur = lumineux, mineur = triste, diminué = tendu, augmenté = flottant, comme en suspens.',
    levels: [
      { name: 'Majeur / mineur', set: ['maj', 'min'] },
      { name: '+ diminué', set: ['maj', 'min', 'dim'] },
      { name: '+ augmenté', set: ['maj', 'min', 'dim', 'aug'] },
      { name: 'Accords de 7e', set: ['dom7', 'maj7', 'm7'] },
      { name: 'Tout mélangé', set: ['maj', 'min', 'dim', 'aug', 'dom7', 'maj7', 'm7'] },
    ],
  },
  mode: {
    name: 'Majeur ou mineur', icon: '☀️',
    tip: 'Écoute la 3ce (la note du milieu) : haute en majeur, plus basse d’un demi-ton en mineur.',
    levels: [
      { name: 'Accords plaqués', kind: 'chord' },
      { name: 'Arpèges', kind: 'arpeggio' },
      { name: 'Gammes', kind: 'scale' },
      { name: 'Courtes mélodies', kind: 'melody' },
    ],
  },
  melody: {
    name: 'Dictée mélodique', icon: '🎶',
    tip: 'Repère la tonique (jouée d’abord), puis chante la mélodie dans ta tête avant de la chercher au piano.',
    levels: [2, 3, 4, 5, 6, 7, 8].map((n) => ({ name: `${n} notes`, length: n })),
  },
  rhythm: {
    name: 'Dictée rythmique', icon: '🥁',
    tip: 'Compte « 1 et 2 et » pendant l’écoute et repère où tombent les notes longues.',
    levels: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ name: getRhythmLevel(n).name, rhythmLevel: n })),
  },
};
export const EAR_PASS = 80;
export const QUESTIONS_PER_SESSION = 10;
export const MAX_LISTENS = 3;

/** Question d'intervalle. */
export function makeIntervalQuestion(level, rng = Math.random) {
  const lv = EAR_EXERCISES.intervals.levels[level - 1] || EAR_EXERCISES.intervals.levels[0];
  const semis = pick(rng, lv.set);
  const dir = pick(rng, lv.dirs);
  const root = dir === 'down' ? randInt(rng, 64, 74) : randInt(rng, 53, 65);
  const other = dir === 'down' ? root - semis : root + semis;
  const play = dir === 'harm'
    ? [{ midi: root, at: 0, dur: 1.8 }, { midi: other, at: 0, dur: 1.8 }]
    : [{ midi: root, at: 0, dur: 0.9 }, { midi: other, at: 0.9, dur: 1.1 }];
  return {
    type: 'intervals', play, answer: semis, notes: [root, other], direction: dir,
    choices: [...lv.set].sort((a, b) => a - b).map((s) => ({ id: s, label: INTERVAL_NAMES[s] })),
  };
}

/** Question d'accord (plaqué puis arpégé). */
export function makeChordQuestion(level, rng = Math.random) {
  const lv = EAR_EXERCISES.chords.levels[level - 1] || EAR_EXERCISES.chords.levels[0];
  const type = pick(rng, lv.set);
  const root = randInt(rng, 53, 62);
  const midis = CHORD_TYPES[type].ints.map((i) => root + i);
  const play = [
    ...midis.map((m) => ({ midi: m, at: 0, dur: 1.4 })),
    ...midis.map((m, i) => ({ midi: m, at: 1.6 + i * 0.35, dur: 0.6 })),
  ];
  return { type: 'chords', play, answer: type, notes: midis, choices: lv.set.map((t) => ({ id: t, label: CHORD_TYPES[t].name })) };
}

const MINOR = [0, 2, 3, 5, 7, 8, 10];
const MAJ = [0, 2, 4, 5, 7, 9, 11];
/** Majeur ou mineur ? */
export function makeModeQuestion(level, rng = Math.random) {
  const lv = EAR_EXERCISES.mode.levels[level - 1] || EAR_EXERCISES.mode.levels[0];
  const mode = rng() < 0.5 ? 'maj' : 'min';
  const root = randInt(rng, 55, 64);
  const scale = mode === 'maj' ? MAJ : MINOR;
  let play;
  if (lv.kind === 'chord') play = [0, 2, 4].map((d) => ({ midi: root + scale[d], at: 0, dur: 1.8 }));
  else if (lv.kind === 'arpeggio') play = [0, 2, 4, 7].map((d, i) => ({ midi: root + (d === 7 ? 12 : scale[d]), at: i * 0.45, dur: 0.6 }));
  else if (lv.kind === 'scale') play = [0, 1, 2, 3, 4, 5, 6, 7].map((d, i) => ({ midi: root + (d === 7 ? 12 : scale[d]), at: i * 0.35, dur: 0.45 }));
  else {
    const degs = [0, 2, 1, 2, 4, 3, 2, 1, 0].slice(0, 5 + Math.floor(rng() * 4));
    degs[degs.length - 1] = 0;
    play = degs.map((d, i) => ({ midi: root + scale[d], at: i * 0.4, dur: 0.5 }));
  }
  return { type: 'mode', play, answer: mode, choices: [{ id: 'maj', label: '☀️ Majeur' }, { id: 'min', label: '🌧️ Mineur' }] };
}

/**
 * Dictée mélodique : tonique jouée d'abord, puis la mélodie (degrés proches, dans la tonalité).
 * @returns {{type:'melody', tonic, keyFifths, notes:number[], play, gap}}
 */
export function makeMelodyQuestion(level, rng = Math.random) {
  const lv = EAR_EXERCISES.melody.levels[level - 1] || EAR_EXERCISES.melody.levels[0];
  const n = lv.length;
  const fifths = level <= 3 ? 0 : pick(rng, [0, 1, -1]);
  const tonic = tonicMidi(fifths);
  const maxDeg = level <= 2 ? 4 : 7;
  const degs = [pick(rng, [0, 0, 2, 4].filter((d) => d <= maxDeg))];
  for (let i = 1; i < n; i++) {
    const prev = degs[i - 1];
    const r = rng();
    const step = r < 0.65 ? 1 : r < 0.9 ? 2 : pick(rng, [3, 4]);
    let dir = rng() < 0.5 ? -1 : 1;
    if (prev + dir * step > maxDeg || prev + dir * step < 0) dir = -dir;
    let d = Math.max(0, Math.min(maxDeg, prev + dir * step));
    if (d === prev) d = prev > 0 ? prev - 1 : prev + 1;
    degs.push(d);
  }
  const notes = degs.map((d) => degreeToMidi(tonic, d));
  const gap = level <= 2 ? 0.75 : 0.6;
  const start = 1.6;
  const play = [
    { midi: tonic, at: 0, dur: 1.1, ref: true },
    ...notes.map((m, i) => ({ midi: m, at: start + i * gap, dur: gap * 0.95 })),
  ];
  return { type: 'melody', tonic, keyFifths: fifths, notes, play, gap };
}

/** Dictée rythmique : un motif d'une mesure, à retrouver parmi 4 notations. */
export function makeRhythmQuestion(level, rng = Math.random) {
  const lv = EAR_EXERCISES.rhythm.levels[level - 1] || EAR_EXERCISES.rhythm.levels[0];
  const rl = getRhythmLevel(lv.rhythmLevel);
  const pattern = generateRhythm(rl.id, rng);
  const spb = 60 / rl.tempo;
  const countIn = [0, 1, 2, 3].map((b) => ({ click: true, accent: b === 0, at: b * spb }));
  const play = [
    ...countIn,
    ...pattern.events.filter((e) => !e.rest).map((e) => ({ midi: 72, at: (4 + e.start) * spb, dur: Math.min(e.dur * spb * 0.9, 0.5) })),
  ];
  const options = shuffle(rng, [pattern, ...rhythmVariants(pattern, rl.id, rng, 3)]);
  const answer = rhythmSignature(pattern);
  return { type: 'rhythm', pattern, play, answer, tempo: rl.tempo, choices: options.map((p) => ({ id: rhythmSignature(p), pattern: p })) };
}

export function makeEarQuestion(exercise, level, rng = Math.random) {
  const f = { intervals: makeIntervalQuestion, chords: makeChordQuestion, mode: makeModeQuestion, melody: makeMelodyQuestion, rhythm: makeRhythmQuestion }[exercise];
  if (!f) throw new Error(`Exercice inconnu : ${exercise}`);
  return f(level, rng);
}

/** Durée totale (s) d'une écoute. */
export function playDuration(play) {
  return play.reduce((m, p) => Math.max(m, p.at + (p.dur || 0.1)), 0);
}

/**
 * Correction note à note d'une dictée jouée au piano.
 * Une bonne note fait avancer ; une fausse note est comptée comme erreur (on ne recule pas).
 */
export class DictationChecker {
  constructor(target, { octaveTolerant = true } = {}) {
    this.target = [...target];
    this.octaveTolerant = octaveTolerant;
    this.index = 0;
    this.errors = 0;
    this.attempts = [];
  }
  matches(midi, expected) {
    return this.octaveTolerant ? pcOf(midi) === pcOf(expected) : midi === expected;
  }
  play(midi) {
    if (this.done) return { ok: false, done: true, index: this.index, expected: null };
    const expected = this.target[this.index];
    const ok = this.matches(midi, expected);
    this.attempts.push({ midi, ok, index: this.index });
    if (ok) this.index++;
    else this.errors++;
    return { ok, index: ok ? this.index - 1 : this.index, expected, done: this.done };
  }
  get done() {
    return this.index >= this.target.length;
  }
  /** Score 0..100 : 100 sans faute, diminue avec les erreurs. */
  get score() {
    return dictationScore(this.target.length, this.errors, this.done);
  }
}
export function dictationScore(length, errors, done = true) {
  if (!done || !length) return 0;
  return Math.round((100 * length) / (length + errors));
}

/**
 * Évaluation globale d'une dictée saisie d'un coup (position par position).
 * @returns {{statuses:('ok'|'wrong'|'missing'|'extra')[], correct:number, score:number}}
 */
export function evaluateDictation(target, played, { octaveTolerant = true } = {}) {
  const same = (a, b) => (octaveTolerant ? pcOf(a) === pcOf(b) : a === b);
  const statuses = [];
  let correct = 0;
  for (let i = 0; i < Math.max(target.length, played.length); i++) {
    if (i >= target.length) statuses.push('extra');
    else if (i >= played.length) statuses.push('missing');
    else if (same(target[i], played[i])) {
      statuses.push('ok');
      correct++;
    } else statuses.push('wrong');
  }
  const extra = Math.max(0, played.length - target.length);
  const score = target.length ? Math.max(0, Math.round((100 * (correct - extra)) / target.length)) : 0;
  return { statuses, correct, score };
}

/** Pourcentage d'une série de scores (0..100 chacun). */
export function sessionScore(scores) {
  if (!scores.length) return 0;
  return Math.round(scores.reduce((s, x) => s + x, 0) / scores.length);
}
