// Tests des parseurs d'import / export de partitions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseXML, decodeEntities } from '../../js/parsers/xml.js';
import { parseMusicXML, exportMusicXML } from '../../js/parsers/musicxml.js';
import { parseMXL } from '../../js/parsers/mxl.js';
import { parseMidi, exportMidi } from '../../js/parsers/midi.js';
import { parseABC } from '../../js/parsers/abc.js';
import { importScoreFile, importScoreText, exportSong, SUPPORTED_FORMATS } from '../../js/parsers/index.js';
import { prepareSong } from '../../js/core/song.js';

const enc = new TextEncoder();

/** Vérifie que le morceau brut passe par prepareSong et le renvoie. */
function prep(raw) {
  const s = prepareSong(raw);
  assert.ok(s.notes.length > 0, 'le morceau doit contenir des notes');
  for (const n of s.notes) {
    assert.ok(Number.isFinite(n.start) && n.start >= 0);
    assert.ok(n.dur > 0);
    assert.ok(n.hand === 'R' || n.hand === 'L');
  }
  return s;
}

const simple = (notes) => notes.map((n) => [n.midi, n.start, n.dur, n.hand]);
const fakeFile = (name, data) => {
  const u8 = typeof data === 'string' ? enc.encode(data) : new Uint8Array(data);
  return {
    name,
    arrayBuffer: async () => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength),
    text: async () => new TextDecoder().decode(u8),
  };
};

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------

test('xml : éléments, attributs, entités, CDATA, commentaires, PI, DOCTYPE', () => {
  const src = `﻿<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE root [ <!ENTITY foo "bar"> <!ELEMENT root ANY> ]>
<!-- commentaire avec <balise> -->
<root a="1" b='deux &amp; trois'>
  <item id="x">A &lt; B &gt; C &quot;D&quot; &apos;E&apos; &#233;&#xE9;</item>
  <?pi ignore ?>
  <item id="y"><![CDATA[<pas une balise> & co]]></item>
  <vide/>
  <nested><deep>ok</deep></nested>
</root>`;
  const root = parseXML(src);
  assert.equal(root.name, 'root');
  assert.equal(root.attr('a'), '1');
  assert.equal(root.attr('b'), 'deux & trois');
  assert.equal(root.attr('zz', 'def'), 'def');
  const items = root.children('item');
  assert.equal(items.length, 2);
  assert.equal(items[0].text(), 'A < B > C "D" \'E\' éé');
  assert.equal(items[1].text(), '<pas une balise> & co');
  assert.ok(root.child('vide'));
  assert.equal(root.child('vide').text(), '');
  assert.equal(root.path('nested/deep').text(), 'ok');
  assert.equal(root.child('absent'), null);
  assert.equal(root.descendants('deep').length, 1);
  assert.equal(decodeEntities('&unknown; &#x41;'), '&unknown; A');
});

test('xml : erreurs claires sur document malformé (sans boucle infinie)', () => {
  for (const bad of ['<a><b></a>', '<a>', '<a x=1></a>', '<!-- jamais fermé', '<a></a><b></b>', '', 'texte', '<a><![CDATA[x</a>']) {
    assert.throws(() => parseXML(bad), /XML invalide/);
  }
});

// ---------------------------------------------------------------------------
// MusicXML
// ---------------------------------------------------------------------------

const MXML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work><work-title>Petite pièce &amp; test</work-title></work>
  <movement-title>Ignoré</movement-title>
  <identification><creator type="lyricist">X</creator><creator type="composer">J.-S. Bach</creator></identification>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="0" implicit="yes">
      <attributes>
        <divisions>2</divisions>
        <key><fifths>-1</fifths><mode>major</mode></key>
        <time><beats>3</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
      </attributes>
      <direction><direction-type><metronome><beat-unit>quarter</beat-unit><beat-unit-dot/><per-minute>60</per-minute></metronome></direction-type></direction>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><type>quarter</type><staff>1</staff>
        <notations><technical><fingering>5</fingering></technical></notations></note>
      <backup><duration>2</duration></backup>
      <note><rest/><duration>2</duration><voice>5</voice><staff>2</staff></note>
    </measure>
    <measure number="1">
      <note><grace/><pitch><step>D</step><octave>5</octave></pitch><voice>1</voice><type>eighth</type><staff>1</staff></note>
      <note><pitch><step>B</step><alter>-1</alter><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><staff>1</staff>
        <notations><technical><fingering>4</fingering></technical></notations></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>eighth</type><staff>1</staff></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><tie type="start"/><voice>1</voice><type>half</type><staff>1</staff>
        <notations><tied type="start"/></notations></note>
      <backup><duration>6</duration></backup>
      <note><pitch><step>F</step><octave>3</octave></pitch><duration>6</duration><voice>5</voice><type>half</type><dot/><staff>2</staff></note>
      <note><chord/><pitch><step>A</step><octave>3</octave></pitch><duration>6</duration><voice>5</voice><type>half</type><dot/><staff>2</staff></note>
      <note><chord/><pitch><step>C</step><octave>4</octave></pitch><duration>6</duration><voice>5</voice><type>half</type><dot/><staff>2</staff></note>
    </measure>
    <measure number="2">
      <attributes><divisions>4</divisions></attributes>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><tie type="stop"/><voice>1</voice><type>quarter</type><staff>1</staff>
        <notations><tied type="stop"/></notations></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>8</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <backup><duration>12</duration></backup>
      <forward><duration>4</duration></forward>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>8</duration><voice>5</voice><type>half</type><staff>2</staff></note>
      <barline location="right"><repeat direction="backward"/></barline>
    </measure>
  </part>
</score-partwise>`;

test('musicxml : métadonnées, levée, backup, accords, liaisons, ornements, doigtés', () => {
  const s = parseMusicXML(MXML);
  assert.equal(s.title, 'Petite pièce & test');
  assert.equal(s.composer, 'J.-S. Bach');
  assert.deepEqual(s.timeSig, [3, 4]);
  assert.equal(s.keyFifths, -1);
  assert.equal(s.tempo, 90); // noire pointée = 60 → 90 noires/min
  // levée d'un temps en 3/4 : décalage de 2 temps ; la reprise finale est dépliée (tout est joué deux fois)
  assert.equal(s.notes.length, 18);
  assert.deepEqual(simple(s.notes.slice(9)), simple(s.notes.slice(0, 9)).map(([m, st, d, h]) => [m, st + 7, d, h]));
  assert.match(s.importReport.details.join(' '), /reprises dépliés : 3 mesures écrites → 6 jouées/);
  assert.deepEqual(simple(s.notes.slice(0, 9)), [
    [72, 2, 1, 'R'],
    [53, 3, 3, 'L'],
    [57, 3, 3, 'L'],
    [60, 3, 3, 'L'],
    [70, 3, 0.5, 'R'],
    [69, 3.5, 0.5, 'R'],
    [67, 4, 3, 'R'], // blanche liée à une noire
    [48, 7, 2, 'L'], // après <forward>
    [65, 7, 2, 'R'],
  ]);
  assert.equal(s.notes[0].finger, 5);
  assert.equal(s.notes.find((n) => n.midi === 70).finger, 4);
  assert.equal(s.notes.find((n) => n.midi === 69).finger, null);
  const p = prep(s);
  assert.equal(p.measureCount, 6);
});

test('musicxml : tempo via <sound>, plusieurs parties à une portée, titre de mouvement', () => {
  const xml = `<score-partwise>
  <movement-title>Duo</movement-title>
  <part-list/>
  <part id="P1"><measure number="1">
    <attributes><divisions>1</divisions><time symbol="common"><beats>4</beats><beat-type>4</beat-type></time></attributes>
    <sound tempo="132"/>
    <note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration></note>
  </measure></part>
  <part id="P2"><measure number="1">
    <attributes><divisions>1</divisions></attributes>
    <note><pitch><step>C</step><alter>1</alter><octave>3</octave></pitch><duration>4</duration></note>
  </measure></part>
</score-partwise>`;
  const s = parseMusicXML(xml);
  assert.equal(s.title, 'Duo');
  assert.equal(s.tempo, 132);
  assert.equal(s.composer, undefined);
  assert.deepEqual(simple(s.notes), [
    [49, 0, 4, 'L'],
    [64, 0, 4, 'R'],
  ]);
  prep(s);
});

test('musicxml : erreurs en français (timewise, pas une partition, XML cassé)', () => {
  assert.throws(() => parseMusicXML('<score-timewise><measure/></score-timewise>'), /score-timewise.*partwise/s);
  assert.throws(() => parseMusicXML('<html></html>'), /n’est pas une partition MusicXML/);
  assert.throws(() => parseMusicXML('<score-partwise><part>'), /MusicXML illisible/);
  assert.throws(() => parseMusicXML('<score-partwise></score-partwise>'), /aucune partie/);
});

const SONG = {
  title: 'Aller-retour',
  composer: 'Test',
  tempo: 72,
  timeSig: [4, 4],
  keyFifths: 2,
  notes: [
    { midi: 74, start: 0, dur: 1, hand: 'R', finger: 3 },
    { midi: 66, start: 0, dur: 1, hand: 'R', finger: 1 },
    { midi: 73, start: 1, dur: 0.5, hand: 'R', finger: 2 },
    { midi: 71, start: 1.5, dur: 0.25, hand: 'R', finger: 1 },
    { midi: 69, start: 1.75, dur: 0.25, hand: 'R', finger: 2 },
    { midi: 67, start: 2, dur: 1 / 3, hand: 'R', finger: 1 },
    { midi: 69, start: 2 + 1 / 3, dur: 1 / 3, hand: 'R', finger: 2 },
    { midi: 71, start: 2 + 2 / 3, dur: 1 / 3, hand: 'R', finger: 3 },
    { midi: 74, start: 3, dur: 2.5, hand: 'R', finger: 5 }, // traverse la barre de mesure
    { midi: 50, start: 0, dur: 4, hand: 'L', finger: 5 },
    { midi: 57, start: 1, dur: 1, hand: 'L', finger: 2 }, // seconde voix dans la portée 2
    { midi: 45, start: 4, dur: 5, hand: 'L', finger: 4 }, // 5 temps : découpé et lié
    { midi: 38, start: 9.5, dur: 0.5, hand: 'L', finger: 5 },
  ],
};
const r6 = (x) => Math.round(x * 1e6) / 1e6;
const norm = (notes) =>
  notes
    .map((n) => [n.midi, r6(n.start), r6(n.dur), n.hand, n.finger || null])
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);

test('musicxml : export → import (aller-retour exact, doigtés, voix, liaisons)', () => {
  const song = prep(SONG);
  const xml = exportMusicXML(song);
  assert.match(xml, /<score-partwise/);
  assert.match(xml, /<staves>2<\/staves>/);
  assert.match(xml, /<fingering>5<\/fingering>/);
  assert.match(xml, /<tie type="start"\/>/);
  assert.match(xml, /<backup>/);
  const back = parseMusicXML(xml);
  assert.equal(back.title, 'Aller-retour');
  assert.equal(back.composer, 'Test');
  assert.equal(back.tempo, 72);
  assert.deepEqual(back.timeSig, [4, 4]);
  assert.equal(back.keyFifths, 2);
  assert.deepEqual(norm(back.notes), norm(SONG.notes));
  prep(back);
});

test('musicxml : export d’un morceau vide ou à une seule main reste valide', () => {
  const xml = exportMusicXML({ title: 'Vide', notes: [] });
  assert.equal(parseXML(xml).name, 'score-partwise');
  const one = exportMusicXML({ title: 'G', timeSig: [3, 4], notes: [{ midi: 40, start: 0, dur: 3, hand: 'L', finger: null }] });
  const back = parseMusicXML(one);
  assert.deepEqual(simple(back.notes), [[40, 0, 3, 'L']]);
});

// ---------------------------------------------------------------------------
// MXL (zip)
// ---------------------------------------------------------------------------

async function deflateRaw(u8) {
  const stream = new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Construit une archive ZIP minimale (CRC non vérifié par le lecteur, mis à 0). */
async function buildZip(files, { method = 8, central = true } = {}) {
  const parts = [];
  const cd = [];
  let offset = 0;
  for (const [name, content] of files) {
    const raw = enc.encode(content);
    const data = method === 8 ? await deflateRaw(raw) : raw;
    const nameB = enc.encode(name);
    const lh = new Uint8Array(30 + nameB.length);
    const dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(8, method, true);
    dv.setUint32(18, data.length, true);
    dv.setUint32(22, raw.length, true);
    dv.setUint16(26, nameB.length, true);
    lh.set(nameB, 30);
    const ch = new Uint8Array(46 + nameB.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, method, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameB.length, true);
    cv.setUint32(42, offset, true);
    ch.set(nameB, 46);
    parts.push(lh, data);
    cd.push(ch);
    offset += lh.length + data.length;
  }
  const cdSize = cd.reduce((a, c) => a + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = central ? [...parts, ...cd, eocd] : parts;
  const total = all.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of all) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container><rootfiles><rootfile full-path="score/piece.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>`;

test('mxl : archive deflate avec META-INF/container.xml', async () => {
  const zip = await buildZip([
    ['mimetype', 'application/vnd.recordare.musicxml'],
    ['META-INF/container.xml', CONTAINER],
    ['leurre.xml', '<score-partwise><part><measure><note><pitch><step>C</step><octave>1</octave></pitch><duration>1</duration></note></measure></part></score-partwise>'],
    ['score/piece.musicxml', MXML],
  ]);
  const s = await parseMXL(zip.buffer);
  assert.equal(s.title, 'Petite pièce & test');
  assert.equal(s.notes.length, 18);
  prep(s);
});

test('mxl : méthode « stockée », sans container.xml, et sans répertoire central', async () => {
  const stored = await buildZip([['piece.xml', MXML]], { method: 0 });
  assert.equal((await parseMXL(stored)).notes.length, 18);
  const noCentral = await buildZip([['META-INF/x.xml', '<a/>'], ['piece.musicxml', MXML]], { central: false });
  assert.equal((await parseMXL(noCentral)).notes.length, 18);
});

test('mxl : erreurs claires', async () => {
  await assert.rejects(parseMXL(new Uint8Array(10)), /MXL invalide/);
  await assert.rejects(parseMXL(enc.encode('ceci n’est pas un zip, mais assez long pour le test ...')), /MXL invalide/);
  const empty = await buildZip([['readme.txt', 'rien']]);
  await assert.rejects(parseMXL(empty), /aucune partition MusicXML/);
  const zip = await buildZip([['piece.xml', MXML]]);
  await assert.rejects(parseMXL(zip.slice(0, 80)), /tronquée/);
});

// ---------------------------------------------------------------------------
// MIDI
// ---------------------------------------------------------------------------

function vlq(v) {
  const b = [v & 0x7f];
  while ((v >>= 7)) b.unshift((v & 0x7f) | 0x80);
  return b;
}
function mtrk(bytes) {
  const l = bytes.length;
  return [0x4d, 0x54, 0x72, 0x6b, (l >>> 24) & 255, (l >>> 16) & 255, (l >>> 8) & 255, l & 255, ...bytes];
}
function mthd(format, ntrks, division) {
  return [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, format, 0, ntrks, (division >> 8) & 255, division & 255];
}
const nameMeta = (s) => [0xff, 0x03, s.length, ...enc.encode(s)];

test('midi : format 1, running status, vélocité 0, sysex, méta, percussions, mains par piste', () => {
  const PPQ = 96;
  const t0 = mtrk([
    0, ...nameMeta('Ma chanson'),
    0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20, // 500000 µs → 120 BPM
    0, 0xff, 0x58, 4, 6, 3, 24, 8, // 6/8
    0, 0xff, 0x59, 2, 0xfe, 0, // 2 bémols
    0, 0xf0, 3, 0x7e, 0x7f, 0xf7, // sysex
    0, 0xff, 0x2f, 0,
  ]);
  const t1 = mtrk([
    0, 0x90, 64, 100, // Mi4
    ...vlq(PPQ), 64, 0, // running status, vélocité 0 = note-off
    0, 67, 90, // running status note-on
    ...vlq(PPQ / 2), 0x80, 67, 0,
    0, 0x99, 36, 100, // percussion (canal 10) : ignorée
    ...vlq(PPQ / 2), 0x89, 36, 0,
    0, 0xff, 0x2f, 0,
  ]);
  const t2 = mtrk([
    0, 0xc1, 0, // program change (1 octet de données)
    0, 0x91, 48, 80,
    0, 0xb1, 64, 127, // contrôleur
    ...vlq(PPQ * 2), 0x81, 48, 0,
    0, 0xff, 0x2f, 0,
  ]);
  const t3 = mtrk([0, 0x92, 84, 80, ...vlq(PPQ), 0x82, 84, 0, 0, 0xff, 0x2f, 0]);
  const file = new Uint8Array([...mthd(1, 4, PPQ), ...t0, ...t1, ...t2, ...t3]);
  const s = parseMidi(file.buffer);
  assert.equal(s.title, 'Ma chanson');
  assert.equal(s.tempo, 120);
  assert.deepEqual(s.timeSig, [6, 8]);
  assert.equal(s.keyFifths, -2);
  assert.deepEqual(simple(s.notes), [
    [48, 0, 2, 'L'],
    [64, 0, 1, 'R'],
    [84, 0, 1, 'R'], // 3e piste : hauteur moyenne ≥ Do4 → MD
    [67, 1, 0.5, 'R'],
  ]);
  prep(s);
});

test('midi : format 0, une seule piste → séparation au Do central', () => {
  const t = mtrk([0, 0x90, 60, 90, 0, 59, 90, ...vlq(480), 0x80, 60, 0, 0, 59, 0, 0, 0xff, 0x2f, 0]);
  const s = parseMidi(new Uint8Array([...mthd(0, 1, 480), ...t]));
  assert.deepEqual(simple(s.notes), [
    [59, 0, 1, 'L'],
    [60, 0, 1, 'R'],
  ]);
  prep(s);
});

test('midi : erreurs (SMPTE, pas un MIDI, tronqué)', () => {
  const smpte = new Uint8Array([...mthd(1, 1, 0xe728), ...mtrk([0, 0xff, 0x2f, 0])]);
  assert.throws(() => parseMidi(smpte), /SMPTE/);
  assert.throws(() => parseMidi(enc.encode('pas du tout un fichier midi')), /MThd/);
  const trunc = new Uint8Array([...mthd(0, 1, 480), ...mtrk([0, 0x90, 60, 90, 0x83])]);
  assert.throws(() => parseMidi(trunc), /MIDI invalide/);
  const noStatus = new Uint8Array([...mthd(0, 1, 480), ...mtrk([0, 60, 90, 0, 0xff, 0x2f, 0])]);
  assert.throws(() => parseMidi(noStatus), /statut/);
});

test('midi : export → import (aller-retour)', () => {
  const song = prep(SONG);
  const bytes = exportMidi(song);
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(String.fromCharCode(...bytes.subarray(0, 4)), 'MThd');
  const back = parseMidi(bytes.buffer);
  assert.equal(back.title, 'Aller-retour');
  assert.equal(back.tempo, 72);
  assert.deepEqual(back.timeSig, [4, 4]);
  assert.equal(back.keyFifths, 2);
  const strip = (notes) => norm(notes).map((n) => n.slice(0, 4));
  assert.deepEqual(strip(back.notes), strip(SONG.notes));
  prep(back);
  // une seule main, notes graves comprises : la main est conservée grâce au nom de piste
  const lh = parseMidi(exportMidi({ title: 'MG', notes: [{ midi: 70, start: 0, dur: 1, hand: 'L' }] }));
  assert.equal(lh.notes[0].hand, 'L');
});

// ---------------------------------------------------------------------------
// ABC
// ---------------------------------------------------------------------------

test('abc : en-têtes, L par défaut, armure, altérations dans la mesure, octaves, durées', () => {
  const s = parseABC(`%abc-2.1
X:1
T:Air
T:Sous-titre
C:Trad.
M:4/4
Q:1/4=96
K:G
"G" F G/ A// B// c3/2 d/ | F =F F ^f | C, c' z2 x2 A2 |]
w: paroles ignorées
`);
  assert.equal(s.title, 'Air');
  assert.equal(s.composer, 'Trad.');
  assert.equal(s.tempo, 96);
  assert.deepEqual(s.timeSig, [4, 4]);
  assert.equal(s.keyFifths, 1);
  // L = 1/8 (4/4 ≥ 0,75) → unité = 0,5 temps
  assert.deepEqual(
    s.notes.map((n) => [n.midi, n.start, n.dur]),
    [
      [66, 0, 0.5], // F# (armure)
      [67, 0.5, 0.25],
      [69, 0.75, 0.125],
      [71, 0.875, 0.125],
      [72, 1, 0.75],
      [74, 1.75, 0.25],
      [66, 2, 0.5], // nouvelle mesure : F# de nouveau
      [65, 2.5, 0.5], // =F
      [65, 3, 0.5], // bécarre conservé dans la mesure
      [78, 3.5, 0.5], // ^f (autre octave)
      [48, 4, 0.5], // C,
      [84, 4.5, 0.5], // c'
      [69, 7, 1], // z2 x2 = 2 temps de silence
    ],
  );
  assert.ok(s.notes.every((n) => n.hand === 'R'));
  prep(s);
});

test('abc : modes et armures', () => {
  const fifths = (k) => parseABC(`X:1\nK:${k}\nC`).keyFifths;
  assert.equal(fifths('Dm'), -1);
  assert.equal(fifths('Amin'), 0);
  assert.equal(fifths('D dorian'), 0);
  assert.equal(fifths('A mix'), 2);
  assert.equal(fifths('E phr'), 0);
  assert.equal(fifths('F lyd'), 0);
  assert.equal(fifths('B loc'), 0);
  assert.equal(fifths('Bb'), -2);
  assert.equal(fifths('F#m'), 3);
  assert.equal(fifths('C clef=bass'), 0);
  // Dm : si bémol
  assert.equal(parseABC('X:1\nL:1/4\nK:Dm\nB').notes[0].midi, 70);
  // altérations explicites ajoutées à l'armure
  assert.equal(parseABC('X:1\nL:1/4\nK:D exp _b\nB F').notes[0].midi, 70);
  assert.equal(parseABC('X:1\nL:1/4\nK:D exp _b\nB F').notes[1].midi, 65);
  assert.equal(parseABC('X:1\nL:1/4\nK:C ^f\nF').notes[0].midi, 66);
});

test('abc : M:C, M:C|, L par défaut 1/16 pour 2/4, Q sans unité', () => {
  let s = parseABC('X:1\nM:C|\nK:C\nC');
  assert.deepEqual(s.timeSig, [2, 2]);
  assert.equal(s.notes[0].dur, 0.5);
  s = parseABC('X:1\nM:C\nK:C\nC');
  assert.deepEqual(s.timeSig, [4, 4]);
  s = parseABC('X:1\nM:2/4\nQ:120\nK:C\nC');
  assert.equal(s.notes[0].dur, 0.25); // L = 1/16
  assert.equal(s.tempo, 30); // 120 doubles-croches/min = 30 noires/min
  s = parseABC('X:1\nM:6/8\nQ:3/8=60\nK:C\nC');
  assert.equal(s.notes[0].dur, 0.5);
  assert.equal(s.tempo, 90);
});

test('abc : accords, liaisons, rythmes pointés, n-olets, ornements, notes d’ornement', () => {
  const s = parseABC(`X:1
M:4/4
L:1/4
K:C
[CEG]2 [C/E/]2 G- | G A>B | (3c/d/e/ !trill!f {ga}g +fermata+a/ | A<B A>>B | !2!c-c !1![D2F2] |]`);
  assert.deepEqual(
    s.notes.map((n) => [n.midi, n.start, n.dur]),
    [
      [60, 0, 2],
      [64, 0, 2],
      [67, 0, 2],
      [60, 2, 1], // [C/E/]2 : chaque note = 1/2 × 2
      [64, 2, 1],
      [67, 3, 2], // G- | G
      [69, 5, 1.5], // A>B
      [71, 6.5, 0.5],
      [72, 7, 1 / 3],
      [74, 7 + 1 / 3, 1 / 3],
      [76, 7 + 2 / 3, 1 / 3],
      [77, 8, 1],
      [79, 9, 1], // grâce {ga} ignorée
      [81, 10, 0.5],
      [69, 10.5, 0.5], // A<B
      [71, 11, 1.5],
      [69, 12.5, 1.75], // A>>B
      [71, 14.25, 0.25],
      [72, 14.5, 2], // !2!c-c
      [62, 16.5, 2],
      [65, 16.5, 2],
    ].map(([a, b, c]) => [a, r6(b), r6(c)]),
  );
  assert.equal(s.notes.find((n) => n.midi === 72 && n.start === 14.5).finger, 2);
  assert.equal(s.notes.find((n) => n.midi === 62).finger, 1);
  prep(s);
});

test('abc : n-olets (p:q:r) et mesure composée', () => {
  const s = parseABC('X:1\nM:6/8\nL:1/8\nK:C\n(2CD (3::2EF G');
  assert.deepEqual(
    s.notes.map((n) => [n.midi, n.start, n.dur]),
    [
      [60, 0, 0.75],
      [62, 0.75, 0.75],
      [64, 1.5, r6(1 / 3)],
      [65, r6(1.5 + 1 / 3), r6(1 / 3)],
      [67, r6(1.5 + 2 / 3), 0.5],
    ],
  );
});

test('abc : voix multiples (V:1 → MD, V:2 → MG), reprises et fins alternatives dépliées', () => {
  const s = parseABC(`X:1
T:Deux voix
M:3/4
L:1/4
V:1 clef=treble
V:2 clef=bass
K:F
V:1
|: c d e |1 f3 :|2 g3 |]
V:2
[V:2] F,3 | C,3 | B,,3 |]
X:2
T:Autre morceau ignoré
K:C
CDE`);
  assert.equal(s.title, 'Deux voix');
  assert.equal(s.keyFifths, -1);
  assert.deepEqual(simple(s.notes), [
    [53, 0, 3, 'L'],
    [72, 0, 1, 'R'],
    [74, 1, 1, 'R'],
    [76, 2, 1, 'R'],
    [48, 3, 3, 'L'],
    [77, 3, 3, 'R'], // 1re fin
    [53, 6, 3, 'L'], // reprise (la structure de la voix 1 s'applique à la voix 2)
    [72, 6, 1, 'R'],
    [74, 7, 1, 'R'],
    [76, 8, 1, 'R'],
    [46, 9, 3, 'L'], // B,, (Si1) avec si bémol de l'armure (Fa majeur)
    [79, 9, 3, 'R'], // 2e fin
  ]);
  assert.deepEqual(s.importReport.details, ['reprises et fins alternatives dépliées']);
  prep(s);
});

test('abc : erreurs en français', () => {
  assert.throws(() => parseABC('X:1\nT:Vide\nK:C\n'), /aucune note/);
  assert.throws(() => parseABC('X:1\nL:abc\nK:C\nC'), /longueur unité/);
  assert.throws(() => parseABC('X:1\nK:C\n[CEG'), /accord/);
  // entrée bizarre : ne doit ni planter en boucle ni lever d'erreur non contrôlée
  const s = parseABC('X:1\nK:C\n@@ ## C $$ D ))) ((( E');
  assert.equal(s.notes.length, 3);
});

// ---------------------------------------------------------------------------
// index : importScoreFile / importScoreText / exportSong
// ---------------------------------------------------------------------------

test('index : SUPPORTED_FORMATS', () => {
  assert.ok(Array.isArray(SUPPORTED_FORMATS));
  for (const ext of ['.musicxml', '.mxl', '.mid', '.abc', '.json', '.txt']) {
    const f = SUPPORTED_FORMATS.find((x) => x.ext === ext);
    assert.ok(f && f.label && f.description, ext);
  }
});

test('index : détection par contenu et par extension', async () => {
  const song = prep(SONG);
  const midi = exportMidi(song);
  // contenu MIDI même avec une mauvaise extension
  let s = await importScoreFile(fakeFile('fichier.bin', midi));
  assert.equal(s.source.format, 'midi');
  prep(s);
  s = await importScoreFile(fakeFile('piece.musicxml', MXML));
  assert.equal(s.source.format, 'musicxml');
  assert.equal(s.title, 'Petite pièce & test');
  s = await importScoreFile(fakeFile('piece.mxl', await buildZip([['p.xml', MXML]])));
  assert.equal(s.source.format, 'mxl');
  s = await importScoreFile(fakeFile('air.txt', 'X:1\nK:C\nCDE'));
  assert.equal(s.source.format, 'abc');
  assert.equal(s.title, 'air'); // titre tiré du nom de fichier
  s = await importScoreFile(fakeFile('ma_chanson.txt', 'titre: Ma chanson\nMD: C4:1:1 D4:1:2\nMG: C3:2'));
  assert.equal(s.source.format, 'text');
  assert.equal(s.title, 'Ma chanson');
  prep(s);
  s = await importScoreFile(fakeFile('x.json', JSON.stringify({ title: 'J', notes: [{ midi: 60, start: 0, dur: 1, hand: 'L', finger: 9 }] })));
  assert.equal(s.source.format, 'json');
  assert.deepEqual(s.notes, [{ midi: 60, start: 0, dur: 1, hand: 'L', finger: null }]);
  prep(s);
  s = importScoreText('{"title":"T","tracks":{"R":"E4:1 D4:1"}}', 'pas-d-extension');
  assert.equal(s.title, 'T');
  prep(s);
  // UTF-16 avec BOM
  const u16 = new Uint8Array([0xff, 0xfe, ...[...'X:1\nK:C\nC'].flatMap((c) => [c.charCodeAt(0), 0])]);
  s = await importScoreFile(fakeFile('u16.abc', u16));
  assert.equal(s.notes.length, 1);
});

test('index : PDF et images → message expliquant l’OCR musical', async () => {
  for (const name of ['partition.pdf', 'scan.PNG', 'photo.jpg', 'photo.jpeg']) {
    await assert.rejects(importScoreFile(fakeFile(name, 'peu importe')), (e) => {
      assert.match(e.message, /OCR musical/);
      assert.match(e.message, /MuseScore 4/);
      assert.match(e.message, /Audiveris/);
      assert.match(e.message, /MusicXML/);
      return true;
    });
  }
  // détection par signature, même sans la bonne extension
  await assert.rejects(importScoreFile(fakeFile('partition', '%PDF-1.7\n...')), /OCR musical/);
  assert.throws(() => importScoreText('x', 'a.pdf'), /OCR musical/);
});

test('index : autres erreurs', async () => {
  await assert.rejects(importScoreFile(fakeFile('vide.abc', '')), /vide/);
  await assert.rejects(importScoreFile(fakeFile('faux.mid', 'pas un midi')), /MIDI/);
  await assert.rejects(importScoreFile(fakeFile('bin.dat', new Uint8Array([1, 2, 3, 0, 5, 6]))), /non reconnu/);
  assert.throws(() => importScoreText('{ cassé', 'a.json'), /JSON illisible/);
  assert.throws(() => importScoreText('{"title":"x"}', 'a.json'), /ne contient pas de morceau/);
  assert.throws(() => exportSong(prep(SONG), 'pdf'), /Format d’export inconnu/);
});

test('index : exportSong dans tous les formats puis réimport', async () => {
  const song = prep(SONG);
  for (const fmt of ['midi', 'musicxml', 'json', 'text']) {
    const out = exportSong(song, fmt);
    assert.match(out.filename, /^aller-retour\.(mid|musicxml|json|txt)$/);
    assert.ok(out.mime);
    const back = await importScoreFile(fakeFile(out.filename, out.data));
    const p = prep(back);
    assert.equal(p.notes.length, SONG.notes.length, fmt);
    if (fmt !== 'text') assert.deepEqual(norm(back.notes).map((n) => n.slice(0, 4)), norm(SONG.notes).map((n) => n.slice(0, 4)), fmt);
  }
  // un morceau brut (non préparé) est accepté
  const raw = exportSong({ title: 'Brut', tracks: { R: 'C4:1 E4:1' } }, 'json');
  assert.equal(JSON.parse(raw.data).notes.length, 2);
});

test('robustesse : entrées aléatoires ou tronquées → Error ou résultat, jamais de blocage', async () => {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const abcChars = 'ABCDEFGabcdefgz^_=\',/23[]|:()<>-"!{}+&xKLMV: \n';
  const midiBytes = exportMidi(prep(SONG));
  const xml = exportMusicXML(prep(SONG));
  const zip = await buildZip([['p.xml', MXML]]);
  for (let k = 0; k < 200; k++) {
    const s = Array.from({ length: 5 + Math.floor(rnd() * 60) }, () => abcChars[Math.floor(rnd() * abcChars.length)]).join('');
    try {
      parseABC('X:1\nK:C\n' + s);
    } catch (e) {
      assert.ok(e instanceof Error && /ABC/.test(e.message), e.message);
    }
    const cut = Math.floor(rnd() * midiBytes.length);
    const mutated = midiBytes.slice(0, cut);
    if (cut > 20) mutated[14 + Math.floor(rnd() * (cut - 14))] = Math.floor(rnd() * 256);
    try {
      parseMidi(mutated);
    } catch (e) {
      assert.ok(e instanceof Error && /MIDI/.test(e.message), e.message);
    }
    try {
      parseMusicXML(xml.slice(0, Math.floor(rnd() * xml.length)));
    } catch (e) {
      assert.ok(e instanceof Error && /MusicXML|XML/.test(e.message), e.message);
    }
    const z = zip.slice();
    z[Math.floor(rnd() * z.length)] ^= 0xff;
    try {
      await parseMXL(z);
    } catch (e) {
      assert.ok(e instanceof Error && /MXL|MusicXML|XML/.test(e.message), e.message);
    }
  }
});

test('samples/ : chaque fichier d’exemple s’importe', async () => {
  const { readFileSync } = await import('node:fs');
  const dir = new URL('../../samples/', import.meta.url);
  const expected = { 'exemple.abc': 'abc', 'exemple.musicxml': 'musicxml', 'exemple.mid': 'midi', 'exemple.txt': 'text' };
  for (const [name, format] of Object.entries(expected)) {
    const s = await importScoreFile(fakeFile(name, readFileSync(new URL(name, dir))));
    assert.equal(s.source.format, format, name);
    const p = prep(s);
    assert.ok(p.hands.R && p.hands.L, name);
  }
});

// ---------------------------------------------------------------------------
// Fichiers « comme exportés » par MuseScore / un séquenceur : reprises, voltas, voix, parties, MIDI joué
// ---------------------------------------------------------------------------

const xn = (step, oct, dur, extra = '') => `<note><pitch><step>${step}</step><octave>${oct}</octave></pitch><duration>${dur}</duration>${extra}</note>`;
const xchord = (step, oct, dur, extra = '') => `<note><chord/><pitch><step>${step}</step><octave>${oct}</octave></pitch><duration>${dur}</duration>${extra}</note>`;

test('musicxml (MuseScore) : voix + piano, 2 voix par portée, accords, liaison, triolet, levée, reprise avec voltas, nuances, paroles', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Chanson</work-title></work>
  <part-list>
    <score-part id="P1"><part-name>Voix</part-name></score-part>
    <score-part id="P2"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="0" implicit="yes"><attributes><divisions>6</divisions><key><fifths>1</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      ${xn('D', 5, 6, '<lyric><text>La</text></lyric>')}</measure>
    <measure number="1">${xn('G', 5, 24)}</measure>
  </part>
  <part id="P2">
    <measure number="0" implicit="yes">
      <attributes><divisions>6</divisions><key><fifths>1</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>96</per-minute></metronome></direction-type><sound tempo="96"/></direction>
      <direction placement="below"><direction-type><dynamics><mf/></dynamics></direction-type><staff>1</staff></direction>
      ${xn('D', 4, 6, '<voice>1</voice><type>quarter</type><staff>1</staff>')}
    </measure>
    <measure number="1">
      <barline location="left"><repeat direction="forward"/></barline>
      ${xn('G', 4, 12, '<voice>1</voice><staff>1</staff>')}
      ${xn('A', 4, 2, '<voice>1</voice><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><staff>1</staff>')}
      ${xn('B', 4, 2, '<voice>1</voice><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><staff>1</staff>')}
      ${xn('C', 5, 2, '<voice>1</voice><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification><staff>1</staff>')}
      ${xn('D', 5, 6, '<tie type="start"/><voice>1</voice><staff>1</staff><notations><tied type="start"/></notations>')}
      <backup><duration>24</duration></backup>
      ${xn('D', 4, 24, '<voice>2</voice><staff>1</staff>')}
      <backup><duration>24</duration></backup>
      ${xn('G', 2, 24, '<voice>5</voice><staff>2</staff>')}
      ${xchord('D', 3, 24, '<voice>5</voice><staff>2</staff>')}
    </measure>
    <measure number="2">
      <barline location="left"><ending number="1" type="start"/></barline>
      ${xn('D', 5, 6, '<tie type="stop"/><voice>1</voice><staff>1</staff><notations><tied type="stop"/></notations>')}
      ${xn('C', 5, 18, '<voice>1</voice><staff>1</staff>')}
      <backup><duration>24</duration></backup>
      ${xn('A', 2, 24, '<voice>5</voice><staff>2</staff>')}
      <barline location="right"><ending number="1" type="stop"/><repeat direction="backward"/></barline>
    </measure>
    <measure number="3">
      <barline location="left"><ending number="2" type="start"/></barline>
      ${xn('D', 5, 6, '<tie type="stop"/><voice>1</voice><staff>1</staff>')}
      ${xn('G', 4, 18, '<voice>1</voice><staff>1</staff>')}
      <backup><duration>24</duration></backup>
      ${xn('G', 2, 24, '<voice>5</voice><staff>2</staff>')}
      <barline location="right"><ending number="2" type="discontinue"/><bar-style>light-heavy</bar-style></barline>
    </measure>
  </part>
</score-partwise>`;
  const s = parseMusicXML(xml);
  assert.equal(s.title, 'Chanson');
  assert.equal(s.tempo, 96);
  assert.equal(s.keyFifths, 1);
  assert.equal(s.pickupBeats, 1);
  // la partie « Voix » est ignorée : jouée : levée, m1, m2 (1re fin), m1, m3 (2e fin)
  const R = simple(s.notes.filter((n) => n.hand === 'R')), L = simple(s.notes.filter((n) => n.hand === 'L'));
  const third = 1 / 3;
  const near = (a, b) => assert.ok(a.length === b.length && a.every((x, i) => x[0] === b[i][0] && Math.abs(x[1] - b[i][1]) < 1e-5 && Math.abs(x[2] - b[i][2]) < 1e-5), JSON.stringify(a));
  near(R, [
    [62, 3, 1, 'R'],
    [62, 4, 4, 'R'], [67, 4, 2, 'R'], [69, 6, third, 'R'], [71, 6 + third, third, 'R'], [72, 6 + 2 * third, third, 'R'], [74, 7, 2, 'R'], // ré lié jusque dans la 1re fin
    [72, 9, 3, 'R'],
    [62, 12, 4, 'R'], [67, 12, 2, 'R'], [69, 14, third, 'R'], [71, 14 + third, third, 'R'], [72, 14 + 2 * third, third, 'R'], [74, 15, 2, 'R'], // lié jusque dans la 2e fin
    [67, 17, 3, 'R'],
  ]);
  near(L, [[43, 4, 4, 'L'], [50, 4, 4, 'L'], [45, 8, 4, 'L'], [43, 12, 4, 'L'], [50, 12, 4, 'L'], [43, 16, 4, 'L']]);
  assert.match(s.importReport.details.join(' | '), /reprises, fins alternatives dépliés : 4 mesures écrites → 5 jouées/);
  assert.match(s.importReport.details.join(' | '), /plusieurs voix par portée fusionnées/);
  assert.match(s.importReport.warnings.join(' | '), /parties ignorées : Voix/);
  assert.deepEqual(s.dynamics.map((d) => d.mark), ['mf']);
  assert.equal(prep(s).measureCount, 5);
});

test('musicxml : D.C. al Fine, reprise jouée 3 fois, changements de mesure et d’armure signalés', () => {
  const m = (n, body) => `<measure number="${n}">${body}</measure>`;
  const xml = `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">
    ${m(1, `<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>2</beats><beat-type>4</beat-type></time></attributes>${xn('C', 4, 2)}`)}
    ${m(2, `${xn('D', 4, 2)}<direction><sound fine="yes"/></direction>`)}
    ${m(3, `<barline location="left"><repeat direction="forward"/></barline>${xn('E', 4, 2)}<barline location="right"><repeat direction="backward" times="3"/></barline>`)}
    ${m(4, `<attributes><key><fifths>-2</fifths></key><time><beats>3</beats><beat-type>4</beat-type></time></attributes>${xn('F', 4, 3)}<direction><sound dacapo="yes"/></direction>`)}
  </part></score-partwise>`;
  const s = parseMusicXML(xml);
  // do ré | mi ×3 | fa (3 temps) | D.C. : do ré, arrêt à Fine
  assert.deepEqual(simple(s.notes).map(([mi, st, d]) => [mi, st, d]), [[60, 0, 2], [62, 2, 2], [64, 4, 2], [64, 6, 2], [64, 8, 2], [65, 10, 3], [60, 13, 2], [62, 15, 2]]);
  assert.deepEqual(s.timeSig, [2, 4]);
  assert.equal(s.keyFifths, 0);
  const w = s.importReport.warnings.join(' | ');
  assert.match(w, /1 changement de mesure/);
  assert.match(w, /1 changement d’armure/);
  assert.match(s.importReport.details.join(' | '), /reprises, renvois \(D\.C\., D\.S\., Coda\) dépliés : 4 mesures écrites → 8 jouées/);
});

const on = (dt, ch, key, vel = 80) => [...vlq(dt), 0x90 | ch, key, vel];
const offEv = (dt, ch, key) => [...vlq(dt), 0x80 | ch, key, 0];

test('midi (séquenceur) : format 0 à plusieurs canaux + percussions, tempo variable, notes qui se chevauchent', () => {
  const PPQ = 480;
  const tr = mtrk([
    0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20, // 120
    0, 0xff, 0x58, 4, 3, 2, 24, 8, // 3/4
    ...on(0, 0, 72), ...on(0, 1, 48), ...on(0, 9, 36), // main droite (canal 1), gauche (canal 2), grosse caisse
    ...on(240, 0, 76), // chevauche le do (legato)
    ...offEv(240, 0, 72), ...offEv(0, 9, 36),
    ...vlq(0), 0xff, 0x51, 3, 0x0f, 0x42, 0x40, // 60 au 2e temps
    ...offEv(480, 0, 76), ...on(0, 0, 79),
    ...offEv(480, 0, 79), ...offEv(0, 1, 48),
    0, 0xff, 0x2f, 0,
  ]);
  const s = parseMidi(new Uint8Array([...mthd(0, 1, PPQ), ...tr]));
  assert.deepEqual(s.timeSig, [3, 4]);
  assert.equal(s.tempo, 120);
  assert.deepEqual(s.tempoMap, [{ beat: 0, bpm: 120 }, { beat: 1, bpm: 60 }]);
  assert.deepEqual(simple(s.notes), [[48, 0, 3, 'L'], [72, 0, 1, 'R'], [76, 0.5, 1.5, 'R'], [79, 2, 1, 'R']]);
  assert.match(s.importReport.warnings.join(' '), /Percussions \(canal 10\) ignorées/);
  assert.match(s.importReport.details.join(' | '), /2 canaux MIDI séparés/);
  assert.match(s.importReport.details.join(' | '), /1 changement de tempo/);
});

/** MIDI format 1 (piste de tempo + 2 pistes) à partir de notes en temps « du fichier ». */
function midiOf(notes, { ppq = 480, bpm = 120 } = {}) {
  const us = Math.round(60000000 / bpm);
  const tempo = mtrk([0, 0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255, 0, 0xff, 0x2f, 0]);
  const track = (hand) => {
    const ev = [];
    for (const n of notes.filter((x) => x.hand === hand)) {
      ev.push({ t: Math.round(n.start * ppq), b: [0x90, n.midi, 80] }, { t: Math.round((n.start + n.dur) * ppq), b: [0x80, n.midi, 0] });
    }
    ev.sort((a, b) => a.t - b.t || a.b[0] - b.b[0]);
    const bytes = [];
    let last = 0;
    for (const e of ev) { bytes.push(...vlq(e.t - last), ...e.b); last = e.t; }
    return mtrk([...bytes, 0, 0xff, 0x2f, 0]);
  };
  return new Uint8Array([...mthd(1, 3, ppq), ...tempo, ...track('R'), ...track('L')]);
}

test('midi joué en direct : au métronome → recalé sur la grille ; librement → tempo et mesure retrouvés', () => {
  let seed = 11;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) - 0.5;
  const mel = [60, 62, 64, 65, 67, 67, 69, 69, 67, 65, 64, 62, 60, 64, 67, 72];
  const written = [];
  mel.forEach((m, k) => written.push({ midi: m, start: k, dur: 1, hand: 'R' }));
  for (let b = 0; b < 16; b += 4) written.push({ midi: 48, start: b, dur: 4, hand: 'L' }, { midi: 55, start: b + 2, dur: 2, hand: 'L' });
  // fichier propre : intact
  const clean = parseMidi(midiOf(written));
  assert.deepEqual(clean.importReport.details, []);
  assert.equal(clean.notes.length, written.length);
  // joué au métronome : ± 30 ms autour de la grille, durées approximatives
  const loose = written.map((n) => ({ ...n, start: Math.max(0, n.start + rnd() * 0.12), dur: n.dur * (0.8 + 0.15 * rnd()) }));
  const fixed = parseMidi(midiOf(loose));
  assert.match(fixed.importReport.details.join(' '), /replacées sur la grille/);
  assert.equal(fixed.tempo, 120);
  const key = (n) => `${n.midi}@${n.start}@${n.hand}`;
  assert.deepEqual(fixed.notes.map(key).sort(), written.map(key).sort());
  assert.ok(fixed.notes.every((n) => Math.abs(n.dur * 4 - Math.round(n.dur * 4)) < 1e-6));
  // joué librement à ~90 alors que le fichier dit 120 : les temps du fichier ne veulent rien dire
  const free = written.map((n) => ({ ...n, start: 0.37 + (n.start + rnd() * 0.04) * (120 / 90), dur: n.dur * (120 / 90) * 0.9 }));
  const s = parseMidi(midiOf(free));
  assert.match(s.importReport.details.join(' '), /sans métronome : rythme remis au propre/);
  assert.ok(Math.abs(s.tempo - 90) <= 2, `tempo ${s.tempo}`);
  // 4 mesures seulement : 2/4 et 4/4 sont indiscernables (les barres tombent aux mêmes endroits une fois sur deux)
  assert.ok(s.timeSig[1] === 4 && (s.timeSig[0] === 4 || s.timeSig[0] === 2), `mesure ${s.timeSig}`);
  assert.deepEqual(s.notes.map(key).sort(), written.map(key).sort());
  prep(s);
});

test('import : le compte rendu (importReport) arrive jusqu’au morceau importé', async () => {
  const s = await importScoreText('X:1\nT:Reprise\nM:4/4\nL:1/4\nK:C\n|: C D E F :| G4 |]', 'reprise.abc');
  assert.deepEqual(s.importReport.details, ['reprises dépliées']);
  assert.equal(s.notes.length, 9);
});
