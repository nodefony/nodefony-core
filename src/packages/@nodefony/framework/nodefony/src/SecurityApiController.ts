import type { OutgoingHttpHeaders } from "node:http";
import { SESSION_AUTH_CHALLENGE } from "nodefony";
import Controller from "./Controller";

const NO_STORE = { "cache-control": "no-store" } as const;

/**
 * En-têtes d'un 401 : ceux reçus, plus le défi par défaut
 * ({@link SESSION_AUTH_CHALLENGE}) s'ils n'en portent aucun — RFC 9110 §15.5.2
 * exige un `WWW-Authenticate` sur TOUT 401. Un défi posé par l'appelant (un
 * `Bearer` de ressource protégée, par exemple) garde la main.
 *
 * Chemin froid : n'est appelé que pour un 401.
 *
 * @param headers - les en-têtes déjà prévus pour la réponse.
 * @returns les mêmes en-têtes, défi compris.
 */
export function withAuthChallenge(
  headers: Readonly<OutgoingHttpHeaders> | undefined,
): OutgoingHttpHeaders {
  if (headers !== undefined) {
    for (const name in headers) {
      if (name.toLowerCase() === "www-authenticate") return { ...headers };
    }
  }
  return { ...headers, "www-authenticate": SESSION_AUTH_CHALLENGE };
}

/**
 * Base des contrôleurs d'authentification (`/nodefony/security/api/*`) : toute
 * réponse JSON part en `Cache-Control: no-store`, et tout 401 porte un défi.
 *
 * Ces réponses portent une identité, un jeton, un secret affiché une seule
 * fois (clé API, secret TOTP, codes de récupération) ou leur refus. Un cookie
 * ou un en-tête dans la requête n'empêche pas un cache partagé de STOCKER la
 * réponse (RFC 9111 §3) ; RFC 6749 §5.1 exige `no-store` sur un jeton. Un 401
 * reçoit le défi par défaut ({@link withAuthChallenge}, RFC 9110 §15.5.2). Ces
 * règles vivent ici, une fois : une action ajoutée à un contrôleur héritier ne
 * peut pas les oublier. Un en-tête passé par l'action garde la priorité.
 */
abstract class SecurityApiController extends Controller {
  override renderJson(
    obj: unknown,
    status?: string | number,
    headers?: OutgoingHttpHeaders,
  ): ReturnType<Controller["renderJson"]> {
    const merged = { ...NO_STORE, ...headers };
    return super.renderJson(
      obj,
      status,
      Number(status) === 401 ? withAuthChallenge(merged) : merged,
    );
  }
}

export default SecurityApiController;
