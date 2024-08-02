import {
  Service,
  Module,
  Container,
  Event,
  inject,
  Injector,
  extend,
  Severity,
  Msgid,
  Message,
  Pdu,
} from "nodefony";

import Firewall from "../service/firewall";
import Cors from "../service/cors";
import { Router } from "@nodefony/framework";
import Factory from "../src/Factory";
import Provider from "../src/Provider";
import { ContextType, WebsocketContext } from "@nodefony/http";
import { HelmetOptions } from "helmet";
import Helmet, { HelmetMiddleware } from "../service/helmet";

export type optionsSecuredArea = {
  path: string | RegExp;
  enabled: boolean;
  helmet?: Record<string, any>;
  cors?: Record<string, any>;
  [key: string]: any;
};
const defaultHelmetOptions: HelmetOptions = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      //scriptSrc: ["'self'", "trusted-scripts.example.com"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  dnsPrefetchControl: { allow: false },
  frameguard: { action: "deny" },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  ieNoOpen: true,
  noSniff: true,
  permittedCrossDomainPolicies: { permittedPolicies: "none" },
  referrerPolicy: { policy: "no-referrer" },
  xssFilter: true,
};

const defaultCorsOptions = {
  "allow-origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "ETag, Authorization, X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date",
  "Access-Control-Allow-Credentials": true,
  "Access-Control-Expose-Headers": "WWW-Authenticate, X-Json",
  "Access-Control-Max-Age": 600, // 10 minutes
};

const defaultoptions: optionsSecuredArea = {
  path: new RegExp(".*", "u"),
  enabled: true,
  cors: defaultCorsOptions,
  helmet: defaultHelmetOptions,
};

class SecuredArea extends Service {
  module: Module;
  factories: Factory[] = [];
  providers: Provider[] = [];
  pattern: RegExp = new RegExp(".*", "u");
  stateLess: boolean = false;
  sessionContext: string = "default";
  helmetMiddleware?: HelmetMiddleware | null;
  constructor(
    module: Module,
    name: string,
    options: optionsSecuredArea,
    @inject("firewall") public firewall?: Firewall,
    @inject("cors") public cors?: Cors,
    @inject("helmet") public helmet?: Helmet,
    @inject("router") public router?: Router,
    @inject("injector") public injector?: Injector
  ) {
    const container: Container = module.container as Container;
    const event: Event = module.notificationsCenter as Event;
    const opt: optionsSecuredArea = extend(true, {}, defaultoptions, options);
    super(name, container, event, opt);
    this.module = module;
    this.setPattern(this.options.path);
    this.helmetMiddleware = this.setHelmet();
  }

  match(context: ContextType): RegExpExecArray | null {
    if (context.request) {
      let url: string | null | undefined = null;
      if (context.request?.url) {
        url = context.request.url.pathname;
      }
      if ((context as WebsocketContext).request?.resourceURL) {
        url = (context as WebsocketContext).request?.resourceURL.pathname;
      }
      if (url) {
        return this.pattern.exec(url);
      }
      throw new Error(`Request url not found `);
    }
    throw new Error(`Context not ready request not found`);
  }

  setPattern(pattern: RegExp | string): RegExp {
    if (pattern instanceof RegExp) {
      this.pattern = pattern;
    } else {
      this.pattern = new RegExp(pattern);
    }
    return this.pattern;
  }

  setHelmet(): HelmetMiddleware | null {
    if (this.helmet && this.options.helmet) {
      return this.helmet.setHelmet(this.options.helmet);
    }
    return null;
  }

  async handle(context: ContextType): Promise<ContextType> {
    return context;
  }

  override log(
    pci: any,
    severity?: Severity,
    msgid?: Msgid,
    msg?: Message
  ): Pdu {
    if (!msgid) {
      msgid = `\x1b[36mSECURE AREA ${this.name}\x1b[0m`;
    }
    return super.log(pci, severity, msgid, msg);
  }
}

export default SecuredArea;
