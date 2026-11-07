// Non-régression des optimisations de performance : les résultats doivent rester identiques.
// - YIN (detectPitch / detectPitchAdaptive) comparé à une implémentation de référence sans tampons réutilisés ;
// - matchChord / estimateNotes et prepareSong comparés à des empreintes calculées avant optimisation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { detectPitch, detectPitchAdaptive, synthTone, decimate, decimationFactor } from '../../js/core/pitch.js';
import { magnitudeSpectrum, matchChord, estimateNotes } from '../../js/core/spectrum.js';
import { prepareSong } from '../../js/core/song.js';

const sha = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const midiFreq = (m) => 440 * 2 ** ((m - 69) / 12);

/** YIN de référence : calcul complet, tableaux neufs (algorithme d'origine, sans arrêt anticipé). */
function refYin(buf, sampleRate, { threshold = 0.15, minFreq = 27.5, maxFreq = 4200, minRms = 0.01 } = {}) {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  const level = Math.sqrt(s / buf.length);
  if (level < minRms) return null;
  const n = buf.length;
  const maxTau = Math.min(Math.floor(sampleRate / minFreq), Math.floor(n / 2));
  const minTau = Math.max(2, Math.floor(sampleRate / maxFreq));
  const W = n - maxTau;
  if (W < 64 || maxTau <= minTau) return null;
  const cmnd = new Float64Array(maxTau + 2);
  cmnd[0] = 1;
  let running = 0;
  for (let t = 1; t <= maxTau; t++) {
    // même ordre d'accumulation que diffAt (4 accumulateurs) pour un résultat bit à bit identique
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0, j = 0;
    const end4 = W - (W % 4);
    for (; j < end4; j += 4) {
      const a = buf[j] - buf[j + t], b = buf[j + 1] - buf[j + 1 + t], c = buf[j + 2] - buf[j + 2 + t], d = buf[j + 3] - buf[j + 3 + t];
      s0 += a * a; s1 += b * b; s2 += c * c; s3 += d * d;
    }
    for (; j < W; j++) { const a = buf[j] - buf[j + t]; s0 += a * a; }
    const dd = s0 + s1 + s2 + s3;
    running += dd;
    cmnd[t] = running > 0 ? (dd * t) / running : 1;
  }
  let tauEst = -1;
  for (let tau = minTau; tau <= maxTau; tau++) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 <= maxTau && cmnd[tau + 1] < cmnd[tau]) tau++;
      tauEst = tau;
      break;
    }
  }
  if (tauEst === -1) {
    let best = minTau;
    for (let tau = minTau; tau <= maxTau; tau++) if (cmnd[tau] < cmnd[best]) best = tau;
    if (cmnd[best] > 0.35) return null;
    tauEst = best;
  }
  let betterTau = tauEst;
  if (tauEst > 1 && tauEst < maxTau) {
    const a = cmnd[tauEst - 1], b = cmnd[tauEst], c = cmnd[tauEst + 1];
    const denom = 2 * (2 * b - c - a);
    if (denom !== 0) betterTau = tauEst + (c - a) / denom;
  }
  const freq = sampleRate / betterTau;
  if (freq < minFreq * 0.97 || freq > maxFreq * 1.03) return null;
  return { freq, clarity: Math.max(0, Math.min(1, 1 - cmnd[tauEst])), rms: level, tau: betterTau };
}

function signals(sr) {
  const out = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32) - 0.5;
  for (const m of [28, 33, 40, 45, 52, 57, 60, 64, 69, 76, 84, 96, 105]) {
    out.push(synthTone(midiFreq(m), sr, 4096, { harmonics: 5, amp: 0.3 }));
    const noisy = synthTone(midiFreq(m), sr, 4096, { harmonics: 3, amp: 0.2, inharm: 0.0004 });
    for (let i = 0; i < noisy.length; i++) noisy[i] += rnd() * 0.05;
    out.push(noisy);
  }
  out.push(synthTone([midiFreq(60), midiFreq(64), midiFreq(67)], sr, 4096));
  out.push(Float32Array.from({ length: 4096 }, () => rnd() * 0.3)); // bruit
  out.push(new Float32Array(4096)); // silence
  return out;
}

test('perf : detectPitch identique au YIN de référence (tampons réutilisés, tailles variées)', () => {
  for (const sr of [44100, 48000, 16000]) {
    for (const buf of signals(sr)) {
      for (const len of [4096, 2048, 1024]) {
        const b = buf.subarray(buf.length - len);
        for (const opts of [{}, { minFreq: 196, threshold: 0.2 }, { minRms: 0 }]) {
          const ref = refYin(b, sr, opts);
          const got = detectPitch(b, sr, opts);
          if (ref == null || got == null) {
            assert.equal(got, ref);
            continue;
          }
          // l'arrêt anticipé peut s'arrêter avant le calcul complet : même tau, même fréquence
          assert.equal(got.freq, ref.freq, `sr=${sr} len=${len}`);
          assert.equal(got.clarity, ref.clarity);
          assert.equal(got.rms, ref.rms);
        }
      }
    }
  }
});

test('perf : detectPitchAdaptive ne dépend pas de l’ordre des appels (pas d’état partagé visible)', () => {
  const sr = 48000;
  const bufs = signals(sr);
  const first = bufs.map((b) => detectPitchAdaptive(b, sr, { minRms: 0.004 }));
  const again = bufs.slice().reverse().map((b) => detectPitchAdaptive(b, sr, { minRms: 0.004 })).reverse();
  assert.deepEqual(again, first);
  // la décimation dans un tampon fourni donne le même résultat qu'une sortie neuve
  const f = decimationFactor(sr);
  const a = decimate(bufs[3], f);
  const out = new Float32Array(a.length);
  assert.deepEqual(decimate(bufs[3], f, out), a);
  // quelques valeurs attendues (grave corrigé par le contrôle d'octave, aigu par la fenêtre courte)
  for (const m of [40, 57, 69, 84]) {
    const r = detectPitchAdaptive(synthTone(midiFreq(m), sr, 4096, { harmonics: 5 }), sr, { minRms: 0.004 });
    assert.ok(Math.abs(12 * Math.log2(r.freq / 440) + 69 - m) < 0.2, `midi ${m} → ${r.freq}`);
  }
});

test('perf : matchChord / estimateNotes inchangés (empreinte)', () => {
  const sr = 44100;
  const out = {};
  for (const c of [[60, 64, 67], [48, 55, 64], [57, 60, 64, 69], [36, 43], [72, 76, 79, 84]]) {
    const mag = magnitudeSpectrum(synthTone(c.map(midiFreq), sr, 8192, { harmonics: 5 }));
    out[c.join('-')] = { m: matchChord(mag, sr, c), wrong: matchChord(mag, sr, c.map((x) => x + 1)), est: estimateNotes(mag, sr) };
  }
  assert.equal(out['60-64-67'].m.ok, true);
  assert.equal(sha(out), '9d1c9d76c13008b14bd97f76c572fa3bbd25913e6a85f250b82c3ef5f34b8f5f');
});

test('perf : prepareSong inchangé (empreinte, identifiants exclus)', () => {
  const raws = [
    { id: 'joie-sur-la-terre', timeSig: [4, 4], keyFifths: 0, tempo: 84, tracks: { R: 'C5:2:5 B4:1.5:4 A4:0.5:3 | G4:1.5:2 F4:0.5:1 E4:1:3 D4:1:2 | C4:3:1 G4:1:1 | A4:3:2 A4:1:2 | B4:3:3 B4:1:3 | C5:4:4', L: 'C3:4:5 | F3:2:2 G3:2:1 | C3:4:5 | F3:4:2 | G3:4:1 | C3:4:5' } },
    { id: 'stride-do', timeSig: [2, 4], keyFifths: 0, tempo: 72, tracks: { R: 'E4:2 | G4:2 | A4:2 | F4:2 | G4:2 | B4:2 | D5:2 | C5:2', L: 'C2:1 E3+G3+C4:1 | G2:1 E3+G3+C4:1 | F2:1 F3+A3+C4:1 | C2:1 F3+A3+C4:1 | C2:1 E3+G3+C4:1 | G2:1 F3+G3+B3:1 | D2:1 F3+G3+B3:1 | C2:1 E3+G3+C4:1' } },
    { id: 'notes', timeSig: [3, 4], notes: [{ midi: 60, start: 0, dur: 1 }, { midi: 64, start: 1, dur: 1, hand: 'L' }, { midi: 200, start: 2, dur: 1 }, { midi: 67, start: 2, dur: 0 }] },
  ];
  const norm = raws.map((r) => {
    const s = prepareSong(r);
    return { ...s, notes: s.notes.map(({ id, ...n }) => n) };
  });
  assert.equal(norm[0].measureCount, 6);
  assert.equal(sha(norm), GOLDEN_SONGS);
});

const GOLDEN_SONGS = '55ee66e82b6b2a3c84dd7e066591a2496f880c2fe5aca850101f69af2154c95b';
