// Vue : accueil (+ séance du jour #/seance)
import { GENRES, SONGS } from '../data/songs.js';
import { COURSES } from '../data/lessons.js';
import { prepareSong } from '../core/song.js';
import { generateSongCourse } from '../core/coursegen.js';
import { store, localDate } from '../core/storage.js';
import { buildDailyPlan, planProgress, currentParcoursSong, minutesLeft } from '../core/plan.js';
import { h, toast, speak } from '../ui/dom.js';
import { ctx, main, registerRoute, findSong, section, statCard, songCard, startTrainer, homeSections } from '../ui/context.js';

/** Exécute une fonction d'affichage sans jamais casser la page (l'accueil ne doit jamais rester vide). */
function safe(fn) {
  try {
    return fn();
  } catch (e) {
    console.error(e);
    return null;
  }
}

// ---------- séance du jour ----------
function lessonList() {
  try {
    return (COURSES || []).flatMap((c) => c.lessons.map((l) => ({ id: l.id, title: l.title, duration: l.duration })));
  } catch {
    return [];
  }
}

function currentParcours(lessonsDone) {
  const id = currentParcoursSong(lessonsDone);
  const s = id && findSong(id);
  if (!s) return null;
  return { songId: id, title: s.title, steps: generateSongCourse(s) };
}

export function todayPlan() {
  const lessonsDone = store.lessonsDone();
  return buildDailyPlan({
    progress: store.progress(),
    lessonsDone,
    lessons: lessonList(),
    parcours: safe(() => currentParcours(lessonsDone)),
    songInfo: (id) => {
      const s = findSong(id);
      return s ? { title: s.title, measureCount: s.measureCount } : null;
    },
    kid: !!ctx.settings.kidMode,
  });
}

/** Une étape compte comme faite si elle est cochée, ou si sa leçon / étape de parcours est validée. */
function doneIds(steps) {
  const st = store.planState();
  const lessons = store.lessonsDone();
  const done = new Set(st.done);
  for (const s of steps) {
    if (s.kind === 'lesson' && lessons[s.data.lessonId] && localDate(new Date(lessons[s.data.lessonId])) === localDate()) done.add(s.id);
    if (s.kind === 'parcours' && lessons[s.id]) done.add(s.id);
  }
  return [...done];
}

function planCard() {
  const steps = todayPlan();
  const done = doneIds(steps);
  const prog = planProgress(steps, done);
  const list = h('ol', { class: 'plan-steps' }, steps.map((s) => {
    const isDone = done.includes(s.id);
    const id = 'plan-' + s.id.replace(/[^a-z0-9]/gi, '-');
    return h('li', { class: 'plan-step' + (isDone ? ' done' : '') }, [
      h('input', { type: 'checkbox', id, checked: isDone, onchange: (e) => { store.setPlanStep(s.id, e.target.checked); ctx.route(); } }),
      h('label', { for: id }, [h('b', {}, s.title), h('small', {}, `${s.desc} · ~${s.minutes} min`)]),
      h('a', { class: 'btn tiny', href: `#/seance?step=${encodeURIComponent(s.id)}` }, 'Go'),
    ]);
  }));
  const minutes = steps.reduce((a, s) => a + s.minutes, 0);
  return h('section', { class: 'card plan-card', 'aria-labelledby': 'plan-title' }, [
    h('div', { class: 'plan-head' }, [
      h('div', {}, [h('h2', { id: 'plan-title' }, prog.complete ? 'Séance du jour terminée ! 🎉' : 'Ta séance du jour'), h('p', { class: 'small muted' }, `${prog.done}/${prog.total} étapes · environ ${minutes} min`)]),
      prog.complete ? null : h('a', { class: 'btn primary', href: '#/seance?step=' + encodeURIComponent(steps[Math.max(0, prog.next)].id) }, prog.done ? '▶ Continuer' : '▶ Lancer'),
    ]),
    h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': prog.total, 'aria-valuenow': prog.done, 'aria-label': 'Avancement de la séance' }, h('div', { class: 'fill', style: `width:${prog.total ? (prog.done / prog.total) * 100 : 0}%` })),
    list,
  ]);
}

function warmupSong() {
  return prepareSong({
    id: 'seance-echauffement', title: 'Échauffement : 5 doigts en Do', tempo: 80, timeSig: [4, 4], genre: 'divers', ephemeral: true,
    tracks: {
      R: 'C4:1:1 D4:1:2 E4:1:3 F4:1:4 | G4:1:5 F4:1:4 E4:1:3 D4:1:2 | C4:4:1 | r:4 | r:4 | r:4 | r:4 | r:4',
      L: 'r:4 | r:4 | r:4 | r:4 | C3:1:5 D3:1:4 E3:1:3 F3:1:2 | G3:1:1 F3:1:2 E3:1:3 D3:1:4 | C3:4:5',
    },
  });
}

function viewSession(query) {
  const steps = todayPlan();
  const done = doneIds(steps);
  const i = Math.max(0, steps.findIndex((s) => s.id === query.step));
  const step = steps[i];
  const nextStep = steps.slice(i + 1).find((s) => !done.includes(s.id));
  const goNext = () => {
    store.setPlanStep(step.id, true);
    location.hash = nextStep ? '#/seance?step=' + encodeURIComponent(nextStep.id) : '#/';
    if (!nextStep) toast('Séance du jour terminée, bravo ! 🎉');
  };
  const sub = `Séance du jour — étape ${i + 1}/${steps.length}`;
  speak(`${sub}. ${step.title}`);
  if (step.kind === 'warmup') {
    const s = warmupSong();
    ctx.prepared.set(s.id, s);
    const t = startTrainer(s, {}, { back: '#/', onNext: goNext, title: step.title, subtitle: sub });
    t.hooks.onResult = () => store.setPlanStep(step.id, true);
    return;
  }
  if (step.kind === 'review') {
    const s = findSong(step.data.songId);
    const r = step.data.range;
    const q = r ? { from: r.from, to: r.to, loop: '1', tempo: 70 } : { tempo: 80 };
    const t = startTrainer(s, q, { back: '#/', onNext: goNext, title: step.title, subtitle: `${sub} · ${step.desc}` });
    t.hooks.onResult = (sum) => sum.score >= 70 && store.setPlanStep(step.id, true);
    return;
  }
  if (step.kind === 'parcours') {
    const s = findSong(step.data.songId);
    const st = generateSongCourse(s)[step.data.index];
    const bpm = s.beatsPerMeasure;
    const t = startTrainer(s, { mode: st.mode, hands: st.hands, tempo: st.tempoPct, from: Math.floor(st.from / bpm + 1e-6) + 1, to: Math.ceil(st.to / bpm - 1e-6) }, { back: '#/', onNext: goNext, title: step.title, subtitle: `${sub} · ${st.title}` });
    t.hooks.onResult = (sum) => {
      if (sum.score >= 80) {
        store.markLesson(step.id);
        store.setPlanStep(step.id, true);
      }
    };
    return;
  }
  // leçon : c'est une page à part entière
  main.append(h('div', { class: 'card plan-card' }, [
    h('p', { class: 'small muted' }, sub), h('h1', {}, step.title), h('p', {}, step.desc),
    h('div', { class: 'row' }, [
      h('a', { class: 'btn primary big', href: step.href, onclick: () => store.setPlanStep(step.id, true) }, '▶ Ouvrir la leçon'),
      h('a', { class: 'btn', href: '#/' }, 'Retour à l’accueil'),
    ]),
  ]));
}

// ---------- accueil ----------
function greeting() {
  const p = store.currentProfile();
  const hour = new Date().getHours();
  const hello = hour >= 18 || hour < 5 ? 'Bonsoir' : 'Bonjour';
  return `${hello} ${p.name === 'Moi' ? '' : p.name + ' '}${p.avatar}`.replace(/\s+/g, ' ');
}

function goalBanner(todaySec, goalMin) {
  const left = minutesLeft(todaySec, goalMin);
  const info = store.streakInfo();
  const msg = left <= 0 ? `Objectif du jour atteint ! 🎯 Série : ${info.streak} jour${info.streak > 1 ? 's' : ''} 🔥` : todaySec > 0 ? `Encore ${left} min pour ton objectif !` : `${goalMin} min de piano aujourd’hui ? C’est parti !`;
  return h('p', { class: 'goal-banner' + (left <= 0 ? ' ok' : ''), 'aria-live': 'polite' }, [msg, info.freezes ? h('span', { class: 'chip', title: 'Gels de série : protègent ta série un jour d’absence' }, '❄️ × ' + info.freezes) : null]);
}

function viewHome() {
  const prog = store.progress();
  const last = Object.entries(prog).filter(([id]) => !id.startsWith('seance-')).sort((a, b) => (b[1].last || 0) - (a[1].last || 0))[0];
  const lastSong = last && safe(() => findSong(last[0]));
  const days = store.practiceDays();
  const today = days[localDate()] || 0;
  const goalMin = ctx.settings.dailyGoalMin || 15;
  const goal = goalMin * 60;
  const dayIdx = Math.floor(Date.now() / 86400000);
  const songOfDay = SONGS[dayIdx % SONGS.length];
  const firstLesson = safe(() => COURSES[0]?.lessons[0]?.id) || '';

  main.append(
    h('div', { class: 'hero' }, [
      h('div', {}, [
        h('p', { class: 'hello' }, greeting()),
        h('h1', {}, ['Apprends le piano,', h('br'), h('span', { class: 'grad' }, 'note après note.')]),
        safe(() => goalBanner(today, goalMin)),
        h('div', { class: 'row' }, [
          h('a', { class: 'btn primary big', href: lastSong ? `#/jouer/${lastSong.id}` : '#/lecon/' + firstLesson }, lastSong ? `▶ Continuer « ${lastSong.title} »` : '▶ Commencer les bases'),
          h('a', { class: 'btn big', href: '#/bibliotheque' }, '🎼 Choisir un morceau'),
          ctx.settings.kidMode ? null : h('a', { class: 'btn big', href: '#/importer' }, '📂 Importer une partition'),
        ]),
      ]),
      h('div', { class: 'hero-piano', 'aria-hidden': 'true' }, Array.from({ length: 14 }, (_, i) => h('span', { style: `--i:${i}` }))),
    ]),
    h('div', { class: 'grid stats-grid' }, [
      statCard('🔥', store.streak(), 'jours d’affilée'),
      statCard('⏱️', Math.round(today / 60) + ' / ' + goalMin + ' min', 'objectif du jour', Math.min(1, today / goal)),
      statCard('🏅', Object.keys(store.badges()).length, 'badges', null),
      statCard('🎓', Object.keys(store.lessonsDone()).filter((k) => !k.startsWith('parcours:')).length, 'leçons terminées'),
    ]),
  );
  const plan = safe(planCard);
  if (plan) main.append(plan);
  main.append(
    ...homeSections.map((f) => safe(f)).filter(Boolean),
    section('Morceau du jour', safe(() => songCard(findSong(songOfDay.id)))),
    section('Explore par genre', h('div', { class: 'grid genres' }, GENRES.map((g) => h('a', { class: 'genre-card', href: `#/bibliotheque?genre=${g.id}`, style: `--c:${g.color}` }, [h('span', { class: 'emoji' }, g.emoji), h('b', {}, g.name), h('small', {}, `${SONGS.filter((s) => s.genre === g.id).length} morceaux`)])))),
    section('Comment ça marche ?', h('ol', { class: 'steps' }, [
      h('li', {}, [h('b', {}, 'Choisis'), ' un morceau gratuit ou importe ta partition (MusicXML, MIDI, ABC…).']),
      h('li', {}, [h('b', {}, 'Branche'), ' ton clavier MIDI, ou active le micro devant ton piano acoustique.']),
      h('li', {}, [h('b', {}, 'Joue'), ' : en mode Attente la partition attend la bonne note ; en mode Tempo elle défile en rythme.']),
      h('li', {}, [h('b', {}, 'Progresse'), ' avec les cours guidés : mains séparées, tempo lent, puis morceau complet.']),
    ])),
  );
}

registerRoute(/^$/, viewHome);
registerRoute(/^seance$/, viewSession);
