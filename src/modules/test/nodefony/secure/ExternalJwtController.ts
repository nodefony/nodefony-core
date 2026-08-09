import { RequestContext } from "nodefony";
import type { IUser } from "@nodefony/user";
import { Controller, controller, Get } from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";

/**
 * Banc d'intégration de la ZONE SERVEUR DE RESSOURCE `test-external` (P6.9).
 *
 * Tout `/nodefony/test/external/*` est capturé par une zone dont le seul
 * authenticator est `external-jwt` : elle n'accepte que des jetons émis par un
 * serveur d'autorisation TIERS, et exige qu'ils portent l'audience déclarée par
 * la zone (`resource`).
 *
 * Ce que ce banc prouve, et que les tests unitaires ne peuvent pas montrer :
 * ce qu'un client reçoit RÉELLEMENT sur le fil. En particulier qu'une panne de
 * vérification ressort en **503** après avoir traversé tout le pipeline HTTP —
 * la distinction refus / panne se perd très facilement en route, et c'est
 * précisément là qu'elle sert.
 *
 * L'émetteur déclaré pour ce banc est injoignable par construction (`.invalid`,
 * RFC 2606) : aucun décor réseau, aucun IdP à démarrer, verdict déterministe.
 * Le chemin du SUCCÈS n'est donc pas exercé ici — il l'est en unitaire et par
 * la chaîne `protectedResourceChain`.
 */
@controller("/nodefony/test/external")
class ExternalJwtController extends Controller {
  constructor(context: ContextType) {
    super("ExternalJwtController", context);
  }

  /** Identité établie à partir du jeton tiers (sujet rattaché par le firewall). */
  @Get("/whoami")
  whoami() {
    const user = RequestContext.getUser() as IUser | undefined;
    return this.renderJson({
      identifier: user?.identifier ?? null,
      roles: user?.roles ?? [],
      external: true,
    });
  }
}

export default ExternalJwtController;
