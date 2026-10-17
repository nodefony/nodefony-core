/**
 * Dossier de sortie d'un générateur du site : neuf à chaque rendu, ou refusé.
 *
 * Un dossier réutilisé garde les pages retirées du périmètre : elles restent
 * servies et donnent l'illusion qu'un retrait n'a pas pris (vécu en local :
 * 20 pages périmées sur 123). Vider est donc la règle — mais on ne vide QUE ce
 * qu'on reconnaît comme un rendu précédent, à sa signature : le chemin vient de
 * l'appelant, et un `--out .` ne doit pas emporter le dépôt.
 *
 * @usage import { prepareOutDir } from "./lib/out-dir.mjs"
 */
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

/**
 * Prépare `dir` pour un rendu neuf.
 *
 * @param {string} dir - dossier de sortie (absolu).
 * @param {string} signature - chemin, relatif à `dir`, dont la présence prouve
 *   que le dossier est un rendu précédent du même générateur.
 * @param {object} [guard]
 * @param {string} [guard.protect] - dossier que `dir` ne doit ni être, ni contenir (le dépôt).
 * @returns {"created"|"empty"|"cleared"} ce qui a été fait.
 * @throws Error si le dossier n'est pas vide et ne porte pas la signature, ou
 *   s'il contient le dossier protégé.
 */
export function prepareOutDir(dir, signature, { protect } = {}) {
  const target = path.resolve(dir);
  if (protect) {
    const rel = path.relative(target, path.resolve(protect));
    if (rel === "" || !rel.startsWith(".."))
      throw new Error(
        `dossier de sortie refusé : ${target} contient ${protect}`,
      );
  }
  if (!existsSync(target)) {
    mkdirSync(target, { recursive: true });
    return "created";
  }
  if (readdirSync(target).length === 0) return "empty";
  if (!existsSync(path.join(target, signature)))
    throw new Error(
      `dossier de sortie refusé : ${target} n'est pas vide et ne porte pas ` +
        `${signature} — ce n'est pas un rendu précédent, on n'y écrit pas.`,
    );
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  return "cleared";
}
