// Vue : tuner
import { GENRES, SONGS, getSong } from '../data/songs.js';
import { COURSES, getCourse, getLesson } from '../data/lessons.js';
import { prepareSong, phrases, parseTrack } from '../core/song.js';
import { generateSongCourse, describePosition } from '../core/coursegen.js';
import { noteLabel, midiToName, nameToMidi, centsOff, midiToFreq } from '../core/notes.js';
import { estimateNotes } from '../core/spectrum.js';
import { PitchSmoother } from '../core/onset.js';
import { store, DEFAULT_SETTINGS, localDate } from '../core/storage.js';
import { importScoreFile, importScoreText, SUPPORTED_FORMATS, exportSong } from '../parsers/index.js';
import { keyDiagram, PianoKeyboard } from '../ui/keyboard.js';
import { StaffView } from '../ui/staff.js';
import { h, toast, modal, download, escapeHtml, stars } from '../ui/dom.js';
import * as synth from '../audio/synth.js';
import { mic } from '../audio/mic.js';
import { midiInput, computerKeyboard } from '../audio/midi-input.js';
import { ctx, main, onCleanup, registerRoute, findSong, allSongs, genreOf, levelLabel, applyTheme, section, statCard, songCard, startTrainer, settingsSections, homeSections } from '../ui/context.js';

// ---------- Détecteur / accordeur ----------
function viewTuner() {
  const noteEl = h('div', { class: 'tuner-note' }, '—');
  const freqEl = h('div', { class: 'tuner-freq mono' }, 'Active le micro pour commencer');
  const needle = h('div', { class: 'tuner-needle' });
  const gauge = h('div', { class: 'tuner-gauge' }, [h('span', { class: 'tick c' }), needle, h('span', { class: 'lbl l' }, '−50'), h('span', { class: 'lbl r' }, '+50')]);
  const poly = h('div', { class: 'poly' }, '');
  const canvas = h('canvas', { class: 'spectrum' });
  const history = h('div', { class: 'note-history' });
  const btn = h('button', { class: 'btn primary big', onclick: toggle }, mic.running ? '⏹ Arrêter le micro' : '🎤 Activer le micro');
  const kbEl = h('div', { class: 'kb small-kb' });
  main.append(h('h1', {}, 'Détecteur de notes'), h('p', { class: 'lead' }, 'Joue une note sur ton piano : l’app affiche son nom, sa fréquence et sa justesse. Pratique pour vérifier ton micro, accorder ou t’entraîner à reconnaître les notes.'),
    h('div', { class: 'card tuner' }, [btn, noteEl, freqEl, gauge, h('p', { class: 'small muted' }, ['Accord détecté (expérimental) : ', poly]), canvas, history]),
    section('Note de référence', [h('p', { class: 'small' }, 'Clique une touche pour entendre la note (La4 = ' + ctx.settings.a4 + ' Hz).'), kbEl]));
  const kb = new PianoKeyboard(kbEl, { onNoteOn: (m) => synth.playNote(m, { dur: 1.5, a4: ctx.settings.a4, instrument: ctx.settings.instrument }), onNoteOff: () => {}, label: (m) => (m % 12 === 0 ? noteLabel(m, ctx.settings) : '') });
  kb.setRange(36, 84);
  const smooth = new PitchSmoother(5);
  let lastNote = null;
  let frameN = 0;
  const off = mic.on((e) => {
    if (e.type === 'state') {
      btn.textContent = e.running ? '⏹ Arrêter le micro' : '🎤 Activer le micro';
      return;
    }
    if (e.type === 'onset') {
      history.prepend(h('span', { class: 'chip' }, noteLabel(e.midi, ctx.settings)));
      while (history.children.length > 24) history.lastChild.remove();
      kb.flash(e.midi, 'hit');
    }
    if (e.type !== 'frame') return;
    const f = smooth.push(e.freq && e.clarity > 0.8 ? e.freq : null);
    if (f) {
      const midiF = 69 + 12 * Math.log2(f / ctx.settings.a4);
      const m = Math.round(midiF);
      const c = Math.round(centsOff(f, m, ctx.settings.a4));
      noteEl.textContent = noteLabel(m, ctx.settings);
      noteEl.classList.toggle('in-tune', Math.abs(c) <= 5);
      freqEl.textContent = `${f.toFixed(1)} Hz · ${c > 0 ? '+' : ''}${c} cents · ${midiToName(m, { lang: ctx.settings.notation === 'fr' ? 'en' : 'fr' })}`;
      needle.style.left = 50 + Math.max(-50, Math.min(50, c)) + '%';
      needle.classList.toggle('in-tune', Math.abs(c) <= 5);
      lastNote = m;
    } else if (e.rms < 0.005) noteEl.classList.remove('in-tune');
    if (++frameN % 3 === 0) {
      const mag = mic.spectrum();
      if (mag) {
        drawSpectrum(canvas, mag, mic.sampleRate);
        const notes = e.rms > 0.01 ? estimateNotes(mag, mic.sampleRate, { a4: ctx.settings.a4 }) : [];
        poly.textContent = notes.length ? notes.map((m) => noteLabel(m, ctx.settings)).join(' · ') : '—';
      }
    }
  });
  onCleanup(off);
  async function toggle() {
    try {
      if (mic.running) mic.stop();
      else {
        mic.a4 = ctx.settings.a4;
        mic.setSensitivity(ctx.settings.micSensitivity);
        await mic.start();
      }
    } catch (err) {
      modal('Micro indisponible', `<p>${escapeHtml(err.message)}</p><p>Autorise le micro dans ton navigateur puis réessaie.</p>`);
    }
  }
}

function drawSpectrum(canvas, mag, sr) {
  const r = canvas.getBoundingClientRect();
  const dpr = devicePixelRatio || 1;
  if (canvas.width !== Math.round(r.width * dpr)) {
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
  }
  const ctx = canvas.getContext('2d');
  const w = canvas.width, hgt = canvas.height;
  ctx.clearRect(0, 0, w, hgt);
  const binHz = sr / (mag.length * 2);
  const fmin = 27.5, fmax = 4200;
  let max = 1e-9;
  for (let i = 1; i < mag.length; i++) if (mag[i] > max) max = mag[i];
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, '#ff8a3d');
  grad.addColorStop(0.5, '#b86bff');
  grad.addColorStop(1, '#4f8cff');
  ctx.fillStyle = grad;
  const cols = Math.floor(w / (2 * dpr));
  for (let x = 0; x < cols; x++) {
    const f = fmin * Math.pow(fmax / fmin, x / cols);
    const f2 = fmin * Math.pow(fmax / fmin, (x + 1) / cols);
    let v = 0;
    for (let b = Math.floor(f / binHz); b <= Math.ceil(f2 / binHz) && b < mag.length; b++) v = Math.max(v, mag[b]);
    const db = Math.max(0, 1 + Math.log10(v / max + 1e-9) / 3);
    const bh = db * hgt;
    ctx.fillRect(x * 2 * dpr, hgt - bh, 1.5 * dpr, bh);
  }
}

registerRoute(/^accordeur$/, viewTuner)
