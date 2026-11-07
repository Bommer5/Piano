import test from 'node:test';
import assert from 'node:assert/strict';

class FakeStorage {
  constructor(init = {}) {
    this.m = new Map(Object.entries(init));
  }
  getItem(k) {
    return this.m.has(k) ? this.m.get(k) : null;
  }
  setItem(k, v) {
    this.m.set(k, String(v));
  }
  removeItem(k) {
    this.m.delete(k);
  }
  key(i) {
    return [...this.m.keys()][i] ?? null;
  }
  get length() {
    return this.m.size;
  }
}
function useStorage(init) {
  const s = new FakeStorage(init);
  Object.defineProperty(globalThis, 'localStorage', { value: s, configurable: true, writable: true });
  return s;
}

const { store, streakInfo, localDate, addDays, applySession, conditionKey, isMasteryRun, tempoTier } = await import('../../js/core/storage.js');
const { BADGES, computeStats, findNewBadges } = await import('../../js/core/achievements.js');
const { buildDailyPlan, weakMeasures, pickReviewSong, currentParcoursSong, planProgress, minutesLeft, reviewRange } = await import('../../js/core/plan.js');

test('migration des anciennes données vers le profil « Moi »', () => {
  const ls = useStorage({
    'pianocoach.settings': JSON.stringify({ notation: 'en' }),
    'pianocoach.progress': JSON.stringify({ s1: { best: 80, stars: 2, plays: 3, history: [], timeSec: 60 } }),
    'pianocoach.library': JSON.stringify([{ id: 'imp1', title: 'Import' }]),
  });
  assert.equal(store.currentProfile().name, 'Moi');
  assert.equal(store.settings().notation, 'en');
  assert.equal(store.progress().s1.best, 80);
  assert.ok(store.isOnboarded(), 'un utilisateur existant ne revoit pas l’accueil guidé');
  assert.equal(ls.getItem('pianocoach.settings'), null, 'ancienne clé supprimée');
  assert.ok(ls.getItem('pianocoach.p.moi.progress'));
  assert.equal(store.library().length, 1, 'bibliothèque partagée conservée');
});

test('profils séparés, bibliothèque partagée, export/import par profil', () => {
  useStorage();
  assert.equal(store.isOnboarded(), false);
  store.saveSettings({ ...store.settings(), dailyGoalMin: 5 });
  store.toggleFavorite('a');
  store.saveToLibrary({ id: 'lib1', title: 'X' });
  const leo = store.addProfile({ name: 'Léo', avatar: '🦊' });
  assert.equal(leo.id, 'leo');
  assert.equal(store.addProfile({ name: 'Léo' }).id, 'leo-2');
  assert.ok(store.switchProfile('leo'));
  assert.equal(store.currentProfile().avatar, '🦊');
  assert.equal(store.settings().dailyGoalMin, 15, 'réglages propres au profil');
  assert.deepEqual(store.favorites(), []);
  assert.equal(store.library().length, 1, 'bibliothèque partagée');
  store.recordSession('s1', { score: 90, stars: 2, mode: 'wait', hands: 'R', tempoPct: 100, durationSec: 30 });
  const dump = store.exportAll();
  assert.equal(dump.profile.name, 'Léo');
  assert.ok(dump.progress.s1);
  store.switchProfile('moi');
  assert.deepEqual(store.progress(), {});
  assert.deepEqual(store.favorites(), ['a']);
  store.importAll(dump);
  assert.equal(store.progress().s1.best, 90);
  assert.ok(store.settings().onboarded);
  assert.ok(store.removeProfile('leo-2'));
  assert.equal(store.profiles().length, 2);
  // global : pianocoach.onboarded
  useStorage({ 'pianocoach.onboarded': 'true' });
  assert.ok(store.isOnboarded());
});

test('records par condition et maîtrise honnête', () => {
  assert.equal(tempoTier(60), 50);
  assert.equal(conditionKey({ mode: 'tempo', hands: 'both', tempoPct: 100 }), 'tempo|both|100');
  let p = applySession(null, { score: 100, stars: 3, mode: 'wait', hands: 'R', tempoPct: 100 }, 1);
  assert.equal(p.stars, 3);
  assert.ok(!p.mastered, 'mode attente : pas de maîtrise');
  p = applySession(p, { score: 98, stars: 3, mode: 'tempo', hands: 'R', tempoPct: 100 }, 2);
  assert.ok(!p.mastered, 'une seule main sur un morceau à 2 mains');
  p = applySession(p, { score: 97, stars: 3, mode: 'tempo', hands: 'both', tempoPct: 80 }, 3);
  assert.ok(!p.mastered, 'tempo réduit');
  p = applySession(p, { score: 96, stars: 3, mode: 'tempo', hands: 'both', tempoPct: 100, errorsByMeasure: { 3: 2 }, errorsByNote: { 64: 2 }, worstMeasures: [{ measure: 3, errors: 2 }] }, 4);
  assert.ok(p.mastered);
  assert.equal(p.best, 100);
  assert.equal(p.plays, 4);
  assert.equal(Object.keys(p.conditions).length, 4);
  assert.equal(p.conditions['tempo|both|100'].mastered, true);
  assert.deepEqual(p.history.at(-1).errorsByMeasure, { 3: 2 });
  assert.ok(isMasteryRun({ mode: 'tempo', hands: 'R', tempoPct: 100, stars: 3, twoHanded: false }), 'morceau à une main');
  // le détail des erreurs n'est conservé que pour les 20 dernières sessions
  for (let i = 0; i < 30; i++) p = applySession(p, { score: 50, stars: 0, mode: 'wait', hands: 'R', errorsByMeasure: { 1: 1 } }, 10 + i);
  assert.equal(p.history.length, 34 > 50 ? 50 : 34);
  assert.equal(p.history.filter((x) => x.errorsByMeasure).length, 20);
});

test('série avec gel ❄️', () => {
  const today = '2026-03-20';
  const days = {};
  // 7 jours d'affilée du 1er au 7, trou le 8, reprise du 9 au 12
  for (let i = 0; i < 7; i++) days[addDays('2026-03-01', i)] = 300;
  for (let i = 8; i < 12; i++) days[addDays('2026-03-01', i)] = 300;
  let r = streakInfo(days, '2026-03-12');
  assert.equal(r.streak, 11, 'le gel protège le jour manqué');
  assert.deepEqual(r.frozen, ['2026-03-08']);
  assert.equal(r.freezes, 0);
  assert.equal(r.earnedFreezes, 1);
  // aujourd'hui pas encore joué : la série n'est pas cassée
  r = streakInfo(days, '2026-03-13');
  assert.equal(r.streak, 11);
  // deux jours manqués sans gel : série remise à zéro
  r = streakInfo(days, today);
  assert.equal(r.streak, 0);
  assert.equal(r.best, 11);
  // sans gel
  assert.equal(streakInfo({ '2026-03-01': 1, '2026-03-03': 1 }, '2026-03-03').streak, 1);
  assert.equal(streakInfo({}, today).streak, 0);
  assert.equal(addDays('2026-03-28', 3), '2026-03-31');
  assert.equal(localDate(new Date(2026, 0, 5)), '2026-01-05');
});

test('badges', () => {
  assert.ok(BADGES.length >= 15);
  assert.equal(new Set(BADGES.map((b) => b.id)).size, BADGES.length);
  const stats = computeStats({
    progress: { a: { plays: 2, stars: 3, history: [{ hands: 'L', score: 85 }, { mode: 'tempo', tempoPct: 100, score: 92, hands: 'both', bestStreak: 55 }] } },
    days: { '2026-01-01': 4000 },
    lessons: { l1: 1, 'parcours:a:listen': 1 },
    library: [],
    goalMin: 10,
    streak: { best: 3, earnedFreezes: 0 },
  });
  assert.equal(stats.lessons, 1);
  const ids = findNewBadges(stats, {});
  for (const id of ['first-note', 'streak-3', 'three-stars', 'left-hand', 'both-hands', 'metronome', 'combo-50', 'hour', 'goal']) assert.ok(ids.includes(id), id);
  for (const id of ['streak-7', 'first-import', 'lessons-5', 'mastered']) assert.ok(!ids.includes(id), id);
  assert.deepEqual(findNewBadges(stats, Object.fromEntries(ids.map((i) => [i, 1]))), []);
});

test('recordSession renvoie les nouveaux badges et émet un événement', () => {
  useStorage();
  const got = [];
  const prev = globalThis.dispatchEvent;
  globalThis.dispatchEvent = (e) => got.push(e.detail.badge.id);
  try {
    const r = store.recordSession('s', { score: 100, stars: 3, mode: 'wait', hands: 'R', tempoPct: 100, durationSec: 10 });
    assert.ok(r.newBadges.some((b) => b.id === 'first-note'));
    assert.equal(r.best, 100);
    assert.ok(got.includes('first-note'));
    const r2 = store.recordSession('s', { score: 100, stars: 3, mode: 'wait', hands: 'R', tempoPct: 100, durationSec: 10 });
    assert.ok(!r2.newBadges.some((b) => b.id === 'first-note'), 'pas deux fois');
    assert.ok(store.badges()['first-note']);
  } finally {
    if (prev) globalThis.dispatchEvent = prev;
    else delete globalThis.dispatchEvent;
  }
});

test('séance du jour', () => {
  const progress = {
    old: { stars: 1, last: 100, history: [{ errorsByMeasure: { 5: 3, 6: 1 } }, { errorsByMeasure: { 5: 1, 9: 2 } }] },
    recent: { stars: 2, last: 900, history: [] },
    done: { stars: 3, last: 50, history: [] },
  };
  assert.equal(pickReviewSong(progress), 'old');
  assert.deepEqual(weakMeasures(progress.old).map((w) => w.measure), [5, 9, 6]);
  assert.deepEqual(reviewRange(weakMeasures(progress.old), 20), { from: 5, to: 6 });
  assert.equal(currentParcoursSong({ 'parcours:a:p0-R': 5, 'parcours:b:c:listen': 9, l1: 20 }), 'b:c');
  const steps = buildDailyPlan({
    progress,
    lessonsDone: { l1: 1, 'parcours:p:listen': 1 },
    lessons: [{ id: 'l1', title: 'Un' }, { id: 'l2', title: 'Deux' }],
    parcours: { songId: 'p', title: 'P', steps: [{ id: 'listen', title: 'Écoute' }, { id: 'p0-R', title: 'Phrase 1' }] },
    songInfo: (id) => ({ title: id.toUpperCase(), measureCount: 12 }),
  });
  assert.deepEqual(steps.map((s) => s.kind), ['warmup', 'review', 'parcours', 'lesson']);
  assert.match(steps[1].href, /#\/jouer\/old\?from=5&to=6&loop=1/);
  assert.equal(steps[2].id, 'parcours:p:p0-R');
  assert.equal(steps[3].data.lessonId, 'l2');
  const pr = planProgress(steps, ['warmup', 'review:old']);
  assert.equal(pr.done, 2);
  assert.equal(pr.next, 2);
  assert.ok(!pr.complete);
  assert.ok(planProgress(steps, steps.map((s) => s.id)).complete);
  // rien à réviser, pas de parcours
  assert.deepEqual(buildDailyPlan({}).map((s) => s.kind), ['warmup']);
  assert.equal(minutesLeft(240, 10), 6);
  assert.equal(minutesLeft(900, 10), 0);
});

test('glossaire', async () => {
  const { GLOSSARY, getTerm, searchGlossary } = await import('../../js/data/glossary.js');
  assert.ok(GLOSSARY.length >= 40);
  assert.equal(new Set(GLOSSARY.map((t) => t.id)).size, GLOSSARY.length);
  for (const id of ['mesure', 'tempo', 'bpm', 'transposer', 'tonalite', 'armure', 'croche', 'noire', 'doigte', 'cle-sol', 'cle-fa', 'legato', 'staccato', 'nuances', 'pedale', 'gamme', 'accord', 'renversement', 'levee']) assert.ok(getTerm(id), id);
  assert.equal(searchGlossary('cle de')[0].id.startsWith('cle-'), true);
});
