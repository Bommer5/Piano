// Vue : settings
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

// ---------- Réglages ----------
function viewSettings() {
  const s = { ...ctx.settings };
  const save = () => {
    store.saveSettings(s);
    ctx.settings = s;
    applyTheme();
    toast('Réglages enregistrés');
  };
  const sel = (key, options, label) => h('label', { class: 'setting' }, [h('span', {}, label), h('select', { onchange: (e) => { s[key] = e.target.value; save(); } }, options.map(([v, l]) => h('option', { value: v, selected: String(s[key]) === String(v) }, l)))]);
  const chk = (key, label, help) => h('label', { class: 'setting check' }, [h('input', { type: 'checkbox', checked: !!s[key], onchange: (e) => { s[key] = e.target.checked; save(); } }), h('span', {}, [label, help ? h('small', {}, help) : null])]);
  const num = (key, label, min, max, step, unit = '') => {
    const out = h('span', { class: 'mono' }, s[key] + unit);
    return h('label', { class: 'setting' }, [h('span', {}, label), h('input', { type: 'range', min, max, step, value: s[key], oninput: (e) => { s[key] = Number(e.target.value); out.textContent = s[key] + unit; }, onchange: save }), out]);
  };
  const level = h('div', { class: 'level' }, h('div', { class: 'bar' }));
  const offMic = mic.on((e) => e.type === 'frame' && (level.firstChild.style.width = Math.min(100, e.rms * 600) + '%'));
  onCleanup(offMic);
  main.append(h('h1', {}, 'Réglages'),
    section('Affichage', h('div', { class: 'settings' }, [
      sel('notation', [['fr', 'Do Ré Mi (français)'], ['en', 'C D E (anglais)']], 'Nom des notes'),
      sel('theme', [['auto', 'Automatique'], ['dark', 'Sombre'], ['light', 'Clair']], 'Thème'),
      sel('view', [['both', 'Portée + notes qui tombent'], ['staff', 'Portée seule'], ['roll', 'Notes qui tombent seules']], 'Vue d’entraînement'),
      chk('showFingers', 'Afficher les doigtés'), chk('showNoteNames', 'Afficher le nom des notes'), chk('showKeyboardLabels', 'Afficher les touches du clavier d’ordinateur sur le piano'),
    ])),
    section('Son', h('div', { class: 'settings' }, [
      sel('instrument', synth.INSTRUMENT_LIST, 'Instrument'), num('volume', 'Volume', 0, 1, 0.05), chk('metronome', 'Métronome activé par défaut'), chk('midiLocalSound', 'Son de l’app pour le clavier MIDI', 'Décoche si ton piano numérique produit déjà le son (évite le son en double).'), chk('countIn', 'Décompte d’une mesure en mode Tempo'),
      h('button', { class: 'btn', onclick: () => [60, 64, 67, 72].forEach((m, i) => synth.playNote(m, { when: synth.audioContext().currentTime + i * 0.2, dur: 0.6, instrument: s.instrument, velocity: 0.7 })) }, '🔊 Tester le son'),
    ])),
    section('Micro & détection', h('div', { class: 'settings' }, [
      num('a4', 'Diapason La4', 415, 466, 1, ' Hz'), num('micSensitivity', 'Seuil du micro (plus bas = plus sensible)', 0.003, 0.05, 0.001),
      h('div', { class: 'setting' }, [h('span', {}, 'Niveau du micro'), level, h('button', { class: 'btn tiny', onclick: async () => { try { await mic.start(); } catch (e) { toast(e.message); } } }, 'Tester')]),
      chk('octaveTolerant', 'Tolérer les erreurs d’octave au micro', 'Le micro confond parfois une note avec son octave : recommandé.'),
      num('latencyMs', 'Compensation de latence', 0, 300, 5, ' ms'),
    ])),
    section('Objectifs', h('div', { class: 'settings' }, [num('dailyGoalMin', 'Objectif quotidien', 5, 120, 5, ' min')])),
    ...settingsSections.map((f) => { try { return f(); } catch (e) { console.error(e); return null; } }).filter(Boolean),
    section('Données', h('div', { class: 'row' }, [
      h('button', { class: 'btn', onclick: () => { store.saveSettings(DEFAULT_SETTINGS); ctx.settings = { ...DEFAULT_SETTINGS }; applyTheme(); ctx.route(); } }, 'Réglages par défaut'),
      h('button', { class: 'btn danger', onclick: () => modal('Tout effacer ?', '<p>Progrès, imports et réglages seront supprimés de ce navigateur.</p>', [{ label: 'Tout effacer', primary: true, action: () => { Object.keys(localStorage).filter((k) => k.startsWith('pianocoach.')).forEach((k) => localStorage.removeItem(k)); ctx.prepared.clear(); location.hash = '#/'; location.reload(); } }, { label: 'Annuler' }]) }, 'Effacer toutes mes données'),
    ])),
  );
}

registerRoute(/^reglages$/, viewSettings)
