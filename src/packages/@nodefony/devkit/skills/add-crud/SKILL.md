---
name: add-crud
description: >
  Crée une ressource complète dans une application Nodefony — table, schémas de validation,
  service CRUD, controller REST+WebSocket et tests — par le générateur `nodefony create entity`,
  au lieu de l'écrire à la main. Porte la grammaire de champs (types, relations, index simples et
  composites), les réglages pour épouser une table SQL existante, et les trois vérités qu'on
  découvre autrement en production : la table naît au démarrage, la modifier n'altère rien, et
  aucune migration n'est produite. À charger AVANT d'écrire une entité, un repository ou un
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
se connecte qu'au démarrage), la pagination bornée, les codes 201/204/404/409/422, et l'en-tête
`Location`.

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
npx nodefony create entity Visit siteId:uuid path:string at:date \
  --index "siteId,at" --unique "siteId,path"
```

Les deux options sont **répétables** — un couple par index. Sur un schéma réel, la majorité des
index utiles sont composites : c'est ainsi qu'une table est réellement interrogée.

## Épouser une table qui existe déjà

Trois réglages, et ils ne touchent **que** le SQL — la propriété TypeScript reste `id`, `siteId` :

```bash
npx nodefony create entity Session token:string! \
  --table user_sessions --column-case snake --id-name session_id
```

Faire suivre le TypeScript aurait transformé un réglage de nommage en refonte : le service, le
controller, le tri par défaut et les tests générés nomment tous la propriété, pas la colonne.

## Les trois vérités à savoir avant de livrer

1. **La table naît au prochain démarrage en développement** (`CREATE TABLE IF NOT EXISTS`).
2. **La modifier n'altère rien** — aucun `ALTER` n'est émis. Une colonne ajoutée à une entité déjà
   créée n'apparaîtra pas dans une base existante.
3. **Aucune migration n'est produite.** Le passage en production est un geste à part.

## Ce qui refuse AVANT d'écrire

Le générateur s'arrête plutôt que de produire un fichier bancal — lis le message, il nomme le
geste :

- **hors projet** (aucun `nodefony.config.ts` au-dessus) ;
- **`@nodefony/drizzle` absent** de la cible ;
- **entité déjà déclarée** ;
- **nom réservé par un module du framework** (`User`, `session`, `access_token`,
  `audit_event`…) — un homonyme dépossède le module, et l'application ne démarre plus sur un
  message parlant d'une colonne inconnue ;
- **colonne inconnue, répétée, ou implicite absente** (`createdAt` sans horodatages).

## La suppression naît gardée — vérifie-le

Si `@nodefony/security` est dans les dépendances, l'action de suppression porte
`@IsGranted("ROLE_ADMIN")`. **Sans le module, elle n'est protégée par rien**, et le commentaire du
fichier généré le dit. Mesuré sur une application réelle avant correction : le CRUD répondait
**204 à un DELETE anonyme**.

Pour la protéger : → skill `protect-route`.

## Prouver

```bash
npm run build && npm test        # les tests générés couvrent la couche donnée
npx nodefony check               # câblage : entité orpheline, service non listé, route en :param
npx nodefony inspect entities    # ce que l'application enregistre VRAIMENT
```

`npm test` est le premier diagnostic, jamais le dernier geste.

## Voisins

| Besoin                                   | Skill                  |
| ---------------------------------------- | ---------------------- |
| Un service métier injectable             | `add-service`          |
| Réserver une route à certaines personnes | `protect-route`        |
| Un flux temps réel                       | `add-realtime-channel` |
