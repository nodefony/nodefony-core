---
title: "Configuration — brancher MongoDB"
lang: fr
module: "@nodefony/mongoose"
topic: mongoose
section: "Données"
audience: [developer]
tags:
  [
    configuration,
    zod,
    connecteurs,
    uri,
    environnement,
    infra,
    atlas,
    replica-set,
    secrets,
  ]
version: "doc"
status: stable
updated: 2026-07-19
source: "src/packages/@nodefony/mongoose/docs/configuration.md"
coverageModule: mongoose
coverageFiles: config.ts,defineModuleConfig.ts,MongooseService.ts
---

# Configuration — brancher MongoDB

> Trois clés, pas une de plus : **quelles bases** tu ouvres (`connectors`), **si tu traces** les
> requêtes (`debug`), et **si le module pose le schéma du framework** (`frameworkEntities`). Tout le
> reste — l'adresse réelle, le mot de passe, le pool — arrive par l'**environnement**, jamais par le
> dépôt. Cette page dit d'où vient chaque valeur, dans quel ordre, et ce que fait le serveur quand la
> base ne répond pas au démarrage.

📍 [Documentation](../../../../../docs/index.md) › [MongoDB (Mongoose)](./index.md) › **Configuration**

## 🧠 Le schéma général — d'où vient chaque valeur

Une valeur de configuration traverse **six étapes** avant d'ouvrir une connexion. Chaque étape peut
écraser la précédente ; la dernière gèle le résultat.

```mermaid
flowchart TD
  D["1 · Défauts d'usine<br/>schéma Zod du module"] --> U["2 · Ta config d'app<br/>use('@nodefony/mongoose', …)"]
  U --> O["3 · Override d'un autre module<br/>clé module-mongoose"]
  O --> E["4 · Env générique<br/>NF__MONGOOSE__…"]
  E --> Z["5 · Validation Zod<br/>types, bornes, défauts manquants"]
  Z --> V["6 · Env du driver<br/>MONGODB_URI · NF_DATABASE_URL · NF_MONGODB_DEBUG"]
  V --> F["Object.freeze<br/>config immuable"]
  F --> S["MongooseService<br/>1 connexion par connecteur"]
  S --> DB[("MongoDB")]

  Z -. config invalide .-> KO["Boot interrompu<br/>message de champ précis"]
```

Deux choses se lisent sur ce schéma, et elles expliquent presque tous les comportements de la page :

- **La validation est au milieu, pas à la fin.** Ce que tu écris dans `use()` et ce que tu poses par
  `NF__MONGOOSE__…` passent devant le contrôleur ; l'URI du driver, elle, est appliquée **après** —
  elle n'est donc pas re-validée, mais elle gagne toujours.
- **La configuration est gelée** avant d'atteindre le service. Personne ne la modifie à chaud : ni un
  module, ni un controller, ni Studio.

## 📖 Lexique

| Terme                 | Sens                                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Connecteur            | Une connexion **nommée** déclarée en config. Sa clé devient le nom de l'ORM (`ormRegistry.get("nodefony")`).               |
| URI de connexion      | L'adresse complète d'une base Mongo : `mongodb://hôte:port/base` ou `mongodb+srv://…` (forme DNS des services managés).    |
| `mongodb+srv`         | Variante d'URI qui résout la liste des serveurs par un enregistrement DNS — la forme employée par MongoDB Atlas.           |
| Replica set           | Un groupe de serveurs Mongo répliqués. **Obligatoire** pour les transactions.                                              |
| Schéma Zod            | La description exécutable de la config : types, bornes, valeurs par défaut, texte d'aide. C'est **la** source de vérité.   |
| JSON Schema           | Le format standard dans lequel le schéma Zod est publié, pour qu'un outil (Studio) sache dessiner un formulaire d'édition. |
| `ConnectOptions`      | Les options de connexion propres à Mongoose (pool, délais, TLS, identifiants) — validées par Mongoose, pas par Nodefony.   |
| Infra déclarée        | Le modèle « une URL par service » (`NF_DATABASE_URL`, `NF_REDIS_URL`) : tu décris ton infrastructure, pas chaque brique.   |
| Store (brique)        | L'implémentation d'une brique du framework — session, jetons, passkeys, webhooks — sur un backend donné.                   |
| Sentinelle `auto`     | La valeur par défaut d'un champ `store` : « choisis pour moi, selon l'infra que j'ai déclarée ».                           |
| Fail-soft / fail-loud | Continuer en signalant (fail-soft) ou s'arrêter franchement (fail-loud). Nodefony choisit selon la nature de l'erreur.     |

## ❓ Qu'est-ce que c'est ?

Configurer un module, dans Nodefony, ce n'est pas remplir un fichier de réglages : c'est **écrire tes
écarts** par rapport à des défauts qui marchent déjà. Un module démarre sans que tu écrives quoi que
ce soit — `@nodefony/mongoose` ouvre alors `localhost:27017/nodefony`. Tu ne touches à la config que
là où ta réalité diffère.

Ces défauts ne sont pas cachés dans du code : ils vivent dans un **schéma** unique, où chaque champ
porte son type, ses bornes, sa valeur d'usine et sa raison d'être. Le schéma sert trois publics d'un
seul geste : il **valide** ta config au démarrage, il **documente** chaque clé, et il se publie en
JSON Schema pour qu'un formulaire puisse être dessiné sans qu'on redécrive quoi que ce soit.

Le mot d'ordre : **rien de secret dans le dépôt**. Ton `nodefony.config.ts` décrit la forme —
« il y a une base, elle s'appelle comme ça » — et l'environnement fournit l'adresse et les
identifiants réels. C'est ce qui permet au même code de tourner sur ta machine et dans un conteneur
sans qu'une seule ligne change.

## 🧭 La vision Nodefony — deux fichiers, deux rôles

La convention du framework fige **exactement deux fichiers** de configuration par module, portant les
mêmes noms partout — pour qu'on ne se pose jamais la question de savoir où regarder.

| Fichier                                 | Son rôle       | Ce qu'on y trouve                                                              |
| --------------------------------------- | -------------- | ------------------------------------------------------------------------------ |
| `nodefony/config/config.ts`             | **Le QUOI**    | Le schéma Zod commenté, source unique des défauts, et le type TS qui en dérive |
| `nodefony/config/defineModuleConfig.ts` | **Le COMMENT** | Le builder : valide → applique l'environnement → gèle. Plus le JSON Schema.    |

Le schéma (`mongooseConfigSchema` (`config.ts:83`)) porte les valeurs d'usine sous forme de
`.default(…)`, et chaque champ son `.describe(…)`. Les défauts effectifs du module ne sont pas
retapés à la main : ils sont **matérialisés depuis le schéma lui-même**
(`mongooseConfigSchema.parse({})` (`config.ts:122`)). Changer un défaut = changer le `.default()`,
et nulle part ailleurs. Le type TypeScript suit le même chemin : `MongooseConfig` (`config.ts:116`)
est **inféré** du schéma, jamais redéclaré.

Le builder (`defineMongooseConfig()` (`defineModuleConfig.ts:61`)) tient en trois gestes — valider,
surcharger par l'environnement, geler — et **ne réécrit jamais un défaut**. Il ne connaît pas les
valeurs : il ne connaît que le schéma.

> [!IMPORTANT]
> **Le schéma reste pur : aucune lecture de `process.env` dedans.** C'est ce qui le rend
> déterministe, testable sans serveur, et publiable en JSON Schema. Toute la lecture d'environnement
> est concentrée dans une seule fonction, en aval (`applyEnvOverrides()` (`defineModuleConfig.ts:22`)).
> Un schéma qui lirait l'environnement produirait une documentation différente selon la machine — et
> un formulaire Studio qui mentirait.

### Où mongoose s'écarte de la référence

`@nodefony/drizzle` est l'adapter de référence pour cette convention. Sur la **structure**, mongoose
s'y conforme entièrement : deux fichiers aux noms canoniques, schéma pur, builder qui ne retape aucun
défaut, fonction préfixée par le module (`defineMongooseConfig`, jamais un `defineConfig` générique
qui collisionnerait à l'import). Trois écarts réels, tous **assumés et vérifiables** :

1. **Le connecteur par défaut s'appelle `nodefony`, pas `default`.** Drizzle nomme le sien `default`.
   Ce n'est pas de la fantaisie : les entités sont indexées par `(connecteur, nom)` dans un registre
   **global au processus**, donc deux drivers avec le même nom de connecteur feraient collision sur
   leurs entités `session` homonymes. Un nom distinct règle le problème par construction
   (`FRAMEWORK_CONNECTOR` (`registerStores.ts:49`)).
2. **Mongoose expose deux variables dédiées** (`MONGODB_URI`, `NF_MONGODB_DEBUG`) là où Drizzle ne lit
   que l'infra déclarée. C'est un héritage de convention du driver Mongo, conservé parce qu'il est
   universellement connu — mais l'infra déclarée reste le chemin recommandé.
3. **`options` n'est pas re-modélisé** (`options` (`config.ts:71`)) : c'est un dictionnaire libre
   passé tel quel à Mongoose. Re-décrire les dizaines de `ConnectOptions` en Zod produirait une
   deuxième vérité, condamnée à diverger de la bibliothèque à chaque version. Le prix à payer est
   assumé : une faute de frappe dans `options` n'est pas attrapée par Zod, elle l'est par Mongoose
   au moment de la connexion.

## 🚀 Démarrage rapide

Vu d'une application créée par `nodefony create app`. Trois configurations, de la plus simple à la
plus complète — chacune est un fichier entier, copiable tel quel.

### 1. Ma base tourne sur ma machine

Le cas du développement : un `mongod` local, une base à moi.

```typescript
// nodefony.config.ts — le manifeste des modules de l'application
export default defineConfig(() => ({
  modules: [
    // Le driver AVANT les modules qui consomment ses stores : les fabriques de
    // store exigent un ORM DÉJÀ connecté au moment où elles se montent.
    use("@nodefony/mongoose", {
      connectors: {
        // `nodefony` = le connecteur par défaut du module (≠ `default` de Drizzle).
        nodefony: { host: "127.0.0.1", port: 27017, dbname: "blog" },
      },
    }),
    "@nodefony/http",
    "@nodefony/framework",
  ],
}));
```

Au démarrage, le journal confirme la cible — **sans jamais les identifiants** :

```
INFO  mongoose  Mongoose ORM "nodefony" connected (127.0.0.1:27017/blog)
```

### 2. La même application, en production

Rien ne change dans le fichier : c'est l'environnement qui parle. Tu peux même **ne rien déclarer du
tout** — les défauts suffisent à décrire la forme, l'URI viendra du dehors.

```typescript
// nodefony.config.ts — aucune adresse en dur, aucun secret dans le dépôt
export default defineConfig((ctx) => ({
  modules: [
    use("@nodefony/mongoose", {
      // En développement seulement : trace chaque opération Mongoose.
      // (`NF_MONGODB_DEBUG=1` fait la même chose sans toucher au fichier.)
      debug: ctx.isDev,
    }),
    "@nodefony/http",
    "@nodefony/framework",
  ],
}));
```

```bash
# L'adresse ET le secret arrivent par l'environnement, jamais par le dépôt.
export NF_DATABASE_URL='mongodb+srv://app:********@cluster0.exemple.mongodb.net/prod'
node dist/index.js
```

> [!TIP]
> Préfère `NF_DATABASE_URL` à `MONGODB_URI` : c'est **la** variable d'infrastructure du framework.
> Elle sert du même coup à résoudre les briques laissées en `auto` — sessions, jetons, passkeys se
> posent alors d'elles-mêmes sur Mongo. Une variable, deux effets cohérents.

### 3. Brancher les briques du framework

Une fois le driver chargé, les stores Mongo sont **sélectionnables par leur nom**, sans aucun câblage :
le module les enregistre lui-même à son démarrage.

```typescript
// nodefony.config.ts — sessions, jetons, passkeys et webhooks dans Mongo
export default defineConfig(() => ({
  modules: [
    use("@nodefony/mongoose", {
      connectors: { nodefony: { uri: "mongodb://127.0.0.1:27017/app" } },
    }),
    use("@nodefony/http", { session: { store: "mongoose" } }),
    use("@nodefony/security", {
      tokenStore: { store: "mongoose" },
      passkeys: { store: "mongoose" },
      webhooks: { store: "mongoose" },
    }),
    "@nodefony/framework",
  ],
}));
```

Si `NF_DATABASE_URL` pointe déjà sur du `mongodb://`, tu peux laisser **tous** ces champs sur leur
défaut `auto` : la résolution suit l'infra déclarée (`resolveAutoStore()` (`infra.ts:241`)) et
journalise sa raison. Détail dans le hub, section
[Ce qui se passe quand tu ne choisis rien](./index.md#ce-qui-se-passe-quand-tu-ne-choisis-rien).

## ⚙️ Toutes les clés

Trois clés à la racine. Les défauts ci-dessous sont ceux du schéma, relus au code — pas une copie de
mémoire.

| Clé                 | Type                          | Défaut                                  | Effet                                                                     |
| ------------------- | ----------------------------- | --------------------------------------- | ------------------------------------------------------------------------- |
| `connectors`        | dictionnaire nom → connecteur | `nodefony` → `localhost:27017/nodefony` | Une connexion ouverte au boot par entrée ; la clé devient le nom de l'ORM |
| `debug`             | `boolean`                     | `false`                                 | Trace **toutes** les opérations Mongoose du processus                     |
| `frameworkEntities` | `boolean`                     | `true`                                  | Déclare le schéma du framework et rend ses stores sélectionnables         |

Et six champs par connecteur :

| Champ       | Type                  | Défaut        | Effet                                                                    |
| ----------- | --------------------- | ------------- | ------------------------------------------------------------------------ |
| `uri`       | `string` non vide     | _aucun_       | Adresse complète. **Prime** sur `host`/`port`/`dbname`, qui sont ignorés |
| `host`      | `string` non vide     | `"localhost"` | Hôte du serveur. Ignoré si `uri` est fourni                              |
| `port`      | entier, **1 à 65535** | `27017`       | Port TCP. Ignoré si `uri` est fourni                                     |
| `dbname`    | `string` non vide     | `"nodefony"`  | Nom de la base. Ignoré si `uri` est fourni                               |
| `autoIndex` | `boolean`             | _aucun_       | Construire les index au démarrage. Voir « Les index » ci-dessous         |
| `options`   | dictionnaire libre    | _aucun_       | `ConnectOptions` Mongoose : pool, délais, TLS, identifiants              |

### `connectors` — une ou plusieurs bases

Chaque entrée de `connectors` (`config.ts:93`) devient une **connexion isolée** ouverte au démarrage,
puis un ORM inscrit sous ce nom. Deux entrées = deux connexions, deux ORM, deux jeux d'entités : c'est
ainsi qu'une application lit une base métier et écrit dans une base d'archives sans les mélanger.

L'adresse se donne de deux façons, jamais les deux à la fois utilement :

- **En pièces détachées** — `host`, `port`, `dbname` : lisible, adapté au développement. Le service
  les assemble en `mongodb://hôte:port/base` (`MongooseService.buildUri()` (`MongooseService.ts:76`)).
- **En une URI** — `uri` (`config.ts:41`) : la seule forme capable d'exprimer un replica set, un
  `mongodb+srv`, des options de requête. **Dès qu'`uri` est présent, les trois autres champs ne sont
  plus lus du tout.**

```typescript
use("@nodefony/mongoose", {
  connectors: {
    nodefony: { uri: "mongodb://127.0.0.1:27017/app" }, // base principale
    archives: { host: "10.0.0.7", dbname: "archives" }, // seconde connexion
  },
});
```

Les entités choisissent leur connecteur par son nom (`@entities([…], { connector: "archives" })`), et
le repository se demande au registre sous ce même nom. Le nom de connecteur est donc une **clé
publique** de ton application : le changer déplace des entités.

> [!WARNING]
> Le connecteur nommé `nodefony` a un statut particulier : c'est **lui** qui porte le schéma du
> framework (`FRAMEWORK_CONNECTOR` (`registerStores.ts:49`)) et le stockage de session
> (`SESSION_CONNECTOR` (`sessionEntity.ts:5`)). Le renommer ou le supprimer sans le remplacer casse
> les stores framework — ils cherchent un ORM `nodefony` connecté et échouent franchement s'il manque
> (`resolveConnectedOrm()` (`registerStores.ts:64`)).

### `options` — ce que Mongoose sait faire et Nodefony ne re-décrit pas

`options` (`config.ts:71`) est transmis tel quel au driver
(`MongooseService.#connectOne()` (`MongooseService.ts:87`)). On y met tout ce qui touche au
**transport** plutôt qu'à l'adresse : taille du pool, délais, TLS, identifiants séparés.

```typescript
use("@nodefony/mongoose", {
  connectors: {
    nodefony: {
      uri: process.env.NF_DATABASE_URL,
      options: {
        maxPoolSize: 50, // connexions simultanées ouvertes vers le serveur
        serverSelectionTimeoutMS: 5_000, // délai avant de déclarer la base injoignable
        socketTimeoutMS: 45_000, // délai d'une opération individuelle
      },
    },
  },
});
```

Le contenu d'`options` n'est **pas** validé par Zod : c'est Mongoose qui l'accepte ou le rejette, à la
connexion. Une clé mal orthographiée est donc silencieuse jusqu'au boot, où elle se manifeste soit par
une erreur du driver, soit par une option sans effet. Contrepartie de ne pas entretenir une deuxième
description des options du driver.

### `debug` — voir passer les requêtes

`debug` (`config.ts:85`) active la trace intégrée de Mongoose (`connectAll()` (`MongooseService.ts:63`)).
Chaque opération part sur la sortie standard, avec sa collection, son filtre et ses champs.

C'est un **réglage de processus, pas de connecteur** : il vaut pour toutes les connexions à la fois.
En production, laisse-le sur `false` — la trace est verbeuse, et un filtre peut contenir des données
personnelles. Pour observer une application en production, l'outil approprié est la sonde de flux ORM,
détaillée dans la section [Observabilité](#-observabilité--studio).

### `frameworkEntities` — le module pose-t-il le schéma du framework ?

C'est le champ le plus discret et le plus structurant (`frameworkEntities` (`config.ts:102`)). Sur son
défaut `true`, le module fait deux choses de plus qu'ouvrir des connexions, dès son enregistrement et
**avant** que la connexion ne s'ouvre (`Mongoose.onKernelRegister()` (`mongoose/index.ts:65`)) :

1. il **déclare les entités du framework** sur le connecteur `nodefony` — jetons, passkeys, webhooks —
   pour que leurs modèles soient compilés au moment de la connexion ;
2. il **enregistre les fabriques** correspondantes dans les registres de `@nodefony/security`, ce qui
   rend le nom `"mongoose"` sélectionnable dans `tokenStore`, `passkeys`, `webhooks`
   (`registerMongooseFrameworkStores()` (`registerStores.ts:94`)).

Le passer à `false` transforme le module en **pur driver de données** : tes entités à toi, rien
d'autre. Les stores framework Mongo deviennent alors introuvables — les sélectionner échoue
franchement plutôt que de retomber en mémoire sans le dire.

| Ta situation                                                               | Ce que tu mets         |
| -------------------------------------------------------------------------- | ---------------------- |
| Application classique — sessions, comptes, jetons dans Mongo               | rien (défaut `true`)   |
| Mongo ne sert qu'à tes données ; sécurité et sessions vivent ailleurs      | `false`                |
| Tu déclares toi-même une entité framework, à ta façon (nom, index, champs) | rien — voir ci-dessous |

Le troisième cas n'a pas besoin de `false` : l'auto-enregistrement **respecte l'application**. Si une
entité du même nom est déjà déclarée quand le module s'enregistre, il ne l'écrase pas — il la
signale dans son bilan de démarrage, en journal `DEBUG`. Tu peux donc redéfinir une seule entité sans
renoncer aux autres.

> [!CAUTION]
> **`frameworkEntities: false` ne désactive pas le stockage de session.** L'entité `session` et son
> store ne passent pas par ce commutateur : ils s'enregistrent à l'**import** du module, par
> décorateur (`sessionEntity.ts:41`) et par appel direct au registre de `@nodefony/http`
> (`SessionsService.registerStorage("mongoose", …)` (`mongoose/nodefony/src/SessionStorage.ts:353`)). Charger le module
> rend donc toujours `session: { store: "mongoose" }` disponible, quelle que soit la valeur du champ.
> C'est cohérent avec le texte du schéma, qui n'énumère que jetons, WebAuthn et webhooks — mais
> contre-intuitif si l'on lit « entités du framework » au sens large.

## ⚙️ Les variables d'environnement

Deux familles de variables agissent sur ce module, et elles n'ont **pas la même portée**.

### Celles que le driver lit lui-même

Appliquées après la validation, dans une seule fonction
(`applyEnvOverrides()` (`defineModuleConfig.ts:22`)). Elles gagnent donc sur tout le reste.

| Variable           | Effet                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| `MONGODB_URI`      | Remplace l'`uri` du connecteur primaire. **La place du secret de connexion.**                           |
| `NF_DATABASE_URL`  | L'infra déclarée du framework. Même effet, **si et seulement si** le schéma est `mongodb`/`mongodb+srv` |
| `DATABASE_URL`     | Alias de la précédente, pour les plateformes qui l'imposent (`resolveInfra()` (`infra.ts:134`))         |
| `NF_MONGODB_DEBUG` | `1` ou `true` → `debug = true`. Toute autre valeur est sans effet                                       |

Trois précisions qui évitent les mauvaises surprises :

- **`MONGODB_URI` passe devant l'infra.** Le driver lit d'abord sa variable dédiée et ne consulte
  l'infra qu'à défaut — pratique pour épingler une base Mongo particulière dans un environnement qui
  déclare déjà une autre base.
- **Une URL SQL est ignorée, pas refusée.** Si `NF_DATABASE_URL` vaut `postgres://…`, ce module la
  laisse passer sans rien faire : elle appartient à `@nodefony/drizzle`. En revanche un schéma
  **inconnu** (ni SQL ni Mongo) fait échouer le démarrage franchement, pour qu'aucune base ne soit
  choisie par hasard (`parseDatabaseUrl()` (`infra.ts:96`)).
- **Le connecteur visé est le primaire** : `nodefony` s'il existe, sinon la première entrée déclarée.
  Une variable d'environnement ne peut donc pas viser un connecteur secondaire.

### L'override générique du framework

Toute clé de config d'un module se surcharge par `NF__<MODULE>__<CHEMIN>`, le double tiret bas
séparant les niveaux (`parseNfEnvOverrides()` (`envOverride.ts:80`)). Le segment de module est le nom
court : `MONGOOSE`.

```bash
NF__MONGOOSE__DEBUG=true                              # racine
NF__MONGOOSE__FRAMEWORKENTITIES=false                 # casse indifférente
NF__MONGOOSE__CONNECTORS__NODEFONY__DBNAME=recette    # champ imbriqué
NF__MONGOOSE__CONNECTORS__NODEFONY__PORT=27018        # coercé en nombre
```

Ces overrides sont posés **avant** la validation Zod (`Kernel.applyEnvConfigOverrides()` (`Kernel.ts:1600`)) :
une valeur aberrante est donc rejetée comme si tu l'avais écrite dans ton fichier. C'est voulu — un
réglage d'environnement invalide doit casser aussi fort qu'un réglage de code.

> [!WARNING]
> **Un override ne peut viser qu'un champ qui existe déjà.** Le mécanisme refuse de créer une clé
> absente, pour ne pas fabriquer une clé fantôme à la mauvaise casse que le schéma ignorerait ensuite
> en silence (`applyResolvedPath()` (`envOverride.ts:300`)). Conséquence concrète :
> `NF__MONGOOSE__CONNECTORS__NODEFONY__URI` **ne fait rien** si ton `use()` ne déclare pas déjà un
> `uri` — `uri` n'a pas de valeur par défaut, donc le chemin n'existe pas. Le cas n'est pas silencieux
> pour autant : le démarrage émet un `WARNING` nommant le segment fautif et listant les clés
> disponibles. **Pour poser une URI par l'environnement, utilise `MONGODB_URI` ou `NF_DATABASE_URL`.**

### Ce qui n'est pas une variable de ce module

| Variable            | Qui la lit                        | Effet                                                                       |
| ------------------- | --------------------------------- | --------------------------------------------------------------------------- |
| `NF_STORE`          | Le cœur, pour toute brique `auto` | Force un backend partout — sert surtout à mesurer sans le goulot d'une base |
| `NF_ORM_FLOW`       | La sonde de flux ORM              | `1`/`true` l'allume, `0`/`false` l'éteint ; sinon : allumée hors production |
| `NF_MONGO_TEST_URI` | La suite de tests du module       | Pointe un serveur Mongo existant au lieu d'en démarrer un jetable           |

Le dépôt d'utilisateurs, lui, ne se choisit pas par une clé de ce module : il se pose dans le
`provisionUsers` de ton application. Voir
[Brancher l'annuaire utilisateurs](./index.md#brancher-lannuaire-utilisateurs).

### L'ordre complet, une bonne fois

De la plus faible à la plus forte priorité :

1. **Les défauts du schéma** — `localhost:27017/nodefony`, `debug: false`, `frameworkEntities: true`.
2. **Ta config d'app** — `use("@nodefony/mongoose", { … })`, fusionnée en profondeur sous les défauts
   (`Kernel.loadModulesFromManifest()` (`Kernel.ts:1150`)).
3. **Un override venu d'un autre module** — la clé `module-mongoose` dans la config d'un module tiers.
4. **`NF__MONGOOSE__…`** — l'override générique d'environnement.
5. **La validation Zod** — types, bornes, défauts des champs restés absents.
6. **`MONGODB_URI` / infra / `NF_MONGODB_DEBUG`** — la couche du driver, appliquée après validation.
7. **Le gel** — la configuration devient immuable pour la durée de vie du processus.

> [!NOTE]
> Les étapes 4 et 6 sont toutes deux « l'environnement », et pourtant **6 gagne sur 4**. Ce n'est pas
> une incohérence : 4 sert à ajuster n'importe quel champ de n'importe quel module, 6 sert à porter
> l'**adresse de la base**, qui est la donnée la plus dépendante du déploiement. En cas de doute,
> `MONGODB_URI` est toujours le dernier mot.

## Mises en situation

Quatre déploiements, quatre configurations. Le fichier d'application change à peine ; c'est
l'environnement qui porte la différence.

### Sur ma machine — je veux juste que ça tourne

Un `mongod` local, aucune authentification, une base par projet.

```typescript
use("@nodefony/mongoose", {
  connectors: { nodefony: { dbname: "blog" } }, // host et port restent aux défauts
});
```

Ce qu'on observe : `Mongoose ORM "nodefony" connected (localhost:27017/blog)`. Ce qui **ne marchera
pas** : les transactions. Un `mongod` isolé ne les supporte pas — il faut un replica set, même à un
seul nœud.

### En développement, mais avec les transactions

Un replica set à un nœud donne les transactions sans monter une grappe. L'URI doit nommer le jeu de
réplication, ce qui impose la forme `uri`.

```typescript
use("@nodefony/mongoose", {
  connectors: {
    nodefony: {
      uri: "mongodb://127.0.0.1:27017/blog?replicaSet=rs0&directConnection=true",
    },
  },
});
```

Le paramètre `directConnection=true` évite la découverte de topologie quand le jeu n'a qu'un membre —
sans lui, le driver peut attendre longuement un serveur primaire qu'il ne trouvera pas.

### Une base managée — Atlas ou équivalent

L'adresse est un `mongodb+srv`, le secret vit dans l'environnement, le fichier d'application ne
contient **rien** de spécifique.

```bash
export NF_DATABASE_URL='mongodb+srv://app:********@cluster0.exemple.mongodb.net/prod?retryWrites=true&w=majority'
```

```typescript
// Aucun connecteur déclaré : le défaut suffit, l'environnement fournit l'adresse.
use("@nodefony/mongoose", {});
```

Trois points d'attention avec un service managé :

- **Le TLS est implicite** en `mongodb+srv` — inutile de l'activer dans `options`.
- **Le replica set vient d'office**, donc les transactions fonctionnent sans rien faire.
- **Dimensionne `maxPoolSize` par processus**, pas pour l'application entière : dix pods à 50
  connexions font 500 connexions vers ton cluster.

### En conteneur / dans un orchestrateur

L'image ne contient aucune adresse : elle prend ce que l'orchestrateur lui donne.

```yaml
# Extrait d'un déploiement — l'URI vient d'un secret, jamais de l'image
env:
  - name: NF_DATABASE_URL
    valueFrom:
      secretKeyRef: { name: mongo-credentials, key: uri }
  - name: NF__MONGOOSE__CONNECTORS__NODEFONY__OPTIONS__MAXPOOLSIZE
    value: "20"
```

Le second override suppose que `options` est **déjà déclaré** dans ton `use()` (règle du chemin
existant, plus haut). Si tu veux régler le pool par l'environnement, déclare-le explicitement avec une
valeur de départ :

```typescript
use("@nodefony/mongoose", {
  connectors: { nodefony: { options: { maxPoolSize: 10 } } },
});
```

### Deux bases dans la même application

Une base métier et une base de lecture séparée. Chaque entité déclare son connecteur ; les stores du
framework restent sur `nodefony`.

```typescript
use("@nodefony/mongoose", {
  connectors: {
    nodefony: { uri: "mongodb://primaire:27017/app" }, // métier + framework
    reporting: {
      uri: "mongodb://replica:27017/app",
      options: { maxPoolSize: 5 },
    },
  },
});
```

Les deux connexions s'ouvrent en série au démarrage, dans l'ordre de déclaration
(`connectAll()` (`MongooseService.ts:63`)), et se ferment toutes à l'arrêt
(`disconnectAll()` (`MongooseService.ts:134`)). Un service peut demander l'une ou l'autre par son nom
(`getOrm()` (`MongooseService.ts:142`)), mais l'usage courant reste le registre d'ORM.

## 🔐 Le secret de connexion

Un identifiant de base de données est le secret le plus rentable à voler : il ouvre **toutes** les
données d'un coup. La règle est donc sans nuance.

- **Jamais dans le dépôt.** Ni dans `nodefony.config.ts`, ni dans un fichier d'exemple, ni « juste
  pour le développement ». Le secret arrive par `MONGODB_URI` ou `NF_DATABASE_URL`.
- **Ni dans les journaux, ni dans Studio.** L'URI est systématiquement nettoyée de tout
  `utilisateur:motdepasse@` avant d'être affichée (`MongooseOrm.safeTarget()` (`MongooseOrm.ts:595`)),
  y compris pour les URI multi-hôtes que l'analyseur d'URL standard ne sait pas découper. C'est cette
  cible nettoyée que voit le plan d'administration
  (`MongooseOrm.describeConnection()` (`MongooseOrm.ts:583`)) et le message de connexion au démarrage.
- **Les identifiants passés par `options`** (`user`, `pass`) suivent la même règle : ils viennent de
  l'environnement, pas du fichier. Le framework rédige d'ailleurs la valeur de tout override
  d'environnement dont le chemin ressemble à un secret, avant de le journaliser
  (`pathLooksSecret()` (`envOverride.ts:375`)).

> [!TIP]
> Vérifie ta redaction en une commande : démarre l'application et lis la ligne de connexion. Elle doit
> montrer `hôte/base` et **rien d'autre**. Si un `user:pass@` y apparaît, c'est un incident — le
> secret est probablement écrit ailleurs qu'à l'endroit prévu.

## 🔎 Les index — ce qui est construit, ce qui est seulement CONSTATÉ

MongoDB n'a pas de schéma à déclarer, mais il a des **index**, et certains portent des contraintes
d'unicité dont l'application dépend : l'identifiant d'un utilisateur, le condensat d'un jeton,
l'identifiant d'une session. Un index unique absent n'est pas une lenteur — c'est une contrainte qui
n'existe pas.

Mongoose les construit au démarrage, en tâche de fond. Cette construction peut **échouer** : une
collection qui contient déjà des doublons au moment d'une montée de version, un index existant de
même nom mais de définition différente. Nodefony **constate** donc l'écart après chaque connexion et
journalise tout index déclaré mais absent en **`CRITIC`**, en nommant la collection et l'index :

```
index DÉCLARÉS mais ABSENTS de la collection "users" (entité "User") : identifier_1
— toute contrainte d'unicité qu'ils portent n'est PAS appliquée
```

Ce constat ne fait **jamais** de réparation. L'outil de mongoose qui répare, `syncIndexes()`,
**supprime** au passage tout index non déclaré au schéma : sur une base qu'un exploitant a indexée à
la main, la réparation automatique serait pire que le mal. Réparer reste un geste explicite.

### `autoIndex` — construire, ou seulement constater

Par défaut Mongoose construit. Sur une grosse collection, la construction bloque les opérations : la
documentation de Mongoose recommande de la couper en production, une fois les index posés une bonne
fois par un déploiement maîtrisé.

```ts
use("@nodefony/mongoose", {
  connectors: {
    nodefony: { autoIndex: false }, // ne construit plus ; constate et alerte toujours
  },
});
```

À `false`, un index manquant **n'est pas créé** — il est seulement constaté, et le `CRITIC` reste
émis. C'est précisément l'intérêt : le pod ne bloque pas, et l'exploitant sait ce qu'il lui reste à
poser.

> `autoIndex` peut aussi être écrit dans le fourre-tout `options`. Quand les deux sont donnés, le
> **champ déclaré gagne** (`MongooseService.buildConnectOptions()`).

### Quand un index manque en production

1. **Lire le `CRITIC`** : il nomme la collection et l'index (`identifier_1` = champ `identifier`,
   ordre croissant), donc la contrainte qui n'est pas tenue.
2. **Chercher la cause dans la donnée** avant l'index. Un index unique refusé signifie presque
   toujours des **doublons déjà présents** :
   ```js
   db.users.aggregate([
     { $group: { _id: "$identifier", n: { $sum: 1 } } },
     { $match: { n: { $gt: 1 } } },
   ]);
   ```
3. **Résoudre les doublons** — c'est une décision métier (fusionner, renommer, supprimer), jamais
   un geste automatique.
4. **Poser l'index**, en arrière-plan pour ne pas bloquer la collection :
   ```js
   db.users.createIndex(
     { identifier: 1 },
     { unique: true, name: "identifier_1" },
   );
   ```
5. **Redémarrer un pod** et vérifier que le `CRITIC` a disparu.

Tant que l'index manque, considérer la contrainte comme absente : le code qui compte sur elle
(inscription, rotation de jeton) peut créer des doublons sans erreur.

## Quand la configuration ne passe pas

Deux échecs très différents, deux comportements assumés.

### La config est invalide

Un port hors bornes, un type erroné, un champ vide : le démarrage s'arrête avec un message qui **nomme
le champ**, pas une pile d'appels.

```
[@nodefony/mongoose] Invalid config: connectors.x.port: Too small: expected number to be >=1
```

Le message est assemblé à partir des remontées de validation, chemin de champ compris
(`Mongoose.onKernelRegister()` (`mongoose/index.ts:65`)). C'est un arrêt **volontairement franc** :
une configuration fausse ne se répare pas en continuant, et un serveur qui démarre à moitié est plus
coûteux à diagnostiquer qu'un serveur qui refuse de démarrer.

### La base ne répond pas

Le cas courant : la config est parfaite, mais Mongo n'est pas joignable — conteneur pas encore prêt,
réseau coupé, identifiants périmés. Le comportement **dépend de l'environnement**, arbitré par la
politique de boot du cœur (`Kernel.isBootErrorFatal()` (`Kernel.ts:2665`)) :

| Environnement       | Ce qui se passe                                                                        |
| ------------------- | -------------------------------------------------------------------------------------- |
| Développement, test | `WARNING`, l'échec est agrégé au bilan de démarrage, **le serveur démarre quand même** |
| Production          | L'échec **interrompt le démarrage** : le processus sort en erreur                      |

Ce n'est pas une inconséquence : en développement, tu veux ton serveur debout pour travailler sur le
reste ; en production, un pod qui répond sans sa base est un piège — l'orchestrateur doit le voir
tomber pour le relancer, et c'est le modèle cloud-native que le framework applique partout.

> [!IMPORTANT]
> **Le module est déclaré non critique** (`Mongoose.critical` (`mongoose/index.ts:48`)), et cette
> déclaration protège bien ses **hooks de module** — mais l'ouverture de la connexion, elle, est faite
> par un écouteur `onBoot` posé par le service, qui ne porte pas cette étiquette
> (`MongooseService.ts:41`). En production, une base injoignable interrompt donc
> le démarrage. Si tu attends l'inverse — un serveur qui démarre sans sa base et se rattrape plus
> tard — ne compte pas dessus : prévois une sonde de disponibilité côté orchestrateur.

### Pendant l'arrêt du serveur

À l'arrêt, les connexions se ferment alors que des requêtes peuvent encore être en vol. Le stockage de
session **dégrade gracieusement** plutôt que de lever une exception
(`SessionStorage.#repo()` (`SessionStorage.ts:45`)) : une session non persistée le temps de l'arrêt
vaut mieux qu'une erreur 500 et un rejet non capturé. À l'inverse, une entité absente sur un ORM
**connecté** est une vraie erreur de configuration : celle-là est levée sans ménagement.

## 📡 Observabilité — Studio

La configuration ne se contente pas d'être validée : elle se **montre**.

- Le module publie son schéma en JSON Schema (`Mongoose.configSchema()` (`mongoose/index.ts:55`) →
  `mongooseConfigJsonSchema()` (`defineModuleConfig.ts:72`)). C'est ce qui permet à Studio d'afficher
  chaque clé avec son type, son défaut et son texte d'aide — sans qu'une seule ligne de description
  soit recopiée quelque part.
- L'écran `/nodefony/config` montre la configuration **effective** après toutes les couches, et la
  **provenance** de chaque champ : valeur d'usine, écrite par l'application, ou venue de
  l'environnement. C'est l'outil qui répond à « pourquoi cette valeur ? » sans relire six fichiers.
- L'écran `/nodefony/databases` montre les connexions et leur santé ; `/nodefony/stores` montre quelle
  brique s'est posée sur quel backend **et pourquoi**.

La cible affichée est toujours la version nettoyée de l'URI — aucun identifiant ne franchit la
frontière du plan d'administration.

## ⚠️ Pièges (symptôme → cause → correction)

| Symptôme                                                                  | Cause                                                                                | Correction                                                                                   |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `host`/`port`/`dbname` semblent ignorés                                   | Un `uri` est présent (dans le fichier ou via l'environnement) et **prime** toujours  | Retirer `uri`, ou tout exprimer dedans                                                       |
| `NF__MONGOOSE__CONNECTORS__NODEFONY__URI` sans effet, `WARNING` au boot   | `uri` n'a pas de défaut → le chemin n'existe pas ; l'override ne crée jamais une clé | Utiliser `MONGODB_URI` (ou `NF_DATABASE_URL`)                                                |
| `NF_DATABASE_URL` est bien posée, Mongo n'est pas utilisé                 | L'URL est de famille SQL : elle appartient à `@nodefony/drizzle`                     | Une URL `mongodb://`/`mongodb+srv://`, ou passer par `MONGODB_URI`                           |
| Le démarrage échoue sur le schéma de l'URL                                | Schéma inconnu (`mongo://`, faute de frappe) — refus délibéré, jamais de repli       | Corriger le schéma : `mongodb://` ou `mongodb+srv://`                                        |
| `Transaction numbers are only allowed on a replica set…`                  | Serveur isolé : pas de transactions                                                  | Un replica set, même à un nœud (`?replicaSet=rs0&directConnection=true`)                     |
| `ORM "nodefony" introuvable` au montage d'un store                        | `@nodefony/security` chargé **avant** `@nodefony/mongoose`                           | Placer le driver **avant** dans `modules` (`resolveConnectedOrm()` (`registerStores.ts:64`)) |
| Le store `mongoose` est introuvable pour les jetons                       | `frameworkEntities: false` — le module est en mode données seules                    | Repasser à `true`, ou choisir un backend qui porte la brique                                 |
| `session: { store: "mongoose" }` marche malgré `frameworkEntities: false` | Attendu : la session s'enregistre à l'import, pas via ce champ                       | Rien à corriger — voir l'avertissement de la section `frameworkEntities`                     |
| Une option de `options` n'a aucun effet                                   | Elle n'est pas validée par Zod ; Mongoose l'a ignorée ou refusée                     | Vérifier son nom exact dans les `ConnectOptions` de la version de Mongoose installée         |
| `CRITIC` : « index DÉCLARÉS mais ABSENTS »                                | Construction refusée (doublons présents) ou `autoIndex: false`                       | Voir « Quand un index manque en production » — jamais de réparation automatique              |
| Le serveur démarre sans base en développement, tombe en production        | Politique de boot : fail-soft en développement, arrêt franc en production            | Attendu — s'assurer que la base est joignable avant de déployer                              |
| Deux ORM entrent en collision sur l'entité `session`                      | Un autre driver déclare le même nom de connecteur                                    | Garder `nodefony` pour Mongoose (c'est précisément à quoi sert ce nom distinct)              |

## 🧪 Tests et couverture

Deux familles couvrent la configuration ; les compteurs exacts sont recomptés à chaque génération,
jamais figés ici.

- **Unitaires, sans aucune base** (`tests/unit/config.test.ts`) : les défauts du connecteur `nodefony`,
  la fusion d'un connecteur personnalisé avec les défauts manquants, le rejet d'un port hors bornes,
  les deux variables du driver (`MONGODB_URI`, `NF_MONGODB_DEBUG`), le gel de la configuration retournée,
  et la production du JSON Schema. C'est **la seule famille qui tourne sans serveur Mongo**.
- **Intégration, sur un vrai `mongod`** (`tests/integration/MongooseService.test.ts` et les dix autres
  bancs) : l'assemblage d'URI, l'ouverture et la fermeture des connexions, puis tout le reste du
  module — contrat ORM, session, jetons, passkeys, webhooks, utilisateurs.

Ce qui **n'est pas** couvert, dit franchement : la surcharge par l'infra déclarée
(`NF_DATABASE_URL`/`DATABASE_URL`) n'a pas de test unitaire propre à ce module — seule la variable
dédiée `MONGODB_URI` en a un. Il n'y a pas non plus de test de charge ni de mesure mémoire dédiés au
driver.

> [!WARNING]
> **Un « tout vert » ne prouve pas ce qu'on croit ici.** L'immense majorité des cas exige un serveur
> MongoDB. Sans lui, l'infrastructure de test fournit `mongoUri` à `null`
> (`globalSetup.ts:48`), chaque banc se met alors en `describe.skipIf` (`mongoTestUri()` (`mongoTestUri.ts:12`))…
> **et un test sauté compte comme vert.** La suite passe alors en n'ayant réellement exercé que la
> configuration — c'est-à-dire une petite minorité des cas. Avant de conclure « ça marche », vérifie
> que la base était là : soit `NF_MONGO_TEST_URI` pointe un conteneur
> (`docker run -p 27017:27017 mongo:7`), soit le serveur en mémoire a démarré.
>
> Le catalogue des variables d'infrastructure du dépôt est `vitest.gates.ts`, à la racine. Ce module
> **n'y déclare pas de porte** : ses sauts sont donc silencieux, là où les suites SQL et Redis
> annoncent en fin de course ce qu'elles n'ont pas joué.

Couverture : `npm run coverage` dans `@nodefony/mongoose`.

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [MongoDB (Mongoose) — vue d'ensemble](./index.md) ·
  [Toute la documentation](../../../../../docs/index.md)
- 🧭 **Le socle** : [`@nodefony/orm-core`](../../orm-core/docs/index.md) — les contrats portables ·
  [tutoriel : créer une entité](../../orm-core/docs/tutorial-entity.md)
- 🔄 **L'autre driver** : [`@nodefony/drizzle`](../../drizzle/docs/index.md) — la référence de cette
  convention de configuration · [`@nodefony/redis`](../../redis/docs/index.md)
- 🔌 **Les modules servis** : [sessions HTTP](../../http/docs/session.md) ·
  [jetons](../../security/docs/tokens.md) · [passkeys](../../security/docs/webauthn.md) ·
  [webhooks](../../security/docs/webhooks.md) · [utilisateurs](../../user/docs/index.md)
- 🏛️ **Transverse** : [guide de configuration](../../../../../docs/guides/configuration.md) —
  `defineConfig`, `use()`, l'infra déclarée · [guide de la persistance](../../../../../docs/guides/persistence.md) ·
  [stockage de session](../../../../../docs/guides/session-storage.md)
- 📖 [Lexique général](../../../../../docs/lexique.md) · [Par où démarrer](../../../../../docs/demarrer.md)
