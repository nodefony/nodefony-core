/// <reference types="node" />
import { expect } from "vitest";
import { Container, RequestContext, nodefonyError } from "nodefony";
import type { IAdminEndpoint } from "nodefony";
import AdminApiController from "../../controller/AdminApiController.js";
import type { ContextType } from "@nodefony/http";

/**
 * Un endpoint d'administration qui reçoit un mot de passe (`credentials: true`,
 * ex. `POST me/password`) est soumis, côté HTTP et pont WS, au refus du clair
 * en production. Ce banc tient le BRANCHEMENT : le contrôleur fournit à la
 * porte unique la politique `credentialTransport` (posée par security) appliquée
 * à SA requête. La décision elle-même est éprouvée côté security et cœur.
 */

const ADMIN = "ROLE_NODEFONY_ADMIN";

/** Politique factice : refuse tout scheme autre que https, et note la porte. */
function strictPolicy(doors: string[]) {
  return {
    assert(context: { readonly scheme?: string }, door: string): void {
      doors.push(door);
      if (context.scheme !== "https") {
        throw new nodefonyError("Credentials must be sent over HTTPS", 403);
      }
    },
  };
}

async function run(opts: {
  scheme: string;
  credentials: boolean;
  policy: ReturnType<typeof strictPolicy> | null;
}): Promise<{ status: unknown; body: unknown; called: boolean }> {
  let called = false;
  const endpoint: IAdminEndpoint = {
    path: "me/password",
    method: "POST",
    credentials: opts.credentials,
    handler: async () => {
      called = true;
      return { ok: true };
    },
  };
  const container = new Container();
  container.set("adminBroker", {
    resolve: () => ({
      name: "admin.user.me.password",
      method: "POST",
      role: ADMIN,
      endpoint,
    }),
  });
  if (opts.policy) container.set("credentialTransport", opts.policy);
  const context = {
    container,
    notificationsCenter: false,
    scheme: opts.scheme,
    type: "http",
    request: { headers: {}, queryPost: {} },
  } as unknown as ContextType;
  const ctrl = new AdminApiController(context);
  let rendered: { status: unknown; body: unknown } | null = null;
  Object.defineProperty(ctrl, "route", {
    value: { name: "admin.user.me.password", variables: [] },
    configurable: true,
  });
  Object.defineProperty(ctrl, "queryPost", {
    value: { currentPassword: "a", newPassword: "b" },
    configurable: true,
  });
  Object.defineProperty(ctrl, "query", { value: {}, configurable: true });
  Object.defineProperty(ctrl, "renderJson", {
    value: (body: unknown, status: unknown): void => {
      rendered = { body, status };
    },
    configurable: true,
  });
  await RequestContext.run(
    {
      requestId: "a4-admin",
      context,
      user: { id: "u1", identifier: "admin", roles: [ADMIN] },
    },
    () => ctrl.dispatch(),
  );
  const out: { status: unknown; body: unknown } = rendered ?? {
    status: null,
    body: null,
  };
  return { ...out, called };
}

describe("Plan d'administration — mot de passe reçu en clair", () => {
  it("endpoint `credentials` en http → 403, handler jamais appelé, porte nommée", async () => {
    const doors: string[] = [];
    const out = await run({
      scheme: "http",
      credentials: true,
      policy: strictPolicy(doors),
    });
    expect(out.status).to.equal(403);
    expect(out.called).to.equal(false);
    expect(doors).to.deep.equal(["admin admin.user.me.password"]);
  });

  it("endpoint `credentials` en https → exécuté", async () => {
    const out = await run({
      scheme: "https",
      credentials: true,
      policy: strictPolicy([]),
    });
    expect(out.status).to.equal(200);
    expect(out.called).to.equal(true);
  });

  it("endpoint SANS drapeau en http → exécuté, politique jamais consultée", async () => {
    const doors: string[] = [];
    const out = await run({
      scheme: "http",
      credentials: false,
      policy: strictPolicy(doors),
    });
    expect(out.called).to.equal(true);
    expect(doors).to.deep.equal([]);
  });

  it("security absent (aucune politique) → exécuté", async () => {
    const out = await run({ scheme: "http", credentials: true, policy: null });
    expect(out.called).to.equal(true);
  });
});
