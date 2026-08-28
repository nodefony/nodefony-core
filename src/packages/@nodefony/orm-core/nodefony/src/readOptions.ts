import { InvalidOrderOption } from "./errors";

/**
 * Décrit la FORME d'une valeur reçue, sans jamais en révéler le contenu.
 *
 * Le message d'erreur doit aider à corriger un appel, pas recopier une donnée
 * applicative dans un journal.
 *
 * @param value - valeur observée.
 * @returns une description courte du type (`an object`, `a string`, `null`…).
 */
const describeShape = (value: unknown): string => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  const t = typeof value;
  return t === "object" ? "an object" : `a ${t}`;
};

/**
 * Vérifie que l'option de lecture `order` respecte le contrat portable
 * `Array<[string, "ASC" | "DESC"]>`, ou lève {@link InvalidOrderOption}.
 *
 * Source de vérité **unique** partagée par tous les adapters : chacun l'appelle une
 * fois, en amont de la construction de sa requête, plutôt que de retester la forme à
 * chaque endroit qui pose un tri. Sans elle, un `order` mal formé était sauté en
 * silence (le test historique `options?.order?.length` est faux pour un objet) et la
 * requête partait sans `ORDER BY`.
 *
 * Absence de tri — `undefined`, `null`, ou tableau vide — est acceptée : rien n'y est
 * exprimé qui puisse être trahi. Seule une TENTATIVE de tri mal formée est refusée.
 *
 * Coût : sortie immédiate dans le cas dominant (`undefined`), aucune allocation sur le
 * chemin nominal — la description n'est construite qu'au moment de lever.
 *
 * @param order - valeur de `options.order` telle que reçue de l'appelant.
 * @param entity - nom logique de l'entité ciblée (diagnostic).
 * @throws InvalidOrderOption si `order` est présent et n'est pas un tableau de couples valides.
 */
export function assertOrderOption(order: unknown, entity: string): void {
  if (order === undefined || order === null) {
    return;
  }
  if (!Array.isArray(order)) {
    throw new InvalidOrderOption(entity, describeShape(order));
  }
  for (let i = 0; i < order.length; i++) {
    const pair: unknown = order[i];
    if (!Array.isArray(pair) || pair.length !== 2) {
      throw new InvalidOrderOption(
        entity,
        `pair #${i} = ${describeShape(pair)}${
          Array.isArray(pair) ? ` of length ${pair.length}` : ""
        }`,
      );
    }
    if (typeof pair[0] !== "string") {
      throw new InvalidOrderOption(
        entity,
        `pair #${i} field = ${describeShape(pair[0])}`,
      );
    }
    if (pair[1] !== "ASC" && pair[1] !== "DESC") {
      // Le SENS est une constante du contrat, jamais une donnée applicative : le
      // citer est sans risque, et c'est ce qui rend l'erreur actionnable — le cas
      // dominant est une casse minuscule, qui se corrige en un caractère.
      const got =
        typeof pair[1] === "string" ? `"${pair[1]}"` : describeShape(pair[1]);
      throw new InvalidOrderOption(
        entity,
        `pair #${i} direction = ${got} (expected exactly "ASC" or "DESC")`,
      );
    }
  }
}
