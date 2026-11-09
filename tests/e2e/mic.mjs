// Test de bout en bout du micro : un piano simulé « joue » dans le micro de l'app (faux getUserMedia),
// l'entraîneur en mode Attente doit avancer d'UNE note par frappe, y compris sur les notes répétées.
import { createRequire } from 'node:module';
import { createServer } from '../../scripts/serve.mjs';
import { piano } from '../helpers/piano-sim.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const server = createServer();
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}/`;
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
let failures = 0;

async function scenario(name, midis, { dt = 0.4, expectScore = '100 %' } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(({ src }) => {
    localStorage.setItem('pianocoach.onboarded', 'true');
    const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
    // eslint-disable-next-line no-new-func
    const makePiano = new Function('midiToFreq', `return ${src}`)(midiToFreq);
    // Faux micro : un MediaStream alimenté par un AudioBuffer synthétique, démarré à la demande
    navigator.mediaDevices.getUserMedia = async () => {
      const AC = window.AudioContext;
      const ac = (window.__fakeAc ||= new AC());
      const dest = ac.createMediaStreamDestination();
      window.__playPiano = (seq) => {
        const samples = makePiano(seq, ac.sampleRate, { noise: 0.001 });
        const buf = ac.createBuffer(1, samples.length, ac.sampleRate);
        buf.copyToChannel(samples, 0);
        const node = ac.createBufferSource();
        node.buffer = buf;
        node.connect(dest);
        node.start();
        return samples.length / ac.sampleRate;
      };
      return dest.stream;
    };
  }, { src: piano.toString() });
  await page.goto(BASE);
  await page.waitForFunction(() => window.__booted && window.PianoCoach);
  await page.evaluate((midis) => {
    window.PianoCoach.store.saveToLibrary({ id: 'test-repetees', title: 'Notes répétées', composer: 'Test', tempo: 100, timeSig: [4, 4], genre: 'technique', level: 1, notes: midis.map((m, i) => ({ midi: m, start: i, dur: 1, hand: 'R' })) });
  }, midis);
  await page.goto(BASE + '#/jouer/test-repetees?hands=R');
  await page.locator('.trainer').waitFor();
  await page.locator('.trainer button', { hasText: 'Micro' }).click();
  await page.waitForTimeout(600);
  await page.locator('.trainer .btn.primary.big').first().click();
  await page.waitForTimeout(300);
  const seq = midis.map((m, i) => ({ midi: m, t: 0.3 + i * dt }));
  const dur = await page.evaluate((s) => window.__playPiano(s), seq);
  await page.waitForTimeout(dur * 1000 + 800);
  const open = await page.locator('dialog.modal[open] .big-score').count();
  const score = open ? (await page.locator('dialog.modal[open] .big-score').textContent()).trim() : null;
  const stats = await page.locator('.trainer .stat b').allTextContents();
  const ok = score === expectScore && !errors.length;
  if (!ok) failures++;
  console.log(`${ok ? '✔' : '✘'} ${name} — ${midis.length} frappes → score ${score ?? '(morceau non terminé)'} | notes justes/série/précision : ${stats.slice(0, 3).join(' / ')}${errors.length ? ' | erreurs : ' + errors.join('; ') : ''}`);
  await page.close();
}

try {
  await scenario('Do ×8 (même note)', [60, 60, 60, 60, 60, 60, 60, 60]);
  await scenario('Do ×8 rapide (220 ms)', [60, 60, 60, 60, 60, 60, 60, 60], { dt: 0.22 });
  await scenario('Mi Mi Fa Sol Sol Fa Mi Ré (Ode à la joie)', [64, 64, 65, 67, 67, 65, 64, 62], { dt: 0.45 });
  await scenario('Do Do Sol Sol La La Sol (Ah vous dirai-je)', [60, 60, 67, 67, 69, 69, 67], { dt: 0.4 });
  await scenario('Graves répétés Sol2 ×5', [43, 43, 43, 43, 43], { dt: 0.5 });
  await scenario('Aigus répétés Do6 ×6', [84, 84, 84, 84, 84, 84], { dt: 0.3 });
} finally {
  await browser.close();
  server.close();
}
console.log(failures ? `\n${failures} scénario(s) en échec` : '\nMicro : tous les scénarios réussis');
process.exit(failures ? 1 : 0);
