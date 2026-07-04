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
  readonly host?: string;
  readonly realtime: boolean;

  constructor(name: string, config: ISecurityAreaConfig) {
    this.name = name;
    this.pattern = new RegExp(config.pattern, "u");
    this.security = config.security;
    this.stateless = config.stateless;
    this.mode = config.mode;
    this.authenticators = config.authenticators;
    this.host = config.host;
    this.realtime = config.realtime;
  }

  /**
   * Cœur du match — pathname (+ host éventuel) déjà extraits, SANS `context`.
   * Réutilisable par le verrou WebSocket (une frame n'a qu'un path) : source
   * UNIQUE de la décision de zone (invariant `api.request {path}` ≤ `GET {path}`).
   */
  matchPath(pathname: string, host?: string): boolean {
    // Filtre domaine d'abord (vhost) : host = Host header de la requête/connexion.
    if (this.host && this.host !== host) return false;
    return this.pattern.test(pathname);
  }

  /** La requête tombe-t-elle dans cette zone ? (host éventuel + pathname). */
  match(context: ContextType): boolean {
    const req = context.request;
    if (!req || !req.url) return false;
    const pathname =
      req.url instanceof URL ? req.url.pathname : String(req.url);
    return this.matchPath(pathname, (context as { domain?: string }).domain);
  }
}

export default SecuredArea;
