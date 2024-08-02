import { Service, Module, Container, Event, inject } from "nodefony";
import { HttpKernel, HttpContext } from "@nodefony/http";
import Firewall from "./firewall";
import Tokens from "csrf";

class Csrf {
  engine: Tokens;
  secret?: string;
  token?: string;
  constructor(options: Tokens.Options) {
    this.engine = new Tokens(options);
  }

  setSecret(secret: string): string {
    if (secret) {
      return this.engine.create(secret);
    }
    throw new Error("No csrf secret in config");
  }
  validate(token?: string): boolean {
    if (this.secret) {
      return this.verify(this.secret, token || (this.token as string));
    }
    return false;
  }
  verify(secret: string, token: string) {
    return this.engine.verify(secret || (this.secret as string), token);
  }
}

const serviceName: string = "csrf";
class CsrfService extends Service {
  module: Module;
  constructor(
    module: Module,
    @inject("HttpKernel") public httpKernel: HttpKernel,
    @inject("firewall") public firewall: Firewall
  ) {
    const container: Container = module.container as Container;
    const event: Event = module.notificationsCenter as Event;
    super(serviceName, container, event, module.options.csrf);
    this.module = module;
  }

  async handle(context: HttpContext): Promise<HttpContext> {
    return new Promise((resolve, reject) => {
      try {
        if (context.csrf) {
          const token = context.csrf.validate();
          if (token) return resolve(context);
          return reject();
        }
        return resolve(context);
      } catch (e) {
        return reject(e);
      }
    });
  }
}

export default CsrfService;
export { Csrf };
