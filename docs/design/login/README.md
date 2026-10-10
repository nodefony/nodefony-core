---
title: "Maquettes de la page de connexion"
lang: fr
module: "@nodefony/security"
topic: login-page-design
audience: [developer]
tags: [design, login, maquettes, theme]
status: draft
publish: false
updated: 2026-10-11
---

# Maquettes de la page de connexion

Galerie des **neuf habillages** de la page de connexion servie par le framework
(#547). Elle ne porte **aucune feuille à elle** : chaque maquette charge les fichiers
publiés du framework — `src/nodefony/assets/login.css`, puis
`src/nodefony/assets/login/skins/<habillage>.css` — exactement comme la vraie page.
Une couleur se change donc dans le cœur, jamais ici, et la galerie la montre aussitôt.

L'aperçu fidèle reste la vraie page : en développement, `/login?skin=<habillage>`
(et `&layout=card|split|bare`). La galerie sert à comparer les neuf côte à côte, hors
ligne, dans toutes les étapes du déroulé.

**Par défaut : `frontispiece` (F03)** — panneau photo voilé à bord courbe, les trois
croissants du logo sur la jonction, comptes de l'organisation avant le mot de passe
local. Les habillages et leur usage : `src/packages/@nodefony/security/docs/login-page.md`.

## Ouvrir

Ouvrir `index.html` dans un navigateur : aperçus numérotés, cliquables, avec l'étape
(identifiant, mot de passe, code, erreur, connecté), le thème (système, clair, sombre) et le
format (bureau, mobile). Chaque maquette porte une barre de test en bas (masquée dans les
aperçus) pour rejouer les étapes et les erreurs 401 et 429.

## Modifier

| Fichier                                 | Rôle                                                                                           |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `src/nodefony/assets/login/skins/*.css` | **les habillages** (dans le cœur) : une idée de design se pose ICI, la galerie la reprend      |
| `gen.mjs`                               | génère les maquettes `v*` et la galerie : `node docs/design/login/gen.mjs`                     |
| `f01-…`, `f02-…`, `f03-…`               | maquettes écrites à la main (balisage seul), décrites par `fable-manifest.json`                |
| `mock.css`                              | ce que la maquette ajoute : la photo (posée comme le ferait l'application) et la barre de test |
| `mock.js`                               | simulation du déroulé (étapes, erreurs) — n'existera pas dans la vraie page                    |

La photo est celle de l'application de dev du dépôt (`public/brand/login-hero.webp`,
1 920 px, 93 Ko) : le framework n'en publie aucune.

Règles du design, fixées en séance : couleurs **pleines**, aucun dégradé décoratif ni halo
(seuls un masque de découpe et un voile semi-transparent sont admis) ; signature de la barre
de debug (fond profond, filets de 1 px, micro-libellés à chasse fixe) ; contraste WCAG AA
mesuré dans les deux thèmes (skill `nodefony-browser`).
