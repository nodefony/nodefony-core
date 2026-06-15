// `import type` UNIQUEMENT (approche B) → effacé à la compilation : aucune
// dépendance runtime de l'infra Redis vers `@nodefony/security`. L'application
// câble le store via `registerWebAuthnStore("redis", …)`.
import type {
  IWebAuthnCredential,
  IWebAuthnCredentialStore,
  WebAuthnAuthUpdate,
} from "@nodefony/security";
import type RedisService from "../service/redis";

/** Préfixe namespacé des clés de credentials WebAuthn dans Redis. */
const KEY_PREFIX = "nf:wac";

/**
 * Sous-ensemble structural du client `redis` v6 utilisé par le store de
 * credentials — permet de tester contre un double déterministe sans serveur (le
 * vrai `RedisClientType` satisfait cette forme par ses méthodes camelCase v6).
 *
 * Plus restreint que celui du `RedisTokenStore` : un credential WebAuthn ne porte
 * **aucun TTL** (une passkey est permanente jusqu'à révocation explicite) → ni
 * `expire`/`EX`, ni `get`/`set` de chaîne. Deux structures suffisent : un HASH
 * par credential, un SET d'ids par utilisateur.
 */
export interface RedisClientLike {
  hSet(key: string, fields: Record<string, string>): Promise<number>;
  hGetAll(key: string): Promise<Record<string, string>>;
  exists(key: string): Promise<number>;
  del(key: string): Promise<number>;
  sAdd(key: string, member: string): Promise<number>;
  sRem(key: string, member: string): Promise<number>;
  sMembers(key: string): Promise<string[]>;
}

/**
 * Store de credentials WebAuthn **Redis** (node-redis v6) — implémentation
 * d'{@link IWebAuthnCredentialStore} pour le cluster (source unique cross-pod,
 * les passkeys survivent au redémarrage et sont partagées entre process).
 *
 * **Approche B** : `@nodefony/security` n'est connu qu'en `import type` (0 dép
 * runtime). L'application câble la fabrique (`registerWebAuthnStore("redis", …)`).
 *
 * **Modèle de clés** (préfixe `nf:wac`) :
 *  - `cred:<credentialId>` = **HASH** du credential (1 champ par colonne ;
 *    `transports` en JSON ; booléens en `"1"`/`"0"` ; `lastUsedAt`/`nickname`
 *    absents = `null`/non défini). HASH (≠ blob JSON) car `update` réécrit 1-4
 *    champs via `HSET` sans relire le record ;
 *  - `user:<userId>` = **SET** des credentialIds de l'utilisateur (`findByUser`,
 *    `allowCredentials`, « mes appareils ») — les membres orphelins (credential
 *    supprimé hors `delete`) sont nettoyés paresseusement à la lecture.
 *
 * **Aucun TTL → aucun `gc`** : le contrat {@link IWebAuthnCredentialStore} n'a pas
 * de maintenance (≠ `ITokenStore`) — un credential ne disparaît que sur `delete`.
 *
 * Dégradation gracieuse : si la connexion `main` n'est pas (ou plus) ouverte, les
 * lectures renvoient vide et les écritures sont des no-op (comme le session store).
 */
export class RedisWebAuthnCredentialStore implements IWebAuthnCredentialStore {
  readonly #resolveClient: () => RedisClientLike | null;

  /**
   * @param resolveClient - résolveur **lazy** du client Redis (l'ordre de boot
   *   n'est pas garanti à la construction ; `null` = connexion indisponible).
   */
  constructor(resolveClient: () => RedisClientLike | null) {
    this.#resolveClient = resolveClient;
  }

  /**
   * Construit le store depuis un {@link RedisService} (connexion `main`).
   * Résolution **lazy** du client (boot order).
   *
   * @param service - service Redis fournissant `getClient("main")`.
   */
  static from(service: RedisService): RedisWebAuthnCredentialStore {
    return new RedisWebAuthnCredentialStore(
      () => service.getClient("main") as unknown as RedisClientLike | null,
    );
  }

  #client(): RedisClientLike | null {
    return this.#resolveClient();
  }

  #credKey(id: string): string {
    return `${KEY_PREFIX}:cred:${id}`;
  }
  #userKey(userId: string): string {
    return `${KEY_PREFIX}:user:${userId}`;
  }

  /** Sérialise un credential en champs de HASH (omet `lastUsedAt`/`nickname` absents). */
  #encode(c: IWebAuthnCredential): Record<string, string> {
    const h: Record<string, string> = {
      id: c.id,
      userId: c.userId,
      publicKey: c.publicKey,
      signCount: String(c.signCount),
      transports: JSON.stringify(c.transports),
      backupEligible: c.backupEligible ? "1" : "0",
      backupState: c.backupState ? "1" : "0",
      uvInitialized: c.uvInitialized ? "1" : "0",
      createdAt: String(c.createdAt),
    };
    if (c.lastUsedAt !== null) {
      h.lastUsedAt = String(c.lastUsedAt);
    }
    if (c.nickname !== undefined) {
      h.nickname = c.nickname;
    }
    return h;
  }

  /** Désérialise un HASH en credential (`lastUsedAt`/`nickname` absents → `null`/omis). */
  #decode(h: Record<string, string>): IWebAuthnCredential {
    return {
      id: h.id,
      userId: h.userId,
      publicKey: h.publicKey,
      signCount: Number(h.signCount),
      transports: h.transports ? (JSON.parse(h.transports) as string[]) : [],
      backupEligible: h.backupEligible === "1",
      backupState: h.backupState === "1",
      uvInitialized: h.uvInitialized === "1",
      createdAt: Number(h.createdAt),
      lastUsedAt: "lastUsedAt" in h ? Number(h.lastUsedAt) : null,
      ...("nickname" in h ? { nickname: h.nickname } : {}),
    };
  }

  async findById(credentialId: string): Promise<IWebAuthnCredential | null> {
    const client = this.#client();
    if (!client) {
      return null;
    }
    const h = await client.hGetAll(this.#credKey(credentialId));
    return Object.keys(h).length > 0 ? this.#decode(h) : null;
  }

  async findByUser(userId: string): Promise<IWebAuthnCredential[]> {
    const client = this.#client();
    if (!client) {
      return [];
    }
    const userKey = this.#userKey(userId);
    const ids = await client.sMembers(userKey);
    const out: IWebAuthnCredential[] = [];
    for (const id of ids) {
      const h = await client.hGetAll(this.#credKey(id));
      if (Object.keys(h).length > 0) {
        out.push(this.#decode(h));
      } else {
        await client.sRem(userKey, id); // membre orphelin (credential supprimé)
      }
    }
    return out;
  }

  async save(credential: IWebAuthnCredential): Promise<void> {
    const client = this.#client();
    if (!client) {
      return;
    }
    const credKey = this.#credKey(credential.id);
    // DEL avant HSET : un ré-enregistrement ne doit pas laisser de champ obsolète.
    await client.del(credKey);
    await client.hSet(credKey, this.#encode(credential));
    await client.sAdd(this.#userKey(credential.userId), credential.id);
  }

  async update(credentialId: string, patch: WebAuthnAuthUpdate): Promise<void> {
    const client = this.#client();
    if (!client) {
      return;
    }
    const credKey = this.#credKey(credentialId);
    // EXISTS d'abord : un HSET sur une clé absente la recréerait (partiellement).
    if ((await client.exists(credKey)) === 0) {
      return; // no-op si credentialId inconnu
    }
    await client.hSet(credKey, {
      signCount: String(patch.signCount),
      backupState: patch.backupState ? "1" : "0",
      uvInitialized: patch.uvInitialized ? "1" : "0",
      lastUsedAt: String(patch.lastUsedAt),
    });
  }

  async delete(credentialId: string): Promise<void> {
    const client = this.#client();
    if (!client) {
      return;
    }
    const credKey = this.#credKey(credentialId);
    // Lecture du userId pour retirer l'id du SET de l'utilisateur (intégrité index).
    const h = await client.hGetAll(credKey);
    if (Object.keys(h).length === 0) {
      return;
    }
    await client.del(credKey);
    if (h.userId) {
      await client.sRem(this.#userKey(h.userId), credentialId);
    }
  }
}
