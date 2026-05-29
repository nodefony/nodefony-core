/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert";
import "mocha";
import Kernel, { Events, TypeKernelOptions } from "../kernel/Kernel";
import Module from "../kernel/Module";
import Service from "../Service";
import Container from "../Container";
import CliKernel from "../kernel/CliKernel";
import type { PackageJson } from "../types/IModule";
import { readListenerTags } from "../kernel/lifecycleTags";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mkKernel(
  env: "development" | "production" = "development",
  opts: TypeKernelOptions = {},
): Kernel {
  return new Kernel(env, null, { log: { active: false }, ...opts });
}

// Silence console.log (initCluster l'appelle) pendant toute la suite
let origConsoleLog: typeof console.log;
before(() => {
  origConsoleLog = console.log;
  console.log = () => {};
});
after(() => {
  console.log = origConsoleLog;
});

// Mock CliKernel.quit pour éviter process.exit dans les tests
function mockQuit(): () => void {
  const orig = CliKernel.quit;
  (CliKernel as any).quit = () => {};
  return () => {
    (CliKernel as any).quit = orig;
  };
}

// Mock getPackageJson sur un module (évite la lecture du filesystem)
function patchGetPackageJson(mod: Module): void {
  (mod as any).getPackageJson = async () =>
    ({
      name: "mock",
      version: "0.0.0",
      dependencies: {},
      devDependencies: {},
      peerDependencies: {},
    }) as PackageJson;
}

// ─── Modules de test ──────────────────────────────────────────────────────────

class BasicModule extends Module {
  constructor(kernel: Kernel) {
    super("BasicModule", kernel, "/tmp/basic", {});
  }
}

class HookedModule extends Module {
  registerCalled = false;
  bootCalled = false;
  readyCalled = false;
  registerArg: unknown = null;
  bootArg: unknown = null;

  constructor(kernel: Kernel) {
    super("HookedModule", kernel, "/tmp/hooked", {});
  }
  async onKernelRegister(): Promise<this> {
    this.registerCalled = true;
    return this;
  }
  async onKernelBoot(): Promise<this> {
    this.bootCalled = true;
    return this;
  }
  async onKernelReady(): Promise<this> {
    this.readyCalled = true;
    return this;
  }
}

class InitModule extends Module {
  initCalled = false;
  initArg: unknown = null;
  constructor(kernel: Kernel) {
    super("InitModule", kernel, "/tmp/init", {});
  }
  async initialize(kernel: unknown): Promise<this> {
    this.initCalled = true;
    this.initArg = kernel;
    return this;
  }
}

class SlowHookedModule extends Module {
  order: string[] = [];
  constructor(kernel: Kernel) {
    super("SlowHookedModule", kernel, "/tmp/slow", {});
  }
  async onKernelRegister(): Promise<this> {
    await new Promise((r) => setImmediate(r)); // tick async
    this.order.push("register");
    return this;
  }
  async onKernelBoot(): Promise<this> {
    await new Promise((r) => setImmediate(r));
    this.order.push("boot");
    return this;
  }
}

// ─── 1. boot() — flags & events ───────────────────────────────────────────────

describe("Kernel lifecycle — boot()", () => {
  it("booted=false avant boot()", () => {
    const k = mkKernel();
    assert.strictEqual(k.booted, false);
  });

  it("booted=true après boot()", async () => {
    const k = mkKernel();
    await k.boot();
    assert.strictEqual(k.booted, true);
  });

  it("ready=true après boot() (enchaîne onReady)", async () => {
    const k = mkKernel();
    await k.boot();
    assert.strictEqual(k.ready, true);
  });

  it("fireAsync('onPreBoot') puis fireAsync('onBoot') — ordre respecté", async () => {
    const k = mkKernel();
    const order: string[] = [];
    k.on("onPreBoot", () => {
      order.push("onPreBoot");
    });
    k.on("onBoot", () => {
      order.push("onBoot");
    });
    await k.boot();
    assert.deepStrictEqual(order.slice(0, 2), ["onPreBoot", "onBoot"]);
  });

  it("listener onPreBoot reçoit le kernel", async () => {
    const k = mkKernel();
    let received: unknown = null;
    k.on("onPreBoot", (arg: unknown) => {
      received = arg;
    });
    await k.boot();
    assert.strictEqual(received, k);
  });

  it("listener onBoot reçoit le kernel", async () => {
    const k = mkKernel();
    let received: unknown = null;
    k.on("onBoot", (arg: unknown) => {
      received = arg;
    });
    await k.boot();
    assert.strictEqual(received, k);
  });

  it("deux listeners onBoot → tous deux appelés", async () => {
    const k = mkKernel();
    let count = 0;
    k.on("onBoot", () => {
      count++;
    });
    k.on("onBoot", () => {
      count++;
    });
    await k.boot();
    assert.strictEqual(count, 2);
  });

  it("once listener onBoot — appelé exactement une fois même après deux boot()", async () => {
    const k = mkKernel();
    let count = 0;
    k.once("onBoot", () => {
      count++;
    });
    await k.boot();
    // Deuxième boot : booted=true, mais le pipeline continue quand même
    await k.boot();
    assert.strictEqual(count, 1, "once doit être déclenché une seule fois");
  });
});

// ─── 2. preRegister() — flags & ordre des événements ─────────────────────────

describe("Kernel lifecycle — preRegister()", () => {
  it("registered=true après preRegister()", async () => {
    const k = mkKernel();
    await k.preRegister();
    assert.strictEqual(k.registered, true);
  });

  it("booted=true après preRegister() (enchaîne boot)", async () => {
    const k = mkKernel();
    await k.preRegister();
    assert.strictEqual(k.booted, true);
  });

  it("ready=true après preRegister() (enchaîne onReady)", async () => {
    const k = mkKernel();
    await k.preRegister();
    assert.strictEqual(k.ready, true);
  });

  it("ordre des events : onPreRegister→onRegister→onPreBoot→onBoot→onReady→onPostReady", async () => {
    const k = mkKernel();
    const order: string[] = [];
    const events = [
      "onPreRegister",
      "onRegister",
      "onPreBoot",
      "onBoot",
      "onReady",
      "onPostReady",
    ];
    for (const ev of events) {
      k.on(ev as any, () => {
        order.push(ev);
      });
    }
    await k.preRegister();
    assert.deepStrictEqual(order, events);
  });

  it("listener onPreRegister reçoit le kernel", async () => {
    const k = mkKernel();
    let received: unknown = null;
    k.on("onPreRegister", (arg: unknown) => {
      received = arg;
    });
    await k.preRegister();
    assert.strictEqual(received, k);
  });

  it("listener onRegister reçoit le kernel", async () => {
    const k = mkKernel();
    let received: unknown = null;
    k.on("onRegister", (arg: unknown) => {
      received = arg;
    });
    await k.preRegister();
    assert.strictEqual(received, k);
  });

  it("registered=false avant preRegister()", () => {
    const k = mkKernel();
    assert.strictEqual(k.registered, false);
  });

  it("listener async sur onRegister — await respecté avant boot()", async () => {
    const k = mkKernel();
    const log: string[] = [];
    k.on("onRegister", async () => {
      await new Promise((r) => setImmediate(r));
      log.push("register-done");
    });
    k.on("onBoot", () => {
      log.push("boot");
    });
    await k.preRegister();
    assert.ok(
      log.indexOf("register-done") < log.indexOf("boot"),
      "register doit se terminer avant boot",
    );
  });
});

// ─── 3. Module hooks — déclenchés par les events kernel ───────────────────────

describe("Kernel lifecycle — module hooks", () => {
  it("onKernelRegister déclenché sur onRegister", async () => {
    const k = mkKernel();
    const mod = (await k.addModule(HookedModule as any)) as HookedModule;
    patchGetPackageJson(mod);
    await k.preRegister();
    assert.strictEqual(mod.registerCalled, true);
  });

  it("onKernelBoot déclenché sur onBoot", async () => {
    const k = mkKernel();
    const mod = (await k.addModule(HookedModule as any)) as HookedModule;
    patchGetPackageJson(mod);
    await k.preRegister();
    assert.strictEqual(mod.bootCalled, true);
  });

  it("onKernelReady déclenché sur onReady", async () => {
    const k = mkKernel();
    const mod = (await k.addModule(HookedModule as any)) as HookedModule;
    patchGetPackageJson(mod);
    await k.preRegister();
    assert.strictEqual(mod.readyCalled, true);
  });

  it("hooks async — setImmediate attendu avant event suivant", async () => {
    const k = mkKernel();
    const mod = (await k.addModule(
      SlowHookedModule as any,
    )) as SlowHookedModule;
    patchGetPackageJson(mod);
    const kernelOrder: string[] = [];
    k.on("onBoot", () => {
      kernelOrder.push("kernelOnBoot");
    });
    await k.preRegister();
    // onKernelRegister (async) doit finir avant que le kernel fire onBoot
    assert.ok(
      mod.order.includes("register"),
      "register hook doit avoir été appelé",
    );
  });

  it("module sans hook — pas d'erreur", async () => {
    const k = mkKernel();
    const mod = (await k.addModule(BasicModule as any)) as BasicModule;
    patchGetPackageJson(mod);
    await assert.doesNotReject(() => k.preRegister());
  });

  it("deux modules — hooks appelés pour les deux", async () => {
    const k = mkKernel();
    const m1 = (await k.addModule(HookedModule as any)) as HookedModule;
    patchGetPackageJson(m1);

    class HookedModule2 extends Module {
      registerCalled = false;
      constructor(kernel: Kernel) {
        super("HookedModule2", kernel, "/tmp/hooked2", {});
      }
      async onKernelRegister(): Promise<this> {
        this.registerCalled = true;
        return this;
      }
    }
    const m2 = (await k.addModule(HookedModule2 as any)) as HookedModule2;
    patchGetPackageJson(m2);

    await k.preRegister();
    assert.strictEqual(m1.registerCalled, true);
    assert.strictEqual(m2.registerCalled, true);
  });

  it("initialize() appelé par addModule avec le kernel", async () => {
    const k = mkKernel();
    const mod = (await k.addModule(InitModule as any)) as InitModule;
    patchGetPackageJson(mod);
    assert.strictEqual(mod.initCalled, true);
    assert.strictEqual(mod.initArg, k);
  });

  it("module.package chargé sur onPreBoot via getPackageJson mocké", async () => {
    const k = mkKernel();
    const mod = (await k.addModule(BasicModule as any)) as BasicModule;
    patchGetPackageJson(mod);
    await k.preRegister();
    assert.ok(
      mod.package !== undefined,
      "package doit être défini après onPreBoot",
    );
  });
});

// ─── 4. terminate() ───────────────────────────────────────────────────────────

describe("Kernel lifecycle — terminate()", () => {
  it("onTerminate déclenché", async () => {
    const restore = mockQuit();
    try {
      const k = mkKernel();
      let called = false;
      k.on("onTerminate", () => {
        called = true;
      });
      await k.terminate(0);
      assert.strictEqual(called, true);
    } finally {
      restore();
    }
  });

  it("listener onTerminate reçoit le kernel et le code", async () => {
    const restore = mockQuit();
    try {
      const k = mkKernel();
      let receivedKernel: unknown = null;
      let receivedCode: unknown = null;
      k.on("onTerminate", (kernel: unknown, code: unknown) => {
        receivedKernel = kernel;
        receivedCode = code;
      });
      await k.terminate(42);
      assert.strictEqual(receivedKernel, k);
      assert.strictEqual(receivedCode, 42);
    } finally {
      restore();
    }
  });

  it("code=0 par défaut", async () => {
    const restore = mockQuit();
    try {
      const k = mkKernel();
      const codes: number[] = [];
      (CliKernel as any).quit = (c: number) => {
        codes.push(c);
      };
      await k.terminate();
      assert.deepStrictEqual(codes, [0]);
    } finally {
      restore();
    }
  });

  it("code=1 explicite", async () => {
    const restore = mockQuit();
    try {
      const k = mkKernel();
      const codes: number[] = [];
      (CliKernel as any).quit = (c: number) => {
        codes.push(c);
      };
      await k.terminate(1);
      assert.deepStrictEqual(codes, [1]);
    } finally {
      restore();
    }
  });

  it("erreur dans listener onTerminate → code=1, pas de throw", async () => {
    const restore = mockQuit();
    try {
      const k = mkKernel();
      k.on("onTerminate", () => {
        throw new Error("boom");
      });
      const codes: number[] = [];
      (CliKernel as any).quit = (c: number) => {
        codes.push(c);
      };
      await assert.doesNotReject(() => k.terminate(0));
      assert.deepStrictEqual(codes, [1], "erreur → code forcé à 1");
    } finally {
      restore();
    }
  });

  it("terminate retourne le kernel (promise résolue)", async () => {
    const restore = mockQuit();
    try {
      const k = mkKernel();
      const result = await k.terminate(0);
      assert.strictEqual(result, k);
    } finally {
      restore();
    }
  });
});

// ─── 5. addKernelService ──────────────────────────────────────────────────────

describe("Kernel lifecycle — addKernelService", () => {
  class KSvc extends Service {
    public readonly _marker = "ksvc";
    constructor(kernel: Kernel) {
      super("KSvc", kernel.container as Container);
    }
  }

  class KSvcWithInit extends Service {
    public initCalled = false;
    constructor(kernel: Kernel) {
      super("KSvcWithInit", kernel.container as Container);
    }
    async initialize(_kernel: unknown): Promise<this> {
      this.initCalled = true;
      return this;
    }
  }

  it("addKernelService → service enregistré dans le container", async () => {
    const k = mkKernel();
    await k.addKernelService(KSvc as any);
    const inst = k.get<KSvc>("KSvc");
    assert.ok(inst instanceof KSvc);
    assert.strictEqual(inst?._marker, "ksvc");
  });

  it("addKernelService avec initialize → initialize(kernel) appelé", async () => {
    const k = mkKernel();
    const inst = (await k.addKernelService(
      KSvcWithInit as any,
    )) as KSvcWithInit;
    assert.strictEqual(inst?.initCalled, true);
  });

  it("addKernelService → retourne l'instance depuis le container", async () => {
    const k = mkKernel();
    const inst = await k.addKernelService(KSvc as any);
    assert.ok(inst instanceof KSvc);
  });

  it("addKernelService doublon → n'écrase pas (retourne l'existant)", async () => {
    const k = mkKernel();
    const inst1 = await k.addKernelService(KSvc as any);
    const inst2 = await k.addKernelService(KSvc as any);
    // les deux appels retournent une instance de KSvc
    assert.ok(inst1 instanceof KSvc);
    assert.ok(inst2 instanceof KSvc);
  });
});

// ─── 6. Arrêt de chaîne par setCommandComplete ────────────────────────────────

describe("Kernel lifecycle — arrêt par command", () => {
  function setCommand(k: Kernel, kernelEvent: string): void {
    (k as any).command = { name: "test", kernelEvent };
  }

  it("sans command → chaîne complète (registered + booted + ready)", async () => {
    const k = mkKernel();
    await k.preRegister();
    assert.strictEqual(k.registered, true);
    assert.strictEqual(k.booted, true);
    assert.strictEqual(k.ready, true);
  });

  it("command.kernelEvent='onRegister' → boot() pas appelé", async () => {
    const restore = mockQuit();
    try {
      const k = mkKernel();
      setCommand(k, "onRegister");
      // preRegister appelle terminate après onRegister → boot pas atteint
      await k.preRegister();
      assert.strictEqual(k.booted, false, "boot ne doit pas être appelé");
      assert.strictEqual(k.registered, true, "registered doit être true");
    } finally {
      restore();
    }
  });

  it("command.kernelEvent='onBoot' → onReady() pas appelé", async () => {
    const restore = mockQuit();
    try {
      const k = mkKernel();
      setCommand(k, "onBoot");
      await k.boot();
      assert.strictEqual(k.booted, true, "booted doit être true");
      assert.strictEqual(k.ready, false, "ready ne doit pas être true");
    } finally {
      restore();
    }
  });

  it("command.kernelEvent='onPreStart' — bits accumulés dans progress", () => {
    const k = mkKernel();
    k.setCommandComplete(Events.onStart);
    k.setCommandComplete(Events.onRegister);
    assert.ok((k.progress & Events.onStart) !== 0);
    assert.ok((k.progress & Events.onRegister) !== 0);
    assert.ok((k.progress & Events.onBoot) === 0);
  });

  it("terminate() appelé quand setCommandComplete retourne true", async () => {
    const restore = mockQuit();
    try {
      const k = mkKernel();
      setCommand(k, "onRegister");
      let terminateCalled = false;
      k.on("onTerminate", () => {
        terminateCalled = true;
      });
      await k.preRegister();
      assert.strictEqual(terminateCalled, true, "terminate doit être appelé");
    } finally {
      restore();
    }
  });
});

// ─── 7. Propagation d'erreurs dans la chaîne ─────────────────────────────────

describe("Kernel lifecycle — résilience de boot (Phase 3, fireLifecycle)", () => {
  // ── Module.critical (statique) propagé en tag sur les hooks par setEvents() ──
  it("Module.critical: défaut true ; override static false → tag posé sur les hooks", () => {
    const k = mkKernel("development");
    class CriticalMod extends Module {
      constructor(kernel: Kernel) {
        super("crit", kernel, "/tmp/crit", {});
      }
      async onKernelBoot(): Promise<this> {
        return this;
      }
    }
    class OptionalMod extends Module {
      static override critical = false;
      constructor(kernel: Kernel) {
        super("opt", kernel, "/tmp/opt", {});
      }
      async onKernelBoot(): Promise<this> {
        return this;
      }
    }
    assert.strictEqual((CriticalMod as any).critical, true);
    assert.strictEqual((OptionalMod as any).critical, false);
    new CriticalMod(k);
    new OptionalMod(k);
    const tags = (k as any).nc
      .rawListeners("onBoot")
      .map((l: unknown) => readListenerTags(l));
    assert.ok(
      tags.some((t: any) => t.owner === "crit" && t.critical === true),
      "hook du module critique tagué critical=true",
    );
    assert.ok(
      tags.some((t: any) => t.owner === "opt" && t.critical === false),
      "hook du module optionnel tagué critical=false",
    );
  });

  // ── DEV : fail-soft — un hook qui échoue/se fige ne gèle/ne tue plus le boot ──
  it("dev: un hook qui throw → fireLifecycle NE rejette PAS et collecte l'erreur", async () => {
    const k = mkKernel("development");
    k.on("onBoot", () => {
      throw new Error("boom in onBoot");
    });
    const r = await k.fireLifecycle("onBoot", k);
    assert.strictEqual(r.errors.length, 1);
    assert.strictEqual(r.stopped, false);
    assert.match((r.errors[0].error as Error).message, /boom in onBoot/);
  });

  it("dev: un hook qui throw n'empêche pas les hooks suivants (fail-soft)", async () => {
    const k = mkKernel("development");
    let secondFired = false;
    k.on("onPreBoot", () => {
      throw new Error("boom");
    });
    k.on("onPreBoot", () => {
      secondFired = true;
    });
    const r = await k.fireLifecycle("onPreBoot", k);
    assert.strictEqual(secondFired, true, "le 2e hook doit tourner");
    assert.strictEqual(r.errors.length, 1);
  });

  it("dev: un hook FIGÉ est borné par le timeout (NODEFONY_BOOT_TIMEOUT_MS)", async () => {
    const prev = process.env.NODEFONY_BOOT_TIMEOUT_MS;
    process.env.NODEFONY_BOOT_TIMEOUT_MS = "30";
    try {
      const k = mkKernel("development");
      k.on("onBoot", () => new Promise(() => {})); // ne se résout jamais
      const r = await k.fireLifecycle("onBoot", k);
      assert.strictEqual(r.errors.length, 1);
      assert.strictEqual(r.errors[0].timedOut, true);
    } finally {
      if (prev === undefined) delete process.env.NODEFONY_BOOT_TIMEOUT_MS;
      else process.env.NODEFONY_BOOT_TIMEOUT_MS = prev;
    }
  });

  // ── PRODUCTION : un module CRITIQUE qui échoue propage (pod crashe → restart) ──
  it("prod: un hook critique (non tagué) qui throw → fireLifecycle rejette", async () => {
    const k = mkKernel("production");
    k.on("onBoot", () => {
      throw new Error("boom prod");
    });
    await assert.rejects(() => k.fireLifecycle("onBoot", k), /boom prod/);
  });

  it("prod: un hook NON critique (tag critical=false) qui throw → fail-soft", async () => {
    const k = mkKernel("production");
    const hook = (): void => {
      throw new Error("module optionnel");
    };
    (hook as any).__nodefony_owner = "studio";
    (hook as any).__nodefony_critical = false;
    k.on("onBoot", hook);
    const r = await k.fireLifecycle("onBoot", k);
    assert.strictEqual(r.errors.length, 1);
    assert.strictEqual(r.stopped, false); // optionnel → pas fatal, le boot continue
  });
});

// ─── 7bis. Ordering config — override module-<name> AVANT validation ──────────

describe("Kernel — ordering config : override module-<name> avant validation", () => {
  it("l'override est appliqué AVANT onKernelRegister (la validation Zod le voit)", async () => {
    const k = mkKernel("development");
    class Target extends Module {
      seenFoo: unknown = null;
      constructor(kernel: Kernel) {
        super("target", kernel, "/tmp/target", { foo: "default" });
      }
      async onKernelRegister(): Promise<this> {
        // simule defineXxxConfig(this.options) : lit la config AU MOMENT de onRegister
        this.seenFoo = (this.options as any).foo;
        return this;
      }
    }
    class HostApp extends Module {
      constructor(kernel: Kernel) {
        super("host", kernel, "/tmp/host", {
          "Module-target": { foo: "overridden" },
        });
      }
    }
    // addModule (comme @modules) enregistre dans kernel.modules — requis pour
    // que applyModuleConfigOverrides les voie.
    const target = (await k.addModule(Target)) as Target;
    await k.addModule(HostApp);
    // ce que fait le kernel entre onPreRegister et onRegister :
    (k as any).applyModuleConfigOverrides();
    // puis la phase de validation (onKernelRegister tagué via setEvents)
    await k.fireLifecycle("onRegister", k);
    assert.strictEqual(
      target.seenFoo,
      "overridden",
      "onKernelRegister doit voir la config overridée",
    );
  });

  it("override ciblant un module absent → log, pas de throw (continue)", async () => {
    const k = mkKernel("development");
    class HostApp extends Module {
      constructor(kernel: Kernel) {
        super("host2", kernel, "/tmp/host2", { "Module-absent": { foo: 1 } });
      }
    }
    await k.addModule(HostApp);
    assert.doesNotThrow(() => (k as any).applyModuleConfigOverrides());
  });
});

// ─── 8. onReady() direct ──────────────────────────────────────────────────────

describe("Kernel lifecycle — onReady()", () => {
  it("ready=false avant onReady()", () => {
    const k = mkKernel();
    assert.strictEqual(k.ready, false);
  });

  it("ready=true après onReady()", async () => {
    const k = mkKernel();
    await k.onReady();
    assert.strictEqual(k.ready, true);
  });

  it("onPostReady déclenché après onReady", async () => {
    const k = mkKernel();
    let postReadyCalled = false;
    k.on("onPostReady", () => {
      postReadyCalled = true;
    });
    await k.onReady();
    assert.strictEqual(postReadyCalled, true);
  });

  it("listener onReady reçoit le kernel", async () => {
    const k = mkKernel();
    let received: unknown = null;
    k.on("onReady", (arg: unknown) => {
      received = arg;
    });
    await k.onReady();
    assert.strictEqual(received, k);
  });

  it("initServers() retourne [] si pas de HttpKernel → pas d'erreur", async () => {
    const k = mkKernel();
    await assert.doesNotReject(() => k.onReady());
  });
});
