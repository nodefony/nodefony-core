import { describe, it, expect } from "vitest";
import { RealtimeHub } from "../../src/server/RealtimeHub.js";

/**
 * Une politique de canal est indexée par nom EXACT. Un canal DÉRIVÉ
 * (`chat:room:1000` — cadence, forage, identifiant) est servi par la fabrique
 * dynamique et n'hérite de rien : son auteur le croit gardé, il ne l'est pas.
 * Ces cas verrouillent le signal qui le dit.
 */
describe("RealtimeHub — canal dynamique non couvert par une politique", () => {
  it("avertit quand un canal servi dynamiquement n'a aucune politique", () => {
    const hub = new RealtimeHub();
    const alertes: string[] = [];
    hub.onPlatformNotice((m) => alertes.push(m));
    hub.registerChannelPolicy("chat:room", { roles: ["ROLE_USER"] });

    hub.noticeUnguardedDynamicChannel("chat:room:1000");
    expect(alertes).to.have.lengthOf(1);
    expect(alertes[0]).to.match(/exact/i); // dit POURQUOI la politique ne matche pas
    expect(alertes[0]).to.contain("chat:room:1000"); // et sur quel canal
  });

  it("se tait quand le canal PORTE une politique déclarée", () => {
    const hub = new RealtimeHub();
    const alertes: string[] = [];
    hub.onPlatformNotice((m) => alertes.push(m));
    hub.registerChannelPolicy("chat:room", { roles: ["ROLE_USER"] });
    hub.noticeUnguardedDynamicChannel("chat:room");
    expect(alertes).to.have.lengthOf(0);
  });

  it("se tait sur un module SANS aucune politique (rien à trahir)", () => {
    const hub = new RealtimeHub();
    const alertes: string[] = [];
    hub.onPlatformNotice((m) => alertes.push(m));
    hub.noticeUnguardedDynamicChannel("chat:room:1000");
    expect(alertes).to.have.lengthOf(0);
    expect(hub.hasChannelPolicies()).to.equal(false);
  });

  it("n'avertit qu'UNE fois — un signal de configuration, pas un flux", () => {
    const hub = new RealtimeHub();
    const alertes: string[] = [];
    hub.onPlatformNotice((m) => alertes.push(m));
    hub.registerChannelPolicy("chat:room", { roles: ["ROLE_USER"] });
    for (let i = 0; i < 50; i++)
      hub.noticeUnguardedDynamicChannel(`chat:room:${i}`);
    expect(alertes).to.have.lengthOf(1);
  });
});
