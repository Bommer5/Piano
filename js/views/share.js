// Vue : partage par lien (#/partage?d=…) + boîte de dialogue « Partager » de la fiche morceau.
import { buildShareUrl, decodeSong, parseShareQuery, SHARE_MAX_CHARS, compressionSupported } from '../core/share.js';
import { prepareSong } from '../core/song.js';
import { exportSong } from '../parsers/index.js';
import { store } from '../core/storage.js';
import { StaffView } from '../ui/staff.js';
import { h, toast, modal, download } from '../ui/dom.js';
import { ctx, main, registerRoute, genreOf, levelLabel } from '../ui/context.js';

const shareBase = () => location.origin + location.pathname;

/** Boîte de dialogue de partage d'un morceau (mesures, tempo, mains facultatifs). */
export function openShareDialog(song) {
  const dlg = modal('🔗 Partager ce morceau', '', [{ label: 'Fermer' }]);
  const closeOnNav = () => dlg.open && dlg.close();
  window.addEventListener('hashchange', closeOnNav, { once: true });
  dlg.addEventListener('close', () => window.removeEventListener('hashchange', closeOnNav));
  const body = dlg.querySelector('.modal-body');
  const n = (attrs) => h('input', { type: 'number', class: 'num', ...attrs });
  const from = n({ min: 1, max: song.measureCount, placeholder: '1', 'aria-label': 'Depuis la mesure' });
  const to = n({ min: 1, max: song.measureCount, placeholder: String(song.measureCount), 'aria-label': 'Jusqu’à la mesure' });
  const tempo = n({ min: 20, max: 200, placeholder: '100', 'aria-label': 'Tempo en %' });
  const hands = h('select', { 'aria-label': 'Mains' }, [['', 'Les deux mains'], ['R', 'Main droite'], ['L', 'Main gauche']].map(([v, l]) => h('option', { value: v }, l)));
  const out = h('div', { class: 'share-out' });
  const go = h('button', { class: 'btn primary', onclick: make }, 'Créer le lien');
  body.append(
    h('p', { class: 'small' }, 'Le morceau entier est contenu dans le lien : pas besoin de compte ni de serveur. Tu peux indiquer un passage à travailler.'),
    h('div', { class: 'form-grid' }, [h('label', {}, ['De la mesure', from]), h('label', {}, ['à la mesure', to]), h('label', {}, ['Tempo (%)', tempo]), h('label', {}, ['Mains', hands])]),
    go, out,
  );
  async function make() {
    out.innerHTML = '';
    go.disabled = true;
    try {
      const res = await buildShareUrl(song, shareBase(), { from: from.value, to: to.value, tempo: tempo.value, hands: hands.value });
      if (res.tooLong) {
        out.append(h('div', { class: 'block warning' }, [
          `Ce morceau est trop long pour un lien (${(res.chars / 1000).toFixed(1)} Ko > ${SHARE_MAX_CHARS / 1000} Ko). Exporte-le plutôt en fichier et envoie-le : `,
          h('button', { class: 'btn tiny', onclick: () => { const f = exportSong(song, 'musicxml'); download(f.filename, f.data, f.mime); } }, '⬇ MusicXML'),
          ' ',
          h('button', { class: 'btn tiny', onclick: () => { const f = exportSong(song, 'midi'); download(f.filename, f.data, f.mime); } }, '⬇ MIDI'),
        ]));
        return;
      }
      const input = h('input', { class: 'share-url mono', readonly: true, value: res.url, 'aria-label': 'Lien de partage', onfocus: (e) => e.target.select() });
      const copy = h('button', { class: 'btn', onclick: async () => {
        try {
          await navigator.clipboard.writeText(res.url);
          toast('Lien copié !');
        } catch {
          input.select();
          document.execCommand?.('copy');
          toast('Lien sélectionné : copie-le avec Ctrl+C.');
        }
      } }, '📋 Copier');
      const native = navigator.share ? h('button', { class: 'btn primary', onclick: () => navigator.share({ title: song.title, text: `« ${song.title} » sur Piano Coach`, url: res.url }).catch(() => {}) }, '📤 Partager…') : null;
      out.append(input, h('div', { class: 'row' }, [copy, native, h('span', { class: 'muted small' }, `${res.chars} caractères${res.compressed ? ' (compressé)' : compressionSupported() ? '' : ' (sans compression)'}`)]));
    } catch (err) {
      out.append(h('p', { class: 'error-text' }, 'Impossible de créer le lien : ' + (err.message || err)));
    } finally {
      go.disabled = false;
    }
  }
  return dlg;
}

function hashOf(str) {
  let x = 2166136261;
  for (let i = 0; i < str.length; i++) x = Math.imul(x ^ str.charCodeAt(i), 16777619);
  return (x >>> 0).toString(36);
}

function viewShare(query) {
  const q = parseShareQuery(query);
  const box = h('div', { class: 'card' }, h('p', { class: 'muted' }, 'Ouverture du morceau partagé…'));
  main.append(h('h1', {}, '🔗 Morceau partagé'), box);
  if (!q.d) {
    box.innerHTML = '';
    box.append(h('p', {}, 'Ce lien ne contient pas de morceau.'), h('a', { class: 'btn', href: '#/bibliotheque' }, 'Voir la bibliothèque'));
    return;
  }
  decodeSong(q.d).then((raw) => {
    const id = 'partage-' + hashOf(q.d);
    const s = prepareSong({ genre: 'divers', level: 1, ...raw, id, description: raw.description || 'Morceau reçu par lien de partage.' });
    s.imported = true;
    if (!s.notes.length) throw new Error('Le morceau partagé ne contient aucune note.');
    const bpm = s.beatsPerMeasure;
    const fromM = q.from ? Math.max(1, Math.min(s.measureCount, q.from)) : 1;
    const toM = q.to ? Math.max(fromM, Math.min(s.measureCount, q.to)) : null;
    const params = new URLSearchParams();
    if (q.from) params.set('from', fromM);
    if (toM) params.set('to', toM);
    if (q.tempo) params.set('tempo', q.tempo);
    if (q.hands) params.set('hands', q.hands);
    const qs = params.toString() ? '?' + params : '';
    const inLib = store.library().some((x) => x.id === id);
    const g = genreOf(s.genre);
    const staffBox = h('div', { class: 'staff-box' });
    box.innerHTML = '';
    box.append(
      h('h2', {}, s.title),
      h('p', { class: 'muted' }, `${s.composer && s.composer !== 'Inconnu' ? s.composer + ' · ' : ''}${g.name} · ${levelLabel(s.level)} · ${s.measureCount} mesures · ${s.timeSig[0]}/${s.timeSig[1]} · ♩ = ${s.tempo}`),
      q.from || q.to || q.tempo || q.hands ? h('p', { class: 'small' }, `Passage proposé : ${q.from || q.to ? `mesures ${fromM} à ${toM || s.measureCount}` : 'tout le morceau'}${q.tempo ? ` · tempo ${q.tempo} %` : ''}${q.hands ? ` · ${q.hands === 'R' ? 'main droite' : q.hands === 'L' ? 'main gauche' : 'deux mains'}` : ''}`) : null,
      staffBox,
      h('div', { class: 'row actions' }, [
        h('button', { class: 'btn primary', onclick: () => {
          ctx.prepared.set(id, s);
          location.hash = `#/jouer/${encodeURIComponent(id)}${qs}`;
        } }, '🎯 S’entraîner'),
        h('button', { class: 'btn', disabled: inLib, onclick: (e) => {
          const rawSave = { ...raw, id, genre: s.genre, level: s.level, description: 'Morceau reçu par lien de partage.' };
          if (!store.saveToLibrary(rawSave)) return toast('Espace de stockage plein.');
          ctx.prepared.delete(id);
          e.target.disabled = true;
          e.target.textContent = '✔ Dans ta bibliothèque';
          toast('Morceau ajouté à ta bibliothèque !');
        } }, inLib ? '✔ Dans ta bibliothèque' : '💾 Ajouter à ma bibliothèque'),
        inLib ? h('a', { class: 'btn', href: `#/morceau/${encodeURIComponent(id)}` }, 'Ouvrir la fiche') : null,
      ]),
    );
    requestAnimationFrame(() => {
      const from = (fromM - 1) * bpm;
      new StaffView(staffBox).render(s, from, Math.min(s.totalBeats, from + bpm * (innerWidth < 600 ? 2 : 4)), { settings: ctx.settings, showFingers: true });
    });
  }).catch((err) => {
    box.innerHTML = '';
    box.append(h('p', { class: 'error-text' }, 'Ce lien de partage est illisible ou incomplet : ' + (err.message || err)), h('a', { class: 'btn', href: '#/' }, 'Accueil'));
  });
}

registerRoute(/^partage$/, viewShare);
