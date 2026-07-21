import { describe, it, expect, beforeEach } from "vitest";
import { RealtimeHub } from "../../src/server/RealtimeHub";
import {
  RealtimeBroadcast,
  getDeclaredBroadcastPrefixes,
  applyDeclaredBroadcastPrefixes,
} from "../../decorators/realtimeDecorators";
import type {
  BackplaneHandler,
  IBackplane,
  IBackplaneInfo,
} from "../../interfaces/IBackplane.js";

/**
 * Déclaration STATIQUE des canaux broadcast — trouvé sur un banc multi-pods réel.
 *
 * SYMPTÔME : un pod publiait sur un canal broadcast et **rien** n'arrivait aux
 * clients des autres pods. Silencieusement : ni erreur, ni compteur.
 *
 * CAUSE : la politique de forward est une propriété **statique** du controller
 * (le développeur la déclare une fois pour toutes), mais elle n'était enregistrée
 * sur le hub qu'au **handshake d'un client** de cet endpoint. Un pod qui publie
 * sans abonné local — job planifié, webhook entrant, worker — n'avait donc jamais
 * déclaré ses préfixes : `publish` évaluait « pas broadcast » et ne forwardait pas.
 * Deux pods identiques se comportaient différemment selon leur historique de
 * connexions.
 *
 * CORRECTIF : `@RealtimeBroadcast` déclare les préfixes à l'IMPORT de la classe ;
 * le service les applique au hub au boot, avant tout trafic.
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

// Déclaration à l'IMPORT — aucune instance, aucune connexion.
@RealtimeBroadcast("chat:", "presence:")
class ChatEndpoint {}

@RealtimeBroadcast("chat:") // même préfixe qu'au-dessus → dédoublonné
class OtherEndpoint {}

describe("déclaration statique des canaux broadcast", () => {
  let hub: RealtimeHub;

  beforeEach(() => {
    hub = new RealtimeHub();
  });

  it("le décorateur enregistre les préfixes à l'import, sans instancier", () => {
    // Les classes ci-dessus ne sont jamais instanciées.
    void ChatEndpoint;
    void OtherEndpoint;
    const declared = getDeclaredBroadcastPrefixes();
    expect(declared).to.include("chat:");
    expect(declared).to.include("presence:");
    expect(declared.filter((p) => p === "chat:")).to.have.lengthOf(1); // dédoublonné
  });

  it("SANS application : un pod sans client ne forwarde pas (le bug d'origine)", () => {
    const bp = new FakeBackplane();
    hub.setBackplane(bp);

    hub.publish("chat:room1", { msg: "personne ne me verra ailleurs" });

    expect(bp.published).to.deep.equal([]);
  });

  it("APRÈS application au boot : le forward marche sans qu'aucun client ne se connecte", () => {
    const bp = new FakeBackplane();
    hub.setBackplane(bp);
    applyDeclaredBroadcastPrefixes(hub);

    hub.publish("chat:room1", { msg: "publication serveur" });
    hub.publish("presence:room1", { online: 3 });
    hub.publish("interne:stats", { cpu: 1 }); // non déclaré → reste local

    expect(bp.published).to.deep.equal([
      { channel: "chat:room1", payload: { msg: "publication serveur" } },
      { channel: "presence:room1", payload: { online: 3 } },
    ]);
  });

  it("l'ingress admet les canaux déclarés dès le boot (symétrie entrée/sortie)", () => {
    // Sans cette application, un pod fraîchement démarré REFUSERAIT les messages
    // légitimes de ses pairs jusqu'à ce qu'un client s'y connecte.
    const bp = new FakeBackplane();
    hub.setBackplane(bp);
    applyDeclaredBroadcastPrefixes(hub);
    const got: unknown[] = [];
    hub.subscribe(
      "chat:room1",
      (p) => got.push(p),
      () => () => {},
    );

    hub.publishLocal("chat:room1", { fromPeer: true });

    expect(got).to.deep.equal([{ fromPeer: true }]);
    expect(hub.probe().ingressRejectedTotal).to.equal(0);
  });

  it("application idempotente (rejouable sans dupliquer la politique)", () => {
    const bp = new FakeBackplane();
    hub.setBackplane(bp);
    applyDeclaredBroadcastPrefixes(hub);
    applyDeclaredBroadcastPrefixes(hub);

    hub.publish("chat:room1", 1);

    expect(bp.published).to.have.lengthOf(1); // 1 publication = 1 forward
  });
});
