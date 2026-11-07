// Page #/calibration : latence par source (tape sur le temps), calibration acoustique du micro,
// assistant « Mon piano » (bruit de fond + notes graves/médium/aiguës → seuils par registre).
import { store } from '../core/storage.js';
import { latencyFromTaps, buildMicProfile, bandOf, MIC_BANDS } from '../core/onset.js';
import { noteLabel } from '../core/notes.js';
import { h, toast, modal, escapeHtml } from '../ui/dom.js';
import * as synth from '../audio/synth.js';
import { mic } from '../audio/mic.js';
import { midiInput } from '../audio/midi-input.js';
import { ctx, main, onCleanup, registerRoute, section } from '../ui/context.js';
import { saveAudio, latencyOf } from './audio-settings.js';

const SOURCES = [
  { id: 'midi', icon: '🎹', name: 'Clavier MIDI', how: 'Appuie sur n’importe quelle touche de ton clavier MIDI à chaque clic.' },
  { id: 'keyboard', icon: '⌨️', name: 'Clavier d’ordinateur / écran', how: 'Appuie sur une touche (Espace…) ou touche le gros bouton à chaque clic.' },
  { id: 'mic', icon: '🎤', name: 'Micro', how: 'Avec un casque, joue une note sur ton piano (ou tape dans les mains) à chaque clic.' },
];
const COUNT_IN = 4, TAPS = 16, INTERVAL = 0.6;

/** Clic local (toujours sur les haut-parleurs, même si la sortie MIDI est en « MIDI seulement »). */
function localClick(ac, when, accent, gain = 0.5) {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.frequency.value = accent ? 1760 : 1320;
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(gain, when + 0.001);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.04);
  o.connect(g).connect(ac.destination);
  o.onended = () => { o.disconnect(); g.disconnect(); };
  o.start(when);
  o.stop(when + 0.05);
}

let startedHere = false;
async function ensureMic() {
  if (mic.running) return;
  startedHere = true;
  mic.a4 = ctx.settings.a4;
  mic.setSensitivity(ctx.settings.micSensitivity);
  await mic.start();
}

function micError(err) {
  modal('Micro indisponible', `<p>${escapeHtml(err.message || String(err))}</p><p>Autorise le micro dans ton navigateur puis réessaie.</p>`);
}

function viewCalibration(query = {}) {
  let stopCurrent = null;
  const stop = () => { stopCurrent?.(); stopCurrent = null; };
  onCleanup(stop);
  onCleanup(() => { if (startedHere && mic.running) mic.stop(); startedHere = false; });

  const s = store.settings();
  const ac = synth.audioContext();
  const sys = h('p', { class: 'small muted' });
  const updateSys = () => {
    sys.textContent = `Latence de sortie audio estimée : ${synth.outputLatencyMs()} ms (base ${Math.round((ac.baseLatency || 0) * 1000)} ms, sortie ${Math.round((ac.outputLatency || 0) * 1000)} ms) · fréquence ${ac.sampleRate} Hz · analyse micro : ${mic.mode === 'worklet' ? 'AudioWorklet' : mic.mode === 'fallback' ? 'fil principal' : 'inactive'}.`;
  };
  updateSys();

  // ---------- tape sur le temps ----------
  const pulse = h('div', { class: 'cal-pulse', 'aria-hidden': 'true' });
  const status = h('p', { class: 'cal-status', 'aria-live': 'polite' }, 'Choisis une source pour commencer.');
  const tapBtn = h('button', { class: 'btn big cal-tap', disabled: true, 'aria-label': 'Taper sur le temps' }, 'Tape ici');
  const results = {};
  const cards = SOURCES.map((src) => {
    const val = h('b', { class: 'mono' }, `${latencyOf(s, src.id)} ms`);
    results[src.id] = val;
    return h('div', { class: 'cal-card' }, [
      h('div', { class: 'cal-card-head' }, [h('span', { class: 'cal-icon', 'aria-hidden': 'true' }, src.icon), h('b', {}, src.name)]),
      h('p', { class: 'small muted' }, src.how),
      h('div', { class: 'row' }, [h('span', { class: 'small' }, 'Actuel : '), val]),
      h('button', { class: 'btn', onclick: () => runTaps(src) }, 'Commencer (16 clics)'),
    ]);
  });

  function saveLatency(src, v) {
    const cur = { midi: 0, keyboard: 0, mic: 0, ...(store.settings().latency || {}) };
    cur[src] = v;
    const patch = { latency: cur };
    if (src === 'mic') patch.latencyMs = Math.max(0, v); // compatibilité avec l'ancien réglage
    saveAudio(patch);
    results[src].textContent = `${v} ms`;
  }

  async function runTaps(src) {
    stop();
    if (src.id === 'mic') {
      try { await ensureMic(); } catch (e) { return micError(e); }
    }
    if (src.id === 'midi') {
      if (!midiInput.supported) return toast('Web MIDI indisponible dans ce navigateur');
      await midiInput.init().catch(() => {});
      if (!midiInput.devices.length) toast('Aucun clavier MIDI détecté');
    }
    const t0 = ac.currentTime + 0.8;
    const clicks = [];
    const timers = [];
    for (let i = 0; i < COUNT_IN + TAPS; i++) {
      const when = t0 + i * INTERVAL;
      localClick(ac, when, i < COUNT_IN || (i - COUNT_IN) % 4 === 0, i < COUNT_IN ? 0.35 : 0.5);
      const perf = synth.audioToPerf(when);
      if (i >= COUNT_IN) clicks.push(perf);
      timers.push(setTimeout(() => {
        pulse.classList.remove('beat');
        void pulse.offsetWidth;
        pulse.classList.add('beat');
        status.textContent = i < COUNT_IN ? `Écoute… ${COUNT_IN - i}` : `Tape ! ${i - COUNT_IN + 1} / ${TAPS}`;
      }, Math.max(0, perf - performance.now())));
    }
    const taps = [];
    const offs = [];
    if (src.id === 'midi') offs.push(midiInput.on((e) => e.type === 'noteon' && taps.push(e.t)));
    if (src.id === 'mic') offs.push(mic.on((e) => e.type === 'frame' && e.attack && taps.push(e.attackT ?? e.t)));
    if (src.id === 'keyboard') {
      const kd = (e) => {
        if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.code === 'Space') e.preventDefault();
        taps.push(e.timeStamp);
      };
      const pd = (e) => taps.push(e.timeStamp);
      window.addEventListener('keydown', kd, true);
      tapBtn.addEventListener('pointerdown', pd);
      tapBtn.disabled = false;
      offs.push(() => { window.removeEventListener('keydown', kd, true); tapBtn.removeEventListener('pointerdown', pd); tapBtn.disabled = true; });
    }
    const endT = synth.audioToPerf(t0 + (COUNT_IN + TAPS) * INTERVAL) + 300;
    const fin = setTimeout(() => {
      cleanup();
      const r = latencyFromTaps(clicks, taps, { window: INTERVAL * 1000 * 0.45, minTaps: 8 });
      if (r.latency == null) {
        status.textContent = `Pas assez de frappes reconnues (${r.n}/16). Réessaie en suivant les clics.`;
        return;
      }
      saveLatency(src.id, r.latency);
      status.textContent = `${src.name} : latence ${r.latency} ms (${r.n} frappes, régularité ± ${r.spread} ms). Enregistré.`;
    }, Math.max(0, endT - performance.now()));
    function cleanup() {
      timers.forEach(clearTimeout);
      clearTimeout(fin);
      offs.forEach((f) => f());
      offs.length = 0;
    }
    stopCurrent = cleanup;
  }

  // ---------- calibration acoustique du micro ----------
  const acStatus = h('p', { class: 'small', 'aria-live': 'polite' });
  async function runAcoustic() {
    stop();
    try { await ensureMic(); } catch (e) { return micError(e); }
    acStatus.textContent = 'Mesure en cours : silence s’il te plaît…';
    const N = 10, gap = 0.5;
    const t0 = ac.currentTime + 0.5;
    const clicks = [];
    for (let i = 0; i < N; i++) {
      localClick(ac, t0 + i * gap, true, 0.9);
      clicks.push(synth.audioToPerf(t0 + i * gap));
    }
    const hits = [];
    const off = mic.on((e) => e.type === 'frame' && e.attack && hits.push(e.attackT ?? e.t));
    const fin = setTimeout(() => {
      off();
      const r = latencyFromTaps(clicks, hits, { window: 220, minTaps: 5 });
      if (r.latency == null) {
        acStatus.textContent = `Le micro n’a entendu que ${r.n} clic(s) sur ${N}. Monte le volume (sans casque) et réessaie, ou utilise « tape sur le temps ».`;
        return;
      }
      saveLatency('mic', r.latency);
      acStatus.textContent = `Latence du micro : ${r.latency} ms (${r.n}/${N} clics entendus, ± ${r.spread} ms). Enregistré.`;
      updateSys();
    }, (N * gap + 1.2) * 1000);
    stopCurrent = () => { clearTimeout(fin); off(); };
  }

  // ---------- assistant « Mon piano » ----------
  const wiz = h('div', { class: 'cal-wizard', 'aria-live': 'polite' });
  const wizBar = h('div', { class: 'level' }, h('div', { class: 'bar' }));
  const profileInfo = h('p', { class: 'small muted' });
  const showProfile = () => {
    const p = store.settings().micProfile;
    profileInfo.textContent = p?.bands
      ? `Profil actuel : bruit ${(p.noise * 1000).toFixed(1)} ‰ · ` + MIC_BANDS.filter((b) => p.bands[b.id]).map((b) => `${b.label} ≥ ${(p.bands[b.id].minRms * 1000).toFixed(1)} ‰ (clarté ${p.bands[b.id].minClarity})`).join(' · ')
      : 'Pas encore de profil.';
  };
  showProfile();
  const STEPS = [
    { id: 'low', text: 'Joue et tiens une note GRAVE (sous le Do3), par exemple le Do2.' },
    { id: 'mid', text: 'Joue et tiens une note du MÉDIUM (autour du Do4).' },
    { id: 'high', text: 'Joue et tiens une note AIGUË (au-dessus du Do5), par exemple le Do6.' },
  ];
  async function runProfile() {
    stop();
    try { await ensureMic(); } catch (e) { return micError(e); }
    let cancelled = false;
    let off = () => {};
    let timer;
    stopCurrent = () => { cancelled = true; off(); clearTimeout(timer); };
    const listen = (fn) => { off(); off = mic.on((e) => e.type === 'frame' && fn(e)); };
    const wait = (ms) => new Promise((r) => (timer = setTimeout(r, ms)));
    // 1. bruit de fond
    const noise = [];
    wiz.textContent = 'Étape 1/4 — Silence pendant 3 secondes (ne joue rien)…';
    listen((e) => { noise.push(e.rms); wizBar.firstChild.style.width = Math.min(100, e.rms * 600) + '%'; });
    await wait(3000);
    if (cancelled) return;
    const bands = {};
    for (const [i, st] of STEPS.entries()) {
      const b = { rms: [], clarity: [] };
      let skip = false;
      const skipBtn = h('button', { class: 'btn tiny', onclick: () => { skip = true; } }, 'Passer');
      const heard = h('span', { class: 'mono' }, '—');
      wiz.innerHTML = '';
      wiz.append(h('p', {}, `Étape ${i + 2}/4 — ${st.text}`), h('p', { class: 'small' }, ['Entendu : ', heard, ' ', skipBtn]));
      listen((e) => {
        wizBar.firstChild.style.width = Math.min(100, e.rms * 600) + '%';
        if (e.midi != null) heard.textContent = noteLabel(e.midi, ctx.settings);
        if (e.midi != null && bandOf(e.midi) === st.id && e.clarity > 0.5) {
          b.rms.push(e.rms);
          b.clarity.push(e.clarity);
        }
      });
      const start = performance.now();
      while (!cancelled && !skip && b.rms.length < 40 && performance.now() - start < 12000) await wait(100);
      if (cancelled) return;
      if (b.rms.length >= 8) bands[st.id] = b;
    }
    off();
    const prof = buildMicProfile(noise, bands);
    if (!Object.keys(prof.bands).length) {
      wiz.textContent = 'Aucune note n’a été reconnue : vérifie le micro et recommence.';
      return;
    }
    saveAudio({ micProfile: prof, micUseProfile: true });
    showProfile();
    wiz.textContent = `Profil enregistré (${Object.keys(prof.bands).length} registre(s)). Le micro l’utilisera dès maintenant.`;
    stopCurrent = null;
  }

  const back = h('a', { class: 'btn tiny', href: '#/reglages' }, '← Réglages');
  const profileSection = section('Profil « Mon piano »', [
    h('p', {}, 'L’assistant mesure le bruit de ta pièce (3 s de silence), puis te fait jouer une note grave, une du médium et une aiguë. Il en déduit des seuils de détection propres à ton piano et à ton micro.'),
    profileInfo, wizBar, wiz,
    h('div', { class: 'row' }, [
      h('button', { class: 'btn primary', onclick: runProfile }, '🎹 Créer mon profil'),
      h('button', { class: 'btn', onclick: () => { stop(); saveAudio({ micProfile: null }); showProfile(); wiz.textContent = ''; } }, 'Supprimer le profil'),
    ]),
  ], 'cal-section');
  main.append(...[
    h('div', { class: 'cal-head' }, [back, h('h1', {}, 'Calibration audio')]),
    h('p', { class: 'lead' }, 'Chaque chaîne (clavier MIDI, clavier d’ordinateur, micro) a son propre retard. Mesure-le pour que l’entraîneur juge ton rythme au plus juste.'),
    sys,
    query.etape === 'profil' ? profileSection : null,
    section('Tape sur le temps', [
      h('p', {}, `4 clics pour écouter, puis tape ${TAPS} fois en même temps que les clics. On garde la médiane des écarts.`),
      h('div', { class: 'cal-stage' }, [pulse, status, tapBtn]),
      h('div', { class: 'cal-grid' }, cards),
    ], 'cal-section'),
    section('Micro : mesure automatique', [
      h('p', {}, 'L’app joue 10 clics sur les haut-parleurs et le micro mesure quand il les entend. Monte le volume, pas de casque, silence dans la pièce.'),
      h('button', { class: 'btn', onclick: runAcoustic }, '🔊 Mesurer la latence du micro'),
      acStatus,
    ], 'cal-section'),
    query.etape === 'profil' ? null : profileSection,
    section('Réinitialiser', h('button', { class: 'btn', onclick: () => { stop(); saveAudio({ latency: { midi: 0, keyboard: 0, mic: 0 }, latencyMs: 0 }); SOURCES.forEach((x) => (results[x.id].textContent = '0 ms')); toast('Latences remises à zéro'); } }, 'Remettre les latences à 0'), 'cal-section'),
  ].filter(Boolean));
  const offState = mic.on((e) => e.type === 'state' && updateSys());
  onCleanup(offState);
  if (query.etape === 'profil') setTimeout(() => profileSection.scrollIntoView?.({ block: 'start' }));
}

registerRoute(/^calibration$/, viewCalibration);
