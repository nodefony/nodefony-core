// Barrel des contrats publics de @nodefony/user.

export type {
  IUser,
  IPasswordAuthenticatedUser,
  ISocialProvider,
} from "./IUser";
export type { IPasswordEncoder } from "./IPasswordEncoder";
export type { IPasswordVerifier } from "./IPasswordVerifier";
export type { IUserProvider } from "./IUserProvider";
export type { IUserRepository } from "./IUserRepository";

// ─── DIFFÉRÉ → P6.8 (RBAC niveau B) ──────────────────────────────────────────
// `IRole` et `IPermission` (modèle RBAC dynamique en base, consommé par
// l'AuthorizationService de @nodefony/security et le CRUD Studio admin) ne sont
// PAS figés ici : leur format (notamment `IPermission = { id, resource, action }`)
// dépend du cas concret des Voters (P6.8). Les écrire maintenant garantirait une
// réécriture. Le niveau A (rôles plats `IUser.roles`) suffit jusque-là.
// export type { IRole } from "./IRole";
// export type { IPermission } from "./IPermission";
