// Écran d'entraînement : portée + notes qui tombent + clavier, écoute micro / MIDI / clavier / souris.
// Modes : Attente, Tempo, Écoute, Imiter, Concert, Par cœur. Enregistre une prise à chaque séance
// (réécoute, comparaison avec la partition, export .mid, rapport détaillé, revue des erreurs).
import { PracticeEngine } from '../core/practice.js';
import { measureOf, transposeSong } from '../core/song.js';
import { matchChord } from '../core/spectrum.js';
import { noteLabel, FINGER_NAMES, pitchClass } from '../core/notes.js';
import { createTake, takeNoteOn, takeNoteOff, takePedal, addAnchor, closeTake, judgeOf, takeOverlay, takeBeatAt, takeTimeAt, takeToSong, saveTake, analyzeTake } from '../core/take.js';
import { ScoreFollower } from '../core/follower.js';
import { makeRhythmVariant, createRepeatChallenge } from '../core/coursegen.js';
import * as synth from '../audio/synth.js';
import { mic } from '../audio/mic.js';
import { midiInput, computerKeyboard, KEY_CODES } from '../audio/midi-input.js';
import { PianoKeyboard, rangeForSong } from './keyboard.js';
import { NoteRoll } from './roll.js';
import { StaffView, measuresPerPage } from './staff.js';
import { store } from '../core/storage.js';
import * as dom from './dom.js';
import { showReport, showErrorReview, confetti } from './report.js';
import { exportMidi } from '../parsers/midi.js';

const { h, toast, modal, escapeHtml, download } = dom;

const MODES = [
  ['wait', 'Attente', 'La partition attend la bonne note (W)'],
  ['tempo', 'Tempo', 'La partition défile en rythme (P)'],
  ['listen', 'Écoute', "L'app joue le morceau pour toi (L)"],
  ['imitate', 'Imiter', "L'app joue une mesure, puis tu la répètes"],
  ['memory', 'Par cœur', 'Les mesures disparaissent peu à peu à chaque passage réussi'],
  ['concert', 'Concert', 'Plein écran, partition seule qui suit ton jeu, sans jugement'],
];
const WAIT_LIKE = new Set(['wait', 'imitate', 'memory']);
const METRO_MODES = [['all', 'Tous les temps'], ['24', 'Temps 2 et 4'], ['1', '1er temps']];
// Mode enfant : une couleur fixe par note (Do rouge … Si violet) ; les touches noires prennent la couleur de la note du dessous.
export const KID_COLORS = { 0: '#e53935', 2: '#fb8c00', 4: '#fdd835', 5: '#43a047', 7: '#1e88e5', 9: '#3949ab', 11: '#8e24aa' };
export const kidColor = (m) => KID_COLORS[pitchClass(m)] ?? KID_COLORS[pitchClass(m) - 1];
const KID_OOPS = ['Presque ! Essaie encore 🙂', 'Oups ! Cherche la touche qui brille ✨', 'Pas grave, on réessaie 💪', 'Tu y es presque 🌟', 'Regarde bien la couleur 🎨', 'Doucement, prends ton temps 🐢'];
const KID_YAY = ['Bravo ! 🎉', 'Super ! ⭐', 'Génial ! 🌈', 'Trop fort ! 🚀', 'Oui ! 👏'];
const SHORTCUTS = [
  ['Espace', 'Démarrer / pause'], ['R', 'Recommencer'], ['← / →', 'Mesure précédente / suivante'], ['[ / ]', 'Début / fin de boucle sur la mesure courante'],
  ['- / +', 'Tempo −5 % / +5 %'], ['M', 'Métronome'], ['1 / 2 / 3', 'Main droite / main gauche / 2 mains'], ['W / P / L', 'Modes Attente / Tempo / Écoute'], ['?', 'Cette aide'],
];

export class Trainer {
  /**
   * @param {HTMLElement} root
   * @param {object} song morceau préparé
   * @param {object} opts {mode, hands, tempoPct, from, to, title, variant}
   * @param {object} hooks {onExit, onNext, onResult}
   */
  constructor(root, song, opts = {}, hooks = {}) {
    this.root = root;
    this.baseSong = song;
    this.hooks = hooks;
    this.settings = store.settings();
    this.opts = {
      mode: 'wait', hands: song.hands.R ? (song.hands.L ? 'both' : 'R') : 'L', tempoPct: 100, transpose: 0,
      loop: false, from: 0, to: song.totalBeats, metronome: this.settings.metronome, accompany: true, autoRepeat: false,
      progressive: false, view: this.settings.view, hint: true, rhythmOnly: false, fadeHelp: true, variant: null, ...opts,
    };
    if (!MODES.some(([m]) => m === this.opts.mode)) this.opts.mode = 'wait';
    this.kid = !!this.settings.kidMode;
    this.metroMode = this.settings.metronomeMode || 'all';
    this.playing = false;
    this.beat = this.opts.from;
    this.held = new Set();
    this.unsub = [];
    this.timers = new Set();
    this.voices = [];
    this.wrongOnEvent = 0;
    this.successRuns = 0;
    this.helpFaded = false;
    this.hidden = new Set(); // mode Par cœur : mesures masquées (indices 0..)
    this.taps = [];
    this.build();
    this.loadSong();
    this.bindInputs();
    this.raf = requestAnimationFrame(() => this.frame());
  }

  later(fn, ms) {
    const id = setTimeout(() => {
      this.timers.delete(id);
      if (!this.destroyed) fn();
    }, ms);
    this.timers.add(id);
    return id;
  }

  get waitLike() {
    return WAIT_LIKE.has(this.opts.mode);
  }

  get showFingers() {
    return !!this.settings.showFingers && !this.helpFaded && this.opts.mode !== 'memory';
  }

  get showNames() {
    return this.helpFaded || this.opts.mode === 'memory' ? false : this.settings.showNoteNames;
  }

  latencyFor(source) {
    const s = this.settings;
    const key = source === 'mouse' ? 'keyboard' : source?.startsWith('mic') ? 'mic' : source;
    return s.latency?.[source] ?? s.latency?.[key] ?? s.latencyMs ?? 0;
  }

  // ---------- construction de l'interface ----------
  build() {
    const o = this.opts;
    this.root.innerHTML = '';
    this.root.classList.add('trainer');
    this.root.classList.toggle('kid', this.kid);
    const s = this.baseSong;
    this.el = {};
    const modeSeg = h('div', { class: 'seg seg-modes', role: 'radiogroup', 'aria-label': 'Mode' },
      MODES.map(([id, label, tip]) => h('button', { class: 'seg-btn' + (o.mode === id ? ' on' : ''), title: tip, role: 'radio', 'aria-checked': String(o.mode === id), 'data-mode': id, onclick: () => this.setOpt('mode', id) }, label)));
    const handSeg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Mains' },
      [['R', 'Main droite'], ['L', 'Main gauche'], ['both', '2 mains']].map(([id, label]) =>
        h('button', { class: 'seg-btn' + (o.hands === id ? ' on' : ''), 'data-hands': id, role: 'radio', 'aria-checked': String(o.hands === id), disabled: (id === 'R' && !s.hands.R) || (id === 'L' && !s.hands.L) || (id === 'both' && !(s.hands.R && s.hands.L)), onclick: () => this.setOpt('hands', id) }, label)));

    this.el.play = h('button', { class: 'btn primary big', onclick: () => (this.playing ? this.pause() : this.start()), title: 'Démarrer / pause (Espace)' }, '▶ Démarrer');
    this.el.restart = h('button', { class: 'btn', onclick: () => this.restart(), title: 'Recommencer (R)', 'aria-label': 'Recommencer' }, '⟲');
    this.el.tempo = h('input', { type: 'range', min: 25, max: 150, step: 5, value: o.tempoPct, 'aria-label': 'Tempo en pourcentage', oninput: (e) => this.setOpt('tempoPct', Number(e.target.value)) });
    this.el.tempoLabel = h('span', { class: 'mono' });
    this.el.transpose = h('span', { class: 'mono' }, '0');
    this.el.mic = h('button', { class: 'btn', onclick: () => this.toggleMic(), title: 'Écouter ton piano avec le micro' }, '🎤 Micro');
    this.el.midiStatus = h('span', { class: 'chip muted', title: 'Clavier MIDI' }, 'MIDI : —');
    const mCount = s.measureCount;
    this.el.loopFrom = h('input', { type: 'number', min: 1, max: mCount, value: Math.floor(o.from / s.beatsPerMeasure) + 1, class: 'num', 'aria-label': 'Première mesure', onchange: () => this.updateLoop() });
    this.el.loopTo = h('input', { type: 'number', min: 1, max: mCount, value: Math.ceil(o.to / s.beatsPerMeasure - 1e-6), class: 'num', 'aria-label': 'Dernière mesure', onchange: () => this.updateLoop() });
    const check = (key, label, title) => h('label', { class: 'check', title }, [h('input', { type: 'checkbox', 'data-opt': key, checked: !!o[key], onchange: (e) => this.setOpt(key, e.target.checked) }), label]);

    this.el.viewSel = h('select', { onchange: (e) => this.setOpt('view', e.target.value), 'aria-label': 'Affichage' }, [
      h('option', { value: 'both', selected: o.view === 'both' }, 'Portée + notes'),
      h('option', { value: 'staff', selected: o.view === 'staff' }, 'Portée'),
      h('option', { value: 'roll', selected: o.view === 'roll' }, 'Notes qui tombent'),
    ]);
    this.el.metroSel = h('select', { 'aria-label': 'Clics du métronome', title: 'Clics du métronome', onchange: (e) => this.setMetroMode(e.target.value) },
      METRO_MODES.map(([v, l]) => h('option', { value: v, selected: this.metroMode === v }, l)));
    this.el.tap = h('button', { class: 'btn tiny', title: 'Tape le tempo (au moins 3 fois)', onclick: () => this.tap() }, '👆 Tap');
    this.el.help = h('button', { class: 'btn tiny', title: 'Raccourcis clavier (?)', 'aria-label': 'Raccourcis clavier', onclick: () => this.showShortcuts() }, '⌨ ?');

    const kidTempo = h('div', { class: 'row kid-tempo', role: 'radiogroup', 'aria-label': 'Vitesse' },
      [[60, '🐢', 'Tortue (60 %)'], [80, '🚶', 'Marche (80 %)'], [100, '🐇', 'Lapin (100 %)']].map(([pct, icon, label]) =>
        h('button', { class: 'btn kid-speed', 'data-kidtempo': pct, title: label, 'aria-label': label, onclick: () => this.setOpt('tempoPct', pct) }, icon)));

    this.el.controls = h('div', { class: 'controls' }, [
      h('div', { class: 'row' }, [this.el.play, this.el.restart, modeSeg, handSeg, this.el.mic, this.el.midiStatus]),
      h('div', { class: 'row small adv' }, [
        h('label', { class: 'field' }, ['Tempo ', this.el.tempo, this.el.tempoLabel, ' ', this.el.tap]),
        h('span', { class: 'field' }, ['Transposer ', h('button', { class: 'btn tiny', 'aria-label': 'Transposer d’un demi-ton plus bas', onclick: () => this.setOpt('transpose', o.transpose - 1) }, '−'), this.el.transpose, h('button', { class: 'btn tiny', 'aria-label': 'Transposer d’un demi-ton plus haut', onclick: () => this.setOpt('transpose', o.transpose + 1) }, '+')]),
        h('span', { class: 'field' }, ['Mesures ', this.el.loopFrom, ' à ', this.el.loopTo]),
        check('loop', 'Boucle', 'Répéter le passage choisi'),
        check('progressive', 'Tempo progressif', 'Accélère de 5 % à chaque passage réussi (≥ 90 %), jusqu’au tempo écrit'),
        h('span', { class: 'field' }, [check('metronome', 'Métronome', 'Clic de métronome (M)'), this.el.metroSel]),
        check('accompany', 'Jouer l\'autre main', "L'app joue la main que tu ne travailles pas (utilise un casque avec le micro)"),
        check('hint', 'Aide', 'Rejoue la note attendue après 3 erreurs'),
        check('fadeHelp', 'Aide qui s’estompe', 'Masque noms des notes et doigtés après 3 réussites d’affilée'),
        check('rhythmOnly', 'Rythme seul', 'Toute touche est acceptée : seul le placement rythmique compte'),
        this.el.viewSel, this.el.help,
      ]),
      kidTempo,
    ]);

    this.el.feedback = h('div', { class: 'feedback', 'aria-live': 'polite' }, 'Prêt ? Appuie sur Démarrer, puis joue !');
    this.el.turn = h('div', { class: 'imitate-turn hidden', 'aria-live': 'assertive' });
    this.el.score = h('div', { class: 'stat' }, [h('b', {}, '0'), h('small', {}, 'notes justes')]);
    this.el.streak = h('div', { class: 'stat' }, [h('b', {}, '0'), h('small', {}, 'série')]);
    this.el.acc = h('div', { class: 'stat' }, [h('b', {}, '–'), h('small', {}, 'précision')]);
    this.el.detected = h('div', { class: 'detected' }, [h('div', { class: 'det-note' }, '—'), h('div', { class: 'cents' }, [h('div', { class: 'needle' })]), h('div', { class: 'level' }, [h('div', { class: 'bar' })])]);
    this.el.progress = h('div', { class: 'progress' }, h('div', { class: 'fill' }));
    this.el.hud = h('div', { class: 'hud' }, [h('div', { class: 'fb-wrap' }, [this.el.turn, this.el.feedback]), h('div', { class: 'stats' }, [this.el.score, this.el.streak, this.el.acc]), this.el.detected]);

    this.el.review = h('div', { class: 'review-bar hidden', role: 'region', 'aria-label': 'Comparaison de ta prise' });
    this.el.staffWrap = h('div', { class: 'staff-wrap' });
    this.el.canvas = h('canvas', { class: 'roll', 'aria-hidden': 'true' });
    this.el.rollWrap = h('div', { class: 'roll-wrap' }, this.el.canvas);
    this.el.kb = h('div', { class: 'kb' });
    this.el.countdown = h('div', { class: 'countdown hidden' });
    this.el.concertBar = h('div', { class: 'concert-bar' }, [
      h('span', { class: 'concert-title' }, '🎼 Concert'),
      h('button', { class: 'btn tiny', onclick: () => this.finishConcert() }, '■ Terminer'),
      h('button', { class: 'btn tiny', onclick: () => this.setOpt('mode', 'wait') }, '✕ Quitter'),
    ]);
    this.el.concertEnd = h('div', { class: 'concert-end hidden', role: 'status' });
    this.el.stage = h('div', { class: 'stage' }, [this.el.concertBar, this.el.staffWrap, this.el.rollWrap, this.el.kb, this.el.countdown, this.el.concertEnd]);
    this.root.append(this.el.controls, this.el.progress, this.el.hud, this.el.review, this.el.stage,
      h('p', { class: 'hint-line' }, [
        'Astuce : clavier d\'ordinateur = piano (rangée ', h('kbd', {}, computerKeyboard.label('KeyA')), '…', h('kbd', {}, computerKeyboard.label('KeyL')),
        ', touches noires au-dessus, ', h('kbd', {}, computerKeyboard.label('KeyZ') || 'Z'), '/', h('kbd', {}, 'X'), ' = octave). ', h('kbd', {}, 'Espace'), ' démarrer/pause, ', h('kbd', {}, 'R'), ' recommencer, ', h('kbd', {}, '?'), ' tous les raccourcis.',
      ]));

    this.keyboard = new PianoKeyboard(this.el.kb, {
      onNoteOn: (m) => this.noteOn(m, 'mouse', 0.8),
      onNoteOff: (m) => this.noteOff(m, 'mouse'),
      label: (m) => this.keyLabel(m),
    });
    this.roll = new NoteRoll(this.el.canvas, this.keyboard);
    this.staff = new StaffView(this.el.staffWrap);
    this.applyView();
    this.updateKidTempo();
  }

  keyLabel(m) {
    if (this.settings.showKeyboardLabels) {
      const k = computerKeyboard.labelFor(m);
      if (k) return k;
    }
    if (this.kid && !this.helpFaded && this.opts.mode !== 'memory' && m % 12 !== 1 && m % 12 !== 3 && m % 12 !== 6 && m % 12 !== 8 && m % 12 !== 10) return noteLabel(m, { ...this.settings, octave: false });
    if (this.showNames && (m % 12 === 0 || this.showNames === 'all')) return noteLabel(m, this.settings);
    return m === 60 && !this.helpFaded ? noteLabel(m, this.settings) : null;
  }

  applyKidColors() {
    if (!this.kid || !this.keyboard.keyEls) return;
    for (const [m, d] of this.keyboard.keyEls) d.style.setProperty('--kc', kidColor(m));
  }

  applyView() {
    const mode = this.opts.mode;
    let v = this.opts.view;
    if (mode === 'memory' || mode === 'concert') v = 'staff';
    if (this.review && v === 'staff') v = 'both';
    this.root.classList.toggle('concert', mode === 'concert');
    this.root.classList.toggle('memory', mode === 'memory');
    this.el.staffWrap.classList.toggle('hidden', v === 'roll');
    this.el.rollWrap.classList.toggle('hidden', v === 'staff');
    this.viewNow = v;
    requestAnimationFrame(() => {
      this.roll.resize();
      this.staffPage = null;
    });
  }

  loadSong() {
    const o = this.opts;
    let song = transposeSong(this.baseSong, o.transpose);
    if (o.variant) {
      try {
        song = makeRhythmVariant(song, { from: o.from, to: o.to, pattern: o.variant });
      } catch {}
    }
    this.song = song;
    this.el.transpose.textContent = (o.transpose > 0 ? '+' : '') + o.transpose;
    const r = rangeForSong(this.song);
    this.keyboard.setRange(r.lo, r.hi);
    this.applyKidColors();
    this.roll.setNotes(this.song.notes);
    this.applyHelp();
    this.staffPage = null;
    this.updateTempoLabel();
    this.resetEngine();
  }

  applyHelp() {
    this.roll.showFingers = this.showFingers;
    this.roll.labels = this.showNames ? (m) => noteLabel(m, { ...this.settings, octave: false }) : null;
    this.roll.noteColor = this.kid ? kidColor : null;
    this.keyboard.refreshLabels();
    this.staffPage = null;
    this._markSig = null;
  }

  updateTempoLabel() {
    const bpm = Math.round((this.song.tempo * this.opts.tempoPct) / 100);
    this.el.tempoLabel.textContent = ` ${this.opts.tempoPct} % (${bpm} BPM)`;
    this.el.tempo.value = this.opts.tempoPct;
    this.updateKidTempo();
  }

  updateKidTempo() {
    this.root.querySelectorAll('[data-kidtempo]').forEach((b) => b.classList.toggle('on', Number(b.dataset.kidtempo) === this.opts.tempoPct));
  }

  range() {
    const bpm = this.song.beatsPerMeasure;
    const a = Math.max(1, Math.min(this.song.measureCount, Number(this.el.loopFrom.value) || 1));
    const b = Math.max(a, Math.min(this.song.measureCount, Number(this.el.loopTo.value) || this.song.measureCount));
    return { from: (a - 1) * bpm, to: Math.min(b * bpm, this.song.totalBeats + 1e-6) };
  }

  updateLoop() {
    this.stopPlayback();
    this.resetEngine();
  }

  get tempoBpm() {
    return (this.song.tempo * this.opts.tempoPct) / 100;
  }

  resetEngine() {
    const o = this.opts;
    const { from, to } = this.range();
    this.from = from;
    this.to = to;
    this.engine = new PracticeEngine(this.song, {
      mode: o.mode === 'tempo' ? 'tempo' : 'wait', hands: o.hands, from, to, rhythmOnly: !!o.rhythmOnly,
      octaveTolerant: this.settings.octaveTolerant && mic.running, tempo: this.tempoBpm, velocityCalib: this.settings.velocityCalib || null,
    });
    this.beat = from;
    this.roll.state.clear();
    this.roll.loop = o.loop ? { from, to } : null;
    this.staffPage = null;
    this.wrongOnEvent = 0;
    this.waitErrEvents = new Set();
    this.sessionStart = performance.now();
    this._finishedShown = false;
    this.take = createTake({ songId: this.baseSong.id, title: this.baseSong.title, mode: o.mode, hands: o.hands, tempo: this.tempoBpm, tempoPct: o.tempoPct, from, to, timeSig: this.song.timeSig });
    this.follower = null;
    this._concertDone = false;
    this.imi = null;
    this.el.turn.classList.add('hidden');
    this.el.concertEnd.classList.add('hidden');
    if (o.mode === 'concert') {
      const notes = this.song.notes.filter((n) => n.start >= from - 1e-6 && n.start < to - 1e-6 && (o.hands === 'both' || n.hand === o.hands));
      this.follower = new ScoreFollower(notes, { tempo: this.tempoBpm });
    }
    if (o.mode === 'imitate') this.imi = { groups: this.imitateGroups(), gi: 0, phase: 'idle' };
    this.updateStats();
  }

  /** Temps de la séance (s) : horloge murale pour les modes sans défilement. */
  wallSec(perfT = performance.now()) {
    return (perfT - this.sessionStart) / 1000;
  }

  setOpt(key, value) {
    const o = this.opts;
    const prevMode = o.mode;
    o[key] = value;
    if (key === 'transpose') {
      o.transpose = Math.max(-12, Math.min(12, value));
      this.stopPlayback();
      this.loadSong();
    } else if (key === 'mode' || key === 'hands') {
      this.stopPlayback();
      this.closeReview();
      this.root.querySelectorAll(`[data-${key}]`).forEach((b) => {
        b.classList.toggle('on', b.dataset[key] === value);
        b.setAttribute('aria-checked', String(b.dataset[key] === value));
      });
      if (key === 'mode') {
        if (prevMode === 'concert' && value !== 'concert') this.exitConcert();
        if (value !== 'memory') this.hidden.clear();
        this.applyView();
        this.applyHelp();
      }
      this.resetEngine();
      if (key === 'mode' && value === 'concert') this.enterConcert();
      if (key === 'mode') this.say(this.modeIntro(value));
    } else if (key === 'tempoPct') {
      o.tempoPct = Math.max(25, Math.min(150, Math.round(value)));
      this.updateTempoLabel();
      const bpm = this.tempoBpm;
      const b = this.beat;
      this.engine.setTempo(bpm);
      if (this.playing && this.clockRunning) this.startClock(b, this.clockTo);
      if (this.follower) this.follower.spb = 60 / bpm;
    } else if (key === 'view') {
      this.settings.view = value;
      store.saveSettings({ ...store.settings(), view: value });
      this.applyView();
    } else if (key === 'loop') {
      this.roll.loop = value ? { from: this.from, to: this.to } : null;
      const c = this.root.querySelector('[data-opt="loop"]');
      if (c) c.checked = !!value;
    } else if (key === 'metronome') {
      this.settings.metronome = value;
      store.saveSettings({ ...store.settings(), metronome: value });
      const c = this.root.querySelector('[data-opt="metronome"]');
      if (c) c.checked = !!value;
    } else if (key === 'rhythmOnly') {
      this.engine.opts.rhythmOnly = !!value;
    } else if (key === 'fadeHelp') {
      if (!value && this.helpFaded) {
        this.helpFaded = false;
        this.applyHelp();
      }
    }
  }

  modeIntro(mode) {
    return {
      wait: 'Mode Attente : la partition t’attend.', tempo: 'Mode Tempo : la partition défile en rythme.', listen: 'Mode Écoute : l’app joue pour toi.',
      imitate: 'Mode Imiter : écoute une mesure, puis répète-la.', memory: 'Mode Par cœur : des mesures disparaîtront à chaque passage réussi.',
      concert: 'Mode Concert : joue, la partition te suit.',
    }[mode] || '';
  }

  setMetroMode(v) {
    this.metroMode = v;
    store.saveSettings({ ...store.settings(), metronomeMode: v });
  }

  /** Tap tempo : moyenne des derniers intervalles. */
  tap() {
    const now = performance.now();
    if (this.taps.length && now - this.taps[this.taps.length - 1] > 2000) this.taps = [];
    this.taps.push(now);
    this.taps = this.taps.slice(-6);
    synth.click(synth.audioContext().currentTime, this.taps.length === 1);
    if (this.taps.length < 3) {
      this.say(`Tape encore… (${this.taps.length})`);
      return;
    }
    const iv = [];
    for (let i = 1; i < this.taps.length; i++) iv.push(this.taps[i] - this.taps[i - 1]);
    const bpm = 60000 / (iv.reduce((a, b) => a + b, 0) / iv.length);
    const pct = Math.round((bpm / this.song.tempo) * 100);
    this.setOpt('tempoPct', pct);
    this.say(`Tempo tapé : ${Math.round(bpm)} BPM (${this.opts.tempoPct} %)`, 'info');
  }

  // ---------- entrées ----------
  bindInputs() {
    const onEvent = (e) => {
      if (e.type === 'noteon') this.noteOn(e.midi, e.source, e.velocity, e.t);
      else if (e.type === 'noteoff') this.noteOff(e.midi, e.source, e.t);
    };
    this.unsub.push(midiInput.on((e) => {
      if (e.type === 'devices') this.updateMidiStatus();
      else if (e.type === 'pedal') this.onPedal(e.down, e.t);
      else onEvent(e);
    }));
    midiInput.init().then(() => this.updateMidiStatus()).catch(() => this.updateMidiStatus());
    this.unsub.push(computerKeyboard.on((e) => {
      if (e.type === 'octave') toast(`Clavier d'ordinateur : octave ${Math.floor(e.base / 12) - 1}`);
      if (e.type === 'labels' || e.type === 'octave') this.keyboard.refreshLabels();
      onEvent(e);
    }));
    this.unsub.push(mic.on((e) => this.onMic(e)));
    this.el.mic.classList.toggle('on', mic.running);
    this._keys = (e) => this.onKey(e);
    window.addEventListener('keydown', this._keys);
    // Pause automatique quand on quitte l'onglet (sinon le mode Tempo continue et fausse le score)
    this._vis = () => {
      if (document.hidden && this.playing && this.clockRunning && this.opts.mode !== 'concert') this.pause();
      if (!document.hidden && this.opts.mode === 'concert') this.requestWakeLock();
    };
    document.addEventListener('visibilitychange', this._vis);
    this._fs = () => this.root.classList.toggle('fullscreen', document.fullscreenElement === this.root);
    document.addEventListener('fullscreenchange', this._fs);
  }

  /** Le clavier d'ordinateur sert-il de piano (touches lettres réservées) ? */
  pianoKeysActive() {
    return computerKeyboard.enabled !== false && !['listen'].includes(this.opts.mode) && !midiInput.devices?.length && !mic.running;
  }

  onKey(e) {
    if (computerKeyboard.isTyping(e) || e.ctrlKey || e.metaKey) return;
    if (document.querySelector('dialog[open]')) return;
    const pianoCode = e.code in KEY_CODES || e.code === 'KeyZ' || e.code === 'KeyX';
    if (!e.altKey && pianoCode && this.pianoKeysActive()) return; // touche de piano
    const letter = e.altKey && e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : (e.key || '').toLowerCase();
    let done = true;
    if (e.code === 'Space' && !e.altKey) {
      if (e.repeat) return e.preventDefault();
      document.activeElement?.blur?.();
      this.playing ? this.pause() : this.start();
    } else if (letter === 'r' && !e.altKey) this.restart();
    else if (e.code === 'Escape') this.pause();
    else if (e.key === 'ArrowLeft') this.seekMeasure(-1);
    else if (e.key === 'ArrowRight') this.seekMeasure(1);
    else if (e.key === '[' || e.code === 'BracketLeft') this.setLoopEdge('from');
    else if (e.key === ']' || e.code === 'BracketRight') this.setLoopEdge('to');
    else if (e.key === '-' || e.code === 'NumpadSubtract' || e.code === 'Minus') this.setOpt('tempoPct', this.opts.tempoPct - 5);
    else if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd' || e.code === 'Equal') this.setOpt('tempoPct', this.opts.tempoPct + 5);
    else if (letter === 'm' || e.key === ',' && e.code === 'KeyM') this.setOpt('metronome', !this.opts.metronome);
    else if (['1', '2', '3'].includes(e.key) || ['Digit1', 'Digit2', 'Digit3'].includes(e.code)) {
      const idx = Number(e.code.startsWith('Digit') ? e.code.slice(5) : e.key);
      const hand = ['R', 'L', 'both'][idx - 1];
      const ok = hand === 'both' ? this.song.hands.R && this.song.hands.L : this.song.hands[hand];
      if (ok) this.setOpt('hands', hand);
    } else if (letter === 'w') this.setOpt('mode', 'wait');
    else if (letter === 'p') this.setOpt('mode', 'tempo');
    else if (letter === 'l') this.setOpt('mode', 'listen');
    else if (e.key === '?' || (e.code === 'Slash' && e.shiftKey) || (e.altKey && e.code === 'Slash')) this.showShortcuts();
    else done = false;
    if (done) e.preventDefault();
  }

  showShortcuts() {
    modal('Raccourcis clavier', `<table class="shortcuts">${SHORTCUTS.map(([k, d]) => `<tr><td><kbd>${escapeHtml(k)}</kbd></td><td>${escapeHtml(d)}</td></tr>`).join('')}</table>
      <p class="small muted">Quand le clavier d'ordinateur sert de piano, les lettres W, P et L jouent des notes : ajoute <kbd>Alt</kbd> (par ex. <kbd>Alt</kbd>+<kbd>W</kbd>). Les autres raccourcis marchent aussi avec <kbd>Alt</kbd>.</p>`);
  }

  currentMeasure() {
    return Math.max(0, measureOf(this.song, Math.max(0, this.beat + 1e-3)));
  }

  /** Mesure précédente / suivante. */
  seekMeasure(delta) {
    if (this.opts.mode === 'concert') return;
    const bpm = this.song.beatsPerMeasure;
    const cur = this.currentMeasure();
    let target = (cur + delta) * bpm;
    // ← au milieu d'une mesure : revient d'abord à son début
    if (delta < 0 && this.beat - cur * bpm > 0.5) target = cur * bpm;
    target = Math.max(this.from, Math.min(this.to - 1e-3, target));
    const wasPlaying = this.playing && this.clockRunning;
    if (wasPlaying) this.pauseClock();
    this.engine.seek(target);
    this.beat = target;
    this.staffPage = null;
    if (wasPlaying) this.startClock(target);
    this.say(`Mesure ${measureOf(this.song, target + 1e-3) + 1}`);
    this.updateStats();
  }

  setLoopEdge(which) {
    const m = this.currentMeasure() + 1;
    if (which === 'from') {
      this.el.loopFrom.value = m;
      if (Number(this.el.loopTo.value) < m) this.el.loopTo.value = m;
    } else {
      this.el.loopTo.value = m;
      if (Number(this.el.loopFrom.value) > m) this.el.loopFrom.value = m;
    }
    this.setOpt('loop', true);
    this.updateLoop();
    toast(`Boucle : mesures ${this.el.loopFrom.value} à ${this.el.loopTo.value}`);
  }

  updateMidiStatus() {
    const d = midiInput.devices || [];
    if (!midiInput.supported) {
      this.el.midiStatus.textContent = 'MIDI : non supporté';
      this.el.midiStatus.title = 'Utilise Chrome ou Edge pour brancher un clavier MIDI';
    } else {
      this.el.midiStatus.textContent = d.length ? `🎹 ${d.join(', ')}` : 'MIDI : aucun clavier';
      this.el.midiStatus.classList.toggle('muted', !d.length);
    }
  }

  async toggleMic() {
    try {
      if (mic.running) mic.stop();
      else {
        mic.a4 = this.settings.a4;
        mic.setSensitivity?.(this.settings.micSensitivity);
        await mic.start();
        toast('Micro activé : joue sur ton piano !');
        if (this.opts.accompany && this.opts.hands !== 'both') toast("Conseil : avec « Jouer l'autre main », utilise un casque pour que le micro n'entende pas l'accompagnement.", 5000);
      }
    } catch (err) {
      modal('Micro indisponible', `<p>${escapeHtml(err.message || String(err))}</p><p>Vérifie que tu as autorisé l'accès au micro dans ton navigateur (icône 🔒 dans la barre d'adresse). Le site doit être ouvert en <b>https</b> ou sur <b>localhost</b>.</p>`);
    }
    this.el.mic.classList.toggle('on', mic.running);
    this.engine.opts.octaveTolerant = this.settings.octaveTolerant && mic.running;
  }

  onMic(e) {
    if (e.type === 'state') {
      this.el.mic.classList.toggle('on', e.running);
      return;
    }
    if (e.type === 'frame') {
      this.showDetected(e);
      if (e.attack) this.lastAttack = e.attackT ?? e.t;
      this.checkChordFromSpectrum(e.t);
      return;
    }
    if (e.type === 'onset') {
      if (this.opts.mode === 'listen') return;
      if (this.opts.mode === 'concert') return this.concertInput(e.midi, 'mic', 0.8, e.t);
      this.recordOn(e.midi, 'mic', 0.8, e.t);
      this.evaluate(e.midi, 'mic', { perfT: e.t });
      // le micro ne donne pas de relâchement : on ferme la note de la prise après une durée nominale
      this.later(() => takeNoteOff(this.take, e.midi, this.takeTime('mic')), 250);
    }
  }

  showDetected(e) {
    const det = this.el.detected;
    det.querySelector('.det-note').textContent = e.midi != null && e.clarity > 0.7 ? noteLabel(e.midi, this.settings) : '—';
    const needle = det.querySelector('.needle');
    needle.style.transform = `translateX(${Math.max(-50, Math.min(50, e.cents || 0))}px)`;
    needle.classList.toggle('in-tune', Math.abs(e.cents) <= 10 && e.midi != null);
    det.querySelector('.bar').style.width = Math.min(100, (e.rms || 0) * 600) + '%';
  }

  /** Accords au micro : on vérifie dans le spectre que toutes les notes attendues sonnent. */
  checkChordFromSpectrum(t) {
    if (!this.playing || ['listen', 'concert'].includes(this.opts.mode) || !this.lastAttack || t - this.lastAttack > 500) return;
    if (this.imi && this.imi.phase !== 'play') return;
    let expected;
    if (this.waitLike) {
      const ev = this.engine.current;
      if (!ev || ev.midis.length < 2) return;
      // l'accord ne peut être validé que par une attaque postérieure à son apparition (pas par la résonance du précédent)
      if (this._chordEvent !== ev) {
        this._chordEvent = ev;
        this._chordSince = performance.now();
      }
      if (this.lastAttack < this._chordSince) return;
      expected = ev.midis.filter((m) => !this.engine.satisfied.has(m));
    } else {
      const now = this.songTime(0, this.lastAttack);
      const near = [];
      for (let i = this.engine.tIdx; i < this.engine.events.length; i++) {
        const ev = this.engine.events[i];
        if (ev.time - now > ev.win.ok) break;
        if (Math.abs(ev.time - now) <= ev.win.ok && ev.midis.length > 1) near.push(ev);
      }
      expected = near.flatMap((ev) => ev.notes.filter((n) => !this.engine.judged.has(n.id)).map((n) => n.midi));
    }
    if (!expected.length) return;
    const mag = mic.spectrum();
    if (!mag) return;
    const res = matchChord(mag, mic.sampleRate, expected, { a4: this.settings.a4 });
    for (const m of res.present) {
      this.recordOn(m, 'mic-chord', 0.8, this.lastAttack);
      this.evaluate(m, 'mic-chord', { perfT: this.lastAttack });
    }
  }

  onPedal(down, perfT) {
    synth.setSustain(down);
    this.el.midiStatus.classList.toggle('pedal', down);
    const t = this.takeTime('midi', perfT);
    takePedal(this.take, down, t);
    if (this.opts.mode === 'tempo' && this.playing) this.engine.pedal(down, t);
  }

  noteOn(midi, source, velocity = 0.8, perfT = performance.now()) {
    // Un piano numérique produit déjà son propre son : on évite de le doubler (réglable)
    const local = source !== 'midi' || this.settings.midiLocalSound !== false;
    if (local) synth.playNote(midi, { velocity, dur: 8, instrument: this.settings.instrument, a4: this.settings.a4 });
    this.held.add(midi);
    this.keyboard.press(midi);
    if (this.opts.mode === 'listen' || this.review) return;
    if (this.opts.mode === 'concert') return this.concertInput(midi, source, velocity, perfT);
    if (this.opts.mode === 'imitate' && (!this.playing || this.imi?.phase !== 'play')) {
      if (!this.playing && !this.engine.finished) this.start();
      return;
    }
    if (!this.playing && !this.waitLike) return;
    if (!this.playing && this.waitLike && !this.engine.finished) this.start(true);
    this.recordOn(midi, source, velocity, perfT);
    this.evaluate(midi, source, { velocity: source === 'midi' ? velocity : null, perfT });
  }

  noteOff(midi, source = 'keyboard', perfT = performance.now()) {
    synth.releaseNote(midi);
    this.held.delete(midi);
    this.keyboard.release(midi);
    if (this.opts.mode === 'listen' || this.review) return;
    const t = this.takeTime(source, perfT);
    takeNoteOff(this.take, midi, t);
    if (this.opts.mode === 'tempo' && this.playing) {
      const r = this.engine.release(midi, t);
      if (r && r.verdict === 'short') this.say(`${noteLabel(midi, this.settings)} relâchée trop tôt : tiens-la jusqu’au bout`, 'info', { quiet: true });
      else if (r && r.verdict === 'long') this.say(`${noteLabel(midi, this.settings)} tenue trop longtemps`, 'info', { quiet: true });
    }
  }

  /** Temps pour la prise : temps du morceau en mode Tempo, sinon horloge de la séance. */
  takeTime(source, perfT = performance.now()) {
    if (this.opts.mode === 'tempo' && this.clockRunning) return this.songTime(this.latencyFor(source), perfT);
    return this.wallSec(perfT) - this.latencyFor(source) / 1000;
  }

  recordOn(midi, source, velocity, perfT) {
    this._lastTakeIdx = takeNoteOn(this.take, { midi, t: this.takeTime(source, perfT), vel: velocity, src: source });
  }

  /** Position en secondes depuis le début du passage, à l'instant d'attaque perfT (horloge audio), moins la latence. */
  songTime(latencyMs = 0, perfT = null) {
    if (!this.clockRunning) return this.engine.timeOf(this.beat) - latencyMs / 1000;
    const ac = synth.audioContext();
    const acT = ac.currentTime - (perfT != null ? Math.max(0, (performance.now() - perfT) / 1000) : 0);
    return acT - this.clockOrigin - latencyMs / 1000;
  }

  // compatibilité
  currentSongTime(latencyMs = 0) {
    return this.songTime(latencyMs);
  }

  evaluate(midi, source, { velocity = null, perfT = null } = {}) {
    if (!this.playing || this.engine.finished) return;
    if (this.imi && this.imi.phase !== 'play') return;
    const fromMic = source.startsWith('mic');
    const ev = this.engine.current;
    const tIdx = this._lastTakeIdx;
    const tn = tIdx >= 0 ? this.take.notes[tIdx] : null;
    const exactSkip = () => {
      if (tn) this.take.notes.splice(tIdx, 1);
      this._lastTakeIdx = -1;
    };
    // Harmoniques mal reconnues au micro : on ne les compte pas comme fautes
    if (fromMic && this.waitLike && ev && !ev.midis.includes(midi) && ev.midis.some((m) => [12, 19, 24].includes(midi - m))) return exactSkip();
    if (fromMic && this.opts.mode === 'tempo') {
      const near = this.engine.events.filter((e) => Math.abs(e.start - this.beat) < 0.5).flatMap((e) => e.midis);
      if (!near.includes(midi) && near.some((m) => [12, 19, 24].includes(midi - m))) return exactSkip();
    }
    if (fromMic) this.keyboard.flash(midi, 'pressed-flash');
    // La tolérance d'octave ne vaut que pour le micro (un clavier MIDI ne se trompe pas d'octave)
    this.engine.opts.octaveTolerant = fromMic && this.settings.octaveTolerant;
    const firstOfEvent = this.waitLike && this.engine.satisfied.size === 0;
    const t = this.opts.mode === 'tempo' ? this.songTime(this.latencyFor(source), perfT) : this.wallSec(perfT ?? performance.now());
    const res = this.engine.input(midi, t, velocity != null ? { velocity } : null);
    // annoter la prise
    if (tn) {
      tn.judge = res.type === 'ignored' ? null : judgeOf(res);
      if (res.type === 'wrong') tn.exp = res.expected;
      if (res.noteId != null || (this.waitLike && ev && res.type !== 'wrong' && res.type !== 'ignored')) {
        const note = res.noteId != null ? this.song.notes.find((n) => n.id === res.noteId) : ev?.notes.find((n) => n.midi === midi) || ev?.notes[0];
        if (note) {
          tn.noteId = note.id;
          tn.nb = note.start;
          tn.hand = note.hand;
        }
      } else if (ev && res.type === 'wrong' && this.waitLike) tn.nb = ev.start;
      if (res.delta != null) tn.delta = res.delta;
      if (this.waitLike && firstOfEvent && ev && (res.type === 'hit' || res.type === 'advance' || res.type === 'finish')) addAnchor(this.take, tn.t0, ev.start);
    }
    if (res.type === 'hit' || res.type === 'advance' || res.type === 'finish') {
      this.keyboard.flash(midi, 'hit');
      if (res.grade) {
        const words = { perfect: 'Parfait !', good: 'Bien !', ok: 'OK' };
        this.say(`${this.kid ? pick(KID_YAY) : words[res.grade]} ${noteLabel(midi, this.settings)}${Math.abs(res.delta) > 0.08 ? (res.delta > 0 ? ' (un peu tard)' : ' (un peu tôt)') : ''}`, 'ok');
        if (res.noteId) this.markNote(res.noteId, 'hit');
        if (res.legatoMissed) this.say('Legato : garde la note enfoncée jusqu’à la suivante', 'info');
      } else if (res.type !== 'hit' || !res.partial) {
        this.say(`${this.kid ? pick(KID_YAY) : '✓'} ${noteLabel(midi, this.settings)}`, 'ok');
      }
      if (res.octave && this.settings.octaveWarning !== false) this.say(`Bonne note, mais mauvaise octave (${noteLabel(midi, this.settings)}) : regarde bien la portée !`, 'info');
      if (res.chordNotTogether) this.say(`Accord pas plaqué ensemble (${(res.chordSpread).toFixed(1)} s) : joue toutes les notes en même temps`, 'info');
      if (this.waitLike && (res.type === 'advance' || res.type === 'finish')) {
        const done = this.engine.events[this.engine.index - 1];
        done.notes.forEach((n) => this.markNote(n.id, this.waitErrEvents.has(done.index) ? 'miss' : 'hit'));
        this.wrongOnEvent = 0;
        if (this.opts.mode !== 'imitate') this.playAccompaniment(done);
        if (this.opts.mode === 'wait' && res.type === 'advance') this.speakExpected();
        if (this.imi) this.imitateProgress();
      }
      if (res.type === 'finish') this.finish();
    } else if (res.type === 'wrong') {
      this.keyboard.flash(midi, 'miss');
      if (this.waitLike && ev) this.waitErrEvents.add(ev.index);
      const exp = (res.expected || []).map((m) => {
        const n = (this.engine.current?.notes || []).find((x) => x.midi === m);
        return noteLabel(m, this.settings) + (n?.finger && this.showFingers ? ` (doigt ${n.finger})` : '');
      });
      if (this.kid) this.say(pick(KID_OOPS), 'bad');
      else this.say(`✗ ${noteLabel(midi, this.settings)}${exp.length && this.opts.mode !== 'memory' ? ' — attendu : ' + exp.join(' + ') : ''}`, 'bad');
      if (this.waitLike) {
        this.wrongOnEvent++;
        if (this.opts.hint && this.wrongOnEvent === 3 && this.engine.current) {
          this.engine.current.midis.forEach((m, i) => synth.playNote(m, { when: synth.audioContext().currentTime + 0.15 + i * 0.02, dur: 0.8, velocity: 0.5, instrument: this.settings.instrument }));
          const f = this.engine.current.notes[0];
          this.say(`Écoute… c'est ${exp.join(' + ')} — ${f.hand === 'L' ? 'main gauche' : 'main droite'}${f.finger ? ', ' + FINGER_NAMES[f.finger] : ''}`, 'info');
        }
      }
    }
    this.updateStats();
  }

  speakExpected() {
    if (!this.settings.tts || !this.engine.current) return;
    const ev = this.engine.current;
    const f = ev.notes[0];
    const txt = ev.midis.map((m) => noteLabel(m, { ...this.settings, octave: false })).join(', ') + (f.finger && this.showFingers ? `, doigt ${f.finger}` : '');
    this.speak(txt);
  }

  speak(text) {
    if (!this.settings.tts || typeof dom.speak !== 'function') return;
    try {
      dom.speak(text);
    } catch {}
  }

  /** En mode attente, joue l'autre main entre cet événement et le suivant. */
  playAccompaniment(done) {
    if (!this.opts.accompany || this.opts.hands === 'both') return;
    const next = this.engine.current;
    const end = next ? next.start : this.to;
    const ac = synth.audioContext();
    const t0 = this.engine.timeOf(done.start);
    for (const n of this.song.notes) {
      if (n.hand === this.opts.hands) continue;
      if (n.start >= done.start - 1e-6 && n.start < end - 1e-6) {
        const when = ac.currentTime + this.engine.timeOf(n.start) - t0;
        this.trackVoice(synth.playNote(n.midi, { when, dur: this.engine.timeOf(n.start + n.dur) - this.engine.timeOf(n.start), velocity: 0.55, instrument: this.settings.instrument }), when);
      }
    }
  }

  markNote(id, cls) {
    this.roll.state.set(id, cls);
    this.staff.mark(id, cls);
  }

  say(text, kind = 'info', { quiet = false } = {}) {
    if (this.opts.mode === 'concert') return; // pas de jugement visible en concert
    if (quiet && this.el.feedback.classList.contains('bad') && performance.now() - (this._sayAt || 0) < 800) return;
    this._sayAt = performance.now();
    this.el.feedback.textContent = text;
    this.el.feedback.className = 'feedback ' + kind;
    // lecture vocale des consignes : mode Attente uniquement
    if (this.opts.mode === 'wait' && kind !== 'ok' && !quiet) this.speak(text.replace(/^✗\s*/, ''));
  }

  updateStats() {
    const s = this.engine.summary();
    this.el.score.querySelector('b').textContent = s.hits;
    this.el.streak.querySelector('b').textContent = s.streak;
    this.el.acc.querySelector('b').textContent = s.total ? s.score + ' %' : '–';
    const total = this.engine.events.length || 1;
    const done = this.waitLike ? this.engine.index : this.engine.events.filter((e) => e.start < this.beat).length;
    this.el.progress.firstChild.style.width = Math.min(100, (done / total) * 100) + '%';
  }

  // ---------- lecture ----------
  start(silent = false) {
    if (this.review) this.closeReview();
    if (this.engine.finished || (this.follower && this._concertDone)) this.resetEngine();
    synth.audioContext();
    this.playing = true;
    this.el.play.textContent = '⏸ Pause';
    this.el.play.classList.add('on');
    const m = this.opts.mode;
    if (!silent) this.say({ wait: 'Joue la note surlignée !', tempo: 'C\'est parti, suis le rythme !', listen: 'Écoute et regarde les touches…', imitate: 'Écoute bien, puis répète !', memory: 'Joue de mémoire !', concert: '' }[m] || '');
    if (m === 'wait' && !silent) this.speakExpected();
    if (m === 'tempo' || m === 'listen') {
      const countIn = this.settings.countIn && m === 'tempo' && Math.abs(this.beat - this.from) < 1e-3 ? this.song.beatsPerMeasure : 0;
      this.startClock(this.beat - countIn);
    } else if (m === 'imitate') {
      this.imitateBegin();
    } else if (m === 'concert') {
      this.sessionStart = this.sessionStart || performance.now();
    }
  }

  get clockRunning() {
    return !!this._clock;
  }

  /** Démarre l'horloge audio à partir d'un temps (carte de tempo prise en compte). */
  startClock(fromBeat, toBeat = this.to) {
    const ac = synth.audioContext();
    this.cancelFutureVoices();
    this.clockOrigin = ac.currentTime + 0.1 - this.engine.timeOf(fromBeat); // temps audio où beat == from
    this.clockTo = toBeat;
    this.schedBeat = Math.ceil(fromBeat - 1e-6); // prochain clic de métronome
    const idx = this.song.notes.findIndex((n) => n.start >= fromBeat - 1e-6);
    this.schedIdx = idx < 0 ? this.song.notes.length : idx;
    this._clock = true;
    clearInterval(this.scheduler);
    this.scheduler = setInterval(() => this.schedule(), 25);
    this.schedule();
  }

  pauseClock() {
    this._clock = false;
    clearInterval(this.scheduler);
    this.cancelFutureVoices();
  }

  clockBeat() {
    const ac = synth.audioContext();
    return this.engine.beatOf(ac.currentTime - this.clockOrigin);
  }

  trackVoice(v, when) {
    if (!v) return;
    this.voices.push({ v, when });
    if (this.voices.length > 200) this.voices = this.voices.slice(-120);
  }

  /** Coupe les notes déjà planifiées qui n'ont pas encore commencé (changement de tempo, pause). */
  cancelFutureVoices() {
    const ac = synth.audioContext();
    const now = ac.currentTime;
    for (const { v, when } of this.voices) {
      if (when <= now + 0.005) continue;
      try {
        v.env?.gain.cancelScheduledValues(0);
        v.env?.gain.setValueAtTime(0, now);
        (v.sources || []).forEach((o) => o.stop(now + 0.01));
      } catch {}
    }
    this.voices = [];
  }

  metroOn(beatInMeasure) {
    if (this.metroMode === '1') return beatInMeasure === 0;
    if (this.metroMode === '24') return beatInMeasure % 2 === 1;
    return true;
  }

  /** Planifie métronome + notes jouées par l'app (écoute / accompagnement / imiter) un peu à l'avance. */
  schedule() {
    if (!this.playing || !this._clock) return;
    const ac = synth.audioContext();
    const nowSec = ac.currentTime - this.clockOrigin;
    const horizon = nowSec + 0.3;
    const timeOf = (b) => this.clockOrigin + this.engine.timeOf(b);
    const bpm = this.song.beatsPerMeasure;
    const imitating = this.imi && this.imi.phase === 'listen';
    // métronome / décompte
    for (; this.engine.timeOf(this.schedBeat) < horizon; this.schedBeat++) {
      const b = this.schedBeat;
      const counting = b < this.from - 1e-6;
      const inBar = ((b % bpm) + bpm) % bpm;
      if (!imitating && ((this.opts.metronome && this.metroOn(Math.round(inBar))) || counting) && b <= this.clockTo + 1e-6) synth.click(timeOf(b), Math.round(inBar) === 0);
      if (counting) {
        const n = Math.round(this.from - b);
        this.later(() => this.showCount(n), Math.max(0, (timeOf(b) - ac.currentTime) * 1000));
      }
    }
    // notes
    const notes = this.song.notes;
    const h = this.opts.hands;
    while (this.schedIdx < notes.length) {
      const n = notes[this.schedIdx];
      if (this.engine.timeOf(n.start) > horizon) break;
      this.schedIdx++;
      if (n.start < this.from - 1e-6 || n.start >= this.clockTo - 1e-6) continue;
      const play = this.opts.mode === 'listen' || (imitating && (h === 'both' || n.hand === h || this.opts.accompany)) || (this.opts.mode === 'tempo' && this.opts.accompany && h !== 'both' && n.hand !== h);
      if (!play) continue;
      const when = timeOf(n.start);
      const dur = (this.engine.timeOf(n.start + n.dur) - this.engine.timeOf(n.start)) * 0.95;
      const mine = this.opts.mode === 'listen' || (imitating && (h === 'both' || n.hand === h));
      this.trackVoice(synth.playNote(n.midi, { when, dur, velocity: mine ? 0.75 : 0.45, instrument: this.settings.instrument, a4: this.settings.a4 }), when);
    }
  }

  showCount(n) {
    const c = this.el.countdown;
    if (n <= 0 || !this.playing) return c.classList.add('hidden');
    c.textContent = n;
    c.classList.remove('hidden', 'pop');
    void c.offsetWidth;
    c.classList.add('pop');
    this.later(() => n === 1 && c.classList.add('hidden'), 600);
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    this.pauseClock();
    synth.stopAll();
    this.el.play.textContent = '▶ Reprendre';
    this.el.play.classList.remove('on');
    this.el.countdown.classList.add('hidden');
    if (this.imi) {
      // reprendre l'imitation au début du groupe en cours
      clearTimeout(this.imi.timer);
      this.imi.phase = 'idle';
      this.el.turn.classList.add('hidden');
    }
  }

  stopPlayback() {
    this.pause();
    this.el.play.textContent = '▶ Démarrer';
  }

  restart() {
    this.stopPlayback();
    this.closeReview();
    if (this.opts.mode === 'concert') this.el.concertEnd.classList.add('hidden');
    this.resetEngine();
    this.say('On recommence !');
  }

  // ---------- mode Imiter ----------
  imitateGroups() {
    const bpm = this.song.beatsPerMeasure;
    const groups = [];
    for (let b = Math.floor(this.from / bpm) * bpm; b < this.to - 1e-6; b += bpm) {
      const g = { from: Math.max(this.from, b), to: Math.min(this.to, b + bpm) };
      if (this.engine.events.some((e) => e.start >= g.from - 1e-6 && e.start < g.to - 1e-6)) groups.push(g);
    }
    return groups;
  }

  imitateBegin() {
    const imi = this.imi;
    if (!imi) return;
    const cur = this.engine.current;
    if (!cur) return this.finish();
    imi.gi = Math.max(0, imi.groups.findIndex((g) => cur.start >= g.from - 1e-6 && cur.start < g.to - 1e-6));
    const g = imi.groups[imi.gi];
    imi.phase = 'listen';
    this.engine.seek(cur.start);
    this.setTurn('👂 Écoute', 'listen');
    this.startClock(g.from, g.to);
    const dur = this.engine.timeOf(g.to) - this.engine.timeOf(g.from);
    clearTimeout(imi.timer);
    imi.timer = this.later(() => {
      if (!this.playing || this.imi !== imi) return;
      this.pauseClock();
      imi.phase = 'play';
      this.beat = this.engine.current ? this.engine.current.start : g.from;
      this.setTurn('🎹 À toi', 'play');
      this.say('À toi ! Rejoue ce que tu viens d’entendre.', 'info');
    }, (dur + 0.45) * 1000);
  }

  imitateProgress() {
    const imi = this.imi;
    const g = imi.groups[imi.gi];
    const cur = this.engine.current;
    if (!cur) return;
    if (cur.start >= g.to - 1e-6) {
      imi.phase = 'idle';
      this.setTurn('✓ Bravo', 'done');
      this.later(() => this.playing && this.imi === imi && this.imitateBegin(), 700);
    }
  }

  setTurn(text, cls) {
    const t = this.el.turn;
    t.textContent = text;
    t.className = 'imitate-turn ' + cls;
  }

  // ---------- mode Concert ----------
  async enterConcert() {
    this._concertDone = false;
    try {
      if (this.root.requestFullscreen && !document.fullscreenElement) await this.root.requestFullscreen({ navigationUI: 'hide' });
    } catch {}
    this.requestWakeLock();
    this.playing = true;
    this.el.play.textContent = '⏸ Pause';
    this.sessionStart = performance.now();
  }

  async requestWakeLock() {
    try {
      if (this.opts.mode === 'concert' && navigator.wakeLock && !this.wakeLock) {
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.wakeLock.addEventListener?.('release', () => (this.wakeLock = null));
      }
    } catch {}
  }

  exitConcert() {
    try {
      if (document.fullscreenElement === this.root) document.exitFullscreen?.();
    } catch {}
    try {
      this.wakeLock?.release?.();
    } catch {}
    this.wakeLock = null;
    this.el.concertEnd.classList.add('hidden');
  }

  concertInput(midi, source, velocity, perfT) {
    if (!this.follower || this._concertDone) return;
    if (!this.playing) this.start(true);
    const t = this.wallSec(perfT) - this.latencyFor(source) / 1000;
    const idx = takeNoteOn(this.take, { midi, t, vel: velocity, src: source });
    const r = this.follower.push(midi, t);
    const tn = this.take.notes[idx];
    if (tn) {
      tn.judge = r.matched ? 'ok' : 'extra';
      if (r.matched) {
        tn.nb = r.beat;
        const ev = this.follower.events[r.index];
        const note = ev.notes.find((n) => n.midi === midi);
        if (note) {
          tn.noteId = note.id;
          tn.hand = note.hand;
        }
        addAnchor(this.take, t, r.beat);
      }
    }
    this.lastConcertInput = performance.now();
  }

  finishConcert() {
    if (!this.follower || this._concertDone) return;
    this._concertDone = true;
    this.playing = false;
    this.el.play.textContent = '▶ Rejouer';
    const durationSec = (performance.now() - this.sessionStart) / 1000;
    closeTake(this.take, this.wallSec());
    const cov = this.follower.coverage();
    const st = this.follower.stats;
    const score = Math.round(cov * 100);
    const stars = score >= 95 ? 3 : score >= 80 ? 2 : score >= 60 ? 1 : 0;
    this.saveCurrentTake();
    if (!this.baseSong.ephemeral && st.played) this.recordSafe({ score, stars, mode: 'concert', hands: this.opts.hands, tempoPct: this.opts.tempoPct, durationSec, conditions: { mode: 'concert', hands: this.opts.hands, tempoPct: this.opts.tempoPct } });
    const box = this.el.concertEnd;
    box.innerHTML = '';
    const mm = Math.floor(durationSec / 60), ss = String(Math.round(durationSec % 60)).padStart(2, '0');
    box.append(
      h('p', {}, `Fin du concert · ${mm}:${ss} · ${score} % des notes reconnues · ${st.extra} note${st.extra > 1 ? 's' : ''} en plus`),
      h('div', { class: 'row' }, [
        h('button', { class: 'btn tiny', onclick: () => this.openReview(false) }, '🎧 Réécouter'),
        h('button', { class: 'btn tiny', onclick: () => this.openDetailedReport(this.engine.summary()) }, '📊 Rapport'),
        h('button', { class: 'btn tiny', onclick: () => this.exportTake() }, '⬇ .mid'),
        h('button', { class: 'btn tiny', onclick: () => box.classList.add('hidden') }, 'Fermer'),
      ]));
    box.classList.remove('hidden');
  }

  // ---------- boucle d'affichage ----------
  frame() {
    if (this.destroyed) return;
    const o = this.opts;
    if (this.review) {
      this.reviewFrame();
    } else if (o.mode === 'concert') {
      if (this.follower && this.playing) {
        this.beat = this.follower.beatAt(this.wallSec());
        if (this.follower.finished && performance.now() - (this.lastConcertInput || 0) > 2500) this.finishConcert();
      }
    } else if (this.playing && this._clock) {
      this.beat = this.clockBeat();
      if (o.mode === 'tempo') {
        const missed = this.engine.tick(this.songTime());
        if (missed.length) {
          missed.forEach((n) => this.markNote(n.id, 'miss'));
          this.say(this.kid ? pick(KID_OOPS) : `Raté : ${missed.map((n) => noteLabel(n.midi, this.settings)).join(', ')}`, 'bad', { quiet: true });
          this.updateStats();
        }
        if (this.engine.finished) this.finish();
      } else if (o.mode === 'listen' && this.beat > this.to + 0.5) this.finish();
    } else if (this.waitLike) {
      const target = this.engine.current ? this.engine.current.start : this.to;
      this.beat += (target - this.beat) * 0.18;
      if (Math.abs(target - this.beat) < 0.001) this.beat = target;
    }
    this.render();
    this.raf = requestAnimationFrame(() => this.frame());
  }

  render() {
    const o = this.opts;
    const beat = this.beat;
    const marks = new Map();
    const current = new Set();
    const fingers = this.showFingers;
    const hiddenNow = o.mode === 'memory' && this.hidden.has(measureOf(this.song, beat + 1e-3));
    const listenPhase = this.imi && this.imi.phase === 'listen';
    if (this.review) {
      // pas de marques pendant la revue
    } else if (o.mode === 'concert') {
      // partition seule
    } else if (this.waitLike && !listenPhase && this.engine.current) {
      for (const n of this.engine.current.notes) {
        if (this.engine.satisfied.has(n.midi)) continue;
        current.add(n.id);
        if (!hiddenNow) marks.set(n.midi, { cls: 'expect-' + n.hand, finger: fingers ? n.finger : null });
      }
      const next = this.engine.events[this.engine.index + 1];
      if (next && o.mode !== 'memory') for (const n of next.notes) if (!marks.has(n.midi)) marks.set(n.midi, { cls: 'expect-next', finger: null });
    } else {
      for (const n of this.song.notes) {
        if (n.start > beat + 0.05) break;
        if (n.start + n.dur > beat && n.start >= this.from - 1e-6 && n.start < (listenPhase ? this.clockTo : this.to)) {
          if ((o.mode === 'tempo' || listenPhase) && o.hands !== 'both' && n.hand !== o.hands) continue;
          marks.set(n.midi, { cls: 'expect-' + n.hand, finger: fingers || listenPhase ? n.finger : null });
          current.add(n.id);
        }
      }
    }
    const sig = [...marks].map(([m, v]) => m + v.cls + v.finger).join();
    if (sig !== this._markSig) {
      this.keyboard.setMarks(marks);
      this._markSig = sig;
    }
    if (this.viewNow !== 'staff') this.roll.draw(beat, { beatsPerMeasure: this.song.beatsPerMeasure, activeHands: o.hands, current });
    if (this.viewNow !== 'roll') this.renderStaff(beat, current);
  }

  renderStaff(beat, current) {
    const bpm = this.song.beatsPerMeasure;
    const width = this.el.staffWrap.clientWidth || 800;
    const concert = this.opts.mode === 'concert';
    const mpp = measuresPerPage(concert ? Math.min(width, 1400) / 1.6 : width, bpm);
    const m = Math.max(0, measureOf(this.song, Math.max(0, beat + 1e-3)));
    // concert : la page se tourne une mesure avant la fin
    const page = concert && mpp > 1 ? Math.floor((m + 1) / mpp) : Math.floor(m / mpp);
    const hiddenKey = [...this.hidden].join('.');
    const key = [page, width, this.opts.hands, hiddenKey, this.showFingers, this.showNames, this.opts.mode].join(':');
    if (key !== this.staffPage) {
      this.staffPage = key;
      const from = page * mpp * bpm, to = (page + 1) * mpp * bpm;
      const hiddenMeasures = this.opts.mode === 'memory' ? [...this.hidden] : [];
      // masques dessinés ici (indépendants du format de `hiddenMeasures` de la portée)
      this.staff.render(this.song, from, to, {
        settings: this.settings, showFingers: this.showFingers, showNoteNames: this.showNames, activeHands: this.opts.hands,
        onNoteClick: (x) => this.onStaffNoteClick(x && typeof x === 'object' ? x.id : x),
      });
      // masques « par cœur » (fonctionne aussi si la portée ne gère pas hiddenMeasures)
      if (hiddenMeasures.length && this.staff.xOf && this.staff.svg) {
        const NS = 'http://www.w3.org/2000/svg';
        for (const hm of hiddenMeasures) {
          const a = hm * bpm, b = (hm + 1) * bpm;
          if (b <= from + 1e-6 || a >= to - 1e-6) continue;
          const r = document.createElementNS(NS, 'rect');
          const x0 = this.staff.xOf(Math.max(a, from)) - 10, x1 = this.staff.xOf(Math.min(b, to)) - 10;
          r.setAttribute('x', x0);
          r.setAttribute('y', 0);
          r.setAttribute('width', Math.max(0, x1 - x0));
          r.setAttribute('height', '100%');
          r.setAttribute('class', 'memo-mask');
          const t = document.createElementNS(NS, 'text');
          t.setAttribute('x', (x0 + x1) / 2);
          t.setAttribute('y', 110);
          t.setAttribute('class', 'memo-mask-label');
          t.textContent = '🧠';
          const cursor = this.staff.cursor;
          this.staff.svg.insertBefore(r, cursor || null);
          this.staff.svg.insertBefore(t, cursor || null);
        }
      }
      for (const [id, st] of this.roll.state) this.staff.mark(id, st);
    }
    this.staff.clearMarks('current');
    if (this.opts.mode !== 'concert') for (const id of current) if (!this.roll.state.get(id)) this.staff.mark(id, 'current');
    this.staff.setCursor(beat);
  }

  /** Clic sur une note de la portée : se placer sur sa mesure (si la portée le permet). */
  onStaffNoteClick(id) {
    const n = this.song.notes.find((x) => x.id === id);
    if (!n || this.opts.mode === 'concert') return;
    synth.playNote(n.midi, { dur: 0.6, velocity: 0.6, instrument: this.settings.instrument });
    if (!this.playing && this.waitLike) {
      this.engine.seek(n.start);
      this.beat = n.start;
    }
  }

  // ---------- fin de séance ----------
  recordSafe(rec) {
    try {
      return store.recordSession(this.baseSong.id || 'exercice', rec);
    } catch {
      return null;
    }
  }

  saveCurrentTake() {
    if (this.baseSong.ephemeral || !this.take?.notes.length) return;
    saveTake(this.baseSong.id || 'exercice', this.take);
  }

  finish() {
    if (this._finishing) return;
    if (!this.playing && this.engine.finished && this._finishedShown) return;
    this._finishing = true;
    try {
      this._finish();
    } finally {
      this._finishing = false;
    }
  }

  _finish() {
    this.playing = false;
    this.pauseClock();
    clearTimeout(this.imi?.timer);
    this.el.turn.classList.add('hidden');
    this.el.play.textContent = '▶ Rejouer';
    this.el.play.classList.remove('on');
    if (this.opts.mode === 'listen') {
      this.say('Fin de l\'écoute. À toi de jouer ! Passe en mode Attente ou Tempo.');
      this.beat = this.from;
      return;
    }
    const s = this.engine.summary();
    const durationSec = (performance.now() - this.sessionStart) / 1000;
    // prise : fermer, ancrer la partition (mode tempo), sauvegarder
    const tEnd = this.opts.mode === 'tempo' ? this.engine.timeOf(this.to) + 0.5 : this.wallSec();
    closeTake(this.take, tEnd);
    if (this.opts.mode === 'tempo') {
      this.take.anchors = [];
      const step = this.engine.timeline.variable ? 1 : Math.max(1, this.to - this.from);
      for (let b = this.from; b < this.to + 1e-6; b += step) addAnchor(this.take, this.engine.timeOf(b), b);
      addAnchor(this.take, this.engine.timeOf(this.to), this.to);
    } else if (this.engine.events.length) {
      const last = this.engine.events[this.engine.events.length - 1];
      addAnchor(this.take, tEnd, last.start + last.dur);
    }
    this.saveCurrentTake();
    this.lastSummary = s;
    const rec = {
      score: s.score, stars: s.stars, mode: this.opts.mode, hands: this.opts.hands, tempoPct: this.opts.tempoPct, durationSec, bestStreak: s.bestStreak,
      worstMeasures: s.worstMeasures, errorsByMeasure: s.errorsByMeasure, errorsByNote: s.errorsByNote,
      conditions: { mode: this.opts.mode, hands: this.opts.hands, tempoPct: this.opts.tempoPct, rhythmOnly: !!this.opts.rhythmOnly, variant: this.opts.variant || null },
      from: this.from, to: this.to, songHands: this.baseSong.hands, twoHanded: !!(this.baseSong.hands.R && this.baseSong.hands.L),
    };
    if (!this.baseSong.ephemeral) this.recordSafe(rec);
    this.hooks.onResult?.(s, rec);
    if (s.stars >= 2) synth.feedbackSound('success');
    if (this.kid && s.stars >= 2) confetti();

    // aide qui s'estompe : 3 réussites d'affilée
    this.successRuns = s.score >= 90 ? this.successRuns + 1 : 0;
    if (this.opts.fadeHelp && !this.helpFaded && this.successRuns >= 3) {
      this.helpFaded = true;
      this.applyHelp();
      toast('3 réussites d’affilée : on retire les noms de notes et les doigtés !');
    } else if (this.helpFaded && s.score < 80) {
      this.helpFaded = false;
      this.successRuns = 0;
      this.applyHelp();
      toast('On remet l’aide pour l’instant.');
    }
    // par cœur : masquer de nouvelles mesures
    let memoMsg = '';
    if (this.opts.mode === 'memory' && s.score >= 90) memoMsg = this.hideMoreMeasures();
    // défi « 3 fois juste d'affilée »
    if (this.challenge) {
      const r = this.challenge.record(s.score);
      if (r.done) {
        toast(`🏆 Défi réussi : 3 fois juste d’affilée !`, 4000);
        if (this.kid) confetti();
        this.challenge = null;
        this.setOpt('loop', false);
      } else {
        toast(r.ok ? `Défi : ${r.count}/3 ✓` : `Défi : on repart de 0/3 (${s.score} %)`);
        this.resetEngine();
        this.later(() => this.start(), 900);
        return;
      }
    } else if (this.opts.loop && this.opts.autoRepeat !== false) {
      let msg = `Passage terminé : ${s.score} % ${'★'.repeat(s.stars)}`;
      if (this.opts.progressive && s.score >= 90 && this.opts.tempoPct < 100) {
        this.setOpt('tempoPct', Math.min(100, this.opts.tempoPct + 5));
        msg += ` — tempo augmenté à ${this.opts.tempoPct} %`;
      }
      toast(msg + (memoMsg ? ' — ' + memoMsg : ''));
      this.resetEngine();
      this.later(() => this.start(), 900);
      return;
    }
    if (memoMsg) toast(memoMsg, 3500);
    this.showResults(s);
  }

  hideMoreMeasures() {
    const bpm = this.song.beatsPerMeasure;
    const ms = [];
    for (let m = Math.floor(this.from / bpm); m * bpm < this.to - 1e-6; m++) ms.push(m);
    const remaining = ms.filter((m) => !this.hidden.has(m));
    if (!remaining.length) return 'Tout est par cœur : bravo !';
    const n = Math.max(1, Math.ceil(ms.length / 4));
    // ordre réparti : on masque des mesures espacées
    remaining.sort((a, b) => ((a * 7) % 11) - ((b * 7) % 11));
    remaining.slice(0, n).forEach((m) => this.hidden.add(m));
    this.staffPage = null;
    return `${this.hidden.size}/${ms.length} mesures masquées : joue-les de mémoire !`;
  }

  /** Statut de chaque note pour la revue des erreurs. */
  noteStatus() {
    const st = new Map();
    if (this.opts.mode === 'tempo') {
      for (const [id, g] of this.engine.judged) if (g !== 'skip') st.set(id, g === 'miss' ? 'miss' : 'hit');
    } else {
      this.engine.events.forEach((ev, i) => {
        if (i >= this.engine.index) return;
        for (const n of ev.notes) st.set(n.id, this.waitErrEvents.has(ev.index) ? 'miss' : 'hit');
      });
    }
    return st;
  }

  showResults(s) {
    const stars = '★'.repeat(s.stars) + '☆'.repeat(3 - s.stars);
    const kidMsg = s.stars >= 2 ? 'Tu es un(e) champion(ne) ! 🎉' : 'Bien essayé ! On recommence ensemble ? 💪';
    const msg = this.kid ? kidMsg : s.stars === 3 ? 'Magnifique ! 🎉' : s.stars === 2 ? 'Très bien, continue !' : s.stars === 1 ? 'Pas mal, encore un peu de travail.' : 'Courage ! Ralentis le tempo et travaille mains séparées.';
    const worst = s.worstMeasures.length
      ? `<p>Mesures à retravailler : ${s.worstMeasures.map((w) => `<button class="btn tiny" data-measure="${w.measure}">mesure ${w.measure} (${w.errors})</button>`).join(' ')}</p>`
      : '';
    const timing = this.opts.mode === 'tempo' ? `<p>Rythme : <b>${s.tendency}</b> (${Math.round(s.avgTiming * 1000)} ms en moyenne) · Parfait ${s.perfect} · Bien ${s.good} · OK ${s.ok} · Ratées ${s.misses}</p>` : '';
    const holds = s.holds.length ? `<p class="small">Durées : ${s.holds.length - s.holdsShort - s.holdsLong}/${s.holds.length} bien tenues${s.holdsShort ? ` · ${s.holdsShort} relâchées trop tôt` : ''}${s.holdsLong ? ` · ${s.holdsLong} tenues trop longtemps` : ''}</p>` : '';
    const chords = s.chordIssues.length ? `<p class="small">Accords pas plaqués ensemble : ${s.chordIssues.length}</p>` : '';
    const hasTake = this.take.notes.length > 0;
    const hasErr = Object.keys(s.errorsByMeasure).length > 0;
    const dlg = modal('Résultat', `
      <div class="result"><div class="stars" aria-label="${s.stars} étoiles sur 3">${stars}</div>
      <div class="big-score">${s.score} %</div><p>${msg}</p>
      <p>${s.hits} justes · ${s.wrong} fausses · meilleure série ${s.bestStreak}</p>${timing}${holds}${chords}${worst}
      <div class="take-actions" role="group" aria-label="Ta prise">
        ${hasTake ? '<button class="btn small" data-act="replay">🎧 Réécouter ma prise</button><button class="btn small" data-act="compare">🎼 Ma prise + partition</button>' : ''}
        ${hasErr ? '<button class="btn small" data-act="errors">🔍 Revoir mes erreurs</button>' : ''}
        <button class="btn small" data-act="report">📊 Rapport détaillé</button>
        ${hasTake ? '<button class="btn small" data-act="midi">⬇ Exporter .mid</button>' : ''}
      </div></div>`,
    [
      { label: 'Rejouer', primary: true, action: () => this.restart() },
      ...(this.hooks.onNext ? [{ label: 'Étape suivante →', action: () => this.hooks.onNext() }] : []),
      { label: 'Fermer' },
    ]);
    dlg.querySelectorAll('[data-measure]').forEach((b) => b.addEventListener('click', () => {
      dlg.close();
      this.loopMeasure(Number(b.dataset.measure), true);
    }));
    const act = {
      replay: () => (dlg.close(), this.openReview(false)),
      compare: () => (dlg.close(), this.openReview(true)),
      errors: () => this.openErrorReview(s),
      report: () => this.openDetailedReport(s),
      midi: () => this.exportTake(),
    };
    dlg.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => act[b.dataset.act]?.()));
    this._finishedShown = true;
  }

  loopMeasure(m, slower = false) {
    this.el.loopFrom.value = m;
    this.el.loopTo.value = m;
    this.setOpt('loop', true);
    if (slower) this.setOpt('tempoPct', Math.max(40, this.opts.tempoPct - 20));
    this.updateLoop();
    toast(`Boucle sur la mesure ${m}${slower ? ', tempo réduit' : ''}.`);
  }

  /** Défi : 3 fois juste d'affilée sur une mesure. */
  startChallenge(m) {
    this.loopMeasure(m, false);
    this.challenge = createRepeatChallenge(3, 100);
    toast(`Défi : joue la mesure ${m} sans faute 3 fois d’affilée !`, 3500);
    this.start();
  }

  openDetailedReport(s) {
    const a = analyzeTake(this.take, this.song, { secOf: (b) => this.engine.timeOf(b) });
    showReport(a, s, { song: this.song, from: this.from, to: this.to, settings: this.settings, onRepeatMeasure: this.opts.mode === 'concert' ? null : (m) => this.startChallenge(m) });
  }

  openErrorReview(s) {
    const measures = Object.entries(s.errorsByMeasure).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([m]) => Number(m));
    const extras = this.take.notes.filter((n) => n.judge === 'wrong' || n.judge === 'extra').map((n) => ({ midi: n.midi, beat: n.nb ?? takeBeatAt(this.take, n.t0) }));
    showErrorReview({
      song: this.song, measures, status: this.noteStatus(), extras, settings: this.settings,
      onPlayCorrect: (from, to) => this.playScore(from, to),
      onPlayMine: (from, to) => this.playTakeRange(from, to),
    });
  }

  exportTake() {
    try {
      const data = exportMidi(takeToSong(this.take, this.song));
      const name = (this.baseSong.title || 'morceau').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
      download(`${name}-ma-prise.mid`, data, 'audio/midi');
    } catch (e) {
      toast('Export impossible : ' + (e.message || e));
    }
  }

  // ---------- relecture ----------
  /** Joue une liste [{t (s), midi, dur, vel}] avec un petit planificateur. */
  playList(items, { onEnd } = {}) {
    this.stopList();
    const ac = synth.audioContext();
    const list = [...items].sort((a, b) => a.t - b.t);
    if (!list.length) return;
    const t0 = list[0].t;
    const base = ac.currentTime + 0.12 - t0;
    let i = 0;
    const tick = () => {
      const now = ac.currentTime;
      while (i < list.length && base + list[i].t < now + 0.3) {
        const it = list[i++];
        const when = base + it.t;
        this.trackVoice(synth.playNote(it.midi, { when, dur: Math.max(0.08, it.dur), velocity: it.vel ?? 0.7, instrument: it.instrument || this.settings.instrument, a4: this.settings.a4 }), when);
      }
      if (i >= list.length) {
        clearInterval(this.listTimer);
        this.listTimer = null;
        const last = list[list.length - 1];
        if (onEnd) this.later(onEnd, Math.max(0, (base + last.t + last.dur - ac.currentTime) * 1000));
      }
    };
    this.listTimer = setInterval(tick, 30);
    tick();
    return base;
  }

  stopList() {
    clearInterval(this.listTimer);
    this.listTimer = null;
    this.cancelFutureVoices();
    synth.stopAll();
  }

  playScore(from, to) {
    const items = this.song.notes.filter((n) => n.start >= from - 1e-6 && n.start < to - 1e-6 && (this.opts.hands === 'both' || n.hand === this.opts.hands))
      .map((n) => ({ t: this.engine.timeOf(n.start), midi: n.midi, dur: this.engine.timeOf(n.start + n.dur) - this.engine.timeOf(n.start), vel: 0.7 }));
    this.playList(items);
  }

  playTakeRange(from, to) {
    const items = this.take.notes.filter((n) => {
      const b = n.nb ?? takeBeatAt(this.take, n.t0);
      return b >= from - 0.25 && b < to;
    }).map((n) => ({ t: n.t0, midi: n.midi, dur: (n.t1 ?? n.t0 + 0.4) - n.t0, vel: n.vel }));
    if (!items.length) return toast('Rien n’a été joué dans ces mesures.');
    this.playList(items);
  }

  /** Superposition de la prise dans les notes qui tombent + barre de défilement. */
  openReview(withScore) {
    if (!this.take.notes.length) return toast('Ta prise est vide.');
    this.stopPlayback();
    this.review = { withScore, playing: false, beat: this.from };
    this.roll.overlay = takeOverlay(this.take);
    this.applyView();
    const bar = this.el.review;
    bar.innerHTML = '';
    const lo = Math.min(this.from, ...this.roll.overlay.map((n) => n.start));
    const hi = Math.max(this.to, ...this.roll.overlay.map((n) => n.start + n.dur));
    this.review.lo = lo;
    this.review.hi = hi;
    this.review.btn = h('button', { class: 'btn small primary', onclick: () => (this.review.playing ? this.reviewPause() : this.reviewPlay()) }, '▶ Écouter');
    this.review.scrub = h('input', { type: 'range', min: lo, max: hi, step: 0.05, value: lo, class: 'review-scrub', 'aria-label': 'Position dans la prise', oninput: (e) => this.reviewSeek(Number(e.target.value)) });
    this.review.withScoreBox = h('input', { type: 'checkbox', checked: withScore, onchange: (e) => {
      this.review.withScore = e.target.checked;
      if (this.review.playing) this.reviewPlay();
    } });
    bar.append(
      h('span', { class: 'review-title' }, withScore ? '🎼 Ma prise + partition' : '🎧 Ma prise'),
      this.review.btn, this.review.scrub,
      h('label', { class: 'check' }, [this.review.withScoreBox, 'Partition aussi']),
      h('span', { class: 'review-legend small' }, [h('i', { class: 'lg ok' }), 'juste ', h('i', { class: 'lg off' }), 'tôt/tard ', h('i', { class: 'lg bad' }), 'en trop']),
      h('button', { class: 'btn tiny', onclick: () => this.closeReview() }, '✕ Fermer'));
    bar.classList.remove('hidden');
    this.beat = lo;
    this.reviewPlay();
  }

  reviewPlay() {
    const r = this.review;
    if (!r) return;
    const startT = takeTimeAt(this.take, r.beat);
    const items = this.take.notes.filter((n) => n.t0 >= startT - 0.01).map((n) => ({ t: n.t0, midi: n.midi, dur: (n.t1 ?? n.t0 + 0.4) - n.t0, vel: n.vel }));
    if (r.withScore) {
      for (const n of this.song.notes) {
        if (n.start < Math.max(this.from, r.beat) - 1e-6 || n.start >= this.to - 1e-6) continue;
        if (this.opts.hands !== 'both' && n.hand !== this.opts.hands) continue;
        const t = takeTimeAt(this.take, n.start);
        items.push({ t, midi: n.midi, dur: Math.max(0.1, takeTimeAt(this.take, n.start + n.dur) - t), vel: 0.35, instrument: 'epiano' });
      }
    }
    if (!items.length) return;
    // temps de la prise à l'instant audio a : a - base
    r.base = this.playList(items, { onEnd: () => this.reviewPause(true) });
    r.startT = startT;
    r.playing = true;
    r.btn.textContent = '⏸ Pause';
  }

  reviewPause(ended = false) {
    const r = this.review;
    if (!r) return;
    this.stopList();
    r.playing = false;
    r.btn.textContent = '▶ Écouter';
    if (ended === true) r.beat = r.lo;
  }

  reviewSeek(beat) {
    const r = this.review;
    if (!r) return;
    const was = r.playing;
    if (was) this.reviewPause();
    r.beat = beat;
    this.beat = beat;
    if (was) this.reviewPlay();
  }

  reviewFrame() {
    const r = this.review;
    if (r.playing && r.base != null) {
      const t = synth.audioContext().currentTime - r.base;
      r.beat = Math.min(r.hi, takeBeatAt(this.take, Math.max(t, r.startT)));
      r.scrub.value = r.beat;
    }
    this.beat = r.beat;
  }

  closeReview() {
    if (!this.review) return;
    this.stopList();
    this.review = null;
    this.roll.overlay = null;
    this.el.review.classList.add('hidden');
    this.el.review.innerHTML = '';
    this.beat = this.waitLike && this.engine.current ? this.engine.current.start : this.from;
    this.applyView();
  }

  destroy() {
    this.destroyed = true;
    this.pause();
    this.stopList();
    cancelAnimationFrame(this.raf);
    clearInterval(this.scheduler);
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
    this.unsub.forEach((f) => f());
    window.removeEventListener('keydown', this._keys);
    document.removeEventListener('visibilitychange', this._vis);
    document.removeEventListener('fullscreenchange', this._fs);
    this.exitConcert();
    this.roll.destroy();
    synth.setSustain(false);
    for (const m of this.held) synth.releaseNote(m, true);
  }
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
