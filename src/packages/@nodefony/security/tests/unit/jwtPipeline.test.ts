import assert from "node:assert/strict";
import { Container, Event, RequestContext } from "nodefony";
import type { Module } from "nodefony";
import type { IUser } from "@nodefony/user";
import type { ContextType } from "@nodefony/http";
import * as jose from "jose";
import { Firewall } from "../../nodefony/service/firewall";
import { SecuredArea } from "../../nodefony/src/SecuredArea";
import { JwtAuthenticator } from "../../nodefony/src/authenticator/JwtAuthenticator";
import { JwtKeystore } from "../../nodefony/src/token/JwtKeystore";
import { MemoryTokenStore } from "../../nodefony/src/token/MemoryTokenStore";
import {
  buildFrameAuthorizer,
  type IFrameAuthorizerFirewall,
} from "../../nodefony/src/realtime/frameAuthorizer";
import { AuthenticationError } from "../../nodefony/errors/AuthenticationError";
import type { ISecurityAreaConfig } from "../../nodefony/config/defineModuleConfig";
import type { IRealtimeToken } from "../../nodefony/src/realtime/realtimeContracts";
import type { IJwtRuntime } from "../../nodefony/src/token/jwtRuntime";

/**
 * Banc d'intégration des PONTS d'auth pour le JWT (matrice actif × chemin) :
 *  1. pipeline HTTP `Firewall.handleSecurity` → ALS + Zero Trust + challenge ;
 *  2. pont WS `api.request {path}` (frameAuthorizer) → un anonyme n'atteint pas
 *     la zone JWT par le data plane ;
 *  3. pont WS `subscribe {channel}` → canal d'observabilité fermé à l'anonyme.
 * Tout est monté sur le VRAI firewall + JwtAuthenticator + keystore/store réels.
 */

const RT: IJwtRuntime = {
  issuer: "https://test.nf",
  audiences: ["nf-api"],
  accessTtlS: 900,
  refreshTtlS: 604800,
  rotateRefresh: true,
  alg: "EdDSA",
};

const fakeUser = (identifier: string): IUser => ({
  id: `u-${identifier}`,
  identifier,
  roles: ["ROLE_USER"],
  hasRole: () => false,
  isActive: () => true,
  isLocked: () => false,
});

const provider = {
  async loadUserByIdentifier(id: string): Promise<IUser> {
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

const m2mArea = (): SecuredArea =>
  new SecuredArea("test-api", {
    pattern: "^/nodefony/test/m2m",
    security: true,
    stateless: true,
    mode: "first",
    authenticators: ["jwt"],
  } as ISecurityAreaConfig);

function makeContext(
  area: SecuredArea,
  authorization?: string,
): {
  context: ContextType;
  headers: Record<string, string>;
} {
  const headers: Record<string, string> = {};
  const context = {
    request: {
      headers: authorization ? { authorization } : {},
      url: new URL("https://localhost/nodefony/test/m2m/whoami"),
    },
    security: area,
    response: {
      setHeader: (n: string, v: string) => {
        headers[n] = v;
      },
    },
  } as unknown as ContextType;
  return { context, headers };
}

let keystore: JwtKeystore;
let store: MemoryTokenStore;
let firewall: Firewall;
let signing: { key: CryptoKey; kid: string };

const nowS = (): number => Math.floor(Date.now() / 1000);

async function bearer(
  over: { claims?: Record<string, unknown> } = {},
): Promise<string> {
  const token = await new jose.SignJWT({
    iss: RT.issuer,
    aud: RT.audiences[0],
    sub: "alice",
    jti: `jti-${Math.random()}`,
    iat: nowS(),
    exp: nowS() + 900,
    scope: "orders:read",
    ...over.claims,
  })
    .setProtectedHeader({ alg: "EdDSA", kid: signing.kid, typ: "at+jwt" })
    .sign(signing.key);
  return `Bearer ${token}`;
}

beforeEach(async () => {
  keystore = new JwtKeystore({}, () => {});
  store = new MemoryTokenStore();
  signing = await keystore.getSigningKey();
  firewall = new Firewall({
    container: new Container(),
    notificationsCenter: new Event(),
    options: {},
  } as unknown as Module);
  firewall.registerAuthenticator(
    new JwtAuthenticator(
      fakeContainer({
        jwtKeystore: keystore,
        tokenStore: store,
        users: provider,
      }),
      RT,
    ),
  );
});

describe("Pont HTTP — Firewall.handleSecurity sur zone JWT", () => {
  it("Bearer valide → identité dans l'ALS (zone franchie)", async () => {
    const { context } = makeContext(m2mArea(), await bearer());
    await RequestContext.run({ requestId: "p-ok" }, async () => {
      await firewall.handleSecurity(context);
      assert.equal((RequestContext.getUser() as IUser).identifier, "alice");
    });
  });

  it("sans Bearer → 401 Zero Trust + WWW-Authenticate: Bearer", async () => {
    const { context, headers } = makeContext(m2mArea());
    await RequestContext.run({ requestId: "p-none" }, async () => {
      await assert.rejects(
        () => firewall.handleSecurity(context),
        AuthenticationError,
      );
    });
    assert.equal(headers["WWW-Authenticate"], "Bearer");
  });

  it("Bearer invalide (aud faux) → 401 + challenge", async () => {
    const { context, headers } = makeContext(
      m2mArea(),
      await bearer({ claims: { aud: "evil" } }),
    );
    await RequestContext.run({ requestId: "p-bad" }, async () => {
      await assert.rejects(
        () => firewall.handleSecurity(context),
        AuthenticationError,
      );
    });
    assert.equal(headers["WWW-Authenticate"], "Bearer");
  });

  it("Bearer révoqué (jti denylisté) → 401", async () => {
    const raw = await bearer({ claims: { jti: "rev-1" } });
    await store.denyJti("rev-1", Date.now() + 60_000);
    const { context } = makeContext(m2mArea(), raw);
    await RequestContext.run({ requestId: "p-rev" }, async () => {
      await assert.rejects(
        () => firewall.handleSecurity(context),
        AuthenticationError,
      );
    });
  });
});

describe("Pont WS — frameAuthorizer (data plane / observabilité)", () => {
  // Firewall factice : zone test-m2m (matchPath) + hiérarchie (hasRole). La source
  // réelle = firewall.matchPath/hasRole une fois #build fait au boot ; ici on isole
  // la LOGIQUE du pont.
  const firewall: IFrameAuthorizerFirewall = {
    matchPath: (p: string) =>
      p.startsWith("/nodefony/test/m2m") ? { security: true } : null,
    hasRole: (roles, required) =>
      roles.includes(required) ||
      (required === "ROLE_USER" && roles.includes("ROLE_ADMIN")),
  };
  const authorize = buildFrameAuthorizer(firewall);
  const mk = (auth: boolean, roles: string[]): IRealtimeToken => ({
    type: auth ? "jwt" : "anonymous",
    getUserIdentifier: () => "x",
    isAuthenticated: () => auth,
    getRoles: () => roles,
    getScopes: () => [],
    getAttribute: () => undefined,
  });
  const anon = mk(false, ["ROLE_ANONYMOUS"]);
  const user = mk(true, ["ROLE_USER"]);
  const admin = mk(true, ["ROLE_ADMIN"]);

  it("api.request vers la zone JWT : anonyme REFUSÉ, authentifié AUTORISÉ", () => {
    const frame = {
      method: "api.request",
      params: { path: "/nodefony/test/m2m/whoami" },
    };
    assert.equal(authorize(frame, anon), false);
    assert.equal(authorize(frame, user), true); // authentifié suffit (zone)
  });

  it("api.request hors zone : autorisé (pas de zone capturée)", () => {
    const frame = { method: "api.request", params: { path: "/public/info" } };
    assert.equal(authorize(frame, anon), true);
  });

  it("subscribe canal d'observabilité (syslog:) : durci → ADMIN requis", () => {
    const frame = {
      method: "subscribe",
      params: { channel: "nodefony:syslog" },
    };
    assert.equal(authorize(frame, anon), false);
    assert.equal(authorize(frame, user), false); // durci P6 : user simple refusé
    assert.equal(authorize(frame, admin), true);
  });
});
