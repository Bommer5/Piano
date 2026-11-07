// Vue : grille d'accords (#/accords) — éditeur de grille en texte, écoute (basse + voicings),
// entraînement (l'app attend un accord dont les classes de hauteurs correspondent), exercice
// « dans les 12 tons », et détecteur d'accord libre (MIDI / clavier / souris / micro).
import { parseProgression, parseChord, chordMatches, identifyChord, voicing, transposeProgression, romanNumeral, keyName, mod12, EXAMPLE_GRIDS, INVERSION_NAMES, chordPcs, FUNCTION_NAMES } from '../core/harmony.js';
import { rankKeys } from '../core/theory.js';
import { noteLabel } from '../core/notes.js';
import { matchChord, estimateNotes } from '../core/spectrum.js';
import { PianoKeyboard } from '../ui/keyboard.js';
import { h, toast } from '../ui/dom.js';
import * as synth from '../audio/synth.js';
import { mic } from '../audio/mic.js';
import { midiInput, computerKeyboard } from '../audio/midi-input.js';
import { ctx, main, onCleanup, registerRoute, section, homeSections } from '../ui/context.js';

const LS_KEY = 'chordgrid';

/** Tonalité probable d'une grille : profil des classes de hauteurs des accords (fondamentales renforcées). */
export function gridKey(items) {
  const prof = new Array(12).fill(0);
  items.forEach((it, i) => {
    const c = parseChord(it.symbol);
    if (!c) return;
    const w = it.beats * (i === items.length - 1 ? 1.5 : 1);
    for (const pc of c.pcs) prof[pc] += w;
    prof[c.root] += w;
  });
  const first = parseChord(items[0]?.symbol);
  const last = parseChord(items[items.length - 1]?.symbol);
  const ranked = rankKeys(prof);
  // préférer une tonalité dont la tonique est le dernier ou le premier accord
  const cand = ranked.slice(0, 4).find((k) => (last && k.tonic === last.root && (k.mode === 'minor') === last.pcs.includes(mod12(last.root + 3)))
    || (first && k.tonic === first.root && (k.mode === 'minor') === first.pcs.includes(mod12(first.root + 3))));
  return cand || ranked[0];
}

function viewChords(query = {}) {
  main.className = 'wide';
  const saved = (() => {
    try { return JSON.parse(localStorage.getItem('pianocoach.' + LS_KEY) || 'null'); } catch { return null; }
  })();
  const S = {
    text: query.grille || saved?.text || EXAMPLE_GRIDS[0].text,
    tempo: Number(query.tempo) || saved?.tempo || 90,
    voicing: saved?.voicing || 'nearest',
    tolerate: saved?.tolerate ?? true,
    rootless: saved?.rootless ?? false,
    requireBass: saved?.requireBass ?? false,
    twelve: false,
    hint: saved?.hint ?? true,
  };
  const persist = () => {
    try { localStorage.setItem('pianocoach.' + LS_KEY, JSON.stringify({ text: S.text, tempo: S.tempo, voicing: S.voicing, tolerate: S.tolerate, rootless: S.rootless, requireBass: S.requireBass, hint: S.hint })); } catch {}
  };

  let prog = parseProgression(S.text);
  let key = prog.items.length ? gridKey(prog.items) : { tonic: 0, mode: 'major' };
  let voicings = [];
  let mode = 'idle'; // 'idle' | 'listen' | 'practice'
  let cur = -1;
  let transposed = 0; // demi-tons (exercice dans les 12 tons)
  let round = 0;

  // ---------- éléments ----------
  const ta = h('textarea', { rows: 4, class: 'mono grid-input', 'aria-label': 'Grille d’accords', spellcheck: 'false', value: S.text, oninput: () => { S.text = ta.value; refresh(); persist(); } });
  const exSel = h('select', { 'aria-label': 'Grilles exemples', onchange: () => {
    const ex = EXAMPLE_GRIDS.find((g) => g.id === exSel.value);
    exSel.value = '';
    if (!ex) return;
    ta.value = S.text = ex.text;
    tempoIn.value = S.tempo = ex.tempo;
    refresh();
    persist();
  } }, [h('option', { value: '' }, '📋 Grilles exemples…'), ...EXAMPLE_GRIDS.map((g) => h('option', { value: g.id }, g.name))]);
  const tempoIn = h('input', { type: 'number', min: 30, max: 240, value: S.tempo, class: 'num', 'aria-label': 'Tempo', onchange: () => { S.tempo = Math.max(30, Math.min(240, Number(tempoIn.value) || 90)); persist(); } });
  const voiceSel = h('select', { 'aria-label': 'Voicing', onchange: () => { S.voicing = voiceSel.value; computeVoicings(); renderGrid(); persist(); } }, [
    ['root', 'Fondamentale'], ['nearest', 'Renversement le plus proche'], ['shell', 'Shell (fond. – 3ce – 7e)'],
  ].map(([v, l]) => h('option', { value: v, selected: v === S.voicing }, l)));
  const opt = (label, k, title) => h('label', { class: 'check', title }, [h('input', { type: 'checkbox', checked: S[k], onchange: (e) => { S[k] = e.target.checked; persist(); if (k === 'hint') showHint(); } }), label]);
  const transBtn = (d, label) => h('button', { class: 'btn tiny', 'aria-label': `Transposer de ${d > 0 ? '+' : ''}${d} demi-ton`, onclick: () => { ta.value = S.text = transposeProgression(ta.value, d, { flats: ctx.settings.flats }); refresh(); persist(); } }, label);
  const errBox = h('p', { class: 'small error-text', role: 'status' });
  const gridBox = h('div', { class: 'chord-grid', role: 'list', 'aria-label': 'Mesures de la grille' });
  const keyInfo = h('p', { class: 'muted small' });

  const bigChord = h('div', { class: 'big-chord', 'aria-live': 'polite' }, '—');
  const bigSub = h('div', { class: 'muted small' }, 'Appuie sur « S’entraîner » ou « Écouter ».');
  const status = h('div', { class: 'chord-status', role: 'status', 'aria-live': 'polite' });
  const playBtn = h('button', { class: 'btn', onclick: () => (mode === 'listen' ? stop() : listen()) }, '🔊 Écouter');
  const practiceBtn = h('button', { class: 'btn primary', onclick: () => (mode === 'practice' ? stop() : practice()) }, '🎯 S’entraîner');
  const twelveBox = h('label', { class: 'check', title: 'Après chaque passage, la grille est transposée une quarte plus haut (cycle des quintes) : 12 tonalités.' }, [h('input', { type: 'checkbox', onchange: (e) => { S.twelve = e.target.checked; } }), 'Dans les 12 tons']);
  const micBtn = h('button', { class: 'btn', 'aria-pressed': 'false', onclick: toggleMic }, '🎤 Micro');
  const detected = h('div', { class: 'detected-chord', 'aria-live': 'polite' }, [h('b', {}, '—'), h('span', { class: 'muted small' }, ' Joue un accord : son nom s’affiche ici.')]);

  const kbEl = h('div', { class: 'kb chord-kb' });
  const kb = new PianoKeyboard(kbEl, {
    onNoteOn: (m) => toggleLatch(m),
    onNoteOff: () => {},
    label: (m) => (m % 12 === 0 ? noteLabel(m, ctx.settings) : ''),
  });
  kb.setRange(36, 84);

  main.append(
    h('h1', {}, '🎹 Grille d’accords'),
    h('p', { class: 'lead' }, 'Écris une grille, écoute-la, puis joue chaque accord : l’app reconnaît les renversements et tolère les extensions. Le détecteur affiche le nom de l’accord que tu joues.'),
    h('div', { class: 'chords-layout' }, [
      h('div', { class: 'card chords-editor' }, [
        h('div', { class: 'row' }, [exSel, h('span', { class: 'muted small' }, 'Transposer'), transBtn(-1, '−½'), transBtn(1, '+½'), transBtn(5, '+4te')]),
        h('label', { class: 'field-block' }, [h('span', { class: 'small muted' }, 'Grille (« | Dm7 G7 | Cmaj7 % | » — « % » répète la mesure, « . » prolonge un accord)'), ta]),
        errBox, keyInfo, gridBox,
        h('div', { class: 'row' }, [h('label', { class: 'field' }, ['Tempo ', tempoIn]), h('label', { class: 'field' }, ['Voicing ', voiceSel])]),
        h('div', { class: 'row wrap' }, [
          opt('Extensions tolérées', 'tolerate', 'Accepter une 9e, 13e… ajoutée à l’accord demandé'),
          opt('Fondamentale facultative', 'rootless', 'Voicings sans fondamentale (jazz)'),
          opt('Basse exigée', 'requireBass', 'La note la plus grave doit être la basse de l’accord (fondamentale ou basse « /X »)'),
          opt('Montrer les touches', 'hint', 'Surligne un voicing possible sur le clavier'),
        ]),
      ]),
      h('div', { class: 'card chords-play' }, [
        bigChord, bigSub, status,
        h('div', { class: 'row wrap' }, [practiceBtn, playBtn, twelveBox, micBtn]),
        kbEl,
        h('p', { class: 'small muted' }, 'Souris : clique les touches une à une pour construire l’accord (clique à nouveau pour enlever une note). Clavier MIDI ou clavier d’ordinateur : tiens les notes ensemble.'),
        h('div', { class: 'row' }, [h('button', { class: 'btn tiny', onclick: () => { clearLatch(); update(); } }, 'Effacer les notes')]),
      ]),
    ]),
    section('Détecteur d’accord', [detected, h('p', { class: 'small muted' }, 'Avec le micro, l’estimation des notes est approximative (les harmoniques du piano trompent parfois la détection) : préfère un clavier MIDI pour les accords complexes.')]),
  );

  // ---------- notes tenues ----------
  const latched = new Set(); // souris (bascule)
  const held = new Set(); // MIDI / clavier d'ordinateur
  let micNotes = [];
  function heldNotes() {
    return [...new Set([...held, ...latched, ...micNotes])].sort((a, b) => a - b);
  }
  function toggleLatch(m) {
    if (latched.has(m)) {
      latched.delete(m);
      kb.keyEls.get(m)?.classList.remove('latched');
      synth.releaseNote(m);
    } else {
      latched.add(m);
      kb.keyEls.get(m)?.classList.add('latched');
      synth.playNote(m, { dur: 1.5, instrument: ctx.settings.instrument });
    }
    update();
  }
  function clearLatch() {
    for (const m of latched) kb.keyEls.get(m)?.classList.remove('latched');
    latched.clear();
  }
  const onInput = (e) => {
    if (e.type === 'noteon') {
      held.add(e.midi);
      kb.press(e.midi);
      if (e.source !== 'midi' || ctx.settings.midiLocalSound !== false) synth.playNote(e.midi, { dur: 3, velocity: e.velocity ?? 0.8, instrument: ctx.settings.instrument });
      update();
    } else if (e.type === 'noteoff') {
      held.delete(e.midi);
      kb.release(e.midi);
      synth.releaseNote(e.midi);
      update();
    } else if (e.type === 'pedal') synth.setSustain(e.down);
  };
  const unsubs = [midiInput.on(onInput), computerKeyboard.on(onInput)];
  midiInput.init().catch(() => {});

  // ---------- micro ----------
  let micTimer = null, micUnsub = null, lastRms = 0, okFrames = 0;
  async function toggleMic() {
    if (micTimer) return stopMic();
    try {
      await mic.start();
    } catch (err) {
      return toast('Micro indisponible : ' + (err.message || err));
    }
    micBtn.classList.add('on');
    micBtn.setAttribute('aria-pressed', 'true');
    micUnsub = mic.on((e) => { if (e.type === 'frame') lastRms = e.rms; });
    micTimer = setInterval(micTick, 120);
  }
  function stopMic() {
    clearInterval(micTimer);
    micTimer = null;
    micUnsub?.();
    micNotes = [];
    mic.stop();
    micBtn.classList.remove('on');
    micBtn.setAttribute('aria-pressed', 'false');
    update();
  }
  function micTick() {
    const mag = mic.spectrum();
    if (!mag) return;
    const sr = mic.sampleRate;
    const loud = lastRms > (ctx.settings.micSensitivity ?? 0.012);
    if (mode === 'practice' && cur >= 0) {
      // vérification ciblée : chaque classe de hauteur exigée doit être présente dans au moins une octave
      const c = currentChord();
      const pcs = chordPcs(c);
      const cand = [];
      for (let m = 36; m <= 84; m++) if (pcs.includes(mod12(m))) cand.push(m);
      const res = loud ? matchChord(mag, sr, cand, { a4: ctx.settings.a4 || 440 }) : { present: [] };
      const presentPcs = [...new Set(res.present.map(mod12))];
      const ok = loud && chordMatches(presentPcs, c, { allowRootless: S.rootless, tolerateExtensions: true }).ok;
      okFrames = ok ? okFrames + 1 : 0;
      if (okFrames >= 2) { okFrames = 0; success('micro'); }
    }
    micNotes = loud ? estimateNotes(mag, sr, { a4: ctx.settings.a4 || 440, lo: 36, hi: 96 }) : [];
    showDetected();
  }

  // ---------- grille ----------
  function transposedText() {
    return transposed ? transposeProgression(S.text, transposed, { flats: ctx.settings.flats }) : S.text;
  }
  function refresh() {
    if (mode !== 'idle') stop();
    transposed = 0;
    prog = parseProgression(S.text);
    errBox.textContent = prog.errors.join(' · ');
    key = prog.items.length ? gridKey(prog.items) : { tonic: 0, mode: 'major' };
    computeVoicings();
    renderGrid();
  }
  function computeVoicings() {
    let prev = null;
    voicings = prog.items.map((it) => {
      const v = voicing(it.symbol, { type: S.voicing, prev, center: 62, bassCenter: 41 });
      prev = v.notes;
      return v;
    });
  }
  function renderGrid() {
    gridBox.innerHTML = '';
    keyInfo.textContent = prog.items.length ? `Tonalité probable : ${keyName(key)}${transposed ? ` (transposée de ${transposed > 0 ? '+' : ''}${transposed} demi-tons)` : ''} · ${prog.measures.length} mesure${prog.measures.length > 1 ? 's' : ''}` : 'Grille vide.';
    let idx = 0;
    for (const m of prog.measures) {
      const cell = h('div', { class: 'grid-cell', role: 'listitem', 'aria-label': `Mesure ${m.index + 1}` }, [h('span', { class: 'grid-num' }, String(m.index + 1))]);
      for (const c of m.chords) {
        const i = idx++;
        const rn = romanNumeral(c.symbol, key);
        cell.append(h('button', {
          class: 'grid-chord' + (rn?.func ? ' f-' + rn.func : ''),
          'data-i': i,
          title: rn ? `${rn.roman}${rn.func ? ' — ' + FUNCTION_NAMES[rn.func] : ''}` : '',
          onclick: () => { playChord(i); if (mode === 'practice') setCurrent(i); },
        }, [h('b', {}, c.symbol), rn ? h('small', {}, rn.roman) : null]));
      }
      gridBox.append(cell);
    }
    highlight();
  }
  function highlight() {
    gridBox.querySelectorAll('.grid-chord').forEach((b) => b.classList.toggle('current', Number(b.dataset.i) === cur));
  }
  function currentChord() {
    return parseChord(prog.items[cur]?.symbol);
  }

  function playChord(i, when = 0, dur = 1.2) {
    const v = voicings[i];
    if (!v) return;
    const opts = { when, dur, instrument: ctx.settings.instrument, velocity: 0.7 };
    if (v.bass != null && !v.shell) synth.playNote(v.bass, { ...opts, velocity: 0.8 });
    for (const n of v.notes) synth.playNote(n, opts);
  }

  // ---------- écoute ----------
  let sched = null;
  function listen() {
    stop();
    if (!prog.items.length) return toast('La grille est vide.');
    mode = 'listen';
    playBtn.textContent = '⏹ Arrêter';
    const ac = synth.audioContext();
    const spb = 60 / S.tempo;
    const t0 = ac.currentTime + 0.15;
    let next = 0;
    const total = prog.measures.length * prog.beatsPerMeasure;
    sched = setInterval(() => {
      const now = ac.currentTime;
      while (next < prog.items.length && t0 + prog.items[next].start * spb < now + 0.25) {
        const it = prog.items[next];
        playChord(next, t0 + it.start * spb, it.beats * spb * 0.95);
        const i = next;
        setTimeout(() => { if (mode === 'listen') { cur = i; highlight(); bigChord.textContent = it.symbol; bigSub.textContent = romanNumeral(it.symbol, key)?.roman || ''; } }, Math.max(0, (t0 + it.start * spb - now) * 1000));
        next++;
      }
      // métronome discret
      if (now > t0 + total * spb + 0.3) stop();
    }, 50);
  }

  // ---------- entraînement ----------
  function practice() {
    stop();
    if (!prog.items.length) return toast('La grille est vide.');
    mode = 'practice';
    round = 0;
    practiceBtn.textContent = '⏹ Arrêter';
    practiceBtn.classList.add('danger');
    setCurrent(0);
  }
  function setCurrent(i) {
    cur = i;
    okFrames = 0;
    const it = prog.items[i];
    const c = parseChord(it.symbol);
    const rn = romanNumeral(c, key);
    bigChord.textContent = it.symbol;
    bigSub.textContent = `${rn ? rn.roman + ' · ' : ''}notes : ${chordPcs(c).map((pc) => noteLabel(pc + 60, { ...ctx.settings, octave: false })).join(' – ')}${S.twelve ? ` · ton ${round + 1}/12` : ''}`;
    status.textContent = `Accord ${i + 1}/${prog.items.length} — joue-le !`;
    status.className = 'chord-status';
    highlight();
    showHint();
  }
  function showHint() {
    const marks = new Map();
    if (mode === 'practice' && S.hint && voicings[cur]) {
      const v = voicings[cur];
      if (v.bass != null && !v.shell) marks.set(v.bass, { cls: 'expect-L' });
      for (const n of v.notes) marks.set(n, { cls: 'expect-R' });
    }
    kb.setMarks(marks);
  }
  function success(src) {
    const it = prog.items[cur];
    synth.feedbackSound?.('hit');
    status.textContent = `✔ ${it.symbol}${src === 'micro' ? ' (micro)' : ''}`;
    status.className = 'chord-status ok';
    for (const m of heldNotes()) kb.flash(m, 'hit');
    clearLatch();
    if (cur + 1 < prog.items.length) return setTimeout(() => mode === 'practice' && setCurrent(cur + 1), 250);
    // fin de la grille
    if (S.twelve && round < 11) {
      round++;
      transposed += 5;
      const t = transposedText();
      prog = parseProgression(t);
      key = gridKey(prog.items);
      computeVoicings();
      renderGrid();
      toast(`Bravo ! Même grille en ${keyName(key)} (${round + 1}/12)`);
      return setTimeout(() => mode === 'practice' && setCurrent(0), 400);
    }
    synth.feedbackSound?.('success');
    status.textContent = S.twelve ? '🏆 Grille jouée dans les 12 tons !' : '🏆 Grille terminée !';
    const restore = S.twelve;
    stop();
    if (restore) refresh();
  }

  function stop() {
    clearInterval(sched);
    sched = null;
    synth.stopAll();
    if (mode === 'practice') {
      practiceBtn.textContent = '🎯 S’entraîner';
      practiceBtn.classList.remove('danger');
    }
    playBtn.textContent = '🔊 Écouter';
    mode = 'idle';
    cur = -1;
    highlight();
    kb.setMarks(new Map());
  }

  function showDetected() {
    const notes = heldNotes();
    const b = detected.querySelector('b'), s = detected.querySelector('span');
    if (!notes.length) {
      b.textContent = '—';
      s.textContent = ' Joue un accord : son nom s’affiche ici.';
      return;
    }
    const id = identifyChord(notes, { key, flats: ctx.settings.flats });
    const names = notes.map((m) => noteLabel(m, { ...ctx.settings, octave: false })).join(' ');
    if (!id || id.single) {
      b.textContent = id ? id.symbol : '?';
      s.textContent = ` ${names}`;
      return;
    }
    b.textContent = id.symbol;
    s.textContent = ` ${names}${notes.length > 2 ? ' · ' + INVERSION_NAMES[id.inversion] : ''}${id.alternatives.length ? ' · ou ' + id.alternatives.slice(0, 2).join(', ') : ''}`;
  }

  function update() {
    showDetected();
    if (mode !== 'practice' || cur < 0) return;
    const notes = heldNotes();
    if (!notes.length) return;
    const c = currentChord();
    const r = chordMatches(notes, c, { allowRootless: S.rootless, tolerateExtensions: S.tolerate, requireBass: S.requireBass });
    if (r.ok) return success();
    if (r.extra.length) {
      status.textContent = `Note en trop : ${r.extra.map((pc) => noteLabel(pc + 60, { ...ctx.settings, octave: false })).join(', ')}`;
      status.className = 'chord-status bad';
    } else {
      status.textContent = `Encore ${r.missing.length} note${r.missing.length > 1 ? 's' : ''}…`;
      status.className = 'chord-status';
    }
  }

  onCleanup(() => {
    stop();
    unsubs.forEach((f) => f());
    if (micTimer) stopMic();
  });
  refresh();
}

registerRoute(/^accords$/, viewChords);

homeSections.push(() => h('a', { class: 'card home-chords', href: '#/accords' }, [h('b', {}, '🎹 Grille d’accords'), h('p', { class: 'small muted' }, 'ii–V–I, blues, pop : joue les accords dans les 12 tons, avec détecteur d’accord.')]));
