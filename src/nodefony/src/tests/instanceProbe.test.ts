import assert from "node:assert";
import {
  setOrmHealthProvider,
  readOrmHealth,
  setOrmRichProvider,
  readOrmRich,
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

describe("instanceProbe — seam fournisseur ORM riche (drill @pid)", () => {
  afterEach(() => setOrmRichProvider(null));

  it("readOrmRich() = null tant qu'aucun fournisseur n'est branché", () => {
    assert.strictEqual(readOrmRich(), null);
  });

  it("readOrmRich() relaie le fournisseur async branché (blob opaque)", async () => {
    const blob = {
      health: [{ name: "default", pingOk: true }],
      flow: { ts: 1 },
    };
    setOrmRichProvider(async () => blob);
    const p = readOrmRich();
    assert.notStrictEqual(p, null);
    assert.deepStrictEqual(await p, blob);
  });

  it("setOrmRichProvider(null) débranche → null", () => {
    setOrmRichProvider(async () => ({ health: [], flow: {} }));
    assert.notStrictEqual(readOrmRich(), null);
    setOrmRichProvider(null);
    assert.strictEqual(readOrmRich(), null);
  });
});
