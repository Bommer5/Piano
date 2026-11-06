// Import / export MusicXML (score-partwise).
//
// Import — pris en charge :
//   divisions (y compris changements en cours de morceau), armure (fifths), mesure (time),
//   tempo (<sound tempo> ou <metronome><per-minute>), hauteurs (step/alter/octave), silences,
//   accords (<chord/>), <backup>/<forward>, voix, portées (portée 1 → main droite,
//   portée 2 → main gauche ; si plusieurs parties à une seule portée : partie 1 → MD, autres → MG),
//   liaisons de prolongation (<tie>/<tied> : notes fusionnées), notes d'ornement (ignorées),
//   doigtés (notations/technical/fingering), levée (mesure incomplète au début : les notes sont
//   décalées pour que les barres de mesure restent alignées), titre et compositeur.
// Non pris en charge (volontairement) : les reprises / voltas / D.C. / D.S. sont ignorées, la
// partition est lue linéairement telle qu'écrite. score-timewise est refusé avec un message clair.
//
// Export : une partie piano à deux portées (clé de sol / clé de fa), voix séparées par <backup>,
// notes coupées aux barres de mesure avec liaisons, doigtés inclus.
import { parseXML } from './xml.js';
import { spell } from '../core/notes.js';

const EPS = 1e-6;
const r6 = (x) => Math.round(x * 1e6) / 1e6;
const STEP_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const TYPE_BEATS = {
  maxima: 32, long: 16, breve: 8, whole: 4, half: 2, quarter: 1, eighth: 0.5,
  '16th': 0.25, '32nd': 0.125, '64th': 0.0625, '128th': 0.03125, '256th': 0.015625,
};

function clean(o) {
  for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === null || o[k] === '') delete o[k];
  return o;
}

function num(s, def = null) {
  if (s == null) return def;
  const v = parseFloat(String(s).trim());
  return Number.isFinite(v) ? v : def;
}

/** Durée d'une note d'après <type>, <dot> et <time-modification> (secours si <duration> absent). */
function durationFromType(note) {
  const base = TYPE_BEATS[note.childText('type')];
  if (!base) return null;
  let d = base;
  let add = base;
  for (let k = 0; k < note.children('dot').length; k++) {
    add /= 2;
    d += add;
  }
  const tm = note.child('time-modification');
  if (tm) {
    const a = num(tm.childText('actual-notes'));
    const n = num(tm.childText('normal-notes'));
    if (a > 0 && n > 0) d = (d * n) / a;
  }
  return d;
}

function tempoFromMetronome(met) {
  const pm = num(met.childText('per-minute'));
  if (!(pm > 0)) return null;
  const unit = TYPE_BEATS[met.childText('beat-unit')] || 1;
  const dots = met.children('beat-unit-dot').length;
  let u = unit, add = unit;
  for (let k = 0; k < dots; k++) {
    add /= 2;
    u += add;
  }
  return pm * u;
}

/**
 * Analyse un fichier MusicXML (texte).
 * @param {string} text
 * @returns {object} morceau brut pour prepareSong
 */
export function parseMusicXML(text) {
  let root;
  try {
    root = parseXML(text);
  } catch (e) {
    throw new Error(`Fichier MusicXML illisible. ${e.message}`);
  }
  if (root.name === 'score-timewise') {
    throw new Error(
      'Ce fichier MusicXML est au format « score-timewise », qui n’est pas pris en charge. ' +
        'Réexportez-le en « score-partwise » (format par défaut de MuseScore, Finale, Sibelius…).',
    );
  }
  if (root.name !== 'score-partwise') {
    throw new Error(`Ce fichier XML n’est pas une partition MusicXML (élément racine <${root.name}>).`);
  }

  const song = { notes: [] };
  const title = root.path('work/work-title')?.text().trim() || root.childText('movement-title');
  if (title) song.title = title;
  const ident = root.child('identification');
  if (ident) {
    const creators = ident.children('creator');
    const comp = creators.find((c) => c.attr('type') === 'composer') || creators.find((c) => !c.attr('type'));
    if (comp && comp.text().trim()) song.composer = comp.text().trim();
  }

  const parts = root.children('part');
  if (!parts.length) throw new Error('Partition MusicXML vide : aucune partie (<part>) trouvée.');

  // Nombre de portées par partie (pour l'attribution des mains).
  const stavesOf = parts.map((p) => {
    let max = 1;
    for (const s of p.descendants('staves')) max = Math.max(max, num(s.text(), 1));
    for (const s of p.descendants('staff')) max = Math.max(max, num(s.text(), 1));
    return max;
  });
  const multiPartSingleStaff = parts.length > 1;

  parts.forEach((part, pIdx) => {
    const handFor = (staff) => {
      if (stavesOf[pIdx] > 1) return staff >= 2 ? 'L' : 'R';
      if (multiPartSingleStaff) return pIdx === 0 ? 'R' : 'L';
      return 'R';
    };
    let divisions = 1;
    let timeSig = song.timeSig || [4, 4];
    let measureStart = 0;
    const openTies = new Map(); // midi -> note en attente de prolongation
    const partNotes = [];
    let pickupShift = 0;

    part.children('measure').forEach((measure, mIdx) => {
      let pos = 0;
      let maxPos = 0;
      let lastStart = 0;

      for (const el of measure.children()) {
        switch (el.name) {
          case 'attributes': {
            const d = num(el.childText('divisions'));
            if (d > 0) divisions = d;
            const time = el.child('time');
            if (time) {
              const beats = String(time.childText('beats', '')).split('+').reduce((a, b) => a + (num(b, 0) || 0), 0);
              const bt = num(time.childText('beat-type'));
              if (beats > 0 && bt > 0) {
                timeSig = [beats, bt];
                if (!song.timeSig) song.timeSig = [beats, bt];
              } else if (time.attr('symbol') === 'common' && !song.timeSig) song.timeSig = timeSig = [4, 4];
            }
            const key = el.child('key');
            if (key && song.keyFifths === undefined) {
              const f = num(key.childText('fifths'));
              if (f != null) song.keyFifths = Math.max(-7, Math.min(7, Math.round(f)));
            }
            break;
          }
          case 'direction':
          case 'sound': {
            if (song.tempo === undefined) {
              const sounds = el.name === 'sound' ? [el] : el.descendants('sound');
              for (const s of sounds) {
                const t = num(s.attr('tempo'));
                if (t > 0) {
                  song.tempo = r6(t);
                  break;
                }
              }
              if (song.tempo === undefined) {
                for (const met of el.descendants('metronome')) {
                  const t = tempoFromMetronome(met);
                  if (t > 0) {
                    song.tempo = r6(t);
                    break;
                  }
                }
              }
            }
            break;
          }
          case 'backup': {
            pos -= (num(el.childText('duration'), 0) || 0) / divisions;
            if (pos < 0) pos = 0;
            break;
          }
          case 'forward': {
            pos += (num(el.childText('duration'), 0) || 0) / divisions;
            maxPos = Math.max(maxPos, pos);
            break;
          }
          case 'note': {
            if (el.child('grace') || el.child('cue')) break; // notes d'ornement : ignorées
            const isChord = !!el.child('chord');
            let dur = num(el.childText('duration'));
            dur = dur != null && dur >= 0 ? dur / divisions : durationFromType(el) || 0;
            const start = isChord ? lastStart : pos;
            if (!isChord) {
              lastStart = pos;
              pos += dur;
              maxPos = Math.max(maxPos, pos);
            }
            const pitch = el.child('pitch');
            if (el.child('rest') || !pitch || dur <= 0) break;
            const step = (pitch.childText('step') || '').toUpperCase();
            const oct = num(pitch.childText('octave'));
            if (!(step in STEP_PC) || oct == null) {
              throw new Error(`Note MusicXML invalide (mesure ${measure.attr('number') ?? mIdx + 1}).`);
            }
            const alter = Math.round(num(pitch.childText('alter'), 0));
            const midi = (oct + 1) * 12 + STEP_PC[step] + alter;
            if (midi < 0 || midi > 127) break;
            const staff = num(el.childText('staff'), 1);
            const hand = handFor(staff);
            let finger = null;
            for (const fg of el.descendants('fingering')) {
              const f = parseInt(fg.text().trim(), 10);
              if (f >= 1 && f <= 5) {
                finger = f;
                break;
              }
            }
            const tieTypes = new Set(el.children('tie').map((t) => t.attr('type')));
            for (const t of el.descendants('tied')) tieTypes.add(t.attr('type'));
            const absStart = measureStart + start;
            const prev = openTies.get(midi);
            if (tieTypes.has('stop') && prev && Math.abs(prev.start + prev.dur - absStart) < 1e-3) {
              prev.dur = absStart + dur - prev.start;
              if (!prev.finger && finger) prev.finger = finger;
              if (!tieTypes.has('start')) openTies.delete(midi);
              break;
            }
            const n = { midi, start: absStart, dur, hand, finger };
            partNotes.push(n);
            if (tieTypes.has('start')) openTies.set(midi, n);
            else openTies.delete(midi);
            break;
          }
          default:
            break;
        }
      }
      const expected = (timeSig[0] * 4) / timeSig[1];
      let len = maxPos > EPS ? maxPos : expected;
      if (mIdx === 0 && maxPos > EPS && (measure.attr('implicit') === 'yes' || maxPos < expected - EPS)) {
        // Levée : on complète la mesure par un silence au début pour aligner les barres.
        pickupShift = expected - maxPos;
        len = maxPos;
      }
      measureStart += len;
    });

    for (const n of partNotes) {
      n.start = r6(n.start + pickupShift);
      n.dur = r6(n.dur);
      song.notes.push(n);
    }
  });

  song.notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
  return clean(song);
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function chooseDivisions(values) {
  const cands = [1, 2, 4, 8, 16, 32, 3, 6, 12, 24, 48, 96, 5, 10, 20, 40, 64, 192, 384, 480, 960];
  const sorted = [...new Set(cands)].sort((a, b) => a - b);
  for (const d of sorted) {
    if (values.every((v) => Math.abs(v * d - Math.round(v * d)) < 1e-4)) return d;
  }
  return 960;
}

const STEP_LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

/** Liste des valeurs de notes écrivables (en ticks) : simples, pointées, triolets. */
function writableValues(div) {
  const out = [];
  for (const [type, beats] of Object.entries(TYPE_BEATS)) {
    if (beats > 4) continue;
    for (let dots = 0; dots <= 2; dots++) {
      let v = beats, add = beats;
      for (let k = 0; k < dots; k++) {
        add /= 2;
        v += add;
      }
      const t = v * div;
      if (Math.abs(t - Math.round(t)) < 1e-9 && t >= 1) out.push({ ticks: Math.round(t), type, dots, tuplet: false });
    }
    const tt = ((beats * 2) / 3) * div;
    if (Math.abs(tt - Math.round(tt)) < 1e-9 && tt >= 1) out.push({ ticks: Math.round(tt), type, dots: 0, tuplet: true });
  }
  // Préférer les valeurs simples à durée égale.
  out.sort((a, b) => b.ticks - a.ticks || a.tuplet - b.tuplet || a.dots - b.dots);
  return out;
}

function splitWritable(ticks, values) {
  const exact = values.find((v) => v.ticks === ticks);
  if (exact) return [exact];
  const pieces = [];
  let rest = ticks;
  let guard = 0;
  while (rest > 0 && guard++ < 64) {
    const v = values.find((x) => x.ticks <= rest && !x.tuplet) || values.find((x) => x.ticks <= rest);
    if (!v) {
      pieces.push({ ticks: rest, type: null, dots: 0, tuplet: false });
      break;
    }
    pieces.push(v);
    rest -= v.ticks;
  }
  return pieces;
}

/**
 * Exporte un morceau en MusicXML (score-partwise 4.0, une partie piano à deux portées).
 * @param {object} song morceau préparé (ou brut avec notes[])
 * @returns {string}
 */
export function exportMusicXML(song) {
  const timeSig = song.timeSig || [4, 4];
  const keyFifths = Math.max(-7, Math.min(7, Math.round(song.keyFifths || 0)));
  const tempo = song.tempo || 90;
  const notes = (song.notes || []).filter((n) => Number.isFinite(n.midi) && n.dur > 0 && n.start >= 0);
  const div = chooseDivisions(notes.flatMap((n) => [n.start, n.dur]));
  const values = writableValues(div);
  const measTicks = Math.round(((timeSig[0] * 4) / timeSig[1]) * div);
  const toT = (b) => Math.round(b * div);
  const totalTicks = notes.reduce((m, n) => Math.max(m, toT(n.start) + Math.max(1, toT(n.dur))), 0);
  const nMeasures = Math.max(1, Math.ceil(totalTicks / measTicks));
  if (nMeasures > 5000) throw new Error('Morceau trop long pour l’export MusicXML (plus de 5000 mesures).');
  const preferFlats = keyFifths < 0;

  // Voix par portée : groupes (même début, même durée) répartis sans chevauchement.
  const staffVoices = { 1: [], 2: [] };
  for (const staff of [1, 2]) {
    const hand = staff === 1 ? 'R' : 'L';
    const groups = new Map();
    for (const n of notes.filter((x) => (x.hand === 'L' ? 'L' : 'R') === hand)) {
      const s = toT(n.start);
      const d = Math.max(1, toT(n.dur));
      const k = `${s}:${d}`;
      if (!groups.has(k)) groups.set(k, { s, d, notes: [] });
      const g = groups.get(k);
      if (!g.notes.some((m) => m.midi === n.midi)) g.notes.push(n);
    }
    const sortedGroups = [...groups.values()].sort((a, b) => a.s - b.s || b.d - a.d);
    const voices = [];
    for (const g of sortedGroups) {
      g.notes.sort((a, b) => a.midi - b.midi);
      let v = voices.find((vv) => vv.end <= g.s);
      if (!v) {
        v = { end: 0, groups: [] };
        voices.push(v);
      }
      v.groups.push(g);
      v.end = g.s + g.d;
    }
    staffVoices[staff] = voices;
  }

  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
  out.push(
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
  );
  out.push('<score-partwise version="4.0">');
  out.push(`  <work><work-title>${esc(song.title || 'Sans titre')}</work-title></work>`);
  out.push('  <identification>');
  if (song.composer) out.push(`    <creator type="composer">${esc(song.composer)}</creator>`);
  out.push('    <encoding><software>Piano Coach</software></encoding>');
  out.push('  </identification>');
  out.push('  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>');
  out.push('  <part id="P1">');

  const noteXml = (piece, opts) => {
    const { midi, chord, voice, staff, tieStart, tieStop, finger } = opts;
    const x = ['      <note>'];
    if (chord) x.push('        <chord/>');
    if (midi == null) x.push(opts.wholeRest ? '        <rest measure="yes"/>' : '        <rest/>');
    else {
      const sp = spell(midi, preferFlats);
      x.push(
        `        <pitch><step>${STEP_LETTERS[sp.step]}</step>${sp.alter ? `<alter>${sp.alter}</alter>` : ''}<octave>${sp.octave}</octave></pitch>`,
      );
    }
    x.push(`        <duration>${piece.ticks}</duration>`);
    if (tieStop) x.push('        <tie type="stop"/>');
    if (tieStart) x.push('        <tie type="start"/>');
    x.push(`        <voice>${voice}</voice>`);
    if (piece.type && !opts.wholeRest) x.push(`        <type>${piece.type}</type>`);
    for (let k = 0; k < piece.dots; k++) x.push('        <dot/>');
    if (piece.tuplet) x.push('        <time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>');
    x.push(`        <staff>${staff}</staff>`);
    const nots = [];
    if (tieStop) nots.push('<tied type="stop"/>');
    if (tieStart) nots.push('<tied type="start"/>');
    if (finger) nots.push(`<technical><fingering>${finger}</fingering></technical>`);
    if (nots.length) x.push(`        <notations>${nots.join('')}</notations>`);
    x.push('      </note>');
    return x.join('\n');
  };

  for (let m = 0; m < nMeasures; m++) {
    const mStart = m * measTicks;
    const mEnd = mStart + measTicks;
    out.push(`    <measure number="${m + 1}">`);
    if (m === 0) {
      out.push('      <attributes>');
      out.push(`        <divisions>${div}</divisions>`);
      out.push(`        <key><fifths>${keyFifths}</fifths></key>`);
      out.push(`        <time><beats>${timeSig[0]}</beats><beat-type>${timeSig[1]}</beat-type></time>`);
      out.push('        <staves>2</staves>');
      out.push('        <clef number="1"><sign>G</sign><line>2</line></clef>');
      out.push('        <clef number="2"><sign>F</sign><line>4</line></clef>');
      out.push('      </attributes>');
      out.push(
        `      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${r6(tempo)}</per-minute></metronome></direction-type><sound tempo="${r6(tempo)}"/></direction>`,
      );
    }
    let first = true;
    for (const staff of [1, 2]) {
      const voices = staffVoices[staff].length ? staffVoices[staff] : [{ groups: [] }];
      voices.forEach((v, vi) => {
        const voiceNum = (staff - 1) * 4 + vi + 1;
        if (!first) out.push(`      <backup><duration>${measTicks}</duration></backup>`);
        first = false;
        let t = mStart;
        const emitRest = (len) => {
          if (len <= 0) return;
          if (len === measTicks && t === mStart && vi === 0) {
            out.push(noteXml({ ticks: len, type: 'whole', dots: 0 }, { midi: null, voice: voiceNum, staff, wholeRest: true }));
          } else {
            for (const p of splitWritable(len, values)) out.push(noteXml(p, { midi: null, voice: voiceNum, staff }));
          }
          t += len;
        };
        const inMeasure = v.groups.filter((g) => g.s < mEnd && g.s + g.d > mStart);
        if (!inMeasure.length && vi > 0) {
          out.push(`      <forward><duration>${measTicks}</duration><voice>${voiceNum}</voice><staff>${staff}</staff></forward>`);
          return;
        }
        for (const g of inMeasure) {
          const s = Math.max(g.s, mStart);
          const e = Math.min(g.s + g.d, mEnd);
          if (s > t) emitRest(s - t);
          const pieces = splitWritable(e - s, values);
          pieces.forEach((p, pi) => {
            const tieStop = s > g.s || pi > 0;
            const tieStart = e < g.s + g.d || pi < pieces.length - 1;
            g.notes.forEach((n, ni) => {
              out.push(
                noteXml(p, {
                  midi: n.midi,
                  chord: ni > 0,
                  voice: voiceNum,
                  staff,
                  tieStart,
                  tieStop,
                  finger: !tieStop && n.finger >= 1 && n.finger <= 5 ? n.finger : null,
                }),
              );
            });
          });
          t = e;
        }
        if (t < mEnd) emitRest(mEnd - t);
      });
    }
    if (m === nMeasures - 1) out.push('      <barline location="right"><bar-style>light-heavy</bar-style></barline>');
    out.push('    </measure>');
  }
  out.push('  </part>');
  out.push('</score-partwise>');
  return out.join('\n') + '\n';
}
