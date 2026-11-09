// Analyse du micro par trames (pure : utilisable dans l'AudioWorklet, sur le fil principal et dans les tests).
// Reçoit des blocs d'échantillons, tient un tampon circulaire, et tous les `hop` échantillons renvoie :
// { end, rms, freq, clarity, window, peak, peakAge, transient, transientAge }
//   end = nombre total d'échantillons reçus à la fin de la trame ; peakAge / transientAge en secondes avant `end`.
import { detectPitchAdaptive } from './pitch.js';
import { TransientDetector } from './onset.js';
import { goertzel } from './spectrum.js';

/**
 * Garde-fou « fausse fondamentale » : quand deux notes sonnent ensemble (Mi4 + Sol4), YIN trouve parfois leur
 * sous-harmonique commun (Do2). Une vraie note grave de piano a ses harmoniques 2 à 4 bien présents ;
 * un sous-harmonique fantôme n'a d'énergie que loin au-dessus. Renvoie true si la hauteur est crédible.
 */
export function plausibleFundamental(buf, sampleRate, freq) {
  if (!(freq > 0) || freq >= 240) return true; // ne concerne que les candidats graves
  let low = 0, high = 0;
  for (let h = 1; h <= 12; h++) {
    const f = freq * h;
    if (f > sampleRate * 0.45) break;
    const e = goertzel(buf, sampleRate, f);
    if (h <= 4) low = Math.max(low, e);
    else high = Math.max(high, e);
  }
  return low >= high * 0.12;
}

export class FrameAnalyser {
  constructor(sampleRate, { hopMs = 25, minRms = 0.007, minFreq = 27.5, maxFreq = 4300, threshold = 0.15 } = {}) {
    this.sr = sampleRate;
    const scale = Math.max(1, Math.round(sampleRate / 48000));
    this.size = 4096 * scale;
    this.ring = new Float32Array(this.size);
    this.work = new Float32Array(this.size);
    this.pos = 0;
    this.filled = 0;
    this.total = 0;
    this.since = 0;
    this.setHop(hopMs);
    this.opts = { minRms, minFreq, maxFreq, threshold };
    this.transients = new TransientDetector(sampleRate);
    this.hopPeak = 0;
    this.hopPeakAt = 0;
    this.strikeAt = -1;
    this._onStrike = (idx) => {
      if (this.strikeAt < 0) this.strikeAt = idx;
    };
  }

  setHop(hopMs) {
    this.hop = Math.max(128, Math.round((hopMs * this.sr) / 1000 / 128) * 128);
  }

  /**
   * @param {Float32Array} block mono
   * @param {(res:object)=>void} emit appelé pour chaque trame analysée
   */
  push(block, emit) {
    const n = block.length;
    for (let i = 0; i < n; i++) {
      const v = block[i];
      this.ring[this.pos] = v;
      this.pos = (this.pos + 1) % this.size;
      const a = v < 0 ? -v : v;
      if (a > this.hopPeak) {
        this.hopPeak = a;
        this.hopPeakAt = this.total + i;
      }
    }
    this.transients.push(block, this._onStrike);
    this.total += n;
    this.filled = Math.min(this.size, this.filled + n);
    this.since += n;
    if (this.since >= this.hop && this.filled >= this.size / 2) {
      // linéarise le tampon circulaire (plus ancien → plus récent)
      const tail = this.size - this.pos;
      this.work.set(this.ring.subarray(this.pos), 0);
      this.work.set(this.ring.subarray(0, this.pos), tail);
      const res = detectPitchAdaptive(this.work, this.sr, this.opts);
      if (res.freq && !plausibleFundamental(this.work, this.sr, res.freq)) {
        res.freq = null;
        res.clarity = 0;
      }
      emit({
        end: this.total, rms: res.rms, freq: res.freq, clarity: res.clarity, window: res.window,
        peak: this.hopPeak, peakAge: (this.total - this.hopPeakAt) / this.sr,
        transient: this.strikeAt >= 0, transientAge: this.strikeAt >= 0 ? (this.total - this.strikeAt) / this.sr : null,
      });
      this.since = 0;
      this.hopPeak = 0;
      this.hopPeakAt = this.total;
      this.strikeAt = -1;
    }
  }
}
