import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { Container, Event, RequestContext } from "nodefony";
import type { Module } from "nodefony";
import type { IUser } from "@nodefony/user";
import type { ContextType } from "@nodefony/http";
import AuditService from "../../nodefony/service/auditService";
import { Firewall } from "../../nodefony/service/firewall";
import { TokenService } from "../../nodefony/service/tokenService";
import { ApiKeyService } from "../../nodefony/service/apiKeys";
import { SecuredArea } from "../../nodefony/src/SecuredArea";
import { AnonymousAuthenticator } from "../../nodefony/src/authenticator/AnonymousAuthenticator";
import { UserToken } from "../../nodefony/src/token/UserToken";
import { AuthenticationError } from "../../nodefony/errors/AuthenticationError";
import { ThrottledError } from "../../nodefony/errors/ThrottledError";
import {
  buildFrameAuthorizer,
  DEFAULT_SYSTEM_RULES,
  type IFrameAuthorizerFirewall,
  type FrameDenyReporter,
} from "../../nodefony/src/realtime/frameAuthorizer";
import type {
  IRealtimeToken,
  FrameAuthorizer,
} from "../../nodefony/src/realtime/realtimeContracts";
import type { IAuthenticator } from "../../nodefony/contracts/IAuthenticator";
import type { IToken } from "../../nodefony/contracts/IToken";
import type { ISecurityAreaConfig } from "../../nodefony/config/defineModuleConfig";

/**
 * Câblage des émetteurs d'audit du HOT-PATH (P6.14 — Lot 2b) : firewall
 * (`handleSecurity`), verrou de frame WS (`frameAuthorizer`), TokenService et
 * ApiKeyService journalisent RÉELLEMENT via le container partagé. Invariant
 * PERF central : le chemin de SUCCÈS reste MUET (0 émission) — seul l'échec/refus
 * (cold-path) émet. Banc séparé du Lot 2 (login/logout/authz) pour rester focalisé.
 */

// Mock kernel multi-onBoot (plusieurs services dans le MÊME container).
function makeKernel(container: Container): { boot: () => void } {
  const bootCbs: Array<() => void> = [];
  const kernel = {
    container,
    once(ev: string, cb: () => void) {
      if (ev === "onBoot") bootCbs.push(cb);
    },
    registerStoreResolution() {},
  };
  container.set("kernel", kernel);
  return { boot: () => bootCbs.forEach((cb) => cb()) };
}

function makeModule(
  container: Container,
  options: Record<string, unknown>,
): Module {
  return {
    container,
    notificationsCenter: new Event(),
    options,
  } as unknown as Module;
}

const fakeUser = (identifier: string): IUser => ({
  id: `u-${identifier}`,
  identifier,
  roles: ["ROLE_USER"],
  hasRole: () => true,
  isActive: () => true,
  isLocked: () => false,
});

// ════════════════════════════════════════════════════════════════════════════
// Firewall — handleSecurity (chaîne d'authenticators de zone)
// ════════════════════════════════════════════════════════════════════════════

/** Authenticator espion piloté (calque firewallChain.test). */
class SpyAuthenticator implements IAuthenticator {
  created = 0;
  constructor(
    readonly name: string,
    private readonly behavior: {
      supports: boolean;
      ok: boolean;
      user?: IUser;
      throttle?: boolean;
      promote?: boolean;
    },
  ) {}
  supports(): boolean {
    return this.behavior.supports;
  }
  createToken(): Promise<IToken> {
    this.created += 1;
    return Promise.resolve(new UserToken(this.name, { raw: "credential" }));
  }
  authenticate(token: IToken): Promise<IToken> {
    if (this.behavior.throttle) return Promise.reject(new ThrottledError(42));
    if (!this.behavior.ok) {
      return Promise.reject(new AuthenticationError("Invalid credentials"));
    }
    // promote=false : token non promu (reste anonyme-non-explicite → défense profondeur).
    if (this.behavior.promote === false) return Promise.resolve(token);
    return Promise.resolve(
      (token as UserToken).promote(this.behavior.user ?? fakeUser(this.name)),
    );
  }
  onSuccess(): Promise<void> {
    return Promise.resolve();
  }
  onFailure(): Promise<void> {
    return Promise.resolve();
  }
}

const zone = (authenticators: string[], mode: "first" | "all" = "first") =>
  new SecuredArea("nodefony-admin", {
    pattern: "^/secure",
    security: true,
    stateless: false,
    mode,
    authenticators,
  } as ISecurityAreaConfig);

// Contexte HTTP minimal PORTANT la provenance (ip/ua/requestId/cookie) lue par
// readAuditContext → on prouve que l'événement firewall est enrichi.
function makeContext(area: SecuredArea): ContextType {
  return {
    request: {
      headers: { "user-agent": "vitest-ua", cookie: "sid=opaque" },
      url: new URL("https://localhost/secure/x"),
    },
    security: area,
    remoteAddress: "203.0.113.9",
    requestId: "req-fw",
    getUserAgent: () => "vitest-ua",
    response: { setHeader: () => undefined },
  } as unknown as ContextType;
}

function setupFirewall(...auths: IAuthenticator[]): {
  audit: AuditService;
  firewall: Firewall;
} {
  const container = new Container();
  const { boot } = makeKernel(container);
  const audit = new AuditService(
    makeModule(container, { audit: { enabled: true } }),
  );
  container.set("auditService", audit);
  // Boot AVANT de créer le firewall : l'audit est actif, et le firewall créé
  // après n'exécute pas son #build (on pilote la chaîne manuellement).
  boot();
  const firewall = new Firewall(makeModule(container, {}));
  for (const a of auths) firewall.registerAuthenticator(a);
  return { audit, firewall };
}

describe("Firewall handleSecurity — émission audit (cold-path)", () => {
  it("auth.failure sur credential PRÉSENTÉ mais invalide + provenance enrichie", async () => {
    const { audit, firewall } = setupFirewall(
      new SpyAuthenticator("basic", { supports: true, ok: false }),
    );
    await assert.rejects(
      () => firewall.handleSecurity(makeContext(zone(["basic"]))),
      AuthenticationError,
    );
    const { events, total } = await audit.query();
    assert.equal(total, 1);
    assert.equal(events[0]!.category, "auth");
    assert.equal(events[0]!.action, "auth.failure");
    assert.equal(events[0]!.outcome, "failure");
    assert.equal(events[0]!.reason, "invalid_credentials");
    assert.equal(events[0]!.resource, "nodefony-admin");
    assert.equal(events[0]!.ip, "203.0.113.9");
    assert.equal(events[0]!.requestId, "req-fw");
    assert.equal(events[0]!.flags?.hasCookie, true);
  });

  it("auth.throttled sur backoff NIST (429)", async () => {
    const { audit, firewall } = setupFirewall(
      new SpyAuthenticator("basic", {
        supports: true,
        ok: false,
        throttle: true,
      }),
    );
    await assert.rejects(
      () => firewall.handleSecurity(makeContext(zone(["basic"]))),
      ThrottledError,
    );
    const { events } = await audit.query();
    assert.equal(events[0]!.action, "auth.throttled");
    assert.equal(events[0]!.outcome, "failure");
    assert.equal(events[0]!.reason, "throttled");
  });

  it("auth.denied (Zero Trust) : aucune preuve présentée dans la zone", async () => {
    const { audit, firewall } = setupFirewall(
      new SpyAuthenticator("basic", { supports: false, ok: true }),
    );
    await assert.rejects(
      () => firewall.handleSecurity(makeContext(zone(["basic"]))),
      AuthenticationError,
    );
    const { events } = await audit.query();
    assert.equal(events[0]!.action, "auth.denied");
    assert.equal(events[0]!.outcome, "denied");
    assert.equal(events[0]!.reason, "no_credentials");
    assert.equal(events[0]!.actor, null);
  });

  it("auth.denied (token non promu hors anonymous) : acteur lu sur le token", async () => {
    const { audit, firewall } = setupFirewall(
      new SpyAuthenticator("buggy", {
        supports: true,
        ok: true,
        promote: false,
      }),
    );
    await assert.rejects(
      () => firewall.handleSecurity(makeContext(zone(["buggy"]))),
      AuthenticationError,
    );
    const { events } = await audit.query();
    assert.equal(events[0]!.action, "auth.denied");
    assert.equal(events[0]!.reason, "unauthenticated");
  });

  it("SUCCÈS authentifié → AUCUNE émission (hot-path nominal muet)", async () => {
    const { audit, firewall } = setupFirewall(
      new SpyAuthenticator("basic", {
        supports: true,
        ok: true,
        user: fakeUser("alice"),
      }),
    );
    await RequestContext.run({ requestId: "ok" }, () =>
      firewall.handleSecurity(makeContext(zone(["basic"]))),
    );
    assert.equal((await audit.query()).total, 0);
  });

  it("SUCCÈS anonyme EXPLICITE → AUCUNE émission", async () => {
    const { audit, firewall } = setupFirewall(
      new SpyAuthenticator("jwtlike", { supports: false, ok: true }),
      new AnonymousAuthenticator(),
    );
    await RequestContext.run({ requestId: "anon" }, () =>
      firewall.handleSecurity(makeContext(zone(["jwtlike", "anonymous"]))),
    );
    assert.equal((await audit.query()).total, 0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// frameAuthorizer — rapporteur onDeny (mécanisme pur)
// ════════════════════════════════════════════════════════════════════════════

const ANON_WS: IRealtimeToken = {
  type: "anonymous",
  getUserIdentifier: () => "anonymous",
  isAuthenticated: () => false,
  getRoles: () => ["ROLE_ANONYMOUS"],
  getScopes: () => [],
  getAttribute: () => undefined,
};
const ADMIN_WS: IRealtimeToken = {
  type: "session",
  getUserIdentifier: () => "boss",
  isAuthenticated: () => true,
  getRoles: () => ["ROLE_ADMIN"],
  getScopes: () => [],
  getAttribute: () => undefined,
};

const fwAllSecure: IFrameAuthorizerFirewall = {
  matchPath: () => ({ security: true }),
  hasRole: (roles, required) => roles.includes(required),
};

describe("frameAuthorizer — rapporteur onDeny (cold-path)", () => {
  it("api.request sur zone protégée + anonyme → onDeny(api.request, path, zone_protected)", () => {
    const calls: Array<Parameters<FrameDenyReporter>> = [];
    const authorize = buildFrameAuthorizer(fwAllSecure, {
      systemRules: DEFAULT_SYSTEM_RULES,
      onDeny: (...a) => calls.push(a),
    });
    assert.equal(
      authorize(
        { method: "api.request", params: { path: "/secure/data?x=1" } },
        ANON_WS,
      ),
      false,
    );
    assert.equal(calls.length, 1);
    assert.deepEqual(
      [calls[0]![0], calls[0]![1], calls[0]![2]],
      ["api.request", "/secure/data", "zone_protected"],
    );
    assert.equal(calls[0]![3].getUserIdentifier(), "anonymous");
  });

  it("subscribe à un canal système (user non-admin) → onDeny(channel, ch, channel_policy)", () => {
    const calls: Array<Parameters<FrameDenyReporter>> = [];
    const authorize = buildFrameAuthorizer(fwAllSecure, {
      systemRules: DEFAULT_SYSTEM_RULES,
      onDeny: (...a) => calls.push(a),
    });
    const user: IRealtimeToken = { ...ADMIN_WS, getRoles: () => ["ROLE_USER"] };
    assert.equal(
      authorize(
        { method: "subscribe", params: { channel: "syslog:stream" } },
        user,
      ),
      false,
    );
    assert.equal(calls.length, 1);
    assert.deepEqual(
      [calls[0]![0], calls[0]![1], calls[0]![2]],
      ["channel", "syslog:stream", "channel_policy"],
    );
  });

  it("frame AUTORISÉE → onDeny JAMAIS appelé (0 coût hot-path)", () => {
    const calls: Array<Parameters<FrameDenyReporter>> = [];
    const authorize = buildFrameAuthorizer(fwAllSecure, {
      systemRules: DEFAULT_SYSTEM_RULES,
      onDeny: (...a) => calls.push(a),
    });
    // admin sur canal système : autorisé ; canal libre : autorisé.
    assert.equal(
      authorize(
        { method: "subscribe", params: { channel: "syslog:stream" } },
        ADMIN_WS,
      ),
      true,
    );
    assert.equal(
      authorize(
        { method: "subscribe", params: { channel: "chat:room" } },
        ANON_WS,
      ),
      true,
    );
    assert.equal(calls.length, 0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Firewall ⇄ realtime — preuve de câblage de bout en bout (frame.denied audité)
// ════════════════════════════════════════════════════════════════════════════

describe("Firewall ⇄ realtime — frame.denied audité (câblage réel)", () => {
  it("le verrou WS câblé par #wireRealtime émet via le container", async () => {
    const container = new Container();
    const { boot } = makeKernel(container);
    const audit = new AuditService(
      makeModule(container, { audit: { enabled: true } }),
    );
    container.set("auditService", audit);
    // realtimeService mock : capture le frameAuthorizer posé par le firewall.
    // Porteur objet (et non un `let`) : l'assignation se fait dans une closure,
    // que l'analyse de flux TS ne suit pas — un `let` resterait figé à `null`.
    const captured: { frameAuthorizer: FrameAuthorizer | null } = {
      frameAuthorizer: null,
    };
    container.set("realtimeService", {
      useAuthenticator() {},
      setFrameAuthorizer(fn: FrameAuthorizer) {
        captured.frameAuthorizer = fn;
      },
    });
    // Firewall avec une zone realtime protégée (config réelle → #build).
    const firewall = new Firewall(
      makeModule(container, {
        areas: {
          "nodefony-admin": {
            pattern: "^/rt",
            security: true,
            stateless: false,
            mode: "first",
            authenticators: ["anonymous"],
            realtime: true,
          },
        },
      }),
    );
    // Pré-enregistre "anonymous" → #instantiateAuthenticators le réutilise (pas
    // de dépendance au registre global de fabriques pour ce banc).
    firewall.registerAuthenticator(new AnonymousAuthenticator());
    boot(); // #build → #wireRealtime → setFrameAuthorizer(captured)

    assert.ok(captured.frameAuthorizer, "le firewall a posé un frameAuthorizer");
    // Anonyme tente api.request sur la zone protégée → refus + audit.
    const ok = captured.frameAuthorizer(
      { method: "api.request", params: { path: "/rt/secret" } },
      ANON_WS,
    );
    assert.equal(ok, false);
    const { events } = await audit.query();
    assert.equal(events[0]!.category, "ws");
    assert.equal(events[0]!.action, "frame.denied");
    assert.equal(events[0]!.outcome, "denied");
    assert.equal(events[0]!.actor, "anonymous");
    assert.equal(events[0]!.resource, "/rt/secret");
    assert.equal(events[0]!.reason, "zone_protected");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TokenService — émission audit
// ════════════════════════════════════════════════════════════════════════════

const tokenUsers = {
  async authenticate(id: string, pw: string): Promise<IUser | null> {
    return id === "alice" && pw === "pw" ? fakeUser("alice") : null;
  },
  async loadUserByIdentifier(id: string): Promise<IUser> {
    if (id === "alice") return fakeUser("alice");
    throw new Error("not found");
  },
  async refreshUser(u: IUser): Promise<IUser> {
    return u;
  },
};

function setupToken(auditEnabled = true): {
  svc: TokenService;
  audit: AuditService;
} {
  const container = new Container();
  const { boot } = makeKernel(container);
  container.set("users", tokenUsers);
  const audit = new AuditService(
    makeModule(container, { audit: { enabled: auditEnabled } }),
  );
  container.set("auditService", audit);
  const svc = new TokenService(
    makeModule(container, {
      jwt: { enabled: true, issuer: "https://test.nf", audiences: ["nf-api"] },
      tokenStore: { store: "memory", gcIntervalS: 0 },
    }),
  );
  boot();
  return { svc, audit };
}

describe("TokenService — émission audit", () => {
  it("token.issued à l'émission d'un couple (succès)", async () => {
    const { svc, audit } = setupToken();
    await svc.issueTokens(fakeUser("alice"), ["orders:read"]);
    const { events } = await audit.query();
    assert.equal(events[0]!.category, "token");
    assert.equal(events[0]!.action, "token.issued");
    assert.equal(events[0]!.outcome, "success");
    assert.equal(events[0]!.actor, "alice");
    assert.deepEqual((events[0]!.metadata as { scopes: string[] }).scopes, [
      "orders:read",
    ]);
  });

  it("token.reuse_detected sur rejeu d'un refresh révoqué (RFC 9700)", async () => {
    const { svc, audit } = setupToken();
    const r1 = await svc.issueTokens(fakeUser("alice"));
    await svc.refresh(r1.refresh_token); // rotation → r1 révoqué (muet)
    await assert.rejects(
      () => svc.refresh(r1.refresh_token), // rejeu de l'ancien
      AuthenticationError,
    );
    const { events } = await audit.query();
    assert.equal(events[0]!.action, "token.reuse_detected");
    assert.equal(events[0]!.outcome, "denied");
    assert.equal(events[0]!.actor, "alice");
    assert.equal(events[0]!.reason, "reuse_detected");
  });

  it("login.failure (grant password) sur identité inconnue + identifiants vides", async () => {
    const { svc, audit } = setupToken();
    await assert.rejects(
      () => svc.issueForCredentials("ghost", "x"),
      AuthenticationError,
    );
    await assert.rejects(
      () => svc.issueForCredentials("", ""),
      AuthenticationError,
    );
    const { events, total } = await audit.query();
    assert.equal(total, 2);
    // Récent → ancien : [0] = identifiants vides (actor null), [1] = ghost.
    assert.equal(events[0]!.action, "login.failure");
    assert.equal(events[0]!.category, "auth");
    assert.equal(events[0]!.actor, null);
    assert.equal(events[1]!.actor, "ghost");
  });

  it("audit désactivé → token.issued NON journalisé", async () => {
    const { svc, audit } = setupToken(false);
    await svc.issueTokens(fakeUser("alice"));
    assert.equal((await audit.query()).total, 0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ApiKeyService — émission audit
// ════════════════════════════════════════════════════════════════════════════

function setupApiKeys(): { keys: ApiKeyService; audit: AuditService } {
  const container = new Container();
  const { boot } = makeKernel(container);
  const audit = new AuditService(
    makeModule(container, { audit: { enabled: true } }),
  );
  container.set("auditService", audit);
  // TokenService provisionne le tokenStore partagé (apiKeys activées).
  new TokenService(
    makeModule(container, {
      apiKeys: { enabled: true },
      tokenStore: { store: "memory", gcIntervalS: 0 },
    }),
  );
  const keys = new ApiKeyService(
    makeModule(container, { apiKeys: { enabled: true } }),
  );
  boot();
  return { keys, audit };
}

describe("ApiKeyService — émission audit", () => {
  it("apikey.created à l'émission d'une clé (id public, jamais le secret)", async () => {
    const { keys, audit } = setupApiKeys();
    const created = await keys.createForSubject("alice", "user", {
      name: "ci",
      scopes: [],
    });
    const { events } = await audit.query();
    assert.equal(events[0]!.category, "token");
    assert.equal(events[0]!.action, "apikey.created");
    assert.equal(events[0]!.outcome, "success");
    assert.equal(events[0]!.actor, "alice");
    assert.equal(events[0]!.resource, created.id);
    // Le secret en clair ne fuit JAMAIS dans l'événement.
    assert.ok(!JSON.stringify(events[0]).includes(created.token));
  });

  it("apikey.revoked à la révocation", async () => {
    const { keys, audit } = setupApiKeys();
    const created = await keys.createForSubject("alice", "user", {
      name: "ci",
    });
    const ok = await keys.revokeForSubject("alice", created.id);
    assert.equal(ok, true);
    const { events } = await audit.query();
    assert.equal(events[0]!.action, "apikey.revoked");
    assert.equal(events[0]!.resource, created.id);
    assert.equal(events[0]!.reason, "manual");
  });

  it("révocation d'une clé d'autrui (anti-énumération) → AUCUNE émission", async () => {
    const { keys, audit } = setupApiKeys();
    const created = await keys.createForSubject("alice", "user", {
      name: "ci",
    });
    const ok = await keys.revokeForSubject("mallory", created.id);
    assert.equal(ok, false);
    // Seul apikey.created (1) a été émis — pas de révocation fantôme.
    const { total } = await audit.query();
    assert.equal(total, 1);
  });
});
