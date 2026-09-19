---
adr: 10
title: Identité — contrat IUser dans un module @nodefony/user séparé du firewall
lang: fr
navTitle: Identité — IUser
date: 2026-05-20
status: accepted
deciders: [Christophe CAMENSULI]
tags: [security, user, identity, modules]
---

# ADR-0010 — Identité : contrat `IUser` dans un module `@nodefony/user` séparé du firewall

## Statut

Accepté (2026-05-20). **Révise une décision du 2026-05-16** qui plaçait le contrat d'identité
dans `@nodefony/security`.

## Contexte

Beaucoup de modules ont besoin de savoir _qui_ agit : le firewall, le framework, les modules
de persistance, la console d'administration, et plus tard la couche d'agents. Si le contrat
d'identité vit dans le module de sécurité, **tous tirent le firewall entier pour un type** —
un couplage que rien ne justifie.

Trois faits ont pesé :

- **La console d'administration est un gros consommateur** d'opérations sur les comptes
  (lister, créer, changer un mot de passe). Elle n'a aucune raison de dépendre du firewall.
- **Un fournisseur d'identité externe** (annuaire LDAP, fédération) doit pouvoir implémenter
  le contrat sans rien connaître du pare-feu applicatif.
- **Le coût d'extraction plus tard dépasse de loin le coût de création maintenant** : séparer
  après coup, c'est refactoriser N modules consommateurs.

Le précédent qui a servi de repère est Symfony, où `security-core` est distinct de
`security-bundle`.

## Décision

1. **Le contrat d'identité vit dans `@nodefony/user`**, module de l'espace de travail, séparé
   de `@nodefony/security`. Tout module qui consomme l'identité importe `@nodefony/user`
   directement, **jamais à travers le module de sécurité**.
2. **`IUser` est le contrat racine, et il reste pur.** Il porte l'identifiant interne (UUID,
   jamais `string | number`), l'identifiant fonctionnel d'authentification, les rôles **plats**
   — sans hiérarchie résolue —, et trois questions : possède-t-il ce rôle, le compte est-il
   actif, est-il verrouillé.
3. **Le credential n'est pas dans le contrat de base.** Un utilisateur porteur d'un mot de
   passe local relève d'une extension (`IPasswordAuthenticatedUser`), parce que seuls
   l'authentificateur par mot de passe et un encodeur ont besoin du hachage — l'affichage et
   l'autorisation n'ont rien à en faire. Un compte entièrement OAuth n'a pas de mot de passe.
4. **Pas de `IPrincipal`.** Une seule racine, `IUser`, plutôt qu'une abstraction parallèle pour
   les identités non humaines : le jour où un agent ou un service doit être représenté, il
   l'est par une extension de `IUser`, pas par un contrat concurrent.
5. **La fourniture d'identité est un contrat, pas une implémentation** : `IUserProvider`,
   `IUserRepository`, `IPasswordEncoder`, `IPasswordVerifier`, `IPasswordBlocklist`. Le module
   les déclare ; les modules de persistance les réalisent.

## Conséquences

**Ce que cela permet.** La console d'administration, le framework et les modules de
persistance manipulent une identité sans dépendre du firewall. Un fournisseur tiers
s'écrit contre un contrat de quelques méthodes.

**Ce que cela impose.** `@nodefony/security` déclare `@nodefony/user` en dépendance, et non
l'inverse — la flèche ne doit jamais s'inverser, sous peine de recréer le couplage que cette
décision défait.

**Une conséquence assumée, et discutée.** La **table** des utilisateurs appartient à
l'application, pas au framework : c'est elle qui décide de ses colonnes métier. Le framework
fournit le contrat et les encodeurs, il n'impose pas un schéma. Le corollaire est qu'une
application neuve doit poser sa propre entité — ce que le générateur fait pour elle.

**Ce qui n'existe pas, contrairement à ce que des notes de chantier ont pu dire** : il n'y a
**ni champ `kind`, ni champ `onBehalfOf`** sur `IUser`. Le slot « identité déléguée » (un agent
agissant pour le compte d'un utilisateur) a été conçu, jamais écrit. Il relève de l'échange de
jetons (RFC 8693) et attend son cas d'usage.

**Où se lit la décision dans le code** :
`src/packages/@nodefony/user/nodefony/contracts/` — un fichier par contrat, tous re-exportés
par le barrel du module.

## Alternatives écartées

| Alternative                                                | Pourquoi non                                                                                                                  |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `IUser` dans `@nodefony/security`                          | Tout consommateur d'identité tire le firewall entier pour un type                                                             |
| `IUser` dans le cœur `nodefony`                            | Le cœur ne doit rien savoir de l'identité : c'est un choix applicatif, pas une primitive de runtime                           |
| Une racine `IPrincipal` avec `IUser` comme cas particulier | Abstraction payée d'avance pour un besoin — les identités non humaines — qui n'est pas encore exprimé ; une extension suffira |
| Le hachage du mot de passe dans `IUser`                    | Expose un credential à 90 % de consommateurs qui n'en ont pas l'usage, et rend un compte OAuth incohérent avec le contrat     |
| Le framework possède la table des utilisateurs             | Une application a des colonnes métier ; un schéma imposé se fait contourner ou dupliquer                                      |

## Pour aller plus loin

- [ADR-0009 — session hybride](0009-session-hybride-cookie-bff-jwt-api.md) : comment une identité est portée d'une requête à l'autre.
- [`src/packages/@nodefony/security/docs/firewall.md`](../../src/packages/@nodefony/security/docs/firewall.md) : comment une requête reçoit son identité.
