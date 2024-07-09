import { Service, Module, Container, Event, inject } from "nodefony";
import { HttpKernel } from "@nodefony/http";

const serviceName: string = "firewall";

class Firewall extends Service {
  module: Module;
  constructor(
    module: Module,
    @inject("HttpKernel") public httpKernel: HttpKernel
  ) {
    const container: Container = module.container as Container;
    const event: Event = module.notificationsCenter as Event;
    super(serviceName, container, event, module.options);
    this.module = module;
  }
}

export default Firewall;
