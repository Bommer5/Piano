# Sources et statut juridique des morceaux

Tous les morceaux de `js/data/songs.js` sont soit des œuvres du **domaine public** (compositeur mort depuis plus de 70 ans, ou air traditionnel), soit des **compositions et exercices originaux** écrits pour Piano Coach. Les arrangements (main gauche, doigtés, simplifications, transpositions) sont tous originaux.

Règles appliquées :
- la mélodie est reproduite d'après la version de référence connue (éditions anciennes, recueils traditionnels) ; en cas de doute sur une note ou un rythme, le morceau est **omis** plutôt que publié faux ;
- aucune édition moderne protégée n'est copiée (doigtés et accompagnements écrits pour l'application) ;
- seules les mélodies sont utilisées : les paroles éventuellement protégées (traductions récentes) ne figurent pas dans l'application ;
- chaque morceau doit figurer dans ce tableau (vérifié par `tests/unit/content.test.mjs`).

| Identifiant | Titre | Genre | Niv. | Provenance |
|---|---|---|---|---|
| `cinq-doigts-do` | Cinq doigts en Do | Premiers pas | 1 | Composition / exercice original écrit pour Piano Coach. |
| `main-gauche-do` | La main gauche se promène | Premiers pas | 1 | Composition / exercice original écrit pour Piano Coach. |
| `noires-blanches` | Noires, blanches et rondes | Premiers pas | 1 | Composition / exercice original écrit pour Piano Coach. |
| `touches-noires` | Promenade sur les touches noires | Premiers pas | 1 | Composition / exercice original écrit pour Piano Coach. |
| `cinq-doigts-sol` | Cinq doigts en Sol | Premiers pas | 1 | Composition / exercice original écrit pour Piano Coach. |
| `ode-joie` | Ode à la joie | Classique | 1 | Beethoven (1770-1827), Symphonie n°9 op. 125, finale (1824). Domaine public. |
| `menuet-sol` | Menuet en Sol | Classique | 3 | Christian Petzold (1677-1733), Menuet BWV Anh. 114, Petit livre d’Anna Magdalena Bach (1725). Domaine public. |
| `lettre-elise` | Lettre à Élise (thème) | Classique | 4 | Beethoven (1770-1827), Bagatelle WoO 59 (1810, publiée 1867). Domaine public. |
| `prelude-do` | Prélude en Do (BWV 846), début | Classique | 3 | J.-S. Bach (1685-1750), Clavier bien tempéré I, Prélude BWV 846 (1722). Domaine public. |
| `berceuse-brahms` | Berceuse | Classique | 3 | Brahms (1833-1897), Wiegenlied op. 49 n°4 (1868). Domaine public. |
| `canon-pachelbel` | Canon en Ré (simplifié) | Classique | 3 | Pachelbel (1653-1706), Canon en Ré. Domaine public. |
| `clair-de-la-lune` | Au clair de la lune | Comptines | 1 | Chanson populaire française (XVIIIe s.). Domaine public. |
| `frere-jacques` | Frère Jacques | Comptines | 1 | Chanson populaire française (XVIIIe s.). Domaine public. |
| `ah-vous-dirai-je` | Ah ! vous dirai-je, maman | Comptines | 1 | Air populaire français (vers 1760) ; variations K. 265 de Mozart (1756-1791). Domaine public. |
| `joyeux-anniversaire` | Joyeux anniversaire | Comptines | 2 | Mildred J. Hill (1859-1916) et Patty S. Hill (1868-1946), air « Good Morning to All » (1893). Auteures mortes depuis plus de 70 ans ; mélodie dans le domaine public. |
| `vive-le-vent` | Vive le vent | Noël | 1 | James Lord Pierpont (1822-1893), « Jingle Bells » (1857). Mélodie seule (sans les paroles françaises de 1948). Domaine public. |
| `joie-sur-la-terre` | Joie sur la terre (Joy to the World) | Noël | 2 | Lowell Mason (1792-1872), air « Antioch » (1839), d’après Haendel. Domaine public. |
| `douce-nuit` | Douce nuit | Noël | 3 | Franz Xaver Gruber (1787-1863), « Stille Nacht » (1818). Domaine public. |
| `deck-the-halls` | Deck the Halls (Noël gallois) | Noël | 3 | Air gallois traditionnel « Nos Galan » (XVIIIe s.). Domaine public. |
| `greensleeves` | Greensleeves | Folk & traditionnel | 3 | Air anglais traditionnel (XVIe s.). Domaine public. |
| `au-revoir` | Ce n’est qu’un au revoir (Auld Lang Syne) | Folk & traditionnel | 2 | Air écossais traditionnel « Auld Lang Syne » (paroles de Robert Burns, 1788). Domaine public. |
| `oh-susanna` | Oh! Susanna | Folk & traditionnel | 1 | Stephen Foster (1826-1864), 1848. Domaine public. |
| `amazing-grace` | Amazing Grace | Gospel & spirituals | 3 | Air traditionnel « New Britain » (1829), paroles de John Newton (1779). Domaine public. |
| `when-the-saints` | Oh When the Saints | Gospel & spirituals | 1 | Spiritual afro-américain traditionnel. Domaine public. |
| `amen-plagal` | Cadence « Amen » | Gospel & spirituals | 2 | Composition / exercice original écrit pour Piano Coach. |
| `dimanche-matin` | Dimanche matin | Gospel & spirituals | 3 | Composition / exercice original écrit pour Piano Coach. |
| `gamme-blues-do` | Gamme blues en Do | Jazz & blues | 2 | Composition / exercice original écrit pour Piano Coach. |
| `blues-do` | Blues en Do (12 mesures) | Jazz & blues | 3 | Composition / exercice original écrit pour Piano Coach. |
| `deux-cinq-un` | II-V-I dans trois tonalités | Jazz & blues | 3 | Composition / exercice original écrit pour Piano Coach. |
| `walking-fa` | Walking bass en Fa | Jazz & blues | 4 | Composition / exercice original écrit pour Piano Coach. |
| `stride-do` | Exercice de stride | Ragtime | 3 | Composition / exercice original écrit pour Piano Coach. |
| `petit-rag` | Petit rag du dimanche | Ragtime | 4 | Composition / exercice original écrit pour Piano Coach. |
| `entertainer` | The Entertainer (thème, simplifié) | Ragtime | 5 | Scott Joplin (1868-1917), 1902. Domaine public. |
| `quatre-accords` | Les quatre accords (I–V–vi–IV) | Pop & accords | 2 | Composition / exercice original écrit pour Piano Coach. |
| `valse-accords` | Valse des accords | Pop & accords | 3 | Composition / exercice original écrit pour Piano Coach. |
| `pluie-automne` | Pluie d’automne (ballade) | Pop & accords | 3 | Composition / exercice original écrit pour Piano Coach. |
| `rythme-pop` | Rythme 3-3-2 | Pop & accords | 3 | Composition / exercice original écrit pour Piano Coach. |
| `echauffement` | Échauffement à cinq doigts | Gammes, arpèges, Hanon | 1 | Composition / exercice original écrit pour Piano Coach. |
| `gamme-do` | Gamme de Do majeur (2 octaves) | Gammes, arpèges, Hanon | 2 | Composition / exercice original écrit pour Piano Coach. |
| `gamme-sol` | Gamme de Sol majeur (2 octaves) | Gammes, arpèges, Hanon | 2 | Composition / exercice original écrit pour Piano Coach. |
| `gamme-re` | Gamme de Ré majeur (2 octaves) | Gammes, arpèges, Hanon | 3 | Composition / exercice original écrit pour Piano Coach. |
| `gamme-fa` | Gamme de Fa majeur (2 octaves) | Gammes, arpèges, Hanon | 3 | Composition / exercice original écrit pour Piano Coach. |
| `gamme-la-mineur` | Gamme de La mineur harmonique (2 octaves) | Gammes, arpèges, Hanon | 3 | Composition / exercice original écrit pour Piano Coach. |
| `gamme-mi-mineur` | Gamme de Mi mineur harmonique (2 octaves) | Gammes, arpèges, Hanon | 3 | Composition / exercice original écrit pour Piano Coach. |
| `gamme-chromatique` | Gamme chromatique | Gammes, arpèges, Hanon | 4 | Composition / exercice original écrit pour Piano Coach. |
| `hanon-1` | Hanon n°1 (sur une octave) | Gammes, arpèges, Hanon | 3 | Charles-Louis Hanon (1819-1900), « Le Pianiste virtuose » (1873), exercice n°1 (réduit à une octave). Domaine public. |
| `arpeges-do-la` | Arpèges de Do majeur et La mineur | Gammes, arpèges, Hanon | 4 | Composition / exercice original écrit pour Piano Coach. |
| `renversements` | Accords parfaits et renversements | Gammes, arpèges, Hanon | 3 | Composition / exercice original écrit pour Piano Coach. |
| `petits-pains-chauds` | Petits pains chauds (Hot Cross Buns) | Premiers pas | 1 | Comptine anglaise traditionnelle « Hot Cross Buns » (XVIIIe s.). Domaine public. |
| `petits-canards` | Tous mes petits canards (Alle meine Entchen) | Premiers pas | 1 | Chanson enfantine allemande traditionnelle « Alle meine Entchen » (XIXe s.). Domaine public. |
| `marie-agneau` | Marie avait un petit agneau | Comptines | 1 | Comptine américaine « Mary Had a Little Lamb » (poème de Sarah J. Hale, 1830 ; air associé à Lowell Mason, 1792-1872). Domaine public. |
| `pont-de-londres` | Le pont de Londres (London Bridge) | Comptines | 1 | Comptine anglaise traditionnelle « London Bridge Is Falling Down » (XVIIe-XVIIIe s.). Domaine public. |
| `petit-jean` | Petit Jean (Hänschen klein) | Comptines | 1 | Chanson enfantine allemande traditionnelle « Hänschen klein » (paroles de Franz Wiedemann, 1860). Domaine public. |
| `ferme-mathurin` | Dans la ferme de Mathurin | Comptines | 1 | Chanson traditionnelle « Old MacDonald Had a Farm » (début XXe s., air plus ancien) ; version française traditionnelle. Domaine public. |
| `rame-doucement` | Rame, rame doucement (Row, Row, Row Your Boat) | Comptines | 2 | Eliphalet Oram Lyte (1842-1913), « Row, Row, Row Your Boat » (1881). Domaine public. |
| `drunken-sailor` | Drunken Sailor (chant de marins) | Folk & traditionnel | 2 | Chant de marins traditionnel (XIXe s.), mode de Ré dorien. Domaine public. |
| `korobeiniki` | Korobeïniki (Les colporteurs) | Folk & traditionnel | 3 | Chanson populaire russe (poème de Nikolaï Nekrassov, 1861 ; air traditionnel). Arrangement original, indépendant de toute adaptation moderne. Domaine public. |
| `nous-vous-souhaitons` | Nous vous souhaitons un joyeux Noël | Noël | 2 | Chant de Noël traditionnel anglais (West Country, XVIe-XIXe s.). Domaine public. |
| `bon-roi-venceslas` | Le bon roi Venceslas (Good King Wenceslas) | Noël | 2 | Air « Tempus adest floridum », recueil Piae Cantiones (1582) ; paroles anglaises de J. M. Neale (1853). Domaine public. |
| `anges-campagnes` | Les anges dans nos campagnes | Noël | 3 | Noël traditionnel français (XVIIIe s.), refrain « Gloria in excelsis Deo ». Domaine public. |
| `roi-montagne` | Dans l’antre du roi de la montagne (thème) | Classique | 3 | Edvard Grieg (1843-1907), « Peer Gynt » op. 23 (1875), transposé de Si mineur en La mineur. Domaine public. |
| `gymnopedie-1` | Gymnopédie n°1 (début) | Classique | 4 | Erik Satie (1866-1925), Gymnopédie n°1 (1888), mesures 1 à 10. Mort depuis plus de 70 ans : domaine public. |
| `gamme-la` | Gamme de La majeur (2 octaves) | Gammes, arpèges, Hanon | 3 | Composition / exercice original écrit pour Piano Coach. |
| `gamme-si-bemol` | Gamme de Si♭ majeur (2 octaves) | Gammes, arpèges, Hanon | 3 | Composition / exercice original écrit pour Piano Coach. |

## Exercices techniques
Les gammes, arpèges, la gamme chromatique et les renversements (« Exercice ») sont du matériel pédagogique générique, écrit pour l'application ; les doigtés suivent l'usage standard (main droite Do majeur 1-2-3-1-2-3-4-5, Fa majeur 1-2-3-4-1-2-3-4, Si♭ majeur 4-1-2-3-1-2-3-4 ; main gauche 5-4-3-2-1-3-2-1, Si♭ majeur 3-2-1-4-3-2-1-3).

## À faire vérifier à l'oreille
Morceaux dont une variante de rythme existe selon les éditions (voir le rapport de relecture) : `douce-nuit` (avant-dernière mesure), `anges-campagnes` (mélisme du Gloria), `korobeiniki` (mesure 5), `bon-roi-venceslas` (dernière phrase), `amazing-grace` (mesure 7, variante La-Si en croches).
