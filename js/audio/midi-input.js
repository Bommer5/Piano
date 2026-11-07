// Entrées de notes : clavier MIDI (Web MIDI), clavier d'ordinateur.
// Les événements portent `t` (performance.now(), ms) : MIDIMessageEvent.timeStamp / KeyboardEvent.timeStamp.
import { store } from '../core/storage.js';
import { midiOutput } from './midi-output.js';

/** Le nom ressemble-t-il à un piano numérique / instrument qui produit déjà son propre son ? */
export function deviceMakesSound(name) {
  const n = String(name || '').toLowerCase();
  if (/keystation|launchkey|launchpad|mpk|minilab|keylab|oxygen|impulse|nektar|impact|microkey|komplete|axiom|code ?\d|controller|contrôleur|lpk|seaboard|midiplus|arturia/.test(n)) return false;
  return /piano|digital|clavinova|arius|privia|celviano|cdp|ydp|clp|cvp|p-\d|p\d{2,3}\b|fp-|rd-|hp\d|lx\d|kawai|nord|stage|es\d{3}|ca\d{2}|dgx|psr|yamaha|casio|roland|korg|kurzweil|synth|workstation/.test(n);
}

/**
 * Décode un message MIDI entrant (Web MIDI fournit des messages complets : pas de running status).
 * @returns {object|null} {type:'noteon'|'noteoff'|'cc'|'pitchbend'|'program', channel(1-16), …}
 */
export function parseMidiMessage(data) {
  if (!data || data.length < 1) return null;
  const status = data[0];
  if (status < 0x80 || status >= 0xf0) return null; // horloge, sysex… ignorés
  const cmd = status & 0xf0;
  const channel = (status & 0x0f) + 1;
  const d1 = data[1] ?? 0, d2 = data[2] ?? 0;
  if (cmd === 0x90 && d2 > 0) return { type: 'noteon', channel, midi: d1, velocity: d2 / 127, rawVelocity: d2 };
  if (cmd === 0x80 || cmd === 0x90) return { type: 'noteoff', channel, midi: d1, releaseVelocity: d2 / 127 };
  if (cmd === 0xb0) return { type: 'cc', channel, cc: d1, value: d2 };
  if (cmd === 0xe0) return { type: 'pitchbend', channel, value: ((d2 << 7) | d1) - 8192 };
  if (cmd === 0xc0) return { type: 'program', channel, program: d1 };
  return null;
}

export class MidiInput {
  constructor() {
    this.listeners = new Set();
    this.devices = []; // noms des entrées actives (compatibilité)
    this.inputs = []; // [{id, name, manufacturer, enabled}]
    this.access = null;
    this.held = new Set();
    this.selected = null; // null = toutes les entrées ; sinon tableau d'id
    this.channel = 0; // 0 = tous les canaux
    this.applySettings(store.settings());
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
  /** Réglages : midiInputIds (null = tous), midiInChannel (0 = tous). */
  applySettings(s = {}) {
    this.selected = Array.isArray(s.midiInputIds) ? s.midiInputIds : null;
    this.channel = Number(s.midiInChannel ?? 0) || 0;
    if (this.access) this.bind();
  }
  async init() {
    if (!this.supported) return [];
    if (this.access) return this.devices;
    this.access = await navigator.requestMIDIAccess();
    this.access.onstatechange = () => this.bind();
    this.bind();
    return this.devices;
  }
  bind() {
    this.devices = [];
    this.inputs = [];
    for (const input of this.access.inputs.values()) {
      const enabled = !this.selected || this.selected.includes(input.id);
      this.inputs.push({ id: input.id, name: input.name || 'Clavier MIDI', manufacturer: input.manufacturer || '', enabled });
      if (enabled) {
        this.devices.push(input.name);
        input.onmidimessage = (m) => this.handle(m.data, m.timeStamp, input.name);
      } else input.onmidimessage = null;
    }
    this.applyAutoLocalSound();
    this.emit({ type: 'devices', devices: this.devices, inputs: this.inputs });
  }
  /** Mode « automatique » du son local : coupé si l'appareil branché produit déjà le son. */
  autoLocalSound() {
    if (!this.devices.length) return null;
    return !this.devices.some(deviceMakesSound);
  }
  applyAutoLocalSound() {
    const s = store.settings();
    if ((s.midiLocalSoundMode ?? 'auto') !== 'auto') return;
    const want = this.autoLocalSound();
    if (want == null || s.midiLocalSound === want) return;
    store.saveSettings({ ...s, midiLocalSound: want });
  }
  handle(data, timeStamp, device = '') {
    const msg = parseMidiMessage(data);
    if (!msg) return;
    if (this.channel && msg.channel !== this.channel) return;
    const t = typeof timeStamp === 'number' && timeStamp > 0 ? timeStamp : (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const base = { source: 'midi', t, channel: msg.channel, device };
    if (msg.type === 'noteon') {
      this.held.add(msg.midi);
      midiOutput.markIncoming(msg.midi, device, t);
      this.emit({ ...base, type: 'noteon', midi: msg.midi, velocity: msg.velocity });
    } else if (msg.type === 'noteoff') {
      this.held.delete(msg.midi);
      this.emit({ ...base, type: 'noteoff', midi: msg.midi });
    } else if (msg.type === 'cc') {
      if ([64, 66, 67].includes(msg.cc)) {
        midiOutput.markIncomingCC(msg.cc, device, t);
        this.emit({ ...base, type: 'cc', cc: msg.cc, value: msg.value });
      }
      if (msg.cc === 64) this.emit({ ...base, type: 'pedal', down: msg.value >= 64, value: msg.value });
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
    this.down = new Map(); // code -> midi joué (pour relâcher la bonne note après un changement d'octave)
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
    window.addEventListener('blur', () => this.releaseAll());
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
    const midi = this.base + KEY_CODES[e.code];
    this.down.set(e.code, midi);
    this.emit({ type: 'noteon', midi, velocity: 0.75, source: 'keyboard', t: e.timeStamp || performance.now() });
  }
  keyup(e) {
    if (!this.down.has(e.code)) return;
    const midi = this.down.get(e.code);
    this.down.delete(e.code);
    this.emit({ type: 'noteoff', midi, source: 'keyboard', t: e.timeStamp || performance.now() });
  }
  releaseAll() {
    for (const [code, midi] of this.down) this.emit({ type: 'noteoff', midi, source: 'keyboard' });
    this.down.clear();
  }
}

export const computerKeyboard = new ComputerKeyboard();
