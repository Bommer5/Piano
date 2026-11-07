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
 * Numéro d'octave affiché : 'intl' (Do4 = do central, norme scientifique) ou 'fr' (Do3 = do central,
 * usage des conservatoires français).
 */
export function displayOctave(midi, octaveStyle = 'intl') {
  return octaveOf(midi) - (octaveStyle === 'fr' ? 1 : 0);
}

/**
 * Nom lisible d'une note.
 * @param {number} midi
 * @param {{lang?: 'fr'|'en', flats?: boolean, octave?: boolean, octaveStyle?: 'intl'|'fr'}} opts
 */
export function midiToName(midi, { lang = 'fr', flats = false, octave = true, octaveStyle = 'intl' } = {}) {
  const table = lang === 'en' ? (flats ? NAMES_EN_FLAT : NAMES_EN_SHARP) : (flats ? NAMES_FR_FLAT : NAMES_FR_SHARP);
  const n = table[pitchClass(midi)];
  return octave ? n + displayOctave(midi, octaveStyle) : n;
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

/**
 * Nom de la note dans la langue choisie par l'utilisateur ("fr" ou "en").
 * @param {number} midi
 * @param {object} settings réglages ({notation, flats, octave, octaveStyle})
 * @param {{step:number, alter:number, octave:number}|null} spelling orthographe à utiliser (facultatif, cf. spell())
 */
export function noteLabel(midi, settings = {}, spelling = null) {
  const lang = settings.notation || 'fr';
  const octave = settings.octave !== false;
  const octaveStyle = settings.octaveStyle || 'intl';
  if (spelling && Number.isInteger(spelling.step)) return spelledName(spelling, { lang, octave, octaveStyle });
  return midiToName(midi, { lang, flats: !!settings.flats, octave, octaveStyle });
}

const STEP_FR = ['Do', 'Ré', 'Mi', 'Fa', 'Sol', 'La', 'Si'];
const STEP_EN = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const ALTER_SYM = { '-2': '𝄫', '-1': '♭', 0: '', 1: '♯', 2: '𝄪' };
const ALTER_ASCII = { '-2': 'bb', '-1': 'b', 0: '', 1: '#', 2: '##' };

/** Nom d'une note orthographiée ({step 0..6, alter, octave}) : « Mi♯4 », « Do♭5 », « F𝄪3 »… */
export function spelledName(sp, { lang = 'fr', octave = true, octaveStyle = 'intl', ascii = false } = {}) {
  const base = (lang === 'en' ? STEP_EN : STEP_FR)[sp.step];
  const acc = (ascii ? ALTER_ASCII : ALTER_SYM)[sp.alter] ?? '';
  // octave « écrite » : Si♯3 sonne comme Do4 mais s'écrit à l'octave 3
  return base + acc + (octave ? sp.octave - (octaveStyle === 'fr' ? 1 : 0) : '');
}

// --- Orthographe tonale ------------------------------------------------------
// « Ligne des quintes » : Fa=-1, Do=0, Sol=1, Ré=2, La=3, Mi=4, Si=5 ; +7 par dièse, -7 par bémol.
const LOF_LETTERS = [3, 0, 4, 1, 5, 2, 6]; // index de step (C=0..B=6) pour F C G D A E B
const STEP_PCS = [0, 2, 4, 5, 7, 9, 11];

/** Orthographe {step, alter} d'une position sur la ligne des quintes. */
export function lofToSpelling(lof) {
  const idx = (((lof + 1) % 7) + 7) % 7;
  return { step: LOF_LETTERS[idx], alter: Math.floor((lof + 1) / 7) };
}

/** Position sur la ligne des quintes d'une orthographe {step, alter}. */
export function spellingToLof(step, alter = 0) {
  return LOF_LETTERS.indexOf(step) - 1 + 7 * alter;
}

function fromStepAlter(midi, step, alter) {
  const octave = Math.round((midi - alter - STEP_PCS[step]) / 12) - 1;
  return { step, octave, alter, diatonic: octave * 7 + step };
}

/**
 * Choisit l'orthographe tonale d'une hauteur dans une tonalité.
 * @param {number} midi
 * @param {number} keyFifths armure (-7..7)
 * @param {'major'|'minor'|string} keyMode
 * @param {number} [dir] mouvement mélodique vers la note suivante (+1 : monte d'un demi-ton → dièse,
 *        -1 : descend → bémol) ; ne sert que pour les notes chromatiques
 * @returns {number} position sur la ligne des quintes
 */
export function tonalLof(midi, keyFifths = 0, keyMode = 'major', dir = 0) {
  const pc = pitchClass(midi);
  const f = Math.round(keyFifths) || 0;
  const base = (pc * 7) % 12; // lof ≡ base (mod 12)
  const cands = [];
  for (let lof = base - 24; lof <= base + 24; lof += 12) if (lof >= -15 && lof <= 19) cands.push(lof);
  // 1. note diatonique de l'armure (y compris Mi♯, Si♯, Do♭, Fa♭ si l'armure les contient)
  const dia = cands.find((l) => l >= f - 1 && l <= f + 5);
  if (dia !== undefined) return dia;
  // 2. mineur : 6e et 7e degrés haussés (sensible) — ré mineur → Do♯, sol mineur → Fa♯
  if (keyMode === 'minor') {
    const raised = cands.find((l) => l === f + 8 || l === f + 6);
    if (raised !== undefined) return raised;
  }
  // 3. chromatisme : la plus proche du centre de la tonalité (moins d'altérations en cas d'égalité)
  const center = f + 2;
  cands.sort((a, b) => Math.abs(a - center) - Math.abs(b - center) || Math.abs(Math.floor((a + 1) / 7)) - Math.abs(Math.floor((b + 1) / 7)) || a - b);
  if (dir) {
    // note de passage chromatique : dièse en montant (Mi Ré♯ Mi), bémol en descendant
    const two = cands.slice(0, 2).filter((l) => Math.abs(Math.floor((l + 1) / 7)) <= 1 + Math.abs(Math.floor((f + 1) / 7)));
    if (two.length === 2) return dir > 0 ? Math.max(...two) : Math.min(...two);
  }
  return cands[0];
}

/**
 * Position diatonique (pour la portée). Renvoie {step: 0..6 (C..B), octave, alter, diatonic}.
 * Deux formes :
 *   spell(midi, preferFlats)            — ancienne forme : dièses ou bémols systématiques ;
 *   spell(midi, keyFifths, keyMode[, dir]) — orthographe tonale (armure -7..7, mode 'major'|'minor',
 *                                          dir = sens de la note suivante pour les chromatismes).
 */
export function spell(midi, keyOrFlats = false, keyMode, dir = 0) {
  if (typeof keyOrFlats === 'number' && Number.isFinite(keyOrFlats)) {
    const { step, alter } = lofToSpelling(tonalLof(midi, keyOrFlats, keyMode || 'major', dir));
    return fromStepAlter(midi, step, alter);
  }
  const pc = pitchClass(midi);
  const sharpMap = [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [3, 0], [3, 1], [4, 0], [4, 1], [5, 0], [5, 1], [6, 0]];
  const flatMap = [[0, 0], [1, -1], [1, 0], [2, -1], [2, 0], [3, 0], [4, -1], [4, 0], [5, -1], [5, 0], [6, -1], [6, 0]];
  const [step, alter] = (keyOrFlats ? flatMap : sharpMap)[pc];
  return fromStepAlter(midi, step, alter);
}

/**
 * Orthographe imposée (ex. MusicXML <step>/<alter>) : {step:'C'..'B' ou 0..6, alter}.
 * Renvoie null si elle ne correspond pas à la hauteur MIDI (ex. après transposition).
 */
export function spellFrom(midi, spelling) {
  if (!spelling) return null;
  const step = typeof spelling.step === 'string' ? STEP_EN.indexOf(spelling.step.toUpperCase()) : spelling.step;
  const alter = Math.round(spelling.alter || 0);
  if (!(step >= 0 && step <= 6) || Math.abs(alter) > 2) return null;
  if (pitchClass(STEP_PCS[step] + alter) !== pitchClass(midi)) return null;
  return fromStepAlter(midi, step, alter);
}

export const FINGER_NAMES = { 1: 'pouce', 2: 'index', 3: 'majeur', 4: 'annulaire', 5: 'auriculaire' };
