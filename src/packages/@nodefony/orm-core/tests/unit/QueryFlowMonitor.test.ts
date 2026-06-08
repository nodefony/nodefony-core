import assert from "node:assert/strict";
import { queryFlowMonitor } from "../../nodefony/src/QueryFlowMonitor";

// Singleton process-wide → noms de connecteurs UNIQUES + restauration des
// réglages globaux (enabled/slowMs) après chaque test.
describe("QueryFlowMonitor — sonde de débit ORM agrégée", () => {
  afterEach(() => {
    queryFlowMonitor.setEnabled(false);
    queryFlowMonitor.slowMs = 50;
  });

  it("OFF par défaut ; setEnabled bascule le drapeau", () => {
    assert.equal(queryFlowMonitor.enabled, false);
    queryFlowMonitor.setEnabled(true);
    assert.equal(queryFlowMonitor.enabled, true);
    queryFlowMonitor.setEnabled(false);
    assert.equal(queryFlowMonitor.enabled, false);
  });

  it("snapshot d'un connecteur jamais observé → flux neutre", () => {
    const f = queryFlowMonitor.snapshot("qfm-never", "sqlite");
    assert.equal(f.connector, "qfm-never");
    assert.equal(f.vendor, "sqlite");
    assert.equal(f.total, 0);
    assert.equal(f.avgMs, null);
    assert.equal(f.ewmaMs, null);
    assert.equal(f.maxMs, 0);
    assert.equal(f.slowTotal, 0);
    assert.deepEqual(f.slow, []);
  });

  it("record : total/avg/last/max + EWMA (1ʳᵉ = valeur brute, puis lissée)", () => {
    const n = "qfm-record";
    queryFlowMonitor.record(n, 100);
    let f = queryFlowMonitor.snapshot(n, "v");
    assert.equal(f.total, 1);
    assert.equal(f.avgMs, 100);
    assert.equal(f.lastMs, 100);
    assert.equal(f.maxMs, 100);
    assert.equal(f.ewmaMs, 100); // 1ʳᵉ mesure = valeur brute

    queryFlowMonitor.record(n, 10);
    f = queryFlowMonitor.snapshot(n, "v");
    assert.equal(f.total, 2);
    assert.equal(f.avgMs, 55); // (100+10)/2
    assert.equal(f.lastMs, 10);
    assert.equal(f.maxMs, 100); // max conservé
    assert.equal(f.ewmaMs, 82); // 0.2*10 + 0.8*100
  });

  it("requêtes lentes : comptées (≥ slowMs) et ring borné à 20", () => {
    const n = "qfm-slow";
    queryFlowMonitor.record(n, 10); // < 50 → pas lente
    for (let i = 0; i < 25; i++) {
      queryFlowMonitor.record(n, 100, `SELECT ${i}`); // ≥ 50 → lente
    }
    const f = queryFlowMonitor.snapshot(n, "v");
    assert.equal(f.total, 26);
    assert.equal(f.slowTotal, 25);
    assert.equal(f.slow.length, 20); // MAX_SLOW
    // unshift → la plus récente en tête.
    assert.equal(f.slow[0].sql, "SELECT 24");
    assert.equal(f.slow[0].connector, n);
  });

  it("slowMs configurable → change le seuil de capture", () => {
    const n = "qfm-threshold";
    queryFlowMonitor.slowMs = 5;
    queryFlowMonitor.record(n, 10); // 10 ≥ 5 → lente désormais
    const f = queryFlowMonitor.snapshot(n, "v");
    assert.equal(f.slowTotal, 1);
  });
});
