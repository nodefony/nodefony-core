import { Service, Module, Container, Event } from "nodefony";
import HttpKernel from "@nodefony/http/nodefony/service/http-kernel";

const serviceName: string = "firewall";

class Firewall extends Service {
  httpKernel: HttpKernel | null = null;
  constructor(module: Module) {
    const container: Container = module.container as Container;
    const event: Event = module.notificationsCenter as Event;
    super(serviceName, container, event, module.options);
    this.httpKernel = this.get("httpKernel") as HttpKernel;
  }
}

export default Firewall;
