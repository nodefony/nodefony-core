import type { ContextType } from "@nodefony/http";
import type { ISecuredArea } from "../contracts/ISecuredArea";
import type { ISecurityAreaConfig } from "../config/defineSecurityConfig";

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

  constructor(name: string, config: ISecurityAreaConfig) {
    this.name = name;
    this.pattern = new RegExp(config.pattern, "u");
    this.security = config.security;
    this.stateless = config.stateless;
    this.mode = config.mode;
    this.authenticators = config.authenticators;
    this.host = config.host;
  }

  /** La requête tombe-t-elle dans cette zone ? (host éventuel + pathname). */
  match(context: ContextType): boolean {
    // Filtre domaine d'abord (vhost) : context.domain = Host header.
    if (this.host && (context as { domain?: string }).domain !== this.host) {
      return false;
    }
    const req = context.request;
    if (!req || !req.url) return false;
    const pathname =
      req.url instanceof URL ? req.url.pathname : String(req.url);
    return this.pattern.test(pathname);
  }
}

export default SecuredArea;
