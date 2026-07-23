---
title: "Outillage agents — les skills du dépôt, leur usage réel et leur conformité"
lang: fr
topic: outillage-agents
audience: humain
date: 2026-07-23
status: stable
updated: 2026-07-23
source: "docs/outillage-agents.md"
tests: none
related: project_devkit_ai_kit, feedback_skill_authoring, feedback_single_source_rule
tags: [skills, agents, aaif, agent-skills, outillage, claude-code]
---

# Outillage agents — les skills du dépôt

> **Ceci documente le dépôt de développement, pas le paquet `nodefony`.** L'outillage décrit ici
> n'est ni publié sur npm ni chargé au boot : il sert à celles et ceux qui développent le framework.
> Le dépôt embarque **26 skills**, **2 commandes** et **1 garde-fou** destinés aux agents qui
> travaillent sur Nodefony. Cette page dit ce que chacun fait, **combien il sert réellement**
> (mesuré, pas estimé), s'il respecte le standard **Agent Skills** de l'AAIF, et lesquels méritent
> d'être réparés, fusionnés ou retirés. Elle sert au moment où l'on se demande « ai-je un outil pour
> ça ? » ou « pourquoi celui-là ne se déclenche jamais ? ».

📍 [Documentation](index.md) › **Outillage agents**

## Le modèle — trois portes, et pourquoi ça décide de tout

Un skill n'a pas une façon de s'activer mais **trois**, et la confusion entre elles explique presque
tous les écarts d'usage observés :

1. **L'agent l'invoque** (outil `Skill`) parce que la tâche correspond à sa `description`. C'est la
   porte nominale : le corps du skill est alors chargé et **remplace** le raisonnement improvisé.
2. **L'utilisateur le tape** (`/nom`). Les commandes de `.claude/commands/` sont une couche de
   frappe courte qui délègue au skill.
3. **Quelqu'un lit ses fichiers** (`Read` sur `SKILL.md`, `references/*.md`, `scripts/*`). C'est un
   usage réel, mais il ne prouve pas que le skill s'est _déclenché_ — seulement qu'on savait déjà
   qu'il existait.

**Ce que ça implique** : un skill dont la connaissance est **aussi** écrite dans le `CLAUDE.md`
racine ne s'activera jamais par la porte 1. L'agent lit la règle au démarrage, exécute la commande
en dur, et le skill reste muet — non par inutilité, mais parce que **la même règle vit à deux
endroits**. C'est le diagnostic dominant de l'inventaire ci-dessous.

## Lexique

| Terme                       | Sens ici                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Skill**                   | Dossier `.claude/skills/<nom>/` contenant un `SKILL.md` (frontmatter + corps) et, en option, des ressources |
| **Commande**                | Fichier `.claude/commands/<nom>.md` — une entrée `/nom` tapée par l'humain, qui délègue à un skill          |
| **Déclencheur**             | Formulation citée dans la `description` qui donne à l'agent le signal d'invoquer le skill                   |
| **Divulgation progressive** | Le principe du standard : métadonnées légères d'abord, corps à l'activation, ressources à la demande        |
| **`references/`**           | Détail chargé à la demande (le standard exige ce nom, **au pluriel**, et **un seul niveau**)                |
| **`scripts/`**              | Code exécutable embarqué que le skill lance au lieu de le réécrire                                          |
| **Garde-fou (hook)**        | Programme lancé par le harnais avant un outil — ici `.claude/hooks/guard-bash.sh`, qui refuse deux gestes   |

## L'inventaire — 26 skills par famille

Les deux colonnes de droite sont **mesurées** sur l'ensemble des transcrits du projet (~194
sessions) : _invocations_ = passages par l'outil `Skill` ; _lectures_ = accès directs à ses
fichiers. Un skill peut être très lu sans jamais être invoqué — c'est un signal, pas un défaut.

### Cycle de session

| Skill                 | Rôle                                                                        | Invoc. | Lect. |
| --------------------- | --------------------------------------------------------------------------- | -----: | ----: |
| `nodefony-session`    | Reprise après `/clear`, ouverture de module, clôture (retex), consolidation |    133 |     — |
| `nodefony-quick-diff` | Résume les modifications non commitées de `src/` sans le compilé            |      0 |     0 |

### Développement du framework

| Skill                             | Rôle                                                                     | Invoc. | Lect. |
| --------------------------------- | ------------------------------------------------------------------------ | -----: | ----: |
| `nodefony-framework-dev`          | Kit du cœur backend : services, modules, pipeline HTTP/WS, realtime, ORM |      5 |  1250 |
| `nodefony-frontend-dev`           | Kit front général : isomorphisme, socket client, Vite/HMR, data-plane    |      1 |   185 |
| `nodefony-studio-dev`             | Écrans de l'app admin Studio (React 19, UI kit, Twin, debug bar)         |     25 |   684 |
| `nodefony-documentation`          | Portail doc + **système d'écriture** de la doc de référence et ses gates |      5 |  3583 |
| `nodefony-create-module`          | Scaffold d'un package `@nodefony/*` du dépôt                             |      0 |   424 |
| `nodefony-create-frontend-module` | Idem, avec un front SPA servi par Vite                                   |      0 |    98 |

### Exécution, diagnostic, mesure

| Skill                          | Rôle                                                                   | Invoc. | Lect. |
| ------------------------------ | ---------------------------------------------------------------------- | -----: | ----: |
| `nodefony-start-server`        | Démarre/arrête le serveur de développement (script unique, fail-fast)  |     22 |  1021 |
| `nodefony-load-test`           | Charge, stress, dimensionnement — **38 scripts** de banc               |      3 |  2279 |
| `nodefony-multipod-bench`      | Banc multi-applications réel sur bus Redis (fan-out, cloisonnement)    |      1 |   259 |
| `nodefony-tail-error-logs`     | Extrait les seules erreurs des logs serveur                            |      1 |     8 |
| `nodefony-debug`               | Orchestrateur de diagnostic (6 recettes éprouvées)                     |      0 |    13 |
| `nodefony-check-memory-health` | Gate mémoire : 1000 GET, 100 crashs, 100 WS, seuils de heap            |      0 |     0 |
| `nodefony-frontend-verify`     | Vérifie une modif front sans navigateur (transform Vite + purge cache) |      0 |     0 |

### Inspection et audit

| Skill                            | Rôle                                                             | Invoc. | Lect. |
| -------------------------------- | ---------------------------------------------------------------- | -----: | ----: |
| `nodefony-migration-audit`       | Confronte `MIGRATION_STATUS.md` au code, phase par phase         |      5 |    51 |
| `nodefony-security-review`       | Revue de conformité d'un diff **et** campagnes red/blue-team     |     10 |     2 |
| `nodefony-generate-symbols`      | Régénère `.ai/symbols.json` (graphe symbolique indexé)           |      0 |    10 |
| `nodefony-view-method-signature` | Signature d'une méthode depuis `dist/symbols.json`               |      0 |     0 |
| `nodefony-get-module-config`     | Config, services et routes d'un module sans charger son code     |      0 |     0 |
| `nodefony-check-externals`       | Dérive entre les `external` du bundler et les `peerDependencies` |      0 |     7 |

### Références externes et livrables

| Skill                  | Rôle                                                             | Invoc. | Lect. |
| ---------------------- | ---------------------------------------------------------------- | -----: | ----: |
| `nodefony-rfc`         | RFC IETF/W3C en source brute (HTTP, WS, CORS, cookies)           |      4 |     0 |
| `nodefony-html-report` | Fabrique des rapports HTML autonomes destinés à un humain        |      3 |   348 |
| `nodefony-roadmap`     | Contexte des phases Studio/IA/Realtime/Frontend                  |      0 |    24 |
| `nodefony-ts-docs`     | Doc TypeScript et `@types/node` en source brute                  |      0 |     0 |
| `nodefony-nestjs`      | Inspiration d'architecture NestJS (déclencheur mot-clé exclusif) |      0 |     2 |

### Commandes et garde-fou

| Fichier                               | Rôle                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------- |
| `.claude/commands/start-server.md`    | `/start-server [start\|stop\|restart\|debug\|build]` → délègue au skill |
| `.claude/commands/migration-audit.md` | `/migration-audit` → délègue au skill d'audit                           |
| `.claude/hooks/guard-bash.sh`         | Refuse `rg -r` (c'est `--replace`) et tout `cd` relatif avant exécution |

## Les scripts embarqués

Quatre skills portent du code exécutable — c'est là que se trouve la valeur qu'un texte ne peut pas
remplacer :

| Skill                     | Scripts | Ce qu'ils font                                                                                                       |
| ------------------------- | ------: | -------------------------------------------------------------------------------------------------------------------- |
| `nodefony-load-test`      |      38 | Bancs HTTP/WS, capacité, cluster, idempotence, TOTP, rate-limit, webhooks, AIMD, contention du puits de logs         |
| `nodefony-multipod-bench` |       9 | Décor multi-pods (`setup.sh`), latence, débit, coût de publication, forge d'enveloppe scellée, pic mémoire           |
| `nodefony-documentation`  |       6 | Les **gates** de la doc : `doc-lint`, `anchor-check`, `anchor-inpage`, `code-check`, `gen-counters`, `build-preview` |
| `nodefony-html-report`    |       3 | Bibliothèque de rendu (`report.mjs`, `brand.mjs`) + démonstration                                                    |
| `nodefony-start-server`   |       2 | `start.sh` / `stop.sh` — le lancement fiable du serveur de développement                                             |

> `nodefony-load-test/bench-frameworks/` embarque un `node_modules` local (16 Mo) pour comparer
> Nodefony à Express et Fastify. Il **n'est pas versionné** (vérifié) — mais il pèse sur les
> recherches lancées depuis la racine.

## Conformité au standard Agent Skills (AAIF / Linux Foundation)

Le standard tient en peu de règles : `name` ≤ 64 caractères en minuscules identique au dossier ;
`description` ≤ 1024 caractères ; **aucun champ hors** `name`, `description`, `license`, `metadata`,
`allowed-tools` (donc **`version` va sous `metadata`**) ; corps < 500 lignes ; ressources en
`scripts/`, `references/`, `assets/` sur **un seul niveau**. Validateur officiel :
`skills-ref validate ./<skill>`.

Écarts mesurés sur les 26 skills :

| Écart                                                 | Nombre | Skills concernés                                                                                                |
| ----------------------------------------------------- | -----: | --------------------------------------------------------------------------------------------------------------- |
| `version:` à la racine (doit être `metadata.version`) |      6 | `debug`, `documentation`, `framework-dev`, `frontend-dev`, `frontend-verify`, `studio-dev`                      |
| `description` > 1024 caractères                       |      5 | `documentation` (1990), `security-review` (1365), `debug` (1161), `framework-dev` (1102), `frontend-dev` (1090) |
| Corps > 500 lignes                                    |      2 | `documentation` (666), `session` (563)                                                                          |
| Dossier `reference/` au lieu de `references/`         |      6 | `framework-dev`, `frontend-dev`, `studio-dev`, `documentation`, `html-report`, `multipod-bench`                 |
| Ressources à deux niveaux (`reference/rfc/`)          |      2 | `framework-dev`, `frontend-dev`                                                                                 |
| `name` ≠ nom du dossier                               |      0 | —                                                                                                               |

Ces écarts ne gênent pas Claude Code, qui est tolérant. Ils gênent **la portabilité** : un skill non
conforme ne sera pas chargé par un autre client, et c'est précisément l'enjeu du module `devkit`, qui
prévoit d'en **publier** sur npm.

## L'étude — garder, réparer, fusionner, retirer

Le critère retenu n'est pas l'usage brut : **un skill à zéro invocation peut être excellent et
inutilisé pour une raison qu'on peut corriger**. Trois causes distinctes, trois remèdes :

### A. Doublé par le `CLAUDE.md` — le remède est de retirer la copie, pas le skill

C'est le cas dominant, et il valide la règle « une règle = une implémentation » :

- **`nodefony-check-memory-health`** (0 invocation). Sa commande `npm run test:memory` **existe et
  fonctionne** : le skill est juste. Mais le `CLAUDE.md` racine porte la même obligation avec la
  commande en dur, alors le skill n'est jamais atteint — or il porte **plus** que la commande : les
  seuils, le diagnostic d'un dépassement, la conduite à tenir. → Le `CLAUDE.md` doit **pointer** le
  skill au lieu de recopier sa commande.
- **`nodefony-generate-symbols`** (0). Le `CLAUDE.md` contient déjà la cheat-sheet `jq` et le hook
  de pré-commit régénère le fichier. Le skill ne sert plus qu'en régénération manuelle. → Même
  remède, ou fusion (ci-dessous).
- **`nodefony-debug`** (0 invocation, 13 lectures). Ses recettes sont bonnes et ses ancres valides ;
  ses déclencheurs sont **étroits par conception** (« ça crash », « ENOSPC »), donc rarement atteints
  — et devant un vrai incident, le réflexe est de lire les logs directement. → Élargir les
  déclencheurs aux formulations réelles (« test rouge inexpliqué », « vert isolé rouge en suite »).

### B. Recouvrement — candidats à la fusion

- **`view-method-signature` + `get-module-config` + `quick-diff`** (0, 0, 0) : trois micro-skills de
  lecture, ~230 lignes en tout, qui font la même chose sous trois noms — interroger l'état du dépôt
  sans lire les sources. Leurs ancrages sont **valides** (`dist/symbols.json` existe bien, 3 Mo,
  régénéré au pré-commit). → Fusionner en **un** `nodefony-inspect` (signature, config d'un module,
  diff propre), qui deviendra en outre la façade naturelle de `nodefony inspect --json` prévu par le
  devkit.
- **`generate-symbols`** rejoint naturellement ce même `nodefony-inspect` : produire le graphe et
  l'interroger sont deux faces d'un seul geste.
- **`frontend-verify`** (0, 0) : trois quarts de son contenu (transform Vite, purge du prébundle,
  rappel de rechargement) appartiennent au parcours de `nodefony-frontend-dev` / `studio-dev`. →
  Fusionner dedans plutôt que maintenir un skill que personne n'atteint.

### C. Périmé ou hors sujet — candidats au retrait

- **`nodefony-nestjs`** (0 invocation, 2 lectures, inchangé depuis mai). Son déclencheur est le mot
  « NestJS », qui n'apparaît plus : l'architecture est figée depuis longtemps. → Retirer ; la
  décision d'inspiration est déjà gravée dans le `CLAUDE.md`.
- **`nodefony-ts-docs`** (0, 0, inchangé depuis mai). Utile en principe, jamais atteint en pratique.
  → Garder mais **le déclencher depuis `framework-dev`** (déjà prévu dans sa table d'orchestration),
  ou l'absorber comme `references/` de ce dernier.
- **`nodefony-roadmap`** (0, 24) : les phases qu'il décrit sont livrées pour l'essentiel ; son
  contenu vivant a migré vers `MIGRATION_STATUS.md` et les mémoires de projet. → Vérifier ce qui
  reste vrai, puis réduire ou retirer.

### D. À garder tels quels

`session`, `studio-dev`, `start-server`, `framework-dev`, `documentation`, `load-test`,
`security-review`, `migration-audit`, `rfc`, `html-report`, `create-module`, `multipod-bench`,
`frontend-dev`, `create-frontend-module`, `tail-error-logs`, `check-externals`. Tous ont soit une
invocation régulière, soit un usage en lecture massif (leurs `references/` et `scripts/` sont la
vraie valeur), soit une fonction de filet rare mais irremplaçable.

**Bilan de l'étude** : 26 skills → **20** (4 fusionnés en 1, 1 retiré, 1 absorbé), sans perdre une
seule capacité.

## Le travail à faire

Par ordre de rentabilité décroissante. Les trois premiers points sont le **lot 0** du chantier
`@nodefony/devkit`, qui exige `skills-ref validate` vert avant de publier quoi que ce soit sur npm.

1. **Conformité mécanique** (une passe, sans risque) : 6 `version:` → `metadata.version` ;
   5 `description` à raccourcir sous 1024 caractères ; `reference/` → `references/` sur 6 skills
   (avec les liens internes) ; remonter `reference/rfc/` d'un niveau sur 2 skills. Gate :
   `skills-ref validate` sur les 26.
2. **Ajuster le `CLAUDE.md` là où il double un skill** — remplacer les commandes recopiées par un
   pointeur vers le skill, qui devient la source unique : gate mémoire, graphe symbolique,
   diagnostic. C'est ce qui rendra ces skills atteignables.
3. **Fusionner les quatre skills d'inspection** en `nodefony-inspect`, et absorber `frontend-verify`
   dans les kits front.
4. **Retirer `nodefony-nestjs`**, requalifier `nodefony-roadmap`.
5. **Découper les deux corps > 500 lignes** (`documentation`, `session`) en déplaçant le détail dans
   `references/` — ce sont aussi les deux plus gros consommateurs de contexte à l'activation.
6. **Réviser les skills inchangés depuis mai** (`rfc`, `ts-docs`, `nestjs`, `quick-diff`,
   `view-method-signature`, `generate-symbols`) : le framework a beaucoup bougé depuis. Leurs
   ancrages testés tiennent encore, mais l'absence de mise à jour sur deux mois est un signal de
   dérive à vérifier page par page, pas une preuve de péremption.

## Pièges

- **Zéro invocation ne veut pas dire inutile.** Trois causes très différentes produisent le même
  chiffre : doublon avec le `CLAUDE.md`, déclencheurs trop étroits, besoin disparu. Seule la
  troisième justifie un retrait — et il faut la prouver.
- **Compter les mentions d'un nom dans les transcrits ne mesure rien** : la liste des skills est
  injectée dans le prompt à chaque session, ce qui produit un plancher d'environ 108 occurrences
  identique pour tous. Seuls les appels réels à l'outil `Skill` et les lectures de fichiers
  distinguent quoi que ce soit.
- **Un skill très lu et jamais invoqué n'est pas en échec** : ses `references/` et ses `scripts/`
  servent, c'est sa porte d'entrée qui ne s'ouvre pas. Le remède est la `description`, pas le corps.
- **Vérifier une ancre avec le mauvais chemin conclut faux** : `dist/symbols.json` vit à la racine,
  pas sous `src/nodefony/` — testé au mauvais endroit, il déclare mort un skill parfaitement valide.
- **Un `references/` à deux niveaux est invisible pour un client conforme** : la spécification
  n'impose qu'un seul niveau de profondeur.

## Tests

`tests: none` — assumé. Cet outillage n'est pas du code du framework : il n'est pas chargé au boot,
n'entre dans aucun paquet publié et n'a pas de suite propre. Ce qui doit mordre ici, ce sont les
**gates** que les skills portent eux-mêmes (`doc-lint`, `anchor-check`, `code-check` pour la doc ;
`skills-ref validate` pour la conformité) et le garde-fou `guard-bash.sh`, éprouvé sur treize cas
dans les deux sens avant d'être installé.

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Toute la documentation](index.md)
- [`session-retros/CONSOLIDATION-2026-07-23.md`](session-retros/CONSOLIDATION-2026-07-23.md) — d'où viennent les décisions de cette page (coût du contexte, règle « une règle = une implémentation »)
- [`session-retros/RETEX.md`](session-retros/RETEX.md) — le sas des frictions récentes, lu à chaque début de session
- `CLAUDE.md` (racine) — les règles permanentes ; les conventions de structure sont déportées dans `references/conventions.md` du kit `nodefony-framework-dev`
- `tmp/specs-agents/agentskills-specification.md` — la spécification Agent Skills telle que récupérée (à revalider : elle bouge par trimestre)
