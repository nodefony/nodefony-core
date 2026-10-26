/**
 * Le décor des bases SERVEUR d'un banc — une seule implémentation pour les
 * bancs de portabilité et de schéma réel : quels moteurs, comment recréer
 * leurs bases VIDES, et comment l'application reçoit l'adresse.
 *
 * Les administrateurs par défaut sont ceux du compose du dépôt
 * (`docker/docker-compose.yml`) ; la forge passe les siens.
 */
import { readFileSync, writeFileSync } from "node:fs";

/**
 * Les moteurs SERVEUR, dans l'ordre où un banc les visite.
 *
 * MySQL et MariaDB partagent le dialecte `mysql` — donc le pilote ET le
 * dossier de migrations. C'est voulu, et c'est une preuve de plus : MariaDB
 * doit appliquer la migration écrite pendant la passe MySQL sans en
 * réclamer une autre (`orm:generate` n'y trouve rien à écrire).
 */
export const ENGINES = Object.freeze(
  [
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
  ].map((e) => Object.freeze(e)),
);

/**
 * Recrée VIDES des bases sur le serveur d'un moteur, et rend l'URL de chacune.
 *
 * Les bases naissent avec les réglages PAR DÉFAUT du serveur — jeu de
 * caractères, collation —, jamais ceux qu'on aurait choisis pour le banc :
 * c'est ce qu'un utilisateur obtient, donc ce qu'il faut éprouver. En MySQL,
 * l'application se connecte par un compte à elle (`user`), pas en `root`.
 *
 * @param {{ dialect: string, admin: string }} engine - un moteur de `ENGINES`.
 * @param {readonly string[]} databases - noms des bases à recréer.
 * @param {{ name: string, password: string }} user - compte applicatif (MySQL).
 * @returns {Promise<Record<string, string>>} l'URL de chaque base, par nom.
 */
export async function recreateDatabases(engine, databases, user) {
  const admin = new URL(engine.admin);
  if (engine.dialect === "postgres") {
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: admin.toString() });
    await client.connect();
    try {
      for (const db of databases) {
        await client.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
        await client.query(`CREATE DATABASE "${db}"`);
      }
    } finally {
      await client.end();
    }
    return Object.fromEntries(
      databases.map((db) => {
        const u = new URL(admin);
        u.pathname = `/${db}`;
        return [db, u.toString()];
      }),
    );
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
      `CREATE USER IF NOT EXISTS '${user.name}'@'%' IDENTIFIED BY '${user.password}'`,
    );
    for (const db of databases) {
      await conn.query(`DROP DATABASE IF EXISTS \`${db}\``);
      await conn.query(`CREATE DATABASE \`${db}\``);
      await conn.query(
        `GRANT ALL PRIVILEGES ON \`${db}\`.* TO '${user.name}'@'%'`,
      );
    }
    await conn.query("FLUSH PRIVILEGES");
  } finally {
    await conn.end();
  }
  return Object.fromEntries(
    databases.map((db) => [
      db,
      `mysql://${user.name}:${user.password}@${admin.hostname}:${admin.port || 3306}/${db}`,
    ]),
  );
}

/**
 * Supprime des bases sur le serveur d'un moteur — le nettoyage d'un banc qui
 * ne garde pas son décor. Une base absente n'est pas une erreur.
 *
 * @param {{ dialect: string, admin: string }} engine - un moteur de `ENGINES`.
 * @param {readonly string[]} databases - noms des bases à supprimer.
 */
export async function dropDatabases(engine, databases) {
  const admin = new URL(engine.admin);
  if (engine.dialect === "postgres") {
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: admin.toString() });
    await client.connect();
    try {
      for (const db of databases) {
        await client.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
      }
    } finally {
      await client.end();
    }
    return;
  }
  const mysql = await import("mysql2/promise");
  const conn = await mysql.createConnection({
    host: admin.hostname,
    port: Number(admin.port || 3306),
    user: decodeURIComponent(admin.username),
    password: decodeURIComponent(admin.password),
  });
  try {
    for (const db of databases) {
      await conn.query(`DROP DATABASE IF EXISTS \`${db}\``);
    }
  } finally {
    await conn.end();
  }
}

/**
 * Pose (ou retire, `url === null`) `NF_DATABASE_URL` dans le `.env` d'une
 * application — le geste que la doc demande, et le seul. Les lignes COMMENTÉES
 * restent : ce sont celles du gabarit.
 *
 * @param {string} envFile - chemin du `.env`.
 * @param {string | null} url - l'adresse, ou `null` pour revenir au défaut.
 */
export function setDatabaseUrl(envFile, url) {
  const lines = readFileSync(envFile, "utf8")
    .split("\n")
    .filter((l) => !/^\s*NF_DATABASE_URL\s*=/u.test(l));
  if (url !== null) lines.push(`NF_DATABASE_URL=${url}`);
  writeFileSync(envFile, `${lines.join("\n").replace(/\n+$/u, "")}\n`);
}

/**
 * Les faits de comparaison qu'un banc confronte — un par écart possible entre
 * moteurs, chacun avec la requête qui le CONSTATE sur une table témoin.
 *
 * Constater plutôt que déduire : le nom d'une collation ment. `en_US.utf8`
 * ordonne par octets sous Alpine (musl n'implémente pas la collation) et en
 * linguistique sous Debian (glibc) — même nom, deux tris.
 */
const COLLATION_FACTS = Object.freeze({
  /** « alice » précède « Bob » : l'ordre ignore la casse. */
  linguisticOrder: [
    "SELECT s FROM nf_collation_probe WHERE s IN ('Bob', 'alice') ORDER BY s",
    (rows) => rows[0]?.s === "alice",
  ],
  /** « ALICE » égale « alice » : une unicité la refuserait. */
  equalIgnoresCase: [
    "SELECT COUNT(*) AS n FROM nf_collation_probe WHERE s = 'ALICE'",
    (rows) => Number(rows[0]?.n) > 1,
  ],
  /** « zoe » égale « zoé ». */
  equalIgnoresAccents: [
    "SELECT COUNT(*) AS n FROM nf_collation_probe WHERE s = 'zoe'",
    (rows) => Number(rows[0]?.n) > 1,
  ],
  /** « a » égale « a␠ » (collation PAD SPACE). */
  equalIgnoresTrailingSpace: [
    "SELECT COUNT(*) AS n FROM nf_collation_probe WHERE s = 'a'",
    (rows) => Number(rows[0]?.n) > 1,
  ],
  /** Le NULL vient en tête d'un tri croissant. */
  nullsFirstAsc: [
    "SELECT s FROM nf_collation_probe ORDER BY s LIMIT 1",
    (rows) => rows[0]?.s === null,
  ],
});

const PROBE_TABLE = "CREATE TEMPORARY TABLE nf_collation_probe (s VARCHAR(64))";
const PROBE_ROWS =
  "INSERT INTO nf_collation_probe (s) VALUES " +
  "('Bob'), ('alice'), ('ALICE'), ('zoe'), ('zoé'), ('a'), ('a '), (NULL)";

/**
 * Joue les requêtes de {@link COLLATION_FACTS} par un exécuteur, sur une table
 * TEMPORAIRE — elle hérite de la collation par défaut de la base, comme toute
 * colonne qu'une migration crée sans en nommer, et disparaît avec la session.
 *
 * @param {(sql: string) => Promise<Array<Record<string, unknown>>>} query
 * @returns {Promise<Record<keyof typeof COLLATION_FACTS, boolean>>}
 */
async function readCollationFacts(query) {
  await query(PROBE_TABLE);
  await query(PROBE_ROWS);
  const facts = {};
  for (const [name, [sql, read]] of Object.entries(COLLATION_FACTS)) {
    facts[name] = read(await query(sql));
  }
  return facts;
}

/**
 * CONSTATE comment une base compare et ordonne les chaînes, et le nom de sa
 * collation par défaut (pour le message — jamais pour décider).
 *
 * @param {{ dialect: string } | null} engine - un moteur de `ENGINES`, ou
 *   `null` pour SQLite (la référence des bancs, collation `BINARY`).
 * @param {string} [url] - la base à sonder (moteur serveur).
 * @returns {Promise<{ collation: string } & Record<keyof typeof COLLATION_FACTS, boolean>>}
 */
export async function probeCollation(engine, url) {
  if (engine === null) {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(":memory:");
    try {
      const facts = await readCollationFacts(async (sql) => {
        const statement = db.prepare(sql);
        return /^\s*SELECT/iu.test(sql)
          ? statement.all()
          : (statement.run(), []);
      });
      return { collation: "BINARY", ...facts };
    } finally {
      db.close();
    }
  }
  if (engine.dialect === "postgres") {
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      const query = async (sql) => (await client.query(sql)).rows;
      const facts = await readCollationFacts(query);
      const [db] = await query(
        "SELECT datcollate AS c, datlocprovider AS p FROM pg_database WHERE datname = current_database()",
      );
      const provider = { c: "libc", i: "icu", b: "builtin" }[db.p] ?? db.p;
      return { collation: `${db.c} (${provider})`, ...facts };
    } finally {
      await client.end();
    }
  }
  const mysql = await import("mysql2/promise");
  const conn = await mysql.createConnection(url);
  try {
    const query = async (sql) => {
      const [rows] = await conn.query(sql);
      return Array.isArray(rows) ? rows : [];
    };
    const facts = await readCollationFacts(query);
    const [db] = await query("SELECT @@collation_database AS c");
    return { collation: String(db.c), ...facts };
  } finally {
    await conn.end();
  }
}
