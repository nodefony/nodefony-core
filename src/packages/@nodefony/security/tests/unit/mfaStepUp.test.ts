import assert from "node:assert/strict";
import { Container } from "nodefony";
import type { Module } from "nodefony";
import { UserNotFoundError } from "@nodefony/user";
import { AuthFlow } from "../../nodefony/service/authFlow";

/**
 * Step-up 2FA au login (P6.17). `AuthFlow.login` détecte le 2FA activé et renvoie
 * un défi `mfa_required` en posant un PENDING en session SANS établir l'identité
 * (`session.user` reste vide → Zero Trust 401 protège tout) ; `completeMfaLogin`
 * valide le 2ᵉ facteur, consomme le défi (usage unique) puis OUVRE la session.
 * Throttlé (anti brute-force du code). Logique pure : faux users/sessions/totp
 * injectés — le câblage HTTP est prouvé par le banc e2e.
 */

const PENDING = "mfa:pending";

function makeKernel(container: Container): void {
  container.set("kernel", {
    container,
    once() {},
  });
}

function makeModule(container: Container): Module {
  return {
    container,
    notificationsCenter: false,
    options: {},
  } as unknown as Module;
}

function fakeUser(identifier = "alice") {
  return {
    id: "1",
    identifier,
    roles: ["ROLE_USER"],
    isLocked: () => false,
    isActive: () => true,
  };
}

// Source d'identité : password OK pour alice/pw ; introuvable sinon.
function fakeUsers() {
  return {
    authenticate: async (id: string, pw: string) =>
      id === "alice" && pw === "pw" ? fakeUser(id) : null,
    loadUserByIdentifier: async (id: string) => {
      if (id === "alice") return fakeUser(id);
      throw new UserNotFoundError(id);
    },
  };
}

// Session BFF minimale : sac get/set + save(identifier) + anti-fixation.
function fakeSession(id = "sess-1") {
  const bag = new Map<string, unknown>();
  return {
    id,
    user: null as string | null,
    status: "active",
    get(k: string) {
      return bag.get(k) ?? null;
    },
    set(k: string, v: unknown) {
      bag.set(k, v);
      return v;
    },
    save(identifier?: string) {
      if (typeof identifier === "string") this.user = identifier;
      return Promise.resolve();
    },
    regenerateId() {
      this.id = `${id}-regen`;
    },
    storage: { destroy: async () => undefined },
    setMetaBag() {},
  };
}

function fakeContext(session: ReturnType<typeof fakeSession> | null) {
  return {
    requestId: "req-1",
    getRemoteAddress: () => "203.0.113.7",
    getUserAgent: () => "vitest",
    request: { headers: { "user-agent": "vitest" } },
    user: null as string | null,
    session,
  };
}

// Faux service 2FA (couplage par nom "totp"). enabledFor cible qui a le 2FA ;
// accept = le seul code valide.
function fakeTotp(opts: { enabledFor?: string; accept?: string } = {}) {
  return {
    isEnabled: () => true,
    isEnabledFor: async (userId: string) =>
      userId === (opts.enabledFor ?? "alice"),
    verifyLogin: async (_userId: string, code: string) =>
      code === (opts.accept ?? "123456")
        ? { ok: true, method: "totp" as const }
        : { ok: false },
  };
}

function setup(totp?: ReturnType<typeof fakeTotp> | null) {
  const container = new Container();
  makeKernel(container);
  container.set("users", fakeUsers());
  container.set("sessions", { start: async () => fakeSession() });
  if (totp !== null) {
    container.set("totp", totp ?? fakeTotp());
  }
  const flow = new AuthFlow(makeModule(container));
  return { container, flow };
}

// Forme libre pour appeler login/completeMfaLogin avec un faux contexte.
type Ctx = ReturnType<typeof fakeContext>;
function asCtx(ctx: Ctx): Parameters<AuthFlow["login"]>[0] {
  return ctx as unknown as Parameters<AuthFlow["login"]>[0];
}

describe("AuthFlow step-up 2FA — login", () => {
  it("2FA non activé pour l'user → authenticated, session ouverte", async () => {
    const { flow } = setup(fakeTotp({ enabledFor: "personne" }));
    const ctx = fakeContext(fakeSession());
    const outcome = await flow.login(asCtx(ctx), "alice", "pw");
    assert.equal(outcome.status, "authenticated");
    assert.equal(
      outcome.status === "authenticated" && outcome.user.username,
      "alice",
    );
    assert.equal(ctx.session!.user, "alice");
    assert.equal(ctx.user, "alice");
  });

  it("service totp absent → authenticated (aucun coût 2FA)", async () => {
    const { flow } = setup(null);
    const ctx = fakeContext(fakeSession());
    const outcome = await flow.login(asCtx(ctx), "alice", "pw");
    assert.equal(outcome.status, "authenticated");
  });

  it("2FA activé → mfa_required, PENDING posé, session.user PAS posée", async () => {
    const { flow } = setup();
    const ctx = fakeContext(fakeSession());
    const outcome = await flow.login(asCtx(ctx), "alice", "pw");
    assert.equal(outcome.status, "mfa_required");
    assert.deepEqual(
      outcome.status === "mfa_required" ? outcome.methods : null,
      ["totp"],
    );
    assert.equal(ctx.session!.get(PENDING), "alice"); // défi en attente
    assert.equal(ctx.session!.user, null); // identité PAS établie
    assert.equal(ctx.user, null);
  });

  it("mauvais mot de passe → 401 (le 2FA n'est jamais consulté)", async () => {
    const { flow } = setup();
    const ctx = fakeContext(fakeSession());
    await assert.rejects(() => flow.login(asCtx(ctx), "alice", "WRONG"));
    assert.equal(ctx.session!.get(PENDING), null);
  });
});

describe("AuthFlow step-up 2FA — completeMfaLogin", () => {
  async function pending() {
    const { flow, container } = setup();
    const ctx = fakeContext(fakeSession());
    await flow.login(asCtx(ctx), "alice", "pw"); // pose le PENDING
    return { flow, container, ctx };
  }

  it("bon code → session ouverte (identité établie), PENDING consommé", async () => {
    const { flow, ctx } = await pending();
    const user = await flow.completeMfaLogin(asCtx(ctx), "123456");
    assert.equal(user.username, "alice");
    assert.equal(ctx.session!.user, "alice"); // session établie
    assert.equal(ctx.session!.get(PENDING), null); // défi consommé
  });

  it("mauvais code → 401, session NON ouverte (défi conservé pour retry)", async () => {
    const { flow, ctx } = await pending();
    await assert.rejects(() => flow.completeMfaLogin(asCtx(ctx), "000000"));
    assert.equal(ctx.session!.user, null);
    assert.equal(ctx.session!.get(PENDING), "alice");
  });

  it("aucun défi en cours (pas de login préalable) → 401", async () => {
    const { flow } = setup();
    const ctx = fakeContext(fakeSession());
    await assert.rejects(() => flow.completeMfaLogin(asCtx(ctx), "123456"));
  });

  it("code vide → 401", async () => {
    const { flow, ctx } = await pending();
    await assert.rejects(() => flow.completeMfaLogin(asCtx(ctx), ""));
  });

  it("anti brute-force : après un échec, le throttler bloque (429)", async () => {
    const container = new Container();
    makeKernel(container);
    container.set("users", fakeUsers());
    container.set("sessions", { start: async () => fakeSession() });
    container.set("totp", fakeTotp());
    let blocked = false;
    container.set("loginThrottler", {
      check: () => (blocked ? 30 : 0),
      recordFailure: () => {
        blocked = true;
      },
      recordSuccess: () => {
        blocked = false;
      },
    });
    const flow = new AuthFlow(makeModule(container));
    const ctx = fakeContext(fakeSession());
    await flow.login(asCtx(ctx), "alice", "pw");
    await assert.rejects(() => flow.completeMfaLogin(asCtx(ctx), "000000")); // échec → bloque
    await assert.rejects(
      () => flow.completeMfaLogin(asCtx(ctx), "123456"), // bon code mais bloqué
      (e: unknown) => (e as { code?: number }).code === 429,
    );
  });
});
