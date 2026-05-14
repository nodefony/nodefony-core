import assert from "node:assert";
import Kernel from "../kernel/Kernel";
import Syslog from "../syslog/Syslog";
import Pdu from "../syslog/Pdu";

// ─── Helper ──────────────────────────────────────────────────────────────────

// Intercept Syslog.normalizeLog (called by init() listener) to collect PDUs
function interceptNormalizeLog(): { received: Pdu[]; restore: () => void } {
  const received: Pdu[] = [];
  const orig = Syslog.normalizeLog;
  Syslog.normalizeLog = (p: Pdu) => {
    received.push(p);
    return p;
  };
  return {
    received,
    restore: () => {
      Syslog.normalizeLog = orig;
    },
  };
}

// ─── Kernel.initializeLog — log.debug config ──────────────────────────────────

describe("Kernel — initializeLog", () => {
  it("log.active = false → retour immédiat, aucun listener", () => {
    const k = new Kernel("development", null, { log: { active: false } });
    k.initializeLog();
    assert.strictEqual(k.syslog?.listenerCount("onLog"), 0);
    assert.strictEqual(k.debug, false);
  });

  it("log sans debug → debug reste false, DEBUG ne passe pas", () => {
    const k = new Kernel("development", null, { log: { active: true } });
    k.initializeLog();
    assert.strictEqual(k.debug, false);
    assert.ok(k.syslog && k.syslog.listenerCount("onLog") > 0);

    const { received, restore } = interceptNormalizeLog();
    k.syslog?.log("debug msg", "DEBUG");
    k.syslog?.log("info msg", "INFO");
    restore();

    assert.ok(!received.some(p => p.severityName === "DEBUG"), "DEBUG ne doit pas passer sans debug");
    assert.ok(received.some(p => p.severityName === "INFO"), "INFO doit passer");
  });

  it("log.debug = '*' → kernel.debug = '*', tous les niveaux passent", () => {
    const k = new Kernel("development", null, { log: { active: true, debug: "*" } });
    k.initializeLog();
    assert.strictEqual(k.debug, "*");
    assert.ok(k.syslog && k.syslog.listenerCount("onLog") > 0);

    const { received, restore } = interceptNormalizeLog();
    k.syslog?.log("debug msg", "DEBUG");
    k.syslog?.log("info msg", "INFO");
    k.syslog?.log("error msg", "ERROR");
    restore();

    assert.ok(received.some(p => p.severityName === "DEBUG"), "DEBUG doit passer avec '*'");
    assert.ok(received.some(p => p.severityName === "INFO"));
    assert.ok(received.some(p => p.severityName === "ERROR"));
  });

  it("log.debug = true → kernel.debug = true, même effet que '*'", () => {
    const k = new Kernel("development", null, { log: { active: true, debug: true } });
    k.initializeLog();
    assert.strictEqual(k.debug, true);

    const { received, restore } = interceptNormalizeLog();
    k.syslog?.log("debug msg", "DEBUG");
    restore();

    assert.ok(received.some(p => p.severityName === "DEBUG"), "DEBUG doit passer");
  });

  it("log.debug = ['ROUTER'] → kernel.debug = ['ROUTER'], filtre par msgid", () => {
    const k = new Kernel("development", null, {
      log: { active: true, debug: ["ROUTER"] },
    });
    k.initializeLog();
    assert.deepStrictEqual(k.debug, ["ROUTER"]);

    const { received, restore } = interceptNormalizeLog();
    k.syslog?.log("router debug", "DEBUG", "ROUTER");
    k.syslog?.log("service debug", "DEBUG", "SERVICE");
    k.syslog?.log("info no msgid", "INFO");
    restore();

    assert.ok(
      received.some(p => p.msgid === "ROUTER"),
      "msgid ROUTER doit passer"
    );
    assert.ok(
      !received.some(p => p.msgid === "SERVICE"),
      "msgid SERVICE ne doit pas passer"
    );
    assert.ok(
      !received.some(p => p.severityName === "INFO" && p.msgid === ""),
      "INFO sans msgid ne doit pas passer"
    );
  });

  it("log.debug = ['ROUTER','SEQUELIZE'] → les deux modules passent", () => {
    const k = new Kernel("development", null, {
      log: { active: true, debug: ["ROUTER", "SEQUELIZE"] },
    });
    k.initializeLog();
    assert.deepStrictEqual(k.debug, ["ROUTER", "SEQUELIZE"]);

    const { received, restore } = interceptNormalizeLog();
    k.syslog?.log("router debug", "DEBUG", "ROUTER");
    k.syslog?.log("seq debug", "DEBUG", "SEQUELIZE");
    k.syslog?.log("other debug", "DEBUG", "OTHER");
    restore();

    assert.ok(received.some(p => p.msgid === "ROUTER"), "ROUTER doit passer");
    assert.ok(received.some(p => p.msgid === "SEQUELIZE"), "SEQUELIZE doit passer");
    assert.ok(!received.some(p => p.msgid === "OTHER"), "OTHER ne doit pas passer");
  });

  it("CLI debug pré-activé (true) → config log.debug ignorée, pas de filtre msgid", () => {
    const k = new Kernel("development", null, {
      log: { active: true, debug: ["ROUTER"] },
    });
    k.debug = true; // simule --debug CLI
    k.initializeLog();
    assert.strictEqual(k.debug, true, "CLI true ne doit pas être écrasé par config");

    const { received, restore } = interceptNormalizeLog();
    k.syslog?.log("service debug", "DEBUG", "SERVICE"); // pas de filtre msgid
    restore();

    assert.ok(
      received.some(p => p.msgid === "SERVICE"),
      "avec CLI debug=true, pas de filtre msgid"
    );
  });

  it("initializeLog appelé 2x → un seul listener (removeAllListeners en amont)", () => {
    const k = new Kernel("development", null, {
      log: { active: true, debug: "*" },
    });
    k.initializeLog();
    k.initializeLog(); // deuxième appel doit vider et réinstaller un seul listener
    assert.strictEqual(k.syslog?.listenerCount("onLog"), 1);
  });

  it("environment production — log.debug = '*' → DEBUG activé", () => {
    const k = new Kernel("production", null, { log: { active: true, debug: "*" } });
    k.initializeLog();
    assert.strictEqual(k.debug, "*");

    const { received, restore } = interceptNormalizeLog();
    k.syslog?.log("prod debug", "DEBUG");
    restore();

    assert.ok(received.some(p => p.severityName === "DEBUG"), "DEBUG en production avec debug='*'");
  });
});
