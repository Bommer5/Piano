// Glossaire musical (français). `keys` : notes à montrer sur un petit schéma de clavier
// (nombres MIDI, Do4 = 60, ou objets {midi, finger, hand}).

export const GLOSSARY_CATEGORIES = [
  ['bases', 'Les bases'],
  ['rythme', 'Rythme'],
  ['lecture', 'Lecture de partition'],
  ['harmonie', 'Gammes & accords'],
  ['jeu', 'Technique & expression'],
];

export const GLOSSARY = [
  // --- bases
  { id: 'octave', cat: 'bases', term: 'Octave', def: 'Distance entre une note et la note de même nom la plus proche (12 touches plus loin). Do4 et Do5 sont à une octave d’écart : ils sonnent « pareil », mais l’un est plus aigu.', keys: [60, 72] },
  { id: 'do-central', cat: 'bases', term: 'Do central', def: 'Le Do situé au milieu du clavier (Do4, ou C4 en anglais). C’est le repère pour placer les mains : il est juste à gauche du groupe de 2 touches noires au centre.', keys: [{ midi: 60, finger: 1 }] },
  { id: 'touches-noires', cat: 'bases', term: 'Touches noires', def: 'Les touches noires sont groupées par 2 et par 3. Le Do est toujours juste à gauche d’un groupe de 2 touches noires ; le Fa juste à gauche d’un groupe de 3.', keys: [61, 63, 66, 68, 70] },
  { id: 'diese', cat: 'bases', term: 'Dièse (♯)', def: 'Altération qui monte une note d’un demi-ton : on joue la touche juste à droite (souvent une touche noire). Do♯ est la noire juste à droite de Do.', keys: [60, 61] },
  { id: 'bemol', cat: 'bases', term: 'Bémol (♭)', def: 'Altération qui baisse une note d’un demi-ton : on joue la touche juste à gauche. Si♭ est la noire juste à gauche de Si.', keys: [70, 71] },
  { id: 'becarre', cat: 'bases', term: 'Bécarre (♮)', def: 'Annule un dièse ou un bémol : on revient à la note « naturelle » (souvent une touche blanche).' },
  { id: 'demi-ton', cat: 'bases', term: 'Demi-ton / ton', def: 'Le demi-ton est la plus petite distance entre deux touches voisines (blanche ou noire). Un ton = 2 demi-tons.', keys: [60, 61, 62] },
  { id: 'intervalle', cat: 'bases', term: 'Intervalle', def: 'Distance entre deux notes : seconde, tierce, quarte, quinte, sixte, septième, octave. Do–Mi est une tierce, Do–Sol une quinte.', keys: [60, 64, 67] },
  { id: 'transposer', cat: 'bases', term: 'Transposer', def: 'Jouer un morceau plus haut ou plus bas en décalant toutes les notes du même nombre de demi-tons. La mélodie reste la même, seule la hauteur change.' },
  { id: 'doigte', cat: 'jeu', term: 'Doigté', def: 'Numéro du doigt à utiliser pour chaque note : 1 = pouce, 2 = index, 3 = majeur, 4 = annulaire, 5 = auriculaire (pour les deux mains). Un bon doigté évite de se retrouver « coincé ».', keys: [{ midi: 60, finger: 1 }, { midi: 62, finger: 2 }, { midi: 64, finger: 3 }, { midi: 65, finger: 4 }, { midi: 67, finger: 5 }] },
  { id: 'position', cat: 'jeu', term: 'Position de main', def: 'Placement des 5 doigts sur 5 touches voisines. En position de Do, le pouce droit est sur Do et le 5e doigt sur Sol.', keys: [{ midi: 60, finger: 1 }, { midi: 62, finger: 2 }, { midi: 64, finger: 3 }, { midi: 65, finger: 4 }, { midi: 67, finger: 5 }] },
  { id: 'passage-pouce', cat: 'jeu', term: 'Passage du pouce', def: 'Technique pour jouer plus de 5 notes à la suite : le pouce passe sous la main (ex. dans la gamme de Do, le pouce joue Fa après le 3e doigt sur Mi).', keys: [{ midi: 64, finger: 3 }, { midi: 65, finger: 1 }] },
  // --- rythme
  { id: 'mesure', cat: 'rythme', term: 'Mesure', def: 'Petite case de la partition délimitée par deux barres verticales. Chaque mesure contient le même nombre de temps (par exemple 4 temps en 4/4).' },
  { id: 'temps', cat: 'rythme', term: 'Temps', def: 'La pulsation régulière de la musique, celle sur laquelle on tape du pied. En 4/4, on compte « 1, 2, 3, 4 » dans chaque mesure.' },
  { id: 'chiffrage', cat: 'rythme', term: 'Chiffrage (4/4, 3/4…)', def: 'Les deux chiffres au début de la portée. Celui du haut indique le nombre de temps par mesure, celui du bas l’unité (4 = la noire). 3/4 = 3 noires par mesure, comme une valse.' },
  { id: 'tempo', cat: 'rythme', term: 'Tempo', def: 'La vitesse du morceau. Dans l’app, tu peux le réduire (60 %, 80 %…) pour apprendre, puis remonter jusqu’à 100 %.' },
  { id: 'bpm', cat: 'rythme', term: 'BPM', def: 'Battements par minute : mesure du tempo. 60 BPM = un temps par seconde ; 120 BPM = deux temps par seconde.' },
  { id: 'metronome', cat: 'rythme', term: 'Métronome', def: 'Appareil (ou clic dans l’app) qui marque les temps régulièrement pour t’aider à garder le tempo.' },
  { id: 'ronde', cat: 'rythme', term: 'Ronde', def: 'Note blanche sans hampe qui dure 4 temps (une mesure entière en 4/4).' },
  { id: 'blanche', cat: 'rythme', term: 'Blanche', def: 'Note creuse avec une hampe : elle dure 2 temps.' },
  { id: 'noire', cat: 'rythme', term: 'Noire', def: 'Note pleine avec une hampe : elle dure 1 temps. C’est l’unité de base en 4/4.' },
  { id: 'croche', cat: 'rythme', term: 'Croche', def: 'Note pleine avec un crochet (ou reliée par une barre) : elle dure un demi-temps. Deux croches = une noire. La double croche dure un quart de temps.' },
  { id: 'pointee', cat: 'rythme', term: 'Note pointée', def: 'Le point à droite d’une note allonge sa durée de moitié : une blanche pointée dure 3 temps, une noire pointée 1 temps et demi.' },
  { id: 'silence', cat: 'rythme', term: 'Silence (soupir, pause…)', def: 'Moment où l’on ne joue pas, avec une durée précise : la pause (4 temps), la demi-pause (2), le soupir (1), le demi-soupir (½).' },
  { id: 'liaison', cat: 'rythme', term: 'Liaison de durée', def: 'Arc qui relie deux notes de même hauteur : on joue la première et on la tient pendant la durée des deux, sans rejouer la seconde.' },
  { id: 'levee', cat: 'rythme', term: 'Levée (anacrouse)', def: 'Note(s) avant la première mesure complète, qui « lancent » la mélodie. Exemple : le début de « Joyeux anniversaire ».' },
  { id: 'triolet', cat: 'rythme', term: 'Triolet', def: 'Trois notes jouées dans le temps de deux, marquées d’un petit « 3 ».' },
  // --- lecture
  { id: 'portee', cat: 'lecture', term: 'Portée', def: 'Les 5 lignes horizontales sur lesquelles on écrit les notes. Plus la note est haute sur la portée, plus elle est aiguë.' },
  { id: 'cle-sol', cat: 'lecture', term: 'Clé de sol', def: 'Symbole 𝄞 au début de la portée du haut : la note sur la 2e ligne (en partant du bas) est un Sol (Sol4). Elle sert surtout pour la main droite.', keys: [67] },
  { id: 'cle-fa', cat: 'lecture', term: 'Clé de fa', def: 'Symbole 𝄢 au début de la portée du bas : la note sur la 4e ligne est un Fa (Fa3). Elle sert surtout pour la main gauche.', keys: [{ midi: 53, hand: 'L' }] },
  { id: 'lignes-sup', cat: 'lecture', term: 'Lignes supplémentaires', def: 'Petits traits ajoutés au-dessus ou au-dessous de la portée pour écrire les notes trop hautes ou trop basses. Le Do central s’écrit sur une ligne supplémentaire.' },
  { id: 'armure', cat: 'lecture', term: 'Armure', def: 'Les dièses ou bémols écrits juste après la clé : ils s’appliquent à toutes les notes de ce nom pendant tout le morceau.' },
  { id: 'tonalite', cat: 'harmonie', term: 'Tonalité', def: 'La « maison » du morceau : la gamme sur laquelle il est construit (Do majeur, La mineur…). On la devine grâce à l’armure et à la dernière note.' },
  { id: 'reprise', cat: 'lecture', term: 'Barre de reprise', def: 'Double barre avec deux points : on recommence le passage depuis la barre de reprise précédente (ou depuis le début).' },
  // --- harmonie
  { id: 'gamme', cat: 'harmonie', term: 'Gamme', def: 'Suite de notes qui montent (ou descendent) dans un ordre précis. La gamme de Do majeur : Do Ré Mi Fa Sol La Si Do, uniquement des touches blanches.', keys: [60, 62, 64, 65, 67, 69, 71, 72] },
  { id: 'majeur-mineur', cat: 'harmonie', term: 'Majeur / mineur', def: 'Deux « couleurs » de gammes et d’accords : le majeur sonne souvent joyeux, le mineur plus triste ou mystérieux. Do majeur : Do-Mi-Sol ; Do mineur : Do-Mi♭-Sol.', keys: [60, 63, 64, 67] },
  { id: 'accord', cat: 'harmonie', term: 'Accord', def: 'Plusieurs notes jouées en même temps. L’accord de base (triade) empile une note sur deux : Do-Mi-Sol pour Do majeur.', keys: [{ midi: 60, finger: 1 }, { midi: 64, finger: 3 }, { midi: 67, finger: 5 }] },
  { id: 'renversement', cat: 'harmonie', term: 'Renversement', def: 'Même accord, mais avec une autre note en bas. Do-Mi-Sol devient Mi-Sol-Do (1er renversement) puis Sol-Do-Mi (2e renversement). Pratique pour éviter de grands sauts.', keys: [64, 67, 72] },
  { id: 'arpege', cat: 'harmonie', term: 'Arpège', def: 'Les notes d’un accord jouées l’une après l’autre au lieu d’ensemble.', keys: [48, 52, 55, 60] },
  { id: 'chiffrage-accords', cat: 'harmonie', term: 'Grille d’accords (C, Am, G7…)', def: 'Noms d’accords en notation anglaise écrits au-dessus de la mélodie : C = Do majeur, Am = La mineur, G7 = Sol septième.' },
  // --- jeu
  { id: 'legato', cat: 'jeu', term: 'Legato', def: 'Jouer « lié » : on enchaîne les notes sans silence entre elles, comme si on chantait. Souvent indiqué par une liaison (arc) au-dessus des notes.' },
  { id: 'staccato', cat: 'jeu', term: 'Staccato', def: 'Jouer « détaché » : la note est courte et piquée. Indiqué par un point au-dessus ou au-dessous de la note.' },
  { id: 'nuances', cat: 'jeu', term: 'Nuances', def: 'Indications de volume : pp (très doux), p (piano, doux), mf (moyennement fort), f (forte, fort), ff (très fort). Le crescendo (<) augmente le volume, le decrescendo (>) le diminue.' },
  { id: 'pedale', cat: 'jeu', term: 'Pédale (forte)', def: 'La pédale de droite fait résonner les notes même après avoir levé les doigts. On l’indique par « Ped. » puis une étoile ou un trait pour la relâcher.' },
  { id: 'accent', cat: 'jeu', term: 'Accent', def: 'Signe « > » sur une note : on la joue un peu plus fort que les autres.' },
  { id: 'main-droite-gauche', cat: 'jeu', term: 'MD / MG', def: 'Main droite / main gauche. Dans l’app, la main droite est en bleu et la main gauche en orange.' },
];

export function getTerm(id) {
  return GLOSSARY.find((t) => t.id === id) || null;
}

/** Recherche (insensible aux accents et à la casse) dans les termes et définitions. */
export function searchGlossary(q) {
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const n = norm(q).trim();
  if (!n) return GLOSSARY;
  const inTerm = GLOSSARY.filter((t) => norm(t.term).includes(n));
  const inDef = GLOSSARY.filter((t) => !inTerm.includes(t) && norm(t.def).includes(n));
  return [...inTerm, ...inDef];
}
