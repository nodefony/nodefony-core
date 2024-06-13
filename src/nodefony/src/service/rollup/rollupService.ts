import path from "node:path";
import Kernel from "../../kernel/Kernel";
import Module from "../../kernel/Module";
import Service from "../../Service";
import Container from "../../Container";
import { writeFile } from "node:fs/promises";
import { /*fileURLToPath,*/ pathToFileURL } from "url";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import commonjs from "@rollup/plugin-commonjs";
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

class Rollup extends Service {
  //public rollup: typeof rollup;
  private watchers: RollupWatcher[] = [];
  constructor(kernel: Kernel) {
    super("rollup", kernel.container as Container);
  }

  static setDefaultConfig(
    module: Module,
    environment: EnvironmentType = "development",
    handlerLog?: (level: LogLevel, log: RollupLog) => void
  ): RollupOptions {
    const plugins = [];
    const tsPlugin = typescript({
      tsconfig: path.resolve(module.path, "tsconfig.json"),
      //sourceMap: true,
      declaration: true,
      declarationDir: path.resolve(module.path, "dist", "types"),
    });
    const resolvePlugin = nodeResolve({ preferBuiltins: true });
    const commonjsPlugin = commonjs({
      //extensions: [".js"],
      exclude: /node_modules/,
    });
    if (environment === "production") {
      plugins.push(terser());
    }
    plugins.push(json());
    plugins.push(tsPlugin);
    plugins.push(resolvePlugin);
    plugins.push(commonjsPlugin);
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
      "tslib"
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
        //sourcemap: true,
      },
      external,
      plugins,
      onwarn(warning, warn) {
        if (warning.message.includes("Circular dependency")) {
          return;
        }
        warn(warning);
      },
      onLog: handlerLog,
    });
  }

  loggerRollup(module: Module, level: LogLevel, log: RollupLog) {
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
    options?: RollupWatchOptions
  ): Promise<RollupWatcher> {
    if (!options) {
      const mylog = function (this: Rollup, level: LogLevel, log: RollupLog) {
        this.loggerRollup(module, level, log);
        //handler(level, log);
      }.bind(this);
      options = Rollup.setDefaultConfig(
        module,
        this.kernel?.environment,
        mylog
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
        // (event as { code: string; result: RollupBuild }).result.close();
        if (event.result && event.result.write) {
          //console.log(event.result);
          //await event.result.generate(options?.output as OutputOptions);
          await event.result.write(options?.output as OutputOptions);
          //console.log(output);
          this.log(
            `write rollup bundle in : ${(options?.output as OutputOptions)?.dir}`,
            "INFO",
            `Rollup Module ${module.name}`
          );
        }
      }
      if (event.code === "ERROR") {
        this.log(event.error, "ERROR", `Rollup Module ${module.name}`);
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
