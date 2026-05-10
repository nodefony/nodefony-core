# NODEFONY

<div align="center">

**Node.js Agentic Framework**

*Build real-time applications and AI agents with TypeScript*

[![npm version](https://img.shields.io/npm/v/nodefony-core?style=flat-square)](https://www.npmjs.com/package/nodefony-core)
[![License: CeCILL-B](https://img.shields.io/badge/License-CeCILL--B-blue.svg?style=flat-square)](http://www.cecill.info/licences/Licence_CeCILL-B_V1-en.html)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?style=flat-square)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green?style=flat-square)](https://nodejs.org/)
[![Bun](https://img.shields.io/badge/Bun-%3E%3D1.2-black?style=flat-square)](https://bun.sh/)
[![Build Status](https://github.com/nodefony/nodefony-core/workflows/nodefony/badge.svg)](https://github.com/nodefony/nodefony-core/actions)

</div>

---

## What is Nodefony?

Nodefony is a **Node.js framework for building real-time applications and AI agents**.

**HTTP and WebSocket are first-class citizens** in the same controller context — no separate gateway, no bolt-on real-time. One framework, one unified context, one codebase.

Built for developers who need to ship fast: a legal research agent, a wealth management assistant, a live collaboration tool — all on the same generic, reusable TypeScript modules.

```bash
npx nodefony create my-project
cd my-project
nodefony dev
# → http://localhost:5151         your app
# → http://localhost:5151/nodefony  AI dev agent
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     your modules                        │
│   @Module   @Controller   @Service   @Route   @WS       │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│                  nodefony runtime                       │
│                                                         │
│  Kernel · DI Container · Router · Security · ORM        │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │            unified context                       │   │
│  │   HTTP/1.1 · HTTPS · HTTP/2 · WS · WSS          │   │
│  │   same controller · same session · same routing  │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  Rollup (build) · Bun (toolchain) · Node.js (servers)  │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│               ai platform  (optional modules)           │
│                                                         │
│  @nodefony/llm    → Claude · Gemini · Ollama · OpenAI   │
│  @nodefony/rag    → PDF ingestion · vector search       │
│  @nodefony/agent  → orchestrator · sub-agents           │
│  @nodefony/mcp    → MCP server + client                 │
│  @nodefony/memory → short-term · long-term              │
│  @nodefony/studio → AI dev dashboard (/nodefony)        │
└─────────────────────────────────────────────────────────┘
```

---

## Why Nodefony?

| | Other frameworks | Nodefony |
|---|---|---|
| HTTP + WebSocket | Separate gateway | **Unified context** |
| Real-time | Add-on | **Native** |
| AI agents | ❌ | **✅ @nodefony/agent** |
| RAG pipeline | ❌ | **✅ @nodefony/rag** |
| MCP server/client | ❌ | **✅ @nodefony/mcp** |
| Multi-LLM provider | ❌ | **✅ Claude · Gemini · Ollama** |
| Module system | Framework-specific | **TypeScript decorators** |
| Build | Various | **Rollup (per-module, .d.ts)** |
| Servers | Depends on adapter | **Native Node.js** |
| License | Various | **CeCILL-B (French open source)** |

---

## Real-time first — the key differentiator

One controller. HTTP and WebSocket. Same context, same session, same routing.

```typescript
@Controller('/data')
export class DataController extends NodefonyController {

  // responds to both HTTP GET /data and WebSocket /data/stream
  @Route('/')
  @WebSocketRoute('/stream')
  async dataAction(ctx: NodefonyContext): Promise<void> {
    const data = await this.dataService.get();

    if (ctx.isWebSocket()) {
      ctx.send(JSON.stringify(data));   // real-time push
    } else {
      ctx.json(data);                   // HTTP response
    }
  }
}
```

No duplicated logic. No separate gateway. Two transports, one action.

---

## AI Agent — build a domain agent in minutes

Nodefony provides **generic, reusable modules**. The domain logic is yours.

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
    @Inject('memory') private mem: IMemoryService
  ) {}

  async answer(question: string): Promise<AgentResult> {
    const sources = await this.rag.search(question, { limit: 5 });
    return this.llm.chat(question, { context: sources });
  }
}

// 3. Stream answers in real-time via WebSocket
@Controller('/legal')
export class LegalController extends NodefonyController {

  @WebSocketRoute('/ask')
  async ask(ctx: NodefonyContext): Promise<void> {
    const stream = this.legalAgent.stream(ctx.request.message);
    for await (const token of stream) {
      ctx.send(token);  // tokens arrive token by token
    }
  }
}
```

Same pattern for wealth management, medical records, support agents, HR tools.
The framework is identical — only the corpus and domain logic change.

---

## Module system

Nodefony uses composable TypeScript modules. Each module is independently publishable on npm.

```typescript
@Module({
  name: 'hello',
  imports: [SecurityModule, DatabaseModule],
  providers: [HelloService, HelloController]
})
export class HelloModule extends NodefonyModule {}
```

```
src/modules/
  hello-module/
    HelloModule.ts
    HelloController.ts   ← @Controller
    HelloService.ts      ← @Service
    HelloEntity.ts       ← MikroORM entity
    HelloController.test.ts
```

---

## Bundler — Rollup

Rollup is the official build tool for Nodefony modules.

- `preserveModules: true` — each module keeps its structure for npm publishing
- `.d.ts` generation per module — full TypeScript support for consumers
- Tree-shaking per module — install only what you need
- Built for ESM — native `import/export`

```bash
# Build all modules
nodefony build

# Build in watch mode (dev HMR)
nodefony dev
```

> **Bun** is used as toolchain only (install, run TypeScript, test).  
> **Node.js** native APIs handle all servers (http, https, http2, ws, wss).  
> **Rollup** handles all module builds and `.d.ts` generation.

---

## Requirements

| Tool | Version | Role |
|------|---------|------|
| **Node.js** | >= 18 | Runtime — all servers |
| **Bun** | >= 1.2 | Toolchain — install, run TS, test |
| **Git** | any | Version control |
| **OpenSSL** | any | HTTPS/WSS certificates |

---

## Installation

```bash
# Install globally
npm install -g nodefony

# Or use directly
npx nodefony create my-project
cd my-project
nodefony dev
```

---

## Quick start

```bash
# 1. Create a project
nodefony create my-project
cd my-project

# 2. Generate a module
nodefony generate:module hello

# 3. Start dev server + AI dashboard
nodefony dev
```

| URL | Description |
|-----|-------------|
| `http://localhost:5151` | Your application (HTTP) |
| `https://localhost:5152` | Your application (HTTPS + HTTP/2) |
| `http://localhost:5151/nodefony` | AI dev dashboard |

---

## HTTPS / HTTP2 / WSS

Nodefony generates self-signed certificates on first run.

```
http://localhost:5151    HTTP/1.1
https://localhost:5152   HTTPS · HTTP/2 · WSS (TLS)
```

Add the generated CA to your browser to trust local certificates:

```
config/certificates/ca/nodefony-root-ca.crt.pem
```

---

## Configuration

```typescript
// nodefony.config.ts
export default {
  domain: '0.0.0.0',
  httpPort: 5151,
  httpsPort: 5152,
  servers: {
    http: true,
    https: true,
    http2: true,
    ws: true,
    wss: true,
  },
  modules: {
    security: true,
    studio: true,       // AI dev dashboard at /nodefony
  },
  ai: {
    provider: 'claude',               // claude | gemini | ollama | openai
    model: 'claude-sonnet-4-6',
    apiKey: process.env.ANTHROPIC_API_KEY,
  }
};
```

---

## CLI

```bash
nodefony dev                     # dev server + AI dashboard + HMR
nodefony prod                    # production with process management
nodefony build                   # build all modules with Rollup
nodefony test                    # run all tests with bun test
nodefony generate:module [name]  # generate a module
nodefony generate:service [name] # generate a service
nodefony generate:entity [name]  # generate an ORM entity
nodefony certificates            # generate SSL/TLS certificates
```

---

## Packages

| Package | Description | Status |
|---------|-------------|--------|
| `@nodefony/core` | Kernel, DI Container, Module system | 🔶 Migration TS |
| `@nodefony/http` | HTTP/HTTPS/HTTP2/WS/WSS — native Node.js | 🔶 Migration TS |
| `@nodefony/security` | JWT, OAuth2, LDAP, Session, WAF, CORS | ⬜ Planned |
| `@nodefony/mikro` | MikroORM adapter (primary ORM) | ⬜ Planned |
| `@nodefony/sequelize` | Sequelize adapter (legacy support) | ⬜ Planned |
| `@nodefony/mongoose` | Mongoose adapter — MongoDB | ⬜ Planned |
| `@nodefony/llm` | ILLMProvider — Claude, Gemini, Ollama, OpenAI | ⬜ Planned |
| `@nodefony/rag` | RAG pipeline — indexing, chunking, search | ⬜ Planned |
| `@nodefony/vector` | pgvector, Qdrant, Chroma adapters | ⬜ Planned |
| `@nodefony/agent` | Agent orchestrator + sub-agents | ⬜ Planned |
| `@nodefony/mcp` | MCP server + client (Model Context Protocol) | ⬜ Planned |
| `@nodefony/memory` | Agent memory — short-term + long-term | ⬜ Planned |
| `@nodefony/studio` | AI dev dashboard at `/nodefony` | ⬜ Planned |

> Status: ✅ Stable · 🔶 In migration · ⬜ Planned

---

## Roadmap

```
Phase 1 — TypeScript migration (in progress)
  ├── @nodefony/core     Kernel, DI Container, Module system
  ├── @nodefony/http     Unified HTTP+WS context
  ├── @nodefony/router   Decorators @Route @WebSocketRoute
  └── @nodefony/security JWT, OAuth2, Session

Phase 2 — ORM adapters
  ├── @nodefony/mikro    MikroORM — primary TypeScript ORM
  ├── @nodefony/sequelize Sequelize v6 — legacy compatibility
  └── @nodefony/mongoose  MongoDB

Phase 3 — AI platform (generic modules)
  ├── @nodefony/llm      Multi-model provider interface
  ├── @nodefony/rag      RAG pipeline
  ├── @nodefony/vector   Vector store adapters
  ├── @nodefony/agent    Orchestrator + sub-agents
  ├── @nodefony/mcp      MCP server + client
  └── @nodefony/memory   Agent memory

Phase 4 — Developer tooling
  ├── @nodefony/studio   AI dashboard at /nodefony
  └── @nodefony/generator AI-powered module generator
```

---

## References

- [Node.js](https://nodejs.org/)
- [TypeScript](https://www.typescriptlang.org/)
- [Bun](https://bun.sh/)
- [Rollup](https://rollupjs.org/)
- [MikroORM](https://mikro-orm.io/)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Anthropic API](https://docs.anthropic.com/)

---

## Contributing

Nodefony is open source under the CeCILL-B license.
Contributions, issues and pull requests are welcome.

```bash
git clone https://github.com/nodefony/nodefony-core
cd nodefony-core
bun install
bun test
```

---

## Author

**Christophe CAMENSULI** — [github/ccamensuli](https://github.com/ccamensuli)

Built alone, for everyone. Free and open source.

---

## License

[CeCILL-B](http://www.cecill.info/licences/Licence_CeCILL-B_V1-en.html)
French free software license — compatible with LGPL.
