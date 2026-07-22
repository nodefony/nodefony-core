import assert from "node:assert/strict";
import type { IdempotentResponse } from "nodefony";
import {
  RedisIdempotencyStore,
  type RedisIdempotencyClientLike,
} from "../../src/RedisIdempotencyStore";
import { runIdempotencyPaginationContract } from "../../../../../../nodefony/src/tests/support/idempotencyPaginationContract";

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
  calls = { set: 0, get: 0, del: 0, scan: 0 };

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

  /**
   * `SCAN` fidèle sur UN point qui compte : **`COUNT` n'est pas un plafond**.
   * Ce double rend TOUT le keyspace en un seul batch (curseur `0`), exactement
   * comme Redis sur un petit keyspace encodé en listpack — c'est ce
   * comportement qui a fait déborder une page en production du banc sessions.
   */
  scan(
    _cursor: string,
    options?: { MATCH?: string; COUNT?: number },
  ): Promise<{ cursor: string | number; keys: string[] }> {
    this.calls.scan++;
    const all = [...this.#strings.keys()].filter((k) => !this.#expired(k));
    const match = options?.MATCH;
    const keys =
      match === undefined
        ? all
        : all.filter((k) => {
            // Glob Redis limité au seul motif utilisé : `préfixe*`.
            const star = match.indexOf("*");
            return star === -1
              ? k === match
              : k.startsWith(match.slice(0, star));
          });
    return Promise.resolve({ cursor: "0", keys });
  }

  pTTL(key: string): Promise<number> {
    if (this.#expired(key) || !this.#strings.has(key)) {
      return Promise.resolve(-2); // clé absente
    }
    const e = this.#expiry.get(key);
    return Promise.resolve(e === undefined ? -1 : e - this.#now());
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

// Standard de pagination : LE banc du propriétaire du contrat (le CORE),
// déroulé sur le backend Redis — capacité CURSEUR (SCAN, ni total ni ordre).
// Le double rend tout le keyspace en un batch, ce qui exerce précisément le
// garde-fou « COUNT n'est pas un plafond » du curseur composite.
let pagedClock = 2_000_000;
let pagedFake = new FakeRedis(() => pagedClock);
let pagedStore = new RedisIdempotencyStore(() => pagedFake, 60_000, 600_000);
runIdempotencyPaginationContract({
  store: () => pagedStore,
  clear: async () => {
    pagedClock = 2_000_000;
    pagedFake = new FakeRedis(() => pagedClock);
    pagedStore = new RedisIdempotencyStore(() => pagedFake, 60_000, 600_000);
  },
  mode: "cursor",
  seed: async (prefix, n) => {
    for (let i = 0; i < n; i += 1) {
      const key = `${prefix}-${String(i).padStart(2, "0")}`;
      await pagedStore.begin(key, FP);
      if (i % 2 === 0) await pagedStore.complete(key, resp(200, { i }));
    }
  },
});

/**
 * **Deux applications sur un même Redis ne partagent pas leurs clés
 * d'idempotence.**
 *
 * L'enjeu dépasse ici la fuite de lecture. L'idempotence répond à la question
 * « ai-je déjà traité cette demande ? » — et rend, le cas échéant, la réponse
 * mémorisée. Deux applications partageant l'espace de clés, la demande de l'une
 * pouvait être prise pour un rejeu par l'autre, qui lui rendait alors une réponse
 * qu'elle n'avait jamais produite.
 *
 * Le risque était atténué — la clé est déjà scopée à l'identité de l'appelant en
 * amont (`evaluateIdempotency` compose `[identity, clientKey]`) — mais pas
 * refermé : deux applications ont volontiers un compte au même identifiant
 * (`admin`), et une clé cliente peut être prévisible (un numéro de commande, une
 * date). L'atténuation reposait sur une convention d'appelant, pas sur le
 * stockage.
 */
describe("Cloison des clés d'idempotence par application", () => {
  const now = () => 1_800_000_000_000;
  const CLE = "admin:commande-42"; // identité + clé cliente, toutes deux plausibles

  function storeFor(app: string | undefined, redis: FakeRedis) {
    return new RedisIdempotencyStore(
      () => redis,
      undefined,
      undefined,
      () => (app ? `nf:${app}:idem` : "nf:idem"),
    );
  }

  it("une application ne reçoit JAMAIS la réponse mémorisée d'une autre", async () => {
    const redis = new FakeRedis(now); // un seul serveur, deux applications
    const boutique = storeFor("boutique", redis);
    const intranet = storeFor("intranet", redis);

    // « boutique » traite la demande et mémorise sa réponse.
    assert.equal((await boutique.begin(CLE, "fp-1")).state, "fresh");
    await boutique.complete(CLE, {
      status: 201,
      headers: {},
      body: "commande de boutique",
    } as IdempotentResponse);

    // « intranet » présente la MÊME clé : pour elle, c'est une demande neuve.
    const chezIntranet = await intranet.begin(CLE, "fp-1");
    assert.equal(
      chezIntranet.state,
      "fresh",
      "la demande d'une autre application ne doit pas passer pour un rejeu",
    );
    assert.equal(
      (chezIntranet as { response?: unknown }).response,
      undefined,
      "et surtout : aucune réponse d'autrui ne lui est rendue",
    );
  });

  it("CONTRÔLE NÉGATIF — sans cloison, la réponse d'autrui EST rendue", async () => {
    // Le tir qui valide l'instrument : sans cloison, le défaut se voit.
    const redis = new FakeRedis(now);
    const appA = storeFor(undefined, redis);
    const appB = storeFor(undefined, redis);

    assert.equal((await appA.begin(CLE, "fp-1")).state, "fresh");
    await appA.complete(CLE, {
      status: 201,
      headers: {},
      body: "réponse de A",
    } as IdempotentResponse);

    const chezB = await appB.begin(CLE, "fp-1");
    assert.equal(
      chezB.state,
      "replayed",
      "sans cloison, B voit bien la demande de A comme un rejeu",
    );
  });

  it("l'inventaire d'administration est cloisonné lui aussi", async () => {
    const redis = new FakeRedis(now);
    const boutique = storeFor("boutique", redis);
    const intranet = storeFor("intranet", redis);
    await boutique.begin("k-boutique", "fp");
    await intranet.begin("k-intranet", "fp");

    const vue = await boutique.listPage({ limit: 50 });
    assert.deepEqual(
      vue.items.map((e) => e.key),
      ["k-boutique"],
    );
  });
});
