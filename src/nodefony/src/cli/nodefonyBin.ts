import { createRequire } from "node:module";
import path from "node:path";

/**
 * Le chemin du lanceur `nodefony`, tel que CETTE installation l'a reçu.
 *
 * ## Pourquoi une fonction, et pas un chemin écrit à la main
 *
 * Un appelant qui doit démarrer l'application — une suite de tests, un shim de
 * création d'application, un script de déploiement — écrivait jusqu'ici
 * `node_modules/.bin/nodefony`. Trois choses lui donnent tort :
 *
 *  1. **Ce fichier n'existe pas sous Windows.** npm y écrit un `nodefony.cmd`,
 *     et Node refuse d'exécuter un script batch sans passer par un shell
 *     (correctif de CVE-2024-27980). Le symptôme est un `ENOENT` sur un chemin
 *     qui semble pourtant présent — il désigne le fichier SANS extension.
 *  2. **L'emplacement n'est pas garanti.** Hoisting npm, espaces de travail,
 *     pnpm et son magasin : le paquet n'est pas toujours dans le
 *     `node_modules` du dossier courant.
 *  3. **Le nom du binaire appartient au framework**, pas à ses utilisateurs.
 *     Écrit en dur chez chacun, il ne peut plus jamais changer.
 *
 * La résolution passe donc par le MANIFESTE : Node localise `nodefony` comme il
 * localiserait n'importe quel import, et le champ `bin` dit où est le lanceur.
 * Aucune extension à deviner, aucun shell à ouvrir, aucun chemin à supposer.
 *
 * ## Usage
 *
 * Le résultat se donne à `node`, jamais au système : c'est un script, pas un
 * exécutable.
 *
 * ```ts
 * import { execFileSync } from "node:child_process";
 * import { nodefonyBin } from "nodefony";
 *
 * execFileSync(process.execPath, [nodefonyBin(), "production", "--detach", "--wait"]);
 * ```
 *
 * @param depuis - d'où résoudre, si ce n'est pas depuis ce module (rare). Un
 *                 appelant installé À CÔTÉ du framework — un shim `create-*`,
 *                 par exemple — passe son propre `import.meta.url` pour que la
 *                 résolution parte de SON arbre de dépendances.
 * @returns Le chemin ABSOLU du script de lancement.
 * @throws Si le paquet `nodefony` est introuvable depuis `depuis` — le message
 *         dit alors que c'est l'INSTALLATION qui manque, pas le chemin qui est
 *         faux.
 */
export function nodefonyBin(depuis: string = import.meta.url): string {
  const require = createRequire(depuis);
  let manifeste: string;
  try {
    manifeste = require.resolve("nodefony/package.json");
  } catch {
    throw new Error(
      "paquet `nodefony` introuvable depuis " +
        depuis +
        " — l'application est-elle installée (npm install) ?",
    );
  }
  const pkg = require("nodefony/package.json") as {
    bin?: string | Record<string, string>;
  };
  const bin =
    typeof pkg.bin === "string"
      ? pkg.bin
      : (pkg.bin?.nodefony ?? "bin/nodefony");
  return path.join(path.dirname(manifeste), bin);
}
