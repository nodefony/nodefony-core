/**
 * **`@internal` ne s'écrit que comme ÉTIQUETTE d'une déclaration, jamais dans une phrase.**
 *
 * Avec `stripInternal` (posé par les tsconfigs du dépôt), TypeScript retire du
 * `.d.ts` publié toute déclaration dont un commentaire de tête CONTIENT le mot
 * `@internal` — il cherche le texte, il ne lit pas la grammaire TSDoc. Écrit
 * dans la description d'UN paramètre, il fait donc disparaître la déclaration
 * ENTIÈRE de la notice, sans un mot. Vécu sur les types publiés de `nodefony` :
 *
 * - `@param adoptedProtoService - @internal …` retirait le CONSTRUCTEUR de
 *   `Container` — `new Container(parent)`, l'usage documenté, rendait
 *   `TS2554: Expected 0 arguments` chez l'utilisateur ;
 * - `@param seen - @internal …` retirait `freezeConfigTree`, que `index.d.ts`
 *   ré-exportait encore : sous `skipLibCheck`, un `any` muet.
 *
 * Aucun test du dépôt ne pouvait le voir : il compile contre les SOURCES
 * (condition `nodefony-source`), jamais contre la notice publiée.
 *
 * Forme admise : une ligne de bloc qui COMMENCE par l'étiquette (`* @internal`)
 * ou un commentaire d'une ligne `/** … @internal *\/`. Tout le reste est refusé
 * — pour dire « réservé au framework » dans une phrase, écrire « interne ».
 */
import { describe, it } from "vitest";
import { assert } from "vitest";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** Racine du dépôt — ce fichier vit dans `src/nodefony/src/tests/`. */
const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");

/** Racines du code publié : le cœur et les paquets du framework. */
const ROOTS = [
  path.join(REPO_ROOT, "src", "nodefony", "src"),
  path.join(REPO_ROOT, "src", "packages", "@nodefony"),
];

/** Dossiers dont le contenu n'est jamais du code de ce dépôt. */
const PRUNED = new Set(["node_modules", "dist", ".git", ".turbo", "coverage"]);

/** Ce fichier cite le motif pour l'expliquer : il s'exclut lui-même. */
const SELF = path.resolve(import.meta.filename);

/**
 * Collecte les sources TypeScript sous une racine.
 *
 * @param dir - dossier à explorer.
 * @param out - accumulateur (chemins absolus).
 * @returns les chemins trouvés.
 */
function collectSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (PRUNED.has(entry)) continue;
    const full = path.join(dir, entry);
    // `lstat` : les fixtures du Finder portent une boucle de liens symboliques.
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) collectSources(full, out);
    else if (/\.(c|m)?tsx?$/.test(entry) && full !== SELF) out.push(full);
  }
  return out;
}

/**
 * Une ligne portant `@internal` est-elle une étiquette admise ?
 *
 * @param line - la ligne de source, telle quelle.
 * @returns `true` pour `* @internal…` en tête de ligne de bloc, ou pour un
 *   commentaire `/** … *\/` tenu sur la ligne ; `false` sinon.
 */
function isStandaloneTag(line: string): boolean {
  if (/^\s*\*\s*@internal\b/.test(line)) return true;
  if (/^\s*\/\*\*.*@internal\b.*\*\/\s*$/.test(line)) return true;
  return false;
}

describe("@internal — étiquette d'une déclaration, jamais une phrase", () => {
  it("la règle reconnaît l'étiquette et refuse la phrase (cas vécus)", () => {
    assert.isTrue(isStandaloneTag("   * @internal"));
    assert.isTrue(
      isStandaloneTag("   * @internal — appelé par le flux lui-même."),
    );
    assert.isTrue(
      isStandaloneTag("  /** @internal — passer par {@link openSseStream}. */"),
    );
    assert.isFalse(
      isStandaloneTag(
        "   * @param adoptedProtoService - @internal canal {@link Scope}",
      ),
    );
    assert.isFalse(
      isStandaloneTag(" * @param seen - @internal nœuds déjà parcourus"),
    );
    assert.isFalse(
      isStandaloneTag(
        "    // Adoption du proto PARENT (canal @internal du constructeur)",
      ),
    );
  });

  it("aucune source publiée n'écrit @internal hors d'une étiquette", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of collectSources(root)) {
        const lines = readFileSync(file, "utf8").split("\n");
        lines.forEach((line, index) => {
          if (line.includes("@internal") && !isStandaloneTag(line)) {
            offenders.push(
              `${path.relative(REPO_ROOT, file)}:${index + 1}  ${line.trim()}`,
            );
          }
        });
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "`@internal` hors d'une étiquette retire la déclaration ENTIÈRE du .d.ts publié — " +
        "écrire « interne » dans la phrase, ou poser l'étiquette sur sa propre ligne :\n" +
        offenders.join("\n"),
    );
  });
});
