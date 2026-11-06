// Génère automatiquement un cours progressif pour n'importe quel morceau (bibliothèque ou importé) :
// découpage en phrases, mains séparées puis ensemble, tempo progressif.
import { phrases } from './song.js';
import { midiToName, FINGER_NAMES } from './notes.js';

/**
 * @returns {Array<{id:string, title:string, desc:string, hands:'R'|'L'|'both', from:number, to:number, tempoPct:number, mode:'wait'|'tempo'|'listen', notes?:Array}>}
 */
export function generateSongCourse(song, { measuresPerPhrase } = {}) {
  const mpp = measuresPerPhrase || (song.measureCount <= 8 ? 2 : 4);
  const ph = phrases(song, mpp);
  const steps = [];
  const both = song.hands.R && song.hands.L;
  steps.push({
    id: 'listen', title: 'Écoute le morceau', mode: 'listen', hands: 'both', from: 0, to: song.totalBeats, tempoPct: 100,
    desc: "Écoute d'abord le morceau en entier en suivant les touches qui s'allument. Repère le rythme et les passages qui reviennent.",
  });
  ph.forEach((p, i) => {
    const label = `Phrase ${i + 1} (mesures ${p.firstMeasure}–${p.lastMeasure})`;
    for (const hand of ['R', 'L']) {
      if (!song.hands[hand]) continue;
      const handNotes = p.notes.filter((n) => n.hand === hand);
      if (!handNotes.length) continue;
      steps.push({
        id: `p${i}-${hand}`, title: `${label} – ${hand === 'R' ? 'main droite' : 'main gauche'}`, mode: 'wait', hands: hand,
        from: p.from, to: p.to, tempoPct: 60, notes: handNotes,
        desc: describePosition(handNotes, hand) + ' Joue lentement : la partition attend chaque bonne note.',
      });
    }
    if (both) {
      steps.push({
        id: `p${i}-both`, title: `${label} – mains ensemble`, mode: 'wait', hands: 'both', from: p.from, to: p.to, tempoPct: 60,
        desc: 'Assemble les deux mains. Concentre-toi sur les notes qui tombent en même temps.',
      });
    }
    steps.push({
      id: `p${i}-tempo`, title: `${label} – en rythme`, mode: 'tempo', hands: both ? 'both' : song.hands.R ? 'R' : 'L', from: p.from, to: p.to, tempoPct: 70,
      desc: 'Même passage, mais la partition avance toute seule au tempo : vise 80 % de réussite avant de passer à la suite.',
    });
    if (i > 0 && i % 2 === 1) {
      steps.push({
        id: `link${i}`, title: `Enchaîner les phrases ${i} et ${i + 1}`, mode: 'tempo', hands: both ? 'both' : 'R',
        from: ph[i - 1].from, to: p.to, tempoPct: 75, desc: 'Relie les phrases sans t\'arrêter entre elles.',
      });
    }
  });
  steps.push({ id: 'full-slow', title: 'Morceau complet – tempo lent', mode: 'tempo', hands: both ? 'both' : 'R', from: 0, to: song.totalBeats, tempoPct: 75, desc: 'Tout le morceau à 75 % du tempo.' });
  steps.push({ id: 'full', title: 'Morceau complet – tempo réel', mode: 'tempo', hands: both ? 'both' : 'R', from: 0, to: song.totalBeats, tempoPct: 100, desc: 'Objectif : 3 étoiles au tempo d\'origine !' });
  return steps;
}

/** Décrit la position de main (notes extrêmes, doigts) pour un passage. */
export function describePosition(notes, hand, settings = {}) {
  if (!notes.length) return '';
  const lang = settings.notation || 'fr';
  const sorted = [...notes].sort((a, b) => a.midi - b.midi);
  const lo = sorted[0], hi = sorted[sorted.length - 1];
  const first = [...notes].sort((a, b) => a.start - b.start)[0];
  const name = (m) => midiToName(m, { lang });
  const handName = hand === 'L' ? 'main gauche' : 'main droite';
  let s = `${handName[0].toUpperCase() + handName.slice(1)} : de ${name(lo.midi)} à ${name(hi.midi)}. `;
  s += `Commence sur ${name(first.midi)} avec le doigt ${first.finger || '?'}${first.finger ? ` (${FINGER_NAMES[first.finger]})` : ''}.`;
  const shifts = countShifts(notes);
  if (shifts > 0) s += ` Attention : ${shifts} déplacement${shifts > 1 ? 's' : ''} de main (passage du pouce ou saut).`;
  return s;
}

/** Nombre de changements de position (même doigt sur notes différentes, ou passage du pouce). */
export function countShifts(notes) {
  const seq = [...notes].sort((a, b) => a.start - b.start || a.midi - b.midi);
  let n = 0;
  for (let i = 1; i < seq.length; i++) {
    const a = seq[i - 1], b = seq[i];
    if (!a.finger || !b.finger || a.start === b.start) continue;
    const d = b.midi - a.midi;
    const fd = b.finger - a.finger;
    if (a.midi !== b.midi && (fd === 0 || Math.sign(d) !== Math.sign(fd) * (a.hand === 'L' ? -1 : 1))) n++;
  }
  return n;
}
