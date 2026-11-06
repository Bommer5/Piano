// Lecture des fichiers MusicXML compressés (.mxl = archive ZIP).
// Méthodes prises en charge : 0 (stockée) et 8 (deflate, via DecompressionStream('deflate-raw')).
import { parseMusicXML } from './musicxml.js';
import { parseXML } from './xml.js';

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const MAX_ENTRIES = 10000;
const MAX_UNCOMPRESSED = 200 * 1024 * 1024;

function zipError(msg) {
  return new Error(`Fichier MXL invalide : ${msg}`);
}

/** Décode des octets en texte (UTF-8 par défaut, UTF-16 si BOM). */
export function decodeText(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8.subarray(2));
  if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8.subarray(2));
  if (u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) return new TextDecoder('utf-8').decode(u8.subarray(3));
  // UTF-16 sans BOM : « <\0?\0 » ou « \0<\0? »
  if (u8.length > 3 && u8[0] === 0x3c && u8[1] === 0 && u8[3] === 0) return new TextDecoder('utf-16le').decode(u8);
  if (u8.length > 3 && u8[0] === 0 && u8[1] === 0x3c && u8[2] === 0) return new TextDecoder('utf-16be').decode(u8);
  return new TextDecoder('utf-8').decode(u8);
}

/**
 * Liste les entrées d'une archive ZIP.
 * @returns {Array<{name, method, flags, compSize, size, dataOffset}>}
 */
export function readZipEntries(buffer) {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const len = u8.length;
  if (len < 22) throw zipError('archive trop courte ou tronquée.');
  const dec = new TextDecoder('utf-8');

  const localDataOffset = (off) => {
    if (off + 30 > len || dv.getUint32(off, true) !== SIG_LOCAL) throw zipError('en-tête local corrompu.');
    const nl = dv.getUint16(off + 26, true);
    const el = dv.getUint16(off + 28, true);
    return off + 30 + nl + el;
  };

  // 1) Recherche de l'enregistrement de fin de répertoire central.
  let eocd = -1;
  for (let p = len - 22; p >= Math.max(0, len - 22 - 65535); p--) {
    if (dv.getUint32(p, true) === SIG_EOCD) {
      eocd = p;
      break;
    }
  }
  const entries = [];
  if (eocd >= 0) {
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    if (count > MAX_ENTRIES) throw zipError('trop d’entrées dans l’archive.');
    for (let k = 0; k < count; k++) {
      if (p + 46 > len || dv.getUint32(p, true) !== SIG_CENTRAL) throw zipError('répertoire central corrompu.');
      const flags = dv.getUint16(p + 8, true);
      const method = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const size = dv.getUint32(p + 24, true);
      const nl = dv.getUint16(p + 28, true);
      const el = dv.getUint16(p + 30, true);
      const cl = dv.getUint16(p + 32, true);
      const localOff = dv.getUint32(p + 42, true);
      if (p + 46 + nl > len) throw zipError('répertoire central tronqué.');
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
      entries.push({ name, method, flags, compSize, size, dataOffset: localDataOffset(localOff) });
      p += 46 + nl + el + cl;
    }
    return entries;
  }

  // 2) Secours : parcours séquentiel des en-têtes locaux.
  let p = 0;
  while (p + 30 <= len && dv.getUint32(p, true) === SIG_LOCAL) {
    const flags = dv.getUint16(p + 6, true);
    const method = dv.getUint16(p + 8, true);
    const compSize = dv.getUint32(p + 18, true);
    const size = dv.getUint32(p + 22, true);
    const nl = dv.getUint16(p + 26, true);
    const el = dv.getUint16(p + 28, true);
    if ((flags & 8) && compSize === 0) throw zipError('archive sans répertoire central et à tailles différées.');
    const name = dec.decode(u8.subarray(p + 30, Math.min(len, p + 30 + nl)));
    const dataOffset = p + 30 + nl + el;
    entries.push({ name, method, flags, compSize, size, dataOffset });
    p = dataOffset + compSize;
    if (entries.length > MAX_ENTRIES) throw zipError('trop d’entrées dans l’archive.');
  }
  if (!entries.length) throw zipError('ce n’est pas une archive ZIP.');
  return entries;
}

async function inflateRaw(data) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Votre navigateur ne sait pas décompresser les fichiers .mxl. Exportez la partition en MusicXML non compressé (.musicxml).');
  }
  try {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    throw zipError('données compressées corrompues.');
  }
}

/** Extrait le contenu (octets) d'une entrée. */
export async function readZipEntry(buffer, entry) {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (entry.flags & 1) throw zipError('archive chiffrée (mot de passe) non prise en charge.');
  const end = entry.dataOffset + entry.compSize;
  if (end > u8.length) throw zipError(`l’entrée « ${entry.name} » est tronquée.`);
  const data = u8.subarray(entry.dataOffset, end);
  if (entry.method === 0) return data.slice();
  if (entry.method === 8) {
    if (entry.size > MAX_UNCOMPRESSED) throw zipError('contenu trop volumineux.');
    return inflateRaw(data);
  }
  throw zipError(`méthode de compression ${entry.method} non prise en charge (seules « stockée » et « deflate » le sont).`);
}

/**
 * Lit un fichier .mxl et renvoie le morceau brut.
 * @param {ArrayBuffer|Uint8Array} arrayBuffer
 */
export async function parseMXL(arrayBuffer) {
  const entries = readZipEntries(arrayBuffer);
  const byName = new Map(entries.map((e) => [e.name, e]));
  let target = null;
  const container = byName.get('META-INF/container.xml');
  if (container) {
    try {
      const root = parseXML(decodeText(await readZipEntry(arrayBuffer, container)));
      const rootfiles = root.descendants('rootfile');
      const pick =
        rootfiles.find((r) => /musicxml/i.test(r.attr('media-type', 'musicxml'))) || rootfiles[0];
      const path = pick && pick.attr('full-path');
      if (path) target = byName.get(path) || byName.get(path.replace(/^\/+/, '')) || null;
    } catch {
      target = null; // container.xml illisible : on cherche nous-mêmes
    }
  }
  if (!target) {
    target = entries.find((e) => !e.name.startsWith('META-INF/') && /\.(musicxml|xml)$/i.test(e.name));
  }
  if (!target) throw zipError('aucune partition MusicXML trouvée dans l’archive.');
  const text = decodeText(await readZipEntry(arrayBuffer, target));
  return parseMusicXML(text);
}
