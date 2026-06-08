---
module: "@nodefony/user"
title: User Core
version: 10.0.0
status: draft
---

# @nodefony/user — User Core

Socle utilisateur de Nodefony, **séparé** de `@nodefony/security` et **agnostique de l'ORM**.
Porte le contrat `IUser`, les utilisateurs de base (`BaseUser`, `AnonymousUser`), les encoders de
mot de passe (`BcryptEncoder`) et le `UserService` (CRUD + `authenticate()`).

## Positionnement

Symfony sépare `security-core` (le modèle utilisateur) de `security-bundle` (le firewall).
Nodefony fait pareil : `@nodefony/user` est consommé par `@nodefony/security`, jamais l'inverse.
Tout module qui a juste besoin du type `IUser` (framework, orm-\*, agent, studio…) importe ce module
léger sans tirer la couche sécurité.

## Couches du modèle utilisateur

1. **Contrat strict** `IUser` (framework) — `id` UUID, `identifier`, `roles` plat, `hasRole/isActive/isLocked`.
2. **POJO partagé** `BaseUser implements IUser` — champs anti-migration (`socialProviders`, `metadata`, `currentRole`, `password?`).
3. **Classes par ORM** (étanches) — `MongooseUser` étend `BaseUser` ; Drizzle = schéma + mapping repo.

## Fourniture & persistance

- `IUserProvider` : `loadUserByIdentifier`, `loadUserByOAuth`, `refreshUser`. Pattern **Shadow User**
  (une ligne locale est créée même pour une auth OAuth).
- `IUserRepository extends IRepository<IUser>` (de `@nodefony/orm-core`) — accès persistance portable
  entre Mongoose / Drizzle.

## Statut

Scaffold (P5.5a). Contrats et implémentations livrés aux phases P5.5 → P5.11.
