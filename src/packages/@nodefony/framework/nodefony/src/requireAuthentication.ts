import { readSessionAuthentication } from "nodefony";
import type { IAuthenticationRequirement } from "../decorators/routerDecorators.js";

/** Vue minimale d'une session : ses métadonnées (contrat de `readSessionAuthentication`). */
interface IMetaBagReader {
  getMetaBag(key: string): unknown;
}

/**
 * Ce qui manque à une session pour satisfaire un `@RequireAuthentication` —
 * fonction PURE : la session, l'exigence et l'heure lui sont données.
 *
 * Lit `authAt`/`amr` par `readSessionAuthentication` (contrat du cœur), jamais
 * le sac de métadonnées à la main. Une session absente, ou qui ne porte pas ces
 * métadonnées, est REFUSÉE : ne pas savoir n'est pas une preuve.
 *
 * @param session - la session de la requête, ou `null`.
 * @param requirement - l'exigence figée de la route.
 * @param now - l'heure de la décision, en millisecondes epoch.
 * @returns la cause du refus en clair, ou `null` quand la session suffit.
 */
export function authenticationShortfall(
  session: IMetaBagReader | null,
  requirement: IAuthenticationRequirement,
  now: number,
): string | null {
  const auth = readSessionAuthentication(session);
  if (auth === null) {
    return (
      "la session de cette requête ne dit ni quand ni comment elle a été " +
      "ouverte (aucune connexion, ou route hors d'une zone à session)"
    );
  }
  if (
    requirement.maxAge !== null &&
    now - auth.at > requirement.maxAge * 1000
  ) {
    return `la connexion date de plus de ${requirement.maxAge} s`;
  }
  const missing = requirement.amr.filter((m) => !auth.amr.includes(m));
  if (missing.length > 0) {
    return (
      `la connexion n'a pas employé ${missing.join(", ")} ` +
      `(employés : ${auth.amr.join(", ") || "aucun moyen déclaré"})`
    );
  }
  return null;
}

/**
 * Le défi d'un refus « step-up » (RFC 9470 §3) : le schéma de session du
 * pare-feu, l'erreur normée et l'âge maximal quand la route en fixe un.
 * `error_description` reste en ASCII, sans guillemet (RFC 6750 §3).
 *
 * @param requirement - l'exigence de la route.
 * @returns la valeur de `WWW-Authenticate`.
 */
export function stepUpChallenge(
  requirement: IAuthenticationRequirement,
): string {
  const maxAge =
    requirement.maxAge === null ? "" : `, max_age="${requirement.maxAge}"`;
  return (
    'Session realm="nodefony", error="insufficient_user_authentication", ' +
    'error_description="A more recent or stronger authentication is required"' +
    maxAge
  );
}
