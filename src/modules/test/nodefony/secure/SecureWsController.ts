import type { IUser } from "@nodefony/user";
import {
  Controller,
  controller,
  route,
  IsGranted,
  CurrentUser,
} from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";

/**
 * Banc P6 J8 — preuve que la garde `@IsGranted` s'applique AUSSI côté WebSocket
 * via le pont `api.request` (« 1 garde = N transports »).
 *
 * Route WS-invocable (`methods: ["WEBSOCKET"]`) placée SOUS `/nodefony/test/api/*`
 * car le verrou de frame J3b n'autorise `api.request {path}` que dans la zone
 * data plane (`^/nodefony/[^/]+/api(/|$)`). La garde lit le token DU PEER (résolu
 * au handshake `/nodefony/studio/api/realtime`, posé dans l'ALS par J8), PAS la
 * zone de cette route. L'action retourne une valeur NUE (le pont l'enveloppe
 * `{id, result}` — `renderJson` est réservé au rendu HTTP).
 *
 * Preuve attendue (banc `ws-data-plane-auth.test.ts`) :
 *  - admin (ROLE_ADMIN) → `{ granted: true, identifier: "admin" }` ;
 *  - user  (ROLE_USER)  → RpcError `data.status === 403` (autz ≠ authn) ;
 *  - anonyme            → handshake refusé en amont (J3b, close 1008).
 */
@controller("/nodefony/test/api")
class SecureWsController extends Controller {
  constructor(context: ContextType) {
    super("SecureWsController", context);
  }

  @route("test-ws-isgranted-admin", {
    path: "/admin-guarded",
    requirements: { methods: ["WEBSOCKET"] },
  })
  @IsGranted("ROLE_ADMIN")
  adminGuarded(@CurrentUser() user: IUser) {
    return { granted: true, identifier: user.identifier };
  }
}

export default SecureWsController;
