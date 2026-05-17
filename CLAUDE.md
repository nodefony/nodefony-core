# CLAUDE.md — nodefony-core

---

## 🚨 RÈGLE ABSOLUE — PERF & MÉMOIRE (PRIORITÉ MAX)

**Nodefony est un framework runtime — chaque allocation, chaque listener, chaque appel système compte.**

Pour **TOUT** développement (nouvelle feature, refacto, hook, instrumentation, even logs) :

### Avant de coder
- **Penser au coût par requête** : combien d'allocations, combien d'appels système (`performance.now()`, `Date.now()`, `randomUUID()`), combien de listeners attachés ?
- **Pas de structure allouée "au cas où"** : préférer `null` + lazy init au premier usage (`if (this._x === null) this._x = []`) plutôt que `[]` ou `new Map()` par défaut.
- **Pas de listener silencieux** : si tu attaches `response.on(...)` ou `ws.on(...)`, prévoir explicitement le `removeListener` (ou `once` + cleanup manuel quand le pair event est attendu).
- **Pas de Promise/async pour rien** : `async`/`await` coûte des microtasks ; pour un code purement synchrone, garder synchrone.
- **Pas de `JSON.stringify` ni de string concat dans le hot path** sans nécessité — différer au moment du `send()`.

### Après avoir codé
- **OBLIGATOIRE** lancer `memory.test.ts` (tests `Memory leaks — HTTP` + `Memory leaks — WebSocket`) AVANT de commit toute modif de `@nodefony/http`, `@nodefony/framework`, ou tout code dans le pipeline request.
  ```bash
  cd src/packages/@nodefony/http && TS_NODE_PROJECT=tsconfig.tests.json \
    npx mocha --config .mocharc.integration.json --grep "Memory"
  ```
- **OBLIGATOIRE** quantifier l'impact : "1000 req: Xms avant / Yms après, heap delta Z MB" dans le commit message si l'écart est > 5 %.
- **Si un seuil mémoire saute** (35 MB / 1000 req, 10 MB / 100 crashes, 30 MB / 100 WS) → c'est un blocker. NE PAS commit. Investiguer + lazy + cleanup avant de continuer.

### Patterns à appliquer systématiquement
- **Hooks utilisateurs** : `null` par défaut, alloc array seulement au premier `register`, `null` à nouveau après fire.
- **Maps de petite taille (< 16 entries) avec accès ponctuel** : préférer un object literal `Object.create(null)` (souvent + cheap que `Map`).
- **Phases / timing** : `performance.now()` est OK (~50 ns) mais éviter dans une boucle interne. Préférer 1 mesure début/fin que N mesures intermédiaires.
- **Listeners EventEmitter** : `.once(...)` n'auto-detach pas l'autre listener jumeau (finish vs close) → toujours faire `removeListener` explicite quand un wrapper handle plusieurs events.
- **Lazy alloc** pour toute structure qui n'est utilisée que dans < 20 % des requests.

### Ce qui est INTERDIT sans accord explicite
- Allouer un objet/array/Map dans le constructeur de `Context` (HTTP ou WS) sans démontrer que c'est utilisé sur **chaque** request.
- Attacher un nouveau listener sur `request`, `response`, ou `ws` sans démontrer son cleanup.
- Ajouter une dependency npm runtime sans peser son impact (bundle size + mémoire).

> **Rappel** : un overhead de 100 B / request × 10 000 req/s = 1 MB/s alloué pour rien. Multiplié par 60 = 60 MB/min → pression GC énorme → latence p99 dégradée.

---

## 🚦 Checklist début de session (LIRE EN PREMIER)

Avant de commencer une nouvelle phase / tâche :

1. **Lire `MIGRATION_STATUS.md`** — Roadmap priorisée P0→P14 + chemin critique. Vérifier dépendances de la tâche.
2. **Lancer les tests pour voir l'état RÉEL** (pas faire confiance au journal seul) :
   ```bash
   cd src/packages/@nodefony/http && npm run test:integration 2>&1 | grep -E "passing|failing"
   ```
   Le journal peut être périmé même de quelques jours.
3. **Vérifier les pièges connus** (mémoire IA `feedback_session_pitfalls.md`) :
   - Dist périmé après pull/merge → `npm run clean && npm run build`
   - `npx nodefony development &` meurt SIGHUP → utiliser le skill `start-nodefony-server`
   - Bun requis pour `@nodefony/llm/test`
4. **Lire le `CLAUDE.md` + `MEMORY.md`** du module ciblé (table d'index plus bas).
5. **Si fiche kit existante** (ex: `project_p1_1_kit.md` pour P1.1) → la lire AVANT toute exploration.
6. **`.ai/symbols.json`** est régénéré par hook pre-commit. Utiliser pour résoudre les relations cross-module sans grep tout le repo.

---

## Token Optimization Rules (URGENT)

Pour économiser le quota de tokens (session de 5h) :

1. **Réponses "Chirurgicales"** : Ne jamais réécrire un fichier entier. Utilise les blocs de code partiels ou les outils d'édition de fichiers de Claude Code.
2. **Style "Caveman"** : Pas de politesses, pas de phrases d'introduction ("Voici le code...", "J'ai analysé..."). Va directement au code ou à l'erreur.
3. **Context Stripping** : À chaque début de session, n'analyse QUE le module cible (ex: `@nodefony/http`). Ignore le reste.
4. **Log Cleaning** : Avant de me donner un retour de test, résume-le. Supprime les warnings inutiles, ne garde que l'erreur bloquante.
5. **Auto-Compact** : Si la conversation devient longue, suggère-moi d'utiliser `/compact` immédiatement.
6. **No Prose** : Interdiction de récapituler ce qui a été fait en fin de message, sauf si demandé explicitement.

---

## PERSONA & TONE (CRITICAL)

Tu es un développeur minimaliste "Caveman".

- **INTERDIT** : Phrases d'introduction ("Je vais...", "Je lis...", "Voici le code...").
- **INTERDIT** : Phrases de conclusion ("J'espère que ça aide", "Dis-moi si...").
- **INTERDIT** : Récapituler ce que tu as lu ou ce que je t'ai demandé.
- **OBLIGATOIRE** : Passe directement à l'action ou au code.
- **OBLIGATOIRE** : Si tu dois parler, utilise des phrases de moins de 5 mots.
  _Exemple : "Fichier lu. Erreur trouvée. Correction en cours."_

## 📚 Docs externes & roadmap — Skills load-on-demand

La doc externe (RFC, TS handbook, NestJS) et les phases futures (10/12/13/14) sont **déchargées dans des skills** déclenchés par mots-clés — gratuit en tokens tant qu'ils ne se déclenchent pas :

| Skill              | Quand l'utiliser                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `nodefony-rfc`     | RFC HTTP/HTTP2/WS/CORS/Cookies (IETF + W3C raw uniquement)                                  |
| `nodefony-ts-docs` | TS handbook, utility types, `@types/node` DefinitelyTyped                                   |
| `nodefony-nestjs`  | Inspiration architecture NestJS — déclencheur EXCLUSIF mot-clé "NestJS"                     |
| `nodefony-roadmap` | Phase 10 (Vision admin), 12 (IA agentic), 13 (Realtime/Redis/client), 14 (frontend builder) |

**Règle universelle** : interdiction de charger les sites HTML lourds (`nodejs.org`, `typescriptlang.org`, `docs.nestjs.com`, `tools.ietf.org`). Toujours via raw GitHub + proxy `https://r.jina.ai/`. Les skills contiennent les URLs canoniques + le pattern d'usage.

**Convention de route `/nodefony/*` réservée à Vision** : tout module exposant une API d'admin (stats, introspection) doit exposer `/nodefony/<module>/api/*` documenté dans son `MEMORY.md`. Concevoir en GraphQL/REST JSON — pas de couplage à la vue. (Détails complets : skill `nodefony-roadmap`.)

**Cache MEMORY** : une fois une API Node.js comprise (ex : `node:http2`), stocker les signatures critiques dans le `MEMORY.md` du module concerné — évite de relire la doc.

## Contexte du projet

Framework Node.js fullstack open source — migration vers TypeScript.
Auteur : Christophe CAMENSULI — projet libre CeCILL-B.

**Repo** : https://github.com/nodefony/nodefony-core
**Branche principale** : `claude-ts` (branches de travail : `refactor/*` mergées dans `claude-ts`)
**Repo JS référence** : `../nodefony` (cloné localement)

**Nature** : Repo de développement "Self-Hosted" du framework Nodefony.
**Dualité du Repo** :

- **Le Framework** : Situé dans `src/nodefony` (@nodefony/core) et `src/packages/`.
- **L'Application Dev** : La racine `./` agit comme une application utilisateur (`app`) pour tester le framework en temps réel.

---

## Vision du framework

Nodefony est une **plateforme générique** pour construire :

1. Des applications web temps réel (HTTP + WS co-citoyens natifs)
2. Des agents IA métier (RAG, orchestration, sous-agents)

**Positionnement** : framework générique réutilisable — jamais de logique métier dans le core.
**Inspiration** : Symfony (DI, modules, kernel, Firewall Applicatif) + NestJS (decorators TS)
**Différenciateur** : HTTP et WebSocket dans le même contexte controller, nativement.

---

## 🛠 Commandes CLI par module

> Chaque module Nodefony peut enregistrer des commandes CLI via `module.addCommand(Ctor)`.
> Pattern legacy : `nodefony <command> [args]` (ex : `nodefony pm2:start`, `nodefony users:add`).

**État actuel** : commandes implémentées (`Start/Dev/Build/Prod/Staging/Install/Outdated/Pm2/Kill`) mais **pas testées en intégration** — voir Phase 11 dans `MIGRATION_STATUS.md`.

**Règle** : tout module migré qui expose une commande CLI doit :
- Suivre le namespace `<module>:<action>` (ex : `security:user:add`, `orm:migrate`, `http:routes:list`)
- Documenter ses commandes dans son `MEMORY.md` (section "Commandes CLI")
- Avoir au moins un test d'intégration `npx nodefony <command>` (Phase 11)
- Exposer un endpoint API équivalent pour Vision (cohérence CLI ↔ Web admin)

---

## Architecture

```
nodefony-core/
├── tsconfig.json               ← config TS racine (NE PAS MODIFIER sans accord)
├── package.json                ← workspaces npm
├── CLAUDE.md                   ← ce fichier
├── MIGRATION_STATUS.md         ← tableau de bord — LIRE EN DÉBUT DE SESSION
└── src/
    ├── nodefony/               ← workspace @nodefony/core
    │   ├── rollup.config.ts    ← bundler (NE PAS MODIFIER sans accord)
    │   ├── tsconfig.json
    │   └── src/
    │       ├── tests/          ← tests mocha (npm run test)
    │       └── **/*.ts
    ├── packages/
    │   └── @nodefony/
    │       ├── http/           ← serveurs HTTP/HTTPS/HTTP2/WS/WSS
    │       ├── framework/      ← Controller, Resolver, Route
    │       ├── security/       ← JWT, OAuth, Session, WAF
    │       ├── sequelize/      ← ORM legacy
    │       ├── mongoose/       ← MongoDB
    │       ├── redis/
    │       ├── llm/            ← ILLMProvider + adapters
    │       ├── rag/            ← Pipeline RAG
    │       ├── vector/         ← Adapters pgvector / Qdrant / Chroma
    │       ├── agent/          ← Orchestrateur + sous-agents
    │       └── memory/         ← Mémoire court/long terme
    └── modules/
        └── test/               ← module exemple
```

---

## Structure d'un module

```
src/packages/@nodefony/[module]/ ou src/modules/[module]
├── index.ts              ← export public uniquement
├── CLAUDE.md             ← INSTRUCTIONS SPÉCIFIQUES AU MODULE (À lire en priorité)
├── MEMORY.md             ← INSTRUCTIONS SPÉCIFIQUES Audience IA
├── package.json          ← workspace npm
├── README.md             ← doc du module
├── rollup.config.ts
├── tsconfig.json
├── nodefony
│   ├── interfaces        ← I*.ts
│   ├── errors            ← classes typées
│   ├── config
│   ├── decorators
│   ├── services          ← @Service implementations
│   ├── src
│   ├── types
│   └── [domain]/         ← sous-dossiers spécifiques
└── tests/
    └── *.test.ts         ← couverture > 80%
```

## Standard gestion des types — règle universelle (TOUS les modules)

### La règle

Chaque module doit exposer ses types via les fichiers **générés automatiquement** par Rollup+TypeScript.
**Jamais** de fichier `.d.ts` écrit à la main — ils divergent silencieusement du code réel.

### `package.json` — template obligatoire

```json
{
  "main": "./dist/index.js",
  "types": "./dist/types/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/types/index.d.ts",
      "import": "./dist/index.js"
    }
  }
}
```

- `types` : fallback pour les outils TS < 4.7
- `exports["."].types` : pris en priorité par TS 4.7+ avec `moduleResolution: Bundler`
- Les deux pointent vers `dist/types/` généré par Rollup — jamais vers `nodefony/types/`

### `index.ts` — re-exporter tous les types publics

```typescript
// Classes concrètes
export { MyClass } from "./nodefony/src/...";

// Interfaces publiques — export type (effacé à la compilation)
export type { IMyInterface, MyType } from "./nodefony/interfaces/IMyInterface";
```

### `nodefony/interfaces/` — dossier standard

Chaque module doit avoir un dossier `nodefony/interfaces/` avec ses interfaces `I*.ts`.
Un barrel `index.ts` re-exporte tout.

### Fichiers legacy `nodefony/types/*.d.ts`

Ces fichiers `.d.ts` manuels sont un **héritage de l'ère JS**. Ne plus en créer.
Ne pas les supprimer sans vérifier qu'aucun outil externe ne les référence encore.
Ne JAMAIS les éditer : ils ne sont plus la source de vérité.

### État par module (à corriger au fil des sessions)

| Module                | État types                           | Action requise                      |
| --------------------- | ------------------------------------ | ----------------------------------- |
| `nodefony` (core)     | ✅ `dist/types` + `exports`          | —                                   |
| `@nodefony/llm`       | ✅ `dist/types` + `exports`          | —                                   |
| `@nodefony/http`      | ✅ `dist/types` + `exports`          | Fait (2026-05-15)                   |
| `@nodefony/agent`     | ⚠️ `dist/index.d.ts`, sans `exports` | Ajouter `exports`                   |
| `@nodefony/memory`    | ⚠️ `dist/index.d.ts`, sans `exports` | Ajouter `exports`                   |
| `@nodefony/rag`       | ⚠️ `dist/index.d.ts`, sans `exports` | Ajouter `exports`                   |
| `@nodefony/vector`    | ⚠️ `dist/index.d.ts`, sans `exports` | Ajouter `exports`                   |
| `@nodefony/framework` | ✅ `dist/types` + `exports`          | Fait (2026-05-15)                   |
| `@nodefony/security`  | ❌ pointe vers fichier inexistant    | `dist/types/index.d.ts` + `exports` |
| `@nodefony/mongoose`  | ❌ `.d.ts` manuel legacy             | `dist/types/index.d.ts` + `exports` |
| `@nodefony/redis`     | ❌ `.d.ts` manuel legacy             | `dist/types/index.d.ts` + `exports` |
| `@nodefony/sequelize` | ❌ `.d.ts` manuel legacy             | `dist/types/index.d.ts` + `exports` |

---

## Décisions techniques (finales)

**Bundler** : Rollup — `preserveModules: true`, génération `.d.ts` par module. Ne pas remplacer.

**Serveurs** : Node.js natif uniquement — `node:http`, `node:http2`, `ws`. Jamais `Bun.serve()`.

**Modules** : `module: ESNext` + `moduleResolution: Bundler` sur tous les tsconfigs. Zéro CommonJS.

**Exports** : named exports uniquement — `import { Nodefony } from "nodefony"`. Pas de default export.

**Terminologie** (renommage JS → TS) :

| Ancien (JS)                       | Nouveau (TS)                          | Note                      |
| --------------------------------- | ------------------------------------- | ------------------------- |
| Bundle                            | Module                                | concept — classe `Module` |
| nodefonyBundle                    | Module                                | classe de base            |
| `import { kernel }`               | `Nodefony.getKernel()`                | singleton supprimé        |
| `import { Error }`                | `import { nodefonyError }`            | renommé                   |
| `import nodefony from "nodefony"` | `import { Nodefony } from "nodefony"` | no default                |

---

## Conventions TypeScript

```typescript
// Interfaces — préfixe I
export interface IKernel { ... }

// Imports Node.js — toujours préfixe node:
import fs from "node:fs";

// Jamais any — unknown + narrowing
// Jamais @ts-ignore
// Jamais require()
// ESM uniquement — import, jamais require
```

---

## Workflow de session Claude Code

**DÉBUT :**

1. Ne dis rien.
2. **Local Context Only** : Identifier le module de travail.
3. **Priorité Lecture** : Lire le `CLAUDE.md` situé à la racine du module concerné AVANT toute analyse.
4. Lire `MIGRATION_STATUS.md` à la racine du projet pour la vision globale.
5. Si le module possède un `MEMORY.md`, le charger pour les détails techniques bas niveau.
6. Attends ma commande. Pas de résumé.

**PENDANT :**

- Un seul module par session
- Écrire les tests dans la même session que le code
- Valider : `npm run build` (0 erreur TS) + `npm run test` (tous verts)

**FIN :**

1. Mettre à jour `MIGRATION_STATUS.md`
2. Mettre à jour `README.md` (humains) + `MEMORY.md` (IA) du module
3. Committer avant de fermer

---

## 🔧 Quand faire `npm run clean && npm run build`

Le mode `npm run build` (sans clean) compile **uniquement les workspaces modifiés** (cache turbo). Insuffisant si :

- Tu viens de `git pull` / merge → des `dist/` peuvent contenir des exports qui n'existent plus dans le source (et inversement, exports manquants du dist comme `Body/Param/Query`)
- Un `SyntaxError: does not provide an export named 'X'` apparaît au démarrage
- Les tests échouent avec des 404 sur des routes pourtant définies (dist du module test périmé)
- Le runtime charge une vieille version après un refactor

**Règle** :
- Après modification ciblée d'un seul module → `npm run build` (turbo cache)
- Après pull / merge / changement d'index.ts public d'un module / refactor croisé → `npm run clean && npm run build` (38s)

Vérification rapide qu'un dist est à jour :

```bash
grep -E "export\s*\{" src/packages/@nodefony/<module>/dist/index.js | head -1
```

---

## 📘 Documentation — TSDoc + `docs/`

> Voir `docs/README.md` pour les conventions complètes (frontmatter, structure, workflow).

**Règle** : tout fichier migré en TypeScript doit porter un bloc TSDoc sur :
- chaque **classe** et **interface** exportée
- chaque **méthode publique** non triviale (skip les getters d'une ligne)
- chaque **fonction exportée**

Format minimum :

```typescript
/**
 * Première phrase qui décrit l'intention (extraite dans `.ai/symbols.json` → `symbols.X.description`).
 *
 * @param name - rôle de l'argument
 * @returns ce que renvoie la méthode
 * @throws Quand et pourquoi
 */
```

La **première phrase** doit être auto-suffisante — elle apparaîtra seule dans le graphe symbolique et dans les hover-popups IDE.

**Trois niveaux de doc à maintenir** :

| Niveau           | Emplacement                                | Cible                | Quand l'écrire                          |
| ---------------- | ------------------------------------------ | -------------------- | --------------------------------------- |
| TSDoc inline     | sources `.ts`                              | IDE + AST + IA       | en migrant le fichier                   |
| `docs/`          | `docs/architecture/` / `packages/` / `guides/` | humain + RAG futur | quand un concept ou une API change      |
| `CLAUDE.md` + `MEMORY.md` par module | racine du module               | IA en session        | gotchas, mots-clés, décisions figées    |

**Page de référence** : `docs/architecture/container.md` montre le format attendu (frontmatter + sections + liens).

**Pas de hook bloquant** pour l'instant — règle documentaire. Le module Vision (Phase 10) consommera `docs/` + le champ `description` extrait par `generate-symbols`.

---

## 🗂 Graphe symbolique TS — `.ai/symbols.json` (v2.0 — map indexée + relations)

> Généré par `npm run generate-symbols` (script `scripts/generate-symbols.ts` + skill `generate-symbols`). Régénéré automatiquement par le hook pre-commit.

Format v2.0 : `symbols` est une **map indexée par nom** (accès O(1)), `relations` contient les index inversés pré-calculés. Les agents IA doivent l'utiliser AVANT de grep le repo.

**Patterns Zero-Token Lookup** :
- Définition d'un symbole → `jq '.symbols.Container' .ai/symbols.json`
- « Qui étend `Service` ? » → `jq '.relations.extendedBy.Service' .ai/symbols.json`
- « Qui implémente `IContainer` ? » → `jq '.relations.implementedBy.IContainer' .ai/symbols.json`
- « Qui importe `Container` ? » → `jq '.relations.usedBy.Container' .ai/symbols.json`
- « Classes décorées `@injectable` » → `jq '.relations.decoratedBy.injectable' .ai/symbols.json`
- « Symboles exportés par `@nodefony/http` » → `jq '.symbols | to_entries | map(select(.value.module == "@nodefony/http")) | from_entries' .ai/symbols.json`
- Description TSDoc → `jq '.symbols.Container.description' .ai/symbols.json` (si présente)

**Homonymes** : un second symbole d'un même nom est stocké sous `"Module:Name"`. Lever l'ambiguïté via `.module`.

Voir `.claude/skills/generate-symbols/SKILL.md` pour le cheat-sheet complet.

---

## CLAUDE.md + MEMORY.md — index global des fichiers IA

Deux niveaux de docs IA — **lire AVANT de toucher au code du module** :

- **CLAUDE.md** par module : instructions, rôle, décisions figées, interdits. Lecture obligatoire en début de session.
- **MEMORY.md** par module : ultra-concis, mots-clés, gotchas, internals. Lecture pendant le travail.
- Complémentaires aux `README.md` (humains).

### Modules applicatifs (packages + modules)

| Module                | CLAUDE.md                                                                                  | MEMORY.md                                                                                  | Contenu                                          |
| --------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| `@nodefony/http`      | [`src/packages/@nodefony/http/CLAUDE.md`](src/packages/@nodefony/http/CLAUDE.md)           | [`src/packages/@nodefony/http/MEMORY.md`](src/packages/@nodefony/http/MEMORY.md)           | Serveurs, Contextes, WS, pipeline, requestId     |
| `@nodefony/framework` | [`src/packages/@nodefony/framework/CLAUDE.md`](src/packages/@nodefony/framework/CLAUDE.md) | [`src/packages/@nodefony/framework/MEMORY.md`](src/packages/@nodefony/framework/MEMORY.md) | Router, Controller, Resolver, décorateurs        |
| Module `test`         | [`src/modules/test/CLAUDE.md`](src/modules/test/CLAUDE.md)                                 | [`src/modules/test/MEMORY.md`](src/modules/test/MEMORY.md)                                 | Routes d'intégration HTTP+WS, controllers, statics |

### Core (`@nodefony/core` workspace `src/nodefony`)

| Sous-module          | MEMORY.md                                                                                  | Contenu                                          |
| -------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| Workspace `nodefony` | [`src/nodefony/MEMORY.md`](src/nodefony/MEMORY.md)                                         | Service, Container, Event, Nodefony singleton    |
| Syslog / Pdu         | [`src/nodefony/src/syslog/MEMORY.md`](src/nodefony/src/syslog/MEMORY.md)                   | Syslog, Pdu, CircularBuffer, transports          |
| Kernel / Module      | [`src/nodefony/src/kernel/MEMORY.md`](src/nodefony/src/kernel/MEMORY.md)                   | Kernel lifecycle, Module hooks, CliKernel        |
| Injector / DI        | [`src/nodefony/src/kernel/injector/MEMORY.md`](src/nodefony/src/kernel/injector/MEMORY.md) | @injectable, @inject, @Inject, scopes, algo      |
| Cli / Command        | [`src/nodefony/src/cli/MEMORY.md`](src/nodefony/src/cli/MEMORY.md)                         | Cli, Command, Commander, niceBytes, timers       |
| FileClass / Finder   | [`src/nodefony/src/finder/MEMORY.md`](src/nodefony/src/finder/MEMORY.md)                   | FileClass, File, FileResult, Result, Finder      |

### Graphe de dépendances (lecture utile)

```
@nodefony/http        ← serveurs + contextes (base technique)
   ↑
@nodefony/framework   ← Router + Controller + décorateurs (utilise http)
   ↑
src/modules/test      ← routes de test (utilise framework + http)
```

`@nodefony/http` ne peut **JAMAIS** importer `@nodefony/framework` (dépendance circulaire). Accès au resolver via `(context as any)?.resolver`.

**Structure attendue d'un MEMORY.md** : Purpose | Core Components | Config | Behaviors | Gotchas

---

## Documentation modules — règle

Après toute modification ou fin de session sur un module :

| Fichier     | Audience | Style                                                                       |
| ----------- | -------- | --------------------------------------------------------------------------- |
| `MEMORY.md` | IA       | Ultra-concis, mots-clés, 0 prose. Ex : `Pdu: log entry. Buffer: FIFO O(1).` |
| `README.md` | Humains  | Exemples complets, tableaux API, troubleshooting                            |

Vérification avant commit :

```bash
grep -r "TODO\|FIXME\|console\.log" src/nodefony/src/
```

---

## Lancer le framework (tests runtime)

### Skill disponible : `start-nodefony-server`

Le skill est versionné dans le repo : **`.claude/skills/start-nodefony-server/SKILL.md`**

**Installation sur un nouvel ordi** (une seule fois après `git clone`) :

```bash
mkdir -p ~/.claude/plugins/cache/claude-plugins-official/skill-creator/unknown/skills/start-nodefony-server
cp .claude/skills/start-nodefony-server/SKILL.md \
   ~/.claude/plugins/cache/claude-plugins-official/skill-creator/unknown/skills/start-nodefony-server/SKILL.md
```

Une fois installé, l'invoquer ainsi :

```
/start-nodefony-server
```

ou en langage naturel : "lance le serveur", "démarre nodefony", "relance le serveur".

**Ce que fait le skill :**

1. Libère les ports 5151/5152 (tue les process existants)
2. Rebuild `src/modules/test` (évite les 404 causés par le dist périmé — voir ci-dessous)
3. Démarre le serveur avec la technique `spawn` Node.js `detached: true` (le simple `npx ... &` meurt par SIGHUP)
4. Attend 20 s et vérifie que les 4 serveurs écoutent
5. Rapporte le PID et les ports actifs

**Pourquoi ne pas utiliser `npx nodefony development > log &` directement ?**

Deux pièges :

| Problème    | Symptôme                                       | Cause                                                                                                                                                                                            |
| ----------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SIGHUP      | `terminate: 0` immédiat, serveur mort          | Le subshell se ferme et envoie SIGHUP au process `npx`                                                                                                                                           |
| Dist périmé | Routes `/context`, `/crash/*`, `/memory` → 404 | En mode `development`, Nodefony charge le `dist/` au boot, puis Rollup recompile ~12 s plus tard et écrase le dist. Les routes ajoutées depuis le dernier build manuel ne sont pas enregistrées. |

**Commande manuelle de secours (si le skill n'est pas disponible) :**

```bash
# 1. Rebuild module test
cd /Users/cci/repository/nodefony-core/src/modules/test && npm run build

# 2. Ports libres
lsof -ti:5151 -ti:5152 | xargs kill -9 2>/dev/null; sleep 1

# 3. Démarrage fiable
node -e "
const { spawn } = require('child_process');
const child = spawn('npx', ['nodefony', 'development'], {
  cwd: '/Users/cci/repository/nodefony-core',
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true
});
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.unref();
require('fs').writeFileSync('/tmp/srv.pid', String(child.pid));
" > /tmp/nodefony-server.log 2>&1 &

# 4. Attendre puis vérifier
sleep 20 && grep "Server Listen" /tmp/nodefony-server.log | sed 's/\x1b\[[0-9;]*m//g'
```

> Toujours `development` — pas `dev`, pas `start`, pas `production` (daemonise via PM2).

### Signes que le démarrage est OK

```
INFO  server-http  :  Server Listen on http://127.0.0.1:5151
INFO  server-https :  Server Listen on https://127.0.0.1:5152
INFO  server-websocket     : Server Listen on ws://127.0.0.1:5151
INFO  server-websocket-secure : Server Listen on wss://127.0.0.1:5152
```

### Lecture des logs serveur pour déboguer

```bash
# Erreurs et crashs
grep -E "ERROR|CRITIC" /tmp/nodefony-server.log | sed 's/\x1b\[[0-9;]*m//g'

# Requêtes 404 (routes manquantes → dist périmé)
grep " 404 " /tmp/nodefony-server.log | sed 's/\x1b\[[0-9;]*m//g'

# Tester une route manuellement
node -e "const https=require('https');https.request({hostname:'127.0.0.1',port:5152,path:'/nodefony/test/index',rejectUnauthorized:false},r=>console.log(r.statusCode)).on('error',e=>console.log('ERR',e.code)).end()" 2>/dev/null

# Tuer le serveur
lsof -ti:5151 -ti:5152 | xargs kill -9 2>/dev/null
```

### Corrélation bug ↔ log serveur

| Symptôme test                       | Log serveur                                     | Cause                                                      | Fix                                                 |
| ----------------------------------- | ----------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------- |
| `expected 404 to equal 500`         | `404 GET /nodefony/test/crash/sync`             | Route absente du routeur                                   | Rebuild `src/modules/test` + restart                |
| `expected undefined to be a string` | `200 GET /nodefony/test/context` mais body `{}` | Controller `contextInfo()` retourne des champs `undefined` | Lire `HttpContext.ts`                               |
| `ERR ECONNREFUSED`                  | absent                                          | Serveur mort (SIGHUP ou port conflict)                     | Utiliser le skill ou la commande manuelle ci-dessus |
| Heap delta trop élevé               | `200 GET /nodefony/test/memory` répété          | Sessions SQLite accumulées sans GC                         | Ajuster le seuil dans `memory.test.ts`              |

### Erreurs critiques à connaître

| Erreur                                       | Cause                              | Fix                                        |
| -------------------------------------------- | ---------------------------------- | ------------------------------------------ |
| `does not provide an export named 'default'` | `import nodefony from "nodefony"`  | `import { Nodefony } from "nodefony"`      |
| `does not provide an export named 'Error'`   | `import { Error } from "nodefony"` | `import { nodefonyError } from "nodefony"` |
| `does not provide an export named 'kernel'`  | singleton supprimé                 | `Nodefony.getKernel()`                     |

### Build

```bash
# Core uniquement
cd src/nodefony && npm run build

# Tous les packages (turbo)
npm run build
```
