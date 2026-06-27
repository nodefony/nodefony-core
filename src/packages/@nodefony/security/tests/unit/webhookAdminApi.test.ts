import assert from "node:assert/strict";
import { Container } from "nodefony";
import type { IAdminRequest, IAdminEndpoint } from "nodefony";
import type { IAuditEventDraft } from "../../nodefony/contracts/IAuditEvent";
import { webhookAdminEndpoints } from "../../nodefony/src/admin/WebhookAdminApi";
import { createSecurityAdminApi } from "../../nodefony/src/admin/SecurityAdminApi";

/**
 * Data plane admin des webhooks sortants (P6.13 Slice C) — producteur
 * `IAdminApi` composé dans le namespace `security`. Cibles : déclaration RBAC
 * ROLE_NODEFONY_ADMIN + composition, CRUD complet, redaction du secret (jamais
 * en lecture), audit des mutations, mapping 400/422/404/503, identité créateur.
 * Le RBAC effectif (403) est appliqué par le broker (`isAdminGranted`, couvert
 * côté framework + e2e) ; ici on couvre la DÉCLARATION et les handlers.
 */

/** Classe nommée → l'introspection du driver lit `constructor.name`. */
class MemoryWebhookStore {}

interface FakeEndpoint {
  id: string;
  url: string;
  secretEnc: string;
  events: string[];
  enabled: boolean;
  description: string | null;
  tenantId: string | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
  lastDeliveryAt: number | null;
  lastDeliveryStatus: number | null;
  lastDeliveryError: string | null;
  failureCount: number;
  metadata: Record<string, unknown>;
}

/** Vue publique (sans `secretEnc`) — comme le `toSummary` du vrai service. */
function summary(ep: FakeEndpoint): Omit<FakeEndpoint, "secretEnc"> {
  const { secretEnc: _omit, ...rest } = ep;
  return rest;
}

function ssrfThrow(): never {
  const e = new Error("URL sortante interdite (SSRF)") as Error & {
    code: number;
  };
  e.code = 422;
  throw e;
}

/**
 * Container outillé d'un faux service `webhooks` (in-memory) + spy d'audit +
 * store nommé pour le driver. Drapeaux : `ready` (service opérationnel),
 * `ssrf` (register refuse l'URL), `ssrfUpdate` (update refuse une nouvelle url).
 */
function bootWebhooks(
  opts: {
    ready?: boolean;
    ssrf?: boolean;
    ssrfUpdate?: boolean;
    withService?: boolean;
    withStore?: boolean;
  } = {},
) {
  const container = new Container();
  const recorded: IAuditEventDraft[] = [];
  const store = new Map<string, FakeEndpoint>();
  let seq = 0;
  const ready = opts.ready ?? true;
  const svc = {
    isReady: () => ready,
    register: async (input: {
      url: string;
      events: readonly string[];
      description?: string | null;
      enabled?: boolean;
      createdBy?: string | null;
    }) => {
      if (opts.ssrf) ssrfThrow();
      const id = `wh_${++seq}`;
      const ep: FakeEndpoint = {
        id,
        url: input.url,
        secretEnc: `gcm1.${id}`,
        events: [...input.events],
        enabled: input.enabled ?? true,
        description: input.description ?? null,
        tenantId: null,
        createdBy: input.createdBy ?? null,
        createdAt: 1,
        updatedAt: 1,
        lastDeliveryAt: null,
        lastDeliveryStatus: null,
        lastDeliveryError: null,
        failureCount: 0,
        metadata: {},
      };
      store.set(id, ep);
      return { endpoint: summary(ep), secret: `whsec_${id}` };
    },
    list: async () => [...store.values()].map(summary),
    getEndpoint: async (id: string) => {
      const ep = store.get(id);
      return ep ? summary(ep) : null;
    },
    update: async (
      id: string,
      patch: {
        url?: string;
        events?: readonly string[];
        enabled?: boolean;
        description?: string | null;
      },
    ) => {
      const cur = store.get(id);
      if (!cur) return null;
      if (patch.url !== undefined && opts.ssrfUpdate) ssrfThrow();
      const next: FakeEndpoint = {
        ...cur,
        ...(patch.url !== undefined ? { url: patch.url } : {}),
        ...(patch.events !== undefined ? { events: [...patch.events] } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.description !== undefined
          ? { description: patch.description }
          : {}),
        updatedAt: 2,
      };
      store.set(id, next);
      return summary(next);
    },
    rotateSecret: async (id: string) => {
      const cur = store.get(id);
      if (!cur) return null;
      return { endpoint: summary(cur), secret: `whsec_rot_${id}` };
    },
    revealSecret: async (id: string) => {
      const cur = store.get(id);
      return cur ? `whsec_${id}` : null;
    },
    delete: async (id: string) => store.delete(id),
  };
  if (opts.withService !== false) container.set("webhooks", svc);
  if (opts.withStore !== false) {
    container.set("webhookStore", new MemoryWebhookStore());
  }
  container.set("auditService", {
    record: (e: IAuditEventDraft) => recorded.push(e),
  });
  return { container, recorded, store };
}

function endpoint(
  container: Container,
  path: string,
  method = "GET",
): IAdminEndpoint {
  const ep = webhookAdminEndpoints(container).find(
    (e) => e.path === path && (e.method ?? "GET") === method,
  );
  assert.ok(ep, `endpoint ${method} ${path} présent`);
  return ep!;
}

function req(
  params: Record<string, string> = {},
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

/** Crée un endpoint et renvoie son id (helper de fixture). */
async function seed(container: Container, url = "https://hook.example.com") {
  const create = endpoint(container, "webhooks", "POST");
  const res = (await create.handler(req({}, { url, events: ["*"] }))) as {
    body: { endpoint: { id: string } };
  };
  return res.body.endpoint.id;
}

// ════════════════════════════════════════════════════════════════════════════
describe("WebhookAdminApi — déclaration & composition", () => {
  it("expose 7 endpoints, tous ROLE_NODEFONY_ADMIN, bonnes méthodes", () => {
    const eps = webhookAdminEndpoints(new Container());
    const expected: Array<[string, string]> = [
      ["webhooks", "GET"],
      ["webhooks", "POST"],
      ["webhooks/{id}", "GET"],
      ["webhooks/{id}", "PATCH"],
      ["webhooks/{id}", "DELETE"],
      ["webhooks/{id}/rotate", "POST"],
      ["webhooks/{id}/reveal", "POST"],
    ];
    assert.equal(eps.length, expected.length);
    for (const [path, method] of expected) {
      const ep = eps.find(
        (e) => e.path === path && (e.method ?? "GET") === method,
      );
      assert.ok(ep, `${method} ${path}`);
      assert.equal(ep!.role, "ROLE_NODEFONY_ADMIN", `${method} ${path} RBAC`);
    }
  });

  it("sont composés dans le producteur security (namespace partagé)", () => {
    const paths = createSecurityAdminApi(new Container())
      .adminEndpoints()
      .map((e) => `${e.method ?? "GET"} ${e.path}`);
    assert.ok(paths.includes("POST webhooks"));
    assert.ok(paths.includes("POST webhooks/{id}/reveal"));
    assert.ok(paths.includes("DELETE webhooks/{id}"));
  });
});

describe("GET webhooks — liste + statut driver", () => {
  it("renvoie enabled/driver/store + la liste SANS secret chiffré", async () => {
    const { container } = bootWebhooks();
    await seed(container);
    const res = (await endpoint(container, "webhooks", "GET").handler(
      req(),
    )) as {
      enabled: boolean;
      driver: string | null;
      store: string;
      endpoints: Array<Record<string, unknown>>;
    };
    assert.equal(res.enabled, true);
    assert.equal(res.driver, "memory");
    assert.equal(res.store, "MemoryWebhookStore");
    assert.equal(res.endpoints.length, 1);
    assert.ok(
      !("secretEnc" in res.endpoints[0]!),
      "le secret chiffré ne fuit JAMAIS en liste",
    );
  });

  it("défensif : service absent → enabled:false + liste vide (jamais 503)", async () => {
    const { container } = bootWebhooks({
      withService: false,
      withStore: false,
    });
    const res = (await endpoint(container, "webhooks", "GET").handler(
      req(),
    )) as { enabled: boolean; endpoints: unknown[]; driver: string | null };
    assert.equal(res.enabled, false);
    assert.deepEqual(res.endpoints, []);
    assert.equal(res.driver, null);
  });
});

describe("POST webhooks — création", () => {
  it("201 + secret montré 1× + createdBy=ALS + audit webhook.created", async () => {
    const { container, recorded } = bootWebhooks();
    const res = (await endpoint(container, "webhooks", "POST").handler(
      req(
        {},
        { url: "https://hook.example.com", events: ["*"], description: "prod" },
      ),
    )) as {
      status: number;
      body: {
        endpoint: { id: string; createdBy: string | null };
        secret: string;
      };
    };
    assert.equal(res.status, 201);
    assert.match(res.body.secret, /^whsec_/);
    assert.equal(res.body.endpoint.createdBy, "admin1");
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0]!.category, "webhook");
    assert.equal(recorded[0]!.action, "webhook.created");
    assert.equal(recorded[0]!.actor, "admin1");
    assert.equal(recorded[0]!.resource, res.body.endpoint.id);
  });

  it("400 sur url manquante / events vide / types invalides", async () => {
    const { container } = bootWebhooks();
    const create = endpoint(container, "webhooks", "POST");
    const bad: unknown[] = [
      {},
      { events: ["a"] },
      { url: "https://x.example.com" },
      { url: "https://x.example.com", events: [] },
      { url: "https://x.example.com", events: [1, 2] },
      { url: "https://x.example.com", events: ["a"], enabled: "yes" },
      { url: "https://x.example.com", events: ["a"], description: 5 },
    ];
    for (const body of bad) {
      const res = (await create.handler(req({}, body))) as { status: number };
      assert.equal(res.status, 400, JSON.stringify(body));
    }
  });

  it("422 si l'URL est refusée anti-SSRF — aucun endpoint, aucun audit", async () => {
    const { container, recorded } = bootWebhooks({ ssrf: true });
    const res = (await endpoint(container, "webhooks", "POST").handler(
      req({}, { url: "http://169.254.169.254/", events: ["*"] }),
    )) as { status: number };
    assert.equal(res.status, 422);
    assert.equal(recorded.length, 0);
  });

  it("503 si le service est désactivé", async () => {
    const { container } = bootWebhooks({ ready: false });
    const res = (await endpoint(container, "webhooks", "POST").handler(
      req({}, { url: "https://x.example.com", events: ["*"] }),
    )) as { status: number };
    assert.equal(res.status, 503);
  });
});

describe("GET webhooks/{id}", () => {
  it("renvoie l'endpoint sans secret, 404 sinon", async () => {
    const { container } = bootWebhooks();
    const id = await seed(container);
    const get = endpoint(container, "webhooks/{id}", "GET");
    const ok = (await get.handler(req({ id }))) as Record<string, unknown>;
    assert.equal(ok.id, id);
    assert.ok(!("secretEnc" in ok));
    const miss = (await get.handler(req({ id: "wh_nope" }))) as {
      status: number;
    };
    assert.equal(miss.status, 404);
  });
});

describe("PATCH webhooks/{id}", () => {
  it("met à jour + audit des champs modifiés ; 404 inconnu", async () => {
    const { container, recorded } = bootWebhooks();
    const id = await seed(container);
    const patch = endpoint(container, "webhooks/{id}", "PATCH");
    const res = (await patch.handler(
      req({ id }, { enabled: false, description: "off" }),
    )) as Record<string, unknown>;
    assert.equal(res.enabled, false);
    assert.equal(res.description, "off");
    const ev = recorded.find((e) => e.action === "webhook.updated");
    assert.ok(ev, "audit webhook.updated émis");
    assert.deepEqual(ev!.metadata?.fields, ["enabled", "description"]);

    const miss = (await patch.handler(
      req({ id: "wh_nope" }, { enabled: true }),
    )) as {
      status: number;
    };
    assert.equal(miss.status, 404);
  });

  it("400 sur champ invalide", async () => {
    const { container } = bootWebhooks();
    const id = await seed(container);
    const patch = endpoint(container, "webhooks/{id}", "PATCH");
    for (const body of [
      { url: "" },
      { events: [] },
      { enabled: "x" },
      { description: 5 },
    ]) {
      const res = (await patch.handler(req({ id }, body))) as {
        status: number;
      };
      assert.equal(res.status, 400, JSON.stringify(body));
    }
  });

  it("422 si la nouvelle url est refusée anti-SSRF", async () => {
    const { container } = bootWebhooks({ ssrfUpdate: true });
    const id = await seed(container, "https://ok.example.com");
    const res = (await endpoint(container, "webhooks/{id}", "PATCH").handler(
      req({ id }, { url: "http://169.254.169.254/" }),
    )) as { status: number };
    assert.equal(res.status, 422);
  });
});

describe("DELETE webhooks/{id}", () => {
  it("supprime + audit webhook.deleted ; 404 au second appel", async () => {
    const { container, recorded } = bootWebhooks();
    const id = await seed(container);
    const del = endpoint(container, "webhooks/{id}", "DELETE");
    const res = (await del.handler(req({ id }))) as { ok: boolean };
    assert.deepEqual(res, { ok: true });
    assert.ok(
      recorded.some((e) => e.action === "webhook.deleted" && e.resource === id),
    );
    const miss = (await del.handler(req({ id }))) as { status: number };
    assert.equal(miss.status, 404);
  });
});

describe("POST webhooks/{id}/rotate", () => {
  it("renvoie un nouveau secret + audit ; 404 inconnu", async () => {
    const { container, recorded } = bootWebhooks();
    const id = await seed(container);
    const rotate = endpoint(container, "webhooks/{id}/rotate", "POST");
    const res = (await rotate.handler(req({ id }))) as {
      endpoint: { id: string };
      secret: string;
    };
    assert.match(res.secret, /^whsec_rot_/);
    assert.ok(recorded.some((e) => e.action === "webhook.rotated"));
    const miss = (await rotate.handler(req({ id: "wh_nope" }))) as {
      status: number;
    };
    assert.equal(miss.status, 404);
  });
});

describe("POST webhooks/{id}/reveal", () => {
  it("révèle le secret en clair + audit webhook.revealed ; 404 inconnu", async () => {
    const { container, recorded } = bootWebhooks();
    const id = await seed(container);
    const reveal = endpoint(container, "webhooks/{id}/reveal", "POST");
    const res = (await reveal.handler(req({ id }))) as { secret: string };
    assert.match(res.secret, /^whsec_/);
    const ev = recorded.find((e) => e.action === "webhook.revealed");
    assert.ok(ev, "révélation systématiquement audité");
    assert.equal(ev!.category, "webhook");
    assert.equal(ev!.actor, "admin1");
    assert.equal(ev!.resource, id);
    const miss = (await reveal.handler(req({ id: "wh_nope" }))) as {
      status: number;
    };
    assert.equal(miss.status, 404);
  });
});
