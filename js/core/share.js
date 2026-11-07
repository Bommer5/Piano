// Partage d'un morceau par lien, sans serveur : le morceau est sérialisé (notation texte de
// js/core/song.js quand elle est fidèle, sinon JSON compact), compressé (deflate-raw) puis
// encodé en base64url dans l'adresse : #/partage?d=…&from=&to=&tempo=&hands=
import { songToText, parseTextSong, prepareSong } from './song.js';

export const SHARE_MAX_CHARS = 8000; // au-delà, proposer l'export fichier

// ---------- base64url ----------
export function bytesToBase64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64urlToBytes(s) {
  const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
  const pad = b64 + '==='.slice((b64.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------- compression ----------
export const compressionSupported = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

export async function deflate(bytes) {
  return pipe(bytes, new CompressionStream('deflate-raw'));
}

export async function inflate(bytes) {
  return pipe(bytes, new DecompressionStream('deflate-raw'));
}

// ---------- sérialisation ----------
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const sameNotes = (a, b) => {
  if (a.length !== b.length) return false;
  const key = (n) => `${n.hand}|${n.midi}|${r4(n.start)}|${r4(n.dur)}|${n.finger || 0}`;
  const A = a.map(key).sort(), B = b.map(key).sort();
  return A.every((k, i) => k === B[i]);
};

const META_KEYS = { k: 'keyFifths', m: 'keyMode', g: 'genre', l: 'level', c: 'composer', ts: 'timeSig', tp: 'tempo', t: 'title', pu: 'pickupBeats', sw: 'swing' };

/** Texte à compresser. Renvoie la plus courte des représentations fidèles. */
export function serializeForShare(song) {
  const notes = song.notes || [];
  const fingers = !song.autoFingering;
  const plain = notes.map((n) => ({ ...n, finger: fingers ? n.finger || null : null }));
  // 1) JSON compact (toujours fidèle) : notes [midi, Δdébut, durée, main(0=D,1=G), doigt]
  const meta = {};
  for (const [short, long] of Object.entries(META_KEYS)) if (song[long] != null && song[long] !== '') meta[short] = song[long];
  if (Array.isArray(song.chords) && song.chords.length) meta.ch = song.chords.map((c) => [r4(c.beat), c.symbol]);
  let prev = 0;
  const sorted = [...plain].sort((a, b) => a.start - b.start || a.midi - b.midi);
  meta.n = sorted.map((n) => {
    const d = r4(n.start - prev);
    prev = n.start;
    const row = [n.midi, d, r4(n.dur), n.hand === 'L' ? 1 : 0];
    if (n.finger) row.push(n.finger);
    return row;
  });
  const json = 'J' + JSON.stringify(meta);
  // 2) notation texte de l'application, si l'aller-retour est exact (mains monophoniques ou accords « carrés »)
  let best = json;
  try {
    const lines = songToText({ ...song, notes: plain }).trimEnd().split('\n');
    if (song.keyFifths) lines.push(`armure: ${song.keyFifths}`);
    if (song.keyMode) lines.push(`mode: ${song.keyMode}`);
    if (song.genre) lines.push(`genre: ${song.genre}`);
    if (song.level) lines.push(`niveau: ${song.level}`);
    if (meta.ch) lines.push(`accords: ${song.chords.map((c) => `${r4(c.beat)}=${c.symbol}`).join(' ')}`);
    const text = 'T' + lines.join('\n');
    const back = parseTextSong(text.slice(1));
    const re = prepareSong(back).notes;
    const exact = sameNotes(re.map((n) => ({ ...n, finger: fingers ? n.finger : null })), plain) && (fingers || true);
    // sans doigtés écrits, prepareSong recalcule les doigtés : on compare sans eux
    const exactNoFinger = sameNotes(re.map((n) => ({ ...n, finger: null })), plain.map((n) => ({ ...n, finger: null })));
    if ((fingers ? exact : exactNoFinger) && text.length < best.length) best = text;
  } catch {
    // on garde le JSON
  }
  return best;
}

/** Texte de partage -> morceau « brut » (à passer à prepareSong). */
export function deserializeShare(text) {
  if (text[0] === 'J') {
    const m = JSON.parse(text.slice(1));
    const raw = {};
    for (const [short, long] of Object.entries(META_KEYS)) if (m[short] != null) raw[long] = m[short];
    let t = 0;
    raw.notes = (m.n || []).map(([midi, d, dur, h, f]) => {
      t = r4(t + d);
      return { midi, start: t, dur, hand: h ? 'L' : 'R', finger: f || null };
    });
    if (Array.isArray(m.ch)) raw.chords = m.ch.map(([beat, symbol]) => ({ beat, symbol }));
    return raw;
  }
  if (text[0] === 'T') {
    const body = text.slice(1);
    const raw = parseTextSong(body);
    for (const line of body.split('\n')) {
      const mm = line.match(/^(armure|mode|accords)\s*:\s*(.*)$/);
      if (!mm) continue;
      if (mm[1] === 'armure') raw.keyFifths = Number(mm[2]) || 0;
      else if (mm[1] === 'mode') raw.keyMode = mm[2].trim();
      else raw.chords = mm[2].split(/\s+/).filter(Boolean).map((x) => { const [b, s] = x.split('='); return { beat: Number(b), symbol: s }; });
    }
    return raw;
  }
  throw new Error('Lien de partage illisible.');
}

/**
 * Encode un morceau pour un lien.
 * @returns {Promise<{d:string, compressed:boolean, chars:number, tooLong:boolean}>}
 */
export async function encodeSong(song, { compress = true } = {}) {
  const text = serializeForShare(song);
  const bytes = new TextEncoder().encode(text);
  let d;
  let compressed = false;
  if (compress && compressionSupported()) {
    try {
      d = 'z' + bytesToBase64url(await deflate(bytes));
      compressed = true;
    } catch {
      d = null;
    }
  }
  if (!d) d = 'p' + bytesToBase64url(bytes);
  return { d, compressed, chars: d.length, tooLong: d.length > SHARE_MAX_CHARS };
}

/** Décode le paramètre « d » d'un lien. */
export async function decodeSong(d) {
  if (!d || typeof d !== 'string') throw new Error('Lien de partage vide.');
  const kind = d[0];
  let bytes = base64urlToBytes(d.slice(1));
  if (kind === 'z') {
    if (!compressionSupported()) throw new Error('Ce navigateur ne sait pas décompresser ce lien (mets-le à jour).');
    bytes = await inflate(bytes);
  } else if (kind !== 'p') throw new Error('Lien de partage illisible.');
  const raw = deserializeShare(new TextDecoder().decode(bytes));
  if (!raw.title) raw.title = 'Morceau partagé';
  return raw;
}

/**
 * Adresse complète de partage.
 * @param {string} base ex. location.origin + location.pathname
 * @param {{from?:number,to?:number,tempo?:number,hands?:string}} opts mesures (1 = première), tempo en %, mains 'R'|'L'|'both'
 */
export async function buildShareUrl(song, base = '', opts = {}) {
  const enc = await encodeSong(song);
  const q = new URLSearchParams({ d: enc.d });
  for (const k of ['from', 'to', 'tempo', 'hands']) if (opts[k] != null && opts[k] !== '') q.set(k, String(opts[k]));
  return { url: `${base}#/partage?${q.toString()}`, ...enc };
}

/** Lit les paramètres d'un lien de partage (partie après « ? »). */
export function parseShareQuery(query) {
  const num = (x) => (x != null && x !== '' && Number.isFinite(Number(x)) ? Number(x) : null);
  return {
    d: query.d || null,
    from: num(query.from),
    to: num(query.to),
    tempo: num(query.tempo),
    hands: ['R', 'L', 'both'].includes(query.hands) ? query.hands : null,
  };
}
