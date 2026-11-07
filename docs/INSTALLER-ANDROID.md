# Installer Piano Coach sur ton téléphone Android

Piano Coach est une application web (PWA). Pour l'installer sur ton téléphone, il faut d'abord
la **publier** sur Internet avec GitHub Pages (gratuit), puis l'ouvrir dans Chrome sur le
téléphone. Une fois installée, elle a sa propre icône et marche même sans connexion.

## 1. Publier le site sur GitHub Pages (une seule fois, depuis un ordinateur)

1. Va sur **https://github.com/Bommer5/Piano** et connecte-toi.
2. Clique sur l'onglet **Settings** (Paramètres), tout en haut à droite du dépôt.
3. Dans le menu de gauche, clique sur **Pages**.
4. Dans « Build and deployment », à **Source**, choisis **Deploy from a branch**.
5. À **Branch**, choisis la branche **ccr-37050496-4oleth** et, à côté, le dossier **/ (root)**.
6. Clique sur **Save**.
7. Attends **1 à 2 minutes**. Pour suivre, ouvre l'onglet **Actions** du dépôt : une tâche
   « **pages build and deployment** » apparaît. Quand elle a une coche verte ✅, c'est en ligne.
8. Reviens dans **Settings → Pages** : en haut, GitHub affiche « Your site is live at
   https://bommer5.github.io/Piano/ ».

Ton adresse est : **https://bommer5.github.io/Piano/**

> Teste d'abord cette adresse sur l'ordinateur : tu dois voir l'accueil de Piano Coach.
> Si tu vois une page 404 GitHub, le déploiement n'est pas encore fini : attends encore un peu.

Ensuite, chaque fois que la branche reçoit de nouveaux fichiers, GitHub republie le site tout
seul (1 à 2 minutes). Rien d'autre à faire.

## 2. Installer l'app sur le téléphone

1. Ouvre **Chrome** sur ton téléphone Android.
2. Tape l'adresse **https://bommer5.github.io/Piano/** et attends que la page s'affiche.
3. Touche le menu **⋮** (trois points en haut à droite).
4. Touche **« Installer l'application »**. Si tu ne le vois pas, touche
   **« Ajouter à l'écran d'accueil »** puis **« Installer »**.
5. Confirme. L'icône **Piano Coach** apparaît sur ton écran d'accueil (et dans la liste des apps).

Parfois Chrome affiche tout seul un bandeau « Installer Piano Coach » en bas de l'écran : tu peux
aussi toucher ce bandeau.

Astuce : appuie longtemps sur l'icône pour accéder directement à **Morceaux**, **Cours** ou
**Détecteur**.

### Hors ligne

Après la première ouverture avec Internet, l'app se met en mémoire sur le téléphone : tu peux
ensuite l'utiliser sans connexion (morceaux, entraîneur, cours). Quand une nouvelle version est
publiée, elle se télécharge en arrière-plan ; ferme et rouvre l'app pour l'avoir.

## 3. Si ça ne marche pas : les pièges classiques

- **Pas de bouton « Installer » ?** Utilise **Chrome**. Firefox et Samsung Internet savent
  parfois « ajouter un raccourci », mais ce n'est pas une vraie installation (et le micro ou le
  MIDI peuvent mal marcher). Sur Samsung Internet, le menu s'appelle « Ajouter page à » →
  « Écran d'accueil », mais préfère Chrome.
- **Navigation privée (onglet incognito)** : l'installation est impossible et rien n'est gardé
  hors ligne. Ouvre l'adresse dans un onglet normal.
- **Le déploiement n'est pas fini** : si tu as une page 404 ou une vieille version, attends la
  coche verte dans l'onglet **Actions** de GitHub, puis recharge.
- **Ancienne version coincée en mémoire** (par exemple une page blanche ou « Oups » après une
  mise à jour) : dans Chrome, touche le cadenas à gauche de l'adresse → **Paramètres du site** →
  **Effacer et réinitialiser** (ou Chrome → ⋮ → Paramètres → Paramètres des sites →
  Tous les sites → bommer5.github.io → **Effacer et réinitialiser**). Ensuite rouvre l'adresse.
  Si l'app était déjà installée, désinstalle-la et réinstalle-la.
- **Mauvaise adresse** : l'adresse doit finir par **/Piano/** (avec un P majuscule).

## 4. Le micro

La première fois que tu utilises le détecteur de notes ou l'entraîneur avec le micro, Chrome
demande **« Autoriser Piano Coach à utiliser ton micro ? »** : touche **Autoriser**.

Si tu as refusé par erreur : cadenas à gauche de l'adresse (ou, dans l'app installée,
Paramètres Android → Applications → Piano Coach → Autorisations) → **Micro** → **Autoriser**.

Conseils : pose le téléphone près du piano, dans une pièce calme.

## 5. Un clavier MIDI (USB)

Tu peux brancher un clavier électronique ou un piano numérique avec une prise USB :

1. Il te faut un **adaptateur USB-OTG** (USB-C ou micro-USB vers USB-A, quelques euros).
2. Branche le câble USB du clavier dans l'adaptateur, puis dans le téléphone.
3. Ouvre Piano Coach **dans Chrome** (ou l'app installée depuis Chrome) : Chrome sait lire le
   MIDI (Web MIDI). Accepte si Chrome demande l'autorisation d'utiliser les appareils MIDI.
4. Dans l'entraîneur, l'indication « MIDI : aucun clavier » doit afficher le nom de ton clavier.

Si rien ne se passe : débranche et rebranche le clavier, puis recharge la page. Certains claviers
ont besoin d'être allumés **avant** d'être branchés.

## 6. Option : un vrai fichier APK (avec pwabuilder.com)

Ce n'est **pas nécessaire** : l'installation depuis Chrome donne déjà une vraie app. Mais si tu
veux un fichier `.apk` (à partager ou à mettre sur le Play Store) :

1. Va sur **https://www.pwabuilder.com** et colle l'adresse **https://bommer5.github.io/Piano/**.
2. Clique sur **Start**, puis **Package for stores** → **Android** → **Generate**.
3. Télécharge le fichier `.zip` : il contient l'APK (à installer en autorisant les « sources
   inconnues ») et un fichier `.aab` pour le Play Store.

**Limite importante** : l'APK est une « TWA » (Chrome dans une coquille d'app). Pour qu'elle
s'affiche **sans barre d'adresse**, Android doit vérifier que tu possèdes le site, grâce à un
fichier `/.well-known/assetlinks.json` placé **à la racine du domaine**
(https://bommer5.github.io/.well-known/…). Avec un site dans un sous-dossier (`/Piano/`), ce
fichier doit aller dans un dépôt séparé **Bommer5/Bommer5.github.io**, ou alors il faut utiliser
un nom de domaine à toi. Sans ce fichier, l'APK marche mais affiche une petite barre d'adresse
en haut.
