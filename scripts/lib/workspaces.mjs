/**
 * Les workspaces du dépôt, résolus par npm — seule implémentation pour scripts/.
 *
 * Six scripts recopiaient `npm query .workspace` (+ le filtre des privés) : deux
 * par `execFileSync("npm")`, qui ne trouve pas `npm.cmd` sous Windows. Ici la
 * commande passe par un shell (`execSync`), donc portable, et SANS dépendre du
 * cœur bâti : `generate-symbols` l'emploie sur un clone neuf, avant tout build.
 * Le produit a sa propre lecture (`src/nodefony/src/cli/licenses.ts`) : une
 * frontière de paquet le sépare des scripts du dépôt.
 *
 * @usage import { publishableWorkspaces, listWorkspaces } from "../lib/workspaces.mjs"
 */
import { execSync } from "node:child_process";

/**
 * Tous les workspaces, privés compris, tels que npm les déclare.
 *
 * @param {string} root - racine du dépôt.
 * @returns {Array<{ name: string, location: string, private?: boolean }>}
 */
export function listWorkspaces(root) {
  return JSON.parse(
    execSync("npm query .workspace --json", {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }),
  );
}

/**
 * Les workspaces PUBLIÉS sur npm — ceux qui ne sont pas `private`.
 *
 * @param {string} root - racine du dépôt.
 * @returns {Array<{ name: string, location: string }>}
 */
export function publishableWorkspaces(root) {
  return listWorkspaces(root).filter((w) => !w.private);
}
