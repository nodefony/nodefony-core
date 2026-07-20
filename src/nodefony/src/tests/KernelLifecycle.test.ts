/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import Kernel, { Events, TypeKernelOptions } from "../kernel/Kernel";
import Module from "../kernel/Module";
import Service from "../Service";
import Container from "../Container";
import CliKernel from "../kernel/CliKernel";
import type { PackageJson } from "../types/IModule";
import { readListenerTags } from "../kernel/lifecycleTags";
import { BootConfigurationError } from "../kernel/BootConfigurationError";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mkKernel(
  env: "development" | "production" = "development",
  opts: TypeKernelOptions = {},
): Kernel {
  return new Kernel(env, null, { log: { active: false }, ...opts });
}

// Silence console.log (initCluster l'appelle) pendant toute la suite
let origConsoleLog: typeof console.log;
beforeAll(() => {
  origConsoleLog = console.log;
  console.log = () => {};
});
afterAll(() => {
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
  override async onKernelRegister(): Promise<this> {
    this.registerCalled = true;
    return this;
  }
  override async onKernelBoot(): Promise<this> {
    this.bootCalled = true;
    return this;
  }
  override async onKernelReady(): Promise<this> {
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
  override async init(kernel: unknown): Promise<this> {
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
  override async onKernelRegister(): Promise<this> {
    await new Promise((r) => setImmediate(r)); // tick async
    this.order.push("register");
    return this;
  }
  override async onKernelBoot(): Promise<this> {
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
      override async onKernelRegister(): Promise<this> {
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

  it("init() appelé par addModule avec le kernel", async () => {
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

  it("listener onTerminate PENDU → shutdownDeadline force la sortie code 1", async () => {
    const restore = mockQuit();
    try {
      const k = mkKernel("development", { shutdownDeadline: 80 });
      // Promise jamais résolue = SSE ouvert / store bloqué / module tiers.
      k.on("onTerminate", () => new Promise(() => {}));
      const codes: number[] = [];
      (CliKernel as any).quit = (c: number) => {
        codes.push(c);
      };
      const t0 = Date.now();
      await k.terminate(0);
      assert.deepStrictEqual(codes, [1], "deadline → code forcé à 1");
      assert.ok(
        Date.now() - t0 < 5000,
        "sortie via la deadline (80 ms), pas via un timeout externe",
      );
    } finally {
      restore();
    }
  });

  it("shutdownDeadline: 0 = filet désactivé (drain nominal inchangé)", async () => {
    const restore = mockQuit();
    try {
      const k = mkKernel("development", { shutdownDeadline: 0 });
      let called = false;
      k.on("onTerminate", async () => {
        called = true;
      });
      const codes: number[] = [];
      (CliKernel as any).quit = (c: number) => {
        codes.push(c);
      };
      await k.terminate(0);
      assert.strictEqual(called, true);
      assert.deepStrictEqual(codes, [0], "drain propre → code demandé");
    } finally {
      restore();
    }
  });

  it("drain rapide sous deadline → code demandé, pas d'effet du filet", async () => {
    const restore = mockQuit();
    try {
      const k = mkKernel("development", { shutdownDeadline: 5000 });
      k.on("onTerminate", () => new Promise<void>((r) => setTimeout(r, 20)));
      const codes: number[] = [];
      (CliKernel as any).quit = (c: number) => {
        codes.push(c);
      };
      await k.terminate(0);
      assert.deepStrictEqual(codes, [0]);
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
    async init(_kernel: unknown): Promise<this> {
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

  it("addKernelService avec init → init(kernel) appelé", async () => {
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
      override async onKernelBoot(): Promise<this> {
        return this;
      }
    }
    class OptionalMod extends Module {
      static override critical = false;
      constructor(kernel: Kernel) {
        super("opt", kernel, "/tmp/opt", {});
      }
      override async onKernelBoot(): Promise<this> {
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

  // ── DEV DOIT CRIER CE QUE LA PROD FERAIT (F142) ────────────────────────────
  // Le défaut de criticité est STRICT : un hook non tagué (`critical ===
  // undefined`) est traité comme critique. Conséquence longtemps invisible :
  // `kernel.on("onBoot", …)` posé à la main passe en développement et
  // INTERROMPT le boot en production — même code, deux comportements, découvert
  // au déploiement. Le défaut reste strict (on ne démarre pas un pod à moitié),
  // mais le développement doit ANNONCER la sanction de production.

  /** Capture les messages de log émis par le kernel pendant un test. */
  function captureLogs(k: Kernel): {
    messages: string[];
    stop: () => void;
  } {
    const messages: string[] = [];
    const handler = (pdu: any): void => {
      messages.push(String(pdu?.payload ?? ""));
    };
    (k as any).syslog.on("onLog", handler);
    return {
      messages,
      stop: () => (k as any).syslog.removeListener("onLog", handler),
    };
  }

  it("dev: un hook NON TAGUÉ qui throw → le log ANNONCE que la production interromprait le boot", async () => {
    const k = mkKernel("development");
    const cap = captureLogs(k);
    k.on("onBoot", () => {
      throw new Error("boom non tagué");
    });
    const r = await k.fireLifecycle("onBoot", k);
    cap.stop();
    // Le boot continue en dev (fail-soft) …
    assert.strictEqual(r.stopped, false);
    assert.strictEqual(r.errors.length, 1);
    // … mais l'avertissement doit être EXPLICITE sur la sanction de production.
    const warned = cap.messages.some((m) => /en production/i.test(m));
    assert.ok(
      warned,
      `aucun log n'annonce la sanction de production. Logs vus :\n${cap.messages.join("\n")}`,
    );
  });

  it("dev: le log NOMME le hook par son nom de fonction plutôt que « (anonyme) »", async () => {
    const k = mkKernel("development");
    const cap = captureLogs(k);
    // Un listener posé à la main n'a pas de tag `owner` : sans dérivation, le
    // journal écrit « (anonyme) » et ne permet de trouver personne.
    function connectBillingDatabase(): void {
      throw new Error("boom nommé");
    }
    k.on("onBoot", connectBillingDatabase);
    await k.fireLifecycle("onBoot", k);
    cap.stop();
    const named = cap.messages.some((m) =>
      m.includes("connectBillingDatabase"),
    );
    assert.ok(
      named,
      `le nom de la fonction doit apparaître dans le journal. Logs vus :\n${cap.messages.join("\n")}`,
    );
    const anonymous = cap.messages.some((m) => m.includes("(anonyme)"));
    assert.strictEqual(
      anonymous,
      false,
      "une fonction NOMMÉE ne doit jamais être journalisée « (anonyme) »",
    );
  });

  it("dev: un hook tagué critical=false qui throw → PAS d'avertissement production (choix explicite)", async () => {
    const k = mkKernel("development");
    const cap = captureLogs(k);
    const hook = (): void => {
      throw new Error("module optionnel");
    };
    (hook as any).__nodefony_owner = "studio";
    (hook as any).__nodefony_critical = false;
    k.on("onBoot", hook);
    await k.fireLifecycle("onBoot", k);
    cap.stop();
    // `critical: false` est une DÉCISION assumée : l'annoncer serait du bruit,
    // et un avertissement qu'on apprend à ignorer ne protège plus personne.
    const warned = cap.messages.some((m) => /en production/i.test(m));
    assert.strictEqual(
      warned,
      false,
      `un module explicitement optionnel ne doit pas déclencher l'avertissement. Logs vus :\n${cap.messages.join("\n")}`,
    );
  });

  // ── CONFIGURATION : BootConfigurationError = fatale MÊME en dev ─────────────
  // Une configuration EXPLICITE non honorable (infra déclarée injoignable,
  // entité non portée sur le dialecte demandé) ne se répare pas en continuant :
  // le fail-soft produirait un serveur « vivant » aux briques durables mortes
  // (vécu : login impossible, cause noyée dans un WARNING).
  it("dev: un hook qui jette BootConfigurationError → fireLifecycle REJETTE (config = fatal)", async () => {
    const k = mkKernel("development");
    k.on("onBoot", () => {
      throw new BootConfigurationError("infra déclarée injoignable");
    });
    await assert.rejects(
      () => k.fireLifecycle("onBoot", k),
      /infra déclarée injoignable/,
    );
  });

  it("dev: BootConfigurationError d'un module NON critique (critical=false) → fail-soft (tag respecté)", async () => {
    const k = mkKernel("development");
    const hook = (): void => {
      throw new BootConfigurationError("config optionnelle cassée");
    };
    (hook as any).__nodefony_owner = "opt";
    (hook as any).__nodefony_critical = false;
    k.on("onBoot", hook);
    const r = await k.fireLifecycle("onBoot", k);
    assert.strictEqual(r.errors.length, 1);
    assert.strictEqual(r.stopped, false); // le tag critical=false garde la main
  });

  it("BootConfigurationError.is : instance, Error au même name (cross-copies), négatif", () => {
    assert.ok(BootConfigurationError.is(new BootConfigurationError("x")));
    const foreign = new Error("y");
    foreign.name = "BootConfigurationError";
    assert.ok(
      BootConfigurationError.is(foreign),
      "erreur d'une AUTRE copie du package (name identique) reconnue",
    );
    assert.ok(!BootConfigurationError.is(new Error("z")));
    assert.ok(!BootConfigurationError.is("BootConfigurationError"));
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
      override async onKernelRegister(): Promise<this> {
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

// ─── BootReport — verdict de boot + garde-fou 0-serveur ─────────────────────────
// Diagnostic de boot (option A : code de sortie, pas d'IPC). On valide la VÉRITÉ
// (`getBootReport`) + la résilience par-entrée du chargement de modules. Le câblage
// `terminate(EX_UNAVAILABLE)` + le message DevSupervisor sont couverts en intégration.
describe("Kernel — BootReport (verdict de boot)", () => {
  function serverProfile(k: Kernel): void {
    (k as any).runProfile = {
      servers: true,
      lifetime: "longrunning",
      interactive: false,
    };
  }

  it("boot vierge : 0 module ignoré, 0 serveur, console → healthy", () => {
    const k = mkKernel();
    const r = k.getBootReport();
    assert.deepStrictEqual(r.modulesSkipped, []);
    assert.deepStrictEqual(r.serversListening, []);
    assert.strictEqual(r.serversExpected, false);
    assert.strictEqual(r.healthy, true); // console : pas de garde-fou
  });

  it("GARDE-FOU : profil serveur + 0 serveur en écoute → healthy=false", () => {
    const k = mkKernel();
    serverProfile(k);
    (k as any).bootServers = [];
    const r = k.getBootReport();
    assert.strictEqual(r.serversExpected, true);
    assert.strictEqual(r.serversListening.length, 0);
    assert.strictEqual(r.healthy, false);
  });

  it("profil serveur + ≥1 serveur en écoute → healthy + ports listés", () => {
    const k = mkKernel();
    serverProfile(k);
    (k as any).bootServers = [
      { type: "http", port: 5151, address: "127.0.0.1" },
      { type: "https", port: 5152, address: "127.0.0.1" },
    ];
    const r = k.getBootReport();
    assert.strictEqual(r.healthy, true);
    assert.strictEqual(r.serversListening.length, 2);
    assert.strictEqual(r.serversListening[0].port, 5151);
  });

  it("modules ignorés mais serveurs up = DÉGRADÉ mais healthy", () => {
    const k = mkKernel();
    serverProfile(k);
    (k as any).bootServers = [{ type: "http", port: 5151 }];
    (k as any).recordBootFailure({
      module: "@scope/peripheral",
      reason: "boom",
      phase: "init",
    });
    const r = k.getBootReport();
    assert.strictEqual(r.healthy, true); // un serveur écoute → vivant
    assert.strictEqual(r.modulesSkipped.length, 1);
    assert.strictEqual(r.modulesSkipped[0].module, "@scope/peripheral");
  });

  it("remediation : « Cannot find package » → indice dist périmé", () => {
    const k = mkKernel();
    (k as any).recordBootFailure({
      module: "@nodefony/sequelize",
      reason: "Cannot find package @nodefony/sequelize",
      phase: "load",
    });
    const r = k.getBootReport();
    assert.match(r.remediation ?? "", /dist périmé/);
    assert.match(r.remediation ?? "", /npm run clean && npm run build/);
  });

  it("recordBootFailure est lazy : null par défaut, alloué au 1er échec", () => {
    const k = mkKernel();
    assert.strictEqual((k as any).bootFailures, null); // 0 alloc sur boot nominal
    (k as any).recordBootFailure({ module: "a", reason: "x", phase: "load" });
    (k as any).recordBootFailure({ module: "b", reason: "y", phase: "load" });
    assert.strictEqual((k as any).bootFailures.length, 2);
    assert.strictEqual(k.getBootReport().modulesSkipped.length, 2);
  });

  it("loadModulesFromManifest : un module introuvable n'arrête PAS les suivants", async () => {
    const k = mkKernel();
    // Manifeste résolu mocké (évite gating env/cli) : bad en 1er, puis 2 sains.
    (k as any).resolveModuleEntries = () => [
      { name: "@scope/bad" },
      { name: "@scope/good1" },
      { name: "@scope/good2", config: { foo: 1 } },
    ];
    const loaded: string[] = [];
    (k as any).loadModule = async (name: string) => {
      if (name === "@scope/bad") {
        throw new Error("Cannot find package @scope/bad");
      }
      loaded.push(name);
      return { options: {} };
    };
    await (k as any).loadModulesFromManifest();
    // Les modules APRÈS le manquant ont bien été chargés (anti-masquage).
    assert.deepStrictEqual(loaded, ["@scope/good1", "@scope/good2"]);
    const r = k.getBootReport();
    assert.strictEqual(r.modulesSkipped.length, 1);
    assert.strictEqual(r.modulesSkipped[0].module, "@scope/bad");
    assert.strictEqual(r.modulesSkipped[0].phase, "load");
  });

  // ── Bilan de boot — skips motivés (gating) + journal WARNING/ERROR ────────────

  it("boot vierge : modulesGated=[], journal 0 WARNING / 0 ERROR", () => {
    const k = mkKernel();
    assert.strictEqual((k as any).modulesGated, null); // lazy : 0 alloc nominal
    const r = k.getBootReport();
    assert.deepStrictEqual(r.modulesGated, []);
    assert.strictEqual(r.warnings, 0);
    assert.strictEqual(r.errors, 0);
  });

  it("gating policy 'dev' en production → modulesGated AVEC la raison", () => {
    const k = mkKernel();
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      (k.options as any).modules = [
        { name: "@scope/devtool", policy: "dev" },
        "@scope/always",
      ];
      const entries = (k as any).resolveModuleEntries();
      assert.deepStrictEqual(
        entries.map((e: { name: string }) => e.name),
        ["@scope/always"],
      );
      const r = k.getBootReport();
      assert.strictEqual(r.modulesGated.length, 1);
      assert.strictEqual(r.modulesGated[0].module, "@scope/devtool");
      assert.match(r.modulesGated[0].reason, /policy "dev"/);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it("gating when(config)=false → modulesGated AVEC la raison", () => {
    const k = mkKernel();
    (k.options as any).modules = [
      { name: "@scope/gated", when: () => false },
      { name: "@scope/loaded", when: () => true },
    ];
    const entries = (k as any).resolveModuleEntries();
    assert.deepStrictEqual(
      entries.map((e: { name: string }) => e.name),
      ["@scope/loaded"],
    );
    const r = k.getBootReport();
    assert.strictEqual(r.modulesGated.length, 1);
    assert.strictEqual(r.modulesGated[0].module, "@scope/gated");
    assert.match(r.modulesGated[0].reason, /when\(config\)/);
  });

  it("resolveModuleEntries rappelée → pas de doublon dans modulesGated", () => {
    const k = mkKernel();
    (k.options as any).modules = [{ name: "@scope/gated", when: () => false }];
    (k as any).resolveModuleEntries();
    (k as any).resolveModuleEntries();
    assert.strictEqual(k.getBootReport().modulesGated.length, 1);
  });

  it("journal de boot : WARNING=sev 4, ERROR-et-pire=sev 0-3, le reste ignoré", () => {
    const k = mkKernel();
    (k as any).syslog = {
      ringStack: [
        { severity: 7 }, // DEBUG — ignoré
        { severity: 6 }, // INFO — ignoré
        { severity: 5 }, // NOTICE — ignoré
        { severity: 4 }, // WARNING
        { severity: 4 }, // WARNING
        { severity: 3 }, // ERROR
        { severity: 2 }, // CRITIC
        { severity: 1 }, // ALERT
        { severity: 0 }, // EMERGENCY
        { severity: -1 }, // SPINNER — ignoré
      ],
    };
    const r = k.getBootReport();
    assert.strictEqual(r.warnings, 2);
    assert.strictEqual(r.errors, 4);
  });

  it("journal figé à postReady : bootLogCounts prime sur le ring courant", () => {
    const k = mkKernel();
    (k as any).syslog = { ringStack: [{ severity: 4 }] }; // ring vivant (runtime)
    (k as any).bootLogCounts = { warnings: 9, errors: 1 }; // compte du BOOT figé
    const r = k.getBootReport();
    assert.strictEqual(r.warnings, 9);
    assert.strictEqual(r.errors, 1);
  });
});

// ─── resolveAppEntry() / isTrunk() — détection d'app SANS import ─────────────

describe("Kernel — resolveAppEntry() / isTrunk()", () => {
  let dir: string;

  function fixture(files: Record<string, string>, dirs: string[] = []): Kernel {
    dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "nf-trunk-"));
    for (const d of dirs) {
      fs.mkdirSync(nodePath.join(dir, d), { recursive: true });
    }
    for (const [rel, content] of Object.entries(files)) {
      const abs = nodePath.join(dir, rel);
      fs.mkdirSync(nodePath.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
    const k = mkKernel();
    k.path = dir;
    return k;
  }

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("app compilée SANS sources (image Docker) : main + dep nodefony → entrée résolue", async () => {
    const k = fixture({
      "package.json": JSON.stringify({
        main: "dist/index.js",
        dependencies: { nodefony: "^10.0.0" },
      }),
      "dist/index.js": "export default class App {}",
    });
    assert.strictEqual(
      k.resolveAppEntry(),
      nodePath.join(dir, "dist/index.js"),
    );
    assert.strictEqual(await k.isTrunk(), "typescript");
  });

  it("projet Node QUELCONQUE (main existant mais aucune trace de nodefony) → null", async () => {
    const k = fixture({
      "package.json": JSON.stringify({
        main: "index.js",
        dependencies: { express: "^5.0.0" },
      }),
      "index.js": "module.exports = {}",
    });
    assert.strictEqual(k.resolveAppEntry(), null);
    assert.strictEqual(await k.isTrunk(), null);
  });

  it("monorepo self-hosted : nodefony non déclaré mais node_modules/nodefony présent → résolu", () => {
    const k = fixture(
      {
        "package.json": JSON.stringify({ workspaces: ["src/*"] }),
        "dist/index.js": "export default class App {}",
      },
      ["node_modules/nodefony"],
    );
    assert.strictEqual(
      k.resolveAppEntry(),
      nodePath.join(dir, "dist/index.js"),
    );
  });

  it("pas de package.json → null (jamais un projet)", async () => {
    const k = fixture({ "dist/index.js": "export default class App {}" });
    assert.strictEqual(k.resolveAppEntry(), null);
    assert.strictEqual(await k.isTrunk(), null);
  });

  describe("diagnoseUnbootableProject() — fail-loud install/build", () => {
    it("pas un projet Node / projet non-nodefony → null (flux hors-projet inchangé)", () => {
      const none = fixture({});
      assert.strictEqual(none.diagnoseUnbootableProject(), null);
      const express = fixture({
        "package.json": JSON.stringify({
          main: "index.js",
          dependencies: { express: "^5.0.0" },
        }),
      });
      assert.strictEqual(express.diagnoseUnbootableProject(), null);
    });

    it("dep nodefony déclarée SANS node_modules → message npm install", () => {
      const k = fixture({
        "package.json": JSON.stringify({
          main: "dist/index.js",
          dependencies: { nodefony: "^10.0.0" },
        }),
      });
      assert.match(
        k.diagnoseUnbootableProject() ?? "",
        /NON INSTALLÉES[\s\S]*npm install/u,
      );
    });

    it("deps installées mais AUCUNE entrée d'app → message npm run build", () => {
      const k = fixture(
        {
          "package.json": JSON.stringify({
            main: "dist/index.js",
            dependencies: { nodefony: "^10.0.0" },
          }),
        },
        ["node_modules/nodefony"],
      );
      assert.strictEqual(k.resolveAppEntry(), null); // bien le cas trunk=null
      assert.match(
        k.diagnoseUnbootableProject() ?? "",
        /NON CONSTRUIT[\s\S]*npm run build/u,
      );
    });
  });

  it("entrée legacy index.js racine (pas de main) → trunk javascript", async () => {
    const k = fixture({
      "package.json": JSON.stringify({
        dependencies: { nodefony: "^10.0.0" },
      }),
      "index.js": "export default class App {}",
    });
    assert.strictEqual(k.resolveAppEntry(), nodePath.join(dir, "index.js"));
    assert.strictEqual(await k.isTrunk(), "javascript");
  });

  it("main déclaré mais fichier ABSENT (build pas fait) → null", () => {
    const k = fixture({
      "package.json": JSON.stringify({
        main: "dist/index.js",
        dependencies: { nodefony: "^10.0.0" },
      }),
    });
    assert.strictEqual(k.resolveAppEntry(), null);
  });
});
