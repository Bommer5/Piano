// Vue : home
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

// ---------- Accueil ----------
function viewHome() {
  const prog = store.progress();
  const last = Object.entries(prog).sort((a, b) => (b[1].last || 0) - (a[1].last || 0))[0];
  const lastSong = last && findSong(last[0]);
  const days = store.practiceDays();
  const today = days[localDate()] || 0;
  const goal = ctx.settings.dailyGoalMin * 60;
  const dayIdx = Math.floor(Date.now() / 86400000);
  const songOfDay = SONGS[dayIdx % SONGS.length];

  main.append(
    h('div', { class: 'hero' }, [
      h('div', {}, [
        h('h1', {}, ['Apprends le piano,', h('br'), h('span', { class: 'grad' }, 'note après note.')]),
        h('p', { class: 'lead' }, "Piano Coach écoute ton piano (micro ou clavier MIDI) et te dit en direct si tu joues la bonne note, avec les doigtés et les touches à suivre."),
        h('div', { class: 'row' }, [
          h('a', { class: 'btn primary big', href: lastSong ? `#/jouer/${lastSong.id}` : '#/lecon/' + (COURSES[0]?.lessons[0]?.id || '') }, lastSong ? `▶ Continuer « ${lastSong.title} »` : '▶ Commencer les bases'),
          h('a', { class: 'btn big', href: '#/bibliotheque' }, '🎼 Choisir un morceau'),
          h('a', { class: 'btn big', href: '#/importer' }, '📂 Importer une partition'),
        ]),
      ]),
      h('div', { class: 'hero-piano', 'aria-hidden': 'true' }, Array.from({ length: 14 }, (_, i) => h('span', { style: `--i:${i}` }))),
    ]),
    h('div', { class: 'grid stats-grid' }, [
      statCard('🔥', store.streak(), 'jours d’affilée'),
      statCard('⏱️', Math.round(today / 60) + ' / ' + ctx.settings.dailyGoalMin + ' min', 'objectif du jour', Math.min(1, today / goal)),
      statCard('🎵', Object.keys(prog).length, 'morceaux travaillés'),
      statCard('🎓', Object.keys(store.lessonsDone()).length, 'leçons terminées'),
    ]),
    ...homeSections.map((f) => { try { return f(); } catch (e) { console.error(e); return null; } }).filter(Boolean),
    section('Morceau du jour', songCard(findSong(songOfDay.id))),
    section('Explore par genre', h('div', { class: 'grid genres' }, GENRES.map((g) => h('a', { class: 'genre-card', href: `#/bibliotheque?genre=${g.id}`, style: `--c:${g.color}` }, [h('span', { class: 'emoji' }, g.emoji), h('b', {}, g.name), h('small', {}, `${SONGS.filter((s) => s.genre === g.id).length} morceaux`)])))),
    section('Comment ça marche ?', h('ol', { class: 'steps' }, [
      h('li', {}, [h('b', {}, 'Choisis'), ' un morceau gratuit ou importe ta partition (MusicXML, MIDI, ABC…).']),
      h('li', {}, [h('b', {}, 'Branche'), ' ton clavier MIDI, ou active le micro devant ton piano acoustique.']),
      h('li', {}, [h('b', {}, 'Joue'), ' : en mode Attente la partition attend la bonne note ; en mode Tempo elle défile en rythme.']),
      h('li', {}, [h('b', {}, 'Progresse'), ' avec les cours guidés : mains séparées, tempo lent, puis morceau complet.']),
    ])),
  );
}


registerRoute(/^$/, viewHome)
