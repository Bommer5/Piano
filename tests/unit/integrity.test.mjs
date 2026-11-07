// Intégrité du projet : imports, feuilles de style, vues enregistrées, liste du service worker.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkAll, ROOT } from '../../scripts/check-imports.mjs';

test('imports relatifs et noms importés valides, CSS liés dans index.html', () => {
  const problems = checkAll();
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('chaque fichier de js/views/ est importé dans js/views/index.js', () => {
  const dir = path.join(ROOT, 'js/views');
  const index = fs.readFileSync(path.join(dir, 'index.js'), 'utf8');
  const imported = new Set([...index.matchAll(/import\s*\(?\s*['"]\.\/([^'"]+)['"]/g)].map((m) => m[1]));
  const missing = fs.readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'index.js' && !imported.has(f));
  assert.deepEqual(missing, [], 'vues non importées : ' + missing.join(', '));
});

test('chaque vue enregistre au moins une route ou une section', () => {
  const dir = path.join(ROOT, 'js/views');
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.js') || f === 'index.js') continue;
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(/registerRoute\(|settingsSections\.push|homeSections\.push|^export /m.test(src), `${f} n'enregistre rien`);
  }
});

test('liste des ressources du service worker à jour (sw-assets --check)', () => {
  // Lève une erreur (code de sortie 1) si la liste ASSETS de sw.js n'est pas à jour.
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/sw-assets.mjs'), '--check'], { cwd: ROOT, stdio: 'pipe' });
});
