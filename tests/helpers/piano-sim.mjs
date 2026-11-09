// Simulateur de piano (cordes amorties, marteau, étouffoirs, pédale) + chaîne micro complète, pour les tests.
import { FrameAnalyser } from '../../js/core/micanalyser.js';
import { OnsetDetector, resolveMicNote } from '../../js/core/onset.js';
import { freqToMidiFloat, midiToFreq } from '../../js/core/notes.js';

export function piano(seq, sr, { noise = 0.002, tail = 1.2, gain = 1, pedal = false, detune = 0 } = {}) {
  const end = Math.max(...seq.map((n) => n.t)) + tail;
  const out = new Float32Array(Math.round(end * sr));
  let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  seq.forEach((n, idx) => {
    const f0 = midiToFreq(n.midi + detune / 100), i0 = Math.round(n.t * sr), vel = (n.vel ?? 0.5) * gain;
    // une corde refrappée repart de zéro : la note précédente de même hauteur est étouffée par le marteau
    const next = seq.find((m, j) => j > idx && m.midi === n.midi);
    let cut = next ? Math.round(next.t * sr) : Infinity;
    // étouffoir : sans pédale, la touche est relâchée ~60 ms après la note suivante (legato)
    const after = seq.find((m, j) => j > idx && m.t > n.t + 1e-6);
    if (!pedal && after) cut = Math.min(cut, Math.round((after.t + 0.06) * sr));
    for (let h = 1; h <= 8; h++) {
      const f = f0 * h * Math.sqrt(1 + 0.0004 * h * h); if (f > sr / 2.2) break;
      const amp = vel * 0.5 / Math.pow(h, 1.3), tau = 1.2 / Math.pow(h, 0.7) * Math.max(0.3, 1.5 - (n.midi - 40) / 50);
      const w = 2 * Math.PI * f / sr, ph = h * 1.3 + idx;
      for (let i = i0; i < out.length; i++) {
        const tt = (i - i0) / sr;
        let a = amp * Math.min(1, tt / 0.004) * Math.exp(-tt / tau);
        if (i >= cut) { const k = (i - cut) / (sr * (next && cut === Math.round(next.t * sr) ? 0.004 : 0.03)); if (k > 5) break; a *= Math.exp(-k); }
        out[i] += a * Math.sin(w * (i - i0) + ph);
      }
    }
    for (let i = 0; i < sr * 0.012 && i0 + i < out.length; i++) out[i0 + i] += vel * 0.06 * rnd() * Math.exp(-i / (sr * 0.004));
  });
  for (let i = 0; i < out.length; i++) out[i] += noise * rnd();
  return out;
}

export function run(samples, sr, { hopMs = 32, blockSize = 128 } = {}) {
  const fa = new FrameAnalyser(sr, { hopMs });
  const det = new OnsetDetector();
  const onsets = [];
  const emit = (r) => {
    const t = r.end / sr * 1000;
    const midi = r.freq ? Math.round(freqToMidiFloat(r.freq)) : null;
    const o = det.push({ t, rms: r.rms, midi, midiFloat: r.freq ? freqToMidiFloat(r.freq) : null, clarity: r.clarity, attackT: t - r.peakAge * 1000, transient: r.transient, transientT: r.transient ? t - r.transientAge * 1000 : undefined });
    if (o.onset != null) onsets.push({ midi: o.onset, t: Math.round(o.onsetT), at: Math.round(t) });
  };
  for (let i = 0; i + blockSize <= samples.length; i += blockSize) fa.push(samples.subarray(i, i + blockSize), emit);
  return onsets;
}
const rep = (midi, n, dt, o = {}) => Array.from({ length: n }, (_, k) => ({ midi, t: 0.3 + k * dt, ...o }));
export const CASES = [
  ['Do4 ×6 / 400 ms', rep(60, 6, 0.4)],
  ['Do4 ×8 / 200 ms', rep(60, 8, 0.2)],
  ['Do4 ×10 / 140 ms (rapide)', rep(60, 10, 0.14)],
  ['Sol3 ×5 / 600 ms', rep(55, 5, 0.6)],
  ['Do2 ×5 / 500 ms (grave)', rep(36, 5, 0.5)],
  ['La1 ×4 / 600 ms (très grave)', rep(33, 4, 0.6)],
  ['Do6 ×6 / 300 ms (aigu)', rep(84, 6, 0.3)],
  ['La4 ×6 doux', rep(69, 6, 0.35, { vel: 0.12 })],
  ['Do Do Ré Ré Mi Mi', [60, 60, 62, 62, 64, 64].map((m, k) => ({ midi: m, t: 0.3 + k * 0.4 }))],
  ['Gamme Do→Do / 250 ms', [60, 62, 64, 65, 67, 69, 71, 72].map((m, k) => ({ midi: m, t: 0.3 + k * 0.25 }))],
  ['Mi Mi Fa Sol Sol Fa Mi Ré (Ode)', [64, 64, 65, 67, 67, 65, 64, 62].map((m, k) => ({ midi: m, t: 0.3 + k * 0.5 }))],
  ['Do4 tenu 3 s (1 seule note)', [{ midi: 60, t: 0.3 }], { tail: 3 }],
  ['Do2 tenu 3 s (grave, 1 note)', [{ midi: 36, t: 0.3 }], { tail: 3 }],
  ['Octaves Do3 Do4 Do3 Do4', [48, 60, 48, 60].map((m, k) => ({ midi: m, t: 0.3 + k * 0.4 }))],
  ['Do Do Ré Ré Mi Mi avec pédale', [60, 60, 62, 62, 64, 64].map((m, k) => ({ midi: m, t: 0.3 + k * 0.4 })), { pedal: true, lenient: 2 }],
  ['Sol Sol Sol Mi (rapide 180 ms)', [67, 67, 67, 64].map((m, k) => ({ midi: m, t: 0.3 + k * 0.18 }))],
  ['Octaves Do4 Do5 Do4 Do5 Do5', [60, 72, 60, 72, 72].map((m, k) => ({ midi: m, t: 0.3 + k * 0.35 }))],
  ['Arpège grave Do2 Sol2 Do3 Sol2', [36, 43, 48, 43].map((m, k) => ({ midi: m, t: 0.3 + k * 0.45 }))],
  ['Do Do Sol Sol La La Sol (Ah vous dirai-je)', [60, 60, 67, 67, 69, 69, 67].map((m, k) => ({ midi: m, t: 0.3 + k * 0.4 }))],
  ['Frère Jacques Do Ré Mi Do ×2', [60, 62, 64, 60, 60, 62, 64, 60].map((m, k) => ({ midi: m, t: 0.3 + k * 0.38 }))],
  ['Piano désaccordé −35 cents : Mi Mi Fa Sol Sol', [64, 64, 64, 65, 67, 67, 67].map((m, k) => ({ midi: m, t: 0.3 + k * 0.5 })), { detune: -35 }],
  ['Piano +25 cents : La3 ×5', [57, 57, 57, 57, 57].map((m, k) => ({ midi: m, t: 0.3 + k * 0.4 })), { detune: 25 }],
  ['Si3 ×4 fort puis doux', [0.8, 0.2, 0.6, 0.15].map((v, k) => ({ midi: 59, t: 0.3 + k * 0.4, vel: v }))],
];
