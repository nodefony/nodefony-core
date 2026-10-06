import type { IAppContributionContext } from "nodefony";
import { contributeKeycloak } from "../keycloak/scaffold.js";

/**
 * Le point de contribution de `@nodefony/security` : ce que le paquet livre à
 * une application, déclaré dans son `package.json` (`nodefony.contribute`) et
 * joué par le cœur, qui n'en connaît rien.
 *
 * @module
 */

/**
 * La contribution du paquet — aujourd'hui le seul décor Keycloak de
 * développement (`nodefony/keycloak/`).
 *
 * @param context - contexte fourni par le cœur (`runAppContributions`)
 */
export function contribute(context: IAppContributionContext): void {
  contributeKeycloak(context);
}
