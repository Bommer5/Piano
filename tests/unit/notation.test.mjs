// Tests de la notation fidèle : orthographe tonale, altérations, découpage des durées, silences,
// ligatures, triolets, choix de portée, et champs de notation des parseurs (MusicXML / ABC / MIDI).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spell, spelledName, noteLabel, midiToName, spellFrom, tonalLof } from '../../js/core/notes.js';
import {
  estimateKey, estimateMode, keySignatureAlters, keyName, songKey, spellNote, melodicDirections, measureNumber, beatUnit,
  decompose, splitNote, snapDuration, restsInMeasure, computeAccidentals, beamGroups, tupletGroups, assignStaves,
  chordSymbol, fifthsOfTonic,
} from '../../js/core/notation.js';
import { parseMusicXML, exportMusicXML } from '../../js/parsers/musicxml.js';
import { parseABC } from '../../js/parsers/abc.js';
import { parseMidi, exportMidi } from '../../js/parsers/midi.js';
import { prepareSong } from '../../js/core/song.js';

const name = (midi, f, mode, dir) => spelledName(spell(midi, f, mode, dir), { lang: 'fr' });
const types = (pieces) => pieces.map((p) => p.type + '.'.repeat(p.dots) + (p.tuplet ? '³' : ''));

// ---------------------------------------------------------------------------
// Orthographe
// ---------------------------------------------------------------------------

test('spell : forme historique spell(midi, preferFlats) inchangée', () => {
  assert.deepEqual(spell(61), { step: 0, octave: 4, alter: 1, diatonic: 28 });
  assert.deepEqual(spell(61, true), { step: 1, octave: 4, alter: -1, diatonic: 29 });
  assert.deepEqual(spell(60, false), { step: 0, octave: 4, alter: 0, diatonic: 28 });
});

test('spell : orthographe tonale (sensible en mineur, Mi♯/Si♯/Do♭/Fa♭, chromatismes)', () => {
  assert.equal(name(61, -1, 'minor'), 'Do♯4'); // ré mineur : sensible
  assert.equal(name(66, -2, 'minor'), 'Fa♯4'); // sol mineur : sensible
  assert.equal(name(70, -1, 'minor'), 'Si♭4'); // ré mineur : Si♭ de l'armure
  assert.equal(name(71, -1, 'minor'), 'Si4'); // 6e degré haussé (mineur mélodique)
  assert.equal(name(65, 6), 'Mi♯4'); // Fa♯ majeur
  assert.equal(name(72, 7), 'Si♯4'); // Do♯ majeur : Si♯ (octave écrite 4)
  assert.equal(name(71, -6), 'Do♭5'); // Sol♭ majeur
  assert.equal(name(64, -7), 'Fa♭4'); // Do♭ majeur
  assert.equal(name(67, 5, 'minor'), 'Fa𝄪4'); // sol♯ mineur : sensible double dièse
  assert.equal(name(63, 0), 'Mi♭4'); // Do majeur, chromatisme isolé
  assert.equal(name(66, 0), 'Fa♯4');
  assert.equal(name(63, 0, 'major', 1), 'Ré♯4'); // note de passage montante (Ré♯ → Mi)
  assert.equal(name(61, 0, 'major', -1), 'Ré♭4'); // descendante
  assert.equal(name(68, 2), 'Sol♯4'); // Ré majeur
  // la hauteur MIDI est toujours respectée
  for (let f = -7; f <= 7; f++) {
    for (let m = 48; m < 84; m++) {
      for (const mode of ['major', 'minor']) {
        const sp = spell(m, f, mode);
        assert.equal((sp.octave + 1) * 12 + [0, 2, 4, 5, 7, 9, 11][sp.step] + sp.alter, m);
        assert.ok(Math.abs(sp.alter) <= 2);
        assert.equal(sp.diatonic, sp.octave * 7 + sp.step);
      }
    }
  }
  assert.ok(Number.isInteger(tonalLof(60, 0)));
});

test('spellFrom / spellNote : l’orthographe d’origine est prioritaire si elle correspond', () => {
  assert.deepEqual(spellFrom(60, { step: 'B', alter: 1 }), { step: 6, octave: 3, alter: 1, diatonic: 27 });
  assert.equal(spellFrom(61, { step: 'B', alter: 1 }), null); // incohérente (ex. après transposition)
  assert.equal(spellNote({ midi: 63, spelling: { step: 'D', alter: 1 } }, { fifths: -3, mode: 'major' }).step, 1);
  assert.equal(spellNote({ midi: 63 }, { fifths: -3, mode: 'major' }).step, 2); // Mi♭ en Mi♭ majeur
});

test('melodicDirections : sens chromatique vers la note suivante, par main', () => {
  const notes = [
    { id: 1, midi: 76, start: 0, hand: 'R' },
    { id: 2, midi: 75, start: 0.25, hand: 'R' },
    { id: 3, midi: 76, start: 0.5, hand: 'R' },
    { id: 4, midi: 50, start: 0, hand: 'L' },
    { id: 5, midi: 49, start: 1, hand: 'L' },
  ];
  const d = melodicDirections(notes);
  assert.equal(d.get(2), 1);
  assert.equal(d.get(1), -1);
  assert.equal(d.get(4), -1);
  assert.equal(d.get(5), 0);
});

test('octaveStyle : Do4 international ou Do3 (conservatoires français)', () => {
  assert.equal(midiToName(60), 'Do4');
  assert.equal(midiToName(60, { octaveStyle: 'fr' }), 'Do3');
  assert.equal(noteLabel(60, {}), 'Do4');
  assert.equal(noteLabel(60, { octaveStyle: 'fr' }), 'Do3');
  assert.equal(noteLabel(69, { notation: 'en', octaveStyle: 'fr' }), 'A3');
  assert.equal(noteLabel(61, { octaveStyle: 'fr' }, spell(61, -1)), 'Ré♭3');
  assert.equal(noteLabel(60, { octave: false }), 'Do');
});

// ---------------------------------------------------------------------------
// Tonalité
// ---------------------------------------------------------------------------

test('tonalité : armure, nom, estimation (Krumhansl) et mode', () => {
  assert.deepEqual(keySignatureAlters(2), [1, 0, 0, 1, 0, 0, 0]);
  assert.deepEqual(keySignatureAlters(-3), [0, 0, -1, 0, 0, -1, -1]);
  assert.equal(keyName(-1, 'minor'), 'Ré mineur');
  assert.equal(keyName(-2, 'major'), 'Si♭ majeur');
  assert.equal(keyName(6, 'major'), 'Fa♯ majeur');
  assert.equal(fifthsOfTonic(2, 'minor'), -1);
  const scale = (tonic, steps) => steps.map((s, i) => ({ midi: tonic + s, dur: i === 0 ? 2 : 1 }));
  const dMinor = [...scale(62, [0, 2, 3, 5, 7, 8, 10, 11, 12]), { midi: 62, dur: 4 }, { midi: 69, dur: 2 }, { midi: 65, dur: 2 }];
  assert.deepEqual([estimateKey(dMinor).fifths, estimateKey(dMinor).mode], [-1, 'minor']);
  const gMajor = [...scale(67, [0, 2, 4, 5, 7, 9, 11, 12]), { midi: 67, dur: 4 }, { midi: 62, dur: 2 }, { midi: 71, dur: 2 }];
  assert.deepEqual([estimateKey(gMajor).fifths, estimateKey(gMajor).mode], [1, 'major']);
  assert.equal(estimateMode(dMinor, -1), 'minor');
  assert.equal(estimateMode(scale(65, [0, 2, 4, 5, 7, 9, 10, 12]), -1), 'major');
  assert.deepEqual(songKey({ keyFifths: 3, keyMode: 'minor', notes: [] }), { fifths: 3, mode: 'minor' });
  assert.equal(estimateKey([]).fifths, 0);
});

test('numéro de mesure : levée = mesure 0', () => {
  assert.equal(measureNumber(0, 4), 1);
  assert.equal(measureNumber(4, 4), 2);
  assert.equal(measureNumber(0, 3, 1), 0);
  assert.equal(measureNumber(3, 3, 1), 1);
  assert.equal(beatUnit([6, 8]), 1.5);
  assert.equal(beatUnit([3, 4]), 1);
});

// ---------------------------------------------------------------------------
// Durées
// ---------------------------------------------------------------------------

test('decompose : valeurs écrivables liées (2,5 = blanche + croche)', () => {
  assert.deepEqual(types(decompose(1)), ['quarter']);
  assert.deepEqual(types(decompose(1.5)), ['quarter.']);
  assert.deepEqual(types(decompose(2.5)), ['half', 'eighth']);
  assert.deepEqual(types(decompose(5)), ['whole', 'quarter']);
  assert.deepEqual(types(decompose(3)), ['half.']);
  assert.deepEqual(types(decompose(1 / 3)), ['eighth³']);
  assert.deepEqual(types(decompose(2 / 3)), ['quarter³']);
  assert.deepEqual(types(decompose(5 / 3)), ['quarter', 'quarter³']);
  const odd = decompose(0.47);
  assert.ok(odd.length >= 1);
  assert.equal(snapDuration(0.96), 1);
  assert.equal(snapDuration(0.49), 0.5);
});

test('splitNote : coupure aux barres de mesure avec liaisons', () => {
  const p = splitNote(3, 2.5, 4);
  assert.deepEqual(p.map((x) => [x.start, x.dur, x.type, x.dots, x.tieStart, x.tieStop]), [
    [3, 1, 'quarter', 0, true, false],
    [4, 1.5, 'quarter', 1, false, true],
  ]);
  const q = splitNote(0, 2.5, 4);
  assert.deepEqual(types(q), ['half', 'eighth']);
  assert.ok(q[0].tieStart && q[1].tieStop);
  const r = splitNote(2, 7, 3); // traverse deux barres en 3/4
  assert.deepEqual(r.map((x) => x.start), [2, 3, 6]);
  assert.equal(r.reduce((s, x) => s + x.dur, 0), 7);
  assert.deepEqual(splitNote(0, 1, 4).map((x) => [x.tieStart, x.tieStop]), [[false, false]]);
});

// ---------------------------------------------------------------------------
// Silences
// ---------------------------------------------------------------------------

test('silences : pause, demi-pause, soupir, demi-soupir, alignés sur les temps', () => {
  assert.deepEqual(restsInMeasure([], 4, 4), [{ start: 4, dur: 4, type: 'whole', dots: 0, whole: true }]);
  assert.deepEqual(restsInMeasure([], 0, 3), [{ start: 0, dur: 3, type: 'whole', dots: 0, whole: true }]); // pause = mesure entière
  const r = restsInMeasure([[0, 1], [2.5, 3]], 0, 4).map((x) => [x.start, x.type]);
  assert.deepEqual(r, [[1, 'quarter'], [2, 'eighth'], [3, 'quarter']]);
  assert.deepEqual(restsInMeasure([[0, 2]], 0, 4).map((x) => [x.start, x.type]), [[2, 'half']]);
  // pas de demi-pause à cheval sur le milieu de la mesure
  assert.deepEqual(restsInMeasure([[0, 1], [3, 4]], 0, 4).map((x) => [x.start, x.type]), [[1, 'quarter'], [2, 'quarter']]);
  assert.deepEqual(restsInMeasure([[0, 3.75]], 0, 4).map((x) => x.type), ['16th']);
  // temps composé : soupir pointé
  assert.deepEqual(restsInMeasure([[0, 1.5]], 0, 3, { beat: 1.5 }).map((x) => [x.start, x.type, x.dots]), [[1.5, 'quarter', 1]]);
  // levée : rien avant le début de la levée
  assert.deepEqual(restsInMeasure([[2, 3]], 0, 3, { from: 2 }), []);
});

// ---------------------------------------------------------------------------
// Altérations
// ---------------------------------------------------------------------------

test('altérations : valables pour la mesure, bécarres et rappels', () => {
  const sp = (step, octave, alter) => ({ step, octave, alter });
  const it = (measure, s, staff = 'treble', tieStop = false) => ({ measure, staff, sp: s, tieStop });
  const res = computeAccidentals([
    it(0, sp(3, 4, 1)), // Fa♯ : dièse
    it(0, sp(3, 4, 1)), // répété : rien
    it(0, sp(3, 5, 0)), // Fa5 naturel, même mesure : rappel (autre octave altérée)
    it(0, sp(3, 4, 0)), // Fa4 naturel : bécarre
    it(1, sp(3, 4, 0)), // mesure suivante : rien (dernier état = naturel)
    it(1, sp(6, 4, -1)), // Si♭ : bémol
    it(2, sp(6, 4, 0)), // mesure suivante : bécarre de rappel
    it(2, sp(3, 4, 1), 'bass'), // autre portée : indépendante
  ], 0);
  assert.deepEqual(res, [
    { alter: 1, courtesy: false }, null, { alter: 0, courtesy: true }, { alter: 0, courtesy: false },
    null, { alter: -1, courtesy: false }, { alter: 0, courtesy: true }, { alter: 1, courtesy: false },
  ]);
  // armure : Fa♯ en Sol majeur ne s'écrit pas, Fa naturel prend un bécarre
  assert.deepEqual(computeAccidentals([it(0, sp(3, 4, 1)), it(0, sp(3, 4, 0))], 1), [null, { alter: 0, courtesy: false }]);
  // note liée à travers la barre : pas d'altération répétée
  assert.deepEqual(computeAccidentals([it(0, sp(0, 5, 1)), it(1, sp(0, 5, 1), 'treble', true), it(1, sp(0, 5, 1))], 0), [
    { alter: 1, courtesy: false }, null, { alter: 1, courtesy: false },
  ]);
});

// ---------------------------------------------------------------------------
// Ligatures, triolets, portées
// ---------------------------------------------------------------------------

test('ligatures : croches et doubles regroupées par temps', () => {
  const ev = [
    { start: 0, dur: 0.5, type: 'eighth' }, { start: 0.5, dur: 0.5, type: 'eighth' },
    { start: 1, dur: 0.5, type: 'eighth' }, { start: 1.5, dur: 0.5, type: 'eighth', rest: true },
    { start: 2, dur: 0.25, type: '16th' }, { start: 2.25, dur: 0.25, type: '16th' }, { start: 2.5, dur: 0.5, type: 'eighth' },
    { start: 3, dur: 1, type: 'quarter' },
  ];
  assert.deepEqual(beamGroups(ev, { beat: 1, measureLen: 4 }), [[0, 1], [4, 5, 6]]);
  // 6/8 : groupes par noire pointée
  const six = [0, 0.5, 1, 1.5, 2, 2.5].map((s) => ({ start: s, dur: 0.5, type: 'eighth' }));
  assert.deepEqual(beamGroups(six, { beat: 1.5, measureLen: 3 }), [[0, 1, 2], [3, 4, 5]]);
  // voix séparées
  const two = [{ start: 0, dur: 0.5, type: 'eighth', voice: 0 }, { start: 0, dur: 0.5, type: 'eighth', voice: 1 }, { start: 0.5, dur: 0.5, type: 'eighth', voice: 0 }];
  assert.deepEqual(beamGroups(two, { beat: 1, measureLen: 4 }), [[0, 2]]);
});

test('triolets : groupes de 3 valeurs', () => {
  const t = [0, 1 / 3, 2 / 3, 1, 4 / 3, 5 / 3].map((s) => ({ start: s, dur: 1 / 3, tuplet: true, type: 'eighth' }));
  assert.deepEqual(tupletGroups(t), [[0, 1, 2], [3, 4, 5]]);
  const q = [0, 2 / 3, 4 / 3].map((s) => ({ start: s, dur: 2 / 3, tuplet: true }));
  assert.deepEqual(tupletGroups(q), [[0, 1, 2]]);
  assert.deepEqual(tupletGroups([{ start: 0, dur: 1 }]), []);
});

test('choix de la portée : staff MusicXML, main, bascule automatique par accord', () => {
  const m = assignStaves([
    { id: 1, midi: 70, hand: 'L', start: 0 }, // main gauche très haute → clé de sol
    { id: 2, midi: 74, hand: 'L', start: 0 },
    { id: 3, midi: 48, hand: 'L', start: 1 },
    { id: 4, midi: 50, hand: 'R', start: 0 }, // main droite très basse → clé de fa
    { id: 5, midi: 60, hand: 'R', start: 1, staff: 2 }, // portée imposée
    { id: 6, midi: 62, hand: 'R', start: 2 },
    { id: 7, midi: 60, hand: 'L', start: 3 }, // Do4 main gauche : reste en clé de fa
  ]);
  assert.deepEqual([...m.entries()].sort((a, b) => a[0] - b[0]).map((x) => x[1]), ['treble', 'treble', 'bass', 'bass', 'bass', 'treble', 'bass']);
});

test('symboles d’accords', () => {
  assert.equal(chordSymbol({ root: 'D', kind: 'minor-seventh' }), 'Dm7');
  assert.equal(chordSymbol({ root: 'G', kind: 'dominant', bass: 'B' }), 'G7/B');
  assert.equal(chordSymbol({ root: 'B', rootAlter: -1, kind: 'major-seventh' }), 'B♭maj7');
  assert.equal(chordSymbol({ root: 'C', kind: 'major', text: '' }), 'C');
  assert.equal(chordSymbol({ root: 'F', rootAlter: 1, kind: 'half-diminished', text: 'ø7' }), 'F♯ø7');
  assert.equal(chordSymbol({ kind: 'none' }), 'N.C.');
});

// ---------------------------------------------------------------------------
// Parseurs : champs de notation
// ---------------------------------------------------------------------------

const RICH_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="0" implicit="yes">
      <attributes><divisions>2</divisions><key><fifths>-1</fifths><mode>minor</mode></key>
        <time><beats>3</beats><beat-type>4</beat-type></time><staves>2</staves></attributes>
      <direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>80</per-minute></metronome></direction-type><sound tempo="80"/></direction>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
    </measure>
    <measure number="1">
      <harmony><root><root-step>D</root-step></root><kind text="m7">minor-seventh</kind></harmony>
      <direction placement="below"><direction-type><dynamics><mf/></dynamics></direction-type><staff>1</staff></direction>
      <direction placement="below"><direction-type><wedge type="crescendo"/></direction-type><staff>1</staff></direction>
      <direction placement="below"><direction-type><pedal type="start"/></direction-type><staff>2</staff></direction>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type><staff>1</staff>
        <notations><slur type="start" number="1"/><articulations><accent/></articulations></notations></note>
      <note><pitch><step>C</step><alter>1</alter><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type><staff>1</staff>
        <notations><articulations><staccato/></articulations></notations></note>
      <direction><direction-type><wedge type="stop"/></direction-type><offset>0</offset></direction>
      <harmony><root><root-step>G</root-step></root><kind>dominant</kind><bass><bass-step>B</bass-step></bass></harmony>
      <note><pitch><step>E</step><alter>1</alter><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type><staff>1</staff>
        <notations><slur type="stop" number="1"/><articulations><tenuto/></articulations></notations></note>
      <backup><duration>6</duration></backup>
      <note><pitch><step>D</step><octave>3</octave></pitch><duration>6</duration><voice>5</voice><type>half</type><dot/><staff>2</staff></note>
    </measure>
    <measure number="2">
      <direction><direction-type><pedal type="stop"/></direction-type><staff>2</staff></direction>
      <direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>100</per-minute></metronome></direction-type><sound tempo="100"/></direction>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>6</duration><voice>1</voice><type>half</type><dot/><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`;

test('musicxml : mode, orthographe, portée, accords, nuances, pédale, liaisons, articulations, tempo, levée', () => {
  const s = parseMusicXML(RICH_XML);
  assert.equal(s.keyFifths, -1);
  assert.equal(s.keyMode, 'minor');
  assert.equal(s.pickupBeats, 1);
  const byMidi = (m) => s.notes.find((n) => n.midi === m);
  assert.deepEqual(byMidi(77).spelling, { step: 'E', alter: 1 }); // Mi♯ conservé (pas Fa)
  assert.deepEqual(byMidi(73).spelling, { step: 'C', alter: 1 });
  assert.equal(byMidi(50).staff, 2);
  assert.equal(byMidi(69).staff, 1);
  assert.equal(s.notes.find((n) => n.midi === 74 && n.start === 3).slur, 'start');
  assert.equal(byMidi(77).slur, 'stop');
  assert.deepEqual(s.notes.find((n) => n.midi === 74 && n.start === 3).articulations, ['accent']);
  assert.deepEqual(byMidi(73).articulations, ['staccato']);
  assert.deepEqual(byMidi(77).articulations, ['tenuto']);
  assert.deepEqual(s.chords, [{ beat: 3, symbol: 'Dm7' }, { beat: 5, symbol: 'G7/B' }]);
  assert.deepEqual(s.dynamics, [{ beat: 3, mark: 'mf' }, { beat: 3, mark: 'cresc', end: 5 }]);
  assert.deepEqual(s.pedal, [{ beat: 3, down: true }, { beat: 6, down: false }]);
  assert.deepEqual(s.tempoMap, [{ beat: 0, bpm: 80 }, { beat: 6, bpm: 100 }]);
  assert.equal(s.tempo, 80);
  const p = prepareSong(s);
  assert.equal(p.keyMode, 'minor');
  assert.ok(p.notes.every((n) => n.id));
  assert.deepEqual(p.notes.find((n) => n.midi === 77).spelling, { step: 'E', alter: 1 });
});

test('musicxml : export → import préserve armure + mode, accords, nuances, pédale, doigtés, orthographe', () => {
  const song = prepareSong({
    title: 'Riche', timeSig: [4, 4], keyFifths: -1, keyMode: 'minor', tempo: 72,
    tempoMap: [{ beat: 0, bpm: 72 }, { beat: 4, bpm: 96 }],
    chords: [{ beat: 0, symbol: 'Dm' }, { beat: 2, symbol: 'A7/C♯' }, { beat: 4, symbol: 'B♭maj7' }],
    dynamics: [{ beat: 0, mark: 'p' }, { beat: 1, mark: 'cresc', end: 3 }, { beat: 4, mark: 'ff' }],
    pedal: [{ beat: 0, down: true }, { beat: 3.5, down: false }],
    notes: [
      { midi: 74, start: 0, dur: 1, hand: 'R', finger: 3, slur: 'start', articulations: ['accent'] },
      { midi: 73, start: 1, dur: 1, hand: 'R', finger: 2, articulations: ['staccato'] },
      { midi: 77, start: 2, dur: 2, hand: 'R', finger: 4, slur: 'stop', spelling: { step: 'E', alter: 1 } },
      { midi: 69, start: 4, dur: 4, hand: 'R', finger: 1 },
      { midi: 50, start: 0, dur: 4, hand: 'L', finger: 5 },
      { midi: 46, start: 4, dur: 4, hand: 'L', finger: 4 },
    ],
  });
  const xml = exportMusicXML(song);
  assert.match(xml, /<key><fifths>-1<\/fifths><mode>minor<\/mode><\/key>/);
  assert.match(xml, /<harmony>/);
  assert.match(xml, /<dynamics><p\/><\/dynamics>/);
  assert.match(xml, /<step>E<\/step><alter>1<\/alter>/);
  assert.match(xml, /<step>C<\/step><alter>1<\/alter>/); // Do♯ (sensible de ré mineur), pas Ré♭
  const back = parseMusicXML(xml);
  assert.equal(back.keyFifths, -1);
  assert.equal(back.keyMode, 'minor');
  assert.deepEqual(back.chords, song.chords);
  assert.deepEqual(back.dynamics, song.dynamics);
  assert.deepEqual(back.pedal, song.pedal);
  assert.deepEqual(back.tempoMap, song.tempoMap);
  const f = (arr) => arr.map((n) => [n.midi, n.start, n.dur, n.hand, n.finger]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  assert.deepEqual(f(back.notes), f(song.notes));
  const mi = back.notes.find((n) => n.midi === 77);
  assert.deepEqual(mi.spelling, { step: 'E', alter: 1 });
  assert.equal(mi.slur, 'stop');
  assert.equal(back.notes.find((n) => n.midi === 74).slur, 'start');
  assert.deepEqual(back.notes.find((n) => n.midi === 73).articulations, ['staccato']);
  assert.deepEqual(back.notes.find((n) => n.midi === 74).articulations, ['accent']);
});

test('musicxml : tonalité estimée si absente', () => {
  const notes = [['D', 0], ['E', 0], ['F', 0], ['G', 0], ['A', 0], ['B', -1], ['C', 1], ['D', 0], ['A', 0], ['D', 0]]
    .map(([st, al]) => `<note><pitch><step>${st}</step>${al ? `<alter>${al}</alter>` : ''}<octave>4</octave></pitch><duration>1</duration></note>`).join('');
  const s = parseMusicXML(`<score-partwise><part-list/><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes>${notes}</measure></part></score-partwise>`);
  assert.ok(Number.isInteger(s.keyFifths));
  assert.ok(s.keyMode === 'major' || s.keyMode === 'minor');
  assert.equal(s.keyEstimated, true);
});

test('abc : accords, nuances, soufflets, Q: multiples, mode, liaisons, articulations', () => {
  const s = parseABC(`X:1
T:Riche
M:4/4
L:1/4
Q:1/4=80
K:Dm
"Dm"!p!(D E .F) !>!G | "A7/C#"!<(! A2 !<)! ^c2 | [Q:1/4=120] "Gm"!f! d4 |]
`);
  assert.equal(s.keyFifths, -1);
  assert.equal(s.keyMode, 'minor');
  assert.deepEqual(s.chords, [{ beat: 0, symbol: 'Dm' }, { beat: 4, symbol: 'A7/C♯' }, { beat: 8, symbol: 'Gm' }]);
  assert.deepEqual(s.dynamics, [{ beat: 0, mark: 'p' }, { beat: 4, mark: 'cresc', end: 6 }, { beat: 8, mark: 'f' }]);
  assert.deepEqual(s.tempoMap, [{ beat: 0, bpm: 80 }, { beat: 8, bpm: 120 }]);
  assert.equal(s.tempo, 80);
  const at = (b) => s.notes.find((n) => n.start === b);
  assert.equal(at(0).slur, 'start');
  assert.equal(at(2).slur, 'stop');
  assert.deepEqual(at(2).articulations, ['staccato']);
  assert.deepEqual(at(3).articulations, ['accent']);
  assert.equal(at(1).slur, undefined);
  // annotations (^texte) ignorées
  const t = parseABC('X:1\nK:C\n"^Allegro"C D "_rit."E F|\n');
  assert.equal(t.chords, undefined);
});

test('midi : tous les changements de tempo, vélocité, mode, tonalité estimée', () => {
  const song = {
    title: 'T', tempo: 90, timeSig: [4, 4], keyFifths: -3, keyMode: 'minor',
    tempoMap: [{ beat: 0, bpm: 90 }, { beat: 4, bpm: 120 }, { beat: 6, bpm: 60 }],
    notes: [
      { midi: 60, start: 0, dur: 1, hand: 'R', velocity: 100 },
      { midi: 63, start: 1, dur: 1, hand: 'R', velocity: 40 },
      { midi: 48, start: 0, dur: 2, hand: 'L' },
    ],
  };
  const back = parseMidi(exportMidi(song));
  assert.deepEqual(back.tempoMap, song.tempoMap);
  assert.equal(back.tempo, 90);
  assert.equal(back.keyFifths, -3);
  assert.equal(back.keyMode, 'minor');
  assert.equal(back.notes.find((n) => n.midi === 60).velocity, 100);
  assert.equal(back.notes.find((n) => n.midi === 63).velocity, 40);
  assert.equal(back.notes.find((n) => n.midi === 48).velocity, 80);
  // sans armure : estimation
  const u8 = exportMidi({ ...song, keyFifths: undefined, tempoMap: undefined });
  // retire le méta-événement d'armure (FF 59 02 sf mi) pour simuler un fichier sans tonalité
  const arr = Array.from(u8);
  const k = arr.findIndex((b, i) => b === 0xff && arr[i + 1] === 0x59);
  arr[k + 1] = 0x7f; // devient un méta « propriétaire », ignoré
  const est = parseMidi(new Uint8Array(arr));
  assert.equal(est.keyEstimated, true);
  assert.ok(Number.isInteger(est.keyFifths));
  assert.equal(est.tempoMap, undefined);
});
