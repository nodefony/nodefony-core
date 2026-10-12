/// <reference types="node" />
import { route, controller } from "@nodefony/framework";
import { RealtimeController } from "@nodefony/realtime";
import { Context } from "@nodefony/http";

/**
 * Socket ouverte par un jeton d'accès émis par un **vrai Keycloak** (zone
 * `test-keycloak`, profil `keycloak` du compose).
 *
 * Elle répond à une seule question : une connexion longue adossée à un jeton
 * tiers MEURT-elle avec lui ? Au handshake, l'authenticator `external-jwt` de
 * la zone vérifie le jeton et pose l'identité ; le
 * `FirewallRealtimeAuthenticator` la promeut avec la borne `exp` que Keycloak a
 * signée, et le tick du hub ferme la socket (4001) une fois cette borne passée.
 * Banc : `http/…/integration/oauth2-keycloak.test.ts`.
 */
@controller("/nodefony/test/keycloak")
class KeycloakRealtimeController extends RealtimeController {
  constructor(context: Context) {
    super("KeycloakRealtimeController", context);
  }

  @route("test-keycloak-realtime", {
    path: "/realtime",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async realtime(message: string | Buffer | null): Promise<void> {
    this.handleRealtime(message);
  }
}

export { KeycloakRealtimeController };
export default KeycloakRealtimeController;
