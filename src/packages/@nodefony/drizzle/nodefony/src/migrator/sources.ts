import fs from "node:fs/promises";
import path from "node:path";
import type { SqlDialect } from "../../config/config";
import { migrationHash, normalizeSql } from "./hash";
import {
  FORMAT_MARKER,
  MigrationVerdictError,
  STATEMENT_BREAKPOINT,
  type IMigrationFile,
  type IMigrationSource,
} from "./types";

/**
 * Version du journal drizzle-kit que cet applicateur sait lire.
 *
 * On adopte le format d'un outil tiers : le lire « au mieux » reviendrait à
 * découvrir un défaut de découpe APRÈS publication, quand le corriger
 * changerait le sens de fichiers déjà livrés chez des utilisateurs.
 */
export const SUPPORTED_JOURNAL_VERSIONS: readonly string[] = ["7"];

/** Entrée du journal `_journal.json` produit par drizzle-kit. */
interface IJournalEntry {
  idx: number;
  tag: string;
}

/** Journal `_journal.json` produit par drizzle-kit. */
interface IJournal {
  version: string;
  entries: IJournalEntry[];
}

/**
 * Résultat du chargement d'un registre de sources.
 *
 * Les sources **absentes** ne sont pas une erreur : désinstaller un module ne
 * doit pas bloquer la migration à jamais. Elles sont nommées ici pour que
 * l'appelant puisse le DIRE, ce qui n'est pas la même chose que de s'arrêter.
 */
export interface ILoadedSources {
  /** Fichiers de toutes les sources présentes, dans l'ordre d'application. */
  files: IMigrationFile[];
  /** Noms des sources déclarées dont le dossier n'existe pas. */
  absent: string[];
}

/**
 * Ordonne un registre de sources : rang croissant, nom en départage.
 *
 * `framework` porte le rang 0 (les entités d'application peuvent référencer ses
 * tables), `app` le rang le plus élevé. Entre les deux, les modules à leur
 * ordre de chargement. Le nom départage à rang égal pour que l'ordre soit
 * **déterministe** : deux pods qui liraient le même registre dans deux ordres
 * différents appliqueraient deux plans différents.
 *
 * @param sources - registre, dans n'importe quel ordre.
 * @returns le même registre, trié.
 */
export function orderSources(
  sources: readonly IMigrationSource[],
): IMigrationSource[] {
  return [...sources].sort(
    (a, b) => a.rank - b.rank || a.name.localeCompare(b.name),
  );
}

/**
 * Charge toutes les sources d'un registre pour un dialecte donné.
 *
 * @param sources - registre de sources (espace de noms ouvert).
 * @param dialect - dialecte du connecteur ; sélectionne le sous-dossier.
 * @returns les fichiers ordonnés et les sources absentes, nommées.
 * @throws MigrationVerdictError si un fichier ne porte pas le format attendu.
 */
export async function loadSources(
  sources: readonly IMigrationSource[],
  dialect: SqlDialect,
): Promise<ILoadedSources> {
  const files: IMigrationFile[] = [];
  const absent: string[] = [];
  for (const source of orderSources(sources)) {
    const dir = path.join(source.dir, dialect);
    const journal = await readJournal(dir, source.name);
    if (journal === null) {
      absent.push(source.name);
      continue;
    }
    for (const entry of [...journal.entries].sort((a, b) => a.idx - b.idx)) {
      files.push(await readMigrationFile(dir, source.name, entry));
    }
  }
  return { files, absent };
}

/**
 * Lit le journal d'une source, ou `null` si la source n'est pas installée.
 *
 * @param dir - dossier `<source>/<dialecte>`.
 * @param source - nom logique de la source, pour nommer un refus.
 * @returns le journal validé, ou `null` si le dossier n'existe pas.
 * @throws MigrationVerdictError si la version du journal n'est pas reconnue.
 */
async function readJournal(
  dir: string,
  source: string,
): Promise<IJournal | null> {
  const file = path.join(dir, "meta", "_journal.json");
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw e;
  }
  const journal = JSON.parse(raw) as IJournal;
  if (!SUPPORTED_JOURNAL_VERSIONS.includes(String(journal.version))) {
    throw new MigrationVerdictError(
      {
        code: "NF_MIGRATE_UNKNOWN_FORMAT",
        connector: "",
        source,
        facts: {
          file,
          journalVersion: String(journal.version),
          supported: SUPPORTED_JOURNAL_VERSIONS,
        },
        nextActions: [
          {
            command: "npm update @nodefony/drizzle",
            args: ["update", "@nodefony/drizzle"],
          },
        ],
      },
      `Le journal de migrations de la source « ${source} » est en version ` +
        `${String(journal.version)}, que cette version du framework ne sait pas lire ` +
        `(reconnue : ${SUPPORTED_JOURNAL_VERSIONS.join(", ")}).`,
    );
  }
  return journal;
}

/**
 * Lit un fichier de migration, valide son format et découpe ses statements.
 *
 * @param dir - dossier `<source>/<dialecte>`.
 * @param source - nom logique de la source.
 * @param entry - entrée du journal.
 * @returns le fichier chargé, empreinte comprise.
 * @throws MigrationVerdictError si le marqueur de format est absent ou autre.
 */
async function readMigrationFile(
  dir: string,
  source: string,
  entry: IJournalEntry,
): Promise<IMigrationFile> {
  const file = path.join(dir, `${entry.tag}.sql`);
  let content: string;
  try {
    content = await fs.readFile(file, "utf8");
  } catch (cause) {
    // Le journal annonce ce fichier ; le dossier ne l'a pas. Laisser remonter
    // l'erreur système nue donnerait un `ENOENT` sans connecteur, sans source
    // et sans geste — un refus que ni un humain ni un agent ne peut traiter,
    // au beau milieu d'un déploiement.
    throw new MigrationVerdictError(
      {
        code: "NF_MIGRATE_JOURNAL_MISMATCH",
        connector: "",
        source,
        tag: entry.tag,
        facts: {
          file,
          reason: cause instanceof Error ? cause.message : String(cause),
        },
        nextActions: [
          {
            command: "npm run generate:migrations",
            args: ["run", "generate:migrations"],
          },
        ],
      },
      `Le journal de la source « ${source} » annonce la migration ` +
        `« ${entry.tag} », mais son fichier « ${file} » est introuvable. ` +
        `Cette source est incohérente avec elle-même : rien n'a été appliqué, ` +
        `et l'applicateur ne devine jamais le contenu d'un fichier absent.`,
    );
  }
  const normalized = normalizeSql(content);
  const marker = normalized.split("\n", 1)[0]?.trim() ?? "";
  if (marker !== FORMAT_MARKER) {
    throw new MigrationVerdictError(
      {
        code: "NF_MIGRATE_UNKNOWN_FORMAT",
        connector: "",
        source,
        tag: entry.tag,
        facts: { file, found: marker, expected: FORMAT_MARKER },
        nextActions: [
          {
            command: "npm run generate:migrations",
            args: ["run", "generate:migrations"],
          },
        ],
      },
      `Le fichier « ${file} » ne porte pas le format de migration attendu ` +
        `(« ${FORMAT_MARKER} » ; lu : « ${marker} »). Il n'a PAS été appliqué.`,
    );
  }
  return {
    source,
    tag: entry.tag,
    idx: entry.idx,
    // L'empreinte porte sur le fichier ENTIER — marqueur compris : c'est le
    // fichier tel que livré qui est identifié, pas ce qu'on en exécute.
    hash: migrationHash(content),
    statements: splitStatements(normalized),
    path: file,
  };
}

/**
 * Découpe un fichier de migration en statements exécutables.
 *
 * ## Le séparateur EST un commentaire SQL — et c'est tout le problème
 *
 * `--> statement-breakpoint` commence par deux tirets : pour le moteur, c'est
 * un commentaire, et rien ne le distingue d'un autre à l'œil nu. Deux ordres
 * naïfs échouent donc, chacun pour sa raison, et les deux ont été constatés :
 *
 * - **découper puis retirer les commentaires** fait d'un séparateur écrit DANS
 *   un commentaire un vrai séparateur. La ligne est coupée en deux, et le
 *   fragment de droite — qui ne commence plus par deux tirets — part au pilote
 *   comme une instruction. Le produit se le faisait à lui-même : le gabarit
 *   qu'écrit `orm:generate --custom` porte la phrase qui NOMME le séparateur,
 *   si bien que toute migration libre écrite en suivant son aide échouait sur
 *   une erreur de syntaxe, en laissant dans l'historique une migration `failed`
 *   — c'est-à-dire une base bloquée, à réparer à la main ;
 * - **retirer les commentaires puis découper** emporte les séparateurs
 *   eux-mêmes, et fond toutes les instructions du fichier en une seule.
 *
 * Il n'y a donc pas d'ordre à trouver : les deux décisions se prennent au MÊME
 * moment, ligne par ligne, en sachant si l'on est dans une chaîne littérale.
 * Un commentaire ne peut pas ouvrir un commentaire : dès que la ligne commence
 * par deux tirets sans être le séparateur, tout ce qu'elle porte est du texte.
 *
 * Le séparateur n'est pas reconnu « ligne entière » pour autant : drizzle-kit
 * le colle en fin d'instruction (`CREATE INDEX …;--> statement-breakpoint`), et
 * l'exiger seul sur sa ligne ferait fusionner toutes les instructions d'une
 * migration du framework.
 *
 * @param normalized - contenu normalisé (fins de ligne en LF).
 * @returns les statements non vides, dans l'ordre du fichier.
 */
export function splitStatements(normalized: string): string[] {
  const statements: string[] = [];
  let courant: string[] = [];
  let dansChaine = false;

  /** Clôt le statement en cours — vide, il ne compte pas. */
  const clore = (): void => {
    const statement = courant.join("\n").trim();
    if (statement.length > 0) {
      statements.push(statement);
    }
    courant = [];
    // Après un séparateur, une instruction NEUVE commence : aucune chaîne ne
    // peut rester ouverte d'un statement à l'autre.
    dansChaine = false;
  };

  for (const ligne of normalized.split("\n")) {
    if (!dansChaine) {
      const tete = ligne.trimStart();
      if (tete.startsWith(STATEMENT_BREAKPOINT)) {
        clore();
        continue;
      }
      // Une ligne n'est un commentaire QUE si elle commence hors chaîne. Un
      // remplissage écrit à la main (`--custom` sert exactement à ça) peut
      // porter un texte multi-ligne dont une ligne commence par deux tirets :
      // la retirer changerait silencieusement la donnée insérée.
      if (tete.startsWith("--")) {
        continue;
      }
      const coupe = indexHorsChaine(ligne, STATEMENT_BREAKPOINT);
      if (coupe >= 0) {
        courant.push(ligne.slice(0, coupe));
        clore();
        continue;
      }
    }
    courant.push(ligne);
    dansChaine = ferméSurChaîneOuverte(ligne, dansChaine);
  }
  clore();
  return statements;
}

/**
 * Position du motif dans la ligne, en IGNORANT ce qui est dans une chaîne.
 *
 * Un remplissage écrit à la main peut contenir le texte du séparateur comme
 * DONNÉE — c'est exactement l'usage de `--custom`. Le chercher au plus simple
 * couperait l'instruction en plein milieu d'une valeur, et le pilote recevrait
 * deux moitiés de SQL.
 *
 * La ligne est supposée commencer hors chaîne : l'appelant ne pose la question
 * que dans ce cas.
 *
 * @param ligne - ligne à balayer, débutant hors chaîne.
 * @param motif - texte cherché.
 * @returns l'indice, ou `-1` si le motif n'apparaît qu'à l'intérieur d'une chaîne.
 */
function indexHorsChaine(ligne: string, motif: string): number {
  let dans = false;
  for (let i = 0; i < ligne.length; i += 1) {
    if (ligne[i] === "'") {
      if (dans && ligne[i + 1] === "'") {
        i += 1;
        continue;
      }
      dans = !dans;
      continue;
    }
    if (!dans && ligne.startsWith(motif, i)) {
      return i;
    }
  }
  return -1;
}

/**
 * Dit si la fin de la ligne se trouve à l'INTÉRIEUR d'une chaîne littérale.
 *
 * Balayage volontairement minimal : seule l'apostrophe compte, et `''` est son
 * échappement — c'est la grammaire commune aux trois dialectes. Il ne s'agit
 * pas d'analyser du SQL, seulement de savoir si la ligne suivante peut porter
 * un commentaire.
 *
 * @param ligne - ligne à balayer.
 * @param ouverte - vrai si une chaîne était déjà ouverte en début de ligne.
 * @returns vrai si une chaîne reste ouverte à la fin de la ligne.
 */
function ferméSurChaîneOuverte(ligne: string, ouverte: boolean): boolean {
  let dans = ouverte;
  for (let i = 0; i < ligne.length; i += 1) {
    if (ligne[i] !== "'") {
      continue;
    }
    if (dans && ligne[i + 1] === "'") {
      i += 1;
      continue;
    }
    dans = !dans;
  }
  return dans;
}

/**
 * Noms des tables qu'un lot de migrations CRÉE.
 *
 * Sert la garde d'adoption : un historique vide alors que ces tables existent
 * déjà signale une base antérieure aux migrations, pas une base neuve. La
 * liste est DÉRIVÉE des fichiers — une liste codée en dur mentirait dès la
 * première migration livrée par un module tiers.
 *
 * @param files - fichiers de migration chargés.
 * @returns les noms de tables, sans doublon.
 */
export function createdTables(files: readonly IMigrationFile[]): string[] {
  const found = new Set<string>();
  const pattern =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?([A-Za-z0-9_$]+)[`"']?/gi;
  for (const file of files) {
    for (const statement of file.statements) {
      for (const match of statement.matchAll(pattern)) {
        found.add(match[1] as string);
      }
    }
  }
  return [...found];
}
