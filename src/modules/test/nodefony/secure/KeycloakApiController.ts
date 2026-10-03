import { RequestContext } from "nodefony";
import type { IUser } from "@nodefony/user";
import { Controller, controller, Get } from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";

/**
 * Porte d'API ouverte par un jeton d'accès émis par un **vrai Keycloak** (zone
 * `test-keycloak`, profil `keycloak` du compose).
 *
 * Elle n'existe que pour poser une question à laquelle aucun double ne répond :
 * la personne qui s'est connectée par le navigateur (flux BFF) et celle qui
 * présente ensuite son jeton à l'API sont-elles le MÊME compte local ? Le banc
 * compare l'identifiant et l'`id` rendus ici à ceux de `/auth/me`.
 */
@controller("/nodefony/test/keycloak")
class KeycloakApiController extends Controller {
  constructor(context: ContextType) {
    super("KeycloakApiController", context);
  }

  /** Compte local rattaché au sujet du jeton Keycloak. */
  @Get("/whoami")
  whoami() {
    const user = RequestContext.getUser() as IUser | undefined;
    return this.renderJson({
      id: user?.id ?? null,
      identifier: user?.identifier ?? null,
      roles: user?.roles ?? [],
    });
  }
}

export { KeycloakApiController };
export default KeycloakApiController;
