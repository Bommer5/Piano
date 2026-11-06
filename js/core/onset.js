// Détection d'attaques de notes à partir des trames du micro.
// Une note répétée (même hauteur) doit être re-déclenchée par une attaque : sinon une note qui résonne
// validerait faussement la note suivante identique.

export class OnsetDetector {
  constructor({ minRms = 0.012, attackRatio = 1.6, stableFrames = 2, minClarity = 0.75, silenceRms = 0.007, refractoryMs = 90 } = {}) {
    Object.assign(this, { minRms, attackRatio, stableFrames, minClarity, silenceRms, refractoryMs });
    this.reset();
  }

  reset() {
    this.history = []; // {t, rms}
    this.lastEmitted = null;
    this.lastEmitTime = -Infinity;
    this.attackPending = false;
    this.lastAttackTime = -Infinity;
    this.candidate = null;
    this.candidateCount = 0;
    this.silentFrames = 0;
  }

  /**
   * @param {{t:number, rms:number, midi:number|null, clarity?:number}} frame t en ms
   * @returns {{attack:boolean, onset:number|null}}
   */
  push(frame) {
    const { t, rms, midi } = frame;
    const clarity = frame.clarity ?? 1;
    // Creux d'énergie récent (fenêtre ~200 ms)
    this.history.push({ t, rms });
    while (this.history.length && t - this.history[0].t > 200) this.history.shift();
    const trough = Math.min(...this.history.map((h) => h.rms));

    let attack = false;
    if (rms > this.minRms && rms > trough * this.attackRatio + 0.004 && t - this.lastAttackTime > this.refractoryMs) {
      attack = true;
      this.lastAttackTime = t;
      this.attackPending = true;
      // réarme le creux pour éviter un double déclenchement sur la même montée
      this.history = [{ t, rms }];
    }

    if (rms < this.silenceRms) {
      this.silentFrames++;
      if (this.silentFrames >= 2) {
        this.lastEmitted = null;
        this.candidate = null;
        this.candidateCount = 0;
      }
      return { attack, onset: null };
    }
    this.silentFrames = 0;

    if (midi == null || clarity < this.minClarity || rms < this.minRms) {
      this.candidate = null;
      this.candidateCount = 0;
      return { attack, onset: null };
    }

    if (midi === this.candidate) this.candidateCount++;
    else {
      this.candidate = midi;
      this.candidateCount = 1;
    }

    let onset = null;
    if (this.candidateCount >= this.stableFrames) {
      const isNewPitch = midi !== this.lastEmitted;
      if ((isNewPitch || this.attackPending) && t - this.lastEmitTime > 60) {
        onset = midi;
        this.lastEmitted = midi;
        this.lastEmitTime = t;
        this.attackPending = false;
      }
    }
    return { attack, onset };
  }
}

/** Lisse la hauteur (médiane glissante) pour un affichage d'accordeur stable. */
export class PitchSmoother {
  constructor(size = 5) {
    this.size = size;
    this.values = [];
  }
  push(v) {
    if (v == null) {
      this.values = [];
      return null;
    }
    this.values.push(v);
    if (this.values.length > this.size) this.values.shift();
    const s = [...this.values].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }
}
