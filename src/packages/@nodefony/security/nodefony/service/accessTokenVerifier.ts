import { Service, Module, Container, ACCESS_TOKEN_VERIFIER } from "nodefony";
import type { IAccessPrincipal, IAccessTokenVerifier } from "nodefony";
import {
  defineSecurityConfig,
  type ISecurityConfig,
  type ISecurityConfigInput,
} from "../config/defineModuleConfig";
import { RemoteJwtVerifier } from "../src/token/RemoteJwtVerifier";
import { JwtAuthenticator } from "../src/authenticator/JwtAuthenticator";
import { peekIssuer } from "../src/authenticator/peekIssuer";
import { resolveJwtRuntime } from "../src/token/jwtRuntime";

// Le nom du SERVICE Nodefony (journaux, introspection) et le nom du point de
// rendez-vous dans le conteneur sont un seul et même identifiant, importé du
// cœur : c'est là que vit le contrat, donc c'est là que vit son nom.
const serviceName = ACCESS_TOKEN_VERIFIER;

/**
 * Pose (ou non) le vérificateur de jetons d'accès dans le conteneur — celui
 * qu'une ressource protégée (porte MCP, zone `external-jwt`) interroge.
 *
 * Ce service est une **décision de câblage**, pas de la cryptographie : la
 * vérification d'un jeton TIERS vit dans {@link RemoteJwtVerifier}, celle d'un
 * jeton de CETTE application dans {@link JwtAuthenticator}, et la doctrine de
 * refus dans le cœur (`nodefony/src/oauth/`). Ici, on tranche deux questions :
 * l'application signe-t-elle ses jetons, et en accepte-t-elle d'ailleurs ?
 *
 * ⭐ **Un jeton signé par cette application est TOUJOURS vérifiable**, dès que
 * sa capacité JWT est active (`security.jwt.enabled`, le défaut) — sans rien
 * déclarer dans `resourceServer.issuers`. Une application qui émet un jeton
 * pour sa propre porte (`nodefony security:token --resource …`) doit pouvoir
 * le lire : sans cette règle, la porte refusait un jeton parfaitement valide,
 * et l'application était un serveur d'autorisation dont aucune ressource ne
 * reconnaissait la signature. Rien de nouveau ne devient valide : l'audience
 * reste exigée, et seules celles de `jwt.audiences` sont émises.
 *
 * 🔴 **Il est vérifié par les règles de l'authentificateur `jwt`, pas par son
 * jeu de clés seul** : révocation ciblée et en masse, compte encore actif. Lu
 * comme un jeton tiers, un jeton RÉVOQUÉ — ou celui d'un compte désactivé —
 * ouvrait encore la porte jusqu'à son expiration.
 *
 * L'aiguillage se fait sur l'émetteur revendiqué (`peekIssuer`), comme dans le
 * pare-feu : l'émetteur de l'application va à la vérification locale, tout
 * autre à la liste fermée des émetteurs tiers. Un émetteur inconnu est refusé
 * sans la moindre requête sortante.
 *
 * **Rien à vérifier = rien n'est posé** (capacité JWT coupée, aucun émetteur
 * tiers) : une porte protégée qui ne trouve pas de vérificateur refuse alors de
 * servir en le disant (503 + CRITIC), là où un vérificateur vide refuserait
 * chaque jeton un par un — même résultat pour l'appelant, diagnostic beaucoup
 * plus difficile pour l'exploitant.
 *
 * Le coût est nul tant qu'aucun jeton n'est présenté : aucune requête au
 * démarrage, clés locales lues au premier jeton, découverte d'un émetteur tiers
 * au premier jeton qui s'en réclame.
 */
class AccessTokenVerifierService extends Service {
  #verifier: IAccessTokenVerifier | null = null;

  constructor(public module: Module) {
    super(
      serviceName,
      module.container as Container,
      module.notificationsCenter,
      module.options,
    );
    this.kernel?.once("onBoot", () => this.#build());
  }

  /** Le vérificateur posé, ou `null` si rien n'est vérifiable. */
  get verifier(): IAccessTokenVerifier | null {
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

    // Les jetons de CETTE application — vérifiés par l'authentificateur `jwt`
    // lui-même, ses dépendances (clés, révocation, annuaire) résolues au premier
    // jeton : l'ordre des services au démarrage n'a pas à être garanti.
    const runtime = config.jwt.enabled ? resolveJwtRuntime(config.jwt) : null;
    const local =
      runtime === null
        ? null
        : new JwtAuthenticator(this.container as Container, runtime);

    const { issuers, ...tuning } = config.resourceServer;
    let remote: RemoteJwtVerifier | null = null;
    if (issuers.length > 0) {
      try {
        remote = new RemoteJwtVerifier({
          issuers,
          timeoutMs: tuning.timeoutMs,
          cooldownMs: tuning.cooldownMs,
          cacheMaxAgeMs: tuning.cacheMaxAgeMs,
          clockToleranceS: tuning.clockToleranceS,
          log: (message) => this.log(message, "DEBUG"),
        });
      } catch (error) {
        // Émetteur mal formé, dupliqué, ou algorithme à secret partagé : la
        // configuration ne peut pas exister. Fail-closed ANNONCÉ — AUCUN
        // vérificateur, jetons locaux compris : une configuration fausse ne se
        // sert pas à moitié. La cause est nommée (elle n'a rien de secret).
        this.log(
          `vérificateur de jetons non armé — ${(error as Error).message}`,
          "CRITIC",
        );
        return;
      }
    }

    if (local === null && remote === null) {
      this.log(
        "rien à vérifier — capacité JWT coupée (security.jwt.enabled) et aucun " +
          "émetteur tiers (security.resourceServer.issuers) : une porte protégée " +
          "refusera de servir.",
        "DEBUG",
      );
      return;
    }

    const localIssuer = runtime?.issuer ?? null;
    // Posé comme FONCTION : le contrat du cœur (`IAccessTokenVerifier`) en est
    // une, ce qui laisse une application fournir la sienne — un jeton opaque
    // introspecté (RFC 7662), un vérificateur maison — sans rien réimplémenter
    // de la porte.
    const verify: IAccessTokenVerifier = (
      token: string,
      audience: string,
    ): Promise<IAccessPrincipal | null> => {
      if (local !== null && peekIssuer(token) === localIssuer) {
        return local.verifyForResource(token, audience);
      }
      return remote === null
        ? Promise.resolve(null)
        : remote.verify(token, audience);
    };
    this.#verifier = verify;
    this.container?.set(serviceName, verify);
    const trusted = [
      ...(localIssuer === null ? [] : [`${localIssuer} (cette application)`]),
      ...issuers.map((i) => i.issuer),
    ];
    this.log(
      `vérificateur de jetons armé — ${trusted.length} émetteur(s) de confiance : ` +
        trusted.join(", "),
      "INFO",
    );
  }
}

export default AccessTokenVerifierService;
export { AccessTokenVerifierService };
