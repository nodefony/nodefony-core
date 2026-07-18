import type { IPage } from "nodefony";
import type { ITotpSecret } from "../../contracts/ITotpSecret";
import type {
  ITotpEnrollmentSummary,
  ITotpListQuery,
  ITotpSecretStore,
  TotpSecretUpdate,
} from "../../contracts/ITotpSecretStore";

/**
 * Projette un secret en vue d'introspection — **le seul endroit** où l'on
 * décide ce qui sort d'un store TOTP en mémoire. `secretEnc` et les condensats
 * des codes de récupération n'y figurent pas : seul leur NOMBRE est exposé.
 *
 * @param secret - le secret stocké.
 * @returns la vue publique de l'enrôlement.
 */
export function toTotpEnrollment(secret: ITotpSecret): ITotpEnrollmentSummary {
  return {
    userId: secret.userId,
    algorithm: secret.algorithm,
    digits: secret.digits,
    period: secret.period,
    confirmedAt: secret.confirmedAt,
    createdAt: secret.createdAt,
    lastUsedAt: secret.lastUsedAt,
    recoveryCodesLeft: secret.recoveryCodes.length,
  };
}

/** Applique les filtres d'{@link ITotpListQuery} — sémantique de RÉFÉRENCE. */
export function matchesTotpQuery(
  secret: ITotpSecret,
  query: ITotpListQuery,
): boolean {
  if (
    query.confirmed !== undefined &&
    (secret.confirmedAt !== null) !== query.confirmed
  ) {
    return false;
  }
  if (query.q !== undefined && query.q.length > 0) {
    if (!secret.userId.startsWith(query.q)) return false;
  }
  return true;
}

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

  /** {@inheritDoc ITotpSecretStore.listPage} */
  listPage(query: ITotpListQuery): Promise<IPage<ITotpEnrollmentSummary>> {
    const limit = Math.max(1, Math.floor(query.limit));
    const offset = Math.max(0, Math.floor(query.offset ?? 0));
    // Tri de RÉFÉRENCES : seule la page devient des vues d'enrôlement.
    const matched = [...this.#byUser.values()].filter((s) =>
      matchesTotpQuery(s, query),
    );
    matched.sort(
      (a, b) =>
        b.createdAt - a.createdAt ||
        (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
    );
    const items = matched.slice(offset, offset + limit).map(toTotpEnrollment);
    return Promise.resolve({
      items,
      total: query.withTotal === false ? undefined : matched.length,
      limit,
      offset,
      hasNext: offset + items.length < matched.length,
    });
  }

  /** {@inheritDoc ITotpSecretStore.countEnrollments} */
  countEnrollments(query: ITotpListQuery): Promise<number> {
    let n = 0;
    for (const secret of this.#byUser.values()) {
      if (matchesTotpQuery(secret, query)) n += 1;
    }
    return Promise.resolve(n);
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
