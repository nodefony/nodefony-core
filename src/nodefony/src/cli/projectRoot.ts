import path from "node:path";
import { existsSync } from "node:fs";

/**
 * Racine du PROJET Nodefony courant (app générée / app utilisateur) : remonte
 * depuis `from` jusqu'au premier dossier portant `nodefony.config.ts` +
 * `package.json`.
 *
 * Deux consommateurs, une seule définition de « où commence l'app » :
 * - les scaffolds IN-PROJECT (`create controller|module|entity`) — par
 *   opposition à `create app` qui crée un dossier neuf ;
 * - le **lanceur** (`bin/nodefony`), qui délègue au CLI de l'app quand il en
 *   trouve un (cf `../bin/resolveLocalCli`).
 *
 * Vit ici (module sans dépendance, `node:fs`/`node:path` seuls) et pas dans
 * `scaffold/engine.ts` : le bundle du binaire importerait alors `eta` et tout le
 * moteur de templates, payés à CHAQUE invocation du CLI.
 *
 * @param from - dossier de départ (typiquement `process.cwd()`).
 * @returns racine absolue, ou `null` hors projet.
 */
export function findProjectRoot(from: string): string | null {
  let dir = path.resolve(from);
  for (;;) {
    if (
      existsSync(path.join(dir, "nodefony.config.ts")) &&
      existsSync(path.join(dir, "package.json"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}
