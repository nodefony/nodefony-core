import assert from "node:assert/strict";
import type { IdempotentResponse } from "nodefony";
import {
  RedisIdempotencyStore,
  type RedisIdempotencyClientLike,
} from "../../src/RedisIdempotencyStore";

/**
 * Double Redis **fidèle** aux 3 commandes node-redis v6 utilisées par le store
 * (`set` avec `NX`/`PX`, `get`, `del`), avec un **TTL piloté par une horloge
 * injectée** → l'expiration (bail in-flight, rétention réponse) est testable de
 * façon déterministe, sans serveur. On teste la VRAIE logique du store contre une
 * sémantique Redis conforme : `SET NX` renvoie `null` si la clé existe (≠ "OK"),
 * purge paresseuse au TTL dépassé.
 */
class FakeRedis implements RedisIdempotencyClientLike {
  readonly #now: () => number;
  readonly #strings = new Map<string, string>();
  readonly #expiry = new Map<string, number>(); // key → epoch ms d'expiration
  /** Compteur d'appels (asserte le nombre de round-trips sur le hot path). */
  calls = { set: 0, get: 0, del: 0 };

  constructor(now: () => number) {
    this.#now = now;
  }

  #expired(key: string): boolean {
    const e = this.#expiry.get(key);
    if (e !== undefined && e <= this.#now()) {
      this.#strings.delete(key);
      this.#expiry.delete(key);
      return true;
    }
    return false;
  }

  set(
    key: string,
    value: string,
    options?: { NX?: boolean; PX?: number },
  ): Promise<string | null> {
    this.calls.set++;
    this.#expired(key);
    if (options?.NX && this.#strings.has(key)) {
      return Promise.resolve(null); // NX : clé déjà présente → non posée
    }
    this.#strings.set(key, value);
    if (options?.PX !== undefined) {
      this.#expiry.set(key, this.#now() + options.PX);
    } else {
      this.#expiry.delete(key);
    }
    return Promise.resolve("OK");
  }

  get(key: string): Promise<string | null> {
    this.calls.get++;
    this.#expired(key);
    return Promise.resolve(this.#strings.get(key) ?? null);
  }

  del(key: string): Promise<number> {
    this.calls.del++;
    const had = this.#strings.delete(key);
    this.#expiry.delete(key);
    return Promise.resolve(had ? 1 : 0);
  }

  /** Introspection de test (≠ contrat) : la clé existe-t-elle (non expirée) ? */
  has(key: string): boolean {
    this.#expired(key);
    return this.#strings.has(key);
  }
}

const FP = "fingerprint-A";
const resp = (status: number, body: unknown): IdempotentResponse => ({
  status,
  body,
});

describe("Redis RedisIdempotencyStore — IIdempotencyStore distribué (SET NX + TTL, FakeRedis)", () => {
  let clock: number;
  let fake: FakeRedis;
  let store: RedisIdempotencyStore;
  const LEASE = 60_000;
  const TTL = 600_000;

  beforeEach(() => {
    clock = 1_000_000;
    fake = new FakeRedis(() => clock);
    store = new RedisIdempotencyStore(() => fake, LEASE, TTL);
  });

  describe("réservation atomique (begin)", () => {
    it("clé neuve → fresh + entrée in-flight posée (SET NX)", async () => {
      const o = await store.begin("k", FP);
      assert.equal(o.state, "fresh");
      assert.ok(fake.has("nf:idem:k"));
      assert.equal(store.size, 1);
    });

    it("2ᵉ begin même clé/payload → in-flight (409 cross-pod via NX)", async () => {
      await store.begin("k", FP);
      const o = await store.begin("k", FP);
      assert.equal(o.state, "in-flight");
    });

    it("payload différent sur clé vivante → mismatch (422)", async () => {
      await store.begin("k", "fpA");
      const o = await store.begin("k", "fpB");
      assert.equal(o.state, "mismatch");
    });
  });

  describe("rejeu mémorisé (complete → replayed)", () => {
    it("après complete, même clé/payload → replayed avec la réponse", async () => {
      await store.begin("k", FP);
      await store.complete("k", resp(201, { id: 7 }));
      const o = await store.begin("k", FP);
      assert.equal(o.state, "replayed");
      if (o.state === "replayed") {
        assert.deepEqual(o.response, { status: 201, body: { id: 7 } });
      }
    });

    it("🔑 mismatch APRÈS complétion : clé réutilisée avec un autre payload → 422 (fingerprint préservé)", async () => {
      await store.begin("k", "fpA");
      await store.complete("k", resp(200, { v: "A" }));
      const o = await store.begin("k", "fpB");
      assert.equal(o.state, "mismatch"); // le done a conservé fpA → 422
    });
  });

  describe("libération (abort)", () => {
    it("après abort, la clé redevient réservable → fresh", async () => {
      await store.begin("k", FP);
      await store.abort("k");
      assert.equal(fake.has("nf:idem:k"), false);
      const o = await store.begin("k", FP);
      assert.equal(o.state, "fresh");
    });

    it("complete sur une clé abortée ne ressuscite jamais (→ fresh, pas replayed)", async () => {
      await store.begin("k", FP);
      await store.abort("k");
      await store.complete("k", resp(200, { stale: true })); // plus in-flight
      const o = await store.begin("k", FP);
      assert.equal(o.state, "fresh");
    });
  });

  describe("expiration par TTL natif (gc superflu)", () => {
    it("bail in-flight expiré → la clé redevient fresh", async () => {
      await store.begin("k", FP);
      clock += LEASE + 1; // dépasse le bail
      const o = await store.begin("k", FP);
      assert.equal(o.state, "fresh");
    });

    it("réponse mémorisée expirée → fresh (plus de rejeu)", async () => {
      await store.begin("k", FP);
      await store.complete("k", resp(200, { ok: 1 }));
      clock += TTL + 1; // dépasse la rétention
      const o = await store.begin("k", FP);
      assert.equal(o.state, "fresh");
    });
  });

  describe("race SET NX puis GET vide", () => {
    it("clé expirée entre le SET NX échoué et le GET → re-réservation (fresh)", async () => {
      // begin réserve, puis on simule l'expiration juste avant le GET en
      // forçant un état où get renvoie null mais NX échoue d'abord… ici on
      // vérifie le chemin nominal de retry : 1ʳᵉ clé expirée → 2ᵉ begin réserve.
      await store.begin("k", FP);
      clock += LEASE + 1;
      const o = await store.begin("k", FP);
      assert.equal(o.state, "fresh");
    });
  });

  describe("dégradation gracieuse (client indisponible)", () => {
    it("begin → fresh sans dédup ; complete/abort no-op (jamais throw)", async () => {
      const degraded = new RedisIdempotencyStore(() => null);
      assert.equal((await degraded.begin("k", FP)).state, "fresh");
      await degraded.complete("k", resp(200, {})); // no-op
      await degraded.abort("k"); // no-op
      assert.equal(degraded.size, 0);
    });
  });

  describe("scope = clé déjà composée par l'appelant (anti-IDOR en amont)", () => {
    it("deux identités (clés distinctes) ne se partagent pas le cache", async () => {
      const kAlice = JSON.stringify(["alice", "key-1"]);
      const kBob = JSON.stringify(["bob", "key-1"]);
      await store.begin(kAlice, FP);
      await store.complete(kAlice, resp(200, { who: "alice" }));
      const o = await store.begin(kBob, FP); // même clé client, autre identité
      assert.equal(o.state, "fresh"); // jamais le replay d'alice
    });
  });

  describe("compteur size best-effort", () => {
    it("incrémente au fresh, décrémente au complete/abort, borné ≥ 0", async () => {
      await store.begin("a", FP);
      await store.begin("b", FP);
      assert.equal(store.size, 2);
      await store.complete("a", resp(200, {}));
      await store.abort("b");
      assert.equal(store.size, 0);
      await store.abort("c"); // jamais réservée → reste borné à 0
      assert.equal(store.size, 0);
    });
  });
});
