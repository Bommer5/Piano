// Séance du jour (logique pure) : échauffement, révision ciblée, parcours en cours, leçon suivante.

/** Mesures les plus ratées d'un morceau sur ses dernières sessions. */
export function weakMeasures(entry, { sessions = 8, count = 3 } = {}) {
  const agg = {};
  for (const x of (entry?.history || []).slice(-sessions)) {
    for (const [m, n] of Object.entries(x.errorsByMeasure || {})) agg[m] = (agg[m] || 0) + n;
    if (!x.errorsByMeasure) for (const w of x.worstMeasures || []) agg[w.measure] = (agg[w.measure] || 0) + (w.errors || 1);
  }
  return Object.entries(agg).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, count).map(([m, errors]) => ({ measure: Number(m), errors }));
}

/** Notes les plus ratées (midi → erreurs) sur les dernières sessions. */
export function weakNotes(entry, { sessions = 8, count = 5 } = {}) {
  const agg = {};
  for (const x of (entry?.history || []).slice(-sessions)) for (const [m, n] of Object.entries(x.errorsByNote || {})) agg[m] = (agg[m] || 0) + n;
  return Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, count).map(([m, errors]) => ({ midi: Number(m), errors }));
}

/** Morceau à réviser : le moins récemment joué parmi ceux à 1 ou 2 étoiles. */
export function pickReviewSong(progress = {}, exclude = []) {
  const c = Object.entries(progress)
    .filter(([id, p]) => p && p.stars >= 1 && p.stars <= 2 && !exclude.includes(id) && !id.startsWith('ex-') && id !== 'exercice')
    .sort((a, b) => (a[1].last || 0) - (b[1].last || 0));
  return c.length ? c[0][0] : null;
}

/** Morceau dont le parcours a été travaillé le plus récemment (clés `parcours:<id>:<étape>`). */
export function currentParcoursSong(lessonsDone = {}) {
  let best = null, at = -1;
  for (const [k, t] of Object.entries(lessonsDone)) {
    if (!k.startsWith('parcours:')) continue;
    const id = k.slice(9, k.lastIndexOf(':'));
    if (id && t > at) {
      at = t;
      best = id;
    }
  }
  return best;
}

/** Plage de mesures à réviser à partir des mesures faibles (contiguë, max 4 mesures). */
export function reviewRange(weak, measureCount = Infinity) {
  if (!weak.length) return null;
  const m = weak[0].measure;
  const near = weak.map((w) => w.measure).filter((x) => Math.abs(x - m) <= 2);
  let from = Math.max(1, Math.min(...near)), to = Math.min(measureCount, Math.max(...near));
  if (to - from > 3) to = from + 3;
  return { from, to };
}

/**
 * Construit la séance du jour.
 * @param {object} o
 * @param {object} o.progress progrès par morceau
 * @param {object} o.lessonsDone leçons faites
 * @param {Array<{id:string,title:string}>} o.lessons leçons dans l'ordre des cours
 * @param {{songId:string, title:string, steps:Array<{id:string,title:string,mode?:string,hands?:string,tempoPct?:number,from?:number,to?:number}>}|null} o.parcours parcours en cours
 * @param {(id:string)=>({title:string, measureCount?:number}|null)} o.songInfo
 * @param {boolean} [o.kid] formulation pour enfant
 * @returns {Array<{id:string, kind:string, title:string, desc:string, minutes:number, href:string, data?:object}>}
 */
export function buildDailyPlan({ progress = {}, lessonsDone = {}, lessons = [], parcours = null, songInfo = () => null, kid = false } = {}) {
  const steps = [];
  steps.push({
    id: 'warmup', kind: 'warmup', minutes: 2, href: '#/seance?step=warmup',
    title: kid ? 'Échauffe tes doigts 🖐️' : 'Échauffement : 5 doigts en Do',
    desc: 'Do-Ré-Mi-Fa-Sol puis retour, main droite puis main gauche, lentement et régulièrement.',
  });
  const reviewId = pickReviewSong(progress, parcours ? [parcours.songId] : []);
  if (reviewId) {
    const info = songInfo(reviewId);
    if (info) {
      const weak = weakMeasures(progress[reviewId]);
      const range = reviewRange(weak, info.measureCount);
      const q = range ? `?from=${range.from}&to=${range.to}&loop=1&tempo=70` : '?tempo=80';
      steps.push({
        id: 'review:' + reviewId, kind: 'review', minutes: 4, href: `#/jouer/${encodeURIComponent(reviewId)}${q}`,
        title: `Révision : « ${info.title} »`,
        desc: range ? `Cible tes mesures difficiles (${range.from === range.to ? 'mesure ' + range.from : `mesures ${range.from}–${range.to}`}) en boucle, au tempo réduit.` : 'Rejoue-le à tempo réduit pour gagner une étoile de plus.',
        data: { songId: reviewId, range },
      });
    }
  }
  if (parcours?.steps?.length) {
    const i = parcours.steps.findIndex((st) => !lessonsDone[`parcours:${parcours.songId}:${st.id}`]);
    if (i >= 0) {
      const st = parcours.steps[i];
      steps.push({
        id: `parcours:${parcours.songId}:${st.id}`, kind: 'parcours', minutes: 4, href: `#/parcours/${encodeURIComponent(parcours.songId)}?step=${i}`,
        title: `Parcours « ${parcours.title} » — étape ${i + 1}/${parcours.steps.length}`, desc: st.title, data: { songId: parcours.songId, index: i },
      });
    }
  }
  const next = lessons.find((l) => !lessonsDone[l.id]);
  if (next) {
    steps.push({ id: 'lesson:' + next.id, kind: 'lesson', minutes: next.duration || 5, href: `#/lecon/${encodeURIComponent(next.id)}`, title: `Leçon : ${next.title}`, desc: kid ? 'Une nouvelle leçon pour apprendre quelque chose de nouveau !' : 'La prochaine leçon de ton cours.', data: { lessonId: next.id } });
  }
  return steps;
}

/** Avancement de la séance. */
export function planProgress(steps, done = []) {
  const set = new Set(done);
  const n = steps.filter((s) => set.has(s.id)).length;
  return { done: n, total: steps.length, complete: steps.length > 0 && n === steps.length, next: steps.findIndex((s) => !set.has(s.id)) };
}

/** Minutes restantes pour atteindre l'objectif quotidien. */
export function minutesLeft(todaySec, goalMin) {
  return Math.max(0, Math.ceil(goalMin - (todaySec || 0) / 60));
}
