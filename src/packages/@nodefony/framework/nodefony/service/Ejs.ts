import { Module, extend, injectable } from "nodefony";
import ejs from "ejs";
import Template from "../src/Template";

const defaultOption = {
  cache: false,
};

injectable();
class Ejs extends Template {
  declare engine: typeof ejs;
  constructor(module: Module) {
    super("ejs", ejs, module, extend(true, {}, defaultOption));
  }

  async render(
    str: string,
    data?: ejs.Data,
    options?: ejs.Options
  ): Promise<string> {
    return this.engine.render(str, data, options);
  }

  async compile(
    str: string,
    options: ejs.Options
  ): Promise<ejs.AsyncTemplateFunction> {
    return this.engine.compile(str, options) as ejs.AsyncTemplateFunction;
  }

  async renderFile(
    path: string,
    data?: ejs.Data,
    options?: ejs.Options
  ): Promise<string> {
    return this.engine.renderFile(path, data, options).catch((e) => {
      this.log(e, "ERROR");
      throw e;
    });
  }
}

export default Ejs;
