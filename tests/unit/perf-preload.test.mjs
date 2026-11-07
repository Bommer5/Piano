// Les modules préchargés au démarrage (views/index.js, DEEP_PRELOAD) doivent exister et être réellement importés
// par une vue (sinon le préchargement gaspille de la bande passante).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const views = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../js/views');
const src = fs.readFileSync(path.join(views, 'index.js'), 'utf8');
const list = [...src.match(/DEEP_PRELOAD = \[([\s\S]*?)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

test('perf : DEEP_PRELOAD — fichiers existants et importés statiquement', () => {
  assert.ok(list.length > 0);
  const all = fs.readdirSync(path.join(views, '..'), { recursive: true }).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(views, '..', f), 'utf8')).join('\n');
  for (const rel of list) {
    const file = path.resolve(views, rel);
    assert.ok(fs.existsSync(file), `${rel} introuvable`);
    const base = path.basename(rel);
    assert.match(all, new RegExp(`^import[^\\n]*from '[./]*[^']*/${base.replace('.', '\\.')}';`, 'm'), `${rel} n’est importé statiquement nulle part`);
  }
});
