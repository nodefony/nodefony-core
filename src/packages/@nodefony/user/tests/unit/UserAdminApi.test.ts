import assert from "node:assert/strict";
import {
  createUserAdminApi,
  toUserSummary,
  type IUserSummary,
  type IUserRevokedEvent,
} from "../../nodefony/src/admin/UserAdminApi";
import { BaseUser } from "../../nodefony/src/BaseUser";
import { USER_SORTABLE_FIELDS_IN_MEMORY } from "../../nodefony/src/userSort";
import { attachExtraColumns } from "../../nodefony/src/userContract";
import { USER_FACETS } from "../../nodefony/src/userFilters";
import { WeakPasswordError } from "../../nodefony/errors/WeakPasswordError";
import { countFacets } from "nodefony";
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
/** Membre avec un mot de passe connu (hash mocké `hash:<plain>`, cf `makeUsers`). */
function withPassword(
  id: string,
  identifier: string,
  plain: string,
  roles: string[] = ["ROLE_USER"],
): BaseUser {
  return new BaseUser({ id, identifier, roles, password: `hash:${plain}` });
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
      patch: {
        roles?: string[];
        enabled?: boolean;
        locked?: boolean;
        metadata?: Record<string, unknown>;
      },
    ) => {
      const u = map.get(criteria.id);
      if (!u) return null;
      if (patch.roles) u.roles = patch.roles;
      if (typeof patch.enabled === "boolean")
        patch.enabled ? u.enable() : u.disable();
      if (typeof patch.locked === "boolean")
        patch.locked ? u.lock() : u.unlock();
      if (patch.metadata) u.metadata = patch.metadata;
      return u;
    },
    changePassword: async (id: string, plain: string) => {
      const u = map.get(id);
      if (!u) return null;
      u.setPassword(`hash:${plain}`);
      return u;
    },
    // Calque le vrai `UserService.authenticate` : retrouve par identifier, refuse
    // si verrouillé/désactivé ou si le hash ne matche pas (`hash:<plain>`).
    authenticate: async (identifier: string, plain: string) => {
      const u = [...map.values()].find((x) => x.identifier === identifier);
      if (!u || !u.isActive() || u.isLocked()) return null;
      return u.password === `hash:${plain}` ? u : null;
    },
    delete: async (criteria: { id: string }) =>
      map.delete(criteria.id) ? 1 : 0,
    // Capacité de tri : le double suit le contrat du service réel, sinon le
    // data plane appellerait une méthode absente (vécu — ce test l'a montré).
    sortableFields: () => USER_SORTABLE_FIELDS_IN_MEMORY,
    // Pagination native (miroir du contrat `IUserRepository.listPage`) — filtre
    // role/enabled/q, tri identifier ASC, slice ; on teste les HANDLERS.
    listPage: async (query: {
      limit: number;
      offset?: number;
      role?: string;
      enabled?: boolean;
      q?: string;
      withTotal?: boolean;
    }) => {
      const limit = Math.max(1, Math.floor(query.limit));
      const offset = Math.max(0, Math.floor(query.offset ?? 0));
      const filtered = filterUsers([...map.values()], query);
      filtered.sort((a, b) => a.identifier.localeCompare(b.identifier));
      const items = filtered.slice(offset, offset + limit);
      return {
        items,
        total: query.withTotal === false ? undefined : filtered.length,
        limit,
        offset,
        hasNext: offset + items.length < filtered.length,
      };
    },
    countActiveAdmins: async (adminRole: string) =>
      [...map.values()].filter(
        (u) => u.isActive() && u.roles.includes(adminRole),
      ).length,
    // Compteurs de tête — même chaîne que `UserService.countUserFacets` : la
    // table de facettes RÉELLE, et le MÊME filtrage que `listPage` (donc `q`
    // inclus). Un double qui compterait sans chercher rendrait le test
    // complaisant : il passerait alors même que le handler jette le terme.
    countUserFacets: async (
      adminRole: string,
      query?: Record<string, unknown>,
    ) => {
      const all = [...map.values()];
      const counts = await countFacets(
        USER_FACETS,
        (facet) => filterUsers(all, { ...query, ...facet }).length,
      );
      return {
        ...counts,
        admins: filterUsers(all, { ...query, role: adminRole }).length,
      };
    },
  };
}

/**
 * Le filtrage de l'annuaire factice — écrit UNE fois pour la liste et pour les
 * compteurs, comme dans les vrais dépôts (`InMemoryUserRepository.countUsers`
 * délègue à `listPage`). Deux filtrages parallèles auraient laissé passer un
 * data plane qui cherche dans la liste et pas dans les compteurs, ce que ce
 * fichier éprouve précisément.
 */
function filterUsers(
  users: BaseUser[],
  query: Record<string, unknown> = {},
): BaseUser[] {
  let out = users;
  if (typeof query.role === "string") {
    const role = query.role;
    out = out.filter((u) => u.roles.includes(role));
  }
  if (typeof query.enabled === "boolean") {
    out = out.filter((u) => u.isActive() === query.enabled);
  }
  if (typeof query.locked === "boolean") {
    out = out.filter((u) => u.isLocked() === query.locked);
  }
  if (typeof query.hasSocial === "boolean") {
    out = out.filter((u) => u.socialProviders.length > 0 === query.hasSocial);
  }
  if (typeof query.q === "string" && query.q.length > 0) {
    const needle = query.q.toLowerCase();
    out = out.filter((u) => u.identifier.toLowerCase().includes(needle));
  }
  return out;
}

type AuditEvent = {
  action: string;
  actor: string | null;
  resource?: string | null;
  outcome?: "success" | "failure" | "denied";
  reason?: string;
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

  it("un champ MÉTIER de l'application ne sort pas dans le résumé admin", () => {
    // Depuis que les dépôts reportent les colonnes hors contrat, un utilisateur
    // PORTE les champs métier de l'application (salaire, numéro de sécurité
    // sociale, notes RH). `toUserSummary` construit son objet champ par champ,
    // sans diffusion — c'est ce qui empêche ces champs de partir dans le data
    // plane et dans la console d'administration. Rien ne gardait cette
    // étanchéité : un `...user` ajouté un jour la romprait sans un mot.
    const withBusiness = attachExtraColumns(
      new BaseUser({ id: "u9", identifier: "carol@example.com" }),
      { firstName: "Carol", salary: "SALAIRE_CONFIDENTIEL" },
    );
    const summary = toUserSummary(withBusiness);
    assert.ok(!("firstName" in summary), "firstName ne doit pas être diffusé");
    assert.ok(!("salary" in summary), "salary ne doit pas être diffusé");
    assert.ok(!JSON.stringify(summary).includes("SALAIRE_CONFIDENTIEL"));
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
    assert.equal(s.hasPassword, true); // présence du hash, JAMAIS la valeur
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

  it("expose le profil par allowlist (jamais les autres clés metadata)", () => {
    const u2 = new BaseUser({
      id: "u2",
      identifier: "chris@x",
      roles: ["ROLE_USER"],
      metadata: {
        profile: { givenName: "Chris", familyName: "Camensuli", secret: "x" },
        internalNote: "SECRET_META",
      },
    });
    const s2 = toUserSummary(u2);
    assert.deepEqual(s2.profile, {
      givenName: "Chris",
      familyName: "Camensuli",
    });
    assert.ok(!JSON.stringify(s2).includes("SECRET_META"));
    assert.ok(!JSON.stringify(s2).includes('"secret"'));
  });
});

// ── Profil (metadata.profile — claims OIDC : nom/prénom/email/locale/avatar) ──
describe("UserAdminApi — profil", () => {
  it("PATCH users/{id} : merge le profil, préserve les autres clés metadata", async () => {
    const target = new BaseUser({
      id: "p1",
      identifier: "chris@x",
      roles: ["ROLE_USER"],
      metadata: { theme: "dark", profile: { givenName: "Chris" } },
    });
    const api = createUserAdminApi(
      container(makeUsers([admin("a1", "admin@x"), target])),
    );
    const { status, body } = await call(api, "PATCH", "users/{id}", {
      params: { id: "p1" },
      user: { id: "a1", identifier: "admin@x" } as unknown,
      body: { profile: { familyName: "Camensuli" } },
    });
    assert.equal(status, 200);
    assert.deepEqual((body as IUserSummary).profile, {
      givenName: "Chris",
      familyName: "Camensuli",
    });
    assert.equal((target.metadata as Record<string, unknown>).theme, "dark");
  });

  it("PATCH : un profil invalide (email mal formé) → 400", async () => {
    const target = member("p1", "chris@x", ["ROLE_USER"]);
    const api = createUserAdminApi(
      container(makeUsers([admin("a1", "admin@x"), target])),
    );
    const { status } = await call(api, "PATCH", "users/{id}", {
      params: { id: "p1" },
      user: { id: "a1", identifier: "admin@x" } as unknown,
      body: { profile: { email: "not-an-email" } },
    });
    assert.equal(status, 400);
  });

  it("PATCH avec SEULEMENT un profil (sans roles/enabled/locked) → 200", async () => {
    const target = member("p1", "chris@x", ["ROLE_USER"]);
    const api = createUserAdminApi(
      container(makeUsers([admin("a1", "admin@x"), target])),
    );
    const { status } = await call(api, "PATCH", "users/{id}", {
      params: { id: "p1" },
      user: { id: "a1", identifier: "admin@x" } as unknown,
      body: { profile: { givenName: "Chris" } },
    });
    assert.equal(status, 200);
  });

  it("POST me/profile : édite MON profil (cible = ALS, l'id du body est ignoré)", async () => {
    const meUser = new BaseUser({
      id: "me1",
      identifier: "me@x",
      roles: ["ROLE_USER"],
    });
    const other = new BaseUser({
      id: "other",
      identifier: "other@x",
      roles: ["ROLE_USER"],
    });
    const api = createUserAdminApi(container(makeUsers([meUser, other])));
    const { status, body } = await call(api, "POST", "me/profile", {
      user: { id: "me1", identifier: "me@x" } as unknown,
      // tentative d'injection d'une cible "other" → IGNORÉE (anti-IDOR)
      body: { id: "other", givenName: "Chris" },
    });
    assert.equal(status, 200);
    assert.equal((body as IUserSummary).identifier, "me@x");
    assert.deepEqual((body as IUserSummary).profile, { givenName: "Chris" });
    assert.deepEqual(toUserSummary(other).profile, {}, "autrui intact");
  });

  it("POST me/profile : anonyme → 401", async () => {
    const api = createUserAdminApi(
      container(makeUsers([member("p1", "chris@x")])),
    );
    const { status } = await call(api, "POST", "me/profile", {
      user: null,
      body: { givenName: "X" },
    });
    assert.equal(status, 401);
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

// ── Self-service : changer MON mot de passe (me/password) ─────────────────────
describe("UserAdminApi — me/password (self-service, anti-IDOR)", () => {
  it("401 si non authentifié (pas d'identité ALS)", async () => {
    const api = createUserAdminApi(
      container(makeUsers([withPassword("u1", "alice@x", "oldsecret")])),
    );
    const { status } = await call(api, "POST", "me/password", {
      user: null,
      body: { currentPassword: "oldsecret", newPassword: "newsecret1" },
    });
    assert.equal(status, 401);
  });

  it("400 si currentPassword absent", async () => {
    const api = createUserAdminApi(
      container(makeUsers([withPassword("u1", "alice@x", "oldsecret")])),
    );
    const { status } = await call(api, "POST", "me/password", {
      user: { id: "u1", identifier: "alice@x" } as unknown,
      body: { newPassword: "newsecret1" },
    });
    assert.equal(status, 400);
  });

  it("400 si newPassword trop court (< 8)", async () => {
    const api = createUserAdminApi(
      container(makeUsers([withPassword("u1", "alice@x", "oldsecret")])),
    );
    const { status } = await call(api, "POST", "me/password", {
      user: { id: "u1", identifier: "alice@x" } as unknown,
      body: { currentPassword: "oldsecret", newPassword: "short" },
    });
    assert.equal(status, 400);
  });

  it("400 si newPassword === currentPassword (no-op refusé)", async () => {
    const api = createUserAdminApi(
      container(makeUsers([withPassword("u1", "alice@x", "samesecret")])),
    );
    const { status } = await call(api, "POST", "me/password", {
      user: { id: "u1", identifier: "alice@x" } as unknown,
      body: { currentPassword: "samesecret", newPassword: "samesecret" },
    });
    assert.equal(status, 400);
  });

  it("403 si le mot de passe actuel est faux + audit failure + AUCUN changement", async () => {
    const events: AuditEvent[] = [];
    const users = makeUsers([withPassword("u1", "alice@x", "oldsecret")]);
    const api = createUserAdminApi(
      container(users, { record: (e) => events.push(e) }),
    );
    const { status } = await call(api, "POST", "me/password", {
      user: { id: "u1", identifier: "alice@x" } as unknown,
      body: { currentPassword: "WRONG", newPassword: "newsecret1" },
    });
    assert.equal(status, 403);
    // mot de passe inchangé (changePassword jamais atteint après re-auth KO)
    assert.equal((await users.findById("u1"))?.password, "hash:oldsecret");
    // l'échec EST audité (signal de sécurité) — outcome failure
    assert.equal(events.length, 1);
    assert.equal(events[0].action, "user.password_change_self");
    assert.equal(events[0].outcome, "failure");
  });

  it("200 + change le mot de passe + audit success", async () => {
    const events: AuditEvent[] = [];
    const users = makeUsers([withPassword("u1", "alice@x", "oldsecret")]);
    const api = createUserAdminApi(
      container(users, { record: (e) => events.push(e) }),
    );
    const { status, body } = await call(api, "POST", "me/password", {
      user: { id: "u1", identifier: "alice@x" } as unknown,
      body: { currentPassword: "oldsecret", newPassword: "newsecret1" },
    });
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true });
    assert.equal((await users.findById("u1"))?.password, "hash:newsecret1");
    assert.equal(events[0].outcome, "success");
  });

  it("ANTI-IDOR : un id/identifier d'autrui dans le body/params est IGNORÉ (cible = l'appelant)", async () => {
    const users = makeUsers([
      withPassword("alice", "alice@x", "alicesecret"),
      withPassword("bob", "bob@x", "bobsecret"),
    ]);
    const api = createUserAdminApi(container(users));
    const { status } = await call(api, "POST", "me/password", {
      // identité SERVEUR = alice ; le client tente de cibler bob → doit être ignoré
      user: { id: "alice", identifier: "alice@x" } as unknown,
      params: { id: "bob" },
      body: {
        id: "bob",
        identifier: "bob@x",
        currentPassword: "alicesecret",
        newPassword: "newsecret1",
      },
    });
    assert.equal(status, 200);
    // SEUL alice a changé ; bob est intact
    assert.equal((await users.findById("alice"))?.password, "hash:newsecret1");
    assert.equal((await users.findById("bob"))?.password, "hash:bobsecret");
  });

  it("400 si le nouveau mot de passe est rejeté (WeakPasswordError → pas 500)", async () => {
    const users = makeUsers([withPassword("u1", "alice@x", "oldsecret")]);
    // re-auth OK, mais changePassword refuse le mot de passe compromis (blocklist)
    users.changePassword = async () => {
      throw new WeakPasswordError();
    };
    const api = createUserAdminApi(container(users));
    const { status } = await call(api, "POST", "me/password", {
      user: { id: "u1", identifier: "alice@x" } as unknown,
      body: { currentPassword: "oldsecret", newPassword: "password" },
    });
    assert.equal(status, 400);
  });
});

// ── Self-service : MON profil (GET me) ───────────────────────────────────────
describe("UserAdminApi — me (self profile)", () => {
  it("401 si non authentifié", async () => {
    const api = createUserAdminApi(
      container(makeUsers([member("u1", "alice@x")])),
    );
    const { status } = await call(api, "GET", "me", { user: null });
    assert.equal(status, 401);
  });

  it("200 + DTO redacté de MON compte (jamais le hash) + scope sur l'identité serveur", async () => {
    const alice = new BaseUser({
      id: "alice",
      identifier: "alice@x",
      roles: ["ROLE_USER"],
      password: "HASH_SECRET",
      socialProviders: [
        { provider: "google", providerId: "g-1", createdAt: new Date() },
      ],
    });
    const api = createUserAdminApi(
      container(makeUsers([alice, member("bob", "bob@x")])),
    );
    // le client tente de se faire passer pour bob via le body → ignoré (scope ALS)
    const { status, body } = await call(api, "GET", "me", {
      user: { id: "alice", identifier: "alice@x" } as unknown,
      body: { identifier: "bob@x" },
    });
    assert.equal(status, 200);
    const me = body as IUserSummary;
    assert.equal(me.identifier, "alice@x");
    assert.deepEqual(me.roles, ["ROLE_USER"]);
    assert.equal(me.socialProviders[0]?.provider, "google");
    assert.ok(!("password" in (me as object)));
    assert.ok(!JSON.stringify(me).includes("HASH_SECRET"));
  });
});

describe("UserAdminApi — users/stats et la RECHERCHE", () => {
  /** Annuaire où le terme « ali » ne désigne qu'un seul compte sur trois. */
  const seed = (): BaseUser[] => [
    admin("u1", "alice@x"),
    member("u2", "bob@x"),
    member("u3", "carol@x"),
  ];

  it("`?q=` déplace les compteurs — la barre de recherche ne fige plus les cartes", async () => {
    const api = createUserAdminApi(container(makeUsers(seed())));

    // TÉMOIN : sans terme, les cartes décrivent l'annuaire entier. Sans lui, un
    // handler cassé rendant 0 partout passerait l'assertion suivante.
    const { status: s0, body: all } = await call(api, "GET", "users/stats", {});
    assert.equal(s0, 200);
    assert.equal((all as { total: number }).total, 3);

    const { status, body } = await call(api, "GET", "users/stats", {
      query: { q: "ali" },
    });
    assert.equal(status, 200, "`q` est déclaré : il ne se refuse pas");
    const counts = body as { total: number; active: number; admins: number };
    assert.equal(counts.total, 1, "alice seule répond au terme");
    assert.equal(counts.active, 1);
    assert.equal(
      counts.admins,
      1,
      "les compteurs COMPOSÉS suivent aussi le terme — sinon « 1 compte, dont " +
        "1 administrateur » deviendrait « 1 compte, dont 1 administrateur » sur " +
        "un annuaire de mille",
    );
  });

  it("un terme sans correspondance rend des compteurs à ZÉRO, pas l'annuaire", async () => {
    // Le symptôme qu'on corrige : `q` accepté puis jeté rendrait ici les mêmes
    // nombres que sans terme, au-dessus d'un tableau vide.
    const api = createUserAdminApi(container(makeUsers(seed())));
    const { body } = await call(api, "GET", "users/stats", {
      query: { q: "zzz-personne" },
    });
    assert.deepEqual(body, {
      total: 0,
      active: 0,
      disabled: 0,
      locked: 0,
      social: 0,
      admins: 0,
    });
  });

  it("la LISTE et les COMPTEURS répondent le même nombre pour le même terme", async () => {
    // L'invariant que voit l'utilisateur : la carte au-dessus du tableau doit
    // décrire le tableau. Deux chemins de code distincts (`listPage` et
    // `countUserFacets`) le tiennent — ce test est ce qui les relie.
    const api = createUserAdminApi(container(makeUsers(seed())));
    const { body: page } = await call(api, "GET", "users", {
      query: { q: "ali", limit: "25" },
    });
    const { body: counts } = await call(api, "GET", "users/stats", {
      query: { q: "ali" },
    });
    assert.equal(
      (page as { total: number }).total,
      (counts as { total: number }).total,
    );
  });

  it("un filtre que les facettes DÉCOMPOSENT reste refusé, terme ou pas", async () => {
    // La recherche s'ajoute au vocabulaire de /stats, elle ne l'ouvre pas :
    // `enabled` est ventilé en cartes, le filtrer rendrait une réponse qui se
    // contredit (total filtré, facettes l'écrasant).
    const api = createUserAdminApi(container(makeUsers(seed())));
    await assert.rejects(
      call(api, "GET", "users/stats", { query: { q: "ali", enabled: "true" } }),
      /enabled/,
    );
  });
});
