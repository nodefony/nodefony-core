import {
  //Context,
  HTTPMethod,
  SchemeType,
  HttpError,
  WebsocketContext,
  ContextType,
  compileDomainPatterns,
  isDomainAllowed,
} from "@nodefony/http";
import type { IRoute } from "../interfaces/index.js";
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
  // Idiome TS officiel des signatures de constructeur (mixins/DI) — `any[]`
  // requis ; `unknown[]` casse l'instanciation via `Injector`. Pas de la dette.
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
 * @param _match - The matched substring.
 * @param slash - The matched slash, if any.
 * @param dot - The matched dot, if any.
 * @param key - The matched key.
 * @param capture - The matched capture group, if any.
 * @param opt - The matched optional character, if any.
 * @param _offset - The offset of the matched substring within the whole string being examined.
 * @returns The replacement string.
 */
function replaceCallback(
  this: Route,
  _match: string,
  slash: string,
  dot: string,
  key: string,
  capture: string,
  opt: string,
  _offset: number,
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
 * method(name: string) {
 *   return this.renderJson({ name });
 * }
 */
export interface RouteOptions {
  path?: string;
  constructor?: Controller["constructor"];
  classMethod?: string;
  prefix?: string;
  method?: HTTPMethod | HTTPMethod[];
  className?: string;
  host?: string | string[];
  pattern?: string;
  defaults?: Record<string, unknown>;
  requirements?: RouteRequirements;
  filePath?: string;
}

export interface RouteRequirements {
  domain?: string | string[];
  scheme?: SchemeType;
  methods?: HTTPMethod[] | HTTPMethod;
  protocol?: string;
}

class Route implements IRoute {
  name: string;
  path?: string;
  controller?: ControllerConstructor;
  classMethod?: string;
  prefix?: string;
  method?: HTTPMethod;
  schemes?: SchemeType;
  pattern?: RegExp;
  variables: string[] = [];
  defaults: Partial<Record<string, unknown>> = {};
  requirements: Partial<RouteRequirements> = {};
  hash?: string;
  host?: string | string[];
  /**
   * Patterns de domaine pré-compilés (host + `requirements.domain`), RegExp
   * ancrées/wildcard. Compilé UNE fois dans {@link compile} ; testé par requête
   * via {@link isDomainAllowed} (zéro alloc hot-path). `undefined` = route servie
   * sur tous les vhosts.
   */
  hostRegexp?: RegExp[];
  bypassFirewall: boolean = false;
  filePath?: string;
  /**
   * Module propriétaire de la route — set par `Router.setController()` à
   * `onBoot`, donc PAS disponible à la création de la route (via `@controller`)
   * qui s'évalue à l'import. Utilisé pour `toLogLine()`.
   */
  module?: { name: string };
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
      this.requirements = obj.requirements || {};
      this.compile();
    }
    this.generateId();
  }

  /**
   * Normalise le pathname de la requête pour le matching : retire le(s)
   * slash(es) final(aux) via {@link REG_REPLACE_END_SLASH}. À calculer UNE fois
   * par requête dans `Router.resolve`, puis à passer à chaque {@link Route.match}
   * scannée — sinon le getter `URL.pathname` + la regex + l'alloc string sont
   * refaits pour CHAQUE route du scan O(N) (hot path, ~N routes/req).
   *
   * @param context - contexte HTTP/WS courant.
   * @returns le pathname sans slash final, ou `undefined` si la requête n'a pas d'URL.
   */
  static cleanPathname(context: ContextType): string | undefined {
    const reqUrl = context.request?.url;
    if (!reqUrl) {
      return undefined;
    }
    return (reqUrl as URL).pathname.replace(REG_REPLACE_END_SLASH, "");
  }

  match(context: ContextType, cleanPath?: string) {
    let res;
    if (context.request && context.request.url && this.pattern) {
      // L5a perf : réutilise le pathname normalisé UNE fois par requête
      // (Router.resolve) au lieu de le recalculer pour CHAQUE route scannée.
      const url =
        cleanPath !== undefined ? cleanPath : Route.cleanPathname(context);
      if (url !== undefined) {
        res = url.match(this.pattern as RegExp);
      }
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
    // Tableau hybride array+dict (legacy) : valeurs positionnelles `push`ées +
    // accès par nom de variable (`map[k]`, `map.wildcard`, `map["*"]`). Le double
    // cast est requis : un array n'a pas d'index signature string implicite.
    const map = [] as unknown as (string | null)[] & Record<string, unknown>;
    try {
      res.slice(1).forEach((param: string | null, i: number) => {
        const k = this.variables[i] || "wildcard";
        param &&= decode(param);
        // Requirement par variable de route = RegExp | string (au-delà des clés
        // typées de RouteRequirements) → `unknown` + narrowing instanceof/typeof.
        const req: unknown = this.getRequirement(k as keyof RouteRequirements);
        let result = null;
        if (req) {
          if (req instanceof RegExp) {
            result = req.test(param ?? "");
          } else if (typeof req === "string") {
            result = new RegExp(req).test(param ?? "");
          } else {
            throw {
              BreakException: `Requirement Routing config Exception variable : ${k} must be RegExp or string : ${typeOf(req)}`,
            };
          }
          if (!result) {
            throw {
              BreakException: `Requirement Exception variable : ${k} ==> ${param} doesn't match with ${String(req)}`,
            };
          }
        }
        const index = map.push(param);
        map[k] = map[index - 1];
      });
    } catch (e: unknown) {
      if (e && typeof e === "object" && "BreakException" in e) {
        throw (e as { BreakException: unknown }).BreakException;
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
      this.path = "";
    }
    let pattern = this.path.replace(REG_ROUTE, replaceCallback.bind(this));
    if (pattern[pattern.length - 1] === "*") {
      pattern = pattern.replace(REG_REPLACE, "\\$1").replace(/\*/g, "(.*)/?");
    } else {
      pattern = pattern.replace(REG_REPLACE, "\\$1");
    }
    this.pattern = new RegExp(`^${pattern}$`, "i");
    this.compileHost();
    return this.pattern;
  }

  hydrateDefaultParameters(res: RegExpMatchArray) {
    if (this.variables.length) {
      for (let i = 0; i < this.variables.length; i++) {
        if (this.defaults[this.variables[i]]) {
          if (res[i + 1] === "") {
            // valeur par défaut d'un paramètre de route = string (cf @route defaults)
            res[i + 1] = this.defaults[this.variables[i]] as string;
          }
        }
      }
    } else {
      for (const def in this.defaults) {
        switch (def) {
          case "controller":
            continue;
          default:
            res.push(this.defaults[def] as string);
        }
      }
    }
  }

  toString() {
    return JSON.stringify(this.toObject(), null, " ");
  }

  /**
   * Formatte la route en une seule ligne lisible pour le log debug — évite le
   * JSON multi-ligne du `toString()` qui polluait ~7 lignes par route au boot.
   *
   * Format : `[METHODS] path → @module/Controller.action  (no auth?)`
   *
   * Exemple :
   * ```
   * [GET|HEAD] /nodefony/test/index → @test/DefaultController.index
   * [ANY]      /admin/users         → @app/AdminController.users  (no auth)
   * ```
   *
   * Le `@module` ne s'affiche qu'après que `Router.setController()` ait set
   * `this.module` à `onBoot` — appel via le décorateur `@controllers` du module.
   */
  toLogLine(): string {
    const m = Array.isArray(this.requirements?.methods)
      ? this.requirements.methods.join("|")
      : this.requirements?.methods || this.method || "ANY";
    const method = `[${String(m)}]`.padEnd(10);
    const ctrl = this.controller?.name || "?";
    const action = this.classMethod || this.name;
    const mod = this.module?.name ? `@${this.module.name}/` : "";
    const auth = this.bypassFirewall ? "  (no auth)" : "";
    return `${method} ${this.path} → ${mod}${ctrl}.${action}${auth}`;
  }

  toObject(): Object {
    return {
      name: this.name,
      path: this.path,
      prefix: this.prefix,
      host: this.host,
      controller: this.defaults.controller,
      filePath: this.filePath,
      schemes: this.schemes,
      variables: this.variables,
      bypassFirewall: this.bypassFirewall,
    };
  }
  setDefaults(arg?: Record<string, unknown>) {
    if (arg) {
      for (const ob in arg) {
        this.addDefault(ob, arg[ob]);
      }
    }
  }
  addDefault(key: string, value: unknown) {
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

  setHostname(hostname?: string | string[]) {
    this.host = hostname;
  }

  /**
   * Pré-compile les patterns de domaine de la route (`host` + `requirements.domain`)
   * en `RegExp[]` ancrées, via le matcher partagé `@nodefony/http`. Appelé par
   * {@link compile} (kernel ↔ route = même politique). `undefined` si aucun
   * domaine → route servie sur tous les vhosts.
   */
  compileHost() {
    const patterns: (string | string[])[] = [];
    if (this.host) {
      patterns.push(this.host);
    }
    const reqDomain = this.requirements?.domain;
    if (reqDomain) {
      patterns.push(reqDomain);
    }
    this.hostRegexp = patterns.length
      ? compileDomainPatterns(patterns.flat())
      : undefined;
  }

  matchHostname(context: ContextType) {
    if (this.hostRegexp) {
      if (isDomainAllowed(this.hostRegexp, context.domain)) {
        return true;
      }
      // Le serveur sert ce domaine (passé la barrière trustedHosts kernel), mais
      // cette route est restreinte à un autre vhost → 403 Forbidden (RFC 9110).
      const error = new HttpError(`Domain ${context.domain} Unauthorized`);
      error.code = 403;
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
    value: RouteRequirements[K],
  ): RouteRequirements[K] | undefined {
    if (key && value) {
      return (this.requirements[key] = value);
    }
  }

  getRequirement<K extends keyof RouteRequirements>(
    key: K,
  ): RouteRequirements[K] | undefined {
    if (key in this.requirements) {
      return this.requirements[key] as RouteRequirements[K];
    }
    return undefined;
  }

  hasRequirements(): number {
    return Object.keys(this.requirements).length;
  }
  matchRequirements(context: ContextType): boolean {
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
                  req &&
                  req.split(",").lastIndexOf(context.method as HTTPMethod) < 0
                ) {
                  const error = new HttpError(
                    `Method ${context.method} Unauthorized`,
                  );
                  error.code = 405;
                  error.type = "method";
                  error.allow = req;
                  throw error;
                }
                break;
              case "object":
                const method = context.method as HTTPMethod;
                const methodLower = method.toLowerCase() as HTTPMethod;
                const allowedMethods = this.requirements[i] as HTTPMethod[];
                if (
                  !allowedMethods.includes(method) &&
                  !allowedMethods.includes(methodLower)
                ) {
                  const error = new HttpError(
                    `Method ${context.method} Unauthorized`,
                  );
                  error.code = 405;
                  error.type = "method";
                  error.allow = allowedMethods.join(",").toUpperCase();
                  throw error;
                }
                break;
              default:
                throw new Error(
                  `Bad config route method : ${this.requirements[i]}`,
                );
            }
            break;
          case "domain":
            // Géré par matchHostname (hostRegexp pré-compile host +
            // requirements.domain via le matcher partagé). No-op ici.
            break;
          case "protocol":
            switch (context.method) {
              case "WEBSOCKET":
                let requirement = this.requirements[i];
                if (!requirement) {
                  return true;
                }
                if (typeof requirement === "string") {
                  if (
                    (context as WebsocketContext).acceptedProtocol !==
                    requirement
                  ) {
                    const error = new HttpError(
                      `Protocol ${(context as WebsocketContext).acceptedProtocol} Unauthorized`,
                    );
                    error.code = 1002;
                    error.type = "protocol";
                    throw error;
                  }
                } else {
                  const error = new HttpError(
                    `Protocol ${(context as WebsocketContext).acceptedProtocol} Unauthorized`,
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
