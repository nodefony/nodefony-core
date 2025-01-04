import { Service, Module, Container, Event, inject } from "nodefony";
import { HttpContext, HttpKernel } from "@nodefony/http";
import helmet, { HelmetOptions } from "helmet";
import { HelmetMiddleware } from "../types/helmet.types";
import { IncomingMessage, ServerResponse } from "node:http";
import { Firewall } from "../types/firewall.types";

const serviceName: string = "helmet";

class Helmet extends Service {
  constructor(
    public module: Module,
    @inject("HttpKernel") public httpKernel: HttpKernel,
    @inject("firewall") public firewall: Firewall
  ) {
    super(
      serviceName,
      module.container as Container,
      module.notificationsCenter as Event,
      module.options.helmet
    );
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
