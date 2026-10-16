/// <reference types="node" />
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  adminReadCatalog,
  findAdminReadEntry,
} from "../kernel/adminPlane/catalog";
import { ADMIN_DEFAULT_ROLE } from "../kernel/adminPlane/adminRbac";
import { ADMIN_SCOPE_READ } from "../kernel/adminPlane/adminCaller";
import type { IAdminCaller } from "../kernel/adminPlane/adminCaller";
import type { IAdminApi } from "../types/IAdminApi";
import type { IMcpCaller, IMcpToolResult } from "../types/IMcpTool";

/**
 * Ce que cette suite prouve : la porte MCP d'administration ne peut servir que
 * ce qu'elle annonce, et elle ANNONCE ce qu'elle ne sert pas.
 *
 * Le décor est un plan d'administration de banc, volontairement tordu là où le
 * code réel l'est : un chemin porté par deux méthodes, la mutation déclarée
 * AVANT la lecture — l'ordre exact qui faisait passer une résolution par le
 * seul chemin pour correcte.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");

/** L'administrateur — celui dont le jeton porte le scope de lecture. */
const ADMIN: IAdminCaller = {
  user: null,
  roles: [ADMIN_DEFAULT_ROLE],
  label: "banc",
};

/** Un porteur authentifié SANS rôle d'administration. */
const QUIDAM: IAdminCaller = { user: null, roles: [], label: "quidam" };

/** Plan d'administration de banc — un cas par exclusion à prouver. */
function broker(): { list(): readonly IAdminApi[] } {
  return {
    list: () => [
      {
        adminNamespace: "kernel",
        adminDescriptor: () => ({ label: "Kernel" }),
        adminEndpoints: () => [
          { path: "modules", summary: "modules chargés", handler: () => ["a"] },
          {
            path: "module/{name}",
            summary: "un module en détail",
            handler: (request: { params: Record<string, string> }) => ({
              vu: request.params.name,
            }),
          },
          {
            path: "config/{module}",
            method: "PATCH",
            summary: "écrit la config",
            handler: () => ({ written: true }),
          },
          {
            path: "sessions",
            summary: "sessions actives",
            page: {
              sortable: () => ["createdAt", "expiresAt"],
              filters: { status: ["active", "expired"] },
              search: () => true,
            },
            handler: () => ({ items: [] }),
          },
          {
            path: "livez",
            public: true,
            summary: "sonde de vie",
            handler: () => ({ ok: true }),
          },
        ],
      } as unknown as IAdminApi,
      {
        adminNamespace: "profiler",
        adminDescriptor: () => ({ label: "Profiler" }),
        // ⚠️ La MUTATION est déclarée EN PREMIER : c'est l'ordre qui piégeait
        // une résolution par le seul chemin.
        adminEndpoints: () => [
          {
            path: "recent",
            method: "DELETE",
            summary: "purge les profils",
            handler: () => ({ purged: true }),
          },
          {
            path: "recent",
            summary: "derniers profils",
            handler: () => ({ profils: [] }),
          },
        ],
      } as unknown as IAdminApi,
      {
        adminNamespace: "coffre",
        adminDescriptor: () => ({ label: "Coffre" }),
        adminEndpoints: () => [
          {
            path: "secrets",
            role: "ROLE_COFFRE",
            summary: "les secrets",
            handler: () => ({ secret: "non" }),
          },
        ],
      },
    ],
  };
}

describe("catalogue d'administration — ce qui est LISTÉ est APPELABLE", () => {
  it("ne retient que les lectures, et COMPTE les mutations écartées", () => {
    const vue = adminReadCatalog(broker(), ADMIN);
    expect(vue.entries.map((e) => `${e.namespace}/${e.path}`)).toEqual([
      "kernel/modules",
      "kernel/module/{name}",
      "kernel/sessions",
      "profiler/recent",
    ]);
    expect(vue.mutations).toBe(2); // PATCH config/{module} + DELETE recent
    expect(vue.total).toBe(8);
  });

  it("écarte les endpoints scopés à une session, et le COMPTE", () => {
    const vue = adminReadCatalog(broker(), ADMIN);
    expect(vue.entries.some((e) => e.path === "livez")).toBe(false);
    expect(vue.selfService).toBe(1);
  });

  it("écarte ce que le rôle de l'appelant n'ouvre pas", () => {
    const admin = adminReadCatalog(broker(), ADMIN);
    expect(admin.entries.some((e) => e.namespace === "coffre")).toBe(false);
    expect(admin.denied).toBe(1); // ROLE_COFFRE, que l'administrateur n'a pas

    const quidam = adminReadCatalog(broker(), QUIDAM);
    expect(quidam.entries).toHaveLength(0);
    expect(quidam.denied).toBe(5); // toutes les lectures, sonde exclue à part
  });

  it("ÉVALUE les capacités de page — le store branché répond, pas une constante", () => {
    const entry = adminReadCatalog(broker(), ADMIN).entries.find(
      (e) => e.path === "sessions",
    );
    expect(entry?.page).toEqual({
      sortable: ["createdAt", "expiresAt"],
      filters: ["status"],
      search: true,
    });
    // Un endpoint qui n'en déclare pas n'invente pas de capacité vide.
    expect(
      adminReadCatalog(broker(), ADMIN).entries.find(
        (e) => e.path === "modules",
      )?.page,
    ).toBeUndefined();
  });

  it("nomme les variables du chemin, dans l'ordre", () => {
    const vue = adminReadCatalog(broker(), ADMIN);
    const entry = vue.entries.find((e) => e.path === "module/{name}");
    expect(entry?.params).toEqual(["name"]);
  });

  it("restreint par producteur et par termes CUMULATIFS", () => {
    expect(
      adminReadCatalog(broker(), ADMIN, { namespace: "profiler" }).entries,
    ).toHaveLength(1);
    expect(
      adminReadCatalog(broker(), ADMIN, { q: "module détail" }).entries.map(
        (e) => e.path,
      ),
    ).toEqual(["module/{name}"]);
    expect(
      adminReadCatalog(broker(), ADMIN, { q: "module introuvable" }).entries,
    ).toHaveLength(0);
  });

  it("ne trouve jamais une entrée que le catalogue n'a pas listée", () => {
    expect(findAdminReadEntry(broker(), ADMIN, "kernel", "modules")).not.toBe(
      null,
    );
    expect(findAdminReadEntry(broker(), ADMIN, "kernel", "livez")).toBe(null);
    expect(
      findAdminReadEntry(broker(), ADMIN, "kernel", "config/{module}"),
    ).toBe(null);
    expect(findAdminReadEntry(broker(), QUIDAM, "kernel", "modules")).toBe(
      null,
    );
  });
});
