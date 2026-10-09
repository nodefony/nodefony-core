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
import { SessionIndex, supportsScripts } from "./sessionIndex";
import type { IScriptClient } from "./sessionIndex";

/** Le client `main`, quand il sait exécuter les scripts de l'index. */
type IndexClient = NonNullable<ReturnType<RedisService["getClient"]>> &
  IScriptClient;

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
 * Relit une session stockée : `null` si la valeur n'est pas du JSON, ou pas un
 * objet. La forme des sacs se contrôle ensuite au seul consommateur
 * (`Session.deSerialize`, @nodefony/http) — pour tous les stores à la fois.
 */
function parseSession(raw: string): ISerializedSession | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as ISerializedSession)
    : null;
}

/** Propriétaire d'une session relue, `""` s'il manque ou n'est pas une chaîne. */
function ownerOf(data: ISerializedSession): string {
  const user: unknown = data.user;
  return typeof user === "string" ? user : "";
}

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
  /** Index de comptage — lazy, construit sur le préfixe au premier usage. */
  #indexCache: SessionIndex | null = null;
  /**
   * Reconstruction EN COURS dans ce process : les comptages concurrents (les
   * quatre cartes de la console partent ensemble) l'attendent au lieu de rendre
   * « inconnu » parce que le premier d'entre eux tient le verrou.
   */
  #building: Promise<boolean> | null = null;

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

  /** L'index de comptage de CETTE cloison (cf `sessionIndex.ts`). */
  #index(): SessionIndex {
    this.#indexCache ??= new SessionIndex(this.#prefix());
    return this.#indexCache;
  }

  /**
   * Un échec de l'index ne doit JAMAIS faire échouer la session : il est
   * journalisé, et l'index INVALIDÉ — le prochain comptage le reconstruit
   * plutôt que de rendre un chiffre faux.
   */
  #indexFailed(
    client: { del(key: string): Promise<unknown> },
    e: unknown,
  ): void {
    this.manager.log(
      `REDIS SESSIONS index: ${e instanceof Error ? e.message : String(e)} — index invalidé, reconstruit au prochain comptage`,
      "WARNING",
    );
    void client.del(this.#index().builtKey).catch(() => undefined);
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
    // Valeur corrompue = session inconnue : jamais une `SyntaxError` qui
    // sortirait de `session.start()` sur le chemin de chaque requête.
    return parseSession(raw) ?? ({} as ISerializedSession);
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
      const written = client.set(this.#key(id), JSON.stringify(payload), {
        expiration: { type: "EX", value: this.idleTimeoutS },
      });
      if (supportsScripts(client)) {
        // Lancé EN MÊME TEMPS que le SET : node-redis les envoie dans le même
        // aller-retour — l'index ne coûte pas une latence de plus à la requête.
        const indexed = this.#index()
          .add(client, {
            id,
            user: payload.user || "",
            expiresAt: now.getTime() + this.idleTimeoutS * 1000,
          })
          .catch((e: unknown) => this.#indexFailed(client, e));
        await Promise.all([written, indexed]);
      } else {
        await written;
      }
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
      const deleted = client.del(this.#key(id));
      if (supportsScripts(client)) {
        const dropped = this.#index()
          .drop(client, id)
          .catch((e: unknown) => this.#indexFailed(client, e));
        await Promise.all([deleted, dropped]);
      } else {
        await deleted;
      }
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
    const idle = idleSeconds ?? this.idleTimeoutS;
    const expired = client.expire(this.#key(id), idle);
    if (!supportsScripts(client)) {
      await expired;
      return;
    }
    const expiresAt = Date.now() + idle * 1000;
    const [, known] = await Promise.all([
      expired,
      this.#index()
        .touch(client, id, expiresAt)
        .catch((e: unknown) => {
          this.#indexFailed(client, e);
          return true; // index invalidé : rien de plus à faire ici
        }),
    ]);
    if (!known) {
      // Session absente de l'index (antérieure à lui, ou écrite par une
      // version qui ne l'alimentait pas) : on l'y inscrit. Seul ce store sait
      // lire son propriétaire — chemin rare, une fois par session.
      const raw = await client.get(this.#key(id));
      if (!raw) return;
      const data = parseSession(raw);
      if (!data) return;
      await this.#index()
        .add(client, {
          id,
          user: ownerOf(data),
          expiresAt,
        })
        .catch((e: unknown) => this.#indexFailed(client, e));
    }
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
        const data = parseSession(raw);
        if (!data) continue; // valeur corrompue → ignorée
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
        const data = parseSession(raw);
        if (!data) return null; // valeur corrompue → ignorée
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
    // Le TOTAL, quand l'index sait compter : la même requête de filtre, un
    // `ZCOUNT`. Sans lui, la console ne connaît qu'un minorant, et « dernière
    // page » mène à une fausse fin. Inconnu (-1) → absent, jamais inventé.
    const total = await this.countSessions(query);
    return {
      items,
      limit,
      hasNext: nextCursor !== null,
      nextCursor,
      ...(total >= 0 ? { total } : {}),
    };
  }

  /**
   * L'index couvre-t-il les sessions ANTÉRIEURES à lui ? Sinon, un seul pod le
   * reconstruit (verrou `SET NX`) par un balayage complet — une fois par
   * déploiement, sur le chemin d'administration, jamais sur une requête.
   *
   * @returns `false` si un autre pod reconstruit en ce moment : le comptage
   *   rend alors « inconnu », pas un chiffre partiel.
   */
  #ensureIndexBuilt(client: IndexClient): Promise<boolean> {
    this.#building ??= this.#buildIndex(client).finally(() => {
      this.#building = null;
    });
    return this.#building;
  }

  async #buildIndex(client: IndexClient): Promise<boolean> {
    const index = this.#index();
    if ((await client.get(index.builtKey)) !== null) return true;
    const locked = await client.set(index.lockKey, String(process.pid), {
      condition: "NX",
      expiration: { type: "EX", value: 300 },
    });
    if (locked === null) return false;
    try {
      const prefixLen = this.#prefix().length + 1;
      let cursor = "0";
      let indexed = 0;
      do {
        const res = await client.scan(cursor, {
          MATCH: `${this.#prefix()}:*`,
          COUNT: 500,
        });
        cursor = res.cursor;
        for (const key of res.keys) {
          const [raw, ttl] = await Promise.all([
            client.get(key),
            client.pTTL(key),
          ]);
          if (!raw || ttl <= 0) continue;
          const data = parseSession(raw);
          if (!data) continue;
          await index.add(client, {
            id: key.slice(prefixLen),
            user: ownerOf(data),
            expiresAt: Date.now() + ttl,
          });
          indexed += 1;
        }
      } while (cursor !== "0");
      await client.set(index.builtKey, String(Date.now()));
      this.manager.log(
        `REDIS SESSIONS index reconstruit : ${indexed} session(s)`,
        "INFO",
      );
      return true;
    } finally {
      await client.del(index.lockKey);
    }
  }

  /** Le client `main`, s'il sait exécuter les scripts de l'index. */
  #clientForIndex(): IndexClient | null {
    const client = this.#client();
    return client && supportsScripts(client) ? client : null;
  }

  /**
   * {@inheritDoc ISessionStorage.countSessions}
   *
   * Compté par l'INDEX (`sessionIndex.ts`), jamais par balayage : `ZCOUNT` sur
   * les sessions dont l'expiration est à venir. Même périmètre que le filtre
   * de liste — filtres contradictoires (`user` + `authenticated: false`) = 0.
   * Rend **`-1`** (« inconnu ») quand l'index n'est pas disponible : client
   * sans scripts, ou reconstruction en cours sur un autre pod.
   */
  async countSessions(query?: Partial<ISessionListQuery>): Promise<number> {
    const client = this.#clientForIndex();
    if (!client || !(await this.#ensureIndexBuilt(client))) return -1;
    const index = this.#index();
    const now = Date.now();
    await index.prune(client, now);
    const user = query?.user;
    const auth = query?.authenticated;
    if (user !== undefined && user !== "") {
      return auth === false ? 0 : index.count(client, { user }, now);
    }
    const anonymous = async () =>
      (await index.count(client, "all", now)) -
      (await index.count(client, "auth", now));
    if (user === "") return auth === true ? 0 : anonymous();
    if (auth === true) return index.count(client, "auth", now);
    if (auth === false) return anonymous();
    return index.count(client, "all", now);
  }

  /**
   * {@inheritDoc ISessionStorage.countDistinctUsers}
   *
   * Les PERSONNES : l'index tient chaque utilisateur avec l'expiration de sa
   * session la plus tardive — il disparaît du compte avec sa dernière session.
   */
  async countDistinctUsers(
    query?: Partial<ISessionListQuery>,
  ): Promise<number> {
    const client = this.#clientForIndex();
    if (!client || !(await this.#ensureIndexBuilt(client))) return -1;
    if (query?.authenticated === false || query?.user === "") return 0;
    const index = this.#index();
    const now = Date.now();
    await index.prune(client, now);
    if (query?.user !== undefined) {
      return (await index.count(client, { user: query.user }, now)) > 0 ? 1 : 0;
    }
    return index.count(client, "users", now);
  }
}

// Auto-enregistrement IoC dans le registre de session de @nodefony/http.
// NB : le « redis neutre » du CLAUDE.md est antérieur au chantier session —
// l'archi session actuelle prime : chaque backend porte son storage (comme
// drizzle/mongoose), s'auto-déclare, http ne dépend d'aucun backend.
SessionsService.registerStorage("redis", RedisSessionStorage);

export default RedisSessionStorage;
