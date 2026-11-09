// Synthétiseur de piano (Web Audio, sans échantillons à télécharger) + métronome + sortie MIDI optionnelle.
// Piano : partiels inharmoniques (B selon la hauteur), double décroissance par partiel (attaque puis
// résonance), filtre qui s'assombrit, léger bruit de marteau, deux cordes légèrement désaccordées,
// placement stéréo selon la hauteur, résonance sympathique quand la pédale est enfoncée.
// Polyphonie limitée (vol des voix les plus anciennes) et nettoyage de tous les nœuds en fin de note.
import { midiToFreq } from '../core/notes.js';
import { audioToPerf as clockAudioToPerf } from '../core/onset.js';
import { midiOutput } from './midi-output.js';

let ctx = null;
let master = null;
let reverb = null;
let revSend = null;
let resSend = null;
let noiseBuf = null;

export const MAX_VOICES = 48;

function makeIR(ac, seconds, power, darkness = 0) {
  const len = Math.floor(ac.sampleRate * seconds);
  const ir = ac.createBuffer(2, len, ac.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const n = Math.random() * 2 - 1;
      lp = lp * darkness + n * (1 - darkness); // passe-bas simple : réverbération plus sombre
      d[i] = lp * Math.pow(1 - i / len, power);
    }
  }
  return ir;
}

export function audioContext() {
  if (!ctx) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    ctx = new AC({ latencyHint: 'interactive' });
    master = ctx.createGain();
    master.gain.value = 0.7;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    // réverbération de salle légère
    reverb = ctx.createConvolver();
    reverb.buffer = makeIR(ctx, 1.6, 3);
    revSend = ctx.createGain();
    revSend.gain.value = 0.18;
    revSend.connect(reverb).connect(master);
    // résonance sympathique (cordes libres quand la pédale est enfoncée) : longue et sombre
    const res = ctx.createConvolver();
    res.buffer = makeIR(ctx, 2.8, 2, 0.85);
    resSend = ctx.createGain();
    resSend.gain.value = 0.02;
    resSend.connect(res).connect(master);
    // bruit de marteau partagé (0,1 s)
    noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.1), ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume?.();
  return ctx;
}

export function setVolume(v) {
  audioContext();
  master.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), ctx.currentTime, 0.02);
}

/** Temps audio → performance.now() (ms) de l'instant où le son sort du haut-parleur. */
export function audioToPerf(when) {
  const ac = audioContext();
  let ts = null;
  try { ts = ac.getOutputTimestamp?.(); } catch {}
  return clockAudioToPerf(when, ts, { currentTime: ac.currentTime, now: performance.now(), outputLatency: (ac.outputLatency || 0) + (ac.baseLatency || 0) });
}

/** Latence de sortie estimée (ms). */
export function outputLatencyMs() {
  const ac = audioContext();
  return Math.round(((ac.outputLatency || 0) + (ac.baseLatency || 0)) * 1000);
}

const INSTRUMENTS = {
  piano: { model: 'piano' },
  epiano: { partials: [1, 0.3, 0.05, 0.12], decay: 2.8, attack: 0.006, inharm: 0, type: 'sine' },
  orgue: { partials: [1, 0.8, 0.6, 0.3, 0.2], decay: 99, attack: 0.02, inharm: 0, type: 'sine' },
  clavecin: { partials: [1, 0.9, 0.7, 0.5, 0.4, 0.3], decay: 1.2, attack: 0.002, inharm: 0, type: 'triangle' },
};

const voices = []; // toutes les voix vivantes, par ordre de déclenchement
const active = new Map(); // midi -> voix la plus récente
let sustain = false;
const sustained = new Set();

/** Nombre de voix locales en cours (tests / diagnostic). */
export function voiceCount() {
  return voices.length;
}

/** Coefficient d'inharmonicité B approximatif d'une corde de piano. */
export function inharmonicity(midi) {
  return Math.max(8e-5, Math.min(0.01, 4e-4 * Math.pow(2, (midi - 60) / 14)));
}

/** Paramètres de partiels du modèle de piano (fonction pure, testable). */
export function pianoPartials(midi, velocity = 0.8, sampleRate = 48000, a4 = 440) {
  const f0 = midiToFreq(midi, a4);
  const B = inharmonicity(midi);
  const n = Math.max(3, Math.min(10, Math.floor(5000 / f0)));
  const tail = Math.max(0.5, Math.min(7, 7 * Math.pow(2, -(midi - 33) / 20))); // aftersound (s)
  const out = [];
  for (let k = 1; k <= n; k++) {
    const f = f0 * k * Math.sqrt(1 + B * k * k);
    if (f > sampleRate * 0.45) break;
    // marteau frappant à 1/8 de la corde : le 8e partiel est quasi absent
    const strike = Math.abs(Math.sin((Math.PI * k) / 8.2));
    const bright = Math.pow(Math.max(0.05, velocity), (k - 1) * 0.18);
    const amp = (strike * bright) / Math.pow(k, 1.1);
    const tau2 = tail / (1 + 0.45 * (k - 1));
    out.push({ k, f, amp, tau1: Math.max(0.05, tau2 * 0.12), tau2, ratio: 0.3 });
  }
  return out;
}

function disconnectAll(nodes) {
  for (const n of nodes) {
    try { n.disconnect(); } catch {}
  }
}

function stopSources(v, at) {
  for (const s of v.sources) {
    try { s.stop(at); } catch {}
  }
}

function removeVoice(v) {
  const i = voices.indexOf(v);
  if (i >= 0) voices.splice(i, 1);
  if (active.get(v.midi) === v) active.delete(v.midi);
}

/** Étouffe une voix à partir de `at` (temps audio). */
function damp(v, at, tau) {
  if (!v.env || v.damped) return;
  v.damped = true;
  const g = v.env.gain;
  if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(at);
  else g.cancelScheduledValues(at);
  g.setTargetAtTime(0, at, tau);
  stopSources(v, at + tau * 7 + 0.02);
}

function stealOldest(now) {
  // on vole d'abord une voix déjà commencée, la plus ancienne
  const v = voices.find((x) => x.t0 <= now) || voices[0];
  if (!v) return;
  removeVoice(v);
  v.damped = false;
  damp(v, now, 0.008);
}

/**
 * Joue une note.
 * @param {number} midi
 * @param {{when?:number, dur?:number, velocity?:number, instrument?:string, a4?:number}} opts when/dur en secondes (temps AudioContext)
 */
// --- Écho : notes que l'APP vient de jouer (haut-parleur → micro) ---
// Si le micro réentend une note produite par l'app (touche de l'écran, accompagnement, écoute), ce n'est pas
// une note jouée par l'élève : sans ce garde-fou, une note répétée serait validée deux fois.
const echoLog = []; // {midi, at (performance.now() du début du son)}
function logEcho(midi, t0, ac) {
  const at = performance.now() + (t0 - ac.currentTime) * 1000 + ((ac.outputLatency || 0) + (ac.baseLatency || 0)) * 1000;
  echoLog.push({ midi, at });
  if (echoLog.length > 96) echoLog.splice(0, echoLog.length - 96);
}
/**
 * La note `midi` entendue au micro à l'instant `t` (performance.now()) est-elle l'écho d'une note de l'app ?
 * Vrai si l'app a commencé la même note (ou une de ses octaves, que le micro confond) dans les `windowMs` précédentes.
 */
export function isEcho(midi, t = performance.now(), windowMs = 450) {
  for (let i = echoLog.length - 1; i >= 0; i--) {
    const e = echoLog[i];
    if (t - e.at > windowMs + 200) break;
    const d = Math.abs(midi - e.midi);
    if (t - e.at >= -120 && t - e.at <= windowMs && (d === 0 || d === 12 || d === 19 || d === 24)) return true;
  }
  return false;
}

export function playNote(midi, { when = 0, dur = 1, velocity = 0.8, instrument = 'piano', a4 = 440 } = {}) {
  const ac = audioContext();
  const t0 = Math.max(ac.currentTime, when || ac.currentTime);
  logEcho(midi, t0, ac);
  const end = t0 + Math.max(0.08, dur);
  const routing = midiOutput.routing();
  let midiSent = false;
  if (routing !== 'local') midiSent = midiOutput.noteOn(midi, velocity, audioToPerf(t0), Math.max(0.08, dur) * 1000, instrument);
  if (routing === 'midi') {
    const v = { midi, t0, end, midiSent, sources: [], midiOnly: true };
    return v;
  }

  while (voices.length >= MAX_VOICES) stealOldest(ac.currentTime);
  // même touche refrappée : la corde est d'abord étouffée par le marteau
  const prev = active.get(midi);
  if (prev && !prev.damped) damp(prev, Math.max(ac.currentTime, t0), 0.03);

  const inst = INSTRUMENTS[instrument] || INSTRUMENTS.piano;
  const v = inst.model === 'piano' ? pianoVoice(ac, midi, t0, end, velocity, a4) : additiveVoice(ac, inst, midi, t0, end, velocity, a4);
  v.midiSent = midiSent;
  voices.push(v);
  active.set(midi, v);
  return v;
}

function voiceOutput(ac, midi, nodes) {
  // placement stéréo selon la hauteur (graves à gauche, aigus à droite, comme vu du pianiste)
  let last;
  if (ac.createStereoPanner) {
    const pan = ac.createStereoPanner();
    pan.pan.value = Math.max(-0.5, Math.min(0.5, ((midi - 64) / 40) * 0.5));
    nodes.push(pan);
    last = pan;
  } else {
    last = ac.createGain();
    nodes.push(last);
  }
  last.connect(master);
  if (revSend) last.connect(revSend);
  if (resSend) last.connect(resSend);
  return last;
}

function finishVoice(v, ac) {
  const first = v.sources[0];
  first.onended = () => {
    disconnectAll(v.nodes);
    removeVoice(v);
  };
}

function pianoVoice(ac, midi, t0, end, velocity, a4) {
  const nodes = [];
  const sources = [];
  const f0 = midiToFreq(midi, a4);
  const out = voiceOutput(ac, midi, nodes);
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 0.5;
  const fStart = Math.min(16000, f0 * (3 + 14 * velocity));
  filter.frequency.setValueAtTime(fStart, t0);
  const env = ac.createGain();
  nodes.push(filter, env);
  // nuance : courbe de vélocité + aigus un peu moins forts
  const peak = 0.2 * Math.pow(Math.max(0.05, velocity), 1.4) * (midi > 84 ? 0.75 : 1);
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(peak, t0 + 0.003);
  env.connect(filter).connect(out);
  const parts = pianoPartials(midi, velocity, ac.sampleRate, a4);
  const tail = parts[0]?.tau2 || 1;
  filter.frequency.setTargetAtTime(Math.max(f0 * 1.5, 300), t0 + 0.01, tail * 0.35);
  for (const p of parts) {
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.value = p.f;
    const g = ac.createGain();
    // double décroissance : chute rapide (son « prompt ») puis résonance longue (« aftersound »)
    g.gain.setValueAtTime(p.amp, t0);
    g.gain.setTargetAtTime(p.amp * p.ratio, t0, p.tau1);
    g.gain.setTargetAtTime(0, t0 + p.tau1 * 3, p.tau2);
    o.connect(g).connect(env);
    nodes.push(o, g);
    sources.push(o);
  }
  // seconde corde légèrement désaccordée (battements lents) pour le médium/grave
  if (midi < 96 && parts.length) {
    const o = ac.createOscillator();
    o.frequency.value = parts[0].f * Math.pow(2, 1.2 / 1200);
    const g = ac.createGain();
    g.gain.setValueAtTime(parts[0].amp * 0.45, t0);
    g.gain.setTargetAtTime(0, t0, parts[0].tau2 * 0.8);
    o.connect(g).connect(env);
    nodes.push(o, g);
    sources.push(o);
  }
  // bruit de marteau
  if (noiseBuf) {
    const nsrc = ac.createBufferSource();
    nsrc.buffer = noiseBuf;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = Math.max(400, Math.min(8000, f0 * 3));
    bp.Q.value = 0.8;
    const ng = ac.createGain();
    ng.gain.setValueAtTime(0.0001, t0);
    ng.gain.linearRampToValueAtTime(0.06 * velocity * velocity, t0 + 0.002);
    ng.gain.setTargetAtTime(0, t0 + 0.004, 0.012);
    nsrc.connect(bp).connect(ng).connect(out);
    nsrc.start(t0);
    nsrc.stop(t0 + 0.09);
    nodes.push(nsrc, bp, ng);
  }
  // fin de note : étouffoirs (les notes les plus aiguës n'en ont pas sur un vrai piano)
  const dampTau = midi > 88 ? 0.35 : midi > 60 ? 0.07 : 0.11;
  const stopAt = Math.min(end + dampTau * 7, t0 + tail * 7) + 0.05;
  env.gain.setTargetAtTime(0, end, dampTau);
  for (const s of sources) s.start(t0);
  for (const s of sources) s.stop(stopAt);
  const v = { midi, t0, end, env, nodes, sources, dampTau };
  finishVoice(v, ac);
  return v;
}

function additiveVoice(ac, inst, midi, t0, end, velocity, a4) {
  const nodes = [];
  const sources = [];
  const f0 = midiToFreq(midi, a4);
  const out = voiceOutput(ac, midi, nodes);
  const env = ac.createGain();
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = Math.min(18000, f0 * (4 + velocity * 10));
  filter.Q.value = 0.4;
  nodes.push(env, filter);
  const decay = inst.decay * Math.max(0.35, Math.min(1.6, 1.6 - (midi - 40) / 60));
  const peak = 0.22 * velocity;
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(peak, t0 + inst.attack);
  env.gain.setTargetAtTime(peak * 0.35, t0 + inst.attack, decay * 0.25);
  env.gain.setTargetAtTime(0, end, 0.08);
  env.connect(filter).connect(out);
  inst.partials.forEach((amp, i) => {
    const hh = i + 1;
    const f = f0 * hh * Math.sqrt(1 + inst.inharm * hh * hh);
    if (f > ac.sampleRate * 0.45) return;
    const o = ac.createOscillator();
    o.type = inst.type;
    o.frequency.value = f;
    const g = ac.createGain();
    g.gain.value = amp;
    o.connect(g).connect(env);
    o.start(t0);
    o.stop(end + 0.6);
    nodes.push(o, g);
    sources.push(o);
  });
  const v = { midi, t0, end, env, nodes, sources, dampTau: 0.09 };
  finishVoice(v, ac);
  return v;
}

/** Pédale de sustain : les notes relâchées continuent de sonner tant qu'elle est enfoncée. */
export function setSustain(down) {
  sustain = down;
  if (ctx && resSend) resSend.gain.setTargetAtTime(down ? 0.22 : 0.02, ctx.currentTime, down ? 0.05 : 0.15);
  if (midiOutput.active) midiOutput.sustain(down, ctx ? audioToPerf(ctx.currentTime) : undefined);
  if (!down) {
    for (const m of sustained) releaseNote(m, true);
    sustained.clear();
  }
}

/** Relâche une note tenue (clavier MIDI / souris). */
export function releaseNote(midi, force = false) {
  const v = active.get(midi);
  // la sortie MIDI gère sa propre pédale : on envoie toujours le Note Off
  if (v?.midiSent && !v.midiOffSent) {
    v.midiOffSent = true;
    midiOutput.noteOff(midi);
  }
  if (sustain && !force) {
    sustained.add(midi);
    return;
  }
  if (!v || !ctx) return;
  active.delete(midi);
  if (v.midiOnly) return;
  const t = Math.max(ctx.currentTime, v.t0);
  damp(v, t, v.dampTau || 0.09);
}

export function stopAll() {
  const t = ctx ? ctx.currentTime : 0;
  for (const v of [...voices]) {
    removeVoice(v);
    damp(v, t, 0.05);
  }
  active.clear();
  sustained.clear();
  midiOutput.allNotesOff();
}

/** Clic de métronome (accent sur le 1er temps). Sortie MIDI : note 37 sur le canal 10. */
export function click(when, accent = false) {
  const ac = audioContext();
  const routing = midiOutput.routing();
  const sent = routing !== 'local' && midiOutput.click(audioToPerf(when), accent);
  if (routing === 'midi' && sent) return;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.frequency.value = accent ? 1600 : 1000;
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(accent ? 0.5 : 0.3, when + 0.001);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
  o.connect(g).connect(master);
  o.onended = () => disconnectAll([o, g]);
  o.start(when);
  o.stop(when + 0.06);
}

/** Petits sons de retour (bonne note / erreur / fin). */
export function feedbackSound(kind) {
  const ac = audioContext();
  const t = ac.currentTime;
  const seq = kind === 'success' ? [72, 76, 79, 84] : kind === 'error' ? [40] : [79];
  seq.forEach((m, i) => {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = kind === 'error' ? 'square' : 'sine';
    o.frequency.value = midiToFreq(m);
    g.gain.setValueAtTime(0.0001, t + i * 0.09);
    g.gain.exponentialRampToValueAtTime(kind === 'error' ? 0.05 : 0.12, t + i * 0.09 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.25);
    o.connect(g).connect(master);
    o.onended = () => disconnectAll([o, g]);
    o.start(t + i * 0.09);
    o.stop(t + i * 0.09 + 0.3);
  });
}

export const INSTRUMENT_LIST = [
  ['piano', 'Piano'],
  ['epiano', 'Piano électrique'],
  ['orgue', 'Orgue'],
  ['clavecin', 'Clavecin'],
];

/** Pour les tests : réinitialise le contexte audio. */
export function _resetForTests() {
  ctx = null;
  voices.length = 0;
  active.clear();
  sustained.clear();
  sustain = false;
}
