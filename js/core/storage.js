// Persistance locale (localStorage), tolérante aux erreurs (navigation privée, quota…).
//
// Profils : plusieurs joueurs dans le même navigateur. Les données personnelles sont rangées
// sous `pianocoach.p.<profil>.<clé>` (réglages, progrès, jours, leçons, favoris, badges…) ;
// la bibliothèque d'imports (`pianocoach.library`) est partagée entre les profils.
// Au premier chargement, les anciennes clés (`pianocoach.settings`…) sont migrées vers un
// profil « Moi ».
import { BADGES, computeStats, findNewBadges } from './achievements.js';

const PREFIX = 'pianocoach.';
/** Clés propres à chaque profil. */
export const PROFILE_KEYS = ['settings', 'progress', 'days', 'lessons', 'favorites', 'badges', 'plan', 'goals', 'teacherNotes'];
/** Clés partagées par tous les profils. */
export const SHARED_KEYS = ['library'];
const DEFAULT_PROFILE = { id: 'moi', name: 'Moi', avatar: '🙂' };
export const AVATARS = ['🙂', '🦊', '🐼', '🐱', '🐶', '🦁', '🐸', '🐵', '🦄', '🐧', '🐙', '🐢', '🚀', '🌟', '🎸', '🎹'];

/** Date locale AAAA-MM-JJ (et non UTC : une séance à 0h30 compte pour le bon jour). */
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Ajoute n jours à une date locale AAAA-MM-JJ. */
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n, 12);
  return localDate(dt);
}

function ls() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}
function rawRead(fullKey, fallback) {
  try {
    const v = ls()?.getItem(fullKey);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function rawWrite(fullKey, value) {
  try {
    const s = ls();
    if (!s) return false;
    s.setItem(fullKey, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
function rawRemove(fullKey) {
  try {
    ls()?.removeItem(fullKey);
  } catch { /* ignore */ }
}

// État des profils en mémoire si le stockage est indisponible (navigation privée stricte, Node).
let memProfiles = null;

/** Liste des profils + profil courant ; migre les anciennes données si besoin. */
function profilesState() {
  const st = rawRead(PREFIX + 'profiles', null);
  if (st && Array.isArray(st.list) && st.list.length) {
    if (!st.list.some((p) => p.id === st.current)) st.current = st.list[0].id;
    return st;
  }
  if (!ls()) return (memProfiles ||= { list: [{ ...DEFAULT_PROFILE, createdAt: Date.now() }], current: DEFAULT_PROFILE.id });
  return migrateLegacy();
}

/** Déplace les anciennes clés `pianocoach.<clé>` vers le profil « Moi ». */
export function migrateLegacy() {
  const id = DEFAULT_PROFILE.id;
  let had = false;
  const s = ls();
  for (const k of PROFILE_KEYS) {
    let v = null;
    try {
      v = s?.getItem(PREFIX + k);
    } catch { /* ignore */ }
    if (v != null) {
      try {
        s.setItem(`${PREFIX}p.${id}.${k}`, v);
        s.removeItem(PREFIX + k);
        had = true;
      } catch { /* ignore */ }
    }
  }
  if (had) {
    // Utilisateur existant : pas d'accueil guidé.
    const key = `${PREFIX}p.${id}.settings`;
    rawWrite(key, { ...rawRead(key, {}), onboarded: true });
  }
  const st = { list: [{ ...DEFAULT_PROFILE, createdAt: Date.now() }], current: id };
  rawWrite(PREFIX + 'profiles', st);
  return st;
}

function saveProfiles(st) {
  if (!rawWrite(PREFIX + 'profiles', st)) memProfiles = st;
}

function currentId() {
  return profilesState().current;
}

function fullKey(key, profileId) {
  return SHARED_KEYS.includes(key) ? PREFIX + key : `${PREFIX}p.${profileId || currentId()}.${key}`;
}
function read(key, fallback) {
  return rawRead(fullKey(key), fallback);
}
function write(key, value) {
  return rawWrite(fullKey(key), value);
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
  octaveTolerant: true, // le micro confond parfois les octaves : la note est acceptée…
  octaveWarning: true, // … mais l'avertissement « bonne note, mauvaise octave » est affiché
  midiLocalSound: true, // jouer le son de l'app pour les notes d'un clavier MIDI (désactiver avec un piano numérique)
  micSensitivity: 0.012,
  latencyMs: 0,
  theme: 'auto',
  instrument: 'piano',
  dailyGoalMin: 15,
  view: 'both', // 'staff' | 'roll' | 'both'
  // Profil, accueil guidé, accessibilité
  onboarded: false,
  player: 'adult', // 'adult' | 'child'
  inputMode: null, // 'midi' | 'mic' | 'keyboard'
  kidMode: false, // interface simplifiée et ludique pour les enfants
  tts: false, // lecture vocale des consignes (speechSynthesis fr-FR)
  bigUi: false, // grande taille
  cbSafe: false, // couleurs pour daltoniens (bleu/orange) + symboles ✓/✗
  contrast: false, // contraste renforcé
  reminder: false, // rappel quotidien (API Notification, onglet ouvert)
  reminderHour: 18,
};

// ---------- séries (pur) ----------
/**
 * Série de jours de pratique avec gels ❄️ : un gel est gagné tous les 7 jours consécutifs
 * (2 au maximum) et protège automatiquement un jour manqué.
 * @param {Record<string, number>} days secondes de pratique par date locale
 * @param {string} today date locale AAAA-MM-JJ
 * @returns {{streak:number, best:number, freezes:number, frozen:string[], earnedFreezes:number}}
 */
export function streakInfo(days = {}, today = localDate()) {
  const keys = Object.keys(days).filter((k) => days[k] > 0 && k <= today).sort();
  const res = { streak: 0, best: 0, freezes: 0, frozen: [], earnedFreezes: 0 };
  if (!keys.length) return res;
  let d = keys[0];
  let streak = 0, freezes = 0;
  const frozen = [];
  for (let guard = 0; d <= today && guard < 20000; guard++, d = addDays(d, 1)) {
    if (days[d] > 0) {
      streak++;
      if (streak % 7 === 0) {
        res.earnedFreezes++;
        freezes = Math.min(2, freezes + 1);
      }
      res.best = Math.max(res.best, streak);
    } else if (d === today) {
      break; // la journée n'est pas finie
    } else if (freezes > 0 && streak > 0) {
      freezes--;
      frozen.push(d);
    } else {
      streak = 0;
    }
  }
  return { ...res, streak, freezes, frozen };
}

// ---------- records (pur) ----------
/** Palier de tempo d'une session : 25, 50, 75 ou 100 (%). */
export function tempoTier(pct = 100) {
  return pct >= 100 ? 100 : pct >= 75 ? 75 : pct >= 50 ? 50 : 25;
}
/** Clé de condition « mode|mains|palier ». */
export function conditionKey(r = {}) {
  return `${r.mode || 'wait'}|${r.hands || 'both'}|${tempoTier(r.tempoPct ?? 100)}`;
}
/** Libellé lisible d'une condition. */
export function conditionLabel(key) {
  const [mode, hands, tier] = key.split('|');
  const m = { wait: 'Attente', tempo: 'Tempo', listen: 'Écoute' }[mode] || mode;
  const hh = { both: '2 mains', R: 'main droite', L: 'main gauche' }[hands] || hands;
  return `${m} · ${hh} · ${tier === '100' ? '100 %' : '≥ ' + tier + ' %'}`;
}
/**
 * Une session « maîtrise » un morceau seulement en mode Tempo, à ≥ 100 % du tempo,
 * aux 2 mains (si le morceau en a 2) et avec 3 étoiles.
 * `result.twoHanded === false` (ou `result.songHands` à une main) signale un morceau à une main.
 */
export function isMasteryRun(r = {}) {
  const oneHandSong = r.twoHanded === false || (r.songHands && !(r.songHands.R && r.songHands.L));
  return r.mode === 'tempo' && (r.tempoPct ?? 100) >= 100 && (r.hands === 'both' || (oneHandSong && !!r.hands)) && (r.stars || 0) >= 3;
}

/** Met à jour l'entrée de progrès d'un morceau (pur). */
export function applySession(entry, result, now = Date.now()) {
  const p = { best: 0, stars: 0, plays: 0, history: [], timeSec: 0, ...(entry || {}) };
  p.plays++;
  p.best = Math.max(p.best, result.score || 0);
  p.stars = Math.max(p.stars, result.stars || 0);
  p.timeSec += result.durationSec || 0;
  p.last = now;
  const cond = conditionKey(result);
  const conditions = { ...(p.conditions || {}) };
  const c = { best: 0, stars: 0, plays: 0, ...(conditions[cond] || {}) };
  c.plays++;
  c.best = Math.max(c.best, result.score || 0);
  c.stars = Math.max(c.stars, result.stars || 0);
  c.last = now;
  const mastery = isMasteryRun(result);
  if (mastery) c.mastered = true;
  conditions[cond] = c;
  p.conditions = conditions;
  if (mastery) {
    p.mastered = true;
    p.masteredAt ||= now;
  }
  const item = { at: now, score: result.score, stars: result.stars, mode: result.mode, hands: result.hands, tempoPct: result.tempoPct, durationSec: result.durationSec };
  if (result.bestStreak != null) item.bestStreak = result.bestStreak;
  if (result.errorsByMeasure) item.errorsByMeasure = result.errorsByMeasure;
  if (result.errorsByNote) item.errorsByNote = result.errorsByNote;
  if (result.worstMeasures) item.worstMeasures = result.worstMeasures;
  if (result.from != null) item.from = result.from;
  if (result.to != null) item.to = result.to;
  const hist = [...(p.history || []), item].slice(-50);
  // On ne garde le détail des erreurs que pour les 20 dernières sessions (quota).
  p.history = hist.map((x, i) => (i < hist.length - 20 ? stripErrors(x) : x));
  return p;
}
function stripErrors(x) {
  if (!x.errorsByMeasure && !x.errorsByNote && !x.worstMeasures) return x;
  const { errorsByMeasure, errorsByNote, worstMeasures, ...rest } = x;
  return rest;
}

function emit(name, detail) {
  try {
    if (typeof globalThis.dispatchEvent === 'function' && typeof CustomEvent === 'function') globalThis.dispatchEvent(new CustomEvent(name, { detail }));
  } catch { /* ignore */ }
}

export const store = {
  // ---------- profils ----------
  profiles() {
    return profilesState().list;
  },
  currentProfile() {
    const st = profilesState();
    return st.list.find((p) => p.id === st.current) || st.list[0];
  },
  /** Crée un profil (sans changer de profil courant). */
  addProfile({ name, avatar } = {}) {
    const st = profilesState();
    const base = String(name || 'Joueur').trim().slice(0, 24) || 'Joueur';
    let id = base.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'joueur';
    let n = 1;
    const taken = new Set(st.list.map((p) => p.id));
    const root = id;
    while (taken.has(id)) id = `${root}-${++n}`;
    const p = { id, name: base, avatar: avatar || AVATARS[st.list.length % AVATARS.length], createdAt: Date.now() };
    st.list.push(p);
    saveProfiles(st);
    return p;
  },
  updateProfile(id, patch = {}) {
    const st = profilesState();
    const p = st.list.find((x) => x.id === id);
    if (!p) return null;
    if (patch.name != null) p.name = String(patch.name).trim().slice(0, 24) || p.name;
    if (patch.avatar) p.avatar = patch.avatar;
    saveProfiles(st);
    return p;
  },
  switchProfile(id) {
    const st = profilesState();
    if (!st.list.some((p) => p.id === id)) return false;
    st.current = id;
    saveProfiles(st);
    emit('pianocoach:profile', { id });
    return true;
  },
  /** Supprime un profil et ses données (le dernier profil ne peut pas être supprimé). */
  removeProfile(id) {
    const st = profilesState();
    if (st.list.length <= 1 || !st.list.some((p) => p.id === id)) return false;
    for (const k of PROFILE_KEYS) rawRemove(fullKey(k, id));
    st.list = st.list.filter((p) => p.id !== id);
    if (st.current === id) st.current = st.list[0].id;
    saveProfiles(st);
    return true;
  },
  /** Lecture/écriture génériques d'une clé du profil courant (pour les autres modules). */
  get(key, fallback) {
    return read(key, fallback);
  },
  set(key, value) {
    return write(key, value);
  },

  // ---------- réglages ----------
  settings() {
    return { ...DEFAULT_SETTINGS, ...read('settings', {}) };
  },
  saveSettings(s) {
    write('settings', s);
  },
  /** Accueil guidé déjà fait (ou désactivé globalement par `pianocoach.onboarded`). */
  isOnboarded() {
    return !!store.settings().onboarded || !!rawRead(PREFIX + 'onboarded', false);
  },

  // ---------- progrès ----------
  progress() {
    return read('progress', {});
  },
  /**
   * Enregistre un résultat de session.
   * result : {score, stars, mode, hands, tempoPct, durationSec, [bestStreak, errorsByMeasure, errorsByNote, worstMeasures, twoHanded, songHands, from, to]}
   * @returns l'entrée de progrès du morceau, avec `newBadges` (badges gagnés à cette session).
   */
  recordSession(songId, result = {}) {
    const all = read('progress', {});
    const now = Date.now();
    const p = applySession(all[songId], result, now);
    all[songId] = p;
    write('progress', all);
    const days = read('days', {});
    const today = localDate();
    days[today] = (days[today] || 0) + (result.durationSec || 0);
    write('days', days);
    const newBadges = store.checkBadges();
    return { ...p, newBadges };
  },
  practiceDays() {
    return read('days', {});
  },
  streak() {
    return streakInfo(read('days', {}), localDate()).streak;
  },
  streakInfo() {
    return streakInfo(read('days', {}), localDate());
  },
  lessonsDone() {
    return read('lessons', {});
  },
  markLesson(id, done = true) {
    const l = read('lessons', {});
    if (done) l[id] = Date.now();
    else delete l[id];
    write('lessons', l);
    if (done) store.checkBadges();
  },
  library() {
    return read('library', []);
  },
  saveToLibrary(song) {
    const lib = read('library', []).filter((s) => s.id !== song.id);
    lib.push(song);
    const ok = write('library', lib);
    if (ok) store.checkBadges();
    return ok;
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

  // ---------- badges ----------
  /** Badges gagnés : {id: timestamp}. */
  badges() {
    return read('badges', {});
  },
  stats() {
    const s = store.settings();
    return computeStats({ progress: read('progress', {}), days: read('days', {}), lessons: read('lessons', {}), library: read('library', []), goalMin: s.dailyGoalMin, streak: store.streakInfo() });
  },
  /** Vérifie les badges, enregistre et annonce (événement `pianocoach:badge`) les nouveaux. */
  checkBadges() {
    const earned = read('badges', {});
    const ids = findNewBadges(store.stats(), earned);
    if (!ids.length) return [];
    const now = Date.now();
    for (const id of ids) earned[id] = now;
    write('badges', earned);
    const list = ids.map((id) => BADGES.find((b) => b.id === id));
    for (const badge of list) emit('pianocoach:badge', { badge, profile: store.currentProfile() });
    return list;
  },

  // ---------- séance du jour, carnet du professeur ----------
  /** Étapes cochées de la séance du jour : {date, done:[ids]}. */
  planState() {
    const st = read('plan', null);
    return st && st.date === localDate() ? st : { date: localDate(), done: [] };
  },
  setPlanStep(id, done = true) {
    const st = store.planState();
    const set = new Set(st.done);
    done ? set.add(id) : set.delete(id);
    write('plan', { date: st.date, done: [...set] });
  },
  goals() {
    return read('goals', []);
  },
  saveGoals(list) {
    write('goals', list);
  },
  teacherNotes() {
    return read('teacherNotes', []);
  },
  saveTeacherNotes(list) {
    write('teacherNotes', list);
  },

  // ---------- sauvegarde ----------
  /** Exporte les données du profil courant (+ bibliothèque partagée). */
  exportAll() {
    const out = { version: 2, profile: { ...store.currentProfile() } };
    for (const k of [...PROFILE_KEYS, ...SHARED_KEYS]) out[k] = read(k, null);
    return out;
  },
  /** Importe une sauvegarde dans le profil courant (formats ancien et nouveau). */
  importAll(data) {
    for (const [k, v] of Object.entries(data || {})) {
      if (v == null || !(PROFILE_KEYS.includes(k) || SHARED_KEYS.includes(k))) continue;
      if (k === 'library' && Array.isArray(v)) {
        // fusion : ne pas écraser les imports des autres profils
        const lib = read('library', []);
        const ids = new Set(v.map((s) => s.id));
        write('library', [...lib.filter((s) => !ids.has(s.id)), ...v]);
      } else if (k === 'settings') write(k, { ...v, onboarded: true });
      else write(k, v);
    }
  },
};
