// Entrées de notes : clavier MIDI (Web MIDI), clavier d'ordinateur.

export class MidiInput {
  constructor() {
    this.listeners = new Set();
    this.devices = [];
    this.access = null;
    this.held = new Set();
  }
  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(e) {
    for (const fn of this.listeners) fn(e);
  }
  get supported() {
    return typeof navigator !== 'undefined' && !!navigator.requestMIDIAccess;
  }
  async init() {
    if (!this.supported) return [];
    if (this.access) return this.devices;
    this.access = await navigator.requestMIDIAccess();
    const bind = () => {
      this.devices = [];
      for (const input of this.access.inputs.values()) {
        this.devices.push(input.name);
        input.onmidimessage = (m) => this.handle(m.data);
      }
      this.emit({ type: 'devices', devices: this.devices });
    };
    this.access.onstatechange = bind;
    bind();
    return this.devices;
  }
  handle(data) {
    const [status, d1, d2] = data;
    const cmd = status & 0xf0;
    if (cmd === 0x90 && d2 > 0) {
      this.held.add(d1);
      this.emit({ type: 'noteon', midi: d1, velocity: d2 / 127, source: 'midi' });
    } else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) {
      this.held.delete(d1);
      this.emit({ type: 'noteoff', midi: d1, source: 'midi' });
    } else if (cmd === 0xb0 && d1 === 64) {
      this.emit({ type: 'pedal', down: d2 >= 64, source: 'midi' });
    }
  }
}

export const midiInput = new MidiInput();

// Clavier d'ordinateur : touches physiques (event.code), indépendant d'AZERTY/QWERTY.
// Rangée du milieu = touches blanches, rangée du haut = touches noires.
export const KEY_CODES = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11,
  KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17,
};

export class ComputerKeyboard {
  constructor() {
    this.base = 60;
    this.down = new Set();
    this.listeners = new Set();
    this.enabled = true;
    this.labels = {};
    this._kd = (e) => this.keydown(e);
    this._ku = (e) => this.keyup(e);
  }
  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(e) {
    for (const fn of this.listeners) fn(e);
  }
  attach() {
    window.addEventListener('keydown', this._kd);
    window.addEventListener('keyup', this._ku);
    // Libellés selon la disposition réelle du clavier (AZERTY affichera Q, Z…)
    navigator.keyboard?.getLayoutMap?.().then((map) => {
      for (const code of Object.keys(KEY_CODES)) this.labels[code] = (map.get(code) || '').toUpperCase();
      this.emit({ type: 'labels' });
    }).catch(() => {});
  }
  label(code) {
    return this.labels[code] || { KeyA: 'A', KeyW: 'W', KeyS: 'S', KeyE: 'E', KeyD: 'D', KeyF: 'F', KeyT: 'T', KeyG: 'G', KeyY: 'Y', KeyH: 'H', KeyU: 'U', KeyJ: 'J', KeyK: 'K', KeyO: 'O', KeyL: 'L', KeyP: 'P', Semicolon: ';', Quote: "'" }[code];
  }
  /** midi -> libellé de touche d'ordinateur */
  labelFor(midi) {
    for (const [code, off] of Object.entries(KEY_CODES)) if (this.base + off === midi) return this.label(code);
    return null;
  }
  isTyping(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }
  keydown(e) {
    if (!this.enabled || this.isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'KeyZ' || e.code === 'KeyX') {
      this.base = Math.max(24, Math.min(96, this.base + (e.code === 'KeyZ' ? -12 : 12)));
      this.emit({ type: 'octave', base: this.base });
      return;
    }
    if (!(e.code in KEY_CODES)) return;
    e.preventDefault();
    if (this.down.has(e.code)) return;
    this.down.add(e.code);
    this.emit({ type: 'noteon', midi: this.base + KEY_CODES[e.code], velocity: 0.75, source: 'keyboard' });
  }
  keyup(e) {
    if (!(e.code in KEY_CODES) || !this.down.has(e.code)) return;
    this.down.delete(e.code);
    this.emit({ type: 'noteoff', midi: this.base + KEY_CODES[e.code], source: 'keyboard' });
  }
}

export const computerKeyboard = new ComputerKeyboard();
