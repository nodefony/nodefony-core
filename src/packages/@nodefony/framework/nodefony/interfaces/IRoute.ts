import type {
  HTTPMethod,
  SchemeType,
  ContextType,
} from "@nodefony/http";
import type { ControllerConstructor, RouteRequirements } from "../src/Route.js";

export interface IRoute {
  name: string;
  path?: string;
  controller?: ControllerConstructor;
  classMethod?: string;
  prefix?: string;
  method?: HTTPMethod;
  schemes?: SchemeType;
  pattern?: RegExp;
  variables: unknown[];
  defaults: Partial<Record<string, unknown>>;
  requirements: Partial<RouteRequirements>;
  hash?: string;
  host?: string;
  bypassFirewall: boolean;
  filePath?: string;
  variablesMap: Record<string, unknown>;

  match(context: ContextType): unknown[] | null | undefined;
  compile(): RegExp;
  toString(): string;
  toObject(): object;
  setPrefix(prefix?: string): void;
  setPattern(pattern?: string): string;
  generateId(): string;
  addRequirement<K extends keyof RouteRequirements>(
    key: K,
    value: RouteRequirements[K]
  ): RouteRequirements[K] | undefined;
  getRequirement<K extends keyof RouteRequirements>(
    key: K
  ): RouteRequirements[K] | undefined;
  hasRequirements(): number;
  matchRequirements(context: ContextType): boolean;
}
