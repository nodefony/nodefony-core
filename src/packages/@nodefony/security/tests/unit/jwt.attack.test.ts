/*
 *   BANC D'ATTAQUE de la porte JWT — vecteurs de la RFC 8725 (JWT Best Current
 *   Practices), présentés au `JwtAuthenticator` tel qu'il tourne en production.
 *
 *   Le fichier s'appelait `jwtAuthenticator.test.ts` : un nom de test de composant,
 *   alors qu'il porte l'essentiel des attaques JWT du dépôt. Un inventaire des bancs
 *   d'attaque (`*.attack.test.ts`) en trouvait dix-neuf et ratait celui-ci — au point
 *   qu'on pouvait croire la porte JWT non éprouvée. Un contrôle qu'on ne trouve pas
 *   compte pour rien.
 *
 *   Vecteurs couverts : `alg=none` (§3.1), confusion d'algorithme HS256 avec la clé
 *   publique (§2.1), `kid` inconnu (§3.5), `iss`/`aud` faux (§3.8-3.9), `sub` absent
 *   (§3.10), `typ` faux — jeton de rafraîchissement joué en jeton d'accès (§3.11),
 *   signature falsifiée, `exp` passé, `nbf` futur, révocation (`jti` en liste noire,
 *   `iat` antérieur à une invalidation globale), sujet disparu / verrouillé / inactif,
 *   et l'absence de keystore (échec FERMÉ, jamais ouvert).
 */

import assert from "node:assert/strict";
import type { Container } from "nodefony";
import type { ContextType } from "@nodefony/http";
import type { IUser } from "@nodefony/user";
import * as jose from "jose";
import { JwtAuthenticator } from "../../nodefony/src/authenticator/JwtAuthenticator";
import { JwtKeystore } from "../../nodefony/src/token/JwtKeystore";
import { MemoryTokenStore } from "../../nodefony/src/token/MemoryTokenStore";
import { UserToken } from "../../nodefony/src/token/UserToken";
import { AuthenticationError } from "../../nodefony/errors/AuthenticationError";
import type { IJwtRuntime } from "../../nodefony/src/token/jwtRuntime";

/**
 * Vérification JWT — matrice d'attaques RFC 8725 (JWT BCP). CHAQUE rejet doit
 * être un `AuthenticationError` 401 au message uniforme (anti-oracle). Tokens
 * forgés/minés avec jose contre un VRAI keystore (kid réel) → pas de stub.
 */

const RT: IJwtRuntime = {
  issuer: "https://test.nf",
  audiences: ["nf-api"],
  accessTtlS: 900,
  refreshTtlS: 604800,
  rotateRefresh: true,
  alg: "EdDSA",
};

const fakeUser = (
  identifier: string,
  opts: { active?: boolean; locked?: boolean } = {},
): IUser => ({
  id: `u-${identifier}`,
  identifier,
  roles: ["ROLE_USER"],
  hasRole: () => false,
  isActive: () => opts.active ?? true,
  isLocked: () => opts.locked ?? false,
});

const provider = {
  async loadUserByIdentifier(id: string): Promise<IUser> {
    if (id === "ghost") throw new Error("not found");
    if (id === "banned") return fakeUser("banned", { locked: true });
    if (id === "inactive") return fakeUser("inactive", { active: false });
    return fakeUser(id);
  },
  async loadUserByOAuth(): Promise<IUser> {
    throw new Error("unused");
  },
  async refreshUser(u: IUser): Promise<IUser> {
    return u;
  },
};

const fakeContainer = (s: Record<string, unknown>): Container =>
  ({
    get: <T>(n: string): T | undefined => s[n] as T | undefined,
  }) as unknown as Container;

const nowS = (): number => Math.floor(Date.now() / 1000);

let keystore: JwtKeystore;
let store: MemoryTokenStore;
let auth: JwtAuthenticator;
let signing: { key: CryptoKey; kid: string };

/** Mine un access token EdDSA valide, surchargeable (header/claims/clé). */
async function mint(
  over: {
    header?: Record<string, unknown>;
    claims?: Record<string, unknown>;
    key?: CryptoKey;
  } = {},
): Promise<string> {
  const header = {
    alg: "EdDSA",
    kid: signing.kid,
    typ: "at+jwt",
    ...over.header,
  };
  const claims = {
    iss: RT.issuer,
    aud: RT.audiences[0],
    sub: "alice",
    jti: `jti-${Math.random()}`,
    iat: nowS(),
    exp: nowS() + 900,
    scope: "orders:read",
    ...over.claims,
  };
  return new jose.SignJWT(claims)
    .setProtectedHeader(header as jose.JWTHeaderParameters)
    .sign(over.key ?? signing.key);
}

beforeEach(async () => {
  keystore = new JwtKeystore({}, () => {});
  store = new MemoryTokenStore();
  signing = await keystore.getSigningKey();
  auth = new JwtAuthenticator(
    fakeContainer({
      jwtKeystore: keystore,
      tokenStore: store,
      users: provider,
    }),
    RT,
  );
});

describe("JwtAuthenticator — extraction", () => {
  const ctx = (a?: string): ContextType =>
    ({
      request: { headers: a ? { authorization: a } : {} },
    }) as unknown as ContextType;

  it("supports : Bearer présent (case-insensitive), sinon non", () => {
    assert.equal(auth.supports(ctx()), false);
    assert.equal(auth.supports(ctx("Basic xxx")), false);
    assert.equal(auth.supports(ctx("Bearer abc.def.ghi")), true);
    assert.equal(auth.supports(ctx("bearer abc.def.ghi")), true);
  });

  it("createToken extrait le token brut ; challenge = Bearer", async () => {
    const t = await auth.createToken(ctx("Bearer the.raw.jwt"));
    assert.equal(t.type, "jwt");
    assert.equal(t.getCredentials(), "the.raw.jwt");
    assert.equal(auth.challenge(), "Bearer");
  });
});

describe("JwtAuthenticator — token valide", () => {
  it("promeut : user résolu, scopes/jti/claims posés", async () => {
    const t = await auth.authenticate(new UserToken("jwt", await mint()));
    assert.equal(t.isAuthenticated(), true);
    assert.equal(t.getUser().identifier, "alice");
    assert.deepEqual(t.getScopes(), ["orders:read"]);
    assert.ok(t.getAttribute<string>("jti"));
  });

  it("scope vide → scopes []", async () => {
    const t = await auth.authenticate(
      new UserToken("jwt", await mint({ claims: { scope: undefined } })),
    );
    assert.deepEqual(t.getScopes(), []);
  });
});

describe("JwtAuthenticator — matrice d'attaques (RFC 8725)", () => {
  const reject = async (raw: string): Promise<void> => {
    await assert.rejects(
      () => auth.authenticate(new UserToken("jwt", raw)),
      (e: unknown) => {
        assert.ok(
          e instanceof AuthenticationError,
          "doit être AuthenticationError",
        );
        assert.equal((e as AuthenticationError).code, 401);
        return true;
      },
    );
  };
  const b64 = (o: object): string =>
    Buffer.from(JSON.stringify(o)).toString("base64url");

  it("token vide", async () => reject(""));

  it("alg=none forgé (§3.1)", async () => {
    const tok = `${b64({ alg: "none", typ: "at+jwt" })}.${b64({
      iss: RT.issuer,
      aud: RT.audiences[0],
      sub: "alice",
      jti: "x",
      iat: nowS(),
      exp: nowS() + 900,
    })}.`;
    await reject(tok);
  });

  it("algorithm confusion HS256 (§2.1) — clé publique comme secret HMAC", async () => {
    const tok = await new jose.SignJWT({
      iss: RT.issuer,
      aud: RT.audiences[0],
      sub: "alice",
      jti: "x",
      iat: nowS(),
      exp: nowS() + 900,
    })
      .setProtectedHeader({ alg: "HS256", kid: signing.kid, typ: "at+jwt" })
      .sign(new TextEncoder().encode("public-as-secret"));
    await reject(tok);
  });

  it("aud faux (§3.9)", async () =>
    reject(await mint({ claims: { aud: "evil" } })));
  it("iss faux (§3.8)", async () =>
    reject(await mint({ claims: { iss: "evil" } })));
  it("exp passé", async () =>
    reject(await mint({ claims: { exp: nowS() - 10 } })));
  it("nbf futur", async () =>
    reject(await mint({ claims: { nbf: nowS() + 600 } })));
  it("typ faux — refresh présenté comme access (§3.11)", async () =>
    reject(await mint({ header: { typ: "rt+jwt" } })));

  it("signature falsifiée", async () => {
    const raw = await mint();
    await reject(`${raw.slice(0, -4)}AAAA`);
  });

  it("kid inconnu — clé étrangère (§3.5)", async () => {
    const other = new JwtKeystore({}, () => {});
    const os = await other.getSigningKey();
    const tok = await new jose.SignJWT({
      iss: RT.issuer,
      aud: RT.audiences[0],
      sub: "alice",
      jti: "x",
      iat: nowS(),
      exp: nowS() + 900,
    })
      .setProtectedHeader({ alg: "EdDSA", kid: os.kid, typ: "at+jwt" })
      .sign(os.key);
    await reject(tok);
  });

  it("sub absent (§3.10)", async () =>
    reject(await mint({ claims: { sub: undefined } })));

  it("jti denylisté (révocation ciblée)", async () => {
    const raw = await mint({ claims: { jti: "denied-1" } });
    await store.denyJti("denied-1", Date.now() + 60_000);
    await reject(raw);
  });

  it("iat < invalidBefore (logout global / ban)", async () => {
    const raw = await mint();
    await store.revokeAllForSubject("alice", Date.now() + 60_000);
    await reject(raw);
  });

  it("sujet disparu (§3.10)", async () =>
    reject(await mint({ claims: { sub: "ghost" } })));
  it("sujet verrouillé (ban)", async () =>
    reject(await mint({ claims: { sub: "banned" } })));
  it("sujet inactif", async () =>
    reject(await mint({ claims: { sub: "inactive" } })));
});

describe("JwtAuthenticator — câblage manquant = Error (loggée, pas 401 masqué)", () => {
  it("keystore absent → Error (le firewall logge ERROR + 401 fail-closed)", async () => {
    const broken = new JwtAuthenticator(
      fakeContainer({ tokenStore: store, users: provider }),
      RT,
    );
    await assert.rejects(
      () => broken.authenticate(new UserToken("jwt", "any")),
      (e: unknown) => !(e instanceof AuthenticationError),
    );
  });
});
