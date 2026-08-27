import { describe, it, expect, afterEach } from "vitest";
import { getRealtimeHub } from "@nodefony/realtime";
import { createRealtimeHarness } from "@nodefony/realtime/testing";
import <%= it.nameClass %> from "../nodefony/controllers/<%= it.nameClass %>";

/**
 * Tests de la socket de <%= it.nameClass %>, sans serveur ni navigateur.
 *
 * `createRealtimeHarness` monte le controller sur une fausse connexion et
 * parle son protocole : il envoie les frames JSON-RPC qu'un client enverrait
 * et rend celles qui sortent. Tout le décor (faux contexte HTTP, remise à zéro
 * du hub, pose d'une identité) vit dans `@nodefony/realtime/testing` — il n'y a
 * rien à recopier ici.
 *
 * Pour éprouver un canal PROTÉGÉ (`@RealtimeChannel(nom, { roles })`), passer
 * au harnais l'identité ET le verrou de frame :
 *
 * ```ts
 * const h = createRealtimeHarness((ctx) => new <%= it.nameClass %>(ctx), {
 *   identity: monToken,                 // ce que l'authenticator aurait résolu
 *   frameAuthorizer: monVerrou,         // buildFrameAuthorizer de @nodefony/security
 * });
 * ```
 *
 * Sans verrou, une politique déclarée n'est appliquée par personne — c'est
 * aussi vrai au runtime : c'est `@nodefony/security` qui la fait respecter.
 */
describe("<%= it.nameClass %> — socket", () => {
  afterEach(() => getRealtimeHub().clear());

  it("annonce ses canaux et ses actions au client qui se connecte", async () => {
    const h = createRealtimeHarness((ctx) => new <%= it.nameClass %>(ctx));
    const welcome = await h.connect();
    const params = welcome.params as Record<string, unknown>;
    expect(params.channels).toContain("<%= it.channel %>:events");
    expect(params.methods).toContain("<%= it.channel %>:ping");
    h.dispose();
  });

  it("répond à l'action <%= it.channel %>:ping", async () => {
    const h = createRealtimeHarness((ctx) => new <%= it.nameClass %>(ctx));
    await h.connect();
    const pong = await h.call<{ pong: boolean }>("<%= it.channel %>:ping");
    expect(pong.pong).toBe(true);
    h.dispose();
  });

  it("accepte l'abonnement au canal libre, et le libère à la fermeture", async () => {
    const h = createRealtimeHarness((ctx) => new <%= it.nameClass %>(ctx));
    await h.connect();
    await h.subscribe("<%= it.channel %>:events");
    expect(h.denials()).toHaveLength(0);
    h.close(); // le fournisseur du canal est disposé — plus rien ne diffuse
    h.dispose();
  });

  it("ce qu'une connexion envoie ressort sur le canal (et rien d'autre)", async () => {
    const h = createRealtimeHarness((ctx) => new <%= it.nameClass %>(ctx));
    await h.connect();
    await h.subscribe("<%= it.channel %>:events");
    await h.notify("<%= it.channel %>:dire", { texte: "bonjour" });
    expect(h.messages("<%= it.channel %>:events")).toMatchObject([
      { texte: "bonjour" },
    ]);
    h.dispose();
  });

  it("un canal qui n'existe pas est REFUSÉ, jamais ignoré en silence", async () => {
    // Un abonnement sans réponse est indiscernable d'un canal calme : on
    // chercherait le bug côté producteur alors qu'il est dans le NOM.
    const h = createRealtimeHarness((ctx) => new <%= it.nameClass %>(ctx));
    await h.connect();
    await h.subscribe("<%= it.channel %>:canal-inexistant");
    expect(h.denials()).toMatchObject([{ reason: "unknown" }]);
    h.dispose();
  });
});
