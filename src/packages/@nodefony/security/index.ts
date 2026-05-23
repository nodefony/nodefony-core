import { Kernel, Module, services } from "nodefony";
import { fileURLToPath } from "node:url";
import config from "./nodefony/config/config";
import Firewall from "./nodefony/service/firewall";

/**
 * `@nodefony/security` — couche de sécurité de Nodefony (refonte 2026, P6).
 *
 * HTTP **full stateless** (JWT cookie), pattern **`IAuthenticator`** (Symfony 6),
 * **Zero Trust** par défaut, config type-safe via `defineSecurityConfig()` + Zod.
 * Consomme `@nodefony/user` (IUser/IUserProvider/UserService) — jamais l'inverse.
 *
 * S1 = fondation (firewall + zones + Zero Trust + hiérarchie de rôles + contrats).
 * Authenticators (anonymous/userpassword/jwt/oauth2/mtls/apikey), CORS, CSRF,
 * autorisation par décorateurs et data plane Studio arrivent aux sessions suivantes.
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
