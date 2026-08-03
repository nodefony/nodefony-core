import {
  SessionsService,
  SESSION_SORTABLE_FIELDS,
  SESSION_DEFAULT_ORDER,
  SESSION_COLUMN_ALIASES,
} from "@nodefony/http";
import type {
  ISessionStorage,
  ISerializedSession,
  ISessionRecord,
  ISessionListFilter,
  ISessionListQuery,
} from "@nodefony/http";
import type { IPage } from "nodefony";
import { assertPageQuery, pickOrder, renameOrderFields } from "nodefony";
import { ormRegistry, paginate } from "@nodefony/orm-core";
import type { IRepository, Criteria } from "@nodefony/orm-core";
import { SESSION_CONNECTOR, type SessionRow } from "../entity/sessionEntity";

/**
 * Stockage de session **Mongoose** (driver NoSQL), branché sur `@nodefony/orm-core`.
 *
 * Implémente le contrat {@link ISessionStorage} consommé par le `SessionsService`
 * de `@nodefony/http` — store de session portable. Persiste via le repository
 * orm-core de l'entité `session` (connecteur `nodefony`, modèle compilé au boot
 * par `MongooseOrm`). Logique **identique** au store Drizzle (timestamps en ms,
 * GC via l'opérateur riche portable `$lt`) — la portabilité du contrat orm-core.
 */
class SessionStorage implements ISessionStorage {
  manager: SessionsService;
  idleTimeoutS: number;
  absoluteTimeoutS: number;

  /**
   * Même vocabulaire public que les autres backends — le tri part dans le
   * `sort()` Mongo, où il ne coûte qu'un index.
   */
  readonly sortableFields = SESSION_SORTABLE_FIELDS;

  constructor(manager: SessionsService) {
    this.manager = manager;
    this.idleTimeoutS = manager.options.idleTimeoutS;
    this.absoluteTimeoutS = manager.options.absoluteTimeoutS;
  }

  /**
   * Repository de l'entité session, ou `null` si l'ORM n'est pas (ou plus)
   * connecté.
   *
   * Pendant le shutdown du kernel, `MongooseService` déconnecte l'ORM alors que
   * des requêtes peuvent encore être en vol (firewall → `startSession`). On
   * renvoie `null` et chaque opération dégrade gracieusement (session non
   * persistée le temps de l'arrêt) plutôt que de jeter (500 + `unhandledRejection`
   * via le GC fire-and-forget). Une table absente sur un ORM **connecté** (vraie
   * misconfig) jette toujours via `getRepository`.
   */
  #repo(): IRepository<SessionRow> | null {
    const orm = ormRegistry.get(SESSION_CONNECTOR);
    if (!orm.isConnected()) {
      return null;
    }
    return orm.getRepository<SessionRow>("session");
  }

  async read(id: string): Promise<ISerializedSession> {
    const criteria: Partial<SessionRow> = { session_id: id };
    const repo = this.#repo();
    if (!repo) {
      return {} as ISerializedSession;
    }
    const row = await repo.findOne(criteria);
    if (!row) {
      return {} as ISerializedSession;
    }
    return {
      Attributes: (row.Attributes ?? {}) as Record<string, unknown>,
      metaBag: (row.metaBag ?? {}) as Record<string, unknown>,
      flashBag: (row.flashBag ?? {}) as Record<string, unknown>,
      user: row.user ?? "",
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    };
  }

  async start(id: string): Promise<ISerializedSession> {
    return this.read(id);
  }

  async write(
    id: string,
    data: ISerializedSession,
  ): Promise<ISerializedSession> {
    const serialize = data;
    const now = Date.now();
    const repo = this.#repo();
    if (!repo) {
      // ORM indisponible (shutdown) — pas de persistance, on renvoie l'état courant.
      return {
        ...serialize,
        createdAt: new Date(now),
        updatedAt: new Date(now),
      };
    }
    const fields = {
      Attributes: serialize.Attributes,
      flashBag: serialize.flashBag,
      metaBag: serialize.metaBag,
      user: serialize.user || null,
      updatedAt: now,
    };
    // UPSERT atomique (`findOneAndUpdate({ upsert:true })`) : 1 round-trip, pas
    // de SELECT d'existence ni de race insert/update. `createdAt` = insert-only
    // → préservé sur une session existante, posé à `now` sur une neuve.
    const row = await repo.upsert(
      { session_id: id },
      fields as Partial<SessionRow>,
      { createdAt: now } as Partial<SessionRow>,
    );
    return {
      ...serialize,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(now),
    };
  }

  async open(): Promise<number> {
    await this.gc();
    const repo = this.#repo();
    if (!repo) {
      return 0;
    }
    const count = await repo.count();
    this.manager.log(
      `MONGOOSE SESSIONS STORAGE ==> COUNT SESSIONS : ${count}`,
      "INFO",
    );
    return count;
  }

  close(): boolean {
    void this.gc();
    return true;
  }

  async destroy(id: string): Promise<boolean> {
    const criteria: Partial<SessionRow> = { session_id: id };
    const repo = this.#repo();
    if (!repo) {
      return true;
    }
    await repo.delete(criteria);
    this.manager.log(`MONGOOSE DESTROY SESSION ID : ${id}`, "DEBUG");
    return true;
  }

  async gc(idleSeconds?: number, absoluteSeconds?: number): Promise<void> {
    const repo = this.#repo();
    if (!repo) {
      return;
    }
    const now = Date.now();
    // Borne idle : inactivité depuis `updatedAt` (rafraîchi par write/touch).
    const idleCutoff = now - (idleSeconds ?? this.idleTimeoutS) * 1000;
    let deleted = await repo.delete({
      updatedAt: { $lt: idleCutoff },
    } as Criteria<SessionRow>);
    // Borne absolute : âge depuis `createdAt`, JAMAIS prolongé (re-auth forcée).
    // Deux DELETE distincts (pas de `$or`) → parité avec le store Drizzle.
    const absoluteS = absoluteSeconds ?? this.absoluteTimeoutS;
    if (absoluteS > 0) {
      deleted += await repo.delete({
        createdAt: { $lt: now - absoluteS * 1000 },
      } as Criteria<SessionRow>);
    }
    if (deleted > 0) {
      this.manager.log(`MONGOOSE SESSIONS GC ==> ${deleted} DELETED`, "DEBUG");
    }
  }

  /**
   * Prolonge l'idle d'une session (timeout glissant) : `updateOne updatedAt = now`
   * sur `session_id` — SANS réécrire le blob (touch NIST/OWASP). N'affecte pas
   * `createdAt` (= borne absolute). ORM déconnecté → no-op ; ligne absente →
   * no-op silencieux. Parité avec le store Drizzle.
   */
  async touch(id: string): Promise<void> {
    const repo = this.#repo();
    if (!repo) {
      return;
    }
    await repo.updateOne({ session_id: id }, {
      updatedAt: Date.now(),
    } as Partial<SessionRow>);
  }

  /**
   * Énumération admin (capacité optionnelle d'`ISessionStorage`) — `find` projeté,
   * filtrable par `user`. **Redaction par construction** : seuls `user`/`metaBag`/
   * timestamps sortent de la base ; `Attributes`/`flashBag` (potentiellement
   * sensibles) restent en base. ORM déconnecté → `[]`. Strictement identique au
   * store Drizzle (parité du contrat orm-core).
   */
  async listAll(filter?: ISessionListFilter): Promise<ISessionRecord[]> {
    const repo = this.#repo();
    if (!repo) {
      return [];
    }
    const rows =
      filter?.user !== undefined
        ? await repo.find({ user: filter.user } as Partial<SessionRow>)
        : await repo.find();
    return rows.map((row) => SessionStorage.#toRecord(row));
  }

  /**
   * Projette un document en {@link ISessionRecord} **redacté** : `Attributes` et
   * `flashBag` restent en base, seuls `user`/`metaBag`/horodatages sortent. Une
   * session anonyme est stockée `user = null` (cf `write`) et ressort en chaîne
   * vide — la représentation du « pas d'utilisateur » appartient au backend.
   */
  static #toRecord(row: SessionRow): ISessionRecord {
    return {
      id: row.session_id,
      data: {
        Attributes: {},
        flashBag: {},
        metaBag: (row.metaBag ?? {}) as Record<string, unknown>,
        user: row.user ?? "",
        createdAt: new Date(row.createdAt),
        updatedAt: new Date(row.updatedAt),
      },
    };
  }

  /**
   * Traduit les filtres du contrat en `Criteria` orm-core — **portables** (égalité
   * + test de nullité), donc poussés dans le `find` Mongo et jamais ré-appliqués
   * en mémoire. Source unique du périmètre de {@link listPage} et
   * {@link countSessions}. `user` explicite l'emporte sur `authenticated` (un
   * critère AND-only ne porte qu'une condition par champ ; les combiner donnerait
   * de toute façon un ensemble vide ou redondant).
   */
  static #criteria(
    query?: ISessionListQuery,
  ): Criteria<SessionRow> | undefined {
    if (!query) return undefined;
    const criteria: Record<string, unknown> = {};
    if (query.user !== undefined) {
      // `write` normalise l'anonyme en `null` : filtrer sur "" ne trouverait rien.
      criteria.user = query.user === "" ? { $null: true } : query.user;
    }
    if (query.authenticated !== undefined && query.user === undefined) {
      criteria.user = { $null: !query.authenticated };
    }
    return Object.keys(criteria).length > 0
      ? (criteria as Criteria<SessionRow>)
      : undefined;
  }

  /**
   * Pagination **native** `skip/limit` + `countDocuments` (helper `paginate`
   * orm-core) : une page = une requête bornée, quel que soit le volume en base.
   * Ordre `updatedAt` DESC départagé par `session_id` — déterministe à horodatage
   * égal. ORM déconnecté → page vide. Parité stricte avec le store Drizzle.
   */
  async listPage(query: ISessionListQuery): Promise<IPage<ISessionRecord>> {
    assertPageQuery(query, "offset");
    const repo = this.#repo();
    if (!repo) {
      return {
        items: [],
        total: query.withTotal === false ? undefined : 0,
        limit: query.limit,
        offset: query.offset ?? 0,
        hasNext: false,
      };
    }
    const page = await paginate(repo, {
      criteria: SessionStorage.#criteria(query),
      limit: query.limit,
      offset: query.offset,
      withTotal: query.withTotal,
      // Borné à ce que ce store DÉCLARE, puis exprimé dans le schéma : le
      // vocabulaire de tri est PUBLIC (`id`), le champ stocké s'appelle
      // `session_id` → la traduction est ici, jamais dans l'URL. (La table
      // d'alias de la session prime : ce n'est pas `_id` qui porte l'identifiant
      // de session, donc pas `mongoOrder`.)
      order: renameOrderFields(
        pickOrder(query.order, this.sortableFields, SESSION_DEFAULT_ORDER),
        SESSION_COLUMN_ALIASES,
      ),
    });
    return {
      ...page,
      items: page.items.map((row) => SessionStorage.#toRecord(row)),
    };
  }

  /** `countDocuments` natif filtré — aucun document matérialisé. Déconnecté → 0. */
  async countSessions(query?: ISessionListQuery): Promise<number> {
    const repo = this.#repo();
    if (!repo) {
      return 0;
    }
    return repo.count(SessionStorage.#criteria(query));
  }
}

// Auto-enregistrement dans le registre de session de @nodefony/http (IoC) :
// http ne dépend pas de cet ORM, c'est l'ORM qui se déclare. SessionStorage
// implémente directement ISessionStorage (contrat unifié) → plus de cast.
SessionsService.registerStorage("mongoose", SessionStorage);

export default SessionStorage;
