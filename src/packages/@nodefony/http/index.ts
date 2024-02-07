import { Kernel, Module } from "nodefony";
import config from "./nodefony/config/config";
import HttpKernel from "./nodefony/service/http-kernel";
import HttpServer from "./nodefony/service/servers/server-http";
import HttpsServer from "./nodefony/service/servers/server-https";
import WebsocketServer from "./nodefony/service/servers/server-websocket";
import WebsocketSecureServer from "./nodefony/service/servers/server-websocket-secure";
import StaticServer from "./nodefony/service/servers/server-static";
import networkCommand from "./nodefony/command/networkCommand";
import sessionService from "./nodefony/service/sessions/sessions-service";
import { fileURLToPath } from "url";
import Certificate from "./nodefony/service/certificates";

//console.log(path.resolve(__dirname));
class Http extends Module {
  httpKernel: HttpKernel | null = null;
  constructor(kernel: Kernel) {
    super("http", kernel, fileURLToPath(import.meta.url), config);
    this.addCommand(networkCommand);
  }

  async initialize(): Promise<this> {
    this.httpKernel = (await this.addService(
      HttpKernel,
      this.kernel
    )) as HttpKernel;
    await this.addService(Certificate, this.httpKernel);
    return this;
  }

  async onKernelReady(): Promise<this> {
    try {
      //this.log(`MODULE ${this.name} READY`, "DEBUG");
      await this.addService(sessionService, this.httpKernel);
      await this.addService(HttpServer, this.httpKernel);
      await this.addService(HttpsServer, this.httpKernel);
      await this.addService(StaticServer, this.httpKernel);
      await this.addService(WebsocketServer, this.httpKernel);
      await this.addService(WebsocketSecureServer, this.httpKernel);
    } catch (e) {
      this.log(e, "ERROR");
      throw e;
    }
    return this;
  }
}

export default Http;
