import { FRAMEWORK_SQL_CONNECTOR, ownsSharedMigrations } from "nodefony";

/**
 * Connecteur conventionnel qui héberge le schéma framework (même convention que
 * `SESSION_CONNECTOR` : `"default"` pour Drizzle, `"nodefony"` pour Mongoose).
 *
 * DEUX familles le lisent : le registre des stores (où résoudre les briques du
 * framework) et les migrations (qui les reçoit). La valeur est celle du cœur
 * (`FRAMEWORK_SQL_CONNECTOR`), que le générateur lit aussi : une copie du
 * littéral de chaque côté dériverait en silence.
 */
export const FRAMEWORK_CONNECTOR = FRAMEWORK_SQL_CONNECTOR;

// La règle d'appartenance des migrations vit au cœur : le générateur
// (`create entity`) la lit aussi, et ne peut pas importer ce paquet.
export { ownsSharedMigrations };
