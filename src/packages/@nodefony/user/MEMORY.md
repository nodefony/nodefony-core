# MEMORY.md — @nodefony/user

## Purpose

User Core. `IUser` + base classes + encoders + `UserService`. Séparé de @nodefony/security
(consommé par security/framework/orm-*/agent/studio sans tirer la security). ORM-agnostique.

## Core Components

- `nodefony/contracts/` ✅ : `IUser` (strict), `IPasswordAuthenticatedUser` (+`password`), `ISocialProvider`, `IPasswordEncoder`, `IUserProvider`, `IUserRepository extends IRepository<IUser>` (+ barrel). `IRole`/`IPermission` = **commentés, différés P6.8**.
- `nodefony/src/` ✅ : `BaseUser` (POJO impl `IPasswordAuthenticatedUser` + mutateurs chaînables), `AnonymousUser` + singleton `anonymousUser` + `ROLE_ANONYMOUS`. ⬜ `encoders/BcryptEncoder` (P5.6).
- `nodefony/service/` ⬜ : `UserService` (CRUD + authenticate + events) — P5.6.

## Config

- Lib pure. peerDeps : `nodefony` + `@nodefony/orm-core` (pour `IRepository`). PAS de Module runtime, PAS dans `@modules()`.
- rollup external : `nodefony`, `tslib`, `@nodefony/orm-core`.

## Behaviors

- `IUser`: `id:string`(UUID), `identifier`, `roles:string[]`(plat), `hasRole`(exact, pas de hiérarchie), `isActive`, `isLocked`.
- `IPasswordAuthenticatedUser extends IUser`: `readonly password:string|null` — credential isolé (seul security/encoder l'utilise).
- `BaseUser implements IPasswordAuthenticatedUser` : champs anti-migration `socialProviders[]` JSON, `metadata:Record<string,unknown>`, `currentRole`, `password`. Ctor = objet `IBaseUserOptions`. Copie défensive de `roles`/`socialProviders`. Mutateurs chaînables: `addRole/removeRole/addSocialProvider/enable/disable/lock/unlock/setCurrentRole/setPassword`.
- `AnonymousUser`: `id="anonymous"`, `roles=[ROLE_ANONYMOUS]` (gelé partagé), singleton gelé `anonymousUser` (0 alloc/req).
- `IUserProvider`: `loadUserByIdentifier` + `loadUserByOAuth` + `refreshUser` (lèvent si introuvable). Shadow User.
- `IUserRepository extends IRepository<IUser>` (orm-core) + `findByIdentifier`/`findBySocialProvider`.
- `IPasswordEncoder`: `hash`/`verify`(async, temps constant)/`needsRehash`. Impl `BcryptEncoder` (P5.6, rounds 12).

## Gotchas

- `metadata: Record<string,unknown>` **jamais** `any`. `id: string` **jamais** `string|number`.
- Ne PAS importer security/http/framework (inversion dép). Ne PAS importer driver ORM concret.
- `socialProviders` = JSON, **pas** de colonnes `googleId/githubId` (anti-migration).
- Build : warnings `../http/...` (TS18036/TS2322) = artefact monorepo (résolution Bundler cross-package), apparaissent aussi en buildant orm-core seul. **PAS** liés à user. Hors scope.
- Test "objet gelé" : assigner sur frozen ne **throw** qu'en mode strict → tester la **valeur inchangée**, pas le throw.

## État

✅ P5.5a (scaffold) + P5.5 (contracts + base users, 11 tests). Suite = **P5.6** (`UserService` + `BcryptEncoder`).
