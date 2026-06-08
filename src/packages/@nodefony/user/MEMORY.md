# MEMORY.md — @nodefony/user

## Purpose

User Core. `IUser` + base classes + encoders + `UserService`. Séparé de @nodefony/security
(consommé par security/framework/orm-\*/agent/studio sans tirer la security). ORM-agnostique.

## Core Components

- `nodefony/contracts/` ✅ : `IUser` (strict), `IPasswordAuthenticatedUser` (+`password`), `ISocialProvider`, `IPasswordEncoder`, `IUserProvider`, `IUserRepository extends IRepository<IPasswordAuthenticatedUser>` (+ barrel). `IRole`/`IPermission` = **commentés, différés P6.8**.
- `nodefony/src/` ✅ : `BaseUser` (POJO impl `IPasswordAuthenticatedUser` + mutateurs chaînables), `AnonymousUser` + singleton `anonymousUser` + `ROLE_ANONYMOUS`, `encoders/BcryptEncoder` ✅ (P5.6).
- `nodefony/service/` ✅ : `UserService extends AbstractCrudService<IPasswordAuthenticatedUser, IUserRepository>` (CRUD hérité + `authenticate()` + events credential) — P5.6.

## Config

- Lib pure. peerDeps : `nodefony` + `@nodefony/orm-core` (pour `IRepository`) + `@node-rs/bcrypt` (**optionnelle** — binaire NAPI, tirée seulement si on utilise `BcryptEncoder`). PAS de Module runtime, PAS dans `@modules()`.
- rollup external : `nodefony`, `tslib`, `@nodefony/orm-core`, `@node-rs/bcrypt` (jamais bundler un addon natif).

## Behaviors

- `IUser`: `id:string`(UUID), `identifier`, `roles:string[]`(plat), `hasRole`(exact, pas de hiérarchie), `isActive`, `isLocked`.
- `IPasswordAuthenticatedUser extends IUser`: `readonly password:string|null` — credential isolé (seul security/encoder l'utilise).
- `BaseUser implements IPasswordAuthenticatedUser` : champs anti-migration `socialProviders[]` JSON, `metadata:Record<string,unknown>`, `currentRole`, `password`. Ctor = objet `IBaseUserOptions`. Copie défensive de `roles`/`socialProviders`. Mutateurs chaînables: `addRole/removeRole/addSocialProvider/enable/disable/lock/unlock/setCurrentRole/setPassword`.
- `AnonymousUser`: `id="anonymous"`, `roles=[ROLE_ANONYMOUS]` (gelé partagé), singleton gelé `anonymousUser` (0 alloc/req).
- `IUserProvider`: `loadUserByIdentifier` + `loadUserByOAuth` + `refreshUser` (lèvent si introuvable). Shadow User.
- `IUserRepository extends IRepository<IPasswordAuthenticatedUser>` (orm-core) + `findByIdentifier`/`findBySocialProvider`. **Repository = frontière credential** (voit `password`), pas `IUser`.
- `IPasswordEncoder`: `hash`/`verify`(async, temps constant)/`needsRehash`. Impl `BcryptEncoder` (rounds 12 par défaut, `[4,31]`, `needsRehash` parse `$2[aby]$NN$`).
- `BcryptEncoder`: `@node-rs/bcrypt` (`hash`/`verify` NAPI). `verify` délègue la promesse (0 async superflu).
- `UserService extends AbstractCrudService<IPasswordAuthenticatedUser, IUserRepository>` (name `"users"`). **CRUD hérité** : `find/findOne/findById/count/create/update/delete` + events `onCreated/onUpdated/onDeleted`. **Spécifique** : `createUser(input)` (hache `plainPassword` → `this.create` → onCreated), `findByIdentifier`, `changePassword` (→ `onPasswordChanged`, pas onUpdated), `authenticate` (→ `onAuthenticated`/`onAuthenticationFailure`(raison)). `authenticate`: leurre `consumeDummy` (hash lazy `#dummyHash`, anti-timing) sur identifiant inconnu/sans password ; re-hash transparent si `needsRehash` (→ onPasswordChanged) ; ordre check = locked > disabled > no_password > bad_credentials. **Drop au rétro-fit** : `updateUser`/`deleteUser`/`UserUpdate` (le CRUD générique suffit). `encoder` = champ propre.

## Gotchas

- `metadata: Record<string,unknown>` **jamais** `any`. `id: string` **jamais** `string|number`.
- Ne PAS importer security/http/framework (inversion dép). Ne PAS importer driver ORM concret.
- `socialProviders` = JSON, **pas** de colonnes `googleId/githubId` (anti-migration).
- Build : warnings `../http/...` (TS18036/TS2322) = artefact monorepo (résolution Bundler cross-package), apparaissent aussi en buildant orm-core seul. **PAS** liés à user. Hors scope.
- Test "objet gelé" : assigner sur frozen ne **throw** qu'en mode strict → tester la **valeur inchangée**, pas le throw.

## État

✅ P5.5a (scaffold) + P5.5 (contracts + base users) + P5.6 (`BcryptEncoder` + `UserService extends AbstractCrudService`). **32 tests**. Suite = **P5.8** (adapter Mongoose : User entity + `IUserRepository` impl).
