import type { IPage } from "nodefony";
import { assertPageQuery } from "nodefony";
import type { IWebAuthnCredential } from "../../contracts/IWebAuthnCredential";
import type {
  IWebAuthnCredentialStore,
  IWebAuthnCredentialSummary,
  IWebAuthnListQuery,
  WebAuthnAuthUpdate,
} from "../../contracts/IWebAuthnCredentialStore";

/**
 * Projection contractuelle : credential complet → vue admin **sans `publicKey`**.
 * Partagée par les backends qui matérialisent des credentials en mémoire.
 */
export function toWebAuthnSummary(
  c: IWebAuthnCredential,
): IWebAuthnCredentialSummary {
  return {
    id: c.id,
    userId: c.userId,
    transports: c.transports,
    backupEligible: c.backupEligible,
    backupState: c.backupState,
    uvInitialized: c.uvInitialized,
    signCount: c.signCount,
    createdAt: c.createdAt,
    lastUsedAt: c.lastUsedAt,
    ...(c.nickname !== undefined ? { nickname: c.nickname } : {}),
  };
}

/**
 * Store de credentials WebAuthn **en mémoire** — implémentation de référence
 * d'{@link IWebAuthnCredentialStore}.
 *
 * 0 dépendance, idéale pour le développement mono-process et les **tests**. NON
 * partagée entre process (pas de cluster) et **volatile** (perdue au
 * redémarrage) → en production multi-process, utiliser un adapter ORM ou Redis.
 *
 * Perf/mémoire : les `Map` n'existent que si le store est instancié (passkeys
 * activés), jamais sur le hot path par requête HTTP.
 */
/** Instantané sérialisable de l'état — base de la persistance fichier. */
export interface WebAuthnStoreSnapshot {
  credentials: IWebAuthnCredential[];
}

export class MemoryWebAuthnCredentialStore implements IWebAuthnCredentialStore {
  /** id (base64url) → credential (source de vérité). */
  readonly #byId = new Map<string, IWebAuthnCredential>();
  /** userId → ids (allowCredentials + « mes appareils »). */
  readonly #idsByUser = new Map<string, Set<string>>();

  findById(credentialId: string): Promise<IWebAuthnCredential | null> {
    return Promise.resolve(this.#byId.get(credentialId) ?? null);
  }

  findByUser(userId: string): Promise<IWebAuthnCredential[]> {
    const ids = this.#idsByUser.get(userId);
    if (!ids) {
      return Promise.resolve([]);
    }
    const out: IWebAuthnCredential[] = [];
    for (const id of ids) {
      const cred = this.#byId.get(id);
      if (cred) {
        out.push(cred);
      }
    }
    return Promise.resolve(out);
  }

  countByUser(userId: string): Promise<number> {
    return Promise.resolve(this.#idsByUser.get(userId)?.size ?? 0);
  }

  save(credential: IWebAuthnCredential): Promise<void> {
    this.#byId.set(credential.id, credential);
    let set = this.#idsByUser.get(credential.userId);
    if (!set) {
      set = new Set<string>();
      this.#idsByUser.set(credential.userId, set);
    }
    set.add(credential.id);
    return Promise.resolve();
  }

  update(credentialId: string, patch: WebAuthnAuthUpdate): Promise<void> {
    const cred = this.#byId.get(credentialId);
    if (cred) {
      cred.signCount = patch.signCount;
      cred.backupState = patch.backupState;
      cred.uvInitialized = patch.uvInitialized;
      cred.lastUsedAt = patch.lastUsedAt;
    }
    return Promise.resolve();
  }

  delete(credentialId: string): Promise<void> {
    const cred = this.#byId.get(credentialId);
    if (!cred) {
      return Promise.resolve();
    }
    this.#byId.delete(credentialId);
    const set = this.#idsByUser.get(cred.userId);
    if (set) {
      set.delete(credentialId);
      if (set.size === 0) {
        this.#idsByUser.delete(cred.userId);
      }
    }
    return Promise.resolve();
  }

  /** Credentials filtrés, dans l'ordre contractuel (createdAt DESC, id ASC). */
  #filtered(query: IWebAuthnListQuery): IWebAuthnCredential[] {
    const out: IWebAuthnCredential[] = [];
    for (const cred of this.#byId.values()) {
      if (query.userId !== undefined && cred.userId !== query.userId) continue;
      if (query.backedUp !== undefined && cred.backupState !== query.backedUp) {
        continue;
      }
      if (query.q !== undefined && !cred.userId.startsWith(query.q)) continue;
      out.push(cred);
    }
    return out.sort(
      (a, b) =>
        b.createdAt - a.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  }

  listPage(
    query: IWebAuthnListQuery,
  ): Promise<IPage<IWebAuthnCredentialSummary>> {
    assertPageQuery(query, "offset");
    const limit = Math.max(1, Math.floor(query.limit));
    const offset =
      query.offset !== undefined && query.offset > 0 ? query.offset : 0;
    const all = this.#filtered(query);
    const items = all.slice(offset, offset + limit).map(toWebAuthnSummary);
    return Promise.resolve({
      items,
      limit,
      offset,
      hasNext: offset + items.length < all.length,
      ...(query.withTotal === false ? {} : { total: all.length }),
    });
  }

  countCredentials(query: IWebAuthnListQuery): Promise<number> {
    return Promise.resolve(this.#filtered(query).length);
  }

  /** Instantané sérialisable de l'état courant (pour la persistance fichier). */
  snapshot(): WebAuthnStoreSnapshot {
    return { credentials: [...this.#byId.values()] };
  }

  /** Remplace l'état par celui d'un instantané (reconstruit l'index par user). */
  restore(snapshot: WebAuthnStoreSnapshot): void {
    this.#byId.clear();
    this.#idsByUser.clear();
    for (const cred of snapshot.credentials) {
      this.#byId.set(cred.id, cred);
      let set = this.#idsByUser.get(cred.userId);
      if (!set) {
        set = new Set<string>();
        this.#idsByUser.set(cred.userId, set);
      }
      set.add(cred.id);
    }
  }
}

export default MemoryWebAuthnCredentialStore;
