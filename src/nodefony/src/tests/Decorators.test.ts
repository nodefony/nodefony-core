/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert";
import { resolve } from "node:path";
import "reflect-metadata";
import Module from "../kernel/Module";
import Service from "../Service";
import Container from "../Container";
import Kernel from "../kernel/Kernel";
import type { ServiceConstructor } from "../kernel/Kernel";
import { services } from "../kernel/decorators/kernelDecorator";
import type { PackageJson } from "../types/IModule";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const NODEFONY_PKG = resolve(process.cwd(), "package.json");

// Stub kernel minimal — supporte once/prependOnceListener + isModule/loadModule/addModule
function makeKernelStub() {
  const events: Record<string, Array<() => Promise<unknown>>> = {};
  const loadModuleCalls: Array<[string, boolean]> = [];
  const addModuleCalls: unknown[] = [];
  const container = new Container();

  const stub = {
    loadModuleCalls,
    addModuleCalls,
    container,
    environment: "development" as const,
    /**
     * Politique d'échec d'un service (`@services`) — fait partie du contrat que
     * le core attend d'un kernel. `development` → fail-soft, donc `false` :
     * l'échec est annoncé (BootReport) mais ne propage pas. En `production` le
     * vrai kernel renvoie `true` → le boot s'interrompt (cf. `isBootErrorFatal`,
     * couvert par `services.attack.test.ts`).
     */
    serviceBootErrorFatal(): boolean {
      return false;
    },
    isModule(ctor: unknown): boolean {
      return (
        typeof ctor === "function" &&
        (ctor as { prototype: unknown }).prototype instanceof Module
      );
    },
    async loadModule(path: string, hot = false): Promise<void> {
      loadModuleCalls.push([path, hot]);
    },
    async addModule(Ctor: unknown): Promise<void> {
      addModuleCalls.push(Ctor);
    },
    once(event: string, fn: () => Promise<unknown>): void {
      if (!events[event]) events[event] = [];
      events[event].push(fn);
    },
    prependOnceListener(event: string, fn: () => Promise<unknown>): void {
      if (!events[event]) events[event] = [];
      events[event].unshift(fn);
    },
    getModule(_name: string) {
      return undefined;
    },
    events,
    async fireEvent(event: string): Promise<void> {
      for (const fn of events[event] || []) {
        await fn();
      }
    },
  };

  container.set("kernel", stub);
  return stub;
}

type KernelStub = ReturnType<typeof makeKernelStub>;

// Crée un module décoré + mocke getPackageJson (évite l'I/O de setEvents)
function createMod<T extends typeof Module>(
  Ctor: T,
  stub: KernelStub,
  path = NODEFONY_PKG,
): InstanceType<T> {
  const mod = new Ctor(
    "testmod",
    stub as unknown as Kernel,
    path,
    {},
  ) as InstanceType<T>;
  (mod as any).getPackageJson = async () =>
    ({
      name: "test",
      version: "0.0.0",
      dependencies: {},
      devDependencies: {},
      peerDependencies: {},
    }) as PackageJson;
  return mod;
}

// Services de test
class AlphaService extends Service {
  constructor(container?: Container) {
    super("AlphaService", container ?? new Container());
  }
}
class BetaService extends Service {
  constructor(container?: Container) {
    super("BetaService", container ?? new Container());
  }
}

// ─── 8. @services — construction ─────────────────────────────────────────────

describe("@services — construction", () => {
  it("instance de Module après décoration avec un constructeur", () => {
    @services(AlphaService as unknown as ServiceConstructor)
    class DecSvc extends Module {}
    const stub = makeKernelStub();
    const mod = createMod(DecSvc as typeof Module, stub);
    assert.ok(mod instanceof Module);
    assert.ok(mod instanceof DecSvc);
  });

  it("listener onPreBoot inscrit sur le stub", () => {
    @services(AlphaService as unknown as ServiceConstructor)
    class SvcList extends Module {}
    const stub = makeKernelStub();
    createMod(SvcList as typeof Module, stub);
    // onPreBoot listeners: [setEvents prependOnceListener, @services once]
    assert.ok(Array.isArray(stub.events["onPreBoot"]));
    assert.ok(stub.events["onPreBoot"].length >= 2);
  });

  it("name du module préservé", () => {
    @services(AlphaService as unknown as ServiceConstructor)
    class SvcNamed extends Module {}
    const stub = makeKernelStub();
    const mod = createMod(SvcNamed as typeof Module, stub);
    assert.strictEqual(mod.name, "testmod");
  });
});

// ─── 9. @services — single ServiceConstructor ────────────────────────────────

describe("@services — single ServiceConstructor", () => {
  it("addService(Ctor) appelé sur onPreBoot", async () => {
    @services(AlphaService as unknown as ServiceConstructor)
    class SvcMod1 extends Module {}
    const stub = makeKernelStub();
    const mod = createMod(SvcMod1 as typeof Module, stub);
    const addServiceCalls: unknown[] = [];
    (mod as any).addService = async (Ctor: unknown) => {
      addServiceCalls.push(Ctor);
      return {} as Service;
    };
    await stub.fireEvent("onPreBoot");
    assert.strictEqual(addServiceCalls.length, 1);
    assert.strictEqual(addServiceCalls[0], AlphaService);
  });

  it("loadService non appelé (ctor, pas string)", async () => {
    @services(AlphaService as unknown as ServiceConstructor)
    class SvcMod2 extends Module {}
    const stub = makeKernelStub();
    const mod = createMod(SvcMod2 as typeof Module, stub);
    const loadServiceCalls: unknown[] = [];
    (mod as any).addService = async () => ({}) as Service;
    (mod as any).loadService = async (p: string) => {
      loadServiceCalls.push(p);
      return {} as Service;
    };
    await stub.fireEvent("onPreBoot");
    assert.strictEqual(loadServiceCalls.length, 0);
  });

  it("sans fireEvent → addService pas encore appelé (lazy)", () => {
    @services(AlphaService as unknown as ServiceConstructor)
    class SvcMod3 extends Module {}
    const stub = makeKernelStub();
    const mod = createMod(SvcMod3 as typeof Module, stub);
    const addServiceCalls: unknown[] = [];
    (mod as any).addService = async (Ctor: unknown) => {
      addServiceCalls.push(Ctor);
    };
    // onPreBoot pas déclenché
    assert.strictEqual(addServiceCalls.length, 0);
  });
});

// ─── 10. @services — single string path ──────────────────────────────────────

describe("@services — single string path", () => {
  it("loadService(path) appelé sur onPreBoot", async () => {
    @services("./alpha-service")
    class SvcMod4 extends Module {}
    const stub = makeKernelStub();
    const mod = createMod(SvcMod4 as typeof Module, stub);
    const loadServiceCalls: string[] = [];
    (mod as any).loadService = async (p: string) => {
      loadServiceCalls.push(p);
      return {} as Service;
    };
    await stub.fireEvent("onPreBoot");
    assert.deepStrictEqual(loadServiceCalls, ["./alpha-service"]);
  });

  it("addService non appelé (string, pas ctor)", async () => {
    @services("./alpha-service")
    class SvcMod5 extends Module {}
    const stub = makeKernelStub();
    const mod = createMod(SvcMod5 as typeof Module, stub);
    const addServiceCalls: unknown[] = [];
    (mod as any).addService = async (Ctor: unknown) => {
      addServiceCalls.push(Ctor);
      return {} as Service;
    };
    (mod as any).loadService = async () => ({}) as Service;
    await stub.fireEvent("onPreBoot");
    assert.strictEqual(addServiceCalls.length, 0);
  });
});

// ─── 11. @services — array of ServiceConstructors ────────────────────────────

describe("@services — array of ServiceConstructors", () => {
  it("addService appelé pour chaque constructeur", async () => {
    @services([
      AlphaService as unknown as ServiceConstructor,
      BetaService as unknown as ServiceConstructor,
    ])
    class SvcMod6 extends Module {}
    const stub = makeKernelStub();
    const mod = createMod(SvcMod6 as typeof Module, stub);
    const addServiceCalls: unknown[] = [];
    (mod as any).addService = async (Ctor: unknown) => {
      addServiceCalls.push(Ctor);
      return {} as Service;
    };
    await stub.fireEvent("onPreBoot");
    assert.strictEqual(addServiceCalls.length, 2);
    assert.strictEqual(addServiceCalls[0], AlphaService);
    assert.strictEqual(addServiceCalls[1], BetaService);
  });

  it("ordre respecté", async () => {
    @services([
      BetaService as unknown as ServiceConstructor,
      AlphaService as unknown as ServiceConstructor,
    ])
    class SvcMod7 extends Module {}
    const stub = makeKernelStub();
    const mod = createMod(SvcMod7 as typeof Module, stub);
    const calls: unknown[] = [];
    (mod as any).addService = async (Ctor: unknown) => {
      calls.push(Ctor);
      return {} as Service;
    };
    await stub.fireEvent("onPreBoot");
    assert.strictEqual(calls[0], BetaService);
    assert.strictEqual(calls[1], AlphaService);
  });

  it("array vide → aucun appel", async () => {
    @services([])
    class SvcMod8 extends Module {}
    const stub = makeKernelStub();
    const mod = createMod(SvcMod8 as typeof Module, stub);
    const addServiceCalls: unknown[] = [];
    (mod as any).addService = async (Ctor: unknown) => {
      addServiceCalls.push(Ctor);
      return {} as Service;
    };
    await stub.fireEvent("onPreBoot");
    assert.strictEqual(addServiceCalls.length, 0);
  });
});

// ─── 12. @services — array of strings ────────────────────────────────────────

describe("@services — array of strings", () => {
  it("loadService appelé pour chaque path", async () => {
    @services(["./svc-a", "./svc-b"])
    class SvcMod9 extends Module {}
    const stub = makeKernelStub();
    const mod = createMod(SvcMod9 as typeof Module, stub);
    const calls: string[] = [];
    (mod as any).loadService = async (p: string) => {
      calls.push(p);
      return {} as Service;
    };
    await stub.fireEvent("onPreBoot");
    assert.deepStrictEqual(calls, ["./svc-a", "./svc-b"]);
  });
});

// ─── 13. @services — mixed array ─────────────────────────────────────────────

describe("@services — mixed array (string + ServiceConstructor)", () => {
  it("string → loadService, ctor → addService", async () => {
    @services(["./svc-path", AlphaService as unknown as ServiceConstructor])
    class SvcMod10 extends Module {}
    const stub = makeKernelStub();
    const mod = createMod(SvcMod10 as typeof Module, stub);
    const addCalls: unknown[] = [];
    const loadCalls: string[] = [];
    (mod as any).addService = async (Ctor: unknown) => {
      addCalls.push(Ctor);
      return {} as Service;
    };
    (mod as any).loadService = async (p: string) => {
      loadCalls.push(p);
      return {} as Service;
    };
    await stub.fireEvent("onPreBoot");
    assert.deepStrictEqual(loadCalls, ["./svc-path"]);
    assert.deepStrictEqual(addCalls, [AlphaService]);
  });

  it("ctor en premier, string en second", async () => {
    @services([BetaService as unknown as ServiceConstructor, "./last-path"])
    class SvcMod11 extends Module {}
    const stub = makeKernelStub();
    const mod = createMod(SvcMod11 as typeof Module, stub);
    const addCalls: unknown[] = [];
    const loadCalls: string[] = [];
    (mod as any).addService = async (Ctor: unknown) => {
      addCalls.push(Ctor);
      return {} as Service;
    };
    (mod as any).loadService = async (p: string) => {
      loadCalls.push(p);
      return {} as Service;
    };
    await stub.fireEvent("onPreBoot");
    assert.deepStrictEqual(addCalls, [BetaService]);
    assert.deepStrictEqual(loadCalls, ["./last-path"]);
  });
});

// ─── 14. @services — gestion des erreurs ─────────────────────────────────────

describe("@services — gestion des erreurs", () => {
  it("erreur dans addService → catchée, pas propagée", async () => {
    @services(AlphaService as unknown as ServiceConstructor)
    class SvcErr1 extends Module {}
    const stub = makeKernelStub();
    const mod = createMod(SvcErr1 as typeof Module, stub);
    (mod as any).addService = async () => {
      throw new Error("addService boom");
    };
    const loggedErrors: unknown[] = [];
    (mod as any).log = (msg: unknown, sev?: string) => {
      if (sev === "ERROR") loggedErrors.push(msg);
    };
    await assert.doesNotReject(() => stub.fireEvent("onPreBoot"));
  });

  it("erreur dans loadService → catchée, pas propagée", async () => {
    @services("./bad-path")
    class SvcErr2 extends Module {}
    const stub = makeKernelStub();
    const mod = createMod(SvcErr2 as typeof Module, stub);
    (mod as any).loadService = async () => {
      throw new Error("loadService boom");
    };
    await assert.doesNotReject(() => stub.fireEvent("onPreBoot"));
  });

  it("erreur dans addService array → continue les éléments suivants", async () => {
    @services([
      AlphaService as unknown as ServiceConstructor,
      BetaService as unknown as ServiceConstructor,
    ])
    class SvcErr3 extends Module {}
    const stub = makeKernelStub();
    const mod = createMod(SvcErr3 as typeof Module, stub);
    let callCount = 0;
    (mod as any).addService = async (Ctor: unknown) => {
      callCount++;
      if (Ctor === AlphaService) throw new Error("first fails");
      return {} as Service;
    };
    await stub.fireEvent("onPreBoot");
    assert.strictEqual(
      callCount,
      2,
      "BetaService doit aussi être tenté malgré l'erreur AlphaService",
    );
  });
});

// ─── 15. @services — edge cases ──────────────────────────────────────────────

describe("@services — edge cases", () => {
  it("sans kernel dans container → listener onPreBoot non inscrit par @services", () => {
    @services(AlphaService as unknown as ServiceConstructor)
    class SvcEdge1 extends Module {}
    const stub = makeKernelStub();
    stub.container.remove("kernel");
    createMod(SvcEdge1 as typeof Module, stub);
    // setEvents ne peut pas ajouter ses listeners non plus (kernel=null)
    // donc events["onPreBoot"] est undefined ou vide
    assert.ok(
      !stub.events["onPreBoot"] || stub.events["onPreBoot"].length === 0,
    );
  });

  it("deux instances indépendantes → chacune appelle addService séparément", async () => {
    @services(AlphaService as unknown as ServiceConstructor)
    class SvcEdge2 extends Module {}
    const stub1 = makeKernelStub();
    const stub2 = makeKernelStub();
    const mod1 = createMod(SvcEdge2 as typeof Module, stub1);
    const mod2 = createMod(SvcEdge2 as typeof Module, stub2);
    const calls1: unknown[] = [];
    const calls2: unknown[] = [];
    (mod1 as any).addService = async (Ctor: unknown) => {
      calls1.push(Ctor);
      return {} as Service;
    };
    (mod2 as any).addService = async (Ctor: unknown) => {
      calls2.push(Ctor);
      return {} as Service;
    };
    await stub1.fireEvent("onPreBoot");
    assert.strictEqual(calls1.length, 1);
    assert.strictEqual(calls2.length, 0);
  });
});
