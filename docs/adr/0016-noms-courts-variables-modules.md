---
adr: 16
title: Variables d'environnement des modules — le nom court se déclare sur son champ
lang: fr
navTitle: Noms courts des modules
date: 2026-10-12
status: accepted
deciders: [Christophe CAMENSULI]
tags: [env, configuration, modules, secrets, deploiement]
---

# ADR-0016 — Variables d'environnement des modules : le nom court se déclare sur son champ

📍 [Documentation](../index.md) › [Décisions d'architecture](README.md) › **ADR-0016**

## Statut

Accepté (2026-10-12). Complète l'[ADR-0006](0006-configuration-unifiee-env-override.md) : le
catalogue `env.ts` de l'application, la surcharge générique `NF__<MODULE>__<CHEMIN>` et la
convention `<NOM>_FILE` sont inchangés. Amende sa règle de non-chevauchement (D4) pour les
seuls noms courts de MODULES — voir « Décision », point 4. Après la 10.0.0, renommer ou retirer
un nom court est une rupture.

## Contexte

Un module peut proposer un **nom court** pour un de ses réglages : `NF_REDIS_HOST` plutôt que
`NF__REDIS__GLOBALOPTIONS__SOCKET__HOST`. C'est le contrat qu'un exploitant pose en production —
stable, documenté, indépendant de la structure interne de la configuration.

Jusqu'ici, ce nom s'écrivait **deux fois** :

1. dans le builder du module, qui le lisait à la main (`if (env.NF_REDIS_HOST) …`) après la
   validation ;
2. dans une table du cœur (`RESERVED_ENV`), sans laquelle `nodefony env` le déclarait « sans
   effet — faute de frappe ».

Rien ne confrontait les deux. L'oubli de la seconde faisait mentir le rapport : `NF_REDIS_HOST`,
lue par redis, s'affichait « sans effet ». Un module **tiers** ne pouvait même pas écrire la
seconde, la table vivant dans le paquet `nodefony`. Et la lecture à la main échappait à la
validation : `NF_REDIS_PORT=abc` était ignorée en silence, le port par défaut s'appliquait.

## Décision

1. **Un nom court se déclare UNE fois, sur le champ qu'il règle**, dans le schéma Zod du module :
   `host: z.string().default("localhost").meta({ env: "NF_REDIS_HOST" })`. Rien d'autre à
   écrire. Forme imposée `NF_<MODULE>_<RÉGLAGE>`, sur une feuille (jamais une section).
2. **Le Kernel le pose**, avant la validation du module et par la même fonction que `NF__…`
   (`applyEnvShortcuts()`, `envShortcuts.ts:146`). Le schéma valide donc la valeur comme une
   valeur de l'application : une valeur fausse **arrête le démarrage**, en nommant la variable.
   Le builder du module ne lit plus ces variables.
3. **Chaque nom court accepte `<NOM>_FILE`** (secret monté par Docker, Kubernetes) — même
   résolveur que les variables de l'application. Poser la variable ET son `_FILE` arrête le
   démarrage. Une variable vide vaut absente.
4. **Nom court ET `NF__…` visant le même champ** : refus du démarrage en production (code 78) ;
   en développement, `NF__…` l'emporte avec un avertissement qui nomme les deux variables.
   Raison : en production on ne devine pas l'intention de l'exploitant ; en développement c'est
   le geste d'un banc, qui fait varier un réglage par-dessus le `.env`.
5. **Sans démarrer, le schéma se trouve par DÉCLARATION** : le `package.json` du module porte
   `"nodefony": { "configSchema": "./dist/nodefony/config/configSchema.js" }`, un fichier
   FEUILLE qui exporte `configJsonSchema()` (nom fixe) et n'importe que zod et le schéma.
   `nodefony env` et la notice `.env.example` le lisent ; un schéma déclaré mais illisible (non
   construit, export absent) est NOMMÉ, jamais tu.
6. **Secret** : le schéma décide (`.meta({ secret })`, `false` compris), le nom supplée — la
   règle unique `isSensitiveEnvVar()`. Un nom qui contient `KEY` sans être un secret
   (`NF_REDIS_KEY_NAMESPACE`) déclare `secret: false`.
7. **Place en production** : `.meta({ placement })` (`platform`, `secrets`, `workstation`) dit
   où l'exploitant pose la variable ; absente, la règle de l'application décide
   (`envVarPlacement()` : secret → `secrets`, sinon `platform`). Un réglage de diagnostic
   (`NF_MONGODB_DEBUG`) se déclare `workstation`.
8. **Sans démarrer, les modules se lisent dans le manifeste** (racine et fragments) : `use("…")`
   comme la chaîne nue posée dans `modules: [ … ]`. Un module chargé sous `when`, ou sous
   `policy: "dev"`, est NOMMÉ comme tel par `nodefony env` : ses variables n'ont d'effet que si
   le module est chargé.

La table `RESERVED_ENV` ne garde que les variables du CŒUR (`NF_OUTPUT`, `NF_DEV_*`…) et celles
qui ne règlent aucun champ de configuration (`NF_MIGRATE_DATABASE_URL`, `NF_ORM_*`, `NF_POD_NAME`,
`NF_CLUSTER_PROBE` — lue aussi par le maître de grappe, qui n'a pas de configuration de module).
Les modules du framework sont tous migrés : redis, realtime, documentation, mongoose. Une garde
(`reservedEnv.test.ts`) refuse un nom déclaré deux fois, un nom hors forme, et un module qui
déclare un nom court sans déclarer son schéma.

## Conséquences

- Un module tiers ou d'application obtient un nom court reconnu partout sans toucher au cœur ;
  `nodefony create module` pose `configSchema.ts` et la déclaration.
- `nodefony env` range les noms courts par module, posés ou non, avec la description et le défaut
  du schéma ; `nodefony inspect config` et la console en donnent la provenance `env`.
- Une application neuve reçoit les noms courts de ses modules dans `.env.example` après
  l'installation des paquets : `create app` relance alors `nodefony env --example`.
- **Rupture de comportement** : une valeur de nom court que le schéma refuse arrête désormais le
  démarrage — `NF_REDIS_PORT=abc` était ignorée, `NF_REALTIME_BACKPLANE_SECRET` de moins de 32
  caractères et `NF_REALTIME_BACKPLANE_NAMESPACE` hors grammaire passaient la validation,
  `NF_MONGODB_DEBUG=peut-être` était ignorée. Elle se déclare dans le changelog de la release.
  Le nom du pilote (`NF_REALTIME_DRIVER`) reste libre : le registre est ouvert aux pilotes
  tiers, un nom inconnu est signalé au branchement, pas refusé.
- **Un builder appelé hors Kernel ne lit plus l'environnement** (`defineRealtimeConfig()` dans
  un test ou un module maison) : c'est le Kernel qui pose les noms courts.
- Le démarrage calcule le schéma de chaque module une seule fois (cache libéré après la
  validation) : aucun coût ajouté par rapport aux surcharges `NF__…`.

## Alternatives écartées

- **Compléter la table du cœur à chaque nom court** : double écriture, inaccessible à un module
  tiers — c'est le défaut corrigé.
- **Un catalogue `defineEnv` par module** : le nom et le chemin du champ s'écriraient encore
  séparément du schéma, et deux sources de défauts divergeraient.
- **Deviner le fichier du schéma** (`dist/…/defineModuleConfig.js`, export au suffixe
  `ConfigJsonSchema`) : hors `exports`, non promis par un module tiers, et ce fichier exécute du
  code du module à l'import. Un module non construit y était passé sous silence.
- **Supprimer les noms courts au profit de `NF__…` seul** : un seul mécanisme, mais le nom suit
  la structure interne et casse au premier renommage ; `NF_REDIS_PASSWORD` figure déjà dans les
  `compose.yaml` et `.env` générés.
- **Le nom court l'emporte en développement aussi** (règle D4 de l'ADR-0006 telle quelle) : un
  banc qui pose `NF__…` par-dessus le `.env` ne mesurerait pas ce qu'il croit.
