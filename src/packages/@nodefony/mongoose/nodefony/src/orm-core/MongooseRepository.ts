import type { ClientSession, QueryFilter, Model } from "mongoose";
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

/** Modèle Mongoose à document libre (boundary — typé finement côté repo). */
type LooseModel = Model<Record<string, unknown>>;

/**
 * Traduit un motif SQL `LIKE` (`%` = n caractères, `_` = un caractère) en RegExp
 * ancrée — `$like` portable n'a pas d'équivalent natif MongoDB.
 */
function sqlLikeToRegex(pattern: string): RegExp {
  // 1) échappe les méta-caractères regex, 2) traduit les jokers SQL.
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/%/g, ".*").replace(/_/g, ".")}$`);
}

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
  readonly #ormName: string;

  /**
   * @param model - modèle Mongoose compilé.
   * @param ormName - nom du connecteur ORM (registre) — défaut `"nodefony"`.
   * @param session - session transactionnelle à laquelle lier les ops (ou `null`).
   */
  constructor(
    model: LooseModel,
    ormName = "nodefony",
    session: ClientSession | null = null,
  ) {
    this.#model = model;
    this.#ormName = ormName;
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
      queryFlowMonitor.record(this.#ormName, durationMs, q);
    }
    if (buf) {
      buf.push({
        sql: descr(),
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
   * seul `$like` (motif SQL) est converti en `$regex`.
   */
  #mongoOps(ops: FieldOperators<unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(ops)) {
      if (key === "$like") {
        out.$regex = sqlLikeToRegex(value as string);
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

  withTransaction(tx: ITransaction): IRepository<T> {
    return new MongooseRepository<T>(
      this.#model,
      this.#ormName,
      tx.getNative<ClientSession>(),
    );
  }
}
