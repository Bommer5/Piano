// Vue : « Tape le rythme » (#/jeux/rythme).
import { makeRng, unlockedCount } from '../core/reading.js';
import { RHYTHM_LEVELS, getRhythmLevel, generateRhythm, onsetsOf, countLabels, countGrid, evaluateTaps, tendencyText, starsFor } from '../core/rhythmgame.js';
import { h, stars } from '../ui/dom.js';
import * as synth from '../audio/synth.js';
import { mic } from '../audio/mic.js';
import { ctx, main, onCleanup, registerRoute } from '../ui/context.js';
import { gameData, saveGameData, listenNotes, micToggle, levelPicker, gameHead, renderRhythm } from './games.js';

const SERIES = 5;
const PASS = 75;

/** Heure « entendue » de l'AudioContext correspondant à un instant performance.now(). */
function heardTime(ac, perf = performance.now()) {
  const ts = ac.getOutputTimestamp?.();
  if (ts && ts.contextTime > 0 && ts.performanceTime > 0) return ts.contextTime + (perf - ts.performanceTime) / 1000;
  return ac.currentTime - (ac.outputLatency || ac.baseLatency || 0);
}

function viewRhythm(query) {
  const data = gameData('rhythm', { best: {}, level: 1, metro: true });
  data.best ||= {};
  const unlocked = unlockedCount((n) => data.best[n] || 0, RHYTHM_LEVELS.length, PASS);
  let level = Math.min(Number(query.niveau) || data.level || 1, unlocked);
  const rng = makeRng(Date.now());

  main.append(...gameHead('🥁 Tape le rythme', 'Écoute la mesure en suivant la partition, puis retape-la après le décompte : barre Espace, n’importe quelle touche du piano, le gros bouton, ou en claquant des mains devant le micro.'));
  const pickBox = h('div');
  const card = h('div', { class: 'card rhythm-card' });
  main.append(pickBox, card);

  const s = { pattern: null, idx: 0, scores: [], phase: 'idle', taps: [], timers: [], raf: 0 };
  const clearTimers = () => {
    s.timers.forEach(clearTimeout);
    s.timers = [];
    cancelAnimationFrame(s.raf);
  };
  onCleanup(clearTimers);

  function renderPicker() {
    pickBox.innerHTML = '';
    pickBox.append(levelPicker({
      levels: RHYTHM_LEVELS, unlocked, current: level, label: 'Niveau de rythme',
      best: (n) => (data.best[n] != null ? `${data.best[n]} %` : null),
      onPick: (n) => {
        level = n;
        data.level = n;
        saveGameData('rhythm', data);
        clearTimers();
        renderPicker();
        newSeries();
      },
    }));
  }

  const el = {};
  function build() {
    card.innerHTML = '';
    const lv = getRhythmLevel(level);
    el.title = h('div', { class: 'row rhythm-top' }, [h('b', {}, `Niveau ${lv.id} — ${lv.name}`), h('span', { class: 'chip' }, `♩ = ${lv.tempo}`), el.progress = h('span', { class: 'chip' })]);
    el.score = h('div', { class: 'rhythm-notation' });
    el.grid = h('div', { class: 'count-grid', 'aria-hidden': 'true' }, countGrid(4).map((c) => h('span', { 'data-at': c.at }, c.label)));
    el.phase = h('div', { class: 'feedback', 'aria-live': 'polite' }, 'Appuie sur « Écouter puis taper » (ou Espace).');
    el.pad = h('button', { class: 'tap-pad', type: 'button', 'aria-label': 'Taper le rythme' }, ['👏', h('span', {}, 'Tape ici')]);
    el.pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      tap();
    });
    el.go = h('button', { class: 'btn primary big', type: 'button', 'data-action': 'go', onclick: () => run(true) }, '▶ Écouter puis taper');
    el.again = h('button', { class: 'btn', type: 'button', onclick: () => run(false) }, '↻ Retaper');
    el.listen = h('button', { class: 'btn', type: 'button', onclick: () => run(true, true) }, '🔊 Réécouter');
    el.next = h('button', { class: 'btn primary hidden', type: 'button', 'data-action': 'next', onclick: nextMeasure }, 'Mesure suivante →');
    const metro = h('label', { class: 'check small' }, [h('input', { type: 'checkbox', checked: data.metro !== false, onchange: (e) => { data.metro = e.target.checked; saveGameData('rhythm', data); } }), 'Métronome sur 2 et 4']);
    el.result = h('div', { class: 'rhythm-result', 'aria-live': 'polite' });
    card.append(el.title, el.score, el.grid, el.phase, h('div', { class: 'row rhythm-actions' }, [el.go, el.listen, el.again, el.next]), el.pad,
      h('div', { class: 'row small' }, [metro, micToggle('Claquer des mains')]), el.result,
      h('p', { class: 'hint-line' }, 'Compte à voix haute « 1 et 2 et 3 et 4 et » : les syllabes sous chaque note indiquent où elle tombe. Vert : moins de 80 ms d’écart, orange : moins de 150 ms.'));
  }

  function newSeries() {
    s.idx = 0;
    s.scores = [];
    build();
    newMeasure();
  }
  function newMeasure() {
    s.pattern = generateRhythm(level, rng);
    s.phase = 'idle';
    s.taps = [];
    el.score.innerHTML = '';
    el.score.append(renderRhythm(s.pattern, { labels: countLabels(s.pattern), title: 'Mesure à retaper' }));
    el.progress.textContent = `Mesure ${s.idx + 1}/${SERIES}`;
    el.result.innerHTML = '';
    el.next.classList.add('hidden');
    el.again.disabled = true;
    el.go.disabled = false;
    el.phase.className = 'feedback';
    el.phase.textContent = 'Appuie sur « Écouter puis taper » (ou Espace).';
  }
  function nextMeasure() {
    if (s.idx + 1 >= SERIES) return endSeries();
    s.idx++;
    newMeasure();
  }

  /** Écoute (option) + décompte + mesure à taper. */
  function run(withListen, listenOnly = false) {
    clearTimers();
    const ac = synth.audioContext();
    const lv = getRhythmLevel(level);
    const spb = 60 / lv.tempo;
    const t0 = ac.currentTime + 0.2;
    let t = t0;
    const segments = [];
    if (withListen) {
      for (let b = 0; b < 4; b++) synth.click(t + b * spb, b === 0);
      const listenAt = t + 4 * spb;
      for (const on of onsetsOf(s.pattern)) synth.playNote(76, { when: listenAt + on * spb, dur: 0.18, velocity: 0.9, instrument: ctx.settings.instrument });
      segments.push({ kind: 'countin', from: t, label: 'Écoute : 1, 2, 3, 4…' }, { kind: 'listen', from: listenAt, label: '🔊 Écoute et lis…' });
      t = listenAt + 4 * spb;
    }
    if (!listenOnly) {
      for (let b = 0; b < 4; b++) synth.click(t + b * spb, b === 0);
      const tapAt = t + 4 * spb;
      if (data.metro !== false) [1, 3].forEach((b) => synth.click(tapAt + b * spb, false));
      segments.push({ kind: 'countin', from: t, label: 'Prépare-toi : 1, 2, 3, 4…' }, { kind: 'tap', from: tapAt, label: '👏 À toi !' });
      s.tapAt = tapAt;
      s.spb = spb;
      t = tapAt + 4 * spb;
    }
    const end = t;
    s.taps = [];
    s.phase = 'running';
    el.go.disabled = true;
    el.again.disabled = true;
    el.listen.disabled = true;
    el.result.innerHTML = '';
    // animation : phase + temps courant
    const anim = () => {
      const now = ac.currentTime;
      let seg = null;
      for (const sg of segments) if (now >= sg.from) seg = sg;
      if (seg) {
        if (el.phase.dataset.kind !== seg.kind + seg.from) {
          el.phase.dataset.kind = seg.kind + seg.from;
          el.phase.className = 'feedback' + (seg.kind === 'tap' ? ' info' : '');
          el.phase.textContent = seg.label;
        }
        s.phase = seg.kind;
        const beat = (now - seg.from) / spb;
        highlight(seg.kind === 'countin' ? -1 : beat, seg.kind === 'countin' ? Math.floor(beat) : null);
      }
      if (now < end + 0.05) s.raf = requestAnimationFrame(anim);
    };
    s.raf = requestAnimationFrame(anim);
    s.timers.push(setTimeout(() => {
      highlight(-1);
      el.listen.disabled = false;
      el.go.disabled = false;
      if (listenOnly) {
        s.phase = 'idle';
        el.phase.className = 'feedback';
        el.phase.textContent = 'À toi : « Retaper » ou « Écouter puis taper ».';
        el.again.disabled = false;
      } else evaluate();
    }, (end - ac.currentTime + 0.35) * 1000));
  }

  function highlight(beat, countIn = null) {
    el.grid.querySelectorAll('span').forEach((sp) => {
      const at = Number(sp.dataset.at);
      sp.classList.toggle('now', beat >= at && beat < at + 0.5);
      sp.classList.toggle('count', countIn != null && at === countIn);
    });
    el.score.querySelectorAll('.r-ev').forEach((g) => {
      const e = s.pattern.events[Number(g.dataset.i)];
      g.classList.toggle('now', beat >= e.start && beat < e.start + e.dur);
    });
  }

  function tap() {
    if (s.phase === 'idle' || s.phase === 'done') {
      if (s.phase === 'idle' && !el.go.disabled) run(true);
      return;
    }
    if (s.phase !== 'tap' && s.phase !== 'countin') return;
    const ac = synth.audioContext();
    const t = heardTime(ac) - (ctx.settings.latencyMs || 0) / 1000;
    if (t < s.tapAt - 0.35) return; // trop tôt (pendant l'écoute)
    s.taps.push(t);
    el.pad.classList.remove('hit');
    void el.pad.offsetWidth;
    el.pad.classList.add('hit');
  }

  function evaluate() {
    s.phase = 'done';
    const exp = onsetsOf(s.pattern).map((b) => s.tapAt + b * s.spb);
    const res = evaluateTaps(exp, s.taps);
    s.lastScore = res.score;
    el.result.innerHTML = '';
    el.result.append(timeline(res));
    const msg = res.score >= 90 ? 'Excellent ! 🎉' : res.score >= 70 ? 'Bien joué !' : res.score >= 45 ? 'Presque, réessaie !' : 'Écoute encore et compte à voix haute.';
    el.phase.className = 'feedback ' + (res.score >= 70 ? 'ok' : 'bad');
    el.phase.textContent = `${stars(res.stars)}  ${res.score} % — ${msg}`;
    el.result.append(h('p', { class: 'small' }, [
      h('span', { class: 'chip good-chip' }, `${res.good} parfaites`), ' ', h('span', { class: 'chip ok-chip' }, `${res.ok} proches`), ' ',
      h('span', { class: 'chip miss-chip' }, `${res.miss} ratées`), ' ', res.extras.length ? h('span', { class: 'chip' }, `${res.extras.length} en trop`) : null,
      res.good + res.ok ? ` · ${tendencyText(res.meanDelta)}` : '',
    ]));
    if (res.score >= 70) synth.feedbackSound('success');
    el.again.disabled = false;
    el.next.classList.remove('hidden');
    el.next.textContent = s.idx + 1 >= SERIES ? 'Voir le bilan →' : `Mesure suivante (${s.idx + 2}/${SERIES}) →`;
    s.scores[s.idx] = Math.max(s.scores[s.idx] || 0, res.score);
  }

  /** Frise comparative : attaques attendues (haut) / frappes (bas). */
  function timeline(res) {
    const NS = 'http://www.w3.org/2000/svg';
    const W = 480, H = 86;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'tap-timeline');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Comparaison : ${res.good} frappes justes, ${res.ok} proches, ${res.miss} ratées`);
    const add = (n, a) => {
      const e = document.createElementNS(NS, n);
      for (const [k, v] of Object.entries(a)) e.setAttribute(k, v);
      svg.appendChild(e);
      return e;
    };
    const span = 4 * s.spb;
    const X = (t) => 34 + ((t - s.tapAt) / span) * (W - 52);
    add('line', { x1: 20, x2: W - 10, y1: 22, y2: 22, class: 'tl-axis' });
    add('line', { x1: 20, x2: W - 10, y1: 62, y2: 62, class: 'tl-axis' });
    for (let b = 0; b <= 4; b++) add('line', { x1: X(s.tapAt + b * s.spb), x2: X(s.tapAt + b * s.spb), y1: 12, y2: 72, class: 'tl-beat' });
    const l1 = add('text', { x: 2, y: 26, class: 'tl-lbl' });
    l1.textContent = '♪';
    const l2 = add('text', { x: 2, y: 66, class: 'tl-lbl' });
    l2.textContent = '👏';
    res.matches.forEach((m) => {
      add('line', { x1: X(m.expected), x2: X(m.expected), y1: 14, y2: 30, class: 'tl-exp ' + m.grade });
      if (m.tap != null) {
        add('line', { x1: X(m.expected), x2: X(m.tap), y1: 30, y2: 56, class: 'tl-link ' + m.grade });
        add('circle', { cx: X(m.tap), cy: 62, r: 6, class: 'tl-tap ' + m.grade });
        if (m.grade !== 'good') {
          const t = add('text', { x: X(m.tap), y: 82, class: 'tl-ms' });
          t.textContent = `${m.delta > 0 ? '+' : ''}${Math.round(m.delta * 1000)}`;
        }
      }
    });
    res.extras.forEach((t) => {
      if (X(t) < 0 || X(t) > W) return;
      const e = add('text', { x: X(t), y: 67, class: 'tl-extra' });
      e.textContent = '×';
    });
    return svg;
  }

  function endSeries() {
    const avg = Math.round(s.scores.reduce((a, b) => a + (b || 0), 0) / SERIES);
    const prev = data.best[level] || 0;
    data.best[level] = Math.max(prev, avg);
    saveGameData('rhythm', data);
    const nowUnlocked = unlockedCount((n) => data.best[n] || 0, RHYTHM_LEVELS.length, PASS);
    card.innerHTML = '';
    card.append(h('div', { class: 'result-card' }, [
      h('h2', {}, avg > prev ? '🏆 Nouveau record !' : 'Bilan de la série'),
      h('div', { class: 'stars big-stars', 'aria-label': `${starsFor(avg)} étoiles sur 3` }, stars(starsFor(avg))),
      h('div', { class: 'big-score' }, `${avg} %`),
      h('p', {}, `Moyenne sur ${SERIES} mesures : ${s.scores.map((x) => `${x || 0} %`).join(' · ')}`),
      nowUnlocked > unlocked ? h('p', { class: 'unlock' }, `🔓 Niveau ${nowUnlocked} débloqué : ${getRhythmLevel(nowUnlocked).name} !`)
        : level < RHYTHM_LEVELS.length && avg < PASS ? h('p', { class: 'muted small' }, `Il faut ${PASS} % de moyenne pour débloquer le niveau suivant.`) : null,
      h('div', { class: 'row' }, [
        h('button', { class: 'btn primary', type: 'button', 'data-action': 'restart', onclick: () => ctx.route() }, '↻ Nouvelle série'),
        nowUnlocked > level ? h('a', { class: 'btn', href: `#/jeux/rythme?niveau=${level + 1}`, onclick: () => { data.level = level + 1; saveGameData('rhythm', data); } }, 'Niveau suivant →') : null,
      ]),
    ]));
    s.phase = 'end';
  }

  // ----- entrées -----
  const onKey = (e) => {
    if (e.code !== 'Space' || e.target?.closest?.('input,textarea,select')) return;
    e.preventDefault();
    if (e.repeat) return;
    document.activeElement?.blur?.();
    tap();
  };
  window.addEventListener('keydown', onKey);
  onCleanup(() => window.removeEventListener('keydown', onKey));
  listenNotes(() => tap(), { micNotes: false });
  onCleanup(mic.on((e) => e.type === 'frame' && e.attack && tap()));

  renderPicker();
  newSeries();
}

registerRoute(/^jeux\/rythme$/, viewRhythm);
