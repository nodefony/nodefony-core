# NODEFONY

<div align="center">

**Full-stack TypeScript framework for real-time applications and AI agents**

*HTTP and WebSocket as first-class citizens · One controller, one context, one codebase.*

[![License: CeCILL-B](https://img.shields.io/badge/License-CeCILL--B-blue.svg?style=flat-square)](http://www.cecill.info/licences/Licence_CeCILL-B_V1-en.html)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue?style=flat-square)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-green?style=flat-square)](https://nodejs.org/)
[![ESM only](https://img.shields.io/badge/ESM-only-orange?style=flat-square)](https://nodejs.org/api/esm.html)
[![Status](https://img.shields.io/badge/Status-TypeScript%20migration%20in%20progress-yellow?style=flat-square)](./MIGRATION_STATUS.md)

</div>

---

> ⚠️ **Project status — TypeScript migration in progress.**
> Nodefony is being rewritten from JavaScript (legacy `nodefony-bundle/*`) to **strict TypeScript** with an ESM-only, decorator-driven, cloud-native architecture. Active branch: `claude-ts`. See [MIGRATION_STATUS.md](./MIGRATION_STATUS.md) for the live roadmap and progress (currently ~13% complete, MVP path estimated ~37 sessions).

---

## What is Nodefony?

Nodefony is a **Node.js framework** designed to build, in the same codebase and with the same decorator-driven model:

1. **Real-time web applications** — HTTP and WebSocket sharing a unified controller context.
2. **AI agents** — RAG pipelines, sub-agents orchestration, MCP servers, all as composable modules.

It's heavily inspired by **Symfony** (DI container, modules, kernel, firewall + secured areas) and **NestJS** (TypeScript decorators), with one big differentiator: **HTTP and WebSocket are co-citizens**, not bolted-on. The same controller method can serve both transports with the same session, the same authentication, the same routing.

```typescript
@Controller('/data')
export class DataController extends NodefonyController {
  @Route('/')                  // GET /data
  @WebSocketRoute('/stream')   // WS  /data/stream
  async dataAction(ctx: NodefonyContext): Promise<void> {
    const data = await this.dataService.get();
    ctx.isWebSocket() ? ctx.send(JSON.stringify(data)) : ctx.json(data);
  }
}
```

No separate gateway. No duplicated logic. Two transports, one action.

---

## Why does this matter?

Most Node.js frameworks treat WebSocket as an afterthought: a separate middleware stack, a separate authentication path, a separate routing layer. As soon as your app needs live updates (a chat, a streaming AI agent, a collaborative editor, a vocal interface), you end up gluing two parallel codebases together.

Nodefony was built from the start on the assumption that **modern applications are real-time by default**. The pipeline below applies to every request — HTTP REST, WebSocket frame, JSON-RPC message — without the developer having to think about the transport:

```
[ Request HTTP / WS frame ]
         │
         ▼
┌────────────────────────────────────────────────────┐
│ 1. Kernel Scoping (AsyncLocalStorage)              │  ← per-request context
│    requestId · user · traceparent · scheme          │
└────────────────┬───────────────────────────────────┘
                 ▼
┌────────────────────────────────────────────────────┐
│ 2. Firewall (Secured Areas)                        │  ← Symfony-style zones
│    Authenticator chain · WAF cooperation · CSRF    │
└────────────────┬───────────────────────────────────┘
                 ▼
┌────────────────────────────────────────────────────┐
│ 3. Controller + Decorators                         │  ← Spring-style guards
│    @IsGranted · @CurrentUser · @AuditLog · ...     │
│    3-level authorization: hierarchy · RBAC · Voters │
└────────────────┬───────────────────────────────────┘
                 ▼
┌────────────────────────────────────────────────────┐
│ 4. Action — your business logic                    │
└────────────────────────────────────────────────────┘
```

---

## Architecture

The framework is split into composable workspaces. Each package is independently versioned and published, with strict TypeScript types generated per module.

```
┌────────────────────────────────────────────────────────────────────┐
│                          your application                          │
│              modules · controllers · services · entities           │
└─────────────────────────────────┬──────────────────────────────────┘
                                  │ (DI container, decorators)
┌─────────────────────────────────▼──────────────────────────────────┐
│                        nodefony runtime                            │
│                                                                    │
│  @nodefony/core       Kernel · DI · Module · Syslog · CLI          │
│  @nodefony/http       HTTP/HTTPS/HTTP2/WS/WSS servers + Context    │
│  @nodefony/framework  Router · Resolver · Controller · decorators  │
│  @nodefony/user       IUser · BaseUser · IPasswordEncoder · service │
│  @nodefony/security   Firewall · SecuredArea · Authenticators       │
│                       defineSecurityConfig + Zod · CSRF · CORS     │
│  @nodefony/frontend   Vite supervisor (Vue · React · Svelte · ...)  │
│  @nodefony/studio     Admin web UI — routes under /nodefony/*       │
└─────────────────────────────────┬──────────────────────────────────┘
                                  │
┌─────────────────────────────────▼──────────────────────────────────┐
│              data layer (optional, multi-driver)                   │
│                                                                    │
│  @nodefony/orm-core   IOrm · IRepository · IEntity (abstraction)    │
│  @nodefony/drizzle    ⭐ Drizzle ORM — SQL-builder, TypeScript-first │
│  @nodefony/mikroorm   MikroORM — Data Mapper + Unit of Work         │
│  @nodefony/mongoose   Mongoose — MongoDB                            │
│  @nodefony/sequelize  🪦 Sequelize — legacy maintenance only        │
│  @nodefony/redis      Cluster · pub/sub · session storage           │
└─────────────────────────────────┬──────────────────────────────────┘
                                  │
┌─────────────────────────────────▼──────────────────────────────────┐
│         ai platform (Phase 12 — LAST, scaffolded, NOT ready)       │
│                                                                    │
│  @nodefony/llm        Unified provider — Claude · Gemini · Ollama  │
│  @nodefony/rag        Indexing · chunking · vector search           │
│  @nodefony/vector     pgvector · Qdrant · Chroma                    │
│  @nodefony/agent      Orchestrator + sub-agents                     │
│  @nodefony/mcp        Model Context Protocol — server + client      │
│  @nodefony/memory     Short-term + long-term memory                 │
│  @nodefony/agent-guard ⭐ AI Act compliance — PII · audit · voters  │
└────────────────────────────────────────────────────────────────────┘
```

---

## Design principles (the non-negotiables)

These are the figured-in-stone rules behind every decision in the codebase.

| Principle | Why |
|-----------|-----|
| **TypeScript strict, zero `any`, zero `@ts-ignore`** | The compiler is the first test suite. |
| **ESM only** (`import`/`export`, `node:` prefix) | Modern Node.js. CommonJS is dead. |
| **Named exports only** (`import { Nodefony } from "nodefony"`) | Better tree-shaking, better IDE support, no default-export ambiguity. |
| **Interfaces prefixed `I`** (`IKernel`, `IService`, `IUser`) | Industry-wide convention, immediate visual disambiguation. |
| **Native Node.js servers** (`node:http`, `node:http2`, `ws`) | No `Express`, no `Fastify`, no `Bun.serve`. Direct control over the request lifecycle. |
| **Rollup, `preserveModules: true`** | Per-module `.d.ts`, tree-shakeable consumers, idiomatic npm publishing. |
| **AsyncLocalStorage everywhere** | Zero context-leak across concurrent requests. The framework knows *which* user made *this* call without threading it through every function. |
| **HTTP stateless** (JWT cookies, no in-memory session) | Cloud-native: 1 pod = 1 process. Sessions in RAM break load-balancing. |
| **WebSocket stateful** (handshake JWT, ALS-scoped) | Real-time needs persistent state; isolated per-socket via ALS. |
| **Zero Trust by default** | A route with no security decorator returns `403` automatically. Public access must be explicit (`@Anonymous()`). |
| **1 process = 1 pod / container** | Scaling horizontally is delegated to the orchestrator (Kubernetes, Docker, Cloud Run, Nomad). |
| **Perf and memory matter on every request** | Lazy allocation, no silent listeners, no allocation "just in case". See [`CLAUDE.md`](./CLAUDE.md). |

---

## Security pipeline — Symfony × Spring × NestJS

The security layer (Phase 6, currently planned) combines three patterns from three frameworks:

- **From Symfony**: *Secured Areas* (firewalls) with declarative URL patterns and per-area authenticator chains.
- **From NestJS**: *TypeScript decorators* (`@IsGranted`, `@CurrentUser`, `@AuditLog`) read via `Reflect.metadata` at request time.
- **From Spring Security**: *3-level authorization* — role hierarchy, RBAC permissions, contextual Voters (`GRANT`/`DENY`/`ABSTAIN`).

```typescript
// config/security.ts
import { defineSecurityConfig } from '@nodefony/security';

export default defineSecurityConfig({
  encoders: { user: { type: 'bcrypt', rounds: 12 } },
  roleHierarchy: {
    ROLE_SUPER_ADMIN: ['ROLE_ADMIN'],
    ROLE_ADMIN:       ['ROLE_USER'],
  },
  areas: {
    public:   { pattern: '^/api/v1/public', security: false },
    main_api: { pattern: '^/api/v1/(?!admin)', stateless: true, authenticators: ['jwt'] },
    admin:    { pattern: '^/api/v1/admin', stateless: true, authenticators: ['mtls', 'jwt'] },
  },
});
```

```typescript
@Controller('/projects')
export class ProjectController extends NodefonyController {

  @Get('public-list')
  @Anonymous()                                  // explicit bypass — Zero Trust
  async list() { return this.svc.public(); }

  @Post()
  @HasAnyRole('ROLE_ADMIN', 'ROLE_DATA_OFFICER')
  @AuditLog({ action: 'PROJECT_CREATE', severity: 'INFO' })
  async create(@Body() dto: CreateProjectDto, @CurrentUser() user: IUser) {
    return this.svc.create(dto, user);
  }

  @Patch(':id')
  @IsGranted(ProjectVoter.EDIT, { subjectFromParam: 'id', voter: ProjectVoter })
  async update(@Param('id') id: string, @Body() data: any) {
    return this.svc.update(id, data);
  }
}
```

**Stack figured-in-stone (Phase 6):**
- JWT via [`jose`](https://github.com/panva/jose) (RFC 7519 + RFC 7515, EdDSA / RS256)
- OAuth 2.0 / OIDC via [`arctic`](https://github.com/pilcrowonpaper/arctic) — one config-driven authenticator for 50+ providers
- Passwords via `bcrypt` (rounds: 12 default)
- CSRF: `SameSite=Strict` + `Origin` check by default, `@CsrfProtect()` HMAC opt-in for critical routes
- `@nodefony/user` separate module (IUser + BcryptEncoder + UserService) → consumed by ORM, Studio, agents without pulling the security pipeline
- **Passport.js: abandoned.** Sessions in RAM: abandoned. LDAP: shipped as separate plugin.

---

## AI agent — long-term vision (Phase 12, NOT yet available)

> ⚠️ **This is a target API, not a shipped feature.** The AI platform modules
> (`@nodefony/llm`, `@nodefony/rag`, `@nodefony/vector`, `@nodefony/memory`,
> `@nodefony/agent`, `@nodefony/mcp`, `@nodefony/agent-guard`) are scaffolded but **not
> production-ready** — they are the **last migration phase (Phase 12)**, scheduled well after
> the framework core, security, ORM, and Studio are complete. The code below illustrates the
> intended developer experience; the interfaces and behaviour will change.

Nodefony's goal is to provide **generic, reusable AI modules** so the domain logic stays yours:

```typescript
// 1. Index your corpus (legal, financial, medical...)
@Module({ name: 'legal-corpus' })
export class LegalCorpusModule extends NodefonyModule {
  async boot(): Promise<void> {
    await this.rag.indexDirectory('./corpus/code-civil');
    await this.rag.indexDirectory('./corpus/jurisprudence');
  }
}

// 2. Create your agent (inject generic modules)
@Service({ singleton: true })
export class LegalAgent implements IAgent {
  constructor(
    @Inject('rag')    private rag: IRagService,
    @Inject('llm')    private llm: ILLMProvider,
    @Inject('memory') private mem: IMemoryService,
  ) {}

  async *stream(question: string): AsyncIterable<string> {
    const sources = await this.rag.search(question, { limit: 5 });
    yield* this.llm.stream(question, { context: sources });
  }
}

// 3. Stream answers in real-time via WebSocket
@Controller('/legal')
export class LegalController extends NodefonyController {
  constructor(@Inject('legal-agent') private agent: LegalAgent) { super(); }

  @WebSocketRoute('/ask')
  async ask(ctx: NodefonyContext): Promise<void> {
    for await (const token of this.agent.stream(ctx.request.message)) {
      ctx.send(token);
    }
  }
}
```

The same pattern is intended to fit wealth management, medical records, support agents, HR tools — only the corpus and the system prompt would change. **Again: this is the Phase 12 vision, not current functionality.**

---

## Cloud-native by design

Nodefony targets **1 Node process = 1 pod / container**. Scaling is delegated to the orchestrator (Kubernetes HPA, Docker, Nomad, Cloud Run, Fargate). PM2 is deprecated and will be removed.

Planned (Phase 16, after the security layer ships):

- Graceful shutdown on `SIGTERM` (HTTP + WS + ORM drain)
- `/nodefony/healthz` + `/nodefony/readyz` endpoints with an `IHealthCheck` registry per module
- Trusted-proxy parser (`X-Forwarded-For`/`X-Forwarded-Proto`) with security-side whitelist
- `ISecretProvider` abstraction (`EnvSecretProvider` default, `VaultSecretProvider` pluggable)
- Dockerfile (alpine + tini PID 1) + progressive `docker-compose.yml` with profiles
- Skills for `docker-debug` and `infra-up` to let Claude self-debug in containerised environments

---

## Tech stack — at a glance

| Layer | Choice | Why |
|-------|--------|-----|
| Language | **TypeScript strict** | First test suite. Zero `any`. |
| Modules | **ESM only** | `import { ... } from "node:fs"`, no CommonJS. |
| Servers | **`node:http` · `node:http2` · `ws`** | Native, no Express/Fastify/Bun.serve. |
| Bundler | **Rollup** (`preserveModules: true`) | Per-module `.d.ts`, tree-shakeable. |
| Toolchain | **`npm`** (workspaces + turbo) | Native by default. No Bun required for core/http/framework/security work. |
| Test runner | **`mocha` + `ts-node`** | Stable in CI. (One not-yet-ready AI module uses `bun test` internally — irrelevant until Phase 12.) |
| Container scope | **AsyncLocalStorage** (P1.4 ✅) | Per-request isolation everywhere. |
| JWT | **`jose`** | Modern TypeScript-first, EdDSA/RS256. |
| OAuth 2.0 / OIDC | **`arctic`** | Type-safe, by the author of Lucia. |
| Password hashing | **`bcrypt`** | Battle-tested. |
| Config validation | **`zod`** | Runtime + type-level, single source of truth. |
| SQL (primary) | **Drizzle** ⭐ | Modern SQL-builder, TypeScript-first. |
| SQL (alternative) | **MikroORM** | Data Mapper + Unit of Work for complex apps. |
| NoSQL | **Mongoose** | The MongoDB standard. |
| Frontend builder | **Vite** (Vue 3 · React 19 · Svelte 5 · Angular planned) | Per-module bundling, HMR. |

---

## Status — TypeScript migration in progress

The framework is being rewritten from scratch in TypeScript. The reference JavaScript implementation lives in [`nodefony/nodefony`](https://github.com/nodefony/nodefony) (cloned alongside this repo by the author).

### Per-package status

| Package | Description | Status |
|---------|-------------|--------|
| `@nodefony/core` | Kernel · DI Container · Module · Service · Syslog · CLI | 🔶 Migration TS (~67% core, fondations OK) |
| `@nodefony/http` | HTTP/1.1 · HTTPS · HTTP/2 · WS · WSS (native Node.js) | ✅ Stable (336 tests passing) |
| `@nodefony/framework` | Router · Resolver · Controller · decorators | ✅ Migrated |
| `@nodefony/user` | IUser · BaseUser · IPasswordEncoder · UserService | ⬜ Planned (Phase 5) |
| `@nodefony/security` | Firewall · SecuredArea · Authenticators · CSRF · CORS | ⬜ Planned (Phase 6) |
| `@nodefony/orm-core` | IOrm · IRepository · IEntity abstraction | ⬜ Planned (Phase 5) |
| `@nodefony/drizzle` ⭐ | Drizzle adapter (SQL primary) | ⬜ Planned (Phase 7) |
| `@nodefony/mikroorm` | MikroORM adapter (SQL alternative) | ⬜ Planned (Phase 7) |
| `@nodefony/mongoose` | MongoDB adapter | 🔶 Legacy port |
| `@nodefony/sequelize` | 🪦 Sequelize v6 (legacy maintenance only) | 🔶 Legacy port |
| `@nodefony/redis` | Cache · session storage · cluster | 🔶 Legacy port |
| `@nodefony/realtime` | TCP/UDP/Unix sockets + JSON-RPC 2.0 hub | ⬜ Planned (Phase 13) |
| `@nodefony/frontend` | Vite supervisor (Vue · React · Svelte) | 🔶 In progress (multi-bundle ✅) |
| `@nodefony/studio` | Admin web UI at `/nodefony/*` | 🔶 Scaffold + Logs panel ✅ |
| `@nodefony/llm` | Multi-provider — Claude · Gemini · Ollama · OpenAI | ⬜ Not ready — Phase 12 (last) |
| `@nodefony/rag` | RAG pipeline | ⬜ Not ready — Phase 12 (last) |
| `@nodefony/vector` | pgvector · Qdrant · Chroma | ⬜ Not ready — Phase 12 (last) |
| `@nodefony/memory` | Agent memory (short + long term) | ⬜ Not ready — Phase 12 (last) |
| `@nodefony/agent` | Orchestrator + sub-agents | ⬜ Not ready — Phase 12 (last) |
| `@nodefony/mcp` | Model Context Protocol — server + client | ⬜ Not ready — Phase 12 (last) |
| `@nodefony/agent-guard` | ⭐ AI Act compliance — PII · audit · voters | ⬜ Not ready — Phase 12 (last) |

> The AI modules above are **scaffolded placeholders**. They will be migrated **last**, after core / security / ORM / Studio. Do not rely on them yet.

> ✅ Stable · 🔶 In migration / partial · ⬜ Planned · 🪦 Legacy maintenance

### Roadmap (high-level)

| Phase | Theme | State |
|-------|-------|-------|
| **0** | Build system (Rollup + TS strict + ESM + per-module types) | ✅ Done |
| **1** | Kernel · DI · Module · AsyncLocalStorage · Context lifecycle hooks | ✅ Done (`P1.1` → `P1.8`) |
| **2** | Context lifecycle (tear-down, abort, timeout, idempotency) | ⬜ Planned |
| **3** | Structured logs (audit, NCSA, per-requestId filtering) | ⬜ Planned |
| **4** | Symbiose tests HTTP↔framework | 🔶 Partial |
| **5** | Session refactor + User module + ORM Core abstraction | ⬜ Planned |
| **6** | Security — firewall, authenticators, decorators, voters, CSRF | ⬜ Planned (blocked by ALS bugs, see [BUG_REPORT.md](./BUG_REPORT.md)) |
| **7** | ORM drivers (Drizzle, MikroORM, Mongoose, Sequelize legacy) | ⬜ Planned |
| **8** | CLI generators · monitoring (DebugBar, metrics) | ⬜ Planned |
| **9** | Polish · public READMEs · dependency audit | ⬜ Planned |
| **10** | `@nodefony/studio` — admin web UI | 🔶 Scaffold + Logs panel |
| **11** | CLI command tests · per-module commands | ⬜ Planned |
| **12** | AI agentic platform (llm/rag/vector/memory + agent + MCP + agent-guard) — **LAST phase, scaffolded only** | ⬜ Not ready |
| **13** | Realtime distributed (TCP/UDP/Unix + Redis/Kafka hubs + JSON-RPC 2.0) | ⬜ Planned |
| **14** | `@nodefony/frontend` (Vite supervisor) + isomorphic core | 🔶 In progress |
| **16** | Cloud-native (graceful SIGTERM, healthz/readyz, Secret abstraction, Docker, k8s manifests) | ⬜ Planned |

The full live roadmap (per-task breakdown, dependencies, effort estimates, decisions) lives in [MIGRATION_STATUS.md](./MIGRATION_STATUS.md).

---

## Working in this repo

This repository has a **dual nature**:

1. The **framework** lives under `src/nodefony/` (workspace `@nodefony/core`) and `src/packages/@nodefony/*` (sibling packages).
2. The **root** of the repo (`./`) acts as a **consumer application** that uses the framework — it's how the author tests the framework in real conditions (a self-hosted test bed).

This means when you run `nodefony development` from the repo root, you're starting an application that *consumes* the framework you're developing. Live reload is wired through Rollup watch on the framework packages.

### Requirements

| Tool | Version | Role |
|------|---------|------|
| **Node.js** | >= 22 | Runtime — all servers, AsyncLocalStorage native |
| **npm** | >= 10 | Workspace manager (workspaces + turbo) |
| **OpenSSL** | any | HTTPS/WSS self-signed certificates |
| **git** | any | Version control |

### Setup

```bash
git clone https://github.com/nodefony/nodefony-core
cd nodefony-core
git checkout claude-ts
npm install
npm run build
npm run test            # runs unit + integration test suites
npx nodefony development   # boots the self-hosted test app
```

### Local URLs after `nodefony development`

| URL | Description |
|-----|-------------|
| `http://localhost:5151` | HTTP/1.1 — your app |
| `https://localhost:5152` | HTTPS / HTTP/2 — your app |
| `ws://localhost:5151` | WebSocket (non-TLS) |
| `wss://localhost:5152` | WebSocket Secure (TLS) |
| `http://localhost:5151/nodefony/*` | Admin web UI (`@nodefony/studio`, in progress) |

Self-signed certificates are generated on first run under `config/certificates/`. Add the generated CA to your browser to trust local HTTPS / WSS:

```
config/certificates/ca/nodefony-root-ca.crt.pem
```

### CLI overview

```bash
npx nodefony development     # dev server (foreground)
npx nodefony build           # build all workspaces (Rollup)
npx nodefony test            # run all test suites
npx nodefony certificates    # generate / renew SSL certificates
# ... see `src/nodefony/src/kernel/commands/` for the full set
```

> Project commands (`nodefony create`, `nodefony generate:module`, etc.) are part of Phase 8/11 and are not stabilised yet on the `claude-ts` migration branch.

---

## Documentation

- **[CLAUDE.md](./CLAUDE.md)** — architectural rules, conventions, design decisions. Required reading before contributing.
- **[MIGRATION_STATUS.md](./MIGRATION_STATUS.md)** — live roadmap, per-task progress, dependency graph.
- **[BUG_REPORT.md](./BUG_REPORT.md)** — known structural bugs awaiting fixes.
- Per-module `CLAUDE.md` and `MEMORY.md` under each `src/packages/@nodefony/*/` — internals, gotchas, public API.
- `docs/architecture/` — architectural deep-dives (when stabilised).

---

## Contributing

Nodefony is open source under the CeCILL-B license (compatible with LGPL).
Contributions, issues, and pull requests are welcome — but be aware the framework is in active rewrite. The `claude-ts` branch is the active line of development; PRs against `main` are unlikely to land until Phase 6 (security) is complete.

If you want to discuss the architecture, open a discussion on GitHub before sending a large PR.

---

## References

- [Node.js](https://nodejs.org/) · [TypeScript](https://www.typescriptlang.org/) · [Rollup](https://rollupjs.org/)
- [Symfony Security](https://symfony.com/doc/current/security.html) — Secured Areas, Voters, role hierarchy
- [Spring Security](https://spring.io/projects/spring-security) — `@PreAuthorize`, expression-based authorization
- [NestJS](https://docs.nestjs.com/) — decorator-driven architecture (`@Controller`, `@Module`, guards)
- [jose](https://github.com/panva/jose) · [arctic](https://github.com/pilcrowonpaper/arctic) · [zod](https://zod.dev/)
- [Drizzle ORM](https://orm.drizzle.team/) · [MikroORM](https://mikro-orm.io/)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [EU AI Act](https://artificialintelligenceact.eu/) — drives `@nodefony/agent-guard` design

---

## Author

**Christophe CAMENSULI** — [github/ccamensuli](https://github.com/ccamensuli)

Built solo, for everyone. Free and open source.

---

## License

[CeCILL-B](http://www.cecill.info/licences/Licence_CeCILL-B_V1-en.html) — French free software license, compatible with LGPL.
