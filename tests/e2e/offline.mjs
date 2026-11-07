// Test hors ligne de la PWA, app montée dans /Piano/ comme sur GitHub Pages.
// Lancer : node tests/e2e/offline.mjs
//   (si Playwright est introuvable : NODE_PATH=/opt/node22/lib/node_modules node tests/e2e/offline.mjs)
//
// Deux passes :
//  - « localhost »  : le service worker est en mode développement (réseau d'abord) ;
//  - « production » : un nom d'hôte autre que localhost (piano.localhost → 127.0.0.1) active le
//    mode stale-while-revalidate, comme sur bommer5.github.io.
// Dans chaque passe : enregistrement du SW, précache, 404 jamais mise en cache, message de
// mise à jour, puis coupure réseau (setOffline + arrêt du serveur) et visite de l'accueil,
// d'un morceau, de l'entraîneur et des cours, sans écran d'erreur.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveSubdir, loadPlaywright, MOUNT } from '../../scripts/check-pwa.mjs';
import { readSwBlock, SW_FILE } from '../../scripts/sw-assets.mjs';

const { chromium } = loadPlaywright();
const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, 'screenshots');
fs.mkdirSync(shots, { recursive: true });
const { version, assets } = readSwBlock();

let failures = 0;
async function check(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    console.log(`✔ ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    failures++;
    console.log(`✘ ${name}\n    ${String(e.stack || e).split('\n').slice(0, 4).join('\n    ')}`);
  }
}
function assert(c, msg) {
  if (!c) throw new Error(msg || 'assertion échouée');
}

async function pass(label, host) {
  console.log(`\n— Passe « ${label} » —`);
  const srv = await serveSubdir();
  const origin = `http://${host}:${srv.port}`;
  const BASE = origin + MOUNT;
  // *.localhost est un contexte sûr (SW autorisé) qui pointe vers 127.0.0.1, mais n'est pas
  // « localhost » pour sw.js : le mode production (stale-while-revalidate) s'applique.
  const browser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${host} 127.0.0.1`] });
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => localStorage.setItem('pianocoach.onboarded', 'true'));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const ids = {};

  try {
    await check('le service worker s\'enregistre et contrôle la page', async () => {
      await page.goto(BASE);
      const reg = await page.evaluate(async () => {
        const r = await navigator.serviceWorker.ready;
        return { scope: r.scope, script: r.active.scriptURL };
      });
      assert(reg.scope === BASE, `portée ${reg.scope} ≠ ${BASE}`);
      await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 5000 });
      const v = await page.evaluate(() => new Promise((resolve) => {
        navigator.serviceWorker.addEventListener('message', (e) => e.data?.type === 'pianocoach:version' && resolve(e.data.version));
        navigator.serviceWorker.controller.postMessage({ type: 'pianocoach:version' });
      }));
      assert(v === version, `version ${v} ≠ ${version}`);
    });

    await check(`les ${assets.length} ressources de ASSETS sont précachées`, async () => {
      const keys = await page.evaluate(async (v) => (await (await caches.open('pianocoach-' + v)).keys()).map((r) => r.url), version);
      const missing = assets.filter((a) => !keys.includes(new URL(a, BASE).href));
      assert(!missing.length, `non précachées : ${missing.join(', ')}`);
      assert(keys.includes(BASE), 'la racine ./ n\'est pas en cache');
    });

    await check('un module JS absent donne une 404, jamais mise en cache ni remplacée par du HTML', async () => {
      const r = await page.evaluate(async (v) => {
        const res = await fetch('js/nexiste-pas.js');
        const type = res.headers.get('content-type');
        const cached = !!(await (await caches.open('pianocoach-' + v)).match('js/nexiste-pas.js'));
        return { status: res.status, type, cached };
      }, version);
      assert(r.status === 404 && !r.cached && !/html/.test(r.type || ''), JSON.stringify(r));
    });

    await check('identifiants d\'un morceau et d\'un cours', async () => {
      Object.assign(ids, await page.evaluate(async () => {
        const [{ SONGS }, { COURSES }] = await Promise.all([import('./js/data/songs.js'), import('./js/data/lessons.js')]);
        return { song: SONGS[0].id, course: COURSES[0].id };
      }));
      assert(ids.song && ids.course, JSON.stringify(ids));
    });

    await check('une nouvelle version du SW prévient la page (postMessage)', async () => {
      const src = fs.readFileSync(SW_FILE, 'utf8').replace(`const VERSION = '${version}'`, `const VERSION = '${version}-maj'`);
      srv.overrides.set('sw.js', src);
      const msg = await page.evaluate(() => new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('aucun message reçu')), 10000);
        navigator.serviceWorker.addEventListener('message', (e) => e.data?.type === 'pianocoach:update' && resolve(e.data));
        navigator.serviceWorker.getRegistration().then((r) => r.update());
      }));
      assert(msg.version === `${version}-maj`, JSON.stringify(msg));
      const names = await page.evaluate(() => caches.keys());
      assert(names.length === 1 && names[0] === `pianocoach-${version}-maj`, `anciens caches non nettoyés : ${names}`);
    });

    // Coupure réseau totale : navigateur hors ligne ET serveur arrêté.
    await ctx.setOffline(true);
    await srv.close();

    const visits = [
      ['accueil', '#/', '#main > *'],
      ['un morceau', `#/morceau/${ids.song}`, '#main > *'],
      ['l\'entraîneur', `#/jouer/${ids.song}`, '.trainer'],
      ['les cours', '#/cours', '#main > *'],
      ['un cours', `#/cours/${ids.course}`, '#main > *'],
    ];
    for (const [name, hash, sel] of visits) {
      await check(`hors ligne : ${name} (${hash}) après rechargement`, async () => {
        errors.length = 0;
        await page.goto(BASE + hash);
        await page.reload();
        await page.waitForSelector(sel, { timeout: 5000 });
        await page.waitForTimeout(300);
        const state = await page.evaluate(() => ({
          app: !!window.PianoCoach,
          error: document.querySelectorAll('.card.error').length,
          notFound: /Page introuvable/.test(document.querySelector('#main')?.textContent || ''),
          text: (document.querySelector('#main')?.textContent || '').trim().length,
          hscroll: document.documentElement.scrollWidth > innerWidth + 1,
        }));
        assert(state.app, 'l\'app n\'a pas démarré (module manquant ?)');
        assert(!state.error && !state.notFound && state.text > 20, JSON.stringify(state));
        const real = errors.filter((e) => !/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(e));
        assert(!real.length, real.join(' | '));
        if (label === 'production' && (hash === '#/' || hash.startsWith('#/jouer'))) {
          await page.screenshot({ path: path.join(shots, `offline-${hash === '#/' ? 'accueil' : 'entraineur'}-375.png`) });
        }
      });
    }

    await check('hors ligne : un module JS absent échoue (pas de page HTML à sa place)', async () => {
      const r = await page.evaluate(() => fetch('js/nexiste-pas.js').then((res) => `HTTP ${res.status} ${res.headers.get('content-type')}`, () => 'erreur réseau'));
      assert(r === 'erreur réseau', r);
    });
  } finally {
    await browser.close();
    await srv.close().catch(() => {});
  }
}

await pass('localhost', 'localhost');
await pass('production', 'piano.localhost');
console.log(failures ? `\n${failures} échec(s).` : '\nHors ligne : tout est vert.');
process.exit(failures ? 1 : 0);
