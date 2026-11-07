// Transcription automatique d'un enregistrement audio → notes → partition.
// Module pur (aucune dépendance au DOM) : fonctionne dans le navigateur et dans Node (tests).
//
// Chaîne de traitement :
//   1. réduction à ~22 kHz + normalisation ;
//   2. analyse trame par trame (pas de 10 ms) : flux spectral (attaques), énergie RMS,
//      YIN (mélodie prédominante) avec lissage médian et estimation de l'accord (diapason) ;
//   3. segmentation : attaques + changements de hauteur stables ;
//   4. à chaque frontière, spectres « avant / après » : les notes NOUVELLES sont estimées sur
//      l'énergie qui apparaît (multi-f0 itératif avec soustraction des harmoniques), ce qui
//      sépare les attaques des notes tenues et détecte les notes répétées ;
//   5. suivi des notes (fin par décroissance, silence ou nouvelle frappe), mains (mélodie → MD,
//      accompagnement → MG), vélocités ;
//   6. tempo (autocorrélation + suivi de pulsation par programmation dynamique), mesure (3/4 ou 4/4),
//      tonalité (profils de Krumhansl-Schmuckler) ;
//   7. `toRawSong` : quantification sur une grille (1/4 de temps par défaut) → morceau en temps.
import { midiToFreq, freqToMidiFloat } from './notes.js';

const DEFAULTS = {
  polyphonic: true, // mélodie (MD) + accompagnement (MG)
  grid: 0.25, // grille de quantification en temps (0.25 = double croche, 0.125 = triple croche)
  hopSec: 0.01,
  minNoteSec: 0.06,
  minFreq: 50, // YIN
  maxFreq: 2200,
  lo: 24, // Do1
  hi: 108, // Do8
  maxPolyphony: 6, // notes nouvelles par attaque
  maxAccompaniment: 3, // notes de main gauche par accord
  relThreshold: 0.14, // saillance minimale relative (notes d'un même accord)
  endRatio: 0.1, // une note est éteinte sous 10 % (-20 dB) de son amplitude initiale
  yieldEvery: 600, // trames entre deux pauses (version asynchrone)
  onProgress: null,
};

// ---------------------------------------------------------------------------
// FFT (tables précalculées, réutilisées)
// ---------------------------------------------------------------------------

const fftTables = new Map();
function tables(n) {
  let t = fftTables.get(n);
  if (t) return t;
  const rev = new Uint32Array(n);
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) {
    cos[k] = Math.cos((2 * Math.PI * k) / n);
    sin[k] = -Math.sin((2 * Math.PI * k) / n);
  }
  t = { rev, cos, sin, re: new Float64Array(n), im: new Float64Array(n) };
  fftTables.set(n, t);
  return t;
}

function fftInPlace(re, im, t) {
  const n = re.length;
  const { rev, cos, sin } = t;
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
      tmp = im[i]; im[i] = im[j]; im[j] = tmp;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let k = 0, tw = 0; k < half; k++, tw += step) {
        const wr = cos[tw], wi = sin[tw];
        const a = i + k, b = a + half;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
}

const hannCache = new Map();
function hann(L) {
  let w = hannCache.get(L);
  if (!w) {
    w = new Float64Array(L);
    let s = 0;
    for (let i = 0; i < L; i++) s += w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / L);
    w.sum = s;
    hannCache.set(L, w);
  }
  return w;
}

/**
 * Deux spectres de magnitude (fenêtre de Hann, normalisés en amplitude : une sinusoïde
 * d'amplitude A donne un pic ≈ A) calculés avec une seule FFT complexe.
 */
function twoSpectra(x, startA, LA, startB, LB, N, outA, outB) {
  const t = tables(N);
  const { re, im } = t;
  re.fill(0); im.fill(0);
  const wa = hann(LA), wb = hann(LB);
  const n = x.length;
  for (let i = 0; i < LA; i++) { const j = startA + i; if (j >= 0 && j < n) re[i] = x[j] * wa[i]; }
  for (let i = 0; i < LB; i++) { const j = startB + i; if (j >= 0 && j < n) im[i] = x[j] * wb[i]; }
  fftInPlace(re, im, t);
  const ga = 1 / wa.sum, gb = 1 / wb.sum; // |X| = A·Σw/2 au pic → ×2/Σw ; les deux spectres sont séparés avec un facteur 1/2
  for (let k = 0; k < N / 2; k++) {
    const r1 = re[k], i1 = im[k];
    const r2 = re[(N - k) % N], i2 = im[(N - k) % N];
    if (outA) outA[k] = Math.hypot(r1 + r2, i1 - i2) * ga;
    if (outB) outB[k] = Math.hypot(i1 + i2, r2 - r1) * gb;
  }
}

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

function decimate(src, k) {
  if (k <= 1) return Float32Array.from(src);
  const n = Math.floor(src.length / k);
  const out = new Float32Array(n);
  const norm = k * k;
  const len = src.length;
  for (let i = 0; i < n; i++) {
    const c = i * k;
    let s = 0;
    for (let j = -(k - 1); j <= k - 1; j++) {
      const idx = c + j;
      if (idx >= 0 && idx < len) s += (k - Math.abs(j)) * src[idx];
    }
    out[i] = s / norm;
  }
  return out;
}

function median(arr) {
  if (!arr.length) return 0;
  const a = Array.from(arr).sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Amplitude maximale du spectre autour d'une fréquence (± max(1 bin, tol relative)). */
function ampAt(mag, f, binHz, rel = 0.025) {
  const c = f / binHz;
  const half = Math.max(1, (f * rel) / binHz);
  const lo = Math.max(1, Math.floor(c - half)), hi = Math.min(mag.length - 1, Math.ceil(c + half));
  let best = 0;
  for (let i = lo; i <= hi; i++) if (mag[i] > best) best = mag[i];
  return best;
}

function findPeaks(mag, loBin, hiBin, floor) {
  const peaks = [];
  const end = Math.min(mag.length - 2, hiBin);
  for (let i = Math.max(2, loBin); i <= end; i++) {
    const v = mag[i];
    if (v > floor && v >= mag[i - 1] && v > mag[i + 1]) {
      const a = Math.log(mag[i - 1] + 1e-12), b = Math.log(v + 1e-12), c = Math.log(mag[i + 1] + 1e-12);
      const d = a - 2 * b + c;
      const off = d < 0 ? clamp((0.5 * (a - c)) / d, -0.5, 0.5) : 0;
      peaks.push({ bin: i + off, idx: i, amp: Math.exp(b - 0.25 * (a - c) * off) });
    }
  }
  return peaks;
}

/**
 * Estimation multi-f0 itérative : on retient la note la plus saillante, on retire ses harmoniques
 * (en respectant la « régularité » de l'enveloppe spectrale pour ne pas effacer une note qui
 * tombe sur une harmonique), puis on recommence.
 * @param {Array<{f:number}>} peaks pics triés par fréquence
 * @param {Float64Array} val énergie de chaque pic (modifiée)
 */
function multiPitch(peaks, val, a4, o, maxNotes, fmax) {
  const freqs = peaks.map((p) => p.f);
  const nearest = (f, tol) => {
    let lo = 0, hi = freqs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (freqs[mid] < f) lo = mid + 1;
      else hi = mid;
    }
    let best = -1, bv = 0;
    for (let k = Math.max(0, lo - 2); k <= Math.min(freqs.length - 1, lo + 2); k++) {
      if (Math.abs(freqs[k] - f) <= tol && val[k] > bv) { bv = val[k]; best = k; }
    }
    return best;
  };
  const cands = new Map();
  for (let j = 0; j < peaks.length; j++) {
    if (val[j] <= 0) continue;
    const mf = freqToMidiFloat(freqs[j], a4);
    const m = Math.round(mf);
    if (Math.abs(mf - m) > 0.4 || m < o.lo || m > o.hi) continue;
    cands.set(m, true);
  }
  const res = [];
  const H = 8;
  let firstSal = 0;
  for (let it = 0; it < maxNotes && cands.size; it++) {
    let best = null;
    for (const m of cands.keys()) {
      const f0 = midiToFreq(m, a4);
      const A = new Float64Array(H + 2), I = new Int32Array(H + 2).fill(-1);
      let sal = 0;
      for (let h = 1; h <= H; h++) {
        const fh = f0 * h * Math.sqrt(1 + 0.0002 * h * h); // légère inharmonicité du piano
        if (fh > fmax) break;
        const k = nearest(fh, Math.max(o.binHz * 1.2, fh * 0.022));
        if (k >= 0) { A[h] = val[k]; I[h] = k; sal += A[h] / Math.sqrt(h); }
      }
      if (A[1] <= 0) { cands.delete(m); continue; }
      if (!best || sal > best.sal) best = { m, sal, A, I };
    }
    if (!best) break;
    if (!firstSal) firstSal = best.sal;
    if (best.sal < firstSal * o.relThreshold) break;
    cands.delete(best.m);
    const { A, I } = best;
    for (let h = 1; h <= H; h++) {
      if (I[h] < 0) continue;
      const e = h === 1 ? A[1] : Math.min(A[h], Math.max(A[h - 1], A[h + 1]));
      val[I[h]] = Math.max(0, val[I[h]] - e);
    }
    res.push({ midi: best.m, sal: best.sal, amp1: A[1] });
  }
  return res;
}

// ---------------------------------------------------------------------------
// Tempo, pulsation, mesure, tonalité
// ---------------------------------------------------------------------------

function estimatePeriod(env, fps) {
  // autocorrélation entre 50 et 200 BPM, préférence douce autour de 100 BPM (60-140)
  const minLag = Math.round((60 / 200) * fps), maxLag = Math.round((60 / 50) * fps);
  const n = env.length;
  let best = -1, bestLag = Math.round(0.6 * fps);
  const sc = new Float64Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += env[i] * env[i + lag];
    sc[lag] = s;
  }
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * fps) / lag;
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 100) / 0.8, 2));
    const local = sc[lag] >= sc[lag - 1] && sc[lag] >= sc[lag + 1];
    const v = sc[lag] * prior * (local ? 1 : 0.9);
    if (v > best) { best = v; bestLag = lag; }
  }
  let lag = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const a = sc[bestLag - 1], b = sc[bestLag], c = sc[bestLag + 1];
    const d = a - 2 * b + c;
    if (d < 0) lag += clamp((0.5 * (a - c)) / d, -0.5, 0.5);
  }
  return lag / fps;
}

/** Affine la période sur les instants d'attaque (périodogramme pondéré). */
function refinePeriod(P, times, weights) {
  if (times.length < 4) return P;
  let bestP = P, best = -1;
  for (let r = 0.94; r <= 1.0601; r += 0.002) {
    const p = P * r;
    let cs = 0, sn = 0;
    for (let i = 0; i < times.length; i++) {
      const ph = (2 * Math.PI * times[i]) / p;
      cs += weights[i] * Math.cos(ph);
      sn += weights[i] * Math.sin(ph);
    }
    const v = Math.hypot(cs, sn) * (1 - 0.5 * Math.abs(r - 1));
    if (v > best) { best = v; bestP = p; }
  }
  return bestP;
}

/** Suivi de pulsation par programmation dynamique (Ellis 2007). */
function trackBeats(env, fps, P) {
  const T = env.length;
  const p = P * fps;
  const C = new Float64Array(T), back = new Int32Array(T).fill(-1);
  const alpha = 50;
  for (let t = 0; t < T; t++) {
    const lo = Math.max(0, Math.round(t - 2 * p)), hi = Math.round(t - p / 2);
    let best = -Infinity, arg = -1;
    for (let tau = lo; tau <= hi; tau++) {
      const l = Math.log((t - tau) / p);
      const v = C[tau] - alpha * l * l;
      if (v > best) { best = v; arg = tau; }
    }
    C[t] = env[t] + (arg >= 0 ? best : 0);
    back[t] = arg;
  }
  let end = T - 1;
  for (let t = Math.max(0, Math.round(T - 1 - p)); t < T; t++) if (C[t] > C[end]) end = t;
  const beats = [];
  for (let t = end; t >= 0; t = back[t]) beats.push(t / fps);
  return beats.reverse();
}

const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const MAJOR_FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];
const KEY_NAMES = ['Do', 'Ré♭', 'Ré', 'Mi♭', 'Mi', 'Fa', 'Fa♯', 'Sol', 'La♭', 'La', 'Si♭', 'Si'];

function corr(a, b) {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let s = 0, sa = 0, sb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    s += x * y; sa += x * x; sb += y * y;
  }
  return sa && sb ? s / Math.sqrt(sa * sb) : 0;
}

/** Tonalité (Krumhansl-Schmuckler) → { keyFifths, tonic, mode, name, score }. */
export function estimateKey(notes) {
  const hist = new Array(12).fill(0);
  let lowest = Infinity;
  for (const n of notes) lowest = Math.min(lowest, n.midi);
  for (const n of notes) {
    const w = Math.min(n.durSec ?? n.dur ?? 1, 2) * ((n.velocity ?? 80) / 127);
    hist[((n.midi % 12) + 12) % 12] += w;
  }
  // la dernière note (souvent la tonique) compte un peu plus
  const last = [...notes].sort((a, b) => (a.startSec ?? a.start) - (b.startSec ?? b.start)).filter((n, i, arr) => (n.startSec ?? n.start) >= (arr[arr.length - 1].startSec ?? arr[arr.length - 1].start) - 0.05);
  for (const n of last) hist[((n.midi % 12) + 12) % 12] += 0.5;
  let best = { score: -Infinity, keyFifths: 0, tonic: 0, mode: 'major' };
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const mode of ['major', 'minor']) {
      const prof = mode === 'major' ? KS_MAJOR : KS_MINOR;
      const rot = hist.map((_, i) => prof[(i - tonic + 12) % 12]);
      const fifths = mode === 'major' ? MAJOR_FIFTHS[tonic] : MAJOR_FIFTHS[(tonic + 3) % 12];
      const score = corr(hist, rot) - 0.004 * Math.abs(fifths);
      if (score > best.score) best = { score, keyFifths: fifths, tonic, mode };
    }
  }
  best.name = `${KEY_NAMES[best.tonic]} ${best.mode === 'major' ? 'majeur' : 'mineur'}`;
  return best;
}

/** Mesure (3/4 ou 4/4) et position du premier temps fort à partir des accents par temps. */
function estimateMeter(acc) {
  const n = acc.length;
  if (n < 6) return { num: 4, phase: 0, scores: {} };
  const mean = acc.reduce((x, y) => x + y, 0) / n;
  const scores = {}, means = {};
  // statistique F : le motif d'accents se répète-t-il toutes les M pulsations ?
  for (const M of [2, 3, 4]) {
    const sum = new Array(M).fill(0), cnt = new Array(M).fill(0);
    for (let k = 0; k < n; k++) { sum[k % M] += acc[k]; cnt[k % M]++; }
    const m = sum.map((v, i) => v / Math.max(1, cnt[i]));
    let ssb = 0, ssw = 0;
    for (let i = 0; i < M; i++) ssb += cnt[i] * (m[i] - mean) * (m[i] - mean);
    for (let k = 0; k < n; k++) ssw += (acc[k] - m[k % M]) * (acc[k] - m[k % M]);
    scores[M] = ssb / (M - 1) / (ssw / Math.max(1, n - M) + 0.01 * mean * mean + 1e-9);
    means[M] = m;
  }
  const three = n >= 9 && scores[3] > 2 && scores[3] > 1.3 * Math.max(scores[4], scores[2]);
  const num = three ? 3 : 4;
  const m = means[num];
  let phase = 0;
  for (let i = 1; i < num; i++) if (m[i] > m[phase]) phase = i;
  // anacrouse seulement si un autre placement du temps fort est nettement plus convaincant
  if (phase !== 0 && (scores[num] < 2 || m[phase] - m[0] < 0.25 * mean)) phase = 0;
  return { num, phase, scores };
}

// ---------------------------------------------------------------------------
// Transcription
// ---------------------------------------------------------------------------

function emptyResult(extra = {}) {
  return { notes: [], tempo: 90, beatTimes: [], beatOffset: 0, keyFifths: 0, keyName: 'Do majeur', timeSig: [4, 4], confidence: 0, tuningCents: 0, duration: 0, ...extra };
}

function* run(samples, sampleRate, opts, out) {
  const o = { ...DEFAULTS, ...opts };
  if (!samples || !samples.length || !(sampleRate > 0)) {
    out.result = emptyResult();
    return;
  }
  // 1. Réduction à ~22 kHz et normalisation -----------------------------------------
  const k = Math.max(1, Math.round(sampleRate / 22050));
  const x = decimate(samples, k);
  const sr = sampleRate / k;
  const duration = samples.length / sampleRate;
  let peak = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > peak && Number.isFinite(a)) peak = a;
  }
  if (peak < 1e-4 || x.length < sr * 0.1) {
    out.result = emptyResult({ duration });
    return;
  }
  for (let i = 0; i < x.length; i++) x[i] = Number.isFinite(x[i]) ? x[i] / peak * 0.9 : 0;
  const n = x.length;
  const cum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cum[i + 1] = cum[i] + x[i] * x[i];
  const rmsBetween = (a, b) => {
    a = clamp(Math.round(a), 0, n); b = clamp(Math.round(b), 0, n);
    return b > a ? Math.sqrt((cum[b] - cum[a]) / (b - a)) : 0;
  };

  // 2. Analyse par trames -----------------------------------------------------------
  const hop = Math.max(32, Math.round(sr * o.hopSec));
  const fps = sr / hop;
  const nF = Math.floor(n / hop) + 1;
  const NF = 1024;
  const flux = new Float64Array(nF);
  const rmsF = new Float64Array(nF);
  const binHzF = sr / NF;
  const fluxLo = Math.max(1, Math.round(40 / binHzF)), fluxHi = Math.min(NF / 2 - 1, Math.round(6000 / binHzF));
  const magA = new Float64Array(NF / 2), magB = new Float64Array(NF / 2);
  let prevL = new Float64Array(NF / 2), curL = new Float64Array(NF / 2);
  const gamma = 300;

  // YIN sur un signal réduit à ~11 kHz, une trame sur deux (20 ms)
  const k3 = sr > 16000 ? 2 : 1;
  const x3 = decimate(x, k3);
  const sr3 = sr / k3;
  const cum3 = new Float64Array(x3.length + 1);
  for (let i = 0; i < x3.length; i++) cum3[i + 1] = cum3[i] + x3[i] * x3[i];
  const W = Math.round(sr3 * 0.046);
  const maxTau = Math.floor(sr3 / o.minFreq), minTau = Math.max(2, Math.floor(sr3 / o.maxFreq));
  let NY = 1;
  while (NY < W + maxTau + 1) NY <<= 1;
  const yinStep = 2;
  const nY = Math.ceil(nF / yinStep);
  const yinMidi = new Float64Array(nY).fill(NaN);
  const yinClar = new Float64Array(nY);
  const cmnd = new Float64Array(maxTau + 1);

  const yinAt = (yi) => {
    const t = (yi * yinStep * hop) / sr;
    const s = Math.round(t * sr3 - (W + maxTau) / 2);
    if (s < 0 || s + W + maxTau >= x3.length) return;
    const e0 = cum3[s + W] - cum3[s];
    if (Math.sqrt(e0 / W) < 0.01) return;
    const tb = tables(NY);
    const { re, im } = tb;
    re.fill(0); im.fill(0);
    for (let i = 0; i < W; i++) re[i] = x3[s + i];
    for (let i = 0; i < W + maxTau; i++) im[i] = x3[s + i];
    fftInPlace(re, im, tb);
    // spectre croisé conj(A)·B, puis FFT inverse (par conjugaison)
    for (let kk = 0; kk <= NY / 2; kk++) {
      const k2 = (NY - kk) % NY;
      const zr = re[kk], zi = im[kk], wr = re[k2], wi = im[k2];
      const ar = (zr + wr) / 2, ai = (zi - wi) / 2; // A_k
      const br = (zi + wi) / 2, bi = (wr - zr) / 2; // B_k
      const cr = ar * br + ai * bi, ci = ar * bi - ai * br; // conj(A)·B
      re[kk] = cr; im[kk] = -ci;
      if (k2 !== kk) { re[k2] = cr; im[k2] = ci; }
    }
    fftInPlace(re, im, tb);
    // r(τ) = re[τ]/NY
    let running = 0;
    cmnd[0] = 1;
    for (let tau = 1; tau <= maxTau; tau++) {
      const r = re[tau] / NY;
      const eTau = cum3[s + tau + W] - cum3[s + tau];
      const d = Math.max(0, e0 + eTau - 2 * r);
      running += d;
      cmnd[tau] = running > 0 ? (d * tau) / running : 1;
    }
    let tauEst = -1;
    for (let tau = minTau; tau <= maxTau; tau++) {
      if (cmnd[tau] < 0.15) {
        while (tau + 1 <= maxTau && cmnd[tau + 1] < cmnd[tau]) tau++;
        tauEst = tau;
        break;
      }
    }
    if (tauEst < 0) {
      let b = minTau;
      for (let tau = minTau; tau <= maxTau; tau++) if (cmnd[tau] < cmnd[b]) b = tau;
      if (cmnd[b] > 0.35) return;
      tauEst = b;
    }
    let bt = tauEst;
    if (tauEst > 1 && tauEst < maxTau) {
      const s0 = cmnd[tauEst - 1], s1 = cmnd[tauEst], s2 = cmnd[tauEst + 1];
      const den = 2 * (2 * s1 - s2 - s0);
      if (den !== 0) bt = tauEst + (s2 - s0) / den;
    }
    const f = sr3 / bt;
    if (f < o.minFreq * 0.97 || f > o.maxFreq * 1.03) return;
    yinMidi[yi] = freqToMidiFloat(f);
    yinClar[yi] = clamp(1 - cmnd[tauEst], 0, 1);
  };

  for (let f = 0; f < nF; f += 2) {
    // deux trames d'un coup (fenêtres finissant à l'instant de la trame)
    const t1 = f * hop, t2 = (f + 1) * hop;
    twoSpectra(x, t1 - NF, NF, t2 - NF, NF, NF, magA, magB);
    for (const [ff, mag] of [[f, magA], [f + 1, magB]]) {
      if (ff >= nF) break;
      let s = 0;
      for (let b = fluxLo; b <= fluxHi; b++) {
        const L = Math.log(1 + gamma * mag[b]);
        curL[b] = L;
        const d = L - prevL[b];
        if (d > 0) s += d;
      }
      flux[ff] = ff === 0 ? 0 : s / (fluxHi - fluxLo + 1);
      [prevL, curL] = [curL, prevL];
      rmsF[ff] = rmsBetween(ff * hop, ff * hop + 2 * hop);
    }
    yinAt(f / yinStep);
    if (f % o.yieldEvery === 0) yield 0.45 * (f / nF);
  }

  // 3. Niveaux de référence -----------------------------------------------------------
  let maxRms = 0;
  for (let f = 0; f < nF; f++) if (rmsF[f] > maxRms) maxRms = rmsF[f];
  const sortedRms = Array.from(rmsF).sort((a, b) => a - b);
  const noiseRms = sortedRms[Math.floor(sortedRms.length * 0.05)] || 0;
  // le 5e centile n'est du bruit que s'il y a des silences : plafonné à -26 dB du maximum
  const silenceThr = Math.max(maxRms * 0.012, Math.min(noiseRms * 2.5, maxRms * 0.05), 2e-4);

  // Accord (diapason) : écart moyen circulaire des trames bien voisées
  let cs = 0, sn = 0, cnt = 0;
  for (let i = 0; i < nY; i++) {
    if (!(yinClar[i] > 0.9)) continue;
    const dev = yinMidi[i] - Math.round(yinMidi[i]);
    cs += Math.cos(2 * Math.PI * dev); sn += Math.sin(2 * Math.PI * dev); cnt++;
  }
  let tuningCents = cnt > 10 ? (Math.atan2(sn, cs) / (2 * Math.PI)) * 100 : 0;
  if (Math.abs(tuningCents) < 5) tuningCents = 0;
  const a4 = 440 * Math.pow(2, tuningCents / 1200);

  // Hauteur lissée (médiane sur 5 trames YIN)
  const yinStable = new Array(nY).fill(null);
  for (let i = 0; i < nY; i++) {
    const vals = [];
    for (let j = i - 2; j <= i + 2; j++) {
      if (j >= 0 && j < nY && yinClar[j] > 0.75) vals.push(Math.round(yinMidi[j] - tuningCents / 100));
    }
    if (vals.length >= 3) yinStable[i] = median(vals);
  }

  // 4. Attaques (flux spectral, seuil adaptatif) -------------------------------------
  let fluxMax = 0;
  for (let f = 0; f < nF; f++) if (flux[f] > fluxMax) fluxMax = flux[f];
  const fcum = new Float64Array(nF + 1);
  for (let f = 0; f < nF; f++) fcum[f + 1] = fcum[f] + flux[f];
  const Wm = Math.round(0.2 * fps);
  const onsets = [];
  for (let f = 1; f < nF - 1; f++) {
    const v = flux[f];
    if (v <= 0) continue;
    let isMax = true;
    for (let j = Math.max(0, f - 3); j <= Math.min(nF - 1, f + 3); j++) {
      if (j !== f && (flux[j] > v || (j < f && flux[j] === v))) { isMax = false; break; }
    }
    if (!isMax) continue;
    const a = Math.max(0, f - Wm), b = Math.min(nF, f + Wm + 1);
    const localMean = (fcum[b] - fcum[a]) / (b - a);
    if (v < 1.4 * localMean + 0.05 * fluxMax) continue;
    const t = (f - 1.5) / fps; // compense le retard de la fenêtre (mesuré sur attaques franches)
    if (rmsBetween(t * sr, (t + 0.06) * sr) < silenceThr * 1.5) continue;
    const last = onsets[onsets.length - 1];
    if (last && t - last.t < 0.05) {
      if (v > last.v) { last.t = t; last.v = v; }
      continue;
    }
    onsets.push({ t, v, kind: 'onset' });
  }

  // Changements de hauteur stables sans attaque (legato, sons tenus)
  const yinT = (i) => (i * yinStep) / fps;
  const changes = [];
  let cur = null, run = 0, candV = null, runStart = 0;
  for (let i = 0; i < nY; i++) {
    const v = yinStable[i];
    if (v === cur) { run = 0; candV = null; continue; }
    if (v === candV) run++;
    else { candV = v; run = 1; runStart = i; }
    if (run >= 3) {
      if (v != null) changes.push({ t: yinT(runStart) - 0.03, v: 0, kind: 'pitch' });
      cur = v; candV = null; run = 0;
    }
  }
  const bounds = [...onsets];
  for (const c of changes) if (!onsets.some((on) => Math.abs(on.t - c.t) < 0.1) && c.t > 0) bounds.push(c);
  bounds.sort((a, b) => a.t - b.t);

  // Débuts de silence (fin forcée des notes)
  const silences = [];
  {
    let runF = 0;
    for (let f = 0; f < nF; f++) {
      if (rmsF[f] < silenceThr) {
        runF++;
        if (runF === Math.max(2, Math.round(0.04 * fps))) silences.push((f - runF + 1) / fps);
      } else runF = 0;
    }
  }

  // 5. Analyse spectrale aux frontières + suivi des notes ----------------------------
  const N = 4096;
  const binHz = sr / N;
  o.binHz = binHz;
  const pre = new Float64Array(N / 2), post = new Float64Array(N / 2);
  const NS = 2048, LS = 1024, binHzS = sr / NS;
  const preS = new Float64Array(NS / 2), postS = new Float64Array(NS / 2);
  const fmax = Math.min(sr * 0.45, 7000);
  const loBin = Math.floor(midiToFreq(o.lo - 0.5, a4) / binHz), hiBin = Math.ceil(fmax / binHz);
  const notes = [];
  let active = [];
  let silIdx = 0;
  const audioEnd = n / sr;

  const endNote = (note, t) => {
    note.endSec = Math.max(note.startSec + 0.01, t);
    notes.push(note);
  };
  const closeBySilence = (upTo) => {
    while (silIdx < silences.length && silences[silIdx] <= upTo) {
      const ts = silences[silIdx++];
      active = active.filter((a) => {
        if (a.startSec < ts) { endNote(a, ts); return false; }
        return true;
      });
    }
  };
  // vérifie la décroissance des notes actives sur un spectre centré en tc
  const decayCheck = (mag, tc) => {
    active = active.filter((a) => {
      const f0 = midiToFreq(a.midi, a4);
      const amp = ampAt(mag, f0, binHz);
      const thr = a.amp0 * o.endRatio;
      if (amp < thr || amp < a.floor) {
        // instant de passage sous le seuil, en supposant une décroissance exponentielle
        let te = tc;
        if (a.lastAmp > thr && amp > 0 && tc > a.lastT) te = a.lastT + ((tc - a.lastT) * Math.log(a.lastAmp / thr)) / Math.log(a.lastAmp / Math.max(amp, 1e-9));
        endNote(a, clamp(te, a.lastT, tc));
        return false;
      }
      a.lastAmp = amp; a.lastT = tc;
      return true;
    });
  };

  const prog0 = 0.45;
  for (let bi = 0; bi < bounds.length; bi++) {
    const tb = bounds[bi].t;
    const prevT = bi > 0 ? bounds[bi - 1].t : -1;
    const nextT = bi + 1 < bounds.length ? bounds[bi + 1].t : audioEnd;
    closeBySilence(tb);
    const Lpost = Math.round(clamp((nextT - tb - 0.02) * sr, 1024, N));
    const Lpre = Math.round(clamp((tb - prevT - 0.03) * sr, 1024, N));
    const sPost = Math.round((tb + 0.02) * sr);
    const sPre = Math.round((tb - 0.015) * sr) - Lpre;
    twoSpectra(x, sPre, Lpre, sPost, Lpost, N, pre, post);
    // fenêtres courtes juste avant / juste après : détectent les re-frappes malgré la résonance
    twoSpectra(x, Math.round((tb - 0.012) * sr) - LS, LS, Math.round((tb + 0.012) * sr), LS, NS, preS, postS);
    const activeHarm = (f) => active.some((a) => {
      const r = f / midiToFreq(a.midi, a4);
      const h = Math.round(r);
      return h >= 1 && h <= 3 && Math.abs(r / h - 1) < 0.03;
    });
    const shortNew = (f) => {
      // une fenêtre de 46 ms ne sépare pas les graves voisins (battements) : réservé aux f > 250 Hz
      if (f < 250) return 0;
      const a = ampAt(postS, f, binHzS, 0.03), b = ampAt(preS, f, binHzS, 0.03);
      // ×1.5 : la résonance de la note précédente masque une partie de la re-frappe
      return a > 0 && bounds[bi].kind === 'onset' ? Math.min(1, Math.max(0, (1.5 * (a - b)) / a)) : 0;
    };
    // plancher de bruit
    const band = Array.from(post.subarray(loBin, hiBin));
    const floor = Math.max(median(band) * 4, 0.0015);

    // décroissance des notes actives juste avant la frontière
    decayCheck(pre, (sPre + Lpre / 2) / sr);

    const peaks = findPeaks(post, loBin, hiBin, floor);
    for (const p of peaks) {
      p.f = p.bin * binHz;
      p.pre = Math.max(pre[p.idx - 1] || 0, pre[p.idx], pre[p.idx + 1] || 0);
      // la mesure courte ne sert qu'aux notes déjà actives (re-frappe) : ailleurs, le « clic »
      // d'attaque d'une autre note la fausserait
      const rel = activeHarm(p.f);
      p.newAmp = Math.max(p.amp - p.pre, rel ? p.amp * shortNew(p.f) : 0, 0);
    }
    const val = Float64Array.from(peaks, (p) => p.newAmp);
    let found = multiPitch(peaks, val, a4, o, o.maxPolyphony, fmax);
    found = found.filter((c) => {
      const f0 = midiToFreq(c.midi, a4);
      const postA = ampAt(post, f0, binHz), preA = ampAt(pre, f0, binHz);
      c.amp0 = postA;
      c.amp0h2 = ampAt(post, 2 * f0, binHz);
      // énergie réellement nouvelle (au moins +30 %) et au-dessus du bruit
      return postA > floor * 1.5 && Math.max((postA - preA) / postA, activeHarm(f0) ? shortNew(f0) : 0) > 0.28;
    });
    // Repli : hauteur YIN stable juste après la frontière
    if (!found.length) {
      const i0 = Math.ceil(((tb + 0.03) * fps) / yinStep), i1 = Math.floor(((Math.min(nextT, tb + 0.15)) * fps) / yinStep);
      const vals = [];
      for (let i = i0; i <= i1 && i < nY; i++) if (yinStable[i] != null) vals.push(yinStable[i]);
      if (vals.length >= 2) {
        const m = median(vals);
        const f0 = midiToFreq(m, a4);
        const postA = ampAt(post, f0, binHz), preA = ampAt(pre, f0, binHz);
        if (m >= o.lo && m <= o.hi && postA > floor && (postA - preA) / postA > 0.2) {
          found = [{ midi: m, sal: postA, amp1: postA, amp0: postA, amp0h2: ampAt(post, 2 * f0, binHz) }];
        }
      }
    }
    if (!o.polyphonic && found.length > 1) {
      const maxSal = Math.max(...found.map((c) => c.sal));
      found = [found.filter((c) => c.sal >= 0.35 * maxSal).sort((a, b) => b.midi - a.midi)[0]];
    }
    if (found.length) {
      const level = rmsBetween(tb * sr, (tb + 0.08) * sr);
      for (const c of found) {
        // une note identique encore active est re-frappée
        active = active.filter((a) => {
          if (a.midi === c.midi) { endNote(a, tb); return false; }
          return true;
        });
        active.push({ midi: c.midi, startSec: tb, sal: c.sal, amp0: c.amp0, amp0h2: c.amp0h2, lastAmp: c.amp0, lastT: tb + 0.02 + Lpost / sr / 2, floor: floor * 1.2, level, kind: bounds[bi].kind });
      }
    } else {
      // pas de note nouvelle : vérifier tout de même l'extinction des notes actives
      decayCheck(post, (sPost + Lpost / 2) / sr);
    }
    // points de contrôle à l'intérieur des segments longs
    for (let tc = tb + 0.35; tc < nextT - 0.12 && active.length; tc += 0.25) {
      closeBySilence(tc);
      const L = N;
      twoSpectra(x, Math.round(tc * sr - L / 2), L, 0, 16, N, post, null);
      decayCheck(post, tc);
    }
    if (bi % 20 === 0) yield prog0 + 0.45 * (bi / Math.max(1, bounds.length));
  }
  closeBySilence(audioEnd);
  for (const a of active) {
    // extrapolation de la décroissance jusqu'à la fin du fichier
    endNote(a, audioEnd);
  }
  active = [];

  // 6. Nettoyage, mains, vélocités ----------------------------------------------------
  let cleaned = notes.filter((nt) => nt.endSec - nt.startSec >= o.minNoteSec && nt.startSec >= 0);
  cleaned.sort((a, b) => a.startSec - b.startSec || b.midi - a.midi);

  // regroupement par attaque
  const groups = [];
  for (const nt of cleaned) {
    const g = groups[groups.length - 1];
    if (g && nt.startSec - g.t < 0.035) g.notes.push(nt);
    else groups.push({ t: nt.startSec, notes: [nt] });
  }
  // vélocités : niveau RMS de l'attaque, réparti selon l'amplitude relative de chaque note
  let maxLevel = 0;
  for (const g of groups) for (const nt of g.notes) maxLevel = Math.max(maxLevel, nt.level);
  for (const g of groups) {
    const maxAmp = Math.max(...g.notes.map((nt) => nt.amp0));
    for (const nt of g.notes) {
      const db = 20 * Math.log10(Math.max(1e-6, nt.level / (maxLevel || 1))) + 10 * Math.log10(Math.max(1e-6, nt.amp0 / maxAmp));
      nt.velocity = Math.round(clamp(105 + 2 * db, 15, 127));
    }
  }
  // mains
  const polyGroups = groups.filter((g) => g.notes.length > 1).length;
  let overlaps = 0;
  for (let i = 1; i < cleaned.length; i++) if (cleaned[i].startSec < cleaned[i - 1].endSec - 0.1 && cleaned[i].startSec - cleaned[i - 1].startSec > 0.035) overlaps++;
  const isMono = polyGroups <= groups.length * 0.1 && overlaps <= cleaned.length * 0.15;
  if (isMono) {
    const mids = cleaned.map((nt) => nt.midi);
    const lo = Math.min(...mids), hi = Math.max(...mids);
    // ligne unique : partagée au Do central seulement si elle s'étend vraiment des deux côtés
    const below = mids.filter((m) => m < 60).length / mids.length;
    const split = lo < 60 && hi >= 60 && hi - lo > 7 && below >= 0.2 && below <= 0.8;
    for (const nt of cleaned) {
      if (split) nt.hand = nt.midi >= 60 ? 'R' : 'L';
      else nt.hand = hi < 55 || (below > 0.8 && median(mids) < 55) ? 'L' : 'R';
    }
  } else {
    const tops = median(groups.map((g) => Math.max(...g.notes.map((nt) => nt.midi))));
    let melEnd = -Infinity, melMidi = null;
    for (const g of groups) {
      g.notes.sort((a, b) => b.midi - a.midi);
      const top = g.notes[0];
      const melodyActive = melEnd > g.t + 0.05;
      const isMelody = melodyActive ? top.midi >= melMidi - 7 : top.midi >= Math.max(48, tops - 12);
      g.notes.forEach((nt, i) => (nt.hand = i === 0 && isMelody ? 'R' : 'L'));
      if (isMelody) { melEnd = top.endSec; melMidi = top.midi; }
      // accompagnement limité : la basse + les notes les plus fortes
      const left = g.notes.filter((nt) => nt.hand === 'L');
      if (left.length > o.maxAccompaniment) {
        const bass = left[left.length - 1];
        const keep = new Set([bass, ...left.slice(0, -1).sort((a, b) => b.amp0 - a.amp0).slice(0, o.maxAccompaniment - 1)]);
        g.notes = g.notes.filter((nt) => nt.hand === 'R' || keep.has(nt));
      }
    }
    cleaned = groups.flatMap((g) => g.notes);
  }
  // chaque main : une note ne déborde pas sur l'attaque suivante (MD = ligne mélodique, MG = accords)
  for (const hand of ['R', 'L']) {
    const hs = cleaned.filter((nt) => nt.hand === hand).sort((a, b) => a.startSec - b.startSec);
    const starts = [...new Set(hs.map((nt) => nt.startSec))];
    let gi = 0;
    for (const nt of hs) {
      while (gi < starts.length && starts[gi] <= nt.startSec + 0.035) gi++;
      const next = starts[gi];
      if (next != null) {
        if (nt.endSec > next) nt.endSec = next;
        else if (next - nt.endSec < 0.06) nt.endSec = next; // petits trous comblés (legato)
      }
    }
  }
  cleaned = cleaned.filter((nt) => nt.endSec - nt.startSec >= o.minNoteSec * 0.8);
  cleaned.sort((a, b) => a.startSec - b.startSec || a.midi - b.midi);
  yield 0.93;

  if (!cleaned.length) {
    out.result = emptyResult({ duration, tuningCents });
    return;
  }

  // 7. Tempo, pulsations, mesure, tonalité ------------------------------------------
  const efps = 100;
  const lastEnd = Math.max(...cleaned.map((nt) => nt.endSec));
  const T = Math.ceil(lastEnd * efps) + 2;
  const env = new Float64Array(T);
  const gTimes = [], gW = [];
  {
    const gs = [];
    for (const nt of cleaned) {
      const g = gs[gs.length - 1];
      if (g && nt.startSec - g.t < 0.035) { g.w = Math.max(g.w, nt.velocity / 127); g.n++; }
      else gs.push({ t: nt.startSec, w: nt.velocity / 127, n: 1 });
    }
    for (const g of gs) {
      const w = g.w * (1 + 0.15 * Math.min(g.n - 1, 3));
      gTimes.push(g.t); gW.push(w);
      for (let d = -6; d <= 6; d++) {
        const i = Math.round(g.t * efps) + d;
        if (i >= 0 && i < T) env[i] += w * Math.exp(-0.5 * (d / 2) * (d / 2));
      }
    }
  }
  let P = gTimes.length >= 3 ? estimatePeriod(env, efps) : 60 / 90;
  P = refinePeriod(P, gTimes, gW);
  let beats = gTimes.length >= 4 ? trackBeats(env, efps, P) : [];
  if (beats.length < 2) {
    beats = [gTimes[0]];
  }
  // période locale aux extrémités
  const pStart = beats.length > 1 ? Math.min(P * 1.1, Math.max(P * 0.9, beats[1] - beats[0])) : P;
  const pEnd = beats.length > 1 ? Math.min(P * 1.1, Math.max(P * 0.9, beats[beats.length - 1] - beats[beats.length - 2])) : P;
  const first = cleaned[0].startSec;
  while (beats[0] > first + 0.25 * pStart) beats.unshift(beats[0] - pStart);
  while (beats.length > 1 && beats[1] <= first + 0.25 * pStart) beats.shift();
  while (beats[beats.length - 1] < lastEnd + pEnd) beats.push(beats[beats.length - 1] + pEnd);
  const ivals = [];
  for (let i = 1; i < beats.length; i++) ivals.push(beats[i] - beats[i - 1]);
  const tempo = Math.round(60 / median(ivals));

  // accents par temps → mesure
  const nb = beats.length;
  const accVel = new Float64Array(nb), lowMidi = new Float64Array(nb).fill(Infinity), durB = new Float64Array(nb);
  const nearestBeat = (t) => {
    let lo = 0, hi = nb - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (beats[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && Math.abs(beats[lo - 1] - t) < Math.abs(beats[lo] - t)) lo--;
    return lo;
  };
  for (const nt of cleaned) {
    const j = nearestBeat(nt.startSec);
    const pj = j + 1 < nb ? beats[j + 1] - beats[j] : P;
    if (Math.abs(nt.startSec - beats[j]) > 0.2 * pj) continue;
    accVel[j] = Math.max(accVel[j], nt.velocity / 127);
    lowMidi[j] = Math.min(lowMidi[j], nt.midi);
    durB[j] = Math.max(durB[j], (nt.endSec - nt.startSec) / pj);
  }
  const acc = [];
  for (let j = 0; j < nb; j++) {
    const prevLow = j > 0 ? lowMidi[j - 1] : Infinity, nextLow = j + 1 < nb ? lowMidi[j + 1] : Infinity;
    const bass = Number.isFinite(lowMidi[j]) && lowMidi[j] < prevLow && lowMidi[j] < nextLow && !isMono ? 1 : 0;
    acc.push(accVel[j] + 0.8 * bass + (0.5 * Math.min(durB[j], 3)) / 3);
  }
  // on ignore les temps après la dernière attaque
  let lastBeatWithNote = 0;
  for (let j = 0; j < nb; j++) if (accVel[j] > 0) lastBeatWithNote = j;
  // (la dernière attaque est exclue : sa durée, jusqu'à la fin du fichier, n'est pas significative)
  const meter = estimateMeter(acc.slice(0, lastBeatWithNote));
  const timeSig = [meter.num, 4];
  const beatOffset = (meter.num - (meter.phase % meter.num)) % meter.num;

  const key = estimateKey(cleaned.map((nt) => ({ midi: nt.midi, durSec: nt.endSec - nt.startSec, velocity: nt.velocity, startSec: nt.startSec })));

  // confiance : alignement sur la grille + netteté de la hauteur
  let onGrid = 0;
  const bt = makeSecToBeat(beats, 0);
  for (const nt of cleaned) {
    const b = bt(nt.startSec) * 4;
    if (Math.abs(b - Math.round(b)) < 0.3) onGrid++;
  }
  let voiced = 0, clar = 0;
  for (let i = 0; i < nY; i++) if (yinClar[i] > 0) { voiced++; clar += yinClar[i]; }
  const pitchConf = voiced ? clar / voiced : 0.6;
  const confidence = Math.round(100 * clamp(0.5 * (onGrid / cleaned.length) + 0.5 * pitchConf, 0, 1)) / 100;

  out.result = {
    notes: cleaned.map((nt) => ({
      midi: nt.midi,
      startSec: round3(nt.startSec),
      durSec: round3(nt.endSec - nt.startSec),
      velocity: nt.velocity,
      hand: nt.hand,
    })),
    tempo,
    beatTimes: beats.map(round3),
    beatOffset,
    keyFifths: key.keyFifths,
    keyName: key.name,
    timeSig,
    confidence,
    tuningCents: Math.round(tuningCents),
    duration,
    grid: o.grid,
    meterScores: meter.scores,
  };
}

function round3(x) {
  return Math.round(x * 1000) / 1000;
}

/** Fonction secondes → temps (interpolation linéaire entre pulsations, extrapolation aux bords). */
function makeSecToBeat(beatTimes, offset = 0) {
  const b = beatTimes;
  if (!b || !b.length) return (t) => t * 1.5 + offset;
  if (b.length === 1) return (t) => (t - b[0]) * 1.5 + offset;
  return (t) => {
    if (t <= b[0]) return (t - b[0]) / (b[1] - b[0]) + offset;
    const L = b.length;
    if (t >= b[L - 1]) return L - 1 + (t - b[L - 1]) / (b[L - 1] - b[L - 2]) + offset;
    let lo = 0, hi = L - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (b[mid] <= t) lo = mid;
      else hi = mid;
    }
    return lo + (t - b[lo]) / (b[lo + 1] - b[lo]) + offset;
  };
}

/**
 * Transcrit un signal mono.
 * @param {Float32Array|number[]} samples échantillons mono (le mixage stéréo → mono est fait par l'appelant)
 * @param {number} sampleRate
 * @param {object} [opts] voir DEFAULTS (polyphonic, grid, onProgress…)
 * @returns {{notes:Array<{midi:number,startSec:number,durSec:number,velocity:number,hand:'R'|'L'}>, tempo:number,
 *   beatTimes:number[], beatOffset:number, keyFifths:number, keyName:string, timeSig:[number,number], confidence:number}}
 */
export function transcribe(samples, sampleRate, opts = {}) {
  const out = {};
  const it = run(samples, sampleRate, opts, out);
  for (let r = it.next(); !r.done; r = it.next()) if (opts.onProgress) opts.onProgress(r.value);
  if (opts.onProgress) opts.onProgress(1);
  return out.result;
}

/** Variante asynchrone : rend la main au navigateur régulièrement (l'interface ne gèle pas). */
export async function transcribeAsync(samples, sampleRate, opts = {}) {
  const out = {};
  const it = run(samples, sampleRate, opts, out);
  for (let r = it.next(); !r.done; r = it.next()) {
    if (opts.onProgress) opts.onProgress(r.value);
    await new Promise((res) => setTimeout(res, 0));
  }
  if (opts.onProgress) opts.onProgress(1);
  return out.result;
}

/**
 * Convertit le résultat en morceau « brut » (positions en temps), prêt pour prepareSong.
 * Les doigtés sont laissés vides : le doigté automatique les complète.
 * @param {ReturnType<typeof transcribe>} result
 * @param {{title?:string, composer?:string, grid?:number}} [opts]
 */
export function toRawSong(result, { title = 'Transcription', composer = 'Transcription automatique', grid } = {}) {
  const g = grid || result.grid || 0.25;
  const toBeat = makeSecToBeat(result.beatTimes, result.beatOffset || 0);
  const q = (b) => Math.round(b / g) * g;
  let notes = result.notes.map((nt) => {
    const s = Math.max(0, q(toBeat(nt.startSec)));
    const e = q(toBeat(nt.startSec + nt.durSec));
    return { midi: nt.midi, start: s, dur: Math.max(g, e - s), hand: nt.hand === 'L' ? 'L' : 'R', finger: null, velocity: nt.velocity };
  });
  // doublons (même note, même instant après quantification)
  const seen = new Map();
  for (const nt of notes) {
    const k = `${nt.midi}@${nt.start}`;
    const prev = seen.get(k);
    if (!prev || nt.dur > prev.dur) seen.set(k, nt);
  }
  notes = [...seen.values()].sort((a, b) => a.start - b.start || a.midi - b.midi);
  // par main : pas de chevauchement avec l'attaque suivante, petits trous comblés
  for (const hand of ['R', 'L']) {
    const hs = notes.filter((nt) => nt.hand === hand);
    const starts = [...new Set(hs.map((nt) => nt.start))].sort((a, b) => a - b);
    for (const nt of hs) {
      const next = starts.find((s) => s > nt.start + 1e-9);
      if (next == null) continue;
      const end = nt.start + nt.dur;
      if (end > next + 1e-9 || next - end <= g + 1e-9) nt.dur = next - nt.start;
    }
  }
  const fix = (x) => Math.round(x * 1e6) / 1e6;
  return {
    title,
    composer,
    tempo: clamp(Math.round(result.tempo || 90), 30, 240),
    timeSig: result.timeSig || [4, 4],
    keyFifths: result.keyFifths || 0,
    notes: notes.map((nt) => ({ ...nt, start: fix(nt.start), dur: fix(nt.dur) })),
    transcribed: true,
  };
}
