// Détection d'attaques de notes à partir des trames du micro.
// Une note répétée (même hauteur) doit être re-déclenchée par une attaque : sinon une note qui résonne
// validerait faussement la note suivante identique.

/**
 * Détecteur de « frappes » (transitoires) sur le signal brut : repère le choc du marteau.
 * Principe : énergie de la dérivée du signal (accentue les aigus, là où le choc est net et où la résonance
 * de la note précédente est déjà faible), par petits blocs, comparée au MAXIMUM des blocs des ~70 ms
 * précédentes (le maximum couvre au moins une période des notes graves : un son tenu ne déclenche jamais).
 * Contrairement au volume moyen, ce critère détecte une note REJOUÉE pendant qu'elle résonne encore.
 */
export class TransientDetector {
  constructor(sampleRate, { blockMs = 5, refMs = 70, ratio = 2.2, refractoryMs = 70, minEnergy = 1e-9 } = {}) {
    this.sr = sampleRate;
    this.half = Math.max(8, Math.round((blockMs * sampleRate) / 2000)); // demi-bloc (blocs recouvrants à 50 %)
    this.refSteps = Math.max(6, Math.round((2 * refMs) / blockMs));
    this.ratio = ratio;
    this.refractory = Math.round((refractoryMs * sampleRate) / 1000);
    this.minEnergy = minEnergy;
    this.ring = new Float64Array(this.refSteps + 2); // +2 : les deux pas les plus récents sont exclus de la référence
    this.reset();
  }

  reset() {
    this.ring.fill(0);
    this.ringPos = 0;
    this.filled = 0;
    this.p1 = 0;
    this.p2 = 0;
    this.acc = 0;
    this.count = 0;
    this.prevHalf = 0;
    this.total = 0; // échantillons vus
    this.floor = 0; // plancher de bruit de fond
    this.lastAttack = -Infinity;
  }

  /**
   * @param {Float32Array} samples
   * @param {(sampleIndex:number, strength:number)=>void} onAttack sampleIndex = index absolu du début du bloc d'attaque
   */
  push(samples, onAttack) {
    const H = this.half;
    const n = this.ring.length;
    for (let i = 0; i < samples.length; i++) {
      const x = samples[i];
      // dérivée seconde : accentue fortement les aigus (choc du marteau), atténue la résonance des notes tenues
      const d = x - 2 * this.p1 + this.p2;
      this.p2 = this.p1;
      this.p1 = x;
      this.acc += d * d;
      if (++this.count === H) {
        const half = this.acc / H;
        this.acc = 0;
        this.count = 0;
        const E = (half + this.prevHalf) / 2; // bloc = 2 demi-blocs, recouvrement 50 %
        this.prevHalf = half;
        // référence : maximum des blocs précédents, en sautant les 2 pas les plus récents
        // (ils partagent des échantillons avec le bloc courant ou contiennent le début de la montée)
        let ref = 0;
        for (let k = 3; k <= n; k++) {
          const v = this.ring[(this.ringPos - k + 2 * n) % n];
          if (v > ref) ref = v;
        }
        const start = this.total + i + 1 - 2 * H;
        if (this.filled >= 6 && E > this.ratio * ref && E > 6 * this.floor + this.minEnergy && start - this.lastAttack > this.refractory) {
          this.lastAttack = start;
          onAttack(Math.max(0, start), ref > 0 ? E / ref : Infinity);
        }
        this.ring[this.ringPos] = E;
        this.ringPos = (this.ringPos + 1) % n;
        if (this.filled < n) this.filled++;
        // plancher de bruit de fond = minimum récent : descend vite, remonte très lentement (×2 en ~5 s),
        // pour ne jamais « apprendre » une note tenue comme si c'était du bruit
        this.floor = this.floor === 0 ? half : half < this.floor ? this.floor + (half - this.floor) * 0.5 : this.floor * 1.00035;
      }
    }
    this.total += samples.length;
  }
}

const HARMONIC_STEPS = new Set([12, 19, 24, 28, 7]);
const SUBHARMONIC_STEPS = new Set([12, 19, 24, 28, 31, 7]);

export class OnsetDetector {
  constructor({ minRms = 0.012, attackRatio = 1.3, stableFrames = 2, minClarity = 0.75, silenceRms = 0.007, refractoryMs = 90, mergeMs = 150, strikeTtlMs = 600, minGapMs = 90, maxDetune = 0.3, noisy = false } = {}) {
    Object.assign(this, { minRms, attackRatio, stableFrames, minClarity, silenceRms, refractoryMs, mergeMs, strikeTtlMs, minGapMs, maxDetune });
    this.noisy = noisy;
    this.reset();
  }

  reset() {
    this.history = []; // {t, rms}
    this.lastEmitted = null;
    this.lastEmitTime = -Infinity;
    this.lastAttackTime = -Infinity;
    this.candidate = null;
    this.candidateCount = 0;
    this.silentFrames = 0;
    this.attackT = null;
    // Une « frappe » (coup de marteau) ne valide qu'UNE note par hauteur : strikeStart = son instant,
    // strikeEmitted = hauteurs déjà émises pour cette frappe.
    this.strikeStart = -Infinity;
    this.strikeEmitted = new Set();
    this.ringing = null;
    this.hasTransients = false;
    // accord général du piano (en demi-tons, appris sur les notes tenues bien nettes) : un piano entier peut être
    // 30 cents trop bas, ce n'est pas une raison pour refuser ses notes
    this.tune = 0;
    this.rawMidi = null;
    this.rawCount = 0;
  }

  /** Mode bruité : une confirmation de plus et une clarté plus exigeante. */
  set noisy(v) {
    this._noisy = !!v;
  }
  get noisy() {
    return this._noisy;
  }

  /** Compatibilité : une frappe attend-elle encore sa note ? */
  get attackPending() {
    return this.strikeEmitted.size === 0 && this.strikeStart > -Infinity;
  }

  _strike(tStrike, merge = this.mergeMs) {
    if (tStrike - this.strikeStart <= merge) return false; // même frappe (la montée du volume dure plusieurs trames)
    this.strikeStart = tStrike;
    this.strikeEmitted.clear();
    this.attackT = tStrike;
    // hauteur qui sonnait déjà juste avant la frappe : il faudra plus de preuves pour la re-valider
    this.ringing = this.candidateCount >= 2 ? this.candidate : null;
    // la hauteur doit être confirmée sur du son postérieur à la frappe
    this.candidate = null;
    this.candidateCount = 0;
    return true;
  }

  /**
   * @param {{t:number, rms:number, midi:number|null, clarity?:number, minRms?:number, minClarity?:number, attackT?:number,
   *          transient?:boolean, transientT?:number}} frame
   *   t en ms ; minRms/minClarity : seuils propres au registre (profil « Mon piano ») ;
   *   attackT : instant précis du pic dans la trame (sinon t) ;
   *   transient : une frappe a été détectée dans cette trame par TransientDetector (transientT = son instant).
   *   Dès qu'une trame fournit `transient` (true ou false), seules les frappes comptent comme attaques ;
   *   sinon (repli sans AudioWorklet) on utilise la montée du volume.
   * @returns {{attack:boolean, onset:number|null, onsetT:number|null}} onsetT = instant de la frappe correspondante
   */
  push(frame) {
    const { t, rms, midi } = frame;
    const clarity = frame.clarity ?? 1;
    const minRmsNote = frame.minRms ?? this.minRms;
    const minClarity = (frame.minClarity ?? this.minClarity) + (this._noisy ? 0.05 : 0);
    const stableFrames = this.stableFrames + (this._noisy ? 1 : 0);
    if (frame.transient !== undefined) this.hasTransients = true;

    // Creux d'énergie récent (fenêtre ~200 ms)
    this.history.push({ t, rms });
    while (this.history.length && t - this.history[0].t > 200) this.history.shift();
    let trough = Infinity;
    for (const h of this.history) if (h.rms < trough) trough = h.rms;

    let attack = false;
    if (this.hasTransients) {
      if (frame.transient && rms > this.silenceRms * 0.5) attack = this._strike(frame.transientT ?? frame.attackT ?? t, 50); // le détecteur de frappes a déjà sa période réfractaire
    } else if (rms > this.minRms && rms > trough * this.attackRatio + 0.004 && t - this.lastAttackTime > this.refractoryMs) {
      this.lastAttackTime = t;
      attack = this._strike(frame.attackT ?? t);
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
      return { attack, onset: null, onsetT: null };
    }
    this.silentFrames = 0;

    if (midi == null || clarity < minClarity || rms < minRmsNote) {
      this.candidate = null;
      this.candidateCount = 0;
      this.rawCount = 0;
      return { attack, onset: null, onsetT: null };
    }

    // Hauteur « posée » ? Quand deux notes se chevauchent (l'ancienne résonne encore), la hauteur mesurée glisse
    // entre les deux pendant ~100 ms : on attend qu'elle tombe juste (à ±30 cents de l'accord du piano).
    if (frame.midiFloat != null) {
      const dev = frame.midiFloat - midi; // -0.5..0.5
      if (midi === this.rawMidi) this.rawCount++;
      else {
        this.rawMidi = midi;
        this.rawCount = 1;
      }
      // apprentissage de l'accord général sur les notes tenues et nettes
      if (this.rawCount >= 5 && clarity >= 0.97) this.tune += (dev - this.tune) * 0.08;
      if (Math.abs(dev - this.tune) > this.maxDetune) {
        this.candidate = null;
        this.candidateCount = 0;
        return { attack, onset: null, onsetT: null };
      }
    }

    if (midi === this.candidate) this.candidateCount++;
    else {
      this.candidate = midi;
      this.candidateCount = 1;
    }

    let onset = null, onsetT = null;
    const strikeAge = t - this.strikeStart;
    const strikeFresh = strikeAge >= 0 && strikeAge < this.strikeTtlMs && this.strikeEmitted.size === 0;
    const isNewPitch = midi !== this.lastEmitted;
    // Après une frappe, la fenêtre d'analyse contient encore l'ancienne note : pour re-valider une hauteur qui
    // sonnait DÉJÀ (note répétée… ou simple reste de la note précédente), on demande deux trames de plus.
    const wasSounding = !isNewPitch || midi === this.ringing;
    let needed = stableFrames + (wasSounding ? 2 : 0);
    // Note « fantôme » : un sous-harmonique commun à la note qui résonne et à la nouvelle (Do4 + Sol4 → « Do3 »).
    // Si la hauteur est un parent grave de la note qui sonnait, on attend nettement plus longtemps : le fantôme
    // disparaît dès que l'ancienne note s'éteint, une vraie note grave reste.
    const before = this.ringing ?? this.lastEmitted;
    if (before != null && SUBHARMONIC_STEPS.has(before - midi)) needed = stableFrames + 5;
    let ok = false;
    if (strikeFresh) {
      // une frappe = une note (les accords sont vérifiés à part, dans le spectre, par l'entraîneur)
      ok = true;
    } else if (isNewPitch && !this.strikeEmitted.has(midi)) {
      // hauteur nouvelle sans frappe détectée (note très douce) : acceptée plus lentement, jamais pour un simple
      // saut d'octave ou de quinte de la note qui résonne (erreur de détection classique)
      // Avec le détecteur de frappes, on reste strict : une note = une frappe (sinon les mélanges de notes qui
      // résonnent ensemble produisent de fausses hauteurs).
      const related = this.lastEmitted != null && HARMONIC_STEPS.has(Math.abs(midi - this.lastEmitted));
      ok = !this.hasTransients && !related;
    }
    if (ok && this.candidateCount >= needed && t - this.lastEmitTime > (wasSounding ? this.minGapMs : 40)) {
      onset = midi;
      onsetT = strikeFresh ? this.strikeStart : t;
      this.lastEmitted = midi;
      this.lastEmitTime = t;
      if (strikeAge >= 0 && strikeAge < this.strikeTtlMs) this.strikeEmitted.add(midi);
    }
    return { attack, onset, onsetT };
  }
}

/**
 * Le micro confond parfois une note avec un « parent harmonique » quand plusieurs sons se mélangent :
 * l'octave ou la douzième au-dessus (harmonique pris pour la note), ou un sous-harmonique commun en dessous
 * (Sol2 entendu « Do1 » pendant que Do2 résonne). Si la note détectée est un tel parent d'une note attendue,
 * on renvoie la note attendue à vérifier (dans le spectre) ; sinon la note détectée telle quelle.
 * @param {number} detected note MIDI détectée
 * @param {number[]} expected notes attendues à cet instant
 * @returns {{midi:number, confusable:boolean}}
 */
export function resolveMicNote(detected, expected = []) {
  if (expected.includes(detected)) return { midi: detected, confusable: false };
  // sous-harmoniques : la note attendue est l'harmonique 2, 3, 4, 5 ou 6 de la note détectée
  const below = expected.find((e) => [12, 19, 24, 28, 31].includes(e - detected));
  if (below != null) return { midi: below, confusable: true };
  // harmoniques : la note détectée est l'harmonique 2, 3 ou 4 d'une note attendue
  const above = expected.find((e) => [12, 19, 24].includes(detected - e));
  if (above != null) return { midi: above, confusable: true };
  return { midi: detected, confusable: false };
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

// ---------- horloges ----------
/**
 * Temps AudioContext → performance.now() (ms) de l'instant où l'échantillon `when` sort du haut-parleur.
 * @param {number} when temps audio (s)
 * @param {{contextTime?:number, performanceTime?:number}|null} ts AudioContext.getOutputTimestamp()
 * @param {{currentTime:number, now:number, outputLatency?:number}} fb repli si ts est indisponible
 */
export function audioToPerf(when, ts, { currentTime, now, outputLatency = 0 }) {
  if (ts && ts.performanceTime > 0 && Number.isFinite(ts.contextTime)) return ts.performanceTime + (when - ts.contextTime) * 1000;
  return now + (when - currentTime + outputLatency) * 1000;
}

/**
 * Instant estimé (performance.now(), ms) où un échantillon du micro a été CAPTÉ.
 * audioTime = temps audio de l'échantillon dans le graphe ; il est rendu ≈ (outputLatency + baseLatency) avant d'être
 * entendu, et il a été capté ≈ inputLatency plus tôt. Jamais dans le futur.
 */
export function micCaptureTime(audioTime, ts, { currentTime, now, outputLatency = 0, baseLatency = 0, inputLatency = 0 }) {
  let t;
  if (ts && ts.performanceTime > 0 && Number.isFinite(ts.contextTime)) t = ts.performanceTime + (audioTime - ts.contextTime - outputLatency - baseLatency) * 1000;
  else t = now - (currentTime - audioTime) * 1000;
  t -= inputLatency * 1000;
  return Math.min(t, now);
}

// ---------- calibration ----------
export function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Latence d'une source à partir de frappes « sur le temps ».
 * Chaque frappe est associée au clic le plus proche (± window ms) ; résultat = médiane des écarts (ms, positif = en retard).
 * @returns {{latency:number|null, n:number, spread:number|null, offsets:number[]}}
 */
export function latencyFromTaps(clickTimes, tapTimes, { window = 250, minTaps = 6 } = {}) {
  const offsets = [];
  const used = new Set();
  for (const tap of tapTimes) {
    let best = -1, bd = Infinity;
    clickTimes.forEach((c, i) => {
      const d = Math.abs(tap - c);
      if (d < bd && !used.has(i)) { bd = d; best = i; }
    });
    if (best >= 0 && bd <= window) {
      used.add(best);
      offsets.push(tap - clickTimes[best]);
    }
  }
  if (offsets.length < minTaps) return { latency: null, n: offsets.length, spread: null, offsets };
  const med = median(offsets);
  const spread = median(offsets.map((o) => Math.abs(o - med)));
  return { latency: Math.round(med), n: offsets.length, spread: Math.round(spread), offsets };
}

// ---------- profil « Mon piano » ----------
export const MIC_BANDS = [
  { id: 'low', label: 'graves', lo: 0, hi: 47 },
  { id: 'mid', label: 'médiums', lo: 48, hi: 71 },
  { id: 'high', label: 'aigus', lo: 72, hi: 127 },
];
export const bandOf = (midi) => (midi < 48 ? 'low' : midi < 72 ? 'mid' : 'high');

function percentile(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))];
}

/**
 * Construit le profil micro à partir des mesures.
 * @param {number[]} noiseRms niveaux pendant le silence
 * @param {{low?:{rms:number[],clarity:number[]}, mid?:…, high?:…}} bands trames mesurées pendant les notes de chaque registre
 */
export function buildMicProfile(noiseRms, bands = {}) {
  const noise = percentile(noiseRms, 0.9) ?? 0.003;
  const profile = { noise: +noise.toFixed(5), silenceRms: +Math.max(0.002, noise * 1.6).toFixed(5), bands: {}, createdAt: Date.now() };
  for (const { id } of MIC_BANDS) {
    const b = bands[id];
    if (!b || !b.rms?.length) continue;
    const peak = percentile(b.rms, 0.95);
    const minRms = Math.min(0.08, Math.max(0.002, noise * 3, peak * 0.08));
    const clar = percentile(b.clarity || [], 0.25) ?? 0.8;
    profile.bands[id] = { minRms: +minRms.toFixed(5), minClarity: +Math.min(0.9, Math.max(0.55, clar - 0.05)).toFixed(3), peak: +peak.toFixed(4) };
  }
  return profile;
}

/** Seuils à appliquer pour une note (profil + repli). */
export function profileThresholds(profile, midi, fallback = { minRms: 0.012, minClarity: 0.75 }) {
  const b = profile?.bands?.[bandOf(midi)];
  if (b) return { minRms: b.minRms, minClarity: b.minClarity };
  const all = Object.values(profile?.bands || {});
  if (all.length) return { minRms: Math.min(...all.map((x) => x.minRms)), minClarity: fallback.minClarity };
  return fallback;
}
