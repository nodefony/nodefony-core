/**
 * Ordre d'arrêt du noyau (ADR-0027) : `onDrain` (cesser de servir, écouteurs
 * ensemble) puis `onTerminate` (libérer, du dernier inscrit au premier, un à
 * la fois) ; un échec n'interrompt pas la phase ; une inscription faite pendant
 * la phase est honorée.
 */
import assert from "node:assert";
import Kernel from "../kernel/Kernel";
import type { TypeKernelOptions } from "../kernel/Kernel";
import CliKernel from "../kernel/CliKernel";

function mkKernel(opts: TypeKernelOptions = {}): Kernel {
  return new Kernel("development", null, { log: { active: false }, ...opts });
}

let origQuit: typeof CliKernel.quit;
let codes: number[] = [];
let origConsoleLog: typeof console.log;

beforeAll(() => {
  origConsoleLog = console.log;
  console.log = () => {};
});
afterAll(() => {
  console.log = origConsoleLog;
});
beforeEach(() => {
  codes = [];
  origQuit = CliKernel.quit;
  Object.defineProperty(CliKernel, "quit", {
    value: (code: number) => {
      codes.push(code);
    },
    configurable: true,
    writable: true,
  });
});
afterEach(() => {
  Object.defineProperty(CliKernel, "quit", {
    value: origQuit,
    configurable: true,
    writable: true,
  });
});

/** Promesse dont on tient la résolution. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("Arrêt du noyau — onTerminate dans l'ordre inverse (ADR-0027 D3)", () => {
  it("la dépendance inscrite d'abord est encore ouverte quand le dépendant s'arrête", async () => {
    const k = mkKernel();
    let resourceOpen = true;
    let seenByDependent: boolean | null = null;
    // La ressource (Redis, base) s'inscrit à sa construction, donc d'abord.
    k.once("onTerminate", () => {
      resourceOpen = false;
    });
    // Le dépendant (temps réel, audit) s'inscrit plus tard et écrit à l'arrêt.
    k.once("onTerminate", () => {
      seenByDependent = resourceOpen;
    });
    await k.terminate(0);
    assert.strictEqual(
      seenByDependent,
      true,
      "le dépendant s'est arrêté sur une ressource déjà fermée",
    );
    assert.deepStrictEqual(codes, [0]);
  });

  it("un à la fois : un écouteur asynchrone finit avant que le précédent inscrit commence", async () => {
    const k = mkKernel();
    const order: string[] = [];
    k.once("onTerminate", () => {
      order.push("ressource:début");
    });
    k.once("onTerminate", async () => {
      order.push("dépendant:début");
      await new Promise((r) => setTimeout(r, 10));
      order.push("dépendant:fin");
    });
    await k.terminate(0);
    assert.deepStrictEqual(order, [
      "dépendant:début",
      "dépendant:fin",
      "ressource:début",
    ]);
  });

  it("un écouteur qui échoue n'empêche pas les autres de libérer (D4)", async () => {
    const k = mkKernel();
    const ran: string[] = [];
    k.once("onTerminate", () => {
      ran.push("premier");
    });
    k.once("onTerminate", () => {
      throw new Error("fermeture ratée");
    });
    k.once("onTerminate", () => Promise.reject(new Error("rejet")));
    k.once("onTerminate", () => {
      ran.push("dernier");
    });
    await assert.doesNotReject(() => k.terminate(0));
    assert.deepStrictEqual(ran, ["dernier", "premier"]);
    assert.deepStrictEqual(codes, [1], "un échec force la sortie en 1");
  });

  it("une inscription faite pendant la phase est appelée avant ceux qui restent (POSIX exit)", async () => {
    const k = mkKernel();
    const order: string[] = [];
    k.once("onTerminate", () => {
      order.push("A");
    });
    k.once("onTerminate", () => {
      order.push("B");
      // Un service construit pendant l'arrêt (get() paresseux) s'inscrit.
      k.once("onTerminate", () => {
        order.push("tardif");
      });
    });
    await k.terminate(0);
    assert.deepStrictEqual(order, ["B", "tardif", "A"]);
  });

  it("un écouteur retiré pendant la phase n'est pas appelé", async () => {
    const k = mkKernel();
    const ran: string[] = [];
    const stop = (): void => {
      ran.push("stop");
    };
    k.once("onTerminate", stop);
    k.once("onTerminate", () => {
      ran.push("B");
      k.removeListener("onTerminate", stop);
    });
    await k.terminate(0);
    assert.deepStrictEqual(ran, ["B"]);
  });

  it("un écouteur `on` (pas `once`) n'est appelé qu'une fois", async () => {
    const k = mkKernel();
    let calls = 0;
    k.on("onTerminate", () => {
      calls += 1;
    });
    k.once("onTerminate", () => {});
    await k.terminate(0);
    assert.strictEqual(calls, 1);
  });
});

describe("Arrêt du noyau — onDrain avant onTerminate (ADR-0027 D1, D2)", () => {
  it("isTerminating est faux avant terminate(), vrai dès l'émission d'onDrain", async () => {
    const k = mkKernel();
    assert.strictEqual(k.isTerminating, false);
    let seen: boolean | null = null;
    k.once("onDrain", () => {
      seen = k.isTerminating;
    });
    await k.terminate(0);
    assert.strictEqual(seen, true);
    assert.strictEqual(k.isTerminating, true);
  });

  it("tout onDrain est fini avant le premier onTerminate", async () => {
    const k = mkKernel();
    const order: string[] = [];
    // onTerminate inscrit AVANT onDrain : la phase se choisit par l'événement,
    // pas par le moment d'inscription.
    k.once("onTerminate", () => {
      order.push("libérer");
    });
    k.once("onDrain", async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push("drainer");
    });
    await k.terminate(0);
    assert.deepStrictEqual(order, ["drainer", "libérer"]);
  });

  it("les écouteurs onDrain tournent ensemble", async () => {
    const k = mkKernel();
    const a = deferred();
    const b = deferred();
    const started: string[] = [];
    k.once("onDrain", async () => {
      started.push("a");
      await a.promise;
    });
    k.once("onDrain", async () => {
      started.push("b");
      // Si les écouteurs tournaient l'un après l'autre, « b » ne commencerait
      // qu'après la résolution de « a » — qui n'arrive qu'ici.
      a.resolve();
      await b.promise;
    });
    const done = k.terminate(0);
    await new Promise((r) => setTimeout(r, 5));
    assert.deepStrictEqual(started, ["a", "b"]);
    b.resolve();
    await done;
    assert.deepStrictEqual(codes, [0]);
  });

  it("un échec dans onDrain : les autres drainent, onTerminate tourne, sortie en 1", async () => {
    const k = mkKernel();
    const ran: string[] = [];
    k.once("onDrain", () => {
      throw new Error("drain raté");
    });
    k.once("onDrain", async () => {
      await Promise.resolve();
      ran.push("drain");
    });
    k.once("onTerminate", () => {
      ran.push("libérer");
    });
    await assert.doesNotReject(() => k.terminate(0));
    assert.deepStrictEqual(ran, ["drain", "libérer"]);
    assert.deepStrictEqual(codes, [1]);
  });

  it("l'échéance nomme la phase qui pendait (D5)", async () => {
    const k = mkKernel({ shutdownDeadline: 60 });
    const lines: string[] = [];
    const log = k.log.bind(k);
    k.log = (payload: unknown, severity?: unknown, ...rest: unknown[]) => {
      if (severity === "CRITIC") lines.push(String(payload));
      return log(payload, severity as never, ...(rest as []));
    };
    k.once("onDrain", () => new Promise(() => {}));
    await k.terminate(0);
    assert.deepStrictEqual(codes, [1]);
    assert.ok(
      lines.some((l) => l.includes("onDrain")),
      `ligne CRITIC sans la phase : ${lines.join(" | ")}`,
    );
  });
});
