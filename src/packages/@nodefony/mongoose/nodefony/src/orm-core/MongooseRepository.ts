import type { ClientSession, QueryFilter, Model } from "mongoose";
import { RequestContext, redactSecrets } from "nodefony";
import {
  isFieldOperators,
  isUpdateOperators,
  likePatternToRegExp,
  queryFlowMonitor,
  UnknownCriteriaField,
} from "@nodefony/orm-core";
import type {
  Criteria,
  FieldOperators,
  UpdateData,
  IRepository,
  ITransaction,
  RepositoryReadOptions,
} from "@nodefony/orm-core";

/** Modèle Mongoose à document libre (boundary — typé finement côté repo). */
type LooseModel = Model<Record<string, unknown>>;

// La traduction d'un motif `$like` en expression régulière vit au SOCLE
// (`likePatternToRegExp`) : elle DOIT rendre le même ensemble de lignes que le
// `LIKE … ESCAPE '\'` émis côté SQL, sinon changer de backend changerait les
// résultats. Elle était écrite ici, et elle ignorait l'échappement — un `a\_b`
// y devenait `a\.b`, c'est-à-dire un motif qui ne matche rien.

/**
 * Repository portable (contrat {@link IRepository}) au-dessus d'un modèle Mongoose.
 *
 * Démontre la portabilité du contrat sur un **store documentaire hétérogène** :
 * - `options.relations` → `populate()` (virtuels/refs déclarés), pas `include` ;
 * - **clé primaire `_id`** (MongoDB) ↔ `id` (contrat) : le critère `{ id }` est
 *   traduit en `{ _id }`, et la sortie (`toObject({ virtuals: true })`) porte le
 *   virtuel `id` (string hex de l'ObjectId) → contrat `id: string` respecté ;
 * - liaison transactionnelle via {@link MongooseRepository.withTransaction}
 *   (`{ session }` sur toutes les ops ; requiert un replica set).
 *
 * @typeParam T - forme plate de l'entité gérée.
 */
export class MongooseRepository<T = unknown> implements IRepository<T> {
  readonly #model: LooseModel;
  readonly #session: ClientSession | null;
  /** Connecteur ORM (clé du registre) — tag des métriques de flux. */
  readonly #connector: string;

  /**
   * @param model - modèle Mongoose compilé.
   * @param connector - nom de la connexion (clé du registre) — défaut `"nodefony"`.
   * @param session - session transactionnelle à laquelle lier les ops (ou `null`).
   */
  constructor(
    model: LooseModel,
    connector = "nodefony",
    session: ClientSession | null = null,
  ) {
    this.#model = model;
    this.#connector = connector;
    this.#session = session;
  }

  /**
   * Tap dev-only : mesure la durée d'une opération et alimente **deux** sondes
   * complémentaires (sans surcoût quand les deux sont inactives — flags lus avant
   * toute allocation, prod = coût nul) :
   *  1. **profiler par-requête** (buffer de scope ALS, debug bar) — descripteur
   *     de CHAQUE opération tracée ;
   *  2. **flux ORM agrégé** ({@link queryFlowMonitor}, process-wide) — débit +
   *     latence ; le descripteur n'est sérialisé que sur le chemin **lent** (rare).
   *
   * @param descr - fabrique du descripteur (collection.op + filtre redacté) —
   *   thunk : jamais évalué hors observation.
   * @param exec - exécution de l'opération.
   * @param rowsOf - extraction du nombre de documents (optionnel).
   */
  async #prof<R>(
    descr: () => string,
    exec: () => Promise<R>,
    rowsOf?: (r: R) => number | undefined,
  ): Promise<R> {
    const buf = RequestContext.get()?.queries;
    const flow = queryFlowMonitor.enabled;
    if (!buf && !flow) {
      return exec();
    }
    const start = performance.now();
    const result = await exec();
    const durationMs = performance.now() - start;
    if (flow) {
      const q = durationMs >= queryFlowMonitor.slowMs ? descr() : undefined;
      queryFlowMonitor.record(this.#connector, durationMs, q);
    }
    if (buf) {
      buf.push({
        sql: descr(),
        startMs: start,
        durationMs,
        rows: rowsOf?.(result),
        connector: "mongoose",
      });
    }
    return result;
  }

  /** Descripteur compact `Model.op {filtre}` (redacté + tronqué) pour les sondes. */
  #descr(op: string, filter?: unknown): string {
    const tail = filter !== undefined ? ` ${JSON.stringify(filter)}` : "";
    const s = `${this.#model.modelName}.${op}${tail}`;
    return redactSecrets(s.length > 2000 ? `${s.slice(0, 2000)}…` : s);
  }

  /**
   * Traduit les opérateurs riches portables en opérateurs MongoDB.
   *
   * Quasi-identité : `$gt`/`$in`/`$nin`/`$ne`/`$eq`/`$lt`... sont natifs Mongo ;
   * `$like` (motif SQL) devient `$regex`, et `$null` une comparaison à `null`
   * (`$eq`/`$ne`) — en Mongo `null` matche aussi le champ **absent**, ce qui est
   * bien l'équivalent du `NULL` SQL (colonne sans valeur).
   *
   * @throws Error si `$null` est combiné à `$eq`/`$ne` sur le même champ : les
   *   deux viseraient la même clé Mongo et l'une écraserait l'autre **en
   *   silence** (le contrat les déclare exclusifs — cf `FieldOperators.$null`).
   */
  #mongoOps(ops: FieldOperators<unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(ops)) {
      if (key === "$like") {
        out.$regex = likePatternToRegExp(value as string);
      } else if (key === "$null") {
        const target = value ? "$eq" : "$ne";
        if (target in out) {
          throw new Error(
            `criteria: $null ne se combine pas avec ${target} sur le même champ (${this.#model.modelName})`,
          );
        }
        out[target] = null;
      } else if ((key === "$eq" || key === "$ne") && key in out) {
        throw new Error(
          `criteria: $null ne se combine pas avec ${key} sur le même champ (${this.#model.modelName})`,
        );
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  /**
   * Valide qu'un champ de critère existe sur le schéma (strict B2, parité
   * Drizzle) et renvoie sa clé Mongo (`id` → `_id`, PK). Un champ inconnu lève
   * {@link UnknownCriteriaField} au lieu d'être passé tel quel à Mongo (qui
   * donnait 0 résultat silencieux — et divergeait de Drizzle qui, lui, renvoyait
   * tout). Échoue tôt et pareil sur les deux drivers.
   *
   * @param field - clé brute du critère.
   * @returns la clé Mongo résolue.
   * @throws UnknownCriteriaField si le champ n'existe pas sur le schéma.
   */
  #resolveField(field: string): string {
    const key = field === "id" ? "_id" : field;
    const paths = this.#model.schema.paths as Record<string, unknown>;
    // `_id` toujours valide ; chemin direct ; ou chemin imbriqué (`a.b` → racine `a`).
    if (
      key === "_id" ||
      paths[key] !== undefined ||
      paths[key.split(".")[0]] !== undefined
    ) {
      return key;
    }
    throw new UnknownCriteriaField(
      field,
      this.#model.modelName,
      Object.keys(paths),
    );
  }

  /**
   * Traduit le critère portable : `id` → `_id` (PK MongoDB) + opérateurs riches.
   * Chaque champ est validé contre le schéma (strict, cf {@link MongooseRepository.#resolveField}).
   */
  #filter(criteria?: Criteria<T>): QueryFilter<Record<string, unknown>> {
    if (!criteria) {
      return {};
    }
    const out: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(criteria)) {
      // Disjonction : chaque branche est un critère complet, traduit par la même
      // fonction (donc `id`→`_id` et les opérateurs riches y valent aussi). Une
      // branche vide serait toujours vraie ; un `$or` sans branche ne pose rien.
      if (field === "$or") {
        if (!Array.isArray(value)) {
          throw new TypeError(
            `MongooseRepository(${this.#model.modelName}): $or attend un tableau de critères.`,
          );
        }
        const branches = value
          .map((branch) => this.#filter(branch as Criteria<T>))
          .filter((f) => Object.keys(f).length > 0);
        if (branches.length > 0) out.$or = branches;
        continue;
      }
      const key = this.#resolveField(field);
      out[key] = isFieldOperators(value) ? this.#mongoOps(value) : value;
    }
    return out as QueryFilter<Record<string, unknown>>;
  }

  /** Sérialise un document en objet plat (virtuels inclus → `id`, populates). */
  #plain(doc: { toObject: (o: { virtuals: boolean }) => unknown }): T {
    return doc.toObject({ virtuals: true }) as T;
  }

  async find(
    criteria?: Criteria<T>,
    options?: RepositoryReadOptions,
  ): Promise<T[]> {
    const filter = this.#filter(criteria);
    return this.#prof(
      () => this.#descr("find", filter),
      async () => {
        let query = this.#model.find(filter);
        if (this.#session) {
          query = query.session(this.#session);
        }
        if (options?.relations?.length) {
          query = query.populate(options.relations);
        }
        if (options?.offset !== undefined) {
          query = query.skip(options.offset);
        }
        if (options?.limit !== undefined) {
          query = query.limit(options.limit);
        }
        if (options?.order?.length) {
          query = query.sort(
            Object.fromEntries(
              options.order.map(([field, dir]) => [
                field,
                dir === "DESC" ? -1 : 1,
              ]),
            ),
          );
        }
        const docs = await query.exec();
        return docs.map((doc) => this.#plain(doc));
      },
      (docs) => docs.length,
    );
  }

  async findOne(
    criteria: Criteria<T>,
    options?: RepositoryReadOptions,
  ): Promise<T | null> {
    const filter = this.#filter(criteria);
    return this.#prof(
      () => this.#descr("findOne", filter),
      async () => {
        let query = this.#model.findOne(filter);
        if (this.#session) {
          query = query.session(this.#session);
        }
        if (options?.relations?.length) {
          query = query.populate(options.relations);
        }
        const doc = await query.exec();
        return doc ? this.#plain(doc) : null;
      },
      (doc) => (doc ? 1 : 0),
    );
  }

  async create(data: Partial<T>): Promise<T> {
    return this.#prof(
      () => this.#descr("create"),
      async () => {
        const [doc] = await this.#model.create(
          [data as Record<string, unknown>],
          { session: this.#session ?? undefined },
        );
        return this.#plain(doc);
      },
      () => 1,
    );
  }

  async createMany(data: Partial<T>[]): Promise<T[]> {
    if (data.length === 0) {
      return [];
    }
    return this.#prof(
      () => this.#descr("insertMany"),
      async () => {
        const docs = await this.#model.insertMany(
          data as Record<string, unknown>[],
          { session: this.#session ?? undefined },
        );
        return docs.map((doc) => this.#plain(doc));
      },
      (rows) => rows.length,
    );
  }

  async updateOne(criteria: Criteria<T>, data: Partial<T>): Promise<T | null> {
    const filter = this.#filter(criteria);
    // Atomique : `findOneAndUpdate({ new: true })` → 1 round-trip, retourne le
    // document RÉELLEMENT modifié (pas de relecture séparée qui renverrait null
    // à tort si le critère portait sur un champ modifié — bug B1).
    return this.#prof(
      () => this.#descr("findOneAndUpdate", filter),
      async () => {
        const doc = await this.#model
          .findOneAndUpdate(filter, data as Record<string, unknown>, {
            // `returnDocument: "after"` = renvoie le doc APRÈS modif (forme non
            // dépréciée de l'ancien `new: true` — Mongoose 9).
            returnDocument: "after",
            session: this.#session ?? undefined,
          })
          .exec();
        return doc ? this.#plain(doc) : null;
      },
      (doc) => (doc ? 1 : 0),
    );
  }

  async upsert(
    criteria: Criteria<T>,
    update: UpdateData<T>,
    insertOnly?: Partial<T>,
  ): Promise<T> {
    const filter = this.#filter(criteria);
    // Atomique : `findOneAndUpdate({ upsert:true })` → 1 round-trip. `update`
    // est ré-appliqué (insert + conflit) via `$set`, ou via `$max`/`$min` quand
    // le champ porte un opérateur d'écriture (cf `#writeDoc`) ; `$setOnInsert`
    // pose `insertOnly` (ex. createdAt) QU'À la création. Les égalités de
    // `filter` (clé) sont ajoutées au document inséré par MongoDB → inutile de
    // les répéter.
    return this.#prof(
      () => this.#descr("findOneAndUpdate", filter),
      async () => {
        const doc = await this.#model
          .findOneAndUpdate(
            filter,
            {
              ...this.#writeDoc(update),
              $setOnInsert: (insertOnly ?? {}) as Record<string, unknown>,
            },
            {
              upsert: true,
              returnDocument: "after",
              session: this.#session ?? undefined,
            },
          )
          .exec();
        if (!doc) {
          // upsert:true + returnDocument:after garantit un document ; garde de
          // typage (le contrat renvoie T non-nullable).
          throw new Error("MongooseRepository.upsert: aucun document retourné");
        }
        return this.#plain(doc);
      },
      () => 1,
    );
  }

  /**
   * Traduit le `update` d'un upsert en document de mise à jour Mongo : les
   * valeurs nues vont dans `$set`, les {@link UpdateOperators} dans l'opérateur
   * natif de même nom (`$max`/`$min`).
   *
   * Mongo fait exactement ce qu'on attend : il n'écrit que si la valeur proposée
   * est supérieure (resp. inférieure) à celle en base, et la pose telle quelle à
   * l'insertion — donc pas de `$setOnInsert` à doubler. Pendant exact du
   * `GREATEST(col, ?)` des adapters SQL.
   */
  #writeDoc(update: UpdateData<T>): Record<string, Record<string, unknown>> {
    const $set: Record<string, unknown> = {};
    const ops: Record<string, Record<string, unknown>> = {};
    for (const [field, value] of Object.entries(update)) {
      if (!isUpdateOperators(value)) {
        $set[this.#resolveField(field)] = value;
        continue;
      }
      const key = this.#resolveField(field);
      if (value.$max !== undefined) {
        (ops.$max ??= {})[key] = value.$max;
      }
      if (value.$min !== undefined) {
        (ops.$min ??= {})[key] = value.$min;
      }
    }
    // `$set: {}` est refusé par Mongo → ne l'émettre que s'il porte un champ.
    return Object.keys($set).length > 0 ? { $set, ...ops } : ops;
  }

  async updateMany(criteria: Criteria<T>, data: Partial<T>): Promise<number> {
    const filter = this.#filter(criteria);
    return this.#prof(
      () => this.#descr("updateMany", filter),
      async () => {
        const res = await this.#model.updateMany(
          filter,
          data as Record<string, unknown>,
          { session: this.#session ?? undefined },
        );
        return res.modifiedCount ?? 0;
      },
      (n) => n,
    );
  }

  async increment(
    criteria: Criteria<T>,
    changes: Partial<Record<keyof T, number>>,
  ): Promise<T | null> {
    const filter = this.#filter(criteria);
    // Atomique : `findOneAndUpdate({ $inc })` → 1 round-trip, delta côté serveur
    // (pas de read-modify-write, donc pas de race sur le compteur).
    return this.#prof(
      () => this.#descr("findOneAndUpdate", filter),
      async () => {
        const doc = await this.#model
          .findOneAndUpdate(
            filter,
            { $inc: changes as Record<string, number> },
            { returnDocument: "after", session: this.#session ?? undefined },
          )
          .exec();
        return doc ? this.#plain(doc) : null;
      },
      (doc) => (doc ? 1 : 0),
    );
  }

  async delete(criteria: Criteria<T>): Promise<number> {
    const filter = this.#filter(criteria);
    return this.#prof(
      () => this.#descr("deleteMany", filter),
      async () => {
        const res = await this.#model.deleteMany(filter, {
          session: this.#session ?? undefined,
        });
        return res.deletedCount ?? 0;
      },
      (n) => n,
    );
  }

  async deleteOne(criteria: Criteria<T>): Promise<boolean> {
    const filter = this.#filter(criteria);
    return this.#prof(
      () => this.#descr("deleteOne", filter),
      async () => {
        const res = await this.#model.deleteOne(filter, {
          session: this.#session ?? undefined,
        });
        return (res.deletedCount ?? 0) > 0;
      },
      (ok) => (ok ? 1 : 0),
    );
  }

  async findOneAndDelete(criteria: Criteria<T>): Promise<T | null> {
    const filter = this.#filter(criteria);
    return this.#prof(
      () => this.#descr("findOneAndDelete", filter),
      async () => {
        const doc = await this.#model
          .findOneAndDelete(filter, { session: this.#session ?? undefined })
          .exec();
        return doc ? this.#plain(doc) : null;
      },
      (doc) => (doc ? 1 : 0),
    );
  }

  async count(criteria?: Criteria<T>): Promise<number> {
    const filter = this.#filter(criteria);
    return this.#prof(
      () => this.#descr("countDocuments", filter),
      () =>
        this.#model.countDocuments(filter, {
          session: this.#session ?? undefined,
        }),
    );
  }

  /**
   * `COUNT(DISTINCT …)` en agrégation — `$group` puis `$count`, donc la
   * déduplication reste dans le serveur. `Model.distinct()` aurait rapatrié
   * toutes les valeurs pour n'en mesurer que la longueur.
   *
   * `{$ne: null}` écarte à la fois la valeur nulle et le champ absent, ce qui
   * aligne le résultat sur le `COUNT(DISTINCT col)` SQL — sans lui, les
   * documents sans valeur formeraient un groupe `null` compté comme une valeur.
   */
  async countDistinct(
    field: keyof T & string,
    criteria?: Criteria<T>,
  ): Promise<number> {
    const filter = this.#filter(criteria);
    const path = this.#resolveField(field);
    return this.#prof(
      () => this.#descr("countDistinct", filter),
      async () => {
        // DEUX `$match` successifs, jamais un objet fusionné : le critère peut
        // déjà porter une condition sur CE champ (`countDistinct("user", {user:
        // "alice"})`), et `{...filter, [path]: …}` l'écraserait en silence — on
        // compterait alors tous les utilisateurs au lieu du seul demandé. Deux
        // étages se composent en ET sans se marcher dessus.
        const pipeline = [
          { $match: filter },
          { $match: { [path]: { $ne: null } } },
          { $group: { _id: `$${path}` } },
          { $count: "n" },
        ];
        const agg = this.#model.aggregate<{ n: number }>(pipeline);
        if (this.#session) {
          agg.session(this.#session);
        }
        const rows = await agg.exec();
        return rows[0]?.n ?? 0;
      },
    );
  }

  async exists(criteria: Criteria<T>): Promise<boolean> {
    const filter = this.#filter(criteria);
    return this.#prof(
      () => this.#descr("exists", filter),
      async () => {
        const q = this.#model.exists(filter);
        if (this.#session) {
          q.session(this.#session);
        }
        const doc = await q.exec();
        return doc !== null;
      },
    );
  }

  withTransaction(tx: ITransaction): IRepository<T> {
    return new MongooseRepository<T>(
      this.#model,
      this.#connector,
      tx.getNative<ClientSession>(),
    );
  }
}
