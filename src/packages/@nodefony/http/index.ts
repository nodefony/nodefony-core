import { Service, Kernel, Module } from "nodefony";
import config from "./nodefony/config/config";
import httpServer from "./nodefony/service/server-http";

class Http extends Module {
  constructor(kernel: Kernel) {
    super("http", kernel, config);
  }

  override async onBoot(): Promise<this> {
    this.kernel?.addService(httpServer);
    return Promise.resolve(this);
  }
}

export default Http;
