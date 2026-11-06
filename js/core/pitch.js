// Détection de hauteur monophonique (algorithme YIN) + utilitaires de signal.
// Module pur : fonctionne dans le navigateur et dans Node (tests).

export function rms(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

/**
 * Détecte la fréquence fondamentale d'un signal.
 * @param {Float32Array} buf échantillons
 * @param {number} sampleRate
 * @param {{threshold?:number, minFreq?:number, maxFreq?:number, minRms?:number}} opts
 * @returns {{freq:number, clarity:number, rms:number} | null}
 */
export function detectPitch(buf, sampleRate, opts = {}) {
  const { threshold = 0.15, minFreq = 27.5, maxFreq = 4200, minRms = 0.01 } = opts;
  const level = rms(buf);
  if (level < minRms) return null;

  const n = buf.length;
  const maxTau = Math.min(Math.floor(sampleRate / minFreq), Math.floor(n / 2));
  const minTau = Math.max(2, Math.floor(sampleRate / maxFreq));
  const W = n - maxTau;
  if (W < 64 || maxTau <= minTau) return null;

  // Fonction de différence d(tau)
  const d = new Float32Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0;
    for (let j = 0; j < W; j++) {
      const diff = buf[j] - buf[j + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }
  // Différence moyenne normalisée cumulée
  const cmnd = new Float32Array(maxTau + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    running += d[tau];
    cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }

  let tauEst = -1;
  for (let tau = minTau; tau <= maxTau; tau++) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 <= maxTau && cmnd[tau + 1] < cmnd[tau]) tau++;
      tauEst = tau;
      break;
    }
  }
  if (tauEst === -1) {
    // Pas de minimum sous le seuil : on prend le minimum global s'il reste raisonnable.
    let best = minTau;
    for (let tau = minTau; tau <= maxTau; tau++) if (cmnd[tau] < cmnd[best]) best = tau;
    if (cmnd[best] > 0.35) return null;
    tauEst = best;
  }

  // Interpolation parabolique pour la précision sub-échantillon
  let betterTau = tauEst;
  if (tauEst > 1 && tauEst < maxTau) {
    const s0 = cmnd[tauEst - 1], s1 = cmnd[tauEst], s2 = cmnd[tauEst + 1];
    const denom = 2 * (2 * s1 - s2 - s0);
    if (denom !== 0) betterTau = tauEst + (s2 - s0) / denom;
  }
  const freq = sampleRate / betterTau;
  if (freq < minFreq * 0.97 || freq > maxFreq * 1.03) return null;
  return { freq, clarity: Math.max(0, Math.min(1, 1 - cmnd[tauEst])), rms: level };
}

/** Génère une onde (utile pour les tests et la démo). */
export function synthTone(freqs, sampleRate, length, { harmonics = 4, amp = 0.3 } = {}) {
  const buf = new Float32Array(length);
  const list = Array.isArray(freqs) ? freqs : [freqs];
  for (const f of list) {
    for (let h = 1; h <= harmonics; h++) {
      const a = amp / h / list.length;
      const w = (2 * Math.PI * f * h) / sampleRate;
      for (let i = 0; i < length; i++) buf[i] += a * Math.sin(w * i);
    }
  }
  return buf;
}
