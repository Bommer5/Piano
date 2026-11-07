// Vue : accueil guidé au premier lancement (#/bienvenue).
// Étapes : qui joue → comment tu joues → trouve le Do → objectif quotidien → 1re leçon.
// Chaque étape a un bouton « Passer » qui termine l'accueil et mène à l'accueil normal.
import { COURSES } from '../data/lessons.js';
import { store, AVATARS } from '../core/storage.js';
import { midiToName } from '../core/notes.js';
import { PianoKeyboard } from '../ui/keyboard.js';
import { h, toast, speak } from '../ui/dom.js';
import * as synth from '../audio/synth.js';
import { mic } from '../audio/mic.js';
import { midiInput, computerKeyboard } from '../audio/midi-input.js';
import { ctx, main, onCleanup, registerRoute, applyTheme } from '../ui/context.js';
import { applyA11y, renderProfileSlot } from '../ui/shell.js';

const STEPS = ['qui', 'jeu', 'do', 'objectif', 'go'];

function saveSettings(patch) {
  const s = { ...store.settings(), ...patch };
  store.saveSettings(s);
  ctx.settings = s;
  applyTheme();
  applyA11y(s);
}

function finish(hash = '#/') {
  saveSettings({ onboarded: true });
  mic.stop?.();
  location.hash = hash;
}

function viewWelcome(query) {
  const idx = Math.max(0, STEPS.indexOf(query.etape || 'qui'));
  const go = (i) => (location.hash = '#/bienvenue?etape=' + STEPS[i]);
  const prof = store.currentProfile();
  const s = store.settings();
  const kid = s.kidMode;

  const card = h('div', { class: 'card welcome' });
  const dots = h('ol', { class: 'welcome-dots', 'aria-label': `Étape ${idx + 1} sur ${STEPS.length}` }, STEPS.map((_, i) => h('li', { class: i < idx ? 'done' : i === idx ? 'on' : '' })));
  const nav = (nextLabel, onNext, { disabled = false } = {}) => h('div', { class: 'welcome-nav' }, [
    idx > 0 ? h('button', { class: 'btn', type: 'button', onclick: () => go(idx - 1) }, '← Retour') : h('span'),
    h('button', { class: 'btn link-btn', type: 'button', onclick: () => finish() }, 'Passer'),
    onNext ? h('button', { class: 'btn primary big', type: 'button', disabled, onclick: onNext }, nextLabel) : null,
  ]);
  main.append(h('div', { class: 'welcome-wrap' }, [dots, card]));

  const say = (t) => speak(t);

  if (STEPS[idx] === 'qui') {
    let avatar = prof.avatar;
    let player = s.player || 'adult';
    const name = h('input', { id: 'w-name', value: prof.name === 'Moi' ? '' : prof.name, placeholder: 'Ton prénom', maxlength: 24, autocomplete: 'given-name' });
    const avatars = h('div', { class: 'avatar-grid', role: 'radiogroup', 'aria-label': 'Avatar' }, AVATARS.map((a) => h('button', {
      type: 'button', class: 'avatar-btn' + (a === avatar ? ' on' : ''), role: 'radio', 'aria-checked': String(a === avatar), 'aria-label': 'Avatar ' + a,
      onclick: (e) => { avatar = a; avatars.querySelectorAll('.avatar-btn').forEach((b) => { b.classList.toggle('on', b === e.currentTarget); b.setAttribute('aria-checked', String(b === e.currentTarget)); }); },
    }, a)));
    const who = h('div', { class: 'choice-grid two', role: 'radiogroup', 'aria-label': 'Qui joue ?' }, [['adult', '🧑', 'Un adulte (ou un ado)', 'Interface complète'], ['child', '🧒', 'Un enfant', 'Mode enfant : gros boutons, consignes simples, lecture vocale']].map(([id, e, t, d]) =>
      h('button', { type: 'button', class: 'choice' + (player === id ? ' on' : ''), role: 'radio', 'aria-checked': String(player === id), 'data-player': id, onclick: (ev) => { player = id; who.querySelectorAll('.choice').forEach((b) => { b.classList.toggle('on', b === ev.currentTarget); b.setAttribute('aria-checked', String(b === ev.currentTarget)); }); } }, [h('span', { class: 'choice-emoji' }, e), h('b', {}, t), h('small', {}, d)])));
    card.append(
      h('h1', {}, 'Bienvenue dans Piano Coach ! 🎹'),
      h('p', { class: 'lead' }, 'Quelques questions pour préparer ton espace (1 minute).'),
      h('h2', {}, 'Qui joue ?'), who,
      h('label', { class: 'field-block', for: 'w-name' }, [h('span', {}, 'Prénom')]), name,
      h('p', { class: 'small muted' }, 'Ton avatar :'), avatars,
      nav('Continuer →', () => {
        store.updateProfile(prof.id, { name: name.value.trim() || prof.name, avatar });
        saveSettings({ player, kidMode: player === 'child', tts: player === 'child' ? true : store.settings().tts });
        renderProfileSlot();
        go(idx + 1);
      }),
    );
    say('Bienvenue dans Piano Coach ! Qui joue ?');
  } else if (STEPS[idx] === 'jeu') {
    let mode = s.inputMode;
    const extra = h('div', { class: 'welcome-extra' });
    const level = h('div', { class: 'level', 'aria-hidden': 'true' }, h('div', { class: 'bar' }));
    const pick = (id) => {
      mode = id;
      grid.querySelectorAll('.choice').forEach((b) => { b.classList.toggle('on', b.dataset.input === id); b.setAttribute('aria-checked', String(b.dataset.input === id)); });
      extra.innerHTML = '';
      if (id === 'midi') {
        const st = h('p', { class: 'small', 'aria-live': 'polite' }, midiInput.supported ? 'Branche ton clavier en USB (ou Bluetooth) puis appuie sur une touche.' : 'Ce navigateur ne gère pas le MIDI : utilise Chrome ou Edge, ou choisis le micro.');
        extra.append(st);
        if (midiInput.supported) midiInput.init().then((d) => { st.textContent = d.length ? `Clavier détecté : ${d.join(', ')}. Appuie sur une touche !` : 'Aucun clavier détecté pour l’instant. Branche-le puis appuie sur une touche.'; }).catch(() => { st.textContent = 'Accès MIDI refusé.'; });
        const off = midiInput.on((e) => { if (e.type === 'noteon') st.textContent = `✓ Reçu : ${midiToName(e.midi)}. Ton clavier fonctionne !`; });
        onCleanup(off);
      } else if (id === 'mic') {
        const st = h('p', { class: 'small', 'aria-live': 'polite' }, 'Pose ton téléphone ou ton ordinateur près du piano, puis lance le test et joue une note.');
        const btn = h('button', { class: 'btn', type: 'button', onclick: async () => {
          try {
            await mic.start();
            st.textContent = 'Joue une note sur ton piano…';
          } catch (e) {
            st.textContent = 'Micro indisponible : ' + e.message;
          }
        } }, '🎤 Tester le micro');
        let heard = false;
        const off = mic.on((e) => {
          if (e.type === 'frame') level.firstChild.style.width = Math.min(100, e.rms * 600) + '%';
          if (e.type === 'onset' && !heard) {
            heard = true;
            st.textContent = `✓ J’ai entendu ${midiToName(e.midi)} ! Le niveau est bon.`;
          }
        });
        onCleanup(() => { off(); mic.stop?.(); });
        extra.append(st, h('div', { class: 'row' }, [btn]), level);
      } else if (id === 'keyboard') {
        extra.append(h('p', { class: 'small' }, ['Tu peux cliquer (ou toucher) les touches à l’écran, ou utiliser ton clavier d’ordinateur : ', h('kbd', {}, 'A'), ' = Do, ', h('kbd', {}, 'Z'), '/', h('kbd', {}, 'E'), '… pour les notes suivantes.']));
      }
    };
    const grid = h('div', { class: 'choice-grid', role: 'radiogroup', 'aria-label': 'Comment tu joues ?' }, [
      ['midi', '🎹', 'Clavier MIDI / piano numérique', 'Le plus précis : branché en USB.'],
      ['mic', '🎤', 'Piano acoustique (micro)', 'L’app écoute ton piano.'],
      ['keyboard', '⌨️', 'Clavier d’ordinateur ou souris', 'Pour essayer sans piano.'],
    ].map(([id, e, t, d]) => h('button', { type: 'button', class: 'choice', role: 'radio', 'aria-checked': 'false', 'data-input': id, onclick: () => pick(id) }, [h('span', { class: 'choice-emoji' }, e), h('b', {}, t), h('small', {}, d)])));
    card.append(h('h1', {}, 'Comment tu joues ?'), grid, extra, nav('Continuer →', () => {
      saveSettings({ inputMode: mode || 'keyboard', midiLocalSound: mode === 'midi' ? store.settings().midiLocalSound : true });
      go(idx + 1);
    }));
    if (mode) pick(mode);
    say('Comment tu joues ? Avec un clavier MIDI, un piano acoustique et le micro, ou le clavier de l’ordinateur.');
  } else if (STEPS[idx] === 'do') {
    const fb = h('p', { class: 'find-do-fb', 'aria-live': 'polite' }, 'Appuie sur un Do !');
    const kbEl = h('div', { class: 'find-do-kb' });
    let found = false;
    const next = h('button', { class: 'btn primary big', type: 'button', disabled: true, onclick: () => go(idx + 1) }, 'Continuer →');
    const kb = new PianoKeyboard(kbEl, { onNoteOn: (m) => onNote(m), onNoteOff: () => {} });
    kb.setRange(48, 83);
    function onNote(m) {
      synth.playNote?.(m, { dur: 0.6, velocity: 0.7, instrument: store.settings().instrument });
      if (m % 12 === 0) {
        kb.flash(m, 'hit');
        found = true;
        const oct = Math.floor(m / 12) - 1;
        const txt = `✓ Bravo, c’est un Do (${midiToName(m)}) ! Le Do est toujours juste à gauche des 2 touches noires. Il y en a un dans chaque octave : tous les 12 touches, la même note revient, plus aiguë vers la droite. ${m === 60 ? 'Et tu as trouvé le Do central, au milieu du clavier !' : `Celui-ci est dans l’octave ${oct} ; le Do central est le Do4.`}`;
        fb.textContent = txt;
        fb.className = 'find-do-fb ok';
        next.disabled = false;
        say(txt);
      } else {
        kb.flash(m, 'miss');
        const txt = `✗ Ça, c’est un ${midiToName(m, { octave: false })}. Cherche le groupe de 2 touches noires : le Do est la touche blanche juste à leur gauche.`;
        fb.textContent = txt;
        fb.className = 'find-do-fb bad';
        say(txt);
      }
    }
    const offK = computerKeyboard.on((e) => e.type === 'noteon' && onNote(e.midi));
    const offM = midiInput.on((e) => e.type === 'noteon' && onNote(e.midi));
    const offMic = mic.on((e) => e.type === 'onset' && onNote(e.midi));
    onCleanup(() => { offK(); offM(); offMic(); });
    card.append(
      h('h1', {}, 'Trouve le Do 🔍'),
      h('p', {}, 'Les touches noires vont par groupes de 2 et de 3. Le Do est la touche blanche juste à gauche d’un groupe de 2 touches noires.'),
      h('div', { class: 'two-blacks', 'aria-hidden': 'true' }, [h('span', { class: 'w do' }, 'Do'), h('span', { class: 'w' }), h('span', { class: 'w' }), h('span', { class: 'b b1' }), h('span', { class: 'b b2' })]),
      kbEl, fb,
      h('div', { class: 'welcome-nav' }, [h('button', { class: 'btn', type: 'button', onclick: () => go(idx - 1) }, '← Retour'), h('button', { class: 'btn link-btn', type: 'button', onclick: () => finish() }, 'Passer'), next]),
    );
    if (store.settings().inputMode === 'mic') mic.start().catch(() => {});
    say('Trouve le Do : c’est la touche blanche juste à gauche des deux touches noires.');
    void found;
  } else if (STEPS[idx] === 'objectif') {
    let goal = [5, 10, 15].includes(s.dailyGoalMin) ? s.dailyGoalMin : 10;
    const grid = h('div', { class: 'choice-grid three', role: 'radiogroup', 'aria-label': 'Objectif quotidien' }, [[5, '🌱', 'Tranquille'], [10, '🌿', 'Régulier'], [15, '🌳', 'Motivé']].map(([m, e, t]) =>
      h('button', { type: 'button', class: 'choice' + (goal === m ? ' on' : ''), role: 'radio', 'aria-checked': String(goal === m), 'data-goal': m, onclick: (ev) => { goal = m; grid.querySelectorAll('.choice').forEach((b) => { b.classList.toggle('on', b === ev.currentTarget); b.setAttribute('aria-checked', String(b === ev.currentTarget)); }); } }, [h('span', { class: 'choice-emoji' }, e), h('b', {}, `${m} min / jour`), h('small', {}, t)])));
    card.append(h('h1', {}, 'Ton objectif quotidien 🎯'), h('p', {}, 'Un peu chaque jour vaut mieux que beaucoup une fois par semaine. Tu gagnes un gel de série ❄️ tous les 7 jours d’affilée.'), grid, nav('Continuer →', () => { saveSettings({ dailyGoalMin: goal }); go(idx + 1); }));
    say('Choisis ton objectif quotidien : 5, 10 ou 15 minutes.');
  } else {
    const first = COURSES?.[0]?.lessons?.[0];
    const p = store.currentProfile();
    card.append(
      h('h1', {}, `C’est parti, ${p.name} ${p.avatar} !`),
      h('p', { class: 'lead' }, first ? `Ta première leçon : « ${first.title} ».` : 'Tout est prêt.'),
      h('div', { class: 'row' }, [
        first ? h('button', { class: 'btn primary big', type: 'button', onclick: () => finish('#/lecon/' + encodeURIComponent(first.id)) }, '▶ Lancer la 1re leçon') : null,
        h('button', { class: 'btn big', type: 'button', onclick: () => finish('#/') }, 'Aller à l’accueil'),
      ]),
    );
    say(`C’est parti ! ${first ? 'Lance ta première leçon.' : ''}`);
  }
}

registerRoute(/^bienvenue$/, viewWelcome);
