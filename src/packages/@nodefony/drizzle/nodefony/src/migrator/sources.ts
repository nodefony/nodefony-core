import fs from "node:fs/promises";
import path from "node:path";
import type { SqlDialect } from "../../config/config";
import { migrationHash, normalizeSql } from "./hash";
import { frameworkMigrationsDir } from "./paths";
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
    // 🔴 Comparaison par unités de code, jamais `localeCompare` : celle-ci
    // dépend de la locale du runtime, donc deux exemplaires du même code —
    // l'un en `C`, l'autre en `fr_FR` — pouvaient ordonner différemment deux
    // sources de même rang, et appliquer deux plans différents. C'est
    // précisément le déterminisme que le commentaire ci-dessus revendique.
    (a, b) =>
      a.rank - b.rank || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
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
      files.push(await readMigrationFile(dir, source.name, entry, dialect));
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
  // 🔴 Un journal illisible se NOMME. `JSON.parse` levait une `SyntaxError`
  // nue, que le fourre-tout des pannes habillait en « base injoignable » — avec
  // un geste qui interroge une base qui n'y est pour rien. La cause la plus
  // fréquente est banale : un conflit de fusion non résolu, deux branches ayant
  // chacune généré une migration.
  let journal: IJournal;
  try {
    journal = JSON.parse(raw) as IJournal;
  } catch (e) {
    throw new MigrationVerdictError(
      {
        code: "NF_MIGRATE_UNKNOWN_FORMAT",
        connector: "",
        source,
        facts: {
          file,
          cause: e instanceof Error ? e.message : String(e),
        },
        nextActions: [],
      },
      `Le journal des migrations « ${file} » n'est pas lisible : ` +
        `${e instanceof Error ? e.message : String(e)}. ` +
        `La cause la plus fréquente est un conflit de fusion non résolu — deux ` +
        `branches ayant généré chacune une migration. Ouvrir le fichier, ` +
        `résoudre le conflit, et vérifier que chaque migration du dossier y ` +
        `figure une fois. La base n'est pour rien dans cette erreur.`,
    );
  }
  if (!Array.isArray(journal.entries)) {
    throw new MigrationVerdictError(
      {
        code: "NF_MIGRATE_UNKNOWN_FORMAT",
        connector: "",
        source,
        facts: { file },
        nextActions: [],
      },
      `Le journal des migrations « ${file} » ne porte pas de liste ` +
        `« entries » : ce n'est pas un journal que ce format sait lire.`,
    );
  }
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
 * @param dialect - dialecte du connecteur ; choisit la grammaire de découpe.
 * @returns le fichier chargé, empreinte comprise.
 * @throws MigrationVerdictError si le marqueur de format est absent ou autre.
 */
async function readMigrationFile(
  dir: string,
  source: string,
  entry: IJournalEntry,
  dialect: SqlDialect,
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
    statements: splitStatements(normalized, dialect),
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
 * ## La grammaire de chaîne est celle du MOTEUR, pas une moyenne des trois
 *
 * Savoir si l'on est dans une chaîne n'a pas la même réponse partout : MySQL
 * échappe l'apostrophe par une contre-oblique, PostgreSQL délimite les corps
 * par `$tag$`. Une grammaire fausse ne lève AUCUNE erreur — le scanner croit
 * sortir d'une chaîne où il est encore, la ligne suivante commençant par deux
 * tirets est retirée comme un commentaire alors qu'elle est de la DONNÉE, ou
 * un séparateur porté par un texte coupe l'instruction en deux. La migration
 * s'inscrit ensuite en succès avec l'empreinte du fichier entier : plus aucun
 * verdict ne peut le voir. Le dialecte est donc un paramètre REQUIS, jamais un
 * défaut — le fichier vit déjà sous `<source>/<dialecte>/`, l'appelant l'a.
 *
 * @param normalized - contenu normalisé (fins de ligne en LF).
 * @param dialect - dialecte du connecteur ; choisit la grammaire de chaîne.
 * @returns les statements non vides, dans l'ordre du fichier.
 */
export function splitStatements(
  normalized: string,
  dialect: SqlDialect,
): string[] {
  const grammaire = GRAMMAIRES_CHAINE[dialect];
  const statements: string[] = [];
  let courant: string[] = [];
  // Curseur alloué UNE fois pour tout le fichier : le balayage écrit dedans
  // plutôt que de rendre un objet par ligne.
  const curseur: ICurseurChaine = { ouverte: "", coupe: -1 };

  /** Clôt le statement en cours — vide, il ne compte pas. */
  const clore = (): void => {
    const statement = courant.join("\n").trim();
    if (statement.length > 0) {
      statements.push(statement);
    }
    courant = [];
    // Après un séparateur, une instruction NEUVE commence : aucune chaîne ne
    // peut rester ouverte d'un statement à l'autre.
    curseur.ouverte = "";
  };

  for (const ligne of normalized.split("\n")) {
    if (curseur.ouverte === "") {
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
      balayerLigne(ligne, STATEMENT_BREAKPOINT, grammaire, curseur);
      const coupe = curseur.coupe;
      if (coupe >= 0) {
        courant.push(ligne.slice(0, coupe));
        clore();
        // 🔴 Ce qui SUIT le marqueur sur la même ligne ouvre l'instruction
        // suivante — il était jeté, en silence. Le gabarit dit « séparer les
        // instructions par ce marqueur » sans imposer de passer à la ligne :
        // un remplissage écrit à la main y perdait son second `UPDATE`, la
        // migration s'inscrivait en succès avec l'empreinte du fichier ENTIER,
        // et aucun verdict ne pouvait plus le voir.
        const reste = ligne.slice(coupe + STATEMENT_BREAKPOINT.length);
        if (reste.trim() !== "") {
          courant.push(reste);
          balayerLigne(reste, "", grammaire, curseur);
        }
        continue;
      }
      // Pas de coupe : le balayage a lu la ligne entière, `ouverte` est à jour.
      courant.push(ligne);
      continue;
    }
    courant.push(ligne);
    balayerLigne(ligne, "", grammaire, curseur);
  }
  clore();
  return statements;
}

/**
 * Ce qu'une grammaire de chaîne autorise, pour UN moteur.
 *
 * Trois différences suffisent à couvrir les trois dialectes ; les nommer plutôt
 * que tester le dialecte dans le scanner garde UNE implémentation du balayage,
 * et rend chaque écart lisible à l'endroit où il est décidé.
 */
interface IGrammaireChaine {
  /** Une contre-oblique échappe le caractère suivant dans une chaîne `'…'`. */
  readonly contreObliqueDansApostrophe: boolean;
  /** Le préfixe `E'…'` ouvre une chaîne où la contre-oblique échappe. */
  readonly apostropheEchappeePrefixee: boolean;
  /** Les corps `$tag$…$tag$` sont des chaînes littérales. */
  readonly dollarQuote: boolean;
}

/**
 * La grammaire de chaîne de chaque moteur supporté.
 *
 * SQLite suit le standard et rien de plus : une contre-oblique y est un
 * caractère ordinaire, et `$$` n'est pas un délimiteur. Lui appliquer la
 * grammaire de MySQL serait aussi faux que l'inverse — c'est pourquoi le
 * routage se fait dans les DEUX sens, et pas seulement pour ajouter des cas.
 */
const GRAMMAIRES_CHAINE: Readonly<Record<SqlDialect, IGrammaireChaine>> = {
  sqlite: {
    contreObliqueDansApostrophe: false,
    apostropheEchappeePrefixee: false,
    dollarQuote: false,
  },
  postgres: {
    contreObliqueDansApostrophe: false,
    apostropheEchappeePrefixee: true,
    dollarQuote: true,
  },
  mysql: {
    contreObliqueDansApostrophe: true,
    apostropheEchappeePrefixee: false,
    dollarQuote: false,
  },
};

/**
 * État du balayage, porté d'une ligne à l'autre.
 *
 * Mutable et réutilisé : un fichier de migration peut compter des milliers de
 * lignes, et rendre un objet par ligne allouerait pour rien.
 */
interface ICurseurChaine {
  /**
   * Délimiteur qu'il reste à trouver pour refermer la chaîne courante — `''`
   * hors chaîne, `'` ou `e'` dans une apostrophe, `$tag$` dans un corps.
   */
  ouverte: string;
  /** Indice du motif rencontré hors chaîne, ou `-1`. */
  coupe: number;
}

/** Vrai si `c` peut faire partie d'un identifiant SQL non quoté. */
function estCaractereIdentifiant(c: string | undefined): boolean {
  return c !== undefined && /[A-Za-z0-9_$]/.test(c);
}

/**
 * Balaye une ligne : met à jour l'état de chaîne, et repère le motif.
 *
 * UNE seule implémentation pour les deux questions que pose la découpe — « où
 * couper ? » et « la ligne suivante peut-elle porter un commentaire ? ». Elles
 * se répondaient auparavant dans deux fonctions jumelles, chacune avec sa copie
 * de la grammaire : deux copies divergent, et chacune reste verte dans son
 * propre test.
 *
 * Le balayage s'ARRÊTE sur le motif : l'appelant repart alors du reste de la
 * ligne, avec une chaîne close par construction (un statement neuf commence).
 * Passer un motif vide balaye donc la ligne entière.
 *
 * @param ligne - ligne à balayer.
 * @param motif - texte cherché hors chaîne ; vide pour ne rien chercher.
 * @param grammaire - grammaire de chaîne du moteur visé.
 * @param curseur - état lu ET écrit : chaîne ouverte, indice du motif.
 */
function balayerLigne(
  ligne: string,
  motif: string,
  grammaire: IGrammaireChaine,
  curseur: ICurseurChaine,
): void {
  curseur.coupe = -1;
  let ouverte = curseur.ouverte;
  for (let i = 0; i < ligne.length; i += 1) {
    const c = ligne[i] as string;
    if (ouverte.startsWith("$")) {
      // Un corps délimité par des dollars ne se referme QUE sur son propre
      // marqueur : un `$$` nu croisé dans un `$corps$` ne termine rien.
      if (ligne.startsWith(ouverte, i)) {
        i += ouverte.length - 1;
        ouverte = "";
      }
      continue;
    }
    if (ouverte !== "") {
      if (
        c === "\\" &&
        (grammaire.contreObliqueDansApostrophe || ouverte === "e'")
      ) {
        // La contre-oblique emporte le caractère suivant — l'apostrophe qu'elle
        // protège ne referme donc rien.
        i += 1;
        continue;
      }
      if (c === "'") {
        if (ligne[i + 1] === "'") {
          i += 1;
          continue;
        }
        ouverte = "";
      }
      continue;
    }
    if (c === "'") {
      ouverte = "'";
      continue;
    }
    if (
      grammaire.apostropheEchappeePrefixee &&
      (c === "E" || c === "e") &&
      ligne[i + 1] === "'" &&
      !estCaractereIdentifiant(ligne[i - 1])
    ) {
      ouverte = "e'";
      i += 1;
      continue;
    }
    if (grammaire.dollarQuote && c === "$") {
      const tag = delimiteurDollar(ligne, i);
      if (tag !== null) {
        ouverte = tag;
        i += tag.length - 1;
        continue;
      }
    }
    if (motif !== "" && ligne.startsWith(motif, i)) {
      curseur.coupe = i;
      curseur.ouverte = ouverte;
      return;
    }
  }
  curseur.ouverte = ouverte;
}

/**
 * Le délimiteur `$tag$` qui commence à `debut`, ou `null`.
 *
 * Le tag est optionnel (`$$`) et suit les règles d'un identifiant : ce qui
 * exclut `$1`, un paramètre de requête, qu'il ne faut surtout pas lire comme
 * l'ouverture d'une chaîne.
 *
 * @param ligne - ligne balayée.
 * @param debut - indice du `$` candidat.
 * @returns le délimiteur complet, ou `null` si ce n'en est pas un.
 */
function delimiteurDollar(ligne: string, debut: number): string | null {
  let i = debut + 1;
  while (i < ligne.length && /[A-Za-z0-9_]/.test(ligne[i] as string)) {
    // Un tag ne commence pas par un chiffre — `$1` est un paramètre.
    if (i === debut + 1 && /[0-9]/.test(ligne[i] as string)) {
      return null;
    }
    i += 1;
  }
  return ligne[i] === "$" ? ligne.slice(debut, i + 1) : null;
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

/**
 * Tables que le FRAMEWORK construit — dérivées de ses fichiers de migration.
 *
 * Dérivées, jamais listées à la main : une liste codée en dur mentirait dès la
 * première migration livrée par une version suivante.
 *
 * Une seule implémentation, parce que deux appelants en dépendent pour la même
 * décision — le générateur les exclut de ce qu'il écrit, l'adoption les exclut
 * de ce qu'elle lit. Deux copies divergeraient en silence, chacune verte dans
 * son propre test.
 *
 * @param dialect - dialecte du connecteur visé.
 * @returns les noms de tables du framework.
 */
export async function frameworkTables(dialect: SqlDialect): Promise<string[]> {
  const dir = await frameworkMigrationsDir();
  const { files } = await loadSources(
    [{ name: "framework", dir, rank: 0 }],
    dialect,
  );
  return createdTables(files);
}
