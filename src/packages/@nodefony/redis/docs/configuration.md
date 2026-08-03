---
title: "Configuration — déclarer l'accès Redis"
lang: fr
module: "@nodefony/redis"
topic: redis
section: "Persistance"
audience: [developer, devops]
tags:
  [
    redis,
    configuration,
    zod,
    environnement,
    connexions,
    tls,
    reconnexion,
    infra,
    deploiement,
  ]
version: "doc"
status: stable
updated: 2026-07-19
source: "src/packages/@nodefony/redis/docs/configuration.md"
coverageModule: redis
---

# Configuration de @nodefony/redis

> Une seule question à trancher : **quelle machine Redis, et comment y entrer**. Tout le reste a un
> défaut sûr. Cette page donne la liste complète des clés avec leur valeur d'usine réelle, les quatre
> variables d'environnement et l'ordre exact dans lequel elles gagnent, puis six situations de
> déploiement — du poste de développement au service managé chiffré. Ce que le module fait _dedans_
> avec ces valeurs (cycle des connexions, reconnexion, dégradation) est décrit par la page voisine,
> [Architecture interne](./architecture.md) : ici, on décide ; là-bas, on comprend.

📍 [Documentation](../../../../../docs/index.md) › [@nodefony/redis](index.md) › **Configuration**

## 🧠 Le modèle mental — d'où vient chaque valeur

Trois sources alimentent une configuration Redis, et elles sont empilées dans un ordre fixe. Chaque
étage ne réécrit que ce qu'il nomme ; le reste traverse intact.

```mermaid
flowchart TD
  D["1 · Défauts du schéma<br/>config.ts — un .default() par champ"]
  A["2 · Configuration de l'application<br/>use('@nodefony/redis', …) dans nodefony.config.ts"]
  E["3 · Environnement<br/>NF_REDIS_URL · REDIS_HOST · REDIS_PORT · REDIS_PASSWORD"]
  P["defineRedisConfig()<br/>parse ▸ garde-fou reconnexion ▸ env ▸ gel"]
  B["buildClientOptions(config, connexion)<br/>url ▸ socket de la connexion ▸ socket global"]
  C1["client main"]
  C2["client publish"]
  C3["client subscribe"]

  D --> P
  A --> P
  E --> P
  P --> B
  B --> C1
  B --> C2
  B --> C3
```

Deux résolutions distinctes, souvent confondues :

1. **La configuration du module** est résolue **une fois**, au démarrage, par `defineRedisConfig()`
   (`defineModuleConfig.ts:98`). Le résultat est **gelé** — plus personne ne le modifie ensuite.
2. **Les options d'un client** sont assemblées **par connexion**, au moment de l'ouverture, par
   `buildClientOptions()` (`buildClientOptions.ts:45`). C'est là que `url` écrase l'hôte, et que la
   surcharge d'une connexion se pose par-dessus le socket global.

> [!TIP]
> Quand une valeur ne « prend » pas, la question utile est donc : est-elle perdue à l'étage 1
> (fusion / validation) ou à l'étage 2 (assemblage du client) ? La section
> [Situations de déploiement](#situations-de-déploiement) et la table des pièges, en fin de page,
> sont rangées selon cette coupure.

## 📖 Lexique

| Terme            | Sens                                                                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Schéma Zod       | Description exécutable d'une configuration : type, contrainte, valeur par défaut et texte d'aide, dans un seul objet qui sait valider.         |
| Défaut d'usine   | La valeur qu'un champ prend quand personne ne le nomme. Ici, elle est toujours écrite dans le schéma — jamais recopiée ailleurs.               |
| Fusion profonde  | Assemblage récursif de deux objets : les clés nommées écrasent, les autres sont conservées. C'est ainsi qu'une surcharge reste partielle.      |
| Gel (`freeze`)   | Après validation, l'objet de configuration est rendu immuable : aucun code d'exécution ne peut le modifier en douce.                           |
| Connexion nommée | Un client Redis identifié par un nom logique (`main`, `publish`…). Le nom sert aussi côté serveur, pour `CLIENT LIST`.                         |
| Infra déclarée   | Modèle où l'exploitant déclare son infrastructure par des URLs (`NF_REDIS_URL`), plutôt que de configurer chaque brique une par une.           |
| Store            | Backend de persistance d'une brique (session, jetons…). Le vocabulaire du framework pour les **données**.                                      |
| TLS              | _Transport Layer Security_ : chiffrement du canal. Côté Redis, il se demande par le protocole `rediss://` ou par un drapeau de socket.         |
| ACL              | _Access Control List_ : le système d'utilisateurs de Redis 6+. Avant lui, une seule authentification globale par mot de passe (`requirepass`). |
| Back-off         | Attente croissante entre deux tentatives de reconnexion — pour ne pas marteler un serveur déjà en difficulté.                                  |
| Redis Cluster    | Mode natif de Redis où les clés sont réparties sur plusieurs nœuds ; le client doit suivre les redirections de partition.                      |
| Sentinel         | Mode de haute disponibilité de Redis : des sentinelles élisent le maître et le client leur demande où écrire.                                  |
| JSON Schema      | Description standard d'une structure de données, publiée par le module pour que Studio dérive son formulaire au lieu de le coder à la main.    |

## Qu'est-ce que configurer Redis ?

Configurer ce module, c'est répondre à trois questions, dans cet ordre d'importance :

1. **Où est le serveur ?** Un hôte et un port, ou bien une URL complète quand l'hébergeur n'en donne
   qu'une.
2. **Comment s'y authentifier ?** Un mot de passe, éventuellement un utilisateur ACL — et jamais dans
   un fichier versionné.
3. **Combien de canaux ouvrir, et sur quelles bases ?** Trois connexions par défaut, parce que le
   protocole Redis l'impose au temps réel.

Tout le reste — délais, back-off, famille IP — a une valeur d'usine raisonnable qu'on ne touche que
pour une raison précise.

Il y a une quatrième question, invisible dans le schéma mais décisive en production : **déclarer une
URL Redis dans l'environnement change aussi le comportement d'autres modules**. Une infra de cache
déclarée rend les sessions et l'idempotence éligibles à Redis sans que personne ne les nomme. C'est
un service rendu, mais il faut le savoir : voir
[Le double effet de l'URL d'infra](#le-double-effet-de-lurl-dinfra).

## La vision Nodefony — le schéma EST la configuration

Le module ne possède pas de « fichier de valeurs par défaut » à côté d'une « documentation des
options ». Il possède **un schéma Zod commenté**, et tout en dérive :

- **Les défauts** sont les `.default(...)` du schéma. Les valeurs d'usine effectivement chargées au
  démarrage sont produites par le schéma lui-même — `redisConfigSchema.parse({})` (`config.ts:248`) —
  et non retapées à la main.
- **Le type TypeScript** est inféré, jamais redéclaré : `IRedisConfig` (`IRedisConfig.ts:11`) et son
  pendant d'entrée `IRedisConfigInput` (`IRedisConfig.ts:17`), où tout champ portant un défaut devient
  optionnel.
- **Le texte d'aide** vit dans les `.describe()` du schéma, ce qui permet à
  `redisConfigJsonSchema()` (`defineModuleConfig.ts:110`) de publier un JSON Schema **documenté** que
  Studio transforme en formulaire.
- **Les champs sensibles se déclarent** : `url` et `password` portent un `.meta({ secret: true })`
  (`config.ts:187`), ce qui les fait masquer là où la configuration est affichée.

Le schéma reste volontairement **pur** : il ne lit jamais `process.env`. Sans cette règle, il
deviendrait non déterministe et le JSON Schema publié dépendrait de la machine qui l'a produit. La
lecture de l'environnement est donc une couche explicite, appliquée après coup par
`applyEnvOverrides()` (`defineModuleConfig.ts:23`).

Cette organisation est la convention de configuration du framework, tenue à deux fichiers et deux
seulement : `config.ts` porte **le quoi** (schéma, contraintes, défauts), `defineModuleConfig.ts`
porte **le comment** (valider, superposer l'environnement, geler, publier le JSON Schema). Un
troisième fichier de configuration, dans un module Nodefony, est un signal d'alarme.

> [!NOTE]
> La configuration du module est **immuable après le démarrage** : `defineRedisConfig()` rend un objet
> gelé (`defineModuleConfig.ts:103`). Changer de serveur Redis suppose donc un redémarrage — aucune
> clé n'est modifiable à chaud.

## 🚀 Démarrage rapide

Vu depuis une application créée par `nodefony create app`. Trois gestes : déclarer, authentifier,
vérifier.

### 1. Déclarer le module

```ts
// nodefony.config.ts — l'orchestrateur de l'application
export default defineConfig(() => ({
  modules: [
    // Redis d'abord : il enregistre ses fabriques de stores pendant
    // l'enregistrement des modules, donc avant tout consommateur.
    use("@nodefony/redis", {
      globalOptions: {
        socket: {
          host: "127.0.0.1",
          port: 6379,
          // 5 s pour établir le socket : au-delà, on échoue au lieu de pendre.
          connectTimeout: 5_000,
        },
        // Aucun secret ici : le mot de passe arrive par REDIS_PASSWORD.
      },
      connections: {
        // S'AJOUTE à main / publish / subscribe (fusion profonde des défauts) —
        // une base séparée pour un cache applicatif qu'on pourra vider seul.
        cache: { name: "cache", database: 1 },
      },
    }),
    "@nodefony/http",
    "@nodefony/framework",
  ],
}));
```

Le mot de passe, lui, ne descend jamais dans un fichier versionné :

```bash
export REDIS_PASSWORD=nodefony-dev
```

### 2. La variante sans configuration — l'infra déclarée

Si l'hébergeur ne fournit qu'une URL, il n'y a **rien** à écrire dans `nodefony.config.ts` :

```ts
// nodefony.config.ts — le module suffit à lui-même, la cible vient de l'environnement
export default defineConfig(() => ({
  modules: ["@nodefony/redis", "@nodefony/http", "@nodefony/framework"],
}));
```

```bash
# Hôte, port, base, utilisateur et mot de passe : tout est dans l'URL.
export NF_REDIS_URL=redis://:motdepasse@redis.interne:6379
```

Cette seconde forme fait **deux** choses, pas une : elle vise le serveur, **et** elle déclare une
infra de cache pour tout le framework. C'est ce qui bascule automatiquement les sessions et
l'idempotence sur Redis — détaillé plus bas.

### 3. Vérifier la cible réellement retenue

Après trois étages de superposition, la seule vérité est ce qui a été passé au client. Ce contrôleur
la rend lisible :

```ts
// nodefony/controllers/RedisTargetController.ts — complet, compile tel quel
import { Controller, controller, Get } from "@nodefony/framework";
import type { RedisService } from "@nodefony/redis";

@controller("/diagnostic/redis")
class RedisTargetController extends Controller {
  @Get("/cible")
  cible() {
    // Le service se résout par son NOM dans le conteneur — jamais par import.
    const redis = this.get<RedisService>("redis");
    const main = redis?.getConnection("main");
    // `options` = ce qui a RÉELLEMENT été remis au client pour cette connexion,
    // après défauts, configuration applicative, environnement et fusion.
    const socket = main?.options.socket as
      { host?: string; port?: number; tls?: boolean } | undefined;

    return this.renderJson({
      connexions: Object.keys(redis?.connections ?? {}),
      // On n'expose jamais l'URL : elle porte le mot de passe.
      viaUrl: Boolean(main?.options.url),
      hote: socket?.host ?? null,
      port: socket?.port ?? null,
      tls: socket?.tls === true,
      base: main?.options.database ?? null,
      ouverte: main?.connected ?? false,
    });
  }
}

export default RedisTargetController;
```

### 4. Ce qu'on observe

Au démarrage, chaque connexion annonce sa cible — le point d'entrée est journalisé avec les
identifiants masqués, par `Connection.#endpoint()` (`Connection.ts:70`) :

```
REDIS CONNECTION main       CONNECT 127.0.0.1:6379
REDIS CONNECTION publish    CONNECT 127.0.0.1:6379
REDIS CONNECTION subscribe  CONNECT 127.0.0.1:6379
REDIS CONNECTION cache      CONNECT 127.0.0.1:6379
```

Puis, à la demande :

```bash
curl -s http://127.0.0.1:5151/diagnostic/redis/cible
# {"connexions":["main","publish","subscribe","cache"],"viaUrl":false,
#  "hote":"127.0.0.1","port":6379,"tls":false,"base":0,"ouverte":true}
```

Quatre connexions, pas trois : la clé `cache` s'est **ajoutée** aux défauts au lieu de les remplacer.
C'est la fusion profonde du manifeste, et c'est le comportement voulu.

## ⚙️ Toutes les clés du schéma

Les défauts ci-dessous sont ceux du schéma, lus dans `redisConfigSchema` (`config.ts:200`). Une seule
valeur effective diffère du schéma au démarrage — `maxRetries`, traitée dans sa propre section.

### Racine

| Clé             | Type                     | Défaut                           | Effet                                                                                         |
| --------------- | ------------------------ | -------------------------------- | --------------------------------------------------------------------------------------------- |
| `enabled`       | booléen                  | `true`                           | `false` = module chargé mais inerte : aucune connexion ouverte, aucun socket.                 |
| `url`           | chaîne (secret)          | _absent_                         | URL complète `redis[s]://[[user][:pass]@]host[:port][/db]`. Prend le pas sur `globalOptions`. |
| `globalOptions` | objet                    | défauts de `globalOptionsSchema` | Options communes fusionnées dans **chaque** connexion.                                        |
| `connections`   | dictionnaire nom → objet | `main`, `publish`, `subscribe`   | Les connexions à ouvrir au démarrage.                                                         |
| `keyNamespace`  | chaîne                   | nom de l'application             | Cloison des **clés** par application sur un Redis mutualisé (cf ci-dessous).                  |

Le sous-objet `connections` est un dictionnaire libre : la clé est le nom logique, la valeur décrit la
connexion. Les trois entrées par défaut sont matérialisées dans `redisConfigSchema` (`config.ts:200`).

#### `keyNamespace` — deux applications sur un même Redis

Un serveur Redis se mutualise volontiers. La `database` donne l'illusion d'une séparation, mais elle
vaut `0` par défaut et n'isole rien de plus : deux applications y écrivent alors dans le même espace de
clés. Comme les clés portaient un nom fixe (`nf:sess:<id>`), l'écran Sessions de l'une **listait les
sessions de l'autre** — son balayage `nf:sess:*` ne pouvait pas les distinguer.

La cloison insère le nom de l'application dans le préfixe :

```
nf:boutique:sess:<id>      nf:boutique:tok:<id>      nf:boutique:wac:<id>
nf:intranet:sess:<id>      nf:intranet:tok:<id>      nf:intranet:wac:<id>
```

**Ce qu'elle sépare, et ce qu'elle ne sépare pas.** Elle sépare des _applications_, jamais les
instances d'une même application — c'est ce qui décide si une session survit au load-balancer :

|                              |                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------- |
| 10 pods de « boutique »      | **même** cloison → même espace de clés → une session ouverte via un pod est lue par tous les autres |
| « boutique » et « intranet » | cloisons **différentes** → espaces disjoints → aucune ne voit l'autre                               |

La cloison est dérivée de `kernel.projectName`, c'est-à-dire du nom de l'application **dans son code** :
tous ses pods calculent donc la même valeur. Le partage des sessions entre instances — la raison d'être
d'un store Redis — reste entier. Elle n'est surtout pas dérivée du nom d'hôte ou du PID : chaque pod
aurait son propre espace, et l'utilisateur serait déconnecté dès qu'une requête change de pod.

**Le cas à connaître** : deux _déploiements_ de la même application (préproduction et production)
portent le même nom, donc la même cloison. S'ils partagent un serveur Redis, posez-leur un
`keyNamespace` explicite — par la variable `NF_REDIS_KEY_NAMESPACE`, qui prend le pas sur la
configuration (une cloison distingue des environnements, elle n'a pas à être figée dans le code).

```ts
use("@nodefony/redis", { keyNamespace: "boutique-preprod" });
```

Une application seule sur son Redis n'a rien à cloisonner : sans cloison résolue, les préfixes
historiques (`nf:sess`, `nf:tok`, `nf:wac`) sont conservés tels quels.

### `globalOptions`

| Clé        | Type            | Défaut                    | Effet                                                                                                     |
| ---------- | --------------- | ------------------------- | --------------------------------------------------------------------------------------------------------- |
| `socket`   | objet           | défauts de `socketSchema` | Les options TCP/TLS communes.                                                                             |
| `username` | chaîne          | _absent_                  | Utilisateur ACL (Redis 6+). Absent avec un `password` présent = authentification héritée `requirepass`.   |
| `password` | chaîne (secret) | _absent_                  | Mot de passe. Marqué secret dans `globalOptionsSchema` (`config.ts:187`) → masqué là où il s'afficherait. |

`username` n'a **pas** de variable d'environnement dédiée : sur un serveur à ACL, il se pose dans la
configuration de l'application (il n'est pas secret par lui-même), ou dans l'URL.

### `globalOptions.socket`

| Clé                 | Type              | Défaut                               | Effet                                                                                             |
| ------------------- | ----------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `host`              | chaîne non vide   | `"localhost"`                        | Hôte du serveur. Jamais d'hôte d'infrastructure en dur dans le framework.                         |
| `port`              | entier `1..65535` | `6379`                               | Port TCP. Hors plage → la configuration est **refusée** au démarrage.                             |
| `family`            | `0` \| `4` \| `6` | `0`                                  | Famille IP pour la résolution DNS ; `0` laisse Node choisir. Utile quand une pile IPv6 traîne.    |
| `connectTimeout`    | entier > 0 (ms)   | `5000`                               | Délai maximal d'établissement du socket. Empêche un démarrage qui pend sur un serveur muet.       |
| `tls`               | booléen           | `false`                              | Chiffre le canal. Voir la limite de forme plus bas — c'est un drapeau, pas un jeu de certificats. |
| `reconnectStrategy` | objet             | défauts de `reconnectStrategySchema` | La politique de reconnexion, décrite juste après.                                                 |

Ces contraintes sont portées par `socketSchema` (`config.ts:79`) : ce sont elles qui font échouer le
démarrage plutôt que de laisser passer un port fantaisiste.

### `globalOptions.socket.reconnectStrategy`

| Clé          | Type       | Défaut du schéma | Effet                                                                                       |
| ------------ | ---------- | ---------------- | ------------------------------------------------------------------------------------------- |
| `baseMs`     | entier > 0 | `100`            | Pas du back-off linéaire : la n-ième tentative attend `n × baseMs`.                         |
| `maxMs`      | entier > 0 | `10000`          | Plafond de l'attente. Au-delà, les tentatives s'espacent d'un intervalle constant.          |
| `maxRetries` | entier ≥ 0 | `0`              | Nombre de tentatives avant abandon. `0` = illimité. **Valeur effective : voir ci-dessous.** |

Ces trois valeurs sont déclaratives ; elles sont converties en fonction par
`buildReconnectStrategy()` (`buildClientOptions.ts:13`) au moment d'assembler le client, parce qu'un
schéma Zod ne sait pas transporter une fonction.

### `connections.<nom>`

| Clé        | Type            | Défaut          | Effet                                                                                               |
| ---------- | --------------- | --------------- | --------------------------------------------------------------------------------------------------- |
| `name`     | chaîne non vide | **obligatoire** | Nom logique du client. Posé aussi côté serveur (`CLIENT SETNAME`) → visible dans `CLIENT LIST`.     |
| `database` | entier ≥ 0      | `0`             | Base Redis sélectionnée. **N'isole que les commandes clé-valeur** — le pub/sub ignore la base.      |
| `socket`   | objet partiel   | _absent_        | Surcharge du socket pour cette connexion seulement ; les champs omis restent ceux du socket global. |

`name` est le seul champ sans valeur d'usine dans tout le schéma (`connectionSchema` (`config.ts:143`)) :
une connexion sans nom serait invisible dans les journaux et côté serveur, on refuse donc de deviner.

### `connections.<nom>.socket` — la surcharge

Cinq champs, tous facultatifs et **tous sans défaut** : `host`, `port`, `family`, `connectTimeout`,
`tls`. C'est une décision de conception, portée par `socketOverrideSchema` (`config.ts:133`) : un
schéma partiel qui réappliquerait ses propres défauts écraserait silencieusement le socket global —
poser un `host` particulier ramènerait le port à `6379` sans le dire.

```ts ignore
// Une connexion d'archive sur une autre machine : SEUL l'hôte change.
connections: {
  archive: { name: "archive", database: 2, socket: { host: "redis-archive.interne" } },
}
// port, family, connectTimeout, tls, reconnexion → hérités du socket global.
```

## Variables d'environnement et ordre de précédence

### Les quatre variables lues

Toutes sont appliquées **après** la validation, par `applyEnvOverrides()`
(`defineModuleConfig.ts:23`).

| Variable                        | Ce qu'elle vise             | Comportement                                                                                        |
| ------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------- |
| `NF_REDIS_URL` (ou `REDIS_URL`) | `url`                       | Résolue par `resolveInfra()` (`infra.ts:134`) ; `NF_REDIS_URL` l'emporte sur l'alias de plateforme. |
| `REDIS_HOST`                    | `globalOptions.socket.host` | Posée telle quelle, sans validation supplémentaire.                                                 |
| `REDIS_PORT`                    | `globalOptions.socket.port` | **Ignorée en silence** si ce n'est pas un entier de `1` à `65535`.                                  |
| `REDIS_PASSWORD`                | `globalOptions.password`    | Le seul chemin recommandé pour le secret : jamais dans un fichier versionné.                        |

`REDIS_URL` est accepté comme **alias de plateforme** parce que c'est le nom que posent la plupart des
hébergeurs. Quand les deux existent, la variable préfixée gagne — le préfixe `NF_` sert précisément à
reprendre la main sur une variable imposée par l'environnement d'hébergement.

### L'ordre, prouvé par le code

`defineRedisConfig()` (`defineModuleConfig.ts:98`) exécute quatre gestes, toujours dans le même
ordre :

1. `redisConfigSchema.parse(entrée)` — les défauts comblent ce que l'application n'a pas dit, et la
   validation refuse ce qui est hors bornes.
2. `applyResilienceDefaults()` (`defineModuleConfig.ts:65`) — le garde-fou de reconnexion, qui
   inspecte l'entrée **brute** pour savoir si l'application s'est prononcée.
3. `applyEnvOverrides()` (`defineModuleConfig.ts:23`) — l'environnement écrase ce qu'il nomme.
4. `Object.freeze` — plus rien ne bouge.

D'où la règle, dans cet ordre croissant d'autorité : **défauts du schéma → configuration de
l'application → environnement**. Le comportement est verrouillé par les tests unitaires
(`config.test.ts:56` pour l'hôte, le port et le mot de passe ; `config.test.ts:72` pour le port
invalide ignoré).

> [!IMPORTANT]
> L'environnement gagne **même contre une valeur explicite de l'application**. Une `url` écrite dans
> `use("@nodefony/redis", { url: … })` est remplacée dès qu'une URL d'infra est présente dans
> l'environnement. C'est voulu — l'exploitant doit pouvoir déplacer une application sans la
> recompiler — mais c'est aussi la première cause de « ma configuration est ignorée ».

Un cinquième geste vient plus tard, à l'ouverture de chaque connexion : la précédence **`url` ▸ socket
de la connexion ▸ socket global**, tranchée par `buildClientOptions()` (`buildClientOptions.ts:45`)
et prouvée par `config.test.ts:128`.

### Le double effet de l'URL d'infra

`NF_REDIS_URL` n'est pas seulement la cible de ce module : c'est la déclaration d'une **infra de
cache** pour le framework entier. `resolveAutoStore()` (`infra.ts:241`) s'en sert pour les briques
dont le store vaut `auto` :

| Brique                    | Nature de la donnée | Avec une infra de cache déclarée |
| ------------------------- | ------------------- | -------------------------------- |
| Sessions                  | `session`           | ✅ bascule sur Redis toute seule |
| Idempotence               | `ephemeral`         | ✅ bascule sur Redis toute seule |
| Jetons, passkeys          | `durable`           | ❌ jamais — il faut le demander  |
| Identité, audit, webhooks | `durable`           | ❌ jamais — pas de version Redis |

Le raisonnement du framework : ce qui est périssable va au magasin périssable, ce qui est durable
reste dans la base de vérité. Un choix **explicite** l'emporte toujours sur cette résolution
automatique — `use("@nodefony/http", { session: { store: "redis" } })` se comporte pareil quelle que
soit l'infra déclarée, ce qui est exactement ce qu'on veut quand développement et production doivent
se ressembler.

Le store retenu et **sa raison** sont journalisés au démarrage et affichés dans Studio : on ne devine
jamais où les sessions ont atterri. Le comparatif transverse vit dans
[choisir un store de sessions](../../../../../docs/guides/session-storage.md).

### Quand une URL est posée, ce qui devient sans effet

Dès que `url` est renseignée — par l'application ou par l'environnement — `buildClientOptions()`
(`buildClientOptions.ts:68`) **ne pose plus** `socket.host` ni `socket.port` : ils entreraient en
conflit avec ceux de l'URL. Trois conséquences à connaître :

| Réglage                                                    | Avec une `url` présente                                                                 |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `socket.host` / `socket.port`, `REDIS_HOST` / `REDIS_PORT` | **sans effet** — l'adresse vient de l'URL                                               |
| `socket.tls`                                               | **sans effet** — c'est le protocole (`redis://` ou `rediss://`) qui décide              |
| `connections.<nom>.database`                               | **écrasé** si l'URL porte un chemin (`…:6379/2`) — toutes les connexions sur cette base |
| `REDIS_PASSWORD`                                           | conservé **seulement** si l'URL ne porte pas de mot de passe                            |
| `reconnectStrategy`                                        | conservé dans tous les cas — c'est la seule option de socket transmise avec l'URL       |

Les trois dernières lignes viennent de la bibliothèque `redis` elle-même : à la construction du
client, les valeurs extraites de l'URL sont recopiées **par-dessus** les options fournies. Une URL
n'est donc pas un raccourci pour « hôte et port », c'est une **source qui prend la main**.

> [!WARNING]
> Le cas coûteux est celui de la base : `NF_REDIS_URL=redis://…/2` annule le cloisonnement `database`
> de **toutes** les connexions nommées, sans un mot. Sur une instance mutualisée, préférez déclarer
> l'URL sans chemin et laisser chaque connexion choisir sa base — ou accepter une base unique, en le
> sachant.

## Reconnexion — le défaut effectif n'est pas celui du schéma

C'est la seule clé du module dont la valeur d'usine dépend de l'environnement d'exécution, et elle
mérite qu'on s'y arrête.

**Le schéma dit `0` — illimité.** C'est le réglage juste **en production** : un orchestrateur relèvera
le serveur Redis, et le client doit patienter aussi longtemps qu'il faut plutôt que d'abandonner
définitivement.

**Hors production, ce réglage fait pendre le démarrage.** Avec des tentatives illimitées, la première
ouverture ne rend jamais la main tant que Redis ne répond pas ; la file d'attente hors ligne du client
retient les commandes, et un démarrage sans serveur se transforme en attente infinie plutôt qu'en
échec lisible. D'où `applyResilienceDefaults()` (`defineModuleConfig.ts:65`), qui borne les tentatives
à `DEV_DEFAULT_MAX_RETRIES` (`defineModuleConfig.ts:45`) — cinq — quand, et seulement quand,
l'application ne s'est pas prononcée.

| `NODE_ENV`                          | L'application fixe `maxRetries` ? | Valeur effective                    |
| ----------------------------------- | --------------------------------- | ----------------------------------- |
| `production`                        | non                               | `0` — illimité                      |
| `production`                        | oui                               | celle de l'application              |
| autre (développement, test, absent) | non                               | **`5`** — abandon après cinq essais |
| autre                               | oui, même `0`                     | celle de l'application              |

La distinction « fixé / non fixé » se lit sur l'**entrée brute** de l'application, avant le parcours du
schéma : une fois les défauts appliqués, un `0` d'usine serait indiscernable d'un `0` voulu. Les trois
branches sont couvertes par les tests (`config.test.ts:85`, `config.test.ts:91`, `config.test.ts:99`).

**Le calcul du délai.** `buildReconnectStrategy()` (`buildClientOptions.ts:13`) rend
`min((tentative + 1) × baseMs, maxMs)`, et une erreur — donc l'abandon — dès que le nombre de
tentatives atteint `maxRetries`, si celui-ci est fini. Avec les valeurs d'usine, hors production :

| Tentative | 1      | 2      | 3      | 4      | 5      | 6                |
| --------- | ------ | ------ | ------ | ------ | ------ | ---------------- |
| Attente   | 100 ms | 200 ms | 300 ms | 400 ms | 500 ms | abandon (erreur) |

Soit environ une seconde et demie avant de conclure — assez court pour un aller-retour de développement,
assez long pour absorber un redémarrage de conteneur.

> [!CAUTION]
> Le JSON Schema publié pour Studio est produit à partir du schéma seul : il annonce donc
> `maxRetries: 0`, y compris hors production où la valeur réellement chargée est `5`. Le formulaire
> décrit le schéma, pas la superposition. Pour connaître la valeur en vigueur, lisez la configuration
> effective du service, pas le formulaire.

## Les connexions — trois par défaut, autant qu'on veut

Le défaut ouvre **trois** clients : `main` pour les commandes clé-valeur, `publish` pour l'émission,
`subscribe` pour l'écoute. Ce n'est pas une précaution, c'est une contrainte du protocole : un client
abonné ne peut plus émettre de commandes normales. Une connexion unique rendrait le temps réel et le
stockage mutuellement exclusifs.

Ajouter une connexion se fait en nommant une nouvelle clé. La fusion du manifeste est **profonde** —
`loadModulesFromManifest()` (`Kernel.ts:1149`) fusionne la configuration de `use()` sous les défauts
déjà matérialisés du module — donc les trois connexions d'usine restent en place :

```ts ignore
use("@nodefony/redis", {
  connections: {
    cache: { name: "cache", database: 1 },
    archive: { name: "archive", database: 2 },
  },
});
// Résultat au démarrage : main, publish, subscribe, cache, archive — cinq clients.
```

Chaque connexion coûte un socket et un client par process ; en multi-process, multipliez. C'est la
contrepartie assumée de la séparation imposée par le protocole.

> [!NOTE]
> Le pub/sub Redis est **global au serveur** : il ignore complètement le numéro de base. Le champ
> `database` cloisonne les commandes clé-valeur, jamais les messages. Deux applications qui partagent
> une instance ont besoin d'un espace de noms de canal, pas d'une base différente — voir
> [Architecture interne](./architecture.md).

## Situations de déploiement

Six situations couvrent l'essentiel. Le tableau pour choisir, les fiches pour la configuration exacte.

| Situation                 | Ce qui la caractérise                          | Ce qu'on écrit                                |
| ------------------------- | ---------------------------------------------- | --------------------------------------------- |
| Développement local       | Redis dans un conteneur, sur la boucle locale  | rien, ou l'hôte ; le mot de passe en variable |
| Application conteneurisée | Redis est un service voisin, joint par son nom | l'hôte = le nom du service                    |
| Service managé chiffré    | une URL `rediss://` fournie par l'hébergeur    | rien : tout est dans l'URL                    |
| Orchestrateur             | l'URL vient d'un secret monté à l'exécution    | rien : la variable est injectée               |
| Intégration continue      | pas de serveur Redis du tout                   | `enabled: false`, ou rien du tout             |
| Cluster ou Sentinel       | plusieurs nœuds, redirections de partition     | **non pris en charge** — lire la fiche        |

### `developpement-local` — Redis dans un conteneur

Le serveur de développement du dépôt tourne avec authentification, sur la boucle locale uniquement, en
politique mémoire `noeviction`. Il n'y a **rien** à écrire dans la configuration : les défauts du
schéma visent déjà `localhost:6379`. Une seule variable est nécessaire.

```bash
docker compose -f docker/docker-compose.yml up -d redis
export REDIS_PASSWORD=nodefony-dev
```

L'authentification est exigée **même en développement** : une instance sans mot de passe habitue à un
réglage qui n'existe nulle part ailleurs, et masque les erreurs `NOAUTH` jusqu'à la mise en production.

### `conteneur` — Redis est un service voisin

Dans une composition de conteneurs, le serveur n'est plus sur la boucle locale : il porte le nom du
service dans le réseau. C'est le seul champ à changer.

```ts ignore
use("@nodefony/redis", {
  globalOptions: { socket: { host: "redis", port: 6379 } },
});
```

Le mot de passe reste une variable d'environnement du conteneur applicatif. Si la composition fournit
déjà une URL complète, ne configurez rien : posez `NF_REDIS_URL` et laissez le module la suivre.

### `manage-tls` — un service Redis managé, chiffré

Les hébergeurs ne donnent en général qu'une URL, qui porte l'hôte, le port, les identifiants et le
protocole. Le protocole `rediss://` suffit à activer le chiffrement : le drapeau `socket.tls` est
inutile, et sans effet, dès qu'une URL est présente.

```bash
export NF_REDIS_URL=rediss://default:LE_JETON@eu1-xxxx.exemple-managed.io:6380
```

Aucune ligne dans `nodefony.config.ts`. Le mot de passe voyage dans l'URL : traitez-la comme un
secret entier, jamais comme une adresse.

**La limite de forme à connaître** : le schéma n'expose qu'un **booléen** `tls`
(`socketSchema` (`config.ts:114`)). Autorité de certification privée, certificat client, nom de
serveur explicite — rien de tout cela n'est exprimable. Un service managé à certificat public
fonctionne ; une authentification mutuelle par certificat n'est pas couverte par la configuration du
module.

### `orchestrateur` — l'URL vient d'un secret

En orchestration, la cible n'est pas connue à la construction de l'image : elle est injectée à
l'exécution. Le modèle d'infra déclarée est fait pour ça — l'image ne contient aucune adresse, la
variable arrive du magasin de secrets.

```bash
# Injecté par l'orchestrateur, jamais présent dans l'image.
NF_REDIS_URL=redis://:$(cat /run/secrets/redis-password)@redis.production.svc:6379
```

En production, laissez `maxRetries` à son défaut : les tentatives illimitées sont le bon réglage
quand un superviseur externe relève le serveur. Fixer une valeur finie ferait abandonner
définitivement un client qui aurait suffi d'attendre.

### `integration-continue` — sans serveur Redis

Deux réponses, selon l'intention.

**Ne pas charger Redis du tout** : retirer le module du manifeste. C'est le plus propre quand aucune
brique n'en dépend.

**Le charger, inerte** : `enabled: false` (`redisConfigSchema` (`config.ts:202`)) laisse le module en
place sans ouvrir un seul socket. Utile quand le manifeste est commun à plusieurs environnements.

```ts ignore
use("@nodefony/redis", { enabled: false });
```

> [!WARNING]
> `enabled: false` n'annule **pas** la sélection des stores. Une brique explicitement configurée sur
> `redis` reste branchée sur un service sans connexion : les fabriques sont enregistrées, mais aucun
> client n'existe. Désactiver le module suppose donc de ne pas avoir nommé `redis` ailleurs.

### `cluster-sentinel` — ce qui n'est pas couvert

Le module construit ses clients avec la fabrique **client simple** de la bibliothèque `redis` —
`buildClientOptions()` (`buildClientOptions.ts:45`) produit des options de client, pas de grappe. Ni
Redis Cluster (répartition par partitions, redirections `MOVED`/`ASK`), ni Sentinel (élection du
maître) ne sont exprimables dans le schéma.

Ce que cela laisse comme options :

- un service managé qui expose un **point d'entrée unique** et masque sa topologie — le cas le plus
  courant, et il fonctionne tel quel ;
- un mandataire (proxy) devant la grappe, vu du module comme un serveur ordinaire ;
- une instance simple avec réplication, en acceptant sa disponibilité.

Mieux vaut le savoir en concevant l'infrastructure qu'en la déployant.

## Quand la connexion échoue au démarrage

Deux échecs très différents partagent le même symptôme apparent — « Redis ne marche pas » — et se
règlent à des endroits opposés.

**La configuration est invalide.** `Redis.onKernelRegister()` (`index.ts:54`) valide avant tout le
reste et refuse de démarrer sur une valeur hors bornes. Le message nomme le champ fautif
(`index.ts:68`) :

```
[@nodefony/redis] Invalid config: globalOptions.socket.port: Too big: expected number to be <=65535
```

C'est un défaut de configuration : rien à chercher côté réseau.

**Le serveur ne répond pas.** La configuration est bonne, l'ouverture échoue. Le module est déclaré
**non critique** — `Redis.critical` (`index.ts:36`) vaut `false` — donc l'application démarre quand
même, en état dégradé annoncé. Chaque connexion est tentée indépendamment et journalisée en `ERROR`
par `RedisService.init()` (`redis.ts:123`) : une connexion en échec n'empêche pas les suivantes.

Ce que ce démarrage dégradé implique côté appelants — pourquoi le garde `if (!client)` des stores ne
suffit pas après une ouverture ratée, ce que devient une commande pendant une reconnexion — est
détaillé dans [Architecture interne](./architecture.md), section « Résilience ». C'est la lecture à
faire avant une mise en production.

## ⚠️ Pièges

| Symptôme                                                                | Cause                                                                                                        | Correction                                                                                                                 |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Une clé de configuration n'a aucun effet, aucune erreur                 | Clé inconnue du schéma : la validation Zod **écarte** les clés qu'elle ne connaît pas                        | Vérifier l'orthographe dans les tables ci-dessus ; contrôler la cible effective (§ Démarrage rapide)                       |
| L'hôte configuré est ignoré                                             | Une `url` est présente — `buildClientOptions()` (`buildClientOptions.ts:68`) ne pose plus host/port          | Retirer `NF_REDIS_URL`/`REDIS_URL`, ou tout mettre dans l'URL                                                              |
| `REDIS_PORT` semble sans effet                                          | Valeur non entière ou hors `1..65535` : `applyEnvOverrides()` (`defineModuleConfig.ts:32`) l'ignore          | Corriger la valeur — l'ignorance est silencieuse par conception                                                            |
| Toutes les connexions atterrissent sur la même base                     | L'URL porte un chemin (`…/2`) qui écrase le `database` de chaque connexion                                   | Déclarer l'URL sans chemin et laisser `database` cloisonner                                                                |
| Le démarrage pend, sans erreur, sans Redis                              | Tentatives illimitées : la première ouverture ne rend pas la main                                            | Hors production c'est déjà borné (`applyResilienceDefaults()` (`defineModuleConfig.ts:65`)) ; sinon fixer une valeur finie |
| Erreur `NOAUTH` alors que le mot de passe est configuré                 | L'URL porte des identifiants qui recouvrent `REDIS_PASSWORD`                                                 | Ne pas mélanger : l'URL **ou** hôte + mot de passe                                                                         |
| Les sessions ont changé de magasin sans qu'on touche à la configuration | `NF_REDIS_URL` déclare une infra de cache → `resolveAutoStore()` (`infra.ts:241`) bascule les briques `auto` | Nommer le store explicitement pour un comportement identique partout                                                       |
| Une surcharge de connexion ramène le port à `6379`                      | Un schéma partiel qui réappliquerait ses défauts — d'où `socketOverrideSchema` (`config.ts:133`) sans défaut | Ne poser que les champs voulus ; les autres héritent du socket global                                                      |
| Le module démarre mais n'ouvre rien                                     | `enabled: false` — module chargé, inerte (`RedisService.init()` (`redis.ts:123`))                            | Le réactiver, ou retirer le module du manifeste                                                                            |
| Le formulaire Studio annonce `maxRetries: 0` en développement           | Le JSON Schema décrit le schéma, pas la superposition d'exécution                                            | Lire la configuration effective du service                                                                                 |
| Une valeur changée à chaud ne prend pas                                 | La configuration est **gelée** après le démarrage (`defineRedisConfig()` (`defineModuleConfig.ts:103`))      | Redémarrer le process                                                                                                      |
| L'auto-complétion ne propose aucune clé dans `use()`                    | Le module ne s'inscrit pas au registre de types des configurations de modules                                | S'appuyer sur les tables de cette page ; une clé fautive ne sera pas signalée à la compilation                             |

## 📡 Observabilité — Studio

- **Carte du module** (`/nodefony/modules/redis`) : la configuration validée, rendue par un formulaire
  **dérivé** du JSON Schema que publie `Redis.configSchema()` (`index.ts:43`). Les champs marqués
  secrets — `url`, `password` — y sont masqués par construction, pas par une liste d'exclusion tenue
  à la main.
- **Écran Stores** (`/nodefony/stores`) : pour chaque brique, le store réellement retenu au démarrage
  **et la raison** (« infra cache », choix explicite). C'est là qu'on vérifie l'effet d'une
  `NF_REDIS_URL` sur les sessions et l'idempotence, sans relire une configuration.
- **Journal de démarrage** : une ligne par connexion, avec le point d'entrée et les identifiants
  masqués.

Le module n'expose pas de plan de données propre : il n'a ni état métier ni introspection spécifique,
et ce qui compte de lui est déjà surfacé par les écrans transverses.

## 🧪 Tests & couverture

Les compteurs sont régénérés depuis vitest et vivent dans la carte de l'aperçu — jamais figés dans
cette prose. Ce qui doit être dit ici, c'est **ce que la configuration a de prouvé**.

| Ce qui est vérifié                           | Où                                                                          |
| -------------------------------------------- | --------------------------------------------------------------------------- |
| Défauts d'usine et sous-défauts              | `config.test.ts:15` (hôte, port, TLS, trois connexions)                     |
| Refus d'une valeur hors bornes               | `config.test.ts:38` (port hors plage)                                       |
| Superposition de l'environnement             | `config.test.ts:56` et `config.test.ts:66`                                  |
| Port d'environnement invalide ignoré         | `config.test.ts:72`                                                         |
| Garde-fou de reconnexion, ses trois branches | `config.test.ts:85`, `config.test.ts:91`, `config.test.ts:99`               |
| Gel de la configuration                      | `config.test.ts:51`                                                         |
| Assemblage des options du client             | `config.test.ts:107` (fusion) et `config.test.ts:128` (précédence de l'URL) |
| Back-off et abandon                          | `config.test.ts:139`                                                        |

Ces bancs sont **unitaires** : ils tournent sans serveur. La configuration est donc la partie du
module dont la vérification ne dépend d'aucune infrastructure — c'est aussi pour ça que le schéma doit
rester pur.

> [!IMPORTANT]
> **Une suite verte ne prouve rien du reste sans serveur Redis.** Les bancs d'intégration se
> **skippent** quand l'infra manque, et un skip compte comme un succès : on peut lire « tout est
> vert » sur une suite qui n'a rien exercé. La gate du module est déclarée une seule fois —
> `REDIS_GATE` (`vitest.gates.ts:290`) — et la fin de run nomme la cible non exercée avec la commande
> exacte pour la satisfaire. **Les variables et la commande docker se lisent là, pas ici** : les
> recopier dans cette page les condamnerait à diverger.

Couverture : `npm run coverage` dans `@nodefony/redis`.

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [@nodefony/redis — vue d'ensemble](index.md) · [Toute la documentation](../../../../../docs/index.md)
- 🧭 **Page sœur** : [Architecture interne](./architecture.md) — connexions, résilience, structures de
  données, et ce qui se passe quand Redis tombe
- 🧩 **Les briques qui consomment cette configuration** : [sessions](../../http/docs/session.md) ·
  [jetons](../../security/docs/tokens.md) · [passkeys](../../security/docs/webauthn.md) ·
  [idempotence](../../framework/docs/idempotence.md)
- ⚙️ **Configurer une application Nodefony** : [le guide `defineConfig`](../../../../../docs/guides/configuration.md) ·
  [déclarer son infra](../../../../../docs/guides/persistence.md) ·
  [choisir un store de sessions](../../../../../docs/guides/session-storage.md)
- 📡 **Le temps réel cross-pod** : [choisir son driver de backplane](../../realtime/docs/configuration.md)
- 🗄️ **Le durable, à côté** : [`@nodefony/drizzle`](../../drizzle/docs/index.md) ·
  [`@nodefony/mongoose`](../../mongoose/docs/index.md)
- 🗺️ **Se situer** : [vue d'ensemble du framework](../../../../../docs/architecture/vue-ensemble.md) ·
  [lexique général](../../../../../docs/lexique.md)
