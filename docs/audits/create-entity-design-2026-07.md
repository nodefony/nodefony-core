---
title: "`nodefony create entity` — design"
audience: humain + IA
status: validé
module: cli / orm-core / framework
---

# `nodefony create entity` — design

> **Statut** : design validé, implémentation à suivre.
> Document de référence — il porte les décisions ET les alternatives rejetées, pour qu'on ne
> re-instruise pas deux fois les mêmes questions.

---

## 1. Le problème

Trois constats, vérifiés au code.

**La chaîne existe déjà, personne ne la câble.** Nodefony a ses quatre couches — `Entity` (descripteur
`IEntity`) → `IRepository<T>` (14 méthodes portables) → `AbstractCrudService<T, R>` (hooks + events) →
`ResourceController<T>` (helpers `listResource`/`getResource`, scope singleton). Le module `test` en
donne même la preuve : `PocBookResourceController` sert **REST et WebSocket depuis la même méthode**
(`requirements: { methods: ["GET", "WEBSOCKET"] }`). Mais aucun CRUD du repo n'est branché sur un vrai
repository : le template `create controller --kind rest` stocke dans une `Map` en mémoire, avec le
commentaire « remplace par un repository (`create entity`) ».

**Une application n'a nulle part où déclarer ses entités.** L'enregistrement est impératif
(`entityRegistry.register(descriptor)`), il doit précéder `orm.connect()` (`DrizzleService` connecte à
`onBoot`), et il n'existe **aucune découverte automatique**. Le décorateur `@entities([...])` n'existe
pas — le moteur de scaffold l'attend pourtant déjà (`wireDecoratorList(indexPath, "controllers" |
"entities", …)` : la cible a été prévue, jamais écrite). Une app générée (`tmp/cci-app`) n'a donc aucun
point d'ancrage : ses entités seraient enregistrées par un import à effet de bord, ou pas du tout.

**Le DDL dev ment par omission.** `DrizzleOrm` dérive un `CREATE TABLE IF NOT EXISTS` au `connect()`
(dev/test). Ajouter une entité → sa table apparaît au prochain boot. **Modifier** une entité existante →
**rien** (`IF NOT EXISTS`), la colonne n'est jamais ajoutée. Les migrations sont conçues
([`orm-migrations-design-2026-07.md`](./orm-migrations-design-2026-07.md)) mais gelées.

---

## 2. État de l'art (ce qu'il nous apprend)

| Framework             | Interaction                     | Champs déclarés où           | Réentrant                   | Migration                             | CRUD généré                                   | Validation                        |
| --------------------- | ------------------------------- | ---------------------------- | --------------------------- | ------------------------------------- | --------------------------------------------- | --------------------------------- |
| Symfony (MakerBundle) | **interactif, champ par champ** | prompts                      | **oui** (`--regenerate`)    | **diff** (`doctrine:migrations:diff`) | `make:crud` (controller + form + 6 vues)      | FormType + Validator              |
| NestJS                | 1 question (le transport)       | **nulle part** (entité vide) | non                         | aucune                                | `nest g resource` (module+ctrl+svc+DTO+specs) | DTO **classes** + class-validator |
| Rails                 | non-interactif                  | `title:string body:text`     | non (→ migration `AddXToY`) | templatée depuis le **nom**           | `scaffold` (jusqu'aux vues)                   | dans le modèle                    |
| Laravel               | non-interactif                  | à la main (migration)        | non                         | templatée vide                        | flags composables `-mfscrR`                   | Form Requests                     |
| AdonisJS              | non-interactif                  | à la main                    | non                         | templatée vide                        | `--resource` / `--api`                        | VineJS (validators séparés)       |
| Prisma / Drizzle      | —                               | le **schéma** est la vérité  | oui (on ré-édite)           | **diff** (shadow DB / snapshot)       | **aucun**                                     | via générateurs tiers             |

**La leçon centrale** : le monde TypeScript moderne (Prisma, Drizzle) a **supprimé le générateur
d'entité** — le schéma est la source de vérité, l'outil ne fait plus qu'un diff vers une migration, et
**personne n'y régénère de service ni de controller**. Les frameworks qui génèrent la ressource complète
(Rails, Nest, Laravel, Symfony) ne sont branchés sur aucun ORM TypeScript typé.

Le trou est exactement le nôtre : **nous avons les quatre couches ET un controller HTTP+WS unique**.
Personne d'autre ne peut générer ça. `create entity` doit donc être un **scaffold de ressource** (école
Rails), pas un éditeur de schéma (école Drizzle).

---

## 3. Décisions

### D1 — La commande génère la ressource COMPLÈTE, avec des flags pour dégrader

Par défaut : table Drizzle + interface de ligne + schémas Zod + service CRUD + controller REST/WS +
tests. `--no-controller`, `--no-service` dégradent.

_Pourquoi_ : Laravel/Adonis ont raison sur les flags composables (« un flag = un artefact »), mais Rails
a raison sur le **défaut** : un scaffold qui s'arrête à la table laisse l'utilisateur devant le vrai
travail — et surtout, il n'**enseigne pas** l'architecture (le CRUD vit dans le service, jamais dans le
controller : décision figée). Le code généré est explicite, donc supprimable.

_Rejeté_ : le modèle Nest (`entity` vide + service stub in-memory) — il génère du code que tout le monde
réécrit, et n'apprend rien de l'ORM.

### D2 — Champs : une ligne comme Rails, un dialogue comme Symfony

```
nodefony create entity Post title:string content:text published:bool author:ref:User
```

Si les champs manquent **et** qu'on est dans un terminal → on les demande un par un (type, nullable,
unique/index), façon MakerBundle. Hors TTY (CI) → ce qui est passé en argv, rien de plus.

Vocabulaire **Nodefony**, jamais Drizzle : `string, text, int, float, bool, json, date, uuid, ref:<Entity>`.
Modificateurs suffixés : `?` nullable · `!` unique · `:index`.
**Non-null par défaut** : une colonne nullable est une décision, pas un oubli (Symfony le demande à
chaque champ ; Rails défaute à nullable, et on le regrette).

_Pourquoi les deux modes_ : le one-liner sert les scripts, la CI et Studio (la spec est JSON-able) ; le
dialogue est ce qui rend le scaffold **correct** plutôt que « à retoucher » — c'est la raison pour
laquelle le générateur de Symfony reste utile après le jour 1.

### D3 — Le dialecte : du Drizzle NATIF, celui du connecteur

La table générée est `sqliteTable` / `pgTable` / `mysqlTable` selon le dialecte lu dans la config du
connecteur ciblé (`--connector default`, `--dialect` pour forcer).

_Rejeté_ : réutiliser le `colKit` multi-dialecte interne de `@nodefony/drizzle`. Un audit a décidé de ne
pas l'exposer (« sur-promesse d'API à maintenir ») et c'est juste : le scaffold doit écrire **le code que
l'utilisateur aurait écrit**, avec accès à tous les types de son moteur, pas une couche d'abstraction de
plus. Le framework, lui, garde `colKit` pour SES entités (qui, elles, doivent tourner sur 3 dialectes).

_Conséquence assumée_ : une entité d'app n'est pas portable d'un dialecte à l'autre sans regénération.
C'est le comportement de Drizzle lui-même.

### D4 — Le point d'ancrage : créer le décorateur `@entities([...])` (brique framework #1)

Symétrique de `@controllers([...])`, posé sur la classe `Module` de l'app ou du module :

```ts
@entities([PostEntity, CommentEntity])
@controllers([PostController])
class App extends Module { … }
```

_Pourquoi lui_ plutôt qu'un import à effet de bord (qui suffirait techniquement, puisque `@entity`
s'auto-enregistre) :

1. une entité oubliée devient **visible** (absente d'une liste) au lieu d'être silencieusement absente ;
2. le module redevient l'endroit qui **déclare ce qu'il apporte** — cohérence pédagogique avec les
   controllers, les services ;
3. Studio pourra lister les entités **par module** (l'axe `module` d'`IEntity` existe déjà) ;
4. le wiring du scaffold l'attend déjà (`wireDecoratorList` accepte `"entities"`).

**Phase** : le mixin s'accroche à `onRegister` — une phase **plus tôt** que `@controllers` (`onBoot`),
parce que `DrizzleService` connecte à `onBoot` et que `entityRegistry.register()` doit précéder le
`connect()`. Piège gravé : ne jamais déplacer ce hook vers `onBoot`.

**`defineEntity()`** (helper `orm-core`) : le descripteur généré ne fige **pas** l'ORM (`orm` est le nom
d'un connecteur, donc une donnée de config, pas une donnée de code) ; le décorateur le résout —
`@entities([...], { connector: "default" })`, ou par entité.

_Rejeté_ : le décorateur de classe `@entity({ connector, schema })` existant (`orm-core`) — il exige de figer
l'ORM **à l'import**, ce que le code du framework refuse déjà explicitement (« le `connector` est dynamique :
le schéma est statique mais sa liaison à un ORM dépend de la config »). Zéro usage en production, et
pour cause.

### D5 — La validation vit à la frontière, en Zod, dans le SERVICE

Le générateur émet `createPostSchema` et `updatePostSchema = createPostSchema.partial()` (dérivé, jamais
dupliqué — le `PartialType` de Nest). La validation s'exécute dans le **service** (hook `beforeCreate`),
donc REST, WebSocket, GraphQL et CLI en bénéficient sans duplication — application directe de la
décision « le CRUD vit dans le service ».

**On ne copie pas les DTO-classes de Nest.** Elles n'existent que parce que TypeScript efface les
interfaces au runtime (les pipes ont besoin d'un « metatype »). Zod est une **valeur runtime** : le
problème ne se pose pas. Bonus gratuit : le `strip` de Zod nous donne l'anti-mass-assignment (l'équivalent
du `whitelist` de Nest) par construction.

### D6 — Erreur de validation → **422**, pas 400 (brique #2)

`ZodError` → `422 Unprocessable Content` : la syntaxe de la requête est correcte, c'est la **sémantique**
qui est invalide (MDN / RFC 9110 §15.5.21). Un 400 dirait « JSON malformé », ce qui est faux et fait
perdre du temps au client. Le corps porte `error.fields` (`[{field, message, rule}]`) : le client sait
**quel** champ corriger.

**Où** : `@nodefony/http`, dans `DefaultErrorRenderer.toHttpError()` — et non dans le framework comme
envisagé d'abord. C'est LE point central où une erreur devient un statut, il couvre **HTTP et WebSocket**
d'un coup (un 422 devient un code de fermeture 4004 côté WS, pas 1011 : le client ne doit pas reconnecter
en boucle comme sur une erreur serveur), et il ne coûte **rien au chemin nominal** — il ne s'exécute que
sur une erreur déjà levée. Un `try/catch` dans le Resolver aurait touché le hot path pour le même service.

**Reconnaissance structurelle** (`name === "ZodError"` + `Array.isArray(issues)`), jamais `instanceof` :
une app peut embarquer sa propre copie de zod (résolutions npm multiples) et l'`instanceof` échouerait
**en silence** → la validation retomberait en 500. Même parti-pris que le duck-typing d'`isPromise`.

### D7 — Identifiants : UUIDv7 par défaut (brique framework #3)

PK `text` + **UUIDv7** (RFC 9562) : préfixe temporel 48 bits → **ordonné dans le temps**, donc bonne
localité d'index (l'UUIDv4 fragmente les B-tree à chaque insertion), et **non énumérable** (contrairement
à l'auto-incrément, qui offre l'énumération gratuite de toutes les ressources).

- `--id uuid4` quand l'**imprédictibilité** prime (RFC 9562 : « MUST NOT be used as security
  capabilities » — un UUIDv7 laisse fuiter l'instant de création et se devine partiellement).
- `--id serial` pour une table interne (jamais exposée).

**`crypto.randomUUIDv7()` est NATIF** (présent dès Node 24 = notre `engines` minimum) — vérifié au
runtime : nibble de version `7`, variant RFC, horodatage décodable. Aucune bibliothèque, aucun
générateur maison. Le core ajoute simplement `Nodefony.generateSortableId()` qui l'expose (il n'avait
que `generateId()` = UUIDv4).

⚠️ **Piège vérifié — pas de monotonie intra-milliseconde.** Node n'implémente pas le compteur monotone
optionnel de la RFC (§6.2) : sur 20 000 identifiants générés d'affilée, **10 005 inversions** d'ordre
(0 collision). Deux UUIDv7 créés dans la **même milliseconde** ne sont donc pas ordonnés entre eux.
Conséquences : la **localité d'index est bien acquise** (le préfixe de 48 bits ordonne au fil des
millisecondes — c'est le seul but recherché), mais **on ne trie jamais par identifiant** pour ordonner
des créations : on trie par `createdAt` (l'identifiant ne sert que de départage stable).

⚠️ **Piège vérifié — `randomUUID({ version: 7 })` ne fait PAS de v7** : l'option est ignorée en silence
et renvoie un UUIDv4 (nibble `4`). Seul `randomUUIDv7()` produit un v7.

### D8 — REST correct par construction

`201` + en-tête **`Location`** à la création · `204` sur suppression · `404` · **`409`** sur violation
d'unicité ou requête concurrente · **`422`** sur validation · `@Idempotent()` (déjà dans le framework)
sur le `POST` — les POST ne sont pas idempotents par RFC 9110, et le draft IETF `Idempotency-Key` impose
409 sur requête concurrente / 422 sur même clé + payload différent.

Pas de routes `create`/`edit` (formulaires HTML) : `--api` est le seul mode — c'est le bon défaut pour un
framework sans templates serveur (Laravel et Adonis ont le même flag).

### D9 — Pagination `limit`/`offset` plafonnée, **et on le dit**

Défaut 25, maximum 100 (plafonner plutôt qu'erreur — AIP-158). Le curseur opaque (le bon design : un
`OFFSET` se dégrade en O(n) et saute des lignes sous insertion concurrente) viendra avec la dette de
pagination des stores, déjà identifiée. Le generateur **annonce** la limite au lieu de la masquer.

### D10 — Pas de réentrance en v1 (et c'est une décision, pas un manque)

`create entity Post` refuse si `Post` existe (sauf `--force`). Pas de `--add published:bool`.

_Pourquoi_ : sans migrations, ajouter une colonne à une entité existante ne fait **rien** en base (DDL
dev = `CREATE TABLE IF NOT EXISTS`). Un `--add` donnerait l'illusion que ça marche — jusqu'à l'erreur SQL
en lecture. La réentrance s'ouvrira **avec** les migrations (design S5, validé, gelé), où elle devient
gratuite : éditer le schéma, `orm:generate` fait le diff. C'est le modèle Prisma/Drizzle.

### D11 — La commande dit la vérité sur la base

Sortie finale (façon `make:migration` de Symfony, qui imprime les « next steps » au lieu d'appliquer) :

```
Entité Post créée.
  table   posts (sqlite) — créée au prochain boot en dev (CREATE TABLE IF NOT EXISTS)
  ⚠ prod  aucune migration générée (orm:migrate n'existe pas encore)
  ⚠ modifier une entité existante n'altère PAS la table (pas d'ALTER en dev)
  REST    GET|POST /api/posts · GET|PUT|DELETE /api/posts/{id}   (+ WS : mêmes routes)
```

---

## 4. Les trois briques ajoutées au framework

| #   | Brique                                                                            | Où                                  | Pourquoi elle dépasse le scaffold                                        |
| --- | --------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------ |
| 1   | `defineEntity()` + décorateur `@entities([...], { connector })`                   | `@nodefony/orm-core`                | Donne enfin à une **app** un point de déclaration de ses entités (D4)    |
| 2   | `ZodError` → `422` (+ `error.fields`)                                             | `@nodefony/http` (`error-renderer`) | Tout endpoint validé par Zod en bénéficie, HTTP **et** WS (D6)           |
| 3   | `Nodefony.generateSortableId()` — façade sur le **`crypto.randomUUIDv7()` natif** | `nodefony` (core)                   | Le core ne sait faire que de l'UUIDv4 ; le v7 est natif dès Node 24 (D7) |

### Déclaratif ou impératif : la frontière (à ne pas brouiller)

Les entités **existantes du repo ne migrent pas** vers `@entities`, et ce n'est pas un reste à faire :

- **`@entities([...])`** — les entités qu'un module **déclare**, au schéma écrit et **statique**. C'est
  tout ce que `create entity` génère, et tout ce qu'un utilisateur écrit à la main. **C'est la voie de
  l'utilisateur.**
- **`entityRegistry.register()`** — les entités dont l'existence ou le schéma **dépendent du runtime** :
  les entités framework de `@nodefony/drizzle` (leur table est fabriquée à partir du dialecte lu dans la
  config — `createUserTable(dialect)` — et filtrée par les dialectes où elle est portée), ou les 410
  tables Dolibarr du module `test` (import massif sur un connecteur dédié). **C'est de la plomberie de
  module ORM.** Une liste constante n'y a aucun sens.

---

## 5. Spécification de la commande

```
nodefony create entity <Name> [champs…] [options]

champs      name:type[?|!][:index]      ex : title:string  slug:string!  views:int  meta:json?
            types : string text int float bool json date uuid ref:<Entity>

--module <nom>        cible un module local (défaut : l'app racine)
--connector <nom>     connecteur ORM (défaut : "default")
--dialect <d>         force le dialecte (défaut : lu dans la config du connecteur)
--orm <drizzle|mongoose>   défaut : déduit des deps de la cible
--id <uuid7|uuid4|serial>  défaut : uuid7
--route </api/posts>  défaut : /api/<kebab-pluriel>
--soft-delete         colonne deletedAt + filtrage automatique dans le service
--no-timestamps       retire createdAt/updatedAt (présents par défaut)
--no-service          n'émet pas le service CRUD (implique --no-controller)
--no-controller       n'émet pas le controller REST/WS
--no-tests            n'émet pas les tests
--force               écrase une entité existante
```

### Fichiers émis (cible = app racine ou `modules/<x>/`)

```
nodefony/entity/Post.ts            table Drizzle native + interface PostRow + PostEntity (defineEntity)
nodefony/entity/Post.schema.ts     createPostSchema / updatePostSchema (Zod)
nodefony/service/PostService.ts    extends AbstractCrudService<PostRow> — validation + hooks + events
nodefony/controllers/PostController.ts  extends ResourceController<PostRow> — REST + WS, 201/204/404/409/422
tests/post.test.ts                 CRUD de bout en bout (sqlite mémoire)
index.ts                           ← WIRING : @entities([PostEntity]) + @controllers([PostController])
```

### Gardes AVANT écriture (aucun fichier écrit si une garde tombe)

- hors projet Nodefony → refus actionnable ;
- **aucun module ORM dans les deps de la cible** (`@nodefony/drizzle` / `@nodefony/mongoose`) → refus
  avec le geste exact (modèle : la garde `@nodefony/realtime` de `create controller`) — ne jamais générer
  du code mort ;
- entité déjà déclarée (nom présent dans `@entities([...])`) → refus (sauf `--force`) ;
- `ref:<Entity>` pointant une entité inconnue → refus.

---

## 6. Wiring et ordre de boot (le piège)

```
onPreRegister   modules chargés (manifeste `config.modules`)
onRegister      @entities  → entityRegistry.register(...)      ← ICI, et pas ailleurs
onPreBoot       services créés
onBoot          DrizzleService.connect() → CREATE TABLE IF NOT EXISTS  · @controllers → Router
```

Enregistrer les entités à `onBoot` (comme `@controllers`) serait une **course** avec le `connect()` :
selon l'ordre des listeners, la table n'existerait pas. `onRegister` est strictement antérieur → sûr.

---

## 7. Ce que la commande n'est PAS

- **Pas un générateur de migration** : elle n'écrit aucun SQL. Quand `orm:generate` existera (S5), c'est
  lui qui fera le diff — jamais le scaffold (règle empruntée à Prisma/drizzle-kit, et à
  `make:migration` de Symfony qui délègue à `doctrine:migrations:diff`).
- **Pas un éditeur d'entité** (D10).
- **Pas une abstraction ORM** : elle écrit du Drizzle natif (D3).

---

## 8. Lots d'implémentation

| Lot    | Contenu                                                                                                | Gate                                                          |
| ------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| **L1** | Briques framework : `defineEntity` + `@entities` (orm-core), UUIDv7 (core), `ZodError`→422 (framework) | tests unitaires des 3 briques ; suite core + framework vertes |
| **L2** | Scaffold : `CREATE_TYPES` + spec + `runEntityScaffold` + templates (drizzle 3 dialectes)               | tests moteur (spec JSON-able, rendu, wiring, gardes)          |
| **L3** | Preuve terrain : entité créée dans une app générée, boot réel, CRUD REST **et** WS exercés             | `curl` + client WS ; table créée ; 201/404/422 vérifiés       |
| **L4** | Docs (`cli`, `orm-core`, `drizzle`) + `MIGRATION_STATUS` + skill `nodefony-create-module` (renvoi)     | doc à jour, 0 date dans les MEMORY                            |

## 9. Pièges gravés

- `@entities` hooke **`onRegister`**, jamais `onBoot` (§6).
- L'`orm` d'une entité est une **donnée de config**, pas de code : ne jamais le figer à l'import.
- Le DDL dev **n'émet pas** les `DEFAULT` SQL (les défauts sont JS-level, `$defaultFn`) ni les **index**
  déclarés (lus seulement par drizzle-kit) : ne pas promettre le contraire dans la doc générée.
- Soft delete + contrainte `UNIQUE` : il faut un **index partiel** `WHERE deleted_at IS NULL`, sinon une
  ligne supprimée bloque la recréation (piège classique, non résolu par Laravel).
- `422` ≠ `400` (D6). `409` sur unicité violée, pas 500.
- UUIDv7 : **jamais de tri par identifiant** pour ordonner des créations (pas de monotonie intra-ms,
  mesuré) ; `randomUUID({version: 7})` **n'existe pas** — c'est `randomUUIDv7()` (D7).
