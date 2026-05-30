/*
 *   NODEFONY FRAMEWORK UNIT TEST — MOCHA STYLE
 *
 *   Log Backplane (LB.0/LB.1) — axe DESTINATION queryable :
 *   - filterPdus (helper PUR : critères AND, ordre récent-first, pagination)
 *   - logDriverRegistry (register/setActive/list, throw inconnu)
 *   - createMemoryLogDriver (query délègue à filterPdus sur la source injectée)
 *   - pduToRecord (projection Pdu → forme wire)
 */
import assert from "node:assert";
import Pdu from "../syslog/Pdu";
import { filterPdus } from "../syslog/drivers/filterPdus";
import { pduToRecord } from "../syslog/drivers/ILogDriver";
import { createMemoryLogDriver } from "../syslog/drivers/MemoryLogDriver";
import {
  registerLogDriver,
  setActiveLogDriver,
  getActiveLogDriver,
  listLogDrivers,
  _resetLogDriverRegistry,
} from "../syslog/drivers/logDriverRegistry";

/** Fabrique un Pdu daté (timeStamp explicite pour les tests de plage/ordre). */
const mk = (
  payload: unknown,
  severity: Pdu["severityName"] | number,
  moduleName = "MOD",
  msgid = "",
  ts?: number,
  requestId?: string,
): Pdu => {
  const pdu = new Pdu(payload, severity as never, moduleName, msgid, "", ts);
  if (requestId !== undefined) pdu.requestId = requestId;
  return pdu;
};

describe("Log Backplane (LB.0/LB.1)", () => {
  describe("filterPdus — helper pur", () => {
    // Jeu de données : 5 Pdu, timestamps croissants (anciens → récents).
    const sample = (): Pdu[] => [
      mk("alpha login", "INFO", "AUTH", "LOGIN", 1000, "req-1"),
      mk("db slow query", "WARNING", "ORM", "QUERY", 2000, "req-1"),
      mk("boom", "ERROR", "HTTP", "KERNEL", 3000, "req-2"),
      mk("critical fail", "CRITIC", "HTTP", "KERNEL", 4000, "req-2"),
      mk("hello world", "DEBUG", "ROUTER", "MATCH", 5000, "req-3"),
    ];

    it("vide → tout, ordre RÉCENT d'abord", () => {
      const r = filterPdus(sample());
      assert.strictEqual(r.total, 5);
      assert.strictEqual(r.rows.length, 5);
      assert.strictEqual(r.rows[0]!.payload, "hello world"); // le + récent
      assert.strictEqual(r.rows[4]!.payload, "alpha login"); // le + ancien
      assert.strictEqual(r.truncated, false);
    });

    it("severity unique", () => {
      const r = filterPdus(sample(), { severity: "ERROR" });
      assert.strictEqual(r.total, 1);
      assert.strictEqual(r.rows[0]!.payload, "boom");
    });

    it("severity multiple (array) + insensible casse", () => {
      const r = filterPdus(sample(), { severity: ["error", "critic"] });
      assert.strictEqual(r.total, 2);
      assert.deepStrictEqual(
        r.rows.map((x) => x.severityName),
        ["CRITIC", "ERROR"], // récent d'abord
      );
    });

    it("module — inclusion insensible casse", () => {
      const r = filterPdus(sample(), { module: "http" });
      assert.strictEqual(r.total, 2);
    });

    it("msgid — inclusion", () => {
      const r = filterPdus(sample(), { msgid: "LOGIN" });
      assert.strictEqual(r.total, 1);
      assert.strictEqual(r.rows[0]!.moduleName, "AUTH");
    });

    it("requestId — match EXACT", () => {
      const r = filterPdus(sample(), { requestId: "req-2" });
      assert.strictEqual(r.total, 2);
      // exact : "req-" ne doit RIEN matcher (pas d'inclusion)
      assert.strictEqual(filterPdus(sample(), { requestId: "req-" }).total, 0);
    });

    it("plage from/to (timeStamp inclus)", () => {
      const r = filterPdus(sample(), { from: 2000, to: 4000 });
      assert.strictEqual(r.total, 3);
    });

    it("text — plein-texte payload + msgid + module", () => {
      assert.strictEqual(filterPdus(sample(), { text: "boom" }).total, 1);
      assert.strictEqual(filterPdus(sample(), { text: "ROUTER" }).total, 1); // module
      assert.strictEqual(filterPdus(sample(), { text: "query" }).total, 1); // 1 Pdu (payload ET msgid)
      assert.strictEqual(filterPdus(sample(), { text: "fail" }).total, 1); // payload
    });

    it("critères combinés en AND", () => {
      const r = filterPdus(sample(), { module: "HTTP", severity: "ERROR" });
      assert.strictEqual(r.total, 1);
      assert.strictEqual(r.rows[0]!.payload, "boom");
    });

    it("limit/offset/total/truncated", () => {
      const r = filterPdus(sample(), { limit: 2, offset: 0 });
      assert.strictEqual(r.total, 5);
      assert.strictEqual(r.rows.length, 2);
      assert.strictEqual(r.truncated, true);
      const r2 = filterPdus(sample(), { limit: 2, offset: 4 });
      assert.strictEqual(r2.rows.length, 1);
      assert.strictEqual(r2.truncated, false);
    });

    it("0 match → rows vide, total 0", () => {
      const r = filterPdus(sample(), { module: "NOPE" });
      assert.strictEqual(r.total, 0);
      assert.strictEqual(r.rows.length, 0);
    });
  });

  describe("pduToRecord", () => {
    it("projette les champs ; requestId présent", () => {
      const p = mk("x", "INFO", "M", "ID", 1234, "req-9");
      const rec = pduToRecord(p);
      assert.strictEqual(rec.severityName, "INFO");
      assert.strictEqual(rec.moduleName, "M");
      assert.strictEqual(rec.timeStamp, 1234);
      assert.strictEqual(rec.requestId, "req-9");
    });
    it("requestId OMIS si absent (0 verbosité wire)", () => {
      const p = mk("x", "INFO");
      assert.ok(!("requestId" in pduToRecord(p)));
    });
  });

  describe("logDriverRegistry", () => {
    beforeEach(() => _resetLogDriverRegistry());
    afterEach(() => _resetLogDriverRegistry());

    it("register → premier devient actif ; list ; setActive ; getActive", () => {
      const mem = createMemoryLogDriver(() => []);
      registerLogDriver(mem);
      assert.strictEqual(getActiveLogDriver(), mem);
      assert.deepStrictEqual(
        listLogDrivers().map((d) => d.name),
        ["memory"],
      );
      const fake = {
        name: "fake",
        capabilities: { write: true, query: false, stream: false },
      };
      registerLogDriver(fake);
      assert.strictEqual(getActiveLogDriver(), mem); // actif inchangé
      assert.strictEqual(setActiveLogDriver("fake"), fake);
      assert.strictEqual(getActiveLogDriver(), fake);
    });

    it("setActiveLogDriver throw sur nom inconnu", () => {
      assert.throws(() => setActiveLogDriver("ghost"), /Unknown log driver/);
    });

    it("getActiveLogDriver = null si rien enregistré", () => {
      assert.strictEqual(getActiveLogDriver(), null);
    });
  });

  describe("createMemoryLogDriver", () => {
    it("capabilities memory (volatile, queryable, stream)", () => {
      const d = createMemoryLogDriver(() => []);
      assert.deepStrictEqual(d.capabilities, {
        write: false,
        query: true,
        stream: true,
      });
    });

    it("query délègue à filterPdus sur la source injectée (lazy)", async () => {
      let ring: Pdu[] = [];
      const d = createMemoryLogDriver(() => ring);
      ring = [mk("a", "INFO", "M1"), mk("b", "ERROR", "M2", "", 2000)];
      const r = await d.query!({ severity: "ERROR" });
      assert.strictEqual(r.total, 1);
      assert.strictEqual(r.rows[0]!.payload, "b");
    });
  });
});
