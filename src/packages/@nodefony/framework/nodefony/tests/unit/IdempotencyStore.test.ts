/// <reference types="node" />
/**
 * Unit — MemoryIdempotencyStore (cache de dédup des mutations admin).
 *
 * Le store étend Service (ctor = Module complet). On l'instancie via un proxy
 * `Object.create` + init manuelle des champs (même technique qu'AdminBroker.test)
 * → on teste la LOGIQUE sans booter un kernel, et on peut régler ttl/lease/cap.
 *
 * L'écoulement du temps est simulé de façon **déterministe** en forçant
 * `expiresAt` d'une entrée dans le passé (`expire()`), sans fake timers : on
 * teste exactement la comparaison `now <= expiresAt` du store.
 *
 * Sémantique alignée sur `draft-ietf-httpapi-idempotency-key-header-06` §2.6/§2.7
 * (fresh / replay / in-flight=409 / mismatch=422).
 */
import { expect } from "chai";
import MemoryIdempotencyStore from "../../service/IdempotencyStore.js";
import type { IdempotentResponse } from "../../interfaces/IIdempotencyStore.js";

interface StoreInternals {
  entries: Map<
    string,
    { kind: string; fingerprint: string; expiresAt: number }
  > | null;
  ttlMs: number;
  leaseMs: number;
  cap: number;
}

function makeStore(
  over: Partial<{ ttlMs: number; leaseMs: number; cap: number }> = {},
): MemoryIdempotencyStore {
  const s = Object.create(
    MemoryIdempotencyStore.prototype,
  ) as MemoryIdempotencyStore & StoreInternals & { log: () => void };
  s.entries = null;
  s.ttlMs = over.ttlMs ?? 600_000;
  s.leaseMs = over.leaseMs ?? 60_000;
  s.cap = over.cap ?? 1000;
  s.log = () => {};
  return s;
}

const resp = (status: number, body: unknown): IdempotentResponse => ({
  status,
  body,
});

/** Empreinte de payload par défaut (même payload = même fingerprint = rejeu). */
const FP = "payload-fingerprint";

/** Force l'expiration d'une entrée → simule « le temps a passé » (déterministe). */
function expire(s: MemoryIdempotencyStore, key: string): void {
  const e = (s as unknown as StoreInternals).entries?.get(key);
  if (e) e.expiresAt = Date.now() - 1;
}

describe("MemoryIdempotencyStore — réservation", () => {
  it("begin() sur une clé neuve → fresh + entrée in-flight", () => {
    const s = makeStore();
    expect(s.begin("k", FP).state).to.equal("fresh");
    expect(s.size).to.equal(1);
  });

  it("begin() répété (même payload) sur une clé non complétée → in-flight (409)", () => {
    const s = makeStore();
    s.begin("k", FP);
    expect(s.begin("k", FP).state).to.equal("in-flight");
  });

  it("complete() puis begin() (même payload) → replayed avec la réponse mémorisée", () => {
    const s = makeStore();
    s.begin("k", FP);
    s.complete("k", resp(200, { ok: 1 }));
    const o = s.begin("k", FP);
    expect(o.state).to.equal("replayed");
    expect(o.state === "replayed" && o.response).to.deep.equal({
      status: 200,
      body: { ok: 1 },
    });
  });

  it("abort() libère la clé → begin() suivant = fresh (retry permis)", () => {
    const s = makeStore();
    s.begin("k", FP);
    s.abort("k");
    expect(s.begin("k", FP).state).to.equal("fresh");
  });

  it("complete() après abort() = no-op (pas de résurrection)", () => {
    const s = makeStore();
    s.begin("k", FP);
    s.abort("k");
    s.complete("k", resp(200, { stale: true })); // la clé n'est plus in-flight
    expect(s.begin("k", FP).state).to.equal("fresh"); // jamais replayed
  });
});

describe("MemoryIdempotencyStore — fingerprint du payload (draft §2.2/§2.7)", () => {
  it("même clé, payload DIFFÉRENT (in-flight) → mismatch (422)", () => {
    const s = makeStore();
    s.begin("k", "fpA");
    expect(s.begin("k", "fpB").state).to.equal("mismatch");
  });

  it("même clé, payload DIFFÉRENT (déjà complétée) → mismatch (422), pas de replay", () => {
    const s = makeStore();
    s.begin("k", "fpA");
    s.complete("k", resp(200, { v: "A" }));
    expect(s.begin("k", "fpB").state).to.equal("mismatch");
  });

  it("après expiration, la même clé avec un AUTRE payload redevient fresh", () => {
    const s = makeStore();
    s.begin("k", "fpA");
    s.complete("k", resp(200, {}));
    expire(s, "k");
    expect(s.begin("k", "fpB").state).to.equal("fresh");
  });
});

describe("MemoryIdempotencyStore — scope par clé (isolation identités)", () => {
  it("deux clés scopées différemment sont indépendantes (même payload)", () => {
    const s = makeStore();
    s.begin("userA|key1", FP); // in-flight
    // userB rejoue la MÊME clé client mais scopée à son identité → pas de fuite.
    expect(s.begin("userB|key1", FP).state).to.equal("fresh");
  });

  it("la réponse mémorisée d'une identité n'est jamais servie à une autre", () => {
    const s = makeStore();
    s.begin("userA|key1", FP);
    s.complete("userA|key1", resp(200, { secret: "A" }));
    expect(s.begin("userB|key1", FP).state).to.equal("fresh");
  });
});

describe("MemoryIdempotencyStore — expiration", () => {
  it("réponse expirée (TTL dépassé) → begin() = fresh", () => {
    const s = makeStore();
    s.begin("k", FP);
    s.complete("k", resp(200, {}));
    expire(s, "k");
    expect(s.begin("k", FP).state).to.equal("fresh");
  });

  it("bail in-flight expiré (exécution abandonnée) → begin() = fresh", () => {
    const s = makeStore();
    s.begin("k", FP); // in-flight, jamais complété
    expire(s, "k"); // bail dépassé
    expect(s.begin("k", FP).state).to.equal("fresh");
  });
});

describe("MemoryIdempotencyStore — borne mémoire", () => {
  it("éviction FIFO : size reste sous le cap", () => {
    const s = makeStore({ cap: 3 });
    for (let i = 0; i < 6; i++) {
      const k = `k${i}`;
      s.begin(k, FP);
      s.complete(k, resp(200, { i }));
    }
    expect(s.size).to.be.at.most(3);
    // La plus ancienne (k0) a été évincée → begin la voit comme fresh.
    expect(s.begin("k0", FP).state).to.equal("fresh");
  });
});

describe("MemoryIdempotencyStore — robustesse", () => {
  it("complete() sur store vierge (entries null) = no-op", () => {
    const s = makeStore();
    expect(() => s.complete("nope", resp(200, {}))).to.not.throw();
    expect(s.size).to.equal(0);
  });

  it("abort() sur clé inconnue = no-op", () => {
    const s = makeStore();
    expect(() => s.abort("nope")).to.not.throw();
  });
});
