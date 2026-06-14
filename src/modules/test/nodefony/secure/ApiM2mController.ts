import { RequestContext } from "nodefony";
import type { IUser } from "@nodefony/user";
import { Controller, controller, Get } from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";

/**
 * Banc d'intégration de la ZONE API M2M `test-api` (P6 J4) — JWT Bearer only.
 *
 * Tout `/nodefony/test/m2m/*` est capturé par la zone firewall `test-api`
 * (authenticator `jwt`, `stateless`). Sans `Authorization: Bearer <access>`
 * valide, le firewall répond 401 (+ `WWW-Authenticate: Bearer`) AVANT le
 * controller. L'access s'obtient via `POST /nodefony/security/api/token`
 * (grant credential) puis se rejoue en Bearer.
 */
@controller("/nodefony/test/m2m")
class ApiM2mController extends Controller {
  constructor(context: ContextType) {
    super("ApiM2mController", context);
  }

  /** Identité portée par le JWT (sujet résolu par le firewall dans l'ALS). */
  @Get("/whoami")
  whoami() {
    const user = RequestContext.getUser() as IUser | undefined;
    return this.renderJson({
      identifier: user?.identifier ?? null,
      roles: user?.roles ?? [],
      m2m: true,
    });
  }
}

export default ApiM2mController;
