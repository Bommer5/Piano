// Point d'entrée de l'import / export de partitions.
import { parseTextSong, songToText, prepareSong } from '../core/song.js';
import { parseMusicXML, exportMusicXML } from './musicxml.js';
import { parseMXL, decodeText } from './mxl.js';
import { parseMidi, exportMidi } from './midi.js';
import { parseABC } from './abc.js';

export const SUPPORTED_FORMATS = [
  { ext: '.musicxml', label: 'MusicXML', description: 'Format standard d’échange de partitions (MuseScore, Finale, Sibelius, Dorico…).' },
  { ext: '.xml', label: 'MusicXML (.xml)', description: 'Fichier MusicXML non compressé portant l’extension .xml.' },
  { ext: '.mxl', label: 'MusicXML compressé', description: 'Archive MusicXML compressée, export par défaut de MuseScore.' },
  { ext: '.mid', label: 'MIDI', description: 'Fichier MIDI standard (format 0 ou 1) : notes, tempo, mesure. Pas de doigtés.' },
  { ext: '.midi', label: 'MIDI (.midi)', description: 'Fichier MIDI standard, autre extension.' },
  { ext: '.abc', label: 'ABC', description: 'Notation texte ABC, très utilisée pour les airs traditionnels (abcnotation.com).' },
  { ext: '.json', label: 'JSON (application)', description: 'Morceau exporté par cette application : { title, notes } ou { title, tracks }.' },
  { ext: '.txt', label: 'Texte (application)', description: 'Notation compacte éditable à la main : « MD: E4:1:3 D4:1:2 … », « MG: … ».' },
];

const OCR_EXT = new Set(['pdf', 'png', 'jpg', 'jpeg', 'gif', 'bmp', 'tif', 'tiff', 'webp', 'heic']);

function ocrError(ext) {
  const kind = ext === 'pdf' ? 'un PDF' : 'une image';
  return new Error(
    `Impossible d’importer ${kind} directement : une partition scannée ou photographiée doit d’abord être ` +
      'convertie par un logiciel de reconnaissance optique de musique (OCR musical). ' +
      'Outils gratuits : MuseScore 4 (menu Fichier › « Importer PDF »), ou Audiveris. ' +
      'Exportez ensuite le résultat en MusicXML (.musicxml ou .mxl) et importez ce fichier ici.',
  );
}

function extOf(name) {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

function baseName(name) {
  return String(name || '')
    .replace(/^.*[\\/]/, '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_]+/g, ' ')
    .trim();
}

function startsWith(u8, sig) {
  if (u8.length < sig.length) return false;
  for (let k = 0; k < sig.length; k++) if (u8[k] !== sig[k]) return false;
  return true;
}

function sniffBinary(u8) {
  const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
  if (startsWith(u8, ascii('MThd'))) return 'midi';
  if (startsWith(u8, ascii('RIFF')) && u8.length > 12 && String.fromCharCode(...u8.subarray(8, 12)) === 'RMID') return 'midi';
  if (startsWith(u8, [0x50, 0x4b, 0x03, 0x04]) || startsWith(u8, [0x50, 0x4b, 0x05, 0x06])) return 'mxl';
  if (startsWith(u8, ascii('%PDF'))) return 'pdf';
  if (startsWith(u8, [0x89, 0x50, 0x4e, 0x47])) return 'png';
  if (startsWith(u8, [0xff, 0xd8, 0xff])) return 'jpg';
  if (startsWith(u8, ascii('GIF8'))) return 'gif';
  return null;
}

function sniffText(text) {
  const t = text.replace(/^\uFEFF/, '').trimStart();
  if (t.startsWith('<')) return 'musicxml';
  if (t.startsWith('{') || t.startsWith('[')) return 'json';
  if (/^X:\s*\d*\s*$/m.test(t) || /^K:/m.test(t)) return 'abc';
  return 'text';
}

function parseJSONSong(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`Fichier JSON illisible : ${e.message}`);
  }
  if (Array.isArray(data)) data = data[0];
  if (data && data.song && typeof data.song === 'object') data = data.song;
  if (!data || typeof data !== 'object' || (!Array.isArray(data.notes) && !data.tracks)) {
    throw new Error('Ce fichier JSON ne contient pas de morceau : il faut un objet { title, notes: [...] } ou { title, tracks: { R, L } }.');
  }
  const out = {};
  for (const k of ['title', 'composer', 'tempo', 'timeSig', 'keyFifths', 'genre', 'level', 'tracks']) {
    if (data[k] != null) out[k] = data[k];
  }
  if (out.timeSig && !(Array.isArray(out.timeSig) && out.timeSig.length === 2 && out.timeSig.every((x) => x > 0))) delete out.timeSig;
  if (out.tempo != null && !(Number(out.tempo) > 0)) delete out.tempo;
  if (Array.isArray(data.notes)) {
    out.notes = data.notes
      .filter((n) => n && Number.isFinite(Number(n.midi)) && Number.isFinite(Number(n.start)) && Number(n.dur) > 0)
      .map((n) => ({
        midi: Math.round(Number(n.midi)),
        start: Number(n.start),
        dur: Number(n.dur),
        hand: n.hand === 'L' ? 'L' : 'R',
        finger: n.finger >= 1 && n.finger <= 5 ? Number(n.finger) : null,
      }));
  }
  return out;
}

function finalize(raw, nameHint, format) {
  const song = { ...raw };
  for (const k of Object.keys(song)) if (song[k] === undefined || song[k] === null) delete song[k];
  if (!song.title) song.title = baseName(nameHint) || 'Morceau importé';
  const hasNotes = (Array.isArray(song.notes) && song.notes.length) || (song.tracks && (song.tracks.R || song.tracks.L));
  if (!hasNotes) throw new Error('Aucune note trouvée dans ce fichier.');
  song.source = { format, fileName: nameHint || null };
  return song;
}

function parseTextAs(format, text) {
  switch (format) {
    case 'musicxml':
      return parseMusicXML(text);
    case 'abc':
      return parseABC(text);
    case 'json':
      return parseJSONSong(text);
    default:
      return parseTextSong(text);
  }
}

const EXT_TEXT_FORMAT = { musicxml: 'musicxml', xml: 'musicxml', abc: 'abc', json: 'json', txt: 'text' };

/**
 * Importe un morceau à partir d'un texte (MusicXML, ABC, JSON ou format texte de l'application).
 * @param {string} text
 * @param {string} [nameHint] nom de fichier (sert à deviner le format et le titre)
 */
export function importScoreText(text, nameHint = '') {
  if (typeof text !== 'string') throw new Error('Le contenu à importer doit être du texte.');
  if (!text.trim()) throw new Error('Le fichier est vide.');
  const ext = extOf(nameHint);
  if (OCR_EXT.has(ext)) throw ocrError(ext);
  const sniffed = sniffText(text);
  let format = EXT_TEXT_FORMAT[ext] || sniffed;
  // Le contenu l'emporte quand il contredit clairement l'extension.
  if (format !== sniffed && (sniffed === 'musicxml' || sniffed === 'json')) format = sniffed;
  if (format === 'text' && sniffed === 'abc') format = 'abc';
  return finalize(parseTextAs(format, text), nameHint, format);
}

/**
 * Importe un fichier de partition.
 * @param {{name: string, arrayBuffer: () => Promise<ArrayBuffer>, text?: () => Promise<string>}} file
 */
export async function importScoreFile(file) {
  if (!file) throw new Error('Aucun fichier fourni.');
  const name = file.name || '';
  const ext = extOf(name);
  if (OCR_EXT.has(ext)) throw ocrError(ext);
  let u8;
  if (typeof file.arrayBuffer === 'function') u8 = new Uint8Array(await file.arrayBuffer());
  else if (typeof file.text === 'function') return importScoreText(await file.text(), name);
  else throw new Error('Fichier illisible.');
  if (!u8.length) throw new Error('Le fichier est vide.');

  let kind = sniffBinary(u8);
  if (kind && OCR_EXT.has(kind)) throw ocrError(kind);
  if (!kind && (ext === 'mid' || ext === 'midi' || ext === 'kar')) {
    throw new Error('Ce fichier porte l’extension MIDI mais son contenu n’est pas un fichier MIDI valide.');
  }
  if (!kind && ext === 'mxl') throw new Error('Ce fichier .mxl n’est pas une archive valide (fichier corrompu ?).');
  if (kind === 'midi') return finalize(parseMidi(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)), name, 'midi');
  if (kind === 'mxl') return finalize(await parseMXL(u8), name, 'mxl');
  const text = decodeText(u8);
  if (/[\u0000-\u0008\u000e-\u001f]/.test(text.slice(0, 2000))) {
    throw new Error('Format de fichier non reconnu (contenu binaire). Formats acceptés : ' + SUPPORTED_FORMATS.map((f) => f.ext).join(', ') + '.');
  }
  return importScoreText(text, name);
}

function slug(s) {
  return (
    String(s || 'morceau')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 60) || 'morceau'
  );
}

// Dans le format texte, « # » commence un commentaire : on écrit les dièses en bémols
// enharmoniques (F#4 → Gb4) sur les lignes de notes pour que le fichier se relise à l'identique.
const SHARP_TO_FLAT = { C: 'Db', D: 'Eb', F: 'Gb', G: 'Ab', A: 'Bb' };
function textWithFlats(text) {
  return text
    .split('\n')
    .map((line) => (/^(MD|MG):/.test(line) ? line.replace(/\b([CDFGA])#(-?\d)/g, (m, l, o) => SHARP_TO_FLAT[l] + o) : line))
    .join('\n');
}

/**
 * Exporte un morceau.
 * @param {object} song morceau (préparé de préférence)
 * @param {'midi'|'musicxml'|'json'|'text'} format
 * @returns {{filename: string, mime: string, data: Uint8Array|string}}
 */
export function exportSong(song, format) {
  if (!song) throw new Error('Aucun morceau à exporter.');
  const s = song.beatsPerMeasure ? song : prepareSong(song);
  const base = slug(s.title);
  switch (format) {
    case 'midi':
    case 'mid':
      return { filename: `${base}.mid`, mime: 'audio/midi', data: exportMidi(s) };
    case 'musicxml':
    case 'xml':
      return { filename: `${base}.musicxml`, mime: 'application/vnd.recordare.musicxml+xml', data: exportMusicXML(s) };
    case 'json': {
      const obj = {
        title: s.title,
        composer: s.composer,
        tempo: s.tempo,
        timeSig: s.timeSig,
        keyFifths: s.keyFifths || 0,
        genre: s.genre,
        level: s.level,
        notes: s.notes.map((n) => ({ midi: n.midi, start: n.start, dur: n.dur, hand: n.hand, finger: n.finger || null })),
      };
      return { filename: `${base}.json`, mime: 'application/json', data: JSON.stringify(obj, null, 2) + '\n' };
    }
    case 'text':
    case 'txt':
      return { filename: `${base}.txt`, mime: 'text/plain;charset=utf-8', data: textWithFlats(songToText(s)) };
    default:
      throw new Error(`Format d’export inconnu : « ${format} » (choix : midi, musicxml, json, text).`);
  }
}
