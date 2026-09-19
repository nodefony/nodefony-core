---
adr: 9
title: Session hybride — cookie opaque BFF pour le navigateur, JWT pour les API et les agents
lang: fr
navTitle: Session hybride
date: 2026-06-06
status: accepted
deciders: [Christophe CAMENSULI]
tags: [security, session, jwt, cookies]
---

# ADR-0009 — Session hybride : cookie opaque BFF pour le navigateur, JWT pour les API et les agents

## Statut

Accepté (2026-06-06). **Révise une décision antérieure du 2026-05-20** qui prescrivait un HTTP
« full stateless », l'abandon des sessions serveur et un JWT en cookie. Cette première décision
est rejetée ; le présent document dit pourquoi.

## Contexte

La décision de mai partait d'un raisonnement répandu : « les sessions cassent en cluster, donc
JWT partout ». Une vérification contre les normes et les recommandations de l'OWASP l'a
renversée.

**Le raisonnement d'origine était faux à moitié.** Ce qui casse en cluster n'est pas la session,
c'est la session **en mémoire locale du process**. Le remède standard est un magasin partagé,
pas la suppression du concept.

**Et le talon d'Achille du JWT est la révocation.** Un jeton auto-porté reste valide jusqu'à son
expiration : impossible de déconnecter quelqu'un, de le bannir ou de lui retirer un rôle avant
ce terme. La parade usuelle — un jeton d'accès court plus un jeton de rafraîchissement
révocable — **réintroduit un magasin serveur**. Le « full stateless » est donc un mythe dès
qu'on veut la révocation.

Ce que disent les sources qui font foi :

- **OWASP, _Session Management Cheat Sheet_** : _« If an application does not need to be fully
  stateless, traditional session systems should be considered »_. L'ASVS V3 qualifie le JWT de
  _« common source of vulnerabilities »_.
- **IETF, `draft-ietf-oauth-browser-based-apps`** : le patron recommandé en premier est le
  **BFF** (_Backend For Frontend_) — garder les jetons **hors du navigateur** et s'appuyer sur
  une session serveur portée par un cookie. C'est l'inverse de « supprimer la session ».

## Décision

Chaque mécanisme là où il est bon, et la session reste un concept de premier rang.

| Usage                                                      | Mécanisme                                                                                   | Pourquoi                                                                                                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Navigateur** (application web, console d'administration) | **Session serveur** : cookie **opaque**, `HttpOnly` `Secure` `SameSite`, magasin enfichable | révocable à l'instant (déconnexion, bannissement, changement de rôle), aucune revendication périmée, surface d'attaque XSS minimale — c'est le patron BFF |
| **API de service à service, agents, fédération**           | **JWT** signé (RFC 8725, OAuth BCP 9700, DPoP RFC 9449 pour lier le jeton à son porteur)    | l'absence d'état a ici un sens réel : pas d'aller-retour vers un magasin de sessions                                                                      |

**Le magasin de sessions est enfichable, et rien n'est imposé.** Un registre statique
(`SessionsService.registerStorage`) reçoit les implémentations ; chaque module fournisseur
s'y déclare **au chargement**, et le choix se fait par la configuration `session.store`. Le
cœur HTTP n'importe aucun ORM.

| Magasin    | Dépendance                 | Cas d'usage                            |
| ---------- | -------------------------- | -------------------------------------- |
| mémoire    | aucune                     | tests, développement mono-process      |
| fichier    | aucune                     | développement, mono-process persistant |
| `drizzle`  | une base SQL déjà présente | production **sans** Redis              |
| `mongoose` | MongoDB                    | production NoSQL                       |
| `redis`    | Redis                      | production distribuée, le plus rapide  |

## Conséquences

**Ce que cela impose.** Une application distribuée doit choisir un magasin partagé — le
défaut mémoire ne survit ni à un redémarrage ni à un second exemplaire. Le framework ne le
devine pas : il obéit à `session.store`.

**Ce que cela permet.** Une révocation immédiate, donc une déconnexion qui déconnecte
vraiment. Un modèle de durée de vie aligné sur le NIST : inactivité, durée absolue, et
rafraîchissement au contact, appliqués **de la même façon en HTTP et en WebSocket**.

**Ce que cela coûte.** Deux chemins d'authentification à maintenir au lieu d'un, et la
tentation permanente d'utiliser le JWT là où le cookie suffirait. La règle de tri est simple :
**un navigateur reçoit un cookie opaque, jamais un JWT.**

**Où se lit la décision dans le code** :
`src/packages/@nodefony/http/nodefony/service/sessions/` (le registre et le magasin mémoire),
`src/packages/@nodefony/security/` (les authentificateurs), et un magasin par module
fournisseur.

## Alternatives écartées

| Alternative                                        | Pourquoi non                                                                                                                        |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| HTTP « full stateless », JWT partout               | Non révocable sans magasin serveur — donc pas réellement sans état ; contredit OWASP et le patron BFF de l'IETF                     |
| JWT dans un cookie, sans session serveur           | Cumule les défauts : revendications périmées **et** taille du jeton à chaque requête, sans gagner la révocation                     |
| Session serveur uniquement, y compris pour les API | Impose un aller-retour vers le magasin à chaque appel d'agent ou de service, là où l'absence d'état est légitime                    |
| Déléguer à une bibliothèque tierce (type Passport) | Écartée : le pipeline de Nodefony traite HTTP et WebSocket dans le même contexte, ce qu'aucune bibliothèque de ce genre ne modélise |

## Pour aller plus loin

- [`src/packages/@nodefony/http/docs/session.md`](../../src/packages/@nodefony/http/docs/session.md) : le cycle de vie d'une session et l'écriture d'un magasin.
- [`src/packages/@nodefony/security/docs/firewall.md`](../../src/packages/@nodefony/security/docs/firewall.md) : les zones, et comment une requête est authentifiée.
