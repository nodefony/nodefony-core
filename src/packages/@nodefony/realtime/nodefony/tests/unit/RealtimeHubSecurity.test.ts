import { describe, it, expect } from "vitest";
import { JsonRpcPeer } from "nodefony";
import { RealtimeHub } from "../../src/server/RealtimeHub.js";
import { ANONYMOUS_REALTIME_TOKEN } from "../../src/server/AnonymousRealtimeToken.js";
import type { IRealtimeAuthenticator } from "../../interfaces/IRealtimeAuthenticator.js";
import type { IRealtimeHandshake } from "../../interfaces/IRealtimeHandshake.js";
import type { IRealtimeToken } from "../../interfaces/IRealtimeToken.js";

/**
 * Tests des seams sécurité P13 Bloc A étape 6 (P13 → P6) :
 *  - Seam #2 — `IRealtimeAuthenticator` enregistrement + résolution
 *  - Seam #3 — Matchers (pattern URL + vhost) ordonnés
 *  - Seam #4 — Origin check (RFC 6455 §10.2)
 *  - Mapping `peer → token` (WeakMap interne) + fallback Zero Trust
 */

function makeHandshake(
  over: Partial<IRealtimeHandshake> = {},
): IRealtimeHandshake {
  return {
    headers: {},
    cookies: new Map<string, string>(),
    url: "/",
    remoteAddress: "127.0.0.1",
    origin: undefined,
    protocols: [],
    ...over,
  };
}

function makeAuthenticator(
  name: string,
  token: IRealtimeToken = ANONYMOUS_REALTIME_TOKEN,
): IRealtimeAuthenticator {
  return {
    name,
    supports: () => true,
    authenticate: async () => token,
  };
}

describe("RealtimeHub — Seam #4 Origin check (RFC 6455 §10.2)", () => {
  it("aucune politique posée → toute origin acceptée (rétrocompat)", () => {
    const hub = new RealtimeHub();
    expect(hub.checkOrigin("https://app.example.com")).to.equal(true);
    expect(hub.checkOrigin(undefined)).to.equal(true);
  });

  it("guard custom : applique la politique", () => {
    const hub = new RealtimeHub();
    hub.setOriginGuard((origin) => origin === "https://app.example.com");
    expect(hub.checkOrigin("https://app.example.com")).to.equal(true);
    expect(hub.checkOrigin("https://evil.com")).to.equal(false);
    expect(hub.checkOrigin(undefined)).to.equal(false);
  });

  it("setOriginGuard(null) → désactive le check (rétrocompat)", () => {
    const hub = new RealtimeHub();
    hub.setOriginGuard(() => false);
    expect(hub.checkOrigin("https://app.example.com")).to.equal(false);
    hub.setOriginGuard(null);
    expect(hub.checkOrigin("https://anywhere.com")).to.equal(true);
  });

  it("clear() retire la politique", () => {
    const hub = new RealtimeHub();
    hub.setOriginGuard(() => false);
    hub.clear();
    expect(hub.checkOrigin("https://anywhere.com")).to.equal(true);
  });
});

describe("RealtimeHub — Seam #2/#3 Authenticators et matchers", () => {
  it("aucun authenticator enregistré → resolveAuthenticator renvoie null", () => {
    const hub = new RealtimeHub();
    expect(
      hub.resolveAuthenticator(makeHandshake({ url: "/admin/x" })),
    ).to.equal(null);
    expect(hub.registeredAuthenticators).to.deep.equal([]);
  });

  it("matcher string : compilé en RegExp préfixe ancré (`^<escaped>`)", () => {
    const hub = new RealtimeHub();
    const auth = makeAuthenticator("jwt");
    hub.useAuthenticator({ pattern: "/admin/" }, auth);
    expect(
      hub.resolveAuthenticator(makeHandshake({ url: "/admin/users" })),
    ).to.equal(auth);
    expect(
      hub.resolveAuthenticator(makeHandshake({ url: "/admin/" })),
    ).to.equal(auth);
    expect(
      hub.resolveAuthenticator(makeHandshake({ url: "/public/foo" })),
    ).to.equal(null);
  });

  it("matcher RegExp : utilisée telle quelle", () => {
    const hub = new RealtimeHub();
    const auth = makeAuthenticator("jwt");
    hub.useAuthenticator({ pattern: /^\/(admin|api)\// }, auth);
    expect(
      hub.resolveAuthenticator(makeHandshake({ url: "/admin/x" })),
    ).to.equal(auth);
    expect(
      hub.resolveAuthenticator(makeHandshake({ url: "/api/v1/x" })),
    ).to.equal(auth);
    expect(
      hub.resolveAuthenticator(makeHandshake({ url: "/public/x" })),
    ).to.equal(null);
  });

  it("ordre d'enregistrement préservé : 1ʳᵉ matcher qui matche gagne", () => {
    const hub = new RealtimeHub();
    const jwtAuth = makeAuthenticator("jwt");
    const anonAuth = makeAuthenticator("anon");
    hub.useAuthenticator({ pattern: "/admin/" }, jwtAuth); // spécifique d'abord
    hub.useAuthenticator({ pattern: "/" }, anonAuth); // fallback ensuite
    expect(
      hub.resolveAuthenticator(makeHandshake({ url: "/admin/x" })),
    ).to.equal(jwtAuth);
    expect(hub.resolveAuthenticator(makeHandshake({ url: "/chat" }))).to.equal(
      anonAuth,
    );
  });

  it("matcher avec host : match strict (insensible à la casse) sur l'en-tête Host", () => {
    const hub = new RealtimeHub();
    const auth = makeAuthenticator("jwt");
    hub.useAuthenticator(
      { pattern: "/admin/", host: "admin.example.com" },
      auth,
    );
    expect(
      hub.resolveAuthenticator(
        makeHandshake({
          url: "/admin/x",
          headers: { host: "admin.example.com" },
        }),
      ),
    ).to.equal(auth);
    // Insensibilité à la casse
    expect(
      hub.resolveAuthenticator(
        makeHandshake({
          url: "/admin/x",
          headers: { host: "ADMIN.EXAMPLE.COM" },
        }),
      ),
    ).to.equal(auth);
    // Mauvais host → pas de match
    expect(
      hub.resolveAuthenticator(
        makeHandshake({
          url: "/admin/x",
          headers: { host: "app.example.com" },
        }),
      ),
    ).to.equal(null);
    // En-tête Host ABSENT (matcher host défini) → `(got ?? "")` → pas de match
    expect(
      hub.resolveAuthenticator(makeHandshake({ url: "/admin/x", headers: {} })),
    ).to.equal(null);
    // En-tête Host en ARRAY (multi-valeurs) → 1ʳᵉ valeur prise (RFC 7230)
    expect(
      hub.resolveAuthenticator(
        makeHandshake({
          url: "/admin/x",
          headers: { host: ["admin.example.com", "spoof.com"] },
        }),
      ),
    ).to.equal(auth);
  });

  it("query string ignorée pour le match du pattern", () => {
    const hub = new RealtimeHub();
    const auth = makeAuthenticator("jwt");
    hub.useAuthenticator({ pattern: /^\/admin\/$/ }, auth);
    expect(
      hub.resolveAuthenticator(makeHandshake({ url: "/admin/?token=abc" })),
    ).to.equal(auth);
  });

  it("idempotence : useAuthenticator avec même instance ne duplique pas", () => {
    const hub = new RealtimeHub();
    const auth = makeAuthenticator("jwt");
    hub.useAuthenticator({ pattern: "/admin/" }, auth);
    hub.useAuthenticator({ pattern: "/admin/" }, auth); // 2e appel = no-op
    hub.useAuthenticator({ pattern: "/other/" }, auth); // même auth, autre matcher = no-op
    expect(hub.registeredAuthenticators).to.have.length(1);
  });

  it("clear() vide les authenticators", () => {
    const hub = new RealtimeHub();
    hub.useAuthenticator({ pattern: "/admin/" }, makeAuthenticator("jwt"));
    hub.clear();
    expect(hub.registeredAuthenticators).to.deep.equal([]);
    expect(
      hub.resolveAuthenticator(makeHandshake({ url: "/admin/" })),
    ).to.equal(null);
  });
});

describe("RealtimeHub — Mapping peer → token (slot #6 audit lookup)", () => {
  it("getTokenForPeer sur peer inconnu → ANONYMOUS_REALTIME_TOKEN (Zero Trust)", () => {
    const hub = new RealtimeHub();
    const peer = new JsonRpcPeer({ send: () => {} });
    const token = hub.getTokenForPeer(peer);
    expect(token).to.equal(ANONYMOUS_REALTIME_TOKEN);
    expect(token.isAuthenticated()).to.equal(false);
    expect(token.type).to.equal("anonymous");
  });

  it("setTokenForPeer puis getTokenForPeer → renvoie le token posé", () => {
    const hub = new RealtimeHub();
    const peer = new JsonRpcPeer({ send: () => {} });
    const customToken: IRealtimeToken = {
      type: "jwt",
      getUserIdentifier: () => "user-42",
      isAuthenticated: () => true,
      getRoles: () => ["ROLE_USER"],
      getScopes: () => [],
      getAttribute: () => undefined,
    };
    hub.setTokenForPeer(peer, customToken);
    expect(hub.getTokenForPeer(peer)).to.equal(customToken);
    expect(hub.getTokenForPeer(peer).getUserIdentifier()).to.equal("user-42");
  });

  it("clear() retire le mapping → fallback Anonymous", () => {
    const hub = new RealtimeHub();
    const peer = new JsonRpcPeer({ send: () => {} });
    hub.setTokenForPeer(peer, {
      type: "jwt",
      getUserIdentifier: () => "user-42",
      isAuthenticated: () => true,
      getRoles: () => [],
      getScopes: () => [],
      getAttribute: () => undefined,
    });
    hub.clear();
    expect(hub.getTokenForPeer(peer)).to.equal(ANONYMOUS_REALTIME_TOKEN);
  });

  it("Anonymous token : surface minimale et gelée", () => {
    expect(Object.isFrozen(ANONYMOUS_REALTIME_TOKEN)).to.equal(true);
    expect(ANONYMOUS_REALTIME_TOKEN.getRoles()).to.deep.equal([
      "ROLE_ANONYMOUS",
    ]);
    expect(ANONYMOUS_REALTIME_TOKEN.getScopes()).to.deep.equal([]);
    expect(ANONYMOUS_REALTIME_TOKEN.getAttribute("any")).to.equal(undefined);
  });
});

describe("RealtimeHub — Seam #1 Verrou de frame (P6)", () => {
  const authToken: IRealtimeToken = {
    type: "session",
    getUserIdentifier: () => "user-7",
    isAuthenticated: () => true,
    getRoles: () => ["ROLE_USER"],
    getScopes: () => [],
    getAttribute: () => undefined,
  };

  it("hub neuf : pas de verrou → hasFrameAuthorizer false, runAuthorizer autorise", () => {
    const hub = new RealtimeHub();
    const peer = new JsonRpcPeer({ send: () => {} });
    expect(hub.hasFrameAuthorizer()).to.equal(false);
    // Bypass 0-coût : aucune politique → toute frame passe.
    expect(hub.runAuthorizer({ method: "api.request" }, peer)).to.equal(true);
  });

  it("runAuthorizer délègue à l'authorizer AVEC le token déjà caché du peer", () => {
    const hub = new RealtimeHub();
    const peer = new JsonRpcPeer({ send: () => {} });
    hub.setTokenForPeer(peer, authToken);
    let seen: IRealtimeToken | null = null;
    let seenFrame: unknown = null;
    hub.setFrameAuthorizer((frame, token) => {
      seen = token;
      seenFrame = frame;
      return token.isAuthenticated();
    });
    expect(hub.hasFrameAuthorizer()).to.equal(true);
    const frame = { method: "subscribe", params: { channel: "x" } };
    expect(hub.runAuthorizer(frame, peer)).to.equal(true);
    expect(seen).to.equal(authToken); // le verrou lit le cache, jamais la base
    expect(seenFrame).to.equal(frame);
  });

  it("runAuthorizer : peer sans token → ANONYMOUS passé à l'authorizer (Zero Trust)", () => {
    const hub = new RealtimeHub();
    const peer = new JsonRpcPeer({ send: () => {} });
    let authenticated = true;
    hub.setFrameAuthorizer((_frame, token) => {
      authenticated = token.isAuthenticated();
      return authenticated;
    });
    // Aucun setTokenForPeer → getTokenForPeer renvoie ANONYMOUS → refus.
    expect(hub.runAuthorizer({ method: "api.request" }, peer)).to.equal(false);
    expect(authenticated).to.equal(false);
  });

  it("setFrameAuthorizer(null) retire le verrou (retour au bypass)", () => {
    const hub = new RealtimeHub();
    const peer = new JsonRpcPeer({ send: () => {} });
    hub.setFrameAuthorizer(() => false);
    expect(hub.hasFrameAuthorizer()).to.equal(true);
    expect(hub.runAuthorizer({}, peer)).to.equal(false);
    hub.setFrameAuthorizer(null);
    expect(hub.hasFrameAuthorizer()).to.equal(false);
    expect(hub.runAuthorizer({}, peer)).to.equal(true);
  });

  it("clear() retire le verrou de frame", () => {
    const hub = new RealtimeHub();
    hub.setFrameAuthorizer(() => false);
    hub.clear();
    expect(hub.hasFrameAuthorizer()).to.equal(false);
    const peer = new JsonRpcPeer({ send: () => {} });
    expect(hub.runAuthorizer({}, peer)).to.equal(true);
  });
});

describe("RealtimeHub — Seam #1b Registre de politiques de canal (P6)", () => {
  it("hub neuf : resolveChannelPolicy → null (lazy, 0 alloc)", () => {
    const hub = new RealtimeHub();
    expect(hub.resolveChannelPolicy("admin:metrics")).to.equal(null);
  });

  it("registerChannelPolicy → resolveChannelPolicy renvoie la policy par nom", () => {
    const hub = new RealtimeHub();
    hub.registerChannelPolicy("admin:metrics", { roles: ["ROLE_ADMIN"] });
    hub.registerChannelPolicy("api:flux", { scopes: ["metrics:read"] });
    expect(hub.resolveChannelPolicy("admin:metrics")).to.deep.equal({
      roles: ["ROLE_ADMIN"],
    });
    expect(hub.resolveChannelPolicy("api:flux")).to.deep.equal({
      scopes: ["metrics:read"],
    });
    expect(hub.resolveChannelPolicy("unknown:chan")).to.equal(null);
  });

  it("idempotent : même nom = écrase (controllers d'un endpoint = même policy)", () => {
    const hub = new RealtimeHub();
    hub.registerChannelPolicy("x", { authenticated: true });
    hub.registerChannelPolicy("x", { roles: ["ROLE_ADMIN"] });
    expect(hub.resolveChannelPolicy("x")).to.deep.equal({
      roles: ["ROLE_ADMIN"],
    });
  });

  it("clear() vide le registre des politiques", () => {
    const hub = new RealtimeHub();
    hub.registerChannelPolicy("x", { roles: ["ROLE_ADMIN"] });
    hub.clear();
    expect(hub.resolveChannelPolicy("x")).to.equal(null);
  });
});

describe("RealtimeHub — Lazy alloc & bypass 0-coût", () => {
  it("hub neuf : aucune alloc seam (authenticators/peerTokens/originGuard = null)", () => {
    const hub = new RealtimeHub();
    // Pas d'API publique pour lire les champs privés — on vérifie indirectement :
    // - aucun match (resolveAuthenticator renvoie null)
    // - checkOrigin renvoie true partout (pas de guard)
    // - getTokenForPeer renvoie anonymous (pas de mapping)
    const peer = new JsonRpcPeer({ send: () => {} });
    expect(hub.resolveAuthenticator(makeHandshake())).to.equal(null);
    expect(hub.checkOrigin(undefined)).to.equal(true);
    expect(hub.getTokenForPeer(peer)).to.equal(ANONYMOUS_REALTIME_TOKEN);
  });

  it("registeredAuthenticators sur hub neuf : même instance frozen partagée (0 alloc)", () => {
    const a = new RealtimeHub();
    const b = new RealtimeHub();
    expect(a.registeredAuthenticators).to.equal(b.registeredAuthenticators);
  });
});
