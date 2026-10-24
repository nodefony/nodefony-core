import type { IRouteResolver } from "../../interfaces/IRouting";

/**
 * Rédige l'avertissement de développement d'une requête restée sans réponse :
 * l'action a rendu une valeur que le framework ne sait pas envoyer, et la
 * requête a attendu son délai d'expiration.
 *
 * Le message nomme l'action fautive, ce qu'elle a rendu, et le geste qui
 * convient à ce cas — `null` est presque toujours une entité absente, qui
 * appelle un 404.
 *
 * @param resolver - le resolver de la requête (route, controller, action,
 *   valeur non rendue), `null` si aucune route n'a été résolue.
 * @param url - l'URL de la requête, repli quand aucune route n'est connue.
 * @returns le texte de l'avertissement.
 */
export function unsentResponseWarning(
  resolver: IRouteResolver | null | undefined,
  url: string,
): string {
  const controller = resolver?.controller?.name;
  const actionName = resolver?.actionName;
  const action =
    controller && actionName ? `${controller}.${actionName}` : null;
  const route = resolver?.route?.name ?? null;
  const where = action
    ? `L'action ${action}${route ? ` (route ${route})` : ""}`
    : `L'action de ${route ?? url}`;
  const returned = resolver?.unrendered ?? null;
  const consequence =
    "et n'a rien envoyé : la requête a attendu son délai d'expiration.";
  if (returned === "null")
    return `${where} a rendu null ${consequence} Pour le framework, null veut dire « l'action répond elle-même ». Entité absente → lever HttpError(…, 404) ; sinon rendre la valeur, ou envoyer la réponse soi-même.`;
  if (returned === "undefined")
    return `${where} n'a rien rendu ${consequence} Un « return » oublié ? Rendre la valeur (objet, chaîne, nombre, booléen, Buffer : envoyés automatiquement), ou envoyer la réponse soi-même.`;
  if (returned?.startsWith("une instance de"))
    return `${where} a rendu ${returned}, qui ne s'envoie pas telle quelle, ${consequence} Rendre un objet simple (sa forme JSON), ou envoyer la réponse soi-même.`;
  if (returned !== null)
    return `${where} a rendu une valeur de type ${returned} ${consequence} Rendre un objet, une chaîne, un nombre, un booléen ou un Buffer, ou envoyer la réponse soi-même.`;
  // Aucune trace du Resolver (`waitAsync` posé par l'application elle-même).
  return `${where} n'a rien envoyé : la requête a attendu son délai d'expiration. Rendre la valeur, ou envoyer la réponse soi-même.`;
}
