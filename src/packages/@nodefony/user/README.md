# @nodefony/user

**User Core** de Nodefony — contrat `IUser`, utilisateurs de base, encoders de mots de passe
et `UserService`, le tout **indépendant de `@nodefony/security`** et **agnostique de l'ORM**.

## Pourquoi un module séparé ?

Beaucoup de modules manipulent un utilisateur : `security`, `framework`, les adapters ORM, `agent`,
`llm`, `rag`, `realtime`, `studio`. Si `IUser` vivait dans `@nodefony/security`, tous tireraient la
couche sécurité complète pour un simple type. Ce module isole le **socle utilisateur** — exactement
comme Symfony sépare `security-core` de `security-bundle`.

```
@nodefony/user (léger)  ←  importé partout (type IUser, BaseUser, UserService)
@nodefony/security      →  consomme @nodefony/user (authenticators, firewall)
```

## Statut

| Phase    | Contenu                                                                                                                    | État |
| -------- | -------------------------------------------------------------------------------------------------------------------------- | ---- |
| P5.5a    | Workspace (package, tsconfig, rollup, arbo)                                                                                | ✅   |
| P5.5     | `IUser`, `IPasswordAuthenticatedUser`, `IUserProvider`, `IUserRepository`, `IPasswordEncoder`, `BaseUser`, `AnonymousUser` | ✅   |
| —        | `IRole`, `IPermission` (RBAC dynamique) — **différés à P6.8**                                                              | ⏸    |
| P5.6     | `UserService` (CRUD + `authenticate()`) + `BcryptEncoder`                                                                  | ✅   |
| P5.8–5.9 | Adapters User Mongoose / Drizzle                                                                                           | ⬜   |
| P5.10    | Tests cross-ORM (même `IUser`, 3 adapters)                                                                                 | ⬜   |
| P5.11    | Refactor session (`session.user: IUser`)                                                                                   | ⬜   |

## API publique (cible)

```typescript
import type {
  IUser,
  IRole,
  IPermission,
  IUserProvider,
  IUserRepository,
  IPasswordEncoder,
} from "@nodefony/user";

import {
  BaseUser,
  AnonymousUser,
  BcryptEncoder,
  UserService,
} from "@nodefony/user";
```

### Contrat `IUser` (cible)

```typescript
interface IUser {
  readonly id: string; // UUID
  readonly identifier: string;
  readonly roles: string[]; // plat (perf ALS + logs)
  hasRole(role: string): boolean;
  isActive(): boolean;
  isLocked(): boolean;
}
```

`BaseUser` ajoute les champs **anti-migration** : `socialProviders[]` (JSON), `metadata`
(`Record<string, unknown>`), `currentRole` (profil actif de session), `password?` (nullable pour
les comptes 100 % OAuth).

### `BcryptEncoder` & `UserService` (P5.6)

```typescript
import { BcryptEncoder, UserService } from "@nodefony/user";

const encoder = new BcryptEncoder(12); // coût bcrypt (défaut 12)
const users = new UserService(userRepository, encoder); // repository injecté (DI)

const u = await users.createUser({
  identifier: "jane@x.io",
  plainPassword: "s3cret",
});
const auth = await users.authenticate("jane@x.io", "s3cret"); // IUser | null
await users.changePassword(u.id, "nouveau"); // seul chemin du credential
```

`UserService` étend `AbstractCrudService` (`@nodefony/orm-core`) : il hérite du CRUD générique
(`find`/`findOne`/`findById`/`count`/`create`/`update`/`delete` + events `onCreated`/`onUpdated`/
`onDeleted`) et n'ajoute que le spécifique credential (`createUser`, `changePassword`,
`findByIdentifier`, `authenticate`).

`authenticate()` nivelle le temps de réponse sur identifiant inconnu (anti-énumération), re-hache
de façon transparente quand le coût stocké est obsolète, et émet des events
(`onAuthenticated`, `onAuthenticationFailure`, `onPasswordChanged`) consommables par
`@nodefony/security` ou Studio.

> `BcryptEncoder` s'appuie sur `@node-rs/bcrypt` (binding NAPI Rust, async non bloquant), déclaré en
> **peerDependency optionnelle** : seules les applications qui authentifient par mot de passe local
> l'installent. Un consommateur qui n'importe que le type `IUser` ne tire aucun binaire natif.

## Installation (workspace)

Module workspace du monorepo `nodefony-core`. peerDependencies : `nodefony`, `@nodefony/orm-core`,
et **optionnelle** `@node-rs/bcrypt` (requise uniquement pour `BcryptEncoder`).

```bash
npm run build --workspace=src/packages/@nodefony/user
```

## Licence

CeCILL-B — Christophe CAMENSULI.
