import { Service, Kernel, Module } from "nodefony";
import config from "./nodefony/config/config";
import Firewall from "./nodefony/service/firewall";

class Security extends Module {
  http: Module | null = null;

  constructor(kernel: Kernel) {
    super("security", kernel, config);
    this.http = this.kernel?.getModule("http") as Module;
  }

  override async onBoot(): Promise<this> {
    this.addService(Firewall);
    return Promise.resolve(this);
  }
}

export default Security;
