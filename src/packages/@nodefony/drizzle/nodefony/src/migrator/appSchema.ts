/**
 * Ce qu'une APPLICATION donne à lire à `drizzle-kit` — et comment on s'assure
 * qu'elle lui donne bien TOUT.
 *
 * ## Le mécanisme, et pourquoi c'est celui-là
 *
 * `drizzle-kit` est un process séparé qui lit des **fichiers** : il ne sait rien
 * d'un registre vivant. Et une entité enregistrée ne porte **aucune provenance
 * de fichier** — `IEntity.schema` est un objet d'exécution. On ne peut donc pas
 * « matérialiser le schéma depuis le registre » : cette voie a été explorée et
 * écartée, elle n'existe pas.
 *
 * Le sens est l'inverse : **les fichiers fournissent, le registre valide.**
 *
 * 1. On découvre les fichiers d'entités par la convention du générateur —
 *    `nodefony/entity/*.ts`, dans l'application et dans chacun de ses modules.
 * 2. On les IMPORTE pour voir ce qu'ils exportent vraiment : une table Drizzle
 *    se reconnaît (`is(value, Table)`), elle ne se devine pas à un nom.
 * 3. On écrit un module temporaire qui les **ré-exporte à plat**.
 * 4. Le registre sert de CONTRÔLE : une entité enregistrée que plus aucun
 *    fichier ne fournit est un refus qui la NOMME, jamais une migration
 *    silencieusement amputée — laquelle se graverait à vie dans le journal.
 *
 * ## Le ré-export doit être PLAT, sans exception
 *
 * `drizzle-kit` ne collecte que les tables exportées directement. Une table
 * nichée dans un objet exporté est ignorée **sans un mot** (mesuré : un fichier
 * exportant une table plate et une table nichée rend « 1 tables »). C'est
 * pourquoi le module temporaire ré-exporte chaque table sous un nom propre, et
 * jamais l'objet qui la contient.
 */
import fs from "node:fs/promises";
import { registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Table, getTableName, is } from "drizzle-orm";
import { entityRegistry } from "@nodefony/orm-core";
import { MySqlTable } from "drizzle-orm/mysql-core";
import { PgTable } from "drizzle-orm/pg-core";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import { FORMAT_MARKER } from "./kit";
import type { SqlDialect } from "../../interfaces/IDrizzleConfig";

/** Une table trouvée dans un fichier d'entité de l'application. */
export interface IDiscoveredTable {
  /** Chemin absolu du fichier qui l'exporte. */
  file: string;
  /** Nom sous lequel le fichier l'exporte (`postTable`, `PostEntity`…). */
  exportName: string;
  /** Nom de la table en base — c'est lui qui compte, pas l'identifiant JS. */
  tableName: string;
  /** Moteur pour lequel elle est écrite — `null` si aucun des trois. */
  dialect: SqlDialect | null;
}

/** Ce qu'un fichier d'entité a refusé de livrer. */
export interface IUnreadableEntityFile {
  /** Chemin absolu du fichier. */
  file: string;
  /** La cause, telle que l'import l'a rendue. */
  cause: string;
}

/** Résultat d'une découverte : ce qui a été lu, et ce qui a résisté. */
export interface IDiscoveredSchema {
  tables: IDiscoveredTable[];
  unreadable: IUnreadableEntityFile[];
}

/** Dossier des entités, relatif à une cible de scaffold. */
const ENTITY_DIR = ["nodefony", "entity"];

/**
 * Dialecte tel que `drizzle-kit` le nomme dans sa configuration.
 *
 * Il ne s'écrit pas comme le nôtre — `postgresql` chez lui, `postgres` chez
 * nous — et cette table est le seul endroit où l'écart existe.
 */
const KIT_DIALECT: Record<SqlDialect, string> = {
  sqlite: "sqlite",
  postgres: "postgresql",
  mysql: "mysql",
};

/**
 * Fichiers d'entités d'une cible (l'application, ou l'un de ses modules).
 *
 * Les `*.schema.ts` sont écartés : c'est la convention du générateur pour les
 * contrats d'entrée (Zod), qui n'ont rien à faire dans un schéma de base.
 *
 * @param targetDir - dossier d'une cible (contient `index.ts` + `nodefony/`).
 * @returns les chemins absolus, triés — l'ordre doit être le même partout.
 */
export async function entityFilesOf(targetDir: string): Promise<string[]> {
  const dir = path.join(targetDir, ...ENTITY_DIR);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (e) {
    // Une cible sans entités est le cas NORMAL (un module de routes, un module
    // de front) : ce n'est pas une anomalie, il n'y a rien à dire.
    //
    // 🔴 Mais SEULEMENT l'absence. Tout avaler faisait lire « cette cible n'a
    // pas d'entités » sur un défaut de droits ou un chemin qui n'est pas un
    // dossier — c'est-à-dire un schéma silencieusement AMPUTÉ, et une migration
    // écrite sans une table. Une migration ne se corrige pas : elle se
    // remplace, sur toutes les bases qui ont reçu la première.
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      throw e;
    }
    return [];
  }
  return names
    .filter((n) => n.endsWith(".ts") && !n.endsWith(".schema.ts"))
    .sort()
    .map((n) => path.join(dir, n));
}

/**
 * Importe des fichiers d'entités et relève les tables qu'ils exportent.
 *
 * L'import est la seule façon HONNÊTE de savoir ce qu'un fichier fournit : lire
 * un nom d'export au motif qu'il finit par `Table` marcherait sur le code que
 * le générateur écrit, et sur rien d'autre — or ces fichiers sont faits pour
 * être modifiés à la main, c'est même écrit dans leur en-tête.
 *
 * Un fichier qui refuse de s'importer n'est PAS ignoré : il est rendu à
 * l'appelant avec sa cause. C'est presque toujours le même défaut — un accès au
 * kernel à l'évaluation du module — et le taire produirait une migration
 * amputée là où il faut une phrase.
 *
 * @param files - chemins absolus des fichiers d'entités.
 * @returns les tables trouvées et les fichiers illisibles.
 */
export async function collectTables(
  files: readonly string[],
): Promise<IDiscoveredSchema> {
  const tables: IDiscoveredTable[] = [];
  const unreadable: IUnreadableEntityFile[] = [];
  const hooks = registerExtensionlessResolution();
  try {
    for (const file of files) {
      let mod: Record<string, unknown>;
      try {
        // Un chemin n'est pas une URL : sous Windows, `D:\…` verrait `d:` lu
        // comme un protocole.
        mod = (await import(pathToFileURL(file).href)) as Record<
          string,
          unknown
        >;
      } catch (e) {
        unreadable.push({
          file,
          cause: e instanceof Error ? e.message : String(e),
        });
        continue;
      }
      for (const [exportName, value] of Object.entries(mod)) {
        if (!is(value, Table)) {
          continue;
        }
        tables.push({
          file,
          exportName,
          tableName: getTableName(value),
          dialect: dialectOf(value),
        });
      }
    }
  } finally {
    hooks.deregister();
  }
  return { tables, unreadable };
}

/**
 * Moteur pour lequel une table est écrite.
 *
 * Une entité d'application est du Drizzle **natif** : `sqliteTable`, `pgTable` et
 * `mysqlTable` produisent trois objets différents, et une table écrite pour un
 * moteur est simplement IGNORÉE par l'outil quand il en génère un autre — sans
 * un mot, comme d'habitude. Constaté sur une application témoin : six tables
 * découvertes, quatre écrites, et un message qui annonçait six.
 *
 * @param table - table relevée dans un fichier d'entité.
 * @returns le dialecte, ou `null` si ce n'est aucun des trois.
 */
export function dialectOf(table: unknown): SqlDialect | null {
  if (is(table, SQLiteTable)) {
    return "sqlite";
  }
  if (is(table, PgTable)) {
    return "postgres";
  }
  if (is(table, MySqlTable)) {
    return "mysql";
  }
  return null;
}

/**
 * Fait résoudre `./voisin` comme le ferait un bundler — le temps de la lecture.
 *
 * Un fichier d'entité qui factorise ses colonnes dans un voisin l'importe en
 * TypeScript, donc **sans extension** : c'est ce que tout le monde écrit, ce que
 * les éditeurs proposent, et ce que `moduleResolution: "Bundler"` autorise. Node,
 * lui, applique la règle ESM et exige l'extension — un tel fichier est donc
 * illisible pour lui, alors qu'il se compile parfaitement.
 *
 * Constaté sur les entités du framework lui-même : neuf fichiers sur neuf
 * refusaient de s'importer, tous pour la même raison. Sans cette résolution, la
 * découverte n'aurait marché que sur les fichiers qui n'importent AUCUN voisin
 * — c'est-à-dire sur ce que le générateur écrit, et sur rien de ce qu'on écrit
 * ensuite.
 *
 * La portée est bornée au plus court : posée pour la lecture, retirée juste
 * après, y compris en cas d'échec.
 *
 * @returns le jeton de retrait des hooks.
 */
function registerExtensionlessResolution(): { deregister: () => void } {
  return registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context);
      } catch (e) {
        // On ne réessaie QUE ce cas : un chemin relatif sans extension. Tout
        // le reste — paquet absent, export inexistant — doit remonter tel
        // quel, sinon l'utilisateur reçoit une erreur sur le mauvais fichier.
        if (specifier.startsWith(".") && path.extname(specifier) === "") {
          return nextResolve(`${specifier}.ts`, context);
        }
        throw e;
      }
    },
  });
}

/**
 * Spécificateur d'import de `from` vers `to`, écrit pour VOYAGER.
 *
 * Un spécificateur s'écrit en `/` sur les trois systèmes — c'est du texte que
 * lit un outil, pas un accès disque. L'extension est explicite : le module
 * temporaire est compilé par l'outil, qui doit savoir quoi ouvrir sans deviner.
 *
 * @param fromFile - fichier qui contiendra l'import.
 * @param toFile - fichier visé.
 * @returns un spécificateur relatif, toujours préfixé `./` ou `../`.
 */
export function importSpecifier(fromFile: string, toFile: string): string {
  const rel = path.relative(path.dirname(fromFile), toFile);
  const posix = rel.split(path.sep).join("/");
  return posix.startsWith(".") ? posix : `./${posix}`;
}

/**
 * Écrit le module temporaire que `drizzle-kit` lira comme « le schéma ».
 *
 * Chaque table reçoit un alias unique et neutre : deux fichiers peuvent très
 * bien exporter deux tables sous le même identifiant JS, et un ré-export en
 * étoile les rendrait AMBIGUËS — l'ambiguïté n'est pas une erreur en ESM, c'est
 * une absence silencieuse. Le nom de la table en base, lui, n'est pas touché :
 * il vit dans l'appel `…Table("nom")`, pas dans l'identifiant.
 *
 * @param file - chemin du module à écrire.
 * @param tables - tables à ré-exporter, dans l'ordre de découverte.
 * @returns le contenu écrit (rendu pour les bancs).
 */
export async function writeSchemaModule(
  file: string,
  tables: readonly IDiscoveredTable[],
): Promise<string> {
  const lines = [
    "// Fichier ENGENDRÉ par `nodefony orm:generate` — il est réécrit à chaque",
    "// exécution et effacé à la fin. Ne rien y mettre à la main.",
    "//",
    "// Les ré-exports sont PLATS : drizzle-kit ne collecte que les tables",
    "// exportées directement, et ignore sans un mot celles qui sont nichées.",
    "",
  ];
  tables.forEach((t, i) => {
    lines.push(
      `export { ${t.exportName} as nf_${i}_${t.tableName.replace(/[^A-Za-z0-9_]/g, "_")} } from "${importSpecifier(file, t.file)}";`,
    );
  });
  const body = `${lines.join("\n")}\n`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body, "utf8");
  return body;
}

/**
 * Schéma PostgreSQL réellement visé par une URL de connexion.
 *
 * 🔴 L'outil d'introspection ne suit PAS le `search_path` porté par l'URL : il
 * lit `public`, quoi qu'on lui donne. Sans cette dérivation, adopter une
 * application logée dans un schéma dédié — le montage habituel d'une base
 * mutualisée — écrivait la référence des tables de `public`, c'est-à-dire
 * celles de quelqu'un d'autre, et déclarait absentes les siennes. Constaté sur
 * un serveur réel : la référence décrivait trois tables étrangères au projet.
 *
 * Deux formes sont reconnues, parce que les deux circulent : le `search_path`
 * passé dans `options`, et le paramètre `schema` que posent certains outils.
 * Une URL sans rien rend `null` — l'appelant laisse alors le défaut de l'outil,
 * qui est le bon.
 *
 * @param url - URL de connexion, telle que le connecteur la porte.
 * @returns le premier schéma du chemin de recherche, ou `null`.
 */
export function postgresSchemaOf(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const direct = parsed.searchParams.get("schema");
  if (direct !== null && direct.trim() !== "") {
    return direct.trim();
  }
  const options = parsed.searchParams.get("options");
  if (options === null) {
    return null;
  }
  const trouve = /(?:^|\s)-c\s*search_path=([^\s]+)/u.exec(options);
  const premier = trouve?.[1]?.split(",")[0]?.trim();
  return premier !== undefined && premier !== "" ? premier : null;
}

/**
 * Écrit la configuration `drizzle-kit` d'une génération d'application.
 *
 * 🔴 **Les chemins y sont RELATIFS, et ce n'est pas un style.** L'outil préfixe
 * son dossier de sortie par `./` : un chemin absolu devient `.//Users/…`, la
 * lecture échoue — et l'échec se présente comme un succès, puisque l'outil rend
 * 0 quand il rate. La configuration est donc écrite pour être lue depuis la
 * racine de l'application, qui est le dossier d'exécution.
 *
 * `tablesFilter` exclut ce que l'application ne possède pas : les tables du
 * framework et la table d'historique. Sans lui, une entité d'application qui
 * référence une table du framework la ferait entrer dans le diff, et la
 * migration porterait un second `CREATE TABLE` de cette table — qui échoue en
 * production, sur toute base déjà migrée.
 *
 * @param options - où écrire, quoi lire, où sortir, quoi exclure.
 * @returns le contenu écrit (rendu pour les bancs).
 */
export async function writeKitConfig({
  file,
  projectRoot,
  schemaFile,
  outDir,
  dialect,
  excludedTables,
  dbUrl,
}: {
  file: string;
  projectRoot: string;
  schemaFile: string;
  outDir: string;
  dialect: SqlDialect;
  excludedTables: readonly string[];
  /**
   * Coordonnées de connexion — posées UNIQUEMENT pour l'introspection.
   *
   * La génération, elle, ne touche aucune base : son diff se calcule entre les
   * instantanés du dossier et les entités. Écrire des coordonnées dans sa
   * configuration laisserait croire le contraire à qui relit le fichier, et
   * ferait porter à une commande de lecture pure le risque d'une connexion.
   */
  dbUrl?: string;
}): Promise<string> {
  const rel = (target: string): string =>
    `./${path.relative(projectRoot, target).split(path.sep).join("/")}`;
  // 🔴 TOUJOURS de la forme « tout, sauf … ». Une liste POSITIVE tue
  // l'introspection sur MySQL — code 1, sortie d'erreur VIDE, rien écrit —
  // alors qu'elle passe sur SQLite et PostgreSQL. Mesuré sur les trois moteurs
  // (`["*"]` et `["*", "!x"]` passent ; `["une_table"]` échoue).
  const filters = ["*", ...excludedTables.map((t) => `!${t}`)];
  // Le schéma n'est POSÉ que lorsqu'il est visé explicitement : sans quoi on
  // écraserait le défaut de l'outil, qui est déjà le bon.
  const schema =
    dbUrl !== undefined && dialect === "postgres"
      ? postgresSchemaOf(dbUrl)
      : null;
  const body =
    `// Fichier ENGENDRÉ par \`nodefony orm:generate\` — réécrit puis effacé.\n` +
    `import { defineConfig } from "drizzle-kit";\n\n` +
    `export default defineConfig({\n` +
    `  dialect: ${JSON.stringify(KIT_DIALECT[dialect])},\n` +
    `  schema: ${JSON.stringify(rel(schemaFile))},\n` +
    `  out: ${JSON.stringify(rel(outDir))},\n` +
    `  migrations: { prefix: "index" },\n` +
    `  tablesFilter: ${JSON.stringify(filters)},\n` +
    (schema === null ? "" : `  schemaFilter: ${JSON.stringify([schema])},\n`) +
    (dbUrl === undefined
      ? ""
      : `  dbCredentials: { url: ${JSON.stringify(dbUrl)} },\n`) +
    `});\n`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body, "utf8");
  return body;
}

/**
 * Version d'ENTRÉE écrite par `drizzle-kit` selon le dialecte.
 *
 * Elle n'est pas la version du journal (« 7 » partout) : c'est celle du format
 * d'instantané, et elle diffère par moteur. Les valeurs sont RELEVÉES sur les
 * journaux que l'outil a produits pour le framework, jamais devinées — une
 * entrée écrite à la main doit être indistinguable des siennes, sans quoi la
 * génération suivante repartirait de travers.
 */
const ENTRY_VERSION: Record<SqlDialect, string> = {
  sqlite: "6",
  postgres: "7",
  mysql: "5",
};

/** Une entrée de journal, telle que `drizzle-kit` l'écrit. */
interface IJournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

/** Le journal d'un dossier de migrations. */
interface IJournal {
  version: string;
  dialect: string;
  entries: IJournalEntry[];
}

/**
 * Écrit une migration LIBRE et son entrée de journal, sans `drizzle-kit`.
 *
 * C'est la porte de sortie du modèle déclaratif : une vue, un déclencheur, une
 * clé étrangère réelle, un remplissage de données ne se DÉDUISENT d'aucun
 * schéma. Sans elle, on n'aurait le choix qu'entre renoncer et écrire un
 * fichier à la main dans un journal dont le format n'est pas documenté — deux
 * façons de casser l'historique.
 *
 * Le fichier est vide de toute instruction : un squelette qui « propose » du
 * SQL est un squelette qu'on applique sans le lire.
 *
 * @param options - dossier de sortie, dialecte, nom de la migration.
 * @returns le tag attribué et le chemin du fichier écrit.
 * @throws Error si le journal existant est illisible — on n'en réécrit JAMAIS
 *   un par-dessus : il porte l'historique déjà appliqué en production.
 */
export async function writeCustomMigration({
  outDir,
  dialect,
  name,
  now = Date.now(),
}: {
  outDir: string;
  dialect: SqlDialect;
  name: string;
  now?: number;
}): Promise<{ tag: string; file: string }> {
  const journalFile = path.join(outDir, "meta", "_journal.json");
  let journal: IJournal = {
    version: "7",
    dialect: KIT_DIALECT[dialect] as string,
    entries: [],
  };
  let raw: string | null = null;
  try {
    raw = await fs.readFile(journalFile, "utf8");
  } catch {
    // Pas de journal : c'est la première migration de cette application.
  }
  if (raw !== null) {
    try {
      journal = JSON.parse(raw) as IJournal;
    } catch (e) {
      throw new Error(
        `Le journal « ${journalFile} » est illisible (${
          e instanceof Error ? e.message : String(e)
        }). Rien n'a été écrit : ce fichier porte la liste de ce qui a DÉJÀ été ` +
          `appliqué en production, et en réécrire un neuf ferait rejouer toutes ` +
          `les migrations sur une base qui les a déjà reçues.`,
        { cause: e },
      );
    }
  }
  const entries = [...(journal.entries ?? [])];
  const idx = entries.reduce((max, e) => Math.max(max, e.idx + 1), 0);
  const tag = `${String(idx).padStart(4, "0")}_${name}`;
  const file = path.join(outDir, `${tag}.sql`);
  await fs.mkdir(path.join(outDir, "meta"), { recursive: true });
  await fs.writeFile(
    file,
    `${FORMAT_MARKER}\n` +
      `-- Migration LIBRE « ${name} » — à écrire à la main.\n` +
      `--\n` +
      `-- Elle est déjà inscrite au journal : elle sera appliquée telle quelle,\n` +
      `-- une seule fois, dans l'ordre, et son empreinte sera gravée. La modifier\n` +
      `-- après application sera REFUSÉ — écrire une migration de plus, alors.\n` +
      `--\n` +
      `-- Séparer les instructions par « --> statement-breakpoint ».\n`,
    "utf8",
  );
  entries.push({
    idx,
    version: ENTRY_VERSION[dialect] as string,
    when: now,
    tag,
    breakpoints: true,
  });
  await fs.writeFile(
    journalFile,
    `${JSON.stringify({ ...journal, entries }, null, 2)}\n`,
    "utf8",
  );
  return { tag, file };
}

/** Une entité que le registre connaît, et la table qu'elle vise. */
export interface IExpectedEntity {
  /** Nom logique de l'entité, tel qu'il est enregistré. */
  entity: string;
  /** Nom de la table en base. */
  table: string;
}

/**
 * Ce que le registre attend et que les fichiers ne fournissent PAS.
 *
 * C'est le seul contrôle qu'un registre puisse rendre et qu'aucun outil de
 * génération ne rendra jamais : `drizzle-kit` ne sait pas ce qu'une application
 * a déclaré, il ne voit que ce qu'on lui donne à lire. Sans cette confrontation,
 * une entité dont le fichier a été déplacé, renommé, ou rendu illisible
 * disparaît de la migration **sans un mot** — et une migration ne se corrige
 * pas : elle est immuable dès qu'une base l'a reçue.
 *
 * Les tables du framework sont écartées des deux côtés : elles sont fournies par
 * une autre source, appliquée avant.
 *
 * @param expected - entités du registre, sur le connecteur visé.
 * @param providedTables - noms des tables que les fichiers découverts fournissent.
 * @param frameworkTables - noms des tables construites par le framework.
 * @returns les entités sans fournisseur, dans l'ordre reçu.
 */
export function missingProviders(
  expected: readonly IExpectedEntity[],
  providedTables: ReadonlySet<string>,
  frameworkTables: ReadonlySet<string>,
): IExpectedEntity[] {
  return expected.filter(
    ({ table }) => !providedTables.has(table) && !frameworkTables.has(table),
  );
}

/**
 * Les tables de l'application qui usurpent une table du framework.
 *
 * Deux `CREATE TABLE` pour un même nom : la migration passe sur une base vierge
 * et échoue sur toute base déjà migrée — c'est-à-dire en production, et nulle
 * part ailleurs. C'est le pire endroit pour découvrir la faute, donc on la dit
 * avant d'écrire quoi que ce soit.
 *
 * @param tables - tables fournies par les fichiers de l'application.
 * @param frameworkTables - noms des tables construites par le framework.
 * @returns les tables en conflit, avec le fichier qui les exporte.
 */
export function usurpedTables(
  tables: readonly IDiscoveredTable[],
  frameworkTables: ReadonlySet<string>,
): IDiscoveredTable[] {
  return tables.filter((t) => frameworkTables.has(t.tableName));
}

/**
 * Tables attendues sur un connecteur, telles que le REGISTRE les connaît.
 *
 * Le registre est la seule source qui sache ce que l'application DÉCLARE :
 * les fichiers disent ce qu'elle fournit, la base ce qu'elle porte, et c'est
 * le croisement des trois qui fait les verdicts. Deux commandes en dépendent —
 * la génération pour repérer une entité sans fichier, l'adoption pour ne lire
 * QUE les tables de l'application — et une seconde copie divergerait en
 * silence.
 *
 * @param connector - connecteur visé.
 * @returns les entités et leur table, dans l'ordre du registre.
 */
export function registeredTables(connector: string): IExpectedEntity[] {
  const out: IExpectedEntity[] = [];
  for (const entity of entityRegistry.list()) {
    if (entity.connector !== connector) {
      continue;
    }
    const schema = entity.schema as unknown;
    if (is(schema, Table)) {
      out.push({ entity: entity.name, table: getTableName(schema) });
    }
  }
  return out;
}
