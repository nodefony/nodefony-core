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
> Le dépôt embarque **23 skills**, **2 commandes** et **1 garde-fou** destinés aux agents qui
> travaillent sur Nodefony. Cette page dit ce que chacun fait, **combien il sert réellement**
> (mesuré, pas estimé), s'il respecte le standard **Agent Skills** de l'AAIF, et comment l'inventaire
> a été resserré (fusions, retraits). Elle sert au moment où l'on se demande « ai-je un outil pour
> ça ? » ou « pourquoi celui-là ne se déclenche jamais ? ».

📍 [Documentation](index.md) › **Outillage agents**

> [!TIP]
> **Une fiche par skill** — version, contenu, déclencheurs, ressources, et chaque script avec ses
> options et ses variables d'environnement — est **générée** depuis les `SKILL.md` :
> [`docs/skills/`](skills/index.md). Régénérer et contrôler la conformité :
> `node .claude/skills/nodefony-skill/scripts/skills-doc.mjs`. Cette page-ci porte l'**analyse** (usage réel, doublons, fusions) ;
> les fiches portent l'**état**.

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

## Les skills, par famille

Chaque card mène à la **fiche** du skill : version, contenu, déclencheurs, ressources et scripts avec
leurs options. Ces cards sont **générées** par `node .claude/skills/nodefony-skill/scripts/skills-doc.mjs` — les modifier à la main
serait sans effet à la régénération suivante.

<!-- skills-cards:start -->

### Cycle de session

```nodefony-cards
[
  { "icon": "🧭", "title": "session", "href": "skills/nodefony-session.md",
    "desc": "Cycle de vie d'une session Nodefony en un seul skill (modes RESUME / START / END / CONSOLIDATE) : reprendre après un /clear, préparer le contexte d'un module, clôturer avec retex + mémoire de reprise.",
    "meta": "🟢 conforme · 📎 1 réf" },
  { "icon": "🧩", "title": "skill", "href": "skills/nodefony-skill.md",
    "desc": "Créer, éditer, fusionner, retirer ou auditer un skill du dépôt Nodefony. Dérive de `skill-creator` (qui porte la mécanique générique) et ajoute ce que Nodefony exige en propre : nommage `nodefony-*`, description calibrée pour se DÉCLENCHER (formulations de besoin, pas de noms d'outils),…",
    "meta": "🟢 conforme v1.2.0 · ⚙️ 3 scripts" }
]
```

### Développer le framework

```nodefony-cards
[
  { "icon": "🖼️", "title": "create-frontend-module", "href": "skills/nodefony-create-frontend-module.md",
    "desc": "Scaffold d'un module à frontend SPA (React 19, Vue 3, Angular 21) servi par @nodefony/frontend via Vite, DANS LE REPO FRAMEWORK (src/modules/). Dans une APPLICATION, le scaffold est une commande — `nodefony create module <nom> --frontend <fw>` — et ce skill se contente d'y renvoyer : il ne…",
    "meta": "🟢 conforme · 📎 1 réf" },
  { "icon": "📦", "title": "create-module", "href": "skills/nodefony-create-module.md",
    "desc": "Scaffold d'un package @nodefony/* du REPO FRAMEWORK (src/packages/) — package.json, tsconfig, rolldown, structure nodefony/{interfaces,service,command,src,config}/, index.ts (Module + @services + exports), CLAUDE.md, MEMORY.md, README.md, peerDeps, manifeste `modules`.",
    "meta": "🟢 conforme · 📎 1 réf" },
  { "icon": "📘", "title": "documentation", "href": "skills/nodefony-documentation.md",
    "desc": "Kit de dev de la DOCUMENTATION Nodefony, deux faces. (1) Le PORTAIL doc Studio et le futur module `@nodefony/documentation` : briques React (DocLayout, DocToc, MarkdownDoc, FlowGraph, SymbolGraph), mise en page docs-site, data plane avec allowlist anti-traversée.",
    "meta": "🟢 conforme v2.4.0 · ⚙️ 6 scripts · 📎 2 réf" },
  { "icon": "⚙️", "title": "framework-dev", "href": "skills/nodefony-framework-dev.md",
    "desc": "Kit de dev du CŒUR backend de Nodefony — core (`nodefony`), `@nodefony/http` (pipeline, serveurs, WS, sessions, certificats), `@nodefony/framework` (Router, Controller, décorateurs).",
    "meta": "🟢 conforme v2.0.0 · 📎 8 réf" },
  { "icon": "🎨", "title": "frontend-dev", "href": "skills/nodefony-frontend-dev.md",
    "desc": "Kit de dev FRONT de Nodefony — le full-stack côté client : isomorphisme (`nodefony` partagé front/back), socket client (`RealtimeClient`, hooks React), builder Vite + HMR (`@nodefony/frontend`, React/Vue/Angular), data-plane BFF (`ApiClient`/`useResource`), RBAC isomorphe, ergonomie / temps réel…",
    "meta": "🟢 conforme v1.0.0 · 📎 6 réf" },
  { "icon": "🖥️", "title": "studio-dev", "href": "skills/nodefony-studio-dev.md",
    "desc": "Kit de dev du frontend Studio de Nodefony (@nodefony/studio, React 19) — l'app admin interne du framework. Construire un écran (page / dashboard / panneau / onglet) vite et bien en réutilisant le UI kit (PageHeader, PageLayout, DataGrid, DataState, StatCard, KpiCard, JsonViewer, MiniChart,…",
    "meta": "🟢 conforme v2.0.0 · 📎 6 réf" }
]
```

### Exécuter, diagnostiquer, mesurer

```nodefony-cards
[
  { "icon": "🧠", "title": "check-memory-health", "href": "skills/nodefony-check-memory-health.md",
    "desc": "Gate mémoire de Nodefony : lance la suite d'intégration de @nodefony/http (1000 GET séquentiels, 100 crashs sync/async, 100 connexions WS), valide les seuils de heap, et surtout dit QUOI FAIRE quand un seuil saute (blocker, ne pas commiter, où chercher la fuite, comment distinguer une vraie…",
    "meta": "🟢 conforme" },
  { "icon": "🩺", "title": "debug", "href": "skills/nodefony-debug.md",
    "desc": "Kit debug runtime de Nodefony — à charger quand quelque chose vient de casser, pas pour concevoir. Codifie les recettes de diagnostic éprouvées : flake mémoire (l'isolation dit la vérité), vert en isolation et rouge en suite (ressource partagée, pas régression), qualifier une régression par une…",
    "meta": "🟢 conforme v1.1.0" },
  { "icon": "📈", "title": "load-test", "href": "skills/nodefony-load-test.md",
    "desc": "Charge, stress et DIMENSIONNEMENT HTTP/WebSocket de Nodefony : suites Vitest versionnées (non-régression, sondes de rupture derrière un flag) et une trentaine de scripts autonomes (plafond de connexions WS, débit, RPS et percentiles, capacité d'un pod, e2e cluster).",
    "meta": "🟢 conforme · ⚙️ 36 scripts · 📎 1 réf" },
  { "icon": "🛰️", "title": "multipod-bench", "href": "skills/nodefony-multipod-bench.md",
    "desc": "Monte un banc MULTI-PODS réel — plusieurs applications partageant un bus Redis — pour prouver un comportement cluster invisible aux tests unitaires : fan-out cross-pod, cloisonnement entre applications, injection depuis le bus, latence et débit de bout en bout.",
    "meta": "🟢 conforme · ⚙️ 9 scripts · 📎 2 réf" },
  { "icon": "🚀", "title": "start-server", "href": "skills/nodefony-start-server.md",
    "desc": "Lance le serveur Nodefony en mode développement pour les tests d'intégration — script unique start.sh (1 commande, 1 approbation) : build conditionnel du module test, kill ports, spawn detached du DevSupervisor (auto-restart), wait boot fail-fast, health check.",
    "meta": "🟢 conforme · ⚙️ 2 scripts" },
  { "icon": "📄", "title": "tail-error-logs", "href": "skills/nodefony-tail-error-logs.md",
    "desc": "Extrait uniquement les erreurs (ERROR / CRITIC / TypeError / SyntaxError / stack traces) des derniers logs du serveur Nodefony — supprime les codes ANSI et les requêtes 200 OK.",
    "meta": "🟢 conforme" }
]
```

### Inspecter et auditer

```nodefony-cards
[
  { "icon": "🔬", "title": "inspect", "href": "skills/nodefony-inspect.md",
    "desc": "Interroge l'état du dépôt Nodefony sans en lire les sources : graphe symbolique (qui étend une classe, qui implémente une interface, qui importe un symbole, où il est défini), signature d'une méthode, puis config / services / routes d'un module déjà existant — ses métadonnées, sans démarrer de…",
    "meta": "🟢 conforme v1.0.0" },
  { "icon": "🗺️", "title": "migration-audit", "href": "skills/nodefony-migration-audit.md",
    "desc": "Audit phase-par-phase de l'état RÉEL de la migration Nodefony — confronte MIGRATION_STATUS.md au code (grep/ls/find), une phase à la fois, corrige les écarts. Inclut un mode synthèse graphique (barres de progression par phase) ET un mode VÉRITÉ exhaustif : croise code + mémoire IA + docs + MD…",
    "meta": "🟢 conforme" },
  { "icon": "🛡️", "title": "security-review", "href": "skills/nodefony-security-review.md",
    "desc": "Hub SÉCURITÉ de Nodefony, deux modes. REVIEW : conformité d'un diff AVANT commit (injection bindée, secrets hors logs, RFC HTTP/WS/cookies/CORS, Zero Trust 403, JWT, crypto mot de passe, zéro any).",
    "meta": "🟢 conforme" }
]
```

### Publier et distribuer

```nodefony-cards
[
  { "icon": "🔗", "title": "check-externals", "href": "skills/nodefony-check-externals.md",
    "desc": "Audite la dérive entre la liste `external` des rolldown.config.ts et les `peerDependencies` de chaque package.json Nodefony — détecte le bug « peerDep bundlée » (cause d'échecs de build type @node-rs/bcrypt) et les entrées external périmées.",
    "meta": "🟢 conforme" },
  { "icon": "🚢", "title": "release", "href": "skills/nodefony-release.md",
    "desc": "Préparer et éprouver une publication npm de Nodefony (modèle N-paquets verrouillés sur la même version). Porte la chaîne complète : empaquetage des workspaces publiables avec bascule des `exports.types` au pack, post-traitement des `.d.ts` pour la résolution ESM de Node, puis smoke test en…",
    "meta": "🟢 conforme v1.0.0 · ⚙️ 3 scripts" }
]
```

### Références et livrables

```nodefony-cards
[
  { "icon": "📊", "title": "html-report", "href": "skills/nodefony-html-report.md",
    "desc": "Fabrique des rapports HTML autonomes (zéro dépendance, zéro CDN) destinés à des humains qui doivent DÉCIDER — audits, bancs de performance, revues, états des lieux, dashboards figés.",
    "meta": "🟢 conforme · ⚙️ 3 scripts · 📎 3 réf" },
  { "icon": "📜", "title": "rfc", "href": "skills/nodefony-rfc.md",
    "desc": "Cite et applique les RFC officielles IETF et W3C pour valider la conformité HTTP/1.1, HTTP/2, WebSocket, CORS, Cookies dans Nodefony — sources brutes (TXT IETF, raw GitHub W3C) via proxy r.jina.ai, jamais les pages HTML.",
    "meta": "🟢 conforme" },
  { "icon": "🗓️", "title": "roadmap", "href": "skills/nodefony-roadmap.md",
    "desc": "Contexte de la couche IA agentic de Nodefony (Phase 12) — la seule phase réellement future du framework : modules `@nodefony/{llm,vector,rag,memory,agent,agent-guard}`, invariants de design (générique, injectable, streaming natif, validation humaine, mode souverain, conformité AI Act, WebSocket…",
    "meta": "🟢 conforme v2.0.0" },
  { "icon": "🔤", "title": "ts-docs", "href": "skills/nodefony-ts-docs.md",
    "desc": "Consulte la doc officielle TypeScript (utility types, handbook, do's and don'ts) et les types Node.js (@types/node DefinitelyTyped) via sources brutes raw GitHub + proxy r.jina.ai, jamais typescriptlang.org (JS lourd).",
    "meta": "🟢 conforme" }
]
```
<!-- skills-cards:end -->

## L'inventaire chiffré — usage réel

Les deux colonnes de droite sont **mesurées** sur l'ensemble des transcrits du projet (~194
sessions) : _invocations_ = passages par l'outil `Skill` ; _lectures_ = accès directs à ses
fichiers. Un skill peut être très lu sans jamais être invoqué — c'est un signal, pas un défaut.

### Cycle de session

| Skill              | Rôle                                                                              | Invoc. | Lect. |
| ------------------ | --------------------------------------------------------------------------------- | -----: | ----: |
| `nodefony-session` | Reprise après `/clear`, ouverture de module, clôture (retex), consolidation       |    133 |     — |
| `nodefony-skill`   | Créer, éditer, fusionner, retirer ou auditer un skill (dérive de `skill-creator`) |      — |     — |

### Développement du framework

| Skill                             | Rôle                                                                                     | Invoc. | Lect. |
| --------------------------------- | ---------------------------------------------------------------------------------------- | -----: | ----: |
| `nodefony-framework-dev`          | Kit du cœur backend : services, modules, pipeline HTTP/WS, realtime, ORM                 |      5 |  1250 |
| `nodefony-frontend-dev`           | Kit front : isomorphisme, socket client, Vite/HMR, data-plane, **vérif sans navigateur** |      1 |   185 |
| `nodefony-studio-dev`             | Écrans de l'app admin Studio (React 19, UI kit, Twin, debug bar)                         |     25 |   684 |
| `nodefony-documentation`          | Portail doc + **système d'écriture** de la doc de référence et ses gates                 |      5 |  3583 |
| `nodefony-create-module`          | Scaffold d'un package `@nodefony/*` du dépôt                                             |      0 |   424 |
| `nodefony-create-frontend-module` | Idem, avec un front SPA servi par Vite                                                   |      0 |    98 |

### Exécution, diagnostic, mesure

| Skill                          | Rôle                                                                  | Invoc. | Lect. |
| ------------------------------ | --------------------------------------------------------------------- | -----: | ----: |
| `nodefony-start-server`        | Démarre/arrête le serveur de développement (script unique, fail-fast) |     22 |  1021 |
| `nodefony-load-test`           | Charge, stress, dimensionnement — **38 scripts** de banc              |      3 |  2279 |
| `nodefony-multipod-bench`      | Banc multi-applications réel sur bus Redis (fan-out, cloisonnement)   |      1 |   259 |
| `nodefony-tail-error-logs`     | Extrait les seules erreurs des logs serveur                           |      1 |     8 |
| `nodefony-debug`               | Orchestrateur de diagnostic (6 recettes éprouvées)                    |      0 |    13 |
| `nodefony-check-memory-health` | Gate mémoire : 1000 GET, 100 crashs, 100 WS, seuils de heap           |      0 |     0 |

### Inspection et audit

| Skill                      | Rôle                                                                        | Invoc. | Lect. |
| -------------------------- | --------------------------------------------------------------------------- | -----: | ----: |
| `nodefony-migration-audit` | Confronte `MIGRATION_STATUS.md` au code, phase par phase                    |      5 |    51 |
| `nodefony-security-review` | Revue de conformité d'un diff **et** campagnes red/blue-team                |     10 |     2 |
| `nodefony-inspect`         | Graphe symbolique, signature d'une méthode, config d'un module, diff propre |      — |     — |
| `nodefony-check-externals` | Dérive entre les `external` du bundler et les `peerDependencies`            |      0 |     7 |

### Références externes et livrables

| Skill                  | Rôle                                                      | Invoc. | Lect. |
| ---------------------- | --------------------------------------------------------- | -----: | ----: |
| `nodefony-rfc`         | RFC IETF/W3C en source brute (HTTP, WS, CORS, cookies)    |      4 |     0 |
| `nodefony-html-report` | Fabrique des rapports HTML autonomes destinés à un humain |      3 |   348 |
| `nodefony-roadmap`     | Contexte des phases Studio/IA/Realtime/Frontend           |      0 |    24 |
| `nodefony-ts-docs`     | Doc TypeScript et `@types/node` en source brute           |      0 |     0 |

### Commandes et garde-fou

| Fichier                               | Rôle                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------- |
| `.claude/commands/start-server.md`    | `/start-server [start\|stop\|restart\|debug\|build]` → délègue au skill |
| `.claude/commands/migration-audit.md` | `/migration-audit` → délègue au skill d'audit                           |
| `.claude/hooks/guard-bash.sh`         | Refuse `rg -r` (c'est `--replace`) et tout `cd` relatif avant exécution |

## Les scripts embarqués

Plusieurs skills portent du code exécutable — c'est là que se trouve la valeur qu'un texte ne peut
pas remplacer :

| Skill                     | Scripts | Ce qu'ils font                                                                                                              |
| ------------------------- | ------: | --------------------------------------------------------------------------------------------------------------------------- |
| `nodefony-load-test`      |      38 | Bancs HTTP/WS, capacité, cluster, idempotence, TOTP, rate-limit, webhooks, AIMD, contention du puits de logs                |
| `nodefony-multipod-bench` |       9 | Décor multi-pods (`setup.sh`), latence, débit, coût de publication, forge d'enveloppe scellée, pic mémoire                  |
| `nodefony-documentation`  |       6 | Les **gates** de la doc : `doc-lint`, `anchor-check`, `anchor-inpage`, `code-check`, `gen-counters`, `build-preview`        |
| `nodefony-skill`          |       3 | Les **gates** des skills : `skills-doc` (conformité + fiches), `trigger-bench` (déclenchement), `scripts-audit` (placement) |
| `nodefony-html-report`    |       3 | Bibliothèque de rendu (`report.mjs`, `brand.mjs`) + démonstration                                                           |
| `nodefony-start-server`   |       2 | `start.sh` / `stop.sh` — le lancement fiable du serveur de développement                                                    |

> `nodefony-load-test/bench-frameworks/` embarque un `node_modules` local (16 Mo) pour comparer
> Nodefony à Express et Fastify. Il **n'est pas versionné** (vérifié) — mais il pèse sur les
> recherches lancées depuis la racine.

## Conformité au standard Agent Skills (AAIF / Linux Foundation)

Le standard tient en peu de règles **normatives** : `name` ≤ 64 caractères en minuscules, identique au
dossier ; `description` de 1 à 1024 caractères ; **aucun champ hors** `name`, `description`, `license`,
`metadata`, `allowed-tools` — donc **`version` va sous `metadata`**. Le reste relève de la
**recommandation** : corps court, ressources rangées en `scripts/`, `references/`, `assets/`, et
« garder les références à un seul saut depuis `SKILL.md` » (une règle sur les **chaînes** de renvoi,
pas sur la profondeur de l'arborescence — un bundle `references/rfc/ietf/` cité directement reste
conforme). Validateur officiel : `skills-ref validate ./<skill>`.

État après la passe de conformité :

| Point                                         | Avant | Après | Détail                                                                                                                                              |
| --------------------------------------------- | ----: | ----: | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version:` à la racine (normatif)             |     6 | **0** | `debug`, `documentation`, `framework-dev`, `frontend-dev`, `frontend-verify`, `studio-dev` → `metadata.version`                                     |
| `description` > 1024 caractères (normatif)    |     5 | **0** | `documentation` 1990→~980, `security-review` 1365→1017, `debug`, `framework-dev`, `frontend-dev` — la plus longue est désormais `html-report` (935) |
| `name` ≠ nom du dossier (normatif)            |     0 | **0** | —                                                                                                                                                   |
| Dossier `reference/` au lieu de `references/` |     8 | **0** | renommé sur les 8 skills concernés, 112 liens réécrits                                                                                              |
| Renvois vers un fichier inexistant            |    16 | **0** | dette **pré-existante** révélée par la vérification (voir ci-dessous)                                                                               |
| Corps > 500 lignes (recommandation)           |     2 |     2 | `documentation` (666), `session` (563) — non traité, demande un découpage éditorial                                                                 |

**La dette révélée en chemin** : 16 renvois pointaient vers des fichiers absents — huit `references/recipes-*.md`
supprimés lors du refactor `f636fd74` sans que les renvois suivent, et huit renvois croisés entre skills
écrits en chemin relatif (donc irrésolvables depuis le skill émetteur). Vérifié sur `HEAD` avant
intervention : ils étaient déjà morts. Les premiers pointent maintenant le fichier qui a absorbé leur
contenu, les seconds sont préfixés par le skill propriétaire. Même famille : `nodefony-debug` renvoyait
deux fois vers une section « §4 Debug runtime » de `framework-dev` disparue au même refactor, alors que
la capacité (`NODEFONY_DEV_CHILD=1`) existe toujours dans `DevSupervisor.ts` — le renvoi pointe
désormais le code.

Ces écarts ne gênaient pas Claude Code, qui est tolérant. Ils gênaient **la portabilité** : un skill non
conforme n'est pas chargé par un autre client, et c'est précisément l'enjeu du module `devkit`, qui
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
- **`nodefony-debug`** (0 invocation, 13 lectures). Ses recettes sont bonnes et ses ancres valides ;
  ses déclencheurs sont **étroits par conception** (« ça crash », « ENOSPC »), donc rarement atteints
  — et devant un vrai incident, le réflexe est de lire les logs directement. → Élargir les
  déclencheurs aux formulations réelles (« test rouge inexpliqué », « vert isolé rouge en suite »).

### B. Recouvrement — fusions réalisées

- **`nodefony-inspect`** rassemble ce qui était `view-method-signature`, `get-module-config`,
  `quick-diff` et `generate-symbols` — quatre micro-skills de lecture (0 invocation chacun) qui
  faisaient la même chose sous quatre noms : interroger l'état du dépôt sans lire les sources.
  Un seul skill porte désormais le graphe symbolique, la signature d'une méthode, la config d'un
  module et le diff propre — et il devient la façade naturelle du `nodefony inspect --json` prévu par
  le devkit.
- **`frontend-verify`** (0 invocation) est **absorbé** par `nodefony-frontend-dev` : son contenu
  (transform Vite, purge du prébundle, rechargement) a rejoint `references/build-hmr.md` §8, et ses
  déclencheurs la description du kit front. Maintenir un skill séparé que personne n'atteignait ne se
  justifiait plus.

### C. Périmé ou hors sujet

- **`nodefony-nestjs`** (0 invocation) est **retiré** : son déclencheur était le mot « NestJS », qui
  n'apparaît plus, l'architecture étant figée depuis longtemps ; la décision d'inspiration reste
  gravée dans le `CLAUDE.md`.
- **`nodefony-ts-docs`** (0 invocation). Utile en principe, jamais atteint en pratique. Conservé,
  mais cité par la table d'orchestration de `framework-dev` qui le déclenche au besoin.
- **`nodefony-roadmap`** (0 invocation, 24 lectures) : les phases qu'il décrit sont livrées pour
  l'essentiel ; son contenu vivant a migré vers `MIGRATION_STATUS.md`. Conservé pour l'instant, à
  requalifier — reste vérifiable page par page.

### D. À garder tels quels

`session`, `skill`, `studio-dev`, `start-server`, `framework-dev`, `documentation`, `load-test`,
`security-review`, `migration-audit`, `rfc`, `html-report`, `create-module`, `multipod-bench`,
`frontend-dev`, `create-frontend-module`, `tail-error-logs`, `check-externals`. Tous ont soit une
invocation régulière, soit un usage en lecture massif (leurs `references/` et `scripts/` sont la
vraie valeur), soit une fonction de filet rare mais irremplaçable.

**Bilan** : 28 skills → **23** — quatre skills d'inspection fusionnés en `nodefony-inspect`,
`frontend-verify` absorbé par `frontend-dev`, `nestjs` retiré. Aucune capacité perdue, et le gate
`skills-doc` refuse désormais tout renvoi vers un skill disparu.

## Le travail à faire

La conformité mécanique, l'ajustement du `CLAUDE.md`, les fusions et le retrait sont **faits** ; ce
qui suit reste ouvert, par ordre de rentabilité décroissante.

1. **Découper les deux corps > 500 lignes** (`documentation` 641, `session` 555) en déplaçant le
   détail dans `references/` — ce sont aussi les deux plus gros consommateurs de contexte à
   l'activation.
2. **Arbitrer les recouvrements de déclencheurs** que le banc `trigger-bench` signale (9 au dernier
   passage) : tous ne sont pas des défauts (« fuite mémoire » vaut mieux capté par
   `check-memory-health` que par `debug`), mais chacun mérite une décision consciente.
3. **Requalifier `nodefony-roadmap`** : vérifier page par page ce qui reste vrai des phases décrites,
   puis réduire ou retirer.
4. **Réviser les skills inchangés depuis mai** (`rfc`, `ts-docs`) : le framework a beaucoup bougé
   depuis. Leurs ancrages testés tiennent encore, mais l'absence de mise à jour sur deux mois est un
   signal de dérive à vérifier page par page, pas une preuve de péremption.

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
