/**
 * Connecteur conventionnel qui héberge le schéma framework (même convention que
 * `SESSION_CONNECTOR` : `"default"` pour Drizzle, `"nodefony"` pour Mongoose).
 *
 * Vit dans ce fichier sans dépendance parce que DEUX familles le lisent : le
 * registre des stores (où résoudre les briques du framework) et les migrations
 * (qui les reçoit). Une copie du littéral de chaque côté dériverait en silence.
 */
export const FRAMEWORK_CONNECTOR = "default";

/**
 * Ce connecteur possède-t-il les migrations du framework et de l'application ?
 *
 * **Seul le connecteur du framework les possède.** Le dossier des migrations de
 * l'application (`migrations/<dialect>`) ne porte aucune notion de connecteur :
 * il décrit UNE base, celle où vivent les briques du framework et les entités
 * de l'application. Les attribuer à tout connecteur faisait qu'une base
 * secondaire (analyse, base d'un module) en mode `migrate` y créait des tables
 * qui ne lui appartiennent pas, et qu'en mode `auto` elle annonçait à chaque
 * démarrage des migrations qui ne la concernent pas.
 *
 * @param connector - nom du connecteur (clé de `connectors`).
 * @returns `true` pour le connecteur du framework, `false` pour tout autre.
 */
export function ownsSharedMigrations(connector: string): boolean {
  return connector === FRAMEWORK_CONNECTOR;
}
