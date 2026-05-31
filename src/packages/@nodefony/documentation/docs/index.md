---
title: Documentation (data plane)
audience: [developer]
version: "10.0.0"
status: stable
updated: 2026-05-31
---

# Le module Documentation

## En une image

Imaginez une **bibliothèque** dont les livres sont dispersés : certains dans une salle commune
(`docs/` à la racine du projet), d'autres rangés à côté de l'atelier qui les a écrits
(`<module>/docs/`). Le module `@nodefony/documentation` est le **bibliothécaire** : il fait le tour
de toutes les étagères une fois, en dresse le **catalogue** (l'index), et sait aller chercher
n'importe quel livre quand on lui donne sa **cote** (le _slug_). Il ne lit pas le livre à voix haute
— il vous tend l'ouvrage ouvert ; c'est vous (le front Studio, plus tard un site statique) qui le lisez.

C'est le sens de **headless** (« sans tête ») : le module produit de la donnée structurée (JSON), pas
des pages HTML. Le rendu vit chez le consommateur.

## Pourquoi un module, et pas un simple endpoint ?

Parce que cette bibliothèque a de la **mémoire** : un catalogue mis en cache (pour ne pas refaire le
tour des étagères à chaque visiteur), un registre de **variables dynamiques**
(notées `{{ maVar }}` dans le markdown) résolues au moment de servir une page — les fournisseurs
built-in sont `version`, `branch`, `commit`. Cette mémoire mérite un **cycle de vie propre**
— elle se construit au démarrage, paresseusement, et reste hors du chemin critique des requêtes
applicatives (rien n'est alloué « au cas où »).

## Ce qu'il expose

Deux portes, sous `/nodefony/documentation/api/` :

- **`/tree`** — le catalogue : quelles sections, quelles pages, pour quelle audience.
- **`/page/{slug}`** — un livre précis : son markdown, variables résolues, plus le lien « Modifier sur
  GitHub » reconstruit à la volée.

## La cote (slug) est une clé, pas un chemin

Point de sécurité essentiel : le _slug_ (`root~guides~intro`, `mod~http~index`) n'est **jamais**
transformé en chemin de fichier. C'est une **clé d'allowlist** : le bibliothécaire a noté, lors de son
tour, le chemin réel de chaque livre ; servir une page, c'est retrouver la cote dans son registre puis
ouvrir le chemin **qu'il connaît déjà**. Un visiteur ne peut donc pas demander « le livre `../coffre-fort` ».
Une garde (`isSafeSlug`) rejette en plus tout slug suspect avant même de chercher.

## Pour aller plus loin

- [Architecture & flux interne](architecture.md) — scan → cache → arbre, schéma de slug, sécurité.
- `README.md` du module — référence config + API + frontmatter.
