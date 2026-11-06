// Écoute du micro : hauteur (YIN), attaques, spectre pour la vérification d'accords.
import { audioContext } from './synth.js';
import { detectPitch } from '../core/pitch.js';
import { freqToMidiFloat } from '../core/notes.js';
import { OnsetDetector } from '../core/onset.js';
import { dbToMagnitude } from '../core/spectrum.js';

export class MicListener {
  constructor() {
    this.running = false;
    this.listeners = new Set();
    this.a4 = 440;
    this.sensitivity = 0.012;
    this.onset = new OnsetDetector();
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(ev) {
    for (const fn of this.listeners) fn(ev);
  }

  async start() {
    if (this.running) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Ce navigateur ne permet pas d'accéder au micro.");
    const ac = audioContext();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.source = ac.createMediaStreamSource(this.stream);
    this.analyser = ac.createAnalyser();
    this.analyser.fftSize = 16384; // bonne résolution pour les accords
    this.analyser.smoothingTimeConstant = 0;
    this.source.connect(this.analyser);
    this.full = new Float32Array(this.analyser.fftSize);
    this.time = this.full.subarray(this.full.length - 4096); // les 4096 échantillons les PLUS RÉCENTS
    this.freqDb = new Float32Array(this.analyser.frequencyBinCount);
    this.onset = new OnsetDetector({ minRms: this.sensitivity });
    this.running = true;
    this.timer = setInterval(() => this.process(), 35);
    this.emit({ type: 'state', running: true });
  }

  stop() {
    if (!this.running) return;
    clearInterval(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.source?.disconnect();
    this.running = false;
    this.emit({ type: 'state', running: false });
  }

  setSensitivity(v) {
    this.sensitivity = v;
    this.onset.minRms = v;
  }

  /** Spectre courant en magnitudes linéaires (pour matchChord). */
  spectrum() {
    if (!this.running) return null;
    this.analyser.getFloatFrequencyData(this.freqDb);
    return dbToMagnitude(this.freqDb);
  }

  get sampleRate() {
    return audioContext().sampleRate;
  }

  process() {
    // getFloatTimeDomainData remplit depuis le plus ancien : on lit tout le tampon et on garde la fin.
    this.analyser.getFloatTimeDomainData(this.full);
    const sr = this.sampleRate;
    const res = detectPitch(this.time, sr, { minRms: this.sensitivity * 0.6, minFreq: 40, maxFreq: 4300 });
    let level = 0;
    for (let i = 0; i < this.time.length; i++) level += this.time[i] * this.time[i];
    level = Math.sqrt(level / this.time.length);
    const t = performance.now();
    let midi = null, cents = 0, midiFloat = null;
    if (res) {
      midiFloat = freqToMidiFloat(res.freq, this.a4);
      midi = Math.round(midiFloat);
      cents = Math.round((midiFloat - midi) * 100);
    }
    const { attack, onset } = this.onset.push({ t, rms: level, midi, clarity: res?.clarity ?? 0 });
    this.emit({ type: 'frame', t, rms: level, freq: res?.freq ?? null, midi, midiFloat, cents, clarity: res?.clarity ?? 0, attack });
    if (onset != null) this.emit({ type: 'onset', t, midi: onset });
  }
}

export const mic = new MicListener();
