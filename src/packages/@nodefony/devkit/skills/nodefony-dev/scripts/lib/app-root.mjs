/**
 * Racine de l'APPLICATION Nodefony vue depuis un dossier — partagée par les
 * scripts des skills livrés.
 *
 * Un script lancé depuis `frontend/` ou `modules/blog/` doit travailler sur
 * l'application entière : ses `node_modules`, ses `logs/`, sa configuration, et
 * déposer ce qu'il produit sous SON `tmp/`. Prendre le dossier courant semait un
 * `tmp/browser/` par sous-dossier et faisait chercher la doc au mauvais endroit.
 *
 * 🔴 C'est une COPIE de `findProjectRoot` du cœur (`nodefony`,
 * `src/cli/projectRoot.ts`), et elle est voulue : importer `nodefony` coûte de
 * 0,3 s à plusieurs secondes à froid, payées à CHAQUE appel d'un script qu'un
 * agent lance entre deux tours — mesuré en CI, où le premier test du fichier
 * dépassait son délai. Aucun sous-chemin léger du cœur ne l'expose. La copie est
 * confrontée à l'original par `tests/skills-app-root.test.ts` : une divergence
 * y tombe rouge.
 *
 * Aucune dépendance hors `node:` — le fichier doit se charger partout où un
 * script de skill tourne.
 */
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Premier dossier, en remontant depuis `from`, qui porte `nodefony.config.ts`
 * ET `package.json` — la même définition que le cœur.
 *
 * @param {string} from - dossier de départ.
 * @returns {string | null} la racine absolue, ou `null` hors application.
 */
export function findAppRoot(from) {
  let dir = path.resolve(from);
  for (;;) {
    if (
      existsSync(path.join(dir, "nodefony.config.ts")) &&
      existsSync(path.join(dir, "package.json"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * La racine de l'application si `cwd` est dedans, sinon `cwd` lui-même.
 *
 * @param {string} cwd - le dossier de lancement.
 * @returns {string} la racine retenue.
 */
export function appRoot(cwd) {
  return findAppRoot(cwd) ?? cwd;
}
