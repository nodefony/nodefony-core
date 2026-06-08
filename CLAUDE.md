# CLAUDE.md — nodefony-core

---

Agis en tant que Lead Architect du framework agentique Nodefony.

# Instructions pour le mode Autonome

- Ne travaille que sur un SEUL module à la fois.
- Si une commande de test échoue plus de 3 fois d'affilée avec la même erreur, ARRÊTE-TOI et laisse une note dans `BUG_REPORT.md`.
- Interdiction de modifier les fichiers en dehors du scope du module assigné.
- Fais un commit Git local (`git commit -m "feat(auth): ..."`) dès qu'une sous-tâche est validée et passe les tests.

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
  # Gate mémoire SÉPARÉ de la non-régression (config dédiée vitest.load.config.ts).
  cd src/packages/@nodefony/http && npm run test:memory
  ```
  > **Séparation des suites (vitest)** : non-régression rapide = `npm run test:integration` (`vitest.integration.config.ts`, exclut `tests/load/**` + `memory.test.ts`). Suite lourde (charge, heap, leak, scopes DI) = `npm run test:load` (`vitest.load.config.ts` = `tests/load/**` + `memory.test.ts`). Gate mémoire seul = `npm run test:memory`. Lancer la suite `load` AVANT tout commit touchant Kernel / pipeline / cycle de vie / mémoire — pas à chaque non-régression.
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

> **Juste après un `/clear` : dire simplement « reprends »** → skill `nodefony-session` mode RESUME
> restitue la dernière session (décisions + prochaine étape) depuis `project_session_<date>_state.md`.
> **Avant de fermer : dire « fin de session »** → mode END (retex + écrit cette mémoire de reprise).
> Rien d'autre à mémoriser : le cycle reprise → travail → clôture tient dans un seul skill.

Avant de commencer une nouvelle phase / tâche :

1. **Lire `MIGRATION_STATUS.md`** — Roadmap priorisée P0→P14 + chemin critique. Vérifier dépendances de la tâche.
2. **Lancer les tests pour voir l'état RÉEL** (pas faire confiance au journal seul) :
   ```bash
   cd src/packages/@nodefony/http && npm run test:integration 2>&1 | grep -E "passing|failing"
   ```
   Le journal peut être périmé même de quelques jours.
3. **Vérifier les pièges connus** (mémoire IA `feedback_session_pitfalls.md`) :
   - Dist périmé après pull/merge → `npm run clean && npm run build`
   - `npx nodefony development &` meurt SIGHUP → utiliser le skill `nodefony-start-server`
   - Bun requis pour `@nodefony/llm/test`
4. **Lire le `CLAUDE.md` + `MEMORY.md`** du module ciblé (table d'index plus bas).
5. **Si fiche kit existante** (ex: `project_p1_1_kit.md` pour P1.1) → la lire AVANT toute exploration.
6. **`.ai/symbols.json`** est régénéré par hook pre-commit. Utiliser pour résoudre les relations cross-module sans grep tout le repo.

---

## 🧭 Hygiène de session (adoptée 2026-05-20 — APPLIQUER)

Règles convenues pour gagner en coût/qualité (cf mémoire IA `feedback_session_hygiene` + consolidation retex 2026-05-21) :

1. **1 feature = 1 session courte.** Proposer activement `/clear` entre features non liées et `/compact` quand ça s'allonge (ne pas attendre le quota). Tenir « une session = un module ».
2. **Mini-cahier des charges en amont** d'un gros écran/feature : lister (ou valider en 1 question) ce qui doit apparaître/se comporter AVANT de coder → 1 passe au lieu de N petits Edits. **S'applique AUSSI aux GROS artefacts non-écran** (> ~150 lignes, widget visuel, skill/doc/CLAUDE.md/README) : lister sections/panneaux/contrôles puis **figer la structure** AVANT d'écrire (éviter renumérotations `cf §N`). Vécu : `DebugBar.ts` 27→50 edits, `SKILL.md` 49 edits — improviser la structure coûte en allers-retours.
3. **Avant de dire « fait » :** après une modif **frontend** → annoncer la vérif (curl transform Vite) + demander un **hard-reload** (cache React) ; **lancer la suite de tests impactée** + **suspecter son propre diff** avant de qualifier un échec de « pré-existant ».
4. **Batcher les edits backend avant UN SEUL `rebuild + restart`** (coût #1 mesuré sur 8/8 retex : 10→23 restarts/session, souvent fusionnables). Regrouper TOUTES les modifs serveur d'une feature (controllers, services, config), PUIS un seul cycle `stop.sh → build → start.sh`. Ne PAS faire stop/build/start après chaque petit Edit. Les modifs **frontend** passent en **HMR Vite** → 0 restart. Réserver les restarts intermédiaires aux vrais points de mesure (diagnostic).
5. **Décision design/archi = décider + expliquer le POURQUOI**, pas d'`AskUserQuestion`. Le user (expert, auteur du framework) préfère que je tranche et justifie le choix technique (préférence vue 2× : QCM design rejetés). Réserver `AskUserQuestion` aux cas où la réponse change réellement l'action : install lourd/irréversible, ambiguïté de specs, choix produit non-déductible du code. Jamais pour un arbitrage technique que je peux trancher.

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

### Visibilité user pendant tâches longues

Pour les tâches qui enchaînent plus de 3 outils sans output user-visible (build, tests, refactor multi-fichiers) :

- **OBLIGATOIRE** : 1 phrase courte (< 8 mots) AVANT chaque groupe d'outils logique.
  _Exemples : "Check du watcher.", "Build vert, on commit.", "Bug ici, fix immédiat."_
- **INTERDIT** : silence complet pendant > 3 outils consécutifs.
- **INTERDIT** : pavé récapitulatif après chaque action.
- **Format** : état brut, pas "je vais X". Pas "voici Y". Juste "X fait." ou "Y trouvé.".

## 📚 Docs externes & roadmap — Skills load-on-demand

La doc externe (RFC, TS handbook, NestJS) et les phases futures (10/12/13/14) sont **déchargées dans des skills** déclenchés par mots-clés — gratuit en tokens tant qu'ils ne se déclenchent pas :

| Skill              | Quand l'utiliser                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `nodefony-rfc`     | RFC HTTP/HTTP2/WS/CORS/Cookies (IETF + W3C raw uniquement)                                  |
| `nodefony-ts-docs` | TS handbook, utility types, `@types/node` DefinitelyTyped                                   |
| `nodefony-nestjs`  | Inspiration architecture NestJS — déclencheur EXCLUSIF mot-clé "NestJS"                     |
| `nodefony-roadmap` | Phase 10 (Studio admin), 12 (IA agentic), 13 (Realtime/Redis/client), 14 (frontend builder) |

**Règle universelle** : interdiction de charger les sites HTML lourds (`nodejs.org`, `typescriptlang.org`, `docs.nestjs.com`, `tools.ietf.org`). Toujours via raw GitHub + proxy `https://r.jina.ai/`. Les skills contiennent les URLs canoniques + le pattern d'usage.

**Convention skills/commands (figée 2026-05-21)** : tous les skills sont préfixés `nodefony-` (namespace + auto-trigger) ; les slash-commands restent **courtes et non préfixées** (couche UX tapée qui délègue au skill — ex. `/start-server`, `/migration-audit`). Cycle de vie d'une session = **un seul skill `nodefony-session`** (modes : RESUME « reprends » après `/clear` / START `<module>` / END « fin de session » / CONSOLIDATE). La liste complète des skills est fournie par le harness — ne pas la dupliquer ici.

**Convention de route `/nodefony/*` réservée à Studio** : tout module exposant une API d'admin (stats, introspection) doit exposer `/nodefony/<module>/api/*` documenté dans son `MEMORY.md`. Concevoir en GraphQL/REST JSON — pas de couplage à la vue. (Détails complets : skill `nodefony-roadmap`.)

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

## Studio du framework

Nodefony est une **plateforme générique** pour construire :

1. Des applications web temps réel (HTTP + WS co-citoyens natifs)
2. Des agents IA métier (RAG, orchestration, sous-agents)

**Positionnement** : framework générique réutilisable — jamais de logique métier dans le core.
**Inspiration** : Symfony (DI, modules, kernel, Firewall Applicatif) + NestJS (decorators TS)
**Différenciateur** : HTTP et WebSocket dans le même contexte controller, nativement.

---

## 🛠 Commandes CLI par module

> Chaque module Nodefony peut enregistrer des commandes CLI via `module.addCommand(Ctor)`.
> Pattern legacy : `nodefony <command> [args]` (ex : `nodefony orm:migrate`, `nodefony users:add`).

**État actuel** : commandes implémentées (`Start/Dev/Build/Prod/Cluster/Install/Outdated`) mais **pas testées en intégration** — voir Phase 11 dans `MIGRATION_STATUS.md`. (`staging`/`preprod` retirée 2026-05-25 — alias mort de `production` ; l'env `staging` reste via `NODE_ENV`. `Pm2`/`Kill` retirées 2026-05-29 — C6 retrait PM2.)

**Règle** : tout module migré qui expose une commande CLI doit :

- Suivre le namespace `<module>:<action>` (ex : `security:user:add`, `orm:migrate`, `http:routes:list`)
- Documenter ses commandes dans son `MEMORY.md` (section "Commandes CLI")
- Avoir au moins un test d'intégration `npx nodefony <command>` (Phase 11)
- Exposer un endpoint API équivalent pour Studio (cohérence CLI ↔ Web admin)

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
    │       ├── orm-core/        ← abstraction IOrm / IRepository / IEntity
    │       ├── drizzle/         ← ORM SQL (référence, défaut)
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

### Deux patterns de `exports.types` (selon dépendance inter-modules)

- **`"./index.ts"` (source TS, anti-race)** — modules consommés EN SOURCE par un autre module : `http`, `framework`, `security`, `frontend`, `orm-core`, `user`. **Chaîne obligatoire** : security → user → orm-core → `nodefony` (core buildé en 1er → `dist` prêt). Casser un maillon (un `dist/types` au milieu) = TS2307 « Cannot find module » sur les consommateurs amont (build race). Cf [[feedback_turbo_cache_stale_logs]].
- **`"./dist/types/..."` (`.d.ts` généré, standard)** — modules NON consommés en source : `drizzle`, `mongoose`, `redis`, `llm`. `nodefony` (core) = isomorphe (`browser`/`import`).
- WIP P12 (pas encore câblés, pas de `rollup.config.ts`) : `agent`, `memory`, `rag`, `vector`. `studio` = `private: true` + `declaration: false` (types publics inutiles).

---

## Décisions techniques (finales)

**Bundler** : Rollup — `preserveModules: true`, génération `.d.ts` par module. Ne pas remplacer.

**Serveurs** : Node.js natif uniquement — `node:http`, `node:http2`, `ws`. Jamais `Bun.serve()`.

**Modules** : `module: ESNext` + `moduleResolution: Bundler` sur tous les tsconfigs. Zéro CommonJS.

**Exports** : named exports uniquement — `import { Nodefony } from "nodefony"`. Pas de default export.

**Process model en prod** : **cloud-native, pas PM2**. 1 process Node = 1 pod / container. Scaling horizontal géré par l'orchestrateur (k8s HPA, Docker Swarm, Nomad, Cloud Run, Fargate). Process supervision déléguée (k8s liveness/readiness, systemd, Docker restart-policy). Logs → stdout/stderr → collecteur centralisé. **PM2 RETIRÉ du framework (C6, 2026-05-29)** : `pm2Service`, commande `nodefony pm2:*`, commande `nodefony kill` (artefact PM2) et la dep npm `pm2` supprimés. Voir mémoire `project_pm2_deprecation.md`. Multi-process bare-metal/VPS = `nodefony cluster -w N` (cgroup-aware, sans PM2).

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

### Config de module — JAMAIS dérefencer le kernel à l'évaluation du module

Un `nodefony/config/config.ts` ne doit **jamais** appeler `Nodefony.getKernel()` (ou lire `.path`,
`.domain`…) **au top-level / à la création de l'objet config** : le kernel n'existe pas encore au
**moment de l'`import`** → le module **crashe à l'import** (`Cannot read properties of null`) et devient
**non importable / non testable** sans serveur (impossible de tester le module ou ses consommateurs).

```typescript
// ❌ INTERDIT — déréférence eager, crashe sans kernel
export default {
  connectors: {
    db: {
      filename: path.resolve((Nodefony.getKernel() as Kernel).path, "x.db"),
    },
  },
};

// ✅ LAZY (getter) — résolu à la LECTURE (au boot/merge, kernel présent). Runtime inchangé.
export default {
  connectors: {
    db: {
      get filename() {
        return path.resolve((Nodefony.getKernel() as Kernel).path, "x.db");
      },
    },
  },
};

// ✅ GUARDÉ — optional chaining + fallback (si pas de kernel → défaut)
const tmp = Nodefony.getKernel()?.tmpDir?.path ?? "/tmp";
```

> Vérifié 2026-05-22 : `drizzle`/module `test` portaient le bug (corrigés en getter) ;
> `http`/`mongoose` étaient déjà sûrs (guardés `?.`). Vaut pour TOUT accès kernel au top-level d'un
> fichier chargé à l'import du module (pas que `config.ts`).

### Configuration de l'APPLICATION — `defineConfig` (modèle figé 2026-06-05, Lot 5)

La config de l'app vit dans **`nodefony.config.ts`** (racine) + **`env.ts`** (racine). Plus de
dossier `nodefony/config/{config,app,servers,log,schema,modules}.ts` (supprimés). Le core porte les
**défauts** (`defaultAppConfig`) ; l'app n'écrit QUE ses écarts (deep-merge au boot).

```typescript
// nodefony.config.ts — UN fichier, l'orchestrateur
import { defineConfig, use } from "nodefony";
import type { env } from "./env";
export default defineConfig<typeof env>((ctx) => ({
  domain: ctx.isProd ? "0.0.0.0" : "127.0.0.1", // par-env via ctx (PAS de config.prod.ts)
  log: { debug: ctx.isProd ? [] : "*", driver: ctx.env.NF_LOG_DRIVER },
  modules: [
    // manifeste ordonné (remplace @modules)
    use(
      "@nodefony/http",
      { trustedHosts: ["localhost"] },
      { policy: "mandatory" },
    ), // config colocalisée
    "@nodefony/framework",
    { name: "@nodefony/test", policy: "dev" }, // gating policy/when
  ],
}));
```

```typescript
// env.ts — SEUL lecteur de process.env (catalogue typé + validé au boot)
import { defineEnv, envEnum, envString } from "nodefony";
export const env = defineEnv({
  NF_LOG_DRIVER: envEnum(["stdout", "file", "null"] as const, {
    default: "stdout",
  }),
  LOKI_URL: envString({ optional: true }),
});
```

`index.ts` racine : `import config from "./nodefony.config"` (passé à `super(...)`) + `export { env }`
(lu par le Kernel pour `ctx.env`). **Plus de `export { validateConfig }`** (la validation Zod est
intégrée au `resolve()` du descripteur, dans le core).

**Règles** :

- `ctx = { env, appEnv, runtimeEnv, isProd, isDev, isTest }`. Par-env = **fonction `(ctx) => …`**, jamais un fichier parallèle.
- `use(name, config, opts?)` colocalise la config d'un module avec son chargement (remplace les clés `module-<name>` à la racine). `opts = { policy, when }`.
- ⚠️ `as const` sur les valeurs d'`envEnum([...])` (sinon l'union littérale est élargie en `string` → erreur de type sur le champ ciblé).
- `enverrouiller le kernel au top-level` reste interdit ; avec `(ctx) => …` + getters lazy, le deref devient inutile (cf section ci-dessus).
- Cluster : `nodefony/config/cluster/cluster.config.ts` reste un fichier **séparé kernel-free** (le master le lit standalone AVANT boot) — ne PAS le mettre dans `nodefony.config.ts`.

**Convention module (OBLIGATOIRE pour le typage de `use()`)** : tout module qui expose une config doit
(1) publier son interface `IXConfig`, et (2) **augmenter le registre** `NodefonyModuleConfig` via
`declare module "nodefony"` (clé = nom du module → `IXConfig`) pour que `use("@nodefony/x", …)` propose
ses clés typées. Sans augmentation, `use()` accepte quand même la config (`Record<string, unknown>`) —
jamais bloquant, juste moins d'auto-complétion. Recette complète : [`docs/guides/configuration.md`](docs/guides/configuration.md).

---

## Workflow de session Claude Code

**DÉBUT :**

1. Ne dis rien.
2. **Local Context Only** : Identifier le module de travail.
3. **Priorité Lecture** : Lire le `CLAUDE.md` situé à la racine du module concerné AVANT toute analyse.
4. Lire `MIGRATION_STATUS.md` à la racine du projet pour la studio globale.
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

| Niveau                               | Emplacement                                                                     | Cible                     | Quand l'écrire                          |
| ------------------------------------ | ------------------------------------------------------------------------------- | ------------------------- | --------------------------------------- |
| TSDoc inline                         | sources `.ts`                                                                   | IDE + AST + IA            | en migrant le fichier                   |
| `<module>/docs/`                     | colocalisé au module (`src/nodefony/docs/`, `src/packages/@nodefony/<m>/docs/`) | humain + RAG + **Studio** | doc d'un concept/API d'un module précis |
| `docs/` (racine)                     | `docs/guides/` / `audits/` / `adr/`                                             | humain + RAG futur        | transverse multi-module                 |
| `CLAUDE.md` + `MEMORY.md` par module | racine du module                                                                | IA en session             | gotchas, mots-clés, décisions figées    |

> **Emplacement HYBRIDE (ADR-0001)** : la doc d'un module vit DANS le module (`<module>/docs/*.md`, frontmatter `module:`) et est surfacée dans **Studio** (`/nodefony/modules/{key}` onglet Docs ; core = carte `/nodefony/modules/core` ← `src/nodefony/docs/`). Le transverse reste sous `docs/` racine. Cf [`docs/adr/0001-docs-modules-emplacement-hybride.md`](docs/adr/0001-docs-modules-emplacement-hybride.md).

**Page de référence** : [`src/nodefony/docs/container.md`](src/nodefony/docs/container.md) montre le format attendu (frontmatter + sections + liens).

**Surfaçage Studio actif** (depuis 2026-05-20) : endpoints `/nodefony/kernel/api/module/{name}/{docs,docs/{slug},symbols}` (helper `framework/nodefony/src/docsReader.ts`) → onglets Docs (markdown + badges version/status/git) + API (`.ai/symbols.json`). Couvre core/http/framework/frontend/studio.

---

## 🗂 Graphe symbolique TS — `.ai/symbols.json` (v2.0 — map indexée + relations)

> Généré par `npm run generate-symbols` (script `scripts/generate-symbols.ts` + skill `nodefony-generate-symbols`). Régénéré automatiquement par le hook pre-commit.

Format v2.0 : `symbols` est une **map indexée par nom** (accès O(1)), `relations` contient les index inversés pré-calculés. Les agents IA doivent l'utiliser AVANT de grep le repo.

**Patterns Zero-Token Lookup** (`jq` sur `.ai/symbols.json`) : définition → `.symbols.X` · étend → `.relations.extendedBy.X` · implémente → `.relations.implementedBy.IX` · importe → `.relations.usedBy.X` · décoré → `.relations.decoratedBy.injectable` · description TSDoc → `.symbols.X.description`. **Homonymes** : 2e symbole sous `"Module:Name"`, lever via `.module`.

Cheat-sheet complet (filtres par module, etc.) : `.claude/skills/nodefony-generate-symbols/SKILL.md`.

---

## CLAUDE.md + MEMORY.md — index global des fichiers IA

Deux niveaux de docs IA — **lire AVANT de toucher au code du module** :

- **CLAUDE.md** par module : instructions, rôle, décisions figées, interdits. Lecture obligatoire en début de session.
- **MEMORY.md** par module : ultra-concis, mots-clés, gotchas, internals. Lecture pendant le travail.
- Complémentaires aux `README.md` (humains).

### Modules applicatifs (packages + modules)

| Module                | CLAUDE.md                                                                                  | MEMORY.md                                                                                  | Contenu                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `@nodefony/http`      | [`src/packages/@nodefony/http/CLAUDE.md`](src/packages/@nodefony/http/CLAUDE.md)           | [`src/packages/@nodefony/http/MEMORY.md`](src/packages/@nodefony/http/MEMORY.md)           | Serveurs, Contextes, WS, pipeline, requestId                               |
| `@nodefony/framework` | [`src/packages/@nodefony/framework/CLAUDE.md`](src/packages/@nodefony/framework/CLAUDE.md) | [`src/packages/@nodefony/framework/MEMORY.md`](src/packages/@nodefony/framework/MEMORY.md) | Router, Controller, Resolver, décorateurs                                  |
| `@nodefony/frontend`  | [`src/packages/@nodefony/frontend/CLAUDE.md`](src/packages/@nodefony/frontend/CLAUDE.md)   | [`src/packages/@nodefony/frontend/MEMORY.md`](src/packages/@nodefony/frontend/MEMORY.md)   | Vite builder, ViteSupervisor, FrontendService, HMR, multi-bundle           |
| `@nodefony/studio`    | [`src/packages/@nodefony/studio/CLAUDE.md`](src/packages/@nodefony/studio/CLAUDE.md)       | [`src/packages/@nodefony/studio/MEMORY.md`](src/packages/@nodefony/studio/MEMORY.md)       | Admin web Studio (P10), routes `/nodefony`, controller + frontend React 19 |
| Module `test`         | [`src/modules/test/CLAUDE.md`](src/modules/test/CLAUDE.md)                                 | [`src/modules/test/MEMORY.md`](src/modules/test/MEMORY.md)                                 | Routes d'intégration HTTP+WS, controllers, statics                         |

### Core (`@nodefony/core` workspace `src/nodefony`)

| Sous-module          | MEMORY.md                                                                                  | Contenu                                       |
| -------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------- |
| Workspace `nodefony` | [`src/nodefony/MEMORY.md`](src/nodefony/MEMORY.md)                                         | Service, Container, Event, Nodefony singleton |
| Syslog / Pdu         | [`src/nodefony/src/syslog/MEMORY.md`](src/nodefony/src/syslog/MEMORY.md)                   | Syslog, Pdu, CircularBuffer, transports       |
| Kernel / Module      | [`src/nodefony/src/kernel/MEMORY.md`](src/nodefony/src/kernel/MEMORY.md)                   | Kernel lifecycle, Module hooks, CliKernel     |
| Injector / DI        | [`src/nodefony/src/kernel/injector/MEMORY.md`](src/nodefony/src/kernel/injector/MEMORY.md) | @injectable, @inject, @Inject, scopes, algo   |
| Cli / Command        | [`src/nodefony/src/cli/MEMORY.md`](src/nodefony/src/cli/MEMORY.md)                         | Cli, Command, Commander, niceBytes, timers    |
| FileClass / Finder   | [`src/nodefony/src/finder/MEMORY.md`](src/nodefony/src/finder/MEMORY.md)                   | FileClass, File, FileResult, Result, Finder   |

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

Utiliser le skill **`nodefony-start-server`** (versionné dans `.claude/skills/nodefony-start-server/`) :

- Command (entrée tapée + args) : `/start-server [start|stop|restart|debug|build|help]` → délègue au skill
- CLI direct du skill : `/nodefony-start-server`
- Langage naturel (auto-trigger) : "lance le serveur", "démarre nodefony", "relance le serveur"

Le skill gère : kill ports 5151/5152, rebuild `src/modules/test`, spawn `detached` (évite SIGHUP), attente boot avec progression, health check, diagnostic crash. Détails complets (signaux d'alarme, parsing logs, symptômes 404, watch Rollup runtime piège) dans le `SKILL.md`.

> Toujours `development` — pas `dev`, pas `start`, pas `production` (`production` = foreground cloud-native, topologie via `--workers` ; plus aucune daemonisation PM2).

### Erreurs critiques import nodefony

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
