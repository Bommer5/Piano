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
let importScoreFile, importScoreText, SUPPORTED_FORMATS, StaffView, transcriptionToSong;
async function loadDeps() {
  const [m0, m1, m2] = await Promise.all([import('../parsers/index.js'), import('../ui/staff.js'), import('../core/transcribe.js')]);
  ({ importScoreFile, importScoreText, SUPPORTED_FORMATS } = m0);
  ({ StaffView } = m1);
  transcriptionToSong = m2.toRawSong;
}

/** Résumé en une phrase de ce que l'import a compris (« 2 mains, 32 mesures, reprises dépliées… »). */
export function importSummary(s, raw = {}) {
  const parts = [`${s.notes.length} notes`, s.hands.R && s.hands.L ? '2 mains' : '1 main', `${s.measureCount} mesure${s.measureCount > 1 ? 's' : ''} à ${s.timeSig[0]}/${s.timeSig[1]}`];
  for (const d of raw.importReport?.details || []) parts.push(d);
  parts.push(s.autoFingering ? 'doigtés calculés automatiquement' : 'doigtés de la partition');
  return parts.join(' · ');
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
        showPreview(raw, file.name, file);
      } catch (err) {
        wait.remove();
        showError(err, file.name);
      }
    }
  }

  function showError(err, name) {
    result.prepend(h('div', { class: 'card error' }, [h('b', {}, name ? `Impossible d’importer « ${name} »` : 'Import impossible'), h('p', {}, err.message || String(err))]));
  }

  function showPreview(raw, name, file) {
    const id = 'imp-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const analysis = raw.transcribed ? raw.analysis : null; // résultat de l'analyse audio : permet de requantifier
    const tune = { tempoScale: 1, grid: 0, timeSig: null, hands: 'both', octave: 0, shift: 0 };
    let cur = raw; // morceau brut courant (refait à chaque réglage rapide)
    let s;
    const build = () => {
      if (analysis) {
        const opts = { title: raw.title, composer: raw.composer, tempoScale: tune.tempoScale, hands: tune.hands, octave: tune.octave, shift: tune.shift };
        if (tune.grid) opts.grid = tune.grid;
        if (tune.timeSig) opts.timeSig = tune.timeSig;
        cur = { ...transcriptionToSong(analysis, opts), source: raw.source };
      }
      return prepareSong({ ...cur, id });
    };
    try {
      s = build();
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
    const split = h('div', { class: 'row' }, [h('label', { class: 'check' }, [h('input', { type: 'checkbox', checked: !s.hands.L && !analysis }), 'Répartir les mains à partir de']), splitPt, splitName]);
    const staffBox = h('div', { class: 'staff-box' });
    const info = h('p', { class: 'import-summary' });
    const pageLabel = h('span', { class: 'small muted', role: 'status' });
    let page = 0;
    const staff = new StaffView(staffBox);
    const perPage = () => s.beatsPerMeasure * 4;
    const pages = () => Math.max(1, Math.ceil(s.totalBeats / perPage() - 1e-6));
    const prevBtn = h('button', { class: 'btn small', 'aria-label': 'Mesures précédentes', onclick: () => { page = Math.max(0, page - 1); draw(); } }, '◀');
    const nextBtn = h('button', { class: 'btn small', 'aria-label': 'Mesures suivantes', onclick: () => { page = Math.min(pages() - 1, page + 1); draw(); } }, '▶');
    function draw() {
      page = Math.min(page, pages() - 1);
      const from = page * perPage(), to = Math.min(s.totalBeats, from + perPage());
      staff.render(s, from, to, { settings: ctx.settings, showFingers: true });
      for (const n of s.notes) if (n.uncertain) staff.mark(n.id, 'uncertain');
      const m0 = page * 4 + 1;
      pageLabel.textContent = `Mesures ${m0} à ${Math.min(s.measureCount, m0 + 3)} sur ${s.measureCount}`;
      prevBtn.disabled = page === 0;
      nextBtn.disabled = page >= pages() - 1;
    }

    // --- transcription audio : confiance, écoute comparée, réglages rapides ---
    const conf = h('div', { class: 'import-conf' });
    const tuneState = h('span', { class: 'small muted', role: 'status' });
    let player = null; // { stop() }
    const stopPlayer = () => { if (player) player.stop(); player = null; origBtn.textContent = '▶ Écouter l’original'; transBtn.textContent = '▶ Écouter la transcription'; };
    const audioUrl = analysis && file && typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(file) : null;
    const audioEl = audioUrl ? new Audio(audioUrl) : null;
    if (audioEl) audioEl.addEventListener('ended', () => stopPlayer());
    // seconde de l'enregistrement qui correspond à un temps de la partition affichée
    const secOfBeat = (beat) => {
      const bt = analysis.beatTimes || [];
      if (bt.length < 2) return 0;
      const x = Math.max(0, (beat - tune.shift) / tune.tempoScale);
      const i = Math.min(bt.length - 2, Math.floor(x));
      return Math.max(0, bt[i] + (x - i) * (bt[i + 1] - bt[i]));
    };
    const origBtn = h('button', { class: 'btn', disabled: !audioEl, onclick: () => {
      const was = player && player.kind === 'orig';
      stopPlayer();
      if (was) return;
      audioEl.currentTime = Math.max(0, secOfBeat(page * perPage()) - 0.15);
      audioEl.play().catch(() => toast('Lecture de l’enregistrement impossible sur cet appareil.'));
      player = { kind: 'orig', stop: () => audioEl.pause() };
      origBtn.textContent = '⏹ Arrêter';
    } }, '▶ Écouter l’original');
    const transBtn = h('button', { class: 'btn', onclick: () => {
      const was = player && player.kind === 'trans';
      stopPlayer();
      if (was) return;
      const from = page * perPage();
      const spb = 60 / (Number(tempo.value) || s.tempo);
      const queue = s.notes.filter((n) => n.start >= from - 1e-6).sort((a, b) => a.start - b.start);
      const ac = synth.audioContext();
      const t0 = ac.currentTime + 0.15;
      let i = 0;
      const tick = () => {
        while (i < queue.length && t0 + (queue[i].start - from) * spb < ac.currentTime + 0.4) {
          const n = queue[i++];
          synth.playNote(n.midi, { when: t0 + (n.start - from) * spb, dur: Math.min(4, n.dur * spb), velocity: (n.velocity || 90) / 127, instrument: ctx.settings.instrument });
        }
        if (i >= queue.length && ac.currentTime > t0 + (s.totalBeats - from) * spb) stopPlayer();
      };
      const timer = setInterval(tick, 60);
      tick();
      player = { kind: 'trans', stop: () => { clearInterval(timer); synth.stopAll(); } };
      transBtn.textContent = '⏹ Arrêter';
    } }, '▶ Écouter la transcription');
    onCleanup(() => { stopPlayer(); if (audioUrl) URL.revokeObjectURL(audioUrl); });

    function drawConf() {
      const t = cur.transcription || {};
      const pct = Math.round((t.confidence || 0) * 100);
      const cls = pct >= 90 ? 'good' : pct >= 75 ? 'mid' : 'low';
      const unc = s.notes.filter((n) => n.uncertain).length;
      conf.replaceChildren(
        h('div', { class: 'import-conf-head ' + cls }, [h('b', {}, `Reconnu à ${pct} %`), h('span', { class: 'small' }, pct >= 90 ? 'Très fiable' : pct >= 75 ? 'À vérifier à l’oreille' : 'Enregistrement difficile : vérifie bien')]),
        h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct, 'aria-label': 'Confiance de la reconnaissance' }, h('div', { class: 'fill ' + cls, style: `width:${pct}%` })),
        h('p', { class: 'small' }, [
          unc ? h('span', {}, [h('span', { class: 'uncertain-dot', 'aria-hidden': 'true' }), ` ${unc} note${unc > 1 ? 's' : ''} incertaine${unc > 1 ? 's' : ''} (en orange sur la portée). `]) : 'Aucune note incertaine. ',
          `Tonalité : ${t.keyName || '?'}.`,
          t.tuningCents ? ` Piano accordé ${t.tuningCents > 0 ? '+' : ''}${t.tuningCents} cents.` : '',
        ]),
      );
    }
    function retune(change) {
      Object.assign(tune, change);
      stopPlayer();
      try {
        s = build();
      } catch (err) {
        return toast(err.message || String(err));
      }
      tempo.value = Math.round(s.tempo);
      refresh();
    }
    const seg = (label, options, get, set) => {
      const box = h('div', { class: 'seg', role: 'group', 'aria-label': label });
      const paint = () => [...box.children].forEach((b, i) => { const on = get() === options[i][0]; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      for (const [value, text] of options) box.append(h('button', { class: 'seg-btn', type: 'button', onclick: () => { set(value); paint(); } }, text));
      paint();
      return h('div', { class: 'import-tune-row' }, [h('span', { class: 'import-tune-label' }, label), box]);
    };
    const sigKey = () => (tune.timeSig ? tune.timeSig.join('/') : 'auto');
    const tunePanel = analysis ? h('div', { class: 'import-tune' }, [
      h('h4', {}, 'Réglages rapides'),
      h('p', { class: 'small muted' }, 'Si la partition ne ressemble pas à ce que tu entends, essaie ces réglages : le résultat se met à jour tout de suite.'),
      h('div', { class: 'import-tune-row' }, [h('span', { class: 'import-tune-label' }, 'Tempo'), h('div', { class: 'row' }, [
        h('button', { class: 'btn small', type: 'button', onclick: () => retune({ tempoScale: tune.tempoScale / 2 }) }, '÷ 2'),
        h('button', { class: 'btn small', type: 'button', onclick: () => retune({ tempoScale: tune.tempoScale * 2 }) }, '× 2'),
        tuneState,
      ])]),
      seg('Notes les plus courtes', [[0, 'Auto'], [0.5, 'Croches'], [0.25, 'Doubles'], [1 / 3, 'Triolets']], () => tune.grid, (v) => retune({ grid: v })),
      seg('Mesure', [['auto', 'Auto'], ['2/4', '2/4'], ['3/4', '3/4'], ['4/4', '4/4'], ['6/8', '6/8']], sigKey, (v) => retune({ timeSig: v === 'auto' ? null : v.split('/').map(Number) })),
      seg('Mains', [['both', 'Deux mains'], ['melody', 'Mélodie seule']], () => tune.hands, (v) => retune({ hands: v })),
      h('div', { class: 'import-tune-row' }, [h('span', { class: 'import-tune-label' }, 'Octave'), h('div', { class: 'row' }, [
        h('button', { class: 'btn small', type: 'button', 'aria-label': 'Une octave plus bas', onclick: () => retune({ octave: Math.max(-3, tune.octave - 1) }) }, '− 1'),
        h('button', { class: 'btn small', type: 'button', 'aria-label': 'Une octave plus haut', onclick: () => retune({ octave: Math.min(3, tune.octave + 1) }) }, '+ 1'),
      ])]),
      h('div', { class: 'import-tune-row' }, [h('span', { class: 'import-tune-label' }, 'Premier temps'), h('div', { class: 'row' }, [
        h('button', { class: 'btn small', type: 'button', 'aria-label': 'Décaler les notes d’un temps plus tôt', onclick: () => retune({ shift: tune.shift - 1 }) }, '◀ 1 temps'),
        h('button', { class: 'btn small', type: 'button', 'aria-label': 'Décaler les notes d’un temps plus tard', onclick: () => retune({ shift: tune.shift + 1 }) }, '1 temps ▶'),
      ])]),
    ]) : null;

    function refresh() {
      info.textContent = importSummary(s, cur);
      if (analysis) {
        drawConf();
        const bits = [`♩ = ${Math.round(s.tempo)}`];
        if (tune.octave) bits.push(`${tune.octave > 0 ? '+' : ''}${tune.octave} octave${Math.abs(tune.octave) > 1 ? 's' : ''}`);
        if (tune.shift) bits.push(`décalé de ${tune.shift > 0 ? '+' : ''}${tune.shift} temps`);
        tuneState.textContent = bits.join(' · ');
      }
      draw();
    }
    const warnings = (raw.importReport?.warnings || []).map((w) => h('li', {}, w));
    const card = h('div', { class: 'card preview' }, [
      h('h3', {}, (raw.transcribed ? '🎧 Musique transcrite' : '✅ Partition lue') + (name ? ` : ${name}` : '')),
      analysis ? conf : raw.transcribed ? h('div', { class: 'block warning', html: '⚠️ Partition obtenue par <b>transcription automatique</b> de l’audio : elle peut contenir des erreurs. Écoute-la et ajuste le tempo avant de l’ajouter.' }) : null,
      info,
      warnings.length ? h('div', { class: 'block warning import-warnings' }, [h('b', {}, 'À savoir'), h('ul', {}, warnings)]) : null,
      analysis ? h('div', { class: 'row import-listen' }, [origBtn, transBtn]) : null,
      staffBox,
      h('div', { class: 'row import-pager' }, [prevBtn, pageLabel, nextBtn]),
      tunePanel,
      h('div', { class: 'form-grid' }, [h('label', {}, ['Titre', title]), h('label', {}, ['Compositeur', composer]), h('label', {}, ['Tempo (♩/min)', tempo]), h('label', {}, ['Genre', genre]), h('label', {}, ['Niveau', level])]),
      split,
      analysis ? h('p', { class: 'small muted' }, 'Une note fausse ou manquante ? Ajoute le morceau puis corrige-le note par note dans l’éditeur.') : null,
      h('div', { class: 'row' }, [
        h('button', { class: 'btn primary', onclick: () => save() }, '💾 Ajouter à ma bibliothèque'),
        h('button', { class: 'btn', onclick: () => save(true) }, '✏️ Corriger note par note'),
        h('button', { class: 'btn', onclick: () => { stopPlayer(); card.remove(); } }, 'Annuler'),
      ]),
    ]);
    result.prepend(card);
    info.textContent = importSummary(s, cur);
    if (analysis) drawConf();
    requestAnimationFrame(refresh);

    function save(edit = false) {
      stopPlayer();
      let notes = dedupe(s.notes.map((n) => ({ ...n, finger: s.autoFingering ? null : n.finger })));
      if (split.querySelector('input').checked) notes = splitHands(notes, Number(splitPt.value) || 60).map((n) => ({ ...n, finger: null }));
      const out = { ...toRawSong(s, notes), id: s.id, title: title.value || 'Sans titre', composer: composer.value || 'Inconnu', tempo: Number(tempo.value) || s.tempo, timeSig: s.timeSig, keyFifths: s.keyFifths || 0, genre: genre.value, level: Number(level.value), description: raw.transcribed ? 'Transcription d’un enregistrement.' : 'Partition importée.' };
      if (!store.saveToLibrary(out)) return toast('Espace de stockage plein : supprime d’anciens imports.');
      ctx.prepared.delete(out.id);
      toast(edit ? 'Partition ajoutée : corrige-la ici, note par note.' : 'Partition ajoutée ! Un cours pas à pas a été créé pour elle.');
      location.hash = edit ? `#/editer/${out.id}` : `#/morceau/${out.id}`;
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
