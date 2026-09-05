/**
 * Les options que le CLI déclare pour TOUTES ses commandes — et ce que les
 * commandes autonomes doivent en faire.
 *
 * ## Le défaut que ce module ferme
 *
 * `nodefony --help` promet `-i, --interactive` et `-d, --debug` : ce sont des
 * options POSÉES sur commander pour l'ensemble du CLI (`Cli.initCommander`).
 * Mais les commandes qui répondent par le raccourci autonome — `create`,
 * `doctor`, `env`, `card`, `symbols` — ne passent jamais par commander : elles
 * lisent `process.argv` elles-mêmes, précisément pour répondre sans démarrer
 * l'application. Elles refusaient donc, avec « option inconnue », ce que l'aide
 * de la ligne au-dessus venait d'annoncer.
 *
 * C'est la faute la plus décourageante qu'un outil puisse commettre : l'aide dit
 * une chose, la commande en dit une autre, et l'utilisateur n'a aucun moyen de
 * savoir laquelle a raison. Vécu sur `nodefony create app --interactive`, la
 * toute première commande qu'on tape.
 *
 * ## Pourquoi ici, et pas dans chaque parseur
 *
 * Cinq parseurs, cinq copies : la sixième commande autonome écrite demain
 * rouvrirait le trou sans que personne le voie. La liste des options globales
 * vit à UN endroit, et chaque parseur l'APPELLE.
 *
 * ## Ce que « accepter » veut dire
 *
 * Absorber, pas exécuter. Ces options n'ont aucun effet propre sur une commande
 * qui ne pose aucune question et n'ouvre aucun journal de débogage — et c'est
 * exactement ce que « mode interactif » signifie là où il n'y a rien à demander.
 * Là où le mode interactif EXISTE (`create`), il est déjà le comportement par
 * défaut en terminal : le drapeau confirme ce qui se produit déjà, il ne
 * l'active pas.
 *
 * @module
 */

/**
 * Les options déclarées pour tout le CLI, formes courtes et longues.
 *
 * Miroir de ce que pose {@link Cli.initCommander}. `--version` n'y figure pas :
 * elle est servie par son propre raccourci, avant tout parsing de commande.
 */
const GLOBAL_FLAGS: ReadonlySet<string> = new Set([
  "-i",
  "--interactive",
  "-d",
  "--debug",
]);

/** Ce mot est-il une option que le CLI déclare pour toutes ses commandes ? */
export function isGlobalCliFlag(word: string): boolean {
  return GLOBAL_FLAGS.has(word);
}

/**
 * Retire d'un `argv` les options globales du CLI.
 *
 * À appeler par un parseur autonome AVANT sa propre lecture : ce qui reste est
 * ce qui appartient en propre à la commande.
 *
 * @param argv - les mots de la ligne de commande.
 * @returns les mots restants, dans l'ordre.
 */
export function stripGlobalCliFlags(argv: readonly string[]): string[] {
  return argv.filter((w) => !isGlobalCliFlag(w));
}
