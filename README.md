# NODEFONY

<div align="center">

**Full-stack TypeScript framework for real-time applications and AI agents**

_HTTP and WebSocket as first-class citizens — one controller, one context, one codebase._

[![License: CeCILL-B](https://img.shields.io/badge/License-CeCILL--B-blue.svg?style=flat-square)](http://www.cecill.info/licences/Licence_CeCILL-B_V1-en.html)
[![Version](https://img.shields.io/badge/version-10.0.0--alpha-blueviolet?style=flat-square)](./package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue?style=flat-square)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-green?style=flat-square)](https://nodejs.org/)
[![ESM only](https://img.shields.io/badge/ESM-only-orange?style=flat-square)](https://nodejs.org/api/esm.html)
[![Status](https://img.shields.io/badge/migration-~42%25-yellow?style=flat-square)](./MIGRATION_STATUS.md)

</div>

---

## Table of contents

- [The story so far](#the-story-so-far)
- [What is Nodefony?](#what-is-nodefony)
- [Why it matters](#why-it-matters)
- [Architecture](#architecture)
- [Design principles](#design-principles-the-non-negotiables)
- [Security pipeline](#security-pipeline--symfony--spring--nestjs)
- [The AI vision](#the-ai-vision--phase-12-not-yet-available)
- [Cloud-native by design](#cloud-native-by-design)
- [Tech stack](#tech-stack--at-a-glance)
- [Where we are](#where-we-are--migration-status)
- [Direction](#direction--the-road-ahead)
- [Working in this repo](#working-in-this-repo)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

---

## The story so far

Nodefony did not start in 2023. It started in **2017** as a full-stack **JavaScript**
framework, born from a simple conviction: the Node.js ecosystem had powerful building
blocks but no opinionated, batteries-included structure comparable to **Symfony** in
the PHP world — a real kernel, a dependency-injection container, modules, a security
firewall, a logging system, a CLI.

Over roughly six years, that JavaScript framework matured to **version 7** (still living
at [`nodefony/nodefony`](https://github.com/nodefony/nodefony)). It accumulated a complete
runtime: HTTP/HTTP2 servers, native WebSocket, sessions, an ORM layer, a frontend builder,
a process supervisor, a monitoring bundle. It worked — but it carried the weight of its era:
CommonJS, loose typing, runtime surprises that a compiler should have caught.

In **December 2023**, the rewrite began. Not a port — a **ground-up reconstruction** in
**strict TypeScript**, ESM-only, decorator-driven, designed for the cloud-native world that
did not exist when Nodefony was first written. This repository (`nodefony-core`) is that
reconstruction, targeting **version 10**.

Two things changed along the way:

1. **The bar moved up.** Strict TypeScript with zero `any`, native ESM, per-module typed
   builds, AsyncLocalStorage-based request scoping, and a security model that returns `403`
   by default. The compiler is now the first test suite.

2. **A second pillar appeared.** What began as a real-time web framework is now also a
   foundation for **AI agents** — RAG pipelines, sub-agent orchestration, MCP servers,
   memory, and AI-Act-aware guardrails — built as the _same_ composable modules, served
   over the _same_ unified controller pipeline.

> **Today (2026):** the TypeScript rewrite is roughly **42% complete**. The runtime core,
> HTTP stack, framework layer, ORM abstraction, user module, and frontend builder are
> substantially in place; the Studio admin UI is live; the security layer is next; the AI
> platform is the final phase. The live, per-task picture is in
> [MIGRATION_STATUS.md](./MIGRATION_STATUS.md).

---

## What is Nodefony?

Nodefony is a **Node.js framework** for building, in the same codebase and with the same
decorator-driven model:

1. **Real-time web applications** — HTTP and WebSocket sharing a unified controller context.
2. **AI agents** — RAG pipelines, sub-agent orchestration, MCP servers, all as composable modules.

It is heavily inspired by **Symfony** (DI container, modules, kernel, firewall with secured
areas) and **NestJS** (TypeScript decorators), with one decisive differentiator:
**HTTP and WebSocket are co-citizens**, not bolted on. The same controller method can serve
both transports with the same session, the same authentication, the same routing.

```typescript
@Controller("/data")
export class DataController extends NodefonyController {
  @Route("/") // GET /data
  @WebSocketRoute("/stream") // WS  /data/stream
  async dataAction(ctx: NodefonyContext): Promise<void> {
    const data = await this.dataService.get();
    ctx.isWebSocket() ? ctx.send(JSON.stringify(data)) : ctx.json(data);
  }
}
```

No separate gateway. No duplicated logic. Two transports, one action.

---

## Why it matters

Most Node.js frameworks treat WebSocket as an afterthought: a separate middleware stack, a
separate authentication path, a separate routing layer. As soon as your app needs live
updates — a chat, a streaming AI agent, a collaborative editor, a vocal interface — you end
up gluing two parallel codebases together.

Nodefony was rebuilt on the assumption that **modern applications are real-time by default**.
The pipeline below applies to every request — HTTP REST, WebSocket frame, JSON-RPC message —
without the developer having to think about the transport:

```
[ Request HTTP / WS frame ]
         │
         ▼
┌────────────────────────────────────────────────────┐
│ 1. Kernel scoping (AsyncLocalStorage)              │  ← per-request context
│    requestId · user · traceparent · scheme         │
└────────────────┬───────────────────────────────────┘
                 ▼
┌────────────────────────────────────────────────────┐
│ 2. Firewall (secured areas)                        │  ← Symfony-style zones
│    Authenticator chain · WAF cooperation · CSRF    │
└────────────────┬───────────────────────────────────┘
                 ▼
┌────────────────────────────────────────────────────┐
│ 3. Controller + decorators                         │  ← Spring-style guards
│    @IsGranted · @CurrentUser · @AuditLog · ...     │
│    3-level authorization: hierarchy · RBAC · Voters│
└────────────────┬───────────────────────────────────┘
                 ▼
┌────────────────────────────────────────────────────┐
│ 4. Action — your business logic                    │
└────────────────────────────────────────────────────┘
```

---

## Architecture

The framework is split into composable workspaces. Each package is independently versioned,
with strict TypeScript types generated per module (Rollup `preserveModules`).

```
┌────────────────────────────────────────────────────────────────────┐
│                          your application                           │
│              modules · controllers · services · entities           │
└─────────────────────────────────┬──────────────────────────────────┘
                                  │ (DI container, decorators)
┌─────────────────────────────────▼──────────────────────────────────┐
│                         nodefony runtime                            │
│                                                                    │
│  nodefony (core)      Kernel · DI · Module · Service · Syslog · CLI │
│  @nodefony/http       HTTP/HTTPS/HTTP2/WS/WSS servers + Context     │
│  @nodefony/framework  Router · Resolver · Controller · decorators   │
│  @nodefony/user       IUser · BaseUser · IPasswordEncoder · service │
│  @nodefony/security   Firewall · SecuredArea · Authenticators (P6)  │
│  @nodefony/frontend   Vite supervisor (React 19 · Vue 3 · Angular)  │
│  @nodefony/studio     Admin web UI — routes under /nodefony/*       │
└─────────────────────────────────┬──────────────────────────────────┘
                                  │
┌─────────────────────────────────▼──────────────────────────────────┐
│              data layer (optional, multi-driver)                    │
│                                                                    │
│  @nodefony/orm-core   IOrm · IRepository · IEntity (abstraction)    │
│  @nodefony/drizzle    ⭐ Drizzle ORM — SQL-builder, TS-first (default)│
│  @nodefony/mongoose   Mongoose — MongoDB                            │
│  @nodefony/redis      Cluster · pub/sub · session storage           │
└─────────────────────────────────┬──────────────────────────────────┘
                                  │
┌─────────────────────────────────▼──────────────────────────────────┐
│         AI platform (Phase 12 — LAST, scaffolded, NOT ready)        │
│                                                                    │
│  @nodefony/llm        Unified provider — Claude · Gemini · Ollama   │
│  @nodefony/rag        Indexing · chunking · vector search          │
│  @nodefony/vector     pgvector · Qdrant · Chroma                    │
│  @nodefony/agent      Orchestrator + sub-agents                     │
│  @nodefony/mcp        Model Context Protocol — server + client      │
│  @nodefony/memory     Short-term + long-term memory                 │
│  @nodefony/agent-guard ⭐ AI-Act compliance — PII · audit · voters  │
└────────────────────────────────────────────────────────────────────┘
```

> The framework is **self-hosted**: the root of this repository is itself a consumer
> application that exercises the framework in real conditions. See
> [Working in this repo](#working-in-this-repo).

---

## Design principles (the non-negotiables)

These are the rules behind every decision in the codebase.

| Principle                                                      | Why                                                                                                                                           |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **TypeScript strict, zero `any`, zero `@ts-ignore`**           | The compiler is the first test suite.                                                                                                         |
| **ESM only** (`import`/`export`, `node:` prefix)               | Modern Node.js. CommonJS is gone.                                                                                                             |
| **Named exports only** (`import { Nodefony } from "nodefony"`) | Better tree-shaking, better IDE support, no default-export ambiguity.                                                                         |
| **Interfaces prefixed `I`** (`IKernel`, `IService`, `IUser`)   | Immediate visual disambiguation.                                                                                                              |
| **Native Node.js servers** (`node:http` · `node:http2` · `ws`) | No Express, no Fastify, no `Bun.serve`. Direct control over the request lifecycle.                                                            |
| **Rollup, `preserveModules: true`**                            | Per-module `.d.ts`, tree-shakeable consumers, idiomatic npm publishing.                                                                       |
| **AsyncLocalStorage everywhere**                               | Zero context leak across concurrent requests — the framework knows _which_ user made _this_ call without threading it through every function. |
| **HTTP stateless** (JWT cookies, no in-memory session)         | Cloud-native: 1 pod = 1 process. Sessions in RAM break load balancing.                                                                        |
| **WebSocket stateful** (handshake JWT, ALS-scoped)             | Real-time needs persistent state, isolated per socket via ALS.                                                                                |
| **Zero Trust by default**                                      | A route with no security decorator returns `403`. Public access must be explicit (`@Anonymous()`).                                            |
| **1 process = 1 pod / container**                              | Horizontal scaling is delegated to the orchestrator (Kubernetes, Docker, Cloud Run, Nomad).                                                   |
| **Perf and memory matter on every request**                    | Lazy allocation, no silent listeners, no allocation "just in case". See [`CLAUDE.md`](./CLAUDE.md).                                           |

---

## Security pipeline — Symfony × Spring × NestJS

The security layer (Phase 6 — design frozen, implementation in progress) combines three
patterns from three frameworks:

- **From Symfony** — _secured areas_ (firewalls) with declarative URL patterns and per-area authenticator chains.
- **From NestJS** — _TypeScript decorators_ (`@IsGranted`, `@CurrentUser`, `@AuditLog`) read via `Reflect.metadata` at request time.
- **From Spring Security** — _3-level authorization_: role hierarchy, RBAC permissions, contextual Voters (`GRANT` / `DENY` / `ABSTAIN`).

```typescript
// config/security.ts
import { defineSecurityConfig } from "@nodefony/security";

export default defineSecurityConfig({
  encoders: { user: { type: "bcrypt", rounds: 12 } },
  roleHierarchy: {
    ROLE_SUPER_ADMIN: ["ROLE_ADMIN"],
    ROLE_ADMIN: ["ROLE_USER"],
  },
  areas: {
    public: { pattern: "^/api/v1/public", security: false },
    main_api: {
      pattern: "^/api/v1/(?!admin)",
      stateless: true,
      authenticators: ["jwt"],
    },
    admin: {
      pattern: "^/api/v1/admin",
      stateless: true,
      authenticators: ["mtls", "jwt"],
    },
  },
});
```

```typescript
@Controller("/projects")
export class ProjectController extends NodefonyController {
  @Get("public-list")
  @Anonymous() // explicit bypass — Zero Trust
  async list() {
    return this.svc.public();
  }

  @Post()
  @HasAnyRole("ROLE_ADMIN", "ROLE_DATA_OFFICER")
  @AuditLog({ action: "PROJECT_CREATE", severity: "INFO" })
  async create(@Body() dto: CreateProjectDto, @CurrentUser() user: IUser) {
    return this.svc.create(dto, user);
  }

  @Patch(":id")
  @IsGranted(ProjectVoter.EDIT, { subjectFromParam: "id", voter: ProjectVoter })
  async update(@Param("id") id: string, @Body() data: UpdateProjectDto) {
    return this.svc.update(id, data);
  }
}
```

**Stack frozen for Phase 6:**

- JWT via [`jose`](https://github.com/panva/jose) (RFC 7519 + RFC 7515, EdDSA / RS256)
- OAuth 2.0 / OIDC via [`arctic`](https://github.com/pilcrowonpaper/arctic) — one config-driven authenticator for 50+ providers
- Passwords via `bcrypt` (12 rounds default), shipped today in `@nodefony/user`
- CSRF: `SameSite=Strict` + `Origin` check by default; `@CsrfProtect()` HMAC opt-in for critical routes
- `@nodefony/user` is a **separate** module (IUser + BcryptEncoder + UserService) consumed by ORM, Studio, and agents without pulling in the full security pipeline
- **Passport.js: abandoned. In-memory sessions: abandoned. LDAP: shipped as a separate plugin.**

> Note: the per-request scoping bugs that historically blocked this phase (ALS propagation
> across WS messages and post-response hooks) are **resolved** — see [`BUG_REPORT.md`](./BUG_REPORT.md).

---

## The AI vision — Phase 12 (NOT yet available)

> ⚠️ **This is a target API, not a shipped feature.** The AI platform modules
> (`@nodefony/llm`, `@nodefony/rag`, `@nodefony/vector`, `@nodefony/memory`,
> `@nodefony/agent`, `@nodefony/mcp`, `@nodefony/agent-guard`) are **scaffolded placeholders**.
> They are the **last migration phase**, scheduled after the core, security, ORM, and Studio
> are complete. The code below illustrates the intended developer experience; the interfaces
> will change.

The goal is to provide **generic, reusable AI modules** so the domain logic stays yours:

```typescript
// 1. Index your corpus (legal, financial, medical...)
@Module({ name: "legal-corpus" })
export class LegalCorpusModule extends NodefonyModule {
  async boot(): Promise<void> {
    await this.rag.indexDirectory("./corpus/code-civil");
    await this.rag.indexDirectory("./corpus/jurisprudence");
  }
}

// 2. Create your agent (inject generic modules)
@Service({ singleton: true })
export class LegalAgent implements IAgent {
  constructor(
    @Inject("rag") private rag: IRagService,
    @Inject("llm") private llm: ILLMProvider,
    @Inject("memory") private mem: IMemoryService,
  ) {}

  async *stream(question: string): AsyncIterable<string> {
    const sources = await this.rag.search(question, { limit: 5 });
    yield* this.llm.stream(question, { context: sources });
  }
}

// 3. Stream answers in real time over WebSocket
@Controller("/legal")
export class LegalController extends NodefonyController {
  constructor(@Inject("legal-agent") private agent: LegalAgent) {
    super();
  }

  @WebSocketRoute("/ask")
  async ask(ctx: NodefonyContext): Promise<void> {
    for await (const token of this.agent.stream(ctx.request.message)) {
      ctx.send(token);
    }
  }
}
```

The same pattern is intended to fit wealth management, medical records, support agents, HR
tools — only the corpus and the system prompt change. **Again: this is the Phase 12 vision,
not current functionality.**

---

## Cloud-native by design

Nodefony targets **1 Node process = 1 pod / container**. Scaling is delegated to the
orchestrator (Kubernetes HPA, Docker, Nomad, Cloud Run, Fargate). PM2 is **deprecated** and
will be removed in Phase 16; the cloud-native production boot (`nodefony production --no-daemon`,
foreground, logs to stdout) is already the path used in CI.

Planned (Phase 16, after the security layer ships):

- Graceful shutdown on `SIGTERM` (HTTP + WS + ORM drain)
- `/nodefony/healthz` + `/nodefony/readyz` endpoints with an `IHealthCheck` registry per module
- Trusted-proxy parser (`X-Forwarded-For` / `X-Forwarded-Proto`) with a security-side allow-list
- `ISecretProvider` abstraction (`EnvSecretProvider` default, `VaultSecretProvider` pluggable)
- Dockerfile (alpine + tini as PID 1) + progressive `docker-compose.yml` with profiles

---

## Tech stack — at a glance

| Layer             | Choice                                   | Why                                                                                                 |
| ----------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Language          | **TypeScript strict**                    | First test suite. Zero `any`.                                                                       |
| Modules           | **ESM only**                             | `import { ... } from "node:fs"`, no CommonJS.                                                       |
| Servers           | **`node:http` · `node:http2` · `ws`**    | Native, no Express/Fastify/Bun.serve.                                                               |
| Bundler           | **Rollup** (`preserveModules: true`)     | Per-module `.d.ts`, tree-shakeable.                                                                 |
| Toolchain         | **`npm`** workspaces + **turbo**         | Native by default.                                                                                  |
| Test runner       | **`mocha` + `tsx`**                      | Stable in CI. (One not-yet-ready AI module uses `bun test` internally — irrelevant until Phase 12.) |
| Request scope     | **AsyncLocalStorage**                    | Per-request isolation everywhere.                                                                   |
| JWT               | **`jose`**                               | Modern, TypeScript-first, EdDSA/RS256.                                                              |
| OAuth 2.0 / OIDC  | **`arctic`**                             | Type-safe, by the author of Lucia.                                                                  |
| Password hashing  | **`bcrypt`**                             | Battle-tested.                                                                                      |
| Config validation | **`zod`**                                | Runtime + type-level, single source of truth.                                                       |
| SQL (default)     | **Drizzle** ⭐                           | Modern SQL-builder, TypeScript-first.                                                               |
| NoSQL             | **Mongoose**                             | The MongoDB standard.                                                                               |
| Frontend builder  | **Vite** (React 19 · Vue 3 · Angular 21) | Per-module bundling, HMR.                                                                           |

---

## Where we are — migration status

The framework is being rewritten from scratch in TypeScript. The reference JavaScript
implementation lives in [`nodefony/nodefony`](https://github.com/nodefony/nodefony).

**Overall: ~42% of the migration roadmap complete** (45 tasks done, 27 in progress, 68 planned).

### Per-package status

| Package                                                                         | Description                                                                            | Status                               |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------ |
| `nodefony` (core)                                                               | Kernel · DI · Module · Service · Syslog · CLI · ALS scoping                            | 🔶 In migration — foundations stable |
| `@nodefony/http`                                                                | HTTP/1.1 · HTTPS · HTTP/2 · WS · WSS (native Node.js)                                  | ✅ Stable — memory-tested            |
| `@nodefony/framework`                                                           | Router · Resolver · Controller · decorators                                            | ✅ Migrated                          |
| `@nodefony/orm-core`                                                            | IOrm · IRepository · IEntity · `AbstractCrudService`                                   | ✅ Abstraction done                  |
| `@nodefony/drizzle` ⭐                                                          | Drizzle adapter — default SQL driver                                                   | ✅ Done                              |
| `@nodefony/mongoose`                                                            | MongoDB adapter                                                                        | 🔶 Partial (Docker-gated)            |
| `@nodefony/redis`                                                               | Cache · session storage · cluster                                                      | 🔶 Legacy port (Docker-gated)        |
| `@nodefony/user`                                                                | IUser · BaseUser · BcryptEncoder · UserService (Drizzle-backed)                        | ✅ Done                              |
| `@nodefony/security`                                                            | Firewall · SecuredArea · Authenticators · CSRF · CORS                                  | 🔶 Design frozen — next              |
| `@nodefony/frontend`                                                            | Vite supervisor (React 19 · Vue 3 · Angular 21), multi-bundle, HMR                     | 🔶 In progress                       |
| `@nodefony/studio`                                                              | Admin web UI at `/nodefony/*` — dashboards, routes, ORM ERD, docs, realtime, debug bar | 🔶 In progress                       |
| `@nodefony/llm` · `rag` · `vector` · `memory` · `agent` · `mcp` · `agent-guard` | AI agentic platform                                                                    | ⬜ Phase 12 (last) — scaffolded only |

> ✅ Stable · 🔶 In migration / partial · ⬜ Planned
>
> The AI modules are **scaffolded placeholders** — migrated **last**, after core / security
> / ORM / Studio. Do not rely on them yet.

---

## Direction — the road ahead

| Phase  | Theme                                                                                  | State                            |
| ------ | -------------------------------------------------------------------------------------- | -------------------------------- |
| **0**  | Build system (Rollup + TS strict + ESM + per-module types)                             | ✅ Done                          |
| **1**  | Kernel · DI · Module · AsyncLocalStorage · Context lifecycle hooks                     | ✅ Done                          |
| **5**  | Session refactor · `@nodefony/user` · ORM Core abstraction · `AbstractCrudService`     | ✅ Mostly done                   |
| **6**  | Security — firewall, authenticators, decorators, voters, CSRF                          | 🔶 **Next** (unblocked)          |
| **7**  | ORM drivers (Drizzle ✅ · Mongoose partial)                                            | 🔶 In progress                   |
| **10** | `@nodefony/studio` — admin web UI                                                      | 🔶 Substantial (live dashboards) |
| **11** | CLI command tests · per-module commands                                                | ⬜ Planned                       |
| **13** | Realtime distributed (TCP/UDP/Unix + Redis/Kafka hubs + JSON-RPC 2.0 + browser client) | ⬜ Planned (after P6)            |
| **14** | `@nodefony/frontend` (Vite supervisor) + isomorphic core                               | 🔶 In progress                   |
| **12** | AI agentic platform (llm/rag/vector/memory + agent + MCP + agent-guard)                | ⬜ **Last** — scaffolded only    |
| **16** | Cloud-native (graceful SIGTERM, healthz/readyz, Secret abstraction, Docker, k8s)       | ⬜ Planned                       |

The full live roadmap — per-task breakdown, dependencies, effort estimates, decisions — lives
in [MIGRATION_STATUS.md](./MIGRATION_STATUS.md).

**Near-term focus:** ship the security layer (P6), finish the ORM drivers (P7), then bring the
real-time distribution layer (P13) and the Studio admin UI to completion. The AI platform
comes last, once the foundation it depends on is solid.

---

## Working in this repo

This repository has a **dual nature**:

1. The **framework** lives under `src/nodefony/` (workspace `nodefony` / core) and
   `src/packages/@nodefony/*` (sibling packages).
2. The **root** (`./`) acts as a **consumer application** that uses the framework — it is how
   the author tests the framework in real conditions (a self-hosted test bed).

Running `nodefony development` from the repo root starts an application that _consumes_ the
framework you are developing. In development mode a **supervisor** watches the framework
sources and restarts the server on change (frontend changes go through Vite HMR, no restart).

### Requirements

| Tool        | Version | Role                                            |
| ----------- | ------- | ----------------------------------------------- |
| **Node.js** | >= 22   | Runtime — all servers, native AsyncLocalStorage |
| **npm**     | >= 10   | Workspace manager (workspaces + turbo)          |
| **OpenSSL** | any     | HTTPS/WSS self-signed certificates              |
| **git**     | any     | Version control                                 |

### Setup

```bash
git clone https://github.com/nodefony/nodefony-core
cd nodefony-core
git checkout claude-ts        # active development line
npm install
npm run build                 # build all workspaces (Rollup + turbo)
npm run test                  # unit + integration suites
npx nodefony development      # boot the self-hosted test app
```

### Local URLs after `nodefony development`

| URL                                | Description                                    |
| ---------------------------------- | ---------------------------------------------- |
| `http://localhost:5151`            | HTTP/1.1 — your app                            |
| `https://localhost:5152`           | HTTPS / HTTP/2 — your app                      |
| `ws://localhost:5151`              | WebSocket (non-TLS)                            |
| `wss://localhost:5152`             | WebSocket Secure (TLS)                         |
| `http://localhost:5151/nodefony/*` | Admin web UI (`@nodefony/studio`, in progress) |

Self-signed certificates are generated on first run under `config/certificates/`. Add the
generated CA to your browser to trust local HTTPS / WSS:

```
config/certificates/ca/nodefony-root-ca.crt.pem
```

### CLI overview

```bash
npx nodefony development            # dev server with auto-restart supervisor
npx nodefony build                  # build all workspaces (Rollup)
npx nodefony production --no-daemon # cloud-native foreground boot (no PM2)
npx nodefony --help                 # full command set
```

> Per-module scaffolding commands (`module:create`, etc.) are part of Phase 8/11 and are not
> stabilised yet on the migration branch.

---

## Documentation

- **[CLAUDE.md](./CLAUDE.md)** — architectural rules, conventions, design decisions. Required reading before contributing.
- **[MIGRATION_STATUS.md](./MIGRATION_STATUS.md)** — live roadmap, per-task progress, dependency graph.
- **[BUG_REPORT.md](./BUG_REPORT.md)** — known structural issues and their resolution status.
- Per-module `CLAUDE.md` / `MEMORY.md` under each `src/packages/@nodefony/*/` — internals, gotchas, public API.
- Per-module `docs/` (e.g. `src/nodefony/docs/`) — architectural deep-dives, colocated and surfaced in Studio (ADR-0001). Cross-module guides and audits live under the root `docs/`.

---

## Contributing

Nodefony is open source under the **CeCILL-B** license (compatible with LGPL).
Contributions, issues, and pull requests are welcome — but be aware the framework is in active
rewrite. The `claude-ts` branch is the active line of development; `main` mirrors the latest
integrated state. For anything substantial, open a GitHub discussion about the architecture
before sending a large PR.

---

## References

- [Node.js](https://nodejs.org/) · [TypeScript](https://www.typescriptlang.org/) · [Rollup](https://rollupjs.org/)
- [Symfony Security](https://symfony.com/doc/current/security.html) — secured areas, voters, role hierarchy
- [Spring Security](https://spring.io/projects/spring-security) — `@PreAuthorize`, expression-based authorization
- [NestJS](https://docs.nestjs.com/) — decorator-driven architecture
- [jose](https://github.com/panva/jose) · [arctic](https://github.com/pilcrowonpaper/arctic) · [zod](https://zod.dev/)
- [Drizzle ORM](https://orm.drizzle.team/)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [EU AI Act](https://artificialintelligenceact.eu/) — drives the `@nodefony/agent-guard` design

---

## Author

**Christophe CAMENSULI** — [github.com/ccamensuli](https://github.com/ccamensuli)

Building Nodefony since 2017. Solo, for everyone. Free and open source.

---

## License

[CeCILL-B](http://www.cecill.info/licences/Licence_CeCILL-B_V1-en.html) — French free software
license, compatible with LGPL.
