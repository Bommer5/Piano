// Éditeur léger de morceau : portée cliquable + liste de notes éditable, barre d'outils
// (main, doigt, hauteur, durée, décalage, ajout, suppression, transposition, point de partage,
// re-quantification), annuler/rétablir. La logique est dans js/core/edit.js.
import * as E from '../core/edit.js';
import { beatsPerMeasure as bpmOf } from '../core/song.js';
import { noteLabel, FINGER_NAMES } from '../core/notes.js';
import { autoFingering } from '../core/fingering.js';
import { StaffView } from './staff.js';
import { h, toast } from './dom.js';
import * as synth from '../audio/synth.js';

export const DURATIONS = [
  [0.25, 'double croche'], [1 / 3, 'croche de triolet'], [0.5, 'croche'], [0.75, 'croche pointée'], [1, 'noire'],
  [1.5, 'noire pointée'], [2, 'blanche'], [3, 'blanche pointée'], [4, 'ronde'],
];

export function durationName(d) {
  const f = DURATIONS.find(([v]) => Math.abs(v - d) < 1e-3);
  return f ? f[1] : `${Math.round(d * 100) / 100} temps`;
}

export class SongEditor {
  /**
   * @param {HTMLElement} root
   * @param {object} song morceau préparé (prepareSong)
   * @param {{settings?:object, onChange?:(notes)=>void}} opts
   */
  constructor(root, song, opts = {}) {
    this.root = root;
    this.song = song;
    this.opts = opts;
    this.settings = opts.settings || {};
    this.history = new E.EditHistory(song.notes.map((n) => ({ ...n })));
    this.selection = new Set();
    this.bpm = song.beatsPerMeasure || bpmOf(song.timeSig);
    this.page = 0;
    this.perPage = 2;
    this.splitPoint = 60;
    this.build();
    this.render();
  }

  get notes() {
    return this.history.current;
  }

  get measureCount() {
    const end = this.notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0);
    return Math.max(1, Math.ceil(end / this.bpm - 1e-6));
  }

  /** Applique une opération pure à l'état courant. */
  apply(fn, { keepSelection = true } = {}) {
    const next = fn(this.notes);
    if (next === this.notes) return;
    this.history.push(next);
    if (!keepSelection) this.selection.clear();
    const ids = new Set(next.map((n) => n.id));
    for (const id of [...this.selection]) if (!ids.has(id)) this.selection.delete(id);
    this.render();
    this.opts.onChange?.(next);
  }

  undo() {
    this.history.undo();
    this.render();
    this.opts.onChange?.(this.notes);
  }

  redo() {
    this.history.redo();
    this.render();
    this.opts.onChange?.(this.notes);
  }

  selected() {
    return this.notes.filter((n) => this.selection.has(n.id));
  }

  select(id, additive = false) {
    if (!additive) this.selection.clear();
    if (additive && this.selection.has(id)) this.selection.delete(id);
    else this.selection.add(id);
    const n = this.notes.find((x) => x.id === id);
    if (n && this.selection.has(id)) synth.playNote(n.midi, { dur: 0.4, instrument: this.settings.instrument });
    this.render();
  }

  requireSel() {
    if (!this.selection.size) {
      toast('Sélectionne d’abord une note (clic sur la portée ou dans la liste).');
      return false;
    }
    return true;
  }

  build() {
    const b = (label, title, fn, cls = '') => h('button', { class: 'btn tiny ' + cls, title, 'aria-label': title, onclick: fn }, label);
    const sel = () => [...this.selection];
    this.undoBtn = b('↶ Annuler', 'Annuler (Ctrl+Z)', () => this.undo());
    this.redoBtn = b('↷ Rétablir', 'Rétablir (Ctrl+Y)', () => this.redo());
    this.durSel = h('select', { 'aria-label': 'Durée de la sélection', onchange: () => {
      if (this.durSel.value && this.requireSel()) this.apply((ns) => E.setDuration(ns, sel(), Number(this.durSel.value)));
    } }, [h('option', { value: '' }, 'Durée…'), ...DURATIONS.map(([v, l]) => h('option', { value: v }, l))]);
    this.splitIn = h('input', { type: 'number', min: 36, max: 84, value: this.splitPoint, class: 'num', 'aria-label': 'Point de partage des mains (numéro MIDI)', onchange: () => { this.splitPoint = Number(this.splitIn.value) || 60; this.splitName.textContent = noteLabel(this.splitPoint, this.settings); } });
    this.splitName = h('span', { class: 'small muted' }, noteLabel(this.splitPoint, this.settings));
    this.gridSel = h('select', { 'aria-label': 'Grille de quantification' }, E.GRIDS.map((g) => h('option', { value: g.id, selected: g.id === 'double' }, g.label)));
    this.swingChk = h('input', { type: 'checkbox', checked: true });
    this.info = h('p', { class: 'small editor-info', 'aria-live': 'polite' });
    this.staffBox = h('div', { class: 'staff-box editor-staff' });
    this.pageLabel = h('span', { class: 'small' });
    this.list = h('div', { class: 'note-list', role: 'listbox', 'aria-multiselectable': 'true', 'aria-label': 'Notes de la page' });

    const fingers = [1, 2, 3, 4, 5].map((f) => b(String(f), `Doigt ${f} (${FINGER_NAMES[f]})`, () => this.requireSel() && this.apply((ns) => E.setFinger(ns, sel(), f))));
    this.root.append(
      h('div', { class: 'editor-toolbar card' }, [
        h('div', { class: 'row wrap' }, [this.undoBtn, this.redoBtn,
          b('Tout (page)', 'Sélectionner toutes les notes de la page', () => { this.pageNotes().forEach((n) => this.selection.add(n.id)); this.render(); }),
          b('Aucune', 'Désélectionner', () => { this.selection.clear(); this.render(); }),
        ]),
        h('div', { class: 'row wrap' }, [h('span', { class: 'small muted' }, 'Main'),
          b('✋ Droite', 'Main droite', () => this.requireSel() && this.apply((ns) => E.setHand(ns, sel(), 'R'))),
          b('🤚 Gauche', 'Main gauche', () => this.requireSel() && this.apply((ns) => E.setHand(ns, sel(), 'L'))),
          h('span', { class: 'small muted' }, 'Doigt'), ...fingers,
          b('auto', 'Doigté automatique pour la sélection', () => this.requireSel() && this.autoFinger()),
        ]),
        h('div', { class: 'row wrap' }, [h('span', { class: 'small muted' }, 'Hauteur'),
          b('↑', 'Monter d’un demi-ton (flèche haut)', () => this.requireSel() && this.apply((ns) => E.shiftPitch(ns, sel(), 1))),
          b('↓', 'Descendre d’un demi-ton (flèche bas)', () => this.requireSel() && this.apply((ns) => E.shiftPitch(ns, sel(), -1))),
          b('+8ve', 'Monter d’une octave', () => this.requireSel() && this.apply((ns) => E.shiftPitch(ns, sel(), 12))),
          b('−8ve', 'Descendre d’une octave', () => this.requireSel() && this.apply((ns) => E.shiftPitch(ns, sel(), -12))),
          this.durSel,
          b('←', 'Avancer d’une double croche', () => this.requireSel() && this.apply((ns) => E.moveTime(ns, sel(), -0.25))),
          b('→', 'Retarder d’une double croche', () => this.requireSel() && this.apply((ns) => E.moveTime(ns, sel(), 0.25))),
          b('➕ Note', 'Ajouter une note après la sélection', () => this.addAfter()),
          b('🗑', 'Supprimer la sélection (Suppr)', () => this.requireSel() && this.apply((ns) => E.deleteNotes(ns, sel()), { keepSelection: false }), 'danger'),
        ]),
        h('div', { class: 'row wrap' }, [
          h('label', { class: 'field' }, ['Partage des mains ', this.splitIn, ' ', this.splitName]),
          b('Suggérer', 'Point de partage conseillé', () => { this.splitPoint = E.suggestSplitPoint(this.notes); this.splitIn.value = this.splitPoint; this.splitName.textContent = noteLabel(this.splitPoint, this.settings); }),
          b('Appliquer', 'Répartir les mains (la sélection, ou tout le morceau si rien n’est sélectionné)', () => this.apply((ns) => E.splitHands(ns, this.splitPoint, this.selection.size ? sel() : null))),
        ]),
        h('div', { class: 'row wrap' }, [
          h('label', { class: 'field' }, ['Re-quantifier ', this.gridSel]),
          h('label', { class: 'check' }, [this.swingChk, 'détecter le swing']),
          b('Quantifier', 'Aligner les notes sur la grille rythmique (la sélection, ou tout le morceau)', () => this.requantize()),
        ]),
        this.info,
      ]),
      h('div', { class: 'row editor-nav' }, [
        b('◀', 'Mesures précédentes', () => { this.page = Math.max(0, this.page - 1); this.render(); }),
        this.pageLabel,
        b('▶', 'Mesures suivantes', () => { this.page = Math.min(this.pageCount() - 1, this.page + 1); this.render(); }),
      ]),
      this.staffBox,
      this.list,
    );
    this.keyHandler = (e) => this.onKey(e);
    window.addEventListener('keydown', this.keyHandler, true);
  }

  destroy() {
    window.removeEventListener('keydown', this.keyHandler, true);
  }

  onKey(e) {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    const mod = e.ctrlKey || e.metaKey;
    const sel = [...this.selection];
    let handled = true;
    if (mod && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) this.undo();
    else if (mod && (e.key === 'y' || ((e.key === 'z' || e.key === 'Z') && e.shiftKey))) this.redo();
    else if (!sel.length) handled = false;
    else if (e.key === 'ArrowUp') this.apply((ns) => E.shiftPitch(ns, sel, e.shiftKey ? 12 : 1));
    else if (e.key === 'ArrowDown') this.apply((ns) => E.shiftPitch(ns, sel, e.shiftKey ? -12 : -1));
    else if (e.key === 'Delete' || e.key === 'Backspace') this.apply((ns) => E.deleteNotes(ns, sel), { keepSelection: false });
    else if (/^[1-5]$/.test(e.key) && !mod) this.apply((ns) => E.setFinger(ns, sel, Number(e.key)));
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  autoFinger() {
    this.apply((ns) => {
      const copy = ns.map((n) => ({ ...n }));
      for (const hand of ['R', 'L']) {
        const group = copy.filter((n) => n.hand === hand && this.selection.has(n.id));
        group.forEach((n) => (n.finger = null));
        if (group.length) autoFingering(group, hand);
      }
      return copy;
    });
  }

  addAfter() {
    const s = this.selected().sort((a, b) => a.start - b.start);
    const last = s[s.length - 1];
    const start = last ? last.start + last.dur : this.page * this.perPage * this.bpm;
    const midi = last ? last.midi : 60;
    let added = null;
    this.apply((ns) => {
      const r = E.addNote(ns, { midi, start, dur: last ? last.dur : 1, hand: last?.hand, splitPoint: this.splitPoint });
      added = r.note;
      return r.notes;
    });
    if (added) {
      this.selection = new Set([added.id]);
      this.page = Math.floor(added.start / (this.perPage * this.bpm));
      this.render();
    }
  }

  requantize() {
    const g = E.GRIDS.find((x) => x.id === this.gridSel.value) || E.GRIDS[2];
    let swing = false;
    this.apply((ns) => {
      const target = this.selection.size ? ns.filter((n) => this.selection.has(n.id)) : ns;
      const rest = this.selection.size ? ns.filter((n) => !this.selection.has(n.id)) : [];
      const r = E.quantize(target, { grid: g.value, swing: this.swingChk.checked ? 'auto' : false });
      swing = r.swing;
      return [...rest, ...r.notes].sort((a, b) => a.start - b.start || a.midi - b.midi);
    });
    if (swing) this.song.swing = true;
    toast(swing ? 'Swing détecté : les croches « swing » sont écrites comme des croches droites.' : 'Rythme re-quantifié.');
  }

  pageCount() {
    return Math.max(1, Math.ceil(this.measureCount / this.perPage));
  }

  pageNotes() {
    const from = this.page * this.perPage * this.bpm, to = from + this.perPage * this.bpm;
    return this.notes.filter((n) => n.start >= from - 1e-6 && n.start < to - 1e-6);
  }

  render() {
    const width = this.root.clientWidth || 800;
    this.perPage = width < 520 ? 1 : width < 900 ? 2 : 4;
    this.page = Math.min(this.page, this.pageCount() - 1);
    const from = this.page * this.perPage * this.bpm, to = from + this.perPage * this.bpm;
    const first = this.page * this.perPage + 1;
    this.pageLabel.textContent = `Mesures ${first}–${Math.min(this.measureCount, first + this.perPage - 1)} / ${this.measureCount}`;
    this.undoBtn.disabled = !this.history.canUndo;
    this.redoBtn.disabled = !this.history.canRedo;
    // portée
    this.staffBox.innerHTML = '';
    const sv = new StaffView(this.staffBox);
    const view = { ...this.song, notes: this.notes, beatsPerMeasure: this.bpm };
    // la portée gère les clics si elle connaît `onNoteClick` ; sinon on s'accroche à noteEls
    let viaOpt = false;
    const onNoteClick = (n, e) => { viaOpt = true; e?.stopPropagation?.(); this.select(n.id, !!(e && (e.shiftKey || e.ctrlKey || e.metaKey))); };
    sv.render(view, from, to, { settings: this.settings, showFingers: true, showNoteNames: true, onNoteClick });
    const native = sv.svg.classList.contains('clickable-notes');
    for (const [id, g] of sv.noteEls) {
      g.classList.add('editable');
      if (this.selection.has(id)) g.classList.add('selected');
      if (native) continue;
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'button');
      g.addEventListener('click', (e) => { if (viaOpt) return; e.stopPropagation(); this.select(id, e.shiftKey || e.ctrlKey || e.metaKey); });
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.select(id, e.shiftKey); } });
    }
    // liste
    this.list.innerHTML = '';
    const ns = this.pageNotes();
    if (!ns.length) this.list.append(h('p', { class: 'muted small' }, 'Aucune note dans ces mesures. « ➕ Note » pour en ajouter.'));
    for (const n of ns) {
      const m = Math.floor(n.start / this.bpm + 1e-6);
      const beat = Math.round((n.start - m * this.bpm + 1) * 100) / 100;
      const on = this.selection.has(n.id);
      this.list.append(h('button', {
        class: `note-row hand-${n.hand}` + (on ? ' selected' : ''), role: 'option', 'aria-selected': on ? 'true' : 'false',
        onclick: (e) => this.select(n.id, e.shiftKey || e.ctrlKey || e.metaKey || e.pointerType === 'touch'),
      }, [
        h('b', {}, noteLabel(n.midi, this.settings)),
        h('span', {}, `m.${m + 1} t.${beat}`),
        h('span', {}, durationName(n.dur)),
        h('span', {}, n.hand === 'L' ? 'MG' : 'MD'),
        h('span', {}, n.finger ? `doigt ${n.finger}` : 'doigt ?'),
      ]));
    }
    const s = this.selected();
    this.info.textContent = s.length
      ? `${s.length} note${s.length > 1 ? 's' : ''} sélectionnée${s.length > 1 ? 's' : ''}${s.length === 1 ? ` : ${noteLabel(s[0].midi, this.settings)}, ${durationName(s[0].dur)}, ${s[0].hand === 'L' ? 'main gauche' : 'main droite'}, doigt ${s[0].finger || '?'}` : ''} · flèches ↑↓ = hauteur, 1–5 = doigt, Suppr = effacer`
      : `${this.notes.length} notes · clique une note (Maj+clic pour en sélectionner plusieurs)`;
  }
}
