import assert from "node:assert/strict";
import { connectionMonitor } from "../../nodefony/src/ConnectionMonitor";

// Singleton process-wide sans reset → chaque test utilise un nom de connecteur
// UNIQUE pour rester indépendant (un nom jamais vu = compteurs neutres).
describe("ConnectionMonitor — observabilité per-instance des connexions", () => {
  it("snapshot d'un connecteur jamais observé → compteurs neutres", () => {
    const snap = connectionMonitor.snapshot("cm-never-seen");
    assert.equal(snap.connectCount, 0);
    assert.equal(snap.reconnectCount, 0);
    assert.equal(snap.errorCount, 0);
    assert.equal(snap.connectedSince, null);
    assert.equal(snap.uptimeMs, null);
    assert.deepEqual(snap.recentErrors, []);
    assert.equal(snap.latency.samples, 0);
  });

  it("recordConnect : 1ʳᵉ connexion, puis reconnexions (connectCount-1)", () => {
    const n = "cm-connect";
    connectionMonitor.recordConnect(n, 12.345);
    let snap = connectionMonitor.snapshot(n);
    assert.equal(snap.connectCount, 1);
    assert.equal(snap.reconnectCount, 0);
    assert.equal(snap.lastConnectMs, 12.35); // arrondi 2 décimales
    assert.notEqual(snap.connectedSince, null);
    assert.ok((snap.uptimeMs ?? -1) >= 0);

    connectionMonitor.recordConnect(n, 5);
    connectionMonitor.recordConnect(n, 5);
    snap = connectionMonitor.snapshot(n);
    assert.equal(snap.connectCount, 3);
    assert.equal(snap.reconnectCount, 2);
  });

  it("recordError : compte + lastError + ring borné à 12", () => {
    const n = "cm-error";
    for (let i = 0; i < 15; i++) {
      connectionMonitor.recordError(n, `boom ${i}`);
    }
    const snap = connectionMonitor.snapshot(n);
    assert.equal(snap.errorCount, 15);
    assert.equal(snap.recentErrors.length, 12); // MAX_RECENT_ERRORS
    // unshift → le plus récent en tête.
    assert.equal(snap.lastError?.message, "boom 14");
    assert.equal(snap.recentErrors[0].message, "boom 14");
  });

  it("recordPing : fenêtre de latence min/avg/max + ring borné à 30", () => {
    const n = "cm-ping";
    connectionMonitor.recordPing(n, 10);
    connectionMonitor.recordPing(n, 20);
    connectionMonitor.recordPing(n, 30);
    let snap = connectionMonitor.snapshot(n);
    assert.equal(snap.latency.samples, 3);
    assert.equal(snap.latency.min, 10);
    assert.equal(snap.latency.max, 30);
    assert.equal(snap.latency.avg, 20);
    assert.equal(snap.latency.last, 30);

    for (let i = 0; i < 40; i++) {
      connectionMonitor.recordPing(n, 1);
    }
    snap = connectionMonitor.snapshot(n);
    assert.equal(snap.latency.samples, 30); // MAX_LATENCY_SAMPLES
  });

  it("connexion + erreur sur le même connecteur cohabitent", () => {
    const n = "cm-mixed";
    connectionMonitor.recordConnect(n, 3);
    connectionMonitor.recordError(n, "ping failed");
    const snap = connectionMonitor.snapshot(n);
    assert.equal(snap.connectCount, 1);
    assert.equal(snap.errorCount, 1);
    assert.equal(snap.lastError?.message, "ping failed");
  });
});
