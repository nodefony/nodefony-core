import type { ContextType, HttpError } from "@nodefony/http";
import type { Injector } from "nodefony";
import type { ControllerConstructor } from "../src/Route.js";
import type { IRoute } from "./IRoute.js";
import type { IController } from "./IController.js";

export interface IResolver {
  injector?: Injector | null;
  controller: ControllerConstructor | null;
  actionName?: string;
  action?: (...args: unknown[]) => unknown;
  context: ContextType;
  route: IRoute | null;
  resolve: boolean;
  variables: unknown[];
  exception?: HttpError | Error | null;
  acceptedProtocol: string | null;
  bypassFirewall: boolean;

  match(route: IRoute, context: ContextType): unknown;
  parsePathernController(name: string): void;
  getAction(name: string): ((...args: unknown[]) => unknown) | null;
  newController(context?: ContextType): Promise<IController>;
  callController(data?: unknown[], reload?: boolean): Promise<unknown>;
  returnController(result: unknown): Promise<unknown>;
}
