import assert from "node:assert/strict";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import type { IdempotentResponse } from "nodefony";
import { DrizzleOrm } from "../../nodefony/src/orm-core/index";
import { DrizzleIdempotencyStore } from "../../nodefony/src/DrizzleIdempotencyStore";
import {
  registerIdempotencyEntities,
  IDEMPOTENCY_ENTITY_NAME,
} from "../../nodefony/entity/idempotencyEntity";

const ORM = "idem_test";

/** Horloge contrôlée (epoch ms) → tests déterministes (bail, rétention, gc). */
let CLOCK = 1_000_000;
const now = () => CLOCK;

const LEASE = 60_000; // bail in-flight
const TTL = 600_000; // rétention réponse done

/** Réponse mémorisable de référence. */
const respA: IdempotentResponse = { status: 201, body: { id: "a" } };
const respB: IdempotentResponse = {
  status: 200,
  headers: { "x-test": "1" },
  body: { ok: true },
};

describe("Drizzle DrizzleIdempotencyStore — IIdempotencyStore SQL (axe 3, P6.8)", () => {
  let orm: DrizzleOrm;
  let store: DrizzleIdempotencyStore;

  beforeAll(async () => {
    registerIdempotencyEntities(ORM); // AVANT connect (création de la table au boot)
    orm = new DrizzleOrm(ORM, { filename: ":memory:" });
    await orm.connect();
    store = DrizzleIdempotencyStore.from(orm, now, LEASE, TTL);
  });

  afterAll(async () => {
    await orm.disconnect();
    entityRegistry.unregister(IDEMPOTENCY_ENTITY_NAME);
    ormRegistry.unregister(ORM);
  });

  // ── Verdicts de base (réservation / conflit / rejeu / mismatch) ──────────────
  describe("begin — verdicts", () => {
    it("clé neuve → fresh (réservation atomique)", async () => {
      CLOCK = 1_000_000;
      assert.deepEqual(await store.begin("k-basic", "fp1"), { state: "fresh" });
    });

    it("même clé + même payload, exécution en cours → in-flight (409)", async () => {
      assert.deepEqual(await store.begin("k-basic", "fp1"), {
        state: "in-flight",
      });
    });

    it("même clé + payload DIFFÉRENT (in-flight) → mismatch (422)", async () => {
      assert.deepEqual(await store.begin("k-basic", "AUTRE-fp"), {
        state: "mismatch",
      });
    });

    it("après complete, même payload → replayed (réponse mémorisée à l'identique)", async () => {
      await store.complete("k-basic", respA);
      assert.deepEqual(await store.begin("k-basic", "fp1"), {
        state: "replayed",
        response: respA,
      });
    });

    it("après complete, payload DIFFÉRENT → mismatch (empreinte préservée à la complétion)", async () => {
      // Le cas critique : `complete` ne touche pas `fingerprint` → un rejeu de la
      // clé avec un autre corps reste un 422 (draft §2.7), jamais un replay du
      // mauvais résultat.
      assert.deepEqual(await store.begin("k-basic", "AUTRE-fp"), {
        state: "mismatch",
      });
    });
  });

  // ── abort : libère sans mémoriser ────────────────────────────────────────────
  describe("abort", () => {
    it("libère une clé in-flight → begin suivant = fresh (réessayable)", async () => {
      assert.deepEqual(await store.begin("k-abort", "fp"), { state: "fresh" });
      await store.abort("k-abort");
      assert.deepEqual(await store.begin("k-abort", "fp"), { state: "fresh" });
    });

    it("complete no-op si la clé a été abortée (ne ressuscite pas)", async () => {
      assert.deepEqual(await store.begin("k-abort2", "fp"), { state: "fresh" });
      await store.abort("k-abort2");
      await store.complete("k-abort2", respA); // doit être un no-op (plus in-flight)
      // La clé a été réinsérée fraîche → PAS replayed (rien n'a été mémorisé).
      assert.deepEqual(await store.begin("k-abort2", "fp"), { state: "fresh" });
    });
  });

  // ── Expiration : bail in-flight + rétention done (vol atomique) ───────────────
  describe("expiration (vol atomique d'une entrée morte)", () => {
    it("un bail in-flight expiré est repris en fresh (handler figé)", async () => {
      CLOCK = 2_000_000;
      assert.deepEqual(await store.begin("k-lease", "fp"), { state: "fresh" });
      assert.deepEqual(await store.begin("k-lease", "fp"), {
        state: "in-flight",
      }); // vivant
      CLOCK = 2_000_000 + LEASE + 1; // bail dépassé
      assert.deepEqual(await store.begin("k-lease", "fp"), { state: "fresh" }); // volé
    });

    it("une réponse mémorisée expirée n'est plus rejouée (begin = fresh)", async () => {
      CLOCK = 3_000_000;
      assert.deepEqual(await store.begin("k-ttl", "fp"), { state: "fresh" });
      await store.complete("k-ttl", respB);
      assert.deepEqual(await store.begin("k-ttl", "fp"), {
        state: "replayed",
        response: respB,
      });
      CLOCK = 3_000_000 + TTL + 1; // rétention dépassée
      assert.deepEqual(await store.begin("k-ttl", "fp"), { state: "fresh" });
    });
  });

  // ── GC : purge applicative (pas de TTL natif SQL) ────────────────────────────
  describe("gc (purge des entrées mortes)", () => {
    it("purge expiresAt <= now, garde les vivantes, renvoie le compte", async () => {
      CLOCK = 10_000_000;
      // Pré-purge : vide les résidus des describe précédents (store partagé) pour
      // mesurer le DELTA exact du scénario ci-dessous.
      await store.gc(CLOCK);

      // (a) in-flight qui va expirer
      await store.begin("gc-dead", "fp"); // expiresAt = 10_000_000 + LEASE
      // (b) done à longue rétention → vivant au moment du gc
      await store.begin("gc-live", "fp");
      await store.complete("gc-live", respA); // expiresAt = 10_000_000 + TTL

      CLOCK = 10_000_000 + LEASE + 1; // (a) morte, (b) vivante
      const purged = await store.gc(CLOCK);
      assert.equal(purged, 1); // seule (a)

      // (b) toujours rejouable, (a) repartie de zéro (absente → réinsérée fresh).
      assert.deepEqual(await store.begin("gc-live", "fp"), {
        state: "replayed",
        response: respA,
      });
      assert.deepEqual(await store.begin("gc-dead", "fp"), { state: "fresh" });
    });
  });

  // ── Dégradation gracieuse : ORM non connecté (boot/shutdown) ─────────────────
  describe("fail-soft (handle Drizzle null)", () => {
    it("begin → fresh, complete/abort/gc → no-op, sans throw", async () => {
      const down = new DrizzleIdempotencyStore(() => null, now, LEASE, TTL);
      assert.deepEqual(await down.begin("x", "fp"), { state: "fresh" }); // sans dédup
      await down.complete("x", respA); // no-op (ne jette pas)
      await down.abort("x"); // no-op
      assert.equal(await down.gc(CLOCK), 0); // rien à purger
      assert.equal(down.size, 0); // aucune réservation comptée
    });
  });

  // ── size : compteur local best-effort ────────────────────────────────────────
  describe("size (approximation per-pod)", () => {
    it("croît au fresh, décroît au complete et à l'abort", async () => {
      CLOCK = 20_000_000;
      const base = store.size;
      await store.begin("sz-a", "fp"); // +1
      await store.begin("sz-b", "fp"); // +1
      assert.equal(store.size, base + 2);
      await store.complete("sz-a", respA); // -1
      assert.equal(store.size, base + 1);
      await store.abort("sz-b"); // -1
      assert.equal(store.size, base);
    });
  });
});
