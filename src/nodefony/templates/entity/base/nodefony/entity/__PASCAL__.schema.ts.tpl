import { z } from "zod";

/**
 * Contrat d'**entrée** de `<%= it.pascal %>` — ce qu'un client a le droit d'envoyer.
 *
 * Volontairement distinct de la table : une table décrit un stockage, un schéma décrit
 * une frontière. Ni `id` ni les horodatages n'y figurent — ils sont posés par le
 * serveur, jamais par l'appelant. Zod **retire** silencieusement les champs inconnus :
 * un client qui tenterait d'envoyer `{ role: "admin" }` ne peut pas s'auto-promouvoir
 * (protection contre l'affectation en masse, gratuite).
 *
 * La validation s'exécute dans le **service** (`<%= it.pascal %>Service`), donc elle
 * protège REST, WebSocket et CLI d'un seul coup. Un rejet devient un **422** avec le
 * détail des champs fautifs (`error.fields`).
 */
export const create<%= it.pascal %>Schema = z.object({
  <%= it.zodProps %>
});

/**
 * Contrat de **mise à jour** — dérivé du précédent, jamais dupliqué : tout champ y est
 * optionnel (`PATCH` partiel). Ajouter un champ au schéma de création le rend
 * automatiquement modifiable ; les deux ne peuvent pas diverger.
 */
export const update<%= it.pascal %>Schema = create<%= it.pascal %>Schema.partial();

/** Données acceptées à la création. */
export type Create<%= it.pascal %> = z.infer<typeof create<%= it.pascal %>Schema>;

/** Données acceptées à la mise à jour. */
export type Update<%= it.pascal %> = z.infer<typeof update<%= it.pascal %>Schema>;
