// Section Réglages « Audio & MIDI » : périphériques MIDI (entrées, sortie, canaux), son local,
// instrument, test de son, niveau et confiance du micro en direct, profil « Mon piano », latence.
import { store, DEFAULT_SETTINGS } from '../core/storage.js';
import { noteLabel } from '../core/notes.js';
import { h, toast } from '../ui/dom.js';
import * as synth from '../audio/synth.js';
import { mic } from '../audio/mic.js';
import { midiInput, deviceMakesSound } from '../audio/midi-input.js';
import { midiOutput } from '../audio/midi-output.js';
import { ctx, main, onCleanup, section, settingsSections } from '../ui/context.js';

// ---------- enregistrement des réglages audio ----------
// La page Réglages garde une copie des réglages prise à l'ouverture et la ré-enregistre en entier à chaque
// changement : sans précaution, elle effacerait les réglages modifiés ici entre-temps. On protège donc les
// clés propres à cette fonctionnalité qui ont été écrites pendant la session.
const AUDIO_KEYS = ['midiInputIds', 'midiInChannel', 'midiLocalSoundMode', 'midiOutEnabled', 'midiOutId', 'midiOutChannel', 'midiOutMode', 'midiOutMetronome', 'midiOutProgram', 'micProfile', 'micUseProfile', 'micNoisyMode', 'latency'];
const fresh = new Map();
const rawSave = store.saveSettings.bind(store);
store.saveSettings = (s) => {
  if (s === DEFAULT_SETTINGS) {
    fresh.clear();
    return rawSave(s);
  }
  const out = { ...s };
  for (const [k, v] of fresh) out[k] = v;
  return rawSave(out);
};

/** Enregistre des réglages audio (fusion avec l'état courant) et les applique. */
export function saveAudio(patch) {
  for (const k of Object.keys(patch)) if (AUDIO_KEYS.includes(k)) fresh.set(k, patch[k]);
  rawSave({ ...store.settings(), ...patch });
  Object.assign(ctx.settings, patch);
  const s = store.settings();
  midiOutput.configure(s);
  midiInput.applySettings(s);
  if (mic.running) mic.loadSettings(s);
}

export const latencyOf = (s, src) => s.latency?.[src] ?? (src === 'mic' ? s.latencyMs || 0 : 0);

const CHANNELS = Array.from({ length: 16 }, (_, i) => [String(i + 1), `Canal ${i + 1}`]);
let uid = 0;

function field(label, control, help) {
  const id = control.id || (control.id = 'au-' + ++uid);
  return h('div', { class: 'setting' }, [h('label', { for: id }, [label, help ? h('small', {}, help) : null]), control]);
}
function select(options, value, onchange, attrs = {}) {
  return h('select', { ...attrs, onchange: (e) => onchange(e.target.value) }, options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)));
}
function check(label, checked, onchange, help) {
  return h('label', { class: 'setting check' }, [h('input', { type: 'checkbox', checked: !!checked, onchange: (e) => onchange(e.target.checked) }), h('span', {}, [label, help ? h('small', {}, help) : null])]);
}

/** Trouve un contrôle de la page Réglages principale (hors de cette section) pour rester synchronisé. */
function findMainControl(mine, pred) {
  return [...main.querySelectorAll('input, select')].find((el) => !mine.contains(el) && pred(el));
}

function audioSection() {
  const s = store.settings();
  const root = h('div', { class: 'settings audio-settings' });

  // ----- Entrées MIDI -----
  const inStatus = h('p', { class: 'small muted', 'aria-live': 'polite' });
  const inList = h('div', { class: 'au-devices', role: 'group', 'aria-label': 'Entrées MIDI' });
  const renderInputs = () => {
    inList.innerHTML = '';
    if (!midiInput.supported) {
      inStatus.textContent = 'Web MIDI non disponible dans ce navigateur (utilise Chrome ou Edge).';
      return;
    }
    if (!midiInput.access) {
      inStatus.textContent = 'Accès MIDI non autorisé pour l’instant.';
      inList.append(h('button', { class: 'btn tiny', onclick: () => midiInput.init().then(renderAll).catch((e) => toast('MIDI : ' + (e.message || e))) }, 'Autoriser le MIDI'));
      return;
    }
    inStatus.textContent = midiInput.inputs.length ? 'Coche les claviers à écouter :' : 'Aucun clavier MIDI branché.';
    for (const d of midiInput.inputs) {
      inList.append(h('label', { class: 'au-device' }, [
        h('input', { type: 'checkbox', checked: d.enabled, onchange: (e) => {
          const ids = midiInput.inputs.filter((x) => (x.id === d.id ? e.target.checked : x.enabled)).map((x) => x.id);
          saveAudio({ midiInputIds: ids.length === midiInput.inputs.length ? null : ids });
        } }),
        h('span', {}, [d.name, deviceMakesSound(d.name) ? h('small', {}, ' · produit son propre son') : null]),
      ]));
    }
  };
  const inChannel = select([['0', 'Tous les canaux'], ...CHANNELS], s.midiInChannel ?? 0, (v) => saveAudio({ midiInChannel: Number(v) }));

  // ----- son local -----
  const localHelp = h('small', { class: 'au-help' });
  const updateLocalHelp = () => {
    const cur = store.settings();
    const mode = cur.midiLocalSoundMode ?? 'auto';
    const auto = midiInput.autoLocalSound();
    localHelp.textContent = mode === 'auto'
      ? (auto == null ? 'Automatique : décidé quand un clavier est branché.' : auto ? 'Automatique : clavier sans son propre → son de l’app activé.' : 'Automatique : piano numérique détecté → son de l’app coupé.')
      : '';
  };
  const localMode = select([['auto', 'Automatique'], ['on', 'Toujours'], ['off', 'Jamais (mon piano a son propre son)']], s.midiLocalSoundMode ?? 'auto', (v) => {
    let val = v === 'on' ? true : v === 'off' ? false : midiInput.autoLocalSound() ?? store.settings().midiLocalSound;
    saveAudio({ midiLocalSoundMode: v, midiLocalSound: val });
    syncOld(val);
    updateLocalHelp();
  });
  const oldLocal = () => findMainControl(root, (el) => el.type === 'checkbox' && /clavier MIDI/i.test(el.closest('label')?.textContent || ''));
  let syncing = false;
  const syncOld = (val) => {
    const old = oldLocal();
    if (old && old.checked !== val) {
      syncing = true;
      old.checked = val;
      old.dispatchEvent(new Event('change', { bubbles: true }));
      syncing = false;
    }
  };
  // la case « Son de l'app pour le clavier MIDI » de la section Son devient un choix manuel
  setTimeout(() => oldLocal()?.addEventListener('change', (e) => {
    if (syncing) return;
    const v = e.target.checked ? 'on' : 'off';
    saveAudio({ midiLocalSoundMode: v });
    localMode.value = v;
    updateLocalHelp();
  }));

  // ----- sortie MIDI -----
  const outDev = h('select', { onchange: (e) => saveAudio({ midiOutId: e.target.value || null }) });
  const renderOutputs = () => {
    const cur = store.settings();
    outDev.innerHTML = '';
    const list = midiOutput.outputs;
    if (!list.length) outDev.append(h('option', { value: '' }, midiOutput.access ? 'Aucune sortie MIDI' : 'Active la sortie pour lister'));
    for (const o of list) outDev.append(h('option', { value: o.id, selected: o.id === cur.midiOutId }, o.name));
    outDev.disabled = !list.length;
  };
  const outOpts = h('div', { class: 'au-sub' });
  const outEnable = check('Envoyer les notes de l’app vers un clavier MIDI', s.midiOutEnabled, async (v) => {
    if (v && midiOutput.supported) await midiOutput.init().catch((e) => toast('MIDI : ' + (e.message || e)));
    saveAudio({ midiOutEnabled: v, midiOutId: store.settings().midiOutId ?? midiOutput.outputs[0]?.id ?? null });
    renderOutputs();
    outOpts.hidden = !v;
  }, 'Accompagnement, mode Écoute et métronome joués sur ton propre piano.');
  outOpts.hidden = !s.midiOutEnabled;
  outOpts.append(
    field('Sortie', outDev),
    field('Canal de sortie', select(CHANNELS, s.midiOutChannel ?? 1, (v) => saveAudio({ midiOutChannel: Number(v) }))),
    field('Son', select([['both', 'Son de l’app + MIDI'], ['midi', 'MIDI seulement']], s.midiOutMode ?? 'both', (v) => saveAudio({ midiOutMode: v }))),
    check('Métronome sur la sortie MIDI', s.midiOutMetronome ?? true, (v) => saveAudio({ midiOutMetronome: v }), 'Note 37 (baguette) sur le canal 10.'),
    check('Changer le son du clavier selon l’instrument', s.midiOutProgram, (v) => saveAudio({ midiOutProgram: v }), 'Envoie un « Program Change » General MIDI.'),
    h('button', { class: 'btn tiny', onclick: () => {
      if (!midiOutput.active) return toast('Aucune sortie MIDI active');
      const ac = synth.audioContext();
      [60, 64, 67, 72].forEach((m, i) => synth.playNote(m, { when: ac.currentTime + 0.05 + i * 0.25, dur: 0.4, velocity: 0.7, instrument: store.settings().instrument }));
    } }, '🎹 Tester la sortie MIDI'),
  );
  if (midiOutput.supported && s.midiOutEnabled) midiOutput.init().then(renderOutputs).catch(() => {});
  renderOutputs();

  // ----- instrument / test -----
  const inst = select(synth.INSTRUMENT_LIST, s.instrument, (v) => {
    const other = findMainControl(root, (el) => el.tagName === 'SELECT' && [...el.options].some((o) => o.value === 'clavecin'));
    if (other) {
      other.value = v;
      other.dispatchEvent(new Event('change', { bubbles: true }));
    } else saveAudio({ instrument: v });
  });
  const testBtn = h('button', { class: 'btn', onclick: () => {
    const ac = synth.audioContext();
    const instr = store.settings().instrument;
    [48, 55, 60, 64, 67, 72, 76].forEach((m, i) => synth.playNote(m, { when: ac.currentTime + 0.05 + i * 0.12, dur: 1.4 - i * 0.1, velocity: 0.55 + i * 0.05, instrument: instr }));
  } }, '🔊 Tester le son');

  // ----- micro en direct -----
  const lvl = h('div', { class: 'level au-meter', role: 'meter', 'aria-label': 'Niveau du micro', 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('div', { class: 'bar' }));
  const conf = h('div', { class: 'level au-meter au-conf', role: 'meter', 'aria-label': 'Confiance de la détection', 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('div', { class: 'bar' }));
  const noteOut = h('span', { class: 'mono au-note', 'aria-live': 'off' }, '—');
  const micBtn = h('button', { class: 'btn tiny', onclick: async () => {
    try {
      if (mic.running) mic.stop();
      else {
        mic.a4 = ctx.settings.a4;
        mic.setSensitivity(ctx.settings.micSensitivity);
        await mic.start();
      }
    } catch (e) {
      toast('Micro : ' + e.message);
    }
  } }, mic.running ? 'Arrêter' : 'Écouter');
  const offMic = mic.on((e) => {
    if (e.type === 'state') micBtn.textContent = e.running ? 'Arrêter' : 'Écouter';
    if (e.type !== 'frame') return;
    const l = Math.min(100, e.rms * 600);
    lvl.firstChild.style.width = l + '%';
    lvl.setAttribute('aria-valuenow', Math.round(l));
    conf.firstChild.style.width = Math.round((e.confidence ?? 0) * 100) + '%';
    conf.setAttribute('aria-valuenow', Math.round((e.confidence ?? 0) * 100));
    noteOut.textContent = e.midi != null && (e.confidence ?? 0) > 0.4 ? noteLabel(e.midi, ctx.settings) : '—';
  });
  onCleanup(offMic);
  const p = s.micProfile;
  const profileTxt = p?.bands
    ? `Profil du ${new Date(p.createdAt).toLocaleDateString('fr-FR')} : bruit de fond ${(p.noise * 1000).toFixed(1)} ‰, registres ${Object.keys(p.bands).map((b) => ({ low: 'graves', mid: 'médiums', high: 'aigus' })[b]).join(', ')}.`
    : 'Aucun profil : seuil du micro général utilisé.';
  const lat = ['midi', 'keyboard', 'mic'].map((k) => `${{ midi: 'MIDI', keyboard: 'clavier', mic: 'micro' }[k]} ${latencyOf(s, k)} ms`).join(' · ');

  const renderAll = () => {
    renderInputs();
    renderOutputs();
    updateLocalHelp();
  };
  const offIn = midiInput.on((e) => e.type === 'devices' && renderAll());
  const offOut = midiOutput.on((e) => e.type === 'devices' && renderOutputs());
  onCleanup(() => { offIn(); offOut(); });
  if (midiInput.supported) midiInput.init().then(renderAll).catch(renderAll);
  renderAll();

  root.append(
    h('h3', { class: 'au-h' }, 'Entrées MIDI'),
    h('div', { class: 'setting au-block' }, [inStatus, inList]),
    field('Canal écouté', inChannel),
    field('Son de l’app pour les notes MIDI', localMode, localHelp),
    h('h3', { class: 'au-h' }, 'Sortie MIDI'),
    outEnable,
    outOpts,
    h('h3', { class: 'au-h' }, 'Son et micro'),
    field('Instrument', inst),
    h('div', { class: 'setting' }, [h('span', {}, 'Test'), testBtn]),
    h('div', { class: 'setting au-live' }, [
      h('span', {}, ['Micro en direct', h('small', {}, 'Niveau (vert) et confiance de la détection (violet).')]),
      h('div', { class: 'au-meters' }, [lvl, conf]),
      h('div', { class: 'au-live-end' }, [noteOut, micBtn]),
    ]),
    check('Mode pièce bruyante', s.micNoisyMode, (v) => saveAudio({ micNoisyMode: v }), 'Une confirmation de plus avant de valider une note au micro (moins de fausses notes, un peu plus lent).'),
    check('Utiliser le profil « Mon piano »', s.micUseProfile !== false, (v) => saveAudio({ micUseProfile: v }), profileTxt),
    h('div', { class: 'setting au-links' }, [
      h('span', {}, ['Latence mesurée', h('small', {}, lat)]),
      h('a', { class: 'btn tiny', href: '#/calibration?etape=profil' }, '🎹 Profil Mon piano'),
      h('a', { class: 'btn tiny primary', href: '#/calibration' }, '⏱ Calibrer la latence'),
    ]),
  );
  return section('Audio & MIDI', root, 'audio-section');
}

settingsSections.push(audioSection);
