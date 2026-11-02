/**
 * Lecture d'un champ d'une valeur INCONNUE — module FEUILLE, sans aucun import,
 * isomorphe (serveur et navigateur).
 *
 * Une charge reçue du réseau (frame JSON-RPC, réponse d'un service tiers, corps
 * d'une erreur HTTP) se lit `unknown`. La lire par `(v as { x?: unknown }).x`
 * est une conversion de type ; par `v[k]` sur un `Record`, elle hérite de
 * `Object.prototype` (`constructor`, `toString`), qui ne sont pas des champs
 * envoyés. Cette fonction est LA règle : propriété propre, sinon `undefined`.
 */

/**
 * Rend la valeur de la propriété PROPRE `key` de `value`, ou `undefined` si
 * `value` n'est pas un objet ou ne porte pas ce champ.
 *
 * Une propriété héritée (`constructor`, `toString`, ou posée sur un prototype)
 * n'est jamais rendue : ce n'est pas un champ de la charge. Le résultat reste
 * `unknown` — à vérifier avant usage (`typeof`, garde, schéma).
 *
 * @param value - charge de forme inconnue (JSON parsé, paramètres RPC…).
 * @param key - nom du champ.
 * @returns la valeur du champ, `unknown`, ou `undefined` s'il est absent.
 *
 * @example
 * ```ts
 * const payload: unknown = await response.json();
 * const token = ownField(payload, "access_token");
 * if (typeof token !== "string") throw new Error("jeton absent");
 * ```
 */
export function ownField(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? Object.getOwnPropertyDescriptor(value, key)?.value
    : undefined;
}
