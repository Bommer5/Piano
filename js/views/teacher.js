// Vue : carnet du professeur (#/carnet) — mesures difficiles, notes ratées, objectifs de la
// semaine, remarques, compte rendu imprimable.
import { store, localDate, addDays } from '../core/storage.js';
import { weakMeasures, weakNotes } from '../core/plan.js';
import { noteLabel } from '../core/notes.js';
import { h, toast, stars } from '../ui/dom.js';
import { ctx, main, registerRoute, findSong, allSongs, section, withDeps } from '../ui/context.js';

// Modules propres à cette page : chargés à la première visite (allègent le démarrage).
let StaffView;
async function loadDeps() {
  const [m0] = await Promise.all([import('../ui/staff.js')]);
  ({ StaffView } = m0);
}

const SESSIONS = 10;

function heatClass(v, max) {
  if (!v) return 'h0';
  const r = v / max;
  return r > 0.75 ? 'h4' : r > 0.5 ? 'h3' : r > 0.25 ? 'h2' : 'h1';
}

/** Agrège les erreurs par mesure des dernières sessions. */
function measureErrors(entry) {
  const agg = {};
  for (const x of (entry.history || []).slice(-SESSIONS)) {
    for (const [m, n] of Object.entries(x.errorsByMeasure || {})) agg[m] = (agg[m] || 0) + n;
    if (!x.errorsByMeasure) for (const w of x.worstMeasures || []) agg[w.measure] = (agg[w.measure] || 0) + (w.errors || 1);
  }
  return agg;
}

/** Portée d'un passage avec les mesures colorées selon le nombre d'erreurs. */
function heatStaff(song, fromM, toM, agg, max) {
  const box = h('div', { class: 'heat-staff' });
  // rendu après insertion (StaffView mesure la largeur du conteneur)
  requestAnimationFrame(() => {
    try {
      const sv = new StaffView(box);
      const bpm = song.beatsPerMeasure;
      sv.render(song, (fromM - 1) * bpm, toM * bpm, { settings: ctx.settings, showNoteNames: false, showFingers: false });
      const svg = sv.svg;
      const ns = 'http://www.w3.org/2000/svg';
      for (let m = fromM; m <= toM; m++) {
        const v = agg[m] || 0;
        if (!v) continue;
        const x1 = sv.xOf((m - 1) * bpm) - 8, x2 = sv.xOf(m * bpm) - 8;
        const r = document.createElementNS(ns, 'rect');
        r.setAttribute('x', x1);
        r.setAttribute('y', 6);
        r.setAttribute('width', Math.max(0, x2 - x1));
        r.setAttribute('height', 190);
        r.setAttribute('class', 'heat-rect ' + heatClass(v, max));
        const t = document.createElementNS(ns, 'title');
        t.textContent = `Mesure ${m} : ${v} erreur${v > 1 ? 's' : ''}`;
        r.append(t);
        svg.insertBefore(r, svg.firstChild);
      }
    } catch (e) {
      console.error(e);
    }
  });
  return box;
}

function songReport(id, entry) {
  const song = findSong(id);
  if (!song) return null;
  const agg = measureErrors(entry);
  const max = Math.max(1, ...Object.values(agg));
  const strip = h('div', { class: 'heat-strip', role: 'list', 'aria-label': `Erreurs par mesure, ${song.title}` });
  for (let m = 1; m <= song.measureCount; m++) {
    const v = agg[m] || 0;
    strip.append(h('a', { role: 'listitem', class: 'heat-cell ' + heatClass(v, max), href: `#/jouer/${encodeURIComponent(id)}?from=${m}&to=${m}&loop=1&tempo=70`, title: `Mesure ${m} : ${v} erreur(s) — cliquer pour travailler en boucle`, 'aria-label': `Mesure ${m} : ${v} erreur${v > 1 ? 's' : ''}` }, String(m)));
  }
  const worst = weakMeasures(entry, { sessions: SESSIONS, count: 3 });
  const notes = weakNotes(entry, { sessions: SESSIONS, count: 6 });
  const staves = [];
  const per = 4;
  const chunks = [...new Set(worst.map((w) => Math.floor((w.measure - 1) / per)))].slice(0, 2);
  for (const c of chunks) staves.push(heatStaff(song, c * per + 1, Math.min(song.measureCount, c * per + per), agg, max));
  const sessions = (entry.history || []).slice(-SESSIONS);
  return h('article', { class: 'card teacher-song' }, [
    h('h3', {}, [h('a', { href: `#/morceau/${encodeURIComponent(id)}` }, song.title), ' ', h('span', { class: 'muted small' }, `${stars(entry.stars || 0)} · record ${entry.best || 0} % · ${sessions.length} session(s) analysée(s)${entry.mastered ? ' · 👑 maîtrisé' : ''}`)]),
    strip,
    worst.length ? h('p', { class: 'small' }, ['Mesures les plus difficiles : ', ...worst.map((w) => h('a', { class: 'btn tiny', href: `#/jouer/${encodeURIComponent(id)}?from=${w.measure}&to=${w.measure}&loop=1&tempo=70` }, `m. ${w.measure} (${w.errors})`))]) : h('p', { class: 'small muted' }, 'Pas encore de détail d’erreurs pour ce morceau.'),
    ...staves,
    notes.length ? h('p', { class: 'small' }, ['Notes les plus ratées : ', notes.map((n) => `${noteLabel(n.midi, ctx.settings)} (${n.errors})`).join(', ')]) : null,
  ]);
}

function weekStart(d = localDate()) {
  const [y, m, dd] = d.split('-').map(Number);
  const dow = (new Date(y, m - 1, dd, 12).getDay() + 6) % 7;
  return addDays(d, -dow);
}

function goalsSection() {
  const week = weekStart();
  const goals = store.goals();
  const save = () => store.saveGoals(goals);
  const songs = allSongs();
  const list = h('ul', { class: 'goal-list' });
  const render = () => {
    list.innerHTML = '';
    const current = goals.filter((g) => !g.week || g.week >= addDays(week, -7));
    if (!current.length) list.append(h('li', { class: 'muted small' }, 'Aucun objectif pour cette semaine.'));
    for (const g of current) {
      const id = 'goal-' + g.id;
      const s = songs.find((x) => x.id === g.songId);
      list.append(h('li', { class: 'goal' + (g.done ? ' done' : '') }, [
        h('input', { type: 'checkbox', id, checked: !!g.done, onchange: (e) => { g.done = e.target.checked; save(); render(); } }),
        h('label', { for: id }, [h('b', {}, s ? s.title : g.songId || 'Objectif'), g.passage ? ` — ${g.passage}` : '', g.tempo ? ` — tempo ${g.tempo} %` : '', g.text ? h('small', {}, g.text) : null, g.week && g.week < week ? h('small', { class: 'muted' }, ' (semaine précédente)') : null]),
        g.songId ? h('a', { class: 'btn tiny no-print', href: `#/jouer/${encodeURIComponent(g.songId)}?${goalQuery(g)}` }, '▶') : null,
        h('button', { type: 'button', class: 'btn tiny no-print', 'aria-label': 'Supprimer l’objectif', onclick: () => { goals.splice(goals.indexOf(g), 1); save(); render(); } }, '✕'),
      ]));
    }
  };
  const songSel = h('select', { 'aria-label': 'Morceau' }, [h('option', { value: '' }, '— Morceau —'), ...songs.map((s) => h('option', { value: s.id }, s.title))]);
  const passage = h('input', { placeholder: 'Passage (ex. mesures 5–8)', 'aria-label': 'Passage' });
  const tempo = h('input', { type: 'number', min: 30, max: 150, step: 5, placeholder: 'Tempo %', class: 'num', 'aria-label': 'Tempo cible en %' });
  const text = h('input', { placeholder: 'Consigne (facultatif)', 'aria-label': 'Consigne' });
  const form = h('form', { class: 'goal-form no-print', onsubmit: (e) => {
    e.preventDefault();
    if (!songSel.value && !text.value.trim()) return toast('Choisis un morceau ou écris une consigne.');
    goals.push({ id: Date.now().toString(36), week, songId: songSel.value, passage: passage.value.trim(), tempo: Number(tempo.value) || null, text: text.value.trim(), done: false });
    save();
    form.reset();
    render();
  } }, [songSel, passage, tempo, text, h('button', { class: 'btn primary', type: 'submit' }, '＋ Ajouter')]);
  render();
  return section('Objectifs de la semaine', [h('p', { class: 'small muted' }, `Semaine du ${week.split('-').reverse().join('/')}`), list, form]);
}

function goalQuery(g) {
  const q = new URLSearchParams();
  const m = String(g.passage || '').match(/(\d+)\D+(\d+)/) || String(g.passage || '').match(/(\d+)/);
  if (m) {
    q.set('from', m[1]);
    q.set('to', m[2] || m[1]);
    q.set('loop', '1');
  }
  if (g.tempo) q.set('tempo', g.tempo);
  return q.toString();
}

function notesSection() {
  const notes = store.teacherNotes();
  const list = h('ul', { class: 'teacher-notes' });
  const render = () => {
    list.innerHTML = '';
    if (!notes.length) list.append(h('li', { class: 'muted small' }, 'Aucune remarque pour l’instant.'));
    for (const n of [...notes].reverse()) list.append(h('li', {}, [h('small', { class: 'muted' }, new Date(n.at).toLocaleDateString('fr-FR')), ' ', n.text, h('button', { type: 'button', class: 'btn tiny no-print', 'aria-label': 'Supprimer la remarque', onclick: () => { notes.splice(notes.indexOf(n), 1); store.saveTeacherNotes(notes); render(); } }, '✕')]));
  };
  const ta = h('textarea', { rows: 3, placeholder: 'Ex. : bien garder le poignet souple ; compter à voix haute dans la mesure 7.', 'aria-label': 'Nouvelle remarque du professeur' });
  render();
  return section('Remarques du professeur', [list, h('form', { class: 'no-print', onsubmit: (e) => {
    e.preventDefault();
    if (!ta.value.trim()) return;
    notes.push({ at: Date.now(), text: ta.value.trim() });
    store.saveTeacherNotes(notes);
    ta.value = '';
    render();
  } }, [ta, h('button', { class: 'btn', type: 'submit' }, 'Ajouter la remarque')])]);
}

function viewTeacher() {
  const prof = store.currentProfile();
  const prog = store.progress();
  const days = store.practiceDays();
  const week = weekStart();
  let weekSec = 0;
  for (let i = 0; i < 7; i++) weekSec += days[addDays(week, i)] || 0;
  const info = store.streakInfo();
  const entries = Object.entries(prog).filter(([id, p]) => !id.startsWith('seance-') && findSong(id) && (p.history || []).length).sort((a, b) => (b[1].last || 0) - (a[1].last || 0)).slice(0, 8);
  main.append(
    h('div', { class: 'teacher-head' }, [
      h('div', {}, [h('h1', {}, `📒 Carnet de ${prof.name} ${prof.avatar}`), h('p', { class: 'muted' }, `Compte rendu du ${new Date().toLocaleDateString('fr-FR')} · ${Math.round(weekSec / 60)} min cette semaine · série ${info.streak} jour(s) · ${Object.keys(store.badges()).length} badge(s)`)]),
      h('button', { class: 'btn primary no-print', type: 'button', onclick: () => window.print() }, '🖨 Imprimer le compte rendu'),
    ]),
    goalsSection(),
    section('Mesures difficiles (dernières sessions)', entries.length ? [
      h('p', { class: 'small muted no-print' }, 'Plus la case est foncée, plus il y a eu d’erreurs. Clique une mesure pour la travailler en boucle.'),
      h('div', { class: 'heat-legend', 'aria-hidden': 'true' }, ['h0', 'h1', 'h2', 'h3', 'h4'].map((c, i) => h('span', { class: 'heat-cell ' + c }, ['0', '', '', '', 'max'][i]))),
      ...entries.map(([id, p]) => {
        try {
          return songReport(id, p);
        } catch (e) {
          console.error(e);
          return null;
        }
      }).filter(Boolean),
    ] : h('p', { class: 'empty' }, 'Joue quelques morceaux : les passages difficiles apparaîtront ici.')),
    notesSection(),
  );
}

registerRoute(/^carnet$/, withDeps(loadDeps, viewTeacher));
