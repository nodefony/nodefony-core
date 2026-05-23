import { expect } from "chai";
import "mocha";
import { RealtimeHub } from "../../src/RealtimeHub.js";
import type { RealtimePublish } from "../../interfaces/IRealtimeController.js";

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
