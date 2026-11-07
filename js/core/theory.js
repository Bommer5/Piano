// Théorie appliquée à un morceau : tonalité (Krumhansl-Schmuckler), accords par mesure,
// cadences, carrure / structure, et quiz générés à partir du morceau. Logique pure.
import { mod12, pcName, keyFromFifths, keyName, fifthsOfKey, keyPrefersFlats, identifyAll, romanNumeral, parseChord, FUNCTION_NAMES } from './harmony.js';

const EPS = 1e-6;

// Profils de Krumhansl & Kessler (1982)
export const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
export const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function corr(a, b) {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** Histogramme des classes de hauteurs pondéré par la durée (la dernière note et la basse comptent un peu plus). */
export function pitchProfile(notes) {
  const h = new Array(12).fill(0);
  if (!notes.length) return h;
  const end = Math.max(...notes.map((n) => n.start + n.dur));
  for (const n of notes) {
    let w = Math.min(n.dur, 4);
    if (n.start + n.dur >= end - EPS) w *= 1.5; // accord final
    h[mod12(n.midi)] += w;
  }
  return h;
}

/** Les 24 tonalités classées par corrélation. */
export function rankKeys(notes) {
  const prof = Array.isArray(notes) && typeof notes[0] === 'number' ? notes : pitchProfile(notes);
  const res = [];
  for (let t = 0; t < 12; t++) {
    const rot = (p) => p.map((_, i) => p[mod12(i - t)]);
    res.push({ tonic: t, mode: 'major', score: corr(prof, rot(KK_MAJOR)) });
    res.push({ tonic: t, mode: 'minor', score: corr(prof, rot(KK_MINOR)) });
  }
  res.sort((a, b) => b.score - a.score);
  return res.map((k) => ({ ...k, fifths: fifthsOfKey(k) }));
}

/** Estimation de tonalité (Krumhansl-Schmuckler). */
export function estimateKey(notes) {
  const r = rankKeys(notes);
  return r[0] || { tonic: 0, mode: 'major', fifths: 0, score: 0 };
}

/**
 * Tonalité d'un morceau : l'armure (keyFifths) si elle est cohérente avec les notes, sinon l'estimation.
 * Le mode vient de keyMode s'il existe, sinon de la corrélation (majeur vs relatif mineur).
 */
export function songKey(song) {
  const notes = song.notes || [];
  const ranked = rankKeys(notes);
  if (!notes.length) return { ...keyFromFifths(song.keyFifths || 0, song.keyMode === 'minor' ? 'minor' : 'major'), source: 'armure', score: 0 };
  const best = ranked[0];
  const hasSig = song.keyFifths != null;
  if (hasSig) {
    const fifths = song.keyFifths || 0;
    const maj = keyFromFifths(fifths, 'major'), min = keyFromFifths(fifths, 'minor');
    const sMaj = ranked.find((k) => k.tonic === maj.tonic && k.mode === 'major').score;
    const sMin = ranked.find((k) => k.tonic === min.tonic && k.mode === 'minor').score;
    let mode = song.keyMode === 'minor' || song.keyMode === 'major' ? song.keyMode : sMin > sMaj + 0.05 ? 'minor' : 'major';
    // finale sur la tonique mineure : indice fort
    const last = lastBass(notes);
    if (!song.keyMode && last != null && last === min.tonic && sMin > sMaj - 0.1) mode = 'minor';
    if (!song.keyMode && last != null && last === maj.tonic && sMaj > sMin - 0.1) mode = 'major';
    const s = mode === 'minor' ? sMin : sMaj;
    // armure absente (0 par défaut) mais notes clairement dans une autre tonalité : on garde l'estimation
    if (fifths !== 0 || s >= best.score - 0.12) return { ...keyFromFifths(fifths, mode), score: s, source: 'armure' };
  }
  return { ...best, source: 'estimation' };
}

function lastBass(notes) {
  if (!notes.length) return null;
  const end = Math.max(...notes.map((n) => n.start));
  const fin = notes.filter((n) => n.start >= end - 1 - EPS);
  return mod12(Math.min(...fin.map((n) => n.midi)));
}

/** Poids des classes de hauteurs qui sonnent dans [from, to[ (main gauche et basse renforcées). */
export function windowWeights(notes, from, to) {
  const w = new Array(12).fill(0);
  let lowest = null;
  for (const n of notes) {
    const a = Math.max(from, n.start), b = Math.min(to, n.start + n.dur);
    if (b - a <= EPS) continue;
    let x = b - a;
    if (n.start >= from - EPS) x *= 1.25; // attaquée dans la fenêtre
    if (Math.abs(n.start - from) < EPS) x *= 1.3; // sur le temps fort
    if (n.hand === 'L') x *= 1.6;
    w[mod12(n.midi)] += x;
    // basse = note la plus grave de la main gauche sur la première attaque de la fenêtre
    const st = Math.max(from, n.start);
    if (n.hand === 'L' && (lowest == null || st < lowest.st - EPS || (Math.abs(st - lowest.st) < EPS && n.midi < lowest.midi))) lowest = { midi: n.midi, st, hand: 'L' };
  }
  // une basse n'a de sens que si la main gauche joue (sinon la note la plus grave est la mélodie)
  return { w, lowest: lowest && lowest.hand === 'L' ? lowest.midi : null };
}

const ANALYSIS_QUALITIES = ['', 'm', 'dim', 'aug', 'sus4', '7', 'maj7', 'm7', 'm7b5', 'dim7', '6', 'm6'];
const TEMPLATE = {
  '': [0, 4, 7], m: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8], sus4: [0, 5, 7], 7: [0, 4, 7, 10], maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10], m7b5: [0, 3, 6, 10], dim7: [0, 3, 6, 9], 6: [0, 4, 7, 9], m6: [0, 3, 7, 9],
};
const PRIOR = { '': 0, m: 0, dim: 0.12, aug: 0.25, sus4: 0.2, 7: 0.04, maj7: 0.1, m7: 0.08, m7b5: 0.12, dim7: 0.15, 6: 0.2, m6: 0.25 };

/**
 * Meilleur accord pour une fenêtre (poids par classe de hauteur).
 * @returns {{symbol, root, quality, score, coverage}|null}
 */
export function bestChordForWeights(w, { bassMidi = null, key = null } = {}) {
  const total = w.reduce((s, x) => s + x, 0);
  if (total <= EPS) return null;
  const scale = key ? new Set((key.mode === 'minor' ? [0, 2, 3, 5, 7, 8, 10, 11] : [0, 2, 4, 5, 7, 9, 11]).map((x) => mod12(key.tonic + x))) : null;
  const flats = key ? keyPrefersFlats(key) : false;
  const present = w.map((x) => x > total * 0.04);
  let best = null;
  for (let r = 0; r < 12; r++) {
    if (!present[r] && !(bassMidi != null && mod12(bassMidi) === r)) continue;
    for (const q of ANALYSIS_QUALITIES) {
      const iv = TEMPLATE[q];
      const tones = iv.map((x) => mod12(r + x));
      let inW = 0;
      for (const t of tones) inW += w[t];
      const coverage = inW / total;
      const missing = tones.filter((t) => !present[t]);
      // une tierce absente est grave, une quinte juste absente beaucoup moins
      let miss = 0;
      for (const t of missing) {
        const i = mod12(t - r);
        miss += i === 7 ? 0.08 : i === 0 ? 0.25 : 0.3;
      }
      const onBass = bassMidi != null && mod12(bassMidi) === r;
      // accord de sixte : plausible surtout quand sa fondamentale est à la basse (sinon c'est un accord de 7e renversé)
      const prior = (q === '6' || q === 'm6') && onBass && w[mod12(r + 9)] >= total * 0.15 ? 0.05 : PRIOR[q];
      let score = coverage - miss - prior * (iv.length > 3 && w[mod12(r + iv[3])] < total * 0.08 ? 3 : 1);
      if (onBass) score += 0.2;
      else if (bassMidi != null) score -= 0.04;
      if (scale) {
        if (scale.has(r)) score += 0.04;
        else score -= 0.08;
        if (tones.every((t) => scale.has(t))) score += 0.04;
      }
      if (!best || score > best.score) best = { root: r, quality: q, score, coverage, missing: missing.length };
    }
  }
  if (!best) return null;
  let symbol = pcName(best.root, { flats }) + best.quality;
  if (bassMidi != null && mod12(bassMidi) !== best.root && TEMPLATE[best.quality].map((x) => mod12(best.root + x)).includes(mod12(bassMidi))) {
    symbol += '/' + pcName(mod12(bassMidi), { flats });
  }
  return { ...best, symbol };
}

/**
 * Accords mesure par mesure (ou demi-mesure quand l'harmonie change au milieu).
 * Si le morceau contient déjà des symboles (song.chords), ils sont utilisés tels quels.
 * @returns {Array<{measure:number, beat:number, start:number, symbol:string, roman:string|null, func:string|null, confidence:number, source:'partition'|'analyse'}>}
 */
export function chordsByMeasure(song, { key = songKey(song) } = {}) {
  const bpm = song.beatsPerMeasure || 4;
  const out = [];
  if (Array.isArray(song.chords) && song.chords.length) {
    for (const c of [...song.chords].sort((a, b) => a.beat - b.beat)) {
      const pc = parseChord(c.symbol);
      if (!pc) continue;
      const rn = romanNumeral(pc, key);
      out.push({ measure: Math.floor(c.beat / bpm + EPS), beat: c.beat - Math.floor(c.beat / bpm + EPS) * bpm, start: c.beat, symbol: c.symbol, roman: rn?.roman ?? null, func: rn?.func ?? null, confidence: 1, source: 'partition' });
    }
    return out;
  }
  const notes = song.notes || [];
  const count = song.measureCount || Math.ceil((song.totalBeats || 0) / bpm);
  let prev = null;
  for (let m = 0; m < count; m++) {
    const from = m * bpm, to = from + bpm;
    const whole = analyzeWindow(notes, from, to, key);
    let parts = whole ? [{ ...whole, start: from }] : [];
    // demi-mesures si l'harmonie change clairement
    if (bpm >= 4 && bpm % 2 === 0) {
      const half = from + bpm / 2;
      const a = analyzeWindow(notes, from, half, key), b = analyzeWindow(notes, half, to, key);
      if (a && b && a.symbol !== b.symbol && a.score + b.score > 2 * (whole?.score ?? 0) + 0.25 && a.score > 0.55 && b.score > 0.55) {
        parts = [{ ...a, start: from }, { ...b, start: half }];
      }
    }
    for (const p of parts) {
      if (prev && prev.symbol === p.symbol && p.start !== from) continue;
      const rn = romanNumeral(p.symbol, key);
      const item = { measure: m, beat: p.start - from, start: p.start, symbol: p.symbol, roman: rn?.roman ?? null, func: rn?.func ?? null, confidence: Math.max(0, Math.min(1, p.score)), source: 'analyse' };
      out.push(item);
      prev = item;
    }
  }
  return out;
}

function analyzeWindow(notes, from, to, key) {
  const { w, lowest } = windowWeights(notes, from, to);
  return bestChordForWeights(w, { bassMidi: lowest, key });
}

/**
 * Cadences en fin de phrase.
 * @param {Array} chords sortie de chordsByMeasure
 * @returns {Array<{type:'parfaite'|'plagale'|'demi-cadence'|'rompue', measure:number, from:string, to:string, label:string}>}
 */
export function findCadences(chords, key, { phraseLength = 4, measureCount = null } = {}) {
  const res = [];
  const last = measureCount != null ? measureCount - 1 : chords.length ? chords[chords.length - 1].measure : 0;
  const half = Math.max(2, phraseLength / 2);
  const isEnd = (m) => (m + 1) % phraseLength === 0 || (m + 1) % half === 0 || m === last;
  // accords consécutifs identiques regroupés : une cadence « arrive » sur un accord tenu jusqu'à la fin de phrase
  const runs = [];
  for (const c of chords) {
    const prev = runs[runs.length - 1];
    if (prev && prev.symbol.replace(/\/.*$/, '') === c.symbol.replace(/\/.*$/, '')) prev.endMeasure = c.measure;
    else runs.push({ symbol: c.symbol, measure: c.measure, endMeasure: c.measure });
  }
  for (let i = 0; i < runs.length; i++) {
    const nx = runs[i + 1];
    if (nx && nx.measure === runs[i].endMeasure) runs[i].endMeasure = runs[i].measure === nx.measure ? -1 : runs[i].endMeasure - 1;
  }
  const deg = (c) => {
    const p = parseChord(c.symbol);
    if (!p) return null;
    return { rel: mod12(p.root - key.tonic), rn: romanNumeral(p, key), p };
  };
  for (let i = 0; i < runs.length; i++) {
    const a = runs[i - 1], b = runs[i], next = runs[i + 1];
    const db = deg(b);
    if (!db || b.endMeasure < 0) continue;
    // la cadence doit se poser à la fin d'une (demi-)phrase
    let endM = -1;
    for (let m = b.measure; m <= b.endMeasure; m++) if (isEnd(m)) { endM = m; break; }
    if (endM < 0) continue;
    if (db.rel === 7 && !db.rn.secondary && endM !== last) {
      const dn = next ? deg(next) : null;
      if (!dn || dn.rel !== 0 || next.measure > endM + 1) res.push({ type: 'demi-cadence', measure: b.measure, from: a?.symbol ?? '', to: b.symbol, label: `Demi-cadence (repos sur V) mesure ${endM + 1}` });
      continue;
    }
    if (!a) continue;
    const da = deg(a);
    if (!da) continue;
    const span = a.measure === b.measure ? `mesure ${b.measure + 1}` : `mesures ${a.measure + 1}–${b.measure + 1}`;
    const isV = da.rel === 7 && !da.rn.secondary;
    if ((isV || (da.rel === 11 && /°|ø/.test(da.rn.roman))) && db.rel === 0) {
      res.push({ type: 'parfaite', measure: b.measure, from: a.symbol, to: b.symbol, label: `Cadence parfaite (V → I) ${span}` });
    } else if (da.rel === 5 && db.rel === 0) {
      res.push({ type: 'plagale', measure: b.measure, from: a.symbol, to: b.symbol, label: `Cadence plagale (IV → I) ${span}` });
    } else if (isV && db.rel === (key.mode === 'minor' ? 8 : 9)) {
      res.push({ type: 'rompue', measure: b.measure, from: a.symbol, to: b.symbol, label: `Cadence rompue (V → VI) ${span}` });
    }
  }
  return res;
}

/** Empreinte rythmico-mélodique d'une plage de mesures (main droite de préférence), transposition comprise. */
function fingerprint(song, from, to) {
  let ns = song.notes.filter((n) => n.start >= from - EPS && n.start < to - EPS);
  const R = ns.filter((n) => n.hand === 'R');
  if (R.length) ns = R;
  // note la plus haute de chaque attaque
  const byStart = new Map();
  for (const n of ns) if (!byStart.has(n.start) || byStart.get(n.start).midi < n.midi) byStart.set(n.start, n);
  return [...byStart.values()].sort((a, b) => a.start - b.start).map((n) => ({ t: Math.round((n.start - from) * 48), m: n.midi }));
}

function similarity(a, b) {
  if (!a.length && !b.length) return 1;
  if (!a.length || !b.length) return 0;
  const mb = new Map(b.map((x) => [x.t, x.m]));
  let same = 0;
  for (const x of a) if (mb.get(x.t) === x.m) same++;
  return (2 * same) / (a.length + b.length);
}

/**
 * Carrure : longueur de phrase (2, 4 ou 8 mesures) et sections (A, B, A'…).
 * @returns {{phraseLength:number, square:boolean, pickup:boolean, sections:Array<{label:string, from:number, to:number}>, form:string}}
 */
export function analyzeStructure(song) {
  const bpm = song.beatsPerMeasure || 4;
  const count = song.measureCount || 1;
  const firstNote = song.notes.length ? Math.min(...song.notes.map((n) => n.start)) : 0;
  const pickup = !!song.pickupBeats || (firstNote > EPS && firstNote < bpm - EPS && firstNote % bpm > EPS && count % 4 === 1);
  const effective = pickup && count % 4 === 1 ? count - 1 : count;
  let phraseLength = effective >= 16 && effective % 8 === 0 ? 8 : effective >= 4 ? 4 : Math.max(1, effective);
  if (phraseLength === 8) {
    // si les phrases de 4 se répètent de façon nette, garder 4
    const p4 = [];
    for (let m = 0; m < effective; m += 4) p4.push(fingerprint(song, m * bpm, (m + 4) * bpm));
    if (p4.some((p, i) => i > 0 && similarity(p, p4[i - 1]) > 0.8)) phraseLength = 4;
  }
  const sections = [];
  const fps = [];
  const letters = [];
  let nextLetter = 0;
  for (let m = 0, k = 0; m < count; m += phraseLength, k++) {
    const fp = fingerprint(song, m * bpm, (m + phraseLength) * bpm);
    let label = null;
    for (let j = 0; j < fps.length; j++) {
      const sim = similarity(fp, fps[j]);
      if (sim >= 0.85) { label = letters[j].replace(/'+$/, ''); break; }
      if (sim >= 0.5) { label = letters[j].replace(/'+$/, '') + "'"; break; }
    }
    if (!label) label = String.fromCharCode(65 + Math.min(25, nextLetter++));
    fps.push(fp);
    letters.push(label);
    sections.push({ label, from: m, to: Math.min(count, m + phraseLength) - 1 });
  }
  return { phraseLength, square: effective % 4 === 0, pickup, sections, form: letters.join(' ') };
}

// ---------- intervalles ----------
export const INTERVAL_NAMES = ['unisson', 'seconde mineure', 'seconde majeure', 'tierce mineure', 'tierce majeure', 'quarte juste', 'triton', 'quinte juste', 'sixte mineure', 'sixte majeure', 'septième mineure', 'septième majeure', 'octave'];

export function intervalName(semis) {
  const a = Math.abs(semis);
  if (a <= 12) return INTERVAL_NAMES[a];
  const base = INTERVAL_NAMES[a % 12];
  return a % 12 === 0 ? `${a / 12} octaves` : `${base} + octave`;
}

// ---------- quiz ----------
/** Générateur pseudo-aléatoire déterministe (mulberry32). */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeQ(type, prompt, correct, distractors, rand, explain, extra = {}) {
  const uniq = [...new Set(distractors.filter((d) => d !== correct))].slice(0, 3);
  const choices = shuffle([correct, ...uniq], rand);
  return { type, prompt, choices, answer: choices.indexOf(correct), explain, ...extra };
}

const pcFr = (pc, flats) => pcName(pc, { flats, lang: 'fr' });

/**
 * Quiz généré à partir du morceau.
 * @returns {Array<{type, prompt, choices:string[], answer:number, explain:string, measure?:number, notes?:number[]}>}
 */
export function generateQuiz(song, { seed = 1, count = 5, analysis = null } = {}) {
  const rand = rng(seed);
  const an = analysis || analyzeSong(song);
  const { key, chords } = an;
  const flats = keyPrefersFlats(key);
  const qs = [];
  // tonalité
  const kn = (k) => keyName(k);
  const rel = key.mode === 'major' ? { tonic: mod12(key.tonic + 9), mode: 'minor' } : { tonic: mod12(key.tonic + 3), mode: 'major' };
  const dom = { tonic: mod12(key.tonic + 7), mode: key.mode };
  const sub = { tonic: mod12(key.tonic + 5), mode: key.mode };
  const par = { tonic: key.tonic, mode: key.mode === 'major' ? 'minor' : 'major' };
  qs.push(makeQ('tonalite', 'Dans quelle tonalité est écrit ce morceau ?', kn(key), [kn(rel), kn(dom), kn(sub), kn(par)], rand,
    `${kn(key)} : armure de ${Math.abs(key.fifths ?? fifthsOfKey(key))} ${(key.fifths ?? fifthsOfKey(key)) < 0 ? 'bémol(s)' : 'dièse(s)'}, et la mélodie gravite autour de ${pcFr(key.tonic, flats)}.`));
  // mesure
  const [num, den] = song.timeSig || [4, 4];
  qs.push(makeQ('mesure', 'Combien de temps compte chaque mesure ?', `${num} temps`, [2, 3, 4, 6].filter((x) => x !== num).map((x) => `${x} temps`), rand, `La mesure est en ${num}/${den} : ${num} temps par mesure.`));
  // intervalles : deux notes consécutives de la mélodie
  const R = song.notes.filter((n) => n.hand === 'R');
  const mel = (R.length ? R : song.notes).filter((n, i, a) => !a.some((o) => o !== n && o.start === n.start && o.midi > n.midi));
  const pairs = [];
  for (let i = 1; i < mel.length; i++) {
    const d = mel[i].midi - mel[i - 1].midi;
    if (d !== 0 && Math.abs(d) <= 12) pairs.push([mel[i - 1], mel[i]]);
  }
  const pickedPairs = shuffle(pairs, rand).slice(0, 2);
  for (const [a, b] of pickedPairs) {
    const d = Math.abs(b.midi - a.midi);
    const near = [d - 1, d + 1, d + 2, d - 2, 12 - d].filter((x) => x > 0 && x <= 12 && x !== d).map(intervalName);
    const m = Math.floor(a.start / (song.beatsPerMeasure || 4)) + 1;
    qs.push(makeQ('intervalle', `Quel intervalle entre ${pcFr(a.midi, flats)} et ${pcFr(b.midi, flats)} (${b.midi > a.midi ? 'montant' : 'descendant'}, mesure ${m}) ?`, intervalName(d), near, rand,
      `${d} demi-ton${d > 1 ? 's' : ''} : ${intervalName(d)}.`, { measure: m - 1, notes: [a.midi, b.midi] }));
  }
  // accords
  const confident = chords.filter((c) => (c.confidence >= 0.6 || c.source === 'partition') && !c.symbol.includes('/'));
  for (const c of shuffle(confident, rand).slice(0, 2)) {
    const p = parseChord(c.symbol);
    if (!p) continue;
    const notesTxt = p.pcs.length <= 5 ? ' (notes : ' + [...p.intervals].map((x) => pcFr(p.root + x, flats)).filter((v, i, a) => a.indexOf(v) === i).join(', ') + ')' : '';
    const others = identifyAll(p.pcs.map((x) => x + 60), { key }).map((x) => x.symbol.replace(/\/.*$/, '')).filter((s) => s !== c.symbol);
    const sameRoot = [pcName(p.root, { flats }) + (p.quality === 'm' ? '' : 'm'), pcName(p.root + 7, { flats }) + p.quality, pcName(p.root + 5, { flats }) + p.quality, pcName(p.root + 2, { flats }) + 'm'];
    qs.push(makeQ('accord', `Quel accord entend-on à la mesure ${c.measure + 1}${c.beat ? ` (temps ${c.beat + 1})` : ''}${notesTxt} ?`, c.symbol, [...others, ...sameRoot], rand,
      `${c.symbol}${c.roman ? ` = degré ${c.roman} en ${kn(key)}` : ''}.`, { measure: c.measure }));
    if (c.roman && qs.filter((q) => q.type === 'degre').length < 1) {
      const romans = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'V7', 'ii7', 'vii°', 'IV', 'i', 'iv', 'VI', 'III'];
      qs.push(makeQ('degre', `Quel est le degré de l'accord ${c.symbol} en ${kn(key)} ?`, c.roman, romans, rand,
        `${c.roman}${c.func ? ` — fonction de ${FUNCTION_NAMES[c.func]}` : ''}.`, { measure: c.measure }));
    }
  }
  // cadence
  if (an.cadences?.length) {
    const cd = an.cadences[Math.floor(rand() * an.cadences.length)];
    qs.push(makeQ('cadence', `Mesure ${cd.measure + 1} : ${cd.from} → ${cd.to}. Quelle cadence est-ce ?`, cd.type, ['parfaite', 'plagale', 'demi-cadence', 'rompue'], rand, cd.label + '.', { measure: cd.measure }));
  }
  // garder la question de tonalité en premier, puis mélanger le reste
  const [first, ...rest] = qs;
  return [first, ...shuffle(rest, rand)].slice(0, Math.max(1, count));
}

/** Analyse complète pour la fiche morceau. */
export function analyzeSong(song) {
  const key = songKey(song);
  const chords = chordsByMeasure(song, { key });
  const structure = analyzeStructure(song);
  const cadences = findCadences(chords, key, { phraseLength: structure.phraseLength, measureCount: song.measureCount });
  return { key, keyName: keyName(key), chords, structure, cadences };
}
