// AudioWorklet d'analyse du micro : tourne sur le fil audio, reçoit des blocs de 128 échantillons,
// et toutes les ~25 ms analyse la hauteur (YIN adapté au registre, sous-échantillonné dans le grave).
// Poste au fil principal : { audioTime, rms, freq, clarity, window, peakAge } — audioTime = temps audio
// (s) du DERNIER échantillon analysé ; peakAge = âge (s) du pic d'amplitude le plus récent (attaque précise).
import { detectPitchAdaptive } from '../core/pitch.js';

class PianoMicAnalyser extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options?.processorOptions || {};
    const scale = Math.max(1, Math.round(sampleRate / 48000));
    this.size = 4096 * scale;
    this.ring = new Float32Array(this.size);
    this.work = new Float32Array(this.size);
    this.pos = 0;
    this.filled = 0;
    this.hop = Math.max(128, Math.round((o.hopMs ?? 25) * sampleRate / 1000 / 128) * 128);
    this.since = 0;
    this.opts = { minRms: o.minRms ?? 0.007, minFreq: o.minFreq ?? 27.5, maxFreq: o.maxFreq ?? 4300, threshold: o.threshold ?? 0.15 };
    // pic dans le saut courant
    this.hopPeak = 0;
    this.hopPeakIdx = 0;
    this.prevEnergy = 0;
    this.port.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === 'config') {
        Object.assign(this.opts, m.opts || {});
        if (m.hopMs) this.hop = Math.max(128, Math.round((m.hopMs * sampleRate) / 1000 / 128) * 128);
      } else if (m.type === 'stop') this.stopped = true;
    };
  }

  process(inputs) {
    if (this.stopped) return false;
    const input = inputs[0];
    if (!input || !input.length || !input[0]) return true;
    const ch0 = input[0];
    const ch1 = input.length > 1 ? input[1] : null;
    const n = ch0.length;
    for (let i = 0; i < n; i++) {
      const v = ch1 ? (ch0[i] + ch1[i]) * 0.5 : ch0[i];
      this.ring[this.pos] = v;
      this.pos = (this.pos + 1) % this.size;
      const a = v < 0 ? -v : v;
      if (a > this.hopPeak) {
        this.hopPeak = a;
        this.hopPeakIdx = this.since + i;
      }
    }
    this.filled = Math.min(this.size, this.filled + n);
    this.since += n;
    if (this.since >= this.hop && this.filled >= this.size / 2) {
      // linéarise le tampon circulaire (plus ancien → plus récent)
      const tail = this.size - this.pos;
      this.work.set(this.ring.subarray(this.pos), 0);
      this.work.set(this.ring.subarray(0, this.pos), tail);
      const res = detectPitchAdaptive(this.work, sampleRate, this.opts);
      const audioTime = (currentFrame + n) / sampleRate;
      const peakAge = (this.since - this.hopPeakIdx) / sampleRate;
      this.port.postMessage({ audioTime, rms: res.rms, freq: res.freq, clarity: res.clarity, window: res.window, peak: this.hopPeak, peakAge });
      this.since = 0;
      this.hopPeak = 0;
      this.hopPeakIdx = 0;
    }
    return true;
  }
}

registerProcessor('piano-mic-analyser', PianoMicAnalyser);
