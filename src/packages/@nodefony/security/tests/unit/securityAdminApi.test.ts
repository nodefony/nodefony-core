import assert from "node:assert/strict";
import { Container } from "nodefony";
import type {
  Module,
  IAdminRequest,
  IAdminApi,
  IAdminRegistry,
} from "nodefony";
import AuditService from "../../nodefony/service/auditService";
import {
  createSecurityAdminApi,
  registerSecurityAdminApi,
  parseAuditQuery,
} from "../../nodefony/src/admin/SecurityAdminApi";
import type { IPage } from "nodefony";
import type { IAuditEvent } from "../../nodefony/contracts/IAuditEvent";
import type { IAuditEventDraft } from "../../nodefony/contracts/IAuditEvent";
import type { IWebAuthnCredential } from "../../nodefony/contracts/IWebAuthnCredential";

/**
 * Data plane admin du journal d'audit (P6.14 — Lot 3) : producteur `IAdminApi`
 * `GET /nodefony/security/api/audit/events`. Cibles : RBAC ROLE_NODEFONY_ADMIN
 * déclaré, lecture filtrée/paginée déléguée à `auditService`, 503 si le journal
 * est indisponible (absent/désactivé), parsing robuste de la query string.
 */

function bootAudit(enabled = true): {
  audit: AuditService;
  container: Container;
} {
  const container = new Container();
  const bootCbs: Array<() => void> = [];
  const kernel = {
    container,
    once(ev: string, cb: () => void) {
      if (ev === "onBoot") bootCbs.push(cb);
    },
    registerStoreResolution() {},
  };
  container.set("kernel", kernel);
  const audit = new AuditService({
    container,
    notificationsCenter: false,
    options: { audit: { enabled } },
  } as unknown as Module);
  container.set("auditService", audit);
  bootCbs.forEach((cb) => cb());
  return { audit, container };
}

function req(query: Record<string, string | string[]> = {}): IAdminRequest {
  return {
    params: {},
    query,
    body: null,
    user: null,
    roles: ["ROLE_NODEFONY_ADMIN"],
  };
}

function auditEndpoint(container: Container) {
  const api = createSecurityAdminApi(container);
  const ep = api.adminEndpoints().find((e) => e.path === "audit/events");
  assert.ok(ep, "endpoint audit/events présent");
  return ep!;
}

// ════════════════════════════════════════════════════════════════════════════
describe("SecurityAdminApi — déclaration", () => {
  it("namespace security + RBAC admin sur la carte et l'endpoint", () => {
    const api = createSecurityAdminApi(new Container());
    assert.equal(api.adminNamespace, "security");
    assert.equal(api.adminDescriptor().role, "ROLE_NODEFONY_ADMIN");
    const ep = api.adminEndpoints().find((e) => e.path === "audit/events")!;
    assert.equal(ep.method, "GET");
    assert.equal(ep.role, "ROLE_NODEFONY_ADMIN");
  });

  it("registerSecurityAdminApi enregistre le producteur, idempotent", () => {
    const registered: IAdminApi[] = [];
    const registry = {
      has: (ns: string) => registered.some((a) => a.adminNamespace === ns),
      register: (a: IAdminApi) => {
        registered.push(a);
        return registry;
      },
    } as unknown as IAdminRegistry;
    const container = new Container();
    registerSecurityAdminApi(registry, container);
    registerSecurityAdminApi(registry, container); // 2e appel → no-op (has)
    assert.equal(registered.length, 1);
    assert.equal(registered[0]!.adminNamespace, "security");
  });
});

describe("SecurityAdminApi — handler audit/events", () => {
  it("renvoie le journal filtré (délégué à auditService)", async () => {
    const { audit, container } = bootAudit(true);
    audit.record({
      category: "auth",
      action: "login.success",
      outcome: "success",
      actor: "alice",
    });
    audit.record({
      category: "authz",
      action: "access.denied",
      outcome: "denied",
      actor: "bob",
    });
    const ep = auditEndpoint(container);
    const res = (await ep.handler(
      req({ category: "authz" }),
    )) as IPage<IAuditEvent>;
    assert.equal(res.total, 1);
    assert.equal(res.items[0]!.category, "authz");
    assert.equal(res.items[0]!.actor, "bob");
  });

  it("pagine via limit + curseur", async () => {
    const { audit, container } = bootAudit(true);
    for (let i = 0; i < 4; i++) {
      audit.record({
        category: "auth",
        action: "login.success",
        outcome: "success",
        actor: `u${i}`,
      });
    }
    const ep = auditEndpoint(container);
    const page1 = (await ep.handler(req({ limit: "2" }))) as IPage<IAuditEvent>;
    assert.equal(page1.items.length, 2);
    assert.equal(page1.total, 4);
    assert.ok(page1.nextCursor);
    const page2 = (await ep.handler(
      req({ limit: "2", cursor: page1.nextCursor! }),
    )) as IPage<IAuditEvent>;
    assert.equal(page2.items.length, 2);
    assert.equal(page2.hasNext, false);
  });

  it("503 si l'audit est désactivé", async () => {
    const { container } = bootAudit(false);
    const ep = auditEndpoint(container);
    const res = (await ep.handler(req())) as { status: number };
    assert.equal(res.status, 503);
  });

  it("503 si aucun auditService dans le container", async () => {
    const container = new Container();
    const ep = auditEndpoint(container);
    const res = (await ep.handler(req())) as { status: number };
    assert.equal(res.status, 503);
  });
});

describe("parseAuditQuery", () => {
  it("traduit les filtres valides (entiers parsés)", () => {
    const f = parseAuditQuery({
      category: "auth",
      outcome: "denied",
      actor: "x",
      action: "login.success",
      since: "100",
      until: "200",
      limit: "10",
      cursor: "1000:e5",
    });
    assert.deepEqual(f, {
      category: "auth",
      outcome: "denied",
      actor: "x",
      action: "login.success",
      since: 100,
      until: 200,
      limit: 10,
      cursor: "1000:e5",
    });
  });

  // Le contrat de page n'admet pas « tout » : sans `limit` demandé, le parse en
  // pose un — un appelant ne peut pas obtenir un journal entier en l'omettant.
  it("pose toujours un limit par défaut", () => {
    assert.deepEqual(parseAuditQuery({}), { limit: 100 });
  });

  it("ignore category/outcome inconnus (permissif, admin only)", () => {
    assert.deepEqual(parseAuditQuery({ category: "xxx", outcome: "yyy" }), {
      limit: 100,
    });
  });

  it("prend le 1er d'un param multi-valué et ignore un entier non numérique", () => {
    assert.deepEqual(parseAuditQuery({ actor: ["a", "b"], since: "abc" }), {
      actor: "a",
      limit: 100,
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Reset des FACTEURS FORTS d'un utilisateur (page profil admin) — passkeys +
// 2FA TOTP. Le RBAC effectif (403) est appliqué par le broker (`isAdminGranted`,
// testé côté framework + banc e2e attack) : ici on couvre la DÉCLARATION du rôle
// et le comportement des handlers (404/503/succès, redaction, audit).
// ════════════════════════════════════════════════════════════════════════════

function fakeCredential(id: string, userId: string): IWebAuthnCredential {
  return {
    id,
    userId,
    publicKey: "COSE_PUBLIC_KEY_BASE64URL", // doit DISPARAÎTRE de la vue admin
    signCount: 0,
    transports: ["internal"],
    backupEligible: true,
    backupState: true,
    uvInitialized: true,
    nickname: "MacBook de Chris",
    createdAt: 1000,
    lastUsedAt: 2000,
  };
}

/** Container outillé : webauthn/totp/users + spy d'audit, chacun optionnel. */
function bootFactors(opts: {
  credentials?: IWebAuthnCredential[];
  removeResult?: boolean;
  totpStatus?: {
    enabled: boolean;
    pending: boolean;
    recoveryCodesRemaining: number;
  };
  userExists?: boolean;
  withWebauthn?: boolean;
  withTotp?: boolean;
}) {
  const container = new Container();
  const recorded: IAuditEventDraft[] = [];
  const disabledFor: string[] = [];
  const removedArgs: Array<[string, string]> = [];
  const listQueries: Record<string, unknown>[] = [];
  if (opts.withWebauthn !== false) {
    container.set("webauthn", {
      listUserCredentials: async (_userId: string) => opts.credentials ?? [],
      removeUserCredential: async (userId: string, credentialId: string) => {
        removedArgs.push([userId, credentialId]);
        return opts.removeResult ?? true;
      },
      // Le store projette déjà (pas de `publicKey`) — le double doit donc rendre
      // des SUMMARY, pas des credentials complets : un mock trop généreux ferait
      // croire que la façade redacte, alors que c'est le contrat qui garantit.
      listCredentialsPage: async (query: Record<string, unknown>) => {
        listQueries.push(query);
        const items = (opts.credentials ?? []).map((c) => ({
          id: c.id,
          userId: c.userId,
          transports: c.transports,
          backupEligible: c.backupEligible,
          backupState: c.backupState,
          uvInitialized: c.uvInitialized,
          signCount: c.signCount,
          createdAt: c.createdAt,
          lastUsedAt: c.lastUsedAt,
          ...(c.nickname !== undefined ? { nickname: c.nickname } : {}),
        }));
        return {
          items,
          limit: query.limit as number,
          offset: query.offset as number,
          total: items.length,
          hasNext: false,
        };
      },
    });
  }
  if (opts.withTotp !== false) {
    container.set("totp", {
      status: async (_userId: string) =>
        opts.totpStatus ?? {
          enabled: true,
          pending: false,
          recoveryCodesRemaining: 8,
        },
      disable: async (userId: string) => {
        disabledFor.push(userId);
      },
    });
  }
  container.set("users", {
    findById: async (id: string) => ((opts.userExists ?? true) ? { id } : null),
  });
  container.set("auditService", {
    record: (e: IAuditEventDraft) => recorded.push(e),
  });
  return { container, recorded, disabledFor, removedArgs, listQueries };
}

function endpoint(container: Container, path: string) {
  const ep = createSecurityAdminApi(container)
    .adminEndpoints()
    .find((e) => e.path === path);
  assert.ok(ep, `endpoint ${path} présent`);
  return ep!;
}

function reqP(
  params: Record<string, string>,
  body: unknown = null,
): IAdminRequest {
  return {
    params,
    query: {},
    body,
    user: { username: "admin1" },
    roles: ["ROLE_NODEFONY_ADMIN"],
  };
}

/** Requête admin portant des paramètres de query (listing paginé). */
function reqQ(query: Record<string, string>): IAdminRequest {
  return {
    params: {},
    query,
    body: null,
    user: { username: "admin1" },
    roles: ["ROLE_NODEFONY_ADMIN"],
  };
}

describe("SecurityAdminApi — GET webauthn/list", () => {
  it("passe les filtres au store et rend la page", async () => {
    const { container, listQueries } = bootFactors({
      credentials: [fakeCredential("c1", "u1")],
    });
    const ep = endpoint(container, "webauthn/list");
    const res = (await ep.handler(
      reqQ({
        userId: "u1",
        backedUp: "false",
        q: "u",
        limit: "5",
        offset: "10",
      }),
    )) as {
      enabled: boolean;
      items: Record<string, unknown>[];
      total?: number;
    };
    assert.equal(res.enabled, true);
    assert.equal(res.items.length, 1);
    assert.ok(
      !("publicKey" in res.items[0]!),
      "publicKey ne doit JAMAIS fuiter",
    );
    assert.deepEqual(listQueries[0], {
      limit: 5,
      offset: 10,
      userId: "u1",
      backedUp: false,
      q: "u",
    });
  });

  it("borne le limit demandé (anti-vidage par un admin distrait)", async () => {
    const { container, listQueries } = bootFactors({});
    const ep = endpoint(container, "webauthn/list");
    await ep.handler(reqQ({ limit: "100000" }));
    assert.ok(
      (listQueries[0]!.limit as number) < 100000,
      "le limit doit être plafonné",
    );
  });

  it("service absent → enabled:false, JAMAIS une erreur", async () => {
    // La console doit pouvoir afficher « passkeys désactivés » plutôt qu'un 503
    // qui ressemble à une panne.
    const { container } = bootFactors({ withWebauthn: false });
    const ep = endpoint(container, "webauthn/list");
    const res = (await ep.handler(reqQ({}))) as {
      enabled: boolean;
      items: unknown[];
      total?: number;
    };
    assert.equal(res.enabled, false);
    assert.deepEqual(res.items, []);
    assert.equal(res.total, 0);
  });
});

describe("SecurityAdminApi — facteurs forts (déclaration)", () => {
  it("les 5 endpoints déclarent ROLE_NODEFONY_ADMIN + la bonne méthode", () => {
    const eps = createSecurityAdminApi(new Container()).adminEndpoints();
    const expected: Array<[string, string]> = [
      ["webauthn/list", "GET"],
      ["users/{id}/passkeys", "GET"],
      ["users/{id}/passkeys/{credentialId}", "DELETE"],
      ["users/{id}/totp", "GET"],
      ["users/{id}/totp/disable", "POST"],
    ];
    for (const [path, method] of expected) {
      const ep = eps.find((e) => e.path === path);
      assert.ok(ep, `endpoint ${path} présent`);
      assert.equal(ep!.method, method, `${path} méthode`);
      assert.equal(ep!.role, "ROLE_NODEFONY_ADMIN", `${path} RBAC`);
    }
  });
});

describe("SecurityAdminApi — GET users/{id}/passkeys", () => {
  it("liste redactée : clé publique COSE et userId ABSENTS de la vue", async () => {
    const { container } = bootFactors({
      credentials: [fakeCredential("c1", "u1")],
    });
    const ep = endpoint(container, "users/{id}/passkeys");
    const res = (await ep.handler(reqP({ id: "u1" }))) as {
      credentials: Record<string, unknown>[];
    };
    assert.equal(res.credentials.length, 1);
    const view = res.credentials[0]!;
    assert.equal(view.id, "c1");
    assert.equal(view.nickname, "MacBook de Chris");
    assert.deepEqual(view.transports, ["internal"]);
    assert.ok(!("publicKey" in view), "publicKey ne doit JAMAIS fuiter");
    assert.ok(!("userId" in view), "userId redondant (path) — omis");
  });

  it("404 si l'utilisateur est inconnu", async () => {
    const { container } = bootFactors({ userExists: false });
    const ep = endpoint(container, "users/{id}/passkeys");
    const res = (await ep.handler(reqP({ id: "ghost" }))) as { status: number };
    assert.equal(res.status, 404);
  });

  it("503 si le service webauthn est absent", async () => {
    const { container } = bootFactors({ withWebauthn: false });
    const ep = endpoint(container, "users/{id}/passkeys");
    const res = (await ep.handler(reqP({ id: "u1" }))) as { status: number };
    assert.equal(res.status, 503);
  });
});

describe("SecurityAdminApi — DELETE users/{id}/passkeys/{credentialId}", () => {
  it("révoque (owner-scopé) + audite l'acteur/cible", async () => {
    const { container, recorded, removedArgs } = bootFactors({
      removeResult: true,
    });
    const ep = endpoint(container, "users/{id}/passkeys/{credentialId}");
    const res = (await ep.handler(reqP({ id: "u1", credentialId: "c1" }))) as {
      ok: boolean;
    };
    assert.deepEqual(res, { ok: true });
    assert.deepEqual(removedArgs, [["u1", "c1"]]);
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0]!.category, "webauthn");
    assert.equal(recorded[0]!.action, "user.passkey_revoked");
    assert.equal(recorded[0]!.actor, "admin1");
    assert.equal(recorded[0]!.resource, "u1");
    assert.equal(recorded[0]!.metadata?.credentialId, "c1");
    assert.equal(recorded[0]!.metadata?.viaAdmin, true);
  });

  it("404 si la passkey est inconnue/pas le propriétaire — SANS audit", async () => {
    const { container, recorded } = bootFactors({ removeResult: false });
    const ep = endpoint(container, "users/{id}/passkeys/{credentialId}");
    const res = (await ep.handler(
      reqP({ id: "u1", credentialId: "ghost" }),
    )) as { status: number };
    assert.equal(res.status, 404);
    assert.equal(recorded.length, 0, "pas d'audit pour un no-op");
  });

  it("503 si le service webauthn est absent", async () => {
    const { container } = bootFactors({ withWebauthn: false });
    const ep = endpoint(container, "users/{id}/passkeys/{credentialId}");
    const res = (await ep.handler(reqP({ id: "u1", credentialId: "c1" }))) as {
      status: number;
    };
    assert.equal(res.status, 503);
  });
});

describe("SecurityAdminApi — GET users/{id}/totp", () => {
  it("renvoie l'état 2FA d'un utilisateur connu", async () => {
    const { container } = bootFactors({
      totpStatus: { enabled: true, pending: false, recoveryCodesRemaining: 3 },
    });
    const ep = endpoint(container, "users/{id}/totp");
    const res = (await ep.handler(reqP({ id: "u1" }))) as {
      enabled: boolean;
      recoveryCodesRemaining: number;
    };
    assert.equal(res.enabled, true);
    assert.equal(res.recoveryCodesRemaining, 3);
  });

  it("404 si l'utilisateur est inconnu", async () => {
    const { container } = bootFactors({ userExists: false });
    const ep = endpoint(container, "users/{id}/totp");
    const res = (await ep.handler(reqP({ id: "ghost" }))) as { status: number };
    assert.equal(res.status, 404);
  });

  it("503 si le service totp est absent", async () => {
    const { container } = bootFactors({ withTotp: false });
    const ep = endpoint(container, "users/{id}/totp");
    const res = (await ep.handler(reqP({ id: "u1" }))) as { status: number };
    assert.equal(res.status, 503);
  });
});

describe("SecurityAdminApi — POST users/{id}/totp/disable", () => {
  it("désactive le 2FA de l'utilisateur ciblé + audite", async () => {
    const { container, recorded, disabledFor } = bootFactors({});
    const ep = endpoint(container, "users/{id}/totp/disable");
    const res = (await ep.handler(reqP({ id: "u1" }))) as { ok: boolean };
    assert.deepEqual(res, { ok: true });
    assert.deepEqual(disabledFor, ["u1"]);
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0]!.category, "auth");
    assert.equal(recorded[0]!.action, "user.totp_disabled");
    assert.equal(recorded[0]!.actor, "admin1");
    assert.equal(recorded[0]!.resource, "u1");
  });

  it("404 si l'utilisateur est inconnu (pas de disable)", async () => {
    const { container, disabledFor } = bootFactors({ userExists: false });
    const ep = endpoint(container, "users/{id}/totp/disable");
    const res = (await ep.handler(reqP({ id: "ghost" }))) as { status: number };
    assert.equal(res.status, 404);
    assert.equal(disabledFor.length, 0);
  });

  it("503 si le service totp est absent", async () => {
    const { container } = bootFactors({ withTotp: false });
    const ep = endpoint(container, "users/{id}/totp/disable");
    const res = (await ep.handler(reqP({ id: "u1" }))) as { status: number };
    assert.equal(res.status, 503);
  });
});
