// `import type` UNIQUEMENT (approche B) → effacé à la compilation : aucune
// dépendance runtime de l'infra Redis vers `@nodefony/security`. L'application
// câble le store via `registerWebAuthnStore("redis", …)`.
import type { IPage } from "nodefony";
import type {
  IWebAuthnCredential,
  IWebAuthnCredentialStore,
  IWebAuthnCredentialSummary,
  IWebAuthnListQuery,
  WebAuthnAuthUpdate,
} from "@nodefony/security";
import type RedisService from "../service/redis";

/** Préfixe namespacé des clés de credentials WebAuthn dans Redis. */
/**
 * Préfixe HISTORIQUE des clés (identifiants WebAuthn). Utilisé tel quel par une application sans
 * cloison ; sinon le service y insère le nom de l'application (cf
 * {@link RedisService.keyPrefix}) — deux applications sur un même Redis ne
 * doivent ni écrire ni BALAYER le même espace de clés.
 */
const KEY_BASE = "nf:wac";

/**
 * Curseur composite `skip:scanCursor`.
 *
 * `SCAN COUNT` est un **indice d'effort, pas un plafond** : un batch peut rendre
 * plus de clés que `limit`. On ne jette pas le surplus (il serait perdu) — on
 * mémorise combien de clés du batch ont été consommées ; la page suivante rejoue
 * le même `SCAN` et reprend à la bonne position. Rien n'est perdu, rien ne
 * déborde. Même mécanisme que les stores de jetons et de session (convention).
 */
function encodeCursor(scanCursor: string, skip: number): string {
  return `${skip}:${scanCursor}`;
}

/** Inverse d'{@link encodeCursor} — tolère un curseur absent, vide ou malformé. */
function decodeCursor(cursor?: string): { scanCursor: string; skip: number } {
  if (!cursor) return { scanCursor: "0", skip: 0 };
  const sep = cursor.indexOf(":");
  if (sep === -1) {
    // Curseur Redis nu (client externe, ancien format) → honoré tel quel.
    return { scanCursor: cursor, skip: 0 };
  }
  const skip = Number.parseInt(cursor.slice(0, sep), 10);
  return {
    scanCursor: cursor.slice(sep + 1) || "0",
    skip: Number.isFinite(skip) && skip > 0 ? skip : 0,
  };
}

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
  sCard(key: string): Promise<number>;
  scan(
    cursor: string,
    options?: { MATCH?: string; COUNT?: number },
  ): Promise<{ cursor: string; keys: string[] }>;
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
  /** Fournit le préfixe cloisonné (lazy : le service peut n'exister qu'au boot). */
  readonly #resolvePrefix: () => string;
  /** Préfixe mémoïsé — il est lu à chaque clé. */
  #prefixCache: string | null = null;

  /**
   * @param resolveClient - résolveur **lazy** du client Redis (l'ordre de boot
   *   n'est pas garanti à la construction ; `null` = connexion indisponible).
   * @param resolvePrefix - résolveur **lazy** du préfixe cloisonné par application.
   */
  constructor(
    resolveClient: () => RedisClientLike | null,
    resolvePrefix: () => string = () => KEY_BASE,
  ) {
    this.#resolveClient = resolveClient;
    this.#resolvePrefix = resolvePrefix;
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
      () => service.keyPrefix(KEY_BASE),
    );
  }

  /** Préfixe effectif des clés, cloisonné par application (mémoïsé). */
  #prefix(): string {
    if (this.#prefixCache === null) this.#prefixCache = this.#resolvePrefix();
    return this.#prefixCache;
  }

  #client(): RedisClientLike | null {
    return this.#resolveClient();
  }

  #credKey(id: string): string {
    return `${this.#prefix()}:cred:${id}`;
  }
  #userKey(userId: string): string {
    return `${this.#prefix()}:user:${userId}`;
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

  /**
   * `SCARD` natif — O(1), aucune lecture de HASH (le plafond ne charge rien).
   *
   * Peut **sur-compter** les membres orphelins que {@link findByUser} nettoie
   * paresseusement (credential supprimé hors `delete` — sans TTL sur les
   * credentials, cas dégénéré). Écart assumé **fail-closed** : au pire un
   * enrôlement de plus est refusé, jamais un de trop accepté. Client
   * indisponible → `0` (cohérent avec les lectures qui renvoient vide).
   */
  async countByUser(userId: string): Promise<number> {
    const client = this.#client();
    if (!client) {
      return 0;
    }
    return client.sCard(this.#userKey(userId));
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

  /**
   * {@inheritDoc IWebAuthnCredentialStore.listPage}
   *
   * **Curseur SCAN pur** : UN passage `SCAN` par appel (cold-path admin). Capacité
   * réduite ASSUMÉE et annoncée — pas de `total`, pas d'ordre global sur
   * `createdAt` (Redis n'a pas d'index secondaire ici), la page peut compter moins
   * d'éléments que `limit` (le filtre s'applique au batch). Le client boucle tant
   * que `hasNext` en repassant `nextCursor`.
   *
   * ⚠️ On SCANne les HASH de credentials, pas les Set par utilisateur : le filtre
   * `userId` reste un filtre de page. Passer par `sMembers` serait plus direct
   * mais donnerait deux stratégies de pagination pour un même contrat — la
   * seconde sans curseur, donc incohérente dès qu'on mélange les filtres.
   */
  async listPage(
    query: IWebAuthnListQuery,
  ): Promise<IPage<IWebAuthnCredentialSummary>> {
    const limit = Math.max(1, Math.floor(query.limit));
    const client = this.#client();
    if (!client) {
      return { items: [], limit, hasNext: false, nextCursor: null };
    }
    // Curseur SCAN = STRING opaque — node-redis v6 exige une string en argument
    // de commande. Composite (`skip:curseur`) car `COUNT` n'est pas un plafond.
    const { scanCursor, skip } = decodeCursor(query.cursor);
    const res = await client.scan(scanCursor, {
      MATCH: `${this.#prefix()}:cred:*`,
      COUNT: limit,
    });
    const next = String(res.cursor);
    const items: IWebAuthnCredentialSummary[] = [];
    // `consumed` compte les CLÉS parcourues (pas les items rendus) : c'est la
    // position de reprise, et le filtre en écarte une partie.
    let consumed = 0;
    for (const key of res.keys.slice(skip)) {
      if (items.length >= limit) break; // page pleine → le reste attend
      consumed += 1;
      const h = await client.hGetAll(key);
      if (Object.keys(h).length === 0) continue;
      const cred = this.#decode(h);
      // Filtre inline (approche B : aucun import runtime de @nodefony/security).
      if (query.userId !== undefined && cred.userId !== query.userId) continue;
      if (
        query.userId === undefined &&
        query.q !== undefined &&
        query.q.length > 0 &&
        !cred.userId.startsWith(query.q)
      ) {
        continue;
      }
      if (query.backedUp !== undefined && cred.backupState !== query.backedUp) {
        continue;
      }
      items.push(this.#toSummary(cred));
    }
    const restInBatch = skip + consumed < res.keys.length;
    const nextCursor = restInBatch
      ? encodeCursor(scanCursor, skip + consumed) // on reste sur ce batch
      : next === "0"
        ? null // batch épuisé ET scan terminé
        : encodeCursor(next, 0); // batch épuisé, on avance
    return { items, limit, hasNext: nextCursor !== null, nextCursor };
  }

  /**
   * {@inheritDoc IWebAuthnCredentialStore.countCredentials}
   *
   * Un comptage exact exigerait un `SCAN` complet O(N) → refusé sur le cold-path
   * admin : renvoie `-1` (« inconnu », capacité réduite Redis assumée).
   * ⚠️ Ne pas confondre avec {@link countByUser}, qui est O(1) (`SCARD`) parce
   * qu'il porte sur un index existant.
   */
  countCredentials(_query: IWebAuthnListQuery): Promise<number> {
    return Promise.resolve(-1);
  }

  /** Credential complet → vue admin (sans `publicKey`, cf le contrat). */
  #toSummary(c: IWebAuthnCredential): IWebAuthnCredentialSummary {
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
}
