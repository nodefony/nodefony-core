import assert from "node:assert/strict";
import { buildOrmLeanHealth } from "../../nodefony/src/buildOrmLeanHealth";
import { ormRegistry } from "../../nodefony/src/OrmRegistry";
import { connectionMonitor } from "../../nodefony/src/ConnectionMonitor";
import { queryFlowMonitor } from "../../nodefony/src/QueryFlowMonitor";
import type { IOrm } from "../../nodefony/interfaces/index";

/** Stub IOrm — seuls `name` + `isConnected` comptent pour la sonde lean. */
const stub = (name: string, connected: boolean): IOrm =>
  ({ name, isConnected: () => connected }) as unknown as IOrm;

// Les monitors/registre sont des SINGLETONS process-wide sans reset → on mesure en
// DELTA (baseline avant/après) pour ne pas dépendre de l'état laissé par d'autres tests.
describe("buildOrmLeanHealth — agrégat ORM lean per-instance", () => {
  const A = "lean-test-A";
  const B = "lean-test-B";

  afterEach(() => {
    ormRegistry.unregister(A);
    ormRegistry.unregister(B);
  });

  it("somme requêtes/lentes/erreurs/reconnexions des connecteurs ; connected = isConnected()", () => {
    const base = buildOrmLeanHealth();

    ormRegistry.register(A, stub(A, true)); // connecté
    ormRegistry.register(B, stub(B, false)); // non connecté

    // Flux : 3 requêtes normales + 1 lente (>= slowMs 50) sur A.
    queryFlowMonitor.record(A, 10);
    queryFlowMonitor.record(A, 12);
    queryFlowMonitor.record(A, 8);
    queryFlowMonitor.record(A, 200, "SELECT 1"); // lente (SQL fourni sur chemin lent)
    // Connexion B : une coupure SUBIE puis reprise, plus une erreur. Deux
    // `recordConnect` ne valent plus une reconnexion : la reprise se constate.
    connectionMonitor.recordConnect(B, 5);
    connectionMonitor.recordLost(B);
    connectionMonitor.recordReconnect(B);
    connectionMonitor.recordError(B, "boom");

    const after = buildOrmLeanHealth();

    assert.equal(after.connectors - base.connectors, 2);
    assert.equal(after.connected - base.connected, 1, "seul A est isConnected");
    assert.equal(after.queryTotal - base.queryTotal, 4);
    assert.equal(after.slowTotal - base.slowTotal, 1);
    assert.equal(after.errorTotal - base.errorTotal, 1);
    assert.equal(after.reconnectTotal - base.reconnectTotal, 1);
    assert.notEqual(after.maxEwmaMs, null, "EWMA observée après record");
  });

  it("lecture pure : isConnected() qui throw ne fait pas exploser (compté non-connecté)", () => {
    const base = buildOrmLeanHealth();
    ormRegistry.register(A, {
      name: A,
      isConnected() {
        throw new Error("adapter pas prêt");
      },
    } as unknown as IOrm);
    const after = buildOrmLeanHealth();
    assert.equal(after.connectors - base.connectors, 1);
    assert.equal(after.connected - base.connected, 0);
  });
});
