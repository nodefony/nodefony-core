import {
  Service,
  Module,
  Container,
  Event,
  RequestContext,
  Severity,
  Msgid,
  Message,
  Pdu,
  logColor,
} from "nodefony";
import type { ContextType } from "@nodefony/http";

import { SecuredArea } from "../src/SecuredArea";
import { RoleHierarchyWalker } from "../src/RoleHierarchyWalker";
import { AnonymousToken } from "../src/token/AnonymousToken";
import { AuthenticationError } from "../errors/AuthenticationError";
import type { IFirewall } from "../contracts/IFirewall";
import type { IAuthenticator } from "../contracts/IAuthenticator";
import type { IToken } from "../contracts/IToken";
import type { ISecuredArea } from "../contracts/ISecuredArea";
import type { ISecurityAreaConfig } from "../config/defineSecurityConfig";

const serviceName = "firewall";

/**
 * Orchestrateur de sécurité Nodefony — refonte 2026 (P6).
 *
 * `isSecure()` (hot-path, court-circuit si aucune zone) ne fait QUE matcher la
 * zone et poser `context.security`. `handleSecurity()` (lazy, seulement sur une
 * zone protégée) exécute la chaîne d'authentication → propage l'utilisateur dans
 * l'ALS → applique le **Zero Trust** (zone protégée + visiteur anonyme → 401).
 *
 * CORS, CSRF et autorisation par décorateurs viennent se brancher en S4/S5.
 * Toutes les structures sont **lazy** (perf : une app sans zone = zéro alloc).
 */
class Firewall extends Service implements IFirewall {
  // Zones triées par spécificité — null tant qu'aucune zone n'est configurée.
  #areas: SecuredArea[] | null = null;
  // Authenticators enregistrés par nom — null tant qu'aucun n'est enregistré.
  #authenticators: Map<string, IAuthenticator> | null = null;
  #roleHierarchy: RoleHierarchyWalker | null = null;

  constructor(public module: Module) {
    super(
      serviceName,
      module.container as Container,
      module.notificationsCenter as Event,
      module.options,
    );
    this.kernel?.once("onBoot", () => this.#build());
  }

  // Compile les zones + la hiérarchie de rôles depuis la config (au boot).
  #build(): void {
    const opts = this.options as {
      areas?: Record<string, ISecurityAreaConfig>;
      roleHierarchy?: Record<string, string[]>;
    };
    this.#roleHierarchy = new RoleHierarchyWalker(opts.roleHierarchy ?? {});

    const areas = opts.areas ?? {};
    const names = Object.keys(areas);
    if (names.length) {
      const list: SecuredArea[] = [];
      for (const name of names) {
        try {
          list.push(new SecuredArea(name, areas[name]));
        } catch (e) {
          this.log(e, "ERROR");
        }
      }
      // Spécificité : pattern le plus long d'abord (déterministe, simple).
      list.sort((a, b) => b.pattern.source.length - a.pattern.source.length);
      this.#areas = list;
    }

    this.log(
      `Firewall ready — ${this.#areas?.length ?? 0} area(s), ${
        this.#authenticators?.size ?? 0
      } authenticator(s)`,
      "DEBUG",
    );
  }

  /** Hiérarchie de rôles résolue (niveau A de l'autorisation, P6.8). */
  get roleHierarchy(): RoleHierarchyWalker {
    return (this.#roleHierarchy ??= new RoleHierarchyWalker());
  }

  registerAuthenticator(authenticator: IAuthenticator): void {
    (this.#authenticators ??= new Map()).set(authenticator.name, authenticator);
  }

  getArea(name: string): ISecuredArea | undefined {
    return this.#areas?.find((a) => a.name === name);
  }

  /** Match rapide de zone — pose `context.security`. `true` si zone capturée. */
  isSecure(context: ContextType): boolean {
    if (!this.#areas) return false; // aucune zone → court-circuit hot-path
    for (const area of this.#areas) {
      if (area.match(context)) {
        context.security = area;
        return true;
      }
    }
    return false;
  }

  /** Pipeline complet de la zone : auth → ALS → Zero Trust. Rejette (401) ou résout. */
  async handleSecurity(context: ContextType): Promise<ContextType> {
    const area = context.security as ISecuredArea | null | undefined;
    if (!area || !area.security) return context; // hors zone ou zone publique
    const bypass = (context as { resolver?: { bypassFirewall?: boolean } })
      .resolver?.bypassFirewall;
    if (bypass) return context;

    const token = await this.#authenticate(context, area);
    RequestContext.set("user", token.getUser());

    // Zero Trust : zone protégée + visiteur anonyme → 401.
    if (!token.isAuthenticated()) {
      throw new AuthenticationError(
        `Authentication required for area "${area.name}"`,
      );
    }
    return context;
  }

  // Exécute la chaîne d'authenticators de la zone (premier supports() qui matche).
  async #authenticate(
    context: ContextType,
    area: ISecuredArea,
  ): Promise<IToken> {
    for (const name of area.authenticators) {
      const authenticator = this.#authenticators?.get(name);
      if (!authenticator) {
        this.log(`authenticator "${name}" not registered`, "WARNING");
        continue;
      }
      if (!authenticator.supports(context)) continue;
      const token = await authenticator.createToken(context);
      try {
        const authenticated = await authenticator.authenticate(token);
        await authenticator.onSuccess(context, authenticated);
        return authenticated;
      } catch (error) {
        await authenticator.onFailure(context, error as Error);
        throw error instanceof AuthenticationError
          ? error
          : new AuthenticationError(error as Error);
      }
    }
    // Aucun authenticator applicable → identité anonyme (Zero Trust géré en aval).
    return new AnonymousToken();
  }

  override log(
    pci: unknown,
    severity?: Severity,
    msgid?: Msgid,
    msg?: Message,
  ): Pdu {
    if (!msgid) {
      // Couleur gatée au boot (logColor) → msgid brut "FIREWALL" hors TTY (JSONL
      // queryable + pipe prod propres) ; cyan sur terminal interactif.
      msgid = logColor.cyan("FIREWALL");
    }
    return super.log(pci, severity, msgid, msg);
  }
}

export default Firewall;
export { Firewall };
