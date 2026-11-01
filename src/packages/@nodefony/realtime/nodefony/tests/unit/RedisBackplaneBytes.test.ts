import { describe, it, expect } from "vitest";
import { CBOR_FRAME_CODEC, encodeCbor } from "nodefony/cbor";
import { JSON_FRAME_CODEC } from "nodefony";
import {
  RedisBackplane,
  REDIS_RT_CHANNEL,
  resolveRedisBytesChannel,
  type IRedisBackplaneTransport,
} from "../../src/backplane/RedisBackplane";
import {
  openBackplaneEnvelopeBytes,
  sealBackplaneEnvelopeBytes,
} from "../../src/backplane/envelope";
import { RealtimeHub } from "../../src/server/RealtimeHub";
import type { IBackplaneMessage } from "../../interfaces/IBackplane.js";

/**
 * Le sujet binaire du bus Redis (ADR-0021 S6) : la MÊME enveloppe
 * `{ channel, payload, originId }`, encodée en CBOR, octets natifs dans `payload`,
 * sceau calculé comme sur le texte — sur un second canal que les exemplaires
 * plus anciens n'écoutent pas.
 */

const BYTES_CHANNEL = resolveRedisBytesChannel(
  REDIS_RT_CHANNEL,
  CBOR_FRAME_CODEC,
);

type Listener = (m: string | Uint8Array) => void;

/**
 * Bus Redis en mémoire, à deux modes comme le vrai : un abonné texte reçoit une
 * chaîne, un abonné octets reçoit les octets publiés. Chaque `transport()` est un
 * pod ; `bytes: false` simule un exemplaire plus ancien, sans `subscribeBytes`.
 */
class FakeRedisBus {
  readonly #subs = new Map<string, Set<Listener>>();
  readonly published: { channel: string; message: string | Uint8Array }[] = [];

  transport(
    opts: { bytes: boolean } = { bytes: true },
  ): IRedisBackplaneTransport {
    const mine = new Map<string, Listener>();
    const add = (channel: string, l: Listener): void => {
      mine.set(channel, l);
      let set = this.#subs.get(channel);
      if (set === undefined) {
        set = new Set();
        this.#subs.set(channel, set);
      }
      set.add(l);
    };
    const t: IRedisBackplaneTransport = {
      publish: (channel, message): void => {
        this.published.push({ channel, message });
        this.#subs.get(channel)?.forEach((l) => l(message));
      },
      subscribe: (channel, onMessage): void =>
        add(channel, (m) => {
          if (typeof m === "string") onMessage(m);
        }),
      unsubscribe: (channel): void => {
        const l = mine.get(channel);
        if (l !== undefined) this.#subs.get(channel)?.delete(l);
        mine.delete(channel);
      },
    };
    if (opts.bytes)
      t.subscribeBytes = (channel, onMessage): void =>
        add(channel, (m) => {
          if (typeof m !== "string") onMessage(m);
        });
    return t;
  }

  subscriberCount(channel: string): number {
    return this.#subs.get(channel)?.size ?? 0;
  }
}

describe("enveloppe binaire du bus (ADR-0021 S6)", () => {
  const msg: IBackplaneMessage = {
    channel: "media:room1",
    payload: { seq: 7, frame: new Uint8Array([0, 1, 254, 255]) },
    originId: "pod-A",
  };

  it("nue : aller-retour à l'identique, octets rendus en Uint8Array", () => {
    const raw = sealBackplaneEnvelopeBytes(msg, CBOR_FRAME_CODEC);
    expect(raw).to.be.instanceOf(Uint8Array);
    const back = openBackplaneEnvelopeBytes(raw, CBOR_FRAME_CODEC);
    expect(back).to.deep.equal(msg);
  });

  it("scellée : aller-retour sous le même secret", () => {
    const raw = sealBackplaneEnvelopeBytes(msg, CBOR_FRAME_CODEC, "s3cret");
    expect(
      openBackplaneEnvelopeBytes(raw, CBOR_FRAME_CODEC, "s3cret"),
    ).to.deep.equal(msg);
  });

  it("charge absente : voyage `null`, rendue `undefined` comme sur le texte", () => {
    const raw = sealBackplaneEnvelopeBytes(
      { channel: "c", payload: undefined, originId: "o" },
      CBOR_FRAME_CODEC,
      "k",
    );
    expect(
      openBackplaneEnvelopeBytes(raw, CBOR_FRAME_CODEC, "k"),
    ).to.deep.equal({
      channel: "c",
      payload: undefined,
      originId: "o",
    });
  });

  it("un octet de la charge altéré : rejeté", () => {
    const sealed = sealBackplaneEnvelopeBytes(msg, CBOR_FRAME_CODEC, "k");
    const decoded = CBOR_FRAME_CODEC.decode(sealed) as Record<string, unknown>;
    const forged = encodeCbor({
      ...decoded,
      payload: { seq: 7, frame: new Uint8Array([0, 1, 254, 254]) },
    });
    expect(openBackplaneEnvelopeBytes(forged, CBOR_FRAME_CODEC, "k")).to.equal(
      null,
    );
  });

  it("canal repointé sous le même sceau : rejeté", () => {
    const sealed = sealBackplaneEnvelopeBytes(msg, CBOR_FRAME_CODEC, "k");
    const decoded = CBOR_FRAME_CODEC.decode(sealed) as Record<string, unknown>;
    const forged = encodeCbor({ ...decoded, channel: "nodefony:audit" });
    expect(openBackplaneEnvelopeBytes(forged, CBOR_FRAME_CODEC, "k")).to.equal(
      null,
    );
  });

  it("secret exigé : une enveloppe sans sceau, ou au mauvais secret, est rejetée", () => {
    const bare = sealBackplaneEnvelopeBytes(msg, CBOR_FRAME_CODEC);
    const other = sealBackplaneEnvelopeBytes(msg, CBOR_FRAME_CODEC, "autre");
    expect(openBackplaneEnvelopeBytes(bare, CBOR_FRAME_CODEC, "k")).to.equal(
      null,
    );
    expect(openBackplaneEnvelopeBytes(other, CBOR_FRAME_CODEC, "k")).to.equal(
      null,
    );
  });

  it("octets illisibles ou forme étrangère : rejetés sans lever", () => {
    expect(
      openBackplaneEnvelopeBytes(
        new Uint8Array([0xff, 0x00]),
        CBOR_FRAME_CODEC,
      ),
    ).to.equal(null);
    expect(
      openBackplaneEnvelopeBytes(encodeCbor({ channel: 1 }), CBOR_FRAME_CODEC),
    ).to.equal(null);
  });

  it("un codec texte est refusé : le sujet binaire porte des octets", () => {
    expect(() => sealBackplaneEnvelopeBytes(msg, JSON_FRAME_CODEC)).to.throw(
      TypeError,
      /codec binaire/,
    );
  });
});

describe("RedisBackplane — sujet binaire", () => {
  function pods(secret: string | null = null) {
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
    const gotA: IBackplaneMessage[] = [];
    const gotB: IBackplaneMessage[] = [];
    a.onMessage((m) => gotA.push(m));
    b.onMessage((m) => gotB.push(m));
    return { bus, a, b, gotA, gotB };
  }

  it("le sujet binaire se nomme d'après le protocole du codec", () => {
    expect(BYTES_CHANNEL).to.equal(
      `${REDIS_RT_CHANNEL}:nodefony.jsonrpc.cbor.v1`,
    );
  });

  it("armé AVANT start : start s'abonne aux deux sujets", async () => {
    const { bus, a } = pods();
    expect(a.enableBytes(CBOR_FRAME_CODEC)).to.equal(true);
    await a.start();
    expect(bus.subscriberCount(REDIS_RT_CHANNEL)).to.equal(1);
    expect(bus.subscriberCount(BYTES_CHANNEL)).to.equal(1);
    expect(a.describe().bytes).to.equal(true);
  });

  it("armé APRÈS start : le sujet binaire s'abonne aussitôt", async () => {
    const { bus, a } = pods();
    await a.start();
    expect(bus.subscriberCount(BYTES_CHANNEL)).to.equal(0);
    a.enableBytes(CBOR_FRAME_CODEC);
    expect(bus.subscriberCount(BYTES_CHANNEL)).to.equal(1);
  });

  it("des octets partent en CBOR sur le sujet binaire, arrivent intacts, sans écho", async () => {
    const { bus, a, b, gotA, gotB } = pods();
    a.enableBytes(CBOR_FRAME_CODEC);
    b.enableBytes(CBOR_FRAME_CODEC);
    await a.start();
    await b.start();
    const frame = new Uint8Array([0, 128, 255]);
    a.publish("media:room1", { seq: 1, frame });
    expect(bus.published).to.have.length(1);
    expect(bus.published[0]?.channel).to.equal(BYTES_CHANNEL);
    expect(bus.published[0]?.message).to.be.instanceOf(Uint8Array);
    expect(gotA).to.deep.equal([]);
    expect(gotB).to.deep.equal([
      { channel: "media:room1", payload: { seq: 1, frame }, originId: "pod-A" },
    ]);
    const received = gotB[0]?.payload as { frame: unknown };
    expect(received.frame).to.be.instanceOf(Uint8Array);
  });

  it("une charge sans octets garde le sujet texte, intact pour les anciens exemplaires", async () => {
    const { bus, a, b, gotB } = pods();
    a.enableBytes(CBOR_FRAME_CODEC);
    await a.start();
    await b.start(); // b : exemplaire non armé
    a.publish("chat:room", { text: "salut" });
    expect(bus.published[0]?.channel).to.equal(REDIS_RT_CHANNEL);
    expect(typeof bus.published[0]?.message).to.equal("string");
    expect(gotB).to.deep.equal([
      { channel: "chat:room", payload: { text: "salut" }, originId: "pod-A" },
    ]);
  });

  it("un exemplaire non armé n'écoute pas le sujet binaire : il ne reçoit pas d'octets déformés", async () => {
    const { a, b, gotB } = pods();
    a.enableBytes(CBOR_FRAME_CODEC);
    await a.start();
    await b.start();
    a.publish("media:room1", new Uint8Array([1, 2]));
    expect(gotB).to.deep.equal([]);
  });

  it("transport sans abonnement en octets : enableBytes rend false, rien n'est armé", async () => {
    const bus = new FakeRedisBus();
    const old = new RedisBackplane(bus.transport({ bytes: false }), "pod-old");
    expect(old.enableBytes(CBOR_FRAME_CODEC)).to.equal(false);
    await old.start();
    expect(bus.subscriberCount(BYTES_CHANNEL)).to.equal(0);
    expect(old.describe().bytes).to.equal(undefined);
  });

  it("stop() désabonne les deux sujets", async () => {
    const { bus, a } = pods();
    a.enableBytes(CBOR_FRAME_CODEC);
    await a.start();
    await a.stop();
    expect(bus.subscriberCount(REDIS_RT_CHANNEL)).to.equal(0);
    expect(bus.subscriberCount(BYTES_CHANNEL)).to.equal(0);
  });

  it("scellé : passe sous le même secret ; un message forgé fait monter sealRejectedTotal", async () => {
    const { bus, a, b, gotB } = pods("k");
    a.enableBytes(CBOR_FRAME_CODEC);
    b.enableBytes(CBOR_FRAME_CODEC);
    await a.start();
    await b.start();
    a.publish("media:room1", new Uint8Array([5]));
    expect(gotB).to.have.length(1);
    // Écriture tierce sur le sujet binaire, sans le secret (bus synchrone).
    void bus.transport().publish(
      BYTES_CHANNEL,
      sealBackplaneEnvelopeBytes(
        {
          channel: "media:room1",
          payload: new Uint8Array([6]),
          originId: "x",
        },
        CBOR_FRAME_CODEC,
        "pas-le-bon",
      ),
    );
    expect(gotB).to.have.length(1);
    expect(b.describe().sealRejectedTotal).to.equal(1);
  });
});

describe("deux hubs reliés par le sujet binaire", () => {
  it("un Uint8Array publié sur un canal diffusé arrive intact chez l'abonné de l'autre serveur", async () => {
    const bus = new FakeRedisBus();
    const mkHub = (origin: string) => {
      const hub = new RealtimeHub();
      hub.setFrameCodec(CBOR_FRAME_CODEC);
      const bp = new RedisBackplane(bus.transport(), origin);
      hub.setBackplane(bp);
      hub.markBroadcastChannel("media:");
      return { hub, bp };
    };
    const a = mkHub("pod-A");
    const b = mkHub("pod-B");
    await a.bp.start();
    await b.bp.start();
    const got: unknown[] = [];
    b.hub.subscribe(
      "media:room1",
      (p) => got.push(p),
      () => () => {},
    );
    const bytes = new Uint8Array([10, 20, 30, 255]);
    a.hub.publish("media:room1", bytes);
    expect(got).to.have.length(1);
    expect(got[0]).to.be.instanceOf(Uint8Array);
    expect(Array.from(got[0] as Uint8Array)).to.deep.equal([10, 20, 30, 255]);
  });
});
