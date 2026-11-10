// Import de partitions au format ABC (https://abcnotation.com/wiki/abc:standard:v2.1).
//
// Pris en charge : en-têtes X T C M L Q K (et champs en ligne [K:..] [M:..] [L:..] [Q:..] [V:..]),
// armures avec modes (maj, min, m, ion, dor, phr, lyd, mix, aeo, loc) et altérations explicites,
// altérations ^ ^^ _ __ = valables jusqu'à la barre de mesure, octaves ' et , , durées (A2, A/2,
// A/, A3/2, A//), silences z x Z X, accords [CEG], liaisons -, rythmes pointés > < >> <<,
// n-olets (3 (p:q:r, symboles d'accords "..." ignorés, ornements !..! et +..+ ignorés (sauf
// doigtés !1!..!5!), notes d'ornement {..} ignorées, barres et reprises (lues linéairement, sans
// répétition), voix multiples (V:1 → main droite, V:2 → main gauche, suivantes selon la hauteur
// moyenne), superposition de voix & (approximative), M:C et M:C|. Seul le premier morceau (X:) est lu.
// Notation conservée : symboles d'accords "Am7" → song.chords, nuances !p! !mf! !ff!… et soufflets
// !<(! !<)! !crescendo(! !diminuendo)! → song.dynamics, Q: multiples → song.tempoMap, mode mineur
// → song.keyMode, liaisons de phrasé ( ) → note.slur, articulations . !staccato! !accent! !tenuto!.

const r6 = (x) => Math.round(x * 1e6) / 1e6;
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MAJOR_FIFTHS = {
  C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7,
  F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7,
  'G#': 8, 'D#': 9, 'A#': 10, 'E#': 11, 'B#': 12, Fb: -8,
};
const MODES = { maj: 0, ion: 0, min: -3, m: -3, aeo: -3, dor: -2, phr: -4, lyd: 1, mix: -1, loc: -5 };
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const DYNAMICS = new Set(['pppp', 'ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'ffff', 'sfz', 'sf', 'fp', 'rfz']);
const ARTIC = { staccato: 'staccato', '.': 'staccato', accent: 'accent', '>': 'accent', emphasis: 'accent', tenuto: 'tenuto', wedge: 'staccatissimo', marcato: 'marcato', '^': 'marcato' };

function abcError(msg, line) {
  return new Error(`Partition ABC invalide${line ? ` (ligne ${line})` : ''} : ${msg}`);
}

function parseFraction(s) {
  const m = String(s).trim().match(/^(\d+)\s*\/\s*(\d+)$/);
  if (m && +m[2] > 0) return +m[1] / +m[2];
  const v = Number(String(s).trim());
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** M: → {timeSig, value (fraction de ronde)} ou null pour « none ». */
function parseMeter(s) {
  const v = String(s).trim();
  if (/^C\|$/.test(v)) return { timeSig: [2, 2], value: 1 };
  if (/^C$/.test(v)) return { timeSig: [4, 4], value: 1 };
  const m = v.match(/^\(?([\d+\s]+)\)?\s*\/\s*(\d+)/);
  if (m) {
    const n = m[1].split('+').reduce((a, b) => a + (parseInt(b, 10) || 0), 0);
    const d = parseInt(m[2], 10);
    if (n > 0 && d > 0) return { timeSig: [n, d], value: n / d };
  }
  return null;
}

/** K: → {fifths, acc: {letter: alter}} (null si pas de tonalité lisible). */
function parseKey(s) {
  let v = String(s).replace(/%.*$/, '').trim();
  // retire les paramètres clef=, middle=, transpose=, etc.
  v = v.replace(/\b[a-z]+\s*=\s*\S+/gi, '').trim();
  const res = { fifths: 0, acc: {}, hasTonic: false };
  if (!v || /^(bass|treble|alto|tenor|perc)\d?\b/i.test(v)) return applyFifths(res);
  if (/^(none|hp)\b/i.test(v)) {
    res.hasTonic = true;
    if (/^hp/i.test(v)) res.fifths = 2; // cornemuse : F# C# (approximatif)
    return applyFifths(res);
  }
  const m = v.match(/^([A-Ga-g])([#b]?)\s*([A-Za-z]*)\s*(.*)$/);
  if (!m) return applyFifths(res);
  res.hasTonic = true;
  const tonic = m[1].toUpperCase() + m[2];
  const modeStr = m[3].toLowerCase();
  let mode = 0;
  if (modeStr) {
    const k = modeStr === 'm' ? 'm' : modeStr.slice(0, 3);
    if (k in MODES) mode = MODES[k];
    else if (!/^(exp|bass|treble|alto|tenor)/.test(modeStr)) mode = 0;
  }
  let f = (MAJOR_FIFTHS[tonic] ?? 0) + mode;
  if (mode === -3) res.mode = 'minor';
  else if (mode === 0) res.mode = 'major';
  res.fifths = Math.max(-7, Math.min(7, f));
  applyFifths(res);
  const explicit = /\bexp\b/i.test(v);
  if (explicit) res.acc = {};
  // altérations explicites ajoutées à l'armure : ^f _b =c
  for (const am of String(m[4] + ' ').matchAll(/(\^\^|\^|__|_|=)([A-Ga-g])/g)) {
    const alt = { '^': 1, '^^': 2, _: -1, __: -2, '=': 0 }[am[1]];
    res.acc[am[2].toUpperCase()] = alt;
  }
  return res;
}

function applyFifths(res) {
  res.acc = {};
  const f = res.fifths;
  if (f > 0) for (let k = 0; k < f; k++) res.acc[SHARP_ORDER[k]] = 1;
  if (f < 0) for (let k = 0; k < -f; k++) res.acc[SHARP_ORDER[6 - k]] = -1;
  return res;
}

/** Q: → tempo en noires par minute. */
function parseTempo(s, unitL) {
  let v = String(s).replace(/"[^"]*"/g, ' ').trim();
  const m = v.match(/^(.*?)=\s*(\d+(?:\.\d+)?)/);
  if (m) {
    const bpm = parseFloat(m[2]);
    let units = 0;
    const lhs = m[1].trim();
    if (/^C\d*$/i.test(lhs) || !lhs) units = unitL * (parseInt(lhs.slice(1), 10) || 1);
    else for (const fr of lhs.split(/\s+/)) units += parseFraction(fr) || 0;
    if (!units) units = 0.25;
    return bpm * units * 4;
  }
  const n = v.match(/^(\d+(?:\.\d+)?)$/);
  if (n) return parseFloat(n[1]) * unitL * 4;
  return null;
}

/**
 * Analyse un texte ABC.
 * @param {string} text
 * @returns {object} morceau brut pour prepareSong
 */
export function parseABC(text) {
  if (typeof text !== 'string') throw abcError('le contenu doit être du texte.');
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const song = { notes: [] };

  let meter = { timeSig: [4, 4], value: 1 };
  let meterSet = false;
  let unitL = null; // longueur unité (fraction de ronde)
  let key = applyFifths({ fifths: 0, acc: {} });
  let inBody = false;
  let seenX = false;
  let tempoStr = null;
  let tuneStarted = false;

  const chordMarks = [];
  const dynMarks = [];
  const tempoMarks = [];
  const openWedges = [];
  const voices = new Map(); // id -> voix
  const voiceOrder = [];
  const getVoice = (id, decl = '') => {
    if (!voices.has(id)) {
      voices.set(id, {
        id,
        time: 0,
        barStart: 0,
        overlayMax: 0,
        barAcc: {},
        ties: new Map(),
        tuplet: null,
        broken: null,
        lastEvent: null,
        notes: [],
      });
      voiceOrder.push(id);
    }
    return voices.get(id);
  };
  let voice = null;
  const curVoice = () => voice || (voice = voiceOrder.length ? voices.get(voiceOrder[0]) : getVoice('1'));

  const beatsPerUnit = () => (unitL ?? defaultL()) * 4;
  const defaultL = () => (meterSet && meter.value < 0.75 ? 1 / 16 : 1 / 8);

  const handleField = (f, val, lineNo) => {
    switch (f) {
      case 'X':
        break;
      case 'T':
        if (!song.title && val.trim()) song.title = val.trim();
        break;
      case 'C':
        if (!song.composer && val.trim()) song.composer = val.trim();
        break;
      case 'M': {
        const mm = parseMeter(val);
        if (mm) {
          meter = mm;
          if (!song.timeSig) song.timeSig = mm.timeSig;
        }
        meterSet = true;
        break;
      }
      case 'L': {
        const l = parseFraction(val);
        if (!l) throw abcError(`longueur unité « L:${val} » invalide`, lineNo);
        unitL = l;
        break;
      }
      case 'Q':
        if (!inBody) tempoStr = val;
        else {
          const t = parseTempo(val, unitL ?? defaultL());
          if (t > 0) {
            if (song.tempo === undefined) song.tempo = r6(t);
            tempoMarks.push({ beat: r6(curVoice().time), bpm: r6(t) });
          }
        }
        break;
      case 'K': {
        const k = parseKey(val);
        if (k.hasTonic) {
          key = k;
          if (song.keyFifths === undefined) {
            song.keyFifths = k.fifths;
            if (k.mode) song.keyMode = k.mode;
          }
        }
        if (!inBody) {
          inBody = true;
          if (unitL == null) unitL = defaultL();
          if (tempoStr != null) {
            const t = parseTempo(tempoStr, unitL);
            if (t > 0) song.tempo = r6(t);
          }
        }
        break;
      }
      case 'V': {
        const id = val.trim().split(/\s+/)[0] || '1';
        const v = getVoice(id);
        if (inBody) voice = v;
        break;
      }
      default:
        break;
    }
  };

  // --- Analyse d'une ligne de musique ---
  const parseMusicLine = (line, lineNo) => {
    let i = 0;
    const n = line.length;
    let pendingFinger = null;
    let pendingArts = [];
    let pendingSlur = 0;
    const decoration = (deco) => {
      const v = curVoice();
      const at = r6(v.time);
      if (/^[1-5]$/.test(deco)) {
        if (pendingFinger == null) pendingFinger = parseInt(deco, 10);
      } else if (DYNAMICS.has(deco)) dynMarks.push({ beat: at, mark: deco });
      else if (/^(<\(|crescendo\(|>\(|diminuendo\()$/.test(deco)) {
        const item = { beat: at, mark: deco[0] === '<' || deco[0] === 'c' ? 'cresc' : 'dim', end: at + 1 };
        openWedges.push(item);
        dynMarks.push(item);
      } else if (/^(<\)|crescendo\)|>\)|diminuendo\))$/.test(deco)) {
        if (openWedges.length) openWedges.shift().end = at;
      } else if (ARTIC[deco] && !pendingArts.includes(ARTIC[deco])) pendingArts.push(ARTIC[deco]);
    };

    const readLength = () => {
      // (\d*)(/+)(\d*)
      let num = '';
      while (i < n && line[i] >= '0' && line[i] <= '9') num += line[i++];
      let slashes = 0;
      while (i < n && line[i] === '/') {
        slashes++;
        i++;
      }
      let den = '';
      while (i < n && line[i] >= '0' && line[i] <= '9') den += line[i++];
      let len = num ? parseInt(num, 10) : 1;
      if (slashes) {
        if (den) len /= parseInt(den, 10) * 2 ** (slashes - 1);
        else len /= 2 ** slashes;
      }
      if (!Number.isFinite(len) || len <= 0) throw abcError('durée invalide', lineNo);
      return len;
    };

    // Lit une note (accidents, lettre, octave, durée). Renvoie null si pas de note ici.
    const readNote = () => {
      const save = i;
      let acc = null;
      if (line.startsWith('^^', i)) (acc = 2), (i += 2);
      else if (line.startsWith('__', i)) (acc = -2), (i += 2);
      else if (line[i] === '^') (acc = 1), i++;
      else if (line[i] === '_') (acc = -1), i++;
      else if (line[i] === '=') (acc = 0), i++;
      const c = line[i];
      if (!c || !/[A-Ga-g]/.test(c)) {
        i = save;
        return null;
      }
      i++;
      const letter = c.toUpperCase();
      let octave = c === letter ? 4 : 5;
      while (i < n && (line[i] === "'" || line[i] === ',')) octave += line[i++] === "'" ? 1 : -1;
      const len = readLength();
      let tie = false;
      if (line[i] === '-') {
        tie = true;
        i++;
      }
      const v = curVoice();
      const accKey = letter + octave;
      let alter;
      if (acc !== null) {
        v.barAcc[accKey] = acc;
        alter = acc;
      } else if (accKey in v.barAcc) alter = v.barAcc[accKey];
      else alter = key.acc[letter] || 0;
      const midi = (octave + 1) * 12 + LETTER_PC[letter] + alter;
      return { midi, len, tie };
    };

    const tupletFactor = (v) => {
      if (!v.tuplet) return 1;
      const f = v.tuplet.q / v.tuplet.p;
      if (--v.tuplet.r <= 0) v.tuplet = null;
      return f;
    };

    // Place un événement (note, accord ou silence) dans la voix courante.
    const placeEvent = (specs, advanceLen, mult = 1) => {
      const v = curVoice();
      let factor = tupletFactor(v) * mult;
      if (v.broken) {
        factor *= v.broken;
        v.broken = null;
      }
      const ub = beatsPerUnit();
      const start = v.time;
      const advance = advanceLen * ub * factor;
      const touched = [];
      const newTies = new Map();
      specs.forEach((sp, idx) => {
        if (sp.midi < 0 || sp.midi > 127) return;
        const dur = sp.len * ub * factor;
        const prev = v.ties.get(sp.midi);
        let note;
        if (prev && Math.abs(prev.start + prev.dur - start) < 1e-6) {
          prev.dur = start + dur - prev.start;
          note = prev;
        } else {
          note = { midi: sp.midi, start, dur, finger: idx === 0 && pendingFinger ? pendingFinger : null };
          if (pendingArts.length) note.articulations = [...pendingArts];
          if (pendingSlur > 0 && idx === 0) note.slur = 'start';
          v.notes.push(note);
        }
        touched.push({ note, part: dur });
        if (sp.tie) newTies.set(sp.midi, note);
      });
      pendingFinger = null;
      if (touched.length) {
        pendingArts = [];
        pendingSlur = 0;
        v.lastNote = touched[0].note;
      }
      v.ties = newTies;
      v.time = start + advance;
      v.lastEvent = { start, advance, touched };
    };

    // Rythme pointé : modifie l'événement précédent et prépare le suivant.
    const applyBroken = (sym, count) => {
      const v = curVoice();
      const e = v.lastEvent;
      if (!e) return;
      const short = 1 / 2 ** count;
      const long = 2 - short;
      const fPrev = sym === '>' ? long : short;
      const fNext = sym === '>' ? short : long;
      for (const { note, part } of e.touched) note.dur += part * (fPrev - 1);
      v.time = e.start + e.advance * fPrev;
      v.broken = fNext;
      v.lastEvent = null;
    };

    const onBar = () => {
      const v = curVoice();
      v.barAcc = {};
      if (v.overlayMax > v.time) v.time = v.overlayMax;
      v.overlayMax = 0;
      v.barStart = v.time;
    };

    let guard = 0;
    while (i < n) {
      if (++guard > n * 4 + 100) throw abcError('analyse bloquée', lineNo);
      const c = line[i];
      if (c === '%') break;
      if (c === ')') {
        i++;
        const ln = curVoice().lastNote;
        if (ln) ln.slur = ln.slur === 'start' ? 'both' : 'stop';
        continue;
      }
      if (c === ' ' || c === '\t' || c === '`' || c === '\\' || c === 'y') {
        i++;
        continue;
      }
      if (c === '"') {
        const e = line.indexOf('"', i + 1);
        const body = line.slice(i + 1, e < 0 ? n : e).trim();
        i = e < 0 ? n : e + 1;
        // symbole d'accord (les annotations commencent par ^ _ < > @)
        if (body && !/^[\^_<>@]/.test(body) && /^[A-G]/.test(body)) {
          const sym = body.replace(/^([A-G])#/, '$1♯').replace(/^([A-G])b/, '$1♭').replace(/\/([A-G])#/, '/$1♯').replace(/\/([A-G])b/, '/$1♭');
          chordMarks.push({ beat: r6(curVoice().time), symbol: sym });
        }
        continue;
      }
      if (c === '!' || c === '+') {
        const e = line.indexOf(c, i + 1);
        if (e < 0) {
          i++;
          continue;
        }
        const deco = line.slice(i + 1, e).trim();
        if (/^[1-5]$/.test(deco)) pendingFinger = parseInt(deco, 10);
        else decoration(deco);
        i = e + 1;
        continue;
      }
      if (c === '{') {
        const e = line.indexOf('}', i + 1);
        i = e < 0 ? n : e + 1;
        continue;
      }
      if (c === '.') {
        i++;
        if (!pendingArts.includes('staccato')) pendingArts.push('staccato');
        continue;
      }
      if ('~HLMOPSTuv'.includes(c)) {
        i++;
        continue;
      }
      if (c === '>' || c === '<') {
        let cnt = 0;
        while (line[i] === c) {
          cnt++;
          i++;
        }
        applyBroken(c, Math.min(cnt, 3));
        continue;
      }
      if (c === '(') {
        if (/\d/.test(line[i + 1] || '')) {
          i++;
          const m = line.slice(i).match(/^(\d+)(?::(\d*))?(?::(\d*))?/);
          i += m[0].length;
          const p = parseInt(m[1], 10);
          const compound = meter.timeSig[1] === 8 && meter.timeSig[0] % 3 === 0 && meter.timeSig[0] > 3;
          const defQ = { 2: 3, 3: 2, 4: 3, 6: 2, 8: 3 }[p] ?? (compound ? 3 : 2);
          const q = m[2] ? parseInt(m[2], 10) : defQ;
          const r = m[3] ? parseInt(m[3], 10) : p;
          if (p > 0 && q > 0 && r > 0) curVoice().tuplet = { p, q, r };
        } else {
          i++; // liaison d'expression
          pendingSlur++;
        }
        continue;
      }
      if (c === '|' || c === ':' || (c === '[' && /[|\d]/.test(line[i + 1] || '') )) {
        // barres, reprises, fins alternatives (|1 :|2 [1 [2 …)
        const tok0 = i;
        while (i < n && /[|:\[\]]/.test(line[i])) i++;
        const bars = line.slice(tok0, i);
        const num0 = i;
        while (i < n && (/\d/.test(line[i]) || (/[,\-]/.test(line[i]) && /\d/.test(line[i + 1] || '')))) i++;
        onBar();
        {
          // reprises et fins alternatives : notées ici, dépliées à la fin
          const v = curVoice();
          const ending = parseInt(line.slice(num0, i), 10);
          const mk = { t: v.time, end: /^:/.test(bars) || /:\|/.test(bars), start: /:$/.test(bars) || /\|:/.test(bars) || bars === '::', ending: ending > 0 ? ending : 0 };
          if (mk.end || mk.start || mk.ending) (v.marks || (v.marks = [])).push(mk);
        }
        continue;
      }
      if (c === ']') {
        i++;
        continue;
      }
      if (c === '[' && /^\[[A-Za-z]:/.test(line.slice(i, i + 3))) {
        const e = line.indexOf(']', i);
        const body = line.slice(i + 1, e < 0 ? n : e);
        i = e < 0 ? n : e + 1;
        const f = body[0];
        handleField(f, body.slice(2), lineNo);
        continue;
      }
      if (c === '[') {
        // accord
        i++;
        const specs = [];
        let g = 0;
        while (i < n && line[i] !== ']' && g++ < 200) {
          const ch = line[i];
          if (ch === '!' || ch === '+' || ch === '"') {
            const e = line.indexOf(ch, i + 1);
            if (ch === '!' || ch === '+') {
              const deco = e > i ? line.slice(i + 1, e).trim() : '';
              if (/^[1-5]$/.test(deco) && pendingFinger == null) pendingFinger = parseInt(deco, 10);
            }
            i = e < 0 ? n : e + 1;
            continue;
          }
          const note = readNote();
          if (note) specs.push(note);
          else i++;
        }
        if (line[i] !== ']') throw abcError('accord « [ » non fermé', lineNo);
        i++;
        const mult = readLength();
        let tieAll = false;
        if (line[i] === '-') {
          tieAll = true;
          i++;
        }
        if (!specs.length) continue;
        for (const sp of specs) {
          sp.len *= mult;
          if (tieAll) sp.tie = true;
        }
        placeEvent(specs, specs[0].len);
        continue;
      }
      if (c === 'z' || c === 'x') {
        i++;
        const len = readLength();
        placeEvent([], len);
        continue;
      }
      if (c === 'Z' || c === 'X') {
        i++;
        let num = '';
        while (i < n && /\d/.test(line[i])) num += line[i++];
        const bars = num ? parseInt(num, 10) : 1;
        const v = curVoice();
        v.time += bars * meter.value * 4;
        v.ties = new Map();
        v.lastEvent = null;
        continue;
      }
      if (c === '&') {
        // superposition de voix : on revient au début de la mesure
        i++;
        const v = curVoice();
        v.overlayMax = Math.max(v.overlayMax, v.time);
        v.time = v.barStart;
        continue;
      }
      if (c === '-') {
        // liaison isolée (après un espace) : on prolonge la dernière note
        i++;
        const v = curVoice();
        if (v.lastEvent) for (const { note: nn } of v.lastEvent.touched) v.ties.set(nn.midi, nn);
        continue;
      }
      const note = readNote();
      if (note) {
        placeEvent([note], note.len);
        continue;
      }
      // caractère inconnu : ignoré
      i++;
    }
  };

  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li];
    const lineNo = li + 1;
    const line = raw.replace(/^\s+/, '');
    if (!line || line.startsWith('%')) continue;
    const fm = line.match(/^([A-Za-z+]):(.*)$/);
    if (fm) {
      const f = fm[1];
      if (f === 'X') {
        if (seenX && tuneStarted) break; // morceau suivant : on s'arrête
        seenX = true;
        continue;
      }
      if (!'TCMLQKV'.includes(f)) continue; // autres champs (paroles w:, notes N:, etc.) ignorés
      handleField(f, fm[2].replace(/%.*$/, ''), lineNo);
      continue;
    }
    if (!inBody) {
      // musique sans en-tête K: (tolérance)
      if (!/[A-Ga-g]/.test(line)) continue;
      inBody = true;
      if (unitL == null) unitL = defaultL();
    }
    tuneStarted = true;
    parseMusicLine(line, lineNo);
  }

  // --- Mains ---
  const used = voiceOrder.map((id) => voices.get(id)).filter((v) => v.notes.length);
  if (!used.length) throw abcError('aucune note trouvée.');
  // --- Reprises |: :| et fins alternatives [1 [2 : dépliées (structure lue sur la première voix qui en a) ---
  const report = { details: [], warnings: [] };
  {
    const ref = used.find((v) => (v.marks || []).some((m) => m.end));
    const ops = [];
    if (ref) {
      let seg = 0, volta = null;
      for (const m of ref.marks) {
        if (m.end) {
          const b = volta != null ? volta : m.t;
          if (b > seg + 1e-9) ops.push({ a: seg, b, at: m.t, len: b - seg });
          seg = m.t; volta = null;
        } else if (m.ending === 1) volta = m.t;
        if (m.start) { seg = m.t; volta = null; }
      }
    }
    if (ops.length) {
      let acc = 0;
      for (const o of ops) { o.off = acc; acc += o.len; }
      const shift = (x) => x + ops.reduce((t, o) => t + (o.at <= x + 1e-9 ? o.len : 0), 0);
      const unfold = (items, key, dup = true) => {
        const out = [];
        for (const it of items) {
          const x = it[key];
          out.push({ ...it, [key]: shift(x) });
          if (dup) for (const o of ops) if (x >= o.a - 1e-9 && x < o.b - 1e-9) out.push({ ...it, [key]: o.at + o.off + (x - o.a) });
        }
        return out;
      };
      for (const v of used) v.notes = unfold(v.notes, 'start');
      chordMarks.splice(0, chordMarks.length, ...unfold(chordMarks, 'beat'));
      dynMarks.splice(0, dynMarks.length, ...unfold(dynMarks, 'beat', false));
      tempoMarks.splice(0, tempoMarks.length, ...unfold(tempoMarks, 'beat', false));
      report.details.push(ref.marks.some((m) => m.ending) ? 'reprises et fins alternatives dépliées' : 'reprises dépliées');
    }
    if (used.length > 2) report.warnings.push(`${used.length} voix : la première va à la main droite, les autres sont réparties selon leur hauteur.`);
  }
  song.importReport = report;
  used.forEach((v, idx) => {
    let hand;
    if (used.length === 1) hand = 'R';
    else if (idx === 0) hand = 'R';
    else if (idx === 1) hand = 'L';
    else {
      const avg = v.notes.reduce((s, x) => s + x.midi, 0) / v.notes.length;
      hand = avg >= 60 ? 'R' : 'L';
    }
    for (const nn of v.notes) {
      const out = { midi: nn.midi, start: r6(nn.start), dur: r6(nn.dur), hand, finger: nn.finger || null };
      if (nn.slur) out.slur = nn.slur;
      if (nn.articulations) out.articulations = nn.articulations;
      song.notes.push(out);
    }
  });
  song.notes = song.notes.filter((x) => x.dur > 0).sort((a, b) => a.start - b.start || a.midi - b.midi);
  if (song.keyFifths === undefined) delete song.keyFifths;
  const byBeat = (a, b) => a.beat - b.beat;
  if (chordMarks.length) {
    const seen = new Set();
    song.chords = chordMarks.sort(byBeat).filter((c) => !seen.has(`${c.beat}|${c.symbol}`) && seen.add(`${c.beat}|${c.symbol}`));
  }
  if (dynMarks.length) song.dynamics = dynMarks.sort(byBeat);
  if (tempoMarks.length && song.tempo) {
    const tm = [{ beat: 0, bpm: song.tempo }];
    for (const t of tempoMarks.sort(byBeat)) {
      const last = tm[tm.length - 1];
      if (Math.abs(last.beat - t.beat) < 1e-6) last.bpm = t.bpm;
      else if (last.bpm !== t.bpm) tm.push(t);
    }
    if (tm.length > 1) song.tempoMap = tm;
  }
  return song;
}
