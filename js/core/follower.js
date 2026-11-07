// Suivi de partition (mode Concert) : estime la position dans le morceau à partir de ce qui est joué.
// Alignement souple en ligne : tolère fausses notes, notes oubliées, notes en trop et rubato. Module pur.
import { groupByStart } from './song.js';

export class ScoreFollower {
  /**
   * @param {Array<{midi:number,start:number,dur:number}>} notes notes de la partition (temps en noires)
   * @param {{tempo?:number, window?:number, lostAfter?:number}} [opts]
   */
  constructor(notes, opts = {}) {
    this.events = groupByStart(notes).map((g, i) => ({ index: i, start: g.start, dur: g.dur, midis: g.notes.map((n) => n.midi), notes: g.notes }));
    this.opts = { tempo: 90, window: 6, lostAfter: 4, ...opts };
    this.reset();
  }

  reset() {
    this.pos = 0; // prochain événement attendu
    this.matchedNotes = new Set(); // `${event}:${midi}`
    this.lastMatch = null; // {index, t}
    this.spb = 60 / this.opts.tempo; // tempo local estimé (s par temps)
    this.misses = 0; // notes consécutives non reconnues
    this.recent = []; // dernières hauteurs jouées (pour se resituer quand on est perdu)
    this.stats = { played: 0, matched: 0, extra: 0, jumps: 0 };
  }

  get length() {
    return this.events.length;
  }

  get finished() {
    return this.pos >= this.events.length;
  }

  _remaining(i) {
    const ev = this.events[i];
    return ev.midis.filter((m) => !this.matchedNotes.has(i + ':' + m));
  }

  /**
   * Note jouée.
   * @returns {{matched:boolean, index:number|null, beat:number, jump?:boolean}}
   */
  push(midi, t) {
    this.stats.played++;
    this.recent.push(midi);
    if (this.recent.length > 8) this.recent.shift();
    const W = this.opts.window;
    let best = -1, bestCost = Infinity;
    const lo = Math.max(0, this.pos - 2), hi = Math.min(this.events.length - 1, this.pos + W);
    for (let i = lo; i <= hi; i++) {
      if (!this._remaining(i).includes(midi)) continue;
      // coût : distance à la position attendue (revenir en arrière coûte plus cher que sauter une note)
      let cost = i >= this.pos ? i - this.pos : (this.pos - i) * 1.5 + 0.5;
      // cohérence temporelle (rubato toléré) : légère pénalité si l'écart de temps est très différent de l'attendu
      if (this.lastMatch && i > this.lastMatch.index) {
        const expDt = (this.events[i].start - this.events[this.lastMatch.index].start) * this.spb;
        const dt = t - this.lastMatch.t;
        if (expDt > 0) cost += Math.min(2, Math.abs(Math.log(Math.max(0.05, dt) / expDt)) * 0.5);
      }
      if (cost < bestCost) {
        best = i;
        bestCost = cost;
      }
    }
    let jump = false;
    if (best < 0 && this.misses + 1 >= this.opts.lostAfter) {
      // perdu : chercher dans tout le morceau la séquence des dernières notes jouées
      const j = this.relocate();
      if (j >= 0 && this._remaining(j).includes(midi)) {
        best = j;
        jump = true;
        this.stats.jumps++;
      }
    }
    if (best < 0) {
      this.misses++;
      this.stats.extra++;
      return { matched: false, index: null, beat: this.beatAt(t) };
    }
    this.misses = 0;
    this.stats.matched++;
    this.matchedNotes.add(best + ':' + midi);
    // mise à jour du tempo local (lissée)
    if (this.lastMatch && best > this.lastMatch.index) {
      const db = this.events[best].start - this.events[this.lastMatch.index].start;
      const dt = t - this.lastMatch.t;
      if (db > 0 && dt > 0.05) {
        const spb = dt / db;
        if (spb > 0.1 && spb < 3) this.spb = this.spb * 0.7 + spb * 0.3;
      }
    }
    if (!this.lastMatch || best !== this.lastMatch.index || jump) this.lastMatch = { index: best, t };
    // position : l'événement est consommé quand toutes ses notes sont jouées (ou quand on joue plus loin)
    if (jump) this.pos = best;
    this.pos = Math.max(this.pos, this._remaining(best).length ? best : best + 1);
    return { matched: true, index: best, beat: this.events[best].start, jump };
  }

  /** Index d'événement où la séquence des dernières notes jouées apparaît le mieux (-1 si aucun). */
  relocate() {
    const seq = this.recent.slice(-4);
    if (seq.length < 2) return -1;
    let best = -1, bestScore = 0;
    for (let i = 0; i < this.events.length; i++) {
      // aligne la fin de la séquence sur l'événement i
      let score = 0;
      for (let k = 0; k < seq.length; k++) {
        const e = this.events[i - (seq.length - 1 - k)];
        if (e && e.midis.includes(seq[k])) score++;
      }
      if (score > bestScore || (score === bestScore && best >= 0 && Math.abs(i - this.pos) < Math.abs(best - this.pos))) {
        best = i;
        bestScore = score;
      }
    }
    return bestScore >= Math.min(3, seq.length) ? best : -1;
  }

  /** Position estimée (temps) à l'instant t : avance au tempo local, sans dépasser l'événement suivant. */
  beatAt(t) {
    if (!this.lastMatch) return this.events[0]?.start ?? 0;
    const ev = this.events[this.lastMatch.index];
    const next = this.events[this.lastMatch.index + 1];
    const b = ev.start + Math.max(0, t - this.lastMatch.t) / this.spb;
    const cap = next ? next.start : ev.start + ev.dur;
    return Math.min(b, cap);
  }

  /** Proportion des notes de la partition reconnues. */
  coverage() {
    const total = this.events.reduce((a, e) => a + e.midis.length, 0);
    return total ? this.matchedNotes.size / total : 0;
  }
}
