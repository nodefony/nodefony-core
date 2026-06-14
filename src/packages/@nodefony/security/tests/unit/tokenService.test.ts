import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Container } from "nodefony";
import type { Module } from "nodefony";
import type { IUser } from "@nodefony/user";
import * as jose from "jose";
import { TokenService } from "../../nodefony/service/tokenService";
import { AuthenticationError } from "../../nodefony/errors/AuthenticationError";
import type { ITokenStore } from "../../nodefony/contracts/ITokenStore";
import type { IJwtKeystore } from "../../nodefony/contracts/IJwtKeystore";

/**
 * Orchestrateur de jetons — gates émission/rotation/gc, montés sur un VRAI
 * `MemoryTokenStore` + `JwtKeystore` (pas de stub) via un faux kernel qui
 * capture `onBoot`.
 */

const fakeUser = (identifier: string): IUser => ({
  id: `u-${identifier}`,
  identifier,
  roles: ["ROLE_USER"],
  hasRole: () => false,
  isActive: () => true,
  isLocked: () => false,
});

const users = {
  async authenticate(id: string, pw: string): Promise<IUser | null> {
    return id === "alice" && pw === "pw" ? fakeUser("alice") : null;
  },
  async loadUserByIdentifier(id: string): Promise<IUser> {
    if (id === "alice") return fakeUser("alice");
    throw new Error("not found");
  },
  async loadUserByOAuth(): Promise<IUser> {
    throw new Error("unused");
  },
  async refreshUser(u: IUser): Promise<IUser> {
    return u;
  },
};

const sha256 = (s: string): string =>
  createHash("sha256").update(s).digest("hex");

function buildService(configInput: unknown): {
  svc: TokenService;
  container: Container;
  boot: () => void;
} {
  const container = new Container();
  const handlers: Record<string, (...a: unknown[]) => void> = {};
  const kernel = {
    container,
    once(ev: string, cb: (...a: unknown[]) => void) {
      handlers[ev] = cb;
    },
  };
  container.set("kernel", kernel);
  container.set("users", users);
  const module = {
    container,
    notificationsCenter: false,
    options: configInput,
  } as unknown as Module;
  const svc = new TokenService(module);
  return { svc, container, boot: () => handlers["onBoot"]?.() };
}

const baseConfig = {
  jwt: { enabled: true, issuer: "https://test.nf", audiences: ["nf-api"] },
  tokenStore: { driver: "memory", gcIntervalS: 0 },
};

describe("TokenService — émission", () => {
  let svc: TokenService;
  let container: Container;
  beforeEach(() => {
    const b = buildService(baseConfig);
    svc = b.svc;
    container = b.container;
    b.boot();
  });

  it("isEnabled après boot ; pose tokenStore + jwtKeystore au container", () => {
    assert.equal(svc.isEnabled(), true);
    assert.ok(container.get("tokenStore"));
    assert.ok(container.get("jwtKeystore"));
  });

  it("issueTokens : access JWT vérifiable + refresh opaque stocké HACHÉ", async () => {
    const r = await svc.issueTokens(fakeUser("alice"), ["orders:read"]);
    assert.equal(r.token_type, "Bearer");
    assert.equal(r.expires_in, 900);
    assert.equal(r.scope, "orders:read");
    assert.ok(r.refresh_token.startsWith("nfr_"));

    // L'access est vérifiable via le JWKS PUBLIC du keystore (allowlist EdDSA).
    const ks = container.get<IJwtKeystore>("jwtKeystore")!;
    const getKey = jose.createLocalJWKSet(await ks.getPublicJWKS());
    const { payload, protectedHeader } = await jose.jwtVerify(
      r.access_token,
      getKey,
      {
        algorithms: ["EdDSA"],
        issuer: "https://test.nf",
        audience: "nf-api",
        typ: "at+jwt",
      },
    );
    assert.equal(payload.sub, "alice");
    assert.equal(payload.scope, "orders:read");
    assert.equal(protectedHeader.typ, "at+jwt");

    // Le refresh est stocké haché (jamais en clair), kind refresh, avec famille.
    const store = container.get<ITokenStore>("tokenStore")!;
    const rec = await store.findByHash(sha256(r.refresh_token));
    assert.ok(rec);
    assert.equal(rec!.kind, "refresh");
    assert.equal(rec!.secretHash, sha256(r.refresh_token));
    assert.deepEqual(rec!.scopes, ["orders:read"]);
    assert.ok(rec!.family);
  });

  it("issueForCredentials : password grant (bon credential émet, mauvais → 401)", async () => {
    const ok = await svc.issueForCredentials("alice", "pw");
    assert.ok(ok.access_token && ok.refresh_token);
    await assert.rejects(
      () => svc.issueForCredentials("alice", "wrong"),
      AuthenticationError,
    );
    await assert.rejects(
      () => svc.issueForCredentials("", ""),
      AuthenticationError,
    );
  });
});

describe("TokenService — rotation & détection de rejeu (RFC 9700 §4.14)", () => {
  let svc: TokenService;
  let container: Container;
  beforeEach(() => {
    const b = buildService(baseConfig);
    svc = b.svc;
    container = b.container;
    b.boot();
  });

  it("refresh : rotation — nouveau couple, ancien révoqué `rotated` + chaîné", async () => {
    const r1 = await svc.issueTokens(fakeUser("alice"), ["a", "b"]);
    const r2 = await svc.refresh(r1.refresh_token);
    assert.notEqual(r2.refresh_token, r1.refresh_token);
    assert.ok(r2.access_token);
    assert.equal(
      r2.scope,
      "a b",
      "downscoping : scopes conservés, jamais montés",
    );

    const store = container.get<ITokenStore>("tokenStore")!;
    const old = await store.findByHash(sha256(r1.refresh_token));
    assert.ok(old!.revokedAt);
    assert.equal(old!.revokedReason, "rotated");
    assert.ok(old!.replacedBy);
  });

  it("reuse detection : ancien refresh rejoué → famille coupée + 401 (victime déconnectée)", async () => {
    const r1 = await svc.issueTokens(fakeUser("alice"));
    const r2 = await svc.refresh(r1.refresh_token); // rotation OK
    await assert.rejects(
      () => svc.refresh(r1.refresh_token),
      AuthenticationError,
    );
    // La famille est révoquée → le refresh courant (r2) ne marche plus non plus.
    await assert.rejects(
      () => svc.refresh(r2.refresh_token),
      AuthenticationError,
    );
  });

  it("refresh inconnu / vide → 401", async () => {
    await assert.rejects(() => svc.refresh("nfr_unknown"), AuthenticationError);
    await assert.rejects(() => svc.refresh(""), AuthenticationError);
  });
});

describe("TokenService — gc (orchestration du seam ITokenStore.gc)", () => {
  it("runGc purge les entrées expirées (idempotent)", async () => {
    const b = buildService(baseConfig);
    b.boot();
    const store = b.container.get<ITokenStore>("tokenStore")!;
    const now = Date.now();
    await store.put({
      id: "old",
      kind: "refresh",
      name: "x",
      prefix: null,
      subjectId: "alice",
      subjectType: "user",
      tenantId: null,
      scopes: [],
      audience: [],
      resources: null,
      secretHash: "h",
      hashAlg: "sha256",
      clientId: null,
      cnf: null,
      family: "f",
      replacedBy: null,
      createdAt: now - 1000,
      expiresAt: now - 1,
      lastUsedAt: null,
      lastUsedIp: null,
      lastUsedUserAgent: null,
      revokedAt: null,
      revokedReason: null,
      metadata: {},
    });
    const purged = await b.svc.runGc();
    assert.ok(purged >= 1);
    assert.equal(await store.findById("old"), null);
    assert.equal(await b.svc.runGc(), 0, "idempotent : rien de plus à purger");
  });

  it("JWT désactivé → service idle (isEnabled false, runGc no-op)", async () => {
    const b = buildService({
      jwt: { enabled: false },
      tokenStore: { driver: "memory" },
    });
    b.boot();
    assert.equal(b.svc.isEnabled(), false);
    assert.equal(await b.svc.runGc(), 0);
  });
});
