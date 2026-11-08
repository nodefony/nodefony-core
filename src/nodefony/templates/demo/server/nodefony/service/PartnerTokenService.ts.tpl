import { Service, Module, injectable } from "nodefony";
import { Firewall, InvalidTargetError, TokenService } from "@nodefony/security";
import { UserService } from "@nodefony/user";
import { PARTNER_AREA } from "../config/security";

/**
 * Clé d'INSTANCE du service dans le conteneur (`container.get(…)`) — à ne pas
 * confondre avec le nom de CLASSE que prend `@Inject("PartnerTokenService")`.
 */
export const PARTNER_TOKEN_SERVICE = "partnerToken";

/** Durée d'un jeton émis ici : le temps d'un appel, pas d'une session. */
export const PARTNER_TOKEN_TTL_S = 300;

/** Un refus d'émettre : ce qui manque, et le geste qui répare. */
export class PartnerTokenError extends Error {
  constructor(
    message: string,
    readonly remedy: string,
  ) {
    super(message);
  }
}

/** Ce que rend une émission. */
export interface IPartnerToken {
  accessToken: string;
  /** Durée de vie, en secondes. */
  expiresIn: number;
  /** L'audience du jeton : la ressource de la zone `demo-partner`. */
  resource: string;
}

/**
 * Émet un jeton d'accès SIGNÉ PAR CETTE APPLICATION, pour un de ses comptes,
 * et pour la seule API partenaire — partagé par la commande
 * `demo:partner:call` et par la page `/demo/partner`.
 *
 * Guide pour un agent : l'audience vient de la config VALIDÉE du pare-feu
 * (`firewall.getArea("demo-partner").resource`, rendue absolue contre
 * `jwt.issuer`), jamais d'une URL recopiée — un jeton pour une autre audience
 * est refusé par la zone. Les services du framework s'atteignent par leur CLÉ
 * de conteneur (`tokenService`, `users`, `firewall`) et se vérifient par
 * `instanceof`. Doc : `@nodefony/security/docs/obtenir-un-jeton.md`.
 */
// #region partner-service
// Un service : une seule implémentation pour la commande et pour la page.
@injectable()
class PartnerTokenService extends Service {
  // #endregion
  /**
   * @param module - le module qui le déclare ; absent dans un test, qui le
   *   construit sans kernel
   */
  constructor(module?: Module) {
    super(
      PARTNER_TOKEN_SERVICE,
      module?.container ?? undefined,
      module?.notificationsCenter,
    );
  }

  /**
   * La ressource de la zone partenaire, telle que le pare-feu l'a validée.
   *
   * @throws PartnerTokenError si la zone n'est pas chargée
   */
  resource(): string {
    const firewall = this.get<unknown>("firewall");
    const resource =
      firewall instanceof Firewall
        ? firewall.getArea(PARTNER_AREA)?.resource
        : undefined;
    if (resource === undefined) {
      throw new PartnerTokenError(
        `zone « ${PARTNER_AREA} » introuvable dans le pare-feu.`,
        "le module demo et @nodefony/security sont-ils chargés ? " +
          "npx nodefony inspect modules",
      );
    }
    return resource;
  }

  // #region partner-issue
  /**
   * Un jeton pour le compte `identifier`, valable sur l'API partenaire seule.
   * Comme toute émission, elle garde un jeton de rafraîchissement en base.
   *
   * @throws PartnerTokenError si l'application n'émet pas de jetons, si le
   *   compte n'existe pas, ou si la zone refuse cette audience
   */
  async issueFor(identifier: string): Promise<IPartnerToken> {
    const tokens = this.get<unknown>("tokenService");
    const users = this.get<unknown>("users");
    if (
      !(tokens instanceof TokenService) ||
      !tokens.isEnabled() ||
      !(users instanceof UserService)
    ) {
      throw new PartnerTokenError(
        "cette application n'émet pas de jetons (service tokenService ou users absent).",
        "vérifie le bloc `jwt` de nodefony/config/security.ts",
      );
    }
    const user = await users.findByIdentifier(identifier);
    if (!user) {
      throw new PartnerTokenError(
        `compte « ${identifier} » introuvable.`,
        `npx nodefony security:user:add ${identifier}`,
      );
    }
    const resource = this.resource();
    try {
      // L'audience est la ressource de la zone : le jeton n'ouvre RIEN d'autre.
      const issued = await tokens.issueTokens(
        user,
        [],
        resource,
        PARTNER_TOKEN_TTL_S,
      );
      return {
        accessToken: issued.access_token,
        expiresIn: PARTNER_TOKEN_TTL_S,
        resource,
      };
    } catch (error) {
      if (error instanceof InvalidTargetError) {
        throw new PartnerTokenError(
          `l'application refuse d'émettre un jeton pour ${resource}.`,
          `la zone « ${PARTNER_AREA} » porte-t-elle cette resource ? npx nodefony inspect config`,
        );
      }
      throw error;
    }
  }
  // #endregion
}

export default PartnerTokenService;
