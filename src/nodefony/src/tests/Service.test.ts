import assert from "node:assert";
import Service, { EventListener } from "../Service";
import Container from "../Container";
import Event from "../Event";

declare let global: NodeJS.Global & { service?: Service };

describe("Service — construction", () => {
  it("crée un service avec nom seulement", () => {
    const s = new Service("test");
    assert(s instanceof Service);
    assert.strictEqual(s.name, "test");
    assert(s.container instanceof Container);
    assert(s.syslog !== null);
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

  it("partage un Event existant", () => {
    const shared = new Event();
    const s = new Service("sharedEvent", undefined, shared);
    assert.strictEqual(s.notificationsCenter, shared);
  });

  it("getName() retourne le nom", () => {
    const s = new Service("myService");
    assert.strictEqual(s.getName(), "myService");
  });
});

describe("Service — container", () => {
  let service: Service;

  beforeEach(() => {
    service = new Service("container-test");
  });

  it("set/get un objet dans le container", () => {
    const obj = { value: 42 };
    service.set("myObj", obj);
    assert.strictEqual(service.get<typeof obj>("myObj"), obj);
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

  it("remove() appelle clean() sur un Service enfant", () => {
    const child = new Service("child", service.container ?? undefined);
    service.set("child", child);
    service.remove("child");
    assert.strictEqual(child.container, null);
  });

  it("setParameters/getParameters", () => {
    service.setParameters("app.name", "nodefony");
    const result = service.getParameters("app.name");
    assert.strictEqual(result, "nodefony");
  });
});

describe("Service — events", () => {
  let service: Service;

  beforeEach(() => {
    service = new Service("event-test");
  });

  it("on/emit fonctionne", (done) => {
    service.on("test", (data: string) => {
      assert.strictEqual(data, "hello");
      done();
    });
    service.emit("test", "hello");
  });

  it("fire() émet un event", (done) => {
    service.on("ping", () => done());
    service.fire("ping");
  });

  it("once() ne reçoit qu'une fois", () => {
    let count = 0;
    service.once("single", () => { count++; });
    service.emit("single");
    service.emit("single");
    assert.strictEqual(count, 1);
  });

  it("off() supprime un listener", () => {
    let count = 0;
    const listener: EventListener = () => { count++; };
    service.on("toggled", listener);
    service.emit("toggled");
    service.off("toggled", listener);
    service.emit("toggled");
    assert.strictEqual(count, 1);
  });

  it("listenerCount()", () => {
    service.on("multi", () => {});
    service.on("multi", () => {});
    assert.strictEqual(service.listenerCount("multi"), 2);
  });

  it("eventNames() liste les events enregistrés", () => {
    service.on("alpha", () => {});
    service.on("beta", () => {});
    const names = service.eventNames();
    assert(names.includes("alpha"));
    assert(names.includes("beta"));
  });

  it("fireAsync() retourne une Promise", async () => {
    let resolved: string | undefined;
    service.on("async", async (v: string) => { resolved = v; });
    await service.fireAsync("async", "done");
    assert.strictEqual(resolved, "done");
  });

  it("retour this permet le chaînage", () => {
    const result = service.on("a", () => {}).on("b", () => {});
    assert.strictEqual(result, service);
  });

  it("throw si notificationsCenter absent", () => {
    const s = new Service("noEvents", undefined, false);
    assert.throws(() => s.emit("x"), /notificationsCenter not initialized/);
  });
});

describe("Service — log", () => {
  it("log() retourne un Pdu", () => {
    const s = new Service("log-test");
    const pdu = s.log("message test", "INFO");
    assert(pdu);
  });

  it("log() fonctionne sans syslog après clean", () => {
    const s = new Service("log-test");
    s.clean();
    const pdu = s.log("après clean", "DEBUG");
    assert(pdu);
  });
});

describe("Service — clean", () => {
  it("clean() remet toutes les refs à null/undefined", () => {
    const s = new Service("clean-test");
    s.clean();
    assert.strictEqual(s.container, null);
    assert.strictEqual(s.kernel, null);
    assert.strictEqual(s.syslog, null);
    assert.strictEqual(s.notificationsCenter, undefined);
  });
});
