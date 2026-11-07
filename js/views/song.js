// Vue : song
import { phrases } from '../core/song.js';
import { describePosition } from '../core/coursegen.js';
import { noteLabel } from '../core/notes.js';
import { store } from '../core/storage.js';
import { keyDiagram } from '../ui/keyboard.js';
import { h, toast, modal, download, escapeHtml, stars } from '../ui/dom.js';
import * as synth from '../audio/synth.js';
import { openShareDialog } from './share.js';
import { ctx, main, registerRoute, findSong, genreOf, levelLabel, section, startTrainer, withDeps } from '../ui/context.js';

// Modules propres à la fiche (théorie, harmonie, portée) : chargés à la première ouverture d'une fiche.
let analyzeSong, generateQuiz, voicing, FUNCTION_NAMES, keyName, progressionToText, StaffView;
async function loadFicheDeps() {
  const [theory, harmony, staff] = await Promise.all([import('../core/theory.js'), import('../core/harmony.js'), import('../ui/staff.js')]);
  ({ analyzeSong, generateQuiz } = theory);
  ({ voicing, FUNCTION_NAMES, keyName, progressionToText } = harmony);
  ({ StaffView } = staff);
}

// ---------- Fiche morceau ----------
function viewSong(id) {
  const s = findSong(id);
  if (!s) throw new Error('Ce morceau est introuvable (il a peut-être été supprimé).');
  const g = genreOf(s.genre);
  const p = store.progress()[s.id];
  const fav = store.favorites().includes(s.id);
  const favBtn = h('button', { class: 'btn' + (fav ? ' on' : ''), onclick: () => favBtn.classList.toggle('on', store.toggleFavorite(s.id)) }, '♥ Favori');
  const exportSel = h('select', { 'aria-label': 'Exporter', onchange: (e) => {
    const f = e.target.value;
    e.target.value = '';
    if (!f) return;
    import('../parsers/index.js').then(({ exportSong }) => {
      const out = exportSong(s, f);
      download(out.filename, out.data, out.mime);
    }).catch((err) => toast('Export impossible : ' + err.message));
  } }, [h('option', { value: '' }, '⬇ Exporter…'), h('option', { value: 'midi' }, 'MIDI (.mid)'), h('option', { value: 'musicxml' }, 'MusicXML (.musicxml)'), h('option', { value: 'text' }, 'Texte (.txt)'), h('option', { value: 'json' }, 'JSON')]);

  let analysis = null;
  try {
    analysis = analyzeSong(s);
  } catch (err) {
    console.error(err);
  }
  const keyNames = ['Do♭', 'Sol♭', 'Ré♭', 'La♭', 'Mi♭', 'Si♭', 'Fa', 'Do', 'Sol', 'Ré', 'La', 'Mi', 'Si', 'Fa♯', 'Do♯'];
  main.append(
    h('div', { class: 'song-header', style: `--c:${g.color}` }, [
      h('span', { class: 'emoji big' }, g.emoji),
      h('div', {}, [
        h('h1', {}, s.title),
        h('p', { class: 'muted' }, `${s.composer || 'Compositeur inconnu'} · ${g.name} · ${levelLabel(s.level)}`),
        h('div', { class: 'tags' }, [
          h('span', { class: 'tag' }, `♩ = ${s.tempo}`), h('span', { class: 'tag' }, `${s.timeSig[0]}/${s.timeSig[1]}`),
          h('span', { class: 'tag' }, `${s.measureCount} mesures`), h('span', { class: 'tag' }, `Tonalité : ${analysis ? analysis.keyName : keyNames[(s.keyFifths || 0) + 7] || '?'}`),
          h('span', { class: 'tag' }, s.hands.R && s.hands.L ? '2 mains' : s.hands.R ? 'Main droite' : 'Main gauche'),
          s.autoFingering ? h('span', { class: 'tag warn', title: 'Doigtés calculés automatiquement' }, 'doigtés suggérés') : null,
          p ? h('span', { class: 'tag ok' }, `Record : ${p.best} % ${stars(p.stars)}`) : null,
        ]),
      ]),
    ]),
    s.description ? h('p', { class: 'lead' }, s.description) : null,
    h('div', { class: 'row actions' }, [
      h('a', { class: 'btn primary big', href: `#/jouer/${encodeURIComponent(s.id)}` }, '🎯 S’entraîner'),
      h('a', { class: 'btn big', href: `#/jouer/${encodeURIComponent(s.id)}?mode=listen` }, '🔊 Écouter'),
      h('a', { class: 'btn big', href: `#/parcours/${encodeURIComponent(s.id)}` }, '📚 Cours pas à pas'),
      favBtn, exportSel,
      h('button', { class: 'btn', onclick: () => openShareDialog(s) }, '🔗 Partager'),
      h('a', { class: 'btn', href: `#/editer/${encodeURIComponent(s.id)}` }, '✏️ Modifier'),
      s.imported ? h('button', { class: 'btn danger', onclick: () => modal('Supprimer ?', `<p>Supprimer « ${escapeHtml(s.title)} » de ta bibliothèque ?</p>`, [{ label: 'Supprimer', primary: true, action: () => { store.removeFromLibrary(s.id); ctx.prepared.delete(s.id); location.hash = '#/bibliotheque'; } }, { label: 'Annuler' }]) }, '🗑 Supprimer') : null,
    ]),
  );

  // Aperçu des phrases avec touches et doigtés
  const list = h('div', { class: 'phrases' });
  phrases(s, s.measureCount <= 8 ? 2 : 4).forEach((ph, i) => {
    const staffBox = h('div', { class: 'staff-box' });
    const handsBox = h('div', { class: 'hands' });
    for (const hand of ['R', 'L']) {
      const ns = ph.notes.filter((n) => n.hand === hand);
      if (!ns.length) continue;
      const uniq = [...new Map(ns.map((n) => [n.midi, n])).values()];
      handsBox.append(h('div', { class: 'hand-col' }, [
        h('h4', {}, hand === 'R' ? '✋ Main droite' : '🤚 Main gauche'),
        keyDiagram(uniq.map((n) => ({ midi: n.midi, finger: n.finger, hand })), { labels: (m) => (m % 12 === 0 ? noteLabel(m, ctx.settings) : '') }),
        h('p', { class: 'small' }, describePosition(ns, hand, ctx.settings)),
        h('p', { class: 'seq' }, ns.slice(0, 40).map((n) => h('span', { class: 'n hand-' + hand }, [noteLabel(n.midi, { ...ctx.settings, octave: false }), h('sup', {}, n.finger || '')]))),
      ]));
    }
    list.append(h('details', { class: 'card phrase', open: i === 0, ontoggle: (e) => {
      if (e.target.open && !staffBox.firstChild) {
        const sv = new StaffView(staffBox);
        sv.render(s, ph.from, ph.to, { settings: ctx.settings, showFingers: true, showNoteNames: ctx.settings.showNoteNames });
      }
    } }, [
      h('summary', {}, [h('b', {}, `Phrase ${i + 1}`), ` — mesures ${ph.firstMeasure} à ${ph.lastMeasure}`, h('a', { class: 'btn tiny', href: `#/jouer/${encodeURIComponent(s.id)}?from=${ph.firstMeasure}&to=${ph.lastMeasure}`, onclick: (e) => e.stopPropagation() }, '🎯 Travailler')]),
      staffBox, handsBox,
    ]));
  });
  main.append(section('Touches et doigtés, phrase par phrase', list));
  if (analysis) main.append(understandSection(s, analysis));
  // première phrase : rendu de la portée
  requestAnimationFrame(() => list.querySelector('details[open]')?.dispatchEvent(new Event('toggle')));
}

// ---------- Comprendre le morceau ----------
const FUNC_LABEL = { T: 'T', SD: 'SD', D: 'D' };

function understandSection(s, an) {
  const { key, chords, cadences, structure } = an;
  const bpm = s.beatsPerMeasure;
  const facts = h('div', { class: 'theory-facts' }, [
    fact('Tonalité', `${an.keyName}`, key.source === 'estimation' ? 'estimée à partir des notes (profils de Krumhansl)' : 'd’après l’armure et les notes'),
    fact('Mesure', `${s.timeSig[0]}/${s.timeSig[1]}`, `${s.timeSig[0]} temps par mesure${s.timeSig[1] === 8 ? ' (temps en croches)' : ''}`),
    fact('Carrure', `phrases de ${structure.phraseLength} mesures`, `${structure.square ? 'carrure régulière' : 'carrure irrégulière'}${structure.pickup ? ' · avec levée' : ''} · forme ${structure.form}`),
    fact('Cadences', cadences.length ? String(cadences.length) : 'aucune nette', cadences.length ? [...new Set(cadences.map((c) => c.type))].join(', ') : 'pas de cadence claire repérée'),
  ]);
  // accords par mesure
  const byMeasure = new Map();
  for (const c of chords) {
    if (!byMeasure.has(c.measure)) byMeasure.set(c.measure, []);
    byMeasure.get(c.measure).push(c);
  }
  const cadAt = new Map(cadences.map((c) => [c.measure, c]));
  const grid = h('div', { class: 'chord-grid song-chords', role: 'list', 'aria-label': 'Accords par mesure' });
  for (let m = 0; m < s.measureCount; m++) {
    const cs = byMeasure.get(m) || [];
    const cad = cadAt.get(m);
    const cell = h('div', { class: 'grid-cell' + (cad ? ' cadence' : ''), role: 'listitem', title: cad ? cad.label : '' }, [h('span', { class: 'grid-num' }, String(m + 1))]);
    for (const c of cs) {
      cell.append(h('button', {
        class: 'grid-chord' + (c.func ? ' f-' + c.func : '') + (c.confidence < 0.55 ? ' unsure' : ''),
        title: `${c.symbol}${c.roman ? ' · ' + c.roman : ''}${c.func ? ' · ' + FUNCTION_NAMES[c.func] : ''}${c.source === 'analyse' ? ` · confiance ${Math.round(c.confidence * 100)} %` : ''} — clic pour écouter`,
        onclick: () => {
          const v = voicing(c.symbol, { type: 'root', center: 62, bassCenter: 43 });
          if (v.bass != null) synth.playNote(v.bass, { dur: 1.2, instrument: ctx.settings.instrument });
          v.notes.forEach((n) => synth.playNote(n, { dur: 1.2, instrument: ctx.settings.instrument }));
        },
      }, [h('b', {}, c.symbol), c.roman ? h('small', {}, c.roman) : null]));
    }
    if (cad) cell.append(h('span', { class: 'cad-tag' }, cad.type));
    if (!cs.length) cell.append(h('span', { class: 'muted small' }, '—'));
    grid.append(cell);
  }
  const gridText = progressionToText(Array.from({ length: s.measureCount }, (_, m) => ({ chords: (byMeasure.get(m) || []).map((c) => ({ symbol: c.symbol.replace(/\/.*$/, ''), beats: 1 })) })).filter((m) => m.chords.length));
  const legend = h('p', { class: 'small muted' }, [
    'Degrés : chiffres romains (majuscule = accord majeur, minuscule = mineur). Couleurs : ',
    h('span', { class: 'f-T legend' }, 'tonique'), ' ', h('span', { class: 'f-SD legend' }, 'sous-dominante'), ' ', h('span', { class: 'f-D legend' }, 'dominante'),
    chords.some((c) => c.source === 'analyse') ? '. Accords déduits automatiquement des notes (surtout de la main gauche) : c’est une aide, pas une vérité absolue.' : '.',
  ]);
  const cadList = cadences.length ? h('ul', { class: 'small cad-list' }, cadences.map((c) => h('li', {}, [c.label, ' ', h('a', { class: 'btn tiny', href: `#/jouer/${encodeURIComponent(s.id)}?from=${Math.max(1, c.measure)}&to=${c.measure + 1}` }, 'Travailler')]))) : null;
  const sections = h('p', { class: 'small' }, ['Structure : ', ...structure.sections.map((x) => h('span', { class: 'tag' }, `${x.label} m.${x.from + 1}–${x.to + 1}`))]);

  // quiz
  const quizBox = h('div', { class: 'quiz' });
  let seed = 1;
  const renderQuiz = () => {
    quizBox.innerHTML = '';
    let qs;
    try {
      qs = generateQuiz(s, { seed, count: 6, analysis: an });
    } catch (err) {
      quizBox.append(h('p', { class: 'muted' }, 'Quiz indisponible pour ce morceau.'));
      return;
    }
    let score = 0, answered = 0;
    const scoreEl = h('p', { class: 'small', 'aria-live': 'polite' }, `0 / ${qs.length}`);
    qs.forEach((q, i) => {
      const expl = h('p', { class: 'small quiz-expl', hidden: true }, q.explain);
      const btns = q.choices.map((c, k) => h('button', { class: 'btn quiz-choice', onclick: () => {
        if (btns.some((b) => b.disabled)) return;
        btns.forEach((b, j) => { b.disabled = true; if (j === q.answer) b.classList.add('ok'); });
        if (k === q.answer) score++;
        else btns[k].classList.add('bad');
        answered++;
        expl.hidden = false;
        scoreEl.textContent = `${score} / ${qs.length}${answered === qs.length ? (score === qs.length ? ' — parfait ! 🎉' : ' — bien joué !') : ''}`;
      } }, c));
      const listen = q.notes ? h('button', { class: 'btn tiny', 'aria-label': 'Écouter les notes', onclick: () => {
        const ac = synth.audioContext();
        q.notes.forEach((m, j) => synth.playNote(m, { when: ac.currentTime + j * 0.5, dur: 0.45, instrument: ctx.settings.instrument }));
      } }, '🔊') : null;
      quizBox.append(h('div', { class: 'quiz-q card' }, [h('p', {}, [h('b', {}, `${i + 1}. `), q.prompt, ' ', listen]), h('div', { class: 'row wrap' }, btns), expl]));
    });
    quizBox.append(h('div', { class: 'row' }, [scoreEl, h('button', { class: 'btn tiny', onclick: () => { seed++; renderQuiz(); } }, '🔄 Nouveau quiz')]));
  };
  renderQuiz();

  return section('🧠 Comprendre le morceau', [
    facts,
    h('h3', {}, 'Accords mesure par mesure'), legend, grid,
    h('div', { class: 'row' }, [h('a', { class: 'btn tiny', href: `#/accords?grille=${encodeURIComponent(gridText)}&tempo=${s.tempo}` }, '🎹 Jouer cette grille d’accords')]),
    sections,
    cadList ? h('h3', {}, 'Cadences') : null, cadList,
    h('h3', {}, 'Quiz'), quizBox,
  ], 'understand');
}

function fact(label, value, sub) {
  return h('div', { class: 'stat-card theory-fact' }, [h('small', {}, label), h('b', {}, value), h('small', { class: 'muted' }, sub)]);
}

// ---------- Jouer ----------
function viewPlay(id, query) {
  const s = findSong(id);
  if (!s) throw new Error('Morceau introuvable.');
  startTrainer(s, query, { back: `#/morceau/${encodeURIComponent(id)}` });
}


registerRoute(/^morceau\/(.+)$/, withDeps(loadFicheDeps, viewSong))
registerRoute(/^jouer\/(.+)$/, viewPlay)
