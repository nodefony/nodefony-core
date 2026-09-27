/**
 * Données d'écriture partielles telles qu'elles arrivent d'un schéma de
 * validation : une clé peut manquer OU valoir `undefined`, et les deux disent
 * la même chose — « ne pas toucher à ce champ ».
 *
 * `Partial<T>` ne suffit pas sous `exactOptionalPropertyTypes` : il refuse la
 * valeur `undefined` que produit un champ facultatif de Zod (`.optional()`,
 * `.partial()` → `{ a?: T | undefined }`). Les points d'entrée d'écriture
 * (`AbstractCrudService`, `ResourceController`) acceptent donc ce type, et la
 * couche de persistance retire les clés `undefined` avant d'écrire.
 *
 * @typeParam T - forme de l'entité écrite.
 */
export type PartialInput<T> = { [K in keyof T]?: T[K] | undefined };
