// Vue : progrès (calendrier « chaîne », badges, records par condition, sauvegarde)
import { store, localDate, addDays, conditionLabel } from '../core/storage.js';
import { BADGES } from '../core/achievements.js';
import { h, toast, download, stars } from '../ui/dom.js';
import { ctx, main, registerRoute, findSong, section, statCard } from '../ui/context.js';

/** Calendrier « chaîne » des 5 dernières semaines (lundi → dimanche). */
export function chainCalendar(days, goalMin, frozen = []) {
  const today = localDate();
  const dow = (new Date().getDay() + 6) % 7; // 0 = lundi
  const start = addDays(today, -dow - 28);
  const frozenSet = new Set(frozen);
  const grid = h('div', { class: 'chain', role: 'grid', 'aria-label': 'Calendrier de pratique des 5 dernières semaines' });
  for (const d of ['L', 'M', 'M', 'J', 'V', 'S', 'D']) grid.append(h('span', { class: 'chain-dow', 'aria-hidden': 'true' }, d));
  for (let i = 0; i < 35; i++) {
    const k = addDays(start, i);
    const sec = days[k] || 0;
    const future = k > today;
    const state = future ? 'future' : sec >= goalMin * 60 ? 'full' : sec > 0 ? 'half' : frozenSet.has(k) ? 'frozen' : 'empty';
    const label = { full: 'objectif atteint', half: `${Math.round(sec / 60)} min (objectif non atteint)`, frozen: 'jour protégé par un gel ❄️', empty: 'pas de pratique', future: 'à venir' }[state];
    const [, m, dd] = k.split('-');
    grid.append(h('span', { class: `chain-day ${state}${k === today ? ' today' : ''}`, role: 'gridcell', title: `${dd}/${m} : ${label}`, 'aria-label': `${Number(dd)}/${Number(m)} : ${label}` }, state === 'frozen' ? '❄️' : String(Number(dd))));
  }
  return grid;
}

function badgeGrid() {
  const earned = store.badges();
  return h('div', { class: 'badge-grid' }, BADGES.map((b) => {
    const at = earned[b.id];
    return h('div', { class: 'badge' + (at ? ' earned' : ' locked'), tabindex: 0, 'aria-label': at ? `${b.name} : gagné. ${b.desc}` : `${b.name} : à gagner. ${b.hint}` }, [
      h('span', { class: 'badge-emoji', 'aria-hidden': 'true' }, b.emoji),
      h('b', {}, b.name),
      h('small', {}, at ? `${b.desc} (${new Date(at).toLocaleDateString('fr-FR')})` : '🔒 ' + b.hint),
    ]);
  }));
}

function viewProgress() {
  const prog = store.progress();
  const days = store.practiceDays();
  const info = store.streakInfo();
  const goalMin = ctx.settings.dailyGoalMin || 15;
  const total = Object.values(days).reduce((a, b) => a + b, 0);
  const chart = h('div', { class: 'bars', role: 'img', 'aria-label': 'Minutes de pratique sur 30 jours' });
  const d = new Date();
  d.setDate(d.getDate() - 29);
  const vals = [];
  for (let i = 0; i < 30; i++) {
    const k = localDate(d);
    vals.push([k, days[k] || 0]);
    d.setDate(d.getDate() + 1);
  }
  const max = Math.max(60, ...vals.map((v) => v[1]));
  for (const [k, v] of vals) chart.append(h('div', { class: 'bar' + (v >= goalMin * 60 ? ' goal' : ''), style: `height:${(v / max) * 100}%`, title: `${k} : ${Math.round(v / 60)} min` }));
  const rows = Object.entries(prog).filter(([id]) => !id.startsWith('seance-')).sort((a, b) => (b[1].last || 0) - (a[1].last || 0)).map(([id, p]) => {
    const s = findSong(id);
    const conds = Object.entries(p.conditions || {}).sort((a, b) => b[1].best - a[1].best);
    return h('tr', {}, [
      h('td', {}, [s ? h('a', { href: `#/morceau/${id}` }, s.title) : id, p.mastered ? h('span', { class: 'mastered', title: 'Maîtrisé : Tempo, 100 %, 2 mains, 3 étoiles' }, ' 👑') : null]),
      h('td', {}, stars(p.stars)),
      h('td', {}, p.best + ' %'),
      h('td', { class: 'small' }, conds.length ? h('details', {}, [h('summary', {}, `${conds.length} condition${conds.length > 1 ? 's' : ''}`), h('ul', { class: 'cond-list' }, conds.map(([k, c]) => h('li', {}, `${conditionLabel(k)} : ${c.best} % ${stars(c.stars)}${c.mastered ? ' 👑' : ''}`)))]) : '—'),
      h('td', {}, String(p.plays)),
      h('td', {}, Math.round(p.timeSec / 60) + ' min'),
      h('td', {}, h('span', { class: 'spark' }, (p.history || []).slice(-12).map((x) => h('i', { style: `height:${Math.max(4, x.score)}%`, title: x.score + ' %' })))),
    ]);
  });
  const prof = store.currentProfile();
  const nBadges = Object.keys(store.badges()).length;
  main.append(h('h1', {}, `Mes progrès ${prof.avatar}`), h('div', { class: 'grid stats-grid' }, [
    statCard('🔥', info.streak, `jours d’affilée (record ${info.best})`), statCard('⏱️', Math.round(total / 60) + ' min', 'de pratique au total'),
    statCard('❄️', info.freezes, 'gels de série en réserve'), statCard('⭐', Object.values(prog).reduce((a, p) => a + (p.stars || 0), 0), 'étoiles gagnées'),
  ]),
  section('Ma chaîne', [
    h('p', { class: 'small muted' }, `Case pleine : objectif de ${goalMin} min atteint · demi-case : un peu de pratique · ❄️ : jour protégé par un gel (1 gel gagné tous les 7 jours d’affilée, 2 max).`),
    chainCalendar(days, goalMin, info.frozen),
  ]),
  section('30 derniers jours', chart),
  section(`Mes badges (${nBadges}/${BADGES.length})`, badgeGrid()),
  section('Morceaux', rows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, [h('tr', {}, ['Morceau', 'Étoiles', 'Record', 'Par condition', 'Sessions', 'Temps', 'Évolution'].map((t) => h('th', {}, t))), ...rows])) : h('p', { class: 'empty' }, 'Joue un morceau pour voir tes progrès ici.')),
  h('p', { class: 'small muted' }, ['👑 « Maîtrisé » : seulement en mode Tempo, à 100 % du tempo, aux 2 mains (si le morceau en a 2), avec 3 étoiles. Voir aussi le ', h('a', { href: '#/carnet' }, 'carnet du professeur'), '.']),
  section('Sauvegarde', [h('p', { class: 'small' }, `Les progrès de ${prof.name} sont enregistrés dans ce navigateur. Exporte-les pour les garder ou les transférer (l’import remplace les données du joueur actuel).`), h('div', { class: 'row' }, [
    h('button', { class: 'btn', onclick: () => download(`piano-coach-${prof.id}.json`, JSON.stringify(store.exportAll(), null, 2), 'application/json') }, '⬇ Exporter mes données'),
    h('label', { class: 'btn' }, ['⬆ Importer une sauvegarde', h('input', { type: 'file', accept: '.json', class: 'hidden', onchange: async (e) => {
      try {
        store.importAll(JSON.parse(await e.target.files[0].text()));
        ctx.prepared.clear();
        toast('Sauvegarde importée !');
        ctx.route();
      } catch {
        toast('Fichier de sauvegarde invalide.');
      }
    } })]),
  ])]));
}

registerRoute(/^progres$/, viewProgress);
