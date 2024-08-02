import { Service, Module, Container, Event, inject } from "nodefony";
import { HttpContext, HttpKernel } from "@nodefony/http";
import Firewall from "./firewall";

const serviceName: string = "cors";

class Cors extends Service {
  module: Module;
  constructor(
    module: Module,
    @inject("HttpKernel") public httpKernel: HttpKernel,
    @inject("firewall") public firewall: Firewall
  ) {
    const container: Container = module.container as Container;
    const event: Event = module.notificationsCenter as Event;
    super(serviceName, container, event, module.options.cors);
    this.module = module;
  }

  async handle(context: HttpContext): Promise<HttpContext> {
    return context;
  }
}

export default Cors;
