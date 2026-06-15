import assert from "node:assert/strict";
import { Container } from "nodefony";
import type { Module } from "nodefony";
import type { IUser, IOAuthProfile } from "@nodefony/user";
import type { OAuth2Tokens } from "arctic";
import { OAuth2Service } from "../../nodefony/service/oauth2";
import { AuthenticationError } from "../../nodefony/errors/AuthenticationError";
import type { IOAuthProvider } from "../../nodefony/contracts/IOAuthProvider";
import { registerOAuthProvider } from "../../nodefony/src/oauth/oauthProviderRegistry";

/**
 * OAuth2Service — orchestrateur du flux social login (sans HTTP ni réseau) :
 * génération de l'autorisation (state + PKCE), anti-mix-up `iss` (RFC 9207),
 * provisioning via la capability `users`, fail-closed.
 *
 * Un fournisseur FACTICE déterministe est enregistré dans le registre (aucun
 * appel réseau) ; seuls `generateState`/`generateCodeVerifier` (purs) viennent
 * du vrai arctic.
 */

const ISSUER = "https://issuer.test";

const fakeProvider: IOAuthProvider = {
  usesPkce: true,
  expectedIssuer: ISSUER,
  defaultScopes: ["openid"],
  createAuthorizationURL: (state, codeVerifier, scopes) =>
    new URL(
      `https://idp/auth?state=${state}&cv=${codeVerifier}&s=${scopes.join(",")}`,
    ),
  validateAuthorizationCode: () => Promise.resolve({} as OAuth2Tokens),
  fetchProfile: (): Promise<IOAuthProfile> =>
    Promise.resolve({
      provider: "test-oidc",
      providerId: "sub-1",
      email: "alice@test.io",
      emailVerified: true,
      name: "Alice",
      raw: {},
    }),
};
registerOAuthProvider("test-oidc", () => fakeProvider);

// Provisioner factice : capture le profil + la policy reçus, rend un IUser.
function makeUsers(): {
  provisionOAuthUser: (p: IOAuthProfile, policy: unknown) => Promise<IUser>;
  lastProfile: IOAuthProfile | null;
  lastPolicy: unknown;
} {
  const state = {
    lastProfile: null as IOAuthProfile | null,
    lastPolicy: null as unknown,
    provisionOAuthUser(p: IOAuthProfile, policy: unknown): Promise<IUser> {
      state.lastProfile = p;
      state.lastPolicy = policy;
      return Promise.resolve({
        id: "u-1",
        identifier: p.email ?? `${p.provider}:${p.providerId}`,
        roles: ["ROLE_USER"],
        hasRole: () => false,
        isActive: () => true,
        isLocked: () => false,
      });
    },
  };
  return state;
}

function buildService(
  configInput: unknown,
  users: unknown,
): { svc: OAuth2Service; boot: () => void } {
  const container = new Container();
  const handlers: Record<string, () => void> = {};
  container.set("kernel", {
    container,
    once(ev: string, cb: () => void) {
      handlers[ev] = cb;
    },
  });
  if (users !== undefined) container.set("users", users);
  const module = {
    container,
    notificationsCenter: false,
    options: configInput,
  } as unknown as Module;
  const svc = new OAuth2Service(module);
  return { svc, boot: () => handlers["onBoot"]?.() };
}

const config = {
  oauth2: {
    enabled: true,
    providers: {
      "test-oidc": {
        clientId: "id",
        clientSecret: "sec",
        redirectUri: "https://app/cb",
      },
    },
  },
};

describe("OAuth2Service — boot + introspection", () => {
  it("isEnabled + listProviders après boot", () => {
    const { svc, boot } = buildService(config, makeUsers());
    boot();
    assert.equal(svc.isEnabled(), true);
    assert.deepEqual(svc.listProviders(), ["test-oidc"]);
  });

  it("désactivé en config → idle (isEnabled false, 0 provider)", () => {
    const { svc, boot } = buildService(
      { oauth2: { enabled: false } },
      makeUsers(),
    );
    boot();
    assert.equal(svc.isEnabled(), false);
    assert.deepEqual(svc.listProviders(), []);
  });

  it("getRedirects expose les défauts", () => {
    const { svc, boot } = buildService(config, makeUsers());
    boot();
    assert.deepEqual(svc.getRedirects(), { success: "/", failure: "/login" });
  });
});

describe("OAuth2Service — createAuthorization (étape 1)", () => {
  it("génère state + code_verifier (PKCE) + URL", async () => {
    const { svc, boot } = buildService(config, makeUsers());
    boot();
    const a = await svc.createAuthorization("test-oidc");
    assert.ok(a.state.length > 0);
    assert.ok(a.codeVerifier && a.codeVerifier.length > 0); // PKCE
    assert.ok(a.url.includes(`state=${a.state}`));
  });

  it("provider non configuré → AuthenticationError", async () => {
    const { svc, boot } = buildService(config, makeUsers());
    boot();
    await assert.rejects(
      () => svc.createAuthorization("inconnu"),
      AuthenticationError,
    );
  });
});

describe("OAuth2Service — exchangeAndProvision (étape 2)", () => {
  it("iss valide → profil provisionné, identifiant rendu", async () => {
    const users = makeUsers();
    const { svc, boot } = buildService(config, users);
    boot();
    const res = await svc.exchangeAndProvision(
      "test-oidc",
      "code",
      "verifier",
      ISSUER,
    );
    assert.equal(res.identifier, "alice@test.io");
    assert.equal(users.lastProfile?.providerId, "sub-1");
    assert.deepEqual(users.lastPolicy, {
      defaultRoles: ["ROLE_USER"],
      allowSignup: true,
    });
  });

  it("iss différent → rejet (anti-mix-up RFC 9207)", async () => {
    const { svc, boot } = buildService(config, makeUsers());
    boot();
    await assert.rejects(
      () =>
        svc.exchangeAndProvision(
          "test-oidc",
          "code",
          "verifier",
          "https://evil",
        ),
      AuthenticationError,
    );
  });

  it("iss absent alors qu'attendu → rejet", async () => {
    const { svc, boot } = buildService(config, makeUsers());
    boot();
    await assert.rejects(
      () => svc.exchangeAndProvision("test-oidc", "code", "verifier", null),
      AuthenticationError,
    );
  });

  it("aucun provisioner (users sans provisionOAuthUser) → fail-closed", async () => {
    const { svc, boot } = buildService(config, { authenticate: () => null });
    boot();
    await assert.rejects(
      () => svc.exchangeAndProvision("test-oidc", "code", "verifier", ISSUER),
      AuthenticationError,
    );
  });
});
