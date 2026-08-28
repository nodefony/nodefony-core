/**
 * Ce que la génération des migrations DU FRAMEWORK a en propre — et rien de
 * plus.
 *
 * Le socle `drizzle-kit` (résolution du binaire, preuve positive qu'une
 * génération a eu lieu, relecture du SQL produit, marqueur de format) vit
 * désormais dans le code PUBLIÉ du paquet, `nodefony/src/migrator/kit.ts` : la
 * commande `orm:generate` s'exécute chez l'utilisateur, et `scripts/` n'est pas
 * livré (`files` ne porte que `dist`, `docs` et `migrations`). Une seule
 * implémentation, deux appelants — ce dépôt, et toute application.
 *
 * Ce fichier ne garde donc que ce qui est vrai ICI : trois dialectes générés
 * ensemble sous le même nom, et des journaux qu'on refuse de laisser diverger.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SqlDialect } from "../nodefony/interfaces/IDrizzleConfig";
import { runGenerate as runGenerateAt } from "../nodefony/src/migrator/kit";

export {
  FORMAT_MARKER,
  auditMigrationSql,
  isInteractivePromptFailure,
  resolveDrizzleKitBin,
  stampFormatMarker,
} from "../nodefony/src/migrator/kit";
export type { IAuditRule, IMigrationAudit } from "../nodefony/src/migrator/kit";

/** Racine du module `@nodefony/drizzle`. */
export const MODULE_ROOT = path.resolve(
  fileURLToPath(import.meta.url),
  "..",
  "..",
);

/**
 * Dialectes générés, dans l'ordre où ils sont produits.
 *
 * Les trois se génèrent TOUJOURS ensemble : un tag publié sur npm est immuable à
 * vie, donc trois journaux désalignés ne se renumérotent pas.
 *
 * ⚠️ Cette contrainte est propre au FRAMEWORK, qui décrit ses tables par le
 * `colKit` et peut donc les rendre dans les trois dialectes. Les entités d'une
 * application sont écrites en Drizzle natif, donc dans UN dialecte — `orm:generate`
 * n'en produit qu'un, celui de son connecteur.
 */
export const DIALECTS: readonly SqlDialect[] = ["sqlite", "postgres", "mysql"];

/** Chemin du journal d'un dialecte. */
export const journalPath = (dialect: SqlDialect): string =>
  path.join(MODULE_ROOT, "migrations", dialect, "meta", "_journal.json");

/**
 * Lit la suite des tags d'un dialecte, ou `[]` si rien n'a encore été généré.
 *
 * @param dialect - dialecte lu.
 * @returns les tags dans l'ordre du journal.
 */
export function readTags(dialect: SqlDialect): string[] {
  const file = journalPath(dialect);
  if (!fs.existsSync(file)) {
    return [];
  }
  const journal = JSON.parse(fs.readFileSync(file, "utf8")) as {
    entries?: Array<{ tag: string }>;
  };
  return (journal.entries ?? []).map((entry) => entry.tag);
}

/**
 * Lance `drizzle-kit generate` depuis la racine de CE paquet.
 *
 * @param options - `configRel` (configuration, chemin relatif au module), `name`
 *   (nom imposé de la migration), `label` (ce qui est cité dans l'erreur).
 * @returns la sortie complète de l'outil.
 * @throws Error si rien ne prouve que la génération a eu lieu.
 */
export function runGenerate(options: {
  configRel: string;
  name: string;
  label: string;
}): string {
  return runGenerateAt({
    ...options,
    cwd: MODULE_ROOT,
    regenerateCommand: `npm run generate:migrations -- --name ${options.name}`,
  });
}

/**
 * Refuse tout état où les trois journaux ne portent pas la même suite de tags.
 *
 * @param when - moment du contrôle, cité dans le message.
 * @returns les tags communs aux trois dialectes.
 * @throws Error si deux dialectes divergent.
 */
export function assertJournalsAligned(when: string): string[] {
  const byDialect = new Map<SqlDialect, string[]>(
    DIALECTS.map((d) => [d, readTags(d)]),
  );
  const reference = byDialect.get(DIALECTS[0]) as string[];
  for (const dialect of DIALECTS.slice(1)) {
    const tags = byDialect.get(dialect) as string[];
    const same =
      tags.length === reference.length &&
      tags.every((tag, i) => tag === reference[i]);
    if (!same) {
      throw new Error(
        `Journaux désalignés ${when} : ${DIALECTS[0]} porte ` +
          `[${reference.join(", ")}] et ${dialect} porte [${tags.join(", ")}]. ` +
          `Les trois dialectes se génèrent ENSEMBLE — un tag publié est ` +
          `immuable, donc un désalignement ne se renumérote pas.`,
      );
    }
  }
  return reference;
}
