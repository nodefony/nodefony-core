import { SessionsService } from "@nodefony/http";
import type {
  ISessionStorage,
  ISerializedSession,
  ISessionRecord,
  ISessionListFilter,
} from "@nodefony/http";
import type RedisService from "../service/redis";

/** Préfixe namespacé des clés de session dans Redis. */
const KEY_PREFIX = "nf:sess";

/**
 * Plafond de sécurité du SCAN admin : au-delà, on s'arrête et on LOGGE (listing
 * partiel signalé, jamais tronqué en silence). `SCAN` est O(keyspace) — un index
 * secondaire (`SET` d'ids) serait l'optimisation v2 pour un très grand parc.
 */
const MAX_SCAN = 10_000;

/**
 * Stockage de session **Redis** — branché sur la connexion `main` du
 * {@link RedisService}. Implémente le contrat unifié {@link ISessionStorage}
 * consommé par le `SessionsService` de `@nodefony/http`.
 *
 * Atout décisif vs File/SQL : l'expiration est portée par le **TTL natif**
 * (`SET … EX`) → `gc()` est un **no-op** (zéro balayage, zéro requête de purge)
 * et le store est **partagé cross-pod** (source unique de vérité en cluster).
 *
 * Dégradation gracieuse : si la connexion `main` n'est pas (ou plus) ouverte
 * (boot/shutdown), chaque opération devient un no-op silencieux plutôt que de
 * jeter (la session n'est juste pas persistée le temps de l'indisponibilité).
 */
class RedisSessionStorage implements ISessionStorage {
  manager: SessionsService;
  /** Durée de vie d'une session en secondes (= TTL Redis). */
  maxLifetimeS: number;
  /** Service Redis résolu en lazy (au 1ᵉʳ accès) depuis le container. */
  #service: RedisService | null = null;

  constructor(manager: SessionsService) {
    this.manager = manager;
    this.maxLifetimeS = manager.options.maxLifetimeS;
  }

  /**
   * Client Redis de la connexion `main`, ou `null` si indisponible.
   * Résolution **lazy** du service (l'ordre de boot des modules n'est pas garanti
   * à la construction du storage).
   */
  #client() {
    if (!this.#service) {
      this.#service = this.manager.get<RedisService>("redis") ?? null;
    }
    return this.#service?.getClient("main") ?? null;
  }

  #key(id: string): string {
    return `${KEY_PREFIX}:${id}`;
  }

  async read(id: string): Promise<ISerializedSession> {
    const client = this.#client();
    if (!client) {
      return {} as ISerializedSession;
    }
    const raw = await client.get(this.#key(id));
    if (!raw) {
      return {} as ISerializedSession;
    }
    return JSON.parse(raw) as ISerializedSession;
  }

  async start(id: string): Promise<ISerializedSession> {
    return this.read(id);
  }

  async write(
    id: string,
    data: ISerializedSession,
  ): Promise<ISerializedSession> {
    const now = new Date();
    const payload: ISerializedSession = {
      ...data,
      createdAt: data.createdAt ?? now,
      updatedAt: now,
    };
    const client = this.#client();
    if (client) {
      // SET … EX : TTL natif. Session glissante — le TTL est rafraîchi à chaque
      // write (toute requête qui touche la session repousse son expiration).
      await client.set(this.#key(id), JSON.stringify(payload), {
        EX: this.maxLifetimeS,
      });
    }
    return payload;
  }

  async open(): Promise<number> {
    // Redis expire les sessions seul (TTL) → pas de GC, pas de comptage (SCAN
    // serait O(keyspace)). On signale juste le backend actif au boot.
    this.manager.log(
      `REDIS SESSIONS STORAGE ==> TTL natif (${this.maxLifetimeS}s)`,
      "INFO",
    );
    return 0;
  }

  close(): boolean {
    // Rien à fermer ici : la connexion Redis appartient au RedisService (fermée
    // à `onTerminate` du kernel). Le storage n'en est qu'un consommateur.
    return true;
  }

  async destroy(id: string): Promise<boolean> {
    const client = this.#client();
    if (client) {
      await client.del(this.#key(id));
    }
    return true;
  }

  async gc(): Promise<void> {
    // No-op volontaire : l'expiration est gérée par le TTL Redis (SET … EX).
  }

  /**
   * Énumération admin (capacité optionnelle d'`ISessionStorage`) par **SCAN**
   * non-bloquant (`MATCH nf:sess:*`, curseur), filtrable par `user`. Cold-path
   * RARE (console admin, jamais le hot-path). `SCAN` est O(keyspace) → plafonné
   * à {@link MAX_SCAN} (au-delà : listing partiel **journalisé**, pas silencieux).
   * Connexion fermée → `[]`.
   */
  async listAll(filter?: ISessionListFilter): Promise<ISessionRecord[]> {
    const client = this.#client();
    if (!client) {
      return [];
    }
    const match = `${KEY_PREFIX}:*`;
    const prefixLen = KEY_PREFIX.length + 1; // "nf:sess:"
    const out: ISessionRecord[] = [];
    // node-redis v6 : le curseur SCAN est une string opaque (`RedisArgument`),
    // pas un entier — démarre à "0", boucle jusqu'au retour à "0".
    let cursor = "0";
    let scanned = 0;
    do {
      const res = await client.scan(cursor, { MATCH: match, COUNT: 200 });
      cursor = res.cursor;
      for (const key of res.keys) {
        scanned++;
        const raw = await client.get(key);
        if (!raw) continue;
        let data: ISerializedSession;
        try {
          data = JSON.parse(raw) as ISerializedSession;
        } catch {
          continue; // valeur corrompue → ignorée
        }
        if (filter?.user !== undefined && data.user !== filter.user) continue;
        out.push({ id: key.slice(prefixLen), data });
      }
      if (scanned >= MAX_SCAN) {
        this.manager.log(
          `REDIS SESSIONS listAll: scan plafonné à ${MAX_SCAN} clés ` +
            `(listing admin partiel — envisager un index secondaire)`,
          "WARNING",
        );
        break;
      }
    } while (cursor !== "0");
    return out;
  }
}

// Auto-enregistrement IoC dans le registre de session de @nodefony/http.
// NB : le « redis neutre » du CLAUDE.md est antérieur au chantier session —
// l'archi session actuelle prime : chaque backend porte son storage (comme
// drizzle/mongoose), s'auto-déclare, http ne dépend d'aucun backend.
SessionsService.registerStorage("redis", RedisSessionStorage);

export default RedisSessionStorage;
