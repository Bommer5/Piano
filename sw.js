// Service worker de Piano Coach : l'app s'installe et fonctionne hors ligne.
//
// - Installation : précache « best-effort » de toutes les ressources de l'app (liste ASSETS
//   ci-dessous, complétée par les imports des modules). Un fichier manquant (404) est ignoré :
//   il ne bloque pas l'installation.
// - Navigation (ouverture de la page) : réseau, avec un délai de 3 s, puis cache.
// - Ressources (JS, CSS, images…) : réseau d'abord en développement (localhost),
//   « stale-while-revalidate » sinon (réponse immédiate depuis le cache, mise à jour en
//   arrière-plan). Seules les réponses `ok` sont stockées. Jamais de page HTML à la place
//   d'un module JS ou d'une feuille de style.
// - Mise à jour : quand une nouvelle version s'active, les pages ouvertes reçoivent
//   { type: 'pianocoach:update', version } via postMessage.
//
// La liste ASSETS et VERSION (hash du contenu) sont réécrites par `node scripts/sw-assets.mjs`.

// <ASSETS> (généré par scripts/sw-assets.mjs, ne pas éditer à la main)
const VERSION = 'a7dea8c5cdc8';
const ASSETS = [
  "css/audio.css",
  "css/games.css",
  "css/harmony.css",
  "css/notation.css",
  "css/profile.css",
  "css/style.css",
  "css/trainer.css",
  "icon.svg",
  "icons/icon-192.png",
  "icons/icon-512-maskable.png",
  "icons/icon-512.png",
  "index.html",
  "js/app.js",
  "js/audio/mic-worklet.js",
  "js/audio/mic.js",
  "js/audio/midi-input.js",
  "js/audio/midi-output.js",
  "js/audio/synth.js",
  "js/core/achievements.js",
  "js/core/coursegen.js",
  "js/core/eartraining.js",
  "js/core/edit.js",
  "js/core/fingering.js",
  "js/core/follower.js",
  "js/core/harmony.js",
  "js/core/notation.js",
  "js/core/notes.js",
  "js/core/onset.js",
  "js/core/pitch.js",
  "js/core/plan.js",
  "js/core/practice.js",
  "js/core/reading.js",
  "js/core/rhythmgame.js",
  "js/core/share.js",
  "js/core/song.js",
  "js/core/spectrum.js",
  "js/core/storage.js",
  "js/core/take.js",
  "js/core/theory.js",
  "js/core/transcribe.js",
  "js/data/glossary.js",
  "js/data/lessons.js",
  "js/data/songs.js",
  "js/parsers/abc.js",
  "js/parsers/index.js",
  "js/parsers/midi.js",
  "js/parsers/musicxml.js",
  "js/parsers/mxl.js",
  "js/parsers/xml.js",
  "js/ui/context.js",
  "js/ui/dom.js",
  "js/ui/editor.js",
  "js/ui/keyboard.js",
  "js/ui/report.js",
  "js/ui/roll.js",
  "js/ui/shell.js",
  "js/ui/staff.js",
  "js/ui/trainer.js",
  "js/views/audio-settings.js",
  "js/views/calibration.js",
  "js/views/chords.js",
  "js/views/courses.js",
  "js/views/ear.js",
  "js/views/editor.js",
  "js/views/games.js",
  "js/views/glossary.js",
  "js/views/home.js",
  "js/views/import.js",
  "js/views/index.js",
  "js/views/library.js",
  "js/views/notation-settings.js",
  "js/views/progress.js",
  "js/views/reading.js",
  "js/views/rhythm.js",
  "js/views/settings.js",
  "js/views/share.js",
  "js/views/song.js",
  "js/views/teacher.js",
  "js/views/tuner.js",
  "js/views/welcome.js",
  "manifest.webmanifest",
  "samples/exemple.abc",
  "samples/exemple.mid",
  "samples/exemple.musicxml",
  "samples/exemple.txt"
];
// </ASSETS>

const PREFIX = 'pianocoach-';
const CACHE = PREFIX + VERSION;
const NAV_TIMEOUT_MS = 3000;
const DEV = ['localhost', '127.0.0.1', '[::1]'].includes(self.location.hostname);
const SHELL = new URL('index.html', self.location).href;
const ROOT = new URL('./', self.location).href;

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(precache());
});

async function precache() {
  const cache = await caches.open(CACHE);
  // ASSETS sert de point de départ : on suit aussi les imports des modules JS et les liens de
  // index.html, pour qu'un fichier ajouté sans relancer scripts/sw-assets.mjs soit quand même
  // disponible hors ligne.
  const seen = new Set();
  const queue = ASSETS.map((a) => new URL(a, self.location).href);
  const scope = new URL('./', self.location).href;
  const enqueue = (ref, base) => {
    const url = new URL(ref, base);
    url.hash = '';
    if (url.href.startsWith(scope) && !seen.has(url.href)) queue.push(url.href);
  };
  async function load(url) {
    try {
      const res = await fetch(new Request(url, { cache: 'reload' }));
      if (!res.ok) return; // 404 & co : ignoré, l'installation continue
      const type = res.headers.get('content-type') || '';
      if (/javascript|html/.test(type)) {
        const text = await res.clone().text();
        for (const ref of findRefs(text, /html/.test(type))) enqueue(ref, url);
      }
      await cache.put(url, res);
    } catch {
      // Hors ligne ou erreur : la ressource sera mise en cache à la première utilisation.
    }
  }
  while (queue.length && seen.size < 1000) {
    const batch = queue.splice(0).filter((u) => !seen.has(u) && seen.add(u));
    await Promise.all(batch.map(load));
  }
  // La racine « ./ » sert la même page que index.html.
  const shell = await cache.match(SHELL);
  if (shell) await cache.put(ROOT, shell);
}

/** Références relatives d'un module JS (import/export … from, import()) ou d'une page HTML (href/src). */
function findRefs(text, html) {
  const out = [];
  const re = html
    ? /\s(?:href|src)\s*=\s*["']([^"'#?:]+)["']/g
    : /(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g;
  for (const m of text.matchAll(re)) if (!m[1].startsWith('/')) out.push(m[1]);
  return out;
}

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const old = keys.filter((k) => k !== CACHE && k.startsWith(PREFIX));
    await Promise.all(old.map((k) => caches.delete(k)));
    await self.clients.claim();
    // S'il existait un ancien cache, c'est une mise à jour : on prévient les pages ouvertes.
    if (old.length) {
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const c of clients) c.postMessage({ type: 'pianocoach:update', version: VERSION });
    }
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'pianocoach:version') event.source?.postMessage({ type: 'pianocoach:version', version: VERSION });
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  if (new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') event.respondWith(navigate(event));
  else event.respondWith(asset(event));
});

/** Met une copie de la réponse en cache, seulement si elle est `ok` (jamais une 404). */
function store(event, req, res) {
  if (!res || !res.ok || res.type === 'opaque') return;
  const copy = res.clone();
  const done = caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
  try {
    event.waitUntil(done);
  } catch {
    // L'événement est déjà terminé (réponse servie depuis le cache) : la copie se fait quand même.
  }
}

async function navigate(event) {
  const req = event.request;
  const network = fetch(req).then((res) => {
    if (res.ok && !res.redirected) store(event, req, res);
    return res;
  });
  const timer = new Promise((resolve) => setTimeout(resolve, NAV_TIMEOUT_MS, null));
  const first = await Promise.race([network.catch(() => null), timer]);
  if (first) return first;
  const cache = await caches.open(CACHE);
  const cached = (await cache.match(req, { ignoreSearch: true })) || (await cache.match(SHELL)) || (await cache.match(ROOT));
  if (cached) return cached;
  return network.catch(() => new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Piano Coach</title>'
    + '<p style="font:16px system-ui;padding:1em">Pas de connexion. Ouvre Piano Coach une première fois avec Internet pour l\'utiliser hors ligne.</p>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  ));
}

async function asset(event) {
  const req = event.request;
  const cache = await caches.open(CACHE);
  if (DEV) {
    try {
      const res = await fetch(req);
      store(event, req, res);
      return res;
    } catch (err) {
      const cached = await cache.match(req);
      if (cached) return cached;
      throw err;
    }
  }
  const cached = await cache.match(req);
  const update = fetch(req).then((res) => {
    store(event, req, res);
    return res;
  });
  if (cached) {
    event.waitUntil(update.catch(() => {}));
    return cached;
  }
  return update; // échec réseau → erreur réseau normale, pas de repli HTML
}
