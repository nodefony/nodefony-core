/* eslint-disable @typescript-eslint/no-explicit-any */
/*
 *   MODEFONY FRAMEWORK UNIT TEST
 *
 *   MOCHA STYLE
 *
 */

import { assert, expect } from "chai";
import Event, { create, notification } from "../Event";
import { isPromise } from "../Tools";

declare let global: NodeJS.Global & { notificationsCenter?: Event };

// ─── 1. Namespace ─────────────────────────────────────────────────────────────

describe("Event — namespace", () => {
  it("exports Event, create, notification", () => {
    assert(Event);
    assert(create);
    assert.strictEqual(notification, Event);
  });

  it("create() retourne une instance Event", () => {
    const ev = create();
    assert(ev instanceof Event);
  });

  it("new Event() sans args", () => {
    const ev = new Event();
    assert(ev instanceof Event);
  });
});

// ─── 2. Construction avec settings (settingsToListen) ────────────────────────

describe("Event — construction avec settings", () => {
  it("settingsToListen via constructeur — déclenche l'écoute des clés onXxx", () =>
    new Promise<void>((done) => {
      const received: string[] = [];
      const settings = {
        onFoo: () => {
          received.push("foo");
        },
        onBar: () => {
          received.push("bar");
        },
        ignoredKey: () => {
          received.push("ignored");
        },
      };
      const ev = new Event(settings);
      ev.emit("onFoo");
      ev.emit("onBar");
      assert.deepEqual(received, ["foo", "bar"]);
      done();
    }));

  it("settingsToListen — ignores les clés sans préfixe on", () => {
    const called: string[] = [];
    const ev = new Event({ someMethod: () => called.push("bad") });
    ev.emit("someMethod");
    assert.deepEqual(called, []);
  });

  it("settingsToListen avec context — bind correct", () =>
    new Promise<void>((done) => {
      const ctx = { value: 42 };
      let capturedThis: any = null;
      const settings = {
        onBound: function (this: any) {
          capturedThis = this;
        },
      };
      const ev = new Event(settings, ctx);
      ev.emit("onBound");
      assert.strictEqual(capturedThis, ctx);
      done();
    }));

  it("options.nbListeners — configure setMaxListeners", () => {
    const ev = new Event(undefined, undefined, { nbListeners: 50 });
    assert.strictEqual(ev.getMaxListeners(), 50);
  });
});

// ─── 3. settingsToListen() direct ─────────────────────────────────────────────

describe("Event — settingsToListen()", () => {
  it("ajoute les listeners onXxx", () => {
    const ev = new Event();
    const calls: string[] = [];
    ev.settingsToListen({ onStart: () => calls.push("start") });
    ev.emit("onStart");
    assert.deepEqual(calls, ["start"]);
  });

  it("multiple appels accumulent les listeners", () => {
    const ev = new Event();
    const calls: number[] = [];
    ev.settingsToListen({ onReady: () => calls.push(1) });
    ev.settingsToListen({ onReady: () => calls.push(2) });
    ev.emit("onReady");
    assert.deepEqual(calls, [1, 2]);
  });
});

// ─── 4. listen() ──────────────────────────────────────────────────────────────

describe("Event — listen()", () => {
  it("retourne une fonction emit", () => {
    const ev = new Event();
    const fn = ev.listen({}, "onTest", () => {});
    expect(fn).to.be.a("function");
  });

  it("listener est appelé lors du emit", () =>
    new Promise<void>((done) => {
      const ev = new Event();
      ev.listen({}, "onPing", () => done());
      ev.emit("onPing");
    }));

  it("listener est bindé au context", () =>
    new Promise<void>((done) => {
      const ctx = { tag: "ctx" };
      const ev = new Event();
      ev.listen(ctx, "onCtx", function (this: any) {
        assert.strictEqual(this.tag, "ctx");
        done();
      });
      ev.emit("onCtx");
    }));

  it("listener non-function est ignoré (pas d'erreur)", () => {
    const ev = new Event();
    assert.doesNotThrow(() => {
      ev.listen({}, "onIgnore", 42 as any);
    });
  });

  it("la fonction retournée émet sur l'event", () => {
    const ev = new Event();
    const received: any[] = [];
    ev.on("onEmit", (...args) => received.push(args));
    const emitter = ev.listen({}, "onEmit", () => {});
    emitter("arg1", "arg2");
    assert.ok(received.length > 0);
  });
});

// ─── 5. fire() ────────────────────────────────────────────────────────────────

describe("Event — fire()", () => {
  it("fire() alias de emit()", () => {
    const ev = new Event();
    const calls: number[] = [];
    ev.on("onFire", (n: number) => calls.push(n));
    const r1 = ev.fire("onFire", 1);
    const r2 = ev.emit("onFire", 2);
    assert.strictEqual(r1, r2);
    assert.deepEqual(calls, [1, 2]);
  });

  it("fire() retourne false si aucun listener", () => {
    const ev = new Event();
    assert.strictEqual(ev.fire("nonExistent"), false);
  });

  it("fire() avec Symbol event name", () => {
    const sym = Symbol("myEvent");
    const ev = new Event();
    const calls: string[] = [];
    ev.on(sym, () => calls.push("sym"));
    ev.fire(sym);
    assert.deepEqual(calls, ["sym"]);
  });

  it("fire() transmet plusieurs arguments", () => {
    const ev = new Event();
    let received: any[] = [];
    ev.on("multi", (...args: any[]) => (received = args));
    ev.fire("multi", 1, "two", { three: 3 });
    assert.deepEqual(received, [1, "two", { three: 3 }]);
  });
});

// ─── 6. emitAsync() / fireAsync() ─────────────────────────────────────────────

describe("Event — emitAsync()", () => {
  let ev: Event;
  beforeEach(() => {
    ev = create();
  });

  it("retourne false si aucun handler", async () => {
    const res = await ev.emitAsync("noHandler");
    assert.strictEqual(res, false);
  });

  it("retourne tableau des résultats", async () => {
    ev.on("onVal", async () => 42);
    const res = await ev.emitAsync("onVal");
    assert.deepEqual(res, [42]);
  });

  it("multiple handlers — résultats dans l'ordre", async () => {
    ev.on("onMulti", async () => 1);
    ev.on("onMulti", async () => 2);
    ev.on("onMulti", async () => 3);
    const res = await ev.emitAsync("onMulti");
    assert.deepEqual(res, [1, 2, 3]);
  });

  it("handler sync retourne sa valeur", async () => {
    ev.on("onSync", () => "hello");
    const res = await ev.emitAsync("onSync");
    assert.deepEqual(res, ["hello"]);
  });

  it("arguments transmis aux handlers", async () => {
    let captured: any[] = [];
    ev.on("onArgs", async (...args: any[]) => {
      captured = args;
      return args.length;
    });
    const res = await ev.emitAsync("onArgs", "a", "b", "c");
    assert.deepEqual(captured, ["a", "b", "c"]);
    assert.deepEqual(res, [3]);
  });

  it("fireAsync() est alias de emitAsync()", async () => {
    ev.on("onAlias", async () => 99);
    const r1 = await ev.emitAsync("onAlias");
    ev.removeAllListeners("onAlias");
    ev.on("onAlias", async () => 99);
    const r2 = await ev.fireAsync("onAlias");
    assert.deepEqual(r1, r2);
  });

  it("handler qui throw — rejet propagé", async () => {
    ev.on("onThrow", async () => {
      throw new Error("handler-error");
    });
    try {
      await ev.emitAsync("onThrow");
      assert.fail("devrait rejeter");
    } catch (e: any) {
      assert.strictEqual(e.message, "handler-error");
    }
  });

  it("arrêt sur premier throw (handlers suivants non appelés)", async () => {
    const calls: number[] = [];
    ev.on("onStop", async () => {
      calls.push(1);
      throw new Error("stop");
    });
    ev.on("onStop", async () => {
      calls.push(2);
    });
    await ev.emitAsync("onStop").catch(() => {});
    assert.deepEqual(calls, [1]);
  });

  it("retourne une Promise", () => {
    ev.on("onProm", async () => {});
    const p = ev.emitAsync("onProm");
    assert(isPromise(p));
  });

  it("Symbol event name dans emitAsync", async () => {
    const sym = Symbol("async");
    ev.on(sym, async () => "sym-result");
    const res = await ev.emitAsync(sym);
    assert.deepEqual(res, ["sym-result"]);
  });
});

// ─── 7. Sync complet (global notificationsCenter) ─────────────────────────────

describe("NODEFONY Notifications Center", () => {
  describe("namespace", () => {
    beforeAll(() => {
      global.notificationsCenter = create();
    });
    it("register", () =>
      new Promise<void>((done) => {
        assert(Event);
        assert(notification);
        assert(global.notificationsCenter instanceof Event);
        assert(create);
        done();
      }));
  });

  describe("sync", () => {
    it("sync fire + emit reçus dans l'ordre", () =>
      new Promise<void>((done) => {
        if (!global.notificationsCenter) throw new Error("global not ready");
        const obj = {};
        global.notificationsCenter.on("myEvent", (count, args) => {
          assert.strictEqual(args, obj);
          if (count === 1) {
            done();
          } else {
            assert.strictEqual(count, 0);
          }
        });
        let i = 0;
        setTimeout(() => {
          if (!global.notificationsCenter) throw new Error("global not ready");
          global.notificationsCenter.fire("myEvent", i, obj);
          global.notificationsCenter.emit("myEvent", ++i, obj);
        }, 100);
      }));
  });

  describe("async", () => {
    beforeEach(() => {
      if ("notificationsCenter" in global) {
        delete (global as any).notificationsCenter;
      }
      global.notificationsCenter = create();
    });

    it("simple async handler", async () => {
      if (!global.notificationsCenter) throw new Error("global not ready");
      const obj = {};
      global.notificationsCenter.on(
        "myEvent",
        async (count, args) =>
          new Promise((resolve) => {
            if (count === 1) setTimeout(() => resolve(count), 100);
            else setTimeout(() => resolve(args), 200);
          }),
      );
      let i = 0;
      let res: any[] = await global.notificationsCenter.fireAsync(
        "myEvent",
        i,
        obj,
      );
      assert.strictEqual(res[0], obj);
      res = await global.notificationsCenter.emitAsync("myEvent", ++i, obj);
      assert.strictEqual(res[0], 1);
    });

    it("multi async handlers", async () => {
      if (!global.notificationsCenter) throw new Error("global not ready");
      const obj = {};
      global.notificationsCenter.on(
        "myEvent",
        async (count, args) =>
          new Promise((resolve) => setTimeout(() => resolve(args), 100)),
      );
      global.notificationsCenter.on(
        "myEvent",
        async (count) =>
          new Promise((resolve) => setTimeout(() => resolve(count + 1), 50)),
      );
      let i = 0;
      const res = await global.notificationsCenter.fireAsync("myEvent", i, obj);
      const res1 = await global.notificationsCenter.emitAsync(
        "myEvent",
        ++i,
        obj,
      );
      assert.strictEqual(res.length, 2);
      assert.strictEqual(res[0], obj);
      assert.strictEqual(res[1], 1);
      assert.strictEqual(res1.length, 2);
      assert.strictEqual(res1[0], obj);
      assert.strictEqual(res1[1], 2);
    });

    it("await error", async () => {
      if (!global.notificationsCenter) throw new Error("global not ready");
      const myFunc2 = async () => {
        throw new Error("myError");
      };
      global.notificationsCenter.on("myEvent", async (count, args) => args);
      global.notificationsCenter.on("myEvent", async () => await myFunc2());
      const res = await global.notificationsCenter
        .fireAsync("myEvent", 0, {})
        .catch((e: Error) => {
          assert.strictEqual(e.message, "myError");
        });
      assert.strictEqual(res, undefined);
      const p = global.notificationsCenter
        .fireAsync("myEvent", 0, {})
        .catch((e: Error) => {
          assert.strictEqual(e.message, "myError");
        });
      assert(isPromise(p));
    });
  });
});

// ─── 8. Edge cases ────────────────────────────────────────────────────────────

describe("Event — edge cases", () => {
  it("removeAllListeners — emitAsync retourne false ensuite", async () => {
    const ev = new Event();
    ev.on("onEdge", async () => 1);
    ev.removeAllListeners("onEdge");
    const res = await ev.emitAsync("onEdge");
    assert.strictEqual(res, false);
  });

  it("once() — handler appelé une seule fois dans emitAsync", async () => {
    const ev = new Event();
    let count = 0;
    ev.once("onOnce", async () => ++count);
    await ev.emitAsync("onOnce");
    await ev.emitAsync("onOnce");
    assert.strictEqual(count, 1);
  });

  it("fire() sans listeners retourne false", () => {
    const ev = new Event();
    assert.strictEqual(ev.fire("ghostEvent"), false);
  });

  it("handlers async en parallèle — respect ordre résultats (séquentiels)", async () => {
    const ev = new Event();
    const order: number[] = [];
    ev.on("onSeq", async () => {
      await new Promise((r) => setTimeout(r, 30));
      order.push(1);
      return 1;
    });
    ev.on("onSeq", async () => {
      order.push(2);
      return 2;
    });
    const res = await ev.emitAsync("onSeq");
    assert.deepEqual(res, [1, 2]);
    assert.deepEqual(order, [1, 2]);
  });
});

// ─── 9. Performance ──────────────────────────────────────────────────────────

describe("Event — performance", () => {
  it("10k fire() sync < 100ms", () => {
    const ev = new Event();
    let count = 0;
    ev.on("onPerf", () => count++);
    const start = Date.now();
    for (let i = 0; i < 10_000; i++) {
      ev.fire("onPerf");
    }
    const elapsed = Date.now() - start;
    assert.strictEqual(count, 10_000);
    expect(elapsed).to.be.lessThan(100);
  });

  it("1k emitAsync() < 500ms", async () => {
    const ev = new Event();
    ev.on("onAsync", async () => 42);
    const start = Date.now();
    for (let i = 0; i < 1_000; i++) {
      await ev.emitAsync("onAsync");
    }
    const elapsed = Date.now() - start;
    expect(elapsed).to.be.lessThan(500);
  });

  it("create() 10k instances < 200ms", () => {
    const start = Date.now();
    for (let i = 0; i < 10_000; i++) {
      create();
    }
    const elapsed = Date.now() - start;
    expect(elapsed).to.be.lessThan(200);
  });
});

// ─── 10. Charge ───────────────────────────────────────────────────────────────

describe("Event — charge", () => {
  it("100 listeners sur le même event — tous appelés", () => {
    const ev = new Event(undefined, undefined, { nbListeners: 110 });
    const calls: number[] = [];
    for (let i = 0; i < 100; i++) {
      ev.on("onLoad", () => calls.push(i));
    }
    ev.fire("onLoad");
    assert.strictEqual(calls.length, 100);
  });

  it("1k events différents — pas de collision", () => {
    const ev = new Event(undefined, undefined, { nbListeners: 0 });
    const results = new Map<string, number>();
    for (let i = 0; i < 1_000; i++) {
      const name = `event_${i}`;
      results.set(name, 0);
      ev.on(name, () => results.set(name, (results.get(name) ?? 0) + 1));
    }
    for (let i = 0; i < 1_000; i++) {
      ev.fire(`event_${i}`);
    }
    for (const [, count] of results) {
      assert.strictEqual(count, 1);
    }
  });

  it("50 handlers async en emitAsync — résultats corrects", async () => {
    const ev = new Event(undefined, undefined, { nbListeners: 60 });
    for (let i = 0; i < 50; i++) {
      ev.on("onBulk", async () => i);
    }
    const res = await ev.emitAsync("onBulk");
    assert(Array.isArray(res));
    assert.strictEqual((res as any[]).length, 50);
  });

  it("removeAllListeners après charge — aucune fuite", () => {
    const ev = new Event(undefined, undefined, { nbListeners: 0 });
    for (let i = 0; i < 200; i++) {
      ev.on("onLeak", () => {});
    }
    assert.strictEqual(ev.listenerCount("onLeak"), 200);
    ev.removeAllListeners("onLeak");
    assert.strictEqual(ev.listenerCount("onLeak"), 0);
  });
});
