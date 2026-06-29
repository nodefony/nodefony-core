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
  like,
  lt,
  lte,
  ne,
  notInArray,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { RequestContext, redactSecrets } from "nodefony";
import {
  isFieldOperators,
  queryFlowMonitor,
  UnknownCriteriaField,
} from "@nodefony/orm-core";
import type {
  Criteria,
  FieldOperators,
  IRepository,
  ITransaction,
  RepositoryReadOptions,
} from "@nodefony/orm-core";

/** Handle Drizzle (instance racine ou transaction) — schéma résolu côté adapter. */
export type DrizzleDb = BetterSQLite3Database<Record<string, never>>;

/** Vue colonnes d'une table Drizzle (accès par nom logique). */
type TableColumns = Record<string, SQLiteColumn>;

/** Builder Drizzle exécutable ET introspectable (`toSQL()`) — cible du tap profiler. */
type ProfiledQuery<R> = PromiseLike<R> & { toSQL: () => { sql: string } };

/**
 * Relation résolue au boot de l'ORM, prête pour l'eager-load manuel (sans la
 * couche `relations()` de Drizzle, pour rester générique cross-entités).
 */
export interface DrizzleResolvedRelation {
  /** Cardinalité. */
  type: "one-to-many" | "many-to-one" | "one-to-one";
  /** Table cible Drizzle. */
  targetTable: SQLiteTable;
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
  readonly #table: SQLiteTable;
  readonly #relations: Record<string, DrizzleResolvedRelation>;
  /** Connecteur ORM (clé du registre) — tag des métriques de flux. */
  readonly #ormName: string;

  /**
   * @param db - handle Drizzle (instance racine ou transaction).
   * @param table - table Drizzle de l'entité.
   * @param relations - relations résolues (eager-load), indexées par champ.
   * @param ormName - nom du connecteur ORM (registre) — défaut `"default"`.
   */
  constructor(
    db: DrizzleDb,
    table: SQLiteTable,
    relations: Record<string, DrizzleResolvedRelation>,
    ormName = "default",
  ) {
    this.#db = db;
    this.#table = table;
    this.#relations = relations;
    this.#ormName = ormName;
  }

  /** Colonne Drizzle d'une table par nom logique. */
  #col(table: SQLiteTable, name: string): SQLiteColumn {
    return (table as unknown as TableColumns)[name];
  }

  /** Tronque + redacte un SQL paramétré pour l'affichage (jamais de valeur). */
  #safeSql(builder: ProfiledQuery<unknown>): string {
    let sql: string;
    try {
      sql = builder.toSQL().sql;
    } catch {
      sql = "<drizzle query>";
    }
    return redactSecrets(sql.length > 2000 ? `${sql.slice(0, 2000)}…` : sql);
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
      const sql =
        durationMs >= queryFlowMonitor.slowMs
          ? this.#safeSql(builder)
          : undefined;
      queryFlowMonitor.record(this.#ormName, durationMs, sql);
    }
    if (buf) {
      buf.push({
        sql: this.#safeSql(builder),
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
    col: SQLiteColumn,
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
    let query = this.#db.select().from(this.#table).$dynamic();
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
    // SQLite : OFFSET exige un LIMIT → `-1` = illimité quand seul l'offset est posé.
    if (options?.limit !== undefined) {
      query = query.limit(options.limit);
    } else if (options?.offset !== undefined) {
      query = query.limit(-1);
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
            .from(rel.targetTable)
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
                  .from(rel.targetTable)
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
    const rows = (await this.#prof(
      this.#db
        .insert(this.#table)
        .values(data as Record<string, unknown>)
        .returning() as unknown as ProfiledQuery<Record<string, unknown>[]>,
    )) as Record<string, unknown>[];
    return rows[0] as T;
  }

  async createMany(data: Partial<T>[]): Promise<T[]> {
    if (data.length === 0) {
      return []; // no-op : pas d'INSERT à 0 ligne (drizzle/SQL le rejetteraient).
    }
    const rows = (await this.#prof(
      this.#db
        .insert(this.#table)
        .values(data as Record<string, unknown>[])
        .returning() as unknown as ProfiledQuery<Record<string, unknown>[]>,
    )) as Record<string, unknown>[];
    return rows as T[];
  }

  async updateOne(criteria: Criteria<T>, data: Partial<T>): Promise<T | null> {
    // Atomique : UPDATE … WHERE rowid IN (SELECT rowid … LIMIT 1) RETURNING.
    // - une SEULE requête → pas de relecture (qui renverrait null à tort si le
    //   critère porte sur un champ modifié — bug B1) ;
    // - `rowid IN (… LIMIT 1)` garantit « au plus une » ligne SANS supposer une
    //   PK nommée `id` (tout table SQLite a un rowid) ;
    // - RETURNING rend la ligne réellement persistée.
    const where = this.#where(criteria);
    const pick = where
      ? sql`rowid in (select rowid from ${this.#table} where ${where} limit 1)`
      : sql`rowid in (select rowid from ${this.#table} limit 1)`;
    const rows = (await this.#prof(
      this.#db
        .update(this.#table)
        .set(data as Record<string, unknown>)
        .where(pick)
        .returning() as unknown as ProfiledQuery<Record<string, unknown>[]>,
    )) as Record<string, unknown>[];
    return (rows[0] as T) ?? null;
  }

  async upsert(
    criteria: Criteria<T>,
    update: Partial<T>,
    insertOnly?: Partial<T>,
  ): Promise<T> {
    // Une SEULE requête : INSERT … ON CONFLICT(<criteria>) DO UPDATE SET <update>
    // RETURNING. Remplace le findOne+(update|create) = 2 round-trips + une race
    // insert/update. `target` = colonnes de conflit (clé unique) ; `set` ne
    // ré-applique QUE `update` → les champs insert-only (ex. createdAt) ne sont
    // pas écrasés en cas de conflit. (SQLite/Postgres ; mysql = onDuplicateKeyUpdate
    // au portage multi-dialecte du repository.)
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
    const values = {
      ...(criteria as Record<string, unknown>),
      ...((insertOnly ?? {}) as Record<string, unknown>),
      ...(update as Record<string, unknown>),
    };
    const rows = (await this.#prof(
      this.#db
        .insert(this.#table)
        .values(values)
        .onConflictDoUpdate({
          target,
          set: update as Record<string, unknown>,
        })
        .returning() as unknown as ProfiledQuery<Record<string, unknown>[]>,
    )) as Record<string, unknown>[];
    return rows[0] as T;
  }

  async updateMany(criteria: Criteria<T>, data: Partial<T>): Promise<number> {
    const where = this.#where(criteria);
    const builder = this.#db
      .update(this.#table)
      .set(data as Record<string, unknown>);
    const result = (await this.#prof(
      (where ? builder.where(where) : builder) as unknown as ProfiledQuery<{
        changes?: number;
      }>,
    )) as { changes?: number };
    return result.changes ?? 0;
  }

  async increment(
    criteria: Criteria<T>,
    changes: Partial<Record<keyof T, number>>,
  ): Promise<T | null> {
    // Atomique : UPDATE … SET f = f + ? WHERE rowid IN (… LIMIT 1) RETURNING.
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
    const where = this.#where(criteria);
    const pick = where
      ? sql`rowid in (select rowid from ${this.#table} where ${where} limit 1)`
      : sql`rowid in (select rowid from ${this.#table} limit 1)`;
    const rows = (await this.#prof(
      this.#db
        .update(this.#table)
        .set(setObj)
        .where(pick)
        .returning() as unknown as ProfiledQuery<Record<string, unknown>[]>,
    )) as Record<string, unknown>[];
    return (rows[0] as T) ?? null;
  }

  async delete(criteria: Criteria<T>): Promise<number> {
    const where = this.#where(criteria);
    const builder = this.#db.delete(this.#table);
    const result = (await this.#prof(
      (where ? builder.where(where) : builder) as unknown as ProfiledQuery<{
        changes?: number;
      }>,
    )) as { changes?: number };
    return result.changes ?? 0;
  }

  async deleteOne(criteria: Criteria<T>): Promise<boolean> {
    const rows = await this.#deleteOneReturning(criteria);
    return rows.length > 0;
  }

  async findOneAndDelete(criteria: Criteria<T>): Promise<T | null> {
    const rows = await this.#deleteOneReturning(criteria);
    return (rows[0] as T) ?? null;
  }

  /** DELETE atomique d'AU PLUS une ligne (`rowid … LIMIT 1`), RETURNING la ligne. */
  async #deleteOneReturning(
    criteria: Criteria<T>,
  ): Promise<Record<string, unknown>[]> {
    const where = this.#where(criteria);
    const pick = where
      ? sql`rowid in (select rowid from ${this.#table} where ${where} limit 1)`
      : sql`rowid in (select rowid from ${this.#table} limit 1)`;
    return (await this.#prof(
      this.#db
        .delete(this.#table)
        .where(pick)
        .returning() as unknown as ProfiledQuery<Record<string, unknown>[]>,
    )) as Record<string, unknown>[];
  }

  async count(criteria?: Criteria<T>): Promise<number> {
    const where = this.#where(criteria);
    const builder = this.#db
      .select({ value: count() })
      .from(this.#table)
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
      .from(this.#table)
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
      this.#ormName,
    );
  }
}
