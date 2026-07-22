import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { Container, Event, RequestContext } from "nodefony";
import type { Module } from "nodefony";
import type { ContextType } from "@nodefony/http";
import { anonymousUser } from "@nodefony/user";
import type { IUser } from "@nodefony/user";
import { Firewall } from "../../nodefony/service/firewall";
import { FirewallRealtimeAuthenticator } from "../../nodefony/src/authenticator/FirewallRealtimeAuthenticator";
import { UserRealtimeToken } from "../../nodefony/src/realtime/UserRealtimeToken";
import {
  buildFrameAuthorizer,
  DEFAULT_SYSTEM_RULES,
  type IFrameAuthorizerFirewall,
  type IChannelPolicyResolver,
} from "../../nodefony/src/realtime/frameAuthorizer";
import type {
  IRealtimeToken,
  IRealtimeHandshake,
  IRealtimeAuthenticator,
  IRealtimeAuthenticatorMatcher,
  FrameAuthorizer,
} from "../../nodefony/src/realtime/realtimeContracts";

/**
 * P6 J3b Étape 3 — verrou WS frame-level (data plane). Gates :
 *  - FirewallRealtimeAuthenticator : transfère l'identité DÉJÀ résolue par le
 *    firewall au handshake (ALS), 0 lecture base ; anonyme/hors scope → refus.
 *  - UserRealtimeToken : adaptateur IUser → IRealtimeToken (copie des rôles).
 *  - buildFrameAuthorizer : invariant `api.request {path}` ≤ `GET {path}` (re-match
 *    de zone) + `subscribe` aux canaux d'observabilité réservé aux authentifiés.
 */

const HANDSHAKE: IRealtimeHandshake = {
  headers: {},
  cookies: new Map(),
  url: "/nodefony/studio/api/realtime",
  remoteAddress: "127.0.0.1",
  protocols: [],
};

const fakeUser = {
  identifier: "alice",
  roles: ["ROLE_ADMIN", "ROLE_USER"],
} as unknown as IUser;

function withUser<T>(user: unknown, fn: () => T): T {
  return RequestContext.run({ requestId: "t-rt", user }, fn);
}

const AUTH_TOKEN: IRealtimeToken = {
  type: "session",
  getUserIdentifier: () => "alice",
  isAuthenticated: () => true,
  getRoles: () => ["ROLE_USER"],
  getScopes: () => [],
  getAttribute: () => undefined,
};
const ANON_TOKEN: IRealtimeToken = {
  type: "anonymous",
  getUserIdentifier: () => "anonymous",
  isAuthenticated: () => false,
  getRoles: () => ["ROLE_ANONYMOUS"],
  getScopes: () => [],
  getAttribute: () => undefined,
};
// Admin (session BFF : rôles, pas de scopes).
const ADMIN_TOKEN: IRealtimeToken = {
  type: "session",
  getUserIdentifier: () => "boss",
  isAuthenticated: () => true,
  getRoles: () => ["ROLE_ADMIN"],
  getScopes: () => [],
  getAttribute: () => undefined,
};
// Token API (JWT/clé) : porte un scope, rôle applicatif standard.
const SCOPE_TOKEN: IRealtimeToken = {
  type: "jwt",
  getUserIdentifier: () => "svc",
  isAuthenticated: () => true,
  getRoles: () => ["ROLE_USER"],
  getScopes: () => ["metrics:read"],
  getAttribute: () => undefined,
};

describe("UserRealtimeToken — adaptateur IUser → IRealtimeToken", () => {
  it("expose l'identité de l'utilisateur (authentifié par construction)", () => {
    const token = new UserRealtimeToken(fakeUser);
    assert.equal(token.type, "session");
    assert.equal(token.getUserIdentifier(), "alice");
    assert.equal(token.isAuthenticated(), true);
    assert.deepEqual(token.getRoles(), ["ROLE_ADMIN", "ROLE_USER"]);
    assert.deepEqual(token.getScopes(), []); // session BFF = pas de scopes
    assert.equal(token.getAttribute("anything"), undefined);
  });

  it("getRoles renvoie une COPIE (pas la structure interne)", () => {
    const token = new UserRealtimeToken(fakeUser);
    const roles = token.getRoles();
    roles.push("ROLE_INJECTED");
    assert.deepEqual(token.getRoles(), ["ROLE_ADMIN", "ROLE_USER"]); // intact
  });
});

describe("FirewallRealtimeAuthenticator — lit l'ALS, 0 re-lecture", () => {
  const auth = new FirewallRealtimeAuthenticator();

  it("name = firewall-realtime", () => {
    assert.equal(auth.name, "firewall-realtime");
  });

  it("supports : true quand le firewall a posé un user authentifié dans l'ALS", () => {
    assert.equal(
      withUser(fakeUser, () => auth.supports(HANDSHAKE)),
      true,
    );
  });

  it("supports : false pour l'utilisateur anonyme", () => {
    assert.equal(
      withUser(anonymousUser, () => auth.supports(HANDSHAKE)),
      false,
    );
  });

  it("supports : false hors scope ALS (aucun user résolu)", () => {
    assert.equal(auth.supports(HANDSHAKE), false);
  });

  it("authenticate : promeut l'identité ALS en UserRealtimeToken (0 lecture base)", async () => {
    const token = await withUser(fakeUser, () => auth.authenticate(HANDSHAKE));
    assert.equal(token.getUserIdentifier(), "alice");
    assert.equal(token.isAuthenticated(), true);
    assert.deepEqual(token.getRoles(), ["ROLE_ADMIN", "ROLE_USER"]);
  });

  it("authenticate : throw fail-closed si aucune identité authentifiée", async () => {
    await assert.rejects(
      () => withUser(anonymousUser, () => auth.authenticate(HANDSHAKE)),
      /Invalid realtime session/,
    );
    await assert.rejects(
      () => auth.authenticate(HANDSHAKE), // hors scope
      /Invalid realtime session/,
    );
  });
});

describe("buildFrameAuthorizer — api.request ≤ GET + RBAC par canal", () => {
  // Firewall factice : zone (matchPath) + hiérarchie de rôles (hasRole) simulant
  // ROLE_ADMIN ⊇ ROLE_USER (le RoleHierarchyWalker réel fait ça au boot).
  const firewall: IFrameAuthorizerFirewall = {
    matchPath: (p) => {
      if (p.startsWith("/nodefony/") && p.includes("/api"))
        return { security: true };
      if (p.startsWith("/open")) return { security: false };
      return null;
    },
    hasRole: (roles, required) =>
      roles.includes(required) ||
      (required === "ROLE_USER" && roles.includes("ROLE_ADMIN")),
  };
  // Politiques MÉTIER déclarées (`@RealtimeChannel`), exposées par le hub realtime.
  // `nodefony:custom` : volontairement faible (authenticated) pour prouver que le
  // PLANCHER système (ROLE_ADMIN) gagne — un décorateur n'affaiblit pas un namespace réservé.
  const channelResolver: IChannelPolicyResolver = {
    resolveChannelPolicy: (channel) => {
      switch (channel) {
        case "app:authed":
          return { authenticated: true };
        case "app:useronly":
          return { roles: ["ROLE_USER"] };
        case "app:adminonly":
          return { roles: ["ROLE_ADMIN"] };
        case "app:scoped":
          return { scopes: ["metrics:read"] };
        case "nodefony:custom":
          return { authenticated: true };
        default:
          return null;
      }
    },
  };
  const authorize = buildFrameAuthorizer(firewall, {
    channelResolver,
    systemRules: DEFAULT_SYSTEM_RULES,
  });
  const apiReq = (path: unknown) => ({
    method: "api.request",
    params: { path },
  });
  const sub = (channel: unknown) => ({
    method: "subscribe",
    params: { channel },
  });

  // ── api.request (inchangé J3b) ───────────────────────────────────────────
  it("api.request zone protégée + anonyme → REFUS", () => {
    assert.equal(
      authorize(apiReq("/nodefony/kernel/api/modules"), ANON_TOKEN),
      false,
    );
  });

  it("api.request zone protégée + authentifié → AUTORISÉ", () => {
    assert.equal(
      authorize(apiReq("/nodefony/kernel/api/modules"), AUTH_TOKEN),
      true,
    );
  });

  it("api.request query du path strippée avant le match (toujours protégé)", () => {
    assert.equal(
      authorize(apiReq("/nodefony/orm/api/x?authorId=42"), ANON_TOKEN),
      false,
    );
  });

  it("api.request hors zone / zone publique + anonyme → AUTORISÉ", () => {
    assert.equal(authorize(apiReq("/public/thing"), ANON_TOKEN), true);
    assert.equal(authorize(apiReq("/open/data"), ANON_TOKEN), true);
  });

  it("api.request params invalides → AUTORISÉ (handler renverra -32602)", () => {
    assert.equal(authorize(apiReq(undefined), ANON_TOKEN), true);
    assert.equal(authorize(apiReq(42), ANON_TOKEN), true);
  });

  // ── subscribe : canaux SYSTÈME (durcissement Zero Trust → ROLE_ADMIN) ─────
  it("subscribe canal d'observabilité + anonyme → REFUS", () => {
    for (const ch of [
      "nodefony:syslog",
      "nodefony:orm:flow",
      "nodefony:orm:health",
      "nodefony:supervision",
      "nodefony:socket",
      "nodefony:audit",
      "nodefony:debugbar",
      "nodefony:cluster:peers",
    ]) {
      assert.equal(authorize(sub(ch), ANON_TOKEN), false, ch);
    }
  });

  it("subscribe canal d'observabilité + user SIMPLE → REFUS (durci : exige ROLE_ADMIN)", () => {
    assert.equal(authorize(sub("nodefony:syslog"), AUTH_TOKEN), false);
    assert.equal(authorize(sub("nodefony:orm:health"), AUTH_TOKEN), false);
  });

  it("subscribe canal d'observabilité + ADMIN → AUTORISÉ", () => {
    assert.equal(authorize(sub("nodefony:syslog"), ADMIN_TOKEN), true);
    assert.equal(authorize(sub("nodefony:supervision"), ADMIN_TOKEN), true);
  });

  it("subscribe convention <module>:health / :stats → ADMIN only", () => {
    assert.equal(authorize(sub("mymod:health"), AUTH_TOKEN), false);
    assert.equal(authorize(sub("mymod:stats"), ADMIN_TOKEN), true);
  });

  it("PLANCHER système non contournable : décorateur faible sur nodefony: → ADMIN quand même", () => {
    // channelResolver dit `{authenticated:true}` pour nodefony:custom, mais le
    // namespace système (ROLE_ADMIN) prime → un user simple reste REFUSÉ.
    assert.equal(authorize(sub("nodefony:custom"), AUTH_TOKEN), false);
    assert.equal(authorize(sub("nodefony:custom"), ADMIN_TOKEN), true);
  });

  // ── subscribe : canaux MÉTIER (@RealtimeChannel) ─────────────────────────
  it("canal métier { authenticated } : anonyme REFUS, authentifié OK", () => {
    assert.equal(authorize(sub("app:authed"), ANON_TOKEN), false);
    assert.equal(authorize(sub("app:authed"), AUTH_TOKEN), true);
  });

  it("canal métier { roles:[ROLE_USER] } : anonyme REFUS, user OK, admin OK (hiérarchie)", () => {
    assert.equal(authorize(sub("app:useronly"), ANON_TOKEN), false);
    assert.equal(authorize(sub("app:useronly"), AUTH_TOKEN), true);
    assert.equal(authorize(sub("app:useronly"), ADMIN_TOKEN), true);
  });

  it("canal métier { roles:[ROLE_ADMIN] } : user REFUS, admin OK", () => {
    assert.equal(authorize(sub("app:adminonly"), AUTH_TOKEN), false);
    assert.equal(authorize(sub("app:adminonly"), ADMIN_TOKEN), true);
  });

  it("canal métier { scopes:[metrics:read] } : session sans scope REFUS, token API avec scope OK", () => {
    assert.equal(authorize(sub("app:scoped"), AUTH_TOKEN), false); // session BFF = 0 scope
    assert.equal(authorize(sub("app:scoped"), ADMIN_TOKEN), false);
    assert.equal(authorize(sub("app:scoped"), SCOPE_TOKEN), true);
  });

  it("subscribe canal applicatif LIBRE (non déclaré) + anonyme → AUTORISÉ", () => {
    assert.equal(authorize(sub("chat:room1"), ANON_TOKEN), true);
    assert.equal(authorize(sub("presence:lobby"), ANON_TOKEN), true);
  });

  it("subscribe params invalides (channel absent) → AUTORISÉ (no-op côté controller)", () => {
    assert.equal(authorize(sub(undefined), ANON_TOKEN), true);
  });

  // ── inbound full-duplex : même politique que subscribe ───────────────────
  it("inbound (method = canal déclaré) : gated par la même policy", () => {
    // `app:adminonly` poussé en NOTIFICATION (sans id) : user REFUS, admin OK.
    assert.equal(
      authorize({ method: "app:adminonly", params: { x: 1 } }, AUTH_TOKEN),
      false,
    );
    assert.equal(
      authorize({ method: "app:adminonly", params: { x: 1 } }, ADMIN_TOKEN),
      true,
    );
  });

  it("autres méthodes (ping/unsubscribe/action libre) → AUTORISÉ", () => {
    assert.equal(authorize({ method: "ping" }, ANON_TOKEN), true);
    assert.equal(
      authorize(
        { method: "unsubscribe", params: { channel: "nodefony:syslog" } },
        ANON_TOKEN,
      ),
      true,
    );
    assert.equal(authorize({}, ANON_TOKEN), true);
  });

  it("action kernel: (gc/ping) = namespace plateforme → anonyme ET user simple REFUS, ADMIN OK", () => {
    // nodefony:kernel:gc force un GC V8 (effet réel = DoS stop-the-world), nodefony:kernel:ping
    // sonde la liveness du pod : namespace de contrôle/observabilité plateforme →
    // plancher ROLE_ADMIN (comme node:/cluster:/realtime:). Un authentifié
    // non-admin ne doit pas pouvoir déclencher un GC sur le pod (oubli pré-P6 :
    // `kernel:` n'était pas dans les préfixes système → action laissée libre).
    assert.equal(
      authorize({ method: "nodefony:kernel:gc" }, ANON_TOKEN),
      false,
    );
    assert.equal(
      authorize({ method: "nodefony:kernel:gc" }, AUTH_TOKEN),
      false,
    );
    assert.equal(
      authorize({ method: "nodefony:kernel:gc" }, ADMIN_TOKEN),
      true,
    );
    assert.equal(
      authorize({ method: "nodefony:kernel:ping" }, ANON_TOKEN),
      false,
    );
    assert.equal(
      authorize({ method: "nodefony:kernel:ping" }, AUTH_TOKEN),
      false,
    );
    assert.equal(
      authorize({ method: "nodefony:kernel:ping" }, ADMIN_TOKEN),
      true,
    );
  });
});

describe("buildFrameAuthorizer — override config (realtimeChannels)", () => {
  const firewall: IFrameAuthorizerFirewall = {
    matchPath: () => null,
    hasRole: (roles, required) =>
      roles.includes(required) ||
      (required === "ROLE_USER" && roles.includes("ROLE_ADMIN")),
  };
  const sub = (channel: string) => ({
    method: "subscribe",
    params: { channel },
  });

  it("config AVANT défauts : assouplit syslog: à `authenticated` (user OK)", () => {
    // L'admin de l'app décide d'ouvrir le canal des journaux aux authentifiés (responsabilité
    // assumée). La règle config est placée AVANT les défauts → elle gagne.
    const authorize = buildFrameAuthorizer(firewall, {
      systemRules: [
        { prefix: "nodefony:syslog", policy: { authenticated: true } },
        ...DEFAULT_SYSTEM_RULES,
      ],
    });
    assert.equal(authorize(sub("nodefony:syslog"), AUTH_TOKEN), true);
    assert.equal(authorize(sub("nodefony:syslog"), ANON_TOKEN), false);
    // orm: (non surchargé) garde le défaut ROLE_ADMIN → user refusé.
    assert.equal(authorize(sub("nodefony:orm:health"), AUTH_TOKEN), false);
  });

  it("config peut DURCIR un namespace custom (ex: billing: → ROLE_ADMIN)", () => {
    const authorize = buildFrameAuthorizer(firewall, {
      systemRules: [
        { prefix: "billing:", policy: { roles: ["ROLE_ADMIN"] } },
        ...DEFAULT_SYSTEM_RULES,
      ],
    });
    assert.equal(authorize(sub("billing:invoices"), AUTH_TOKEN), false);
    assert.equal(authorize(sub("billing:invoices"), ADMIN_TOKEN), true);
  });
});

/**
 * Câblage au boot (`firewall.#wireRealtime`, déclenché par `#build` à `onBoot`).
 * Harnais aligné sur `makeFirewall` (firewallChain.test) : Firewall construit hors
 * kernel réel + kernel mock qui capture `onBoot` → on le fire pour déclencher `#build`.
 */
interface CapturedRealtime {
  useAuth: Array<{
    matcher: IRealtimeAuthenticatorMatcher;
    auth: IRealtimeAuthenticator;
  }>;
  frameAuthorizer: FrameAuthorizer | null;
  firewall: Firewall;
  container: Container;
}

function bootFirewall(
  areas: Record<string, unknown>,
  withRealtimeService = true,
  extraConfig: Record<string, unknown> = {},
): CapturedRealtime {
  const container = new Container();
  let firewall!: Firewall;
  const captured = { useAuth: [], frameAuthorizer: null } as Pick<
    CapturedRealtime,
    "useAuth" | "frameAuthorizer"
  >;
  if (withRealtimeService) {
    container.set("realtimeService", {
      useAuthenticator: (
        matcher: IRealtimeAuthenticatorMatcher,
        auth: IRealtimeAuthenticator,
      ) => captured.useAuth.push({ matcher, auth }),
      setFrameAuthorizer: (fn: FrameAuthorizer | null) => {
        captured.frameAuthorizer = fn;
      },
    });
  }
  // Porteur objet (et non un `let`) : l'assignation a lieu dans une closure, que
  // l'analyse de flux TS ne suit pas — un `let` resterait figé à `null`.
  const hooks: { onBoot: (() => void) | null } = { onBoot: null };
  // kernel mock : `Service` ctor fait `this.kernel = container.get("kernel")` puis
  // `this.kernel?.once("onBoot", …)`. On capture le callback pour le déclencher.
  container.set("kernel", {
    container,
    once: (event: string, cb: () => void) => {
      if (event === "onBoot") hooks.onBoot = cb;
    },
  });
  firewall = new Firewall({
    container,
    notificationsCenter: new Event(),
    options: { areas, ...extraConfig },
  } as unknown as Module);
  hooks.onBoot?.(); // déclenche #build → #wireRealtime
  return { ...captured, firewall, container };
}

/** Contexte HTTP minimal pour `isSecure` (url + domaine optionnel). */
function makeHttpCtx(url: string, domain?: string): ContextType {
  return {
    request: { url: new URL(url) },
    domain,
  } as unknown as ContextType;
}

const ADMIN_PATTERN = "^/nodefony/[^/]+/api(/|$)";

describe("firewall.#wireRealtime — câblage du verrou au boot", () => {
  it("zone realtime+security → useAuthenticator(FirewallRealtimeAuthenticator) + setFrameAuthorizer", () => {
    const c = bootFirewall({
      "nodefony-admin": {
        pattern: ADMIN_PATTERN,
        authenticators: ["session"],
        realtime: true,
      },
    });
    assert.equal(c.useAuth.length, 1);
    assert.equal(c.useAuth[0]!.auth.name, "firewall-realtime");
    assert.ok(c.useAuth[0]!.matcher.pattern instanceof RegExp);
    assert.ok(typeof c.frameAuthorizer === "function");
  });

  it("le matcher câblé capture le path du hub data plane", () => {
    const c = bootFirewall({
      "nodefony-admin": {
        pattern: ADMIN_PATTERN,
        authenticators: ["session"],
        realtime: true,
      },
    });
    const re = c.useAuth[0]!.matcher.pattern as RegExp;
    assert.ok(re.test("/nodefony/studio/api/realtime"));
    assert.ok(!re.test("/public/ws"));
  });

  it("le frame authorizer câblé applique l'invariant (api.request protégé + anonyme → refus)", () => {
    const c = bootFirewall({
      "nodefony-admin": {
        pattern: ADMIN_PATTERN,
        authenticators: ["session"],
        realtime: true,
      },
    });
    const denied = c.frameAuthorizer!(
      {
        method: "api.request",
        params: { path: "/nodefony/kernel/api/modules" },
      },
      ANON_TOKEN,
    );
    assert.equal(denied, false);
    const allowed = c.frameAuthorizer!(
      {
        method: "api.request",
        params: { path: "/nodefony/kernel/api/modules" },
      },
      AUTH_TOKEN,
    );
    assert.equal(allowed, true);
  });

  it("le frame authorizer câblé applique le RBAC système (syslog: → ROLE_ADMIN)", () => {
    const c = bootFirewall({
      "nodefony-admin": {
        pattern: ADMIN_PATTERN,
        authenticators: ["session"],
        realtime: true,
      },
    });
    const sub = { method: "subscribe", params: { channel: "nodefony:syslog" } };
    // Hiérarchie vide (pas de roleHierarchy en config) → ROLE_ADMIN exact requis.
    assert.equal(c.frameAuthorizer!(sub, ANON_TOKEN), false);
    assert.equal(c.frameAuthorizer!(sub, AUTH_TOKEN), false); // user simple refusé
    assert.equal(c.frameAuthorizer!(sub, ADMIN_TOKEN), true);
  });

  it("zone protégée realtime NON déclaré → câblé (défaut SÛR true, opt-out explicite)", () => {
    // Zero Trust : une zone qui ferme le HTTP ferme aussi le WS par défaut. Un
    // flag opt-IN serait fail-open (oubli = WS anonyme). `realtime` défaut `true`.
    const c = bootFirewall({
      "http-only": { pattern: "^/admin", authenticators: ["session"] },
    });
    assert.equal(c.useAuth.length, 1);
    assert.equal(c.useAuth[0]!.auth.name, "firewall-realtime");
    assert.ok(typeof c.frameAuthorizer === "function");
  });

  it("zone realtime: false (opt-out) → pas d'authenticator de zone, MAIS plancher système armé (F82 fail-closed)", () => {
    const c = bootFirewall({
      "http-only": {
        pattern: "^/admin",
        authenticators: ["session"],
        realtime: false,
      },
    });
    // L'opt-out `realtime: false` désactive le TRANSFERT d'identité de cette zone
    // (aucun FirewallRealtimeAuthenticator câblé) — c'est son seul rôle.
    assert.equal(c.useAuth.length, 0);
    // MAIS le plancher système (namespaces réservés) ne dépend PAS des zones : F82
    // — le conditionner au câblage d'une zone était fail-OPEN (sans zone qualifiante,
    // `syslog:`/`security:` servis à l'anonyme). Le verrou est donc TOUJOURS posé dès
    // que le hub existe. Sans authenticator, tout abonné reste anonyme → les canaux
    // système sont fermés à TOUS (pour y donner accès, l'app doit déclarer une zone
    // `security && realtime`), tandis qu'un canal applicatif libre reste ouvert.
    assert.ok(typeof c.frameAuthorizer === "function");
    const sysSub = {
      method: "subscribe",
      params: { channel: "nodefony:syslog" },
    };
    assert.equal(c.frameAuthorizer!(sysSub, ANON_TOKEN), false);
    const freeSub = { method: "subscribe", params: { channel: "chat:public" } };
    assert.equal(c.frameAuthorizer!(freeSub, ANON_TOKEN), true);
  });

  it("module realtime absent (realtimeService non enregistré) → no-op, pas de crash", () => {
    assert.doesNotThrow(() =>
      bootFirewall(
        {
          "nodefony-admin": {
            pattern: ADMIN_PATTERN,
            authenticators: ["session"],
            realtime: true,
          },
        },
        false, // pas de realtimeService dans le container
      ),
    );
  });

  it("config `realtimeChannels` → règle appliquée AVANT les défauts (durcit billing:)", () => {
    const c = bootFirewall(
      {
        "nodefony-admin": {
          pattern: ADMIN_PATTERN,
          authenticators: ["session"],
          realtime: true,
        },
      },
      true,
      { realtimeChannels: [{ pattern: "billing:", roles: ["ROLE_ADMIN"] }] },
    );
    const sub = (channel: string) => ({
      method: "subscribe",
      params: { channel },
    });
    // billing: gaté ROLE_ADMIN par la config (user simple refusé, admin OK).
    assert.equal(c.frameAuthorizer!(sub("billing:x"), AUTH_TOKEN), false);
    assert.equal(c.frameAuthorizer!(sub("billing:x"), ADMIN_TOKEN), true);
  });
});

describe("firewall.#build / isSecure / provisionShared (boot)", () => {
  const ZONE = {
    "data-plane": {
      pattern: ADMIN_PATTERN,
      authenticators: ["session"],
      realtime: true,
    },
  };

  it("isSecure : pathname dans une zone → true + context.security posé", () => {
    const { firewall } = bootFirewall(ZONE);
    const ctx = makeHttpCtx("https://localhost/nodefony/studio/api/x");
    assert.equal(firewall.isSecure(ctx), true);
    assert.ok((ctx as { security?: unknown }).security);
  });

  it("isSecure : pathname hors zone → false", () => {
    const { firewall } = bootFirewall(ZONE);
    assert.equal(
      firewall.isSecure(makeHttpCtx("https://localhost/public")),
      false,
    );
  });

  it("isSecure : aucune zone configurée → false (court-circuit hot-path)", () => {
    const { firewall } = bootFirewall({});
    assert.equal(firewall.isSecure(makeHttpCtx("https://localhost/x")), false);
  });

  it("getArea : nom connu → zone, nom inconnu → undefined", () => {
    const { firewall } = bootFirewall(ZONE);
    assert.ok(firewall.getArea("data-plane"));
    assert.equal(firewall.getArea("ghost"), undefined);
  });

  it("config Zod INVALIDE → fail-closed (configError) : isSecure capture TOUT", () => {
    // roleHierarchy attend un record → une string est rejetée par Zod au boot.
    const { firewall } = bootFirewall(ZONE, true, {
      roleHierarchy: "not-a-record",
    });
    assert.equal(
      firewall.isSecure(makeHttpCtx("https://localhost/anything")),
      true,
    );
  });

  it("authenticator inconnu dans une zone → fail-closed (configError) : isSecure capture TOUT", () => {
    const { firewall } = bootFirewall({
      bad: { pattern: "^/x", authenticators: ["ghost-authenticator"] },
    });
    assert.equal(
      firewall.isSecure(makeHttpCtx("https://localhost/anything")),
      true,
    );
  });

  it("provisionSharedServices : encoders en config → passwordEncoder au container", () => {
    const { container } = bootFirewall(ZONE, true, {
      encoders: { default: { type: "bcrypt" } },
    });
    assert.ok(container.get("passwordEncoder"));
  });

  it("provisionSharedServices : AUCUN encoders configuré → passwordEncoder argon2id par DÉFAUT (auth vivante en prod)", () => {
    // Régression prod/cluster : les encoders vivaient dans le module `test`
    // (dev-only) → absents en production → `passwordEncoder` jamais posé →
    // provisionUsers throw → boot terminate. Le défaut Zod DOIT poser un encodeur.
    const { container } = bootFirewall(ZONE, true, {}); // 0 encoders fourni
    assert.ok(
      container.get("passwordEncoder"),
      "le pont config.encoders doit poser passwordEncoder même sans config app",
    );
  });

  it("provisionSharedServices : rateLimit.enabled → loginThrottler au container", () => {
    const { container } = bootFirewall(ZONE, true, {
      rateLimit: { enabled: true },
    });
    assert.ok(container.get("loginThrottler"));
  });

  it("2 zones partageant un authenticator : tri par spécificité + dédup instanciation", () => {
    // 2 zones → le comparateur de tri est invoqué ; même authenticator `session`
    // sur les deux → la 2ᵉ passe par le `continue` (déjà enregistré).
    const { firewall } = bootFirewall({
      "z-short": { pattern: "^/a", authenticators: ["session"] },
      "z-longer-pattern": {
        pattern: "^/admin/long",
        authenticators: ["session"],
      },
    });
    assert.ok(firewall.getArea("z-short"));
    assert.ok(firewall.getArea("z-longer-pattern"));
  });

  it("zone realtime AVEC host → le matcher WS porte le vhost", () => {
    const c = bootFirewall({
      vhost: {
        pattern: ADMIN_PATTERN,
        authenticators: ["session"],
        realtime: true,
        host: "admin.example.com",
      },
    });
    assert.equal(c.useAuth[0]!.matcher.host, "admin.example.com");
  });

  it("matchPath sans aucune zone → null (court-circuit)", () => {
    const { firewall } = bootFirewall({});
    assert.equal(firewall.matchPath("/anything"), null);
  });

  it("isSecure : request.url en STRING (pas URL) → résout le pathname", () => {
    const { firewall } = bootFirewall(ZONE);
    const ctx = {
      request: { url: "/nodefony/studio/api/x" },
    } as unknown as ContextType;
    assert.equal(firewall.isSecure(ctx), true);
  });

  it("isSecure : request sans url → false", () => {
    const { firewall } = bootFirewall(ZONE);
    assert.equal(
      firewall.isSecure({ request: {} } as unknown as ContextType),
      false,
    );
  });

  it("handleSecurity avec configError → throw AuthenticationError (fail-closed)", async () => {
    const { firewall } = bootFirewall(ZONE, true, {
      roleHierarchy: "not-a-record",
    });
    await assert.rejects(
      () => firewall.handleSecurity(makeHttpCtx("https://localhost/x")),
      /Security configuration invalid/,
    );
  });
});

/**
 * Re-validation Zero Trust du jeton realtime (`isValid`) — ferme l'ÉLÉVATION DE
 * PRIVILÈGE par socket figée : une WebSocket grave l'identité au handshake et
 * SURVIT à sa session (singleton partagé par navigateur). Après une déconnexion
 * admin puis la connexion d'un autre compte, le pont `api.request` rejouait un
 * GET data plane avec l'identité admin. `UserRealtimeToken.isValid()` re-lit la
 * session BFF du handshake AVANT l'action → refuse si elle est morte ou a changé
 * de propriétaire. (Le pont — `RealtimeController.invokeApiRequest` — répond 401
 * sur `false`, et le client bascule en fetch HTTP avec le cookie courant.)
 */
describe("FirewallRealtimeAuthenticator — re-validation Zero Trust du token (isValid)", () => {
  // Faux store de session (id → blob). `read()` reflète l'état COURANT → on
  // simule un logout (delete) ou un changement de compte (set un autre user).
  function fakeStore(initial: Record<string, { user: string }>) {
    const map = new Map<string, { user: string }>(Object.entries(initial));
    return {
      map,
      storage: {
        read(id: string): Promise<{ user?: unknown } | null> {
          return Promise.resolve(map.get(id) ?? null);
        },
      },
    };
  }

  const adminUser = {
    identifier: "admin",
    roles: ["ROLE_NODEFONY_ADMIN"],
  } as unknown as IUser;

  // Promeut l'identité (ALS) en token realtime via l'authenticator réel, avec une
  // session de handshake injectée dans le contexte ALS (comme le pipeline http).
  function tokenFor(
    sessionId: string | undefined,
    storage: unknown,
  ): Promise<IRealtimeToken> {
    const auth = new FirewallRealtimeAuthenticator();
    return RequestContext.run(
      {
        requestId: "test",
        user: adminUser,
        context: sessionId ? { session: { id: sessionId, storage } } : {},
      },
      () => auth.authenticate({} as IRealtimeHandshake),
    );
  }

  it("valide tant que la session du handshake reste celle de l'utilisateur", async () => {
    const store = fakeStore({ "sess-1": { user: "admin" } });
    const token = await tokenFor("sess-1", store.storage);
    assert.equal(await token.isValid!(), true);
  });

  it("REFUSE après destruction de la session (logout admin)", async () => {
    const store = fakeStore({ "sess-1": { user: "admin" } });
    const token = await tokenFor("sess-1", store.storage);
    store.map.delete("sess-1"); // logout → session détruite côté store
    assert.equal(await token.isValid!(), false);
  });

  it("REFUSE si un AUTRE compte occupe désormais la session (bascule d'identité)", async () => {
    const store = fakeStore({ "sess-1": { user: "admin" } });
    const token = await tokenFor("sess-1", store.storage);
    store.map.set("sess-1", { user: "bob" }); // la socket figée « admin » ne suit plus
    assert.equal(await token.isValid!(), false);
  });

  it("F84 — session non re-lisible au handshake → révoqué (fail-closed, plus de fail-open silencieux)", async () => {
    // Avant : `buildSessionRevalidator` renvoyait `null` → `isValid()` toujours `true`
    // → socket inscrite au tick de révocation mais JAMAIS fermée, sans aucune trace.
    // Après : une identité de session non revalidable est fail-closed → `isValid()` false
    // → le hub ferme la socket (4001) au 1er tick (révocation observable, plus silencieuse).
    const token = await tokenFor(undefined, undefined);
    assert.equal(await token.isValid!(), false);
  });

  it("F84 — session présente mais store illisible (pas de read) → révoqué (fail-closed)", async () => {
    // Distinct du store-qui-throw : ici on ne peut même pas TENTER la re-lecture.
    const token = await tokenFor("sess-x", { notAStore: true });
    assert.equal(await token.isValid!(), false);
  });

  it("fail-closed : une re-lecture du store qui throw → refus", async () => {
    const storage = {
      read(): Promise<{ user?: unknown } | null> {
        return Promise.reject(new Error("store down"));
      },
    };
    const token = await tokenFor("sess-1", storage);
    assert.equal(await token.isValid!(), false);
  });
});
