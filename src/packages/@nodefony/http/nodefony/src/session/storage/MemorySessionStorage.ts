import { assertPageQuery, compareByOrder, pickOrder } from "nodefony";
import type { IPage } from "nodefony";
import { SESSION_DEFAULT_ORDER, SESSION_SORTABLE_FIELDS } from "./sessionSort";
import type sessionService from "../../../service/sessions/sessions-service";
import type {
  ISessionStorage,
  ISerializedSession,
  ISessionRecord,
  ISessionListFilter,
  ISessionListQuery,
} from "../../../interfaces/ISession";

/**
 * Store de sessions **en mémoire** (Map process) — implémentation de référence
 * d'{@link ISessionStorage}, pendant `session` des `Memory*Store` de sécurité.
 *
 * **Volatil** : les sessions vivent dans la RAM du process et disparaissent au
 * redémarrage ET ne sont PAS partagées entre pods/workers. Cible : **tests de
 * charge** (mesurer le framework sans le goulot disque/SQL), CI, environnements
 * éphémères. Pour la persistance mono-nœud → `drizzle` (sqlite) ; multi-nœud →
 * `redis`/`drizzle`/`mongoose`.
 *
 * Bornes NIST/OWASP portées par des horodatages internes : `updatedAt` = dernière
 * activité (idle, rafraîchi par {@link touch}), `createdAt` = création (absolute,
 * JAMAIS prolongé). Même sémantique que les stores SQL — l'idle glissant et
 * l'absolute s'appliquent identiquement.
 */
class MemorySessionStorage implements ISessionStorage {
  manager: sessionService;
  idleTimeoutS: number;
  absoluteTimeoutS: number;
  /** id → session sérialisée (source de vérité, horodatages inclus). */
  readonly #sessions = new Map<string, ISerializedSession>();

  /**
   * Trie sur tout le vocabulaire public : les données sont déjà en RAM, aucun
   * champ n'est plus coûteux qu'un autre. Aucune traduction — les clés internes
   * portent déjà ces noms (`id` étant la clé de la Map).
   */
  readonly sortableFields = SESSION_SORTABLE_FIELDS;

  constructor(manager: sessionService) {
    this.manager = manager;
    this.idleTimeoutS = manager.options.idleTimeoutS;
    this.absoluteTimeoutS = manager.options.absoluteTimeoutS;
  }

  /** Lecture par id — copie superficielle (le consommateur ne mute pas le store). */
  read(id: string): Promise<ISerializedSession> {
    const stored = this.#sessions.get(id);
    return Promise.resolve(stored ? { ...stored } : ({} as ISerializedSession));
  }

  start(id: string): Promise<ISerializedSession> {
    return this.read(id);
  }

  /**
   * Écrit (upsert) le blob. `createdAt` est FIXÉ à la création et préservé aux
   * updates (borne absolute) ; `updatedAt` est posé à chaque écriture (borne idle).
   */
  write(id: string, data: ISerializedSession): Promise<ISerializedSession> {
    const now = new Date();
    const existing = this.#sessions.get(id);
    const record: ISerializedSession = {
      ...data,
      createdAt: existing?.createdAt ?? data.createdAt ?? now,
      updatedAt: now,
    };
    this.#sessions.set(id, record);
    return Promise.resolve(data);
  }

  /** Compte des sessions présentes (+ passe GC comme les autres stores à l'open). */
  async open(): Promise<number> {
    await this.gc();
    this.manager.log(
      `SESSIONS STORAGE ==> ${this.manager.options.store.toUpperCase()} COUNT SESSIONS : ${this.#sessions.size}`,
    );
    return this.#sessions.size;
  }

  close(): boolean {
    return true;
  }

  destroy(id: string): Promise<boolean> {
    this.#sessions.delete(id);
    return Promise.resolve(true);
  }

  /**
   * Prolonge l'idle (timeout glissant) : rafraîchit `updatedAt` SANS toucher
   * `createdAt` (borne absolute intacte). Session absente (purgée) → no-op.
   */
  touch(id: string): Promise<void> {
    const stored = this.#sessions.get(id);
    if (stored) {
      stored.updatedAt = new Date();
    }
    return Promise.resolve();
  }

  /**
   * Purge idle (inactivité depuis `updatedAt`) ET absolute (âge depuis `createdAt`,
   * jamais prolongé). Une borne à 0 = désactivée. Déterministe (synchrone).
   */
  gc(idleSeconds?: number, absoluteSeconds?: number): Promise<void> {
    const idleMs = (idleSeconds ?? this.idleTimeoutS) * 1000;
    const absoluteMs = (absoluteSeconds ?? this.absoluteTimeoutS) * 1000;
    const now = Date.now();
    let deleted = 0;
    for (const [id, s] of this.#sessions) {
      const updated = s.updatedAt ? s.updatedAt.getTime() : now;
      const created = s.createdAt ? s.createdAt.getTime() : now;
      const idleExpired = idleMs > 0 && updated + idleMs < now;
      const absoluteExpired = absoluteMs > 0 && created + absoluteMs < now;
      if (idleExpired || absoluteExpired) {
        this.#sessions.delete(id);
        deleted++;
      }
    }
    if (deleted > 0) {
      this.manager.log(
        `MEMORY SESSIONS STORAGE GARBAGE COLLECTOR ==> ${deleted} DELETED`,
      );
    }
    return Promise.resolve();
  }

  /** Énumération admin — filtre `user` appliqué en mémoire. */
  listAll(filter?: ISessionListFilter): Promise<ISessionRecord[]> {
    const records: ISessionRecord[] = [];
    for (const [id, data] of this.#sessions) {
      if (filter?.user !== undefined && data.user !== filter.user) {
        continue;
      }
      records.push({ id, data: { ...data } });
    }
    return Promise.resolve(records);
  }

  /**
   * `true` si l'entrée passe les filtres — prédicat partagé par {@link listPage}
   * et {@link countSessions} (une seule définition du périmètre : compter et
   * lister ne peuvent pas diverger).
   */
  #matches(
    data: ISerializedSession,
    query?: Partial<ISessionListQuery>,
  ): boolean {
    if (!query) return true;
    if (query.user !== undefined && data.user !== query.user) return false;
    if (query.authenticated !== undefined) {
      const authenticated = !!data.user;
      if (authenticated !== query.authenticated) return false;
    }
    return true;
  }

  /**
   * Pagination **offset** avec `total` exact, ordre `updatedAt` DESC (id ASC en
   * départage). Les données étant déjà en RAM par conception, le coût par requête
   * est celui du tri des **références** filtrées — aucune copie de blob n'est
   * faite hors de la page rendue.
   *
   * **Redaction par construction** (garantie du contrat, pas une optimisation) :
   * `Attributes`/`flashBag` sortent VIDES, comme chez les stores SQL/NoSQL qui ne
   * les SELECTent pas. Ici c'est gratuit — on ne recopie simplement pas ces deux
   * bags — et ça aligne le store mémoire sur la même garantie : un record
   * d'énumération admin ne porte jamais de donnée métier.
   */
  listPage(query: ISessionListQuery): Promise<IPage<ISessionRecord>> {
    assertPageQuery(query, "offset");
    const limit = Math.max(0, query.limit);
    const offset = Math.max(0, query.offset ?? 0);
    // Références seulement (pas de clone) — on ne copie que la page finale.
    const matched: Array<[string, ISerializedSession]> = [];
    for (const entry of this.#sessions) {
      if (this.#matches(entry[1], query)) matched.push(entry);
    }
    // Tri PARAMÉTRÉ par le contrat, via le comparateur partagé du core — le même
    // vocabulaire public (`updatedAt`, `id`) que les stores SQL/Mongo, pour que
    // le tri d'une console ne change pas de sens avec le backend configuré. À
    // défaut d'`order`, l'ordre contractuel des sessions.
    // `pickOrder` borne à ce que ce store DÉCLARE : sans lui, un appelant
    // interne trierait ici sur un champ que les backends SQL refusent, et le
    // contrat partagé décrirait deux comportements au lieu d'un.
    const order = pickOrder(
      query.order,
      this.sortableFields,
      SESSION_DEFAULT_ORDER,
    );
    matched.sort(
      compareByOrder(order, ([id, data], field) =>
        field === "id" ? id : data[field as keyof ISerializedSession],
      ),
    );
    const items = matched.slice(offset, offset + limit).map(([id, data]) => ({
      id,
      data: {
        ...data,
        Attributes: {},
        flashBag: {},
      },
    }));
    return Promise.resolve({
      items,
      total: query.withTotal === false ? undefined : matched.length,
      limit: query.limit,
      offset,
      hasNext: offset + items.length < matched.length,
    });
  }

  /** `COUNT` filtré — parcourt sans allouer (aucun record matérialisé). */
  countSessions(query?: Partial<ISessionListQuery>): Promise<number> {
    let count = 0;
    for (const data of this.#sessions.values()) {
      if (this.#matches(data, query)) count++;
    }
    return Promise.resolve(count);
  }

  /**
   * `COUNT(DISTINCT user)` en mémoire. Le `Set` est alloué à l'appel et relâché
   * aussitôt : c'est un chemin d'administration, appelé à l'ouverture d'un
   * écran, jamais dans le pipeline de requête.
   */
  countDistinctUsers(query?: Partial<ISessionListQuery>): Promise<number> {
    const users = new Set<string>();
    for (const data of this.#sessions.values()) {
      if (!this.#matches(data, query)) continue;
      if (typeof data.user === "string" && data.user) users.add(data.user);
    }
    return Promise.resolve(users.size);
  }
}

export default MemorySessionStorage;
