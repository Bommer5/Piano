// Mini parseur XML autonome (sans DOMParser), suffisant pour MusicXML.
// Gère : éléments, attributs, texte, CDATA, commentaires, instructions de traitement,
// DOCTYPE (y compris sous-ensemble interne [...]), entités prédéfinies et numériques.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return m;
      try {
        return String.fromCodePoint(code);
      } catch {
        return m;
      }
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, e) ? ENTITIES[e] : m;
  });
}

export class XmlNode {
  constructor(name, attrs = {}, parent = null) {
    this.name = name;
    this.attrs = attrs;
    this.parent = parent;
    /** Enfants : XmlNode ou chaînes (texte). */
    this.nodes = [];
  }
  /** Éléments enfants (optionnellement filtrés par nom). */
  children(name) {
    const out = [];
    for (const n of this.nodes) if (typeof n !== 'string' && (name == null || n.name === name)) out.push(n);
    return out;
  }
  child(name) {
    for (const n of this.nodes) if (typeof n !== 'string' && n.name === name) return n;
    return null;
  }
  /** Premier descendant au chemin « a/b/c ». */
  path(p) {
    let cur = this;
    for (const part of p.split('/')) {
      if (!cur) return null;
      cur = cur.child(part);
    }
    return cur;
  }
  /** Texte concaténé (récursif). */
  text() {
    let s = '';
    for (const n of this.nodes) s += typeof n === 'string' ? n : n.text();
    return s;
  }
  attr(name, def = null) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : def;
  }
  /** Texte trimé d'un enfant, ou valeur par défaut. */
  childText(name, def = null) {
    const c = this.child(name);
    return c ? c.text().trim() : def;
  }
  /** Tous les descendants portant ce nom. */
  descendants(name, out = []) {
    for (const n of this.nodes) {
      if (typeof n === 'string') continue;
      if (n.name === name) out.push(n);
      n.descendants(name, out);
    }
    return out;
  }
}

function err(msg, pos) {
  return new Error(`XML invalide : ${msg} (position ${pos}).`);
}

const NAME_RE = /[A-Za-z_:À-￿][-A-Za-z0-9_:.·À-￿]*/y;

/**
 * Analyse un document XML.
 * @param {string} src
 * @returns {XmlNode} l'élément racine
 */
export function parseXML(src) {
  if (typeof src !== 'string') throw new Error('XML invalide : le contenu doit être du texte.');
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
  const doc = new XmlNode('#document');
  let cur = doc;
  let i = 0;
  const n = src.length;

  const readName = () => {
    NAME_RE.lastIndex = i;
    const m = NAME_RE.exec(src);
    if (!m) throw err('nom attendu', i);
    i += m[0].length;
    return m[0];
  };
  const skipWs = () => {
    while (i < n && /\s/.test(src[i])) i++;
  };

  while (i < n) {
    const lt = src.indexOf('<', i);
    const end = lt < 0 ? n : lt;
    if (end > i) {
      const txt = src.slice(i, end);
      if (cur === doc) {
        if (txt.trim()) throw err('texte hors de l’élément racine', i);
      } else cur.nodes.push(decodeEntities(txt));
      i = end;
      if (lt < 0) break;
    }
    // src[i] === '<'
    if (src.startsWith('<!--', i)) {
      const e = src.indexOf('-->', i + 4);
      if (e < 0) throw err('commentaire non fermé', i);
      i = e + 3;
    } else if (src.startsWith('<![CDATA[', i)) {
      const e = src.indexOf(']]>', i + 9);
      if (e < 0) throw err('section CDATA non fermée', i);
      if (cur === doc) throw err('CDATA hors de l’élément racine', i);
      cur.nodes.push(src.slice(i + 9, e));
      i = e + 3;
    } else if (src.startsWith('<?', i)) {
      const e = src.indexOf('?>', i + 2);
      if (e < 0) throw err('instruction de traitement non fermée', i);
      i = e + 2;
    } else if (src.startsWith('<!', i)) {
      // DOCTYPE ou autre déclaration, avec éventuel sous-ensemble interne [...]
      let j = i + 2;
      let depth = 0;
      let quote = null;
      for (; j < n; j++) {
        const c = src[j];
        if (quote) {
          if (c === quote) quote = null;
        } else if (c === '"' || c === "'") quote = c;
        else if (c === '[') depth++;
        else if (c === ']') depth--;
        else if (c === '>' && depth <= 0) break;
      }
      if (j >= n) throw err('déclaration non fermée', i);
      i = j + 1;
    } else if (src[i + 1] === '/') {
      i += 2;
      const name = readName();
      skipWs();
      if (src[i] !== '>') throw err(`« > » attendu après </${name}`, i);
      i++;
      if (cur === doc || cur.name !== name) throw err(`balise fermante </${name}> inattendue`, i);
      cur = cur.parent;
    } else {
      i++;
      const name = readName();
      const attrs = {};
      for (;;) {
        skipWs();
        if (i >= n) throw err(`balise <${name}> non terminée`, i);
        if (src[i] === '/' && src[i + 1] === '>') {
          i += 2;
          const node = new XmlNode(name, attrs, cur);
          if (cur === doc && doc.children().length) throw err('plusieurs éléments racine', i);
          cur.nodes.push(node);
          break;
        }
        if (src[i] === '>') {
          i++;
          const node = new XmlNode(name, attrs, cur);
          if (cur === doc && doc.children().length) throw err('plusieurs éléments racine', i);
          cur.nodes.push(node);
          cur = node;
          break;
        }
        const an = readName();
        skipWs();
        if (src[i] !== '=') throw err(`« = » attendu après l’attribut ${an}`, i);
        i++;
        skipWs();
        const q = src[i];
        if (q !== '"' && q !== "'") throw err(`valeur entre guillemets attendue pour ${an}`, i);
        const e = src.indexOf(q, i + 1);
        if (e < 0) throw err(`valeur d’attribut non fermée (${an})`, i);
        attrs[an] = decodeEntities(src.slice(i + 1, e));
        i = e + 1;
      }
    }
  }
  if (cur !== doc) throw err(`élément <${cur.name}> non fermé`, n);
  const root = doc.children()[0];
  if (!root) throw new Error('XML invalide : aucun élément racine.');
  root.parent = null;
  return root;
}
