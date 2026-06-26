import {
  index as sqliteIndex,
  integer,
  sqliteTable,
  text as sqliteText,
} from "drizzle-orm/sqlite-core";
import {
  bigint as pgBigint,
  index as pgIndex,
  jsonb,
  pgTable,
  text as pgText,
} from "drizzle-orm/pg-core";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { PgTable } from "drizzle-orm/pg-core";
import { entityRegistry } from "@nodefony/orm-core";
import type { IEntity } from "@nodefony/orm-core";
import type { SqlDialect } from "../interfaces/IDrizzleConfig";
// `import type` UNIQUEMENT → effacé à la compilation (approche B : 0 dépendance
// runtime de `@nodefony/drizzle` vers `@nodefony/framework`). Le contrat
// d'idempotence vit au CORE (`nodefony`), donc l'import de son DTO ne crée AUCUN
// cycle (drizzle dépend déjà du core).
import type { IdempotentResponse } from "nodefony";

/**
 * Table Drizzle du **store d'idempotence** distribué (schema-as-code) —
 * implémentation SQL d'`IIdempotencyStore` (contrat au CORE) pour dédoublonner
 * les **mutations** rejouées (reconnexion socket, double-clic) PARTAGÉ cross-pod,
 * là où le store mémoire par défaut reste affine à un pod.
 *
 * **Pourquoi SQL plutôt que Redis** : un cluster qui a déjà une base Postgres
 * (multi-pod) mais PAS de Redis obtient la dédup cross-pod sans nouvelle infra.
 * L'atomicité de la réservation (`begin`) vient d'un `INSERT … ON CONFLICT(key)
 * DO UPDATE … WHERE expiré` (cf {@link DrizzleIdempotencyStore}) — l'équivalent
 * SQL du `SET … NX PX` Redis. Contrepartie de l'absence de TTL natif : un `gc()`
 * applicatif purge les entrées expirées (≠ Redis dont le `PX` les efface seul).
 *
 * ⚠️ **SQLite = banc de test de la sémantique uniquement** : un fichier SQLite
 * est mono-machine (lock d'écriture) → aucun intérêt multi-pod. La cible réelle
 * est **Postgres/MySQL** (changement de driver), où l'atomicité de l'instruction
 * `ON CONFLICT` tient sous concurrence inter-pods.
 *
 * **Liaison ORM dynamique** (pattern `tokenEntity`/`userTable`, pas `@entity`
 * figé) : en approche B, c'est l'**application** qui câble le store
 * (`registerIdempotencyStore("drizzle", …)` — registre `@nodefony/framework`) ET
 * le connecteur cible (`registerIdempotencyEntities(orm)`). Le module drizzle
 * n'auto-enregistre rien (activer un store distribué est une décision de
 * déploiement, pas une conséquence du chargement du module).
 *
 * ⚠️ **Pas de `.default()` SQL** : le DDL dérivé (`getTableConfig`) n'émet ni
 * `DEFAULT` ni index séparés (cf `DrizzleOrm.#createTableSQL`) — seules les
 * contraintes colonne (PK / NOT NULL). L'`index()` sur `expiresAt` est lu par
 * `drizzle-kit` (migrations prod, accélère le `gc`) et sans effet sur le DDL
 * dérivé dev/test. Toutes les colonnes sont posées explicitement par le store
 * (jamais de défaut implicite manquant qui casserait l'INSERT).
 */
export const idempotencyKeyTable = sqliteTable(
  "idempotency_key",
  {
    /**
     * Clé d'idempotence DÉJÀ scopée à l'identité par l'appelant
     * (`evaluateIdempotency` compose `[identité, méthode, chemin, clé client]`)
     * → anti-IDOR garanti en amont ; le store reste agnostique au scope. PK →
     * la réservation atomique repose sur sa contrainte d'unicité (`ON CONFLICT`).
     */
    key: sqliteText("key").primaryKey(),
    /**
     * Empreinte du **payload** (méthode + chemin + corps). Comparée à chaque
     * `begin` : un fingerprint distinct pour la même clé vivante = réutilisation
     * de clé pour une AUTRE requête → `mismatch` (422, draft §2.2/§2.7).
     */
    fingerprint: sqliteText("fingerprint").notNull(),
    /**
     * `if` = réservation *in-flight* (handler en cours) ; `done` = réponse
     * mémorisée (rejouée en `replayed`). Court (2 lettres) — colonne chaude.
     */
    state: sqliteText("state").$type<"if" | "done">().notNull(),
    /**
     * Réponse mémorisée (`{status, headers?, body}`), `null` tant qu'*in-flight*.
     * Posée à `complete`, relue en `replayed`. JSON (`mode:"json"`).
     */
    response: sqliteText("response", {
      mode: "json",
    }).$type<IdempotentResponse>(),
    /**
     * Échéance (epoch ms) : bail *in-flight* (`now + lease`) puis rétention de la
     * réponse (`now + ttl`). Au-delà = entrée morte → réservable (`begin` la vole
     * atomiquement) et purgeable (`gc`). NOT NULL → comparaison toujours définie.
     */
    expiresAt: integer("expiresAt").notNull(),
  },
  (t) => ({
    expiresAtIdx: sqliteIndex("idempotency_key_expiresAt_idx").on(t.expiresAt),
  }),
);

/**
 * Variante **PostgreSQL** de la table d'idempotence (driver `pg`). Mêmes NOMS de
 * colonnes que la variante SQLite → le store ({@link DrizzleIdempotencyStore})
 * reste dialect-agnostique (il référence `table.key`/`table.expiresAt`… via
 * `eq`/`lt`, agnostiques). Divergences de TYPE assumées (= la raison d'être de la
 * factory) :
 *  - `expiresAt` = `bigint` (epoch ms ≈ 1.7e12 **dépasse** `integer` PG 32-bit ;
 *    `mode:"number"` reste sûr sous 2^53) — là où SQLite `integer` est 64-bit ;
 *  - `response` = `jsonb` (type JSON natif PG) — là où SQLite stocke un `text` JSON.
 */
const idempotencyKeyPgTable = pgTable(
  "idempotency_key",
  {
    key: pgText("key").primaryKey(),
    fingerprint: pgText("fingerprint").notNull(),
    state: pgText("state").$type<"if" | "done">().notNull(),
    response: jsonb("response").$type<IdempotentResponse>(),
    expiresAt: pgBigint("expiresAt", { mode: "number" }).notNull(),
  },
  (t) => ({
    expiresAtIdx: pgIndex("idempotency_key_expiresAt_idx").on(t.expiresAt),
  }),
);

/**
 * Factory de la table d'idempotence pour un dialecte donné — **premier maillon du
 * chantier portabilité multi-dialecte** (un schéma logique → la table Drizzle du
 * bon dialecte). `sqlite` (défaut) et `postgres` sont câblés ; `mysql` suivra
 * (driver `mysql2`). Le `DrizzleOrm` appelle cette factory selon `connector.dialect`.
 *
 * @param dialect - dialecte SQL cible.
 * @returns la table Drizzle (`SQLiteTable` | `PgTable`) du dialecte.
 * @throws si le dialecte n'est pas encore supporté (`mysql`).
 */
export function createIdempotencyTable(
  dialect: SqlDialect = "sqlite",
): SQLiteTable | PgTable {
  switch (dialect) {
    case "sqlite":
      return idempotencyKeyTable;
    case "postgres":
      return idempotencyKeyPgTable;
    default:
      throw new Error(
        `[@nodefony/drizzle] idempotency: dialect "${dialect}" not yet ` +
          `supported (sqlite, postgres available; mysql on the roadmap).`,
      );
  }
}

/**
 * Forme plate d'une ligne du store d'idempotence (telle que renvoyée par le
 * repository / `SELECT`). Identique aux colonnes de {@link idempotencyKeyTable}
 * → zéro mapping store ↔ entité.
 */
export interface IdempotencyKeyRow {
  key: string;
  fingerprint: string;
  state: "if" | "done";
  response: IdempotentResponse | null;
  expiresAt: number;
}

/** Nom logique de l'entité (clé de lookup `getRepository` / `entityRegistry`). */
export const IDEMPOTENCY_ENTITY_NAME = "idempotency_key" as const;

/**
 * Construit le descripteur d'entité du store d'idempotence pour un ORM nommé.
 *
 * L'`orm` est **dynamique** (nom du connecteur de l'app, ex. `"default"`) : la
 * table est statique mais sa liaison à un ORM dépend de la config → on ne peut
 * pas la figer via `@entity`. À enregistrer dans `entityRegistry` **avant**
 * `orm.connect()` (cf {@link registerIdempotencyEntities}).
 *
 * @param orm - clé de l'ORM cible dans le `ormRegistry`.
 * @param dialect - dialecte SQL du connecteur (sélectionne la variante de table).
 * @returns le descripteur {@link IEntity} de la table d'idempotence.
 */
export function createIdempotencyEntities(
  orm: string,
  dialect: SqlDialect = "sqlite",
): IEntity[] {
  return [
    {
      orm,
      name: IDEMPOTENCY_ENTITY_NAME,
      // `module: "framework"` → la table est regroupée sous @nodefony/framework
      // dans l'ERD Studio (l'idempotence est une feature framework — data plane
      // admin + `@Idempotent` — simplement hébergée par l'ORM).
      module: "framework",
      schema: createIdempotencyTable(dialect),
    },
  ];
}

/**
 * Enregistre l'entité du store d'idempotence dans le `entityRegistry` pour un ORM
 * donné. À appeler **avant** `orm.connect()` (l'adapter crée la table au connect).
 *
 * @param orm - clé de l'ORM cible.
 * @param dialect - dialecte SQL du connecteur (variante de table — défaut `sqlite`).
 */
export function registerIdempotencyEntities(
  orm: string,
  dialect: SqlDialect = "sqlite",
): void {
  for (const entity of createIdempotencyEntities(orm, dialect)) {
    entityRegistry.register(entity);
  }
}
