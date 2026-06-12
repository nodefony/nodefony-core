import { Kernel, Module, services } from "nodefony";
import { fileURLToPath } from "node:url";
import config from "./nodefony/config/config";
import Firewall from "./nodefony/service/firewall";

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
 * `anonymous`/`userpassword` (Basic RFC 7617). Jwt/oauth2/mtls/apikey, CORS,
 * CSRF, autorisation par décorateurs et data plane Studio arrivent aux sessions
 * suivantes (plan J0→J10).
 */
@services([Firewall])
class Security extends Module {
  constructor(kernel: Kernel) {
    super("security", kernel, fileURLToPath(import.meta.url), config);
  }
}

export default Security;

// ─── Services / classes runtime ──────────────────────────────────────────────
export { Firewall };
export { SecuredArea } from "./nodefony/src/SecuredArea";
export { Csrf } from "./nodefony/service/csrf";
export { RoleHierarchyWalker } from "./nodefony/src/RoleHierarchyWalker";
export { AnonymousToken } from "./nodefony/src/token/AnonymousToken";
export { UserToken } from "./nodefony/src/token/UserToken";

// ─── Authenticators + registre de fabriques (pluggable) ─────────────────────
export { AnonymousAuthenticator } from "./nodefony/src/authenticator/AnonymousAuthenticator";
export { UserPasswordAuthenticator } from "./nodefony/src/authenticator/UserPasswordAuthenticator";
export {
  registerAuthenticatorFactory,
  getAuthenticatorFactory,
  listAuthenticatorFactories,
} from "./nodefony/src/authenticator/authenticatorRegistry";
export type {
  AuthenticatorFactory,
  IAuthenticatorFactoryContext,
} from "./nodefony/src/authenticator/authenticatorRegistry";

// ─── Config builder (type-safe + Zod) ────────────────────────────────────────
export { defineSecurityConfig } from "./nodefony/config/defineSecurityConfig";
export type {
  ISecurityConfig,
  ISecurityConfigInput,
  ISecurityAreaConfig,
} from "./nodefony/config/defineSecurityConfig";

// ─── Erreurs typées ──────────────────────────────────────────────────────────
export { AuthenticationError, AccessDeniedError } from "./nodefony/errors";

// ─── Contrats ────────────────────────────────────────────────────────────────
export { VoterVote } from "./nodefony/contracts";
export type {
  IToken,
  IAuthenticator,
  ISecuredArea,
  IFirewall,
  IAccessVoter,
} from "./nodefony/contracts";
