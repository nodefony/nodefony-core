import {
  Service,
  Module,
  Injector,
  Severity,
  Message,
  Pdu,
  Msgid,
} from "nodefony";
import {
  ContextType,
  HttpKernel,
  Session,
  SessionsService,
} from "@nodefony/http";
import Cors from "../service/cors";
import Authorization from "../service/authorization";
import Csrf from "../service/csrf";
import SecuredArea from "../src/securedArea";
import Factory from "../src/Factory";
import Provider from "../src/Provider";
import Helmet from "../service/helmet";
import { optionsSecuredArea } from "./securedArea.types";
import { optionsFactory } from "./factory.types";
import { optionsProvider } from "./provider.types";

export type Areas = Record<string, SecuredArea>;
export type Factories = Record<string, Factory>;
export type Providers = Record<string, Provider>;

export interface Firewall extends Service {
  cors?: Cors | null;
  helmet?: Helmet | null;
  authorization?: Authorization | null;
  csrf?: Csrf | null;
  securedAreas: Areas;
  factories: Factories;
  providers: Providers;

  constructor(
    module: Module,
    httpKernel: HttpKernel,
    injector: Injector,
    sessionService: SessionsService
  ): Firewall;

  isSecure(context: ContextType): boolean;
  addSecuredArea(name: string, options: optionsSecuredArea): SecuredArea;
  getSecuredArea(name: string): SecuredArea;
  addFactory(name: string, options: optionsFactory): Factory;
  getFactory(name: string): Factory;
  addProvider(name: string, options: optionsProvider): Provider;
  getProvider(name: string): Provider;
  handleSecurity(context: ContextType): Promise<ContextType>;
  handle(context: ContextType): Promise<ContextType>;
  startSession(context: ContextType): Promise<Session | null>;
  handleStateLess(context: ContextType): Promise<ContextType>;
  handleStateFull(context: ContextType): Promise<ContextType>;
  log(pci: any, severity?: Severity, msgid?: Msgid, msg?: Message): Pdu;
}
