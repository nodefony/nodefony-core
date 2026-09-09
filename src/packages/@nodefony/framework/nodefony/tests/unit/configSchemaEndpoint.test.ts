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

  // #297 — la provenance MENT sur les objets libres : `computeConfigProvenance`
  // descend dans un objet quand les deux côtés en sont un, et produit
  // `areas.nodefony-admin = "app"`, jamais `areas` ; or le catalogue fait
  // d'`areas` une FEUILLE (pas de `properties`). Le lookup rate, `?? "default"`
  // tranche à tort — sur le firewall et la hiérarchie des rôles.
  it("la provenance d'un objet LIBRE agrège celle de ses sous-clés posées par l'app", () => {
    const schema = {
      type: "object",
      properties: {
        areas: {
          type: "object",
          default: {},
          description: "Zones du firewall — objet libre, une clé par zone.",
        },
        headerServer: { type: "string", default: "nodefony" },
      },
    };
    const kernel = makeKernel({
      security: {
        getModuleName: () => "@nodefony/security",
        isApp: false,
        options: {
          areas: { "nodefony-admin": { pattern: "^/nodefony" } },
          headerServer: "nodefony",
        },
        configSchema: () => schema,
      },
    });
    const rows = ask(kernel, "security") as Row[];
    const areas = rows.find((r) => r.key === "areas");
    expect(areas?.source, "objet libre peuplé par l'app").to.equal("app");
    expect(areas?.effective).to.deep.equal({
      "nodefony-admin": { pattern: "^/nodefony" },
    });
    expect(rows.find((r) => r.key === "headerServer")?.source).to.equal(
      "default",
    );
  });

  it("distingue « module inconnu » de « module chargé, schéma non publié », et dit quoi faire", () => {
    // `inspect schema test` rendait « Unknown module » alors que `@nodefony/test`
    // était chargé : le message disait exactement ce qu'il devait éviter.
    const kernel = makeKernel({
      http: makeHttpMod({ headerServer: "nodefony" }),
      test: {
        getModuleName: () => "@nodefony/test",
        isApp: false,
        options: {},
        configSchema: () => null,
      },
    });
    const res = ask(kernel, "test") as {
      status: number;
      body: { error: string; module: string; loaded: boolean; hint: string };
    };
    expect(res.status).to.equal(404);
    expect(res.body.error).to.not.equal("Unknown module");
    expect(res.body.loaded).to.equal(true);
    expect(res.body.module).to.equal("@nodefony/test");
    expect(res.body.hint).to.match(/configSchema/u);
    // Un module réellement absent garde son refus, avec la liste des connus.
    const absent = ask(kernel, "htp") as { body: { error: string } };
    expect(absent.body.error).to.equal("Unknown module");
  });

  it("marque « secret » toute clé que la redaction masque, pas seulement celles annotées", () => {
    const schema = {
      type: "object",
      properties: {
        jwt: {
          type: "object",
          properties: {
            secret: { type: "string", description: "Clé de signature." },
            ttl: { type: "number", default: 60 },
          },
        },
      },
    };
    const kernel = makeKernel({
      security: {
        getModuleName: () => "@nodefony/security",
        isApp: false,
        options: { jwt: { secret: "s3cr3t", ttl: 60 } },
        configSchema: () => schema,
      },
    });
    const rows = ask(kernel, "security") as Row[];
    const secret = rows.find((r) => r.key === "jwt.secret");
    expect(secret?.note).to.include("secret");
    expect(secret?.effective, "jamais la valeur en clair").to.not.equal(
      "s3cr3t",
    );
    expect(rows.find((r) => r.key === "jwt.ttl")?.note).to.not.include(
      "secret",
    );
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
