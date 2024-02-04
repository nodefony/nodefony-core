import { Kernel, Module } from "nodefony";
import config from "./nodefony/config/config";
import HttpKernel from "./nodefony/service/http-kernel";
import HttpServer from "./nodefony/service/servers/server-http";
import HttpsServer from "./nodefony/service/servers/server-https";
import WebsocketServer from "./nodefony/service/servers/server-websocket";
import WebsocketSecureServer from "./nodefony/service/servers/server-websocket-secure";
import StaticServer from "./nodefony/service/servers/server-static";
import networkCommand from "./nodefony/command/networkCommand";
import { fileURLToPath } from "url";
import Certificate from "./nodefony/service/certificates";

//console.log(path.resolve(__dirname));
class Http extends Module {
  httpKernel: HttpKernel | null = null;
  constructor(kernel: Kernel) {
    super("http", kernel, fileURLToPath(import.meta.url), config);
    this.httpKernel = null;
    this.addCommand(networkCommand);
    this.httpKernel = this.addService(HttpKernel) as HttpKernel;
    this.addService(Certificate, this.httpKernel);
  }

  async onStart(): Promise<this> {
    this.log(`MODULE ${this.name} START`, "DEBUG");
    this.addService(HttpServer, this.httpKernel);
    this.addService(HttpsServer, this.httpKernel);
    this.addService(StaticServer, this.httpKernel);
    this.addService(WebsocketServer, this.httpKernel);
    this.addService(WebsocketSecureServer, this.httpKernel);
    return this;
  }

  async onRegister(): Promise<this> {
    try {
    } catch (e) {
      this.log(e, "ERROR");
    }
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
