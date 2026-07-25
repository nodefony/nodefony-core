# @nodefony/user

Socle utilisateur de Nodefony : contrat `IUser`, implémentations de base (`BaseUser`,
`AnonymousUser`), encodeurs de mot de passe et `UserService` — **indépendant de
`@nodefony/security`** et **agnostique de l'ORM**.

## Pourquoi un module séparé ?

Beaucoup de modules manipulent un utilisateur : la sécurité, le framework, les adaptateurs ORM, le
temps réel, la console d'administration. Si `IUser` vivait dans `@nodefony/security`, chacun d'eux
tirerait toute la couche sécurité pour un simple type. Ce module isole le socle utilisateur, léger
et sans dépendance lourde :

```
@nodefony/user (léger)  ←  importé partout (type IUser, BaseUser, UserService)
@nodefony/security      →  consomme @nodefony/user (authenticators, firewall)
```

## API publique

```typescript
import type {
  IUser,
  IPasswordAuthenticatedUser,
  IUserProvider,
  IUserRepository,
  IPasswordEncoder,
} from "@nodefony/user";

import {
  BaseUser,
  AnonymousUser,
  BcryptEncoder,
  UserService,
  InMemoryUserRepository,
} from "@nodefony/user";
```

### Contrat `IUser`

```typescript
interface IUser {
  readonly id: string; // UUID
  readonly identifier: string;
  readonly roles: string[]; // plat (coût du contexte async + journaux)
  hasRole(role: string): boolean;
  isActive(): boolean;
  isLocked(): boolean;
}
```

`IUser` est **pur** : identité et rôles, aucun secret. Le hachage du mot de passe vit sur
`IPasswordAuthenticatedUser extends IUser` (`readonly password: string | null`), que seuls
l'authentificateur par mot de passe et les encodeurs manipulent. La grande majorité des
consommateurs — affichage, autorisation — n'a jamais le credential sous la main.

`BaseUser` ajoute les champs qui évitent une migration à chaque nouveau besoin :
`socialProviders[]` (JSON, plutôt qu'une colonne par fournisseur), `metadata`
(`Record<string, unknown>`), `currentRole` (profil actif de la session) et `password` nullable — un
compte entièrement OAuth n'en a pas.

`AnonymousUser` est un singleton gelé : un visiteur non authentifié **est** un utilisateur, et il ne
coûte aucune allocation par requête.

### `BcryptEncoder` et `UserService`

```typescript
import { BcryptEncoder, UserService } from "@nodefony/user";

const encoder = new BcryptEncoder(12); // coût bcrypt (défaut 12)
const users = new UserService(userRepository, encoder); // dépôt injecté

const u = await users.createUser({
  identifier: "jane@x.io",
  plainPassword: "s3cret",
});
const auth = await users.authenticate("jane@x.io", "s3cret"); // IUser | null
await users.changePassword(u.id, "nouveau"); // seul chemin du credential
```

`UserService` étend `AbstractCrudService` (`@nodefony/orm-core`) : il hérite du CRUD générique
(`find`/`findOne`/`findById`/`count`/`create`/`update`/`delete` et les événements
`onCreated`/`onUpdated`/`onDeleted`) et n'ajoute que le spécifique credential (`createUser`,
`changePassword`, `findByIdentifier`, `authenticate`).

`authenticate()` nivelle le temps de réponse sur un identifiant inconnu — sans quoi la durée de la
réponse révélerait l'existence d'un compte — re-hache de façon transparente quand le coût stocké est
dépassé, et émet des événements (`onAuthenticated`, `onAuthenticationFailure`, `onPasswordChanged`)
consommables par `@nodefony/security` ou par la console d'administration.

> `BcryptEncoder` s'appuie sur `@node-rs/bcrypt` (liaison native non bloquante), déclaré en
> **dépendance de pair optionnelle** : seules les applications qui authentifient par mot de passe
> local l'installent. Un consommateur qui n'importe que le type `IUser` ne tire aucun binaire natif.

## Dépôts de données

`IUserRepository` étend le contrat `IRepository` de `@nodefony/orm-core` : le module ne connaît
aucun ORM, l'application choisit son dépôt par injection.

| Implémentation                                  | Usage                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------ |
| `InMemoryUserRepository` (ici)                  | Implémentation de référence sur une `Map` — bancs de charge, scripts, fixtures |
| `DrizzleUserRepository` (`@nodefony/drizzle`)   | SQL — schéma dans `entity/userTable`, requêtes liées (jamais concaténées)      |
| `MongooseUserRepository` (`@nodefony/mongoose`) | MongoDB — schéma dans `entity/userEntity`                                      |

Les trois répondent au même contrat : changer de dépôt ne touche pas le code applicatif.

## Installation

Module de l'espace de travail `nodefony-core`. Dépendances de pair : `nodefony`,
`@nodefony/orm-core`, et **optionnelle** `@node-rs/bcrypt` (requise uniquement pour
`BcryptEncoder`).

```bash
npm run build --workspace=src/packages/@nodefony/user
```

## Licence

CeCILL-B — Christophe CAMENSULI.
