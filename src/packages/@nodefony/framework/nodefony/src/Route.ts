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
import type { RouteActionMeta } from "../decorators/routerDecorators.js";
import { createHash } from "node:crypto";
import { typeOf, stripTrailingSlashes, escapeRegExp } from "nodefony";
import Controller from "./Controller";

/**
 * Motif d'un segment variable : `{id}`, `/{slug}?`, `.{format}`, `{id}(\d+)`.
 *
 * Les deux quantificateurs sont **bornés**, et ce n'est pas de la coquetterie :
 * `[^}]+` suivi d'un `}` obligatoire fait reprendre le moteur à chaque position
 * quand l'accolade fermante n'arrive jamais — un temps polynomial en la longueur
 * du chemin (`{{{{{{…`). Ici l'entrée est une route DÉCLARÉE par le développeur,
 * donc la dénégation de service n'est pas atteignable depuis une requête ; mais
 * ceci est une bibliothèque, et rien ne garantit qu'aucune application ne
 * fabriquera un jour une route à partir d'une donnée qu'elle n'a pas écrite.
 *
 * Les bornes sont larges au point d'être insensibles : un nom de variable de
 * plus de 128 caractères ou une contrainte de plus de 256 sont des erreurs de
 * frappe, pas des usages. Au-delà, le segment n'est plus reconnu comme variable
 * et le chemin est traité comme littéral — et `unreachableChars` le signale déjà
 * au démarrage, puisqu'une accolade est un caractère qu'aucun chemin ne porte.
 */
const REG_ROUTE = /(\/)?(\.)?\{([^}]{1,128})\}(?:\(([^)]{0,256})\))?(\?)?/g;

const REG_REPLACE_DOUBLE_SLASH = /\/+/g;

/**
 * Rend un morceau LITTÉRAL du chemin sous forme de motif — le `*` final mis à
 * part, rien de ce que le développeur écrit ne doit valoir comme métacaractère.
 *
 * L'ordre importe, et c'est tout le défaut d'avant : le motif était assemblé
 * d'abord, échappé ensuite, et seuls `/` et `.` l'étaient. Un chemin
 * `"/a|b"` produisait donc `^\/a|b$` — qui ne reconnaît pas « /a ou /b » mais
 * « commence par /a » **ou** « finit par b », soit `/n/importe/quoi/b` ; un
 * `"/pricing/(beta)"` reconnaissait `/pricing/beta` et refusait le chemin
 * déclaré. Symétriquement, la passe d'échappement mordait sur les contraintes
 * du développeur : `{id}(\d+\.\d+)` devenait `(\d+\\.\d+)`, où `\\.` est une
 * barre inverse littérale — la route ne reconnaissait plus rien.
 *
 * @param literal - le morceau de chemin situé hors de toute variable `{…}`.
 * @param wildcard - le chemin se termine-t-il par `*` (route « fourre-tout ») ?
 * @returns le morceau prêt à être concaténé au motif.
 */
/**
 * Caractères qu'un chemin de requête ne porte JAMAIS littéralement — l'analyseur
 * d'URL les encode (`^` → `%5E`, `{` → `%7B`, `}` → `%7D`) ou les traite comme
 * un délimiteur (`?` ouvre la requête, `#` le fragment, `\` est replié en `/`).
 *
 * Une route qui en déclare un est donc **inatteignable**. Elle l'était déjà
 * avant que les littéraux ne soient neutralisés — à ceci près qu'elle
 * reconnaissait alors *autre chose*, ce qui est pire. Dans les deux cas, rien
 * ne le disait : d'où l'avertissement au démarrage.
 *
 * RFC 3986 §3.3 est plus stricte encore (`pchar` n'admet ni `|`, ni `[`, ni
 * `]`), mais les analyseurs réels les laissent passer : cette liste retient ce
 * qui est VÉRIFIÉ inatteignable, pas ce qui est interdit sur le papier.
 */
const UNREACHABLE_IN_PATHNAME = new Set(["^", "{", "}", "\\", "?", "#"]);

function compileLiteral(literal: string, wildcard: boolean): string {
  if (!wildcard) {
    return escapeRegExp(literal);
  }
  // Le `*` reste le seul caractère du chemin qui garde un pouvoir — il vaut
  // « n'importe quel suffixe », barre oblique finale tolérée.
  return literal.split("*").map(escapeRegExp).join("(.*)/?");
}
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
  // oxlint-disable-next-line typescript/no-explicit-any -- signature de constructeur générique — `unknown[]` casse l'assignabilité des classes concrètes
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
    // `slash` et `dot` viennent du chemin — donc littéraux, donc échappés ici :
    // c'est le callback qui les émet, plus aucune passe globale derrière.
    // `capture` (la contrainte du développeur) et `opt` sont, eux, des motifs
    // VOULUS et restent intacts.
    if (checkDefaultParameters.call(this, key)) {
      return `${(slash ? "\\/?" : "") + (dot ? "\\." : "")}(${capture || "[^/]*"})${opt || ""}`;
    }
    return `${(slash ? "\\/" : "") + (dot ? "\\." : "")}(${capture || "[^/]+"})${opt || ""}`;
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
  /**
   * Court-circuite le firewall pour cette route — `handleSecurity` retourne sans
   * exécuter la chaîne d'authenticators. Réservé aux routes qui SONT le mécanisme
   * d'auth (login/logout/me du flux BFF) : elles ne peuvent pas être gardées par
   * le mécanisme qu'elles servent. Défaut `false` (Zero Trust).
   */
  bypassFirewall?: boolean;
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
  /**
   * Caractères du chemin déclaré qu'une requête ne peut PAS porter — la route
   * est donc inatteignable. `undefined` tant que rien n'a été trouvé (le cas de
   * toutes les routes saines : aucune allocation).
   *
   * @see {@link UNREACHABLE_IN_PATHNAME}
   */
  unreachableChars?: string[];
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
  /**
   * P3a — requirements pré-compilés au boot (0 alloc par match) :
   * `methodsSet` = méthodes autorisées normalisées UPPERCASE (lookup O(1)) ;
   * `methodsAllow` = valeur du header `Allow` du 405, jointe UNE fois ;
   * `varRegexp` = requirements de variables de route (string → RegExp).
   * `this.requirements` reste la config BRUTE (hash de route + introspection).
   */
  methodsSet?: Set<string>;
  methodsAllow?: string;
  varRegexp?: Record<string, RegExp>;
  bypassFirewall: boolean = false;
  /**
   * P2.9 — Cache mémoïsé : l'action attend-elle le **flux brut** du body
   * (`@Body({ stream:true })`) ? `undefined` = pas encore calculé (résolu au 1er
   * `routeExpectsBodyStream(route)` via lecture `Reflect` des `ParamMeta`, O(1)
   * ensuite). Lu en amont par `handleHttp` pour sauter le parse.
   */
  bodyStream?: boolean;
  /**
   * P5 — Metadata d'action figées (`@HttpCode`/`@Header`/`@Redirect`/params/
   * session), memo au 1er hit comme {@link bodyStream} : `undefined` = pas
   * encore résolu (via `resolveActionMeta`, 1 lecture Reflect par route, O(1)
   * ensuite → plus aucun `Reflect.getMetadata` par requête). Objet PARTAGÉ
   * entre requêtes — ne jamais muter. Posé après `generateId()` → hash stable.
   */
  actionMeta?: RouteActionMeta;
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
      this.bypassFirewall = obj.bypassFirewall ?? false;
      this.compile();
    }
    this.generateId();
  }

  /**
   * Normalise le pathname de la requête pour le matching : retire le(s)
   * slash(es) final(aux) via `stripTrailingSlashes`. À calculer UNE fois
   * par requête dans `Router.resolve`, puis à passer à chaque {@link Route.match}
   * scannée — sinon le getter `URL.pathname` + la normalisation sont refaits
   * pour CHAQUE route du scan O(N) (hot path, ~N routes/req).
   *
   * @param context - contexte HTTP/WS courant.
   * @returns le pathname sans slash final, ou `undefined` si la requête n'a pas d'URL.
   */
  static cleanPathname(context: ContextType): string | undefined {
    const reqUrl = context.request?.url;
    if (!reqUrl) {
      return undefined;
    }
    // Pas `replace(/\/+$/, "")` : sur un chemin qui ne se termine PAS par une
    // barre, cette forme est quadratique — et le chemin vient du réseau. Le
    // helper lit en O(n) et n'alloue rien quand il n'y a rien à couper, ce qui
    // est le cas de la quasi-totalité des requêtes.
    return stripTrailingSlashes((reqUrl as URL).pathname);
  }

  match(context: ContextType, cleanPath?: string, methodOverride?: string) {
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

    this.hydrateDefaultParameters(res);
    // check Hostname AVANT les requirements (RFC 9110 : la ressource cible est
    // identifiée par l'URI HOST COMPRIS) — une route restreinte à un autre vhost
    // jette 403 et ne peut plus polluer la résolution d'une 405 portant SES
    // méthodes (fuite cross-vhost du header Allow, cf banc routing NR §D).
    this.matchHostname(context);
    // check requierments
    this.matchRequirements(context, methodOverride);
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
          // P3a : RegExp pré-compilée au boot (varRegexp, lookup O(1)).
          // Chemin froid (clé réservée homonyme, jamais en pratique) : legacy.
          let compiled = this.varRegexp?.[k];
          if (!compiled) {
            if (req instanceof RegExp) {
              compiled = req;
            } else if (typeof req === "string") {
              compiled = new RegExp(req);
            } else {
              throw {
                BreakException: `Requirement Routing config Exception variable : ${k} must be RegExp or string : ${typeOf(req)}`,
              };
            }
          }
          result = compiled.test(param ?? "");
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
   * Relève, dans un morceau LITTÉRAL du chemin, les caractères qu'une requête
   * ne portera jamais. Alloue seulement s'il y en a — le cas normal ne coûte
   * qu'un balayage.
   *
   * @param literal - morceau de chemin hors variable `{…}`.
   */
  #collectUnreachable(literal: string): void {
    for (const char of literal) {
      if (
        UNREACHABLE_IN_PATHNAME.has(char) &&
        !this.unreachableChars?.includes(char)
      ) {
        (this.unreachableChars ??= []).push(char);
      }
    }
  }

  /**
   * Compile the route into a regular expression pattern.
   * @returns The compiled regular expression pattern.
   */
  compile() {
    if (!this.path) {
      this.path = "";
    }
    // Les LITTÉRAUX du chemin sont neutralisés AVANT que les groupes de
    // variables ne soient posés — l'inverse (échapper le motif déjà assemblé)
    // laissait passer tout métacaractère écrit dans le chemin ET abîmait les
    // contraintes du développeur. Cf {@link compileLiteral}.
    const wildcard = this.path.endsWith("*");
    let pattern = "";
    let from = 0;
    // `replaceCallback` EMPILE dans `variables` : sans remise à zéro, une route
    // recompilée (changement de préfixe, réenregistrement) déclare ses noms de
    // variables deux fois, puis trois. Le motif, lui, reste juste — le défaut ne
    // se voyait donc pas.
    this.variables.length = 0;
    this.unreachableChars = undefined;
    REG_ROUTE.lastIndex = 0;
    let found: RegExpExecArray | null;
    while ((found = REG_ROUTE.exec(this.path)) !== null) {
      const literal = this.path.slice(from, found.index);
      this.#collectUnreachable(literal);
      pattern += compileLiteral(literal, wildcard);
      pattern += replaceCallback.call(
        this,
        found[0],
        found[1],
        found[2],
        found[3],
        found[4],
        found[5],
        found.index,
      );
      from = found.index + found[0].length;
    }
    const tail = this.path.slice(from);
    this.#collectUnreachable(tail);
    pattern += compileLiteral(tail, wildcard);
    this.pattern = new RegExp(`^${pattern}$`, "i");
    this.compileHost();
    this.compileRequirements();
    return this.pattern;
  }

  /**
   * Pré-compile les requirements (P3a) — méthodes normalisées en Set UPPERCASE
   * + RegExp des requirements de variables. Appelé par {@link compile} et
   * {@link addRequirement} ; {@link matchRequirements} et la boucle de
   * variables ne font plus que des lookups (0 alloc, 0 RegExp par match).
   * Une RegExp string invalide throw ICI (création de la route, fail-fast)
   * au lieu du 1er match.
   */
  compileRequirements(): void {
    this.methodsSet = undefined;
    this.methodsAllow = undefined;
    this.varRegexp = undefined;
    const methods = this.requirements?.methods;
    if (typeof methods === "string") {
      const list = methods.replace(/\s/g, "").toUpperCase().split(",");
      this.methodsSet = new Set(list);
      this.methodsAllow = list.join(",");
    } else if (Array.isArray(methods)) {
      const list = methods.map((m) => String(m).toUpperCase());
      this.methodsSet = new Set(list);
      this.methodsAllow = list.join(",");
    }
    for (const k in this.requirements) {
      if (
        k === "methods" ||
        k === "domain" ||
        k === "protocol" ||
        k === "scheme"
      ) {
        continue;
      }
      const req: unknown = (this.requirements as Record<string, unknown>)[k];
      const compiled =
        req instanceof RegExp
          ? req
          : typeof req === "string"
            ? new RegExp(req)
            : null;
      if (compiled) {
        (this.varRegexp ??= Object.create(null) as Record<string, RegExp>)[k] =
          compiled;
      }
    }
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

  toObject(): object {
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
    return (this.path = stripTrailingSlashes(
      (this.path as string).replace(REG_REPLACE_DOUBLE_SLASH, "/"),
    ));
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

  /**
   * Empreinte stable de la route — sert d'identité pour la comparer à
   * elle-même (deux déclarations identiques donnent la même empreinte, deux
   * chemins différents non). Ce n'est PAS un secret, et rien ne la vérifie :
   * elle n'est ni persistée, ni exposée, ni transmise.
   *
   * SHA-256 et non MD5, bien qu'aucune propriété cryptographique ne soit
   * requise ici : `JSON.stringify(this)` sérialise la route ENTIÈRE, donc ses
   * `defaults` et ses `requirements` — ce que l'analyse statique lit, à juste
   * titre, comme une donnée d'application passée dans un condensat cassé. Le
   * coût est nul (une fois à la déclaration) et personne ne dépend de la
   * valeur ; garder MD5 n'aurait acheté qu'une alerte à réexpliquer.
   *
   * @returns l'empreinte hexadécimale, également posée sur {@link hash}.
   */
  generateId(): string {
    this.hash = createHash("sha256").update(JSON.stringify(this)).digest("hex");
    return this.hash;
  }

  addRequirement<K extends keyof RouteRequirements>(
    key: K,
    value: RouteRequirements[K],
  ): RouteRequirements[K] | undefined {
    if (key && value) {
      this.requirements[key] = value;
      // Maintient l'invariant P3a (pré-compilés ↔ config brute).
      this.compileRequirements();
      return value;
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
  matchRequirements(context: ContextType, methodOverride?: string): boolean {
    if (this.hasRequirements()) {
      for (const i in this.requirements) {
        switch (i) {
          case "methods":
            // P3a : Set UPPERCASE pré-compilé au boot — 0 alloc par match
            // (avant : replace+toUpperCase+split par requête). `methodsSet`
            // absent = type de config invalide → même throw qu'avant.
            if (!this.methodsSet) {
              throw new Error(
                `Bad config route method : ${this.requirements[i]}`,
              );
            }
            // Pont WS-RPC `api.request` d'une MUTATION : `context.method` vaut
            // toujours "WEBSOCKET" (le transport) → insuffisant pour distinguer
            // GET-via-WS de POST-via-WS sur un MÊME chemin. `methodOverride` (la
            // méthode HTTP LOGIQUE demandée par le pont) lève l'ambiguïté : la
            // route doit déclarer À LA FOIS le transport WEBSOCKET (pontable,
            // zéro bypass) ET la méthode logique voulue. Le chemin HTTP/GET
            // normal (override absent) garde le comportement historique.
            if (methodOverride !== undefined) {
              if (
                !this.methodsSet.has("WEBSOCKET") ||
                !this.methodsSet.has(methodOverride)
              ) {
                const error = new HttpError(
                  `Method ${methodOverride} Unauthorized`,
                );
                error.code = 405;
                error.type = "method";
                error.allow = this.methodsAllow ?? "";
                throw error;
              }
              break;
            }
            if (!this.methodsSet.has(context.method as string)) {
              const error = new HttpError(
                `Method ${context.method} Unauthorized`,
              );
              error.code = 405;
              error.type = "method";
              error.allow = this.methodsAllow ?? "";
              throw error;
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
