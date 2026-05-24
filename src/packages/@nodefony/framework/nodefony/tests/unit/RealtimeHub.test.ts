import { expect } from "chai";
import "mocha";
import { RealtimeHub, SLOW_CONSUMER_BYTES } from "../../src/RealtimeHub.js";
import type { RealtimePublish } from "../../interfaces/IRealtimeController.js";
import type { IRealtimeConnProbe } from "../../interfaces/IRealtimeProbe.js";

/** Connexion factice (sonde) : `bufferedAmount` mutable pour simuler un slow-consumer. */
function fakeConn(over: Partial<IRealtimeConnProbe> = {}): IRealtimeConnProbe {
  return {
    readyState: 1,
    bufferedAmount: 0,
    bytesSent: 0,
    messagesSent: 0,
    ...over,
  };
}

/**
 * RealtimeHub — broker des canaux PARTAGÉS côté serveur : 1 provider par canal/pod,
 * fan-out aux abonnés, dispose au dernier désabonné. Tests purs (pas de WS).
 */
describe("RealtimeHub — broker canaux partagés (fan-out + ref-count)", () => {
  it("provider créé UNE fois pour N abonnés ; publish fan-out à tous", () => {
    const hub = new RealtimeHub();
    let factoryCalls = 0;
    let pub: RealtimePublish | null = null;
    const factory = (_ch: string, publish: RealtimePublish): (() => void) => {
      factoryCalls++;
      pub = publish;
      return () => {};
    };
    const a: unknown[] = [];
    const b: unknown[] = [];
    hub.subscribe("ch", (p) => a.push(p), factory);
    hub.subscribe("ch", (p) => b.push(p), factory);
    expect(factoryCalls).to.equal(1); // provider PARTAGÉ entre les 2 abonnés
    expect(hub.subscriberCount("ch")).to.equal(2);
    pub!("ch", { v: 1 });
    expect(a).to.deep.equal([{ v: 1 }]);
    expect(b).to.deep.equal([{ v: 1 }]);
  });

  it("dispose au DERNIER désabonné, pas avant", () => {
    const hub = new RealtimeHub();
    let disposed = 0;
    const factory = (): (() => void) => () => {
      disposed++;
    };
    const s1 = (): void => {};
    const s2 = (): void => {};
    hub.subscribe("ch", s1, factory);
    hub.subscribe("ch", s2, factory);
    hub.unsubscribe("ch", s1);
    expect(disposed).to.equal(0); // encore 1 abonné
    expect(hub.subscriberCount("ch")).to.equal(1);
    hub.unsubscribe("ch", s2);
    expect(disposed).to.equal(1); // dernier → dispose
    expect(hub.activeChannels).to.deep.equal([]);
  });

  it("le 1ᵉʳ push immédiat du provider atteint le 1ᵉʳ abonné (sink inscrit avant factory)", () => {
    const hub = new RealtimeHub();
    const got: unknown[] = [];
    // provider qui publie DÈS sa création (cf createBrokerTicker : 1ᵉʳ tick immédiat).
    const factory = (ch: string, publish: RealtimePublish): (() => void) => {
      publish(ch, { first: true });
      return () => {};
    };
    hub.subscribe("ch", (p) => got.push(p), factory);
    expect(got).to.deep.equal([{ first: true }]);
  });

  it("canal inconnu (factory → null) → subscribe renvoie false, rien retenu", () => {
    const hub = new RealtimeHub();
    const ok = hub.subscribe(
      "bad",
      () => {},
      () => null,
    );
    expect(ok).to.equal(false);
    expect(hub.activeChannels).to.deep.equal([]);
    expect(hub.subscriberCount("bad")).to.equal(0);
  });

  it("clear() dispose tous les providers", () => {
    const hub = new RealtimeHub();
    let disposed = 0;
    const factory = (): (() => void) => () => {
      disposed++;
    };
    hub.subscribe("a", () => {}, factory);
    hub.subscribe("b", () => {}, factory);
    hub.clear();
    expect(disposed).to.equal(2);
    expect(hub.activeChannels).to.deep.equal([]);
  });
});

/**
 * Sonde « socket Nodefony » — auto-observabilité du hub : canaux/abonnés, fan-out,
 * connexions, backpressure (`bufferedAmount` = blocker #1). Tests purs (pas de WS).
 */
describe("RealtimeHub.probe — auto-observabilité (fan-out + backpressure)", () => {
  const factory = (): (() => void) => () => {};

  it("hub vide → snapshot à zéro (0 alloc)", () => {
    const p = new RealtimeHub().probe();
    expect(p.channels).to.deep.equal([]);
    expect(p.channelCount).to.equal(0);
    expect(p.publishTotal).to.equal(0);
    expect(p.fanoutTotal).to.equal(0);
    expect(p.connectionCount).to.equal(0);
    expect(p.backpressure.maxBufferedAmount).to.equal(0);
    expect(p.backpressure.slowConsumers).to.equal(0);
    expect(p.ts).to.be.a("number");
  });

  it("canaux : abonnés + publications cumulées par canal", () => {
    const hub = new RealtimeHub();
    let pub: RealtimePublish | null = null;
    hub.subscribe(
      "ch",
      () => {},
      (_c, p) => ((pub = p), () => {}),
    );
    hub.subscribe("ch", () => {}, factory); // 2ᵉ abonné, provider partagé
    pub!("ch", { v: 1 });
    pub!("ch", { v: 2 });
    const stat = hub.probe().channels.find((c) => c.channel === "ch")!;
    expect(stat.subscribers).to.equal(2);
    expect(stat.messages).to.equal(2); // 2 publish sur le canal
  });

  it("fan-out : publishTotal = appels, fanoutTotal = publish × abonnés", () => {
    const hub = new RealtimeHub();
    let pub: RealtimePublish | null = null;
    hub.subscribe(
      "ch",
      () => {},
      (_c, p) => ((pub = p), () => {}),
    );
    hub.subscribe("ch", () => {}, factory); // 2 abonnés
    pub!("ch", 1);
    pub!("ch", 2); // 2 publishes × 2 abonnés = 4 livraisons
    const p = hub.probe();
    expect(p.publishTotal).to.equal(2);
    expect(p.fanoutTotal).to.equal(4);
  });

  it("backpressure : max/total bufferedAmount + comptage slow-consumers", () => {
    const hub = new RealtimeHub();
    const slow = fakeConn({
      bufferedAmount: SLOW_CONSUMER_BYTES + 1,
      bytesSent: 10,
    });
    const ok = fakeConn({
      bufferedAmount: 2048,
      bytesSent: 5,
      messagesSent: 3,
    });
    hub.registerConnection(slow);
    hub.registerConnection(ok);
    const p = hub.probe();
    expect(p.connectionCount).to.equal(2);
    expect(p.backpressure.totalBufferedAmount).to.equal(
      SLOW_CONSUMER_BYTES + 1 + 2048,
    );
    expect(p.backpressure.maxBufferedAmount).to.equal(SLOW_CONSUMER_BYTES + 1);
    expect(p.backpressure.slowConsumers).to.equal(1); // seul `slow` dépasse le seuil
    expect(p.bytesSentTotal).to.equal(15);
    expect(p.messagesSentTotal).to.equal(3);
  });

  it("unregisterConnection retire du registre de la sonde", () => {
    const hub = new RealtimeHub();
    const c = fakeConn({ bufferedAmount: 100 });
    hub.registerConnection(c);
    expect(hub.probe().connectionCount).to.equal(1);
    hub.unregisterConnection(c);
    const p = hub.probe();
    expect(p.connectionCount).to.equal(0);
    expect(p.backpressure.totalBufferedAmount).to.equal(0);
  });

  it("recordInbound compte les frames full-duplex entrantes", () => {
    const hub = new RealtimeHub();
    hub.recordInbound();
    hub.recordInbound();
    expect(hub.probe().inboundTotal).to.equal(2);
  });

  it("clear() remet les compteurs et le registre à zéro", () => {
    const hub = new RealtimeHub();
    let pub: RealtimePublish | null = null;
    hub.subscribe(
      "ch",
      () => {},
      (_c, p) => ((pub = p), () => {}),
    );
    pub!("ch", 1);
    hub.registerConnection(fakeConn({ bufferedAmount: 50 }));
    hub.recordInbound();
    hub.clear();
    const p = hub.probe();
    expect(p.publishTotal).to.equal(0);
    expect(p.fanoutTotal).to.equal(0);
    expect(p.inboundTotal).to.equal(0);
    expect(p.connectionCount).to.equal(0);
    expect(p.channelCount).to.equal(0);
  });
});
