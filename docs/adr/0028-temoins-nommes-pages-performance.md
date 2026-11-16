---
adr: 28
title: Pages de performance — les témoins sont nommés, dans le décor
lang: fr
navTitle: Témoins nommés
date: 2026-11-16
status: accepted
deciders: [Christophe CAMENSULI]
tags: [performance, documentation, communication]
---

# ADR-0028 — Pages de performance : les témoins sont nommés, dans le décor

## Statut

Accepté (2026-11-15) par l'auteur (« il faut bien comparer à quelque chose » ; « oui on nomme »),
pendant la remesure de #659.

## Contexte

La documentation publique de Nodefony ne fait aucun contraste avec un logiciel tiers : elle dit
ce que le framework fait, pas ce que les autres ne font pas. Les pages de performance posaient un
cas à part. Un débit seul ne dit rien — 22 000 requêtes par seconde sur quelle machine, pour quel
travail ? — et la seule façon de le rendre lisible est de le rapporter à un témoin mesuré dans la
même fenêtre. Un témoin anonyme (« un framework populaire ») rendrait la mesure **irréfutable**,
donc sans valeur : personne ne peut rejouer un banc dont il ignore le camp opposé.

## Décision

1. **Les pages de performance nomment leurs témoins** — Express, NestJS, Drizzle, better-sqlite3 —
   avec leur **version exacte** (relevée dans ce que le banc sert, `provenance.witnesses`) et un
   lien vers leur projet.
2. **Le nom vit dans le décor, jamais dans un titre ni un podium.** Une figure dit « tant % du
   débit de ce témoin » ; aucune couleur de gagnant, aucun classement, aucun titre du type
   « X contre Y ». Le lecteur doit en sortir rassuré sur la zone, pas avec un vainqueur.
3. **Le cadrage est « à résultat observable égal »**, prouvé par le contrôle de parité avant
   chaque campagne. Les pages disent aussi ce que la parité ne prouve pas — le travail invisible
   (portée d'injection, contexte unifié, délai de réponse) — et décomposent son coût.
4. **L'humilité est un cadrage, pas une autocritique** : la machine (portable de 2018) est
   déclarée, les absolus sont dits non transposables, les mesures défavorables (POST refusé face à
   Express) sont publiées comme pistes ouvertes, sans être ni cachées ni surlignées.

Hors des pages de performance, la règle « aucun contraste » reste entière.

## Normes et antériorités

- La règle d'**usage loyal** de la SPEC (_Standard Performance Evaluation Corporation_) exige
  qu'un résultat publié s'accompagne de sa configuration complète, pour être reproductible : c'est
  le sens du décor et des versions publiées ici.
- Les bancs comparatifs publics de frameworks web (TechEmpower) nomment chaque framework et sa
  version, et publient le code de chaque camp : la comparaison n'a de valeur que réfutable.

## Conséquences

- `perf-compose.mjs` relève les versions des témoins ; les pages les affichent dans le décor.
- `perf-figures.mjs` dessine des barres neutres (aucune barre mise en avant).
- Toute page de performance neuve suit ces quatre points ; une revue qui trouve un titre
  comparatif ou un podium le corrige.
