import assert from "node:assert/strict";
import { Container } from "nodefony";
import type { Module } from "nodefony";
import AuditService from "../../nodefony/service/auditService";
import { AuthFlow } from "../../nodefony/service/authFlow";
import { Authorization } from "../../nodefony/service/authorization";
import type { IToken } from "../../nodefony/contracts/IToken";

/**
 * Câblage des émetteurs (P6.14 — Lot 2) : prouve que `AuthFlow` et `Authorization`
 * journalisent RÉELLEMENT via le container partagé (résolution `auditService` →
 * `recordAudit` → store), exactement comme en production. Couvre login
 * succès/échec/throttle, logout, et refus d'autorisation.
 */

// Mock kernel : accumule les onBoot (plusieurs services dans le MÊME container).
function makeKernel(container: Container): { boot: () => void } {
  const bootCbs: Array<() => void> = [];
  const kernel = {
    container,
    once(ev: string, cb: () => void) {
      if (ev === "onBoot") bootCbs.push(cb);
    },
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
    notificationsCenter: false,
    options,
  } as unknown as Module;
}

// AuditService réel (activé) + un émetteur, container partagé. `container.set`
// sous "auditService" simule Module.addService (clé = serviceName) en prod.
function setup<T>(
  Ctor: new (m: Module) => T,
  options: Record<string, unknown> = {},
): { container: Container; audit: AuditService; emitter: T } {
  const container = new Container();
  const { boot } = makeKernel(container);
  const audit = new AuditService(
    makeModule(container, { audit: { enabled: true } }),
  );
  container.set("auditService", audit);
  const emitter = new Ctor(makeModule(container, options));
  boot();
  return { container, audit, emitter };
}

function fakeContext(): Record<string, unknown> {
  return {
    remoteAddress: "203.0.113.7",
    requestId: "req-42",
    getUserAgent: () => "vitest",
    request: { headers: { "user-agent": "vitest", cookie: "sid=x" } },
    user: null,
    session: null,
  };
}

// Session minimale exploitée par #openSession (login) et logout.
function fakeSession(id: string): Record<string, unknown> {
  return {
    id,
    user: "alice",
    status: "active",
    regenerateId() {
      (this as { id: string }).id = `${id}-regen`;
    },
    storage: { destroy: async () => undefined },
    save: async () => undefined,
    destroy: async () => undefined,
  };
}

type LoginArgs = Parameters<AuthFlow["login"]>;

// ════════════════════════════════════════════════════════════════════════════
describe("AuthFlow — émission audit", () => {
  it("login.failure sur identifiants malformés (mot de passe vide)", async () => {
    const { audit, emitter } = setup(AuthFlow);
    const ctx = fakeContext() as unknown as LoginArgs[0];
    await assert.rejects(() => emitter.login(ctx, "alice", ""));
    const { events, total } = await audit.query();
    assert.equal(total, 1);
    assert.equal(events[0]!.category, "auth");
    assert.equal(events[0]!.action, "login.failure");
    assert.equal(events[0]!.outcome, "failure");
    assert.equal(events[0]!.actor, "alice");
    assert.equal(events[0]!.reason, "invalid_credentials");
    assert.equal(events[0]!.ip, "203.0.113.7");
    assert.equal(events[0]!.requestId, "req-42");
    assert.equal(events[0]!.flags?.hasCookie, true);
  });

  it("login.failure sur identité inconnue", async () => {
    const { container, audit, emitter } = setup(AuthFlow);
    container.set("users", { authenticate: async () => null });
    const ctx = fakeContext() as unknown as LoginArgs[0];
    await assert.rejects(() => emitter.login(ctx, "ghost", "pw"));
    const { events } = await audit.query();
    assert.equal(events[0]!.action, "login.failure");
    assert.equal(events[0]!.actor, "ghost");
  });

  it("login.success émet avec l'identité résolue", async () => {
    const { container, audit, emitter } = setup(AuthFlow);
    container.set("users", {
      authenticate: async () => ({
        id: "1",
        identifier: "alice",
        roles: ["ROLE_USER"],
      }),
    });
    const ctx = fakeContext() as unknown as Record<string, unknown>;
    ctx.session = fakeSession("sess-1");
    await emitter.login(ctx as unknown as LoginArgs[0], "alice", "pw");
    const { events } = await audit.query();
    assert.equal(events[0]!.action, "login.success");
    assert.equal(events[0]!.outcome, "success");
    assert.equal(events[0]!.actor, "alice");
  });

  it("logout émet session/logout avec l'acteur pré-destruction", async () => {
    const { audit, emitter } = setup(AuthFlow);
    const ctx = fakeContext() as unknown as Record<string, unknown>;
    ctx.session = {
      status: "active",
      user: "alice",
      destroy: async () => undefined,
    };
    const ok = await emitter.logout(ctx as unknown as LoginArgs[0]);
    assert.equal(ok, true);
    const { events } = await audit.query();
    assert.equal(events[0]!.category, "session");
    assert.equal(events[0]!.action, "logout");
    assert.equal(events[0]!.actor, "alice");
  });

  it("logout sans session active n'émet rien", async () => {
    const { audit, emitter } = setup(AuthFlow);
    const ctx = fakeContext() as unknown as LoginArgs[0];
    const ok = await emitter.logout(ctx);
    assert.equal(ok, false);
    assert.equal((await audit.query()).total, 0);
  });
});

describe("Authorization — émission audit", () => {
  it("access.denied émet sur refus (aucun voter compétent → Zero Trust)", async () => {
    const { audit, emitter } = setup(Authorization);
    const token = {
      getUserIdentifier: () => "mallory",
    } as unknown as IToken;
    const granted = await emitter.decide(token, "SECRET_OP");
    assert.equal(granted, false);
    const { events } = await audit.query();
    assert.equal(events[0]!.category, "authz");
    assert.equal(events[0]!.action, "access.denied");
    assert.equal(events[0]!.outcome, "denied");
    assert.equal(events[0]!.actor, "mallory");
    assert.equal(events[0]!.resource, "SECRET_OP");
  });
});

describe("Audit désactivé — aucun émetteur ne journalise", () => {
  it("login échoué n'émet rien si audit.enabled=false", async () => {
    const container = new Container();
    const { boot } = makeKernel(container);
    const audit = new AuditService(
      makeModule(container, { audit: { enabled: false } }),
    );
    container.set("auditService", audit);
    const flow = new AuthFlow(makeModule(container, {}));
    boot();
    const ctx = fakeContext() as unknown as LoginArgs[0];
    await assert.rejects(() => flow.login(ctx, "alice", ""));
    assert.equal((await audit.query()).total, 0);
  });
});
