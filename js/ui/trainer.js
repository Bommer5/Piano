// Écran d'entraînement : portée + notes qui tombent + clavier, écoute micro / MIDI / clavier / souris.
import { PracticeEngine } from '../core/practice.js';
import { measureOf, transposeSong } from '../core/song.js';
import { matchChord } from '../core/spectrum.js';
import { noteLabel, FINGER_NAMES } from '../core/notes.js';
import * as synth from '../audio/synth.js';
import { mic } from '../audio/mic.js';
import { midiInput, computerKeyboard } from '../audio/midi-input.js';
import { PianoKeyboard, rangeForSong } from './keyboard.js';
import { NoteRoll } from './roll.js';
import { StaffView, measuresPerPage } from './staff.js';
import { store } from '../core/storage.js';
import { h, toast, modal, escapeHtml } from './dom.js';

const MODES = [
  ['wait', 'Attente', 'La partition attend la bonne note'],
  ['tempo', 'Tempo', 'La partition défile en rythme'],
  ['listen', 'Écoute', "L'app joue le morceau pour toi"],
];

export class Trainer {
  /**
   * @param {HTMLElement} root
   * @param {object} song morceau préparé
   * @param {object} opts {mode, hands, tempoPct, from, to, title}
   * @param {object} hooks {onExit, onNext}
   */
  constructor(root, song, opts = {}, hooks = {}) {
    this.root = root;
    this.baseSong = song;
    this.hooks = hooks;
    this.settings = store.settings();
    this.opts = {
      mode: 'wait', hands: song.hands.R ? (song.hands.L ? 'both' : 'R') : 'L', tempoPct: 100, transpose: 0,
      loop: false, from: 0, to: song.totalBeats, metronome: this.settings.metronome, accompany: true, autoRepeat: false,
      progressive: false, view: this.settings.view, hint: true, ...opts,
    };
    this.playing = false;
    this.beat = this.opts.from;
    this.held = new Set();
    this.unsub = [];
    this.wrongOnEvent = 0;
    this.build();
    this.loadSong();
    this.bindInputs();
    this.raf = requestAnimationFrame(() => this.frame());
  }

  // ---------- construction de l'interface ----------
  build() {
    const o = this.opts;
    this.root.innerHTML = '';
    this.root.classList.add('trainer');
    const s = this.baseSong;
    this.el = {};
    const modeSeg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Mode' },
      MODES.map(([id, label, tip]) => h('button', { class: 'seg-btn' + (o.mode === id ? ' on' : ''), title: tip, 'data-mode': id, onclick: () => this.setOpt('mode', id) }, label)));
    const handSeg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Mains' },
      [['R', 'Main droite'], ['L', 'Main gauche'], ['both', '2 mains']].map(([id, label]) =>
        h('button', { class: 'seg-btn' + (o.hands === id ? ' on' : ''), 'data-hands': id, disabled: (id === 'R' && !s.hands.R) || (id === 'L' && !s.hands.L) || (id === 'both' && !(s.hands.R && s.hands.L)), onclick: () => this.setOpt('hands', id) }, label)));

    this.el.play = h('button', { class: 'btn primary big', onclick: () => (this.playing ? this.pause() : this.start()), title: 'Démarrer / pause (Espace)' }, '▶ Démarrer');
    this.el.restart = h('button', { class: 'btn', onclick: () => this.restart(), title: 'Recommencer (R)' }, '⟲');
    this.el.tempo = h('input', { type: 'range', min: 25, max: 150, step: 5, value: o.tempoPct, oninput: (e) => this.setOpt('tempoPct', Number(e.target.value)) });
    this.el.tempoLabel = h('span', { class: 'mono' });
    this.el.transpose = h('span', { class: 'mono' }, '0');
    this.el.mic = h('button', { class: 'btn', onclick: () => this.toggleMic(), title: 'Écouter ton piano avec le micro' }, '🎤 Micro');
    this.el.midiStatus = h('span', { class: 'chip muted', title: 'Clavier MIDI' }, 'MIDI : —');
    const mCount = s.measureCount;
    this.el.loopFrom = h('input', { type: 'number', min: 1, max: mCount, value: Math.floor(o.from / s.beatsPerMeasure) + 1, class: 'num', onchange: () => this.updateLoop() });
    this.el.loopTo = h('input', { type: 'number', min: 1, max: mCount, value: Math.ceil(o.to / s.beatsPerMeasure - 1e-6), class: 'num', onchange: () => this.updateLoop() });
    const check = (key, label, title) => h('label', { class: 'check', title }, [h('input', { type: 'checkbox', checked: !!o[key], onchange: (e) => this.setOpt(key, e.target.checked) }), label]);

    this.el.viewSel = h('select', { onchange: (e) => this.setOpt('view', e.target.value), 'aria-label': 'Affichage' }, [
      h('option', { value: 'both', selected: o.view === 'both' }, 'Portée + notes'),
      h('option', { value: 'staff', selected: o.view === 'staff' }, 'Portée'),
      h('option', { value: 'roll', selected: o.view === 'roll' }, 'Notes qui tombent'),
    ]);

    const controls = h('div', { class: 'controls' }, [
      h('div', { class: 'row' }, [this.el.play, this.el.restart, modeSeg, handSeg, this.el.mic, this.el.midiStatus]),
      h('div', { class: 'row small' }, [
        h('label', { class: 'field' }, ['Tempo ', this.el.tempo, this.el.tempoLabel]),
        h('span', { class: 'field' }, ['Transposer ', h('button', { class: 'btn tiny', onclick: () => this.setOpt('transpose', o.transpose - 1) }, '−'), this.el.transpose, h('button', { class: 'btn tiny', onclick: () => this.setOpt('transpose', o.transpose + 1) }, '+')]),
        h('span', { class: 'field' }, ['Mesures ', this.el.loopFrom, ' à ', this.el.loopTo]),
        check('loop', 'Boucle', 'Répéter le passage choisi'),
        check('progressive', 'Tempo progressif', 'Accélère de 5 % à chaque passage réussi (≥ 90 %)'),
        check('metronome', 'Métronome', 'Clic de métronome'),
        check('accompany', 'Jouer l\'autre main', "L'app joue la main que tu ne travailles pas (utilise un casque avec le micro)"),
        check('hint', 'Aide', 'Rejoue la note attendue après 3 erreurs'),
        this.el.viewSel,
      ]),
    ]);

    this.el.feedback = h('div', { class: 'feedback', 'aria-live': 'polite' }, 'Prêt ? Appuie sur Démarrer, puis joue !');
    this.el.score = h('div', { class: 'stat' }, [h('b', {}, '0'), h('small', {}, 'notes justes')]);
    this.el.streak = h('div', { class: 'stat' }, [h('b', {}, '0'), h('small', {}, 'série')]);
    this.el.acc = h('div', { class: 'stat' }, [h('b', {}, '–'), h('small', {}, 'précision')]);
    this.el.detected = h('div', { class: 'detected' }, [h('div', { class: 'det-note' }, '—'), h('div', { class: 'cents' }, [h('div', { class: 'needle' })]), h('div', { class: 'level' }, [h('div', { class: 'bar' })])]);
    this.el.progress = h('div', { class: 'progress' }, h('div', { class: 'fill' }));
    const hud = h('div', { class: 'hud' }, [this.el.feedback, h('div', { class: 'stats' }, [this.el.score, this.el.streak, this.el.acc]), this.el.detected]);

    this.el.staffWrap = h('div', { class: 'staff-wrap' });
    this.el.canvas = h('canvas', { class: 'roll' });
    this.el.rollWrap = h('div', { class: 'roll-wrap' }, this.el.canvas);
    this.el.kb = h('div', { class: 'kb' });
    this.el.countdown = h('div', { class: 'countdown hidden' });
    const stage = h('div', { class: 'stage' }, [this.el.staffWrap, this.el.rollWrap, this.el.kb, this.el.countdown]);
    this.root.append(controls, this.el.progress, hud, stage,
      h('p', { class: 'hint-line' }, [
        'Astuce : clavier d\'ordinateur = piano (rangée ', h('kbd', {}, computerKeyboard.label('KeyA')), '…', h('kbd', {}, computerKeyboard.label('KeyL')),
        ', touches noires au-dessus, ', h('kbd', {}, computerKeyboard.label('KeyZ') || 'Z'), '/', h('kbd', {}, 'X'), ' = octave). ', h('kbd', {}, 'Espace'), ' démarrer/pause, ', h('kbd', {}, 'R'), ' recommencer.',
      ]));

    this.keyboard = new PianoKeyboard(this.el.kb, {
      onNoteOn: (m) => this.noteOn(m, 'mouse', 0.8),
      onNoteOff: (m) => this.noteOff(m),
      label: (m) => this.keyLabel(m),
    });
    this.roll = new NoteRoll(this.el.canvas, this.keyboard);
    this.staff = new StaffView(this.el.staffWrap);
    this.applyView();
  }

  keyLabel(m) {
    if (this.settings.showKeyboardLabels) {
      const k = computerKeyboard.labelFor(m);
      if (k) return k;
    }
    if (this.settings.showNoteNames && (m % 12 === 0 || this.settings.showNoteNames === 'all')) return noteLabel(m, this.settings);
    return m === 60 ? noteLabel(m, this.settings) : null;
  }

  applyView() {
    const v = this.opts.view;
    this.el.staffWrap.classList.toggle('hidden', v === 'roll');
    this.el.rollWrap.classList.toggle('hidden', v === 'staff');
    requestAnimationFrame(() => {
      this.roll.resize();
      this.staffPage = null;
    });
  }

  loadSong() {
    const o = this.opts;
    this.song = transposeSong(this.baseSong, o.transpose);
    this.el.transpose.textContent = (o.transpose > 0 ? '+' : '') + o.transpose;
    const r = rangeForSong(this.song);
    this.keyboard.setRange(r.lo, r.hi);
    this.roll.setNotes(this.song.notes);
    this.roll.showFingers = this.settings.showFingers;
    this.roll.labels = this.settings.showNoteNames ? (m) => noteLabel(m, { ...this.settings, octave: false }) : null;
    this.staffPage = null;
    this.updateTempoLabel();
    this.resetEngine();
  }

  updateTempoLabel() {
    const bpm = Math.round((this.song.tempo * this.opts.tempoPct) / 100);
    this.el.tempoLabel.textContent = ` ${this.opts.tempoPct} % (${bpm} BPM)`;
    this.el.tempo.value = this.opts.tempoPct;
  }

  range() {
    const o = this.opts;
    const bpm = this.song.beatsPerMeasure;
    const a = Math.max(1, Math.min(this.song.measureCount, Number(this.el.loopFrom.value) || 1));
    const b = Math.max(a, Math.min(this.song.measureCount, Number(this.el.loopTo.value) || this.song.measureCount));
    return { from: (a - 1) * bpm, to: Math.min(b * bpm, this.song.totalBeats + 1e-6), fullFrom: o.from, fullTo: o.to };
  }

  updateLoop() {
    this.stopPlayback();
    this.resetEngine();
  }

  resetEngine() {
    const o = this.opts;
    const { from, to } = this.range();
    this.from = from;
    this.to = to;
    this.engine = new PracticeEngine(this.song, {
      mode: o.mode === 'tempo' ? 'tempo' : 'wait', hands: o.hands, from, to,
      octaveTolerant: this.settings.octaveTolerant && mic.running, tempo: (this.song.tempo * o.tempoPct) / 100,
    });
    this.beat = from;
    this.roll.state.clear();
    this.roll.loop = o.loop ? { from, to } : null;
    this.staffPage = null;
    this.wrongOnEvent = 0;
    this.sessionStart = performance.now();
    this.updateStats();
  }

  setOpt(key, value) {
    const o = this.opts;
    o[key] = value;
    if (key === 'transpose') {
      o.transpose = Math.max(-12, Math.min(12, value));
      this.stopPlayback();
      this.loadSong();
    } else if (key === 'mode' || key === 'hands') {
      this.stopPlayback();
      this.root.querySelectorAll(`[data-${key}]`).forEach((b) => b.classList.toggle('on', b.dataset[key] === value));
      this.resetEngine();
    } else if (key === 'tempoPct') {
      this.updateTempoLabel();
      if (this.playing && o.mode !== 'wait') {
        // garder la position actuelle
        const b = this.beat;
        this.engine.opts.tempo = (this.song.tempo * value) / 100;
        this.startClock(b);
      } else this.engine.opts.tempo = (this.song.tempo * value) / 100;
    } else if (key === 'view') {
      this.settings.view = value;
      store.saveSettings(this.settings);
      this.applyView();
    } else if (key === 'loop') {
      this.roll.loop = value ? { from: this.from, to: this.to } : null;
    } else if (key === 'metronome') {
      this.settings.metronome = value;
      store.saveSettings(this.settings);
    }
  }

  // ---------- entrées ----------
  bindInputs() {
    const onEvent = (e) => {
      if (e.type === 'noteon') this.noteOn(e.midi, e.source, e.velocity);
      else if (e.type === 'noteoff') this.noteOff(e.midi);
    };
    this.unsub.push(midiInput.on((e) => {
      if (e.type === 'devices') this.updateMidiStatus();
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
    this._keys = (e) => {
      if (computerKeyboard.isTyping(e)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        this.playing ? this.pause() : this.start();
      } else if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey) this.restart();
      else if (e.code === 'Escape') this.pause();
    };
    window.addEventListener('keydown', this._keys);
    // Pause automatique quand on quitte l'onglet (sinon le mode Tempo continue et fausse le score)
    this._vis = () => document.hidden && this.playing && this.opts.mode !== 'wait' && this.pause();
    document.addEventListener('visibilitychange', this._vis);
  }

  updateMidiStatus() {
    const d = midiInput.devices;
    if (!midiInput.supported) {
      this.el.midiStatus.textContent = 'MIDI : non supporté';
      this.el.midiStatus.title = 'Utilise Chrome ou Edge pour brancher un clavier MIDI';
    } else {
      this.el.midiStatus.textContent = d.length ? `🎹 ${d[0]}` : 'MIDI : aucun clavier';
      this.el.midiStatus.classList.toggle('muted', !d.length);
    }
  }

  async toggleMic() {
    try {
      if (mic.running) mic.stop();
      else {
        mic.a4 = this.settings.a4;
        mic.setSensitivity(this.settings.micSensitivity);
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
      if (e.attack) this.lastAttack = e.t;
      this.checkChordFromSpectrum(e.t);
      return;
    }
    if (e.type === 'onset') {
      if (this.opts.mode === 'listen') return;
      this.evaluate(e.midi, 'mic');
    }
  }

  showDetected(e) {
    const det = this.el.detected;
    det.querySelector('.det-note').textContent = e.midi != null && e.clarity > 0.7 ? noteLabel(e.midi, this.settings) : '—';
    const needle = det.querySelector('.needle');
    needle.style.transform = `translateX(${Math.max(-50, Math.min(50, e.cents || 0))}px)`;
    needle.classList.toggle('in-tune', Math.abs(e.cents) <= 10 && e.midi != null);
    det.querySelector('.bar').style.width = Math.min(100, e.rms * 600) + '%';
  }

  /** Accords au micro : on vérifie dans le spectre que toutes les notes attendues sonnent. */
  checkChordFromSpectrum(t) {
    if (!this.playing || this.opts.mode === 'listen' || !this.lastAttack || t - this.lastAttack > 500) return;
    let expected;
    if (this.opts.mode === 'wait') {
      const ev = this.engine.current;
      if (!ev || ev.midis.length < 2) return;
      expected = ev.midis.filter((m) => !this.engine.satisfied.has(m));
    } else {
      const near = this.engine.events.filter((ev) => Math.abs(ev.start - this.beat) < 0.3 && ev.midis.length > 1);
      expected = near.flatMap((ev) => ev.notes.filter((n) => !this.engine.judged.has(n.id)).map((n) => n.midi));
    }
    if (!expected.length) return;
    const mag = mic.spectrum();
    if (!mag) return;
    const res = matchChord(mag, mic.sampleRate, expected, { a4: this.settings.a4 });
    for (const m of res.present) this.evaluate(m, 'mic-chord');
  }

  noteOn(midi, source, velocity = 0.8) {
    synth.playNote(midi, { velocity, dur: 4, instrument: this.settings.instrument, a4: this.settings.a4 });
    this.held.add(midi);
    this.keyboard.press(midi);
    if (this.opts.mode !== 'listen') {
      if (!this.playing && this.opts.mode === 'wait' && !this.engine.finished) this.start(true);
      this.evaluate(midi, source);
    }
  }

  noteOff(midi) {
    synth.releaseNote(midi);
    this.held.delete(midi);
    this.keyboard.release(midi);
  }

  currentSongTime() {
    // position en secondes depuis le début du passage, compensée de la latence
    return (this.beat - this.from) * (60 / this.engine.opts.tempo) - (this.settings.latencyMs || 0) / 1000;
  }

  evaluate(midi, source) {
    if (!this.playing || this.engine.finished) return;
    const fromMic = source.startsWith('mic');
    const ev = this.engine.current;
    // Harmoniques mal reconnues au micro : on ne les compte pas comme fautes
    if (fromMic && this.opts.mode === 'wait' && ev && !ev.midis.includes(midi) && ev.midis.some((m) => [12, 19, 24].includes(midi - m))) return;
    if (fromMic) this.keyboard.flash(midi, 'pressed-flash');
    const res = this.engine.input(midi, this.currentSongTime());
    if (res.type === 'hit' || res.type === 'advance' || res.type === 'finish') {
      this.keyboard.flash(midi, 'hit');
      if (res.grade) {
        const words = { perfect: 'Parfait !', good: 'Bien !', ok: 'OK' };
        this.say(`${words[res.grade]} ${noteLabel(midi, this.settings)}${Math.abs(res.delta) > 0.08 ? (res.delta > 0 ? ' (un peu tard)' : ' (un peu tôt)') : ''}`, 'ok');
        if (res.noteId) this.markNote(res.noteId, 'hit');
      } else if (res.type !== 'hit' || !res.partial) {
        this.say(`✓ ${noteLabel(midi, this.settings)}`, 'ok');
      }
      if (this.opts.mode === 'wait' && (res.type === 'advance' || res.type === 'finish')) {
        const done = this.engine.events[this.engine.index - 1];
        done.notes.forEach((n) => this.markNote(n.id, 'hit'));
        this.wrongOnEvent = 0;
        this.playAccompaniment(done);
      }
      if (res.type === 'finish') this.finish();
    } else if (res.type === 'wrong') {
      this.keyboard.flash(midi, 'miss');
      const exp = (res.expected || []).map((m) => {
        const n = (this.engine.current?.notes || []).find((x) => x.midi === m);
        return noteLabel(m, this.settings) + (n?.finger ? ` (doigt ${n.finger})` : '');
      });
      this.say(`✗ ${noteLabel(midi, this.settings)}${exp.length ? ' — attendu : ' + exp.join(' + ') : ''}`, 'bad');
      if (this.opts.mode === 'wait') {
        this.wrongOnEvent++;
        if (this.opts.hint && this.wrongOnEvent === 3) {
          this.engine.current.midis.forEach((m, i) => synth.playNote(m, { when: synth.audioContext().currentTime + 0.15 + i * 0.02, dur: 0.8, velocity: 0.5, instrument: this.settings.instrument }));
          const f = this.engine.current.notes[0];
          this.say(`Écoute… c'est ${exp.join(' + ')} — ${f.hand === 'L' ? 'main gauche' : 'main droite'}, ${FINGER_NAMES[f.finger] || ''}`, 'info');
        }
      }
    }
    this.updateStats();
  }

  /** En mode attente, joue l'autre main entre cet événement et le suivant. */
  playAccompaniment(done) {
    if (!this.opts.accompany || this.opts.hands === 'both') return;
    const next = this.engine.current;
    const end = next ? next.start : this.to;
    const spb = 60 / this.engine.opts.tempo;
    const ac = synth.audioContext();
    for (const n of this.song.notes) {
      if (n.hand === this.opts.hands) continue;
      if (n.start >= done.start - 1e-6 && n.start < end - 1e-6) {
        synth.playNote(n.midi, { when: ac.currentTime + (n.start - done.start) * spb, dur: n.dur * spb, velocity: 0.55, instrument: this.settings.instrument });
      }
    }
  }

  markNote(id, cls) {
    this.roll.state.set(id, cls);
    this.staff.mark(id, cls);
  }

  say(text, kind = 'info') {
    this.el.feedback.textContent = text;
    this.el.feedback.className = 'feedback ' + kind;
  }

  updateStats() {
    const s = this.engine.summary();
    this.el.score.querySelector('b').textContent = s.hits;
    this.el.streak.querySelector('b').textContent = s.streak;
    this.el.acc.querySelector('b').textContent = s.total ? s.score + ' %' : '–';
    const total = this.engine.events.length || 1;
    const done = this.opts.mode === 'wait' ? this.engine.index : this.engine.events.filter((e) => e.start < this.beat).length;
    this.el.progress.firstChild.style.width = Math.min(100, (done / total) * 100) + '%';
  }

  // ---------- lecture ----------
  start(silent = false) {
    if (this.engine.finished) this.resetEngine();
    synth.audioContext();
    this.playing = true;
    this.el.play.textContent = '⏸ Pause';
    this.el.play.classList.add('on');
    if (!silent) this.say(this.opts.mode === 'wait' ? 'Joue la note surlignée !' : this.opts.mode === 'tempo' ? 'C\'est parti, suis le rythme !' : 'Écoute et regarde les touches…');
    if (this.opts.mode !== 'wait') {
      const countIn = this.settings.countIn && this.opts.mode === 'tempo' && Math.abs(this.beat - this.from) < 1e-3 ? this.song.beatsPerMeasure : 0;
      this.startClock(this.beat - countIn);
    }
  }

  startClock(fromBeat) {
    const ac = synth.audioContext();
    const spb = 60 / this.engine.opts.tempo;
    this.clockOrigin = ac.currentTime + 0.1 - (fromBeat - this.from) * spb; // temps audio où beat == from
    this.scheduledUntil = fromBeat;
    this.scheduledNotes = new Set();
    clearInterval(this.scheduler);
    this.scheduler = setInterval(() => this.schedule(), 25);
    this.schedule();
  }

  clockBeat() {
    const ac = synth.audioContext();
    return this.from + (ac.currentTime - this.clockOrigin) / (60 / this.engine.opts.tempo);
  }

  /** Planifie métronome + notes jouées par l'app (écoute / accompagnement) un peu à l'avance. */
  schedule() {
    if (!this.playing) return;
    const ac = synth.audioContext();
    const spb = 60 / this.engine.opts.tempo;
    const horizon = this.clockBeat() + 0.25 / spb + 0.2;
    const timeOf = (b) => this.clockOrigin + (b - this.from) * spb;
    const bpm = this.song.beatsPerMeasure;
    // métronome / décompte
    let b = Math.ceil(this.scheduledUntil - 1e-6);
    for (; b < horizon; b++) {
      if (b < this.scheduledUntil - 1e-6) continue;
      const counting = b < this.from;
      if ((this.opts.metronome || counting) && b <= this.to) synth.click(timeOf(b), ((b % bpm) + bpm) % bpm === 0);
      if (counting) {
        const n = Math.round(this.from - b);
        setTimeout(() => this.showCount(n), Math.max(0, (timeOf(b) - ac.currentTime) * 1000));
      }
    }
    // notes
    for (const n of this.song.notes) {
      if (n.start < this.from - 1e-6 || n.start >= this.to - 1e-6 || this.scheduledNotes.has(n.id)) continue;
      if (n.start > horizon) break;
      if (n.start < this.scheduledUntil - 1e-6) continue;
      const play = this.opts.mode === 'listen' || (this.opts.accompany && this.opts.hands !== 'both' && n.hand !== this.opts.hands);
      this.scheduledNotes.add(n.id);
      if (play) synth.playNote(n.midi, { when: timeOf(n.start), dur: n.dur * spb * 0.95, velocity: this.opts.mode === 'listen' ? 0.75 : 0.5, instrument: this.settings.instrument, a4: this.settings.a4 });
    }
    this.scheduledUntil = horizon;
  }

  showCount(n) {
    const c = this.el.countdown;
    if (n <= 0 || !this.playing) return c.classList.add('hidden');
    c.textContent = n;
    c.classList.remove('hidden', 'pop');
    void c.offsetWidth;
    c.classList.add('pop');
    setTimeout(() => n === 1 && c.classList.add('hidden'), 600);
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.scheduler);
    synth.stopAll();
    this.el.play.textContent = '▶ Reprendre';
    this.el.play.classList.remove('on');
    this.el.countdown.classList.add('hidden');
  }

  stopPlayback() {
    this.pause();
    this.el.play.textContent = '▶ Démarrer';
  }

  restart() {
    this.stopPlayback();
    this.resetEngine();
    this.say('On recommence !');
  }

  frame() {
    if (this.destroyed) return;
    const o = this.opts;
    if (this.playing && o.mode !== 'wait') {
      this.beat = this.clockBeat();
      if (o.mode === 'tempo') {
        const missed = this.engine.tick(this.currentSongTime());
        if (missed.length) {
          missed.forEach((n) => this.markNote(n.id, 'miss'));
          this.say(`Raté : ${missed.map((n) => noteLabel(n.midi, this.settings)).join(', ')}`, 'bad');
          this.updateStats();
        }
        if (this.engine.finished) this.finish();
      } else if (this.beat > this.to + 0.5) this.finish();
    } else if (o.mode === 'wait') {
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
    // marques sur le clavier
    const marks = new Map();
    const current = new Set();
    if (o.mode === 'wait' && this.engine.current) {
      for (const n of this.engine.current.notes) {
        if (this.engine.satisfied.has(n.midi)) continue;
        marks.set(n.midi, { cls: 'expect-' + n.hand, finger: this.settings.showFingers ? n.finger : null });
        current.add(n.id);
      }
      const next = this.engine.events[this.engine.index + 1];
      if (next) for (const n of next.notes) if (!marks.has(n.midi)) marks.set(n.midi, { cls: 'expect-next', finger: null });
    } else {
      for (const n of this.song.notes) {
        if (n.start > beat + 0.05) break;
        if (n.start + n.dur > beat && n.start >= this.from - 1e-6 && n.start < this.to) {
          if (o.mode === 'tempo' && o.hands !== 'both' && n.hand !== o.hands) continue;
          marks.set(n.midi, { cls: 'expect-' + n.hand, finger: this.settings.showFingers ? n.finger : null });
          current.add(n.id);
        }
      }
    }
    const sig = [...marks].map(([m, v]) => m + v.cls + v.finger).join();
    if (sig !== this._markSig) {
      this.keyboard.setMarks(marks);
      this._markSig = sig;
    }
    if (o.view !== 'staff') this.roll.draw(beat, { beatsPerMeasure: this.song.beatsPerMeasure, activeHands: o.hands, current });
    if (o.view !== 'roll') this.renderStaff(beat, current);
  }

  renderStaff(beat, current) {
    const bpm = this.song.beatsPerMeasure;
    const width = this.el.staffWrap.clientWidth || 800;
    const mpp = measuresPerPage(width, bpm);
    const m = Math.max(0, measureOf(this.song, Math.max(0, beat + 1e-3)));
    const page = Math.floor(m / mpp);
    const key = page + ':' + width + ':' + this.opts.hands;
    if (key !== this.staffPage) {
      this.staffPage = key;
      this.staff.render(this.song, page * mpp * bpm, (page + 1) * mpp * bpm, { settings: this.settings, showFingers: this.settings.showFingers, showNoteNames: this.settings.showNoteNames, activeHands: this.opts.hands });
      for (const [id, st] of this.roll.state) this.staff.mark(id, st);
    }
    this.staff.clearMarks('current');
    for (const id of current) if (!this.roll.state.get(id)) this.staff.mark(id, 'current');
    this.staff.setCursor(beat);
  }

  finish() {
    if (!this.playing && this.engine.finished && this._finishedShown) return;
    this.playing = false;
    clearInterval(this.scheduler);
    this.el.play.textContent = '▶ Rejouer';
    this.el.play.classList.remove('on');
    if (this.opts.mode === 'listen') {
      this.say('Fin de l\'écoute. À toi de jouer ! Passe en mode Attente ou Tempo.');
      this.beat = this.from;
      return;
    }
    const s = this.engine.summary();
    const durationSec = (performance.now() - this.sessionStart) / 1000;
    const songId = this.baseSong.id || 'exercice';
    const rec = { score: s.score, stars: s.stars, mode: this.opts.mode, hands: this.opts.hands, tempoPct: this.opts.tempoPct, durationSec };
    if (!this.baseSong.ephemeral) store.recordSession(songId, rec);
    this.hooks.onResult?.(s, rec);
    if (s.stars >= 2) synth.feedbackSound('success');

    if (this.opts.loop && this.opts.autoRepeat !== false) {
      let msg = `Passage terminé : ${s.score} % ${'★'.repeat(s.stars)}`;
      if (this.opts.progressive && s.score >= 90 && this.opts.tempoPct < 150) {
        this.setOpt('tempoPct', Math.min(150, this.opts.tempoPct + 5));
        msg += ` — tempo augmenté à ${this.opts.tempoPct} %`;
      }
      toast(msg);
      this.resetEngine();
      setTimeout(() => !this.destroyed && this.start(), 900);
      return;
    }
    this.showResults(s);
  }

  showResults(s) {
    const stars = '★'.repeat(s.stars) + '☆'.repeat(3 - s.stars);
    const msg = s.stars === 3 ? 'Magnifique ! 🎉' : s.stars === 2 ? 'Très bien, continue !' : s.stars === 1 ? 'Pas mal, encore un peu de travail.' : 'Courage ! Ralentis le tempo et travaille mains séparées.';
    const worst = s.worstMeasures.length
      ? `<p>Mesures à retravailler : ${s.worstMeasures.map((w) => `<button class="btn tiny" data-measure="${w.measure}">mesure ${w.measure} (${w.errors})</button>`).join(' ')}</p>`
      : '';
    const timing = this.opts.mode === 'tempo' ? `<p>Rythme : <b>${s.tendency}</b> (${Math.round(s.avgTiming * 1000)} ms en moyenne) · Parfait ${s.perfect} · Bien ${s.good} · OK ${s.ok} · Ratées ${s.misses}</p>` : '';
    const dlg = modal('Résultat', `
      <div class="result"><div class="stars" aria-label="${s.stars} étoiles sur 3">${stars}</div>
      <div class="big-score">${s.score} %</div><p>${msg}</p>
      <p>${s.hits} justes · ${s.wrong} fausses · meilleure série ${s.bestStreak}</p>${timing}${worst}</div>`,
    [
      { label: 'Rejouer', primary: true, action: () => this.restart() },
      ...(this.hooks.onNext ? [{ label: 'Étape suivante →', action: () => this.hooks.onNext() }] : []),
      { label: 'Fermer' },
    ]);
    dlg.querySelectorAll('[data-measure]').forEach((b) => b.addEventListener('click', () => {
      const m = Number(b.dataset.measure);
      this.el.loopFrom.value = m;
      this.el.loopTo.value = m;
      this.opts.loop = true;
      this.root.querySelectorAll('.check input')[0].checked = true;
      this.setOpt('tempoPct', Math.max(40, this.opts.tempoPct - 20));
      this.updateLoop();
      dlg.close();
      toast(`Boucle sur la mesure ${m}, tempo réduit.`);
    }));
    this._finishedShown = true;
  }

  destroy() {
    this.destroyed = true;
    this.pause();
    cancelAnimationFrame(this.raf);
    this.unsub.forEach((f) => f());
    window.removeEventListener('keydown', this._keys);
    document.removeEventListener('visibilitychange', this._vis);
    this.roll.destroy();
    for (const m of this.held) synth.releaseNote(m);
  }
}
