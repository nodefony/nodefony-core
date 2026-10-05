import assert from "node:assert/strict";
import { BootConfigurationError, Container } from "nodefony";
import type { IAccessPrincipal, Module } from "nodefony";
import type { ContextType } from "@nodefony/http";
import {
  InMemoryUserRepository,
  UserService,
  type IOAuthProfile,
  type IPasswordEncoder,
} from "@nodefony/user";
import {
  compileProviderRoleMapping,
  mapProviderRoles,
} from "../../nodefony/src/oauth/providerRoles";
import { defineSecurityConfig } from "../../nodefony/config/defineModuleConfig";
import { OAuth2Service } from "../../nodefony/service/oauth2";
import { registerOAuthProvider } from "../../nodefony/src/oauth/oauthProviderRegistry";
import { OAuth2Tokens } from "../../nodefony/src/oauth/oauth2Client";
import type { IOAuthProvider } from "../../nodefony/contracts/IOAuthProvider";
import { ExternalJwtAuthenticator } from "../../nodefony/src/authenticator/ExternalJwtAuthenticator";
import type { ISecuredArea } from "../../nodefony/contracts/ISecuredArea";

/**
 * Rôles de l'annuaire traduits en rôles de l'application (#519) — table en
 * configuration, recalcul à la CONNEXION et à chaque JETON d'API, rôles de
 * plateforme refusés au démarrage.
 */

const ISSUER = "https://kc.example/realms/app";
const CLIENT_ID = "nodefony-app";
const TABLE = { admin: "ROLE_ADMIN", editor: "ROLE_EDITOR" };

/** JWS compact non signé dont seul le payload compte. */
const jws = (claims: Record<string, unknown>): string => {
  const seg = (o: unknown): string =>
    Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
  return `${seg({ alg: "RS256", typ: "JWT" })}.${seg(claims)}.c2ln`;
};

const clientRoles = (...roles: string[]) => ({
  resource_access: { [CLIENT_ID]: { roles } },
});

const encoder: IPasswordEncoder = {
  supports: () => true,
  hash: (plain) => Promise.resolve(`hashed:${plain}`),
  verify: () => Promise.resolve(true),
  needsRehash: () => false,
};

describe("mapProviderRoles — lecture des claims", () => {
  const mapping = compileProviderRoleMapping({
    clientId: CLIENT_ID,
    roleMapping: TABLE,
  });

  it("sans `roleMapping` → null (rôles entièrement locaux)", () => {
    assert.equal(compileProviderRoleMapping({ clientId: CLIENT_ID }), null);
  });

  it("source par défaut : les rôles du CLIENT, pas ceux du realm", () => {
    assert.ok(mapping);
    assert.deepEqual(
      mapProviderRoles(mapping, {
        ...clientRoles("admin"),
        realm_access: { roles: ["editor"] },
      }),
      ["ROLE_ADMIN"],
    );
  });

  it("rôle absent de la table → ignoré, jamais recopié", () => {
    assert.ok(mapping);
    assert.deepEqual(
      mapProviderRoles(mapping, clientRoles("ROLE_ADMIN", "superuser")),
      [],
    );
  });

  it("les clés du prototype ne résolvent rien", () => {
    assert.ok(mapping);
    assert.deepEqual(
      mapProviderRoles(mapping, clientRoles("constructor", "__proto__")),
      [],
    );
  });

  it("rôles d'un AUTRE client ignorés", () => {
    assert.ok(mapping);
    assert.deepEqual(
      mapProviderRoles(mapping, {
        resource_access: { "autre-client": { roles: ["admin"] } },
      }),
      [],
    );
  });

  it("realm et groups sur demande ; plusieurs jeux de claims se cumulent", () => {
    const wide = compileProviderRoleMapping({
      clientId: CLIENT_ID,
      roleMapping: { admin: "ROLE_ADMIN", "/editors": "ROLE_EDITOR" },
      rolesSource: ["realm", "groups"],
    });
    assert.ok(wide);
    assert.deepEqual(
      mapProviderRoles(
        wide,
        { realm_access: { roles: ["admin"] } },
        { groups: ["/editors"] },
        null,
      ),
      ["ROLE_ADMIN", "ROLE_EDITOR"],
    );
  });

  it("claims de forme inattendue → aucun rôle, aucune exception", () => {
    assert.ok(mapping);
    assert.deepEqual(
      mapProviderRoles(mapping, { resource_access: "x" }, { groups: 3 }),
      [],
    );
  });
});

describe("roleMapping — refus au démarrage", () => {
  const withMapping = (
    roleMapping: Record<string, string>,
    allowPlatformRoles?: boolean,
  ) => ({
    oauth2: {
      providers: {
        keycloak: {
          clientId: CLIENT_ID,
          clientSecret: "s",
          redirectUri: "https://app/cb",
          issuer: ISSUER,
          roleMapping,
          ...(allowPlatformRoles === undefined ? {} : { allowPlatformRoles }),
        },
      },
    },
  });

  it("🔴 un rôle ROLE_NODEFONY_* refuse le démarrage en nommant la clé", () => {
    assert.throws(
      () => defineSecurityConfig(withMapping({ admin: "ROLE_NODEFONY_ADMIN" })),
      (error: unknown) =>
        error instanceof BootConfigurationError &&
        error.message.includes("roleMapping") &&
        error.message.includes("ROLE_NODEFONY_ADMIN"),
    );
  });

  it("rôle de plateforme accepté quand `allowPlatformRoles` est ÉCRIT", () => {
    const config = defineSecurityConfig(
      withMapping({ "admin-nodefony": "ROLE_NODEFONY_ADMIN" }, true),
    );
    const mapping = compileProviderRoleMapping(
      config.oauth2.providers.keycloak!,
    );
    assert.ok(mapping);
    assert.deepEqual(mapProviderRoles(mapping, clientRoles("admin-nodefony")), [
      "ROLE_NODEFONY_ADMIN",
    ]);
  });

  it("`allowPlatformRoles: false` explicite → toujours refusé", () => {
    assert.throws(
      () =>
        defineSecurityConfig(
          withMapping({ "admin-nodefony": "ROLE_NODEFONY_ADMIN" }, false),
        ),
      BootConfigurationError,
    );
  });

  it("une table ordinaire passe", () => {
    const config = defineSecurityConfig(withMapping(TABLE));
    assert.deepEqual(config.oauth2.providers.keycloak?.roleMapping, TABLE);
  });
});

// ─── Connexion par navigateur ──────────────────────────────────────────────

let accessToken = jws(clientRoles("admin"));
const kcProvider: IOAuthProvider = {
  usesPkce: true,
  issuerPolicy: null,
  defaultScopes: ["openid"],
  createAuthorizationURL: () => new URL("https://kc.example/auth"),
  validateAuthorizationCode: () =>
    Promise.resolve(
      new OAuth2Tokens({ access_token: accessToken, token_type: "Bearer" }),
    ),
  fetchProfile: (): Promise<IOAuthProfile> =>
    Promise.resolve({
      provider: "test-kc-roles",
      providerId: "kc-bob",
      email: "bob@example.test",
      emailVerified: true,
      name: "Bob",
      raw: {},
    }),
};
registerOAuthProvider("test-kc-roles", () => kcProvider);

function bootOAuth(users: UserService): OAuth2Service {
  const container = new Container();
  const handlers: Record<string, () => void> = {};
  container.set("kernel", {
    container,
    runProfile: { servers: false },
    once(ev: string, cb: () => void) {
      handlers[ev] = cb;
    },
  });
  container.set("users", users);
  const svc = new OAuth2Service({
    container,
    notificationsCenter: false,
    options: {
      oauth2: {
        providers: {
          "test-kc-roles": {
            clientId: CLIENT_ID,
            clientSecret: "s",
            redirectUri: "https://app/cb",
            roleMapping: TABLE,
          },
        },
      },
    },
  } as unknown as Module);
  handlers["onBoot"]?.();
  return svc;
}

describe("Connexion — rôles relus dans le jeton d'accès à chaque login", () => {
  it("rôle accordé puis retiré dans l'annuaire ; rôle local conservé", async () => {
    const users = new UserService(new InMemoryUserRepository(), encoder);
    const svc = bootOAuth(users);

    accessToken = jws(clientRoles("admin"));
    const first = await svc.exchangeAndProvision(
      "test-kc-roles",
      "c",
      "v",
      null,
    );
    const created = await users.findByIdentifier(first.identifier);
    assert.ok(created);
    assert.deepEqual([...created.roles].sort(), ["ROLE_ADMIN", "ROLE_USER"]);

    await users.updateOne(
      { id: created.id },
      { roles: [...created.roles, "ROLE_AUDITOR"] },
    );

    accessToken = jws(clientRoles());
    await svc.exchangeAndProvision("test-kc-roles", "c", "v", null);
    const after = await users.findByIdentifier(first.identifier);
    assert.deepEqual([...(after?.roles ?? [])].sort(), [
      "ROLE_AUDITOR",
      "ROLE_USER",
    ]);
  });

  it("jeton d'accès opaque → aucun rôle géré (fail-closed)", async () => {
    const users = new UserService(new InMemoryUserRepository(), encoder);
    const svc = bootOAuth(users);
    accessToken = "opaque-token";
    const res = await svc.exchangeAndProvision("test-kc-roles", "c", "v", null);
    const user = await users.findByIdentifier(res.identifier);
    assert.deepEqual(user?.roles, ["ROLE_USER"]);
  });
});

// ─── Jeton d'API ───────────────────────────────────────────────────────────

const RESOURCE = "https://app.example/api";
const area = {
  name: "api",
  authenticators: ["external-jwt"],
  resource: RESOURCE,
} as unknown as ISecuredArea;

function buildAuth(
  users: UserService,
  claims: () => Record<string, unknown>,
): ExternalJwtAuthenticator {
  const services: Record<string, unknown> = {
    users,
    accessTokenVerifier: (): Promise<IAccessPrincipal> =>
      Promise.resolve({
        issuer: ISSUER,
        subject: "kc-bob",
        scopes: [],
        claims: claims(),
      }),
  };
  return new ExternalJwtAuthenticator(
    { get: (name: string): unknown => services[name] } as unknown as Container,
    {
      issuers: [{ issuer: ISSUER, subjectMapping: "prefixed" }],
      subjectPolicy: "require",
      ephemeralRoles: [],
      oauthProviders: [
        {
          name: "keycloak",
          issuer: ISSUER,
          roleMapping: compileProviderRoleMapping({
            clientId: CLIENT_ID,
            roleMapping: TABLE,
          }),
        },
      ],
    },
  );
}

const apiContext = {
  request: {
    headers: { authorization: `Bearer ${jws({ iss: ISSUER, sub: "kc-bob" })}` },
  },
  security: area,
} as unknown as ContextType;

describe("Jeton d'API — rôles recalculés à chaque jeton", () => {
  async function linkedBob(): Promise<UserService> {
    const users = new UserService(new InMemoryUserRepository(), encoder);
    await users.provisionOAuthUser(
      { ...kcProvider, provider: "keycloak", providerId: "kc-bob" } as never,
      { defaultRoles: ["ROLE_USER"], allowSignup: true },
    );
    return users;
  }

  it("bob porteur du rôle client `admin` → ROLE_ADMIN ; retiré → disparaît", async () => {
    const users = await linkedBob();
    let current: Record<string, unknown> = clientRoles("admin");
    const auth = buildAuth(users, () => current);

    const granted = await auth.authenticate(await auth.createToken(apiContext));
    assert.ok(granted.getUser().roles.includes("ROLE_ADMIN"));

    current = clientRoles();
    const revoked = await auth.authenticate(await auth.createToken(apiContext));
    assert.ok(!revoked.getUser().roles.includes("ROLE_ADMIN"));
  });

  it("aucune écriture tant que les rôles ne changent pas", async () => {
    const users = await linkedBob();
    const auth = buildAuth(users, () => clientRoles("admin"));
    await auth.authenticate(await auth.createToken(apiContext));
    let writes = 0;
    const original = users.updateOne.bind(users);
    users.updateOne = (criteria, data) => {
      writes++;
      return original(criteria, data);
    };
    for (let i = 0; i < 5; i++) {
      await auth.authenticate(await auth.createToken(apiContext));
    }
    assert.equal(writes, 0);
  });
});
