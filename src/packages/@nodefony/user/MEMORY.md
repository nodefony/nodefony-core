# MEMORY.md — @nodefony/user

## Purpose

User Core. `IUser` + base classes + encoders + `UserService`. Séparé de @nodefony/security
(consommé par security/framework/orm-\*/agent/studio sans tirer la security). ORM-agnostique.

## Core Components

- `nodefony/contracts/` ✅ : `IUser` (strict), `IPasswordAuthenticatedUser` (+`password`), `ISocialProvider`, `IPasswordEncoder`, `IUserProvider`, `IUserRepository extends IRepository<IPasswordAuthenticatedUser>` (+ barrel). `IRole`/`IPermission` = **commentés, différés P6.8**.
- `nodefony/src/` ✅ : `BaseUser` (POJO impl `IPasswordAuthenticatedUser` + mutateurs chaînables), `AnonymousUser` + singleton `anonymousUser` + `ROLE_ANONYMOUS`, `InMemoryUserRepository` (impl `IUserRepository` sur `Map`, 0 ORM — dépôt de référence : tests de charge sans I/O, scripts, fixtures), `encoders/BcryptEncoder` ✅ (P5.6).
- `nodefony/service/` ✅ : `UserService extends AbstractCrudService<IPasswordAuthenticatedUser, IUserRepository>` (CRUD hérité + `authenticate()` + events credential) — P5.6.
- `nodefony/src/admin/UserAdminApi.ts` ✅ (P6.15) : data plane admin Studio `/nodefony/user/api/users` — `createUserAdminApi(container)` + `registerUserAdminApi(registry, container)` + DTO `IUserSummary` + `toUserSummary` (pures, exportées). **`@nodefony/user` reste lib pure non-bootable** : le data plane est DÉFINI ici (domaine `UserService`/`IUser`) mais **ENREGISTRÉ par `@nodefony/security`** au `onKernelBoot` (cas prévu par le core : `IAdminApi` produable par un module core-only). Endpoints RBAC `ROLE_NODEFONY_ADMIN` : `GET users` (pagination NATIVE au store via `users.listPage`, JAMAIS `find()` complet ; `?role&enabled&q&limit&offset`, défaut 50/cap 200) · `GET users/{id}` · `POST users` (409 si dup) · `PATCH users/{id}` (roles/enabled/locked) · `POST users/{id}/password` · `DELETE users/{id}`. **DTO redacté** : jamais `password`/`metadata`, `socialProviders` sans jeton (test anti-fuite). **Garde-fous anti-lockout** : pas d'auto-déchéance ADMIN, pas de disable/lock/delete de soi, pas de déchéance/suppression du **dernier admin actif** (`ADMIN_ROLE = ROLE_NODEFONY_ADMIN`). Mutations auditées (pont `auditService`, catégorie `authz`, no-op si security absent). Validation rôles = format only (pas de `roleHierarchy` — user ne peut importer security ; rôle invalide = inerte, RBAC protège). **Cascade de révocation** : DELETE/disable/lock émettent l'event kernel **`onUserRevoked`** (`{id, identifier, tenantId:null, reason}`, exporté) → `@nodefony/security` (`nodefony/src/admin/userRevocationCascade.ts`, abonné au `onKernelBoot`) éjecte **immédiatement** sessions (`sessions.destroyByUser`) + tokens/PAT (`tokenStore.revokeAllForSubject` seuil `invalidBefore`). **Point d'extension** : les webhooks (futur) += un listener sur `onUserRevoked`, zéro modif user/security. NB sécu : l'accès était DÉJÀ neutralisé par le re-fetch des authenticators (`SessionAuthenticator`/`ApiKeyAuthenticator` rejettent user disparu/inactif/verrouillé) ; la cascade = propreté + défense en profondeur ; le GC (proba sessions / timer tokens) reste le backstop. Tests : `user/tests/unit/UserAdminApi.test.ts` (19) + `security/tests/unit/userRevocationCascade.test.ts` (3). **Reste** : `createdAt/updatedAt` lus défensivement (présents sur entités ORM, absents du contrat strict) ; front Studio `/nodefony/users`.

## Config

- Lib pure. peerDeps : `nodefony` + `@nodefony/orm-core` (pour `IRepository`) + `@node-rs/bcrypt` (**optionnelle** — binaire NAPI, tirée seulement si on utilise `BcryptEncoder`). PAS de Module runtime, PAS dans `@modules()`.
- rolldown external : `nodefony`, `tslib`, `@nodefony/orm-core`, `@node-rs/bcrypt` (jamais bundler un addon natif).

## Behaviors

- `IUser`: `id:string`(UUID), `identifier`, `roles:string[]`(plat), `hasRole`(exact, pas de hiérarchie), `isActive`, `isLocked`.
- `IPasswordAuthenticatedUser extends IUser`: `readonly password:string|null` — credential isolé (seul security/encoder l'utilise).
- `BaseUser implements IPasswordAuthenticatedUser` : champs anti-migration `socialProviders[]` JSON, `metadata:Record<string,unknown>`, `currentRole`, `password`. Ctor = objet `IBaseUserOptions`. Copie défensive de `roles`/`socialProviders`. Mutateurs chaînables: `addRole/removeRole/addSocialProvider/enable/disable/lock/unlock/setCurrentRole/setPassword`.
- `AnonymousUser`: `id="anonymous"`, `roles=[ROLE_ANONYMOUS]` (gelé partagé), singleton gelé `anonymousUser` (0 alloc/req).
- `IUserProvider`: `loadUserByIdentifier` + `loadUserByOAuth` + `refreshUser` (lèvent si introuvable). Shadow User.
- `IUserRepository extends IRepository<IPasswordAuthenticatedUser>` (orm-core) + `findByIdentifier`/`findBySocialProvider` + **`listPage(IUserListQuery)`/`countActiveAdmins(adminRole)`**. **Repository = frontière credential** (voit `password`), pas `IUser`.
- **Pagination NATIVE (standard core)** : `listPage` = filtres `role`(containment tableau JSON)/`enabled`(colonne)/`q`(sous-chaîne insensible casse sur identifier) NON portables au `Criteria` → impl native par backend (jamais `find()` complet en RAM). Rend `IPage<T>` (contrat `nodefony` `IPage`/`IPageQuery`), tri défaut `identifier ASC`. `countActiveAdmins` = `COUNT` natif (garde-fou lockout). **Banc de contrat UNIQUE** `tests/support/userPaginationContract.ts` (`runUserPaginationContract(harness)`) — importé cross-package par drizzle/mongoose, 1 seed déterministe, prouvé sur InMemory + Drizzle sqlite/pg/mariadb/mysql + Mongoose.
- `InMemoryUserRepository.create` persiste aussi `enabled`/`locked` (parité backends réels — seed d'inactifs).
- `IPasswordEncoder`: `hash`/`verify`(async, temps constant)/`needsRehash`. Impl `BcryptEncoder` (rounds 12 par défaut, `[4,31]`, `needsRehash` parse `$2[aby]$NN$`).
- `BcryptEncoder`: `@node-rs/bcrypt` (`hash`/`verify` NAPI). `verify` délègue la promesse (0 async superflu).
- `UserService extends AbstractCrudService<IPasswordAuthenticatedUser, IUserRepository>` (name `"users"`). **CRUD hérité** : `find/findOne/findById/count/create/update/delete` + events `onCreated/onUpdated/onDeleted`. **Spécifique** : `createUser(input)` (hache `plainPassword` → `this.create` → onCreated), `findByIdentifier`, `changePassword` (→ `onPasswordChanged`, pas onUpdated), `authenticate` (→ `onAuthenticated`/`onAuthenticationFailure`(raison)). `authenticate`: leurre `consumeDummy` (hash lazy `#dummyHash`, anti-timing) sur identifiant inconnu/sans password ; re-hash transparent si `needsRehash` (→ onPasswordChanged) ; ordre check = locked > disabled > no_password > bad_credentials. **Drop au rétro-fit** : `updateUser`/`deleteUser`/`UserUpdate` (le CRUD générique suffit). `encoder` = champ propre. Façade pagination : `listPage(query)`/`countActiveAdmins(role)` délèguent au repo.

## Gotchas

- `metadata: Record<string,unknown>` **jamais** `any`. `id: string` **jamais** `string|number`.
- Ne PAS importer security/http/framework (inversion dép). Ne PAS importer driver ORM concret.
- `socialProviders` = JSON, **pas** de colonnes `googleId/githubId` (anti-migration).
- Build : warnings `../http/...` (TS18036/TS2322) = artefact monorepo (résolution Bundler cross-package), apparaissent aussi en buildant orm-core seul. **PAS** liés à user. Hors scope.
- Test "objet gelé" : assigner sur frozen ne **throw** qu'en mode strict → tester la **valeur inchangée**, pas le throw.

## Périmètre

Contrats + `UserService` + `BcryptEncoder`. **Aucun ORM** : les deux implémentations de
`IUserRepository` vivent chez les adapters (`@nodefony/drizzle`, `@nodefony/mongoose`), convention
**`entity/` = schéma, `src/` = repository**, avec `createdAt`/`updatedAt`. Le pont vers le firewall
passe par `UserService` lui-même : il `implements IUserProvider, IPasswordVerifier,
IOAuthUserProvisioner` (`nodefony/service/UserService.ts:69`) — c'est lui que `@nodefony/security`
consomme, jamais le repository directement.
