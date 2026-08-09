import type { Container } from "nodefony";
import type { ContextType } from "@nodefony/http";
import type { IUser, IUserProvider } from "@nodefony/user";
import type * as Jose from "jose";
import type { IAuthenticator } from "../../contracts/IAuthenticator";
import type { IToken } from "../../contracts/IToken";
import type { IJwtKeystore } from "../../contracts/IJwtKeystore";
import type { ITokenStore } from "../../contracts/ITokenStore";
import { AuthenticationError } from "../../errors/AuthenticationError";
import { UserToken } from "../token/UserToken";
import type { IJwtRuntime } from "../token/jwtRuntime";
import { bearerToken } from "./bearer";
import { peekIssuer } from "./peekIssuer";

// Scheme Bearer (RFC 6750 §2.1), case-insensitive, capture le token.

// Structure JWS compacte (RFC 7515 §3.1 / RFC 7519 §3) : 3 segments base64url
// séparés par des points (3ᵉ vide toléré → `alg=none` reste routé vers jose qui
// le rejette). Discrimine un JWT d'un bearer opaque (clé API `<prefix>_…`, sans
// point) → JwtAuthenticator et ApiKeyAuthenticator cohabitent dans une zone.
const COMPACT_JWS = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

// Message UNIFORME — la cause fine (expiré, aud, signature, sujet banni) part
// dans les logs d'audit, jamais au client (anti-énumération / anti-oracle).
const INVALID_TOKEN = "Invalid token";

type GetKey = ReturnType<typeof Jose.createLocalJWKSet>;

/**
 * Authentification par **JWT Bearer** (RFC 6750) — réservée API service↔service /
 * agents (le web utilise la session BFF). Vérifie un access token EdDSA signé par
 * le {@link IJwtKeystore} du serveur.
 *
 * Défenses **dures** (RFC 8725 JWT BCP, prouvées en test) :
 *  - **allowlist d'algorithmes** côté serveur (`["EdDSA"]`) — l'algo n'est JAMAIS
 *    choisi d'après l'en-tête du token (§3.1) ; `alg=none` jamais accepté par jose.
 *  - **clé par `kid` depuis le keyset LOCAL** (`createLocalJWKSet`) — jamais
 *    `jku`/`jwk` de l'en-tête (injection de clé / SSRF, §3.5).
 *  - **`aud` (§3.9) + `iss` (§3.8) obligatoires** + `typ:"at+jwt"` (§3.11, sépare
 *    access et refresh) + `exp`/`nbf` (jose).
 *  - **révocation** : denylist `jti` + seuil `invalidBefore` par porteur (le JWT
 *    est auto-porté et non révocable sans état serveur).
 *  - **sujet revérifié** (§3.10) : `loadUserByIdentifier(sub)` → compte disparu,
 *    inactif ou verrouillé = rejet.
 *
 * Dépendances (keystore, store, userProvider) résolues **paresseusement** du
 * container au premier usage (cold path) ; jose importé **lazy** (dep lourde).
 */
export class JwtAuthenticator implements IAuthenticator {
  readonly name = "jwt";
  readonly #container: Container;
  readonly #runtime: IJwtRuntime;
  #jose: typeof Jose | null = null;
  #getKey: GetKey | null = null;
  #keystore: IJwtKeystore | null = null;
  #store: ITokenStore | null = null;
  #userProvider: IUserProvider | null = null;

  /**
   * @param container - container DI (résolution lazy de `jwtKeystore`/`tokenStore`/`users`).
   * @param runtime - paramètres JWT effectifs (iss/aud/ttl) partagés avec l'émetteur.
   */
  constructor(container: Container, runtime: IJwtRuntime) {
    this.#container = container;
    this.#runtime = runtime;
  }

  /**
   * La requête porte-t-elle un `Authorization: Bearer <jws>` émis par NOUS ?
   *
   * L'émetteur revendiqué est lu sans être vérifié ({@link peekIssuer}) et sert
   * uniquement à AIGUILLER : `ExternalJwtAuthenticator` reconnaît la même forme
   * de credential pour les jetons d'un serveur d'autorisation tiers. Sans ce
   * discriminant, en mode `first`, le premier des deux listés dans la zone
   * capturerait les deux familles et refuserait la moitié des jetons — l'ordre
   * de la configuration deviendrait une décision de sécurité, dont l'erreur ne
   * se verrait qu'en production.
   *
   * Un jeton dont l'émetteur est illisible reste pris en charge ici : c'est un
   * jeton maison malformé, que la vérification refusera en le disant, plutôt
   * qu'un credential qui disparaîtrait sans laisser de trace.
   */
  supports(context: ContextType): boolean {
    const auth = context.request?.headers?.authorization;
    if (typeof auth !== "string") return false;
    const token = bearerToken(auth);
    if (token === null || !COMPACT_JWS.test(token)) return false;
    const issuer = peekIssuer(token);
    return issuer === null || issuer === this.#runtime.issuer;
  }

  /** Extrait le token brut (non vérifié) → porté par un `UserToken` type `"jwt"`. */
  createToken(context: ContextType): Promise<IToken> {
    const auth = context.request?.headers?.authorization;
    return Promise.resolve(new UserToken("jwt", bearerToken(auth) ?? ""));
  }

  /**
   * Vérifie la signature + les claims du JWT, applique la révocation et résout le
   * sujet — ou lève un 401 au message uniforme.
   *
   * @throws AuthenticationError (401) — token absent/invalide/expiré/révoqué, ou
   *   sujet disparu/banni.
   * @throws Error (câblage : keystore/store/users absents) — logguée ERROR par le
   *   firewall puis 401 fail-closed (rien ne fuite au client).
   */
  async authenticate(token: IToken): Promise<IToken> {
    const raw = token.getCredentials();
    if (typeof raw !== "string" || raw.length === 0) {
      throw new AuthenticationError(INVALID_TOKEN);
    }
    const jose = (this.#jose ??= (await import("jose")) as typeof Jose);
    // Résolution du keyset HORS du try crypto : une absence de câblage doit
    // remonter en Error (loggée ERROR), pas être masquée en « token invalide ».
    const getKey = await this.#ensureGetKey(jose);

    let payload: Jose.JWTPayload;
    try {
      const result = await jose.jwtVerify(raw, getKey, {
        algorithms: ["EdDSA"], // allowlist (RFC 8725 §3.1) — alg=none/confusion rejetés
        issuer: this.#runtime.issuer, // §3.8
        audience: this.#runtime.audiences, // §3.9 (MUST)
        typ: "at+jwt", // §3.11 — un refresh présenté comme access est rejeté
      });
      payload = result.payload;
    } catch {
      // Signature, alg, exp, nbf, aud/iss, typ, kid inconnu → 401 uniforme.
      throw new AuthenticationError(INVALID_TOKEN);
    }

    const sub = payload.sub;
    const jti = payload.jti;
    if (typeof sub !== "string" || typeof jti !== "string") {
      throw new AuthenticationError(INVALID_TOKEN);
    }

    // Révocation : ciblée (denylist jti) + en masse (logout global / ban du sujet).
    const store = this.#resolveStore();
    if (await store.isJtiDenied(jti)) {
      throw new AuthenticationError(INVALID_TOKEN);
    }
    const invalidBefore = await store.getInvalidBefore(sub);
    if (invalidBefore !== null) {
      const iatMs = typeof payload.iat === "number" ? payload.iat * 1000 : 0;
      if (iatMs < invalidBefore) {
        throw new AuthenticationError(INVALID_TOKEN);
      }
    }

    // Sujet valide à la réception (RFC 8725 §3.10) — disparu/inactif/verrouillé = rejet.
    const user = await this.#resolveUserOrReject(sub);
    return this.#promote(token, user, payload);
  }

  /** Slot audit (J4b). */
  onSuccess(_context: ContextType, _token: IToken): Promise<void> {
    return Promise.resolve();
  }

  /** Slot audit (J4b) — le 401 + challenge sont posés par le firewall. */
  onFailure(_context: ContextType, _error: Error): Promise<void> {
    return Promise.resolve();
  }

  /** Challenge RFC 6750/7235 posé par le firewall sur les 401 de la zone. */
  challenge(): string {
    return "Bearer";
  }

  /** Construit (une fois) le résolveur de clé par `kid` depuis le JWKS public. */
  async #ensureGetKey(jose: typeof Jose): Promise<GetKey> {
    if (this.#getKey !== null) return this.#getKey;
    const jwks = await this.#resolveKeystore().getPublicJWKS();
    return (this.#getKey = jose.createLocalJWKSet(jwks));
  }

  /** Promeut le token : utilisateur vérifié + scopes/claims posés en attributs. */
  #promote(token: IToken, user: IUser, payload: Jose.JWTPayload): IToken {
    const ut = token as UserToken;
    ut.promote(user);
    const scope = payload.scope;
    const scopes =
      typeof scope === "string" && scope.length > 0 ? scope.split(" ") : [];
    ut.setAttribute("scopes", scopes);
    ut.setAttribute("jti", payload.jti);
    ut.setAttribute("claims", payload);
    return ut;
  }

  async #resolveUserOrReject(sub: string): Promise<IUser> {
    const provider = this.#resolveUserProvider();
    let user: IUser;
    try {
      user = await provider.loadUserByIdentifier(sub);
    } catch {
      // Sujet inexistant : échec d'authentification (jamais une 500/fuite).
      throw new AuthenticationError(INVALID_TOKEN);
    }
    if (!user.isActive() || user.isLocked()) {
      throw new AuthenticationError(INVALID_TOKEN);
    }
    return user;
  }

  #resolveKeystore(): IJwtKeystore {
    if (this.#keystore === null) {
      const ks = this.#container.get<IJwtKeystore>("jwtKeystore");
      if (!ks) {
        throw new Error(
          "JwtAuthenticator: service 'jwtKeystore' absent du container — " +
            "le TokenService de @nodefony/security doit être chargé.",
        );
      }
      this.#keystore = ks;
    }
    return this.#keystore;
  }

  #resolveStore(): ITokenStore {
    if (this.#store === null) {
      const store = this.#container.get<ITokenStore>("tokenStore");
      if (!store) {
        throw new Error(
          "JwtAuthenticator: service 'tokenStore' absent du container — " +
            "le TokenService de @nodefony/security doit être chargé.",
        );
      }
      this.#store = store;
    }
    return this.#store;
  }

  #resolveUserProvider(): IUserProvider {
    if (this.#userProvider === null) {
      const provider = this.#container.get<IUserProvider>("users");
      if (!provider) {
        throw new Error(
          "JwtAuthenticator: aucun service 'users' (IUserProvider) dans le " +
            "container — enregistrer un UserService au boot de l'application.",
        );
      }
      this.#userProvider = provider;
    }
    return this.#userProvider;
  }
}

export default JwtAuthenticator;
