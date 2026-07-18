import assert from "node:assert/strict";
import { MemoryAuditStore } from "../../nodefony/src/audit/MemoryAuditStore";
import {
  registerAuditStore,
  getAuditStoreFactory,
  listAuditStores,
} from "../../nodefony/src/audit/auditStoreRegistry";
import type { ISecurityConfig } from "../../nodefony/config/defineModuleConfig";
import type { IAuditStore } from "../../nodefony/contracts/IAuditStore";

/**
 * Registre du journal d'audit (P6.14) — sélection pluggable du backend
 * (`security.audit.store`) sans coupler le service à un store en dur :
 * - le builtin `memory` s'enregistre à l'import (0 dépendance) ;
 * - la fabrique reste défensive si la config est partielle (pas de crash) ;
 * - un driver inconnu renvoie `undefined` → le service désactive l'audit.
 */
describe("auditStoreRegistry — sélection pluggable du journal", () => {
  it("le builtin `memory` est enregistré à l'import", () => {
    assert.ok(listAuditStores().includes("memory"));
  });

  it("getAuditStoreFactory('memory') fabrique un MemoryAuditStore", () => {
    const factory = getAuditStoreFactory("memory");
    assert.ok(factory);
    const store = factory({
      container: {} as never,
      config: {
        audit: { retentionDays: 30 },
      } as unknown as ISecurityConfig,
    });
    assert.ok(store instanceof MemoryAuditStore);
  });

  it("fabrique sans config (retentionDays absent) ne crashe pas", () => {
    const factory = getAuditStoreFactory("memory");
    assert.ok(factory);
    const store = factory({
      container: {} as never,
      config: {} as unknown as ISecurityConfig,
    });
    assert.ok(store instanceof MemoryAuditStore);
  });

  it("driver inconnu → undefined (le service désactive l'audit)", () => {
    assert.equal(getAuditStoreFactory("does-not-exist"), undefined);
  });

  it("registerAuditStore ajoute/remplace une fabrique", () => {
    const fake: IAuditStore = {
      append: () => Promise.resolve(),
      listPage: () =>
        Promise.resolve({
          items: [],
          limit: 0,
          hasNext: false,
          nextCursor: null,
          total: 0,
        }),
      gc: () => Promise.resolve(0),
    };
    registerAuditStore("fake-test", () => fake);
    const factory = getAuditStoreFactory("fake-test");
    assert.ok(factory);
    assert.equal(
      factory({ container: {} as never, config: {} as never }),
      fake,
    );
    assert.ok(listAuditStores().includes("fake-test"));
  });
});
