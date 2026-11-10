// Import / export de fichiers MIDI standard (SMF format 0 et 1).
//
// Import : VLQ, running status, sysex et méta-événements ignorés sauf tempo (0x51), mesure (0x58),
// armure (0x59) et nom de piste (0x03). Note-on de vélocité 0 = note-off. Le canal 10 (percussions)
// est ignoré. Les temps sont convertis en temps de noire (ticks / division).
// Attribution des mains : une piste dont le nom désigne clairement une main (« Main droite »,
// « Right hand », « RH », « MG »…) est respectée ; sinon, s'il y a au moins deux pistes contenant
// des notes : 1re → main droite, 2e → main gauche, les suivantes selon leur hauteur moyenne ;
// s'il n'y a qu'une piste : séparation au Do central (midi ≥ 60 → main droite).
//
// Notation : tous les changements de tempo → song.tempoMap [{beat, bpm}] (s'il y en a plusieurs),
// vélocité d'attaque → note.velocity (1..127), tonalité estimée (Krumhansl) si l'armure est absente
// (song.keyEstimated = true) et mode mineur lu dans le méta-événement d'armure (→ song.keyMode).
//
// Export : format 1, 480 ticks par noire, piste 0 = tempo/mesure/armure, puis une piste par main.

import { estimateKey } from '../core/notation.js';
import { analyzePerformance, toRawSong } from '../core/transcribe.js';

const r6 = (x) => Math.round(x * 1e6) / 1e6;

function midiError(msg) {
  return new Error(`Fichier MIDI invalide : ${msg}`);
}

function handFromName(name) {
  if (!name) return null;
  const s = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  if (/\b(main droite|right hand|right|droite|rh|md|treble)\b/.test(s)) return 'R';
  if (/\b(main gauche|left hand|left|gauche|lh|mg|bass|basse)\b/.test(s)) return 'L';
  return null;
}

/**
 * Analyse un fichier MIDI.
 * @param {ArrayBuffer|Uint8Array} arrayBuffer
 * @returns {object} morceau brut pour prepareSong
 */
export function parseMidi(arrayBuffer) {
  const u8 = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
  const len = u8.length;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const str4 = (p) => String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]);

  // Fichiers RIFF RMID : on cherche l'en-tête MThd au début.
  let p0 = 0;
  if (len >= 4 && str4(0) !== 'MThd') {
    const lim = Math.min(len - 4, 64);
    for (let k = 0; k <= lim; k++) {
      if (str4(k) === 'MThd') {
        p0 = k;
        break;
      }
    }
  }
  if (len < p0 + 14 || str4(p0) !== 'MThd') throw midiError('en-tête « MThd » introuvable (ce n’est pas un fichier MIDI).');
  const hlen = dv.getUint32(p0 + 4);
  if (hlen < 6) throw midiError('en-tête trop court.');
  const format = dv.getUint16(p0 + 8);
  const ntrks = dv.getUint16(p0 + 10);
  const division = dv.getUint16(p0 + 12);
  if (format > 2) throw midiError(`format ${format} inconnu.`);
  if (division & 0x8000) {
    throw new Error(
      'Ce fichier MIDI utilise une base de temps SMPTE (images/seconde) au lieu de temps musicaux : ' +
        'il n’est pas pris en charge. Réenregistrez-le depuis votre logiciel en base « ticks par noire ».',
    );
  }
  if (division === 0) throw midiError('division nulle.');

  let p = p0 + 8 + hlen;
  const tracks = [];
  let tempo, timeSig, keyFifths, keyMode;
  const tempoEvents = [];
  let drumNotes = 0;
  let chunkGuard = 0;
  while (p + 8 <= len && tracks.length < ntrks + 16 && chunkGuard++ < 100000) {
    const id = str4(p);
    const clen = dv.getUint32(p + 4);
    const start = p + 8;
    const end = Math.min(len, start + clen);
    p = start + clen;
    if (id !== 'MTrk') continue;

    const track = { name: null, notes: [], channels: new Set() };
    const open = new Map(); // (ch<<7|key) -> [{tick, vel}]
    let q = start;
    let tick = 0;
    let status = 0;
    const readVLQ = () => {
      let v = 0;
      for (let k = 0; k < 4; k++) {
        if (q >= end) throw midiError('piste tronquée.');
        const b = u8[q++];
        v = v * 128 + (b & 0x7f);
        if (!(b & 0x80)) return v;
      }
      throw midiError('quantité de longueur variable invalide.');
    };
    const need = (n) => {
      if (q + n > end) throw midiError('piste tronquée.');
    };
    const closeNote = (ch, key, at) => {
      const k = (ch << 7) | key;
      const stack = open.get(k);
      if (!stack || !stack.length) return;
      const on = stack.shift();
      if (at > on.tick) track.notes.push({ midi: key, startTick: on.tick, endTick: at, ch, vel: on.vel });
    };

    while (q < end) {
      tick += readVLQ();
      if (q >= end) break;
      let b = u8[q];
      if (b & 0x80) {
        q++;
        if (b < 0xf0) status = b;
      } else {
        if (!status) throw midiError('octet de statut manquant (running status sans statut précédent).');
        b = status;
      }
      if (b === 0xff) {
        need(1);
        const type = u8[q++];
        const l = readVLQ();
        need(l);
        const d = u8.subarray(q, q + l);
        q += l;
        if (type === 0x51 && l >= 3) {
          const us = (d[0] << 16) | (d[1] << 8) | d[2];
          if (us > 0) {
            const bpm = Math.round(6000000000 / us) / 100; // précision 0,01 BPM
            if (tempo === undefined) tempo = bpm;
            tempoEvents.push({ tick, bpm });
          }
        } else if (type === 0x58 && l >= 2 && timeSig === undefined) {
          if (d[0] > 0 && d[1] < 8) timeSig = [d[0], 2 ** d[1]];
        } else if (type === 0x59 && l >= 1 && keyFifths === undefined) {
          const sf = d[0] > 127 ? d[0] - 256 : d[0];
          if (sf >= -7 && sf <= 7) {
            keyFifths = sf;
            if (l >= 2) keyMode = d[1] === 1 ? 'minor' : 'major';
          }
        } else if (type === 0x03 && track.name == null) {
          track.name = new TextDecoder('utf-8').decode(d).replace(/\0/g, '').trim() || null;
        } else if (type === 0x2f) {
          break;
        }
        continue;
      }
      if (b === 0xf0 || b === 0xf7) {
        const l = readVLQ();
        need(l);
        q += l;
        continue;
      }
      if (b >= 0xf0) throw midiError(`événement système 0x${b.toString(16)} inattendu dans une piste.`);
      const kind = b & 0xf0;
      const ch = b & 0x0f;
      const nData = kind === 0xc0 || kind === 0xd0 ? 1 : 2;
      need(nData);
      const d1 = u8[q] & 0x7f;
      const d2 = nData === 2 ? u8[q + 1] & 0x7f : 0;
      q += nData;
      if (kind === 0x90 && d2 > 0) {
        track.channels.add(ch);
        const k = (ch << 7) | d1;
        if (!open.has(k)) open.set(k, []);
        open.get(k).push({ tick, vel: d2 });
      } else if (kind === 0x80 || (kind === 0x90 && d2 === 0)) {
        closeNote(ch, d1, tick);
      }
    }
    // Notes jamais relâchées : fermées en fin de piste.
    for (const [k, stack] of open) for (const _ of [...stack]) closeNote(k >> 7, k & 0x7f, tick);
    drumNotes += track.notes.filter((n) => n.ch === 9).length;
    track.notes = track.notes.filter((n) => n.ch !== 9);
    tracks.push(track);
  }
  if (!tracks.length) throw midiError('aucune piste (MTrk) trouvée.');

  let noteTracks = tracks.filter((t) => t.notes.length);
  const report = { details: [], warnings: [] };
  if (drumNotes) report.warnings.push('Percussions (canal 10) ignorées.');
  // Format 0 (ou une seule piste) avec plusieurs canaux : chaque canal compte comme une piste (une main).
  if (noteTracks.length === 1) {
    const chans = [...new Set(noteTracks[0].notes.map((n) => n.ch))].sort((a, b) => a - b);
    if (chans.length > 1) {
      noteTracks = chans.map((ch) => ({ name: null, notes: noteTracks[0].notes.filter((n) => n.ch === ch) }));
      report.details.push(`${chans.length} canaux MIDI séparés`);
    }
  }
  if (noteTracks.length > 2) report.warnings.push(`${noteTracks.length} pistes : la 1re va à la main droite, la 2e à la main gauche, les autres selon leur hauteur.`);
  const avg = (t) => t.notes.reduce((s, n) => s + n.midi, 0) / t.notes.length;
  const song = { notes: [] };
  // Titre : nom de la première piste si c'est la piste de tempo (format 1) ou un fichier format 0.
  const t0 = tracks[0];
  if (t0.name && (format === 0 || !t0.notes.length || noteTracks.length === 1)) song.title = t0.name;
  if (tempo) song.tempo = tempo;
  if (timeSig) song.timeSig = timeSig;
  if (keyFifths !== undefined) {
    song.keyFifths = keyFifths;
    if (keyMode) song.keyMode = keyMode;
  }
  if (tempoEvents.length > 1) {
    const tm = [];
    for (const t of tempoEvents.sort((a, b) => a.tick - b.tick)) {
      const beat = r6(t.tick / division);
      const last = tm[tm.length - 1];
      if (last && Math.abs(last.beat - beat) < 1e-6) last.bpm = t.bpm;
      else if (!last || last.bpm !== t.bpm) tm.push({ beat, bpm: t.bpm });
    }
    if (tm.length && tm[0].beat > 0) tm.unshift({ beat: 0, bpm: tm[0].bpm });
    if (tm.length > 1) song.tempoMap = tm;
  }

  const named = noteTracks.map((t) => handFromName(t.name));
  const useNames = named.some((h) => h);
  noteTracks.forEach((t, i) => {
    for (const n of t.notes) {
      let hand;
      if (useNames && named[i]) hand = named[i];
      else if (noteTracks.length === 1) hand = n.midi >= 60 ? 'R' : 'L';
      else if (!useNames && i === 0) hand = 'R';
      else if (!useNames && i === 1) hand = 'L';
      else hand = avg(t) >= 60 ? 'R' : 'L';
      song.notes.push({
        midi: n.midi,
        start: r6(n.startTick / division),
        dur: r6((n.endTick - n.startTick) / division),
        hand,
        finger: null,
        velocity: n.vel,
      });
    }
  });
  song.notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
  if (song.tempoMap) report.details.push(`${song.tempoMap.length - 1} changement${song.tempoMap.length > 2 ? 's' : ''} de tempo`);
  cleanLivePerformance(song, tempoEvents, division, report);
  song.importReport = report;
  if (song.keyFifths === undefined && song.notes.length) {
    const k = estimateKey(song.notes);
    song.keyFifths = k.fifths;
    song.keyMode = k.mode;
    song.keyEstimated = true;
  }
  return song;
}

/**
 * MIDI joué en direct (notes à côté de la grille) : remet le rythme au propre.
 *  - notes presque sur la grille (enregistré au métronome) : simple recalage sur la double croche ;
 *  - notes sans rapport avec la grille du fichier (joué librement) : tempo, mesure et premier temps sont
 *    retrouvés à l'oreille, comme pour un enregistrement audio (analyzePerformance).
 * Un fichier écrit proprement (éditeur de partitions, séquenceur quantifié) n'est jamais modifié.
 */
function cleanLivePerformance(song, tempoEvents, division, report) {
  const notes = song.notes;
  if (notes.length < 8) return;
  const off = (x, g) => Math.abs(x / g - Math.round(x / g)) * g;
  const fine = (x) => Math.min(off(x, 0.125), off(x, 1 / 12));
  const exact = notes.filter((n) => fine(n.start) < 0.012).length / notes.length;
  if (exact >= 0.9) return;
  const mean16 = notes.reduce((s, n) => s + off(n.start, 0.25), 0) / notes.length;
  if (mean16 < 0.045) {
    const g = 0.25;
    const q = (x) => Math.round(x / g) * g;
    for (const n of notes) {
      const st = q(n.start);
      n.dur = r6(Math.max(g, q(n.start + n.dur) - st));
      n.start = r6(st);
    }
    notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
    report.details.push('joué en direct : notes replacées sur la grille (doubles croches)');
    return;
  }
  // temps (noires du fichier) → secondes, en suivant les changements de tempo
  const tm = tempoEvents.map((t) => ({ beat: t.tick / division, bpm: t.bpm })).sort((a, b) => a.beat - b.beat);
  if (!tm.length || tm[0].beat > 0) tm.unshift({ beat: 0, bpm: tm.length ? tm[0].bpm : 120 });
  let acc = 0;
  for (let k = 0; k < tm.length; k++) { tm[k].sec = acc; if (k + 1 < tm.length) acc += ((tm[k + 1].beat - tm[k].beat) * 60) / tm[k].bpm; }
  const toSec = (b) => { let k = tm.length - 1; while (k > 0 && tm[k].beat > b) k--; return tm[k].sec + ((b - tm[k].beat) * 60) / tm[k].bpm; };
  const res = analyzePerformance(notes.map((n) => ({ midi: n.midi, startSec: toSec(n.start), durSec: toSec(n.start + n.dur) - toSec(n.start), velocity: n.velocity, hand: n.hand })));
  const raw = toRawSong(res, {});
  if (!raw.notes.length) return;
  song.notes = raw.notes.map(({ uncertain, ...n }) => n);
  song.tempo = raw.tempo;
  song.timeSig = raw.timeSig;
  delete song.tempoMap;
  if (song.keyFifths === undefined) { song.keyFifths = raw.keyFifths; song.keyEstimated = true; }
  report.details.push(`joué en direct sans métronome : rythme remis au propre (♩ = ${raw.tempo}, ${raw.timeSig.join('/')})`);
  report.warnings.push('Ce MIDI a été joué librement : le tempo et la mesure ont été estimés. Vérifie le début des mesures.');
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function vlq(v) {
  v = Math.max(0, Math.floor(v));
  const bytes = [v & 0x7f];
  v = Math.floor(v / 128);
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  return bytes;
}

function metaText(type, text) {
  const b = Array.from(new TextEncoder().encode(String(text)));
  return [0xff, type, ...vlq(b.length), ...b];
}

function chunk(id, data) {
  const l = data.length;
  const out = [...id].map((c) => c.charCodeAt(0));
  out.push((l >>> 24) & 255, (l >>> 16) & 255, (l >>> 8) & 255, l & 255);
  for (let k = 0; k < l; k++) out.push(data[k]);
  return out;
}

function trackChunk(events) {
  // events: [{tick, order, bytes}]
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const data = [];
  let last = 0;
  for (const e of events) {
    for (const b of vlq(e.tick - last)) data.push(b);
    for (const b of e.bytes) data.push(b);
    last = e.tick;
  }
  data.push(0, 0xff, 0x2f, 0);
  return chunk('MTrk', data);
}

/**
 * Exporte un morceau en fichier MIDI format 1.
 * @param {object} song morceau (préparé ou brut avec notes[])
 * @returns {Uint8Array}
 */
export function exportMidi(song) {
  const PPQ = 480;
  const tempo = song.tempo > 0 ? song.tempo : 90;
  const [num, den] = song.timeSig || [4, 4];
  const us = Math.max(1, Math.min(0xffffff, Math.round(60000000 / tempo)));
  const sf = Math.max(-7, Math.min(7, Math.round(song.keyFifths || 0)));
  const meta = [
    { tick: 0, order: 0, bytes: metaText(0x03, song.title || 'Sans titre') },
    { tick: 0, order: 1, bytes: [0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255] },
    { tick: 0, order: 2, bytes: [0xff, 0x58, 4, num & 255, Math.max(0, Math.round(Math.log2(den))), 24, 8] },
    { tick: 0, order: 3, bytes: [0xff, 0x59, 2, sf & 255, song.keyMode === 'minor' ? 1 : 0] },
  ];
  for (const t of song.tempoMap || []) {
    if (!(t.beat > 0) || !(t.bpm > 0)) continue;
    const u = Math.max(1, Math.min(0xffffff, Math.round(60000000 / t.bpm)));
    meta.push({ tick: Math.round(t.beat * PPQ), order: 5, bytes: [0xff, 0x51, 3, (u >> 16) & 255, (u >> 8) & 255, u & 255] });
  }
  if (song.composer) meta.push({ tick: 0, order: 4, bytes: metaText(0x02, song.composer) });
  const chunks = [trackChunk(meta)];
  const hands = [
    ['R', 'Main droite', 0],
    ['L', 'Main gauche', 1],
  ];
  for (const [hand, name, ch] of hands) {
    const notes = (song.notes || []).filter((n) => (n.hand === 'L' ? 'L' : 'R') === hand && Number.isFinite(n.midi) && n.midi >= 0 && n.midi <= 127 && n.dur > 0);
    if (!notes.length) continue;
    const ev = [
      { tick: 0, order: -2, bytes: metaText(0x03, name) },
      { tick: 0, order: -1, bytes: [0xc0 | ch, 0] },
    ];
    for (const n of notes) {
      const s = Math.max(0, Math.round(n.start * PPQ));
      const e = Math.max(s + 1, Math.round((n.start + n.dur) * PPQ));
      const vel = n.velocity >= 1 && n.velocity <= 127 ? Math.round(n.velocity) : 80;
      ev.push({ tick: s, order: 1, bytes: [0x90 | ch, n.midi, vel] });
      ev.push({ tick: e, order: 0, bytes: [0x80 | ch, n.midi, 0] });
    }
    chunks.push(trackChunk(ev));
  }
  const header = chunk('MThd', [0, 1, 0, chunks.length, (PPQ >> 8) & 255, PPQ & 255]);
  const total = header.length + chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of [header, ...chunks]) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}
