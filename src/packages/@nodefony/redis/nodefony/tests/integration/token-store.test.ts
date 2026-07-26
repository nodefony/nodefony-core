import assert from "node:assert/strict";
import type { IAccessTokenRecord } from "@nodefony/security";
import { redisTestUrl } from "../helpers/redisTestUrl";
import {
  RedisTokenStore,
  type RedisClientLike,
} from "../../src/RedisTokenStore";

/**
 * Double Redis **fidèle** aux commandes node-redis v6 utilisées par le store,
 * avec un **TTL piloté par une horloge injectée** → l'expiration est testable de
 * façon déterministe, sans serveur (on avance `CLOCK`, le double purge à la
 * lecture). On teste la VRAIE logique du store contre une sémantique Redis
 * conforme (HASH, SET, EX, EXPIRE, type bracketing du TTL).
 */
class FakeRedis implements RedisClientLike {
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
    return Promise.resolve(m && m.delete(field) ? 1 : 0);
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
    return Promise.resolve(s && s.delete(member) ? 1 : 0);
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
}

let CLOCK = 1_000_000;
const now = () => CLOCK;
const RET = 30 * 24 * 3_600_000;

function makeRecord(
  over: Partial<IAccessTokenRecord> & Pick<IAccessTokenRecord, "id">,
): IAccessTokenRecord {
  return {
    kind: "pat",
    name: "test",
    prefix: null,
    subjectId: "u1",
    subjectType: "user",
    tenantId: null,
    scopes: [],
    audience: [],
    resources: null,
    secretHash: `hash-${over.id}`,
    hashAlg: "sha256",
    clientId: null,
    cnf: null,
    family: null,
    replacedBy: null,
    createdAt: CLOCK,
    expiresAt: null,
    lastUsedAt: null,
    lastUsedIp: null,
    lastUsedUserAgent: null,
    revokedAt: null,
    revokedReason: null,
    metadata: {},
    ...over,
  };
}

describe("Redis RedisTokenStore — ITokenStore + TTL natif (J4b, FakeRedis)", () => {
  let store: RedisTokenStore;

  beforeEach(() => {
    CLOCK = 1_000_000;
  });

  // Un FakeRedis partagé pour la durée du test (le store résout le client à
  // chaque op → on fige la même instance, sinon chaque op repartirait à vide).
  function withSharedFake(): RedisTokenStore {
    const fake = new FakeRedis(now);
    return new RedisTokenStore(() => fake, now, RET);
  }

  describe("records (put / find)", () => {
    it("put + findById restitue le record (HASH décodé)", async () => {
      store = withSharedFake();
      await store.put(
        makeRecord({
          id: "t1",
          scopes: ["orders:read", "orders:write"],
          audience: ["api"],
          metadata: { ci: true },
        }),
      );
      const r = await store.findById("t1");
      assert.ok(r);
      assert.equal(r.id, "t1");
      assert.deepEqual(r.scopes, ["orders:read", "orders:write"]);
      assert.deepEqual(r.audience, ["api"]);
      assert.deepEqual(r.metadata, { ci: true });
      assert.equal(r.kind, "pat");
      assert.equal(r.expiresAt, null);
      assert.equal(r.prefix, null);
    });

    it("findByHash retrouve par hash ; null si inconnu", async () => {
      store = withSharedFake();
      await store.put(makeRecord({ id: "t1" }));
      const r = await store.findByHash("hash-t1");
      assert.equal(r?.id, "t1");
      assert.equal(await store.findByHash("inconnu"), null);
    });

    it("put upsert : pas de doublon, champs remplacés", async () => {
      store = withSharedFake();
      await store.put(makeRecord({ id: "t1", name: "v1" }));
      await store.put(makeRecord({ id: "t1", name: "v2" }));
      const all = await store.findBySubject("u1");
      assert.equal(all.length, 1);
      assert.equal(all[0].name, "v2");
    });

    it("markUsed pose lastUsedAt/ip/ua ; no-op si id inconnu", async () => {
      store = withSharedFake();
      await store.put(makeRecord({ id: "t1" }));
      await store.markUsed("t1", { at: 1234, ip: "10.0.0.1", userAgent: "ua" });
      const r = await store.findById("t1");
      assert.equal(r?.lastUsedAt, 1234);
      assert.equal(r?.lastUsedIp, "10.0.0.1");
      assert.equal(r?.lastUsedUserAgent, "ua");
      await store.markUsed("nope", { at: 1 }); // ne jette pas, ne crée rien
      assert.equal(await store.findById("nope"), null);
    });
  });

  describe("révocation", () => {
    it("revoke idempotent : conserve la 1ʳᵉ date/raison", async () => {
      store = withSharedFake();
      await store.put(makeRecord({ id: "rev1" }));
      CLOCK = 2_000_000;
      await store.revoke("rev1", "logout");
      const a = await store.findById("rev1");
      assert.equal(a?.revokedAt, 2_000_000);
      assert.equal(a?.revokedReason, "logout");
      CLOCK = 3_000_000;
      await store.revoke("rev1", "manual");
      const b = await store.findById("rev1");
      assert.equal(b?.revokedAt, 2_000_000);
      assert.equal(b?.revokedReason, "logout");
    });

    it("revokeFamily coupe les actifs, préserve les déjà-révoqués", async () => {
      store = withSharedFake();
      await store.put(
        makeRecord({
          id: "f1",
          kind: "refresh",
          family: "fam",
          expiresAt: CLOCK + 1_000_000,
          revokedAt: 500,
          revokedReason: "rotated",
        }),
      );
      await store.put(
        makeRecord({
          id: "f2",
          kind: "refresh",
          family: "fam",
          expiresAt: CLOCK + 1_000_000,
        }),
      );
      CLOCK = 1_500_000;
      await store.revokeFamily("fam", "reuse_detected");
      const r1 = await store.findById("f1");
      assert.equal(r1?.revokedAt, 500);
      assert.equal(r1?.revokedReason, "rotated");
      const r2 = await store.findById("f2");
      assert.equal(r2?.revokedAt, 1_500_000);
      assert.equal(r2?.revokedReason, "reuse_detected");
    });

    it("revoke d'un PAT sans exp pose un TTL = rétention (purge auto)", async () => {
      store = withSharedFake();
      await store.put(makeRecord({ id: "pat1" })); // expiresAt null
      await store.revoke("pat1", "manual");
      assert.ok(await store.findById("pat1")); // encore là juste après
      CLOCK += RET + 1; // au-delà de la rétention → TTL natif purge
      assert.equal(await store.findById("pat1"), null);
      assert.equal(await store.findByHash("hash-pat1"), null); // index purgé aussi
    });
  });

  describe("denylist jti (TTL natif EX)", () => {
    it("denyJti → isJtiDenied true, puis false après expiration", async () => {
      store = withSharedFake();
      CLOCK = 5_000_000;
      await store.denyJti("jti-a", 5_500_000); // TTL = 500 s
      assert.equal(await store.isJtiDenied("jti-a"), true);
      CLOCK = 5_600_000; // au-delà de l'EX → Redis a purgé
      assert.equal(await store.isJtiDenied("jti-a"), false);
    });

    it("isJtiDenied = false pour un jti inconnu", async () => {
      store = withSharedFake();
      assert.equal(await store.isJtiDenied("jamais"), false);
    });
  });

  describe("revokeAllForSubject (seuil monotone)", () => {
    it("pose / renvoie le seuil ; ne recule jamais", async () => {
      store = withSharedFake();
      assert.equal(await store.getInvalidBefore("u9"), null);
      await store.revokeAllForSubject("u9", 1000);
      assert.equal(await store.getInvalidBefore("u9"), 1000);
      await store.revokeAllForSubject("u9", 500);
      assert.equal(await store.getInvalidBefore("u9"), 1000);
      await store.revokeAllForSubject("u9", 2000);
      assert.equal(await store.getInvalidBefore("u9"), 2000);
    });
  });

  describe("expiration native + gc no-op", () => {
    it("un refresh expire seul par son exp (TTL), gc() reste no-op", async () => {
      store = withSharedFake();
      await store.put(
        makeRecord({ id: "ref1", kind: "refresh", expiresAt: CLOCK + 10_000 }),
      );
      assert.ok(await store.findById("ref1"));
      assert.equal(await store.gc(), 0); // jamais de balayage applicatif
      CLOCK += 10_001; // au-delà de l'exp → Redis purge
      assert.equal(await store.findById("ref1"), null);
      assert.equal(await store.findByHash("hash-ref1"), null);
      assert.equal(await store.gc(), 0);
    });

    it("findBySubject nettoie les membres orphelins (record expiré)", async () => {
      store = withSharedFake();
      await store.put(
        makeRecord({
          id: "s1",
          subjectId: "uX",
          kind: "refresh",
          expiresAt: CLOCK + 5_000,
        }),
      );
      await store.put(makeRecord({ id: "s2", subjectId: "uX" })); // PAT sans exp
      CLOCK += 5_001; // s1 expire (TTL), s2 reste
      const rows = await store.findBySubject("uX");
      assert.equal(rows.length, 1);
      assert.equal(rows[0].id, "s2");
    });
  });
});

/**
 * Smoke test contre un VRAI serveur Redis (prouve la compat du cast structural +
 * les noms de commandes node-redis v6). Skip si `REDIS_TEST_URL` n'est pas défini
 * (CI sans Redis / poste local zéro-config). Utilise l'horloge réelle (`Date.now`)
 * → pas de test d'expiration TTL ici (pas de fast-forward possible).
 */
// Base DÉDIÉE (cf `redisTestUrl`) : indépendance vis-à-vis des autres fichiers,
// qui purgent la leur.
const REDIS_TEST_URL = redisTestUrl(11);
describe.skipIf(!REDIS_TEST_URL)(
  "Redis RedisTokenStore — serveur réel (REDIS_TEST_URL)",
  () => {
    // Import dynamique : `redis` n'est chargé que si le test tourne.
    it("put/find/markUsed/revoke/deny/subject contre un vrai Redis", async () => {
      const { createClient } = await import("redis");
      // Non-null : le `describe.skipIf(!REDIS_TEST_URL)` garantit l'URL ici.
      const client = createClient({ url: REDIS_TEST_URL! });
      await client.connect();
      const ns = `test:${Date.now()}`;
      try {
        const store = new RedisTokenStore(
          () => client as unknown as RedisClientLike,
        );
        const id = `${ns}:t1`;
        await store.put(
          makeRecord({ id, subjectId: ns, secretHash: `${ns}:h1` }),
        );
        const r = await store.findById(id);
        assert.equal(r?.id, id);
        assert.equal((await store.findByHash(`${ns}:h1`))?.id, id);

        await store.markUsed(id, { at: 42, ip: "1.2.3.4" });
        assert.equal((await store.findById(id))?.lastUsedAt, 42);

        await store.revoke(id, "manual");
        assert.ok((await store.findById(id))?.revokedAt);

        await store.denyJti(`${ns}:jti`, Date.now() + 60_000);
        assert.equal(await store.isJtiDenied(`${ns}:jti`), true);

        await store.revokeAllForSubject(ns, 1000);
        assert.equal(await store.getInvalidBefore(ns), 1000);

        const subj = await store.findBySubject(ns);
        assert.equal(subj.length, 1);
        assert.equal(await store.gc(), 0);
      } finally {
        await client.flushDb();
        await client.close();
      }
    });
  },
);
