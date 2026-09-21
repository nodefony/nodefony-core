/**
 * Les briques de persistance qu'un adaptateur **durable** doit toutes porter.
 *
 * C'est la liste que le contrat de manifeste oppose à `nodefony.stores` de
 * chaque adaptateur durable. Elle vit ici, en UN exemplaire : recopiée dans
 * chaque banc, elle divergerait à la première brique ajoutée — et le banc d'un
 * adaptateur resterait vert en ignorant une brique que l'autre exige.
 *
 * **Pourquoi la totalité, et pas « une couverture adaptée »** : le critère n'est
 * pas la nature de la brique, c'est « peut-on tourner SANS l'autre backend ? ».
 * Un backend durable est un chemin complet ou n'en est pas un ; invoquer une
 * couverture adaptée pour justifier une brique durable manquante, c'est habiller
 * un trou.
 *
 * Un adaptateur de **cache** (`storeKind: "cache"`) n'y est pas soumis : il sert
 * les briques à forte rotation, et ses absences sont un domaine, pas un manque.
 *
 * Ajouter une brique durable au framework = l'ajouter ICI. Les bancs des
 * adaptateurs durables deviennent alors rouges tant qu'ils ne la portent pas —
 * c'est exactement l'effet recherché.
 */
export const DURABLE_BRICKS: readonly string[] = [
  "session",
  "user",
  "tokens",
  "passkeys",
  "totp",
  "audit",
  "webhooks",
  "idempotency",
];
