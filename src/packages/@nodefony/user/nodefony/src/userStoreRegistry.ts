/**
 * Registre des BACKENDS de persistance utilisateur DISPONIBLES : `"memory"`
 * (builtin de ce module) + les adapters ORM chargés (`@nodefony/drizzle`,
 * `@nodefony/mongoose`).
 *
 * Différence avec les stores du framework (token/audit/idempotency/session…) : le
 * dépôt utilisateur n'est PAS résolu par `resolveAutoStore` + un registre par
 * brique — il est provisionné par l'APPLICATION (`provisionUsers`, piloté par
 * `NF_USER_STORE`). Ce registre ne SÉLECTIONNE donc rien : il ÉNUMÈRE ce qui est
 * branchable, pour que l'écran Studio « Stores » montre « résolu parmi disponibles »
 * comme pour les 7 autres briques (l'affichage ne doit pas mentir avec `[resolved]`).
 *
 * Convention-frère de `SessionsService.registerStorage` : chaque adapter déclare son
 * backend à son `onKernelRegister`. Lazy + process-wide (Set alloué au 1er ajout).
 */
let stores: Set<string> | null = null;

/**
 * Déclare un backend de persistance utilisateur disponible (idempotent).
 *
 * @param name - nom court du backend (`"memory"`, `"drizzle"`, `"mongoose"`).
 */
export function registerUserStore(name: string): void {
  (stores ??= new Set<string>()).add(name);
}

/**
 * Liste des backends utilisateur disponibles — alimente le champ `available` du
 * statut user (écran Studio « Stores »). `"memory"` est mis EN TÊTE (baseline
 * builtin, toujours disponible = le repli qui marche partout), les adapters ORM
 * suivent triés. L'ordre est celui affiché dans la colonne « Backends dispo ».
 *
 * @returns noms des backends enregistrés (vide si aucun — jamais `null`).
 */
export function listUserStores(): string[] {
  if (!stores) {
    return [];
  }
  const rest = [...stores].filter((s) => s !== "memory").sort();
  return stores.has("memory") ? ["memory", ...rest] : rest;
}

// `"memory"` (InMemoryUserRepository) est builtin de @nodefony/user → toujours
// disponible. Enregistré au chargement du module (ce fichier est ré-exporté par
// le barrel `index.ts`), bien avant toute requête de statut.
registerUserStore("memory");
