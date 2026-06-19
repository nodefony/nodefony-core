import { SessionsService } from "@nodefony/http";
import type { ISessionStorage, ISerializedSession } from "@nodefony/http";
import { ormRegistry } from "@nodefony/orm-core";
import type { IRepository } from "@nodefony/orm-core";
import { SESSION_ORM, type SessionRow } from "../entity/sessionEntity";

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
  gc_maxlifetime: number;

  constructor(manager: SessionsService) {
    this.manager = manager;
    this.gc_maxlifetime = manager.options.gc_maxlifetime;
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
    const orm = ormRegistry.get(SESSION_ORM);
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
    const existing = await repo.findOne({ session_id: id });
    if (existing) {
      await repo.updateOne({ session_id: id }, fields as Partial<SessionRow>);
    } else {
      await repo.create({
        session_id: id,
        createdAt: now,
        ...fields,
      } as Partial<SessionRow>);
    }
    return {
      ...serialize,
      createdAt: new Date(existing?.createdAt ?? now),
      updatedAt: new Date(now),
    };
  }

  async open(): Promise<number> {
    await this.gc(this.gc_maxlifetime);
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
    void this.gc(this.gc_maxlifetime);
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

  async gc(maxlifetime?: number): Promise<void> {
    const cutoff = Date.now() - (maxlifetime || this.gc_maxlifetime) * 1000;
    const criteria: Record<string, unknown> = { updatedAt: { $lt: cutoff } };
    const repo = this.#repo();
    if (!repo) {
      return;
    }
    const deleted = await repo.delete(criteria as Partial<SessionRow>);
    if (deleted > 0) {
      this.manager.log(`MONGOOSE SESSIONS GC ==> ${deleted} DELETED`, "DEBUG");
    }
  }
}

// Auto-enregistrement dans le registre de session de @nodefony/http (IoC) :
// http ne dépend pas de cet ORM, c'est l'ORM qui se déclare. SessionStorage
// implémente directement ISessionStorage (contrat unifié) → plus de cast.
SessionsService.registerStorage("mongoose", SessionStorage);

export default SessionStorage;
