import { HttpContext, HttpKernel } from "@nodefony/http";
import { HelmetOptions } from "helmet";
import { ServerResponse, IncomingMessage } from "node:http";
import { Service, Module } from "nodefony";
import { Firewall } from "./firewall.types";

// Définition du type HelmetEngine
export type HelmetMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void
) => void;

export interface Helmet extends Service {
  constructor(
    module: Module,
    httpKernel: HttpKernel,
    firewall: Firewall
  ): Helmet;
  setHelmet(options: HelmetOptions): HelmetMiddleware;
  handle(context: HttpContext, engine: HelmetMiddleware): Promise<HttpContext>;
}
