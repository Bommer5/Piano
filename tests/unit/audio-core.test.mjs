// Tests audio : YIN optimisé, attaques, horloges, MIDI entrant/sortant, polyphonie du synthé (faux AudioContext).
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPitch, detectPitchAdaptive, synthTone, decimate, octaveCheck, rms } from '../../js/core/pitch.js';
import { goertzel } from '../../js/core/spectrum.js';
import { OnsetDetector, audioToPerf, micCaptureTime, latencyFromTaps, median, buildMicProfile, profileThresholds, bandOf } from '../../js/core/onset.js';
import { midiToFreq } from '../../js/core/notes.js';
import { MidiOutput, noteOnMsg, noteOffMsg, ccMsg, allNotesOffMsgs, sameDevice } from '../../js/audio/midi-output.js';
import { MidiInput, parseMidiMessage, deviceMakesSound } from '../../js/audio/midi-input.js';

const midiOf = (f) => 69 + 12 * Math.log2(f / 440);

// Implémentation YIN d'origine (référence de précision et de vitesse)
function yinReference(buf, sampleRate, { threshold = 0.15, minFreq = 27.5, maxFreq = 4200, minRms = 0.01 } = {}) {
  if (rms(buf) < minRms) return null;
  const n = buf.length;
  const maxTau = Math.min(Math.floor(sampleRate / minFreq), Math.floor(n / 2));
  const minTau = Math.max(2, Math.floor(sampleRate / maxFreq));
  const W = n - maxTau;
  const d = new Float32Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0;
    for (let j = 0; j < W; j++) { const x = buf[j] - buf[j + tau]; sum += x * x; }
    d[tau] = sum;
  }
  const cmnd = new Float32Array(maxTau + 1);
  let running = 0;
  for (let tau = 1; tau <= maxTau; tau++) { running += d[tau]; cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1; }
  let tauEst = -1;
  for (let tau = minTau; tau <= maxTau; tau++) {
    if (cmnd[tau] < threshold) { while (tau + 1 <= maxTau && cmnd[tau + 1] < cmnd[tau]) tau++; tauEst = tau; break; }
  }
  if (tauEst === -1) {
    let best = minTau;
    for (let tau = minTau; tau <= maxTau; tau++) if (cmnd[tau] < cmnd[best]) best = tau;
    if (cmnd[best] > 0.35) return null;
    tauEst = best;
  }
  let bt = tauEst;
  if (tauEst > 1 && tauEst < maxTau) { const s0 = cmnd[tauEst - 1], s1 = cmnd[tauEst], s2 = cmnd[tauEst + 1]; const den = 2 * (2 * s1 - s2 - s0); if (den) bt = tauEst + (s2 - s0) / den; }
  return { freq: sampleRate / bt };
}

test('YIN optimisé : même précision que la version d’origine sur toute la tessiture', () => {
  for (const sr of [44100, 48000]) {
    for (let m = 28; m <= 100; m += 3) {
      const buf = synthTone(midiToFreq(m), sr, 4096, { harmonics: 5 });
      const a = detectPitch(buf, sr), b = yinReference(buf, sr);
      assert.ok(a && b, `détection ${m}`);
      assert.ok(Math.abs(midiOf(a.freq) - midiOf(b.freq)) < 0.01, `écart ${m} @${sr}`);
      assert.ok(Math.abs(midiOf(a.freq) - m) < 0.1, `justesse ${m} : ${midiOf(a.freq)}`);
    }
  }
});

test('YIN optimisé : plus rapide que la version d’origine (mesure)', () => {
  const sr = 48000;
  const bufs = [40, 52, 60, 69, 81].map((m) => synthTone(midiToFreq(m), sr, 4096));
  const time = (fn) => { const t0 = performance.now(); for (let r = 0; r < 6; r++) for (const b of bufs) fn(b); return performance.now() - t0; };
  time((b) => detectPitch(b, sr, { minFreq: 40 })); time((b) => yinReference(b, sr, { minFreq: 40 })); // échauffement JIT
  const fast = time((b) => detectPitch(b, sr, { minFreq: 40 }));
  const ref = time((b) => yinReference(b, sr, { minFreq: 40 }));
  const adaptive = time((b) => detectPitchAdaptive(b, sr));
  console.log(`# YIN d'origine ${ref.toFixed(1)} ms, optimisé ${fast.toFixed(1)} ms, adaptatif ${adaptive.toFixed(1)} ms (30 analyses)`);
  assert.ok(fast < ref, `optimisé ${fast} ≥ référence ${ref}`);
  assert.ok(adaptive < ref, `adaptatif ${adaptive} ≥ référence ${ref}`);
});

test('YIN adaptatif : fenêtre courte dans l’aigu, longue sous-échantillonnée dans le grave', () => {
  for (const sr of [44100, 48000]) {
    for (let m = 24; m <= 103; m++) {
      const low = m < 45;
      const buf = synthTone(midiToFreq(m), sr, 4096, { harmonics: 6, amps: low ? [0.12, 0.3, 0.25, 0.2, 0.15, 0.1] : null, inharm: low ? 0.0002 : 0 });
      const r = detectPitchAdaptive(buf, sr);
      assert.ok(r.freq, `pas de détection ${m}`);
      assert.ok(Math.abs(midiOf(r.freq) - m) < 0.2, `${m} → ${midiOf(r.freq).toFixed(2)} (${r.window})`);
      assert.equal(r.window, midiToFreq(m) >= 255 ? 'short' : 'long', `fenêtre ${m}`);
    }
  }
  assert.equal(detectPitchAdaptive(new Float32Array(4096), 48000).freq, null);
});

test('décimation : préserve une basse, supprime le repliement', () => {
  const sr = 48000;
  const low = synthTone(110, sr, 4096, { harmonics: 1, amp: 0.5 });
  const d = decimate(low, 3);
  assert.ok(Math.abs(rms(d) - rms(low)) < 0.02);
  const high = synthTone(12000, sr, 4096, { harmonics: 1, amp: 0.5 }); // > Nyquist de 16 kHz
  assert.ok(rms(decimate(high, 3)) < 0.01);
  assert.ok(goertzel(low, sr, 110) > 10 * goertzel(low, sr, 165));
});

test('contrôle d’octave : sous-harmonique et fondamentale faible', () => {
  const sr = 16000;
  // Note réelle 110 Hz : si YIN annonçait 55 Hz, les demi-harmoniques de 55 seraient vides → pas de correction vers le bas
  const buf = synthTone(110, sr, 1365, { harmonics: 6 });
  assert.equal(octaveCheck(buf, sr, 110), 1);
  assert.equal(octaveCheck(buf, sr, 220), 0.5);
  assert.equal(octaveCheck(buf, sr, 55), 2);
});

test('attaques : horodatage de l’attaque, seuils par registre, mode bruité', () => {
  const d = new OnsetDetector();
  let t = 0;
  const out = [];
  const feed = (rmsv, midi, n, extra = {}) => { for (let i = 0; i < n; i++) { t += 25; const r = d.push({ t, rms: rmsv, midi, clarity: 0.95, attackT: t - 10, ...extra }); if (r.onset != null) out.push([r.onset, r.onsetT, t]); } };
  feed(0.001, null, 4);
  feed(0.2, 60, 3);
  assert.equal(out.length, 1);
  assert.equal(out[0][1], 125 - 10, 'onsetT = instant de l’attaque');
  assert.ok(out[0][2] > out[0][1]);
  // seuil de registre plus haut que le niveau : rien
  const d2 = new OnsetDetector();
  let n2 = 0;
  for (let i = 0; i < 6; i++) if (d2.push({ t: i * 25, rms: 0.03, midi: 40, clarity: 0.95, minRms: 0.05 }).onset != null) n2++;
  assert.equal(n2, 0);
  // mode bruité : une trame stable de plus
  const count = (noisy) => { const o = new OnsetDetector({ noisy }); for (let i = 0; i < 8; i++) { const r = o.push({ t: i * 25, rms: i < 2 ? 0.001 : 0.2, midi: i < 2 ? null : 64, clarity: 0.95 }); if (r.onset != null) return i; } return -1; };
  assert.equal(count(true) - count(false), 1);
});

test('horloges : temps audio ↔ performance.now()', () => {
  const ts = { contextTime: 10, performanceTime: 5000 };
  assert.equal(audioToPerf(10.5, ts, { currentTime: 10.02, now: 5100 }), 5500);
  // repli sans getOutputTimestamp : maintenant + délai + latence de sortie
  assert.equal(audioToPerf(2.1, null, { currentTime: 2, now: 1000, outputLatency: 0.02 }), 1000 + 120);
  assert.equal(audioToPerf(2.1, { contextTime: 0, performanceTime: 0 }, { currentTime: 2, now: 1000 }), 1100);
  // capture micro : avant le rendu, jamais dans le futur
  const t = micCaptureTime(10, ts, { currentTime: 10.05, now: 5100, outputLatency: 0.03, baseLatency: 0.01, inputLatency: 0.01 });
  assert.ok(Math.abs(t - (5000 - 40 - 10)) < 1e-6);
  assert.equal(micCaptureTime(20, ts, { currentTime: 10, now: 5100 }), 5100);
  assert.ok(Math.abs(micCaptureTime(1.9, null, { currentTime: 2, now: 1000 }) - 900) < 1e-6);
});

test('calibration : médiane des écarts des frappes', () => {
  const clicks = Array.from({ length: 16 }, (_, i) => 1000 + i * 600);
  const taps = clicks.map((c, i) => c + 40 + (i % 3) * 6 - 6).concat([5000]);
  const r = latencyFromTaps(clicks, taps);
  assert.equal(r.latency, 40);
  assert.equal(r.n, 16);
  assert.equal(latencyFromTaps(clicks, [1000, 1600]).latency, null);
  assert.equal(median([3, 1, 2, 10]), 2.5);
});

test('profil « Mon piano » : seuils par registre', () => {
  const p = buildMicProfile([0.002, 0.003, 0.0025, 0.004], {
    low: { rms: [0.05, 0.08, 0.1], clarity: [0.7, 0.75, 0.8] },
    mid: { rms: [0.2, 0.25], clarity: [0.95, 0.9] },
  });
  assert.ok(p.silenceRms >= 0.002);
  assert.ok(p.bands.low.minRms < p.bands.mid.minRms);
  assert.ok(p.bands.low.minClarity < p.bands.mid.minClarity);
  assert.equal(bandOf(40), 'low');
  assert.equal(bandOf(60), 'mid');
  assert.equal(bandOf(80), 'high');
  assert.deepEqual(profileThresholds(p, 40), { minRms: p.bands.low.minRms, minClarity: p.bands.low.minClarity });
  assert.equal(profileThresholds(p, 90).minRms, Math.min(p.bands.low.minRms, p.bands.mid.minRms));
  assert.deepEqual(profileThresholds(null, 60), { minRms: 0.012, minClarity: 0.75 });
});

// ---------- MIDI ----------
function fakeOutput(name = 'Piano numérique') {
  const sent = [];
  return { name, sent, send(data, ts) { sent.push({ data: [...data], ts }); }, clear() { sent.push({ clear: true }); } };
}

test('MIDI sortant : messages, horodatage, canal 10 pour le métronome, All Notes Off', () => {
  assert.deepEqual(noteOnMsg(1, 60, 1), [0x90, 60, 127]);
  assert.deepEqual(noteOnMsg(16, 60, 0), [0x9f, 60, 1]);
  assert.deepEqual(noteOffMsg(2, 61), [0x81, 61, 64]);
  assert.deepEqual(ccMsg(1, 64, 127), [0xb0, 64, 127]);
  assert.deepEqual(allNotesOffMsgs(1).map((m) => m[1]), [64, 123, 120]);
  const out = new MidiOutput();
  out.now = () => 1000;
  const port = fakeOutput();
  out.configure({ midiOutEnabled: true, midiOutChannel: 3, midiOutMode: 'midi', midiOutProgram: true });
  out.setPort(port);
  assert.equal(out.routing(), 'midi');
  assert.ok(out.noteOn(64, 0.5, 1200, 500, 'clavecin'));
  assert.deepEqual(port.sent[0], { data: [0xc2, 6], ts: 1200 });
  assert.deepEqual(port.sent[1], { data: [0x92, 64, 64], ts: 1200 });
  assert.deepEqual(port.sent[2], { data: [0x82, 64, 64], ts: 1700 });
  port.sent.length = 0;
  out.click(1500, true);
  assert.deepEqual(port.sent.map((s) => s.data), [[0x99, 37, 114], [0x89, 37, 64]]);
  assert.equal(port.sent[1].ts, 1560);
  port.sent.length = 0;
  out.noteOn(70, 0.8, 1300); // tenue (relâchement manuel)
  out.allNotesOff();
  const datas = port.sent.filter((s) => s.data).map((s) => s.data);
  assert.ok(port.sent.some((s) => s.clear));
  assert.ok(datas.some((d) => d[0] === 0x82 && d[1] === 70));
  assert.ok(datas.some((d) => d[0] === 0xb2 && d[1] === 123));
  // horodatage dans le passé : envoi immédiat (sans timestamp)
  port.sent.length = 0;
  out.noteOn(50, 0.5, 900);
  assert.equal(port.sent[0].ts, undefined);
});

test('MIDI sortant : pas d’écho vers le même appareil, désactivé = local', () => {
  const out = new MidiOutput();
  out.now = () => 1000;
  out.configure({ midiOutEnabled: true });
  const port = fakeOutput('Roland FP-30 MIDI OUT');
  out.setPort(port);
  out.markIncoming(60, 'Roland FP-30 MIDI IN', 995);
  assert.equal(out.noteOn(60, 0.7, 1000), false);
  assert.equal(out.noteOn(62, 0.7, 1000), true);
  out.markIncoming(64, 'Arturia KeyStep', 995);
  assert.equal(out.noteOn(64, 0.7, 1000), true);
  assert.ok(sameDevice('Roland FP-30 MIDI 1', 'Roland FP-30'));
  out.configure({ midiOutEnabled: false });
  assert.equal(out.routing(), 'local');
});

test('MIDI entrant : décodage, canal, horodatage, pédales', () => {
  assert.deepEqual(parseMidiMessage([0x91, 60, 100]), { type: 'noteon', channel: 2, midi: 60, velocity: 100 / 127, rawVelocity: 100 });
  assert.equal(parseMidiMessage([0x90, 60, 0]).type, 'noteoff');
  assert.equal(parseMidiMessage([0x80, 60, 40]).type, 'noteoff');
  assert.deepEqual(parseMidiMessage([0xb0, 67, 127]), { type: 'cc', channel: 1, cc: 67, value: 127 });
  assert.equal(parseMidiMessage([0xf8]), null);
  assert.equal(parseMidiMessage([0xe0, 0, 64]).value, 0);
  const inp = new MidiInput();
  const ev = [];
  inp.on((e) => ev.push(e));
  inp.handle(new Uint8Array([0x90, 60, 127]), 1234.5, 'X');
  inp.handle(new Uint8Array([0xb0, 64, 127]), 1240, 'X');
  inp.handle(new Uint8Array([0xb0, 66, 0]), 1241, 'X');
  inp.handle(new Uint8Array([0xb0, 7, 100]), 1242, 'X'); // volume : ignoré
  inp.handle(new Uint8Array([0x80, 60, 0]), 1300, 'X');
  assert.deepEqual(ev.map((e) => e.type), ['noteon', 'cc', 'pedal', 'cc', 'noteoff']);
  assert.equal(ev[0].t, 1234.5);
  assert.equal(ev[0].velocity, 1);
  assert.equal(ev[2].down, true);
  assert.equal(ev[3].cc, 66);
  inp.applySettings({ midiInChannel: 2 });
  ev.length = 0;
  inp.handle([0x90, 60, 100], 1);
  inp.handle([0x91, 62, 100], 2);
  assert.deepEqual(ev.map((e) => e.midi), [62]);
  assert.ok(deviceMakesSound('Digital Piano'));
  assert.ok(deviceMakesSound('CASIO USB-MIDI'));
  assert.ok(!deviceMakesSound('Keystation 49 MK3'));
  assert.ok(!deviceMakesSound('Arturia KeyStep 37'));
});

// ---------- synthé (faux AudioContext) ----------
class FakeParam {
  constructor(v = 0) { this.value = v; this.events = 0; }
  setValueAtTime() { this.events++; return this; } linearRampToValueAtTime() { this.events++; return this; }
  exponentialRampToValueAtTime() { this.events++; return this; } setTargetAtTime() { this.events++; return this; }
  cancelScheduledValues() { return this; } cancelAndHoldAtTime() { return this; }
}
let liveNodes = 0;
class FakeNode {
  constructor(ac) { this.ac = ac; this.outs = new Set(); liveNodes++; this.gain = new FakeParam(1); this.frequency = new FakeParam(440); this.Q = new FakeParam(1); this.pan = new FakeParam(0); this.threshold = new FakeParam(); this.ratio = new FakeParam(); }
  connect(n) { this.outs.add(n); return n; }
  disconnect() { if (!this.dead) { this.dead = true; liveNodes--; } this.outs.clear(); }
}
class FakeSource extends FakeNode {
  start(t) { this.startT = t; this.ac.sources.add(this); }
  stop(t) { this.stopT = t; }
}
class FakeAC {
  constructor() { this.currentTime = 0; this.sampleRate = 48000; this.state = 'running'; this.destination = new FakeNode(this); this.sources = new Set(); }
  createGain() { return new FakeNode(this); } createBiquadFilter() { return new FakeNode(this); } createStereoPanner() { return new FakeNode(this); }
  createDynamicsCompressor() { return new FakeNode(this); } createConvolver() { return new FakeNode(this); }
  createOscillator() { return new FakeSource(this); } createBufferSource() { return new FakeSource(this); }
  createBuffer(ch, len) { const d = Array.from({ length: ch }, () => new Float32Array(len)); return { getChannelData: (c) => d[c] }; }
  getOutputTimestamp() { return { contextTime: this.currentTime, performanceTime: 0 }; }
  /** avance le temps et déclenche onended des sources arrêtées */
  advance(t) {
    this.currentTime = t;
    for (const s of [...this.sources]) if (s.stopT != null && s.stopT <= t) { this.sources.delete(s); s.onended?.(); }
  }
}

test('synthé : polyphonie limitée, vol des voix anciennes, aucun nœud oublié', async () => {
  globalThis.AudioContext = FakeAC;
  const synth = await import('../../js/audio/synth.js');
  synth._resetForTests();
  const ac = synth.audioContext();
  const base = liveNodes;
  for (let i = 0; i < 70; i++) synth.playNote(30 + (i % 60), { dur: 3, velocity: 0.7 });
  assert.equal(synth.voiceCount(), synth.MAX_VOICES);
  // timbre : partiels inharmoniques
  const parts = synth.pianoPartials(33, 0.8);
  assert.ok(parts.length >= 6);
  assert.ok(parts[5].f > 6 * parts[0].f, 'inharmonicité : partiels étirés');
  assert.ok(parts[0].tau2 > parts[3].tau2, 'les partiels aigus s’éteignent plus vite');
  synth.releaseNote(40);
  synth.stopAll();
  assert.equal(synth.voiceCount(), 0);
  ac.advance(30);
  assert.equal(liveNodes, base, `nœuds non déconnectés : ${liveNodes - base}`);
  // pédale : la note continue jusqu'au relâchement
  synth.playNote(60, { dur: 8 });
  synth.setSustain(true);
  synth.releaseNote(60);
  assert.equal(synth.voiceCount(), 1);
  synth.setSustain(false);
  ac.advance(31);
  assert.equal(synth.voiceCount(), 0);
  assert.equal(liveNodes, base);
});
