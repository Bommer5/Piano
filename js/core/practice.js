// Moteur d'entraînement (pur, sans DOM) : compare les notes jouées à la partition.
//
// Modes :
//  - 'wait'  : la partition attend que tu joues la bonne note / le bon accord (idéal pour apprendre).
//  - 'tempo' : la partition défile au tempo ; chaque note est jugée sur sa justesse ET sa précision rythmique.
// Options : rhythmOnly (toute touche acceptée, seul le placement compte), chordWindow (s, mode attente),
// velocityCalib ({soft, loud} pour les nuances), octaveTolerant.
import { buildEvents, measureOf } from './song.js';
import { pitchClass } from './notes.js';

const EPS = 1e-6;

// Fenêtres de jugement en fraction de temps, bornées en secondes (± autour du temps attendu).
export const JUDGE_BEATS = { perfect: 0.1, good: 0.2, ok: 0.35 };
export const JUDGE_LIMITS = { perfect: [0.05, 0.1], good: [0.1, 0.2], ok: [0.18, 0.35] };
export function judgeWindows(secPerBeat) {
  const w = {};
  for (const k of Object.keys(JUDGE_BEATS)) {
    const [lo, hi] = JUDGE_LIMITS[k];
    w[k] = Math.max(lo, Math.min(hi, JUDGE_BEATS[k] * secPerBeat));
  }
  return w;
}
export const JUDGE = judgeWindows(0.5); // valeurs à 120 BPM (compatibilité)

/** Seuils de durée tenue (rapport durée jouée / durée écrite). */
export const HOLD = { short: 0.7, long: 1.2 };
/** Écart maximal (s) entre la 1re et la dernière note d'un accord plaqué (mode attente). */
export const CHORD_WINDOW = 1.0;
/** Au-delà de cet écart (s), un accord est considéré arpégé dans le rapport. */
export const ARPEGGIO_GAP = 0.04;

export function holdVerdict(ratio, pedalDown = false) {
  if (!Number.isFinite(ratio)) return 'ok';
  if (ratio < HOLD.short) return 'short';
  if (ratio > HOLD.long && !pedalDown) return 'long';
  return 'ok';
}

/**
 * Conversion temps (noires) <-> secondes, avec carte de tempo facultative `song.tempoMap:[{beat,bpm}]`.
 * `tempo` est le tempo effectif correspondant à `song.tempo` (le pourcentage s'applique à toute la carte).
 */
export class Timeline {
  constructor(song, tempo) {
    const base = song.tempo > 0 ? song.tempo : 90;
    const scale = (tempo > 0 ? tempo : base) / base;
    const map = (Array.isArray(song.tempoMap) ? song.tempoMap : [])
      .filter((x) => x && Number.isFinite(x.beat) && x.bpm > 0)
      .map((x) => ({ beat: Math.max(0, x.beat), bpm: x.bpm }))
      .sort((a, b) => a.beat - b.beat);
    const segs = [];
    if (!map.length || map[0].beat > EPS) segs.push({ beat: 0, bpm: base });
    for (const m of map) {
      const last = segs[segs.length - 1];
      if (last && Math.abs(last.beat - m.beat) < EPS) last.bpm = m.bpm;
      else segs.push({ ...m });
    }
    let sec = 0;
    this.segs = segs.map((s, i) => {
      if (i > 0) {
        const p = segs[i - 1];
        sec += (s.beat - p.beat) * (60 / (p.bpm * scale));
      }
      return { beat: s.beat, sec, spb: 60 / (s.bpm * scale), bpm: s.bpm * scale };
    });
    this.scale = scale;
  }

  _segByBeat(beat) {
    const s = this.segs;
    let lo = 0, hi = s.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (s[mid].beat <= beat + EPS) lo = mid;
      else hi = mid - 1;
    }
    return s[lo];
  }

  _segBySec(sec) {
    const s = this.segs;
    let lo = 0, hi = s.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (s[mid].sec <= sec + EPS) lo = mid;
      else hi = mid - 1;
    }
    return s[lo];
  }

  /** Secondes depuis le temps 0 (extrapolation linéaire avant 0). */
  secAt(beat) {
    const g = this._segByBeat(beat);
    return g.sec + (beat - g.beat) * g.spb;
  }

  beatAt(sec) {
    const g = this._segBySec(sec);
    return g.beat + (sec - g.sec) / g.spb;
  }

  spbAt(beat) {
    return this._segByBeat(beat).spb;
  }

  bpmAt(beat) {
    return this._segByBeat(beat).bpm;
  }

  get variable() {
    return this.segs.length > 1;
  }
}

// ---------- nuances ----------
export const DYN_LEVELS = { ppp: 1, pp: 2, p: 3, mp: 4, mf: 5, f: 6, ff: 7, fff: 8, sfz: 7, sf: 7, fp: 6 };

/** Nuance en vigueur à un temps donné (null si aucune). */
export function dynamicAt(dynamics, beat) {
  let cur = null;
  for (const d of dynamics || []) {
    if (d.beat > beat + EPS) break;
    if (DYN_LEVELS[d.mark] != null) cur = d.mark;
  }
  return cur;
}

/**
 * Juge le contraste des nuances : « p » doit être nettement plus doux que « f ».
 * @param {Array<{mark:string, v:number}>} samples vélocités (0..1) par nuance attendue
 * @param {{soft?:number, loud?:number}} [calib] vélocités mesurées en jouant doucement / fort
 */
export function judgeDynamics(samples, calib = null) {
  const norm = (v) => (calib && calib.loud > calib.soft ? Math.max(0, Math.min(1, (v - calib.soft) / (calib.loud - calib.soft))) : v);
  const minDiff = calib && calib.loud > calib.soft ? 0.15 : 0.08;
  const groups = new Map();
  for (const s of samples || []) {
    if (DYN_LEVELS[s.mark] == null || !Number.isFinite(s.v)) continue;
    const g = groups.get(s.mark) || { mark: s.mark, level: DYN_LEVELS[s.mark], sum: 0, n: 0 };
    g.sum += norm(s.v);
    g.n++;
    groups.set(s.mark, g);
  }
  const byMark = [...groups.values()].map((g) => ({ mark: g.mark, level: g.level, avg: g.sum / g.n, n: g.n })).sort((a, b) => a.level - b.level);
  const contrasts = [];
  for (let i = 0; i < byMark.length; i++) {
    for (let j = i + 1; j < byMark.length; j++) {
      const a = byMark[i], b = byMark[j];
      if (b.level - a.level < 2) continue;
      const diff = b.avg - a.avg;
      contrasts.push({ soft: a.mark, loud: b.mark, diff, ok: diff >= minDiff });
    }
  }
  const failed = contrasts.filter((c) => !c.ok);
  const ok = contrasts.length > 0 && !failed.length;
  let message = '';
  if (!contrasts.length) message = byMark.length ? 'Pas assez de nuances différentes pour juger le contraste.' : '';
  else if (ok) message = 'Nuances bien contrastées.';
  else message = failed.map((c) => `« ${c.soft} » devrait être nettement plus doux que « ${c.loud} »`).join(' ; ') + '.';
  return { byMark, contrasts, ok, message };
}

/**
 * Juge la pédale : chaque changement attendu doit avoir lieu à ± tol secondes.
 * @param {Array<{t:number, down:boolean}>} expected
 * @param {Array<{t:number, down:boolean}>} actual
 */
export function judgePedal(expected, actual, tol = 0.35) {
  const used = new Set();
  const missed = [];
  let matched = 0;
  for (const e of expected) {
    let best = -1, bestD = Infinity;
    actual.forEach((a, i) => {
      if (used.has(i) || a.down !== e.down) return;
      const d = Math.abs(a.t - e.t);
      if (d <= tol && d < bestD) {
        best = i;
        bestD = d;
      }
    });
    if (best >= 0) {
      used.add(best);
      matched++;
    } else missed.push(e);
  }
  return { expected: expected.length, matched, missed, ok: matched === expected.length };
}

export class PracticeEngine {
  /**
   * @param {object} song morceau préparé (prepareSong)
   * @param {{mode?:'wait'|'tempo', hands?:'both'|'R'|'L', from?:number, to?:number, octaveTolerant?:boolean, tempo?:number, rhythmOnly?:boolean, chordWindow?:number, velocityCalib?:object}} opts
   */
  constructor(song, opts = {}) {
    this.song = song;
    this.opts = { mode: 'wait', hands: 'both', from: 0, to: Infinity, octaveTolerant: false, tempo: song.tempo, rhythmOnly: false, chordWindow: CHORD_WINDOW, ...opts };
    this.events = buildEvents(song, this.opts);
    this._timeline();
    this.reset();
  }

  _timeline() {
    this.timeline = new Timeline(this.song, this.opts.tempo);
    this._t0 = this.timeline.secAt(this.opts.from);
    for (const ev of this.events) {
      ev.time = this.timeOf(ev.start);
      ev.win = judgeWindows(this.timeline.spbAt(ev.start));
    }
  }

  /** Change le tempo effectif (garde les jugements déjà faits). */
  setTempo(tempo) {
    this.opts.tempo = tempo;
    this._timeline();
  }

  /** Secondes depuis le début du passage (opts.from) pour un temps donné. */
  timeOf(beat) {
    return this.timeline.secAt(beat) - this._t0;
  }

  /** Temps (noires) pour une position en secondes depuis le début du passage. */
  beatOf(sec) {
    return this.timeline.beatAt(sec + this._t0);
  }

  get secPerBeat() {
    return this.timeline ? this.timeline.spbAt(this.opts.from) : 60 / this.opts.tempo;
  }

  get windows() {
    return judgeWindows(this.secPerBeat);
  }

  reset() {
    this.index = 0;
    this.tIdx = 0; // mode tempo : premier événement dont la fenêtre n'est pas encore close
    this.satisfied = new Set();
    this.chordT0 = null;
    this.finished = this.events.length === 0;
    this.stats = {
      hits: 0, misses: 0, wrong: 0, streak: 0, bestStreak: 0, timing: [], perfect: 0, good: 0, ok: 0,
      errorsByMeasure: {}, errorsByNote: {}, holds: [], legatoMissed: [], chordIssues: [], dyn: [], pedalActions: [], skipped: 0,
    };
    this.judged = new Map(); // tempo : note id -> résultat
    this.holding = new Map(); // midi -> note tenue (durée / legato)
    this.lastByHand = {};
    this.pedalDown = false;
    this.log = [];
  }

  get current() {
    return this.events[this.index] || null;
  }

  matches(played, expected) {
    if (this.opts.rhythmOnly) return true;
    if (played === expected) return true;
    return this.opts.octaveTolerant && pitchClass(played) === pitchClass(expected);
  }

  /** Bonne note mais mauvaise octave (acceptée en mode tolérant, signalée à l'élève). */
  wrongOctave(played, expected) {
    return !this.opts.rhythmOnly && played !== expected && pitchClass(played) === pitchClass(expected);
  }

  _measure(beat) {
    return measureOf(this.song, beat) + 1;
  }

  _error(midi, event) {
    this.stats.wrong++;
    this.stats.streak = 0;
    if (event) {
      const m = this._measure(event.start);
      this.stats.errorsByMeasure[m] = (this.stats.errorsByMeasure[m] || 0) + 1;
      for (const e of event.midis) this.stats.errorsByNote[e] = (this.stats.errorsByNote[e] || 0) + 1;
    }
  }

  _hit() {
    this.stats.hits++;
    this.stats.streak++;
    this.stats.bestStreak = Math.max(this.stats.bestStreak, this.stats.streak);
  }

  _dyn(note, info) {
    if (info?.velocity == null || !this.song.dynamics?.length) return;
    const mark = dynamicAt(this.song.dynamics, note.start);
    if (mark) this.stats.dyn.push({ mark, v: info.velocity, noteId: note.id });
  }

  /**
   * Note jouée.
   * @param {number} midi
   * @param {number} [timeSec] position dans le morceau en secondes (mode tempo) ou horloge murale (mode attente)
   * @param {{velocity?:number}} [info] vélocité 0..1 (clavier MIDI) pour les nuances
   * @returns {{type:'hit'|'wrong'|'ignored'|'advance'|'finish'|'offtime', midi:number, expected?:number[], grade?:string, delta?:number}}
   */
  input(midi, timeSec = 0, info = null) {
    if (this.finished) return { type: 'ignored', midi };
    return this.opts.mode === 'tempo' ? this._inputTempo(midi, timeSec, info) : this._inputWait(midi, timeSec, info);
  }

  _inputWait(midi, t = 0, info = null) {
    const ev = this.current;
    const target = ev.midis.find((m) => !this.satisfied.has(m) && this.matches(midi, m));
    if (target == null) {
      // Une note déjà validée de l'accord (ou de l'accord précédent qui résonne) n'est pas une faute.
      const prev = this.events[this.index - 1];
      if (ev.midis.some((m) => this.matches(midi, m)) || (prev && prev.midis.some((m) => this.matches(midi, m)) && this.satisfied.size === 0)) {
        return { type: 'ignored', midi, expected: ev.midis };
      }
      this._error(midi, ev);
      this.log.push({ type: 'wrong', midi, event: ev.index, expected: ev.midis, t });
      return { type: 'wrong', midi, expected: ev.midis };
    }
    if (this.satisfied.size === 0) this.chordT0 = t;
    this.satisfied.add(target);
    this._hit(); // chaque note juste compte, comme chaque fausse note (score équilibré pour les accords)
    const note = ev.notes.find((n) => n.midi === target);
    if (note) this._dyn(note, info);
    const octave = this.wrongOctave(midi, target);
    if (octave) this.stats.octaveWarnings = (this.stats.octaveWarnings || 0) + 1;
    if (this.satisfied.size >= ev.midis.length) {
      this.log.push({ type: 'hit', event: ev.index, t });
      let chord = null;
      if (ev.midis.length > 1 && this.chordT0 != null && t - this.chordT0 > this.opts.chordWindow) {
        chord = { spread: t - this.chordT0, event: ev.index, measure: this._measure(ev.start) };
        this.stats.chordIssues.push(chord);
      }
      return { ...this._advance(midi), octave, noteId: note?.id, chordNotTogether: !!chord, chordSpread: chord?.spread };
    }
    return { type: 'hit', midi, expected: ev.midis, partial: true, octave, noteId: note?.id };
  }

  _advance(midi) {
    this.index++;
    this.satisfied = new Set();
    this.chordT0 = null;
    if (this.index >= this.events.length) {
      this.finished = true;
      return { type: 'finish', midi };
    }
    return { type: 'advance', midi, next: this.current };
  }

  /** Mode attente avec plusieurs notes reconnues d'un coup (accord détecté au micro ou MIDI). */
  inputChord(midis, timeSec = 0) {
    let last = { type: 'ignored' };
    for (const m of midis) {
      if (this.finished) break;
      last = this.input(m, timeSec);
    }
    return last;
  }

  _inputTempo(midi, timeSec, info = null) {
    const evs = this.events;
    // note attendue non jugée la plus proche dans la fenêtre (parcours à partir de l'index courant)
    let best = null, bestDelta = Infinity;
    for (let i = this.tIdx; i < evs.length; i++) {
      const ev = evs[i];
      const delta = timeSec - ev.time;
      if (delta < -ev.win.ok) break;
      if (delta > ev.win.ok) continue;
      for (const n of ev.notes) {
        if (this.judged.has(n.id) || !this.matches(midi, n.midi)) continue;
        // à écart égal, préférer la note exacte (rythme seul : n'importe laquelle)
        const better = Math.abs(delta) < Math.abs(bestDelta) - EPS || (Math.abs(Math.abs(delta) - Math.abs(bestDelta)) < EPS && n.midi === midi && best?.n.midi !== midi);
        if (better) {
          best = { n, ev };
          bestDelta = delta;
        }
      }
    }
    if (!best) {
      // Bonne note mais hors fenêtre : ce n'est pas une fausse note (elle sera comptée « ratée » par tick)
      let late = false;
      for (let i = this.tIdx; i < evs.length; i++) {
        const e = evs[i];
        if (e.time - timeSec > 1.5) break;
        if (Math.abs(timeSec - e.time) < 1.5 && e.notes.some((n) => !this.judged.has(n.id) && this.matches(midi, n.midi))) {
          late = true;
          break;
        }
      }
      if (late) {
        this.log.push({ type: 'offtime', midi, t: timeSec });
        return { type: 'offtime', midi };
      }
      let ev = null;
      for (let i = Math.max(0, this.tIdx - 2); i < evs.length; i++) {
        const e = evs[i];
        if (e.time - timeSec > e.win.ok) break;
        if (Math.abs(timeSec - e.time) <= e.win.ok) {
          ev = e;
          break;
        }
      }
      this.log.push({ type: 'wrong', midi, t: timeSec, expected: ev ? ev.midis : [], event: ev?.index });
      this._error(midi, ev);
      return { type: 'wrong', midi, expected: ev ? ev.midis : [] };
    }
    const W = best.ev.win;
    const abs = Math.abs(bestDelta);
    const grade = abs <= W.perfect ? 'perfect' : abs <= W.good ? 'good' : 'ok';
    const n = best.n;
    this.stats[grade]++;
    this.stats.timing.push(bestDelta);
    this.judged.set(n.id, grade);
    this._hit();
    this._dyn(n, info);
    // durée tenue / legato
    const hold = { note: n, t: timeSec, expSec: this.timeOf(n.start + n.dur) - this.timeOf(n.start), released: null };
    let legatoMissed = false;
    const prev = this.lastByHand[n.hand];
    if (prev && n.slur && prev.note.slur && prev.note.slur !== 'stop' && n.slur !== 'start' && prev.note.midi !== n.midi && Math.abs(prev.note.start + prev.note.dur - n.start) < 0.05) {
      if (prev.released != null && timeSec - prev.released > 0.03) {
        legatoMissed = true;
        this.stats.legatoMissed.push({ noteId: n.id, prevId: prev.note.id, gapMs: Math.round((timeSec - prev.released) * 1000), measure: this._measure(n.start) });
      }
    }
    this.lastByHand[n.hand] = hold;
    this.holding.set(midi, hold);
    this.log.push({ type: 'hit', midi, t: timeSec, noteId: n.id, delta: bestDelta });
    return { type: 'hit', midi, grade, delta: bestDelta, noteId: n.id, octave: this.wrongOctave(midi, n.midi), legatoMissed };
  }

  /**
   * Touche relâchée : jugement de la durée tenue (mode tempo).
   * @returns {null|{type:'release', noteId:number, ratio:number, verdict:'short'|'long'|'ok'}}
   */
  release(midi, timeSec) {
    const h = this.holding.get(midi);
    if (!h) return null;
    this.holding.delete(midi);
    h.released = timeSec;
    const held = timeSec - h.t;
    const ratio = h.expSec > 0 ? held / h.expSec : 1;
    // notes très brèves : la précision de relâchement n'est pas pertinente
    const verdict = h.expSec < 0.12 ? 'ok' : holdVerdict(ratio, this.pedalDown);
    const rec = { noteId: h.note.id, midi: h.note.midi, ratio, verdict, measure: this._measure(h.note.start), pedal: this.pedalDown };
    this.stats.holds.push(rec);
    return { type: 'release', ...rec };
  }

  /** Pédale de sustain enfoncée / relâchée. */
  pedal(down, timeSec) {
    this.pedalDown = !!down;
    this.stats.pedalActions.push({ t: timeSec, down: !!down });
  }

  /** Se placer à un temps donné (navigation par mesure). Les notes sautées ne comptent pas. */
  seek(beat) {
    const idx = this.events.findIndex((e) => e.start >= beat - EPS);
    const i = idx < 0 ? this.events.length : idx;
    if (this.opts.mode === 'tempo') {
      for (let k = 0; k < this.events.length; k++) {
        for (const n of this.events[k].notes) {
          if (k < i && !this.judged.has(n.id)) {
            this.judged.set(n.id, 'skip');
            this.stats.skipped++;
          } else if (k >= i && this.judged.get(n.id) === 'skip') {
            this.judged.delete(n.id);
            this.stats.skipped--;
          }
        }
      }
      this.tIdx = i;
    }
    this.index = i;
    this.satisfied = new Set();
    this.chordT0 = null;
    this.finished = i >= this.events.length;
  }

  /** Mode tempo : à appeler régulièrement, marque les notes manquées. Renvoie les notes manquées. */
  tick(timeSec) {
    if (this.opts.mode !== 'tempo' || this.finished) return [];
    const missed = [];
    const evs = this.events;
    while (this.tIdx < evs.length) {
      const ev = evs[this.tIdx];
      if (timeSec - ev.time <= ev.win.ok) break;
      for (const n of ev.notes) {
        if (!this.judged.has(n.id)) {
          this.judged.set(n.id, 'miss');
          this.stats.misses++;
          this.stats.streak = 0;
          const m = this._measure(ev.start);
          this.stats.errorsByMeasure[m] = (this.stats.errorsByMeasure[m] || 0) + 1;
          this.stats.errorsByNote[n.midi] = (this.stats.errorsByNote[n.midi] || 0) + 1;
          missed.push(n);
        }
      }
      this.tIdx++;
    }
    const last = evs[evs.length - 1];
    const end = this.timeOf(last.start + last.dur);
    if (timeSec > end + last.win.ok) this.finished = true;
    return missed;
  }

  /** Changements de pédale attendus dans le passage (secondes depuis le début du passage). */
  expectedPedal() {
    const { from, to } = this.opts;
    return (this.song.pedal || []).filter((p) => p.beat >= from - EPS && p.beat < to - EPS).map((p) => ({ t: this.timeOf(p.beat), down: !!p.down, beat: p.beat }));
  }

  /** Synthèse : précision, étoiles, tendance rythmique, durées, legato, accords, nuances, pédale. */
  summary() {
    const s = this.stats;
    const total = s.hits + s.misses + s.wrong;
    const accuracy = total ? s.hits / total : 0;
    const avgTiming = s.timing.length ? s.timing.reduce((a, b) => a + b, 0) / s.timing.length : 0;
    const stars = accuracy >= 0.95 ? 3 : accuracy >= 0.8 ? 2 : accuracy >= 0.6 ? 1 : 0;
    const worstMeasures = Object.entries(s.errorsByMeasure).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m, c]) => ({ measure: Number(m), errors: c }));
    let tendency = 'régulier';
    if (s.timing.length >= 4) {
      if (avgTiming > 0.05) tendency = 'en retard';
      else if (avgTiming < -0.05) tendency = 'en avance';
    }
    const holdsShort = s.holds.filter((x) => x.verdict === 'short').length;
    const holdsLong = s.holds.filter((x) => x.verdict === 'long').length;
    const out = { ...s, total, accuracy, score: Math.round(accuracy * 100), stars, avgTiming, tendency, worstMeasures, holdsShort, holdsLong };
    if (s.dyn.length) out.dynamics = judgeDynamics(s.dyn, this.opts.velocityCalib);
    if (this.opts.mode === 'tempo' && this.song.pedal?.length) {
      const exp = this.expectedPedal();
      if (exp.length) out.pedal = judgePedal(exp, s.pedalActions, Math.max(0.25, this.secPerBeat * 0.5));
    }
    return out;
  }
}
