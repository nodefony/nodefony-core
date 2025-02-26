import vm, { Context } from "node:vm";
import Container from "../Container";
import Service from "../Service";
import Kernel from "../kernel/Kernel";
import Module from "../kernel/Module";
import { extend } from "../Tools";
import chokidar, { ChokidarOptions } from "chokidar";
import serviceRollup from "./rollup/rollupService";
import {
  //rollup,
  RollupOptions,
  OutputChunk,
  OutputAsset,
  OutputOptions,
  RollupWatcher,
} from "rollup";

const defaultWatcherSettings: ChokidarOptions = {
  persistent: true,
  followSymlinks: true,
  alwaysStat: false,
  depth: 50,
  ignoreInitial: true,
  ignored: "**/node_modules/**",
  // usePolling: true,
  // interval: 500,
  // binaryInterval: 300,
  awaitWriteFinish: true,
  atomic: true, // or a custom 'atomicity delay', in milliseconds (default 100)
};

class Watcher extends Service {
  chokidar: typeof chokidar = chokidar;
  override options: ChokidarOptions;
  cache?: [OutputChunk, ...(OutputChunk | OutputAsset)[]];
  constructor(kernel: Kernel, options?: ChokidarOptions) {
    super("watcher", kernel.container as Container);
    this.options = extend(true, {}, defaultWatcherSettings, options);
  }

  async createRollupWatcher(
    module: Module,
    options: RollupOptions
  ): Promise<RollupWatcher> {
    return new Promise(async (resolve, reject) => {
      try {
        const service = this.get<serviceRollup>("rollup");
        if (service) {
          const rlwatcher: RollupWatcher = await service.watch(module, options);
          return resolve(rlwatcher);
        }
        throw new Error("service Rollup not defined");

        //const { ts, output } = await service.prepareWatch(options);
        //console.log(output);
        // const watcher = this.chokidar.watch(ts, this.options);
        // this.cache = output;
        // //console.log(this.cache);
        // watcher.on("ready", () => {
        //   this.log(watcher.getWatched(), "INFO", `WATCHER ${module.name}`);
        //   return resolve(watcher);
        // });

        // watcher.on("change", async (filePath) => {
        //   const changeOption = extend({}, options);
        //   changeOption.input = filePath;
        //   const bundle = await rollup(changeOption);
        //   const { output } = await bundle.generate(changeOption.output);
        //   const { code } = output[0];
        //   return await this.run(code, options);
        // });
        // watcher.on("error", (error) => {
        //   this.log(error, "ERROR", `WATCHER ${module.name}`);
        //   return reject(error);
        // });
        // this.kernel?.on("onTerminate", async () => {
        //   await watcher.close();
        //   this.log(`Watcher close`, "INFO", `WATCHER ${module.name}`);
        // });
      } catch (e) {
        return reject(e);
      }
    });
  }

  search(specifier: string, options: RollupOptions): OutputChunk | OutputAsset {
    const out = options.output as OutputOptions;
    const pre: string = out.preserveModules
      ? out.preserveModulesRoot || ""
      : "";

    if (this.cache) {
      for (const mod of this.cache) {
        const ele = mod as OutputChunk;
        //console.log(specifier.replace(/^(\.\/)/, ""), ele.fileName);
        if (ele.fileName === specifier.replace(/^(\.\/)/, "")) {
          return mod;
        }
        const elePre = `${pre}/${ele.fileName}`;
        if (elePre === specifier) {
          return mod;
        }
      }
    }
    throw new Error(`No Cache Found`);
  }

  async run(code: string, options: RollupOptions): Promise<void> {
    const linker: vm.ModuleLinker = function linker(
      this: Watcher,
      specifier: string,
      referencingModule: Context
    ) {
      const mod = this.search(specifier, options) as OutputChunk;
      if (mod) {
        return new vm.SourceTextModule(mod.code as string, {
          context: referencingModule.context,
        });

        // Using `contextifiedObject` instead of `referencingModule.context`
        // here would work as well.
      }
      throw new Error(`Unable to resolve dependency: ${specifier}`);
    }.bind(this);
    const newmodule = new vm.SourceTextModule(code, {
      //context: mymodule?.vmcontext,
    });
    //console.log(newmodule);
    await newmodule.link(linker);
    await newmodule.evaluate();
  }
}

export default Watcher;
