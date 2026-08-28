import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SqlDialect } from "../../nodefony/config/config";
import { FORMAT_MARKER } from "../../nodefony/src/migrator/index";

/**
 * Fabrique de sources de migrations, pour les bancs de l'applicateur.
 *
 * Les bancs n'utilisent PAS les migrations livrées du framework : elles pèsent
 * dix tables, et un banc qui les rejoue mesure surtout drizzle-kit. Ce qu'on
 * veut éprouver ici, c'est l'applicateur — donc du SQL minuscule, dont on
 * contrôle l'ordre, le contenu et jusqu'aux fins de ligne.
 */

/** Une migration à écrire dans une source de test. */
export interface IFixtureMigration {
  /** Identité du fichier (`0000_init`). */
  tag: string;
  /** Statements, joints par le séparateur de drizzle-kit. */
  statements: string[];
  /** Écrire le fichier en CRLF plutôt qu'en LF. */
  crlf?: boolean;
  /** Marqueur de format à poser — celui du framework par défaut. */
  marker?: string;
}

/**
 * Écrit une source de migrations dans un dossier temporaire.
 *
 * @param dialect - sous-dossier de dialecte à peupler.
 * @param migrations - migrations à écrire, dans l'ordre du journal.
 * @param dir - dossier racine ; créé sous le temporaire du système si omis.
 * @returns le dossier racine de la source (celui qui contient `<dialecte>/`).
 */
export async function writeSource(
  dialect: SqlDialect,
  migrations: readonly IFixtureMigration[],
  dir?: string,
): Promise<string> {
  const root =
    dir ?? (await fs.mkdtemp(path.join(os.tmpdir(), "nf-migrator-")));
  const target = path.join(root, dialect);
  await fs.mkdir(path.join(target, "meta"), { recursive: true });
  await fs.writeFile(
    path.join(target, "meta", "_journal.json"),
    JSON.stringify(
      {
        version: "7",
        dialect,
        entries: migrations.map((migration, idx) => ({
          idx,
          version: "6",
          when: 1_700_000_000_000 + idx,
          tag: migration.tag,
          breakpoints: true,
        })),
      },
      null,
      2,
    ),
  );
  for (const migration of migrations) {
    await writeMigration(target, migration);
  }
  return root;
}

/**
 * (Ré)écrit un seul fichier de migration d'une source déjà créée.
 *
 * Sert les bancs de dérive : modifier le SQL d'une migration DÉJÀ appliquée est
 * précisément ce que l'applicateur doit refuser.
 *
 * @param dialectDir - dossier `<source>/<dialecte>`.
 * @param migration - migration à écrire.
 */
export async function writeMigration(
  dialectDir: string,
  migration: IFixtureMigration,
): Promise<void> {
  const body = [migration.marker ?? FORMAT_MARKER, ""]
    .concat(migration.statements.join("\n--> statement-breakpoint\n"))
    .join("\n");
  await fs.writeFile(
    path.join(dialectDir, `${migration.tag}.sql`),
    migration.crlf === true ? body.replace(/\n/g, "\r\n") : body,
  );
}

/**
 * Ajoute une migration à une source existante, journal compris.
 *
 * @param root - dossier racine de la source.
 * @param dialect - dialecte concerné.
 * @param migration - migration à ajouter.
 * @param idx - index de journal ; à la suite par défaut.
 */
export async function appendMigration(
  root: string,
  dialect: SqlDialect,
  migration: IFixtureMigration,
  idx?: number,
): Promise<void> {
  const dir = path.join(root, dialect);
  const journalPath = path.join(dir, "meta", "_journal.json");
  const journal = JSON.parse(await fs.readFile(journalPath, "utf8")) as {
    entries: { idx: number; tag: string; version: string; when: number }[];
  };
  const at =
    idx ??
    journal.entries.reduce((max, entry) => Math.max(max, entry.idx), -1) + 1;
  journal.entries.push({
    idx: at,
    version: "6",
    when: 1_700_000_000_000 + at,
    tag: migration.tag,
  });
  await fs.writeFile(journalPath, JSON.stringify(journal, null, 2));
  await writeMigration(dir, migration);
}

/**
 * Supprime un dossier temporaire de banc.
 *
 * @param root - dossier à retirer.
 */
export async function removeSource(root: string): Promise<void> {
  await fs.rm(root, { recursive: true, force: true });
}
