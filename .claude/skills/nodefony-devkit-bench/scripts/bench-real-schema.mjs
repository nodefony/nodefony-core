#!/usr/bin/env node
/**
 * Banc de schéma RÉEL — le kit de colonnes tient-il un logiciel écrit par
 * d'autres, de bout en bout, sur chaque moteur ?
 *
 * Le corpus (`erp` : 421 tables nées sur MySQL, licence tierce, jamais
 * versionné) est récupéré par `corpus-fetch.mjs`, converti en descriptions
 * NEUTRES par `mysql-ddl-to-specs.mjs`, puis éprouvé en DEUX étages :
 *
 * 1. **Le contrat** (`@nodefony/drizzle`, `real-schema.e2e.test.ts`) — le même
 *    que celui du corpus synthétique de la CI (`schema-contract.ts`) : toutes
 *    les tables créées par le DDL dérivé PUIS par une migration `drizzle-kit`,
 *    une ligne témoin à chaque borne relue À L'IDENTIQUE, une ligne minimale
 *    qui reçoit ses défauts. Chaque table en écart est NOMMÉE.
 * 2. **L'application** — une application NÉE en SQLite, isolée (tarballs),
 *    qui déclare les 421 entités comme le ferait un utilisateur
 *    (`defineEntity` + `defineTable`), puis, par moteur : `orm:generate`,
 *    `orm:migrate`, `orm:migrate:status` aligné, un second `orm:generate` qui
 *    ne trouve RIEN à écrire, et les tables comptées dans la base elle-même.
 *
 * Le matérialiseur (description sérialisée → table du kit) n'existe qu'UNE
 * fois : `tests/integration/serialized-specs.ts` du paquet drizzle. L'étage 2
 * en recopie la source, ses imports relus vers `@nodefony/drizzle` — la
 * réécriture est CONSTATÉE, jamais supposée.
 *
 * Usage :
 *   node bench-real-schema.mjs                          # sqlite, postgres, mysql, mariadb
 *   node bench-real-schema.mjs --database postgres      # un moteur (répétable)
 *   node bench-real-schema.mjs --only contract|app      # un seul étage
 *   node bench-real-schema.mjs --keep                   # garde décor et bases
 *   node bench-real-schema.mjs --admin-postgres <url>   # administrateur d'un moteur
 *
 * Décor : `docker compose -f docker/docker-compose.yml --profile postgres
 * --profile mysql --profile mariadb up -d` (ports du compose du dépôt).
 *
 * Sorties : 0 tout vert · 1 au moins une étape rouge · 64 usage.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decorRoot } from "./lib/decor-root.mjs";
import {
  ENGINES,
  dropDatabases,
  recreateDatabases,
  setDatabaseUrl,
} from "./lib/engines-decor.mjs";
import { envDecor } from "./lib/env-decor.mjs";
import { needsShell } from "./lib/exec-portable.mjs";
import { extraitEchec } from "./lib/extrait-echec.mjs";
import {
  assertIsolated,
  installFromTarballs,
  packTarballs,
} from "./lib/isolation.mjs";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(ICI, "..", "..", "..", "..");
const BIN = path.join(REPO, "src/nodefony/bin/nodefony");
const DRIZZLE = path.join(REPO, "src/packages/@nodefony/drizzle");
const MATERIALIZER = path.join(
  DRIZZLE,
  "tests/integration/serialized-specs.ts",
);

/** Les moteurs du banc : SQLite (fichier), puis les serveurs du catalogue partagé. */
const SQLITE = { key: "sqlite", dialect: "sqlite", driver: null, admin: null };

const ARGS = process.argv.slice(2);
function values(flag) {
  const out = [];
  for (let i = 0; i < ARGS.length; i++) {
    if (ARGS[i] === flag && ARGS[i + 1]) out.push(ARGS[++i]);
  }
  return out;
}
const SERVERS = ENGINES.map(({ key, dialect, driver, admin }) => ({
  key,
  dialect,
  driver,
  admin: values(`--admin-${key}`)[0] ?? admin,
}));
const ALL = [SQLITE, ...SERVERS];
const WANTED = values("--database");
for (const w of WANTED) {
  if (!ALL.some((e) => e.key === w)) {
    process.stderr.write(
      `--database ${w} inconnu — attendus : ${ALL.map((e) => e.key).join(", ")}\n`,
    );
    process.exit(64);
  }
}
const SELECTED =
  WANTED.length === 0 ? ALL : ALL.filter((e) => WANTED.includes(e.key));
const [ONLY] = values("--only");
if (ONLY !== undefined && ONLY !== "contract" && ONLY !== "app") {
  process.stderr.write(`--only ${ONLY} inconnu — attendus : contract, app\n`);
  process.exit(64);
}
const KEEP = ARGS.includes("--keep");

const ROOT = decorRoot({ linked: false, database: "real-schema" });
const APP_NAME = "erpbench";
const APP = path.join(ROOT, APP_NAME);
const SPECS_FILE = path.join(REPO, "tmp/bench/corpus/erp/specs.json");
/** Ports dédiés : un autre serveur Nodefony ne doit pas répondre à sa place. */
const PORTS = { NF_PORT: "5395", NF_PORT_HTTPS: "5396" };
const DB_CONTRACT = "nf_real_schema_contract";
const DB_APP = "nf_real_schema_app";
const APP_USER = { name: "nf_real_schema", password: "nf-real-schema-dev" };

/** @type {{ title: string, ok: boolean, ms: number, error?: string }[]} */
const steps = [];
let seq = 0;

/** Exécute une étape nommée ; un échec est consigné et rendu `false`. */
async function step(title, fn) {
  process.stdout.write(`\n━━ ${title}\n`);
  const t0 = Date.now();
  try {
    await fn();
    steps.push({ title, ok: true, ms: Date.now() - t0 });
    process.stdout.write(
      `   ✅ ${title} (${Math.round((Date.now() - t0) / 1000)} s)\n`,
    );
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    steps.push({ title, ok: false, ms: Date.now() - t0, error: message });
    process.stdout.write(
      `   ❌ ${title}\n${message.replace(/^/gmu, "      ")}\n`,
    );
    return false;
  }
}

/**
 * Lance une commande, capture sa sortie ENTIÈRE sur disque, et lève si le code
 * de retour n'est pas celui attendu (`null` = n'importe lequel).
 */
function run(cmd, args, { cwd = APP, env, expected = 0 } = {}) {
  const res = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    timeout: 1_800_000,
    maxBuffer: 256 * 1024 * 1024,
    env: env ?? envDecor(PORTS),
    shell: needsShell(cmd),
  });
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  const shown = [cmd === process.execPath ? "node" : cmd, ...args]
    .map((a) => (a === BIN ? "nodefony" : a))
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

/** Le CLI de l'application témoin (celui de SES `node_modules`). */
function nodefony(args, options) {
  return run(
    process.execPath,
    [path.join(APP, "node_modules", "nodefony", "bin", "nodefony"), ...args],
    options,
  );
}

/** Les tables du corpus, lues dans le fichier converti. */
function corpusTables() {
  const { specs } = JSON.parse(readFileSync(SPECS_FILE, "utf8"));
  return specs.map((s) => s.name);
}

// ─── Étage 0 : le corpus ────────────────────────────────────────────────────

async function prepareCorpus() {
  return step("corpus : récupéré et converti en descriptions neutres", () => {
    run(process.execPath, [path.join(ICI, "corpus-fetch.mjs")], { cwd: REPO });
    run(process.execPath, [path.join(ICI, "mysql-ddl-to-specs.mjs")], {
      cwd: REPO,
    });
    const n = corpusTables().length;
    process.stdout.write(`   ${n} tables dans ${SPECS_FILE}\n`);
    if (n === 0) throw new Error("corpus converti VIDE");
  });
}

// ─── Étage 1 : le contrat du kit ─────────────────────────────────────────────

/** L'environnement d'une passe du contrat : SEULE l'adresse du moteur visé. */
function contractEnv(engine, url) {
  const env = { ...process.env };
  for (const k of ["NF_PG_URL", "NF_MYSQL_URL", "NF_DATABASE_URL"]) {
    delete env[k];
  }
  env.NF_REAL_SCHEMA_SPECS = SPECS_FILE;
  // Une passe FILTRÉE : ce qu'elle ne vise pas est ÉNONCÉ, pas oublié.
  env.NF_GATES_ALLOW = "NF_PG_URL,NF_MYSQL_URL";
  if (engine.dialect === "postgres") env.NF_PG_URL = url;
  if (engine.dialect === "mysql") env.NF_MYSQL_URL = url;
  return env;
}

async function runContract(engine) {
  return step(
    `${engine.key} — contrat du kit : tables créées (DDL dérivé + migration), témoins relus, défauts`,
    async () => {
      let url;
      if (engine.admin !== null) {
        url = (await recreateDatabases(engine, [DB_CONTRACT], APP_USER))[
          DB_CONTRACT
        ];
      }
      const label = engine.dialect;
      const res = run(
        "npx",
        [
          "vitest",
          "run",
          "tests/integration/real-schema.e2e.test.ts",
          "-t",
          `(${label})`,
        ],
        { cwd: DRIZZLE, env: contractEnv(engine, url) },
      );
      // Quatre cas par moteur (deux chemins × témoins + défauts) : un `-t`
      // qui ne mord sur rien rendrait 0 passé et un code 0.
      const passed = /Tests\s+(\d+) passed/u.exec(
        res.out.replace(/\x1b\[[\d;]*m/gu, ""),
      );
      if (!passed || Number(passed[1]) < 4) {
        throw new Error(
          `le contrat n'a pas exercé ses 4 cas sur ${engine.key} — ${res.log}`,
        );
      }
    },
  );
}

// ─── Étage 2 : l'application ────────────────────────────────────────────────

/**
 * Écrit les entités du corpus DANS l'application : le matérialiseur recopié
 * (imports relus vers `@nodefony/drizzle`), les descriptions en littéral (le
 * fichier est relu en CommonJS par `drizzle-kit` : ni `fs`, ni
 * `import.meta`), et un `defineEntity` par table — la forme que `create entity`
 * écrirait.
 */
function writeCorpusEntities(moduleName) {
  const source = readFileSync(MATERIALIZER, "utf8");
  const rewrites = [
    [`from "../../nodefony/entity/colKit";`, `from "@nodefony/drizzle";`],
    [`from "../../nodefony/entity/colKit.spec";`, `from "@nodefony/drizzle";`],
  ];
  let copied = source;
  for (const [from, to] of rewrites) {
    if (!copied.includes(from)) {
      throw new Error(
        `matérialiseur : import « ${from} » introuvable — ${MATERIALIZER} a changé, relire la réécriture`,
      );
    }
    copied = copied.split(from).join(to);
  }
  if (/from "\.\.?\//u.test(copied)) {
    throw new Error("matérialiseur : un import relatif reste après réécriture");
  }
  const dir = path.join(APP, "nodefony", "entity");
  writeFileSync(
    path.join(dir, "serializedSpecs.ts"),
    `// RECOPIÉ par bench-real-schema.mjs depuis ${path.relative(REPO, MATERIALIZER)} — ne pas éditer.\n${copied}`,
  );
  const { specs } = JSON.parse(readFileSync(SPECS_FILE, "utf8"));
  writeFileSync(
    path.join(dir, "corpus.ts"),
    [
      "// GÉNÉRÉ par bench-real-schema.mjs — corpus tiers, jamais versionné.",
      `import { defineEntity } from "@nodefony/orm-core";`,
      `import { materializeSpecs, type ISerializedSpec } from "./serializedSpecs";`,
      "",
      `const SPECS: readonly ISerializedSpec[] = ${JSON.stringify(specs)};`,
      "",
      "const TABLES = materializeSpecs(SPECS);",
      "",
      "function tableOf(name: string) {",
      "  const table = TABLES.get(name);",
      "  if (!table) throw new Error(`corpus : table ${name} absente`);",
      "  return table;",
      "}",
      "",
      // `orm:generate` examine les exports UN PAR UN (`appSchema.ts`) : une
      // table rangée dans un tableau lui est invisible. Une par ligne, comme
      // `create entity` l'écrit.
      ...specs.map(
        (s) => `export const ${s.name} = tableOf(${JSON.stringify(s.name)});`,
      ),
      "",
      "/** Les entités du corpus, déclarées comme `create entity` les écrirait. */",
      "export const CORPUS_ENTITIES = [...TABLES.keys()].map((name) =>",
      `  defineEntity({ name, module: ${JSON.stringify(moduleName)}, schema: tableOf(name) }),`,
      ");",
      "",
    ].join("\n"),
  );
}

/** Branche les entités du corpus au décorateur `@entities([...])` du module. */
function wireCorpusEntities() {
  const file = path.join(APP, "index.ts");
  let text = readFileSync(file, "utf8");
  const userImport = `import { UserEntity } from "./nodefony/entity/User";`;
  const decorator = "@entities([UserEntity])";
  if (!text.includes(userImport) || !text.includes(decorator)) {
    throw new Error(
      `index.ts de l'application : « ${decorator} » introuvable — le gabarit a changé`,
    );
  }
  text = text
    .replace(
      userImport,
      `${userImport}\nimport { CORPUS_ENTITIES } from "./nodefony/entity/corpus";`,
    )
    .replace(decorator, "@entities([UserEntity, ...CORPUS_ENTITIES])");
  writeFileSync(file, text);
}

async function mountApp() {
  return step(
    "application : NÉE en SQLite, isolée (tarballs), 421 entités déclarées",
    () => {
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
      const iso = assertIsolated(REPO, APP);
      for (const f of iso.facts) process.stdout.write(`   ${f}\n`);
      if (!iso.ok) {
        throw new Error("décor NON isolé — le verdict ne vaudrait rien");
      }
      const user = readFileSync(
        path.join(APP, "nodefony", "entity", "User.ts"),
        "utf8",
      );
      const moduleName = /module:\s*"([^"]+)"/u.exec(user)?.[1];
      if (!moduleName) throw new Error("module de l'entité User illisible");
      writeCorpusEntities(moduleName);
      wireCorpusEntities();
      run("npm", ["run", "build"]);
    },
  );
}

/** Fichiers de migration du dialecte, pour constater ce que `orm:generate` écrit. */
function migrationFiles(dialect) {
  const dir = path.join(APP, "migrations", dialect);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".sql"));
}

/** Compte les tables du corpus présentes dans la base de l'application. */
async function countCorpusTables(engine, url) {
  const wanted = new Set(corpusTables().map((n) => n.toLowerCase()));
  let names = [];
  if (engine.dialect === "sqlite") {
    const dir = path.join(APP, "var", "databases");
    const db = readdirSync(dir).find((f) => f.endsWith(".db"));
    if (!db) throw new Error(`aucune base SQLite sous ${dir}`);
    const { default: Database } = await import("better-sqlite3");
    const conn = new Database(path.join(dir, db), { readonly: true });
    try {
      names = conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((r) => r.name);
    } finally {
      conn.close();
    }
  } else if (engine.dialect === "postgres") {
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      const r = await client.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
      );
      names = r.rows.map((row) => row.table_name);
    } finally {
      await client.end();
    }
  } else {
    const mysql = await import("mysql2/promise");
    const conn = await mysql.createConnection(url);
    try {
      const [rows] = await conn.query(
        "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()",
      );
      names = rows.map((row) => row.name);
    } finally {
      await conn.end();
    }
  }
  return names.filter((n) => wanted.has(String(n).toLowerCase())).length;
}

async function runApp(engine) {
  const tables = corpusTables().length;
  return step(
    `${engine.key} — application : orm:generate, orm:migrate, statut aligné, ${tables} tables en base, second orm:generate vide`,
    async () => {
      let url = null;
      if (engine.admin !== null) {
        url = (await recreateDatabases(engine, [DB_APP], APP_USER))[DB_APP];
        const driverDir = path.join(APP, "node_modules", engine.driver);
        if (!existsSync(driverDir)) {
          const version = JSON.parse(
            readFileSync(
              path.join(REPO, "node_modules", engine.driver, "package.json"),
              "utf8",
            ),
          ).version;
          run("npm", [
            "install",
            `${engine.driver}@${version}`,
            "--no-audit",
            "--no-fund",
          ]);
        }
      }
      setDatabaseUrl(path.join(APP, ".env"), url);
      const before = migrationFiles(engine.dialect).length;
      nodefony(["orm:generate", "--name", "realschema"]);
      const written = migrationFiles(engine.dialect).length - before;
      // MariaDB suit MySQL : même dialecte, donc même migration, rien à écrire.
      process.stdout.write(`   ${written} migration(s) écrite(s)\n`);
      nodefony(["orm:migrate"]);
      nodefony(["orm:migrate:status", "--json"]);
      const present = await countCorpusTables(engine, url);
      if (present !== tables) {
        throw new Error(
          `${present} table(s) du corpus en base, ${tables} attendues`,
        );
      }
      const again = migrationFiles(engine.dialect).length;
      nodefony(["orm:generate", "--name", "drift"]);
      if (migrationFiles(engine.dialect).length !== again) {
        throw new Error(
          "un second orm:generate a écrit une migration : le schéma généré ne se relit pas à l'identique",
        );
      }
    },
  );
}

// ─── Déroulé ────────────────────────────────────────────────────────────────

if (!(await prepareCorpus())) process.exit(1);

if (ONLY !== "app") {
  for (const engine of SELECTED) await runContract(engine);
}

if (ONLY !== "contract" && (await mountApp())) {
  for (const engine of SELECTED) await runApp(engine);
}

const failed = steps.filter((s) => !s.ok);
// Un échec GARDE son décor : la première chose à faire est d'y entrer et de
// rejouer la commande fautive. Sinon, rien ne reste — ni dossier, ni base.
const kept = KEEP || failed.length > 0;
if (!kept) {
  for (const engine of SERVERS.filter((e) =>
    SELECTED.some((s) => s.key === e.key),
  )) {
    await dropDatabases(engine, [DB_CONTRACT, DB_APP]);
  }
  rmSync(ROOT, { recursive: true, force: true });
}

process.stdout.write(
  `\n${failed.length === 0 ? "✅" : "❌"} banc de schéma réel : ${steps.length - failed.length}/${steps.length} étapes vertes${kept ? ` — décor gardé : ${ROOT} (bases ${DB_CONTRACT}, ${DB_APP})` : ""}\n`,
);
for (const s of failed) process.stdout.write(`   ❌ ${s.title}\n`);
process.exit(failed.length === 0 ? 0 : 1);
