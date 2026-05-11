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

| Ancien (JS) | Nouveau (TS) |
|-------------|--------------|
| Bundle | Module |
| @Bundle() | @Module() |
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

**DÉBUT :** Lire `MIGRATION_STATUS.md`

**PENDANT :**
- Un seul module par session
- Écrire les tests **dans la même session** que le code
- Valider : `npm run build` (0 erreur TS) + `npm run test` (tous verts)

**FIN :**
- Mettre à jour `MIGRATION_STATUS.md`
- Committer avant de fermer

---

## Point d'attention restant

### rollup.config.ts — `@ts-ignore` à corriger
```typescript
//@ts-ignore  ← à remplacer
import { createPathTransform } from "rollup-sourcemap-path-transform";
```
Corriger en créant un fichier `.d.ts` minimal pour ce module.
