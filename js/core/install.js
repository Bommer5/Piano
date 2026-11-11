// Installation de l'app (PWA) : détecte la situation de l'utilisateur et donne les étapes exactes.
// Pur (testable dans Node) : aucune dépendance au DOM.

/**
 * @param {string} ua navigator.userAgent
 * @param {{standalone?:boolean, secure?:boolean, hasPrompt?:boolean}} env
 * @returns {{state:'installed'|'prompt'|'inapp'|'insecure'|'manual', os:string, browser:string, title:string, steps:string[], note?:string}}
 */
export function detectInstallEnv(ua = '', { standalone = false, secure = true, hasPrompt = false } = {}) {
  const os = /Android/i.test(ua) ? 'android' : /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile/i.test(ua)) ? 'ios' : 'desktop';
  // Navigateurs intégrés aux applis (Discord, Instagram, Messenger, Gmail, TikTok…) : ils ne savent pas installer
  const inApp = /; wv\)|\bFBAN|\bFBAV|FB_IAB|Instagram|Line\/|Snapchat|TikTok|musical_ly|Twitter|Discord|LinkedInApp|Pinterest|GSA\/|WhatsApp|MicroMessenger/i.test(ua);
  let browser = 'chrome';
  if (/SamsungBrowser/i.test(ua)) browser = 'samsung';
  else if (/Firefox|FxiOS/i.test(ua)) browser = 'firefox';
  else if (/EdgA|EdgiOS|Edg\//i.test(ua)) browser = 'edge';
  else if (/OPR\/|Opera/i.test(ua)) browser = 'opera';
  else if (/CriOS/i.test(ua)) browser = 'chrome-ios';
  else if (os === 'ios' || (/Safari/i.test(ua) && !/Chrome|Chromium/i.test(ua))) browser = 'safari';

  if (standalone) return { state: 'installed', os, browser, title: 'Piano Coach est installé', steps: [] };
  if (!secure) {
    return { state: 'insecure', os, browser, title: 'Adresse non sécurisée', steps: ['Ouvre l’app avec son adresse en https:// (et non http://).', 'Reviens ensuite sur cette page pour l’installer.'] };
  }
  if (inApp) {
    return {
      state: 'inapp', os, browser: 'inapp', title: 'Ouvre d’abord Piano Coach dans ' + (os === 'ios' ? 'Safari' : 'Chrome'),
      steps: [
        'Tu es dans le navigateur intégré d’une autre appli (Discord, Instagram, Gmail…) : il ne peut pas installer d’application.',
        'Touche le menu ⋮ ou ··· en haut de l’écran, puis « Ouvrir dans ' + (os === 'ios' ? 'Safari' : 'Chrome') + ' » (ou « Ouvrir dans le navigateur »).',
        'Sinon, copie le lien ci-dessous et colle-le dans ' + (os === 'ios' ? 'Safari' : 'Chrome') + '.',
      ],
    };
  }
  if (hasPrompt) return { state: 'prompt', os, browser, title: 'Installer Piano Coach', steps: ['Touche le bouton « Installer » ci-dessous, puis confirme.'] };

  let steps;
  let note;
  if (os === 'ios') {
    steps = browser === 'safari'
      ? ['Touche le bouton Partager (le carré avec une flèche vers le haut), en bas de Safari.', 'Fais défiler et touche « Sur l’écran d’accueil ».', 'Touche « Ajouter » en haut à droite.']
      : ['Sur iPhone et iPad, l’installation passe par Safari : ouvre cette page dans Safari.', 'Touche le bouton Partager, puis « Sur l’écran d’accueil », puis « Ajouter ».'];
  } else if (os === 'android') {
    if (browser === 'samsung') steps = ['Touche le menu ☰ (trois traits) en bas à droite.', 'Touche « Ajouter la page à », puis « Écran d’accueil ».', 'Confirme avec « Ajouter ».'];
    else if (browser === 'firefox') steps = ['Touche le menu ⋮ (trois points).', 'Touche « Installer » ou « Ajouter à l’écran d’accueil ».', 'Confirme avec « Ajouter ».'];
    else if (browser === 'opera') steps = ['Touche le menu ⋮ (trois points).', 'Touche « Ajouter à », puis « Écran d’accueil ».', 'Confirme.'];
    else {
      steps = ['Touche le menu ⋮ (trois points), en haut à droite de Chrome.', 'Touche « Ajouter à l’écran d’accueil » (ou « Installer l’application »).', 'Touche « Installer », puis confirme.'];
      note = 'Si tu ne vois pas ces lignes : mets Chrome à jour dans le Play Store, vérifie que tu n’es pas en navigation privée, puis recharge cette page.';
    }
  } else {
    steps = browser === 'safari'
      ? ['Dans la barre de menus de Safari : Fichier → « Ajouter au Dock ».']
      : browser === 'firefox'
        ? ['Firefox sur ordinateur n’installe pas les applications web : ouvre cette page dans Chrome ou Edge.', 'Puis clique l’icône d’installation à droite de la barre d’adresse.']
        : ['Clique l’icône d’installation (un écran avec une flèche) à droite de la barre d’adresse.', 'Ou : menu ⋮ → « Caster, enregistrer et partager » → « Installer Piano Coach ».'];
  }
  return { state: 'manual', os, browser, title: 'Installer Piano Coach', steps, note };
}

export const BROWSER_NAMES = { chrome: 'Chrome', 'chrome-ios': 'Chrome (iPhone)', samsung: 'Samsung Internet', firefox: 'Firefox', edge: 'Edge', opera: 'Opera', safari: 'Safari', inapp: 'navigateur intégré' };
