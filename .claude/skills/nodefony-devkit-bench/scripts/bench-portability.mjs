#!/usr/bin/env node
/**
 * Banc de PORTABILITÉ — une application NÉE en SQLite tient-elle sur les
 * autres moteurs, dans le MÊME décor, en ne faisant que les gestes documentés ?
 *
 * La promesse est écrite dans le gabarit et dans la doc de `@nodefony/drizzle`
 * (§ « Changer de base ») : changer `NF_DATABASE_URL`, repartir d'une migration
 * initiale du nouveau dialecte, et rien d'autre. Le banc de vérité ne la
 * prouve pas : `verify-generated --database postgres` crée l'application
 * DIRECTEMENT sur PostgreSQL. Ici, c'est la même application qui change de base,
 * dans l'ordre où un projet le vit :
 *
 *   sqlite (naissance) → postgres → mysql 8.4 → mariadb 11.4 → retour sqlite
 *
 * À chaque moteur, le banc joue le geste de l'utilisateur et en juge l'issue :
 *
 *  1. la base pointée sans son pilote — le produit doit NOMMER le geste ;
 *  2. le pilote installé, `orm:generate` écrit la migration initiale du
 *     dialecte, `orm:migrate` l'applique, `orm:migrate:status` la dit alignée ;
 *  3. le serveur de DÉVELOPPEMENT écrit et relit sur la base de développement ;
 *  4. la suite e2e GÉNÉRÉE passe sur ce moteur (base e2e dédiée) ;
 *  5. la SONDE du banc — mêmes requêtes, mêmes valeurs, aux bords de chaque
 *     type — rend un instantané IDENTIQUE à celui de SQLite.
 *
 * Puis deux preuves qui ne tiennent qu'à plusieurs moteurs : le retour sur
 * SQLite retrouve ses données, et deux champs ajoutés après coup (par
 * `create entity`, champs rappelés) migrent sur chaque moteur visité — la
 * ligne écrite avant la migration les porte à leur défaut, la suite générée
 * régénérée passe.
 *
 * Le banc s'éprouve en remettant une entité NATIVE (`--dialect sqlite`) : le
 * démarrage sur un autre moteur doit tomber en la nommant.
 *
 * ## Le juge ne lit pas Drizzle
 *
 * La sonde ne parle qu'HTTP, au contrat de ressource du dépôt : aucun type ni
 * import d'ORM. Sinon elle prouverait l'adaptateur, pas la portabilité.
 *
 * ## Décor
 *
 * Application ISOLÉE (tarballs, hors dépôt — `lib/isolation.mjs`), ports
 * dédiés, et des bases DÉDIÉES recréées vides à chaque run sur chaque serveur
 * (`nf_portability`, `nf_portability_e2e`) : la base `nodefony` du compose est
 * partagée par d'autres suites, et un décor sale fabrique un faux verdict.
 * Créer une base est un privilège d'administration : le banc se connecte en
 * administrateur (`--admin-<moteur>`), et donne à l'application un compte
 * applicatif qui n'a de droits que sur ses deux bases.
 *
 * Usage :
 *   node bench-portability.mjs                       # les trois moteurs serveur
 *   node bench-portability.mjs --database postgres   # un seul (répétable)
 *   node bench-portability.mjs --keep                # garder le décor
 *   node bench-portability.mjs --reuse               # repartir du décor gardé
 *   node bench-portability.mjs --admin-mysql mysql://root:pw@127.0.0.1:3307/
 *
 * Sorties : 0 portable · 1 un moteur diverge ou un geste échoue · 64 usage.
 */
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { garderDrapeaux } from "./lib/argv.mjs";
import { decorRoot } from "./lib/decor-root.mjs";
import { envDecor } from "./lib/env-decor.mjs";
import { needsShell } from "./lib/exec-portable.mjs";
import { extraitEchec } from "./lib/extrait-echec.mjs";
import {
  assertIsolated,
  installFromTarballs,
  packTarballs,
} from "./lib/isolation.mjs";

/** Racine du dépôt, trouvée en REMONTANT — un skill se déplace, un `..` compté se périme. */
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

const ICI = path.dirname(fileURLToPath(import.meta.url));
const REPO = findRepoRoot(ICI);
const BIN = path.join(REPO, "src/nodefony/bin/nodefony");

/**
 * Les moteurs SERVEUR, dans l'ordre où le banc les visite.
 *
 * MySQL et MariaDB partagent le dialecte `mysql` — donc le pilote ET le
 * dossier de migrations. C'est voulu, et c'est une preuve de plus : MariaDB
 * doit appliquer la migration écrite pendant la passe MySQL sans en
 * réclamer une autre (`orm:generate` n'y trouve rien à écrire).
 *
 * Les administrateurs par défaut sont ceux du compose du dépôt
 * (`docker/docker-compose.yml`) ; la forge passe les siens.
 */
const ENGINES = [
  {
    key: "postgres",
    dialect: "postgres",
    driver: "pg",
    admin: "postgres://nodefony:nodefony-dev@127.0.0.1:5432/postgres",
  },
  {
    key: "mysql",
    dialect: "mysql",
    driver: "mysql2",
    admin: "mysql://root:nodefony-dev@127.0.0.1:3307/",
  },
  {
    key: "mariadb",
    dialect: "mysql",
    driver: "mysql2",
    admin: "mysql://root:nodefony-dev@127.0.0.1:3306/",
  },
];

const USAGE = [
  "Banc de portabilité — une app née en SQLite change-t-elle de base sans problème ?",
  "",
  "  node bench-portability.mjs                      les trois moteurs serveur",
  "  node bench-portability.mjs --database <m>       un seul (postgres|mysql|mariadb), répétable",
  "  node bench-portability.mjs --keep               garder le décor",
  "  node bench-portability.mjs --reuse              repartir du décor gardé (boucle courte)",
  "  node bench-portability.mjs --repack             re-packer les tarballs",
  "  node bench-portability.mjs --admin-<m> <url>    administrateur du serveur <m>",
  "",
  "Sorties : 0 portable · 1 un moteur diverge ou un geste échoue · 64 usage",
].join("\n");

const ARGS = process.argv.slice(2);
garderDrapeaux({
  args: ARGS,
  connus: [
    "--database",
    "--keep",
    "--reuse",
    "--repack",
    ...ENGINES.map((e) => `--admin-${e.key}`),
  ],
  aValeur: ["--database", ...ENGINES.map((e) => `--admin-${e.key}`)],
  usage: USAGE,
  avertissement:
    "Rien n'a été lancé — ce banc monte une application et vide des bases.",
});

/** Toutes les valeurs d'une option répétable. */
function values(flag) {
  const out = [];
  ARGS.forEach((a, i) => {
    if (a === flag && ARGS[i + 1] !== undefined) out.push(ARGS[i + 1]);
  });
  return out;
}

const WANTED = values("--database");
for (const w of WANTED) {
  if (!ENGINES.some((e) => e.key === w)) {
    process.stderr.write(
      `--database ${w} inconnu — attendus : ${ENGINES.map((e) => e.key).join(", ")}\n`,
    );
    process.exit(64);
  }
}
for (const e of ENGINES) {
  const [admin] = values(`--admin-${e.key}`);
  if (admin) e.admin = admin;
}
const SELECTED =
  WANTED.length === 0 ? ENGINES : ENGINES.filter((e) => WANTED.includes(e.key));
const KEEP = ARGS.includes("--keep");
const REUSE = ARGS.includes("--reuse");

const ROOT = decorRoot({ linked: false, database: "portability" });
const APP_NAME = "portab";
const APP = path.join(ROOT, APP_NAME);

/**
 * Ports DÉDIÉS — ni ceux du poste (5151), ni ceux des autres bancs (5361,
 * 5381) : un autre serveur qui répond fait déclarer la readiness et juger une
 * application qui n'est pas la nôtre (404 partout).
 */
const PORTS = { NF_PORT: "5391", NF_PORT_HTTPS: "5392" };

/** Les bases du banc sur chaque serveur — recréées vides à chaque run. */
const DB_DEV = "nf_portability";
/**
 * Les bases de test, nommées par la règle que le décor e2e de l'application
 * DÉRIVE de sa base configurée (`<base>_e2e`, `<base>_e2e_scratch`) : le banc
 * ne passe ni `NF_E2E_DATABASE_URL` ni `NF_E2E_SCRATCH_DATABASE_URL`, il
 * éprouve la dérivation telle que l'utilisateur la vit.
 */
const DB_E2E = `${DB_DEV}_e2e`;
const DB_SCRATCH = `${DB_DEV}_e2e_scratch`;

/** Le compte APPLICATIF des serveurs MySQL/MariaDB — droits sur ses deux bases seulement. */
const APP_USER = { name: "nf_portability", password: "nf-portability-dev" };

/** Mot de passe du compte `admin` que le démarrage pose — partagé avec la sonde. */
const ADMIN_PASSWORD = "banc-portabilite-42";

// ─── journal des étapes ─────────────────────────────────────────────────────

const steps = [];
let failed = false;
let seq = 0;

/** Exécute une étape nommée ; un échec est consigné, et arrête le moteur courant. */
async function step(title, fn) {
  process.stdout.write(`\n━━ ${title}\n`);
  const t0 = Date.now();
  try {
    const detail = await fn();
    steps.push({
      title,
      ok: true,
      ms: Date.now() - t0,
      detail: detail ?? null,
    });
    process.stdout.write(
      `   ✅ ${title} (${Math.round((Date.now() - t0) / 1000)} s)\n`,
    );
    return true;
  } catch (error) {
    failed = true;
    const message = error instanceof Error ? error.message : String(error);
    steps.push({ title, ok: false, ms: Date.now() - t0, error: message });
    process.stdout.write(
      `   ❌ ${title}\n${message.replace(/^/gmu, "      ")}\n`,
    );
    return false;
  }
}

/** L'environnement de tout ce qui tourne DANS l'application. */
function appEnv(extra = {}) {
  return envDecor(PORTS, { NF_ADMIN_PASSWORD: ADMIN_PASSWORD, ...extra });
}

/** Le CLI de l'APPLICATION — jamais celui du dépôt, que le décor vient de couper. */
function appBin() {
  return path.join(APP, "node_modules", "nodefony", "bin", "nodefony");
}

/**
 * Lance une commande, capture sa sortie ENTIÈRE sur disque, et lève si le code
 * de retour n'est pas celui attendu (`null` = n'importe lequel).
 *
 * @returns {{ status: number|null, out: string }}
 */
function run(cmd, args, { cwd = APP, env = {}, expected = 0 } = {}) {
  const res = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    timeout: 900_000,
    env: appEnv(env),
    shell: needsShell(cmd),
  });
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  const shown = [cmd === process.execPath ? "node" : cmd, ...args]
    .map((a) => (a === BIN || a === appBin() ? "nodefony" : a))
    .join(" ");
  seq += 1;
  const log = path.join(
    ROOT,
    "journaux",
    `${String(seq).padStart(3, "0")}-${shown.replace(/[^\w.-]+/gu, "_").slice(0, 70)}.log`,
  );
  mkdirSync(path.dirname(log), { recursive: true });
  writeFileSync(log, `$ ${shown}\n(cwd ${cwd})\n\n${out}\n`);
  process.stdout.write(
    `   · $ ${shown.length > 100 ? `${shown.slice(0, 97)}…` : shown} → ${res.status}\n`,
  );
  if (expected !== null && res.status !== expected) {
    throw new Error(
      `${shown} → code ${res.status} (attendu ${expected}) — sortie entière : ${log}\n${extraitEchec(out)}`,
    );
  }
  return { status: res.status, out, log };
}

/** Une commande du CLI de l'application. */
function nodefony(args, options) {
  return run(process.execPath, [appBin(), ...args], options);
}

/** Retire les séquences ANSI — une sortie se juge sur son texte. */
function plain(text) {
  // biome-ignore lint: séquence d'échappement voulue
  return text.replace(/\u001b\[[0-9;]*m/gu, "");
}

// ─── les entités ────────────────────────────────────────────────────────────

/**
 * Trois entités qui couvrent TOUTE la grammaire de `create entity`, et ses
 * options qui changent le DDL — chaque ligne vise un écart connu entre moteurs.
 *
 *  - `Author` : clé uuid7 (texte en SQLite, `uuid` en PostgreSQL, `varchar(36)`
 *    en MySQL), un champ de chaque type, des défauts, des facultatifs, un
 *    unique et un index simple ;
 *  - `Book` : clé `serial` (auto-incrément sur trois grammaires), casse
 *    `snake` des colonnes, table renommée, suppression douce, référence vers
 *    une clé uuid, référence vers SOI facultative, index et unique composites ;
 *  - `Review` : référence vers `User` — l'entité du FRAMEWORK, la frontière la
 *    plus franchie — et vers une clé `serial`, sans horodatage.
 */
const ENTITIES = [
  [
    "Author",
    "email:string(120):unique",
    "name:string(80):index",
    "bio:text?",
    "active:bool=true",
    "rating:float?",
    "born:date?",
    "badge:uuid?",
    "profile:json?",
    "level:enum(junior,senior)=junior",
    "country:char(2)",
    "balance:decimal(12,2)",
    "credits:int=0",
  ],
  [
    "Book",
    "title:string:unique",
    "isbn:char(13)",
    "pages:int=0",
    "price:decimal(8,2)?",
    "author:ref:Author",
    "sequel:ref:Book?",
    "--id",
    "serial",
    "--column-case",
    "snake",
    "--table",
    "library_books",
    "--soft-delete",
    "--index",
    "author,createdAt",
    "--unique",
    "isbn,author",
  ],
  [
    "Review",
    "owner:ref:User",
    "book:ref:Book",
    "stars:int",
    "comment:text?",
    "--no-timestamps",
  ],
];

// ─── décor ──────────────────────────────────────────────────────────────────

async function mountDecor() {
  return step("décor : application NÉE en SQLite, isolée (tarballs)", () => {
    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(ROOT, { recursive: true });
    run(
      process.execPath,
      [
        BIN,
        "create",
        "app",
        APP_NAME,
        "--preset",
        "complete",
        "--frontend",
        "none",
        "--database",
        "sqlite",
        "--no-install",
        "--yes",
      ],
      { cwd: ROOT },
    );
    installFromTarballs(APP, packTarballs(REPO, ARGS.includes("--repack")));
    appendFileSync(path.join(APP, ".gitignore"), "\ntarballs/\n");
    nodefony(["scaffold:sync"]);
    nodefony(["ai:sync"]);
    const iso = assertIsolated(REPO, APP);
    for (const f of iso.facts) process.stdout.write(`   ${f}\n`);
    if (!iso.ok)
      throw new Error("décor NON isolé — le verdict ne vaudrait rien");
    // Le geste que `create app --no-install` NOMME après l'installation :
    // `create app` installé l'enchaîne lui-même. Sans lui l'application ne
    // versionne aucune migration, et `create entity` n'écrit pas la sienne.
    // `orm:*` boote l'application, qui doit donc être bâtie d'abord.
    run("npm", ["run", "build"]);
    nodefony(["orm:generate", "--name", "init"]);
    for (const [name, ...fields] of ENTITIES) {
      nodefony(["create", "entity", name, ...fields, "--yes"]);
    }
    run("npm", ["run", "build"]);
    nodefony(["orm:migrate"]);
  });
}

// ─── les bases des serveurs ─────────────────────────────────────────────────

/**
 * Recrée VIDES les deux bases du banc sur le serveur d'un moteur, et rend les
 * URL que l'application recevra.
 *
 * Les bases naissent avec les réglages PAR DÉFAUT du serveur — jeu de
 * caractères, collation —, jamais ceux qu'on aurait choisis pour le banc :
 * c'est ce qu'un utilisateur obtient, donc ce qu'il faut éprouver.
 *
 * @returns {Promise<{ dev: string, e2e: string, scratch: string }>}
 */
async function recreateDatabases(engine) {
  const admin = new URL(engine.admin);
  if (engine.dialect === "postgres") {
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: admin.toString() });
    await client.connect();
    try {
      for (const db of [DB_DEV, DB_E2E, DB_SCRATCH]) {
        await client.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
        await client.query(`CREATE DATABASE "${db}"`);
      }
    } finally {
      await client.end();
    }
    const url = (db) => {
      const u = new URL(admin);
      u.pathname = `/${db}`;
      return u.toString();
    };
    return { dev: url(DB_DEV), e2e: url(DB_E2E), scratch: url(DB_SCRATCH) };
  }
  const mysql = await import("mysql2/promise");
  const conn = await mysql.createConnection({
    host: admin.hostname,
    port: Number(admin.port || 3306),
    user: decodeURIComponent(admin.username),
    password: decodeURIComponent(admin.password),
  });
  try {
    await conn.query(
      `CREATE USER IF NOT EXISTS '${APP_USER.name}'@'%' IDENTIFIED BY '${APP_USER.password}'`,
    );
    for (const db of [DB_DEV, DB_E2E, DB_SCRATCH]) {
      await conn.query(`DROP DATABASE IF EXISTS \`${db}\``);
      await conn.query(`CREATE DATABASE \`${db}\``);
      await conn.query(
        `GRANT ALL PRIVILEGES ON \`${db}\`.* TO '${APP_USER.name}'@'%'`,
      );
    }
    await conn.query("FLUSH PRIVILEGES");
  } finally {
    await conn.end();
  }
  const url = (db) =>
    `mysql://${APP_USER.name}:${APP_USER.password}@${admin.hostname}:${admin.port || 3306}/${db}`;
  return { dev: url(DB_DEV), e2e: url(DB_E2E), scratch: url(DB_SCRATCH) };
}

/** Masque le mot de passe d'une URL — un journal se partage. */
function redact(url) {
  const u = new URL(url);
  if (u.password) u.password = "***";
  return u.toString();
}

// ─── le geste de l'utilisateur : `.env` ─────────────────────────────────────

const ENV_FILE = () => path.join(APP, ".env");

/**
 * Pose (ou retire) `NF_DATABASE_URL` dans le `.env` de l'application — le
 * geste que la doc demande, et le seul. Les lignes COMMENTÉES restent : ce
 * sont celles du gabarit.
 */
function setDatabaseUrl(url) {
  const lines = readFileSync(ENV_FILE(), "utf8")
    .split("\n")
    .filter((l) => !/^\s*NF_DATABASE_URL\s*=/u.test(l));
  if (url !== null) lines.push(`NF_DATABASE_URL=${url}`);
  writeFileSync(ENV_FILE(), `${lines.join("\n").replace(/\n+$/u, "")}\n`);
}

// ─── les sondes ─────────────────────────────────────────────────────────────

const SUITES = path.join(ICI, "..", "suites");
const PROBE_DIR = () => path.join(APP, "tests-portabilite");
const SNAPSHOTS = () => path.join(ROOT, "instantanes");

/**
 * Injecte les deux sondes et leurs configs vitest dans l'application. Recopiées
 * à chaque run : une sonde d'hier restée dans le décor jugerait le produit
 * d'aujourd'hui par les règles d'hier.
 */
function injectProbes() {
  rmSync(PROBE_DIR(), { recursive: true, force: true });
  mkdirSync(PROBE_DIR(), { recursive: true });
  for (const f of ["portability.e2e.test.ts", "portability-dev.e2e.test.ts"]) {
    writeFileSync(
      path.join(PROBE_DIR(), f),
      readFileSync(path.join(SUITES, f)),
    );
  }
  const config = (
    include,
    setup,
  ) => `import { defineConfig } from "vitest/config";

// Config ÉCRITE par le banc de portabilité — jetée avec le décor.
export default defineConfig({
  test: {
    include: ["tests-portabilite/${include}"],${setup ? `\n    globalSetup: ["tests/e2e.setup.ts"],` : ""}
    fileParallelism: false,
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
  oxc: {
    decorator: { legacy: true, emitDecoratorMetadata: false },
  },
});
`;
  writeFileSync(
    path.join(APP, "vitest.portabilite.config.ts"),
    config("portability.e2e.test.ts", true),
  );
  writeFileSync(
    path.join(APP, "vitest.portabilite-dev.config.ts"),
    config("portability-dev.e2e.test.ts", false),
  );
  mkdirSync(SNAPSHOTS(), { recursive: true });
}

/** Lance la sonde e2e — sur la base que le décor dérive du `.env` — et rend l'instantané. */
function probeSnapshot(label) {
  const file = path.join(SNAPSHOTS(), `${label}.json`);
  rmSync(file, { force: true });
  run("npx", ["vitest", "run", "--config", "vitest.portabilite.config.ts"], {
    env: { NF_PORTABILITY_SNAPSHOT: file },
  });
  return JSON.parse(readFileSync(file, "utf8"));
}

/** La suite e2e GÉNÉRÉE, telle que l'utilisateur la lance (`npm run test:e2e`, build compris). */
function generatedE2e() {
  run("npx", ["vitest", "run", "--config", "vitest.e2e.config.ts"]);
}

/** Démarre le serveur de développement, joue `fn`, l'arrête quoi qu'il arrive. */
function withDevServer(fn) {
  nodefony(["stop"], { expected: null });
  try {
    nodefony(["development", "--detach", "--wait"]);
    return fn();
  } finally {
    nodefony(["stop"], { expected: null });
  }
}

/** La sonde de la base de développement, serveur démarré. */
function devProbe(mode, engineKey, file, extra = {}) {
  run(
    "npx",
    ["vitest", "run", "--config", "vitest.portabilite-dev.config.ts"],
    {
      env: {
        NF_PORTABILITY_DEV_MODE: mode,
        NF_PORTABILITY_DEV_FILE: file,
        NF_PORTABILITY_DEV_ENGINE: engineKey,
        ...extra,
      },
    },
  );
}

// ─── comparaison des instantanés ────────────────────────────────────────────

/**
 * Forme canonique d'une valeur : clés d'objet TRIÉES. PostgreSQL (`jsonb`) et
 * MySQL réordonnent les clés d'un document JSON à l'écriture ; c'est le même
 * document, et l'ordre des clés n'a aucun sens en JSON (RFC 8259 § 4). Tout
 * le reste — types, valeurs, ordre des tableaux — reste comparé à l'octet.
 */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  }
  return value;
}

/**
 * Écarts de SÉMANTIQUE entre moteurs — liste FERMÉE, chacun avec sa raison.
 *
 * Ce ne sont pas des défauts du framework : c'est la base qui compare et
 * ordonne ainsi, et les gommer coûterait l'usage des index (un `col IS NULL`
 * ajouté au tri, une collation forcée sur chaque comparaison). Ils se
 * DÉCLARENT ici et dans la documentation (« Ce qui diverge d'une base à
 * l'autre »), et nulle part ailleurs ne se tolèrent.
 *
 * Fermée dans les deux sens : un écart hors liste fait échouer le moteur, et
 * une entrée qui ne se produit plus aussi — sinon la liste finirait par
 * couvrir un défaut qui n'a plus rien à voir avec sa raison.
 */
const DECLARED_DIVERGENCES = [
  {
    label: "liste.tri-born-asc",
    engines: ["postgres"],
    why: "PostgreSQL range les NULL APRÈS les valeurs en ordre croissant ; SQLite, MySQL et MariaDB AVANT",
  },
  {
    label: "chaine.tri-name-asc",
    engines: ["mysql", "mariadb"],
    why: "collation par défaut insensible à la casse et aux accents : « alice » précède « Bob » au lieu de le suivre",
  },
  {
    label: "chaine.email-doublon-casse",
    engines: ["mysql", "mariadb"],
    why: "unicité insensible à la casse : ALICE@ heurte alice@ (409)",
  },
  {
    label: "chaine.email-doublon-sans-accent",
    engines: ["mysql", "mariadb"],
    why: "unicité insensible aux accents : zoe@ heurte zoé@ (409)",
  },
  {
    label: "chaine.email-doublon-espace-final",
    engines: ["mariadb"],
    why: "collation PAD SPACE : l'espace final est ignoré à la comparaison (409) — MySQL 8.4 est NO PAD",
  },
];

/**
 * Sépare les écarts d'un moteur en DÉCLARÉS et INATTENDUS, et rend les
 * déclarations qui ne se sont pas produites.
 */
function classifyDiffs(engineKey, diffs) {
  const mine = DECLARED_DIVERGENCES.filter((d) =>
    d.engines.includes(engineKey),
  );
  const declared = [];
  const unexpected = [];
  for (const diff of diffs) {
    const decl = mine.find((d) => d.label === diff.label);
    if (decl) declared.push({ ...diff, why: decl.why });
    else unexpected.push(diff);
  }
  const stale = mine.filter((d) => !diffs.some((x) => x.label === d.label));
  return { declared, unexpected, stale };
}

/** Les cas qui diffèrent entre la référence et un moteur. */
function diffSnapshots(reference, other) {
  const byLabel = new Map(other.map((c) => [c.label, c]));
  const diffs = [];
  for (const ref of reference) {
    const got = byLabel.get(ref.label);
    if (got === undefined) {
      diffs.push({ label: ref.label, reference: ref, got: "(cas absent)" });
      continue;
    }
    if (JSON.stringify(canonical(ref)) !== JSON.stringify(canonical(got))) {
      diffs.push({ label: ref.label, reference: ref, got });
    }
  }
  for (const c of other) {
    if (!reference.some((r) => r.label === c.label)) {
      diffs.push({ label: c.label, reference: "(cas absent)", got: c });
    }
  }
  return diffs;
}

/** Affiche une divergence de façon lisible : le statut d'abord, puis le corps. */
function showDiff(d) {
  const brief = (c) =>
    typeof c === "string"
      ? c
      : `${c.status}${c.body === undefined ? "" : ` ${JSON.stringify(canonical(c.body)).slice(0, 400)}`}`;
  return `• ${d.label}\n    sqlite : ${brief(d.reference)}\n    moteur : ${brief(d.got)}`;
}

// ─── les migrations ─────────────────────────────────────────────────────────

/** Les fichiers SQL versionnés d'un dialecte. */
function migrationFiles(dialect) {
  const dir = path.join(APP, "migrations", dialect);
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".sql"))
        .sort()
    : [];
}

/** `orm:migrate`, puis la preuve que plus rien n'est en attente NI ne diverge. */
function migrateAndAssertAligned() {
  const migrated = plain(nodefony(["orm:migrate"]).out);
  if (!/\bapp\s+\d+ appliquées?\s+·\s+0 en attente/u.test(migrated)) {
    throw new Error(
      `orm:migrate n'a pas mis l'application à jour :\n${migrated}`,
    );
  }
  const status = nodefony(["orm:migrate:status", "--json"], { expected: null });
  if (status.status !== 0) {
    throw new Error(
      `orm:migrate:status rend ${status.status} — base et code ne sont pas alignés :\n${extraitEchec(status.out)}`,
    );
  }
}

// ─── programme ──────────────────────────────────────────────────────────────

process.stdout.write(`${USAGE.split("\n")[0]}\n   décor : ${APP}\n`);

if (REUSE && existsSync(appBin())) {
  process.stdout.write("   --reuse : décor existant repris tel quel\n");
  setDatabaseUrl(null);
  // La base de développement SQLite garde les lignes du run précédent : la
  // sonde du serveur de développement, qui crée une ligne FIXE, y recevrait
  // 409. Remise à zéro par les commandes du produit, comme un utilisateur.
  const okReset = await step(
    "décor repris — base de développement SQLite remise à zéro",
    () => {
      nodefony(["orm:reset", "--yes"]);
      migrateAndAssertAligned();
    },
  );
  if (!okReset) process.exit(1);
} else if (!(await mountDecor())) {
  process.exit(1);
}
injectProbes();

const DURABLE_SQLITE = path.join(ROOT, "durable-sqlite.json");
let reference = null;

const sqliteOk = await step(
  "SQLITE (naissance) — suites générées, sonde, base de développement",
  () => {
    // Le code GÉNÉRÉ doit compiler : les suites passent par vitest, qui
    // n'éprouve aucun type — un service à clé serial qui ne compilait pas a
    // traversé tous les runs verts de ce banc.
    run("npm", ["run", "typecheck"]);
    run("npm", ["test"]);
    generatedE2e();
    reference = probeSnapshot("sqlite");
    withDevServer(() => devProbe("write", "sqlite", DURABLE_SQLITE));
    return { cas: reference.length };
  },
);
if (!sqliteOk || reference === null) {
  process.stdout.write(
    "\n❌ la naissance en SQLite échoue — aucun moteur ne peut être comparé\n",
  );
  process.exit(1);
}

const verdicts = [];
/** Les moteurs dont la base de développement porte une ligne durable — ceux que l'évolution rejoue. */
const migrated = [];
for (const engine of SELECTED) {
  const verdict = { engine: engine.key, ok: false, diffs: [] };
  verdicts.push(verdict);
  let urls = null;
  const okDb = await step(
    `${engine.key} — bases dédiées recréées VIDES`,
    async () => {
      urls = await recreateDatabases(engine);
      setDatabaseUrl(urls.dev);
      return {
        dev: redact(urls.dev),
        e2e: redact(urls.e2e),
        scratch: redact(urls.scratch),
      };
    },
  );
  if (!okDb) continue;

  const driverDir = path.join(APP, "node_modules", engine.driver);
  if (!existsSync(driverDir)) {
    const okNamed = await step(
      `${engine.key} — sans son pilote, le démarrage NOMME le geste (npm install ${engine.driver})`,
      () => {
        const r = nodefony(["orm:migrate:status"], { expected: null });
        if (r.status === 0) {
          throw new Error(
            `orm:migrate:status rend 0 SANS le pilote « ${engine.driver} »`,
          );
        }
        if (!plain(r.out).includes(engine.driver)) {
          throw new Error(
            `le refus ne nomme pas le pilote « ${engine.driver} » à installer :\n${extraitEchec(r.out)}`,
          );
        }
        return { code: r.status };
      },
    );
    if (!okNamed) continue;
    const version = JSON.parse(
      readFileSync(
        path.join(REPO, "node_modules", engine.driver, "package.json"),
        "utf8",
      ),
    ).version;
    const okInstall = await step(
      `${engine.key} — npm install ${engine.driver}@${version}`,
      () => {
        run("npm", [
          "install",
          `${engine.driver}@${version}`,
          "--no-audit",
          "--no-fund",
        ]);
      },
    );
    if (!okInstall) continue;
  }

  const okMigrate = await step(
    `${engine.key} — migration initiale du dialecte ${engine.dialect}, appliquée, alignée`,
    () => {
      const before = migrationFiles(engine.dialect);
      nodefony(["orm:generate", "--name", "init"], { expected: null });
      const after = migrationFiles(engine.dialect);
      if (before.length === 0 && after.length === 0) {
        throw new Error(
          `orm:generate n'a écrit aucune migration sous migrations/${engine.dialect}/`,
        );
      }
      if (before.length > 0 && after.length !== before.length) {
        // MariaDB après MySQL : même dialecte, la migration existe déjà — en
        // réclamer une autre voudrait dire que les deux serveurs ne lisent
        // pas le même schéma.
        throw new Error(
          `orm:generate a écrit une migration de plus (${after.filter((f) => !before.includes(f)).join(", ")}) ` +
            `sur un dialecte déjà migré — le schéma diverge entre deux serveurs du même dialecte`,
        );
      }
      migrateAndAssertAligned();
      return { migrations: after };
    },
  );
  if (!okMigrate) continue;

  const durable = path.join(ROOT, `durable-${engine.key}.json`);
  const okDev = await step(
    `${engine.key} — le serveur de DÉVELOPPEMENT écrit, redémarre, relit`,
    () => {
      withDevServer(() => devProbe("write", engine.key, durable));
      withDevServer(() => devProbe("read", engine.key, durable));
    },
  );

  const okE2e = await step(`${engine.key} — la suite e2e GÉNÉRÉE passe`, () => {
    generatedE2e();
  });

  let snapshot = null;
  const okProbe = await step(
    `${engine.key} — la sonde rend le MÊME instantané que SQLite`,
    () => {
      snapshot = probeSnapshot(engine.key);
      const { declared, unexpected, stale } = classifyDiffs(
        engine.key,
        diffSnapshots(reference, snapshot),
      );
      verdict.diffs = unexpected;
      verdict.declared = declared.map((d) => ({ label: d.label, why: d.why }));
      const problems = [];
      if (unexpected.length > 0) {
        problems.push(
          `${unexpected.length} cas divergent(s) NON déclaré(s) sur ${reference.length} :\n${unexpected.map(showDiff).join("\n")}`,
        );
      }
      if (stale.length > 0) {
        problems.push(
          `${stale.length} écart(s) déclaré(s) qui n'ont PLUS lieu — retirer de DECLARED_DIVERGENCES : ${stale.map((d) => d.label).join(", ")}`,
        );
      }
      if (problems.length > 0) throw new Error(problems.join("\n"));
      return {
        cas: snapshot.length,
        "écarts déclarés": declared.map((d) => d.label).join(", ") || "aucun",
      };
    },
  );
  verdict.ok = okDev && okE2e && okProbe;
  if (okDev) migrated.push({ engine, urls, durable });
}

// ─── retour sur SQLite ──────────────────────────────────────────────────────

const okBack = await step(
  "retour sur SQLITE — la base d'origine, ses données intactes",
  () => {
    setDatabaseUrl(null);
    migrateAndAssertAligned();
    withDevServer(() => devProbe("read", "sqlite", DURABLE_SQLITE));
  },
);

// ─── évolution après bascule ────────────────────────────────────────────────

/**
 * Les champs AJOUTÉS à `Author` une fois l'application passée par tous les
 * moteurs — un facultatif, et un obligatoire à défaut. Le second est le cas qui
 * casse : une colonne NOT NULL posée sur une table qui a déjà des lignes.
 * `defaults` est ce que la ligne écrite avant la migration doit porter après,
 * `update` ce que la sonde écrit ensuite.
 */
const ADDED = {
  fields: ["nickname:string(40)?", "score:int=0"],
  probe: {
    defaults: { nickname: null, score: 0 },
    update: { nickname: "Évolué é 😀", score: 7 },
  },
};

// Le geste documenté : `create entity` ré-décrit l'entité EN ENTIER — on
// rappelle ses champs, plus les nouveaux (la commande refuse d'en perdre un).
// L'application est revenue sur SQLite : c'est là qu'on la fait évoluer.
const okEvolved =
  okBack &&
  (await step(
    `évolution — ${ADDED.fields.join(", ")} ajoutés à Author par le générateur`,
    () => {
      setDatabaseUrl(null);
      const [name, ...fields] = ENTITIES[0];
      nodefony(["create", "entity", name, ...fields, ...ADDED.fields, "--yes"]);
      run("npm", ["run", "build"]);
      run("npm", ["run", "typecheck"]);
    },
  ));

if (okEvolved) {
  // Un dialecte reçoit UNE migration de plus, une seule fois : MariaDB après
  // MySQL applique celle de la passe MySQL sans en réclamer une autre.
  const evolvedDialects = new Set();
  const targets = [
    {
      engine: { key: "sqlite", dialect: "sqlite" },
      urls: null,
      durable: DURABLE_SQLITE,
    },
    ...migrated,
  ];
  for (const { engine, urls, durable } of targets) {
    await step(
      `${engine.key} — le champ ajouté migre, la ligne d'avant le porte à son défaut`,
      () => {
        setDatabaseUrl(urls === null ? null : urls.dev);
        const before = migrationFiles(engine.dialect);
        nodefony(["orm:generate", "--name", "author_evolution"], {
          expected: null,
        });
        const written = migrationFiles(engine.dialect).filter(
          (f) => !before.includes(f),
        );
        const expected = evolvedDialects.has(engine.dialect) ? 0 : 1;
        if (written.length !== expected) {
          throw new Error(
            `orm:generate a écrit ${written.length} migration(s) sous migrations/${engine.dialect}/ ` +
              `(attendu ${expected})${written.length > 0 ? ` : ${written.join(", ")}` : ""}`,
          );
        }
        evolvedDialects.add(engine.dialect);
        migrateAndAssertAligned();
        withDevServer(() =>
          devProbe("evolved", engine.key, durable, {
            NF_PORTABILITY_DEV_ADDED: JSON.stringify(ADDED.probe),
          }),
        );
        generatedE2e();
        return {
          migration: written.join(", ") || "aucune (dialecte déjà migré)",
        };
      },
    );
  }
}

// ─── verdict ────────────────────────────────────────────────────────────────

writeFileSync(
  path.join(ROOT, "report.json"),
  `${JSON.stringify({ app: APP, steps, verdicts }, null, 2)}\n`,
);
process.stdout.write("\n━━ verdict\n");
for (const s of steps)
  process.stdout.write(`  ${s.ok ? "✅" : "❌"} ${s.title}\n`);
process.stdout.write(`\n  rapport : ${path.join(ROOT, "report.json")}\n`);
if (!failed && !KEEP) rmSync(ROOT, { recursive: true, force: true });
else process.stdout.write(`  décor conservé : ${APP}\n`);
process.exit(failed ? 1 : 0);
