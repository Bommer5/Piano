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
function multiPitch(peaks, val, a4, o, maxNotes, fmax, collide = new Set()) {
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
  const cands = new Set();
  for (let j = 0; j < peaks.length; j++) {
    if (val[j] <= 0) continue;
    const mf = freqToMidiFloat(freqs[j], a4);
    const m = Math.round(mf);
    if (Math.abs(mf - m) > 0.4 || m < o.lo || m > o.hi) continue;
    cands.add(m);
  }
  // Une note dont la fondamentale tombe sur un partiel d'une note déjà présente (octave, douzième…) peut ne
  // montrer AUCUNE énergie nouvelle à sa fondamentale (les deux ondes s'additionnent ou s'annulent selon leur
  // phase) : on l'accepte quand même si ses partiels 2 et 3 sont nouveaux.
  const addCollide = (m) => {
    for (const d of [12, 19, 24]) if (m + d <= o.hi) { collide.add(m + d); cands.add(m + d); }
  };
  for (const m of [...collide]) cands.add(m);
  const res = [];
  const H = 8;
  let firstSal = 0;
  for (let it = 0; it < maxNotes && cands.size; it++) {
    let best = null;
    const all = new Map();
    for (const m of cands) {
      const f0 = midiToFreq(m, a4);
      const A = new Float64Array(H + 2), I = new Int32Array(H + 2).fill(-1);
      let sal = 0;
      for (let h = 1; h <= H; h++) {
        const fh = f0 * h * Math.sqrt(1 + 0.0002 * h * h); // légère inharmonicité du piano
        if (fh > fmax) break;
        const k = nearest(fh, Math.max(o.binHz * 1.2, fh * 0.022));
        if (k >= 0) { A[h] = val[k]; I[h] = k; sal += A[h] / Math.sqrt(h); }
      }
      let hidden = false;
      if (A[1] <= 0) {
        if (!(collide.has(m) && A[2] > 0 && A[3] > 0)) continue;
        hidden = true;
      }
      if (!best || sal > best.sal) best = { m, sal, A, I, hidden, a3: A[3], a2: A[2] };
      all.set(m, { m, sal, A, I, hidden });
    }
    if (!best) break;
    // octave : la note du dessous l'emporte si ses partiels impairs (absents de l'octave) sont bien là
    const sub = all.get(best.m - 12);
    if (sub && sub.sal >= 0.75 * best.sal && sub.A[3] > 0.2 * sub.A[2] && sub.A[2] > 0) best = sub;
    if (!firstSal) firstSal = best.sal;
    if (best.sal < firstSal * o.relThreshold) break;
    cands.delete(best.m);
    addCollide(best.m);
    const { A, I } = best;
    for (let h = 1; h <= H; h++) {
      if (I[h] < 0) continue;
      const e = h === 1 ? A[1] : Math.min(A[h], Math.max(A[h - 1], A[h + 1]));
      val[I[h]] = Math.max(0, val[I[h]] - e);
    }
    res.push({ midi: best.m, sal: best.sal, amp1: A[1], hidden: best.hidden });
  }
  return res;
}

// ---------------------------------------------------------------------------
// Tempo, pulsation, mesure, tonalité
// ---------------------------------------------------------------------------

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

/**
 * Analyse rythmique. À partir des attaques (groupes de notes simultanées) et d'un premier suivi de pulsation,
 * retrouve : la plus petite valeur de note régulière (« tatum »), le temps, la mesure, le premier temps,
 * et la grille de quantification adaptée au morceau.
 *
 * 1. Les attaques sont placées dans le temps « redressé » par la pulsation suivie (le rubato disparaît).
 * 2. Le tatum est la plus grande subdivision de cette pulsation sur laquelle tombent presque toutes les attaques.
 * 3. Chaque hypothèse (tatums par temps, temps par mesure, position du premier temps) est comparée aux
 *    accents réels (notes longues, fortes, basses, accords) : la meilleure corrélation l'emporte, avec une
 *    légère préférence pour un tempo « naturel » (60-130) — ce qui corrige les erreurs double/moitié et 4:3.
 * @returns {{beatTimes:number[], tempo:number, timeSig:[number,number], grid:number, tatum:number, fit:number,
 *   margin:number, scores:object, alternatives:Array}} beatTimes = instants des NOIRES, la première tombe sur
 *   une barre de mesure (au plus tard à la première note : une levée est donc précédée d'un silence).
 */
const RW = 1, TW = 0.14, TC = 84;
/** En dessous de cette confiance, une note est signalée « incertaine ». */
export const UNCERTAIN = 0.63;
function analyzeRhythm(gs, isMono, lastEnd) {
  const N = gs.length;
  // 1. tatum : période τ pour laquelle les écarts entre attaques proches (< 4 s) sont des multiples de τ.
  //    Les paires proches seulement : un tempo qui respire (rubato) ne brouille pas la mesure.
  const pairs = [];
  for (let a = 0; a < N; a++) {
    for (let b = a + 1; b < N && gs[b].t - gs[a].t < 4; b++) {
      const dt = gs[b].t - gs[a].t;
      pairs.push(dt, gs[a].w * gs[b].w * Math.exp(-dt / 2.5));
    }
  }
  let tatumSec = 0.5;
  if (pairs.length >= 6) {
    let wsum = 0;
    for (let i = 1; i < pairs.length; i += 2) wsum += pairs[i];
    const taus = [], sc = [];
    for (let tau = 0.085; tau <= 4; tau *= 1.004) {
      let v = 0;
      const k = (2 * Math.PI) / tau;
      for (let i = 0; i < pairs.length; i += 2) v += pairs[i + 1] * Math.cos(k * pairs[i]);
      taus.push(tau); sc.push(v / wsum);
    }
    let smax = -1;
    for (const v of sc) if (v > smax) smax = v;
    // le plus grand τ presque aussi bon que le meilleur (τ/2, τ/3… sont toujours aussi bons que τ)
    let bi = 0;
    for (let i = 1; i < sc.length - 1; i++) if (sc[i] >= 0.85 * smax && sc[i] >= sc[i - 1] && sc[i] >= sc[i + 1]) bi = i;
    tatumSec = taus[bi];
    if (bi > 0 && bi < sc.length - 1) {
      const d = sc[bi - 1] - 2 * sc[bi] + sc[bi + 1];
      if (d < 0) tatumSec = taus[bi] * Math.pow(1.004, clamp((0.5 * (sc[bi - 1] - sc[bi + 1])) / d, -0.5, 0.5));
    }
    while (tatumSec > 1.0) tatumSec /= 2;
  } else if (N >= 2) {
    tatumSec = gs[1].t - gs[0].t;
    while (tatumSec > 1.0) tatumSec /= 2;
    while (tatumSec < 0.12) tatumSec *= 2;
  }
  // 2. suivi du tatum d'attaque en attaque (boucle à verrouillage de phase : suit les variations de tempo)
  const j = new Array(N), res = new Array(N);
  const anchors = [];
  {
    let tau = tatumSec, tRef = gs[0].t, xRef = 0;
    anchors.push({ t: tRef, x: 0 });
    for (let i = 0; i < N; i++) {
      const xx = xRef + (gs[i].t - tRef) / tau;
      const jx = Math.round(xx), err = xx - jx;
      j[i] = jx; res[i] = err;
      if (Math.abs(err) < 0.3 && jx > xRef) {
        const steps = jx - xRef;
        tau = clamp(tau * (1 + (0.3 * err) / steps), tatumSec * 0.8, tatumSec * 1.25);
        tRef = gs[i].t - 0.4 * err * tau;
        xRef = jx;
        anchors.push({ t: tRef, x: xRef });
      }
    }
    if (anchors.length < 2) anchors.push({ t: anchors[0].t + tatumSec, x: 1 });
  }
  const J = Math.max(...j) + 1;
  const tatumToSec = (q) => {
    const A = anchors, L = A.length;
    let i = 0;
    if (q <= A[0].x) i = 0;
    else if (q >= A[L - 1].x) i = L - 2;
    else { let lo = 0, hi = L - 1; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (A[mid].x <= q) lo = mid; else hi = mid; } i = lo; }
    // aux extrémités : on prolonge au tempo moyen (pas à celui du dernier intervalle, trop bruité)
    if (q < A[0].x) return A[0].t + (q - A[0].x) * tatumSec;
    if (q > A[L - 1].x) return A[L - 1].t + (q - A[L - 1].x) * tatumSec;
    return A[i].t + ((q - A[i].x) * (A[i + 1].t - A[i].t)) / (A[i + 1].x - A[i].x);
  };
  {
    // tatum médian réellement suivi
    const iv = [];
    for (let i = 1; i < anchors.length; i++) iv.push((anchors[i].t - anchors[i - 1].t) / (anchors[i].x - anchors[i - 1].x));
    if (iv.length >= 3) tatumSec = median(iv);
  }

  // 3. accents par position de tatum
  const mw = gs.reduce((s, g) => s + g.w, 0) / N;
  const sw = Math.sqrt(gs.reduce((s, g) => s + (g.w - mw) * (g.w - mw), 0) / N);
  const A = new Float64Array(J);
  for (let i = 0; i < N; i++) {
    const g = gs[i];
    const ioi = i + 1 < N ? Math.max(1, j[i + 1] - j[i]) : Math.max(1, Math.round(g.len / tatumSec));
    const durSecs = ioi * tatumSec;
    let a = 1 + 0.5 * clamp((g.w - mw) / (sw + 0.03), -2, 2);
    a += 0.7 * clamp(Math.log2(ioi), 0, 3) * (durSecs > 0.25 ? 1 : 0.5);
    if (!isMono) {
      const pl = i > 0 ? gs[i - 1].low : Infinity, nl = i + 1 < N ? gs[i + 1].low : Infinity;
      if (g.low < pl - 2 && g.low < nl - 2) a += 0.8;
      a += 0.25 * Math.min(g.n - 1, 3);
    }
    if (a > A[j[i]]) A[j[i]] = a;
  }
  // part des écarts entre attaques successives qui valent exactement k tatums : la valeur de note la plus
  // fréquente est très souvent le temps
  const ioiShare = (k) => {
    let c = 0;
    for (let i = 1; i < N; i++) if (j[i] - j[i - 1] === k) c++;
    return N > 1 ? c / (N - 1) : 0;
  };
  const hyps = [];
  if (N >= 12 && J >= 16) {
    for (const k of [1, 2, 3, 4, 6, 8]) {
      const compound = k === 3 || k === 6;
      const qt = compound ? (2 * k) / 3 : k; // tatums par noire
      const bpm = 60 / (qt * tatumSec);
      if (bpm < 38 || bpm > 215) continue;
      for (const m of [2, 3, 4]) {
        const L = k * m;
        if (L * 2.5 > J) continue;
        // gabarit métrique
        const W = new Float64Array(L);
        for (let pos = 0; pos < L; pos++) {
          let w = 0;
          if (pos === 0) w = 4;
          else if (pos % k === 0) w = m === 4 && pos === 2 * k ? 2.6 : 2;
          else if (k % 2 === 0 && pos % (k / 2) === 0) w = 1;
          else if (k % 4 === 0 && pos % (k / 4) === 0) w = 0.4;
          W[pos] = w;
        }
        let best = { c: -Infinity, phi: 0 };
        const tmp = new Float64Array(J);
        for (let phi = 0; phi < L; phi++) {
          for (let q = 0; q < J; q++) tmp[q] = W[(((q - phi) % L) + L) % L];
          let c = corr(A, tmp);
          if (j[0] % L === phi) c += 0.05; // à qualité égale : pas de levée
          if (c > best.c) best = { c, phi };
        }
        const barSec = L * tatumSec;
        // le motif d'accents se répète-t-il de mesure en mesure ? (part de variance expliquée, ajustée)
        let r2 = 0;
        {
          const sum = new Float64Array(L), cnt = new Float64Array(L);
          let mean = 0;
          for (let q = 0; q < J; q++) { sum[q % L] += A[q]; cnt[q % L]++; mean += A[q]; }
          mean /= J;
          let ssb = 0, sst = 0;
          for (let q = 0; q < L; q++) if (cnt[q]) ssb += cnt[q] * Math.pow(sum[q] / cnt[q] - mean, 2);
          for (let q = 0; q < J; q++) sst += (A[q] - mean) * (A[q] - mean);
          r2 = sst > 0 && J > L + 1 ? 1 - ((1 - ssb / sst) * (J - 1)) / (J - L) : 0;
        }
        // préférences légères : tempo « naturel », mesure de 2 à 3 s, 4/4 plus courant que 2/4 et que 6/8
        const prior = -TW * Math.pow(Math.log2(bpm / TC), 2) - 0.06 * Math.pow(Math.log2(barSec / 2.5), 2) + (compound ? -0.06 : m === 4 ? 0.04 : m === 2 ? -0.1 : 0);
        hyps.push({ k, m, phi: best.phi, corr: best.c, r2, score: best.c + RW * r2 + prior + (isMono ? 0.1 : 0.04) * ioiShare(k), bpm, qt, compound, L });
      }
    }
  }
  hyps.sort((a, b) => b.score - a.score);
  let h = hyps[0];
  if (!h) {
    // trop peu d'attaques pour juger de la mesure : 4/4 sans levée ; le temps = la valeur de note la plus fréquente
    let qt = 1, bs = -Infinity;
    for (const k of [1, 2, 4, 8]) {
      const bpm = 60 / (k * tatumSec);
      if (bpm < 38 || bpm > 215) continue;
      const v = ioiShare(k) - 0.3 * Math.pow(Math.log2(bpm / 92), 2);
      if (v > bs) { bs = v; qt = k; }
    }
    h = { k: qt, m: 4, phi: j[0] % (qt * 4), corr: 0, score: 0, bpm: 60 / (qt * tatumSec), qt, compound: false, L: qt * 4 };
  }
  const other = hyps.find((y) => y.L !== h.L || y.qt !== h.qt);
  const margin = other ? h.score - other.score : 0.3;
  const timeSig = h.compound ? [3 * h.m, 8] : [h.m, 4];
  // barre de mesure au plus tard à la première note
  let b0 = h.phi;
  while (b0 > j[0]) b0 -= h.L;
  while (b0 + h.L <= j[0]) b0 += h.L;
  const beatTimes = [];
  const endQ = (lastEnd - tatumToSec(b0)) / (h.qt * tatumSec) + 2;
  for (let q = 0; q <= Math.max(2, Math.ceil(endQ)); q++) beatTimes.push(tatumToSec(b0 + q * h.qt));
  const iv = [];
  for (let i = 1; i < beatTimes.length; i++) iv.push(beatTimes[i] - beatTimes[i - 1]);
  const tempo = Math.round(60 / median(iv));
  // grille : le tatum, ou sa moitié si des attaques tombent nettement entre deux tatums
  const between = res.filter((r) => Math.abs(r) > 0.3).length;
  let grid = 1 / h.qt;
  if (between >= Math.max(2, 0.03 * N)) grid /= 2;
  grid = clamp(grid, 0.125, 0.5);
  const fit = 1 - Math.min(1, (2 * res.reduce((s, r) => s + Math.min(Math.abs(r), 0.5 - Math.abs(r)), 0)) / N / 0.25);
  return {
    beatTimes, tempo, timeSig, grid, tatum: tatumSec, fit, margin,
    scores: Object.fromEntries(hyps.slice(0, 6).map((y) => [`${y.compound ? 3 * y.m + '/8' : y.m + '/4'}@${Math.round(y.bpm)}`, Math.round(y.score * 1000) / 1000 ])),
    alternatives: hyps.slice(0, 4).map((y) => ({ tempo: Math.round(y.bpm), timeSig: y.compound ? [3 * y.m, 8] : [y.m, 4], score: y.score })),
  };
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
  const legato = changes.filter((c) => !onsets.some((on) => Math.abs(on.t - c.t) < 0.1) && c.t > 0);
  // piano (presque toutes les notes ont une attaque) : les rares « changements de hauteur » sans attaque sont
  // des mélanges de résonances, pas des notes ; ils ne servent que pour les sons liés (voix, flûte, violon)
  if (legato.length > 0.25 * onsets.length) bounds.push(...legato);
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
    // plancher de bruit
    const band = Array.from(post.subarray(loBin, hiBin));
    const floor = Math.max(median(band) * 4, 0.0015);

    // décroissance des notes actives juste avant la frontière
    decayCheck(pre, (sPre + Lpre / 2) / sr);

    const peaks = findPeaks(post, loBin, hiBin, floor);
    for (const p of peaks) {
      p.f = p.bin * binHz;
      p.pre = Math.max(pre[p.idx - 1] || 0, pre[p.idx], pre[p.idx + 1] || 0);
      p.newAmp = Math.max(p.amp - p.pre, 0);
    }
    const val = Float64Array.from(peaks, (p) => p.newAmp);
    const collide = new Set();
    for (const a of active) for (const d of [12, 19, 24]) if (a.midi + d <= o.hi) collide.add(a.midi + d);
    let found = multiPitch(peaks, val, a4, o, o.maxPolyphony, fmax, collide);
    found = found.filter((c) => {
      const f0 = midiToFreq(c.midi, a4);
      const postA = ampAt(post, f0, binHz), preA = ampAt(pre, f0, binHz);
      c.amp0 = postA;
      c.amp0h2 = ampAt(post, 2 * f0, binHz);
      c.newFrac = postA > 0 ? (postA - preA) / postA : 0;
      // énergie réellement nouvelle (au moins +30 %) et au-dessus du bruit
      return postA > floor * 1.5 && (c.hidden || c.newFrac > 0.28);
    });
    // Notes REFRAPPÉES pendant qu'elles résonnent : la fondamentale ne grossit presque pas, mais le marteau
    // relance tous les partiels aigus (qui s'éteignent vite). On compare deux fenêtres courtes juste avant /
    // juste après la frappe, sur les partiels assez hauts pour ne pas être confondus avec une note voisine.
    if (bounds[bi].kind === 'onset' && active.length) {
      const bandS = Array.from(postS.subarray(Math.round(400 / binHzS), Math.round(fmax / binHzS)));
      const floorS = Math.max(median(bandS) * 3, 0.0008);
      const HARM = [12, 19, 24, 28, 31, 34, 36];
      const hits = [];
      for (const a of active) {
        if (tb - a.startSec < 0.07 || found.some((c) => c.midi === a.midi)) continue;
        // une note plus grave dont celle-ci est un harmonique explique à elle seule le regain des partiels
        if (found.some((c) => HARM.includes(a.midi - c.midi))) continue;
        const others = [];
        for (const c of found) {
          if (HARM.includes(c.midi - a.midi)) continue; // « fantôme » possible de la refrappe elle-même
          const fc = midiToFreq(c.midi, a4);
          for (let h = 1; h <= 12; h++) others.push(fc * h);
        }
        // partiels partagés avec une autre note tenue : leur niveau ne dit rien de cette note-ci
        for (const b of active) {
          if (b === a) continue;
          const fb = midiToFreq(b.midi, a4);
          for (let h = 1; h <= 12; h++) others.push(fb * h);
        }
        const f0 = midiToFreq(a.midi, a4);
        let N = 0, K = 0, No = 0, Ko = 0, sPostA = 0, sNew = 0;
        for (let h = 1; h <= 12; h++) {
          const fh = f0 * h * Math.sqrt(1 + 0.0003 * h * h);
          if (fh > fmax) break;
          let up;
          if (fh < 500) {
            // partiels graves : fenêtres longues (les courtes ne séparent pas deux notes voisines)
            const tol = Math.max(2.5 * binHz, fh * 0.03);
            if (others.some((f) => Math.abs(f - fh) < tol)) continue;
            const pa = ampAt(post, fh, binHz), pb = ampAt(pre, fh, binHz);
            if (pa < floor * 1.5) continue;
            up = pa > pb * 1.12;
            sPostA += pa; sNew += Math.max(0, pa - pb);
          } else {
            if (others.some((f) => Math.abs(f - fh) < 55)) continue;
            // partiels qui étaient visibles à la frappe d'origine : refrappés, ils retrouvent un niveau comparable
            const p0 = a.prof ? a.prof[h] : 0;
            if (p0 < floorS) continue;
            const pa = ampAt(postS, fh, binHzS, 0.02), pb = ampAt(preS, fh, binHzS, 0.02);
            up = pa > pb * 1.25 && pa > 0.3 * p0;
            sPostA += pa; sNew += Math.max(0, pa - pb);
          }
          N++; if (h % 2) No++;
          if (up) { K++; if (h % 2) Ko++; }
        }
        const frac = sPostA > 0 ? sNew / sPostA : 0;
        if (N >= 2 && K >= (N < 4 ? N : 0.6 * N) && (No < 2 || Ko >= 0.5 * No) && frac > 0.15) hits.push({ a, frac, q: K / N });
      }
      for (const { a, frac, q } of hits) {
        const f0 = midiToFreq(a.midi, a4);
        const postA = ampAt(post, f0, binHz);
        // les harmoniques de la note refrappée ne sont pas des notes à part entière
        found = found.filter((c) => !(HARM.includes(c.midi - a.midi) && c.amp0 < 0.8 * postA));
        found.push({ midi: a.midi, sal: postA, amp1: postA, amp0: postA, amp0h2: ampAt(post, 2 * f0, binHz), newFrac: frac, restrike: q });
      }
    }
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
          found = [{ midi: m, sal: postA, amp1: postA, amp0: postA, amp0h2: ampAt(post, 2 * f0, binHz), newFrac: (postA - preA) / postA, yin: true }];
        }
      }
    }
    if (!o.polyphonic && found.length > 1) {
      const maxSal = Math.max(...found.map((c) => c.sal));
      found = [found.filter((c) => c.sal >= 0.35 * maxSal).sort((a, b) => b.midi - a.midi)[0]];
    }
    if (found.length) {
      const level = rmsBetween(tb * sr, (tb + 0.08) * sr);
      const maxSal = Math.max(...found.map((c) => c.sal));
      for (const c of found) {
        // une note identique encore active est re-frappée
        active = active.filter((a) => {
          if (a.midi === c.midi) { endNote(a, tb); return false; }
          return true;
        });
        const prof = new Float64Array(13);
        const fc = midiToFreq(c.midi, a4);
        for (let h = 1; h <= 12; h++) {
          const fh = fc * h * Math.sqrt(1 + 0.0003 * h * h);
          if (fh > fmax) break;
          prof[h] = ampAt(postS, fh, binHzS, 0.02);
        }
        active.push({ prof, hidden: c.hidden, midi: c.midi, startSec: tb, sal: c.sal, amp0: c.amp0, amp0h2: c.amp0h2, lastAmp: c.amp0, lastT: tb + 0.02 + Lpost / sr / 2, floor: floor * 1.2, level, kind: bounds[bi].kind, newFrac: c.newFrac || 0, restrike: c.restrike, yin: c.yin, rel: c.sal / maxSal });
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
    // Deux mains : chaque main suit sa ligne. On part de deux « centres » (grave / aigu) estimés sur tout le
    // morceau, puis, attaque après attaque, on coupe l'accord là où chaque note reste le plus près de la
    // position courante de sa main (une main ne couvre guère plus d'une octave).
    const all = cleaned.map((nt) => nt.midi).sort((a, b) => a - b);
    let cL = all[Math.floor(all.length * 0.2)], cR = all[Math.floor(all.length * 0.8)];
    for (let it = 0; it < 6; it++) {
      let sl = 0, nl = 0, sr2 = 0, nr = 0;
      for (const m of all) { if (Math.abs(m - cL) < Math.abs(m - cR)) { sl += m; nl++; } else { sr2 += m; nr++; } }
      if (nl) cL = sl / nl;
      if (nr) cR = sr2 / nr;
    }
    // une seule main (mélodie doublée, accords serrés) : tout tient sous une main et les deux centres se touchent
    const maxSpan = Math.max(...groups.map((g) => g.notes[0].midi - g.notes[g.notes.length - 1].midi));
    const oneHand = cR - cL < 10 && maxSpan <= 14;
    if (cR - cL < 7) { const mid = (cR + cL) / 2; cL = mid - 6; cR = mid + 6; }
    const gCL = cL, gCR = cR;
    if (oneHand) {
      const hand = median(all) < 52 ? 'L' : 'R';
      for (const nt of cleaned) nt.hand = hand;
    }
    for (const g of oneHand ? [] : groups) {
      g.notes.sort((a, b) => b.midi - a.midi);
      const n = g.notes.length;
      let best = 0, bc = Infinity;
      for (let sp = 0; sp <= n; sp++) {
        let c = 0;
        for (let i = 0; i < n; i++) c += Math.abs(g.notes[i].midi - (i < sp ? cR : cL));
        if (sp > 1) c += 10 * Math.max(0, g.notes[0].midi - g.notes[sp - 1].midi - 12);
        if (n - sp > 1) c += 10 * Math.max(0, g.notes[sp].midi - g.notes[n - 1].midi - 12);
        if (c < bc) { bc = c; best = sp; }
      }
      g.notes.forEach((nt, i) => (nt.hand = i < best ? 'R' : 'L'));
      const upd = (c, arr, g0) => {
        if (!arr.length) return 0.97 * c + 0.03 * g0; // main au repos : revient doucement vers sa zone
        const mean = arr.reduce((x, nt) => x + nt.midi, 0) / arr.length;
        return 0.65 * c + 0.35 * mean;
      };
      cR = upd(cR, g.notes.slice(0, best), gCR);
      cL = upd(cL, g.notes.slice(best), gCL);
      if (cR - cL < 5) { const mid = (cR + cL) / 2; cL = mid - 2.5; cR = mid + 2.5; }
      // accompagnement limité : la basse + les notes les plus fortes
      for (const hand of ['L', 'R']) {
        const part = g.notes.filter((nt) => nt.hand === hand);
        const max = hand === 'L' ? o.maxAccompaniment : 4;
        if (part.length > max) {
          const edge = hand === 'L' ? part[part.length - 1] : part[0];
          const keep = new Set([edge, ...part.filter((nt) => nt !== edge).sort((a, b) => b.amp0 - a.amp0).slice(0, max - 1)]);
          g.notes = g.notes.filter((nt) => nt.hand !== hand || keep.has(nt));
        }
      }
    }
    cleaned = groups.flatMap((g) => g.notes);
  }
  // confiance de chaque note (0..1) : énergie vraiment nouvelle, force relative dans l'accord, risque d'harmonique
  for (const g of groups) {
    const maxSal = Math.max(...g.notes.map((nt) => nt.sal));
    for (const nt of g.notes) {
      let c;
      if (nt.restrike) c = 0.55 + 0.4 * clamp((nt.newFrac - 0.15) / 0.45, 0, 1) * (nt.restrike >= 0.8 ? 1 : 0.6);
      else if (nt.hidden) c = 0.6;
      else if (nt.yin || nt.kind === 'pitch') c = 0.45;
      else c = 0.55 + 0.45 * clamp((nt.newFrac - 0.28) / 0.35, 0, 1);
      const rel = nt.sal / (maxSal || 1);
      if (rel < 0.3) c *= 0.5 + 1.6 * rel;
      if (g.notes.some((x) => x !== nt && [12, 19, 24, 28].includes(nt.midi - x.midi) && x.amp0 > nt.amp0 * 1.5)) c *= 0.75;
      if (nt.endSec - nt.startSec < 0.09) c *= 0.7;
      nt.conf = clamp(c, 0, 1);
    }
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
  const lastEnd = Math.max(...cleaned.map((nt) => nt.endSec));
  const gList = [];
  for (const nt of cleaned) {
    const g = gList[gList.length - 1];
    if (g && nt.startSec - g.t < 0.035) { g.w = Math.max(g.w, nt.velocity / 127); g.n++; g.low = Math.min(g.low, nt.midi); g.len = Math.max(g.len, nt.endSec - nt.startSec); }
    else gList.push({ t: nt.startSec, w: nt.velocity / 127, n: 1, low: nt.midi, len: nt.endSec - nt.startSec });
  }
  const rhythm = analyzeRhythm(gList, isMono, lastEnd);
  let beats = rhythm.beatTimes;
  const tempo = rhythm.tempo;
  const timeSig = rhythm.timeSig;
  const beatOffset = 0;
  const meter = { scores: rhythm.scores };

  const key = estimateKey(cleaned.map((nt) => ({ midi: nt.midi, durSec: nt.endSec - nt.startSec, velocity: nt.velocity, startSec: nt.startSec })));

  // confiance globale ≈ part des notes probablement justes : confiance moyenne des notes, pénalisée par les
  // notes hors grille et, à deux mains, par les notes masquées que l'analyse ne peut pas voir
  let onGrid = 0, confSum = 0, weak = 0;
  const bt = makeSecToBeat(beats, 0);
  for (const nt of cleaned) {
    const b = bt(nt.startSec) / rhythm.grid;
    if (Math.abs(b - Math.round(b)) < 0.3) onGrid++;
    confSum += nt.conf;
    if (nt.conf < UNCERTAIN) weak++;
  }
  const weakShare = weak / cleaned.length;
  const offGrid = 1 - onGrid / cleaned.length;
  const confidence = Math.round(100 * clamp((isMono ? 0.99 : 0.97) - 0.35 * weakShare - 0.5 * offGrid - 0.1 * (1 - rhythm.fit), 0.05, 0.99)) / 100;
  out.result = {
    notes: cleaned.map((nt) => ({
      midi: nt.midi,
      startSec: round3(nt.startSec),
      durSec: round3(nt.endSec - nt.startSec),
      velocity: nt.velocity,
      hand: nt.hand,
      confidence: Math.round(nt.conf * 100) / 100,
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
    grid: opts.grid || rhythm.grid,
    meterScores: meter.scores,
    polyphonic: !isMono,
    rhythm: { tatum: round3(rhythm.tatum), fit: round3(rhythm.fit), margin: round3(rhythm.margin), alternatives: rhythm.alternatives },
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
 * Analyse rythmique d'une interprétation déjà connue note par note (fichier MIDI joué en direct, sans
 * métronome) : retrouve tempo, mesure, premier temps et grille, comme pour un enregistrement audio.
 * Le résultat se passe à `toRawSong` (les mains fournies sont conservées).
 * @param {Array<{midi:number,startSec:number,durSec:number,velocity?:number,hand?:'R'|'L'}>} played
 */
export function analyzePerformance(played) {
  const notes = played.filter((n) => n.durSec > 0).map((n) => ({ velocity: 80, hand: 'R', ...n })).sort((a, b) => a.startSec - b.startSec || a.midi - b.midi);
  if (!notes.length) return emptyResult();
  const gList = [];
  let poly = 0;
  for (const nt of notes) {
    const g = gList[gList.length - 1];
    if (g && nt.startSec - g.t < 0.04) { g.w = Math.max(g.w, nt.velocity / 127); if (g.n++ === 1) poly++; g.low = Math.min(g.low, nt.midi); g.len = Math.max(g.len, nt.durSec); }
    else gList.push({ t: nt.startSec, w: nt.velocity / 127, n: 1, low: nt.midi, len: nt.durSec });
  }
  const isMono = poly <= gList.length * 0.1;
  const lastEnd = Math.max(...notes.map((n) => n.startSec + n.durSec));
  const rhythm = analyzeRhythm(gList, isMono, lastEnd);
  const key = estimateKey(notes);
  return {
    notes: notes.map((n) => ({ midi: n.midi, startSec: n.startSec, durSec: n.durSec, velocity: n.velocity, hand: n.hand, confidence: 1 })),
    tempo: rhythm.tempo, beatTimes: rhythm.beatTimes, beatOffset: 0, keyFifths: key.keyFifths, keyName: key.name, timeSig: rhythm.timeSig,
    confidence: Math.round(100 * clamp(0.75 + 0.25 * rhythm.fit, 0, 1)) / 100, tuningCents: 0, duration: lastEnd, grid: rhythm.grid, polyphonic: !isMono,
    rhythm: { tatum: round3(rhythm.tatum), fit: round3(rhythm.fit), margin: round3(rhythm.margin), alternatives: rhythm.alternatives },
  };
}

/**
 * Convertit le résultat en morceau « brut » (positions en temps), prêt pour prepareSong.
 * Les doigtés sont laissés vides : le doigté automatique les complète.
 * Peut être rappelée autant de fois qu'on veut sur le même résultat (réglages rapides de l'import) :
 * seule la mise en partition est refaite, pas l'analyse du son.
 * @param {ReturnType<typeof transcribe>} result
 * @param {{title?:string, composer?:string, grid?:number, tempoScale?:number, timeSig?:[number,number],
 *   hands?:'both'|'melody', octave?:number, shift?:number}} [opts]
 *   grid : pas de quantification en temps (0.5 croche, 0.25 double croche, 1/3 triolet ; défaut : celui choisi
 *   par l'analyse) ; tempoScale : 2 = tempo et valeurs de notes doublés (une croche devient une noire),
 *   0.5 = divisés par deux ; timeSig : mesure imposée ; hands : 'melody' ne garde que la
 *   ligne de main droite ; octave : transposition (±1, ±2) ; shift : décalage du premier temps (en temps).
 */
export function toRawSong(result, { title = 'Transcription', composer = 'Transcription automatique', grid, tempoScale = 1, timeSig, hands = 'both', octave = 0, shift = 0 } = {}) {
  const scale = tempoScale > 0 ? tempoScale : 1;
  const g = grid || clamp((result.grid || 0.25) * (scale >= 2 ? 2 : 1), 0.125, 0.5);
  const base = makeSecToBeat(result.beatTimes, result.beatOffset || 0);
  const toBeat = (t) => base(t) * scale + shift;
  const q = (b) => Math.round(b / g + 1e-9) * g;
  let src = result.notes;
  if (hands === 'melody' && src.some((nt) => nt.hand !== 'L')) src = src.filter((nt) => nt.hand !== 'L');
  let notes = src.map((nt) => {
    const b = toBeat(nt.startSec);
    const s = Math.max(0, q(b));
    const e = q(toBeat(nt.startSec + nt.durSec));
    const out = { midi: clamp(nt.midi + 12 * Math.round(octave), 0, 127), start: s, dur: Math.max(g, e - s), hand: nt.hand === 'L' ? 'L' : 'R', finger: null, velocity: nt.velocity };
    // incertaine : hauteur douteuse, ou attaque tombée entre deux positions de la grille
    if ((nt.confidence != null && nt.confidence < UNCERTAIN) || Math.abs(b - q(b)) > 0.34 * g) out.uncertain = true;
    return out;
  });
  // doublons (même note, même instant après quantification)
  const seen = new Map();
  for (const nt of notes) {
    const k = `${nt.midi}@${Math.round(nt.start * 1000)}`;
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
  const uncertain = notes.filter((nt) => nt.uncertain).length;
  return {
    title,
    composer,
    tempo: clamp(Math.round((result.tempo || 90) * scale), 30, 240),
    timeSig: timeSig || result.timeSig || [4, 4],
    keyFifths: result.keyFifths || 0,
    notes: notes.map((nt) => ({ ...nt, start: fix(nt.start), dur: fix(nt.dur) })),
    transcribed: true,
    transcription: {
      confidence: result.confidence ?? 0,
      uncertain,
      grid: fix(g),
      keyName: result.keyName,
      tuningCents: result.tuningCents || 0,
      duration: result.duration || 0,
      polyphonic: !!result.polyphonic,
    },
  };
}
