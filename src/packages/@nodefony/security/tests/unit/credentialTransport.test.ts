import assert from "node:assert/strict";
import { Container, Event, INSECURE_TRANSPORT_MESSAGE } from "nodefony";
import type { Module } from "nodefony";
import type { IUser } from "@nodefony/user";
import type { ContextType } from "@nodefony/http";
import { Firewall } from "../../nodefony/service/firewall";
import { AuthFlow } from "../../nodefony/service/authFlow";
import { TokenService } from "../../nodefony/service/tokenService";
import { SecuredArea } from "../../nodefony/src/SecuredArea";
import {
  CredentialTransportPolicy,
  shouldEnforceCredentialTransport,
} from "../../nodefony/src/transport/CredentialTransportPolicy";
import { InsecureTransportError } from "../../nodefony/errors/InsecureTransportError";
import type { ISecurityConfigInput } from "../../nodefony/config/defineModuleConfig";
import type { ISecurityAreaConfig } from "../../nodefony/config/defineModuleConfig";

/**
 * Un mot de passe (ou un code de second facteur) reçu en clair en production
 * est refusé AVANT toute vérification, sur les QUATRE portes qui en reçoivent :
 * formulaire de session, second facteur, Basic, émission de jeton.
 *
 * Ce qui est tenu ici, et qu'aucun autre banc ne voit :
 *  - la décision se prend sur le scheme EFFECTIF (`https` derrière un proxy de
 *    confiance), jamais sur le transport ;
 *  - le refus précède le throttle ET le verifier : un secret parti en clair ne
 *    coûte aucun hash, et ne compte pas comme un échec de mot de passe ;
 *  - le firewall ne pose AUCUN défi sur ce refus (un `Basic` ferait renvoyer
 *    le mot de passe par le même canal) ;
 *  - la politique est posée par le firewall au boot, en production seulement,
 *    sans aucune config — et l'échappement doit être ÉCRIT.
 */

const fakeUser = (identifier: string): IUser => ({
  id: `u-${identifier}`,
  identifier,
  roles: ["ROLE_USER"],
  hasRole: () => false,
  isActive: () => true,
  isLocked: () => false,
});

/** Source d'identité qui COMPTE ses vérifications (alice/pw seul valide). */
function countingUsers() {
  const calls = { authenticate: 0 };
  return {
    calls,
    users: {
      async authenticate(id: string, pw: string): Promise<IUser | null> {
        calls.authenticate += 1;
        return id === "alice" && pw === "pw" ? fakeUser("alice") : null;
      },
      async loadUserByIdentifier(id: string): Promise<IUser> {
        if (id === "alice") return fakeUser("alice");
        throw new Error("not found");
      },
    },
  };
}

/** Journal d'audit capturé (le service `auditService` est couplé par nom). */
function captureAudit(container: Container): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  container.set("auditService", {
    record: (e: Record<string, unknown>) => {
      events.push(e);
    },
  });
  return events;
}

const enforcing = () => new CredentialTransportPolicy({ enforce: true });

describe("CredentialTransportPolicy — la décision", () => {
  it("refuse seulement en production, et l'échappement doit être écrit", () => {
    assert.equal(shouldEnforceCredentialTransport("production", false), true);
    assert.equal(shouldEnforceCredentialTransport("production", true), false);
    assert.equal(shouldEnforceCredentialTransport("development", false), false);
    assert.equal(shouldEnforceCredentialTransport("test", false), false);
    assert.equal(shouldEnforceCredentialTransport(undefined, false), false);
  });

  it("laisse passer https et wss, refuse http, ws et un scheme absent (403)", () => {
    const policy = enforcing();
    policy.assert({ scheme: "https" }, "login");
    policy.assert({ scheme: "wss" }, "basic");
    for (const context of [{ scheme: "http" }, { scheme: "ws" }, {}]) {
      assert.throws(
        () => policy.assert(context, "login"),
        (e: unknown) =>
          e instanceof InsecureTransportError &&
          e.code === 403 &&
          e.message === INSECURE_TRANSPORT_MESSAGE,
      );
    }
  });

  it("hors production, rien n'est refusé", () => {
    new CredentialTransportPolicy({ enforce: false }).assert(
      { scheme: "http" },
      "login",
    );
  });

  it("journalise le PREMIER refus en nommant trustProxy, puis se tait", () => {
    const logs: string[] = [];
    const policy = new CredentialTransportPolicy({
      enforce: true,
      log: (m) => logs.push(m),
    });
    assert.throws(() => policy.assert({ scheme: "http" }, "login"));
    assert.throws(() => policy.assert({ scheme: "http" }, "basic"));
    assert.equal(logs.length, 1);
    const [first = ""] = logs;
    assert.match(first, /trustProxy/);
    assert.match(first, /allowInsecureCredentials/);
    assert.match(first, /\(login\)/);
  });
});

// ─── Le firewall pose la politique au boot ────────────────────────────────────

function bootFirewall(
  options: ISecurityConfigInput,
  environment: string | undefined,
): { firewall: Firewall; container: Container } {
  const container = new Container();
  const bootCbs: Array<() => void> = [];
  container.set("kernel", {
    container,
    environment,
    once(ev: string, cb: () => void) {
      if (ev === "onBoot") bootCbs.push(cb);
    },
  });
  const firewall = new Firewall({
    container,
    notificationsCenter: new Event(),
    options,
  } as unknown as Module);
  container.set("firewall", firewall);
  bootCbs.forEach((cb) => cb());
  return { firewall, container };
}

const BASIC_AREA: ISecurityAreaConfig = {
  pattern: "^/api",
  security: true,
  stateless: true,
  mode: "first",
  roles: [],
  authenticators: ["userpassword"],
} as unknown as ISecurityAreaConfig;

function basicContext(scheme: string): {
  context: ContextType;
  headers: Record<string, string>;
} {
  const headers: Record<string, string> = {};
  const context = {
    scheme,
    request: {
      headers: {
        authorization: `Basic ${Buffer.from("alice:pw").toString("base64")}`,
      },
      url: new URL(`${scheme}://localhost/api/x`),
    },
    security: new SecuredArea("api", BASIC_AREA),
    response: {
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
    },
  } as unknown as ContextType;
  return { context, headers };
}

describe("Firewall — politique posée au boot", () => {
  it("production SANS config → la politique refuse", () => {
    const { container } = bootFirewall({}, "production");
    const policy = container.get<CredentialTransportPolicy>(
      "credentialTransport",
    );
    assert.ok(policy);
    assert.equal(policy.enforce, true);
  });

  it("développement → posée mais inerte", () => {
    const { container } = bootFirewall({}, "development");
    assert.equal(
      container.get<CredentialTransportPolicy>("credentialTransport")?.enforce,
      false,
    );
  });

  it("production + allowInsecureCredentials → inerte", () => {
    const { container } = bootFirewall(
      { allowInsecureCredentials: true },
      "production",
    );
    assert.equal(
      container.get<CredentialTransportPolicy>("credentialTransport")?.enforce,
      false,
    );
  });
});

describe("Porte Basic — refus avant décodage, sans défi", () => {
  function setup(environment: string) {
    const { firewall, container } = bootFirewall(
      { areas: { api: BASIC_AREA } },
      environment,
    );
    const { users, calls } = countingUsers();
    container.set("users", users);
    const audit = captureAudit(container);
    return { firewall, calls, audit };
  }

  it("production, http → 403, verifier jamais appelé, AUCUN WWW-Authenticate", async () => {
    const { firewall, calls, audit } = setup("production");
    const { context, headers } = basicContext("http");
    await assert.rejects(
      () => firewall.handleSecurity(context),
      (e: unknown) => e instanceof InsecureTransportError && e.code === 403,
    );
    assert.equal(calls.authenticate, 0);
    assert.equal(headers["WWW-Authenticate"], undefined);
    assert.ok(audit.some((e) => e.reason === "insecure_transport"));
  });

  it("production, https (proxy de confiance ou TLS) → authentifié", async () => {
    const { firewall, calls } = setup("production");
    const { context } = basicContext("https");
    await firewall.handleSecurity(context);
    assert.equal(calls.authenticate, 1);
  });

  it("développement, http → authentifié (aucun refus hors production)", async () => {
    const { firewall, calls } = setup("development");
    const { context } = basicContext("http");
    await firewall.handleSecurity(context);
    assert.equal(calls.authenticate, 1);
  });
});

// ─── Formulaire de session et second facteur ──────────────────────────────────

function sessionStub() {
  const bag = new Map<string, unknown>();
  return {
    id: "sess-1",
    user: null as string | null,
    status: "active",
    get: (k: string) => bag.get(k) ?? null,
    set: (k: string, v: unknown) => {
      bag.set(k, v);
      return v;
    },
    save(identifier?: string) {
      if (typeof identifier === "string") this.user = identifier;
      return Promise.resolve();
    },
    regenerateId() {},
    storage: { destroy: async () => undefined },
    setMetaBag() {},
  };
}

function flowSetup(policy: CredentialTransportPolicy | null) {
  const container = new Container();
  container.set("kernel", { container, once() {} });
  const { users, calls } = countingUsers();
  container.set("users", users);
  const totpCalls = { verify: 0 };
  container.set("totp", {
    isEnabled: () => true,
    isEnabledFor: async () => false,
    verifyLogin: async () => {
      totpCalls.verify += 1;
      return { ok: true, method: "totp" as const };
    },
  });
  if (policy !== null) container.set("credentialTransport", policy);
  const audit = captureAudit(container);
  const flow = new AuthFlow({
    container,
    notificationsCenter: false,
    options: {},
  } as unknown as Module);
  return { flow, calls, totpCalls, audit, container };
}

type FlowCtx = Parameters<AuthFlow["login"]>[0];
function flowContext(scheme: string, pending: string | null = null): FlowCtx {
  const session = sessionStub();
  if (pending !== null) session.set("mfa:pending", pending);
  return {
    scheme,
    requestId: "req-1",
    getRemoteAddress: () => "203.0.113.7",
    getUserAgent: () => "vitest",
    request: { headers: {} },
    user: null,
    session,
  } as unknown as FlowCtx;
}

describe("AuthFlow — formulaire et second facteur", () => {
  it("login en http → 403 AVANT le verifier, audité insecure_transport", async () => {
    const { flow, calls, audit } = flowSetup(enforcing());
    await assert.rejects(
      () => flow.login(flowContext("http"), "alice", "pw"),
      InsecureTransportError,
    );
    assert.equal(calls.authenticate, 0);
    const event = audit.find((e) => e.reason === "insecure_transport");
    assert.ok(event);
    assert.equal(event.actor, "alice");
    assert.equal(event.action, "login.failure");
  });

  it("login en https → authentifié", async () => {
    const { flow } = flowSetup(enforcing());
    const outcome = await flow.login(flowContext("https"), "alice", "pw");
    assert.equal(outcome.status, "authenticated");
  });

  it("second facteur en http → 403, code jamais vérifié", async () => {
    const { flow, totpCalls } = flowSetup(enforcing());
    await assert.rejects(
      () => flow.completeMfaLogin(flowContext("http", "alice"), "123456"),
      InsecureTransportError,
    );
    assert.equal(totpCalls.verify, 0);
  });

  it("politique posée APRÈS un premier appel → appliquée quand même (pas de null figé)", async () => {
    const { flow, container } = flowSetup(null);
    await flow.login(flowContext("http"), "alice", "pw"); // pas encore de politique
    container.set("credentialTransport", enforcing());
    await assert.rejects(
      () => flow.login(flowContext("http"), "alice", "pw"),
      InsecureTransportError,
    );
  });
});

// ─── Émission de jeton ────────────────────────────────────────────────────────

describe("TokenService — émission par mot de passe", () => {
  function tokenSetup() {
    const container = new Container();
    const handlers: Record<string, () => void> = {};
    container.set("kernel", {
      container,
      runProfile: { servers: false },
      once(ev: string, cb: () => void) {
        handlers[ev] = cb;
      },
      registerStoreResolution() {},
    });
    const { users, calls } = countingUsers();
    container.set("users", users);
    container.set("credentialTransport", enforcing());
    const audit = captureAudit(container);
    const svc = new TokenService({
      container,
      notificationsCenter: false,
      options: {
        jwt: {
          enabled: true,
          issuer: "https://test.nf",
          audiences: ["nf-api"],
        },
        tokenStore: { store: "memory", gcIntervalS: 0 },
      },
    } as unknown as Module);
    handlers["onBoot"]?.();
    return { svc, calls, audit };
  }

  it("requête en http → 403 AVANT le verifier, audité avec l'IP", async () => {
    const { svc, calls, audit } = tokenSetup();
    const context = {
      scheme: "http",
      requestId: "req-9",
      getRemoteAddress: () => "203.0.113.9",
      request: { headers: {} },
    };
    await assert.rejects(
      () =>
        svc.issueForCredentials("alice", "pw", undefined, undefined, context),
      InsecureTransportError,
    );
    assert.equal(calls.authenticate, 0);
    const event = audit.find((e) => e.reason === "insecure_transport");
    assert.ok(event);
    assert.equal(event.actor, "alice");
  });

  it("requête en https → jetons émis", async () => {
    const { svc } = tokenSetup();
    const tokens = await svc.issueForCredentials(
      "alice",
      "pw",
      undefined,
      undefined,
      { scheme: "https" },
    );
    assert.ok(tokens.access_token);
  });

  it("sans requête (CLI, appel programmatique) → aucun transport à juger", async () => {
    const { svc } = tokenSetup();
    const tokens = await svc.issueForCredentials("alice", "pw");
    assert.ok(tokens.access_token);
  });
});
