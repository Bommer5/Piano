// Vue : library
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

// ---------- Bibliothèque ----------
function viewLibrary(query) {
  const state = { q: query.q || '', genre: query.genre || '', level: query.level || '', favs: query.favs === '1', sort: query.sort || 'level' };
  const grid = h('div', { class: 'grid songs' });
  const search = h('input', { type: 'search', placeholder: 'Rechercher un titre, un compositeur…', value: state.q, oninput: (e) => { state.q = e.target.value; render(); }, 'aria-label': 'Rechercher' });
  const genreSel = h('select', { onchange: (e) => { state.genre = e.target.value; render(); }, 'aria-label': 'Genre' }, [h('option', { value: '' }, 'Tous les genres'), ...GENRES.map((g) => h('option', { value: g.id, selected: g.id === state.genre }, `${g.emoji} ${g.name}`)), h('option', { value: '__import', selected: state.genre === '__import' }, '📂 Mes imports')]);
  const levelSel = h('select', { onchange: (e) => { state.level = e.target.value; render(); }, 'aria-label': 'Niveau' }, [h('option', { value: '' }, 'Tous niveaux'), ...[1, 2, 3, 4, 5].map((l) => h('option', { value: l, selected: String(l) === state.level }, levelLabel(l)))]);
  const sortSel = h('select', { onchange: (e) => { state.sort = e.target.value; render(); }, 'aria-label': 'Trier' }, [['level', 'Trier : niveau'], ['title', 'Trier : titre'], ['score', 'Trier : mon score'], ['recent', 'Trier : récents']].map(([v, l]) => h('option', { value: v, selected: v === state.sort }, l)));
  const favBtn = h('button', { class: 'btn' + (state.favs ? ' on' : ''), onclick: () => { state.favs = !state.favs; favBtn.classList.toggle('on', state.favs); render(); } }, '♥ Favoris');
  const count = h('p', { class: 'muted' });
  main.append(h('h1', {}, 'Morceaux'), h('div', { class: 'filters' }, [search, genreSel, levelSel, sortSel, favBtn]), count, grid);

  function render() {
    const q = state.q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const favs = store.favorites();
    const prog = store.progress();
    let list = allSongs().filter((s) => {
      const imp = !getSong(s.id);
      if (state.genre === '__import' ? !imp : state.genre && s.genre !== state.genre) return false;
      if (state.level && String(s.level) !== state.level) return false;
      if (state.favs && !favs.includes(s.id)) return false;
      const hay = `${s.title} ${s.composer} ${(s.tags || []).join(' ')}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      return !q || hay.includes(q);
    });
    const cmp = {
      level: (a, b) => a.level - b.level || a.title.localeCompare(b.title),
      title: (a, b) => a.title.localeCompare(b.title),
      score: (a, b) => (prog[b.id]?.best || 0) - (prog[a.id]?.best || 0),
      recent: (a, b) => (prog[b.id]?.last || 0) - (prog[a.id]?.last || 0),
    }[state.sort];
    list.sort(cmp);
    grid.innerHTML = '';
    count.textContent = `${list.length} morceau${list.length > 1 ? 'x' : ''}`;
    for (const s of list) {
      try {
        grid.append(songCard(findSong(s.id)));
      } catch (e) {
        console.warn('Morceau invalide', s.id, e);
      }
    }
    if (!list.length) grid.append(h('p', { class: 'empty' }, 'Aucun morceau ne correspond. Essaie un autre filtre, ou importe ta propre partition !'));
    history.replaceState(null, '', `#/bibliotheque?${new URLSearchParams(Object.entries({ q: state.q, genre: state.genre, level: state.level, favs: state.favs ? '1' : '', sort: state.sort }).filter(([, v]) => v))}`);
  }
  render();
}

registerRoute(/^bibliotheque$/, viewLibrary)
