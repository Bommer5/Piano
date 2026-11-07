// Petits utilitaires DOM : création d'éléments, toasts, boîtes de dialogue.

/** h('div', {class:'x', onclick: fn}, [enfants]) */
export function h(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'checked' || k === 'selected' || k === 'disabled' || k === 'value') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

let toastBox;
export function toast(text, ms = 2800) {
  if (!toastBox) {
    toastBox = h('div', { class: 'toasts', 'aria-live': 'polite' });
    document.body.appendChild(toastBox);
  }
  const t = h('div', { class: 'toast' }, text);
  toastBox.appendChild(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 400);
  }, ms);
}

/**
 * Boîte de dialogue. buttons: [{label, primary?, action?}]
 * @returns {HTMLDialogElement}
 */
export function modal(title, html, buttons = [{ label: 'OK', primary: true }]) {
  const dlg = h('dialog', { class: 'modal' });
  const body = h('div', { class: 'modal-body', html });
  const actions = h('div', { class: 'modal-actions' }, buttons.map((b) =>
    h('button', { class: 'btn' + (b.primary ? ' primary' : ''), onclick: () => { dlg.close(); b.action?.(); } }, b.label)));
  dlg.append(h('h2', {}, title), body, actions);
  dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 300));
  document.body.appendChild(dlg);
  if (dlg.showModal) dlg.showModal();
  else dlg.setAttribute('open', '');
  return dlg;
}

export function download(filename, data, mime = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

export function stars(n, max = 3) {
  return '★'.repeat(n) + '☆'.repeat(Math.max(0, max - n));
}

// ---------- Accessibilité : lecture vocale ----------
import { store } from '../core/storage.js';

let frVoice = null;
function pickVoice() {
  const voices = globalThis.speechSynthesis?.getVoices?.() || [];
  frVoice = voices.find((v) => /^fr[-_]FR/i.test(v.lang)) || voices.find((v) => /^fr/i.test(v.lang)) || null;
}
if (globalThis.speechSynthesis) {
  pickVoice();
  globalThis.speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
}

/**
 * Lit un texte à voix haute (speechSynthesis, fr-FR) si le réglage `tts` est activé.
 * @param {string} text
 * @param {{force?:boolean, interrupt?:boolean, rate?:number}} [opts] force : lire même si `tts` est désactivé
 * @returns {boolean} true si la lecture a été lancée
 */
export function speak(text, { force = false, interrupt = true, rate } = {}) {
  const synth = globalThis.speechSynthesis;
  if (!synth || !text) return false;
  const s = store.settings();
  if (!force && !s.tts) return false;
  try {
    if (interrupt) synth.cancel();
    const u = new SpeechSynthesisUtterance(String(text).replace(/[✓✗★☆•·]/g, ' '));
    u.lang = 'fr-FR';
    if (frVoice) u.voice = frVoice;
    u.rate = rate ?? (s.kidMode ? 0.95 : 1.05);
    synth.speak(u);
    return true;
  } catch {
    return false;
  }
}

// ---------- Glossaire : terme avec bulle d'aide ----------
/**
 * Libellé suivi d'un bouton ⓘ qui ouvre la définition du glossaire (avec schéma de clavier si utile).
 * @param {string} id identifiant du terme (js/data/glossary.js)
 * @param {string} [label] texte affiché (par défaut le terme)
 */
export function term(id, label) {
  const btn = h('button', { type: 'button', class: 'term-info', 'aria-label': `Définition : ${label || id}`, title: 'Qu’est-ce que c’est ?', onclick: (e) => { e.preventDefault(); e.stopPropagation(); showTerm(id); } }, 'ⓘ');
  return h('span', { class: 'term' }, [label ?? id, btn]);
}

/** Ouvre la bulle de définition d'un terme. */
export async function showTerm(id) {
  const [{ getTerm }, { keyDiagram }] = await Promise.all([import('../data/glossary.js'), import('./keyboard.js')]);
  const t = getTerm(id);
  if (!t) return null;
  const dlg = modal(`📖 ${t.term}`, `<p>${escapeHtml(t.def)}</p>${t.example ? `<p class="muted small">Exemple : ${escapeHtml(t.example)}</p>` : ''}`, [
    { label: 'Voir le glossaire', action: () => (location.hash = '#/glossaire?q=' + encodeURIComponent(t.term)) },
    { label: 'Compris !', primary: true },
  ]);
  dlg.classList.add('term-modal');
  if (t.keys?.length) dlg.querySelector('.modal-body').append(h('div', { class: 'term-diagram' }, keyDiagram(t.keys.map((k) => (typeof k === 'number' ? { midi: k } : k)), t.range || {})));
  speak(`${t.term}. ${t.def}`);
  return dlg;
}
