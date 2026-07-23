---
title: "Fiches des skills — index généré"
lang: fr
audience: humain
topic: skills
tests: none
status: stable
updated: 2026-07-23
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: "docs/skills/index.md"
---

# Fiches des skills

> Une fiche par skill du dépôt de développement, **générée** depuis son `SKILL.md` par
> `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` : version, contenu, déclencheurs, ressources, scripts et conformité
> au standard Agent Skills. L'analyse d'ensemble — usage réel, doublons, fusions — vit dans
> [Outillage agents](../outillage-agents.md).

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **Fiches des skills**

**23 skills** · **23/23 conformes** au standard · régénérer : `node .claude/skills/nodefony-skill/scripts/skills-doc.mjs`

## 🧭 Par où commencer

- **Comprendre l'ensemble** (usage réel, doublons, fusions, conformité) →
  [Outillage agents](../outillage-agents.md).
- **Écrire ou réparer un skill** → la fiche [`nodefony-skill`](nodefony-skill.md), qui porte
  les conventions du dépôt et la barrière de conformité.
- **Chercher un outil pour une tâche précise** → les cards par famille ci-dessous ; chacune
  mène à la fiche du skill, avec ses déclencheurs et ses scripts.

## Par famille

### Cycle de session

```nodefony-cards
[
  { "icon": "🧭", "title": "session", "href": "nodefony-session.md",
    "desc": "Cycle de vie d'une session Nodefony en un seul skill (modes RESUME / START / END / CONSOLIDATE) : reprendre après un /clear, préparer le contexte d'un module, clôturer avec retex + mémoire de reprise.",
    "meta": "🟢 conforme · 📎 1 réf" },
  { "icon": "🧩", "title": "skill", "href": "nodefony-skill.md",
    "desc": "Créer, éditer, fusionner, retirer ou auditer un skill du dépôt Nodefony. Dérive de `skill-creator` (qui porte la mécanique générique) et ajoute ce que Nodefony exige en propre : nommage `nodefony-*`, description calibrée pour se DÉCLENCHER (formulations de besoin, pas de noms d'outils),…",
    "meta": "🟢 conforme v1.2.0 · ⚙️ 3 scripts" }
]
```

### Développer le framework

```nodefony-cards
[
  { "icon": "🖼️", "title": "create-frontend-module", "href": "nodefony-create-frontend-module.md",
    "desc": "Scaffold d'un module à frontend SPA (React 19, Vue 3, Angular 21) servi par @nodefony/frontend via Vite, DANS LE REPO FRAMEWORK (src/modules/). Dans une APPLICATION, le scaffold est une commande — `nodefony create module <nom> --frontend <fw>` — et ce skill se contente d'y renvoyer : il ne…",
    "meta": "🟢 conforme · 📎 1 réf" },
  { "icon": "📦", "title": "create-module", "href": "nodefony-create-module.md",
    "desc": "Scaffold d'un package @nodefony/* du REPO FRAMEWORK (src/packages/) — package.json, tsconfig, rolldown, structure nodefony/{interfaces,service,command,src,config}/, index.ts (Module + @services + exports), CLAUDE.md, MEMORY.md, README.md, peerDeps, manifeste `modules`.",
    "meta": "🟢 conforme · 📎 1 réf" },
  { "icon": "📘", "title": "documentation", "href": "nodefony-documentation.md",
    "desc": "Kit de dev de la DOCUMENTATION Nodefony, deux faces. (1) Le PORTAIL doc Studio et le futur module `@nodefony/documentation` : briques React (DocLayout, DocToc, MarkdownDoc, FlowGraph, SymbolGraph), mise en page docs-site, data plane avec allowlist anti-traversée.",
    "meta": "🟢 conforme v2.4.0 · ⚙️ 6 scripts · 📎 2 réf" },
  { "icon": "⚙️", "title": "framework-dev", "href": "nodefony-framework-dev.md",
    "desc": "Kit de dev du CŒUR backend de Nodefony — core (`nodefony`), `@nodefony/http` (pipeline, serveurs, WS, sessions, certificats), `@nodefony/framework` (Router, Controller, décorateurs).",
    "meta": "🟢 conforme v2.0.0 · 📎 8 réf" },
  { "icon": "🎨", "title": "frontend-dev", "href": "nodefony-frontend-dev.md",
    "desc": "Kit de dev FRONT de Nodefony — le full-stack côté client : isomorphisme (`nodefony` partagé front/back), socket client (`RealtimeClient`, hooks React), builder Vite + HMR (`@nodefony/frontend`, React/Vue/Angular), data-plane BFF (`ApiClient`/`useResource`), RBAC isomorphe, ergonomie / temps réel…",
    "meta": "🟢 conforme v1.0.0 · 📎 6 réf" },
  { "icon": "🖥️", "title": "studio-dev", "href": "nodefony-studio-dev.md",
    "desc": "Kit de dev du frontend Studio de Nodefony (@nodefony/studio, React 19) — l'app admin interne du framework. Construire un écran (page / dashboard / panneau / onglet) vite et bien en réutilisant le UI kit (PageHeader, PageLayout, DataGrid, DataState, StatCard, KpiCard, JsonViewer, MiniChart,…",
    "meta": "🟢 conforme v2.0.0 · 📎 6 réf" }
]
```

### Exécuter, diagnostiquer, mesurer

```nodefony-cards
[
  { "icon": "🧠", "title": "check-memory-health", "href": "nodefony-check-memory-health.md",
    "desc": "Gate mémoire de Nodefony : lance la suite d'intégration de @nodefony/http (1000 GET séquentiels, 100 crashs sync/async, 100 connexions WS), valide les seuils de heap, et surtout dit QUOI FAIRE quand un seuil saute (blocker, ne pas commiter, où chercher la fuite, comment distinguer une vraie…",
    "meta": "🟢 conforme" },
  { "icon": "🩺", "title": "debug", "href": "nodefony-debug.md",
    "desc": "Kit debug runtime de Nodefony — à charger quand quelque chose vient de casser, pas pour concevoir. Codifie les recettes de diagnostic éprouvées : flake mémoire (l'isolation dit la vérité), vert en isolation et rouge en suite (ressource partagée, pas régression), qualifier une régression par une…",
    "meta": "🟢 conforme v1.1.0" },
  { "icon": "📈", "title": "load-test", "href": "nodefony-load-test.md",
    "desc": "Charge, stress et DIMENSIONNEMENT HTTP/WebSocket de Nodefony : suites Vitest versionnées (non-régression, sondes de rupture derrière un flag) et une trentaine de scripts autonomes (plafond de connexions WS, débit, RPS et percentiles, capacité d'un pod, e2e cluster).",
    "meta": "🟢 conforme · ⚙️ 36 scripts · 📎 1 réf" },
  { "icon": "🛰️", "title": "multipod-bench", "href": "nodefony-multipod-bench.md",
    "desc": "Monte un banc MULTI-PODS réel — plusieurs applications partageant un bus Redis — pour prouver un comportement cluster invisible aux tests unitaires : fan-out cross-pod, cloisonnement entre applications, injection depuis le bus, latence et débit de bout en bout.",
    "meta": "🟢 conforme · ⚙️ 9 scripts · 📎 2 réf" },
  { "icon": "🚀", "title": "start-server", "href": "nodefony-start-server.md",
    "desc": "Lance le serveur Nodefony en mode développement pour les tests d'intégration — script unique start.sh (1 commande, 1 approbation) : build conditionnel du module test, kill ports, spawn detached du DevSupervisor (auto-restart), wait boot fail-fast, health check.",
    "meta": "🟢 conforme · ⚙️ 2 scripts" },
  { "icon": "📄", "title": "tail-error-logs", "href": "nodefony-tail-error-logs.md",
    "desc": "Extrait uniquement les erreurs (ERROR / CRITIC / TypeError / SyntaxError / stack traces) des derniers logs du serveur Nodefony — supprime les codes ANSI et les requêtes 200 OK.",
    "meta": "🟢 conforme" }
]
```

### Inspecter et auditer

```nodefony-cards
[
  { "icon": "🔬", "title": "inspect", "href": "nodefony-inspect.md",
    "desc": "Interroge l'état du dépôt Nodefony sans en lire les sources : graphe symbolique (qui étend une classe, qui implémente une interface, qui importe un symbole, où il est défini), signature d'une méthode, puis config / services / routes d'un module déjà existant — ses métadonnées, sans démarrer de…",
    "meta": "🟢 conforme v1.0.0" },
  { "icon": "🗺️", "title": "migration-audit", "href": "nodefony-migration-audit.md",
    "desc": "Audit phase-par-phase de l'état RÉEL de la migration Nodefony — confronte MIGRATION_STATUS.md au code (grep/ls/find), une phase à la fois, corrige les écarts. Inclut un mode synthèse graphique (barres de progression par phase) ET un mode VÉRITÉ exhaustif : croise code + mémoire IA + docs + MD…",
    "meta": "🟢 conforme" },
  { "icon": "🛡️", "title": "security-review", "href": "nodefony-security-review.md",
    "desc": "Hub SÉCURITÉ de Nodefony, deux modes. REVIEW : conformité d'un diff AVANT commit (injection bindée, secrets hors logs, RFC HTTP/WS/cookies/CORS, Zero Trust 403, JWT, crypto mot de passe, zéro any).",
    "meta": "🟢 conforme" }
]
```

### Publier et distribuer

```nodefony-cards
[
  { "icon": "🔗", "title": "check-externals", "href": "nodefony-check-externals.md",
    "desc": "Audite la dérive entre la liste `external` des rolldown.config.ts et les `peerDependencies` de chaque package.json Nodefony — détecte le bug « peerDep bundlée » (cause d'échecs de build type @node-rs/bcrypt) et les entrées external périmées.",
    "meta": "🟢 conforme" },
  { "icon": "🚢", "title": "release", "href": "nodefony-release.md",
    "desc": "Préparer et éprouver une publication npm de Nodefony (modèle N-paquets verrouillés sur la même version). Porte la chaîne complète : empaquetage des workspaces publiables avec bascule des `exports.types` au pack, post-traitement des `.d.ts` pour la résolution ESM de Node, puis smoke test en…",
    "meta": "🟢 conforme v1.0.0 · ⚙️ 3 scripts" }
]
```

### Références et livrables

```nodefony-cards
[
  { "icon": "📊", "title": "html-report", "href": "nodefony-html-report.md",
    "desc": "Fabrique des rapports HTML autonomes (zéro dépendance, zéro CDN) destinés à des humains qui doivent DÉCIDER — audits, bancs de performance, revues, états des lieux, dashboards figés.",
    "meta": "🟢 conforme · ⚙️ 3 scripts · 📎 3 réf" },
  { "icon": "📜", "title": "rfc", "href": "nodefony-rfc.md",
    "desc": "Cite et applique les RFC officielles IETF et W3C pour valider la conformité HTTP/1.1, HTTP/2, WebSocket, CORS, Cookies dans Nodefony — sources brutes (TXT IETF, raw GitHub W3C) via proxy r.jina.ai, jamais les pages HTML.",
    "meta": "🟢 conforme" },
  { "icon": "🗓️", "title": "roadmap", "href": "nodefony-roadmap.md",
    "desc": "Contexte de la couche IA agentic de Nodefony (Phase 12) — la seule phase réellement future du framework : modules `@nodefony/{llm,vector,rag,memory,agent,agent-guard}`, invariants de design (générique, injectable, streaming natif, validation humaine, mode souverain, conformité AI Act, WebSocket…",
    "meta": "🟢 conforme v2.0.0" },
  { "icon": "🔤", "title": "ts-docs", "href": "nodefony-ts-docs.md",
    "desc": "Consulte la doc officielle TypeScript (utility types, handbook, do's and don'ts) et les types Node.js (@types/node DefinitelyTyped) via sources brutes raw GitHub + proxy r.jina.ai, jamais typescriptlang.org (JS lourd).",
    "meta": "🟢 conforme" }
]
```

## Tableau récapitulatif

| Skill | Version | Corps | Réf. | Scripts | Conforme |
| --- | --- | ---: | ---: | ---: | :---: |
| [`nodefony-check-externals`](nodefony-check-externals.md) | — | 86 | 0 | 0 | ✅ |
| [`nodefony-check-memory-health`](nodefony-check-memory-health.md) | — | 83 | 0 | 0 | ✅ |
| [`nodefony-create-frontend-module`](nodefony-create-frontend-module.md) | — | 247 | 1 | 0 | ✅ |
| [`nodefony-create-module`](nodefony-create-module.md) | — | 276 | 1 | 0 | ✅ |
| [`nodefony-debug`](nodefony-debug.md) | 1.1.0 | 192 | 0 | 0 | ✅ |
| [`nodefony-documentation`](nodefony-documentation.md) | 2.4.0 | 439 | 2 | 6 | ✅ |
| [`nodefony-framework-dev`](nodefony-framework-dev.md) | 2.0.0 | 299 | 8 | 0 | ✅ |
| [`nodefony-frontend-dev`](nodefony-frontend-dev.md) | 1.0.0 | 100 | 6 | 0 | ✅ |
| [`nodefony-html-report`](nodefony-html-report.md) | — | 174 | 3 | 3 | ✅ |
| [`nodefony-inspect`](nodefony-inspect.md) | 1.0.0 | 210 | 0 | 0 | ✅ |
| [`nodefony-load-test`](nodefony-load-test.md) | — | 443 | 1 | 36 | ✅ |
| [`nodefony-migration-audit`](nodefony-migration-audit.md) | — | 357 | 0 | 0 | ✅ |
| [`nodefony-multipod-bench`](nodefony-multipod-bench.md) | — | 140 | 2 | 9 | ✅ |
| [`nodefony-release`](nodefony-release.md) | 1.0.0 | 67 | 0 | 3 | ✅ |
| [`nodefony-rfc`](nodefony-rfc.md) | — | 68 | 0 | 0 | ✅ |
| [`nodefony-roadmap`](nodefony-roadmap.md) | 2.0.0 | 108 | 0 | 0 | ✅ |
| [`nodefony-security-review`](nodefony-security-review.md) | — | 356 | 0 | 0 | ✅ |
| [`nodefony-session`](nodefony-session.md) | — | 434 | 1 | 0 | ✅ |
| [`nodefony-skill`](nodefony-skill.md) | 1.2.0 | 276 | 0 | 3 | ✅ |
| [`nodefony-start-server`](nodefony-start-server.md) | — | 209 | 0 | 2 | ✅ |
| [`nodefony-studio-dev`](nodefony-studio-dev.md) | 2.0.0 | 143 | 6 | 0 | ✅ |
| [`nodefony-tail-error-logs`](nodefony-tail-error-logs.md) | — | 77 | 0 | 0 | ✅ |
| [`nodefony-ts-docs`](nodefony-ts-docs.md) | — | 66 | 0 | 0 | ✅ |

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Outillage agents](../outillage-agents.md) · [Toute la documentation](../index.md)
- **Écrire un skill** : [`nodefony-skill`](nodefony-skill.md) — conventions, gabarit, barrière de conformité.
- **Le standard** : `name`, `description` ≤ 1024, champs autorisés, ressources en `references/`.
  Validateur officiel : `skills-ref validate ./<skill>`.
