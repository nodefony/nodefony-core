import { SessionsService } from "@nodefony/http";
import type {
  ISessionStorage,
  ISerializedSession,
  ISessionRecord,
  ISessionListFilter,
  ISessionListQuery,
} from "@nodefony/http";
import type { IPage } from "nodefony";
import { assertPageQuery } from "nodefony";
import type RedisService from "../service/redis";
import { MAX_SCAN, scanPage } from "./scanCursor";

/** Préfixe namespacé des clés de session dans Redis. */
/**
 * Préfixe HISTORIQUE des clés de session. Il n'est utilisé tel quel que par une
 * application sans cloison ; sinon le service y insère le nom de l'application
 * (cf {@link RedisService.keyPrefix}) — sans quoi deux applications sur un même
 * Redis se partagent l'espace de clés, et le balayage de l'une remonte les
 * sessions de l'autre.
 */
const KEY_BASE = "nf:sess";

/**
 * Stockage de session **Redis** — branché sur la connexion `main` du
 * {@link RedisService}. Implémente le contrat unifié {@link ISessionStorage}
 * consommé par le `SessionsService` de `@nodefony/http`.
 *
 * Atout décisif vs File/SQL : l'expiration est portée par le **TTL natif**
 * (`SET … EX`) → `gc()` est un **no-op** (zéro balayage, zéro requête de purge)
 * et le store est **partagé cross-pod** (source unique de vérité en cluster).
 *
 * Dégradation gracieuse **annoncée** : si la connexion `main` n'est pas (ou
 * plus) ouverte (boot, coupure, shutdown), chaque opération devient un no-op
 * plutôt que de jeter — la session n'est simplement pas persistée le temps de
 * l'indisponibilité. Le repli n'est pas muet : {@link RedisService.getClient}
 * journalise un WARNING à la bascule et un INFO au rétablissement (une seule
 * ligne par transition, pas une par requête).
 */
class RedisSessionStorage implements ISessionStorage {
  manager: SessionsService;
  /** Idle timeout en secondes (= TTL Redis natif, glissant via `write`/`touch`). */
  idleTimeoutS: number;
  /** Service Redis résolu en lazy (au 1ᵉʳ accès) depuis le container. */
  #service: RedisService | null = null;
  /** Préfixe cloisonné, calculé une seule fois (il est lu à chaque clé). */
  #prefixCache: string | null = null;

  constructor(manager: SessionsService) {
    this.manager = manager;
    this.idleTimeoutS = manager.options.idleTimeoutS;
  }

  /**
   * Client Redis de la connexion `main`, ou `null` si indisponible.
   * Résolution **lazy** du service (l'ordre de boot des modules n'est pas garanti
   * à la construction du storage).
   */
  #client() {
    this.#service ??= this.manager.get<RedisService>("redis") ?? null;
    return this.#service?.getClient("main") ?? null;
  }

  /**
   * Préfixe effectif des clés, cloisonné par application. Mémoïsé : il est lu à
   * chaque clé, et le service ne change pas en cours de vie.
   */
  #prefix(): string {
    if (this.#prefixCache === null) {
      this.#client(); // force la résolution lazy du service
      // `typeof` et pas seulement `?.` : le service peut être d'une version
      // antérieure (ou un double de test) qui ne connaît pas encore la cloison.
      // Une application qui tourne ne doit pas s'arrêter pour ça — elle garde
      // simplement son préfixe historique.
      const service = this.#service;
      this.#prefixCache =
        typeof service?.keyPrefix === "function"
          ? service.keyPrefix(KEY_BASE)
          : KEY_BASE;
    }
    return this.#prefixCache;
  }

  #key(id: string): string {
    return `${this.#prefix()}:${id}`;
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
      // SET … EX : TTL natif = idle timeout. Session glissante — le TTL est
      // rafraîchi à chaque write (mutation) ET à chaque `touch` (activité pure).
      await client.set(this.#key(id), JSON.stringify(payload), {
        expiration: { type: "EX", value: this.idleTimeoutS },
      });
    }
    return payload;
  }

  async open(): Promise<number> {
    // Redis expire les sessions seul (TTL) → pas de GC, pas de comptage (SCAN
    // serait O(keyspace)). On signale juste le backend actif au boot.
    this.manager.log(
      `REDIS SESSIONS STORAGE ==> TTL natif idle (${this.idleTimeoutS}s)`,
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
    // No-op volontaire pour l'IDLE : géré par le TTL Redis (SET … EX, glissant).
    // L'ABSOLUTE timeout n'est pas exprimable par un TTL glissant → il est honoré
    // à la LECTURE (`Session.isValidSession` compare `createdAt`), comme prévu par
    // le contrat `ISessionStorage.gc`. Une entrée au-delà de l'absolute peut donc
    // survivre côté Redis jusqu'à son TTL idle, mais est refusée à la reprise.
  }

  /**
   * Prolonge l'idle d'une session (timeout glissant) en repositionnant le TTL
   * natif (`EXPIRE`, O(1)) — SANS réécrire la valeur (touch NIST/OWASP). C'est le
   * touch le moins coûteux des stores. Clé absente / connexion fermée → no-op.
   *
   * @param idleSeconds - nouvel idle (défaut : l'idle configuré du store).
   */
  async touch(id: string, idleSeconds?: number): Promise<void> {
    const client = this.#client();
    if (!client) {
      return;
    }
    await client.expire(this.#key(id), idleSeconds ?? this.idleTimeoutS);
  }

  /**
   * Énumération admin (capacité optionnelle d'`ISessionStorage`) par **SCAN**
   * non-bloquant (`MATCH <prefix>:*`, curseur), filtrable par `user`. Cold-path
   * RARE (console admin, jamais le hot-path). `SCAN` est O(keyspace) → plafonné
   * à {@link MAX_SCAN} (au-delà : listing partiel **journalisé**, pas silencieux).
   * Connexion fermée → `[]`.
   */
  async listAll(filter?: ISessionListFilter): Promise<ISessionRecord[]> {
    const client = this.#client();
    if (!client) {
      return [];
    }
    const prefix = this.#prefix();
    const match = `${prefix}:*`;
    const prefixLen = prefix.length + 1; // longueur de `<prefix>:`
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

  /**
   * {@inheritDoc ISessionStorage.listPage}
   *
   * **Curseur SCAN** : les lots `SCAN` s'enchaînent jusqu'à REMPLIR la page, finir
   * le balayage, ou épuiser l'effort borné ({@link MAX_SCAN} emplacements
   * examinés par appel, cold-path admin). Capacité réduite ASSUMÉE et annoncée —
   * pas de `total`, pas d'ordre global sur `updatedAt` (Redis n'a pas d'index
   * secondaire ici). Une page n'est incomplète qu'en FIN de balayage ou budget
   * épuisé, et porte alors son `nextCursor`. La garantie qui compte est tenue :
   * **le keyspace n'est jamais matérialisé** — un lot à la fois.
   *
   * ⚠️ **`COUNT` n'est PAS un plafond** — c'est un indice d'effort par itération.
   * Redis peut rendre plus de clés que demandé (typiquement un petit keyspace
   * encodé en listpack : tout arrive en une fois). Sans précaution, la page
   * dépasserait `limit` et violerait le contrat `IPage`. D'où le **curseur
   * composite** `"<consommé>:<curseurRedis>"` : quand un batch contient plus que
   * la page, on ne rend que `limit` éléments et on mémorise combien de clés du
   * batch ont été consommées — la page suivante rejoue le MÊME `SCAN` et reprend
   * là où on s'était arrêté. Coût : un re-scan du batch courant, payé uniquement
   * sur un cold-path d'administration. Rien n'est perdu, rien ne déborde.
   */
  async listPage(query: ISessionListQuery): Promise<IPage<ISessionRecord>> {
    assertPageQuery(query, "cursor");
    const limit = Math.max(1, Math.floor(query.limit));
    const client = this.#client();
    if (!client) {
      return { items: [], limit, hasNext: false, nextCursor: null };
    }
    const prefixLen = this.#prefix().length + 1;
    const match = `${this.#prefix()}:*`;
    const { items, nextCursor } = await scanPage(
      (cursor) => client.scan(cursor, { MATCH: match, COUNT: limit }),
      query.cursor,
      limit,
      async (key): Promise<ISessionRecord | null> => {
        const raw = await client.get(key);
        if (!raw) return null;
        let data: ISerializedSession;
        try {
          data = JSON.parse(raw) as ISerializedSession;
        } catch {
          return null; // valeur corrompue → ignorée
        }
        if (query.user !== undefined && data.user !== query.user) return null;
        if (
          query.authenticated !== undefined &&
          !!data.user !== query.authenticated
        ) {
          return null;
        }
        // Redaction par construction (garantie du contrat) : le blob Redis porte
        // tout, mais un record d'énumération admin ne sort jamais avec les
        // données métier. Ici la vidange est explicite — un `GET` ne sait pas
        // projeter.
        return {
          id: key.slice(prefixLen),
          data: { ...data, Attributes: {}, flashBag: {} },
        };
      },
    );
    return { items, limit, hasNext: nextCursor !== null, nextCursor };
  }

  /**
   * {@inheritDoc ISessionStorage.countSessions}
   *
   * Un comptage exact exigerait un `SCAN` complet O(keyspace) → refusé même sur le
   * cold-path admin : renvoie **`-1`** (« inconnu », capacité réduite Redis
   * assumée). L'appelant affiche l'inconnu, il ne l'invente pas.
   */
  countSessions(_query?: Partial<ISessionListQuery>): Promise<number> {
    return Promise.resolve(-1);
  }

  /**
   * {@inheritDoc ISessionStorage.countDistinctUsers}
   *
   * Dédupliquer exige d'avoir tout vu : c'est le `SCAN` complet que
   * {@link countSessions} refuse déjà, plus un ensemble à retenir en mémoire.
   * Renvoie **`-1`** — la console affiche « — », elle n'invente pas un chiffre.
   */
  countDistinctUsers(_query?: Partial<ISessionListQuery>): Promise<number> {
    return Promise.resolve(-1);
  }
}

// Auto-enregistrement IoC dans le registre de session de @nodefony/http.
// NB : le « redis neutre » du CLAUDE.md est antérieur au chantier session —
// l'archi session actuelle prime : chaque backend porte son storage (comme
// drizzle/mongoose), s'auto-déclare, http ne dépend d'aucun backend.
SessionsService.registerStorage("redis", RedisSessionStorage);

export default RedisSessionStorage;
