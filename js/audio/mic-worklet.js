// AudioWorklet d'analyse du micro : tourne sur le fil audio, reçoit des blocs de 128 échantillons.
// Toute la logique est dans js/core/micanalyser.js (FrameAnalyser, pur et testé) :
//  - hauteur toutes les ~25 ms (YIN adapté au registre) ;
//  - détection des FRAPPES (choc du marteau) sur le signal brut, bloc par bloc : c'est ce qui permet de
//    compter correctement une même note jouée plusieurs fois de suite.
// Poste au fil principal : { audioTime, rms, freq, clarity, window, peak, peakAge, transient, transientAge }
//   audioTime = temps audio (s) du DERNIER échantillon analysé ; peakAge / transientAge = âge (s) avant audioTime.
import { FrameAnalyser } from '../core/micanalyser.js';

class PianoMicAnalyser extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options?.processorOptions || {};
    this.analyser = new FrameAnalyser(sampleRate, { hopMs: o.hopMs ?? 25, minRms: o.minRms ?? 0.007, minFreq: o.minFreq ?? 27.5, maxFreq: o.maxFreq ?? 4300, threshold: o.threshold ?? 0.15 });
    this.mix = new Float32Array(128);
    this.blockEnd = 0;
    this._emit = (r) => {
      this.port.postMessage({ audioTime: this.blockEnd, rms: r.rms, freq: r.freq, clarity: r.clarity, window: r.window, peak: r.peak, peakAge: r.peakAge, transient: r.transient, transientAge: r.transientAge });
    };
    this.port.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === 'config') {
        Object.assign(this.analyser.opts, m.opts || {});
        if (m.hopMs) this.analyser.setHop(m.hopMs);
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
    let block = ch0;
    if (ch1) {
      if (this.mix.length !== n) this.mix = new Float32Array(n);
      for (let i = 0; i < n; i++) this.mix[i] = (ch0[i] + ch1[i]) * 0.5;
      block = this.mix;
    }
    this.blockEnd = (currentFrame + n) / sampleRate;
    this.analyser.push(block, this._emit);
    return true;
  }
}

registerProcessor('piano-mic-analyser', PianoMicAnalyser);
