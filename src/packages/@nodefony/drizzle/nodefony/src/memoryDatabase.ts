/**
 * Nom de fichier d'une base SQLite en MÉMOIRE — volatile, elle repart vide à
 * chaque démarrage.
 *
 * Module FEUILLE (aucun import) : l'adapter, le migrateur, les commandes et le
 * service le consultent tous, et le placer dans l'un d'eux ferait importer le
 * migrateur par l'adapter. Une seule écriture du littéral : c'est d'elle que
 * dépend la règle « une base volatile dérive son schéma » (`resolveDdlMode`).
 */
export const MEMORY_DATABASE = ":memory:";
