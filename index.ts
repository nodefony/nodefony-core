import { resolve } from "node:path";
import { Kernel, Module, modules } from "nodefony";
import { controllers } from "@nodefony/framework";
import config from "./nodefony/config/config";
//import http from "@nodefony/http";
//import security from "@nodefony/security";
//import framework from "@nodefony/framework";
//import sequelize from "@nodefony/sequelize";
//import Test from "@nodefony/test";
import AppController from "./nodefony/controllers/AppController";

/**
 * The App class extends the Module class and represents an application  entry point.
 */
@modules([
  "@nodefony/sequelize",
  //"@nodefony/mongoose",
  "@nodefony/http",
  "@nodefony/framework",
  "@nodefony/security",
  "@nodefony/test",
  //Test,
  //"@nodefony/redis",
])
@controllers([AppController])
class App extends Module {
  /**
   * Constructs an instance of the App class.
   * Usefull for adding commands cli
   * @param kernel - An instance of the Kernel class.
   */
  constructor(kernel: Kernel) {
    super("app", kernel, import.meta.url, config);
  }

  /**
   * Initializes the module by loading the http and security modules.
   *  Usefull for adding modules or services
   * @param kernel - An instance of the Kernel class.
   * @returns A promise that resolves to the instance of the App class.
   */
  async initialize(kernel: Kernel): Promise<this> {
    //   if (
    //     this.kernel?.environment === "production" ||
    //     this.kernel?.environment === "staging"
    //   ) {
    //     //await this.kernel?.addModule(http);
    //     //await this.kernel?.addModule(security);
    //     //await this.kernel?.addModule(framework);
    //     //await this.kernel?.addModule(sequelize);
    //   } else {
    //     //await this.kernel?.loadModule("@nodefony/http", false);
    //     //await this.kernel?.loadModule("@nodefony/security", false);
    //     //await this.kernel?.loadModule("@nodefony/framework", false);
    //     //await this.kernel?.loadModule("@nodefony/sequelize", false);
    //   }
    return this;
  }

  /**
   * Action of modulewhen kernel emit event onStart.
   * Usefull for adding modules or services
   * @returns A promise that resolves to the instance of the App class.
   */
  async onKernelStart(): Promise<this> {
    this.log(`MODULE ${this.name} START`, "DEBUG");
    return this;
  }

  /**
   * Action of module when kernel emit event onRegister .
   *  Usefull for adding modules or services
   * @returns A promise that resolves to the instance of the App class.
   */
  async onKernelRegister(): Promise<this> {
    this.log(`MODULE ${this.name} REGISTER`, "DEBUG");
    return this;
  }

  /**
   * Action of module when kernel emit event onBoot .
   *  Usefull for adding modules or services
   * @returns A promise that resolves to the instance of the App class.
   */
  async onKernelBoot(): Promise<this> {
    this.log(`MODULE ${this.name} BOOT`, "DEBUG");
    return this;
  }

  /**
   * Action of module when kernel emit event onReady .
   *  Usefull for adding modules or services
   * @returns A promise that resolves to the instance of the App class.
   */
  async onKernelReady(): Promise<this> {
    this.log(`MODULE ${this.name} READY`, "DEBUG");
    return this;
  }
}

export default App;
