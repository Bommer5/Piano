// Coquille globale : sélecteur de profil (barre du haut), annonce des badges, réglages
// d'accessibilité appliqués sur <html>, menu « Plus », rappel quotidien et redirection vers
// l'accueil guidé au premier lancement.
import { store, AVATARS, localDate } from '../core/storage.js';
import { minutesLeft } from '../core/plan.js';
import { h, toast, modal, speak, escapeHtml } from './dom.js';
import { ctx, applyTheme } from './context.js';

/** Applique les réglages d'accessibilité via des attributs data-* sur <html>. */
export function applyA11y(s = ctx.settings) {
  const d = document.documentElement.dataset;
  const set = (k, on) => (on ? (d[k] = '1') : delete d[k]);
  set('bigUi', s.bigUi);
  set('cbSafe', s.cbSafe);
  set('kid', s.kidMode);
  set('contrast', s.contrast);
}

/** Recharge les réglages du profil courant et relance la route courante. */
export function refreshForProfile() {
  ctx.settings = store.settings();
  applyTheme();
  applyA11y();
  renderProfileSlot();
  ctx.route();
}

export function switchTo(id) {
  if (!store.switchProfile(id)) return;
  const p = store.currentProfile();
  toast(`${p.avatar} Bonjour ${p.name} !`);
  if (!store.isOnboarded()) location.hash = '#/bienvenue';
  refreshForProfile();
}

/** Boîte de dialogue « Ajouter un joueur ». */
export function addPlayerDialog() {
  let avatar = AVATARS[store.profiles().length % AVATARS.length];
  const dlg = modal('Ajouter un joueur', '', [
    { label: 'Annuler' },
    {
      label: 'Ajouter', primary: true, action: () => {
        const name = dlg.querySelector('input[name=pname]').value.trim();
        const p = store.addProfile({ name: name || 'Joueur', avatar });
        store.switchProfile(p.id);
        location.hash = '#/bienvenue';
        refreshForProfile();
      },
    },
  ]);
  const grid = h('div', { class: 'avatar-grid', role: 'radiogroup', 'aria-label': 'Avatar' }, AVATARS.map((a) => h('button', {
    type: 'button', class: 'avatar-btn' + (a === avatar ? ' on' : ''), role: 'radio', 'aria-checked': String(a === avatar), 'aria-label': 'Avatar ' + a,
    onclick: (e) => {
      avatar = a;
      grid.querySelectorAll('.avatar-btn').forEach((b) => { b.classList.toggle('on', b === e.currentTarget); b.setAttribute('aria-checked', String(b === e.currentTarget)); });
    },
  }, a)));
  dlg.querySelector('.modal-body').append(
    h('label', { class: 'field-block' }, [h('span', {}, 'Prénom'), h('input', { name: 'pname', maxlength: 24, placeholder: 'Léo', autocomplete: 'off' })]),
    h('p', { class: 'small muted' }, 'Choisis un avatar :'), grid,
    h('p', { class: 'small muted' }, 'Chaque joueur a ses propres progrès, badges et réglages. Les partitions importées sont partagées.'),
  );
  setTimeout(() => dlg.querySelector('input')?.focus(), 50);
  return dlg;
}

/** Sélecteur de profil dans la barre du haut. */
export function renderProfileSlot() {
  const slot = document.getElementById('profile-slot');
  if (!slot) return;
  const cur = store.currentProfile();
  const list = store.profiles();
  slot.innerHTML = '';
  const det = h('details', { class: 'profile-menu' });
  det.append(
    h('summary', { class: 'profile-btn', 'aria-label': `Joueur : ${cur.name}. Changer de joueur` }, [h('span', { class: 'avatar', 'aria-hidden': 'true' }, cur.avatar), h('span', { class: 'pname' }, cur.name)]),
    h('div', { class: 'profile-pop', role: 'menu' }, [
      h('p', { class: 'small muted' }, 'Qui joue ?'),
      ...list.map((p) => h('button', { type: 'button', role: 'menuitemradio', 'aria-checked': String(p.id === cur.id), class: 'profile-item' + (p.id === cur.id ? ' on' : ''), onclick: () => { det.open = false; if (p.id !== cur.id) switchTo(p.id); } }, [h('span', { class: 'avatar' }, p.avatar), h('span', {}, p.name), p.id === cur.id ? h('span', { class: 'check-mark', 'aria-hidden': 'true' }, '✓') : null])),
      h('button', { type: 'button', role: 'menuitem', class: 'profile-item add', onclick: () => { det.open = false; addPlayerDialog(); } }, [h('span', { class: 'avatar' }, '＋'), h('span', {}, 'Ajouter un joueur')]),
      h('a', { role: 'menuitem', class: 'profile-item', href: '#/reglages?section=profils', onclick: () => (det.open = false) }, [h('span', { class: 'avatar' }, '✎'), h('span', {}, 'Gérer les joueurs')]),
    ]),
  );
  slot.append(det);
}

// ---------- badges : annonce animée ----------
const badgeQueue = [];
let badgeShowing = false;
function showNextBadge() {
  if (badgeShowing || !badgeQueue.length) return;
  badgeShowing = true;
  const { badge } = badgeQueue.shift();
  const pop = h('div', { class: 'badge-pop', role: 'status', 'aria-live': 'polite' }, [
    h('span', { class: 'badge-pop-emoji', 'aria-hidden': 'true' }, badge.emoji),
    h('div', {}, [h('small', {}, 'Nouveau badge !'), h('b', {}, badge.name), h('span', { class: 'small' }, badge.desc)]),
    h('button', { type: 'button', class: 'btn tiny', 'aria-label': 'Fermer', onclick: () => close() }, '✕'),
  ]);
  for (let i = 0; i < 14; i++) pop.append(h('i', { class: 'confetti', style: `--i:${i}`, 'aria-hidden': 'true' }));
  document.body.append(pop);
  speak(`Nouveau badge : ${badge.name}. ${badge.desc}`, { interrupt: false });
  let done = false;
  const close = () => {
    if (done) return;
    done = true;
    pop.classList.add('out');
    setTimeout(() => {
      pop.remove();
      badgeShowing = false;
      showNextBadge();
    }, 400);
  };
  setTimeout(close, 4500);
}
window.addEventListener('pianocoach:badge', (e) => {
  if (!e.detail?.badge) return;
  badgeQueue.push(e.detail);
  // laisse la fenêtre de résultat s'afficher d'abord
  setTimeout(showNextBadge, 600);
});

// ---------- rappel quotidien (sans serveur : onglet ouvert) ----------
let reminderTimer = null;
export function scheduleReminder() {
  clearInterval(reminderTimer);
  const s = store.settings();
  if (!s.reminder || typeof Notification === 'undefined') return;
  const check = () => {
    const st = store.settings();
    if (!st.reminder || Notification.permission !== 'granted') return;
    const now = new Date();
    if (now.getHours() < (st.reminderHour ?? 18)) return;
    const key = 'pianocoach.reminded.' + store.currentProfile().id;
    const today = localDate(now);
    try {
      if (localStorage.getItem(key) === today) return;
    } catch { /* ignore */ }
    const left = minutesLeft(store.practiceDays()[today] || 0, st.dailyGoalMin);
    if (left <= 0) return;
    try {
      localStorage.setItem(key, today);
      const p = store.currentProfile();
      const n = new Notification('Piano Coach 🎹', { body: `${p.name}, encore ${left} min pour ton objectif du jour ! 🔥 Série : ${store.streak()} jour(s).`, icon: 'icons/icon-192.png', tag: 'pianocoach-reminder' });
      n.onclick = () => { window.focus(); n.close(); };
    } catch { /* ignore */ }
  };
  check();
  reminderTimer = setInterval(check, 5 * 60 * 1000);
}

// ---------- navigation : menu « Plus » ----------
function closeMenus() {
  document.querySelectorAll('.nav-more[open], .profile-menu[open]').forEach((d) => d.removeAttribute('open'));
}
window.addEventListener('hashchange', closeMenus);
document.addEventListener('click', (e) => {
  for (const d of document.querySelectorAll('.nav-more[open], .profile-menu[open]')) if (!d.contains(e.target)) d.removeAttribute('open');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMenus();
});
// Le lien actif dans le menu « Plus » met aussi « Plus » en évidence.
window.addEventListener('hashchange', () => setTimeout(markMore, 0));
function markMore() {
  const more = document.querySelector('.nav-more');
  if (more) more.classList.toggle('active', !!more.querySelector('[data-nav].active'));
}

// ---------- démarrage ----------
function boot() {
  applyA11y(store.settings());
  renderProfileSlot();
  scheduleReminder();
  setTimeout(markMore, 0);
  // Premier lancement : accueil guidé (sauf ?skipWelcome ou pianocoach.onboarded).
  const skip = /[?&]skipWelcome\b/.test(location.search) || /[?&]skipWelcome\b/.test(location.hash);
  const path = location.hash.replace(/^#\/?/, '').split('?')[0];
  if (!skip && !store.isOnboarded() && path !== 'bienvenue') {
    history.replaceState(null, '', location.pathname + location.search + '#/bienvenue');
  }
}
boot();
export { escapeHtml };
