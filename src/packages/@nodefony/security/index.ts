import { Kernel, Module, services } from "nodefony";
import config from "./nodefony/config/config";
import Firewall from "./nodefony/service/firewall";
import SecuredArea, { optionsSecuredArea } from "./nodefony/src/securedArea";
import Authorization from "./nodefony/service/authorization";
import Cors from "./nodefony/service/cors";
import CsrfService, { Csrf } from "./nodefony/service/csrf";
import Helmet from "./nodefony/service/helmet";
import { HelmetOptions } from "helmet";
import { fileURLToPath } from "url";

@services([Firewall, Authorization, Cors, CsrfService, Helmet])
class Security extends Module {
  constructor(kernel: Kernel) {
    super("security", kernel, fileURLToPath(import.meta.url), config);
  }

  // async onStart(): Promise<this> {
  //   this.log(`MODULE ${this.name} START`, "DEBUG");
  //   return this;
  // }
  // async onRegister(): Promise<this> {
  //   this.log(`MODULE ${this.name} REGISTER`, "DEBUG");
  //   this.addService(Firewall);
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

export default Security;

export {
  Firewall,
  Authorization,
  Cors,
  CsrfService,
  Csrf,
  Helmet,
  SecuredArea,
  optionsSecuredArea,
  HelmetOptions,
};
