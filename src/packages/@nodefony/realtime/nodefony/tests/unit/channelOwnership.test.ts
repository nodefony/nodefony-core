import { describe, it, expect } from "vitest";
import { RealtimeHub } from "../../src/server/RealtimeHub.js";
import { ServerRealtimeSocket } from "../../src/server/ServerRealtimeSocket.js";
import { LoopbackBackplane } from "../../src/backplane/LoopbackBackplane.js";
import type { RealtimePublish } from "../../interfaces/IRealtimeController.js";

/** Fabrique qui ne connaît AUCUN canal — le cas « canal inconnu du controller ». */
const unknownChannel = (): null => null;

/**
 * Propriété d'un canal (F93) — un canal appartient à qui fournit son **provider**.
 *
 * Un service serveur qui ÉCOUTE (`ServerRealtimeSocket.subscribe`) crée un état
 * **passif** : il reçoit ce qui passe, mais n'ouvre pas le canal au réseau. La
 * fabrique du controller reste l'unique porte d'entrée d'une connexion cliente.
 */
describe("RealtimeHub — propriété d'un canal (écoute passive vs provider)", () => {
  it("un service qui écoute ne rend PAS le canal abonnable par une connexion cliente", () => {
    const hub = new RealtimeHub();
    const back = new ServerRealtimeSocket(hub);
    back.subscribe("ghost:1"); // le service écoute un canal que personne ne produit
    const ok = hub.subscribeClient("ghost:1", () => {}, unknownChannel);
    expect(ok).to.equal(false); // la fabrique tranche, pas l'écouteur
    expect(hub.isChannelOwned("ghost:1")).to.equal(false);
  });

  it("le refus de la fabrique ne casse pas l'écoute déjà en place", () => {
    const hub = new RealtimeHub();
    const back = new ServerRealtimeSocket(hub);
    const heard: unknown[] = [];
    back.on("ghost:2", (p) => heard.push(p));
    back.subscribe("ghost:2");
    hub.subscribeClient("ghost:2", () => {}, unknownChannel); // refusé
    hub.publish("ghost:2", { v: 1 }); // un autre service publie quand même
    expect(heard).to.deep.equal([{ v: 1 }]); // l'écouteur est toujours branché
  });

  it("une connexion cliente sur un canal passif RÉVEILLE la fabrique : le canal s'ouvre", () => {
    const hub = new RealtimeHub();
    const back = new ServerRealtimeSocket(hub);
    const heard: unknown[] = [];
    back.on("live:1", (p) => heard.push(p));
    back.subscribe("live:1");
    expect(hub.isChannelOwned("live:1")).to.equal(false);

    let pub: RealtimePublish | null = null;
    const client: unknown[] = [];
    const ok = hub.subscribeClient(
      "live:1",
      (p) => client.push(p),
      (_ch, publish) => {
        pub = publish;
        return () => {};
      },
    );
    expect(ok).to.equal(true);
    expect(hub.isChannelOwned("live:1")).to.equal(true);

    pub!("live:1", { v: 7 }); // le provider pousse
    expect(client).to.deep.equal([{ v: 7 }]); // le client reçoit
    expect(heard).to.deep.equal([{ v: 7 }]); // l'écouteur serveur aussi
  });

  it("la fabrique n'est PAS rejouée sur un canal déjà ouvert (provider partagé)", () => {
    const hub = new RealtimeHub();
    let calls = 0;
    const factory = (): (() => void) => {
      calls++;
      return () => {};
    };
    hub.subscribeClient("live:2", () => {}, factory);
    hub.subscribeClient("live:2", () => {}, factory);
    new ServerRealtimeSocket(hub).subscribe("live:2"); // un service rejoint après
    expect(calls).to.equal(1);
    expect(hub.subscriberCount("live:2")).to.equal(3);
  });

  it("l'écoute passive ne laisse ni provider ni état après désabonnement", () => {
    const hub = new RealtimeHub();
    const back = new ServerRealtimeSocket(hub);
    back.subscribe("ghost:3");
    expect(hub.subscriberCount("ghost:3")).to.equal(1);
    expect(() => back.unsubscribe("ghost:3")).to.not.throw(); // dispose null-safe
    expect(hub.subscriberCount("ghost:3")).to.equal(0);
    expect(hub.isChannelOwned("ghost:3")).to.equal(false);
  });

  it("le provider survit au départ du client tant qu'un service écoute encore", () => {
    const hub = new RealtimeHub();
    const back = new ServerRealtimeSocket(hub);
    back.subscribe("live:3");
    let disposed = 0;
    const sink = (): void => {};
    hub.subscribeClient("live:3", sink, () => () => {
      disposed++;
    });
    hub.unsubscribe("live:3", sink); // le client part
    expect(disposed).to.equal(0); // l'écouteur serveur consomme toujours
    back.unsubscribe("live:3"); // dernier consommateur
    expect(disposed).to.equal(1);
  });
});

/**
 * Ce qu'un canal passif ne doit PAS pouvoir devenir : une porte dérobée. Écouter
 * est la plus faible des demandes — elle ne doit franchir aucune barrière que
 * `subscribe` franchit, ni en ouvrir une pour un tiers.
 */
describe("RealtimeHub — l'écoute passive n'ouvre aucune porte", () => {
  it("écouter un canal de PLATEFORME ne le rend pas servable au réseau (plancher intact)", () => {
    const hub = new RealtimeHub();
    new ServerRealtimeSocket(hub).subscribe("nodefony:syslog"); // service interne
    // Aucun module de sécurité (pas de verrou de frame) → plancher système actif.
    const ok = hub.subscribeClient(
      "nodefony:syslog",
      () => {},
      () => () => {},
    );
    expect(ok).to.equal(false);
    expect(hub.isClosedBySystemFloor("nodefony:syslog")).to.equal(true);
    expect(hub.probe().systemFloorDeniedTotal).to.equal(1);
  });

  it("le réveil d'un canal passif consulte AUSSI le registre des canaux système", () => {
    const hub = new RealtimeHub();
    hub.setFrameAuthorizer(() => true); // security présent → plancher levé
    let sysCalls = 0;
    hub.registerSystemChannel("nodefony:audit", () => {
      sysCalls++;
      return () => {};
    });
    new ServerRealtimeSocket(hub).subscribe("nodefony:audit"); // écoute d'abord
    const ok = hub.subscribeClient("nodefony:audit", () => {}, unknownChannel);
    expect(ok).to.equal(true); // le dernier recours a bien été consulté au réveil
    expect(sysCalls).to.equal(1);
    expect(hub.isChannelOwned("nodefony:audit")).to.equal(true);
  });

  it("un refus au réveil ne laisse ni sink orphelin ni canal owned", () => {
    const hub = new RealtimeHub();
    const back = new ServerRealtimeSocket(hub);
    back.subscribe("ghost:4");
    expect(hub.subscriberCount("ghost:4")).to.equal(1);
    for (let i = 0; i < 5; i++) {
      expect(hub.subscribeClient("ghost:4", () => {}, unknownChannel)).to.equal(
        false,
      );
    }
    expect(hub.subscriberCount("ghost:4")).to.equal(1); // aucun sink accumulé
    expect(hub.isChannelOwned("ghost:4")).to.equal(false);
  });

  it("deux services écoutent le même canal : ref-count indépendant", () => {
    const hub = new RealtimeHub();
    const a = new ServerRealtimeSocket(hub);
    const b = new ServerRealtimeSocket(hub);
    const heardA: unknown[] = [];
    const heardB: unknown[] = [];
    a.on("ghost:5", (p) => heardA.push(p));
    b.on("ghost:5", (p) => heardB.push(p));
    a.subscribe("ghost:5");
    b.subscribe("ghost:5");
    expect(hub.subscriberCount("ghost:5")).to.equal(2);
    a.unsubscribe("ghost:5");
    hub.publish("ghost:5", { v: 1 });
    expect(heardA).to.deep.equal([]);
    expect(heardB).to.deep.equal([{ v: 1 }]);
  });

  it("isChannelOwned d'un canal jamais vu = false (pas d'alloc, pas de crash)", () => {
    const hub = new RealtimeHub();
    expect(hub.isChannelOwned("jamais-vu")).to.equal(false);
    expect(hub.probe().channels).to.deep.equal([]);
  });

  it("la mutualisation de frame s'active au réveil (sérialiseur du client apporté)", () => {
    const hub = new RealtimeHub();
    new ServerRealtimeSocket(hub).subscribe("live:4"); // passif, sans sérialiseur
    let serializeCalls = 0;
    const seen: Array<string | undefined> = [];
    let pub: RealtimePublish | null = null;
    const serialize = (p: unknown): string => {
      serializeCalls++;
      return JSON.stringify(p);
    };
    hub.subscribeClient(
      "live:4",
      (_p, raw) => seen.push(raw),
      (_ch, publish) => {
        pub = publish;
        return () => {};
      },
      serialize,
    );
    hub.subscribeClient(
      "live:4",
      (_p, raw) => seen.push(raw),
      () => () => {},
    );
    pub!("live:4", { v: 1 });
    expect(serializeCalls).to.equal(1); // une seule fois pour tous les abonnés
    expect(seen).to.contain('{"v":1}');
  });
});

/**
 * Cluster : un canal passif reçoit l'ingress du backplane (un service écoute un
 * flux produit par un AUTRE pod), sans pour autant devenir servable au réseau.
 */
describe("RealtimeHub — écoute passive et backplane", () => {
  it("un service entend un canal broadcast produit par un autre pod", () => {
    const hub = new RealtimeHub();
    const bp = new LoopbackBackplane();
    hub.markBroadcastChannel("chat:");
    hub.setBackplane(bp);
    const back = new ServerRealtimeSocket(hub);
    const heard: unknown[] = [];
    back.on("chat:room1", (p) => heard.push(p));
    back.subscribe("chat:room1");
    hub.publishLocal("chat:room1", { from: "pod-b" }); // voie d'ingress
    expect(heard).to.deep.equal([{ from: "pod-b" }]);
    expect(hub.isChannelOwned("chat:room1")).to.equal(false); // toujours passif
  });

  it("markBroadcastChannel réévalue AUSSI les canaux passifs déjà ouverts", () => {
    const hub = new RealtimeHub();
    const bp = new LoopbackBackplane();
    hub.setBackplane(bp);
    new ServerRealtimeSocket(hub).subscribe("chat:late"); // passif AVANT la déclaration
    hub.markBroadcastChannel("chat:");
    let forwarded = 0;
    const spy = new LoopbackBackplane();
    spy.publish = (): void => {
      forwarded++;
    };
    hub.setBackplane(spy);
    hub.publish("chat:late", { v: 1 });
    expect(forwarded).to.equal(1); // le canal passif a bien hérité du forward
  });
});
