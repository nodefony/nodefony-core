import { describe, it, expect } from "vitest";
import {
  RealtimeHub,
  SLOW_CONSUMER_BYTES,
} from "../../src/server/RealtimeHub.js";
import { LoopbackBackplane } from "../../src/backplane/LoopbackBackplane.js";
import type { RealtimePublish } from "../../interfaces/IRealtimeController.js";
import type { IRealtimeConnProbe } from "../../interfaces/IRealtimeProbe.js";
import type {
  IBackplane,
  IBackplaneMessage,
  BackplaneHandler,
  IBackplaneInfo,
} from "../../interfaces/IBackplane.js";

/**
 * Backplane factice : capture les publications sortantes et expose `deliver()` pour
 * simuler l'arrivée d'un message d'un AUTRE pair (ingress).
 */
class FakeBackplane implements IBackplane {
  readonly originId = "test-origin";
  started = 0;
  stopped = 0;
  published: Array<{ channel: string; payload: unknown }> = [];
  handler: BackplaneHandler | null = null;
  start(): void {
    this.started++;
  }
  stop(): void {
    this.stopped++;
  }
  publish(channel: string, payload: unknown): void {
    this.published.push({ channel, payload });
  }
  onMessage(handler: BackplaneHandler): void {
    this.handler = handler;
  }
  /** Simule un message reçu d'un autre pair (echo déjà filtré par l'impl réelle). */
  deliver(msg: IBackplaneMessage): void {
    this.handler?.(msg);
  }
  describe(): IBackplaneInfo {
    return {
      driver: "fake",
      kind: "fake",
      originId: this.originId,
      crossPod: false,
    };
  }
}

/** Connexion factice (sonde) : `bufferedAmount` mutable pour simuler un slow-consumer. */
function fakeConn(over: Partial<IRealtimeConnProbe> = {}): IRealtimeConnProbe {
  return {
    readyState: 1,
    bufferedAmount: 0,
    bytesSent: 0,
    messagesSent: 0,
    dropped: 0,
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

  it("backplane : descripteur `local` quand aucun backplane branché", () => {
    const p = new RealtimeHub().probe();
    expect(p.backplane).to.deep.include({
      driver: "loopback",
      kind: "local",
      crossPod: false,
    });
    expect(p.backplane?.originId).to.be.a("string");
  });

  it("backplane : reflète le driver branché (carte d'identité)", () => {
    const hub = new RealtimeHub();
    hub.setBackplane(new LoopbackBackplane("pid-Z"));
    const info = hub.probe().backplane!;
    expect(info).to.deep.equal({
      driver: "loopback",
      kind: "local",
      originId: "pid-Z",
      crossPod: false,
    });
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

/**
 * Backplane cross-process — le port {@link IBackplane} câblé au hub. Prouve le contrat
 * (publish = local + propagation ; ingress = local-only anti-boucle) avec un backplane
 * factice, AVANT toute impl IPC/Redis. C'est le test qui « stabilise l'archi ».
 */
describe("RealtimeHub — backplane cross-process (port IBackplane)", () => {
  const factory = (): (() => void) => () => {};

  it("mono-process : publish = fan-out local, aucun backplane branché", () => {
    const hub = new RealtimeHub();
    const got: unknown[] = [];
    hub.subscribe("ch", (p) => got.push(p), factory);
    hub.publish("ch", { v: 1 });
    expect(got).to.deep.equal([{ v: 1 }]);
    expect(hub.backplane).to.equal(null);
  });

  it("setBackplane : démarre le transport ; un canal BROADCAST fan-out local ET propage", () => {
    const hub = new RealtimeHub();
    const bp = new FakeBackplane();
    expect(hub.setBackplane(bp)).to.equal(bp); // chaînage
    expect(hub.backplane).to.equal(bp);
    expect(bp.started).to.equal(1); // start() câblé
    hub.markBroadcastChannel("ch"); // opt-in cross-process
    const got: unknown[] = [];
    hub.subscribe("ch", (p) => got.push(p), factory);
    hub.publish("ch", { v: 1 });
    expect(got).to.deep.equal([{ v: 1 }]); // fan-out local
    expect(bp.published).to.deep.equal([{ channel: "ch", payload: { v: 1 } }]); // propagé
  });

  it("ingress : message d'un pair = fan-out LOCAL, jamais re-propagé (anti-boucle)", () => {
    const hub = new RealtimeHub();
    const bp = new FakeBackplane();
    hub.setBackplane(bp);
    const got: unknown[] = [];
    hub.subscribe("ch", (p) => got.push(p), factory);
    bp.deliver({
      channel: "ch",
      payload: { fromPeer: true },
      originId: "other",
    });
    expect(got).to.deep.equal([{ fromPeer: true }]); // réinjecté localement
    expect(bp.published).to.deep.equal([]); // PAS re-propagé → 0 boucle
  });

  it("publishLocal ne propage JAMAIS au backplane (voie d'ingress)", () => {
    const hub = new RealtimeHub();
    const bp = new FakeBackplane();
    hub.setBackplane(bp);
    hub.subscribe("ch", () => {}, factory);
    hub.publishLocal("ch", 42);
    expect(bp.published).to.deep.equal([]);
  });

  it("clear() détache le backplane sans le stopper (lifecycle externe)", () => {
    const hub = new RealtimeHub();
    const bp = new FakeBackplane();
    hub.setBackplane(bp);
    hub.clear();
    expect(hub.backplane).to.equal(null);
    expect(bp.stopped).to.equal(0); // le hub n'est pas owner du backplane
  });
});

/**
 * Politique de forward PAR CANAL (Phase 4) — le forward backplane est **opt-in** :
 * défaut instance-local (sûreté Zero-Trust + correct pour tous les canaux per-instance),
 * un canal déclaré broadcast traverse le backplane (chat/présence/notifications).
 */
describe("RealtimeHub — politique de forward par canal (opt-in broadcast)", () => {
  const factory = (): (() => void) => () => {};

  it("DÉFAUT instance-local : un canal non déclaré ne propage PAS (fan-out local seul)", () => {
    const hub = new RealtimeHub();
    const bp = new FakeBackplane();
    hub.setBackplane(bp);
    const got: unknown[] = [];
    hub.subscribe("realtime:health:1000", (p) => got.push(p), factory);
    hub.publish("realtime:health:1000", { cpu: 1 });
    expect(got).to.deep.equal([{ cpu: 1 }]); // fan-out local OK
    expect(bp.published).to.deep.equal([]); // per-instance → JAMAIS cross-process
  });

  it("opt-in broadcast par PRÉFIXE : couvre le suffixe de cadence `:<ms>`", () => {
    const hub = new RealtimeHub();
    const bp = new FakeBackplane();
    hub.setBackplane(bp);
    hub.markBroadcastChannel("chat:");
    hub.subscribe("chat:room1:500", () => {}, factory);
    hub.publish("chat:room1:500", { msg: "hi" });
    expect(bp.published).to.deep.equal([
      { channel: "chat:room1:500", payload: { msg: "hi" } },
    ]);
  });

  it("ordre indifférent : markBroadcastChannel APRÈS subscribe réévalue le canal actif", () => {
    const hub = new RealtimeHub();
    const bp = new FakeBackplane();
    hub.setBackplane(bp);
    hub.subscribe("chat:room1", () => {}, factory); // abonné AVANT la déclaration
    hub.markBroadcastChannel("chat:"); // déclaration après → réévalue
    hub.publish("chat:room1", { msg: "ok" });
    expect(bp.published).to.deep.equal([
      { channel: "chat:room1", payload: { msg: "ok" } },
    ]);
  });

  it("publish SERVEUR sans abonné local : la politique broadcast est évaluée à la volée", () => {
    const hub = new RealtimeHub();
    const bp = new FakeBackplane();
    hub.setBackplane(bp);
    hub.markBroadcastChannel("chat:");
    hub.publish("chat:room1", { msg: "no-local-sub" }); // aucun subscribe ici
    expect(bp.published).to.deep.equal([
      { channel: "chat:room1", payload: { msg: "no-local-sub" } },
    ]);
  });

  it("mono-process : la politique n'a aucun effet observable (rien ne sort)", () => {
    const hub = new RealtimeHub();
    hub.markBroadcastChannel("chat:");
    const got: unknown[] = [];
    hub.subscribe("chat:room1", (p) => got.push(p), factory);
    hub.publish("chat:room1", { v: 1 });
    expect(got).to.deep.equal([{ v: 1 }]); // fan-out local intact
    expect(hub.backplane).to.equal(null);
  });

  it("clear() réinitialise la politique de forward", () => {
    const hub = new RealtimeHub();
    const bp = new FakeBackplane();
    hub.setBackplane(bp);
    hub.markBroadcastChannel("chat:");
    hub.clear();
    hub.setBackplane(bp);
    hub.subscribe("chat:room1", () => {}, factory);
    hub.publish("chat:room1", { v: 1 });
    expect(bp.published).to.deep.equal([]); // préfixe oublié → de nouveau local
  });
});

/**
 * LoopbackBackplane — impl de référence no-op (aucun pair). Brancher un backplane
 * Loopback ne change RIEN au comportement local : c'est la garantie du port.
 */
describe("LoopbackBackplane — no-op mono-process", () => {
  it("publish/onMessage/start/stop ne font rien et ne throw pas", () => {
    const bp = new LoopbackBackplane("pid-1");
    expect(bp.originId).to.equal("pid-1");
    let fired = 0;
    bp.onMessage(() => fired++);
    bp.start();
    bp.publish("ch", { v: 1 });
    bp.stop();
    expect(fired).to.equal(0); // aucun ingress ne fire jamais
  });

  it("originId par défaut = pid du process", () => {
    expect(new LoopbackBackplane().originId).to.equal(String(process.pid));
  });

  it("câblé au hub : se comporte comme le mono-process pur (0 propagation observable)", () => {
    const hub = new RealtimeHub();
    hub.setBackplane(new LoopbackBackplane());
    const got: unknown[] = [];
    hub.subscribe(
      "ch",
      (p) => got.push(p),
      () => () => {},
    );
    hub.publish("ch", { v: 1 });
    expect(got).to.deep.equal([{ v: 1 }]); // fan-out local intact, rien ne sort
  });
});
