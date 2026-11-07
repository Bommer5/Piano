// Vue : hub des jeux (#/jeux) + outils partagés par les jeux (entrées, lecture audio, notation rythmique).
import { store } from '../core/storage.js';
import { READING_LEVELS, SIGHT_LEVELS, unlockedCount } from '../core/reading.js';
import { RHYTHM_LEVELS } from '../core/rhythmgame.js';
import { EAR_EXERCISES, EAR_PASS } from '../core/eartraining.js';
import { h, modal, escapeHtml } from '../ui/dom.js';
import * as synth from '../audio/synth.js';
import { mic } from '../audio/mic.js';
import { midiInput, computerKeyboard } from '../audio/midi-input.js';
import { ctx, main, onCleanup, registerRoute, homeSections } from '../ui/context.js';

// ---------- données (par profil) ----------
export function gameData(name, def = {}) {
  const v = store.get(name, null);
  return v && typeof v === 'object' ? { ...def, ...v } : { ...def };
}
export function saveGameData(name, data) {
  store.set(name, data);
}

// ---------- entrées ----------
/**
 * Écoute toutes les entrées de notes : clavier MIDI, clavier d'ordinateur, micro (attaques).
 * onNote(midi, source). Le son est joué pour le clavier d'ordinateur (et le MIDI si réglé).
 * Se désabonne automatiquement au changement de page.
 */
export function listenNotes(onNote, { micNotes = true } = {}) {
  const s = ctx.settings;
  const sound = (midi) => synth.playNote(midi, { dur: 0.8, instrument: s.instrument, a4: s.a4 });
  const offs = [
    midiInput.on((e) => {
      if (e.type === 'noteon') {
        if (s.midiLocalSound !== false) sound(e.midi);
        onNote(e.midi, 'midi');
      } else if (e.type === 'noteoff' && s.midiLocalSound !== false) synth.releaseNote(e.midi);
    }),
    computerKeyboard.on((e) => {
      if (e.type === 'noteon') {
        sound(e.midi);
        onNote(e.midi, 'keyboard');
      } else if (e.type === 'noteoff') synth.releaseNote(e.midi);
    }),
  ];
  if (micNotes) offs.push(mic.on((e) => e.type === 'onset' && e.midi != null && onNote(e.midi, 'mic')));
  midiInput.init?.().catch(() => {});
  const off = () => offs.forEach((f) => f());
  onCleanup(off);
  return off;
}

/** Bouton micro (marche/arrêt). */
export function micToggle(label = 'Micro') {
  const btn = h('button', { class: 'btn tiny' + (mic.running ? ' on' : ''), type: 'button', 'aria-pressed': String(mic.running) }, `🎤 ${label}`);
  const sync = () => {
    btn.classList.toggle('on', mic.running);
    btn.setAttribute('aria-pressed', String(mic.running));
  };
  btn.addEventListener('click', async () => {
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
    sync();
  });
  onCleanup(mic.on((e) => e.type === 'state' && sync()));
  return btn;
}

/** Aide sur le clavier d'ordinateur. */
export function keyboardHint() {
  const k = (c) => h('kbd', {}, computerKeyboard.label(c) || c);
  return h('p', { class: 'hint-line' }, ['Clavier d’ordinateur : ', k('KeyA'), ' = Do, ', k('KeyS'), ' = Ré… ', k('KeyW'), ', ', k('KeyE'), '… = touches noires ; ', k('KeyZ'), ' / ', k('KeyX'), ' changent d’octave. Clavier MIDI et micro acceptés.']);
}

// ---------- lecture audio ----------
/**
 * Joue une liste [{midi, at, dur} | {click:true, accent, at}] (secondes) à partir de maintenant.
 * @returns {{start:number, end:number}} temps AudioContext
 */
export function playScheduled(play, { delay = 0.12, velocity = 0.8 } = {}) {
  const ac = synth.audioContext();
  const start = ac.currentTime + delay;
  let end = start;
  for (const p of play) {
    const when = start + p.at;
    if (p.click) synth.click(when, !!p.accent);
    else synth.playNote(p.midi, { when, dur: p.dur ?? 0.5, velocity: p.ref ? velocity * 0.85 : velocity, instrument: ctx.settings.instrument, a4: ctx.settings.a4 });
    end = Math.max(end, when + (p.dur ?? 0.1));
  }
  return { start, end };
}

// ---------- notation rythmique (une ligne) ----------
const NS = 'http://www.w3.org/2000/svg';
function sv(name, attrs = {}, parent) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}
const near = (a, b) => Math.abs(a - b) < 0.01;

/**
 * Dessine une mesure rythmique : têtes de notes, hampes, ligatures, silences, points, triolets.
 * @param {{events, beats}} pattern
 * @param {{labels?:string[], compact?:boolean, title?:string}} opts
 */
export function renderRhythm(pattern, { labels = null, compact = false, title = '' } = {}) {
  const W = 480, H = compact ? 92 : 118, Y = compact ? 58 : 62;
  const svg = sv('svg', { class: 'rhythm-svg' + (compact ? ' compact' : ''), viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': title || 'Rythme à jouer' });
  const beats = pattern.beats || 4;
  const x0 = 34, x1 = W - 18;
  const X = (b) => x0 + (b / beats) * (x1 - x0);
  sv('line', { x1: 6, x2: W - 6, y1: Y, y2: Y, class: 'r-line' }, svg);
  sv('line', { x1: W - 6, x2: W - 6, y1: Y - 16, y2: Y + 16, class: 'r-bar' }, svg);
  const ts = sv('text', { x: 12, y: Y - 3, class: 'r-ts' }, svg);
  ts.textContent = '4';
  const ts2 = sv('text', { x: 12, y: Y + 15, class: 'r-ts' }, svg);
  ts2.textContent = '4';
  // repères de temps
  for (let b = 0; b < beats; b++) sv('line', { x1: X(b), x2: X(b), y1: Y + 20, y2: Y + 24, class: 'r-tick' }, svg);
  const stemTop = Y - 34;
  const ev = pattern.events;
  // groupes ligaturés : notes < 1 temps dans le même temps
  const beamGroup = new Map();
  let group = [];
  const flush = () => {
    if (group.length >= 2) group.forEach((i) => beamGroup.set(i, group));
    group = [];
  };
  ev.forEach((e, i) => {
    const sameBeat = group.length && Math.floor(ev[group[0]].start + 1e-6) === Math.floor(e.start + 1e-6);
    if (!e.rest && e.dur < 1 - 1e-6 && (sameBeat || !group.length)) group.push(i);
    else {
      flush();
      if (!e.rest && e.dur < 1 - 1e-6) group.push(i);
    }
  });
  flush();
  ev.forEach((e, i) => {
    const x = X(e.start) + 8;
    const g = sv('g', { class: 'r-ev' + (e.rest ? ' rest' : ''), 'data-i': i }, svg);
    if (e.rest) drawRest(g, x, Y, e.dur);
    else {
      const hollow = e.dur >= 2 - 1e-6;
      sv('ellipse', { cx: x, cy: Y, rx: 6.5, ry: 4.6, transform: `rotate(-20 ${x} ${Y})`, class: 'r-head' + (hollow ? ' hollow' : '') }, g);
      if (e.dur < 4 - 1e-6) sv('line', { x1: x + 5.8, x2: x + 5.8, y1: Y - 1, y2: stemTop, class: 'r-stem' }, g);
      if (!beamGroup.has(i) && e.dur < 1 - 1e-6) {
        const flags = e.dur <= 0.25 + 1e-6 ? 2 : 1;
        for (let f = 0; f < flags; f++) sv('path', { d: `M${x + 5.8} ${stemTop + f * 7} q 4 8 10 12`, class: 'r-flag' }, g);
      }
    }
    if ([0.75, 1.5, 3].some((d) => near(e.dur, d))) sv('circle', { cx: x + 12, cy: e.rest ? Y - 6 : Y - 2, r: 1.9, class: 'r-dot' }, g);
    if (labels && labels[i] != null) {
      const t = sv('text', { x, y: H - 6, class: 'r-count' + (e.rest ? ' rest' : '') }, g);
      t.textContent = labels[i];
    }
  });
  // ligatures
  const drawn = new Set();
  for (const grp of beamGroup.values()) {
    if (drawn.has(grp)) continue;
    drawn.add(grp);
    const xs = grp.map((i) => X(ev[i].start) + 8 + 5.8);
    sv('line', { x1: xs[0], x2: xs[xs.length - 1], y1: stemTop, y2: stemTop, class: 'r-beam' }, svg);
    // 2e ligature pour les doubles croches
    grp.forEach((i, k) => {
      if (ev[i].dur > 0.25 + 1e-6) return;
      const nb = grp[k + 1] != null && ev[grp[k + 1]].dur <= 0.25 + 1e-6;
      const pb = grp[k - 1] != null && ev[grp[k - 1]].dur <= 0.25 + 1e-6;
      if (nb) sv('line', { x1: xs[k], x2: xs[k + 1], y1: stemTop + 6, y2: stemTop + 6, class: 'r-beam' }, svg);
      else if (!pb) {
        const dir = k > 0 ? -1 : 1;
        sv('line', { x1: xs[k], x2: xs[k] + dir * 9, y1: stemTop + 6, y2: stemTop + 6, class: 'r-beam' }, svg);
      }
    });
    if (ev[grp[0]].tuplet) {
      const t = sv('text', { x: (xs[0] + xs[xs.length - 1]) / 2, y: stemTop - 5, class: 'r-tuplet' }, svg);
      t.textContent = '3';
    }
  }
  return svg;
}

function drawRest(g, x, Y, dur) {
  if (dur >= 4 - 1e-6) sv('rect', { x: x - 7, y: Y, width: 14, height: 5, class: 'r-restshape' }, g);
  else if (dur >= 2 - 1e-6) sv('rect', { x: x - 7, y: Y - 5, width: 14, height: 5, class: 'r-restshape' }, g);
  else if (dur >= 1 - 1e-6) sv('path', { d: `M${x - 2} ${Y - 16} l5 6 l-5 6 l5 6 q-6 -2 -3 6`, class: 'r-reststroke' }, g);
  else {
    sv('circle', { cx: x - 2, cy: Y - 7, r: 2.4, class: 'r-dot' }, g);
    sv('path', { d: `M${x - 2} ${Y - 5} q 4 1 6 -3 l-5 14`, class: 'r-reststroke' }, g);
    if (dur <= 0.25 + 1e-6) sv('circle', { cx: x - 3, cy: Y, r: 2.2, class: 'r-dot' }, g);
  }
}

// ---------- éléments d'interface partagés ----------
/** Sélecteur de niveaux avec cadenas. levels: [{id?, name}], best: (n)=>score|undefined */
export function levelPicker({ levels, unlocked, current, best = () => null, onPick, label = 'Niveau' }) {
  const wrap = h('div', { class: 'level-pick', role: 'group', 'aria-label': label });
  levels.forEach((lv, i) => {
    const n = i + 1;
    const locked = n > unlocked;
    const b = best(n);
    wrap.append(h('button', {
      type: 'button', class: 'lvl-btn' + (n === current ? ' on' : '') + (locked ? ' locked' : ''), disabled: locked,
      'aria-pressed': String(n === current), title: locked ? 'Réussis le niveau précédent pour débloquer celui-ci' : lv.desc || lv.name,
      onclick: () => onPick(n),
    }, [h('b', {}, locked ? '🔒' : String(n)), h('span', {}, lv.name), b != null ? h('small', {}, typeof b === 'number' ? `${b}` : b) : null]));
  });
  return wrap;
}

export function gameHead(title, lead, back = '#/jeux') {
  return [h('a', { class: 'btn tiny', href: back }, back === '#/jeux' ? '← Jeux' : '← Retour'), h('h1', {}, title), lead ? h('p', { class: 'lead' }, lead) : null];
}

// ---------- résumé des meilleurs scores ----------
export function gamesSummary() {
  const reading = gameData('reading', { best: {}, sight: {} });
  const rhythm = gameData('rhythm', { best: {} });
  const ear = gameData('ear', { best: {} });
  const flashBest = Math.max(0, ...Object.values(reading.best || {}).map((b) => b.score || 0));
  const flashLevels = unlockedCount((n) => Math.max(0, ...Object.entries(reading.best || {}).filter(([k]) => k.startsWith(n + ':')).map(([, b]) => b.correct || 0)), READING_LEVELS.length, 12);
  const sightBest = Math.max(0, ...Object.values(reading.sight || {}).map(Number));
  const rhythmLevels = unlockedCount((n) => rhythm.best?.[n] || 0, RHYTHM_LEVELS.length, 75);
  const rhythmBest = Math.max(0, ...Object.values(rhythm.best || {}).map(Number));
  let earPassed = 0, earTotal = 0;
  for (const [id, ex] of Object.entries(EAR_EXERCISES)) {
    earTotal += ex.levels.length;
    ex.levels.forEach((_, i) => {
      if ((ear.best?.[`${id}:${i + 1}`] || 0) >= EAR_PASS) earPassed++;
    });
  }
  return { flashBest, flashLevels, sightBest, rhythmLevels, rhythmBest, earPassed, earTotal };
}

// ---------- hub ----------
function viewGames() {
  const s = gamesSummary();
  main.append(
    h('h1', {}, ['Jeux et ', h('span', { class: 'grad' }, 'formation musicale')]),
    h('p', { class: 'lead' }, 'Quelques minutes par jour suffisent : lire vite, garder le tempo et reconnaître ce qu’on entend, c’est ce qui fait progresser le plus vite au piano.'),
  );
  const cards = [
    { href: '#/jeux/lecture', icon: '⚡', title: 'Note Flash', c: 'var(--accent)', anim: 'flash',
      text: 'Une note apparaît sur la portée : joue-la ou nomme-la le plus vite possible. 60 secondes chrono.',
      why: 'Lire sans compter les lignes libère ton attention pour le reste : doigts, rythme, musique.',
      best: s.flashBest ? `Record : ${s.flashBest} pts · niveau ${s.flashLevels}/${READING_LEVELS.length}` : 'Pas encore joué' },
    { href: '#/jeux/dechiffrage', icon: '📜', title: 'Déchiffrage', c: 'var(--hand-l)', anim: 'scroll',
      text: 'Une mélodie inédite de 4 mesures, à jouer du premier coup, en rythme.',
      why: 'Déchiffrer souvent des pages faciles est la meilleure façon d’apprendre de nouveaux morceaux rapidement.',
      best: s.sightBest ? `Record : ${s.sightBest} %` : `${SIGHT_LEVELS.length} niveaux` },
    { href: '#/jeux/rythme', icon: '🥁', title: 'Tape le rythme', c: 'var(--ok)', anim: 'beat',
      text: 'Écoute une mesure, lis-la, puis retape-la : Espace, une touche ou en claquant des mains.',
      why: 'Le rythme est la première chose qu’entend l’auditeur : une fausse note passe, un rythme bancal non.',
      best: s.rhythmBest ? `Record : ${s.rhythmBest} % · niveau ${s.rhythmLevels}/${RHYTHM_LEVELS.length}` : `${RHYTHM_LEVELS.length} niveaux` },
    { href: '#/jeux/oreille', icon: '👂', title: 'Oreille musicale', c: 'var(--accent2)', anim: 'wave',
      text: 'Intervalles, accords, majeur ou mineur, dictées mélodiques et rythmiques.',
      why: 'Une oreille entraînée t’aide à jouer d’oreille, à improviser et à repérer tes propres erreurs.',
      best: `${s.earPassed}/${s.earTotal} niveaux réussis` },
  ];
  main.append(h('div', { class: 'grid games-grid' }, cards.map((c, i) => h('a', { class: `game-card anim-${c.anim}`, href: c.href, style: `--c:${c.c};--i:${i}` }, [
    h('span', { class: 'game-icon', 'aria-hidden': 'true' }, c.icon),
    h('b', { class: 'game-title' }, c.title),
    h('p', { class: 'small' }, c.text),
    h('p', { class: 'small muted game-why' }, ['💡 ', c.why]),
    h('span', { class: 'chip game-best' }, c.best),
  ]))));
  main.append(h('section', { class: 'section' }, [
    h('h2', {}, 'Comment les utiliser ?'),
    h('ul', { class: 'games-tips' }, [
      h('li', {}, [h('b', {}, 'Un peu chaque jour : '), '5 minutes de Note Flash avant de jouer valent mieux qu’une heure une fois par semaine.']),
      h('li', {}, [h('b', {}, 'Vise la régularité : '), 'au rythme, un tempo stable compte plus que la vitesse.']),
      h('li', {}, [h('b', {}, 'Chante : '), 'avant de répondre à une dictée, chante ou fredonne ce que tu as entendu.']),
      h('li', {}, [h('b', {}, 'Laisse l’app choisir : '), 'Note Flash repropose plus souvent les notes que tu rates ou lis lentement.']),
    ]),
  ]));
}

/** Petite bannière « Jeux » (accueil, page Cours). */
export function gamesTeaser() {
  const s = gamesSummary();
  return h('a', { class: 'games-teaser', href: '#/jeux' }, [
    h('span', { class: 'teaser-icons', 'aria-hidden': 'true' }, ['⚡', '🥁', '👂'].map((e, i) => h('span', { style: `--i:${i}` }, e))),
    h('span', { class: 'teaser-text' }, [h('b', {}, 'Jeux et formation musicale'), h('small', {}, `Lecture de notes, rythme, oreille · ${s.earPassed + s.flashLevels + s.rhythmLevels - 2} niveaux franchis`)]),
    h('span', { class: 'btn tiny primary' }, 'Jouer →'),
  ]);
}

homeSections.push(() => gamesTeaser());
registerRoute(/^jeux$/, viewGames);
