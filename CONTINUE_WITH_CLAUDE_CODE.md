# CONTINUE_WITH_CLAUDE_CODE.md

> Guide pour terminer les modules IA avec Claude Code en local.

---

## Ce qui est fait dans ce zip

5 modules complets et testés :

- `@nodefony/llm` — providers Claude/Ollama, streaming, abort, fuites mémoire gérées
- `@nodefony/vector` — adapters Memory + PgVector (SQL injection-safe)
- `@nodefony/rag` — RagService + chunkers Fixed/Sentence
- `@nodefony/memory` — MemoryService + InMemoryStore borné (TTL + LRU)
- `@nodefony/agent` — interfaces + ToolRegistry (orchestrator à compléter)

---

## Workflow pour finir avec Claude Code

### Étape 1 — Importer dans nodefony-core

```bash
cd nodefony-core
git checkout claude-ts

# Copier le dossier @nodefony/ depuis le zip dans src/packages/
cp -r /chemin/vers/zip/src/packages/@nodefony/llm     src/packages/@nodefony/
cp -r /chemin/vers/zip/src/packages/@nodefony/vector  src/packages/@nodefony/
cp -r /chemin/vers/zip/src/packages/@nodefony/rag     src/packages/@nodefony/
cp -r /chemin/vers/zip/src/packages/@nodefony/memory  src/packages/@nodefony/
cp -r /chemin/vers/zip/src/packages/@nodefony/agent   src/packages/@nodefony/

# Copier les fichiers de doc à la racine
cp /chemin/vers/zip/VISION_IA.md  .
cp /chemin/vers/zip/CLAUDE_IA.md  .
cp /chemin/vers/zip/IA_STATUS.md  .

# Vérifier que tsc passe
bun install
bunx tsc --noEmit

# Lancer les tests
bun test src/packages/@nodefony/llm/
bun test src/packages/@nodefony/vector/
bun test src/packages/@nodefony/rag/
bun test src/packages/@nodefony/memory/
bun test src/packages/@nodefony/agent/

# Premier commit
git add .
git commit -m "feat(ia): add @nodefony/llm, vector, rag, memory, agent (interfaces+core)"
```

---

### Étape 2 — Compléter agent (orchestrator)

```bash
claude
```

Dans Claude Code :

```
Lis VISION_IA.md, CLAUDE_IA.md, IA_STATUS.md.

Complète @nodefony/agent en ajoutant :
1. src/orchestrator/AgentOrchestrator.ts
2. src/decorators/Agent.ts
3. src/decorators/Tool.ts
4. tests/AgentOrchestrator.test.ts

Suis les conventions de CLAUDE_IA.md.
La gestion mémoire est critique : abort sessions, cleanup Maps, shutdown idempotent.
Utilise les interfaces et erreurs déjà présentes dans src/interfaces et src/errors.
Mets à jour IA_STATUS.md à la fin.
```

Coût estimé : ~30k tokens, ~0.20€

---

### Étape 3 — Créer @nodefony/mcp

```
Lis VISION_IA.md, CLAUDE_IA.md, IA_STATUS.md.

Crée @nodefony/mcp en suivant la structure définie dans IA_STATUS.md section "@nodefony/mcp".

Spec MCP officielle : https://modelcontextprotocol.io
Protocole JSON-RPC 2.0 strict.

Points critiques :
- Validation stricte du format JSON-RPC
- Codes erreur : -32700, -32600, -32601, -32602, -32001, -32002
- Méthodes : initialize, tools/list, tools/call, resources/list, resources/read
- Validation noms tools : regex /^[a-z][a-z0-9_]*$/
- Maps internes vidées au shutdown()
- Tests : tous les codes erreur, validation, shutdown

Mets à jour IA_STATUS.md à la fin.
Commit : "feat(ia): implement @nodefony/mcp (Model Context Protocol)"
```

Coût estimé : ~40k tokens, ~0.30€

---

### Étape 4 — Créer @nodefony/agent-guard

C'est le plus gros module. Le faire en 2 sessions :

**Session 4a — services + decorators (sans MikroORM)**

```
Lis VISION_IA.md, CLAUDE_IA.md, IA_STATUS.md.

Crée @nodefony/agent-guard PARTIE 1 :
1. interfaces/IAgentGuard.ts
2. errors/GuardErrors.ts
3. config/agent-guard.config.ts (4 zones : public/sensitive/restricted/forbidden)
4. services/ZoneResolverService.ts (default deny)
5. services/PermissionCheckerService.ts
6. services/PIIMaskingService.ts (NIR, IBAN, CB, tel, email, SIRET — patterns FR)
7. services/CircuitBreakerService.ts (closed/open/half-open + cooldown)
8. services/CostTrackerService.ts (limites tokens/€/rate avec window 1min)
9. decorators/Agent.ts, AgentZone.ts, Tool.ts
10. Tests pour chaque service

NE PAS faire les entités MikroORM ni AuditService/ApprovalService dans cette session.

Mets à jour IA_STATUS.md.
Commit : "feat(ia): implement @nodefony/agent-guard (services + decorators)"
```

Coût estimé : ~60k tokens, ~0.45€

**Session 4b — entités MikroORM + AuditService + ApprovalService + Middleware**

```
Lis VISION_IA.md, CLAUDE_IA.md, IA_STATUS.md.
Tu as déjà fait la partie 1 de @nodefony/agent-guard.

Complète maintenant PARTIE 2 :
1. entities/ : AgentEntity, AuditEntryEntity, AgentCostEntity,
   CircuitBreakerEntity, ApprovalEntity (MikroORM)
2. services/AgentRegistryService.ts (utilise AgentEntity)
3. services/AuditService.ts (INSERT batch dans AuditEntryEntity)
4. services/ApprovalService.ts (Promise en attente, déblouée par WS)
5. services/OutputValidatorService.ts (règles métier sur output LLM)
6. middleware/AgentGuardMiddleware.ts (intercepte avant controllers)
7. monitoring/AgentGuardMonitor.ts
8. Tests pour chaque service

Index DB importants :
- audit : (agent_id, timestamp DESC), (outcome, timestamp DESC)
- approvals : partial index WHERE status = 'pending'
- costs : UNIQUE(agent_id, date)

Mets à jour IA_STATUS.md.
Commit : "feat(ia): complete @nodefony/agent-guard (entities + middleware)"
```

Coût estimé : ~70k tokens, ~0.55€

---

### Étape 5 — Créer @nodefony/studio

```
Lis VISION_IA.md, CLAUDE_IA.md, IA_STATUS.md.

Crée @nodefony/studio :
- StudioService + PanelRegistry
- StudioController (routes /nodefony/*)
- ApprovalController (WS approve/reject)
- AgentsPanel, CostsPanel, AuditPanel
- Tests

Le studio CONSOMME agent-guard (lecture des entités, registre des agents).
Streaming WS pour le live update du dashboard.
Pas d'écriture directe — seulement read + actions explicites validées par l'utilisateur.

Mets à jour IA_STATUS.md.
Commit : "feat(ia): implement @nodefony/studio (dashboard /nodefony)"
```

Coût estimé : ~50k tokens, ~0.40€

---

## Coût total estimé

| Étape                   | Coût    |
| ----------------------- | ------- |
| Étape 2 (agent)         | 0.20€   |
| Étape 3 (mcp)           | 0.30€   |
| Étape 4a (guard part 1) | 0.45€   |
| Étape 4b (guard part 2) | 0.55€   |
| Étape 5 (studio)        | 0.40€   |
| **Total**               | **~2€** |

Ton forfait Pro à 20€/mois absorbe largement ça.

---

## Règles d'or pour économiser

2. **Une session = un module (ou une partie d'un module)**
   → Évite la pollution du contexte

3. **Toujours dire de committer**
   → Permet de redémarrer propre la session suivante

4. **Si Claude Code commence à divaguer → /clear et nouvelle session**
   → Mieux que de gaspiller le contexte
