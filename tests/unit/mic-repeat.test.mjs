// Le micro doit compter correctement les notes RÉPÉTÉES (même touche plusieurs fois) : une frappe = une note.
// Régression : l'ancien détecteur comptait la première frappe deux fois puis ratait les suivantes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { piano, run, CASES } from '../helpers/piano-sim.mjs';
import { TransientDetector, OnsetDetector, resolveMicNote } from '../../js/core/onset.js';
import { plausibleFundamental } from '../../js/core/micanalyser.js';
import { synthTone } from '../../js/core/pitch.js';

const CONFIGS = [[48000, 32], [44100, 24]];

for (const [name, seq, o] of CASES) {
  test(`micro : ${name}`, () => {
    for (const [sr, hopMs] of CONFIGS) {
      const on = run(piano(seq, sr, o), sr, { hopMs });
      if (o?.lenient) {
        // Cas limite assumé (pédale tenue, notes voisines qui résonnent toutes ensemble) : une frappe peut ne pas
        // être reconnue, mais JAMAIS de fausse note ni de note comptée deux fois.
        assert.ok(on.length >= seq.length - o.lenient && on.length <= seq.length, `${on.length} notes pour ${seq.length} frappes`);
        for (const x of on) {
          const strike = seq.find((n) => Math.abs(n.t * 1000 - x.t) < 15);
          assert.ok(strike && resolveMicNote(x.midi, [strike.midi]).midi === strike.midi, `fausse note ${JSON.stringify(x)}`);
        }
        continue;
      }
      const got = on.map((x, i) => (seq[i] ? resolveMicNote(x.midi, [seq[i].midi]).midi : x.midi));
      assert.deepEqual(got, seq.map((x) => x.midi), `${sr} Hz, trame ${hopMs} ms : ${JSON.stringify(on)}`);
      // l'instant rapporté est celui de la frappe (à 15 ms près), pas celui de la confirmation
      on.forEach((x, i) => assert.ok(Math.abs(x.t - seq[i].t * 1000) < 15, `instant de frappe ${x.t} vs ${seq[i].t * 1000}`));
      // la note est confirmée en moins de 300 ms (l'instant rapporté reste celui de la frappe)
      on.forEach((x) => assert.ok(x.at - x.t < 300, `confirmation trop lente : ${x.at - x.t} ms`)); // le grave demande une fenêtre plus longue
    }
  });
}

test('micro : niveau d’enregistrement faible ou fort (gain ×0,1 à ×1,8)', () => {
  const seq = [60, 60, 60, 62, 62].map((m, k) => ({ midi: m, t: 0.3 + k * 0.35 }));
  for (const gain of [0.1, 0.3, 1.8]) {
    const on = run(piano(seq, 48000, { gain, noise: 0.0006 }), 48000);
    assert.deepEqual(on.map((x) => x.midi), seq.map((x) => x.midi), `gain ${gain}`);
  }
});

test('micro : bruit de fond seul et silence → aucune note', () => {
  const sr = 48000;
  let seed = 3;
  const noise = new Float32Array(sr * 3).map(() => (((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1) * 0.01);
  assert.equal(run(noise, sr).length, 0);
  assert.equal(run(new Float32Array(sr * 2), sr).length, 0);
});

test('détecteur de frappes : un son tenu (même grave) ne déclenche rien', () => {
  for (const f of [27.5, 55, 110, 440, 1760]) {
    const td = new TransientDetector(48000);
    let n = 0;
    const tone = synthTone(f, 48000, 48000 * 2, { harmonics: 6 });
    for (let i = 4800; i + 128 <= tone.length; i += 128) td.push(tone.subarray(i, i + 128), () => n++);
    assert.equal(n, 0, `faux déclenchement à ${f} Hz`);
  }
});

test('repli sans détecteur de frappes : une frappe dont le volume monte sur 3 trames ne compte qu’une fois', () => {
  const d = new OnsetDetector();
  const onsets = [];
  let t = 0;
  const feed = (rms, midi) => { const r = d.push({ t: (t += 32), rms, midi, clarity: 0.95 }); if (r.onset != null) onsets.push(r.onset); };
  for (let i = 0; i < 5; i++) feed(0.001, null);
  for (const rms of [0.05, 0.12, 0.2, 0.2, 0.18, 0.16, 0.15, 0.14]) feed(rms, 60); // montée progressive d'UNE frappe
  assert.deepEqual(onsets, [60]);
});

test('parents harmoniques ramenés à la note attendue', () => {
  assert.deepEqual(resolveMicNote(60, [60]), { midi: 60, confusable: false });
  assert.equal(resolveMicNote(48, [60]).midi, 60); // octave en dessous
  assert.equal(resolveMicNote(24, [43]).midi, 43); // sous-harmonique d'un mélange
  assert.equal(resolveMicNote(72, [60]).midi, 60); // harmonique 2
  assert.equal(resolveMicNote(79, [60]).midi, 60); // harmonique 3
  assert.deepEqual(resolveMicNote(61, [60]), { midi: 61, confusable: false }); // vraie fausse note
  assert.deepEqual(resolveMicNote(65, [60, 64]), { midi: 65, confusable: false });
});

test('fausse fondamentale : Mi4 + Sol4 ne sont pas un Do2', () => {
  const sr = 48000;
  const mix = synthTone([329.63, 392], sr, 4096, { harmonics: 5 });
  assert.equal(plausibleFundamental(mix, sr, 65.41), false);
  assert.equal(plausibleFundamental(synthTone(65.41, sr, 4096, { harmonics: 8 }), sr, 65.41), true);
});
