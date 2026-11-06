// Synthétiseur de piano (Web Audio, sans échantillons à télécharger) + métronome.
import { midiToFreq } from '../core/notes.js';

let ctx = null;
let master = null;
let reverb = null;

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
    // petite réverbération synthétique
    reverb = ctx.createConvolver();
    const len = ctx.sampleRate * 1.6;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.18;
    reverb.connect(wet).connect(master);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function setVolume(v) {
  audioContext();
  master.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), ctx.currentTime, 0.02);
}

const INSTRUMENTS = {
  piano: { partials: [1, 0.5, 0.28, 0.16, 0.09, 0.05], decay: 2.2, attack: 0.004, inharm: 0.0004, type: 'sine' },
  epiano: { partials: [1, 0.3, 0.05, 0.12], decay: 2.8, attack: 0.006, inharm: 0, type: 'sine' },
  orgue: { partials: [1, 0.8, 0.6, 0.3, 0.2], decay: 99, attack: 0.02, inharm: 0, type: 'sine' },
  clavecin: { partials: [1, 0.9, 0.7, 0.5, 0.4, 0.3], decay: 1.2, attack: 0.002, inharm: 0, type: 'triangle' },
};

const active = new Map(); // midi -> voice

/**
 * Joue une note.
 * @param {number} midi
 * @param {{when?:number, dur?:number, velocity?:number, instrument?:string, a4?:number}} opts when/dur en secondes (temps AudioContext)
 */
export function playNote(midi, { when = 0, dur = 1, velocity = 0.8, instrument = 'piano', a4 = 440 } = {}) {
  const ac = audioContext();
  const inst = INSTRUMENTS[instrument] || INSTRUMENTS.piano;
  const t0 = Math.max(ac.currentTime, when || ac.currentTime);
  const f0 = midiToFreq(midi, a4);
  const out = ac.createGain();
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = Math.min(18000, f0 * (4 + velocity * 10));
  filter.Q.value = 0.4;
  // Les aigus s'éteignent plus vite que les graves
  const decay = inst.decay * Math.max(0.35, Math.min(1.6, 1.6 - (midi - 40) / 60));
  const peak = 0.22 * velocity;
  out.gain.setValueAtTime(0, t0);
  out.gain.linearRampToValueAtTime(peak, t0 + inst.attack);
  out.gain.setTargetAtTime(peak * 0.35, t0 + inst.attack, decay * 0.25);
  const end = t0 + Math.max(0.08, dur);
  out.gain.setTargetAtTime(0, end, 0.08);
  out.connect(filter);
  filter.connect(master);
  if (reverb) filter.connect(reverb);
  const oscs = inst.partials.map((amp, i) => {
    const h = i + 1;
    const o = ac.createOscillator();
    o.type = inst.type;
    o.frequency.value = f0 * h * Math.sqrt(1 + inst.inharm * h * h);
    const g = ac.createGain();
    g.gain.value = amp;
    o.connect(g).connect(out);
    o.start(t0);
    o.stop(end + 0.6);
    return o;
  });
  const voice = { out, oscs, end };
  oscs[0].onended = () => {
    out.disconnect();
    if (active.get(midi) === voice) active.delete(midi);
  };
  active.set(midi, voice);
  return voice;
}

/** Relâche une note tenue (clavier MIDI / souris). */
export function releaseNote(midi) {
  const v = active.get(midi);
  if (!v || !ctx) return;
  const t = ctx.currentTime;
  v.out.gain.cancelScheduledValues(t);
  v.out.gain.setTargetAtTime(0, t, 0.09);
  v.oscs.forEach((o) => {
    try {
      o.stop(t + 0.6);
    } catch {}
  });
  active.delete(midi);
}

export function stopAll() {
  for (const m of [...active.keys()]) releaseNote(m);
}

/** Clic de métronome (accent sur le 1er temps). */
export function click(when, accent = false) {
  const ac = audioContext();
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.frequency.value = accent ? 1600 : 1000;
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(accent ? 0.5 : 0.3, when + 0.001);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
  o.connect(g).connect(master);
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
