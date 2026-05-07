# Conventions TypeScript — nodefony-core

## Bundler : Rollup (pas Bun build)
## Serveurs : Node.js natif (pas Bun.serve)
## Runtime dev : Bun (install, run, test)

---

## Imports — règles strictes

```typescript
// ✅ Node.js natif — toujours préfixe node:
import * as http from "node:http";
import * as https from "node:https";
import * as http2 from "node:http2";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { EventEmitter } from "node:events";

// ✅ Types d'abord avec import type
import type { IKernel } from "../types/IKernel.js";
import type { IModule } from "../types/IModule.js";

// ✅ Extensions .js obligatoires dans les imports ESM
import { Container } from "./Container.js";

// ❌ Jamais
import fs from "fs";           // sans préfixe node:
import { x } from "./x";      // sans extension .js
const x = require("x");       // CommonJS
```

---

## Nommage

| Élément | Convention | Exemple |
|---------|-----------|---------|
| Interface | `I` + PascalCase | `IKernel`, `IModule`, `ILLMProvider` |
| Classe abstraite | `Abstract` + PascalCase | `AbstractModule` |
| Type | PascalCase | `KernelOptions`, `ModuleConfig` |
| Enum | PascalCase | `Environment`, `HttpMethod` |
| Decorator factory | camelCase dans @  | `@module()`, `@service()` |
| Fichier | PascalCase | `Kernel.ts`, `Container.ts` |
| Test | même + `.test` | `Kernel.test.ts` |
| Index barrel | lowercase | `index.ts` |

---

## Decorators — pattern standard

```typescript
// Toujours une factory (fonction qui retourne le decorator)
export function Module(options: ModuleOptions) {
  return function (target: new (...args: unknown[]) => unknown) {
    Reflect.defineMetadata("nodefony:module", options, target);
  };
}

// Usage
@Module({ name: "hello", path: import.meta.dirname })
export class HelloModule extends NodefonyModule {}

@Service({ singleton: true })
export class MyService implements IService {
  constructor(
    @Inject("kernel") private readonly kernel: IKernel
  ) {}
}

@Controller("/api/users")
export class UserController extends NodefonyController {

  @Route("/", { methods: ["GET"] })
  async list(ctx: NodefonyContext): Promise<void> {
    ctx.json(await this.userService.findAll());
  }

  @WebSocketRoute("/live")
  async liveUpdates(ctx: NodefonyContext): Promise<void> {
    ctx.send(JSON.stringify({ status: "connected" }));
  }
}
```

---

## Contexte unifié HTTP + WebSocket

```typescript
// NodefonyContext — jamais http.IncomingMessage directement
export class MyController extends NodefonyController {

  @Route("/data")
  @WebSocketRoute("/data/stream")
  async data(ctx: NodefonyContext): Promise<void> {
    const result = await this.service.getData();

    if (ctx.isWebSocket()) {
      ctx.send(JSON.stringify(result));      // WS
    } else {
      ctx.json(result);                      // HTTP
    }
  }
}
```

---

## Structure d'un fichier module

```typescript
// 1. Imports Node.js natifs
import * as http from "node:http";

// 2. Imports npm
import { WebSocketServer } from "ws";

// 3. Imports internes — types (import type)
import type { IKernel } from "../types/IKernel.js";

// 4. Imports internes — implémentations
import { Container } from "../container/Container.js";

// 5. Types locaux
interface LocalConfig { port: number; }

// 6. Constantes
const DEFAULT_PORT = 5151;

// 7. Classe principale
export class HttpServer implements IServerService {
  private server!: http.Server;
  constructor(private readonly kernel: IKernel) {}
}

// 8. Export default si applicable
export default HttpServer;
```

---

## Gestion des erreurs — classes typées

```typescript
export class NodefonyError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = "NodefonyError";
  }
}

// Une classe par domaine
export class KernelError extends NodefonyError {}
export class ModuleError extends NodefonyError {}
export class RouterError extends NodefonyError {}
export class ServerError extends NodefonyError {}
export class SecurityError extends NodefonyError {}
export class LLMError extends NodefonyError {}
export class RAGError extends NodefonyError {}
```

---

## Tests — bun test

```typescript
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Kernel } from "./Kernel.js";

describe("Kernel", () => {
  let kernel: Kernel;

  beforeAll(async () => {
    kernel = new Kernel({ environment: "test", debug: false });
    await kernel.boot();
  });

  afterAll(async () => {
    await kernel.shutdown();
  });

  it("boots successfully", () => {
    expect(kernel.isBooted()).toBe(true);
  });

  it("resolves services from container", () => {
    const router = kernel.getContainer().get<IRouter>("router");
    expect(router).toBeDefined();
  });
});
```

---

## Ce qu'il ne faut JAMAIS faire

```typescript
❌ any                    → unknown + narrowing
❌ @ts-ignore             → corriger le vrai problème
❌ require()              → import ESM
❌ import "fs"            → import "node:fs"
❌ import "./x"           → import "./x.js"
❌ Bun.serve()            → http.createServer()
❌ new Service()          → container.get(Service)
❌ req: IncomingMessage   → ctx: NodefonyContext
❌ callback Node style    → async/await
❌ fs.readFile(cb)        → await fs.promises.readFile()
```
