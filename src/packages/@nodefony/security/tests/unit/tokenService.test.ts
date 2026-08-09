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

function buildService(
  configInput: unknown,
  environment?: string,
): {
  svc: TokenService;
  container: Container;
  boot: () => void;
} {
  const container = new Container();
  const handlers: Record<string, (...a: unknown[]) => void> = {};
  const kernel = {
    container,
    environment,
    once(ev: string, cb: (...a: unknown[]) => void) {
      handlers[ev] = cb;
    },
    registerStoreResolution() {},
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
  tokenStore: { store: "memory", gcIntervalS: 0 },
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
      tokenStore: { store: "memory" },
    });
    b.boot();
    assert.equal(b.svc.isEnabled(), false);
    assert.equal(await b.svc.runGc(), 0);
  });
});

// Doctrine d'échec (0.8 lot 4) : store EXPLICITE introuvable = config erronée →
// prod = boot avorté (fail-loud) ; dev = brique désactivée ANNONCÉE. Le store
// "memory" explicite reste accepté en prod (WARNING appuyé, pas de refus).
describe("TokenService — doctrine d'échec store explicite", () => {
  const badConfig = {
    jwt: { enabled: true, issuer: "https://test.nf", audiences: ["nf-api"] },
    tokenStore: { store: "granite", gcIntervalS: 0 },
  };

  it("dev : store inconnu → brique désactivée, pas de throw", () => {
    const b = buildService(badConfig);
    b.boot();
    assert.equal(b.svc.isEnabled(), false);
    assert.equal(b.container.get("tokenStore"), null);
  });

  it("prod : store inconnu → throw au boot (fail-loud)", () => {
    const b = buildService(badConfig, "production");
    assert.throws(() => b.boot(), /token store "granite" inconnu/);
  });

  it("prod : store memory → boot OK (WARNING nommant l'impact, pas de refus)", () => {
    const b = buildService(baseConfig, "production");
    b.boot();
    assert.equal(b.svc.isEnabled(), true);
    assert.ok(b.container.get("tokenStore"));
  });
});

/**
 * Rôle ÉMETTEUR (RFC 8414) — c'est ICI que se décide si l'application accepte
 * d'être découverte. `@nodefony/framework` ne lit pas cette configuration : il
 * pose la question, et monte (ou non) les deux routes bien connues.
 *
 * La garde qui compte est le REFUS : un émetteur qui n'est pas une URL https ne
 * peut pas servir d'identifiant (RFC 8414 §2), et on ne le devine pas — derrière
 * un relais, `Host`/`X-Forwarded-*` viennent du client. Publier un document
 * dérivé de la requête ferait servir, par le vrai serveur, l'identité d'un
 * attaquant.
 */
describe("TokenService — publication d'émetteur (RFC 8414)", () => {
  const publishedFor = (jwt: Record<string, unknown>): string | null => {
    const b = buildService({
      jwt: { enabled: true, ...jwt },
      tokenStore: { store: "memory", gcIntervalS: 0 },
    });
    b.boot();
    return b.svc.publishedIssuer();
  };

  it("émetteur https → publiable, sous sa forme canonique", () => {
    assert.equal(
      publishedFor({ issuer: "https://app.example" }),
      "https://app.example",
    );
    assert.equal(
      publishedFor({ issuer: "https://app.example/tenant1/" }),
      "https://app.example/tenant1",
    );
  });

  it("REFUSE quand l'émetteur n'est pas une URL — le défaut « nodefony »", () => {
    // Inoffensif tant que Nodefony émet ET vérifie ses propres jetons ; mais
    // inutilisable comme identifiant public. Le refus est annoncé au boot.
    assert.equal(publishedFor({}), null);
  });

  it("REFUSE un émetteur en clair (les clés transitent par ce canal)", () => {
    assert.equal(publishedFor({ issuer: "http://app.example" }), null);
  });

  it("REFUSE ce que la configuration a explicitement coupé", () => {
    assert.equal(
      publishedFor({ issuer: "https://app.example", jwks: false }),
      null,
    );
  });

  it("REFUSE quand la capacité JWT elle-même est éteinte", () => {
    const b = buildService({
      jwt: { enabled: false, issuer: "https://app.example" },
      tokenStore: { store: "memory", gcIntervalS: 0 },
    });
    b.boot();
    assert.equal(b.svc.publishedIssuer(), null);
  });

  it("le JWKS servi ne porte QUE des paramètres publics — jamais `d`", async () => {
    const b = buildService({
      jwt: { enabled: true, issuer: "https://app.example" },
      tokenStore: { store: "memory", gcIntervalS: 0 },
    });
    b.boot();
    const jwks = await b.svc.getPublicJWKS();
    assert.ok(jwks.keys.length > 0);
    for (const k of jwks.keys) {
      assert.equal(k.kty, "OKP");
      assert.ok(typeof k.kid === "string" && k.kid.length > 0);
      assert.equal("d" in k, false, "clé PRIVÉE dans le JWKS public");
    }
  });

  it("demander le JWKS sans capacité JWT lève (garde de programmation)", async () => {
    const b = buildService({
      jwt: { enabled: false },
      tokenStore: { store: "memory", gcIntervalS: 0 },
    });
    b.boot();
    await assert.rejects(
      () => b.svc.getPublicJWKS(),
      /capacité JWT est inactive/,
    );
  });
});
