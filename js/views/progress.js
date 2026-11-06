// Vue : progress
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

// ---------- Progrès ----------
function viewProgress() {
  const prog = store.progress();
  const days = store.practiceDays();
  const total = Object.values(days).reduce((a, b) => a + b, 0);
  const chart = h('div', { class: 'bars', role: 'img', 'aria-label': 'Minutes de pratique sur 30 jours' });
  const d = new Date();
  d.setDate(d.getDate() - 29);
  const vals = [];
  for (let i = 0; i < 30; i++) {
    const k = localDate(d);
    vals.push([k, days[k] || 0]);
    d.setDate(d.getDate() + 1);
  }
  const max = Math.max(60, ...vals.map((v) => v[1]));
  for (const [k, v] of vals) chart.append(h('div', { class: 'bar', style: `height:${(v / max) * 100}%`, title: `${k} : ${Math.round(v / 60)} min` }));
  const rows = Object.entries(prog).sort((a, b) => (b[1].last || 0) - (a[1].last || 0)).map(([id, p]) => {
    const s = findSong(id);
    return h('tr', {}, [h('td', {}, s ? h('a', { href: `#/morceau/${id}` }, s.title) : id), h('td', {}, stars(p.stars)), h('td', {}, p.best + ' %'), h('td', {}, String(p.plays)), h('td', {}, Math.round(p.timeSec / 60) + ' min'), h('td', {}, h('span', { class: 'spark' }, (p.history || []).slice(-12).map((x) => h('i', { style: `height:${Math.max(4, x.score)}%`, title: x.score + ' %' }))))]);
  });
  main.append(h('h1', {}, 'Mes progrès'), h('div', { class: 'grid stats-grid' }, [
    statCard('🔥', store.streak(), 'jours d’affilée'), statCard('⏱️', Math.round(total / 60) + ' min', 'de pratique au total'),
    statCard('🎵', Object.keys(prog).length, 'morceaux travaillés'), statCard('⭐', Object.values(prog).reduce((a, p) => a + p.stars, 0), 'étoiles gagnées'),
  ]), section('30 derniers jours', chart),
  section('Morceaux', rows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, [h('tr', {}, ['Morceau', 'Étoiles', 'Record', 'Sessions', 'Temps', 'Évolution'].map((t) => h('th', {}, t))), ...rows])) : h('p', { class: 'empty' }, 'Joue un morceau pour voir tes progrès ici.')),
  section('Sauvegarde', [h('p', { class: 'small' }, 'Tes progrès sont enregistrés dans ce navigateur. Exporte-les pour les garder ou les transférer.'), h('div', { class: 'row' }, [
    h('button', { class: 'btn', onclick: () => download('piano-coach-sauvegarde.json', JSON.stringify(store.exportAll(), null, 2), 'application/json') }, '⬇ Exporter mes données'),
    h('label', { class: 'btn' }, ['⬆ Importer une sauvegarde', h('input', { type: 'file', accept: '.json', class: 'hidden', onchange: async (e) => {
      try {
        store.importAll(JSON.parse(await e.target.files[0].text()));
        ctx.prepared.clear();
        toast('Sauvegarde importée !');
        ctx.route();
      } catch {
        toast('Fichier de sauvegarde invalide.');
      }
    } })]),
  ])]));
}

registerRoute(/^progres$/, viewProgress)
