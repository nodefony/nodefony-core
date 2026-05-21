# CLAUDE.md — @nodefony/user

## Rôle

**User Core** de Nodefony : contrat `IUser` + implémentations de base + encoders + `UserService`.
Module **séparé** de `@nodefony/security` pour que tout module consommant un utilisateur
(security, framework, orm-*, agent, llm, rag, realtime, **studio**) importe un type léger sans
tirer toute la couche security. Découpage calqué sur `symfony/security-core` ↔ `security-bundle`.

## Nature : LIB ORM-agnostique (pas de logique métier)

- Contrats (`IUser`, `IRole`, `IPermission`, `IUserProvider`, `IUserRepository`, `IPasswordEncoder`)
  effacés à la compilation.
- Classes de base concrètes (`BaseUser`, `AnonymousUser`, `BcryptEncoder`) + `UserService` consommés
  via DI.
- **PAS** de driver ORM en dur : les entités persistées étendent `BaseUser` (ou implémentent `IUser`)
  dans chaque adapter (`@nodefony/sequelize/mongoose/drizzle`). Repo via DI pur.

## Décisions figées

- **Module séparé acté 2026-05-20** (révise la décision 2026-05-16 qui plaçait IUser dans security).
  `BcryptEncoder` + `UserService` vivent ici, plus dans @nodefony/security.
- **`IUser` = 3 couches étanches** : (1) contrat strict framework ; (2) `BaseUser` POJO partagé ;
  (3) classes par ORM (étanches). Drizzle = pas de classe, schéma + mapping repo.
- **Split credential (façon Symfony `PasswordAuthenticatedUserInterface`)** : `IUser` reste **pur**
  (identité + rôles, aucun hash). Le hash vit sur `IPasswordAuthenticatedUser extends IUser`
  (`readonly password: string | null`) — seuls `@nodefony/security` (`UserPasswordAuthenticator`)
  et `IPasswordEncoder` y touchent. **Pourquoi** : 90% des consommateurs (affichage, authz) n'ont
  pas à voir le credential ; security tape sur un contrat typé → zéro `any`/downcast. C'est LA pièce
  de symbiose user↔security.
- **`AnonymousUser` = singleton gelé** (`anonymousUser`) + tableau de rôles partagé gelé : zéro
  allocation par requête non authentifiée (hot path). `@CurrentUser` retourne `IUser | AnonymousUser`,
  jamais `null` (Zero Trust : un visiteur EST un utilisateur anonyme).
- **Champs anti-migration** sur `BaseUser` : `socialProviders: Array<{provider,providerId,createdAt}>`
  (JSON, **pas** de colonnes `googleId/githubId`), `metadata: Record<string,unknown>` (PAS `any`),
  `currentRole` (profil actif session, P5.11), `password?: string` (nullable = 100% OAuth possible).
- **`id: string`** (UUID, **pas** `string|number`).
- `IUser.roles: string[]` reste **plat** (perf ALS + logs structurés). RBAC dynamique = `IRole`/`IPermission` (niveau B, P6.8).
- **`IUserProvider`** API étendue : `loadUserByIdentifier` + `loadUserByOAuth(provider,providerId)` + `refreshUser(user)`. Pattern **Shadow User** (ligne locale même en auth OAuth).
- **`IUserRepository`** étend `IRepository<IPasswordAuthenticatedUser>` de `@nodefony/orm-core` (peerDep) — ORM-agnostique. **Affiné P5.6** : la persistance EST la frontière credential (le repo lit/écrit le hash) ; le split protège les consommateurs *en aval* (`IUserProvider` rend `IUser`), pas le stockage.
- **`BcryptEncoder` (P5.6)** : `@node-rs/bcrypt` (NAPI Rust) en **peerDep optionnelle** + externalisé rollup (binaire natif jamais bundlé). `verify` délègue la promesse (0 async superflu). `needsRehash` parse le coût `$2[aby]$NN$`.
- **`UserService` (P5.6)** étend `Service` (DI + bus events). `authenticate()` : leurre anti-timing (hash lazy), re-hash transparent sur coût obsolète, 6 events. CRUD haché ; `changePassword` seul chemin du credential (`updateUser` exclut `id`/`password`).

## Interdits

- Importer `@nodefony/security`, `@nodefony/http`, `@nodefony/framework` (inversion de dép : ce module est consommé, il ne consomme pas la couche web/security).
- Importer un driver ORM concret. Logique métier applicative. `any`. `@ts-ignore`. `require()`.

## Roadmap (MIGRATION_STATUS P5)

- ✅ **P5.5a** scaffold workspace : package.json/tsconfig/rollup/index.ts/docs + arbo `nodefony/{contracts,src/encoders,service}/`.
- ✅ **P5.5** contracts : `IUser` (strict) + `IPasswordAuthenticatedUser` + `ISocialProvider` + `IUserProvider` + `IUserRepository` + `IPasswordEncoder` + `BaseUser` + `AnonymousUser` (+ singleton `anonymousUser`). 11 tests verts. **`IRole`/`IPermission` DIFFÉRÉS → P6.8** (slot réservé/commenté dans le barrel ; format RBAC à figer sur cas voter concret).
- ✅ **P5.6** `UserService` (CRUD haché + `authenticate()` + 6 events lifecycle) + `BcryptEncoder` (`@node-rs/bcrypt`, rounds: 12). 22 tests (33 total). Contrat `IUserRepository` affiné → `IPasswordAuthenticatedUser`.
- ⬜ **P5.7/5.8/5.9** adapters User entity Sequelize / Mongoose / Drizzle.
- ⬜ **P5.10** tests cross-ORM (même `IUser`, 3 adapters CRUD).
- ⬜ **P5.11** session refactor (`session.user: IUser` + `regenerateId()`).

## Build / types

- Standard conforme : `dist/types/` + `exports` (généré par Rollup, jamais de `.d.ts` manuel).
- `npm run build` (rollup preserveModules). Tests : `npx mocha --config .mocharc.json` (tsx).

## Liens mémoire IA

- `project_nodefony_user_module` (décision module séparé), `project_decisions_p5_p6_orm` (§3 IUser, §4 IUserProvider), `project_security_module_design`.
