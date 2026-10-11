/// <reference types="node" />
/**
 * Unit — `AuthStore` sur le déroulé partagé `NodefonyLogin` (#549).
 *
 * Studio ne porte plus de copie du déroulé : le store POSSÈDE un
 * `NodefonyLogin` et OBSERVE son état. Ces tests verrouillent ce que Studio y
 * ajoute, sans navigateur ni serveur (fetch simulé) :
 *  - une session ouverte devient l'identité Studio (`user`, `status`) et la
 *    mémoire du dernier compte et de sa méthode ;
 *  - `mfaPending` se DÉRIVE de l'étape `mfa` du déroulé ;
 *  - le blocage (429) est celui du déroulé, qui refuse lui-même de rejouer ;
 *  - l'étape du formulaire reste celle d'avant pendant la fin de connexion ;
 *  - déconnexion et 401 inattendu ramènent au « rebonjour » du dernier compte.
 */
import { describe, it, beforeEach, afterEach, vi } from "vitest";
import { expect } from "vitest";
import { NodefonyLogin } from "nodefony/client";
import {
  AuthStore,
  LAST_METHOD_KEY,
  LAST_USER_KEY,
  PENDING_METHOD_KEY,
} from "../../../frontend/src/stores/AuthStore";
import type { AuthService } from "../../../frontend/src/services/AuthService";

type Reply = {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
};

/** Serveur simulé : une réponse par « MÉTHODE chemin », et le journal des appels. */
function fakeServer(routes: Record<string, Reply | Reply[]>) {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    // Le déroulé appelle `fetch` avec une chaîne (`${base}${chemin}`).
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const key = `${init?.method ?? "GET"} ${url}`;
    calls.push(key);
    const entry = routes[key];
    const reply = Array.isArray(entry) ? entry.shift() : entry;
    if (reply === undefined) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(reply.body ?? {}), {
      status: reply.status,
      headers: { "content-type": "application/json", ...reply.headers },
    });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const ADMIN = {
  id: 1,
  identifier: "admin",
  roles: ["ROLE_ADMIN"],
  currentRole: "ROLE_ADMIN",
};
const LOGIN = "POST /nodefony/security/api/auth/login";
const TOTP = "POST /nodefony/security/api/auth/login/totp";
const ME = "GET /nodefony/security/api/auth/me";
const LOGOUT = "POST /nodefony/security/api/auth/logout";

let storage: Map<string, string>;

/** Store sur un déroulé branché au serveur simulé ; l'horloge est figée. */
function makeStore(routes: Record<string, Reply | Reply[]>, now = 1_000_000) {
  const server = fakeServer(routes);
  const flow = new NodefonyLogin({
    identifier: storage.get(LAST_USER_KEY) ?? "",
    fetch: server.fetchImpl,
    passkey: null,
    now: () => now,
  });
  const store = new AuthStore({} as AuthService, flow);
  return { store, flow, calls: server.calls };
}

describe("AuthStore — déroulé partagé NodefonyLogin (#549)", () => {
  beforeEach(() => {
    storage = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("une session ouverte par mot de passe devient l'identité Studio, mémorisée", async () => {
    const { store } = makeStore({
      [LOGIN]: { status: 200, body: { user: ADMIN } },
    });
    store.submitIdentifier(" admin ");
    expect(store.formStep).to.equal("password");
    const state = await store.submitPassword("secret");
    expect(state.step).to.equal("authenticated");
    expect(store.status).to.equal("authenticated");
    expect(store.user).to.deep.equal(ADMIN);
    expect(storage.get(LAST_USER_KEY)).to.equal("admin");
    expect(storage.get(LAST_METHOD_KEY)).to.equal("password");
    // Le formulaire ne saute pas pendant la fin de connexion.
    expect(store.formStep).to.equal("password");
  });

  it("le second facteur : mfaPending dérivé de l'étape mfa, puis session ouverte", async () => {
    const { store } = makeStore({
      [LOGIN]: { status: 202, body: { mfaRequired: true, methods: ["totp"] } },
      [TOTP]: { status: 200, body: { user: ADMIN } },
    });
    store.submitIdentifier("admin");
    await store.submitPassword("secret");
    expect(store.mfaPending).to.equal(true);
    expect(store.formStep).to.equal("mfa");
    expect(store.status).to.not.equal("authenticated");
    await store.completeMfa("123 456");
    expect(store.mfaPending).to.equal(false);
    expect(store.status).to.equal("authenticated");
    expect(storage.get(LAST_METHOD_KEY)).to.equal("password");
  });

  it("abandonner le second facteur ramène au mot de passe du compte saisi", async () => {
    const { store } = makeStore({
      [LOGIN]: { status: 202, body: { mfaRequired: true, methods: ["totp"] } },
    });
    store.submitIdentifier("alice");
    await store.submitPassword("secret");
    store.cancelMfa();
    expect(store.formStep).to.equal("password");
    expect(store.flowState.identifier).to.equal("alice");
  });

  it("le blocage 429 est celui du déroulé : échéance posée, aucune requête rejouée", async () => {
    const { store, calls } = makeStore(
      { [LOGIN]: { status: 429, body: {}, headers: { "retry-after": "12" } } },
      5_000,
    );
    store.submitIdentifier("admin");
    await store.submitPassword("x");
    expect(store.flowState.error?.kind).to.equal("throttled");
    expect(store.flowState.error?.retryAt).to.equal(5_000 + 12_000);
    await store.submitPassword("y");
    expect(calls.filter((c) => c === LOGIN)).to.have.length(1);
    expect(store.status).to.not.equal("authenticated");
  });

  it("un refus reste un échec classé, sans identité ni mémoire de méthode", async () => {
    const { store } = makeStore({
      [LOGIN]: {
        status: 401,
        body: { error: { message: "Identifiants invalides" } },
      },
    });
    store.submitIdentifier("admin");
    await store.submitPassword("faux");
    expect(store.flowState.error?.kind).to.equal("credentials");
    expect(store.user).to.equal(null);
    expect(storage.has(LAST_METHOD_KEY)).to.equal(false);
  });

  it("la reprise de session promeut la méthode du fournisseur posée avant la redirection", async () => {
    storage.set(PENDING_METHOD_KEY, "keycloak");
    const { store } = makeStore({
      [ME]: { status: 200, body: { user: ADMIN } },
    });
    await store.checkSession();
    expect(store.status).to.equal("authenticated");
    expect(storage.get(LAST_METHOD_KEY)).to.equal("keycloak");
    expect(storage.has(PENDING_METHOD_KEY)).to.equal(false);
  });

  it("deux reprises simultanées (StrictMode) ne font qu'UN aller-retour", async () => {
    const { store, calls } = makeStore({
      [ME]: { status: 200, body: { user: null } },
    });
    await Promise.all([store.checkSession(), store.checkSession()]);
    expect(calls.filter((c) => c === ME)).to.have.length(1);
    expect(store.status).to.equal("unauthenticated");
    // Une fois réglée, une reprise suivante interroge de nouveau le serveur.
    await store.checkSession();
    expect(calls.filter((c) => c === ME)).to.have.length(2);
  });

  it("sans session, la reprise rend « non connecté » — pas une erreur", async () => {
    const { store } = makeStore({
      [ME]: { status: 200, body: { user: null } },
    });
    await store.checkSession();
    expect(store.status).to.equal("unauthenticated");
    expect(store.user).to.equal(null);
  });

  it("la déconnexion ramène au « rebonjour » du dernier compte", async () => {
    const { store, calls } = makeStore({
      [LOGIN]: { status: 200, body: { user: ADMIN } },
      [LOGOUT]: { status: 200, body: { ok: true } },
    });
    store.submitIdentifier("admin");
    await store.submitPassword("secret");
    await store.logout();
    expect(calls).to.include(LOGOUT);
    expect(store.status).to.equal("unauthenticated");
    expect(store.formStep).to.equal("password");
    expect(store.flowState.identifier).to.equal("admin");
  });

  it("un 401 inattendu nettoie l'état local SANS appeler la déconnexion", async () => {
    const { store, calls } = makeStore({
      [LOGIN]: { status: 200, body: { user: ADMIN } },
    });
    store.submitIdentifier("admin");
    await store.submitPassword("secret");
    store.clearLocalSession();
    expect(calls).to.not.include(LOGOUT);
    expect(store.status).to.equal("unauthenticated");
    expect(store.formStep).to.equal("password");
  });
});
