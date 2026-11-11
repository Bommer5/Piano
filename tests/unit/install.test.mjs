import test from 'node:test';
import assert from 'node:assert/strict';
import { detectInstallEnv } from '../../js/core/install.js';

const UA = {
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  firefoxAndroid: 'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0',
  webview: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  instagram: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 Instagram 350.0.0.0 Android',
  iosSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iosChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1',
  desktopChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  desktopFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
};

test('installation : déjà installé', () => {
  assert.equal(detectInstallEnv(UA.chromeAndroid, { standalone: true }).state, 'installed');
});

test('installation : Chrome Android avec invite native → bouton', () => {
  const e = detectInstallEnv(UA.chromeAndroid, { hasPrompt: true });
  assert.equal(e.state, 'prompt');
  assert.equal(e.os, 'android');
});

test('installation : Chrome Android sans invite → étapes du menu ⋮', () => {
  const e = detectInstallEnv(UA.chromeAndroid);
  assert.equal(e.state, 'manual');
  assert.match(e.steps.join(' '), /⋮/);
  assert.match(e.steps.join(' '), /Ajouter à l’écran d’accueil/);
  assert.ok(e.note);
});

test('installation : navigateurs intégrés (Discord, Instagram, WebView) → ouvrir dans Chrome', () => {
  for (const ua of [UA.webview, UA.instagram]) {
    const e = detectInstallEnv(ua, { hasPrompt: false });
    assert.equal(e.state, 'inapp');
    assert.match(e.title, /Chrome/);
  }
});

test('installation : Samsung Internet, Firefox, iPhone, ordinateur', () => {
  assert.match(detectInstallEnv(UA.samsung).steps.join(' '), /Ajouter la page à/);
  assert.equal(detectInstallEnv(UA.samsung).browser, 'samsung');
  assert.equal(detectInstallEnv(UA.firefoxAndroid).browser, 'firefox');
  assert.match(detectInstallEnv(UA.iosSafari).steps.join(' '), /Partager/);
  assert.match(detectInstallEnv(UA.iosChrome).steps.join(' '), /Safari/);
  assert.equal(detectInstallEnv(UA.desktopChrome).os, 'desktop');
  assert.match(detectInstallEnv(UA.desktopFirefox).steps.join(' '), /Chrome ou Edge/);
});

test('installation : adresse non sécurisée (http)', () => {
  assert.equal(detectInstallEnv(UA.chromeAndroid, { secure: false }).state, 'insecure');
});

test('installation : chaque situation donne un titre et, sauf installé, au moins une étape', () => {
  for (const ua of Object.values(UA)) for (const hasPrompt of [true, false]) {
    const e = detectInstallEnv(ua, { hasPrompt });
    assert.ok(e.title.length > 3);
    assert.ok(e.steps.length >= 1);
  }
});
