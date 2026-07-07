import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { SqlDialect } from "../interfaces/IDrizzleConfig";
import type { DrizzleDb } from "./orm-core/DrizzleRepository";

/**
 * queryKit — les requêtes SQL **natives** des entités framework, par dialecte
 * (chantier portabilité multi-dialecte, garde-fou G1 du comparatif ORM
 * `docs/audits/orm-comparatif-froid-2026-07.md`).
 *
 * **Pourquoi** : le repository générique et les stores sont dialect-agnostiques
 * (query builder Drizzle) — mais une poignée de requêtes descendent au SQL brut
 * parce que le builder ne les exprime pas (recherche DANS une colonne JSON).
 * Chaque dialecte a SA syntaxe JSON (`json_each` SQLite, `@>` jsonb PG,
 * `JSON_CONTAINS` MySQL) : sans kit, le dialecte fuirait dans les repositories.
 * Le queryKit inverse le rapport, comme le colKit pour les schémas : **une
 * intention par requête**, le kit émet ET exécute la forme du dialecte demandé.
 *
 * **Règles** (miroir du colKit) :
 * - tout `sql\`…\`` d'entité framework vit ICI et nulle part ailleurs (le
 *   budget G1 : dialecte = colKit + factories d'entités + queryKit) ;
 * - paramètres TOUJOURS bindés (`${x}` drizzle → placeholder), jamais de
 *   concaténation — la valeur ne touche jamais la chaîne SQL ;
 * - l'exécution est routée ici aussi : l'API native diverge (`db.all()`
 *   better-sqlite3 / `db.execute().rows` node-postgres) — un appelant qui
 *   recevrait juste le fragment devrait router lui-même, et le dialecte
 *   fuirait quand même.
 *
 * **Interne au module** (comme le colKit) : pas d'export dans `index.ts`.
 */

/**
 * Vue structurelle de l'exécuteur node-postgres de Drizzle — le handle PG vit
 * derrière `DrizzleDb` (vue d'exécution CANONIQUE typée sqlite, cf sa doc) ;
 * la surface native qui DIVERGE (`execute().rows` vs `all()`) est re-typée ici,
 * au seul endroit qui l'exécute.
 */
interface PgExecutor {
  execute(query: SQL): Promise<{ rows: Array<Record<string, unknown>> }>;
}

/**
 * Vue structurelle de l'exécuteur mysql2 de Drizzle — même principe que
 * {@link PgExecutor} : `db.execute()` y renvoie le tuple mysql2
 * `[rows | header, fields]` (SELECT → tableau d'objets ; INSERT/UPDATE/DELETE
 * → `ResultSetHeader{affectedRows}`).
 */
interface MysqlExecutor {
  execute(query: SQL): Promise<readonly [unknown, unknown]>;
}

/**
 * Cherche l'`id` du user dont le tableau JSON `socialProviders` contient un
 * lien `{provider, providerId}` — le finder du pattern **Shadow User** OAuth
 * (`DrizzleUserRepository.findBySocialProvider`).
 *
 * Sémantique IDENTIQUE sur tous les dialectes : « il EXISTE un élément du
 * tableau dont `provider` ET `providerId` valent exactement ces valeurs »
 * (les autres clés de l'élément, ex. `createdAt`, sont ignorées) :
 * - **sqlite** : `EXISTS (SELECT 1 FROM json_each(col) WHERE json_extract…)`
 *   — scan du tableau, valeurs bindées ;
 * - **postgres** : `col @> '[{"provider":…,"providerId":…}]'::jsonb` —
 *   containment jsonb natif (indexable GIN), le motif est UN paramètre bindé
 *   sérialisé JSON ;
 * - **mysql** : `JSON_CONTAINS(col, <motif>)` — containment JSON natif (même
 *   sémantique partielle que `@>` : un objet candidat est contenu dans un
 *   élément du tableau si toutes SES clés y matchent), motif = UN paramètre
 *   bindé sérialisé JSON, casté par MySQL.
 *
 * @param db - handle Drizzle natif (racine ou transaction) du dialecte.
 * @param dialect - dialecte SQL du connecteur.
 * @param provider - fournisseur d'identité (`"github"`, `"google"`…).
 * @param providerId - identifiant du compte CHEZ le fournisseur.
 * @returns l'`id` du user lié, ou `null` si aucun lien.
 */
export async function findUserIdBySocialProvider(
  db: DrizzleDb,
  dialect: SqlDialect,
  provider: string,
  providerId: string,
): Promise<string | null> {
  switch (dialect) {
    case "sqlite": {
      const rows = (await db.all(
        sql`SELECT "id" AS id FROM "User"
            WHERE EXISTS (
              SELECT 1 FROM json_each("User"."socialProviders")
              WHERE json_extract(value, '$.provider') = ${provider}
                AND json_extract(value, '$.providerId') = ${providerId}
            ) LIMIT 1`,
      )) as Array<{ id: string }>;
      return rows[0]?.id ?? null;
    }
    case "postgres": {
      // Le motif de containment est UN paramètre (sérialisé JSON côté JS puis
      // casté jsonb par PG) — `provider`/`providerId` ne touchent jamais le SQL.
      const pattern = JSON.stringify([{ provider, providerId }]);
      const result = await (db as unknown as PgExecutor).execute(
        sql`SELECT "id" AS id FROM "User"
            WHERE "socialProviders" @> ${pattern}::jsonb LIMIT 1`,
      );
      const id = result.rows[0]?.id;
      return typeof id === "string" ? id : null;
    }
    case "mysql": {
      // Même motif-paramètre que PG (`@>` ↔ JSON_CONTAINS : containment
      // partiel d'un objet dans un élément du tableau) — MySQL caste la string
      // bindée en JSON. Backticks = quoting d'identifiants MySQL.
      const pattern = JSON.stringify([{ provider, providerId }]);
      const [rows] = await (db as unknown as MysqlExecutor).execute(
        sql`SELECT ${sql.raw("`id`")} AS id FROM ${sql.raw("`User`")}
            WHERE JSON_CONTAINS(${sql.raw("`socialProviders`")}, ${pattern}) LIMIT 1`,
      );
      const id = (rows as Array<Record<string, unknown>>)[0]?.id;
      return typeof id === "string" ? id : null;
    }
  }
}

/**
 * Réservation **atomique** d'une clé d'idempotence en **MySQL** — l'équivalent
 * du `INSERT … ON CONFLICT DO UPDATE … WHERE expiré RETURNING` des dialectes
 * sqlite/pg (cf `DrizzleIdempotencyStore.begin`), reconstruit avec les moyens
 * du dialecte : MySQL n'a **ni `RETURNING` ni `WHERE` sur le `ON DUPLICATE KEY
 * UPDATE`** — et le verdict `affectedRows` d'un ODKU est AMBIGU sous mysql2
 * (flag `CLIENT_FOUND_ROWS` par défaut : ligne « matched inchangée » = 1,
 * indistinguable d'un INSERT — prouvé sur serveur réel). D'où DEUX
 * instructions, chacune atomique et au verdict non-ambigu :
 *
 * 1. **`INSERT IGNORE`** — clé neuve : `affectedRows = 1` ⇒ réservation
 *    acquise ; clé existante : TOUJOURS `0` (`FOUND_ROWS` ne concerne pas les
 *    doublons d'INSERT). L'unicité de la PK garantit UN seul gagnant sous
 *    concurrence. (`IGNORE` downgrade aussi le mode strict en warnings — sans
 *    enjeu ici : la clé est bornée en amont, `IDEMPOTENCY_KEY_MAX` 255 ≪
 *    varchar(512).)
 * 2. **Vol d'une entrée MORTE** : `UPDATE … WHERE key = ? AND expiresAt < now`
 *    — le WHERE porte la condition « morte » ; l'UPDATE change TOUJOURS
 *    `expiresAt` (nouveau > now > ancien) donc `affectedRows = 1` ⇔ vol acquis,
 *    quel que soit le flag. Deux voleurs concurrents se sérialisent sur le
 *    verrou de ligne InnoDB : le second ré-évalue le WHERE sur la version
 *    committée (current read) → 0 ligne. Jamais de double-vol.
 *
 * Course résiduelle INSERT(0) → UPDATE(0) alors que la clé vient d'être
 * supprimée (gc/abort) : verdict « contention » → le SELECT de `begin` ne la
 * trouve plus → `in-flight` prudent (jamais `fresh` hors réservation atomique,
 * l'invariant anti double-effet du contrat).
 *
 * @param db - handle Drizzle natif mysql.
 * @param args - clé scopée, empreinte payload, horloge et échéance du bail.
 * @returns `true` si la réservation est acquise (= le `fresh` du contrat).
 */
export async function reserveIdempotencyKeyMysql(
  db: DrizzleDb,
  args: {
    key: string;
    fingerprint: string;
    now: number;
    leaseExpiresAt: number;
  },
): Promise<boolean> {
  const { key, fingerprint, now, leaseExpiresAt } = args;
  const exec = db as unknown as MysqlExecutor;
  const [inserted] = await exec.execute(
    sql`INSERT IGNORE INTO ${sql.raw("`idempotency_key`")}
          (${sql.raw("`key`, `fingerprint`, `state`, `response`, `expiresAt`")})
        VALUES (${key}, ${fingerprint}, 'if', NULL, ${leaseExpiresAt})`,
  );
  if (((inserted as { affectedRows?: number })?.affectedRows ?? 0) === 1) {
    return true; // clé neuve — INSERT gagné (PK = un seul gagnant possible).
  }
  const [stolen] = await exec.execute(
    sql`UPDATE ${sql.raw("`idempotency_key`")}
        SET ${sql.raw("`fingerprint`")} = ${fingerprint},
            ${sql.raw("`state`")} = 'if',
            ${sql.raw("`response`")} = NULL,
            ${sql.raw("`expiresAt`")} = ${leaseExpiresAt}
        WHERE ${sql.raw("`key`")} = ${key}
          AND ${sql.raw("`expiresAt`")} < ${now}`,
  );
  return ((stolen as { affectedRows?: number })?.affectedRows ?? 0) > 0;
}
