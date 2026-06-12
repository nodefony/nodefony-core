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
import { AuthenticationError } from "../errors/AuthenticationError";
import { ThrottledError } from "../errors/ThrottledError";
import {
  defineSecurityConfig,
  type ISecurityConfig,
} from "../config/defineSecurityConfig";
import {
  getAuthenticatorFactory,
  listAuthenticatorFactories,
} from "../src/authenticator/authenticatorRegistry";
import type { IFirewall } from "../contracts/IFirewall";
import type { IAuthenticator } from "../contracts/IAuthenticator";
import type { IToken } from "../contracts/IToken";
import type { ISecuredArea } from "../contracts/ISecuredArea";

const serviceName = "firewall";

// Surface minimale d'une réponse capable de porter un en-tête (HTTP/HTTP2 —
// une réponse WS ne l'a pas : capability check, jamais de cast aveugle).
interface IHeaderCapableResponse {
  setHeader?: (name: string, value: string | readonly string[]) => unknown;
}

/**
 * Orchestrateur de sécurité Nodefony — refonte 2026 (P6).
 *
 * `isSecure()` (hot-path, court-circuit si aucune zone) ne fait QUE matcher la
 * zone et poser `context.security`. `handleSecurity()` (lazy, seulement sur une
 * zone protégée) exécute la chaîne d'authentication selon le `mode` de la zone
 * (`first` : le premier qui reconnaît la requête authentifie ; `all` : tous
 * doivent passer, le dernier porte l'identité) → propage l'utilisateur dans
 * l'ALS → applique le **Zero Trust** (zone protégée sans preuve acceptée → 401,
 * sauf anonymat explicite via l'authenticator `anonymous`).
 *
 * **Fail-closed** : config invalide au boot (Zod, nom d'authenticator inconnu)
 * → le firewall capture TOUT le trafic et répond 401 (jamais une app servie
 * sans sa sécurité). Erreur interne pendant l'authentification (source
 * d'identité down, câblage manquant) → log ERROR serveur + 401 générique
 * (aucun détail ne fuite au client).
 *
 * Conformité : tout 401 porte un challenge `WWW-Authenticate` (RFC 7235) fourni
 * par le premier authenticator de la zone qui en déclare un.
 *
 * CORS, CSRF et autorisation par décorateurs viennent se brancher en S4/S5.
 * Toutes les structures sont **lazy** (perf : une app sans zone = zéro alloc).
 */
class Firewall extends Service implements IFirewall {
  // Zones triées par spécificité — null tant qu'aucune zone n'est configurée.
  #areas: SecuredArea[] | null = null;
  // Authenticators par nom — null tant qu'aucun n'est enregistré/instancié.
  #authenticators: Map<string, IAuthenticator> | null = null;
  #roleHierarchy: RoleHierarchyWalker | null = null;
  // Config validée + gelée (consommée par les fabriques d'authenticators).
  #config: ISecurityConfig | null = null;
  // Fail-closed : posée si la config sécurité est invalide au boot → le
  // firewall capture toutes les requêtes et les rejette tant que c'est cassé.
  #configError: Error | null = null;

  constructor(public module: Module) {
    super(
      serviceName,
      module.container as Container,
      module.notificationsCenter as Event,
      module.options,
    );
    this.kernel?.once("onBoot", () => this.#build());
  }

  // Compile config (Zod fail-fast) + zones + hiérarchie de rôles +
  // authenticators référencés (via le registre de fabriques) — au boot.
  #build(): void {
    try {
      this.#config = defineSecurityConfig(
        this.options as Parameters<typeof defineSecurityConfig>[0],
      );
    } catch (e) {
      this.#configError = e as Error;
      this.log(
        `Security configuration INVALID — firewall fail-closed, ALL requests rejected: ${
          (e as Error).message
        }`,
        "CRITIC",
      );
      return;
    }
    this.#roleHierarchy = new RoleHierarchyWalker(this.#config.roleHierarchy);

    const areas = this.#config.areas;
    const names = Object.keys(areas);
    if (names.length) {
      const list: SecuredArea[] = [];
      for (const name of names) {
        list.push(new SecuredArea(name, areas[name]));
      }
      // Spécificité : pattern le plus long d'abord (déterministe, simple).
      list.sort((a, b) => b.pattern.source.length - a.pattern.source.length);
      this.#areas = list;
      this.#instantiateAuthenticators(list);
    }

    if (!this.#configError) {
      this.log(
        `Firewall ready — ${this.#areas?.length ?? 0} area(s), ${
          this.#authenticators?.size ?? 0
        } authenticator(s)`,
        "DEBUG",
      );
    }
  }

  // Instancie via le registre les authenticators référencés par les zones
  // (lazy : seuls les noms utilisés coûtent). Nom inconnu = config morte →
  // fail-closed (un typo ne doit pas devenir un 401 mystère en prod).
  #instantiateAuthenticators(areas: SecuredArea[]): void {
    for (const area of areas) {
      for (const name of area.authenticators) {
        if (this.#authenticators?.has(name)) continue; // plugin déjà enregistré
        const factory = getAuthenticatorFactory(name);
        if (!factory) {
          this.#configError = new Error(
            `area "${area.name}": authenticator "${name}" unknown — registered: ` +
              `[${listAuthenticatorFactories().join(", ")}]`,
          );
          this.log(
            `Security configuration INVALID — ${this.#configError.message}`,
            "CRITIC",
          );
          return;
        }
        this.registerAuthenticator(
          factory({
            container: this.container as Container,
            config: this.#config as ISecurityConfig,
          }),
        );
      }
    }
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
    if (this.#configError) return true; // fail-closed : tout capturer
    if (!this.#areas) return false; // aucune zone → court-circuit hot-path
    for (const area of this.#areas) {
      if (area.match(context)) {
        context.security = area;
        return true;
      }
    }
    return false;
  }

  /**
   * Pipeline complet de la zone : chaîne d'authenticators (selon `mode`) → ALS
   * → Zero Trust. Rejette (401, challenge RFC 7235 posé) ou résout.
   */
  async handleSecurity(context: ContextType): Promise<ContextType> {
    if (this.#configError) {
      // Fail-closed : le détail (CRITIC au boot) ne fuite jamais au client.
      throw new AuthenticationError("Security configuration invalid");
    }
    const area = context.security as ISecuredArea | null | undefined;
    if (!area || !area.security) return context; // hors zone ou zone publique
    const bypass = (context as { resolver?: { bypassFirewall?: boolean } })
      .resolver?.bypassFirewall;
    if (bypass) return context;

    let token: IToken | null;
    try {
      token = await this.#authenticate(context, area);
    } catch (error) {
      if (error instanceof ThrottledError) {
        // 429 (RFC 6585) : pas un défi d'authentification — `Retry-After`
        // (le client légitime sait quoi attendre), pas de WWW-Authenticate.
        context.response?.setHeader("Retry-After", String(error.retryAfterS));
        throw error;
      }
      this.#setChallenge(context, area); // la réponse 401 porte WWW-Authenticate
      throw error;
    }

    // Zero Trust : aucune preuve présentée dans une zone protégée → 401.
    if (token === null) {
      this.#setChallenge(context, area);
      throw new AuthenticationError(
        `Authentication required for area "${area.name}"`,
      );
    }

    RequestContext.set("user", token.getUser());

    // Défense en profondeur : seul l'anonymat EXPLICITE (authenticator
    // `anonymous` listé dans la zone) autorise un token non authentifié.
    if (!token.isAuthenticated() && token.type !== "anonymous") {
      this.#setChallenge(context, area);
      throw new AuthenticationError(
        `Authentication required for area "${area.name}"`,
      );
    }
    return context;
  }

  /**
   * Exécute la chaîne d'authenticators de la zone selon son `mode`.
   *
   * `first` : le premier dont `supports()` est vrai authentifie — un credential
   * PRÉSENTÉ mais invalide échoue immédiatement (jamais de fallback silencieux
   * vers le maillon suivant). Aucune preuve présentée → `null`.
   *
   * `all` : tous les maillons doivent supporter ET authentifier (MFA) ; le
   * DERNIER token porte l'identité. Une preuve manquante = 401.
   *
   * @returns le token accepté, ou `null` si aucune preuve n'a été présentée.
   * @throws AuthenticationError (401) — credential invalide ou preuve manquante
   *   (mode `all`). Toute erreur interne est logguée ERROR puis wrappée 401
   *   fail-closed (rien ne fuite au client).
   */
  async #authenticate(
    context: ContextType,
    area: ISecuredArea,
  ): Promise<IToken | null> {
    let token: IToken | null = null;
    for (const name of area.authenticators) {
      const authenticator = this.#authenticators?.get(name);
      if (!authenticator) {
        // Filet runtime (la validation boot rend ce cas quasi impossible) :
        // un maillon manquant ne doit JAMAIS laisser passer.
        this.log(`authenticator "${name}" not registered`, "ERROR");
        throw new AuthenticationError(
          `Authentication required for area "${area.name}"`,
        );
      }
      if (!authenticator.supports(context)) {
        if (area.mode === "first") continue; // pas de credential pour ce maillon
        // mode "all" : chaque preuve est obligatoire.
        throw new AuthenticationError(
          `Authentication required for area "${area.name}"`,
        );
      }
      const created = await authenticator.createToken(context);
      let authenticated: IToken;
      try {
        authenticated = await authenticator.authenticate(created);
      } catch (error) {
        await authenticator.onFailure(context, error as Error);
        if (error instanceof AuthenticationError) {
          this.log(
            `authentication failed (area "${area.name}", authenticator "${name}")`,
            "WARNING",
          );
          throw error;
        }
        if (error instanceof ThrottledError) {
          // Backoff NIST actif : remonte tel quel (429 + Retry-After posé par
          // handleSecurity) — surtout pas wrappé en 401 générique.
          this.log(
            `login throttled (area "${area.name}", authenticator "${name}", retry in ${error.retryAfterS}s)`,
            "WARNING",
          );
          throw error;
        }
        // Erreur INTERNE (source d'identité down, câblage) : signal ops complet
        // côté serveur, 401 générique côté client (fail-closed, zéro fuite).
        this.log(error, "ERROR");
        throw new AuthenticationError("Authentication failed");
      }
      await authenticator.onSuccess(context, authenticated);
      if (area.mode === "first") return authenticated;
      token = authenticated; // mode "all" : le dernier porte l'identité
    }
    return token;
  }

  // Pose le challenge WWW-Authenticate (RFC 7235 : tout 401 DOIT en porter un)
  // du premier authenticator de la zone qui en déclare. Cold path (401 only).
  // Capability check : une réponse WS n'a pas d'en-têtes (le close code suffit).
  #setChallenge(context: ContextType, area: ISecuredArea): void {
    const response = (context as { response?: IHeaderCapableResponse | null })
      .response;
    if (typeof response?.setHeader !== "function") return;
    for (const name of area.authenticators) {
      const challenge = this.#authenticators?.get(name)?.challenge?.();
      if (challenge) {
        response.setHeader("WWW-Authenticate", challenge);
        return;
      }
    }
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
