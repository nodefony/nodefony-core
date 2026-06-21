import type {
  ISessionStorage,
  ISerializedSession,
  ISessionRecord,
  ISessionListFilter,
} from "../../../interfaces/ISession";

/**
 * Durée de vie (ms) d'une pierre tombale de révocation. Couvre la fenêtre
 * pendant laquelle une requête « en vol » — qui avait chargé la session AVANT
 * sa révocation — pourrait tenter un `write` tardif (autosave de fin de requête)
 * et la ressusciter. Une requête HTTP dure des secondes ; on prend large (5 min)
 * pour couvrir les requêtes longues (upload/SSE) sans risque : un id révoqué
 * n'est JAMAIS réémis (ids opaques CSPRNG), tombstoner ne bloque aucune session
 * légitime.
 */
const TOMBSTONE_TTL_MS = 5 * 60_000;

/**
 * Garde-fou de révocation **décoré au-dessus** de n'importe quel
 * {@link ISessionStorage} (file, drizzle, redis, mongo…). Pose une « pierre
 * tombale » sur tout id détruit et REFUSE un `write` ultérieur de ce même id
 * pendant {@link TOMBSTONE_TTL_MS}.
 *
 * **Pourquoi ici, pas dans chaque store** : la résurrection est une propriété du
 * CYCLE DE VIE de session — révoquer une session puis l'autosave de fin de
 * requête (la requête la portait encore en mémoire, `dirty`) la ré-écrit — et
 * NON d'un backend particulier. Un seul garde-fou décoré sur le storage actif
 * couvre donc TOUS les backends, présents et futurs, **sans en modifier aucun**.
 *
 * Découvert en live le 2026-06-21 (« révoquer une session ne déconnecte pas ») ;
 * le store réel était `drizzle`, pas `files` — d'où la décoration générique.
 *
 * Couvre deux scénarios :
 *  - **self** : l'admin révoque SA PROPRE session ; l'autosave de la requête de
 *    révocation tente de la réécrire → refusé.
 *  - **race** : un autre client du user révoqué a une requête en vol dont
 *    l'autosave arrive après la révocation → refusé.
 *
 * **Perf** : décorateur **singleton** (1 par service). Délégation directe sur le
 * hot-path lecture (`read`/`start`/`listAll`) ; `write` ne paie qu'un test
 * `=== null` tant qu'aucune session n'a été révoquée (Map **lazy**, jamais de
 * `Date.now()` dans ce cas).
 */
class RevocationGuardStorage implements ISessionStorage {
  /** Storage réel décoré — exposé pour l'introspection admin (nom du driver). */
  readonly inner: ISessionStorage;

  /** `id → epoch ms d'expiration`. **Lazy** : `null` tant qu'aucune révocation. */
  #tombstones: Map<string, number> | null = null;

  /**
   * Énumération admin — (ré)assignée dans le constructeur **uniquement** si le
   * backend décoré la supporte, pour que `SessionsService.supportsEnumeration`
   * (`typeof storage.listAll === "function"`) reflète la vraie capacité du store.
   */
  listAll?: (filter?: ISessionListFilter) => Promise<ISessionRecord[]>;

  constructor(inner: ISessionStorage) {
    this.inner = inner;
    if (typeof inner.listAll === "function") {
      this.listAll = (filter?: ISessionListFilter) => inner.listAll!(filter);
    }
  }

  // ── Délégation pure (hot-path lecture / cycle storage) ───────────────────────
  read(id: string): Promise<ISerializedSession> {
    return this.inner.read(id);
  }
  start(id: string): Promise<ISerializedSession> {
    return this.inner.start(id);
  }
  open(): Promise<number> {
    return this.inner.open();
  }
  close(): boolean {
    return this.inner.close();
  }
  gc(maxlifetime?: number): Promise<void> {
    return this.inner.gc(maxlifetime);
  }

  // ── Interception : destroy pose la pierre tombale, write la respecte ─────────
  async destroy(id: string): Promise<boolean> {
    // Pierre tombale AVANT de déléguer : tout `write(id)` ultérieur est refusé
    // → la session révoquée ne peut plus renaître (self + race).
    this.#revoke(id);
    return this.inner.destroy(id);
  }

  write(id: string, data: ISerializedSession): Promise<ISerializedSession> {
    if (this.#isRevoked(id)) {
      // No-op silencieux : on résout `data` pour que `Session.save` poursuive
      // sans erreur (l'objet en mémoire est éphémère ; l'entrée storage reste
      // détruite).
      return Promise.resolve(data);
    }
    return this.inner.write(id, data);
  }

  // ── Pierres tombales (hors hot-path : révocation/logout, peu fréquent) ───────
  #revoke(id: string): void {
    const now = Date.now();
    this.#purgeExpired(now); // peut relâcher la Map à null
    if (this.#tombstones === null) this.#tombstones = new Map();
    this.#tombstones.set(id, now + TOMBSTONE_TTL_MS);
  }

  #isRevoked(id: string): boolean {
    const t = this.#tombstones;
    if (t === null) return false; // hot-path normal : 0 Date.now()
    const expiry = t.get(id);
    return expiry !== undefined && expiry > Date.now();
  }

  #purgeExpired(now: number): void {
    const t = this.#tombstones;
    if (t === null) return;
    for (const [id, expiry] of t) {
      if (expiry <= now) t.delete(id);
    }
    if (t.size === 0) this.#tombstones = null;
  }
}

export default RevocationGuardStorage;
