import {
  Context,
  HTTPMethod,
  SchemeType,
  HttpError,
  WebsocketContext,
} from "@nodefony/http";
import { createHash } from "node:crypto";
import { typeOf } from "nodefony";
import Controller from "./Controller";

const REG_ROUTE = /(\/)?(\.)?\{([^}]+)\}(?:\(([^)]*)\))?(\?)?/g;

const REG_REPLACE = /([\/.])/g;
const REG_REPLACE_DOUBLE_SLASH = /\/+/g;
const REG_REPLACE_END_SLASH = /\/+$/g;
const decode = function (str: string): string {
  try {
    return decodeURIComponent(str);
  } catch (err) {
    return str;
  }
};

export interface ControllerConstructor {
  new (...args: any[]): Controller;
}

/**
 * Check if the variable is a default parameter.
 * @param variable - The variable to check.
 * @returns True if the variable is a default parameter, false otherwise.
 */
function checkDefaultParameters(this: Route, variable: string) {
  for (const def in this.defaults) {
    if (def !== "controller" && def === variable) {
      return true;
    }
  }
  return false;
}

/**
 * Callback function for the replace method in the compile function.
 * @param match - The matched substring.
 * @param slash - The matched slash, if any.
 * @param dot - The matched dot, if any.
 * @param key - The matched key.
 * @param capture - The matched capture group, if any.
 * @param opt - The matched optional character, if any.
 * @param offset - The offset of the matched substring within the whole string being examined.
 * @returns The replacement string.
 */
function replaceCallback(
  this: Route,
  match: string,
  slash: string,
  dot: string,
  key: string,
  capture: string,
  opt: string,
  offset: number
) {
  if (this.path) {
    this.variables.push(key);
    if (checkDefaultParameters.call(this, key)) {
      return `${(slash ? `${slash}?` : "") + (dot || "")}(${capture || "[^/]*"})${opt || ""}`;
    }
    return `${(slash || "") + (dot || "")}(${capture || "[^/]+"})${opt || ""}`;
  }
  throw new Error(`Bad path `);
}

/**
 * Options pour la configuration d'une route.
 *
 * @example
 * |@route("myroute", {
 *   path: "/add/{name}",
 *   method: ["GET", "POST"],
 *   defaults: { name: "john" },
 * })
 * method() {
 *   console.log("call method");
 * }
 */
export interface RouteOptions {
  path?: string;
  constructor?: Controller["constructor"];
  classMethod?: string;
  prefix?: string;
  method?: HTTPMethod | HTTPMethod[];
  className?: string;
  host?: string;
  pattern?: string;
  defaults?: Record<string, any>;
  requirements?: RouteRequirements;
  filePath?: string;
}

export interface RouteRequirements {
  domain?: string | string[];
  scheme?: SchemeType;
  methods?: HTTPMethod[] | HTTPMethod;
  protocol?: string;
}

class Route {
  name: string;
  path?: string;
  controller?: ControllerConstructor;
  classMethod?: string;
  prefix?: string;
  method?: HTTPMethod;
  schemes?: SchemeType;
  pattern?: RegExp;
  variables: any[] = [];
  defaults: Partial<Record<string, any>> = {};
  requirements: Partial<RouteRequirements> = {};
  hash?: string;
  host?: string;
  bypassFirewall: boolean = false;
  filePath?: string;

  constructor(name: string, obj?: RouteOptions) {
    this.name = name;
    if (obj) {
      this.path = obj.path;
      this.setPrefix(obj.prefix);
      this.filePath = obj.filePath;
      this.controller = obj.constructor as ControllerConstructor;
      this.classMethod = obj.classMethod;
      this.method = obj.method as HTTPMethod;
      this.setHostname(obj.host);
      this.setDefaults(obj.defaults);
      this.compile();
    }
    this.generateId();
  }

  match(context: Context) {
    let res;
    if (context.request && context.request.url && this.pattern) {
      res = context.request.url.pathname.match(this.pattern as RegExp);
    }
    if (!res) {
      return res;
    }
    try {
      this.hydrateDefaultParameters(res);
    } catch (e) {
      throw e;
    }
    // check requierments
    try {
      this.matchRequirements(context);
    } catch (e) {
      throw e;
    }
    // check Hostname
    try {
      this.matchHostname(context);
    } catch (e) {
      throw e;
    }
    let map: any[] = [];
    try {
      res.slice(1).forEach((param, i: number) => {
        const k = this.variables[i] || "wildcard";
        param &&= decode(param);
        const req = this.getRequirement(k);
        let result = null;
        if (req) {
          switch (typeOf(req)) {
            case "RegExp":
              result = req.test(param);
              break;
            case "string":
              result = new RegExp(req).test(param);
              break;
            default:
              throw {
                BreakException: `Requirement Routing config Exception variable : ${k} must be RegExp or string : ${typeOf(req)}`,
              };
          }
          if (!result) {
            throw {
              BreakException: `Requirement Exception variable : ${k} ==> ${param} doesn't match with ${req}`,
            };
          }
        }
        const index = map.push(param);
        map[k] = map[index - 1];
      });
    } catch (e: any) {
      if (e.BreakException) {
        throw e.BreakException;
      }
      throw e;
    }
    if (map && map.wildcard) {
      map["*"] = map.wildcard;
    }
    return map;
  }

  /**
   * Compile the route into a regular expression pattern.
   * @returns The compiled regular expression pattern.
   */
  compile() {
    if (!this.path) {
      return;
    }
    let pattern = this.path.replace(REG_ROUTE, replaceCallback.bind(this));
    //console.log("PASASAS", pattern);
    if (pattern[pattern.length - 1] === "*") {
      pattern = pattern.replace(REG_REPLACE, "\\$1").replace(/\*/g, "(.*)/?");
    } else {
      pattern = pattern.replace(REG_REPLACE, "\\$1");
    }
    //console.log("PASASAS => ", pattern);
    //this.pattern = new RegExp(`^${pattern}[/]?$`, "i");
    this.pattern = new RegExp(`^${pattern}$`, "i");
    return this.pattern;
  }

  hydrateDefaultParameters(res: RegExpMatchArray) {
    if (this.variables.length) {
      for (let i = 0; i < this.variables.length; i++) {
        if (this.defaults[this.variables[i]]) {
          if (res[i + 1] === "") {
            res[i + 1] = this.defaults[this.variables[i]];
          }
        }
      }
    } else {
      for (const def in this.defaults) {
        switch (def) {
          case "controller":
            continue;
          default:
            res.push(this.defaults[def]);
        }
      }
    }
  }

  toString() {
    return JSON.stringify(
      {
        name: this.name,
        path: this.path,
        prefix: this.prefix,
        host: this.host,
        controller: this.defaults.controller,
        filePath: this.filePath,
        schemes: this.schemes,
        bypassFirewall: this.bypassFirewall,
      },
      null,
      " "
    );
  }
  setDefaults(arg: any) {
    if (arg) {
      for (const ob in arg) {
        this.addDefault(ob, arg[ob]);
      }
    }
  }
  addDefault(key: string, value: any) {
    this.defaults[key] = value;
  }

  setPrefix(prefix?: string) {
    this.prefix = prefix;
    this.setPattern();
  }

  setPattern(pattern?: string) {
    if (pattern) {
      this.path = `${this.prefix}/${pattern}`;
    } else if (this.prefix) {
      if (this.path) {
        this.path = `${this.prefix}/${this.path}`;
      } else {
        this.path = this.prefix;
      }
    }
    return (this.path = (this.path as string)
      .replace(REG_REPLACE_DOUBLE_SLASH, "/")
      .replace(REG_REPLACE_END_SLASH, ""));
  }

  setHostname(hostname?: string) {
    this.host = hostname;
  }

  matchHostname(context: Context) {
    if (this.host) {
      if (this.host === context.domain) {
        return true;
      }
      const error = new HttpError(`Domain ${context.domain} Unauthorized`);
      error.code = 401;
      error.type = "domain";
      throw error;
    }
    return true;
  }

  generateId(): string {
    this.hash = createHash("md5").update(JSON.stringify(this)).digest("hex");
    return this.hash;
  }

  addRequirement<K extends keyof RouteRequirements>(
    key: K,
    value: RouteRequirements[K]
  ): RouteRequirements[K] | undefined {
    if (key && value) {
      return (this.requirements[key] = value);
    }
  }

  getRequirement<K extends keyof RouteRequirements>(
    key: K
  ): RouteRequirements[K] | undefined {
    if (key in this.requirements) {
      return this.requirements[key] as RouteRequirements[K];
    }
    return undefined;
  }

  hasRequirements(): number {
    return Object.keys(this.requirements).length;
  }
  matchRequirements(context: Context) {
    if (this.hasRequirements()) {
      for (const i in this.requirements) {
        switch (i) {
          case "methods":
            switch (typeof this.requirements.methods) {
              case "string":
                const req = this.requirements.methods
                  .replace(/\s/g, "")
                  .toUpperCase();
                if (
                  req.split(",").lastIndexOf(context.method as HTTPMethod) < 0
                ) {
                  const error = new HttpError(
                    `Method ${context.method} Unauthorized`
                  );
                  error.code = 405;
                  error.type = "method";
                  throw error;
                }
                break;
              case "object":
                let method = context.method as HTTPMethod;
                let ele = this.requirements[i] as HTTPMethod;
                if (ele.indexOf(method) < 0) {
                  if (ele.indexOf(method.toLowerCase()) < 0) {
                    const error = new HttpError(
                      `Method ${context.method} Unauthorized`
                    );
                    error.code = 405;
                    error.type = "method";
                    throw error;
                  }
                }
                break;
              default:
                throw new Error(
                  `Bad config route method : ${this.requirements[i]}`
                );
            }
            break;
          case "domain":
            if (context.domain !== this.requirements[i]) {
              const error = new HttpError(
                `Domain ${context.domain} Unauthorized`
              );
              error.code = 403;
              error.type = "domain";
              throw error;
            }
            break;
          case "protocol":
            switch (context.method) {
              case "WEBSOCKET":
                // console.log("this.requirements[i]" +this.requirements[i]);
                let ele = this.requirements[i];
                if ((context as WebsocketContext).acceptedProtocol !== ele) {
                  const error = new HttpError(
                    `Protocol ${(context as WebsocketContext).acceptedProtocol} Unauthorized`
                  );
                  error.code = 1002;
                  error.type = "protocol";
                  throw error;
                }
                break;
            }
            break;
        }
      }
    }
    return true;
  }
}

export default Route;
