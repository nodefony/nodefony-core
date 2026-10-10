import { stripTrailingSlashes } from "nodefony";
import type { ContextType } from "@nodefony/http";
import type { ISecuredArea } from "../contracts/ISecuredArea";
import type { ISecurityAreaConfig } from "../config/defineModuleConfig";

/**
 * Zone sécurisée concrète — pattern d'URL compilé + métadonnées d'authentification.
 *
 * Objet **léger** (pas un Service DI : zéro besoin d'event/log par zone, hot-path).
 * Le firewall en instancie une par entrée `areas` de la config, triées par
 * spécificité au boot.
 */
export class SecuredArea implements ISecuredArea {
  readonly name: string;
  readonly pattern: RegExp;
  readonly security: boolean;
  readonly stateless: boolean;
  readonly mode: "first" | "all";
  readonly authenticators: readonly string[];
  readonly host?: string | undefined;
  readonly realtime: boolean;
  readonly resource?: string | undefined;
  /**
   * Rôles exigés par défaut dans la zone, ou `null` quand elle n'en exige
   * aucun. `null` plutôt qu'un tableau vide : le hot path teste une référence,
   * et aucune zone ne porte de tableau qu'elle n'utilise pas.
   */
  readonly roles: readonly string[] | null;
  // Hôte comparé sans casse (RFC 9110 §4.2.3), calculé une fois.
  readonly #hostKey: string | null;

  constructor(name: string, config: ISecurityAreaConfig) {
    this.name = name;
    // `i` : le routeur résout les routes SANS tenir compte de la casse
    // (`Route.compile`). Une zone plus stricte laisserait `/ADMIN` servi par la
    // route de `/admin` sans qu'aucune zone ne le garde.
    this.pattern = new RegExp(config.pattern, "iu");
    this.security = config.security;
    this.stateless = config.stateless;
    this.mode = config.mode;
    this.authenticators = config.authenticators;
    this.host = config.host;
    this.#hostKey = config.host ? config.host.toLowerCase() : null;
    this.realtime = config.realtime;
    this.resource = config.resource;
    this.roles = config.roles.length > 0 ? config.roles : null;
  }

  /**
   * Cœur du match — pathname (+ host éventuel) déjà extraits, SANS `context`.
   * Réutilisable par le verrou WebSocket (une frame n'a qu'un path) : source
   * UNIQUE de la décision de zone (invariant `api.request {path}` ≤ `GET {path}`).
   */
  matchPath(pathname: string, host?: string): boolean {
    // Filtre domaine d'abord (vhost) : host = Host header de la requête/connexion.
    if (this.#hostKey !== null && this.#hostKey !== host?.toLowerCase())
      return false;
    if (this.pattern.test(pathname)) return true;
    // Le routeur sert `/x/` comme `/x` (`Route.cleanPathname`) : la zone doit
    // couvrir la même forme, sinon un motif ancré (`^/x$`) laisse passer la
    // barre finale. `stripTrailingSlashes` rend la MÊME chaîne quand il n'y a
    // rien à couper — le second test n'est payé que par ces requêtes-là.
    const bare = stripTrailingSlashes(pathname);
    return bare !== pathname && this.pattern.test(bare);
  }

  /** La requête tombe-t-elle dans cette zone ? (host éventuel + pathname). */
  match(context: ContextType): boolean {
    const req = context.request;
    if (!req) return false;
    // F-B : même lecture que `Firewall.isSecure` — `request.pathname` (string
    // normalisée) d'abord, pour ne pas déclencher le getter URL paresseux.
    const rp = (req as { pathname?: unknown }).pathname;
    if (typeof rp === "string") {
      return this.matchPath(rp, (context as { domain?: string }).domain);
    }
    if (!req.url) return false;
    const pathname =
      req.url instanceof URL ? req.url.pathname : String(req.url);
    return this.matchPath(pathname, (context as { domain?: string }).domain);
  }
}

export default SecuredArea;
