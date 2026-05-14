# IA_STATUS.md — État des modules IA

> Lu par Claude Code en début de chaque session.
> Légende : ✅ Fait | 🔶 Partiel | ⬜ À faire

---

## Vue globale

| #   | Module                | Interfaces | Services             | Tests | index.ts | Statut |
| --- | --------------------- | ---------- | -------------------- | ----- | -------- | ------ |
| 1   | @nodefony/llm         | ✅         | ✅                   | ✅    | ✅       | ✅     |
| 2   | @nodefony/vector      | ✅         | ✅                   | ✅    | ✅       | ✅     |
| 3   | @nodefony/rag         | ✅         | ✅                   | ✅    | ✅       | ✅     |
| 4   | @nodefony/memory      | ✅         | ✅                   | ✅    | ✅       | ✅     |
| 5   | @nodefony/agent       | ✅         | 🔶 ToolRegistry only | 🔶    | ✅       | 🔶     |
| 6   | @nodefony/mcp         | ⬜         | ⬜                   | ⬜    | ⬜       | ⬜     |
| 7   | @nodefony/agent-guard | ⬜         | ⬜                   | ⬜    | ⬜       | ⬜     |
| 8   | @nodefony/studio      | ⬜         | ⬜                   | ⬜    | ⬜       | ⬜     |

---

## Ce qui reste à faire — par ordre de priorité

### @nodefony/agent — compléter

**Manque :**

- `src/orchestrator/AgentOrchestrator.ts` — orchestrateur principal
- `src/decorators/Agent.ts` — decorator `@Agent({...})`
- `src/decorators/Tool.ts` — decorator `@Tool({...})`
- `tests/AgentOrchestrator.test.ts`

**À implémenter dans AgentOrchestrator.ts :**

- Constructor : injecte `ILLMProvider`, `ToolRegistry`, optionnel `IRagService`, `IMemoryService`
- `run()` : boucle agentic — LLM → tool calls → re-LLM jusqu'à `end_turn` ou `maxIterations`
- `stream()` : AsyncGenerator avec events `started/thinking/tool_call/tool_result/token/completed`
- `abort(sessionId)` : Map<sessionId, AbortController> + cleanup
- `shutdown()` : abort tous les controllers + clear maps
- Limite `maxIterations: 10` par défaut → throw `AgentMaxIterationsError`

### @nodefony/mcp — créer entièrement

**Structure :**

```
mcp/
├── index.ts
├── package.json
├── src/
│   ├── interfaces/IMCPServer.ts
│   ├── protocol/MCPProtocol.ts     ← JSON-RPC 2.0 types
│   ├── server/MCPServer.ts          ← handleRequest()
│   ├── client/MCPClient.ts
│   └── errors/MCPErrors.ts
└── tests/
    ├── MCPServer.test.ts
    └── MCPClient.test.ts
```

**Points critiques :**

- JSON-RPC 2.0 strict — valider `jsonrpc: "2.0"`, `id`, `method`
- Méthodes MCP : `initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/read`
- Codes erreur : -32700 parse, -32600 invalid req, -32601 method not found, -32602 invalid params
- Codes spécifiques : -32001 tool not found, -32002 resource not found
- Validation noms tools : regex `/^[a-z][a-z0-9_]*$/`
- Limite max tools/resources (256/1024)
- shutdown() vide les Maps internes

### @nodefony/agent-guard — créer entièrement

**Structure :**

```
agent-guard/
├── index.ts
├── package.json
├── src/
│   ├── interfaces/IAgentGuard.ts
│   ├── config/agent-guard.config.ts
│   ├── decorators/
│   │   ├── Agent.ts                ← @Agent({permissions, limits})
│   │   ├── AgentZone.ts            ← @AgentZone("sensitive")
│   │   └── Tool.ts                 ← @Tool({inputSchema, outputRules})
│   ├── services/
│   │   ├── ZoneResolverService.ts
│   │   ├── PermissionCheckerService.ts
│   │   ├── AgentRegistryService.ts
│   │   ├── AuditService.ts
│   │   ├── CostTrackerService.ts
│   │   ├── ApprovalService.ts
│   │   ├── CircuitBreakerService.ts
│   │   ├── PIIMaskingService.ts    ← masque NIR, IBAN, email, tel, SIRET
│   │   └── OutputValidatorService.ts
│   ├── middleware/AgentGuardMiddleware.ts
│   ├── entities/                   ← MikroORM
│   │   ├── AgentEntity.ts
│   │   ├── AuditEntryEntity.ts
│   │   ├── AgentCostEntity.ts
│   │   ├── CircuitBreakerEntity.ts
│   │   └── ApprovalEntity.ts
│   ├── monitoring/AgentGuardMonitor.ts
│   └── errors/GuardErrors.ts
└── tests/
    └── (tests pour chaque service)
```

**Points critiques :**

- 4 zones : `public` / `sensitive` / `restricted` / `forbidden`
- Default deny si aucune zone ne match
- PII Masking : patterns FR (NIR, IBAN, CB, tel, email, SIRET) + custom
- Circuit breaker : closed → open → half-open avec cooldown
- AuditService → INSERT MikroORM
- CostTracker : UPSERT par agent+date (1 ligne/jour)
- ApprovalService : utilise WS Nodefony (Promise en attente déblouée par approve/reject)
- Toutes les entités ont des index DB pertinents
- shutdown() : flush queue audit + close DB connections

### @nodefony/studio — créer entièrement

**Structure :**

```
studio/
├── index.ts
├── package.json
├── src/
│   ├── interfaces/IStudio.ts
│   ├── services/
│   │   ├── StudioService.ts
│   │   ├── PanelRegistry.ts
│   │   └── AgentGuardMonitor.ts    ← consomme agent-guard
│   ├── controllers/
│   │   ├── StudioController.ts     ← routes HTTP /nodefony/*
│   │   └── ApprovalController.ts   ← WS approve/reject
│   └── panels/
│       ├── AgentsPanel.ts
│       ├── CostsPanel.ts
│       └── AuditPanel.ts
└── tests/
```

---

## Conventions techniques rappels

- TypeScript strict, zéro `any`, zéro `@ts-ignore`
- ESM uniquement, imports avec `.js`
- Préfixe `node:` pour Node.js (`node:crypto`, `node:fs`)
- Interfaces préfixées `I` (`IService`, `IAgent`)
- Tests `bun test` obligatoires pour chaque service
- `index.ts` est le seul export public
- Services : `shutdown()` obligatoire qui clean Sets/Maps/timers
- Tests : `afterEach` qui appelle `shutdown()` (vérification fuites)
- Fetch streaming : `try/finally` + `reader.releaseLock()` + AbortController
- Timers : `clearTimeout` / `clearInterval` dans `finally`
- Validation Zod sur tous les inputs externes
