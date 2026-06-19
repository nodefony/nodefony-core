import assert from "node:assert/strict";
import { Container } from "nodefony";
import type { Module } from "nodefony";
import { ApiKeyService } from "../../nodefony/service/apiKeys";
import { ApiKeyError } from "../../nodefony/errors/ApiKeyError";
import { MemoryTokenStore } from "../../nodefony/src/token/MemoryTokenStore";
import { hashApiKey } from "../../nodefony/src/apikey/apiKeyFormat";
import type { IAccessTokenRecord } from "../../nodefony/contracts/ITokenStore";

/**
 * Service de gestion des clés API (PAT) — émission/listing/révocation sur un VRAI
 * `MemoryTokenStore`. Cibles sécurité : secret jamais re-exposé, plafond anti-abus,
 * isolation par porteur (IDOR → introuvable), validation des entrées.
 */

const MS_PER_DAY = 86_400_000;

function buildService(
  apiKeys: Record<string, unknown>,
  withStore = true,
): { svc: ApiKeyService; store: MemoryTokenStore } {
  const container = new Container();
  const handlers: Record<string, (...a: unknown[]) => void> = {};
  const kernel = {
    container,
    once(ev: string, cb: (...a: unknown[]) => void) {
      handlers[ev] = cb;
    },
  };
  container.set("kernel", kernel);
  const store = new MemoryTokenStore();
  if (withStore) container.set("tokenStore", store);
  const module = {
    container,
    notificationsCenter: false,
    options: { apiKeys },
  } as unknown as Module;
  const svc = new ApiKeyService(module);
  handlers["onBoot"]?.();
  return { svc, store };
}

function refreshRecord(subjectId: string): IAccessTokenRecord {
  const now = Date.now();
  return {
    id: `r-${Math.random()}`,
    kind: "refresh",
    name: "refresh token",
    prefix: null,
    subjectId,
    subjectType: "user",
    tenantId: null,
    scopes: [],
    audience: [],
    resources: null,
    secretHash: hashApiKey(`refresh-${Math.random()}`),
    hashAlg: "sha256",
    clientId: null,
    cnf: null,
    family: "fam",
    replacedBy: null,
    createdAt: now,
    expiresAt: now + 1000,
    lastUsedAt: null,
    lastUsedIp: null,
    lastUsedUserAgent: null,
    revokedAt: null,
    revokedReason: null,
    metadata: {},
  };
}

describe("ApiKeyService — état", () => {
  it("isEnabled reflète la config", () => {
    assert.equal(buildService({ enabled: true }).svc.isEnabled(), true);
    assert.equal(buildService({ enabled: false }).svc.isEnabled(), false);
  });

  it("store absent → 503 à la création", async () => {
    const { svc } = buildService({ enabled: true }, false);
    await assert.rejects(
      () => svc.createForSubject("alice", "user", { name: "x" }),
      (e: unknown) => e instanceof ApiKeyError && e.code === 503,
    );
  });
});

describe("ApiKeyService — création", () => {
  it("émet un PAT : token clair (1×) + record haché en store", async () => {
    const { svc, store } = buildService({ enabled: true });
    const created = await svc.createForSubject("alice", "user", {
      name: "CI deploy",
      scopes: ["orders:read"],
    });
    assert.ok(created.token.startsWith("nf_"));
    assert.equal(created.name, "CI deploy");
    assert.deepEqual(created.scopes, ["orders:read"]);
    assert.equal(created.subjectId, "alice");
    assert.equal(created.prefix, `nf_${created.token.slice(3, 11)}`);

    const record = await store.findById(created.id);
    assert.ok(record);
    assert.equal(record!.kind, "pat");
    assert.equal(record!.secretHash, hashApiKey(created.token));
    // le secret n'est jamais stocké en clair
    assert.notEqual(record!.secretHash, created.token);
  });

  it("expiration : défaut 90 j / null / custom / invalide", async () => {
    const { svc } = buildService({ enabled: true, defaultExpiryDays: 90 });
    const now = Date.now();
    const def = await svc.createForSubject("a", "user", { name: "k" });
    assert.ok(Math.abs(def.expiresAt! - (now + 90 * MS_PER_DAY)) < 5000);

    const never = await svc.createForSubject("a", "user", {
      name: "k",
      expiresInDays: null,
    });
    assert.equal(never.expiresAt, null);

    const wk = await svc.createForSubject("a", "user", {
      name: "k",
      expiresInDays: 7,
    });
    assert.ok(Math.abs(wk.expiresAt! - (now + 7 * MS_PER_DAY)) < 5000);

    for (const bad of [-1, 0]) {
      await assert.rejects(
        () =>
          svc.createForSubject("a", "user", {
            name: "k",
            expiresInDays: bad,
          }),
        (e: unknown) => e instanceof ApiKeyError && e.code === 400,
      );
    }
  });

  it("nom : vide / blanc / trop long → 400", async () => {
    const { svc } = buildService({ enabled: true });
    for (const bad of ["", "   ", "x".repeat(101)]) {
      await assert.rejects(
        () => svc.createForSubject("a", "user", { name: bad }),
        (e: unknown) => e instanceof ApiKeyError && e.code === 400,
      );
    }
  });

  it("scopes : catalogue respecté (hors-liste → 400) + dédup", async () => {
    const { svc } = buildService({
      enabled: true,
      allowedScopes: ["read", "write"],
    });
    const ok = await svc.createForSubject("a", "user", {
      name: "k",
      scopes: ["read", "read", "write"],
    });
    assert.deepEqual(ok.scopes, ["read", "write"]); // dédupliqué
    await assert.rejects(
      () => svc.createForSubject("a", "user", { name: "k", scopes: ["admin"] }),
      (e: unknown) => e instanceof ApiKeyError && e.code === 400,
    );
  });

  it("plafond maxPerSubject → 409 ; une révocation libère une place", async () => {
    const { svc } = buildService({ enabled: true, maxPerSubject: 2 });
    const k1 = await svc.createForSubject("a", "user", { name: "1" });
    await svc.createForSubject("a", "user", { name: "2" });
    await assert.rejects(
      () => svc.createForSubject("a", "user", { name: "3" }),
      (e: unknown) => e instanceof ApiKeyError && e.code === 409,
    );
    await svc.revokeForSubject("a", k1.id);
    // place libérée (la clé révoquée ne compte plus)
    await svc.createForSubject("a", "user", { name: "3" });
  });
});

describe("ApiKeyService — listing (sans secret)", () => {
  it("ne renvoie que les PAT du porteur, récents d'abord, sans secret", async () => {
    const { svc, store } = buildService({ enabled: true });
    await svc.createForSubject("alice", "user", { name: "old" });
    await new Promise((r) => setTimeout(r, 2));
    await svc.createForSubject("alice", "user", { name: "new" });
    await svc.createForSubject("bob", "user", { name: "bob-key" });
    await store.put(refreshRecord("alice")); // un refresh ne doit PAS apparaître

    const keys = await svc.listForSubject("alice");
    assert.equal(keys.length, 2);
    assert.equal(keys[0]!.name, "new"); // tri desc
    assert.equal(keys[1]!.name, "old");
    for (const k of keys) {
      assert.equal("secretHash" in k, false);
      assert.equal("token" in k, false);
    }
  });
});

describe("ApiKeyService — révocation (isolation par porteur)", () => {
  it("révoque sa propre clé → true + record marqué", async () => {
    const { svc, store } = buildService({ enabled: true });
    const k = await svc.createForSubject("alice", "user", { name: "k" });
    assert.equal(await svc.revokeForSubject("alice", k.id), true);
    const record = await store.findById(k.id);
    assert.equal(typeof record!.revokedAt, "number");
    assert.equal(record!.revokedReason, "manual");
  });

  it("IDOR : révoquer la clé d'autrui → false, clé NON révoquée", async () => {
    const { svc, store } = buildService({ enabled: true });
    const k = await svc.createForSubject("alice", "user", { name: "k" });
    assert.equal(await svc.revokeForSubject("bob", k.id), false);
    const record = await store.findById(k.id);
    assert.equal(record!.revokedAt, null); // intacte
  });

  it("clé inexistante → false", async () => {
    const { svc } = buildService({ enabled: true });
    assert.equal(await svc.revokeForSubject("alice", "nope"), false);
  });

  it("idempotent : double révocation → true (date d'origine conservée)", async () => {
    const { svc, store } = buildService({ enabled: true });
    const k = await svc.createForSubject("alice", "user", { name: "k" });
    assert.equal(await svc.revokeForSubject("alice", k.id), true);
    const first = (await store.findById(k.id))!.revokedAt;
    assert.equal(await svc.revokeForSubject("alice", k.id), true);
    assert.equal((await store.findById(k.id))!.revokedAt, first);
  });
});
