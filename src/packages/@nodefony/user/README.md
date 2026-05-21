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

🚧 **Scaffold (P5.5a)** — workspace en place, contrats et implémentations à venir :

| Phase | Contenu | État |
| ----- | ------- | ---- |
| P5.5a | Workspace (package, tsconfig, rollup, arbo) | ✅ |
| P5.5  | `IUser`, `IPasswordAuthenticatedUser`, `IUserProvider`, `IUserRepository`, `IPasswordEncoder`, `BaseUser`, `AnonymousUser` | ✅ |
| —     | `IRole`, `IPermission` (RBAC dynamique) — **différés à P6.8** | ⏸ |
| P5.6  | `UserService` (CRUD + `authenticate()`) + `BcryptEncoder` | ⬜ |
| P5.7–5.9 | Adapters User Sequelize / Mongoose / Drizzle | ⬜ |
| P5.10 | Tests cross-ORM (même `IUser`, 3 adapters) | ⬜ |
| P5.11 | Refactor session (`session.user: IUser`) | ⬜ |

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

import { BaseUser, AnonymousUser, BcryptEncoder, UserService } from "@nodefony/user";
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

## Installation (workspace)

Module workspace du monorepo `nodefony-core`. peerDependencies : `nodefony`, `@nodefony/orm-core`.

```bash
npm run build --workspace=src/packages/@nodefony/user
```

## Licence

CeCILL-B — Christophe CAMENSULI.
