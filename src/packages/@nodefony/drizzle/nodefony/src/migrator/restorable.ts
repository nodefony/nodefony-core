import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { migrationHash } from "./hash";
import type { IMigrationDrift } from "./types";

const run = promisify(execFile);

/** Plafond de lecture d'un fichier de migration servi par git. */
const MAX_MIGRATION_BYTES = 16 * 1024 * 1024;

/**
 * Les fichiers dérivés que `git checkout --` ramènerait EXACTEMENT à la version
 * appliquée — constaté fichier par fichier, jamais supposé.
 *
 * Le geste ne s'applique que si la copie que git tient dans son index porte
 * l'empreinte enregistrée en base : c'est elle que `git checkout --` remet sur
 * le disque. Ce seul constat couvre tous les cas où le geste serait inopérant,
 * sans en énumérer aucun :
 *
 * - fichier livré par un paquet installé (hors dépôt) → git ne le connaît pas ;
 * - fichier changé DANS git (commit, mise à jour du framework), arbre propre →
 *   l'index porte la nouvelle empreinte, restaurer ne change rien ;
 * - modification déjà indexée → `git checkout --` repart de l'index modifié ;
 * - binaire `git` absent, dossier non versionné (conteneur déployé) → rien à
 *   constater, donc rien à proposer.
 *
 * Coût : un processus `git` par fichier dérivé, et seulement s'il y en a — une
 * dérive est une anomalie, jamais le régime courant. Les arguments partent sans
 * shell : git lit le chemin `:./<fichier>` à l'identique sur les trois
 * plateformes.
 *
 * @param drifted - dérives du plan ; seules celles qui portent `path` sont
 *   examinables.
 * @param root - dossier depuis lequel le geste sera tapé (racine de
 *   l'application) : les chemins rendus lui sont relatifs.
 * @returns les chemins à restaurer, en barres obliques (ils voyagent dans une
 *   commande copiée), dans l'ordre des dérives ; vide quand rien n'est constaté.
 */
export async function restorableDrifts(
  drifted: readonly IMigrationDrift[],
  root: string,
): Promise<string[]> {
  const out: string[] = [];
  for (const drift of drifted) {
    if (drift.path !== undefined && (await indexHoldsApplied(drift))) {
      out.push(path.relative(root, drift.path).split(path.sep).join("/"));
    }
  }
  return out;
}

/**
 * La copie de l'index git porte-t-elle l'empreinte appliquée ?
 *
 * @param drift - dérive dont le fichier est connu.
 * @returns `true` seulement si git a répondu ET que l'empreinte concorde.
 */
async function indexHoldsApplied(drift: IMigrationDrift): Promise<boolean> {
  if (drift.path === undefined) {
    return false;
  }
  try {
    const { stdout } = await run(
      "git",
      ["show", `:./${path.basename(drift.path)}`],
      {
        cwd: path.dirname(drift.path),
        encoding: "utf8",
        maxBuffer: MAX_MIGRATION_BYTES,
        windowsHide: true,
      },
    );
    return migrationHash(stdout) === drift.expected;
  } catch {
    // Pas de git, pas de dépôt, fichier non suivi : rien n'est constaté.
    return false;
  }
}
