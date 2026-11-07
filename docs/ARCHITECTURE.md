# Piano Coach — architecture et règles de contribution

Application web 100 % navigateur (HTML/CSS/JS en modules ES, **aucune dépendance, aucune étape de build, aucun serveur**). Installable en PWA (Android). Tout le texte visible est en **français**.

## Arborescence
- `index.html` (coquille : barre du haut, navigation, écran d'erreur de démarrage `__bootFail`), `sw.js` (hors-ligne, liste ASSETS générée), `manifest.webmanifest`, `icon.svg`, `icons/`, `samples/` (fichiers d'exemple pour l'import).
- `css/` — `style.css` (variables de thème clair/sombre, composants de base), `trainer.css`, `notation.css` (portée), `profile.css` (profils, accessibilité, navigation mobile, carnet), `harmony.css` (accords, éditeur, partage), `audio.css` (réglages audio, calibration), `games.css`. Chaque fichier est lié dans `index.html` (vérifié par `scripts/check-imports.mjs`).
- `js/app.js` — routeur (hash `#/chemin?query`), table `navOf` (onglet actif par route), démarrage.
- `js/views/index.js` — charge chaque vue séparément (modulepreload en parallèle puis import dans l'ordre de la liste `VIEWS`) : une vue en échec n'empêche pas les autres (`failedViews`, message « Page introuvable » + « Recharger »). **Nouvelle page : créer `js/views/x.js` et ajouter `['x.js', () => import('./x.js')]` dans `VIEWS`.**
- `js/views/*.js` — une page par fichier (`registerRoute`) : `home` (accueil, séance du jour), `library`, `song` (fiche, entraînement), `courses` (cours, leçons, exercices, parcours d'un morceau), `tuner` (détecteur), `import`, `progress`, `settings`, `welcome` (accueil guidé), `glossary`, `teacher` (carnet), `audio-settings` (section Réglages + `saveAudio`, `latencyOf`), `calibration`, `games` (hub + outils partagés), `reading`, `rhythm`, `ear`, `chords`, `editor`, `share`, `notation-settings` (section Réglages).
- `js/ui/` — `context.js` (état partagé : `ctx`, `main`, `onCleanup`, `registerRoute`, `findSong`, `allSongs`, `genreOf`, `levelLabel`, `section`, `statCard`, `songCard`, `startTrainer(song, query, {back,onNext,title,subtitle})` — query : `mode, hands, tempo, from, to, loop, variant` —, registres `settingsSections` et `homeSections`), `shell.js` (profils dans la barre du haut, badges, accessibilité, menu « Plus », rappel, redirection vers l'accueil guidé), `trainer.js` (écran d'entraînement), `staff.js` (portée SVG ; `yOf`, `xOf`, `hiddenMeasures`), `roll.js`, `keyboard.js`, `report.js` (bilan, revue des erreurs), `editor.js`, `dom.js`.
- `js/audio/` — `synth.js`, `mic.js` + `mic-worklet.js`, `midi-input.js` (Web MIDI + clavier d'ordinateur), `midi-output.js`.
- `js/core/` — logique pure testable dans Node : `notes.js` (`spell(midi, keyFifths, keyMode)` orthographe tonale), `pitch.js`, `spectrum.js`, `onset.js`, `song.js`, `notation.js`, `fingering.js`, `practice.js`, `coursegen.js` (parcours, `recordStepResult` : étape validée à 80 % deux fois de suite), `storage.js`, `transcribe.js`, `achievements.js`, `plan.js`, `take.js`, `follower.js`, `edit.js`, `harmony.js`, `theory.js`, `share.js`, `reading.js`, `rhythmgame.js`, `eartraining.js`.
- `js/parsers/` — `musicxml.js`, `mxl.js`, `xml.js`, `midi.js`, `abc.js`, `index.js` (`importScoreFile`, `exportSong`).
- `js/data/` — `songs.js` (`GENRES`, `SONGS`, `getSong`), `lessons.js` (`COURSES`, `getCourse`, `getLesson`), `glossary.js`.
- `scripts/` — `serve.mjs` (serveur local), `sw-assets.mjs` (liste ASSETS + version du cache de `sw.js`), `check-imports.mjs` (imports et CSS), `check-pwa.mjs`.

## Routes
| Route | Vue | Onglet actif |
|---|---|---|
| `#/` , `#/seance`, `#/bienvenue` | home, welcome | Accueil |
| `#/bibliotheque`, `#/morceau/:id`, `#/jouer/:id`, `#/editer/:id`, `#/partage?d=…` | library, song, editor, share | Morceaux |
| `#/cours`, `#/cours/:id`, `#/lecon/:id`, `#/exercice/:lecon/:n`, `#/parcours/:id[?step=n&rebours=1]` | courses | Cours |
| `#/jeux`, `#/jeux/lecture`, `#/jeux/dechiffrage`, `#/jeux/rythme`, `#/jeux/oreille` | games, reading, rhythm, ear | Jeux |
| `#/progres` | progress | Progrès |
| `#/accordeur`, `#/importer`, `#/accords`, `#/glossaire`, `#/carnet`, `#/reglages`, `#/calibration` | tuner, import, chords, glossary, teacher, settings, calibration | Plus (menu) |

## Tests et vérifications
- `npm test` — tests unitaires `tests/unit/*.test.mjs` (dont `integrity.test.mjs` : imports, CSS liés, vues importées, `sw-assets --check`).
- `npm run check` — `scripts/check-imports.mjs` + `sw-assets.mjs --check`.
- `npm run test:e2e` — parcours fonctionnels Playwright (`tests/e2e/run.mjs`), `tests/e2e/offline.mjs` (hors-ligne).
- `npm run test:smoke` — visite **toutes** les routes (extraites des `registerRoute`) en 1280×860 et 375×740 : aucune erreur JS/console, pas de défilement horizontal, pas d'écran d'erreur ; teste aussi une vue manquante et un module critique manquant. Captures dans `tests/e2e/screenshots/smoke/`.
- Après tout ajout/suppression/modification de fichier : `node scripts/sw-assets.mjs` (sinon `npm test` échoue).
- Notes de design en attente : `docs/DESIGN-NOTES.md`.

## Modèle de morceau (après `prepareSong`)
`{ id, title, composer, genre, level, tempo, timeSig:[n,d], keyFifths, notes:[{id, midi, start, dur, hand:'R'|'L', finger}], beatsPerMeasure, totalBeats, measureCount, hands:{R,L}, range:{lo,hi}, autoFingering }` — temps en **noires** (start/dur en temps). Champs optionnels ajoutés par les agents (à rendre toujours facultatifs) : `keyMode`, `tempoMap:[{beat,bpm}]`, `pickupBeats`, `chords:[{beat,symbol}]`, `dynamics:[{beat,mark}]`, `pedal:[{beat,down}]`, et par note `spelling:{step,alter}`, `staff:1|2`, `tieStart/tieStop`, `slur`, `articulations:[]`, `velocity`.

## Règles pour les agents
1. **Ne modifie que les fichiers dont tu es propriétaire** (liste dans ta mission). Si une petite modification d'un autre fichier est indispensable, fais-la avec un `Edit` minimal et ciblé, et signale-la dans ton rapport. Ne réécris jamais un fichier entier qui n'est pas à toi.
2. **Ne lance pas git** (pas de commit, pas de checkout, pas de stash).
3. Utilise les registres (`registerRoute`, `settingsSections`, `homeSections`) au lieu de modifier les vues des autres.
4. Réglages nouveaux : lis-les avec une valeur par défaut (`ctx.settings.x ?? défaut`) ; enregistre avec `store.saveSettings({...store.settings(), x})`.
5. Logique pure dans `js/core/` + tests unitaires `node:test`. Tout doit passer : `npm test`.
6. Accessibilité (labels, `aria-*`, clavier), responsive mobile (375 px sans défilement horizontal), thème sombre/clair (variables CSS de `css/style.css`). Styles nouveaux : dans un fichier CSS propre à ta fonctionnalité `css/<nom>.css`, ajouté par une ligne `<link>` dans `index.html`.
7. Vérifie la syntaxe (`node --check`) et, si possible, la page dans Chromium (Playwright est installé : `require('playwright')`, serveur : `node scripts/serve.mjs` ou `createServer()` de ce fichier).
