/// <reference types="node" />
import { route, controller } from "@nodefony/framework";
import { RealtimeController } from "@nodefony/realtime";
import { Context } from "@nodefony/http";

/**
 * Banc P6 J8 (volet b) — endpoint realtime authentifié par **JWT Bearer** (zone
 * `test-api`, pattern `^/nodefony/test/m2m`, `stateless`).
 *
 * PROUVE que la garde `@IsGranted` via `api.request` fonctionne AUSSI quand
 * l'identité vient d'un **JWT** (mode agent / API / M2M), pas seulement d'un
 * cookie de session BFF (volet a, hub Studio). Aucun `JwtRealtimeAuthenticator`
 * spécifique n'est nécessaire : au handshake WS (requête HTTP upgrade portant
 * `Authorization: Bearer <jwt>`), le **firewall** (authenticator `jwt` de la
 * zone) vérifie le jeton et pose l'`IUser` dans l'ALS ; le
 * `SessionRealtimeAuthenticator` (câblé PAR ZONE par `firewall.#wireRealtime`)
 * promeut cette identité en `UserRealtimeToken`. → « 1 garde = N transports ET
 * N modes d'authentification ».
 *
 * Le pont `api.request` est activé : le banc invoque la route gardée
 * `/nodefony/test/api/admin-guarded` (`@IsGranted("ROLE_ADMIN")`) — la garde lit
 * le token JWT du peer (posé dans l'ALS du message par J8).
 */
@controller("/nodefony/test/m2m")
class TestM2mRealtimeController extends RealtimeController {
  constructor(context: Context) {
    super("TestM2mRealtimeController", context);
  }

  @route("test-m2m-ws-realtime", {
    path: "/realtime",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async realtime(message: string | Buffer | null): Promise<void> {
    this.handleRealtime(message);
  }

  /** Pont api.request activé — c'est lui qui porte la garde @IsGranted (J8). */
  protected override realtimeApiRequest(): boolean {
    return true;
  }
}

export default TestM2mRealtimeController;
