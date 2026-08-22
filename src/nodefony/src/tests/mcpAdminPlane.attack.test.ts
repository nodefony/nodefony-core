/// <reference types="node" />
import path from "node:path";
import { describe, it, expect } from "vitest";
import { adminReadCatalog } from "../kernel/adminPlane/catalog";
import { ADMIN_DEFAULT_ROLE } from "../kernel/adminPlane/adminRbac";
import {
  ADMIN_SCOPE_READ,
  ADMIN_SCOPE_WRITE,
} from "../kernel/adminPlane/adminCaller";
import { builtinMcpTools, collectMcpTools, callMcpTool } from "../mcp/tools";
import type { IAdminApi } from "../types/IAdminApi";
import type { IMcpCaller, IMcpToolResult } from "../types/IMcpTool";

/**
 * RED-TEAM — la porte MCP du plan d'administration.
 *
 * Ce que cette suite attaque : les PONTS que cette porte crée, pas les briques
 * qu'elle traverse. Un pont est un endroit où une identité, une garde ou une
 * donnée change de monde — ici `tools/list` → `tools/call`, scope de jeton →
 * rôle Nodefony, catalogue → exécution, arguments d'agent → producteur. Une
 * garde présente d'un côté et absente sur le pont est la faille qu'aucune
 * cheat-sheet ne décrit, parce qu'elle n'existe que dans cette architecture.
 *
 * Contrôle positif inclus : sans lui, « tout refuser » serait trivialement vert.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");

/** Ce que l'application chargée expose — avec les pièges du plan réel. */
function broker(options: { hostile?: boolean } = {}): {
  list(): readonly IAdminApi[];
} {
  return {
    list: () => [
      {
        adminNamespace: "kernel",
        adminDescriptor: () => ({ label: "Kernel" }),
        adminEndpoints: () => [
          {
            path: "modules",
            summary: "modules chargés",
            handler: () => ["@nodefony/http"],
          },
          {
            // Le producteur reçoit les variables telles quelles — c'est lui qui
            // garde son disque. Ce qu'on prouve ici : la porte ne FABRIQUE
            // aucun chemin et n'en donne pas plus que HTTP.
            path: "module/{name}/docs/{slug}",
            summary: "une page de doc",
            handler: (request: { params: Record<string, string> }) => ({
              recu: `${request.params.name}::${request.params.slug}`,
            }),
          },
          {
            path: "config/{module}",
            method: "PATCH",
            summary: "écrit la config",
            handler: () => ({ ecrit: true }),
          },
          {
            path: "me",
            public: true,
            summary: "mon compte",
            handler: (request: { user: unknown }) => ({ user: request.user }),
          },
          {
            path: "explose",
            summary: "handler qui lève",
            handler: () => {
              throw new Error("secret interne: /home/cci/.ssh/id_rsa");
            },
          },
          ...(options.hostile
            ? [
                {
                  path: "capricieux",
                  summary: "publie des capacités qui lèvent",
                  page: {
                    sortable: () => {
                      throw new Error("store indisponible");
                    },
                  },
                  handler: () => ({ ok: true }),
                },
              ]
            : []),
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
            handler: () => ({ secret: "fuite" }),
          },
        ],
      } as unknown as IAdminApi,
    ],
  };
}

function outils(options: { hostile?: boolean } = {}) {
  return builtinMcpTools({
    broker: broker(options),
    getCard: () => ({ app: "banc" }),
    projectRoot: REPO_ROOT,
  });
}

/** Le porteur d'un jeton, tel que la porte l'établit après vérification. */
function porteur(
  scopes: readonly string[],
  roles: readonly string[] = [ADMIN_DEFAULT_ROLE],
): IMcpCaller {
  return { authenticated: true, scopes, roles };
}

function texte(result: IMcpToolResult): string {
  return (result.content[0] as { text: string }).text;
}

describe("RED-TEAM — pont `tools/list` → `tools/call`", () => {
  const deps = {
    broker: broker(),
    getCard: () => ({}),
    projectRoot: REPO_ROOT,
  };

  it("CONTRÔLE POSITIF — le porteur légitime obtient les deux outils et une donnée", async () => {
    const tools = collectMcpTools({
      builtins: ["admin_list", "admin_call"],
      deps,
      caller: porteur([ADMIN_SCOPE_READ]),
    });
    expect(tools.map((t) => t.name)).toEqual([
      "nodefony_admin_list",
      "nodefony_admin_call",
    ]);
    const reply = await callMcpTool(
      "nodefony_admin_call",
      { namespace: "kernel", path: "modules" },
      tools,
      porteur([ADMIN_SCOPE_READ]),
    );
    expect(JSON.parse(texte(reply as IMcpToolResult))).toEqual([
      "@nodefony/http",
    ]);
  });

  it("un outil RETENU n'est pas appelable en visant son nom directement", async () => {
    // L'attaque classique du catalogue filtré : la liste cache l'outil, mais
    // l'exécution accepte encore son nom. Ici la collecte gouverne les DEUX.
    const tools = collectMcpTools({
      builtins: ["admin_list", "admin_call"],
      deps,
      caller: porteur([]),
    });
    expect(tools).toHaveLength(0);
    expect(
      await callMcpTool(
        "nodefony_admin_call",
        { namespace: "kernel", path: "modules" },
        tools,
        porteur([]),
      ),
    ).toBe(null);
  });

  it("le scope d'ÉCRITURE seul n'ouvre pas la lecture par erreur de laxisme", () => {
    // `admin:write` n'est pas un sur-ensemble déclaré : l'outil exige
    // `admin:read`, et la vérification est « TOUS les scopes », pas « au moins
    // un ».
    const tools = collectMcpTools({
      builtins: ["admin_list", "admin_call"],
      deps,
      caller: porteur([ADMIN_SCOPE_WRITE]),
    });
    expect(tools).toHaveLength(0);
  });
});

describe("RED-TEAM — pont scope de jeton → rôle Nodefony", () => {
  it("le scope ne FABRIQUE pas le rôle : sans rôle, le catalogue est vide", async () => {
    // Un jeton peut passer la vérification d'audience ET porter le scope sans
    // que son sujet ait le moindre rôle. Le catalogue tranche sur le RÔLE.
    const rendu = texte(
      await outils().admin_list.handler({}, porteur([ADMIN_SCOPE_READ], [])),
    );
    expect(rendu).toContain("0 lectures appelables");
    expect(rendu).not.toContain("## kernel");
  });

  it("un rôle étranger n'ouvre pas un endpoint qui en exige un autre", () => {
    const vue = adminReadCatalog(broker(), {
      user: null,
      roles: ["ROLE_AUTRE_CHOSE"],
      label: "intrus",
    });
    expect(vue.entries).toHaveLength(0);
    expect(vue.denied).toBeGreaterThan(0);
  });
});

describe("RED-TEAM — pont catalogue → exécution", () => {
  const admin = porteur([ADMIN_SCOPE_READ]);

  it("une MUTATION n'est pas exécutable en la nommant par son chemin", async () => {
    const result = await outils().admin_call.handler(
      { namespace: "kernel", path: "config/{module}", params: { module: "x" } },
      admin,
    );
    expect(result.isError).toBe(true);
    expect(texte(result)).not.toContain('"ecrit"');
  });

  it("un self-service n'est pas servi avec un utilisateur ABSENT", async () => {
    // `public: true` ne veut pas dire « libre » : le handler lirait
    // `request.user`, qui vaut `null` sur une porte sans session — il rendrait
    // « les données de personne », ou celles d'autrui.
    const result = await outils().admin_call.handler(
      { namespace: "kernel", path: "me" },
      admin,
    );
    expect(result.isError).toBe(true);
    expect(texte(result)).not.toContain('"user"');
  });

  it("un endpoint hors des droits est refusé SANS révéler qu'il existe", async () => {
    const result = await outils().admin_call.handler(
      { namespace: "coffre", path: "secrets" },
      admin,
    );
    expect(result.isError).toBe(true);
    expect(texte(result)).not.toContain("fuite");
    // Ne pas trancher entre « n'existe pas » et « pas le droit » : les deux
    // causes sont énoncées ensemble, aucune n'est confirmée.
    expect(texte(result)).toMatch(/n'est pas chargé/u);
    expect(texte(result)).toMatch(/ne l'ouvre pas/u);
  });

  it("une traversée de chemin ne résout aucun endpoint", async () => {
    for (const cible of [
      { namespace: "kernel", path: "../coffre/secrets" },
      { namespace: "../kernel", path: "modules" },
      { namespace: "kernel", path: "modules/../../coffre/secrets" },
      { namespace: "KERNEL", path: "modules" },
      { namespace: "kernel", path: "MODULES" },
    ]) {
      const result = await outils().admin_call.handler(cible, admin);
      expect(result.isError, JSON.stringify(cible)).toBe(true);
      expect(texte(result)).not.toContain("fuite");
      expect(texte(result)).not.toContain("@nodefony/http");
    }
  });
});

describe("RED-TEAM — pont arguments d'agent → producteur", () => {
  const admin = porteur([ADMIN_SCOPE_READ]);

  it("les variables voyagent TELLES QUELLES — la porte ne fabrique aucun chemin", async () => {
    // Le producteur garde son propre disque (allowlist de `docsReader`). Ce
    // qu'on prouve ici : la porte ne concatène ni ne normalise, donc elle ne
    // peut pas transformer une valeur inoffensive en traversée, ni donner plus
    // que ce que la même requête donnerait en HTTP.
    const result = await outils().admin_call.handler(
      {
        namespace: "kernel",
        path: "module/{name}/docs/{slug}",
        params: { name: "../../etc", slug: "passwd" },
      },
      admin,
    );
    expect(JSON.parse(texte(result))).toEqual({ recu: "../../etc::passwd" });
  });

  it("une clé de pollution de prototype n'atteint pas Object.prototype", async () => {
    const avant = Object.keys(Object.prototype).length;
    await outils().admin_call.handler(
      {
        namespace: "kernel",
        path: "module/{name}/docs/{slug}",
        params: { name: "a", slug: "b", ["__proto__"]: { pollue: true } },
      },
      admin,
    );
    expect(Object.keys(Object.prototype)).toHaveLength(avant);
    expect(({} as Record<string, unknown>).pollue).toBeUndefined();
  });

  it("un handler qui LÈVE ne renvoie pas son message interne", async () => {
    const result = await outils().admin_call.handler(
      { namespace: "kernel", path: "explose" },
      admin,
    );
    expect(result.isError).toBe(true);
    // La porte a le droit de dire que ça a échoué, jamais de recopier un
    // chemin de disque ou un secret présent dans le message d'exception.
    expect(texte(result)).not.toContain("id_rsa");
    expect(texte(result)).not.toContain("/home/");
  });

  it("un argument non transportable est REFUSÉ, jamais jeté en silence", async () => {
    const result = await outils().admin_call.handler(
      {
        namespace: "kernel",
        path: "module/{name}/docs/{slug}",
        params: { name: ["a", "b"], slug: "x" },
      },
      admin,
    );
    expect(result.isError).toBe(true);
  });
});

describe("RED-TEAM — un producteur DÉFAILLANT ne doit pas fermer la porte", () => {
  const admin = porteur([ADMIN_SCOPE_READ]);

  it("des capacités de page qui lèvent n'emportent pas tout le catalogue", async () => {
    // Déni de service par un seul producteur : le catalogue ÉVALUE les
    // capacités déclarées (`sortable()` interroge le store branché). Si cette
    // évaluation peut lever, un module en panne — ou hostile — rend `admin_list`
    // ET `admin_call` inutilisables pour l'application entière.
    const result = await outils({ hostile: true }).admin_list.handler(
      {},
      admin,
    );
    expect(texte(result)).toContain("## kernel");
    expect(texte(result)).toContain("modules");
  });

  it("l'endpoint défaillant reste appelable malgré ses capacités illisibles", async () => {
    const result = await outils({ hostile: true }).admin_call.handler(
      { namespace: "kernel", path: "capricieux" },
      admin,
    );
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(texte(result))).toEqual({ ok: true });
  });
});

describe("RED-TEAM — passe 2 : les branches que la menace générique ne touche pas", () => {
  const admin = porteur([ADMIN_SCOPE_READ]);

  it("un producteur qui échoue à SE DÉCRIRE n'emporte pas les autres", () => {
    const cassé = {
      list: () => [
        {
          adminNamespace: "casse",
          adminDescriptor: () => ({ label: "Cassé" }),
          adminEndpoints: () => {
            throw new Error("module à moitié chargé");
          },
        } as unknown as IAdminApi,
        ...broker().list(),
      ],
    };
    const vue = adminReadCatalog(cassé, {
      user: null,
      roles: [ADMIN_DEFAULT_ROLE],
      label: "banc",
    });
    expect(vue.entries.some((e) => e.path === "modules")).toBe(true);
  });

  it("sans plan d'administration, le catalogue est vide et ne lève pas", async () => {
    const orphelin = builtinMcpTools({
      broker: undefined,
      getCard: () => ({}),
      projectRoot: REPO_ROOT,
    });
    expect(texte(await orphelin.admin_list.handler({}, admin))).toContain(
      "0 lectures appelables",
    );
    const appel = await orphelin.admin_call.handler(
      { namespace: "kernel", path: "modules" },
      admin,
    );
    expect(appel.isError).toBe(true);
  });

  it("un catalogue DÉMESURÉ est borné en NOMMANT un geste qui existe", async () => {
    const enorme = {
      list: () => [
        {
          adminNamespace: "gros",
          adminDescriptor: () => ({ label: "Gros" }),
          adminEndpoints: () =>
            Array.from({ length: 900 }, (_, i) => ({
              path: `ressource/tres/longue/${i}`,
              summary: `résumé volontairement long pour peser dans la réponse ${i}`,
              handler: () => null,
            })),
        } as unknown as IAdminApi,
      ],
    };
    const rendu = texte(
      await builtinMcpTools({
        broker: enorme,
        getCard: () => ({}),
        projectRoot: REPO_ROOT,
      }).admin_list.handler({}, admin),
    );
    // Des entrées RESTENT (le résumé générique de `mcpText` n'en garderait
    // aucune d'une chaîne), la coupe est dite, et le geste proposé existe.
    expect(rendu).toContain("ressource/tres/longue/0");
    expect(rendu).toContain("catalogue tronqué");
    expect(rendu).toContain("namespace:");
    expect(rendu.length).toBeLessThan(32_000);
  });

  it("convertit un nombre en texte, mais REFUSE ce qui ne voyage pas", async () => {
    // Un agent écrit `{ limit: 20 }` : le convertir est fidèle à son intention,
    // une URL ne transporte que du texte. Un objet, lui, se refuse.
    const ok = await outils().admin_call.handler(
      {
        namespace: "kernel",
        path: "module/{name}/docs/{slug}",
        params: { name: 42, slug: true },
      },
      admin,
    );
    expect(JSON.parse(texte(ok))).toEqual({ recu: "42::true" });

    const ko = await outils().admin_call.handler(
      {
        namespace: "kernel",
        path: "modules",
        query: { filtre: { profond: 1 } },
      },
      admin,
    );
    expect(ko.isError).toBe(true);
    expect(texte(ko)).toContain("query.filtre");
  });

  it("une liste est acceptée en QUERY (une URL en porte), refusée en PARAMS", async () => {
    const ok = await outils().admin_call.handler(
      { namespace: "kernel", path: "modules", query: { tag: ["a", "b"] } },
      admin,
    );
    expect(ok.isError).toBeUndefined();
  });

  it("un argument de restriction mal typé ne fait pas fuiter le catalogue entier", async () => {
    // `namespace` non textuel est ignoré comme restriction — il ne doit pas
    // devenir un contournement du filtrage par droits.
    const rendu = texte(
      await outils().admin_list.handler(
        { namespace: { $ne: null }, q: 42 },
        porteur([ADMIN_SCOPE_READ], []),
      ),
    );
    expect(rendu).toContain("0 lectures appelables");
  });
});
