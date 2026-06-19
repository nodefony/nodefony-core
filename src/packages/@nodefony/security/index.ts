import { Kernel, Module, services } from "nodefony";
import { fileURLToPath } from "node:url";
import config from "./nodefony/config/config";
import Firewall from "./nodefony/service/firewall";
import AuthFlow from "./nodefony/service/authFlow";
import TokenService from "./nodefony/service/tokenService";
import Authorization from "./nodefony/service/authorization";
import WebAuthnService from "./nodefony/service/webAuthn";
import OAuth2Service from "./nodefony/service/oauth2";
import ApiKeyService from "./nodefony/service/apiKeys";
import type { ISecurityConfigInput } from "./nodefony/config/defineSecurityConfig";

// Augmente le registre du core (declaration merging) → `use("@nodefony/security", …)`
// propose les CLÉS (cors/csrf/headers/areas…) ET les VALEURS enum (coop, frameguard,
// referrerPolicy…) en complétion + validation de type. Sans ça : `Record<string, unknown>`
// (aucune complétion). Recette convention-frère @nodefony/drizzle / @nodefony/mongoose.
declare module "nodefony" {
  interface NodefonyModuleConfig {
    "@nodefony/security": ISecurityConfigInput;
  }
}

/**
 * `@nodefony/security` — couche de sécurité de Nodefony (refonte 2026, P6).
 *
 * Identité **hybride** : session serveur cookie opaque (BFF) par défaut web/Studio,
 * JWT réservé API/M2M/agents. Pattern **`IAuthenticator`** + registre de fabriques
 * (pluggable), **Zero Trust** par défaut, config type-safe `defineSecurityConfig()`
 * + Zod validée au boot (fail-closed si invalide). Consomme `@nodefony/user`
 * (IUser/IUserProvider/IPasswordVerifier) — jamais l'inverse.
 *
 * Livré : firewall (zones, mode first|all, challenge RFC 7235), authenticators
 * `anonymous`/`userpassword` (Basic RFC 7617)/`session` (BFF, J3), flux
 * login/logout/me (`AuthFlow`, anti-fixation + throttling partagé).
 * Jwt/oauth2/mtls/apikey, CORS, CSRF, autorisation par décorateurs et data
 * plane Studio arrivent aux sessions suivantes (plan J0→J10).
 */
@services([
  Firewall,
  AuthFlow,
  TokenService,
  ApiKeyService,
  Authorization,
  WebAuthnService,
  OAuth2Service,
])
class Security extends Module {
  constructor(kernel: Kernel) {
    super("security", kernel, fileURLToPath(import.meta.url), config);
  }
}

export default Security;

// ─── Services / classes runtime ──────────────────────────────────────────────
export { Firewall };
export { AuthFlow };
export { TokenService };
export { ApiKeyService };
export { Authorization };
export { WebAuthnService };
export { OAuth2Service };
export type { ISafeUser } from "./nodefony/service/authFlow";
export type { ITokenResponse } from "./nodefony/service/tokenService";
export type {
  IApiKeyView,
  IApiKeyCreated,
  ICreateApiKeyOptions,
} from "./nodefony/contracts/IApiKey";
export { ApiKeyError } from "./nodefony/errors/ApiKeyError";
export { SecuredArea } from "./nodefony/src/SecuredArea";
export { Csrf } from "./nodefony/service/csrf";
export { CsrfTokenManager } from "./nodefony/src/csrfToken";
export { Cors } from "./nodefony/service/cors";
export { SecurityHeaders } from "./nodefony/service/securityHeaders";
export { RoleHierarchyWalker } from "./nodefony/src/RoleHierarchyWalker";
export { AnonymousToken } from "./nodefony/src/token/AnonymousToken";
export { UserToken } from "./nodefony/src/token/UserToken";

// ─── Autorisation (niveau C : voters + service) — registre pluggable ─────────
export { RoleVoter } from "./nodefony/src/voter/RoleVoter";
export {
  registerVoterFactory,
  listVoterFactories,
} from "./nodefony/src/voter/voterRegistry";
export type {
  VoterFactory,
  IVoterFactoryContext,
} from "./nodefony/src/voter/voterRegistry";

// ─── Authenticators + registre de fabriques (pluggable) ─────────────────────
export { AnonymousAuthenticator } from "./nodefony/src/authenticator/AnonymousAuthenticator";
export { UserPasswordAuthenticator } from "./nodefony/src/authenticator/UserPasswordAuthenticator";
export { SessionAuthenticator } from "./nodefony/src/authenticator/SessionAuthenticator";
export { JwtAuthenticator } from "./nodefony/src/authenticator/JwtAuthenticator";
export { ApiKeyAuthenticator } from "./nodefony/src/authenticator/ApiKeyAuthenticator";
export type { IApiKeyAuthenticatorRuntime } from "./nodefony/src/authenticator/ApiKeyAuthenticator";
export {
  generateApiKey,
  parseApiKey,
  hashApiKey,
  looksLikeApiKey,
} from "./nodefony/src/apikey/apiKeyFormat";
export type {
  IGeneratedApiKey,
  IParsedApiKey,
} from "./nodefony/src/apikey/apiKeyFormat";
export {
  registerAuthenticatorFactory,
  getAuthenticatorFactory,
  listAuthenticatorFactories,
} from "./nodefony/src/authenticator/authenticatorRegistry";
export type {
  AuthenticatorFactory,
  IAuthenticatorFactoryContext,
} from "./nodefony/src/authenticator/authenticatorRegistry";

// ─── Store de jetons (PAT / refresh / denylist) + registre pluggable ─────────
export { MemoryTokenStore } from "./nodefony/src/token/MemoryTokenStore";
export type { TokenStoreSnapshot } from "./nodefony/src/token/MemoryTokenStore";
export { FileTokenStore } from "./nodefony/src/token/FileTokenStore";
export { JwtKeystore } from "./nodefony/src/token/JwtKeystore";
export { resolveJwtRuntime } from "./nodefony/src/token/jwtRuntime";
export type { IJwtRuntime } from "./nodefony/src/token/jwtRuntime";
export {
  registerTokenStore,
  getTokenStoreFactory,
  listTokenStores,
} from "./nodefony/src/token/tokenStoreRegistry";
export type {
  TokenStoreFactory,
  ITokenStoreFactoryContext,
} from "./nodefony/src/token/tokenStoreRegistry";

// ─── WebAuthn / Passkeys (P6 J9) — credentials + store pluggable ─────────────
export { MemoryWebAuthnCredentialStore } from "./nodefony/src/webauthn/MemoryWebAuthnCredentialStore";
export type { WebAuthnStoreSnapshot } from "./nodefony/src/webauthn/MemoryWebAuthnCredentialStore";
export { FileWebAuthnCredentialStore } from "./nodefony/src/webauthn/FileWebAuthnCredentialStore";
export {
  registerWebAuthnStore,
  getWebAuthnStoreFactory,
  listWebAuthnStores,
} from "./nodefony/src/webauthn/webAuthnCredentialStoreRegistry";
export type {
  WebAuthnStoreFactory,
  IWebAuthnStoreFactoryContext,
} from "./nodefony/src/webauthn/webAuthnCredentialStoreRegistry";
export type {
  IWebAuthnUser,
  IWebAuthnAssertionResult,
} from "./nodefony/service/webAuthn";
export type { IWebAuthnCredential } from "./nodefony/contracts/IWebAuthnCredential";
export type {
  IWebAuthnCredentialStore,
  WebAuthnAuthUpdate,
} from "./nodefony/contracts/IWebAuthnCredentialStore";

// ─── OAuth2 social login (P6 J9) — fournisseurs + registre pluggable ─────────
export type { IOAuthAuthorization } from "./nodefony/service/oauth2";
export type { IOAuthProvider } from "./nodefony/contracts/IOAuthProvider";
export {
  registerOAuthProvider,
  getOAuthProviderFactory,
  listOAuthProviders,
} from "./nodefony/src/oauth/oauthProviderRegistry";
export type {
  OAuthProviderFactory,
  IOAuthProviderContext,
} from "./nodefony/src/oauth/oauthProviderRegistry";

// ─── Config builder (type-safe + Zod) ────────────────────────────────────────
export { defineSecurityConfig } from "./nodefony/config/defineSecurityConfig";
export type {
  ISecurityConfig,
  ISecurityConfigInput,
  ISecurityAreaConfig,
} from "./nodefony/config/defineSecurityConfig";

// ─── Throttling login (NIST SP 800-63B) ──────────────────────────────────────
export { LoginThrottler } from "./nodefony/src/throttle/LoginThrottler";
export type { ILoginThrottleOptions } from "./nodefony/src/throttle/LoginThrottler";

// ─── Erreurs typées ──────────────────────────────────────────────────────────
export {
  AuthenticationError,
  AccessDeniedError,
  ThrottledError,
  CsrfError,
} from "./nodefony/errors";

// ─── Contrats ────────────────────────────────────────────────────────────────
export { VoterVote } from "./nodefony/contracts";
export type {
  IToken,
  IAuthenticator,
  ISecuredArea,
  IFirewall,
  IAccessVoter,
  IAuthorizationService,
  IAccessTokenRecord,
  ITokenStore,
  ITokenUsage,
  IResourcePermission,
  TokenRevokeReason,
  IJwtKeystore,
  IJwtSigningKey,
} from "./nodefony/contracts";
