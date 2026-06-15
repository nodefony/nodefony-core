import type { IWebAuthnCredential } from "../../contracts/IWebAuthnCredential";
import type {
  IWebAuthnCredentialStore,
  WebAuthnAuthUpdate,
} from "../../contracts/IWebAuthnCredentialStore";

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
