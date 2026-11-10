// Banc d'essai de l'import audio : rend des morceaux de la bibliothèque en « vrai » son de piano
// (tests/helpers/piano-sim.mjs), les transcrit et compare aux notes d'origine.
//
//   node scripts/import-bench.mjs            banc complet (tableau + score global)
//   node scripts/import-bench.mjs --quick    sous-ensemble rapide (celui des tests unitaires)
//   node scripts/import-bench.mjs --json     résultat en JSON
//   node scripts/import-bench.mjs --only=ode-joie   un seul morceau (toutes ses variantes)
//
// Mesures (par cas) :
//   F1      notes retrouvées dans la partition finale : hauteur exacte, début à ±1 grille (1/4 de temps) près,
//           après alignement global (levée) et normalisation d'une éventuelle erreur double/moitié de tempo ;
//   F1s     détection brute : hauteur exacte, début à ±50 ms près (avant quantification) ;
//   tempo   « ok » à ±4 %, sinon « x2 », « /2 », « 3:2 »… ou « faux » ;
//   mesure  durée d'une mesure retrouvée (« ok »), double ou moitié (« ~ »), sinon « faux » ;
//   ton     armure exacte ; mains = part des notes retrouvées attribuées à la bonne main ;
//   1er     le premier temps des mesures tombe au bon endroit (levée comprise).
import { SONGS } from '../js/data/songs.js';
import { prepareSong } from '../js/core/song.js';
// BENCH_TRANSCRIBE=chemin : compare avec une autre version du module de transcription
const { transcribe, toRawSong } = await import(process.env.BENCH_TRANSCRIBE || '../js/core/transcribe.js');
import { piano } from '../tests/helpers/piano-sim.mjs';
import fs from 'node:fs';
import path from 'node:path';

export const BENCH_SONGS = [
  'cinq-doigts-do', 'touches-noires', 'ode-joie', 'menuet-sol', 'lettre-elise', 'prelude-do', 'berceuse-brahms',
  'canon-pachelbel', 'frere-jacques', 'ah-vous-dirai-je', 'joyeux-anniversaire', 'vive-le-vent', 'douce-nuit',
  'greensleeves', 'au-revoir', 'amazing-grace', 'when-the-saints', 'blues-do', 'walking-fa', 'petit-rag',
  'entertainer', 'valse-accords', 'pluie-automne', 'gamme-fa', 'hanon-1', 'korobeiniki',
];
// morceaux qui reçoivent toutes les variantes (tempo, désaccord, bruit, pédale, téléphone…)
export const VARIANT_SONGS = ['ode-joie', 'menuet-sol', 'frere-jacques', 'vive-le-vent', 'au-revoir', 'pluie-automne', 'petit-rag', 'amazing-grace'];

export const VARIANTS = {
  nominal: {},
  'tempo×0,7': { tempoFactor: 0.7 },
  'tempo×1,3': { tempoFactor: 1.3 },
  '−30 cents': { detune: -30 },
  faible: { gain: 0.06 },
  bruit: { noise: 0.02 },
  pédale: { pedal: true },
  '48 kHz': { sr: 48000 },
  humain: { human: true },
  téléphone: { phone: true },
};

const MAX_BEATS = 56; // au-delà, le morceau est coupé à la mesure (durée du banc)

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Notes de référence d'un morceau (temps en noires, à partir de la première mesure jouée). */
export function referenceOf(id, { hands = 'both' } = {}) {
  const song = prepareSong(SONGS.find((s) => s.id === id));
  const bpm = song.beatsPerMeasure;
  const cut = Math.floor(MAX_BEATS / bpm) * bpm;
  let notes = song.notes.filter((n) => n.start < cut - 1e-6 && (hands === 'both' || n.hand === 'R'));
  const first = Math.min(...notes.map((n) => n.start));
  const barStart = Math.floor(first / bpm + 1e-6) * bpm; // la mesure de la levée est gardée entière
  notes = notes.map((n) => ({ midi: n.midi, start: n.start - barStart, dur: n.dur, hand: n.hand }));
  return { id, title: song.title, tempo: song.tempo, timeSig: song.timeSig, keyFifths: song.keyFifths || 0, beatsPerMeasure: bpm, notes, pickup: first - barStart, twoHands: hands === 'both' };
}

function lowpass(x, sr, fc) {
  // deux passe-bas du 2e ordre en cascade (Butterworth 4e ordre approché)
  for (const q of [0.541, 1.307]) {
    const w = (2 * Math.PI * fc) / sr, al = Math.sin(w) / (2 * q), c = Math.cos(w);
    const a0 = 1 + al, b0 = (1 - c) / 2 / a0, b1 = (1 - c) / a0, b2 = b0, a1 = (-2 * c) / a0, a2 = (1 - al) / a0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = x[i];
      const y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = v; y2 = y1; y1 = y;
      x[i] = y;
    }
  }
  return x;
}

function compress(x, sr) {
  // compresseur simple (seuil -20 dB, 3:1, attaque 5 ms, relâchement 150 ms) comme le micro d'un téléphone
  const att = Math.exp(-1 / (sr * 0.005)), rel = Math.exp(-1 / (sr * 0.15));
  let env = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    env = a > env ? att * env + (1 - att) * a : rel * env + (1 - rel) * a;
    const g = env > 0.1 ? Math.pow(env / 0.1, -2 / 3) : 1;
    x[i] *= g * 1.8;
  }
  return x;
}

/** Rend un morceau de référence en audio. Renvoie { samples, sr, seq:[{midi,t,hand}], secPerBeat }. */
export function render(ref, v = {}) {
  const sr = v.sr || 44100;
  const tempo = ref.tempo * (v.tempoFactor || 1);
  const spb = 60 / tempo;
  const rnd = rng(12345 + ref.notes.length);
  const lead = 0.3;
  const t0 = ref.pickup;
  const seq = ref.notes.map((n) => {
    const inBar = n.start % ref.beatsPerMeasure;
    let vel = (n.hand === 'L' ? 0.4 : 0.55) + (inBar < 1e-6 ? 0.1 : 0) + (rnd() - 0.5) * 0.06;
    let t = lead + (n.start - t0) * spb;
    if (v.human) {
      // léger rubato : le tempo local varie de ± 3 % ; frappes à ± ~12 ms ; nuances irrégulières
      t = lead + spb * (n.start - t0 + 0.03 * 9 * (Math.cos(t0 / 9) - Math.cos(n.start / 9)));
      t += (rnd() + rnd() + rnd() - 1.5) * 0.016;
      vel *= 0.8 + 0.4 * rnd();
    }
    return { midi: n.midi, t: Math.max(0.02, t), vel, hand: n.hand, start: n.start };
  });
  const end = Math.max(...seq.map((n) => n.t)) + 1.4;
  const out = new Float32Array(Math.round(end * sr));
  const mix = (buf, at) => {
    const o = Math.round(at * sr);
    for (let i = 0; i < buf.length && o + i < out.length; i++) out[o + i] += buf[i];
  };
  const common = { noise: 0, gain: 1, detune: v.detune || 0 };
  if (v.pedal) {
    // pédale changée à chaque mesure : tout résonne dans la mesure, puis les étouffoirs retombent
    const barSec = ref.beatsPerMeasure * spb;
    const nBars = Math.ceil((Math.max(...ref.notes.map((n) => n.start)) + 1e-6) / ref.beatsPerMeasure);
    for (let b = 0; b <= nBars; b++) {
      const a = lead + (b * ref.beatsPerMeasure - t0) * spb, z = a + barSec;
      const part = seq.filter((n) => n.t >= a - 0.03 && n.t < z - 0.03);
      if (!part.length) continue;
      const base = Math.max(0, a - 0.05);
      const local = part.map((n) => ({ ...n, t: n.t - base }));
      const len = b === nBars ? 1.4 : z - base + 0.04 - Math.max(...local.map((n) => n.t));
      const buf = piano(local, sr, { ...common, pedal: true, tail: Math.max(0.05, len) });
      const fade = Math.round(sr * 0.08);
      for (let i = 0; i < fade && i < buf.length; i++) buf[buf.length - 1 - i] *= i / fade;
      mix(buf, base);
    }
  } else {
    // chaque main est jouée legato séparément (la main gauche tient ses notes sous la mélodie)
    for (const hand of ['R', 'L']) {
      const part = seq.filter((n) => n.hand === hand);
      if (part.length) mix(piano(part, sr, { ...common, tail: 1.3 }), 0);
    }
  }
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  const g = (0.7 / (peak || 1)) * (v.gain || 1);
  const noise = v.noise ?? 0.002;
  const nr = rng(99);
  if (v.phone) {
    for (let i = 0; i < out.length; i++) out[i] = out[i] * g + 0.006 * (nr() * 2 - 1);
    lowpass(out, sr, 7000);
    compress(out, sr);
    for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, out[i])); // écrêtage
  } else {
    for (let i = 0; i < out.length; i++) out[i] = out[i] * g + noise * (nr() * 2 - 1);
  }
  return { samples: out, sr, seq, secPerBeat: spb };
}

function prf(tp, nRef, nEst) {
  const p = nEst ? tp / nEst : 0, r = nRef ? tp / nRef : 0;
  return { p, r, f1: p + r ? (2 * p * r) / (p + r) : 0 };
}

/** Appariement glouton (même hauteur, écart ≤ tol) ; renvoie les paires [iRef, iEst]. */
function matchNotes(ref, est, tol, key = 'start') {
  const byMidi = new Map();
  est.forEach((n, i) => { if (!byMidi.has(n.midi)) byMidi.set(n.midi, []); byMidi.get(n.midi).push(i); });
  const used = new Set();
  const pairs = [];
  ref.forEach((r, ri) => {
    let best = -1, bd = Infinity;
    for (const i of byMidi.get(r.midi) || []) {
      if (used.has(i)) continue;
      const d = Math.abs(est[i][key] - r[key]);
      if (d <= tol + 1e-6 && d < bd) { bd = d; best = i; }
    }
    if (best >= 0) { used.add(best); pairs.push([ri, best]); }
  });
  return pairs;
}

const RATIOS = [[1, 'ok'], [2, 'x2'], [0.5, '/2'], [1.5, '3:2'], [2 / 3, '2:3'], [3, 'x3'], [1 / 3, '/3'], [4 / 3, '4:3'], [0.75, '3:4']];

/** Compare un morceau transcrit (brut, temps en noires) à la référence. */
export function score(ref, raw, rendered, result) {
  const trueTempo = 60 / rendered.secPerBeat;
  const ratio = raw.tempo / trueTempo;
  let tempoClass = 'faux', scale = 1;
  for (const [r, name] of RATIOS) if (Math.abs(ratio / r - 1) <= 0.04) { tempoClass = name; scale = 1 / r; break; }
  // positions transcrites ramenées à l'échelle de la référence (double/moitié de tempo)
  const est = raw.notes.map((n) => ({ midi: n.midi, start: n.start * scale, hand: n.hand, uncertain: !!n.uncertain }));
  // meilleur décalage global (multiple de la grille)
  let best = { tp: -1, shift: 0, pairs: [] };
  for (let sh = -8; sh <= 8 + 1e-9; sh += 0.25) {
    const shifted = est.map((n) => ({ ...n, start: n.start + sh }));
    const pairs = matchNotes(ref.notes, shifted, 0.25);
    const exact = pairs.filter(([a, b]) => Math.abs(ref.notes[a].start - shifted[b].start) < 1e-3).length;
    const v = pairs.length + exact * 0.001 - Math.abs(sh) * 1e-5;
    if (v > best.tp) best = { tp: v, shift: sh, pairs, exact };
  }
  const note = prf(best.pairs.length, ref.notes.length, est.length);
  const exact = prf(best.exact, ref.notes.length, est.length);
  // détection brute en secondes
  let sec = null;
  if (result) {
    const refS = rendered.seq.map((n) => ({ midi: n.midi, start: n.t }));
    const estS = result.notes.map((n) => ({ midi: n.midi, start: n.startSec }));
    sec = prf(matchNotes(refS, estS, 0.05).length, refS.length, estS.length);
  }
  const handsOk = best.pairs.filter(([a, b]) => ref.notes[a].hand === est[b].hand).length / Math.max(1, best.pairs.length);
  // mesure : durée réelle d'une mesure
  const estBar = ((raw.timeSig[0] * 4) / raw.timeSig[1]) * (60 / raw.tempo);
  const trueBar = ref.beatsPerMeasure * rendered.secPerBeat;
  const br = estBar / trueBar;
  const meter = Math.abs(br - 1) < 0.05 ? 'ok' : Math.abs(br - 2) < 0.1 || Math.abs(br - 0.5) < 0.03 ? '~' : 'faux';
  const sh = ((best.shift % ref.beatsPerMeasure) + ref.beatsPerMeasure) % ref.beatsPerMeasure;
  const downbeat = meter === 'ok' && tempoClass !== 'faux' && (sh < 1e-6 || Math.abs(sh - ref.beatsPerMeasure) < 1e-6);
  // notes marquées incertaines : part des erreurs signalées
  const matchedEst = new Set(best.pairs.map(([, b]) => b));
  const wrong = est.filter((_, i) => !matchedEst.has(i));
  const flaggedWrong = wrong.filter((n) => n.uncertain).length;
  const flagged = est.filter((n) => n.uncertain).length;
  return {
    f1: note.f1, p: note.p, r: note.r, f1Exact: exact.f1, f1Sec: sec ? sec.f1 : null,
    tempo: raw.tempo, trueTempo, tempoClass, meter, timeSig: raw.timeSig.join('/'), downbeat,
    key: (raw.keyFifths || 0) === ref.keyFifths, hands: handsOk,
    confidence: raw.transcription ? raw.transcription.confidence : result ? result.confidence : null,
    flagged, flaggedWrong, wrong: wrong.length, nRef: ref.notes.length, nEst: est.length,
  };
}

export function buildCases({ quick = false, only = null } = {}) {
  const cases = [];
  const add = (id, hands, variant) => cases.push({ id, hands, variant, name: `${id} ${hands === 'both' ? '2M' : 'MD'} ${variant}` });
  if (quick) {
    add('ode-joie', 'R', 'nominal'); add('frere-jacques', 'R', 'téléphone'); add('menuet-sol', 'R', 'humain');
    add('ode-joie', 'both', 'nominal'); add('au-revoir', 'both', 'nominal'); add('vive-le-vent', 'both', 'téléphone');
    add('amazing-grace', 'both', 'pédale'); add('petit-rag', 'R', 'nominal');
    return cases;
  }
  for (const id of BENCH_SONGS) {
    if (only && id !== only) continue;
    for (const hands of ['R', 'both']) {
      add(id, hands, 'nominal');
      if (VARIANT_SONGS.includes(id)) for (const v of Object.keys(VARIANTS)) if (v !== 'nominal') add(id, hands, v);
    }
  }
  return cases;
}

// BENCH_CACHE=dossier : garde les rendus audio d'une exécution à l'autre (le rendu est la partie lente du banc)
function cachedRender(c, ref) {
  const dir = process.env.BENCH_CACHE;
  if (!dir) return render(ref, VARIANTS[c.variant]);
  const base = path.join(dir, c.name.replace(/[^a-zA-Z0-9-]+/g, '_'));
  if (fs.existsSync(base + '.json')) {
    const meta = JSON.parse(fs.readFileSync(base + '.json', 'utf8'));
    const b = fs.readFileSync(base + '.f32');
    return { ...meta, samples: new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4) };
  }
  const r = render(ref, VARIANTS[c.variant]);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(base + '.f32', Buffer.from(r.samples.buffer, r.samples.byteOffset, r.samples.byteLength));
  fs.writeFileSync(base + '.json', JSON.stringify({ sr: r.sr, seq: r.seq, secPerBeat: r.secPerBeat }));
  return r;
}

export function runCase(c, opts = {}) {
  const ref = referenceOf(c.id, { hands: c.hands });
  const rendered = cachedRender(c, ref);
  const t0 = performance.now();
  const result = transcribe(rendered.samples, rendered.sr, { polyphonic: true, ...opts });
  const ms = performance.now() - t0;
  const raw = toRawSong(result, {});
  if (!raw.transcription && result.confidence != null) raw.transcription = { confidence: result.confidence };
  return { ...c, ...score(ref, raw, rendered, result), ms, audioSec: rendered.samples.length / rendered.sr, ref, raw, result, rendered };
}

export function summarize(rows) {
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const group = (rs) => ({
    n: rs.length,
    f1: mean(rs.map((r) => r.f1)), f1Exact: mean(rs.map((r) => r.f1Exact)), f1Sec: mean(rs.map((r) => r.f1Sec ?? 0)),
    minF1: Math.min(...rs.map((r) => r.f1)),
    tempoOk: mean(rs.map((r) => (r.tempoClass === 'ok' ? 1 : 0))),
    tempoOct: mean(rs.map((r) => (r.tempoClass !== 'ok' && r.tempoClass !== 'faux' ? 1 : 0))),
    meter: mean(rs.map((r) => (r.meter === 'ok' ? 1 : 0))),
    downbeat: mean(rs.map((r) => (r.downbeat ? 1 : 0))),
    key: mean(rs.map((r) => (r.key ? 1 : 0))),
    hands: mean(rs.map((r) => r.hands)),
  });
  const mono = rows.filter((r) => r.hands2 === false), two = rows.filter((r) => r.hands2 === true);
  const s = { mono: group(mono), two: group(two), all: group(rows), variants: {} };
  for (const v of Object.keys(VARIANTS)) {
    const rs = rows.filter((r) => r.variant === v);
    if (rs.length) s.variants[v] = group(rs);
  }
  // score global sur 100 : notes (60 %), tempo (15 %), mesure (10 %), tonalité (5 %), mains (10 %)
  // notes incertaines : part des fausses notes signalées, et part des signalements justifiés
  const wrong = rows.reduce((x, r) => x + r.wrong, 0), fw = rows.reduce((x, r) => x + r.flaggedWrong, 0), fl = rows.reduce((x, r) => x + r.flagged, 0);
  s.flags = { wrong, flaggedWrong: fw, flagged: fl, notes: rows.reduce((x, r) => x + r.nEst, 0) };
  // confiance annoncée contre F1 réel : écart moyen
  s.confError = mean(rows.map((r) => Math.abs((r.confidence ?? 0) - r.f1)));
  s.score = 100 * (0.3 * s.mono.f1 + 0.3 * s.two.f1 + 0.15 * s.all.tempoOk + 0.1 * s.all.meter + 0.05 * s.all.key + 0.1 * s.two.hands);
  return s;
}

const pct = (x) => (x == null ? '  – ' : (100 * x).toFixed(0).padStart(3) + '%');

async function main() {
  const args = process.argv.slice(2);
  const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7) || null;
  const cases = buildCases({ quick: args.includes('--quick'), only });
  const rows = [];
  const t0 = performance.now();
  if (!args.includes('--json')) console.log('cas'.padEnd(40) + '  F1   exact  F1s  préc. rappel tempo        mesure     1er ton mains conf. durée');
  for (const c of cases) {
    const r = runCase(c);
    r.hands2 = c.hands === 'both';
    rows.push(r);
    if (!args.includes('--json')) {
      console.log(
        c.name.padEnd(40) + ` ${pct(r.f1)} ${pct(r.f1Exact)} ${pct(r.f1Sec)} ${pct(r.p)} ${pct(r.r)}  ` +
          `${String(r.tempo).padStart(3)}/${String(Math.round(r.trueTempo)).padEnd(3)} ${r.tempoClass.padEnd(4)} ${r.timeSig.padEnd(4)} ${r.meter.padEnd(4)} ` +
          `${r.downbeat ? 'oui' : 'non'} ${r.key ? 'oui' : 'non'} ${pct(r.hands)} ${pct(r.confidence)} ${(r.ms / 1000).toFixed(1)}s/${r.audioSec.toFixed(0)}s`,
      );
    }
  }
  const s = summarize(rows);
  if (args.includes('--json')) {
    console.log(JSON.stringify({ summary: s, rows: rows.map(({ ref, raw, result, rendered, ...r }) => r) }, null, 1));
    return;
  }
  const line = (name, g) => console.log(
    name.padEnd(22) + `n=${String(g.n).padStart(3)}  F1 ${pct(g.f1)} (min ${pct(g.minF1)}, exact ${pct(g.f1Exact)}, brut ${pct(g.f1Sec)})  tempo ${pct(g.tempoOk)} (+${pct(g.tempoOct).trim()} double/moitié)  mesure ${pct(g.meter)}  1er temps ${pct(g.downbeat)}  ton ${pct(g.key)}  mains ${pct(g.hands)}`,
  );
  console.log('\n— Résumé —');
  line('Mélodie seule', s.mono);
  line('Deux mains', s.two);
  line('Tous', s.all);
  for (const [v, g] of Object.entries(s.variants)) line('  ' + v, g);
  console.log(`\nNotes incertaines : ${s.flags.flagged} signalées sur ${s.flags.notes} ; ${s.flags.flaggedWrong} des ${s.flags.wrong} fausses notes étaient signalées. Confiance annoncée : écart moyen de ${(100 * s.confError).toFixed(1)} points avec le F1 réel.`);
  const audio = rows.reduce((x, r) => x + r.audioSec, 0), ms = rows.reduce((x, r) => x + r.ms, 0);
  console.log(`\nScore global : ${s.score.toFixed(1)} / 100   (vitesse : ${(audio / (ms / 1000)).toFixed(0)}× le temps réel ; banc en ${((performance.now() - t0) / 1000).toFixed(0)} s)`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) main();
