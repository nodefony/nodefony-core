/**
 * Le parcours de fichiers de `doctor` — UNE règle d'exclusion, pour tous les
 * contrôles.
 *
 * 🔴 Elle était écrite QUATRE fois. Ce qu'un contrôle sautait, un autre
 * l'inspectait : `surface` ignorait neuf dossiers, `wiring` et `packageDeps`
 * trois chacun (recopiés à l'identique, donc voués à diverger au premier
 * ajout), et `freshness` exprimait la sienne en motifs de chemin. Elle avait
 * déjà divergé — la fraîcheur du build comptait les fichiers de test, que la
 * surface excluait depuis toujours, et réclamait un `npm run build` après
 * chaque test écrit.
 *
 * Ce qui reste PROPRE à un contrôle s'exprime en paramètre, jamais en seconde
 * liste : un test est de la surface non servie pour l'un, une source non bâtie
 * pour l'autre — c'est la même exclusion, motivée différemment.
 *
 * @module
 */
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Les dossiers dans lesquels aucun contrôle n'entre.
 *
 * Trois familles, et chacune a son motif : ce qui est INSTALLÉ
 * (`node_modules`), ce qui est PRODUIT (`dist`, `coverage`, `.turbo`, `tmp`,
 * `var`), et ce qui n'est ni servi ni publié (`tests`, `test`, `__tests__`).
 * Tout dossier commençant par un point est écarté en plus, par
 * {@link isSkippedDir}.
 */
export const SKIPPED_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  "dist",
  "coverage",
  ".turbo",
  "tmp",
  "var",
  "tests",
  "__tests__",
]);

// ⚠️ `test` au SINGULIER n'est PAS dans cette liste, et c'est délibéré : un
// module peut légitimement s'appeler ainsi — ce dépôt en a un
// (`src/modules/test`), et l'exclure faisait disparaître ses entités du
// câblage. `tests` et `__tests__` sont des conventions de dossier ; `test`
// est un nom comme un autre.

/**
 * Ce dossier est-il hors de portée de tout contrôle ?
 *
 * @param name - le nom du dossier, sans son chemin.
 * @returns `true` s'il ne faut pas y entrer.
 */
export function isSkippedDir(name: string): boolean {
  return SKIPPED_DIRS.has(name) || name.startsWith(".");
}

/**
 * Ce fichier est-il un test ?
 *
 * Reconnaît `x.test.ts` et `x.spec.ts`, dans toutes les extensions de source.
 * Un test n'est ni servi, ni publié, ni bâti : aucun contrôle n'a de raison de
 * le compter, et chacun en avait sa propre définition.
 *
 * @param name - le nom du fichier, ou un chemin.
 * @returns `true` s'il s'agit d'un test.
 */
export function isTestFile(name: string): boolean {
  return /\.(test|spec)\.[cm]?tsx?$/u.test(name);
}

/** Ce que l'appelant choisit — le reste est commun à tous les contrôles. */
export interface IWalkOptions {
  /** Extensions retenues, point compris (ex. `[".ts", ".tsx"]`). */
  extensions: readonly string[];
  /** Sous-dossiers à explorer plutôt que la racine entière. */
  subdirs?: readonly string[];
  /** Profondeur maximale, à partir de la racine explorée. */
  maxDepth?: number;
}

/**
 * Les fichiers de source d'une cible, tests et dossiers produits exclus.
 *
 * @param root - racine à explorer.
 * @param options - extensions retenues, et ce qui restreint le parcours.
 * @returns les chemins absolus, dans l'ordre du système de fichiers.
 */
export function collectSources(root: string, options: IWalkOptions): string[] {
  const found: string[] = [];
  const max = options.maxDepth ?? Number.POSITIVE_INFINITY;
  const walk = (dir: string, depth: number): void => {
    if (depth > max) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      // Un dossier illisible n'est pas un manquement de l'application.
      return;
    }
    for (const entry of entries) {
      // Le point exclut AUSSI les fichiers : un `.quelquechose.ts` est de la
      // configuration d'outil, jamais du code servi ni publié. Les trois
      // marcheurs d'origine l'écartaient déjà, chacun à sa façon.
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!isSkippedDir(entry.name)) walk(full, depth + 1);
      } else if (
        options.extensions.includes(path.extname(entry.name)) &&
        !isTestFile(entry.name)
      ) {
        found.push(full);
      }
    }
  };
  if (options.subdirs) {
    for (const sub of options.subdirs) {
      const dir = path.join(root, sub);
      if (statSync(dir, { throwIfNoEntry: false })) walk(dir, 0);
    }
    return found;
  }
  walk(root, 0);
  return found;
}
