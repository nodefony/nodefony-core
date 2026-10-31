import { describe, expectTypeOf, it } from "vitest";
import type { RealtimeIdentity } from "nodefony";
import type { IChannelPolicy as RealtimeChannelPolicy } from "../../interfaces/IChannelPolicy";
// Le contrat tel que `@nodefony/security` le LIT, importé en source : les deux
// paquets ne s'importent pas au runtime, un test a le droit de les confronter.
import type { IChannelPolicy as SecurityChannelPolicy } from "../../../../security/nodefony/src/realtime/realtimeContracts";

/**
 * #622 — garde de TYPES (rendue par `npm run typecheck`, pas par vitest : un
 * `expectTypeOf` ne vérifie rien à l'exécution). Débrancher l'une de ces règles
 * fait échouer le typecheck — une directive `@ts-expect-error` devenue inutile
 * est elle-même une erreur.
 */
describe("#622 — contrats de types de l'admission", () => {
  it("la politique que realtime déclare et celle que security juge ont la MÊME forme", () => {
    expectTypeOf<RealtimeChannelPolicy>().toEqualTypeOf<SecurityChannelPolicy>();
  });

  it("RealtimeIdentity : `id` requis, rôles et scopes en lecture seule", () => {
    expectTypeOf<RealtimeIdentity["id"]>().toEqualTypeOf<string | null>();
    expectTypeOf<RealtimeIdentity["roles"]>().toEqualTypeOf<
      readonly string[]
    >();
    expectTypeOf<RealtimeIdentity["scopes"]>().toEqualTypeOf<
      readonly string[]
    >();
    // Jamais exécuté : seul le compilateur doit lire ces lignes.
    const neverRun = (who: RealtimeIdentity): void => {
      // @ts-expect-error — une règle ne réécrit pas les rôles qu'elle reçoit.
      who.roles.push("ROLE_ADMIN");
      // @ts-expect-error — ni les scopes.
      who.scopes.push("admin:write");
      // @ts-expect-error — une identité sans `id` ne se construit pas.
      const anonymousShape: RealtimeIdentity = {
        type: "session",
        authenticated: true,
        userIdentifier: "alice",
        roles: [],
        scopes: [],
      };
      void anonymousShape;
    };
    void neverRun;
  });
});
