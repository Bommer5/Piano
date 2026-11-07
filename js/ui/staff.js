// Portée de piano (clé de sol + clé de fa) en SVG.
//
// Notation fidèle : armure, altérations accidentelles valables pour la mesure (avec rappels),
// silences, ligatures par temps, notes pointées et liées (découpage aux barres de mesure),
// triolets, accords sur une seule hampe, symboles d'accords, nuances, pédale, articulations,
// liaisons de phrasé. L'espacement reste proportionnel au temps (le curseur de l'entraîneur en a
// besoin) mais s'élargit localement pour éviter les collisions (altérations, points, crochets).
// La logique pure est dans js/core/notation.js (testée dans Node).
import { noteLabel } from '../core/notes.js';
import {
  songKey, spellNote, assignStaves, splitNote, snapTime, snapDuration, restsInMeasure, mergeIntervals,
  computeAccidentals, beamGroups, melodicDirections, tupletGroups, flagCount, beatUnit, measureNumber, keySignatureAlters,
} from '../core/notation.js';

const NS = 'http://www.w3.org/2000/svg';
const GAP = 10; // écart entre lignes
const HS = GAP / 2; // demi-écart (un degré)
const TREBLE_BOTTOM = 70; // y de la ligne du Mi4 (mise en page par défaut, cf. staffY)
const BASS_BOTTOM = 160; // y de la ligne du Sol2
const LEFT = 64;
const STEM = 33;
const EPS = 1e-6;

function el(name, attrs = {}, parent) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, typeof v === 'number' ? Math.round(v * 100) / 100 : v);
  if (parent) parent.appendChild(e);
  return e;
}
function txt(parent, x, y, cls, s, extra = {}) {
  const t = el('text', { x, y, class: cls, ...extra }, parent);
  t.textContent = s;
  return t;
}

/** y d'une position diatonique sur la portée donnée (mise en page par défaut, conservé pour compatibilité). */
export function staffY(diatonic, clef) {
  return clef === 'bass' ? BASS_BOTTOM - (diatonic - 18) * HS : TREBLE_BOTTOM - (diatonic - 30) * HS;
}

// Lignes : clé de sol Mi4..Fa5 (diatoniques 30..38), clé de fa Sol2..La3 (18..26).
const LINES = { treble: [30, 38], bass: [18, 26] };
const MID = { treble: 34, bass: 22 };

function ledgers(d, clef) {
  const res = [];
  const [low, high] = LINES[clef];
  for (let x = low - 2; x >= d; x -= 2) res.push(x);
  for (let x = high + 2; x <= d; x += 2) res.push(x);
  return res;
}

// --- Glyphes dessinés (indépendants des polices) ---------------------------
function accidentalGlyph(g, alter, x, y, cls = 'accidental') {
  const p = (d, w) => el('path', { d, class: cls, 'stroke-width': w }, g);
  if (alter === 1) {
    p(`M${x - 2} ${y - 9}V${y + 9}M${x + 2} ${y - 10}V${y + 8}`, 1.1);
    p(`M${x - 4.5} ${y - 2}L${x + 4.5} ${y - 4.5}M${x - 4.5} ${y + 4.2}L${x + 4.5} ${y + 1.7}`, 2.4);
  } else if (alter === -1 || alter === -2) {
    const xs = alter === -2 ? [x - 3, x + 3] : [x];
    for (const xx of xs) {
      p(`M${xx - 3} ${y - 13}V${y + 4.5}`, 1.2);
      p(`M${xx - 3} ${y + 4.5}C${xx + 5} ${y + 0.5} ${xx + 4} ${y - 6} ${xx - 3} ${y - 1.5}`, 1.7);
    }
  } else if (alter === 0) {
    p(`M${x - 3} ${y - 10}V${y + 4}M${x + 3} ${y - 4}V${y + 10}`, 1.1);
    p(`M${x - 3} ${y + 3.5}L${x + 3} ${y + 1.5}M${x - 3} ${y - 1.5}L${x + 3} ${y - 3.5}`, 2.4);
  } else if (alter === 2) {
    p(`M${x - 3.5} ${y - 3.5}L${x + 3.5} ${y + 3.5}M${x + 3.5} ${y - 3.5}L${x - 3.5} ${y + 3.5}`, 2);
  }
}

function restGlyph(g, type, x, mid, top) {
  const cls = 'rest';
  if (type === 'whole') return el('rect', { x: x - 6, y: top + GAP, width: 12, height: 5, class: cls }, g);
  if (type === 'half') return el('rect', { x: x - 6, y: mid - 5, width: 12, height: 5, class: cls }, g);
  if (type === 'quarter') {
    return el('path', { d: `M${x - 3} ${mid - 14}L${x + 3} ${mid - 6}L${x - 2} ${mid}L${x + 3} ${mid + 6}C${x - 3} ${mid + 3} ${x - 4} ${mid + 9} ${x} ${mid + 12}`, class: cls + ' stroke', 'stroke-width': 2.2 }, g);
  }
  const n = { eighth: 1, '16th': 2, '32nd': 3 }[type] || 1;
  const gg = el('g', { class: cls }, g);
  for (let k = 0; k < n; k++) {
    const yy = mid - 5 + k * 7;
    const xx = x - 1 - k * 1.6;
    el('circle', { cx: xx - 2.5, cy: yy, r: 2.1, class: cls }, gg);
    el('path', { d: `M${xx - 2.5} ${yy + 1}Q${xx + 1} ${yy + 2} ${xx + 4} ${yy - 3}`, class: cls + ' stroke', 'stroke-width': 1.4 }, gg);
  }
  el('path', { d: `M${x + 3} ${mid - 8}L${x - 2 - n * 1.6} ${mid + 4 + n * 6}`, class: cls + ' stroke', 'stroke-width': 1.5 }, gg);
  return gg;
}

const KEY_SHARPS = { treble: [38, 35, 39, 36, 33, 37, 34], bass: [24, 21, 25, 22, 19, 23, 20] };
const KEY_FLATS = { treble: [34, 37, 33, 36, 32, 35, 31], bass: [20, 23, 19, 22, 18, 21, 17] };

const layoutCache = new WeakMap();
const staffCache = new WeakMap();

/** Mise en page verticale, stable pour tout le morceau (pas de saut entre les pages). */
function verticalLayout(song, staves, opts) {
  const key = `${!!opts.chords}:${!!opts.tempo}:${!!opts.pedal}`;
  const c = layoutCache.get(song);
  if (c && c.key === key) return c.L;
  let maxT = 38, minB = 18, minT = 30, maxB = 26;
  for (const n of song.notes) {
    const st = staves.get(n.id);
    const d = Math.floor(n.midi / 12 - 1) * 7 + [0, 0, 1, 2, 2, 3, 3, 4, 4, 5, 6, 6][n.midi % 12];
    if (st === 'treble') { maxT = Math.max(maxT, d); minT = Math.min(minT, d); }
    else { minB = Math.min(minB, d); maxB = Math.max(maxB, d); }
  }
  let top = 6 + (opts.tempo ? 14 : 0) + (opts.chords ? 16 : 0);
  const TT = top + Math.min(80, Math.max(40, (maxT - 38) * HS + 48));
  const TB = TT + 4 * GAP;
  const between = Math.min(110, Math.max(70, (30 - minT) * HS + (maxB - 26) * HS + 40));
  const BT = TB + between;
  const BB = BT + 4 * GAP;
  const height = BB + Math.min(84, Math.max(34, (18 - minB) * HS + 34)) + (opts.pedal ? 18 : 0);
  const L = { TT, TB, BT, BB, height, tempoY: 14, chordY: 6 + (opts.tempo ? 14 : 0) + 11, pedalY: height - 8 };
  layoutCache.set(song, { key, L });
  return L;
}

function stavesOf(song) {
  let s = staffCache.get(song);
  if (!s || s.n !== song.notes) {
    s = { n: song.notes, map: assignStaves(song.notes), dirs: melodicDirections(song.notes) };
    staffCache.set(song, s);
  }
  return s;
}

export class StaffView {
  constructor(container) {
    this.container = container;
    this.svg = el('svg', { class: 'staff', preserveAspectRatio: 'xMinYMin meet', role: 'img', 'aria-label': 'Partition' });
    container.appendChild(this.svg);
    this.page = null;
    this.noteEls = new Map();
  }

  /**
   * @param {object} song morceau préparé
   * @param {number} from début (temps)
   * @param {number} to fin (temps)
   * @param {object} opts {settings, showFingers, showNoteNames, activeHands, onNoteClick(note, event),
   *                       hiddenMeasures: Set de numéros de mesure (tels qu'affichés) à masquer}
   */
  render(song, from, to, opts = {}) {
    const settings = opts.settings || {};
    let width = Math.max(320, this.container.clientWidth || 800);
    this.noteEls.clear();
    this.page = { from, to };
    const bpm = song.beatsPerMeasure || 4;
    const beat = beatUnit(song.timeSig);
    const pickup = song.pickupBeats > EPS ? song.pickupBeats : 0;
    const key = songKey(song);
    const { map: staves, dirs } = stavesOf(song);
    const hidden = opts.hiddenMeasures instanceof Set ? opts.hiddenMeasures : null;
    const mNum = (b) => measureNumber(b, bpm, pickup);
    const isHidden = (b) => !!hidden && hidden.has(mNum(b));
    const showChords = settings.showChordSymbols !== false && Array.isArray(song.chords) && song.chords.length > 0;
    const tempoMarks = (song.tempoMap || []).filter((t) => t.beat > EPS && t.beat >= from - EPS && t.beat < to - EPS);
    const L = verticalLayout(song, staves, { chords: showChords, tempo: Array.isArray(song.tempoMap) && song.tempoMap.length > 1, pedal: Array.isArray(song.pedal) && song.pedal.length > 0 });
    const height = L.height;
    const { TT, TB, BT, BB } = L;
    const top = { treble: TT, bass: BT };
    const bottom = { treble: TB, bass: BB };
    const yOf = (d, clef) => (clef === 'bass' ? BB - (d - 18) * HS : TB - (d - 30) * HS);
    const midY = (clef) => (top[clef] + bottom[clef]) / 2;

    // ------------------------------------------------------------------
    // 1. Morceaux de notes (découpés et liés) dans la page
    // ------------------------------------------------------------------
    const pieces = [];
    const byNote = new Map();
    for (const n of song.notes) {
      const s0 = snapTime(n.start);
      const d0 = snapDuration(n.dur);
      if (s0 >= to - EPS || s0 + d0 <= from + EPS) continue;
      const clef = staves.get(n.id) || (n.hand === 'L' ? 'bass' : 'treble');
      const sp = spellNote(n, key, dirs.get(n.id) || 0);
      const parts = splitNote(s0, d0, bpm);
      const list = [];
      parts.forEach((p, i) => {
        if (p.start < from - 1e-3 || p.start >= to - 1e-3) return;
        const pc = { ...p, note: n, clef, sp, d: sp.diatonic, first: i === 0, idx: i, last: i === parts.length - 1, hiddenM: isHidden(p.start) };
        pieces.push(pc);
        list.push(pc);
      });
      if (list.length) byNote.set(n.id, list);
    }
    pieces.sort((a, b) => a.start - b.start || a.d - b.d);

    // Altérations (calculées aussi pour les mesures masquées : la règle de la mesure s'applique)
    const acc = computeAccidentals(
      pieces.map((p) => ({ measure: Math.floor(p.start / bpm + 1e-6), staff: p.clef, sp: p.sp, tieStop: p.tieStop })),
      key.fifths,
    );
    pieces.forEach((p, i) => (p.acc = acc[i]));

    // Accords (une hampe) : même portée, même main, même début, même valeur
    const chordMap = new Map();
    for (const p of pieces) {
      const k = `${p.clef}|${p.note.hand}|${Math.round(p.start * 1000)}|${Math.round(p.dur * 1000)}|${p.type}|${p.dots}`;
      if (!chordMap.has(k)) chordMap.set(k, { clef: p.clef, hand: p.note.hand, start: p.start, dur: p.dur, type: p.type, dots: p.dots, tuplet: p.tuplet, heads: [], hidden: p.hiddenM });
      chordMap.get(k).heads.push(p);
    }
    const chords = [...chordMap.values()].sort((a, b) => a.start - b.start || Math.max(...b.heads.map((h) => h.d)) - Math.max(...a.heads.map((h) => h.d)));
    // Voix par (portée, mesure) : attribution gloutonne sans chevauchement
    const voiceCount = new Map();
    const voiceEnds = new Map();
    for (const c of chords) {
      c.measure = Math.floor(c.start / bpm + 1e-6);
      const vk = `${c.clef}|${c.measure}`;
      const ends = voiceEnds.get(vk) || [];
      let v = ends.findIndex((e) => e.end <= c.start + 1e-3 && e.hand === c.hand);
      if (v < 0) v = ends.findIndex((e) => e.end <= c.start + 1e-3);
      if (v < 0) { v = ends.length; ends.push({ end: 0, hand: c.hand }); }
      ends[v] = { end: c.start + c.dur, hand: c.hand };
      voiceEnds.set(vk, ends);
      c.voice = v;
    }
    for (const [vk, ends] of voiceEnds) voiceCount.set(vk, ends.length);
    for (const c of chords) {
      c.heads.sort((a, b) => a.d - b.d);
      const lo = c.heads[0].d, hi = c.heads[c.heads.length - 1].d;
      const multi = voiceCount.get(`${c.clef}|${c.measure}`) > 1;
      c.up = multi ? c.voice === 0 : hi - MID[c.clef] <= MID[c.clef] - lo;
      c.multi = multi;
    }

    // Ligatures et triolets (par portée)
    const beamed = new Set();
    const beams = [];
    const tuplets = [];
    for (const clef of ['treble', 'bass']) {
      const evs = chords.filter((c) => c.clef === clef && !c.hidden);
      const evData = evs.map((c) => ({ start: c.start, dur: c.dur, type: c.type, tuplet: c.tuplet, voice: `${c.voice}|${c.hand}` }));
      tupletGroups(evData).forEach((g, gi) => {
        tuplets.push(g.map((i) => evs[i]));
        for (const i of g) evData[i].group = gi;
      });
      for (const g of beamGroups(evData, { beat, measureLen: bpm })) {
        const grp = g.map((i) => evs[i]);
        beams.push(grp);
        for (const c of grp) beamed.add(c);
      }
    }
    // direction commune pour un groupe ligaturé (voix unique)
    for (const grp of beams) {
      if (grp[0].multi) continue;
      const sum = grp.reduce((s, c) => s + c.heads.reduce((a, h) => a + (h.d - MID[c.clef]), 0) / c.heads.length + (c.heads[c.heads.length - 1].d - MID[c.clef]) + (c.heads[0].d - MID[c.clef]), 0);
      const up = sum <= 0;
      for (const c of grp) c.up = up;
    }
    // têtes décalées (secondes) et colonnes d'altérations
    for (const c of chords) {
      const order = c.up ? c.heads : [...c.heads].reverse();
      let prev = null;
      for (const h of order) {
        h.shift = 0;
        if (prev && Math.abs(h.d - prev.d) === 1 && !prev.shift) h.shift = c.up ? 11.5 : -11.5;
        prev = h;
      }
      const cols = [];
      for (const h of [...c.heads].reverse()) {
        if (!h.acc) continue;
        let ci = cols.findIndex((col) => col.every((d) => Math.abs(d - h.d) >= 6));
        if (ci < 0) { ci = cols.length; cols.push([]); }
        cols[ci].push(h.d);
        h.accCol = ci;
      }
      c.accCols = cols.length;
      c.leftShift = c.heads.some((h) => h.shift < 0) ? 11.5 : 0;
      c.rightShift = c.heads.some((h) => h.shift > 0) ? 11.5 : 0;
    }

    // ------------------------------------------------------------------
    // 2. Silences par main (complètent les trous)
    // ------------------------------------------------------------------
    const rests = [];
    const handsPresent = ['R', 'L'].filter((hd) => (song.hands ? song.hands[hd] : song.notes.some((n) => n.hand === hd)));
    for (const hand of handsPresent) {
      const handNotes = song.notes.filter((n) => n.hand === hand);
      const st = handNotes.find((n) => n.staff === 1 || n.staff === 2);
      const clef = st ? (st.staff === 2 ? 'bass' : 'treble') : hand === 'L' ? 'bass' : 'treble';
      const covered = handNotes
        .filter((n) => n.start < to + 1 && n.start + n.dur > from - 1)
        .map((n) => { const s = snapTime(n.start); return [s, s + snapDuration(n.dur)]; });
      const merged = mergeIntervals(covered);
      for (let m = Math.floor(from / bpm + 1e-6) * bpm; m < to - EPS; m += bpm) {
        if (isHidden(m)) continue;
        const restFrom = pickup && m < EPS ? bpm - pickup : m;
        for (const r of restsInMeasure(merged, m, bpm, { beat, from: Math.max(restFrom, from) })) rests.push({ ...r, clef, hand });
      }
    }

    // ------------------------------------------------------------------
    // 3. Espacement horizontal : proportionnel, élargi là où il faut
    // ------------------------------------------------------------------
    const f = Math.max(-7, Math.min(7, Math.round(key.fifths || 0)));
    const showTime = from < EPS;
    const headerW = 8 + 34 + Math.abs(f) * 8 + (showTime ? 24 : 0) + 8;
    const anchors = new Map(); // t -> {L, R}
    const anchor = (t) => {
      const k = Math.round(t * 1e4) / 1e4;
      if (!anchors.has(k)) anchors.set(k, { t: k, L: 8, R: 8 });
      return anchors.get(k);
    };
    anchor(from); anchor(to);
    for (let b = Math.ceil(from / bpm - 1e-6) * bpm; b <= to + EPS; b += bpm) anchor(b).bar = b > from + EPS;
    const charW = 6.2;
    for (const c of chords) {
      const a = anchor(c.start);
      a.L = Math.max(a.L, 8 + c.accCols * 9 + c.leftShift + (c.heads.some((h) => h.acc?.courtesy) ? 16 : 0));
      let r = 8 + c.rightShift + (c.dots ? 7 : 0) + (c.up && flagCount(c.type) && !beamed.has(c) ? 8 : 0);
      if (opts.showNoteNames) r = Math.max(r, 13);
      a.R = Math.max(a.R, r);
      if (opts.showNoteNames) a.L = Math.max(a.L, 13);
    }
    for (const r of rests) {
      const a = anchor(r.start);
      a.L = Math.max(a.L, 8);
      a.R = Math.max(a.R, 9 + (r.dots ? 6 : 0));
    }
    if (showChords) {
      for (const ch of song.chords) {
        if (ch.beat < from - EPS || ch.beat >= to - EPS) continue;
        const a = anchor(ch.beat);
        a.R = Math.max(a.R, String(ch.symbol).length * charW + 4);
      }
    }
    for (const a of anchors.values()) if (a.bar) a.L += 10;
    const list = [...anchors.values()].sort((a, b) => a.t - b.t);
    const x0 = headerW + list[0].L;
    let avail = width - 10 - x0;
    const mins = list.slice(1).map((a, i) => list[i].R + a.L);
    const total = (ppb) => list.slice(1).reduce((s, a, i) => s + Math.max((a.t - list[i].t) * ppb, mins[i]), 0);
    let lo = 0, hi = 2000;
    let k = 1;
    if (total(0) > avail && this.canScroll()) {
      // conteneur défilant (aperçu des phrases) : on élargit plutôt que de comprimer
      width = Math.ceil(x0 + total(0) * 1.15 + 10);
      avail = width - 10 - x0;
    }
    if (total(0) > avail) k = avail / total(0);
    else {
      for (let it = 0; it < 40; it++) {
        const mid = (lo + hi) / 2;
        if (total(mid) > avail) hi = mid; else lo = mid;
      }
    }
    const xs = [x0];
    list.slice(1).forEach((a, i) => xs.push(xs[i] + (k < 1 ? mins[i] * k : Math.max((a.t - list[i].t) * lo, mins[i]))));
    const ts = list.map((a) => a.t);
    const xOf = (b) => {
      if (b <= ts[0]) return xs[0] + (b - ts[0]) * (lo || 20);
      for (let i = 1; i < ts.length; i++) {
        if (b <= ts[i] + 1e-9) return xs[i - 1] + ((b - ts[i - 1]) / (ts[i] - ts[i - 1] || 1)) * (xs[i] - xs[i - 1]);
      }
      return xs[xs.length - 1];
    };
    const barX = (b) => {
      const a = anchors.get(Math.round(b * 1e4) / 1e4);
      return xOf(b) - (a ? a.L : 18) + 4;
    };
    this.xOf = (b) => xOf(b) + 8; // compatibilité : l'ancien curseur était à xOf(beat) - 8
    this.cursorX = (b) => xOf(b) - 10;

    // ------------------------------------------------------------------
    // 4. Dessin
    // ------------------------------------------------------------------
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    this.svg.setAttribute('width', width);
    this.svg.setAttribute('height', height);
    this.svg.innerHTML = '';
    this.svg.classList.toggle('clickable-notes', typeof opts.onNoteClick === 'function');
    const g = el('g', { class: 'staff-frame' }, this.svg);
    const right = width - 8;
    for (const clef of ['treble', 'bass']) {
      for (let i = 0; i < 5; i++) el('line', { x1: 8, x2: right, y1: bottom[clef] - i * GAP, y2: bottom[clef] - i * GAP, class: 'staff-line' }, g);
    }
    el('line', { x1: 8, x2: 8, y1: TT, y2: BB, class: 'bar-line' }, g);
    el('path', { d: `M6 ${TT}C-2 ${TT + 20} 8 ${(TB + BT) / 2 - 8} 1 ${(TB + BT) / 2}C8 ${(TB + BT) / 2 + 8} -2 ${BB - 20} 6 ${BB}`, class: 'brace' }, g);
    txt(g, 12, TB + 4, 'clef', '𝄞');
    txt(g, 12, BB - 13, 'clef bass', '𝄢');
    // armure
    const ks = f > 0 ? KEY_SHARPS : KEY_FLATS;
    for (const clef of ['treble', 'bass']) {
      for (let i = 0; i < Math.abs(f); i++) accidentalGlyph(g, f > 0 ? 1 : -1, 46 + i * 8, yOf(ks[clef][i], clef), 'keysig');
    }
    if (showTime) {
      const tx = 46 + Math.abs(f) * 8 + 8;
      for (const clef of ['treble', 'bass']) {
        txt(g, tx, bottom[clef] - 2 * GAP - 2, 'timesig', song.timeSig[0]);
        txt(g, tx, bottom[clef] + 1, 'timesig', song.timeSig[1]);
      }
    }
    // barres et numéros de mesure
    for (let b = Math.ceil(from / bpm - 1e-6) * bpm; b <= to + 1e-6; b += bpm) {
      const atEnd = b >= to - EPS;
      const x = b > from + EPS ? (atEnd ? Math.min(right, barX(b)) : barX(b)) : headerW - 4;
      if (b > from + EPS) el('line', { x1: x, x2: x, y1: TT, y2: BB, class: 'bar-line' }, g);
      if (b >= song.totalBeats - EPS && b > from + EPS && atEnd) el('line', { x1: x + 3, x2: x + 3, y1: TT, y2: BB, class: 'bar-line final' }, g);
      if (!atEnd) txt(g, b > from + EPS ? x + 3 : 10, TT - 6, 'measure-num', mNum(b));
      if (!atEnd && isHidden(b)) {
        const x2 = barX(Math.min(to, b + bpm));
        const hg = el('g', { class: 'hidden-measure' }, g);
        el('rect', { x: x + 3, y: TT - 2, width: Math.max(10, x2 - x - 6), height: BB - TT + 4, rx: 8 }, hg);
        txt(hg, (x + x2) / 2, (TB + BT) / 2 + 6, 'hidden-label', '?', { 'text-anchor': 'middle' });
        el('title', {}, hg).textContent = `Mesure ${mNum(b)} masquée : joue-la de mémoire`;
      }
    }

    const marks = el('g', { class: 'marks' }, this.svg);
    // indications de tempo
    for (const tm of tempoMarks) txt(marks, xOf(tm.beat) - 6, L.tempoY, 'tempo-mark', `♩ = ${Math.round(tm.bpm)}`);
    // symboles d'accords
    if (showChords) {
      for (const ch of song.chords) {
        if (ch.beat < from - EPS || ch.beat >= to - EPS || isHidden(ch.beat)) continue;
        txt(marks, xOf(ch.beat) - 6, L.chordY, 'chord-symbol', ch.symbol);
      }
    }
    // nuances et soufflets (entre les portées)
    const dynY = (TB + BT) / 2 + 5;
    for (const d of song.dynamics || []) {
      if (d.mark === 'cresc' || d.mark === 'dim' || d.mark === '<' || d.mark === '>') {
        const end = d.end ?? d.beat + 1;
        if (end <= from + EPS || d.beat >= to - EPS) continue;
        const x1 = d.beat < from ? headerW : xOf(d.beat) - 4;
        const x2 = end > to ? right - 4 : xOf(end) - 12;
        if (x2 - x1 < 6) continue;
        const cresc = d.mark === 'cresc' || d.mark === '<';
        const [a, b] = cresc ? [x1, x2] : [x2, x1];
        el('path', { d: `M${b} ${dynY - 8}L${a} ${dynY - 4}L${b} ${dynY}`, class: 'hairpin' }, marks);
      } else if (d.beat >= from - EPS && d.beat < to - EPS && !isHidden(d.beat)) {
        txt(marks, xOf(d.beat) - 8, dynY, 'dynamic', d.mark);
      }
    }
    // pédale
    for (const p of song.pedal || []) {
      if (p.beat < from - EPS || p.beat >= to - EPS) continue;
      txt(marks, xOf(p.beat) - (p.down ? 8 : 2), L.pedalY, 'pedal-mark', p.down ? 'Ped.' : '*');
    }

    // silences
    const restG = el('g', { class: 'rests' }, this.svg);
    for (const r of rests) {
      const clef = r.clef;
      const x = r.whole ? (barX(r.start) + barX(r.start + bpm)) / 2 + (r.start <= from + EPS ? (headerW - barX(r.start)) / 2 : 0) : xOf(r.start);
      const rg = el('g', { class: `rest-g hand-${r.hand}` + (opts.activeHands && opts.activeHands !== 'both' && opts.activeHands !== r.hand ? ' inactive' : '') }, restG);
      restGlyph(rg, r.whole ? 'whole' : r.type, x, midY(clef), top[clef]);
      if (r.dots) el('circle', { cx: x + 9, cy: midY(clef) - 5, r: 1.6, class: 'dot' }, rg);
    }

    // notes
    const notesG = el('g', {}, this.svg);
    const stemsG = el('g', { class: 'stems' }, this.svg);
    const noteGroup = (n) => {
      let ng = this.noteEls.get(n.id);
      if (ng) return ng;
      const inactive = opts.activeHands && opts.activeHands !== 'both' && opts.activeHands !== n.hand;
      ng = el('g', { class: `note hand-${n.hand}` + (inactive ? ' inactive' : '') }, notesG);
      const sp = spellNote(n, key, dirs.get(n.id) || 0);
      const label = `${noteLabel(n.midi, settings, sp)} – doigt ${n.finger || '?'} (${n.hand === 'L' ? 'main gauche' : 'main droite'})`;
      el('title', {}, ng).textContent = label;
      if (typeof opts.onNoteClick === 'function') {
        ng.classList.add('clickable');
        ng.setAttribute('role', 'button');
        ng.setAttribute('tabindex', '0');
        ng.setAttribute('aria-label', label);
        ng.addEventListener('click', (e) => opts.onNoteClick(n, e));
        ng.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            opts.onNoteClick(n, e);
          }
        });
      }
      this.noteEls.set(n.id, ng);
      return ng;
    };

    const stemTip = new Map(); // accord -> y du bout de hampe
    const stemXOf = (c) => xOf(c.start) + (c.up ? 5.6 : -5.6);
    // longueur de hampe par défaut
    for (const c of chords) {
      const yHi = yOf(c.heads[c.heads.length - 1].d, c.clef);
      const yLo = yOf(c.heads[0].d, c.clef);
      let tip = c.up ? yHi - STEM : yLo + STEM;
      const mid = midY(c.clef);
      if (c.up && tip > mid && !c.multi) tip = mid;
      if (!c.up && tip < mid && !c.multi) tip = mid;
      stemTip.set(c, tip);
    }
    // ligatures : droite commune, hampes ajustées
    const beamInfo = new Map();
    for (const grp of beams) {
      const up = grp[0].up;
      const xA = stemXOf(grp[0]), xB = stemXOf(grp[grp.length - 1]);
      const tA = stemTip.get(grp[0]), tB = stemTip.get(grp[grp.length - 1]);
      let slope = xB > xA ? (tB - tA) / (xB - xA) : 0;
      slope = Math.max(-0.18, Math.min(0.18, slope));
      let off = 0;
      for (const c of grp) {
        const yb = tA + slope * (stemXOf(c) - xA);
        const extreme = up ? yOf(c.heads[c.heads.length - 1].d, c.clef) - 26 : yOf(c.heads[0].d, c.clef) + 26;
        if (up) off = Math.min(off, extreme - yb);
        else off = Math.max(off, extreme - yb);
      }
      const yAt = (x) => tA + off + slope * (x - xA);
      for (const c of grp) stemTip.set(c, yAt(stemXOf(c)));
      beamInfo.set(grp, { up, yAt, xA, xB });
    }

    for (const c of chords) {
      if (c.hidden) continue;
      const x = xOf(c.start);
      const sg = el('g', { class: `chord hand-${c.hand}` + (opts.activeHands && opts.activeHands !== 'both' && opts.activeHands !== c.hand ? ' inactive' : '') }, stemsG);
      const hollow = c.type === 'whole' || c.type === 'half';
      // lignes supplémentaires
      const lds = new Set();
      for (const h of c.heads) for (const d of ledgers(h.d, c.clef)) lds.add(`${d}|${h.shift > 0 ? 1 : h.shift < 0 ? -1 : 0}`);
      for (const k of lds) {
        const [d, s] = k.split('|').map(Number);
        const ly = yOf(d, c.clef);
        el('line', { x1: x - 9 + Math.min(0, s * 11.5), x2: x + 9 + Math.max(0, s * 11.5), y1: ly, y2: ly, class: 'staff-line ledger' }, sg);
      }
      for (const h of c.heads) {
        const ng = noteGroup(h.note);
        const hx = x + h.shift;
        const y = yOf(h.d, c.clef);
        if (opts.onNoteClick) el('rect', { x: hx - 9, y: y - 9, width: 18, height: 18, class: 'hit-area' }, ng);
        if (c.type === 'whole') el('ellipse', { cx: hx, cy: y, rx: 7, ry: 4.6, class: 'head hollow whole' }, ng);
        else el('ellipse', { cx: hx, cy: y, rx: 6, ry: 4.3, transform: `rotate(-20 ${hx} ${y})`, class: 'head' + (hollow ? ' hollow' : '') }, ng);
        for (let k = 0; k < c.dots; k++) {
          const onLine = h.d % 2 === 0;
          el('circle', { cx: x + 10 + c.rightShift + k * 5, cy: onLine ? y - 2.5 : y, r: 1.6, class: 'dot' }, ng);
        }
        if (h.acc) {
          const ax = x - 13 - c.leftShift - (h.accCol || 0) * 9 - (h.acc.courtesy ? 3 : 0);
          accidentalGlyph(ng, h.acc.alter, ax, y, 'accidental' + (h.acc.courtesy ? ' courtesy' : ''));
          if (h.acc.courtesy) {
            txt(ng, ax - 9, y + 4, 'courtesy-paren', '(');
            txt(ng, ax + 5, y + 4, 'courtesy-paren', ')');
          }
        }
      }
      // hampe
      if (c.type !== 'whole') {
        const sx = stemXOf(c);
        const yFar = c.up ? yOf(c.heads[0].d, c.clef) : yOf(c.heads[c.heads.length - 1].d, c.clef);
        const tip = stemTip.get(c);
        el('line', { x1: sx, x2: sx, y1: yFar, y2: tip, class: 'stem' }, sg);
        const fc = flagCount(c.type);
        if (fc && !beamed.has(c)) {
          for (let i = 0; i < fc; i++) {
            const fy = tip + (c.up ? i * 7 : -i * 7);
            el('path', { d: c.up ? `M${sx} ${fy}c1 6 9 8 8 17` : `M${sx} ${fy}c1 -6 9 -8 8 -17`, class: 'flag' }, sg);
          }
        }
      }
      // articulations (premier morceau de la note seulement)
      const arts = new Set();
      for (const h of c.heads) if (h.first) for (const a of h.note.articulations || []) arts.add(a);
      if (arts.size) {
        const below = c.up;
        let ay = below ? yOf(c.heads[0].d, c.clef) + 11 : yOf(c.heads[c.heads.length - 1].d, c.clef) - 11;
        const stepY = below ? 7 : -7;
        for (const a of ['staccato', 'staccatissimo', 'tenuto', 'accent', 'marcato']) {
          if (!arts.has(a)) continue;
          if (a === 'staccato') el('circle', { cx: x, cy: ay, r: 1.8, class: 'articulation' }, sg);
          else if (a === 'staccatissimo') el('path', { d: `M${x} ${ay - 3}L${x - 1.5} ${ay + 3}L${x + 1.5} ${ay + 3}Z`, class: 'articulation' }, sg);
          else if (a === 'tenuto') el('line', { x1: x - 5, x2: x + 5, y1: ay, y2: ay, class: 'articulation-line' }, sg);
          else if (a === 'accent') el('path', { d: `M${x - 6} ${ay - 3}L${x + 6} ${ay}L${x - 6} ${ay + 3}`, class: 'articulation-line' }, sg);
          else el('path', { d: below ? `M${x - 4} ${ay - 3}L${x} ${ay + 4}L${x + 4} ${ay - 3}` : `M${x - 4} ${ay + 3}L${x} ${ay - 4}L${x + 4} ${ay + 3}`, class: 'articulation-line' }, sg);
          ay += stepY + (below ? 2 : -2);
        }
      }
      // doigtés (empilés : au-dessus pour la portée du haut, en dessous pour celle du bas)
      const fingered = c.heads.filter((h) => h.first && h.note.finger);
      let belowEnd = Math.max(bottom[c.clef] + 6, yOf(c.heads[0].d, c.clef) + 6, !c.up ? stemTip.get(c) + 2 : -Infinity);
      if (opts.showFingers && fingered.length) {
        if (c.clef === 'treble') {
          let fy = Math.min(top.treble - 6, yOf(c.heads[c.heads.length - 1].d, c.clef) - 10, c.up && c.type !== 'whole' ? stemTip.get(c) - 4 : Infinity);
          for (const h of [...fingered].reverse()) {
            txt(noteGroup(h.note), x, fy, 'fingering', h.note.finger);
            fy -= 11;
          }
        } else {
          let fy = belowEnd + 10;
          for (const h of fingered) {
            txt(noteGroup(h.note), x, fy, 'fingering', h.note.finger);
            fy += 11;
          }
          belowEnd = fy - 9;
        }
      }
      if (opts.showNoteNames) {
        let ny = belowEnd + 9;
        for (const h of [...c.heads].reverse()) {
          if (!h.first) continue;
          txt(noteGroup(h.note), x + h.shift * 0, ny, 'notename', noteLabel(h.note.midi, { ...settings, octave: false }, h.sp));
          ny += 9;
        }
      }
    }

    // barres de ligature
    for (const [grp, info] of beamInfo) {
      if (grp.some((c) => c.hidden)) continue;
      const bg = el('g', { class: `beam hand-${grp[0].hand}` + (opts.activeHands && opts.activeHands !== 'both' && opts.activeHands !== grp[0].hand ? ' inactive' : '') }, stemsG);
      const dir = info.up ? 1 : -1;
      const seg = (x1, x2, level) => {
        const o = level * 7 * dir;
        const y1 = info.yAt(x1) + o, y2 = info.yAt(x2) + o;
        el('path', { d: `M${x1} ${y1}L${x2} ${y2}L${x2} ${y2 + 4.5 * dir}L${x1} ${y1 + 4.5 * dir}Z`, class: 'beam-bar' }, bg);
      };
      seg(stemXOf(grp[0]), stemXOf(grp[grp.length - 1]), 0);
      for (let level = 1; level < 3; level++) {
        for (let i = 0; i < grp.length; i++) {
          if (flagCount(grp[i].type) <= level) continue;
          const sx = stemXOf(grp[i]);
          const nextOk = i + 1 < grp.length && flagCount(grp[i + 1].type) > level;
          const prevOk = i > 0 && flagCount(grp[i - 1].type) > level;
          if (nextOk) seg(sx, stemXOf(grp[i + 1]), level);
          else if (!prevOk) seg(i === grp.length - 1 ? sx - 8 : sx, i === grp.length - 1 ? sx : sx + 8, level);
        }
      }
    }

    // triolets
    for (const grp of tuplets) {
      if (grp.some((c) => c.hidden)) continue;
      const tg = el('g', { class: 'tuplet' }, stemsG);
      const allBeamed = beams.some((b) => grp.every((c) => b.includes(c)));
      const up = grp[0].up;
      const xA = xOf(grp[0].start) - 4, xB = xOf(grp[grp.length - 1].start) + 4;
      const xm = (xA + xB) / 2;
      if (allBeamed && grp[0].type !== 'whole') {
        const yb = stemTip.get(grp[Math.floor(grp.length / 2)]) ?? 0;
        txt(tg, xm + (up ? 3 : -3), up ? yb - 5 : yb + 14, 'tuplet-num', '3', { 'text-anchor': 'middle' });
      } else {
        let y = up ? Math.min(...grp.map((c) => stemTip.get(c) ?? yOf(c.heads[c.heads.length - 1].d, c.clef))) - 8 : Math.max(...grp.map((c) => stemTip.get(c) ?? yOf(c.heads[0].d, c.clef))) + 8;
        const h = up ? 4 : -4;
        el('path', { d: `M${xA} ${y + h}V${y}H${xm - 6}M${xm + 6} ${y}H${xB}V${y + h}`, class: 'tuplet-bracket' }, tg);
        txt(tg, xm, y + 4, 'tuplet-num', '3', { 'text-anchor': 'middle' });
      }
    }

    // liaisons de prolongation
    const curveG = el('g', { class: 'curves' }, this.svg);
    const chordOf = new Map();
    for (const c of chords) for (const h of c.heads) chordOf.set(h, c);
    const tie = (x1, x2, y, below, cls = 'tie') => {
      if (x2 - x1 < 4) return;
      const dy = below ? 1 : -1;
      const hgt = Math.min(9, 3 + (x2 - x1) * 0.08);
      el('path', { d: `M${x1} ${y + 3 * dy}C${x1 + (x2 - x1) * 0.25} ${y + (3 + hgt) * dy} ${x2 - (x2 - x1) * 0.25} ${y + (3 + hgt) * dy} ${x2} ${y + 3 * dy}C${x2 - (x2 - x1) * 0.25} ${y + (1.6 + hgt) * dy} ${x1 + (x2 - x1) * 0.25} ${y + (1.6 + hgt) * dy} ${x1} ${y + 3 * dy}Z`, class: cls }, curveG);
    };
    for (const [, list] of byNote) {
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        const c = chordOf.get(p);
        if (!c || p.hiddenM) continue;
        const y = yOf(p.d, p.clef);
        const below = c.multi ? !c.up : c.up ? true : false;
        const isOuter = p === c.heads[c.heads.length - 1] || p === c.heads[0];
        const tieBelow = c.heads.length > 1 && isOuter ? p === c.heads[0] : below;
        if (i === 0 && p.tieStop) tie(headerW - 2, xOf(p.start) - 7, y, tieBelow);
        if (p.tieStart) {
          const nxt = list[i + 1];
          const x2 = nxt ? xOf(nxt.start) - 7 + Math.min(0, nxt.shift || 0) : right - 2;
          tie(xOf(p.start) + 7 + (p.shift || 0) + (c.dots ? 5 : 0), x2, y, tieBelow);
        }
      }
    }
    // liaisons de phrasé (note.slur : 'start' | 'stop' | 'both')
    for (const hand of ['R', 'L']) {
      const hn = song.notes.filter((n) => n.hand === hand && n.slur);
      const open = [];
      for (const n of hn) {
        const kinds = n.slur === 'both' ? ['stop', 'start'] : [n.slur];
        for (const kd of kinds) {
          if (kd === 'start') open.push(n);
          else if (kd === 'stop' && open.length) {
            const a = open.pop();
            const pa = byNote.get(a.id)?.[0], pb = byNote.get(n.id)?.[0];
            if (!pa && !pb) continue;
            const clef = (pa || pb).clef;
            const above = hand === 'R';
            const ya = pa ? yOf(pa.d, pa.clef) : yOf(pb.d, pb.clef);
            const yb = pb ? yOf(pb.d, pb.clef) : ya;
            const ext = (p) => { const c = chordOf.get(p); return c && c.up === !above ? stemTip.get(c) : null; };
            let y1 = ya + (above ? -9 : 9), y2 = yb + (above ? -9 : 9);
            const ea = pa && ext(pa), eb = pb && ext(pb);
            if (ea != null) y1 = above ? Math.min(y1, ea - 4) : Math.max(y1, ea + 4);
            if (eb != null) y2 = above ? Math.min(y2, eb - 4) : Math.max(y2, eb + 4);
            const x1 = pa ? xOf(pa.start) : headerW;
            const x2 = pb ? xOf(pb.start) : right - 4;
            if (x2 - x1 < 6) continue;
            const dir = above ? -1 : 1;
            const hgt = Math.min(18, 6 + (x2 - x1) * 0.06);
            // éviter les notes intermédiaires
            let extreme = above ? Math.min(y1, y2) : Math.max(y1, y2);
            for (const p of pieces) {
              if (p.note.hand !== hand || p.start <= (pa ? pa.start : from) || p.start >= (pb ? pb.start : to) || p.clef !== clef) continue;
              const yy = yOf(p.d, p.clef) + dir * 8;
              extreme = above ? Math.min(extreme, yy) : Math.max(extreme, yy);
            }
            const cy = extreme + dir * hgt;
            el('path', { d: `M${x1} ${y1}C${x1 + (x2 - x1) * 0.2} ${cy} ${x2 - (x2 - x1) * 0.2} ${cy} ${x2} ${y2}C${x2 - (x2 - x1) * 0.2} ${cy - dir * 2} ${x1 + (x2 - x1) * 0.2} ${cy - dir * 2} ${x1} ${y1}Z`, class: 'slur' }, curveG);
          }
        }
      }
    }

    this.cursor = el('line', { x1: 0, x2: 0, y1: TT - 14, y2: BB + 14, class: 'cursor' }, this.svg);
    this.setCursor(from);
  }

  /** Le conteneur défile-t-il horizontalement (on peut alors élargir la portée) ? */
  canScroll() {
    try {
      const ox = getComputedStyle(this.container).overflowX;
      return ox === 'auto' || ox === 'scroll';
    } catch {
      return false;
    }
  }

  setCursor(beat) {
    if (!this.cursor || !this.cursorX) return;
    const x = this.cursorX(beat);
    this.cursor.setAttribute('x1', x);
    this.cursor.setAttribute('x2', x);
  }

  mark(id, cls) {
    const e = this.noteEls.get(id);
    if (!e) return;
    e.classList.remove('hit', 'miss', 'current');
    if (cls) e.classList.add(cls);
  }

  clearMarks(cls = 'current') {
    for (const e of this.noteEls.values()) e.classList.remove(cls);
  }
}

/** Nombre de mesures par « page » selon la largeur. */
export function measuresPerPage(width, beatsPerMeasure) {
  const pxPerBeat = 70;
  return Math.max(1, Math.min(6, Math.floor((width - LEFT - 30) / (pxPerBeat * beatsPerMeasure))));
}

export { keySignatureAlters };
