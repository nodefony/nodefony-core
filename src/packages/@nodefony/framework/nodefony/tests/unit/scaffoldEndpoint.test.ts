import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { IAdminRequest, IAdminResponse, IKernel } from "nodefony";

/**
 * `scaffold` / `scaffold/sync` du plan d'administration du kernel : la MÊME
 * fonction que `nodefony scaffold:sync`, en développement seulement. Décor :
 * une application temporaire dont un paquet installé recopie un thème.
 * `REPO_ROOT` est figé à l'import du producteur — `process.cwd` est donc
 * détourné AVANT de l'importer.
 */

const tmp = mkdtempSync(path.join(os.tmpdir(), "nf-scaffold-admin-"));
const app = path.join(tmp, "app");
const pkg = path.join(app, "node_modules", "@nodefony", "theme");

type Handler = (r: IAdminRequest) => Promise<IAdminResponse>;
let handlers: (env: string) => { plan: Handler; sync: Handler };

const deliver = (content: string): void => {
  mkdirSync(path.join(pkg, "assets"), { recursive: true });
  writeFileSync(path.join(pkg, "assets", "login.css"), content);
};
const installed = (): string =>
  readFileSync(path.join(app, "docker", "theme", "login.css"), "utf8");

beforeAll(async () => {
  mkdirSync(pkg, { recursive: true });
  writeFileSync(path.join(app, "package.json"), '{"name":"demo"}');
  writeFileSync(path.join(app, "nodefony.config.ts"), "export default {};\n");
  writeFileSync(
    path.join(pkg, "package.json"),
    JSON.stringify({
      name: "@nodefony/theme",
      version: "1.0.0",
      nodefony: { contribute: "./contribute.mjs" },
    }),
  );
  writeFileSync(
    path.join(pkg, "contribute.mjs"),
    `import path from "node:path";
     import { fileURLToPath } from "node:url";
     export function contribute(ctx) {
       ctx.copyTree(path.join(path.dirname(fileURLToPath(import.meta.url)), "assets"), "docker/theme");
     }`,
  );
  deliver("v1");
  vi.spyOn(process, "cwd").mockReturnValue(app);
  vi.resetModules();
  const { createKernelAdminApi } = await import("../../src/KernelAdminApi.js");
  handlers = (env) => {
    const api = createKernelAdminApi({
      environment: env,
      debug: false,
      getModules: () => ({}),
    } as unknown as IKernel);
    const find = (p: string): Handler => {
      const ep = api.adminEndpoints().find((e) => e.path === p);
      if (!ep) throw new Error(`${p} introuvable`);
      return ep.handler as Handler;
    };
    return { plan: find("scaffold"), sync: find("scaffold/sync") };
  };
  // `resetModules` puis l'import de `KernelAdminApi` retransforment tout son
  // graphe : 10 s dépassées sous la passe complète, sans rien de faux. Plafond
  // contre un blocage, pas une mesure.
}, 60_000);

afterAll(() => {
  vi.restoreAllMocks();
  rmSync(tmp, { recursive: true, force: true });
});

const req = (body: unknown = null): IAdminRequest =>
  ({ params: {}, query: {}, body }) as unknown as IAdminRequest;

describe("plan d'administration — scaffold:sync", () => {
  it("refuse hors développement, sans rien écrire", async () => {
    const { plan, sync } = handlers("production");
    expect(await plan(req())).toMatchObject({ status: 403 });
    expect(await sync(req({ update: true }))).toMatchObject({ status: 403 });
    expect(existsSync(path.join(app, "docker"))).toBe(false);
  });

  it("le plan n'écrit rien ; la synchronisation pose, puis --update rafraîchit", async () => {
    const { plan, sync } = handlers("development");
    expect(await plan(req())).toMatchObject({
      dryRun: true,
      totals: { written: 1, updated: 0 },
    });
    expect(existsSync(path.join(app, "docker"))).toBe(false);

    expect(await sync(req())).toMatchObject({ totals: { written: 1 } });
    expect(installed()).toBe("v1");

    deliver("v2");
    expect(await plan(req())).toMatchObject({ totals: { updated: 1 } });
    expect(await sync(req())).toMatchObject({
      dryRun: false,
      totals: { updated: 0, outdated: 1 },
    });
    expect(installed()).toBe("v1");
    expect(await sync(req({ update: true }))).toMatchObject({
      totals: { updated: 1 },
    });
    expect(installed()).toBe("v2");
  });

  it("lève la suspension du superviseur après le geste", async () => {
    await handlers("development").sync(req());
    expect(
      existsSync(
        path.join(app, "node_modules", ".cache", "nodefony", "supervisor.lock"),
      ),
    ).toBe(false);
  });
});
