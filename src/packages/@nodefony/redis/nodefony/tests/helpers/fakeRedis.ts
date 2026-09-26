import {
  MONOTONIC_SET_SCRIPT,
  type RedisClientLike,
} from "../../src/RedisTokenStore";

/**
 * Double Redis **fidèle** aux commandes node-redis v6 utilisées par le store,
 * avec un **TTL piloté par une horloge injectée** → l'expiration est testable de
 * façon déterministe, sans serveur (on avance `CLOCK`, le double purge à la
 * lecture). On teste la VRAIE logique du store contre une sémantique Redis
 * conforme (HASH, SET, EX, EXPIRE, type bracketing du TTL).
 */
export class FakeRedis implements RedisClientLike {
  readonly #now: () => number;
  readonly #hashes = new Map<string, Map<string, string>>();
  readonly #strings = new Map<string, string>();
  readonly #sets = new Map<string, Set<string>>();
  readonly #expiry = new Map<string, number>(); // key → epoch ms d'expiration

  constructor(now: () => number) {
    this.#now = now;
  }

  #purge(key: string): void {
    this.#hashes.delete(key);
    this.#strings.delete(key);
    this.#sets.delete(key);
    this.#expiry.delete(key);
  }

  /** Purge paresseuse si le TTL est dépassé (modèle Redis). `true` si purgé. */
  #expired(key: string): boolean {
    const e = this.#expiry.get(key);
    if (e !== undefined && e <= this.#now()) {
      this.#purge(key);
      return true;
    }
    return false;
  }

  #has(key: string): boolean {
    return (
      this.#hashes.has(key) || this.#strings.has(key) || this.#sets.has(key)
    );
  }

  hSet(key: string, fields: Record<string, string>): Promise<number> {
    this.#expired(key);
    let m = this.#hashes.get(key);
    if (!m) {
      m = new Map();
      this.#hashes.set(key, m);
    }
    let n = 0;
    for (const [k, v] of Object.entries(fields)) {
      if (!m.has(k)) {
        n++;
      }
      m.set(k, v);
    }
    return Promise.resolve(n);
  }

  hGetAll(key: string): Promise<Record<string, string>> {
    if (this.#expired(key)) {
      return Promise.resolve({});
    }
    const m = this.#hashes.get(key);
    return Promise.resolve(m ? Object.fromEntries(m) : {});
  }

  hDel(key: string, field: string): Promise<number> {
    this.#expired(key);
    const m = this.#hashes.get(key);
    return Promise.resolve(m?.delete(field) ? 1 : 0);
  }

  get(key: string): Promise<string | null> {
    if (this.#expired(key)) {
      return Promise.resolve(null);
    }
    return Promise.resolve(this.#strings.get(key) ?? null);
  }

  set(key: string, value: string, options?: { EX?: number }): Promise<unknown> {
    this.#purge(key); // SET remplace la valeur ET réinitialise le TTL.
    this.#strings.set(key, value);
    if (options?.EX !== undefined) {
      this.#expiry.set(key, this.#now() + options.EX * 1000);
    }
    return Promise.resolve("OK");
  }

  del(key: string): Promise<number> {
    const had = this.#has(key);
    this.#purge(key);
    return Promise.resolve(had ? 1 : 0);
  }

  exists(key: string): Promise<number> {
    if (this.#expired(key)) {
      return Promise.resolve(0);
    }
    return Promise.resolve(this.#has(key) ? 1 : 0);
  }

  expire(key: string, seconds: number): Promise<unknown> {
    if (this.#expired(key) || !this.#has(key)) {
      return Promise.resolve(false);
    }
    this.#expiry.set(key, this.#now() + seconds * 1000);
    return Promise.resolve(true);
  }

  sAdd(key: string, member: string): Promise<number> {
    this.#expired(key);
    let s = this.#sets.get(key);
    if (!s) {
      s = new Set();
      this.#sets.set(key, s);
    }
    const had = s.has(member);
    s.add(member);
    return Promise.resolve(had ? 0 : 1);
  }

  sRem(key: string, member: string): Promise<number> {
    this.#expired(key);
    const s = this.#sets.get(key);
    return Promise.resolve(s?.delete(member) ? 1 : 0);
  }

  sMembers(key: string): Promise<string[]> {
    if (this.#expired(key)) {
      return Promise.resolve([]);
    }
    const s = this.#sets.get(key);
    return Promise.resolve(s ? [...s] : []);
  }

  scan(
    _cursor: string,
    options?: { MATCH?: string; COUNT?: number },
  ): Promise<{ cursor: string; keys: string[] }> {
    // Double déterministe : une seule passe (curseur 0). MATCH glob simple (`*`)
    // sur les HASH vivants (les records sont stockés en `rec:<id>`).
    const pattern = options?.MATCH;
    const re = pattern
      ? new RegExp(
          "^" +
            pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") +
            "$",
        )
      : null;
    const keys: string[] = [];
    // Le spread n'est PAS superflu : `#expired()` appelle `#purge()`, qui
    // supprime de `#hashes`. On itère donc sur un instantané pris AVANT la
    // mutation, pas sur l'itérateur vivant de la Map qu'on est en train de vider.
    // oxlint-disable-next-line no-useless-spread
    for (const key of [...this.#hashes.keys()]) {
      if (this.#expired(key)) {
        continue;
      }
      if (!re || re.test(key)) {
        keys.push(key);
      }
    }
    return Promise.resolve({ cursor: "0", keys });
  }

  /**
   * `EVAL` des SEULS scripts que le store envoie, exécutés d'un bloc — c'est
   * l'atomicité du vrai Redis (aucune autre commande ne s'intercale). Un script
   * inconnu lève : le double ne fait pas semblant.
   */
  eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown> {
    if (script === MONOTONIC_SET_SCRIPT) {
      const [key] = options.keys;
      const next = Number(options.arguments[0]);
      this.#expired(key);
      const current = this.#strings.get(key);
      if (current === undefined || next > Number(current)) {
        this.#purge(key);
        this.#strings.set(key, String(next));
      }
      return Promise.resolve(1);
    }
    return Promise.reject(new Error("FakeRedis: script EVAL inconnu"));
  }
}
