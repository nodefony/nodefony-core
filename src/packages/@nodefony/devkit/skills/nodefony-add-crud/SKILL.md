---
name: nodefony-add-crud
description: >
  Crée une ressource complète dans une application Nodefony — table, schémas de validation,
  service CRUD, controller REST+WebSocket et tests — par le générateur `nodefony create entity`,
  au lieu de l'écrire à la main. Porte la grammaire de champs (types, relations, index simples et
  composites), les réglages pour épouser une table SQL existante, et les trois vérités qu'on
  découvre autrement en production : la table naît au démarrage, un champ ajouté n'est rattrapé que
  s'il accepte le vide, et la production s'applique par des migrations — dont le cycle complet vit
  dans le skill `nodefony-migrate-schema`. À charger AVANT d'écrire une entité, un repository ou un
  controller de ressource.
  Déclencheurs : "ajoute une entité", "crée un CRUD", "nouvelle table", "modèle de données",
  "ressource REST", "endpoint CRUD", "je veux stocker des articles/commandes/utilisateurs",
  "comment définir un champ", "une relation entre deux entités", "index composite",
  "épouser une table existante", "renommer les colonnes en snake_case".
---

# add-crud — une ressource complète, générée

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

`nom:type[?|!][:index]` — **non-null par défaut**, `?` rend facultatif, `!` pose une contrainte
d'unicité, `:index` un index simple.

| Type     | Ce que ça produit       |
| -------- | ----------------------- |
| `string` | texte court (une ligne) |
| `text`   | texte long              |
| `int`    | entier                  |
| `float`  | décimal                 |
| `bool`   | booléen                 |
| `json`   | document                |
| `date`   | horodatage              |
| `uuid`   | identifiant             |

**Une relation** s'écrit `ref:<Entité>` :

```bash
npx nodefony create entity Comment body:text ref:Article
```

La colonne de jointure est **indexée d'office** — c'est elle que traverse un `?include=`.
Les clés étrangères ne sont pas émises : une contrainte déclarée dans le `CREATE TABLE`
n'atteindrait jamais une base déjà en place. C'est le domaine des migrations.

**Un index de table** porte plusieurs colonnes, et c'est le seul à le pouvoir :

```bash
npx nodefony create entity Visit siteId:uuid path:string at:date --index "siteId,at" --unique "siteId,path"
```

Les deux options sont **répétables** — un couple par index. Sur un schéma réel, la majorité des
index utiles sont composites : c'est ainsi qu'une table est réellement interrogée.

## Épouser une table qui existe déjà

Trois réglages, et ils ne touchent **que** le SQL — la propriété TypeScript reste `id`, `siteId` :

```bash
npx nodefony create entity Session token:string! --table user_sessions --column-case snake --id-name session_id
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

## Les trois vérités à savoir avant de livrer

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
- **`@nodefony/drizzle` absent** de la cible ;
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
npx nodefony check               # câblage : entité orpheline, service non listé, route en :param
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
