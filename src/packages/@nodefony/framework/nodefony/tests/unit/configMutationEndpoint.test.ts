import { expect } from "chai";
import { createKernelAdminApi } from "../../src/KernelAdminApi.js";
import type { IKernel, IAdminRequest, IAdminResponse } from "nodefony";

const httpSchema = {
  type: "object",
  properties: {
    headerServer: { type: ["string", "null"], runtimeMutable: true },
    watch: { type: "boolean", reserved: true },
    jwt: {
      type: "object",
      properties: {
        secret: { type: "string", secret: true },
        accessTtlS: {
          type: "integer",
          minimum: 60,
          maximum: 3600,
          runtimeMutable: true,
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

function makeHttpMod(): MockMod {
  return {
    getModuleName: () => "@nodefony/http",
    isApp: false,
    options: {
      headerServer: "nodefony",
      watch: true,
      jwt: { secret: "s", accessTtlS: 900 },
    },
    configSchema: () => httpSchema,
  };
}

function makeKernel(opts: {
  env?: string;
  modules?: Record<string, unknown>;
  sink?: { record: (e: unknown) => void };
}): IKernel {
  return {
    environment: opts.env ?? "development",
    debug: false,
    getModules: () => opts.modules ?? {},
    container: {
      get: (n: string) => (n === "auditService" ? opts.sink : undefined),
    },
  } as unknown as IKernel;
}

type Handler = (r: IAdminRequest) => IAdminResponse;

function patchHandler(kernel: IKernel): Handler {
  const api = createKernelAdminApi(kernel);
  const ep = api
    .adminEndpoints()
    .find((e) => e.path === "config/{module}" && e.method === "PATCH");
  if (!ep) throw new Error("PATCH config/{module} endpoint not found");
  return ep.handler as Handler;
}

function req(
  module: string,
  body: unknown,
  extra: Partial<IAdminRequest> = {},
): IAdminRequest {
  return {
    params: { module },
    query: {},
    body,
    user: null,
    roles: ["ROLE_NODEFONY_ADMIN"],
    requestId: "test",
    ...extra,
  } as IAdminRequest;
}

describe("PATCH config/{module} — édition live (surface sensible)", () => {
  it("dev + champ runtimeMutable valide → 200, options mutées, audit émis", () => {
    const audited: unknown[] = [];
    const mod = makeHttpMod();
    const kernel = makeKernel({
      modules: { http: mod },
      sink: { record: (e) => audited.push(e) },
    });
    const res = patchHandler(kernel)(
      req("http", { path: "headerServer", value: null }),
    );
    expect(res.status).to.equal(200);
    expect(mod.options.headerServer).to.equal(null);
    expect(audited).to.have.length(1);
    expect((audited[0] as { action: string }).action).to.equal("config.update");
    expect((audited[0] as { category: string }).category).to.equal("config");
  });

  it("champ imbriqué runtimeMutable valide (jwt.accessTtlS)", () => {
    const mod = makeHttpMod();
    const kernel = makeKernel({ modules: { http: mod } });
    const res = patchHandler(kernel)(
      req("http", { path: "jwt.accessTtlS", value: 300 }),
    );
    expect(res.status).to.equal(200);
    expect((mod.options.jwt as { accessTtlS: number }).accessTtlS).to.equal(
      300,
    );
  });

  it("prod → 409 prod_immutable (12-factor)", () => {
    const kernel = makeKernel({
      env: "production",
      modules: { http: makeHttpMod() },
    });
    const res = patchHandler(kernel)(
      req("http", { path: "headerServer", value: "x" }),
    );
    expect(res.status).to.equal(409);
    expect((res.body as { reason: string }).reason).to.equal("prod_immutable");
  });

  it("module inconnu → 404", () => {
    const kernel = makeKernel({ modules: {} });
    const res = patchHandler(kernel)(req("nope", { path: "x", value: 1 }));
    expect(res.status).to.equal(404);
  });

  it("path manquant → 400", () => {
    const kernel = makeKernel({ modules: { http: makeHttpMod() } });
    const res = patchHandler(kernel)(req("http", { value: 1 }));
    expect(res.status).to.equal(400);
  });

  it("module sans schéma → 409 no_schema", () => {
    const mod = { ...makeHttpMod(), configSchema: () => null };
    const kernel = makeKernel({ modules: { http: mod } });
    const res = patchHandler(kernel)(
      req("http", { path: "headerServer", value: "x" }),
    );
    expect(res.status).to.equal(409);
    expect((res.body as { reason: string }).reason).to.equal("no_schema");
  });

  it("path inconnu → 404", () => {
    const kernel = makeKernel({ modules: { http: makeHttpMod() } });
    const res = patchHandler(kernel)(req("http", { path: "ghost", value: 1 }));
    expect(res.status).to.equal(404);
  });

  it("champ secret → 409 reason secret + recette *_FILE (jamais muté)", () => {
    const mod = makeHttpMod();
    const kernel = makeKernel({ modules: { http: mod } });
    const res = patchHandler(kernel)(
      req("http", { path: "jwt.secret", value: "leak" }),
    );
    expect(res.status).to.equal(409);
    expect((res.body as { reason: string }).reason).to.equal("secret");
    expect((res.body as { recipe: string }).recipe).to.contain("__FILE=");
    expect((mod.options.jwt as { secret: string }).secret).to.equal("s");
  });

  it("champ réservé (boot) → 409 reason reserved + recette", () => {
    const kernel = makeKernel({ modules: { http: makeHttpMod() } });
    const res = patchHandler(kernel)(
      req("http", { path: "watch", value: false }),
    );
    expect(res.status).to.equal(409);
    expect((res.body as { reason: string }).reason).to.equal("reserved");
  });

  it("valeur invalide (hors bornes) → 422, options inchangées", () => {
    const mod = makeHttpMod();
    const kernel = makeKernel({ modules: { http: mod } });
    const res = patchHandler(kernel)(
      req("http", { path: "jwt.accessTtlS", value: 5 }),
    );
    expect(res.status).to.equal(422);
    expect((mod.options.jwt as { accessTtlS: number }).accessTtlS).to.equal(
      900,
    );
  });
});
