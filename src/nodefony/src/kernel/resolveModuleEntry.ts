import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Rend un chemin importable par `import()`, et laisse tout le reste intact.
 *
 * POURQUOI : le spécificateur d'un `import()` dynamique est une **URL**, pas un chemin.
 * Sous POSIX la confusion est sans conséquence — `/a/b/c.js` n'est l'URL de rien, alors
 * Node le traite en chemin. Sous Windows elle est fatale : dans `D:\app\index.js`, `d:`
 * EST un schéma d'URL syntaxiquement valide, et Node refuse net —
 * `ERR_UNSUPPORTED_ESM_URL_SCHEME: Received protocol 'd:'`. Le chargement des modules
 * échouait donc à chaque démarrage, ce qui ne se voyait pas : le code compile, il ne
 * s'exécute simplement jamais.
 *
 * Ce que la fonction NE touche pas : un nom de paquet (`@nodefony/http`), un chemin
 * relatif, une URL déjà formée (`file:`, `data:`, `node:`) — aucun n'est absolu au sens
 * de `path`, tous sont rendus tels quels. Le test d'absoluité vient donc AVANT toute
 * lecture de schéma : l'inverse reprendrait `d:` pour un protocole, ce qui est
 * précisément le défaut qu'on ferme.
 *
 * @param spec - chemin de fichier, nom de paquet ou URL.
 * @returns une URL `file://` si `spec` est un chemin absolu, `spec` inchangé sinon.
 */
export function toImportSpecifier(spec: string): string {
  return path.isAbsolute(spec) ? pathToFileURL(spec).href : spec;
}

/**
 * Dit si une entrée du manifeste `modules` désigne un module par son CHEMIN
 * plutôt que par son nom de paquet.
 *
 * Un chemin commence par `./` ou `../` (l'un ou l'autre séparateur : un
 * manifeste écrit sous Windows reste valable), ou il est absolu. Tout le reste
 * — `@scope/nom`, `nom` — est un nom de paquet, résolu par `node_modules`.
 *
 * @param entry - l'entrée telle qu'écrite dans le manifeste.
 * @returns `true` pour un chemin, `false` pour un nom de paquet.
 */
export function isModulePath(entry: string): boolean {
  return /^\.\.?[\\/]/u.test(entry) || path.isAbsolute(entry);
}

/**
 * Résout le point d'entrée d'un module Nodefony **depuis l'application**, et non
 * depuis le paquet `nodefony`.
 *
 * POURQUOI cette fonction existe : un `import("@app/blog")` écrit dans le code du
 * core est résolu par Node relativement au FICHIER qui l'écrit. Dès que le paquet
 * `nodefony` n'habite pas l'arbre `node_modules` de l'app — mode `--link` (symlink
 * vers un checkout), monorepo, pnpm, hoisting — les modules LOCAUX de l'app
 * (`modules/*`, workspaces npm) deviennent introuvables (« Cannot find package »),
 * alors qu'ils sont parfaitement résolvables depuis l'app. Le repo self-hosted
 * masquait le défaut par accident de topologie : tout y vit sous le même
 * `node_modules`.
 *
 * La règle est donc : **c'est l'app qui décide où sont ses modules**. On résout à
 * partir de son `package.json`, et on rend une URL `file://` absolue, directement
 * importable.
 *
 * Une entrée du manifeste peut aussi être un CHEMIN (`./modules/blog`, ou absolu,
 * cf {@link isModulePath}) : un module chargé sans être un paquet installé — ni
 * workspace, ni lien dans `node_modules`. Le relatif part de la racine de
 * l'application, jamais du répertoire courant ; un dossier se résout par le champ
 * `main` de son `package.json`, que `nodefony create module` pose toujours.
 *
 * @param appRoot - racine de l'application (`kernel.path`).
 * @param moduleName - nom du paquet, ou chemin du module, tel qu'écrit dans le
 *   manifeste `modules`.
 * @returns URL `file://` absolue du point d'entrée, ou le spécificateur NU si la
 *   résolution depuis l'app échoue (paquet absent, ou n'exposant que la condition
 *   `import` — un cas où `require.resolve` refuse). Le repli rend le comportement
 *   historique : c'est alors `import()` qui produira l'erreur, avec son message.
 */
export function resolveModuleEntry(
  appRoot: string,
  moduleName: string,
): string {
  try {
    const require = createRequire(path.join(appRoot, "package.json"));
    const request = isModulePath(moduleName)
      ? path.resolve(appRoot, moduleName)
      : moduleName;
    return pathToFileURL(require.resolve(request)).href;
  } catch {
    return moduleName;
  }
}
