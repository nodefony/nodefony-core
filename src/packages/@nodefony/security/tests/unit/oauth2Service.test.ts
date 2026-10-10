import assert from "node:assert/strict";
import { BootConfigurationError, Container } from "nodefony";
import type { Module } from "nodefony";
import type { IUser, IOAuthProfile } from "@nodefony/user";
import {
  OAuth2Service,
  checkProviderIssuer,
  oauthDisplayLabel,
} from "../../nodefony/service/oauth2";
import { AuthenticationError } from "../../nodefony/errors/AuthenticationError";
import type { IOAuthProvider } from "../../nodefony/contracts/IOAuthProvider";
import { registerOAuthProvider } from "../../nodefony/src/oauth/oauthProviderRegistry";
import { OAuth2Tokens } from "../../nodefony/src/oauth/oauth2Client";

/**
 * OAuth2Service — orchestrateur du flux social login (sans HTTP ni réseau) :
 * génération de l'autorisation (state + PKCE), anti-mix-up `iss` (RFC 9207),
 * provisioning via la capability `users`, fail-closed.
 *
 * Un fournisseur FACTICE déterministe est enregistré dans le registre (aucun
 * appel réseau) ; `generateState`/`generateCodeVerifier` sont les vrais, ils sont purs.
 */

const ISSUER = "https://issuer.test";

const fakeProvider: IOAuthProvider = {
  usesPkce: true,
  issuerPolicy: { issuer: ISSUER, requireIssParameter: true },
  defaultScopes: ["openid"],
  createAuthorizationURL: ({ state, codeVerifier, scopes }) =>
    new URL(
      `https://idp/auth?state=${state}&cv=${codeVerifier}&s=${scopes.join(",")}`,
    ),
  validateAuthorizationCode: () => Promise.resolve(new OAuth2Tokens({})),
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
  // Un vrai kernel porte TOUJOURS un profil (défaut console : pas de ports).
  runProfile: { servers: boolean } = { servers: false },
): { svc: OAuth2Service; boot: () => void } {
  const container = new Container();
  const handlers: Record<string, () => void> = {};
  container.set("kernel", {
    container,
    runProfile,
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

  it("l'échec suit la page de connexion quand elle change de chemin", () => {
    const { svc, boot } = buildService(
      { ...config, loginPage: { path: "/connexion" } },
      makeUsers(),
    );
    boot();
    assert.equal(svc.getRedirects("test-oidc").failure, "/connexion");
  });

  it("un failureRedirect réglé l'emporte sur la page de connexion", () => {
    const { svc, boot } = buildService(
      {
        oauth2: { ...config.oauth2, failureRedirect: "/oups" },
        loginPage: { path: "/connexion" },
      },
      makeUsers(),
    );
    boot();
    assert.equal(svc.getRedirects("test-oidc").failure, "/oups");
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

  it("iss absent alors que le serveur l'ANNONCE → rejet (promesse non tenue)", async () => {
    const { svc, boot } = buildService(config, makeUsers());
    boot();
    await assert.rejects(
      () => svc.exchangeAndProvision("test-oidc", "code", "verifier", null),
      AuthenticationError,
    );
  });

  // RFC 9207 §2.4 : le client extrait `iss` « if the parameter is present ».
  // Un serveur qui n'a jamais annoncé l'émettre — Microsoft Entra, entre autres —
  // est CONFORME en ne l'envoyant pas : le refuser refuserait tous ses comptes.
  it("iss absent d'un serveur qui ne l'annonce PAS → on continue", async () => {
    const permissif: IOAuthProvider = {
      ...fakeProvider,
      issuerPolicy: { issuer: ISSUER, requireIssParameter: false },
    };
    registerOAuthProvider("test-oidc-permissif", () => permissif);
    const permissiveConfig = {
      ...(config as Record<string, unknown>),
      oauth2: {
        ...((config as Record<string, unknown>).oauth2 as Record<
          string,
          unknown
        >),
        providers: {
          "test-oidc-permissif": {
            clientId: "id",
            clientSecret: "s",
            redirectUri: "https://a/cb",
          },
        },
      },
    };
    const { svc, boot } = buildService(permissiveConfig, makeUsers());
    boot();
    const { identifier } = await svc.exchangeAndProvision(
      "test-oidc-permissif",
      "code",
      "verifier",
      null,
    );
    assert.equal(identifier, "alice@test.io");
  });

  it("iss PRÉSENT et discordant → rejet, même chez un serveur permissif", async () => {
    const permissif: IOAuthProvider = {
      ...fakeProvider,
      issuerPolicy: { issuer: ISSUER, requireIssParameter: false },
    };
    registerOAuthProvider("test-oidc-permissif2", () => permissif);
    const permissiveConfig = {
      ...(config as Record<string, unknown>),
      oauth2: {
        ...((config as Record<string, unknown>).oauth2 as Record<
          string,
          unknown
        >),
        providers: {
          "test-oidc-permissif2": {
            clientId: "id",
            clientSecret: "s",
            redirectUri: "https://a/cb",
          },
        },
      },
    };
    const { svc, boot } = buildService(permissiveConfig, makeUsers());
    boot();
    await assert.rejects(
      () =>
        svc.exchangeAndProvision(
          "test-oidc-permissif2",
          "code",
          "verifier",
          "https://attaquant.test",
        ),
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

/**
 * Ce que l'écran de connexion doit MONTRER — distinct de ce qui est autorisable.
 *
 * L'écran filtrait sur une table de marques écrite en dur (`google`, `github`) :
 * Keycloak et l'entrée générique OIDC étaient configurables, opérationnels, et
 * invisibles. Le registre de fournisseurs est extensible ; son affichage doit
 * l'être aussi, sans quoi une application ne peut pas offrir SON fournisseur.
 */
describe("OAuth2Service — ce qui s'affiche, et ce qui reste autorisable", () => {
  const configKeycloak = {
    oauth2: {
      enabled: true,
      providers: {
        "test-oidc": {
          clientId: "id",
          clientSecret: "sec",
          redirectUri: "https://app/cb",
          hidden: true,
        },
        keycloak: {
          clientId: "id",
          clientSecret: "sec",
          redirectUri: "https://app/cb",
          issuer: ISSUER,
        },
      },
    },
  };

  it("montre un fournisseur qu'aucune table de marques ne connaît", () => {
    const { svc, boot } = buildService(configKeycloak, makeUsers());
    boot();
    const affiches = svc.listDisplayProviders().map((p) => p.name);
    assert.ok(affiches.includes("keycloak"), "keycloak doit être proposé");
  });

  // PIÈGE : c'est LA distinction qui fonde la correction. Retirer un
  // fournisseur de `listProviders` pour le masquer le rendrait non
  // autorisable — `/authorize` répondrait 404 et les bancs E2E qui exercent
  // la fixture tomberaient, pour une raison purement cosmétique.
  it("masquer n'est pas désactiver : `hidden` sort de l'écran, pas de la garde", () => {
    const { svc, boot } = buildService(configKeycloak, makeUsers());
    boot();
    assert.deepEqual(
      svc.listDisplayProviders().map((p) => p.name),
      ["keycloak"],
      "la fixture masquée ne doit pas être proposée",
    );
    assert.ok(
      svc.listProviders().includes("test-oidc"),
      "…mais son flux doit rester ouvert",
    );
  });

  it("donne un libellé lisible, jamais un identifiant technique brut", () => {
    const { svc, boot } = buildService(configKeycloak, makeUsers());
    boot();
    const keycloak = svc
      .listDisplayProviders()
      .find((p) => p.name === "keycloak");
    assert.equal(keycloak?.label, "Keycloak");
  });

  it("le libellé de la configuration prime sur celui qu'on dérive", () => {
    const { svc, boot } = buildService(
      {
        oauth2: {
          enabled: true,
          providers: {
            keycloak: {
              clientId: "id",
              clientSecret: "sec",
              redirectUri: "https://app/cb",
              issuer: ISSUER,
              label: "Annuaire interne",
            },
          },
        },
      },
      makeUsers(),
    );
    boot();
    assert.deepEqual(svc.listDisplayProviders(), [
      { name: "keycloak", label: "Annuaire interne" },
    ]);
  });
});

describe("oauthDisplayLabel — rendre un nom de configuration lisible", () => {
  it("capitalise, et coupe sur les séparateurs", () => {
    assert.equal(oauthDisplayLabel("keycloak"), "Keycloak");
    assert.equal(oauthDisplayLabel("mon-idp"), "Mon Idp");
    assert.equal(oauthDisplayLabel("azure_ad.test"), "Azure Ad Test");
  });

  // PIÈGE : « Oidc » ou « Sso » ne se reconnaissent pas — un sigle se lit en
  // capitales, sinon le bouton nomme une technologie que personne n'identifie.
  it("préserve les sigles", () => {
    assert.equal(oauthDisplayLabel("oidc"), "OIDC");
    assert.equal(oauthDisplayLabel("sso-interne"), "SSO Interne");
  });

  // PIÈGE trouvé À L'ÉCRAN, pas au test : la capitalisation naïve rendait
  // « Github », que la marque n'écrit jamais ainsi — et c'est ce mot que
  // l'utilisateur cherche des yeux sur le bouton.
  it("respecte la casse interne des marques", () => {
    assert.equal(oauthDisplayLabel("github"), "GitHub");
    assert.equal(oauthDisplayLabel("gitlab"), "GitLab");
    assert.equal(oauthDisplayLabel("google"), "Google");
  });
});

/**
 * #270 — une configuration de fournisseur fausse se montre AU DÉMARRAGE, pas au
 * premier clic ; un émetteur injoignable, lui, n'est pas une faute de
 * configuration : il retire le bouton sans bloquer le boot.
 */
describe("OAuth2Service — émetteur vérifié au démarrage (#270)", () => {
  const keycloak = (issuer?: string): unknown => ({
    oauth2: {
      enabled: true,
      providers: {
        keycloak: {
          clientId: "id",
          clientSecret: "sec",
          redirectUri: "https://app/cb",
          ...(issuer === undefined ? {} : { issuer }),
        },
      },
    },
  });

  it("keycloak SANS émetteur → le boot est refusé, la clé est nommée", () => {
    const { svc, boot } = buildService(keycloak(), makeUsers());
    assert.throws(boot, (error: unknown) => {
      assert.ok(BootConfigurationError.is(error));
      assert.match(
        (error as Error).message,
        /security\.oauth2\.providers\.keycloak\.issuer est requis/,
      );
      assert.match((error as Error).message, /https:\/\//);
      return true;
    });
    assert.equal(svc.isEnabled(), false);
  });

  for (const [why, issuer] of [
    ["pas une URL", "realm-nodefony"],
    ["en http", "http://kc.example/realms/app"],
    ["avec une requête", "https://kc.example/realms/app?x=1"],
  ] as const) {
    it(`émetteur ${why} → le boot est refusé`, () => {
      const { boot } = buildService(keycloak(issuer), makeUsers());
      assert.throws(boot, (error: unknown) => {
        assert.ok(BootConfigurationError.is(error));
        assert.match(
          (error as Error).message,
          /security\.oauth2\.providers\.keycloak\.issuer — émetteur invalide/,
        );
        return true;
      });
    });
  }

  it("un émetteur mal formé est refusé même là où il est facultatif", () => {
    assert.throws(
      () => checkProviderIssuer("test-oidc", "pas une url"),
      BootConfigurationError,
    );
    assert.doesNotThrow(() => checkProviderIssuer("test-oidc", undefined));
  });

  it("une fabrique d'application qui DÉCLARE l'émetteur requis est tenue de même", () => {
    registerOAuthProvider("test-app-oidc", () => fakeProvider, {
      requiresIssuer: true,
    });
    assert.throws(
      () => checkProviderIssuer("test-app-oidc", undefined),
      /test-app-oidc\.issuer est requis/,
    );
    assert.doesNotThrow(() =>
      checkProviderIssuer("test-app-oidc", "https://idp.example/realms/a"),
    );
  });

  it("émetteur valide → le boot passe, sans toucher au réseau en console", () => {
    let built = 0;
    registerOAuthProvider("test-console", () => {
      built += 1;
      return fakeProvider;
    });
    const { svc, boot } = buildService(
      {
        oauth2: {
          enabled: true,
          providers: {
            "test-console": {
              clientId: "id",
              clientSecret: "sec",
              redirectUri: "https://app/cb",
            },
          },
        },
      },
      makeUsers(),
      { servers: false },
    );
    boot();
    assert.equal(svc.isEnabled(), true);
    assert.equal(built, 0);
  });

  it("émetteur INJOIGNABLE → le boot passe, le bouton disparaît puis revient", async () => {
    let down = true;
    let built = 0;
    registerOAuthProvider("test-down", () => {
      built += 1;
      return down
        ? Promise.reject(new Error("métadonnées introuvables"))
        : fakeProvider;
    });
    const { svc, boot } = buildService(
      {
        oauth2: {
          enabled: true,
          providers: {
            "test-down": {
              clientId: "id",
              clientSecret: "sec",
              redirectUri: "https://app/cb",
            },
          },
        },
      },
      makeUsers(),
      { servers: true },
    );
    const now = vi.spyOn(Date, "now");
    try {
      now.mockReturnValue(1_000_000);
      boot();
      assert.equal(built, 1, "un run qui sert construit dès le boot");
      await new Promise((r) => setImmediate(r));
      // Retiré de l'écran, mais toujours autorisable (lien direct, bancs).
      assert.deepEqual(svc.listDisplayProviders(), []);
      assert.deepEqual(svc.listProviders(), ["test-down"]);
      assert.equal(built, 1, "pas de nouvel essai avant le délai");

      down = false;
      now.mockReturnValue(1_000_000 + 30_000);
      assert.deepEqual(svc.listDisplayProviders(), []);
      assert.equal(built, 2, "le délai écoulé relance une construction");
      await new Promise((r) => setImmediate(r));
      assert.deepEqual(
        svc.listDisplayProviders().map((p) => p.name),
        ["test-down"],
      );
    } finally {
      now.mockRestore();
    }
  });
});

// Fournisseur qui sait fermer sa session (Keycloak) : l'ID token est retenu.
const logoutRequests: unknown[] = [];
const logoutProvider: IOAuthProvider = {
  ...fakeProvider,
  validateAuthorizationCode: () =>
    Promise.resolve(new OAuth2Tokens({ id_token: "id.token.jwt" })),
  fetchProfile: (): Promise<IOAuthProfile> =>
    Promise.resolve({
      provider: "test-kc",
      providerId: "sub-2",
      email: "bob@test.io",
      emailVerified: true,
      name: "Bob",
      raw: { sid: "kc-session-1" },
    }),
  createLogoutURL: (request) => {
    logoutRequests.push(request);
    return new URL("https://idp/logout?hint=" + request.idTokenHint);
  },
};
registerOAuthProvider("test-kc", () => logoutProvider);

/** Session minimale — un dictionnaire, comme le stockage la rend. */
function fakeSession(): {
  get(k: string): unknown;
  set(k: string, v: unknown): unknown;
} {
  const data = new Map<string, unknown>();
  return { get: (k) => data.get(k), set: (k, v) => data.set(k, v) };
}

describe("OAuth2Service — déconnexion chez le fournisseur (RP-Initiated Logout, #517)", () => {
  const kcConfig = (extra: Record<string, unknown> = {}) => ({
    oauth2: {
      enabled: true,
      // Marqueur d'échec dans la query : il ne doit PAS partir chez le
      // fournisseur (Keycloak refuse `error` dans un retour, vécu).
      failureRedirect: "/nodefony/login?error=oauth#x",
      providers: {
        "test-oidc": {
          clientId: "id",
          clientSecret: "sec",
          redirectUri: "https://app/cb",
        },
        "test-kc": {
          clientId: "id",
          clientSecret: "sec",
          redirectUri: "https://app.example/nodefony/oauth2/test-kc/callback",
          ...extra,
        },
      },
    },
  });

  it("un fournisseur qui sait déconnecter : l'échange rend ID token et sid", async () => {
    const { svc, boot } = buildService(kcConfig(), makeUsers());
    boot();
    const res = await svc.exchangeAndProvision("test-kc", "c", "v", ISSUER);
    assert.deepEqual(res.logoutHint, {
      provider: "test-kc",
      idToken: "id.token.jwt",
      sid: "kc-session-1",
    });
  });

  it("un fournisseur sans point de déconnexion : rien n'est retenu", async () => {
    const { svc, boot } = buildService(kcConfig(), makeUsers());
    boot();
    const res = await svc.exchangeAndProvision("test-oidc", "c", "v", ISSUER);
    assert.equal(res.logoutHint, null);
  });

  it("logoutUrlFor rejoue l'ID token et revient sur la page de connexion par défaut", async () => {
    const { svc, boot } = buildService(kcConfig(), makeUsers());
    boot();
    const { logoutHint } = await svc.exchangeAndProvision(
      "test-kc",
      "c",
      "v",
      ISSUER,
    );
    const session = fakeSession();
    svc.rememberLogout(session, logoutHint);
    logoutRequests.length = 0;
    const url = await svc.logoutUrlFor(session);
    assert.equal(url, "https://idp/logout?hint=id.token.jwt");
    assert.deepEqual(logoutRequests, [
      {
        idTokenHint: "id.token.jwt",
        postLogoutRedirectUri: "https://app.example/nodefony/login",
      },
    ]);
  });

  it("postLogoutRedirectUri configuré prime sur le défaut", async () => {
    const { svc, boot } = buildService(
      kcConfig({ postLogoutRedirectUri: "https://app.example/au-revoir" }),
      makeUsers(),
    );
    boot();
    const session = fakeSession();
    svc.rememberLogout(session, {
      provider: "test-kc",
      idToken: "t",
      sid: null,
    });
    logoutRequests.length = 0;
    await svc.logoutUrlFor(session);
    assert.deepEqual(logoutRequests, [
      {
        idTokenHint: "t",
        postLogoutRedirectUri: "https://app.example/au-revoir",
      },
    ]);
  });

  it("l'index fédéré (fournisseur, sid) part en MÉTADONNÉE, sans l'ID token", () => {
    // L'énumération des sessions redacte les attributs : c'est par la
    // métadonnée que le canal arrière retrouve une session.
    const { svc, boot } = buildService(kcConfig(), makeUsers());
    boot();
    const meta = new Map<string, unknown>();
    const session = {
      ...fakeSession(),
      setMetaBag: (k: string, v: unknown) => meta.set(k, v),
    };
    svc.rememberLogout(session, {
      provider: "test-kc",
      idToken: "secret.id.token",
      sid: "kc-session-1",
    });
    assert.deepEqual(meta.get("oauth2:federation"), {
      provider: "test-kc",
      sid: "kc-session-1",
    });
    assert.ok(!JSON.stringify([...meta]).includes("secret.id.token"));
  });

  it("sans indice, ou indice altéré, ou session absente : null (déconnexion locale)", async () => {
    const { svc, boot } = buildService(kcConfig(), makeUsers());
    boot();
    assert.equal(await svc.logoutUrlFor(fakeSession()), null);
    assert.equal(await svc.logoutUrlFor(null), null);
    const tampered = fakeSession();
    tampered.set("oauth2:logout", { provider: "test-kc", idToken: 42 });
    assert.equal(await svc.logoutUrlFor(tampered), null);
  });
});

// ── Canal arrière (OpenID Connect Back-Channel Logout, #517) ────────────────
// Le jeton « signé » est ici du JSON : la signature est éprouvée ailleurs
// (oauthProviders.test.ts, vraie clé) — on éprouve ici ce que le service EN FAIT.
const bclProvider: IOAuthProvider = {
  ...logoutProvider,
  verifyLogoutToken: (token) => {
    if (token === "panne") return Promise.reject(new Error("jwks injoignable"));
    if (token === "faux") return Promise.resolve(null);
    const c = JSON.parse(token) as Record<string, unknown>;
    return Promise.resolve({
      issuer: ISSUER,
      subject: (c.sub as string | undefined) ?? null,
      sid: (c.sid as string | undefined) ?? null,
      tokenId: (c.jti as string | undefined) ?? "j",
      expiresAt: Math.floor(Date.now() / 1000) + 120,
    });
  },
};
registerOAuthProvider("test-bcl", () => bclProvider);

interface IStoredSession {
  id: string;
  data: { user: string; metaBag: Record<string, unknown> };
}

/** Parc de sessions + `destroyWhere` fidèle au contrat (filtre `user` IGNORÉ exprès). */
function fakeSessions(parc: IStoredSession[]): {
  destroyWhere(
    filter: { user?: string } | undefined,
    match: (d: IStoredSession["data"]) => boolean,
  ): Promise<number>;
  filters: unknown[];
} {
  const filters: unknown[] = [];
  return {
    filters,
    destroyWhere(filter, match) {
      filters.push(filter);
      let n = 0;
      for (let i = parc.length - 1; i >= 0; i -= 1) {
        const s = parc[i];
        if (s !== undefined && match(s.data)) {
          parc.splice(i, 1);
          n += 1;
        }
      }
      return Promise.resolve(n);
    },
  };
}

function session(
  id: string,
  user: string,
  hint: { provider: string; sid: string | null } | null,
): IStoredSession {
  return {
    id,
    data: {
      user,
      metaBag: hint === null ? {} : { "oauth2:federation": hint },
    },
  };
}

describe("OAuth2Service — déconnexion par le canal arrière (Back-Channel Logout, #517)", () => {
  const bclConfig = {
    oauth2: {
      enabled: true,
      providers: {
        "test-bcl": {
          clientId: "id",
          clientSecret: "sec",
          redirectUri: "https://app/cb",
        },
        "test-oidc": {
          clientId: "id",
          clientSecret: "sec",
          redirectUri: "https://app/cb",
        },
      },
    },
  };

  /** Comptes liés : `sub` du fournisseur → identifiant local. */
  const links: Record<string, string> = {
    "kc-alice": "alice",
    "kc-bob": "bob",
  };
  const users = {
    ...makeUsers(),
    loadUserByOAuth(provider: string, providerId: string): Promise<IUser> {
      const identifier =
        provider === "test-bcl" ? links[providerId] : undefined;
      if (identifier === undefined) return Promise.reject(new Error("inconnu"));
      return Promise.resolve({
        id: identifier,
        identifier,
        roles: [],
        hasRole: () => false,
        isActive: () => true,
        isLocked: () => false,
      });
    },
  };

  function setup(parc: IStoredSession[]) {
    const { svc, boot } = buildService(bclConfig, users);
    const sessions = fakeSessions(parc);
    svc.container?.set("sessions", sessions);
    boot();
    return { svc, sessions };
  }

  it("sid : ferme LA session qu'il désigne, et elle seule", async () => {
    const parc = [
      session("a1", "alice", { provider: "test-bcl", sid: "S1" }),
      session("a2", "alice", { provider: "test-bcl", sid: "S2" }),
      session("b1", "bob", { provider: "test-bcl", sid: "S3" }),
    ];
    const { svc } = setup(parc);
    const res = await svc.backchannelLogout(
      "test-bcl",
      JSON.stringify({ sub: "kc-alice", sid: "S1", jti: "j-sid" }),
    );
    assert.deepEqual(res, { outcome: "done", destroyed: 1 });
    assert.deepEqual(
      parc.map((s) => s.id),
      ["a1", "a2", "b1"].filter((id) => id !== "a1"),
    );
  });

  it("sub seul : toutes les sessions du compte ouvertes par CE fournisseur — jamais celles d'un mot de passe ou d'un autre fournisseur", async () => {
    const parc = [
      session("a1", "alice", { provider: "test-bcl", sid: "S1" }),
      session("a2", "alice", { provider: "test-bcl", sid: "S2" }),
      session("a3", "alice", null), // mot de passe
      session("a4", "alice", { provider: "test-oidc", sid: "S9" }),
      session("b1", "bob", { provider: "test-bcl", sid: "S3" }),
    ];
    const { svc, sessions } = setup(parc);
    const res = await svc.backchannelLogout(
      "test-bcl",
      JSON.stringify({ sub: "kc-alice", jti: "j-sub" }),
    );
    assert.deepEqual(res, { outcome: "done", destroyed: 2 });
    assert.deepEqual(
      parc.map((s) => s.id),
      ["a3", "a4", "b1"],
    );
    // Le parcours est restreint au compte (index du store), et RE-vérifié.
    assert.deepEqual(sessions.filters, [{ user: "alice" }]);
  });

  it("sid sans sub (ou sub inconnu) : parcourt tout le parc, ne ferme que la session désignée", async () => {
    const parc = [
      session("a1", "alice", { provider: "test-bcl", sid: "S1" }),
      session("b1", "bob", { provider: "test-bcl", sid: "S3" }),
    ];
    const { svc, sessions } = setup(parc);
    const res = await svc.backchannelLogout(
      "test-bcl",
      JSON.stringify({ sub: "kc-inconnu", sid: "S3", jti: "j-sid-only" }),
    );
    assert.deepEqual(res, { outcome: "done", destroyed: 1 });
    assert.deepEqual(
      parc.map((s) => s.id),
      ["a1"],
    );
    assert.deepEqual(sessions.filters, [undefined]);
  });

  it("sub inconnu sans sid : rien à fermer, et c'est un succès (§2.7)", async () => {
    const parc = [session("a1", "alice", { provider: "test-bcl", sid: "S1" })];
    const { svc, sessions } = setup(parc);
    const res = await svc.backchannelLogout(
      "test-bcl",
      JSON.stringify({ sub: "kc-inconnu", jti: "j-none" }),
    );
    assert.deepEqual(res, { outcome: "done", destroyed: 0 });
    assert.equal(parc.length, 1);
    assert.deepEqual(sessions.filters, []);
  });

  it("jeton refusé par la vérification : refused, aucune session touchée", async () => {
    const parc = [session("a1", "alice", { provider: "test-bcl", sid: "S1" })];
    const { svc, sessions } = setup(parc);
    assert.deepEqual(await svc.backchannelLogout("test-bcl", "faux"), {
      outcome: "refused",
    });
    assert.deepEqual(sessions.filters, []);
  });

  it("rejeu du même jti : refusé la seconde fois", async () => {
    const parc = [session("a1", "alice", { provider: "test-bcl", sid: "S1" })];
    const { svc } = setup(parc);
    const token = JSON.stringify({
      sub: "kc-alice",
      sid: "S1",
      jti: "j-rejeu",
    });
    assert.equal(
      (await svc.backchannelLogout("test-bcl", token)).outcome,
      "done",
    );
    // Une nouvelle session ouverte entre-temps sur le même sid ne doit pas
    // tomber sous un jeton rejoué.
    parc.push(session("a5", "alice", { provider: "test-bcl", sid: "S1" }));
    assert.deepEqual(await svc.backchannelLogout("test-bcl", token), {
      outcome: "refused",
    });
    assert.deepEqual(
      parc.map((s) => s.id),
      ["a5"],
    );
  });

  it("panne de vérification : lève (la déconnexion a ÉCHOUÉ, ce n'est pas un refus)", async () => {
    const { svc } = setup([]);
    await assert.rejects(
      svc.backchannelLogout("test-bcl", "panne"),
      /jwks injoignable/,
    );
  });

  it("fournisseur sans jeton de déconnexion : unsupported", async () => {
    const { svc } = setup([]);
    assert.deepEqual(await svc.backchannelLogout("test-oidc", "x"), {
      outcome: "unsupported",
    });
  });
});
