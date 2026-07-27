#!/usr/bin/env node
/**
 * Banc de SCHÉMA — ce que la grammaire de champs ne sait pas exprimer.
 *
 * Les deux autres bancs demandent « le code généré tient-il debout ? » et
 * « un agent trouve-t-il l'outillage ? ». Celui-ci pose la troisième question,
 * qu'aucun des deux ne voit : **le modèle de données d'un vrai logiciel est-il
 * seulement EXPRIMABLE** avec `nodefony create entity` ?
 *
 * La différence n'est pas de degré. Les cinq entités du banc de vérité ont été
 * écrites POUR exercer la grammaire : elles ne peuvent, par construction, rien
 * demander qu'elle ne sache faire. Un schéma qu'un autre projet a écrit sans
 * nous connaître n'a pas cette complaisance — et c'est ce qu'on vient chercher.
 *
 * ## Pourquoi TROIS schémas et pas un plus gros
 *
 * Mesuré : ils stressent des axes disjoints, et un seul rendrait un verdict faux.
 *
 * | Axe | umami | calcom | ghost |
 * | --- | --- | --- | --- |
 * | nom SQL ≠ nom TS | **72 % des colonnes** | 0 % | 0 % (snake natif) |
 * | tailles de chaîne | 11 formes | 0 (`text` partout) | **`maxlength` sur tout** |
 * | énumérations | 0 | **46 partagées** | `validations.isIn` |
 * | relations tordues | 2 doubles liens | **29 doubles + 3 auto-réf.** | 101 FK explicites |
 * | cascades de suppression | — | `onDelete` | **53 `cascadeDelete`** |
 * | valeurs par défaut | 2 | **247** | 119 |
 * | clé primaire | uuid **renommée** | cuid `id` | **`string(24)`** |
 * | binaire · 64 bits · unsigned | **`Bytes`** | — | `bigInteger` · `unsigned` |
 *
 * Sur `umami` seul on conclurait « la grammaire ne sait pas nommer » sans voir
 * qu'elle ne sait pas non plus déclarer une énumération PARTAGÉE par dix tables.
 *
 * ## Ce qui juge
 *
 * La **base réellement créée**, jamais les sources. Après le passage de l'agent,
 * l'application boote en console (`inspect entities` — aucun port ouvert), ce qui
 * exécute le DDL de développement ; on lit alors `sqlite_master` et les `PRAGMA`.
 * Une table absente y est absente, une colonne mal nommée y porte son vrai nom,
 * un index composite y est ou n'y est pas. Lire les fichiers `.ts` dirait ce que
 * l'agent a écrit ; la base dit ce qui EXISTE.
 *
 * ## La mesure qui compte
 *
 * Ce n'est pas « le schéma est-il juste » — un agent finit toujours par l'obtenir
 * s'il édite assez de Drizzle à la main, et il aura alors prouvé que le
 * générateur ne servait à rien. C'est **combien a-t-il fallu écrire HORS du
 * générateur** : les éditions manuelles de fichiers d'entité désignent, une par
 * une, ce que la grammaire n'a pas su porter.
 *
 * ## Le décor doit être celui de l'UTILISATEUR, pas celui du mainteneur
 *
 * Le premier verdict de ce banc a été rendu dans un décor qui le faussait :
 * l'application témoin vivait SOUS le checkout et ses paquets y étaient
 * symlinkés (`--link`). L'agent est allé lire `src/packages/@nodefony/drizzle/`
 * pour déduire comment une entité se déclare — un savoir qu'aucun installeur
 * npm ne possède, puisqu'un tarball ne contient que `dist/`. **Le banc mesurait
 * un agent mieux servi que l'utilisateur réel**, et le seul chiffre qui compte
 * (« a-t-il appelé le générateur ? ») en dépendait directement.
 *
 * D'où deux gestes, tous deux nécessaires — l'un sans l'autre ne ferme rien :
 *
 * 1. **le décor sort du checkout** (`os.tmpdir()`), sinon `../../..` y ramène ;
 * 2. **les paquets s'installent depuis les TARBALLS** (`pack-all.mjs`, l'outil
 *    de la release — pas un packer de plus), sinon le symlink expose les
 *    sources malgré la distance.
 *
 * Et parce qu'un décor qu'on croit isolé sans le vérifier ne vaut pas mieux
 * qu'un décor ouvert, {@link assertIsolated} le CONSTATE avant l'agent : aucun
 * `.ts` de source atteignable, aucun lien qui sorte, run hors du dépôt. Le banc
 * s'arrête si le constat échoue — un décor faux rend un verdict faux.
 *
 * `--link` reste disponible pour la boucle courte, et le rapport ÉNONCE alors
 * que la mesure n'est pas représentative : deux runs de décors différents ne se
 * comparent pas.
 *
 * ## Trois décisions de décor, énoncées plutôt que subies
 *
 * - **Les sources ne sont pas versionnées ici** : elles appartiennent à leurs
 *   projets. Le banc les télécharge, les met en cache, et vérifie une empreinte
 *   FIGÉE. Une source qui bouge est signalée — les runs cessent d'être
 *   comparables, et c'est le genre de dérive qui ne se voit jamais autrement.
 * - **Un sous-ensemble de tables figé**, par liste nommée. Les cent tables de
 *   `calcom` mesureraient l'endurance de l'agent, pas la grammaire.
 * - **Les entités `User` sont renommées `Account`.** La collision avec l'entité
 *   du module de sécurité est un piège de décor DÉJÀ consigné : la laisser ferait
 *   mesurer ce trou-là, qu'on connaît, au lieu de celui qu'on cherche.
 *
 * ## Usage
 *
 *   node .claude/skills/nodefony-devkit-bench/scripts/bench-schema.mjs
 *   node .claude/skills/nodefony-devkit-bench/scripts/bench-schema.mjs --schema calcom
 *   node .claude/skills/nodefony-devkit-bench/scripts/bench-schema.mjs --setup-only
 *   node .claude/skills/nodefony-devkit-bench/scripts/bench-schema.mjs --dump-only   # extrait le schéma, sans agent
 *   node .claude/skills/nodefony-devkit-bench/scripts/bench-schema.mjs --analyze-only <runDir>
 *   node .claude/skills/nodefony-devkit-bench/scripts/bench-schema.mjs --link        # décor RAPIDE, NON représentatif
 *   node .claude/skills/nodefony-devkit-bench/scripts/bench-schema.mjs --repack      # force le re-pack des tarballs
 *
 * Prérequis : le checkout est BÂTI (`npm run build`) — l'app témoin se lie au
 * `dist/` local. L'agent tourne SANS garde-fou d'approbation dans un décor
 * jetable : ne jamais pointer ce banc sur un vrai projet.
 *
 * Variables : `DEVKIT_BENCH_AGENT` · `DEVKIT_BENCH_MODEL` (défaut `haiku` — le
 * cas le plus défavorable est le seul qui prouve : un modèle fort compense les
 * trous de la grammaire en devinant juste).
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

/** Racine du dépôt, trouvée en REMONTANT — un skill se déplace, un `..` non. */
function findRepoRoot(from) {
  let dir = from;
  for (let up = 0; up < 8; up += 1) {
    if (existsSync(path.join(dir, "src/nodefony/bin/nodefony"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("racine du dépôt Nodefony introuvable depuis " + from);
}

const REPO = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const BIN = path.join(REPO, "src", "nodefony", "bin", "nodefony");
const CACHE = path.join(REPO, "tmp", "devkit-schema", ".sources");

/**
 * Mode d'installation des paquets du framework dans l'application témoin.
 *
 * `installed` (défaut) : tarballs — ce qu'un `npm i nodefony` dépose, soit
 * `dist/` et rien d'autre. `link` : symlinks vers les workspaces du checkout,
 * **sources comprises** — rapide, mais l'agent y lit du code que l'utilisateur
 * réel n'a pas, et la mesure cesse d'être transposable.
 */
const LINKED = process.argv.includes("--link");

/**
 * Racine des runs — HORS du dépôt en mode `installed`.
 *
 * Un décor posé sous `tmp/` du checkout laisse `../../../src/packages/…`
 * accessible : l'isolation par les tarballs serait annulée par la simple
 * remontée de répertoires. En mode `--link` on reste sous le dépôt, puisque
 * l'exposition y est assumée.
 */
const RUN_ROOT = LINKED
  ? path.join(REPO, "tmp", "devkit-schema")
  : path.join(os.tmpdir(), "nodefony-devkit-schema");
const AGENT = process.env.DEVKIT_BENCH_AGENT ?? "claude";
const MODEL = process.env.DEVKIT_BENCH_MODEL ?? "haiku";
const AGENT_ARGS = process.env.DEVKIT_BENCH_AGENT_ARGS
  ? process.env.DEVKIT_BENCH_AGENT_ARGS.split(" ")
  : [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
    ];

/**
 * Ports dédiés — distincts du banc de vérité (5361) et de découvrabilité (5371),
 * pour que les trois puissent tourner ensemble.
 */
const PORTS = { NF_PORT: "5381", NF_PORT_HTTPS: "5382" };

/**
 * Moteur sur lequel l'application témoin persiste — et donc sur lequel le juge
 * lit.
 *
 * **PostgreSQL par défaut, et ce n'est pas un détail de décor.** SQLite ne
 * distingue pas `varchar(255)` de `char(2)` de `text` : ils y sont le MÊME type.
 * Un juge posé dessus serait aveugle exactement là où les schémas réels sont
 * exigeants — onze longueurs distinctes chez umami, `maxlength` sur chaque
 * colonne chez ghost. Le skill portait déjà la leçon (le banc de vérité a dû
 * ajouter deux entités PostgreSQL pour la même raison) : une sonde de type doit
 * porter sur un moteur qui DISTINGUE les types.
 *
 * PostgreSQL rend en plus lisibles `numeric(p,s)`, `bytea`, `jsonb` et
 * `timestamptz` — soit tout ce que la grammaire prétend traduire.
 */
const DIALECT = (() => {
  const i = process.argv.indexOf("--dialect");
  return i === -1 ? "postgres" : process.argv[i + 1];
})();

/** Chaînes de connexion des moteurs de développement (docker du dépôt). */
const DB_URL = {
  postgres:
    process.env.NF_PG_URL ??
    "postgres://nodefony:nodefony-dev@127.0.0.1:5432/nodefony",
  mysql:
    process.env.NF_MYSQL_URL ??
    "mysql://nodefony:nodefony-dev@127.0.0.1:3306/nodefony",
  sqlite: null,
};

/**
 * Env de tout ce qui s'exécute DANS l'app témoin.
 *
 * `NF_DATABASE_URL` est la variable que le gabarit d'application désigne
 * lui-même pour pointer une vraie base ; le dialecte s'en déduit par le schéma
 * d'URL. Rien d'autre à configurer.
 */
const APP_ENV = {
  ...process.env,
  ...PORTS,
  ...(DB_URL[DIALECT] ? { NF_DATABASE_URL: DB_URL[DIALECT] } : {}),
};

// ─────────────────────────────────────────────────────────────────────────────
// Les schémas — sources EXTERNES, sous-ensembles FIGÉS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Catalogue des schémas éprouvables.
 *
 * `tables` est la liste FIGÉE du sous-ensemble : la changer change ce que le
 * banc mesure, et deux runs cessent d'être comparables. `rename` neutralise les
 * collisions de décor connues. `sha256` est l'empreinte relevée au moment où le
 * sous-ensemble a été choisi.
 */
export const SCHEMAS = {
  umami: {
    format: "prisma",
    repo: "umami-software/umami",
    file: "prisma/schema.prisma",
    license: "MIT",
    sha256: "f99024170a33d5cb",
    /** Six tables sur dix-huit — chacune pour une difficulté nommée. */
    tables: [
      "User", // clé primaire à nom propre, unicité, longueurs disparates, suppression douce
      "Session", // horodatage de création SEUL, Char(2), dix index dont huit composites
      "Website", // deux liens vers la MÊME entité, booléen à défaut, JSON facultatif
      "WebsiteEvent", // décimaux à précision, renommage NON mécanique, index à 3 colonnes
      "EventData", // décimal large
      "SessionReplay", // BINAIRE, dates métier non nulles
    ],
    // `User` ET `Session` sont des noms d'entité RÉSERVÉS par le framework
    // (`scaffold/reservedEntities.ts`) : un homonyme déposséderait le module qui
    // les porte, et l'application refuserait de démarrer sur un message parlant
    // d'une colonne inconnue. Deux pièges de décor connus, neutralisés ici pour
    // que le banc mesure la grammaire et non eux.
    rename: { User: "Account", Session: "Visit" },
    stresses: "nommage SQL, tailles de chaîne, binaire, index composites",
  },
  calcom: {
    format: "prisma",
    repo: "calcom/cal.com",
    file: "packages/prisma/schema.prisma",
    license: "AGPL-3.0 (non redistribué — téléchargé au run)",
    sha256: "95064d27e842e8a9",
    /** Six tables sur cent — celles qui portent énumérations et relations. */
    tables: [
      "Membership", // énumération de rôle + double lien
      "Booking", // énumération de statut, refs multiples
      "Schedule", // cible de DEUX liens distincts depuis EventType
      "Webhook", // TABLEAU d'énumération (WebhookTriggerEvents[])
      "ApiKey", // horodatage de création seul
      "Availability", // dates et heures nues
    ],
    rename: {},
    stresses: "énumérations partagées, relations multiples, valeurs par défaut",
  },
  ghost: {
    format: "knex",
    repo: "TryGhost/Ghost",
    file: "ghost/core/core/server/data/schema/schema.js",
    license: "MIT",
    sha256: "217fcb84cc3cc574",
    /** Six tables sur quatre-vingt-neuf. */
    tables: [
      "newsletters", // maxlength partout, defaultTo, isIn
      "posts", // clé primaire string(24), texte long, index
      "posts_meta", // FK avec cascadeDelete
      "users", // unsigned, validations
      "posts_authors", // table de JOINTURE + cascade
      "api_keys", // références croisées
    ],
    rename: { users: "accounts" },
    stresses: "cascades de suppression, bornes de longueur, entiers 64 bits",
  },
};

/**
 * Consigne FIGÉE.
 *
 * Elle exige explicitement les noms de colonnes SQL : sans cette phrase, un agent
 * qui les ignore a raison de le faire, et le banc ne mesure plus le trou
 * principal d'`umami`. Elle ne souffle en revanche AUCUN moyen — savoir s'il
 * appelle le générateur ou écrit du Drizzle de mémoire fait partie de la mesure.
 */
const PROMPT =
  "Le fichier `schema-cible.md` à la racine décrit le modèle de données que cette " +
  "application doit porter. Reproduis-le fidèlement : mêmes tables, mêmes colonnes " +
  "AVEC LES NOMS DE COLONNES SQL indiqués, mêmes types, mêmes contraintes " +
  "d'unicité, mêmes index (y compris ceux qui portent plusieurs colonnes). " +
  "Termine en prouvant que l'application démarre.";

// ─────────────────────────────────────────────────────────────────────────────
// Lecteurs — deux formats d'entrée, UNE forme canonique
// ─────────────────────────────────────────────────────────────────────────────

/**
 * La forme canonique que les deux lecteurs rendent et que le juge compare.
 *
 * @typedef {object} ICanonTable
 * @property {string} model - nom du modèle dans la source (après renommage).
 * @property {string} table - nom SQL de la table.
 * @property {Array<{prop: string, column: string, logical: string|null, nullable: boolean, unique: boolean, isId: boolean, note?: string}>} columns
 * @property {Array<{columns: string[], unique: boolean}>} indexes
 */

/** Types Prisma → type logique Nodefony (`null` = la grammaire ne l'exprime pas). */
const PRISMA_TYPES = {
  String: "string",
  Int: "int",
  BigInt: null, // entier 64 bits — absent de la grammaire
  Float: "float",
  Decimal: "decimal",
  Boolean: "bool",
  DateTime: "date",
  Json: "json",
  Bytes: null, // binaire — absent de la grammaire
};

/** Types knex (Ghost) → type logique Nodefony. */
const KNEX_TYPES = {
  string: "string",
  text: "text",
  integer: "int",
  bigInteger: null, // entier 64 bits — absent de la grammaire
  boolean: "bool",
  dateTime: "date",
  float: "float",
  blob: null, // binaire — absent de la grammaire
};

/**
 * Lit un schéma Prisma.
 *
 * Les énumérations déclarées HORS des modèles sont collectées à part : une
 * colonne qui en porte une est marquée, parce que notre grammaire ne connaît que
 * l'énumération inline — dix colonnes partageant un type nommé deviendraient dix
 * répétitions, et c'est exactement ce qu'on veut voir apparaître au rapport.
 *
 * @param src - texte du schéma.
 * @returns {{tables: ICanonTable[], enums: Map<string, string[]>}}
 */
export function readPrisma(src) {
  const enums = new Map();
  {
    let name = null;
    let values = [];
    for (const raw of src.split("\n")) {
      const line = raw.trim();
      const open = /^enum\s+(\w+)\s*\{/u.exec(line);
      if (open) {
        name = open[1];
        values = [];
        continue;
      }
      if (name === null) continue;
      if (line === "}") {
        enums.set(name, values);
        name = null;
        continue;
      }
      if (line && !line.startsWith("//")) values.push(line.split(/\s+/u)[0]);
    }
  }

  const tables = [];
  let current = null;
  const colOf = new Map();

  for (const raw of src.split("\n")) {
    const line = raw.trim();
    const model = /^model\s+(\w+)\s*\{/u.exec(line);
    if (model) {
      current = {
        model: model[1],
        table: model[1].toLowerCase(),
        columns: [],
        indexes: [],
      };
      tables.push(current);
      colOf.set(current.model, new Map());
      continue;
    }
    if (!current) continue;
    if (line === "}") {
      current = null;
      continue;
    }

    const tableMap = /^@@map\("([^"]+)"\)/u.exec(line);
    if (tableMap) {
      current.table = tableMap[1];
      continue;
    }
    const idx = /^@@(index|unique)\(\[([^\]]+)\]/u.exec(line);
    if (idx) {
      current.indexes.push({
        unique: idx[1] === "unique",
        props: idx[2].split(",").map((c) => c.trim()),
      });
      continue;
    }

    const field = /^(\w+)\s+(\w+)(\??)(\[\])?\s*(.*)$/u.exec(line);
    if (!field) continue;
    const [, prop, type, optional, list, attrs] = field;

    const isEnum = enums.has(type);
    // Navigation Prisma (`Account? @relation(…)`, `Website[]`) : pas une colonne.
    // Un TABLEAU d'énumération en est une, en revanche — et c'est un cas que la
    // grammaire n'exprime pas du tout.
    if (!Object.hasOwn(PRISMA_TYPES, type) && !isEnum) continue;
    if (list && !isEnum) continue;

    const map = /@map\("([^"]+)"\)/u.exec(attrs);
    const column = map ? map[1] : prop;

    // La taille NATIVE (`@db.VarChar(255)`, `@db.Decimal(10,1)`, `@db.Char(2)`).
    // Sans elle, la cible remise à l'agent dirait « String » là où la source dit
    // « au plus 255 caractères » — et le banc jugerait une longueur qu'il
    // n'aurait jamais demandée.
    const db = /@db\.(\w+)(?:\(([^)]*)\))?/u.exec(attrs);
    const dbArgs = db?.[2]?.split(",").map((s) => Number(s.trim()));
    // `String @db.Uuid` n'est PAS une chaîne : c'est un identifiant, que
    // PostgreSQL porte dans un type dédié. Le confondre faisait crier le juge
    // sur les dix-huit colonnes de clé — dix-huit faux positifs qui noyaient le
    // seul vrai écart du run.
    const isUuid = db && /^uuid$/iu.test(db[1]);
    const isDecimal = db && /^decimal$/iu.test(db[1]);
    const length = !isDecimal && dbArgs?.length === 1 ? dbArgs[0] : undefined;
    const precision = isDecimal ? dbArgs?.[0] : undefined;
    const scale = isDecimal ? dbArgs?.[1] : undefined;

    colOf.get(current.model).set(prop, column);
    current.columns.push({
      prop,
      column,
      logical: isEnum ? "enum" : isUuid ? "uuid" : PRISMA_TYPES[type],
      length,
      precision,
      scale,
      sourceType: db
        ? `${type}${list ? "[]" : ""} — ${db[1]}${db[2] ? `(${db[2]})` : ""}`
        : type + (list ? "[]" : ""),
      nullable: optional === "?",
      unique: /@unique\b/u.test(attrs),
      isId: /@id\b/u.test(attrs),
      note: isEnum
        ? list
          ? `tableau d'énumération ${type} (INEXPRIMABLE)`
          : `énumération PARTAGÉE ${type} (${enums.get(type)?.length ?? 0} valeurs)`
        : PRISMA_TYPES[type] === null
          ? `type ${type} INEXPRIMABLE`
          : undefined,
    });
  }

  // Les index se déclarent en noms de PROPRIÉTÉ ; le juge lit des noms de
  // COLONNE. La traduction se fait ici, une fois.
  for (const t of tables) {
    const m = colOf.get(t.model);
    for (const i of t.indexes) i.columns = i.props.map((p) => m.get(p) ?? p);
  }
  return { tables, enums };
}

/**
 * Rend le contenu du bloc `{…}` qui suit `from`, accolades extérieures exclues.
 *
 * Un comptage d'accolades, là où une expression régulière doit décider À
 * L'AVANCE de la profondeur qu'elle tolère — et se trompe en silence dès qu'un
 * cas réel la dépasse.
 *
 * @param src - texte source.
 * @param from - position à partir de laquelle chercher l'accolade ouvrante.
 * @returns le corps du bloc, ou `null` s'il n'est pas refermé.
 */
function sliceBraces(src, from) {
  let i = src.indexOf("{", from);
  if (i === -1) return null;
  const start = i + 1;
  let depth = 0;
  for (; i < src.length; i += 1) {
    const c = src[i];
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i);
    }
  }
  return null;
}

/**
 * Lit le schéma knex de Ghost (`{type, maxlength, nullable, defaultTo, …}`).
 *
 * Le fichier est du JavaScript, mais l'ÉVALUER exécuterait du code tiers dans
 * notre processus pour en tirer une structure de données : on l'analyse
 * textuellement. Les attributs qui n'existent pas chez nous (`unsigned`,
 * `cascadeDelete`, `validations`) sont RELEVÉS plutôt qu'ignorés — ils sont la
 * moitié de ce que le banc vient chercher.
 *
 * @param src - texte du schéma.
 * @returns {{tables: ICanonTable[], enums: Map<string, string[]>}}
 */
export function readKnex(src) {
  const tables = [];
  for (const open of src.matchAll(/^ {4}(\w+): \{$/gmu)) {
    const name = open[1];
    const body = sliceBraces(src, open.index);
    if (body === null) continue;
    const current = { model: name, table: name, columns: [], indexes: [] };
    tables.push(current);

    // Les colonnes de la table, repérées par leur INDENTATION plutôt que par
    // une expression régulière imbriquée. Deux fois payé pour l'apprendre : une
    // regex à un niveau d'imbrication perdait `bio`, `meta_title`, `secret`… —
    // toutes celles portant `validations: {isLength: {max: 300}}`, DEUX niveaux.
    // Un compteur d'accolades ne se laisse pas surprendre par la profondeur.
    for (const col of body.matchAll(/^ {8}(\w+): \{/gmu)) {
      const prop = col[1];
      const attrs = sliceBraces(body, col.index);
      if (attrs === null) continue;
      const type = /type:\s*'(\w+)'/u.exec(attrs)?.[1];
      if (!type) continue;
      const maxlength = /maxlength:\s*(\d+)/u.exec(attrs)?.[1];

      // Ce que Ghost déclare et que la grammaire ne sait pas dire. Relevé plutôt
      // qu'ignoré : c'est la moitié de ce que le banc vient chercher.
      const notes = [];
      if (/unsigned:\s*true/u.test(attrs))
        notes.push("unsigned (INEXPRIMABLE)");
      if (/cascadeDelete:\s*true/u.test(attrs))
        notes.push("cascade de suppression (INEXPRIMABLE)");
      if (/setNullDelete:\s*true/u.test(attrs))
        notes.push("mise à NULL en cascade (INEXPRIMABLE)");
      if (/isIn:/u.test(attrs)) notes.push("énumération applicative");
      if (KNEX_TYPES[type] === null) notes.push(`type ${type} INEXPRIMABLE`);
      if (maxlength && Number(maxlength) > 65535)
        notes.push(`longueur ${maxlength} (texte long)`);

      current.columns.push({
        prop,
        // Ghost écrit déjà ses colonnes en snake_case : nom TS = nom SQL.
        column: prop,
        logical: KNEX_TYPES[type] ?? null,
        sourceType: maxlength ? `${type}(${maxlength})` : type,
        nullable: /nullable:\s*true/u.test(attrs),
        unique: /unique:\s*true/u.test(attrs),
        isId: /primary:\s*true/u.test(attrs),
        note: notes.length ? notes.join(" · ") : undefined,
      });
      if (/index:\s*true/u.test(attrs)) {
        current.indexes.push({ unique: false, columns: [prop], props: [prop] });
      }
    }
  }
  return { tables, enums: new Map() };
}

// ─────────────────────────────────────────────────────────────────────────────
// Source : téléchargement, cache, empreinte
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rend le texte du schéma, depuis le cache ou GitHub.
 *
 * L'empreinte est VÉRIFIÉE mais non bloquante : un schéma amont qui bouge ne
 * doit pas rendre le banc inutilisable, seulement dire tout haut que ce run ne
 * se compare plus aux précédents. Un banc qui meurt au premier commit d'un autre
 * projet ne serait plus lancé du tout, ce qui est pire.
 */
function fetchSchema(key, def) {
  mkdirSync(CACHE, { recursive: true });
  const cached = path.join(
    CACHE,
    `${key}.${def.format === "knex" ? "js" : "prisma"}`,
  );
  let content;
  if (existsSync(cached)) {
    content = readFileSync(cached, "utf8");
  } else {
    console.log(`• téléchargement du schéma ${key} (${def.repo})…`);
    const res = spawnSync(
      "gh",
      ["api", `repos/${def.repo}/contents/${def.file}`, "--jq", ".content"],
      { encoding: "utf8", timeout: 120_000, maxBuffer: 32 * 1024 * 1024 },
    );
    if (res.status !== 0) {
      throw new Error(
        `téléchargement impossible (${def.repo}) — ${res.stderr?.trim() || "gh en échec"}`,
      );
    }
    content = Buffer.from(res.stdout.replace(/\s/gu, ""), "base64").toString(
      "utf8",
    );
    writeFileSync(cached, content);
  }
  const sha = createHash("sha256").update(content).digest("hex").slice(0, 16);
  const drifted = sha !== def.sha256;
  if (drifted) {
    console.log(
      `\n⚠️  Le schéma ${key} a CHANGÉ en amont (attendu ${def.sha256}, lu ${sha}).\n` +
        `   Ce run ne se compare pas aux précédents. Le sous-ensemble figé peut\n` +
        `   avoir perdu des tables — vérifier avant de conclure quoi que ce soit.\n`,
    );
  }
  return { content, sha, drifted };
}

/** Ne garde que les tables du sous-ensemble figé, et applique les renommages. */
export function subset(parsed, def) {
  const wanted = new Set(def.tables);
  const kept = parsed.tables.filter((t) => wanted.has(t.model));
  const missing = def.tables.filter(
    (n) => !parsed.tables.some((t) => t.model === n),
  );
  for (const t of kept) {
    const alias = def.rename[t.model];
    if (alias) {
      t.model = alias;
      t.table = alias.toLowerCase();
    }
  }
  return { tables: kept, missing };
}

/**
 * Rend le schéma cible sous une forme LISIBLE par l'agent.
 *
 * Volontairement pas le format d'origine : donner du Prisma inviterait à
 * chercher un import de Prisma, et donner du knex à chercher knex. Ce qu'on veut
 * mesurer, c'est la traduction d'un MODÈLE vers la grammaire de Nodefony — pas
 * la reconnaissance d'un outil.
 */
function renderTarget(tables, def) {
  const out = [
    "# Modèle de données à reproduire",
    "",
    `> Extrait de ${def.repo} (${def.license}), réduit à ${tables.length} tables.`,
    "> Les noms entre parenthèses sont les **noms de colonnes SQL** attendus.",
    "",
  ];
  for (const t of tables) {
    out.push(`## Table \`${t.table}\``, "");
    out.push("| propriété | colonne SQL | type | nul ? | unique ? |");
    out.push("| --- | --- | --- | --- | --- |");
    for (const c of t.columns) {
      out.push(
        `| ${c.prop} | \`${c.column}\` | ${c.sourceType} | ${c.nullable ? "oui" : "non"} | ${c.unique ? "oui" : "non"}${c.isId ? " (clé primaire)" : ""} |`,
      );
    }
    out.push("");
    if (t.indexes.length) {
      out.push("Index :");
      for (const i of t.indexes) {
        out.push(`- ${i.unique ? "unique " : ""}sur (${i.columns.join(", ")})`);
      }
      out.push("");
    }
  }
  return out.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Lecture du schéma RÉELLEMENT créé
// ─────────────────────────────────────────────────────────────────────────────

/** Retrouve le fichier de base de l'app témoin (l'ORM le pose sous `var/`). */
function findDatabase(app) {
  const stack = [path.join(app, "var"), app];
  const seen = new Set();
  while (stack.length) {
    const dir = stack.pop();
    if (!dir || seen.has(dir) || !existsSync(dir)) continue;
    seen.add(dir);
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules" && e.name !== ".git") stack.push(full);
      } else if (/\.(sqlite|sqlite3|db)$/u.test(e.name)) {
        return full;
      }
    }
  }
  return null;
}

/**
 * Lit le schéma que la base porte VRAIMENT.
 *
 * @param dbPath - fichier SQLite créé au boot.
 * @returns une entrée par table : colonnes et index.
 */
function readSqlite(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const out = new Map();
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .all();
  for (const { name } of tables) {
    const cols = db.prepare(`PRAGMA table_info("${name}")`).all();
    const indexes = [];
    for (const idx of db.prepare(`PRAGMA index_list("${name}")`).all()) {
      const info = db.prepare(`PRAGMA index_info("${idx.name}")`).all();
      indexes.push({
        name: idx.name,
        unique: idx.unique === 1,
        columns: info.map((c) => c.name),
      });
    }
    out.set(name.toLowerCase(), {
      columns: cols.map((c) => ({
        name: c.name,
        type: (c.type || "").toLowerCase(),
        nullable: c.notnull === 0,
        pk: c.pk > 0,
      })),
      indexes,
    });
  }
  db.close();
  return out;
}

/**
 * Lit le schéma que PostgreSQL porte VRAIMENT.
 *
 * Contrairement à SQLite, ce moteur conserve tout ce que la grammaire prétend
 * traduire : la longueur d'une chaîne, la précision d'un décimal, `bytea`,
 * `jsonb`, `timestamptz`. C'est pour ça que le juge vit ici.
 *
 * @param url - chaîne de connexion.
 * @returns une entrée par table, même forme que le lecteur SQLite.
 */
export async function readPostgres(url) {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const cols = await client.query(
      `SELECT table_name, column_name, udt_name, is_nullable,
              character_maximum_length AS len,
              numeric_precision AS prec, numeric_scale AS scale
         FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position`,
    );
    const idx = await client.query(
      `SELECT t.relname AS table_name, i.relname AS index_name,
              ix.indisunique AS is_unique,
              -- Le cast en text[] n'est PAS cosmétique : \`attname\` est de type
              -- \`name\`, et le pilote ne sait pas décoder un \`name[]\` — il rend
              -- la chaîne brute « {a,b} », sur laquelle \`.join()\` n'existe pas.
              array_agg(a.attname::text ORDER BY k.ord) AS columns
         FROM pg_index ix
         JOIN pg_class t ON t.oid = ix.indrelid
         JOIN pg_class i ON i.oid = ix.indexrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord)
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
        WHERE n.nspname = 'public'
        GROUP BY t.relname, i.relname, ix.indisunique`,
    );
    const out = new Map();
    for (const r of cols.rows) {
      const key = r.table_name.toLowerCase();
      if (!out.has(key)) out.set(key, { columns: [], indexes: [] });
      out.get(key).columns.push({
        name: r.column_name,
        type: r.udt_name.toLowerCase(),
        length: r.len,
        precision: r.prec,
        scale: r.scale,
        nullable: r.is_nullable === "YES",
      });
    }
    for (const r of idx.rows) {
      const key = r.table_name.toLowerCase();
      if (!out.has(key)) continue;
      out.get(key).indexes.push({
        name: r.index_name,
        unique: r.is_unique,
        columns: r.columns,
      });
    }
    return out;
  } finally {
    await client.end();
  }
}

/**
 * Supprime les tables du sous-ensemble AVANT le run.
 *
 * Sans ce nettoyage, les tables laissées par le run précédent seraient comptées
 * comme des réussites de celui-ci — le juge lirait un état, pas un résultat.
 * La base de développement est partagée : on ne touche QUE les tables attendues.
 *
 * @returns le nombre de tables effectivement supprimées.
 */
async function dropExpected(url, tables) {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: url });
  await client.connect();
  let dropped = 0;
  try {
    for (const t of tables) {
      const res = await client.query(
        `SELECT to_regclass($1) IS NOT NULL AS present`,
        [`public.${t.table}`],
      );
      if (res.rows[0]?.present) {
        await client.query(`DROP TABLE IF EXISTS "${t.table}" CASCADE`);
        dropped += 1;
      }
    }
  } finally {
    await client.end();
  }
  return dropped;
}

/**
 * Le type PostgreSQL obtenu correspond-il au type attendu — TAILLE COMPRISE ?
 *
 * C'est ici que le banc gagne sa raison d'être : sur SQLite, `varchar(255)` et
 * `char(2)` sont indiscernables, et toute la partie « tailles » d'un schéma réel
 * passait pour juste sans avoir jamais été vérifiée.
 *
 * @returns `null` si tout correspond, sinon la raison de l'écart.
 */
export function pgMismatch(expected, got) {
  const t = got.type;
  switch (expected.logical) {
    case "string":
      if (t !== "varchar" && t !== "text" && t !== "bpchar")
        return `attendu varchar, obtenu ${t}`;
      // La longueur n'est vérifiée que si la source en déclarait une.
      if (
        expected.length &&
        got.length &&
        Number(expected.length) !== got.length
      )
        return `longueur ${got.length} au lieu de ${expected.length}`;
      if (expected.length && !got.length)
        return `longueur ${expected.length} perdue (${t})`;
      return null;
    case "text":
      return t === "text" || t === "varchar"
        ? null
        : `attendu text, obtenu ${t}`;
    case "int":
      return ["int2", "int4", "int8", "numeric"].includes(t)
        ? null
        : `attendu entier, obtenu ${t}`;
    case "float":
      return ["float4", "float8", "numeric"].includes(t)
        ? null
        : `attendu flottant, obtenu ${t}`;
    case "decimal":
      if (t !== "numeric") return `attendu numeric, obtenu ${t}`;
      if (expected.precision && got.precision !== Number(expected.precision))
        return `précision ${got.precision ?? "aucune"} au lieu de ${expected.precision}`;
      return null;
    case "bool":
      return t === "bool" ? null : `attendu bool, obtenu ${t}`;
    case "date":
      return ["timestamptz", "timestamp", "date", "int8"].includes(t)
        ? null
        : `attendu horodatage, obtenu ${t}`;
    case "json":
      return ["jsonb", "json", "text"].includes(t)
        ? null
        : `attendu jsonb, obtenu ${t}`;
    case "enum":
      return ["varchar", "text"].includes(t)
        ? null
        : `attendu varchar, obtenu ${t}`;
    case "uuid":
      // Une clé en `text` FONCTIONNE et compile — jusqu'à la première jointure,
      // que PostgreSQL refuse (« operator does not exist: text = uuid »). La
      // dégradation se signale donc, sans être une absence.
      if (t === "uuid") return null;
      return ["varchar", "text"].includes(t)
        ? `identifiant dégradé en ${t} (toute jointure sera refusée)`
        : `attendu uuid, obtenu ${t}`;
    default:
      // Type INEXPRIMABLE par la grammaire (binaire, entier 64 bits) : ce qui
      // existe est déjà un contournement de l'agent. Le rapport le dira.
      return t === "bytea" || t === "int8" ? null : `type non porté (${t})`;
  }
}

/**
 * Le type SQLite obtenu est-il compatible avec le type logique attendu ?
 *
 * SQLite n'a que cinq classes de stockage, et Nodefony le sait : une chaîne
 * bornée y est un `text` comme les autres. On ne compare donc que ce qui est
 * DISTINGUABLE sur ce moteur — juger une longueur ici rendrait un verdict que
 * le moteur ne porte pas.
 */
function typeMatches(logical, sqlType) {
  const t = sqlType.replace(/\(.*/u, "").trim();
  switch (logical) {
    case "string":
    case "text":
    case "json":
    case "enum":
      return t === "text";
    case "int":
    case "bool":
    case "date":
      return t === "integer" || t === "numeric";
    case "float":
      return t === "real" || t === "numeric";
    case "decimal":
      return t === "numeric" || t === "text" || t === "real";
    default:
      // Type INEXPRIMABLE par la grammaire : tout ce qui existe est déjà un
      // contournement de l'agent. Le rapport le dira — pas un faux vert ici.
      return t === "blob";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Décor
// ─────────────────────────────────────────────────────────────────────────────

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, {
    stdio: "inherit",
    env: APP_ENV,
    timeout: 900_000,
    ...opts,
  });

const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" });

/**
 * Tarballs des paquets publiables — l'outil de la RELEASE, pas un packer de plus.
 *
 * `pack-all.mjs` porte des subtilités qu'une copie perdrait sans le dire : la
 * bascule des `exports.types` du source vers les `.d.ts` générés au moment du
 * pack (sans elle, le typecheck du consommateur casse), les peers rendus
 * optionnels, la restauration des `package.json` à l'octet près.
 *
 * Re-packer coûte une minute ; on ne le refait donc que si un `dist/` a bougé
 * depuis le dernier pack — la fraîcheur se CONSTATE, elle ne se suppose pas.
 *
 * @returns {{dir: string, manifest: Record<string,string>}}
 */
function packTarballs(force) {
  const outDir = path.join(REPO, "release", "tarballs");
  const manifestPath = path.join(outDir, "manifest.json");
  const newestDist = () => {
    let newest = 0;
    const roots = [
      path.join(REPO, "src", "nodefony"),
      ...readdirSync(path.join(REPO, "src", "packages", "@nodefony"), {
        withFileTypes: true,
      })
        .filter((e) => e.isDirectory())
        .map((e) => path.join(REPO, "src", "packages", "@nodefony", e.name)),
    ];
    for (const r of roots) {
      const f = path.join(r, "dist", "index.js");
      if (existsSync(f)) newest = Math.max(newest, lstatSync(f).mtimeMs);
    }
    return newest;
  };

  const fresh =
    !force &&
    existsSync(manifestPath) &&
    lstatSync(manifestPath).mtimeMs >= newestDist();
  if (fresh) {
    console.log("• tarballs à jour (aucun dist plus récent) — pack ignoré");
  } else {
    console.log("• npm pack des paquets publiables (release/tarballs)…");
    sh(process.execPath, [
      path.join(
        REPO,
        ".claude",
        "skills",
        "nodefony-release",
        "scripts",
        "pack-all.mjs",
      ),
    ]);
  }
  if (!existsSync(manifestPath)) {
    throw new Error(
      `pack : manifeste absent (${manifestPath}) — le checkout est-il bâti ? (npm run build)`,
    );
  }
  return {
    dir: outDir,
    manifest: JSON.parse(readFileSync(manifestPath, "utf8")),
  };
}

/**
 * Réécrit les dépendances du scope `nodefony` vers les tarballs COPIÉS dans
 * l'app, puis installe.
 *
 * Les tarballs sont copiés (et référencés en relatif) plutôt que pointés dans le
 * dépôt : un `file:` absolu vers `release/tarballs` rebrancherait l'application
 * sur le checkout par un autre chemin, ce qu'on vient précisément de couper.
 *
 * @returns les noms de paquets installés depuis un tarball.
 */
function installFromTarballs(app, packed) {
  const local = path.join(app, "tarballs");
  cpSync(packed.dir, local, { recursive: true });
  const pkgPath = path.join(app, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const installed = [];
  for (const block of ["dependencies", "devDependencies"]) {
    for (const name of Object.keys(pkg[block] ?? {})) {
      if (name !== "nodefony" && !name.startsWith("@nodefony/")) continue;
      const tgz = packed.manifest[name];
      if (!tgz) {
        throw new Error(
          `tarball absent pour ${name} — le paquet est-il publiable (non private) ?`,
        );
      }
      pkg[block][name] = `file:./tarballs/${tgz}`;
      installed.push(name);
    }
  }
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`• npm install (${installed.length} paquets depuis tarballs)…`);
  sh("npm", ["install", "--no-audit", "--no-fund"], { cwd: app });
  return installed.sort();
}

/**
 * CONSTATE l'isolation du décor — ne la suppose pas.
 *
 * Trois faits, chacun suffisant à fausser le verdict s'il est faux : le run
 * vit hors du dépôt (sinon `../..` y ramène), aucun paquet du framework n'est
 * un lien qui sorte de l'app (sinon les sources sont à un `cd` de distance), et
 * aucun `.ts` de source n'est atteignable dans `node_modules` (un `.d.ts` l'est
 * légitimement — un installeur les reçoit).
 *
 * @returns {{ok: boolean, facts: string[]}}
 */
function assertIsolated(app) {
  const facts = [];
  let ok = true;
  const note = (good, text) => {
    if (!good) ok = false;
    facts.push(`${good ? "✅" : "❌"} ${text}`);
  };

  const realApp = realpathSync(app);
  const realRepo = realpathSync(REPO);
  note(
    !realApp.startsWith(realRepo + path.sep),
    `l'application vit hors du dépôt (${realApp})`,
  );

  const scopes = [
    path.join(app, "node_modules", "nodefony"),
    ...(existsSync(path.join(app, "node_modules", "@nodefony"))
      ? readdirSync(path.join(app, "node_modules", "@nodefony")).map((n) =>
          path.join(app, "node_modules", "@nodefony", n),
        )
      : []),
  ].filter((p) => existsSync(p));

  const escaping = scopes.filter((p) => {
    const st = lstatSync(p);
    return st.isSymbolicLink() && !realpathSync(p).startsWith(realApp);
  });
  note(
    escaping.length === 0,
    `aucun paquet du framework ne sort de l'app par un lien` +
      (escaping.length ? ` (${escaping.length} en sortent)` : ""),
  );

  // Un `.ts` qui n'est pas une déclaration EST une source : sa présence dit que
  // l'agent peut lire l'implémentation du framework, ce qu'un installeur ne
  // peut pas.
  let sources = 0;
  let sample = "";
  const walk = (dir, depth) => {
    if (depth > 6 || sources > 0) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (sources > 0) return;
      const p = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (e.name === "node_modules") continue;
        walk(p, depth + 1);
      } else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) {
        sources += 1;
        sample = path.relative(app, p);
      }
    }
  };
  for (const s of scopes) walk(s, 0);
  note(
    sources === 0,
    `aucune source .ts du framework atteignable` +
      (sample ? ` (${sample})` : ""),
  );

  return { ok, facts };
}

/** App témoin fraîche, schéma cible déposé à sa racine. */
function setup(runDir, target) {
  const app = path.join(runDir, "app");
  mkdirSync(runDir, { recursive: true });
  console.log(
    `• app témoin (create app --preset complete${LINKED ? " --link" : ""})…`,
  );
  sh(
    BIN,
    [
      "create",
      "app",
      "schema-bench",
      "--dir",
      app,
      "--preset",
      "complete",
      "--frontend",
      "none",
      ...(LINKED
        ? ["--link"]
        : // Les deps du scaffold pointent le registre npm, où la version 10
          // n'est pas publiée : l'installation du scaffold échouerait sur un
          // 404 (avertissement non bloquant, mais vingt secondes perdues et un
          // journal trompeur). On installe nous-mêmes, après réécriture.
          ["--no-install"]),
      "--yes",
    ],
    { cwd: RUN_ROOT },
  );
  if (LINKED) {
    console.log("• npm install…");
    sh("npm", ["install", "--no-audit", "--no-fund"], { cwd: app });
  } else {
    installFromTarballs(app, packTarballs(process.argv.includes("--repack")));
  }
  writeFileSync(path.join(app, "schema-cible.md"), target);
  if (!LINKED) {
    // Une trentaine de mégaoctets d'archives n'ont rien à faire dans les
    // instantanés qui servent à lire le travail de l'agent.
    appendFileSync(
      path.join(app, ".gitignore"),
      "\n# décor du banc — archives d'installation\ntarballs/\n",
    );
  }
  git(app, "init", "-q");
  git(app, "add", "-A");
  git(
    app,
    "-c",
    "user.name=bench",
    "-c",
    "user.email=bench@local",
    "commit",
    "-qm",
    "état initial",
  );
  return app;
}

/**
 * Déroule l'agent dans l'app ; transcript écrit AU FIL DE L'EAU.
 *
 * Le premier jet capturait tout en mémoire et n'écrivait qu'à la fin : pendant
 * les vingt minutes du run, rien ne disait où en était l'agent, et une
 * interruption emportait le transcript entier — donc la possibilité même de
 * re-juger sans relancer. Chaque ligne est maintenant sur le disque dès qu'elle
 * arrive, et l'outil appelé s'affiche à mesure.
 *
 * @returns {Promise<string>} le transcript complet.
 */
function runAgent(app, runDir) {
  console.log(`\n━━ agent (${MODEL}) — reproduire le schéma`);
  const out = path.join(runDir, "transcript.jsonl");
  writeFileSync(out, "");
  const started = Date.now();

  return new Promise((resolve, reject) => {
    const child = spawn(
      AGENT,
      [...AGENT_ARGS, ...(MODEL ? ["--model", MODEL] : []), PROMPT],
      { cwd: app, env: APP_ENV, stdio: ["ignore", "pipe", "pipe"] },
    );
    const kill = setTimeout(() => child.kill("SIGKILL"), 60 * 60 * 1000);
    let transcript = "";
    let pending = "";
    let turns = 0;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      transcript += chunk;
      appendFileSync(out, chunk);
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (ev?.type !== "assistant") continue;
        turns += 1;
        const tools = (ev.message?.content ?? [])
          .filter((b) => b?.type === "tool_use")
          .map((b) => {
            const i = b.input ?? {};
            const what =
              i.command ??
              i.file_path ??
              i.pattern ??
              i.path ??
              i.description ??
              "";
            return `${b.name}(${String(what).replace(/\s+/gu, " ").slice(0, 64)})`;
          });
        if (!tools.length) continue;
        const s = Math.round((Date.now() - started) / 1000);
        console.log(
          `    ${String(s).padStart(4)}s #${turns} ${tools.join(" ")}`,
        );
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (c) => appendFileSync(out + ".err", c));
    child.on("error", (e) => {
      clearTimeout(kill);
      reject(e);
    });
    child.on("close", () => {
      clearTimeout(kill);
      resolve(transcript);
    });
  }).then((transcript) => finishAgent(app, runDir, transcript));
}

/** Clôt le passage de l'agent : garde-fou d'interruption puis instantané git. */
function finishAgent(app, runDir, transcript) {
  // Un agent qui n'a jamais démarré rendrait un rapport identique à celui d'une
  // grammaire incapable — on s'arrête plutôt que de publier un verdict qui n'en
  // est pas un.
  if (/"terminal_reason"\s*:\s*"api_error"/u.test(transcript)) {
    const turns = (transcript.match(/"type"\s*:\s*"assistant"/gu) ?? []).length;
    console.log(
      `\n🛑 agent interrompu après ${turns} échanges — verdict NON concluant.\n` +
        `   Décor conservé ; \`--analyze-only ${runDir}\` re-juge sans relancer.`,
    );
    process.exit(2);
  }
  git(app, "add", "-A");
  git(
    app,
    "-c",
    "user.name=bench",
    "-c",
    "user.email=bench@local",
    "commit",
    "-qm",
    "travail de l'agent",
    "--allow-empty",
  );
  return transcript;
}

/**
 * Compte ce que l'agent a fait DE SES MAINS sur les fichiers d'entité.
 *
 * C'est la mesure centrale : le générateur écrit ces fichiers, donc toute
 * édition ultérieure dit qu'il n'a pas suffi. On lit le transcript et non le
 * diff — un fichier généré puis retouché a le même aspect final qu'un fichier
 * écrit à la main, et seule la SÉQUENCE distingue les deux.
 *
 * Relève AUSSI les incursions hors de l'application. Le gate d'isolation
 * ({@link assertIsolated}) constate que le décor est fermé ; ce compte-ci dit ce
 * que l'agent a CHERCHÉ à faire — il reste utile en `--link`, où le décor est
 * ouvert et où le chiffre explique alors le verdict.
 */
function countWork(transcript, app) {
  const generated = [];
  const edits = [];
  const outside = [];
  const realApp = app && existsSync(app) ? realpathSync(app) : null;
  /** Un chemin est « dehors » s'il est absolu et ne mène pas dans l'app. */
  const isOutside = (p) =>
    typeof p === "string" &&
    path.isAbsolute(p) &&
    realApp !== null &&
    !path.resolve(p).startsWith(realApp);
  for (const line of transcript.split("\n")) {
    if (!line.trim()) continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    const blocks = ev?.message?.content;
    if (!Array.isArray(blocks)) continue;
    for (const b of blocks) {
      if (b?.type !== "tool_use") continue;
      const input = b.input ?? {};
      if (b.name === "Bash" && /create\s+entity/u.test(input.command ?? "")) {
        generated.push(String(input.command).slice(0, 160));
      }
      if (
        (b.name === "Edit" ||
          b.name === "Write" ||
          b.name === "NotebookEdit") &&
        /nodefony\/entity\/.*\.ts$/u.test(input.file_path ?? "")
      ) {
        edits.push({ tool: b.name, file: path.basename(input.file_path) });
      }
      // Lecture d'un fichier hors de l'app, ou commande shell qui cite un
      // chemin du dépôt : les deux disent que l'agent s'est servi ailleurs.
      const target = input.file_path ?? input.path ?? input.pattern;
      if (isOutside(target)) {
        outside.push({ tool: b.name, target: String(target) });
      } else if (typeof input.command === "string") {
        const cited = input.command.match(/(?:^|\s)(\/[^\s'"]+)/gu) ?? [];
        for (const raw of cited) {
          const p = raw.trim();
          if (isOutside(p)) outside.push({ tool: "Bash", target: p });
        }
      }
    }
  }
  return { generated, edits, outside };
}

/**
 * Le CLI de l'APPLICATION, jamais celui du checkout quand l'app en possède un.
 *
 * Le banc mesure ce qu'un installeur reçoit : piloter l'app témoin avec le
 * binaire du dépôt réintroduirait par la porte de service exactement ce que le
 * décor vient de couper.
 */
function appBin(app) {
  const own = path.join(app, "node_modules", "nodefony", "bin", "nodefony");
  return existsSync(own) ? own : BIN;
}

/** Boote l'app en console — exécute le DDL de développement, sans ouvrir de port. */
function bootApp(app, runDir) {
  console.log("\n• build de l'app…");
  const build = spawnSync("npm", ["run", "build"], {
    cwd: app,
    encoding: "utf8",
    timeout: 900_000,
    env: APP_ENV,
  });
  console.log(`  build : exit ${build.status}`);
  console.log("• boot console (crée les tables)…");
  const boot = spawnSync(
    process.execPath,
    [appBin(app), "inspect", "entities", "--json"],
    { cwd: app, encoding: "utf8", timeout: 300_000, env: APP_ENV },
  );
  writeFileSync(
    path.join(runDir, "boot.log"),
    `build exit ${build.status}\n${build.stdout ?? ""}${build.stderr ?? ""}\n` +
      `--- boot exit ${boot.status} ---\n${boot.stdout ?? ""}\n${boot.stderr ?? ""}`,
  );
  console.log(`  boot  : exit ${boot.status}`);
  return { buildOk: build.status === 0, bootOk: boot.status === 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Le juge
// ─────────────────────────────────────────────────────────────────────────────

/** Confronte le schéma attendu au schéma réellement créé. */
export function compare(expected, actual) {
  return expected.map((t) => {
    const got = actual.get(t.table.toLowerCase());
    if (!got) {
      return {
        table: t.table,
        present: false,
        columns: { expected: t.columns.length, found: 0, wrongType: 0 },
        indexes: { expected: t.indexes.length, found: 0 },
        missingColumns: t.columns.map((c) => c.column),
        missingIndexes: t.indexes.map((i) => i.columns.join("+")),
      };
    }
    const byName = new Map(got.columns.map((c) => [c.name.toLowerCase(), c]));
    const missingColumns = [];
    const typeErrors = [];
    let found = 0;
    for (const c of t.columns) {
      const g = byName.get(c.column.toLowerCase());
      if (!g) {
        missingColumns.push(c.column);
        continue;
      }
      found += 1;
      // Sur PostgreSQL le contrôle porte AUSSI sur la taille : c'est la raison
      // d'être du choix de moteur.
      const why =
        DIALECT === "postgres"
          ? pgMismatch(c, g)
          : typeMatches(c.logical, g.type)
            ? null
            : `attendu ${c.logical}, obtenu ${g.type}`;
      if (why) typeErrors.push(`${c.column} : ${why}`);
    }
    const wrongType = typeErrors.length;
    const idxKeys = new Set(
      got.indexes.map((i) => i.columns.join("+").toLowerCase()),
    );
    const missingIndexes = t.indexes
      .filter((i) => !idxKeys.has(i.columns.join("+").toLowerCase()))
      .map((i) => i.columns.join("+"));
    return {
      table: t.table,
      present: true,
      columns: { expected: t.columns.length, found, wrongType },
      indexes: {
        expected: t.indexes.length,
        found: t.indexes.length - missingIndexes.length,
      },
      missingColumns,
      missingIndexes,
      typeErrors,
    };
  });
}

/** Rapport console + `report.json`. */
function report(ctx) {
  const {
    runDir,
    key,
    def,
    source,
    expected,
    rows,
    work,
    boot,
    dbPath,
    isolation,
  } = ctx;
  const tot = (pick) => rows.reduce((n, r) => n + pick(r), 0);
  const tablesFound = rows.filter((r) => r.present).length;
  const colsExpected = tot((r) => r.columns.expected);
  const colsFound = tot((r) => r.columns.found);
  const colsWrong = tot((r) => r.columns.wrongType);
  const idxExpected = tot((r) => r.indexes.expected);
  const idxFound = tot((r) => r.indexes.found);

  // Ce que la source contient et que la grammaire ne sait PAS dire — relevé au
  // moment de la lecture, indépendamment de ce que l'agent a réussi.
  const inexprimables = expected.flatMap((t) =>
    t.columns
      .filter((c) => c.note?.includes("INEXPRIMABLE") || c.logical === null)
      .map((c) => `${t.table}.${c.column} — ${c.note ?? c.sourceType}`),
  );
  const partages = expected.flatMap((t) =>
    t.columns
      .filter((c) => c.note?.includes("PARTAGÉE"))
      .map((c) => `${t.table}.${c.column} — ${c.note}`),
  );

  const bar = "─".repeat(76);
  console.log(`\n${bar}\nBANC DE SCHÉMA — ${key}\n${bar}`);
  console.log(`source : ${def.repo}/${def.file} (${def.license})`);
  console.log(
    `         empreinte ${source.sha}${source.drifted ? " ⚠️ DIFFÉRENTE de la figée" : " (conforme)"}`,
  );
  console.log(`stress : ${def.stresses}`);
  console.log(`agent  : ${AGENT} · modèle : ${MODEL}`);
  console.log(`moteur : ${DIALECT}`);
  console.log(`base   : ${dbPath ?? "AUCUNE — aucune table n'a été créée"}`);
  console.log(
    `décor  : ${
      LINKED
        ? "⚠️  --link — paquets SYMLINKÉS vers le checkout : l'agent voit les " +
          "sources du framework.\n         Mesure NON transposable à un installeur npm."
        : "paquets installés depuis les tarballs (dist seul), app hors du dépôt"
    }`,
  );
  if (isolation) {
    for (const f of isolation.facts) console.log(`         ${f}`);
  }
  console.log(
    `build  : ${boot.buildOk ? "✅" : "❌"}   boot console : ${boot.bootOk ? "✅" : "❌"}`,
  );

  console.log(`\n  RÉSULTAT`);
  console.log(`    tables   ${tablesFound}/${rows.length}`);
  console.log(
    `    colonnes ${colsFound}/${colsExpected}` +
      (colsWrong ? `   (dont ${colsWrong} de type inattendu)` : ""),
  );
  console.log(`    index    ${idxFound}/${idxExpected}`);

  console.log(`\n  CE QU'IL A FALLU FAIRE`);
  console.log(`    appels au générateur      : ${work.generated.length}`);
  console.log(
    `    éditions d'entité à la MAIN : ${work.edits.length}` +
      (work.edits.length ? "   ← ce que la grammaire n'a pas su porter" : ""),
  );
  // Zéro en décor fermé est le résultat ATTENDU : c'est la valeur du gate qu'on
  // relit. Non nul, il faut expliquer par où l'agent est sorti.
  console.log(
    `    accès hors de l'application : ${work.outside?.length ?? 0}` +
      (work.outside?.length ? "   ← savoir qu'un installeur npm n'a PAS" : ""),
  );
  for (const o of (work.outside ?? []).slice(0, 8)) {
    console.log(`      • ${o.tool} ${o.target.slice(0, 90)}`);
  }

  if (inexprimables.length) {
    console.log(`\n  INEXPRIMABLE PAR LA GRAMMAIRE (relevé à la source)`);
    for (const l of inexprimables) console.log(`    • ${l}`);
  }
  if (partages.length) {
    console.log(
      `\n  ÉNUMÉRATIONS PARTAGÉES (la grammaire ne connaît que l'inline)`,
    );
    for (const l of partages.slice(0, 12)) console.log(`    • ${l}`);
  }

  console.log(`\n  DÉTAIL PAR TABLE`);
  for (const r of rows) {
    const mark = !r.present ? "❌" : r.missingColumns.length ? "⚠️ " : "✅";
    console.log(
      `    ${mark} ${r.table.padEnd(18)} colonnes ${String(r.columns.found).padStart(2)}/${r.columns.expected}` +
        `  index ${String(r.indexes.found).padStart(2)}/${r.indexes.expected}`,
    );
    if (r.missingColumns.length) {
      console.log(
        `         colonnes absentes : ${r.missingColumns.join(", ")}`,
      );
    }
    if (r.missingIndexes.length) {
      console.log(
        `         index absents     : ${r.missingIndexes.join(" · ")}`,
      );
    }
    // Ce que SQLite n'aurait jamais montré : la taille, la précision, le type
    // exact. C'est pour ces lignes-là que le juge vit sur PostgreSQL.
    for (const e of r.typeErrors ?? []) {
      console.log(`         type              : ${e}`);
    }
  }

  writeFileSync(
    path.join(runDir, "report.json"),
    JSON.stringify(
      {
        schema: key,
        source: { ...def, sha256Read: source.sha, drifted: source.drifted },
        agent: AGENT,
        model: MODEL,
        // Sans lui, deux rapports de décors différents se lisent comme
        // comparables — ils ne le sont pas.
        decor: {
          mode: LINKED ? "link" : "installed",
          representative: !LINKED,
          isolation: isolation ?? null,
        },
        build: boot.buildOk,
        boot: boot.bootOk,
        database: dbPath,
        totals: {
          tables: { expected: rows.length, found: tablesFound },
          columns: {
            expected: colsExpected,
            found: colsFound,
            wrongType: colsWrong,
          },
          indexes: { expected: idxExpected, found: idxFound },
          generatorCalls: work.generated.length,
          handEdits: work.edits.length,
          outsideAccess: work.outside?.length ?? 0,
        },
        inexpressible: inexprimables,
        sharedEnums: partages,
        generatorCalls: work.generated,
        handEdits: work.edits,
        outsideAccess: work.outside ?? [],
        tables: rows,
      },
      null,
      2,
    ),
  );
  console.log(`\n  rapport : ${path.join(runDir, "report.json")}\n${bar}`);

  // Un banc qui ne peut pas échouer ne gate rien. Le seuil porte sur ce qui
  // mesure la GRAMMAIRE — les colonnes obtenues et les tables créées.
  return colsFound === colsExpected && tablesFound === rows.length;
}

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  const arg = (flag) => {
    const i = argv.indexOf(flag);
    return i === -1 ? null : argv[i + 1];
  };
  const key = arg("--schema") ?? "umami";
  const def = SCHEMAS[key];
  if (!def) {
    console.error(
      `schéma inconnu « ${key} » — disponibles : ${Object.keys(SCHEMAS).join(", ")}`,
    );
    process.exit(64);
  }
  if (!Object.hasOwn(DB_URL, DIALECT)) {
    console.error(
      `dialecte inconnu « ${DIALECT} » — disponibles : ${Object.keys(DB_URL).join(", ")}`,
    );
    process.exit(64);
  }

  const source = fetchSchema(key, def);
  const parsed =
    def.format === "prisma"
      ? readPrisma(source.content)
      : readKnex(source.content);
  const { tables: expected, missing } = subset(parsed, def);
  if (missing.length) {
    console.log(
      `\n⚠️  Tables du sous-ensemble figé INTROUVABLES en amont : ${missing.join(", ")}\n` +
        `   Le banc mesure ${expected.length} tables au lieu de ${def.tables.length}.\n`,
    );
  }
  const target = renderTarget(expected, def);

  /** Constat d'isolation du décor — `null` en `--analyze-only` (rien n'est monté). */
  let isolation = null;
  const analyzeOnly = arg("--analyze-only");
  const runDir =
    analyzeOnly ??
    path.join(
      RUN_ROOT,
      `${key}-${new Date().toISOString().replace(/[:.]/gu, "-").slice(0, 19)}`,
    );
  const app = path.join(runDir, "app");

  if (argv.includes("--dump-only")) {
    mkdirSync(runDir, { recursive: true });
    const out = path.join(runDir, "schema-cible.md");
    writeFileSync(out, target);
    const cols = expected.reduce((n, t) => n + t.columns.length, 0);
    const idx = expected.reduce((n, t) => n + t.indexes.length, 0);
    console.log(
      `\n${expected.length} tables · ${cols} colonnes · ${idx} index\n` +
        `schéma cible : ${out}\n`,
    );
    return;
  }

  if (!analyzeOnly) {
    // La base de développement est PARTAGÉE : sans ce nettoyage, les tables
    // laissées par le run précédent compteraient comme des réussites de
    // celui-ci — le juge lirait un état, pas un résultat.
    if (DIALECT === "postgres") {
      const dropped = await dropExpected(DB_URL.postgres, expected);
      if (dropped)
        console.log(`• ${dropped} table(s) du run précédent retirée(s)`);
    }
    setup(runDir, target);

    // Le décor se CONSTATE avant de servir. Un banc qui annonce mesurer un
    // installeur npm et laisse traîner les sources du framework rend un verdict
    // sur autre chose que ce qu'il prétend.
    isolation = assertIsolated(app);
    console.log(`\n• isolation du décor`);
    for (const f of isolation.facts) console.log(`  ${f}`);
    if (!isolation.ok && !LINKED) {
      console.error(
        `\n🛑 décor NON isolé — le banc mesurerait un agent mieux servi que\n` +
          `   l'utilisateur réel. Arrêt avant l'agent (aucun jeton dépensé).\n` +
          `   Décor : ${app}`,
      );
      process.exit(3);
    }

    if (argv.includes("--setup-only")) {
      console.log(`\n• décor prêt : ${app}\n  cible : ${app}/schema-cible.md`);
      return;
    }
    await runAgent(app, runDir);
  }

  const transcriptPath = path.join(runDir, "transcript.jsonl");
  const work = countWork(
    existsSync(transcriptPath) ? readFileSync(transcriptPath, "utf8") : "",
    app,
  );
  const boot = analyzeOnly
    ? { buildOk: true, bootOk: true }
    : bootApp(app, runDir);

  const dbPath = DIALECT === "sqlite" ? findDatabase(app) : DB_URL[DIALECT];
  const actual =
    DIALECT === "postgres"
      ? await readPostgres(DB_URL.postgres)
      : dbPath
        ? readSqlite(dbPath)
        : new Map();
  const rows = compare(expected, actual);
  const ok = report({
    runDir,
    key,
    def,
    source,
    expected,
    rows,
    work,
    boot,
    dbPath,
    isolation,
  });
  process.exit(ok ? 0 : 1);
}

// Ce fichier est AUSSI importé par son auto-contrôle (`bench-schema.selftest.mjs`),
// qui a besoin des lecteurs sans dérouler le banc. Ne s'exécute donc que lancé
// directement.
if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  await main();
}
