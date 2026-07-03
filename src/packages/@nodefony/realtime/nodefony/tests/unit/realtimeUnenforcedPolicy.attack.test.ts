import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { RealtimeHub } from "../../src/server/RealtimeHub";

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
