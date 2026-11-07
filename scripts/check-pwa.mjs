// Vérifie que Piano Coach est une PWA installable, servie dans un sous-dossier /Piano/
// exactement comme sur GitHub Pages (https://bommer5.github.io/Piano/).
//
//   node scripts/check-pwa.mjs                 vérifications statiques + navigateur (Playwright)
//   node scripts/check-pwa.mjs --screenshots   régénère aussi icons/screenshots/*.png
//   node scripts/check-pwa.mjs --fix-maskable  régénère l'icône masquable si elle déborde de la zone sûre
//
// Playwright : require('playwright'). S'il est introuvable depuis le projet, lancer avec
//   NODE_PATH=/opt/node22/lib/node_modules node scripts/check-pwa.mjs
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from './serve.mjs';
import { ROOT, collectAssets, readSwBlock } from './sw-assets.mjs';

export const MOUNT = '/Piano/';

/** Lit largeur × hauteur dans l'en-tête IHDR d'un PNG. */
export function pngSize(file) {
  const b = fs.readFileSync(file);
  const sig = '89504e470d0a1a0a';
  if (b.subarray(0, 8).toString('hex') !== sig || b.subarray(12, 16).toString('latin1') !== 'IHDR') throw new Error(`${file} n'est pas un PNG valide`);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

const isRelative = (u) => typeof u === 'string' && !/^[a-z][a-z0-9+.-]*:/i.test(u) && !u.startsWith('/');

/** Valide le manifeste ; renvoie { errors, warnings, manifest }. */
export function validateManifest(root = ROOT) {
  const errors = [], warnings = [];
  const file = path.join(root, 'manifest.webmanifest');
  let m;
  try {
    m = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return { errors: [`manifest.webmanifest illisible : ${e.message}`], warnings, manifest: null };
  }
  for (const k of ['name', 'short_name', 'theme_color', 'background_color', 'display']) if (!m[k]) errors.push(`champ « ${k} » manquant`);
  if (m.short_name && m.short_name.length > 12) warnings.push(`short_name long (${m.short_name.length} caractères) : il peut être tronqué sous l'icône`);
  for (const k of ['start_url', 'scope', 'id']) if (!isRelative(m[k])) errors.push(`« ${k} » doit être un chemin relatif (reçu ${JSON.stringify(m[k])})`);
  for (const k of ['theme_color', 'background_color']) if (m[k] && !/^#[0-9a-f]{6}$/i.test(m[k])) errors.push(`« ${k} » doit être une couleur #rrggbb`);
  if (!['standalone', 'fullscreen', 'minimal-ui'].includes(m.display)) errors.push('« display » doit être standalone, fullscreen ou minimal-ui pour être installable');
  if (m.prefer_related_applications !== false) errors.push('« prefer_related_applications » doit valoir false');

  const icons = Array.isArray(m.icons) ? m.icons : [];
  const found = { 192: false, 512: false, maskable: false };
  for (const ic of icons) {
    if (!isRelative(ic.src)) { errors.push(`icône ${ic.src} : chemin non relatif`); continue; }
    const f = path.join(root, ic.src);
    if (!fs.existsSync(f)) { errors.push(`icône ${ic.src} introuvable`); continue; }
    const purposes = String(ic.purpose || 'any').split(/\s+/);
    if (ic.type === 'image/png' || /\.png$/i.test(ic.src)) {
      const { width, height } = pngSize(f);
      if (ic.sizes !== `${width}x${height}`) errors.push(`icône ${ic.src} : sizes="${ic.sizes}" mais le PNG fait ${width}x${height}`);
      if (width === 192 && height === 192 && purposes.includes('any')) found[192] = true;
      if (width === 512 && height === 512 && purposes.includes('any')) found[512] = true;
      if (purposes.includes('maskable') && width >= 192) found.maskable = true;
    }
  }
  if (!found[192]) errors.push('icône PNG 192x192 (purpose any) manquante');
  if (!found[512]) errors.push('icône PNG 512x512 (purpose any) manquante');
  if (!found.maskable) errors.push('icône masquable (purpose maskable) manquante');

  for (const s of m.screenshots || []) {
    const f = path.join(root, s.src || '');
    if (!isRelative(s.src) || !fs.existsSync(f)) { errors.push(`capture ${s.src} introuvable`); continue; }
    const { width, height } = pngSize(f);
    if (s.sizes !== `${width}x${height}`) errors.push(`capture ${s.src} : sizes="${s.sizes}" mais le PNG fait ${width}x${height}`);
    if (s.form_factor === 'wide' && width <= height) errors.push(`capture ${s.src} : form_factor wide mais image en portrait`);
    if (s.form_factor === 'narrow' && width >= height) errors.push(`capture ${s.src} : form_factor narrow mais image en paysage`);
  }
  const ff = new Set((m.screenshots || []).map((s) => s.form_factor));
  if (!ff.has('narrow') || !ff.has('wide')) warnings.push('captures narrow et wide recommandées (fiche d\'installation enrichie)');
  for (const sc of m.shortcuts || []) {
    if (!sc.name || !isRelative(sc.url)) errors.push(`raccourci ${JSON.stringify(sc.name)} : nom ou url relative manquante`);
  }
  return { errors, warnings, manifest: m };
}

/**
 * Sert l'app dans le sous-dossier /Piano/ (comme GitHub Pages) ; tout le reste répond 404.
 * `overrides` (Map chemin relatif → contenu) permet aux tests de simuler une nouvelle version d'un fichier.
 */
export async function serveSubdir(port = 0) {
  const handler = createServer().listeners('request')[0];
  const overrides = new Map();
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const rel = u.pathname.slice(MOUNT.length);
    if (u.pathname.startsWith(MOUNT) && overrides.has(rel)) {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(overrides.get(rel));
    }
    if (u.pathname === MOUNT.slice(0, -1)) { res.writeHead(301, { Location: MOUNT }); return res.end(); }
    if (!u.pathname.startsWith(MOUNT)) { res.writeHead(404); return res.end('Hors du sous-dossier /Piano/'); }
    req.url = '/' + req.url.slice(MOUNT.length);
    handler(req, res);
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const { port: p } = server.address();
  return {
    server,
    overrides,
    port: p,
    url: `http://localhost:${p}${MOUNT}`,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}

export function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try {
    return require('playwright');
  } catch {
    return createRequire('/opt/node22/lib/node_modules/')('playwright');
  }
}

/** Mesure dans un canvas le cadre du dessin (pixels ≠ couleur de fond) d'une icône. */
async function iconContentBox(page, src) {
  return page.evaluate(async (url) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const { data, width, height } = g.getImageData(0, 0, c.width, c.height);
    const bg = [data[0], data[1], data[2]];
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 24) {
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    const opaque = data[3] === 255;
    return { width, height, x0, y0, x1, y1, opaque };
  }, src);
}

/** Zone sûre d'une icône masquable : cercle centré de rayon 40 % (diamètre 80 %). */
export function inSafeZone(box) {
  const cx = box.width / 2, cy = box.height / 2, r = box.width * 0.4;
  if (box.x1 < 0) return true;
  return [[box.x0, box.y0], [box.x1 + 1, box.y0], [box.x0, box.y1 + 1], [box.x1 + 1, box.y1 + 1]]
    .every(([x, y]) => Math.hypot(x - cx, y - cy) <= r);
}

/** Redessine l'icône masquable : fond plein + icon.svg réduit pour tenir dans la zone sûre. */
async function regenerateMaskable(page, base) {
  const dataUrl = await page.evaluate(async (svgUrl) => {
    const img = new Image();
    img.src = svgUrl;
    await img.decode();
    const S = 512, c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.fillStyle = '#5b6cff';
    g.fillRect(0, 0, S, S);
    // Le clavier occupe ~70 % × 50 % de icon.svg : à 72 % de la taille, il tient dans le cercle de 80 %.
    const k = S * 0.72, o = (S - k) / 2;
    g.drawImage(img, o, o, k, k);
    return c.toDataURL('image/png');
  }, base + 'icon.svg');
  fs.writeFileSync(path.join(ROOT, 'icons/icon-512-maskable.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));
}

async function takeScreenshots(browser, base) {
  const dir = path.join(ROOT, 'icons/screenshots');
  fs.mkdirSync(dir, { recursive: true });
  const shots = [
    { file: 'narrow.png', viewport: { width: 360, height: 640 }, scale: 3, hash: '#/' },
    { file: 'wide.png', viewport: { width: 1280, height: 720 }, scale: 1.5, hash: '#/' },
  ];
  for (const s of shots) {
    const ctx = await browser.newContext({ viewport: s.viewport, deviceScaleFactor: s.scale, colorScheme: 'dark', serviceWorkers: 'block' });
    await ctx.addInitScript(() => localStorage.setItem('pianocoach.onboarded', 'true'));
    const page = await ctx.newPage();
    await page.goto(base + s.hash);
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(dir, s.file) });
    await ctx.close();
    const { width, height } = pngSize(path.join(dir, s.file));
    console.log(`  capture icons/screenshots/${s.file} : ${width}x${height}`);
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  let failed = 0;
  const ok = (m) => console.log(`✔ ${m}`);
  const ko = (m) => { failed++; console.log(`✘ ${m}`); };
  const warn = (m) => console.log(`⚠ ${m}`);

  // 1. Statique
  const { errors, warnings, manifest } = validateManifest();
  errors.forEach(ko); warnings.forEach(warn);
  if (!errors.length) ok(`manifeste valide (${manifest.icons.length} icônes, ${(manifest.screenshots || []).length} captures, ${(manifest.shortcuts || []).length} raccourcis)`);
  const block = readSwBlock();
  if (!block) ko('sw.js : bloc ASSETS introuvable');
  else {
    const missingFiles = block.assets.filter((a) => !fs.existsSync(path.join(ROOT, a)));
    if (missingFiles.length) ko(`ASSETS liste des fichiers absents : ${missingFiles.join(', ')}`);
    else ok(`sw.js précache ${block.assets.length} fichiers (version ${block.version})`);
    const unlisted = collectAssets().filter((a) => !block.assets.includes(a));
    if (unlisted.length) warn(`${unlisted.length} fichier(s) non précaché(s) (${unlisted.slice(0, 5).join(', ')}${unlisted.length > 5 ? '…' : ''}) → node scripts/sw-assets.mjs`);
  }
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const abs = [...html.matchAll(/(?:href|src)="(\/[^"]*)"/g)].map((m) => m[1]);
  if (abs.length) ko(`index.html contient des chemins absolus : ${abs.join(', ')}`);
  else ok('index.html : uniquement des chemins relatifs');

  // 2. Navigateur, app montée dans /Piano/
  const { chromium } = loadPlaywright();
  const srv = await serveSubdir();
  const browser = await chromium.launch();
  try {
    const rootRes = await fetch(`http://localhost:${srv.port}/index.html`);
    if (rootRes.status === 404) ok('la racine du serveur répond 404 : l\'app ne vit que sous /Piano/');
    const ctx = await browser.newContext({ viewport: { width: 375, height: 760 } });
    await ctx.addInitScript(() => localStorage.setItem('pianocoach.onboarded', 'true'));
    const page = await ctx.newPage();
    const failedReqs = [];
    page.on('response', (r) => { if (r.status() >= 400) failedReqs.push(`${r.status()} ${r.url()}`); });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.goto(srv.url);
    const sw = await page.evaluate(async () => {
      const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(r, 10000, null))]);
      return reg ? { scope: reg.scope, state: reg.active?.state, script: reg.active?.scriptURL } : null;
    });
    if (sw && sw.scope === srv.url) ok(`service worker actif, portée ${sw.scope}`);
    else ko(`service worker non enregistré dans ${srv.url} (${JSON.stringify(sw)})`);

    const cdp = await ctx.newCDPSession(page);
    const am = await cdp.send('Page.getAppManifest');
    if (am.url && am.url.startsWith(srv.url) && !am.errors.filter((e) => e.critical).length) ok(`manifeste détecté par Chromium : ${am.url.replace(srv.url, '')}`);
    else ko(`manifeste non détecté ou en erreur : ${JSON.stringify(am.errors)}`);
    for (const e of am.errors.filter((x) => !x.critical)) warn(`manifeste : ${e.message}`);
    try {
      const inst = await cdp.send('Page.getInstallabilityErrors');
      const errs = (inst.installabilityErrors || []).map((e) => e.errorId);
      if (!errs.length) ok('Chromium : aucune erreur d\'installabilité');
      else ko(`erreurs d'installabilité : ${errs.join(', ')}`);
    } catch (e) {
      warn(`installabilité non vérifiable ici (${e.message})`);
    }

    // Icône masquable : zone sûre de 80 %
    const maskable = manifest?.icons.find((i) => String(i.purpose || '').includes('maskable'));
    if (maskable) {
      let box = await iconContentBox(page, srv.url + maskable.src);
      if (!inSafeZone(box) && args.has('--fix-maskable')) {
        await regenerateMaskable(page, srv.url);
        box = await iconContentBox(page, srv.url + maskable.src + '?v=' + Date.now());
        warn('icône masquable régénérée');
      }
      const pct = (v) => Math.round((v / box.width) * 100);
      if (inSafeZone(box) && box.opaque) ok(`icône masquable : dessin dans la zone sûre (cadre ${pct(box.x0)}–${pct(box.x1 + 1)} % × ${pct(box.y0)}–${pct(box.y1 + 1)} %, fond opaque)`);
      else ko(`icône masquable hors zone sûre ou fond transparent (${JSON.stringify(box)}) → --fix-maskable`);
    }
    // Une feuille de style absente ne casse pas l'app (une erreur JS, si : voir pageErrors).
    if (failedReqs.length) warn(`requêtes en échec : ${failedReqs.join(', ')}`);
    if (pageErrors.length) ko(`erreurs JS : ${pageErrors.join(' | ')}`);
    await ctx.close();
    if (args.has('--screenshots')) await takeScreenshots(browser, srv.url);
  } finally {
    await browser.close();
    await srv.close();
  }
  console.log(failed ? `\n${failed} problème(s).` : '\nPWA OK.');
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
