import assert from "node:assert";
import { resolve } from "node:path";

import { defineConfig, isConfigDescriptor } from "../config/index";
import { defaultAppConfig } from "../config/defaults";
import {
  applyAppEnvOverrides,
  readAppEnvOverrideReport,
} from "../config/defineConfig";
import type { ConfigContext } from "../config/types";
import Kernel from "../kernel/Kernel";
import Module from "../kernel/Module";
import type { DefaultOptionsService } from "../Service";
import { Nodefony } from "../Nodefony";
import nodefonyError from "../Error";
import { SysExit } from "../cli/sysexits";

// Chemin d'un dossier réel portant un package.json (setPath du Module).
const PKG = resolve(process.cwd(), "package.json");

function makeKernelReal(opts = {}): Kernel {
  return new Kernel("development", null, { log: { active: false }, ...opts });
}

/** Pose ou supprime une var d'env (éviter `= undefined` → string "undefined"). */
function setEnvVar(k: string, v: string | undefined): void {
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
}

/** Exécute `fn` avec des overrides d'env, restaure l'état initial (delete inclus). */
function withEnv(
  over: Record<string, string | undefined>,
  fn: () => void,
): void {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(over)) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(over)) setEnvVar(k, v);
  try {
    fn();
  } finally {
    for (const k of Object.keys(over)) setEnvVar(k, saved[k]);
  }
}

/** Contexte d'env figé pour les tests de résolution par-env. */
function ctxOf(over: Partial<ConfigContext> = {}): ConfigContext {
  return {
    env: {},
    infra: { database: null, cache: null, logs: null },
    appEnv: "production",
    runtimeEnv: "production",
    isProd: true,
    isDev: false,
    isTest: false,
    ...over,
  };
}

describe("config — câblage Kernel boot (Lot 4 : loadApp + defineConfig)", () => {
  // `new Kernel()` écrase le singleton `Nodefony.getKernel()` → restauration pour
  // ne pas polluer les autres fichiers de la suite (piège connu).
  let prevKernel: Kernel | null;
  beforeAll(() => {
    prevKernel = Nodefony.getKernel();
  });
  afterAll(() => {
    Nodefony.setKernel(prevKernel as Kernel);
  });

  describe("buildConfigContext", () => {
    const buildCtx = (k: Kernel, env?: unknown): ConfigContext =>
      (
        k as unknown as { buildConfigContext(env?: unknown): ConfigContext }
      ).buildConfigContext(env);

    it("NODE_ENV=production → isProd, env = process.env", () => {
      withEnv({ NODE_ENV: "production" }, () => {
        const ctx = buildCtx(makeKernelReal());
        assert.strictEqual(ctx.runtimeEnv, "production");
        assert.strictEqual(ctx.isProd, true);
        assert.strictEqual(ctx.isDev, false);
        assert.strictEqual(ctx.isTest, false);
        assert.strictEqual(ctx.env, process.env);
      });
    });

    it("NODE_ENV=test → isTest (granularité conservée, ≠ collapse dev/prod)", () => {
      withEnv({ NODE_ENV: "test" }, () => {
        const ctx = buildCtx(makeKernelReal());
        assert.strictEqual(ctx.runtimeEnv, "test");
        assert.strictEqual(ctx.isTest, true);
        assert.strictEqual(ctx.isProd, false);
      });
    });

    it("dev normalisé (NODE_ENV=dev → development)", () => {
      withEnv({ NODE_ENV: "dev" }, () => {
        const ctx = buildCtx(makeKernelReal());
        assert.strictEqual(ctx.runtimeEnv, "development");
        assert.strictEqual(ctx.isDev, true);
      });
    });

    it("catalogue env fourni → ctx.env = catalogue (pas process.env)", () => {
      const catalog = { MY_VAR: "x" };
      assert.strictEqual(buildCtx(makeKernelReal(), catalog).env, catalog);
    });

    it("appEnv via APP_ENV (axe déploiement libre)", () => {
      withEnv({ NODE_ENV: "production", APP_ENV: "staging" }, () => {
        const ctx = buildCtx(makeKernelReal());
        assert.strictEqual(ctx.appEnv, "staging");
        assert.strictEqual(ctx.runtimeEnv, "production"); // moteur prod, env staging
      });
    });
  });

  describe("resolveAppOptions", () => {
    type ResolveFn = (
      raw: unknown,
      ctx: ConfigContext,
    ) => { options: Record<string, unknown>; wasDescriptor: boolean };
    const call = (k: Kernel, raw: unknown, ctx: ConfigContext) =>
      (k as unknown as { resolveAppOptions: ResolveFn }).resolveAppOptions(
        raw,
        ctx,
      );

    it("descripteur objet → résolu + défauts mergés, wasDescriptor=true", () => {
      const k = makeKernelReal();
      const { options, wasDescriptor } = call(
        k,
        defineConfig({ domain: "example.com" }),
        ctxOf(),
      );
      assert.strictEqual(wasDescriptor, true);
      assert.strictEqual(options.domain, "example.com");
      assert.strictEqual(options.templating, "eta"); // défaut framework mergé
    });

    it("descripteur FONCTION → applique ctx (par-env)", () => {
      const k = makeKernelReal();
      const desc = defineConfig((c) => ({
        domain: c.isProd ? "0.0.0.0" : "127.0.0.1",
      }));
      assert.strictEqual(
        call(k, desc, ctxOf({ isProd: true })).options.domain,
        "0.0.0.0",
      );
      assert.strictEqual(
        call(
          k,
          desc,
          ctxOf({ isProd: false, isDev: true, runtimeEnv: "development" }),
        ).options.domain,
        "127.0.0.1",
      );
    });

    it("objet brut (app legacy) → défauts framework mergés DESSOUS, user gagne", () => {
      const k = makeKernelReal();
      const { options, wasDescriptor } = call(k, { domain: "x" }, ctxOf());
      assert.strictEqual(wasDescriptor, false);
      assert.strictEqual(options.domain, "x"); // user override
      assert.strictEqual(options.templating, "eta"); // défaut framework mergé
    });

    it("config absente (undefined) → défauts framework complets (résilience)", () => {
      const k = makeKernelReal();
      const { options, wasDescriptor } = call(k, undefined, ctxOf());
      assert.strictEqual(wasDescriptor, false);
      // Une app SANS config boote sur defaultAppConfig (config toujours complète).
      assert.strictEqual(options.templating, "eta");
      assert.strictEqual(options.domain, "localhost");
      assert.deepStrictEqual(options.modules, []);
    });
  });

  describe("résilience — diagnostic config exceptionnel + défauts explicites", () => {
    type BootErr = nodefonyError & { exitCode?: number; presented?: boolean };
    const bootConfigError = (
      k: Kernel,
      title: string,
      detail: string,
      cause: unknown,
      hints: string[],
    ): BootErr =>
      (
        k as unknown as {
          bootConfigError: (
            t: string,
            d: string,
            c: unknown,
            h: string[],
          ) => BootErr;
        }
      ).bootConfigError(title, detail, cause, hints);

    it("bootConfigError → erreur marquée EX_CONFIG + presented, message explicite", () => {
      const k = makeKernelReal();
      const err = bootConfigError(
        k,
        "Configuration invalide",
        "détail",
        new Error("servers.http.port: Expected number"),
        ["corrige le port"],
      );
      assert.strictEqual(err.exitCode, SysExit.CONFIG);
      assert.strictEqual(err.presented, true);
      assert.match(err.message, /Configuration invalide/);
    });

    it("formatDefaults → explicite les valeurs PAR DÉFAUT du framework", () => {
      const k = makeKernelReal();
      const txt = (
        k as unknown as { formatDefaults(): string }
      ).formatDefaults();
      // Le message d'erreur doit montrer ce qui s'applique aux champs omis.
      assert.match(txt, /templating/);
      assert.match(txt, /domain/);
      assert.match(txt, /eta/);
    });

    it("descripteur avec config Zod-invalide → throw message clair (champ nommé)", () => {
      const k = makeKernelReal();
      const bad = defineConfig({
        servers: { http: { port: "nope" as unknown as number } },
      });
      assert.throws(
        () =>
          (
            k as unknown as {
              resolveAppOptions: (raw: unknown, ctx: ConfigContext) => unknown;
            }
          ).resolveAppOptions(bad, ctxOf()),
        /invalide.*port/s,
      );
    });

    it("fonction defineConfig qui lève → l'erreur remonte (enrobée au boot)", () => {
      const k = makeKernelReal();
      const desc = defineConfig(() => {
        throw new Error("boom par-env");
      });
      assert.throws(
        () =>
          (
            k as unknown as {
              resolveAppOptions: (raw: unknown, ctx: ConfigContext) => unknown;
            }
          ).resolveAppOptions(desc, ctxOf()),
        /boom par-env/,
      );
    });
  });

  describe("descripteur via super(options) — survie au spread de Service", () => {
    it("le symbole de marque survit → app.options reste un descripteur", () => {
      const k = makeKernelReal();
      const desc = defineConfig({ domain: "y" });
      // Reproduit le flux app : index.ts fait super("app", kernel, url, descripteur)
      // → Service applique { ...defaultOptions, ...descripteur } (spread shallow).
      const mod = new Module(
        "descApp",
        k,
        PKG,
        desc as unknown as DefaultOptionsService,
      );
      assert.strictEqual(
        isConfigDescriptor(mod.options),
        true,
        "le spread shallow doit préserver le symbole + resolve",
      );
      const { wasDescriptor, options } = (
        k as unknown as {
          resolveAppOptions: (
            raw: unknown,
            ctx: ConfigContext,
          ) => { options: Record<string, unknown>; wasDescriptor: boolean };
        }
      ).resolveAppOptions(mod.options, ctxOf());
      assert.strictEqual(wasDescriptor, true);
      assert.strictEqual(options.domain, "y");
    });
  });
});

// ─── NF__APP__* — override env de la config APP (ADR-0006, dernier trou) ───────

describe("config — NF__APP__* (override env de la config app)", () => {
  const freshMerged = (): Record<string, unknown> =>
    structuredClone(defaultAppConfig) as Record<string, unknown>;

  describe("applyAppEnvOverrides (pur)", () => {
    it("surcharge un champ top-level (domain) et un champ imbriqué (servers.http.port)", () => {
      const merged = freshMerged();
      const report = applyAppEnvOverrides(merged, {
        NF__APP__DOMAIN: "0.0.0.0",
        NF__APP__SERVERS__HTTP__PORT: "8080",
      });
      assert.strictEqual(merged.domain, "0.0.0.0");
      assert.strictEqual(
        (merged.servers as { http: { port: number } }).http.port,
        8080,
      );
      assert.strictEqual(report.applied.length, 2);
      assert.strictEqual(report.warnings.length, 0);
    });

    it("résolution casse-insensible vers la clé réelle (log.driver)", () => {
      const merged = freshMerged();
      applyAppEnvOverrides(merged, { NF__APP__LOG__DRIVER: "file" });
      assert.strictEqual((merged.log as { driver: string }).driver, "file");
    });

    it("ignore les overrides d'un MODULE et le catalogue NF_ (simple underscore)", () => {
      const merged = freshMerged();
      const report = applyAppEnvOverrides(merged, {
        NF__SECURITY__JWT__ACCESSTTLS: "300", // module, pas app
        NF_LOG_DRIVER: "file", // catalogue nommé, pas un override
        NF__APP__DOMAIN: "1.2.3.4",
      });
      assert.strictEqual(merged.domain, "1.2.3.4");
      assert.strictEqual(report.applied.length, 1); // seul NF__APP__DOMAIN
    });

    it("chemin inconnu → warning « did you mean » + cible inchangée (pas de clé fantôme)", () => {
      const merged = freshMerged();
      const before = structuredClone(merged);
      const report = applyAppEnvOverrides(merged, { NF__APP__DOMAINN: "x" });
      assert.deepStrictEqual(merged, before);
      assert.strictEqual(report.applied.length, 0);
      assert.strictEqual(report.warnings.length, 1);
      assert.match(report.warnings[0], /chemin "domainn" inconnu/);
      assert.match(report.warnings[0], /vouliez-vous dire « domain »/);
    });

    it("marque le drapeau secret pour un chemin sensible", () => {
      // champ porteur de défaut + nom sensible : log.* n'a pas de secret ; on teste
      // le drapeau via un chemin présent au nom sensible (ajouté à la cible).
      const merged = freshMerged() as Record<string, unknown>;
      (merged as { token?: string }).token = "default";
      const report = applyAppEnvOverrides(merged, { NF__APP__TOKEN: "s3cr3t" });
      assert.strictEqual(report.applied.length, 1);
      assert.strictEqual(report.applied[0].secret, true);
    });
  });

  describe("fail-closed via defineConfig().resolve (le Zod app voit l'override)", () => {
    it("valeur VALIDE : l'override traverse jusqu'à la config résolue + rapport attaché", () => {
      const desc = defineConfig(() => ({}));
      withEnv({ NF__APP__SERVERS__HTTP__PORT: "8080" }, () => {
        const resolved = desc.resolve(ctxOf()) as {
          servers: { http: { port: number } };
        };
        assert.strictEqual(resolved.servers.http.port, 8080);
        const report = readAppEnvOverrideReport(resolved);
        assert.ok(report);
        assert.strictEqual(report?.applied.length, 1);
      });
    });

    it("valeur INVALIDE : resolve REJETTE (validateAppConfig fail-closed)", () => {
      const desc = defineConfig(() => ({}));
      withEnv({ NF__APP__SERVERS__HTTP__PORT: "abc" }, () => {
        assert.throws(
          () => desc.resolve(ctxOf()),
          /Configuration d'application invalide.*servers\.http\.port/s,
        );
      });
    });

    it("sans NF__APP__* : rapport vide, aucune surcharge", () => {
      const desc = defineConfig(() => ({ domain: "127.0.0.1" }));
      const resolved = desc.resolve(ctxOf()) as { domain: string };
      assert.strictEqual(resolved.domain, "127.0.0.1");
      const report = readAppEnvOverrideReport(resolved);
      assert.strictEqual(report?.applied.length, 0);
      assert.strictEqual(report?.warnings.length, 0);
    });
  });

  describe("surfaçage Kernel (rapport → log après resolve)", () => {
    let prev: Kernel | null;
    beforeAll(() => {
      prev = Nodefony.getKernel();
    });
    afterAll(() => {
      Nodefony.setKernel(prev as Kernel);
    });

    it("override appliqué → INFO ; chemin inconnu → WARNING « did you mean »", () => {
      const k = makeKernelReal();
      const logs: Array<{ msg: string; sev?: string }> = [];
      (k as unknown as { log: (m: string, s?: string) => void }).log = (
        m: string,
        s?: string,
      ): void => {
        logs.push({ msg: m, sev: s });
      };
      let resolved: unknown;
      withEnv({ NF__APP__DOMAIN: "0.0.0.0", NF__APP__DOMAINN: "x" }, () => {
        resolved = defineConfig(() => ({})).resolve(ctxOf());
      });
      (
        k as unknown as { surfaceAppEnvOverrides(o: unknown): void }
      ).surfaceAppEnvOverrides(resolved);
      assert.ok(
        logs.some(
          (l) => l.sev === "INFO" && /Override env app: domain/.test(l.msg),
        ),
      );
      assert.ok(
        logs.some(
          (l) =>
            l.sev === "WARNING" && /vouliez-vous dire « domain »/.test(l.msg),
        ),
      );
    });
  });
});
