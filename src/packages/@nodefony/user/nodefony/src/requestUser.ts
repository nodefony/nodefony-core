import { RequestContext } from "nodefony";
import type { IUser } from "../contracts/IUser";

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
 * L'utilisateur AUTHENTIFIÉ de la requête courante, typé {@link IUser} — ou
 * `null` (hors zone, anonyme, ou principal qui n'est pas un `IUser`).
 *
 * La décision « authentifié ? » n'est PAS prise ici : elle appartient au cœur
 * (`RequestContext.getAuthenticatedUser`, qui part du jeton du pare-feu). Cette
 * fonction ne fait que vérifier que le principal porte le contrat `IUser`
 * complet — membre par membre, jamais supposé.
 *
 * @returns l'utilisateur connecté, ou `null`
 * @throws TypeError (du cœur) — jeton authentifié portant un utilisateur mal formé
 */
export function authenticatedUser(): IUser | null {
  const user = RequestContext.getAuthenticatedUser();
  return user !== null && isUser(user) ? user : null;
}

/**
 * L'utilisateur DÉJÀ chargé pour la requête courante, s'il est bien celui
 * qu'on cherche — sinon `null`, et l'appelant relit auprès du fournisseur.
 *
 * Le pare-feu authentifie la requête en relisant le compte (rôles frais,
 * verrouillage et désactivation vérifiés), puis le dépose dans le contexte de
 * requête. Le relire une seconde fois dans la MÊME requête ne rapporte rien et
 * coûte un aller-retour en base. La valeur ne vit que le temps de la requête :
 * la révocation reste immédiate dès la suivante.
 *
 * L'utilisateur est rendu tel quel — ses champs propres (métadonnées,
 * horodatages, colonnes de l'application) restent lisibles. L'anonyme n'est
 * jamais rendu (règle du cœur, cf {@link authenticatedUser}).
 *
 * @param identifier - identifiant attendu (celui de la session, par exemple)
 * @returns l'utilisateur actif et non verrouillé portant cet identifiant, ou `null`
 */
export function requestUser(identifier: string): IUser | null {
  const user = authenticatedUser();
  if (
    user === null ||
    user.identifier !== identifier ||
    user.isLocked() ||
    !user.isActive()
  ) {
    return null;
  }
  return user;
}
