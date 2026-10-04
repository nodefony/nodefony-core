/**
 * Racine du dépôt — seule implémentation pour les scripts de `scripts/`.
 *
 * Chaque script la recalculait depuis son propre emplacement (`..` relatif à
 * lui-même) : déplacé d'un cran, il tournait avec `scripts/` pour racine et ne
 * levait PAS — il lisait des dossiers vides et rendait un vert. Ici la racine
 * se calcule depuis CE fichier, et se CONSTATE : si `scripts/lib/` changeait de
 * profondeur, l'import lève au lieu de mentir. Un script déplacé, lui, casse
 * sur son `import` relatif — bruyamment.
 *
 * @usage import { REPO_ROOT } from "../lib/repo-root.mjs"
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Nom du `package.json` racine — l'empreinte qui prouve qu'on est au bon endroit. */
const ROOT_PACKAGE_NAME = "nodefony-core";

/**
 * Chemin absolu (natif) de la racine du dépôt.
 *
 * @throws Error si le `package.json` trouvé à cette place n'est pas celui du dépôt.
 */
export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

let name;
try {
  name = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
  ).name;
} catch {
  name = undefined;
}
if (name !== ROOT_PACKAGE_NAME) {
  throw new Error(
    `scripts/lib/repo-root.mjs : ${REPO_ROOT} n'est pas la racine du dépôt ` +
      `(package.json « ${name ?? "absent"} », attendu « ${ROOT_PACKAGE_NAME} »).`,
  );
}
