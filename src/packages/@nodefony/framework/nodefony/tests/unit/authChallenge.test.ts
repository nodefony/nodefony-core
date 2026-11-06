/// <reference types="node" />
import { expect, vi, afterEach } from "vitest";
import { Container, RequestContext, SESSION_AUTH_CHALLENGE } from "nodefony";
import type { IAdminEndpoint, IAdminResponse } from "nodefony";
import type { ContextType } from "@nodefony/http";
import AdminApiController from "../../controller/AdminApiController.js";
import Controller from "../../src/Controller.js";
import SecurityApiController from "../../src/SecurityApiController.js";

/**
 * RFC 9110 §15.5.2 — tout 401 porte un `WWW-Authenticate` (#734). Deux points
 * de passage le posent pour tous les producteurs : les routes de connexion
 * (`SecurityApiController`) et le plan d'administration de chaque module
 * (`AdminApiController.dispatch`). Un défi déjà posé garde la main.
 */

const ADMIN = "ROLE_NODEFONY_ADMIN";

async function dispatch(
  answer: IAdminResponse,
): Promise<Record<string, unknown>> {
  const endpoint: IAdminEndpoint = {
    path: "sessions/mine",
    method: "GET",
    handler: async () => answer,
  };
  const container = new Container();
  container.set("adminBroker", {
    resolve: () => ({
      name: "admin.http.sessions.mine",
      method: "GET",
      role: ADMIN,
      endpoint,
    }),
  });
  const context = {
    container,
    notificationsCenter: false,
    scheme: "https",
    type: "http",
    request: { headers: {}, body: {} },
  } as unknown as ContextType;
  const ctrl = new AdminApiController(context);
  let seen: Record<string, unknown> | null = null;
  Object.defineProperty(ctrl, "route", {
    value: { name: "admin.http.sessions.mine", variables: [] },
    configurable: true,
  });
  Object.defineProperty(ctrl, "query", { value: {}, configurable: true });
  Object.defineProperty(ctrl, "renderJson", {
    value: (_b: unknown, _s: unknown, headers: Record<string, unknown>) => {
      seen = headers;
    },
    configurable: true,
  });
  await RequestContext.run(
    {
      requestId: "challenge",
      context,
      user: { id: "u1", identifier: "admin", roles: [ADMIN] },
    },
    () => ctrl.dispatch(),
  );
  if (seen === null) throw new Error("aucun rendu");
  return seen;
}

describe("plan d'administration — un 401 porte un défi (RFC 9110 §15.5.2)", () => {
  it("401 rendu par un producteur : le défi de session est posé", async () => {
    const headers = await dispatch({
      status: 401,
      body: { error: "unauthenticated" },
    });
    expect(headers["www-authenticate"]).to.equal(SESSION_AUTH_CHALLENGE);
  });

  it("défi posé par le producteur : il garde la main", async () => {
    const headers = await dispatch({
      status: 401,
      headers: { "WWW-Authenticate": 'Bearer realm="api"' },
      body: { error: "unauthenticated" },
    });
    expect(headers["WWW-Authenticate"]).to.equal('Bearer realm="api"');
    expect(headers["www-authenticate"]).to.equal(undefined);
  });

  it("200 : aucun défi", async () => {
    const headers = await dispatch({ status: 200, body: {} });
    expect(headers["www-authenticate"]).to.equal(undefined);
  });
});

class ProbeController extends SecurityApiController {}

describe("routes de connexion — un 401 porte un défi (RFC 9110 §15.5.2)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function render(status: number, headers?: Record<string, string>) {
    const spy = vi
      .spyOn(Controller.prototype, "renderJson")
      .mockImplementation(() => undefined as never);
    // Sans constructeur : seule la règle de `renderJson` est éprouvée.
    const ctrl = Object.create(ProbeController.prototype) as ProbeController;
    void ctrl.renderJson({ error: "Unauthorized" }, status, headers);
    return spy.mock.calls[0]?.[2] as Record<string, unknown>;
  }

  it("401 : défi de session ET no-store", () => {
    const headers = render(401);
    expect(headers["www-authenticate"]).to.equal(SESSION_AUTH_CHALLENGE);
    expect(headers["cache-control"]).to.equal("no-store");
  });

  it("429 : ni défi, mais no-store", () => {
    const headers = render(429, { "retry-after": "1" });
    expect(headers["www-authenticate"]).to.equal(undefined);
    expect(headers["cache-control"]).to.equal("no-store");
  });
});
