/**
 * Où vit le décor du banc de vérité — SOURCE UNIQUE, lue par
 * `verify-generated.mjs` (qui le pose) et `verify-runtime.mjs` (qui le
 * réutilise).
 *
 * Le chemin était écrit dans les deux scripts, et il a divergé :
 * `verify-generated` a sorti le décor lié du dépôt (sous `tmp/`, ignoré par
 * git, oxlint ne lisait plus rien), `verify-runtime --link` le cherchait
 * encore sous `REPO/tmp/devkit-verify`. Sans `--link`, il lisait en silence un
 * décor isolé ANCIEN — et rendait un verdict vert sur une application qui
 * n'était pas celle qu'on venait de générer.
 *
 * Le décor vit HORS du dépôt dans les deux modes (cf la TSDoc de `ROOT` dans
 * `verify-generated.mjs`) ; deux dossiers distincts, pour qu'un run lié
 * n'écrase pas un décor isolé conservé, et un par moteur.
 *
 * @module
 */
import os from "node:os";
import path from "node:path";

/**
 * Dossier racine du décor.
 *
 * @param {{ linked: boolean, database?: string, tmp?: string }} options
 *   `linked` — décor lié au checkout (`--link`) ; `database` — moteur de
 *   l'application témoin (défaut `sqlite`) ; `tmp` — dossier temporaire,
 *   injectable pour l'auto-test.
 * @returns {string} le dossier qui contient `app/`.
 */
export function decorRoot({ linked, database = "sqlite", tmp = os.tmpdir() }) {
  return path.join(
    tmp,
    (linked ? "nodefony-devkit-verify-link" : "nodefony-devkit-verify") +
      (database === "sqlite" ? "" : `-${database}`),
  );
}
