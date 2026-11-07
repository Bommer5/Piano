// Vue : éditeur de morceau (#/editer/:id).
// - morceau importé : enregistré à la place de l'original ;
// - morceau intégré : si seuls les doigtés changent, ils sont mémorisés (store « fingerings.<id> »,
//   appliqués par findSong) ; sinon on enregistre une copie « (modifié) » dans la bibliothèque.
import { fingeringOverrides, onlyFingeringsChanged, toRawSong } from '../core/edit.js';
import { store } from '../core/storage.js';
import { h, toast, modal, escapeHtml } from '../ui/dom.js';
import { ctx, main, onCleanup, registerRoute, findSong, withDeps } from '../ui/context.js';

// Modules propres à cette page : chargés à la première visite (allègent le démarrage).
let SongEditor;
async function loadDeps() {
  const [m0] = await Promise.all([import('../ui/editor.js')]);
  ({ SongEditor } = m0);
}

function viewEditor(id) {
  const s = findSong(id);
  if (!s) throw new Error('Morceau introuvable.');
  main.className = 'wide';
  const original = s.notes.map((n) => ({ ...n }));
  let dirty = false;
  const saveBtn = h('button', { class: 'btn primary', onclick: save }, '💾 Enregistrer');
  const back = `#/morceau/${encodeURIComponent(id)}`;
  main.append(
    h('div', { class: 'play-head' }, [
      h('a', { class: 'btn tiny', href: back }, '← Retour'),
      h('div', {}, [h('h1', { class: 'h-small' }, `✏️ Modifier « ${s.title} »`), h('p', { class: 'muted small' }, s.imported ? 'Les modifications remplacent ton import.' : 'Morceau de la bibliothèque : tes doigtés sont mémorisés ; les autres changements créent une copie « (modifié) ».')]),
    ]),
  );
  const root = h('div', { class: 'song-editor' });
  main.append(root, h('div', { class: 'row actions' }, [saveBtn, h('a', { class: 'btn', href: back }, 'Annuler')]));
  const ed = new SongEditor(root, s, { settings: ctx.settings, onChange: () => { dirty = true; } });
  onCleanup(() => ed.destroy());
  if (s.customFingering) {
    root.prepend(h('div', { class: 'block tip' }, ['Doigtés personnalisés appliqués. ', h('button', { class: 'btn tiny', onclick: () => { store.set('fingerings.' + id, null); ctx.prepared.delete(id); toast('Doigtés d’origine rétablis.'); ctx.route(); } }, 'Rétablir les doigtés d’origine')]));
  }

  function save() {
    const notes = ed.notes;
    if (!dirty && !ed.history.canUndo) return toast('Aucune modification.');
    if (s.imported) {
      const raw = { ...(store.library().find((x) => x.id === id) || {}), ...toRawSong(s, notes), id };
      if (!store.saveToLibrary(raw)) return toast('Espace de stockage plein.');
      ctx.prepared.delete(id);
      toast('Modifications enregistrées.');
      location.hash = back;
      return;
    }
    const saveCopy = () => {
      const copyId = 'mod-' + id + '-' + Date.now().toString(36);
      const raw = { ...toRawSong(s, notes), id: copyId, title: `${s.title} (modifié)`, description: `Copie modifiée de « ${s.title} ».` };
      if (s.genre) raw.genre = s.genre;
      if (!store.saveToLibrary(raw)) return toast('Espace de stockage plein.');
      toast('Copie enregistrée dans ta bibliothèque.');
      location.hash = `#/morceau/${encodeURIComponent(copyId)}`;
    };
    if (onlyFingeringsChanged(original, notes)) {
      const base = findBaseNotes(id);
      const ov = fingeringOverrides(base, notes);
      modal('Enregistrer les doigtés', `<p>Seuls des doigtés ont changé dans « ${escapeHtml(s.title)} ».</p><p>Les mémoriser pour ce morceau (ils seront utilisés à l’entraînement), ou créer une copie ?</p>`, [
        { label: 'Mémoriser mes doigtés', primary: true, action: () => {
          store.set('fingerings.' + id, Object.keys(ov).length ? ov : null);
          ctx.prepared.delete(id);
          toast('Doigtés personnalisés enregistrés.');
          location.hash = back;
        } },
        { label: 'Enregistrer une copie', action: saveCopy },
        { label: 'Annuler' },
      ]);
    } else saveCopy();
  }
}

/** Notes du morceau intégré sans doigtés personnalisés (référence pour les différences). */
function findBaseNotes(id) {
  const cached = ctx.prepared.get(id);
  const saved = store.get('fingerings.' + id, null);
  ctx.prepared.delete(id);
  store.set('fingerings.' + id, null);
  const base = findSong(id).notes.map((n) => ({ ...n }));
  store.set('fingerings.' + id, saved);
  ctx.prepared.delete(id);
  if (cached) ctx.prepared.set(id, cached);
  return base;
}

registerRoute(/^editer\/(.+)$/, withDeps(loadDeps, viewEditor));
