// Vue : courses
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
      const box = h('figure', { class: 'block keys' }, [b.title ? h('h4', {}, b.title) : null, keyDiagram(notes, { labels: (m) => (notes.some((n) => n.midi === m) || m % 12 === 0 ? noteLabel(m, { ...ctx.settings, octave: false }) : '') }), b.caption ? h('figcaption', {}, b.caption) : null,
        h('button', { class: 'btn tiny', onclick: () => notes.forEach((n, k) => synth.playNote(n.midi, { when: synth.audioContext().currentTime + k * 0.35, dur: 0.5, instrument: ctx.settings.instrument })) }, '🔊 Écouter')]);
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
  ctx.prepared.set(s.id, s);
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

registerRoute(/^cours$/, viewCourses)
registerRoute(/^cours\/(.+)$/, viewCourse)
registerRoute(/^lecon\/(.+)$/, viewLesson)
registerRoute(/^parcours\/(.+)$/, viewSongCourse)
registerRoute(/^exercice\/([^/]+)\/(\d+)$/, viewExercise)
