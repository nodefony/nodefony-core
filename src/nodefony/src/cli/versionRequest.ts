/**
 * `true` si l'invocation demande la **version du CLI** : `nodefony -v` ou
 * `nodefony --version`, sans aucun positionnel.
 *
 * Un positionnel présent → la commande décide (`nodefony dev --version` n'est
 * pas une demande de version du CLI) : on laisse commander trancher.
 *
 * Module SANS dépendance : le binaire l'appelle AVANT d'importer le cœur, pour
 * répondre en temps de démarrage de Node au lieu de payer le chargement du
 * framework entier (mesuré : ~500 ms → ~190 ms, Node à vide ~180 ms). La version
 * est une DONNÉE — `VERSION=$(nodefony -v)` est un usage légitime, et il est
 * souvent dans une boucle de script. `CliKernel` appelle la même fonction : une
 * seule règle, deux points d'entrée.
 *
 * @param args - les arguments après le nom du binaire (`process.argv.slice(2)`)
 * @returns `true` si la version du CLI est demandée.
 */
export function isVersionRequest(args: readonly string[]): boolean {
  for (const arg of args) {
    if (!arg.startsWith("-")) return false;
  }
  return args.includes("-v") || args.includes("--version");
}
