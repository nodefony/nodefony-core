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

## 📚 OPTIMIZED DOCUMENTATION ACCESS

- **Node.js Docs (Priority)** : Ne jamais naviguer sur nodejs.org directement.
- **Method** : Utiliser systématiquement un proxy Markdown (ex: `https://r.jina.ai/`) pour lire la doc technique.
- **Token Saving** : Une fois une API Node.js comprise (ex: `node:http2`), stocke les signatures de fonctions critiques dans le `MEMORY.md` du module pour ne plus avoir à relire la doc officielle.
- **No Hallucination** : Si un doute subsiste sur une version de Node.js (migration vers v20+), vérifie via le proxy Markdown avant de coder.

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

## 📘 TS OFFICIAL DOCS & TYPES (CDN PROXIES)

Si tu as un doute sur une fonctionnalité de typage avancée (Utility Types, Mapped Types, Generics), utilise exclusivement ces sources épurées via `fetch` ou `curl` :

### 1. Les Types Utilitaires Officiels (Utility Types)

Pour voir comment TypeScript type nativement `Pick`, `Omit`, `ReturnType`, ou `Parameters` :

- **URL Raw** : `https://r.jina.ai/https://raw.githubusercontent.com/microsoft/TypeScript/main/src/lib/es5.d.ts`
  _Instruction : Ne lis pas tout le fichier, fais un grep ou cherche la définition précise._

### 2. Guide des Bonnes Pratiques de Typage (TS Handbook)

Pour les règles de design de typage (Overloads, Callbacks, Unsound Types) :

- **Design Guidelines** : `https://r.jina.ai/https://raw.githubusercontent.com/microsoft/TypeScript-Website/v2/packages/documentation/copy/en/declaration-files/Do-s-and-Don-ts.md`
- **Midi-Cheat-Sheet (Interfaces vs Types)** : `https://r.jina.ai/https://raw.githubusercontent.com/microsoft/TypeScript-Website/v2/packages/documentation/copy/en/handbook/2/Everyday-Types.md`

### 3. Typages TS pour Node.js (@types/node officiel)

Pour vérifier un type natif de Node.js v20+ ou une interface globale (ex: `NodeJS.Timeout`) :

- **Core HTTP Types** : `https://r.jina.ai/https://raw.githubusercontent.com/DefinitelyTyped/DefinitelyTyped/master/types/node/http.d.ts`
- **Global / Process Types** : `https://r.jina.ai/https://raw.githubusercontent.com/DefinitelyTyped/DefinitelyTyped/master/types/node/globals.d.ts`

---

## ⚡ RÈGLE CAVEMAN POUR LA DOC TS

- **Interdiction** de charger les pages du site `typescriptlang.org` (trop lourdes, perte de tokens).
- **Raccourci** : Si je te demande "Comment typer X en TS ?", utilise le proxy `https://r.jina.ai/` devant l'URL GitHub Raw appropriée.
- **Zéro Bla-bla** : Tu extrais la structure du type officiel, tu l'adaptes à Nodefony, et tu l'intègres sans faire de rapport de lecture.

## 🦅 NESTJS ARCHITECTURAL INSPIRATION (LOW-TOKEN)

- **⚠️ TRIGGER CONDITION** : Ne lis ces ressources NestJS ET n'applique cette inspiration QUE si je te le demande explicitement par le mot-clé "NestJS". Sinon, ignore totalement cette section.

Pour calquer l'architecture de Nodefony sur les concepts de NestJS (Decorators, Controllers, Modules, DI) sans gaspiller de tokens, utilise exclusivement le repository officiel de la documentation NestJS au format Raw Markdown :

### 1. Les Contrôleurs & Gestion HTTP/WS (Controllers)

Pour comprendre comment NestJS lie les décorateurs aux routes et gère le cycle de vie des requêtes :

- **URL Raw** : `https://r.jina.ai/https://raw.githubusercontent.com/nestjs/docs.nestjs.com/master/content/controllers.md`

### 2. L'Injection de Dépendances (Providers & Components)

Pour calquer le système `@Service` / `@Inject` de Nodefony sur les Providers de NestJS :

- **URL Raw** : `https://r.jina.ai/https://raw.githubusercontent.com/nestjs/docs.nestjs.com/master/content/providers.md`

### 3. L'Encapsulation par Module (Modules)

Pour structurer les sous-dossiers de `src/packages/@nodefony/` comme les modules NestJS :

- **URL Raw** : `https://r.jina.ai/https://raw.githubusercontent.com/nestjs/docs.nestjs.com/master/content/modules.md`

### 4. Les Gardes & Sécurité (Guards / WAF)

Source d'inspiration directe pour migrer `@nodefony/security` (Firewall) :

- **URL Raw** : `https://r.jina.ai/https://raw.githubusercontent.com/nestjs/docs.nestjs.com/master/content/guards.md`

---

## ⚡ RÈGLE CAVEMAN POUR L'INSPIRATION NESTJS

- **Interdiction** d'aller sur `docs.nestjs.com` (le site plante Claude Code avec le JS lourd et consomme trop).
- **Rôle de l'IA** : Quand je dis "Inspire-toi de NestJS pour le décorateur X", tu vas lire le `.md` brut correspondant, tu analyses la syntaxe TypeScript (Metadata, Reflect), et tu l'adaptes au Kernel de Nodefony.
- **Zéro Blabla** : N'écris pas "NestJS fait comme ceci...". Écris directement le code du décorateur TypeScript adapté à Nodefony.

## 🦅 NESTJS ARCHITECTURAL INSPIRATION (LOW-TOKEN)

- **⚠️ TRIGGER CONDITION** : Ne lis ces ressources NestJS ET n'applique cette inspiration QUE si je te le demande explicitement par le mot-clé "NestJS". Sinon, ignore totalement cette section.

---

## 🌐 RFC & W3C STANDARDS (LOW-TOKEN CORES)

Pour valider la conformité HTTP, HTTP2, et WebSockets du framework face aux normes officielles, utilise exclusivement ces sources au format texte brut (TXT) via `fetch` ou `curl` :

### 1. HTTP/1.1 & Sémantique (RFC 9110 - Remplace la 7231)

Source absolue pour les status codes (200, 404, 500), les headers, et les méthodes (GET, POST) :

- **URL Raw TXT** : `https://www.ietf.org/rfc/rfc9110.txt`
  _Instruction : Utilise un `grep` ou cherche le mot-clé exact (ex: "401 Unauthorized") pour ne pas lire les 200 pages._

### 2. HTTP/2 (RFC 9113 - Remplace la 7540)

Indispensable pour le multiplexage, la gestion des streams, et les pseudo-headers (`:status`, `:method`) dans `@nodefony/http` :

- **URL Raw TXT** : `https://www.ietf.org/rfc/rfc9113.txt`

### 3. WebSockets (RFC 6455)

La bible pour le handshake HTTP, le masquage des frames et la fermeture des connexions WS :

- **URL Raw TXT** : `https://www.ietf.org/rfc/rfc6455.txt`

### 4. Spécifications WAF / CORS / Cookies (W3C & IETF)

Pour le Firewall Applicatif (`@nodefony/security`) :

- **CORS (Fetch Standard W3C)** : `https://r.jina.ai/https://fetch.spec.whatwg.org/`
- **Cookies & SameSite (RFC 6265bis)** : `https://www.ietf.org/rfc/rfc6265.txt`

---

## ⚡ RÈGLE CAVEMAN POUR LES RFC

- **Interdiction** d'utiliser les versions HTML complexes de `tools.ietf.org` ou `w3c.org`. Les fichiers `.txt` officiels de l'IETF sont parfaits : 0 token gaspillé en structure de page.
- **Zéro Prose** : Si je te dis "Rends le Header conforme à la RFC 9110", trouve la section de la RFC, applique la syntaxe exacte dans le code (ex: casse des headers, séparateurs `\r\n`), et valide sans faire de rapport historique.

## Vision du framework

Nodefony est une **plateforme générique** pour construire :

1. Des applications web temps réel (HTTP + WS co-citoyens natifs)
2. Des agents IA métier (RAG, orchestration, sous-agents)

**Positionnement** : framework générique réutilisable — jamais de logique métier dans le core.
**Inspiration** : Symfony (DI, modules, kernel, Firewall Applicatif) + NestJS (decorators TS)
**Différenciateur** : HTTP et WebSocket dans le même contexte controller, nativement.

---

## 🎯 Module `@nodefony/vision` (futur — successeur de `monitoring-bundle`)

> Application web d'administration du framework et des apps qui tournent dessus.
> Remplace le `monitoring-bundle` Vue 2 legacy (`/Users/cci/repository/nodefony/src/nodefony/bundles/monitoring-bundle/`).

**Périmètre** : dashboard (bundles, databases, firewall, logs, migrate, npm, pm2, profiling, router, service, sessions, users) — voir vues legacy comme inspiration de scope, pas de tech.

**🔒 Convention de route RÉSERVÉE — applicable dès maintenant** :

- Le préfixe `/nodefony` est **réservé à Vision** dans toutes les apps Nodefony en production.
- Les modules **internes** (`@nodefony/http`, `@nodefony/framework`, `@nodefony/security`, ORM, etc.) qui exposent des routes d'admin doivent les exposer sous `/nodefony/<module>/...`.
- Les apps utilisateur (consommateurs du framework) doivent éviter `/nodefony/*` pour leurs propres routes.
- Le module `test` actuel utilise `/nodefony/test/*` — c'est cohérent (route de test interne).

**Conséquence pour chaque module migré** :
- Si le module expose une API d'introspection/admin (ex : `@nodefony/http` → stats serveurs, `@nodefony/framework` → liste routes, `@nodefony/security` → users connectés, `@nodefony/orm-*` → état connexions DB), **prévoir un controller `/nodefony/<module>/api/*` documenté qui sera consommé par Vision**.
- Concevoir les API comme **GraphQL ou REST JSON** — pas de couplage à la vue.
- Documenter chaque endpoint admin dans le `MEMORY.md` du module — Vision les consommera.

**Stack cible Vision** (à figer en début de Phase 10) :
- Frontend : Vue 3 + Vite + TS (cohérence avec passé) ou React 19 — décision en début de Phase 10
- Backend : `@nodefony/framework` controllers + GraphQL pour requêtes complexes + REST pour mutations simples
- Auth : `@nodefony/security` factory dédiée admin (rôle `ROLE_NODEFONY_ADMIN`)

**Tracking** : voir Phase 10 dans `MIGRATION_STATUS.md`.

---

## 🎨 Phase 14 — `@nodefony/frontend` (builder Vue/React/Svelte intégré)

> **Mécanique legacy à reproduire en moderne** : chaque bundle pouvait déclarer `type: "react" | "vue"` et le framework transpilait son frontend automatiquement (`webpackService.js` 631 L + `cli/builder/{react,vue}/` 634 L).
> **Refonte 2026** : Vite par défaut (ESM natif, HMR ultra-rapide), Webpack uniquement sur demande legacy.

**Conventions module avec frontend** (dès qu'un module a un `frontend/`) :

```typescript
// nodefony/config/config.ts
export default {
  frontend: {
    type: "vue3",              // ou "react19", "svelte5", "solid"
    entry: "./frontend/src/main.ts",
    outDir: "./public/dist",
    integrate: true            // true = middleware HMR dans @nodefony/http | false = proxy Vite externe
  }
}
```

**Lifecycle** :
- **Dev** : kernel boot → `@nodefony/frontend` lit `module.options.frontend` → ViteBuilder middleware injecté dans `@nodefony/http` → HMR live via WS natif.
- **Prod** : `npx nodefony build` → assets hashed dans `dist/public/<module-name>/` → `@nodefony/http` static.

**Règle dure** : `@nodefony/frontend` ≠ `@nodefony/client` — ne pas confondre.

| Module                | Rôle                                                                              |
| --------------------- | --------------------------------------------------------------------------------- |
| `@nodefony/frontend`  | **Builder** : transpile/bundle les frontends des modules (Vue/React/Svelte)       |
| `@nodefony/client`    | **Lib JS bas niveau** : HTTP/WS/auth/streaming clients, importée DANS le code UI  |

Vision = consommateur des deux : `@nodefony/frontend` (Vite + Vue 3) pour bundler son frontend Vue, qui importe `@nodefony/client` pour les appels backend.

Voir Phase 14 dans `MIGRATION_STATUS.md`. Bloque P10.7 (Vision frontend).

---

## 🛰 Phase 13 — Realtime + Redis cluster + Client navigateur

> 3 modules à garder en tête pendant la migration framework — interconnectés avec d'autres phases.

| Module                  | Rôle                                                            | Bloque             | Réf JS legacy                                  |
| ----------------------- | --------------------------------------------------------------- | ------------------ | ---------------------------------------------- |
| `@nodefony/redis`       | Cluster + pub/sub + storage (cache, session, lock distribué)    | P5.12 + apps prod  | `bundles/redis-bundle/` (166 L)                |
| `@nodefony/client`      | Lib navigateur — HTTP/WS/auth/streaming LLM côté browser        | **P10.7 Vision**   | N/A — à créer                                  |
| `@nodefony/realtime`    | Serveurs TCP/UDP/Unix sockets (IoT, IPC, protos binaires)       | indépendant        | `bundles/realtime-bundle/` (689 L + sockets)   |

**Règles transverses à appliquer pendant les migrations** :

- **WS reste dans `@nodefony/http`** — `realtime` complète avec TCP/UDP/Unix, pas WS.
- **Sessions prod** : `RedisSessionStorage` (P5.12) dépend de `@nodefony/redis` refactor (P13.2). Si on cible un cluster Nodefony multi-instance, P13.2 est non-négociable.
- **Vision frontend** consomme `@nodefony/client` — donc `client` doit exposer : WS reconnect auto, fetch auth/CSRF, AsyncIterable streaming LLM, AuthClient (login/refresh).
- **`@nodefony/client` est bas niveau** — pas de Vue/React inclus, utilisable depuis n'importe quel framework UI.
- **TypeScript shared types** : créer `@nodefony/contracts` (micro-package types-only) si nécessaire pour éviter cycles client ↔ server.
- **Pub/Sub Redis** : critique pour cluster — WS broadcast scalable nécessite pub/sub (1 instance reçoit → broadcast à toutes les instances → chacune forward à ses WS clients).

Voir Phase 13 dans `MIGRATION_STATUS.md` pour le détail.

---

## 🧠 Vision finale : couche IA agentic (Phase 12 — DERNIÈRE)

> **À garder en mémoire pendant TOUTE la migration framework.**
> La destination finale de Nodefony n'est pas un framework web généraliste de plus — c'est une **plateforme Node.js pour construire des agents IA métier**, avec gouvernance, conformité AI Act, et mode souverain (LLM local).

**Différenciateur** : aucun équivalent ne fait les deux à la fois.
- NestJS fait le serveur, pas l'IA native.
- LangChain fait l'IA, pas le serveur.
- **Nodefony fait les deux nativement, avec gouvernance intégrée**.

**Pilier technique** : WebSocket natif `@nodefony/http` = transport idéal du streaming LLM token-par-token. DI Container = orchestration des sous-agents. Multi-ORM = persistence pluggable de l'audit et des coûts.

**8 modules IA** (état :  4 existent partiellement, 3 vides, 1 à fusionner avec Vision) :

| Module                | Rôle                                                                     | État actuel | Phase |
| --------------------- | ------------------------------------------------------------------------ | ----------- | ----- |
| `@nodefony/llm`       | Interface multi-LLM (Claude, Gemini, OpenAI, Ollama, Mistral, Groq)      | 🔶          | P12.1 |
| `@nodefony/vector`    | Adapters vector stores (pgvector via orm-core+Drizzle, Qdrant, Chroma)   | 🔶          | P12.1 |
| `@nodefony/rag`       | Pipeline RAG — ingestion / chunking / embedding / recherche              | 🔶          | P12.1 |
| `@nodefony/memory`    | Mémoire agents — court / long / épisodique                                | 🔶          | P12.1 |
| `@nodefony/agent`     | Orchestrateur + sous-agents via DI + decorators `@Agent`/`@Tool`         | 🔶 partiel  | P12.2 |
| `@nodefony/mcp`       | MCP server + client (Model Context Protocol — standard Anthropic)        | ⬜          | P12.3 |
| `@nodefony/agent-guard` | **Différenciateur** — zones, PII, audit, circuit breaker, approval, coûts | ⬜       | P12.4 |
| `@nodefony/studio`    | Panels IA intégrés dans `@nodefony/vision` (pas un module séparé)        | ⬜          | P12.5 |

**Principes invariants** (NE PAS dévier) :

1. **Générique** — aucun module IA ne connaît le métier (droit, finance, médical…).
2. **Injectables** — tous les services IA passent par `@injectable` / `@inject` du DI.
3. **Streaming natif** — `AsyncGenerator<string>` côté serveur, WS Nodefony côté client.
4. **Validation humaine** — approval obligatoire dans zones `restricted` (via `@nodefony/agent-guard`).
5. **Mode souverain** — tout doit pouvoir tourner local (Ollama + pgvector) — air gap OK.
6. **Conformité AI Act** — audit signé, traçabilité sources RAG, contrôle humain dès la conception.
7. **WebSocket = transport LLM** — `@nodefony/http` WS pipeline est la couche transport.

**Règle dure pendant la migration framework** :

- Si je migre un module qui sera consommé par la couche IA (security, user, orm-core, http WS, session, syslog) → **prévoir l'usage IA dans le design** : interfaces extensibles, async iterators support, pas de couplage rigide.
- Les modules IA existants (`llm`, `vector`, `rag`, `memory`, `agent`) sont **partiellement codés en TS** dans `src/packages/@nodefony/*` — pas les casser pendant la migration, mais ne pas non plus considérer leur design comme figé. Audit + refonte en Phase 12.1.
- `@nodefony/studio` du plan IA initial **fusionne avec `@nodefony/vision`** comme panels dédiés (agents, costs, audit, approvals) — pas un module séparé.

**Fichiers IA à lire pour contexte** (en début de session IA, pas pendant la migration framework) :
- `VISION_IA.md` — Mission + principes
- `IA_STATUS.md` — État actuel des 8 modules
- `CLAUDE_IA.md` — Règles techniques IA
- `PLAN_AGENTIC.md` — Roadmap détaillée

> Pendant la migration framework (P0-P11) : **ne pas démarrer de session sur les modules IA** sauf si demande explicite. Garder la vision en tête pour les choix de design — c'est tout.

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
