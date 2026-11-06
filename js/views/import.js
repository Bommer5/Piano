// Vue : import
import { GENRES, SONGS, getSong } from '../data/songs.js';
import { COURSES, getCourse, getLesson } from '../data/lessons.js';
import { prepareSong, phrases, parseTrack } from '../core/song.js';
import { generateSongCourse, describePosition } from '../core/coursegen.js';
import { noteLabel, midiToName, nameToMidi, centsOff, midiToFreq } from '../core/notes.js';
import { estimateNotes } from '../core/spectrum.js';
import { PitchSmoother } from '../core/onset.js';
import { store, DEFAULT_SETTINGS, localDate } from '../core/storage.js';
import { importScoreFile, importScoreText, SUPPORTED_FORMATS, exportSong } from '../parsers/index.js';
import { keyDiagram, PianoKeyboard } from '../ui/keyboard.js';
import { StaffView } from '../ui/staff.js';
import { h, toast, modal, download, escapeHtml, stars } from '../ui/dom.js';
import * as synth from '../audio/synth.js';
import { mic } from '../audio/mic.js';
import { midiInput, computerKeyboard } from '../audio/midi-input.js';
import { ctx, main, onCleanup, registerRoute, findSong, allSongs, genreOf, levelLabel, applyTheme, section, statCard, songCard, startTrainer, settingsSections, homeSections } from '../ui/context.js';

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
    section('Formats acceptés', [formats, h('div', { class: 'block tip', html: '💡 <b>Partition papier ou PDF ?</b> La reconnaissance optique de partitions demande un logiciel spécialisé. Utilise gratuitement <b>MuseScore 4</b> (Fichier → Importer PDF) ou <b>Audiveris</b>, puis exporte en <b>MusicXML</b> et importe-le ici. Tu peux aussi trouver des milliers de partitions libres en MusicXML/MIDI sur <b>IMSLP</b>, <b>MuseScore.com</b> (domaine public) ou <b>Mutopia</b>.' })]),
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
    const split = h('label', { class: 'check' }, [h('input', { type: 'checkbox', checked: !s.hands.L }), 'Répartir les mains au Do central']);
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
      let notes = s.notes.map(({ midi, start, dur, hand, finger }) => ({ midi, start, dur, hand, finger: s.autoFingering ? null : finger }));
      if (split.querySelector('input').checked) notes = notes.map((n) => ({ ...n, hand: n.midi >= 60 ? 'R' : 'L', finger: null }));
      const out = { id: s.id, title: title.value || 'Sans titre', composer: composer.value || 'Inconnu', tempo: Number(tempo.value) || s.tempo, timeSig: s.timeSig, keyFifths: s.keyFifths || 0, genre: genre.value, level: Number(level.value), description: 'Partition importée.', notes };
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

/** Enregistre ce que tu joues (MIDI, clavier, souris) et le transforme en partition. */
function recorderPanel() {
  let rec = null;
  const status = h('span', { class: 'muted' }, 'Prêt');
  const tempo = h('input', { type: 'number', value: 90, min: 30, max: 240, class: 'num', 'aria-label': 'Tempo' });
  const kbEl = h('div', { class: 'kb small-kb' });
  const btn = h('button', { class: 'btn primary', onclick: () => (rec ? stop() : start()) }, '⏺ Enregistrer');
  const kb = new PianoKeyboard(kbEl, { onNoteOn: (m) => on(m), onNoteOff: (m) => off(m), label: (m) => (m % 12 === 0 ? noteLabel(m, ctx.settings) : '') });
  kb.setRange(48, 84);
  const unsub = [midiInput.on((e) => (e.type === 'noteon' ? on(e.midi) : e.type === 'noteoff' && off(e.midi))), computerKeyboard.on((e) => (e.type === 'noteon' ? (on(e.midi), kb.press(e.midi)) : e.type === 'noteoff' && (off(e.midi), kb.release(e.midi))))];
  onCleanup(() => { unsub.forEach((f) => f()); clearInterval(rec?.timer); });
  midiInput.init().catch(() => {});
  function on(m) {
    synth.playNote(m, { dur: 3, instrument: ctx.settings.instrument });
    if (rec) rec.open.set(m, performance.now());
  }
  function off(m) {
    synth.releaseNote(m);
    if (!rec || !rec.open.has(m)) return;
    rec.notes.push({ midi: m, t0: rec.open.get(m), t1: performance.now() });
    rec.open.delete(m);
  }
  function start() {
    const bpm = Number(tempo.value) || 90;
    rec = { notes: [], open: new Map(), t: 0, bpm };
    // métronome planifié au fil de l'eau (s'arrête avec l'enregistrement)
    let beat = 0;
    const ac = synth.audioContext();
    const t0 = ac.currentTime + 0.05;
    rec.t = performance.now() + 50 + (60000 / bpm) * 4;
    rec.timer = setInterval(() => {
      while (t0 + (beat * 60) / bpm < ac.currentTime + 0.2) {
        synth.click(t0 + (beat * 60) / bpm, beat % 4 === 0);
        beat++;
      }
      status.textContent = rec.t > performance.now() ? 'Décompte…' : `⏺ ${(((performance.now() - rec.t) / 1000) | 0)} s`;
    }, 50);
    btn.textContent = '⏹ Arrêter';
    btn.classList.add('danger');
  }
  function stop() {
    clearInterval(rec.timer);
    synth.stopAll();
    for (const [m] of rec.open) off(m);
    const spb = 60000 / rec.bpm;
    const q = (x) => Math.round(x * 4) / 4;
    // les notes jouées pendant le décompte (avant le temps 1) sont ignorées
    const notes = rec.notes.filter((n) => n.t0 >= rec.t - spb * 0.25).map((n) => ({ midi: n.midi, start: Math.max(0, q((n.t0 - rec.t) / spb)), dur: Math.max(0.25, q((n.t1 - n.t0) / spb)), hand: n.midi >= 60 ? 'R' : 'L' }));
    btn.textContent = '⏺ Enregistrer';
    btn.classList.remove('danger');
    status.textContent = `${notes.length} notes enregistrées`;
    const bpm = rec.bpm;
    rec = null;
    if (!notes.length) return toast('Rien enregistré : joue sur un clavier MIDI, le clavier de l’ordinateur ou les touches ci-dessous.');
    const id = 'rec-' + Date.now().toString(36);
    store.saveToLibrary({ id, title: 'Mon enregistrement ' + new Date().toLocaleString('fr-FR'), composer: 'Moi', tempo: bpm, timeSig: [4, 4], genre: 'pop', level: 1, description: 'Créé en jouant.', notes });
    toast('Enregistrement ajouté à ta bibliothèque !');
    location.hash = '#/morceau/' + id;
  }
  return [h('p', { class: 'small' }, 'Joue une mélodie (clavier MIDI, clavier d’ordinateur ou souris) : l’app l’enregistre au métronome (1 mesure de décompte) et en fait une partition avec doigtés.'), h('div', { class: 'row' }, [btn, h('label', { class: 'field' }, ['Tempo ', tempo]), status]), kbEl];
}

registerRoute(/^importer$/, viewImport)
