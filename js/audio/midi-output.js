// Sortie MIDI : l'accompagnement, le mode Écoute et le métronome peuvent jouer sur le clavier de l'utilisateur.
// Messages horodatés (output.send(data, timestamp) en temps performance.now()).
import { store } from '../core/storage.js';

export const MIDI_PROGRAMS = { piano: 0, epiano: 4, orgue: 19, clavecin: 6 };
export const METRONOME_NOTE = 37; // Side stick (General MIDI, canal 10)
export const METRONOME_CHANNEL = 10;

const clamp7 = (v) => Math.max(0, Math.min(127, Math.round(v)));
const chIdx = (ch) => (Math.max(1, Math.min(16, ch | 0)) - 1) & 0x0f;
export const noteOnMsg = (ch, note, vel01) => [0x90 | chIdx(ch), clamp7(note), Math.max(1, clamp7(vel01 * 127))];
export const noteOffMsg = (ch, note) => [0x80 | chIdx(ch), clamp7(note), 64];
export const ccMsg = (ch, cc, value) => [0xb0 | chIdx(ch), clamp7(cc), clamp7(value)];
export const programMsg = (ch, program) => [0xc0 | chIdx(ch), clamp7(program)];
/** Pédale relevée + All Notes Off + All Sound Off. */
export const allNotesOffMsgs = (ch) => [ccMsg(ch, 64, 0), ccMsg(ch, 123, 0), ccMsg(ch, 120, 0)];

/** Nom de port normalisé (pour reconnaître l'entrée et la sortie d'un même appareil). */
export function normalizePortName(name) {
  return String(name || '').toLowerCase().replace(/\b(midi|in|out|input|output|port|usb)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').replace(/\b\d+\b/g, ' ').trim().replace(/\s+/g, ' ');
}
export function sameDevice(a, b) {
  const x = normalizePortName(a), y = normalizePortName(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
}

export class MidiOutput {
  constructor() {
    this.access = null;
    this.outputs = []; // [{id, name}]
    this.port = null;
    this.enabled = false;
    this.portId = null;
    this.channel = 1;
    this.mode = 'both'; // 'both' : son de l'app + MIDI ; 'midi' : MIDI seulement
    this.metronome = true;
    this.sendProgram = false;
    this.lastProgram = null;
    this.sounding = new Map(); // note -> nombre de notes en cours
    this.incoming = new Map(); // note -> {t, device} notes reçues récemment (anti-écho)
    this.incomingCC = new Map();
    this.listeners = new Set();
    this.now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    this.configure(store.settings());
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

  /** Applique les réglages (midiOut*). */
  configure(s = {}) {
    const wasActive = this.active;
    this.enabled = !!s.midiOutEnabled;
    this.portId = s.midiOutId ?? null;
    this.channel = s.midiOutChannel ?? 1;
    this.mode = s.midiOutMode === 'midi' ? 'midi' : 'both';
    this.metronome = s.midiOutMetronome ?? true;
    this.sendProgram = !!s.midiOutProgram;
    this.lastProgram = null;
    this._pick();
    if (wasActive && !this.active) this.allNotesOff();
    if (this.enabled && !this.access && this.supported) this.init().catch(() => {});
  }

  async init() {
    if (!this.supported) return [];
    if (this.access) return this.outputs;
    this.access = await navigator.requestMIDIAccess();
    const bind = () => {
      this.outputs = [...this.access.outputs.values()].map((o) => ({ id: o.id, name: o.name || 'Sortie MIDI' }));
      this._pick();
      this.emit({ type: 'devices', outputs: this.outputs });
    };
    this.access.addEventListener?.('statechange', bind);
    bind();
    return this.outputs;
  }

  _pick() {
    if (!this.access) return;
    const all = [...this.access.outputs.values()];
    this.port = all.find((o) => o.id === this.portId) || (this.portId ? all.find((o) => o.name === this.portId) : null) || (!this.portId ? all[0] : null) || null;
  }

  /** Pour les tests : port de sortie simulé. */
  setPort(port) {
    this.port = port;
  }

  get active() {
    return !!(this.enabled && this.port);
  }
  /** 'local' (pas de MIDI), 'both' ou 'midi'. */
  routing() {
    return this.active ? this.mode : 'local';
  }
  get deviceName() {
    return this.port?.name || '';
  }

  send(data, ts) {
    if (!this.port) return;
    try {
      const now = this.now();
      if (ts != null && ts > now + 1) this.port.send(data, ts);
      else this.port.send(data);
    } catch (e) {
      console.warn('MIDI out', e);
    }
  }

  /** Une note vient d'arriver d'un clavier MIDI : on ne la renverra pas au même appareil (écho). */
  markIncoming(note, device, t = this.now()) {
    this.incoming.set(note, { t, device });
  }
  markIncomingCC(cc, device, t = this.now()) {
    this.incomingCC.set(cc, { t, device });
  }
  isEcho(map, key, ts) {
    const inc = map.get(key);
    return !!inc && Math.abs((ts ?? this.now()) - inc.t) < 80 && sameDevice(inc.device, this.deviceName);
  }

  /**
   * Note On (et Note Off programmé si dur est donné).
   * @param {number} ts instant performance.now() (ms) ; durMs : durée (ms) ou null (relâchement manuel)
   * @returns {boolean} true si la note a été envoyée
   */
  noteOn(note, velocity, ts, durMs = null, instrument = null) {
    if (!this.active) return false;
    if (this.isEcho(this.incoming, note, ts)) return false;
    if (this.sendProgram && instrument && MIDI_PROGRAMS[instrument] != null && MIDI_PROGRAMS[instrument] !== this.lastProgram) {
      this.lastProgram = MIDI_PROGRAMS[instrument];
      this.send(programMsg(this.channel, this.lastProgram), ts);
    }
    this.send(noteOnMsg(this.channel, note, velocity), ts);
    this.sounding.set(note, (this.sounding.get(note) || 0) + 1);
    if (durMs != null) {
      const off = (ts ?? this.now()) + Math.max(20, durMs);
      if (durMs <= 2000) {
        this.send(noteOffMsg(this.channel, note), off);
        this._dec(note);
      } else {
        // note longue : relâchement envoyé plus tard (sinon un Note Off en attente couperait une frappe suivante)
        const tok = {};
        this._longs = this._longs || new Map();
        this._longs.set(note, tok);
        setTimeout(() => {
          if (this._longs.get(note) === tok) this.noteOff(note);
        }, Math.max(0, off - this.now()));
      }
    }
    return true;
  }

  _dec(note) {
    const c = (this.sounding.get(note) || 0) - 1;
    if (c > 0) this.sounding.set(note, c);
    else this.sounding.delete(note);
  }

  noteOff(note, ts) {
    if (!this.port) return;
    this._longs?.delete(note);
    this.send(noteOffMsg(this.channel, note), ts);
    this._dec(note);
  }

  /** Clic de métronome : note 37, canal 10. */
  click(ts, accent = false) {
    if (!this.active || !this.metronome) return false;
    this.send(noteOnMsg(METRONOME_CHANNEL, METRONOME_NOTE, accent ? 0.9 : 0.6), ts);
    this.send(noteOffMsg(METRONOME_CHANNEL, METRONOME_NOTE), (ts ?? this.now()) + 60);
    return true;
  }

  sustain(down, ts) {
    if (!this.active) return;
    if (this.isEcho(this.incomingCC, 64, ts)) return;
    this.send(ccMsg(this.channel, 64, down ? 127 : 0), ts);
  }

  /** Coupe tout : Note Off explicites + All Notes Off (les messages déjà programmés sont annulés si possible). */
  allNotesOff() {
    if (!this.port) return;
    try { this.port.clear?.(); } catch {}
    for (const note of this.sounding.keys()) this.send(noteOffMsg(this.channel, note));
    this.sounding.clear();
    this._longs?.clear();
    for (const m of allNotesOffMsgs(this.channel)) this.send(m);
  }
}

export const midiOutput = new MidiOutput();
