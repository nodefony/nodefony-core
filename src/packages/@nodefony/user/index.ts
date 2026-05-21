/**
 * `@nodefony/user` — socle utilisateur de Nodefony (User Core).
 *
 * Module **séparé** de `@nodefony/security` : il porte le contrat `IUser` et ses
 * implémentations de base afin que tout consommateur (security, framework, orm-*,
 * agent, llm, rag, realtime, studio) puisse manipuler un utilisateur **sans tirer
 * toute la couche security** pour un simple type. Calque du découpage
 * `symfony/security-core` ↔ `symfony/security-bundle`.
 *
 * Lib pure ORM-agnostique : les contrats sont effacés à la compilation, les classes
 * de base (`BaseUser`, `AnonymousUser`, `BcryptEncoder`) et `UserService` sont
 * consommés via DI. Les entités persistées (Sequelize/Mongoose/Drizzle) étendent
 * `BaseUser` ou implémentent `IUser` dans chaque adapter.
 *
 * @remarks P5.5 livré (contracts + base users). Restent : P5.6 (`UserService` +
 * `BcryptEncoder`), P5.7–5.9 (adapters ORM). `IRole`/`IPermission` différés à P6.8.
 */

// ─── Contrats (P5.5) — exports type, effacés à la compilation ────────────────
export type {
  IUser,
  IPasswordAuthenticatedUser,
  ISocialProvider,
  IPasswordEncoder,
  IUserProvider,
  IUserRepository,
} from "./nodefony/contracts/index";

// ─── Implémentations de base (P5.5) ──────────────────────────────────────────
export { BaseUser } from "./nodefony/src/BaseUser";
export type { IBaseUserOptions } from "./nodefony/src/BaseUser";
export {
  AnonymousUser,
  anonymousUser,
  ROLE_ANONYMOUS,
} from "./nodefony/src/AnonymousUser";

// ─── Encoders (P5.6) ─────────────────────────────────────────────────────────
export { BcryptEncoder } from "./nodefony/src/encoders/BcryptEncoder";

// ─── Service (P5.6) ──────────────────────────────────────────────────────────
export { UserService } from "./nodefony/service/UserService";
export type {
  ICreateUserInput,
  AuthFailureReason,
} from "./nodefony/service/UserService";
