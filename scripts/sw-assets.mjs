// Met à jour la liste ASSETS (fichiers précachés) et la version du cache dans sw.js.
//
//   node scripts/sw-assets.mjs           réécrit le bloc ASSETS de sw.js
//   node scripts/sw-assets.mjs --check   signale les écarts sans rien écrire (code de sortie 1 si écart)
//
// Pas d'étape de build au déploiement : sw.js est commité tel quel, ce script sert juste
// à garder sa liste à jour quand on ajoute/supprime des fichiers. La version du cache est
// un hash du contenu des fichiers listés : toute modification produit un nouveau sw.js,
// donc le navigateur installe le nouveau service worker et vide l'ancien cache.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SW_FILE = path.join(ROOT, 'sw.js');
const BEGIN = '// <ASSETS> (généré par scripts/sw-assets.mjs, ne pas éditer à la main)';
const END = '// </ASSETS>';

function walk(dir, filter) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = dir ? `${dir}/${ent.name}` : ent.name;
    if (ent.name.startsWith('.')) continue;
    if (ent.isDirectory()) out.push(...walk(rel, filter));
    else if (filter(rel)) out.push(rel);
  }
  return out;
}

/** Liste des ressources de l'app à précacher (chemins relatifs à la racine, triés). */
export function collectAssets() {
  const list = [
    'index.html',
    'manifest.webmanifest',
    'icon.svg',
    // Icônes de l'app (pas les captures d'écran, utiles seulement à l'installation).
    ...walk('icons', (f) => /\.png$/i.test(f) && !f.startsWith('icons/screenshots/')),
    ...walk('css', (f) => /\.css$/i.test(f)),
    ...walk('js', (f) => /\.m?js$/i.test(f)),
    ...walk('samples', () => true),
  ].filter((f) => fs.existsSync(path.join(ROOT, f)));
  return [...new Set(list)].sort();
}

/** Hash court du contenu des ressources (la « version » du cache). */
export function hashAssets(assets) {
  const h = crypto.createHash('sha256');
  for (const f of assets) {
    h.update(f + '\0');
    h.update(fs.readFileSync(path.join(ROOT, f)));
    h.update('\0');
  }
  return h.digest('hex').slice(0, 12);
}

/** Lit le bloc ASSETS actuel de sw.js → { assets, version } (ou null si absent). */
export function readSwBlock(src = fs.readFileSync(SW_FILE, 'utf8')) {
  const i = src.indexOf(BEGIN), j = src.indexOf(END);
  if (i < 0 || j < i) return null;
  const block = src.slice(i + BEGIN.length, j);
  const version = (block.match(/const VERSION = '([^']*)'/) || [])[1] ?? null;
  const arr = block.match(/const ASSETS = (\[[\s\S]*?\]);/);
  return { version, assets: arr ? JSON.parse(arr[1]) : [] };
}

export function renderBlock(assets, version) {
  return `${BEGIN}\nconst VERSION = '${version}';\nconst ASSETS = [\n${assets.map((a) => `  ${JSON.stringify(a)},`).join('\n').replace(/,$/, '')}\n];\n${END}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const src = fs.readFileSync(SW_FILE, 'utf8');
  const cur = readSwBlock(src);
  if (!cur) {
    console.error(`sw.js : bloc ASSETS introuvable (marqueurs « ${BEGIN} » … « ${END} »).`);
    process.exit(1);
  }
  const assets = collectAssets();
  const version = hashAssets(assets);
  const missing = assets.filter((a) => !cur.assets.includes(a));
  const extra = cur.assets.filter((a) => !assets.includes(a));
  if (check) {
    let ok = true;
    if (missing.length) { ok = false; console.log(`Fichiers non listés dans ASSETS (${missing.length}) :\n  + ${missing.join('\n  + ')}`); }
    if (extra.length) { ok = false; console.log(`Entrées de ASSETS sans fichier (${extra.length}) :\n  - ${extra.join('\n  - ')}`); }
    if (cur.version !== version) { ok = false; console.log(`Version du cache périmée : ${cur.version} → ${version}`); }
    console.log(ok ? `sw.js à jour (${assets.length} fichiers, version ${version}).` : '→ lance « node scripts/sw-assets.mjs » pour mettre sw.js à jour.');
    process.exit(ok ? 0 : 1);
  }
  const start = src.indexOf('// <ASSETS>');
  const end = src.indexOf(END) + END.length;
  const next = src.slice(0, start) + renderBlock(assets, version) + src.slice(end);
  if (next === src) console.log(`sw.js déjà à jour (${assets.length} fichiers, version ${version}).`);
  else {
    fs.writeFileSync(SW_FILE, next);
    console.log(`sw.js mis à jour : ${assets.length} fichiers, version ${version}` + (missing.length ? `, +${missing.length}` : '') + (extra.length ? `, -${extra.length}` : '') + '.');
  }
}
