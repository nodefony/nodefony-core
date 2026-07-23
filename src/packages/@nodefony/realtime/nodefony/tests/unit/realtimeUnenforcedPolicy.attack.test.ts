import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { RealtimeHub } from "../../src/server/RealtimeHub";
import { JsonRpcPeer } from "nodefony";

/**
 * Phase 0.6 — REVUE realtime, F1 : dégradation silencieuse d'une policy de canal.
 *
 * Un canal peut déclarer une policy (`@RealtimeChannel(name, { roles })`), enregistrée
 * sur le hub au handshake. Mais cette policy n'est ÉVALUÉE que par le `frameAuthorizer`,
 * câblé par `@nodefony/security` au boot des zones realtime. Sans security (ou toutes
 * zones `realtime: false`), aucun frameAuthorizer → la policy est INERTE : le canal se
 * croit gardé, il est ouvert. `hasUnenforcedChannelPolicies()` détecte ce cas → le
 * RealtimeController émet un WARNING (fail-loud, jamais silencieux). Gravité faible
 * (sans security il n'y a de toute façon aucune identité) mais on refuse la
 * dégradation SILENCIEUSE (cf project_resilience_no_silent_degradation).
 */

describe("0.6 F1 — policy de canal déclarée sans frameAuthorizer (fail-loud)", () => {
  it("aucune policy déclarée → hasUnenforcedChannelPolicies = false", () => {
    const hub = new RealtimeHub();
    assert.equal(hub.hasUnenforcedChannelPolicies(), false);
  });

  it("[F1] policy déclarée SANS frameAuthorizer → true (canal cru gardé, en fait ouvert)", () => {
    const hub = new RealtimeHub();
    hub.registerChannelPolicy("secret:data", { roles: ["ROLE_ADMIN"] });
    assert.equal(hub.hasUnenforcedChannelPolicies(), true);
  });

  it("policy déclarée AVEC frameAuthorizer → false (security a câblé le verrou)", () => {
    const hub = new RealtimeHub();
    hub.registerChannelPolicy("secret:data", { roles: ["ROLE_ADMIN"] });
    hub.setFrameAuthorizer(() => true);
    assert.equal(hub.hasUnenforcedChannelPolicies(), false);
  });

  it("frameAuthorizer câblé mais AUCUNE policy → false (rien à appliquer)", () => {
    const hub = new RealtimeHub();
    hub.setFrameAuthorizer(() => true);
    assert.equal(hub.hasUnenforcedChannelPolicies(), false);
  });
});

/**
 * F86 — une connexion ouverte AVANT la pose du verrou doit être gardée elle aussi.
 *
 * `RealtimeController.onHandshake` n'armait `beforeDispatch` que si une politique
 * existait DÉJÀ sur le hub, pour préserver un bypass 0-coût. Mais cette décision,
 * prise une seule fois à l'ouverture, valait pour TOUTE la vie de la socket : un
 * peer connecté une seconde trop tôt n'était jamais gardé — ni quand la politique
 * arrivait, ni ensuite. Une socket WS vit des heures ; l'ordre de boot n'est pas
 * une garantie de sécurité.
 *
 * On reproduit ici le câblage exact du contrôleur (`beforeDispatch` →
 * `hub.runAuthorizer`), sans WebSocket.
 */
describe("F86 — le verrou s'applique aux connexions déjà ouvertes", () => {
  /** Peer câblé comme le fait `RealtimeController.onHandshake`. */
  function connectedPeer(hub: RealtimeHub): {
    peer: JsonRpcPeer;
    sent: unknown[];
    calls: () => number;
  } {
    const sent: unknown[] = [];
    let handlerCalled = 0;
    const peer: JsonRpcPeer = new JsonRpcPeer({
      send: (f) => sent.push(f),
      beforeDispatch: (frame) => hub.runAuthorizer(frame, peer),
    });
    peer.register("app:ping", () => {
      handlerCalled++;
      return { pong: true };
    });
    return { peer, sent, calls: () => handlerCalled };
  }

  /** Le dispatch d'une requête passe par une microtask : laisser le tour. */
  const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

  it("verrou posé APRÈS l'ouverture → la frame suivante est refusée", async () => {
    const hub = new RealtimeHub();
    const { peer, sent, calls } = connectedPeer(hub); // connexion AVANT la policy

    // Rien n'est encore posé : le bypass laisse passer (hub non sécurisé).
    peer.receive({ jsonrpc: "2.0", id: 1, method: "app:ping" });
    await tick();
    assert.equal(calls(), 1);

    // `@nodefony/security` pose le verrou — la connexion existante doit suivre.
    hub.setFrameAuthorizer(() => false);
    peer.receive({ jsonrpc: "2.0", id: 2, method: "app:ping" });
    await tick();

    assert.equal(calls(), 1, "le handler ne doit PAS avoir tourné une 2ᵉ fois");
    assert.deepEqual(sent.at(-1), {
      jsonrpc: "2.0",
      id: 2,
      error: { code: -32001, message: "unauthorized" },
    });
  });

  it("verrou RETIRÉ → la même connexion repasse (le bypass reste vivant)", async () => {
    const hub = new RealtimeHub();
    hub.setFrameAuthorizer(() => false);
    const { peer, calls } = connectedPeer(hub);

    peer.receive({ jsonrpc: "2.0", id: 1, method: "app:ping" });
    await tick();
    assert.equal(calls(), 0, "refusée tant que le verrou est posé");

    hub.setFrameAuthorizer(null);
    peer.receive({ jsonrpc: "2.0", id: 2, method: "app:ping" });
    await tick();
    assert.equal(calls(), 1);
  });
});
