// Piano Coach — point d'entrée : routeur. Les vues sont dans js/views/*.js.
import { store } from './core/storage.js';
import * as synth from './audio/synth.js';
import { computerKeyboard } from './audio/midi-input.js';
import { h, toast } from './ui/dom.js';
import { ctx, main, routes, applyTheme, findSong } from './ui/context.js';
import { failedViews } from './views/index.js';
import './ui/motion.js'; // animations + réglage « Réduire les animations » (agent design)

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  return { path: decodeURIComponent(path || ''), query: Object.fromEntries(new URLSearchParams(qs || '')) };
}

export function route() {
  ctx.cleanup.forEach((f) => {
    try { f(); } catch (e) { console.error(e); }
  });
  ctx.cleanup = [];
  ctx.settings = store.settings();
  const { path, query } = parseHash();
  main.innerHTML = '';
  main.className = '';
  const top = path.split('/')[0] || 'home';
  // Onglet de navigation mis en évidence pour chaque route (par défaut : le premier segment).
  const navOf = { '': 'home', seance: 'home', bienvenue: 'home', morceau: 'bibliotheque', jouer: 'bibliotheque', editer: 'bibliotheque', partage: 'bibliotheque', lecon: 'cours', parcours: 'cours', exercice: 'cours' };
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === (navOf[top] || top)));
  // « Plus » est mis en évidence quand la page active est dans son menu.
  document.querySelector('.nav-more')?.classList.toggle('active', !!document.querySelector('.nav-more [data-nav].active'));
  for (const [re, fn] of routes) {
    const m = path.match(re);
    if (m) {
      try {
        fn(...m.slice(1), query);
      } catch (err) {
        console.error(err);
        main.append(h('div', { class: 'card error' }, [h('h2', {}, 'Oups…'), h('p', {}, err.message), h('a', { href: '#/', class: 'btn' }, "Retour à l'accueil")]));
      }
      main.focus({ preventScroll: true });
      window.scrollTo(0, 0);
      return;
    }
  }
  // Une vue qui n'a pas pu se charger n'a pas enregistré ses routes : on le dit clairement.
  const hint = failedViews.length ? h('p', { class: 'muted' }, 'Une partie de l’application n’a pas pu être chargée (connexion interrompue ?). Recharge la page pour réessayer.') : null;
  main.append(h('div', { class: 'card' }, [h('h2', {}, 'Page introuvable'), hint, h('div', { class: 'row' }, [h('a', { href: '#/', class: 'btn' }, 'Accueil'), hint ? h('button', { class: 'btn primary', onclick: () => location.reload() }, 'Recharger') : null])]));
}
ctx.route = route;

// ---------- démarrage ----------
applyTheme();
matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', applyTheme);
computerKeyboard.attach();
window.addEventListener('hashchange', route);
route();
// Débloque l'audio au premier geste (politique des navigateurs)
window.addEventListener('pointerdown', () => synth.audioContext(), { once: true });
window.addEventListener('keydown', () => synth.audioContext(), { once: true });

// Mode hors-ligne (PWA) si disponible
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'pianocoach:update') toast('Nouvelle version disponible : recharge la page pour en profiter.', 6000);
  });
}

// Exposé pour le débogage et les tests automatisés
window.PianoCoach = { findSong, store, route };
