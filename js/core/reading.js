// Jeux de lecture : « Note Flash » (lecture de notes, intervalles, accords) et déchiffrage.
// Logique pure (aucun accès au DOM) : générateurs aléatoires à graine injectable,
// répétition espacée, notation diatonique, génération de mélodies courtes.

// ---------- hasard reproductible ----------
/** Générateur pseudo-aléatoire (mulberry32) : rng() renvoie un nombre dans [0, 1). */
export function makeRng(seed = Date.now()) {
  let a = Math.floor(Number(seed) || 0) >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
export function shuffle(rng, arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
/** Tirage pondéré : renvoie l'indice choisi. */
export function weightedIndex(rng, weights) {
  const total = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (!(total > 0)) return Math.floor(rng() * weights.length);
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= Math.max(0, weights[i]);
    if (r < 0) return i;
  }
  return weights.length - 1;
}

/**
 * Niveaux débloqués : le niveau 1 l'est toujours, le niveau n l'est si le meilleur
 * résultat du niveau n-1 atteint le seuil. Renvoie le nombre de niveaux débloqués.
 * @param {(level:number)=>number} bestOf meilleur résultat d'un niveau (0 si jamais joué)
 */
export function unlockedCount(bestOf, nLevels, threshold) {
  let n = 1;
  while (n < nLevels && (bestOf(n) || 0) >= threshold) n++;
  return n;
}

// ---------- notation diatonique ----------
const STEP_PC = [0, 2, 4, 5, 7, 9, 11];
export const STEP_NAMES = { fr: ['Do', 'Ré', 'Mi', 'Fa', 'Sol', 'La', 'Si'], en: ['C', 'D', 'E', 'F', 'G', 'A', 'B'] };
/** Ordre des dièses (Fa Do Sol Ré La Mi Si) et des bémols, en degrés 0 = Do. */
export const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6];
export const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];

/** Position diatonique (octave * 7 + degré, Do4 = 28, comme spell() de notes.js) -> MIDI. */
export function diatonicToMidi(diatonic, alter = 0) {
  const oct = Math.floor(diatonic / 7);
  const step = ((diatonic % 7) + 7) % 7;
  return (oct + 1) * 12 + STEP_PC[step] + alter;
}
export const stepOf = (diatonic) => ((diatonic % 7) + 7) % 7;

/** Altération imposée par l'armure (fifths > 0 : dièses, < 0 : bémols). */
export function keyAlter(step, fifths = 0) {
  if (fifths > 0) return SHARP_ORDER.slice(0, fifths).includes(step) ? 1 : 0;
  if (fifths < 0) return FLAT_ORDER.slice(0, -fifths).includes(step) ? -1 : 0;
  return 0;
}

/** Nom d'une note écrite (degré + altération) : « Fa♯ », « Si♭ », « C# » selon la notation. */
export function spelledName(step, alter = 0, lang = 'fr') {
  const base = (STEP_NAMES[lang] || STEP_NAMES.fr)[step];
  return base + (alter > 0 ? '♯'.repeat(alter) : alter < 0 ? '♭'.repeat(-alter) : '');
}

const MAJOR_KEYS = { 0: 'Do', 1: 'Sol', 2: 'Ré', 3: 'La', 4: 'Mi', 5: 'Si', 6: 'Fa♯', '-1': 'Fa', '-2': 'Si♭', '-3': 'Mi♭', '-4': 'La♭', '-5': 'Ré♭', '-6': 'Sol♭' };
export function keyName(fifths) {
  return `${MAJOR_KEYS[fifths] || 'Do'} majeur`;
}
/** Degré (0..6) de la tonique d'une tonalité majeure. */
export function tonicStep(fifths) {
  return (((fifths * 4) % 7) + 7) % 7;
}
export const pcOf = (midi) => ((midi % 12) + 12) % 12;

// ---------- Note Flash ----------
export const CLEFS = { treble: 'Clé de sol', bass: 'Clé de fa', both: 'Les deux' };

/** Niveaux de lecture. Les plages sont en positions diatoniques (Do4 = 28). */
export const READING_LEVELS = [
  { id: 1, name: 'Premières notes', desc: 'Do4 à Sol4 (clé de fa : Do3 à Sol3)', kind: 'note', range: { treble: [28, 32], bass: [21, 25] } },
  { id: 2, name: 'Toute la portée', desc: 'Do4 à Do5 (clé de fa : Sol2 à La3)', kind: 'note', range: { treble: [28, 35], bass: [18, 26] } },
  { id: 3, name: 'Lignes supplémentaires', desc: 'Notes au-dessus et en dessous de la portée', kind: 'note', range: { treble: [25, 42], bass: [13, 30] } },
  { id: 4, name: 'Altérations', desc: 'Dièses et bémols écrits devant la note', kind: 'note', accidentals: true, range: { treble: [28, 37], bass: [18, 28] } },
  { id: 5, name: 'Armures', desc: "Jusqu'à 4 dièses ou 4 bémols à la clé", kind: 'note', keys: [-4, -3, -2, -1, 1, 2, 3, 4], range: { treble: [28, 38], bass: [17, 28] } },
  { id: 6, name: 'Intervalles', desc: 'Compte la distance entre deux notes (2de à octave)', kind: 'interval', range: { treble: [28, 35], bass: [18, 26] } },
  { id: 7, name: 'Accords', desc: 'Reconnais les accords de 3 sons (triades)', kind: 'chord', range: { treble: [28, 34], bass: [17, 23] } },
];
export const getReadingLevel = (id) => READING_LEVELS.find((l) => l.id === Number(id)) || READING_LEVELS[0];

export const INTERVAL_LABELS = { 2: '2de', 3: '3ce', 4: '4te', 5: '5te', 6: '6te', 7: '7e', 8: '8ve' };
const TRIAD_SUFFIX = { maj: 'majeur', min: 'mineur', dim: 'diminué', aug: 'augmenté' };

function triadQuality(midis) {
  const a = midis[1] - midis[0], b = midis[2] - midis[1];
  if (a === 4 && b === 3) return 'maj';
  if (a === 3 && b === 4) return 'min';
  if (a === 3 && b === 3) return 'dim';
  if (a === 4 && b === 4) return 'aug';
  return null;
}
export function chordLabel(step, alter, quality, lang = 'fr') {
  return `${spelledName(step, alter, lang)} ${TRIAD_SUFFIX[quality] || ''}`.trim();
}

function mkNote(diatonic, alter, shown) {
  return { diatonic, alter, midi: diatonicToMidi(diatonic, alter), shownAlter: shown ? alter : 0 };
}

/**
 * Toutes les questions possibles d'un niveau pour une clé (« both » = les deux réunies).
 * Chaque item : {key, clef, fifths, layout, notes:[{diatonic, alter, midi, shownAlter}], answer}
 * answer : {type:'note', pc} | {type:'interval', n} | {type:'chord', id, pcs}
 */
export function readingPool(levelId, clef = 'treble') {
  if (clef === 'both') return [...readingPool(levelId, 'treble'), ...readingPool(levelId, 'bass')];
  const lv = getReadingLevel(levelId);
  const [lo, hi] = lv.range[clef];
  const items = [];
  const add = (fifths, layout, notes, answer) => {
    const key = `${clef}|${fifths}|${layout}|${notes.map((n) => n.diatonic + (n.alter ? (n.alter > 0 ? '#' : 'b') : '')).join(',')}`;
    items.push({ key, clef, fifths, layout, notes, answer });
  };
  if (lv.kind === 'note') {
    for (let d = lo; d <= hi; d++) {
      const step = stepOf(d);
      if (lv.keys) {
        for (const f of lv.keys) {
          const n = mkNote(d, keyAlter(step, f), false);
          add(f, 'single', [n], { type: 'note', pc: pcOf(n.midi) });
        }
      } else if (lv.accidentals) {
        for (const alt of [1, -1]) {
          // pas de Mi♯, Si♯, Fa♭, Do♭ à ce stade
          if ((alt === 1 && (step === 2 || step === 6)) || (alt === -1 && (step === 3 || step === 0))) continue;
          const n = mkNote(d, alt, true);
          add(0, 'single', [n], { type: 'note', pc: pcOf(n.midi) });
        }
        const n = mkNote(d, 0, false);
        add(0, 'single', [n], { type: 'note', pc: pcOf(n.midi) });
      } else {
        const n = mkNote(d, 0, false);
        add(0, 'single', [n], { type: 'note', pc: pcOf(n.midi) });
      }
    }
  } else if (lv.kind === 'interval') {
    for (let d = lo; d <= hi; d++) {
      for (let n = 2; n <= 8; n++) {
        if (d + n - 1 > hi + 3) continue;
        for (const layout of ['melodic', 'harmonic']) {
          const notes = [mkNote(d, 0, false), mkNote(d + n - 1, 0, false)];
          add(0, layout, notes, { type: 'interval', n, pcs: notes.map((x) => pcOf(x.midi)) });
        }
      }
    }
  } else if (lv.kind === 'chord') {
    for (let d = lo; d <= hi; d++) {
      const notes = [0, 2, 4].map((k) => mkNote(d + k, 0, false));
      const q = triadQuality(notes.map((n) => n.midi));
      add(0, 'harmonic', notes, { type: 'chord', id: `${stepOf(d)}:0:${q}`, step: stepOf(d), quality: q, pcs: notes.map((x) => pcOf(x.midi)) });
    }
  }
  return items;
}

/** Choix proposés pour un niveau (boutons). */
export function answerChoices(levelId, lang = 'fr') {
  const lv = getReadingLevel(levelId);
  if (lv.kind === 'interval') return [2, 3, 4, 5, 6, 7, 8].map((n) => ({ id: n, label: INTERVAL_LABELS[n] }));
  if (lv.kind === 'chord') {
    // triades de Do majeur (les 7 degrés)
    return [0, 1, 2, 3, 4, 5, 6].map((s) => {
      const notes = [0, 2, 4].map((k) => diatonicToMidi(28 + s + k));
      const q = triadQuality(notes);
      return { id: `${s}:0:${q}`, label: chordLabel(s, 0, q, lang) };
    });
  }
  const names = STEP_NAMES[lang] || STEP_NAMES.fr;
  const naturals = STEP_PC.map((pc, s) => ({ id: pc, label: names[s] }));
  if (!lv.accidentals && !lv.keys) return naturals;
  const black = [1, 3, 6, 8, 10].map((pc) => {
    const s = STEP_PC.indexOf(pc - 1);
    return { id: pc, label: `${names[s]}♯ / ${names[s + 1]}♭`, black: true };
  });
  return [...naturals, ...black];
}

/** Vérifie une réponse donnée par bouton : id du choix. */
export function checkChoice(item, id) {
  const a = item.answer;
  if (a.type === 'note') return Number(id) === a.pc;
  if (a.type === 'interval') return Number(id) === a.n;
  if (a.type === 'chord') return String(id) === a.id;
  return false;
}

/**
 * Réponse jouée au piano (classes de hauteur, octave libre).
 * Renvoie null tant qu'il manque des notes, sinon true/false.
 * Note : 1 note ; intervalle : 2 notes dans l'ordre (grave puis aigu) ; accord : 3 notes dans n'importe quel ordre.
 */
export function checkPlayed(item, pcs) {
  const a = item.answer;
  if (a.type === 'note') return pcs.length ? pcs[0] === a.pc : null;
  if (a.type === 'interval') {
    if (pcs.length < 2) return pcs.length === 1 && pcs[0] !== a.pcs[0] ? false : null;
    return pcs[0] === a.pcs[0] && pcs[1] === a.pcs[1];
  }
  if (a.type === 'chord') {
    const set = [...new Set(pcs)];
    if (set.some((p) => !a.pcs.includes(p))) return false;
    return set.length >= a.pcs.length ? true : null;
  }
  return false;
}

/** Bonne réponse en texte. */
export function answerText(item, lang = 'fr') {
  const a = item.answer;
  if (a.type === 'note') return spelledName(stepOf(item.notes[0].diatonic), item.notes[0].alter, lang);
  if (a.type === 'interval') return INTERVAL_LABELS[a.n];
  if (a.type === 'chord') return chordLabel(a.step, 0, a.quality, lang);
  return '';
}

// ---------- répétition espacée ----------
export const TARGET_MS = 2500;

/**
 * Met à jour les statistiques d'un item après une réponse.
 * stat = {n, ok, box (0..5, niveau de maîtrise), err (taux d'erreur récent), ms (temps moyen récent)}
 */
export function updateStat(stat, { correct, ms }, targetMs = TARGET_MS) {
  const s = stat ? { ...stat } : { n: 0, ok: 0, box: 0, err: 0, ms: null };
  s.n++;
  if (correct) s.ok++;
  s.err = Math.round((s.err * 0.6 + (correct ? 0 : 0.4)) * 1000) / 1000;
  if (correct && Number.isFinite(ms)) s.ms = s.ms == null ? Math.round(ms) : Math.round(s.ms * 0.6 + ms * 0.4);
  if (!correct) s.box = 0;
  else if (ms <= targetMs) s.box = Math.min(5, s.box + 1);
  return s;
}

/** Poids de tirage : les notes ratées ou lentes reviennent plus souvent, les nouvelles aussi. */
export function itemWeight(stat, targetMs = TARGET_MS) {
  if (!stat || !stat.n) return 3;
  let w = 4 / (1 + stat.box);
  w *= 1 + 2 * (stat.err || 0);
  if (stat.ms != null && stat.ms > targetMs) w *= 1 + Math.min(1.5, (stat.ms - targetMs) / targetMs);
  return w;
}

/** Choisit le prochain item (jamais deux fois de suite le même). */
export function pickItem(pool, stats, rng, avoidKey = null, targetMs = TARGET_MS) {
  if (!pool.length) return null;
  const cand = pool.length > 1 ? pool.filter((it) => it.key !== avoidKey) : pool;
  const idx = weightedIndex(rng, cand.map((it) => itemWeight(stats?.[it.key], targetMs)));
  return cand[idx];
}

/** Points d'une réponse : 10 + bonus de rapidité (jusqu'à 10 sous 0,8 s, 0 au-delà de 3 s). */
export function flashPoints(correct, ms) {
  if (!correct) return 0;
  const bonus = Math.round(10 * (1 - (ms - 800) / 2200));
  return 10 + Math.max(0, Math.min(10, bonus));
}

/** Items les plus faibles (pour « notes à revoir »). */
export function weakestItems(stats, n = 5) {
  return Object.entries(stats || {})
    .filter(([, s]) => s.n >= 2 && (s.err > 0.15 || (s.ms || 0) > TARGET_MS))
    .sort((a, b) => itemWeight(b[1]) - itemWeight(a[1]))
    .slice(0, n)
    .map(([key, s]) => ({ key, ...s }));
}

// ---------- déchiffrage : mélodies aléatoires ----------
const MAJOR = [0, 2, 4, 5, 7, 9, 11];

export const SIGHT_LEVELS = [
  { id: 1, name: 'Débutant', desc: 'Do majeur, rondes, blanches et noires, notes conjointes', keys: [0], degrees: [0, 4], leaps: [1, 2], tempo: 60,
    rhythms: [[4], [2, 2], [2, 1, 1], [1, 1, 2], [1, 1, 1, 1]] },
  { id: 2, name: 'Facile', desc: 'Do, Sol, Fa majeur, petits sauts, blanches pointées', keys: [0, 1, -1], degrees: [0, 7], leaps: [1, 2, 3], tempo: 66,
    rhythms: [[2, 2], [2, 1, 1], [1, 1, 2], [1, 1, 1, 1], [3, 1], [1, 2, 1]] },
  { id: 3, name: 'Intermédiaire', desc: 'Jusqu’à 2 altérations, croches', keys: [0, 1, -1, 2, -2], degrees: [-3, 8], leaps: [1, 2, 3, 4], tempo: 72,
    rhythms: [[2, 1, 1], [1, 1, 1, 1], [0.5, 0.5, 1, 1, 1], [1, 0.5, 0.5, 2], [1.5, 0.5, 1, 1], [1, 1, 0.5, 0.5, 1], [3, 1]] },
  { id: 4, name: 'Avancé', desc: 'Jusqu’à 3 altérations, rythmes pointés, main gauche', keys: [0, 1, -1, 2, -2, 3, -3], degrees: [-3, 9], leaps: [1, 2, 3, 4], tempo: 76, leftHand: true,
    rhythms: [[0.5, 0.5, 0.5, 0.5, 1, 1], [1.5, 0.5, 1.5, 0.5], [1, 0.5, 0.5, 1, 0.5, 0.5], [1.5, 0.5, 2], [2, 0.5, 0.5, 1], [1, 1, 1, 1], [0.5, 0.5, 1, 2]] },
];
export const getSightLevel = (id) => SIGHT_LEVELS.find((l) => l.id === Number(id)) || SIGHT_LEVELS[0];

/** Suite de degrés : surtout des pas conjoints, quelques sauts, retour vers la tonique en fin de phrase. */
function melodyDegrees(rng, count, dlo, dhi, leaps) {
  const degs = [pick(rng, [0, 2, 4].filter((d) => d >= dlo && d <= dhi))];
  for (let i = 1; i < count; i++) {
    const prev = degs[i - 1];
    const r = rng();
    let step = r < 0.62 ? 1 : r < 0.7 ? 0 : pick(rng, leaps);
    let dir = rng() < 0.5 ? -1 : 1;
    // fin de phrase : on se rapproche de la tonique par pas conjoints
    if (i >= count - 4 && Math.abs(prev) > 1) {
      dir = prev > 0 ? -1 : 1;
      step = Math.min(Math.max(step, 1), 2);
    }
    if (prev + dir * step > dhi || prev + dir * step < dlo) dir = -dir;
    degs.push(Math.max(dlo, Math.min(dhi, prev + dir * step)));
  }
  // cadence : avant-dernière note sur le 2e degré ou la sensible, dernière sur la tonique
  degs[count - 1] = 0;
  if (count >= 2) degs[count - 2] = degs[count - 3] != null && degs[count - 3] < 0 && dlo <= -1 ? -1 : 1;
  return degs;
}

/** Tonique (MIDI) d'une tonalité, placée entre La♭3 et Sol4. */
export function tonicMidi(fifths) {
  let m = 60 + pcOf(fifths * 7);
  if (m > 67) m -= 12;
  return m;
}
/** Degré de gamme majeure (peut être négatif ou > 6) -> MIDI. */
export function degreeToMidi(tonic, deg) {
  const oct = Math.floor(deg / 7);
  return tonic + oct * 12 + MAJOR[((deg % 7) + 7) % 7];
}

/**
 * Mélodie de déchiffrage : 4 mesures en 4/4, mouvement conjoint et petits sauts dans la tonalité,
 * fin sur la tonique. Renvoie un morceau « brut » à passer à prepareSong (marqué ephemeral).
 */
export function generateSightReading(levelId = 1, rng = Math.random, { measures = 4 } = {}) {
  const lv = getSightLevel(levelId);
  const fifths = pick(rng, lv.keys);
  const tonic = tonicMidi(fifths);
  const [dlo, dhi] = lv.degrees;
  // rythmes : la dernière mesure se termine par une note longue
  const rhythms = [];
  for (let m = 0; m < measures - 1; m++) rhythms.push(pick(rng, lv.rhythms));
  const finals = lv.rhythms.filter((r) => r[r.length - 1] >= 2);
  rhythms.push(finals.length ? pick(rng, finals) : [4]);
  const count = rhythms.reduce((s, r) => s + r.length, 0);
  const maxLeap = Math.max(...lv.leaps);
  let degs;
  for (let attempt = 0; attempt < 40; attempt++) {
    degs = melodyDegrees(rng, count, dlo, dhi, lv.leaps);
    let ok = true;
    for (let i = 1; i < count; i++) if (Math.abs(degs[i] - degs[i - 1]) > maxLeap) ok = false;
    if (ok) break;
  }
  const notes = [];
  let t = 0, k = 0;
  for (const r of rhythms) {
    for (const dur of r) {
      notes.push({ midi: degreeToMidi(tonic, degs[k++]), start: t, dur, hand: 'R' });
      t += dur;
    }
  }
  if (lv.leftHand) {
    // basse : I, IV ou V en rondes, une octave sous la tonique, tonique au début et à la fin
    const bassDegs = [0, ...Array.from({ length: measures - 2 }, () => pick(rng, [3, 4, -3])), 0];
    bassDegs.forEach((d, m) => notes.push({ midi: degreeToMidi(tonic - 12, d), start: m * 4, dur: 4, hand: 'L' }));
  }
  return {
    id: 'dechiffrage',
    title: 'Déchiffrage',
    composer: 'Mélodie générée',
    genre: 'divers',
    level: lv.id,
    tempo: lv.tempo,
    timeSig: [4, 4],
    keyFifths: fifths,
    ephemeral: true,
    notes,
  };
}
