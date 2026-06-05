import { SessionsService } from "@nodefony/http";
import type { ISessionStorage } from "@nodefony/http";
import { ormRegistry } from "@nodefony/orm-core";
import type { IRepository } from "@nodefony/orm-core";
import { SESSION_ORM, type SessionRow } from "../entity/sessionEntity";

/** Données de session sérialisées passées par le manager (`session.serialize()`). */
interface SerializedSession {
  Attributes: unknown;
  metaBag: unknown;
  flashBag: unknown;
  user: string;
}

/**
 * Stockage de session **Drizzle** (driver `better-sqlite3`), branché sur
 * `@nodefony/orm-core`.
 *
 * Implémente le contrat {@link ISessionStorage} consommé par le `SessionsService`
 * de `@nodefony/http` — alternative portable à la version Sequelize. Persiste via
 * le repository orm-core de l'entité `session` (connecteur `default`, table créée
 * au boot par `DrizzleOrm`). Le GC supprime les sessions expirées avec un
 * opérateur riche portable (`updatedAt < cutoff`).
 */
class SessionStorage implements ISessionStorage {
  manager: SessionsService;
  gc_maxlifetime: number;
  contextSessions: string[] = [];

  constructor(manager: SessionsService) {
    this.manager = manager;
    this.gc_maxlifetime = manager.options.gc_maxlifetime;
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
    const orm = ormRegistry.get(SESSION_ORM);
    if (!orm.isConnected()) {
      return null;
    }
    return orm.getRepository<SessionRow>("session");
  }

  async read(id: string, contextSession?: string): Promise<unknown> {
    const criteria: Partial<SessionRow> = { session_id: id };
    if (contextSession) {
      criteria.context = contextSession;
    }
    const repo = this.#repo();
    if (!repo) {
      return {} as SerializedSession;
    }
    const row = await repo.findOne(criteria);
    if (!row) {
      return {} as SerializedSession;
    }
    return {
      Attributes: row.Attributes ?? {},
      metaBag: row.metaBag ?? {},
      flashBag: row.flashBag ?? {},
      user: row.user ?? "",
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    };
  }

  async start(id: string, contextSession: string): Promise<unknown> {
    return this.read(id, contextSession);
  }

  async write(
    id: string,
    data: unknown,
    contextSession: string,
  ): Promise<unknown> {
    const serialize = data as SerializedSession;
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
      context: contextSession || "default",
      Attributes: serialize.Attributes,
      flashBag: serialize.flashBag,
      metaBag: serialize.metaBag,
      user: serialize.user || null,
      updatedAt: now,
    };
    const existing = await repo.findOne({ session_id: id });
    if (existing) {
      await repo.update({ session_id: id }, fields as Partial<SessionRow>);
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

  async open(contextSession: string): Promise<number> {
    await this.gc(this.gc_maxlifetime, contextSession);
    const repo = this.#repo();
    if (!repo) {
      return 0;
    }
    const count = await repo.count(
      contextSession ? { context: contextSession } : undefined,
    );
    this.manager.log(
      `CONTEXT ${contextSession || "default"} DRIZZLE SESSIONS STORAGE ==> COUNT SESSIONS : ${count}`,
      "INFO",
    );
    return count;
  }

  close(): boolean {
    void this.gc(this.gc_maxlifetime);
    return true;
  }

  async destroy(id: string, contextSession: string): Promise<boolean> {
    const criteria: Partial<SessionRow> = { session_id: id };
    if (contextSession) {
      criteria.context = contextSession;
    }
    const repo = this.#repo();
    if (!repo) {
      return true;
    }
    await repo.delete(criteria);
    this.manager.log(
      `DRIZZLE DESTROY SESSION context : ${contextSession} ID : ${id}`,
      "DEBUG",
    );
    return true;
  }

  async gc(maxlifetime: number, contextSession?: string): Promise<void> {
    const cutoff = Date.now() - (maxlifetime || this.gc_maxlifetime) * 1000;
    const criteria: Record<string, unknown> = { updatedAt: { $lt: cutoff } };
    if (contextSession) {
      criteria.context = contextSession;
    }
    const repo = this.#repo();
    if (!repo) {
      return;
    }
    const deleted = await repo.delete(criteria as Partial<SessionRow>);
    if (deleted > 0) {
      this.manager.log(
        `DRIZZLE SESSIONS GC context : ${contextSession || "default"} ==> ${deleted} DELETED`,
        "DEBUG",
      );
    }
  }
}

// Auto-enregistrement dans le registre de session de @nodefony/http (IoC) :
// http ne dépend pas de cet ORM, c'est l'ORM qui se déclare.
// cast : dette de typage session (ISessionStorage vs sessionStorageInterface),
// traitée par la refonte ORM (boussole durcissement ORM).
SessionsService.registerStorage(
  "drizzle",
  SessionStorage as unknown as Parameters<
    typeof SessionsService.registerStorage
  >[1],
);

export default SessionStorage;
