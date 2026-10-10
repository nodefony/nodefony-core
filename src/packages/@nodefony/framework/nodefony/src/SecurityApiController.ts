import type { OutgoingHttpHeaders } from "node:http";
import Controller from "./Controller";

const NO_STORE = { "cache-control": "no-store" } as const;

/**
 * Base des contrôleurs d'authentification (`/nodefony/security/api/*`) : toute
 * réponse JSON part en `Cache-Control: no-store`.
 *
 * Ces réponses portent une identité, un jeton, un secret affiché une seule
 * fois (clé API, secret TOTP, codes de récupération) ou leur refus. Un cookie
 * ou un en-tête dans la requête n'empêche pas un cache partagé de STOCKER la
 * réponse (RFC 9111 §3) ; RFC 6749 §5.1 exige `no-store` sur un jeton. La règle
 * vit ici, une fois : une action ajoutée à un contrôleur héritier ne peut pas
 * l'oublier. Un en-tête passé par l'action garde la priorité.
 */
abstract class SecurityApiController extends Controller {
  override renderJson(
    obj: unknown,
    status?: string | number,
    headers?: OutgoingHttpHeaders,
  ): ReturnType<Controller["renderJson"]> {
    return super.renderJson(obj, status, { ...NO_STORE, ...headers });
  }
}

export default SecurityApiController;
