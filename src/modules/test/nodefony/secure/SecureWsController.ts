import type { IUser } from "@nodefony/user";
import {
  Controller,
  controller,
  route,
  IsGranted,
  CurrentUser,
  RequireScope,
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

  /**
   * Banc P6.8 côté WS — exige le scope `m2m:read`.
   *
   * Un scope downscope une clé MACHINE ; il n'a aucun effet sur un humain. La
   * distinction repose entièrement sur le TYPE du jeton, et c'est exactement ce
   * qui manquait sur la socket : le jeton realtime s'annonçait `session` quel que
   * soit le mode réel, si bien qu'un agent JWT franchissait cette garde sans
   * détenir le moindre scope. Cette route existe pour que ce vecteur reste fermé
   * (banc `ws-scope-jwt.test.ts`).
   */
  @route("test-ws-scope-read", {
    path: "/scoped-read",
    requirements: { methods: ["WEBSOCKET"] },
  })
  @RequireScope("m2m:read")
  scopedRead() {
    return { ok: true, requiredScope: "m2m:read" };
  }

  /**
   * Banc P6.8 côté WS — exige `m2m:write`, jamais accordé au banc : c'est le tir
   * qui doit ÉCHOUER. Sans lui, un « tout passe » se lirait comme un succès.
   */
  @route("test-ws-scope-write", {
    path: "/scoped-write",
    requirements: { methods: ["WEBSOCKET"] },
  })
  @RequireScope("m2m:write")
  scopedWrite() {
    return { ok: true, requiredScope: "m2m:write" };
  }
}

export default SecureWsController;
