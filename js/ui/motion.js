// Animations de l'interface : transition entre pages, apparition en cascade, compteur de score,
// notes qui s'envolent sur une bonne série, célébrations (fin de morceau, badge).
// Uniquement transform / opacity (compositeur, 60 fps sur mobile). Tout est coupé si le système
// demande moins de mouvement (prefers-reduced-motion) ou si le joueur a coché « Réduire les
// animations » (réglage ajouté via settingsSections ; attribut data-reduce-motion sur <html>).
import { store } from '../core/storage.js';
import { h, toast } from './dom.js';
import { ctx, main, section, settingsSections } from './context.js';

const root = document.documentElement;
const mq = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

/** Vrai si les animations sont autorisées (système + réglage du joueur). */
export function motionOK() {
  return !(mq && mq.matches) && !('reduceMotion' in root.dataset);
}

/** Pose / retire data-reduce-motion sur <html> selon le réglage du profil courant. */
export function syncMotionSetting(s = ctx.settings || store.settings()) {
  if (s && s.reduceMotion) root.dataset.reduceMotion = '1';
  else delete root.dataset.reduceMotion;
}

// ---------- transition de page + cascade ----------
const CASCADE = ':scope > :not(.trainer):not(dialog):not(script), .grid > *, .settings > *, .lesson-list > li, .badge-grid > *, .plan-steps > li, .games-grid > *';

/** Entrée d'une page : fondu du contenu puis apparition en cascade des cartes visibles. */
export function pageEnter(container = main) {
  if (!motionOK() || !container.animate) return;
  container.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
  const vh = innerHeight;
  let i = 0;
  for (const el of container.querySelectorAll(CASCADE)) {
    if (i >= 18) break;
    if (el.querySelector('.trainer')) continue;
    const r = el.getBoundingClientRect();
    if (!r.height || r.top > vh || r.bottom < 0) continue;
    el.animate([{ opacity: 0, transform: 'translateY(14px) scale(0.985)' }, { opacity: 1, transform: 'none' }],
      { duration: 420, delay: 40 + i * 40, easing: EASE, fill: 'backwards' });
    i++;
  }
}

// ---------- compteur de score ----------
/** Fait défiler le nombre d'un .big-score de 0 à sa valeur (le texte réel du DOM ne change pas). */
export function countUp(el) {
  if (!motionOK() || !el || el.dataset.counted) return;
  const m = /^(\d+)(.*)$/s.exec(el.textContent.trim());
  if (!m || !globalThis.CSS?.registerProperty) return; // compteur CSS (@property) indisponible : valeur finale directe
  el.dataset.counted = '1';
  const to = Number(m[1]);
  el.style.setProperty('--to', String(to));
  el.style.setProperty('--suffix', JSON.stringify(m[2]));
  el.style.setProperty('--dur', `${Math.min(1400, 500 + to * 8)}ms`);
  el.classList.add('counting');
  const done = () => el.classList.remove('counting');
  el.addEventListener('animationend', done, { once: true });
  setTimeout(done, 1800); // filet de sécurité
}

// ---------- particules ----------
const GLYPHS = ['♪', '♫', '♩', '♬', '★'];
/** Petites notes qui s'envolent depuis un élément (n particules). */
export function burst(from, n = 10, { spread = 120, rise = 140, glyphs = GLYPHS } = {}) {
  if (!motionOK() || !from?.getBoundingClientRect) return;
  const r = from.getBoundingClientRect();
  const layer = h('div', { class: 'fx-layer', 'aria-hidden': 'true' });
  document.body.append(layer);
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let left = n;
  for (let i = 0; i < n; i++) {
    const p = h('span', { class: 'fx-note fx-c' + (i % 5) }, glyphs[i % glyphs.length]);
    p.style.left = `${cx}px`;
    p.style.top = `${cy}px`;
    layer.append(p);
    const dx = (Math.random() - 0.5) * spread * 2, dy = -(rise * (0.6 + Math.random() * 0.7));
    const rot = (Math.random() - 0.5) * 80;
    p.animate([
      { opacity: 0, transform: 'translate(-50%, -50%) scale(0.4)' },
      { opacity: 1, transform: `translate(calc(-50% + ${dx * 0.3}px), calc(-50% + ${dy * 0.3}px)) scale(1.1)`, offset: 0.25 },
      { opacity: 0, transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.8) rotate(${rot}deg)` },
    ], { duration: 900 + Math.random() * 500, delay: i * 25, easing: 'cubic-bezier(0.15, 0.7, 0.3, 1)', fill: 'both' })
      .finished.catch(() => {}).finally(() => { if (--left === 0) layer.remove(); });
  }
}

/** Petit rebond d'un élément (compteur qui change). */
export function bump(el, scale = 1.25) {
  if (!motionOK() || !el?.animate) return;
  el.animate([{ transform: 'scale(1)' }, { transform: `scale(${scale})` }, { transform: 'scale(1)' }], { duration: 260, easing: EASE });
}

// ---------- observation du DOM (aucune modification de la logique des vues) ----------
function onAdded(node) {
  if (node.nodeType !== 1) return;
  if (node.classList.contains('big-score')) countUp(node);
  else for (const b of node.getElementsByClassName('big-score')) countUp(b);
}

function onDialog(dlg) {
  const score = dlg.querySelector('.result .big-score');
  if (!score) return;
  countUp(score);
  const v = parseInt(score.textContent, 10);
  if (v >= 90) setTimeout(() => burst(score, 16, { spread: 160, rise: 180 }), 350);
}

function init() {
  syncMotionSetting();
  let entering = false;
  new MutationObserver((records) => {
    let cleared = false;
    for (const r of records) {
      if (r.target === main && r.removedNodes.length) cleared = true;
      if (r.type === 'childList') {
        // Série : <div class="stat" data-motion="streak"><b>n</b>… (texte remplacé par l'entraîneur)
        const t = r.target;
        if (t.tagName === 'B' && t.parentElement?.dataset.motion === 'streak') {
          const v = Number(t.textContent);
          if (v > 0) bump(t);
          if (v > 0 && v % 10 === 0) burst(t, 10);
        }
        r.addedNodes.forEach(onAdded);
      }
    }
    if (cleared && !entering) {
      entering = true;
      requestAnimationFrame(() => { entering = false; syncMotionSetting(); pageEnter(); });
    }
  }).observe(main, { childList: true, subtree: true });
  // Fenêtres de résultat et annonces de badge ajoutées à <body>
  new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (n.tagName === 'DIALOG') requestAnimationFrame(() => onDialog(n));
      else if (n.classList.contains('badge-pop')) setTimeout(() => burst(n.querySelector('.badge-pop-emoji') || n, 12, { glyphs: ['★', '✦', '♪', '✧'] }), 250);
    }
  }).observe(document.body, { childList: true });
  mq?.addEventListener?.('change', () => syncMotionSetting());
}

// ---------- réglage ----------
function motionSection() {
  const s = ctx.settings || store.settings();
  const cb = h('input', {
    type: 'checkbox', checked: !!s.reduceMotion,
    onchange: (e) => {
      const reduceMotion = e.target.checked;
      store.saveSettings({ ...store.settings(), reduceMotion });
      ctx.settings = { ...ctx.settings, reduceMotion };
      syncMotionSetting();
      toast('Réglages enregistrés');
    },
  });
  return section('Animations', h('div', { class: 'settings' }, [
    h('label', { class: 'setting check' }, [cb, h('span', {}, ['Réduire les animations', h('small', {}, 'Coupe les transitions, ondes sur les touches, notes qui s’envolent et confettis. Activé d’office si ton appareil demande moins de mouvement.')])]),
  ]));
}
settingsSections.push(motionSection);

if (main && typeof MutationObserver !== 'undefined') init();
