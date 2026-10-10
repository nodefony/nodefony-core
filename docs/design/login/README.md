---
title: "Maquettes de la page de connexion"
lang: fr
module: "@nodefony/security"
topic: login-page-design
audience: [developer]
tags: [design, login, maquettes, theme]
status: draft
publish: false
updated: 2026-10-10
---

# Maquettes de la page de connexion

Galerie de propositions pour la page de connexion servie par le framework (#547). Toutes
partagent **un seul balisage** et **une seule feuille** (`base.css`, brouillon du futur
`login.css`) : chaque proposition ne change que des variables `--nf-login-*` et un mode de
mise en page (`<body data-layout="card|split|bare">`). C'est ce qui permettra plus tard de
proposer ces habillages comme **thèmes au choix**, par exemple depuis Studio.

**Retenue pour la beta 3 : F03 « Frontispice »** — panneau photo voilé à bord courbe,
les trois croissants du logo sur la jonction, matrice de la page d'accueil du cœur,
comptes de l'organisation avant le mot de passe local.

## Ouvrir

Ouvrir `index.html` dans un navigateur : aperçus numérotés, cliquables, avec l'étape
(identifiant, mot de passe, code, erreur, connecté), le thème (système, clair, sombre) et le
format (bureau, mobile). Chaque maquette porte une barre de test en bas (masquée dans les
aperçus) pour rejouer les étapes et les erreurs 401 et 429.

## Modifier

| Fichier                   | Rôle                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| `base.css`                | composants et mises en page communs ; une idée qui vaut pour toutes les propositions se pose ICI |
| `gen.py`                  | génère les propositions `v*` et la galerie : `python3 docs/design/login/gen.py`                  |
| `f01-…`, `f02-…`, `f03-…` | propositions écrites à la main (fable), décrites par `fable-manifest.json`                       |
| `mock.js`                 | simulation du déroulé (étapes, erreurs) — n'existera pas dans la vraie page                      |
| `img/`                    | photo allégée (2 400 px, 570 Ko) et sa vignette (800 px)                                         |

Règles du design, fixées en séance : couleurs **pleines**, aucun dégradé décoratif ni halo
(seuls un masque de découpe et un voile semi-transparent sont admis) ; signature de la barre
de debug (fond profond, filets de 1 px, micro-libellés à chasse fixe) ; contraste WCAG AA
mesuré dans les deux thèmes (skill `nodefony-browser`).
