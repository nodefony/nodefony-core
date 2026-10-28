import { describe, it, expect } from "vitest";
import { RealtimeHub } from "../../src/server/RealtimeHub";
import type {
  BackplaneHandler,
  IBackplane,
  IBackplaneInfo,
} from "../../interfaces/IBackplane.js";

/**
 * Des octets ne traversent pas (encore) le bus entre serveurs — refusés, jamais déformés.
 *
 * SYMPTÔME : un `Uint8Array` publié sur un canal diffusé arrivait chez les abonnés
 * des AUTRES serveurs sous forme d'objet ordinaire (`{"0":1,"1":2}`) : Redis et
 * l'IPC du cluster sérialisent en JSON. Aucune erreur, aucun compteur ; le défaut
 * ne se voyait qu'en production multi-serveurs.
 *
 * RÈGLE (ADR-0021 S6/S8) : tant que le bus n'a pas de voie binaire (#618), des
 * octets restent sur le serveur qui les publie ; ses abonnés les reçoivent intacts,
 * et l'exploitant est prévenu UNE fois. Passer plus tard de « refusé » à « transporté »
 * est un ajout.
 */

class FakeBackplane implements IBackplane {
  readonly originId = "test";
  published: Array<{ channel: string; payload: unknown }> = [];
  start(): void {}
  stop(): void {}
  publish(channel: string, payload: unknown): void {
    this.published.push({ channel, payload });
  }
  onMessage(_h: BackplaneHandler): void {}
  describe(): IBackplaneInfo {
    return {
      driver: "fake",
      kind: "fake",
      originId: this.originId,
      crossPod: true,
    };
  }
}

function harness() {
  const hub = new RealtimeHub();
  const bp = new FakeBackplane();
  hub.setBackplane(bp);
  hub.markBroadcastChannel("media:");
  const notices: string[] = [];
  hub.onPlatformNotice((message) => notices.push(message));
  const local: unknown[] = [];
  hub.subscribe(
    "media:room1",
    (p) => local.push(p),
    () => () => {},
  );
  return { hub, bp, notices, local };
}

describe("hub — des octets ne partent pas déformés sur le bus", () => {
  it.each([
    ["Uint8Array", new Uint8Array([1, 2, 255])],
    ["vue DataView", new DataView(new ArrayBuffer(2))],
    ["ArrayBuffer", new ArrayBuffer(3)],
  ])("%s : livré aux abonnés locaux, jamais publié sur le bus", (_n, bytes) => {
    const { hub, bp, local } = harness();
    hub.publish("media:room1", bytes);
    expect(local).to.deep.equal([bytes]);
    expect(local[0]).to.equal(bytes);
    expect(bp.published).to.deep.equal([]);
  });

  it("prévient l'exploitant une seule fois, en nommant le canal", () => {
    const { hub, notices } = harness();
    hub.publish("media:room1", new Uint8Array([1]));
    hub.publish("media:room1", new Uint8Array([2]));
    expect(notices).to.have.length(1);
    expect(notices[0]).to.contain("media:room1");
    expect(notices[0]).to.contain("#618");
  });

  it("une charge JSON sur le même canal traverse toujours le bus", () => {
    const { hub, bp, notices } = harness();
    hub.publish("media:room1", { text: "bonjour" });
    expect(bp.published).to.deep.equal([
      { channel: "media:room1", payload: { text: "bonjour" } },
    ]);
    expect(notices).to.deep.equal([]);
  });

  it("canal local au serveur : des octets restent locaux sans avertissement", () => {
    const { hub, bp, notices } = harness();
    const got: unknown[] = [];
    hub.subscribe(
      "local:room",
      (p) => got.push(p),
      () => () => {},
    );
    hub.publish("local:room", new Uint8Array([7]));
    expect(got).to.have.length(1);
    expect(bp.published).to.deep.equal([]);
    expect(notices).to.deep.equal([]);
  });
});
