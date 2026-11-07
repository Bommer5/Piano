// Mesures de performance (Playwright + CDP), profil « téléphone Android d'entrée de gamme » :
// CPU ralenti ×4, réseau « Slow 4G ». Lancer : node scripts/perf/measure.mjs [--label after] [--runs 3]
// Les résultats sont enregistrés dans tests/perf/results-<label>.json ; si tests/perf/results-before.json
// existe, un tableau avant/après est affiché.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = path.join(root, 'tests/perf');
fs.mkdirSync(outDir, { recursive: true });

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i > 0 ? process.argv[i + 1] : d;
};
const LABEL = arg('label', 'after');
const RUNS = Number(arg('runs', 3));
const FPS_SECONDS = Number(arg('fps-seconds', 20));
const ROUND_TRIPS = Number(arg('trips', 20));
const SLOW_4G = { offline: false, latency: 150 * 3.75, downloadThroughput: ((1.6 * 1024 * 1024) / 8) * 0.9, uploadThroughput: ((750 * 1024) / 8) * 0.9 };

const server = createServer();
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}/`;
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--js-flags=--expose-gc', '--enable-precise-memory-info'] });

async function newPage({ network = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 375, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['microphone'], serviceWorkers: 'block' });
  await context.addInitScript(() => localStorage.setItem('pianocoach.onboarded', 'true'));
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (network) await cdp.send('Network.emulateNetworkConditions', SLOW_4G);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const js = new Map(); // url -> octets
  const pending = new Map();
  cdp.on('Network.responseReceived', (e) => { if (/\.m?js(\?|$)/.test(e.response.url)) pending.set(e.requestId, e.response.url); });
  cdp.on('Network.loadingFinished', (e) => {
    const u = pending.get(e.requestId);
    if (u) js.set(new URL(u).pathname, e.encodedDataLength);
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { context, page, cdp, js, errors };
}

const sumKB = (m) => Math.round([...m.values()].reduce((a, b) => a + b, 0) / 102.4) / 10;
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

// ---------- 1. Démarrage de l'accueil ----------
async function startup() {
  const { context, page, js } = await newPage();
  await page.goto(BASE + '#/', { waitUntil: 'commit' });
  await page.waitForFunction(() => document.querySelector('main .card, main section, main h1, main h2'), null, { polling: 'raf', timeout: 60000 });
  const fmp = await page.evaluate(() => Math.round(performance.now()));
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  const startJs = new Map(js);
  const routes = {};
  for (const [name, hash] of [['entraîneur', '#/jouer/__FIRST__'], ['accords', '#/accords'], ['importer', '#/importer'], ['jeux', '#/jeux'], ['éditeur', '#/editer/__FIRST__']]) {
    const before = new Set(js.keys());
    const id = await page.evaluate(async () => (await import('./js/data/songs.js')).SONGS[0].id);
    await page.evaluate((h) => (location.hash = h), hash.replace('__FIRST__', id));
    // attend que plus aucun module ne soit demandé pendant 1,5 s (chargements à la demande)
    let size = -1, since = Date.now();
    while (Date.now() - since < 1500) {
      await page.waitForTimeout(250);
      if (js.size !== size) { size = js.size; since = Date.now(); }
    }
    const added = [...js.keys()].filter((k) => !before.has(k));
    routes[name] = { modules: added.length, kb: Math.round(added.reduce((a, k) => a + js.get(k), 0) / 102.4) / 10 };
  }
  await context.close();
  return { fmp, startModules: startJs.size, startKB: sumKB(startJs), startList: [...startJs.keys()], routes };
}

// ---------- 2. Analyse micro (coût par trame, CPU ×4) ----------
async function micCost() {
  const { context, page, cdp } = await newPage({ network: false });
  await page.goto(BASE + '#/');
  await page.waitForLoadState('networkidle');
  const res = await page.evaluate(async () => {
    const { detectPitchAdaptive, synthTone } = await import('./js/core/pitch.js');
    const sr = 48000;
    const tone = synthTone([110, 220, 440, 880], sr, 4096, { harmonics: 5 }).map((v, i) => v * (1 + 0.001 * Math.sin(i)));
    const quiet = new Float32Array(4096).map(() => (Math.random() - 0.5) * 0.002);
    const bench = (buf, n) => {
      for (let i = 0; i < 20; i++) detectPitchAdaptive(buf, sr, { minRms: 0.004 });
      const t0 = performance.now();
      for (let i = 0; i < n; i++) detectPitchAdaptive(buf, sr, { minRms: 0.004 });
      return (performance.now() - t0) / n;
    };
    const tones = [55, 130.8, 261.6, 523.3, 1046.5].map((f) => synthTone(f, sr, 4096, { harmonics: 5, amp: 0.3 }));
    const pitched = tones.map((b) => bench(b, 60));
    // fil principal : micro factice de Chromium (bip), temps passé dans handleAnalysis
    const { mic } = await import('./js/audio/mic.js');
    let n = 0, tot = 0;
    const orig = mic.handleAnalysis.bind(mic);
    mic.handleAnalysis = (r) => { const t0 = performance.now(); orig(r); tot += performance.now() - t0; n++; };
    try { await mic.start(); } catch (e) { return { error: String(e) }; }
    await new Promise((r) => setTimeout(r, 4000));
    mic.stop();
    mic.handleAnalysis = orig;
    return { yinMs: pitched.reduce((a, b) => a + b, 0) / pitched.length, silentMs: bench(quiet, 400), mainMs: n ? tot / n : null, frames: n, mode: mic.mode };
  });
  await context.close();
  return { ...res, bytesPerFrame: await allocPerFrame() };
}

/** Octets alloués par trame d'analyse (Node, sans ramasse-miettes pendant la mesure : 100 trames ≪ new space). */
async function allocPerFrame() {
  const v8 = await import('node:v8');
  const vm = await import('node:vm');
  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc');
  const { detectPitchAdaptive, synthTone } = await import('../../js/core/pitch.js');
  const bufs = [55, 98, 220, 440, 880].map((f) => synthTone(f, 48000, 4096, { harmonics: 5 }));
  for (let i = 0; i < 200; i++) detectPitchAdaptive(bufs[i % 5], 48000, { minRms: 0.004 });
  // tas JS + tampons des tableaux typés (alloués hors du tas V8)
  const mem = () => { const u = process.memoryUsage(); return u.heapUsed + u.arrayBuffers; };
  const samples = [];
  for (let k = 0; k < 5; k++) {
    gc();
    const m0 = mem();
    for (let i = 0; i < 100; i++) detectPitchAdaptive(bufs[i % 5], 48000, { minRms: 0.004 });
    samples.push((mem() - m0) / 100);
  }
  return Math.round(median(samples));
}

// ---------- 3. FPS de l'entraîneur en mode Écoute ----------
async function trainerFps() {
  const { context, page, cdp } = await newPage({ network: false });
  await page.goto(BASE + '#/');
  await page.waitForLoadState('networkidle');
  const id = await page.evaluate(async () => (await import('./js/data/songs.js')).SONGS.slice().sort((a, b) => (b.notes?.length || 0) - (a.notes?.length || 0))[0].id);
  await page.evaluate((i) => (location.hash = '#/jouer/' + i + '?mode=listen&tempo=60'), id);
  await page.waitForSelector('.trainer .btn.primary.big');
  await page.waitForTimeout(800);
  await page.locator('.trainer .btn.primary.big').click();
  await cdp.send('Performance.enable');
  const m0 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const fr = await page.evaluate(async (secs) => {
    let frames = 0, worst = 0, last = performance.now(), long = 0;
    const t0 = last;
    await new Promise((res) => {
      const f = (t) => {
        frames++;
        const d = t - last;
        last = t;
        if (frames > 2) { worst = Math.max(worst, d); if (d > 50) long++; }
        if (t - t0 < secs * 1000) requestAnimationFrame(f); else res();
      };
      requestAnimationFrame(f);
    });
    return { fps: frames / ((performance.now() - t0) / 1000), worst, long };
  }, FPS_SECONDS);
  const m1 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const frames = fr.fps * FPS_SECONDS;
  const scriptMs = ((m1.ScriptDuration - m0.ScriptDuration) * 1000) / frames;
  const layoutMs = (((m1.LayoutDuration - m0.LayoutDuration) + (m1.RecalcStyleDuration - m0.RecalcStyleDuration)) * 1000) / frames;
  await context.close();
  return { song: id, fps: Math.round(fr.fps * 10) / 10, worstFrameMs: Math.round(fr.worst), longFrames: fr.long, scriptMsPerFrame: +scriptMs.toFixed(2), styleLayoutMsPerFrame: +layoutMs.toFixed(2) };
}

// ---------- 4. Fuites : 20 allers-retours accueil ↔ entraînement ----------
async function leaks() {
  const { context, page, cdp } = await newPage({ network: false });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await page.goto(BASE + '#/');
  await page.waitForLoadState('networkidle');
  const id = await page.evaluate(async () => (await import('./js/data/songs.js')).SONGS[0].id);
  const trip = async () => {
    await page.evaluate((i) => (location.hash = '#/jouer/' + i + '?mode=listen'), id);
    // pas de waitForSelector/locator ici : Playwright garderait une référence (handle) aux éléments → faux positif de fuite
    await page.waitForFunction(() => !!document.querySelector('.trainer .btn.primary.big'), null, { polling: 50 });
    await page.evaluate(() => document.querySelector('.trainer .btn.primary.big').click());
    await page.waitForTimeout(250);
    await page.evaluate(() => (location.hash = '#/'));
    await page.waitForTimeout(150);
  };
  const snap = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    await page.waitForTimeout(200);
    await cdp.send('HeapProfiler.collectGarbage');
    const heap = (await cdp.send('Runtime.getHeapUsage')).usedSize;
    const counts = await cdp.send('Memory.getDOMCounters');
    const lis = async (expr) => {
      const { result } = await cdp.send('Runtime.evaluate', { expression: expr });
      const r = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
      return r.listeners.length;
    };
    return { heap, nodes: counts.nodes, jsListeners: counts.jsEventListeners, winDocListeners: (await lis('window')) + (await lis('document')) };
  };
  await trip();
  await trip();
  const a = await snap();
  for (let i = 0; i < ROUND_TRIPS; i++) await trip();
  const b = await snap();
  // requestAnimationFrame encore actifs sur l'accueil ?
  const rafs = await page.evaluate(() => new Promise((res) => {
    let n = 0;
    const o = window.requestAnimationFrame;
    window.requestAnimationFrame = (f) => { n++; return o(f); };
    setTimeout(() => { window.requestAnimationFrame = o; res(n); }, 1000);
  }));
  await context.close();
  return { heapGrowthKB: Math.round((b.heap - a.heap) / 1024), nodesGrowth: b.nodes - a.nodes, listenersGrowth: b.jsListeners - a.jsListeners, winDocListenersGrowth: b.winDocListeners - a.winDocListeners, rafPerSecOnHome: rafs };
}

const results = { label: LABEL, date: new Date().toISOString() };
const st = [];
for (let i = 0; i < RUNS; i++) st.push(await startup());
results.startup = { ...st[0], fmp: median(st.map((s) => s.fmp)), fmpRuns: st.map((s) => s.fmp) };
results.mic = await micCost();
results.trainer = await trainerFps();
results.leaks = await leaks();
await browser.close();
server.close();
fs.writeFileSync(path.join(outDir, `results-${LABEL}.json`), JSON.stringify(results, null, 2));

const row = (r) => r && [
  ['Premier affichage utile accueil (ms, médiane)', r.startup.fmp],
  ['JS au démarrage (Ko transférés)', r.startup.startKB],
  ['Modules JS au démarrage', r.startup.startModules],
  ['JS en plus pour l’entraîneur (Ko)', r.startup.routes['entraîneur']?.kb],
  ['JS en plus pour Accords (Ko)', r.startup.routes['accords']?.kb],
  ['JS en plus pour Importer (Ko)', r.startup.routes['importer']?.kb],
  ['Analyse micro YIN, trame jouée (ms, CPU ×4)', +r.mic.yinMs?.toFixed(3)],
  ['Analyse micro, trame sous le seuil (ms)', +r.mic.silentMs?.toFixed(4)],
  ['Fil principal par trame micro (ms)', r.mic.mainMs != null ? +r.mic.mainMs.toFixed(3) : 'n/a'],
  ['Octets alloués par trame micro (Node)', r.mic.bytesPerFrame],
  ['Entraîneur, FPS (Écoute, 20 s)', r.trainer.fps],
  ['Entraîneur, script par trame (ms)', r.trainer.scriptMsPerFrame],
  ['Entraîneur, style+layout par trame (ms)', r.trainer.styleLayoutMsPerFrame],
  ['Entraîneur, pire trame (ms)', r.trainer.worstFrameMs],
  [`Croissance du tas après ${ROUND_TRIPS} allers-retours (Ko)`, r.leaks.heapGrowthKB],
  ['Écouteurs JS en plus', r.leaks.listenersGrowth],
  ['Nœuds DOM en plus', r.leaks.nodesGrowth],
  ['rAF/s restant sur l’accueil', r.leaks.rafPerSecOnHome],
];
const beforeFile = path.join(outDir, 'results-before.json');
const before = LABEL !== 'before' && fs.existsSync(beforeFile) ? JSON.parse(fs.readFileSync(beforeFile, 'utf8')) : null;
const rows = row(results);
const rb = row(before);
console.log(`\n| Mesure | ${before ? 'Avant | ' : ''}${LABEL === 'before' ? 'Avant' : 'Après'} |`);
console.log(`|---|${before ? '---|' : ''}---|`);
rows.forEach(([k, v], i) => console.log(`| ${k} | ${before ? rb[i][1] + ' | ' : ''}${v} |`));
