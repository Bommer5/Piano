// Contexte partagé entre les vues : état, registre des routes, helpers d'affichage communs.
// Chaque vue (js/views/*.js) s'enregistre avec registerRoute() ; les réglages et l'accueil
// acceptent des sections supplémentaires via settingsSections / homeSections.
import { GENRES, SONGS, getSong } from '../data/songs.js';
import { prepareSong } from '../core/song.js';
import { applyFingeringOverrides } from '../core/edit.js';
import { store } from '../core/storage.js';
import { Trainer } from './trainer.js';
import { h, stars } from './dom.js';
import * as synth from '../audio/synth.js';

export const main = document.getElementById('main');
export const ctx = {
  settings: store.settings(),
  prepared: new Map(),
  cleanup: [],
  route: () => {},
};
export const routes = [];
/** Ajoute une route : registerRoute(/^chemin\/(.+)$/, (param, query) => { ... }) */
export function registerRoute(re, fn) {
  routes.push([re, fn]);
}
export function onCleanup(fn) {
  ctx.cleanup.push(fn);
}
/** Sections supplémentaires de la page Réglages : fonctions () => Node */
export const settingsSections = [];
/** Cartes supplémentaires de l'accueil : fonctions () => Node|null, affichées sous le héros */
export const homeSections = [];

// ---------- morceaux ----------
export function findSong(id) {
  if (ctx.prepared.has(id)) return ctx.prepared.get(id);
  let raw = getSong(id) || store.library().find((s) => s.id === id);
  if (!raw) return null;
  const s = prepareSong(raw);
  s.imported = !getSong(id);
  // doigtés personnalisés d'un morceau intégré (éditeur, js/views/editor.js)
  if (!s.imported) {
    if (applyFingeringOverrides(s.notes, store.get('fingerings.' + id, null))) s.customFingering = true;
  }
  ctx.prepared.set(id, s);
  return s;
}

export function allSongs() {
  return [...SONGS, ...store.library()];
}

export const genreOf = (id) => GENRES.find((g) => g.id === id) || { id, name: id || 'Divers', emoji: '🎵', color: '#7a7f9a' };
export const levelLabel = (n) => ['', 'Débutant', 'Facile', 'Intermédiaire', 'Avancé', 'Expert'][n] || `Niveau ${n}`;

export function applyTheme() {
  const t = ctx.settings.theme;
  document.documentElement.dataset.theme = t === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : t;
  synth.setVolume?.(ctx.settings.volume);
}

export function section(title, children, cls = '') {
  return h('section', { class: 'section ' + cls }, [title ? h('h2', {}, title) : null, ...[].concat(children)]);
}

export function statCard(icon, value, label, ratio) {
  return h('div', { class: 'stat-card' }, [h('span', { class: 'icon' }, icon), h('b', {}, String(value)), h('small', {}, label), ratio != null ? h('div', { class: 'progress' }, h('div', { class: 'fill', style: `width:${ratio * 100}%` })) : null]);
}

export function songCard(s) {
  if (!s) return h('div');
  const g = genreOf(s.genre);
  const p = store.progress()[s.id];
  const fav = store.favorites().includes(s.id);
  return h('a', { class: 'song-card', href: `#/morceau/${encodeURIComponent(s.id)}`, style: `--c:${g.color}` }, [
    h('div', { class: 'song-top' }, [h('span', { class: 'emoji' }, g.emoji), fav ? h('span', { class: 'fav' }, '♥') : null, p ? h('span', { class: 'stars' }, stars(p.stars)) : null]),
    h('b', { class: 'title' }, s.title),
    h('small', {}, s.composer || ''),
    h('div', { class: 'tags' }, [h('span', { class: 'tag lvl' + s.level }, levelLabel(s.level)), h('span', { class: 'tag' }, g.name), s.imported ? h('span', { class: 'tag' }, 'importé') : null]),
  ]);
}

export function startTrainer(s, query = {}, { back, onNext, title, subtitle } = {}) {
  main.className = 'wide';
  const bpm = s.beatsPerMeasure;
  const opts = {};
  if (query.mode) opts.mode = query.mode;
  if (query.hands && (query.hands === 'both' ? s.hands.R && s.hands.L : s.hands[query.hands])) opts.hands = query.hands;
  if (query.tempo) opts.tempoPct = Number(query.tempo);
  if (query.from) opts.from = (Number(query.from) - 1) * bpm;
  if (query.to) opts.to = Math.min(s.totalBeats, Number(query.to) * bpm);
  if (query.loop) opts.loop = true;
  if (query.variant) opts.variant = query.variant; // variante rythmique (coursegen : 'long-short' | 'short-long')
  main.append(h('div', { class: 'play-head' }, [
    h('a', { class: 'btn tiny', href: back || '#/bibliotheque' }, '← Retour'),
    h('div', {}, [h('h1', { class: 'h-small' }, title || s.title), subtitle ? h('p', { class: 'muted small' }, subtitle) : h('p', { class: 'muted small' }, `${s.composer || ''}${s.autoFingering ? ' · doigtés suggérés automatiquement' : ''}`)]),
  ]));
  const root = h('div');
  main.append(root);
  const t = new Trainer(root, s, opts, { onNext });
  onCleanup(() => t.destroy());
  return t;
}

