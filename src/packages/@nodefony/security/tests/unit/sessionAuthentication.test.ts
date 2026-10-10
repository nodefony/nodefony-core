import assert from "node:assert/strict";
import {
  Container,
  RequestContext,
  readSessionAuthentication,
  SESSION_AMR_KEY,
  SESSION_AUTH_AT_KEY,
} from "nodefony";
import type { Module } from "nodefony";
import { AuthFlow } from "../../nodefony/service/authFlow";
import { amrForFactor } from "../../nodefony/src/sessionAuthentication";

/**
 * La session retient QUAND et PAR QUELLES MÉTHODES elle a été ouverte
 * (ADR-0015, décision 7) — `metaBag.authAt` + `metaBag.amr` (RFC 8176), posés
 * par chaque chemin d'ouverture d'AuthFlow.
 */

function fakeUser(identifier = "alice") {
  return {
    id: "1",
    identifier,
    roles: ["ROLE_USER"],
    isLocked: () => false,
    isActive: () => true,
  };
}

function fakeSession() {
  const bag = new Map<string, unknown>();
  const meta = new Map<string, unknown>();
  return {
    id: "sess-1",
    user: null as string | null,
    status: "active",
    get: (k: string) => bag.get(k) ?? null,
    set: (k: string, v: unknown) => (bag.set(k, v), v),
    save(identifier?: string) {
      if (typeof identifier === "string") this.user = identifier;
      return Promise.resolve();
    },
    regenerateId() {},
    storage: { destroy: async () => undefined },
    getMetaBag: (k: string) => meta.get(k),
    setMetaBag: (k: string, v: unknown) => void meta.set(k, v),
  };
}

function setup(withTotp: boolean) {
  const container = new Container();
  container.set("kernel", { container, once() {} });
  container.set("users", {
    authenticate: async (id: string, pw: string) =>
      id === "alice" && pw === "pw" ? fakeUser(id) : null,
    loadUserByIdentifier: async (id: string) => fakeUser(id),
  });
  container.set("sessions", { start: async () => fakeSession() });
  if (withTotp) {
    container.set("totp", {
      isEnabled: () => true,
      isEnabledFor: async () => true,
      verifyLogin: async (_u: string, code: string) =>
        code === "123456"
          ? { ok: true, method: "totp" as const }
          : code === "recovery-1"
            ? { ok: true, method: "recovery" as const }
            : { ok: false },
    });
  }
  const flow = new AuthFlow({
    container,
    notificationsCenter: false,
    options: {},
  } as unknown as Module);
  const session = fakeSession();
  const ctx = {
    requestId: "req-1",
    request: { headers: {} },
    user: null as string | null,
    session,
  } as unknown as Parameters<AuthFlow["login"]>[0];
  return { flow, ctx, session };
}

// login/establishSessionFor posent l'utilisateur dans l'ALS : une bulle par test.
function inRequest<T>(fn: () => Promise<T>): Promise<T> {
  return RequestContext.run({ requestId: "req-1" }, fn);
}

describe("amrForFactor — facteur → RFC 8176", () => {
  it("mot de passe, second facteur, passkey", () => {
    assert.deepEqual(amrForFactor("password"), ["pwd"]);
    assert.deepEqual(amrForFactor("totp"), ["pwd", "otp"]);
    assert.deepEqual(amrForFactor("recovery"), ["pwd", "otp"]);
    assert.deepEqual(amrForFactor("webauthn"), ["pop"]);
  });

  it("facteur délégué ou inconnu → aucune méthode locale", () => {
    assert.deepEqual(amrForFactor("oauth"), []);
    assert.deepEqual(amrForFactor("federated"), []);
    assert.deepEqual(amrForFactor("toString"), []);
    assert.deepEqual(amrForFactor("__proto__"), []);
  });

  it("les listes partagées sont gelées", () => {
    assert.ok(Object.isFrozen(amrForFactor("password")));
    assert.ok(Object.isFrozen(amrForFactor("oauth")));
  });
});

describe("readSessionAuthentication", () => {
  const withMeta = (authAt: unknown, amr: unknown) => ({
    getMetaBag: (k: string) =>
      k === SESSION_AUTH_AT_KEY ? authAt : k === SESSION_AMR_KEY ? amr : null,
  });

  it("rend l'heure et les méthodes", () => {
    assert.deepEqual(readSessionAuthentication(withMeta(1000, ["pwd"])), {
      at: 1000,
      amr: ["pwd"],
    });
  });

  it("session sans ces clés, ou altérée → null", () => {
    assert.equal(readSessionAuthentication(null), null);
    assert.equal(readSessionAuthentication(withMeta(undefined, ["pwd"])), null);
    assert.equal(readSessionAuthentication(withMeta(Number.NaN, [])), null);
    assert.equal(readSessionAuthentication(withMeta("1000", ["pwd"])), null);
    assert.equal(readSessionAuthentication(withMeta(1000, "pwd")), null);
    assert.equal(readSessionAuthentication(withMeta(1000, ["pwd", 1])), null);
  });
});

describe("AuthFlow — la session retient son authentification", () => {
  it("mot de passe → amr [pwd], authAt à l'heure du login", async () => {
    const { flow, ctx, session } = setup(false);
    const before = Date.now();
    await inRequest(() => flow.login(ctx, "alice", "pw"));
    const auth = readSessionAuthentication(session);
    assert.ok(auth);
    assert.deepEqual(auth.amr, ["pwd"]);
    assert.ok(auth.at >= before && auth.at <= Date.now());
  });

  it("défi second facteur en attente → rien n'est posé", async () => {
    const { flow, ctx, session } = setup(true);
    await inRequest(() => flow.login(ctx, "alice", "pw"));
    assert.equal(readSessionAuthentication(session), null);
  });

  it("second facteur TOTP → amr [pwd, otp]", async () => {
    const { flow, ctx, session } = setup(true);
    await inRequest(async () => {
      await flow.login(ctx, "alice", "pw");
      await flow.completeMfaLogin(ctx, "123456");
    });
    assert.deepEqual(readSessionAuthentication(session)?.amr, ["pwd", "otp"]);
  });

  it("code de récupération → amr [pwd, otp]", async () => {
    const { flow, ctx, session } = setup(true);
    await inRequest(async () => {
      await flow.login(ctx, "alice", "pw");
      await flow.completeMfaLogin(ctx, "recovery-1");
    });
    assert.deepEqual(readSessionAuthentication(session)?.amr, ["pwd", "otp"]);
  });

  it("passkey → amr [pop]", async () => {
    const { flow, ctx, session } = setup(false);
    await inRequest(() => flow.establishSessionFor(ctx, "alice", "webauthn"));
    assert.deepEqual(readSessionAuthentication(session)?.amr, ["pop"]);
  });

  it("fournisseur OAuth → amr vide, authAt posé", async () => {
    const { flow, ctx, session } = setup(false);
    await inRequest(() => flow.establishSessionFor(ctx, "alice", "oauth"));
    const auth = readSessionAuthentication(session);
    assert.ok(auth);
    assert.deepEqual(auth.amr, []);
  });
});
