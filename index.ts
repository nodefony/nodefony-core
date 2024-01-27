import { Kernel, Module } from "nodefony";
import config from "./nodefony/config/config";
import http from "@nodefony/http";
import security from "@nodefony/security";
import { fileURLToPath } from "url";

class App extends Module {
  constructor(kernel: Kernel) {
    super("app", kernel, fileURLToPath(import.meta.url), config);
    kernel?.use(http);
    kernel?.use(security);
  }

  // async onStart(): Promise<this> {
  //   this.log(`MODULE ${this.name} START`, "DEBUG");
  //   return this;
  // }
  // async onRegister(): Promise<this> {
  //   this.log(`MODULE ${this.name} REGISTER`, "DEBUG");
  //   return this;
  // }
  // async onBoot(): Promise<this> {
  //   this.log(`MODULE ${this.name} BOOT`, "DEBUG");
  //   return this;
  // }
  // async onReady(): Promise<this> {
  //   this.log(`MODULE ${this.name} READY`, "DEBUG");
  //   return this;
  // }
}

export default App;
