import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { Container, Event, RequestContext } from "nodefony";
import type { Module } from "nodefony";
import { anonymousUser } from "@nodefony/user";
import type { IUser } from "@nodefony/user";
import { Firewall } from "../../nodefony/service/firewall";
import { SessionRealtimeAuthenticator } from "../../nodefony/src/authenticator/SessionRealtimeAuthenticator";
import { UserRealtimeToken } from "../../nodefony/src/realtime/UserRealtimeToken";
import {
  buildFrameAuthorizer,
  type IZoneMatcher,
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
 *  - SessionRealtimeAuthenticator : transfère l'identité DÉJÀ résolue par le
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

describe("SessionRealtimeAuthenticator — lit l'ALS, 0 re-lecture", () => {
  const auth = new SessionRealtimeAuthenticator();

  it("name = session-realtime", () => {
    assert.equal(auth.name, "session-realtime");
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

describe("buildFrameAuthorizer — invariant api.request ≤ GET + canaux protégés", () => {
  // Zone matcher factice : data plane protégé, /open public (security:false),
  // tout le reste hors zone (null).
  const zones: IZoneMatcher = {
    matchPath: (p) => {
      if (p.startsWith("/nodefony/") && p.includes("/api"))
        return { security: true };
      if (p.startsWith("/open")) return { security: false };
      return null;
    },
  };
  const authorize = buildFrameAuthorizer(zones);
  const apiReq = (path: unknown) => ({
    method: "api.request",
    params: { path },
  });
  const sub = (channel: unknown) => ({
    method: "subscribe",
    params: { channel },
  });

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

  it("api.request hors zone (path public) + anonyme → AUTORISÉ", () => {
    assert.equal(authorize(apiReq("/public/thing"), ANON_TOKEN), true);
  });

  it("api.request zone publique (security:false) + anonyme → AUTORISÉ", () => {
    assert.equal(authorize(apiReq("/open/data"), ANON_TOKEN), true);
  });

  it("api.request params invalides (path absent/non-string) → AUTORISÉ (handler renverra -32602)", () => {
    assert.equal(authorize(apiReq(undefined), ANON_TOKEN), true);
    assert.equal(authorize(apiReq(42), ANON_TOKEN), true);
  });

  it("subscribe canal d'observabilité + anonyme → REFUS (syslog/orm/dashboard/realtime/node)", () => {
    for (const ch of [
      "syslog:stream",
      "orm:flow",
      "orm:health",
      "dashboard:supervision",
      "realtime:health",
      "node:stream",
      "debugbar:stats",
    ]) {
      assert.equal(authorize(sub(ch), ANON_TOKEN), false, ch);
    }
  });

  it("subscribe convention <module>:health / :stats + anonyme → REFUS", () => {
    assert.equal(authorize(sub("mymod:health"), ANON_TOKEN), false);
    assert.equal(authorize(sub("mymod:stats"), ANON_TOKEN), false);
  });

  it("subscribe canal d'observabilité + authentifié → AUTORISÉ", () => {
    assert.equal(authorize(sub("syslog:stream"), AUTH_TOKEN), true);
  });

  it("subscribe canal applicatif public + anonyme → AUTORISÉ", () => {
    assert.equal(authorize(sub("chat:room1"), ANON_TOKEN), true);
    assert.equal(authorize(sub("presence:lobby"), ANON_TOKEN), true);
  });

  it("subscribe params invalides (channel absent) → AUTORISÉ (no-op côté controller)", () => {
    assert.equal(authorize(sub(undefined), ANON_TOKEN), true);
  });

  it("autres méthodes (ping/unsubscribe/inconnu) → AUTORISÉ (hors périmètre du verrou)", () => {
    assert.equal(authorize({ method: "ping" }, ANON_TOKEN), true);
    assert.equal(
      authorize(
        { method: "unsubscribe", params: { channel: "syslog:stream" } },
        ANON_TOKEN,
      ),
      true,
    );
    assert.equal(authorize({ method: "kernel:ping" }, ANON_TOKEN), true);
    assert.equal(authorize({}, ANON_TOKEN), true);
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
}

function bootFirewall(
  areas: Record<string, unknown>,
  withRealtimeService = true,
): CapturedRealtime {
  const container = new Container();
  const captured: CapturedRealtime = { useAuth: [], frameAuthorizer: null };
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
  let onBoot: (() => void) | null = null;
  // kernel mock : `Service` ctor fait `this.kernel = container.get("kernel")` puis
  // `this.kernel?.once("onBoot", …)`. On capture le callback pour le déclencher.
  container.set("kernel", {
    container,
    once: (event: string, cb: () => void) => {
      if (event === "onBoot") onBoot = cb;
    },
  });
  new Firewall({
    container,
    notificationsCenter: new Event(),
    options: { areas },
  } as unknown as Module);
  onBoot?.(); // déclenche #build → #wireRealtime
  return captured;
}

const ADMIN_PATTERN = "^/nodefony/[^/]+/api(/|$)";

describe("firewall.#wireRealtime — câblage du verrou au boot", () => {
  it("zone realtime+security → useAuthenticator(SessionRealtimeAuthenticator) + setFrameAuthorizer", () => {
    const c = bootFirewall({
      "nodefony-admin": {
        pattern: ADMIN_PATTERN,
        authenticators: ["session"],
        realtime: true,
      },
    });
    assert.equal(c.useAuth.length, 1);
    assert.equal(c.useAuth[0]!.auth.name, "session-realtime");
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

  it("zone HTTP-seule (realtime non déclaré) → AUCUN câblage WS", () => {
    const c = bootFirewall({
      "http-only": { pattern: "^/admin", authenticators: ["session"] },
    });
    assert.equal(c.useAuth.length, 0);
    assert.equal(c.frameAuthorizer, null);
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
});
