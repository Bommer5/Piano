// Vue « notes qui tombent » (canvas), alignée sur le clavier.

export class NoteRoll {
  constructor(canvas, keyboard) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.keyboard = keyboard;
    this.beatsVisible = 6;
    this.notes = [];
    this.state = new Map(); // id -> 'hit' | 'miss' | 'good'...
    this.showFingers = true;
    this.labels = null;
    this.loop = null;
    this.overlay = null; // 2e couche : notes jouées (prise) [{midi,start,dur,judge}]
    this.noteColor = null; // (midi) => couleur fixe (mode enfant)
    this._resize = () => this.resize();
    window.addEventListener('resize', this._resize);
    this.resize();
  }

  destroy() {
    window.removeEventListener('resize', this._resize);
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.w = r.width;
    this.h = r.height;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setNotes(notes) {
    this.notes = notes;
    this.state.clear();
  }

  colors() {
    const cs = getComputedStyle(document.documentElement);
    return {
      R: cs.getPropertyValue('--hand-r').trim() || '#4f8cff',
      L: cs.getPropertyValue('--hand-l').trim() || '#ff8a3d',
      hit: cs.getPropertyValue('--ok').trim() || '#2ecc71',
      miss: cs.getPropertyValue('--bad').trim() || '#ff4d5e',
      grid: cs.getPropertyValue('--grid').trim() || 'rgba(255,255,255,.06)',
      warn: cs.getPropertyValue('--warn').trim() || '#ffb020',
      text: '#fff',
    };
  }

  /**
   * @param {number} beat position courante (en temps)
   * @param {{beatsPerMeasure:number, activeHands:string, current?:Set<number>}} info
   */
  draw(beat, info) {
    if (!this.w) this.resize();
    const { ctx, w, h } = this;
    const c = (this._c ||= this.colors());
    ctx.clearRect(0, 0, w, h);
    const pxPerBeat = h / this.beatsVisible;
    const yOf = (b) => h - (b - beat) * pxPerBeat;

    // lignes de mesure
    const bpm = info.beatsPerMeasure;
    ctx.fillStyle = c.grid;
    const firstBar = Math.floor(beat / bpm) * bpm;
    for (let b = firstBar; b < beat + this.beatsVisible + bpm; b += bpm) {
      const y = yOf(b);
      if (y < 0 || y > h) continue;
      ctx.fillRect(0, y, w, 1);
      ctx.font = '10px system-ui';
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      ctx.fillText(String(Math.round(b / bpm) + 1), 4, y - 3);
      ctx.fillStyle = c.grid;
    }
    // boucle A-B
    if (this.loop) {
      ctx.fillStyle = 'rgba(255,214,10,.07)';
      const y1 = yOf(this.loop.to), y0 = yOf(this.loop.from);
      ctx.fillRect(0, Math.max(0, y1), w, Math.min(h, y0) - Math.max(0, y1));
    }

    for (const n of this.notes) {
      if (n.start > beat + this.beatsVisible || n.start + n.dur < beat - 0.5) continue;
      const g = this.keyboard.geometry(n.midi);
      if (!g) continue;
      const x = g.x * w + 1, ww = g.w * w - 2;
      const y1 = yOf(n.start + n.dur) + 1, y0 = yOf(n.start);
      const st = this.state.get(n.id);
      const inactive = info.activeHands !== 'both' && n.hand !== info.activeHands;
      let col = st === 'miss' || st === 'wrong' ? c.miss : st ? c.hit : (this.noteColor && this.noteColor(n.midi)) || c[n.hand] || c.R;
      ctx.globalAlpha = inactive ? 0.28 : n.start + n.dur < beat ? 0.45 : 1;
      const r = Math.min(6, ww / 3);
      ctx.fillStyle = col;
      roundRect(ctx, x, y1, ww, Math.max(4, y0 - y1 - 1), r);
      ctx.fill();
      if (info.current?.has(n.id)) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (this.showFingers && n.finger && y0 - y1 > 14 && ww > 9) {
        ctx.fillStyle = 'rgba(0,0,0,.55)';
        ctx.font = `bold ${Math.min(13, ww * 0.8)}px system-ui`;
        ctx.textAlign = 'center';
        ctx.fillText(String(n.finger), x + ww / 2, y0 - 5);
        ctx.textAlign = 'start';
      }
      if (this.labels && y0 - y1 > 30 && ww > 16) {
        ctx.fillStyle = 'rgba(0,0,0,.45)';
        ctx.font = `${Math.min(10, ww * 0.45)}px system-ui`;
        ctx.textAlign = 'center';
        ctx.fillText(this.labels(n.midi), x + ww / 2, y1 + 11);
        ctx.textAlign = 'start';
      }
    }
    ctx.globalAlpha = 1;
    if (this.overlay) this.drawOverlay(beat, yOf, c);
    // ligne de jeu
    const grad = ctx.createLinearGradient(0, h - 10, 0, h);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(1, 'rgba(255,255,255,.25)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, h - 10, w, 10);
  }
}

NoteRoll.prototype.drawOverlay = function (beat, yOf, c) {
  const { ctx, w } = this;
  const cols = { ok: c.hit, early: c.warn, late: c.warn, wrong: '#9aa0a6', extra: '#9aa0a6' };
  ctx.lineWidth = 2;
  for (const n of this.overlay) {
    if (n.start > beat + this.beatsVisible || n.start + n.dur < beat - 0.5) continue;
    const g = this.keyboard.geometry(n.midi);
    if (!g) continue;
    const x = g.x * w + 3, ww = Math.max(3, g.w * w - 6);
    const y1 = yOf(n.start + n.dur) + 1, y0 = yOf(n.start);
    const col = cols[n.judge] || '#ffffff';
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = col;
    ctx.setLineDash(n.judge === 'wrong' || n.judge === 'extra' ? [4, 3] : []);
    roundRect(ctx, x, y1, ww, Math.max(4, y0 - y1 - 1), Math.min(4, ww / 3));
    ctx.stroke();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = col;
    ctx.fill();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
