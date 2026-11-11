// Installation de l'app : bouton « Installer » (invite native de Chrome quand elle est disponible),
// sinon les étapes exactes pour le navigateur de l'utilisateur. Page #/installer, carte sur l'accueil,
// section dans les Réglages et bandeau discret tant que l'app n'est pas installée.
import { detectInstallEnv, BROWSER_NAMES } from '../core/install.js';
import { h, toast } from '../ui/dom.js';
import { main, registerRoute, section, homeSections, settingsSections } from '../ui/context.js';

const DISMISS_KEY = 'pianocoach.installDismissed';

function env() {
  const standalone = matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;
  return detectInstallEnv(navigator.userAgent, { standalone, secure: window.isSecureContext, hasPrompt: !!window.__installPrompt });
}

/** URL publique de l'app (sans le #/page). */
function appUrl() {
  return location.origin + location.pathname;
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(appUrl());
    toast('Lien copié ! Colle-le dans Chrome.');
  } catch {
    prompt('Copie ce lien :', appUrl());
  }
}

/** Lance l'invite d'installation native (Chrome/Edge/Samsung). Renvoie true si l'app a été installée. */
async function runPrompt() {
  const p = window.__installPrompt;
  if (!p) return false;
  try {
    p.prompt();
    const choice = await p.userChoice;
    window.__installPrompt = null; // une invite ne sert qu'une fois
    if (choice && choice.outcome === 'accepted') {
      toast('Installation en cours… Piano Coach va apparaître sur ton écran d’accueil. 🎉', 6000);
      return true;
    }
    toast('Installation annulée. Tu peux réessayer quand tu veux depuis « Plus → Installer l’app ».', 5000);
  } catch (e) {
    console.warn(e);
  }
  refreshAll();
  return false;
}

/** Bloc d'installation complet (bouton ou étapes), mis à jour tout seul quand l'invite devient disponible. */
function installBlock({ compact = false } = {}) {
  const box = h('div', { class: 'install-box', 'data-install-box': '' });
  const render = () => {
    const e = env();
    box.innerHTML = '';
    box.dataset.state = e.state;
    if (e.state === 'installed') {
      box.append(h('p', { class: 'install-ok' }, '✅ Piano Coach est installé sur cet appareil. Tu peux le lancer depuis son icône, même sans connexion.'));
      return;
    }
    if (!compact) box.append(h('p', { class: 'small muted' }, `Appareil détecté : ${e.os === 'android' ? 'Android' : e.os === 'ios' ? 'iPhone / iPad' : 'ordinateur'} · ${BROWSER_NAMES[e.browser] || e.browser}`));
    if (e.state === 'prompt') {
      box.append(
        h('button', { class: 'btn primary big install-btn', onclick: runPrompt }, '📲 Installer Piano Coach'),
        h('p', { class: 'small muted' }, 'Gratuit, sans compte, environ 2 Mo. L’app s’ouvrira en plein écran et marchera sans connexion.'),
      );
      return;
    }
    box.append(h('h3', { class: 'install-title' }, e.title));
    box.append(h('ol', { class: 'install-steps' }, e.steps.map((s) => h('li', {}, s))));
    if (e.note) box.append(h('p', { class: 'small muted' }, e.note));
    if (e.state === 'inapp' || e.state === 'insecure') {
      box.append(h('div', { class: 'install-link' }, [h('code', {}, appUrl()), h('button', { class: 'btn', onclick: copyLink }, '📋 Copier le lien')]));
    } else if (!compact) {
      box.append(h('p', { class: 'small muted' }, 'Le bouton « Installer » apparaît ici automatiquement dès que ton navigateur le permet (en général après quelques secondes sur la page).'));
    }
  };
  render();
  box._render = render;
  return box;
}

function refreshAll() {
  document.querySelectorAll('[data-install-box]').forEach((b) => b._render?.());
  updateBanner();
}

// ---------- page #/installer ----------
registerRoute(/^installer$/, () => {
  const e = env();
  main.append(
    h('h1', {}, '📲 Installer l’application'),
    h('p', { class: 'lead' }, 'Piano Coach s’installe comme une vraie application : une icône sur ton écran d’accueil, le plein écran, et ça marche même sans connexion. Pas besoin du Play Store.'),
    h('div', { class: 'card' }, installBlock()),
  );
  if (e.state !== 'installed') {
    main.append(
      section('Ça ne marche pas ?', h('ul', { class: 'install-help' }, [
        h('li', {}, [h('b', {}, 'Je ne vois pas « Installer » dans le menu. '), 'Cherche « Ajouter à l’écran d’accueil » : c’est la même chose. Sur Chrome, c’est dans le menu ⋮ en haut à droite.']),
        h('li', {}, [h('b', {}, 'J’ai ouvert le lien depuis Discord, Instagram, Gmail… '), 'Ces applis ouvrent leur propre mini-navigateur, qui ne sait pas installer. Copie le lien et ouvre-le dans Chrome.']),
        h('li', {}, [h('b', {}, 'Navigation privée. '), 'L’installation est désactivée en navigation privée : ouvre un onglet normal.']),
        h('li', {}, [h('b', {}, 'Rien ne se passe. '), 'Mets Chrome à jour (Play Store), recharge la page, attends 10 secondes puis reviens ici.']),
        h('li', {}, [h('b', {}, 'Déjà installé ? '), 'Regarde dans la liste de tes applications : cherche « Piano Coach ».']),
      ])),
      section('Le lien de l’app', h('div', { class: 'install-link' }, [h('code', {}, appUrl()), h('button', { class: 'btn', onclick: copyLink }, '📋 Copier le lien'),
        navigator.share ? h('button', { class: 'btn', onclick: () => navigator.share({ title: 'Piano Coach', url: appUrl() }).catch(() => {}) }, '↗ Partager') : null])),
    );
  }
});

// ---------- accueil + réglages ----------
homeSections.unshift(() => {
  const e = env();
  if (e.state === 'installed') return null;
  return h('section', { class: 'card install-card' }, [
    h('div', { class: 'install-card-head' }, [h('span', { class: 'emoji big', 'aria-hidden': 'true' }, '📲'), h('div', {}, [h('h2', {}, 'Installe Piano Coach sur ton téléphone'), h('p', { class: 'small muted' }, 'Une icône sur l’écran d’accueil, le plein écran, et ça marche sans connexion.')])]),
    installBlock({ compact: true }),
    h('a', { class: 'small', href: '#/installer' }, 'Aide à l’installation →'),
  ]);
});
settingsSections.push(() => section('Installation', [installBlock({ compact: true }), h('a', { class: 'small', href: '#/installer' }, 'Aide à l’installation →')]));

// ---------- bandeau ----------
let banner = null;
function dismissed() {
  try {
    const t = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return Date.now() - t < 3 * 86400000; // réapparaît au bout de 3 jours
  } catch {
    return false;
  }
}
function updateBanner() {
  const e = env();
  const page = location.hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  // pas pendant qu'on joue, ni sur les pages qui en parlent déjà
  const hide = e.state === 'installed' || dismissed() || ['jouer', 'installer', 'bienvenue', 'exercice', 'jeux', ''].includes(page);
  if (hide) {
    banner?.remove();
    banner = null;
    return;
  }
  if (!banner) {
    banner = h('div', { class: 'install-banner', role: 'region', 'aria-label': 'Installer l’application' });
    document.body.append(banner);
  }
  banner.innerHTML = '';
  banner.append(
    h('span', { class: 'install-banner-text' }, '📲 Installe Piano Coach sur ton téléphone'),
    e.state === 'prompt'
      ? h('button', { class: 'btn primary tiny', onclick: runPrompt }, 'Installer')
      : h('a', { class: 'btn primary tiny', href: '#/installer' }, 'Comment faire ?'),
    h('button', { class: 'btn tiny install-banner-close', 'aria-label': 'Fermer', onclick: () => {
      try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
      updateBanner();
    } }, '✕'),
  );
}

window.addEventListener('pianocoach:installable', refreshAll);
window.addEventListener('appinstalled', () => {
  window.__installPrompt = null;
  toast('Piano Coach est installé ! Retrouve-le sur ton écran d’accueil. 🎹', 6000);
  refreshAll();
});
window.addEventListener('hashchange', updateBanner);
matchMedia('(display-mode: standalone)').addEventListener?.('change', refreshAll);
updateBanner();
