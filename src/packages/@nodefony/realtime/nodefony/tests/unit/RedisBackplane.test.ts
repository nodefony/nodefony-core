import { describe, it, expect } from "vitest";
import {
  RedisBackplane,
  createRedisServiceTransport,
  resolveRedisChannel,
  REDIS_RT_CHANNEL,
} from "../../src/backplane/RedisBackplane.js";
import type { IBackplaneMessage } from "../../interfaces/IBackplane.js";
import { FakeRedisBus } from "../helpers/fakeRedisBus.js";

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
    bp.publish("nodefony:orm:health", { rps: 12 });
    expect(bus.published).to.have.lengthOf(1);
    expect(bus.published[0]!.channel).to.equal(REDIS_RT_CHANNEL);
    const message = bus.published[0]!.message;
    expect(typeof message).to.equal("string");
    expect(JSON.parse(String(message))).to.deep.equal({
      channel: "nodefony:orm:health",
      payload: { rps: 12 },
      originId: "pod-A",
    });
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
    void t.publish(REDIS_RT_CHANNEL, "}{ pas du json");
    void t.publish(REDIS_RT_CHANNEL, JSON.stringify({ payload: 1 })); // pas de channel
    void t.publish(REDIS_RT_CHANNEL, JSON.stringify({ channel: "c" })); // pas d'originId
    expect(fired).to.equal(0);
  });

  it("start() est idempotent (un seul abonnement)", async () => {
    const bus = new FakeRedisBus();
    const bp = new RedisBackplane(bus.transport(), "pod-A");
    await bp.start();
    await bp.start();
    expect(bus.subscriberCount()).to.equal(1);
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
    expect(bus.published[0]!.channel).to.equal("myapp:rt");
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

    void transport.publish("nodefony:realtime", "payload");
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

describe("RedisBackplane — charge absente (ADR-0021 S1)", () => {
  for (const secret of [null, "s3cr3t"]) {
    it(`une charge absente arrive \`undefined\` (${secret === null ? "bus nu" : "bus scellé"})`, async () => {
      const bus = new FakeRedisBus();
      const a = new RedisBackplane(
        bus.transport(),
        "pod-A",
        REDIS_RT_CHANNEL,
        secret,
      );
      const b = new RedisBackplane(
        bus.transport(),
        "pod-B",
        REDIS_RT_CHANNEL,
        secret,
      );
      const got: IBackplaneMessage[] = [];
      b.onMessage((m) => got.push(m));
      await b.start();
      a.publish("chat:room1", undefined);
      expect(got).to.have.lengthOf(1);
      expect(got[0]!.payload).to.equal(undefined);
    });
  }
});

describe("RedisBackplane — sceaux refusés (ADR-0021 S6, S9)", () => {
  it("un message au sceau faux fait monter `sealRejectedTotal` de 1, sans atteindre le hub", async () => {
    const bus = new FakeRedisBus();
    const a = new RedisBackplane(
      bus.transport(),
      "pod-A",
      REDIS_RT_CHANNEL,
      "ancien",
    );
    const b = new RedisBackplane(
      bus.transport(),
      "pod-B",
      REDIS_RT_CHANNEL,
      "nouveau",
    );
    let fired = 0;
    b.onMessage(() => (fired += 1));
    await b.start();
    expect(b.describe().sealRejectedTotal).to.equal(0);
    a.publish("chat:room1", { n: 1 });
    expect(b.describe().sealRejectedTotal).to.equal(1);
    expect(fired).to.equal(0);
  });

  it("journal : le premier refus, puis un sur cent", async () => {
    const bus = new FakeRedisBus();
    const a = new RedisBackplane(
      bus.transport(),
      "pod-A",
      REDIS_RT_CHANNEL,
      "ancien",
    );
    const notices: string[] = [];
    const b = new RedisBackplane(
      bus.transport(),
      "pod-B",
      REDIS_RT_CHANNEL,
      "nouveau",
      {
        onNotice: (message) => notices.push(message),
      },
    );
    await b.start();
    for (let i = 0; i < 200; i += 1) a.publish("chat:room1", { n: i });
    expect(b.describe().sealRejectedTotal).to.equal(200);
    expect(notices).to.have.lengthOf(3); // 1ᵉʳ, 100ᵉ, 200ᵉ
    expect(notices[0]).to.contain("sealRejectedTotal");
  });

  it("bus nu : aucun compteur de sceau (la question n'a pas de sens), le JSON malformé n'y entre pas", async () => {
    const bus = new FakeRedisBus();
    const t = bus.transport();
    const bp = new RedisBackplane(t, "pod-A");
    await bp.start();
    void t.publish(REDIS_RT_CHANNEL, "}{ pas du json");
    expect(bp.describe()).to.not.have.property("sealRejectedTotal");
  });
});
