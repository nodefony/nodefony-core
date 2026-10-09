import type { IUser } from "../contracts/IUser";
import { anonymousUser } from "./AnonymousUser";

/**
 * Vrai si la valeur porte la forme complète du contrat {@link IUser} —
 * vérifiée membre par membre, jamais supposée.
 *
 * @param value - valeur venue du contexte de requête (typée `unknown` par le cœur)
 * @returns `true` si chaque membre du contrat est présent avec le bon type
 */
function isUser(value: unknown): value is IUser {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "identifier" in value &&
    typeof value.identifier === "string" &&
    "roles" in value &&
    Array.isArray(value.roles) &&
    "hasRole" in value &&
    typeof value.hasRole === "function" &&
    "isActive" in value &&
    typeof value.isActive === "function" &&
    "isLocked" in value &&
    typeof value.isLocked === "function"
  );
}

/**
 * L'utilisateur DÉJÀ chargé pour la requête courante, s'il est bien celui
 * qu'on cherche — sinon `null`, et l'appelant relit auprès du fournisseur.
 *
 * Le pare-feu authentifie la requête en relisant le compte (rôles frais,
 * verrouillage et désactivation vérifiés), puis le dépose dans le contexte de
 * requête — c'est ce que rendent `RequestContext.getUser()` et
 * `IAdminRequest.user`. Le relire une seconde fois dans la MÊME requête ne
 * rapporte rien et coûte un aller-retour en base. La valeur ne vit que le
 * temps de la requête : la révocation reste immédiate dès la suivante.
 *
 * La valeur est typée `unknown` par le cœur, qui ne connaît pas `IUser` : elle
 * est VÉRIFIÉE (forme, identifiant, état du compte) plutôt que convertie, et
 * rendue telle quelle — ses champs propres (métadonnées, horodatages, colonnes
 * de l'application) restent lisibles. L'utilisateur anonyme n'est jamais rendu.
 *
 * @param value - utilisateur déposé par le pare-feu (contexte de requête)
 * @param identifier - identifiant attendu (celui de la session, par exemple)
 * @returns l'utilisateur actif et non verrouillé portant cet identifiant, ou `null`
 */
export function requestUser(value: unknown, identifier: string): IUser | null {
  if (
    identifier === anonymousUser.identifier ||
    !isUser(value) ||
    value.identifier !== identifier ||
    value.isLocked() ||
    !value.isActive()
  ) {
    return null;
  }
  return value;
}
