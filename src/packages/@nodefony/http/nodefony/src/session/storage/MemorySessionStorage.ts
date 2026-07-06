import type sessionService from "../../../service/sessions/sessions-service";
import type {
  ISessionStorage,
  ISerializedSession,
  ISessionRecord,
  ISessionListFilter,
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
}

export default MemorySessionStorage;
