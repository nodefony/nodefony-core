import { RequestContext } from "nodefony";
import type { IUser } from "@nodefony/user";
import { Controller, controller, Get, RequireScope } from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";

/**
 * Banc d'intégration du **chemin du SUCCÈS** de la zone serveur de ressource
 * (P6.9), là où {@link ExternalJwtController} n'éprouve que la panne.
 *
 * Le décor tient en une phrase : depuis qu'elle publie ses métadonnées RFC 8414
 * et son jeu de clés, **une application Nodefony est découvrable — y compris par
 * elle-même**. Le jeton présenté ici est donc un vrai jeton, signé par une vraie
 * clé, présenté à une porte qui ne possède PAS cette clé et doit aller la
 * chercher : découverte du document d'émetteur, lecture du JWKS, vérification de
 * la signature, contrôle de l'audience, puis rattachement du sujet à un compte
 * local. Aucun IdP tiers à démarrer, et pourtant rien n'est simulé.
 *
 * Ce que le pipeline complet montre et qu'aucun unitaire ne peut établir : que
 * cette chaîne survit au passage par le pare-feu, et qu'un jeton parfaitement
 * valide est tout de même refusé s'il n'a pas été délivré POUR cette ressource
 * ({@link ForeignAudienceController}).
 */
@controller("/nodefony/test/self-external")
class SelfExternalController extends Controller {
  constructor(context: ContextType) {
    super("SelfExternalController", context);
  }

  /**
   * Identité établie à partir d'un jeton vérifié auprès de son émetteur.
   *
   * `identifier` est la preuve du rattachement local : le vérificateur ne rend
   * qu'un sujet et des scopes, c'est l'authenticator qui va chercher le compte
   * (politique `require`). Un sujet sans compte ne parviendrait jamais ici.
   */
  @Get("/whoami")
  whoami() {
    const user = RequestContext.getUser() as IUser | undefined;
    return this.renderJson({
      identifier: user?.identifier ?? null,
      roles: user?.roles ?? [],
      external: true,
    });
  }

  /**
   * Route gardée par un SCOPE — ce que le jeton autorise, pas qui le porte.
   *
   * Elle vérifie que les scopes extraits du jeton distant (`scope` ou `scp`,
   * RFC 9068 §2.2) traversent le vérificateur, l'authenticator et le pare-feu
   * jusqu'au `ScopeVoter`. Sans ce chemin, un jeton d'agent délibérément
   * restreint franchirait toutes les portes de la zone : le downscoping
   * n'existerait que dans le jeton.
   */
  @Get("/scoped/read")
  @RequireScope("selfext:read")
  scopedRead() {
    return this.renderJson({ ok: true, requiredScope: "selfext:read" });
  }
}

/**
 * Jumeau de {@link SelfExternalController} sur une zone qui exige une AUTRE
 * ressource — il n'existe que pour être refusé.
 *
 * Le jeton qui ouvre `/nodefony/test/self-external` est ici rejeté sans que rien
 * d'autre ne change : même émetteur de confiance, même signature, même sujet,
 * même fraîcheur. Seule l'audience diffère. C'est la démonstration, sur le fil,
 * que l'audience LIE un jeton à un service (RFC 8707 §2) — sans elle, le jeton
 * d'un porteur légitime se rejouerait d'un service à l'autre, et la compromission
 * d'une ressource se propagerait à toutes celles qui partagent l'émetteur.
 *
 * Un préfixe DISJOINT, jamais un sous-chemin de la zone voisine : deux zones qui
 * se recouvrent feraient dépendre le verdict de leur ORDRE de déclaration, donc
 * d'un détail de configuration muet.
 */
@controller("/nodefony/test/foreign-audience")
class ForeignAudienceController extends Controller {
  constructor(context: ContextType) {
    super("ForeignAudienceController", context);
  }

  /** Jamais atteint avec un jeton d'une autre audience — c'est tout le propos. */
  @Get("/whoami")
  whoami() {
    const user = RequestContext.getUser() as IUser | undefined;
    return this.renderJson({
      identifier: user?.identifier ?? null,
      foreignAudience: true,
    });
  }
}

export { SelfExternalController, ForeignAudienceController };
export default SelfExternalController;
