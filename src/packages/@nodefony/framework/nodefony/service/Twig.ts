import { Module, FileClass, extend, injectable } from "nodefony";
import twig from "twig";
import Template from "../src/Template";
import { PathOrFileDescriptor } from "fs";

const twigOptions: twig.RenderOptions = {
  "twig options": {
    async: true,
    allowAsync: true,
    cache: true,
  },
  views: null,
};

injectable();
class Twig extends Template {
  declare engine: typeof twig;

  constructor(module: Module) {
    super("twig", twig, module, extend(true, {}, twigOptions));
  }

  async render(view: FileClass, param: any): Promise<string> {
    try {
      const template = await this.compile(view).catch((e) => {
        throw e;
      });
      if (template) {
        return template(param);
      }
      throw new Error(`Twig bad Template`);
    } catch (e) {
      throw e;
    }
  }

  renderFile(file: PathOrFileDescriptor | FileClass, options = {}) {
    return new Promise((resolve, reject) => {
      try {
        if (!(file instanceof FileClass)) {
          file = new FileClass(file);
        }
        const mypath = file.path as string;
        const settings = extend(
          true,
          {},
          this.options,
          {
            views: file.dirname,
            allowAsync: true,
            "twig options": {
              cache: this.cache,
            },
          },
          options
        );
        return this.engine.renderFile(mypath, settings, (error, result) => {
          if (error || result === undefined) {
            if (!error) {
              error = new Error(`ERROR PARSING TEMPLATE :${mypath} `);
              return reject(error);
            }
            return reject(error);
          }
          return resolve(result);
        });
      } catch (e) {
        return reject(e);
      }
    });
  }

  compile(file: FileClass): Promise<(context: any) => any> {
    return new Promise(async (resolve, reject) => {
      try {
        const read = await file.readAsync();
        //@ts-ignore
        const opt: twig.CompileOptions = {
          filename: file.name,
          //@ts-ignore
          settings: {
            "twig options": {
              async: true,
              allowAsync: true,
              cache: this.kernel?.environment,
            },
          },
        };
        return resolve(this.engine.compile(read.toString(), opt));
        // this.engine.twig({
        //   path: file.path,
        //   async: true,
        //   base: file.dirName,
        //   name: file.name,
        //   load: (template) => {
        //     console.log("template");
        //     return resolve(template);
        //   },
        // });
      } catch (error) {
        return reject(error);
      }
    });
  }

  extendFunction(name: string, definition: (...params: any[]) => string) {
    return this.engine.extendFunction(name, definition);
  }

  extendFilter(
    name: string,
    definition: (left: any, params: false | any[]) => string
  ) {
    return this.engine.extendFilter(name, definition);
  }
}

export default Twig;
