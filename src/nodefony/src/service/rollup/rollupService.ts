import path from "node:path";
import Kernel from "../../kernel/Kernel";
import Module from "../../kernel/Module";
import Service from "../../Service";
import Container from "../../Container";
import { writeFile } from "node:fs/promises";
import { /*fileURLToPath,*/ pathToFileURL } from "url";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import json from "@rollup/plugin-json";
import terser from "@rollup/plugin-terser";
import { Severity } from "../../syslog/Pdu";
import { EnvironmentType } from "../../types/globals";
import {
  rollup,
  RollupOptions,
  OutputOptions,
  defineConfig,
  LogLevel,
  RollupLog,
} from "rollup";

/**
 * Service Rollup runtime — fournit la config Rollup par défaut et le **build
 * one-shot** des modules (`nodefony build` via {@link Module.build}).
 *
 * Le watch « write-only » (re-bundle dist/ sans recharger le process) a été
 * RETIRÉ : il ne reloadait rien (Node ne réimporte pas un module ESM déjà chargé)
 * et coûtait un re-bundle complet par sauvegarde. Le rechargement backend en dev
 * est désormais assuré par le `DevSupervisor` (auto-restart du process, build
 * CIBLÉ via turbo). Le HMR frontend reste géré par Vite.
 */
class Rollup extends Service {
  constructor(kernel: Kernel) {
    super("rollup", kernel.container as Container);
  }

  static setDefaultConfig(
    module: Module,
    environment: EnvironmentType = "development",
    handlerLog?: (level: LogLevel, log: RollupLog) => void,
  ): RollupOptions {
    const isDev = environment === "development";

    // Plugins dans l'ordre canonique Rollup : resolve → ts → json.
    // commonjs retiré : exclude=/node_modules/ + sources ESM → traite rien.
    const plugins = [];
    if (!isDev) {
      plugins.push(terser());
    }
    plugins.push(nodeResolve({ preferBuiltins: true }));
    plugins.push(
      typescript({
        tsconfig: path.resolve(module.path, "tsconfig.json"),
        sourceMap: isDev, // dev = stack traces lisibles ; prod = pas de leak source
        // declaration uniquement en build pur — en dev le watch ré-écrirait des
        // .d.ts vus aussi comme input via exports.types → cascade TS5055 + CPU.
        declaration: !isDev,
        declarationDir: !isDev
          ? path.resolve(module.path, "dist", "types")
          : undefined,
      }),
    );
    plugins.push(json());
    plugins.push({
      name: "transpile-import-meta",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resolveImportMeta(property: string | null, { moduleId }: any) {
        if (property === "url") {
          return `'${pathToFileURL(moduleId).href}'`;
        }
        if (property == null) {
          return `{url:'${pathToFileURL(moduleId).href}'}`;
        }
      },
    });

    // External : data array + matcher exact-match (id === e ou id.startsWith(e + '/')).
    // "nodefony" exclu du prefix match — sinon "nodefony/foo" (chunk preserveModules)
    // serait faussement externalisé.
    const external = module.getDependencies();
    external.push(
      "nodefony",
      "@nodefony/http",
      "@nodefony/security",
      "@nodefony/framework",
      "@nodefony/sequelize",
      "@nodefony/mongoose",
      // ORM Drizzle (orm-core + driver) : driver natif `better-sqlite3` non
      // bundlable → toujours externe au build runtime, comme sequelize/mongoose.
      "@nodefony/drizzle",
      "@nodefony/orm-core",
      "drizzle-orm",
      "@nodefony/test",
      "@nodefony/user",
      "tslib",
    );
    return defineConfig({
      treeshake: {
        moduleSideEffects: "no-external",
        propertyReadSideEffects: false,
        tryCatchDeoptimization: false,
      },
      input: path.resolve(module.path, "index.ts"),
      output: {
        dir: path.resolve(module.path, "dist"),
        entryFileNames: `[name].js`,
        exports: "named",
        format: "es",
        preserveModules: true,
        preserveModulesRoot: "nodefony",
        sourcemap: isDev,
      },
      external: (id) =>
        id !== "." &&
        external.some(
          (e) => id === e || (e !== "nodefony" && id.startsWith(e + "/")),
        ),
      plugins,
      onwarn(warning, warn) {
        if (warning.message.includes("Circular dependency")) return;
        // Garde la guard TS5055 par sécurité (même si declaration:false en dev).
        if (warning.message.includes("TS5055")) return;
        warn(warning);
      },
      onLog: handlerLog,
    });
  }

  loggerRollup(module: Module, level: LogLevel, log: RollupLog) {
    // TS5055 — le runtime watch tente de réécrire un .d.ts vu aussi comme input
    // (résolution via exports.types des workspaces voisins). Bruit pur ; pas
    // d'impact runtime. À investiguer pour fix root cause (refacto HMR).
    if (log.pluginCode === "TS5055" || log.message?.includes("TS5055")) return;
    // Circular dep : passe par onLog (pas onwarn) → filtrer ici aussi.
    if (log.message?.includes("Circular dependency")) return;

    let severity: Severity = "WARNING";
    switch (level) {
      case "warn":
        severity = "WARNING";
        break;
      case "info":
        severity = "INFO";
        break;
      case "debug":
        severity = "DEBUG";
        break;
      // Rollup peut envoyer level="error" via onLog — l'expose en ERROR au syslog
      // (sinon le default WARNING masquerait des erreurs critiques de plugin).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      case "error" as any:
        severity = "ERROR";
        break;
      default:
    }
    let message;
    if (log?.loc) {
      message = `(${log.plugin} plugin) ${log?.loc?.file} (${log?.loc?.column}:${log?.loc?.line}) ${log.pluginCode}: ${log.message}`;
    } else {
      message = `(${log.plugin} plugin)  ${log.pluginCode}: ${log.message}`;
    }

    const msgid = `Rollup ${module.name}`;
    this.log(message, severity, msgid);
  }

  // // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // async getModuleRollupConfig(module: Module): Promise<any> {
  //   return await loadConfigFile(
  //     path.resolve(module.path, "rollup.config.js"),
  //     {}
  //   );
  // }

  async getRollupConfigTs(module: Module): Promise<RollupOptions> {
    const tsconfig = path.resolve(module.path, "tsconfig.json");
    const options: RollupOptions = {
      input: path.resolve(module.path, "rollup.config.ts"),
      plugins: [
        typescript({
          tsconfig,
        }),
      ],
    };
    const bundle = await rollup(options);
    const file = path.resolve(module.path, "tmp", "rollup.config.js");
    const output: OutputOptions = {
      exports: "named",
      file,
      format: "es",
      plugins: [
        {
          name: "transpile-import-meta",
          resolveImportMeta(property, { moduleId }) {
            if (property === "url") {
              return `'${pathToFileURL(moduleId).href}'`;
            }
            if (property == null) {
              return `{url:'${pathToFileURL(moduleId).href}'}`;
            }
          },
        },
      ],
    };
    const {
      output: [{ code }],
    } = await bundle.generate(output as OutputOptions);
    await writeFile(file, code);
    const ele = await import(file);
    return {
      input: ele.default,
      external: module.getDependencies(),
    } as RollupOptions;
  }

}

export default Rollup;
