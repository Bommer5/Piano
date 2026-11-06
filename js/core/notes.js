// Utilitaires de notes : conversions MIDI <-> fréquence <-> nom.

export const NAMES_EN_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const NAMES_EN_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
export const NAMES_FR_SHARP = ['Do', 'Do#', 'Ré', 'Ré#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
export const NAMES_FR_FLAT = ['Do', 'Ré♭', 'Ré', 'Mi♭', 'Mi', 'Fa', 'Sol♭', 'Sol', 'La♭', 'La', 'Si♭', 'Si'];

export const PIANO_MIN = 21; // La0
export const PIANO_MAX = 108; // Do8

const BLACK = new Set([1, 3, 6, 8, 10]);

export function isBlack(midi) {
  return BLACK.has(((midi % 12) + 12) % 12);
}

export function midiToFreq(midi, a4 = 440) {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

export function freqToMidiFloat(freq, a4 = 440) {
  return 69 + 12 * Math.log2(freq / a4);
}

export function freqToMidi(freq, a4 = 440) {
  return Math.round(freqToMidiFloat(freq, a4));
}

/** Écart en cents entre une fréquence et une note MIDI. */
export function centsOff(freq, midi, a4 = 440) {
  return 1200 * Math.log2(freq / midiToFreq(midi, a4));
}

export function pitchClass(midi) {
  return ((midi % 12) + 12) % 12;
}

export function octaveOf(midi) {
  return Math.floor(midi / 12) - 1;
}

/**
 * Nom lisible d'une note.
 * @param {number} midi
 * @param {{lang?: 'fr'|'en', flats?: boolean, octave?: boolean}} opts
 */
export function midiToName(midi, { lang = 'fr', flats = false, octave = true } = {}) {
  const table = lang === 'en' ? (flats ? NAMES_EN_FLAT : NAMES_EN_SHARP) : (flats ? NAMES_FR_FLAT : NAMES_FR_SHARP);
  const n = table[pitchClass(midi)];
  return octave ? n + octaveOf(midi) : n;
}

const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SOLFEGE = [['sol', 'G'], ['do', 'C'], ['ut', 'C'], ['re', 'D'], ['ré', 'D'], ['mi', 'E'], ['fa', 'F'], ['la', 'A'], ['si', 'B']];

/**
 * Convertit un nom de note en numéro MIDI. Accepte « C#4 », « Db4 », « Do#4 », « Ré4 », « Sib3 », « mi♭5 »…
 * Renvoie null si le nom est invalide.
 */
export function nameToMidi(name) {
  if (typeof name !== 'string') return null;
  let s = name.trim().replace(/♯/g, '#').replace(/♭/g, 'b');
  let letter = null;
  const lower = s.toLowerCase();
  for (const [sol, l] of SOLFEGE) {
    if (lower.startsWith(sol)) {
      letter = l;
      s = s.slice(sol.length);
      break;
    }
  }
  if (!letter) {
    const c = s[0] && s[0].toUpperCase();
    if (!(c in LETTER_PC)) return null;
    letter = c;
    s = s.slice(1);
  }
  let alter = 0;
  while (s.length && (s[0] === '#' || s[0] === 'b')) {
    alter += s[0] === '#' ? 1 : -1;
    s = s.slice(1);
  }
  if (!/^-?\d+$/.test(s)) return null;
  const oct = parseInt(s, 10);
  const midi = (oct + 1) * 12 + LETTER_PC[letter] + alter;
  if (midi < 0 || midi > 127) return null;
  return midi;
}

/** Nom de la note dans la langue choisie par l'utilisateur ("fr" ou "en"). */
export function noteLabel(midi, settings = {}) {
  return midiToName(midi, { lang: settings.notation || 'fr', flats: !!settings.flats, octave: settings.octave !== false });
}

/** Position diatonique (pour la portée). Renvoie {step: 0..6 (C..B), octave, alter}. */
export function spell(midi, preferFlats = false) {
  const pc = pitchClass(midi);
  const oct = octaveOf(midi);
  const sharpMap = [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [3, 0], [3, 1], [4, 0], [4, 1], [5, 0], [5, 1], [6, 0]];
  const flatMap = [[0, 0], [1, -1], [1, 0], [2, -1], [2, 0], [3, 0], [4, -1], [4, 0], [5, -1], [5, 0], [6, -1], [6, 0]];
  const [step, alter] = (preferFlats ? flatMap : sharpMap)[pc];
  return { step, octave: oct, alter, diatonic: oct * 7 + step };
}

export const FINGER_NAMES = { 1: 'pouce', 2: 'index', 3: 'majeur', 4: 'annulaire', 5: 'auriculaire' };
