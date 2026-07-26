import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  getTableName,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  ne,
  notInArray,
  sql,
} from "drizzle-orm";
import type { Column, SQL } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { getTableConfig as getPgTableConfig } from "drizzle-orm/pg-core";
import type { PgTable } from "drizzle-orm/pg-core";
import { getTableConfig as getMysqlTableConfig } from "drizzle-orm/mysql-core";
import type { MySqlTable } from "drizzle-orm/mysql-core";
import { RequestContext, redactSecrets } from "nodefony";
import {
  isFieldOperators,
  isUpdateOperators,
  queryFlowMonitor,
  UnknownCriteriaField,
} from "@nodefony/orm-core";
import type { SqlDialect } from "../../interfaces/IDrizzleConfig";
import type {
  Criteria,
  FieldOperators,
  IRepository,
  ITransaction,
  RepositoryReadOptions,
  UpdateData,
} from "@nodefony/orm-core";

/**
 * Handle Drizzle (instance racine ou transaction) — schéma résolu côté adapter.
 *
 * Typage = **vue d'exécution CANONIQUE** (surface better-sqlite3) quel que soit
 * le dialecte : `NodePgDatabase` expose la même surface builder pour les verbes
 * du repository (`select`/`insert`/`update`/`delete`), et l'exactitude runtime
 * est prouvée par les e2e PG (session/token/user/webauthn/totp/audit/webhook).
 * La surface d'exécution native qui DIVERGE (`db.all` vs `db.execute().rows`)
 * est routée par le `queryKit` — jamais ici.
 */
export type DrizzleDb = BetterSQLite3Database<Record<string, never>>;

/** Table Drizzle multi-dialecte (l'union honnête des variantes colKit). */
export type DrizzleTable = SQLiteTable | PgTable | MySqlTable;

/** Colonne Drizzle dialecte-agnostique (classe de base — acceptée par les
 *  opérateurs `eq`/`lt`/`asc`… et les fragments `sql`). */
export type DrizzleColumn = Column;

/** Vue colonnes d'une table Drizzle (accès par nom logique). */
type TableColumns = Record<string, DrizzleColumn>;

/**
 * Vue d'exécution canonique (typage sqlite) d'une table multi-dialecte —
 * **LE point unique** de conversion vers les builders (cf {@link DrizzleDb} :
 * la surface builder est structurellement identique sqlite/pg, prouvée e2e).
 * Consommé aussi par les stores à requêtes builder (`DrizzleAuditStore`).
 */
export function execTable(table: DrizzleTable): SQLiteTable {
  return table as SQLiteTable;
}

/** Builder Drizzle exécutable ET introspectable (`toSQL()`) — cible du tap profiler. */
type ProfiledQuery<R> = PromiseLike<R> & { toSQL: () => { sql: string } };

/**
 * Relation résolue au boot de l'ORM, prête pour l'eager-load manuel (sans la
 * couche `relations()` de Drizzle, pour rester générique cross-entités).
 */
export interface DrizzleResolvedRelation {
  /** Cardinalité. */
  type: "one-to-many" | "many-to-one" | "one-to-one";
  /** Table cible Drizzle (variante du dialecte du connecteur). */
  targetTable: DrizzleTable;
  /** Colonne clé étrangère (sur la cible pour 1-N, sur la source pour N-1). */
  foreignKey: string;
  /** Clé primaire de l'entité courante (côté parent du 1-N). */
  localKey: string;
  /** Clé primaire de la cible (côté lookup du N-1). */
  targetKey: string;
}

/**
 * Repository portable (contrat {@link IRepository}) au-dessus d'une table Drizzle
 * + driver `better-sqlite3`.
 *
 * 3ᵉ adapter du banc orm-core (ADR-0003) : valide le contrat sur un ORM
 * **type-safe-first** dont le `WHERE` est un *builder* d'expressions (pas un objet
 * plat). Spécificités traduites ici :
 * - critère portable → expressions Drizzle (`eq`/`and`/`gt`/`inArray`/`like`...),
 *   opérateurs riches inclus (résolution ADR-0003 risque #3) ;
 * - **eager-load manuel** (`options.relations`) : une requête `IN (...)` par
 *   relation déclarée, puis regroupement en mémoire — portable sans déclarer la
 *   couche `relations()` de Drizzle ;
 * - liaison transactionnelle via {@link DrizzleRepository.withTransaction} (le
 *   handle de transaction *est* un db Drizzle → réutilisé tel quel).
 *
 * @typeParam T - forme plate de l'entité gérée.
 */
export class DrizzleRepository<T = unknown> implements IRepository<T> {
  readonly #db: DrizzleDb;
  readonly #table: DrizzleTable;
  readonly #relations: Record<string, DrizzleResolvedRelation>;
  /** Connecteur ORM (clé du registre) — tag des métriques de flux. */
  readonly #connector: string;
  /** Dialecte SQL du connecteur — route les rares divergences syntaxiques
   *  (OFFSET-sans-LIMIT, introspection PK composite). */
  readonly #dialect: SqlDialect;
  /**
   * Colonnes de la clé primaire (lazy — résolu au premier `*One`) : `null` =
   * aucune PK déclarée (fallback `rowid`, SQLite-only) ; `undefined` = pas
   * encore résolu. Rien d'alloué au constructeur (règle perf).
   */
  #pk: DrizzleColumn[] | null | undefined;

  /**
   * @param db - handle Drizzle (instance racine ou transaction).
   * @param table - table Drizzle de l'entité (variante du dialecte).
   * @param relations - relations résolues (eager-load), indexées par champ.
   * @param connector - nom de la connexion (clé du registre) — défaut `"default"`.
   * @param dialect - dialecte SQL du connecteur — défaut `"sqlite"`.
   */
  constructor(
    db: DrizzleDb,
    table: DrizzleTable,
    relations: Record<string, DrizzleResolvedRelation>,
    connector = "default",
    dialect: SqlDialect = "sqlite",
  ) {
    this.#db = db;
    this.#table = table;
    this.#relations = relations;
    this.#connector = connector;
    this.#dialect = dialect;
  }

  /** Colonne Drizzle d'une table par nom logique. */
  #col(table: DrizzleTable, name: string): DrizzleColumn {
    return (table as unknown as TableColumns)[name];
  }

  /**
   * Colonnes de la PK de la table (mémoïsées) : colonnes inline `.primaryKey()`
   * d'abord (introspection core, valide sur tous les dialectes — couvre toutes
   * les entités framework), sinon PK composite déclarée via `primaryKey({
   * columns })` (extraConfig du dialecte, best-effort), sinon `null`.
   */
  #pkColumns(): DrizzleColumn[] | null {
    if (this.#pk !== undefined) {
      return this.#pk;
    }
    let cols: DrizzleColumn[] = Object.values(
      getTableColumns(this.#table),
    ).filter((col) => col.primary);
    if (cols.length === 0) {
      try {
        cols =
          this.#dialect === "postgres"
            ? [
                ...(getPgTableConfig(this.#table as PgTable).primaryKeys[0]
                  ?.columns ?? []),
              ]
            : this.#dialect === "mysql"
              ? [
                  ...(getMysqlTableConfig(this.#table as MySqlTable)
                    .primaryKeys[0]?.columns ?? []),
                ]
              : [
                  ...(getTableConfig(this.#table as SQLiteTable).primaryKeys[0]
                    ?.columns ?? []),
                ];
      } catch {
        cols = [];
      }
    }
    this.#pk = cols.length > 0 ? cols : null;
    return this.#pk;
  }

  /**
   * Prédicat `WHERE` qui borne un UPDATE/DELETE à **au plus une** ligne :
   * `pk IN (SELECT pk FROM (SELECT pk FROM t WHERE … LIMIT 1) AS picked)`.
   *
   * POURQUOI cette forme (et pas `rowid` / `LIMIT` direct) :
   * - `rowid` est SQLite-only — c'était le SQL dialect-spécifique n°1 du
   *   repository (audit comparatif ORM 2026-07, garde-fou G3) ;
   * - `UPDATE … LIMIT 1` n'est pas du SQL standard (PG le rejette) ;
   * - la **table dérivée** intermédiaire est requise par MySQL, qui interdit à
   *   la fois `LIMIT` dans une sous-requête `IN` directe ET la re-lecture de
   *   la table cible d'un UPDATE/DELETE en sous-requête (ERROR 1093) — la
   *   dérivée force la matérialisation. SQLite et PG l'acceptent telle quelle
   *   → une seule forme pour les trois dialectes ;
   * - PK composite : row-values `(a, b) IN (…)` (SQLite ≥ 3.15 / PG / MySQL).
   *
   * Fallback sans PK déclarée : `rowid` (SQLite-only — toutes les entités
   * framework ont une PK ; une table d'app sans PK est un cas sqlite assumé).
   */
  #pickOne(where: SQL | undefined): SQL {
    const pk = this.#pkColumns();
    if (!pk) {
      return where
        ? sql`rowid in (select rowid from ${this.#table} where ${where} limit 1)`
        : sql`rowid in (select rowid from ${this.#table} limit 1)`;
    }
    const qualified = sql.join(pk, sql.raw(", "));
    const inner = where
      ? sql`select ${qualified} from ${this.#table} where ${where} limit 1`
      : sql`select ${qualified} from ${this.#table} limit 1`;
    const output = sql.join(
      pk.map((col) => sql.identifier(col.name)),
      sql.raw(", "),
    );
    const first = pk[0];
    const target =
      pk.length === 1 && first ? sql`${first}` : sql`(${qualified})`;
    return sql`${target} in (select ${output} from (${inner}) as picked)`;
  }

  /**
   * Lignes affectées, normalisé par driver : better-sqlite3 `{changes}` /
   * pg `{rowCount}` / mysql2 tuple `[ResultSetHeader{affectedRows}, fields]`.
   */
  #affected(
    result: { changes?: number; rowCount?: number | null } | readonly unknown[],
  ): number {
    if (Array.isArray(result)) {
      const header = result[0] as { affectedRows?: number } | undefined;
      return header?.affectedRows ?? 0;
    }
    const r = result as { changes?: number; rowCount?: number | null };
    return r.changes ?? r.rowCount ?? 0;
  }

  /** Tronque + redacte un SQL paramétré pour l'affichage (jamais de valeur). */
  #safeSql(builder: ProfiledQuery<unknown>): string {
    // `statement`, pas `sql` : ce fichier importe le constructeur de fragments
    // `sql` de drizzle (utilisé par `#firstRowPredicate`) — un `sql` local le
    // masquerait, et un futur `sql`…` écrit ici échouerait sans raison lisible.
    let statement: string;
    try {
      statement = builder.toSQL().sql;
    } catch {
      statement = "<drizzle query>";
    }
    return redactSecrets(
      statement.length > 2000 ? `${statement.slice(0, 2000)}…` : statement,
    );
  }

  /**
   * Tap dev-only : exécute le builder en mesurant la durée, alimente **deux**
   * sondes complémentaires (sans surcoût quand les deux sont inactives) :
   *  1. **profiler par-requête** (buffer de scope ALS, debug bar) — capture le
   *     SQL paramétré de CHAQUE requête tracée ;
   *  2. **flux ORM agrégé** ({@link queryFlowMonitor}, process-wide) — compte le
   *     débit + la latence ; n'extrait le SQL que sur le chemin **lent** (rare).
   *
   * POURQUOI lecture directe de l'ALS (≠ tap par-requête d'un autre ORM) :
   * `better-sqlite3` est **synchrone**, sans pool → l'ALS reste valide pendant
   * `await builder`. Les deux drapeaux sont lus **avant toute allocation** →
   * coût nul quand rien n'observe (prod, bancs de charge hors kernel).
   *
   * Sécurité : `toSQL()` renvoie le SQL **paramétré** (placeholders `?`, jamais
   * les valeurs) → credentials hors texte ; `redactSecrets` en défense en profondeur.
   *
   * @param builder - requête Drizzle (thenable + `toSQL()`).
   * @returns le résultat de la requête.
   */
  async #prof<R>(builder: ProfiledQuery<R>): Promise<R> {
    const buf = RequestContext.get()?.queries;
    const flow = queryFlowMonitor.enabled;
    if (!buf && !flow) {
      return builder;
    }
    const start = performance.now();
    const result = await builder;
    const durationMs = performance.now() - start;
    if (flow) {
      // toSQL UNIQUEMENT sur le chemin lent (rare) — l'agrégat ne paie jamais
      // la sérialisation du texte au cas nominal.
      const statement =
        durationMs >= queryFlowMonitor.slowMs
          ? this.#safeSql(builder)
          : undefined;
      queryFlowMonitor.record(this.#connector, durationMs, statement);
    }
    if (buf) {
      buf.push({
        sql: this.#safeSql(builder),
        startMs: start,
        durationMs,
        rows: Array.isArray(result) ? result.length : undefined,
        connector: "drizzle",
      });
    }
    return result;
  }

  /** Empile les conditions d'un objet d'opérateurs riches sur une colonne. */
  #pushOperators(
    conds: SQL[],
    col: DrizzleColumn,
    ops: FieldOperators<unknown>,
  ): void {
    if (ops.$eq !== undefined) conds.push(eq(col, ops.$eq));
    if (ops.$ne !== undefined) conds.push(ne(col, ops.$ne));
    if (ops.$gt !== undefined) conds.push(gt(col, ops.$gt));
    if (ops.$gte !== undefined) conds.push(gte(col, ops.$gte));
    if (ops.$lt !== undefined) conds.push(lt(col, ops.$lt));
    if (ops.$lte !== undefined) conds.push(lte(col, ops.$lte));
    if (ops.$in !== undefined) conds.push(inArray(col, [...ops.$in]));
    if (ops.$nin !== undefined) conds.push(notInArray(col, [...ops.$nin]));
    if (ops.$like !== undefined) conds.push(like(col, ops.$like));
    // `!== undefined` et pas de test de vérité : `$null: false` = IS NOT NULL.
    if (ops.$null !== undefined) {
      conds.push(ops.$null ? isNull(col) : isNotNull(col));
    }
  }

  /** Traduit un critère portable en expression `WHERE` Drizzle (ou `undefined`). */
  #where(criteria?: Criteria<T>): SQL | undefined {
    if (!criteria) {
      return undefined;
    }
    const conds: SQL[] = [];
    for (const [field, value] of Object.entries(criteria)) {
      const col = this.#col(this.#table, field);
      if (!col) {
        // Strict (B2) : champ inconnu = erreur, pas un skip silencieux (qui
        // ferait disparaître la condition → fuite « renvoie tout »). Même
        // contrat que Mongoose. Requêtes natives → getNativeConnection().
        throw new UnknownCriteriaField(
          field,
          getTableName(this.#table),
          Object.keys(getTableColumns(this.#table)),
        );
      }
      if (isFieldOperators(value)) {
        this.#pushOperators(conds, col, value);
      } else if (value === null) {
        // `IS NULL`, jamais `eq(col, null)` : en SQL une égalité à NULL est
        // toujours FAUSSE → le filtre disparaissait en silence (0 ligne, sans
        // erreur), au lieu de matcher les colonnes vides. Même contrat que
        // Mongoose. Équivaut à `{ champ: { $null: true } }`.
        conds.push(isNull(col));
      } else {
        conds.push(eq(col, value));
      }
    }
    if (conds.length === 0) {
      return undefined;
    }
    return conds.length === 1 ? conds[0] : (and(...conds) as SQL);
  }

  /** Exécute le `SELECT` (critère + pagination + tri), retourne des objets plats. */
  async #runSelect(
    criteria?: Criteria<T>,
    options?: RepositoryReadOptions,
  ): Promise<Record<string, unknown>[]> {
    let query = this.#db.select().from(execTable(this.#table)).$dynamic();
    const where = this.#where(criteria);
    if (where) {
      query = query.where(where);
    }
    if (options?.order?.length) {
      query = query.orderBy(
        ...options.order.map(([field, dir]) =>
          dir === "DESC"
            ? desc(this.#col(this.#table, field))
            : asc(this.#col(this.#table, field)),
        ),
      );
    }
    if (options?.limit !== undefined) {
      query = query.limit(options.limit);
    } else if (options?.offset !== undefined && this.#dialect === "sqlite") {
      // SQLite : OFFSET exige un LIMIT → `-1` = illimité quand seul l'offset
      // est posé. PG accepte OFFSET seul (et REJETTE `LIMIT -1`) → rien à poser.
      // ⚠️ En FRAGMENT SQL : drizzle 0.45 IGNORE silencieusement un `limit(-1)`
      // NUMÉRIQUE (émet `OFFSET` seul → SqliteError) — bug attrapé par le banc
      // de contrat 3-dialectes, jamais vu avant car ce chemin n'était couvert
      // qu'en PG (où rien n'est posé).
      query = query.limit(sql`-1` as unknown as number);
    } else if (options?.offset !== undefined && this.#dialect === "mysql") {
      // MySQL : OFFSET exige aussi un LIMIT ; le sentinel documenté (2^64-1)
      // n'est pas représentable en double JS → MAX_SAFE_INTEGER (2^53-1),
      // illimité en pratique et transmis exact par le paramètre bindé.
      query = query.limit(Number.MAX_SAFE_INTEGER);
    }
    if (options?.offset !== undefined) {
      query = query.offset(options.offset);
    }
    return (await this.#prof(
      query as unknown as ProfiledQuery<Record<string, unknown>[]>,
    )) as Record<string, unknown>[];
  }

  /** Eager-load manuel des relations déclarées (1 requête `IN (...)` par relation). */
  async #populate(
    rows: Record<string, unknown>[],
    relations: string[],
  ): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    for (const name of relations) {
      const rel = this.#relations[name];
      if (!rel) {
        throw new Error(
          `DrizzleRepository(${name}): relation "${name}" non déclarée.`,
        );
      }
      if (rel.type === "one-to-many") {
        const parentIds = rows.map((row) => row[rel.localKey]);
        const fkCol = this.#col(rel.targetTable, rel.foreignKey);
        const children = (await this.#prof(
          this.#db
            .select()
            .from(execTable(rel.targetTable))
            .where(inArray(fkCol, parentIds)) as unknown as ProfiledQuery<
            Record<string, unknown>[]
          >,
        )) as Record<string, unknown>[];
        const byParent = new Map<unknown, Record<string, unknown>[]>();
        for (const child of children) {
          const key = child[rel.foreignKey];
          const bucket = byParent.get(key);
          if (bucket) {
            bucket.push(child);
          } else {
            byParent.set(key, [child]);
          }
        }
        for (const row of rows) {
          row[name] = byParent.get(row[rel.localKey]) ?? [];
        }
      } else {
        // many-to-one / one-to-one : FK sur la source, lookup par PK de la cible.
        const fkValues = rows
          .map((row) => row[rel.foreignKey])
          .filter((value) => value !== null && value !== undefined);
        const idCol = this.#col(rel.targetTable, rel.targetKey);
        const parents =
          fkValues.length > 0
            ? ((await this.#prof(
                this.#db
                  .select()
                  .from(execTable(rel.targetTable))
                  .where(inArray(idCol, fkValues)) as unknown as ProfiledQuery<
                  Record<string, unknown>[]
                >,
              )) as Record<string, unknown>[])
            : [];
        const byId = new Map(parents.map((p) => [p[rel.targetKey], p]));
        for (const row of rows) {
          row[name] = byId.get(row[rel.foreignKey]) ?? null;
        }
      }
    }
  }

  async find(
    criteria?: Criteria<T>,
    options?: RepositoryReadOptions,
  ): Promise<T[]> {
    const rows = await this.#runSelect(criteria, options);
    if (options?.relations?.length) {
      await this.#populate(rows, options.relations);
    }
    return rows as T[];
  }

  async findOne(
    criteria: Criteria<T>,
    options?: RepositoryReadOptions,
  ): Promise<T | null> {
    const rows = await this.find(criteria, { ...options, limit: 1 });
    return rows[0] ?? null;
  }

  async create(data: Partial<T>): Promise<T> {
    if (this.#dialect === "mysql") {
      const rows = await this.#mysqlInsertReturning([
        data as Record<string, unknown>,
      ]);
      return rows[0] as T;
    }
    const rows = (await this.#prof(
      this.#db
        .insert(execTable(this.#table))
        .values(data as Record<string, unknown>)
        .returning() as unknown as ProfiledQuery<Record<string, unknown>[]>,
    )) as Record<string, unknown>[];
    return rows[0] as T;
  }

  async createMany(data: Partial<T>[]): Promise<T[]> {
    if (data.length === 0) {
      return []; // no-op : pas d'INSERT à 0 ligne (drizzle/SQL le rejetteraient).
    }
    if (this.#dialect === "mysql") {
      return (await this.#mysqlInsertReturning(
        data as Record<string, unknown>[],
      )) as T[];
    }
    const rows = (await this.#prof(
      this.#db
        .insert(execTable(this.#table))
        .values(data as Record<string, unknown>[])
        .returning() as unknown as ProfiledQuery<Record<string, unknown>[]>,
    )) as Record<string, unknown>[];
    return rows as T[];
  }

  async updateOne(criteria: Criteria<T>, data: Partial<T>): Promise<T | null> {
    if (this.#dialect === "mysql") {
      return this.#mysqlUpdateOneReturning(
        data as Record<string, unknown>,
        criteria,
      );
    }
    // Atomique : UPDATE … WHERE <pickOne> RETURNING.
    // - une SEULE requête → pas de relecture (qui renverrait null à tort si le
    //   critère porte sur un champ modifié — bug B1) ;
    // - `#pickOne` garantit « au plus une » ligne via la PK découverte (forme
    //   portable sqlite/pg/mysql — cf. sa doc) ;
    // - RETURNING rend la ligne réellement persistée.
    const pick = this.#pickOne(this.#where(criteria));
    const rows = (await this.#prof(
      this.#db
        .update(execTable(this.#table))
        .set(data as Record<string, unknown>)
        .where(pick)
        .returning() as unknown as ProfiledQuery<Record<string, unknown>[]>,
    )) as Record<string, unknown>[];
    return (rows[0] as T) ?? null;
  }

  /**
   * Traduit le `update` d'un upsert en deux vues : ce qu'on ÉCRIT à l'insertion
   * (valeurs brutes) et ce qu'on ré-applique au conflit (`SET`), où les
   * {@link UpdateOperators} deviennent une expression du dialecte.
   *
   * `$max`/`$min` → `MAX(col, ?)` en sqlite, `GREATEST/LEAST(col, ?)` en
   * postgres/mysql : `col` y désigne la valeur EXISTANTE, et la valeur proposée
   * est bindée. À l'insertion il n'y a rien à comparer → valeur brute.
   */
  #writeSet(update: UpdateData<T>): {
    set: Record<string, unknown>;
    values: Record<string, unknown>;
  } {
    const set: Record<string, unknown> = {};
    const values: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(update)) {
      if (!isUpdateOperators(value)) {
        set[field] = value;
        values[field] = value;
        continue;
      }
      const col = this.#col(this.#table, field);
      if (!col) {
        throw new UnknownCriteriaField(
          field,
          getTableName(this.#table),
          Object.keys(getTableColumns(this.#table)),
        );
      }
      // `sql.raw` sur une constante INTERNE (jamais une entrée appelante) : le
      // nom de fonction n'est pas paramétrable en SQL. La valeur, elle, est bindée.
      const apply = (fn: string, v: unknown): void => {
        set[field] = sql`${sql.raw(fn)}(${col}, ${v})`;
        values[field] = v;
      };
      if (value.$max !== undefined) {
        apply(this.#dialect === "sqlite" ? "MAX" : "GREATEST", value.$max);
      }
      if (value.$min !== undefined) {
        apply(this.#dialect === "sqlite" ? "MIN" : "LEAST", value.$min);
      }
    }
    return { set, values };
  }

  async upsert(
    criteria: Criteria<T>,
    update: UpdateData<T>,
    insertOnly?: Partial<T>,
  ): Promise<T> {
    // Une SEULE requête : INSERT … ON CONFLICT(<criteria>) DO UPDATE SET <update>
    // RETURNING. Remplace le findOne+(update|create) = 2 round-trips + une race
    // insert/update. `target` = colonnes de conflit (clé unique) ; `set` ne
    // ré-applique QUE `update` → les champs insert-only (ex. createdAt) ne sont
    // pas écrasés en cas de conflit. Le DO UPDATE est inconditionnel (MySQL
    // n'accepte pas de WHERE dessus) → une valeur qui ne doit pas régresser
    // passe par `$max`/`$min` (cf `#writeSet`), et ça reste 1 instruction.
    const target = Object.keys(criteria).map((field) => {
      const col = this.#col(this.#table, field);
      if (!col) {
        throw new UnknownCriteriaField(
          field,
          getTableName(this.#table),
          Object.keys(getTableColumns(this.#table)),
        );
      }
      return col;
    });
    const write = this.#writeSet(update);
    const values = {
      ...(criteria as Record<string, unknown>),
      ...((insertOnly ?? {}) as Record<string, unknown>),
      ...write.values,
    };
    if (this.#dialect === "mysql") {
      // `ON DUPLICATE KEY UPDATE` (pas de `target` : MySQL arbitre sur TOUTES
      // les contraintes uniques) + relecture par les valeurs FINALES des
      // colonnes du critère (post-merge : `values[field]`) — pas de RETURNING.
      await this.#prof(
        (
          this.#db.insert(execTable(this.#table)).values(values) as unknown as {
            onDuplicateKeyUpdate(cfg: {
              set: Record<string, unknown>;
            }): ProfiledQuery<unknown>;
          }
        ).onDuplicateKeyUpdate({ set: write.set }),
      );
      const conds = target.map((col) => eq(col, values[col.name]));
      const rows = (await this.#prof(
        this.#db
          .select()
          .from(execTable(this.#table))
          .where(
            conds.length === 1 ? (conds[0] as SQL) : (and(...conds) as SQL),
          )
          .limit(1) as unknown as ProfiledQuery<Record<string, unknown>[]>,
      )) as Record<string, unknown>[];
      return rows[0] as T;
    }
    const rows = (await this.#prof(
      this.#db
        .insert(execTable(this.#table))
        .values(values)
        .onConflictDoUpdate({
          // Vue d'exécution canonique (cf `execTable`) : le builder sqlite
          // exige ses colonnes ; les PgColumn y passent structurellement.
          target: target as SQLiteColumn[],
          set: write.set,
        })
        .returning() as unknown as ProfiledQuery<Record<string, unknown>[]>,
    )) as Record<string, unknown>[];
    return rows[0] as T;
  }

  async updateMany(criteria: Criteria<T>, data: Partial<T>): Promise<number> {
    const where = this.#where(criteria);
    const builder = this.#db
      .update(execTable(this.#table))
      .set(data as Record<string, unknown>);
    const result = (await this.#prof(
      (where ? builder.where(where) : builder) as unknown as ProfiledQuery<{
        changes?: number;
        rowCount?: number | null;
      }>,
    )) as { changes?: number; rowCount?: number | null };
    return this.#affected(result);
  }

  async increment(
    criteria: Criteria<T>,
    changes: Partial<Record<keyof T, number>>,
  ): Promise<T | null> {
    // Atomique : UPDATE … SET f = f + ? WHERE <pickOne> RETURNING.
    // Le delta est calculé côté SQL → pas de read-modify-write, donc pas de race
    // sur le compteur. Même garantie « au plus une + 0 relecture » qu'updateOne.
    const setObj: Record<string, SQL> = {};
    for (const [field, delta] of Object.entries(changes)) {
      const col = this.#col(this.#table, field);
      if (!col) {
        throw new UnknownCriteriaField(
          field,
          getTableName(this.#table),
          Object.keys(getTableColumns(this.#table)),
        );
      }
      setObj[field] = sql`${col} + ${delta}`;
    }
    if (this.#dialect === "mysql") {
      return this.#mysqlUpdateOneReturning(setObj, criteria);
    }
    const pick = this.#pickOne(this.#where(criteria));
    const rows = (await this.#prof(
      this.#db
        .update(execTable(this.#table))
        .set(setObj)
        .where(pick)
        .returning() as unknown as ProfiledQuery<Record<string, unknown>[]>,
    )) as Record<string, unknown>[];
    return (rows[0] as T) ?? null;
  }

  async delete(criteria: Criteria<T>): Promise<number> {
    const where = this.#where(criteria);
    const builder = this.#db.delete(execTable(this.#table));
    const result = (await this.#prof(
      (where ? builder.where(where) : builder) as unknown as ProfiledQuery<{
        changes?: number;
        rowCount?: number | null;
      }>,
    )) as { changes?: number; rowCount?: number | null };
    return this.#affected(result);
  }

  async deleteOne(criteria: Criteria<T>): Promise<boolean> {
    if (this.#dialect === "mysql") {
      return (await this.#mysqlDeleteOneReturning(criteria)) !== null;
    }
    const rows = await this.#deleteOneReturning(criteria);
    return rows.length > 0;
  }

  async findOneAndDelete(criteria: Criteria<T>): Promise<T | null> {
    if (this.#dialect === "mysql") {
      return this.#mysqlDeleteOneReturning(criteria);
    }
    const rows = await this.#deleteOneReturning(criteria);
    return (rows[0] as T) ?? null;
  }

  /** DELETE atomique d'AU PLUS une ligne (PK via `#pickOne`), RETURNING la ligne. */
  async #deleteOneReturning(
    criteria: Criteria<T>,
  ): Promise<Record<string, unknown>[]> {
    const pick = this.#pickOne(this.#where(criteria));
    return (await this.#prof(
      this.#db
        .delete(execTable(this.#table))
        .where(pick)
        .returning() as unknown as ProfiledQuery<Record<string, unknown>[]>,
    )) as Record<string, unknown>[];
  }

  // ── Chemins MySQL (pas de RETURNING) ──────────────────────────────────────
  // MySQL ne renvoie jamais les lignes d'un INSERT/UPDATE/DELETE : les verbes
  // « qui rendent la ligne » se décomposent en (SELECT cible par critère) →
  // (mutation bornée par PK, critère RE-VÉRIFIÉ dans le WHERE — une course
  // perdue rend 0 ligne affectée → null, jamais une mutation d'une ligne qui ne
  // matche plus) → (relecture par PK). 2-3 round-trips au lieu d'1 : le prix du
  // dialecte, payé UNIQUEMENT en mysql (sqlite/pg gardent le chemin RETURNING).

  /** PK obligatoire en mysql (les verbes re-SELECTent par PK). Fail-loud sinon. */
  #requirePk(verb: string): DrizzleColumn[] {
    const pk = this.#pkColumns();
    if (!pk) {
      throw new Error(
        `DrizzleRepository(${getTableName(this.#table)}): "${verb}" on mysql ` +
          `requires a declared primary key (no RETURNING → rows are re-read by PK).`,
      );
    }
    return pk;
  }

  /** WHERE d'égalité sur la PK (valeurs plates lues par nom de colonne). */
  #pkWhere(pk: DrizzleColumn[], values: Record<string, unknown>): SQL {
    const conds = pk.map((col) => eq(col, values[col.name]));
    return conds.length === 1 ? (conds[0] as SQL) : (and(...conds) as SQL);
  }

  /** SELECT d'UNE ligne par valeurs de PK (relecture post-mutation mysql). */
  async #selectByPk(
    pk: DrizzleColumn[],
    values: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    const rows = (await this.#prof(
      this.#db
        .select()
        .from(execTable(this.#table))
        .where(this.#pkWhere(pk, values))
        .limit(1) as unknown as ProfiledQuery<Record<string, unknown>[]>,
    )) as Record<string, unknown>[];
    return rows[0] ?? null;
  }

  /** Valeurs de PK d'une ligne cible, après application d'un `set` éventuel
   *  (un set qui réécrit une colonne PK avec une VALEUR plate est honoré ;
   *  les fragments SQL — increment — retombent sur la valeur d'origine). */
  #finalPkValues(
    pk: DrizzleColumn[],
    target: Record<string, unknown>,
    set?: Record<string, unknown>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const col of pk) {
      const v = set?.[col.name];
      out[col.name] =
        v !== undefined && (typeof v !== "object" || v === null)
          ? v
          : target[col.name];
    }
    return out;
  }

  /** UPDATE mysql « au plus une, ligne rendue » : cible par critère → UPDATE
   *  borné PK + critère re-vérifié → relecture par PK. */
  async #mysqlUpdateOneReturning(
    set: Record<string, unknown>,
    criteria: Criteria<T>,
  ): Promise<T | null> {
    const pk = this.#requirePk("updateOne");
    const where = this.#where(criteria);
    const target = (await this.#runSelect(criteria, { limit: 1 }))[0];
    if (!target) {
      return null;
    }
    const pkCond = this.#pkWhere(pk, target);
    const result = (await this.#prof(
      this.#db
        .update(execTable(this.#table))
        .set(set)
        .where(
          where ? (and(pkCond, where) as SQL) : pkCond,
        ) as unknown as ProfiledQuery<readonly unknown[]>,
    )) as readonly unknown[];
    if (this.#affected(result) === 0) {
      return null; // course perdue : la cible ne matchait plus le critère.
    }
    return (await this.#selectByPk(
      pk,
      this.#finalPkValues(pk, target, set),
    )) as T | null;
  }

  /** DELETE mysql « au plus une, ligne rendue » : cible par critère → DELETE
   *  borné PK + critère re-vérifié → ligne lue rendue. */
  async #mysqlDeleteOneReturning(criteria: Criteria<T>): Promise<T | null> {
    const pk = this.#requirePk("deleteOne");
    const where = this.#where(criteria);
    const target = (await this.#runSelect(criteria, { limit: 1 }))[0];
    if (!target) {
      return null;
    }
    const pkCond = this.#pkWhere(pk, target);
    const result = (await this.#prof(
      this.#db
        .delete(execTable(this.#table))
        .where(
          where ? (and(pkCond, where) as SQL) : pkCond,
        ) as unknown as ProfiledQuery<readonly unknown[]>,
    )) as readonly unknown[];
    return this.#affected(result) > 0 ? (target as T) : null;
  }

  /** INSERT mysql, ligne(s) rendue(s) : `$returningId()` (PK générées côté JS
   *  par `$defaultFn` ou auto-increment) complété par les PK passées dans les
   *  données, puis relecture par PK (ordre d'insertion préservé). */
  async #mysqlInsertReturning(
    data: Record<string, unknown>[],
  ): Promise<Record<string, unknown>[]> {
    const pk = this.#requirePk("create");
    const ids = (await this.#prof(
      (
        this.#db.insert(execTable(this.#table)).values(data) as unknown as {
          $returningId(): ProfiledQuery<Record<string, unknown>[]>;
        }
      ).$returningId(),
    )) as Record<string, unknown>[];
    const out: Record<string, unknown>[] = [];
    for (let i = 0; i < data.length; i++) {
      const values: Record<string, unknown> = {};
      for (const col of pk) {
        values[col.name] = data[i]?.[col.name] ?? ids[i]?.[col.name];
      }
      const row = await this.#selectByPk(pk, values);
      if (!row) {
        throw new Error(
          `DrizzleRepository(${getTableName(this.#table)}): mysql insert ` +
            `succeeded but the row could not be re-read by primary key.`,
        );
      }
      out.push(row);
    }
    return out;
  }

  async count(criteria?: Criteria<T>): Promise<number> {
    const where = this.#where(criteria);
    const builder = this.#db
      .select({ value: count() })
      .from(execTable(this.#table))
      .$dynamic();
    const rows = (await this.#prof(
      (where ? builder.where(where) : builder) as unknown as ProfiledQuery<
        Array<{ value: number }>
      >,
    )) as Array<{ value: number }>;
    return Number(rows[0]?.value ?? 0);
  }

  async exists(criteria: Criteria<T>): Promise<boolean> {
    const where = this.#where(criteria);
    let query = this.#db
      .select({ one: sql`1` })
      .from(execTable(this.#table))
      .$dynamic();
    if (where) {
      query = query.where(where);
    }
    query = query.limit(1);
    const rows = (await this.#prof(
      query as unknown as ProfiledQuery<unknown[]>,
    )) as unknown[];
    return rows.length > 0;
  }

  withTransaction(tx: ITransaction): IRepository<T> {
    return new DrizzleRepository<T>(
      tx.getNative<DrizzleDb>(),
      this.#table,
      this.#relations,
      this.#connector,
      this.#dialect,
    );
  }
}
