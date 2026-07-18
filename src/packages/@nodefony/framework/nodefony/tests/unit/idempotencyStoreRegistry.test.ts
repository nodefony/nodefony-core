import { describe, it, expect, beforeEach } from "vitest";
import type { IIdempotencyStore } from "nodefony";
import {
  registerIdempotencyStore,
  getIdempotencyStoreFactory,
  listIdempotencyStores,
  type IIdempotencyStoreFactoryContext,
} from "../../src/idempotencyStoreRegistry";
import { emptyIdempotencyPage } from "../support/idempotencyDoubles";

/** Store sentinelle minimal (le contrat, sync — suffit pour la résolution). */
function sentinel(tag: string): IIdempotencyStore {
  return {
    begin: () => ({ state: "fresh" }),
    complete: () => {},
    abort: () => {},
    listPage: emptyIdempotencyPage,
    get size() {
      return 0;
    },
    // marqueur de test pour identifier l'instance résolue
    ...({ tag } as unknown as object),
  };
}

const ctx = {} as IIdempotencyStoreFactoryContext;

describe("idempotencyStoreRegistry — registre des stores distribués", () => {
  beforeEach(() => {
    // Pas de reset public (registre module-level) → on utilise des noms uniques
    // par test pour éviter l'interférence.
  });

  it("register + get résout la fabrique enregistrée", () => {
    const s = sentinel("redis-1");
    registerIdempotencyStore("redis-test-1", () => s);
    const factory = getIdempotencyStoreFactory("redis-test-1");
    expect(factory).to.be.a("function");
    expect(factory?.(ctx)).to.equal(s);
  });

  it("get d'un nom inconnu → undefined (le boot framework throw là-dessus = fail-loud)", () => {
    expect(getIdempotencyStoreFactory("nope-unknown")).to.equal(undefined);
  });

  it("register écrase la fabrique d'un même nom (dernier gagne)", () => {
    const a = sentinel("a");
    const b = sentinel("b");
    registerIdempotencyStore("dup-test", () => a);
    registerIdempotencyStore("dup-test", () => b);
    expect(getIdempotencyStoreFactory("dup-test")?.(ctx)).to.equal(b);
  });

  it("list inclut les noms enregistrés mais JAMAIS 'memory' (défaut implicite via @services)", () => {
    registerIdempotencyStore("drizzle-test-2", () => sentinel("drz"));
    const names = listIdempotencyStores();
    expect(names).to.include("drizzle-test-2");
    expect(names).to.not.include("memory");
  });

  it("la fabrique reçoit le contexte {module, config}", () => {
    let received: IIdempotencyStoreFactoryContext | null = null;
    const probe = {} as IIdempotencyStoreFactoryContext;
    registerIdempotencyStore("ctx-test", (c) => {
      received = c;
      return sentinel("ctx");
    });
    getIdempotencyStoreFactory("ctx-test")?.(probe);
    expect(received).to.equal(probe);
  });
});
