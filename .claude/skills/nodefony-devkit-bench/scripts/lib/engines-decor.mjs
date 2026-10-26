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
