// Écoute du micro : hauteur (YIN adapté au registre), attaques, spectre pour la vérification d'accords.
// L'analyse tourne dans un AudioWorklet (mic-worklet.js) quand c'est possible : blocs horodatés au temps audio
// puis convertis en performance.now(). Repli : analyse périodique sur le fil principal (AnalyserNode).
// Événements (inchangés) : 'frame' {t, rms, freq, midi, midiFloat, cents, clarity, attack, confidence, band},
//                         'onset' {t, midi}, 'state' {running}.
import { audioContext } from './synth.js';
import { detectPitchAdaptive } from '../core/pitch.js';
import { freqToMidiFloat } from '../core/notes.js';
import { OnsetDetector, micCaptureTime, profileThresholds, bandOf } from '../core/onset.js';
import { dbToMagnitude } from '../core/spectrum.js';
import { store } from '../core/storage.js';

const workletLoaded = new WeakMap();
const isMobile = () => typeof navigator !== 'undefined' && (/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || '') || (navigator.hardwareConcurrency || 8) <= 4);

export class MicListener {
  constructor() {
    this.running = false;
    this.listeners = new Set();
    this.a4 = 440;
    this.sensitivity = 0.012;
    this.onset = new OnsetDetector();
    this.profile = null;
    this.noisy = false;
    this.confidence = 0;
    this.mode = null; // 'worklet' | 'fallback'
    this.useWorklet = true;
    this._stable = { midi: null, n: 0 };
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(ev) {
    for (const fn of this.listeners) {
      try { fn(ev); } catch (e) { console.error(e); }
    }
  }

  /** Relit les réglages (profil « Mon piano », mode bruité). */
  loadSettings(s = store.settings()) {
    this.profile = s.micUseProfile !== false && s.micProfile?.bands ? s.micProfile : null;
    this.noisy = !!s.micNoisyMode;
    this.onset.noisy = this.noisy;
    if (this.profile) {
      const mins = Object.values(this.profile.bands).map((b) => b.minRms);
      this.onset.minRms = Math.min(...mins);
      this.onset.silenceRms = this.profile.silenceRms ?? this.onset.silenceRms;
    } else {
      this.onset.minRms = this.sensitivity;
      this.onset.silenceRms = 0.007;
    }
    this._sendConfig();
  }

  /** Seuil minimal transmis à l'analyseur (il ne calcule rien en dessous). */
  get analysisMinRms() {
    return Math.max(0.0015, (this.profile ? this.onset.minRms : this.sensitivity) * 0.6);
  }

  _sendConfig() {
    this.node?.port.postMessage({ type: 'config', opts: { minRms: this.analysisMinRms } });
  }

  async start() {
    if (this.running) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Ce navigateur ne permet pas d'accéder au micro.");
    const ac = audioContext();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    if (ac.state === 'suspended') await ac.resume().catch(() => {});
    this.source = ac.createMediaStreamSource(this.stream);
    // AnalyserNode conservé pour spectrum() (vérification d'accords), calculé à la demande seulement
    this.analyser = ac.createAnalyser();
    this.analyser.fftSize = 16384;
    this.analyser.smoothingTimeConstant = 0;
    this.source.connect(this.analyser);
    this.freqDb = new Float32Array(this.analyser.frequencyBinCount);
    this.onset = new OnsetDetector({ minRms: this.sensitivity });
    this.loadSettings();
    const track = this.stream.getAudioTracks()[0];
    this.inputLatency = track?.getSettings?.().latency ?? ac.baseLatency ?? 0.01;
    this._stable = { midi: null, n: 0 };
    this.mode = null;
    if (this.useWorklet && ac.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
      try {
        if (!workletLoaded.get(ac)) {
          workletLoaded.set(ac, ac.audioWorklet.addModule(new URL('./mic-worklet.js', import.meta.url)));
        }
        await workletLoaded.get(ac);
        this.node = new AudioWorkletNode(ac, 'piano-mic-analyser', {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
          processorOptions: { minRms: this.analysisMinRms, hopMs: isMobile() ? 32 : 24 },
        });
        this.node.port.onmessage = (e) => this.handleAnalysis(e.data);
        // sortie muette reliée à la destination : garantit que le nœud est bien traité
        this.sink = ac.createGain();
        this.sink.gain.value = 0;
        this.source.connect(this.node);
        this.node.connect(this.sink).connect(ac.destination);
        this.mode = 'worklet';
      } catch (err) {
        console.warn('AudioWorklet indisponible, analyse sur le fil principal', err);
        workletLoaded.delete(ac);
        this.node = null;
      }
    }
    if (!this.mode) {
      this.full = new Float32Array(this.analyser.fftSize);
      const L = 4096 * Math.max(1, Math.round(ac.sampleRate / 48000));
      this.time = this.full.subarray(this.full.length - L);
      this.timer = setInterval(() => this.process(), isMobile() ? 40 : 30);
      this.mode = 'fallback';
    }
    this.running = true;
    this.emit({ type: 'state', running: true });
  }

  stop() {
    if (!this.running) return;
    clearInterval(this.timer);
    this.timer = null;
    if (this.node) {
      this.node.port.postMessage({ type: 'stop' });
      this.node.port.onmessage = null;
      try { this.node.disconnect(); } catch {}
      this.node = null;
    }
    try { this.sink?.disconnect(); } catch {}
    this.sink = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    try { this.source?.disconnect(); } catch {}
    this.running = false;
    this.confidence = 0;
    this.emit({ type: 'state', running: false });
  }

  setSensitivity(v) {
    this.sensitivity = v;
    if (!this.profile) this.onset.minRms = v;
    this._sendConfig();
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

  /** Repli sans AudioWorklet : lecture de l'AnalyserNode. */
  process() {
    this.analyser.getFloatTimeDomainData(this.full);
    const ac = audioContext();
    const res = detectPitchAdaptive(this.time, ac.sampleRate, { minRms: this.analysisMinRms, minFreq: 27.5, maxFreq: 4300 });
    this.handleAnalysis({ ...res, audioTime: null });
  }

  /** Convertit un résultat d'analyse en événements 'frame' / 'onset'. */
  handleAnalysis(r) {
    if (!this.running) return;
    const ac = audioContext();
    const now = performance.now();
    let t;
    if (r.audioTime != null) {
      let ts = null;
      try { ts = ac.getOutputTimestamp?.(); } catch {}
      t = micCaptureTime(r.audioTime, ts, { currentTime: ac.currentTime, now, outputLatency: ac.outputLatency || 0, baseLatency: ac.baseLatency || 0, inputLatency: this.inputLatency || 0 });
    } else t = now - (this.inputLatency || 0) * 1000;
    let midi = null, cents = 0, midiFloat = null, freq = r.freq ?? null;
    let clarity = r.clarity ?? 0;
    let th = { minRms: this.sensitivity, minClarity: this.onset.minClarity };
    if (freq) {
      midiFloat = freqToMidiFloat(freq, this.a4);
      midi = Math.round(midiFloat);
      cents = Math.round((midiFloat - midi) * 100);
      if (this.profile) th = profileThresholds(this.profile, midi, th);
    }
    // indice de confiance : clarté × marge au-dessus du seuil × stabilité de la hauteur
    if (midi != null && midi === this._stable.midi) this._stable.n++;
    else this._stable = { midi, n: midi == null ? 0 : 1 };
    const snr = midi == null ? 0 : Math.min(1, r.rms / (th.minRms * 2));
    const stab = Math.min(1, this._stable.n / 3);
    const confidence = midi == null ? 0 : +(clarity * (0.4 + 0.6 * snr) * (0.5 + 0.5 * stab)).toFixed(3);
    this.confidence = confidence;
    const attackT = r.peakAge != null && r.audioTime != null ? t - r.peakAge * 1000 : t;
    const { attack, onset, onsetT } = this.onset.push({ t, rms: r.rms, midi, clarity, minRms: th.minRms, minClarity: this.profile ? th.minClarity : undefined, attackT });
    this.emit({ type: 'frame', t, rms: r.rms, freq, midi, midiFloat, cents, clarity, attack, confidence, band: midi != null ? bandOf(midi) : null, attackT: attack ? attackT : null, peak: r.peak ?? null });
    if (onset != null) this.emit({ type: 'onset', t: onsetT ?? t, midi: onset, detectedAt: t });
  }
}

export const mic = new MicListener();
