// Barrel des contrats @nodefony/security — interfaces effacées à la compilation.
export type { IToken } from "./IToken";
export type { IAuthenticator } from "./IAuthenticator";
export type { ISecuredArea } from "./ISecuredArea";
export type { IFirewall } from "./IFirewall";
export type { IAccessVoter } from "./IAccessVoter";
// VoterVote = enum (valeur runtime).
export { VoterVote } from "./IAccessVoter";
export type {
  IAccessTokenRecord,
  ITokenStore,
  ITokenUsage,
  IResourcePermission,
  TokenRevokeReason,
} from "./ITokenStore";
export type { IJwtKeystore, IJwtSigningKey } from "./IJwtKeystore";
