// Vue : lecture de notes « Note Flash » (#/jeux/lecture) et déchiffrage (#/jeux/dechiffrage).
import {
  makeRng, READING_LEVELS, CLEFS, getReadingLevel, readingPool, answerChoices, checkChoice, checkPlayed, answerText,
  updateStat, pickItem, flashPoints, weakestItems, unlockedCount, stepOf, pcOf,
  SIGHT_LEVELS, getSightLevel, generateSightReading, keyName, spelledName,
} from '../core/reading.js';
import { prepareSong } from '../core/song.js';
import { PianoKeyboard } from '../ui/keyboard.js';
import { h, toast } from '../ui/dom.js';
import * as synth from '../audio/synth.js';
import { ctx, main, onCleanup, registerRoute, startTrainer } from '../ui/context.js';
import { gameData, saveGameData, listenNotes, micToggle, keyboardHint, levelPicker, gameHead } from './games.js';

const DURATION = 60; // secondes
const PASS_CORRECT = 12; // bonnes réponses (à 80 % de réussite) pour débloquer le niveau suivant
const lang = () => (ctx.settings.notation === 'en' ? 'en' : 'fr');

function loadReading() {
  const d = gameData('reading', { stats: {}, best: {}, sight: {}, level: 1, clef: 'treble' });
  d.stats ||= {};
  d.best ||= {};
  d.sight ||= {};
  return d;
}
const passOf = (data, n) => Math.max(0, ...Object.entries(data.best).filter(([k]) => k.startsWith(n + ':')).map(([, b]) => b.pass || 0));

// ---------- portée simple (une clé, armure, 1 à 3 notes) ----------
const NS = 'http://www.w3.org/2000/svg';
function sv(name, attrs = {}, parent) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}
const GAP = 10, BOTTOM = 100;
function flashStaff(item) {
  const W = 260, H = 160;
  const svg = sv('svg', { class: 'flash-staff', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Note à lire sur la portée' });
  const bottomD = item.clef === 'bass' ? 18 : 30;
  const y = (d) => BOTTOM - (d - bottomD) * (GAP / 2);
  for (let i = 0; i < 5; i++) sv('line', { x1: 6, x2: W - 6, y1: BOTTOM - i * GAP, y2: BOTTOM - i * GAP, class: 'fs-line' }, svg);
  const clef = sv('text', item.clef === 'bass' ? { x: 10, y: BOTTOM - 13, class: 'fs-clef bass' } : { x: 8, y: BOTTOM + 4, class: 'fs-clef' }, svg);
  clef.textContent = item.clef === 'bass' ? '𝄢' : '𝄞';
  // armure
  const f = item.fifths || 0;
  const trebleSharp = [38, 35, 39, 36, 33, 37, 34], trebleFlat = [34, 37, 33, 36, 32, 35, 31];
  for (let k = 0; k < Math.abs(f); k++) {
    const d = (f > 0 ? trebleSharp : trebleFlat)[k] - (item.clef === 'bass' ? 14 : 0);
    const t = sv('text', { x: 46 + k * 9, y: y(d) + 5, class: 'fs-acc' }, svg);
    t.textContent = f > 0 ? '♯' : '♭';
  }
  const xs = item.layout === 'melodic' ? [140, 200] : [165];
  const ledger = (x, d) => {
    for (let l = bottomD - 2; l >= d; l -= 2) sv('line', { x1: x - 11, x2: x + 11, y1: y(l), y2: y(l), class: 'fs-line ledger' }, svg);
    for (let l = bottomD + 10; l <= d; l += 2) sv('line', { x1: x - 11, x2: x + 11, y1: y(l), y2: y(l), class: 'fs-line ledger' }, svg);
  };
  item.notes.forEach((n, i) => {
    let x = xs[Math.min(i, xs.length - 1)];
    // seconde plaquée : tête décalée
    if (item.layout === 'harmonic' && i > 0 && n.diatonic - item.notes[i - 1].diatonic === 1) x += 13;
    ledger(x, n.diatonic);
    sv('ellipse', { cx: x, cy: y(n.diatonic), rx: 6.6, ry: 4.7, transform: `rotate(-20 ${x} ${y(n.diatonic)})`, class: 'fs-head' }, svg);
    if (n.shownAlter) {
      const t = sv('text', { x: x - 20, y: y(n.diatonic) + 5, class: 'fs-acc' }, svg);
      t.textContent = n.shownAlter > 0 ? '♯' : '♭';
    }
  });
  return svg;
}

// ---------- Note Flash ----------
function viewReading(query) {
  const data = loadReading();
  let level = Number(query.niveau) || data.level || 1;
  let clef = CLEFS[query.cle] ? query.cle : data.clef || 'treble';
  const unlocked = unlockedCount((n) => passOf(data, n), READING_LEVELS.length, PASS_CORRECT);
  level = Math.min(level, unlocked);

  main.append(...gameHead('⚡ Note Flash', 'Une note s’affiche : joue-la au piano (n’importe quelle octave) ou clique son nom. Tu as 60 secondes. Les notes que tu rates ou lis lentement reviennent plus souvent.'));
  const setup = h('div', { class: 'card game-setup' });
  const stage = h('div', { class: 'game-stage hidden' });
  main.append(setup, stage);

  function renderSetup() {
    setup.innerHTML = '';
    const clefSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Clé' }, Object.entries(CLEFS).map(([id, label]) => h('button', {
      type: 'button', class: 'seg-btn' + (clef === id ? ' on' : ''), 'aria-pressed': String(clef === id), onclick: () => { clef = id; renderSetup(); },
    }, label)));
    const picker = levelPicker({
      levels: READING_LEVELS, unlocked, current: level, label: 'Niveau de lecture',
      best: (n) => { const b = data.best[`${n}:${clef}`]; return b ? `${b.score} pts` : null; },
      onPick: (n) => { level = n; renderSetup(); },
    });
    const lv = getReadingLevel(level);
    const weak = weakestItems(data.stats, 6).filter((w) => w.key.startsWith(clef === 'both' ? '' : clef));
    setup.append(
      h('div', { class: 'row' }, [h('b', {}, 'Clé :'), clefSeg]),
      h('h2', {}, 'Niveau'), picker,
      h('p', { class: 'small muted' }, [h('b', {}, lv.name), ' — ', lv.desc, '. ', level < READING_LEVELS.length ? `Niveau suivant : ${PASS_CORRECT} bonnes réponses avec 80 % de réussite.` : '']),
      weak.length ? h('p', { class: 'small' }, ['À revoir : ', ...weak.map((w) => h('span', { class: 'chip warn-chip' }, describeKey(w.key)))]) : null,
      h('div', { class: 'row' }, [h('button', { class: 'btn primary big', type: 'button', 'data-action': 'start', onclick: start }, '▶ Commencer (60 s)'), micToggle()]),
      keyboardHint(),
    );
    setup.append(h('hr', { class: 'sep' }), h('h2', {}, '📜 Déchiffrage'), h('p', { class: 'small' }, 'Une courte mélodie inédite, à jouer une seule fois en rythme : comme quand on découvre une partition.'),
      h('div', { class: 'row' }, SIGHT_LEVELS.map((s) => h('a', { class: 'btn', href: `#/jeux/dechiffrage?niveau=${s.id}`, title: s.desc }, [`${s.id}. ${s.name}`, data.sight[s.id] ? h('small', { class: 'muted' }, ` ${data.sight[s.id]} %`) : null]))));
  }

  function describeKey(key) {
    // clef|fifths|layout|diatonics
    const [c, f, , notes] = key.split('|');
    const names = notes.split(',').map((t) => {
      const d = parseInt(t, 10);
      const alt = t.endsWith('#') ? 1 : t.endsWith('b') ? -1 : 0;
      return spelledName(stepOf(d), alt, lang()) + Math.floor(d / 7);
    });
    return `${names.join('-')} ${c === 'bass' ? '(fa)' : '(sol)'}${Number(f) ? ' · ' + keyName(Number(f)) : ''}`;
  }

  // ----- partie -----
  let g = null;
  let timer = null;
  onCleanup(() => clearInterval(timer));

  function start() {
    data.level = level;
    data.clef = clef;
    saveGameData('reading', data);
    const pool = readingPool(level, clef);
    g = { pool, rng: makeRng(Date.now()), score: 0, correct: 0, total: 0, streak: 0, bestStreak: 0, times: [], missed: [], item: null, played: [], locked: false, t0: performance.now(), ended: false };
    setup.classList.add('hidden');
    stage.classList.remove('hidden');
    stage.innerHTML = '';
    const lv = getReadingLevel(level);
    const bar = h('div', { class: 'progress time-bar' }, h('div', { class: 'fill' }));
    const hud = h('div', { class: 'flash-hud' }, [
      h('span', { class: 'stat' }, [h('b', { 'data-k': 'time' }, String(DURATION)), h('small', {}, 'secondes')]),
      h('span', { class: 'stat' }, [h('b', { 'data-k': 'score' }, '0'), h('small', {}, 'points')]),
      h('span', { class: 'stat' }, [h('b', { 'data-k': 'ok' }, '0/0'), h('small', {}, 'justes')]),
      h('span', { class: 'stat' }, [h('b', { 'data-k': 'streak' }, '0'), h('small', {}, 'série')]),
    ]);
    const staffBox = h('div', { class: 'flash-box' });
    const fb = h('div', { class: 'feedback', 'aria-live': 'polite' }, lv.kind === 'note' ? 'Quelle est cette note ?' : lv.kind === 'interval' ? 'Quel est cet intervalle ?' : 'Quel est cet accord ?');
    const choices = h('div', { class: 'choice-grid' + (lv.kind === 'chord' ? ' wide' : '') }, answerChoices(level, lang()).map((c, i) => h('button', {
      type: 'button', class: 'btn choice' + (c.black ? ' black' : ''), 'data-id': c.id,
      onclick: () => answer(checkChoice(g.item, c.id), c.id),
    }, [c.label, lv.kind !== 'note' ? h('kbd', { class: 'key-hint' }, lv.kind === 'interval' ? String(c.id) : String(i + 1)) : null])));
    const kbEl = h('div', { class: 'kb flash-kb' });
    stage.append(bar, hud, staffBox, fb, choices, kbEl, h('div', { class: 'row' }, [h('button', { class: 'btn', type: 'button', onclick: () => finish(true) }, '⏹ Arrêter'), micToggle()]));
    g.el = { bar: bar.firstChild, hud, staffBox, fb, choices };
    const kb = new PianoKeyboard(kbEl, { onNoteOn: (m) => { synth.playNote(m, { dur: 0.8, instrument: ctx.settings.instrument }); onPlayed(m); }, onNoteOff: () => {} });
    kb.setRange(60, 83);
    next();
    timer = setInterval(tick, 100);
  }

  function tick() {
    if (!g || g.ended) return;
    const left = Math.max(0, DURATION - (performance.now() - g.t0) / 1000);
    g.el.hud.querySelector('[data-k=time]').textContent = Math.ceil(left);
    g.el.bar.style.width = `${(left / DURATION) * 100}%`;
    g.el.bar.classList.toggle('low', left < 10);
    if (left <= 0) finish();
  }

  function next() {
    g.item = pickItem(g.pool, data.stats, g.rng, g.item?.key);
    g.played = [];
    g.locked = false;
    g.el.staffBox.innerHTML = '';
    g.el.staffBox.append(flashStaff(g.item));
    g.el.staffBox.classList.remove('ok', 'bad');
    g.el.choices.querySelectorAll('.choice').forEach((b) => b.classList.remove('good', 'bad'));
    g.shownAt = performance.now();
  }

  function onPlayed(midi) {
    if (!g || g.ended || g.locked) return;
    g.played.push(pcOf(midi));
    const res = checkPlayed(g.item, g.played);
    if (res != null) answer(res, null);
  }

  function answer(correct, choiceId) {
    if (!g || g.ended || g.locked) return;
    g.locked = true;
    const ms = performance.now() - g.shownAt;
    data.stats[g.item.key] = updateStat(data.stats[g.item.key], { correct, ms });
    g.total++;
    const pts = flashPoints(correct, ms);
    g.score += pts;
    const right = answerText(g.item, lang());
    if (correct) {
      g.correct++;
      g.streak++;
      g.bestStreak = Math.max(g.bestStreak, g.streak);
      g.times.push(ms);
      g.el.fb.className = 'feedback ok';
      g.el.fb.textContent = `✓ ${right} — ${(ms / 1000).toFixed(2)} s  (+${pts})`;
    } else {
      g.streak = 0;
      g.missed.push(right);
      g.el.fb.className = 'feedback bad';
      g.el.fb.textContent = `✗ C’était ${right}`;
      synth.feedbackSound('error');
      if (choiceId != null) g.el.choices.querySelector(`[data-id="${CSS.escape(String(choiceId))}"]`)?.classList.add('bad');
    }
    g.el.choices.querySelectorAll('.choice').forEach((b) => checkChoice(g.item, b.dataset.id) && b.classList.add('good'));
    g.el.staffBox.classList.add(correct ? 'ok' : 'bad');
    const q = g.el.hud;
    q.querySelector('[data-k=score]').textContent = g.score;
    q.querySelector('[data-k=ok]').textContent = `${g.correct}/${g.total}`;
    q.querySelector('[data-k=streak]').textContent = g.streak;
    setTimeout(() => g && !g.ended && next(), correct ? 280 : 1000);
  }

  function finish(aborted = false) {
    if (!g || g.ended) return;
    g.ended = true;
    clearInterval(timer);
    const acc = g.total ? g.correct / g.total : 0;
    const key = `${level}:${clef}`;
    const prev = data.best[key];
    const record = !aborted && g.total > 0 && (!prev || g.score > prev.score);
    if (!aborted && g.total > 0) {
      data.best[key] = {
        score: Math.max(prev?.score || 0, g.score), correct: Math.max(prev?.correct || 0, g.correct),
        pass: Math.max(prev?.pass || 0, acc >= 0.8 ? g.correct : 0), at: Date.now(),
      };
    }
    saveGameData('reading', data);
    const avg = g.times.length ? g.times.reduce((s, x) => s + x, 0) / g.times.length / 1000 : 0;
    const nowUnlocked = unlockedCount((n) => passOf(data, n), READING_LEVELS.length, PASS_CORRECT);
    if (record && g.score > 0) synth.feedbackSound('success');
    stage.innerHTML = '';
    stage.append(h('div', { class: 'card result-card' }, [
      h('h2', {}, aborted ? 'Partie arrêtée' : record ? '🏆 Nouveau record !' : 'Temps écoulé !'),
      h('div', { class: 'big-score' }, `${g.score} pts`),
      h('p', {}, `${g.correct} bonnes réponses sur ${g.total} (${Math.round(acc * 100)} %) · temps moyen ${avg.toFixed(2)} s · meilleure série ${g.bestStreak}`),
      prev && !record ? h('p', { class: 'muted small' }, `Ton record sur ce niveau : ${prev.score} pts`) : null,
      g.missed.length ? h('p', { class: 'small' }, ['Ratées : ', ...[...new Set(g.missed)].map((m) => h('span', { class: 'chip warn-chip' }, m))]) : null,
      nowUnlocked > unlocked ? h('p', { class: 'unlock' }, `🔓 Niveau ${nowUnlocked} débloqué : ${getReadingLevel(nowUnlocked).name} !`) : null,
      h('div', { class: 'row' }, [
        h('button', { class: 'btn primary', type: 'button', 'data-action': 'again', onclick: () => { stage.classList.add('hidden'); start(); } }, '↻ Rejouer'),
        h('button', { class: 'btn', type: 'button', onclick: () => ctx.route() }, 'Changer de niveau'),
      ]),
    ]));
  }

  // clavier : chiffres pour les intervalles/accords, Entrée pour commencer
  const onKey = (e) => {
    if (e.target?.closest?.('input,textarea,select')) return;
    if (!g || g.ended) {
      if (e.key === 'Enter' && !setup.classList.contains('hidden') && document.activeElement?.tagName !== 'BUTTON' && document.activeElement?.tagName !== 'A') start();
      return;
    }
    const lv = getReadingLevel(level);
    if (lv.kind === 'interval' && /^[2-8]$/.test(e.key)) answer(checkChoice(g.item, Number(e.key)), Number(e.key));
    if (lv.kind === 'chord' && /^[1-7]$/.test(e.key)) {
      const c = answerChoices(level, lang())[Number(e.key) - 1];
      answer(checkChoice(g.item, c.id), c.id);
    }
    if (e.key === 'Escape') finish(true);
  };
  window.addEventListener('keydown', onKey);
  onCleanup(() => window.removeEventListener('keydown', onKey));
  listenNotes(onPlayed);
  renderSetup();
}

// ---------- Déchiffrage ----------
function viewSight(query) {
  const data = loadReading();
  if (!query.niveau) {
    main.append(...gameHead('📜 Déchiffrage', 'Une mélodie de 4 mesures que tu n’as jamais vue. Prends 20 secondes pour la lire (tonalité, rythmes, notes les plus hautes et les plus basses), puis lance-la : elle ne défile qu’une fois, au tempo.'));
    main.append(h('div', { class: 'grid games-grid' }, SIGHT_LEVELS.map((s, i) => h('a', { class: 'game-card', href: `#/jeux/dechiffrage?niveau=${s.id}`, style: `--c:var(--hand-l);--i:${i}` }, [
      h('span', { class: 'game-icon' }, String(s.id)), h('b', { class: 'game-title' }, s.name), h('p', { class: 'small' }, s.desc),
      h('span', { class: 'chip game-best' }, data.sight[s.id] ? `Record : ${data.sight[s.id]} %` : `Tempo ${s.tempo}`),
    ]))));
    return;
  }
  const lv = getSightLevel(query.niveau);
  const seed = Number(query.seed) || Math.floor(Math.random() * 1e9);
  const song = prepareSong(generateSightReading(lv.id, makeRng(seed)));
  const nextSeed = makeRng(seed + 1)() * 1e9 | 0;
  const t = startTrainer(song, { mode: 'tempo', hands: song.hands.L ? 'both' : 'R' }, {
    back: '#/jeux/dechiffrage',
    title: `Déchiffrage — niveau ${lv.id} (${lv.name})`,
    subtitle: `${keyName(song.keyFifths)} · ${lv.tempo} à la noire · Lis d’abord la partition, puis ▶ : elle ne défile qu’une fois.`,
    onNext: () => (location.hash = `#/jeux/dechiffrage?niveau=${lv.id}&seed=${nextSeed}`),
  });
  t.hooks.onResult = (sum) => {
    const d = loadReading();
    if ((sum.score || 0) > (d.sight[lv.id] || 0)) {
      d.sight[lv.id] = sum.score;
      saveGameData('reading', d);
      toast(`Nouveau record de déchiffrage : ${sum.score} %`);
    }
  };
}

registerRoute(/^jeux\/lecture$/, viewReading);
registerRoute(/^jeux\/dechiffrage$/, viewSight);
