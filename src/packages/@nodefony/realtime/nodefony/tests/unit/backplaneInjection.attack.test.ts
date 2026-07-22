import { describe, it, expect } from "vitest";
import { RealtimeHub } from "../../src/server/RealtimeHub";
import {
  RedisBackplane,
  REDIS_RT_CHANNEL,
  type IRedisBackplaneTransport,
} from "../../src/backplane/RedisBackplane.js";
import {
  openBackplaneEnvelope,
  sealBackplaneEnvelope,
} from "../../src/backplane/envelope.js";
import type {
  BackplaneHandler,
  IBackplane,
  IBackplaneInfo,
  IBackplaneMessage,
} from "../../interfaces/IBackplane.js";

/**
 * Phase 0.6 — REVUE TOTALE realtime, **F83 : le backplane n'authentifiait RIEN**.
 *
 * FAILLE : l'ingress backplane (`setBackplane` → `publishLocal`) réinjectait tout
 * message reçu, sur **n'importe quel canal**, sans vérifier ni la politique de canal
 * ni l'origine du message. Deux conséquences, prouvées ci-dessous :
 *
 *  1. **Asymétrie de politique** (tous drivers) — le forward est opt-in en SORTIE
 *     (`publish` ne traverse le backplane que pour un canal déclaré broadcast) mais
 *     l'ENTRÉE acceptait tout : un pair pouvait pousser sur `syslog:`,
 *     `nodefony:audit` ou `nodefony:socket` — des canaux **instance-local** que la
 *     politique refuse justement de faire voyager.
 *  2. **Bus non authentifié** (drivers à transport PARTAGÉ, ex. Redis) — quiconque
 *     écrit dans le Redis publiait sur les canaux de **tous** les pods.
 *
 * FIX (blue) : (1) admission par canal à l'ingress dans le hub — seul un canal
 * déclaré broadcast est réinjecté, le rejet est compté (`ingressRejectedTotal`) ;
 * (2) enveloppe **scellée HMAC-SHA256** pour les transports partagés — secret posé
 * ⇒ fail-closed strict (non signé ou mal signé = rejeté, aucun downgrade).
 */

const factory = (): (() => void) => () => {};

/** Backplane factice pilotable : `deliver` simule un message venu d'un autre pair. */
class PeerBackplane implements IBackplane {
  readonly originId = "peer-attacker";
  published: Array<{ channel: string; payload: unknown }> = [];
  #handler: BackplaneHandler | null = null;
  start(): void {}
  stop(): void {}
  publish(channel: string, payload: unknown): void {
    this.published.push({ channel, payload });
  }
  onMessage(handler: BackplaneHandler): void {
    this.#handler = handler;
  }
  deliver(msg: IBackplaneMessage): void {
    this.#handler?.(msg);
  }
  describe(): IBackplaneInfo {
    return {
      driver: "peer",
      kind: "fake",
      originId: this.originId,
      crossPod: true,
    };
  }
}

describe("0.6 F83 (a) — hub : admission par canal à l'ingress backplane", () => {
  it("ATTAQUE : un pair pousse sur un canal SYSTÈME non broadcast → aucun fan-out local", () => {
    const hub = new RealtimeHub();
    const bp = new PeerBackplane();
    hub.setBackplane(bp);
    const got: unknown[] = [];
    hub.subscribe("nodefony:audit", (p) => got.push(p), factory);

    bp.deliver({
      channel: "nodefony:audit",
      payload: { forged: "faux évènement d'audit" },
      originId: "peer-attacker",
    });

    expect(got).to.deep.equal([]); // fail-closed : rien n'atteint les abonnés locaux
  });

  it("ATTAQUE : canal d'observabilité per-instance (`nodefony:socket`) → rejeté aussi", () => {
    const hub = new RealtimeHub();
    const bp = new PeerBackplane();
    hub.setBackplane(bp);
    const got: unknown[] = [];
    hub.subscribe("nodefony:socket:1000", (p) => got.push(p), factory);

    bp.deliver({
      channel: "nodefony:socket:1000",
      payload: { cpu: 0 },
      originId: "peer-attacker",
    });

    expect(got).to.deep.equal([]);
  });

  it("les rejets d'ingress sont COMPTÉS dans la sonde (fail-loud, observable)", () => {
    const hub = new RealtimeHub();
    const bp = new PeerBackplane();
    hub.setBackplane(bp);
    expect(hub.probe().ingressRejectedTotal).to.equal(0);

    bp.deliver({ channel: "syslog:", payload: 1, originId: "x" });
    bp.deliver({ channel: "lobby:x", payload: 2, originId: "x" });

    expect(hub.probe().ingressRejectedTotal).to.equal(2);
  });

  it("NOMINAL : un canal déclaré broadcast traverse toujours l'ingress", () => {
    const hub = new RealtimeHub();
    const bp = new PeerBackplane();
    hub.setBackplane(bp);
    hub.markBroadcastChannel("chat:");
    const got: unknown[] = [];
    hub.subscribe("chat:room1:500", (p) => got.push(p), factory);

    bp.deliver({
      channel: "chat:room1:500",
      payload: { msg: "hi" },
      originId: "peer-b",
    });

    expect(got).to.deep.equal([{ msg: "hi" }]); // fan-out local
    expect(bp.published).to.deep.equal([]); // jamais re-propagé (anti-boucle)
    expect(hub.probe().ingressRejectedTotal).to.equal(0);
  });

  it("clear() remet le compteur de rejets à zéro (cycle de vie du hub)", () => {
    const hub = new RealtimeHub();
    const bp = new PeerBackplane();
    hub.setBackplane(bp);
    bp.deliver({ channel: "syslog:", payload: 1, originId: "x" });
    expect(hub.probe().ingressRejectedTotal).to.equal(1);
    hub.clear();
    expect(hub.probe().ingressRejectedTotal).to.equal(0);
  });
});

/**
 * Bus Redis en mémoire — un `transport()` = un pod abonné au canal partagé.
 * `inject()` simule un TIERS qui écrit directement dans le Redis (l'attaquant :
 * autre app sur un Redis mutualisé, credential fuité, SSRF…).
 */
class SharedBus {
  readonly #subs = new Set<(m: string) => void>();
  transport(): IRedisBackplaneTransport {
    const bus = this;
    let mine: ((m: string) => void) | null = null;
    return {
      publish(_channel, message): void {
        bus.#subs.forEach((l) => l(message));
      },
      subscribe(_channel, onMessage): void {
        mine = onMessage;
        bus.#subs.add(onMessage);
      },
      unsubscribe(): void {
        if (mine) bus.#subs.delete(mine);
        mine = null;
      },
    };
  }
  /** Écriture brute d'un tiers sur le bus (aucun backplane derrière). */
  inject(raw: string): void {
    this.#subs.forEach((l) => l(raw));
  }
}

const SECRET = "s3cr3t-backplane-nodefony-0123456789abcdef";

describe("0.6 F83 (b) — Redis : enveloppe scellée (transport partagé)", () => {
  it("ATTAQUE : message forgé NON SIGNÉ ignoré quand un secret est posé (0 downgrade)", async () => {
    const bus = new SharedBus();
    const bp = new RedisBackplane(
      bus.transport(),
      "pod-1",
      REDIS_RT_CHANNEL,
      SECRET,
    );
    const received: IBackplaneMessage[] = [];
    bp.onMessage((m) => received.push(m));
    await bp.start();

    bus.inject(
      JSON.stringify({
        channel: "chat:room1",
        payload: { msg: "je suis l'admin" },
        originId: "pod-99",
      }),
    );

    expect(received).to.deep.equal([]);
  });

  it("ATTAQUE : charge ALTÉRÉE après signature → sceau invalide → ignorée", async () => {
    const bus = new SharedBus();
    const bp = new RedisBackplane(
      bus.transport(),
      "pod-1",
      REDIS_RT_CHANNEL,
      SECRET,
    );
    const received: IBackplaneMessage[] = [];
    bp.onMessage((m) => received.push(m));
    await bp.start();

    const sealed = JSON.parse(
      sealBackplaneEnvelope(
        { channel: "chat:room1", payload: { msg: "hi" }, originId: "pod-2" },
        SECRET,
      ),
    ) as Record<string, unknown>;
    sealed.payload = { msg: "charge remplacée" }; // tamper, sceau inchangé
    bus.inject(JSON.stringify(sealed));

    expect(received).to.deep.equal([]);
  });

  it("ATTAQUE : CANAL repointé après signature → sceau invalide → ignoré", async () => {
    const bus = new SharedBus();
    const bp = new RedisBackplane(
      bus.transport(),
      "pod-1",
      REDIS_RT_CHANNEL,
      SECRET,
    );
    const received: IBackplaneMessage[] = [];
    bp.onMessage((m) => received.push(m));
    await bp.start();

    const sealed = JSON.parse(
      sealBackplaneEnvelope(
        { channel: "chat:room1", payload: { msg: "hi" }, originId: "pod-2" },
        SECRET,
      ),
    ) as Record<string, unknown>;
    sealed.channel = "nodefony:audit"; // repointage de canal
    bus.inject(JSON.stringify(sealed));

    expect(received).to.deep.equal([]);
  });

  it("ATTAQUE : secret DIFFÉRENT (pod mal configuré / attaquant) → rien ne passe", async () => {
    const bus = new SharedBus();
    const emitter = new RedisBackplane(
      bus.transport(),
      "pod-1",
      REDIS_RT_CHANNEL,
      "un-autre-secret-totalement-different",
    );
    const receiver = new RedisBackplane(
      bus.transport(),
      "pod-2",
      REDIS_RT_CHANNEL,
      SECRET,
    );
    const received: IBackplaneMessage[] = [];
    receiver.onMessage((m) => received.push(m));
    await emitter.start();
    await receiver.start();

    emitter.publish("chat:room1", { msg: "hi" });

    expect(received).to.deep.equal([]); // fail-closed, jamais accepté « au cas où »
  });

  it("NOMINAL : deux pods au MÊME secret échangent normalement (sceau valide)", async () => {
    const bus = new SharedBus();
    const emitter = new RedisBackplane(
      bus.transport(),
      "pod-1",
      REDIS_RT_CHANNEL,
      SECRET,
    );
    const receiver = new RedisBackplane(
      bus.transport(),
      "pod-2",
      REDIS_RT_CHANNEL,
      SECRET,
    );
    const received: IBackplaneMessage[] = [];
    receiver.onMessage((m) => received.push(m));
    await emitter.start();
    await receiver.start();

    emitter.publish("chat:room1", { msg: "hi" });

    expect(received).to.deep.equal([
      { channel: "chat:room1", payload: { msg: "hi" }, originId: "pod-1" },
    ]);
  });

  it("l'anti-echo reste actif avec sceau (l'émetteur ignore son propre message)", async () => {
    const bus = new SharedBus();
    const bp = new RedisBackplane(
      bus.transport(),
      "pod-1",
      REDIS_RT_CHANNEL,
      SECRET,
    );
    const received: IBackplaneMessage[] = [];
    bp.onMessage((m) => received.push(m));
    await bp.start();

    bp.publish("chat:room1", { msg: "mine" }); // Redis renvoie à l'émetteur

    expect(received).to.deep.equal([]);
  });

  it("PERF : la charge n'est sérialisée QU'UNE fois par publication scellée", () => {
    // Le sceau et l'enveloppe partagent le même fragment JSON. Une seconde
    // sérialisation se paierait à CHAQUE message d'un canal de fan-out — d'où
    // ce garde-fou structurel (compteur d'appels), pas un chronomètre.
    let serializations = 0;
    const payload = {
      toJSON(): unknown {
        serializations += 1;
        return { msg: "hi" };
      },
    };

    const raw = sealBackplaneEnvelope(
      { channel: "chat:room1", payload, originId: "pod-1" },
      SECRET,
    );

    expect(serializations).to.equal(1);
    // …et l'enveloppe produite reste un JSON valide, scellé, ouvrable.
    expect(openBackplaneEnvelope(raw, SECRET)).to.deep.equal({
      channel: "chat:room1",
      payload: { msg: "hi" },
      originId: "pod-1",
    });
  });

  it("une charge `undefined` est transportée comme `null` (JSON n'a pas d'undefined)", () => {
    const raw = sealBackplaneEnvelope(
      { channel: "chat:room1", payload: undefined, originId: "pod-1" },
      SECRET,
    );
    expect(openBackplaneEnvelope(raw, SECRET)).to.deep.equal({
      channel: "chat:room1",
      payload: null,
      originId: "pod-1",
    });
  });

  it("caractères hostiles dans le canal : le sceau tient (fragments échappés)", () => {
    // Le séparateur du sceau est `\n` : un canal qui en contient ne doit pas
    // permettre de décaler les frontières et de faire passer un autre triplet.
    const channel = 'chat:"\n:evil';
    const raw = sealBackplaneEnvelope(
      { channel, payload: { a: 1 }, originId: "pod-1" },
      SECRET,
    );
    expect(openBackplaneEnvelope(raw, SECRET)?.channel).to.equal(channel);
  });

  it("SANS secret : le transport reste ouvert (compat) — l'alerte de boot est ailleurs", async () => {
    const bus = new SharedBus();
    const emitter = new RedisBackplane(bus.transport(), "pod-1");
    const receiver = new RedisBackplane(bus.transport(), "pod-2");
    const received: IBackplaneMessage[] = [];
    receiver.onMessage((m) => received.push(m));
    await emitter.start();
    await receiver.start();

    emitter.publish("chat:room1", { msg: "hi" });

    expect(received).to.have.length(1);
  });
});
