import { SessionsService } from "@nodefony/http";
import type { ISessionStorage, ISerializedSession } from "@nodefony/http";
import type RedisService from "../service/redis";

/** Préfixe namespacé des clés de session dans Redis. */
const KEY_PREFIX = "nf:sess";

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
  gc_maxlifetime: number;
  /** Service Redis résolu en lazy (au 1ᵉʳ accès) depuis le container. */
  #service: RedisService | null = null;

  constructor(manager: SessionsService) {
    this.manager = manager;
    this.gc_maxlifetime = manager.options.gc_maxlifetime;
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

  #key(id: string, contextSession?: string): string {
    return `${KEY_PREFIX}:${contextSession || "default"}:${id}`;
  }

  async read(id: string, contextSession?: string): Promise<ISerializedSession> {
    const client = this.#client();
    if (!client) {
      return {} as ISerializedSession;
    }
    const raw = await client.get(this.#key(id, contextSession));
    if (!raw) {
      return {} as ISerializedSession;
    }
    return JSON.parse(raw) as ISerializedSession;
  }

  async start(id: string, contextSession: string): Promise<ISerializedSession> {
    return this.read(id, contextSession);
  }

  async write(
    id: string,
    data: ISerializedSession,
    contextSession: string,
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
      await client.set(this.#key(id, contextSession), JSON.stringify(payload), {
        EX: this.gc_maxlifetime,
      });
    }
    return payload;
  }

  async open(contextSession: string): Promise<number> {
    // Redis expire les sessions seul (TTL) → pas de GC, pas de comptage (SCAN
    // serait O(keyspace)). On signale juste le backend actif au boot.
    this.manager.log(
      `CONTEXT ${contextSession || "default"} REDIS SESSIONS STORAGE ==> TTL natif (${this.gc_maxlifetime}s)`,
      "INFO",
    );
    return 0;
  }

  close(): boolean {
    // Rien à fermer ici : la connexion Redis appartient au RedisService (fermée
    // à `onTerminate` du kernel). Le storage n'en est qu'un consommateur.
    return true;
  }

  async destroy(id: string, contextSession: string): Promise<boolean> {
    const client = this.#client();
    if (client) {
      await client.del(this.#key(id, contextSession));
    }
    return true;
  }

  async gc(): Promise<void> {
    // No-op volontaire : l'expiration est gérée par le TTL Redis (SET … EX).
  }
}

// Auto-enregistrement IoC dans le registre de session de @nodefony/http.
// NB : le « redis neutre » du CLAUDE.md est antérieur au chantier session —
// l'archi session actuelle prime : chaque backend porte son storage (comme
// drizzle/mongoose), s'auto-déclare, http ne dépend d'aucun backend.
SessionsService.registerStorage("redis", RedisSessionStorage);

export default RedisSessionStorage;
