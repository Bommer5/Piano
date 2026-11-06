// Piano Coach — application principale (routeur + vues).
import { GENRES, SONGS, getSong } from './data/songs.js';
import { COURSES, getCourse, getLesson } from './data/lessons.js';
import { prepareSong, phrases, parseTrack } from './core/song.js';
import { generateSongCourse, describePosition } from './core/coursegen.js';
import { noteLabel, midiToName, nameToMidi, centsOff, midiToFreq } from './core/notes.js';
import { estimateNotes } from './core/spectrum.js';
import { PitchSmoother } from './core/onset.js';
import { store, DEFAULT_SETTINGS } from './core/storage.js';
import { importScoreFile, importScoreText, SUPPORTED_FORMATS, exportSong } from './parsers/index.js';
import { Trainer } from './ui/trainer.js';
import { keyDiagram, PianoKeyboard } from './ui/keyboard.js';
import { StaffView } from './ui/staff.js';
import { h, toast, modal, download, escapeHtml, stars } from './ui/dom.js';
import * as synth from './audio/synth.js';
import { mic } from './audio/mic.js';
import { midiInput, computerKeyboard } from './audio/midi-input.js';

const main = document.getElementById('main');
let settings = store.settings();
let cleanup = [];
const prepared = new Map();

// ---------- morceaux ----------
export function findSong(id) {
  if (prepared.has(id)) return prepared.get(id);
  let raw = getSong(id) || store.library().find((s) => s.id === id);
  if (!raw) return null;
  const s = prepareSong(raw);
  s.imported = !getSong(id);
  prepared.set(id, s);
  return s;
}

function allSongs() {
  return [...SONGS, ...store.library()];
}

const genreOf = (id) => GENRES.find((g) => g.id === id) || { id, name: id || 'Divers', emoji: '🎵', color: '#7a7f9a' };
const levelLabel = (n) => ['', 'Débutant', 'Facile', 'Intermédiaire', 'Avancé', 'Expert'][n] || `Niveau ${n}`;

function applyTheme() {
  const t = settings.theme;
  document.documentElement.dataset.theme = t === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : t;
  synth.setVolume?.(settings.volume);
}

// ---------- routeur ----------
const routes = [
  [/^$/, viewHome],
  [/^bibliotheque$/, viewLibrary],
  [/^morceau\/(.+)$/, viewSong],
  [/^jouer\/(.+)$/, viewPlay],
  [/^cours$/, viewCourses],
  [/^cours\/(.+)$/, viewCourse],
  [/^lecon\/(.+)$/, viewLesson],
  [/^parcours\/(.+)$/, viewSongCourse],
  [/^exercice\/([^/]+)\/(\d+)$/, viewExercise],
  [/^accordeur$/, viewTuner],
  [/^importer$/, viewImport],
  [/^progres$/, viewProgress],
  [/^reglages$/, viewSettings],
];

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  return { path: decodeURIComponent(path || ''), query: Object.fromEntries(new URLSearchParams(qs || '')) };
}

function route() {
  cleanup.forEach((f) => {
    try { f(); } catch (e) { console.error(e); }
  });
  cleanup = [];
  settings = store.settings();
  const { path, query } = parseHash();
  main.innerHTML = '';
  main.className = '';
  const top = path.split('/')[0] || 'home';
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === top || (top === 'morceau' && a.dataset.nav === 'bibliotheque') || ((top === 'lecon' || top === 'parcours') && a.dataset.nav === 'cours')));
  for (const [re, fn] of routes) {
    const m = path.match(re);
    if (m) {
      try {
        fn(...m.slice(1), query);
      } catch (err) {
        console.error(err);
        main.append(h('div', { class: 'card error' }, [h('h2', {}, 'Oups…'), h('p', {}, err.message), h('a', { href: '#/', class: 'btn' }, "Retour à l'accueil")]));
      }
      main.focus({ preventScroll: true });
      window.scrollTo(0, 0);
      return;
    }
  }
  main.append(h('div', { class: 'card' }, [h('h2', {}, 'Page introuvable'), h('a', { href: '#/', class: 'btn' }, 'Accueil')]));
}

function section(title, children, cls = '') {
  return h('section', { class: 'section ' + cls }, [title ? h('h2', {}, title) : null, ...[].concat(children)]);
}

// ---------- Accueil ----------
function viewHome() {
  const prog = store.progress();
  const last = Object.entries(prog).sort((a, b) => (b[1].last || 0) - (a[1].last || 0))[0];
  const lastSong = last && findSong(last[0]);
  const days = store.practiceDays();
  const today = days[new Date().toISOString().slice(0, 10)] || 0;
  const goal = settings.dailyGoalMin * 60;
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
      statCard('⏱️', Math.round(today / 60) + ' / ' + settings.dailyGoalMin + ' min', 'objectif du jour', Math.min(1, today / goal)),
      statCard('🎵', Object.keys(prog).length, 'morceaux travaillés'),
      statCard('🎓', Object.keys(store.lessonsDone()).length, 'leçons terminées'),
    ]),
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

function statCard(icon, value, label, ratio) {
  return h('div', { class: 'stat-card' }, [h('span', { class: 'icon' }, icon), h('b', {}, String(value)), h('small', {}, label), ratio != null ? h('div', { class: 'progress' }, h('div', { class: 'fill', style: `width:${ratio * 100}%` })) : null]);
}

function songCard(s) {
  if (!s) return h('div');
  const g = genreOf(s.genre);
  const p = store.progress()[s.id];
  const fav = store.favorites().includes(s.id);
  return h('a', { class: 'song-card', href: `#/morceau/${encodeURIComponent(s.id)}`, style: `--c:${g.color}` }, [
    h('div', { class: 'song-top' }, [h('span', { class: 'emoji' }, g.emoji), fav ? h('span', { class: 'fav' }, '♥') : null, p ? h('span', { class: 'stars' }, stars(p.stars)) : null]),
    h('b', { class: 'title' }, s.title),
    h('small', {}, s.composer || ''),
    h('div', { class: 'tags' }, [h('span', { class: 'tag lvl' + s.level }, levelLabel(s.level)), h('span', { class: 'tag' }, g.name), s.imported ? h('span', { class: 'tag' }, 'importé') : null]),
  ]);
}

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
      s.imported ? h('button', { class: 'btn danger', onclick: () => modal('Supprimer ?', `<p>Supprimer « ${escapeHtml(s.title)} » de ta bibliothèque ?</p>`, [{ label: 'Supprimer', primary: true, action: () => { store.removeFromLibrary(s.id); prepared.delete(s.id); location.hash = '#/bibliotheque'; } }, { label: 'Annuler' }]) }, '🗑 Supprimer') : null,
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
        keyDiagram(uniq.map((n) => ({ midi: n.midi, finger: n.finger, hand })), { labels: (m) => (m % 12 === 0 ? noteLabel(m, settings) : '') }),
        h('p', { class: 'small' }, describePosition(ns, hand, settings)),
        h('p', { class: 'seq' }, ns.slice(0, 40).map((n) => h('span', { class: 'n hand-' + hand }, [noteLabel(n.midi, { ...settings, octave: false }), h('sup', {}, n.finger || '')]))),
      ]));
    }
    list.append(h('details', { class: 'card phrase', open: i === 0, ontoggle: (e) => {
      if (e.target.open && !staffBox.firstChild) {
        const sv = new StaffView(staffBox);
        sv.render(s, ph.from, ph.to, { settings, showFingers: true, showNoteNames: settings.showNoteNames });
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

function startTrainer(s, query = {}, { back, onNext, title, subtitle } = {}) {
  main.className = 'wide';
  const bpm = s.beatsPerMeasure;
  const opts = {};
  if (query.mode) opts.mode = query.mode;
  if (query.hands && (query.hands === 'both' ? s.hands.R && s.hands.L : s.hands[query.hands])) opts.hands = query.hands;
  if (query.tempo) opts.tempoPct = Number(query.tempo);
  if (query.from) opts.from = (Number(query.from) - 1) * bpm;
  if (query.to) opts.to = Math.min(s.totalBeats, Number(query.to) * bpm);
  if (query.loop) opts.loop = true;
  main.append(h('div', { class: 'play-head' }, [
    h('a', { class: 'btn tiny', href: back || '#/bibliotheque' }, '← Retour'),
    h('div', {}, [h('h1', { class: 'h-small' }, title || s.title), subtitle ? h('p', { class: 'muted small' }, subtitle) : h('p', { class: 'muted small' }, `${s.composer || ''}${s.autoFingering ? ' · doigtés suggérés automatiquement' : ''}`)]),
  ]));
  const root = h('div');
  main.append(root);
  const t = new Trainer(root, s, opts, { onNext });
  cleanup.push(() => t.destroy());
  return t;
}

// ---------- Cours ----------
function viewCourses() {
  const done = store.lessonsDone();
  main.append(h('h1', {}, 'Cours'), h('p', { class: 'lead' }, 'Des leçons pas à pas pour chaque style, avec les touches, les doigtés et des exercices que l’app corrige en direct. Chaque morceau a aussi son propre cours progressif.'));
  const grid = h('div', { class: 'grid courses' });
  for (const c of COURSES) {
    const g = genreOf(c.genre);
    const n = c.lessons.length;
    const d = c.lessons.filter((l) => done[l.id]).length;
    grid.append(h('a', { class: 'course-card', href: `#/cours/${c.id}`, style: `--c:${g.color}` }, [
      h('span', { class: 'emoji' }, g.emoji), h('b', {}, c.title), h('p', { class: 'small' }, c.description),
      h('div', { class: 'progress' }, h('div', { class: 'fill', style: `width:${(d / n) * 100}%` })), h('small', {}, `${d}/${n} leçons`),
    ]));
  }
  main.append(grid);
  main.append(section('Cours d’un morceau précis', [
    h('p', {}, 'Choisis un morceau : l’app le découpe en phrases, te fait travailler chaque main lentement, puis ensemble, puis au tempo.'),
    h('div', { class: 'grid songs' }, SONGS.filter((s) => s.level <= 2).slice(0, 8).map((s) => {
      const c = songCard(findSong(s.id));
      c.href = `#/parcours/${s.id}`;
      return c;
    })),
  ]));
}

function viewCourse(id) {
  const c = getCourse(id);
  if (!c) throw new Error('Cours introuvable.');
  const g = genreOf(c.genre);
  const done = store.lessonsDone();
  main.append(h('a', { class: 'btn tiny', href: '#/cours' }, '← Tous les cours'), h('div', { class: 'song-header', style: `--c:${g.color}` }, [h('span', { class: 'emoji big' }, g.emoji), h('div', {}, [h('h1', {}, c.title), h('p', { class: 'muted' }, c.description)])]));
  main.append(h('ol', { class: 'lesson-list' }, c.lessons.map((l, i) => h('li', { class: done[l.id] ? 'done' : '' }, h('a', { href: `#/lecon/${l.id}` }, [h('span', { class: 'num' }, done[l.id] ? '✓' : i + 1), h('div', {}, [h('b', {}, l.title), h('small', {}, `${l.duration || 10} min · ${levelLabel(l.level || 1)}`)])])))));
  const songs = SONGS.filter((s) => s.genre === c.genre);
  if (songs.length) main.append(section('Morceaux de ce style', h('div', { class: 'grid songs' }, songs.map((s) => songCard(findSong(s.id))))));
}

function viewLesson(id) {
  const found = getLesson(id);
  if (!found) throw new Error('Leçon introuvable.');
  const { course, lesson } = found;
  const idx = course.lessons.findIndex((l) => l.id === id);
  const prev = course.lessons[idx - 1], next = course.lessons[idx + 1];
  const done = !!store.lessonsDone()[id];
  main.append(h('a', { class: 'btn tiny', href: `#/cours/${course.id}` }, `← ${course.title}`), h('h1', {}, lesson.title), h('p', { class: 'muted' }, `Leçon ${idx + 1}/${course.lessons.length} · ${lesson.duration || 10} min`));
  const art = h('article', { class: 'lesson' });
  lesson.blocks.forEach((b, i) => art.append(renderBlock(b, lesson, i)));
  main.append(art);
  const doneBtn = h('button', { class: 'btn' + (done ? ' on' : ' primary'), onclick: () => {
    const now = !store.lessonsDone()[id];
    store.markLesson(id, now);
    doneBtn.classList.toggle('on', now);
    doneBtn.classList.toggle('primary', !now);
    doneBtn.textContent = now ? '✓ Leçon terminée' : 'Marquer comme terminée';
    if (now) {
      synth.feedbackSound('success');
      toast('Bravo, leçon terminée ! 🎉');
    }
  } }, done ? '✓ Leçon terminée' : 'Marquer comme terminée');
  main.append(h('div', { class: 'row lesson-nav' }, [prev ? h('a', { class: 'btn', href: `#/lecon/${prev.id}` }, `← ${prev.title}`) : h('span'), doneBtn, next ? h('a', { class: 'btn primary', href: `#/lecon/${next.id}` }, `${next.title} →`) : h('a', { class: 'btn', href: `#/cours/${course.id}` }, 'Fin du cours ✓')]));
}

function renderBlock(b, lesson, i) {
  switch (b.type) {
    case 'text':
      return h('div', { class: 'block text', html: b.html });
    case 'tip':
      return h('div', { class: 'block tip', html: '💡 ' + b.html });
    case 'warning':
      return h('div', { class: 'block warning', html: '⚠️ ' + b.html });
    case 'keys': {
      const notes = (b.notes || []).map((n) => ({ midi: n.midi ?? nameToMidi(n.name), finger: n.finger, hand: n.hand || 'R' })).filter((n) => n.midi != null);
      const box = h('figure', { class: 'block keys' }, [b.title ? h('h4', {}, b.title) : null, keyDiagram(notes, { labels: (m) => (notes.some((n) => n.midi === m) || m % 12 === 0 ? noteLabel(m, { ...settings, octave: false }) : '') }), b.caption ? h('figcaption', {}, b.caption) : null,
        h('button', { class: 'btn tiny', onclick: () => notes.forEach((n, k) => synth.playNote(n.midi, { when: synth.audioContext().currentTime + k * 0.35, dur: 0.5, instrument: settings.instrument })) }, '🔊 Écouter')]);
      return box;
    }
    case 'quiz': {
      const out = h('p', { class: 'quiz-result', 'aria-live': 'polite' });
      return h('div', { class: 'block quiz' }, [h('b', {}, '❓ ' + b.question), h('div', { class: 'choices' }, b.choices.map((c, k) => h('button', { class: 'btn', onclick: (e) => {
        const ok = k === b.answer;
        e.target.classList.add(ok ? 'good' : 'bad');
        out.innerHTML = (ok ? '✅ Exact ! ' : '❌ Pas tout à fait. ') + escapeHtml(b.explain || '');
        synth.feedbackSound(ok ? 'success' : 'error');
      } }, c))), out]);
    }
    case 'practice': {
      const s = findSong(b.songId);
      if (!s) return h('div', { class: 'block warning' }, `Morceau « ${b.songId} » introuvable.`);
      const q = new URLSearchParams({ hands: b.hands || 'both', tempo: b.tempoPct || 100, mode: b.mode || 'wait' });
      return h('div', { class: 'block practice' }, [h('div', {}, [h('b', {}, '🎯 ' + (b.label || `Joue « ${s.title} »`)), h('small', {}, `${s.title} · ${b.hands === 'R' ? 'main droite' : b.hands === 'L' ? 'main gauche' : '2 mains'} · tempo ${b.tempoPct || 100} %`)]), h('a', { class: 'btn primary', href: `#/jouer/${s.id}?${q}` }, 'S’entraîner')]);
    }
    case 'exercise':
      return h('div', { class: 'block practice' }, [h('div', {}, [h('b', {}, '🏋️ ' + (b.title || b.label || 'Exercice')), b.label && b.title ? h('small', {}, b.label) : null]), h('a', { class: 'btn primary', href: `#/exercice/${lesson.id}/${i}` }, 'Faire l’exercice')]);
    default:
      return h('div');
  }
}

function viewExercise(lessonId, idx) {
  const found = getLesson(lessonId);
  const b = found?.lesson.blocks[Number(idx)];
  if (!b || b.type !== 'exercise') throw new Error('Exercice introuvable.');
  const s = prepareSong({ id: `ex-${lessonId}-${idx}`, title: b.title || 'Exercice', tracks: b.tracks, tempo: b.tempo || 80, timeSig: b.timeSig || [4, 4], genre: found.course.genre, ephemeral: false });
  prepared.set(s.id, s);
  startTrainer(s, { hands: b.hands || 'both' }, { back: `#/lecon/${lessonId}`, subtitle: b.label || found.lesson.title });
}

function viewSongCourse(id, query) {
  const s = findSong(id);
  if (!s) throw new Error('Morceau introuvable.');
  const steps = generateSongCourse(s);
  const key = 'parcours:' + id;
  const done = store.lessonsDone();
  const stepIdx = query.step != null ? Number(query.step) : -1;
  if (stepIdx >= 0 && steps[stepIdx]) {
    const st = steps[stepIdx];
    const bpm = s.beatsPerMeasure;
    const t = startTrainer(s, {
      mode: st.mode, hands: st.hands, tempo: st.tempoPct,
      from: Math.floor(st.from / bpm + 1e-6) + 1, to: Math.ceil(st.to / bpm - 1e-6),
    }, {
      back: `#/parcours/${id}`, title: `${s.title} — étape ${stepIdx + 1}/${steps.length}`, subtitle: `${st.title}. ${st.desc}`,
      onNext: steps[stepIdx + 1] ? () => (location.hash = `#/parcours/${id}?step=${stepIdx + 1}`) : null,
    });
    t.hooks.onResult = (sum) => {
      if (sum.score >= 80) store.markLesson(`${key}:${st.id}`);
    };
    return;
  }
  main.append(h('a', { class: 'btn tiny', href: `#/morceau/${id}` }, '← ' + s.title), h('h1', {}, `Apprendre « ${s.title} »`), h('p', { class: 'lead' }, `Un parcours en ${steps.length} étapes. Une étape est validée quand tu obtiens au moins 80 %.`));
  main.append(h('ol', { class: 'lesson-list' }, steps.map((st, i) => {
    const ok = done[`${key}:${st.id}`];
    return h('li', { class: ok ? 'done' : '' }, h('a', { href: `#/parcours/${id}?step=${i}` }, [h('span', { class: 'num' }, ok ? '✓' : i + 1), h('div', {}, [h('b', {}, st.title), h('small', {}, st.desc)]), h('span', { class: 'tag' }, { wait: 'Attente', tempo: 'Tempo', listen: 'Écoute' }[st.mode] + ` · ${st.tempoPct} %`)]));
  })));
}

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
    section('Note de référence', [h('p', { class: 'small' }, 'Clique une touche pour entendre la note (La4 = ' + settings.a4 + ' Hz).'), kbEl]));
  const kb = new PianoKeyboard(kbEl, { onNoteOn: (m) => synth.playNote(m, { dur: 1.5, a4: settings.a4, instrument: settings.instrument }), onNoteOff: () => {}, label: (m) => (m % 12 === 0 ? noteLabel(m, settings) : '') });
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
      history.prepend(h('span', { class: 'chip' }, noteLabel(e.midi, settings)));
      while (history.children.length > 24) history.lastChild.remove();
      kb.flash(e.midi, 'hit');
    }
    if (e.type !== 'frame') return;
    const f = smooth.push(e.freq && e.clarity > 0.8 ? e.freq : null);
    if (f) {
      const midiF = 69 + 12 * Math.log2(f / settings.a4);
      const m = Math.round(midiF);
      const c = Math.round(centsOff(f, m, settings.a4));
      noteEl.textContent = noteLabel(m, settings);
      noteEl.classList.toggle('in-tune', Math.abs(c) <= 5);
      freqEl.textContent = `${f.toFixed(1)} Hz · ${c > 0 ? '+' : ''}${c} cents · ${midiToName(m, { lang: settings.notation === 'fr' ? 'en' : 'fr' })}`;
      needle.style.left = 50 + Math.max(-50, Math.min(50, c)) + '%';
      needle.classList.toggle('in-tune', Math.abs(c) <= 5);
      lastNote = m;
    } else if (e.rms < 0.005) noteEl.classList.remove('in-tune');
    if (++frameN % 3 === 0) {
      const mag = mic.spectrum();
      if (mag) {
        drawSpectrum(canvas, mag, mic.sampleRate);
        const notes = e.rms > 0.01 ? estimateNotes(mag, mic.sampleRate, { a4: settings.a4 }) : [];
        poly.textContent = notes.length ? notes.map((m) => noteLabel(m, settings)).join(' · ') : '—';
      }
    }
  });
  cleanup.push(off);
  async function toggle() {
    try {
      if (mic.running) mic.stop();
      else {
        mic.a4 = settings.a4;
        mic.setSensitivity(settings.micSensitivity);
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

// ---------- Import ----------
function viewImport() {
  const result = h('div');
  const input = h('input', { type: 'file', accept: SUPPORTED_FORMATS.flatMap((f) => f.ext.split(/[\s,/]+/)).filter((x) => x.startsWith('.')).join(',') + ',.pdf,.png,.jpg,.jpeg,.mp3,.wav,.ogg,.m4a,.flac,.webm,audio/*', multiple: true, class: 'hidden', onchange: (e) => handleFiles(e.target.files) });
  const drop = h('label', { class: 'dropzone', tabindex: 0 }, [h('span', { class: 'emoji big' }, '📂'), h('b', {}, 'Dépose ta partition ici'), h('span', {}, 'ou clique pour choisir un fichier'), h('small', { class: 'muted' }, SUPPORTED_FORMATS.map((f) => f.ext).join(' · ')), input]);
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); handleFiles(e.dataTransfer.files); });
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });

  const ta = h('textarea', { rows: 8, placeholder: 'Colle ici une partition ABC, du MusicXML, ou le format texte :\n\ntitre: Ma mélodie\ntempo: 90\nMD: C4:1:1 D4:1:2 E4:1:3 F4:1:4 G4:4:5\nMG: C3:4:5 G2:4:1', 'aria-label': 'Partition en texte' });
  const formats = h('table', { class: 'formats' }, [h('tr', {}, [h('th', {}, 'Format'), h('th', {}, 'Extension'), h('th', {}, 'Détails')]), ...SUPPORTED_FORMATS.map((f) => h('tr', {}, [h('td', {}, f.label), h('td', { class: 'mono' }, f.ext), h('td', {}, f.description)]))]);

  main.append(h('h1', {}, 'Importer une partition'),
    h('p', { class: 'lead' }, 'Importe ta propre partition — ou même un enregistrement audio (mp3, wav…) : l’app le transcrit, calcule les doigtés, sépare les mains et crée un cours pas à pas.'),
    drop, result,
    section('Coller du texte', [ta, h('button', { class: 'btn primary', onclick: async () => {
      try {
        const raw = await importScoreText(ta.value, 'collage');
        showPreview(raw);
      } catch (err) {
        showError(err);
      }
    } }, 'Analyser le texte')]),
    section('Exemples à essayer', h('div', { class: 'row' }, ['exemple.musicxml', 'exemple.mid', 'exemple.abc', 'exemple.txt'].map((f) => h('button', { class: 'btn', onclick: async () => {
      try {
        const res = await fetch('samples/' + f);
        if (!res.ok) throw new Error('Fichier exemple introuvable');
        const blob = await res.blob();
        handleFiles([new File([blob], f)]);
      } catch (err) {
        showError(err);
      }
    } }, f)))),
    section('Créer en jouant', recorderPanel()),
    section('Formats acceptés', [formats, h('div', { class: 'block tip', html: '💡 <b>Partition papier ou PDF ?</b> La reconnaissance optique de partitions demande un logiciel spécialisé. Utilise gratuitement <b>MuseScore 4</b> (Fichier → Importer PDF) ou <b>Audiveris</b>, puis exporte en <b>MusicXML</b> et importe-le ici. Tu peux aussi trouver des milliers de partitions libres en MusicXML/MIDI sur <b>IMSLP</b>, <b>MuseScore.com</b> (domaine public) ou <b>Mutopia</b>.' })]),
  );

  async function handleFiles(files) {
    for (const file of files) {
      const bar = h('div', { class: 'fill' });
      const wait = h('div', { class: 'card' }, [h('b', {}, `Analyse de « ${file.name} »…`), h('div', { class: 'progress' }, bar)]);
      result.prepend(wait);
      try {
        const raw = await importScoreFile(file, { onProgress: (f) => (bar.style.width = Math.round(f * 100) + '%') });
        wait.remove();
        showPreview(raw, file.name);
      } catch (err) {
        wait.remove();
        showError(err, file.name);
      }
    }
  }

  function showError(err, name) {
    result.prepend(h('div', { class: 'card error' }, [h('b', {}, name ? `Impossible d’importer « ${name} »` : 'Import impossible'), h('p', {}, err.message || String(err))]));
  }

  function showPreview(raw, name) {
    let s;
    try {
      s = prepareSong({ ...raw, id: 'imp-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) });
    } catch (err) {
      return showError(err, name);
    }
    if (!s.notes.length) return showError(new Error('Aucune note trouvée dans ce fichier.'), name);
    const title = h('input', { value: s.title || name || 'Sans titre', 'aria-label': 'Titre' });
    const composer = h('input', { value: s.composer && s.composer !== 'Inconnu' ? s.composer : '', placeholder: 'Compositeur', 'aria-label': 'Compositeur' });
    const tempo = h('input', { type: 'number', min: 20, max: 300, value: Math.round(s.tempo), class: 'num', 'aria-label': 'Tempo' });
    const genre = h('select', { 'aria-label': 'Genre' }, GENRES.map((g) => h('option', { value: g.id, selected: g.id === s.genre }, g.name)));
    const level = h('select', { 'aria-label': 'Niveau' }, [1, 2, 3, 4, 5].map((l) => h('option', { value: l, selected: l === (s.level || estimateLevel(s)) }, levelLabel(l))));
    const split = h('label', { class: 'check' }, [h('input', { type: 'checkbox', checked: !s.hands.L }), 'Répartir les mains au Do central']);
    const staffBox = h('div', { class: 'staff-box' });
    const card = h('div', { class: 'card preview' }, [
      h('h3', {}, (raw.transcribed ? '🎧 Musique transcrite' : '✅ Partition lue') + (name ? ` : ${name}` : '')),
      raw.transcribed ? h('div', { class: 'block warning', html: '⚠️ Partition obtenue par <b>transcription automatique</b> de l’audio : elle peut contenir des erreurs (surtout avec plusieurs instruments ou beaucoup d’accords). Écoute-la et ajuste le tempo avant de l’ajouter.' }) : null,
      h('p', {}, `${s.notes.length} notes · ${s.measureCount} mesures · ${s.timeSig[0]}/${s.timeSig[1]} · ${s.hands.R && s.hands.L ? '2 mains' : '1 main'}${s.autoFingering ? ' · doigtés calculés automatiquement' : ' · doigtés de la partition'}`),
      h('div', { class: 'form-grid' }, [h('label', {}, ['Titre', title]), h('label', {}, ['Compositeur', composer]), h('label', {}, ['Tempo (♩/min)', tempo]), h('label', {}, ['Genre', genre]), h('label', {}, ['Niveau', level])]),
      split, staffBox,
      h('div', { class: 'row' }, [h('button', { class: 'btn primary', onclick: save }, '💾 Ajouter à ma bibliothèque'), h('button', { class: 'btn', onclick: () => card.remove() }, 'Annuler')]),
    ]);
    result.prepend(card);
    requestAnimationFrame(() => new StaffView(staffBox).render(s, 0, Math.min(s.totalBeats, s.beatsPerMeasure * 4), { settings, showFingers: true }));

    function save() {
      let notes = s.notes.map(({ midi, start, dur, hand, finger }) => ({ midi, start, dur, hand, finger: s.autoFingering ? null : finger }));
      if (split.querySelector('input').checked) notes = notes.map((n) => ({ ...n, hand: n.midi >= 60 ? 'R' : 'L', finger: null }));
      const out = { id: s.id, title: title.value || 'Sans titre', composer: composer.value || 'Inconnu', tempo: Number(tempo.value) || s.tempo, timeSig: s.timeSig, keyFifths: s.keyFifths || 0, genre: genre.value, level: Number(level.value), description: 'Partition importée.', notes };
      if (!store.saveToLibrary(out)) return toast('Espace de stockage plein : supprime d’anciens imports.');
      prepared.delete(out.id);
      toast('Partition ajoutée ! Un cours pas à pas a été créé pour elle.');
      location.hash = `#/morceau/${out.id}`;
    }
  }
}

function estimateLevel(s) {
  const density = s.notes.length / Math.max(1, s.totalBeats);
  const both = s.hands.R && s.hands.L;
  const chords = s.notes.length - new Set(s.notes.map((n) => n.start + n.hand)).size;
  let lvl = 1 + (density > 1.2) + (density > 2.2) + both + (chords > s.notes.length * 0.2);
  return Math.max(1, Math.min(5, lvl));
}

/** Enregistre ce que tu joues (MIDI, clavier, souris) et le transforme en partition. */
function recorderPanel() {
  let rec = null;
  const status = h('span', { class: 'muted' }, 'Prêt');
  const tempo = h('input', { type: 'number', value: 90, min: 30, max: 240, class: 'num', 'aria-label': 'Tempo' });
  const kbEl = h('div', { class: 'kb small-kb' });
  const btn = h('button', { class: 'btn primary', onclick: () => (rec ? stop() : start()) }, '⏺ Enregistrer');
  const kb = new PianoKeyboard(kbEl, { onNoteOn: (m) => on(m), onNoteOff: (m) => off(m), label: (m) => (m % 12 === 0 ? noteLabel(m, settings) : '') });
  kb.setRange(48, 84);
  const unsub = [midiInput.on((e) => (e.type === 'noteon' ? on(e.midi) : e.type === 'noteoff' && off(e.midi))), computerKeyboard.on((e) => (e.type === 'noteon' ? (on(e.midi), kb.press(e.midi)) : e.type === 'noteoff' && (off(e.midi), kb.release(e.midi))))];
  cleanup.push(() => { unsub.forEach((f) => f()); clearInterval(rec?.timer); });
  midiInput.init().catch(() => {});
  function on(m) {
    synth.playNote(m, { dur: 3, instrument: settings.instrument });
    if (rec) rec.open.set(m, performance.now());
  }
  function off(m) {
    synth.releaseNote(m);
    if (!rec || !rec.open.has(m)) return;
    rec.notes.push({ midi: m, t0: rec.open.get(m), t1: performance.now() });
    rec.open.delete(m);
  }
  function start() {
    const bpm = Number(tempo.value) || 90;
    rec = { notes: [], open: new Map(), t: performance.now() + (60000 / bpm) * 4, bpm };
    const ac = synth.audioContext();
    for (let i = 0; i < 64; i++) synth.click(ac.currentTime + (i * 60) / bpm, i % 4 === 0);
    rec.timer = setInterval(() => { status.textContent = rec.t > performance.now() ? 'Décompte…' : `⏺ ${(((performance.now() - rec.t) / 1000) | 0)} s`; }, 200);
    btn.textContent = '⏹ Arrêter';
    btn.classList.add('danger');
  }
  function stop() {
    clearInterval(rec.timer);
    synth.stopAll();
    for (const [m] of rec.open) off(m);
    const spb = 60000 / rec.bpm;
    const q = (x) => Math.round(x * 4) / 4;
    const notes = rec.notes.map((n) => ({ midi: n.midi, start: Math.max(0, q((n.t0 - rec.t) / spb)), dur: Math.max(0.25, q((n.t1 - n.t0) / spb)), hand: n.midi >= 60 ? 'R' : 'L' })).filter((n) => n.start >= 0);
    btn.textContent = '⏺ Enregistrer';
    btn.classList.remove('danger');
    status.textContent = `${notes.length} notes enregistrées`;
    const bpm = rec.bpm;
    rec = null;
    if (!notes.length) return toast('Rien enregistré : joue sur un clavier MIDI, le clavier de l’ordinateur ou les touches ci-dessous.');
    const id = 'rec-' + Date.now().toString(36);
    store.saveToLibrary({ id, title: 'Mon enregistrement ' + new Date().toLocaleString('fr-FR'), composer: 'Moi', tempo: bpm, timeSig: [4, 4], genre: 'pop', level: 1, description: 'Créé en jouant.', notes });
    toast('Enregistrement ajouté à ta bibliothèque !');
    location.hash = '#/morceau/' + id;
  }
  return [h('p', { class: 'small' }, 'Joue une mélodie (clavier MIDI, clavier d’ordinateur ou souris) : l’app l’enregistre au métronome (1 mesure de décompte) et en fait une partition avec doigtés.'), h('div', { class: 'row' }, [btn, h('label', { class: 'field' }, ['Tempo ', tempo]), status]), kbEl];
}

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
    const k = d.toISOString().slice(0, 10);
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
        prepared.clear();
        toast('Sauvegarde importée !');
        route();
      } catch {
        toast('Fichier de sauvegarde invalide.');
      }
    } })]),
  ])]));
}

// ---------- Réglages ----------
function viewSettings() {
  const s = { ...settings };
  const save = () => {
    store.saveSettings(s);
    settings = s;
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
  cleanup.push(offMic);
  main.append(h('h1', {}, 'Réglages'),
    section('Affichage', h('div', { class: 'settings' }, [
      sel('notation', [['fr', 'Do Ré Mi (français)'], ['en', 'C D E (anglais)']], 'Nom des notes'),
      sel('theme', [['auto', 'Automatique'], ['dark', 'Sombre'], ['light', 'Clair']], 'Thème'),
      sel('view', [['both', 'Portée + notes qui tombent'], ['staff', 'Portée seule'], ['roll', 'Notes qui tombent seules']], 'Vue d’entraînement'),
      chk('showFingers', 'Afficher les doigtés'), chk('showNoteNames', 'Afficher le nom des notes'), chk('showKeyboardLabels', 'Afficher les touches du clavier d’ordinateur sur le piano'),
    ])),
    section('Son', h('div', { class: 'settings' }, [
      sel('instrument', synth.INSTRUMENT_LIST, 'Instrument'), num('volume', 'Volume', 0, 1, 0.05), chk('metronome', 'Métronome activé par défaut'), chk('countIn', 'Décompte d’une mesure en mode Tempo'),
      h('button', { class: 'btn', onclick: () => [60, 64, 67, 72].forEach((m, i) => synth.playNote(m, { when: synth.audioContext().currentTime + i * 0.2, dur: 0.6, instrument: s.instrument, velocity: 0.7 })) }, '🔊 Tester le son'),
    ])),
    section('Micro & détection', h('div', { class: 'settings' }, [
      num('a4', 'Diapason La4', 415, 466, 1, ' Hz'), num('micSensitivity', 'Seuil du micro (plus bas = plus sensible)', 0.003, 0.05, 0.001),
      h('div', { class: 'setting' }, [h('span', {}, 'Niveau du micro'), level, h('button', { class: 'btn tiny', onclick: async () => { try { await mic.start(); } catch (e) { toast(e.message); } } }, 'Tester')]),
      chk('octaveTolerant', 'Tolérer les erreurs d’octave au micro', 'Le micro confond parfois une note avec son octave : recommandé.'),
      num('latencyMs', 'Compensation de latence', 0, 300, 5, ' ms'),
    ])),
    section('Objectifs', h('div', { class: 'settings' }, [num('dailyGoalMin', 'Objectif quotidien', 5, 120, 5, ' min')])),
    section('Données', h('div', { class: 'row' }, [
      h('button', { class: 'btn', onclick: () => { store.saveSettings(DEFAULT_SETTINGS); settings = { ...DEFAULT_SETTINGS }; applyTheme(); route(); } }, 'Réglages par défaut'),
      h('button', { class: 'btn danger', onclick: () => modal('Tout effacer ?', '<p>Progrès, imports et réglages seront supprimés de ce navigateur.</p>', [{ label: 'Tout effacer', primary: true, action: () => { Object.keys(localStorage).filter((k) => k.startsWith('pianocoach.')).forEach((k) => localStorage.removeItem(k)); prepared.clear(); location.hash = '#/'; location.reload(); } }, { label: 'Annuler' }]) }, 'Effacer toutes mes données'),
    ])),
  );
}

// ---------- démarrage ----------
applyTheme();
matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', applyTheme);
computerKeyboard.attach();
window.addEventListener('hashchange', route);
route();
// Débloque l'audio au premier geste (politique des navigateurs)
window.addEventListener('pointerdown', () => synth.audioContext(), { once: true });
window.addEventListener('keydown', () => synth.audioContext(), { once: true });

// Mode hors-ligne (PWA) si disponible
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Exposé pour le débogage et les tests automatisés
window.PianoCoach = { findSong, store, route };
