import { Service, Kernel, Module } from "nodefony";
import config from "./nodefony/config/config";
import Firewall from "./nodefony/service/firewall";
import { fileURLToPath } from "url";

class Security extends Module {
  http: Module | null = null;

  constructor(kernel: Kernel) {
    super("security", kernel, fileURLToPath(import.meta.url), config);
    this.http = this.kernel?.getModule("http") as Module;
  }

  // async onStart(): Promise<this> {
  //   this.log(`MODULE ${this.name} START`, "DEBUG");
  //   return this;
  // }
  async onRegister(): Promise<this> {
    this.log(`MODULE ${this.name} REGISTER`, "DEBUG");
    this.addService(Firewall);
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

export default Security;
