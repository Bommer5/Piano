// Point d'entrée de l'import / export de partitions.
import { parseTextSong, songToText, prepareSong } from '../core/song.js';
import { parseMusicXML, exportMusicXML } from './musicxml.js';
import { parseMXL, decodeText } from './mxl.js';
import { parseMidi, exportMidi } from './midi.js';
import { parseABC } from './abc.js';
import { transcribeAsync, toRawSong } from '../core/transcribe.js';

export const SUPPORTED_FORMATS = [
  { ext: '.musicxml', label: 'MusicXML', description: 'Format standard d’échange de partitions (MuseScore, Finale, Sibelius, Dorico…).' },
  { ext: '.xml', label: 'MusicXML (.xml)', description: 'Fichier MusicXML non compressé portant l’extension .xml.' },
  { ext: '.mxl', label: 'MusicXML compressé', description: 'Archive MusicXML compressée, export par défaut de MuseScore.' },
  { ext: '.mid', label: 'MIDI', description: 'Fichier MIDI standard (format 0 ou 1) : notes, tempo, mesure. Pas de doigtés.' },
  { ext: '.midi', label: 'MIDI (.midi)', description: 'Fichier MIDI standard, autre extension.' },
  { ext: '.abc', label: 'ABC', description: 'Notation texte ABC, très utilisée pour les airs traditionnels (abcnotation.com).' },
  { ext: '.json', label: 'JSON (application)', description: 'Morceau exporté par cette application : { title, notes } ou { title, tracks }.' },
  { ext: '.txt', label: 'Texte (application)', description: 'Notation compacte éditable à la main : « MD: E4:1:3 D4:1:2 … », « MG: … ».' },
  {
    ext: '.mp3,.wav,.ogg,.m4a,.flac,.webm',
    label: 'Audio (transcription automatique)',
    audio: true,
    description:
      'Enregistrement (MP3, WAV, OGG, M4A, FLAC, WebM ou enregistrement au micro) converti automatiquement en partition : ' +
      'notes, rythme, tempo, mesure et tonalité sont estimés. Fonctionne au mieux avec du piano seul ou une mélodie bien nette ' +
      '(pas de chant, de batterie ni d’orchestre). Le résultat est une approximation : vérifie-le et corrige-le si besoin.',
  },
];

const AUDIO_EXT = new Set(['mp3', 'wav', 'wave', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'mp4', 'flac', 'webm', 'weba']);

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

/** Reconnaît un fichier audio d'après ses premiers octets. */
function sniffAudio(u8) {
  const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
  const at = (off, s) => u8.length >= off + s.length && ascii(s).every((c, i) => u8[off + i] === c);
  if (at(0, 'RIFF') && (at(8, 'WAVE') || at(8, 'RF64'))) return 'wav';
  if (at(0, 'RF64') && at(8, 'WAVE')) return 'wav';
  if (at(0, 'ID3')) return 'mp3';
  // synchro de trame MPEG / ADTS (exclut FF FE, le BOM UTF-16)
  if (u8.length > 2 && u8[0] === 0xff && [0xfb, 0xfa, 0xf3, 0xf2, 0xe3, 0xe2, 0xf1, 0xf9].includes(u8[1])) return 'mp3';
  if (at(0, 'OggS')) return 'ogg';
  if (at(0, 'fLaC')) return 'flac';
  if (at(4, 'ftyp')) return 'm4a';
  if (startsWith(u8, [0x1a, 0x45, 0xdf, 0xa3])) return 'webm';
  if (at(0, 'FORM') && (at(8, 'AIFF') || at(8, 'AIFC'))) return 'aiff';
  return null;
}

/**
 * Décode un WAV PCM (8/16/24/32 bits entiers, 32/64 bits flottants) → mono.
 * Renvoie null si l'encodage n'est pas géré (le navigateur prend alors le relais).
 */
export function decodeWav(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const tag = (o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
  if (u8.length < 12 || (tag(0) !== 'RIFF' && tag(0) !== 'RF64') || tag(8) !== 'WAVE') return null;
  let fmt = null, data = null;
  for (let off = 12; off + 8 <= u8.length; ) {
    const id = tag(off);
    let size = dv.getUint32(off + 4, true);
    const body = off + 8;
    if (id === 'data' && (size === 0xffffffff || size === 0 || body + size > u8.length)) size = u8.length - body;
    if (id === 'fmt ' && size >= 16) {
      let format = dv.getUint16(body, true);
      if (format === 0xfffe && size >= 26) format = dv.getUint16(body + 24, true);
      fmt = { format, channels: dv.getUint16(body + 2, true), sampleRate: dv.getUint32(body + 4, true), bits: dv.getUint16(body + 14, true) };
    } else if (id === 'data') {
      data = { off: body, size };
    }
    off = body + size + (size & 1);
  }
  if (!fmt || !data || !fmt.channels || !fmt.sampleRate) return null;
  const { format, channels, bits } = fmt;
  const bytes = bits / 8;
  if (!((format === 1 && [8, 16, 24, 32].includes(bits)) || (format === 3 && (bits === 32 || bits === 64)))) return null;
  const frames = Math.floor(data.size / (bytes * channels));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < channels; c++) {
      const o = data.off + (i * channels + c) * bytes;
      let v;
      if (format === 3) v = bits === 32 ? dv.getFloat32(o, true) : dv.getFloat64(o, true);
      else if (bits === 8) v = (u8[o] - 128) / 128;
      else if (bits === 16) v = dv.getInt16(o, true) / 32768;
      else if (bits === 24) v = ((u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16)) << 8 >> 8) / 8388608;
      else v = dv.getInt32(o, true) / 2147483648;
      s += v;
    }
    out[i] = s / channels;
  }
  return { samples: out, sampleRate: fmt.sampleRate };
}

/** Décode un fichier audio (navigateur : Web Audio ; Node : WAV PCM uniquement) → mono. */
async function decodeAudio(u8, kind) {
  if (kind === 'wav') {
    const w = decodeWav(u8);
    if (w) return w;
  }
  const AC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext || globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) {
    throw new Error(
      kind === 'wav'
        ? 'Ce fichier WAV utilise un encodage non pris en charge (seuls les WAV PCM 8/16/24/32 bits et flottants sont lus ici).'
        : 'Le décodage de ce format audio nécessite un navigateur récent (Web Audio). Convertis le fichier en WAV ou ouvre l’application dans Chrome, Firefox, Edge ou Safari.',
    );
  }
  const offline = AC === globalThis.OfflineAudioContext || AC === globalThis.webkitOfflineAudioContext;
  // 22 050 Hz suffisent pour la transcription (le navigateur rééchantillonne au décodage)
  const ctx = offline ? new AC(1, 1, 22050) : new AC();
  const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  let audio;
  try {
    audio = await new Promise((resolve, reject) => {
      const p = ctx.decodeAudioData(buf, resolve, reject);
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    });
  } catch (e) {
    throw new Error('Impossible de décoder ce fichier audio (format non pris en charge par le navigateur ou fichier abîmé).');
  } finally {
    if (!offline && typeof ctx.close === 'function') ctx.close().catch(() => {});
  }
  return { samples: downmix(audio), sampleRate: audio.sampleRate };
}

/** Mixe un AudioBuffer (ou objet équivalent) en mono. */
function downmix(audio) {
  if (audio instanceof Float32Array) return audio;
  const nc = audio.numberOfChannels || 1;
  if (nc === 1) return audio.getChannelData(0);
  const out = new Float32Array(audio.length);
  for (let c = 0; c < nc; c++) {
    const d = audio.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] += d[i] / nc;
  }
  return out;
}

const NO_NOTE_AUDIO = 'Aucune note n’a pu être détectée dans cet enregistrement (silence, bruit ou son trop faible ?). Essaie un enregistrement plus net, idéalement de piano seul.';

/**
 * Transcrit des échantillons (Float32Array mono ou AudioBuffer) en morceau brut prêt pour prepareSong.
 * @param {Float32Array|AudioBuffer} audio
 * @param {number} sampleRate
 * @param {{title?:string, fileName?:string, onProgress?:(f:number)=>void, grid?:number, polyphonic?:boolean}} [opts]
 */
export async function transcribeAudioBuffer(audio, sampleRate, opts = {}) {
  const samples = downmix(audio);
  const sr = sampleRate || audio.sampleRate;
  const { title, fileName, ...topts } = opts;
  const res = await transcribeAsync(samples, sr, topts);
  if (!res.notes.length) throw new Error(NO_NOTE_AUDIO);
  const raw = toRawSong(res, { title: title || baseName(fileName) || 'Enregistrement', grid: opts.grid });
  raw.transcription = { confidence: res.confidence, keyName: res.keyName, tuningCents: res.tuningCents, duration: res.duration };
  raw.source = { format: 'audio', fileName: fileName || null };
  return raw;
}

async function importAudio(u8, name, kind, opts) {
  const { samples, sampleRate } = await decodeAudio(u8, kind);
  const raw = await transcribeAudioBuffer(samples, sampleRate, { ...opts, fileName: name });
  delete raw.source;
  const song = finalize(raw, name, 'audio');
  song.transcribed = true;
  return song;
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
 * Les fichiers audio sont transcrits automatiquement (voir js/core/transcribe.js).
 * @param {{name: string, arrayBuffer: () => Promise<ArrayBuffer>, text?: () => Promise<string>}} file
 * @param {{onProgress?:(fraction:number)=>void, grid?:number, polyphonic?:boolean}} [opts] options de transcription audio
 */
export async function importScoreFile(file, opts = {}) {
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
  if (!kind) {
    const audioKind = sniffAudio(u8);
    if (audioKind || AUDIO_EXT.has(ext)) return importAudio(u8, name, audioKind || (ext === 'wave' ? 'wav' : ext), opts);
  }
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
