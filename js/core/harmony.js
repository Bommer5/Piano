// Harmonie : symboles d'accords <-> classes de hauteurs, reconnaissance d'accords,
// analyse fonctionnelle (degrés), voicings simples, grilles d'accords en texte.
// Logique pure (aucun accès au DOM), testée dans tests/unit/harmony.test.mjs.

export const PC_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const PC_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const PC_FR_SHARP = ['Do', 'Do♯', 'Ré', 'Ré♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];
const PC_FR_FLAT = ['Do', 'Ré♭', 'Ré', 'Mi♭', 'Mi', 'Fa', 'Sol♭', 'Sol', 'La♭', 'La', 'Si♭', 'Si'];
const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SOLFEGE = [['sol', 7], ['do', 0], ['ut', 0], ['ré', 2], ['re', 2], ['mi', 4], ['fa', 5], ['la', 9], ['si', 11]];

export const mod12 = (x) => ((x % 12) + 12) % 12;

/** Nom d'une classe de hauteur. lang 'en' (C, Db) ou 'fr' (Do, Ré♭). */
export function pcName(pc, { flats = false, lang = 'en' } = {}) {
  const t = lang === 'fr' ? (flats ? PC_FR_FLAT : PC_FR_SHARP) : flats ? PC_FLAT : PC_SHARP;
  return t[mod12(pc)];
}

/**
 * Qualités d'accords connues : suffixe -> intervalles (demi-tons depuis la fondamentale).
 * `opt` : intervalles facultatifs pour la reconnaissance au clavier (la quinte juste, et les
 * extensions intermédiaires des accords de 11e / 13e).
 */
const Q = (iv, opt = [], cost = 0.5, id) => ({ iv, opt, cost, id });
export const QUALITIES = {
  '': Q([0, 4, 7], [], 0),
  m: Q([0, 3, 7], [], 0),
  dim: Q([0, 3, 6], [], 0.4),
  aug: Q([0, 4, 8], [], 0.5),
  sus2: Q([0, 2, 7], [], 0.6),
  sus4: Q([0, 5, 7], [], 0.5),
  5: Q([0, 7], [], 0.8),
  6: Q([0, 4, 7, 9], [7], 0.7),
  m6: Q([0, 3, 7, 9], [7], 0.75),
  '6/9': Q([0, 4, 7, 9, 14], [7], 0.9),
  7: Q([0, 4, 7, 10], [7], 0.3),
  maj7: Q([0, 4, 7, 11], [7], 0.35),
  m7: Q([0, 3, 7, 10], [7], 0.3),
  mMaj7: Q([0, 3, 7, 11], [7], 0.8),
  dim7: Q([0, 3, 6, 9], [], 0.4),
  m7b5: Q([0, 3, 6, 10], [], 0.4),
  aug7: Q([0, 4, 8, 10], [], 0.8),
  augMaj7: Q([0, 4, 8, 11], [], 0.9),
  '7sus4': Q([0, 5, 7, 10], [7], 0.6),
  '7b5': Q([0, 4, 6, 10], [], 0.9),
  9: Q([0, 4, 7, 10, 14], [7], 0.6),
  maj9: Q([0, 4, 7, 11, 14], [7], 0.65),
  m9: Q([0, 3, 7, 10, 14], [7], 0.6),
  '9sus4': Q([0, 5, 7, 10, 14], [7], 0.9),
  11: Q([0, 4, 7, 10, 14, 17], [4, 7, 14], 0.9),
  m11: Q([0, 3, 7, 10, 14, 17], [7, 14], 0.85),
  13: Q([0, 4, 7, 10, 14, 21], [7, 14], 0.85),
  maj13: Q([0, 4, 7, 11, 14, 21], [7, 14], 0.95),
  m13: Q([0, 3, 7, 10, 14, 17, 21], [7, 14, 17], 0.95),
  add9: Q([0, 4, 7, 14], [], 0.6),
  madd9: Q([0, 3, 7, 14], [], 0.65),
  add11: Q([0, 4, 7, 17], [], 0.9),
  '7b9': Q([0, 4, 7, 10, 13], [7], 0.8),
  '7#9': Q([0, 4, 7, 10, 15], [7], 0.8),
  '7#11': Q([0, 4, 7, 10, 18], [7], 0.9),
  '7b13': Q([0, 4, 7, 10, 20], [7], 0.95),
};

// Variantes d'écriture -> suffixe normalisé (recherche du plus long préfixe).
const ALIASES = [
  ['maj7', 'maj7'], ['Maj7', 'maj7'], ['ma7', 'maj7'], ['M7', 'maj7'], ['Δ7', 'maj7'], ['Δ', 'maj7'], ['△7', 'maj7'], ['△', 'maj7'], ['j7', 'maj7'],
  ['maj9', 'maj9'], ['Maj9', 'maj9'], ['M9', 'maj9'], ['Δ9', 'maj9'],
  ['maj13', 'maj13'], ['M13', 'maj13'], ['Δ13', 'maj13'],
  ['mMaj7', 'mMaj7'], ['mmaj7', 'mMaj7'], ['m(maj7)', 'mMaj7'], ['mM7', 'mMaj7'], ['-Δ7', 'mMaj7'], ['-Δ', 'mMaj7'], ['minMaj7', 'mMaj7'],
  ['m7b5', 'm7b5'], ['m7(b5)', 'm7b5'], ['-7b5', 'm7b5'], ['min7b5', 'm7b5'], ['ø7', 'm7b5'], ['ø', 'm7b5'], ['Ø7', 'm7b5'], ['Ø', 'm7b5'],
  ['dim7', 'dim7'], ['°7', 'dim7'], ['o7', 'dim7'],
  ['dim', 'dim'], ['°', 'dim'], ['o', 'dim'],
  ['augMaj7', 'augMaj7'], ['maj7#5', 'augMaj7'], ['+maj7', 'augMaj7'],
  ['aug7', 'aug7'], ['+7', 'aug7'], ['7#5', 'aug7'], ['7+5', 'aug7'], ['7(#5)', 'aug7'],
  ['aug', 'aug'], ['+', 'aug'],
  ['7sus4', '7sus4'], ['7sus', '7sus4'], ['9sus4', '9sus4'], ['9sus', '9sus4'],
  ['sus2', 'sus2'], ['sus4', 'sus4'], ['sus', 'sus4'],
  ['madd9', 'madd9'], ['m(add9)', 'madd9'], ['add9', 'add9'], ['add2', 'add9'], ['(add9)', 'add9'], ['add11', 'add11'], ['add4', 'add11'],
  ['6/9', '6/9'], ['69', '6/9'], ['m6', 'm6'], ['-6', 'm6'],
  ['m13', 'm13'], ['-13', 'm13'], ['m11', 'm11'], ['-11', 'm11'], ['m9', 'm9'], ['-9', 'm9'], ['min9', 'm9'],
  ['m7', 'm7'], ['-7', 'm7'], ['min7', 'm7'], ['mi7', 'm7'],
  ['min', 'm'], ['mi', 'm'], ['m', 'm'], ['-', 'm'],
  ['maj', ''], ['M', ''],
  ['13', '13'], ['11', '11'], ['9', '9'], ['7', '7'], ['6', '6'], ['5', '5'],
].sort((a, b) => b[0].length - a[0].length);

/** Lit la fondamentale au début d'une chaîne : « C# », « Bb », « Do », « Ré♭ »… */
export function parseRoot(str) {
  let s = String(str || '');
  let pc = null, len = 0;
  const low = s.toLowerCase();
  for (const [name, p] of SOLFEGE) {
    if (low.startsWith(name)) {
      pc = p;
      len = name.length;
      break;
    }
  }
  if (pc == null) {
    const c = s[0];
    if (!c || !(c in LETTER)) return null; // lettre majuscule obligatoire (« b » seul n'est pas une note)
    pc = LETTER[c];
    len = 1;
  }
  let alter = 0;
  while (len < s.length && /[#♯b♭]/.test(s[len])) {
    // « Cb » = do bémol, mais « Cbdim » n'existe pas : on accepte tous les b/♭ qui suivent la lettre
    alter += s[len] === '#' || s[len] === '♯' ? 1 : -1;
    len++;
  }
  return { pc: mod12(pc + alter), len, flat: alter < 0, sharp: alter > 0 };
}

function applyModifier(iv, mod) {
  const set = new Set(iv);
  const has7 = set.has(10) || set.has(11);
  const ensure7 = () => { if (!has7 && !set.has(9)) set.add(10); };
  switch (mod) {
    case 'b9': set.delete(14); set.add(13); ensure7(); break;
    case '#9': set.delete(14); set.add(15); ensure7(); break;
    case '#11': set.delete(17); set.add(18); ensure7(); break;
    case 'b13': set.delete(21); set.add(20); ensure7(); break;
    case '9': set.add(14); break;
    case '11': set.add(17); break;
    case '13': set.add(21); break;
    case 'b5': set.delete(7); set.add(6); break;
    case '#5': case '+5': set.delete(7); set.add(8); break;
    case 'add9': case 'add2': set.add(14); break;
    case 'add11': case 'add4': set.add(17); break;
    case 'add13': case 'add6': set.add(21); break;
    case 'sus4': case 'sus': set.delete(3); set.delete(4); set.add(5); break;
    case 'sus2': set.delete(3); set.delete(4); set.add(2); break;
    case 'no3': case 'omit3': set.delete(3); set.delete(4); break;
    case 'no5': case 'omit5': set.delete(7); break;
    case 'maj7': set.delete(10); set.add(11); break;
    default: return null;
  }
  return [...set].sort((a, b) => a - b);
}

const MODS = ['add13', 'add11', 'add9', 'add2', 'add4', 'add6', 'omit3', 'omit5', 'maj7', 'sus4', 'sus2', 'no3', 'no5', 'b13', '#11', 'b9', '#9', 'b5', '#5', '+5', '13', '11', '9', 'sus'];

/**
 * Analyse un symbole d'accord.
 * @returns {null | {symbol, root, rootName, quality, suffix, intervals:number[], pcs:number[], bass:number|null, bassName, optional:number[], flats:boolean}}
 */
export function parseChord(symbol) {
  const sym = String(symbol || '').trim().replace(/♯/g, '#').replace(/♭/g, 'b');
  if (!sym) return null;
  const r = parseRoot(sym);
  if (!r) return null;
  let rest = sym.slice(r.len);
  // basse : « /G » à la fin (mais pas « 6/9 »)
  let bass = null, bassFlat = false;
  const slash = rest.match(/\/([A-G][#b]*|(?:do|ré|re|mi|fa|sol|la|si)[#b]*)$/i);
  if (slash && !/6\/9$/.test(rest)) {
    const b = parseRoot(slash[1][0].toUpperCase() + slash[1].slice(1));
    if (!b) return null;
    bass = b.pc;
    bassFlat = b.flat;
    rest = rest.slice(0, rest.length - slash[0].length);
  }
  let quality = '';
  let consumed = 0;
  for (const [alias, q] of ALIASES) {
    if (rest.startsWith(alias)) {
      quality = q;
      consumed = alias.length;
      break;
    }
  }
  let iv = [...QUALITIES[quality].iv];
  const opt = new Set(QUALITIES[quality].opt);
  let tail = rest.slice(consumed).replace(/[(),\s]/g, '');
  let mods = [];
  while (tail.length) {
    const m = MODS.find((x) => tail.startsWith(x));
    if (!m) return null;
    const next = applyModifier(iv, m);
    if (!next) return null;
    iv = next;
    mods.push(m);
    tail = tail.slice(m.length);
  }
  if (mods.some((m) => ['b5', '#5', '+5'].includes(m))) opt.delete(7);
  const pcs = [...new Set(iv.map((x) => mod12(r.pc + x)))].sort((a, b) => a - b);
  const flats = r.flat || bassFlat;
  return {
    symbol: sym,
    root: r.pc,
    rootName: pcName(r.pc, { flats: r.flat }),
    quality,
    suffix: sym.slice(r.len, sym.length - (bass != null ? slash[0].length : 0)),
    mods,
    intervals: iv,
    pcs,
    optional: [...opt].filter((x) => iv.includes(x)),
    bass,
    bassName: bass != null ? pcName(bass, { flats: bassFlat || r.flat }) : null,
    flats: !!flats,
  };
}

/** Classes de hauteurs d'un symbole (raccourci). */
export function chordPcs(symbol) {
  const c = typeof symbol === 'string' ? parseChord(symbol) : symbol;
  if (!c) return [];
  const s = new Set(c.pcs);
  if (c.bass != null) s.add(c.bass);
  return [...s].sort((a, b) => a - b);
}

/** Intervalle (demi-tons, 0..11) de chaque note par rapport à la fondamentale. */
const ivOf = (root, pc) => mod12(pc - root);

/**
 * Le jeu (ensemble de notes MIDI ou de classes de hauteurs) correspond-il à l'accord ?
 * Renversements libres (on compare des classes de hauteurs), quinte juste facultative dans les
 * accords de 4 sons et plus, extensions ajoutées tolérées (9, 13, et altérations sur un accord de
 * dominante), fondamentale facultative en option.
 * @returns {{ok:boolean, missing:number[], extra:number[], present:number[]}}
 */
export function chordMatches(played, chordOrSymbol, { allowRootless = false, tolerateExtensions = true, requireBass = false, minNotes = 0 } = {}) {
  const c = typeof chordOrSymbol === 'string' ? parseChord(chordOrSymbol) : chordOrSymbol;
  if (!c) return { ok: false, missing: [], extra: [], present: [] };
  const list = [...played];
  const P = new Set(list.map(mod12));
  const optional = new Set(c.optional.map((x) => mod12(c.root + x)));
  if (allowRootless) optional.add(c.root);
  // si la quinte juste est facultative, elle l'est aussi pour une triade quand on joue une 7e… non : triade = 3 sons exigés
  const required = c.pcs.filter((pc) => !optional.has(pc));
  if (c.bass != null && !c.pcs.includes(c.bass) && requireBass) required.push(c.bass);
  const missing = required.filter((pc) => !P.has(pc));
  const chordSet = new Set(chordPcs(c));
  const tolerated = new Set();
  if (tolerateExtensions) {
    const has = (x) => c.intervals.some((i) => mod12(i) === x);
    tolerated.add(2); // 9e
    if (!has(10) && !has(11) && !has(3) && has(4)) tolerated.add(9); // 6te sur triade majeure
    if (has(10) || has(11)) tolerated.add(9); // 13e
    if (has(3)) tolerated.add(5); // 11e sur accord mineur
    if (has(4) && has(10)) [1, 3, 6, 8].forEach((x) => tolerated.add(x)); // altérations de dominante
    if (has(4) && has(11)) tolerated.add(6); // #11 lydien
  }
  const extra = [...P].filter((pc) => !chordSet.has(pc) && !tolerated.has(ivOf(c.root, pc)));
  const present = [...P].filter((pc) => chordSet.has(pc));
  let ok = missing.length === 0 && extra.length === 0 && P.size >= Math.min(minNotes || required.length, required.length) && P.size > 0;
  if (ok && requireBass && list.length && list.every((x) => x > 11)) {
    const low = mod12(Math.min(...list));
    if (low !== (c.bass ?? c.root)) ok = false;
  }
  return { ok, missing, extra, present };
}

// ---------- reconnaissance ----------
const ID_QUALITIES = ['', 'm', 'dim', 'aug', 'sus2', 'sus4', '5', '6', 'm6', '7', 'maj7', 'm7', 'mMaj7', 'dim7', 'm7b5', 'aug7', '7sus4', '7b5', '9', 'maj9', 'm9', 'add9', 'madd9', '6/9', '7b9', '7#9', '7#11', '11', 'm11', '13', 'maj13', 'm13', 'add11', '7b13'];

/**
 * Reconnaît un accord à partir de notes MIDI (la plus grave = basse) ou de classes de hauteurs.
 * @param {number[]} notes
 * @param {{key?:{tonic:number,mode:string}, flats?:boolean, pcsOnly?:boolean, max?:number}} opts
 * @returns {{symbol:string, root:number, quality:string, bass:number, inversion:number, score:number, alternatives:string[]}|null}
 */
export function identifyChord(notes, opts = {}) {
  const all = identifyAll(notes, opts);
  if (!all.length) return null;
  return { ...all[0], alternatives: all.slice(1, 4).map((c) => c.symbol) };
}

export function identifyAll(notes, { key = null, flats = null, weights = null } = {}) {
  const list = [...notes].filter((x) => Number.isFinite(x));
  if (!list.length) return [];
  const pcs = [...new Set(list.map(mod12))];
  const bass = mod12(Math.min(...list));
  const hasBass = list.some((x) => x > 11);
  if (pcs.length === 1) {
    const sym = pcName(pcs[0], { flats: flats ?? false });
    return [{ symbol: sym, root: pcs[0], quality: 'note', bass: pcs[0], inversion: 0, score: -1, single: true }];
  }
  const useFlats = flats ?? (key ? keyPrefersFlats(key) : false);
  const scale = key ? scalePcs(key) : null;
  const W = (pc) => (weights ? weights[pc] ?? 1 : 1);
  const res = [];
  for (const root of pcs) {
    for (const q of ID_QUALITIES) {
      const Qd = QUALITIES[q];
      const tset = new Set(Qd.iv.map((x) => mod12(root + x)));
      const opt = new Set(Qd.opt.map((x) => mod12(root + x)));
      let cost = Qd.cost;
      for (const pc of tset) if (!pcs.includes(pc)) cost += opt.has(pc) ? 0.45 : 3;
      for (const pc of pcs) if (!tset.has(pc)) cost += 2.5 * W(pc);
      if (hasBass && root !== bass) cost += tset.has(bass) ? 0.6 : 1.5;
      if (scale) {
        if (!scale.has(root)) cost += 0.25;
        for (const pc of tset) if (!scale.has(pc)) cost += 0.1;
      }
      if (cost > 6) continue;
      const rootName = pcName(root, { flats: useFlats });
      const slash = hasBass && root !== bass ? '/' + pcName(bass, { flats: useFlats }) : '';
      const inversion = !hasBass || root === bass ? 0 : inversionOf(Qd.iv, ivOf(root, bass));
      res.push({ symbol: rootName + q + slash, root, quality: q, bass: hasBass ? bass : root, inversion, score: -cost });
    }
  }
  res.sort((a, b) => b.score - a.score);
  const seen = new Set();
  return res.filter((r) => (seen.has(r.symbol) ? false : seen.add(r.symbol)));
}

function inversionOf(iv, bassIv) {
  if (bassIv === 0) return 0;
  if (bassIv === 3 || bassIv === 4 || bassIv === 2 || bassIv === 5) return 1;
  if (bassIv === 6 || bassIv === 7 || bassIv === 8) return 2;
  if (bassIv === 9 || bassIv === 10 || bassIv === 11) return 3;
  return 4;
}

/** Renversement d'un accord joué : 0 = état fondamental, 1 = 1er (tierce à la basse)… */
export function inversion(midis, chordOrSymbol) {
  const c = typeof chordOrSymbol === 'string' ? parseChord(chordOrSymbol) : chordOrSymbol;
  if (!c || !midis.length) return 0;
  return inversionOf(c.intervals, ivOf(c.root, Math.min(...midis)));
}

export const INVERSION_NAMES = ['état fondamental', '1er renversement', '2e renversement', '3e renversement', 'autre basse'];

// ---------- tonalités et degrés ----------
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const HARM_MINOR = [0, 2, 3, 5, 7, 8, 11];
export const KEY_NAMES_FR = { major: 'majeur', minor: 'mineur' };

export function scalePcs(key) {
  const base = key.mode === 'minor' ? [...new Set([...MINOR, 11])] : MAJOR;
  return new Set(base.map((x) => mod12(key.tonic + x)));
}

/** Tonalité depuis l'armure (nombre de dièses > 0 / bémols < 0). */
export function keyFromFifths(fifths = 0, mode = 'major') {
  const majorTonic = mod12(7 * fifths);
  return mode === 'minor' ? { tonic: mod12(majorTonic + 9), mode: 'minor', fifths } : { tonic: majorTonic, mode: 'major', fifths };
}

/** Armure d'une tonalité (|fifths| <= 6, on préfère Fa♯ à Sol♭ à égalité… -6 pour Sol♭). */
export function fifthsOfKey(key) {
  const majorTonic = key.mode === 'minor' ? mod12(key.tonic + 3) : key.tonic;
  let f = mod12(majorTonic * 7);
  if (f > 6) f -= 12;
  return f;
}

export function keyPrefersFlats(key) {
  return (key.fifths ?? fifthsOfKey(key)) < 0 || (key.mode === 'major' && key.tonic === 5) || (key.mode === 'minor' && [2, 7, 0, 5].includes(key.tonic));
}

/** « Do majeur », « la mineur »… */
export function keyName(key, { lang = 'fr' } = {}) {
  const flats = keyPrefersFlats(key);
  const n = pcName(key.tonic, { flats, lang });
  if (lang === 'en') return `${n} ${key.mode === 'minor' ? 'minor' : 'major'}`;
  return key.mode === 'minor' ? `${n.toLowerCase()} mineur` : `${n} majeur`;
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const MAJOR_DEG = { 0: 'I', 1: '♭II', 2: 'II', 3: '♭III', 4: 'III', 5: 'IV', 6: '♯IV', 7: 'V', 8: '♭VI', 9: 'VI', 10: '♭VII', 11: 'VII' };
const MINOR_DEG = { 0: 'I', 1: '♭II', 2: 'II', 3: 'III', 4: '♮III', 5: 'IV', 6: '♯IV', 7: 'V', 8: 'VI', 9: '♮VI', 10: 'VII', 11: 'VII' };

function qualityFamily(c) {
  const iv = new Set(c.intervals.map(mod12));
  const minor3 = iv.has(3) && !iv.has(4);
  const dim5 = iv.has(6) && !iv.has(7);
  const aug5 = iv.has(8) && !iv.has(7) && iv.has(4);
  let suffix = '';
  let lower = minor3;
  if (minor3 && dim5) {
    suffix = iv.has(9) && !iv.has(10) ? '°7' : iv.has(10) ? 'ø7' : '°';
  } else if (aug5) suffix = '+';
  if (!suffix || suffix === '+') {
    if (iv.has(11) && (c.quality.includes('maj') || c.quality.includes('Maj') || iv.has(4))) suffix += minor3 ? '(maj7)' : 'maj7';
    else if (iv.has(10)) suffix += /13/.test(c.quality) ? '13' : /11/.test(c.quality) ? '11' : /9/.test(c.quality) && !c.quality.includes('add') ? '9' : '7';
    else if (iv.has(9) && c.quality.includes('6')) suffix += '6';
    if (c.quality.startsWith('sus') || c.quality.includes('sus')) suffix += 'sus';
  }
  return { lower, suffix };
}

/**
 * Degré (chiffrage romain) d'un accord dans une tonalité.
 * @returns {{roman:string, degree:number|null, func:'T'|'SD'|'D'|null, diatonic:boolean, secondary:string|null}}
 */
export function romanNumeral(chordOrSymbol, key) {
  const c = typeof chordOrSymbol === 'string' ? parseChord(chordOrSymbol) : chordOrSymbol;
  if (!c || !key) return null;
  const rel = mod12(c.root - key.tonic);
  const table = key.mode === 'minor' ? MINOR_DEG : MAJOR_DEG;
  const scale = key.mode === 'minor' ? MINOR : MAJOR;
  let base = table[rel];
  const { lower, suffix } = qualityFamily(c);
  const plain = base.replace(/[♭♯♮]/, '');
  let roman = (lower ? base.toLowerCase() : base) + suffix;
  const degree = ROMAN.indexOf(plain);
  const diatonicRoot = scale.includes(rel) || (key.mode === 'minor' && rel === 11);
  const sc = scalePcs(key);
  const allIn = c.pcs.every((pc) => sc.has(pc) || (key.mode === 'minor' && mod12(pc - key.tonic) === 11));
  // dominante secondaire : accord majeur / de 7e de dominante hors tonalité qui résout une quinte plus bas
  let secondary = null;
  const iv = new Set(c.intervals.map(mod12));
  const dominantish = iv.has(4) && !iv.has(11) && (iv.has(7) || iv.has(10));
  if (dominantish && !allIn && rel !== 7) {
    const target = mod12(rel + 5);
    const tIdx = scale.indexOf(target);
    if (tIdx >= 0 && target !== 0 && tIdx !== 6) {
      const tq = triadQualityAt(scale, tIdx);
      const tr = ROMAN[tIdx];
      secondary = `V${iv.has(10) ? '7' : ''}/${tq === 'm' ? tr.toLowerCase() : tr}`;
      roman = secondary;
    }
  }
  const funcByDeg = key.mode === 'minor' ? { 0: 'T', 2: 'T', 5: 'T', 1: 'SD', 3: 'SD', 4: 'D', 6: 'D' } : { 0: 'T', 2: 'T', 5: 'T', 1: 'SD', 3: 'SD', 4: 'D', 6: 'D' };
  let func = secondary ? 'D' : degree >= 0 && diatonicRoot ? funcByDeg[degree] : null;
  if (!secondary && degree === 2 && key.mode === 'major') func = 'T';
  return { roman, degree: degree >= 0 ? degree + 1 : null, func, diatonic: allIn && !secondary, secondary, bass: c.bass != null ? c.bass : null };
}

function triadQualityAt(scale, i) {
  const r = scale[i];
  const third = mod12(scale[(i + 2) % 7] - r);
  const fifth = mod12(scale[(i + 4) % 7] - r);
  if (third === 3 && fifth === 6) return 'dim';
  return third === 3 ? 'm' : '';
}

export const FUNCTION_NAMES = { T: 'tonique', SD: 'sous-dominante', D: 'dominante' };

/** Accord diatonique construit sur un degré (1..7) : triade ou accord de 7e. */
export function diatonicChord(key, degree, { seventh = false, flats } = {}) {
  const scale = key.mode === 'minor' ? (degree === 5 || degree === 7 ? HARM_MINOR : MINOR) : MAJOR;
  const i = degree - 1;
  const r = scale[i];
  const iv = [0, 2, 4, 6].slice(0, seventh ? 4 : 3).map((k) => {
    const j = i + k;
    return mod12(scale[j % 7] - r);
  });
  const set = iv.join(',');
  const q = {
    '0,4,7': '', '0,3,7': 'm', '0,3,6': 'dim', '0,4,8': 'aug',
    '0,4,7,11': 'maj7', '0,3,7,10': 'm7', '0,4,7,10': '7', '0,3,6,10': 'm7b5', '0,3,6,9': 'dim7', '0,3,7,11': 'mMaj7', '0,4,8,11': 'augMaj7',
  }[set] ?? '';
  return pcName(mod12(key.tonic + r), { flats: flats ?? keyPrefersFlats(key) }) + q;
}

/** Degré romain -> symbole d'accord dans une tonalité (« ii7 » en Do -> « Dm7 »). */
export function romanToChord(roman, key) {
  const m = String(roman).match(/^([♭b♯#]?)(vii|vi|iv|v|iii|ii|i|VII|VI|IV|V|III|II|I)(.*)$/);
  if (!m) return null;
  const deg = ROMAN.indexOf(m[2].toUpperCase()) + 1;
  const acc = m[1] === '♭' || m[1] === 'b' ? -1 : m[1] ? 1 : 0;
  const scale = key.mode === 'minor' ? MINOR : MAJOR;
  const root = mod12(key.tonic + scale[deg - 1] + acc);
  const lower = m[2] === m[2].toLowerCase();
  let rest = m[3];
  let q = lower ? 'm' : '';
  if (rest === '°') q = 'dim', rest = '';
  else if (rest === '°7') q = 'dim7', rest = '';
  else if (rest === 'ø7' || rest === 'ø') q = 'm7b5', rest = '';
  else if (rest === '+') q = 'aug', rest = '';
  else if (rest === 'maj7') q = lower ? 'mMaj7' : 'maj7', rest = '';
  return pcName(root, { flats: keyPrefersFlats(key) || acc < 0 }) + q + rest;
}

// ---------- voicings ----------
function chordTones(c) {
  // notes à jouer (une seule fois par classe), fondamentale en premier
  const order = [...c.intervals].sort((a, b) => a - b);
  return order;
}

/**
 * Voicing d'un accord.
 * @param {object|string} chordOrSymbol
 * @param {{type?:'root'|'shell'|'close'|'nearest', center?:number, prev?:number[], bassCenter?:number, maxNotes?:number}} opts
 * @returns {{bass:number, notes:number[]}} bass : note de basse (main gauche) ; notes : main droite (ou les deux mains pour « shell »)
 */
export function voicing(chordOrSymbol, { type = 'root', center = 62, prev = null, bassCenter = 43, maxNotes = 4 } = {}) {
  const c = typeof chordOrSymbol === 'string' ? parseChord(chordOrSymbol) : chordOrSymbol;
  if (!c) return { bass: null, notes: [] };
  const bassPc = c.bass ?? c.root;
  const bass = nearestMidi(bassPc, bassCenter);
  let iv = chordTones(c);
  // réduire à maxNotes : on enlève d'abord la quinte juste, puis la fondamentale, puis la 11e
  const drop = [7, 0, 17, 14];
  for (const d of drop) if (iv.length > maxNotes && iv.includes(d) && iv.length > 3) iv = iv.filter((x) => x !== d);
  if (type === 'shell') {
    const third = c.intervals.find((x) => [3, 4].includes(x)) ?? c.intervals.find((x) => [2, 5].includes(x));
    const sev = c.intervals.find((x) => [10, 11].includes(x)) ?? c.intervals.find((x) => x === 9) ?? 7;
    const root = nearestMidi(c.root, bassCenter + 5);
    const notes = [root, root + (third ?? 7), root + sev].sort((a, b) => a - b);
    return { bass, notes, shell: true };
  }
  const pcs = [...new Set(iv.map((x) => mod12(c.root + x)))];
  if (type === 'nearest' && prev && prev.length) {
    return { bass, notes: nearestVoicing(pcs, prev) };
  }
  if (type === 'close' || type === 'nearest') {
    // position serrée la plus proche du centre
    const cands = closeVoicings(pcs, center);
    cands.sort((a, b) => Math.abs(avg(a) - center) - Math.abs(avg(b) - center));
    return { bass, notes: cands[0] };
  }
  // fondamentale : état fondamental, fondamentale la plus proche du centre - 4
  const root = nearestMidi(c.root, center - 4);
  const notes = [...new Set(iv)].map((x) => root + x).sort((a, b) => a - b);
  return { bass, notes };
}

const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;

export function nearestMidi(pc, center) {
  const base = center - mod12(center - pc);
  return center - base > 6 ? base + 12 : base;
}

/** Toutes les positions serrées (renversements) d'un ensemble de classes de hauteurs autour d'un centre. */
function closeVoicings(pcs, center) {
  const res = [];
  const sorted = [...pcs];
  for (let rot = 0; rot < sorted.length; rot++) {
    const order = [...sorted.slice(rot), ...sorted.slice(0, rot)];
    for (const startOct of [-1, 0, 1]) {
      const first = nearestMidi(order[0], center) + 12 * startOct;
      const v = [first];
      for (let k = 1; k < order.length; k++) {
        let m = v[k - 1] + mod12(order[k] - v[k - 1]);
        if (m === v[k - 1]) m += 12;
        v.push(m);
      }
      res.push(v);
    }
  }
  return res;
}

/** Renversement le plus proche (conduite des voix) d'un voicing précédent. */
export function nearestVoicing(pcs, prev) {
  const c = avg(prev);
  const cands = closeVoicings(pcs, Math.round(c));
  let best = null, bestCost = Infinity;
  const ps = [...prev].sort((a, b) => a - b);
  for (const v of cands) {
    const s = [...v].sort((a, b) => a - b);
    let cost = 0;
    for (const n of s) cost += Math.min(...ps.map((p) => Math.abs(p - n)));
    for (const p of ps) cost += Math.min(...s.map((n) => Math.abs(p - n)));
    cost += Math.abs(avg(s) - c) * 0.2;
    if (cost < bestCost) { bestCost = cost; best = s; }
  }
  return best;
}

/** Voicings enchaînés pour une progression (conduite des voix pour « nearest »). */
export function voiceProgression(symbols, opts = {}) {
  let prev = null;
  return symbols.map((s) => {
    const v = voicing(s, { ...opts, prev: opts.type === 'nearest' ? prev : null });
    prev = v.notes;
    return v;
  });
}

// ---------- transposition de symboles ----------
export function transposeChord(symbol, semis, { flats } = {}) {
  const c = parseChord(symbol);
  if (!c) return symbol;
  const newRoot = mod12(c.root + semis);
  // par défaut : Si♭, Mi♭, La♭, Ré♭ plutôt que La♯, Ré♯, Sol♯, Do♯ ; Fa♯ reste Fa♯ sauf si l'original était en bémols
  const useFlats = flats ?? (c.flats || [1, 3, 8, 10].includes(newRoot));
  const root = pcName(newRoot, { flats: useFlats });
  const bass = c.bass != null ? '/' + pcName(c.bass + semis, { flats: useFlats }) : '';
  return root + c.suffix + bass;
}

// ---------- grilles d'accords en texte ----------
/**
 * Lit une grille : « | Dm7 G7 | Cmaj7 % | ».
 * - chaque mesure est partagée également entre ses accords ;
 * - « % » seul = répète la mesure précédente ; « % » ou « . » / « / » dans une mesure = prolonge l'accord précédent d'une part ;
 * - « || », « |: », « :| » sont des barres ordinaires ; les retours à la ligne aussi séparent des mesures.
 * @returns {{measures: Array<{index:number, chords:Array<{symbol:string, beat:number, beats:number}>}>, items:Array, errors:string[], beatsPerMeasure:number}}
 */
export function parseProgression(text, { beatsPerMeasure = 4 } = {}) {
  const errors = [];
  const measures = [];
  const raw = String(text || '').replace(/\r/g, '');
  const bars = raw
    .split(/\n|\|\|?|:\||\|:/)
    .map((s) => s.trim())
    .filter((s) => s.length && s !== ':');
  let lastChords = null;
  for (const bar of bars) {
    const toks = bar.split(/\s+/).filter(Boolean);
    let chords = [];
    if (toks.length === 1 && toks[0] === '%') {
      if (!lastChords) { errors.push('« % » sans mesure précédente'); continue; }
      chords = lastChords.map((c) => ({ ...c }));
    } else {
      const slots = [];
      for (const t of toks) {
        if (t === '%' || t === '.' || t === '/' || t === '-') {
          if (slots.length) slots[slots.length - 1].n++;
          else if (lastChords) slots.push({ symbol: lastChords[lastChords.length - 1].symbol, n: 1 });
          continue;
        }
        if (!parseChord(t)) { errors.push(`Accord inconnu : « ${t} »`); continue; }
        slots.push({ symbol: t, n: 1 });
      }
      if (!slots.length) continue;
      const total = slots.reduce((s, x) => s + x.n, 0);
      let b = 0;
      for (const s of slots) {
        const beats = (beatsPerMeasure * s.n) / total;
        chords.push({ symbol: s.symbol, beat: b, beats });
        b += beats;
      }
    }
    lastChords = chords;
    measures.push({ index: measures.length, chords });
  }
  const items = [];
  for (const m of measures) for (const c of m.chords) items.push({ ...c, measure: m.index, start: m.index * beatsPerMeasure + c.beat });
  return { measures, items, errors, beatsPerMeasure };
}

/** Grille -> texte (4 mesures par ligne). */
export function progressionToText(measures, perLine = 4) {
  const cells = measures.map((m, i) => {
    const prev = measures[i - 1];
    const same = prev && prev.chords.length === m.chords.length && prev.chords.every((c, k) => c.symbol === m.chords[k].symbol && Math.abs(c.beats - m.chords[k].beats) < 1e-6);
    return same ? '%' : m.chords.map((c) => c.symbol).join(' ');
  });
  const lines = [];
  for (let i = 0; i < cells.length; i += perLine) lines.push('| ' + cells.slice(i, i + perLine).join(' | ') + ' |');
  return lines.join('\n');
}

export function transposeProgression(text, semis, opts = {}) {
  return String(text).replace(/(^|[\s|])([A-G][#b♯♭]?[^\s|]*)/g, (all, pre, sym) => pre + (parseChord(sym) ? transposeChord(sym, semis, opts) : sym));
}

/** Grilles d'exemple. */
export const EXAMPLE_GRIDS = [
  { id: 'iiVI', name: 'ii – V – I (Do majeur)', text: '| Dm7 | G7 | Cmaj7 | % |', tempo: 90 },
  { id: 'pop', name: 'I – V – vi – IV (pop)', text: '| C | G | Am | F |', tempo: 96 },
  { id: 'blues', name: 'Blues 12 mesures (Fa)', text: '| F7 | Bb7 | F7 | F7 |\n| Bb7 | Bb7 | F7 | F7 |\n| C7 | Bb7 | F7 | C7 |', tempo: 100 },
  { id: 'anatole', name: 'Anatole (I – vi – ii – V)', text: '| Cmaj7 A7 | Dm7 G7 | Em7 A7 | Dm7 G7 |', tempo: 110 },
  { id: 'canon', name: 'Canon de Pachelbel', text: '| D A | Bm F#m | G D | G A |', tempo: 80 },
  { id: 'minor', name: 'ii – V – i mineur (la)', text: '| Bm7b5 | E7b9 | Am7 | % |', tempo: 84 },
  { id: 'andalouse', name: 'Cadence andalouse', text: '| Am | G | F | E7 |', tempo: 92 },
];
