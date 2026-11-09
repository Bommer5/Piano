// Clavier de piano interactif (DOM) + mise en page partagée avec la vue « notes qui tombent ».
import { isBlack, PIANO_MIN, PIANO_MAX } from '../core/notes.js';

/** Positions des touches, en unités de « largeur de touche blanche ». */
export function keyboardLayout(lo, hi) {
  lo = Math.max(PIANO_MIN, lo);
  hi = Math.min(PIANO_MAX, hi);
  while (isBlack(lo) && lo > PIANO_MIN) lo--;
  while (isBlack(hi) && hi < PIANO_MAX) hi++;
  const keys = [];
  let white = 0;
  // décalages réalistes des touches noires
  const offs = { 1: -0.62, 3: -0.38, 6: -0.65, 8: -0.5, 10: -0.35 };
  for (let m = lo; m <= hi; m++) {
    if (isBlack(m)) keys.push({ midi: m, black: true, x: white + offs[m % 12], w: 0.58 });
    else keys.push({ midi: m, black: false, x: white++, w: 1 });
  }
  return { lo, hi, keys, whiteCount: white, byMidi: new Map(keys.map((k) => [k.midi, k])) };
}

/** Plage de clavier adaptée à un morceau (au moins 2 octaves, marges). */
export function rangeForSong(song, minSpan = 25) {
  let lo = song.range.lo - 2, hi = song.range.hi + 2;
  if (hi - lo < minSpan) {
    const mid = Math.round((lo + hi) / 2);
    lo = mid - Math.ceil(minSpan / 2);
    hi = mid + Math.ceil(minSpan / 2);
  }
  // commencer sur un Do ou un Fa, c'est plus lisible
  while (lo % 12 !== 0 && lo % 12 !== 5) lo--;
  return { lo: Math.max(PIANO_MIN, lo), hi: Math.min(PIANO_MAX, hi) };
}

export class PianoKeyboard {
  /**
   * @param {HTMLElement} el
   * @param {{onNoteOn?:(midi:number)=>void, onNoteOff?:(midi:number)=>void, label?:(midi:number)=>string|null}} opts
   */
  constructor(el, opts = {}) {
    this.el = el;
    this.opts = opts;
    this.el.classList.add('piano');
    this.el.setAttribute('role', 'group');
    this.el.setAttribute('aria-label', 'Clavier de piano');
    this.keyEls = new Map();
    this.pointerNotes = new Map();
    this.setRange(48, 84);
    this._bindPointer();
  }

  setRange(lo, hi) {
    this.layout = keyboardLayout(lo, hi);
    this.render();
  }

  render() {
    const { keys, whiteCount } = this.layout;
    this.el.innerHTML = '';
    this.keyEls.clear();
    for (const k of keys) {
      const d = document.createElement('div');
      d.className = 'key ' + (k.black ? 'black' : 'white');
      d.dataset.midi = k.midi;
      d.style.left = (k.x / whiteCount) * 100 + '%';
      d.style.width = (k.w / whiteCount) * 100 + '%';
      if (k.midi === 60) d.classList.add('middle-c');
      const lab = document.createElement('span');
      lab.className = 'label';
      d.appendChild(lab);
      const fing = document.createElement('span');
      fing.className = 'finger';
      d.appendChild(fing);
      this.el.appendChild(d);
      this.keyEls.set(k.midi, d);
    }
    this.refreshLabels();
  }

  refreshLabels() {
    for (const [m, d] of this.keyEls) {
      const l = this.opts.label ? this.opts.label(m) : null;
      d.querySelector('.label').textContent = l || '';
    }
  }

  /** x (0..1) et largeur (0..1) d'une touche, pour aligner d'autres vues. */
  geometry(midi) {
    const k = this.layout.byMidi.get(midi);
    if (!k) return null;
    return { x: k.x / this.layout.whiteCount, w: k.w / this.layout.whiteCount, black: k.black };
  }

  /** Marque des touches. states: Map/obj midi -> {cls:'expect-R'|'expect-L'|..., finger?} */
  setMarks(marks) {
    for (const [m, d] of this.keyEls) {
      const mk = marks.get ? marks.get(m) : marks[m];
      d.classList.remove('expect-R', 'expect-L', 'expect-next');
      d.querySelector('.finger').textContent = '';
      if (mk) {
        d.classList.add(mk.cls);
        if (mk.finger) d.querySelector('.finger').textContent = mk.finger;
      }
    }
  }

  press(midi, cls = 'pressed') {
    const d = this.keyEls.get(midi);
    if (d) d.classList.add(cls);
  }

  release(midi) {
    const d = this.keyEls.get(midi);
    if (d) d.classList.remove('pressed');
  }

  flash(midi, cls) {
    const d = this.keyEls.get(midi);
    if (!d) return;
    d.classList.remove('hit', 'miss');
    void d.offsetWidth; // relance l'animation
    d.classList.add(cls);
    setTimeout(() => d.classList.remove(cls), 450);
  }

  _bindPointer() {
    const noteAt = (e) => {
      const t = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.key');
      return t && this.el.contains(t) ? Number(t.dataset.midi) : null;
    };
    this.el.addEventListener('pointerdown', (e) => {
      const m = noteAt(e);
      if (m == null) return;
      e.preventDefault();
      this.el.setPointerCapture?.(e.pointerId);
      this.pointerNotes.set(e.pointerId, m);
      this.press(m);
      this.opts.onNoteOn?.(m);
    });
    this.el.addEventListener('pointermove', (e) => {
      if (!this.pointerNotes.has(e.pointerId)) return;
      const m = noteAt(e);
      const prev = this.pointerNotes.get(e.pointerId);
      if (m != null && m !== prev) {
        this.release(prev);
        this.opts.onNoteOff?.(prev);
        this.pointerNotes.set(e.pointerId, m);
        this.press(m);
        this.opts.onNoteOn?.(m);
      }
    });
    const up = (e) => {
      const m = this.pointerNotes.get(e.pointerId);
      if (m == null) return;
      this.pointerNotes.delete(e.pointerId);
      this.release(m);
      this.opts.onNoteOff?.(m);
    };
    this.el.addEventListener('pointerup', up);
    this.el.addEventListener('pointercancel', up);
    // Appui long sur mobile : pas de menu contextuel, pas de sélection, pas de glisser-déposer
    for (const ev of ['contextmenu', 'selectstart', 'dragstart']) this.el.addEventListener(ev, (e) => e.preventDefault());
  }
}

/** Petit schéma de clavier statique (cours) : notes surlignées avec numéros de doigts. */
export function keyDiagram(notes, { lo, hi, labels } = {}) {
  const midis = notes.map((n) => n.midi);
  const r = { lo: lo ?? Math.min(...midis) - 2, hi: hi ?? Math.max(...midis) + 2 };
  while ((r.hi - r.lo) < 12) { r.lo--; r.hi++; }
  while (r.lo % 12 !== 0 && r.lo % 12 !== 5) r.lo--;
  const lay = keyboardLayout(r.lo, r.hi);
  const wrap = document.createElement('div');
  wrap.className = 'piano mini';
  const byMidi = new Map(notes.map((n) => [n.midi, n]));
  for (const k of lay.keys) {
    const d = document.createElement('div');
    d.className = 'key ' + (k.black ? 'black' : 'white');
    d.style.left = (k.x / lay.whiteCount) * 100 + '%';
    d.style.width = (k.w / lay.whiteCount) * 100 + '%';
    const n = byMidi.get(k.midi);
    if (n) {
      d.classList.add(n.hand === 'L' ? 'expect-L' : 'expect-R');
      const f = document.createElement('span');
      f.className = 'finger';
      f.textContent = n.finger || '';
      d.appendChild(f);
    }
    if (labels) {
      const l = document.createElement('span');
      l.className = 'label';
      l.textContent = labels(k.midi) || '';
      d.appendChild(l);
    }
    wrap.appendChild(d);
  }
  return wrap;
}
