import assert from "node:assert/strict";
import { MemoryTokenStore } from "../../nodefony/src/token/MemoryTokenStore";
import {
  registerTokenStore,
  getTokenStoreFactory,
  listTokenStores,
  type ITokenStoreFactoryContext,
} from "../../nodefony/src/token/tokenStoreRegistry";
import type { IAccessTokenRecord } from "../../nodefony/contracts/ITokenStore";

/**
 * Store de jetons (J4a) — référence mémoire d'`ITokenStore` :
 * - records (PAT/refresh) : put/find par id/hash/sujet, markUsed, revoke, famille ;
 * - denylist `jti` : pose + expiration paresseuse ;
 * - révocation en masse par porteur (`invalidBefore`, monotone) ;
 * - GC (purge denylist + records expirés, index nettoyés) ;
 * - registre pluggable (builtin `memory` + enregistrement custom).
 */

// Horloge contrôlée — tests déterministes (epoch ms).
const clock = (start = 1_000_000) => {
  let nowMs = start;
  return {
    now: () => nowMs,
    advanceMs: (ms: number) => {
      nowMs += ms;
    },
  };
};

// Fabrique de record complète — surcharge les seuls champs pertinents au cas.
const makeRecord = (
  o: Partial<IAccessTokenRecord> = {},
): IAccessTokenRecord => ({
  id: "id1",
  kind: "refresh",
  name: "token",
  prefix: null,
  subjectId: "u1",
  subjectType: "user",
  tenantId: null,
  scopes: [],
  audience: [],
  resources: null,
  secretHash: "hash1",
  hashAlg: "sha256",
  clientId: null,
  cnf: null,
  family: null,
  replacedBy: null,
  createdAt: 1000,
  expiresAt: null,
  lastUsedAt: null,
  lastUsedIp: null,
  lastUsedUserAgent: null,
  revokedAt: null,
  revokedReason: null,
  metadata: {},
  ...o,
});

describe("MemoryTokenStore — records", () => {
  it("put puis lecture par id, hash et sujet", async () => {
    const store = new MemoryTokenStore();
    const rec = makeRecord({ id: "a", secretHash: "h-a", subjectId: "alice" });
    await store.put(rec);
    assert.equal((await store.findById("a"))?.id, "a");
    assert.equal((await store.findByHash("h-a"))?.id, "a");
    const list = await store.findBySubject("alice");
    assert.equal(list.length, 1);
    assert.equal(list[0]?.id, "a");
  });

  it("lecture inconnue → null / liste vide", async () => {
    const store = new MemoryTokenStore();
    assert.equal(await store.findById("nope"), null);
    assert.equal(await store.findByHash("nope"), null);
    assert.deepEqual(await store.findBySubject("nobody"), []);
  });

  it("markUsed pose lastUsedAt/ip/userAgent", async () => {
    const store = new MemoryTokenStore();
    await store.put(makeRecord({ id: "a" }));
    await store.markUsed("a", { at: 4242, ip: "1.2.3.4", userAgent: "curl" });
    const rec = await store.findById("a");
    assert.equal(rec?.lastUsedAt, 4242);
    assert.equal(rec?.lastUsedIp, "1.2.3.4");
    assert.equal(rec?.lastUsedUserAgent, "curl");
  });

  it("revoke pose revokedAt + raison, et reste idempotent", async () => {
    const c = clock();
    const store = new MemoryTokenStore(c.now);
    await store.put(makeRecord({ id: "a" }));
    await store.revoke("a", "manual");
    const rec = await store.findById("a");
    assert.equal(rec?.revokedAt, c.now());
    assert.equal(rec?.revokedReason, "manual");
    // 2e révocation : ne réécrase ni l'instant ni la raison d'origine.
    c.advanceMs(5000);
    await store.revoke("a", "compromised");
    assert.equal((await store.findById("a"))?.revokedReason, "manual");
  });

  it("revokeFamily coupe toute la chaîne de rotation (reuse detection)", async () => {
    const store = new MemoryTokenStore();
    await store.put(makeRecord({ id: "r1", secretHash: "h1", family: "F" }));
    await store.put(makeRecord({ id: "r2", secretHash: "h2", family: "F" }));
    await store.put(makeRecord({ id: "x", secretHash: "h3", family: "OTHER" }));
    await store.revokeFamily("F", "reuse_detected");
    assert.equal((await store.findById("r1"))?.revokedReason, "reuse_detected");
    assert.equal((await store.findById("r2"))?.revokedReason, "reuse_detected");
    assert.equal((await store.findById("x"))?.revokedAt, null);
  });
});

describe("MemoryTokenStore — denylist jti", () => {
  it("denyJti puis isJtiDenied = true tant que non expiré", async () => {
    const c = clock();
    const store = new MemoryTokenStore(c.now);
    await store.denyJti("jti-1", c.now() + 1000);
    assert.equal(await store.isJtiDenied("jti-1"), true);
  });

  it("jti inconnu → false", async () => {
    const store = new MemoryTokenStore();
    assert.equal(await store.isJtiDenied("never"), false);
  });

  it("l'entrée expire avec le temps (le JWT est mort de toute façon)", async () => {
    const c = clock();
    const store = new MemoryTokenStore(c.now);
    await store.denyJti("jti-1", c.now() + 1000);
    c.advanceMs(1000);
    assert.equal(await store.isJtiDenied("jti-1"), false);
  });
});

describe("MemoryTokenStore — révocation en masse + GC", () => {
  it("revokeAllForSubject pose invalidBefore, monotone (ne recule pas)", async () => {
    const store = new MemoryTokenStore();
    assert.equal(await store.getInvalidBefore("u1"), null);
    await store.revokeAllForSubject("u1", 5000);
    assert.equal(await store.getInvalidBefore("u1"), 5000);
    await store.revokeAllForSubject("u1", 3000); // plus ancien → ignoré
    assert.equal(await store.getInvalidBefore("u1"), 5000);
    await store.revokeAllForSubject("u1", 9000); // plus récent → adopté
    assert.equal(await store.getInvalidBefore("u1"), 9000);
  });

  it("gc purge la denylist expirée et les records expirés (index nettoyés)", async () => {
    const c = clock();
    const store = new MemoryTokenStore(c.now);
    await store.denyJti("dead", c.now() + 100);
    await store.denyJti("alive", c.now() + 100_000);
    await store.put(
      makeRecord({
        id: "exp",
        secretHash: "h-exp",
        subjectId: "s",
        expiresAt: c.now() + 100,
      }),
    );
    await store.put(
      makeRecord({
        id: "pat",
        secretHash: "h-pat",
        subjectId: "s",
        expiresAt: null,
      }),
    );
    c.advanceMs(1000);
    const purged = await store.gc();
    assert.equal(purged, 2); // 1 jti + 1 record expirés
    assert.equal(await store.isJtiDenied("alive"), true);
    assert.equal(await store.findById("exp"), null);
    assert.ok(await store.findById("pat")); // PAT (sans expiration) survit
    // index sujet nettoyé du record purgé, PAT conservé.
    const list = await store.findBySubject("s");
    assert.equal(list.length, 1);
    assert.equal(list[0]?.id, "pat");
  });
});

describe("MemoryTokenStore — cas limites", () => {
  it("opérations sur un id/famille inconnu = no-op (pas de throw)", async () => {
    const store = new MemoryTokenStore();
    await store.markUsed("ghost", { at: 1 });
    await store.revoke("ghost", "manual");
    await store.revokeFamily("ghost", "manual");
    assert.equal(await store.findById("ghost"), null);
  });

  it("put sur un id existant remplace le record (sans doublon d'index)", async () => {
    const store = new MemoryTokenStore();
    await store.put(makeRecord({ id: "a", name: "old", secretHash: "h1" }));
    await store.put(makeRecord({ id: "a", name: "new", secretHash: "h1" }));
    assert.equal((await store.findById("a"))?.name, "new");
    assert.equal((await store.findBySubject("u1")).length, 1);
  });

  it("markUsed sans ip/ua remet les colonnes d'audit à null", async () => {
    const store = new MemoryTokenStore();
    await store.put(makeRecord({ id: "a" }));
    await store.markUsed("a", { at: 7 });
    const rec = await store.findById("a");
    assert.equal(rec?.lastUsedAt, 7);
    assert.equal(rec?.lastUsedIp, null);
    assert.equal(rec?.lastUsedUserAgent, null);
  });

  it("gc est idempotent (rien à purger au 2e passage)", async () => {
    const c = clock();
    const store = new MemoryTokenStore(c.now);
    await store.put(
      makeRecord({ id: "a", secretHash: "h", expiresAt: c.now() + 100 }),
    );
    c.advanceMs(1000);
    assert.equal(await store.gc(), 1);
    assert.equal(await store.gc(), 0);
  });

  it("purge un PAT révoqué SANS expiration après la fenêtre de rétention", async () => {
    const c = clock();
    const retention = 1000;
    const store = new MemoryTokenStore(c.now, retention);
    await store.put(
      makeRecord({ id: "pat", kind: "pat", secretHash: "h", expiresAt: null }),
    );
    await store.revoke("pat", "manual");
    c.advanceMs(retention - 1);
    assert.equal(await store.gc(), 0); // dans la fenêtre → conservé (audit)
    assert.ok(await store.findById("pat"));
    c.advanceMs(2);
    assert.equal(await store.gc(), 1); // au-delà → purgé
    assert.equal(await store.findById("pat"), null);
  });

  it("ne purge PAS un PAT actif sans expiration (non révoqué)", async () => {
    const c = clock();
    const store = new MemoryTokenStore(c.now, 1);
    await store.put(
      makeRecord({ id: "pat", kind: "pat", secretHash: "h", expiresAt: null }),
    );
    c.advanceMs(1_000_000);
    assert.equal(await store.gc(), 0);
    assert.ok(await store.findById("pat"));
  });

  it("gc d'un refresh expiré nettoie AUSSI l'index de famille (vidé → retiré)", async () => {
    const c = clock();
    const store = new MemoryTokenStore(c.now);
    await store.put(
      makeRecord({
        id: "r",
        secretHash: "h",
        family: "F",
        expiresAt: c.now() + 100,
      }),
    );
    c.advanceMs(1000);
    assert.equal(await store.gc(), 1);
    // famille désormais vide et retirée → revokeFamily ne trouve rien (pas de throw)
    await store.revokeFamily("F", "manual");
    assert.equal(await store.findById("r"), null);
  });

  it("le balayage amorti se déclenche au 256e ajout (purge interne des jti expirés)", async () => {
    const c = clock();
    const store = new MemoryTokenStore(c.now);
    await store.denyJti("stale", c.now() + 10); // 1er ajout
    c.advanceMs(100); // "stale" est maintenant expiré
    for (let i = 0; i < 255; i++) {
      await store.denyJti(`v${i}`, c.now() + 1_000_000); // le 256e déclenche le sweep
    }
    assert.equal(await store.isJtiDenied("stale"), false);
    assert.equal(await store.isJtiDenied("v0"), true);
  });
});

describe("MemoryTokenStore — rotation refresh + reuse detection (RFC 9700)", () => {
  it("rotation normale puis rejeu d'un refresh tourné coupe la famille", async () => {
    const c = clock();
    const store = new MemoryTokenStore(c.now);
    const ttl = 7 * 24 * 3_600_000;
    // gen 1 émis
    await store.put(
      makeRecord({
        id: "r1",
        kind: "refresh",
        secretHash: "h1",
        family: "F",
        expiresAt: c.now() + ttl,
      }),
    );
    // rotation : r1 révoqué "rotated", r2 émis (même famille), chaînage replacedBy
    await store.revoke("r1", "rotated");
    const r1 = await store.findById("r1");
    if (r1) {
      r1.replacedBy = "r2";
    }
    await store.put(
      makeRecord({
        id: "r2",
        kind: "refresh",
        secretHash: "h2",
        family: "F",
        expiresAt: c.now() + ttl,
      }),
    );
    // rejeu : on présente le secret de r1 (déjà tourné) → trouvé MAIS révoqué
    const replayed = await store.findByHash("h1");
    assert.ok(replayed && replayed.revokedAt !== null);
    assert.equal(replayed?.replacedBy, "r2");
    // politique reuse detection : couper toute la famille
    await store.revokeFamily("F", "reuse_detected");
    assert.equal((await store.findById("r2"))?.revokedReason, "reuse_detected");
    // r1 garde sa raison d'origine "rotated" (revoke idempotent)
    assert.equal((await store.findById("r1"))?.revokedReason, "rotated");
  });
});

describe("tokenStoreRegistry", () => {
  const dummyCtx = {} as unknown as ITokenStoreFactoryContext;

  it("le builtin 'memory' est enregistré et fabrique un MemoryTokenStore", () => {
    assert.ok(listTokenStores().includes("memory"));
    const factory = getTokenStoreFactory("memory");
    assert.ok(factory);
    assert.ok(factory(dummyCtx) instanceof MemoryTokenStore);
  });

  it("enregistre puis résout un store custom", () => {
    const sentinel = new MemoryTokenStore();
    registerTokenStore("custom-test", () => sentinel);
    assert.ok(listTokenStores().includes("custom-test"));
    assert.equal(getTokenStoreFactory("custom-test")?.(dummyCtx), sentinel);
  });

  it("nom inconnu → undefined", () => {
    assert.equal(getTokenStoreFactory("ghost"), undefined);
  });
});
