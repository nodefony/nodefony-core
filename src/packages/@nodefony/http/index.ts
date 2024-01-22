import { Kernel, Module } from "nodefony";
import config from "./nodefony/config/config";
import httpServer from "./nodefony/service/server-http";
import HttpKernel from "./nodefony/service/http-kernel";

class Http extends Module {
  httpKernel: HttpKernel | null = null;
  constructor(kernel: Kernel) {
    super("http", kernel, config);
    this.httpKernel = null;
  }

  override async onBoot(): Promise<this> {
    this.httpKernel = this.addService(HttpKernel) as HttpKernel;
    this.addService(httpServer, this.httpKernel);
    return Promise.resolve(this);
  }
}

export default Http;
