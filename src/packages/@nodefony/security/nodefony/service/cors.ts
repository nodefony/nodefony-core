import { Service, Module, Container, Event, inject } from "nodefony";
import { HttpContext, HttpKernel } from "@nodefony/http";
import { Firewall } from "../types";

const serviceName: string = "cors";
class Cors extends Service {
  constructor(
    public module: Module,
    @inject("HttpKernel") public httpKernel: HttpKernel,
    @inject("firewall") public firewall: Firewall
  ) {
    super(
      serviceName,
      module.container as Container,
      module.notificationsCenter as Event,
      module.options.cors
    );
  }

  async handle(context: HttpContext): Promise<HttpContext> {
    return context;
  }
}

export default Cors;
