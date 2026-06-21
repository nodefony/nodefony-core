import assert from "node:assert/strict";
import {
  createUserAdminApi,
  toUserSummary,
  type IUserSummary,
  type IUserRevokedEvent,
} from "../../nodefony/src/admin/UserAdminApi";
import { BaseUser } from "../../nodefony/src/BaseUser";
import type { IAdminApi, IAdminRequest } from "nodefony";

// ── fabriques d'utilisateurs ─────────────────────────────────────────────────
function admin(id: string, identifier: string, enabled = true): BaseUser {
  return new BaseUser({
    id,
    identifier,
    roles: ["ROLE_NODEFONY_ADMIN"],
    enabled,
  });
}
function member(
  id: string,
  identifier: string,
  roles: string[] = [],
): BaseUser {
  return new BaseUser({ id, identifier, roles });
}

// ── faux service "users" (Map de BaseUser) — on teste les HANDLERS, pas UserService ──
function makeUsers(seed: BaseUser[]) {
  const map = new Map<string, BaseUser>(seed.map((u) => [u.id, u]));
  return {
    find: async () => [...map.values()],
    findById: async (id: string) => map.get(id) ?? null,
    findByIdentifier: async (idf: string) =>
      [...map.values()].find((u) => u.identifier === idf) ?? null,
    count: async () => map.size,
    createUser: async (input: {
      identifier: string;
      plainPassword?: string | null;
      roles?: string[];
    }) => {
      const u = new BaseUser({
        id: `id-${input.identifier}`,
        identifier: input.identifier,
        roles: input.roles ?? [],
        password: input.plainPassword ? `hash:${input.plainPassword}` : null,
      });
      map.set(u.id, u);
      return u;
    },
    updateOne: async (
      criteria: { id: string },
      patch: { roles?: string[]; enabled?: boolean; locked?: boolean },
    ) => {
      const u = map.get(criteria.id);
      if (!u) return null;
      if (patch.roles) u.roles = patch.roles;
      if (typeof patch.enabled === "boolean")
        patch.enabled ? u.enable() : u.disable();
      if (typeof patch.locked === "boolean")
        patch.locked ? u.lock() : u.unlock();
      return u;
    },
    changePassword: async (id: string, plain: string) => {
      const u = map.get(id);
      if (!u) return null;
      u.setPassword(`hash:${plain}`);
      return u;
    },
    delete: async (criteria: { id: string }) =>
      map.delete(criteria.id) ? 1 : 0,
  };
}

type AuditEvent = {
  action: string;
  actor: string | null;
  resource?: string | null;
};

type FiredEvent = { name: string; payload: unknown };

function container(
  users: ReturnType<typeof makeUsers>,
  sink?: { record: (e: AuditEvent) => void },
  fired?: FiredEvent[],
): Parameters<typeof createUserAdminApi>[0] {
  const kernel = fired
    ? {
        fire: (name: string, payload: unknown) => fired.push({ name, payload }),
      }
    : undefined;
  return {
    get: (n: string) =>
      n === "users"
        ? users
        : n === "auditService"
          ? sink
          : n === "kernel"
            ? kernel
            : undefined,
  } as unknown as Parameters<typeof createUserAdminApi>[0];
}

function endpoint(api: IAdminApi, method: string, path: string) {
  const ep = api
    .adminEndpoints()
    .find((e) => (e.method ?? "GET") === method && e.path === path);
  if (!ep) throw new Error(`no endpoint ${method} ${path}`);
  return ep.handler;
}

/** Normalise toute réponse de handler en `{ status, body }` (200 si donnée nue). */
async function call(
  api: IAdminApi,
  method: string,
  path: string,
  partial: Partial<IAdminRequest>,
): Promise<{ status: number; body: unknown }> {
  const request = {
    params: {},
    query: {},
    body: null,
    user: null,
    roles: [],
    ...partial,
  } as IAdminRequest;
  const r = await endpoint(api, method, path)(request);
  if (r && typeof r === "object" && "status" in r && "body" in r) {
    return r as { status: number; body: unknown };
  }
  return { status: 200, body: r };
}

// ── DTO redacté (fonction pure) ──────────────────────────────────────────────
describe("UserAdminApi — toUserSummary (redaction)", () => {
  const u = new BaseUser({
    id: "u1",
    identifier: "alice@example.com",
    roles: ["ROLE_USER", "ROLE_ADMIN"],
    password: "HASH_SECRET_VALUE",
    enabled: true,
    locked: false,
    currentRole: "ROLE_USER",
    socialProviders: [
      {
        provider: "google",
        providerId: "g-123",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    ],
    metadata: { internalNote: "METADATA_SECRET" },
  });
  const s = toUserSummary(u);

  it("n'expose JAMAIS password ni metadata", () => {
    assert.ok(!("password" in s));
    assert.ok(!("metadata" in s));
  });

  it("le JSON sérialisé ne fuit ni le hash ni la metadata", () => {
    const json = JSON.stringify(s);
    assert.ok(!json.includes("HASH_SECRET_VALUE"));
    assert.ok(!json.includes("METADATA_SECRET"));
  });

  it("expose les champs sûrs + socialProviders SANS jeton", () => {
    assert.equal(s.identifier, "alice@example.com");
    assert.deepEqual(s.roles, ["ROLE_USER", "ROLE_ADMIN"]);
    assert.equal(s.enabled, true);
    assert.equal(s.locked, false);
    assert.equal(s.currentRole, "ROLE_USER");
    assert.deepEqual(s.socialProviders, [
      {
        provider: "google",
        providerId: "g-123",
        createdAt: Date.parse("2026-01-01T00:00:00Z"),
      },
    ]);
    assert.equal(s.tenantId, null);
  });
});

// ── Garde-fous anti-lockout (le cœur sécu) ───────────────────────────────────
describe("UserAdminApi — garde-fous anti-lockout", () => {
  it("PATCH : un admin ne peut pas retirer son PROPRE ROLE_NODEFONY_ADMIN", async () => {
    const api = createUserAdminApi(
      container(makeUsers([admin("a1", "admin@x"), admin("a2", "admin2@x")])),
    );
    const { status } = await call(api, "PATCH", "users/{id}", {
      params: { id: "a1" },
      user: { id: "a1", identifier: "admin@x" } as unknown,
      body: { roles: ["ROLE_USER"] },
    });
    assert.equal(status, 409);
  });

  it("PATCH : refuse de déchoir le DERNIER admin actif", async () => {
    const api = createUserAdminApi(
      container(makeUsers([admin("a1", "admin@x"), member("u2", "u2@x")])),
    );
    const { status } = await call(api, "PATCH", "users/{id}", {
      params: { id: "a1" },
      user: { id: "super", identifier: "super@x" } as unknown,
      body: { roles: ["ROLE_USER"] },
    });
    assert.equal(status, 409);
  });

  it("PATCH : promotion d'un membre en admin réussit", async () => {
    const api = createUserAdminApi(
      container(makeUsers([admin("a1", "admin@x"), member("u2", "u2@x")])),
    );
    const { status, body } = await call(api, "PATCH", "users/{id}", {
      params: { id: "u2" },
      user: { id: "a1" } as unknown,
      body: { roles: ["ROLE_USER", "ROLE_NODEFONY_ADMIN"] },
    });
    assert.equal(status, 200);
    assert.ok((body as IUserSummary).roles.includes("ROLE_NODEFONY_ADMIN"));
  });

  it("DELETE : refuse l'auto-suppression", async () => {
    const api = createUserAdminApi(
      container(makeUsers([admin("a1", "admin@x"), admin("a2", "admin2@x")])),
    );
    const { status } = await call(api, "DELETE", "users/{id}", {
      params: { id: "a1" },
      user: { id: "a1" } as unknown,
    });
    assert.equal(status, 409);
  });

  it("DELETE : refuse de supprimer le dernier admin actif", async () => {
    const api = createUserAdminApi(
      container(makeUsers([admin("a1", "admin@x"), member("u2", "u2@x")])),
    );
    const { status } = await call(api, "DELETE", "users/{id}", {
      params: { id: "a1" },
      user: { id: "super" } as unknown,
    });
    assert.equal(status, 409);
  });

  it("DELETE : supprime un membre normal (non-self, non-dernier-admin)", async () => {
    const api = createUserAdminApi(
      container(makeUsers([admin("a1", "admin@x"), member("u2", "u2@x")])),
    );
    const { status, body } = await call(api, "DELETE", "users/{id}", {
      params: { id: "u2" },
      user: { id: "a1" } as unknown,
    });
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true });
  });
});

// ── CRUD + filtres + audit ───────────────────────────────────────────────────
describe("UserAdminApi — CRUD + audit", () => {
  it("POST : crée (201, DTO sans hash)", async () => {
    const api = createUserAdminApi(container(makeUsers([])));
    const { status, body } = await call(api, "POST", "users", {
      user: { id: "a1" } as unknown,
      body: { identifier: "new@x", plainPassword: "pw", roles: ["ROLE_USER"] },
    });
    assert.equal(status, 201);
    assert.equal((body as IUserSummary).identifier, "new@x");
    assert.ok(!("password" in (body as object)));
  });

  it("POST : 409 si l'identifiant existe déjà", async () => {
    const api = createUserAdminApi(
      container(makeUsers([member("u1", "dup@x")])),
    );
    const { status } = await call(api, "POST", "users", {
      user: { id: "a1" } as unknown,
      body: { identifier: "dup@x" },
    });
    assert.equal(status, 409);
  });

  it("POST : 400 si identifier vide", async () => {
    const api = createUserAdminApi(container(makeUsers([])));
    const { status } = await call(api, "POST", "users", {
      user: { id: "a1" } as unknown,
      body: { identifier: "   " },
    });
    assert.equal(status, 400);
  });

  it("GET users : filtre role + q, DTO sans hash", async () => {
    const users = makeUsers([
      admin("a1", "admin@x"),
      member("u2", "bob@x", ["ROLE_USER"]),
      member("u3", "carol@x", ["ROLE_USER"]),
    ]);
    const api = createUserAdminApi(container(users));
    const byRole = await call(api, "GET", "users", {
      query: { role: "ROLE_USER" },
    });
    assert.equal((byRole.body as { total: number }).total, 2);
    const byQ = await call(api, "GET", "users", { query: { q: "bob" } });
    const list = byQ.body as { items: IUserSummary[]; total: number };
    assert.equal(list.total, 1);
    assert.equal(list.items[0].identifier, "bob@x");
    assert.ok(!("password" in list.items[0]));
  });

  it("GET users/{id} : 404 si introuvable", async () => {
    const api = createUserAdminApi(container(makeUsers([])));
    const { status } = await call(api, "GET", "users/{id}", {
      params: { id: "nope" },
    });
    assert.equal(status, 404);
  });

  it("mutation auditée (acteur + action)", async () => {
    const events: AuditEvent[] = [];
    const api = createUserAdminApi(
      container(makeUsers([admin("a1", "admin@x"), member("u2", "bob@x")]), {
        record: (e) => events.push(e),
      }),
    );
    await call(api, "DELETE", "users/{id}", {
      params: { id: "u2" },
      user: { id: "a1", identifier: "admin@x" } as unknown,
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].action, "user.deleted");
    assert.equal(events[0].actor, "admin@x");
  });
});

// ── Cascade : émission de onUserRevoked (extensible webhooks, tenant-ready) ────
describe("UserAdminApi — émission onUserRevoked", () => {
  it("DELETE émet onUserRevoked { reason: deleted, tenantId: null }", async () => {
    const fired: FiredEvent[] = [];
    const api = createUserAdminApi(
      container(
        makeUsers([admin("a1", "admin@x"), member("u2", "bob@x")]),
        undefined,
        fired,
      ),
    );
    await call(api, "DELETE", "users/{id}", {
      params: { id: "u2" },
      user: { id: "a1" } as unknown,
    });
    assert.equal(fired.length, 1);
    assert.equal(fired[0].name, "onUserRevoked");
    assert.deepEqual(fired[0].payload, {
      id: "u2",
      identifier: "bob@x",
      tenantId: null,
      reason: "deleted",
    } satisfies IUserRevokedEvent);
  });

  it("PATCH enabled:false émet onUserRevoked { reason: disabled }", async () => {
    const fired: FiredEvent[] = [];
    const api = createUserAdminApi(
      container(
        makeUsers([admin("a1", "admin@x"), member("u2", "bob@x")]),
        undefined,
        fired,
      ),
    );
    await call(api, "PATCH", "users/{id}", {
      params: { id: "u2" },
      user: { id: "a1" } as unknown,
      body: { enabled: false },
    });
    assert.equal((fired[0]?.payload as IUserRevokedEvent)?.reason, "disabled");
  });

  it("PATCH locked:true émet onUserRevoked { reason: locked }", async () => {
    const fired: FiredEvent[] = [];
    const api = createUserAdminApi(
      container(
        makeUsers([admin("a1", "admin@x"), member("u2", "bob@x")]),
        undefined,
        fired,
      ),
    );
    await call(api, "PATCH", "users/{id}", {
      params: { id: "u2" },
      user: { id: "a1" } as unknown,
      body: { locked: true },
    });
    assert.equal((fired[0]?.payload as IUserRevokedEvent)?.reason, "locked");
  });

  it("PATCH roles seul N'émet PAS onUserRevoked (pas une révocation d'accès)", async () => {
    const fired: FiredEvent[] = [];
    const api = createUserAdminApi(
      container(
        makeUsers([admin("a1", "admin@x"), member("u2", "bob@x")]),
        undefined,
        fired,
      ),
    );
    await call(api, "PATCH", "users/{id}", {
      params: { id: "u2" },
      user: { id: "a1" } as unknown,
      body: { roles: ["ROLE_USER", "ROLE_EDITOR"] },
    });
    assert.equal(fired.length, 0);
  });
});
