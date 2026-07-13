import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
 * @param appRoot - racine de l'application (`kernel.path`).
 * @param moduleName - nom du paquet, tel qu'écrit dans le manifeste `modules`.
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
    return pathToFileURL(require.resolve(moduleName)).href;
  } catch {
    return moduleName;
  }
}
