import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { entityRegistry } from "@nodefony/orm-core";
import type { IEntity } from "@nodefony/orm-core";
import type { SqlDialect } from "../interfaces/IDrizzleConfig";
import { createFrameworkTableFactory } from "./colKit";
import type { FrameworkTableFactory } from "./colKit";
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
 * le connecteur cible (`registerIdempotencyEntities(connector)`). Le module drizzle
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
/**
 * Spec colKit de la table (une spec logique → la variante du dialecte demandé ;
 * types par dialecte assumés DANS le kit : `expiresAt` epochMs = `integer`
 * SQLite 64-bit / `bigint` PG+MySQL ; `response` json = `text mode:"json"` /
 * `jsonb` / `json` ; `key` = `varchar(512)` en MySQL — PK non indexable en
 * TEXT, 512 couvre `JSON.stringify([identity, clientKey ≤ 255])`) :
 * - `key` : clé DÉJÀ scopée à l'identité par l'appelant (`evaluateIdempotency`
 *   compose `[identité, clé client]`) → anti-IDOR garanti en amont. PK → la
 *   réservation atomique repose sur sa contrainte d'unicité (`ON CONFLICT`).
 * - `fingerprint` : empreinte du payload (méthode + chemin + corps), comparée à
 *   chaque `begin` — un fingerprint distinct pour la même clé vivante =
 *   `mismatch` (422, draft §2.2/§2.7).
 * - `state` : `if` = réservation *in-flight* ; `done` = réponse mémorisée
 *   (rejouée en `replayed`). Union TS portée par {@link IdempotencyKeyRow}.
 * - `response` : réponse mémorisée (`{status, headers?, body}`), `null` tant
 *   qu'*in-flight* ; posée à `complete`, relue en `replayed`.
 * - `expiresAt` : échéance (epoch ms) — bail *in-flight* (`now + lease`) puis
 *   rétention (`now + ttl`). Au-delà = entrée morte → volable (`begin`) et
 *   purgeable (`gc`). NOT NULL → comparaison toujours définie. Index lu par
 *   drizzle-kit (accélère le `gc` ; sans effet sur le DDL dérivé dev/test).
 */
const createIdempotencyTableFactory: FrameworkTableFactory =
  createFrameworkTableFactory({
    name: "idempotency_key",
    columns: {
      key: { kind: "text", primaryKey: true },
      fingerprint: { kind: "text", notNull: true },
      state: { kind: "text", notNull: true },
      response: { kind: "json" },
      expiresAt: { kind: "epochMs", notNull: true },
    },
    indexes: [{ name: "idempotency_key_expiresAt_idx", on: ["expiresAt"] }],
  });

/**
 * Factory de la table d'idempotence pour un dialecte donné — **premier maillon du
 * chantier portabilité multi-dialecte** (un schéma logique → la table Drizzle du
 * bon dialecte), migrée du switch manuel 2 tables vers le colKit (S4 : la
 * variante mysql sort du kit). Le `DrizzleOrm` l'appelle selon `connector.dialect`.
 */
export const createIdempotencyTable = createIdempotencyTableFactory;

/**
 * Variante SQLite mémoïsée (dialecte par défaut) — export statique de compat
 * (bancs, typage du store {@link DrizzleIdempotencyStore}).
 */
export const idempotencyKeyTable: SQLiteTable =
  createIdempotencyTable("sqlite");

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
 * Le `connector` est **dynamique** (nom du connecteur de l'app, ex. `"default"`) : la
 * table est statique mais sa liaison à un ORM dépend de la config → on ne peut
 * pas la figer via `@entity`. À enregistrer dans `entityRegistry` **avant**
 * `orm.connect()` (cf {@link registerIdempotencyEntities}).
 *
 * @param orm - clé de l'ORM cible dans le `ormRegistry`.
 * @param dialect - dialecte SQL du connecteur (sélectionne la variante de table).
 * @returns le descripteur {@link IEntity} de la table d'idempotence.
 */
export function createIdempotencyEntities(
  connector: string,
  dialect: SqlDialect = "sqlite",
): IEntity[] {
  return [
    {
      connector,
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
 * @param connector - nom de la connexion cible (clé du registre).
 * @param dialect - dialecte SQL du connecteur (variante de table — défaut `sqlite`).
 */
export function registerIdempotencyEntities(
  connector: string,
  dialect: SqlDialect = "sqlite",
): void {
  for (const entity of createIdempotencyEntities(connector, dialect)) {
    entityRegistry.register(entity);
  }
}
