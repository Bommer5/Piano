// Cours progressifs. Chaque leçon est une suite de blocs :
//   text / tip / warning  : contenu HTML
//   keys                  : schéma de clavier avec doigtés
//   quiz                  : question à choix multiples
//   practice              : lance l'entraîneur sur un morceau de la bibliothèque (js/data/songs.js)
//   exercise              : mini-exercice en notation compacte, lancé dans l'entraîneur

const text = (html) => ({ type: 'text', html });
const tip = (html) => ({ type: 'tip', html });
const warning = (html) => ({ type: 'warning', html });
const keys = (title, notes, caption) => ({ type: 'keys', title, notes, caption });
const quiz = (question, choices, answer, explain) => ({ type: 'quiz', question, choices, answer, explain });
const practice = (songId, hands, tempoPct, label) => ({ type: 'practice', songId, hands, tempoPct, label });
const exercise = (title, tracks, { tempo = 72, timeSig = [4, 4], hands = 'R', label } = {}) => ({
  type: 'exercise',
  title,
  tracks,
  tempo,
  timeSig,
  hands,
  label: label || 'Jouer l’exercice',
});

/** Raccourci pour un schéma de touches : « C4:1 D4:2 … » */
const k = (str, hand = 'R') =>
  str.split(/\s+/).filter(Boolean).map((t) => {
    const [name, f] = t.split(':');
    return f ? { name, finger: Number(f), hand } : { name, hand };
  });

export const COURSES = [
  // =====================================================================
  // LES BASES
  // =====================================================================
  {
    id: 'bases',
    genre: 'debutant',
    title: 'Les bases du piano',
    description:
      'Le parcours complet du débutant : posture, doigts, notes, lecture, rythme, gammes, accords et méthode de travail. Suivez les leçons dans l’ordre, une ou deux par jour.',
    lessons: [
      {
        id: 'bases-posture',
        title: 'Bien s’installer au piano',
        duration: 5,
        level: 1,
        blocks: [
          text(
            '<p>Une bonne posture, c’est la moitié du travail : elle évite la fatigue et les douleurs, et permet aux doigts d’être libres.</p><ul><li><strong>La hauteur</strong> : assis, vos avant-bras sont à peu près horizontaux, les coudes légèrement au-dessus du clavier.</li><li><strong>La distance</strong> : bras tendus, vos poings fermés touchent le couvercle des touches. Asseyez-vous sur la moitié avant du banc.</li><li><strong>Le centre</strong> : placez-vous face au milieu du clavier (environ au niveau du Do central).</li><li><strong>Les pieds</strong> : bien à plat au sol, le pied droit un peu en avant, près de la pédale.</li><li><strong>Le dos</strong> : droit mais pas raide, les épaules relâchées.</li></ul>',
          ),
          text(
            '<p><strong>La main</strong> : laissez pendre votre bras le long du corps, puis remontez la main sur le clavier sans changer sa forme. Elle est naturellement arrondie, comme si elle tenait une balle de tennis. Les doigts jouent avec le bout (près de l’ongle), le pouce sur son côté.</p>',
          ),
          tip('Vérifiez vos épaules toutes les cinq minutes : si elles sont remontées vers les oreilles, respirez et laissez-les retomber.'),
          warning('Si vous ressentez une douleur au poignet, à l’avant-bras ou à l’épaule, arrêtez-vous. Le piano ne doit jamais faire mal : une douleur signale une tension inutile.'),
          quiz(
            'À quelle hauteur doivent se trouver vos avant-bras ?',
            ['Nettement plus bas que le clavier', 'À peu près à l’horizontale, au niveau du clavier', 'Bien au-dessus, poignets cassés vers le bas'],
            1,
            'Avant-bras horizontaux, coudes à peine au-dessus des touches : le poids du bras peut descendre naturellement dans les doigts.',
          ),
        ],
      },
      {
        id: 'bases-doigts',
        title: 'La numérotation des doigts',
        duration: 6,
        level: 1,
        blocks: [
          text(
            '<p>Au piano, chaque doigt porte un numéro, <strong>identique pour les deux mains</strong> :</p><ul><li><strong>1</strong> = pouce</li><li><strong>2</strong> = index</li><li><strong>3</strong> = majeur</li><li><strong>4</strong> = annulaire</li><li><strong>5</strong> = auriculaire</li></ul><p>Ces chiffres apparaissent sur les partitions au-dessus ou en dessous des notes : c’est le <em>doigté</em>. Le respecter dès le début vous fera gagner énormément de temps.</p>',
          ),
          keys('Main droite', k('C4:1 D4:2 E4:3 F4:4 G4:5'), 'Pouce droit sur le Do central, chaque doigt sur la touche suivante.'),
          keys('Main gauche', k('C3:5 D3:4 E3:3 F3:2 G3:1', 'L'), 'À la main gauche, c’est l’auriculaire (5) qui est sur le Do, et le pouce sur le Sol.'),
          tip('Petit jeu : posez les mains sur vos genoux et demandez à quelqu’un d’annoncer des numéros (« main gauche, 3 ! »). Levez le bon doigt le plus vite possible.'),
          exercise('Un doigt après l’autre (main droite)', { R: 'C4:1:1 D4:1:2 E4:1:3 F4:1:4 | G4:1:5 F4:1:4 E4:1:3 D4:1:2 | C4:4:1' }, { tempo: 60, hands: 'R' }),
          exercise('Un doigt après l’autre (main gauche)', { L: 'C3:1:5 D3:1:4 E3:1:3 F3:1:2 | G3:1:1 F3:1:2 E3:1:3 D3:1:4 | C3:4:5' }, { tempo: 60, hands: 'L' }),
          quiz('Quel doigt porte le numéro 4 ?', ['L’index', 'Le majeur', 'L’annulaire', 'L’auriculaire'], 2, 'On compte à partir du pouce (1) : index 2, majeur 3, annulaire 4, auriculaire 5.'),
        ],
      },
      {
        id: 'bases-reperer-do',
        title: 'Se repérer : trouver les Do',
        duration: 6,
        level: 1,
        blocks: [
          text(
            '<p>Le clavier semble immense, mais il répète toujours le même motif de <strong>12 touches</strong> : 7 blanches et 5 noires. Les touches noires sont groupées <strong>par deux</strong> puis <strong>par trois</strong>.</p><p>Le <strong>Do</strong> est la touche blanche située <strong>juste à gauche du groupe de deux touches noires</strong>. Il y en a huit sur un piano de 88 touches. Celui qui est au milieu, en face de la serrure ou du logo, s’appelle le <strong>Do central</strong> (noté C4).</p>',
          ),
          keys('Tous les Do du milieu du clavier', k('C2 C3 C4 C5 C6'), 'Chaque Do se trouve juste avant un groupe de deux touches noires.'),
          text('<p>Avec le même principe : le <strong>Fa</strong> est juste à gauche du groupe de <strong>trois</strong> touches noires, le <strong>Ré</strong> est coincé entre les deux touches noires, le <strong>Mi</strong> juste à droite du groupe de deux.</p>'),
          exercise('Saute-mouton sur les Do', { R: 'C4:2:1 C5:2:1 | C6:2:1 C5:2:1 | C4:4:1' }, { tempo: 60, hands: 'R' }),
          practice('touches-noires', 'both', 80, 'Promenade sur les touches noires'),
          quiz(
            'Où se trouve le Do ?',
            ['À gauche du groupe de trois touches noires', 'À gauche du groupe de deux touches noires', 'Entre deux touches noires', 'À droite du groupe de trois touches noires'],
            1,
            'Le Do est la touche blanche juste à gauche des deux touches noires. À gauche des trois touches noires, c’est le Fa.',
          ),
        ],
      },
      {
        id: 'bases-noms-notes',
        title: 'Les noms des notes',
        duration: 7,
        level: 1,
        blocks: [
          text(
            '<p>Il existe deux façons de nommer les notes :</p><ul><li>en français (solfège) : <strong>Do, Ré, Mi, Fa, Sol, La, Si</strong> ;</li><li>en notation anglo-saxonne : <strong>C, D, E, F, G, A, B</strong>.</li></ul><p>On ajoute un numéro d’octave : <strong>C4</strong> est le Do central, <strong>A4</strong> le La du diapason (440 Hz). Après Si, on recommence à Do, une octave plus haut (C5).</p>',
          ),
          keys('Une octave de Do à Si', k('C4 D4 E4 F4 G4 A4 B4'), 'Do (C) – Ré (D) – Mi (E) – Fa (F) – Sol (G) – La (A) – Si (B)'),
          tip('Astuce mémoire : en anglais, on commence l’alphabet au La (A). Donc La = A, Si = B, Do = C, et ainsi de suite.'),
          quiz('Comment s’appelle la note « G » en français ?', ['Ré', 'Sol', 'La', 'Fa'], 1, 'A = La, B = Si, C = Do, D = Ré, E = Mi, F = Fa, G = Sol.'),
          quiz('Quelle note vient juste après Si ?', ['La', 'Do', 'Ré', 'Sol'], 1, 'Après Si, la série recommence : Do, à l’octave supérieure.'),
        ],
      },
      {
        id: 'bases-position-do',
        title: 'La position de Do à cinq doigts',
        duration: 10,
        level: 1,
        blocks: [
          text(
            '<p>La <strong>position de Do</strong> est votre camp de base : chaque doigt sur une touche, de Do à Sol, sans bouger la main. Une grande partie des premiers morceaux se joue entièrement dans cette position.</p>',
          ),
          keys('Position de Do, deux mains', [...k('C3:5 D3:4 E3:3 F3:2 G3:1', 'L'), ...k('C4:1 D4:2 E4:3 F4:4 G4:5')], 'Main gauche une octave en dessous, pouces vers le centre.'),
          text('<p>Enfoncez chaque touche jusqu’au fond, puis relâchez. Les doigts qui ne jouent pas restent posés, détendus, à la surface des touches.</p>'),
          practice('cinq-doigts-do', 'R', 70, 'Cinq doigts en Do : main droite seule'),
          practice('main-gauche-do', 'L', 70, 'La main gauche se promène : main gauche seule'),
          tip('Ne regardez pas vos mains à chaque note ! Regardez l’écran : vos doigts savent où ils sont puisqu’ils ne bougent pas.'),
          practice('cinq-doigts-do', 'both', 70, 'Cinq doigts en Do : mains ensemble'),
        ],
      },
      {
        id: 'bases-cle-sol',
        title: 'Lire en clé de sol',
        duration: 8,
        level: 1,
        blocks: [
          text(
            '<p>La <strong>portée</strong> compte 5 lignes. Les notes se placent sur les lignes ou dans les interlignes ; plus elles sont haut, plus le son est aigu.</p><p>La <strong>clé de sol</strong> (main droite en général) s’enroule autour de la 2e ligne en partant du bas : cette ligne est le <strong>Sol</strong> (G4).</p><ul><li>Notes sur les lignes, de bas en haut : <strong>Mi – Sol – Si – Ré – Fa</strong>.</li><li>Notes dans les interlignes : <strong>Fa – La – Do – Mi</strong>.</li><li>Le <strong>Do central</strong> est sous la portée, sur une petite ligne supplémentaire.</li></ul>',
          ),
          keys('Les lignes de la clé de sol', k('E4 G4 B4 D5 F5'), 'Mi – Sol – Si – Ré – Fa'),
          tip('Ne récitez pas toutes les notes depuis le Do : apprenez quelques <em>notes repères</em> (Do central, Sol de la clé, Do du 3e interligne) et lisez par intervalles à partir d’elles.'),
          quiz('Quelle note est sur la 2e ligne en clé de sol ?', ['Mi', 'Sol', 'Si', 'La'], 1, 'C’est justement la ligne autour de laquelle s’enroule la clé : le Sol.'),
          quiz('Où se place le Do central en clé de sol ?', ['Sur la 1re ligne', 'Dans le 3e interligne', 'Sur une ligne supplémentaire sous la portée', 'Au-dessus de la portée'], 2, 'Le Do central est juste sous la portée, barré par une petite ligne supplémentaire.'),
        ],
      },
      {
        id: 'bases-cle-fa',
        title: 'Lire en clé de fa',
        duration: 8,
        level: 2,
        blocks: [
          text(
            '<p>La <strong>clé de fa</strong> sert aux notes graves, jouées le plus souvent par la main gauche. Ses deux points encadrent la 4e ligne : c’est le <strong>Fa</strong> sous le Do central (F3).</p><ul><li>Lignes de bas en haut : <strong>Sol – Si – Ré – Fa – La</strong>.</li><li>Interlignes : <strong>La – Do – Mi – Sol</strong>.</li><li>Le Do central est cette fois <strong>au-dessus</strong> de la portée, sur une ligne supplémentaire.</li></ul><p>Au piano, les deux portées sont réunies par une accolade : c’est le <em>grand système</em>. Le Do central fait le lien entre les deux.</p>',
          ),
          keys('Les lignes de la clé de fa', k('G2 B2 D3 F3 A3', 'L'), 'Sol – Si – Ré – Fa – La'),
          tip('Repère pratique : le Do du 2e interligne (C3) est exactement une octave sous le Do central. C’est là que se pose l’auriculaire gauche en position de Do.'),
          quiz('Quelle note est sur la 4e ligne en clé de fa ?', ['Ré', 'Fa', 'La', 'Sol'], 1, 'La clé de fa entoure de ses deux points la ligne du Fa (F3).'),
          practice('main-gauche-do', 'L', 80, 'Lire et jouer la main gauche'),
        ],
      },
      {
        id: 'bases-rythmes',
        title: 'Les durées : ronde, blanche, noire, croche',
        duration: 10,
        level: 1,
        blocks: [
          text(
            '<p>La musique se mesure en <strong>temps</strong> (les pulsations régulières, comme un tic-tac). Chaque figure de note a une durée :</p><ul><li><strong>Ronde</strong> (note blanche sans hampe) : 4 temps</li><li><strong>Blanche</strong> (note blanche avec hampe) : 2 temps</li><li><strong>Noire</strong> : 1 temps</li><li><strong>Croche</strong> (avec un crochet) : ½ temps — deux croches par temps, comptez « 1 et 2 et »</li><li><strong>Double croche</strong> : ¼ de temps</li></ul><p>Un <strong>point</strong> après une note ajoute la moitié de sa valeur : une <em>blanche pointée</em> dure 3 temps, une <em>noire pointée</em> 1 temps ½.</p>',
          ),
          text(
            '<p>Chaque durée a son <strong>silence</strong> équivalent : la <em>pause</em> (4 temps, suspendue sous la 4e ligne), la <em>demi-pause</em> (2 temps, posée sur la 3e ligne), le <em>soupir</em> (1 temps), le <em>demi-soupir</em> (½ temps). Un silence se compte aussi précisément qu’une note !</p>',
          ),
          exercise(
            'Ronde, blanches, noires, croches',
            { R: 'C4:4:1 | C4:2:1 C4:2:1 | C4:1:1 C4:1:1 C4:1:1 C4:1:1 | C4:0.5:1 C4:0.5:1 C4:0.5:1 C4:0.5:1 C4:2:1' },
            { tempo: 70, hands: 'R' },
          ),
          exercise('Silences et noire pointée', { R: 'C4:1:1 r:1 E4:1:3 r:1 | G4:1.5:5 F4:0.5:4 E4:2:3 | D4:1:2 r:1 D4:1:2 r:1 | C4:4:1' }, { tempo: 70, hands: 'R' }),
          practice('noires-blanches', 'R', 80, 'Noires, blanches et rondes'),
          tip('Comptez toujours à voix haute au début. Ça paraît enfantin, mais c’est la méthode des professionnels pour un rythme solide.'),
          quiz('Combien de temps dure une blanche pointée ?', ['2 temps', '2 temps ½', '3 temps', '4 temps'], 2, 'Blanche = 2 temps, plus la moitié (1 temps) grâce au point : 3 temps.'),
          quiz('Combien de croches dans une ronde ?', ['4', '6', '8', '16'], 2, 'Une ronde = 4 temps, et il y a 2 croches par temps : 8 croches.'),
        ],
      },
      {
        id: 'bases-mesures',
        title: 'Les mesures : 2/4, 3/4, 4/4',
        duration: 8,
        level: 1,
        blocks: [
          text(
            '<p>Les temps sont regroupés en <strong>mesures</strong>, séparées par des barres verticales. Le <strong>chiffrage</strong> au début de la partition indique :</p><ul><li>en haut : le <strong>nombre de temps</strong> par mesure ;</li><li>en bas : l’unité de temps (4 = la noire).</li></ul><p><strong>4/4</strong> (ou « C ») : 4 noires, le plus courant. <strong>3/4</strong> : 3 noires, la valse et le menuet (« UN-deux-trois »). <strong>2/4</strong> : 2 noires, la marche et le ragtime.</p><p>Le premier temps de chaque mesure est le <strong>temps fort</strong> : on le sent naturellement un peu plus appuyé.</p>',
          ),
          exercise('Une petite valse en 3/4', { R: 'C4:1:1 E4:1:3 G4:1:5 | G4:2:5 E4:1:3 | D4:1:2 F4:1:4 E4:1:3 | C4:3:1', L: 'C3:3:5 | C3:3:5 | G3:3:1 | C3:3:5' }, { tempo: 90, timeSig: [3, 4], hands: 'both' }),
          exercise('Une marche en 2/4', { R: 'C4:1:1 G4:1:5 | E4:1:3 C4:1:1 | D4:0.5:2 E4:0.5:3 F4:0.5:4 D4:0.5:2 | C4:2:1' }, { tempo: 96, timeSig: [2, 4], hands: 'R' }),
          tip('Une <em>anacrouse</em> (levée) est une ou plusieurs notes avant la première mesure complète, comme dans « Joyeux anniversaire ». Dans l’application, elle est précédée de silences pour que les mesures tombent juste.'),
          quiz('Que signifie le chiffrage 3/4 ?', ['3 blanches par mesure', '3 noires par mesure', '4 noires réparties en 3 mesures', '3 croches par mesure'], 1, 'Le chiffre du haut donne le nombre de temps (3), celui du bas l’unité (4 = noire).'),
          practice('joyeux-anniversaire', 'R', 70, 'Joyeux anniversaire (3/4 avec levée)'),
        ],
      },
      {
        id: 'bases-alterations',
        title: 'Dièses, bémols et bécarres',
        duration: 8,
        level: 2,
        blocks: [
          text(
            '<p>Les touches noires portent le nom des touches blanches voisines, avec une <strong>altération</strong> :</p><ul><li><strong>♯ dièse</strong> : la note est montée d’un demi-ton (la touche juste à droite). Do♯ est la touche noire à droite du Do.</li><li><strong>♭ bémol</strong> : la note est baissée d’un demi-ton (la touche juste à gauche). Si♭ est la touche noire à gauche du Si.</li><li><strong>♮ bécarre</strong> : annule l’altération.</li></ul><p>Une même touche a donc deux noms : Do♯ = Ré♭, Fa♯ = Sol♭… On parle de notes <em>enharmoniques</em>.</p>',
          ),
          keys('Quelques touches noires', k('C#4 Eb4 F#4 Ab4 Bb4'), 'Do♯ (Ré♭), Mi♭ (Ré♯), Fa♯ (Sol♭), La♭ (Sol♯), Si♭ (La♯)'),
          text('<p>Les altérations placées au début de la portée forment l’<strong>armure</strong> : elles valent pour tout le morceau. Une altération écrite devant une note (accidentelle) ne vaut que jusqu’à la fin de la mesure.</p>'),
          exercise('Position de Ré, avec Fa♯', { R: 'D4:1:1 E4:1:2 F#4:1:3 G4:1:4 | A4:2:5 F#4:2:3 | G4:1:4 E4:1:2 F#4:1:3 D4:1:1 | D4:4:1' }, { tempo: 70, hands: 'R' }),
          exercise('Position de Fa, avec Si♭', { R: 'F4:1:1 G4:1:2 A4:1:3 Bb4:1:4 | C5:2:5 A4:2:3 | Bb4:1:4 G4:1:2 A4:1:3 F4:1:1 | F4:4:1' }, { tempo: 70, hands: 'R' }),
          quiz('Entre Mi et Fa, combien y a-t-il de touches noires ?', ['Une', 'Aucune', 'Deux'], 1, 'Mi–Fa et Si–Do sont des demi-tons naturels : il n’y a pas de touche noire entre eux. Mi♯ est donc… un Fa !'),
          quiz('Quelle autre note correspond à la touche Sol♭ ?', ['Fa♯', 'Sol♯', 'La♭', 'Fa'], 0, 'Sol baissé d’un demi-ton tombe sur la touche noire à gauche du Sol, qui est aussi Fa monté d’un demi-ton.'),
        ],
      },
      {
        id: 'bases-passage-pouce',
        title: 'Le passage du pouce',
        duration: 10,
        level: 2,
        blocks: [
          text(
            '<p>Avec cinq doigts, on ne joue que cinq notes… sauf si le <strong>pouce passe sous la main</strong> ! C’est la technique qui permet de jouer une gamme entière sans interruption.</p><ul><li><strong>En montant</strong> (main droite) : après le 3e doigt (sur Mi), le pouce glisse sous la main pour jouer Fa.</li><li><strong>En descendant</strong> : c’est le 3e doigt qui passe par-dessus le pouce (du Fa vers le Mi).</li></ul><p>Le pouce se prépare en avance : il commence à se déplacer sous la paume dès que le 2e doigt joue.</p>',
          ),
          keys('Doigté de la gamme de Do (main droite)', k('C4:1 D4:2 E4:3 F4:1 G4:2 A4:3 B4:4 C5:5'), '1-2-3, passage du pouce, 1-2-3-4-5'),
          warning('Le coude et le poignet ne doivent pas « sauter » au moment du passage. Le mouvement est fluide et horizontal, la main avance comme sur un rail.'),
          exercise('Le passage du pouce isolé', { R: 'C4:1:1 D4:1:2 E4:1:3 F4:1:1 | E4:1:3 D4:1:2 C4:2:1 | C4:1:1 D4:1:2 E4:1:3 F4:1:1 | G4:1:2 F4:1:1 E4:2:3' }, { tempo: 60, hands: 'R' }),
          exercise('Gamme de Do sur une octave', { R: 'C4:1:1 D4:1:2 E4:1:3 F4:1:1 | G4:1:2 A4:1:3 B4:1:4 C5:1:5 | B4:1:4 A4:1:3 G4:1:2 F4:1:1 | E4:1:3 D4:1:2 C4:2:1' }, { tempo: 60, hands: 'R' }),
          practice('joie-sur-la-terre', 'R', 80, 'Joie sur la terre : une gamme descendante en musique'),
          quiz('Main droite, gamme de Do montante : quel doigt joue le Fa ?', ['3', '4', '1 (le pouce)', '2'], 2, 'Après Do-Ré-Mi (1-2-3), le pouce passe sous la main pour jouer Fa.'),
        ],
      },
      {
        id: 'bases-gammes',
        title: 'Les gammes majeures',
        duration: 12,
        level: 2,
        blocks: [
          text(
            '<p>Une <strong>gamme majeure</strong> est une suite de 8 notes construite toujours sur le même modèle de <strong>tons</strong> (T, deux touches d’écart) et de <strong>demi-tons</strong> (½, touches voisines) :</p><p style="text-align:center"><strong>T – T – ½ – T – T – T – ½</strong></p><p>En partant de Do, ce modèle tombe exactement sur les touches blanches. En partant d’une autre note, il faut des altérations : <strong>Sol majeur</strong> a un Fa♯, <strong>Ré majeur</strong> Fa♯ et Do♯, <strong>Fa majeur</strong> un Si♭.</p>',
          ),
          keys('Gamme de Sol majeur', k('G4:1 A4:2 B4:3 C5:1 D5:2 E5:3 F#5:4 G5:5'), 'Le Fa♯ (touche noire) est joué par le 4e doigt.'),
          tip('Travaillez chaque gamme mains séparées, lentement, en écoutant l’égalité des notes. Le passage du pouce doit être inaudible.'),
          practice('gamme-do', 'R', 70, 'Gamme de Do majeur, main droite'),
          practice('gamme-do', 'L', 70, 'Gamme de Do majeur, main gauche'),
          practice('gamme-sol', 'R', 70, 'Gamme de Sol majeur, main droite'),
          quiz('Quel est le modèle de la gamme majeure ?', ['T-½-T-T-½-T-T', 'T-T-½-T-T-T-½', 'T-T-T-½-T-T-½', '½-T-T-T-½-T-T'], 1, 'Deux tons, un demi-ton, trois tons, un demi-ton : Do-Ré-Mi^Fa-Sol-La-Si^Do.'),
          quiz('Quelle altération contient la gamme de Fa majeur ?', ['Fa♯', 'Si♭', 'Mi♭', 'Do♯'], 1, 'Entre La et Si♭ il faut un demi-ton (3e et 4e degrés) : le Si est baissé.'),
        ],
      },
      {
        id: 'bases-accords',
        title: 'Accords parfaits et renversements',
        duration: 12,
        level: 2,
        blocks: [
          text(
            '<p>Un <strong>accord parfait</strong> (ou triade) superpose trois notes séparées par des tierces : la <strong>fondamentale</strong>, la <strong>tierce</strong> et la <strong>quinte</strong>. Do majeur = Do-Mi-Sol, Fa majeur = Fa-La-Do, Sol majeur = Sol-Si-Ré.</p><ul><li>Accord <strong>majeur</strong> : tierce majeure (4 demi-tons) puis tierce mineure — son lumineux.</li><li>Accord <strong>mineur</strong> : tierce mineure (3 demi-tons) puis tierce majeure — son plus sombre. La mineur = La-Do-Mi.</li></ul>',
          ),
          keys('Do majeur en position fondamentale', k('C4:1 E4:3 G4:5'), 'Doigté 1-3-5 : une touche sur deux.'),
          text(
            '<p>On peut <strong>renverser</strong> un accord en mettant une autre note en bas :</p><ul><li><strong>1er renversement</strong> : Mi-Sol-Do (doigté 1-2-5)</li><li><strong>2e renversement</strong> : Sol-Do-Mi (doigté 1-3-5)</li></ul><p>Les renversements permettent de passer d’un accord à l’autre en bougeant très peu la main : c’est le secret d’un accompagnement fluide.</p>',
          ),
          exercise('Les trois accords principaux', { R: 'C4+E4+G4:4:1+3+5 | F4+A4+C5:4:1+3+5 | G4+B4+D5:4:1+3+5 | C4+E4+G4:4:1+3+5', L: 'C3:4:1 | F2:4:5 | G2:4:4 | C3:4:1' }, { tempo: 60, hands: 'both' }),
          exercise('Les mêmes accords, renversés', { R: 'C4+E4+G4:4:1+3+5 | C4+F4+A4:4:1+3+5 | B3+D4+G4:4:1+2+5 | C4+E4+G4:4:1+3+5', L: 'C3:4:1 | F2:4:5 | G2:4:4 | C3:4:1' }, { tempo: 60, hands: 'both' }),
          practice('renversements', 'R', 70, 'Accords parfaits et renversements'),
          quiz('Quelles notes forment l’accord de Fa majeur ?', ['Fa-La-Do', 'Fa-Sol-La', 'Fa-La♭-Do', 'Fa-Si-Ré'], 0, 'Fondamentale Fa, tierce majeure La, quinte Do.'),
          quiz('Mi-Sol-Do est…', ['Do majeur en position fondamentale', 'Do majeur, 1er renversement', 'Mi mineur', 'Do majeur, 2e renversement'], 1, 'Ce sont les notes de Do majeur, avec la tierce (Mi) en bas : 1er renversement.'),
        ],
      },
      {
        id: 'bases-mains-ensemble',
        title: 'Jouer mains ensemble',
        duration: 12,
        level: 2,
        blocks: [
          text(
            '<p>Coordonner les deux mains est le grand défi du débutant : le cerveau doit gérer deux « voix » à la fois. La méthode qui marche :</p><ol><li>Chaque main <strong>seule</strong>, jusqu’à la jouer sans erreur ni hésitation.</li><li>Mains ensemble <strong>très lentement</strong> (50 à 60 % du tempo).</li><li>Repérez les <strong>points de rencontre</strong> : les moments où les deux mains jouent en même temps. Arrêtez-vous dessus, vérifiez, continuez.</li><li>Accélérez progressivement.</li></ol>',
          ),
          exercise('Mouvement parallèle', { R: 'C4:1:1 D4:1:2 E4:1:3 F4:1:4 | G4:4:5', L: 'C3:1:5 D3:1:4 E3:1:3 F3:1:2 | G3:4:1' }, { tempo: 60, hands: 'both' }),
          exercise('Mouvement contraire', { R: 'C4:1:1 D4:1:2 E4:1:3 F4:1:4 | G4:4:5', L: 'C3:1:1 B2:1:2 A2:1:3 G2:1:4 | F2:4:5' }, { tempo: 60, hands: 'both' }),
          tip('En mouvement contraire, les deux mains utilisent les mêmes numéros de doigts au même moment : c’est souvent plus facile qu’en parallèle !'),
          practice('ode-joie', 'R', 70, 'Ode à la joie : main droite'),
          practice('ode-joie', 'L', 70, 'Ode à la joie : main gauche'),
          practice('ode-joie', 'both', 60, 'Ode à la joie : mains ensemble, lentement'),
        ],
      },
      {
        id: 'bases-pedale',
        title: 'La pédale de sustain',
        duration: 8,
        level: 2,
        blocks: [
          text(
            '<p>La pédale de droite (<strong>pédale forte</strong> ou <em>sustain</em>) relève tous les étouffoirs : les notes continuent de sonner même quand on lâche les touches. Elle se joue avec le <strong>pied droit</strong>, talon posé au sol.</p><p>La technique essentielle est la <strong>pédale syncopée</strong> (ou « de liaison ») :</p><ol><li>Jouez le premier accord, puis enfoncez la pédale.</li><li>Au changement d’accord, jouez le nouvel accord <strong>puis</strong> relevez et ré-enfoncez aussitôt la pédale.</li></ol><p>Le pied change <em>juste après</em> les mains : ainsi le son est lié sans mélanger les harmonies.</p>',
          ),
          warning('Ne gardez pas la pédale enfoncée sur plusieurs accords différents : tout se brouille. En cas de doute, changez de pédale à chaque accord.'),
          exercise('Pédale à chaque accord', { R: 'C4+E4+G4:4:1+3+5 | C4+F4+A4:4:1+3+5 | B3+D4+G4:4:1+2+5 | C4+E4+G4:4:1+3+5', L: 'C3:4:1 | F2:4:5 | G2:4:4 | C3:4:1' }, { tempo: 56, hands: 'both', label: 'Jouer avec la pédale' }),
          practice('pluie-automne', 'both', 60, 'Pluie d’automne : arpèges et pédale'),
          quiz('Quand faut-il changer la pédale lors d’un changement d’accord ?', ['Juste avant de jouer le nouvel accord', 'Juste après avoir joué le nouvel accord', 'Jamais, on la garde enfoncée', 'Une mesure plus tard'], 1, 'Mains d’abord, pied ensuite : c’est la pédale syncopée, qui relie les sons sans les mélanger.'),
        ],
      },
      {
        id: 'bases-nuances',
        title: 'Nuances, legato et staccato',
        duration: 8,
        level: 2,
        blocks: [
          text(
            '<p>Jouer les bonnes notes ne suffit pas : il faut les <strong>faire vivre</strong>.</p><p><strong>Les nuances</strong> (le volume) : <em>pp</em> pianissimo (très doux), <em>p</em> piano (doux), <em>mp</em> mezzo piano, <em>mf</em> mezzo forte, <em>f</em> forte (fort), <em>ff</em> fortissimo. Le <em>crescendo</em> (&lt;) augmente progressivement, le <em>decrescendo</em> (&gt;) diminue.</p><p><strong>Les articulations</strong> :</p><ul><li><strong>Legato</strong> (lié, indiqué par une liaison courbe) : on ne lève une touche qu’au moment où la suivante s’enfonce, sans trou ni chevauchement.</li><li><strong>Staccato</strong> (un point sur la note) : note courte et détachée, le doigt rebondit.</li></ul>',
          ),
          exercise('Staccato puis legato', { R: 'C4:0.5:1 r:0.5 E4:0.5:3 r:0.5 G4:0.5:5 r:0.5 E4:0.5:3 r:0.5 | C4:1:1 D4:1:2 E4:1:3 F4:1:4 | G4:1:5 F4:1:4 E4:1:3 D4:1:2 | C4:4:1' }, { tempo: 72, hands: 'R' }),
          tip('Le volume vient de la <strong>vitesse</strong> d’enfoncement de la touche, pas de la force. Pour jouer doux, partez du contact avec la touche et descendez lentement.'),
          practice('berceuse-brahms', 'R', 70, 'La Berceuse de Brahms : un legato très doux'),
          quiz('Que signifie « mf » ?', ['Moins fort', 'Mezzo forte : moyennement fort', 'Très fort', 'Ralentir'], 1, 'Mezzo forte, « à moitié fort ». C’est souvent la nuance de départ par défaut.'),
          quiz('Un point au-dessus d’une note indique…', ['Une note pointée', 'Un staccato', 'Un accent', 'Une pédale'], 1, 'Placé au-dessus ou en dessous de la tête de note, le point indique le staccato. À droite de la note, il allonge sa durée.'),
        ],
      },
      {
        id: 'bases-methode',
        title: 'Comment bien travailler',
        duration: 7,
        level: 1,
        blocks: [
          text(
            '<p>Vingt minutes bien utilisées valent mieux qu’une heure à jouer « en boucle ». Voici les règles d’or :</p><ul><li><strong>Lentement</strong> : jouez assez lentement pour ne faire <em>aucune</em> erreur. Une erreur répétée devient une habitude.</li><li><strong>Mains séparées</strong> d’abord, puis ensemble.</li><li><strong>Petites sections</strong> : 2 à 4 mesures à la fois. Travaillez d’abord le passage le plus difficile, pas toujours le début !</li><li><strong>Le métronome</strong> : commencez à 60 %, et n’augmentez que quand c’est parfait trois fois de suite.</li><li><strong>Régularité</strong> : 15 minutes chaque jour valent mieux que 2 heures le dimanche.</li><li><strong>Pauses</strong> : le cerveau consolide pendant le repos. Une nuit de sommeil fait souvent des miracles.</li></ul>',
          ),
          tip('Une séance type : 3 minutes d’échauffement (cinq doigts, gamme), 10 minutes sur le passage difficile du moment, 5 minutes de plaisir sur un morceau que vous connaissez déjà.'),
          practice('echauffement', 'both', 70, 'Échauffement à cinq doigts'),
          quiz(
            'Vous butez toujours sur la mesure 6. Que faire ?',
            ['Rejouer le morceau depuis le début jusqu’à ce que ça passe', 'Isoler les mesures 5 à 7, les jouer lentement mains séparées puis ensemble', 'Jouer plus vite pour passer l’obstacle', 'Passer à un autre morceau'],
            1,
            'On isole le passage difficile (avec une mesure avant et après pour les enchaînements) et on le travaille lentement jusqu’à ce qu’il soit sûr.',
          ),
        ],
      },
    ],
  },

  // =====================================================================
  // PREMIERS PAS
  // =====================================================================
  {
    id: 'premiers-morceaux',
    genre: 'debutant',
    title: 'Mes premiers morceaux',
    description: 'Des petits morceaux pour mettre en pratique les bases, en position de Do puis de Sol, une main puis les deux.',
    lessons: [
      {
        id: 'pm-une-main',
        title: 'Une main à la fois',
        duration: 8,
        level: 1,
        blocks: [
          text('<p>Commençons par des mélodies jouées par une seule main, sans déplacer la position. L’objectif : un son régulier et des doigts qui ne s’envolent pas.</p>'),
          practice('cinq-doigts-do', 'R', 80, 'Cinq doigts en Do (main droite)'),
          practice('main-gauche-do', 'L', 80, 'La main gauche se promène'),
          tip('Gardez l’ongle du doigt qui joue bien au-dessus de la touche, et les autres doigts posés en surface.'),
        ],
      },
      {
        id: 'pm-rythme',
        title: 'Compter en jouant',
        duration: 8,
        level: 1,
        blocks: [
          text('<p>Dans ce morceau, chaque mesure fait 4 temps mais les notes n’ont pas toutes la même durée. Comptez « 1, 2, 3, 4 » à voix haute et ne relevez jamais une blanche ou une ronde trop tôt.</p>'),
          practice('noires-blanches', 'R', 80, 'Noires, blanches et rondes (main droite)'),
          practice('noires-blanches', 'both', 70, 'Noires, blanches et rondes (mains ensemble)'),
          quiz('Pendant une ronde, vous comptez…', ['1', '1, 2', '1, 2, 3, 4', '1 et 2 et'], 2, 'Une ronde occupe les 4 temps de la mesure : on tient la touche en comptant jusqu’à 4.'),
        ],
      },
      {
        id: 'pm-dialogue',
        title: 'Questions et réponses',
        duration: 8,
        level: 1,
        blocks: [
          text('<p>Les mains se répondent : la droite pose une question sur les trois touches noires, la gauche répond sur les deux touches noires. Écoutez bien la phrase de l’autre main avant de répondre.</p>'),
          practice('touches-noires', 'both', 80, 'Promenade sur les touches noires'),
          tip('Sur les touches noires, jouez un peu plus près du bord des touches : elles sont plus étroites et plus hautes.'),
        ],
      },
      {
        id: 'pm-position-sol',
        title: 'Nouvelle position : Sol',
        duration: 10,
        level: 1,
        blocks: [
          text('<p>En déplaçant les mains, on peut jouer dans une autre tonalité. En <strong>position de Sol</strong>, le pouce droit est sur Sol (G4) et l’auriculaire gauche sur Sol (G2).</p>'),
          keys('Position de Sol', [...k('G2:5 A2:4 B2:3 C3:2 D3:1', 'L'), ...k('G4:1 A4:2 B4:3 C5:4 D5:5')], 'Les deux mains en position de Sol'),
          practice('cinq-doigts-sol', 'R', 80, 'Cinq doigts en Sol : main droite'),
          practice('cinq-doigts-sol', 'both', 70, 'Cinq doigts en Sol : mains ensemble'),
        ],
      },
    ],
  },

  // =====================================================================
  // CLASSIQUE
  // =====================================================================
  {
    id: 'classique',
    genre: 'classique',
    title: 'Le piano classique',
    description: 'Phrasé, basse d’Alberti, style baroque et romantique, ornements : les clés pour jouer les grands compositeurs.',
    lessons: [
      {
        id: 'cl-phrase',
        title: 'Le phrasé : faire chanter la mélodie',
        duration: 10,
        level: 1,
        blocks: [
          text(
            '<p>Une mélodie se découpe en <strong>phrases</strong>, comme un texte en phrases. Une phrase a un point de départ, une direction (souvent vers une note importante) et une fin où l’on « respire ».</p><ul><li>Chantez la mélodie avant de la jouer : là où vous respirez, la phrase se termine.</li><li>La fin de phrase se joue un peu plus doucement, comme une voix qui retombe.</li><li>Entre deux phrases, on lève légèrement la main.</li></ul>',
          ),
          practice('ode-joie', 'R', 80, 'Ode à la joie : 4 phrases de 4 mesures'),
          tip('Dans l’Ode à la joie, la phrase 1 se termine sur un Ré (suspensive, comme une virgule) et la phrase 2 sur un Do (conclusive, comme un point).'),
          practice('berceuse-brahms', 'both', 70, 'La Berceuse de Brahms : phrasé et main gauche douce'),
          quiz('Comment se joue généralement une fin de phrase ?', ['Plus fort, pour bien conclure', 'Un peu plus doucement, en relâchant', 'Plus vite', 'En staccato'], 1, 'Comme une voix qui termine sa phrase, le son se pose et diminue légèrement.'),
        ],
      },
      {
        id: 'cl-alberti',
        title: 'La basse d’Alberti',
        duration: 12,
        level: 3,
        blocks: [
          text(
            '<p>La <strong>basse d’Alberti</strong> est l’accompagnement typique de l’époque classique (Mozart, Haydn, Clementi) : on joue l’accord de la main gauche en ordre <strong>grave – aigu – médium – aigu</strong>. Pour Do majeur : Do-Sol-Mi-Sol.</p><p>Le pouce joue la note répétée (la plus aiguë) : il doit rester très léger. La note de basse, elle, porte l’harmonie.</p>',
          ),
          keys('Alberti en Do (main gauche)', k('C3:5 E3:3 G3:1', 'L'), 'Ordre de jeu : 5 – 1 – 3 – 1'),
          exercise('Basse d’Alberti seule', { L: 'C3:0.5:5 G3:0.5:1 E3:0.5:3 G3:0.5:1 C3:0.5:5 G3:0.5:1 E3:0.5:3 G3:0.5:1 | B2:0.5:5 G3:0.5:1 F3:0.5:2 G3:0.5:1 B2:0.5:5 G3:0.5:1 F3:0.5:2 G3:0.5:1 | C3:0.5:5 G3:0.5:1 E3:0.5:3 G3:0.5:1 C3:2:5' }, { tempo: 80, hands: 'L' }),
          exercise(
            'Alberti sous une mélodie dans l’esprit de Mozart',
            { R: 'C5:2 E5:1 G5:1 | B4:1.5 C5:0.25 D5:0.25 C5:2', L: 'C3:0.5 G3:0.5 E3:0.5 G3:0.5 C3:0.5 G3:0.5 E3:0.5 G3:0.5 | D3:0.5 G3:0.5 F3:0.5 G3:0.5 C3:0.5 G3:0.5 E3:0.5 G3:0.5' },
            { tempo: 72, hands: 'both' },
          ),
          tip('Pour l’égalité, travaillez la basse d’Alberti en rythmes : longue-courte, puis courte-longue. En revenant au rythme régulier, tout paraît plus facile.'),
        ],
      },
      {
        id: 'cl-baroque',
        title: 'Le style baroque : menuet et prélude',
        duration: 15,
        level: 3,
        blocks: [
          text(
            '<p>Dans la musique baroque (Bach, Haendel, Couperin), les deux mains sont souvent <strong>deux voix indépendantes</strong> d’égale importance : il n’y a pas une mélodie et un accompagnement, mais un dialogue.</p><ul><li>Toucher clair, plutôt détaché pour les noires, lié pour les croches.</li><li>Peu ou pas de pédale (le clavecin n’en avait pas).</li><li>Un tempo stable : c’est souvent une musique de danse.</li></ul>',
          ),
          practice('menuet-sol', 'R', 70, 'Menuet en Sol : main droite'),
          practice('menuet-sol', 'L', 70, 'Menuet en Sol : main gauche'),
          practice('menuet-sol', 'both', 60, 'Menuet en Sol : mains ensemble'),
          text('<p>Le <strong>Prélude en Do</strong> de Bach est construit autrement : un seul motif d’accord brisé, répété, dont l’harmonie change à chaque mesure. Plaquez chaque accord avant de le jouer en arpège.</p>'),
          practice('prelude-do', 'both', 70, 'Prélude en Do (BWV 846)'),
          practice('canon-pachelbel', 'L', 80, 'Canon de Pachelbel : apprendre la basse obstinée'),
        ],
      },
      {
        id: 'cl-ornements',
        title: 'Les ornements',
        duration: 10,
        level: 3,
        blocks: [
          text(
            '<p>Les <strong>ornements</strong> décorent une note principale :</p><ul><li><strong>Trille</strong> (tr) : alternance rapide de la note et de sa voisine supérieure. À l’époque baroque, on commence par la note supérieure.</li><li><strong>Mordant</strong> : note – voisine inférieure – note, très vite, sur le temps.</li><li><strong>Appoggiature</strong> : petite note avant la note principale, qui prend une part de sa durée et se résout dessus.</li><li><strong>Gruppetto</strong> (∾) : note supérieure – note – note inférieure – note.</li></ul>',
          ),
          exercise(
            'Trille, mordant et appoggiature',
            { R: 'D5:0.25:3 C5:0.25:2 D5:0.25:3 C5:0.25:2 D5:0.25:3 C5:0.25:2 B4:0.25:1 C5:0.25:2 C5:2:2 | G4:0.25:3 F4:0.25:2 G4:1.5:3 B4:0.25:3 A4:0.25:2 B4:1.5:3 | D5:1:4 C5:1:3 C5:2:3' },
            { tempo: 56, hands: 'R' },
          ),
          tip('Un ornement doit rester léger et élégant : apprenez d’abord le passage sans ornement, puis ajoutez-le sans jamais retarder le temps suivant.'),
          quiz('Un trille baroque commence généralement…', ['Par la note principale', 'Par la note supérieure', 'Par la note inférieure', 'Par un silence'], 1, 'Dans la musique baroque, le trille part de la note voisine supérieure, sur le temps.'),
        ],
      },
      {
        id: 'cl-elise',
        title: 'Lettre à Élise : mains alternées et pédale',
        duration: 15,
        level: 4,
        blocks: [
          text(
            '<p>La bagatelle de Beethoven repose sur un <strong>relais entre les mains</strong> : la main gauche lance un arpège (La-Mi-La), la main droite le prolonge (Do-Mi-La), comme une seule ligne continue.</p><ul><li>Le célèbre motif Mi-Ré♯ se joue avec les doigts 5-4 (ou 4-3), très lié, sans accent.</li><li>Changez la pédale à chaque mesure, au moment où la main gauche joue sa basse.</li><li>En 3/8, pensez « un » par mesure, et non trois croches : la musique flotte.</li></ul>',
          ),
          practice('lettre-elise', 'R', 60, 'Main droite seule'),
          practice('lettre-elise', 'L', 60, 'Main gauche seule'),
          practice('lettre-elise', 'both', 50, 'Mains ensemble, très lentement'),
          warning('Ne vous précipitez pas : beaucoup d’élèves jouent ce thème trop vite et trop fort. C’est une pièce intime, « poco moto ».'),
        ],
      },
    ],
  },

  // =====================================================================
  // COMPTINES
  // =====================================================================
  {
    id: 'comptines',
    genre: 'comptines',
    title: 'Comptines : jouer et chanter',
    description: 'Les chansons de l’enfance pour apprendre en s’amusant, seul ou avec les enfants.',
    lessons: [
      {
        id: 'co-chanter',
        title: 'Jouer et chanter en même temps',
        duration: 8,
        level: 1,
        blocks: [
          text(
            '<p>Chanter en jouant est un excellent exercice : la voix guide le phrasé, et le rythme devient naturel. Commencez par une chanson que vous connaissez par cœur.</p><ol><li>Chantez la chanson seul.</li><li>Jouez la mélodie en la chantant intérieurement.</li><li>Jouez et chantez à voix haute ensemble.</li></ol>',
          ),
          practice('clair-de-la-lune', 'R', 80, 'Au clair de la lune : main droite'),
          tip('Au milieu de la chanson (« Ma chandelle est morte »), la main droite se déplace : pouce sur le Sol grave. Préparez ce déplacement pendant la ronde qui précède.'),
          practice('clair-de-la-lune', 'both', 70, 'Au clair de la lune : mains ensemble'),
        ],
      },
      {
        id: 'co-canon',
        title: 'Frère Jacques en canon',
        duration: 10,
        level: 1,
        blocks: [
          text('<p>Un <strong>canon</strong> est une mélodie qui se superpose à elle-même avec un décalage. Frère Jacques est parfait pour ça : chaque nouvelle voix entre deux mesures après la précédente.</p>'),
          practice('frere-jacques', 'R', 80, 'Frère Jacques avec bourdon à la main gauche'),
          exercise(
            'Canon à deux mains',
            { R: 'C4:1:1 D4:1:2 E4:1:3 C4:1:1 | C4:1:1 D4:1:2 E4:1:3 C4:1:1 | E4:1:3 F4:1:4 G4:2:5 | E4:1:3 F4:1:4 G4:2:5', L: 'r:4 | r:4 | C3:1:5 D3:1:4 E3:1:3 C3:1:5 | C3:1:5 D3:1:4 E3:1:3 C3:1:5' },
            { tempo: 80, hands: 'both' },
          ),
          tip('Jouez le canon avec un enfant ou un ami : l’un au piano, l’autre qui chante avec deux mesures de décalage.'),
        ],
      },
      {
        id: 'co-etirer',
        title: 'Étirer la main : Ah ! vous dirai-je, maman',
        duration: 8,
        level: 1,
        blocks: [
          text('<p>Dans cet air, la main droite doit atteindre le La avec le 5e doigt alors que le pouce est sur le Do : on <strong>ouvre légèrement la main</strong>, sans crisper. Mozart en a tiré douze célèbres variations !</p>'),
          keys('Main droite étirée', k('C4:1 G4:4 A4:5'), 'Do (1) – Sol (4) – La (5)'),
          practice('ah-vous-dirai-je', 'R', 80, 'Main droite'),
          practice('ah-vous-dirai-je', 'both', 70, 'Mains ensemble'),
        ],
      },
      {
        id: 'co-anniversaire',
        title: 'Joyeux anniversaire : levée et rythme pointé',
        duration: 10,
        level: 2,
        blocks: [
          text('<p>« Joyeux anniversaire » commence <strong>avant</strong> la première mesure : c’est une <strong>levée</strong>. Les deux premières notes forment un rythme pointé (croche pointée + double croche) : un « taaa-ta » sautillant.</p>'),
          exercise('Le rythme pointé', { R: 'G4:0.75:1 G4:0.25:1 A4:1:2 G4:1:1 | G4:0.75:1 G4:0.25:1 A4:1:2 G4:1:1 | C5:3:4' }, { tempo: 80, timeSig: [3, 4], hands: 'R' }),
          practice('joyeux-anniversaire', 'R', 80, 'Main droite'),
          practice('joyeux-anniversaire', 'both', 70, 'Mains ensemble'),
          quiz('Que dure une croche pointée ?', ['½ temps', '¾ de temps', '1 temps', '1 temps ½'], 1, 'Croche (½) + son point (¼) = ¾ de temps. La double croche complète le temps.'),
        ],
      },
    ],
  },

  // =====================================================================
  // NOËL
  // =====================================================================
  {
    id: 'noel',
    genre: 'noel',
    title: 'Chants de Noël',
    description: 'Les chants de fête à jouer en famille, du plus simple au plus expressif.',
    lessons: [
      {
        id: 'no-vive-le-vent',
        title: 'Vive le vent : notes répétées',
        duration: 8,
        level: 1,
        blocks: [
          text('<p>Le refrain de « Vive le vent » tient entièrement dans la position de Do. La difficulté : les <strong>notes répétées</strong>. Pour qu’elles sonnent toutes, relâchez la touche à mi-hauteur entre deux notes, sans lever le doigt.</p>'),
          exercise('Notes répétées', { R: 'E4:1:3 E4:1:3 E4:2:3 | E4:1:3 E4:1:3 E4:2:3 | E4:1:3 G4:1:5 C4:1.5:1 D4:0.5:2 | E4:4:3' }, { tempo: 90, hands: 'R' }),
          practice('vive-le-vent', 'R', 90, 'Vive le vent : main droite'),
          practice('vive-le-vent', 'both', 75, 'Vive le vent : mains ensemble'),
        ],
      },
      {
        id: 'no-gamme',
        title: 'Joie sur la terre : la gamme qui chante',
        duration: 8,
        level: 2,
        blocks: [
          text('<p>Ce chant commence par une <strong>gamme descendante complète</strong>, de Do à Do. Doigté : 5-4-3-2-1 puis le 3e doigt passe par-dessus le pouce pour Mi-Ré-Do.</p>'),
          keys('Descente de la gamme', k('C5:5 B4:4 A4:3 G4:2 F4:1 E4:3 D4:2 C4:1'), 'Le 3 passe par-dessus le pouce entre Fa et Mi.'),
          practice('joie-sur-la-terre', 'R', 80, 'Main droite'),
          practice('joie-sur-la-terre', 'both', 70, 'Mains ensemble'),
        ],
      },
      {
        id: 'no-six-huit',
        title: 'Douce nuit : la mesure à 6/8',
        duration: 12,
        level: 3,
        blocks: [
          text('<p>En <strong>6/8</strong>, il y a 6 croches par mesure, groupées par 3 : on sent <strong>deux grands temps</strong> (deux noires pointées). C’est une mesure qui berce, idéale pour « Douce nuit ».</p><p>Comptez « <strong>1</strong>-2-3-<strong>4</strong>-5-6 » en appuyant sur 1 et 4.</p>'),
          exercise('Sentir le 6/8', { R: 'C4:1:1 D4:0.5:2 E4:1:3 F4:0.5:4 | G4:1.5:5 G4:1.5:5 | G4:0.75:5 F4:0.25:4 E4:0.5:3 D4:1.5:2 | C4:3:1' }, { tempo: 60, timeSig: [6, 8], hands: 'R' }),
          practice('douce-nuit', 'R', 80, 'Douce nuit : main droite'),
          practice('douce-nuit', 'both', 70, 'Douce nuit : mains ensemble'),
          quiz('Combien de « grands temps » dans une mesure à 6/8 ?', ['6', '3', '2', '8'], 2, 'Les 6 croches sont groupées par 3 : deux temps de noire pointée.'),
        ],
      },
      {
        id: 'no-deck',
        title: 'Deck the Halls : croches égales',
        duration: 10,
        level: 3,
        blocks: [
          text('<p>Ce Noël gallois enchaîne les « fa la la la la » en croches. Elles doivent être parfaitement <strong>égales</strong> : ni bousculées, ni traînantes. Travaillez avec le métronome à 60 % puis augmentez.</p>'),
          practice('deck-the-halls', 'R', 70, 'Main droite'),
          practice('deck-the-halls', 'both', 60, 'Mains ensemble'),
          tip('Jouez les « fa la la » un peu plus légers que le texte principal : ils sonnent comme un écho joyeux.'),
        ],
      },
    ],
  },

  // =====================================================================
  // FOLK
  // =====================================================================
  {
    id: 'folk',
    genre: 'folk',
    title: 'Folk & traditionnel',
    description: 'Des mélodies populaires pour travailler les rythmes pointés, les modes anciens et l’accompagnement « boum-tchak ».',
    lessons: [
      {
        id: 'fo-susanna',
        title: 'Oh! Susanna : l’accompagnement folk',
        duration: 10,
        level: 1,
        blocks: [
          text('<p>La musique folk américaine s’accompagne souvent en « <strong>boum-tchak</strong> » : une basse sur les temps 1 et 3, un accord léger sur les temps 2 et 4. Commencez par la version simple, puis essayez le motif ci-dessous.</p>'),
          practice('oh-susanna', 'both', 80, 'Oh! Susanna, mains ensemble'),
          exercise(
            'Accompagnement boum-tchak',
            { L: 'C3:1 E3+G3:1 G2:1 E3+G3:1 | C3:1 E3+G3:1 G2:1 E3+G3:1 | G2:1 B2+F3:1 D3:1 B2+F3:1 | C3:1 E3+G3:1 C3:2' },
            { tempo: 90, hands: 'L' },
          ),
          tip('La basse est jouée avec l’auriculaire, bien posée ; l’accord avec les doigts 3 et 1, tout léger, comme une caisse claire.'),
        ],
      },
      {
        id: 'fo-pointe',
        title: 'Ce n’est qu’un au revoir : le rythme pointé',
        duration: 10,
        level: 2,
        blocks: [
          text('<p>Le rythme <strong>noire pointée + croche</strong> donne leur élan aux chants écossais. La noire pointée dure 1 temps ½, la croche complète le 2e temps. Comptez « 1 — et 2 ».</p>'),
          exercise('Noire pointée – croche', { R: 'C4:1.5:1 C4:0.5:1 E4:1:3 G4:1:5 | F4:1.5:4 E4:0.5:3 D4:2:2 | E4:1.5:3 D4:0.5:2 C4:2:1' }, { tempo: 80, hands: 'R' }),
          practice('au-revoir', 'R', 80, 'Main droite'),
          practice('au-revoir', 'both', 70, 'Mains ensemble'),
        ],
      },
      {
        id: 'fo-modes',
        title: 'Greensleeves : couleurs modales',
        duration: 12,
        level: 3,
        blocks: [
          text('<p>Beaucoup de mélodies anciennes n’utilisent pas exactement nos gammes majeures et mineures, mais des <strong>modes</strong>. Greensleeves hésite entre le Sol naturel (couleur ancienne, presque dorienne) et le Sol♯ (sensible moderne, qui « tire » vers le La aux cadences).</p>'),
          exercise('Sol naturel ou Sol dièse ?', { R: 'A4:1:2 G4:1:1 A4:2:2 | A4:1:2 G#4:1:1 A4:2:2' }, { tempo: 60, hands: 'R' }),
          practice('greensleeves', 'R', 70, 'Greensleeves : main droite'),
          practice('greensleeves', 'both', 60, 'Greensleeves : mains ensemble'),
          quiz('Pourquoi le Sol♯ apparaît-il aux fins de phrases ?', ['Pour moderniser le morceau', 'C’est la sensible : elle attire l’oreille vers la tonique La', 'Pour faciliter le doigté', 'C’est une faute de copie'], 1, 'Un demi-ton sous la tonique, la sensible crée une tension qui se résout sur La : c’est la cadence du mineur harmonique.'),
        ],
      },
    ],
  },

  // =====================================================================
  // GOSPEL
  // =====================================================================
  {
    id: 'gospel',
    genre: 'gospel',
    title: 'Gospel & spirituals',
    description: 'Accords riches, septièmes, basses qui montent et cadences « Amen » : le son chaleureux de l’église afro-américaine.',
    lessons: [
      {
        id: 'go-saints',
        title: 'Oh When the Saints : jouer après le temps',
        duration: 8,
        level: 1,
        blocks: [
          text('<p>Chaque phrase de ce spiritual commence <strong>après</strong> le premier temps. Laissez le silence exister : c’est lui qui donne l’élan. Comptez « (un) deux trois quatre ».</p>'),
          practice('when-the-saints', 'R', 80, 'Main droite'),
          practice('when-the-saints', 'both', 70, 'Mains ensemble'),
          tip('Une fois à l’aise, essayez de jouer la main gauche en octaves (Do grave + Do aigu ensemble) : le son devient tout de suite plus « gospel ».'),
        ],
      },
      {
        id: 'go-amen',
        title: 'La cadence « Amen »',
        duration: 10,
        level: 2,
        blocks: [
          text('<p>La <strong>cadence plagale</strong> (IV → I, Fa → Do) est celle que l’on chante sur « A-men » à la fin des hymnes. Le gospel l’enrichit avec l’accord de <strong>Fa mineur</strong> (Fa-La♭-Do) juste avant la résolution : un frisson garanti.</p>'),
          keys('Fa/Do puis Fa mineur/Do', k('C3:5 F4:1 A4:3 C5:5 Ab4:3'), 'Le 3e doigt glisse du La au La♭.'),
          practice('amen-plagal', 'both', 80, 'Cadence « Amen »'),
          tip('Gardez le Do aigu (doigt 5) immobile : seuls les doigts intérieurs bougent. C’est le principe des « notes communes ».'),
        ],
      },
      {
        id: 'go-septiemes',
        title: 'Les accords de septième',
        duration: 12,
        level: 3,
        blocks: [
          text(
            '<p>Le gospel ajoute volontiers une 4e note aux accords : la <strong>septième</strong>.</p><ul><li><strong>Do7</strong> (septième de dominante) : Do-Mi-Sol-Si♭ — tendu, il appelle une résolution.</li><li><strong>Domaj7</strong> (septième majeure) : Do-Mi-Sol-Si — doux, rêveur.</li><li><strong>Rém7</strong> (mineur 7) : Ré-Fa-La-Do — chaleureux.</li></ul>',
          ),
          exercise(
            'Accords de septième de dominante',
            { R: 'C4+E4+G4+Bb4:4 | F4+A4+C5+Eb5:4 | G4+B4+D5+F5:4 | E4+G4+C5:4', L: 'C3:4 | F2:4 | G2:4 | C3:4' },
            { tempo: 60, hands: 'both' },
          ),
          practice('amazing-grace', 'R', 80, 'Amazing Grace : la mélodie'),
          practice('amazing-grace', 'both', 70, 'Amazing Grace : avec les accords de 7e'),
          quiz('Quelles sont les notes de Do7 ?', ['Do-Mi-Sol-Si', 'Do-Mi-Sol-Si♭', 'Do-Mi♭-Sol-Si♭', 'Do-Mi-Sol-La'], 1, 'Do7 = accord majeur + septième mineure (Si♭). Avec un Si naturel, ce serait Domaj7.'),
        ],
      },
      {
        id: 'go-passage',
        title: 'Basse qui monte et accords de passage',
        duration: 12,
        level: 3,
        blocks: [
          text('<p>Le pianiste gospel relie les accords principaux par des <strong>accords de passage</strong>, souvent portés par une basse qui monte par degrés : Do – Mi – Fa – Fa♯ – Sol. Le Fa♯ porte un Ré7 (Ré7/Fa♯) qui pousse vers le Sol.</p>'),
          exercise(
            'Basse chromatique Do → Sol',
            { R: 'E4+G4+C5:2 F4+A4+C5:1 F#4+A4+C5:1 | G4+B4+D5:4', L: 'C2+C3:1 E2+E3:1 F2+F3:1 F#2+F#3:1 | G2+G3:4' },
            { tempo: 66, hands: 'both' },
          ),
          practice('dimanche-matin', 'L', 80, 'Dimanche matin : la basse en octaves'),
          practice('dimanche-matin', 'both', 70, 'Dimanche matin : mains ensemble'),
        ],
      },
    ],
  },

  // =====================================================================
  // JAZZ & BLUES
  // =====================================================================
  {
    id: 'jazz',
    genre: 'jazz',
    title: 'Jazz & blues',
    description: 'Gamme blues, swing, grille de 12 mesures, voicings et walking bass : les fondations du langage jazz.',
    lessons: [
      {
        id: 'ja-gamme-blues',
        title: 'La gamme blues',
        duration: 10,
        level: 2,
        blocks: [
          text('<p>La <strong>gamme blues</strong> de Do contient six notes : <strong>Do – Mi♭ – Fa – Fa♯ – Sol – Si♭</strong>. Le Fa♯ (la « blue note ») et le Mi♭ frottés sur un accord majeur créent ce son plaintif et irrésistible.</p>'),
          keys('Gamme blues de Do', k('C4:1 Eb4:2 F4:3 F#4:4 G4:1 Bb4:2 C5:3'), 'Doigté main droite : 1-2-3-4, puis le pouce passe sur le Sol.'),
          practice('gamme-blues-do', 'R', 70, 'Gamme blues : main droite'),
          practice('gamme-blues-do', 'L', 70, 'Gamme blues : main gauche'),
          tip('Improvisez ! Laissez la main gauche tenir Do-Sol et piochez librement 3 ou 4 notes de la gamme blues. Impossible de faire une « fausse note ».'),
        ],
      },
      {
        id: 'ja-swing',
        title: 'Le swing : croches ternaires',
        duration: 10,
        level: 2,
        blocks: [
          text('<p>En jazz, deux croches écrites ne sont pas jouées égales : la première est plus longue (2/3 du temps), la seconde plus courte (1/3). On les appelle <strong>croches swing</strong> ou ternaires. Dites « <strong>dou</strong>-ba <strong>dou</strong>-ba » : vous swinguez déjà.</p>'),
          exercise('Croches swing', { R: 'C4:2/3:1 D4:1/3:2 E4:2/3:3 F4:1/3:4 G4:2/3:5 A4:1/3:5 G4:2/3:4 E4:1/3:2 | C4:2:1 r:2' }, { tempo: 90, hands: 'R' }),
          tip('Le swing, c’est aussi l’accent : appuyez légèrement les contretemps (la 2e croche de chaque paire) et les temps 2 et 4.'),
          quiz('Dans des croches swing, la première croche dure…', ['1/2 temps', '2/3 de temps', '1/3 de temps', '3/4 de temps'], 1, 'Le temps est divisé en trois : la 1re croche prend deux tiers, la 2e un tiers.'),
        ],
      },
      {
        id: 'ja-douze-mesures',
        title: 'La grille de blues en 12 mesures',
        duration: 15,
        level: 3,
        blocks: [
          text('<p>Le blues repose sur une grille immuable de <strong>12 mesures</strong> et trois accords (I, IV, V) :</p><p style="text-align:center"><strong>Do7 Do7 Do7 Do7 | Fa7 Fa7 Do7 Do7 | Sol7 Fa7 Do7 Sol7</strong></p><p>Comptez les mesures à voix haute en jouant les accords : il faut savoir à tout moment où l’on en est dans la grille.</p>'),
          exercise(
            'La grille avec des accords à deux sons',
            {
              R: 'E4+Bb4:4 | E4+Bb4:4 | E4+Bb4:4 | E4+Bb4:4 | Eb4+A4:4 | Eb4+A4:4 | E4+Bb4:4 | E4+Bb4:4 | F4+B4:4 | Eb4+A4:4 | E4+Bb4:4 | F4+B4:4',
              L: 'C3:4 | C3:4 | C3:4 | C3:4 | F2:4 | F2:4 | C3:4 | C3:4 | G2:4 | F2:4 | C3:4 | G2:4',
            },
            { tempo: 80, hands: 'both' },
          ),
          tip('Remarquez comme les deux notes de la main droite (tierce et septième) bougent d’un demi-ton seulement : Mi-Si♭ → Mi♭-La. C’est le secret de la fluidité.'),
          practice('blues-do', 'L', 80, 'Blues en Do : le shuffle de la main gauche'),
          practice('blues-do', 'both', 70, 'Blues en Do : mains ensemble'),
        ],
      },
      {
        id: 'ja-voicings',
        title: 'Shell voicings et II-V-I',
        duration: 15,
        level: 3,
        blocks: [
          text(
            '<p>L’enchaînement <strong>II-V-I</strong> (Rém7 – Sol7 – Domaj7 en Do) est partout dans les standards de jazz. Pour le jouer, les pianistes utilisent des <strong>shell voicings</strong> (« accords coquilles ») : seulement la fondamentale, la tierce et la septième. La quinte, peu utile, est omise.</p><p>À la main gauche : fondamentale + septième, ou fondamentale + tierce, en alternance pour bouger le moins possible.</p>',
          ),
          exercise(
            'II-V-I en shell voicings (main gauche)',
            { R: 'F4:4 | F4:2 E4:2 | E4:4', L: 'D3+C4:4 | G2+F3:4 | C3+B3:4' },
            { tempo: 66, hands: 'both' },
          ),
          practice('deux-cinq-un', 'both', 80, 'II-V-I dans trois tonalités'),
          quiz('Dans un II-V-I en Do, quels sont les trois accords ?', ['Do – Fa – Sol', 'Rém7 – Sol7 – Domaj7', 'Lam7 – Rém7 – Sol7', 'Sol7 – Do – Fa'], 1, 'II = Ré mineur 7, V = Sol 7, I = Do majeur 7.'),
        ],
      },
      {
        id: 'ja-walking',
        title: 'La walking bass',
        duration: 15,
        level: 4,
        blocks: [
          text(
            '<p>La <strong>walking bass</strong> « marche » en noires régulières. Recette simple pour chaque mesure :</p><ul><li><strong>Temps 1</strong> : la fondamentale de l’accord.</li><li><strong>Temps 2 et 3</strong> : d’autres notes de l’accord (tierce, quinte) ou des notes de la gamme.</li><li><strong>Temps 4</strong> : une <strong>note d’approche</strong>, un demi-ton au-dessus ou en dessous de la prochaine fondamentale.</li></ul>',
          ),
          exercise('Walking bass seule sur Fa7 – Si♭7', { L: 'F2:1 A2:1 C3:1 A2:1 | Bb2:1 D3:1 F3:1 E3:1 | F3:1 Eb3:1 C3:1 A2:1 | Bb2:2 F2:2' }, { tempo: 90, hands: 'L' }),
          practice('walking-fa', 'L', 70, 'Walking bass en Fa : main gauche seule'),
          practice('walking-fa', 'both', 60, 'Walking bass en Fa : avec le comping'),
          warning('La walking bass ne doit jamais ralentir ni accélérer : c’est le métronome du groupe. Travaillez-la toujours avec un clic sur les temps 2 et 4.'),
        ],
      },
    ],
  },

  // =====================================================================
  // RAGTIME
  // =====================================================================
  {
    id: 'ragtime',
    genre: 'ragtime',
    title: 'Ragtime',
    description: 'Main gauche stride et syncopes de la main droite : l’ancêtre joyeux du jazz.',
    lessons: [
      {
        id: 'ra-stride',
        title: 'La main gauche stride',
        duration: 12,
        level: 3,
        blocks: [
          text('<p>Le ragtime est construit sur une main gauche en « <strong>oum-pa</strong> » appelée <strong>stride</strong> (« enjambée ») : une basse grave sur les temps 1 et 3 (souvent alternant fondamentale et quinte), un accord médium sur les temps 2 et 4. La main fait des sauts constants.</p>'),
          tip('Pour viser juste sans regarder : gardez la main près des touches pendant le saut, et « sentez » la distance avec le bras. Le pouce sert de repère pour l’accord.'),
          exercise('Le saut basse-accord', { L: 'C2:1 E3+G3+C4:1 | G1:1 E3+G3+C4:1 | C2:1 E3+G3+C4:1 | G1:1 E3+G3+C4:1' }, { tempo: 60, timeSig: [2, 4], hands: 'L' }),
          practice('stride-do', 'L', 70, 'Exercice de stride : main gauche'),
          practice('stride-do', 'both', 70, 'Exercice de stride : mains ensemble'),
        ],
      },
      {
        id: 'ra-syncope',
        title: 'La syncope ragtime',
        duration: 12,
        level: 4,
        blocks: [
          text('<p>Le mot « ragtime » vient de « ragged time », le temps déchiré. La main droite joue des <strong>syncopes</strong> : des notes attaquées entre les temps et prolongées par-dessus. Le motif typique est <strong>double croche – croche – double croche</strong>.</p>'),
          exercise('Syncope de base', { R: 'C5:0.25 E5:0.5 C5:0.25 E5:1 | C5:0.25 E5:0.5 C5:0.25 G5:0.5 E5:0.5 | C5:2' }, { tempo: 60, timeSig: [2, 4], hands: 'R' }),
          tip('Pendant que la main droite syncope, la main gauche reste imperturbable. Travaillez en tapant la main gauche sur la cuisse et en chantant la main droite.'),
          practice('petit-rag', 'R', 70, 'Petit rag : main droite'),
          practice('petit-rag', 'both', 60, 'Petit rag : mains ensemble'),
        ],
      },
      {
        id: 'ra-entertainer',
        title: 'The Entertainer',
        duration: 20,
        level: 5,
        blocks: [
          text('<p>Le chef-d’œuvre de Scott Joplin (1902), rendu célèbre par le film <em>L’Arnaque</em>. Tout ce que vous avez appris s’y retrouve : levée chromatique (Ré-Ré♯-Mi), syncopes, stride.</p><ul><li>Main droite seule d’abord, à 50 %.</li><li>Puis la main gauche seule, en visant juste.</li><li>Enfin mains ensemble, mesure par mesure.</li></ul>'),
          practice('entertainer', 'R', 50, 'Main droite seule, lentement'),
          practice('entertainer', 'L', 60, 'Main gauche seule'),
          practice('entertainer', 'both', 50, 'Mains ensemble'),
          warning('Joplin l’écrivait lui-même en tête de ses partitions : « Not fast ». Un rag joué trop vite perd tout son charme.'),
        ],
      },
    ],
  },

  // =====================================================================
  // POP & ACCORDS
  // =====================================================================
  {
    id: 'pop',
    genre: 'pop',
    title: 'Pop & accords',
    description: 'Grilles d’accords, renversements, rythmes et arpèges pour accompagner n’importe quelle chanson.',
    lessons: [
      {
        id: 'po-quatre-accords',
        title: 'Les quatre accords magiques',
        duration: 10,
        level: 2,
        blocks: [
          text(
            '<p>D’innombrables chansons pop utilisent les mêmes accords, construits sur les degrés I, V, vi et IV de la gamme. En Do : <strong>Do – Sol – La mineur – Fa</strong>.</p><p>Connaître ces quatre accords, c’est pouvoir accompagner des centaines de chansons. Et en changeant l’ordre (vi-IV-I-V : Lam – Fa – Do – Sol), on obtient d’autres ambiances.</p>',
          ),
          keys('Les 4 accords en position serrée', k('C4:1 E4:3 G4:5 B3:1 D4:2 A4:5 F4:3'), 'Do (Do-Mi-Sol), Sol/Si (Si-Ré-Sol), Lam (Do-Mi-La), Fa/Do (Do-Fa-La)'),
          practice('quatre-accords', 'R', 80, 'Main droite seule'),
          practice('quatre-accords', 'both', 70, 'Mains ensemble'),
          quiz('En Do majeur, quel accord est sur le 6e degré (vi) ?', ['Fa majeur', 'La mineur', 'Sol majeur', 'Mi mineur'], 1, 'Le 6e degré de la gamme de Do est La ; l’accord La-Do-Mi est mineur.'),
        ],
      },
      {
        id: 'po-renversements',
        title: 'Enchaîner avec les renversements',
        duration: 10,
        level: 2,
        blocks: [
          text('<p>Jouer tous les accords en position fondamentale oblige la main à sauter. En choisissant le bon <strong>renversement</strong>, on garde les notes communes et on déplace les autres au plus près : c’est la <strong>conduite des voix</strong>.</p>'),
          exercise('Do – Lam – Fa – Sol sans sauter', { R: 'C4+E4+G4:4:1+3+5 | C4+E4+A4:4:1+2+5 | C4+F4+A4:4:1+3+5 | B3+D4+G4:4:1+2+5', L: 'C3:4:1 | A2:4:3 | F2:4:5 | G2:4:4' }, { tempo: 70, hands: 'both' }),
          tip('Règle d’or : si une note est commune aux deux accords, elle ne bouge pas. Les autres prennent le chemin le plus court.'),
          practice('renversements', 'R', 70, 'Tous les renversements de Do, Fa et Sol'),
        ],
      },
      {
        id: 'po-rythmes',
        title: 'Rythmes d’accompagnement',
        duration: 12,
        level: 3,
        blocks: [
          text('<p>Le même accord peut sonner calme ou entraînant selon le <strong>rythme</strong>. Trois patterns à connaître :</p><ul><li><strong>Noires régulières</strong> : simple et efficace.</li><li><strong>Croches</strong> : plus d’énergie, style rock.</li><li><strong>3-3-2</strong> : trois croches + trois croches + deux croches, la syncope incontournable de la pop.</li></ul>'),
          exercise('Croches régulières', { R: 'C4+E4+G4:0.5:1+3+5 C4+E4+G4:0.5:1+3+5 C4+E4+G4:0.5:1+3+5 C4+E4+G4:0.5:1+3+5 C4+E4+G4:0.5:1+3+5 C4+E4+G4:0.5:1+3+5 C4+E4+G4:0.5:1+3+5 C4+E4+G4:0.5:1+3+5 | C4+E4+G4:4:1+3+5', L: 'C3:4:1 | C3:4:1' }, { tempo: 90, hands: 'both' }),
          practice('rythme-pop', 'R', 80, 'Le rythme 3-3-2'),
          practice('rythme-pop', 'both', 70, 'Le rythme 3-3-2 aux deux mains'),
          practice('valse-accords', 'both', 80, 'En 3/4 : la valse des accords'),
        ],
      },
      {
        id: 'po-ballade',
        title: 'Arpèges et ballade',
        duration: 12,
        level: 3,
        blocks: [
          text('<p>Pour une ballade, la main gauche égrène les accords en <strong>arpèges</strong> (fondamentale – quinte – octave – quinte) pendant que la main droite chante. La pédale, changée à chaque accord, relie le tout.</p>'),
          exercise('Arpège 1-5-8-5', { L: 'A2:0.5 E3:0.5 A3:0.5 E3:0.5 A2:0.5 E3:0.5 A3:0.5 E3:0.5 | F2:0.5 C3:0.5 F3:0.5 C3:0.5 F2:0.5 C3:0.5 F3:0.5 C3:0.5' }, { tempo: 72, hands: 'L' }),
          practice('pluie-automne', 'L', 80, 'Pluie d’automne : main gauche'),
          practice('pluie-automne', 'both', 70, 'Pluie d’automne : mains ensemble'),
          tip('Faites ressortir la mélodie : main droite <em>mf</em>, main gauche <em>p</em>. L’équilibre entre les mains est la clé d’une belle ballade.'),
        ],
      },
    ],
  },

  // =====================================================================
  // TECHNIQUE
  // =====================================================================
  {
    id: 'technique',
    genre: 'technique',
    title: 'Technique : gammes, arpèges, Hanon',
    description: 'Une routine quotidienne pour gagner en agilité, en régularité et en indépendance des doigts.',
    lessons: [
      {
        id: 'te-routine',
        title: 'La routine d’échauffement',
        duration: 8,
        level: 1,
        blocks: [
          text('<p>Comme un sportif, le pianiste s’échauffe. Une bonne routine de 5 à 10 minutes :</p><ol><li>Relâcher les épaules, secouer doucement les mains.</li><li>Cinq doigts, mains ensemble, lentement.</li><li>Une gamme et son arpège (changez de tonalité chaque jour).</li><li>Un exercice de Hanon.</li></ol>'),
          practice('echauffement', 'both', 70, 'Échauffement à cinq doigts'),
          exercise(
            'Mouvement contraire en croches',
            { R: 'C4:0.5:1 D4:0.5:2 E4:0.5:3 F4:0.5:4 G4:0.5:5 F4:0.5:4 E4:0.5:3 D4:0.5:2 | C4:4:1', L: 'C3:0.5:1 B2:0.5:2 A2:0.5:3 G2:0.5:4 F2:0.5:5 G2:0.5:4 A2:0.5:3 B2:0.5:2 | C3:4:1' },
            { tempo: 72, hands: 'both' },
          ),
          warning('Un échauffement ne doit jamais fatiguer. Si la main se crispe, arrêtez-vous, secouez-la et reprenez plus lentement.'),
        ],
      },
      {
        id: 'te-gammes',
        title: 'Gammes majeures et mineures',
        duration: 15,
        level: 2,
        blocks: [
          text('<p>Les gammes construisent l’agilité, la connaissance des tonalités et le passage du pouce. Pour les tonalités de Do, Sol, Ré, La mineur et Mi mineur, le doigté est le même :</p><ul><li><strong>Main droite</strong> : 1-2-3, 1-2-3-4 (puis 5 au sommet)</li><li><strong>Main gauche</strong> : 5-4-3-2-1, 3-2-1</li></ul><p>Exception : <strong>Fa majeur</strong> à la main droite, 1-2-3-4, 1-2-3 (le 4 tombe sur le Si♭).</p>'),
          practice('gamme-do', 'R', 70, 'Do majeur : main droite'),
          practice('gamme-do', 'L', 70, 'Do majeur : main gauche'),
          practice('gamme-sol', 'both', 60, 'Sol majeur : mains ensemble'),
          practice('gamme-re', 'both', 60, 'Ré majeur : mains ensemble'),
          practice('gamme-fa', 'R', 70, 'Fa majeur : le doigté spécial de la main droite'),
          text('<p>La gamme <strong>mineure harmonique</strong> élève le 7e degré d’un demi-ton (Sol♯ en La mineur) : on obtient une seconde augmentée Fa–Sol♯, très expressive.</p>'),
          practice('gamme-la-mineur', 'both', 60, 'La mineur harmonique'),
          practice('gamme-mi-mineur', 'both', 60, 'Mi mineur harmonique'),
          tip('Mains ensemble, les pouces ne passent pas au même moment : repérez les endroits où ils se croisent et travaillez-les lentement.'),
        ],
      },
      {
        id: 'te-arpeges',
        title: 'Arpèges et accords',
        duration: 12,
        level: 3,
        blocks: [
          text('<p>Un <strong>arpège</strong> est un accord joué note après note. Sur deux octaves, le pouce passe sous la main en faisant un écart plus grand que dans une gamme : le poignet doit glisser latéralement, souplement.</p>'),
          keys('Arpège de Do (main droite)', k('C4:1 E4:2 G4:3 C5:1 E5:2 G5:3 C6:5'), '1-2-3, passage du pouce, 1-2-3-5'),
          practice('arpeges-do-la', 'R', 60, 'Arpèges : main droite'),
          practice('arpeges-do-la', 'L', 60, 'Arpèges : main gauche'),
          practice('renversements', 'R', 70, 'Accords et renversements'),
          quiz('Quel doigté pour l’arpège de Do sur une octave à la main gauche (en montant) ?', ['1-2-3-5', '5-4-2-1', '5-3-2-1', '1-3-5-1'], 1, 'Main gauche : 5 sur Do, 4 sur Mi, 2 sur Sol, 1 sur Do.'),
        ],
      },
      {
        id: 'te-hanon',
        title: 'Hanon et gamme chromatique',
        duration: 12,
        level: 3,
        blocks: [
          text('<p>Les exercices de <strong>Charles-Louis Hanon</strong> (1873) travaillent la force et l’indépendance de chaque doigt, en particulier les 4e et 5e, naturellement plus faibles. Règles :</p><ul><li>Doigts recourbés, articulés depuis la base (la jointure).</li><li>Nuance égale, tempo parfaitement régulier.</li><li>Commencez lentement (♩ = 60) ; ne dépassez jamais la vitesse où tout reste relâché.</li></ul>'),
          practice('hanon-1', 'R', 70, 'Hanon n°1 : main droite'),
          practice('hanon-1', 'L', 70, 'Hanon n°1 : main gauche'),
          practice('hanon-1', 'both', 60, 'Hanon n°1 : mains ensemble'),
          text('<p>La <strong>gamme chromatique</strong> utilise toutes les touches. Le doigté se résume ainsi : pouce sur les touches blanches, 3 sur les noires, et 1-2 entre deux touches blanches voisines (Mi-Fa, Si-Do).</p>'),
          practice('gamme-chromatique', 'R', 70, 'Gamme chromatique : main droite'),
          practice('gamme-chromatique', 'L', 70, 'Gamme chromatique : main gauche'),
        ],
      },
    ],
  },
];

const COURSE_BY_ID = new Map(COURSES.map((c) => [c.id, c]));

export function getCourse(id) {
  return COURSE_BY_ID.get(id) || null;
}

export function getLesson(id) {
  for (const course of COURSES) {
    const lesson = course.lessons.find((l) => l.id === id);
    if (lesson) return { course, lesson };
  }
  return null;
}

export function allLessons() {
  return COURSES.flatMap((c) => c.lessons);
}
