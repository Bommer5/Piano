# Notes pour l'agent design (relevées pendant l'intégration)

Constats seulement : l'intégrateur n'a pas refait le design. Captures 375 px de chaque route : `npm run test:smoke` → `tests/e2e/screenshots/smoke/`.

## Corrigé pendant l'intégration
- `#main` recevait le cadre `:focus-visible` (3 px, accent) après le focus programmatique de chaque changement de page : une ligne bleue apparaissait sous le contenu (visible sur `#/partage`). → `#main:focus, #main:focus-visible { outline: none }` dans `css/style.css`.
- Classes globales `.h0`…`.h4` (carte de chaleur du Carnet) trop génériques : limitées à `.heat-cell.h0`…`.h4` (`css/profile.css`).
- `pointer-events: none` sur `.staff .ledger, .staff .staff-line` déplacé de `css/harmony.css` vers `css/notation.css` (concerne toutes les portées).
- Masques « Par cœur » : l'entraîneur ne dessine plus ses propres rectangles (`.memo-mask`, supprimés de `css/trainer.css`) ; la portée masque les mesures elle-même (`.hidden-measure` dans `css/notation.css`).

## Règles en double / contradictoires entre fichiers
| Sélecteur | Fichiers | Écart |
|---|---|---|
| `.progress`, `.progress .fill` | style.css / profile.css | hauteur 6 px vs 8 px, rayon 999 px vs 4 px — profile.css l'emporte partout (chargé après). Choisir une seule définition. |
| `.field-block` | harmony.css / profile.css | `flex` colonne vs `grid` + `font-weight: 600`. |
| `.btn.on` | style.css / harmony.css | harmony.css ajoute un `outline` à TOUS les boutons « on » de l'app (games, filtres…). À limiter à la page Accords ou à intégrer à style.css. |
| `.big-score` | style.css / games.css | 3 rem vs `clamp(2.2rem, 8vw, 3.2rem)`. |
| `.choice`, `.choice-grid` | games.css / profile.css | deux composants différents sous le même nom (choix de l'accueil guidé vs boutons de réponse des jeux). Renommer l'un des deux. |
| `.nav`, `.nav a` | style.css / profile.css | profile.css surcharge (`overflow: visible`, barre du bas en mobile) : à fusionner dans style.css. |
| `.table-wrap` | style.css / profile.css | identique, doublon. |
| `:root` | style.css / harmony.css | harmony.css définit `--f-t/--f-sd/--f-d` (fonctions tonales) sans variante thème clair. |

## Couleurs codées en dur (hors variables de thème)
- `css/trainer.css` : `#9aa0a6` (notes en trop, légende de la revue) → créer une variable `--extra`/réutiliser `--muted`.
- `css/profile.css` : `.two-blacks .w` (`border: #c9cbe0; color: #333`), `.chain-day.frozen` (`#7fd3ff`), `.heat-cell.h2` (`color: #222`).
- `#fff` sur dégradés d'accent : acceptable dans les deux thèmes.

## Visuel
- Accueil, thème clair : le petit piano décoratif (`.hero-piano span`, `--white-key`) est blanc sur carte blanche, presque invisible.
- Entraînement 375 px : la barre de statistiques (notes justes / série / précision) est très haute ; la portée commence sous la ligne de flottaison sur petits écrans.
- `--white-key` / `--black-key` n'ont pas de variante claire/sombre (ok pour le clavier, mais vérifier les contrastes des puces `.choice.black`).
- Menu « Plus » (mobile) : 7 entrées désormais (Calibration ajoutée) ; vérifier la hauteur du menu au-dessus de la barre du bas en 375×740.
