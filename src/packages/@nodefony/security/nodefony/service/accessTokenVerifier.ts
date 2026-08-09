import {
  Service,
  Module,
  Container,
  Event,
  ACCESS_TOKEN_VERIFIER,
} from "nodefony";
import type { IAccessPrincipal, IAccessTokenVerifier } from "nodefony";
import {
  defineSecurityConfig,
  type ISecurityConfig,
  type ISecurityConfigInput,
} from "../config/defineModuleConfig";
import { RemoteJwtVerifier } from "../src/token/RemoteJwtVerifier";

// Le nom du SERVICE Nodefony (journaux, introspection) et le nom du point de
// rendez-vous dans le conteneur sont un seul et même identifiant, importé du
// cœur : c'est là que vit le contrat, donc c'est là que vit son nom.
const serviceName = ACCESS_TOKEN_VERIFIER;

/**
 * Pose (ou non) le vérificateur de jetons d'accès TIERS dans le conteneur.
 *
 * Ce service est une **décision de câblage**, pas de la cryptographie : toute la
 * mécanique vit dans {@link RemoteJwtVerifier}, et la doctrine de refus dans le
 * cœur (`nodefony/src/oauth/`). Ici, on lit la configuration et on tranche une
 * seule question — cette application accepte-t-elle des jetons émis ailleurs ?
 *
 * **Aucun émetteur déclaré = rien n'est posé**, et c'est le comportement voulu :
 * une porte protégée qui ne trouve pas de vérificateur refuse de servir en le
 * disant (503 + CRITIC), là où un vérificateur présent mais vide refuserait
 * chaque jeton un par un — même résultat pour l'appelant, diagnostic beaucoup
 * plus difficile pour l'exploitant.
 *
 * Le coût est nul quand la capacité n'est pas utilisée : rien n'est instancié,
 * aucune requête n'est faite au démarrage. La découverte des clés n'a lieu qu'au
 * PREMIER jeton réellement présenté, et une seule fois par émetteur.
 */
class AccessTokenVerifierService extends Service {
  #verifier: RemoteJwtVerifier | null = null;

  constructor(public module: Module) {
    super(
      serviceName,
      module.container as Container,
      module.notificationsCenter as Event,
      module.options,
    );
    this.kernel?.once("onBoot", () => this.#build());
  }

  /** Le vérificateur, ou `null` si aucun émetteur n'est déclaré. */
  get verifier(): RemoteJwtVerifier | null {
    return this.#verifier;
  }

  #build(): void {
    let config: ISecurityConfig;
    try {
      config = defineSecurityConfig(this.options as ISecurityConfigInput);
    } catch {
      // Config invalide : le firewall logge CRITIC + fail-closed. On s'efface —
      // aucun vérificateur posé, donc toute porte protégée refuse de servir.
      return;
    }
    const { issuers, ...tuning } = config.resourceServer;
    if (issuers.length === 0) {
      this.log(
        "aucun émetteur de confiance déclaré (security.resourceServer.issuers) — " +
          "les jetons émis par un serveur d'autorisation tiers ne sont pas " +
          "vérifiables ; une porte protégée refusera de servir.",
        "DEBUG",
      );
      return;
    }
    try {
      this.#verifier = new RemoteJwtVerifier({
        issuers,
        timeoutMs: tuning.timeoutMs,
        cooldownMs: tuning.cooldownMs,
        cacheMaxAgeMs: tuning.cacheMaxAgeMs,
        clockToleranceS: tuning.clockToleranceS,
        log: (message) => this.log(message, "DEBUG"),
      });
    } catch (error) {
      // Émetteur mal formé, dupliqué, ou algorithme à secret partagé : la
      // configuration ne peut pas exister. Fail-closed ANNONCÉ — pas de
      // vérificateur, et la cause est nommée (elle n'a rien de secret).
      this.log(
        `vérificateur de jetons non armé — ${(error as Error).message}`,
        "CRITIC",
      );
      return;
    }
    // Posé comme FONCTION : le contrat du cœur (`IAccessTokenVerifier`) en est
    // une, ce qui laisse une application fournir la sienne — un jeton opaque
    // introspecté (RFC 7662), un vérificateur maison — sans rien réimplémenter
    // de la porte.
    const verify: IAccessTokenVerifier = (
      token: string,
      audience: string,
    ): Promise<IAccessPrincipal | null> =>
      (this.#verifier as RemoteJwtVerifier).verify(token, audience);
    this.container?.set(serviceName, verify);
    this.log(
      `vérificateur de jetons armé — ${issuers.length} émetteur(s) de confiance : ` +
        issuers.map((i) => i.issuer).join(", "),
      "INFO",
    );
  }
}

export default AccessTokenVerifierService;
export { AccessTokenVerifierService };
