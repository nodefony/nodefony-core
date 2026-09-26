---
adr: 11
title: Portée de requête — un conteneur par requête, par copie prototypale, atteint par l'ALS
lang: fr
navTitle: Scope de requête
date: 2026-09-26
status: accepted
deciders: [Christophe CAMENSULI]
tags: [di, container, scope, request, als, kernel, http, websocket]
---

# ADR-0011 — Portée de requête : un conteneur par requête, par copie prototypale, atteint par l'ALS

📍 [Documentation](../index.md) › [Décisions d'architecture](README.md) › **ADR-0011**

## Statut

Accepté (2026-09-26), après coup : le mécanisme est en service, cet ADR en consigne les raisons.
Chantier [#481](https://github.com/nodefony/nodefony-core/issues/481) — correctifs
[#482](https://github.com/nodefony/nodefony-core/issues/482), registre des scopes
[#483](https://github.com/nodefony/nodefony-core/issues/483), accès par l'ALS
[#484](https://github.com/nodefony/nodefony-core/issues/484), portée `request` des services
[#485](https://github.com/nodefony/nodefony-core/issues/485), documentation
[#486](https://github.com/nodefony/nodefony-core/issues/486). La configuration partagée suit la
même logique : [ADR-0012](0012-calque-configuration-par-requete.md).

## Contexte

**L'analogie** : le conteneur de l'application est une **carte imprimée**. Chaque requête pose
dessus un **calque transparent** : elle lit toute la carte à travers, dessine sur son calque et
jamais sur la carte ; deux requêtes, deux calques ; en fin de requête, le calque part à la poubelle.

Le besoin vient du modèle d'exécution de Node : **un seul processus sert des centaines de requêtes
entrelacées**. À chaque `await`, il passe à une autre. Un singleton est donc partagé par toutes les
requêtes en vol, et aucune « remise à zéro entre deux requêtes » n'est possible : il n'y a jamais
d'« entre deux ». Si le framework ne fournit pas l'isolation par requête, personne ne la fournit, et
chaque application la réinvente — souvent par une variable de module, qui fuit d'un client à l'autre
dès que deux requêtes se chevauchent (prouvé par `requestScopeIsolation.test.ts`).

Trois faits ont pesé, tous constatés dans le code :

- **Le mécanisme existait déjà**, hérité du framework JavaScript : le pipeline HTTP ouvrait un scope
  par requête, sous-conteneur dont le prototype est le conteneur du kernel. Mais aucune application
  ne pouvait l'atteindre sans recevoir le contexte, et aucun service ne pouvait y vivre.
- **Le mécanisme avait des défauts** (audit du chantier, commentaire de #481) : une lecture fusionnée
  de paramètres écrivait dans le conteneur parent, un scope imbriqué ne voyait pas son parent, et le
  registre des scopes ouverts coûtait ~70 % du cycle d'ouverture-fermeture.
- **Le coût d'un scope est faible** : un objet de plus, dont le prototype est la carte. La lecture
  d'un service de la carte depuis un scope coûte la même chose qu'une lecture directe.

## Décision

**1. Un conteneur par requête, par copie prototypale.** Le pipeline ouvre un `Scope` par requête
HTTP et par connexion WebSocket (`Container.enterScope()`, `Container.ts:245`). Le scope **adopte
le prototype** du conteneur parent : la lecture remonte la chaîne de prototypes, l'écriture reste
sur le scope (`Scope.set()`, `Container.ts:389`). Fermé par `leaveScope()` à la fin, qui le retire
du registre **avant** de le nettoyer.

**2. Le scope est atteignable par l'ALS.** Le contexte asynchrone de la requête porte le scope
(champ `scope`), posé par le kernel HTTP et par le pont `api.request` du temps réel.
`RequestContext.getScope()` (`RequestContext.ts:232`) le rend, ou `undefined` ;
`RequestContext.requireScope()` (`RequestContext.ts:246`) lève en nommant l'une des trois causes
(aucune requête, bulle sans scope, scope refermé). Un scope refermé n'est jamais rendu.

**3. Une portée `request` pour les services.** `@injectable({ scope: "request" })` (`DIScope`,
`injector.ts:27`) donne une instance par requête : créée à sa première résolution, rangée sur le
scope que l'ALS désigne, nettoyée (`clean()`) à la fermeture dans l'ordre inverse des créations.
Rien n'est alloué pour une requête qui n'en résout aucune.

**4. La dépendance captive est refusée, toujours.** Un singleton qui dépendrait d'un service
`request` garderait l'exemplaire de la première requête pour toutes les suivantes : l'injecteur le
refuse au démarrage, par analyse des déclarations (`Injector.assertNoCaptiveDependency()`,
`injector.ts:453`), et à la résolution pour le reste — en développement comme en production.

**5. En WebSocket, la requête est la connexion.** Un scope par connexion, partagé par ses messages
et ses invocations `api.request`, concurrentes comprises. Un scope par message est différé : il
n'a pas de cas d'usage réel aujourd'hui.

## Ce que font d'autres écosystèmes

Consulté pour trancher, pas pour se situer. Sources officielles, relues le 2026-09-26.

| Écosystème    | Mécanisme                                                                                      | Source                                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Symfony (PHP) | scopes du conteneur « deprecated in Symfony 2.8 », retirés en 3.0 ; `request_stack` à la place | [symfony.com — scopes](https://symfony.com/doc/2.8/service_container/scopes.html)                           |
| Symfony (PHP) | tag `kernel.reset` : réinitialiser des services entre deux requêtes d'un serveur applicatif    | [symfony.com — tags](https://symfony.com/doc/current/reference/dic_tags.html)                               |
| Laravel (PHP) | `scoped()` : instance vidée à chaque nouveau cycle de vie (requête, tâche)                     | [laravel.com — container](https://laravel.com/docs/container)                                               |
| ASP.NET Core  | « The framework creates a scope per request » (`HttpContext.RequestServices`)                  | [learn.microsoft.com — DI](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/dependency-injection) |
| NestJS (Node) | `Scope.REQUEST` ; la portée « bubbles up the injection chain » ; impact de performance averti  | [docs.nestjs.com — injection scopes](https://docs.nestjs.com/fundamentals/injection-scopes)                 |
| Awilix (Node) | `createScope()` : conteneur enfant, durée de vie `SCOPED`                                      | [npmjs.com — awilix](https://www.npmjs.com/package/awilix)                                                  |

Ce que ce tableau enseigne : en PHP classique, un processus sert une requête à la fois, et
l'isolation vient du runtime — le scope du conteneur y coûtait plus qu'il ne rapportait. Dès que le
processus dure (serveurs applicatifs), le besoin revient sous forme de **remise à zéro entre deux
requêtes**. Dans un runtime **concurrent**, cette remise à zéro est impossible : c'est la réponse
d'ASP.NET Core — un scope par requête — qui s'applique. Nodefony ne l'invente pas ; il la rend
peu coûteuse en JavaScript, et l'étend à la connexion WebSocket.

Aucun banc face à un autre framework n'a été mesuré : aucun avantage de performance n'est
revendiqué ([#489](https://github.com/nodefony/nodefony-core/issues/489)).

## Conséquences

- **Rupture d'API avant la 10.0.0** : `DIScope` gagne `"request"` (un `switch` exhaustif d'un
  consommateur ne compile plus) ; `IScope` gagne `closed`, `hasOwn()` et `own()` (un implémenteur
  externe doit les ajouter — aucun n'est connu).
- **Coût mesuré** : ouvrir puis fermer un scope ≈ 1,43 µs (sonde dans le serveur, un processus en
  production, paires alternées) ; résoudre un service `request` ≈ 1 µs, payé seulement par qui en
  résout un ; `getScope()` ≈ 17 ns. A/B de débit sur une application sans service `request` : aucune
  régression détectable.
- **Le nettoyage est synchrone** : `clean()` n'est pas attendu. Ce qui doit être validé appartient à
  l'action ; `clean()` est le filet. En HTTP, il s'exécute hors du contexte asynchrone de la requête.
- **En WebSocket, un service `request` vit toute la connexion** et se partage entre invocations
  concurrentes : n'y ranger que ce qui vaut pour la connexion.
- **Le nom d'un service `request` compte** : la clé cherchée sur le scope est apprise à la première
  création ; un service dont le nom de décorateur diffère de celui du `super()` rend la surcharge
  d'une requête dépendante de l'histoire du processus. La documentation impose le même nom.
- **Le gate mémoire compte exactement** les scopes restés ouverts et les services `request` non
  réclamés après chaque boucle : une fuite par requête ne se cache plus dans la pente du tas.

## Alternatives écartées

| Alternative                                                            | Pourquoi elle est écartée                                                                                                           |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Pas de portée de requête : singletons + ALS seulement                  | Suffit pour lire une DONNÉE de la requête ; ne donne aucun objet à cycle de vie (connexion liée au client, tampon à vider à la fin) |
| Copier le conteneur à chaque requête                                   | Une copie de tous les services par requête, pour isoler une poignée d'écritures                                                     |
| Conteneur enfant à remontée logicielle (boucle sur les parents)        | Du code à chaque lecture là où la chaîne de prototypes remonte seule, au même coût qu'une lecture directe                           |
| Portée qui remonte la chaîne : un consommateur devient « par requête » | Tout le graphe dépendant est reconstruit à chaque requête ; le refus franc de la dépendance captive dit où est la faute             |
| Remettre les services à zéro entre deux requêtes                       | Impossible dans un runtime concurrent : il n'y a pas d'« entre deux requêtes »                                                      |
| Avertir d'une dépendance captive au lieu de la refuser                 | L'avertissement laisse tourner une fuite de données entre requêtes                                                                  |
| Un scope par message WebSocket                                         | Aucun cas d'usage réel ; exige l'imbrication réparée — à rouvrir si un besoin apparaît                                              |

## Pour aller plus loin

- [Injection de dépendances et portées](../architecture/injection-portees.md) — le calque, les trois
  durées de vie, `getScope()`, les pièges.
- [ADR-0012](0012-calque-configuration-par-requete.md) — la configuration partagée figée, et son
  calque par requête sur liste blanche.
- Tests : `src/nodefony/src/tests/injectorRequestScope.test.ts`,
  `src/nodefony/src/tests/requestScopeIsolation.test.ts`,
  `src/packages/@nodefony/http/nodefony/tests/integration/request-service.test.ts`.
