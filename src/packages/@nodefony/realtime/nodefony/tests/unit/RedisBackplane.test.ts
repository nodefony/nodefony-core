import { describe, it, expect } from "vitest";
import {
  RedisBackplane,
  createRedisServiceTransport,
  resolveRedisChannel,
  REDIS_RT_CHANNEL,
  type IRedisBackplaneTransport,
} from "../../src/backplane/RedisBackplane.js";
import type { IBackplaneMessage } from "../../interfaces/IBackplane.js";

/**
 * Bus pub/sub Redis **en mémoire** — simule N pods abonnés au même canal SANS
 * Redis. Chaque `transport()` représente un pod : `publish` diffuse à TOUS les
 * abonnés du canal (y compris l'émetteur, comme Redis), prouvant le fan-out
 * cross-pod ET l'anti-echo (l'émetteur se filtre par originId).
 */
class FakeRedisBus {
  readonly #subs = new Map<string, Set<(m: string) => void>>();
  /** Enveloppes JSON publiées (introspection des tests). */
  readonly published: { channel: string; message: string }[] = [];

  transport(): IRedisBackplaneTransport {
    const bus = this;
    let mine: ((m: string) => void) | null = null;
    return {
      publish(channel, message): void {
        bus.published.push({ channel, message });
        bus.#subs.get(channel)?.forEach((l) => l(message));
      },
      subscribe(channel, onMessage): void {
        mine = onMessage;
        let set = bus.#subs.get(channel);
        if (!set) {
          set = new Set();
          bus.#subs.set(channel, set);
        }
        set.add(onMessage);
      },
      unsubscribe(channel): void {
        if (mine) bus.#subs.get(channel)?.delete(mine);
        mine = null;
      },
    };
  }

  /** Nb d'abonnés sur le canal (vérifie l'idempotence du start / le stop). */
  subscriberCount(channel: string = REDIS_RT_CHANNEL): number {
    return bus_size(this.#subs.get(channel));
  }
}
function bus_size(s: Set<unknown> | undefined): number {
  return s ? s.size : 0;
}

describe("resolveRedisChannel — namespace anti cross-talk (dette #1)", () => {
  it("sans namespace → canal base (compat mono-app)", () => {
    expect(resolveRedisChannel()).to.equal(REDIS_RT_CHANNEL);
  });

  it("avec namespace → base suffixée `nodefony:realtime:<ns>`", () => {
    expect(resolveRedisChannel("myapp")).to.equal(`${REDIS_RT_CHANNEL}:myapp`);
  });

  it("2 apps namespacées sur le MÊME bus Redis ne s'échangent RIEN (0 cross-talk)", async () => {
    const bus = new FakeRedisBus();
    const appA = new RedisBackplane(
      bus.transport(),
      "a:1",
      resolveRedisChannel("app-a"),
    );
    const appB = new RedisBackplane(
      bus.transport(),
      "b:1",
      resolveRedisChannel("app-b"),
    );
    await appA.start();
    await appB.start();
    const gotB: IBackplaneMessage[] = [];
    appB.onMessage((m) => gotB.push(m));
    appA.publish("ch", { v: 1 });
    expect(gotB).to.have.lengthOf(0); // cloisonné par canal — avant fix : reçu
  });
});

describe("RedisBackplane (pub/sub cross-pod)", () => {
  it("expose l'originId fourni", () => {
    const bp = new RedisBackplane(new FakeRedisBus().transport(), "pod-A");
    expect(bp.originId).to.equal("pod-A");
  });

  it("2 pods au MÊME pid (PID 1 conteneurisé) avec origins host:pid → fan-out PAS avalé par l'anti-écho (dette #2)", async () => {
    const bus = new FakeRedisBus();
    // même composante pid (":1"), seule la composante host diffère — la
    // situation k8s exacte que l'ex-default `String(process.pid)` confondait.
    const podA = new RedisBackplane(bus.transport(), "pod-a:1");
    const podB = new RedisBackplane(bus.transport(), "pod-b:1");
    await podA.start();
    await podB.start();
    const gotB: IBackplaneMessage[] = [];
    podB.onMessage((m) => gotB.push(m));
    podA.publish("ch", { v: 1 });
    expect(gotB).to.have.lengthOf(1);
    expect(gotB[0]?.originId).to.equal("pod-a:1");
  });

  it("publish() émet l'enveloppe JSON {channel,payload,originId} sur le canal Redis", () => {
    const bus = new FakeRedisBus();
    const bp = new RedisBackplane(bus.transport(), "pod-A");
    bp.publish("orm:health", { rps: 12 });
    expect(bus.published).to.have.lengthOf(1);
    expect(bus.published[0].channel).to.equal(REDIS_RT_CHANNEL);
    expect(JSON.parse(bus.published[0].message)).to.deep.equal({
      channel: "orm:health",
      payload: { rps: 12 },
      originId: "pod-A",
    });
  });

  it("fan-out cross-pod : A.publish → B reçoit (anti-echo : A ne se reçoit pas)", async () => {
    const bus = new FakeRedisBus();
    const a = new RedisBackplane(bus.transport(), "pod-A");
    const b = new RedisBackplane(bus.transport(), "pod-B");
    const gotA: IBackplaneMessage[] = [];
    const gotB: IBackplaneMessage[] = [];
    a.onMessage((m) => gotA.push(m));
    b.onMessage((m) => gotB.push(m));
    await a.start();
    await b.start();

    a.publish("syslog:stream", "hello");

    expect(gotA).to.have.lengthOf(0); // anti-echo
    expect(gotB).to.deep.equal([
      { channel: "syslog:stream", payload: "hello", originId: "pod-A" },
    ]);
  });

  it("anti-echo : ignore une enveloppe portant son propre originId", async () => {
    const bus = new FakeRedisBus();
    const bp = new RedisBackplane(bus.transport(), "pod-A");
    let fired = 0;
    bp.onMessage(() => (fired += 1));
    await bp.start();
    bp.publish("c", 1); // revient à l'émetteur via le bus
    expect(fired).to.equal(0);
  });

  it("ingress : ignore le JSON malformé et les enveloppes sans channel/originId", async () => {
    const bus = new FakeRedisBus();
    const t = bus.transport();
    const bp = new RedisBackplane(t, "pod-A");
    let fired = 0;
    bp.onMessage(() => (fired += 1));
    await bp.start();
    // simule un autre process publiant n'importe quoi sur le canal partagé
    t.publish(REDIS_RT_CHANNEL, "}{ pas du json");
    t.publish(REDIS_RT_CHANNEL, JSON.stringify({ payload: 1 })); // pas de channel
    t.publish(REDIS_RT_CHANNEL, JSON.stringify({ channel: "c" })); // pas d'originId
    expect(fired).to.equal(0);
  });

  it("start() est idempotent (un seul abonnement)", async () => {
    const bus = new FakeRedisBus();
    const bp = new RedisBackplane(bus.transport(), "pod-A");
    await bp.start();
    await bp.start();
    expect(bus.subscriberCount()).to.equal(1);
  });

  it("onMessage remplace le handler précédent", async () => {
    const bus = new FakeRedisBus();
    const a = new RedisBackplane(bus.transport(), "pod-A");
    const b = new RedisBackplane(bus.transport(), "pod-B");
    const first: number[] = [];
    const second: number[] = [];
    b.onMessage(() => first.push(1));
    b.onMessage(() => second.push(1));
    await b.start();
    a.publish("c", 1);
    expect(first).to.have.lengthOf(0);
    expect(second).to.have.lengthOf(1);
  });

  it("stop() désabonne (plus d'ingress) et est idempotent", async () => {
    const bus = new FakeRedisBus();
    const a = new RedisBackplane(bus.transport(), "pod-A");
    const b = new RedisBackplane(bus.transport(), "pod-B");
    let fired = 0;
    b.onMessage(() => (fired += 1));
    await b.start();
    await b.stop();
    await b.stop(); // idempotent
    expect(bus.subscriberCount()).to.equal(0);
    a.publish("c", 1);
    expect(fired).to.equal(0);
  });

  it("canal Redis surchargeable (namespacing multi-app)", () => {
    const bus = new FakeRedisBus();
    const bp = new RedisBackplane(bus.transport(), "pod-A", "myapp:rt");
    bp.publish("c", 1);
    expect(bus.published[0].channel).to.equal("myapp:rt");
  });
});

describe("createRedisServiceTransport (adaptateur clients redis)", () => {
  it("mappe publish/subscribe/unsubscribe vers les clients (compat RedisClientType)", async () => {
    const pubCalls: { channel: string; message: string }[] = [];
    let subListener: ((message: string, channel: string) => unknown) | null =
      null;
    let unsubArgs: { channel: string; hadListener: boolean } | null = null;

    const publisher = {
      publish(channel: string, message: string) {
        pubCalls.push({ channel, message });
        return Promise.resolve(1);
      },
    };
    const subscriber = {
      subscribe(
        _channel: string,
        listener: (message: string, channel: string) => unknown,
      ) {
        subListener = listener;
        return Promise.resolve();
      },
      unsubscribe(
        channel: string,
        listener?: (message: string, channel: string) => unknown,
      ) {
        unsubArgs = { channel, hadListener: !!listener };
        return Promise.resolve();
      },
    };

    const transport = createRedisServiceTransport(publisher, subscriber);
    const received: string[] = [];

    transport.publish("nodefony:realtime", "payload");
    expect(pubCalls).to.deep.equal([
      { channel: "nodefony:realtime", message: "payload" },
    ]);

    await transport.subscribe("nodefony:realtime", (m) => received.push(m));
    expect(subListener).to.be.a("function");
    // Redis fournit (message, channel) → l'adaptateur n'expose que message.
    subListener!("hello", "nodefony:realtime");
    expect(received).to.deep.equal(["hello"]);

    await transport.unsubscribe("nodefony:realtime");
    expect(unsubArgs).to.deep.equal({
      channel: "nodefony:realtime",
      hadListener: true, // unsubscribe ciblé sur LE listener (pas un wildcard)
    });
  });
});
