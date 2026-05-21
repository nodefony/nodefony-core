# MEMORY.md — @nodefony/user

## Purpose

User Core. `IUser` + base classes + encoders + `UserService`. Séparé de @nodefony/security
(consommé par security/framework/orm-*/agent/studio sans tirer la security). ORM-agnostique.

## Core Components (cibles — P5.5a = scaffold seul, vides pour l'instant)

- `nodefony/contracts/` : `IUser` `IRole` `IPermission` `IUserProvider` `IUserRepository` `IPasswordEncoder` (+ barrel `index.ts`).
- `nodefony/src/` : `BaseUser` (POJO impl IUser), `AnonymousUser` (ROLE_ANONYMOUS), `encoders/BcryptEncoder`.
- `nodefony/service/` : `UserService` (CRUD + authenticate + events).

## Config

- Lib pure. peerDeps : `nodefony` + `@nodefony/orm-core` (pour `IRepository`). PAS de Module runtime, PAS dans `@modules()`.
- rollup external : `nodefony`, `tslib`, `@nodefony/orm-core`.

## Behaviors (figés, à implémenter)

- `IUser`: `id:string`(UUID), `identifier`, `roles:string[]`(plat), `hasRole`, `isActive`, `isLocked`.
- `BaseUser` champs anti-migration: `socialProviders[]` JSON, `metadata:Record<string,unknown>`, `currentRole`, `password?`.
- `IUserProvider`: `loadUserByIdentifier` + `loadUserByOAuth` + `refreshUser`. Shadow User pattern.
- `IUserRepository extends IRepository<IUser>` (orm-core).
- `BcryptEncoder`: rounds 12 défaut, impl `IPasswordEncoder`.

## Gotchas

- `metadata: Record<string,unknown>` **jamais** `any`. `id: string` **jamais** `string|number`.
- Ne PAS importer security/http/framework (inversion dép). Ne PAS importer driver ORM concret.
- `socialProviders` = JSON, **pas** de colonnes `googleId/githubId` (anti-migration).
- index.ts: exports commentés tant que P5.5/P5.6 pas faits → build émet index.js vide (normal).

## État

P5.5a scaffold FAIT. Suite = P5.5 contracts.
