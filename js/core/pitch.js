// Détection de hauteur monophonique (algorithme YIN) + utilitaires de signal.
// Module pur : fonctionne dans le navigateur, dans un AudioWorklet et dans Node (tests).
import { goertzel } from './spectrum.js';

export function rms(buf, from = 0, to = buf.length) {
  let s = 0;
  for (let i = from; i < to; i++) s += buf[i] * buf[i];
  return to > from ? Math.sqrt(s / (to - from)) : 0;
}

/**
 * Fonction de différence YIN d(tau) = Σ_{j<W} (x[j] − x[j+tau])², boucle déroulée par blocs de 4.
 * (Le compilateur JIT garde 4 accumulateurs indépendants : ~3× plus rapide que la boucle naïve.)
 */
function diffAt(buf, tau, W) {
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
  let j = 0;
  const end4 = W - (W % 4);
  for (; j < end4; j += 4) {
    const a = buf[j] - buf[j + tau];
    const b = buf[j + 1] - buf[j + 1 + tau];
    const c = buf[j + 2] - buf[j + 2 + tau];
    const d = buf[j + 3] - buf[j + 3 + tau];
    s0 += a * a; s1 += b * b; s2 += c * c; s3 += d * d;
  }
  for (; j < W; j++) {
    const a = buf[j] - buf[j + tau];
    s0 += a * a;
  }
  return s0 + s1 + s2 + s3;
}

/**
 * Détecte la fréquence fondamentale d'un signal (YIN).
 * Optimisé : d(tau) est calculé au fur et à mesure et le calcul s'arrête dès que le premier minimum
 * sous le seuil est trouvé (résultat identique à l'algorithme complet, souvent 5 à 20× moins de calculs).
 * @param {Float32Array} buf échantillons
 * @param {number} sampleRate
 * @param {{threshold?:number, minFreq?:number, maxFreq?:number, minRms?:number}} opts
 * @returns {{freq:number, clarity:number, rms:number, tau:number} | null}
 */
let cmndScratch = new Float64Array(2050);
export function detectPitch(buf, sampleRate, opts = {}) {
  const { threshold = 0.15, minFreq = 27.5, maxFreq = 4200, minRms = 0.01 } = opts;
  const level = rms(buf);
  if (level < minRms) return null;

  const n = buf.length;
  const maxTau = Math.min(Math.floor(sampleRate / minFreq), Math.floor(n / 2));
  const minTau = Math.max(2, Math.floor(sampleRate / maxFreq));
  const W = n - maxTau;
  if (W < 64 || maxTau <= minTau) return null;

  // Différence moyenne normalisée cumulée, calculée paresseusement.
  // Tampon réutilisé d'un appel à l'autre (aucune allocation par trame) : seules les cases ≤ `computed` sont lues.
  if (cmndScratch.length < maxTau + 2) cmndScratch = new Float64Array(maxTau + 2);
  const cmnd = cmndScratch;
  cmnd[0] = 1;
  let computed = 0;
  let running = 0;
  const ensure = (tau) => {
    while (computed < tau && computed < maxTau) {
      const t = ++computed;
      const d = diffAt(buf, t, W);
      running += d;
      cmnd[t] = running > 0 ? (d * t) / running : 1;
    }
  };

  let tauEst = -1;
  for (let tau = minTau; tau <= maxTau; tau++) {
    ensure(tau);
    if (cmnd[tau] < threshold) {
      ensure(tau + 1);
      while (tau + 1 <= maxTau && cmnd[tau + 1] < cmnd[tau]) {
        tau++;
        ensure(tau + 1);
      }
      tauEst = tau;
      break;
    }
  }
  if (tauEst === -1) {
    // Pas de minimum sous le seuil : on prend le minimum global s'il reste raisonnable.
    let best = minTau;
    for (let tau = minTau; tau <= maxTau; tau++) if (cmnd[tau] < cmnd[best]) best = tau;
    if (cmnd[best] > 0.35) return null;
    tauEst = best;
  }
  ensure(tauEst + 1);

  // Interpolation parabolique pour la précision sub-échantillon
  let betterTau = tauEst;
  if (tauEst > 1 && tauEst < maxTau) {
    const s0 = cmnd[tauEst - 1], s1 = cmnd[tauEst], s2 = cmnd[tauEst + 1];
    const denom = 2 * (2 * s1 - s2 - s0);
    if (denom !== 0) betterTau = tauEst + (s2 - s0) / denom;
  }
  const freq = sampleRate / betterTau;
  if (freq < minFreq * 0.97 || freq > maxFreq * 1.03) return null;
  return { freq, clarity: Math.max(0, Math.min(1, 1 - cmnd[tauEst])), rms: level, tau: betterTau };
}

// ---------- sous-échantillonnage ----------
const firCache = new Map();
/** Filtre passe-bas FIR (sinus cardinal fenêtré de Blackman) pour décimer d'un facteur `factor`. */
export function decimationFilter(factor) {
  if (firCache.has(factor)) return firCache.get(factor);
  const taps = 8 * factor + 1;
  const half = (taps - 1) / 2;
  const fc = 0.45 / factor; // coupure en cycles/échantillon d'entrée (marge avant la nouvelle fréquence de Nyquist)
  const hcoef = new Float32Array(taps);
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const x = i - half;
    const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (taps - 1));
    hcoef[i] = sinc * w;
    sum += hcoef[i];
  }
  for (let i = 0; i < taps; i++) hcoef[i] /= sum;
  firCache.set(factor, hcoef);
  return hcoef;
}

/**
 * Décime un signal (filtre anti-repliement + 1 échantillon sur `factor`).
 * La sortie est alignée sur la FIN du tampon (les échantillons les plus récents sont conservés).
 */
export function decimate(buf, factor, out) {
  if (factor <= 1) return buf;
  const hcoef = decimationFilter(factor);
  const taps = hcoef.length;
  const len = Math.floor((buf.length - taps) / factor) + 1;
  if (len <= 0) return new Float32Array(0);
  const res = out && out.length === len ? out : new Float32Array(len);
  // dernier échantillon de sortie centré sur buf.length-1-half : on part de la fin
  const offset = buf.length - taps - (len - 1) * factor;
  for (let m = 0; m < len; m++) {
    const start = offset + m * factor;
    let s = 0;
    for (let k = 0; k < taps; k++) s += hcoef[k] * buf[start + k];
    res[m] = s;
  }
  return res;
}

/** Facteur de décimation conseillé pour l'analyse du grave (fréquence d'analyse ≥ 16 kHz). */
export function decimationFactor(sampleRate) {
  return Math.max(1, Math.floor(sampleRate / 16000));
}

/**
 * Contrôle spectral d'octave pour le grave : la fondamentale d'un piano grave est faible, YIN peut
 * se tromper d'une octave. On compare l'énergie aux harmoniques k·f et aux demi-harmoniques (k−½)·f.
 * @returns {number} facteur correctif : 0.5 (une octave plus bas), 2 (plus haut) ou 1
 */
export function octaveCheck(buf, sampleRate, freq) {
  const nyq = sampleRate / 2;
  let harm = 0, half = 0, odd = 0, even = 0;
  for (let k = 1; k <= 6; k++) {
    if (k * freq < nyq * 0.9) {
      const e = goertzel(buf, sampleRate, k * freq);
      harm += e;
      if (k % 2) odd += e;
      else even += e;
    }
    if ((k - 0.5) * freq < nyq * 0.9) half += goertzel(buf, sampleRate, (k - 0.5) * freq);
  }
  if (harm <= 0) return 1;
  if (half > harm * 0.6 && freq / 2 >= 26) return 0.5;
  if (even > 0 && odd < even * 0.08) return 2;
  return 1;
}

/**
 * Analyse adaptée au registre du piano :
 *  - fenêtre longue (4096 éch. à 44,1/48 kHz, sous-échantillonnée) sur toute la tessiture → registre ;
 *  - au-dessus de Do4 : fenêtre courte (2048 éch.) à pleine résolution sur les échantillons les plus récents
 *    (plus réactive et plus précise dans l'aigu) ;
 *  - en dessous : résultat de la fenêtre longue, vérifié par un contrôle spectral d'octave.
 * @param {Float32Array} buf échantillons, les plus récents à la fin (≥ longWindow conseillé)
 * @returns {{freq:number|null, clarity:number, rms:number, window:'short'|'long'|null}}
 */
let decScratch = new Float32Array(0);
export function detectPitchAdaptive(buf, sampleRate, opts = {}) {
  const { threshold = 0.15, minFreq = 27.5, maxFreq = 4200, minRms = 0.01, splitFreq = 261.6, downsample = true } = opts;
  const scale = Math.max(1, Math.round(sampleRate / 48000));
  const L = Math.min(buf.length, 4096 * scale);
  const S = Math.min(buf.length, 2048 * scale);
  const long = buf.length === L ? buf : buf.subarray(buf.length - L);
  const short = buf.subarray(buf.length - S);
  const level = rms(short);
  const longLevel = rms(long);
  const out = { freq: null, clarity: 0, rms: level, window: null };
  if (Math.max(level, longLevel) < minRms) return out;

  const factor = downsample ? decimationFactor(sampleRate) : 1;
  let dec = long;
  if (factor > 1) {
    // tampon de sortie réutilisé (la décimation ne sert que pendant cet appel)
    const len = Math.floor((long.length - decimationFilter(factor).length) / factor) + 1;
    if (len > 0 && decScratch.length !== len) decScratch = new Float32Array(len);
    dec = decimate(long, factor, decScratch);
  }
  const dsr = sampleRate / factor;
  const coarse = detectPitch(dec, dsr, { threshold, minRms: minRms * 0.5, minFreq, maxFreq: Math.min(maxFreq, dsr / 4) });

  if (!coarse || coarse.freq >= splitFreq * 0.97) {
    const fine = detectPitch(short, sampleRate, { threshold, minRms: minRms * 0.5, minFreq: Math.max(minFreq, splitFreq * 0.75), maxFreq });
    if (fine && fine.freq >= splitFreq * 0.9) return { freq: fine.freq, clarity: fine.clarity, rms: level, window: 'short' };
    if (!coarse) return out;
  }
  let freq = coarse.freq;
  if (freq < splitFreq) {
    const k = octaveCheck(dec, dsr, freq);
    if (k !== 1) {
      // on revérifie l'hypothèse corrigée avec YIN restreint autour de la nouvelle fréquence
      const alt = detectPitch(dec, dsr, { threshold: 0.3, minRms: 0, minFreq: Math.max(minFreq, freq * k * 0.94), maxFreq: Math.min(maxFreq, freq * k * 1.06, dsr / 4) });
      freq = alt ? alt.freq : freq * k;
    }
  }
  return { freq, clarity: coarse.clarity, rms: level, window: 'long' };
}

/** Génère une onde (utile pour les tests et la démo). */
export function synthTone(freqs, sampleRate, length, { harmonics = 4, amp = 0.3, amps = null, inharm = 0 } = {}) {
  const buf = new Float32Array(length);
  const list = Array.isArray(freqs) ? freqs : [freqs];
  for (const f of list) {
    for (let h = 1; h <= harmonics; h++) {
      const a = (amps ? amps[h - 1] ?? 0 : amp / h) / list.length;
      if (!a) continue;
      const w = (2 * Math.PI * f * h * Math.sqrt(1 + inharm * h * h)) / sampleRate;
      for (let i = 0; i < length; i++) buf[i] += a * Math.sin(w * i);
    }
  }
  return buf;
}
