// Moteur d'entraînement (pur, sans DOM) : compare les notes jouées à la partition.
//
// Modes :
//  - 'wait'  : la partition attend que tu joues la bonne note / le bon accord (idéal pour apprendre).
//  - 'tempo' : la partition défile au tempo ; chaque note est jugée sur sa justesse ET sa précision rythmique.
import { buildEvents, measureOf } from './song.js';
import { pitchClass } from './notes.js';

export const JUDGE = { perfect: 0.08, good: 0.16, ok: 0.28 }; // en secondes (± autour du temps attendu)

export class PracticeEngine {
  /**
   * @param {object} song morceau préparé (prepareSong)
   * @param {{mode?:'wait'|'tempo', hands?:'both'|'R'|'L', from?:number, to?:number, octaveTolerant?:boolean, tempo?:number}} opts
   */
  constructor(song, opts = {}) {
    this.song = song;
    this.opts = { mode: 'wait', hands: 'both', from: 0, to: Infinity, octaveTolerant: false, tempo: song.tempo, ...opts };
    this.events = buildEvents(song, this.opts);
    this.reset();
  }

  get secPerBeat() {
    return 60 / this.opts.tempo;
  }

  reset() {
    this.index = 0;
    this.satisfied = new Set();
    this.finished = this.events.length === 0;
    this.stats = { hits: 0, misses: 0, wrong: 0, streak: 0, bestStreak: 0, timing: [], perfect: 0, good: 0, ok: 0, errorsByMeasure: {}, errorsByNote: {} };
    this.judged = new Map(); // tempo : note id -> résultat
    this.log = [];
  }

  get current() {
    return this.events[this.index] || null;
  }

  matches(played, expected) {
    if (played === expected) return true;
    return this.opts.octaveTolerant && pitchClass(played) === pitchClass(expected);
  }

  _error(midi, event) {
    this.stats.wrong++;
    this.stats.streak = 0;
    if (event) {
      const m = measureOf(this.song, event.start) + 1;
      this.stats.errorsByMeasure[m] = (this.stats.errorsByMeasure[m] || 0) + 1;
      for (const e of event.midis) this.stats.errorsByNote[e] = (this.stats.errorsByNote[e] || 0) + 1;
    }
  }

  _hit() {
    this.stats.hits++;
    this.stats.streak++;
    this.stats.bestStreak = Math.max(this.stats.bestStreak, this.stats.streak);
  }

  /**
   * Note jouée.
   * @param {number} midi
   * @param {number} [timeSec] position dans le morceau en secondes (mode tempo)
   * @returns {{type:'hit'|'wrong'|'ignored'|'advance'|'finish', midi:number, expected?:number[], grade?:string, delta?:number}}
   */
  input(midi, timeSec = 0) {
    if (this.finished) return { type: 'ignored', midi };
    return this.opts.mode === 'tempo' ? this._inputTempo(midi, timeSec) : this._inputWait(midi);
  }

  _inputWait(midi) {
    const ev = this.current;
    const target = ev.midis.find((m) => !this.satisfied.has(m) && this.matches(midi, m));
    if (target == null) {
      // Une note déjà validée de l'accord (ou de l'accord précédent qui résonne) n'est pas une faute.
      const prev = this.events[this.index - 1];
      if (ev.midis.some((m) => this.matches(midi, m)) || (prev && prev.midis.some((m) => this.matches(midi, m)) && this.satisfied.size === 0)) {
        return { type: 'ignored', midi, expected: ev.midis };
      }
      this._error(midi, ev);
      this.log.push({ type: 'wrong', midi, event: ev.index });
      return { type: 'wrong', midi, expected: ev.midis };
    }
    this.satisfied.add(target);
    if (this.satisfied.size >= ev.midis.length) {
      this._hit();
      this.log.push({ type: 'hit', event: ev.index });
      return this._advance(midi);
    }
    return { type: 'hit', midi, expected: ev.midis, partial: true };
  }

  _advance(midi) {
    this.index++;
    this.satisfied = new Set();
    if (this.index >= this.events.length) {
      this.finished = true;
      return { type: 'finish', midi };
    }
    return { type: 'advance', midi, next: this.current };
  }

  /** Mode attente avec plusieurs notes reconnues d'un coup (accord détecté au micro ou MIDI). */
  inputChord(midis) {
    let last = { type: 'ignored' };
    for (const m of midis) {
      if (this.finished) break;
      last = this.input(m);
    }
    return last;
  }

  _inputTempo(midi, timeSec) {
    const spb = this.secPerBeat;
    // note attendue non jugée la plus proche dans la fenêtre
    let best = null, bestDelta = Infinity;
    for (const ev of this.events) {
      const evTime = (ev.start - this.opts.from) * spb;
      const delta = timeSec - evTime;
      if (delta < -JUDGE.ok) break;
      if (delta > JUDGE.ok) continue;
      for (const n of ev.notes) {
        if (this.judged.has(n.id) || !this.matches(midi, n.midi)) continue;
        if (Math.abs(delta) < Math.abs(bestDelta)) {
          best = { n, ev };
          bestDelta = delta;
        }
      }
    }
    if (!best) {
      const ev = this.events.find((e) => Math.abs(timeSec - (e.start - this.opts.from) * spb) <= JUDGE.ok);
      this._error(midi, ev);
      return { type: 'wrong', midi, expected: ev ? ev.midis : [] };
    }
    const abs = Math.abs(bestDelta);
    const grade = abs <= JUDGE.perfect ? 'perfect' : abs <= JUDGE.good ? 'good' : 'ok';
    this.stats[grade]++;
    this.stats.timing.push(bestDelta);
    this.judged.set(best.n.id, grade);
    this._hit();
    return { type: 'hit', midi, grade, delta: bestDelta, noteId: best.n.id };
  }

  /** Mode tempo : à appeler régulièrement, marque les notes manquées. Renvoie les notes manquées. */
  tick(timeSec) {
    if (this.opts.mode !== 'tempo' || this.finished) return [];
    const spb = this.secPerBeat;
    const missed = [];
    for (const ev of this.events) {
      const evTime = (ev.start - this.opts.from) * spb;
      if (timeSec - evTime <= JUDGE.ok) break;
      for (const n of ev.notes) {
        if (!this.judged.has(n.id)) {
          this.judged.set(n.id, 'miss');
          this.stats.misses++;
          this.stats.streak = 0;
          const m = measureOf(this.song, ev.start) + 1;
          this.stats.errorsByMeasure[m] = (this.stats.errorsByMeasure[m] || 0) + 1;
          this.stats.errorsByNote[n.midi] = (this.stats.errorsByNote[n.midi] || 0) + 1;
          missed.push(n);
        }
      }
    }
    const last = this.events[this.events.length - 1];
    const end = (last.start + last.dur - this.opts.from) * spb;
    if (timeSec > end + JUDGE.ok) this.finished = true;
    return missed;
  }

  /** Synthèse : précision, étoiles, tendance rythmique. */
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
    return { ...s, total, accuracy, score: Math.round(accuracy * 100), stars, avgTiming, tendency, worstMeasures };
  }
}
