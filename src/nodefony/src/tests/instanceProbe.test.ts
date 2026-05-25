import assert from "node:assert";
import {
  setOrmHealthProvider,
  readOrmHealth,
  type IOrmLeanHealth,
} from "../service/cluster/instanceProbe";

describe("instanceProbe — seam fournisseur santé ORM", () => {
  afterEach(() => setOrmHealthProvider(null)); // débranche entre tests

  it("readOrmHealth() = null tant qu'aucun fournisseur n'est branché", () => {
    assert.strictEqual(readOrmHealth(), null);
  });

  it("readOrmHealth() relaie le fournisseur branché", () => {
    const health: IOrmLeanHealth = {
      connectors: 2,
      connected: 1,
      queryTotal: 42,
      slowTotal: 1,
      errorTotal: 0,
      reconnectTotal: 0,
      maxEwmaMs: 7.5,
    };
    setOrmHealthProvider(() => health);
    assert.deepStrictEqual(readOrmHealth(), health);
  });

  it("setOrmHealthProvider(null) débranche → null", () => {
    setOrmHealthProvider(() => ({
      connectors: 1,
      connected: 1,
      queryTotal: 0,
      slowTotal: 0,
      errorTotal: 0,
      reconnectTotal: 0,
      maxEwmaMs: null,
    }));
    assert.notStrictEqual(readOrmHealth(), null);
    setOrmHealthProvider(null);
    assert.strictEqual(readOrmHealth(), null);
  });
});
