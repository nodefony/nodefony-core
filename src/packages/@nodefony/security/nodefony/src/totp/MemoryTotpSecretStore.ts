import type { ITotpSecret } from "../../contracts/ITotpSecret";
import type {
  ITotpSecretStore,
  TotpSecretUpdate,
} from "../../contracts/ITotpSecretStore";

/** Instantané sérialisable de l'état — base de la persistance fichier. */
export interface TotpStoreSnapshot {
  secrets: ITotpSecret[];
}

/**
 * Store de secrets TOTP **en mémoire** — implémentation de référence
 * d'{@link ITotpSecretStore}. Clé = `userId` (un secret par utilisateur).
 *
 * 0 dépendance, idéale pour le développement mono-process et les **tests**. NON
 * partagée entre process et **volatile** → en production multi-process, utiliser
 * un adapter ORM ou Redis. Perf : la `Map` n'existe que si le store est instancié
 * (2FA activé), jamais sur le hot path par requête.
 */
export class MemoryTotpSecretStore implements ITotpSecretStore {
  /** userId → secret (source de vérité). */
  readonly #byUser = new Map<string, ITotpSecret>();

  findByUser(userId: string): Promise<ITotpSecret | null> {
    return Promise.resolve(this.#byUser.get(userId) ?? null);
  }

  save(secret: ITotpSecret): Promise<void> {
    this.#byUser.set(secret.userId, secret);
    return Promise.resolve();
  }

  update(userId: string, patch: TotpSecretUpdate): Promise<void> {
    const secret = this.#byUser.get(userId);
    if (secret) {
      if (patch.confirmedAt !== undefined)
        secret.confirmedAt = patch.confirmedAt;
      if (patch.recoveryCodes !== undefined)
        secret.recoveryCodes = patch.recoveryCodes;
      if (patch.lastUsedStep !== undefined)
        secret.lastUsedStep = patch.lastUsedStep;
      if (patch.lastUsedAt !== undefined) secret.lastUsedAt = patch.lastUsedAt;
    }
    return Promise.resolve();
  }

  delete(userId: string): Promise<void> {
    this.#byUser.delete(userId);
    return Promise.resolve();
  }

  /** Instantané sérialisable de l'état courant (pour la persistance fichier). */
  snapshot(): TotpStoreSnapshot {
    return { secrets: [...this.#byUser.values()] };
  }

  /** Remplace l'état par celui d'un instantané. */
  restore(snapshot: TotpStoreSnapshot): void {
    this.#byUser.clear();
    for (const secret of snapshot.secrets) {
      this.#byUser.set(secret.userId, secret);
    }
  }
}

export default MemoryTotpSecretStore;
