/**
 * **`config/schema` rend le CATALOGUE, là où `config` rend l'ÉTAT.**
 *
 * La différence est celle qu'on se pose en configurant : `config` répond
 * « qu'est-ce qui est posé, et d'où ça vient ? », celui-ci répond « qu'est-ce
 * que j'ai le droit d'écrire, et que fait cette clé ? ». Ces contrôles portent
 * sur le croisement — schéma × valeur effective × provenance — et sur le refus
 * NOMMÉ d'un module inconnu, qui est la seule façon de distinguer une faute de
 * frappe d'un module réellement sans configuration.
 */
import { expect } from "chai";
import { createKernelAdminApi } from "../../src/KernelAdminApi.js";
import type { IKernel, IAdminRequest, IAdminResponse } from "nodefony";

const httpSchema = {
  type: "object",
  properties: {
    headerServer: {
      type: "string",
      default: "nodefony",
      runtimeMutable: true,
      description: "Valeur de l'en-tête `Server:`.",
    },
    certificates: {
      type: "object",
      properties: {
        selfSigned: {
          type: "object",
          properties: {
            hash: {
              type: "string",
              enum: ["sha256", "sha512"],
              default: "sha256",
              description: "Hachage de la signature.",
            },
          },
        },
      },
    },
  },
};

interface MockMod {
  getModuleName: () => string;
  isApp: boolean;
  options: Record<string, unknown>;
  configSchema: () => unknown;
}

function makeKernel(modules: Record<string, unknown>): IKernel {
  return {
    environment: "development",
    debug: false,
    getModules: () => modules,
    container: { get: () => undefined },
  } as unknown as IKernel;
}

function makeHttpMod(options: Record<string, unknown>): MockMod {
  return {
    getModuleName: () => "@nodefony/http",
    isApp: false,
    options,
    configSchema: () => httpSchema,
  };
}

type Handler = (r: IAdminRequest) => IAdminResponse;

function catalogHandler(kernel: IKernel): Handler {
  const ep = createKernelAdminApi(kernel)
    .adminEndpoints()
    .find((e) => e.path === "config/schema");
  if (!ep) throw new Error("endpoint config/schema introuvable");
  return ep.handler as Handler;
}

function ask(kernel: IKernel, module?: string): unknown {
  return catalogHandler(kernel)({
    params: {},
    query: module === undefined ? {} : { module },
    body: null,
    user: null,
    roles: ["ROLE_NODEFONY_ADMIN"],
    requestId: "test",
  } as IAdminRequest);
}

/** Le décor courant : un module http avec sa config effective. */
function décor(options: Record<string, unknown> = {}): IKernel {
  return makeKernel({
    http: makeHttpMod({
      headerServer: "nodefony",
      certificates: { selfSigned: { hash: "sha256" } },
      ...options,
    }),
  });
}

interface Row {
  key: string;
  module: string;
  type: string;
  default?: unknown;
  effective: unknown;
  source: string;
  note: string;
  description: string;
}

describe("config/schema — le catalogue des clés qu'on a le droit d'écrire", () => {
  it("rend une ligne par clé assignable, chemin POINTÉ", () => {
    const rows = ask(décor()) as Row[];
    expect(rows.map((r) => r.key)).to.deep.equal([
      "headerServer",
      "certificates.selfSigned.hash",
    ]);
  });

  it("porte la DESCRIPTION du schéma — c'est ce qu'on venait chercher", () => {
    const rows = ask(décor()) as Row[];
    const hash = rows.find((r) => r.key === "certificates.selfSigned.hash");
    expect(hash?.description).to.equal("Hachage de la signature.");
    expect(hash?.type).to.equal("sha256|sha512");
  });

  it("croise le schéma avec la valeur EFFECTIVE du module", () => {
    const rows = ask(
      décor({ certificates: { selfSigned: { hash: "sha512" } } }),
    ) as Row[];
    const hash = rows.find((r) => r.key === "certificates.selfSigned.hash");
    expect(hash?.default).to.equal("sha256");
    expect(hash?.effective).to.equal("sha512");
  });

  it("distingue ce que l'APPLICATION pose de ce qui vient du défaut", () => {
    // La question qu'on se pose vraiment en surchargeant : est-ce MOI qui ai
    // écrit ça, ou le framework ?
    const rows = ask(
      décor({ certificates: { selfSigned: { hash: "sha512" } } }),
    ) as Row[];
    const bySource = Object.fromEntries(rows.map((r) => [r.key, r.source]));
    expect(bySource["certificates.selfSigned.hash"]).to.equal("app");
    expect(bySource.headerServer).to.equal("default");
  });

  it("nomme ce qui rend une clé PARTICULIÈRE (réservée, secrète, dérivée)", () => {
    const rows = ask(décor()) as Row[];
    expect(rows.find((r) => r.key === "headerServer")?.note).to.equal(
      "modifiable à chaud",
    );
  });

  it("filtre par nom de paquet ET par basename — on tape l'un, on écrit l'autre", () => {
    const kernel = décor();
    expect((ask(kernel, "@nodefony/http") as Row[]).length).to.equal(2);
    expect((ask(kernel, "http") as Row[]).length).to.equal(2);
    expect((ask(kernel, "HTTP") as Row[]).length).to.equal(2);
  });

  it("REFUSE en nommant un module inconnu, au lieu de rendre un catalogue vide", () => {
    // Une faute de frappe qui rend « aucune clé » se lit « ce module n'a pas
    // de configuration » — la conclusion exactement inverse de la vérité.
    const res = ask(décor(), "htp") as {
      status: number;
      body: { error: string; module: string; available: string[] };
    };
    expect(res.status).to.equal(404);
    expect(res.body.module).to.equal("htp");
    expect(res.body.available).to.include("@nodefony/http");
  });

  it("ignore un module SANS schéma plutôt que d'échouer sur lui", () => {
    // Un module non migré rend `null` : il ne doit pas priver les autres de
    // leur catalogue.
    const kernel = makeKernel({
      http: makeHttpMod({ headerServer: "nodefony" }),
      devkit: {
        getModuleName: () => "@nodefony/devkit",
        isApp: false,
        options: { enabled: true },
        configSchema: () => null,
      },
    });
    const rows = ask(kernel) as Row[];
    expect(rows.every((r) => r.module === "@nodefony/http")).to.equal(true);
  });
});
