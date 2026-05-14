# CLAUDE.md — nodefony-core

## Contexte du projet

Framework Node.js fullstack open source — migration vers TypeScript.
Auteur : Christophe CAMENSULI — projet libre CeCILL-B.

**Repo** : https://github.com/nodefony/nodefony-core
**Branche principale** : `claude-ts` (branches de travail : `refactor/*` mergées dans `claude-ts`)
**Repo JS référence** : `../nodefony` (cloné localement)

---

## Vision du framework

Nodefony est une **plateforme générique** pour construire :

1. Des applications web temps réel (HTTP + WS co-citoyens natifs)
2. Des agents IA métier (RAG, orchestration, sous-agents)

**Positionnement** : framework générique réutilisable — jamais de logique métier dans le core.
**Inspiration** : Symfony (DI, modules, kernel, Firewall Applicatif) + NestJS (decorators TS)
**Différenciateur** : HTTP et WebSocket dans le même contexte controller, nativement.

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
src/packages/@nodefony/[module]/
├── index.ts              ← export public uniquement
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

1. Lire `MIGRATION_STATUS.md`
2. Lire le `MEMORY.md` du module concerné (table ci-dessous)
3. Mettre à jour `CLAUDE.md` si un nouveau `MEMORY.md` a été créé

**PENDANT :**

- Un seul module par session
- Écrire les tests dans la même session que le code
- Valider : `npm run build` (0 erreur TS) + `npm run test` (tous verts)

**FIN :**

1. Mettre à jour `MIGRATION_STATUS.md`
2. Mettre à jour `README.md` (humains) + `MEMORY.md` (IA) du module
3. Committer avant de fermer

---

## MEMORY.md — index des fichiers IA

Les `MEMORY.md` sont des fichiers **IA uniquement** — ultra-concis, mots-clés, 0 redondance.
Complémentaires aux `README.md` (humains). Lire le `MEMORY.md` du module avant de toucher au code.

| Module                | Fichier memory                                                                             | Contenu                                     |
| --------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------- |
| Core (@nodefony/core) | [`src/nodefony/MEMORY.md`](src/nodefony/MEMORY.md)                                         | Service, Container, Event                   |
| Syslog / Pdu          | [`src/nodefony/src/syslog/MEMORY.md`](src/nodefony/src/syslog/MEMORY.md)                   | Syslog, Pdu, CircularBuffer                 |
| Kernel / Module / CLI | [`src/nodefony/src/kernel/MEMORY.md`](src/nodefony/src/kernel/MEMORY.md)                   | Kernel lifecycle, Module hooks, CliKernel   |
| Injector / DI         | [`src/nodefony/src/kernel/injector/MEMORY.md`](src/nodefony/src/kernel/injector/MEMORY.md) | @injectable, @inject, @Inject, scopes, algo |
| FileClass / Finder    | [`src/nodefony/src/finder/MEMORY.md`](src/nodefony/src/finder/MEMORY.md)                   | FileClass, File, FileResult, Result, Finder |

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

```bash
npx nodefony development 2>&1 &
PID=$!
sleep 10
kill $PID 2>/dev/null
wait $PID 2>/dev/null
true
```

> Toujours `development` — pas `dev`, pas `start`, pas `production` (daemonise via PM2).

### Signes que le démarrage est OK

```
INFO  KERNEL  :  MODULE ADD : app
INFO  KERNEL  :  MODULE ADD : http
INFO  server-http  :  Server Listen on http://127.0.0.1:5151
INFO  server-https :  Server Listen on https://127.0.0.1:5152
INFO  server-websocket : Server Listen on ws://127.0.0.1:5151
```

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
