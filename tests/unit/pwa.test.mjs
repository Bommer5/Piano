// PWA : manifeste installable, service worker valide, liste de précache cohérente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { validateManifest, pngSize } from '../../scripts/check-pwa.mjs';
import { ROOT, SW_FILE, readSwBlock, collectAssets } from '../../scripts/sw-assets.mjs';

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
const relative = (u) => typeof u === 'string' && !u.startsWith('/') && !/^[a-z]+:/i.test(u);

test('manifeste : champs requis et chemins relatifs (sous-dossier GitHub Pages)', () => {
  assert.ok(manifest.name);
  assert.ok(manifest.short_name);
  for (const k of ['start_url', 'scope', 'id']) assert.ok(relative(manifest[k]), `${k} doit être relatif : ${manifest[k]}`);
  assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
  assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.prefer_related_applications, false);
  assert.ok(Array.isArray(manifest.display_override));
});

test('manifeste : icônes 192 et 512 aux vraies dimensions + une masquable', () => {
  const pngs = manifest.icons.filter((i) => i.type === 'image/png');
  for (const ic of pngs) {
    assert.ok(relative(ic.src), ic.src);
    const { width, height } = pngSize(path.join(ROOT, ic.src));
    assert.equal(ic.sizes, `${width}x${height}`, `${ic.src} : dimensions déclarées ≠ en-tête PNG`);
  }
  const sizes = (p) => pngs.filter((i) => String(i.purpose || 'any').split(' ').includes(p)).map((i) => i.sizes);
  assert.ok(sizes('any').includes('192x192'));
  assert.ok(sizes('any').includes('512x512'));
  assert.ok(sizes('maskable').length >= 1);
});

test('manifeste : captures (narrow + wide) et raccourcis', () => {
  const ff = manifest.screenshots.map((s) => s.form_factor);
  assert.ok(ff.includes('narrow') && ff.includes('wide'));
  for (const s of manifest.screenshots) {
    const { width, height } = pngSize(path.join(ROOT, s.src));
    assert.equal(s.sizes, `${width}x${height}`);
  }
  const urls = manifest.shortcuts.map((s) => s.url);
  assert.deepEqual(urls, ['./#/bibliotheque', './#/cours', './#/accordeur']);
  assert.deepEqual(validateManifest().errors, []);
});

test('sw.js est syntaxiquement valide', () => {
  const src = fs.readFileSync(SW_FILE, 'utf8');
  assert.doesNotThrow(() => new vm.Script(src, { filename: 'sw.js' }));
  assert.match(src, /res\.ok/, 'seules les réponses ok doivent être mises en cache');
});

test('sw.js : chaque entrée de ASSETS existe', (t) => {
  const block = readSwBlock();
  assert.ok(block, 'bloc ASSETS introuvable dans sw.js');
  assert.match(block.version, /^[0-9a-f]{8,}$/);
  assert.ok(block.assets.includes('index.html'));
  for (const a of block.assets) {
    assert.ok(relative(a), `chemin non relatif : ${a}`);
    assert.ok(fs.existsSync(path.join(ROOT, a)), `ASSETS liste un fichier absent : ${a} (→ node scripts/sw-assets.mjs)`);
  }
  // Des fichiers ajoutés par d'autres agents peuvent ne pas encore être listés : simple avertissement.
  const unlisted = collectAssets().filter((a) => !block.assets.includes(a));
  if (unlisted.length) t.diagnostic(`⚠ non précachés : ${unlisted.join(', ')} → node scripts/sw-assets.mjs`);
});
