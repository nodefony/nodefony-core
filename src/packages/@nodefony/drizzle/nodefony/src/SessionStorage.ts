import {
  SessionsService,
  SESSION_SORTABLE_FIELDS,
  SESSION_DEFAULT_ORDER_SQL,
  translateSessionOrder,
} from "@nodefony/http";
import type {
  ISessionStorage,
  ISerializedSession,
  ISessionRecord,
  ISessionListFilter,
  ISessionListQuery,
} from "@nodefony/http";
import type { IPage } from "nodefony";
import { assertPageQuery } from "nodefony";
import { ormRegistry, paginate } from "@nodefony/orm-core";
import type { IRepository, Criteria } from "@nodefony/orm-core";
import { SESSION_CONNECTOR, type SessionRow } from "../entity/sessionEntity";

/**
 * Stockage de session **Drizzle** (driver `better-sqlite3`), branché sur
 * `@nodefony/orm-core`.
 *
 * Implémente le contrat {@link ISessionStorage} consommé par le `SessionsService`
 * de `@nodefony/http` — store de session portable. Persiste via
 * le repository orm-core de l'entité `session` (connecteur `default`, table créée
 * au boot par `DrizzleOrm`). Le GC supprime les sessions expirées avec un
 * opérateur riche portable (`updatedAt < cutoff`).
 */
class SessionStorage implements ISessionStorage {
  manager: SessionsService;
  idleTimeoutS: number;
  absoluteTimeoutS: number;

  /**
   * Même vocabulaire public que les autres backends — le tri part dans le
   * `ORDER BY`, donc il ne coûte rien de plus qu'un index bien posé.
   */
  readonly sortableFields = SESSION_SORTABLE_FIELDS;

  constructor(manager: SessionsService) {
    this.manager = manager;
    this.idleTimeoutS = manager.options.idleTimeoutS;
    this.absoluteTimeoutS = manager.options.absoluteTimeoutS;
  }

  /**
   * Emplacement physique de la base (fichier SQLite) pour l'écran Studio « Stores »
   * — lu par `readStoreLocation` du core au boot de `SessionsService`. Résolu
   * **lazy** depuis l'ORM du connecteur session (comme {@link SessionStorage.#repo}) :
   * `undefined` si l'ORM n'est pas encore enregistré, en `:memory:`, ou réseau
   * (postgres/mysql → l'emplacement EST l'infra déclarée, surfacée à part). Lecture
   * DÉFENSIVE (getter `location` optionnel) — l'ORM base `IOrm` ne l'expose pas.
   */
  get location(): string | undefined {
    if (!ormRegistry.has(SESSION_CONNECTOR)) {
      return undefined;
    }
    const loc = (ormRegistry.get(SESSION_CONNECTOR) as { location?: unknown })
      .location;
    return typeof loc === "string" && loc.length > 0 ? loc : undefined;
  }

  /**
   * Repository de l'entité session, ou `null` si l'ORM n'est pas (ou plus)
   * connecté.
   *
   * Cas concret : pendant le shutdown du kernel, `DrizzleService` déconnecte
   * l'ORM (`disconnect()` annule ses tables) alors que des requêtes peuvent
   * encore être en vol (firewall → `startSession`). Plutôt que de jeter
   * « no entity table registered under session » (qui devenait un 500 sur ces
   * requêtes + un `unhandledRejection` via le GC fire-and-forget), on renvoie
   * `null` et chaque opération dégrade gracieusement (session non persistée le
   * temps de l'arrêt). Une table réellement absente sur un ORM **connecté**
   * (vraie misconfig) jette toujours via `getRepository`.
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
    // UPSERT atomique (INSERT … ON CONFLICT DO UPDATE … RETURNING) : 1 requête,
    // pas de SELECT d'existence (qui doublonnait la lecture déjà faite à la
    // reprise) ni de race insert/update. `createdAt` = insert-only → préservé sur
    // une session existante, posé à `now` sur une neuve ; la ligne RETURNING en
    // donne la vraie valeur.
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
      `DRIZZLE SESSIONS STORAGE ==> COUNT SESSIONS : ${count}`,
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
    this.manager.log(`DRIZZLE DESTROY SESSION ID : ${id}`, "DEBUG");
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
    // Deux DELETE distincts (pas de `$or`) → portable sur tout adapter orm-core.
    const absoluteS = absoluteSeconds ?? this.absoluteTimeoutS;
    if (absoluteS > 0) {
      deleted += await repo.delete({
        createdAt: { $lt: now - absoluteS * 1000 },
      } as Criteria<SessionRow>);
    }
    if (deleted > 0) {
      this.manager.log(`DRIZZLE SESSIONS GC ==> ${deleted} DELETED`, "DEBUG");
    }
  }

  /**
   * Prolonge l'idle d'une session (timeout glissant) : `UPDATE updatedAt = now`
   * sur la PK `session_id` — SANS réécrire le blob (touch NIST/OWASP). N'affecte
   * pas `createdAt` (= borne absolute). ORM déconnecté → no-op ; une ligne absente
   * (session expirée) → 0 row affectée, silencieux.
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
   * Énumération admin (capacité optionnelle d'`ISessionStorage`) : un `SELECT`
   * filtrable par `user` (WHERE indexable côté SQL). **Redaction par construction**
   * — seuls `user`/`metaBag`/timestamps sortent de la base ; `Attributes`/`flashBag`
   * (potentiellement sensibles) restent en base. ORM déconnecté → `[]`.
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
   * Projette une ligne SQL en {@link ISessionRecord} **redacté** : `Attributes` et
   * `flashBag` (potentiellement sensibles) restent en base, seuls `user`/`metaBag`/
   * horodatages sortent. Une session anonyme est stockée `user = NULL` (cf `write`)
   * et ressort en chaîne vide — la représentation du « pas d'utilisateur » est une
   * affaire de backend, jamais du contrat.
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
   * + `IS [NOT] NULL`), donc indexables par le SQL et jamais ré-appliqués en
   * mémoire. Source unique du périmètre : {@link listPage} et
   * {@link countSessions} le partagent, ils ne peuvent pas diverger. `user`
   * explicite l'emporte sur `authenticated` (un critère AND-only ne porte qu'une
   * condition par champ ; les combiner donnerait un ensemble vide ou redondant).
   */
  static #criteria(
    query?: ISessionListQuery,
  ): Criteria<SessionRow> | undefined {
    if (!query) return undefined;
    const criteria: Record<string, unknown> = {};
    if (query.user !== undefined) {
      // `write` normalise l'anonyme en NULL : filtrer sur "" ne trouverait rien.
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
   * Pagination **native** `LIMIT/OFFSET` + `COUNT` (helper `paginate` orm-core) :
   * une page = une requête bornée, quel que soit le nombre de sessions en base.
   * Ordre `updatedAt` DESC départagé par `session_id` — déterministe même quand
   * deux sessions partagent la milliseconde. ORM déconnecté → page vide.
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
      // Le vocabulaire de tri est PUBLIC (`id`), le schéma nomme la colonne
      // `session_id` → traduction chez le store, jamais dans l'URL.
      order: query.order?.length
        ? translateSessionOrder(query.order)
        : SESSION_DEFAULT_ORDER_SQL,
    });
    return {
      ...page,
      items: page.items.map((row) => SessionStorage.#toRecord(row)),
    };
  }

  /** `COUNT(*)` natif filtré — aucune ligne matérialisée. ORM déconnecté → 0. */
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
SessionsService.registerStorage("drizzle", SessionStorage);

export default SessionStorage;
