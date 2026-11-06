// Vue : song
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

// ---------- Fiche morceau ----------
function viewSong(id) {
  const s = findSong(id);
  if (!s) throw new Error('Ce morceau est introuvable (il a peut-être été supprimé).');
  const g = genreOf(s.genre);
  const p = store.progress()[s.id];
  const fav = store.favorites().includes(s.id);
  const favBtn = h('button', { class: 'btn' + (fav ? ' on' : ''), onclick: () => favBtn.classList.toggle('on', store.toggleFavorite(s.id)) }, '♥ Favori');
  const exportSel = h('select', { 'aria-label': 'Exporter', onchange: (e) => {
    const f = e.target.value;
    e.target.value = '';
    if (!f) return;
    try {
      const out = exportSong(s, f);
      download(out.filename, out.data, out.mime);
    } catch (err) {
      toast('Export impossible : ' + err.message);
    }
  } }, [h('option', { value: '' }, '⬇ Exporter…'), h('option', { value: 'midi' }, 'MIDI (.mid)'), h('option', { value: 'musicxml' }, 'MusicXML (.musicxml)'), h('option', { value: 'text' }, 'Texte (.txt)'), h('option', { value: 'json' }, 'JSON')]);

  const keyNames = ['Do♭', 'Sol♭', 'Ré♭', 'La♭', 'Mi♭', 'Si♭', 'Fa', 'Do', 'Sol', 'Ré', 'La', 'Mi', 'Si', 'Fa♯', 'Do♯'];
  main.append(
    h('div', { class: 'song-header', style: `--c:${g.color}` }, [
      h('span', { class: 'emoji big' }, g.emoji),
      h('div', {}, [
        h('h1', {}, s.title),
        h('p', { class: 'muted' }, `${s.composer || 'Compositeur inconnu'} · ${g.name} · ${levelLabel(s.level)}`),
        h('div', { class: 'tags' }, [
          h('span', { class: 'tag' }, `♩ = ${s.tempo}`), h('span', { class: 'tag' }, `${s.timeSig[0]}/${s.timeSig[1]}`),
          h('span', { class: 'tag' }, `${s.measureCount} mesures`), h('span', { class: 'tag' }, `Tonalité : ${keyNames[(s.keyFifths || 0) + 7] || '?'}`),
          h('span', { class: 'tag' }, s.hands.R && s.hands.L ? '2 mains' : s.hands.R ? 'Main droite' : 'Main gauche'),
          s.autoFingering ? h('span', { class: 'tag warn', title: 'Doigtés calculés automatiquement' }, 'doigtés suggérés') : null,
          p ? h('span', { class: 'tag ok' }, `Record : ${p.best} % ${stars(p.stars)}`) : null,
        ]),
      ]),
    ]),
    s.description ? h('p', { class: 'lead' }, s.description) : null,
    h('div', { class: 'row actions' }, [
      h('a', { class: 'btn primary big', href: `#/jouer/${encodeURIComponent(s.id)}` }, '🎯 S’entraîner'),
      h('a', { class: 'btn big', href: `#/jouer/${encodeURIComponent(s.id)}?mode=listen` }, '🔊 Écouter'),
      h('a', { class: 'btn big', href: `#/parcours/${encodeURIComponent(s.id)}` }, '📚 Cours pas à pas'),
      favBtn, exportSel,
      s.imported ? h('button', { class: 'btn danger', onclick: () => modal('Supprimer ?', `<p>Supprimer « ${escapeHtml(s.title)} » de ta bibliothèque ?</p>`, [{ label: 'Supprimer', primary: true, action: () => { store.removeFromLibrary(s.id); ctx.prepared.delete(s.id); location.hash = '#/bibliotheque'; } }, { label: 'Annuler' }]) }, '🗑 Supprimer') : null,
    ]),
  );

  // Aperçu des phrases avec touches et doigtés
  const list = h('div', { class: 'phrases' });
  phrases(s, s.measureCount <= 8 ? 2 : 4).forEach((ph, i) => {
    const staffBox = h('div', { class: 'staff-box' });
    const handsBox = h('div', { class: 'hands' });
    for (const hand of ['R', 'L']) {
      const ns = ph.notes.filter((n) => n.hand === hand);
      if (!ns.length) continue;
      const uniq = [...new Map(ns.map((n) => [n.midi, n])).values()];
      handsBox.append(h('div', { class: 'hand-col' }, [
        h('h4', {}, hand === 'R' ? '✋ Main droite' : '🤚 Main gauche'),
        keyDiagram(uniq.map((n) => ({ midi: n.midi, finger: n.finger, hand })), { labels: (m) => (m % 12 === 0 ? noteLabel(m, ctx.settings) : '') }),
        h('p', { class: 'small' }, describePosition(ns, hand, ctx.settings)),
        h('p', { class: 'seq' }, ns.slice(0, 40).map((n) => h('span', { class: 'n hand-' + hand }, [noteLabel(n.midi, { ...ctx.settings, octave: false }), h('sup', {}, n.finger || '')]))),
      ]));
    }
    list.append(h('details', { class: 'card phrase', open: i === 0, ontoggle: (e) => {
      if (e.target.open && !staffBox.firstChild) {
        const sv = new StaffView(staffBox);
        sv.render(s, ph.from, ph.to, { settings: ctx.settings, showFingers: true, showNoteNames: ctx.settings.showNoteNames });
      }
    } }, [
      h('summary', {}, [h('b', {}, `Phrase ${i + 1}`), ` — mesures ${ph.firstMeasure} à ${ph.lastMeasure}`, h('a', { class: 'btn tiny', href: `#/jouer/${encodeURIComponent(s.id)}?from=${ph.firstMeasure}&to=${ph.lastMeasure}`, onclick: (e) => e.stopPropagation() }, '🎯 Travailler')]),
      staffBox, handsBox,
    ]));
  });
  main.append(section('Touches et doigtés, phrase par phrase', list));
  // première phrase : rendu de la portée
  requestAnimationFrame(() => list.querySelector('details[open]')?.dispatchEvent(new Event('toggle')));
}

// ---------- Jouer ----------
function viewPlay(id, query) {
  const s = findSong(id);
  if (!s) throw new Error('Morceau introuvable.');
  startTrainer(s, query, { back: `#/morceau/${encodeURIComponent(id)}` });
}


registerRoute(/^morceau\/(.+)$/, viewSong)
registerRoute(/^jouer\/(.+)$/, viewPlay)
