// Logique de notation (pure, testable dans Node) utilisée par la portée (js/ui/staff.js) :
// tonalité (estimation Krumhansl), orthographe des notes d'un morceau, altérations accidentelles
// par mesure (avec rappels), découpage des durées en valeurs écrivables liées, silences,
// groupes de ligatures, n-olets et choix de la portée (clé de sol / clé de fa).
import { spell, spellFrom, pitchClass } from './notes.js';

const EPS = 1e-6;
const near = (a, b, e = 1e-3) => Math.abs(a - b) < e;

// ---------------------------------------------------------------------------
// Tonalité
// ---------------------------------------------------------------------------

// Profils de Krumhansl-Kessler (majeur / mineur), index 0 = tonique.
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function corr(a, b) {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** Histogramme des classes de hauteur pondéré par la durée. */
export function pitchHistogram(notes) {
  const h = new Array(12).fill(0);
  for (const n of notes || []) if (Number.isFinite(n.midi)) h[pitchClass(n.midi)] += Math.max(0.05, Math.min(4, n.dur || 1));
  return h;
}

/** Armure (-6..6, enharmonie la plus simple) d'une tonique (classe de hauteur) dans un mode. */
export function fifthsOfTonic(pc, mode = 'major') {
  const majorPc = mode === 'minor' ? (pc + 3) % 12 : pc;
  let f = (majorPc * 7) % 12; // Do=0, Sol=1, Ré=2…
  if (f > 6) f -= 12;
  return f;
}

/** Tonique (classe de hauteur) d'une armure dans un mode. */
export function tonicOf(fifths, mode = 'major') {
  const maj = ((((fifths || 0) * 7) % 12) + 12) % 12;
  return mode === 'minor' ? (maj + 9) % 12 : maj;
}

/**
 * Estimation de la tonalité (algorithme de Krumhansl-Schmuckler).
 * @returns {{fifths:number, mode:'major'|'minor', tonic:number, score:number}}
 */
export function estimateKey(notes) {
  const h = pitchHistogram(notes);
  let best = { fifths: 0, mode: 'major', tonic: 0, score: -Infinity };
  if (!h.some((x) => x > 0)) return { ...best, score: 0 };
  for (let t = 0; t < 12; t++) {
    for (const [mode, prof] of [['major', KK_MAJOR], ['minor', KK_MINOR]]) {
      const rotated = prof.map((_, i) => prof[(i - t + 12) % 12]);
      const score = corr(h, rotated);
      if (score > best.score + 1e-9) best = { fifths: fifthsOfTonic(t, mode), mode, tonic: t, score };
    }
  }
  return best;
}

/** Mode probable (majeur ou mineur relatif) pour une armure connue. */
export function estimateMode(notes, fifths = 0) {
  const h = pitchHistogram(notes);
  if (!h.some((x) => x > 0)) return 'major';
  const tMaj = tonicOf(fifths, 'major');
  const tMin = tonicOf(fifths, 'minor');
  const rot = (prof, t) => prof.map((_, i) => prof[(i - t + 12) % 12]);
  let sMaj = corr(h, rot(KK_MAJOR, tMaj));
  let sMin = corr(h, rot(KK_MINOR, tMin));
  // indice fort du mineur : la sensible (7e degré haussé) est présente
  if (h[(tMin + 11) % 12] > 0) sMin += 0.05;
  return sMin > sMaj ? 'minor' : 'major';
}

/** Altération de chaque degré (0..6 = Do..Si) dans l'armure. */
export function keySignatureAlters(fifths = 0) {
  const alt = [0, 0, 0, 0, 0, 0, 0];
  const SHARPS = [3, 0, 4, 1, 5, 2, 6]; // Fa Do Sol Ré La Mi Si
  const f = Math.max(-7, Math.min(7, Math.round(fifths || 0)));
  if (f > 0) for (let k = 0; k < f; k++) alt[SHARPS[k]] = 1;
  if (f < 0) for (let k = 0; k < -f; k++) alt[SHARPS[6 - k]] = -1;
  return alt;
}

const TONIC_FR = ['Do', 'Do♯', 'Ré', 'Mi♭', 'Mi', 'Fa', 'Fa♯', 'Sol', 'La♭', 'La', 'Si♭', 'Si'];
/** Nom lisible de la tonalité : « Ré mineur », « Si♭ majeur ». */
export function keyName(fifths = 0, mode = 'major') {
  const { step, alter } = (() => {
    // tonique orthographiée selon l'armure
    const lof = (mode === 'minor' ? 3 : 0) + (fifths || 0);
    const idx = (((lof + 1) % 7) + 7) % 7;
    return { step: [3, 0, 4, 1, 5, 2, 6][idx], alter: Math.floor((lof + 1) / 7) };
  })();
  const name = ['Do', 'Ré', 'Mi', 'Fa', 'Sol', 'La', 'Si'][step] + ({ '-2': '𝄫', '-1': '♭', 1: '♯', 2: '𝄪' }[alter] || '');
  return `${name || TONIC_FR[0]} ${mode === 'minor' ? 'mineur' : 'majeur'}`;
}

/** Tonalité effective d'un morceau : armure + mode (mode estimé s'il n'est pas donné). */
export function songKey(song) {
  const fifths = Number.isFinite(song?.keyFifths) ? song.keyFifths : 0;
  let mode = song?.keyMode;
  if (mode !== 'major' && mode !== 'minor') mode = song?.notes?.length ? estimateMode(song.notes, fifths) : 'major';
  return { fifths, mode };
}

/**
 * Orthographe d'une note : celle du fichier d'origine si elle est cohérente, sinon tonale.
 * @param {number} [dir] sens chromatique vers la note suivante (cf. melodicDirections)
 */
export function spellNote(note, key = { fifths: 0, mode: 'major' }, dir = 0) {
  return spellFrom(note.midi, note.spelling) || spell(note.midi, key.fifths || 0, key.mode || 'major', dir);
}

/**
 * Sens du mouvement chromatique de chaque note vers la suivante de la même main :
 * +1 si la note suivante est un demi-ton au-dessus, -1 un demi-ton au-dessous, 0 sinon.
 * @returns {Map<any, number>} id (ou index) → sens
 */
export function melodicDirections(notes) {
  const res = new Map();
  for (const hand of ['R', 'L']) {
    const list = notes.map((n, i) => [n, i]).filter(([n]) => (n.hand === 'L' ? 'L' : 'R') === hand).sort((a, b) => a[0].start - b[0].start);
    const starts = [...new Set(list.map(([n]) => Math.round(n.start * 1000)))];
    const byStart = new Map();
    for (const [n] of list) {
      const k = Math.round(n.start * 1000);
      if (!byStart.has(k)) byStart.set(k, new Set());
      byStart.get(k).add(n.midi);
    }
    const nextOf = new Map(starts.map((s, i) => [s, starts[i + 1]]));
    for (const [n, i] of list) {
      const nx = nextOf.get(Math.round(n.start * 1000));
      const set = nx != null ? byStart.get(nx) : null;
      let dir = 0;
      if (set) {
        if (set.has(n.midi + 1) && !set.has(n.midi - 1)) dir = 1;
        else if (set.has(n.midi - 1) && !set.has(n.midi + 1)) dir = -1;
      }
      res.set(n.id ?? i, dir);
    }
  }
  return res;
}

// ---------------------------------------------------------------------------
// Mesures
// ---------------------------------------------------------------------------

/** Numéro de mesure affiché pour un temps (levée → mesure 0). */
export function measureNumber(beat, beatsPerMeasure, pickupBeats = 0) {
  const idx = Math.floor(beat / beatsPerMeasure + EPS);
  return pickupBeats > EPS ? idx : idx + 1;
}

/** Durée d'un temps pour les ligatures et les silences (temps composés : noire pointée). */
export function beatUnit(timeSig = [4, 4]) {
  const [n, d] = timeSig;
  if (d === 8 && n % 3 === 0 && n >= 6) return 1.5;
  if (d === 8 && n === 3) return 1.5;
  if (d === 2) return 2;
  return 4 / d >= 1 ? 1 : 4 / d;
}

// ---------------------------------------------------------------------------
// Durées écrivables
// ---------------------------------------------------------------------------

const BASE_TYPES = [
  ['whole', 4],
  ['half', 2],
  ['quarter', 1],
  ['eighth', 0.5],
  ['16th', 0.25],
  ['32nd', 0.125],
];

/** Valeurs simples et pointées (dur, type, dots). */
export const SIMPLE_VALUES = (() => {
  const out = [{ dur: 6, type: 'whole', dots: 1, tuplet: false }];
  for (const [type, d] of BASE_TYPES) {
    out.push({ dur: d, type, dots: 0, tuplet: false });
    if (d >= 0.25) out.push({ dur: d * 1.5, type, dots: 1, tuplet: false });
  }
  return out.sort((a, b) => b.dur - a.dur || a.dots - b.dots);
})();

/** Valeurs de triolet (3 pour 2). */
export const TUPLET_VALUES = BASE_TYPES.filter(([, d]) => d <= 2 && d >= 0.125).map(([type, d]) => ({ dur: (d * 2) / 3, type, dots: 0, tuplet: true }));

const ALL_VALUES = [...SIMPLE_VALUES, ...TUPLET_VALUES];

/** Valeur unique correspondant exactement à une durée, ou null. */
export function noteValue(dur) {
  return SIMPLE_VALUES.find((v) => near(v.dur, dur)) || TUPLET_VALUES.find((v) => near(v.dur, dur)) || null;
}

const decompCache = new Map();
/** Décompose une durée en valeurs écrivables (le moins de morceaux possible, valeurs simples d'abord). */
export function decompose(dur) {
  const key = Math.round(dur * 4800);
  if (decompCache.has(key)) return decompCache.get(key).map((v) => ({ ...v }));
  let res = null;
  const sols = [];
  const search = (r, depth, acc, minIdx) => {
    if (near(r, 0, 2e-3)) return sols.push(acc);
    if (depth === 0 || r < 0.08) return;
    for (let k = minIdx; k < ALL_VALUES.length; k++) {
      const v = ALL_VALUES[k];
      if (v.dur > r + 2e-3) continue;
      search(r - v.dur, depth - 1, [...acc, v], k);
    }
  };
  for (let depth = 1; depth <= 4 && !sols.length; depth++) search(dur, depth, [], 0);
  if (sols.length) {
    // moins de triolets, moins de points, puis la plus grande valeur d'abord (2,5 = blanche + croche)
    const score = (sol) => [sol.filter((v) => v.tuplet).length, sol.reduce((n, v) => n + v.dots, 0), -Math.max(...sol.map((v) => v.dur))];
    sols.sort((a, b) => {
      const sa = score(a), sb = score(b);
      return sa[0] - sb[0] || sa[1] - sb[1] || sa[2] - sb[2];
    });
    // ordre d'écriture : valeurs décroissantes
    res = [...sols[0]].sort((a, b) => b.dur - a.dur);
  }
  if (!res) {
    // durée irrégulière : grille de 1/24 de temps, puis remplissage glouton
    res = [];
    let r = Math.max(0.125, Math.round(dur * 24) / 24);
    let guard = 0;
    while (r > 0.06 && guard++ < 16) {
      const v = ALL_VALUES.find((x) => x.dur <= r + 2e-3) || ALL_VALUES[ALL_VALUES.length - 1];
      res.push(v);
      r -= v.dur;
    }
  }
  if (decompCache.size > 2000) decompCache.clear();
  decompCache.set(key, res);
  return res.map((v) => ({ ...v }));
}

/** Arrondit une durée d'affichage à une valeur proche (données MIDI jouées, staccato…). */
export function snapDuration(dur) {
  if (noteValue(dur)) return noteValue(dur).dur;
  for (const v of ALL_VALUES) if (Math.abs(v.dur - dur) / v.dur < 0.07) return v.dur;
  return Math.max(0.125, Math.round(dur * 24) / 24);
}

/** Arrondit un instant à la grille d'affichage (1/24 de temps : doubles croches et triolets). */
export function snapTime(t) {
  return Math.round(t * 24) / 24;
}

/**
 * Découpe une note en valeurs écrivables liées, coupées aux barres de mesure.
 * @param {number} start début (temps)
 * @param {number} dur durée (temps)
 * @param {number} measureLen longueur d'une mesure (temps)
 * @returns {Array<{start, dur, type, dots, tuplet, tieStart, tieStop}>}
 */
export function splitNote(start, dur, measureLen = 4) {
  const end = start + dur;
  const pieces = [];
  let s = start;
  let guard = 0;
  while (s < end - 1e-3 && guard++ < 1000) {
    const bar = (Math.floor(s / measureLen + 1e-6) + 1) * measureLen;
    const e = Math.min(end, bar);
    let t = s;
    for (const v of decompose(e - s)) {
      pieces.push({ start: t, dur: v.dur, type: v.type, dots: v.dots, tuplet: v.tuplet });
      t += v.dur;
    }
    s = e;
  }
  pieces.forEach((p, i) => {
    p.tieStop = i > 0;
    p.tieStart = i < pieces.length - 1;
  });
  return pieces;
}

// ---------------------------------------------------------------------------
// Silences
// ---------------------------------------------------------------------------

/** Fusionne des intervalles [start, end]. */
export function mergeIntervals(list) {
  const sorted = list.filter((x) => x[1] > x[0] + EPS).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1] + 1e-3) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/**
 * Silences d'une voix (main) dans une mesure.
 * @param {Array<[number, number]>} covered intervalles joués (temps absolus)
 * @param {number} mStart début de la mesure
 * @param {number} mLen longueur de la mesure
 * @param {object} [o] {beat: durée du temps, minRest: plus petit silence dessiné, from: ne rien dessiner avant}
 * @returns {Array<{start, dur, type, dots, whole?}>}
 */
export function restsInMeasure(covered, mStart, mLen, o = {}) {
  const beat = o.beat || 1;
  const minRest = o.minRest ?? 0.12;
  const mEnd = mStart + mLen;
  const from = Math.max(mStart, o.from ?? mStart);
  const busy = mergeIntervals(covered.map(([s, e]) => [Math.max(s, mStart), Math.min(e, mEnd)]));
  const gaps = [];
  let t = from;
  for (const [s, e] of busy) {
    if (e <= t) continue;
    if (s > t + 1e-3) gaps.push([t, s]);
    t = Math.max(t, e);
  }
  if (t < mEnd - 1e-3) gaps.push([t, mEnd]);
  if (gaps.length === 1 && near(gaps[0][0], mStart) && near(gaps[0][1], mEnd) && from <= mStart + EPS) {
    return [{ start: mStart, dur: mLen, type: 'whole', dots: 0, whole: true }];
  }
  const out = [];
  const compound = near(beat, 1.5);
  for (const [gs, ge] of gaps) {
    let p = gs;
    let guard = 0;
    while (p < ge - minRest + 1e-3 && guard++ < 64) {
      const rel = p - mStart;
      const remain = ge - p;
      const opts = compound ? [3, 1.5, 0.5, 0.25, 0.125] : [4, 2, 1, 0.5, 0.25, 0.125];
      let pick = null;
      for (const v of opts) {
        if (v > remain + 1e-3) continue;
        if (v > mLen + 1e-3) continue;
        const align = v >= beat ? v : beat >= 1 ? v : v;
        const m = rel / align;
        if (Math.abs(m - Math.round(m)) > 1e-3) continue;
        // demi-pause : pas à cheval sur le milieu d'une mesure à 4 temps
        if (v === 2 && near(mLen, 4) && !near(rel, 0) && !near(rel, 2)) continue;
        pick = v;
        break;
      }
      if (pick == null) {
        const tv = TUPLET_VALUES.find((x) => x.dur <= remain + 1e-3);
        const sv = [...SIMPLE_VALUES].reverse().find((x) => x.dur <= remain + 1e-3 && x.dots === 0);
        const v = tv && (!sv || Math.abs(remain - tv.dur) < Math.abs(remain - sv.dur)) ? tv : sv;
        if (!v) break;
        out.push({ start: p, dur: v.dur, type: v.type, dots: 0, tuplet: !!v.tuplet });
        p += v.dur;
        continue;
      }
      const val = SIMPLE_VALUES.find((x) => near(x.dur, pick));
      out.push({ start: p, dur: pick, type: val.type, dots: val.dots });
      p += pick;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Altérations accidentelles
// ---------------------------------------------------------------------------

/**
 * Altérations à afficher, mesure par mesure (règle classique : une altération vaut jusqu'à la
 * barre de mesure, pour la même hauteur écrite et sur la même portée).
 * @param {Array<{measure:number, staff:string|number, sp:{step,octave,alter}, tieStop?:boolean}>} items
 *        triés par temps (les notes d'un accord dans n'importe quel ordre)
 * @param {number} keyFifths armure
 * @returns {Array<{alter:number, courtesy:boolean}|null>} pour chaque item
 */
export function computeAccidentals(items, keyFifths = 0) {
  const keyAlt = keySignatureAlters(keyFifths);
  const res = new Array(items.length).fill(null);
  const state = new Map(); // staff -> {measure, cur: Map(pos -> alter), prev: Map(pos -> alter)}
  items.forEach((it, i) => {
    let st = state.get(it.staff);
    if (!st) state.set(it.staff, (st = { measure: it.measure, cur: new Map(), prev: new Map(), seen: new Set() }));
    if (st.measure !== it.measure) {
      // mesure suivante : on garde ce qui a été altéré dans la mesure précédente (rappels)
      st.prev = it.measure === st.measure + 1 ? st.cur : new Map();
      st.cur = new Map();
      st.seen = new Set();
      st.measure = it.measure;
    }
    const { step, octave, alter } = it.sp;
    const pos = `${step}:${octave}`;
    if (it.tieStop) return; // note liée : l'altération se prolonge, rien à écrire
    const expected = st.cur.has(pos) ? st.cur.get(pos) : keyAlt[step];
    if (alter !== expected) {
      res[i] = { alter, courtesy: false };
      st.cur.set(pos, alter);
      st.seen.add(pos);
      return;
    }
    if (!st.seen.has(pos)) {
      st.seen.add(pos);
      // bécarre (ou altération) de rappel : même note altérée autrement dans la mesure précédente,
      // ou même degré à une autre octave altéré autrement dans cette mesure
      const prevAlt = st.prev.get(pos);
      let courtesy = prevAlt !== undefined && prevAlt !== alter;
      if (!courtesy) {
        for (const [p, a] of st.cur) {
          if (p !== pos && p.startsWith(step + ':') && a !== alter) courtesy = true;
        }
      }
      if (courtesy) res[i] = { alter, courtesy: true };
      st.cur.set(pos, alter);
    }
  });
  return res;
}

// ---------------------------------------------------------------------------
// Ligatures et n-olets
// ---------------------------------------------------------------------------

const BEAMABLE = new Set(['eighth', '16th', '32nd']);
/** Nombre de crochets / barres de ligature d'une valeur. */
export function flagCount(type) {
  return { eighth: 1, '16th': 2, '32nd': 3 }[type] || 0;
}

/**
 * Groupes de ligature : croches et plus courtes consécutives d'une même voix, dans un même temps.
 * @param {Array<{start, dur, type, voice?, rest?, group?}>} events triés par temps (une entrée par accord) ;
 *        `group` (facultatif) force le regroupement (ex. un triolet entier)
 * @param {object} o {beat: durée du temps, measureLen}
 * @returns {number[][]} groupes (indices) d'au moins deux événements
 */
export function beamGroups(events, o = {}) {
  const beat = o.beat || 1;
  const mLen = o.measureLen || 4;
  const groups = [];
  let cur = [];
  let curKey = null;
  const flush = () => {
    if (cur.length >= 2) groups.push(cur);
    cur = [];
    curKey = null;
  };
  // une voix à la fois
  const byVoice = new Map();
  events.forEach((e, i) => {
    const v = e.voice ?? 0;
    if (!byVoice.has(v)) byVoice.set(v, []);
    byVoice.get(v).push(i);
  });
  for (const idxs of byVoice.values()) {
    let prevEnd = null;
    for (const i of idxs) {
      const e = events[i];
      if (e.rest || !BEAMABLE.has(e.type)) {
        flush();
        prevEnd = e.start + e.dur;
        continue;
      }
      const measure = Math.floor(e.start / mLen + 1e-6);
      const span = e.tuplet ? Math.max(beat, e.dur * 3) : beat;
      const beatIdx = e.group != null ? `g${e.group}` : Math.floor((e.start - measure * mLen) / span + 1e-6);
      const key = `${measure}:${beatIdx}:${e.tuplet ? 't' : 's'}`;
      if (curKey !== key || (prevEnd != null && Math.abs(prevEnd - e.start) > 1e-3)) flush();
      cur.push(i);
      curKey = key;
      prevEnd = e.start + e.dur;
    }
    flush();
  }
  return groups.sort((a, b) => a[0] - b[0]);
}

/**
 * Groupes de n-olets (triolets) : événements consécutifs d'une même voix qui forment ensemble
 * la durée de 2 valeurs normales (ex. 3 croches de triolet = 1 temps).
 * @param {Array<{start, dur, tuplet?, voice?}>} events triés par temps
 * @returns {number[][]}
 */
export function tupletGroups(events) {
  const out = [];
  const byVoice = new Map();
  events.forEach((e, i) => {
    const v = e.voice ?? 0;
    if (!byVoice.has(v)) byVoice.set(v, []);
    byVoice.get(v).push(i);
  });
  for (const idxs of byVoice.values()) {
    let cur = [];
    let span = 0;
    let acc = 0;
    let gStart = 0;
    for (const i of idxs) {
      const e = events[i];
      if (!e.tuplet) {
        cur = [];
        acc = 0;
        continue;
      }
      if (!cur.length) {
        span = e.dur * 3; // 3 valeurs de triolet
        gStart = e.start;
      } else if (Math.abs(gStart + acc - e.start) > 1e-3) {
        cur = [];
        acc = 0;
        span = e.dur * 3;
        gStart = e.start;
      }
      cur.push(i);
      acc += e.dur;
      if (acc >= span - 1e-3) {
        out.push(cur);
        cur = [];
        acc = 0;
      }
    }
  }
  return out.sort((a, b) => a[0] - b[0]);
}

// ---------------------------------------------------------------------------
// Choix de la portée
// ---------------------------------------------------------------------------

/** Seuils de bascule : main gauche au-dessus de Fa4 → clé de sol ; main droite sous Sol3 → clé de fa. */
export const LEFT_HAND_UP = 65; // > Fa4 (Do4 + 5 demi-tons)
export const RIGHT_HAND_DOWN = 55; // < Sol3

/**
 * Portée de chaque note : 'treble' (haut) ou 'bass' (bas).
 * Priorité : note.staff (MusicXML : 1 = haut, 2 = bas) ; sinon la main, avec bascule automatique
 * pour les accords/notes très éloignés (la décision est prise par accord, sur la hauteur moyenne).
 * @returns {Map<any, 'treble'|'bass'>} id (ou index) → portée
 */
export function assignStaves(notes) {
  const res = new Map();
  const groups = new Map();
  notes.forEach((n, i) => {
    const id = n.id ?? i;
    if (n.staff === 1 || n.staff === 2) {
      res.set(id, n.staff === 1 ? 'treble' : 'bass');
      return;
    }
    const k = `${n.hand || 'R'}:${Math.round(n.start * 1000)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push([id, n]);
  });
  for (const list of groups.values()) {
    const hand = list[0][1].hand === 'L' ? 'L' : 'R';
    const avg = list.reduce((s, [, n]) => s + n.midi, 0) / list.length;
    const lo = Math.min(...list.map(([, n]) => n.midi));
    const hi = Math.max(...list.map(([, n]) => n.midi));
    let staff = hand === 'L' ? 'bass' : 'treble';
    if (hand === 'L' && lo > LEFT_HAND_UP) staff = 'treble';
    if (hand === 'R' && hi < RIGHT_HAND_DOWN) staff = 'bass';
    void avg;
    for (const [id] of list) res.set(id, staff);
  }
  return res;
}

/** Portée « de base » d'une main (pour ses silences). */
export function homeStaff(hand) {
  return hand === 'L' ? 'bass' : 'treble';
}

// ---------------------------------------------------------------------------
// Accords chiffrés
// ---------------------------------------------------------------------------

const KIND_SUFFIX = {
  major: '', minor: 'm', augmented: '+', diminished: 'dim', dominant: '7', 'major-seventh': 'maj7',
  'minor-seventh': 'm7', 'diminished-seventh': 'dim7', 'augmented-seventh': '+7', 'half-diminished': 'm7♭5',
  'major-minor': 'm(maj7)', 'major-sixth': '6', 'minor-sixth': 'm6', 'dominant-ninth': '9', 'major-ninth': 'maj9',
  'minor-ninth': 'm9', 'dominant-11th': '11', 'major-11th': 'maj11', 'minor-11th': 'm11', 'dominant-13th': '13',
  'major-13th': 'maj13', 'minor-13th': 'm13', 'suspended-second': 'sus2', 'suspended-fourth': 'sus4', power: '5',
  pedal: 'ped', none: 'N.C.', other: '',
};

/**
 * Symbole d'accord lisible (anglo-saxon, ex. « Dm7 », « G7/B », « B♭maj7 »).
 * @param {{root:string, rootAlter?:number, kind?:string, text?:string, bass?:string, bassAlter?:number, degrees?:Array}} h
 */
export function chordSymbol(h) {
  const acc = (a) => ({ '-2': '𝄫', '-1': '♭', 1: '♯', 2: '𝄪' }[Math.round(a || 0)] || '');
  if (h.kind === 'none') return 'N.C.';
  let suffix = h.text != null && h.text !== '' ? h.text : KIND_SUFFIX[h.kind] ?? '';
  for (const d of h.degrees || []) {
    const a = acc(d.alter);
    if (d.type === 'add') suffix += `add${a}${d.value}`;
    else if (d.type === 'alter') suffix += `(${a}${d.value})`;
    else if (d.type === 'subtract') suffix += `no${d.value}`;
  }
  let s = (h.root || '').toUpperCase() + acc(h.rootAlter) + suffix;
  if (h.bass) s += '/' + h.bass.toUpperCase() + acc(h.bassAlter);
  return s;
}

/** Nuances reconnues. */
export const DYNAMIC_MARKS = ['pppp', 'ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'ffff', 'fp', 'sf', 'sfz', 'sffz', 'sfp', 'fz', 'rfz', 'rf'];
