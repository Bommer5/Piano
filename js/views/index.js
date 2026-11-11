// Enregistre toutes les vues (chaque fichier appelle registerRoute).
// Pour ajouter une page : créer js/views/ma-vue.js puis ajouter une ligne dans VIEWS ci-dessous
// (forme littérale `() => import('./ma-vue.js')`, vérifiée par tests/unit/integrity.test.mjs).
//
// Démarrage résilient : chaque vue est chargée séparément ; si l'une échoue (fichier manquant,
// erreur de syntaxe sur un vieux navigateur…), les autres pages restent utilisables et la page
// en échec affiche un message au lieu d'une page blanche.
// Les fichiers sont préchargés en parallèle (modulepreload) puis évalués dans l'ordre de la liste,
// pour que l'ordre des sections ajoutées à l'accueil et aux réglages reste stable.
const VIEWS = [
  ['home.js', () => import('./home.js')],
  ['library.js', () => import('./library.js')],
  ['song.js', () => import('./song.js')],
  ['courses.js', () => import('./courses.js')],
  ['tuner.js', () => import('./tuner.js')],
  ['import.js', () => import('./import.js')],
  ['progress.js', () => import('./progress.js')],
  ['settings.js', () => import('./settings.js')],
  ['welcome.js', () => import('./welcome.js')],
  ['glossary.js', () => import('./glossary.js')],
  ['teacher.js', () => import('./teacher.js')],
  ['audio-settings.js', () => import('./audio-settings.js')],
  ['calibration.js', () => import('./calibration.js')],
  ['games.js', () => import('./games.js')],
  ['reading.js', () => import('./reading.js')],
  ['rhythm.js', () => import('./rhythm.js')],
  ['ear.js', () => import('./ear.js')],
  ['chords.js', () => import('./chords.js')],
  ['editor.js', () => import('./editor.js')],
  ['share.js', () => import('./share.js')],
  ['notation-settings.js', () => import('./notation-settings.js')],
  ['install.js', () => import('./install.js')],
];

/** Vues qui n'ont pas pu être chargées : [{ file, error }]. */
export const failedViews = [];

// Dépendances profondes des vues, préchargées en même temps que les vues : sans cela, chaque niveau
// d'import coûte un aller-retour réseau de plus (≈ 0,5 s en 4G lente) avant le premier affichage.
// (Liste vérifiée par tests/unit/perf-preload.test.mjs : chaque fichier doit exister.)
export const DEEP_PRELOAD = [
  '../data/lessons.js', '../core/coursegen.js', '../core/plan.js', '../ui/keyboard.js', '../audio/mic.js', '../core/pitch.js',
  '../core/spectrum.js', '../core/reading.js', '../core/rhythmgame.js', '../core/eartraining.js', '../core/share.js', '../ui/shell.js',
];

if (typeof document !== 'undefined') {
  for (const file of [...VIEWS.map(([f]) => f), ...DEEP_PRELOAD]) {
    const l = document.createElement('link');
    l.rel = 'modulepreload';
    l.href = new URL(file, import.meta.url).href;
    document.head.append(l);
  }
}

for (const [file, load] of VIEWS) {
  try {
    await load();
  } catch (error) {
    console.warn(`Vue ${file} non chargée :`, error);
    failedViews.push({ file, error });
  }
}
