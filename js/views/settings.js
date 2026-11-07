// Vue : settings
import { store, DEFAULT_SETTINGS } from '../core/storage.js';
import { h, toast, modal } from '../ui/dom.js';
import * as synth from '../audio/synth.js';
import { mic } from '../audio/mic.js';
import { ctx, main, onCleanup, registerRoute, applyTheme, section, settingsSections } from '../ui/context.js';
import { speak } from '../ui/dom.js';
import { AVATARS } from '../core/storage.js';
import { applyA11y, renderProfileSlot, addPlayerDialog, switchTo, scheduleReminder } from '../ui/shell.js';

/** Section « Joueurs » : renommer, changer d'avatar, supprimer, ajouter. */
function profilesSection() {
  const cur = store.currentProfile();
  const list = h('div', { class: 'settings', id: 'profils' }, store.profiles().map((p) => {
    const name = h('input', { value: p.name, maxlength: 24, 'aria-label': 'Prénom de ' + p.name, onchange: (e) => { store.updateProfile(p.id, { name: e.target.value }); renderProfileSlot(); toast('Prénom modifié'); } });
    const av = h('button', { type: 'button', class: 'btn tiny avatar-cycle', 'aria-label': 'Changer d’avatar', title: 'Changer d’avatar', onclick: (e) => {
      const next = AVATARS[(AVATARS.indexOf(p.avatar) + 1) % AVATARS.length];
      store.updateProfile(p.id, { avatar: next });
      p.avatar = next;
      e.currentTarget.textContent = next;
      renderProfileSlot();
    } }, p.avatar);
    return h('div', { class: 'setting profile-row' + (p.id === cur.id ? ' on' : '') }, [
      h('span', { class: 'row' }, [av, name]),
      p.id === cur.id ? h('span', { class: 'chip' }, 'Joueur actuel') : h('button', { type: 'button', class: 'btn tiny', onclick: () => switchTo(p.id) }, 'Jouer avec ce profil'),
      store.profiles().length > 1 ? h('button', { type: 'button', class: 'btn tiny danger', onclick: () => modal(`Supprimer ${p.name} ?`, '<p>Ses progrès, badges et réglages seront effacés de ce navigateur (les partitions importées restent).</p>', [{ label: 'Supprimer', primary: true, action: () => { store.removeProfile(p.id); ctx.settings = store.settings(); applyTheme(); applyA11y(); renderProfileSlot(); ctx.route(); } }, { label: 'Annuler' }]) }, 'Supprimer') : h('span'),
    ]);
  }));
  return section('Joueurs', [list, h('button', { type: 'button', class: 'btn', onclick: () => addPlayerDialog() }, '＋ Ajouter un joueur')]);
}

// ---------- Réglages ----------
function viewSettings() {
  const s = { ...ctx.settings };
  const save = () => {
    store.saveSettings(s);
    ctx.settings = s;
    applyTheme();
    applyA11y(s);
    toast('Réglages enregistrés');
  };
  const sel = (key, options, label) => h('label', { class: 'setting' }, [h('span', {}, label), h('select', { onchange: (e) => { s[key] = e.target.value; save(); } }, options.map(([v, l]) => h('option', { value: v, selected: String(s[key]) === String(v) }, l)))]);
  const chk = (key, label, help) => h('label', { class: 'setting check' }, [h('input', { type: 'checkbox', checked: !!s[key], onchange: (e) => { s[key] = e.target.checked; save(); } }), h('span', {}, [label, help ? h('small', {}, help) : null])]);
  const num = (key, label, min, max, step, unit = '') => {
    const out = h('span', { class: 'mono' }, s[key] + unit);
    return h('label', { class: 'setting' }, [h('span', {}, label), h('input', { type: 'range', min, max, step, value: s[key], oninput: (e) => { s[key] = Number(e.target.value); out.textContent = s[key] + unit; }, onchange: save }), out]);
  };
  const level = h('div', { class: 'level' }, h('div', { class: 'bar' }));
  const offMic = mic.on((e) => e.type === 'frame' && (level.firstChild.style.width = Math.min(100, e.rms * 600) + '%'));
  onCleanup(offMic);
  main.append(h('h1', {}, 'Réglages'),
    section('Affichage', h('div', { class: 'settings' }, [
      sel('notation', [['fr', 'Do Ré Mi (français)'], ['en', 'C D E (anglais)']], 'Nom des notes'),
      sel('theme', [['auto', 'Automatique'], ['dark', 'Sombre'], ['light', 'Clair']], 'Thème'),
      sel('view', [['both', 'Portée + notes qui tombent'], ['staff', 'Portée seule'], ['roll', 'Notes qui tombent seules']], 'Vue d’entraînement'),
      chk('showFingers', 'Afficher les doigtés'), chk('showNoteNames', 'Afficher le nom des notes'), chk('showKeyboardLabels', 'Afficher les touches du clavier d’ordinateur sur le piano'),
    ])),
    section('Son', h('div', { class: 'settings' }, [
      sel('instrument', synth.INSTRUMENT_LIST, 'Instrument'), num('volume', 'Volume', 0, 1, 0.05), chk('metronome', 'Métronome activé par défaut'), chk('midiLocalSound', 'Son de l’app pour le clavier MIDI', 'Décoche si ton piano numérique produit déjà le son (évite le son en double).'), chk('countIn', 'Décompte d’une mesure en mode Tempo'),
      h('button', { class: 'btn', onclick: () => [60, 64, 67, 72].forEach((m, i) => synth.playNote(m, { when: synth.audioContext().currentTime + i * 0.2, dur: 0.6, instrument: s.instrument, velocity: 0.7 })) }, '🔊 Tester le son'),
    ])),
    section('Micro & détection', h('div', { class: 'settings' }, [
      num('a4', 'Diapason La4', 415, 466, 1, ' Hz'), num('micSensitivity', 'Seuil du micro (plus bas = plus sensible)', 0.003, 0.05, 0.001),
      h('div', { class: 'setting' }, [h('span', {}, 'Niveau du micro'), level, h('button', { class: 'btn tiny', onclick: async () => { try { await mic.start(); } catch (e) { toast(e.message); } } }, 'Tester')]),
      chk('octaveTolerant', 'Tolérer les erreurs d’octave au micro', 'Le micro confond parfois une note avec son octave : la note est acceptée, mais l’avertissement « bonne note, mauvaise octave » s’affiche.'),
      num('latencyMs', 'Compensation de latence', 0, 300, 5, ' ms'),
    ])),
    section('Accessibilité', h('div', { class: 'settings' }, [
      chk('kidMode', 'Mode enfant', 'Interface simplifiée, gros boutons, consignes courtes et encourageantes.'),
      chk('tts', 'Lecture vocale des consignes', 'L’app lit les consignes et les résultats à voix haute (voix française du système).'),
      chk('bigUi', 'Grande taille', 'Texte, boutons et clavier plus grands.'),
      chk('cbSafe', 'Couleurs pour daltoniens', 'Juste = bleu ✓, faux = orange ✗ (au lieu de vert/rouge).'),
      chk('contrast', 'Contraste renforcé', 'Textes et bordures plus marqués.'),
      h('button', { class: 'btn', type: 'button', onclick: () => { if (!speak('Bonjour ! Voici la lecture vocale de Piano Coach.', { force: true })) toast('La lecture vocale n’est pas disponible dans ce navigateur.'); } }, '🔈 Tester la voix'),
    ])),
    section('Objectifs', h('div', { class: 'settings' }, [
      num('dailyGoalMin', 'Objectif quotidien', 5, 120, 5, ' min'),
      h('label', { class: 'setting check' }, [h('input', { type: 'checkbox', checked: !!s.reminder, onchange: async (e) => {
        if (e.target.checked && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
          const perm = await Notification.requestPermission().catch(() => 'denied');
          if (perm !== 'granted') {
            e.target.checked = false;
            toast('Notifications refusées par le navigateur.');
            return;
          }
        }
        s.reminder = e.target.checked;
        save();
        scheduleReminder();
      } }), h('span', {}, ['Rappel quotidien', h('small', {}, typeof Notification === 'undefined' ? 'Non disponible dans ce navigateur.' : 'Une notification si ton objectif n’est pas atteint (à partir de l’heure choisie, quand l’app est ouverte dans un onglet).')])]),
      num('reminderHour', 'Heure du rappel', 8, 22, 1, ' h'),
    ])),
    ...settingsSections.map((f) => { try { return f(); } catch (e) { console.error(e); return null; } }).filter(Boolean),
    profilesSection(),
    section('Données', h('div', { class: 'row' }, [
      h('button', { class: 'btn', onclick: () => { const d = { ...DEFAULT_SETTINGS, onboarded: true }; store.saveSettings(d); ctx.settings = d; applyTheme(); applyA11y(d); ctx.route(); } }, 'Réglages par défaut'),
      h('button', { class: 'btn danger', onclick: () => modal('Tout effacer ?', '<p>Tous les joueurs, progrès, imports et réglages seront supprimés de ce navigateur.</p>', [{ label: 'Tout effacer', primary: true, action: () => { Object.keys(localStorage).filter((k) => k.startsWith('pianocoach.')).forEach((k) => localStorage.removeItem(k)); ctx.prepared.clear(); location.hash = '#/'; location.reload(); } }, { label: 'Annuler' }]) }, 'Effacer toutes mes données'),
    ])),
  );
}

registerRoute(/^reglages$/, (query = {}) => {
  viewSettings();
  if (query.section === 'profils') setTimeout(() => document.getElementById('profils')?.scrollIntoView({ block: 'start' }), 50);
});
