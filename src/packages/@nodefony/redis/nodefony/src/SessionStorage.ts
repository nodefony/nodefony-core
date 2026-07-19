import { SessionsService } from "@nodefony/http";
import type {
  ISessionStorage,
  ISerializedSession,
  ISessionRecord,
  ISessionListFilter,
  ISessionListQuery,
} from "@nodefony/http";
import type { IPage } from "nodefony";
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
 * Curseur de page **composite** : `"<skip>:<curseurRedis>"`.
 *
 * Pourquoi composer plutôt que passer le curseur Redis nu : `SCAN COUNT` est un
 * indice d'effort, pas un plafond — un batch peut contenir plus de clés qu'une
 * page. Le `skip` mémorise combien de clés de CE batch ont déjà été rendues, pour
 * que la page suivante rejoue le même `SCAN` et reprenne à la bonne position.
 *
 * Le split se fait au PREMIER `:` : le curseur Redis est opaque et reste intact
 * même s'il contenait lui-même un `:`.
 */
function encodeCursor(scanCursor: string, skip: number): string {
  return `${skip}:${scanCursor}`;
}

/**
 * Inverse d'{@link encodeCursor} — tolère un curseur absent, vide ou malformé.
 *
 * Le jeton vient de l'extérieur (query string du data plane admin, client qui
 * rejoue une page) : il n'est donc PAS digne de confiance. Un curseur `SCAN`
 * Redis est toujours une suite de chiffres — tout le reste repart de `"0"`
 * plutôt que d'être transmis au serveur, qui répondrait par une erreur et ferait
 * échouer une simple consultation. Repartir du début est faux au pire d'une
 * page ; jeter serait faux à coup sûr.
 */
function decodeCursor(cursor?: string): { scanCursor: string; skip: number } {
  if (!cursor) return { scanCursor: "0", skip: 0 };
  const sep = cursor.indexOf(":");
  if (sep === -1) {
    // Curseur Redis nu (client externe, ancien format) → honoré s'il est valide.
    return { scanCursor: scanOrZero(cursor), skip: 0 };
  }
  const skip = Number.parseInt(cursor.slice(0, sep), 10);
  return {
    scanCursor: scanOrZero(cursor.slice(sep + 1)),
    skip: Number.isFinite(skip) && skip > 0 ? skip : 0,
  };
}

/** Un curseur `SCAN` exploitable (chiffres) ou `"0"` — jamais du texte libre. */
function scanOrZero(value: string): string {
  return /^\d+$/.test(value) ? value : "0";
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
 * Dégradation gracieuse : si la connexion `main` n'est pas (ou plus) ouverte
 * (boot/shutdown), chaque opération devient un no-op silencieux plutôt que de
 * jeter (la session n'est juste pas persistée le temps de l'indisponibilité).
 */
class RedisSessionStorage implements ISessionStorage {
  manager: SessionsService;
  /** Idle timeout en secondes (= TTL Redis natif, glissant via `write`/`touch`). */
  idleTimeoutS: number;
  /** Service Redis résolu en lazy (au 1ᵉʳ accès) depuis le container. */
  #service: RedisService | null = null;

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
      // SET … EX : TTL natif = idle timeout. Session glissante — le TTL est
      // rafraîchi à chaque write (mutation) ET à chaque `touch` (activité pure).
      await client.set(this.#key(id), JSON.stringify(payload), {
        EX: this.idleTimeoutS,
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

  /**
   * {@inheritDoc ISessionStorage.listPage}
   *
   * **Curseur SCAN** : au plus UN passage `SCAN` par appel (cold-path admin).
   * Capacité réduite ASSUMÉE et annoncée — pas de `total`, pas d'ordre global sur
   * `updatedAt` (Redis n'a pas d'index secondaire ici), et la page peut compter
   * moins d'éléments que `limit` (le filtre s'applique au batch scanné). Le client
   * boucle tant que `hasNext`, en repassant `nextCursor`. La garantie qui compte
   * est tenue : **le keyspace n'est jamais matérialisé** — au plus un batch.
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
    const limit = Math.max(1, Math.floor(query.limit));
    const client = this.#client();
    if (!client) {
      return { items: [], limit, hasNext: false, nextCursor: null };
    }
    const { scanCursor, skip } = decodeCursor(query.cursor);
    const res = await client.scan(scanCursor, {
      MATCH: `${KEY_PREFIX}:*`,
      COUNT: limit,
    });
    const next = String(res.cursor);
    const prefixLen = KEY_PREFIX.length + 1;
    const items: ISessionRecord[] = [];
    // `consumed` compte les CLÉS du batch parcourues (pas les items rendus) :
    // c'est la position de reprise, et le filtre en écarte une partie.
    let consumed = 0;
    for (const key of res.keys.slice(skip)) {
      if (items.length >= limit) break; // page pleine → on garde le reste pour après
      consumed += 1;
      const raw = await client.get(key);
      if (!raw) continue;
      let data: ISerializedSession;
      try {
        data = JSON.parse(raw) as ISerializedSession;
      } catch {
        continue; // valeur corrompue → ignorée
      }
      if (query.user !== undefined && data.user !== query.user) continue;
      if (
        query.authenticated !== undefined &&
        !!data.user !== query.authenticated
      ) {
        continue;
      }
      // Redaction par construction (garantie du contrat) : le blob Redis porte
      // tout, mais un record d'énumération admin ne sort jamais avec les données
      // métier. Ici la vidange est explicite — un `GET` ne sait pas projeter.
      items.push({
        id: key.slice(prefixLen),
        data: { ...data, Attributes: {}, flashBag: {} },
      });
    }
    // Reste-t-il des clés NON consommées dans le batch courant ?
    const restInBatch = skip + consumed < res.keys.length;
    const nextCursor = restInBatch
      ? encodeCursor(scanCursor, skip + consumed) // on reste sur ce batch
      : next === "0"
        ? null // batch épuisé ET scan terminé
        : encodeCursor(next, 0); // batch épuisé, on avance
    return { items, limit, hasNext: nextCursor !== null, nextCursor };
  }

  /**
   * {@inheritDoc ISessionStorage.countSessions}
   *
   * Un comptage exact exigerait un `SCAN` complet O(keyspace) → refusé même sur le
   * cold-path admin : renvoie **`-1`** (« inconnu », capacité réduite Redis
   * assumée). L'appelant affiche l'inconnu, il ne l'invente pas.
   */
  countSessions(_query?: ISessionListQuery): Promise<number> {
    return Promise.resolve(-1);
  }
}

// Auto-enregistrement IoC dans le registre de session de @nodefony/http.
// NB : le « redis neutre » du CLAUDE.md est antérieur au chantier session —
// l'archi session actuelle prime : chaque backend porte son storage (comme
// drizzle/mongoose), s'auto-déclare, http ne dépend d'aucun backend.
SessionsService.registerStorage("redis", RedisSessionStorage);

export default RedisSessionStorage;
