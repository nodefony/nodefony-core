---
title: "Fiches des skills — index généré"
lang: fr
audience: humain
topic: skills
tests: none
status: stable
updated: 2026-09-03
generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs
source: "docs/skills/index.md"
---

# Fiches des skills

> Une fiche par skill du dépôt de développement, **générée** depuis son `SKILL.md` par
> `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` : version, contenu, déclencheurs, ressources, scripts et conformité
> au standard Agent Skills. L'analyse d'ensemble — usage réel, doublons, fusions — vit dans
> [Outillage agents](../outillage-agents.md).

📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **Fiches des skills**

**25 skills** · **25/25 conformes** au standard · régénérer : `node .claude/skills/nodefony-skill/scripts/skills-doc.mjs`

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
    "desc": "Cycle de vie d'une session Nodefony en un seul skill (modes RESUME / START / END / CONSOLIDATE) : reprendre après un /clear — avec l'avancement RÉEL lu sur le jalon et les tickets GitHub, pas sur un document écrit à la main —, préparer le contexte d'un module, clôturer avec retex, fermeture des…",
    "meta": "🟢 conforme · ⚙️ 2 scripts · 📎 2 réf" },
  { "icon": "🧩", "title": "skill", "href": "nodefony-skill.md",
    "desc": "Créer, éditer, fusionner, retirer ou auditer un skill du dépôt Nodefony. Dérive de `skill-creator` (qui porte la mécanique générique) et ajoute ce que Nodefony exige en propre : nommage `nodefony-*`, description calibrée pour se DÉCLENCHER (formulations de besoin, pas de noms d'outils),…",
    "meta": "🟢 conforme v1.2.0 · ⚙️ 3 scripts" }
]
```

### Développer le framework

```nodefony-cards
[
  { "icon": "🖼️", "title": "create-frontend-module", "href": "nodefony-create-frontend-module.md",
    "desc": "Scaffold d'un module à frontend SPA (React 19, Vue 3, Angular 21, Svelte 5) servi par @nodefony/frontend via Vite, DANS LE REPO FRAMEWORK (src/modules/). Dans une APPLICATION, le scaffold est une commande — `nodefony create module <nom> --frontend <fw>` — et ce skill se contente d'y renvoyer :…",
    "meta": "🟢 conforme · 📎 1 réf" },
  { "icon": "📦", "title": "create-module", "href": "nodefony-create-module.md",
    "desc": "Scaffold d'un package @nodefony/* du REPO FRAMEWORK (src/packages/) — package.json, tsconfig, rolldown, structure nodefony/{interfaces,service,command,src,config}/, index.ts (Module + @services + exports), CLAUDE.md, MEMORY.md, README.md, peerDeps, manifeste `modules`.",
    "meta": "🟢 conforme · 📎 1 réf" },
  { "icon": "📘", "title": "documentation", "href": "nodefony-documentation.md",
    "desc": "Kit de dev de la DOCUMENTATION Nodefony, trois faces. (1) Le SITE PUBLIC : générateur `build-docs-site.mjs`, tri de ce qui devient public (dossier, statut, clé `publish`), liens relatifs, flux GitHub Pages unique, gate anti-lien-mort.",
    "meta": "🟢 conforme v3.0.0 · ⚙️ 7 scripts · 📎 2 réf" },
  { "icon": "⚙️", "title": "framework-dev", "href": "nodefony-framework-dev.md",
    "desc": "Kit de dev du CŒUR backend de Nodefony : core (`nodefony`), `@nodefony/http` (pipeline, serveurs, WS, sessions), `@nodefony/framework` (Router, Controller, décorateurs) et les modules (services, stores, ORM).",
    "meta": "🟢 conforme v2.0.0 · 📎 10 réf" },
  { "icon": "🎨", "title": "frontend-dev", "href": "nodefony-frontend-dev.md",
    "desc": "Kit de dev FRONT de Nodefony — full-stack côté client : isomorphisme (`nodefony` partagé front/back), socket client (`RealtimeClient`, hooks React), builder Vite + HMR (`@nodefony/frontend`, React/Vue/Angular), data-plane BFF (`ApiClient`/`useResource`), RBAC isomorphe, ergonomie/a11y/perf…",
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
    "meta": "🟢 conforme · ⚙️ 43 scripts · 📎 4 réf" },
  { "icon": "🛰️", "title": "multipod-bench", "href": "nodefony-multipod-bench.md",
    "desc": "Monte un banc MULTI-PODS réel — plusieurs applications partageant un bus Redis — pour prouver un comportement cluster invisible aux tests unitaires : fan-out cross-pod, cloisonnement entre applications, injection depuis le bus, latence et débit de bout en bout.",
    "meta": "🟢 conforme · ⚙️ 12 scripts · 📎 2 réf" },
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
    "desc": "Interroge le dépôt Nodefony par DEUX voies : le graphe symbolique pour les relations de CODE (qui étend, implémente ou importe un symbole ; où il est défini ; signature d'une méthode), et la commande `nodefony inspect` pour l'état RÉEL d'une application qui démarre (routes montées, services…",
    "meta": "🟢 conforme v1.0.0" },
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
    "desc": "Conduire une publication npm de Nodefony (N paquets verrouillés sur la même version) : quelle commande lancer, dans quel ordre, ce que chaque garde refuse, comment lire un échec.",
    "meta": "🟢 conforme v2.0.0 · ⚙️ 1 script" }
]
```

### Références et livrables

```nodefony-cards
[
  { "icon": "📊", "title": "html-report", "href": "nodefony-html-report.md",
    "desc": "Fabrique des rapports HTML autonomes (zéro CDN) pour des humains qui doivent DÉCIDER — audits, bancs de performance, revues, dashboards figés. Deux moteurs de figures : `lib/report.mjs` (tableaux triables et filtrables, calculateurs interactifs, onglets, export CSV, impression PDF soignée) et…",
    "meta": "🟢 conforme · ⚙️ 8 scripts · 📎 3 réf" },
  { "icon": "📜", "title": "rfc", "href": "nodefony-rfc.md",
    "desc": "Cite et applique les normes qui font foi pour Nodefony — RFC IETF, specs W3C/WHATWG, et la spécification Model Context Protocol — depuis des sources brutes, jamais des pages HTML.",
    "meta": "🟢 conforme v1.1.0" },
  { "icon": "🗓️", "title": "roadmap", "href": "nodefony-roadmap.md",
    "desc": "Contexte de la couche IA agentic de Nodefony (Phase 12) — la seule phase réellement future du framework : modules `@nodefony/{llm,vector,rag,memory,agent,agent-guard}`, invariants de design (générique, injectable, streaming natif, validation humaine, mode souverain, conformité AI Act, WebSocket…",
    "meta": "🟢 conforme v2.0.0" }
]
```

### Autres

```nodefony-cards
[
  { "icon": "🔧", "title": "browser", "href": "nodefony-browser.md",
    "desc": "Ouvre une page réelle dans un navigateur piloté — poste ou conteneur — pour la VOIR et surtout la MESURER : contrastes calculés, WCAG par axe-core, Web Vitals, réseau, console, débordements ; et pilote un socket depuis la page, avec ses cookies et son origine.",
    "meta": "🟢 conforme v1.1.0 · 📎 1 réf" },
  { "icon": "🔧", "title": "devkit-bench", "href": "nodefony-devkit-bench.md",
    "desc": "Éprouve ce que le scaffold de Nodefony PRODUIT, par trois mesures — le code généré tient-il debout (compilation, tests, HTTP réel), un agent lâché dans une application fraîche découvre-t-il l'outillage au lieu de deviner, et le modèle de données d'un vrai logiciel libre est-il exprimable avec la…",
    "meta": "🟢 conforme v1.3.0 · ⚙️ 10 scripts · 📎 4 réf" },
  { "icon": "🔧", "title": "ticket", "href": "nodefony-ticket.md",
    "desc": "Écrit et organise les tickets GitHub du dépôt Nodefony — titre normé Conventional Commits et compréhensible sans connaître le dépôt, lexique des abréviations, corps en quatre blocs dont une preuve `fichier:ligne` et un critère de fin observable, parents et sous-tickets, champs du tableau de…",
    "meta": "🟢 conforme v1.7.0 · ⚙️ 10 scripts · 📎 4 réf" }
]
```

## Tableau récapitulatif

| Skill | Version | Corps | Réf. | Scripts | Conforme |
| --- | --- | ---: | ---: | ---: | :---: |
| [`nodefony-browser`](nodefony-browser.md) | 1.1.0 | 416 | 1 | 0 | ✅ |
| [`nodefony-check-externals`](nodefony-check-externals.md) | — | 116 | 0 | 0 | ✅ |
| [`nodefony-check-memory-health`](nodefony-check-memory-health.md) | — | 84 | 0 | 0 | ✅ |
| [`nodefony-create-frontend-module`](nodefony-create-frontend-module.md) | — | 250 | 1 | 0 | ✅ |
| [`nodefony-create-module`](nodefony-create-module.md) | — | 279 | 1 | 0 | ✅ |
| [`nodefony-debug`](nodefony-debug.md) | 1.1.0 | 255 | 0 | 0 | ✅ |
| [`nodefony-devkit-bench`](nodefony-devkit-bench.md) | 1.3.0 | 686 | 4 | 10 | ✅ |
| [`nodefony-documentation`](nodefony-documentation.md) | 3.0.0 | 469 | 2 | 7 | ✅ |
| [`nodefony-framework-dev`](nodefony-framework-dev.md) | 2.0.0 | 358 | 10 | 0 | ✅ |
| [`nodefony-frontend-dev`](nodefony-frontend-dev.md) | 1.0.0 | 114 | 6 | 0 | ✅ |
| [`nodefony-html-report`](nodefony-html-report.md) | — | 360 | 3 | 8 | ✅ |
| [`nodefony-inspect`](nodefony-inspect.md) | 1.0.0 | 259 | 0 | 0 | ✅ |
| [`nodefony-load-test`](nodefony-load-test.md) | — | 359 | 4 | 43 | ✅ |
| [`nodefony-migrate-schema`](nodefony-migrate-schema.md) | — | 15 | 0 | 0 | ✅ |
| [`nodefony-multipod-bench`](nodefony-multipod-bench.md) | — | 143 | 2 | 12 | ✅ |
| [`nodefony-release`](nodefony-release.md) | 2.0.0 | 247 | 0 | 1 | ✅ |
| [`nodefony-rfc`](nodefony-rfc.md) | 1.1.0 | 147 | 0 | 0 | ✅ |
| [`nodefony-roadmap`](nodefony-roadmap.md) | 2.0.0 | 117 | 0 | 0 | ✅ |
| [`nodefony-security-review`](nodefony-security-review.md) | — | 356 | 0 | 0 | ✅ |
| [`nodefony-session`](nodefony-session.md) | — | 556 | 2 | 2 | ✅ |
| [`nodefony-skill`](nodefony-skill.md) | 1.2.0 | 298 | 0 | 3 | ✅ |
| [`nodefony-start-server`](nodefony-start-server.md) | — | 270 | 0 | 2 | ✅ |
| [`nodefony-studio-dev`](nodefony-studio-dev.md) | 2.0.0 | 145 | 6 | 0 | ✅ |
| [`nodefony-tail-error-logs`](nodefony-tail-error-logs.md) | — | 84 | 0 | 0 | ✅ |
| [`nodefony-ticket`](nodefony-ticket.md) | 1.7.0 | 543 | 4 | 10 | ✅ |

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Outillage agents](../outillage-agents.md) · [Toute la documentation](../index.md)
- **Écrire un skill** : [`nodefony-skill`](nodefony-skill.md) — conventions, gabarit, barrière de conformité.
- **Le standard** : `name`, `description` ≤ 1024, champs autorisés, ressources en `references/`.
  Validateur officiel : `skills-ref validate ./<skill>`.
