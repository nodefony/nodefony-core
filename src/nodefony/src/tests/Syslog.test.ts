/*
 *   MODEFONY FRAMEWORK UNIT TEST
 *
 *   MOCHA STYLE
 *
 *   In the global context you can find :
 *
 *  nodefony : namespace to get library
 *  kernel :   instance of kernel who launch the test
 *
 */
//import { expect, assert as assertChai} from 'chai'
import Syslog, {
  conditionsInterface,
  SyslogDefaultSettings,
} from "../syslog/Syslog";
//import nodefony  from "../Nodefony"
import Pdu, { SEVERITY_NAMES } from "../syslog/Pdu";
import RequestContext from "../runtime/RequestContext";
import assert from "node:assert";
import { ConsoleTransport } from "../syslog/transports/ConsoleTransport";
import { FileTransport } from "../syslog/transports/FileTransport";
import { HttpTransport } from "../syslog/transports/HttpTransport";
import { SyslogTransport } from "../syslog/transports/SyslogTransport";
import type { ITransport } from "../types/ITransport";
import * as http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Met un serveur de test en écoute sur un port éphémère de la boucle locale
 * et rend son adresse — l'équivalent attendable de `server.listen(0, cb)`.
 */
const listen = (server: http.Server): Promise<{ port: number }> =>
  new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve(server.address() as { port: number });
    });
  });

class TestSyslog extends Syslog {
  _eventsCount?: number;
}

class TestPdu extends Pdu {
  before?: string;
}

declare let global: typeof globalThis & {
  syslog: TestSyslog;
  logger: Function;
  Pdu: TestPdu;
};

const defaultOptions: conditionsInterface = {
  severity: {
    operator: "<=",
    data: "7",
  },
};

describe("NODEFONY SYSLOG", () => {
  beforeAll(() => {
    global.syslog = new Syslog();

    global.syslog.listenWithConditions(
      defaultOptions,
      (pdu: Pdu) =>
        // nodefony.Syslog.normalizeLog(pdu);
        true,
    );
    global.logger = () => {
      global.syslog.log("info", "INFO");
      global.syslog.log("debug", "DEBUG");
      global.syslog.log("notice", "NOTICE");
      global.syslog.log("warning", "WARNING");
      global.syslog.log("error", "ERROR");
      global.syslog.log("alert", "ALERT");
      global.syslog.log("critic", "CRITIC");
      global.syslog.log("emergency", "EMERGENCY");
    };
  });

  describe("CONTRUSTROR ", () => {
    it("Constructor ", () =>
      new Promise<void>((done) => {
        const inst = new Syslog();
        assert.strict.equal(inst.ringStack.length, 0);
        done();
      }));
    it("Check options moduleName ", () =>
      new Promise<void>((done) => {
        const inst = new Syslog({
          moduleName: "MYMODULE",
        });
        inst.listenWithConditions(defaultOptions, (pdu: Pdu) => {
          assert.strict.equal(pdu.moduleName, "MYMODULE");
          assert.strict.equal(pdu.severity, 7);
          assert.strict.equal(pdu.payload, "test");
        });
        inst.log("test");
        done();
      }));
    it("Check options sevirity ", () =>
      new Promise<void>((done) => {
        const inst = new Syslog({
          moduleName: "MYMODULE2",
          defaultSeverity: "ALERT",
        });
        inst.listenWithConditions(defaultOptions, (pdu: Pdu) => {
          assert.strict.equal(pdu.moduleName, "MYMODULE2");
          assert.strict.equal(pdu.severity, 1);
          assert.strict.equal(pdu.payload, "test");
        });
        inst.log("test");
        done();
      }));

    it("Change stack size ", () =>
      new Promise<void>((done) => {
        const inst = new Syslog({
          maxStack: 500,
        });
        for (let i = 0; i < 1000; i++) {
          inst.log(i);
        }
        assert.strict.equal(inst.ringStack.length, 500);
        done();
      }));

    it("Pdu porte le pid du process (procid RFC 5424)", () => {
      const pdu = new Pdu("test", "INFO");
      assert.strict.equal(pdu.pid, process.pid);
    });

    it("pid voyage via parseJson (round-trip pipeline / cluster)", () => {
      const pdu = new Pdu("x", "INFO");
      pdu.parseJson(JSON.stringify({ pid: 99999, payload: "y" }));
      assert.strict.equal(pdu.pid, 99999);
      assert.strict.equal(pdu.payload, "y");
    });
  });

  describe("RING STACK", () => {
    beforeEach(() => {
      // global.syslog.log(this.currentTest.title)
    });
    beforeAll(() => {});
    it("100 entries ", () =>
      new Promise<void>((done) => {
        for (let i = 0; i < 100; i++) {
          const pdu = global.syslog.log(i, i % 2 ? "INFO" : "DEBUG");
          assert.strict.equal(pdu.payload, i);
          // assert.strict.equal(pdu.uid, i + 1);
          assert.strict.equal(pdu.severity, i % 2 ? 6 : 7);
          assert.strict.equal(pdu.severityName, i % 2 ? "INFO" : "DEBUG");
          assert.strict.equal(pdu.status, "ACCEPTED");
          assert.strict.equal(pdu.moduleName, "SYSLOG");
          assert.strict.equal(pdu.typePayload, "number");
          assert.strict.equal(pdu.msgid, "");
          assert.strict.equal(pdu.msg, "");
        }
        assert.strict.equal(global.syslog.ringStack[0].payload, 0);
        assert.strict.equal(global.syslog.ringStack[99].payload, 99);
        assert.strict.equal(global.syslog.missed, 0);
        assert.strict.equal(global.syslog.invalid, 0);
        assert.strict.equal(global.syslog.valid, 100);
        assert.strict.equal(global.syslog._eventsCount, 1);
        assert.strict.equal(global.syslog.listenerCount("onLog"), 1);
        done();
      }));

    it("1000  entries ", () =>
      new Promise<void>((done) => {
        let i = 0;
        global.syslog.on("onLog", (pdu) => i++);
        for (let i = 0; i < 1000; i++) {
          global.syslog.log(i, i % 2 ? "INFO" : "DEBUG");
        }
        assert.strict.equal(global.syslog.ringStack.length, 100);
        assert.strict.equal(global.syslog.ringStack[0].payload, 900);
        assert.strict.equal(global.syslog.ringStack[99].payload, 999);
        assert.strict.equal(global.syslog.missed, 0);
        assert.strict.equal(global.syslog.invalid, 0);
        assert.strict.equal(global.syslog.valid, 1100);
        assert.strict.equal(global.syslog.listenerCount("onLog"), 2);
        assert.strict.equal(i, 1000);
        done();
      }));
  });

  describe("getLogStack", () => {
    it("reload 1000  entries ", () =>
      new Promise<void>((done) => {
        let res: Pdu | Pdu[] = <Pdu>global.syslog.getLogStack();
        assert.strict.equal(res.payload, 999);
        res = global.syslog.getLogStack(0, 10);
        //assert.strict.equal((res?[0] as Pdu[] ).payload, 900);
        assert.strict.equal((res as Pdu[])[0]?.payload, 900);
        assert.strict.equal((res as Pdu[])[9].payload, 909);
        res = global.syslog.getLogStack(0);
        assert.strict.equal((res as Pdu[])[0].payload, 900);
        assert.strict.equal((res as Pdu[])[99].payload, 999);
        res = global.syslog.getLogStack(50);
        assert.strict.equal((res as Pdu[])[0].payload, 950);
        assert.strict.equal((res as Pdu[])[49].payload, 999);
        res = global.syslog.getLogStack(10, 10);
        assert.strict.equal((res as Pdu).payload, 989);
        done();
      }));
  });

  describe("getLogs conditions ", () => {
    it("getLogs 1000  entries ", () =>
      new Promise<void>((done) => {
        const res: conditionsInterface = global.syslog.getLogs({
          severity: {
            data: "INFO",
          },
        });
        assert.strict.equal(res.length, 50);
        done();
      }));
  });

  describe("loadStack ", () => {
    it("loadStack 1000  entries ", () =>
      new Promise<void>((done) => {
        const inst = new Syslog({
          maxStack: 100,
        });
        inst.loadStack(global.syslog.ringStack);
        assert.strict.equal(inst.ringStack.length, 100);
        done();
      }));

    it("loadStack 1000 events  ", () =>
      new Promise<void>((done) => {
        const inst = new Syslog({
          maxStack: 100,
        });
        let i = 0;
        inst.listenWithConditions(
          {
            severity: {
              data: "INFO",
            },
          },
          (pdu: Pdu) => {
            i++;
            // nodefony.Syslog.normalizeLog(pdu);
          },
        );
        inst.loadStack(global.syslog.ringStack, true);
        assert.strict.equal(inst.ringStack.length, 100);
        assert.strict.equal(i, 50);
        done();
      }));

    it("loadStack 1000 events  ", () =>
      new Promise<void>((done) => {
        const inst = new Syslog({
          maxStack: 100,
        });
        let i = 0;
        inst.listenWithConditions(
          {
            severity: {
              data: "INFO",
            },
          },
          (pdu: Pdu) => {
            i++;
            // nodefony.Syslog.normalizeLog(pdu);
          },
        );
        inst.loadStack(global.syslog.ringStack, true, (pdu: TestPdu) => {
          (pdu as TestPdu).before = "add";
        });
        assert.strict.equal(inst.ringStack.length, 100);
        assert.strict.equal(i, 50);
        assert.strict.equal((inst.getLogStack() as TestPdu).before, "add");
        done();
      }));
  });

  describe("BASE", () => {
    beforeAll(() => {
      global.syslog.reset();
    });
    it("LOG sevirity ", () =>
      new Promise<void>((done) => {
        let i = 0;
        global.syslog.listenWithConditions(defaultOptions, (pdu: Pdu) => {
          switch (pdu.severityName) {
            case "EMERGENCY": {
              assert.strict.equal(pdu.severity, 0);
              assert.strict.equal(pdu.msgid, "MYMODULE0");
              i++;
              break;
            }
            case "ALERT": {
              i++;
              assert.strict.equal(pdu.severity, 1);
              assert.strict.equal(pdu.msgid, "MYMODULE1");
              break;
            }
            case "CRITIC": {
              assert.strict.equal(pdu.severity, 2);
              assert.strict.equal(pdu.msgid, "MYMODULE2");
              i++;
              break;
            }
            case "ERROR": {
              assert.strict.equal(pdu.severity, 3);
              assert.strict.equal(pdu.msgid, "MYMODULE3");
              i++;
              break;
            }
            case "WARNING": {
              assert.strict.equal(pdu.severity, 4);
              assert.strict.equal(pdu.msgid, "MYMODULE4");
              i++;
              break;
            }
            case "NOTICE": {
              assert.strict.equal(pdu.severity, 5);
              assert.strict.equal(pdu.msgid, "MYMODULE5");
              i++;
              break;
            }
            case "INFO": {
              assert.strict.equal(pdu.severity, 6);
              assert.strict.equal(pdu.msgid, "MYMODULE6");
              i++;
              break;
            }
            case "DEBUG": {
              assert.strict.equal(pdu.severity, 7);
              assert.strict.equal(pdu.msgid, "MYMODULE7");
              i++;
              break;
            }
          }
        });
        global.syslog.log("test", "EMERGENCY", "MYMODULE0");
        global.syslog.log("test", "ALERT", "MYMODULE1");
        global.syslog.log("test", "CRITIC", "MYMODULE2");
        global.syslog.log("test", "ERROR", "MYMODULE3");
        global.syslog.log("test", "WARNING", "MYMODULE4");
        global.syslog.log("test", "NOTICE", "MYMODULE5");
        global.syslog.log("test", "INFO", "MYMODULE6");
        global.syslog.log("test", "DEBUG", "MYMODULE7");
        assert.strict.equal(i, 8);
        done();
      }));
  });

  describe("SEVERITY", () => {
    beforeEach(() => {
      global.syslog.reset();
      assert.strict.equal(global.syslog._eventsCount, 0);
    });

    it("listener ", () =>
      new Promise<void>((done) => {
        let i = 0;
        global.syslog.listenWithConditions(defaultOptions, (pdu: Pdu) => i++);
        assert.strict.equal(global.syslog._eventsCount, 1);
        for (let i = 0; i < 10; i++) {
          global.syslog.log(i, i % 2 ? "INFO" : "DEBUG");
        }
        assert.strict.equal(i, 10);
        done();
      }));

    it("Other listener 2 ", () =>
      new Promise<void>((done) => {
        let i = 0;
        global.syslog.listenWithConditions(
          {
            severity: {
              operator: "<=",
              data: "INFO",
            },
          },
          (pdu: Pdu) => i++,
        );
        assert.strict.equal(global.syslog._eventsCount, 1);
        for (let i = 0; i < 10; i++) {
          global.syslog.log(i, i % 2 ? "INFO" : "DEBUG");
        }
        assert.strict.equal(i, 5);
        done();
      }));

    it("Other listener 3 ", () =>
      new Promise<void>((done) => {
        let i = 0;
        global.syslog.listenWithConditions(
          {
            severity: {
              operator: "<=",
              data: "INFO",
            },
          },
          (pdu: Pdu) => {
            assert.strict.equal(pdu.severity, 6);
            assert.strict.equal(pdu.severityName, "INFO");
            return i++;
          },
        );
        assert.strict.equal(global.syslog._eventsCount, 1);
        for (let i = 0; i < 10; i++) {
          global.syslog.log(i, i % 2 ? "INFO" : "DEBUG");
        }
        assert.strict.equal(i, 5);
        done();
      }));

    it("listener condition severity interger ", () =>
      new Promise<void>((done) => {
        let i = 0;
        global.syslog.listenWithConditions(
          {
            severity: {
              data: 6,
            },
          },
          (pdu: Pdu) => {
            // nodefony.Syslog.normalizeLog(pdu);
            assert.strict.equal(pdu.severity, 6);
            assert.strict.equal(pdu.severityName, "INFO");
            return i++;
          },
        );
        for (let i = 0; i < 10; i++) {
          global.syslog.log(i, i % 2 ? "INFO" : "DEBUG");
        }
        assert.strict.equal(i, 5);
        done();
      }));

    it("listener condition severity operator == ", () =>
      new Promise<void>((done) => {
        let i = 0;
        global.syslog.listenWithConditions(
          {
            severity: {
              operator: "==",
              data: "7",
            },
          },
          (pdu: Pdu) => {
            // nodefony.Syslog.normalizeLog(pdu);
            assert.strict.equal(pdu.severity, 7);
            assert.strict.equal(pdu.severityName, "DEBUG");
            return i++;
          },
        );
        assert.strict.equal(global.syslog._eventsCount, 1);
        for (let i = 0; i < 10; i++) {
          global.syslog.log(i, i % 2 ? "INFO" : "DEBUG");
        }
        assert.strict.equal(i, 5);
        done();
      }));

    it("listener condition severity listerner1 ", () =>
      new Promise<void>((done) => {
        let i = 0;
        global.syslog.listenWithConditions(
          {
            severity: {
              data: "INFO,DEBUG,WARNING",
            },
          },
          (pdu: Pdu) =>
            // nodefony.Syslog.normalizeLog(pdu);
            i++,
        );
        global.logger();
        assert.strict.equal(i, 3);
        done();
      }));
    it("listener condition severity listerner tab", () =>
      new Promise<void>((done) => {
        let i = 0;
        global.syslog.listenWithConditions(
          {
            severity: {
              data: ["INFO", "WARNING", "DEBUG"],
            },
          },
          (pdu: Pdu) =>
            // nodefony.Syslog.normalizeLog(pdu);
            i++,
        );
        global.logger();
        assert.strict.equal(i, 3);
        done();
      }));
    it("listener condition severity listerner tab string", () =>
      new Promise<void>((done) => {
        let i = 0;
        global.syslog.listenWithConditions(
          {
            severity: {
              data: ["6", "4", "7"],
            },
          },
          (pdu: Pdu) =>
            // nodefony.Syslog.normalizeLog(pdu);
            i++,
        );
        global.logger();
        assert.strict.equal(i, 3);
        done();
      }));
    it("listener condition severity listerner tab integer", () =>
      new Promise<void>((done) => {
        let i = 0;
        global.syslog.listenWithConditions(
          {
            severity: {
              data: [6, 4, 7],
            },
          },
          (pdu: Pdu) =>
            // nodefony.Syslog.normalizeLog(pdu);
            i++,
        );
        global.logger();
        assert.strict.equal(i, 3);
        done();
      }));

    it("listener condition severity listerner >=", () =>
      new Promise<void>((done) => {
        let i = 0;
        global.syslog.listenWithConditions(
          {
            severity: {
              operator: ">=",
              data: 4,
            },
          },
          (pdu: Pdu) =>
            // nodefony.Syslog.normalizeLog(pdu);
            i++,
        );
        global.logger();
        assert.strict.equal(i, 4);
        done();
      }));
    it("listener condition severity listerner >", () =>
      new Promise<void>((done) => {
        let i = 0;
        global.syslog.listenWithConditions(
          {
            severity: {
              operator: ">",
              data: 4,
            },
          },
          (pdu: Pdu) =>
            // nodefony.Syslog.normalizeLog(pdu);
            i++,
        );
        global.logger();
        assert.strict.equal(i, 3);
        done();
      }));
    it("listener condition severity listerner <", () =>
      new Promise<void>((done) => {
        let i = 0;
        global.syslog.listenWithConditions(
          {
            severity: {
              operator: "<",
              data: 4,
            },
          },
          (pdu: Pdu) =>
            // nodefony.Syslog.normalizeLog(pdu);
            i++,
        );
        global.logger();
        assert.strict.equal(i, 4);
        done();
      }));
    it("listener condition severity listerner < string", () =>
      new Promise<void>((done) => {
        let i = 0;
        global.syslog.listenWithConditions(
          {
            severity: {
              operator: "<",
              data: "WARNING",
            },
          },
          (pdu: Pdu) =>
            // nodefony.Syslog.normalizeLog(pdu);
            i++,
        );
        global.logger();
        assert.strict.equal(i, 4);
        done();
      }));
  });

  describe("MSGID", () => {
    beforeEach(() => {
      global.syslog.reset();
    });
    it("listener condition MSGID ", () =>
      new Promise((resolve, reject) => {
        let i = 0;
        global.syslog.listenWithConditions(
          {
            msgid: {
              data: "NODEFONY",
            },
            severity: {
              data: ["INFO", "ERROR"],
            },
          },
          (pdu: Pdu) => {
            i++;
            assert.strict.equal(pdu.msgid, "NODEFONY");
            assert.strict.equal(pdu.payload, "pass");
            if (i === 3) {
              resolve(true);
            }
          },
        );
        global.syslog.log("pass", "INFO", "NODEFONY");
        global.syslog.log("nopass", "INFO");
        global.syslog.log("pass", "INFO", "NODEFONY");
        global.syslog.log("nopass", "DEBUG", "NODEFONY");
        global.syslog.log("pass", "ERROR", "NODEFONY");
      }));

    it("listener condition MSGID RegExp", () =>
      new Promise<void>((done) => {
        let i = 0;
        global.syslog.listenWithConditions(
          {
            msgid: {
              data: /^NODEFONY/,
            },
          },
          (pdu: Pdu) => {
            i++;
            assert.ok(pdu.msgid.startsWith("NODEFONY"));
          },
        );
        global.syslog.log("pass", "INFO", "NODEFONY_SERVICE");
        global.syslog.log("nopass", "INFO", "OTHER_MODULE");
        global.syslog.log("pass", "INFO", "NODEFONY_KERNEL");
        assert.strict.equal(i, 2);
        done();
      }));
  });

  describe("print / logMultiple", () => {
    beforeEach(() => {
      global.syslog.reset();
    });

    it("print single arg", () =>
      new Promise<void>((done) => {
        const pdu = global.syslog.print("hello");
        assert.strict.equal(pdu.payload, "hello");
        assert.strict.equal(pdu.status, "ACCEPTED");
        done();
      }));

    it("print multiple args → array payload", () =>
      new Promise<void>((done) => {
        const pdu = global.syslog.print("a", { n: 1 }, 42);
        assert.deepStrictEqual(pdu.payload, ["a", { n: 1 }, 42]);
        assert.strict.equal(pdu.typePayload, "array");
        assert.strict.equal(global.syslog.ringStack.length, 1);
        done();
      }));

    it("print uses defaultSeverity", () =>
      new Promise<void>((done) => {
        const inst = new Syslog({ defaultSeverity: "ERROR" });
        const pdu = inst.print("fail");
        assert.strict.equal(pdu.severity, 3);
        done();
      }));

    it("logMultiple single arg", () =>
      new Promise<void>((done) => {
        const pdu = global.syslog.logMultiple("WARNING", "oops");
        assert.strict.equal(pdu.payload, "oops");
        assert.strict.equal(pdu.severity, 4);
        done();
      }));

    it("logMultiple multiple args → array payload with given severity", () =>
      new Promise<void>((done) => {
        const err = new Error("boom");
        const pdu = global.syslog.logMultiple("ERROR", "fail", err);
        assert.deepStrictEqual(pdu.payload, ["fail", err]);
        assert.strict.equal(pdu.severity, 3);
        done();
      }));
  });

  describe("rawLog (process.stdout/stderr)", () => {
    // En test stdout n'est pas un TTY → `auto` bufériserait writeOut et les
    // assertions stdout synchrones échoueraient. On force le mode immédiat ici.
    beforeEach(() => Syslog.setOutputBuffering(false));
    afterEach(() => Syslog.setOutputBuffering("auto"));

    it("string payload → stdout", () =>
      new Promise<void>((done) => {
        const chunks: string[] = [];
        const orig = process.stdout.write.bind(process.stdout);
        process.stdout.write = (chunk: unknown) => {
          chunks.push(String(chunk));
          return true;
        };
        const pdu = global.syslog.log("raw test", "INFO", "TEST");
        Syslog.rawLog(pdu);
        process.stdout.write = orig;
        assert.ok(chunks.some((c) => c.includes("raw test")));
        done();
      }));

    it("ERROR payload → stderr", () =>
      new Promise<void>((done) => {
        const chunks: string[] = [];
        const orig = process.stderr.write.bind(process.stderr);
        process.stderr.write = (chunk: unknown) => {
          chunks.push(String(chunk));
          return true;
        };
        const pdu = global.syslog.log("error msg", "ERROR", "TEST");
        Syslog.rawLog(pdu);
        process.stderr.write = orig;
        assert.ok(chunks.some((c) => c.includes("error msg")));
        done();
      }));

    it("object payload → inspect output", () =>
      new Promise<void>((done) => {
        const chunks: string[] = [];
        const orig = process.stdout.write.bind(process.stdout);
        process.stdout.write = (chunk: unknown) => {
          chunks.push(String(chunk));
          return true;
        };
        const pdu = global.syslog.log({ user: "alice" }, "DEBUG", "TEST");
        Syslog.rawLog(pdu);
        process.stdout.write = orig;
        assert.ok(chunks.some((c) => c.includes("alice")));
        done();
      }));

    it("empty payload → no write", () =>
      new Promise<void>((done) => {
        let written = false;
        const origOut = process.stdout.write.bind(process.stdout);
        const origErr = process.stderr.write.bind(process.stderr);
        process.stdout.write = () => {
          written = true;
          return true;
        };
        process.stderr.write = () => {
          written = true;
          return true;
        };
        const pdu = new Pdu("", "INFO");
        Syslog.rawLog(pdu);
        process.stdout.write = origOut;
        process.stderr.write = origErr;
        assert.strict.equal(written, false);
        done();
      }));
  });

  describe("output buffering (setOutputBuffering / flushOutput)", () => {
    afterEach(() => Syslog.setOutputBuffering("auto"));

    it("buffered: coalesce N writes into a single flush", () => {
      const chunks: string[] = [];
      const orig = process.stdout.write.bind(process.stdout);
      process.stdout.write = (c: unknown) => {
        chunks.push(String(c));
        return true;
      };
      try {
        Syslog.setOutputBuffering(true);
        Syslog.rawLog(new Pdu("buf-a", "INFO"));
        Syslog.rawLog(new Pdu("buf-b", "INFO"));
        // bufférisé : rien sur stdout tant qu'on n'a pas flush
        assert.strictEqual(chunks.length, 0);
        Syslog.flushOutput();
        // 1 seul write coalescé contenant les 2 lignes
        assert.strictEqual(chunks.length, 1);
        assert.ok(chunks[0].includes("buf-a") && chunks[0].includes("buf-b"));
      } finally {
        process.stdout.write = orig;
      }
    });

    it("immediate (false): chaque write part direct sur stdout", () => {
      const chunks: string[] = [];
      const orig = process.stdout.write.bind(process.stdout);
      process.stdout.write = (c: unknown) => {
        chunks.push(String(c));
        return true;
      };
      try {
        Syslog.setOutputBuffering(false);
        Syslog.rawLog(new Pdu("imm-a", "INFO"));
        assert.strictEqual(chunks.length, 1);
        assert.ok(chunks[0].includes("imm-a"));
      } finally {
        process.stdout.write = orig;
      }
    });

    it("stderr (ERROR) immédiat + flush du stdout en attente (ordre causal 2>&1)", () => {
      const out: string[] = [];
      const err: string[] = [];
      const oOut = process.stdout.write.bind(process.stdout);
      const oErr = process.stderr.write.bind(process.stderr);
      process.stdout.write = (c: unknown) => {
        out.push(String(c));
        return true;
      };
      process.stderr.write = (c: unknown) => {
        err.push(String(c));
        return true;
      };
      try {
        Syslog.setOutputBuffering(true);
        Syslog.rawLog(new Pdu("info-pending", "INFO")); // bufférisé
        assert.strictEqual(out.length, 0);
        Syslog.rawLog(new Pdu("boom", "ERROR")); // stderr immédiat
        assert.strictEqual(err.length, 1);
        assert.ok(err[0].includes("boom"));
        // le stdout en attente est flushé AVANT l'erreur (ordre préservé en 2>&1)
        assert.strictEqual(out.length, 1);
        assert.ok(out[0].includes("info-pending"));
      } finally {
        process.stdout.write = oOut;
        process.stderr.write = oErr;
      }
    });

    it("flushOutput est idempotent (no-op si buffer vide)", () => {
      const chunks: string[] = [];
      const orig = process.stdout.write.bind(process.stdout);
      process.stdout.write = (c: unknown) => {
        chunks.push(String(c));
        return true;
      };
      try {
        Syslog.setOutputBuffering(true);
        Syslog.flushOutput();
        Syslog.flushOutput();
        assert.strictEqual(chunks.length, 0);
      } finally {
        process.stdout.write = orig;
      }
    });
  });

  describe("Console override", () => {
    afterEach(() => {
      Syslog.restoreConsole();
    });

    it("overrideConsole + console.log → ring buffer", () =>
      new Promise<void>((done) => {
        const inst = new Syslog({ maxStack: 10 });
        Syslog.overrideConsole(inst);
        console.log("test override");
        assert.strict.equal(inst.ringStack.length, 1);
        assert.strict.equal(inst.ringStack[0].payload, "test override");
        done();
      }));

    it("console.error uses ERROR severity", () =>
      new Promise<void>((done) => {
        const inst = new Syslog({ maxStack: 10 });
        Syslog.overrideConsole(inst);
        console.error("critical");
        assert.strict.equal(inst.ringStack[0].severity, 3);
        done();
      }));

    it("console.warn uses WARNING severity", () =>
      new Promise<void>((done) => {
        const inst = new Syslog({ maxStack: 10 });
        Syslog.overrideConsole(inst);
        console.warn("careful");
        assert.strict.equal(inst.ringStack[0].severity, 4);
        done();
      }));

    it("console.info uses INFO severity", () =>
      new Promise<void>((done) => {
        const inst = new Syslog({ maxStack: 10 });
        Syslog.overrideConsole(inst);
        console.info("fyi");
        assert.strict.equal(inst.ringStack[0].severity, 6);
        done();
      }));

    it("double override emits WARNING pdu", () =>
      new Promise<void>((done) => {
        const inst = new Syslog({ maxStack: 10 });
        Syslog.overrideConsole(inst);
        Syslog.overrideConsole(inst);
        assert.strict.equal(inst.ringStack.length, 1);
        assert.strict.equal(inst.ringStack[0].severity, 4); // WARNING
        done();
      }));

    it("restoreConsole is idempotent", () =>
      new Promise<void>((done) => {
        Syslog.restoreConsole();
        Syslog.restoreConsole();
        done();
      }));

    it("overrideConsole option in settings", () =>
      new Promise<void>((done) => {
        const inst = new Syslog({ maxStack: 10, overrideConsole: true });
        console.log("via settings");
        assert.strict.equal(inst.ringStack.length, 1);
        assert.strict.equal(inst.ringStack[0].payload, "via settings");
        done();
      }));

    it("console.log multiple args → array payload", () =>
      new Promise<void>((done) => {
        const inst = new Syslog({ maxStack: 10 });
        Syslog.overrideConsole(inst);
        console.log("a", "b", 3);
        assert.deepStrictEqual(inst.ringStack[0].payload, ["a", "b", 3]);
        done();
      }));
  });

  describe("PDU SEVERITY NUMERIC", () => {
    it("PIÈGE : une sévérité numérique HORS échelle est refusée", () =>
      new Promise<void>((done) => {
        // `-1` portait l'extension `SPINNER`, retirée : aucun code de
        // production ne l'émettait, et les indicateurs d'attente du framework
        // écrivent directement sur le terminal (`cli/progress.ts`). La valeur
        // redevient donc ce qu'elle est pour la RFC 5424 : hors échelle.
        assert.throws(() => new Pdu("spin", -1));
        done();
      }));

    it("Pdu severity 0-7 numeric", () =>
      new Promise<void>((done) => {
        for (let n = 0; n <= 7; n++) {
          const pdu = new Pdu("test", n as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7);
          assert.strict.equal(pdu.severity, n);
        }
        done();
      }));

    it("Pdu severity invalid numeric throws", () =>
      new Promise<void>((done) => {
        assert.throws(() => new Pdu("test", 99 as never), /Not a valid/);
        done();
      }));
  });

  // ─── Transport Layer ────────────────────────────────────────────────────────

  describe("addTransport / removeTransport", () => {
    let syslog: Syslog;
    beforeEach(() => {
      syslog = new Syslog();
    });

    it("addTransport returns this (chaining)", () =>
      new Promise<void>((done) => {
        const t: ITransport = { name: "mock", send: async () => {} };
        assert.strict.equal(syslog.addTransport(t), syslog);
        done();
      }));

    it("removeTransport returns this (chaining)", () =>
      new Promise<void>((done) => {
        const t: ITransport = { name: "mock", send: async () => {} };
        syslog.addTransport(t);
        assert.strict.equal(syslog.removeTransport(t), syslog);
        done();
      }));

    it("transport.send is called on log()", () =>
      new Promise<void>((done) => {
        let called = 0;
        const t: ITransport = {
          name: "spy",
          send: async () => {
            called++;
          },
        };
        syslog.addTransport(t);
        syslog.log("hello", "INFO");
        // fire-and-forget — wait one microtask
        setImmediate(() => {
          assert.strict.equal(called, 1);
          done();
        });
      }));

    it("addTransport deduplication — same instance added twice calls send once", () =>
      new Promise<void>((done) => {
        let called = 0;
        const t: ITransport = {
          name: "spy",
          send: async () => {
            called++;
          },
        };
        syslog.addTransport(t);
        syslog.addTransport(t); // duplicate — ignored
        syslog.log("test", "INFO");
        setImmediate(() => {
          assert.strict.equal(called, 1);
          done();
        });
      }));

    it("addTransport dédup par NAME — 2 instances DISTINCTES de même name ⇒ send appelé 1× (régression doublon JSONL cluster-file)", () =>
      new Promise<void>((done) => {
        let a = 0;
        let b = 0;
        // Deux transports DISTINCTS mais de même `name` : cas d'un FileTransport vers
        // le même fichier monté par DEUX Kernels qui partagent le syslog (cluster,
        // worker booté 2 cycles dev→prod). Avant le fix, la dédup par référence les
        // laissait tous deux dans `_transports` → chaque log écrit 2× (ratio 2.0).
        const tA: ITransport = {
          name: "file",
          send: async () => {
            a++;
          },
        };
        const tB: ITransport = {
          name: "file",
          send: async () => {
            b++;
          },
        };
        syslog.addTransport(tA);
        syslog.addTransport(tB); // même name → REMPLACE tA (pas d'ajout en double)
        assert.strict.equal(syslog.transportCount, 1);
        syslog.log("test", "INFO");
        setImmediate(() => {
          // tB a remplacé tA → un seul send, côté destination la plus récente.
          assert.strict.equal(a + b, 1);
          assert.strict.equal(b, 1);
          done();
        });
      }));

    it("removeTransport stops further calls", () =>
      new Promise<void>((done) => {
        let called = 0;
        const t: ITransport = {
          name: "spy",
          send: async () => {
            called++;
          },
        };
        syslog.addTransport(t);
        syslog.removeTransport(t);
        syslog.log("test", "INFO");
        setImmediate(() => {
          assert.strict.equal(called, 0);
          done();
        });
      }));

    it("removeTransport on unknown transport does nothing", () =>
      new Promise<void>((done) => {
        const t: ITransport = { name: "unknown", send: async () => {} };
        assert.doesNotThrow(() => syslog.removeTransport(t));
        done();
      }));

    it("multiple transports all receive each Pdu", () =>
      new Promise<void>((done) => {
        const calls: string[] = [];
        const t1: ITransport = {
          name: "t1",
          send: async () => {
            calls.push("t1");
          },
        };
        const t2: ITransport = {
          name: "t2",
          send: async () => {
            calls.push("t2");
          },
        };
        syslog.addTransport(t1).addTransport(t2);
        syslog.log("multi", "INFO");
        setImmediate(() => {
          assert.deepStrictEqual(calls, ["t1", "t2"]);
          done();
        });
      }));

    it("onTransportError fires when send() rejects", () =>
      new Promise<void>((done) => {
        const boom = new Error("send failed");
        const t: ITransport = { name: "bad", send: () => Promise.reject(boom) };
        syslog.addTransport(t);
        syslog.on("onTransportError", (err: unknown) => {
          assert.strict.equal(err, boom);
          done();
        });
        syslog.log("trigger", "INFO");
      }));

    it("DROPPED pdu — transport not called", () =>
      new Promise<void>((done) => {
        const rl = new Syslog({ rateLimit: 10000, burstLimit: 1 });
        let called = 0;
        const t: ITransport = {
          name: "spy",
          send: async () => {
            called++;
          },
        };
        rl.addTransport(t);
        rl.log("first", "INFO"); // ACCEPTED
        rl.log("second", "INFO"); // DROPPED
        setImmediate(() => {
          assert.strict.equal(called, 1);
          done();
        });
      }));
  });

  describe("ConsoleTransport", () => {
    it("implements ITransport with name=console", () =>
      new Promise<void>((done) => {
        const t = new ConsoleTransport();
        assert.strict.equal(t.name, "console");
        done();
      }));

    it("send() calls Syslog.normalizeLog", async () => {
      const pdu = new Pdu("hello", "INFO", "TEST");
      pdu.status = "ACCEPTED";
      let called = false;
      const orig = Syslog.normalizeLog;
      Syslog.normalizeLog = (p: Pdu) => {
        called = true;
        return p;
      };
      const t = new ConsoleTransport();
      try {
        await t.send(pdu);
      } finally {
        Syslog.normalizeLog = orig;
      }
      assert.strict.equal(called, true);
    });
  });

  describe("FileTransport", () => {
    let tmpFile: string;
    beforeEach(() => {
      tmpFile = path.join(os.tmpdir(), `syslog-test-${Date.now()}.log`);
    });
    afterEach(() => {
      try {
        fs.unlinkSync(tmpFile);
      } catch {}
    });

    it("implements ITransport with name=file", () =>
      new Promise<void>((done) => {
        const t = new FileTransport({ path: tmpFile });
        assert.strict.equal(t.name, "file");
        done();
      }));

    it("json format writes valid JSON per line", async () => {
      const t = new FileTransport({ path: tmpFile, format: "json" });
      const pdu = new Pdu("hello json", "INFO", "TEST");
      pdu.status = "ACCEPTED";
      await t.send(pdu);
      const content = fs.readFileSync(tmpFile, "utf8");
      const parsed = JSON.parse(content.trim());
      assert.strict.equal(parsed.payload, "hello json");
      assert.strict.equal(parsed.severityName, "INFO");
    });

    it("text format writes human-readable line", async () => {
      const t = new FileTransport({ path: tmpFile, format: "text" });
      const pdu = new Pdu("hello text", "WARNING", "MOD");
      pdu.status = "ACCEPTED";
      await t.send(pdu);
      const content = fs.readFileSync(tmpFile, "utf8");
      assert.ok(content.includes("WARNING"));
      assert.ok(content.includes("hello text"));
    });

    it("default format is json", async () => {
      const t = new FileTransport({ path: tmpFile });
      const pdu = new Pdu("default", "DEBUG", "X");
      pdu.status = "ACCEPTED";
      await t.send(pdu);
      const content = fs.readFileSync(tmpFile, "utf8");
      const parsed = JSON.parse(content.trim());
      assert.strict.equal(parsed.payload, "default");
    });

    it("appends multiple pdus as separate lines", async () => {
      const t = new FileTransport({ path: tmpFile, format: "json" });
      const pdu1 = new Pdu("first", "INFO", "T");
      const pdu2 = new Pdu("second", "ERROR", "T");
      pdu1.status = "ACCEPTED";
      pdu2.status = "ACCEPTED";
      await t.send(pdu1);
      await t.send(pdu2);
      const lines = fs.readFileSync(tmpFile, "utf8").trim().split("\n");
      assert.strict.equal(lines.length, 2);
      assert.strict.equal(JSON.parse(lines[0]).payload, "first");
      assert.strict.equal(JSON.parse(lines[1]).payload, "second");
    });

    it("send() rejects on bad path (fire → onTransportError)", () =>
      new Promise<void>((done) => {
        const syslog = new Syslog();
        const t = new FileTransport({ path: "/no/such/dir/nope.log" });
        syslog.addTransport(t);
        syslog.on("onTransportError", (err: unknown) => {
          assert.ok(err instanceof Error);
          done();
        });
        syslog.log("trigger", "INFO");
      }));
  });

  describe("HttpTransport", () => {
    it("implements ITransport with name=http", () =>
      new Promise<void>((done) => {
        const t = new HttpTransport({ url: "http://localhost:9999" });
        assert.strict.equal(t.name, "http");
        done();
      }));

    it("send() POSTs JSON to a local server", async () => {
      let body = "";
      const server = http.createServer((req, res) => {
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          res.writeHead(200);
          res.end();
        });
      });
      const addr = await listen(server);
      const t = new HttpTransport({ url: `http://127.0.0.1:${addr.port}` });
      const pdu = new Pdu("http test", "INFO", "HTTP");
      pdu.status = "ACCEPTED";
      try {
        await t.send(pdu);
      } finally {
        server.close();
      }
      const parsed = JSON.parse(body);
      assert.strict.equal(parsed.payload, "http test");
    });

    it("send() rejects on HTTP 4xx", async () => {
      const server = http.createServer((_req, res) => {
        res.writeHead(400);
        res.end();
      });
      const addr = await listen(server);
      const t = new HttpTransport({ url: `http://127.0.0.1:${addr.port}` });
      const pdu = new Pdu("fail", "ERROR", "X");
      pdu.status = "ACCEPTED";
      try {
        await assert.rejects(() => t.send(pdu), /HTTP 400/);
      } finally {
        server.close();
      }
    });

    it("send() rejects on connection refused (no server)", async () => {
      const t = new HttpTransport({ url: "http://127.0.0.1:1" });
      const pdu = new Pdu("refused", "ERROR", "X");
      pdu.status = "ACCEPTED";
      await assert.rejects(
        () => t.send(pdu),
        (err: unknown) => err instanceof Error,
      );
    });
  });

  describe("SyslogTransport", () => {
    it("implements ITransport with name=syslog", () =>
      new Promise<void>((done) => {
        const target = new Syslog();
        const t = new SyslogTransport(target);
        assert.strict.equal(t.name, "syslog");
        done();
      }));

    it("send() forwards Pdu to target syslog", async () => {
      const child = new Syslog({ moduleName: "CHILD" });
      const parent = new Syslog({ moduleName: "PARENT" });
      child.addTransport(new SyslogTransport(parent));
      child.log("forwarded", "WARNING");
      // wait for fire-and-forget
      await new Promise((r) => setImmediate(r));
      const stack = parent.ringStack;
      assert.strict.equal(stack.length, 1);
      assert.strict.equal(stack[0].payload, "forwarded");
      assert.strict.equal(stack[0].severityName, "WARNING");
    });

    it("forwarded Pdu is the same object (no copy)", async () => {
      const child = new Syslog();
      const parent = new Syslog();
      child.addTransport(new SyslogTransport(parent));
      const pdu = child.log("same obj", "INFO");
      await new Promise((r) => setImmediate(r));
      assert.strict.equal(parent.ringStack[0], pdu);
    });

    it("parent receives from multiple children", async () => {
      const parent = new Syslog({ maxStack: 50 });
      const c1 = new Syslog();
      const c2 = new Syslog();
      c1.addTransport(new SyslogTransport(parent));
      c2.addTransport(new SyslogTransport(parent));
      c1.log("from c1", "INFO");
      c2.log("from c2", "ERROR");
      await new Promise((r) => setImmediate(r));
      assert.strict.equal(parent.ringStack.length, 2);
    });
  });

  describe("console.table / console.dir override", () => {
    afterEach(() => {
      Syslog.restoreConsole();
    });

    it("console.table(data) → INFO pdu with data as payload", () =>
      new Promise<void>((done) => {
        const inst = new Syslog({ maxStack: 10 });
        Syslog.overrideConsole(inst);
        const data = [
          { id: 1, name: "Alice" },
          { id: 2, name: "Bob" },
        ];
        console.table(data);
        assert.strict.equal(inst.ringStack.length, 1);
        assert.strict.equal(inst.ringStack[0].severityName, "INFO");
        assert.deepStrictEqual(inst.ringStack[0].payload, data);
        done();
      }));

    it("console.dir(obj) → DEBUG pdu with obj as payload", () =>
      new Promise<void>((done) => {
        const inst = new Syslog({ maxStack: 10 });
        Syslog.overrideConsole(inst);
        const obj = { x: 42, nested: { y: true } };
        console.dir(obj);
        assert.strict.equal(inst.ringStack.length, 1);
        assert.strict.equal(inst.ringStack[0].severityName, "DEBUG");
        assert.deepStrictEqual(inst.ringStack[0].payload, obj);
        done();
      }));

    it("console.table and console.dir restored by restoreConsole", () =>
      new Promise<void>((done) => {
        const inst = new Syslog({ maxStack: 10 });
        Syslog.overrideConsole(inst);
        Syslog.restoreConsole();
        // After restore, console.table/dir should be native (no pdu added)
        console.table([1, 2, 3]);
        console.dir({ a: 1 });
        assert.strict.equal(inst.ringStack.length, 0);
        done();
      }));
  });

  // ─── Limites CircularBuffer ─────────────────────────────────────────────────

  describe("CircularBuffer — limites", () => {
    it("getLogStack() sur buffer vide → undefined", () =>
      new Promise<void>((done) => {
        const s = new Syslog();
        const res = s.getLogStack() as Pdu | undefined;
        assert.strict.equal(res, undefined);
        done();
      }));

    it("FIFO order après overflow — le plus ancien écrasé", () =>
      new Promise<void>((done) => {
        const s = new Syslog({ maxStack: 3 });
        s.log("a", "INFO");
        s.log("b", "INFO");
        s.log("c", "INFO");
        s.log("d", "INFO"); // écrase "a"
        const stack = s.ringStack;
        assert.strict.equal(stack.length, 3);
        assert.strict.equal(stack[0].payload, "b");
        assert.strict.equal(stack[2].payload, "d");
        done();
      }));

    it("clearLogStack() vide le ring mais garde les listeners", () =>
      new Promise<void>((done) => {
        const s = new Syslog();
        let count = 0;
        s.listenWithConditions(
          { severity: { operator: "<=", data: 7 } },
          () => count++,
        );
        s.log("x", "INFO");
        s.clearLogStack();
        assert.strict.equal(s.ringStack.length, 0);
        s.log("y", "INFO"); // listener toujours actif
        assert.strict.equal(count, 2);
        done();
      }));

    it("reset() vide le ring ET retire tous les listeners", () =>
      new Promise<void>((done) => {
        const s = new Syslog();
        let count = 0;
        s.listenWithConditions(
          { severity: { operator: "<=", data: 7 } },
          () => count++,
        );
        s.log("before reset", "INFO");
        s.reset();
        s.log("after reset", "INFO");
        assert.strict.equal(s.ringStack.length, 1);
        assert.strict.equal(count, 1); // le 2e log n'a pas déclenché le listener
        done();
      }));
  });

  // ─── Rate limiting — edge cases ─────────────────────────────────────────────

  describe("Rate limiting — edge cases", () => {
    it("exactement burstLimit accepted, le suivant DROPPED → missed++", () =>
      new Promise<void>((done) => {
        const s = new Syslog({ rateLimit: 10000, burstLimit: 2 });
        const p1 = s.log("a", "INFO");
        const p2 = s.log("b", "INFO");
        const p3 = s.log("c", "INFO"); // DROPPED
        assert.strict.equal(p1.status, "ACCEPTED");
        assert.strict.equal(p2.status, "ACCEPTED");
        assert.strict.equal(p3.status, "DROPPED");
        assert.strict.equal(s.missed, 1);
        done();
      }));

    it("burstLimit=0 → tous DROPPED", () =>
      new Promise<void>((done) => {
        const s = new Syslog({ rateLimit: 10000, burstLimit: 0 });
        const p = s.log("x", "INFO");
        assert.strict.equal(p.status, "DROPPED");
        assert.strict.equal(s.missed, 1);
        done();
      }));

    it("reset de fenêtre après rateLimit ms — accepte à nouveau", async () => {
      const s = new Syslog({ rateLimit: 30, burstLimit: 1 });
      const p1 = s.log("first", "INFO"); // ACCEPTED
      const p2 = s.log("second", "INFO"); // DROPPED
      assert.strict.equal(p1.status, "ACCEPTED");
      assert.strict.equal(p2.status, "DROPPED");
      await new Promise((r) => setTimeout(r, 50)); // fenêtre expirée
      const p3 = s.log("third", "INFO"); // ACCEPTED après reset
      assert.strict.equal(p3.status, "ACCEPTED");
      assert.strict.equal(s.missed, 0); // reset aussi missed
    });
  });

  // ─── Pdu — payloads limites ──────────────────────────────────────────────────

  describe("Pdu — payloads limites", () => {
    it("payload=0 (falsy number) → ACCEPTED", () =>
      new Promise<void>((done) => {
        const s = new Syslog();
        const p = s.log(0, "INFO");
        assert.strict.equal(p.status, "ACCEPTED");
        assert.strict.equal(p.payload, 0);
        assert.strict.equal(p.typePayload, "number");
        done();
      }));

    it("payload=false (falsy boolean) → ACCEPTED", () =>
      new Promise<void>((done) => {
        const s = new Syslog();
        const p = s.log(false as unknown as string, "INFO");
        assert.strict.equal(p.status, "ACCEPTED");
        assert.strict.equal(p.payload, false);
        done();
      }));

    it("payload=null → ACCEPTED", () =>
      new Promise<void>((done) => {
        const s = new Syslog();
        const p = s.log(null as unknown as string, "INFO");
        assert.strict.equal(p.status, "ACCEPTED");
        assert.strict.equal(p.payload, null);
        done();
      }));

    it("log(existingPdu) → passthrough sans recréation", () =>
      new Promise<void>((done) => {
        const s = new Syslog();
        const pdu = new Pdu("original", "ERROR", "MOD");
        const returned = s.log(pdu);
        assert.strict.equal(returned, pdu); // même objet
        assert.strict.equal(s.ringStack[0], pdu);
        done();
      }));

    it("typePayload: Error", () =>
      new Promise<void>((done) => {
        const s = new Syslog();
        const p = s.log(new Error("boom"), "ERROR");
        assert.strict.equal(p.typePayload, "Error");
        done();
      }));

    it("typePayload: Date → 'date' (fastTypeOf lowercase)", () =>
      new Promise<void>((done) => {
        const s = new Syslog();
        const p = s.log(new Date(), "INFO");
        assert.strict.equal(p.typePayload, "date");
        done();
      }));

    it("typePayload: array", () =>
      new Promise<void>((done) => {
        const s = new Syslog();
        const p = s.log([1, 2, 3] as unknown as string, "INFO");
        assert.strict.equal(p.typePayload, "array");
        done();
      }));
  });

  // ─── logToJson ───────────────────────────────────────────────────────────────

  describe("logToJson", () => {
    it("retourne un JSON valide de tous les PDU", () =>
      new Promise<void>((done) => {
        const s = new Syslog({ maxStack: 5 });
        s.log("a", "INFO");
        s.log("b", "ERROR");
        const json = s.logToJson({ severity: { operator: "<=", data: 7 } });
        const parsed = JSON.parse(json);
        assert.ok(Array.isArray(parsed));
        assert.strict.equal(parsed.length, 2);
        assert.strict.equal(parsed[0].payload, "a");
        assert.strict.equal(parsed[1].payload, "b");
        done();
      }));

    it("filtre par sévérité", () =>
      new Promise<void>((done) => {
        const s = new Syslog({ maxStack: 10 });
        s.log("err", "ERROR");
        s.log("inf", "INFO");
        s.log("dbg", "DEBUG");
        const json = s.logToJson({
          severity: { operator: "<=", data: "ERROR" },
        });
        const parsed = JSON.parse(json);
        assert.strict.equal(parsed.length, 1);
        assert.strict.equal(parsed[0].payload, "err");
        done();
      }));
  });

  // ─── Conditions OR (checkConditions: "||") ───────────────────────────────────

  describe("checkConditions: || (logique OU)", () => {
    it("|| — severity OU msgid — l'un ou l'autre suffit", () =>
      new Promise<void>((done) => {
        const s = new Syslog();
        let count = 0;
        s.listenWithConditions(
          {
            severity: { operator: "==", data: "ERROR" },
            msgid: { data: "SPECIAL" },
            checkConditions: "||",
          },
          () => count++,
        );
        s.log("match severity", "ERROR", "OTHER"); // ERROR → match
        s.log("match msgid", "INFO", "SPECIAL"); // SPECIAL → match
        s.log("no match", "INFO", "OTHER"); // ni ERROR ni SPECIAL → no match
        assert.strict.equal(count, 2);
        done();
      }));

    it("&& (défaut) — les deux conditions requises", () =>
      new Promise<void>((done) => {
        const s = new Syslog();
        let count = 0;
        s.listenWithConditions(
          {
            severity: { operator: "==", data: "ERROR" },
            msgid: { data: "SPECIAL" },
          },
          () => count++,
        );
        s.log("both", "ERROR", "SPECIAL"); // match
        s.log("only sev", "ERROR", "OTHER"); // pas match
        s.log("only msg", "INFO", "SPECIAL"); // pas match
        assert.strict.equal(count, 1);
        done();
      }));
  });

  // ─── loadStack avec JSON string ──────────────────────────────────────────────

  describe("loadStack — JSON string", () => {
    it("accepte une string JSON et charge les PDU", () =>
      new Promise<void>((done) => {
        const source = new Syslog({ maxStack: 5 });
        source.log("first", "INFO");
        source.log("second", "ERROR");
        const json = source.logToJson({
          severity: { operator: "<=", data: 7 },
        });
        const dest = new Syslog({ maxStack: 10 });
        dest.loadStack(json);
        assert.strict.equal(dest.ringStack.length, 2);
        assert.strict.equal(dest.ringStack[0].payload, "first");
        assert.strict.equal(dest.ringStack[1].payload, "second");
        done();
      }));
  });

  // ─── HttpTransport — timeout ─────────────────────────────────────────────────

  describe("HttpTransport — timeout", () => {
    it("send() rejette si le serveur ne répond pas dans le délai", async () => {
      // Serveur qui ne répond jamais
      const server = http.createServer((_req, _res) => {
        /* silence */
      });
      const addr = await listen(server);
      const t = new HttpTransport({
        url: `http://127.0.0.1:${addr.port}`,
        timeout: 50,
      });
      const pdu = new Pdu("timeout test", "INFO", "X");
      pdu.status = "ACCEPTED";
      try {
        await assert.rejects(() => t.send(pdu), /timeout/);
      } finally {
        server.close();
      }
    });
  });
});

describe("Syslog — compteurs erreurs (sonde par worker)", () => {
  it("errorTotal/criticTotal bump sur ERROR..EMERGENCY, ignore INFO", () => {
    const s = new Syslog({ moduleName: "TEST", rateLimit: false });
    assert.strictEqual(s.errorTotal, 0);
    assert.strictEqual(s.criticTotal, 0);
    s.log("info", "INFO"); // 6 → aucun
    s.log("notice", "NOTICE"); // 5 → aucun
    s.log("warn", "WARNING"); // 4 → aucun (warning n'est PAS error)
    s.log("err", "ERROR"); // 3 → error
    s.log("crit", "CRITIC"); // 2 → error + critic
    s.log("alert", "ALERT"); // 1 → error + critic
    s.log("emerg", "EMERGENCY"); // 0 → error + critic
    assert.strictEqual(s.errorTotal, 4, "ERROR+CRITIC+ALERT+EMERGENCY");
    assert.strictEqual(s.criticTotal, 3, "CRITIC+ALERT+EMERGENCY");
    s.clean();
  });

  it("compteurs monotones (cumulent sur plusieurs logs)", () => {
    const s = new Syslog({ moduleName: "TEST", rateLimit: false });
    for (let i = 0; i < 5; i++) s.log("boom", "ERROR");
    assert.strictEqual(s.errorTotal, 5);
    assert.strictEqual(s.criticTotal, 0);
    s.clean();
  });
});

// ─── Pdu.requestId — corrélation log↔requête via ALS (gap comblé 2026-05-27) ───
// Le `pid` du Pdu identifie le worker (procid RFC 5424). Le `requestId` ajouté
// identifie LA requête : combiné au `pid`, on peut tracer une requête à travers
// TOUS ses logs (debug + base future de l'observabilité IA).
// Provider injectable (isomorphisme) : branché par `src/index.ts` côté Node sur
// `RequestContext.getRequestId`, reste `null` côté browser (bundle client).
describe("Pdu.requestId — corrélation log↔requête (ALS)", () => {
  // Le branchement Node a déjà eu lieu à l'import du barrel (Syslog/Pdu sont
  // ré-exportés depuis `src/index.ts`). On capture la valeur pour restaurer
  // après les tests qui la mutent.
  let originalProvider: (() => string | undefined) | null;

  beforeAll(() => {
    originalProvider = Pdu.requestIdProvider;
    // Forcer le provider Node attendu pour les tests qui suivent (au cas où
    // l'ordre d'évaluation des fichiers de test laisserait Pdu.requestIdProvider
    // à null — ex : tests qui chargent Pdu directement sans passer par le barrel).
    Pdu.requestIdProvider = () => RequestContext.getRequestId();
  });

  afterAll(() => {
    Pdu.requestIdProvider = originalProvider;
  });

  it("hors bulle ALS → requestId undefined", () => {
    const pdu = new Pdu("test hors bulle", "INFO");
    assert.strictEqual(pdu.requestId, undefined);
  });

  it("dans bulle ALS → requestId capturé (= RequestContext.getRequestId())", () => {
    RequestContext.run({ requestId: "req-pdu-test-1" }, () => {
      const pdu = new Pdu("test dans bulle", "INFO");
      assert.strictEqual(pdu.requestId, "req-pdu-test-1");
      assert.strictEqual(pdu.requestId, RequestContext.getRequestId());
    });
  });

  it("provider null (mode browser émulé) → ne lit jamais l'ALS", () => {
    Pdu.requestIdProvider = null; // simule le bundle client (pas de branchement)
    let calls = 0;
    // Provider espion installé APRÈS le null pour mesurer que le ctor ne le
    // déclenche pas — il ne devrait JAMAIS être appelé puisque le test de
    // référence dans le ctor (`if (Pdu.requestIdProvider !== null)`) court-circuite.
    // (En vrai mode browser, le provider reste tout simplement null tout du long.)
    RequestContext.run({ requestId: "req-not-read" }, () => {
      const pdu = new Pdu("test browser", "INFO");
      assert.strictEqual(pdu.requestId, undefined);
      assert.strictEqual(calls, 0);
    });
    // Restaurer pour les tests suivants.
    Pdu.requestIdProvider = () => RequestContext.getRequestId();
  });

  it("requestId est dans JSON.stringify quand présent", () => {
    RequestContext.run({ requestId: "req-json-present" }, () => {
      const pdu = new Pdu("payload", "INFO");
      const json = JSON.parse(JSON.stringify(pdu));
      assert.strictEqual(json.requestId, "req-json-present");
    });
  });

  it("requestId est ABSENT du JSON quand pas dans bulle (champ non-défini)", () => {
    const pdu = new Pdu("payload sans bulle", "INFO");
    const json = JSON.parse(JSON.stringify(pdu));
    assert.strictEqual(
      "requestId" in json,
      false,
      "champ non-défini sur l'instance ne doit PAS apparaître dans le JSON",
    );
  });

  it("provider qui retourne string → mappé tel quel sur requestId", () => {
    Pdu.requestIdProvider = () => "static-fake-id";
    const pdu = new Pdu("x", "INFO");
    assert.strictEqual(pdu.requestId, "static-fake-id");
    // Restaurer.
    Pdu.requestIdProvider = () => RequestContext.getRequestId();
  });

  it("parseJson réhydrate aussi le requestId (debugbar/Studio cross-process)", () => {
    // Pdu est isomorphe : côté browser, on réhydrate un Pdu depuis le JSON
    // serveur via `parseJson`. Le requestId doit voyager.
    const pdu = new Pdu("payload", "INFO");
    pdu.parseJson(
      JSON.stringify({
        payload: "rehydrated",
        severity: 6,
        severityName: "INFO",
        moduleName: "X",
        msgid: "Y",
        msg: "",
        pid: 1234,
        requestId: "req-rehydrated",
        timeStamp: Date.now(),
        uid: 99,
        typePayload: "string",
        status: "ACCEPTED",
      }),
    );
    assert.strictEqual(pdu.requestId, "req-rehydrated");
  });
});

// T2 (profil delta vs Express) — gate d'ENTRÉE par sévérité. Contrat : sous le
// seuil → AUCUN Pdu créé ni poussé au ring ; au-dessus (plus grave) → inchangé ;
// re-résoluble à chaud (audit à chaud). Le seuil est posé par le KERNEL au boot
// (composition root, env réel) — PAS par init() (appelé tôt avec un défaut
// "production" pollué) : init() ne gate jamais.
describe("SYSLOG — severity entry gate (T2)", () => {
  it("défaut (sans seuil) → tout passe, comportement historique", () => {
    const sl = new Syslog({ moduleName: "T2" });
    sl.init("production");
    assert.strictEqual(sl.log("dbg", "DEBUG").status, "ACCEPTED");
    assert.strictEqual(sl.gated, 0);
  });

  it("seuil INFO → DEBUG gaté (rien au ring), INFO/ERROR passent", () => {
    const sl = new Syslog({ moduleName: "T2" });
    sl.setSeverityThreshold("INFO");
    const before = sl.ringStack.length;
    const dropped = sl.log("invisible", "DEBUG");
    assert.strictEqual(dropped.status, "DROPPED");
    assert.strictEqual(
      sl.ringStack.length,
      before,
      "DEBUG ne pousse rien au ring",
    );
    assert.strictEqual(sl.gated, 1);
    const kept = sl.log("visible", "INFO");
    assert.strictEqual(kept.status, "ACCEPTED");
    assert.strictEqual(sl.ringStack.length, before + 1);
    assert.strictEqual(sl.log("boom", "ERROR").status, "ACCEPTED");
  });

  it("init() ne pose JAMAIS de gate (même env production)", () => {
    const sl = new Syslog({ moduleName: "T2" });
    sl.init("production", false);
    assert.strictEqual(sl.log("dbg", "DEBUG").status, "ACCEPTED");
    assert.strictEqual(sl.gated, 0);
  });

  it("setSeverityThreshold à chaud — élever puis restaurer (audit à chaud)", () => {
    const sl = new Syslog({ moduleName: "T2" });
    sl.setSeverityThreshold("INFO");
    assert.strictEqual(sl.log("d1", "DEBUG").status, "DROPPED");
    sl.setSeverityThreshold("DEBUG"); // fenêtre d'audit : tout passe
    assert.strictEqual(sl.log("d2", "DEBUG").status, "ACCEPTED");
    sl.setSeverityThreshold("INFO"); // restauration prod
    assert.strictEqual(sl.log("d3", "DEBUG").status, "DROPPED");
    sl.setSeverityThreshold(null); // gate levé (historique)
    assert.strictEqual(sl.log("d4", "DEBUG").status, "ACCEPTED");
  });

  it("severityEnabled — guide les call sites AVANT de formater (pattern L1)", () => {
    const sl = new Syslog({ moduleName: "T2" });
    sl.setSeverityThreshold("INFO");
    assert.strictEqual(sl.severityEnabled("DEBUG"), false);
    assert.strictEqual(sl.severityEnabled("INFO"), true);
    assert.strictEqual(sl.severityEnabled("ERROR"), true);
    sl.setSeverityThreshold(null);
    assert.strictEqual(sl.severityEnabled("DEBUG"), true);
  });

  it("Pdu pré-construit gaté par sa propre sévérité", () => {
    const sl = new Syslog({ moduleName: "T2" });
    sl.setSeverityThreshold("INFO");
    const debugPdu = new Pdu("pre-built", "DEBUG", "T2", "", "");
    assert.strictEqual(sl.log(debugPdu).status, "DROPPED");
    const infoPdu = new Pdu("pre-built", "INFO", "T2", "", "");
    assert.strictEqual(sl.log(infoPdu).status, "ACCEPTED");
  });

  it("une sévérité INCONNUE (-1) passe le gate — c'est `createPDU` qui refuse", () => {
    // Le gate ne doit pas transformer une erreur d'usage en silence : il laisse
    // passer, et la création du Pdu lève. Sans quoi une sévérité mal écrite
    // disparaîtrait sans un mot, ce qui est le pire des deux comportements.
    const sl = new Syslog({ moduleName: "T2" });
    sl.setSeverityThreshold("INFO");
    assert.strictEqual(sl.severityEnabled(-1), true);
  });

  it("sévérité par défaut (DEBUG) gâtée sous seuil INFO — log() sans sévérité", () => {
    const sl = new Syslog({ moduleName: "T2" });
    sl.setSeverityThreshold("INFO");
    // defaultSeverity = "DEBUG" → un log() nu est sous le seuil
    assert.strictEqual(sl.log("nu").status, "DROPPED");
  });
});

// Debug runtime PAR MODULE (allumable à chaud) — élève le seuil d'UN module
// (clé = msgid, = nom du Service émetteur par défaut) sous le gate global, sans
// reboot, avec auto-extinction TTL. Construit AU-DESSUS du gate T2.
describe("SYSLOG — per-module debug override (runtime, hot)", () => {
  it("rallume DEBUG d'UN module sous gate prod, les autres restent gatés", () => {
    const sl = new Syslog({ moduleName: "T2" });
    sl.setSeverityThreshold("INFO"); // gate global = prod
    assert.strictEqual(sl.log("d", "DEBUG", "FIREWALL").status, "DROPPED");
    sl.setDebugOverride("FIREWALL", "DEBUG");
    assert.strictEqual(
      sl.log("d", "DEBUG", "FIREWALL").status,
      "ACCEPTED",
      "le module ciblé passe en DEBUG",
    );
    assert.strictEqual(
      sl.log("d", "DEBUG", "ROUTER").status,
      "DROPPED",
      "un autre module n'est PAS affecté",
    );
    assert.strictEqual(
      sl.log("i", "INFO", "ROUTER").status,
      "ACCEPTED",
      "le seuil global INFO reste valable ailleurs",
    );
  });

  it("clearDebugOverride referme le module + idempotent", () => {
    const sl = new Syslog({ moduleName: "T2" });
    sl.setSeverityThreshold("INFO");
    sl.setDebugOverride("FIREWALL", "DEBUG");
    assert.strictEqual(sl.log("d", "DEBUG", "FIREWALL").status, "ACCEPTED");
    assert.strictEqual(sl.clearDebugOverride("FIREWALL"), true);
    assert.strictEqual(
      sl.log("d", "DEBUG", "FIREWALL").status,
      "DROPPED",
      "retour au seuil global après clear",
    );
    assert.strictEqual(
      sl.clearDebugOverride("FIREWALL"),
      false,
      "clear sur un module absent = false",
    );
  });

  it("override pré-Pdu : la clé suit le msgid du Pdu construit", () => {
    const sl = new Syslog({ moduleName: "T2" });
    sl.setSeverityThreshold("INFO");
    sl.setDebugOverride("SESSION", "DEBUG");
    const pdu = new Pdu("pre-built", "DEBUG", "T2", "SESSION", "");
    assert.strictEqual(sl.log(pdu).status, "ACCEPTED");
    const other = new Pdu("pre-built", "DEBUG", "T2", "ROUTER", "");
    assert.strictEqual(sl.log(other).status, "DROPPED");
  });

  it("getDebugOverrides — snapshot puis retour à {} (lazy null = 0 coût)", () => {
    const sl = new Syslog({ moduleName: "T2" });
    assert.deepStrictEqual(sl.getDebugOverrides(), {});
    sl.setDebugOverride("FIREWALL", "DEBUG"); // DEBUG = 7
    sl.setDebugOverride("SESSION", 7);
    assert.deepStrictEqual(sl.getDebugOverrides(), {
      FIREWALL: 7,
      SESSION: 7,
    });
    sl.clearAllDebugOverrides();
    assert.deepStrictEqual(sl.getDebugOverrides(), {});
  });

  it("auto-extinction TTL — l'override s'éteint seul après le délai", () => {
    vi.useFakeTimers();
    try {
      const sl = new Syslog({ moduleName: "T2" });
      sl.setSeverityThreshold("INFO");
      sl.setDebugOverride("FIREWALL", "DEBUG", 60_000);
      assert.strictEqual(sl.log("d", "DEBUG", "FIREWALL").status, "ACCEPTED");
      vi.advanceTimersByTime(60_001);
      assert.strictEqual(
        sl.log("d", "DEBUG", "FIREWALL").status,
        "DROPPED",
        "le debug ciblé s'est auto-éteint",
      );
      assert.deepStrictEqual(sl.getDebugOverrides(), {});
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-poser un module ré-arme le timer (pas d'extinction prématurée)", () => {
    vi.useFakeTimers();
    try {
      const sl = new Syslog({ moduleName: "T2" });
      sl.setSeverityThreshold("INFO");
      sl.setDebugOverride("FIREWALL", "DEBUG", 60_000);
      vi.advanceTimersByTime(50_000);
      sl.setDebugOverride("FIREWALL", "DEBUG", 60_000); // ré-arme à 0
      vi.advanceTimersByTime(50_000); // 100s cumulés, mais 50s depuis le re-pose
      assert.strictEqual(
        sl.log("d", "DEBUG", "FIREWALL").status,
        "ACCEPTED",
        "toujours actif car le timer a été ré-armé",
      );
      vi.advanceTimersByTime(11_000); // dépasse le 2e délai
      assert.strictEqual(sl.log("d", "DEBUG", "FIREWALL").status, "DROPPED");
    } finally {
      vi.useRealTimers();
    }
  });

  it("sans gate global (dev) l'override est sans effet — tout passe déjà", () => {
    const sl = new Syslog({ moduleName: "T2" }); // pas de setSeverityThreshold → null
    sl.setDebugOverride("FIREWALL", "INFO");
    assert.strictEqual(
      sl.log("d", "DEBUG", "FIREWALL").status,
      "ACCEPTED",
      "aucun gate d'entrée → l'override ne restreint rien",
    );
  });

  it("reset() purge les overrides et leurs timers", () => {
    vi.useFakeTimers();
    try {
      const sl = new Syslog({ moduleName: "T2" });
      sl.setSeverityThreshold("INFO");
      sl.setDebugOverride("FIREWALL", "DEBUG", 60_000);
      sl.reset();
      assert.deepStrictEqual(sl.getDebugOverrides(), {});
      // setSeverityThreshold reposé après reset (reset ne touche pas le gate global)
      sl.setSeverityThreshold("INFO");
      assert.strictEqual(
        sl.log("d", "DEBUG", "FIREWALL").status,
        "DROPPED",
        "override bien retiré par reset",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  // Blanc-box ASSUMÉ : prouve la revendication perf « lazy null = 0 coût hot
  // path » (le gate teste `_debugOverrides !== null`). Une Map vide non-nulle
  // ferait payer le hot path pour rien — un test fonctionnel ne l'attraperait
  // pas. On accède au privé exprès pour verrouiller cet invariant.
  it("lazy null — null au repos, Map au 1er override, re-null après dernier clear", () => {
    const sl = new Syslog({ moduleName: "T2" });
    const internal = sl as unknown as {
      _debugOverrides: unknown;
      _debugOverrideTimers: unknown;
    };
    assert.strictEqual(internal._debugOverrides, null, "null au départ");
    assert.strictEqual(internal._debugOverrideTimers, null);
    sl.setDebugOverride("FIREWALL", "DEBUG"); // sans ttl → aucun timer
    assert.notStrictEqual(
      internal._debugOverrides,
      null,
      "Map allouée au 1er override",
    );
    assert.strictEqual(
      internal._debugOverrideTimers,
      null,
      "pas de Map de timers sans ttl",
    );
    sl.clearDebugOverride("FIREWALL");
    assert.strictEqual(
      internal._debugOverrides,
      null,
      "re-null après le dernier clear (0 coût hot path restauré)",
    );
  });

  it("lazy null — la Map de timers retombe à null après auto-extinction", () => {
    vi.useFakeTimers();
    try {
      const sl = new Syslog({ moduleName: "T2" });
      const internal = sl as unknown as {
        _debugOverrides: unknown;
        _debugOverrideTimers: unknown;
      };
      sl.setDebugOverride("FIREWALL", "DEBUG", 60_000);
      assert.notStrictEqual(internal._debugOverrideTimers, null);
      vi.advanceTimersByTime(60_001);
      assert.strictEqual(
        internal._debugOverrideTimers,
        null,
        "timer purgé après extinction",
      );
      assert.strictEqual(internal._debugOverrides, null, "override purgé");
    } finally {
      vi.useRealTimers();
    }
  });

  it("override = seuil ABSOLU du module (peut RESTREINDRE, pas que rallumer)", () => {
    const sl = new Syslog({ moduleName: "T2" });
    sl.setSeverityThreshold("INFO"); // global : <= INFO(6) passe
    // Override plus restrictif : ce module bruyant ne passe qu'à WARNING(4)+.
    sl.setDebugOverride("NOISY", "WARNING");
    assert.strictEqual(
      sl.log("i", "INFO", "NOISY").status,
      "DROPPED",
      "INFO restreint POUR CE module (override absolu, pas un max)",
    );
    assert.strictEqual(sl.log("w", "WARNING", "NOISY").status, "ACCEPTED");
    assert.strictEqual(
      sl.log("i", "INFO", "OTHER").status,
      "ACCEPTED",
      "les autres modules gardent le seuil global",
    );
  });

  it("compteur gated — non incrémenté quand l'override laisse passer", () => {
    const sl = new Syslog({ moduleName: "T2" });
    sl.setSeverityThreshold("INFO");
    sl.log("d", "DEBUG", "FIREWALL"); // gaté
    assert.strictEqual(sl.gated, 1);
    sl.setDebugOverride("FIREWALL", "DEBUG");
    sl.log("d", "DEBUG", "FIREWALL"); // passe via override
    assert.strictEqual(
      sl.gated,
      1,
      "un log passé par override n'incrémente pas gated",
    );
    sl.log("d", "DEBUG", "ROUTER"); // autre module → toujours gaté
    assert.strictEqual(sl.gated, 2);
  });

  it("multi-override — extinction TTL sélective (un s'éteint, l'autre reste)", () => {
    vi.useFakeTimers();
    try {
      const sl = new Syslog({ moduleName: "T2" });
      sl.setSeverityThreshold("INFO");
      sl.setDebugOverride("FIREWALL", "DEBUG", 30_000);
      sl.setDebugOverride("SESSION", "DEBUG", 90_000);
      vi.advanceTimersByTime(31_000); // FIREWALL expiré, SESSION encore actif
      assert.strictEqual(sl.log("d", "DEBUG", "FIREWALL").status, "DROPPED");
      assert.strictEqual(sl.log("d", "DEBUG", "SESSION").status, "ACCEPTED");
      assert.deepStrictEqual(sl.getDebugOverrides(), { SESSION: 7 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("parseDebugSpec — modules simples (DEBUG par défaut)", () => {
    assert.deepStrictEqual(Syslog.parseDebugSpec("FIREWALL,SESSION"), {
      global: false,
      overrides: [
        { module: "FIREWALL", level: 7 },
        { module: "SESSION", level: 7 },
      ],
    });
  });

  it("parseDebugSpec — séparateurs virgule/espace mêlés + vides ignorés", () => {
    assert.deepStrictEqual(Syslog.parseDebugSpec(" FIREWALL ,, SESSION "), {
      global: false,
      overrides: [
        { module: "FIREWALL", level: 7 },
        { module: "SESSION", level: 7 },
      ],
    });
  });

  it("parseDebugSpec — '*' = debug global, pas d'override", () => {
    const r = Syslog.parseDebugSpec("*");
    assert.strictEqual(r.global, true);
    assert.deepStrictEqual(r.overrides, []);
  });

  it("parseDebugSpec — MODULE:LEVEL par NOM et par NUMÉRIQUE", () => {
    // NOTICE = 5 ; "3" (chaîne numérique) doit être coercée en ERROR(3)
    assert.deepStrictEqual(Syslog.parseDebugSpec("ROUTER:NOTICE,API:3"), {
      global: false,
      overrides: [
        { module: "ROUTER", level: 5 },
        { module: "API", level: 3 },
      ],
    });
  });

  it("parseDebugSpec — niveau inconnu → DEBUG (tolérant, pas de crash boot)", () => {
    assert.deepStrictEqual(Syslog.parseDebugSpec("X:bogus"), {
      global: false,
      overrides: [{ module: "X", level: 7 }],
    });
  });

  it("parseDebugSpec — vide → rien", () => {
    assert.deepStrictEqual(Syslog.parseDebugSpec(""), {
      global: false,
      overrides: [],
    });
  });

  it("severityFromInput — noms valides → numéro RFC 5424", () => {
    assert.strictEqual(Syslog.severityFromInput("DEBUG"), 7);
    assert.strictEqual(Syslog.severityFromInput("INFO"), 6);
    assert.strictEqual(Syslog.severityFromInput("ERROR"), 3);
  });

  it("severityFromInput — numérique (number ET chaîne) dans 0-7", () => {
    assert.strictEqual(Syslog.severityFromInput(7), 7);
    assert.strictEqual(Syslog.severityFromInput("3"), 3);
    assert.strictEqual(Syslog.severityFromInput(0), 0);
  });

  it("severityFromInput — REJETTE l'invalide → null (pas de fail-open)", () => {
    assert.strictEqual(Syslog.severityFromInput("NOPE"), null);
    assert.strictEqual(Syslog.severityFromInput(8), null, "hors plage haute");
    assert.strictEqual(
      Syslog.severityFromInput(-1),
      null,
      "hors échelle basse : -1 n'est pas un niveau",
    );
    assert.strictEqual(Syslog.severityFromInput("99"), null);
  });

  it("getDebugOverrideExpiry — échéance posée avec ttl, absente sans ttl, nettoyée au clear", () => {
    vi.useFakeTimers();
    try {
      const sl = new Syslog({ moduleName: "T2" });
      sl.setDebugOverride("A", "DEBUG", 60_000);
      sl.setDebugOverride("B", "DEBUG"); // permanent (sans ttl)
      const exp = sl.getDebugOverrideExpiry();
      assert.ok(exp.A > 0, "A (ttl) a une échéance");
      assert.strictEqual(exp.B, undefined, "B (permanent) sans échéance");
      sl.clearDebugOverride("A");
      assert.deepStrictEqual(
        sl.getDebugOverrideExpiry(),
        {},
        "échéance nettoyée au clear",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("getDebugOverrideExpiry — re-pose PERMANENTE retire l'échéance antérieure", () => {
    vi.useFakeTimers();
    try {
      const sl = new Syslog({ moduleName: "T2" });
      sl.setDebugOverride("A", "DEBUG", 60_000);
      assert.ok(sl.getDebugOverrideExpiry().A > 0);
      sl.setDebugOverride("A", "DEBUG"); // re-pose SANS ttl → redevient permanent
      assert.strictEqual(sl.getDebugOverrideExpiry().A, undefined);
    } finally {
      vi.useRealTimers();
    }
  });

  it("override '*' (debug tout) — s'applique à TOUT module, le spécifique prime", () => {
    const sl = new Syslog({ moduleName: "T2" });
    sl.setSeverityThreshold("INFO");
    assert.strictEqual(sl.log("d", "DEBUG", "ANY").status, "DROPPED");
    // '*' → DEBUG passe pour N'IMPORTE quel module
    sl.setDebugOverride("*", "DEBUG");
    assert.strictEqual(sl.log("d", "DEBUG", "ANY").status, "ACCEPTED");
    assert.strictEqual(sl.log("d", "DEBUG", "OTHER").status, "ACCEPTED");
    // un override SPÉCIFIQUE prime sur '*' (ici plus restrictif)
    sl.setDebugOverride("NOISY", "WARNING");
    assert.strictEqual(
      sl.log("i", "INFO", "NOISY").status,
      "DROPPED",
      "le spécifique prime sur *",
    );
    assert.strictEqual(sl.log("w", "WARNING", "NOISY").status, "ACCEPTED");
    // les autres modules suivent toujours '*'
    assert.strictEqual(sl.log("d", "DEBUG", "ANY").status, "ACCEPTED");
  });
});

describe("SEVERITY_NAMES — le vocabulaire des sévérités", () => {
  it("l'INDEX est la valeur RFC 5424 de la sévérité", () => {
    // Gate anti-divergence : la liste et l'enum sont deux écritures de la même
    // chose. Sans lui, insérer un niveau décalerait tout l'affichage indexé
    // (« ERROR » rendu pour un WARNING) sans qu'aucun test ne bronche.
    SEVERITY_NAMES.forEach((name, index) => {
      const pdu = new Pdu("x", name);
      expect(pdu.severity, `${name} doit valoir ${index}`).to.equal(index);
      expect(pdu.severityName).to.equal(name);
    });
  });

  it("couvre TOUTE l'échelle 0→7, et rien d'autre", () => {
    expect(SEVERITY_NAMES.length).to.equal(8);
    // Garde de non-retour : l'extension `SPINNER` a été retirée du cœur, les
    // indicateurs d'attente vivant dans `cli/progress.ts`. Qu'elle ne
    // revienne pas par une table.
    expect(SEVERITY_NAMES).to.not.include("SPINNER");
    // `CRITIC`, jamais `CRITICAL` — le nom de l'enum fait foi.
    expect(SEVERITY_NAMES[2]).to.equal("CRITIC");
  });
});
