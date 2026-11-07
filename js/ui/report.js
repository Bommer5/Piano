// Rapport détaillé de fin de session (graphiques SVG), « Revoir mes erreurs », confettis.
import { h, modal } from './dom.js';
import { noteLabel, spell } from '../core/notes.js';
import { StaffView } from './staff.js';

const NS = 'http://www.w3.org/2000/svg';
function s(name, attrs = {}, parent, text) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
function svgBox(w, hh, label) {
  return s('svg', { viewBox: `0 0 ${w} ${hh}`, class: 'rep-chart', role: 'img', 'aria-label': label, preserveAspectRatio: 'xMidYMid meet' });
}

/** Écart (ms) de chaque note le long du morceau, une bande par main. */
export function timingChart(timing, { from = 0, to = 1, beatsPerMeasure = 4 } = {}) {
  const W = 640, PH = 90, hands = ['R', 'L'].filter((x) => timing.some((t) => t.hand === x));
  const H = Math.max(1, hands.length) * (PH + 18) + 14;
  const svg = svgBox(W, H, 'Écart rythmique de chaque note, main droite et main gauche');
  const L = 44, R = 8;
  const xOf = (b) => L + ((b - from) / Math.max(1e-6, to - from)) * (W - L - R);
  const lim = 250;
  hands.forEach((hand, i) => {
    const top = 6 + i * (PH + 18);
    const yOf = (ms) => top + PH / 2 - (Math.max(-lim, Math.min(lim, ms)) / lim) * (PH / 2);
    s('rect', { x: L, y: top, width: W - L - R, height: PH, class: 'rep-bg' }, svg);
    for (let b = Math.ceil(from / beatsPerMeasure) * beatsPerMeasure; b <= to; b += beatsPerMeasure) s('line', { x1: xOf(b), x2: xOf(b), y1: top, y2: top + PH, class: 'rep-grid' }, svg);
    s('line', { x1: L, x2: W - R, y1: yOf(0), y2: yOf(0), class: 'rep-axis' }, svg);
    s('text', { x: 4, y: top + 12, class: 'rep-lbl' }, svg, hand === 'R' ? 'MD' : 'MG');
    s('text', { x: 4, y: top + 26, class: 'rep-lbl small' }, svg, 'tard');
    s('text', { x: 4, y: top + PH - 4, class: 'rep-lbl small' }, svg, 'tôt');
    for (const t of timing.filter((x) => x.hand === hand)) {
      const c = s('circle', { cx: xOf(t.beat), cy: yOf(t.ms), r: 3, class: 'rep-dot ' + (Math.abs(t.ms) <= 60 ? 'ok' : 'off') + ' hand-' + hand }, svg);
      s('title', {}, c, `Mesure ${t.measure} : ${t.ms > 0 ? '+' : ''}${t.ms} ms`);
    }
  });
  return svg;
}

/** Histogramme des écarts. */
export function histogramChart(hist) {
  const W = 320, H = 110, L = 6, B = 18;
  const svg = svgBox(W, H, 'Histogramme des écarts rythmiques');
  svg.classList.add('small');
  const max = Math.max(1, ...hist.map((b) => b.count));
  const bw = (W - 2 * L) / hist.length;
  hist.forEach((b, i) => {
    const hh = (b.count / max) * (H - B - 6);
    const r = s('rect', { x: L + i * bw + 1, y: H - B - hh, width: Math.max(1, bw - 2), height: hh, class: 'rep-bar' + (Math.abs(b.from + 10) <= 60 ? ' ok' : '') }, svg);
    s('title', {}, r, `${b.from} à ${b.to} ms : ${b.count}`);
  });
  s('text', { x: L, y: H - 4, class: 'rep-lbl small' }, svg, `${hist[0].from} ms`);
  s('text', { x: W / 2, y: H - 4, class: 'rep-lbl small', 'text-anchor': 'middle' }, svg, '0');
  s('text', { x: W - L, y: H - 4, class: 'rep-lbl small', 'text-anchor': 'end' }, svg, `+${hist[hist.length - 1].to} ms`);
  return svg;
}

/** Dérive par mesure : écart moyen (barres) et tempo local (texte). */
export function driftChart(drift) {
  const W = 640, H = 120, L = 8, B = 16, mid = (H - B) / 2;
  const svg = svgBox(W, H, 'Dérive de tempo mesure par mesure');
  const lim = Math.max(80, ...drift.map((d) => Math.abs(d.meanMs)));
  const bw = (W - 2 * L) / Math.max(1, drift.length);
  s('line', { x1: L, x2: W - L, y1: mid, y2: mid, class: 'rep-axis' }, svg);
  drift.forEach((d, i) => {
    const hh = (Math.abs(d.meanMs) / lim) * (mid - 6);
    const r = s('rect', { x: L + i * bw + 2, y: d.meanMs > 0 ? mid : mid - hh, width: Math.max(2, bw - 4), height: Math.max(1, hh), class: 'rep-bar ' + (d.meanMs > 0 ? 'late' : 'early') }, svg);
    s('title', {}, r, `Mesure ${d.measure} : ${d.meanMs > 0 ? 'en retard' : 'en avance'} de ${Math.abs(d.meanMs)} ms${d.tempoPct ? ` · tempo local ${d.tempoPct} %` : ''}`);
    if (drift.length <= 24 || i % 2 === 0) s('text', { x: L + i * bw + bw / 2, y: H - 4, class: 'rep-lbl small', 'text-anchor': 'middle' }, svg, String(d.measure));
  });
  s('text', { x: W - L, y: 12, class: 'rep-lbl small', 'text-anchor': 'end' }, svg, 'retard ↓  avance ↑');
  return svg;
}

const fmtMs = (x) => `${Math.round(x)} ms`;

/**
 * Fenêtre « Rapport détaillé ».
 * @param {object} a analyse (analyzeTake)
 * @param {object} sum résumé du moteur
 * @param {{song:object, from:number, to:number, settings:object, onRepeatMeasure?:(m:number)=>void}} ctx
 */
export function showReport(a, sum, ctx) {
  const { song, settings } = ctx;
  const name = (m) => noteLabel(m, settings);
  const dlg = modal('Rapport détaillé', '', [{ label: 'Fermer', primary: true }]);
  dlg.classList.add('report-dlg');
  const body = dlg.querySelector('.modal-body');
  const sec = (title, ...children) => body.append(h('section', { class: 'rep-sec' }, [h('h3', {}, title), ...children]));
  const hasTiming = a.timing.length > 0;
  if (hasTiming) {
    sec('Précision rythmique (écart de chaque note)', timingChart(a.timing, { from: ctx.from, to: ctx.to, beatsPerMeasure: song.beatsPerMeasure }));
    const reg = Object.entries(a.hands).map(([hand, v]) => h('li', {}, `${hand === 'R' ? 'Main droite' : 'Main gauche'} : ${v.mean > 0 ? '+' : ''}${fmtMs(v.mean)} en moyenne, régularité (écart-type) ${fmtMs(v.sd)}`));
    sec('Régularité', histogramChart(a.regularity.hist), h('ul', {}, reg),
      h('p', { class: 'muted small' }, a.regularity.sd < 30 ? 'Très régulier !' : a.regularity.sd < 60 ? 'Assez régulier.' : 'Irrégulier : travaille avec le métronome à tempo lent.'));
    if (a.drift.length > 1) {
      const fast = a.drift.filter((d) => d.tempoPct && d.tempoPct > 108).map((d) => d.measure);
      const slow = a.drift.filter((d) => d.tempoPct && d.tempoPct < 92).map((d) => d.measure);
      sec('Dérive de tempo par mesure', driftChart(a.drift),
        h('p', { class: 'small' }, [fast.length ? `Tu accélères mesure${fast.length > 1 ? 's' : ''} ${fast.join(', ')}. ` : '', slow.length ? `Tu ralentis mesure${slow.length > 1 ? 's' : ''} ${slow.join(', ')}.` : '', !fast.length && !slow.length ? 'Tempo stable.' : '']));
    }
  } else {
    sec('Rythme', h('p', { class: 'muted small' }, 'Le rapport rythmique est disponible en mode Tempo.'));
  }
  const list = (items) => h('ul', { class: 'rep-list' }, items);
  if (a.arpeggios.length) sec('Accords arpégés', list(a.arpeggios.slice(0, 8).map((x) => h('li', {}, `Mesure ${x.measure} (${x.hand === 'L' ? 'MG' : 'MD'}) : ${x.spreadMs} ms entre la 1re et la dernière note`))), h('p', { class: 'muted small' }, 'Plaque les notes de l’accord en même temps (moins de 40 ms d’écart).'));
  if (a.durations.length) {
    const bad = a.durations.filter((d) => d.verdict !== 'ok');
    sec('Durées tenues', h('p', { class: 'small' }, `${a.durations.length - bad.length}/${a.durations.length} notes tenues correctement · relâchées trop tôt : ${a.short} · tenues trop longtemps : ${a.long}`),
      bad.length ? list(bad.slice(0, 8).map((d) => h('li', {}, `Mesure ${d.measure}, ${name(d.midi)} : ${d.verdict === 'short' ? 'relâchée trop tôt' : 'tenue trop longtemps'} (${Math.round(d.ratio * 100)} % de la durée écrite)`))) : null);
  }
  if (a.legato.length) sec('Legato', list(a.legato.slice(0, 8).map((l) => h('li', {}, `Mesure ${l.measure} (${l.hand === 'L' ? 'MG' : 'MD'}) : coupure de ${l.gapMs} ms dans une liaison`))), h('p', { class: 'muted small' }, 'Sous une liaison, garde la touche enfoncée jusqu’à jouer la suivante.'));
  if (sum.dynamics) sec('Nuances', h('p', { class: 'small' }, sum.dynamics.message), list(sum.dynamics.byMark.map((d) => h('li', {}, `${d.mark} : vélocité moyenne ${Math.round(d.avg * 127)}`))));
  if (sum.pedal) sec('Pédale', h('p', { class: 'small' }, `${sum.pedal.matched}/${sum.pedal.expected} changements de pédale au bon moment.`));
  if (a.extras.length || a.confusions.length) {
    sec('Notes en trop et confusions',
      h('p', { class: 'small' }, `${a.extras.length} note${a.extras.length > 1 ? 's' : ''} jouée${a.extras.length > 1 ? 's' : ''} en trop ou à la place d’une autre.`),
      a.confusions.length ? list(a.confusions.slice(0, 5).map((c) => h('li', {}, `Tu joues souvent ${name(c.played)} au lieu de ${name(c.expected)} (${c.count} fois)`))) : null);
  }
  if (sum.worstMeasures?.length && ctx.onRepeatMeasure) {
    sec('Défi', h('p', { class: 'small' }, 'Joue la mesure la plus difficile 3 fois juste d’affilée :'),
      h('div', { class: 'row' }, sum.worstMeasures.map((w) => h('button', { class: 'btn tiny', onclick: () => { dlg.close(); ctx.onRepeatMeasure(w.measure); } }, `Mesure ${w.measure} × 3`))));
  }
  return dlg;
}

/**
 * « Revoir mes erreurs » : portée des mesures fautives (justes en vert, ratées en rouge, jouées à tort en gris).
 * @param {{song:object, measures:number[], status:Map<number,string>, extras:Array<{midi:number,beat:number}>, settings:object, onPlayCorrect:(from:number,to:number)=>void, onPlayMine:(from:number,to:number)=>void}} o
 */
export function showErrorReview(o) {
  const { song, settings } = o;
  const bpm = song.beatsPerMeasure;
  const ms = [...new Set(o.measures)].sort((a, b) => a - b).slice(0, 6);
  // regroupe les mesures contiguës (au plus 3 par portée)
  const ranges = [];
  for (const m of ms) {
    const r = ranges[ranges.length - 1];
    if (r && m === r[1] + 1 && r[1] - r[0] < 2) r[1] = m;
    else ranges.push([m, m]);
  }
  const dlg = modal('Revoir mes erreurs', '<p class="small">Notes <b class="rv-ok">justes en vert</b>, <b class="rv-bad">ratées en rouge</b>, <b class="rv-extra">jouées à tort en gris</b>.</p>', [{ label: 'Fermer', primary: true }]);
  dlg.classList.add('report-dlg');
  const body = dlg.querySelector('.modal-body');
  for (const [a, b] of ranges) {
    const from = (a - 1) * bpm, to = b * bpm;
    const wrap = h('div', { class: 'rv-staff staff-wrap' });
    body.append(h('h3', {}, a === b ? `Mesure ${a}` : `Mesures ${a} à ${b}`), wrap,
      h('div', { class: 'row' }, [
        h('button', { class: 'btn small', onclick: () => o.onPlayCorrect(from, to) }, '🔊 Écouter la bonne version'),
        h('button', { class: 'btn small', onclick: () => o.onPlayMine(from, to) }, '🎧 Écouter ce que j’ai joué'),
      ]));
    const staff = new StaffView(wrap);
    try {
      staff.render(song, from, to, { settings, showFingers: false, showNoteNames: !!settings.showNoteNames, activeHands: 'both' });
    } catch {
      continue;
    }
    for (const n of song.notes) {
      if (n.start < from - 1e-6 || n.start >= to - 1e-6) continue;
      const st = o.status.get(n.id);
      if (st) staff.mark(n.id, st === 'miss' || st === 'wrong' ? 'miss' : 'hit');
    }
    if (staff.xOf) {
      for (const e of o.extras) {
        if (e.beat < from - 0.25 || e.beat >= to) continue;
        const clef = e.midi < 60 ? 'bass' : 'treble';
        // Orthographe tonale (Fa♯ en Sol majeur, Si♭ en Fa…) et position verticale de CETTE portée.
        const sp = spell(e.midi, song.keyFifths || 0, song.keyMode);
        const x = staff.xOf(Math.max(from, e.beat)) + 4, y = staff.yOf(sp.diatonic, clef);
        const g = s('g', { class: 'extra-note' }, staff.svg);
        s('ellipse', { cx: x, cy: y, rx: 6, ry: 4.3, transform: `rotate(-20 ${x} ${y})` }, g);
        if (sp.alter) s('text', { x: x - 16, y: y + 4, class: 'accidental' }, g, sp.alter > 0 ? '♯' : '♭');
        s('title', {}, g, `Joué à tort : ${noteLabel(e.midi, settings)}`);
      }
    }
  }
  if (!ranges.length) body.append(h('p', {}, 'Aucune erreur à revoir : bravo !'));
  return dlg;
}

/** Confettis légers sur un canvas plein écran (≈ 2 s). */
export function confetti(n = 90) {
  if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches || 'reduceMotion' in document.documentElement.dataset) return; // + réglage « Réduire les animations » (motion.js)
  const c = h('canvas', { class: 'confetti', 'aria-hidden': 'true' });
  document.body.appendChild(c);
  const dpr = devicePixelRatio || 1;
  c.width = innerWidth * dpr;
  c.height = innerHeight * dpr;
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  const cols = ['#ff4d5e', '#ffb020', '#ffe14d', '#2ecc71', '#4f8cff', '#7a5cff', '#c04dff'];
  const parts = Array.from({ length: n }, () => ({ x: innerWidth / 2 + (Math.random() - 0.5) * 200, y: innerHeight * 0.35, vx: (Math.random() - 0.5) * 9, vy: -Math.random() * 9 - 3, r: Math.random() * 6 + 3, a: Math.random() * 6, va: (Math.random() - 0.5) * 0.3, col: cols[(Math.random() * cols.length) | 0] }));
  const t0 = performance.now();
  const step = (t) => {
    const k = (t - t0) / 2200;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.25;
      p.x += p.vx;
      p.y += p.vy;
      p.a += p.va;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - k);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.a);
      ctx.fillStyle = p.col;
      ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
      ctx.restore();
    }
    if (k < 1) requestAnimationFrame(step);
    else c.remove();
  };
  requestAnimationFrame(step);
}

