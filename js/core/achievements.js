// Badges (logique pure, testable dans Node).
// Chaque badge a un test sur des statistiques calculées à partir des données du profil.

/**
 * @typedef {{sessions:number, songs:number, totalSec:number, maxStars:number, totalStars:number, mastered:number,
 *   leftHand:number, bothHands:number, metronome:number, bestCombo:number, lessons:number, imports:number,
 *   bestStreakDays:number, earnedFreezes:number, goalDays:number}} Stats
 */

export const BADGES = [
  { id: 'first-note', emoji: '🎹', name: 'Première note', desc: 'Tu as terminé ta toute première séance.', hint: 'Joue un morceau ou un exercice jusqu’au bout.', test: (s) => s.sessions >= 1 },
  { id: 'streak-3', emoji: '🔥', name: '3 jours d’affilée', desc: 'Tu as joué 3 jours de suite.', hint: 'Joue au moins un peu 3 jours de suite.', test: (s) => s.bestStreakDays >= 3 },
  { id: 'streak-7', emoji: '📅', name: 'Une semaine complète', desc: '7 jours de piano d’affilée !', hint: 'Joue 7 jours de suite.', test: (s) => s.bestStreakDays >= 7 },
  { id: 'streak-30', emoji: '🏆', name: 'Un mois sans pause', desc: '30 jours d’affilée : quelle régularité !', hint: 'Joue 30 jours de suite (les gels ❄️ t’aident).', test: (s) => s.bestStreakDays >= 30 },
  { id: 'freeze', emoji: '❄️', name: 'Gel de série', desc: 'Tu as gagné un gel qui protège ta série un jour d’absence.', hint: 'Un gel se gagne tous les 7 jours d’affilée.', test: (s) => s.earnedFreezes >= 1 },
  { id: 'goal', emoji: '🎯', name: 'Objectif atteint', desc: 'Tu as atteint ton objectif quotidien.', hint: 'Joue le nombre de minutes de ton objectif du jour.', test: (s) => s.goalDays >= 1 },
  { id: 'three-stars', emoji: '⭐', name: 'Premières 3 étoiles', desc: 'Un morceau joué à 95 % ou plus.', hint: 'Obtiens 3 étoiles sur un morceau.', test: (s) => s.maxStars >= 3 },
  { id: 'stars-15', emoji: '🌟', name: 'Collection d’étoiles', desc: '15 étoiles au total.', hint: 'Cumule 15 étoiles sur tes morceaux.', test: (s) => s.totalStars >= 15 },
  { id: 'left-hand', emoji: '🫲', name: 'Main gauche courageuse', desc: 'Un morceau réussi avec la main gauche seule.', hint: 'Joue un morceau main gauche seule avec au moins 80 %.', test: (s) => s.leftHand >= 1 },
  { id: 'both-hands', emoji: '🙌', name: 'Deux mains ensemble', desc: 'Un morceau réussi aux deux mains.', hint: 'Joue un morceau à 2 mains avec au moins 80 %.', test: (s) => s.bothHands >= 1 },
  { id: 'metronome', emoji: '⏱️', name: 'Métronome maîtrisé', desc: 'Joué en rythme, au tempo d’origine.', hint: 'Mode Tempo à 100 % du tempo avec au moins 90 %.', test: (s) => s.metronome >= 1 },
  { id: 'combo-50', emoji: '⚡', name: 'Série de 50', desc: '50 notes justes d’affilée sans erreur.', hint: 'Enchaîne 50 notes justes sans te tromper.', test: (s) => s.bestCombo >= 50 },
  { id: 'mastered', emoji: '👑', name: 'Morceau maîtrisé', desc: 'Un morceau maîtrisé : Tempo, 100 %, 2 mains, 3 étoiles.', hint: 'Joue un morceau en mode Tempo à 100 %, 2 mains, avec 3 étoiles.', test: (s) => s.mastered >= 1 },
  { id: 'songs-5', emoji: '🎵', name: 'Explorateur', desc: '5 morceaux différents travaillés.', hint: 'Travaille 5 morceaux différents.', test: (s) => s.songs >= 5 },
  { id: 'lessons-5', emoji: '🎓', name: '5 leçons', desc: '5 leçons terminées.', hint: 'Termine 5 leçons dans « Cours ».', test: (s) => s.lessons >= 5 },
  { id: 'first-import', emoji: '📂', name: 'Premier import', desc: 'Tu as importé ta propre partition.', hint: 'Importe une partition (MusicXML, MIDI, ABC…).', test: (s) => s.imports >= 1 },
  { id: 'hour', emoji: '⏳', name: '1 h de piano', desc: 'Une heure de pratique au total.', hint: 'Cumule 1 heure de pratique.', test: (s) => s.totalSec >= 3600 },
  { id: 'ten-hours', emoji: '🕰️', name: '10 h de piano', desc: 'Dix heures de pratique au total !', hint: 'Cumule 10 heures de pratique.', test: (s) => s.totalSec >= 36000 },
];

export const getBadge = (id) => BADGES.find((b) => b.id === id);

/**
 * Statistiques du profil.
 * @param {{progress?:object, days?:object, lessons?:object, library?:Array, goalMin?:number, streak?:{best:number, earnedFreezes:number}}} data
 * @returns {Stats}
 */
export function computeStats({ progress = {}, days = {}, lessons = {}, library = [], goalMin = 15, streak = {} } = {}) {
  const s = { sessions: 0, songs: 0, totalSec: 0, maxStars: 0, totalStars: 0, mastered: 0, leftHand: 0, bothHands: 0, metronome: 0, bestCombo: 0, lessons: 0, imports: 0, bestStreakDays: streak.best || 0, earnedFreezes: streak.earnedFreezes || 0, goalDays: 0 };
  for (const p of Object.values(progress)) {
    if (!p) continue;
    s.songs++;
    s.sessions += p.plays || 0;
    s.maxStars = Math.max(s.maxStars, p.stars || 0);
    s.totalStars += p.stars || 0;
    if (p.mastered) s.mastered++;
    for (const x of p.history || []) {
      const score = x.score || 0;
      if (x.hands === 'L' && score >= 80) s.leftHand++;
      if (x.hands === 'both' && score >= 80) s.bothHands++;
      if (x.mode === 'tempo' && (x.tempoPct ?? 100) >= 100 && score >= 90) s.metronome++;
      s.bestCombo = Math.max(s.bestCombo, x.bestStreak || 0);
    }
  }
  for (const v of Object.values(days)) {
    s.totalSec += v || 0;
    if (v >= goalMin * 60) s.goalDays++;
  }
  s.lessons = Object.keys(lessons).filter((k) => !k.startsWith('parcours:')).length;
  s.imports = Array.isArray(library) ? library.length : 0;
  return s;
}

/** Identifiants des badges nouvellement mérités. */
export function findNewBadges(stats, earned = {}) {
  return BADGES.filter((b) => !earned[b.id] && b.test(stats)).map((b) => b.id);
}
