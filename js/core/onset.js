// Détection d'attaques de notes à partir des trames du micro.
// Une note répétée (même hauteur) doit être re-déclenchée par une attaque : sinon une note qui résonne
// validerait faussement la note suivante identique.

export class OnsetDetector {
  constructor({ minRms = 0.012, attackRatio = 1.6, stableFrames = 2, minClarity = 0.75, silenceRms = 0.007, refractoryMs = 90, noisy = false } = {}) {
    Object.assign(this, { minRms, attackRatio, stableFrames, minClarity, silenceRms, refractoryMs });
    this.noisy = noisy;
    this.reset();
  }

  reset() {
    this.history = []; // {t, rms}
    this.lastEmitted = null;
    this.lastEmitTime = -Infinity;
    this.attackPending = false;
    this.lastAttackTime = -Infinity;
    this.candidate = null;
    this.candidateCount = 0;
    this.silentFrames = 0;
    this.attackT = null;
  }

  /** Mode bruité : une confirmation de plus et une clarté plus exigeante. */
  set noisy(v) {
    this._noisy = !!v;
  }
  get noisy() {
    return this._noisy;
  }

  /**
   * @param {{t:number, rms:number, midi:number|null, clarity?:number, minRms?:number, minClarity?:number, attackT?:number}} frame
   *   t en ms ; minRms/minClarity : seuils propres au registre (profil « Mon piano ») ;
   *   attackT : instant précis de l'attaque dans la trame (sinon t)
   * @returns {{attack:boolean, onset:number|null, onsetT:number|null}} onsetT = instant de l'attaque correspondante
   */
  push(frame) {
    const { t, rms, midi } = frame;
    const clarity = frame.clarity ?? 1;
    const minRmsNote = frame.minRms ?? this.minRms;
    const minClarity = (frame.minClarity ?? this.minClarity) + (this._noisy ? 0.05 : 0);
    const stableFrames = this.stableFrames + (this._noisy ? 1 : 0);
    // Creux d'énergie récent (fenêtre ~200 ms)
    this.history.push({ t, rms });
    while (this.history.length && t - this.history[0].t > 200) this.history.shift();
    const trough = Math.min(...this.history.map((h) => h.rms));

    let attack = false;
    if (rms > this.minRms && rms > trough * this.attackRatio + 0.004 && t - this.lastAttackTime > this.refractoryMs) {
      attack = true;
      this.lastAttackTime = t;
      this.attackT = frame.attackT ?? t;
      this.attackPending = true;
      // réarme le creux pour éviter un double déclenchement sur la même montée
      this.history = [{ t, rms }];
    }

    if (rms < this.silenceRms) {
      this.silentFrames++;
      if (this.silentFrames >= 2) {
        this.lastEmitted = null;
        this.candidate = null;
        this.candidateCount = 0;
      }
      return { attack, onset: null, onsetT: null };
    }
    this.silentFrames = 0;

    if (midi == null || clarity < minClarity || rms < minRmsNote) {
      this.candidate = null;
      this.candidateCount = 0;
      return { attack, onset: null, onsetT: null };
    }

    if (midi === this.candidate) this.candidateCount++;
    else {
      this.candidate = midi;
      this.candidateCount = 1;
    }

    let onset = null, onsetT = null;
    if (this.candidateCount >= stableFrames) {
      const isNewPitch = midi !== this.lastEmitted;
      if ((isNewPitch || this.attackPending) && t - this.lastEmitTime > 60) {
        onset = midi;
        // horodatage : instant de l'attaque si elle est récente (la confirmation de hauteur arrive 1-2 trames après)
        onsetT = this.attackT != null && t - this.attackT < 160 && this.attackT >= this.lastEmitTime ? this.attackT : t;
        this.lastEmitted = midi;
        this.lastEmitTime = t;
        this.attackPending = false;
      }
    }
    return { attack, onset, onsetT };
  }
}

/** Lisse la hauteur (médiane glissante) pour un affichage d'accordeur stable. */
export class PitchSmoother {
  constructor(size = 5) {
    this.size = size;
    this.values = [];
  }
  push(v) {
    if (v == null) {
      this.values = [];
      return null;
    }
    this.values.push(v);
    if (this.values.length > this.size) this.values.shift();
    const s = [...this.values].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }
}

// ---------- horloges ----------
/**
 * Temps AudioContext → performance.now() (ms) de l'instant où l'échantillon `when` sort du haut-parleur.
 * @param {number} when temps audio (s)
 * @param {{contextTime?:number, performanceTime?:number}|null} ts AudioContext.getOutputTimestamp()
 * @param {{currentTime:number, now:number, outputLatency?:number}} fb repli si ts est indisponible
 */
export function audioToPerf(when, ts, { currentTime, now, outputLatency = 0 }) {
  if (ts && ts.performanceTime > 0 && Number.isFinite(ts.contextTime)) return ts.performanceTime + (when - ts.contextTime) * 1000;
  return now + (when - currentTime + outputLatency) * 1000;
}

/**
 * Instant estimé (performance.now(), ms) où un échantillon du micro a été CAPTÉ.
 * audioTime = temps audio de l'échantillon dans le graphe ; il est rendu ≈ (outputLatency + baseLatency) avant d'être
 * entendu, et il a été capté ≈ inputLatency plus tôt. Jamais dans le futur.
 */
export function micCaptureTime(audioTime, ts, { currentTime, now, outputLatency = 0, baseLatency = 0, inputLatency = 0 }) {
  let t;
  if (ts && ts.performanceTime > 0 && Number.isFinite(ts.contextTime)) t = ts.performanceTime + (audioTime - ts.contextTime - outputLatency - baseLatency) * 1000;
  else t = now - (currentTime - audioTime) * 1000;
  t -= inputLatency * 1000;
  return Math.min(t, now);
}

// ---------- calibration ----------
export function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Latence d'une source à partir de frappes « sur le temps ».
 * Chaque frappe est associée au clic le plus proche (± window ms) ; résultat = médiane des écarts (ms, positif = en retard).
 * @returns {{latency:number|null, n:number, spread:number|null, offsets:number[]}}
 */
export function latencyFromTaps(clickTimes, tapTimes, { window = 250, minTaps = 6 } = {}) {
  const offsets = [];
  const used = new Set();
  for (const tap of tapTimes) {
    let best = -1, bd = Infinity;
    clickTimes.forEach((c, i) => {
      const d = Math.abs(tap - c);
      if (d < bd && !used.has(i)) { bd = d; best = i; }
    });
    if (best >= 0 && bd <= window) {
      used.add(best);
      offsets.push(tap - clickTimes[best]);
    }
  }
  if (offsets.length < minTaps) return { latency: null, n: offsets.length, spread: null, offsets };
  const med = median(offsets);
  const spread = median(offsets.map((o) => Math.abs(o - med)));
  return { latency: Math.round(med), n: offsets.length, spread: Math.round(spread), offsets };
}

// ---------- profil « Mon piano » ----------
export const MIC_BANDS = [
  { id: 'low', label: 'graves', lo: 0, hi: 47 },
  { id: 'mid', label: 'médiums', lo: 48, hi: 71 },
  { id: 'high', label: 'aigus', lo: 72, hi: 127 },
];
export const bandOf = (midi) => (midi < 48 ? 'low' : midi < 72 ? 'mid' : 'high');

function percentile(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))];
}

/**
 * Construit le profil micro à partir des mesures.
 * @param {number[]} noiseRms niveaux pendant le silence
 * @param {{low?:{rms:number[],clarity:number[]}, mid?:…, high?:…}} bands trames mesurées pendant les notes de chaque registre
 */
export function buildMicProfile(noiseRms, bands = {}) {
  const noise = percentile(noiseRms, 0.9) ?? 0.003;
  const profile = { noise: +noise.toFixed(5), silenceRms: +Math.max(0.002, noise * 1.6).toFixed(5), bands: {}, createdAt: Date.now() };
  for (const { id } of MIC_BANDS) {
    const b = bands[id];
    if (!b || !b.rms?.length) continue;
    const peak = percentile(b.rms, 0.95);
    const minRms = Math.min(0.08, Math.max(0.002, noise * 3, peak * 0.08));
    const clar = percentile(b.clarity || [], 0.25) ?? 0.8;
    profile.bands[id] = { minRms: +minRms.toFixed(5), minClarity: +Math.min(0.9, Math.max(0.55, clar - 0.05)).toFixed(3), peak: +peak.toFixed(4) };
  }
  return profile;
}

/** Seuils à appliquer pour une note (profil + repli). */
export function profileThresholds(profile, midi, fallback = { minRms: 0.012, minClarity: 0.75 }) {
  const b = profile?.bands?.[bandOf(midi)];
  if (b) return { minRms: b.minRms, minClarity: b.minClarity };
  const all = Object.values(profile?.bands || {});
  if (all.length) return { minRms: Math.min(...all.map((x) => x.minRms)), minClarity: fallback.minClarity };
  return fallback;
}
