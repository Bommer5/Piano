import test from 'node:test';
import assert from 'node:assert/strict';
import { nameToMidi, midiToName, midiToFreq, freqToMidi, centsOff, isBlack, spell } from '../../js/core/notes.js';
import { detectPitch, synthTone } from '../../js/core/pitch.js';
import { magnitudeSpectrum, matchChord, estimateNotes } from '../../js/core/spectrum.js';
import { OnsetDetector } from '../../js/core/onset.js';
import { parseTrack, prepareSong, buildEvents, serializeTrack, parseTextSong, songToText, transposeSong, phrases } from '../../js/core/song.js';
import { autoFingering, chordFingers } from '../../js/core/fingering.js';
import { PracticeEngine } from '../../js/core/practice.js';
import { generateSongCourse, countShifts } from '../../js/core/coursegen.js';

test('noms de notes', () => {
  assert.equal(nameToMidi('C4'), 60);
  assert.equal(nameToMidi('A4'), 69);
  assert.equal(nameToMidi('Db4'), 61);
  assert.equal(nameToMidi('Do#4'), 61);
  assert.equal(nameToMidi('Ré4'), 62);
  assert.equal(nameToMidi('Sib3'), 58);
  assert.equal(nameToMidi('sol2'), 43);
  assert.equal(nameToMidi('B#3'), 60);
  assert.equal(nameToMidi('H4'), null);
  assert.equal(nameToMidi('C'), null);
  assert.equal(midiToName(60), 'Do4');
  assert.equal(midiToName(61, { lang: 'en' }), 'C#4');
  assert.equal(midiToName(61, { lang: 'en', flats: true }), 'Db4');
  assert.ok(isBlack(61) && !isBlack(60));
  assert.equal(spell(61).alter, 1);
  assert.equal(spell(61, true).alter, -1);
});

test('fréquences', () => {
  assert.equal(midiToFreq(69), 440);
  assert.equal(freqToMidi(261.63), 60);
  assert.ok(Math.abs(centsOff(445, 69)) - 19.6 < 0.1);
  assert.equal(freqToMidi(442, 442), 69);
});

test('YIN détecte la hauteur sur toute la tessiture usuelle', () => {
  const sr = 44100;
  for (const m of [33, 40, 48, 55, 60, 64, 69, 76, 84, 96]) {
    const r = detectPitch(synthTone(midiToFreq(m), sr, 4096), sr);
    assert.ok(r, `pas de détection pour ${m}`);
    assert.equal(Math.round(69 + 12 * Math.log2(r.freq / 440)), m, `midi ${m}`);
  }
});

test('YIN : silence et bruit -> null', () => {
  assert.equal(detectPitch(new Float32Array(4096), 44100), null);
  const noise = new Float32Array(4096).map(() => (Math.random() - 0.5) * 0.4);
  const r = detectPitch(noise, 44100);
  assert.ok(r === null || r.clarity < 0.8);
});

test('vérification d’accords par spectre', () => {
  const sr = 44100;
  const mag = magnitudeSpectrum(synthTone([261.63, 329.63, 392], sr, 8192));
  assert.ok(matchChord(mag, sr, [60, 64, 67]).ok);
  assert.deepEqual(matchChord(mag, sr, [60, 63, 67]).missing, [63]);
  assert.deepEqual(matchChord(mag, sr, [62, 65]).present, []);
  const est = estimateNotes(mag, sr);
  for (const m of [60, 64, 67]) assert.ok(est.includes(m), `estimateNotes manque ${m}: ${est}`);
});

test('détection d’attaques : note répétée re-déclenchée', () => {
  const d = new OnsetDetector();
  const onsets = [];
  let t = 0;
  const feed = (rms, midi, n) => { for (let i = 0; i < n; i++) { const r = d.push({ t: (t += 35), rms, midi, clarity: 0.95 }); if (r.onset != null) onsets.push(r.onset); } };
  feed(0.001, null, 5);
  feed(0.2, 60, 6); // attaque Do
  feed(0.08, 60, 6); // résonance
  feed(0.25, 60, 4); // nouvelle attaque même note
  feed(0.2, 62, 4); // Ré
  assert.deepEqual(onsets, [60, 60, 62]);
});

test('notation compacte', () => {
  const { notes, length } = parseTrack('C4:1:1 r:1 E4+G4:2:3+5 | Bb3:1/2', 'R');
  assert.equal(notes.length, 4);
  assert.equal(length, 4.5);
  assert.deepEqual(notes.map((n) => n.start), [0, 2, 2, 4]);
  assert.equal(notes[1].finger, 3);
  assert.equal(notes[2].finger, 5);
  assert.equal(notes[3].midi, 58);
  assert.throws(() => parseTrack('X4:1'), /Note inconnue/);
  assert.throws(() => parseTrack('C4:0'), /Durée invalide/);
  const txt = serializeTrack(notes);
  const again = parseTrack(txt, 'R').notes;
  assert.deepEqual(again.map((n) => [n.midi, n.start, n.dur, n.finger]), notes.map((n) => [n.midi, n.start, n.dur, n.finger]));
});

test('prepareSong + événements + phrases', () => {
  const s = prepareSong({ title: 't', timeSig: [3, 4], tracks: { R: 'C4 D4 E4 | F4:3', L: 'C3:3 | F3:3' } });
  assert.equal(s.beatsPerMeasure, 3);
  assert.equal(s.measureCount, 2);
  assert.ok(s.notes.every((n) => n.finger >= 1 && n.finger <= 5));
  const ev = buildEvents(s);
  assert.equal(ev.length, 4);
  assert.deepEqual(ev[0].midis.sort(), [48, 60]);
  assert.equal(buildEvents(s, { hands: 'R' }).length, 4);
  assert.equal(buildEvents(s, { from: 3 }).length, 1);
  assert.equal(phrases(s, 1).length, 2);
  const t = transposeSong(s, 2);
  assert.equal(t.notes[0].midi, s.notes[0].midi + 2);
});

test('format texte : aller-retour', () => {
  const raw = parseTextSong('titre: Test\ntempo: 100\nmesure: 3/4\nMD: C4:1:1 D4:1:2 E4:1:3\nMG: C3:3:5\n');
  assert.equal(raw.title, 'Test');
  assert.deepEqual(raw.timeSig, [3, 4]);
  const s = prepareSong(raw);
  const back = prepareSong(parseTextSong(songToText(s)));
  assert.deepEqual(back.notes.map((n) => [n.midi, n.start, n.dur, n.hand, n.finger]), s.notes.map((n) => [n.midi, n.start, n.dur, n.hand, n.finger]));
});

test('doigté automatique : gamme de Do main droite avec passage du pouce', () => {
  const s = prepareSong({ tracks: { R: 'C4 D4 E4 F4 G4 A4 B4 C5' } });
  const f = s.notes.map((n) => n.finger);
  assert.equal(f[0], 1);
  // pas deux fois le même doigt d'affilée sur des notes différentes
  for (let i = 1; i < f.length; i++) assert.notEqual(f[i], f[i - 1]);
  assert.ok(f.includes(1, 1), 'le pouce doit repasser');
});

test('doigté automatique : position de Do à 5 doigts', () => {
  const s = prepareSong({ tracks: { R: 'C4 D4 E4 F4 G4 F4 E4 D4 C4', L: 'C3 D3 E3 F3 G3' } });
  assert.deepEqual(s.notes.filter((n) => n.hand === 'R').map((n) => n.finger), [1, 2, 3, 4, 5, 4, 3, 2, 1]);
  assert.deepEqual(s.notes.filter((n) => n.hand === 'L').map((n) => n.finger), [5, 4, 3, 2, 1]);
});

test('doigtés d’accords', () => {
  assert.deepEqual(chordFingers([60, 64, 67]), [1, 3, 5]);
  assert.deepEqual(chordFingers([60, 67]), [1, 5]);
  const notes = [{ midi: 48, start: 0, dur: 1 }, { midi: 52, start: 0, dur: 1 }, { midi: 55, start: 0, dur: 1 }];
  autoFingering(notes, 'L');
  assert.deepEqual(notes.map((n) => n.finger), [5, 3, 1]);
});

test('moteur : mode attente', () => {
  const s = prepareSong({ tracks: { R: 'C4 D4 E4+G4:2', L: 'C3:4' } });
  const e = new PracticeEngine(s, { hands: 'R' });
  assert.equal(e.input(62).type, 'wrong');
  assert.equal(e.input(60).type, 'advance');
  assert.equal(e.input(60).type, 'ignored'); // l'accord précédent qui résonne n'est pas une faute
  assert.equal(e.input(62).type, 'advance');
  assert.equal(e.input(64).partial, true);
  assert.equal(e.input(67).type, 'finish');
  const sum = e.summary();
  assert.equal(sum.hits, 4); // chaque note juste compte (accord Mi+Sol = 2)
  assert.equal(sum.wrong, 1);
  assert.equal(sum.score, 80);
});

test('moteur : tolérance d’octave', () => {
  const s = prepareSong({ tracks: { R: 'C4 D4' } });
  const e = new PracticeEngine(s, { octaveTolerant: true });
  assert.equal(e.input(72).type, 'advance');
  const e2 = new PracticeEngine(s);
  assert.equal(e2.input(72).type, 'wrong');
});

test('moteur : mode tempo (justesse + rythme + manquées)', () => {
  const s = prepareSong({ tempo: 60, tracks: { R: 'C4 D4 E4 F4' } });
  const e = new PracticeEngine(s, { mode: 'tempo' });
  assert.equal(e.input(60, 0.02).grade, 'perfect');
  const r = e.input(62, 1.3); // à 60 BPM : parfait ±0.1 s, bien ±0.2 s, ok ±0.35 s
  assert.equal(r.grade, 'ok');
  assert.ok(r.delta > 0.29);
  assert.equal(e.input(70, 2.0).type, 'wrong');
  assert.equal(e.input(64, 2.6).type, 'offtime'); // bonne note mais trop tard : pas une fausse note
  const missed = e.tick(3.5); // Mi (2 s) raté, Fa (3 s) aussi
  assert.deepEqual(missed.map((n) => n.midi), [64, 65]);
  e.tick(10);
  assert.ok(e.finished);
  const sum = e.summary();
  assert.equal(sum.hits, 2);
  assert.equal(sum.misses, 2);
  assert.equal(sum.wrong, 1);
});

test('fenêtres de rythme proportionnelles au tempo', async () => {
  const { judgeWindows } = await import('../../js/core/practice.js');
  const slow = judgeWindows(2), fast = judgeWindows(0.3);
  assert.ok(slow.perfect > fast.perfect);
  assert.ok(fast.ok >= 0.1 && slow.ok <= 0.35);
});

test('transposition : armure et doigtés jouables', async () => {
  const { transposeKey } = await import('../../js/core/song.js');
  assert.equal(transposeKey(0, 2), 2); // Do -> Ré
  assert.equal(transposeKey(0, 5), -1); // Do -> Fa
  assert.equal(transposeKey(0, 1), -5); // Do -> Ré bémol
  const s = prepareSong({ tracks: { R: 'C4:1:1 D4:1:2 E4:1:3' } });
  const t = transposeSong(s, 1); // Do#: pouce sur touche noire -> doigté recalculé
  assert.ok(t.notes.every((n) => n.finger >= 1 && n.finger <= 5));
  assert.equal(t.keyFifths, -5);
});

test('renversements d’accords : doigtés corrects', () => {
  assert.deepEqual(chordFingers([64, 67, 72]), [1, 2, 5]); // Mi-Sol-Do (1er renversement)
  assert.deepEqual(chordFingers([67, 72, 76]), [1, 3, 5]); // Sol-Do-Mi (2e renversement)
});

test('date locale (pas UTC) pour la série de jours', async () => {
  const { localDate } = await import('../../js/core/storage.js');
  assert.equal(localDate(new Date(2026, 0, 5, 0, 30)), '2026-01-05');
});

test('moteur : intervalle de mesures', () => {
  const s = prepareSong({ tracks: { R: 'C4:4 D4:4 E4:4' } });
  const e = new PracticeEngine(s, { from: 4, to: 8 });
  assert.equal(e.events.length, 1);
  assert.equal(e.input(62).type, 'finish');
});

test('cours généré pour un morceau', () => {
  const s = prepareSong({ title: 'x', tracks: { R: 'C4 D4 E4 F4 '.repeat(8), L: 'C3:4 '.repeat(8) } });
  const steps = generateSongCourse(s);
  assert.equal(steps[0].mode, 'listen');
  assert.ok(steps.some((st) => st.hands === 'L'));
  assert.ok(steps.some((st) => st.hands === 'both' && st.mode === 'wait'));
  assert.equal(steps[steps.length - 1].tempoPct, 100);
  assert.equal(countShifts([{ midi: 60, finger: 1, start: 0, hand: 'R' }, { midi: 62, finger: 1, start: 1, hand: 'R' }]), 1);
});
