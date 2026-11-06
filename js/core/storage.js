// Persistance locale (localStorage), tolérante aux erreurs (navigation privée, quota…).

const PREFIX = 'pianocoach.';

/** Date locale AAAA-MM-JJ (et non UTC : une séance à 0h30 compte pour le bon jour). */
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function read(key, fallback) {
  try {
    const v = globalThis.localStorage?.getItem(PREFIX + key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    globalThis.localStorage?.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const DEFAULT_SETTINGS = {
  notation: 'fr', // 'fr' (Do Ré Mi) ou 'en' (C D E)
  a4: 440,
  showNoteNames: true,
  showFingers: true,
  showKeyboardLabels: false,
  volume: 0.7,
  metronome: false,
  countIn: true,
  octaveTolerant: true,
  midiLocalSound: true, // jouer le son de l'app pour les notes d'un clavier MIDI (désactiver avec un piano numérique)
  micSensitivity: 0.012,
  latencyMs: 0,
  theme: 'auto',
  instrument: 'piano',
  dailyGoalMin: 15,
  view: 'both', // 'staff' | 'roll' | 'both'
};

export const store = {
  settings() {
    return { ...DEFAULT_SETTINGS, ...read('settings', {}) };
  },
  saveSettings(s) {
    write('settings', s);
  },
  progress() {
    return read('progress', {});
  },
  /** Enregistre un résultat de session. */
  recordSession(songId, result) {
    const all = read('progress', {});
    const p = all[songId] || { best: 0, stars: 0, plays: 0, history: [], timeSec: 0 };
    p.plays++;
    p.best = Math.max(p.best, result.score || 0);
    p.stars = Math.max(p.stars, result.stars || 0);
    p.timeSec += result.durationSec || 0;
    p.last = Date.now();
    p.history = [...p.history, { at: Date.now(), score: result.score, mode: result.mode, hands: result.hands, tempoPct: result.tempoPct }].slice(-50);
    all[songId] = p;
    write('progress', all);
    const days = read('days', {});
    const today = localDate();
    days[today] = (days[today] || 0) + (result.durationSec || 0);
    write('days', days);
    return p;
  },
  practiceDays() {
    return read('days', {});
  },
  streak() {
    const days = read('days', {});
    let n = 0;
    const d = new Date();
    if (!days[localDate(d)]) d.setDate(d.getDate() - 1);
    while (days[localDate(d)]) {
      n++;
      d.setDate(d.getDate() - 1);
    }
    return n;
  },
  lessonsDone() {
    return read('lessons', {});
  },
  markLesson(id, done = true) {
    const l = read('lessons', {});
    if (done) l[id] = Date.now();
    else delete l[id];
    write('lessons', l);
  },
  library() {
    return read('library', []);
  },
  saveToLibrary(song) {
    const lib = read('library', []).filter((s) => s.id !== song.id);
    lib.push(song);
    return write('library', lib);
  },
  removeFromLibrary(id) {
    write('library', read('library', []).filter((s) => s.id !== id));
  },
  favorites() {
    return read('favorites', []);
  },
  toggleFavorite(id) {
    const f = new Set(read('favorites', []));
    f.has(id) ? f.delete(id) : f.add(id);
    write('favorites', [...f]);
    return f.has(id);
  },
  exportAll() {
    const out = {};
    for (const k of ['settings', 'progress', 'days', 'lessons', 'library', 'favorites']) out[k] = read(k, null);
    return out;
  },
  importAll(data) {
    for (const [k, v] of Object.entries(data || {})) if (v != null) write(k, v);
  },
};
