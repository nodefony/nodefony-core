/**
 * Filets d'un contrôleur **singleton** — le défaut : UNE instance par classe,
 * partagée par toutes les requêtes, concurrentes comprises.
 *
 * Un singleton ne peut porter aucun état de requête sur `this` : la valeur
 * écrite par une requête serait lue par la suivante — une fuite de données
 * entre utilisateurs, sans la moindre erreur. Deux filets la rendent visible :
 *
 * - les accesseurs d'état par requête de `Controller` (`query`, `request`,
 *   `context`…) refusent l'écriture sur un singleton, dans tous les
 *   environnements (coût nul : ils ne sont jamais écrits sur le chemin chaud) ;
 * - en développement seulement, {@link guardSingletonState} fait lever toute
 *   écriture sur un champ de l'instance, une fois sa construction et son
 *   `initialize()` terminés.
 *
 * @module
 */

/**
 * `true` si l'environnement du kernel est celui du développement.
 *
 * Une seule définition pour tout le paquet : la sonde CSP de `Controller` et le
 * filet des singletons s'allument sur le même critère.
 *
 * @param environment - `kernel.environment`, tel quel.
 * @returns `true` en développement (`"development"` ou son alias `"dev"`).
 */
export function isDevelopment(environment: unknown): boolean {
  return environment === "development" || environment === "dev";
}

/**
 * Message d'une écriture refusée sur un contrôleur singleton : il nomme la
 * classe, le membre, la raison du refus et les deux remèdes.
 *
 * @param controller - nom de la classe du contrôleur.
 * @param member - membre écrit (`count`, `query`…).
 * @returns le message, en une phrase par idée.
 */
export function singletonWriteMessage(
  controller: string,
  member: string,
): string {
  return (
    `Contrôleur « ${controller} » : écriture de « this.${member} » refusée. ` +
    "Ce contrôleur est un singleton (le défaut) : une seule instance sert " +
    "toutes les requêtes, concurrentes comprises, et cette valeur fuirait " +
    "de l'une à l'autre. Remèdes : déclarer la classe @Scope(\"request\") — " +
    "une instance par requête, une par connexion en WebSocket — ou porter " +
    "cet état par la requête : un argument décoré (@Param, @Query, @Body…), " +
    "un service de portée request, ou le contexte."
  );
}

/**
 * En développement, fait lever toute écriture sur un champ d'un contrôleur
 * singleton, avec un message qui nomme le contrôleur, le champ et le remède.
 *
 * Chaque propriété PROPRE inscriptible devient un accesseur : la lecture rend
 * la valeur posée à la construction ou dans `initialize()`, l'écriture lève.
 * L'instance est ensuite rendue non extensible, pour qu'un champ non déclaré
 * ne puisse pas être ajouté en cours de requête.
 *
 * Ce que le filet n'attrape PAS, et que seule la relecture garde : les champs
 * `#privés` (ce ne sont pas des propriétés), et les mutations internes d'un
 * objet tenu par un champ (`this.cache.set(…)`, `this.list.push(…)`).
 *
 * @param controller - l'instance, construite et initialisée.
 * @param name - nom de sa classe, pour le message.
 */
export function guardSingletonState(controller: object, name: string): void {
  for (const key of Reflect.ownKeys(controller)) {
    const descriptor = Object.getOwnPropertyDescriptor(controller, key);
    if (descriptor?.writable !== true) continue;
    const value: unknown = descriptor.value;
    const member = String(key);
    Object.defineProperty(controller, key, {
      configurable: false,
      enumerable: descriptor.enumerable ?? false,
      get: () => value,
      set: () => {
        throw new TypeError(singletonWriteMessage(name, member));
      },
    });
  }
  Object.preventExtensions(controller);
}
