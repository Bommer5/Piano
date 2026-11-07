// Tests de la transcription audio → partition (signaux synthétiques « façon piano »).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transcribe, transcribeAsync, toRawSong, estimateKey } from '../../js/core/transcribe.js';
import { importScoreFile, transcribeAudioBuffer, decodeWav, SUPPORTED_FORMATS } from '../../js/parsers/index.js';
import { prepareSong } from '../../js/core/song.js';

const SR = 44100;

function rng(seed = 7) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/**
 * Son de piano simplifié : 8 harmoniques en 1/h, attaque de 4 ms, décroissance exponentielle
 * (plus rapide pour les aigus), relâchement de 30 ms, plus un léger bruit blanc.
 * @param {Array<{midi:number,t:number,d:number,amp?:number,tau?:number}>} events secondes
 */
function render(events, sr = SR, { noise = 0.003, total = null, tau = 0.6 } = {}) {
  const end = total ?? Math.max(...events.map((e) => e.t + e.d), 0) + 0.5;
  const buf = new Float32Array(Math.ceil(end * sr));
  for (const e of events) {
    const f0 = 440 * Math.pow(2, (e.midi - 69) / 12);
    const a = e.amp ?? 0.3;
    const s0 = Math.round(e.t * sr), len = Math.round(e.d * sr), rel = Math.round(0.03 * sr);
    for (let h = 1; h <= 8; h++) {
      const fh = f0 * h * Math.sqrt(1 + 0.0001 * h * h);
      if (fh > sr / 2.2) break;
      const w = (2 * Math.PI * fh) / sr, ah = a / h, th = (e.tau ?? tau) / Math.sqrt(h);
      for (let i = 0; i < len + rel && s0 + i < buf.length; i++) {
        let env = Math.min(1, i / (0.004 * sr)) * Math.exp(-i / sr / th);
        if (i >= len) env *= 1 - (i - len) / rel;
        buf[s0 + i] += ah * env * Math.sin(w * i);
      }
    }
  }
  const r = rng();
  for (let i = 0; i < buf.length; i++) buf[i] += noise * (r() * 2 - 1);
  return buf;
}

/** Suite de (note, durée en temps) → événements en secondes. */
function seq(pairs, bpm, t0 = 0.25, extra = {}) {
  const b = 60 / bpm;
  let t = t0;
  return pairs.map(([midi, d]) => {
    const e = { midi, t, d: d * b, ...extra };
    t += d * b;
    return e;
  });
}

const short = (raw, hand) => raw.notes.filter((n) => !hand || n.hand === hand).map((n) => [n.midi, n.start, n.dur]);

function encodeWav(samples, sr, bits = 16, channels = 1) {
  const bytes = bits / 8;
  const data = samples.length * bytes * channels;
  const u8 = new Uint8Array(44 + data);
  const dv = new DataView(u8.buffer);
  const str = (o, s) => [...s].forEach((c, i) => (u8[o + i] = c.charCodeAt(0)));
  str(0, 'RIFF'); dv.setUint32(4, 36 + data, true); str(8, 'WAVE');
  str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, bits === 32 ? 3 : 1, true); dv.setUint16(22, channels, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * bytes * channels, true); dv.setUint16(32, bytes * channels, true); dv.setUint16(34, bits, true);
  str(36, 'data'); dv.setUint32(40, data, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++) {
    for (let c = 0; c < channels; c++, o += bytes) {
      const v = Math.max(-1, Math.min(1, samples[i]));
      if (bits === 16) dv.setInt16(o, Math.round(v * 32767), true);
      else if (bits === 24) { const x = Math.round(v * 8388607); u8[o] = x & 255; u8[o + 1] = (x >> 8) & 255; u8[o + 2] = (x >> 16) & 255; }
      else dv.setFloat32(o, v, true);
    }
  }
  return u8;
}

const fakeFile = (name, u8) => ({
  name,
  arrayBuffer: async () => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength),
  text: async () => new TextDecoder().decode(u8),
});

const SCALE = [60, 62, 64, 65, 67, 69, 71, 72];

test('transcription : gamme de Do majeur à 100 BPM (hauteurs, ordre, tempo, durées)', () => {
  const ev = seq(SCALE.map((m) => [m, 1]), 100, 0.3);
  const res = transcribe(render(ev), SR);
  assert.deepEqual(res.notes.map((n) => n.midi), SCALE);
  for (let i = 0; i < ev.length; i++) assert.ok(Math.abs(res.notes[i].startSec - ev[i].t) < 0.04, `attaque ${i}`);
  const ratio = res.tempo / 100;
  const k = Math.round(ratio >= 1 ? ratio : 1 / ratio);
  assert.ok(Math.abs(res.tempo - 100) <= 5 || Math.abs(res.tempo * (ratio >= 1 ? 1 / k : k) - 100) <= 5, `tempo ${res.tempo}`);
  assert.equal(res.keyFifths, 0);
  assert.deepEqual(res.timeSig, [4, 4]);
  assert.ok(res.confidence > 0.5);
  const raw = toRawSong(res, { title: 'Gamme' });
  assert.equal(raw.title, 'Gamme');
  assert.deepEqual(short(raw), SCALE.map((m, i) => [m, i, 1]));
  assert.ok(raw.notes.every((n) => n.finger === null && n.hand === 'R'));
  const song = prepareSong(raw);
  assert.ok(song.notes.every((n) => n.finger >= 1 && n.finger <= 5), 'doigté automatique');
  assert.equal(song.measureCount, 2);
});

test('transcription : notes répétées re-frappées détectées séparément', () => {
  const pairs = [[67, 1], [67, 1], [67, 1], [69, 1], [71, 1], [71, 1], [69, 1], [67, 1]];
  // notes jointives (légère résonance commune)
  let raw = toRawSong(transcribe(render(seq(pairs, 120)), SR));
  assert.deepEqual(short(raw), pairs.map(([m], i) => [m, i, 1]));
  // notes qui se chevauchent (résonance prolongée, comme avec la pédale)
  const over = seq(pairs, 120).map((e) => ({ ...e, d: e.d * 1.6 }));
  raw = toRawSong(transcribe(render(over), SR));
  assert.deepEqual(raw.notes.map((n) => [n.midi, n.start]), pairs.map(([m], i) => [m, i]));
  // croche + noire sur la même note (Ode à la joie : « E. D D »)
  // (extrait trop court pour fixer le tempo : on vérifie les attaques en secondes)
  const ev = seq([[64, 1], [64, 1.5], [62, 0.5], [62, 2], [60, 1]], 120);
  const res = transcribe(render(ev), SR);
  assert.deepEqual(res.notes.map((n) => n.midi), [64, 64, 62, 62, 60]);
  res.notes.forEach((n, i) => assert.ok(Math.abs(n.startSec - ev[i].t) < 0.04 && Math.abs(n.durSec - ev[i].d) < 0.08, `note ${i}`));
});

test('transcription : mélodie (MD) sur un accord tenu (MG)', () => {
  const mel = [76, 74, 72, 74, 76, 76, 76, 77];
  const ev = seq(mel.map((m) => [m, 1]), 100, 0.2, { amp: 0.35 });
  const b = 0.6;
  for (const m of [48, 52, 55]) ev.push({ midi: m, t: 0.2, d: 4 * b, amp: 0.22, tau: 1.5 });
  for (const m of [43, 47, 50]) ev.push({ midi: m, t: 0.2 + 4 * b, d: 4 * b, amp: 0.22, tau: 1.5 });
  const raw = toRawSong(transcribe(render(ev), SR));
  assert.deepEqual(short(raw, 'R'), mel.map((m, i) => [m, i, 1]));
  const left = raw.notes.filter((n) => n.hand === 'L');
  const at0 = left.filter((n) => n.start === 0).map((n) => n.midi);
  const at4 = left.filter((n) => n.start === 4).map((n) => n.midi);
  assert.ok(at0.includes(48), `Do3 (fondamentale) dans la MG : ${at0}`);
  assert.ok(at4.includes(43), `Sol2 dans la MG : ${at4}`);
  assert.ok(left.length <= 8, 'pas de notes fantômes à la main gauche');
  for (const n of left) assert.ok(n.dur >= 3, 'accord tenu');
  // monophonique forcé : seulement la mélodie
  const mono = transcribe(render(ev), SR, { polyphonic: false });
  assert.deepEqual(mono.notes.map((n) => n.midi), mel);
});

test('transcription : Ode à la joie → Do majeur, rythme pointé', () => {
  const [C, D, E, F, G] = [60, 62, 64, 65, 67];
  const phrase = [[E, 1], [E, 1], [F, 1], [G, 1], [G, 1], [F, 1], [E, 1], [D, 1], [C, 1], [C, 1], [D, 1], [E, 1]];
  const pairs = [...phrase, [E, 1.5], [D, 0.5], [D, 2], ...phrase, [D, 1.5], [C, 0.5], [C, 2]];
  const res = transcribe(render(seq(pairs, 120)), SR);
  assert.equal(res.keyFifths, 0);
  assert.equal(res.keyName, 'Do majeur');
  assert.equal(res.tempo, 120);
  const raw = toRawSong(res);
  let t = 0;
  assert.deepEqual(short(raw), pairs.map(([m, d]) => { const r = [m, t, d]; t += d; return r; }));
});

test('transcription : valse « oum-pa-pa » → mesure à 3/4', () => {
  const ev = seq([[72, 2], [71, 1], [69, 3], [67, 2], [69, 1], [71, 3], [72, 2], [74, 1], [76, 3], [74, 2], [72, 1], [71, 3]], 120, 0.2);
  const chords = [[48, 52, 55], [53, 57, 60], [43, 47, 50], [48, 52, 55]];
  chords.forEach(([r, x, y], bar) => {
    const t = 0.2 + bar * 1.5;
    ev.push({ midi: r, t, d: 0.5, amp: 0.3 });
    for (const k of [1, 2]) for (const m of [x, y]) ev.push({ midi: m, t: t + k * 0.5, d: 0.5, amp: 0.12 });
  });
  const res = transcribe(render(ev), SR);
  assert.deepEqual(res.timeSig, [3, 4]);
  const raw = toRawSong(res);
  assert.deepEqual(raw.timeSig, [3, 4]);
  const bass = raw.notes.filter((n) => n.hand === 'L' && [48, 53, 43].includes(n.midi) && n.start % 3 === 0);
  assert.ok(bass.length >= 3, 'basses sur les temps forts');
});

test('transcription : silence, bruit et entrées vides ne lèvent pas d’erreur', async () => {
  for (const buf of [new Float32Array(SR * 2), new Float32Array(0), new Float32Array(100)]) {
    const r = transcribe(buf, SR);
    assert.deepEqual(r.notes, []);
    assert.deepEqual(r.timeSig, [4, 4]);
  }
  const noise = new Float32Array(SR * 2);
  const r0 = rng(3);
  for (let i = 0; i < noise.length; i++) noise[i] = (r0() * 2 - 1) * 0.01;
  assert.equal(transcribe(noise, SR).notes.length, 0);
  assert.deepEqual(toRawSong(transcribe(new Float32Array(SR), SR)).notes, []);
  await assert.rejects(() => transcribeAudioBuffer(new Float32Array(SR), SR), /Aucune note/);
});

test('transcription : autres fréquences d’échantillonnage, diapason décalé, version asynchrone', async () => {
  const pairs = [[60, 1], [64, 1], [67, 0.5], [72, 1], [71, 1], [67, 0.5], [62, 1], [59, 1], [60, 0.5]];
  let t = 0;
  const expected = pairs.map(([m, d]) => { const r = [m, t, d]; t += d; return r; });
  for (const [sr, detune, bpm] of [[48000, 0, 70], [44100, 0.3, 140], [22050, -0.35, 60]]) {
    const ev = seq(pairs, bpm, 0.4).map((e) => ({ ...e, midi: e.midi + detune }));
    const progress = [];
    const res = await transcribeAsync(render(ev, sr), sr, { onProgress: (f) => progress.push(f) });
    assert.equal(res.tempo, bpm);
    assert.ok(Math.abs(res.tuningCents - detune * 100) < 8, `diapason ${res.tuningCents}`);
    assert.deepEqual(short(toRawSong(res)), expected, `${sr} Hz`);
    assert.ok(progress.length > 2 && progress.at(-1) === 1 && progress.every((p, i) => i === 0 || p >= progress[i - 1]));
  }
});

test('estimateKey : majeur / mineur, armures', () => {
  const mk = (midis) => midis.map((midi, i) => ({ midi, startSec: i, durSec: 1, velocity: 90 }));
  assert.equal(estimateKey(mk([67, 69, 71, 72, 74, 76, 78, 79, 74, 71, 67])).keyFifths, 1); // Sol majeur
  assert.equal(estimateKey(mk([65, 67, 69, 70, 72, 74, 76, 77, 72, 69, 65])).keyFifths, -1); // Fa majeur
  const am = estimateKey(mk([57, 59, 60, 62, 64, 65, 68, 69, 64, 60, 57]));
  assert.equal(am.mode, 'minor');
  assert.equal(am.keyFifths, 0); // La mineur
});

test('import : WAV → importScoreFile → morceau transcrit (aller-retour)', async () => {
  const ev = seq(SCALE.map((m) => [m, 1]), 100, 0.3);
  const audio = render(ev);
  for (const bits of [16, 24, 32]) {
    const dec = decodeWav(encodeWav(audio, SR, bits));
    assert.equal(dec.sampleRate, SR);
    assert.ok(Math.abs(dec.samples[5000] - audio[5000]) < 1e-3, `${bits} bits`);
  }
  // stéréo → mono
  const st = decodeWav(encodeWav(audio.subarray(0, 1000), SR, 16, 2));
  assert.ok(Math.abs(st.samples[500] - audio[500]) < 1e-3);

  const progress = [];
  const song = await importScoreFile(fakeFile('ma_gamme.wav', encodeWav(audio, SR, 16)), { onProgress: (f) => progress.push(f) });
  assert.equal(song.source.format, 'audio');
  assert.equal(song.source.fileName, 'ma_gamme.wav');
  assert.equal(song.transcribed, true);
  assert.equal(song.title, 'ma gamme');
  assert.ok(Math.abs(song.tempo - 100) <= 5);
  assert.deepEqual(short(song), SCALE.map((m, i) => [m, i, 1]));
  assert.ok(progress.length > 0 && progress.at(-1) === 1);
  prepareSong(song);
  // détection par contenu, même sans extension audio
  const s2 = await importScoreFile(fakeFile('enregistrement.bin', encodeWav(audio, SR, 16)));
  assert.equal(s2.source.format, 'audio');
  // silence → message clair
  await assert.rejects(() => importScoreFile(fakeFile('vide.wav', encodeWav(new Float32Array(SR), SR))), /Aucune note/);
  // format compressé sans Web Audio (Node) → message en français
  await assert.rejects(() => importScoreFile(fakeFile('x.mp3', new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]))), /navigateur/);
  const f = SUPPORTED_FORMATS.find((x) => x.audio);
  assert.ok(f && /transcription/i.test(f.label) && /piano seul/.test(f.description));
  for (const ext of ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.webm']) assert.ok(f.ext.split(',').includes(ext));
});

test('performance : 60 s de musique transcrites en moins de 10 s', () => {
  const r0 = rng(5);
  const ev = [];
  const b = 60 / 120;
  let t = 0.3, beat = 0;
  while (t < 59) {
    const d = r0() < 0.3 ? 0.5 : 1;
    ev.push({ midi: SCALE[Math.floor(r0() * 8)], t, d: d * b });
    if (beat % 4 === 0) for (const m of [48, 55]) ev.push({ midi: m, t, d: 4 * b, amp: 0.15, tau: 1.5 });
    t += d * b;
    beat += d;
  }
  const audio = render(ev, SR, { total: 60 });
  const t0 = performance.now();
  const res = transcribe(audio, SR);
  const ms = performance.now() - t0;
  assert.ok(ms < 10000, `${Math.round(ms)} ms`);
  // précision : attaques retrouvées (même hauteur, ±60 ms)
  const used = new Set();
  let ok = 0;
  for (const e of ev) {
    const j = res.notes.findIndex((n, i) => !used.has(i) && n.midi === e.midi && Math.abs(n.startSec - e.t) < 0.06);
    if (j >= 0) { used.add(j); ok++; }
  }
  assert.ok(ok / ev.length > 0.9, `rappel ${ok}/${ev.length}`);
  assert.ok(ok / res.notes.length > 0.9, `précision ${ok}/${res.notes.length}`);
  assert.equal(res.tempo, 120);
});
