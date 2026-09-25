//
// ─── Calque de configuration par requête (#494) ───────────────────────────────
//
// Une requête surcharge, pour elle seule, les clés que le module met sur sa
// liste blanche (`overlaySchema`). La racine et les requêtes voisines restent
// intactes ; une clé hors liste, ou un module sans liste, est refusé.
//
// Débrancher : rendre la liste permissive (`overlaySchema` en `z.looseObject`)
// → le bloc « hors liste » tombe ; faire rendre la racine par `useConfig` →
// les blocs « sa requête » tombent.
//
import assert from "node:assert";
import { describe, it, beforeAll, afterAll } from "vitest";
import { z } from "zod";
import Kernel from "../kernel/Kernel";
import Module from "../kernel/Module";
import Container from "../Container";
import RequestContext from "../runtime/RequestContext";
import { overlayConfig, useConfig } from "../config/overlay";
import type { IScope } from "../types/IContainer";

const configSchema = z.strictObject({
  port: z.number(),
  upload: z.strictObject({ maxSize: z.number(), dir: z.string() }),
  origins: z.array(z.string()),
});
const overlaySchema = z
  .strictObject({
    upload: z.strictObject({ maxSize: z.number().positive() }).partial(),
    origins: z.array(z.string()),
  })
  .partial();

declare module "../config/overlay" {
  interface NodefonyModuleOverlay {
    "@test/overlay": z.input<typeof overlaySchema>;
    "@test/closed": { port?: number };
  }
}

class Open extends Module {
  override overlaySchema = overlaySchema;
  constructor(kernel: Kernel) {
    super("overlayOpen", kernel, "/tmp/overlayOpen", {
      port: 80,
      upload: { maxSize: 1000, dir: "/tmp/up" },
      origins: ["https://a.test"],
    });
    this.package = { name: "@test/overlay", version: "0.0.0" };
  }
}
class Closed extends Module {
  constructor(kernel: Kernel) {
    super("overlayClosed", kernel, "/tmp/overlayClosed", { port: 81 });
    this.package = { name: "@test/closed", version: "0.0.0" };
  }
}

let kernel: Kernel;
let root: Container;
let origLog: typeof console.log;

beforeAll(async () => {
  origLog = console.log;
  console.log = () => {};
  kernel = new Kernel("development", null, { log: { active: false } });
  await kernel.addModule(Open);
  await kernel.addModule(Closed);
  await kernel.onReady();
  root = kernel.container as Container;
  root.addScope("request");
});
afterAll(() => {
  console.log = origLog;
});

type Cfg = z.infer<typeof configSchema>;
const read = (): Cfg => useConfig("@test/overlay") as unknown as Cfg;

/** Exécute `fn` dans une requête : scope neuf dans la bulle ALS, refermé après. */
async function inRequest<T>(fn: (scope: IScope) => T | Promise<T>): Promise<T> {
  const scope = root.enterScope("request");
  try {
    return await RequestContext.run({ requestId: "ov", scope }, () =>
      fn(scope),
    );
  } finally {
    root.leaveScope(scope);
  }
}

describe("calque de configuration par requête (#494)", () => {
  it("sans calque : la configuration figée du module, même référence", async () => {
    const outside = read();
    const inside = await inRequest(() => read());
    assert.strictEqual(inside, outside);
    assert.ok(Object.isFrozen(outside.upload));
  });

  it("un calque est vu dans SA requête seulement ; racine et requête voisine intactes", async () => {
    let releaseA!: () => void;
    const gateA = new Promise<void>((r) => (releaseA = r));
    const a = inRequest(async () => {
      overlayConfig("@test/overlay", {
        upload: { maxSize: 5000 },
        origins: ["https://b.test"],
      });
      await gateA;
      return read();
    });
    const b = await inRequest(() => read());
    releaseA();
    const seenByA = await a;
    assert.strictEqual(seenByA.upload.maxSize, 5000);
    assert.strictEqual(seenByA.upload.dir, "/tmp/up");
    assert.deepStrictEqual(seenByA.origins, ["https://b.test"]);
    assert.strictEqual(b.upload.maxSize, 1000);
    assert.strictEqual(read().upload.maxSize, 1000);
    assert.ok(Object.isFrozen(seenByA.upload));
  });

  it("deux calques sur un même module se cumulent", async () => {
    const seen = await inRequest(() => {
      overlayConfig("@test/overlay", { upload: { maxSize: 7 } });
      overlayConfig("@test/overlay", { origins: ["https://c.test"] });
      return read();
    });
    assert.strictEqual(seen.upload.maxSize, 7);
    assert.deepStrictEqual(seen.origins, ["https://c.test"]);
  });

  it("une clé hors liste blanche est refusée en nommant la clé", async () => {
    await inRequest(() => {
      assert.throws(
        () => overlayConfig("@test/overlay", { port: 22 } as unknown as never),
        /calque de configuration refusé.*port/s,
      );
      assert.throws(
        () => overlayConfig("@test/overlay", { upload: { maxSize: -1 } }),
        /calque de configuration refusé/,
      );
    });
    assert.strictEqual(read().port, 80);
  });

  it("un module sans liste blanche n'accepte aucun calque", async () => {
    await inRequest(() => {
      assert.throws(
        () => overlayConfig("@test/closed", { port: 1 }),
        /« @test\/closed » n'accepte aucun calque/,
      );
    });
  });

  it("hors requête, poser un calque lève", () => {
    assert.throws(() => overlayConfig("@test/overlay", { origins: [] }));
  });

  it("un module inconnu lève en le nommant", () => {
    assert.throws(() => useConfig("@test/absent"), /« @test\/absent »/);
  });
});
