import fs from "node:fs/promises";
import path from "node:path";
import type { SqlDialect } from "../../config/config";
import { postgresSchemaOf, writeKitConfig } from "./appSchema";
import { runIntrospect } from "./kit";
import { openMigrationDriver, type IMigrationTarget } from "./drivers/index";
import type { ISchemaReader } from "./catalog";

/**
 * L'adoption d'une base qui EXISTAIT avant les migrations.
 *
 * ## Le trou que cette brique ferme
 *
 * Le générateur compare le code au **journal des fichiers**, jamais à la base.
 * Quand ce journal est vide — une application passée du mode dérivé, où le
 * démarrage fabrique le schéma, au mode de production, où il ne le fabrique
 * plus — il croit partir de rien et émet le schéma INITIAL : un `CREATE TABLE`
 * de tables qui existent déjà, avec leurs données. Le fichier est inapplicable,
 * et il empoisonne la suite : l'adoption l'inscrit comme appliqué, l'historique
 * affirme alors un schéma que la base n'a pas, et plus aucune commande n'offre
 * de geste. Mesuré au banc de découvrabilité : le seul chemin restant était de
 * détruire la base.
 *
 * La cause n'est pas le générateur — il fait ce qu'on lui donne à lire. C'est
 * l'**instantané** de référence qui manque. Le fabriquer depuis la base, et non
 * depuis le code, remet les trois sources d'accord : les fichiers décrivent
 * l'état réel, l'historique le déclare appliqué, et la génération suivante
 * produit l'`ALTER` qu'on attendait.
 *
 * ## Pourquoi la migration de référence est DÉCOMMENTÉE
 *
 * L'outil d'introspection rend son `CREATE TABLE` entre `/* … *\/`, avec une
 * ligne qui invite à le décommenter avant de l'exécuter. Le laisser commenté
 * donnerait une baseline qui ne recrée RIEN : l'historique serait complet et
 * une base neuve, montée depuis ces mêmes fichiers, sortirait vide. Une
 * migration doit rester rejouable depuis zéro — c'est ce qui permet de créer un
 * environnement de plus. Sur la base adoptée, elle n'est jamais exécutée :
 * l'adoption l'inscrit comme appliquée sans lancer une instruction.
 */

/** Ce que l'introspection a produit, une fois remise en forme. */
export interface IAdoptedBaseline {
  /** Tag final de la migration de référence, `0000_<nom>`. */
  tag: string;
  /** Chemin absolu du fichier SQL. */
  file: string;
  /**
   * Tables entrées dans la référence sans être déclarées par l'application.
   *
   * L'outil ne sait pas restreindre sa lecture à une liste de tables — il
   * n'accepte qu'une exclusion. Ce que la base porte en plus est donc LU, et
   * doit être NOMMÉ : à la génération suivante, une table de la référence
   * qu'aucune entité ne déclare est une table que le diff propose de
   * SUPPRIMER.
   */
  extraTables: string[];
  /**
   * Le corps a-t-il pu être DÉCOMMENTÉ ?
   *
   * Publié plutôt que supposé : si l'outil change sa mise en forme, une
   * baseline muette passerait pour une baseline rejouable, et le défaut ne se
   * verrait que le jour où quelqu'un monte un environnement neuf.
   */
  runnable: boolean;
}

/**
 * Les coordonnées de connexion, dans la forme que l'outil d'introspection lit.
 *
 * SQLite désigne un FICHIER, les autres une URL — et c'est le seul endroit où
 * cette distinction se fait, pour qu'elle ne se redécide pas à chaque appelant.
 *
 * @param target - cible résolue du connecteur.
 * @returns l'URL de connexion, ou `null` si la cible n'en porte aucune.
 */
export function introspectionUrl(target: IMigrationTarget): string | null {
  if (target.dialect === "sqlite") {
    return target.filename ?? null;
  }
  return target.url ?? null;
}

/** L'en-tête que l'outil pose devant un corps commenté. */
const ENTETE_INTROSPECTION =
  /^\s*--[^\n]*generated after introspecting[^\n]*\n(?:\s*--[^\n]*\n)*/u;

/**
 * Rend exécutable le corps qu'une introspection a mis en commentaire.
 *
 * Fonction PURE — c'est ce qui la rend éprouvable sans base et sans outil
 * tiers : une règle qui exige un sous-processus pour être vue rouge n'est
 * jamais vue rouge.
 *
 * Ne touche à RIEN si la forme attendue n'est pas là : rendre `null` laisse
 * l'appelant dire ce qu'il a constaté, au lieu de publier un fichier tronqué
 * par une expression écrite pour une autre version de l'outil.
 *
 * @param sql - le fichier tel que l'outil l'a écrit.
 * @returns le SQL exécutable, ou `null` si aucun bloc commenté n'a été trouvé.
 */
export function uncommentIntrospection(sql: string): string | null {
  const sansEntete = sql.replace(ENTETE_INTROSPECTION, "");
  const debut = sansEntete.indexOf("/*");
  const fin = sansEntete.lastIndexOf("*/");
  if (debut === -1 || fin === -1 || fin < debut) {
    return null;
  }
  const corps = sansEntete.slice(debut + 2, fin);
  const reste = `${sansEntete.slice(0, debut)}${sansEntete.slice(fin + 2)}`;
  // Ce qui vivait HORS du bloc n'est pas du SQL — c'étaient les délimiteurs et
  // les blancs qui les entouraient. Le vérifier plutôt que le supposer : un
  // jour où l'outil écrira deux blocs, on veut le savoir, pas en perdre un.
  if (reste.trim() !== "") {
    return null;
  }
  return `${corps.trim()}\n`;
}

/** Une entrée du journal des fichiers, telle que l'outil l'écrit. */
interface IJournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

/** Le journal des fichiers d'un dossier de migrations. */
interface IJournal {
  version: string;
  dialect: string;
  entries: IJournalEntry[];
}

/**
 * Lit le journal des FICHIERS d'un dossier de migrations.
 *
 * ⚠️ Ce journal n'est pas l'historique. Il vit dans le dépôt, il est versionné,
 * et il dit ce que le code CONNAÎT. L'historique, lui, vit dans la base et dit
 * ce qu'ELLE a reçu. Les confondre fait conclure « tout est appliqué » sur une
 * base qui n'a rien vu.
 *
 * @param outDir - dossier `<migrations>/<dialecte>`.
 * @returns le journal, ou `null` s'il n'y en a pas encore.
 */
export async function readJournal(outDir: string): Promise<IJournal | null> {
  try {
    const raw = await fs.readFile(
      path.join(outDir, "meta", "_journal.json"),
      "utf8",
    );
    return JSON.parse(raw) as IJournal;
  } catch {
    return null;
  }
}

/**
 * Donne à la migration de référence le nom que l'utilisateur a choisi.
 *
 * L'outil d'introspection tire un nom au hasard (`0000_futuristic_spectrum`) et
 * n'accepte pas qu'on le lui impose. Or ce tag est une IDENTITÉ : il est
 * enregistré dans chaque base qui reçoit la migration, et il ne se renomme plus
 * ensuite. Le fixer ici, une fois, avant que quiconque l'ait vu.
 *
 * @param outDir - dossier `<migrations>/<dialecte>`.
 * @param ancien - tag tiré par l'outil.
 * @param nouveau - tag voulu.
 * @returns le chemin du fichier SQL, sous son nom final.
 */
export async function renameTag(
  outDir: string,
  ancien: string,
  nouveau: string,
): Promise<string> {
  const cible = path.join(outDir, `${nouveau}.sql`);
  if (ancien !== nouveau) {
    await fs.rename(path.join(outDir, `${ancien}.sql`), cible);
    const journal = await readJournal(outDir);
    if (journal) {
      for (const entry of journal.entries) {
        if (entry.tag === ancien) {
          entry.tag = nouveau;
        }
      }
      await fs.writeFile(
        path.join(outDir, "meta", "_journal.json"),
        `${JSON.stringify(journal, null, 2)}\n`,
        "utf8",
      );
    }
  }
  return cible;
}

/**
 * Retire les modules que l'introspection dépose à côté de sa migration.
 *
 * `schema.ts` et `relations.ts` décrivent la base en TypeScript — utile à qui
 * repart de zéro, hors sujet ici : les entités de l'application sont déjà la
 * source du schéma. Les laisser dans le dossier des migrations y mettrait deux
 * descriptions du même schéma, dont une que personne ne met à jour.
 *
 * @param outDir - dossier `<migrations>/<dialecte>`.
 */
export async function dropIntrospectionModules(outDir: string): Promise<void> {
  await Promise.all(
    ["schema.ts", "relations.ts"].map((f) =>
      fs.rm(path.join(outDir, f), { force: true }),
    ),
  );
}

/**
 * Les tables que l'instantané fraîchement écrit décrit.
 *
 * Lues sur l'instantané et non sur le SQL : c'est lui qui sert de référence au
 * prochain diff, donc c'est lui qui dit ce qui a réellement été adopté. Le
 * fichier `.sql`, lui, n'est qu'un rendu.
 *
 * @param outDir - dossier `<migrations>/<dialecte>`.
 * @returns les noms de tables, ou `[]` si l'instantané est illisible.
 */
export async function snapshotTables(outDir: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(
      path.join(outDir, "meta", "0000_snapshot.json"),
      "utf8",
    );
    const snapshot = JSON.parse(raw) as {
      tables?: Record<string, { name?: string }>;
    };
    return Object.values(snapshot.tables ?? {}).map(
      (t, i) => t.name ?? Object.keys(snapshot.tables ?? {})[i] ?? "",
    );
  } catch {
    return [];
  }
}

/** Une colonne d'index, telle que l'instantané de l'outil la décrit. */
interface ISnapshotIndexColumn {
  expression?: string;
  isExpression?: boolean;
  opclass?: string;
}

/** Un index, tel que l'instantané de l'outil le décrit. */
interface ISnapshotIndex {
  name?: string;
  columns?: ISnapshotIndexColumn[];
}

/** Une table, telle que l'instantané de l'outil la décrit. */
interface ISnapshotTable {
  schema?: string;
  indexes?: Record<string, ISnapshotIndex>;
  columns?: Record<string, ISnapshotColumn>;
}

/** Une colonne, telle que l'instantané de l'outil la décrit. */
interface ISnapshotColumn {
  type?: string;
}

/** Une séquence, telle que l'instantané de l'outil la décrit. */
interface ISnapshotSequence {
  name?: string;
  schema?: string;
}

/**
 * L'instantané écrit par l'outil, réduit à ce qu'on relit.
 *
 * Volontairement PARTIEL : on ne redécrit pas un format tiers qu'on ne
 * maîtrise pas — le reste traverse par la sérialisation, intact.
 */
interface ISnapshotDocument {
  tables?: Record<string, ISnapshotTable>;
  sequences?: Record<string, ISnapshotSequence>;
  schemas?: Record<string, string>;
}

/**
 * Rend utilisable une référence que l'introspection vient d'écrire.
 *
 * L'outil rend ce qu'il a LU, fidèlement. Deux fidélités rendent pourtant le
 * fichier inutilisable, et il faut les défaire — c'est la même famille de
 * geste que le décommentage du corps : l'artefact est exact, personne ne peut
 * s'en servir.
 *
 * ## 1. Les objets d'une table EXCLUE
 *
 * L'exclusion porte sur les tables, jamais sur ce qui gravite autour. La table
 * d'historique est écartée — c'est le framework qui la crée —, mais sa
 * SÉQUENCE, elle, entre dans la référence. Deux conséquences, toutes deux
 * constatées sur un serveur : la référence rejouée sur un environnement neuf
 * échoue (la séquence existe déjà, posée par les migrations du framework), et
 * la génération suivante propose de la SUPPRIMER — ce que la base refuse,
 * puisque la table d'historique en dépend. L'adoption se retrouve alors dans
 * l'état qu'elle existe pour éviter : un historique en place, et plus aucune
 * commande qui passe.
 *
 * ## 2. La qualification de schéma
 *
 * Une application peut vivre dans un schéma autre que `public` — le montage
 * habituel d'une base mutualisée, obtenu par le chemin de recherche de la
 * connexion. Les entités, elles, ne portent aucun schéma : `pgTable("article")`
 * désigne `public.article` pour l'outil de comparaison, quand l'introspection
 * rend `nf_app.article`. Au premier champ ajouté, l'outil voit une table qui
 * disparaît et une autre qui apparaît, et demande s'il s'agit d'un RENOMMAGE :
 * sans terminal la commande s'arrête, avec un terminal répondre « oui » écrit
 * un `ALTER TABLE … RENAME` qui déplacerait les données.
 *
 * On retire donc la qualification, ce qui rétablit la symétrie avec les
 * entités. À l'exécution, le chemin de recherche de la connexion place les
 * tables là où elles doivent être : c'est déjà lui qui décide, l'adoption
 * cesse simplement de le contredire.
 *
 * ## 3. Le booléen de MySQL
 *
 * `BOOLEAN` est un SYNONYME de `TINYINT(1)` en MySQL : le serveur ne garde que
 * la forme physique, et l'introspection ne peut donc rendre que `tinyint(1)`.
 * L'outil de comparaison, lui, compare des noms de type : il voit une
 * différence là où la base n'en a aucune, et propose un `MODIFY COLUMN` sur
 * chaque booléen — refusé ensuite comme destructif. Une application MySQL qui
 * adopte sa base se retrouve donc bloquée au premier champ ajouté, pour une
 * table qu'elle n'a jamais touchée.
 *
 * La forme déclarée est rétablie. Elle ne peut écraser aucune intention : dans
 * une entité, `tinyint()` rend `tinyint` sans largeur — vérifié au source
 * (`drizzle-orm/mysql-core/columns/tinyint.js`) —, et seul `boolean()` produit
 * `tinyint(1)`. Sur un DDL écrit à la main hors de l'ORM, la réécriture reste
 * exacte : les deux formes désignent la même colonne.
 *
 * @param outDir - dossier `<migrations>/<dialecte>`.
 * @param options.dialect - dialecte lu ; seul MySQL a le synonyme booléen.
 * @param file - fichier SQL de la référence.
 * @param options.schema - schéma effectivement lu, ou `null` (hors PostgreSQL,
 *   ou lecture dans `public` : il n'y a alors rien à déqualifier).
 * @param options.excludedTables - tables écartées de la lecture, dont les
 *   objets satellites doivent l'être aussi.
 * @param options.stripTables - tables que l'outil a LUES faute de pouvoir les
 *   exclure, et qu'il faut retirer du résultat (cf `lectureSansExclusion`).
 */
export async function normalizeIntrospection(
  outDir: string,
  file: string,
  options: {
    schema: string | null;
    excludedTables: readonly string[];
    stripTables?: readonly string[];
    dialect?: SqlDialect;
  },
): Promise<void> {
  const { schema, excludedTables } = options;
  const stripTables = options.stripTables ?? [];
  const qualifie = schema !== null && schema !== "public";

  /** Une séquence appartient-elle à une table qu'on a écartée ? */
  const satellite = (nom: string): boolean =>
    excludedTables.some((t) => nom.startsWith(`${t}_`));

  const snapshotFile = path.join(outDir, "meta", "0000_snapshot.json");
  const sequencesRetirees: string[] = [];
  /** Colonnes booléennes rendues à leur forme déclarée (MySQL). */
  let booleens = 0;
  let brut: string | null = null;
  try {
    brut = await fs.readFile(snapshotFile, "utf8");
  } catch {
    // Pas d'instantané lisible : on normalise ce qu'on peut (le SQL), plutôt
    // que d'échouer sur un fichier dont l'absence ne change rien au reste.
    brut = null;
  }
  if (brut !== null) {
    const doc = JSON.parse(brut) as ISnapshotDocument;
    let modifie = false;

    // 🔴 On ne CRÉE aucun champ : un instantané sqlite n'a pas de séquences, et
    // lui en poser une — fût-elle vide — le rend « malformé » pour l'outil qui
    // le relira. On ne touche qu'à ce qui existe.
    if (doc.sequences !== undefined) {
      const sequences: Record<string, ISnapshotSequence> = {};
      for (const [cle, seq] of Object.entries(doc.sequences)) {
        const nom = seq.name ?? cle.split(".").pop() ?? cle;
        if (satellite(nom)) {
          sequencesRetirees.push(nom);
          modifie = true;
          continue;
        }
        const clef =
          qualifie && cle.startsWith(`${schema}.`)
            ? `public.${cle.slice(schema.length + 1)}`
            : cle;
        sequences[clef] = qualifie ? { ...seq, schema: "public" } : seq;
        if (clef !== cle) {
          modifie = true;
        }
      }
      doc.sequences = sequences;
    }

    if (qualifie && doc.tables !== undefined) {
      const tables: Record<string, ISnapshotTable> = {};
      for (const [cle, table] of Object.entries(doc.tables)) {
        const clef = cle.startsWith(`${schema}.`)
          ? `public.${cle.slice(schema.length + 1)}`
          : cle;
        tables[clef] = { ...table, schema: "" };
        if (clef !== cle) {
          modifie = true;
        }
      }
      doc.tables = tables;
      if (doc.schemas !== undefined) {
        doc.schemas = {};
      }
    }

    if (options.dialect === "mysql" && doc.tables !== undefined) {
      for (const table of Object.values(doc.tables)) {
        for (const colonne of Object.values(table.columns ?? {})) {
          if (colonne.type === "tinyint(1)") {
            colonne.type = "boolean";
            booleens += 1;
            modifie = true;
          }
        }
      }
    }

    if (stripTables.length > 0 && doc.tables !== undefined) {
      const aRetirer = new Set(stripTables);
      const gardees: Record<string, ISnapshotTable> = {};
      for (const [cle, table] of Object.entries(doc.tables)) {
        if (aRetirer.has(cle.split(".").pop() ?? cle)) {
          modifie = true;
          continue;
        }
        gardees[cle] = table;
      }
      doc.tables = gardees;
    }

    if (modifie) {
      await fs.writeFile(snapshotFile, JSON.stringify(doc, null, 2), "utf8");
    }
  }

  if (
    !qualifie &&
    sequencesRetirees.length === 0 &&
    stripTables.length === 0 &&
    booleens === 0
  ) {
    // Rien à défaire : ne pas réécrire un fichier qu'on n'a pas changé.
    return;
  }
  let sql = await fs.readFile(file, "utf8");
  if (booleens > 0) {
    // La même correction sur le SQL : l'instantané sert à comparer, le fichier
    // sert à rejouer — les deux doivent dire la même chose, sans quoi la
    // référence rejouée sur un environnement neuf recréerait l'écart.
    sql = sql.replace(/\btinyint\(1\)/giu, "boolean");
  }
  if (qualifie) {
    // La création du schéma n'a rien à faire dans une référence : il existe,
    // puisqu'on vient d'y lire des tables.
    sql = sql
      .replace(
        new RegExp(`^CREATE SCHEMA "${schema}";\\s*(?:-->[^\\n]*\\n)?`, "gmu"),
        "",
      )
      .replaceAll(`"${schema}".`, "");
  }
  for (const nom of sequencesRetirees) {
    sql = sql.replace(
      new RegExp(
        `^CREATE SEQUENCE "${nom}"[^;]*;(?:\\s*-->[^\\n]*)?\\n?`,
        "gmu",
      ),
      "",
    );
  }
  for (const nom of stripTables) {
    const ident = `[\`"]?${nom.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}[\`"]?`;
    sql = sql
      // Le corps d'un `CREATE TABLE` ne porte pas de `;` : sa fin est la
      // parenthèse fermante en début de ligne, suivie du point-virgule.
      .replace(
        new RegExp(
          `^CREATE TABLE ${ident} \\([\\s\\S]*?^\\);(?:\\s*-->[^\\n]*)?\\n?`,
          "gmu",
        ),
        "",
      )
      // Puis ses satellites, qui vivent en instructions séparées.
      .replace(
        new RegExp(
          `^CREATE (?:UNIQUE )?INDEX [^;]*? ON ${ident}[^;]*;(?:\\s*-->[^\\n]*)?\\n?`,
          "gmu",
        ),
        "",
      )
      .replace(
        new RegExp(`^ALTER TABLE ${ident}[^;]*;(?:\\s*-->[^\\n]*)?\\n?`, "gmu"),
        "",
      );
  }
  await fs.writeFile(file, sql, "utf8");
}

/**
 * Parmi les tables qu'on s'apprête à CRÉER, celles que la base porte déjà.
 *
 * 🔴 **La base est la seule source, et elle est INTERROGÉE.** Il serait tentant
 * de déduire la présence d'une table de son absence dans une comparaison au
 * code : c'est ce que faisait la première version, et le raccourci a produit un
 * refus mensonger. La comparaison ne connaît que le REGISTRE — les entités
 * qu'une application enregistre à son démarrage — alors que la génération part
 * des FICHIERS, qui en contiennent d'autres : celles d'un module désactivé,
 * d'un connecteur différent, ou d'un module pas encore câblé. Une table hors
 * registre n'est ni manquante ni présente : elle est INCONNUE, et déduire sa
 * présence faisait refuser la première migration d'une application en nommant
 * sept tables qui n'existaient nulle part — puis renvoyait vers une adoption
 * qui échouait pour la raison inverse. Deux commandes qui se prescrivent l'une
 * l'autre en se refusant : une impasse, exactement celle que ce chantier
 * existe pour fermer.
 *
 * Le lecteur est INJECTÉ plutôt que construit ici : c'est ce qui rend la règle
 * éprouvable sans kernel ni serveur, et une règle qu'on ne peut pas voir rouge
 * n'est pas une règle.
 *
 * Le coût est d'une requête de catalogue par table, et l'appelant ne s'en sert
 * que lorsque le journal est vide — une fois dans la vie d'une application.
 *
 * @param reader - lecteur de catalogue ouvert sur la base visée.
 * @param tables - tables que la migration créerait.
 * @returns les tables déjà en base, dans l'ordre reçu.
 */
export async function tablesPresentIn(
  reader: ISchemaReader,
  tables: readonly string[],
): Promise<string[]> {
  const presentes: string[] = [];
  for (const nom of tables) {
    if (await reader.tableExists(nom)) {
      presentes.push(nom);
    }
  }
  return presentes;
}

/**
 * Ce que le serveur dit de LUI-MÊME — constaté, jamais déduit d'un port.
 *
 * Sert uniquement à expliquer un échec : c'est le seul moment où la question
 * se pose, et le coût d'une requête est alors sans importance.
 *
 * @param target - cible du connecteur.
 * @returns la bannière de version, ou `null` si le serveur n'a pas répondu.
 */
async function serverVersion(target: IMigrationTarget): Promise<string | null> {
  try {
    const pilote = await openMigrationDriver(target);
    try {
      const lignes = await pilote.query<{ v: string }>("SELECT VERSION() AS v");
      return lignes[0]?.v ?? null;
    } finally {
      await pilote.close();
    }
  } catch {
    return null;
  }
}

/**
 * Explique l'échec d'une lecture de schéma, avec ce qu'on en SAIT.
 *
 * L'outil meurt sans un mot — code non nul, sortie d'erreur vide. Le laisser
 * remonter tel quel enverrait chercher du côté des identifiants ou du réseau,
 * là où il n'y a rien. Une cause est connue et reproductible, elle mérite
 * d'être nommée.
 *
 * @param target - cible du connecteur.
 * @param cause - l'erreur telle que l'outil l'a produite.
 * @returns l'erreur à lever.
 */
async function expliquerEchec(
  target: IMigrationTarget,
  cause: Error,
): Promise<Error> {
  const version = await serverVersion(target);
  if (version !== null && /mariadb/i.test(version)) {
    return new Error(
      `La lecture du schéma a échoué sur ce serveur (MariaDB ${version}).\n\n` +
        `  MariaDB ne porte pas de type JSON natif : il l'écrit en « longtext »\n` +
        `  assorti d'une contrainte « CHECK (json_valid(…)) ». L'outil qui lit les\n` +
        `  schémas ne sait pas lire ces contraintes, et il s'arrête sans rien dire —\n` +
        `  y compris quand les tables concernées ne sont PAS celles qu'on adopte :\n` +
        `  il lit la base ENTIÈRE avant de filtrer. Les tables du framework en\n` +
        `  portent, donc le cas est systématique ici.\n\n` +
        `  Le repli, sur ce serveur : écrire la référence à la main.\n` +
        `    1. relever le schéma existant  — SHOW CREATE TABLE <table>\n` +
        `    2. nodefony orm:generate --custom --name base_existante\n` +
        `    3. coller ce schéma dans le fichier produit\n` +
        `    4. nodefony orm:migrate:baseline\n\n` +
        `  Sur MySQL Community, PostgreSQL et SQLite, « --from-database » fait ces\n` +
        `  quatre gestes seul.`,
      { cause },
    );
  }
  return cause;
}

/**
 * Les contraintes d'unicité de COLONNE que l'introspection n'a pas rendues.
 *
 * 🔴 En SQLite, `col text UNIQUE` ne crée pas d'index nommé : le moteur pose un
 * index INTERNE (`sqlite_autoindex_…`) que l'outil d'introspection ne liste
 * pas. La référence adoptée sortait donc SANS la contrainte, alors que la base
 * la porte — et un index unique COMPOSITE, lui, survivait, ce qui rendait
 * l'écart d'autant plus difficile à voir.
 *
 * La perte ne se constate pas sur la base adoptée : elle a déjà sa contrainte.
 * Elle frappe la base SUIVANTE — un environnement de test, un exemplaire neuf —
 * recréée depuis ce fichier, qui accepte alors des doublons que le schéma
 * interdisait. Aucune erreur n'est levée : c'est la donnée qui devient fausse.
 *
 * On les rend sous forme de `CREATE UNIQUE INDEX`, et non en réécrivant le
 * `CREATE TABLE` : un index séparé est portable, s'ajoute sans toucher au corps
 * produit par l'outil, et porte exactement la même garantie.
 *
 * Les autres moteurs n'ont pas ce défaut — leur catalogue expose la contrainte,
 * et l'introspection la rend (vérifié : PostgreSQL et MySQL passent le cas qui
 * fait tomber SQLite).
 *
 * @param target - cible du connecteur adopté.
 * @param tables - tables retenues par l'adoption.
 * @param sql - la référence telle que l'outil l'a écrite.
 * @returns les instructions à ajouter, vides s'il n'en manque aucune.
 */
/**
 * Les colonnes d'index, telles que PostgreSQL les RÉÉCRIT lui-même.
 *
 * 🔴 L'introspection rend UNE classe d'opérateur pour tout l'index et
 * l'applique à CHAQUE colonne. Sur un index composite dont les colonnes n'ont
 * pas le même type, le résultat est du SQL qui ne s'exécute pas :
 * `("author" timestamptz_ops, "created_at" timestamptz_ops)` quand `author`
 * est un `uuid` — « operator class "timestamptz_ops" does not accept data
 * type uuid ».
 *
 * La perte ne se constate pas sur la base adoptée : elle a déjà son index.
 * Elle frappe l'exemplaire SUIVANT — et elle frappe mal, car la migration
 * s'arrête sur ce `CREATE INDEX` : aucune table suivante n'est créée, et les
 * erreurs que l'on voit ensuite ne parlent plus que de tables absentes, à
 * l'autre bout de la chaîne. Même famille que les contraintes d'unicité
 * perdues : l'outil est fidèle à ce qu'il croit avoir lu, pas à la base.
 *
 * On ne DEVINE pas la bonne classe, on la demande au moteur. `pg_indexes`
 * rend la définition que PostgreSQL écrirait lui-même pour recréer l'index,
 * et il n'y nomme que les classes qui ne sont PAS celles du type — ce qui
 * préserve une classe volontaire (`varchar_pattern_ops`) sans jamais en
 * inventer une.
 *
 * @param target - coordonnées de la base visée.
 * @param schema - schéma PostgreSQL où les tables ont été lues.
 * @param tables - tables adoptées, dont on relit les index.
 * @returns pour chaque nom d'index, la liste de colonnes que le moteur écrit.
 */
async function colonnesDIndexReelles(
  target: IMigrationTarget,
  schema: string,
  tables: readonly string[],
): Promise<Map<string, string>> {
  const parNom = new Map<string, string>();
  if (target.dialect !== "postgres" || tables.length === 0) {
    return parNom;
  }
  const pilote = await openMigrationDriver(target);
  try {
    const trous = tables.map(() => "?").join(",");
    const lignes = await pilote.query<{
      indexname: string;
      indexdef: string;
    }>(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = ? AND tablename IN (${trous})`,
      [schema, ...tables],
    );
    for (const ligne of lignes) {
      // La définition du moteur se termine par la liste de colonnes entre
      // parenthèses : `… USING btree (author, created_at)`. On n'en retient
      // QUE cette liste — le reste du statement produit par l'outil (nom,
      // table, méthode) est déjà juste, et le réécrire ferait diverger deux
      // façons d'écrire la même chose.
      const colonnes = /\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*$/u.exec(
        ligne.indexdef,
      );
      if (colonnes?.[1] !== undefined) {
        parNom.set(ligne.indexname, colonnes[1].trim());
      }
    }
  } finally {
    await pilote.close();
  }
  return parNom;
}

/**
 * Réécrit les listes de colonnes d'index que l'outil a rendues fausses.
 *
 * Agit sur les DEUX artefacts, et c'est nécessaire : le fichier SQL est ce
 * qu'on applique, l'instantané est ce à quoi la génération SUIVANTE compare.
 * Ne corriger que le premier laisserait un instantané qui décrit un index que
 * la base n'a pas — la génération d'après proposerait de le refaire, sans que
 * personne comprenne pourquoi.
 *
 * @param sql - corps exécutable de la référence.
 * @param outDir - dossier de sortie, qui porte `meta/0000_snapshot.json`.
 * @param reelles - listes de colonnes rendues par le moteur, par nom d'index.
 * @returns le SQL corrigé.
 */
async function reecrireIndexComposites(
  sql: string,
  outDir: string,
  reelles: ReadonlyMap<string, string>,
): Promise<string> {
  if (reelles.size === 0) {
    return sql;
  }
  let corrige = sql;
  for (const [nom, colonnes] of reelles) {
    const echappe = nom.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    corrige = corrige.replace(
      new RegExp(
        `(CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+"${echappe}"[^;]*?USING\\s+\\w+\\s*)\\([^;]*?\\)`,
        "giu",
      ),
      `$1(${colonnes})`,
    );
  }

  const snapshotFile = path.join(outDir, "meta", "0000_snapshot.json");
  try {
    const doc = JSON.parse(
      await fs.readFile(snapshotFile, "utf8"),
    ) as ISnapshotDocument;
    let modifie = false;
    for (const table of Object.values(doc.tables ?? {})) {
      for (const [cle, index] of Object.entries(table.indexes ?? {})) {
        const colonnes = reelles.get(index.name ?? cle);
        if (colonnes === undefined) {
          continue;
        }
        // Une classe d'opérateur ne se garde que si le moteur la NOMME : il
        // tait celles qui sont le défaut du type, et c'est exactement le
        // partage qu'on veut refaire ici.
        for (const colonne of index.columns ?? []) {
          const nom = colonne.expression;
          const nommee =
            nom === undefined || colonne.isExpression === true
              ? undefined
              : new RegExp(
                  `(?:^|,)\\s*"?${nom.replace(
                    /[.*+?^${}()|[\]\\]/gu,
                    "\\$&",
                  )}"?\\s+(\\w+_ops)\\b`,
                  "u",
                ).exec(colonnes)?.[1];
          if (nommee === undefined) {
            if (colonne.opclass !== undefined) {
              delete colonne.opclass;
              modifie = true;
            }
          } else if (colonne.opclass !== nommee) {
            colonne.opclass = nommee;
            modifie = true;
          }
        }
      }
    }
    if (modifie) {
      await fs.writeFile(snapshotFile, JSON.stringify(doc, null, 2), "utf8");
    }
  } catch {
    // Pas d'instantané lisible : le SQL corrigé reste le gain principal, et
    // échouer ici priverait l'utilisateur d'une référence applicable.
  }
  return corrige;
}

async function uniquesDeColonnePerdues(
  target: IMigrationTarget,
  tables: readonly string[],
  sql: string,
): Promise<string[]> {
  if (target.dialect !== "sqlite") {
    return [];
  }
  const ajouts: string[] = [];
  const pilote = await openMigrationDriver(target);
  try {
    for (const table of tables) {
      const ident = `"${table.replace(/"/gu, '""')}"`;
      // `PRAGMA` n'accepte pas de paramètre lié : le nom vient du CATALOGUE,
      // jamais d'une saisie, et il est cité comme un identifiant.
      const index = await pilote.query<{
        name: string;
        unique: number;
        origin: string;
      }>(`PRAGMA index_list(${ident})`);
      for (const idx of index) {
        // `origin: "u"` = né d'une clause UNIQUE ; `"c"` = un CREATE INDEX, que
        // l'outil rend déjà ; `"pk"` = la clé primaire, qui est dans la table.
        if (Number(idx.unique) !== 1 || idx.origin !== "u") {
          continue;
        }
        const colonnes = await pilote.query<{ name: string }>(
          `PRAGMA index_info("${String(idx.name).replace(/"/gu, '""')}")`,
        );
        const noms = colonnes.map((c) => c.name).filter((n) => n !== null);
        if (noms.length === 0) {
          continue;
        }
        const nom = `${table}_${noms.join("_")}_key`;
        // Ne rien ajouter deux fois : l'outil a pu rendre cet index lui-même.
        if (sql.includes(nom)) {
          continue;
        }
        const cibles = noms.map((n) => `\`${n}\``).join(",");
        ajouts.push(
          `CREATE UNIQUE INDEX \`${nom}\` ON \`${table}\` (${cibles});`,
        );
      }
    }
  } finally {
    await pilote.close();
  }
  return ajouts;
}

/**
 * Fabrique la migration de RÉFÉRENCE d'une base déjà en place.
 *
 * Orchestration complète du côté fichiers — la connexion est lue, rien n'est
 * écrit dans la base : c'est l'appelant qui décide ensuite d'inscrire cette
 * migration dans l'historique.
 *
 * Le dossier de travail ne survit à rien, ni au succès ni à l'échec : un module
 * temporaire laissé derrière serait relu par le prochain outil qui balaie les
 * sources, et personne ne saurait d'où il sort.
 *
 * @param options - racine du projet, dossier de sortie, cible, tables exclues,
 *   tables déclarées, nom voulu pour la migration, dossier de travail.
 * @returns le tag final, le fichier, et si son corps est exécutable.
 * @throws Error si la base ne porte aucune table à adopter, ou si l'outil échoue.
 */
export async function adoptFromDatabase({
  projectRoot,
  outDir,
  dialect,
  target,
  excludedTables,
  declaredTables,
  name,
  workDir,
}: {
  projectRoot: string;
  outDir: string;
  dialect: SqlDialect;
  target: IMigrationTarget;
  /** Tables à ne PAS lire — celles du framework, et l'historique. */
  excludedTables: readonly string[];
  /**
   * Tables que l'application DÉCLARE.
   *
   * Sert à CONSTATER ce que la lecture a ramassé, jamais à le restreindre :
   * l'outil n'accepte qu'une exclusion (une liste positive tue son
   * introspection sur MySQL). Une base partagée avec un autre logiciel voit
   * donc ses tables entrer dans la référence — le taire les ferait proposer à
   * la suppression à la génération suivante, sans que personne l'ait vu venir.
   */
  declaredTables: readonly string[];
  name: string;
  workDir: string;
}): Promise<IAdoptedBaseline> {
  if (declaredTables.length === 0) {
    throw new Error(
      "Cette application ne déclare aucune table sur ce connecteur : il n'y a rien à adopter.",
    );
  }
  const url = introspectionUrl(target);
  if (url === null) {
    throw new Error(
      "La base visée n'a pas de coordonnées de connexion : impossible de lire son schéma.",
    );
  }
  const configFile = path.join(workDir, `introspect.${dialect}.config.ts`);
  const relatif = (cible: string): string =>
    path.relative(projectRoot, cible).split(path.sep).join("/");
  // 🔴 En MySQL, EXCLURE une table qui porte une contrainte `CHECK` tue
  // l'introspection : code non nul, sortie d'erreur VIDE, rien écrit. L'outil
  // lit les contraintes de la base ENTIÈRE — comme il en lit les tables — puis
  // échoue à rattacher celles dont la table ne figure pas dans son résultat.
  // Mesuré sur MySQL 8.4, les trois cas isolés : exclure la table PORTEUSE du
  // `CHECK` échoue, exclure une table sans `CHECK` passe, ne rien exclure
  // passe. Les tables du framework en portent une (`idempotency_key`), donc
  // le cas est systématique — et il ne se voyait pas en local, où la même
  // variable désigne MariaDB, sur lequel l'adoption est refusée en amont.
  //
  // On lit donc TOUT, et l'on retire après coup : le filtrage change de place,
  // jamais de résultat. Ce que l'outil ne sait pas faire, le produit le fait.
  const lectureSansExclusion = dialect === "mysql" && excludedTables.length > 0;
  try {
    await writeKitConfig({
      file: configFile,
      projectRoot,
      // L'introspection ne lit aucun schéma déclaré : elle en PRODUIT un. Le
      // chemin doit exister dans la configuration, le fichier n'a pas à exister.
      schemaFile: path.join(workDir, `schema.${dialect}.ts`),
      outDir,
      dialect,
      excludedTables: lectureSansExclusion ? [] : excludedTables,
      dbUrl: url,
    });
    try {
      runIntrospect({
        cwd: projectRoot,
        configRel: relatif(configFile),
        label: `la base du connecteur (${dialect})`,
      });
    } catch (e) {
      throw await expliquerEchec(target, e as Error);
    }
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }

  const journal = await readJournal(outDir);
  const premiere = journal?.entries[0];
  if (!premiere) {
    // L'outil rend `0` même quand il n'écrit rien : sans cette lecture, une
    // base vide passerait pour adoptée, et l'historique affirmerait un schéma
    // que personne n'a jamais posé.
    throw new Error(
      "La lecture du schéma n'a produit aucune migration : cette base ne porte " +
        `aucune des tables de l'application (${declaredTables.join(", ")}).`,
    );
  }
  const tag = `0000_${name}`;
  const file = await renameTag(outDir, premiere.tag, tag);
  await dropIntrospectionModules(outDir);
  const schema = dialect === "postgres" ? postgresSchemaOf(url) : null;
  // Avant toute lecture de l'instantané : c'est lui qu'on vient de normaliser.
  await normalizeIntrospection(outDir, file, {
    schema,
    excludedTables,
    stripTables: lectureSansExclusion ? excludedTables : [],
    dialect,
  });
  const lues = await snapshotTables(outDir);
  const declarees = new Set(declaredTables);
  const brut = await fs.readFile(file, "utf8");
  const executable = uncommentIntrospection(brut);
  if (executable !== null) {
    // Ce que l'introspection a laissé derrière elle, remis AVANT l'écriture :
    // le fichier livré est le seul artefact qui compte.
    const manquants = await uniquesDeColonnePerdues(target, lues, executable);
    const complet =
      manquants.length === 0
        ? executable
        : `${executable.trimEnd()}\n--> statement-breakpoint\n${manquants.join(
            "\n--> statement-breakpoint\n",
          )}\n`;
    // Puis ce qu'elle a rendu FAUX : les classes d'opérateur d'un index
    // composite, recopiées d'une colonne sur toutes les autres.
    const corrige = await reecrireIndexComposites(
      complet,
      outDir,
      await colonnesDIndexReelles(target, schema ?? "public", lues),
    );
    await fs.writeFile(file, corrige, "utf8");
  }
  return {
    tag,
    file,
    runnable: executable !== null,
    extraTables: lues.filter((t) => !declarees.has(t)),
  };
}
