# CLAUDE_IA.md — Instructions pour Claude Code

> Lire VISION_IA.md en premier.
> Ce fichier contient les règles techniques précises des modules IA.

---

## Règles absolues

```
✅ TypeScript strict — zéro any, zéro @ts-ignore
✅ ESM uniquement — import .js obligatoire
✅ Préfixe node: pour Node.js (node:fs, node:http)
✅ Interfaces préfixées I (IService, IAgent)
✅ Tests bun test pour chaque service
✅ Index.ts comme seul point d'entrée
✅ Zod pour toute validation runtime
✅ AsyncGenerator pour le streaming
✅ Gestion mémoire : cleanup obligatoire dans shutdown()
✅ Try/catch + logging sur tous les async
```

---

## Structure d'un module

```
src/packages/@nodefony/[module]/
├── index.ts              ← export public uniquement
├── package.json          ← workspace npm
├── README.md             ← doc du module
├── src/
│   ├── interfaces/       ← I*.ts
│   ├── services/         ← @Service implementations
│   ├── errors/           ← classes typées
│   └── [domain]/         ← sous-dossiers spécifiques
└── tests/
    └── *.test.ts         ← couverture > 80%
```

---

## Sécurité — checklist obligatoire

### Validation des entrées
- Tout input externe passe par Zod
- Limites strictes : maxLength, max() sur les nombres
- Whitelist des valeurs énumérées (pas de string libre)

### Gestion des secrets
- API keys jamais hardcodées
- Lecture via `process.env` uniquement
- Validation de présence avant usage
- Jamais log de secret même partiel

### Fuites mémoire — patterns à respecter

```typescript
// ✅ Toujours cleanup les ressources async
class StreamService {
  private controllers = new Set<AbortController>();

  async stream() {
    const controller = new AbortController();
    this.controllers.add(controller);
    try {
      // ...
    } finally {
      this.controllers.delete(controller);
    }
  }

  async shutdown() {
    for (const c of this.controllers) c.abort();
    this.controllers.clear();
  }
}

// ✅ Toujours releaseLock() sur les readers
const reader = response.body!.getReader();
try { /* ... */ } finally { reader.releaseLock(); }

// ✅ Toujours clearTimeout dans finally
const handle = setTimeout(...);
try { /* ... */ } finally { clearTimeout(handle); }

// ✅ EventEmitter — removeAllListeners() au shutdown
// ✅ Map/Set internes — .clear() au shutdown
// ✅ Workers — terminate() obligatoire
// ✅ DB connections — close() dans finally
```

### Limites par défaut
- maxTokens : 4096
- maxQueueSize : 500
- taskTimeout : 30s
- maxRetries : 2
- maxConnections : 100

---

## Tests — patterns obligatoires

```typescript
import { describe, it, expect, beforeAll, afterAll, mock, spyOn } from "bun:test";

describe("ServiceName", () => {
  let service: ServiceName;
  
  beforeAll(async () => {
    service = new ServiceName(mockKernel);
    await service.boot();
  });
  
  afterAll(async () => {
    await service.shutdown(); // ← OBLIGATOIRE — vérifie pas de fuite
  });
  
  describe("happy path", () => { ... });
  describe("error cases", () => { ... });
  describe("edge cases", () => {
    it("handles empty input", () => { ... });
    it("handles malformed input", () => { ... });
    it("handles timeout", () => { ... });
  });
  describe("memory safety", () => {
    it("cleans up on shutdown", async () => {
      // Vérifier que les Sets/Maps internes sont vides après shutdown
    });
  });
});
```

---

## Workflow de session Claude Code

```
1. claude "Lis VISION_IA.md, CLAUDE_IA.md, IA_STATUS.md"
2. Identifier le module à implémenter (statut ⬜)
3. Vérifier que les dépendances sont ✅
4. Implémenter dans cet ordre :
   - interfaces/I*.ts
   - errors/*.ts
   - services/*.ts (avec gestion mémoire stricte)
   - tests/*.test.ts
   - index.ts (export final)
5. Vérifier : bun test [module] doit passer
6. Vérifier : bunx tsc --noEmit doit passer
7. Mettre à jour IA_STATUS.md
8. Commit : feat(ia): implement @nodefony/[module]
```

---

## Ordre d'implémentation strict

```
Niveau 0 (parallélisable)
  @nodefony/llm
  @nodefony/vector

Niveau 1 (après niveau 0)
  @nodefony/rag       (besoin llm + vector)
  @nodefony/memory    (besoin vector + llm)

Niveau 2 (après niveau 1)
  @nodefony/agent     (besoin tout niveau 0+1)

Niveau 3 (après niveau 2)
  @nodefony/mcp           (besoin agent)
  @nodefony/agent-guard   (besoin llm + agent)

Niveau 4 (dashboard)
  @nodefony/studio    (consomme tous les autres)
```

Ne jamais commencer un module dont les dépendances ne sont pas ✅.
