/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert";
import { resolve } from "node:path";
import "mocha";
import "reflect-metadata";
import Module from "../kernel/Module";
import Service from "../Service";
import Container from "../Container";
import Kernel from "../kernel/Kernel";
import type { ServiceConstructor } from "../kernel/Kernel";
import { modules, services } from "../kernel/decorators/kernelDecorator";
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
  path = NODEFONY_PKG
): InstanceType<T> {
  const mod = new Ctor(
    "testmod",
    stub as unknown as Kernel,
    path,
    {}
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

// Module de test pour le path isModule
class SubModuleA extends Module {}
class SubModuleB extends Module {}

// ─── 1. @modules — construction ───────────────────────────────────────────────

describe("@modules — construction", () => {
  it("instance de Module après décoration string", () => {
    @modules("./dummy")
    class DecMod extends Module {}
    const stub = makeKernelStub();
    const mod = createMod(DecMod as typeof Module, stub);
    assert.ok(mod instanceof Module);
    assert.ok(mod instanceof DecMod);
  });

  it("name du module préservé", () => {
    @modules("./dummy")
    class NamedMod extends Module {}
    const stub = makeKernelStub();
    const mod = createMod(NamedMod as typeof Module, stub);
    assert.strictEqual(mod.name, "testmod");
  });

  it("container accessible depuis le module", () => {
    @modules("./dummy")
    class ContMod extends Module {}
    const stub = makeKernelStub();
    const mod = createMod(ContMod as typeof Module, stub);
    assert.ok(mod.container instanceof Container);
  });

  it("this.kernel = stub (résolu depuis container)", () => {
    @modules("./dummy")
    class KernMod extends Module {}
    const stub = makeKernelStub();
    const mod = createMod(KernMod as typeof Module, stub);
    assert.strictEqual(mod.kernel as unknown, stub);
  });

  it("listener onPreRegister inscrit sur le stub", () => {
    @modules("./dummy")
    class ListMod extends Module {}
    const stub = makeKernelStub();
    createMod(ListMod as typeof Module, stub);
    assert.ok(Array.isArray(stub.events["onPreRegister"]));
    assert.strictEqual(stub.events["onPreRegister"].length, 1);
  });
});

// ─── 2. @modules — single string ──────────────────────────────────────────────

describe("@modules — single string path", () => {
  it("loadModule(path, false) appelé sur onPreRegister", async () => {
    @modules("./my-module")
    class Mod1 extends Module {}
    const stub = makeKernelStub();
    createMod(Mod1 as typeof Module, stub);
    await stub.fireEvent("onPreRegister");
    assert.deepStrictEqual(stub.loadModuleCalls, [["./my-module", false]]);
    assert.strictEqual(stub.addModuleCalls.length, 0);
  });

  it("hot=false — jamais hot-reload via le décorateur", async () => {
    @modules("/abs/path/module")
    class Mod2 extends Module {}
    const stub = makeKernelStub();
    createMod(Mod2 as typeof Module, stub);
    await stub.fireEvent("onPreRegister");
    assert.strictEqual(stub.loadModuleCalls[0][1], false);
  });

  it("sans fireEvent → pas d'appel (lazy)", async () => {
    @modules("./lazy")
    class Mod3 extends Module {}
    const stub = makeKernelStub();
    createMod(Mod3 as typeof Module, stub);
    // onPreRegister pas déclenché
    assert.strictEqual(stub.loadModuleCalls.length, 0);
  });
});

// ─── 3. @modules — single ModuleConstructor ───────────────────────────────────

describe("@modules — single ModuleConstructor", () => {
  it("addModule(Ctor) appelé si isModule(Ctor) = true", async () => {
    @modules(SubModuleA)
    class Mod4 extends Module {}
    const stub = makeKernelStub();
    createMod(Mod4 as typeof Module, stub);
    await stub.fireEvent("onPreRegister");
    assert.strictEqual(stub.addModuleCalls.length, 1);
    assert.strictEqual(stub.addModuleCalls[0], SubModuleA);
    assert.strictEqual(stub.loadModuleCalls.length, 0);
  });

  it("rien appelé si isModule(Ctor) = false (non-Module ctor)", async () => {
    class NotAModule {}
    @modules(NotAModule as any)
    class Mod5 extends Module {}
    const stub = makeKernelStub();
    createMod(Mod5 as typeof Module, stub);
    await stub.fireEvent("onPreRegister");
    // isModule(NotAModule) = false → ni loadModule ni addModule
    assert.strictEqual(stub.addModuleCalls.length, 0);
    assert.strictEqual(stub.loadModuleCalls.length, 0);
  });

  it("SubModuleB → addModule appelé avec le bon constructeur", async () => {
    @modules(SubModuleB)
    class Mod6 extends Module {}
    const stub = makeKernelStub();
    createMod(Mod6 as typeof Module, stub);
    await stub.fireEvent("onPreRegister");
    assert.strictEqual(stub.addModuleCalls[0], SubModuleB);
  });
});

// ─── 4. @modules — array of strings ──────────────────────────────────────────

describe("@modules — array of strings", () => {
  it("loadModule appelé pour chaque entrée", async () => {
    @modules(["./mod-a", "./mod-b", "./mod-c"])
    class Mod7 extends Module {}
    const stub = makeKernelStub();
    createMod(Mod7 as typeof Module, stub);
    await stub.fireEvent("onPreRegister");
    assert.strictEqual(stub.loadModuleCalls.length, 3);
    assert.strictEqual(stub.loadModuleCalls[0][0], "./mod-a");
    assert.strictEqual(stub.loadModuleCalls[1][0], "./mod-b");
    assert.strictEqual(stub.loadModuleCalls[2][0], "./mod-c");
  });

  it("tous avec hot=false", async () => {
    @modules(["./x", "./y"])
    class Mod8 extends Module {}
    const stub = makeKernelStub();
    createMod(Mod8 as typeof Module, stub);
    await stub.fireEvent("onPreRegister");
    assert.ok(stub.loadModuleCalls.every((c) => c[1] === false));
  });

  it("array vide → aucun appel", async () => {
    @modules([])
    class Mod9 extends Module {}
    const stub = makeKernelStub();
    createMod(Mod9 as typeof Module, stub);
    await stub.fireEvent("onPreRegister");
    assert.strictEqual(stub.loadModuleCalls.length, 0);
    assert.strictEqual(stub.addModuleCalls.length, 0);
  });
});

// ─── 5. @modules — array of ModuleConstructors ────────────────────────────────

describe("@modules — array of ModuleConstructors", () => {
  it("addModule appelé pour chaque constructeur Module", async () => {
    @modules([SubModuleA, SubModuleB])
    class Mod10 extends Module {}
    const stub = makeKernelStub();
    createMod(Mod10 as typeof Module, stub);
    await stub.fireEvent("onPreRegister");
    assert.strictEqual(stub.addModuleCalls.length, 2);
    assert.strictEqual(stub.addModuleCalls[0], SubModuleA);
    assert.strictEqual(stub.addModuleCalls[1], SubModuleB);
    assert.strictEqual(stub.loadModuleCalls.length, 0);
  });

  it("ordre des appels respecté", async () => {
    @modules([SubModuleB, SubModuleA])
    class Mod11 extends Module {}
    const stub = makeKernelStub();
    createMod(Mod11 as typeof Module, stub);
    await stub.fireEvent("onPreRegister");
    assert.strictEqual(stub.addModuleCalls[0], SubModuleB);
    assert.strictEqual(stub.addModuleCalls[1], SubModuleA);
  });
});

// ─── 6. @modules — mixed array ────────────────────────────────────────────────

describe("@modules — mixed array (string + ModuleConstructor)", () => {
  it("string → loadModule, ctor Module → addModule", async () => {
    @modules(["./path-str", SubModuleA])
    class Mod12 extends Module {}
    const stub = makeKernelStub();
    createMod(Mod12 as typeof Module, stub);
    await stub.fireEvent("onPreRegister");
    assert.strictEqual(stub.loadModuleCalls.length, 1);
    assert.strictEqual(stub.loadModuleCalls[0][0], "./path-str");
    assert.strictEqual(stub.addModuleCalls.length, 1);
    assert.strictEqual(stub.addModuleCalls[0], SubModuleA);
  });

  it("ctor non-Module dans un array → traité comme loadModule (isModule=false → else)", async () => {
    class NotMod {}
    @modules([NotMod as any, "./real-path"])
    class Mod13 extends Module {}
    const stub = makeKernelStub();
    createMod(Mod13 as typeof Module, stub);
    await stub.fireEvent("onPreRegister");
    // NotMod: isModule=false → loadModule(NotMod, false)
    // "./real-path": string → loadModule
    assert.strictEqual(stub.loadModuleCalls.length, 2);
    assert.strictEqual(stub.addModuleCalls.length, 0);
  });
});

// ─── 7. @modules — edge cases ─────────────────────────────────────────────────

describe("@modules — edge cases", () => {
  it("sans kernel dans le container → listener non inscrit", () => {
    @modules("./any")
    class Mod14 extends Module {}
    const stub = makeKernelStub();
    stub.container.remove("kernel"); // kernel=null → this.kernel?.once → no-op
    createMod(Mod14 as typeof Module, stub);
    assert.strictEqual(stub.events["onPreRegister"], undefined);
  });

  it("sans kernel → fireEvent ne provoque pas d'appel", async () => {
    @modules("./any")
    class Mod15 extends Module {}
    const stub = makeKernelStub();
    stub.container.remove("kernel");
    createMod(Mod15 as typeof Module, stub);
    await stub.fireEvent("onPreRegister");
    assert.strictEqual(stub.loadModuleCalls.length, 0);
  });

  it("deux instances décorées indépendantes → appels séparés", async () => {
    @modules("./shared-path")
    class SharedMod extends Module {}
    const stub1 = makeKernelStub();
    const stub2 = makeKernelStub();
    createMod(SharedMod as typeof Module, stub1);
    createMod(SharedMod as typeof Module, stub2);
    await stub1.fireEvent("onPreRegister");
    assert.strictEqual(stub1.loadModuleCalls.length, 1);
    assert.strictEqual(stub2.loadModuleCalls.length, 0);
  });
});

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
    (mod as any).addService = async (Ctor: unknown) => { calls.push(Ctor); return {} as Service; };
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
    (mod as any).addService = async (Ctor: unknown) => { addServiceCalls.push(Ctor); return {} as Service; };
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
    (mod as any).loadService = async (p: string) => { calls.push(p); return {} as Service; };
    await stub.fireEvent("onPreBoot");
    assert.deepStrictEqual(calls, ["./svc-a", "./svc-b"]);
  });
});

// ─── 13. @services — mixed array ─────────────────────────────────────────────

describe("@services — mixed array (string + ServiceConstructor)", () => {
  it("string → loadService, ctor → addService", async () => {
    @services([
      "./svc-path",
      AlphaService as unknown as ServiceConstructor,
    ])
    class SvcMod10 extends Module {}
    const stub = makeKernelStub();
    const mod = createMod(SvcMod10 as typeof Module, stub);
    const addCalls: unknown[] = [];
    const loadCalls: string[] = [];
    (mod as any).addService = async (Ctor: unknown) => { addCalls.push(Ctor); return {} as Service; };
    (mod as any).loadService = async (p: string) => { loadCalls.push(p); return {} as Service; };
    await stub.fireEvent("onPreBoot");
    assert.deepStrictEqual(loadCalls, ["./svc-path"]);
    assert.deepStrictEqual(addCalls, [AlphaService]);
  });

  it("ctor en premier, string en second", async () => {
    @services([
      BetaService as unknown as ServiceConstructor,
      "./last-path",
    ])
    class SvcMod11 extends Module {}
    const stub = makeKernelStub();
    const mod = createMod(SvcMod11 as typeof Module, stub);
    const addCalls: unknown[] = [];
    const loadCalls: string[] = [];
    (mod as any).addService = async (Ctor: unknown) => { addCalls.push(Ctor); return {} as Service; };
    (mod as any).loadService = async (p: string) => { loadCalls.push(p); return {} as Service; };
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
    assert.strictEqual(callCount, 2, "BetaService doit aussi être tenté malgré l'erreur AlphaService");
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
      !stub.events["onPreBoot"] || stub.events["onPreBoot"].length === 0
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
    (mod1 as any).addService = async (Ctor: unknown) => { calls1.push(Ctor); return {} as Service; };
    (mod2 as any).addService = async (Ctor: unknown) => { calls2.push(Ctor); return {} as Service; };
    await stub1.fireEvent("onPreBoot");
    assert.strictEqual(calls1.length, 1);
    assert.strictEqual(calls2.length, 0);
  });
});

// ─── 16. @modules + @services combinés ───────────────────────────────────────

describe("@modules + @services combinés sur la même classe", () => {
  it("les deux décorateurs appliqués → listeners inscrits sur leurs events respectifs", () => {
    @modules("./combined-mod")
    @services(AlphaService as unknown as ServiceConstructor)
    class Combined extends Module {}
    const stub = makeKernelStub();
    createMod(Combined as typeof Module, stub);
    assert.ok(Array.isArray(stub.events["onPreRegister"]));
    assert.strictEqual(stub.events["onPreRegister"].length, 1);
    // onPreBoot: setEvents prependOnceListener + @services once
    assert.ok((stub.events["onPreBoot"] || []).length >= 2);
  });

  it("@modules déclenché sur onPreRegister, @services sur onPreBoot — indépendants", async () => {
    @modules("./combo-path")
    @services(BetaService as unknown as ServiceConstructor)
    class Combo2 extends Module {}
    const stub = makeKernelStub();
    const mod = createMod(Combo2 as typeof Module, stub);
    const addCalls: unknown[] = [];
    (mod as any).addService = async (Ctor: unknown) => { addCalls.push(Ctor); return {} as Service; };

    // Déclencher onPreRegister → loadModule seulement
    await stub.fireEvent("onPreRegister");
    assert.deepStrictEqual(stub.loadModuleCalls, [["./combo-path", false]]);
    assert.strictEqual(addCalls.length, 0);

    // Déclencher onPreBoot → addService seulement
    await stub.fireEvent("onPreBoot");
    assert.strictEqual(addCalls.length, 1);
    assert.strictEqual(addCalls[0], BetaService);
  });

  it("instanceof Module/Module subclass préservé avec double décoration", () => {
    @modules("./double")
    @services(AlphaService as unknown as ServiceConstructor)
    class DoubleDecorated extends Module {}
    const stub = makeKernelStub();
    const mod = createMod(DoubleDecorated as typeof Module, stub);
    assert.ok(mod instanceof Module);
    assert.ok(mod instanceof DoubleDecorated);
  });
});

// ─── 17. Performance ─────────────────────────────────────────────────────────

describe("@modules / @services — performance", () => {
  it("100 modules décorés @modules créés < 500ms", () => {
    @modules("./perf-path")
    class PerfMod extends Module {}
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) {
      const stub = makeKernelStub();
      createMod(PerfMod as typeof Module, stub);
    }
    const elapsed = performance.now() - t0;
    assert.ok(elapsed < 500, `100 modules decorated took ${elapsed.toFixed(1)}ms`);
  });

  it("100 fireEvent onPreRegister < 200ms", async () => {
    @modules("./perf-fire")
    class PerfFire extends Module {}
    const stubs = Array.from({ length: 100 }, () => {
      const stub = makeKernelStub();
      createMod(PerfFire as typeof Module, stub);
      return stub;
    });
    const t0 = performance.now();
    for (const stub of stubs) {
      await stub.fireEvent("onPreRegister");
    }
    const elapsed = performance.now() - t0;
    assert.ok(elapsed < 200, `100 fireEvent took ${elapsed.toFixed(1)}ms`);
  });
});
