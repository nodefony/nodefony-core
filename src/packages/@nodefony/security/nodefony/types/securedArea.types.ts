import {
  Service,
  Module,
  Injector,
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
import { ContextType } from "@nodefony/http";
import { HelmetOptions } from "helmet";
import { Helmet, HelmetMiddleware } from "../types/helmet.types";

export type optionsSecuredArea = {
  path: RegExp | string;
  enabled: boolean;
  cors: Record<string, any>;
  helmet: HelmetOptions;
};

export interface SecuredArea extends Service {
  factories: Factory[];
  providers: Provider[];
  pattern: RegExp;
  stateLess: boolean;
  sessionContext: string;
  helmetMiddleware?: HelmetMiddleware | null;

  constructor(
    module: Module,
    name: string,
    options: optionsSecuredArea,
    firewall?: Firewall,
    cors?: Cors,
    helmet?: Helmet,
    router?: Router,
    injector?: Injector
  ): SecuredArea;

  match(context: ContextType): RegExpExecArray | null;
  setPattern(pattern: RegExp | string): RegExp;
  setHelmet(): HelmetMiddleware | null;
  handle(context: ContextType): Promise<ContextType>;
  log(pci: any, severity?: Severity, msgid?: Msgid, msg?: Message): Pdu;
}
