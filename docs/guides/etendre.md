---
title: "Étendre Nodefony — les quatorze endroits où brancher le vôtre"
navTitle: Étendre le framework
lang: fr
module: global
topic: extension-guide
audience: humain
tags: [extension, registre, driver, contrat, interface, pluggable]
version: "doc"
status: stable
updated: 2026-09-20
source: "docs/guides/etendre.md"
related: src/packages/@nodefony/security/nodefony/src/authenticator/authenticatorRegistry.ts, src/packages/@nodefony/realtime/nodefony/src/backplane/backplaneRegistry.ts, docs/guides/configuration.md
---

# Étendre Nodefony

> **Ce que cette page vous donne** : la liste des endroits où Nodefony attend VOTRE
> implémentation — votre authentification, votre stockage de jetons, votre bus temps réel —
> sans qu'il faille modifier une ligne du framework. Chacun est une fonction exportée,
> typée, présente dans les `.d.ts` publiés : ce ne sont pas des intentions, ce sont des
> points d'accroche qu'on peut appeler aujourd'hui.

📍 [Documentation](../index.md) › [Guides](README.md) › **Étendre le framework**

## Qu'est-ce qu'un point d'extension, ici

Un framework se juge moins à ce qu'il fournit qu'à ce qu'on peut **remplacer** sans le modifier.
La question n'est pas « combien de briques sont livrées ? » mais « que se passe-t-il le jour où
l'une d'elles ne me convient pas ? ». Deux réponses sont possibles, et elles n'ont rien à voir :
soit on modifie le framework — et l'on hérite d'un fork à maintenir —, soit on branche la sienne
par une porte prévue pour ça.

Nodefony en compte **quatorze**, dont **huit sur la seule sécurité** : l'authentification, les
votants d'autorisation, les fournisseurs OAuth et cinq stockages. Aucune n'est un point
d'accroche générique où l'on peut tout faire : chacune est un contrat étroit, qui dit exactement
ce que votre implémentation doit savoir répondre.

Le principe qui les rend réels tient en une ligne de code absente : **le framework ne teste jamais
un nom de pilote en dur**. Il lit le nom que la configuration lui donne, le cherche dans un
registre, et appelle ce qu'il y trouve — que ce soit une brique livrée ou la vôtre. C'est vérifiable
au source (`src/packages/@nodefony/realtime/nodefony/src/backplane/backplaneRegistry.ts:55`), et
c'est gardé par un test qui refuse la réapparition d'un nom en dur.

## 1. Un seul patron, appris une fois

Treize des quatorze points s'écrivent de la même façon :

```typescript
register<Quelquechose>("mon-nom", (ctx) => new MonImplémentation(ctx));
```

- **un nom libre**, que vous choisirez ensuite dans la configuration ;
- **une fabrique**, appelée au démarrage avec un contexte (`ctx`) qui porte ce dont votre
  implémentation a besoin — le conteneur d'injection, la configuration du module, le journal ;
- **un retour** qui respecte le contrat correspondant.

L'appel se fait **avant le démarrage du noyau** — typiquement au chargement de votre module, ou en
tête de `nodefony.config.ts`. Le nom déclaré devient alors une valeur acceptable pour la clé de
configuration du module, dont le schéma est une chaîne ouverte et non une énumération fermée :
c'est ce qui rend la liste extensible plutôt que figée.

## 2. Les quatorze points

### Sécurité — `@nodefony/security`

| Ce que vous branchez                | La fonction                                   | Votre implémentation respecte |
| ----------------------------------- | --------------------------------------------- | ----------------------------- |
| Une façon de s'authentifier         | `registerAuthenticatorFactory(nom, fabrique)` | `IAuthenticator`              |
| Une règle d'autorisation            | `registerVoterFactory(nom, fabrique)`         | `IAccessVoter`                |
| Un fournisseur d'identité OAuth 2.0 | `registerOAuthProvider(nom, fabrique)`        | `IOAuthProvider`              |
| Le stockage des jetons              | `registerTokenStore(nom, fabrique)`           | `ITokenStore`                 |
| Le stockage des clés WebAuthn       | `registerWebAuthnStore(nom, fabrique)`        | `IWebAuthnCredentialStore`    |
| Le stockage du journal d'audit      | `registerAuditStore(nom, fabrique)`           | `IAuditStore`                 |
| Le stockage des secrets TOTP        | `registerTotpStore(nom, fabrique)`            | `ITotpSecretStore`            |
| Le stockage des points de webhook   | `registerWebhookStore(nom, fabrique)`         | `IWebhookStore`               |

Les fabriques OAuth acceptent un retour asynchrone (`IOAuthProvider | Promise<IOAuthProvider>`,
`src/packages/@nodefony/security/nodefony/src/oauth/oauthProviderRegistry.ts:58`) : un fournisseur
qui doit découvrir sa configuration OpenID Connect au démarrage peut le faire là. Les sept autres
suivent le même patron — par exemple l'authentification
(`src/packages/@nodefony/security/nodefony/src/authenticator/authenticatorRegistry.ts:52`) et les
votants (`src/packages/@nodefony/security/nodefony/src/voter/voterRegistry.ts:39`).

### Le noyau — `nodefony`

| Ce que vous branchez               | La fonction                               | Votre implémentation respecte |
| ---------------------------------- | ----------------------------------------- | ----------------------------- |
| Une destination de journaux        | `registerLogDriver(driver)`               | `ILogDriver`                  |
| La même, construite à la demande   | `registerLogDriverFactory(nom, fabrique)` | `ILogDriver`                  |
| La traduction des erreurs d'un ORM | `registerErrorAdapter(nom, adapter)`      | `IErrorAdapter`               |

`registerLogDriver` est le seul à prendre l'instance directement plutôt qu'une fabrique : le driver
porte son propre nom (`driver.name`), et le premier enregistré devient actif
(`src/nodefony/src/syslog/drivers/logDriverRegistry.ts:32`). La variante à fabrique vit juste en
dessous (`src/nodefony/src/syslog/drivers/logDriverRegistry.ts:152`), et l'adaptateur d'erreurs
dans le noyau (`src/nodefony/src/Error.ts:108`).

### Le reste

| Ce que vous branchez         | La fonction                                                       | Votre implémentation respecte |
| ---------------------------- | ----------------------------------------------------------------- | ----------------------------- |
| Un bus temps réel entre pods | `registerBackplaneDriver(nom, fabrique)` — `@nodefony/realtime`   | `IBackplane`                  |
| Le stockage d'idempotence    | `registerIdempotencyStore(nom, fabrique)` — `@nodefony/framework` | `IIdempotencyStore`           |

L'idempotence se branche de la même façon
(`src/packages/@nodefony/framework/nodefony/src/idempotencyStoreRegistry.ts:48`).

Le backplane est l'exemple le plus parlant : trois pilotes natifs sont livrés — `loopback` (une
seule instance), `cluster` (plusieurs processus, par IPC) et `redis` (plusieurs pods) — et rien dans
le code ne teste leur nom. Un pilote NATS, Pulsar ou RabbitMQ s'enregistre exactement comme eux,
sans distinction de rang.

### Le quatorzième, qui n'est pas comme les autres

`registerUserStore(nom)` — `@nodefony/user`,
`src/packages/@nodefony/user/nodefony/src/userStoreRegistry.ts:23` — ne prend **qu'un nom**, sans
fabrique. Ce n'est pas un
oubli : le module `user` ne construit pas le dépôt lui-même, il déclare qu'un backend de ce nom
existe. L'implémentation, elle, est posée par le module qui la porte (`@nodefony/drizzle`,
`@nodefony/mongoose`) ou par le vôtre, via le conteneur d'injection.

## 3. Étendre par héritage, plutôt que par registre

Certaines briques ne s'enregistrent pas : elles s'**étendent**. C'est le cas de tout ce qu'une
application écrit normalement — un module (`Module`), un service (`Service`), un contrôleur
(`Controller`, `RealtimeController`, `ResourceController`), une commande (`Command`). Ces classes
ne sont pas des points d'extension au sens de cette page : ce sont les classes de base de
l'utilisation ordinaire du framework, et elles sont documentées avec elle.

## 4. Ce qui n'est PAS extensible, et pourquoi

Il vaut mieux le savoir avant d'essayer :

- **Le pipeline de la requête.** L'ordre des étapes n'est pas configurable. Un point d'accroche à
  un endroit qui n'en a pas est une demande recevable — ouvrez une issue en décrivant ce que vous
  cherchez à faire, pas l'accroche que vous imaginez.
- **Le protocole temps réel.** Le format des trames est fixé (JSON-RPC 2.0) ; c'est le _transport_
  entre instances qui est remplaçable, via le backplane.
- **Les serveurs.** Ce sont ceux de Node — `node:http`, `node:http2`, `ws`. Il n'y a pas de couche
  d'abstraction à réimplémenter, et c'est délibéré.

## 📖 Lexique

- **Registre** — une table qui associe un nom à une fabrique. Le code du framework y lit le nom
  demandé par la configuration ; il ne connaît aucun nom en dur.
- **Fabrique** (_factory_) — une fonction appelée au démarrage qui construit votre implémentation,
  et reçoit pour cela un contexte.
- **Contrat** — l'interface que votre implémentation doit respecter. Son nom commence par `I`, et
  elle est exportée par le paquet concerné.
- **Backplane** — le fond de panier qui relie plusieurs instances de l'application entre elles, pour
  qu'un message publié sur l'une atteigne les clients connectés aux autres.

## ⚠️ Pièges

- **Enregistrer trop tard.** Un `register…` appelé après le démarrage du noyau n'est jamais lu : la
  configuration a déjà résolu son nom. Enregistrez au chargement de votre module.
- **Croire qu'une instance passée en configuration sera retenue.** Les schémas de configuration
  sont validés par Zod, qui **retire** ce qu'il ne connaît pas : une instance placée dans un objet
  de configuration disparaît sans message. Passez par le registre, ou par un service du conteneur
  d'injection.
- **Un nom déjà pris.** Réenregistrer un nom natif le remplace, silencieusement. Choisissez un nom
  à vous.
- **Confondre remplacer et contourner.** Si vous devez modifier le code du framework pour brancher
  quelque chose, ce n'est pas une extension : c'est un point d'extension manquant. Signalez-le.

## 🧪 Tests & couverture

Chaque registre est couvert par les tests de son paquet — l'enregistrement, la résolution par nom,
et le refus d'un nom inconnu. Le registre de backplane est en plus gardé par un test qui vérifie
qu'aucun nom de pilote n'est écrit en dur dans le code de résolution : c'est cette absence qui rend
la liste réellement ouverte, et elle ne se constate pas à la lecture.

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Guides](README.md) · [Toute la documentation](../index.md)
- [Configuration](configuration.md) — où se déclare le nom que vous venez d'enregistrer
- [Compatibilité](compatibilite.md) — ce que ces contrats garantissent d'une version à l'autre
- [Gouvernance](../../GOVERNANCE.md) — comment proposer un point d'extension qui manque
