import type { Container } from "nodefony";
import type { ContextType } from "@nodefony/http";
import type { IUser, IUserProvider } from "@nodefony/user";
import type { IAuthenticator } from "../../contracts/IAuthenticator";
import type { IToken } from "../../contracts/IToken";
import type { ITokenStore } from "../../contracts/ITokenStore";
import { AuthenticationError } from "../../errors/AuthenticationError";
import { UserToken } from "../token/UserToken";
import { looksLikeApiKey, parseApiKey } from "../apikey/apiKeyFormat";
import { bearerToken } from "./bearer";

// Scheme Bearer (RFC 6750 §2.1), case-insensitive, capture la valeur.

// Message UNIFORME (anti-énumération) — la cause fine (forme, inconnue, révoquée,
// expirée, sujet banni) part en log d'audit, jamais au client (RFC 6750 §3.1 :
// `invalid_token` → 401, posé par le firewall).
const INVALID_TOKEN = "Invalid token";

/**
 * Marqueur interne posé par `authenticate()` et consommé par `onSuccess()` :
 * l'horodatage à inscrire, quand la fenêtre de throttle est dépassée. Il ne
 * traverse jamais le pipeline — l'attribut vit sur le token de la requête.
 */
const MARK_USED_AT = "apiKeyMarkUsedAt";

/** Paramètres effectifs d'un {@link ApiKeyAuthenticator} (dérivés de la config). */
export interface IApiKeyAuthenticatorRuntime {
  /** Marque des clés (`apiKeys.prefix`) — discrimine un PAT d'un JWT. */
  prefix: string;
  /** Coalescence d'écriture `lastUsedAt` (s) — 0 = écrit à chaque usage. */
  lastUsedThrottleS: number;
}

/**
 * Authentification par **clé API personnelle (PAT, P6.12)** présentée en
 * `Authorization: Bearer <prefix>_…` (RFC 6750). Réservée API/CI/scripts — le web
 * utilise la session BFF.
 *
 * Un PAT est un **bearer opaque** (≠ JWT auto-porté) : sa vérité vit côté serveur
 * (`ITokenStore`), donc il est **révocable immédiatement**. Discrimination du
 * JWT : le PAT porte le préfixe `<prefix>_` (le JWT a la structure compacte
 * `a.b.c`) → les deux authenticators cohabitent dans une même zone.
 *
 * Défenses :
 *  - **forme + CRC validés AVANT tout accès au store** ({@link parseApiKey}) →
 *    une valeur malformée n'atteint jamais la base (anti-DoS) ;
 *  - lookup par **hash** (`sha256`) — le secret n'existe nulle part au repos ;
 *  - **révocation** immédiate (`revokedAt`) + **expiration** (`expiresAt`) +
 *    **ban en masse** du porteur (`invalidBefore` vs `createdAt`) ;
 *  - **sujet revérifié** à chaque requête (`loadUserByIdentifier` → disparu/
 *    inactif/verrouillé = rejet) — rôles **frais** (révocation effective) ;
 *  - message d'échec **uniforme** (anti-énumération).
 *
 * Dépendances (store, userProvider) résolues **paresseusement** du container.
 */
export class ApiKeyAuthenticator implements IAuthenticator {
  readonly name = "apikey";
  readonly #container: Container;
  readonly #prefix: string;
  readonly #throttleMs: number;
  #store: ITokenStore | null = null;
  #userProvider: IUserProvider | null = null;

  /**
   * @param container - container DI (résolution lazy de `tokenStore`/`users`).
   * @param runtime - préfixe + throttle effectifs (dérivés de `config.apiKeys`).
   */
  constructor(container: Container, runtime: IApiKeyAuthenticatorRuntime) {
    this.#container = container;
    this.#prefix = runtime.prefix;
    this.#throttleMs = Math.max(0, runtime.lastUsedThrottleS) * 1000;
  }

  /** La requête porte-t-elle un `Authorization: Bearer <prefix>_…` ? (test bon marché) */
  supports(context: ContextType): boolean {
    const auth = context.request?.headers?.authorization;
    if (typeof auth !== "string") return false;
    const token = bearerToken(auth);
    return token !== null && looksLikeApiKey(token, this.#prefix);
  }

  /** Extrait la valeur brute (non vérifiée) → portée par un `UserToken` type `"apikey"`. */
  createToken(context: ContextType): Promise<IToken> {
    const auth = context.request?.headers?.authorization;
    return Promise.resolve(new UserToken("apikey", bearerToken(auth) ?? ""));
  }

  /**
   * Valide la clé (forme+CRC, puis store) et résout le sujet — ou lève un 401 au
   * message uniforme.
   *
   * @throws AuthenticationError (401) — clé malformée/inconnue/révoquée/expirée,
   *   ou sujet disparu/banni.
   * @throws Error (câblage : store/users absents) — loggée ERROR par le firewall
   *   puis 401 fail-closed (rien ne fuite au client).
   */
  async authenticate(token: IToken): Promise<IToken> {
    const raw = token.getCredentials();
    if (typeof raw !== "string" || raw.length === 0) {
      throw new AuthenticationError(INVALID_TOKEN);
    }
    // Forme + checksum AVANT le store (anti-DoS) — null = malformée/CRC invalide.
    const parsed = parseApiKey(raw, this.#prefix);
    if (parsed === null) {
      throw new AuthenticationError(INVALID_TOKEN);
    }

    const store = this.#resolveStore();
    const record = await store.findByHash(parsed.secretHash);
    const now = Date.now();
    if (
      !record ||
      record.kind !== "pat" ||
      record.revokedAt !== null ||
      (record.expiresAt !== null && record.expiresAt <= now)
    ) {
      throw new AuthenticationError(INVALID_TOKEN);
    }
    // Ban en masse du porteur (logout global) : une clé émise avant le seuil est
    // rejetée sans attendre son expiration.
    const invalidBefore = await store.getInvalidBefore(record.subjectId);
    if (invalidBefore !== null && record.createdAt < invalidBefore) {
      throw new AuthenticationError(INVALID_TOKEN);
    }

    // Sujet revérifié (rôles frais) — disparu/inactif/verrouillé = rejet.
    const user = await this.#resolveUserOrReject(record.subjectId);

    // « Last used » throttlé : aucune écriture sur le hot path tant que la fenêtre
    // n'est pas dépassée. La DÉCISION se prend ici (c'est ici qu'on tient le
    // record), l'ÉCRITURE part dans `onSuccess`, seul endroit qui reçoit le
    // contexte — donc l'IP et l'agent, sans quoi les colonnes d'audit du store
    // restaient vides. Écrire ici forçait `markUsed(id, { at })`, qui remet ces
    // deux colonnes à `null` : on n'oubliait pas seulement de les remplir, on
    // effaçait ce qu'une autre voie aurait pu y mettre.
    const last = record.lastUsedAt;
    if (
      this.#throttleMs === 0 ||
      last === null ||
      now - last >= this.#throttleMs
    ) {
      token.setAttribute(MARK_USED_AT, now);
    }

    const ut = token as UserToken;
    ut.promote(user);
    ut.setAttribute("scopes", [...record.scopes]);
    ut.setAttribute("apiKeyId", record.id);
    ut.setAttribute("tenantId", record.tenantId);
    return ut;
  }

  /**
   * Inscrit la trace d'usage de la clé — horodatage, IP et agent.
   *
   * C'est ici, et pas dans `authenticate()`, parce que c'est ici qu'on reçoit
   * le contexte. La provenance se lit par les ACCESSEURS proxy-aware des
   * contextes concrets (`getRemoteAddress()` dépouille `X-Forwarded-For` selon
   * `trustProxy`), absents du type de base — duck-typing optionnel, même
   * approche que `AuthFlow.#openSession()`.
   *
   * Rien n'est écrit si `authenticate()` n'a pas posé le marqueur : la fenêtre
   * de throttle n'était pas dépassée, et le hot path reste sans écriture.
   */
  async onSuccess(context: ContextType, token: IToken): Promise<void> {
    const at = token.getAttribute<number>(MARK_USED_AT);
    if (at === undefined) {
      return;
    }
    const id = token.getAttribute<string>("apiKeyId");
    if (id === undefined) {
      return;
    }
    const provenance = context as {
      getRemoteAddress?: () => string | null | undefined;
      getUserAgent?: () => string | undefined;
    };
    let ip: string | undefined;
    let userAgent: string | undefined;
    try {
      ip = provenance.getRemoteAddress?.() ?? undefined;
      userAgent = provenance.getUserAgent?.();
    } catch {
      /* best-effort : la traçabilité ne fait jamais échouer une authentification */
    }
    try {
      await this.#resolveStore().markUsed(id, { at, ip, userAgent });
    } catch (e) {
      // Une trace d'audit perdue ne doit pas retirer un accès légitime — mais
      // elle ne disparaît pas en silence (fail-soft ANNONCÉ). Le journal passe
      // par le contexte, qui est un Service ; l'authenticator n'en est pas un.
      context.log(
        `apikey: trace d'usage non enregistrée (${id}) — ${String(e)}`,
        "WARNING",
      );
    }
  }

  /** Slot audit (P6.14) — le 401 + challenge sont posés par le firewall. */
  onFailure(_context: ContextType, _error: Error): Promise<void> {
    return Promise.resolve();
  }

  /** Challenge RFC 6750/7235 posé par le firewall sur les 401 de la zone. */
  challenge(): string {
    return "Bearer";
  }

  async #resolveUserOrReject(sub: string): Promise<IUser> {
    const provider = this.#resolveUserProvider();
    let user: IUser;
    try {
      user = await provider.loadUserByIdentifier(sub);
    } catch {
      throw new AuthenticationError(INVALID_TOKEN); // sujet disparu
    }
    if (!user.isActive() || user.isLocked()) {
      throw new AuthenticationError(INVALID_TOKEN);
    }
    return user;
  }

  #resolveStore(): ITokenStore {
    if (this.#store === null) {
      const store = this.#container.get<ITokenStore>("tokenStore");
      if (!store) {
        throw new Error(
          "ApiKeyAuthenticator: service 'tokenStore' absent du container — " +
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
          "ApiKeyAuthenticator: aucun service 'users' (IUserProvider) dans le " +
            "container — enregistrer un UserService au boot de l'application.",
        );
      }
      this.#userProvider = provider;
    }
    return this.#userProvider;
  }
}

export default ApiKeyAuthenticator;
