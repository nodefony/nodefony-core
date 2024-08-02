import { Service, Module, Container, Event, inject } from "nodefony";
import { HttpContext, HttpKernel } from "@nodefony/http";
import Firewall from "./firewall";
import helmet, { HelmetOptions } from "helmet";

import { IncomingMessage, ServerResponse } from "node:http";

const serviceName: string = "helmet";

// Définition du type HelmetEngine
export type HelmetMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void
) => void;

class Helmet extends Service {
  module: Module;
  constructor(
    module: Module,
    @inject("HttpKernel") public httpKernel: HttpKernel,
    @inject("firewall") public firewall: Firewall
  ) {
    const container: Container = module.container as Container;
    const event: Event = module.notificationsCenter as Event;
    super(serviceName, container, event, module.options.helmet);
    this.module = module;
  }

  setHelmet(options: HelmetOptions): HelmetMiddleware {
    return helmet(options);
  }

  async handle(
    context: HttpContext,
    engine: HelmetMiddleware
  ): Promise<HttpContext> {
    return new Promise((resolve, reject) => {
      if (context && context.request && context.response) {
        engine(
          context.request.request as IncomingMessage,
          context.response.response as ServerResponse,
          (err: unknown) => {
            if (err) {
              return reject(err);
            }
            return resolve(context);
          }
        );
      }
    });
  }
}

export default Helmet;
