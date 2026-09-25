---
adr: 12
title: Configuration — figée au démarrage, surchargée par requête sur liste blanche
lang: fr
navTitle: Calque de configuration
date: 2026-09-26
status: accepted
deciders: [Christophe CAMENSULI]
tags: [configuration, multi-tenant, security, kernel, http]
---

# ADR-0012 — Configuration : figée au démarrage, surchargée par requête sur liste blanche

📍 [Documentation](../index.md) › [Décisions d'architecture](README.md) › **ADR-0012**

## Statut

Accepté (2026-09-26). Tickets : [#491](https://github.com/nodefony/nodefony-core/issues/491) (gel),
[#493](https://github.com/nodefony/nodefony-core/issues/493) (retrait des paramètres à chemin
pointé), [#494](https://github.com/nodefony/nodefony-core/issues/494) (calque). Sert la grappe
multi-organisation [#492](https://github.com/nodefony/nodefony-core/issues/492).

## Contexte

**L'analogie** : la configuration d'un module est une **carte imprimée**, affichée au mur et lue par
toutes les requêtes en même temps. Deux besoins tirent en sens contraire :

- **Personne ne doit écrire sur la carte.** Elle est partagée : une requête qui modifie un objet de
  configuration qu'elle vient de lire change la configuration de toutes les requêtes concurrentes,
  sans un mot. Le conteneur rendait ce défaut facile : il gardait un arbre de « paramètres » à chemin
  pointé (`getParameters("app.debug")`), hérité du framework JavaScript, qu'un scope rendait par
  référence pour toute clé qu'il ne surchargeait pas.
- **Une requête doit pouvoir porter SA variante.** Une application qui sert plusieurs organisations
  veut, pour l'organisation de la requête, un quota d'envoi différent. Le seul mécanisme de surcharge
  était l'arbre ci-dessus — sans aucun lecteur en production, et sans aucune limite sur ce qu'on
  pouvait surcharger.

Trois faits ont pesé, tous mesurés dans le code :

- **L'arbre de paramètres n'avait qu'un écrivain et aucun lecteur** : le constructeur de `Module`
  y recopiait `this.options` ; chaque module lit sa configuration dans `this.options`.
- **Presque toute la configuration est lue au démarrage**, puis mise en cache par les services.
  Surcharger une telle clé par requête n'aurait aucun effet. Relevé clé par clé sur les 11 modules
  configurables : seuls les quotas de corps et d'envoi de `@nodefony/http` sont relus à chaque
  requête ET sans risque (tableau plus bas).
- **Le corps d'une requête est lu AVANT le pare-feu.** Les limites de taille s'appliquent donc
  avant toute authentification (une protection contre le déni de service), et un calque qui doit
  les changer doit être posé avant la lecture du corps.

## Décision

**1. La configuration d'un module est figée à la fin de `onReady`.** Le kernel gèle en profondeur
les `options` de chaque module (`freezeConfigTree()`, `kernel/moduleConfig.ts:199`), après les
écouteurs de `onReady` et avant que le premier serveur n'écoute. Seuls les objets simples et les
tableaux sont gelés : une instance de classe rangée en configuration garde son état. Une écriture
lève une `TypeError`, au lieu de changer la configuration de tout le monde en silence.

**2. L'arbre de paramètres à chemin pointé est retiré** (`setParameters`, `getParameters`,
`freezeParameters`, types `DynamicParam` et `ProtoParameters`), avant la 10.0.0 plutôt que déprécié
pendant une série majeure.

**3. Une requête pose un CALQUE, sur la liste blanche du module.**

- `overlayConfig("@nodefony/http", { … })` (`config/overlay.ts:104`) valide le calque contre le
  schéma de surcharge du module (`Module.overlaySchema`, un schéma Zod strict), le fusionne avec la
  configuration figée, gèle le résultat et le range sur le scope de la requête.
- `useConfig("@nodefony/http")` (`config/overlay.ts:142`) rend la configuration telle que la voit
  la requête courante. Sans calque, c'est l'objet figé du module, rendu par référence : aucune
  allocation.
- **Refus par défaut** : un module qui ne déclare pas de liste blanche n'accepte aucun calque, et
  une clé hors liste est refusée en la nommant. Les champs repris du schéma perdent leur défaut
  (`overlayField()`), sinon ce défaut s'injecterait dans chaque calque.
- Les calques vivent dans une `WeakMap` indexée par scope, pas dans un champ du `Scope` : une
  requête sans calque ne paie rien, et le calque disparaît avec son scope.

**4. Un point d'accroche dans la bulle de la requête, avant la lecture du corps** : l'événement
`onRequestScope` du kernel, déclenché par `@nodefony/http` juste après l'entrée dans le contexte
asynchrone de la requête. C'est là qu'une application reconnaît l'organisation et pose son calque.
Sans écouteur, rien n'est émis.

**5. L'édition à chaud (développement) remplace au lieu d'écrire** : `withResolvedPath()` recopie
le seul chemin modifié, et `Kernel.replaceModuleOptions()` installe la nouvelle configuration.

### Les listes blanches des modules

| Module                    | Liste blanche                                                                                                                      | Pourquoi                                                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `@nodefony/http`          | `maxBodySize` · `upload.maxFileSize` · `upload.maxTotalFileSize` · `upload.maxFiles` · `upload.maxFields` · `upload.maxFieldsSize` | Relus à la lecture du corps, sans enjeu de sécurité, avec un sens par organisation (quota)                                               |
| `@nodefony/http` (refusé) | `queryString`, `securityHeaders`, `trustProxy`, `trustedHosts`, `rateLimit`, `session`, `certificates`, `upload.uploadDir`         | `queryString` est lu au constructeur de la requête, avant tout calque ; les autres sont des politiques de sécurité ou des chemins disque |
| `@nodefony/security`      | aucune                                                                                                                             | Secrets, politique d'authentification, CSRF, en-têtes, pare-feu : jamais surchargeables                                                  |
| `@nodefony/framework`     | aucune                                                                                                                             | Routeur, magasin d'idempotence, zones du pare-feu : résolus au démarrage                                                                 |
| `@nodefony/realtime`      | aucune                                                                                                                             | Bus inter-exemplaires, limites et contrôle d'origine : figés au démarrage ; `csrf` et le secret du bus sont sensibles                    |
| `@nodefony/drizzle`       | aucune                                                                                                                             | Connexions et migrations : ouvertes au démarrage ; l'URL de connexion est un secret                                                      |
| `@nodefony/mongoose`      | aucune                                                                                                                             | Connexions : ouvertes au démarrage ; identifiants secrets                                                                                |
| `@nodefony/redis`         | aucune                                                                                                                             | Clients construits au démarrage ; mot de passe et URL secrets                                                                            |
| `@nodefony/frontend`      | aucune                                                                                                                             | Outillage Vite et origine des ressources : figés au démarrage                                                                            |
| `@nodefony/documentation` | aucune                                                                                                                             | Le cache de la doc est PARTAGÉ : une durée de vie par requête ferait rafraîchir le cache de tous par l'une                               |
| `@nodefony/devkit`        | aucune                                                                                                                             | Périmètre et autorisation du serveur MCP : une politique de sécurité                                                                     |
| `@nodefony/studio`        | aucune                                                                                                                             | Mode de service de l'interface : choisi au démarrage                                                                                     |

Un module qui n'a pas de schéma de configuration (`user`, `orm-core`…) n'accepte aucun calque, par
construction.

## Conséquences

- **Rupture d'API** : les méthodes de paramètres du conteneur et de `Service` disparaissent, et le
  2ᵉ argument du constructeur de `Container` change de sens. Aucun code du dépôt ne les lisait.
- **Une écriture tardive dans `module.options` lève.** Une configuration se complète au démarrage
  (`@nodefony/http` y résout `uploadDir`), jamais après `onReady`.
- **Le chemin de requête s'allège** : un `Scope` n'alloue plus d'objet de paramètres et perd un
  champ ; un `GET` ne lit plus les limites du corps.
- **Déclarer une clé surchargeable oblige le module à la lire par `useConfig()`**, au moment de
  s'en servir. Une clé déclarée mais lue par `this.options` serait acceptée puis ignorée.
- **En WebSocket, le calque suit la CONNEXION**, comme la portée `request` des services : il vaut
  pour tous les messages de la socket.
- **Un calque posé après le pare-feu n'agit pas sur les quotas de corps**, déjà appliqués. Une
  organisation reconnue à son jeton ne peut donc pas changer sa taille d'envoi ; une organisation
  reconnue à son nom d'hôte, si.

## Alternatives écartées

| Alternative                                                 | Pourquoi elle est écartée                                                                                             |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Copier la configuration à chaque lecture                    | Une allocation par lecture sur le chemin de requête, pour protéger contre une faute qui ne doit pas exister           |
| Garder l'arbre à chemin pointé comme calque                 | Aucune liste blanche possible sur des chaînes libres ; une faute de frappe ne se voit pas ; aucun lecteur à préserver |
| Tout rendre surchargeable, et laisser l'application filtrer | Le refus doit être la règle : une organisation qui atteint un secret ou une politique de sécurité est une faille      |
| Ranger les calques dans un champ du `Scope`                 | Un champ de plus sur chaque requête, pour une fonction que la plupart n'utilisent pas                                 |
| Poser le calque au pare-feu                                 | Le corps est lu avant : les quotas de corps seraient déjà appliqués                                                   |
| Désactiver le gel en développement, pour l'édition à chaud  | Le développement est justement là où l'on doit voir l'écriture fautive                                                |

## Pour aller plus loin

- [Configurer une application](../guides/configuration.md) — la section « Une configuration propre
  à une requête » montre le calque de bout en bout.
- [ADR-0006](0006-configuration-unifiee-env-override.md) — la source unique de configuration par
  module, sur laquelle ce calque s'appuie.
- Tests : `src/nodefony/src/tests/configOverlay.test.ts` (le calque),
  `src/packages/@nodefony/http/nodefony/tests/integration/config-overlay.test.ts` (sur le serveur
  réel), `src/packages/@nodefony/http/nodefony/tests/unit/httpOverlay.test.ts` (la liste blanche).
