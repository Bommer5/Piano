// Vue : import
import { GENRES } from '../data/songs.js';
import { prepareSong } from '../core/song.js';
import { noteLabel } from '../core/notes.js';
import { store } from '../core/storage.js';
import { PianoKeyboard } from '../ui/keyboard.js';
import { h, toast } from '../ui/dom.js';
import * as synth from '../audio/synth.js';
import { midiInput, computerKeyboard } from '../audio/midi-input.js';
import { quantize, dedupe, suggestSplitPoint, splitHands, GRIDS, toRawSong } from '../core/edit.js';
import { ctx, main, onCleanup, registerRoute, levelLabel, section, withDeps } from '../ui/context.js';

// Modules propres à cette page : chargés à la première visite (allègent le démarrage).
let importScoreFile, importScoreText, SUPPORTED_FORMATS, StaffView;
async function loadDeps() {
  const [m0, m1] = await Promise.all([import('../parsers/index.js'), import('../ui/staff.js')]);
  ({ importScoreFile, importScoreText, SUPPORTED_FORMATS } = m0);
  ({ StaffView } = m1);
}

// ---------- Import ----------
function viewImport() {
  const result = h('div');
  const input = h('input', { type: 'file', accept: SUPPORTED_FORMATS.flatMap((f) => f.ext.split(/[\s,/]+/)).filter((x) => x.startsWith('.')).join(',') + ',.pdf,.png,.jpg,.jpeg,.mp3,.wav,.ogg,.m4a,.flac,.webm,audio/*', multiple: true, class: 'hidden', onchange: (e) => handleFiles(e.target.files) });
  const drop = h('label', { class: 'dropzone', tabindex: 0 }, [h('span', { class: 'emoji big' }, '📂'), h('b', {}, 'Dépose ta partition ici'), h('span', {}, 'ou clique pour choisir un fichier'), h('small', { class: 'muted' }, SUPPORTED_FORMATS.map((f) => f.ext).join(' · ')), input]);
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); handleFiles(e.dataTransfer.files); });
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });

  const ta = h('textarea', { rows: 8, placeholder: 'Colle ici une partition ABC, du MusicXML, ou le format texte :\n\ntitre: Ma mélodie\ntempo: 90\nMD: C4:1:1 D4:1:2 E4:1:3 F4:1:4 G4:4:5\nMG: C3:4:5 G2:4:1', 'aria-label': 'Partition en texte' });
  const formats = h('table', { class: 'formats' }, [h('tr', {}, [h('th', {}, 'Format'), h('th', {}, 'Extension'), h('th', {}, 'Détails')]), ...SUPPORTED_FORMATS.map((f) => h('tr', {}, [h('td', {}, f.label), h('td', { class: 'mono' }, f.ext), h('td', {}, f.description)]))]);

  main.append(h('h1', {}, 'Importer une partition'),
    h('p', { class: 'lead' }, 'Importe ta propre partition — ou même un enregistrement audio (mp3, wav…) : l’app le transcrit, calcule les doigtés, sépare les mains et crée un cours pas à pas.'),
    drop, result,
    section('Coller du texte', [ta, h('button', { class: 'btn primary', onclick: async () => {
      try {
        const raw = await importScoreText(ta.value, 'collage');
        showPreview(raw);
      } catch (err) {
        showError(err);
      }
    } }, 'Analyser le texte')]),
    section('Exemples à essayer', h('div', { class: 'row' }, ['exemple.musicxml', 'exemple.mid', 'exemple.abc', 'exemple.txt'].map((f) => h('button', { class: 'btn', onclick: async () => {
      try {
        const res = await fetch('samples/' + f);
        if (!res.ok) throw new Error('Fichier exemple introuvable');
        const blob = await res.blob();
        handleFiles([new File([blob], f)]);
      } catch (err) {
        showError(err);
      }
    } }, f)))),
    section('Créer en jouant', recorderPanel()),
    section('Formats acceptés', [h('div', { class: 'table-wrap formats-wrap' }, formats), h('div', { class: 'block tip', html: '💡 <b>Partition papier ou PDF ?</b> La reconnaissance optique de partitions demande un logiciel spécialisé. Utilise gratuitement <b>MuseScore 4</b> (Fichier → Importer PDF) ou <b>Audiveris</b>, puis exporte en <b>MusicXML</b> et importe-le ici. Tu peux aussi trouver des milliers de partitions libres en MusicXML/MIDI sur <b>IMSLP</b>, <b>MuseScore.com</b> (domaine public) ou <b>Mutopia</b>.' })]),
  );

  async function handleFiles(files) {
    for (const file of files) {
      const bar = h('div', { class: 'fill' });
      const wait = h('div', { class: 'card' }, [h('b', {}, `Analyse de « ${file.name} »…`), h('div', { class: 'progress' }, bar)]);
      result.prepend(wait);
      try {
        const raw = await importScoreFile(file, { onProgress: (f) => (bar.style.width = Math.round(f * 100) + '%') });
        wait.remove();
        showPreview(raw, file.name);
      } catch (err) {
        wait.remove();
        showError(err, file.name);
      }
    }
  }

  function showError(err, name) {
    result.prepend(h('div', { class: 'card error' }, [h('b', {}, name ? `Impossible d’importer « ${name} »` : 'Import impossible'), h('p', {}, err.message || String(err))]));
  }

  function showPreview(raw, name) {
    let s;
    try {
      s = prepareSong({ ...raw, id: 'imp-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) });
    } catch (err) {
      return showError(err, name);
    }
    if (!s.notes.length) return showError(new Error('Aucune note trouvée dans ce fichier.'), name);
    const title = h('input', { value: s.title || name || 'Sans titre', 'aria-label': 'Titre' });
    const composer = h('input', { value: s.composer && s.composer !== 'Inconnu' ? s.composer : '', placeholder: 'Compositeur', 'aria-label': 'Compositeur' });
    const tempo = h('input', { type: 'number', min: 20, max: 300, value: Math.round(s.tempo), class: 'num', 'aria-label': 'Tempo' });
    const genre = h('select', { 'aria-label': 'Genre' }, GENRES.map((g) => h('option', { value: g.id, selected: g.id === s.genre }, g.name)));
    const level = h('select', { 'aria-label': 'Niveau' }, [1, 2, 3, 4, 5].map((l) => h('option', { value: l, selected: l === (s.level || estimateLevel(s)) }, levelLabel(l))));
    const splitPt = h('input', { type: 'number', min: 36, max: 84, value: suggestSplitPoint(s.notes), class: 'num', 'aria-label': 'Point de partage des mains (numéro MIDI, 60 = Do central)', oninput: () => (splitName.textContent = noteLabel(Number(splitPt.value) || 60, ctx.settings)) });
    const splitName = h('span', { class: 'small muted' }, noteLabel(Number(splitPt.value), ctx.settings));
    const split = h('div', { class: 'row' }, [h('label', { class: 'check' }, [h('input', { type: 'checkbox', checked: !s.hands.L }), 'Répartir les mains à partir de']), splitPt, splitName]);
    const staffBox = h('div', { class: 'staff-box' });
    const card = h('div', { class: 'card preview' }, [
      h('h3', {}, (raw.transcribed ? '🎧 Musique transcrite' : '✅ Partition lue') + (name ? ` : ${name}` : '')),
      raw.transcribed ? h('div', { class: 'block warning', html: '⚠️ Partition obtenue par <b>transcription automatique</b> de l’audio : elle peut contenir des erreurs (surtout avec plusieurs instruments ou beaucoup d’accords). Écoute-la et ajuste le tempo avant de l’ajouter.' }) : null,
      h('p', {}, `${s.notes.length} notes · ${s.measureCount} mesures · ${s.timeSig[0]}/${s.timeSig[1]} · ${s.hands.R && s.hands.L ? '2 mains' : '1 main'}${s.autoFingering ? ' · doigtés calculés automatiquement' : ' · doigtés de la partition'}`),
      h('div', { class: 'form-grid' }, [h('label', {}, ['Titre', title]), h('label', {}, ['Compositeur', composer]), h('label', {}, ['Tempo (♩/min)', tempo]), h('label', {}, ['Genre', genre]), h('label', {}, ['Niveau', level])]),
      split, staffBox,
      h('div', { class: 'row' }, [h('button', { class: 'btn primary', onclick: save }, '💾 Ajouter à ma bibliothèque'), h('button', { class: 'btn', onclick: () => card.remove() }, 'Annuler')]),
    ]);
    result.prepend(card);
    requestAnimationFrame(() => new StaffView(staffBox).render(s, 0, Math.min(s.totalBeats, s.beatsPerMeasure * 4), { settings: ctx.settings, showFingers: true }));

    function save() {
      let notes = dedupe(s.notes.map((n) => ({ ...n, finger: s.autoFingering ? null : n.finger })));
      if (split.querySelector('input').checked) notes = splitHands(notes, Number(splitPt.value) || 60).map((n) => ({ ...n, finger: null }));
      const out = { ...toRawSong(s, notes), id: s.id, title: title.value || 'Sans titre', composer: composer.value || 'Inconnu', tempo: Number(tempo.value) || s.tempo, timeSig: s.timeSig, keyFifths: s.keyFifths || 0, genre: genre.value, level: Number(level.value), description: 'Partition importée.' };
      if (!store.saveToLibrary(out)) return toast('Espace de stockage plein : supprime d’anciens imports.');
      ctx.prepared.delete(out.id);
      toast('Partition ajoutée ! Un cours pas à pas a été créé pour elle.');
      location.hash = `#/morceau/${out.id}`;
    }
  }
}

function estimateLevel(s) {
  const density = s.notes.length / Math.max(1, s.totalBeats);
  const both = s.hands.R && s.hands.L;
  const chords = s.notes.length - new Set(s.notes.map((n) => n.start + n.hand)).size;
  let lvl = 1 + (density > 1.2) + (density > 2.2) + both + (chords > s.notes.length * 0.2);
  return Math.max(1, Math.min(5, lvl));
}

/** Enregistre ce que tu joues (MIDI, clavier, souris) et le transforme en partition (vélocité et pédale conservées). */
function recorderPanel() {
  let rec = null;
  const status = h('span', { class: 'muted', role: 'status' }, 'Prêt');
  const tempo = h('input', { type: 'number', value: 90, min: 30, max: 240, class: 'num', 'aria-label': 'Tempo' });
  const beats = h('select', { 'aria-label': 'Mesure' }, [[4, '4/4'], [3, '3/4'], [2, '2/4']].map(([v, l]) => h('option', { value: v }, l)));
  const gridSel = h('select', { 'aria-label': 'Quantification' }, GRIDS.map((g) => h('option', { value: g.id, selected: g.id === 'double' }, g.label)));
  const swingChk = h('input', { type: 'checkbox', checked: true });
  const autoSplit = h('input', { type: 'checkbox', checked: true });
  const splitPt = h('input', { type: 'number', min: 36, max: 84, value: 60, class: 'num', 'aria-label': 'Point de partage des mains (numéro MIDI)', oninput: () => (splitName.textContent = noteLabel(Number(splitPt.value) || 60, ctx.settings)) });
  const splitName = h('span', { class: 'small muted' }, noteLabel(60, ctx.settings));
  const kbEl = h('div', { class: 'kb small-kb' });
  const btn = h('button', { class: 'btn primary', onclick: () => (rec ? stop() : start()) }, '⏺ Enregistrer');
  const kb = new PianoKeyboard(kbEl, { onNoteOn: (m) => on(m, 0.75), onNoteOff: (m) => off(m), label: (m) => (m % 12 === 0 ? noteLabel(m, ctx.settings) : '') });
  kb.setRange(48, 84);
  const unsub = [
    midiInput.on((e) => (e.type === 'noteon' ? on(e.midi, e.velocity, true) : e.type === 'noteoff' ? off(e.midi) : e.type === 'pedal' && pedal(e.down))),
    computerKeyboard.on((e) => (e.type === 'noteon' ? (on(e.midi, e.velocity), kb.press(e.midi)) : e.type === 'noteoff' && (off(e.midi), kb.release(e.midi)))),
  ];
  onCleanup(() => { unsub.forEach((f) => f()); if (rec) stopMetronome(rec); rec = null; });
  midiInput.init().catch(() => {});
  function on(m, velocity = 0.75, fromMidi = false) {
    if (!fromMidi || ctx.settings.midiLocalSound !== false) synth.playNote(m, { dur: 3, velocity, instrument: ctx.settings.instrument });
    if (!rec) return;
    if (rec.open.has(m)) off(m, true); // note rejouée sans relâchement : on clôt la précédente
    rec.open.set(m, { t0: performance.now(), velocity });
  }
  function off(m, silent = false) {
    if (!silent) synth.releaseNote(m);
    if (!rec || !rec.open.has(m)) return;
    const o = rec.open.get(m);
    rec.notes.push({ midi: m, t0: o.t0, t1: performance.now(), velocity: o.velocity });
    rec.open.delete(m);
  }
  function pedal(down) {
    synth.setSustain(down);
    if (rec) rec.pedal.push({ t: performance.now(), down });
  }
  // métronome à part (gain dédié) : le couper à « Arrêter » coupe aussi les clics déjà planifiés
  function stopMetronome(r) {
    clearInterval(r.timer);
    try {
      const ac = synth.audioContext();
      r.gain.gain.cancelScheduledValues(ac.currentTime);
      r.gain.gain.setValueAtTime(0, ac.currentTime);
      r.oscs.forEach((o) => { try { o.stop(); } catch {} });
      setTimeout(() => r.gain.disconnect(), 100);
    } catch {}
  }
  function clickAt(r, when, accent) {
    const ac = synth.audioContext();
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.frequency.value = accent ? 1600 : 1000;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(accent ? 0.5 : 0.3, when + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
    o.connect(g).connect(r.gain);
    o.start(when);
    o.stop(when + 0.06);
    r.oscs.push(o);
    o.onended = () => { r.oscs = r.oscs.filter((x) => x !== o); };
  }
  function start() {
    const bpm = Math.max(30, Math.min(240, Number(tempo.value) || 90));
    const perBar = Number(beats.value) || 4;
    const ac = synth.audioContext();
    const gain = ac.createGain();
    gain.gain.value = ctx.settings.volume ?? 0.7;
    gain.connect(ac.destination);
    const t0 = ac.currentTime + 0.1;
    // temps 1 (après une mesure de décompte), en horloge performance.now()
    rec = { notes: [], open: new Map(), pedal: [], bpm, perBar, gain, oscs: [], t: performance.now() + 100 + (60000 / bpm) * perBar };
    let beat = 0;
    const r = rec;
    r.timer = setInterval(() => {
      while (t0 + (beat * 60) / bpm < ac.currentTime + 0.12) {
        clickAt(r, t0 + (beat * 60) / bpm, beat % perBar === 0);
        beat++;
      }
      status.textContent = r.t > performance.now() ? `Décompte… ${Math.ceil((r.t - performance.now()) / (60000 / bpm))}` : `⏺ ${(((performance.now() - r.t) / 1000) | 0)} s`;
    }, 25);
    btn.textContent = '⏹ Arrêter';
    btn.classList.add('danger');
  }
  function stop() {
    const r = rec;
    stopMetronome(r);
    for (const [m] of [...r.open]) off(m);
    synth.setSustain(false);
    rec = null;
    btn.textContent = '⏺ Enregistrer';
    btn.classList.remove('danger');
    const raw = recordingToSong(r, {
      grid: (GRIDS.find((g) => g.id === gridSel.value) || GRIDS[2]).value,
      swing: swingChk.checked ? 'auto' : false,
      splitPoint: autoSplit.checked ? null : Number(splitPt.value) || 60,
    });
    status.textContent = `${raw.notes.length} notes enregistrées${raw.swing ? ' · swing détecté' : ''}`;
    if (!raw.notes.length) return toast('Rien enregistré : joue sur un clavier MIDI, le clavier de l’ordinateur ou les touches ci-dessous.');
    const id = 'rec-' + Date.now().toString(36);
    store.saveToLibrary({ id, title: 'Mon enregistrement ' + new Date().toLocaleString('fr-FR'), composer: 'Moi', genre: 'pop', level: 1, description: 'Créé en jouant.', ...raw });
    toast('Enregistrement ajouté à ta bibliothèque ! Tu peux le corriger avec « Modifier ».');
    location.hash = '#/morceau/' + id;
  }
  return [
    h('p', { class: 'small' }, 'Joue une mélodie (clavier MIDI, clavier d’ordinateur ou souris) : l’app l’enregistre au métronome (1 mesure de décompte) et en fait une partition avec doigtés. La vélocité et la pédale du clavier MIDI sont conservées.'),
    h('div', { class: 'row wrap' }, [btn, h('label', { class: 'field' }, ['Tempo ', tempo]), h('label', { class: 'field' }, ['Mesure ', beats]), status]),
    h('div', { class: 'row wrap' }, [
      h('label', { class: 'field' }, ['Quantifier en ', gridSel]),
      h('label', { class: 'check' }, [swingChk, 'détecter le swing']),
      h('label', { class: 'check' }, [autoSplit, 'partage des mains automatique']),
      h('label', { class: 'field' }, ['sinon à partir de ', splitPt]), splitName,
    ]),
    kbEl,
  ];
}

/**
 * Enregistrement brut (temps en ms) -> morceau : quantification, pas de notes empilées au début,
 * vélocités et pédale conservées. Exporté pour les tests.
 */
export function recordingToSong(r, { grid = 0.25, swing = 'auto', splitPoint = null } = {}) {
  const spb = 60000 / r.bpm;
  const toBeat = (t) => (t - r.t) / spb;
  // les notes jouées pendant le décompte (bien avant le temps 1) sont ignorées : rien d'empilé à 0
  const rawNotes = r.notes
    .filter((n) => toBeat(n.t0) >= -0.25 && n.t1 > n.t0)
    .map((n) => ({ midi: n.midi, start: Math.max(0, toBeat(n.t0)), dur: Math.max(0.05, (n.t1 - n.t0) / spb), hand: 'R', finger: null, velocity: Math.round((n.velocity ?? 0.75) * 127) }));
  const q = quantize(rawNotes, { grid, swing });
  const sp = splitPoint ?? suggestSplitPoint(q.notes);
  const notes = splitHands(q.notes, sp).map(({ id, ...n }) => n);
  const pedal = [];
  for (const p of r.pedal || []) {
    const beat = Math.max(0, Math.round(toBeat(p.t) * 4) / 4);
    if (toBeat(p.t) < -0.25) continue;
    if (pedal.length && pedal[pedal.length - 1].down === p.down) continue;
    pedal.push({ beat, down: p.down });
  }
  const out = { tempo: r.bpm, timeSig: [r.perBar || 4, 4], notes };
  if (pedal.length) out.pedal = pedal;
  if (q.swing) out.swing = true;
  return out;
}

registerRoute(/^importer$/, withDeps(loadDeps, viewImport))
