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
 * Le prédicat `exists` permet à un scaffold de voir sa TRANSACTION : `create
 * app --demo` crée le module de la démo pendant que l'application n'existe
 * encore que dans les écritures en attente — lu sur le disque seul, le projet
 * qu'on est en train d'écrire serait introuvable.
 *
 * @param from - dossier de départ (typiquement `process.cwd()`).
 * @param exists - « ce chemin existe-t-il ? » ; le disque par défaut.
 * @returns racine absolue, ou `null` hors projet.
 */
export function findProjectRoot(
  from: string,
  exists: (file: string) => boolean = existsSync,
): string | null {
  let dir = path.resolve(from);
  for (;;) {
    if (
      exists(path.join(dir, "nodefony.config.ts")) &&
      exists(path.join(dir, "package.json"))
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
