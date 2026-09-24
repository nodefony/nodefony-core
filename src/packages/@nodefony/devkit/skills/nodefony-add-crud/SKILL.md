---
name: nodefony-add-crud
description: >
  Crée une ressource complète dans une application Nodefony — entité, schémas de validation,
  service CRUD, controller REST+WebSocket et tests — par le générateur `nodefony create entity`,
  sur SQL comme sur MongoDB. Porte la grammaire de champs, la
  table des types moteur par moteur, les relations et clés étrangères,
  les réglages pour épouser une table SQL existante, et ce qu'on découvre autrement en
  production : la table naît au démarrage, un champ ajouté n'est rattrapé que s'il accepte le
  vide, et la production s'applique par des migrations (skill `nodefony-migrate-schema`). À
  charger AVANT d'écrire une entité, un repository ou un controller de ressource.
  Déclencheurs : "ajoute une entité", "crée un CRUD", "nouvelle table", "modèle de données",
  "ressource REST", "je veux stocker des articles/commandes", "comment définir un champ", "quels types de champ ?", "une relation entre
  deux entités", "clé étrangère", "index composite", "épouser une table existante",
  "entité MongoDB", "schéma Mongoose".
---

# add-crud — une ressource complète, générée

> 🧭 **Tu es arrivé ici directement ? Charge aussi `nodefony-dev`** — il porte la conduite
> commune (par où commencer, comment prouver que c'est fait) et les pièges qui coûtent une heure,
> serveur comme front. Cette page-ci ne couvre QUE son geste.
>
> Et si une réponse te manque, elle est probablement INSTALLÉE : `rg` ne descend pas dans
> `node_modules`, donc 70 pages de documentation y paraissent absentes. Une commande les lit, avec
> la ligne exacte :
> `node node_modules/@nodefony/devkit/skills/nodefony-dev/scripts/docs.mjs <termes>`.

> ⚖️ **La confiance n'exclut pas le contrôle.** Ce que le générateur produit se relit ;
> ce que tu écris à la main se prouve par un test.

## Le geste

```bash
npx nodefony create entity Article title:string body:text? published:bool
```

Une seule commande produit la chaîne entière : la table, son interface de ligne, les schémas de
validation d'entrée, le service CRUD, le controller (REST **et** WebSocket dans la même méthode)
et les tests. **N'écris aucun de ces fichiers à la main** — non par principe, mais parce que le
gabarit porte des détails qui ne se devinent pas : le repository résolu au premier usage (l'ORM ne
se connecte qu'au démarrage), la pagination bornée **et son tri déclaré**, les codes
201/204/404/409/422, et l'en-tête `Location`.

## La grammaire de champs

`nom:type[?][=défaut][:index|:unique]` — **non-null par défaut**, `?` rend facultatif, `=valeur`
fixe un défaut LITTÉRAL, `:unique` pose une contrainte d'unicité, `:index` un index simple.
🔴 **`!` est REFUSÉ** : il ne veut pas dire « obligatoire » ici — un champ l'est déjà.

**Casse** : l'entité et la cible d'une relation en PascalCase (`Post`, `ref:User`), le champ en
camelCase (`publishedAt`). Une faute de casse ou un type d'un autre outil (`boolean`, `integer`)
est refusé avec la forme juste proposée.

| Type           | Ce que ça produit             | SQLite          | PostgreSQL       | MySQL / MariaDB | MongoDB                |
| -------------- | ----------------------------- | --------------- | ---------------- | --------------- | ---------------------- |
| `string(n)`    | texte court, borné (255)      | `text` ¹        | `varchar(n)`     | `varchar(n)`    | `String` + `maxlength` |
| `text`         | texte long                    | `text`          | `text`           | `text`          | `String`               |
| `int`          | entier                        | `integer`       | `integer`        | `int`           | `Number`               |
| `float`        | nombre à virgule              | `real`          | `double`         | `double`        | `Number`               |
| `decimal(p,s)` | décimal EXACT (voyage chaîne) | `numeric`       | `numeric(p,s)`   | `decimal(p,s)`  | `String`               |
| `bool`         | booléen                       | `integer` (0/1) | `boolean`        | `boolean`       | `Boolean`              |
| `json`         | document libre                | `text` (JSON)   | `jsonb`          | `json`          | `Mixed`                |
| `date`         | horodatage (ms)               | `integer` (ms)  | `timestamptz(3)` | `datetime(3)`   | `Date`                 |
| `uuid`         | identifiant                   | `text`          | `uuid`           | `varchar(36)`   | `String`               |
| `char(n)`      | longueur EXACTE               | `text` ¹        | `char(n)`        | `char(n)`       | `String`, `n` exact    |
| `enum(a,b)`    | valeurs admises ²             | `text`          | `varchar(255)`   | `varchar(255)`  | `String` + `enum`      |
| `ref:<Entité>` | relation ³                    | clé étrangère   | clé étrangère    | clé étrangère   | `ObjectId` + `ref`     |

¹ SQLite n'applique aucune longueur : c'est le schéma d'entrée (Zod) qui borne, sur TOUS les
transports. ² Même colonne partout, sans type SQL nommé (qui exigerait une migration) : le type
TypeScript et le schéma Zod bornent les valeurs. ³ En SQL, la colonne prend le type de la clé
visée (`uuid`, entier pour `--id serial`, texte pour `User`) ; en MongoDB, aucune clé étrangère.

La table exacte, par moteur, telle que CETTE version l'écrit :
`npx nodefony create entity --describe-json` (champ `context.columnTypes`).

**Une relation** s'écrit `<champ>:ref:<Entité>` — le champ d'abord, toujours :

```bash
npx nodefony create entity Comment body:text article:ref:Article
```

La colonne de jointure est **indexée d'office** — c'est elle que traverse un `?include=`. En SQL,
la **clé étrangère est émise** (`.references()`), du type de la clé visée, et son effacement se
déduit de la nullabilité : `article:ref:Article` (obligatoire) → `restrict`, le parent ne peut pas
partir ; `article:ref:Article?` → `set null`. `cascade` n'est jamais un défaut : il s'écrit à la
main dans la table générée.

**Un index de table** porte plusieurs colonnes, et c'est le seul à le pouvoir :

```bash
npx nodefony create entity Visit siteId:uuid path:string at:date --index "siteId,at" --unique "siteId,path"
```

Les deux options sont **répétables** — un couple par index. Sur un schéma réel, la majorité des
index utiles sont composites : c'est ainsi qu'une table est réellement interrogée.

## Sur une application MongoDB

La même commande écrit une entité **document** : schéma Mongoose, service CRUD, controller et
tests — sans table ni migration (la collection naît à la première écriture). Une ligne, toutes
les options qui ont un sens ici :

```bash
npx nodefony create entity Post title:string(120) body:text? views:int=0 status:enum(draft,published)=draft slug:string:unique tags:json? author:ref:User --soft-delete --route /api/posts --dry-run
```

- La clé est l'`_id` natif, servie en `id` ; `ref:<Entité>` est un `ObjectId` indexé, chargé
  par `?include=`, que le schéma d'entrée exige bien formé (24 caractères hexadécimaux → 422).
- **MongoDB ne tient aucune clé étrangère, l'ORM tient l'effacement** : supprimer un parent
  encore désigné par une référence obligatoire est refusé (409), une facultative est remise à
  `null` — la politique du SQL. Hors transaction, ce contrôle n'est pas atomique ; et
  l'INSERTION n'est pas gardée (un identifiant inexistant est accepté, `?include=` rend `null`).
- Refusées en le disant (options SQL) : `--table`, `--column-case`, `--id-name`, `--dialect`,
  `--id`, `--index`, `--unique`. Un index composite s'écrit à la main dans le schéma.
- `User` ne se régénère pas : il s'étend dans `nodefony/entity/User.ts` (son TSDoc donne le geste).

## Épouser une table qui existe déjà

Trois réglages, et ils ne touchent **que** le SQL — la propriété TypeScript reste `id`, `siteId` :

```bash
npx nodefony create entity Session token:string:unique --table user_sessions --column-case snake --id-name session_id
```

Faire suivre le TypeScript aurait transformé un réglage de nommage en refonte : le service, le
controller, le tri par défaut et les tests générés nomment tous la propriété, pas la colonne.

## Toute lecture de liste se BORNE

Avant le format, la règle qui décide si l'application tient en production : **un `find` sans
borne matérialise la table ENTIÈRE.** Indolore sur les quelques lignes du poste de développement,
fatal sur les dizaines de milliers de la production — et le code est identique dans les deux cas,
donc rien ne prévient.

Le service d'une entité hérite `findPage({ limit: 25 })` : il ne charge que **`limit + 1`** lignes
et rend `{ items, hasNext }` — la ligne excédentaire est ce qui répond « il en reste », sans
compter la table. Sinon `find(criteria, { limit })`.

Il te faut une projection de colonnes, une CTE, une agrégation ? Descends au natif **avec son
type** :

```ts
import type { DrizzleDb } from "@nodefony/drizzle";
const db = orm.getNativeConnection<DrizzleDb>();
```

Sans le paramètre de type tu reçois `unknown`, et il ne te reste qu'un `as any` — que le contrôle
refuse.

## La liste rend une PAGE — et il n'y a qu'un dialecte

La route de liste ne rend pas un tableau : elle rend
`{ items, limit, offset, hasNext, total? }`. Un tableau ne dit pas s'il en reste — le client qui
reçoit 25 lignes ne peut pas distinguer « c'est tout » de « demande la suite ».

Quatre paramètres, les mêmes **partout** dans Nodefony (tes routes, celles du framework, la console
d'administration) :

| Paramètre         | Exemple                        | Effet                                                              |
| ----------------- | ------------------------------ | ------------------------------------------------------------------ |
| `limit`           | `?limit=50`                    | taille de page, bornée par le plafond de la route                  |
| `offset`          | `?offset=100`                  | décalage                                                           |
| **`order`**       | `?order=createdAt:DESC,id:ASC` | tri, plusieurs champs, sens explicite                              |
| `withTotal=false` | `?withTotal=false`             | économise le `COUNT(*)` quand on n'affiche pas les numéros de page |

**Un champ non triable est refusé par un 400**, jamais accepté puis ignoré : une page rendue dans
un ordre qui n'est pas celui demandé, sans un mot, est un mensonge que personne ne voit. Les champs
acceptés sont la constante `SORTABLE` en tête du controller généré — c'est là qu'on en ajoute ou
qu'on en retire un.

> 🔴 **N'écris JAMAIS ton propre lecteur de `limit`/`offset`/`sort`.** `parsePageQuery` (exporté par
> `nodefony`) est LE traducteur : il lit tout d'un coup et applique l'allowlist. Deux dialectes dans
> une même application divergent, et c'est le client qui l'apprend. Pire, **deux appels dans le
> MÊME handler** dont un seul connaît l'allowlist font refuser en 400 ce que l'autre vient
> d'accepter — aucun test unitaire ne le voit, chaque appel étant correct isolément.

```ts
const page = parsePageQuery(query, {
  defaultLimit: 25,
  maxLimit: 100,
  sortable: SORTABLE,
});
```

Ce contrat vaut aussi quand tu écris une liste **à la main** (un endpoint d'administration, un
listing filtré) : le côté serveur déclare ce qu'il sait trier, le point d'entrée le demande, et le
refus tombe tout seul.

## Les trois vérités à savoir avant de livrer (SQL)

1. **La table naît au prochain démarrage en développement** (`CREATE TABLE IF NOT EXISTS`).
2. **La modifier n'altère rien** — aucun `ALTER` n'est émis. Une colonne ajoutée à une entité déjà
   créée n'apparaîtra pas dans une base existante.
3. **La production ne fabrique JAMAIS le schéma.** Elle l'applique par des migrations, écrites par
   `npx nodefony orm:generate` et posées par `npx nodefony orm:migrate` — c'est un geste à part,
   avec ses refus et ses interdits : skill **`nodefony-migrate-schema`**.

## Ce qui refuse AVANT d'écrire

Le générateur s'arrête plutôt que de produire un fichier bancal — lis le message, il nomme le
geste :

- **hors projet** (aucun `nodefony.config.ts` au-dessus) ;
- **aucun ORM** dans l'application (ni `@nodefony/drizzle`, ni `@nodefony/mongoose`) ;
- **une option SQL sur une application MongoDB** (liste ci-dessus) ;
- **entité déjà déclarée** ;
- **nom réservé par un module du framework** (`session`, `access_token`, `audit_event`…) — un
  homonyme dépossède le module, et l'application ne démarre plus sur un message parlant d'une
  colonne inconnue. **`User` fait exception** : l'identité appartient à l'application, et
  `create entity User firstName:string(100)?` écrit l'entité avec les colonnes du contrat plus
  les tiennes. Trois refus s'y appliquent alors — renommer la table ou changer la casse des
  colonnes (des requêtes les écrivent en dur), la poser ailleurs que dans l'application racine
  (l'ordre de chargement n'y est pas garanti), et déclarer un champ obligatoire **sans valeur par
  défaut** (le framework crée des utilisateurs sans le connaître : le semis d'administrateur
  échouerait, et sans code d'erreur). Ni service ni contrôleur générique ne sont produits — une
  ressource REST publique sur l'annuaire serait une faille, et `UserService` existe déjà ;
- **colonne inconnue, répétée, ou implicite absente** (`createdAt` sans horodatages).

## La suppression naît gardée — vérifie-le

Si `@nodefony/security` est dans les dépendances, l'action de suppression porte
`@IsGranted("ROLE_ADMIN")`. **Sans le module, elle n'est protégée par rien**, et le commentaire du
fichier généré le dit. Mesuré sur une application réelle avant correction : le CRUD répondait
**204 à un DELETE anonyme**.

Pour la protéger : → skill `nodefony-protect-route`.

## Prouver

```bash
npm run build                    # le code généré compile-t-il ?
npm test                         # les tests générés couvrent la couche donnée
npx nodefony doctor               # câblage : entité orpheline, service non listé, route en :param
npx nodefony inspect entities    # ce que l'application enregistre VRAIMENT
```

`npm test` est le premier diagnostic, jamais le dernier geste.

## Voisins

| Besoin                                   | Skill                           |
| ---------------------------------------- | ------------------------------- |
| Un service métier injectable             | `nodefony-add-service`          |
| Faire suivre une base DÉJÀ en place      | `nodefony-migrate-schema`       |
| Réserver une route à certaines personnes | `nodefony-protect-route`        |
| Un flux temps réel                       | `nodefony-add-realtime-channel` |
