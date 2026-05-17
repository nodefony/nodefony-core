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
  watch,
  RollupWatcher,
  RollupWatchOptions,
  RollupWatcherEvent,
  //RollupBuild,
  RollupOptions,
  OutputOptions,
  defineConfig,
  LogLevel,
  RollupLog,
  OutputChunk,
  OutputAsset,
} from "rollup";
//import { loadConfigFile } from "rollup/loadConfigFile";

/**
 * Service Rollup runtime — orchestre `rollup.watch()` pour chaque module en dev.
 *
 * État actuel : write-only watcher (rebuild → dist/ puis stop). PAS DE HMR.
 *
 * @todo HMR — pré-requis (à implémenter dans une phase ultérieure) :
 *   1. **Bus d'événements** ✅ (en place) : `rollup:bundle:end` et
 *      `rollup:bundle:error` émis depuis `watch()`. S'abonner via
 *      `kernel.on("rollup:bundle:end", (module, output) => ...)`.
 *   2. **Re-import dynamique** : `import(url + "?v=" + Date.now())` ou
 *      `vm.SourceTextModule` (voir squelette commenté dans Watcher.run).
 *   3. **API `hotReload(module)` par Module** : chaque consommateur décide
 *      QUOI faire (Router.refreshRoutes, Sequelize.reloadModels…).
 *   4. **Cleanup avant reload** : retirer listeners, fermer sockets, vider
 *      le scope DI du module — sinon double-bind garanti.
 *
 * Événements émis :
 * - `rollup:bundle:end` `(module: Module, output: OutputOptions)` — succès build
 * - `rollup:bundle:error` `(module: Module, error: Error)` — échec build
 */
class Rollup extends Service {
  //public rollup: typeof rollup;
  private watchers: RollupWatcher[] = [];
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

  async prepareWatch(options: RollupWatchOptions): Promise<{
    js: string[];
    ts: string[];
    output: [OutputChunk, ...(OutputAsset | OutputChunk)[]];
  }> {
    const bundle = await rollup(options);
    const js: string[] = [];
    const ts: string[] = [];
    // Générer le code
    //const dist = (options.output as OutputOptions)?.dir || "";
    const { output } = await bundle.generate(options.output as OutputOptions);
    for (const chunkOrAsset of output) {
      if (chunkOrAsset.type === "chunk") {
        //console.log(chunkOrAsset);
        //js.push(`${dist}/${chunkOrAsset.fileName}`);
        //ts.push(`${dist}/${chunkOrAsset.name}.ts`);
        js.push(chunkOrAsset.fileName);
        ts.push(chunkOrAsset.facadeModuleId as string);
      }
    }
    await bundle.close();
    return { js, ts, output };
  }

  async watch(
    module: Module,
    options?: RollupWatchOptions,
  ): Promise<RollupWatcher> {
    if (!options) {
      const mylog = function (this: Rollup, level: LogLevel, log: RollupLog) {
        this.loggerRollup(module, level, log);
        //handler(level, log);
      }.bind(this);
      options = Rollup.setDefaultConfig(
        module,
        this.kernel?.environment,
        mylog,
      );
    }
    options.watch = {
      clearScreen: true,
      exclude: [/node_modules/, /dist/],
      //include: []
    };
    this.log(`${options.input}`, "INFO", `Rollup Module ${module.name}`);
    const watcher = watch(options);
    watcher.on("event", async (event: RollupWatcherEvent) => {
      if (event.code === "BUNDLE_END") {
        if (event.result && event.result.write) {
          const out = options?.output as OutputOptions;
          await event.result.write(out);
          this.log(
            `write rollup bundle in : ${out?.dir}`,
            "INFO",
            `Rollup Module ${module.name}`,
          );
          // HMR hook : annonce qu'un nouveau bundle est disponible sur disk.
          // Les consommateurs (ORM, Router, etc.) peuvent s'abonner pour reload.
          // Pas await — fire-and-forget vers les listeners async via fireAsync.
          this.fireAsync("rollup:bundle:end", module, out).catch((e) =>
            this.log(e, "ERROR", `Rollup HMR hook ${module.name}`),
          );
        }
      }
      if (event.code === "ERROR") {
        this.log(event.error, "ERROR", `Rollup Module ${module.name}`);
        // HMR hook : annonce l'échec aux consommateurs (peuvent invalider leur état).
        this.fireAsync("rollup:bundle:error", module, event.error).catch((e) =>
          this.log(e, "ERROR", `Rollup HMR hook ${module.name}`),
        );
      }
    });
    // watcher.on("change", (id: string, change) => {
    //   console.log("change", id, change);
    // });
    watcher.on("close", () => {
      this.log("close", "INFO", `Rollup Module ${module.name}`);
    });
    this.kernel?.once("onTerminate", () => {
      watcher.close();
    });
    this.watchers.push(watcher);
    return watcher;
  }
}

export default Rollup;
