# CLAUDE.md — nodefony-core / branche claude-ts

## Contexte du projet

Framework Node.js fullstack open source — migration vers TypeScript.
Auteur : Christophe CAMENSULI — projet libre CeCILL-B.

**Repo** : https://github.com/nodefony/nodefony-core
**Branche de travail** : claude-ts (basée sur main/master avec Rollup)
**Repo JS référence** : ../nodefony (cloné localement)

---

## Vision du framework

Nodefony est une **plateforme générique** pour construire :
1. Des applications web temps réel (HTTP + WS co-citoyens natifs)
2. Des agents IA métier (RAG, orchestration, sous-agents)

**Positionnement** : framework générique réutilisable — jamais de logique métier dans le core.
**Inspiration** : Symfony / hybernate  (DI, modules, kernel, Firewall Applicatif ) + NestJS (decorators TS)
**Différenciateur** : HTTP et WebSocket dans le même contexte controller, nativement.

---

## Architecture

```
nodefony-core/
├── index.ts                    ← point d'entrée principal
├── rollup.config.ts            ← bundler (NE PAS MODIFIER sans accord)
├── tsconfig.json               ← config TS (NE PAS MODIFIER sans accord)
├── package.json                ← workspaces npm
├── CLAUDE.md                   ← ce fichier
├── MIGRATION_STATUS.md         ← tableau de bord — LIRE EN DÉBUT DE SESSION
├── .claude/
│   ├── conventions.md          ← règles TypeScript du projet
│   └── prompts/                ← prompts réutilisables
├── nodefony/                   ← code source principal du module de dev core 
│   └── **/*.ts
└── src/
    ├── nodefony/               ← workspace core (@nodefony/core)
    ├── packages/
    │   └── @nodefony/          ← workspaces modules
    │       ├── http/
    │       ├── security/
    │       ├── framework/
    │       ├── sequelize/
    │       ├── mongoose/
    │       ├── redis/
    │       └── test/
    └── modules/
        └── test/               ← module exemple
```

---

## Bundler — Rollup (décision finale)

**Rollup est le bundler officiel de Nodefony. Ne pas remplacer par Bun build.**

Raisons :
- `preserveModules: true` → chaque module garde sa structure pour npm
- `declarationDir: "dist/types"` → génération `.d.ts` propre par module
- Tree-shaking fin sur les modules indépendants
- Config déjà opérationnelle sur main


**Rollup** = build et publication npm des modules

---

## Serveurs — Node.js natif (décision finale)

Les serveurs HTTP/WS/HTTP2 utilisent uniquement les APIs Node.js natives.


```typescript
// ✅ Correct
import * as http from "node:http";
import * as http2 from "node:http2";
import { WebSocketServer } from "ws";

// ❌ Jamais
Bun.serve({ port, fetch });
```

---

## Terminologie (décision finale)

| Ancien (JS) | Nouveau (TS) |
|-------------|--------------|
| Bundle | Module |
| @Bundle() | @Module() |
| nodefonyBundle | NodefonyModule |

---

## Modules à construire — ordre de priorité

### Phase 1 — Core framework (migration TS)
```
@nodefony/core     → Kernel, DI Container, Module system
@nodefony/http     → Serveurs HTTP/HTTPS/HTTP2/WS/WSS
@nodefony/router   → Router unifié HTTP+WS, decorators
@nodefony/security → JWT, OAuth, Session, WAF
```

### Phase 2 — ORM adapters
```
@nodefony/mikro    → MikroORM (ORM principal TypeScript)
@nodefony/mongoose → MongoDB
@nodefony/sequelize → Sequelize v6 (legacy compat historique nodefony 7 ) 
```

### Phase 3 — Couche IA générique
```
@nodefony/llm      → ILLMProvider + adapters Claude/Gemini/Ollama
@nodefony/rag      → Pipeline indexation + recherche vectorielle
@nodefony/vector   → Adapters pgvector / Qdrant / Chroma
@nodefony/agent    → Orchestrateur + sous-agents
@nodefony/mcp      → MCP server + client (Model Context Protocol)
@nodefony/memory   → Mémoire court/long terme agents
```

### Phase 4 — Dev tooling IA
```
@nodefony/studio   → Dashboard IA /nodefony (remplace /monitoring)
@nodefony/generator → Générateur de modules via IA
```

---

## Conventions TypeScript — résumé rapide

```typescript
// Interfaces — préfixe I
export interface IKernel { ... }

// Decorators — factory functions
@Module({ name: 'hello' })
@Service({ singleton: true })
@Controller('/api')
@Route('/users', { method: 'GET' })
@WebSocketRoute('/live')

// Imports Node.js — toujours préfixe node:
import * as http from "node:http";
import * as path from "node:path";

// Jamais any — unknown + narrowing si nécessaire
// Jamais @ts-ignore
// Jamais require()
```

Voir `.claude/conventions.md` pour le détail complet.

---

## Workflow de session Claude Code

**DÉBUT de chaque session :**
```bash
# Claude Code lit automatiquement ce fichier
# Puis lire le tableau de bord
cat MIGRATION_STATUS.md
```

**PENDANT la session :**
- Un seul module par session
- Écrire les tests en même temps que le code
- Vérifier : `bunx tsc --noEmit` + `bun test`

**FIN de chaque session :**
- Mettre à jour MIGRATION_STATUS.md
- Committer : `git add -A && git commit -m "feat(migration): migrate [module]"`
- Ne jamais laisser une session ouverte sans commit

---

## Points d'attention critiques

### tsconfig.json — problème connu à corriger
```json
// ❌ Actuel — obsolète en TS 5.x
"moduleResolution": "Node"

// ✅ À migrer vers
"moduleResolution": "Bundler"
```
**Ne pas corriger seul — demander confirmation.**


### rollup.config.ts — @ts-ignore à corriger
```typescript
//@ts-ignore  ← à remplacer
import { createPathTransform } from "rollup-sourcemap-path-transform";
```
**Corriger en créant un fichier `.d.ts` minimal pour ce module.**
