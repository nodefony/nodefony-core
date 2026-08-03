import type { ITokenListQuery } from "../../contracts/ITokenStore";

/**
 * Fragment de critère **portable** exprimant l'état de vie d'un jeton — la
 * traduction que les adapters SQL et Mongo partagent au lieu de la réécrire.
 *
 * Elle tient dans le `Criteria` d'orm-core depuis que celui-ci porte `$or` :
 * « utilisable » signifie *sans échéance* **ou** *échéance à venir*, ce qu'aucune
 * conjonction ne dit. Avant ça, chaque backend serait descendu à son SQL natif —
 * trois écritures de la même règle, et la divergence pour seule perspective.
 *
 * Révoqué l'emporte sur expiré : les deux autres branches exigent donc
 * explicitement `revokedAt IS NULL`. Sans cette précision, une clé révoquée
 * **puis** échue compterait dans deux facettes, et la somme dépasserait le total.
 *
 * @param status - l'état demandé, ou `undefined` pour ne pas filtrer.
 * @param now - instant de référence (injecté : un compteur ne doit pas dépendre
 *   du moment où le test tourne).
 * @returns le fragment à fusionner dans le critère, vide si aucun filtre.
 */
export function tokenStatusCriteria(
  status: ITokenListQuery["status"],
  now: number,
): Record<string, unknown> {
  switch (status) {
    case "revoked":
      return { revokedAt: { $null: false } };
    case "expired":
      return { revokedAt: { $null: true }, expiresAt: { $lte: now } };
    case "active":
      return {
        revokedAt: { $null: true },
        $or: [{ expiresAt: { $null: true } }, { expiresAt: { $gt: now } }],
      };
    default:
      return {};
  }
}
