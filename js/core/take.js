// Prise (enregistrement horodaté de ce que l'élève a joué) + analyse détaillée. Module pur, sans DOM.
//
// Une prise : { v, songId, title, at, mode, hands, tempo, tempoPct, from, to, timeSig, notes, pedal, anchors }
//   notes  : [{ midi, t0, t1, vel, src, judge, noteId?, nb?, hand?, exp?, delta? }]
//            t0/t1 en secondes (mode tempo : temps du morceau depuis le début du passage ; sinon horloge de la séance)
//            judge : 'ok' | 'early' | 'late' | 'wrong' | 'extra' | null
//            nb    : temps (noires) de la note attendue correspondante ; exp : notes attendues au moment d'une faute
//   pedal  : [{ t, down }]
//   anchors: [[t, beat]] correspondance temps -> position dans la partition (interpolation linéaire)
import { holdVerdict, ARPEGGIO_GAP } from './practice.js';

export const TAKE_MAX = 5;
export const TAKE_MAX_BYTES = 150000;
export const TAKE_MAX_NOTES = 4000;
export const TAKE_PREFIX = 'pianocoach.takes.';

const SRC = ['midi', 'keyboard', 'mouse', 'mic', 'mic-chord'];
const JUDGES = [null, 'ok', 'early', 'late', 'wrong', 'extra'];

export function createTake(meta = {}) {
  return {
    v: 1, songId: meta.songId || 'exercice', title: meta.title || '', at: meta.at ?? Date.now(), mode: meta.mode || 'wait', hands: meta.hands || 'both',
    tempo: meta.tempo || 90, tempoPct: meta.tempoPct ?? 100, from: meta.from || 0, to: meta.to ?? 0, timeSig: meta.timeSig || [4, 4],
    notes: [], pedal: [], anchors: [],
  };
}

/** Ajoute une note jouée ; renvoie son index. */
export function takeNoteOn(take, n) {
  if (take.notes.length >= TAKE_MAX_NOTES) return -1;
  take.notes.push({ midi: n.midi, t0: n.t, t1: null, vel: n.vel ?? 0.8, src: n.src || 'keyboard', judge: n.judge ?? null, noteId: n.noteId, nb: n.nb, hand: n.hand, exp: n.exp, delta: n.delta });
  return take.notes.length - 1;
}

/** Relâche la dernière note ouverte de cette hauteur. */
export function takeNoteOff(take, midi, t) {
  for (let i = take.notes.length - 1; i >= 0; i--) {
    const n = take.notes[i];
    if (n.midi === midi && n.t1 == null) {
      n.t1 = Math.max(n.t0, t);
      return n;
    }
  }
  return null;
}

export function takePedal(take, down, t) {
  take.pedal.push({ t, down: !!down });
}

export function addAnchor(take, t, beat) {
  const a = take.anchors;
  const last = a[a.length - 1];
  if (last && t <= last[0]) {
    if (Math.abs(t - last[0]) < 1e-9) last[1] = beat;
    return;
  }
  if (last && beat < last[1]) return; // la position ne recule pas
  a.push([t, beat]);
}

/** Ferme les notes encore tenues. */
export function closeTake(take, tEnd) {
  for (const n of take.notes) if (n.t1 == null) n.t1 = Math.max(n.t0, tEnd ?? n.t0 + 0.5);
  return take;
}

/** Jugement d'une note de la prise à partir du résultat du moteur. */
export function judgeOf(res, okSec = 0.08) {
  if (!res) return null;
  if (res.type === 'wrong') return 'wrong';
  if (res.type === 'offtime') return 'late';
  if (res.type === 'hit' || res.type === 'advance' || res.type === 'finish') {
    if (res.delta == null || Math.abs(res.delta) <= okSec) return 'ok';
    return res.delta < 0 ? 'early' : 'late';
  }
  return null;
}

function spbOf(take) {
  return 60 / (take.tempo > 0 ? take.tempo : 90);
}

/** Position dans la partition (temps) pour un instant de la prise. */
export function takeBeatAt(take, t) {
  const a = take.anchors || [];
  const spb = spbOf(take);
  if (!a.length) return (take.from || 0) + t / spb;
  if (a.length === 1 || t <= a[0][0]) return a[0][1] + (t - a[0][0]) / spb;
  for (let i = 1; i < a.length; i++) {
    if (t <= a[i][0]) {
      const [ta, ba] = a[i - 1], [tb, bb] = a[i];
      return ba + ((t - ta) / (tb - ta)) * (bb - ba);
    }
  }
  const [tl, bl] = a[a.length - 1];
  return bl + (t - tl) / spb;
}

/** Instant de la prise pour une position dans la partition (inverse de takeBeatAt). */
export function takeTimeAt(take, beat) {
  const a = take.anchors || [];
  const spb = spbOf(take);
  if (!a.length) return (beat - (take.from || 0)) * spb;
  if (a.length === 1 || beat <= a[0][1]) return a[0][0] + (beat - a[0][1]) * spb;
  for (let i = 1; i < a.length; i++) {
    if (beat <= a[i][1]) {
      const [ta, ba] = a[i - 1], [tb, bb] = a[i];
      if (bb - ba < 1e-9) return tb;
      return ta + ((beat - ba) / (bb - ba)) * (tb - ta);
    }
  }
  const [tl, bl] = a[a.length - 1];
  return tl + (beat - bl) * spb;
}

/** Notes de la prise placées dans la partition (temps), pour la superposition « notes qui tombent ». */
export function takeOverlay(take) {
  return take.notes.map((n, i) => {
    const start = takeBeatAt(take, n.t0);
    const end = takeBeatAt(take, n.t1 ?? n.t0 + 0.3);
    return { id: 'take-' + i, midi: n.midi, start, dur: Math.max(0.08, end - start), judge: n.judge, hand: n.hand };
  });
}

/** Convertit la prise en morceau (pour l'export .mid ou la relecture). */
export function takeToSong(take, song = null) {
  const offset = take.from || 0;
  const notes = take.notes.map((n) => {
    const start = takeBeatAt(take, n.t0);
    const end = takeBeatAt(take, n.t1 ?? n.t0 + 0.5);
    return { midi: n.midi, start: Math.max(0, start - offset), dur: Math.max(0.05, end - start), hand: n.hand || (n.midi < 60 ? 'L' : 'R'), velocity: n.vel };
  }).filter((n) => Number.isFinite(n.start) && n.midi >= 0 && n.midi <= 127);
  return {
    title: `${take.title || song?.title || 'Ma prise'} — ma prise`, composer: 'Piano Coach', tempo: Math.round(take.tempo) || 90,
    timeSig: take.timeSig || song?.timeSig || [4, 4], keyFifths: song?.keyFifths || 0, notes,
  };
}

// ---------- stockage (5 dernières prises par morceau, taille limitée) ----------
export function packTake(take) {
  const ms = (x) => (x == null ? -1 : Math.round(x * 1000));
  return {
    v: 1, s: take.songId, ti: take.title, at: take.at, m: take.mode, h: take.hands, tp: Math.round(take.tempo * 100) / 100, pc: take.tempoPct, f: take.from, to: take.to, ts: take.timeSig,
    n: take.notes.map((n) => [n.midi, ms(n.t0), n.t1 == null ? -1 : ms(n.t1 - n.t0), Math.round((n.vel ?? 0.8) * 127), Math.max(0, SRC.indexOf(n.src)), Math.max(0, JUDGES.indexOf(n.judge)), n.nb == null ? null : Math.round(n.nb * 1000) / 1000, n.hand === 'L' ? 1 : n.hand === 'R' ? 0 : -1, n.delta == null ? null : ms(n.delta)]),
    p: take.pedal.map((p) => [ms(p.t), p.down ? 1 : 0]),
    a: take.anchors.map(([t, b]) => [ms(t), Math.round(b * 1000) / 1000]),
  };
}

export function unpackTake(p) {
  if (!p || p.v !== 1) return null;
  const take = createTake({ songId: p.s, title: p.ti, at: p.at, mode: p.m, hands: p.h, tempo: p.tp, tempoPct: p.pc, from: p.f, to: p.to, timeSig: p.ts });
  take.notes = (p.n || []).map(([midi, t0, d, vel, src, judge, nb, hand, delta]) => ({
    midi, t0: t0 / 1000, t1: d < 0 ? null : (t0 + d) / 1000, vel: vel / 127, src: SRC[src] || 'keyboard', judge: JUDGES[judge] ?? null,
    nb: nb == null ? undefined : nb, hand: hand === 1 ? 'L' : hand === 0 ? 'R' : undefined, delta: delta == null ? undefined : delta / 1000,
  }));
  take.pedal = (p.p || []).map(([t, d]) => ({ t: t / 1000, down: !!d }));
  take.anchors = (p.a || []).map(([t, b]) => [t / 1000, b]);
  return take;
}

function storageOf(storage) {
  return storage || globalThis.localStorage || null;
}

export function loadTakes(songId, storage) {
  const st = storageOf(storage);
  try {
    const raw = st?.getItem(TAKE_PREFIX + songId);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.map(unpackTake).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** Garde les `max` dernières prises du morceau, en limitant la taille stockée. */
export function saveTake(songId, take, { storage, max = TAKE_MAX, maxBytes = TAKE_MAX_BYTES } = {}) {
  const st = storageOf(storage);
  if (!st) return false;
  let list;
  try {
    const raw = st.getItem(TAKE_PREFIX + songId);
    list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) list = [];
  } catch {
    list = [];
  }
  let packed = packTake(take);
  list.push(packed);
  list = list.slice(-max);
  let json = JSON.stringify(list);
  while (json.length > maxBytes && list.length > 1) {
    list.shift();
    json = JSON.stringify(list);
  }
  if (json.length > maxBytes) {
    // une seule prise trop longue : on ne garde que le début
    const keep = Math.max(10, Math.floor(packed.n.length * (maxBytes / json.length) * 0.9));
    packed = { ...packed, n: packed.n.slice(0, keep) };
    list = [packed];
    json = JSON.stringify(list);
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      st.setItem(TAKE_PREFIX + songId, json);
      return true;
    } catch {
      if (list.length <= 1) return false;
      list.shift();
      json = JSON.stringify(list);
    }
  }
  return false;
}

// ---------- analyse ----------
export function mean(a) {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}

export function stdDev(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
}

/** Histogramme des écarts (ms) en classes de `binMs`, bornées à ±rangeMs. */
export function histogram(valuesMs, { binMs = 20, rangeMs = 200 } = {}) {
  const n = Math.round((2 * rangeMs) / binMs);
  const bins = Array.from({ length: n }, (_, i) => ({ from: -rangeMs + i * binMs, to: -rangeMs + (i + 1) * binMs, count: 0 }));
  for (const v of valuesMs) {
    const i = Math.max(0, Math.min(n - 1, Math.floor((v + rangeMs) / binMs)));
    bins[i].count++;
  }
  return bins;
}

function pedalDownAt(pedal, t) {
  let down = false;
  for (const p of pedal || []) {
    if (p.t > t) break;
    down = p.down;
  }
  return down;
}

function legatoExpected(a, b) {
  return a.slur && b.slur && a.slur !== 'stop' && b.slur !== 'start' && a.midi !== b.midi && Math.abs(a.start + a.dur - b.start) < 0.05;
}

/**
 * Analyse complète d'une prise par rapport à la partition.
 * @param {object} take
 * @param {object} song morceau préparé
 * @param {{secOf?:(beat:number)=>number}} [opts] conversion temps -> secondes (carte de tempo) ; défaut : tempo de la prise
 */
export function analyzeTake(take, song, opts = {}) {
  const spb = 60 / (take.tempo || song.tempo || 90);
  const secOf = opts.secOf || ((b) => b * spb);
  const bpm = song.beatsPerMeasure || 4;
  const measureOf = (b) => Math.floor(b / bpm + 1e-6) + 1;
  const byId = new Map(song.notes.map((n) => [n.id, n]));
  const byKey = new Map(song.notes.map((n) => [`${Math.round(n.start * 1000)}:${n.midi}`, n]));
  const noteFor = (x) => (x.noteId != null && byId.get(x.noteId)) || (x.nb != null ? byKey.get(`${Math.round(x.nb * 1000)}:${x.midi}`) : null) || null;

  const hits = take.notes.filter((n) => n.judge === 'ok' || n.judge === 'early' || n.judge === 'late').map((n) => ({ ...n, note: noteFor(n) }));
  // écarts rythmiques (mode tempo)
  const timed = hits.filter((h) => h.delta != null && Number.isFinite(h.delta) && h.nb != null);
  const timing = timed.map((h) => ({ beat: h.nb, measure: measureOf(h.nb), ms: Math.round(h.delta * 1000), hand: h.hand || h.note?.hand || 'R' }));
  const hands = {};
  for (const hand of ['R', 'L']) {
    const v = timing.filter((x) => x.hand === hand).map((x) => x.ms);
    if (v.length) hands[hand] = { n: v.length, mean: mean(v), sd: stdDev(v), hist: histogram(v) };
  }
  const allMs = timing.map((x) => x.ms);
  const regularity = { n: allMs.length, mean: mean(allMs), sd: stdDev(allMs), hist: histogram(allMs) };

  // dérive de tempo par mesure : pente temps joué / temps attendu
  const perMeasure = new Map();
  for (const h of timed) {
    const m = measureOf(h.nb);
    const arr = perMeasure.get(m) || [];
    arr.push({ expected: h.t0 - h.delta, actual: h.t0 });
    perMeasure.set(m, arr);
  }
  const drift = [...perMeasure.entries()].sort((a, b) => a[0] - b[0]).map(([measure, pts]) => {
    const meanDelta = mean(pts.map((p) => p.actual - p.expected));
    let tempoPct = null;
    const xs = pts.map((p) => p.expected);
    if (pts.length >= 2 && Math.max(...xs) - Math.min(...xs) > 0.2) {
      const mx = mean(xs), my = mean(pts.map((p) => p.actual));
      let num = 0, den = 0;
      for (const p of pts) {
        num += (p.expected - mx) * (p.actual - my);
        den += (p.expected - mx) ** 2;
      }
      const slope = den > 0 ? num / den : 1;
      if (slope > 0.2) tempoPct = Math.round(100 / slope);
    }
    return { measure, meanMs: Math.round(meanDelta * 1000), n: pts.length, tempoPct };
  });

  // accords arpégés : notes d'un même accord (même main, même temps) attaquées trop loin l'une de l'autre
  const chordGroups = new Map();
  for (const h of hits) {
    if (h.nb == null) continue;
    const hand = h.hand || h.note?.hand || 'R';
    const k = `${Math.round(h.nb * 1000)}:${hand}`;
    const g = chordGroups.get(k) || { beat: h.nb, hand, times: [] };
    g.times.push(h.t0);
    chordGroups.set(k, g);
  }
  const arpeggios = [];
  for (const g of chordGroups.values()) {
    if (g.times.length < 2) continue;
    const spread = Math.max(...g.times) - Math.min(...g.times);
    if (spread > ARPEGGIO_GAP) arpeggios.push({ beat: g.beat, measure: measureOf(g.beat), hand: g.hand, spreadMs: Math.round(spread * 1000), notes: g.times.length });
  }
  arpeggios.sort((a, b) => a.beat - b.beat);

  // durées tenues (clavier MIDI / ordinateur / souris : grâce au relâchement)
  const durations = [];
  for (const h of hits) {
    if (h.t1 == null || !h.note || h.src === 'mic' || h.src === 'mic-chord') continue;
    const expSec = secOf(h.note.start + h.note.dur) - secOf(h.note.start);
    if (expSec < 0.12) continue;
    const ratio = (h.t1 - h.t0) / expSec;
    const verdict = holdVerdict(ratio, pedalDownAt(take.pedal, h.t1));
    durations.push({ beat: h.note.start, measure: measureOf(h.note.start), midi: h.midi, hand: h.note.hand, ratio, verdict });
  }

  // legato manquant sur les notes liées
  const legato = [];
  for (const hand of ['R', 'L']) {
    const seq = hits.filter((h) => h.note && h.note.hand === hand).sort((a, b) => a.note.start - b.note.start || a.t0 - b.t0);
    for (let i = 1; i < seq.length; i++) {
      const a = seq[i - 1], b = seq[i];
      if (!legatoExpected(a.note, b.note) || a.t1 == null) continue;
      const gap = b.t0 - a.t1;
      if (gap > 0.03) legato.push({ beat: b.note.start, measure: measureOf(b.note.start), hand, gapMs: Math.round(gap * 1000) });
    }
  }

  // notes en trop + confusions fréquentes
  const extras = take.notes.filter((n) => n.judge === 'wrong' || n.judge === 'extra').map((n) => ({ midi: n.midi, t: n.t0, beat: n.nb ?? takeBeatAt(take, n.t0), exp: n.exp || [] }));
  const conf = new Map();
  for (const e of extras) {
    const exp = (e.exp || []).filter((m) => m !== e.midi);
    if (!exp.length) continue;
    const target = exp.reduce((best, m) => (Math.abs(m - e.midi) < Math.abs(best - e.midi) ? m : best), exp[0]);
    const k = `${e.midi}>${target}`;
    conf.set(k, (conf.get(k) || 0) + 1);
  }
  const confusions = [...conf.entries()].map(([k, count]) => {
    const [played, expected] = k.split('>').map(Number);
    return { played, expected, count };
  }).filter((c) => c.count >= 2).sort((a, b) => b.count - a.count);

  return {
    timing, hands, regularity, drift, arpeggios, durations, legato, extras, confusions,
    short: durations.filter((d) => d.verdict === 'short').length,
    long: durations.filter((d) => d.verdict === 'long').length,
    notes: take.notes.length,
  };
}
