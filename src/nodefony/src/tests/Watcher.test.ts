/* eslint-disable @typescript-eslint/no-explicit-any */
/*
 *   NODEFONY FRAMEWORK UNIT TEST — Watcher service
 *
 *   Mocha + chai
 */

import { assert, expect } from "chai";
import "mocha";
import Watcher, { HotReloadHook } from "../service/watcherService";
import Service from "../Service";
import Container from "../Container";
import Kernel, { TypeKernelOptions } from "../kernel/Kernel";
import Module from "../kernel/Module";
import type { OutputOptions } from "rollup";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mkKernel(opts: TypeKernelOptions = {}): Kernel {
  return new Kernel("development", null, { log: { active: false }, ...opts });
}

// Faux rollup service — extends Service pour avoir l'API on/off/fireAsync.
// IMPORTANT : Service ne s'auto-enregistre PAS dans le container — il faut
// appeler container.set("rollup", instance) après construction.
class FakeRollup extends Service {
  constructor(container: Container) {
    super("rollup", container);
    container.set("rollup", this);
  }
  async emitBundleEnd(module: Module, output: OutputOptions): Promise<void> {
    await this.fireAsync("rollup:bundle:end", module, output);
  }
}

// Mock minimal de Module — on n'a besoin que de `.name`.
function fakeModule(name: string): Module {
  return { name } as unknown as Module;
}

const fakeOutput: OutputOptions = { dir: "/tmp/fake-dist" };

// Silence console.log (initCluster) pendant la suite.
let origConsoleLog: typeof console.log;
before(() => {
  origConsoleLog = console.log;
  console.log = () => {};
});
after(() => {
  console.log = origConsoleLog;
});

// ─── Construction ─────────────────────────────────────────────────────────────

describe("Watcher — construction", () => {
  it("crée un service nommé 'watcher'", () => {
    const kernel = mkKernel();
    const w = new Watcher(kernel);
    assert.strictEqual(w.name, "watcher");
    assert(w instanceof Service);
  });

  it("expose getRegisteredModules() vide par défaut", () => {
    const kernel = mkKernel();
    const w = new Watcher(kernel);
    assert.deepStrictEqual(w.getRegisteredModules(), []);
  });
});

// ─── register / unregister ────────────────────────────────────────────────────

describe("Watcher — register / unregister", () => {
  it("register ajoute le module à la liste", () => {
    const kernel = mkKernel();
    const container = kernel.container as Container;
    new FakeRollup(container); // s'auto-enregistre via Service constructor
    const w = new Watcher(kernel);

    w.register("modA", async () => {});
    assert.deepStrictEqual(w.getRegisteredModules(), ["modA"]);
  });

  it("register plusieurs modules — la liste suit", () => {
    const kernel = mkKernel();
    new FakeRollup(kernel.container as Container);
    const w = new Watcher(kernel);

    w.register("modA", async () => {});
    w.register("modB", async () => {});
    assert.deepStrictEqual(w.getRegisteredModules().sort(), ["modA", "modB"]);
  });

  it("register du même module — overwrite le hook", async () => {
    const kernel = mkKernel();
    const rollup = new FakeRollup(kernel.container as Container);
    const w = new Watcher(kernel);

    const calls: string[] = [];
    w.register("modA", async () => {
      calls.push("first");
    });
    w.register("modA", async () => {
      calls.push("second");
    });

    await rollup.emitBundleEnd(fakeModule("modA"), fakeOutput);
    assert.deepStrictEqual(calls, ["second"]);
  });

  it("unregister retire le module", () => {
    const kernel = mkKernel();
    new FakeRollup(kernel.container as Container);
    const w = new Watcher(kernel);

    w.register("modA", async () => {});
    w.register("modB", async () => {});
    w.unregister("modA");
    assert.deepStrictEqual(w.getRegisteredModules(), ["modB"]);
  });

  it("unregister du dernier module → détache le listener (compteur 0)", () => {
    const kernel = mkKernel();
    const rollup = new FakeRollup(kernel.container as Container);
    const w = new Watcher(kernel);

    w.register("modA", async () => {});
    assert.strictEqual(rollup.listenerCount("rollup:bundle:end"), 1);

    w.unregister("modA");
    assert.strictEqual(rollup.listenerCount("rollup:bundle:end"), 0);
    assert.deepStrictEqual(w.getRegisteredModules(), []);
  });

  it("register sans rollup service → throw", () => {
    const kernel = mkKernel();
    const w = new Watcher(kernel);
    expect(() => w.register("modA", async () => {})).to.throw(
      /Rollup not defined/,
    );
  });
});

// ─── Lazy alloc + listener unique ─────────────────────────────────────────────

describe("Watcher — lazy alloc", () => {
  it("aucun listener attaché tant que register n'est pas appelé", () => {
    const kernel = mkKernel();
    const rollup = new FakeRollup(kernel.container as Container);
    new Watcher(kernel);
    assert.strictEqual(rollup.listenerCount("rollup:bundle:end"), 0);
  });

  it("un seul listener attaché même avec N register", () => {
    const kernel = mkKernel();
    const rollup = new FakeRollup(kernel.container as Container);
    const w = new Watcher(kernel);

    w.register("a", async () => {});
    w.register("b", async () => {});
    w.register("c", async () => {});

    assert.strictEqual(rollup.listenerCount("rollup:bundle:end"), 1);
  });
});

// ─── Dispatch ─────────────────────────────────────────────────────────────────

describe("Watcher — dispatch hot-reload", () => {
  it("rollup:bundle:end → hot-reload appelé avec (module, output)", async () => {
    const kernel = mkKernel();
    const rollup = new FakeRollup(kernel.container as Container);
    const w = new Watcher(kernel);

    let received: { mod?: Module; out?: OutputOptions } = {};
    w.register("modA", async (mod, out) => {
      received = { mod, out };
    });

    const mod = fakeModule("modA");
    await rollup.emitBundleEnd(mod, fakeOutput);

    assert.strictEqual(received.mod, mod);
    assert.strictEqual(received.out, fakeOutput);
  });

  it("isolation : event pour modB ne déclenche pas le hook de modA", async () => {
    const kernel = mkKernel();
    const rollup = new FakeRollup(kernel.container as Container);
    const w = new Watcher(kernel);

    let called = false;
    w.register("modA", async () => {
      called = true;
    });

    await rollup.emitBundleEnd(fakeModule("modB"), fakeOutput);
    assert.strictEqual(called, false);
  });

  it("après unregister, plus aucun dispatch", async () => {
    const kernel = mkKernel();
    const rollup = new FakeRollup(kernel.container as Container);
    const w = new Watcher(kernel);

    let count = 0;
    w.register("modA", async () => {
      count++;
    });

    await rollup.emitBundleEnd(fakeModule("modA"), fakeOutput);
    assert.strictEqual(count, 1);

    w.unregister("modA");
    await rollup.emitBundleEnd(fakeModule("modA"), fakeOutput);
    assert.strictEqual(count, 1, "ne doit pas être ré-appelé après unregister");
  });

  it("hook async qui throw → erreur catchée (pas de crash)", async () => {
    const kernel = mkKernel();
    const rollup = new FakeRollup(kernel.container as Container);
    const w = new Watcher(kernel);

    w.register("modA", async () => {
      throw new Error("boom async");
    });

    // Ne doit PAS rejeter — l'erreur est avalée par le wrapper try/catch.
    await rollup.emitBundleEnd(fakeModule("modA"), fakeOutput);
  });

  it("hook sync qui throw → erreur catchée", async () => {
    const kernel = mkKernel();
    const rollup = new FakeRollup(kernel.container as Container);
    const w = new Watcher(kernel);

    const hook: HotReloadHook = () => {
      throw new Error("boom sync");
    };
    w.register("modA", hook);

    await rollup.emitBundleEnd(fakeModule("modA"), fakeOutput);
  });
});

// ─── createRollupWatcher ──────────────────────────────────────────────────────

describe("Watcher — createRollupWatcher", () => {
  it("throw si service rollup absent", async () => {
    const kernel = mkKernel();
    const w = new Watcher(kernel);
    const mod = fakeModule("modA");
    let err: Error | null = null;
    try {
      await w.createRollupWatcher(mod, {} as any);
    } catch (e) {
      err = e as Error;
    }
    assert(err);
    assert.match(err!.message, /Rollup not defined/);
  });

  it("délègue à rollupService.watch quand présent", async () => {
    const kernel = mkKernel();
    const rollup = new FakeRollup(kernel.container as Container);
    const w = new Watcher(kernel);

    const sentinel = { __sentinel: true };
    (rollup as any).watch = async (mod: Module) => {
      return { mod, sentinel } as any;
    };

    const mod = fakeModule("modA");
    const result = (await w.createRollupWatcher(mod, {} as any)) as any;
    assert.strictEqual(result.mod, mod);
    assert.strictEqual(result.sentinel, sentinel);
  });
});

// ─── Cleanup onTerminate ──────────────────────────────────────────────────────

describe("Watcher — cleanup onTerminate", () => {
  it("fire 'onTerminate' sur le kernel → détache le listener", () => {
    const kernel = mkKernel();
    const rollup = new FakeRollup(kernel.container as Container);
    const w = new Watcher(kernel);

    w.register("modA", async () => {});
    assert.strictEqual(rollup.listenerCount("rollup:bundle:end"), 1);

    kernel.fire("onTerminate");
    assert.strictEqual(rollup.listenerCount("rollup:bundle:end"), 0);
    assert.deepStrictEqual(w.getRegisteredModules(), []);
  });
});
