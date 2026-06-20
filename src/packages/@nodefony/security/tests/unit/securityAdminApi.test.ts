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
import type { IAuditQueryResult } from "../../nodefony/contracts/IAuditStore";

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
    )) as IAuditQueryResult;
    assert.equal(res.total, 1);
    assert.equal(res.events[0]!.category, "authz");
    assert.equal(res.events[0]!.actor, "bob");
  });

  it("pagine via limit + curseur before", async () => {
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
    const page1 = (await ep.handler(req({ limit: "2" }))) as IAuditQueryResult;
    assert.equal(page1.events.length, 2);
    assert.equal(page1.total, 4);
    assert.ok(page1.nextBefore);
    const page2 = (await ep.handler(
      req({ limit: "2", before: page1.nextBefore! }),
    )) as IAuditQueryResult;
    assert.equal(page2.events.length, 2);
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
      before: "e5",
    });
    assert.deepEqual(f, {
      category: "auth",
      outcome: "denied",
      actor: "x",
      action: "login.success",
      since: 100,
      until: 200,
      limit: 10,
      before: "e5",
    });
  });

  it("ignore category/outcome inconnus (permissif, admin only)", () => {
    assert.deepEqual(parseAuditQuery({ category: "xxx", outcome: "yyy" }), {});
  });

  it("prend le 1er d'un param multi-valué et ignore un entier non numérique", () => {
    assert.deepEqual(parseAuditQuery({ actor: ["a", "b"], since: "abc" }), {
      actor: "a",
    });
  });
});
