import assert from "node:assert";
import Service, { EventListener } from "../Service";
import Container from "../Container";
import Event from "../Event";
import Syslog from "../syslog/Syslog";
import Pdu, {
  type Pci,
  type Severity,
  type Msgid,
  type Message,
} from "../syslog/Pdu";
import type { EnvironmentType } from "../types/globals";
import type { IKernel } from "../types/IKernel";

// ─── Helpers ─────────────────────────────────────────────────────────────────

class MyService extends Service {
  extra = "extra";
}

function makeKernel(container: Container): IKernel {
  return { container } as unknown as IKernel;
}

// ─── Construction ─────────────────────────────────────────────────────────────

describe("Service — construction", () => {
  it("crée un service avec nom seulement", () => {
    const s = new Service("test");
    assert(s instanceof Service);
    assert.strictEqual(s.name, "test");
    assert(s.container instanceof Container);
    assert(s.syslog instanceof Syslog);
    assert(s.notificationsCenter instanceof Event);
    assert.strictEqual(s.kernel, null);
  });

  it("accepte un container existant", () => {
    const container = new Container();
    const s = new Service("withContainer", container);
    assert.strictEqual(s.container, container);
  });

  it("notificationsCenter=false désactive les events", () => {
    const s = new Service("noEvents", undefined, false);
    assert.strictEqual(s.notificationsCenter, undefined);
  });

  it("null traité comme absent → crée un nouveau Event", () => {
    const s = new Service("nullNC", undefined, null as unknown as undefined);
    assert(s.notificationsCenter instanceof Event);
  });

  it("partage un Event existant", () => {
    const shared = new Event();
    const s = new Service("sharedEvent", undefined, shared);
    assert.strictEqual(s.notificationsCenter, shared);
  });

  it("getName() retourne le nom", () => {
    const s = new Service("myService");
    assert.strictEqual(s.getName(), "myService");
  });

  it("réutilise le syslog existant du container", () => {
    const container = new Container();
    const syslog = new Syslog({ moduleName: "existing" });
    container.set("syslog", syslog);
    const s = new Service("reusesSyslog", container);
    assert.strictEqual(s.syslog, syslog);
  });

  it("récupère le kernel depuis le container", () => {
    const container = new Container();
    const kernel = makeKernel(container);
    container.set("kernel", kernel);
    const s = new Service("withKernel", container);
    assert.strictEqual(s.kernel, kernel);
  });

  it("options.events.nbListeners propagé quand Event partagé", () => {
    const shared = new Event();
    const s = new Service("nbListeners", undefined, shared, {
      events: { nbListeners: 50 },
    });
    assert.strictEqual(s.notificationsCenter?.getMaxListeners(), 50);
  });

  it("Event auto-créé : options.events.nbListeners propagé", () => {
    const s = new Service("nbDefault", undefined, undefined, {
      events: { nbListeners: 50 },
    });
    assert.strictEqual(s.notificationsCenter?.getMaxListeners(), 50);
  });

  it("options.events supprimé après construction", () => {
    const s = new Service("noEventsOpt", undefined, undefined, {
      events: { nbListeners: 10 },
    });
    assert.strictEqual(
      (s.options as Record<string, unknown>).events,
      undefined,
    );
  });

  it("notificationsCenter=false → options non fusionnées avec defaultOptions", () => {
    const s = new Service("falseNC", undefined, false, { foo: "bar" } as Record<
      string,
      unknown
    >);
    assert.strictEqual(s.notificationsCenter, undefined);
    assert.strictEqual((s.options as Record<string, unknown>).foo, "bar");
  });

  it("notificationsCenter enregistré dans container si pas de kernel", () => {
    const container = new Container();
    const s = new Service("noKernel", container);
    const nc = container.get<Event>("notificationsCenter");
    assert.strictEqual(nc, s.notificationsCenter);
  });

  it("notificationsCenter n'est PAS mis dans container si kernel présent", () => {
    const container = new Container();
    const kernel = makeKernel(container);
    container.set("kernel", kernel);
    new Service("withKernelNC", container);
    assert.strictEqual(container.get("notificationsCenter"), null);
  });

  it("options.syslog transmis au Syslog interne", () => {
    const s = new Service("syslogOpts", undefined, undefined, {
      syslog: { moduleName: "CUSTOM", defaultSeverity: "DEBUG" },
    });
    assert.strictEqual(s.syslog?.settings.moduleName, "CUSTOM");
  });
});

// ─── Container delegation ─────────────────────────────────────────────────────

describe("Service — container delegation", () => {
  let service: Service;

  beforeEach(() => {
    service = new Service("container-test");
  });

  it("set/get un objet dans le container", () => {
    const obj = { value: 42 };
    service.set("myObj", obj);
    assert.strictEqual(service.get<typeof obj>("myObj"), obj);
  });

  it("get() typé generiquement", () => {
    service.set("num", 99);
    const val = service.get<number>("num");
    assert.strictEqual(val, 99);
  });

  it("has() retourne true si présent", () => {
    service.set("key", "value");
    assert.strictEqual(service.has("key"), true);
  });

  it("has() retourne false si absent", () => {
    assert.strictEqual(service.has("inexistant"), false);
  });

  it("remove() supprime un service simple", () => {
    service.set("toRemove", { x: 1 });
    service.remove("toRemove");
    assert.strictEqual(service.has("toRemove"), false);
  });

  it("remove() retourne true si élément trouvé et supprimé", () => {
    service.set("key", { v: 1 });
    assert.strictEqual(service.remove("key"), true);
  });

  it("remove() retourne false si clé absente", () => {
    assert.strictEqual(service.remove("absent"), false);
  });

  it("remove() appelle clean() sur un Service enfant", () => {
    const child = new Service("child", service.container ?? undefined);
    service.set("child", child);
    service.remove("child");
    assert.strictEqual(child.container, null);
  });

  it("remove() fonctionne avec sous-classe de Service", () => {
    const child = new MyService("myChild", service.container ?? undefined);
    service.set("myChild", child);
    service.remove("myChild");
    assert.strictEqual(child.container, null);
  });

  it("remove() après clean → ne throw pas", () => {
    service.clean();
    assert.doesNotThrow(() => service.remove("anything"));
  });

  it("get() retourne null si container null", () => {
    service.clean();
    assert.strictEqual(service.get("anything"), null);
  });

  it("set() throw si container null", () => {
    service.clean();
    assert.throws(
      () => service.set("key", "value"),
      /container not initialized/,
    );
  });

  it("has() retourne false si container null", () => {
    service.clean();
    assert.strictEqual(service.has("anything"), false);
  });

  it("setParameters/getParameters", () => {
    service.setParameters("app.name", "nodefony");
    const result = service.getParameters("app.name");
    assert.strictEqual(result, "nodefony");
  });

  it("setParameters imbriqués (dot notation)", () => {
    service.setParameters("app.config.debug", true);
    assert.strictEqual(service.getParameters("app.config.debug"), true);
  });

  it("getParameters retourne null si absent", () => {
    assert.strictEqual(service.getParameters("unknown.key"), null);
  });

  it("getParameters() retourne null si container null", () => {
    service.clean();
    assert.strictEqual(service.getParameters("anything"), null);
  });

  it("setParameters() throw si container null", () => {
    service.clean();
    assert.throws(
      () => service.setParameters("key", "val"),
      /container not initialized/,
    );
  });
});

// ─── Events ───────────────────────────────────────────────────────────────────

describe("Service — events", () => {
  let service: Service;

  beforeEach(() => {
    service = new Service("event-test");
  });

  it("on/emit fonctionne", () =>
    new Promise<void>((done) => {
      service.on("test", (data: string) => {
        assert.strictEqual(data, "hello");
        done();
      });
      service.emit("test", "hello");
    }));

  it("fire() émet un event", () =>
    new Promise<void>((done) => {
      service.on("ping", () => done());
      service.fire("ping");
    }));

  it("emitAsync() retourne une Promise (alias fireAsync)", async () => {
    let resolved: string | undefined;
    service.on("async2", async (v: string) => {
      resolved = v;
    });
    await service.emitAsync("async2", "done");
    assert.strictEqual(resolved, "done");
  });

  it("fireAsync() retourne une Promise", async () => {
    let resolved: string | undefined;
    service.on("async", async (v: string) => {
      resolved = v;
    });
    await service.fireAsync("async", "done");
    assert.strictEqual(resolved, "done");
  });

  it("once() ne reçoit qu'une fois", () => {
    let count = 0;
    service.once("single", () => {
      count++;
    });
    service.emit("single");
    service.emit("single");
    assert.strictEqual(count, 1);
  });

  it("off() supprime un listener", () => {
    let count = 0;
    const listener: EventListener = () => {
      count++;
    };
    service.on("toggled", listener);
    service.emit("toggled");
    service.off("toggled", listener);
    service.emit("toggled");
    assert.strictEqual(count, 1);
  });

  it("addListener() enregistre un listener", () => {
    let called = false;
    service.addListener("addTest", () => {
      called = true;
    });
    service.emit("addTest");
    assert.strictEqual(called, true);
  });

  it("removeListener() supprime un listener", () => {
    let count = 0;
    const fn: EventListener = () => {
      count++;
    };
    service.addListener("rmTest", fn);
    service.emit("rmTest");
    service.removeListener("rmTest", fn);
    service.emit("rmTest");
    assert.strictEqual(count, 1);
  });

  it("removeAllListeners() sans argument vide tous les events", () => {
    service.on("a", () => {});
    service.on("b", () => {});
    service.removeAllListeners();
    assert.deepStrictEqual(service.eventNames(), []);
  });

  it("removeAllListeners() avec argument vide seulement cet event", () => {
    service.on("a", () => {});
    service.on("b", () => {});
    service.removeAllListeners("a");
    const names = service.eventNames();
    assert(!names.includes("a"));
    assert(names.includes("b"));
  });

  it("prependListener() exécuté avant on()", () => {
    const order: string[] = [];
    service.on("order", () => {
      order.push("second");
    });
    service.prependListener("order", () => {
      order.push("first");
    });
    service.emit("order");
    assert.deepStrictEqual(order, ["first", "second"]);
  });

  it("prependOnceListener() exécuté en premier et une seule fois", () => {
    const order: string[] = [];
    service.on("orderOnce", () => {
      order.push("regular");
    });
    service.prependOnceListener("orderOnce", () => {
      order.push("prepend-once");
    });
    service.emit("orderOnce");
    service.emit("orderOnce");
    assert.deepStrictEqual(order, ["prepend-once", "regular", "regular"]);
  });

  it("setMaxListeners / getMaxListeners", () => {
    service.setMaxListeners(99);
    assert.strictEqual(service.getMaxListeners(), 99);
  });

  it("listenerCount()", () => {
    service.on("multi", () => {});
    service.on("multi", () => {});
    assert.strictEqual(service.listenerCount("multi"), 2);
  });

  it("listeners() retourne les fonctions enregistrées", () => {
    const fn1: EventListener = () => {};
    const fn2: EventListener = () => {};
    service.on("lst", fn1);
    service.on("lst", fn2);
    const lst = service.listeners("lst");
    assert.strictEqual(lst.length, 2);
  });

  it("rawListeners() retourne les wrappers", () => {
    service.once("raw", () => {});
    const raw = service.rawListeners("raw");
    assert.strictEqual(raw.length, 1);
  });

  it("eventNames() liste les events enregistrés", () => {
    service.on("alpha", () => {});
    service.on("beta", () => {});
    const names = service.eventNames();
    assert(names.includes("alpha"));
    assert(names.includes("beta"));
  });

  it("symbol event names", () => {
    const sym = Symbol("myEvent");
    let received = false;
    service.on(sym, () => {
      received = true;
    });
    service.emit(sym);
    assert.strictEqual(received, true);
    assert(service.eventNames().includes(sym));
  });

  it("listen() retourne une fonction qui fire l'event", () => {
    let received = false;
    const fire = service.listen("listenTest", () => {
      received = true;
    });
    assert.strictEqual(typeof fire, "function");
    fire();
    assert.strictEqual(received, true);
  });

  it("settingsToListen() auto-wire les clés onFoo", () => {
    let called = false;
    service.settingsToListen(
      {
        onMyEvent: () => {
          called = true;
        },
      },
      service,
    );
    service.emit("onMyEvent");
    assert.strictEqual(called, true);
  });

  it("retour this permet le chaînage", () => {
    const result = service.on("a", () => {}).on("b", () => {});
    assert.strictEqual(result, service);
  });

  it("throw si notificationsCenter absent — fire()", () => {
    const s = new Service("noEvents", undefined, false);
    assert.throws(() => s.fire("x"), /notificationsCenter not initialized/);
  });

  it("throw si notificationsCenter absent — emit()", () => {
    const s = new Service("noEvents", undefined, false);
    assert.throws(() => s.emit("x"), /notificationsCenter not initialized/);
  });

  it("throw si notificationsCenter absent — on()", () => {
    const s = new Service("noEvents", undefined, false);
    assert.throws(
      () => s.on("x", () => {}),
      /notificationsCenter not initialized/,
    );
  });

  it("throw si notificationsCenter absent — once()", () => {
    const s = new Service("noEvents", undefined, false);
    assert.throws(
      () => s.once("x", () => {}),
      /notificationsCenter not initialized/,
    );
  });

  it("throw si notificationsCenter absent — off()", () => {
    const s = new Service("noEvents", undefined, false);
    assert.throws(
      () => s.off("x", () => {}),
      /notificationsCenter not initialized/,
    );
  });

  it("throw si notificationsCenter absent — eventNames()", () => {
    const s = new Service("noEvents", undefined, false);
    assert.throws(() => s.eventNames(), /notificationsCenter not initialized/);
  });

  it("throw si notificationsCenter absent — listenerCount()", () => {
    const s = new Service("noEvents", undefined, false);
    assert.throws(
      () => s.listenerCount("x"),
      /notificationsCenter not initialized/,
    );
  });

  it("throw si notificationsCenter absent — listen()", () => {
    const s = new Service("noEvents", undefined, false);
    assert.throws(
      () => s.listen("x", () => {}),
      /notificationsCenter not initialized/,
    );
  });

  it("throw si notificationsCenter absent — setMaxListeners()", () => {
    const s = new Service("noEvents", undefined, false);
    assert.throws(
      () => s.setMaxListeners(10),
      /notificationsCenter not initialized/,
    );
  });

  it("throw si notificationsCenter absent — getMaxListeners()", () => {
    const s = new Service("noEvents", undefined, false);
    assert.throws(
      () => s.getMaxListeners(),
      /notificationsCenter not initialized/,
    );
  });

  it("throw après clean() — fire()", () => {
    service.clean();
    assert.throws(
      () => service.fire("x"),
      /notificationsCenter not initialized/,
    );
  });

  it("throw après clean() — emit()", () => {
    service.clean();
    assert.throws(
      () => service.emit("x"),
      /notificationsCenter not initialized/,
    );
  });

  it("throw après clean() — on()", () => {
    service.clean();
    assert.throws(
      () => service.on("x", () => {}),
      /notificationsCenter not initialized/,
    );
  });
});

// ─── Logging ──────────────────────────────────────────────────────────────────

describe("Service — log", () => {
  let service: Service;

  beforeEach(() => {
    service = new Service("log-test");
  });

  it("log() retourne un Pdu", () => {
    const pdu = service.log("message test", "INFO");
    assert(pdu);
  });

  it("log() fonctionne sans syslog après clean", () => {
    service.clean();
    const pdu = service.log("après clean", "DEBUG");
    assert(pdu);
  });

  it("log() fallback sans syslog : moduleName = nom du service", () => {
    service.clean();
    const pdu = service.log("payload", "INFO", "MY_MSGID", "extra");
    assert.strictEqual(pdu.moduleName, "log-test");
    assert.strictEqual(pdu.msgid, "MY_MSGID");
  });

  it("log() avec severité INFO", () => {
    const pdu = service.log("info msg", "INFO");
    assert.strictEqual(pdu.severityName, "INFO");
  });

  it("log() avec severité DEBUG", () => {
    const pdu = service.log("debug msg", "DEBUG");
    assert.strictEqual(pdu.severityName, "DEBUG");
  });

  it("log() avec severité WARNING", () => {
    const pdu = service.log("warn msg", "WARNING");
    assert.strictEqual(pdu.severityName, "WARNING");
  });

  it("log() avec severité ERROR", () => {
    const pdu = service.log("error msg", "ERROR");
    assert.strictEqual(pdu.severityName, "ERROR");
  });

  it("log() avec severité CRITIC (≠ CRITICAL)", () => {
    const pdu = service.log("critical msg", "CRITIC");
    assert.strictEqual(pdu.severityName, "CRITIC");
  });

  it("log() avec msgid explicite", () => {
    const pdu = service.log("payload", "INFO", "MY_MSGID");
    assert.strictEqual(pdu.msgid, "MY_MSGID");
  });

  it("log() avec les 4 paramètres", () => {
    const pdu = service.log("payload", "ERROR", "MSGID", "extra message");
    assert(pdu);
    assert.strictEqual(pdu.severityName, "ERROR");
    assert.strictEqual(pdu.msgid, "MSGID");
  });

  it("log() sans msgid utilise le nom du service", () => {
    const pdu = service.log("payload", "INFO");
    assert.strictEqual(pdu.msgid, "log-test");
  });

  it("spinlog() retourne un Pdu SPINNER", () => {
    const pdu = service.spinlog("loading...");
    assert(pdu);
    assert.strictEqual(pdu.severityName, "SPINNER");
  });

  it("logger() appelle console.debug", () => {
    let called = false;
    const orig = console.debug;
    console.debug = () => {
      called = true;
    };
    service.logger("debug payload");
    console.debug = orig;
    assert.strictEqual(called, true);
  });

  it("trace() appelle console.trace", () => {
    let called = false;
    const orig = console.trace;
    console.trace = () => {
      called = true;
    };
    service.trace("trace payload");
    console.trace = orig;
    assert.strictEqual(called, true);
  });
});

// ─── initSyslog ───────────────────────────────────────────────────────────────

describe("Service — initSyslog", () => {
  it("production sans debug", () => {
    const s = new Service("syslog-init");
    const result = s.initSyslog("production", false);
    assert(result !== null);
  });

  it("development avec debug", () => {
    const s = new Service("syslog-dev");
    const result = s.initSyslog("development", true);
    assert(result !== null);
  });

  it("test environment (NODE_ENV=test — valeur HORS EnvironmentType, cf Cli.ts:181)", () => {
    const s = new Service("syslog-test");
    // Divergence type↔runtime RÉELLE : `Cli.ts:181` affecte `process.env.NODE_ENV`
    // TEL QUEL à `this.environment` (cast, sans normalisation) → sous vitest,
    // `"test"` atteint bel et bien `initSyslog()`, alors que `EnvironmentType` ne
    // le contient pas (`"dev"|"development"|"prod"|"production"`). Le cast
    // MATÉRIALISE ce trou : il disparaîtra quand le core normalisera NODE_ENV.
    const nodeEnvTest = "test" as unknown as EnvironmentType;
    const result = s.initSyslog(nodeEnvTest, false);
    assert(result !== null);
  });

  it("retourne null après clean()", () => {
    const s = new Service("syslog-clean");
    s.clean();
    assert.strictEqual(s.initSyslog(), null);
  });
});

// ─── Clean ────────────────────────────────────────────────────────────────────

describe("Service — clean", () => {
  it("clean() remet toutes les refs à null/undefined", () => {
    const s = new Service("clean-test");
    s.clean();
    assert.strictEqual(s.container, null);
    assert.strictEqual(s.kernel, null);
    assert.strictEqual(s.syslog, null);
    assert.strictEqual(s.notificationsCenter, undefined);
  });

  it("clean(true) appelle syslog.reset()", () => {
    const s = new Service("clean-reset");
    let resetCalled = false;
    s.syslog!.reset = function () {
      resetCalled = true;
      return this;
    };
    s.clean(true);
    assert.strictEqual(resetCalled, true);
  });

  it("clean(false) ne reset pas le syslog", () => {
    const s = new Service("clean-no-reset");
    let resetCalled = false;
    s.syslog!.reset = function () {
      resetCalled = true;
      return this;
    };
    s.clean(false);
    assert.strictEqual(resetCalled, false);
  });

  it("set() throw après clean()", () => {
    const s = new Service("clean-set");
    s.clean();
    assert.throws(() => s.set("key", "val"), /container not initialized/);
  });

  it("events throw après clean()", () => {
    const s = new Service("clean-events");
    s.clean();
    assert.throws(() => s.emit("x"), /notificationsCenter not initialized/);
  });

  it("clean() idempotent — double appel sans throw", () => {
    const s = new Service("clean-idempotent");
    assert.doesNotThrow(() => {
      s.clean();
      s.clean();
    });
  });

  it("clean() retire les listeners d'un Event partagé (pas de fuite mémoire)", () => {
    const shared = new Event();
    const s = new Service("leak-test", undefined, shared);
    s.on("event", () => {});
    s.on("event", () => {});
    assert.strictEqual(shared.listenerCount("event"), 2);
    s.clean();
    assert.strictEqual(shared.listenerCount("event"), 0);
  });

  it("clean() ne retire PAS les listeners des autres services sur Event partagé", () => {
    const shared = new Event();
    const sA = new Service("sA", undefined, shared);
    const sB = new Service("sB", undefined, shared);
    sA.on("evt", () => {});
    sB.on("evt", () => {});
    assert.strictEqual(shared.listenerCount("evt"), 2);
    sA.clean();
    assert.strictEqual(shared.listenerCount("evt"), 1);
  });

  it("clean() ne retire PAS les listeners d'un Event auto-créé (déjà perdu)", () => {
    const s = new Service("auto-nc");
    s.on("evt", () => {});
    const nc = s.notificationsCenter!;
    s.clean();
    // NC auto-créé : les listeners restent dans l'objet NC (qui sera GC'd)
    assert.strictEqual(nc.listenerCount("evt"), 1);
  });

  it("clean() retire les listeners INJECTÉS PAR CONFIG (onXxx) sur Event partagé", () => {
    // Régression : avant le fix, `settingsToListen` du constructeur attachait
    // les listeners config directement sur le bus partagé sans passer par le
    // tracking → clean() ne pouvait pas les retirer (fuite à chaque alloc).
    const shared = new Event();
    let calls = 0;
    const s = new Service("config-listen", undefined, shared, {
      onConfigured: () => {
        calls += 1;
      },
    } as never);
    shared.emit("onConfigured");
    assert.strictEqual(calls, 1, "listener config doit fire");
    assert.strictEqual(
      shared.listenerCount("onConfigured"),
      1,
      "listener attaché sur le bus partagé",
    );
    s.clean();
    assert.strictEqual(
      shared.listenerCount("onConfigured"),
      0,
      "listener config retiré après clean() — pas de fuite",
    );
  });
});

// ─── Héritage ─────────────────────────────────────────────────────────────────

describe("Service — héritage", () => {
  it("sous-classe instanceof Service", () => {
    const s = new MyService("child");
    assert(s instanceof Service);
    assert(s instanceof MyService);
  });

  it("méthodes héritées fonctionnelles dans sous-classe", () => {
    const s = new MyService("child");
    s.set("x", 42);
    assert.strictEqual(s.get<number>("x"), 42);
    assert.strictEqual(s.extra, "extra");
  });

  it("getName() héritée", () => {
    const s = new MyService("childName");
    assert.strictEqual(s.getName(), "childName");
  });

  it("remove() appelle clean() sur instance sous-classe", () => {
    const parent = new Service("parent");
    const child = new MyService("child", parent.container ?? undefined);
    parent.set("child", child);
    parent.remove("child");
    assert.strictEqual(child.container, null);
  });

  it("sous-classe peut surcharger log()", () => {
    class VerboseService extends Service {
      // La surcharge doit respecter le CONTRAT de `Service.log` :
      // `(pci: Pci, severity?: Severity, msgid?: Msgid, msg?: Message) => Pdu`.
      // L'ancienne signature (`severity?: string`) rétrécissait le paramètre et
      // masquait le `as never` — une surcharge qui ne compilait pas.
      override log(
        pci: Pci,
        severity?: Severity,
        msgid?: Msgid,
        msg?: Message,
      ): Pdu {
        return super.log(`[VERBOSE] ${pci}`, severity, msgid, msg);
      }
    }
    const s = new VerboseService("verbose");
    const pdu = s.log("msg", "INFO");
    assert(String(pdu.payload).startsWith("[VERBOSE]"));
  });
});

// ─── Scénarios framework ──────────────────────────────────────────────────────

describe("Service — scénarios framework (partage container)", () => {
  it("deux services partagent le même container", () => {
    const container = new Container();
    const sA = new Service("serviceA", container);
    const sB = new Service("serviceB", container);
    assert.strictEqual(sA.container, sB.container);
  });

  it("service B trouve service A via container", () => {
    const container = new Container();
    const sA = new Service("serviceA", container);
    container.set("serviceA", sA);
    const sB = new Service("serviceB", container);
    assert.strictEqual(sB.get<Service>("serviceA"), sA);
  });

  it("notificationsCenter partagé entre deux services", () => {
    const sharedNC = new Event();
    const sA = new Service("sA", undefined, sharedNC);
    const sB = new Service("sB", undefined, sharedNC);
    let count = 0;
    sA.on("shared", () => {
      count++;
    });
    sB.on("shared", () => {
      count++;
    });
    sharedNC.emit("shared");
    assert.strictEqual(count, 2);
  });

  it("kernel mocké récupéré depuis container partagé", () => {
    const container = new Container();
    const kernel = makeKernel(container);
    container.set("kernel", kernel);
    const sA = new Service("sA", container);
    const sB = new Service("sB", container);
    assert.strictEqual(sA.kernel, kernel);
    assert.strictEqual(sB.kernel, kernel);
  });

  it("Service enregistré dans son propre container retrouvable", () => {
    const s = new Service("self");
    s.set("me", s);
    assert.strictEqual(s.get<Service>("me"), s);
  });

  it("paramètres partagés entre deux services via même container", () => {
    const container = new Container();
    const sA = new Service("sA", container);
    sA.setParameters("shared.value", 42);
    const sB = new Service("sB", container);
    assert.strictEqual(sB.getParameters("shared.value"), 42);
  });
});
