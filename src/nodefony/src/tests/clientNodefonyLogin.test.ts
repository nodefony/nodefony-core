/**
 * `NodefonyLogin` — le déroulé de connexion côté navigateur, éprouvé UNE fois.
 *
 * Les règles (étapes, second facteur, blocage, classement des échecs,
 * fournisseurs, passkey) vivent ici ; les liaisons de vue ne prouvent que la
 * traduction de l'état. Le serveur est un `fetch` simulé : chaque route rend la
 * réponse que le framework rend réellement (`SessionAuthController`,
 * `WebAuthnController`, `OAuth2Controller`).
 */
import { describe, it, expect } from "vitest";
import {
  NodefonyLogin,
  observeLogin,
  type NodefonyLoginState,
  type NodefonyPasskeyAgent,
} from "../client/auth/NodefonyLogin";
import {
  AUTH_LOGIN_PATH,
  AUTH_LOGIN_TOTP_PATH,
  AUTH_LOGOUT_PATH,
  AUTH_ME_PATH,
  OAUTH2_PROVIDERS_PATH,
  WEBAUTHN_LOGIN_OPTIONS_PATH,
  WEBAUTHN_LOGIN_VERIFY_PATH,
} from "../runtime/authRoutes";

interface Reponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}
type Route = (corps: unknown) => Reponse | "coupure";

const ADMIN = { id: 1, username: "admin", roles: ["ROLE_ADMIN"] };

/** Serveur simulé : une table `MÉTHODE chemin → réponse`, et le journal des appels. */
function serveur(routes: Record<string, Route>) {
  const appels: {
    cle: string;
    url: string;
    corps: unknown;
    init: RequestInit;
  }[] = [];
  const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    // La table se lit par CHEMIN : l'origine (`baseUrl`) se vérifie à part, sur `url`.
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const cle = `${init.method ?? "GET"} ${new URL(url, "http://meme-origine").pathname}`;
    const corps =
      typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : null;
    appels.push({ cle, url, corps, init });
    const route = routes[cle];
    const r = route
      ? route(corps)
      : { status: 404, body: { error: "Not Found" } };
    if (r === "coupure") throw new TypeError("Failed to fetch");
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
      status: r.status,
      headers: { "content-type": "application/json", ...r.headers },
    });
  }) as typeof globalThis.fetch;
  return { fetch, appels };
}

/** Horloge pilotée par le test. */
function horloge(depart = 1_000_000) {
  let t = depart;
  return { now: () => t, avance: (ms: number) => (t += ms) };
}

const motDePasse =
  (attendu: string): Route =>
  (corps) =>
    (corps as { password?: string }).password === attendu
      ? { status: 200, body: { user: ADMIN } }
      : { status: 401, body: { error: "Invalid credentials" } };

describe("NodefonyLogin — étapes", () => {
  it("part de `identifier`, passe à `password`, puis `authenticated` sur un mot de passe bon", async () => {
    const srv = serveur({ [`POST ${AUTH_LOGIN_PATH}`]: motDePasse("secret") });
    const flow = new NodefonyLogin({ fetch: srv.fetch, passkey: null });
    expect(flow.getState().step).toBe("identifier");

    flow.submitIdentifier("  admin ");
    expect(flow.getState()).toMatchObject({
      step: "password",
      identifier: "admin",
    });

    const fin = await flow.submitPassword("secret");
    expect(fin).toMatchObject({
      step: "authenticated",
      pending: false,
      error: null,
    });
    expect(fin.user?.username).toBe("admin");
    expect(srv.appels[0]!.corps).toEqual({
      username: "admin",
      password: "secret",
    });
    // La session est un cookie HttpOnly : le navigateur doit le joindre.
    expect(srv.appels[0]!.init.credentials).toBe("same-origin");
  });

  it("un identifiant vide ne fait pas avancer, et aucune requête ne part", async () => {
    const srv = serveur({});
    const flow = new NodefonyLogin({ fetch: srv.fetch, passkey: null });
    flow.submitIdentifier("   ");
    await flow.submitPassword("x");
    expect(flow.getState().step).toBe("identifier");
    expect(srv.appels).toHaveLength(0);
  });

  it("un compte prérempli démarre à `password`", () => {
    const flow = new NodefonyLogin({ identifier: "admin", passkey: null });
    expect(flow.getState()).toMatchObject({
      step: "password",
      identifier: "admin",
    });
  });

  it("`login()` fait compte et mot de passe d'un coup, et déballe l'enveloppe `{ result }`", async () => {
    const srv = serveur({
      [`POST ${AUTH_LOGIN_PATH}`]: () => ({
        status: 200,
        body: { result: { user: ADMIN } },
      }),
    });
    const flow = new NodefonyLogin({ fetch: srv.fetch, passkey: null });
    expect((await flow.login("admin", "secret")).step).toBe("authenticated");
  });

  it("`back()` revient à l'identifiant en gardant le compte saisi", () => {
    const flow = new NodefonyLogin({ identifier: "admin", passkey: null });
    flow.back();
    expect(flow.getState()).toMatchObject({
      step: "identifier",
      identifier: "admin",
    });
  });
});

describe("NodefonyLogin — second facteur", () => {
  const avecTotp = (codeBon: string) =>
    serveur({
      [`POST ${AUTH_LOGIN_PATH}`]: () => ({
        status: 202,
        body: { mfaRequired: true, methods: ["totp"] },
      }),
      [`POST ${AUTH_LOGIN_TOTP_PATH}`]: (corps) =>
        (corps as { code?: string }).code === codeBon
          ? { status: 200, body: { user: ADMIN } }
          : { status: 401, body: { error: "Invalid credentials" } },
    });

  it("un 202 `mfaRequired` mène à `mfa`, SANS identité, puis un code bon ouvre la session", async () => {
    const srv = avecTotp("123456");
    const flow = new NodefonyLogin({ fetch: srv.fetch, passkey: null });
    const mfa = await flow.login("admin", "secret");
    expect(mfa).toMatchObject({
      step: "mfa",
      user: null,
      mfaMethods: ["totp"],
    });

    const fin = await flow.submitMfaCode("123 456");
    expect(fin.step).toBe("authenticated");
    // Les espaces d'un code recopié ne doivent pas le faire refuser.
    expect(srv.appels.at(-1)!.corps).toEqual({ code: "123456" });
  });

  // Le 202 est un DÉFI à liste OUVERTE : le client ne garde que ce qu'il sait
  // conduire, et ne montre jamais un écran de code qui ne peut pas aboutir.
  const defi = (corps: Record<string, unknown>) =>
    serveur({
      [`POST ${AUTH_LOGIN_PATH}`]: () => ({ status: 202, body: corps }),
    });

  it("une méthode inconnue mêlée à `totp` est ignorée", async () => {
    const srv = defi({ mfaRequired: true, methods: ["sms", "totp", 7] });
    const flow = new NodefonyLogin({ fetch: srv.fetch, passkey: null });
    expect(await flow.login("admin", "secret")).toMatchObject({
      step: "mfa",
      mfaMethods: ["totp"],
      error: null,
    });
  });

  for (const [titre, corps] of [
    [
      "seulement des méthodes inconnues",
      { mfaRequired: true, methods: ["sms"] },
    ],
    ["une liste vide", { mfaRequired: true, methods: [] }],
    ["sans liste", { mfaRequired: true }],
  ] as const) {
    it(`un défi avec ${titre} → erreur \`server\`, on reste au mot de passe`, async () => {
      const srv = defi(corps);
      const flow = new NodefonyLogin({ fetch: srv.fetch, passkey: null });
      const etat = await flow.login("admin", "secret");
      expect(etat).toMatchObject({
        step: "password",
        user: null,
        mfaMethods: [],
        pending: false,
        error: { kind: "server", status: 202 },
      });
    });
  }

  it("un code faux reste à `mfa`, avec le refus uniforme du serveur", async () => {
    const flow = new NodefonyLogin({
      fetch: avecTotp("123456").fetch,
      passkey: null,
    });
    await flow.login("admin", "secret");
    const refus = await flow.submitMfaCode("000000");
    expect(refus).toMatchObject({
      step: "mfa",
      user: null,
      error: {
        kind: "credentials",
        status: 401,
        message: "Invalid credentials",
      },
    });
  });

  it("un code envoyé hors de l'étape `mfa` est ignoré", async () => {
    const srv = avecTotp("123456");
    const flow = new NodefonyLogin({ fetch: srv.fetch, passkey: null });
    await flow.submitMfaCode("123456");
    expect(srv.appels).toHaveLength(0);
  });
});

describe("NodefonyLogin — échecs classés", () => {
  it("401 : `credentials`, message du serveur relayé TEL QUEL", async () => {
    const srv = serveur({ [`POST ${AUTH_LOGIN_PATH}`]: motDePasse("secret") });
    const flow = new NodefonyLogin({ fetch: srv.fetch, passkey: null });
    const s = await flow.login("admin", "faux");
    expect(s).toMatchObject({
      step: "password",
      pending: false,
      error: {
        kind: "credentials",
        status: 401,
        message: "Invalid credentials",
        retryAt: null,
      },
    });
  });

  it("429 avec `Retry-After` dans l'EN-TÊTE : `throttled`, échéance = maintenant + délai", async () => {
    const h = horloge();
    const srv = serveur({
      [`POST ${AUTH_LOGIN_PATH}`]: () => ({
        status: 429,
        body: { error: "Too many attempts" },
        headers: { "retry-after": "12" },
      }),
    });
    const flow = new NodefonyLogin({
      fetch: srv.fetch,
      now: h.now,
      passkey: null,
    });
    const s = await flow.login("admin", "x");
    expect(s.error).toEqual({
      kind: "throttled",
      status: 429,
      message: "Too many attempts",
      retryAt: h.now() + 12_000,
    });
  });

  it("429 avec le délai dans le CORPS — à la racine, puis sous `error`", async () => {
    const h = horloge();
    for (const body of [
      { retryAfter: 7 },
      { error: { message: "Too many attempts", retryAfter: 7 } },
    ]) {
      const srv = serveur({
        [`POST ${AUTH_LOGIN_PATH}`]: () => ({ status: 429, body }),
      });
      const flow = new NodefonyLogin({
        fetch: srv.fetch,
        now: h.now,
        passkey: null,
      });
      expect((await flow.login("admin", "x")).error?.retryAt).toBe(
        h.now() + 7_000,
      );
    }
  });

  it("429 sans délai : l'attente par défaut s'applique", async () => {
    const h = horloge();
    const srv = serveur({
      [`POST ${AUTH_LOGIN_PATH}`]: () => ({ status: 429, body: {} }),
    });
    const flow = new NodefonyLogin({
      fetch: srv.fetch,
      now: h.now,
      passkey: null,
      defaultRetryAfterS: 30,
    });
    expect((await flow.login("admin", "x")).error?.retryAt).toBe(
      h.now() + 30_000,
    );
  });

  it("bloqué : aucune requête ne part avant l'échéance, et la suivante repart après", async () => {
    const h = horloge();
    let premier = true;
    const srv = serveur({
      [`POST ${AUTH_LOGIN_PATH}`]: () => {
        if (premier) {
          premier = false;
          return { status: 429, body: {}, headers: { "retry-after": "5" } };
        }
        return { status: 200, body: { user: ADMIN } };
      },
    });
    const flow = new NodefonyLogin({
      fetch: srv.fetch,
      now: h.now,
      passkey: null,
    });
    await flow.login("admin", "x");
    await flow.submitPassword("secret");
    expect(srv.appels).toHaveLength(1);
    expect(flow.getState().error?.kind).toBe("throttled");

    h.avance(5_000);
    expect((await flow.submitPassword("secret")).step).toBe("authenticated");
    expect(srv.appels).toHaveLength(2);
  });

  it("réseau coupé : `network`, statut nul, l'étape ne bouge pas", async () => {
    const srv = serveur({ [`POST ${AUTH_LOGIN_PATH}`]: () => "coupure" });
    const flow = new NodefonyLogin({ fetch: srv.fetch, passkey: null });
    const s = await flow.login("admin", "x");
    expect(s).toMatchObject({
      step: "password",
      pending: false,
      error: { kind: "network", status: null },
    });
  });

  it("5xx : `server`, distinct d'un refus d'identifiants", async () => {
    const srv = serveur({
      [`POST ${AUTH_LOGIN_PATH}`]: () => ({
        status: 503,
        body: { error: "Session unavailable" },
      }),
    });
    const flow = new NodefonyLogin({ fetch: srv.fetch, passkey: null });
    expect((await flow.login("admin", "x")).error).toMatchObject({
      kind: "server",
      status: 503,
    });
  });

  it("200 avec une identité incomplète (sans rôles) : `server`, aucune session supposée", async () => {
    const srv = serveur({
      [`POST ${AUTH_LOGIN_PATH}`]: () => ({
        status: 200,
        body: { user: { id: 1, username: "admin" } },
      }),
    });
    const flow = new NodefonyLogin({ fetch: srv.fetch, passkey: null });
    const s = await flow.login("admin", "secret");
    expect(s).toMatchObject({
      step: "password",
      user: null,
      error: { kind: "server", status: 200 },
    });
  });

  it("une action en vol refuse la suivante (double clic)", async () => {
    const srv = serveur({ [`POST ${AUTH_LOGIN_PATH}`]: motDePasse("secret") });
    const flow = new NodefonyLogin({ fetch: srv.fetch, passkey: null });
    flow.submitIdentifier("admin");
    const a = flow.submitPassword("secret");
    expect(flow.getState().pending).toBe(true);
    await flow.submitPassword("secret");
    await a;
    expect(srv.appels).toHaveLength(1);
  });
});

describe("NodefonyLogin — passkey", () => {
  const routes = (verifie: Route): Record<string, Route> => ({
    [`POST ${WEBAUTHN_LOGIN_OPTIONS_PATH}`]: () => ({
      status: 200,
      body: { challenge: "defi", rpId: "localhost" },
    }),
    [`POST ${WEBAUTHN_LOGIN_VERIFY_PATH}`]: verifie,
  });

  it("signe le défi du serveur et renvoie l'assertion : session ouverte", async () => {
    const signes: unknown[] = [];
    const agent: NodefonyPasskeyAgent = {
      sign: (o) => {
        signes.push(o);
        return Promise.resolve({ id: "cle", type: "public-key" });
      },
    };
    const srv = serveur(
      routes(() => ({ status: 200, body: { verified: true, user: ADMIN } })),
    );
    const flow = new NodefonyLogin({ fetch: srv.fetch, passkey: agent });
    expect(flow.getState().passkeyAvailable).toBe(true);
    expect((await flow.loginWithPasskey()).step).toBe("authenticated");
    expect(signes).toEqual([{ challenge: "defi", rpId: "localhost" }]);
    expect(srv.appels[1]!.corps).toEqual({
      response: { id: "cle", type: "public-key" },
    });
  });

  it("invite refermée : `cancelled`, et la vérification n'est jamais appelée", async () => {
    const agent: NodefonyPasskeyAgent = {
      sign: () => Promise.reject(new DOMException("annulé", "NotAllowedError")),
    };
    const srv = serveur(routes(() => ({ status: 200, body: { user: ADMIN } })));
    const flow = new NodefonyLogin({ fetch: srv.fetch, passkey: agent });
    expect((await flow.loginWithPasskey()).error?.kind).toBe("cancelled");
    expect(srv.appels).toHaveLength(1);
  });

  it("navigateur sans WebAuthn JSON : `passkeyAvailable` faux, `unsupported` sans requête", async () => {
    const srv = serveur({});
    // Défaut = l'API native, CONSTATÉE : Node n'a pas `PublicKeyCredential`.
    const flow = new NodefonyLogin({ fetch: srv.fetch });
    expect(flow.getState().passkeyAvailable).toBe(false);
    expect((await flow.loginWithPasskey()).error?.kind).toBe("unsupported");
    expect(srv.appels).toHaveLength(0);
  });
});

describe("NodefonyLogin — fournisseurs, session, abonnement", () => {
  it("charge les fournisseurs UNE fois, et part en navigation pleine page, nom encodé", async () => {
    const srv = serveur({
      [`GET ${OAUTH2_PROVIDERS_PATH}`]: () => ({
        status: 200,
        body: {
          providers: [{ name: "keycloak", label: "Keycloak" }, { name: "x y" }],
        },
      }),
    });
    const vers: string[] = [];
    const flow = new NodefonyLogin({
      fetch: srv.fetch,
      navigate: (u) => vers.push(u),
      passkey: null,
      baseUrl: "https://app.test",
    });
    expect(flow.getState().providers).toBeNull();
    await Promise.all([flow.loadProviders(), flow.loadProviders()]);
    expect(srv.appels.map((a) => a.url)).toEqual([
      `https://app.test${OAUTH2_PROVIDERS_PATH}`,
    ]);
    expect(flow.getState().providers).toEqual([
      { name: "keycloak", label: "Keycloak" },
      { name: "x y", label: "x y" },
    ]);

    flow.startProvider("x y");
    expect(vers).toEqual([
      "https://app.test/nodefony/security/api/oauth2/x%20y/authorize",
    ]);
  });

  it("`me()` reprend une session ouverte, et rend `null` sans session", async () => {
    const ouverte = new NodefonyLogin({
      fetch: serveur({
        [`GET ${AUTH_ME_PATH}`]: () => ({ status: 200, body: { user: ADMIN } }),
      }).fetch,
      passkey: null,
    });
    expect((await ouverte.me())?.username).toBe("admin");
    expect(ouverte.getState().step).toBe("authenticated");

    const fermee = new NodefonyLogin({
      fetch: serveur({
        [`GET ${AUTH_ME_PATH}`]: () => ({ status: 401, body: {} }),
      }).fetch,
      passkey: null,
    });
    expect(await fermee.me()).toBeNull();
    expect(fermee.getState()).toMatchObject({
      step: "identifier",
      error: null,
    });
  });

  it("`logout()` rend l'adresse du fournisseur et revient à l'identifiant", async () => {
    const srv = serveur({
      [`GET ${AUTH_ME_PATH}`]: () => ({ status: 200, body: { user: ADMIN } }),
      [`POST ${AUTH_LOGOUT_PATH}`]: () => ({
        status: 200,
        body: { ok: true, logoutUrl: "https://idp.test/logout" },
      }),
    });
    const flow = new NodefonyLogin({ fetch: srv.fetch, passkey: null });
    await flow.me();
    expect(await flow.logout()).toBe("https://idp.test/logout");
    expect(flow.getState()).toMatchObject({ step: "identifier", user: null });
  });

  it("`observeLogin` rend l'état tout de suite, suit chaque changement, et se libère", async () => {
    const srv = serveur({ [`POST ${AUTH_LOGIN_PATH}`]: motDePasse("secret") });
    const flow = new NodefonyLogin({ fetch: srv.fetch, passkey: null });
    const vus: NodefonyLoginState[] = [];
    const stop = observeLogin(flow, (s) => vus.push(s));
    expect(vus).toHaveLength(1);
    await flow.login("admin", "secret");
    expect(vus.map((s) => s.step)).toEqual([
      "identifier",
      "password",
      "password",
      "authenticated",
    ]);
    expect(vus[2]!.pending).toBe(true);
    stop();
    flow.back();
    expect(vus).toHaveLength(4);
  });
});
