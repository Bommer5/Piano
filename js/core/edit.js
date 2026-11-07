// Édition de morceaux : opérations pures sur une liste de notes, historique annuler/rétablir,
// re-quantification (croches, doubles, triolets, swing), séparation des mains, doigtés personnalisés.
// Les notes sont des objets {id, midi, start, dur, hand, finger, ...} ; aucune opération ne modifie ses arguments.

const EPS = 1e-6;
export const round6 = (x) => Math.round(x * 1e6) / 1e6;

let nextId = 1e6;
export function newId() {
  return ++nextId;
}

const sel = (ids) => (ids instanceof Set ? ids : new Set([].concat(ids)));
const sortNotes = (notes) => [...notes].sort((a, b) => a.start - b.start || a.midi - b.midi);
const mapSel = (notes, ids, fn) => {
  const s = sel(ids);
  return notes.map((n) => (s.has(n.id) ? fn(n) : n));
};

export function setHand(notes, ids, hand) {
  return mapSel(notes, ids, (n) => ({ ...n, hand, finger: n.hand === hand ? n.finger : null }));
}

export function setFinger(notes, ids, finger) {
  const f = finger >= 1 && finger <= 5 ? Number(finger) : null;
  return mapSel(notes, ids, (n) => ({ ...n, finger: f, fingerEdited: true }));
}

/** Hauteur : ±demi-tons (transposition d'une sélection). Les notes restent entre 21 et 108. */
export function shiftPitch(notes, ids, semis) {
  return sortNotes(mapSel(notes, ids, (n) => ({ ...n, midi: Math.max(21, Math.min(108, n.midi + semis)), spelling: undefined })));
}

export const transposeNotes = shiftPitch;

export function setDuration(notes, ids, dur) {
  if (!(dur > 0)) return notes;
  return mapSel(notes, ids, (n) => ({ ...n, dur: round6(dur) }));
}

/** Déplace dans le temps (en temps), jamais avant 0. */
export function moveTime(notes, ids, delta) {
  return sortNotes(mapSel(notes, ids, (n) => ({ ...n, start: round6(Math.max(0, n.start + delta)) })));
}

export function deleteNotes(notes, ids) {
  const s = sel(ids);
  return notes.filter((n) => !s.has(n.id));
}

/** Ajoute une note (identifiant attribué automatiquement). Renvoie {notes, note}. */
export function addNote(notes, { midi = 60, start = 0, dur = 1, hand = null, finger = null, splitPoint = 60 } = {}) {
  const note = { id: newId(), midi, start: round6(start), dur: round6(dur), hand: hand || (midi >= splitPoint ? 'R' : 'L'), finger };
  return { notes: sortNotes([...notes, note]), note };
}

/** Répartit les mains : notes >= splitPoint à droite. Avec `ids`, seulement la sélection. Les doigtés sont recalculés. */
export function splitHands(notes, splitPoint = 60, ids = null) {
  const s = ids ? sel(ids) : null;
  return notes.map((n) => {
    if (s && !s.has(n.id)) return n;
    const hand = n.midi >= splitPoint ? 'R' : 'L';
    return hand === n.hand ? n : { ...n, hand, finger: null };
  });
}

/**
 * Point de partage conseillé : la séparation qui laisse le plus grand « trou » entre les deux mains
 * autour du Do central (entre 48 et 72).
 */
export function suggestSplitPoint(notes) {
  if (!notes.length) return 60;
  const counts = new Map();
  for (const n of notes) counts.set(n.midi, (counts.get(n.midi) || 0) + 1);
  let best = 60, bestCost = Infinity;
  for (let sp = 48; sp <= 72; sp++) {
    let cost = 0;
    // densité de notes juste autour du point de partage = mauvais
    for (let d = -2; d <= 1; d++) cost += (counts.get(sp + d) || 0) * (d === -1 || d === 0 ? 2 : 1);
    cost += Math.abs(sp - 60) * 0.3;
    if (cost < bestCost) { bestCost = cost; best = sp; }
  }
  return best;
}

/** Supprime les doublons (même hauteur, même attaque, même main) et les durées nulles. */
export function dedupe(notes) {
  const map = new Map();
  for (const n of notes) {
    if (!(n.dur > EPS)) continue;
    const k = `${n.hand}:${n.midi}:${Math.round(n.start * 1000)}`;
    const prev = map.get(k);
    if (!prev || n.dur > prev.dur) map.set(k, n);
  }
  return sortNotes([...map.values()]);
}

/**
 * Détecte le swing : proportion de croches « en l'air » placées vers 2/3 du temps plutôt qu'à 1/2.
 * @returns {{swing:boolean, ratio:number, samples:number}} ratio = position moyenne de la croche en l'air (0.5 droit, 0.667 swing)
 */
export function detectSwing(notes) {
  const offs = [];
  for (const n of notes) {
    const f = n.start - Math.floor(n.start + EPS);
    if (f > 0.4 && f < 0.8) offs.push(f);
  }
  if (offs.length < 4) return { swing: false, ratio: 0.5, samples: offs.length };
  offs.sort((a, b) => a - b);
  const median = offs[Math.floor(offs.length / 2)];
  return { swing: median > 0.58, ratio: Math.round(median * 1000) / 1000, samples: offs.length };
}

export const GRIDS = [
  { id: 'noire', label: 'Noire', value: 1 },
  { id: 'croche', label: 'Croche', value: 0.5 },
  { id: 'double', label: 'Double croche', value: 0.25 },
  { id: 'triolet', label: 'Triolets de croches', value: 1 / 3 },
  { id: 'mixte', label: 'Doubles + triolets (auto)', value: 'mixed' },
];

function snap(x, grid) {
  return Math.round(x / grid) * grid;
}

/**
 * Re-quantifie les attaques et les durées.
 * @param {Array} notes
 * @param {{grid?:number|'mixed', swing?:boolean|'auto', strength?:number, minDur?:number}} opts
 *   grid : 1, 0.5, 0.25, 1/3, 1/6 ou 'mixed' (le meilleur entre doubles et triolets, temps par temps) ;
 *   swing : les croches jouées « swing » (vers 2/3 du temps) sont écrites comme des croches droites ;
 *   strength : 1 = aimantation totale, 0.5 = moitié du chemin.
 * @returns {{notes:Array, swing:boolean}}
 */
export function quantize(notes, { grid = 0.25, swing = 'auto', strength = 1, minDur = null } = {}) {
  const triplets = typeof grid === 'number' && Math.abs(1 / grid - Math.round(1 / grid)) < 1e-3 && Math.round(1 / grid) % 3 === 0;
  const sw = triplets ? false : swing === 'auto' ? detectSwing(notes).swing : !!swing;
  const out = notes.map((n) => {
    let start = n.start;
    const beat = Math.floor(start + EPS);
    let f = start - beat;
    if (sw && f > 0.55 && f < 0.8) f = 0.5 + (f - 0.667) * 0.75; // croche swing -> croche droite
    let g = grid;
    if (grid === 'mixed') {
      const e1 = Math.abs(f - snap(f, 0.25)), e3 = Math.abs(f - snap(f, 1 / 3));
      g = e3 + 0.02 < e1 ? 1 / 3 : 0.25;
    }
    const target = beat + snap(f, g);
    start = start + (target - start) * strength;
    let end = n.start + n.dur;
    const gEnd = grid === 'mixed' ? g : grid;
    let dur = Math.max(minDur ?? gEnd, snap(end - n.start, gEnd));
    if (strength < 1) dur = n.dur + (dur - n.dur) * strength;
    return { ...n, start: round6(Math.max(0, start)), dur: round6(dur) };
  });
  return { notes: dedupe(out), swing: sw };
}

// ---------- historique ----------
export class EditHistory {
  constructor(initial, limit = 100) {
    this.stack = [initial];
    this.index = 0;
    this.limit = limit;
  }
  get current() {
    return this.stack[this.index];
  }
  /** Ajoute un nouvel état (les états « rétablir » sont oubliés). */
  push(state) {
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push(state);
    if (this.stack.length > this.limit) this.stack.shift();
    this.index = this.stack.length - 1;
    return state;
  }
  apply(fn) {
    return this.push(fn(this.current));
  }
  get canUndo() {
    return this.index > 0;
  }
  get canRedo() {
    return this.index < this.stack.length - 1;
  }
  undo() {
    if (this.canUndo) this.index--;
    return this.current;
  }
  redo() {
    if (this.canRedo) this.index++;
    return this.current;
  }
}

// ---------- doigtés personnalisés (morceaux intégrés) ----------
/** Clé stable d'une note (les identifiants changent à chaque préparation du morceau). */
export const noteKey = (n) => `${n.hand}:${Math.round(n.start * 1000)}:${n.midi}`;

/** Doigtés modifiés par rapport au morceau d'origine : {clé: doigt}. */
export function fingeringOverrides(original, edited) {
  const orig = new Map(original.map((n) => [noteKey(n), n.finger || null]));
  const res = {};
  for (const n of edited) {
    const k = noteKey(n);
    if (orig.has(k) && (n.finger || null) !== orig.get(k)) res[k] = n.finger || 0;
  }
  return res;
}

/** Applique des doigtés personnalisés ; renvoie le nombre de notes modifiées (modifie les notes en place). */
export function applyFingeringOverrides(notes, overrides) {
  if (!overrides || typeof overrides !== 'object') return 0;
  let n = 0;
  for (const note of notes) {
    const f = overrides[noteKey(note)];
    if (f === undefined) continue;
    note.finger = f >= 1 && f <= 5 ? f : null;
    note.customFinger = true;
    n++;
  }
  return n;
}

/** Les notes ont-elles changé ailleurs que dans les doigtés ? */
export function onlyFingeringsChanged(original, edited) {
  if (original.length !== edited.length) return false;
  const a = new Set(original.map(noteKey));
  return edited.every((n) => a.has(noteKey(n)) && original.find((o) => noteKey(o) === noteKey(n)).dur === n.dur);
}

/** Objet « brut » à enregistrer dans la bibliothèque (champs optionnels conservés). */
export function toRawSong(song, notes, extra = {}) {
  const keep = ['title', 'composer', 'genre', 'level', 'tempo', 'timeSig', 'keyFifths', 'keyMode', 'tempoMap', 'pickupBeats', 'chords', 'dynamics', 'pedal', 'description', 'swing'];
  const out = {};
  for (const k of keep) if (song[k] !== undefined) out[k] = song[k];
  out.notes = notes.map((n) => {
    const o = { midi: n.midi, start: n.start, dur: n.dur, hand: n.hand, finger: n.finger || null };
    for (const k of ['velocity', 'staff', 'tieStart', 'tieStop', 'articulations', 'spelling']) if (n[k] !== undefined) o[k] = n[k];
    return o;
  });
  return { ...out, ...extra };
}
