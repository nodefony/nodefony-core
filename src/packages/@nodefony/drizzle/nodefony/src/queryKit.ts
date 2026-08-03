import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { pickOrder } from "nodefony";
import type { IPageQuery } from "nodefony";
import type { SqlDialect } from "../interfaces/IDrizzleConfig";
import type { DrizzleDb } from "./orm-core/DrizzleRepository";
import { USER_SORTABLE_FIELDS, USER_DEFAULT_ORDER } from "@nodefony/user";

/**
 * queryKit — les requêtes SQL **natives** des entités framework, par dialecte
 * (chantier portabilité multi-dialecte, garde-fou G1 du comparatif ORM
 * mémoire IA `core-dev/audits/orm-comparatif-froid-2026-07.md`).
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

// ─── Listing paginé natif des utilisateurs (contrat `IUserRepository.listPage`) ──
//
// Même principe que `findUserIdBySocialProvider` : les filtres role/q descendent
// au SQL natif (containment JSON + `LIKE` insensible casse — non exprimables par
// le query builder portable), mais on ne SÉLECTIONNE QUE les `id` de la page ;
// le repository recharge ensuite les lignes complètes par le chemin typé (parsing
// JSON/booléens cohérent). Le queryKit émet ET exécute, routé par dialecte.

/** Identifiant quoté selon le dialecte (`"x"` SQL standard, `` `x` `` MySQL). */
function ident(dialect: SqlDialect, name: string): SQL {
  return dialect === "mysql"
    ? sql.raw("`" + name + "`")
    : sql.raw('"' + name + '"');
}

/** Filtres du listing utilisateur (sous-ensemble non portable de `IUserListQuery`). */
export interface UserListFilters {
  role?: string;
  enabled?: boolean;
  locked?: boolean;
  hasSocial?: boolean;
  q?: string;
}

/** Fenêtre + tri résolus (le défaut `identifier ASC` est posé par l'appelant). */
export interface UserPageWindow {
  limit: number;
  offset: number;
  order: Array<[string, "ASC" | "DESC"]>;
}

/** Condition `enabled = ?` — booléen natif en PG, `0/1` ailleurs (better-sqlite3/mysql2). */
function enabledCond(dialect: SqlDialect, flag: boolean): SQL {
  const col = ident(dialect, "enabled");
  if (dialect === "postgres") return sql`${col} = ${flag}`;
  return sql`${col} = ${flag ? 1 : 0}`;
}

/** Condition `locked = ?` — même routage booléen qu'`enabled`. */
function lockedCond(dialect: SqlDialect, flag: boolean): SQL {
  const col = ident(dialect, "locked");
  if (dialect === "postgres") return sql`${col} = ${flag}`;
  return sql`${col} = ${flag ? 1 : 0}`;
}

/**
 * Condition « le compte a (ou n'a pas) au moins un fournisseur externe ».
 *
 * `socialProviders` est un tableau JSON, dont la VACUITÉ s'exprime différemment
 * selon le dialecte — d'où le routage, comme pour le containment de `roles` :
 * SQLite compte les éléments, PostgreSQL compare au tableau vide `jsonb`, MySQL
 * lit la longueur native. La colonne est `NOT NULL` avec `[]` par défaut, donc
 * aucun `NULL` à considérer.
 */
function hasSocialCond(dialect: SqlDialect, flag: boolean): SQL {
  const col = ident(dialect, "socialProviders");
  switch (dialect) {
    case "sqlite":
      return flag
        ? sql`json_array_length(${col}) > 0`
        : sql`json_array_length(${col}) = 0`;
    case "postgres":
      return flag
        ? sql`jsonb_array_length(${col}) > 0`
        : sql`jsonb_array_length(${col}) = 0`;
    case "mysql":
      return flag ? sql`JSON_LENGTH(${col}) > 0` : sql`JSON_LENGTH(${col}) = 0`;
  }
}

/** Condition « le tableau JSON `roles` contient `role` » — forme native du dialecte. */
function roleCond(dialect: SqlDialect, role: string): SQL {
  const roles = ident(dialect, "roles");
  switch (dialect) {
    case "sqlite":
      return sql`EXISTS (SELECT 1 FROM json_each(${roles}) WHERE value = ${role})`;
    case "postgres":
      return sql`${roles} @> ${JSON.stringify([role])}::jsonb`;
    case "mysql":
      return sql`JSON_CONTAINS(${roles}, ${JSON.stringify(role)})`;
  }
}

/** Condition `LOWER(identifier) LIKE %q%` (sous-chaîne insensible à la casse, `%`/`_` échappés). */
function likeIdentifierCond(dialect: SqlDialect, q: string): SQL {
  const idCol = ident(dialect, "identifier");
  const escaped = q.toLowerCase().replace(/[\\%_]/g, (c) => "\\" + c);
  const pattern = `%${escaped}%`;
  // MySQL réinterprète `\` dans les littéraux → doubler ; ailleurs `\` est littéral.
  const esc = dialect === "mysql" ? sql.raw("'\\\\'") : sql.raw("'\\'");
  return sql`LOWER(${idCol}) LIKE ${pattern} ESCAPE ${esc}`;
}

/** Compose la clause WHERE des filtres actifs (undefined si aucun filtre). */
function userWhere(dialect: SqlDialect, f: UserListFilters): SQL | undefined {
  const conds: SQL[] = [];
  if (f.enabled !== undefined) conds.push(enabledCond(dialect, f.enabled));
  if (f.locked !== undefined) conds.push(lockedCond(dialect, f.locked));
  if (f.hasSocial !== undefined)
    conds.push(hasSocialCond(dialect, f.hasSocial));
  if (f.role !== undefined) conds.push(roleCond(dialect, f.role));
  if (f.q !== undefined && f.q.length > 0) {
    conds.push(likeIdentifierCond(dialect, f.q));
  }
  if (conds.length === 0) return undefined;
  return sql.join(conds, sql` AND `);
}

/**
 * Compose la clause `ORDER BY` d'un listing natif, quelle que soit l'entité.
 *
 * 🔒 Un nom de colonne ne se lie pas en paramètre : il est **concaténé** dans la
 * requête (`ident()` → `sql.raw`). Le tri est donc borné par `pickOrder` (core),
 * exactement comme dans les stores mémoire et Mongo — une seconde
 * implémentation de ce filtre divergerait sans que rien ne le signale, et ici
 * elle ouvrirait une injection. Le data plane a déjà refusé l'inconnu en 400 ;
 * cet étage existe pour l'appelant interne qui l'oublierait.
 *
 * @param allowed - les seuls champs acceptés (vocabulaire public de l'entité).
 * @param fallback - ordre appliqué si rien de recevable n'a été demandé.
 * @param tiebreaker - colonne ajoutée en dernier ressort quand l'ordre retenu ne
 *   la contient pas : sans elle, deux lignes ex æquo peuvent changer de page
 *   entre deux appels, et l'une des deux ne jamais apparaître.
 */
function orderBySql(
  dialect: SqlDialect,
  order: IPageQuery["order"],
  allowed: readonly string[],
  fallback: NonNullable<IPageQuery["order"]>,
  tiebreaker?: string,
): SQL {
  const effective = pickOrder(order, allowed, fallback);
  const chunks = effective.map(
    ([field, dir]) =>
      sql`${ident(dialect, field)} ${sql.raw(dir === "DESC" ? "DESC" : "ASC")}`,
  );
  if (tiebreaker !== undefined && !effective.some(([f]) => f === tiebreaker)) {
    chunks.push(sql`${ident(dialect, tiebreaker)} ASC`);
  }
  return sql.join(chunks, sql`, `);
}

/** Exécute un SELECT et normalise le retour en tableau de lignes (API native divergente). */
async function runSelect(
  db: DrizzleDb,
  dialect: SqlDialect,
  query: SQL,
): Promise<Array<Record<string, unknown>>> {
  switch (dialect) {
    case "sqlite":
      return (await db.all(query)) as Array<Record<string, unknown>>;
    case "postgres":
      return (await (db as unknown as PgExecutor).execute(query)).rows;
    case "mysql": {
      const [rows] = await (db as unknown as MysqlExecutor).execute(query);
      return rows as Array<Record<string, unknown>>;
    }
  }
}

/**
 * Sélectionne les `id` d'une **page** d'utilisateurs (filtres + tri + `LIMIT/
 * OFFSET`), sans matérialiser les lignes. `limit + 1` → `hasNext` sans `COUNT`.
 *
 * @returns les `id` de la page (au plus `window.limit`, dans l'ordre du tri) et
 *   `hasNext`.
 */
export async function listUserIdsPage(
  db: DrizzleDb,
  dialect: SqlDialect,
  filters: UserListFilters,
  window: UserPageWindow,
): Promise<{ ids: string[]; hasNext: boolean }> {
  const limit = Math.max(1, Math.floor(window.limit));
  const offset = Math.max(0, Math.floor(window.offset));
  const where = userWhere(dialect, filters);
  const whereSql = where ? sql` WHERE ${where}` : sql``;
  const query = sql`SELECT ${ident(dialect, "id")} AS id FROM ${ident(dialect, "User")}${whereSql}
      ORDER BY ${orderBySql(dialect, window.order, USER_SORTABLE_FIELDS, USER_DEFAULT_ORDER, "id")} LIMIT ${limit + 1} OFFSET ${offset}`;
  const rows = await runSelect(db, dialect, query);
  const ids = rows
    .map((r) => r.id)
    .filter((id): id is string => typeof id === "string");
  const hasNext = ids.length > limit;
  return { ids: hasNext ? ids.slice(0, limit) : ids, hasNext };
}

// ── Endpoints webhook — listing paginé admin ─────────────────────────────────

/** Filtres du listing d'endpoints (sous-ensemble non portable d'`IWebhookListQuery`). */
export interface WebhookListFilters {
  enabled?: boolean;
  event?: string;
  failing?: boolean;
  q?: string;
}

/**
 * Condition « endpoint en échec » — `failureCount > 0` (ou `= 0` pour les sains).
 *
 * Même forme sur les trois dialectes : la colonne est un entier, la comparaison
 * est indexable, et aucun `NULL` n'est possible (`failureCount` est `NOT NULL`,
 * initialisé à 0 à la création).
 */
function failingCond(dialect: SqlDialect, flag: boolean): SQL {
  const col = ident(dialect, "failureCount");
  return flag ? sql`${col} > 0` : sql`${col} = 0`;
}

/** Condition « le tableau JSON `events` contient `event` » — forme native du dialecte. */
function eventCond(dialect: SqlDialect, event: string): SQL {
  const events = ident(dialect, "events");
  switch (dialect) {
    case "sqlite":
      return sql`EXISTS (SELECT 1 FROM json_each(${events}) WHERE value = ${event})`;
    case "postgres":
      return sql`${events} @> ${JSON.stringify([event])}::jsonb`;
    case "mysql":
      return sql`JSON_CONTAINS(${events}, ${JSON.stringify(event)})`;
  }
}

/**
 * Condition `LOWER(url) LIKE %q% OR LOWER(description) LIKE %q%` — la recherche
 * d'un humain porte sur l'adresse OU le libellé. `description` est nullable :
 * `COALESCE` évite qu'un `NULL` fasse retomber tout le `OR` à `NULL` (donc faux).
 */
function likeWebhookCond(dialect: SqlDialect, q: string): SQL {
  const url = ident(dialect, "url");
  const description = ident(dialect, "description");
  const escaped = q.toLowerCase().replace(/[\\%_]/g, (c) => "\\" + c);
  const pattern = `%${escaped}%`;
  // MySQL réinterprète `\` dans les littéraux → doubler ; ailleurs `\` est littéral.
  const esc = dialect === "mysql" ? sql.raw("'\\\\'") : sql.raw("'\\'");
  return sql`(LOWER(${url}) LIKE ${pattern} ESCAPE ${esc} OR LOWER(COALESCE(${description}, '')) LIKE ${pattern} ESCAPE ${esc})`;
}

/** Compose la clause WHERE des filtres actifs (undefined si aucun filtre). */
function webhookWhere(
  dialect: SqlDialect,
  f: WebhookListFilters,
): SQL | undefined {
  const conds: SQL[] = [];
  if (f.enabled !== undefined) conds.push(enabledCond(dialect, f.enabled));
  if (f.failing !== undefined) conds.push(failingCond(dialect, f.failing));
  if (f.event !== undefined) conds.push(eventCond(dialect, f.event));
  if (f.q !== undefined && f.q.length > 0) {
    conds.push(likeWebhookCond(dialect, f.q));
  }
  if (conds.length === 0) return undefined;
  return sql.join(conds, sql` AND `);
}

/**
 * Sélectionne les `id` d'une **page** d'endpoints webhook (filtres + tri +
 * `LIMIT/OFFSET`), sans matérialiser les lignes. `limit + 1` → `hasNext` sans
 * `COUNT`.
 *
 * Le tri descend dans le `ORDER BY` — jamais appliqué après découpe, sinon la
 * 2ᵉ page recommencerait au lieu de continuer la 1ʳᵉ. À défaut d'`order`
 * recevable, l'ordre par défaut `createdAt DESC, id ASC` rend l'offset
 * déterministe quand deux endpoints partagent la même milliseconde de création.
 *
 * @param window - fenêtre de page **et** tri demandé (déjà en noms publics ; il
 *   est re-filtré ici par l'allowlist, cf {@link orderBySql}).
 * @returns les `id` de la page (au plus `limit`, dans l'ordre) et `hasNext`.
 */
export async function listWebhookIdsPage(
  db: DrizzleDb,
  dialect: SqlDialect,
  filters: WebhookListFilters,
  window: {
    limit: number;
    offset: number;
    order?: IPageQuery["order"];
    sortable?: readonly string[];
  },
): Promise<{ ids: string[]; hasNext: boolean }> {
  const limit = Math.max(1, Math.floor(window.limit));
  const offset = Math.max(0, Math.floor(window.offset));
  const where = webhookWhere(dialect, filters);
  const whereSql = where ? sql` WHERE ${where}` : sql``;
  const orderSql = orderBySql(
    dialect,
    window.order,
    window.sortable ?? [],
    [
      ["createdAt", "DESC"],
      ["id", "ASC"],
    ],
    "id",
  );
  const query = sql`SELECT ${ident(dialect, "id")} AS id FROM ${ident(dialect, "webhook_endpoint")}${whereSql}
      ORDER BY ${orderSql}
      LIMIT ${limit + 1} OFFSET ${offset}`;
  const rows = await runSelect(db, dialect, query);
  const ids = rows
    .map((r) => r.id)
    .filter((id): id is string => typeof id === "string");
  const hasNext = ids.length > limit;
  return { ids: hasNext ? ids.slice(0, limit) : ids, hasNext };
}

/**
 * Compte les endpoints qui matchent les filtres (`COUNT(*)` natif filtré) —
 * base du `total` d'une page d'endpoints.
 *
 * @returns le nombre de lignes correspondantes.
 */
export async function countWebhookEndpoints(
  db: DrizzleDb,
  dialect: SqlDialect,
  filters: WebhookListFilters,
): Promise<number> {
  const where = webhookWhere(dialect, filters);
  const whereSql = where ? sql` WHERE ${where}` : sql``;
  const query = sql`SELECT COUNT(*) AS cnt FROM ${ident(dialect, "webhook_endpoint")}${whereSql}`;
  const rows = await runSelect(db, dialect, query);
  return Number(rows[0]?.cnt ?? 0);
}

/**
 * Compte les utilisateurs qui matchent les filtres (`COUNT(*)` natif filtré) —
 * base commune du `total` de la page ET du garde-fou `countActiveAdmins`
 * (`{ enabled: true, role: adminRole }`).
 *
 * @returns le nombre de lignes correspondantes.
 */
export async function countUsers(
  db: DrizzleDb,
  dialect: SqlDialect,
  filters: UserListFilters,
): Promise<number> {
  const where = userWhere(dialect, filters);
  const whereSql = where ? sql` WHERE ${where}` : sql``;
  const query = sql`SELECT COUNT(*) AS cnt FROM ${ident(dialect, "User")}${whereSql}`;
  const rows = await runSelect(db, dialect, query);
  return Number(rows[0]?.cnt ?? 0);
}
