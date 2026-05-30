---
title: Migration — instantanés périmés (archive)
note: snapshots datés 2026-05-14 (deps, warnings TS, ancienne prochaine-session) retirés du dashboard le 2026-05-30.
---

## État des dépendances (2026-05-14)

| Package     | Avant  | Après  | Workspaces mis à jour                                                                                       |
| ----------- | ------ | ------ | ----------------------------------------------------------------------------------------------------------- |
| typescript  | 5.8.3  | 6.0.3  | nodefony + tous packages                                                                                    |
| uuid        | 11.1.1 | 14.0.0 | nodefony + http                                                                                             |
| @types/node | 24.x   | 25.7.0 | nodefony + tous packages                                                                                    |
| @rollup/... | 28.x   | 29.x   | nodefony + tous packages                                                                                    |
| ESLint 9→10 | 9.31.0 | 10.3.0 | nodefony + root — flat config `eslint.config.mjs` — 0 erreur, 96 warnings `no-explicit-any` (intentionnels) |

---

## Warnings TypeScript restants (build 2026-05-14)

> **0 warnings `[plugin typescript]`** — build entièrement propre.

### TS4114 — Missing `override` modifier (priorité basse)

| Fichier source                                | Lignes         | Fix                                           |
| --------------------------------------------- | -------------- | --------------------------------------------- |
| `nodefony-core/index.ts` (app exemple racine) | 43, 76, 86, 96 | Ajouter `override` — hors packages distribués |

---

### TS2339 — BoatEntity.init (test module)

| Fichier source                                   | Ligne | Propriété                        | Fix                                        |
| ------------------------------------------------ | ----- | -------------------------------- | ------------------------------------------ |
| `@nodefony/test` `nodefony/entity/BoatEntity.ts` | 48    | `init` sur `typeof SessionModel` | Vérifier API Sequelize v6 — session dédiée |

---

## Prochaine session

**Branche active** : `claude-ts`

**État tests @nodefony/http** (2026-05-16) : **336 passing / 336** — suite exhaustive validée.

| Catégorie   | Fichiers                                                   | Tests |
| ----------- | ---------------------------------------------------------- | ----- |
| Unit        | Session, Cookie, HttpError, Response                       | 76    |
| HTTP        | http, http1, https, errors, decorators, fileStream, upload | 103   |
| HttpKernel  | httpKernel (pipeline, contexte, resilience, X-Request-Id)  | 35    |
| Auth/Static | static, session, security                                  | 47    |
| Memory      | memory (flaky en full suite — GC, passe en isolation)      | 7     |
| Resilience  | resilience                                                 | 7     |
| Routing     | Router                                                     | 11    |
| WebSockets  | ws, limits, perf, binary-broadcast, protocol, session, w3c | 50    |

**Prochaines étapes** : voir la [Roadmap priorisée](#-roadmap-priorisée-dette-technique-dabord) en début de fichier.

**P0 — terminé (2026-05-16)** :

1. ✅ **P0.1** — RFC 9110 §15.5.6 ne s'applique pas aux WebSockets (commit d0f8ecf). Tests 370/0.
2. ✅ **P0.2** — WS binary séquentiels verts (vérifié 2026-05-16, 370 passing).
3. ✅ **P0.3** — `IControllerConstructor<T>` générique (commits f2208d2 + 83049fc).

**Démarrer ici (P1 — fondations symbiose, ~7.5 sessions)** : refactors techniques 9.5 dans cet ordre : `Context.lifecycle` (P1.1) → `onAfterResponse` (P1.2) → `AbortSignal` (P1.3) → `AsyncLocalStorage requestId` (P1.4) → `errorRenderer` (P1.5) → `logRequest` pluggable (P1.6) → hooks security (P1.7).

**NE PAS** démarrer Phase 6 (Security) avant que P1.7 soit ✅ — référence JS `/Users/cci/repository/nodefony/src/nodefony/bundles/security-bundle/` à consulter alors.

**Fichiers à lire en début de session** :

- `MIGRATION_STATUS.md` (ce fichier)
- `MEMORY.md` du module concerné
- `CLAUDE.md` du module concerné

**TS6 — Gotchas** :

- `Error.isError()` : built-in TS6 — utiliser `nodefonyError.detectType()` pour détection type erreur
- `EventEmitter` : NE PAS augmenter globalement (casse `net.Server.listen`)
- `tsconfig.json` : `paths: {nodefony: ["./src/index.ts"]}` obligatoire dans le workspace
- `globals.d.ts` : `/// <reference types="node" />` nécessaire pour le rollup plugin

**Vulnérabilités restantes (9)** : twig (locutus/minimatch/minimist) + mocha→diff — majeurs skippés intentionnellement
