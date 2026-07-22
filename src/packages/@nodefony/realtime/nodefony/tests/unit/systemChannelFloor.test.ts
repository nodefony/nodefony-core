import { describe, it, expect } from "vitest";
import {
  RealtimeHub,
  RESERVED_SYSTEM_PREFIXES,
} from "../../src/server/RealtimeHub.js";
import type { IRealtimeToken } from "../../interfaces/IRealtimeToken.js";

/**
 * **Plancher des canaux de plateforme, sans module de sécurité (F82 cas 2).**
 *
 * Les namespaces réservés (`syslog:`, `orm:`, `kernel:`…) exposent l'état interne
 * du pod. Quand `@nodefony/security` est chargé, c'est lui qui décide qui y accède.
 * Quand il est ABSENT, personne ne pose de verrou : `runAuthorizer` laissait alors
 * tout passer, et ces canaux devenaient des canaux ordinaires servis au premier
 * venu — sans qu'aucune alerte ne se déclenche, l'alerte existante exigeant qu'une
 * politique ait été déclarée.
 *
 * Choix : **fermer** plutôt qu'ouvrir. Sans module de sécurité, aucune identité
 * n'existe, donc personne ne peut légitimement prouver qu'il est administrateur —
 * le seul état sûr est le refus. Les canaux applicatifs, eux, ne sont pas concernés.
 */

/** Abonnement client sur un canal, tel que le demande une connexion. */
function abonne(hub: RealtimeHub, channel: string): boolean {
  return hub.subscribeClient(
    channel,
    () => {},
    () => () => {},
  );
}

describe("Plancher système — aucun module de sécurité chargé", () => {
  it("REFUSE un canal de plateforme (fail-closed)", () => {
    const hub = new RealtimeHub();
    expect(abonne(hub, "syslog:stream")).to.equal(false);
    expect(abonne(hub, "orm:health")).to.equal(false);
    expect(abonne(hub, "kernel:gc")).to.equal(false);
  });

  it("laisse passer un canal APPLICATIF (on ne casse pas les apps)", () => {
    const hub = new RealtimeHub();
    expect(abonne(hub, "chat:room1")).to.equal(true);
  });

  it("n'est pas contournable par la casse", () => {
    const hub = new RealtimeHub();
    expect(abonne(hub, "SYSLOG:stream")).to.equal(false);
    expect(abonne(hub, "Orm:Health")).to.equal(false);
  });

  it("compte les refus (le silence n'est pas une option)", () => {
    const hub = new RealtimeHub();
    abonne(hub, "syslog:stream");
    abonne(hub, "orm:health");
    expect(hub.probe().systemFloorDeniedTotal).to.equal(2);
  });

  it("CONTRÔLE NÉGATIF — avec un verrou posé, le plancher s'efface", () => {
    const hub = new RealtimeHub();
    // Un module de sécurité est là : c'est LUI qui décide, pas le plancher.
    hub.setFrameAuthorizer(() => true);
    expect(abonne(hub, "syslog:stream")).to.equal(true);
    expect(hub.probe().systemFloorDeniedTotal).to.equal(0);
  });

  it("l'abonnement SERVEUR (hors connexion cliente) n'est pas concerné", () => {
    const hub = new RealtimeHub();
    // Un service interne qui écoute ses propres logs n'est pas un client distant.
    expect(
      hub.subscribe(
        "syslog:stream",
        () => {},
        () => () => {},
      ),
    ).to.equal(true);
  });

  it("sait DIRE pourquoi il a refusé (le client doit pouvoir l'expliquer)", () => {
    const hub = new RealtimeHub();
    expect(hub.isClosedBySystemFloor("syslog:stream")).to.equal(true);
    expect(hub.isClosedBySystemFloor("chat:room1")).to.equal(false);
    // Lecture PURE : consulter la raison ne compte pas un refus de plus.
    expect(hub.probe().systemFloorDeniedTotal).to.equal(0);
    hub.setFrameAuthorizer(() => true);
    expect(hub.isClosedBySystemFloor("syslog:stream")).to.equal(false);
  });

  it("expose la liste des namespaces réservés (source unique pour security)", () => {
    expect(RESERVED_SYSTEM_PREFIXES).to.include("syslog:");
    expect(RESERVED_SYSTEM_PREFIXES).to.include("security:");
    expect(RESERVED_SYSTEM_PREFIXES.every((p) => p.endsWith(":"))).to.equal(
      true,
    );
  });

  it("signale une SEULE fois qu'il ferme les canaux de plateforme", () => {
    const hub = new RealtimeHub();
    const alertes: string[] = [];
    hub.onPlatformNotice((m) => alertes.push(m));
    abonne(hub, "syslog:stream");
    abonne(hub, "orm:health");
    abonne(hub, "kernel:gc");
    expect(alertes).to.have.lengthOf(1);
    expect(alertes[0]).to.match(/s[ée]curit[ée]/i);
    // Le message doit aussi évoquer la 2ᵉ cause possible : un canal applicatif
    // qui porte par erreur un préfixe réservé. Sinon l'auteur cherche du côté
    // de la sécurité alors qu'il lui suffit de renommer.
    expect(alertes[0]).to.match(/renommer|pr[ée]fixe/i);
  });
});

/**
 * **Prévenir à la DÉCLARATION, pas à l'échec.** Un développeur qui nomme son canal
 * `syslog:commandes` ne découvre le problème qu'au moment où ses utilisateurs sont
 * refusés — sur un canal qui est pourtant le sien. L'avertissement doit tomber
 * quand il déclare, là où le nom se corrige d'un caractère.
 */
describe("Namespaces réservés — avertir celui qui les utilise", () => {
  it("déclarer une politique sur un namespace réservé AVERTIT", () => {
    const hub = new RealtimeHub();
    const alertes: string[] = [];
    hub.onPlatformNotice((m) => alertes.push(m));
    hub.registerChannelPolicy("syslog:commandes", { authenticated: true });
    expect(alertes).to.have.lengthOf(1);
    expect(alertes[0]).to.match(/r[ée]serv[ée]/i);
  });

  it("un canal applicatif ne déclenche AUCUN avertissement", () => {
    const hub = new RealtimeHub();
    const alertes: string[] = [];
    hub.onPlatformNotice((m) => alertes.push(m));
    hub.registerChannelPolicy("chat:room1", { authenticated: true });
    expect(alertes).to.have.lengthOf(0);
  });

  it("diffuser un namespace réservé entre pods est REFUSÉ (pas seulement signalé)", () => {
    const hub = new RealtimeHub();
    const alertes: string[] = [];
    hub.onPlatformNotice((m) => alertes.push(m));
    hub.markBroadcastChannel("syslog:");
    // Le refus est ce qui compte : accepter rouvrirait l'entrée du bus à
    // `syslog:`, donc l'injection de fausses lignes de journal cross-pod.
    hub.setFrameAuthorizer(() => true); // sécurité présente : plancher effacé
    hub.subscribeClient(
      "syslog:stream",
      () => {},
      () => () => {},
    );
    hub.publish("syslog:stream", { msg: "x" });
    expect(alertes).to.have.lengthOf(1);
    expect(alertes[0]).to.match(/IGNOR[ÉE]/i);
  });

  it("un préfixe applicatif reste diffusable", () => {
    const hub = new RealtimeHub();
    const recu: unknown[] = [];
    hub.markBroadcastChannel("chat:");
    hub.subscribe(
      "chat:room1",
      (p) => recu.push(p),
      () => () => {},
    );
    hub.publish("chat:room1", { v: 1 });
    expect(recu).to.have.lengthOf(1);
  });
});

/** Le token n'entre pas en jeu ici : sans verrou, il n'y a pas d'identité. */
const _token: IRealtimeToken | null = null;
void _token;
