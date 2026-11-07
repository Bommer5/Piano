// Réglages de notation (section ajoutée à la page Réglages via settingsSections) :
// numérotation des octaves et affichage des symboles d'accords sur la portée.
import { store } from '../core/storage.js';
import { noteLabel } from '../core/notes.js';
import { h, toast } from '../ui/dom.js';
import { ctx, section, settingsSections } from '../ui/context.js';

function save(patch) {
  const next = { ...store.settings(), ...patch };
  store.saveSettings(next);
  ctx.settings = { ...ctx.settings, ...patch };
  toast('Réglages enregistrés');
}

function notationSection() {
  const s = ctx.settings || store.settings();
  const style = s.octaveStyle === 'fr' ? 'fr' : 'intl';
  const example = h('small', { 'aria-live': 'polite' });
  const updateExample = (v) => {
    const st = { ...ctx.settings, octaveStyle: v };
    example.textContent = `Do central : ${noteLabel(60, st)} · La du diapason : ${noteLabel(69, st)}`;
  };
  updateExample(style);
  const sel = h('select', {
    id: 'set-octave-style',
    onchange: (e) => {
      save({ octaveStyle: e.target.value });
      updateExample(e.target.value);
    },
  }, [
    h('option', { value: 'intl', selected: style === 'intl' }, 'Internationale (Do4 = do central)'),
    h('option', { value: 'fr', selected: style === 'fr' }, 'Française (Do3 = do central, conservatoires)'),
  ]);
  const chords = h('input', { type: 'checkbox', checked: s.showChordSymbols !== false, onchange: (e) => save({ showChordSymbols: e.target.checked }) });
  return section('Notation', h('div', { class: 'settings' }, [
    h('label', { class: 'setting', for: 'set-octave-style' }, [h('span', {}, ['Numérotation des octaves', example]), sel]),
    h('label', { class: 'setting check' }, [chords, h('span', {}, ['Afficher les symboles d’accords sur la portée', h('small', {}, 'Ex. « Dm7 », « G7/B » au-dessus de la portée, quand la partition en contient.')])]),
  ]));
}

settingsSections.push(notationSection);
