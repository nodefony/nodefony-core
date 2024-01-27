import { Kernel, Module } from "nodefony";
import config from "./nodefony/config/config";
import httpServer from "./nodefony/service/server-http";
import HttpKernel from "./nodefony/service/http-kernel";
import networkCommand from "./nodefony/command/networkCommand";
import { fileURLToPath } from "url";

//console.log(path.resolve(__dirname));
class Http extends Module {
  httpKernel: HttpKernel | null = null;
  constructor(kernel: Kernel) {
    super("http", kernel, fileURLToPath(import.meta.url), config);
    this.httpKernel = null;
    this.addCommand(networkCommand);
    this.httpKernel = this.addService(HttpKernel) as HttpKernel;
  }

  // async onStart(): Promise<this> {
  //   this.log(`MODULE ${this.name} START`, "DEBUG");
  //   return this;
  // }
  async onRegister(): Promise<this> {
    this.addService(httpServer, this.httpKernel);
    this.log(`MODULE ${this.name} REGISTER`, "DEBUG");
    return this;
  }
  // async onBoot(): Promise<this> {
  //   this.log(`MODULE ${this.name} BOOT`, "DEBUG");
  //   return this;
  // }
  // async onReady(): Promise<this> {
  //   this.log(`MODULE ${this.name} READY`, "DEBUG");
  //   return this;
  // }
}

export default Http;
