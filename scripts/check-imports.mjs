// Vérifie l'intégrité des modules (Node pur, sans dépendance) :
//  - chaque import relatif (statique `import … from './x.js'`, `export … from`, `import './x.js'`
//    et dynamique `import('./x.js')` avec une chaîne littérale) de js/ pointe vers un fichier existant ;
//  - chaque nom importé `{ a, b as c }` est exporté par le module cible ;
//  - chaque css/*.css est lié dans index.html, et chaque feuille liée existe.
//
//   node scripts/check-imports.mjs     → code de sortie 1 et liste des problèmes s'il y en a
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, ext) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(abs, ext));
    else if (ent.name.endsWith(ext)) out.push(abs);
  }
  return out;
}

/** Retire les commentaires (approximatif mais suffisant : ignore les chaînes contenant // ). */
function stripComments(src) {
  // Commentaires de ligne d'abord : « js/views/*.js » dans un commentaire // ouvrirait sinon un faux bloc.
  return src.replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
}

const exportCache = new Map();
/** Noms exportés par un module (null = `export *` non résolu → on ne vérifie pas). */
export function exportsOf(file) {
  if (exportCache.has(file)) return exportCache.get(file);
  const src = stripComments(fs.readFileSync(file, 'utf8'));
  const names = new Set();
  let star = false;
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  // export const { a, b } = … / export const [a, b] = …
  for (const m of src.matchAll(/export\s+(?:const|let|var)\s+[{[]([^}\]]*)[}\]]/g)) for (const p of m[1].split(',')) { const n = p.split(':').pop().split('=')[0].trim(); if (n) names.add(n); }
  if (/export\s+default\b/.test(src)) names.add('default');
  for (const m of src.matchAll(/export\s*\{([^}]*)\}(\s*from\s*['"]([^'"]+)['"])?/g)) {
    for (const part of m[1].split(',')) {
      const p = part.trim();
      if (!p) continue;
      const as = p.split(/\s+as\s+/);
      names.add((as[1] || as[0]).trim());
    }
  }
  for (const m of src.matchAll(/export\s*\*\s*(?:as\s+([\w$]+)\s*)?from\s*['"]([^'"]+)['"]/g)) {
    if (m[1]) names.add(m[1]);
    else if (m[2].startsWith('.')) {
      const sub = exportsOf(path.resolve(path.dirname(file), m[2]));
      if (sub) sub.forEach((n) => n !== 'default' && names.add(n));
      else star = true;
    } else star = true;
  }
  const res = star ? null : names;
  exportCache.set(file, res);
  return res;
}

/** Liste des imports relatifs d'un fichier : { spec, names: string[]|null, line }. */
export function importsOf(file) {
  const src = stripComments(fs.readFileSync(file, 'utf8'));
  const lineOf = (i) => src.slice(0, i).split('\n').length;
  const out = [];
  // import X, { a, b as c } from '…' ; import * as ns from '…' ; import '…' ; export { … } from '…'
  const re = /(?:^|[;\n}])\s*(import|export)\s*([\s\S]*?)\s*from\s*['"]([^'"]+)['"]|(?:^|[;\n])\s*import\s*['"]([^'"]+)['"]/g;
  for (const m of src.matchAll(re)) {
    if (m[4]) { out.push({ spec: m[4], names: [], line: lineOf(m.index) }); continue; }
    const clause = m[2];
    if (m[1] === 'export' && !/^[{*]/.test(clause)) continue;
    const names = [];
    const brace = clause.match(/\{([^}]*)\}/);
    if (brace) for (const part of brace[1].split(',')) { const n = part.trim().split(/\s+as\s+/)[0].trim(); if (n) names.push(n); }
    const def = m[1] === 'import' && clause.replace(/\{[^}]*\}/, '').replace(/\*\s*as\s+[\w$]+/, '').split(',')[0].trim();
    if (def && /^[A-Za-z_$][\w$]*$/.test(def)) names.push('default');
    out.push({ spec: m[3], names, line: lineOf(m.index) });
  }
  for (const m of src.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push({ spec: m[1], names: [], line: lineOf(m.index), dynamic: true });
  return out;
}

/** Vérifie tout ; renvoie la liste des problèmes (tableau de chaînes, vide si tout va bien). */
export function checkAll(root = ROOT) {
  const problems = [];
  const rel = (f) => path.relative(root, f).split(path.sep).join('/');
  const jsFiles = walk(path.join(root, 'js'), '.js');
  for (const file of jsFiles) {
    for (const imp of importsOf(file)) {
      if (!imp.spec.startsWith('.')) continue;
      // Les chemins dynamiques résolus par rapport au document (ex. `import('./js/…')`) ne concernent pas js/.
      const target = path.resolve(path.dirname(file), imp.spec);
      if (!fs.existsSync(target)) {
        problems.push(`${rel(file)}:${imp.line} importe « ${imp.spec} » : fichier introuvable`);
        continue;
      }
      if (!imp.names.length) continue;
      const exp = exportsOf(target);
      if (!exp) continue;
      for (const n of imp.names) if (!exp.has(n)) problems.push(`${rel(file)}:${imp.line} importe « ${n} » depuis ${imp.spec}, qui ne l'exporte pas`);
    }
  }
  // Feuilles de style ↔ index.html
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const linked = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/g)].map((m) => m[1].replace(/^\.\//, '').split('?')[0]);
  const cssFiles = walk(path.join(root, 'css'), '.css').map(rel);
  for (const c of cssFiles) if (!linked.includes(c)) problems.push(`${c} n'est pas lié dans index.html`);
  for (const l of linked) if (!/^https?:/.test(l) && !fs.existsSync(path.join(root, l))) problems.push(`index.html lie ${l}, qui n'existe pas`);
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = checkAll();
  if (problems.length) {
    console.error(`✘ ${problems.length} problème(s) d'imports :\n  ` + problems.join('\n  '));
    process.exit(1);
  }
  console.log('✔ Imports JS et feuilles de style cohérents.');
}
