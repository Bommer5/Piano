// Tests de bout en bout dans un vrai navigateur (Playwright + Chromium).
// Lancer : npm run test:e2e   (captures dans tests/e2e/screenshots/)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../scripts/serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, 'screenshots');
fs.mkdirSync(shots, { recursive: true });

const server = createServer();
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}/`;

let failures = 0, passes = 0;
const results = [];
async function check(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    passes++;
    results.push(`✔ ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    failures++;
    results.push(`✘ ${name}\n    ${String(e.stack || e).split('\n').slice(0, 4).join('\n    ')}`);
  }
  console.log(results[results.length - 1]);
}
function assert(c, msg) {
  if (!c) throw new Error(msg || 'assertion échouée');
}

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, permissions: ['microphone'] });
// L'accueil guidé (#/bienvenue) s'affiche au premier lancement : on le marque comme fait.
await ctx.addInitScript(() => localStorage.setItem('pianocoach.onboarded', 'true'));
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !/favicon|serviceWorker|sw\.js/i.test(m.text())) errors.push('console: ' + m.text());
});

async function go(hash) {
  await page.goto(BASE + hash);
  await page.waitForTimeout(250);
}

/** Clique une touche du clavier de l'entraîneur (en bas des touches blanches pour éviter les noires). */
async function clickKey(midi) {
  const key = page.locator(`.trainer .key[data-midi="${midi}"]`);
  const box = await key.boundingBox();
  assert(box, `touche ${midi} introuvable`);
  const black = await key.evaluate((e) => e.classList.contains('black'));
  const x = box.x + box.width / 2, y = box.y + box.height * (black ? 0.4 : 0.88);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
}

/** Joue le morceau en mode attente en suivant les touches surlignées. */
async function playThroughWaitMode(maxSteps = 600) {
  for (let i = 0; i < maxSteps; i++) {
    if (await page.locator('dialog.modal[open]').count()) return true;
    const expected = await page.$$eval('.trainer .key.expect-R, .trainer .key.expect-L', (els) => els.map((e) => Number(e.dataset.midi)));
    if (!expected.length) {
      await page.waitForTimeout(60);
      continue;
    }
    for (const m of expected) await clickKey(m);
    await page.waitForTimeout(20);
  }
  return !!(await page.locator('dialog.modal[open]').count());
}

try {
  await check('Accueil sans erreur', async () => {
    await go('');
    assert(await page.locator('.hero h1').isVisible(), 'titre héro absent');
    assert((await page.locator('.genre-card').count()) >= 5, 'genres absents');
    await page.screenshot({ path: path.join(shots, '01-accueil.png') });
  });

  for (const [hash, sel, name] of [
    ['#/bibliotheque', '.song-card', 'Bibliothèque'],
    ['#/cours', '.course-card', 'Cours'],
    ['#/accordeur', '.tuner', 'Détecteur'],
    ['#/importer', '.dropzone', 'Import'],
    ['#/progres', '.bars', 'Progrès'],
    ['#/reglages', '.settings', 'Réglages'],
  ]) {
    await check(`Page ${name}`, async () => {
      await go(hash);
      assert(await page.locator(sel).first().isVisible(), `${sel} invisible`);
      await page.screenshot({ path: path.join(shots, `02-${name}.png`), fullPage: false });
    });
  }

  await check('Recherche et filtres de la bibliothèque', async () => {
    await go('#/bibliotheque');
    const all = await page.locator('.song-card').count();
    assert(all >= 20, `seulement ${all} morceaux`);
    await page.fill('input[type=search]', 'zzzzzz');
    await page.waitForTimeout(100);
    assert((await page.locator('.song-card').count()) === 0, 'la recherche ne filtre pas');
    await page.fill('input[type=search]', '');
    await page.selectOption('.filters select >> nth=0', 'classique');
    await page.waitForTimeout(100);
    const c = await page.locator('.song-card').count();
    assert(c > 0 && c < all, 'filtre genre inopérant');
  });

  await check('Tous les morceaux s’ouvrent (fiche + portée)', async () => {
    const ids = await page.evaluate(async () => (await import('./js/data/songs.js')).SONGS.map((s) => s.id));
    for (const id of ids) {
      await go(`#/morceau/${id}`);
      assert(await page.locator('.song-header h1').isVisible(), `fiche ${id}`);
      assert((await page.locator('.phrase').count()) > 0, `phrases ${id}`);
    }
    assert(!errors.length, errors.join('\n'));
  });

  await check('Jouer un morceau entier en mode Attente (souris) → 100 %', async () => {
    const id = await page.evaluate(async () => {
      const { SONGS } = await import('./js/data/songs.js');
      return SONGS.filter((s) => s.level === 1).sort((a, b) => JSON.stringify(a.tracks).length - JSON.stringify(b.tracks).length)[0].id;
    });
    await go(`#/jouer/${id}?hands=R`);
    await page.screenshot({ path: path.join(shots, '03-entrainement.png') });
    assert(await playThroughWaitMode(), 'la fenêtre de résultat ne s’est pas affichée');
    const score = await page.locator('.big-score').textContent();
    assert(score.trim() === '100 %', 'score inattendu : ' + score);
    await page.screenshot({ path: path.join(shots, '04-resultat.png') });
    await page.locator('dialog.modal button', { hasText: 'Fermer' }).click();
    const prog = await page.evaluate((i) => window.PianoCoach.store.progress()[i], id);
    assert(prog && prog.best === 100 && prog.stars === 3, 'progrès non enregistré');
  });

  await check('Mode Attente : une fausse note est signalée', async () => {
    await page.locator('.trainer button', { hasText: '⟲' }).click();
    const exp = await page.$$eval('.trainer .key.expect-R', (els) => els.map((e) => Number(e.dataset.midi)));
    assert(exp.length, 'aucune note attendue');
    const wrong = exp[0] + 1;
    await clickKey(wrong);
    await page.waitForTimeout(80);
    const fb = await page.locator('.feedback').textContent();
    assert(fb.includes('✗') && /attendu/.test(fb), 'pas de retour d’erreur : ' + fb);
  });

  await check('Clavier d’ordinateur joue des notes (touche physique A = Do)', async () => {
    await go('#/jouer/' + (await page.evaluate(async () => (await import('./js/data/songs.js')).SONGS[0].id)));
    await page.keyboard.down('KeyA');
    await page.waitForTimeout(50);
    assert(await page.locator('.trainer .key[data-midi="60"].pressed').count(), 'Do non enfoncé');
    await page.keyboard.up('KeyA');
  });

  await check('Mode Tempo et Écoute démarrent et avancent', async () => {
    await page.locator('[data-mode="tempo"]').click();
    await page.locator('.trainer .btn.primary.big').click();
    await page.waitForTimeout(1500);
    const fb = await page.locator('.feedback').textContent();
    assert(fb.length > 0);
    await page.locator('[data-mode="listen"]').click();
    await page.locator('.trainer .btn.primary.big').click();
    await page.waitForTimeout(1200);
    const lit = await page.locator('.trainer .key.expect-R, .trainer .key.expect-L').count();
    assert(lit > 0, 'aucune touche allumée en mode écoute');
    await page.locator('.trainer .btn.primary.big').click();
  });

  await check('Transposition et boucle', async () => {
    const before = await page.locator('.trainer .key').first().getAttribute('data-midi');
    await page.locator('.trainer .field button', { hasText: '+' }).click();
    await page.locator('.trainer .field button', { hasText: '+' }).click();
    assert((await page.locator('.trainer .field .mono').nth(1).textContent()).includes('+2'), 'transposition non affichée');
    assert(before != null);
  });

  await check('Cours : toutes les leçons s’affichent', async () => {
    const ids = await page.evaluate(async () => (await import('./js/data/lessons.js')).COURSES.flatMap((c) => c.lessons.map((l) => l.id)));
    assert(ids.length >= 20, 'trop peu de leçons : ' + ids.length);
    for (const id of ids) {
      await go(`#/lecon/${id}`);
      assert(await page.locator('.lesson').isVisible(), `leçon ${id}`);
    }
    await go(`#/lecon/${ids[0]}`);
    await page.screenshot({ path: path.join(shots, '05-lecon.png'), fullPage: true });
    assert(!errors.length, errors.join('\n'));
  });

  await check('Quiz et exercices de leçon', async () => {
    const target = await page.evaluate(async () => {
      const { COURSES } = await import('./js/data/lessons.js');
      for (const c of COURSES) for (const l of c.lessons) {
        const i = l.blocks.findIndex((b) => b.type === 'exercise');
        if (i >= 0) return { lesson: l.id, i, quiz: l.blocks.some((b) => b.type === 'quiz') };
      }
    });
    assert(target, 'aucun exercice');
    await go(`#/exercice/${target.lesson}/${target.i}`);
    assert(await playThroughWaitMode(), 'exercice non terminable');
    await page.locator('dialog.modal button', { hasText: 'Fermer' }).click();
    const q = await page.evaluate(async () => {
      const { COURSES } = await import('./js/data/lessons.js');
      for (const c of COURSES) for (const l of c.lessons) if (l.blocks.some((b) => b.type === 'quiz')) return l.id;
    });
    await go(`#/lecon/${q}`);
    await page.locator('.block.quiz .choices button').first().click();
    assert((await page.locator('.quiz-result').first().textContent()).length > 0, 'quiz sans réponse');
  });

  await check('Parcours généré pour un morceau', async () => {
    const id = await page.evaluate(async () => (await import('./js/data/songs.js')).SONGS[0].id);
    await go(`#/parcours/${id}`);
    const n = await page.locator('.lesson-list li').count();
    assert(n >= 4, 'parcours trop court');
    await go(`#/parcours/${id}?step=1`);
    assert(await page.locator('.trainer').isVisible());
  });

  await check('Import des fichiers exemples (MusicXML, MIDI, ABC, texte)', async () => {
    for (const f of ['exemple.musicxml', 'exemple.mid', 'exemple.abc', 'exemple.txt']) {
      await go('#/importer');
      await page.setInputFiles('.dropzone input[type=file]', path.join(here, '../../samples', f));
      await page.locator('.card.preview').waitFor({ timeout: 8000 });
      await page.locator('.card.preview button', { hasText: 'Ajouter' }).click();
      await page.waitForURL(/#\/morceau\//);
      assert(await page.locator('.song-header h1').isVisible(), 'fiche importée');
    }
    await go('#/bibliotheque?genre=__import');
    assert((await page.locator('.song-card').count()) >= 4, 'imports absents de la bibliothèque');
  });

  await check('Import PDF : message d’aide clair', async () => {
    await go('#/importer');
    await page.setInputFiles('.dropzone input[type=file]', { name: 'partition.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%fake') });
    await page.locator('.card.error').waitFor({ timeout: 5000 });
    const t = await page.locator('.card.error').textContent();
    assert(/MuseScore|Audiveris/.test(t), 'message PDF : ' + t);
  });

  await check('Import par collage de texte', async () => {
    await go('#/importer');
    await page.fill('textarea', 'titre: Collé\nMD: C4 D4 E4 F4 G4:4');
    await page.locator('button', { hasText: 'Analyser le texte' }).click();
    await page.locator('.card.preview').waitFor();
  });

  await check('Export MIDI depuis une fiche', async () => {
    const id = await page.evaluate(async () => (await import('./js/data/songs.js')).SONGS[0].id);
    await go(`#/morceau/${id}`);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.selectOption('.actions select', 'midi')]);
    assert(dl.suggestedFilename().endsWith('.mid'), dl.suggestedFilename());
  });

  await check('Réglages : notation anglaise appliquée', async () => {
    await go('#/reglages');
    await page.selectOption('.setting select >> nth=0', 'en');
    const s = await page.evaluate(() => window.PianoCoach.store.settings().notation);
    assert(s === 'en');
    await page.selectOption('.setting select >> nth=0', 'fr');
  });

  await check('Micro (périphérique simulé) : démarrage du détecteur', async () => {
    await go('#/accordeur');
    await page.locator('.tuner .btn.primary').click();
    await page.waitForTimeout(800);
    const txt = await page.locator('.tuner .btn.primary').textContent();
    assert(/Arrêter/.test(txt), 'micro non démarré : ' + txt);
    await page.locator('.tuner .btn.primary').click();
  });

  await check('Aucune erreur JavaScript pendant tout le parcours', async () => {
    assert(!errors.length, errors.join('\n'));
  });

  await check('Mobile : pas de défilement horizontal, menus utilisables', async () => {
    const m = await browser.newContext({ viewport: { width: 375, height: 760 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await m.addInitScript(() => localStorage.setItem('pianocoach.onboarded', 'true'));
    const p = await m.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    for (const hsh of ['', '#/bibliotheque', '#/cours', '#/importer', '#/reglages']) {
      await p.goto(BASE + hsh);
      await p.waitForTimeout(200);
      const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert(over <= 1, `débordement horizontal ${over}px sur « ${hsh || 'accueil'} »`);
    }
    const id = await p.evaluate(async () => (await import('./js/data/songs.js')).SONGS[0].id);
    await p.goto(BASE + '#/jouer/' + id);
    await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(shots, '06-mobile-entrainement.png') });
    const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert(over <= 1, `débordement horizontal ${over}px sur l’entraînement`);
    assert(!errs.length, errs.join('\n'));
    await m.close();
  });
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${passes} réussis, ${failures} échoués`);
process.exit(failures ? 1 : 0);
