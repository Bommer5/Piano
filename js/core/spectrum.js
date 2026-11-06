// Analyse spectrale : FFT + vérification d'accords (polyphonie).
// On ne cherche pas à « transcrire » n'importe quel accord (très difficile),
// mais à vérifier si les notes ATTENDUES sont présentes dans le son : c'est fiable et suffisant pour l'entraînement.
import { midiToFreq } from './notes.js';

/** FFT radix-2 en place. re/im : Float64Array de taille puissance de 2. */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = i + k + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** Spectre de magnitude (fenêtre de Hann). Renvoie Float32Array de taille n/2. */
export function magnitudeSpectrum(samples) {
  let n = 1;
  while (n < samples.length) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  const L = samples.length;
  for (let i = 0; i < L; i++) re[i] = samples[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (L - 1)));
  fft(re, im);
  const mag = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}

/** Convertit un spectre en dB (AnalyserNode.getFloatFrequencyData) en magnitudes linéaires. */
export function dbToMagnitude(db) {
  const out = new Float32Array(db.length);
  for (let i = 0; i < db.length; i++) out[i] = Number.isFinite(db[i]) ? Math.pow(10, db[i] / 20) : 0;
  return out;
}

function peakAround(mag, bin, halfWidth) {
  let best = 0;
  const lo = Math.max(1, Math.round(bin - halfWidth));
  const hi = Math.min(mag.length - 1, Math.round(bin + halfWidth));
  for (let i = lo; i <= hi; i++) if (mag[i] > best) best = mag[i];
  return best;
}

/**
 * Énergie « note » : pic autour de la fondamentale + harmoniques pondérées.
 * @param {Float32Array} mag spectre de magnitude (taille fftSize/2)
 */
export function noteStrength(mag, sampleRate, midi, a4 = 440) {
  const fftSize = mag.length * 2;
  const binHz = sampleRate / fftSize;
  const f0 = midiToFreq(midi, a4);
  let s = 0;
  const weights = [1, 0.6, 0.35];
  for (let h = 1; h <= 3; h++) {
    const f = f0 * h;
    if (f > sampleRate / 2) break;
    const bin = f / binHz;
    // ± un quart de ton, au moins 1 bin
    const half = Math.max(1, (f * (Math.pow(2, 1 / 24) - 1)) / binHz);
    s += weights[h - 1] * peakAround(mag, bin, half);
  }
  return s;
}

function median(arr) {
  const a = Array.from(arr).filter((x) => x > 0).sort((x, y) => x - y);
  if (!a.length) return 0;
  return a[Math.floor(a.length / 2)];
}

/**
 * Vérifie quelles notes attendues sont présentes dans le spectre.
 * @returns {{present:number[], missing:number[], strengths:Object<number,number>, ok:boolean}}
 */
export function matchChord(mag, sampleRate, expected, { a4 = 440, ratio = 0.12, noiseFactor = 6 } = {}) {
  const floor = median(mag) * noiseFactor;
  let maxPeak = 0;
  for (let i = 1; i < mag.length; i++) if (mag[i] > maxPeak) maxPeak = mag[i];
  const strengths = {};
  const present = [], missing = [];
  const binHz = sampleRate / (mag.length * 2);
  const at = (midi, h = 1) => {
    const f = midiToFreq(midi, a4) * h;
    return peakAround(mag, f / binHz, Math.max(0.6, (f * (Math.pow(2, 1 / 24) - 1)) / binHz));
  };
  const exp = new Set(expected);
  for (const m of expected) {
    strengths[m] = noteStrength(mag, sampleRate, m, a4);
    // Les graves du piano ont une fondamentale faible : on accepte aussi la 2e harmonique.
    const level = Math.max(at(m), m < 48 ? at(m, 2) * 0.8 : 0);
    // Le pic ne doit pas être simplement la « jupe » d'une note voisine plus forte.
    const neighbors = [m - 1, m + 1].filter((x) => !exp.has(x)).map((x) => at(x));
    const notSkirt = neighbors.every((v) => level >= v * 0.6);
    if (level > floor && level > maxPeak * ratio && notSkirt) present.push(m);
    else missing.push(m);
  }
  return { present, missing, strengths, ok: missing.length === 0 && expected.length > 0 };
}

/**
 * Estimation polyphonique simple : notes dont la fondamentale est un pic net,
 * en éliminant celles qui ne sont que des harmoniques d'une note plus grave.
 */
export function estimateNotes(mag, sampleRate, { a4 = 440, lo = 28, hi = 100, maxNotes = 6, ratio = 0.2 } = {}) {
  const fftSize = mag.length * 2;
  const binHz = sampleRate / fftSize;
  const floor = median(mag) * 8;
  const cand = [];
  let maxS = 0;
  for (let m = lo; m <= hi; m++) {
    const f = midiToFreq(m, a4);
    const p = peakAround(mag, f / binHz, Math.max(1, (f * 0.028) / binHz));
    // la note voisine ne doit pas être plus forte (sinon on est sur sa « jupe »)
    cand.push({ m, p });
    if (p > maxS) maxS = p;
  }
  const res = [];
  for (let i = 0; i < cand.length; i++) {
    const { m, p } = cand[i];
    if (p < floor || p < maxS * ratio) continue;
    const prev = cand[i - 1], next = cand[i + 1];
    if ((prev && prev.p > p) || (next && next.p > p)) continue;
    // harmonique d'une note déjà retenue ? (octave, quinte+octave, double octave)
    const isHarmonic = res.some((r) => [12, 19, 24, 28].includes(m - r.m) && p < r.p * 1.5);
    if (isHarmonic) continue;
    res.push({ m, p });
  }
  return res.sort((a, b) => b.p - a.p).slice(0, maxNotes).map((r) => r.m).sort((a, b) => a - b);
}
