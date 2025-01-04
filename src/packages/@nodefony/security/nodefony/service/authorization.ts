import { Service, Module, Container, Event, inject } from "nodefony";
import { HttpKernel } from "@nodefony/http";
import { Firewall } from "../types";

const serviceName: string = "authorization";

class Authorization extends Service {
  module: Module;
  constructor(
    module: Module,
    @inject("HttpKernel") public httpKernel: HttpKernel,
    @inject("firewall") public firewall: Firewall
  ) {
    const container: Container = module.container as Container;
    const event: Event = module.notificationsCenter as Event;
    super(serviceName, container, event, module.options.authorization);
    this.module = module;
  }
}

export default Authorization;
