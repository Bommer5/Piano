// Portée (grand-portée clé de sol + clé de fa) en SVG, notation proportionnelle au temps.
import { spell, noteLabel } from '../core/notes.js';

const NS = 'http://www.w3.org/2000/svg';
const GAP = 10; // écart entre lignes
const TREBLE_BOTTOM = 70; // y de la ligne du Mi4
const BASS_BOTTOM = 160; // y de la ligne du Sol2
const LEFT = 64;

function el(name, attrs = {}, parent) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

/** y d'une position diatonique sur la portée de la main donnée. */
export function staffY(diatonic, clef) {
  return clef === 'bass' ? BASS_BOTTOM - (diatonic - 18) * (GAP / 2) : TREBLE_BOTTOM - (diatonic - 30) * (GAP / 2);
}

function ledgerLines(d, clef) {
  const res = [];
  const [low, high] = clef === 'bass' ? [18, 26] : [30, 38];
  for (let x = low - 2; x >= d; x -= 2) res.push(x);
  for (let x = high + 2; x <= d; x += 2) res.push(x);
  return res;
}

export class StaffView {
  constructor(container) {
    this.container = container;
    this.svg = el('svg', { class: 'staff', preserveAspectRatio: 'xMinYMin meet' });
    container.appendChild(this.svg);
    this.page = null;
    this.noteEls = new Map();
  }

  /**
   * @param {object} song
   * @param {number} from début (temps)
   * @param {number} to fin (temps)
   * @param {object} opts {settings, flats, activeHands}
   */
  render(song, from, to, opts = {}) {
    const width = Math.max(320, this.container.clientWidth || 800);
    const height = 205;
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    this.svg.setAttribute('width', width);
    this.svg.setAttribute('height', height);
    this.svg.innerHTML = '';
    this.noteEls.clear();
    this.page = { from, to };
    const pxPerBeat = (width - LEFT - 16) / (to - from);
    this.xOf = (b) => LEFT + (b - from) * pxPerBeat + 8;

    const g = el('g', {}, this.svg);
    // lignes
    for (const bottom of [TREBLE_BOTTOM, BASS_BOTTOM]) {
      for (let i = 0; i < 5; i++) el('line', { x1: 8, x2: width - 8, y1: bottom - i * GAP, y2: bottom - i * GAP, class: 'staff-line' }, g);
    }
    el('line', { x1: 8, x2: 8, y1: TREBLE_BOTTOM - 4 * GAP, y2: BASS_BOTTOM, class: 'bar-line' }, g);
    const t1 = el('text', { x: 12, y: TREBLE_BOTTOM + 4, class: 'clef' }, g);
    t1.textContent = '𝄞';
    const t2 = el('text', { x: 12, y: BASS_BOTTOM - 13, class: 'clef bass' }, g);
    t2.textContent = '𝄢';
    if (from === 0) {
      for (const bottom of [TREBLE_BOTTOM, BASS_BOTTOM]) {
        const a = el('text', { x: 46, y: bottom - 2 * GAP - 2, class: 'timesig' }, g);
        a.textContent = song.timeSig[0];
        const b = el('text', { x: 46, y: bottom + 1, class: 'timesig' }, g);
        b.textContent = song.timeSig[1];
      }
    }
    // barres de mesure
    const bpm = song.beatsPerMeasure;
    for (let b = Math.ceil(from / bpm - 1e-6) * bpm; b <= to + 1e-6; b += bpm) {
      const x = this.xOf(b) - 8;
      if (b > from + 1e-6) el('line', { x1: x, x2: x, y1: TREBLE_BOTTOM - 4 * GAP, y2: BASS_BOTTOM, class: 'bar-line' }, g);
      const num = el('text', { x: x + 3, y: TREBLE_BOTTOM - 4 * GAP - 6, class: 'measure-num' }, g);
      num.textContent = Math.round(b / bpm) + 1;
    }

    const flats = song.keyFifths < 0;
    const notesG = el('g', {}, this.svg);
    for (const n of song.notes) {
      if (n.start < from - 1e-6 || n.start >= to - 1e-6) continue;
      const clef = n.hand === 'L' ? 'bass' : 'treble';
      const sp = spell(n.midi, flats);
      const y = staffY(sp.diatonic, clef);
      const x = this.xOf(n.start);
      const ng = el('g', { class: `note hand-${n.hand}` + (opts.activeHands && opts.activeHands !== 'both' && opts.activeHands !== n.hand ? ' inactive' : '') }, notesG);
      for (const ld of ledgerLines(sp.diatonic, clef)) {
        const ly = staffY(ld, clef);
        el('line', { x1: x - 9, x2: x + 9, y1: ly, y2: ly, class: 'staff-line ledger' }, ng);
      }
      // durée : barre fine proportionnelle (lecture du rythme)
      el('rect', { x: x, y: y - 1.5, width: Math.max(0, n.dur * pxPerBeat - 6), height: 3, rx: 1.5, class: 'dur-bar' }, ng);
      const hollow = n.dur >= 2 - 1e-6;
      el('ellipse', { cx: x, cy: y, rx: 6, ry: 4.3, transform: `rotate(-20 ${x} ${y})`, class: 'head' + (hollow ? ' hollow' : '') }, ng);
      const dotted = [0.75, 1.5, 3, 6].some((d) => Math.abs(n.dur - d) < 1e-6);
      if (dotted) el('circle', { cx: x + 10, cy: y - 2, r: 1.6, class: 'dot' }, ng);
      if (n.dur < 4 - 1e-6) {
        const mid = clef === 'bass' ? 22 : 34;
        const up = sp.diatonic < mid;
        const sx = up ? x + 5.6 : x - 5.6;
        const sy2 = up ? y - 30 : y + 30;
        el('line', { x1: sx, x2: sx, y1: y, y2: sy2, class: 'stem' }, ng);
        const flags = n.dur <= 0.25 + 1e-6 ? 2 : n.dur <= 0.5 + 1e-6 ? 1 : 0;
        for (let i = 0; i < flags; i++) {
          const fy = sy2 + (up ? i * 7 : -i * 7);
          el('path', { d: up ? `M${sx} ${fy} q 4 8 9 12` : `M${sx} ${fy} q 4 -8 9 -12`, class: 'flag' }, ng);
        }
      }
      if (sp.alter) {
        const t = el('text', { x: x - 17, y: y + 4, class: 'accidental' }, ng);
        t.textContent = sp.alter > 0 ? '♯' : '♭';
      }
      if (opts.showFingers && n.finger) {
        const t = el('text', { x: x, y: n.hand === 'L' ? BASS_BOTTOM + 28 : TREBLE_BOTTOM - 4 * GAP - 18, class: 'fingering' }, ng);
        t.textContent = n.finger;
      }
      if (opts.showNoteNames) {
        const t = el('text', { x: x, y: n.hand === 'L' ? BASS_BOTTOM + 40 : TREBLE_BOTTOM + 26, class: 'notename' }, ng);
        t.textContent = noteLabel(n.midi, { ...opts.settings, octave: false });
      }
      const title = el('title', {}, ng);
      title.textContent = `${noteLabel(n.midi, opts.settings || {})} – doigt ${n.finger || '?'} (${n.hand === 'L' ? 'main gauche' : 'main droite'})`;
      this.noteEls.set(n.id, ng);
    }
    this.cursor = el('line', { x1: 0, x2: 0, y1: TREBLE_BOTTOM - 4 * GAP - 14, y2: BASS_BOTTOM + 14, class: 'cursor' }, this.svg);
  }

  setCursor(beat) {
    if (!this.cursor || !this.xOf) return;
    const x = this.xOf(beat) - 8;
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
  return Math.max(1, Math.min(6, Math.floor((width - LEFT) / (pxPerBeat * beatsPerMeasure))));
}
