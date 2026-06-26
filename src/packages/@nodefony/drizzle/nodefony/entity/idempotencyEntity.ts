import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { entityRegistry } from "@nodefony/orm-core";
import type { IEntity } from "@nodefony/orm-core";
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
    key: text("key").primaryKey(),
    /**
     * Empreinte du **payload** (méthode + chemin + corps). Comparée à chaque
     * `begin` : un fingerprint distinct pour la même clé vivante = réutilisation
     * de clé pour une AUTRE requête → `mismatch` (422, draft §2.2/§2.7).
     */
    fingerprint: text("fingerprint").notNull(),
    /**
     * `if` = réservation *in-flight* (handler en cours) ; `done` = réponse
     * mémorisée (rejouée en `replayed`). Court (2 lettres) — colonne chaude.
     */
    state: text("state").$type<"if" | "done">().notNull(),
    /**
     * Réponse mémorisée (`{status, headers?, body}`), `null` tant qu'*in-flight*.
     * Posée à `complete`, relue en `replayed`. JSON (`mode:"json"`).
     */
    response: text("response", { mode: "json" }).$type<IdempotentResponse>(),
    /**
     * Échéance (epoch ms) : bail *in-flight* (`now + lease`) puis rétention de la
     * réponse (`now + ttl`). Au-delà = entrée morte → réservable (`begin` la vole
     * atomiquement) et purgeable (`gc`). NOT NULL → comparaison toujours définie.
     */
    expiresAt: integer("expiresAt").notNull(),
  },
  (t) => ({
    expiresAtIdx: index("idempotency_key_expiresAt_idx").on(t.expiresAt),
  }),
);

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
 * @returns le descripteur {@link IEntity} de la table d'idempotence.
 */
export function createIdempotencyEntities(orm: string): IEntity[] {
  return [
    {
      orm,
      name: IDEMPOTENCY_ENTITY_NAME,
      // `module: "framework"` → la table est regroupée sous @nodefony/framework
      // dans l'ERD Studio (l'idempotence est une feature framework — data plane
      // admin + `@Idempotent` — simplement hébergée par l'ORM).
      module: "framework",
      schema: idempotencyKeyTable,
    },
  ];
}

/**
 * Enregistre l'entité du store d'idempotence dans le `entityRegistry` pour un ORM
 * donné. À appeler **avant** `orm.connect()` (l'adapter crée la table au connect).
 *
 * @param orm - clé de l'ORM cible.
 */
export function registerIdempotencyEntities(orm: string): void {
  for (const entity of createIdempotencyEntities(orm)) {
    entityRegistry.register(entity);
  }
}
