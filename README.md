# NODEFONY

<div align="center">

![Nodefony](https://raw.githubusercontent.com/nodefony/nodefony/master/src/nodefony/bundles/framework-bundle/Resources/public/images/nodefony-logo.png)

**Node.js Agentic Framework**

*Build real-time applications and AI agents with TypeScript*

[![npm version](https://img.shields.io/npm/v/nodefony-core?style=flat-square)](https://www.npmjs.com/package/nodefony-core)
[![License: CeCILL-B](https://img.shields.io/badge/License-CeCILL--B-blue.svg?style=flat-square)](http://www.cecill.info/licences/Licence_CeCILL-B_V1-en.html)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?style=flat-square)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green?style=flat-square)](https://nodejs.org/)
[![Build Status](https://github.com/nodefony/nodefony-core/workflows/nodefony/badge.svg)](https://github.com/nodefony/nodefony-core/actions)

</div>

---

## What is Nodefony ?

Nodefony is a **Node.js framework for building real-time applications and AI agents**.

HTTP and WebSocket are **first-class citizens** in the same controller context — no separate gateway, no bolt-on real-time. One framework, one unified context.

Built for teams who need to ship fast : a lawyer's legal research agent, a wealth management assistant, a live collaboration tool — all built on the same generic, reusable modules.

```bash
# Create a project
npx nodefony create my-project

# Start dev server + AI dashboard
npx nodefony dev
# → http://localhost:5151        your app
# → http://localhost:5151/nodefony  AI dev agent
```

---

## Why Nodefony and not NestJS ?

| | NestJS | Nodefony |
|---|---|---|
| HTTP + WebSocket | Separate gateway | **Unified context** |
| Real-time first | Add-on | **Native** |
| AI agents built-in | ❌ | **✅ @nodefony/agent** |
| RAG pipeline | ❌ | **✅ @nodefony/rag** |
| MCP server/client | ❌ | **✅ @nodefony/mcp** |
| Module system | Angular-style | **Symfony-inspired** |
| Bundler | None | **Rollup (per-module)** |
| License | MIT | **CeCILL-B (French open)** |

> If you're building a classic REST API → NestJS is fine.
> If real-time and AI agents are central → Nodefony is built for that.

---

## Features

### Framework Core
- **Unified HTTP + WebSocket context** — same controller, same routing, same session
- **HTTP/1.1, HTTPS, HTTP/2, WS, WSS** — all servers native Node.js
- **Dependency Injection** — Symfony-style DI container with TypeScript decorators
- **Module system** — composable, publishable npm modules (`@Module`, `@Service`, `@Controller`)
- **Dynamic routing** — `@Route`, `@WebSocketRoute` decorators
- **Security** — JWT, OAuth2, LDAP, Session, WAF, CORS
- **ORM adapters** — MikroORM (primary), Sequelize (legacy), Mongoose
- **CLI** — `nodefony generate`, `nodefony dev`, `nodefony prod`
- **Hot Module Reload** — RollupService watches and reloads modules without server restart

### AI Agent Platform
- **`@nodefony/llm`** — unified provider interface (Claude, Gemini, Ollama, OpenAI)
- **`@nodefony/rag`** — PDF ingestion, chunking, embedding, vector search
- **`@nodefony/vector`** — pgvector, Qdrant, Chroma adapters
- **`@nodefony/agent`** — orchestrator + sub-agents via DI container
- **`@nodefony/mcp`** — MCP server & client (Anthropic Model Context Protocol)
- **`@nodefony/memory`** — short-term (WS session) + long-term (vector DB)
- **`@nodefony/studio`** — AI dev dashboard at `/nodefony` (replaces monitoring)

---

## Real-time first — the key differentiator

```typescript
// One controller. HTTP and WebSocket. Same context.
@Controller('/data')
export class DataController extends NodefonyController {

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

No separate gateway. No duplicated logic. One action, two transports.

---

## AI Agent — build a legal assistant in minutes

```typescript
// 1. Index your legal corpus
@Module({ name: 'legal-corpus' })
export class LegalCorpusModule extends NodefonyModule {
  async boot(): Promise<void> {
    await this.rag.indexDirectory('./corpus/code-civil');
    await this.rag.indexDirectory('./corpus/jurisprudence');
  }
}

// 2. Create your agent
@Service({ singleton: true })
export class LegalAgent implements IAgent {
  constructor(
    @Inject('rag') private rag: IRagService,
    @Inject('llm') private llm: ILLMProvider
  ) {}

  async answer(question: string): Promise<AgentResult> {
    const sources = await this.rag.search(question, { limit: 5 });
    return this.llm.chat(question, { context: sources });
  }
}

// 3. Stream answers via WebSocket
@Controller('/legal')
export class LegalController extends NodefonyController {

  @WebSocketRoute('/ask')
  async ask(ctx: NodefonyContext): Promise<void> {
    const stream = this.legalAgent.stream(ctx.request.message);
    for await (const token of stream) {
      ctx.send(token);  // tokens arrive in real-time
    }
  }
}
```

The same pattern works for wealth management, medical records, support agents — just change the corpus and the domain logic. The framework stays identical.

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
    HelloController.ts
    HelloService.ts
    HelloEntity.ts        ← MikroORM entity
    HelloController.test.ts
```

---

## Requirements

- **Node.js** >= 18
- **Bun** >= 1.2 (toolchain — install, run TS, test, build assets)
- **Git**
- **OpenSSL** (for HTTPS/WSS certificates)

> Bun is used as toolchain only. Servers run on native Node.js APIs.

---

## Installation

```bash
# Install globally
npm install -g nodefony

# Or use npx
npx nodefony create my-project
cd my-project

# Start dev server
nodefony dev
```

---

## Quick Start

```bash
# Create project
nodefony create my-project
cd my-project

# Generate a module
nodefony generate:module hello

# Start development
nodefony dev
```

Access your app at `http://localhost:5151`
Access the AI dev agent at `http://localhost:5151/nodefony`

---

## CLI

```bash
nodefony dev                     # development server + AI dashboard
nodefony prod                    # production with process manager
nodefony generate:module [name]  # generate a new module
nodefony generate:service [name] # generate a service
nodefony generate:entity [name]  # generate an ORM entity
nodefony test                    # run tests with bun test
nodefony build                   # build all modules with Rollup
nodefony certificates            # generate SSL certificates
```

---

## HTTPS / WSS

Nodefony generates self-signed certificates automatically on first run.

```
http://localhost:5151   → HTTP/1.1 or HTTP/2
https://localhost:5152  → HTTPS + WSS (TLS)
```

Add the generated CA to your browser:
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
    monitoring: true,
    studio: true,       // AI dev dashboard
  },
  llm: {
    provider: 'claude', // claude | gemini | ollama | openai
    model: 'claude-sonnet-4-6',
  }
};
```

---

## Packages

| Package | Description | Status |
|---------|-------------|--------|
| `@nodefony/core` | Kernel, DI Container, Module system | 🔶 Migration |
| `@nodefony/http` | HTTP/HTTPS/HTTP2/WS/WSS servers | 🔶 Migration |
| `@nodefony/security` | JWT, OAuth, Session, WAF | ⬜ Planned |
| `@nodefony/mikro` | MikroORM adapter | ⬜ Planned |
| `@nodefony/sequelize` | Sequelize adapter (legacy) | ⬜ Planned |
| `@nodefony/mongoose` | Mongoose adapter | ⬜ Planned |
| `@nodefony/llm` | Multi-model LLM provider | ⬜ Planned |
| `@nodefony/rag` | RAG pipeline | ⬜ Planned |
| `@nodefony/agent` | Agent orchestrator | ⬜ Planned |
| `@nodefony/mcp` | MCP server + client | ⬜ Planned |
| `@nodefony/memory` | Agent memory | ⬜ Planned |
| `@nodefony/studio` | AI dev dashboard | ⬜ Planned |

---

## Migration from v7 (JavaScript)

> The JavaScript version (v7) is available at [nodefony/nodefony](https://github.com/nodefony/nodefony).
> It receives security updates only. New features are developed here in TypeScript.

**What changes:**
- `Bundle` → `Module`
- `@Bundle()` → `@Module()`
- CommonJS → ESM
- JavaScript → TypeScript strict
- Webpack (assets) → Bun build
- PM2 → native process management

**What stays identical:**
- HTTP/WS/HTTP2 servers (native Node.js)
- DI Container logic
- Routing patterns
- Security architecture
- Module structure

---

## Who uses Nodefony

[![SFR](https://raw.githubusercontent.com/nodefony/nodefony/master/tools/images/sfr.jpg)](https://www.sfr.fr)
[![D-Lake](https://raw.githubusercontent.com/nodefony/nodefony/dev/tools/images/d-lake.png)](https://www.d-lake.fr)
[![Emersya](https://raw.githubusercontent.com/nodefony/nodefony/dev/tools/images/emersya.png)](https://emersya.com)

---

## References

- [Node.js](https://nodejs.org/)
- [TypeScript](https://www.typescriptlang.org/)
- [Bun](https://bun.sh/)
- [Rollup](https://rollupjs.org/)
- [MikroORM](https://mikro-orm.io/)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Anthropic Claude API](https://docs.anthropic.com/)
- [Symfony](https://symfony.com/) *(inspiration)*

---

## Contributing

Nodefony is open source under CeCILL-B license (French equivalent of LGPL).
Contributions, issues and feature requests are welcome.

```bash
git clone https://github.com/nodefony/nodefony-core
cd nodefony-core
bun install
bun test
```

---

## Author

**Christophe CAMENSULI** — [github/ccamensuli](https://github.com/ccamensuli)

Built alone, for everyone. Free and open source since 2016.

---

## License

[CeCILL-B](http://www.cecill.info/licences/Licence_CeCILL-B_V1-en.html) — Free French open source license, compatible with LGPL.
