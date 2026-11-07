// Vue : glossaire (#/glossaire?q=…)
import { GLOSSARY_CATEGORIES, searchGlossary } from '../data/glossary.js';
import { keyDiagram } from '../ui/keyboard.js';
import { h, speak } from '../ui/dom.js';
import { main, registerRoute } from '../ui/context.js';

function termCard(t) {
  return h('article', { class: 'gloss-card', id: 'terme-' + t.id }, [
    h('h3', {}, t.term),
    h('p', {}, t.def),
    t.keys?.length ? h('div', { class: 'term-diagram', 'aria-hidden': 'true' }, keyDiagram(t.keys.map((k) => (typeof k === 'number' ? { midi: k } : k)), t.range || {})) : null,
    h('button', { type: 'button', class: 'btn tiny', 'aria-label': 'Écouter la définition de ' + t.term, onclick: () => speak(`${t.term}. ${t.def}`, { force: true }) }, '🔈 Écouter'),
  ]);
}

function viewGlossary(query) {
  const input = h('input', { type: 'search', placeholder: 'Chercher un mot : tempo, croche, armure…', 'aria-label': 'Chercher dans le glossaire', value: query.q || '' });
  const out = h('div', { class: 'gloss-results', 'aria-live': 'polite' });
  const render = () => {
    const res = searchGlossary(input.value);
    out.innerHTML = '';
    if (!res.length) return out.append(h('p', { class: 'empty' }, 'Aucun mot trouvé.'));
    if (input.value.trim()) return out.append(h('div', { class: 'gloss-grid' }, res.map(termCard)));
    for (const [cat, label] of GLOSSARY_CATEGORIES) {
      const items = res.filter((t) => t.cat === cat);
      if (items.length) out.append(h('h2', {}, label), h('div', { class: 'gloss-grid' }, items.map(termCard)));
    }
  };
  input.addEventListener('input', render);
  main.append(h('h1', {}, '📖 Glossaire'), h('p', { class: 'lead' }, 'Les mots de la musique expliqués simplement, avec un schéma du clavier quand c’est utile.'), h('div', { class: 'filters' }, input), out);
  render();
}

registerRoute(/^glossaire$/, viewGlossary);
