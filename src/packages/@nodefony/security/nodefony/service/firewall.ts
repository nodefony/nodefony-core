import Cors from "./cors";
import Authorization from "./authorization";
import Csrf from "./csrf";
import SecuredArea from "../src/securedArea";
import Factory from "../src/Factory";
import Provider from "../src/Provider";
import {
  Service,
  Module,
  Container,
  Event,
  inject,
  Injector,
  Severity,
  Message,
  Pdu,
  Msgid,
} from "nodefony";
import {
  ContextType,
  HttpContext,
  Session,
  SessionsService,
} from "@nodefony/http";
import {
  Areas,
  Factories,
  optionsFactory,
  optionsSecuredArea,
  Providers,
  Helmet,
} from "../types";
import { optionsProvider } from "../types/provider.types";

const serviceName: string = "firewall";

class Firewall extends Service {
  cors?: Cors | null;
  helmet?: Helmet | null;
  authorization?: Authorization | null;
  csrf?: Csrf | null;
  securedAreas: Areas = {};
  factories: Factories = {};
  providers: Providers = {};
  constructor(
    public module: Module,
    //@inject("HttpKernel") private httpKernel: HttpKernel,
    @inject("injector") private injector: Injector,
    @inject("sessions") private sessionService: SessionsService
  ) {
    super(
      serviceName,
      module.container as Container,
      module.notificationsCenter as Event,
      module.options
    );
    this.kernel?.once("onBoot", () => {
      this.cors = this.get<Cors>("cors");
      this.helmet = this.get<Helmet>("helmet");
      this.authorization = this.get<Authorization>("authorization");
      this.csrf = this.get<Csrf>("csrf");
      if (this.options.firewalls) {
        for (const firewall in this.options.firewalls) {
          try {
            this.addSecuredArea(firewall, this.options.firewalls[firewall]);
          } catch (e) {
            this.log(e, "ERROR");
            continue;
          }
        }
      }
    });
  }

  isSecure(context: ContextType): boolean {
    if (context.resolver && context.resolver.bypassFirewall) {
      return false;
    }
    // context.accessControl =
    //   this.authorizationService.isControlledAccess(context);
    // context.isControlledAccess = Boolean(context.accessControl.length);
    // if (context.isControlledAccess) {
    //   this.log(
    //     `Front Controler isControlledAccess : ${context.isControlledAccess}`,
    //     "DEBUG"
    //   );
    // }
    for (const area in this.securedAreas) {
      if (this.securedAreas[area].match(context)) {
        context.security = this.securedAreas[area];
        const state = context.security?.stateLess ? "STATELESS" : "STATEFULL";
        context.security?.log(`ENTER SECURE AREA : ${state}`, "DEBUG");
        return true;
      }
    }
    return false;
  }

  addSecuredArea(name: string, options: optionsSecuredArea): SecuredArea {
    if (!this.securedAreas[name]) {
      this.securedAreas[name] = this.injector.instantiate(
        SecuredArea,
        this.module,
        name,
        options
      ); //new SecuredArea(this.module, name, options);
      this.log(`ADD security context : ${name}`, "DEBUG");
      return this.securedAreas[name];
    }
    throw new Error(` Add Secure Area : ${name}  already exist`);
  }

  getSecuredArea(name: string): SecuredArea {
    if (name in this.securedAreas) {
      return this.securedAreas[name];
    }
    throw new Error(` Secure Area : ${name} Not found`);
  }

  addFactory(name: string, options: optionsFactory): Factory {
    if (!this.factories[name] && this.injector) {
      this.factories[name] = this.injector.instantiate(Factory, name, options);
      this.log(`ADD Factory  : ${name}`, "DEBUG");
      return this.factories[name];
    }
    throw new Error(`Add Factory : ${name}  already exist`);
  }

  getFactory(name: string): Factory {
    if (name in this.factories) {
      return this.factories[name];
    }
    throw new Error(` Factory : ${name} Not found`);
  }

  addProvider(name: string, options: optionsProvider): Provider {
    if (!this.providers[name] && this.injector) {
      this.providers[name] = this.injector.instantiate(Provider, name, options);
      this.log(`ADD Provider  : ${name}`, "DEBUG");
      return this.providers[name];
    }
    throw new Error(`Add Factory : ${name}  already exist`);
  }

  getProvider(name: string): Provider {
    if (name in this.providers) {
      return this.providers[name];
    }
    throw new Error(` Provider : ${name} Not found`);
  }

  async handleSecurity(context: ContextType): Promise<ContextType> {
    return new Promise((resolve, reject) => {
      if (context.resolver) {
        if (context.resolver.bypassFirewall) {
          context.resolver?.log(`bypassFirewall ${context.url}`, "DEBUG");
          return resolve(context);
        }
        this.fire("onSecurity", context);
        return this.handle(context).then(() => {
          return resolve(context);
        });
      }
      return reject(new Error(`not resolve`));
    });
  }

  async handle(context: ContextType): Promise<ContextType> {
    return new Promise(async (resolve, reject) => {
      // if (context.type === "HTTP" && this.httpsReady) {
      //     if (context.security && context.security.redirect_Https) {
      //       resolve(this.redirectHttps(context));
      //       return;
      //     }
      //   }
      if (
        context instanceof HttpContext &&
        context.security?.helmetMiddleware
      ) {
        await this.helmet
          ?.handle(context as HttpContext, context.security.helmetMiddleware)
          .catch((e) => {
            throw e;
          });
      }

      if (context.security?.stateLess) {
        if (context.sessionAutoStart) {
          await this.startSession(context);
        }
        return this.handleStateLess(context)
          .then((ctx) => resolve(ctx))
          .catch((error) => {
            if (!error.code) {
              error.code = 401;
            }
            return reject(error);
          });
      }
      return this.handleStateFull(context)
        .then((ctx) => resolve(ctx))
        .catch((error) => {
          if (!error.code) {
            error.code = 401;
          }
          return reject(error);
        });
    });
  }

  async startSession(context: ContextType): Promise<Session | null> {
    if (!context.sessionAutoStart) {
      if (context.security) {
        context.sessionAutoStart = context.security.sessionContext;
      }
    }
    return this.sessionService
      .start(context, context.sessionAutoStart as string)
      .catch(async (error) => {
        throw error;
      });
  }

  async handleStateLess(context: ContextType): Promise<ContextType> {
    if (context.security) {
      return context.security
        .handle(context)
        .then((ctx: ContextType) => {
          // if (ctx.isControlledAccess && !ctx.checkLogin) {
          //   return this.authorizationService.handle(ctx);
          // }
          return ctx;
        })
        .catch((e) => {
          throw e;
        });
    }
    // if (ctx.isControlledAccess && !ctx.checkLogin) {
    //   return this.authorizationService.handle(ctx);
    // }
    throw new Error(`No security context`);
  }

  async handleStateFull(context: ContextType): Promise<ContextType> {
    if (context.security) {
      return this.startSession(context)
        .then(async () => {
          return this.handleStateLess(context).then(() => {
            return context;
          });
        })
        .catch((e) => {
          throw e;
        });
    }
    // if (ctx.isControlledAccess && !ctx.checkLogin) {
    //   return this.authorizationService.handle(ctx);
    // }
    throw new Error(`No security context`);
  }

  override log(
    pci: any,
    severity?: Severity,
    msgid?: Msgid,
    msg?: Message
  ): Pdu {
    if (!msgid) {
      msgid = "\x1b[36mFIREWALL\x1b[0m";
    }
    return super.log(pci, severity, msgid, msg);
  }
}

export default Firewall;
