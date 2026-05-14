# CLAUDE.md — nodefony-core / branche claude-ts

## Contexte du projet

Framework Node.js fullstack open source — migration vers TypeScript.
Auteur : Christophe CAMENSULI — projet libre CeCILL-B.

**Repo** : https://github.com/nodefony/nodefony-core
**Branche de travail** : claude-ts
**Repo JS référence** : ../nodefony (cloné localement)

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

## Décisions techniques (finales)

**Bundler** : Rollup — `preserveModules: true`, génération `.d.ts` par module. Ne pas remplacer.

**Serveurs** : Node.js natif uniquement — `node:http`, `node:http2`, `ws`. Jamais `Bun.serve()`.

**Modules** : `module: ESNext` + `moduleResolution: Bundler` sur tous les tsconfigs. Zéro CommonJS.

**Terminologie** :

| Ancien (JS)    | Nouveau (TS)   |
| -------------- | -------------- |
| Bundle         | Module         |
| @Bundle()      | @Module()      |
| nodefonyBundle | NodefonyModule |

---

## Conventions TypeScript

```typescript
// Interfaces — préfixe I
export interface IKernel { ... }

// Imports Node.js — toujours préfixe node:
import * as http from "node:http";

// Jamais any — unknown + narrowing
// Jamais @ts-ignore
// Jamais require()
```

---

## Workflow de session Claude Code

**DÉBUT :** - Lire `MIGRATION_STATUS.md` - Lire les `memory.md` listés ci-dessous - Ajoute ou met a jour `claude.md` du projet avec tous les liens vers `memory.md`.
les fichiers `memory.md` sont des fichiers md special uniquement pour les IA pour avoir une utilisation et une précision du module optimum sans lire tous les fichiers du module donc economisé des token avec le `README.md` ils sont complementaires

### MEMORY.md — index des fichiers IA

| Module                | Fichier memory                                                                                   | Contenu                                      |
| --------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| Core (@nodefony/core) | [`src/nodefony/MEMORY.md`](src/nodefony/MEMORY.md)                                               | Service, Container, Event                    |
| Syslog / Pdu          | [`src/nodefony/src/syslog/MEMORY.md`](src/nodefony/src/syslog/MEMORY.md)                         | Syslog, Pdu, CircularBuffer                  |
| Kernel / Module / CLI | [`src/nodefony/src/kernel/MEMORY.md`](src/nodefony/src/kernel/MEMORY.md)                         | Kernel lifecycle, Module hooks, CliKernel    |
| Injector / DI         | [`src/nodefony/src/kernel/injector/MEMORY.md`](src/nodefony/src/kernel/injector/MEMORY.md)       | @injectable, @inject, @Inject, scopes, algo  |
| FileClass / Finder    | [`src/nodefony/src/finder/MEMORY.md`](src/nodefony/src/finder/MEMORY.md)                         | FileClass, File, FileResult, Result, Finder  |

**PENDANT :** - Un seul module par session - Écrire les tests **dans la même session** que le code - Valider : `npm run build` (0 erreur TS) + `npm run test` (tous verts)

**FIN :**

- Mettre à jour `MIGRATION_STATUS.md`
- Mettre à jour `README.md`(pour humains)
- Mettre à jour `memory.md` (pour IA)

- Committer avant de fermer

---

## 📚 Documentation Modules Workflow de session Claude Code

**Règle** : Après toute **modif/refactor/mettre à jour/fin de session** sur un module :

1. **Règle** :
   - `memory.md` : **IA** (pour IA : **ultra-concis**, mots-clés, 0 redondance) (ex: `Syslog: log class. Pdu: log entry. RingBuffer: FIFO stack.`).
   - `README.md` : **Humains** (pour humains : exemples, détails, tableaux) (ex: `## Usage\nnew Syslog().info("test")`).
2. **Structure** :
   - `memory.md` : **Purpose** **Core Components** | **Config** | **Behaviors** | **Usage (minimal)** | **Deps** | **Gotchas**.
   - `README.md` : **Features** | **Install** | **Config** | **Usage** | **API** | **Examples** | **Troubleshooting**.
3. **Vérification** :
   - `grep -r "TODO\|FIXME" src/` avant commit.
   - Warning sur les console.log et autre avant commit.

---

## Lancer le framework (tests runtime)

### Commande de test non-interactive (10 secondes)

```bash
npx nodefony development 2>&1 &
PID=$!
sleep 10
kill $PID 2>/dev/null
wait $PID 2>/dev/null
true
```

> Utiliser `development` (pas `dev` ni `start`) — lance le serveur sans prompt interactif.
> Le `&` + `kill` permet un test borné dans Claude Code (pas de `timeout` sur macOS).

### Signes que le démarrage est OK

```
INFO  KERNEL  :  MODULE ADD : app
INFO  KERNEL  :  MODULE ADD : sequelize
INFO  KERNEL  :  MODULE ADD : http
...
INFO  server-http  :  Server Listen on http://127.0.0.1:5151
INFO  server-https :  Server Listen on https://127.0.0.1:5152
INFO  server-websocket : Server Listen on ws://127.0.0.1:5151
```

### Erreurs critiques à connaître

| Erreur                                       | Cause                                                      | Fix                                                      |
| -------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------- |
| `does not provide an export named 'default'` | `import nodefony from "nodefony"` — plus de default export | Remplacer par `import { Nodefony } from "nodefony"`      |
| `does not provide an export named 'Error'`   | `import { Error } from "nodefony"` — renommé               | Remplacer par `import { nodefonyError } from "nodefony"` |
| `does not provide an export named 'kernel'`  | `import { kernel } from "nodefony"` — singleton supprimé   | Remplacer par `Nodefony.getKernel()`                     |

### Rebuild complet avant test

```bash
# packages (turbo)
npx turbo run build --force
# projet (rollup racine)
npx rollup -c rollup.config.ts --configPlugin typescript
```

---

## Point d'attention restant

### rollup.config.ts — `@ts-ignore` à corriger

```typescript
//@ts-ignore  ← à remplacer
import { createPathTransform } from "rollup-sourcemap-path-transform";
```

Corriger en créant un fichier `.d.ts` minimal pour ce module.
