// Test de fumée : visite TOUTES les routes enregistrées (extraites des appels registerRoute de
// js/views/*.js) en bureau (1280×860) puis mobile (375×740) et vérifie qu'aucune ne casse.
// Lancer : npm run test:smoke   (une capture 375 px par route dans tests/e2e/screenshots/smoke/)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../scripts/serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');
const shots = path.join(here, 'screenshots/smoke');
fs.rmSync(shots, { recursive: true, force: true });
fs.mkdirSync(shots, { recursive: true });

// ---------- routes enregistrées ----------
const viewsDir = path.join(ROOT, 'js/views');
const patterns = [];
for (const f of fs.readdirSync(viewsDir).sort()) {
  const src = fs.readFileSync(path.join(viewsDir, f), 'utf8');
  for (const m of src.matchAll(/registerRoute\(\s*\/(.+?)\/[a-z]*\s*,/g)) patterns.push({ file: f, source: m[1] });
}

const { SONGS } = await import(path.join(ROOT, 'js/data/songs.js'));
const { COURSES } = await import(path.join(ROOT, 'js/data/lessons.js'));
const song = SONGS[0].id;
const course = COURSES[0];
let exercise = null;
for (const c of COURSES) for (const l of c.lessons) {
  const i = l.blocks.findIndex((b) => b.type === 'exercise');
  if (i >= 0 && !exercise) exercise = [l.id, i];
}
/** Valeurs réelles pour les routes à paramètre (selon le préfixe de la route). */
const PARAMS = {
  morceau: [song], jouer: [song], editer: [song], parcours: [song],
  cours: [course.id], lecon: [course.lessons[0].id], exercice: exercise,
};

const routes = [];
for (const { file, source } of patterns) {
  const re = new RegExp(source);
  const bare = source.replace(/^\^/, '').replace(/\$$/, '').replace(/\\\//g, '/');
  if (!/[()]/.test(bare)) {
    routes.push({ file, hash: '#/' + bare });
    continue;
  }
  const prefix = bare.split('/')[0];
  const vals = PARAMS[prefix];
  if (!vals) throw new Error(`Route à paramètre sans valeur de test : ${source} (${file}) — compléter PARAMS dans smoke.mjs`);
  let i = 0;
  const hash = '#/' + bare.replace(/\((?:[^()]|\([^()]*\))*\)/g, () => encodeURIComponent(vals[i++]));
  if (!re.test(hash.slice(2))) throw new Error(`Valeur de test incompatible avec ${source} : ${hash}`);
  routes.push({ file, hash });
}
console.log(`${routes.length} routes trouvées.`);

// ---------- visite ----------
const server = createServer();
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}/`;
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });

let failures = 0;
const ignore = /favicon|serviceWorker|sw\.js/i;

async function newPage(viewport, mobile) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, permissions: ['microphone'] });
  await context.addInitScript(() => localStorage.setItem('pianocoach.onboarded', 'true'));
  const page = await context.newPage();
  page.errs = [];
  page.on('pageerror', (e) => page.errs.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !ignore.test(m.text())) page.errs.push('console: ' + m.text());
  });
  return { context, page };
}

async function visit(page, r, label, shot) {
  page.errs.length = 0;
  await page.goto(BASE + r.hash);
  await page.waitForFunction(() => window.__booted === true, null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(350);
  const st = await page.evaluate(() => ({
    booted: window.__booted === true,
    main: document.getElementById('main')?.innerText.trim().length || 0,
    oups: /Oups…|n’a pas pu démarrer|Page introuvable/.test(document.getElementById('main')?.innerText || ''),
    over: document.documentElement.scrollWidth - window.innerWidth,
  }));
  const problems = [...page.errs];
  if (!st.booted) problems.push('window.__booted absent');
  if (!st.main) problems.push('#main vide');
  if (st.oups) problems.push('écran d’erreur affiché');
  if (st.over > 1) problems.push(`défilement horizontal de ${st.over}px`);
  if (shot) await page.screenshot({ path: path.join(shots, shot) });
  if (problems.length) {
    failures++;
    console.log(`✘ [${label}] ${r.hash} (${r.file})\n    ${problems.join('\n    ')}`);
  } else console.log(`✔ [${label}] ${r.hash}`);
}

try {
  const desk = await newPage({ width: 1280, height: 860 }, false);
  for (const r of routes) await visit(desk.page, r, '1280');
  await desk.context.close();

  const mob = await newPage({ width: 375, height: 740 }, true);
  for (const r of routes) {
    const name = (r.hash.slice(2).replace(/[^\w-]+/g, '_') || 'accueil') + '.png';
    await visit(mob.page, r, '375', name);
  }
  await mob.context.close();

  // Module manquant : une vue non critique en 404 ne doit pas empêcher les autres pages.
  {
    const { context, page } = await newPage({ width: 375, height: 740 }, true);
    await context.route('**/js/views/games.js', (route) => route.fulfill({ status: 404, body: 'introuvable' }));
    await page.goto(BASE + '#/bibliotheque');
    await page.waitForFunction(() => window.__booted === true, null, { timeout: 10000 }).catch(() => {});
    const lib = await page.evaluate(() => ({ booted: window.__booted === true, cards: document.querySelectorAll('.song-card').length }));
    await page.goto(BASE + '#/jeux');
    await page.waitForTimeout(300);
    const t = await page.locator('#main').innerText();
    const ok = lib.booted && lib.cards > 0 && /Page introuvable/.test(t) && /Recharge/.test(t) && !page.errs.some((e) => e.startsWith('pageerror'));
    if (!ok) { failures++; console.log('✘ Vue manquante : démarrage dégradé', JSON.stringify(lib), t.slice(0, 200), page.errs); } else console.log('✔ Vue manquante (jeux) : les autres pages fonctionnent, message clair sur #/jeux');
    await context.close();
  }
  // Module critique manquant : écran « n'a pas pu démarrer », jamais une page blanche.
  {
    const { context, page } = await newPage({ width: 375, height: 740 }, true);
    await context.route('**/js/ui/context.js', (route) => route.fulfill({ status: 404, body: 'introuvable' }));
    await page.goto(BASE + '#/');
    const ok = await page.locator('text=Piano Coach n’a pas pu démarrer').waitFor({ timeout: 8000 }).then(() => true, () => false);
    if (!ok) { failures++; console.log('✘ Module critique manquant : pas d’écran d’erreur', (await page.locator('#main').innerText()).slice(0, 200)); } else console.log('✔ Module critique manquant : écran « n’a pas pu démarrer »');
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log(failures ? `\n${failures} échec(s)` : `\nTout est vert (${routes.length} routes × 2 tailles).`);
process.exit(failures ? 1 : 0);
