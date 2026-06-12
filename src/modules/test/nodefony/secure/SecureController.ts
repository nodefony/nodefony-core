import { RequestContext } from "nodefony";
import type { IUser } from "@nodefony/user";
import { Controller, controller, Get } from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";

/**
 * Banc d'intégration de la ZONE PROTÉGÉE `test-secure` (P6 J1).
 *
 * Politique de routes EXPLICITE : tout `/nodefony/test/secure/*` est capturé par
 * la zone firewall `test-secure` (`nodefony.config.ts`, authenticator
 * `userpassword`) — dossier `secure/` = préfixe `/secure` = nom de zone, le
 * caractère protégé se lit partout. Sans `Authorization: Basic` valide, AUCUNE
 * de ces actions n'est atteinte : le firewall répond 401 (+ `WWW-Authenticate`)
 * AVANT le controller. Le reste du module test reste public.
 */
@controller("/nodefony/test/secure")
class SecureController extends Controller {
  constructor(context: ContextType) {
    super("SecureController", context);
  }

  /** Preuve de passage du firewall — la route n'est servie qu'authentifié. */
  @Get("/ping")
  ping() {
    return this.renderJson({ pong: true, secure: true });
  }

  /** Identité propagée par le firewall dans l'ALS (`RequestContext`). */
  @Get("/whoami")
  whoami() {
    const user = RequestContext.getUser() as IUser | undefined;
    return this.renderJson({
      identifier: user?.identifier ?? null,
      roles: user?.roles ?? [],
    });
  }
}

export default SecureController;
