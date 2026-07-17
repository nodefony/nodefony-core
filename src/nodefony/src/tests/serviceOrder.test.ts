/* eslint-disable @typescript-eslint/no-explicit-any */
//
// Tri des services d'un `@services([...])` par dépendances déclarées.
// L'enjeu : l'ordre écrit à la main ne doit plus décider du boot.
//
import "reflect-metadata";
import assert from "node:assert";
import Injector from "../kernel/injector/injector";
import Service from "../Service";
import Container from "../Container";
import { injectable, inject } from "../kernel/decorators/kernelDecorator";
import { orderServicesByDependencies } from "../kernel/injector/serviceOrder";

/** Applique `@inject(name)` au paramètre `index` (tsx n'a pas les param decorators). */
const injectParam = (ctor: any, name: string, index: number) =>
  (inject(name) as unknown as (t: any, k: undefined, i: number) => void)(
    ctor,
    undefined,
    index,
  );

const nameOf = (e: any) => (typeof e === "string" ? e : e.name);

describe("orderServicesByDependencies", () => {
  // Socle : Alpha est réclamé par Beta ; Gamma est indépendant.
  @injectable()
  class Alpha extends Service {
    constructor() {
      super("alphaSvc", new Container());
    }
  }
  class Beta extends Service {
    constructor(_a: Alpha) {
      super("betaSvc", new Container());
    }
  }
  injectParam(Beta, "Alpha", 0);

  class Gamma extends Service {
    constructor() {
      super("gammaSvc", new Container());
    }
  }

  it("le consommateur écrit AVANT sa dépendance est replacé APRÈS", () => {
    const out = orderServicesByDependencies([Beta as any, Alpha as any]);
    assert.deepStrictEqual(out.map(nameOf), ["Alpha", "Beta"]);
  });

  it("CONTRÔLE POSITIF : un ordre déjà correct sort INCHANGÉ", () => {
    const out = orderServicesByDependencies([Alpha as any, Beta as any]);
    assert.deepStrictEqual(out.map(nameOf), ["Alpha", "Beta"]);
  });

  it("tri STABLE : les services sans contrainte gardent leur ordre d'écriture", () => {
    // Gamma n'a aucun lien : il ne doit pas « remonter » ni « descendre ».
    const out = orderServicesByDependencies([
      Gamma as any,
      Beta as any,
      Alpha as any,
    ]);
    // Seule contrainte : Alpha avant Beta. Gamma reste en tête.
    assert.deepStrictEqual(out.map(nameOf), ["Gamma", "Alpha", "Beta"]);
  });

  it("aucune dépendance intra-liste → liste identique", () => {
    const out = orderServicesByDependencies([Gamma as any, Alpha as any]);
    assert.deepStrictEqual(out.map(nameOf), ["Gamma", "Alpha"]);
  });

  it("les chemins (string) gardent leur position — leurs deps sont inconnaissables", () => {
    const out = orderServicesByDependencies([
      "./some/path",
      Beta as any,
      Alpha as any,
    ]);
    assert.deepStrictEqual(out.map(nameOf), ["./some/path", "Alpha", "Beta"]);
  });

  it("jamais une entrée perdue ni dupliquée", () => {
    const input = [Gamma as any, Beta as any, "./p" as any, Alpha as any];
    const out = orderServicesByDependencies(input);
    assert.strictEqual(out.length, input.length);
    assert.deepStrictEqual(new Set(out).size, input.length);
    for (const e of input) assert.ok(out.includes(e));
  });

  it("auto-injection par TYPE : la dépendance est vue aussi sans @inject", () => {
    class ByType extends Service {
      constructor(_a: Alpha) {
        super("byTypeSvc", new Container());
      }
    }
    Reflect.defineMetadata("design:paramtypes", [Alpha], ByType);
    const out = orderServicesByDependencies([ByType as any, Alpha as any]);
    assert.deepStrictEqual(out.map(nameOf), ["Alpha", "ByType"]);
  });

  it("un type NON enregistré ne crée pas de dépendance (arg positionnel)", () => {
    class Plain extends Service {
      constructor() {
        super("plainSvc", new Container());
      }
    }
    class NeedsPlain extends Service {
      constructor(_p: Plain) {
        super("needsPlainSvc", new Container());
      }
    }
    Reflect.defineMetadata("design:paramtypes", [Plain], NeedsPlain);
    // Plain n'est pas @injectable → aucune arête → ordre d'écriture conservé.
    const out = orderServicesByDependencies([NeedsPlain as any, Plain as any]);
    assert.deepStrictEqual(out.map(nameOf), ["NeedsPlain", "Plain"]);
  });

  it("chaîne transitive A ← B ← C, écrite à l'envers → ordonnée", () => {
    @injectable()
    class Deep1 extends Service {
      constructor() {
        super("deep1", new Container());
      }
    }
    @injectable()
    class Deep2 extends Service {
      constructor(_d: Deep1) {
        super("deep2", new Container());
      }
    }
    injectParam(Deep2, "Deep1", 0);
    class Deep3 extends Service {
      constructor(_d: Deep2) {
        super("deep3", new Container());
      }
    }
    injectParam(Deep3, "Deep2", 0);

    try {
      const out = orderServicesByDependencies([
        Deep3 as any,
        Deep2 as any,
        Deep1 as any,
      ]);
      assert.deepStrictEqual(out.map(nameOf), ["Deep1", "Deep2", "Deep3"]);
    } finally {
      delete (Injector.injectables as any)["Deep1"];
      delete (Injector.injectables as any)["Deep2"];
    }
  });

  it("CYCLE → erreur explicite qui NOMME le cycle", () => {
    @injectable()
    class Loop1 extends Service {
      constructor() {
        super("loop1", new Container());
      }
    }
    @injectable()
    class Loop2 extends Service {
      constructor() {
        super("loop2", new Container());
      }
    }
    injectParam(Loop1, "Loop2", 0);
    injectParam(Loop2, "Loop1", 0);

    try {
      assert.throws(
        () => orderServicesByDependencies([Loop1 as any, Loop2 as any]),
        (e: Error) => {
          assert.match(e.message, /Circular service dependency/);
          assert.match(e.message, /Loop1/);
          assert.match(e.message, /Loop2/);
          return true;
        },
      );
    } finally {
      delete (Injector.injectables as any)["Loop1"];
      delete (Injector.injectables as any)["Loop2"];
    }
  });

  it("liste vide ou singleton → passe sans rien faire", () => {
    assert.deepStrictEqual(orderServicesByDependencies([]), []);
    assert.deepStrictEqual(orderServicesByDependencies([Alpha as any]), [
      Alpha,
    ]);
  });
});
