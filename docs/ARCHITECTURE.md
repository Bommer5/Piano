# Piano Coach — architecture et règles de contribution

Application web 100 % navigateur (HTML/CSS/JS en modules ES, **aucune dépendance, aucune étape de build, aucun serveur**). Installable en PWA (Android). Tout le texte visible est en **français**.

## Arborescence
- `index.html`, `css/style.css`, `sw.js` (hors-ligne), `manifest.webmanifest`
- `js/app.js` — routeur (hash `#/chemin?query`), démarrage.
- `js/ui/context.js` — état partagé : `ctx.settings`, `ctx.prepared`, `main`, `onCleanup(fn)`, `registerRoute(re, fn)`, `findSong(id)`, `allSongs()`, `genreOf`, `levelLabel`, `section(title, children)`, `statCard`, `songCard`, `startTrainer(song, query, {back,onNext,title,subtitle})`, registres `settingsSections` (fonctions `() => Node` ajoutées à la page Réglages) et `homeSections` (cartes ajoutées à l'accueil).
- `js/views/*.js` — une page par fichier, chaque fichier appelle `registerRoute`. Nouvelles pages : créer `js/views/x.js` **et** ajouter une ligne `import './x.js';` dans `js/views/index.js`.
- `js/ui/` — `trainer.js` (écran d'entraînement), `staff.js` (portée SVG), `roll.js` (notes qui tombent), `keyboard.js` (clavier `PianoKeyboard`, `keyDiagram`), `dom.js` (`h()`, `toast`, `modal`, `download`, `escapeHtml`, `stars`).
- `js/audio/` — `synth.js` (Web Audio : `playNote`, `releaseNote`, `setSustain`, `click`, `feedbackSound`), `mic.js` (événements `frame` / `onset`), `midi-input.js` (Web MIDI + clavier d'ordinateur).
- `js/core/` — logique pure testable dans Node : `notes.js`, `pitch.js` (YIN), `spectrum.js` (FFT, `matchChord`, `estimateNotes`), `onset.js`, `song.js` (modèle, notation compacte, `prepareSong`, `buildEvents`, `transposeSong`, `phrases`), `fingering.js`, `practice.js` (`PracticeEngine`), `coursegen.js`, `storage.js` (`store`, `DEFAULT_SETTINGS`, `localDate`), `transcribe.js` (audio → partition).
- `js/parsers/` — MusicXML/MXL/MIDI/ABC/texte/JSON + audio ; `index.js` (`importScoreFile`, `exportSong`).
- `js/data/songs.js` (`GENRES`, `SONGS`, `getSong`), `js/data/lessons.js` (`COURSES`, `getCourse`, `getLesson`).
- Tests : `tests/unit/*.test.mjs` (`npm test` → `node --test "tests/unit/*.test.mjs"`), `tests/e2e/run.mjs` (Playwright, `npm run test:e2e`).

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
