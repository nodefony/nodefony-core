---
adr: 14
title: Fichiers d'environnement — un seul fichier, `.env`, jamais commité
lang: fr
navTitle: Fichiers d'environnement
date: 2026-10-05
status: accepted
deciders: [Christophe CAMENSULI]
tags: [env, configuration, secrets, dotenv, deploiement]
---

# ADR-0014 — Fichiers d'environnement : un seul fichier, `.env`, jamais commité

📍 [Documentation](../index.md) › [Décisions d'architecture](README.md) › **ADR-0014**

## Statut

Accepté (2026-10-05). Remplace la convention de fichiers « Vite/Next.js » que le chargeur
appliquait jusque-là. Complète l'[ADR-0006](0006-configuration-unifiee-env-override.md), dont
tout le reste (catalogue `defineEnv`, surcharges `NF__`, `<NOM>_FILE`) est inchangé. Prépare
[#542](https://github.com/nodefony/nodefony-core/issues/542) (matrice des variables).

## Contexte

Le framework avait adopté la convention de Vite et de Next.js : `.env` **commité** (défauts non
secrets), `.env.local` **ignoré** (secrets du poste), et une cascade `.env.<mode>` /
`.env.<déploiement>` / leurs `.local` — sept niveaux.

Cette convention a coûté plusieurs audits sans jamais se stabiliser, pour trois raisons :

1. **Elle contredit le réflexe Node.** Pour dotenv, `node --env-file` et le `.gitignore` Node
   officiel de GitHub (`.env`, `.env.*`, `!.env.example`), `.env` n'est **jamais** commité. Un
   utilisateur qui y colle un secret le pousse sur git, puis dans l'image, sans un mot. Avec le
   `.gitignore` de GitHub, nos `.env.development` commités étaient même ignorés en silence.
2. **Elle impose une règle à retenir** — « quelle valeur dans quel fichier » — que personne ne
   retenait : la base de développement finissait dans le `.env` commité, donc dans l'image de
   production ; la clé de signature des jetons se voyait orientée vers `.env.local` par une
   expression régulière sur son nom.
3. **Ses niveaux ne servaient pas.** En production, les secrets viennent de l'orchestrateur ; les
   réglages non secrets par environnement ont déjà leur place, typée et validée : la fonction
   `(ctx) => …` de `nodefony.config.ts`. Les fichiers par mode doublaient ce mécanisme sans type.

## Décision

**Une question décide où va une valeur : qui la fournit ?**

| Fichier / source                        | Commité | Lu au démarrage | Qui fournit la valeur                                   |
| --------------------------------------- | ------- | --------------- | ------------------------------------------------------- |
| _(aucun)_                               | —       | —               | le **framework** : son défaut                           |
| `.env.example`                          | **oui** | **jamais**      | personne : c'est la **notice**, générée depuis `env.ts` |
| `.env`                                  | **non** | oui             | **le poste** : valeurs de dev, secrets de dev compris   |
| orchestrateur / gestionnaire de secrets | —       | oui (process)   | **l'exploitation** : tout ce que la production exige    |
| `nodefony.config.ts` (`ctx.isProd`, …)  | oui     | oui             | **le code** : réglage non secret qui dépend du mode     |

Précédence : **la variable du process gagne sur `.env`**. Il n'y a plus d'autre niveau.

- **La production n'a aucun fichier.** `.env` est exclu du dépôt ET de l'image
  (`.gitignore`, `.dockerignore`) ; `nodefony image:check` le refuse s'il y entre.
- **Les fichiers de l'ancienne convention arrêtent le démarrage** (code 78) dans une application
  (`nodefony.config.ts` présent), en nommant chacun et ce qu'il faut faire de ses lignes. Les
  ignorer en silence ferait disparaître leurs variables, et l'application démarrerait sur un
  défaut.
- **Un module n'a pas de `.env`.** Un process sert une application, donc un environnement : celui
  de la racine de l'app. Un module reçoit ses valeurs par sa configuration (`use()`), par
  `NF__<MODULE>__<CHEMIN>`, ou par une variable du `env.ts` de l'app. Un `.env` livré dans un
  paquet ne serait lu par personne et partirait sur npm.
- **Exception qui n'est pas la nôtre : Vite.** Les `.env.*` d'un front (`frontend/.env.production`,
  variables `VITE_` **publiques**) sont lus par Vite lui-même. D'où des motifs **ancrés à la
  racine** dans le `.gitignore` et le `.dockerignore` générés.
- **Un coéquipier qui clone** : `cp .env.example .env`, décommenter ce qu'il lui faut, puis
  `npx nodefony security:secrets --write` pour ses propres clés.

## Conséquences

- **Rupture** pour une application générée avant ce changement : ses `.env.local` et
  `.env.<mode>` refusent le démarrage jusqu'à ce que leurs lignes passent dans `.env`. Le message
  le dit ; le changelog le porte sous `Changed`.
- La forge d'une application générée ne trouve plus l'URL de sa base dans un fichier commité : la
  CI générée la pose au niveau du job (GitHub) ou en variable (GitLab).
- Le dépôt du framework suit la même structure que l'application générée — c'est une application
  comme les autres.
- La notice `.env.example` reste générée par `nodefony env --example` ; sa matrice (où poser
  chaque variable, exigée en production ou non) relève de #542, sur cette base.

## Alternatives écartées

- **Garder la convention Vite/Next.js.** Elle a l'avantage d'un fichier commité de défauts
  partagés — que la configuration typée fait déjà mieux. Elle garde l'inconvénient décisif : le
  fichier que tout développeur Node croit privé est public.
- **Garder les fichiers par mode (`.env.development`, `.env.production`) commités.** Ils doublent
  `nodefony.config.ts` sans type ni validation, et le `.gitignore` Node de GitHub les ignore.
- **Ignorer les anciens fichiers en silence.** Une variable qui disparaît sans message est le
  défaut le plus long à diagnostiquer du métier ; le refus nomme la correction.
