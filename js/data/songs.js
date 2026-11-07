// Bibliothèque de morceaux.
//
// Uniquement des œuvres du domaine public (compositeurs morts depuis plus de 70 ans, airs
// traditionnels) ou des exercices originaux écrits pour l'application.
//
// Notation compacte (voir js/core/song.js) : « NOTE:DURÉE:DOIGT », accords « C3+E3+G3:2:5+3+1 »,
// silences « r:1 », « | » = barre de mesure (purement visuelle). Durées en temps (noire = 1).
// Chaque mesure est complète : les levées (anacrouses) sont précédées d'un silence.

export const GENRES = [
  {
    id: 'debutant',
    name: 'Premiers pas',
    emoji: '🌱',
    color: '#4caf50',
    description: 'De tout petits morceaux et exercices pour découvrir le clavier, les doigts et les premières notes.',
  },
  {
    id: 'classique',
    name: 'Classique',
    emoji: '🎻',
    color: '#7e57c2',
    description: 'Les grands classiques du répertoire, de Bach à Brahms, en versions accessibles.',
  },
  {
    id: 'comptines',
    name: 'Comptines',
    emoji: '🧸',
    color: '#ff9800',
    description: 'Les airs de l’enfance, parfaits pour jouer et chanter en même temps.',
  },
  {
    id: 'noel',
    name: 'Noël',
    emoji: '🎄',
    color: '#d32f2f',
    description: 'Chants de Noël traditionnels à jouer en famille au coin du sapin.',
  },
  {
    id: 'folk',
    name: 'Folk & traditionnel',
    emoji: '🪕',
    color: '#8d6e63',
    description: 'Mélodies populaires venues des îles Britanniques et d’Amérique, transmises de génération en génération.',
  },
  {
    id: 'gospel',
    name: 'Gospel & spirituals',
    emoji: '🙌',
    color: '#f9a825',
    description: 'Hymnes et spirituals, accords chaleureux, septièmes et cadences « Amen ».',
  },
  {
    id: 'jazz',
    name: 'Jazz & blues',
    emoji: '🎷',
    color: '#1e88e5',
    description: 'Gamme blues, grille de 12 mesures, walking bass et enchaînements II-V-I.',
  },
  {
    id: 'ragtime',
    name: 'Ragtime',
    emoji: '🎩',
    color: '#6d4c41',
    description: 'Syncopes joyeuses et main gauche « stride » à la manière de Scott Joplin.',
  },
  {
    id: 'pop',
    name: 'Pop & accords',
    emoji: '🎤',
    color: '#ec407a',
    description: 'Compositions originales pour apprendre les grilles d’accords et les rythmes d’accompagnement de la pop.',
  },
  {
    id: 'technique',
    name: 'Gammes, arpèges, Hanon',
    emoji: '🏋️',
    color: '#546e7a',
    description: 'La salle de sport du pianiste : gammes, arpèges, chromatisme, renversements et exercices de Hanon.',
  },
];

// ---------------------------------------------------------------------------
// Générateurs pour les exercices techniques (gammes, Hanon)
// ---------------------------------------------------------------------------

const LETTERS = 'CDEFGAB';

/** Suite diatonique de `count` notes à partir de `start` (ex. « G3 »), avec altérations `acc` ({F:'#'}). */
function diatonicRun(start, acc, count) {
  const li = LETTERS.indexOf(start[0]);
  const oct = Number(start.slice(1));
  const out = [];
  for (let i = 0; i < count; i++) {
    const d = li + i;
    const L = LETTERS[d % 7];
    out.push(L + (acc[L] || '') + (oct + Math.floor(d / 7)));
  }
  return out;
}

/** Gamme sur deux octaves, montée puis descente, en croches, mesures de 4/4 ; la dernière note dure une blanche. */
function scaleTrack(start, acc, fingersUp) {
  const up = diatonicRun(start, acc, 15);
  const notes = [...up, ...up.slice(0, -1).reverse()];
  const fingers = [...fingersUp, ...fingersUp.slice(0, -1).reverse()];
  const toks = notes.map((n, i) => `${n}:${i === notes.length - 1 ? 2 : 0.5}:${fingers[i]}`);
  const bars = [];
  for (let i = 0; i < toks.length; i += 8) bars.push(toks.slice(i, i + 8).join(' '));
  return bars.join(' | ');
}

const RH_SCALE = [1, 2, 3, 1, 2, 3, 4, 1, 2, 3, 1, 2, 3, 4, 5];
const LH_SCALE = [5, 4, 3, 2, 1, 3, 2, 1, 4, 3, 2, 1, 3, 2, 1];
const RH_SCALE_F = [1, 2, 3, 4, 1, 2, 3, 1, 2, 3, 4, 1, 2, 3, 4];
// Si♭ majeur : le pouce seulement sur Do et Fa (touches blanches)
const RH_SCALE_BB = [4, 1, 2, 3, 1, 2, 3, 4, 1, 2, 3, 1, 2, 3, 4];
const LH_SCALE_BB = [3, 2, 1, 4, 3, 2, 1, 3, 2, 1, 4, 3, 2, 1, 3];

function dName(d) {
  return LETTERS[d % 7] + Math.floor(d / 7);
}

/** Hanon n°1 en Do sur une octave (2/4, doubles croches). */
function hanonTrack(octShift, fingersUp, fingersDown, lastFinger) {
  const base = 28 + octShift * 7; // C4 = 4*7
  const bars = [];
  const asc = [0, 2, 3, 4, 5, 4, 3, 2];
  for (let s = base; s <= base + 5; s++) {
    bars.push(asc.map((o, i) => `${dName(s + o)}:0.25:${fingersUp[i]}`).join(' '));
  }
  for (let s = base + 11; s >= base + 4; s--) {
    bars.push(asc.map((o, i) => `${dName(s - o)}:0.25:${fingersDown[i]}`).join(' '));
  }
  bars.push(`${dName(base)}:2:${lastFinger}`);
  return bars.join(' | ');
}

// Motifs d'accompagnement réutilisés
const rep = (s, n) => Array(n).fill(s).join(' | ');

// ---------------------------------------------------------------------------
// Morceaux
// ---------------------------------------------------------------------------

export const SONGS = [
  // ===================== PREMIERS PAS =====================
  {
    id: 'cinq-doigts-do',
    title: 'Cinq doigts en Do',
    composer: 'Exercice original',
    genre: 'debutant',
    level: 1,
    tempo: 80,
    timeSig: [4, 4],
    keyFifths: 0,
    description:
      'Votre tout premier morceau : la main droite reste posée sur Do-Ré-Mi-Fa-Sol, un doigt par touche. Ne regardez pas vos mains, laissez chaque doigt « habiter » sa touche.',
    tags: ['position de Do', 'main droite', '5 doigts'],
    tracks: {
      R: 'C4:1:1 D4:1:2 E4:1:3 F4:1:4 | G4:4:5 | G4:1:5 F4:1:4 E4:1:3 D4:1:2 | C4:4:1 | C4:1:1 E4:1:3 D4:1:2 F4:1:4 | E4:1:3 G4:1:5 F4:1:4 D4:1:2 | E4:2:3 D4:2:2 | C4:4:1',
      L: 'C3:4:5 | E3:4:3 | G3:4:1 | C3:4:5 | C3:4:5 | C3:4:5 | G3:4:1 | C3:4:5',
    },
  },
  {
    id: 'main-gauche-do',
    title: 'La main gauche se promène',
    composer: 'Exercice original',
    genre: 'debutant',
    level: 1,
    tempo: 76,
    timeSig: [4, 4],
    keyFifths: 0,
    description:
      'Cette fois c’est la main gauche qui chante la mélodie (auriculaire sur le Do). Commencez main gauche seule, puis ajoutez les rondes de la main droite.',
    tags: ['position de Do', 'main gauche', '5 doigts'],
    tracks: {
      R: 'G4:4:5 | G4:4:5 | F4:4:4 | E4:4:3 | D4:4:2 | C4:4:1 | D4:4:2 | C4:4:1',
      L: 'C3:1:5 D3:1:4 E3:1:3 F3:1:2 | G3:2:1 E3:2:3 | F3:1:2 E3:1:3 D3:1:4 F3:1:2 | E3:4:3 | G3:1:1 F3:1:2 E3:1:3 D3:1:4 | E3:1:3 F3:1:2 G3:2:1 | F3:1:2 E3:1:3 D3:2:4 | C3:4:5',
    },
  },
  {
    id: 'noires-blanches',
    title: 'Noires, blanches et rondes',
    composer: 'Exercice original',
    genre: 'debutant',
    level: 1,
    tempo: 80,
    timeSig: [4, 4],
    keyFifths: 0,
    description:
      'Un petit air pour sentir la différence entre noire (1 temps), blanche (2 temps) et ronde (4 temps). Comptez à voix haute « 1, 2, 3, 4 » en jouant.',
    tags: ['rythme', 'noire', 'blanche', 'ronde'],
    tracks: {
      R: 'C4:1:1 C4:1:1 C4:2:1 | D4:1:2 D4:1:2 D4:2:2 | E4:1:3 E4:1:3 F4:1:4 F4:1:4 | G4:4:5 | G4:1:5 F4:1:4 E4:2:3 | F4:1:4 E4:1:3 D4:2:2 | E4:2:3 D4:2:2 | C4:4:1',
      L: 'C3:4:5 | G3:4:1 | C3:4:5 | E3:4:3 | C3:4:5 | G3:4:1 | G3:4:1 | C3:4:5',
    },
  },
  {
    id: 'touches-noires',
    title: 'Promenade sur les touches noires',
    composer: 'Exercice original',
    genre: 'debutant',
    level: 1,
    tempo: 84,
    timeSig: [4, 4],
    keyFifths: 6,
    description:
      'Questions-réponses entre les mains, uniquement sur les touches noires : la main droite joue le groupe de trois, la main gauche le groupe de deux. Idéal pour se repérer sur le clavier.',
    tags: ['touches noires', 'pentatonique', 'repérage'],
    tracks: {
      R: 'F#4:1:2 G#4:1:3 A#4:2:4 | A#4:1:4 G#4:1:3 F#4:2:2 | r:4 | r:4 | F#4:1:2 A#4:1:4 G#4:1:3 F#4:1:2 | G#4:4:3 | r:4 | r:4',
      L: 'r:4 | r:4 | C#3:1:3 D#3:1:2 C#3:2:3 | D#3:1:2 C#3:1:3 D#3:2:2 | r:4 | r:4 | C#3:2:3 D#3:2:2 | C#3:4:3',
    },
  },
  {
    id: 'cinq-doigts-sol',
    title: 'Cinq doigts en Sol',
    composer: 'Exercice original',
    genre: 'debutant',
    level: 1,
    tempo: 80,
    timeSig: [4, 4],
    keyFifths: 1,
    description:
      'On déplace la position : pouce droit sur le Sol, auriculaire gauche sur le Sol grave. Même mains, nouvelles notes !',
    tags: ['position de Sol', '5 doigts', 'mains ensemble'],
    tracks: {
      R: 'G4:1:1 A4:1:2 B4:1:3 C5:1:4 | D5:2:5 B4:2:3 | C5:1:4 A4:1:2 B4:1:3 G4:1:1 | A4:4:2 | G4:1:1 B4:1:3 D5:1:5 B4:1:3 | C5:1:4 A4:1:2 B4:1:3 A4:1:2 | B4:2:3 A4:2:2 | G4:4:1',
      L: 'G2:4:5 | G2:4:5 | C3:2:2 G2:2:5 | D3:4:1 | G2:4:5 | C3:2:2 D3:2:1 | D3:4:1 | G2:4:5',
    },
  },

  // ===================== CLASSIQUE =====================
  {
    id: 'ode-joie',
    title: 'Ode à la joie',
    composer: 'Ludwig van Beethoven',
    genre: 'classique',
    level: 1,
    tempo: 100,
    timeSig: [4, 4],
    keyFifths: 0,
    description:
      'Le thème de la 9e symphonie, presque entièrement en position de Do. Attention à la noire pointée suivie d’une croche à la fin de chaque phrase : comptez « 1 – 2 – et », la croche tombe sur le « et ».',
    tags: ['Beethoven', 'position de Do', 'mains ensemble'],
    tracks: {
      R: 'E4:1:3 E4:1:3 F4:1:4 G4:1:5 | G4:1:5 F4:1:4 E4:1:3 D4:1:2 | C4:1:1 C4:1:1 D4:1:2 E4:1:3 | E4:1.5:3 D4:0.5:2 D4:2:2 | E4:1:3 E4:1:3 F4:1:4 G4:1:5 | G4:1:5 F4:1:4 E4:1:3 D4:1:2 | C4:1:1 C4:1:1 D4:1:2 E4:1:3 | D4:1.5:2 C4:0.5:1 C4:2:1 | D4:1:2 D4:1:2 E4:1:3 C4:1:1 | D4:1:2 E4:0.5:3 F4:0.5:4 E4:1:3 C4:1:1 | D4:1:2 E4:0.5:3 F4:0.5:4 E4:1:3 D4:1:2 | C4:1:1 D4:1:2 G3:2:1 | E4:1:3 E4:1:3 F4:1:4 G4:1:5 | G4:1:5 F4:1:4 E4:1:3 D4:1:2 | C4:1:1 C4:1:1 D4:1:2 E4:1:3 | D4:1.5:2 C4:0.5:1 C4:2:1',
      L: 'C3:4:5 | G3:4:1 | C3:4:5 | G3:4:1 | C3:4:5 | G3:4:1 | C3:4:5 | G3:2:1 C3:2:5 | G3:4:1 | G3:2:1 C3:2:5 | G3:4:1 | C3:2:5 D3:2:4 | C3:4:5 | G3:4:1 | C3:4:5 | G3:2:1 C3:2:5',
    },
  },
  {
    id: 'menuet-sol',
    title: 'Menuet en Sol',
    composer: 'Christian Petzold (attribué à J.-S. Bach)',
    genre: 'classique',
    level: 3,
    tempo: 100,
    timeSig: [3, 4],
    keyFifths: 1,
    description:
      'Le célèbre menuet du Petit livre d’Anna Magdalena Bach. Jouez les croches legato et la basse un peu détachée, avec un léger appui sur le premier temps de chaque mesure.',
    tags: ['baroque', 'menuet', '3/4', 'Bach'],
    tracks: {
      R: 'D5:1 G4:0.5 A4:0.5 B4:0.5 C5:0.5 | D5:1 G4:1 G4:1 | E5:1 C5:0.5 D5:0.5 E5:0.5 F#5:0.5 | G5:1 G4:1 G4:1 | C5:1 D5:0.5 C5:0.5 B4:0.5 A4:0.5 | B4:1 C5:0.5 B4:0.5 A4:0.5 G4:0.5 | F#4:1 G4:0.5 A4:0.5 B4:0.5 G4:0.5 | A4:3 | D5:1 G4:0.5 A4:0.5 B4:0.5 C5:0.5 | D5:1 G4:1 G4:1 | E5:1 C5:0.5 D5:0.5 E5:0.5 F#5:0.5 | G5:1 G4:1 G4:1 | C5:1 D5:0.5 C5:0.5 B4:0.5 A4:0.5 | B4:1 C5:0.5 B4:0.5 A4:0.5 G4:0.5 | A4:1 B4:0.5 A4:0.5 G4:0.5 F#4:0.5 | G4:3',
      L: 'G3:2 A3:1 | B3:3 | C4:3 | B3:3 | A3:3 | G3:3 | D4:1 B3:1 G3:1 | D4:1 D3:0.5 C4:0.5 B3:0.5 A3:0.5 | B3:2 A3:1 | G3:1 B3:1 G3:1 | C4:3 | B3:1 C4:0.5 B3:0.5 A3:0.5 G3:0.5 | A3:2 F#3:1 | G3:2 B3:1 | C4:1 D4:1 D3:1 | G3:2 G2:1',
    },
  },
  {
    id: 'lettre-elise',
    title: 'Lettre à Élise (thème)',
    composer: 'Ludwig van Beethoven',
    genre: 'classique',
    level: 4,
    tempo: 60,
    timeSig: [3, 8],
    keyFifths: 0,
    keyMode: 'minor',
    pickupBeats: 0.5,
    description:
      'La partie A de la célèbre bagatelle. Les doubles croches passent d’une main à l’autre : travaillez lentement le relais entre la main gauche (arpège) et la main droite, avec la pédale à chaque mesure.',
    tags: ['Beethoven', 'romantique', 'pédale', '3/8'],
    tracks: {
      R: 'r:1 E5:0.25 D#5:0.25 | E5:0.25 D#5:0.25 E5:0.25 B4:0.25 D5:0.25 C5:0.25 | A4:0.5 r:0.25 C4:0.25 E4:0.25 A4:0.25 | B4:0.5 r:0.25 E4:0.25 G#4:0.25 B4:0.25 | C5:0.5 r:0.25 E4:0.25 E5:0.25 D#5:0.25 | E5:0.25 D#5:0.25 E5:0.25 B4:0.25 D5:0.25 C5:0.25 | A4:0.5 r:0.25 C4:0.25 E4:0.25 A4:0.25 | B4:0.5 r:0.25 E4:0.25 C5:0.25 B4:0.25 | A4:0.5 r:0.5 E5:0.25 D#5:0.25 | E5:0.25 D#5:0.25 E5:0.25 B4:0.25 D5:0.25 C5:0.25 | A4:0.5 r:0.25 C4:0.25 E4:0.25 A4:0.25 | B4:0.5 r:0.25 E4:0.25 G#4:0.25 B4:0.25 | C5:0.5 r:0.25 E4:0.25 E5:0.25 D#5:0.25 | E5:0.25 D#5:0.25 E5:0.25 B4:0.25 D5:0.25 C5:0.25 | A4:0.5 r:0.25 C4:0.25 E4:0.25 A4:0.25 | B4:0.5 r:0.25 E4:0.25 C5:0.25 B4:0.25 | A4:1.5',
      L: 'r:1.5 | r:1.5 | A2:0.25 E3:0.25 A3:0.25 r:0.75 | E2:0.25 E3:0.25 G#3:0.25 r:0.75 | A2:0.25 E3:0.25 A3:0.25 r:0.75 | r:1.5 | A2:0.25 E3:0.25 A3:0.25 r:0.75 | E2:0.25 E3:0.25 G#3:0.25 r:0.75 | A2:0.25 E3:0.25 A3:0.25 r:0.75 | r:1.5 | A2:0.25 E3:0.25 A3:0.25 r:0.75 | E2:0.25 E3:0.25 G#3:0.25 r:0.75 | A2:0.25 E3:0.25 A3:0.25 r:0.75 | r:1.5 | A2:0.25 E3:0.25 A3:0.25 r:0.75 | E2:0.25 E3:0.25 G#3:0.25 r:0.75 | A2:0.25 E3:0.25 A3:0.25 r:0.75',
    },
  },
  {
    id: 'prelude-do',
    title: 'Prélude en Do (BWV 846), début',
    composer: 'Jean-Sébastien Bach',
    genre: 'classique',
    level: 3,
    tempo: 66,
    timeSig: [4, 4],
    keyFifths: 0,
    description:
      'Les premières mesures du premier prélude du Clavier bien tempéré : un accord brisé répété deux fois par mesure. Avant de jouer, plaquez chaque accord pour mémoriser la forme de la main.',
    tags: ['Bach', 'baroque', 'arpèges', 'accords brisés'],
    tracks: {
      R: [
        ['G4', 'C5', 'E5'],
        ['A4', 'D5', 'F5'],
        ['G4', 'D5', 'F5'],
        ['G4', 'C5', 'E5'],
      ]
        .map(([c, d, e]) => {
          const half = `r:0.5 ${c}:0.25 ${d}:0.25 ${e}:0.25 ${c}:0.25 ${d}:0.25 ${e}:0.25`;
          return `${half} ${half}`;
        })
        .concat(['E4+G4+C5:4'])
        .join(' | '),
      L: [
        ['C4', 'E4'],
        ['C4', 'D4'],
        ['B3', 'D4'],
        ['C4', 'E4'],
      ]
        .map(([a, b]) => `${a}:0.25 ${b}:1.75 ${a}:0.25 ${b}:1.75`)
        .concat(['C3+C4:4'])
        .join(' | '),
    },
  },
  {
    id: 'berceuse-brahms',
    title: 'Berceuse',
    composer: 'Johannes Brahms',
    genre: 'classique',
    level: 3,
    tempo: 80,
    timeSig: [3, 4],
    keyFifths: 0,
    pickupBeats: 1,
    description:
      'La « Wiegenlied » op. 49 n°4, transposée en Do. La main gauche berce (basse puis deux accords) : gardez-la très douce pour laisser chanter la mélodie.',
    tags: ['Brahms', 'romantique', 'valse', '3/4'],
    tracks: {
      R: 'r:2 E4:0.5 E4:0.5 | G4:2 E4:0.5 E4:0.5 | G4:2 E4:0.5 G4:0.5 | C5:1 B4:1.5 A4:0.5 | A4:1 G4:1 D4:0.5 E4:0.5 | F4:1 D4:1 D4:0.5 E4:0.5 | F4:2 D4:0.5 F4:0.5 | B4:0.5 A4:0.5 G4:1 B4:1 | C5:2 C4:0.5 C4:0.5 | C5:2 A4:0.5 F4:0.5 | G4:2 E4:0.5 C4:0.5 | F4:1 G4:1 A4:1 | G4:2 C4:0.5 C4:0.5 | C5:2 A4:0.5 F4:0.5 | G4:2 E4:0.5 C4:0.5 | F4:1 E4:1 D4:1 | C4:2 r:1',
      L: (() => {
        const C = 'C3:1 E3+G3:1 E3+G3:1';
        const G7 = 'G2:1 B2+F3:1 B2+F3:1';
        const F = 'F2:1 A2+C3:1 A2+C3:1';
        return ['r:3', C, C, G7, G7, G7, G7, G7, C, F, C, F, C, F, C, G7, 'C3+E3+G3:2 r:1'].join(' | ');
      })(),
    },
  },
  {
    id: 'canon-pachelbel',
    title: 'Canon en Ré (simplifié)',
    composer: 'Johann Pachelbel',
    genre: 'classique',
    level: 3,
    tempo: 60,
    timeSig: [4, 4],
    keyFifths: 2,
    description:
      'La fameuse basse obstinée de huit notes, répétée sous trois variations de plus en plus animées. Apprenez d’abord la basse par cœur : tout le reste se pose dessus.',
    tags: ['baroque', 'basse obstinée', 'Ré majeur'],
    tracks: {
      R: 'F#5:2 E5:2 | D5:2 C#5:2 | B4:2 A4:2 | B4:2 C#5:2 | D5:2 C#5:2 | B4:2 A4:2 | G4:2 F#4:2 | G4:2 E4:2 | D5:1 F#5:1 A5:1 G5:1 | F#5:1 D5:1 F#5:1 E5:1 | D5:1 B4:1 D5:1 A5:1 | G5:1 B5:1 A5:1 G5:1 | F#5:4',
      L: rep('D3:2 A2:2 | B2:2 F#2:2 | G2:2 D2:2 | G2:2 A2:2', 3) + ' | D2+D3:4',
    },
  },

  // ===================== COMPTINES =====================
  {
    id: 'clair-de-la-lune',
    title: 'Au clair de la lune',
    composer: 'Traditionnel',
    genre: 'comptines',
    level: 1,
    tempo: 90,
    timeSig: [4, 4],
    keyFifths: 0,
    description:
      'Trois notes suffisent pour la première phrase ! Au milieu, la main droite glisse en position de Sol (pouce sur le Sol grave) puis revient en position de Do.',
    tags: ['chanson', 'position de Do', 'déplacement de main'],
    tracks: {
      R: 'C4:1:1 C4:1:1 C4:1:1 D4:1:2 | E4:2:3 D4:2:2 | C4:1:1 E4:1:3 D4:1:2 D4:1:2 | C4:4:1 | C4:1:1 C4:1:1 C4:1:1 D4:1:2 | E4:2:3 D4:2:2 | C4:1:1 E4:1:3 D4:1:2 D4:1:2 | C4:4:1 | D4:1:5 D4:1:5 D4:1:5 D4:1:5 | A3:2:2 A3:2:2 | D4:1:5 C4:1:4 B3:1:3 A3:1:2 | G3:4:1 | C4:1:1 C4:1:1 C4:1:1 D4:1:2 | E4:2:3 D4:2:2 | C4:1:1 E4:1:3 D4:1:2 D4:1:2 | C4:4:1',
      L: 'C3:4:5 | E3:2:3 G3:2:1 | C3:2:5 G3:2:1 | C3:4:5 | C3:4:5 | E3:2:3 G3:2:1 | C3:2:5 G3:2:1 | C3:4:5 | G2:4:5 | A2:4:4 | B2:4:3 | G2:4:5 | C3:4:5 | E3:2:3 G3:2:1 | C3:2:5 G3:2:1 | C3:4:5',
    },
  },
  {
    id: 'frere-jacques',
    title: 'Frère Jacques',
    composer: 'Traditionnel',
    genre: 'comptines',
    level: 1,
    tempo: 100,
    timeSig: [4, 4],
    keyFifths: 0,
    description:
      'La main gauche tient une quinte Do-Sol (un « bourdon ») pendant que la droite chante. Essayez ensuite de la jouer en canon avec quelqu’un !',
    tags: ['chanson', 'canon', 'croches'],
    tracks: {
      R: 'C4:1:1 D4:1:2 E4:1:3 C4:1:1 | C4:1:1 D4:1:2 E4:1:3 C4:1:1 | E4:1:3 F4:1:4 G4:2:5 | E4:1:3 F4:1:4 G4:2:5 | G4:0.5:4 A4:0.5:5 G4:0.5:4 F4:0.5:3 E4:1:2 C4:1:1 | G4:0.5:4 A4:0.5:5 G4:0.5:4 F4:0.5:3 E4:1:2 C4:1:1 | C4:1:4 G3:1:1 C4:2:4 | C4:1:4 G3:1:1 C4:2:4',
      L: rep('C3+G3:4:5+1', 8),
    },
  },
  {
    id: 'ah-vous-dirai-je',
    title: 'Ah ! vous dirai-je, maman',
    composer: 'Traditionnel (variations de Mozart)',
    genre: 'comptines',
    level: 1,
    tempo: 92,
    timeSig: [4, 4],
    keyFifths: 0,
    description:
      'L’air de « Twinkle, twinkle little star ». La main droite s’étire pour atteindre le La avec le 5e doigt : gardez le poignet souple, puis revenez en position de Do.',
    tags: ['chanson', 'Mozart', 'mains ensemble'],
    tracks: {
      R: 'C4:1:1 C4:1:1 G4:1:4 G4:1:4 | A4:1:5 A4:1:5 G4:2:4 | F4:1:4 F4:1:4 E4:1:3 E4:1:3 | D4:1:2 D4:1:2 C4:2:1 | G4:1:5 G4:1:5 F4:1:4 F4:1:4 | E4:1:3 E4:1:3 D4:2:2 | G4:1:5 G4:1:5 F4:1:4 F4:1:4 | E4:1:3 E4:1:3 D4:2:2 | C4:1:1 C4:1:1 G4:1:4 G4:1:4 | A4:1:5 A4:1:5 G4:2:4 | F4:1:4 F4:1:4 E4:1:3 E4:1:3 | D4:1:2 D4:1:2 C4:2:1',
      L: 'C3:4:5 | F3:2:2 E3:2:3 | D3:2:4 C3:2:5 | G3:2:1 C3:2:5 | E3:2:3 D3:2:4 | C3:2:5 G3:2:1 | E3:2:3 D3:2:4 | C3:2:5 G3:2:1 | C3:4:5 | F3:2:2 E3:2:3 | D3:2:4 C3:2:5 | G3:2:1 C3:2:5',
    },
  },
  {
    id: 'joyeux-anniversaire',
    title: 'Joyeux anniversaire',
    composer: 'Mildred et Patty Hill',
    genre: 'comptines',
    level: 2,
    tempo: 90,
    timeSig: [3, 4],
    keyFifths: 0,
    pickupBeats: 1,
    description:
      'Le morceau à savoir jouer pour toutes les fêtes ! Il commence par une levée (deux notes avant la première mesure) au rythme pointé « taaa-ta ».',
    tags: ['anacrouse', 'rythme pointé', '3/4'],
    tracks: {
      R: 'r:2 G4:0.75:1 G4:0.25:1 | A4:1:2 G4:1:1 C5:1:4 | B4:2:3 G4:0.75:1 G4:0.25:1 | A4:1:2 G4:1:1 D5:1:5 | C5:2:4 G4:0.75:1 G4:0.25:1 | G5:1:5 E5:1:3 C5:1:1 | B4:1:2 A4:1:1 F5:0.75:5 F5:0.25:5 | E5:1:4 C5:1:2 D5:1:3 | C5:3:2',
      L: 'r:3 | C3:3:1 | G2:3:4 | G2:3:4 | C3:3:1 | C3:3:1 | F2:3:5 | C3:2:1 G2:1:4 | C3:3:1',
    },
  },

  // ===================== NOËL =====================
  {
    id: 'vive-le-vent',
    title: 'Vive le vent',
    composer: 'James Lord Pierpont',
    genre: 'noel',
    level: 1,
    tempo: 110,
    timeSig: [4, 4],
    keyFifths: 0,
    description:
      'Le refrain de « Jingle Bells », entièrement en position de Do. Faites bien sonner les trois Mi répétés en relevant légèrement le doigt entre chaque note.',
    tags: ['Noël', 'position de Do', 'notes répétées'],
    tracks: {
      R: 'E4:1:3 E4:1:3 E4:2:3 | E4:1:3 E4:1:3 E4:2:3 | E4:1:3 G4:1:5 C4:1.5:1 D4:0.5:2 | E4:4:3 | F4:1:4 F4:1:4 F4:1.5:4 F4:0.5:4 | F4:1:4 E4:1:3 E4:1:3 E4:0.5:3 E4:0.5:3 | E4:1:3 D4:1:2 D4:1:2 E4:1:3 | D4:2:2 G4:2:5 | E4:1:3 E4:1:3 E4:2:3 | E4:1:3 E4:1:3 E4:2:3 | E4:1:3 G4:1:5 C4:1.5:1 D4:0.5:2 | E4:4:3 | F4:1:4 F4:1:4 F4:1:4 F4:1:4 | F4:1:4 E4:1:3 E4:1:3 E4:0.5:3 E4:0.5:3 | G4:1:5 G4:1:5 F4:1:4 D4:1:2 | C4:4:1',
      L: 'C3:4:5 | C3:4:5 | C3:4:5 | C3:4:5 | F3:4:2 | C3:4:5 | D3:4:4 | G3:4:1 | C3:4:5 | C3:4:5 | C3:4:5 | C3:4:5 | F3:4:2 | C3:4:5 | G3:4:1 | C3:4:5',
    },
  },
  {
    id: 'joie-sur-la-terre',
    title: 'Joie sur la terre (Joy to the World)',
    composer: 'Lowell Mason, d’après Haendel',
    genre: 'noel',
    level: 2,
    tempo: 84,
    timeSig: [4, 4],
    keyFifths: 0,
    description:
      'La première phrase descend toute la gamme de Do : c’est l’occasion idéale de travailler le croisement du 3e doigt par-dessus le pouce (Fa-Mi).',
    tags: ['Noël', 'gamme descendante', 'passage du pouce'],
    tracks: {
      R: 'C5:2:5 B4:1.5:4 A4:0.5:3 | G4:3:2 F4:1:1 | E4:2:3 D4:2:2 | C4:3:1 G4:1:1 | A4:3:2 A4:1:2 | B4:3:3 B4:1:3 | C5:4:4',
      L: 'C3:4:5 | E3:2:3 F3:2:2 | G3:4:1 | C3:4:5 | F3:4:2 | G3:4:1 | C3:4:5',
    },
  },
  {
    id: 'douce-nuit',
    title: 'Douce nuit',
    composer: 'Franz Xaver Gruber',
    genre: 'noel',
    level: 3,
    tempo: 66,
    timeSig: [6, 8],
    keyFifths: 0,
    description:
      'Un chant en 6/8 qui se balance en deux grands temps. Tenez bien les notes longues de la main gauche et chantez intérieurement les paroles pour trouver le phrasé.',
    tags: ['Noël', '6/8', 'legato'],
    tracks: {
      R: 'G4:0.75 A4:0.25 G4:0.5 E4:1.5 | G4:0.75 A4:0.25 G4:0.5 E4:1.5 | D5:1 D5:0.5 B4:1.5 | C5:1 C5:0.5 G4:1.5 | A4:1 A4:0.5 C5:0.75 B4:0.25 A4:0.5 | G4:0.75 A4:0.25 G4:0.5 E4:1.5 | A4:1 A4:0.5 C5:0.75 B4:0.25 A4:0.5 | G4:0.75 A4:0.25 G4:0.5 E4:1.5 | D5:1 D5:0.5 F5:0.75 D5:0.25 B4:0.5 | C5:1.5 E5:1.5 | C5:0.5 G4:0.5 E4:0.5 G4:0.75 F4:0.25 D4:0.5 | C4:3',
      L: 'C3+G3:3:5+1 | C3+G3:3:5+1 | G2+D3:3:5+1 | C3+G3:3:5+1 | F2+C3:3:5+1 | C3+G3:3:5+1 | F2+C3:3:5+1 | C3+G3:3:5+1 | G2+D3:3:5+1 | C3+G3:3:5+1 | C3+G3:1.5:5+1 G2+D3:1.5:5+1 | C3+G3:3:5+1',
    },
  },
  {
    id: 'deck-the-halls',
    title: 'Deck the Halls (Noël gallois)',
    composer: 'Traditionnel gallois',
    genre: 'noel',
    level: 3,
    tempo: 104,
    timeSig: [4, 4],
    keyFifths: 0,
    description:
      'Un Noël joyeux plein de « fa la la la la ». Les croches doivent être bien égales : travaillez la troisième phrase (avec le Fa dièse) à part.',
    tags: ['Noël', 'croches', 'traditionnel'],
    tracks: {
      R: rep('G4:1.5 F4:0.5 E4:1 D4:1 | C4:1 D4:1 E4:1 C4:1 | D4:0.5 E4:0.5 F4:0.5 D4:0.5 E4:1.5 D4:0.5 | C4:1 B3:1 C4:2', 2) +
        ' | D4:1.5 E4:0.5 F4:1 D4:1 | E4:1.5 F4:0.5 G4:1 D4:1 | E4:0.5 F#4:0.5 G4:1 A4:0.5 B4:0.5 C5:1 | B4:1 A4:1 G4:2' +
        ' | G4:1.5 F4:0.5 E4:1 D4:1 | C4:1 D4:1 E4:1 C4:1 | A4:0.5 A4:0.5 A4:0.5 A4:0.5 G4:1.5 F4:0.5 | E4:1 D4:1 C4:2',
      L: rep('C3:4 | C3:2 G2:2 | F2:2 C3:2 | G2:2 C3:2', 2) +
        ' | G2:4 | C3:2 G2:2 | A2:2 D3:2 | G2:4' +
        ' | C3:4 | C3:2 G2:2 | F2:2 C3:2 | G2:2 C3:2',
    },
  },

  // ===================== FOLK =====================
  {
    id: 'greensleeves',
    title: 'Greensleeves',
    composer: 'Traditionnel anglais',
    genre: 'folk',
    level: 3,
    tempo: 60,
    timeSig: [6, 8],
    keyFifths: 0,
    keyMode: 'minor',
    pickupBeats: 0.5,
    description:
      'Une ballade anglaise de la Renaissance en La mineur, en 6/8. Remarquez le Sol naturel (couleur ancienne) puis le Sol dièse aux cadences : ce contraste fait tout le charme de la mélodie.',
    tags: ['Renaissance', 'mineur', '6/8', 'anacrouse'],
    tracks: {
      R: 'r:2.5 A4:0.5 | C5:1 D5:0.5 E5:0.75 F5:0.25 E5:0.5 | D5:1 B4:0.5 G4:0.75 A4:0.25 B4:0.5 | C5:1 A4:0.5 A4:0.75 G#4:0.25 A4:0.5 | B4:1 G#4:0.5 E4:1 A4:0.5 | C5:1 D5:0.5 E5:0.75 F5:0.25 E5:0.5 | D5:1 B4:0.5 G4:0.75 A4:0.25 B4:0.5 | C5:0.75 B4:0.25 A4:0.5 G#4:0.75 F#4:0.25 G#4:0.5 | A4:3 | G5:1.5 G5:0.75 F#5:0.25 E5:0.5 | D5:1 B4:0.5 G4:0.75 A4:0.25 B4:0.5 | C5:1 A4:0.5 A4:0.75 G#4:0.25 A4:0.5 | B4:1 G#4:0.5 E4:1.5 | G5:1.5 G5:0.75 F#5:0.25 E5:0.5 | D5:1 B4:0.5 G4:0.75 A4:0.25 B4:0.5 | C5:0.75 B4:0.25 A4:0.5 G#4:0.75 F#4:0.25 G#4:0.5 | A4:3',
      L: (() => {
        const Am = 'A2+E3:3', G = 'G2+D3:3', E = 'E2+B2:3', C = 'C3+G3:3', AmE = 'A2+E3:1.5 E2+B2:1.5';
        return ['r:3', Am, G, Am, E, Am, G, AmE, Am, C, G, Am, E, C, G, AmE, Am].join(' | ');
      })(),
    },
  },
  {
    id: 'au-revoir',
    title: 'Ce n’est qu’un au revoir (Auld Lang Syne)',
    composer: 'Traditionnel écossais',
    genre: 'folk',
    level: 2,
    tempo: 80,
    timeSig: [4, 4],
    keyFifths: -1,
    pickupBeats: 1,
    description:
      'Le chant des adieux, en Fa majeur (attention au Si bémol à la main gauche). Le rythme pointé « taaa-ta » (noire pointée + croche) revient sans cesse : comptez « 1 – 2 – et » pour placer la croche.',
    tags: ['écossais', 'rythme pointé', 'anacrouse', 'Fa majeur'],
    tracks: {
      R: 'r:3 C4:1:1 | F4:1.5:2 F4:0.5:2 F4:1:2 A4:1:4 | G4:1.5:3 F4:0.5:2 G4:1:3 A4:1:4 | F4:1.5:1 F4:0.5:1 A4:1:2 C5:1:4 | D5:3:5 D5:1:5 | C5:1.5:4 A4:0.5:2 A4:1:2 F4:1:1 | G4:1.5:2 F4:0.5:1 G4:1:2 A4:1:3 | F4:1.5:4 D4:0.5:2 D4:1:2 C4:1:1 | F4:4:4',
      L: 'r:4 | F2+C3:4:5+1 | C3+G3:4:5+1 | F2+C3:4:5+1 | Bb2+F3:4:5+1 | F2+C3:4:5+1 | C3+G3:4:5+1 | Bb2+F3:2:5+1 C3+G3:2:5+1 | F2+C3:4:5+1',
    },
  },
  {
    id: 'oh-susanna',
    title: 'Oh! Susanna',
    composer: 'Stephen Foster',
    genre: 'folk',
    level: 1,
    tempo: 100,
    timeSig: [4, 4],
    keyFifths: 0,
    pickupBeats: 1,
    description:
      'Une chanson folk américaine pleine d’entrain. La main droite utilise Do-Ré-Mi puis Sol-La avec les doigts 4 et 5 : pas besoin du Fa !',
    tags: ['américain', 'anacrouse', 'croches'],
    tracks: {
      R: 'r:3 C4:0.5:1 D4:0.5:2 | E4:1:3 G4:1:4 G4:1.5:4 A4:0.5:5 | G4:1:4 E4:1:3 C4:1.5:1 D4:0.5:2 | E4:1:3 E4:1:3 D4:1:2 C4:1:1 | D4:3:2 C4:0.5:1 D4:0.5:2 | E4:1:3 G4:1:4 G4:1.5:4 A4:0.5:5 | G4:1:4 E4:1:3 C4:1.5:1 D4:0.5:2 | E4:1:3 E4:1:3 D4:1:2 D4:1:2 | C4:4:1',
      L: 'r:4 | C3:4:5 | C3:4:5 | C3:2:5 E3:2:3 | G3:4:1 | C3:4:5 | C3:4:5 | C3:2:5 G3:2:1 | C3:4:5',
    },
  },

  // ===================== GOSPEL =====================
  {
    id: 'amazing-grace',
    title: 'Amazing Grace',
    composer: 'Traditionnel (air « New Britain »)',
    genre: 'gospel',
    level: 3,
    tempo: 76,
    timeSig: [3, 4],
    keyFifths: 1,
    pickupBeats: 1,
    description:
      'L’hymne le plus célèbre du répertoire gospel. Main gauche : basse sur le premier temps puis accord tenu. Laissez respirer la mélodie à la fin de chaque phrase.',
    tags: ['hymne', '3/4', 'Sol majeur', 'accords de 7e'],
    tracks: {
      R: 'r:2 D4:1 | G4:2 B4:0.5 G4:0.5 | B4:2 A4:1 | G4:2 E4:1 | D4:2 D4:1 | G4:2 B4:0.5 G4:0.5 | B4:2 A4:0.5 B4:0.5 | D5:3 | r:2 B4:1 | D5:2 B4:0.5 G4:0.5 | B4:2 A4:1 | G4:2 E4:1 | D4:2 D4:1 | G4:2 B4:0.5 G4:0.5 | B4:2 A4:1 | G4:3',
      L: (() => {
        const G = 'G2:1 B2+D3:2', G7 = 'G2:1 B2+F3:2', C = 'C3:1 E3+G3:2', D = 'D3:1 F#3+A3:2', D7 = 'D3:1 F#3+C4:2', Em = 'E2:1 G2+B2:2';
        return ['r:3', G, G7, C, G, G, G, D, G, G, G7, C, G, Em, D7, 'G2+D3+G3:3'].join(' | ');
      })(),
    },
  },
  {
    id: 'when-the-saints',
    title: 'Oh When the Saints',
    composer: 'Spiritual traditionnel',
    genre: 'gospel',
    level: 1,
    tempo: 120,
    timeSig: [4, 4],
    keyFifths: 0,
    description:
      'Le grand classique de La Nouvelle-Orléans, tout en position de Do. Chaque phrase commence après un silence sur le premier temps : comptez « (1) 2 3 4 » avant de jouer.',
    tags: ['spiritual', 'position de Do', 'levée'],
    tracks: {
      R: 'r:1 C4:1:1 E4:1:3 F4:1:4 | G4:4:5 | r:1 C4:1:1 E4:1:3 F4:1:4 | G4:4:5 | r:1 C4:1:1 E4:1:3 F4:1:4 | G4:2:5 E4:2:3 | C4:2:1 E4:2:3 | D4:4:2 | r:1 E4:1:3 E4:1:3 D4:1:2 | C4:3:1 C4:1:1 | E4:2:3 G4:2:5 | G4:1:5 F4:3:4 | r:2 E4:1:3 F4:1:4 | G4:2:5 E4:2:3 | C4:2:1 D4:2:2 | C4:4:1',
      L: 'r:4 | C3:4:5 | C3:4:5 | C3:4:5 | C3:4:5 | C3:4:5 | E3:4:3 | G3:4:1 | G3:4:1 | C3:4:5 | C3:4:5 | F3:4:2 | F3:4:2 | C3:2:5 E3:2:3 | C3:2:5 G3:2:1 | C3:4:5',
    },
  },
  {
    id: 'amen-plagal',
    title: 'Cadence « Amen »',
    composer: 'Exercice original',
    genre: 'gospel',
    level: 2,
    tempo: 70,
    timeSig: [4, 4],
    keyFifths: 0,
    description:
      'Le mouvement d’accords le plus typique du gospel : Do – Fa/Do – Do, la cadence « Amen ». Le Do aigu reste sous l’auriculaire pendant que les autres doigts bougent à peine.',
    tags: ['cadence plagale', 'accords', 'septième', 'voicing'],
    tracks: {
      R: 'E4+G4+C5:4:1+2+5 | F4+A4+C5:4:1+3+5 | E4+G4+C5:4:1+2+5 | E4+Bb4+C5:4:1+4+5 | F4+A4+C5:4:1+3+5 | F4+Ab4+C5:4:1+3+5 | E4+G4+C5:2:1+2+5 F4+A4+C5:2:1+3+5 | E4+G4+C5:4:1+2+5',
      L: rep('C2+C3:4:5+1', 8),
    },
  },
  {
    id: 'dimanche-matin',
    title: 'Dimanche matin',
    composer: 'Composition originale',
    genre: 'gospel',
    level: 3,
    tempo: 72,
    timeSig: [4, 4],
    keyFifths: 0,
    description:
      'Une petite progression gospel avec basse qui monte (Do – Do/Mi – Fa) et accord de passage La7. Basse en octaves bien posées, accords de la main droite liés le plus possible.',
    tags: ['progression', 'basse en octaves', 'accords de passage'],
    tracks: {
      R: 'E4+G4+C5:2 F4+A4+C5:1 E4+G4+C5:1 | E4+G4+C5:2 F4+A4+C5:2 | E4+G4+C5:2 E4+G4+C#5:2 | F4+A4+D5:2 F4+B4+D5:2 | E4+G4+C5:2 F4+A4+C5:2 | E4+G4+C5:2 E4+A4+C5:2 | F4+A4+C5:2 F4+B4+D5:2 | E4+G4+C5:4',
      L: 'C2+C3:2 C2+C3:2 | E2+E3:2 F2+F3:2 | G2+G3:2 A2+A3:2 | D2+D3:2 G2+G3:2 | C2+C3:2 C2+C3:2 | C2+C3:2 A1+A2:2 | D2+D3:2 G2+G3:2 | C2+C3:4',
    },
  },

  // ===================== JAZZ & BLUES =====================
  {
    id: 'gamme-blues-do',
    title: 'Gamme blues en Do',
    composer: 'Exercice original',
    genre: 'jazz',
    level: 2,
    tempo: 80,
    timeSig: [4, 4],
    keyFifths: 0,
    description:
      'Do – Mi♭ – Fa – Fa♯ – Sol – Si♭ – Do : la gamme qui donne au blues sa couleur. D’abord la main droite sur un bourdon, puis la main gauche sous un accord de Do7.',
    tags: ['gamme blues', 'blue note', 'doigtés'],
    tracks: {
      R: 'C4:0.5:1 Eb4:0.5:2 F4:0.5:3 F#4:0.5:4 G4:0.5:1 Bb4:0.5:2 C5:0.5:3 Bb4:0.5:2 | G4:0.5:1 F#4:0.5:4 F4:0.5:3 Eb4:0.5:2 C4:2:1 | E4+Bb4:4:1+4 | E4+Bb4:4:1+4',
      L: 'C3+G3:4:5+1 | C3+G3:4:5+1 | C2:0.5:5 Eb2:0.5:4 F2:0.5:3 F#2:0.5:2 G2:0.5:1 Bb2:0.5:3 C3:0.5:2 Bb2:0.5:3 | G2:0.5:1 F#2:0.5:2 F2:0.5:3 Eb2:0.5:4 C2:2:5',
    },
  },
  {
    id: 'blues-do',
    title: 'Blues en Do (12 mesures)',
    composer: 'Composition originale',
    genre: 'jazz',
    level: 3,
    tempo: 96,
    timeSig: [4, 4],
    keyFifths: 0,
    description:
      'La grille de blues complète : Do7 (4 mesures), Fa7 (2), Do7 (2), Sol7, Fa7, Do7, Sol7. La main gauche joue un « shuffle » quinte-sixte ; jouez les croches de la main droite « ternaires » (longue-courte).',
    tags: ['blues', '12 mesures', 'shuffle', 'swing'],
    tracks: {
      R: 'Eb4:0.5 E4:0.5 G4:1 C5:1 Bb4:1 | G4:2 r:2 | Eb4:0.5 E4:0.5 G4:1 A4:1 Bb4:1 | C5:2 r:2 | Ab4:0.5 A4:0.5 C5:1 F5:1 Eb5:1 | C5:2 r:2 | Eb4:0.5 E4:0.5 G4:1 C5:1 Bb4:1 | G4:2 r:2 | D5:1 B4:1 G4:1 F4:1 | Eb5:1 C5:1 A4:1 F4:1 | C5:1 G4:0.5 Eb4:0.5 E4:1 C4:1 | D4:1 F4:1 G4:1 B4:1 | E4+G4+Bb4+C5:4',
      L: (() => {
        const C = 'C3+G3:1 C3+A3:1 C3+G3:1 C3+A3:1';
        const F = 'F2+C3:1 F2+D3:1 F2+C3:1 F2+D3:1';
        const G = 'G2+D3:1 G2+E3:1 G2+D3:1 G2+E3:1';
        return [C, C, C, C, F, F, C, C, G, F, C, G, 'C2+C3:4'].join(' | ');
      })(),
    },
  },
  {
    id: 'deux-cinq-un',
    title: 'II-V-I dans trois tonalités',
    composer: 'Exercice original',
    genre: 'jazz',
    level: 3,
    tempo: 72,
    timeSig: [4, 4],
    keyFifths: 0,
    description:
      'L’enchaînement roi du jazz (Rém7 – Sol7 – Domaj7), puis en Fa et en Si♭. La main droite bouge le moins possible : souvent un seul doigt descend d’un demi-ton d’un accord à l’autre.',
    tags: ['II-V-I', 'voicings', 'septièmes', 'conduite des voix'],
    tracks: {
      R: 'F4+A4+C5:4 | F4+G4+B4:4 | E4+G4+B4:4 | E4+G4+B4:4 | Bb4+D5+F5:4 | Bb4+C5+E5:4 | A4+C5+E5:4 | A4+C5+E5:4 | Eb4+G4+Bb4:4 | Eb4+F4+A4:4 | D4+F4+A4:4 | D4+F4+A4:4',
      L: 'D3:4 | G2:4 | C3:4 | C3:4 | G2:4 | C3:4 | F2:4 | F2:4 | C3:4 | F2:4 | Bb2:4 | Bb2:4',
    },
  },
  {
    id: 'walking-fa',
    title: 'Walking bass en Fa',
    composer: 'Composition originale',
    genre: 'jazz',
    level: 4,
    tempo: 100,
    timeSig: [4, 4],
    keyFifths: -1,
    description:
      'Un blues jazz en Fa : la main gauche « marche » en noires (fondamentale, notes de l’accord, puis note d’approche chromatique), la main droite place des accords à deux sons sur les temps 2 et 4.',
    tags: ['walking bass', 'blues jazz', 'comping', 'swing'],
    tracks: {
      R: (() => {
        const c = (ch) => `r:1 ${ch}:1 r:1 ${ch}:1`;
        const F7 = 'A4+Eb5', Bb7 = 'Ab4+D5', D7 = 'F#4+C5', Gm7 = 'Bb4+F5', C7 = 'Bb4+E5';
        return [c(F7), c(Bb7), c(F7), c(F7), c(Bb7), c(Bb7), c(F7), c(D7), c(Gm7), c(C7),
          `r:1 ${F7}:1 r:1 ${D7}:1`, `r:1 ${Gm7}:1 r:1 ${C7}:1`, 'A4+C5+Eb5:4'].join(' | ');
      })(),
      L: 'F2:1 A2:1 C3:1 A2:1 | Bb2:1 D3:1 F3:1 E3:1 | F3:1 Eb3:1 C3:1 A2:1 | F2:1 A2:1 C3:1 B2:1 | Bb2:1 C3:1 D3:1 F3:1 | Ab3:1 F3:1 D3:1 E3:1 | F3:1 C3:1 A2:1 C#3:1 | D3:1 F#3:1 A3:1 Ab3:1 | G3:1 F3:1 D3:1 Bb2:1 | C3:1 E3:1 G3:1 Gb3:1 | F3:1 C3:1 D3:1 A2:1 | G2:1 Bb2:1 C3:1 E3:1 | F2:4',
    },
  },

  // ===================== RAGTIME =====================
  {
    id: 'stride-do',
    title: 'Exercice de stride',
    composer: 'Exercice original',
    genre: 'ragtime',
    level: 3,
    tempo: 72,
    timeSig: [2, 4],
    keyFifths: 0,
    description:
      'La main gauche du ragtime : une basse grave sur le temps, un accord médium sur le contretemps (« oum-pa »). Visez sans regarder en gardant la main proche des touches.',
    tags: ['stride', 'main gauche', 'sauts'],
    tracks: {
      R: 'E4:2 | G4:2 | A4:2 | F4:2 | G4:2 | B4:2 | D5:2 | C5:2',
      L: 'C2:1 E3+G3+C4:1 | G2:1 E3+G3+C4:1 | F2:1 F3+A3+C4:1 | C2:1 F3+A3+C4:1 | C2:1 E3+G3+C4:1 | G2:1 F3+G3+B3:1 | D2:1 F3+G3+B3:1 | C2:1 E3+G3+C4:1',
    },
  },
  {
    id: 'petit-rag',
    title: 'Petit rag du dimanche',
    composer: 'Composition originale',
    genre: 'ragtime',
    level: 4,
    tempo: 80,
    timeSig: [2, 4],
    keyFifths: 0,
    description:
      'La syncope typique du ragtime (double croche – croche – double croche) sur une main gauche stride en croches. Ne vous pressez pas : « It is never right to play ragtime fast », disait Joplin.',
    tags: ['syncope', 'stride', 'ragtime'],
    tracks: {
      R: 'E5:0.25 G5:0.5 E5:0.25 C5:0.5 E5:0.5 | G4:0.25 C5:0.5 E5:0.25 G5:1 | F5:0.25 D5:0.5 B4:0.25 G4:0.5 B4:0.5 | C5:1 r:1 | A4:0.25 C5:0.5 F5:0.25 A5:0.5 F5:0.5 | E5:0.25 G5:0.5 E5:0.25 C5:1 | D5:0.25 F5:0.5 B4:0.25 D5:0.5 G4:0.5 | C5:0.5 G4:0.5 C5:1',
      L: (() => {
        const C = 'C2:0.5 E3+G3+C4:0.5 G2:0.5 E3+G3+C4:0.5';
        const G7 = 'G2:0.5 F3+B3+D4:0.5 D2:0.5 F3+B3+D4:0.5';
        const F = 'F2:0.5 F3+A3+C4:0.5 C2:0.5 F3+A3+C4:0.5';
        return [C, C, G7, C, F, C, G7, 'C2:0.5 E3+G3+C4:0.5 C2+C3:1'].join(' | ');
      })(),
    },
  },
  {
    id: 'entertainer',
    title: 'The Entertainer (thème, simplifié)',
    composer: 'Scott Joplin',
    genre: 'ragtime',
    level: 5,
    tempo: 76,
    timeSig: [2, 4],
    keyFifths: 0,
    pickupBeats: 0.5,
    description:
      'Le rag le plus célèbre de Joplin (1902). Mélodie syncopée à la main droite, stride « oum-pa » à la main gauche. Travaillez d’abord la main droite seule, très lentement, en comptant les doubles croches.',
    tags: ['Joplin', 'syncope', 'stride'],
    tracks: {
      R: 'r:1.5 D4:0.25 D#4:0.25 | E4:0.25 C5:0.5 E4:0.25 C5:0.5 E4:0.25 C5:1.5 C5:0.25 D5:0.25 D#5:0.25 | E5:0.25 C5:0.25 D5:0.25 E5:0.5 B4:0.25 D5:0.5 | C5:1.5 D4:0.25 D#4:0.25 | E4:0.25 C5:0.5 E4:0.25 C5:0.5 E4:0.25 C5:1.5 C5:0.25 D5:0.25 D#5:0.25 | E5:0.25 C5:0.25 D5:0.25 E5:0.5 B4:0.25 D5:0.5 | C5:2',
      L: 'r:2 | C2:1 E3+G3+C4:1 | G2:1 E3+Bb3+C4:1 | G2:1 F3+G3+B3:1 | C2:1 E3+G3+C4:1 | C2:1 E3+G3+C4:1 | G2:1 E3+Bb3+C4:1 | G2:1 F3+G3+B3:1 | C2:1 E3+G3+C4:1',
    },
  },

  // ===================== POP & ACCORDS (compositions originales) =====================
  {
    id: 'quatre-accords',
    title: 'Les quatre accords (I–V–vi–IV)',
    composer: 'Exercice original',
    genre: 'pop',
    level: 2,
    tempo: 80,
    timeSig: [4, 4],
    keyFifths: 0,
    description:
      'Do – Sol – Lam – Fa : la grille de centaines de chansons pop. Les accords sont renversés pour que la main droite bouge à peine. D’abord en rondes, puis en noires régulières.',
    tags: ['grille', 'renversements', 'accords'],
    tracks: {
      R: 'C4+E4+G4:4:1+3+5 | B3+D4+G4:4:1+2+5 | C4+E4+A4:4:1+2+5 | C4+F4+A4:4:1+3+5 | ' +
        ['C4+E4+G4:1:1+3+5', 'B3+D4+G4:1:1+2+5', 'C4+E4+A4:1:1+2+5', 'C4+F4+A4:1:1+3+5'].map((c) => `${c} ${c} ${c} ${c}`).join(' | '),
      L: rep('C3:4:1 | G2:4:4 | A2:4:3 | F2:4:5', 2),
    },
  },
  {
    id: 'valse-accords',
    title: 'Valse des accords',
    composer: 'Composition originale',
    genre: 'pop',
    level: 3,
    tempo: 120,
    timeSig: [3, 4],
    keyFifths: 0,
    description:
      'Une petite valse sur la grille Do – Lam – Fa – Sol. Main gauche « oum-pa-pa » : basse appuyée, accords légers sur les temps 2 et 3.',
    tags: ['valse', '3/4', 'accompagnement'],
    tracks: {
      R: 'E5:2 G5:1 | E5:2 C5:1 | C5:2 A4:1 | B4:2 D5:1 | E5:2 G5:1 | A5:2 E5:1 | F5:1 E5:1 D5:1 | D5:2 B4:1 | C5:3',
      L: (() => {
        const C = 'C3:1 E3+G3:1 E3+G3:1', Am = 'A2:1 C3+E3:1 C3+E3:1', F = 'F2:1 A2+C3:1 A2+C3:1', G = 'G2:1 B2+D3:1 B2+D3:1';
        return [C, Am, F, G, C, Am, F, G, 'C3:1 E3+G3:2'].join(' | ');
      })(),
    },
  },
  {
    id: 'pluie-automne',
    title: 'Pluie d’automne (ballade)',
    composer: 'Composition originale',
    genre: 'pop',
    level: 3,
    tempo: 72,
    timeSig: [4, 4],
    keyFifths: 0,
    keyMode: 'minor',
    description:
      'Ballade en La mineur sur la grille Lam – Fa – Do – Sol. La main gauche déroule des arpèges « fondamentale-quinte-octave » : jouez-les legato avec la pédale, et faites chanter la mélodie au-dessus.',
    tags: ['ballade', 'arpèges', 'pédale', 'mineur'],
    tracks: {
      R: 'A4:1 C5:1 E5:1.5 D5:0.5 | C5:2 A4:1 C5:1 | G4:1 C5:1 E5:1.5 D5:0.5 | D5:3 r:1 | A4:1 C5:1 E5:1.5 F5:0.5 | E5:1 D5:1 C5:1 A4:1 | G4:1 E5:1 D5:1.5 C5:0.5 | B4:2 D5:2 | A4:4',
      L: (() => {
        const arp = (a, b, c) => `${a}:0.5 ${b}:0.5 ${c}:0.5 ${b}:0.5 ${a}:0.5 ${b}:0.5 ${c}:0.5 ${b}:0.5`;
        const Am = arp('A2', 'E3', 'A3'), F = arp('F2', 'C3', 'F3'), C = arp('C3', 'G3', 'C4'), G = arp('G2', 'D3', 'G3');
        return [Am, F, C, G, Am, F, C, G, 'A2+E3+A3:4'].join(' | ');
      })(),
    },
  },
  {
    id: 'rythme-pop',
    title: 'Rythme 3-3-2',
    composer: 'Exercice original',
    genre: 'pop',
    level: 3,
    tempo: 92,
    timeSig: [4, 4],
    keyFifths: 0,
    keyMode: 'minor',
    description:
      'Le rythme d’accompagnement le plus utilisé en pop : trois croches + trois croches + deux croches (1 - - 4 - - 7 -). Comptez « 1 et 2 et 3 et 4 et » et accentuez les attaques.',
    tags: ['rythme', 'syncope', 'accompagnement', 'grille'],
    tracks: {
      R: rep(
        ['A4+C5+E5', 'A4+C5+F5', 'G4+C5+E5', 'G4+B4+D5'].map((c) => `${c}:1.5 ${c}:1.5 ${c}:1`).join(' | '),
        2,
      ) + ' | A4+C5+E5:4',
      L: 'A2:4 | F2:4 | C3:4 | G2:4 | ' +
        ['A2+A3', 'F2+F3', 'C3+C4', 'G2+G3'].map((c) => `${c}:1.5 ${c}:1.5 ${c}:1`).join(' | ') +
        ' | A2+A3:4',
    },
  },

  // ===================== TECHNIQUE =====================
  {
    id: 'echauffement',
    title: 'Échauffement à cinq doigts',
    composer: 'Exercice original',
    genre: 'technique',
    level: 1,
    tempo: 72,
    timeSig: [4, 4],
    keyFifths: 0,
    description:
      'Deux minutes pour réveiller les doigts : les deux mains jouent la même chose à une octave d’écart (mouvement parallèle), d’abord en noires puis en croches.',
    tags: ['échauffement', 'mains ensemble', 'indépendance'],
    tracks: {
      R: 'C4:1:1 D4:1:2 E4:1:3 F4:1:4 | G4:1:5 F4:1:4 E4:1:3 D4:1:2 | C4:1:1 E4:1:3 G4:1:5 E4:1:3 | C4:4:1 | C4:0.5:1 D4:0.5:2 E4:0.5:3 F4:0.5:4 G4:0.5:5 F4:0.5:4 E4:0.5:3 D4:0.5:2 | C4:0.5:1 D4:0.5:2 E4:0.5:3 F4:0.5:4 G4:0.5:5 F4:0.5:4 E4:0.5:3 D4:0.5:2 | C4:0.5:1 E4:0.5:3 G4:0.5:5 E4:0.5:3 C4:2:1',
      L: 'C3:1:5 D3:1:4 E3:1:3 F3:1:2 | G3:1:1 F3:1:2 E3:1:3 D3:1:4 | C3:1:5 E3:1:3 G3:1:1 E3:1:3 | C3:4:5 | C3:0.5:5 D3:0.5:4 E3:0.5:3 F3:0.5:2 G3:0.5:1 F3:0.5:2 E3:0.5:3 D3:0.5:4 | C3:0.5:5 D3:0.5:4 E3:0.5:3 F3:0.5:2 G3:0.5:1 F3:0.5:2 E3:0.5:3 D3:0.5:4 | C3:0.5:5 E3:0.5:3 G3:0.5:1 E3:0.5:3 C3:2:5',
    },
  },
  {
    id: 'gamme-do',
    title: 'Gamme de Do majeur (2 octaves)',
    composer: 'Exercice',
    genre: 'technique',
    level: 2,
    tempo: 60,
    timeSig: [4, 4],
    keyFifths: 0,
    description:
      'Doigté main droite 1-2-3 / 1-2-3-4 (le pouce passe après le Mi et après le Si) ; main gauche 5-4-3-2-1 / 3-2-1. Travaillez mains séparées, puis ensemble.',
    tags: ['gamme', 'passage du pouce', 'Do majeur'],
    tracks: { R: scaleTrack('C4', {}, RH_SCALE), L: scaleTrack('C3', {}, LH_SCALE) },
  },
  {
    id: 'gamme-sol',
    title: 'Gamme de Sol majeur (2 octaves)',
    composer: 'Exercice',
    genre: 'technique',
    level: 2,
    tempo: 60,
    timeSig: [4, 4],
    keyFifths: 1,
    description:
      'Même doigté que Do majeur, avec un Fa dièse joué par le 4e doigt à la main droite et le 2e doigt à la main gauche.',
    tags: ['gamme', 'Sol majeur', 'dièse'],
    tracks: { R: scaleTrack('G3', { F: '#' }, RH_SCALE), L: scaleTrack('G2', { F: '#' }, LH_SCALE) },
  },
  {
    id: 'gamme-re',
    title: 'Gamme de Ré majeur (2 octaves)',
    composer: 'Exercice',
    genre: 'technique',
    level: 3,
    tempo: 60,
    timeSig: [4, 4],
    keyFifths: 2,
    description:
      'Deux dièses : Fa♯ et Do♯. Doigté identique à Do majeur ; le pouce ne se pose jamais sur une touche noire.',
    tags: ['gamme', 'Ré majeur', 'dièses'],
    tracks: { R: scaleTrack('D4', { F: '#', C: '#' }, RH_SCALE), L: scaleTrack('D3', { F: '#', C: '#' }, LH_SCALE) },
  },
  {
    id: 'gamme-fa',
    title: 'Gamme de Fa majeur (2 octaves)',
    composer: 'Exercice',
    genre: 'technique',
    level: 3,
    tempo: 60,
    timeSig: [4, 4],
    keyFifths: -1,
    description:
      'Attention, doigté particulier à la main droite : 1-2-3-4 (le 4 sur le Si♭) puis 1-2-3. La main gauche garde le doigté habituel 5-4-3-2-1 / 3-2-1.',
    tags: ['gamme', 'Fa majeur', 'bémol'],
    tracks: { R: scaleTrack('F3', { B: 'b' }, RH_SCALE_F), L: scaleTrack('F2', { B: 'b' }, LH_SCALE) },
  },
  {
    id: 'gamme-la-mineur',
    title: 'Gamme de La mineur harmonique (2 octaves)',
    composer: 'Exercice',
    genre: 'technique',
    level: 3,
    tempo: 60,
    timeSig: [4, 4],
    keyFifths: 0,
    keyMode: 'minor',
    description:
      'La relative mineure de Do, avec le Sol dièse (sensible) qui crée l’intervalle « oriental » Fa–Sol♯. Doigté identique à Do majeur.',
    tags: ['gamme', 'mineur harmonique', 'La mineur'],
    tracks: { R: scaleTrack('A3', { G: '#' }, RH_SCALE), L: scaleTrack('A2', { G: '#' }, LH_SCALE) },
  },
  {
    id: 'gamme-mi-mineur',
    title: 'Gamme de Mi mineur harmonique (2 octaves)',
    composer: 'Exercice',
    genre: 'technique',
    level: 3,
    tempo: 60,
    timeSig: [4, 4],
    keyFifths: 1,
    keyMode: 'minor',
    description:
      'Relative mineure de Sol : Fa♯ à l’armure et Ré♯ ajouté comme sensible. Même doigté que Do majeur aux deux mains.',
    tags: ['gamme', 'mineur harmonique', 'Mi mineur'],
    tracks: { R: scaleTrack('E4', { F: '#', D: '#' }, RH_SCALE), L: scaleTrack('E3', { F: '#', D: '#' }, LH_SCALE) },
  },
  {
    id: 'gamme-chromatique',
    title: 'Gamme chromatique',
    composer: 'Exercice',
    genre: 'technique',
    level: 4,
    tempo: 60,
    timeSig: [4, 4],
    keyFifths: 0,
    description:
      'Toutes les touches, blanches et noires. Règle simple : pouce sur les touches blanches, majeur (3) sur les noires, et 1-2 (ou 2-1) entre Mi-Fa et Si-Do.',
    tags: ['chromatique', 'doigtés', 'régularité'],
    tracks: {
      R: 'C4:0.5:1 C#4:0.5:3 D4:0.5:1 D#4:0.5:3 E4:0.5:1 F4:0.5:2 F#4:0.5:3 G4:0.5:1 | G#4:0.5:3 A4:0.5:1 A#4:0.5:3 B4:0.5:1 C5:0.5:2 B4:0.5:1 Bb4:0.5:3 A4:0.5:1 | Ab4:0.5:3 G4:0.5:1 Gb4:0.5:3 F4:0.5:2 E4:0.5:1 Eb4:0.5:3 D4:0.5:1 Db4:0.5:3 | C4:4:1',
      L: 'C3:0.5:1 C#3:0.5:3 D3:0.5:1 D#3:0.5:3 E3:0.5:2 F3:0.5:1 F#3:0.5:3 G3:0.5:1 | G#3:0.5:3 A3:0.5:1 A#3:0.5:3 B3:0.5:2 C4:0.5:1 B3:0.5:2 Bb3:0.5:3 A3:0.5:1 | Ab3:0.5:3 G3:0.5:1 Gb3:0.5:3 F3:0.5:1 E3:0.5:2 Eb3:0.5:3 D3:0.5:1 Db3:0.5:3 | C3:4:1',
    },
  },
  {
    id: 'hanon-1',
    title: 'Hanon n°1 (sur une octave)',
    composer: 'Charles-Louis Hanon',
    genre: 'technique',
    level: 3,
    tempo: 60,
    timeSig: [2, 4],
    keyFifths: 0,
    description:
      'Le premier exercice du « Pianiste virtuose » : un motif de 8 notes qui monte puis redescend degré par degré. Doigts recourbés, chaque note bien articulée, tempo lent et parfaitement régulier.',
    tags: ['Hanon', 'agilité', 'indépendance des doigts'],
    tracks: {
      R: hanonTrack(0, [1, 2, 3, 4, 5, 4, 3, 2], [5, 4, 3, 2, 1, 2, 3, 4], 2),
      L: hanonTrack(-1, [5, 4, 3, 2, 1, 2, 3, 4], [1, 2, 3, 4, 5, 4, 3, 2], 4),
    },
  },
  {
    id: 'arpeges-do-la',
    title: 'Arpèges de Do majeur et La mineur',
    composer: 'Exercice',
    genre: 'technique',
    level: 4,
    tempo: 60,
    timeSig: [4, 4],
    keyFifths: 0,
    description:
      'Les notes de l’accord égrenées sur deux octaves. Main droite 1-2-3 puis passage du pouce ; main gauche 5-4-2-1 puis 4-2-1. Le poignet glisse latéralement, le coude suit.',
    tags: ['arpèges', 'passage du pouce', 'accords'],
    tracks: {
      R: 'C4:0.5:1 E4:0.5:2 G4:0.5:3 C5:0.5:1 E5:0.5:2 G5:0.5:3 C6:0.5:5 G5:0.5:3 | E5:0.5:2 C5:0.5:1 G4:0.5:3 E4:0.5:2 C4:2:1 | A3:0.5:1 C4:0.5:2 E4:0.5:3 A4:0.5:1 C5:0.5:2 E5:0.5:3 A5:0.5:5 E5:0.5:3 | C5:0.5:2 A4:0.5:1 E4:0.5:3 C4:0.5:2 A3:2:1',
      L: 'C2:0.5:5 E2:0.5:4 G2:0.5:2 C3:0.5:1 E3:0.5:4 G3:0.5:2 C4:0.5:1 G3:0.5:2 | E3:0.5:4 C3:0.5:1 G2:0.5:2 E2:0.5:4 C2:2:5 | A1:0.5:5 C2:0.5:4 E2:0.5:2 A2:0.5:1 C3:0.5:4 E3:0.5:2 A3:0.5:1 E3:0.5:2 | C3:0.5:4 A2:0.5:1 E2:0.5:2 C2:0.5:4 A1:2:5',
    },
  },
  {
    id: 'renversements',
    title: 'Accords parfaits et renversements',
    composer: 'Exercice',
    genre: 'technique',
    level: 3,
    tempo: 66,
    timeSig: [4, 4],
    keyFifths: 0,
    description:
      'Do, Fa et Sol majeurs : position fondamentale, 1er et 2e renversement, en montant puis en redescendant. Doigté 1-3-5 pour la fondamentale et le 2e renversement, 1-2-5 pour le 1er renversement.',
    tags: ['accords', 'renversements', 'triades'],
    tracks: {
      R: (() => {
        const run = (a, b, c, d) =>
          `${a}:2:1+3+5 ${b}:2:1+2+5 | ${c}:2:1+3+5 ${d}:2:1+3+5 | ${c}:2:1+3+5 ${b}:2:1+2+5 | ${a}:4:1+3+5`;
        return [
          run('C4+E4+G4', 'E4+G4+C5', 'G4+C5+E5', 'C5+E5+G5'),
          run('F4+A4+C5', 'A4+C5+F5', 'C5+F5+A5', 'F5+A5+C6'),
          run('G4+B4+D5', 'B4+D5+G5', 'D5+G5+B5', 'G5+B5+D6'),
          'C4+E4+G4:4:1+3+5',
        ].join(' | ');
      })(),
      L: rep('C3:4:5', 4) + ' | ' + rep('F2:4:5', 4) + ' | ' + rep('G2:4:5', 4) + ' | C3:4:5',
    },
  },

  // ===================== AJOUTS : DOMAINE PUBLIC (arrangements originaux) =====================
  // Sources et statut juridique : docs/SOURCES.md
  {
    id: 'petits-pains-chauds',
    title: 'Petits pains chauds (Hot Cross Buns)',
    composer: 'Traditionnel anglais',
    genre: 'debutant',
    level: 1,
    tempo: 84,
    timeSig: [4, 4],
    keyFifths: 0,
    description:
      'Trois notes seulement : Mi-Ré-Do avec les doigts 3-2-1. La troisième mesure passe aux croches : comptez « 1 et 2 et » et gardez les Do et les Ré bien égaux.',
    tags: ['3 notes', 'croches', 'position de Do'],
    tracks: {
      R: 'E4:1:3 D4:1:2 C4:2:1 | E4:1:3 D4:1:2 C4:2:1 | C4:0.5:1 C4:0.5:1 C4:0.5:1 C4:0.5:1 D4:0.5:2 D4:0.5:2 D4:0.5:2 D4:0.5:2 | E4:1:3 D4:1:2 C4:2:1',
      L: 'C3+G3:4:5+1 | C3+G3:4:5+1 | C3:2:5 G3:2:1 | C3+G3:4:5+1',
    },
  },
  {
    id: 'petits-canards',
    title: 'Tous mes petits canards (Alle meine Entchen)',
    composer: 'Traditionnel allemand',
    genre: 'debutant',
    level: 1,
    tempo: 88,
    timeSig: [4, 4],
    keyFifths: 0,
    description:
      'La comptine allemande la plus connue. Nouveauté : on change de doigt sur une note répétée (Sol joué 5 puis 4, Fa joué 3 puis 4) pour déplacer la main d’une touche sans aucun saut.',
    tags: ['changement de doigt', 'notes répétées', 'position de Do'],
    tracks: {
      R: 'C4:1:1 D4:1:2 E4:1:3 F4:1:4 | G4:2:5 G4:2:4 | A4:1:5 A4:1:5 A4:1:5 A4:1:5 | G4:4:4 | A4:1:5 A4:1:5 A4:1:5 A4:1:5 | G4:4:4 | F4:1:3 F4:1:3 F4:1:3 F4:1:4 | E4:2:3 E4:2:3 | D4:1:2 D4:1:2 D4:1:2 D4:1:2 | C4:4:1',
      L: 'C3+G3:4:5+1 | C3+G3:4:5+1 | C3+F3:4:5+2 | C3+E3:4:5+3 | C3+F3:4:5+2 | C3+E3:4:5+3 | G3:4:1 | C3+G3:4:5+1 | G3:4:1 | C3:4:5',
    },
  },
  {
    id: 'marie-agneau',
    title: 'Marie avait un petit agneau',
    composer: 'Traditionnel américain (air attribué à Lowell Mason)',
    genre: 'comptines',
    level: 1,
    tempo: 96,
    timeSig: [4, 4],
    keyFifths: 0,
    description:
      '« Mary Had a Little Lamb » : une mélodie en vagues sur Do-Ré-Mi, avec un seul petit saut vers le Sol (doigt 5). La main gauche alterne Do et Sol.',
    tags: ['chanson', 'position de Do', 'notes répétées'],
    tracks: {
      R: 'E4:1:3 D4:1:2 C4:1:1 D4:1:2 | E4:1:3 E4:1:3 E4:2:3 | D4:1:2 D4:1:2 D4:2:2 | E4:1:3 G4:1:5 G4:2:5 | E4:1:3 D4:1:2 C4:1:1 D4:1:2 | E4:1:3 E4:1:3 E4:1:3 E4:1:3 | D4:1:2 D4:1:2 E4:1:3 D4:1:2 | C4:4:1',
      L: 'C3+G3:4:5+1 | C3+G3:4:5+1 | G3:4:1 | C3+G3:4:5+1 | C3+G3:4:5+1 | C3+G3:4:5+1 | G3:4:1 | C3:4:5',
    },
  },
  {
    id: 'pont-de-londres',
    title: 'Le pont de Londres (London Bridge)',
    composer: 'Traditionnel anglais',
    genre: 'comptines',
    level: 1,
    tempo: 96,
    timeSig: [4, 4],
    keyFifths: 0,
    description:
      'Position de Ré (pouce sur Ré, auriculaire sur La) ; à la toute fin, le pouce s’étire jusqu’au Do. Le premier temps est pointé : « taaa-ta ».',
    tags: ['chanson', 'rythme pointé', 'extension du pouce'],
    tracks: {
      R: 'G4:1.5:4 A4:0.5:5 G4:1:4 F4:1:3 | E4:1:2 F4:1:3 G4:2:4 | D4:1:1 E4:1:2 F4:2:3 | E4:1:2 F4:1:3 G4:2:4 | G4:1.5:4 A4:0.5:5 G4:1:4 F4:1:3 | E4:1:2 F4:1:3 G4:2:4 | D4:2:1 G4:2:4 | E4:1:2 C4:3:1',
      L: 'C3+G3:4:5+1 | C3+G3:4:5+1 | G3:4:1 | C3+G3:4:5+1 | C3+G3:4:5+1 | C3+G3:4:5+1 | G3:4:1 | C3+G3:4:5+1',
    },
  },
  {
    id: 'petit-jean',
    title: 'Petit Jean (Hänschen klein)',
    composer: 'Traditionnel allemand',
    genre: 'comptines',
    level: 1,
    tempo: 100,
    timeSig: [4, 4],
    keyFifths: 0,
    description:
      'Une chanson entièrement en position de Do, avec des tierces (Sol-Mi, Fa-Ré) qui sautent une touche. La partie du milieu répète Ré puis Mi quatre fois : gardez un son bien égal.',
    tags: ['chanson', 'position de Do', 'tierces'],
    tracks: {
      R: 'G4:1:5 E4:1:3 E4:2:3 | F4:1:4 D4:1:2 D4:2:2 | C4:1:1 D4:1:2 E4:1:3 F4:1:4 | G4:1:5 G4:1:5 G4:2:5 | G4:1:5 E4:1:3 E4:2:3 | F4:1:4 D4:1:2 D4:2:2 | C4:1:1 E4:1:3 G4:1:5 G4:1:5 | C4:4:1 | D4:1:2 D4:1:2 D4:1:2 D4:1:2 | D4:1:2 E4:1:3 F4:2:4 | E4:1:3 E4:1:3 E4:1:3 E4:1:3 | E4:1:3 F4:1:4 G4:2:5 | G4:1:5 E4:1:3 E4:2:3 | F4:1:4 D4:1:2 D4:2:2 | C4:1:1 E4:1:3 G4:1:5 G4:1:5 | C4:4:1',
      L: 'C3+G3:4:5+1 | G3:4:1 | C3:4:5 | C3+E3:4:5+3 | C3+G3:4:5+1 | G3:4:1 | C3+E3:4:5+3 | C3:4:5 | G3:4:1 | G3:4:1 | C3+G3:4:5+1 | C3+E3:4:5+3 | C3+G3:4:5+1 | G3:4:1 | C3+E3:4:5+3 | C3:4:5',
    },
  },
  {
    id: 'ferme-mathurin',
    title: 'Dans la ferme de Mathurin',
    composer: 'Traditionnel (air de « Old MacDonald »)',
    genre: 'comptines',
    level: 1,
    tempo: 100,
    timeSig: [4, 4],
    keyFifths: 1,
    description:
      'Une position à cinq doigts un peu spéciale : Ré-Mi-Sol-La-Si (on saute le Fa♯), pouce sur Ré. Le pouce n’a jamais besoin de bouger !',
    tags: ['chanson', 'Sol majeur', 'pentatonique'],
    tracks: {
      R: 'G4:1:3 G4:1:3 G4:1:3 D4:1:1 | E4:1:2 E4:1:2 D4:2:1 | B4:1:5 B4:1:5 A4:1:4 A4:1:4 | G4:3:3 D4:1:1 | G4:1:3 G4:1:3 G4:1:3 D4:1:1 | E4:1:2 E4:1:2 D4:2:1 | B4:1:5 B4:1:5 A4:1:4 A4:1:4 | G4:4:3',
      L: 'G2:4:5 | C3:2:2 G2:2:5 | D3:4:1 | G2:4:5 | G2:4:5 | C3:2:2 G2:2:5 | D3:4:1 | G2:4:5',
    },
  },
  {
    id: 'rame-doucement',
    title: 'Rame, rame doucement (Row, Row, Row Your Boat)',
    composer: 'Eliphalet Oram Lyte (1842-1913)',
    genre: 'comptines',
    level: 2,
    tempo: 96,
    timeSig: [6, 8],
    keyFifths: 0,
    description:
      'Une barcarolle en 6/8 : deux grands temps qui se balancent. Après la note longue, la main monte (pouce sur Sol) pour les triolets de croches, puis le 3e doigt passe par-dessus le pouce pour revenir en position de Do.',
    tags: ['6/8', 'canon', 'passage du 3e doigt'],
    tracks: {
      R: 'C4:1.5:1 C4:1.5:1 | C4:1:1 D4:0.5:2 E4:1.5:3 | E4:1:3 D4:0.5:2 E4:1:3 F4:0.5:4 | G4:3:5 | C5:0.5:4 C5:0.5:4 C5:0.5:4 G4:0.5:1 G4:0.5:1 G4:0.5:1 | E4:0.5:3 E4:0.5:3 E4:0.5:3 C4:0.5:1 C4:0.5:1 C4:0.5:1 | G4:1:5 F4:0.5:4 E4:1:3 D4:0.5:2 | C4:3:1',
      L: 'C3+G3:3:5+1 | C3+G3:3:5+1 | C3+G3:3:5+1 | C3+G3:3:5+1 | C3+G3:3:5+1 | C3+G3:3:5+1 | G3:3:1 | C3+G3:3:5+1',
    },
  },
  {
    id: 'drunken-sailor',
    title: 'Drunken Sailor (chant de marins)',
    composer: 'Traditionnel (shanty anglo-irlandais)',
    genre: 'folk',
    level: 2,
    tempo: 104,
    timeSig: [4, 4],
    keyFifths: 0,
    description:
      'Un chant de marins en mode de Ré dorien (Ré mineur avec un Si naturel). Les notes répétées « noire – deux croches » doivent rester légères ; la main gauche alterne les quintes Ré-La et Do-Sol.',
    tags: ['mode dorien', 'chant de marins', 'notes répétées'],
    tracks: {
      R: 'A4:1:5 A4:0.5:5 A4:0.5:5 A4:1:5 A4:0.5:5 A4:0.5:5 | A4:1:5 D4:1:1 F4:1:3 A4:1:5 | G4:1:4 G4:0.5:4 G4:0.5:4 G4:1:4 G4:0.5:4 G4:0.5:4 | G4:1:5 C4:1:1 E4:1:3 G4:1:5 | A4:1:2 A4:0.5:2 A4:0.5:2 A4:1:2 A4:0.5:2 A4:0.5:2 | A4:1:2 B4:1:3 C5:1:4 D5:1:5 | C5:1:4 A4:1:2 G4:1:1 E4:1:3 | D4:2:2 D4:2:2',
      L: 'D3+A3:4:5+1 | D3+A3:4:5+1 | C3+G3:4:5+1 | C3+G3:4:5+1 | D3+A3:4:5+1 | D3+A3:4:5+1 | C3+G3:4:5+1 | D3+A3:4:5+1',
    },
  },
  {
    id: 'korobeiniki',
    title: 'Korobeïniki (Les colporteurs)',
    composer: 'Traditionnel russe',
    genre: 'folk',
    level: 3,
    tempo: 120,
    timeSig: [4, 4],
    keyFifths: 0,
    keyMode: 'minor',
    description:
      'Une chanson populaire russe du XIXe siècle, en La mineur, devenue célèbre dans le monde entier. Rythme « noire pointée – croche » et croches bien égales ; la main gauche marque la basse en blanches.',
    tags: ['russe', 'mineur', 'rythme pointé'],
    tracks: {
      R: 'E5:1 B4:0.5 C5:0.5 D5:1 C5:0.5 B4:0.5 | A4:1 A4:0.5 C5:0.5 E5:1 D5:0.5 C5:0.5 | B4:1.5 C5:0.5 D5:1 E5:1 | C5:1 A4:1 A4:2 | D5:1.5 F5:0.5 A5:1 G5:0.5 F5:0.5 | E5:1.5 C5:0.5 E5:1 D5:0.5 C5:0.5 | B4:1 B4:0.5 C5:0.5 D5:1 E5:1 | C5:1 A4:1 A4:2',
      L: 'E2:2 B2:2 | A2:2 E3:2 | E2:2 B2:2 | A2:2 E3:2 | D3:2 A3:2 | C3:2 G3:2 | E2:2 B2:2 | A2+E3:4',
    },
  },
  {
    id: 'nous-vous-souhaitons',
    title: 'Nous vous souhaitons un joyeux Noël',
    composer: 'Traditionnel anglais (« We Wish You a Merry Christmas »)',
    genre: 'noel',
    level: 2,
    tempo: 120,
    timeSig: [3, 4],
    keyFifths: 1,
    pickupBeats: 1,
    description:
      'Une valse de Noël en Sol majeur qui commence par une levée. Chaque phrase monte d’un cran (Sol, puis La, puis Si) : la main se déplace d’une touche à chaque fois, préparez-la pendant les noires.',
    tags: ['Noël', '3/4', 'levée', 'séquence'],
    tracks: {
      R: 'r:2 D4:1:1 | G4:1:4 G4:0.5:4 A4:0.5:5 G4:0.5:4 F#4:0.5:3 | E4:1:2 E4:1:2 E4:1:2 | A4:1:4 A4:0.5:4 B4:0.5:5 A4:0.5:4 G4:0.5:3 | F#4:1:2 D4:1:1 D4:1:1 | B4:1:3 B4:0.5:3 C5:0.5:4 B4:0.5:3 A4:0.5:2 | G4:1:1 E4:1:3 D4:0.5:2 D4:0.5:2 | E4:1:3 A4:1:5 F#4:1:4 | G4:2:5 r:1',
      L: 'r:3 | G2+D3:3:5+1 | C3+G3:3:5+1 | A2+E3:3:5+1 | D3+A3:3:5+1 | B2+F#3:3:5+1 | E3+B3:3:5+1 | C3+G3:1:5+1 D3+A3:2:5+1 | G2+D3:2:5+1 r:1',
    },
  },
  {
    id: 'bon-roi-venceslas',
    title: 'Le bon roi Venceslas (Good King Wenceslas)',
    composer: 'Traditionnel (air « Tempus adest floridum », Piae Cantiones, 1582)',
    genre: 'noel',
    level: 2,
    tempo: 96,
    timeSig: [4, 4],
    keyFifths: 1,
    description:
      'Un chant de Noël anglais sur un air médiéval, tout en noires et blanches. Deux positions : Ré-Mi-Fa♯-Sol-La (pouce sur Ré) et Sol-La-Si-Do-Ré (pouce sur Sol) ; changez de position pendant les blanches.',
    tags: ['Noël', 'changement de position', 'Sol majeur'],
    tracks: {
      R: 'G4:1:4 G4:1:4 G4:1:4 A4:1:5 | G4:1:4 G4:1:4 D4:2:1 | E4:1:2 D4:1:1 E4:1:2 F#4:1:3 | G4:2:4 G4:2:4 | G4:1:4 G4:1:4 G4:1:4 A4:1:5 | G4:1:4 G4:1:4 D4:2:1 | E4:1:2 D4:1:1 E4:1:2 F#4:1:3 | G4:2:4 G4:2:4 | D5:1:5 C5:1:4 B4:1:3 A4:1:2 | B4:1:3 A4:1:2 G4:2:1 | E4:1:2 D4:1:1 E4:1:2 F#4:1:3 | G4:2:4 G4:2:4 | D4:1:1 D4:1:1 E4:1:2 F#4:1:3 | G4:1:4 G4:1:4 A4:2:5 | D5:1:5 C5:1:4 B4:1:3 A4:1:2 | G4:2:1 C5:2:4 | G4:4:1',
      L: 'G2:4:5 | G2:2:5 B2:2:3 | C3:2:2 D3:2:1 | G2:4:5 | G2:4:5 | G2:2:5 B2:2:3 | C3:2:2 D3:2:1 | G2:4:5 | G2:2:5 D3:2:1 | G2:4:5 | C3:2:2 D3:2:1 | G2:4:5 | D3:4:1 | G2:2:5 D3:2:1 | G2:2:5 D3:2:1 | G2:2:5 C3:2:2 | G2:4:5',
    },
  },
  {
    id: 'anges-campagnes',
    title: 'Les anges dans nos campagnes',
    composer: 'Noël traditionnel français',
    genre: 'noel',
    level: 3,
    tempo: 92,
    timeSig: [4, 4],
    keyFifths: -1,
    description:
      'Le célèbre « Gloria » en Fa majeur : un long mélisme de croches qui descend en séquence, mesure après mesure. Travaillez le refrain seul, en écoutant que chaque groupe de quatre croches reste égal.',
    tags: ['Noël', 'Fa majeur', 'séquence', 'croches'],
    tracks: {
      R: rep('A4:1 A4:1 A4:1 C5:1 | C5:1.5 Bb4:0.5 A4:2 | A4:1 G4:1 A4:1 C5:1 | A4:1.5 G4:0.5 F4:2', 2) +
        ' | ' + rep('C5:2 D5:0.5 C5:0.5 Bb4:0.5 A4:0.5 | Bb4:2 C5:0.5 Bb4:0.5 A4:0.5 G4:0.5 | A4:2 Bb4:0.5 A4:0.5 G4:0.5 F4:0.5 | G4:1.5 C4:0.5 C4:2 | F4:1 G4:1 A4:1 Bb4:1 | A4:2 G4:2', 2) +
        ' | F4:4',
      L: rep('F2+C3:4 | F2+C3:4 | F2+C3:4 | F2+C3:1 C3+G3:1 F2+C3:2', 2) +
        ' | ' + rep('F2+C3:4 | Bb2+F3:4 | F2+C3:4 | C3+G3:4 | F2+C3:3 Bb2+F3:1 | F2+C3:2 C3+G3:2', 2) +
        ' | F2+C3:4',
    },
  },
  {
    id: 'roi-montagne',
    title: 'Dans l’antre du roi de la montagne (thème)',
    composer: 'Edvard Grieg',
    genre: 'classique',
    level: 3,
    tempo: 100,
    timeSig: [4, 4],
    keyFifths: 0,
    keyMode: 'minor',
    description:
      'Le thème de « Peer Gynt » (1875), transposé en La mineur. Croches détachées et mystérieuses, main gauche en quintes piquées. Grieg accélère jusqu’à la frénésie : à vous de pousser le tempo petit à petit !',
    tags: ['Grieg', 'romantique', 'staccato', 'mineur'],
    tracks: {
      R: rep('A4:0.5 B4:0.5 C5:0.5 D5:0.5 E5:0.5 C5:0.5 E5:1 | D#5:0.5 B4:0.5 D#5:1 D5:0.5 Bb4:0.5 D5:1 | A4:0.5 B4:0.5 C5:0.5 D5:0.5 E5:0.5 C5:0.5 E5:0.5 A5:0.5 | G5:0.5 E5:0.5 C5:0.5 E5:0.5 G5:2', 2) + ' | A4:4',
      L: rep(`${rep('A2+E3:1', 4).replaceAll(' | ', ' ')} | ${rep('A2+E3:1', 4).replaceAll(' | ', ' ')} | ${rep('A2+E3:1', 4).replaceAll(' | ', ' ')} | ${rep('C3+G3:1', 4).replaceAll(' | ', ' ')}`, 2) + ' | A2+E3:4',
    },
  },
  {
    id: 'gymnopedie-1',
    title: 'Gymnopédie n°1 (début)',
    composer: 'Erik Satie',
    genre: 'classique',
    level: 4,
    tempo: 66,
    timeSig: [3, 4],
    keyFifths: 2,
    description:
      '« Lent et douloureux » (1888). La main gauche se balance entre une basse grave et un accord de septième majeure : un vrai saut à préparer sans regarder. Pédale à chaque mesure, mélodie très liée.',
    tags: ['Satie', 'impressionnisme', 'sauts', 'pédale', '3/4'],
    tracks: {
      R: 'r:3 | r:3 | r:3 | r:3 | r:1 F#5:1 A5:1 | G5:1 F#5:1 C#5:1 | B4:1 C#5:1 D5:1 | A4:3 | F#4:6',
      L: rep('G2:1 B3+D4+F#4:2 | D2:1 A3+C#4+F#4:2', 4) + ' | G2:1 B3+D4:2 | D2:1 A3+C#4:2',
    },
  },
  {
    id: 'gamme-la',
    title: 'Gamme de La majeur (2 octaves)',
    composer: 'Exercice',
    genre: 'technique',
    level: 3,
    tempo: 60,
    timeSig: [4, 4],
    keyFifths: 3,
    description:
      'Trois dièses : Fa♯, Do♯ et Sol♯. Doigté identique à Do majeur (main droite 1-2-3 / 1-2-3-4, main gauche 5-4-3-2-1 / 3-2-1) : le pouce reste toujours sur une touche blanche.',
    tags: ['gamme', 'La majeur', 'dièses'],
    tracks: { R: scaleTrack('A3', { F: '#', C: '#', G: '#' }, RH_SCALE), L: scaleTrack('A2', { F: '#', C: '#', G: '#' }, LH_SCALE) },
  },
  {
    id: 'gamme-si-bemol',
    title: 'Gamme de Si♭ majeur (2 octaves)',
    composer: 'Exercice',
    genre: 'technique',
    level: 3,
    tempo: 60,
    timeSig: [4, 4],
    keyFifths: -2,
    description:
      'Le doigté des gammes qui commencent sur une touche noire : le pouce ne joue que les touches blanches (Do et Fa). Main droite 4 sur Si♭, puis 1-2-3 / 1-2-3-4 ; main gauche 3-2-1-4-3-2-1-3.',
    tags: ['gamme', 'Si♭ majeur', 'bémols', 'passage du pouce'],
    tracks: { R: scaleTrack('B3', { B: 'b', E: 'b' }, RH_SCALE_BB), L: scaleTrack('B2', { B: 'b', E: 'b' }, LH_SCALE_BB) },
  },
];

const BY_ID = new Map(SONGS.map((s) => [s.id, s]));

export function getSong(id) {
  return BY_ID.get(id) || null;
}

export function songsByGenre(genreId) {
  return SONGS.filter((s) => s.genre === genreId).sort((a, b) => a.level - b.level || a.title.localeCompare(b.title, 'fr'));
}
