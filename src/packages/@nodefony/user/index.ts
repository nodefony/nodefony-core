/**
 * `@nodefony/user` — socle utilisateur de Nodefony (User Core).
 *
 * Module **séparé** de `@nodefony/security` : il porte le contrat `IUser` et ses
 * implémentations de base afin que tout consommateur (security, framework, orm-*,
 * agent, llm, rag, realtime, studio) puisse manipuler un utilisateur **sans tirer
 * toute la couche security** pour un simple type — l'identité est un concept plus
 * large que l'authentification.
 *
 * Lib pure ORM-agnostique : les contrats sont effacés à la compilation, les classes
 * de base (`BaseUser`, `AnonymousUser`, `BcryptEncoder`) et `UserService` sont
 * consommés via DI. Les entités persistées (Mongoose/Drizzle) étendent
 * `BaseUser` ou implémentent `IUser` dans chaque adapter.
 *
 * @remarks P5.5–5.9 livrés (contracts, base users, `UserService` + encoders,
 * adapters Drizzle/Mongoose). `IRole`/`IPermission` différés à P6.8.
 */

// ─── Contrats (P5.5) — exports type, effacés à la compilation ────────────────
export type {
  IUser,
  IPasswordAuthenticatedUser,
  ISocialProvider,
  IPasswordBlocklist,
  IPasswordEncoder,
  IPasswordVerifier,
  IUserProvider,
  IUserRepository,
  IUserListQuery,
  IOAuthProfile,
  IOAuthProvisionPolicy,
  IOAuthUserProvisioner,
} from "./nodefony/contracts/index";

// ─── Implémentations de base (P5.5) ──────────────────────────────────────────
export { BaseUser } from "./nodefony/src/BaseUser";
export type { IBaseUserOptions } from "./nodefony/src/BaseUser";
export {
  AnonymousUser,
  anonymousUser,
  ROLE_ANONYMOUS,
} from "./nodefony/src/AnonymousUser";

// ─── Encoders (P5.6, P6 J2) ──────────────────────────────────────────────────
export { BcryptEncoder } from "./nodefony/src/encoders/BcryptEncoder";
export { Argon2idEncoder } from "./nodefony/src/encoders/Argon2idEncoder";
export type { Argon2idOptions } from "./nodefony/src/encoders/Argon2idEncoder";
export { MigratingEncoder } from "./nodefony/src/encoders/MigratingEncoder";
export { encoderFromConfig } from "./nodefony/src/encoders/encoderFromConfig";
export type { IEncoderSpec } from "./nodefony/src/encoders/encoderFromConfig";

// ─── Repository de référence in-memory (charge / scripts / fixtures) ─────────
export { InMemoryUserRepository } from "./nodefony/src/InMemoryUserRepository";
// Vocabulaire de tri des utilisateurs — partagé par TOUS les repositories
// (mémoire, drizzle, mongoose) pour qu'un `?order=` ait le même sens partout.
export {
  USER_SORTABLE_FIELDS,
  USER_SORTABLE_FIELDS_IN_MEMORY,
  USER_SORTABLE_FIELDS_COMMON,
  USER_DEFAULT_ORDER,
} from "./nodefony/src/userSort";
// **Le contrat de colonnes** de l'utilisateur persisté — source unique dont les
// adaptateurs (SQL, document) DÉRIVENT leur définition, et sur laquelle le
// contrôle de démarrage nomme la colonne absente ET son lecteur.
export {
  USER_COLUMNS,
  USER_TABLE_NAME,
  attachExtraColumns,
  missingUserColumns,
  assertUserContract,
} from "./nodefony/src/userContract";
export type {
  IUserColumn,
  IUserRow,
  UserColumnType,
  UserColumnOrigin,
} from "./nodefony/src/userContract";
// Registre des backends de persistance user DISPONIBLES (Studio « Stores ») —
// `"memory"` builtin ici, drizzle/mongoose déclarés par leur adapter au boot.
export {
  registerUserStore,
  listUserStores,
} from "./nodefony/src/userStoreRegistry";

// ─── Service (P5.6) ──────────────────────────────────────────────────────────
export { UserService } from "./nodefony/service/UserService";
export type {
  ICreateUserInput,
  AuthFailureReason,
} from "./nodefony/service/UserService";

// ─── Erreurs (P6 S0, J2) ─────────────────────────────────────────────────────
export { UserNotFoundError } from "./nodefony/errors/UserNotFoundError";
export { WeakPasswordError } from "./nodefony/errors/WeakPasswordError";

// ─── Data plane admin (P6.15) ────────────────────────────────────────────────
// Défini ICI (propriétaire du domaine `UserService`/`IUser`) mais ENREGISTRÉ par
// un module bootable (`@nodefony/security`), `@nodefony/user` étant une lib pure
// non-bootable — cas explicitement prévu par le core (`IAdminApi` que peut produire
// un module qui ne dépend que de `nodefony`).
export {
  createUserAdminApi,
  registerUserAdminApi,
  toUserSummary,
  USER_REVOKED_EVENT,
} from "./nodefony/src/admin/UserAdminApi";
export type {
  IUserSummary,
  IUserRevokedEvent,
} from "./nodefony/src/admin/UserAdminApi";
export type { IUserProfile } from "./nodefony/contracts/IUserProfile";
export {
  validateProfilePatch,
  projectProfile,
  mergeProfileIntoMetadata,
  profileFromClaims,
} from "./nodefony/src/userProfile";
