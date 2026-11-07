// Vue : formation de l'oreille (#/jeux/oreille?ex=intervals|chords|mode|melody|rhythm).
import { makeRng, unlockedCount } from '../core/reading.js';
import { EAR_EXERCISES, EAR_PASS, QUESTIONS_PER_SESSION, MAX_LISTENS, makeEarQuestion, playDuration, DictationChecker, sessionScore } from '../core/eartraining.js';
import { prepareSong } from '../core/song.js';
import { PianoKeyboard } from '../ui/keyboard.js';
import { h } from '../ui/dom.js';
import * as synth from '../audio/synth.js';
import { ctx, main, onCleanup, registerRoute, withDeps } from '../ui/context.js';
import { gameData, saveGameData, listenNotes, micToggle, keyboardHint, levelPicker, gameHead, playScheduled, renderRhythm } from './games.js';

// Modules propres à cette page : chargés à la première visite (allègent le démarrage).
let StaffView;
async function loadDeps() {
  const [m0] = await Promise.all([import('../ui/staff.js')]);
  ({ StaffView } = m0);
}

function viewEar(query) {
  const data = gameData('ear', { best: {}, levels: {} });
  data.best ||= {};
  data.levels ||= {};
  const ex = EAR_EXERCISES[query.ex] ? query.ex : 'intervals';
  const E = EAR_EXERCISES[ex];
  const bestOf = (n) => data.best[`${ex}:${n}`] || 0;
  const unlocked = unlockedCount(bestOf, E.levels.length, EAR_PASS);
  let level = Math.min(Number(query.niveau) || data.levels[ex] || unlocked, unlocked);

  main.append(...gameHead('👂 Oreille musicale', 'Écoute, puis réponds. Chaque série compte 10 questions ; obtiens 80 % pour débloquer le niveau suivant. Le nombre d’écoutes est limité : concentre-toi dès la première !'));
  main.append(h('nav', { class: 'ear-tabs', 'aria-label': 'Exercices' }, Object.entries(EAR_EXERCISES).map(([id, x]) => h('a', {
    class: 'ear-tab' + (id === ex ? ' on' : ''), href: `#/jeux/oreille?ex=${id}`, 'aria-current': id === ex ? 'page' : false,
  }, [h('span', { 'aria-hidden': 'true' }, x.icon), ' ', x.name]))));
  const pickBox = h('div');
  const card = h('div', { class: 'card ear-card' });
  main.append(pickBox, card);
  pickBox.append(levelPicker({
    levels: E.levels, unlocked, current: level, label: 'Niveau',
    best: (n) => (data.best[`${ex}:${n}`] != null ? `${data.best[`${ex}:${n}`]} %` : null),
    onPick: (n) => {
      data.levels[ex] = n;
      saveGameData('ear', data);
      location.hash = `#/jeux/oreille?ex=${ex}&niveau=${n}`;
    },
  }));

  const rng = makeRng(Date.now());
  const st = { q: null, idx: 0, scores: [], listens: 0, answered: false, checker: null, playing: false, timers: [] };
  onCleanup(() => {
    st.timers.forEach(clearTimeout);
    synth.stopAll();
  });

  function intro() {
    card.innerHTML = '';
    card.append(
      h('h2', {}, `${E.icon} ${E.name} — niveau ${level} : ${E.levels[level - 1].name}`),
      h('p', { class: 'small muted' }, ['💡 ', E.tip]),
      h('div', { class: 'row' }, [h('button', { class: 'btn primary big', type: 'button', 'data-action': 'start', onclick: startSession }, `▶ Commencer (${QUESTIONS_PER_SESSION} questions)`)]),
      ex === 'melody' ? keyboardHint() : null,
    );
  }

  function startSession() {
    data.levels[ex] = level;
    saveGameData('ear', data);
    st.idx = 0;
    st.scores = [];
    nextQuestion();
  }

  const el = {};
  function nextQuestion() {
    if (st.idx >= QUESTIONS_PER_SESSION) return endSession();
    st.q = makeEarQuestion(ex, level, rng);
    st.listens = 0;
    st.answered = false;
    card.innerHTML = '';
    el.top = h('div', { class: 'row ear-top' }, [
      h('b', {}, `Question ${st.idx + 1}/${QUESTIONS_PER_SESSION}`),
      h('div', { class: 'progress grow' }, h('div', { class: 'fill', style: `width:${(st.idx / QUESTIONS_PER_SESSION) * 100}%` })),
    ]);
    el.listen = h('button', { class: 'btn big listen-btn', type: 'button', 'data-action': 'listen', onclick: listen }, '🔊 Écouter');
    el.fb = h('div', { class: 'feedback', 'aria-live': 'polite' }, prompt());
    el.next = h('button', { class: 'btn primary hidden', type: 'button', 'data-action': 'next', onclick: () => { st.idx++; nextQuestion(); } }, st.idx + 1 >= QUESTIONS_PER_SESSION ? 'Voir le bilan →' : 'Question suivante →');
    card.append(el.top, h('div', { class: 'row' }, [el.listen, el.next]), el.fb);
    if (ex === 'melody') buildMelody();
    else buildChoices();
    updateListen();
    listen();
  }

  function prompt() {
    return {
      intervals: 'Quel intervalle entends-tu ?', chords: 'Quel type d’accord ?', mode: 'Majeur ou mineur ?',
      melody: 'Écoute la tonique puis la mélodie, et rejoue-la au piano.', rhythm: 'Quelle partition correspond à ce que tu entends ?',
    }[ex];
  }

  function updateListen() {
    const left = MAX_LISTENS - st.listens;
    if (st.answered) {
      el.listen.disabled = st.playing;
      el.listen.textContent = '🔊 Réécouter';
    } else {
      el.listen.disabled = left <= 0 || st.playing;
      el.listen.textContent = left > 0 ? `🔊 Écouter (${left} restante${left > 1 ? 's' : ''})` : '🔇 Plus d’écoute';
    }
  }

  function listen() {
    if (st.playing || (!st.answered && st.listens >= MAX_LISTENS)) return;
    if (!st.answered) st.listens++;
    st.playing = true;
    updateListen();
    playScheduled(st.q.play);
    st.timers.push(setTimeout(() => {
      st.playing = false;
      updateListen();
    }, (playDuration(st.q.play) + 0.3) * 1000));
  }

  // ----- questions à choix -----
  function buildChoices() {
    const rhythm = ex === 'rhythm';
    el.choices = h('div', { class: 'choice-grid' + (rhythm ? ' rhythm-choices' : '') }, st.q.choices.map((c, i) => {
      const b = h('button', { class: 'btn choice', type: 'button', 'data-id': c.id, onclick: () => choose(c.id) },
        rhythm ? [h('kbd', { class: 'key-hint' }, String(i + 1)), renderRhythm(c.pattern, { compact: true, title: `Proposition ${i + 1}` })]
          : [c.label, h('kbd', { class: 'key-hint' }, String(i + 1))]);
      return b;
    }));
    card.append(el.choices);
  }

  function choose(id) {
    if (st.answered) return;
    st.answered = true;
    const ok = String(id) === String(st.q.answer);
    st.scores[st.idx] = ok ? 100 : 0;
    el.choices.querySelectorAll('.choice').forEach((b) => {
      if (b.dataset.id === String(st.q.answer)) b.classList.add('good');
      else if (b.dataset.id === String(id)) b.classList.add('bad');
      b.disabled = true;
    });
    const right = st.q.choices.find((c) => String(c.id) === String(st.q.answer));
    el.fb.className = 'feedback ' + (ok ? 'ok' : 'bad');
    el.fb.textContent = ok ? '✓ Exact !' : `✗ C’était : ${right?.label || 'la partition en vert'}`;
    synth.feedbackSound(ok ? 'success' : 'error');
    finishQuestion();
  }

  function finishQuestion() {
    el.next.classList.remove('hidden');
    updateListen();
    el.next.focus({ preventScroll: true });
  }

  // ----- dictée mélodique -----
  function buildMelody() {
    const q = st.q;
    st.checker = new DictationChecker(q.notes);
    st.found = [];
    el.staffBox = h('div', { class: 'staff-box dictation-staff' });
    el.dots = h('div', { class: 'dict-dots', 'aria-hidden': 'true' }, q.notes.map(() => h('span')));
    const kbEl = h('div', { class: 'kb small-kb' });
    el.give = h('button', { class: 'btn tiny', type: 'button', onclick: reveal }, 'Voir la réponse');
    card.append(h('p', { class: 'small muted' }, `${q.notes.length} notes · tonalité de départ : la première note entendue est la tonique (${['Do', 'Sol', 'Fa'][[0, 1, -1].indexOf(q.keyFifths)] || 'Do'}).`), el.staffBox, el.dots, kbEl, h('div', { class: 'row' }, [el.give, micToggle()]));
    const kb = new PianoKeyboard(kbEl, { onNoteOn: (m) => { synth.playNote(m, { dur: 0.8, instrument: ctx.settings.instrument }); onMelodyNote(m); }, onNoteOff: () => {} });
    kb.setRange(55, 79);
    el.kb = kb;
    renderDictation();
  }

  function renderDictation(wrong = null) {
    const q = st.q;
    const notes = st.found.map((m, i) => ({ midi: m, start: i, dur: 1, hand: 'R' }));
    if (wrong != null) notes.push({ midi: wrong, start: st.found.length, dur: 1, hand: 'R' });
    const song = prepareSong({ id: 'dictee', title: 'Dictée', timeSig: [4, 4], keyFifths: q.keyFifths, notes });
    el.staffBox.innerHTML = '';
    const sv = new StaffView(el.staffBox);
    sv.render(song, 0, Math.max(4, Math.ceil(q.notes.length / 4) * 4), { settings: ctx.settings });
    song.notes.forEach((n) => sv.mark(n.id, wrong != null && n.start === st.found.length ? 'miss' : 'hit'));
    el.dots.querySelectorAll('span').forEach((d, i) => d.classList.toggle('done', i < st.found.length));
  }

  function onMelodyNote(midi) {
    if (ex !== 'melody' || !st.checker || st.answered) return;
    const r = st.checker.play(midi);
    if (r.ok) {
      st.found.push(st.q.notes[r.index]);
      renderDictation();
      el.kb.flash(midi, 'hit');
      el.fb.className = 'feedback ok';
      el.fb.textContent = `✓ ${st.found.length}/${st.q.notes.length}`;
      if (r.done) {
        st.answered = true;
        st.scores[st.idx] = st.checker.score;
        el.fb.textContent = st.checker.errors ? `✓ Mélodie retrouvée avec ${st.checker.errors} erreur${st.checker.errors > 1 ? 's' : ''} (${st.checker.score} %)` : '✓ Parfait, sans aucune erreur !';
        synth.feedbackSound('success');
        el.give.disabled = true;
        finishQuestion();
      }
    } else {
      renderDictation(midi);
      el.kb.flash(midi, 'miss');
      el.fb.className = 'feedback bad';
      el.fb.textContent = `✗ Pas cette note (erreurs : ${st.checker.errors})`;
    }
  }

  function reveal() {
    if (st.answered) return;
    st.answered = true;
    st.scores[st.idx] = 0;
    st.found = [...st.q.notes];
    renderDictation();
    el.fb.className = 'feedback info';
    el.fb.textContent = 'Voici la mélodie. Réécoute-la en suivant la portée.';
    el.give.disabled = true;
    finishQuestion();
  }

  // ----- bilan -----
  function endSession() {
    const score = sessionScore(st.scores.map((x) => x || 0));
    const key = `${ex}:${level}`;
    const prev = data.best[key] || 0;
    data.best[key] = Math.max(prev, score);
    saveGameData('ear', data);
    const nowUnlocked = unlockedCount(bestOf, E.levels.length, EAR_PASS);
    if (score >= EAR_PASS) synth.feedbackSound('success');
    card.innerHTML = '';
    card.append(h('div', { class: 'result-card' }, [
      h('h2', {}, score > prev ? '🏆 Nouveau record !' : 'Bilan'),
      h('div', { class: 'big-score' }, `${score} %`),
      h('p', {}, `${st.scores.filter((x) => x >= 100).length} réponses parfaites sur ${QUESTIONS_PER_SESSION}.`),
      nowUnlocked > unlocked ? h('p', { class: 'unlock' }, `🔓 Niveau ${nowUnlocked} débloqué : ${E.levels[nowUnlocked - 1].name} !`)
        : score < EAR_PASS && level < E.levels.length ? h('p', { class: 'muted small' }, `Encore un effort : ${EAR_PASS} % pour débloquer le niveau suivant.`) : null,
      h('div', { class: 'row' }, [
        h('button', { class: 'btn primary', type: 'button', 'data-action': 'restart', onclick: startSession }, '↻ Nouvelle série'),
        nowUnlocked > level ? h('a', { class: 'btn', href: `#/jeux/oreille?ex=${ex}&niveau=${level + 1}` }, 'Niveau suivant →') : null,
      ]),
    ]));
    st.q = null;
  }

  // ----- entrées -----
  const onKey = (e) => {
    if (!st.q || e.target?.closest?.('input,textarea,select') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Enter' && st.answered) {
      e.preventDefault();
      st.idx++;
      nextQuestion();
    } else if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) listen();
    } else if (ex !== 'melody' && /^[1-9]$/.test(e.key)) {
      const c = st.q.choices[Number(e.key) - 1];
      if (c) choose(c.id);
    }
  };
  window.addEventListener('keydown', onKey);
  onCleanup(() => window.removeEventListener('keydown', onKey));
  if (ex === 'melody') listenNotes((m) => onMelodyNote(m));

  intro();
}

registerRoute(/^jeux\/oreille$/, withDeps(loadDeps, viewEar));
