import assert from "node:assert/strict";
import { setOrmHealthProvider, setOrmRichProvider } from "nodefony";
import type { Kernel } from "nodefony";
import {
  resolveOrmFlowEnabled,
  wireOrmAdminPlane,
} from "../../nodefony/src/ormWiring";

/** Kernel minimal — seul `environment` compte pour le calcul du flux. */
const fakeKernel = (environment: string): Kernel =>
  ({ environment }) as unknown as Kernel;

describe("ormWiring — resolveOrmFlowEnabled (C5)", () => {
  const saved = process.env.NODEFONY_ORM_FLOW;
  afterEach(() => {
    if (saved === undefined) {
      delete process.env.NODEFONY_ORM_FLOW;
    } else {
      process.env.NODEFONY_ORM_FLOW = saved;
    }
  });

  it("override env '1'/'true' → activé (même en production)", () => {
    process.env.NODEFONY_ORM_FLOW = "1";
    assert.equal(resolveOrmFlowEnabled(fakeKernel("production")), true);
    process.env.NODEFONY_ORM_FLOW = "true";
    assert.equal(resolveOrmFlowEnabled(fakeKernel("production")), true);
  });

  it("override env '0' → désactivé (même hors production)", () => {
    process.env.NODEFONY_ORM_FLOW = "0";
    assert.equal(resolveOrmFlowEnabled(fakeKernel("dev")), false);
  });

  it("sans override : OFF en production, ON sinon", () => {
    delete process.env.NODEFONY_ORM_FLOW;
    assert.equal(resolveOrmFlowEnabled(fakeKernel("production")), false);
    assert.equal(resolveOrmFlowEnabled(fakeKernel("dev")), true);
  });

  it("sans override + kernel nullish → ON (≠ production)", () => {
    delete process.env.NODEFONY_ORM_FLOW;
    assert.equal(resolveOrmFlowEnabled(null), true);
    assert.equal(resolveOrmFlowEnabled(undefined), true);
  });
});

describe("ormWiring — wireOrmAdminPlane (C5)", () => {
  // Restaure les seams globaux du core après chaque branchement de test.
  afterEach(() => {
    setOrmHealthProvider(null);
    setOrmRichProvider(null);
  });

  it("kernel nullish (aucun broker) → branche les providers sans throw", () => {
    assert.doesNotThrow(() => wireOrmAdminPlane(null));
    assert.doesNotThrow(() => wireOrmAdminPlane(undefined));
  });

  it("kernel sans adminBroker dans le container → ne throw pas", () => {
    const kernel = {
      container: { get: () => undefined },
    } as unknown as Kernel;
    assert.doesNotThrow(() => wireOrmAdminPlane(kernel));
  });
});
