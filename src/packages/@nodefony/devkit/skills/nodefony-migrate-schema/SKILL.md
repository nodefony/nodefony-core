---
name: nodefony-migrate-schema
description: >
  Fait évoluer le schéma d'une base Nodefony et le porte en production, par les commandes
  `orm:generate` et `orm:migrate` du framework — jamais par un `ALTER` écrit à la main ni par la
  suppression d'une base. Porte la lecture de l'état (que l'application tourne ou non), le plan
  avant le geste, les codes de refus et le geste que chacun appelle, les trois interdits qui
  cassent un historique, et le patron de déploiement où les migrations passent AVANT les
  exemplaires. À charger AVANT de modifier une entité déjà en base, ou avant de déployer un schéma
  changé.
  Déclencheurs : "j'ai ajouté un champ à une entité", "la colonne n'existe pas en base",
  "modifier une table existante", "migration", "migrer le schéma", "orm:migrate", "orm:generate",
  "la base est en retard", "appliquer les migrations", "déployer un changement de schéma",
  "comment passer ce modèle en production", "ma base ne correspond plus au code",
  "no such column", "column does not exist", "erreur SQL après avoir changé une entité",
  "adopter une base existante", "réparer une migration en échec", "le pod ne devient pas prêt",
  "comment tester ma migration", "éprouver une migration", "vérifier qu'une migration marche",
  "prouver que ma migration s'applique", "essayer sans casser ma base", "base d'essai",
  "rejouer les migrations depuis zéro", "repartir d'une base propre".
metadata:
  version: 2
---

# Faire évoluer un schéma, et le porter en production

## 1. La seule chose à savoir avant tout le reste

**En développement, il n'y a rien à faire.** La base suit le code : la table naît au démarrage, et
un champ ajouté **qui accepte le vide** est posé au démarrage suivant.

**Deux cas seulement sortent de là**, et ce sont eux qui amènent ici :

- un champ **obligatoire** ajouté à une table qui existe déjà — il n'est jamais rattrapé ;
- **la production**, où le démarrage ne fabrique JAMAIS le schéma.

Si l'application est en développement et que le champ ajouté accepte le vide, il suffit de
redémarrer. Ne produis pas une migration pour ça.

## 2. Lire l'état — deux voies, selon que l'application tourne

L'état est **le même objet** dans les deux cas : ne le recompose jamais à partir d'autre chose.

```bash
npx nodefony orm:migrate:status --json
```

Codes de sortie, et ils ne changeront pas :

| Code | Ce que ça veut dire                                                               |
| ---- | --------------------------------------------------------------------------------- |
| `0`  | à jour                                                                            |
| `1`  | une action humaine est requise (en attente, dérive, échec, base en écart)         |
| `2`  | la commande n'a pas pu travailler (base injoignable, verrou tenu, usage invalide) |

Quand l'application **tourne**, le même état se lit par son plan d'administration, sous le rôle
d'administration : `GET /nodefony/orm/api/migrations?connector=<nom>`. Une porte MCP le catalogue
sous le domaine `orm`, chemin `migrations` — il n'y a **aucun outil dédié** à chercher.

**Lis `verdict` et `nextActions[0].command`, jamais la phrase française.** La phrase est un rendu ;
le verdict est la source.

## 3. Faire évoluer un schéma — trois gestes, dans cet ordre

```bash
npx nodefony orm:generate --name ajout_slug
```

Écrit le fichier de migration qui manque, déduit de la différence entre les entités et la dernière
migration. Le nom entre dans une identité **immuable une fois publiée** : minuscules et `_`.

```bash
npx nodefony orm:migrate --dry-run --json
```

**Le plan AVANT le geste.** Rend ce qui s'appliquerait, dans l'ordre, sans rien écrire. C'est ce
qu'on montre à un humain avant d'agir, et c'est ce qu'on relit soi-même avant de continuer.

```bash
npx nodefony orm:migrate
```

Applique sous verrou, écrit l'historique dans la même transaction que le schéma là où le moteur le
permet. **Rejouer n'applique rien** et sort `0` : les trois verbes sont idempotents, on peut donc
reprendre après une coupure sans lire d'état préalable.

> Ce que `orm:generate` ne peut pas déduire — une vue, un déclencheur, un remplissage de données —
> s'écrit dans une migration libre : `npx nodefony orm:generate --custom --name backfill_slug`
> dépose un fichier vide et son entrée de journal. Le gabarit déposé explique comment séparer les
> instructions ; suis-le à la lettre.

### 🔴 Un champ OBLIGATOIRE sur une table PEUPLÉE — ton moteur ne fait pas ce que tu crois

Ajouter une colonne `NOT NULL` **sans valeur par défaut** à une table qui porte déjà des lignes n'a
pas le même effet selon le serveur. Mesuré sur les trois, table peuplée :

| Moteur          | Ce qui se passe                                                                             |
| --------------- | ------------------------------------------------------------------------------------------- |
| sqlite          | **refus** — `Cannot add a NOT NULL column with default value NULL`                          |
| PostgreSQL      | **refus** — `column "x" of relation "y" contains null values`                               |
| MySQL / MariaDB | **accepté** — les lignes existantes reçoivent une valeur VIDE (`''`), sans un avertissement |

Les deux premiers t'arrêtent parce qu'ils ne peuvent pas inventer la valeur des lignes déjà là. Le
troisième l'invente : le champ est déclaré obligatoire et ne contient que du vide, ce qui passe tous
les contrôles et ne se voit qu'au moment où quelqu'un lit ces comptes. **Le mode strict n'y change
rien** — c'est le comportement de `ALTER TABLE … ADD COLUMN`, pas celui des insertions.

Donc, toujours, quel que soit ton moteur : **un champ obligatoire s'ajoute avec une valeur par
défaut** (`role:string=membre`), ou **se déclare facultatif** (`department:string?`). Si tu as
besoin des deux — obligatoire, et sans défaut à terme — c'est trois migrations : ajouter avec
défaut, remplir (`--custom`), puis retirer le défaut.

#### 🔴 …et si le champ est UNIQUE, le conseil ci-dessus se retourne contre toi

Une valeur par défaut est la **même pour toutes les lignes**. Sur un champ unique, elle ne répare
donc rien : elle garantit la collision dès la deuxième ligne déjà présente
(`UNIQUE constraint failed`). Et le générateur écrit l'ajout de colonne **et** son index unique
dans la MÊME migration — un enchaînement qui ne réussit que sur une table vide.

Le geste est en trois temps, et l'ordre ne s'inverse pas :

```bash
# 1. le champ, FACULTATIF et sans unicité, déclaré dans l'entité — puis :
npx nodefony orm:generate --name ajout_slug
npx nodefony orm:migrate

# 2. remplir chaque ligne d'une valeur DISTINCTE (SQL libre : le générateur ne
#    peut pas inventer la valeur métier de lignes qu'il ne connaît pas)
npx nodefony orm:generate --custom --name remplir_slug
#    → écrire l'UPDATE dans le fichier déposé, puis :
npx nodefony orm:migrate

# 3. le champ passe unique (et obligatoire si besoin) dans l'entité — puis :
npx nodefony orm:generate --name slug_unique
npx nodefony orm:migrate
```

`orm:generate` **te le dira** : il relit le SQL qu'il vient d'écrire et signale
`add-not-null-sans-defaut` et `colonne-neuve-puis-index-unique` sous « À REGARDER avant
d'appliquer ». Il ne refuse pas — il ne lit pas la base et ignore si ta table porte des lignes —,
mais s'il le signale et que ta table n'est pas vide, la migration échouera.

**À l'étape 3, sur sqlite, attends-toi à un refus `NF_GENERATE_DESTRUCTIVE`** — mesuré sur une
table de deux lignes. Rendre une colonne obligatoire n'est pas un `ALTER` en sqlite : le moteur
n'en a pas, alors l'outil RECONSTRUIT la table (`CREATE __new_billets` → `INSERT … SELECT` →
`DROP TABLE` → `RENAME`). Le `DROP TABLE` est reconnu comme destructeur, et il l'est en général —
ici il porte sur une table déjà recopiée, une ligne plus haut, dans la même migration. **Relis le
fichier avant de décider** : si tu y vois l'`INSERT INTO __new_… SELECT … FROM …` juste avant le
`DROP`, la reconstruction conserve les lignes, et `orm:migrate` l'applique sans broncher (les
fichiers sont écrits, c'est leur mise en service qui était refusée). Éprouvé de bout en bout :
deux lignes semées, trois étapes, deux lignes intactes et l'index unique en place.

> **Ne jamais** répondre à un échec de migration en refaisant la base. Une migration qui n'est pas
> passée n'a **rien** changé — sqlite et PostgreSQL l'annulent entière. C'est le fichier qu'il faut
> découper, pas les données qu'il faut sacrifier. Et si tu dois t'y reprendre à plusieurs fois,
> `NF_MIGRATE_DATABASE_URL` détourne la commande vers une base d'ESSAI et laisse la tienne intacte.

### La base existait AVANT toute migration — un geste de plus, une seule fois

Une application passée du mode développement à la production a ses tables **et** un dossier
`migrations/` vide. Dans cet état, `orm:generate` refuse — `NF_GENERATE_DATABASE_NOT_ADOPTED` :
la première migration décrirait la création de tables qui existent déjà, avec leurs données, et
l'adopter graverait dans l'historique un schéma que la base n'a pas.

```bash
npx nodefony orm:migrate:baseline --from-database   # la référence est LUE sur la base
npx nodefony orm:generate --name ajout_du_slug      # produit un ALTER, plus un CREATE
npx nodefony orm:migrate
```

`--from-database` lit le schéma de la base, en écrit la migration de référence et l'inscrit comme
appliquée. **Aucune instruction n'est exécutée sur la base.** À faire une fois, avant tout le reste.

Deux choses qu'il rapporte et qu'il faut lire :

- **des tables lues sans être déclarées** — la base est partagée avec autre chose. L'outil de
  lecture ne sait pas restreindre son champ ; ces tables entrent dans la référence, et la
  génération suivante proposera de les SUPPRIMER. Relis le fichier avant de continuer.
- **un corps resté en commentaire** — la référence ne recréerait rien sur une base neuve.

> ⚠️ **Sur MariaDB, `--from-database` ne fonctionne pas**, et il le dit au lieu de mourir. MariaDB
> écrit le type JSON en `longtext` + `CHECK (json_valid(…))`, que l'outil de lecture ne sait pas
> relire — et il lit la base ENTIÈRE avant de filtrer, donc les tables du framework suffisent à le
> bloquer. Le repli, sur ce serveur : relever le schéma (`SHOW CREATE TABLE`), le coller dans un
> `orm:generate --custom --name base_existante`, puis `orm:migrate:baseline`.
> Cela ne concerne QUE cette commande de reprise : la création des tables, leur migration et le
> fonctionnement de l'application sont inchangés sur MariaDB.

## 4. Éprouver une migration — sur une base d'ESSAI, jamais sur la tienne

Quand il faut **prouver** qu'une migration fait ce qu'elle annonce, la réponse n'est jamais de
détruire la base pour repartir de zéro : c'est de migrer **ailleurs**.

`NF_MIGRATE_DATABASE_URL` sert exactement à ça. Elle remplace la connexion pour les quatre
commandes de migration — `orm:migrate`, `orm:migrate:status`, `orm:migrate:baseline`,
`orm:migrate:repair` — et **pour elles seules** : ni le démarrage de l'application, ni `orm:reset`,
ni un store ne la lisent. Ta base de développement n'est pas ouverte pendant l'essai ; elle n'est
même pas touchée.

**Deux décors, deux questions différentes. Choisis selon ce que tu dois prouver.**

### a. Une base NEUVE — « la suite s'applique-t-elle depuis zéro ? »

C'est le décor d'une installation propre, et celui d'un nouvel environnement.

```bash
# sqlite : un fichier qui n'existe pas encore suffit — le pilote le crée.
# PowerShell : $env:NF_MIGRATE_DATABASE_URL = "sqlite:./var/databases/essai.sqlite"
export NF_MIGRATE_DATABASE_URL="sqlite:./var/databases/essai.sqlite"

npx nodefony orm:migrate --dry-run --json   # le plan : ce qui s'appliquerait, rien d'écrit
npx nodefony orm:migrate --json             # applique — sur la base d'essai
npx nodefony orm:migrate:status --json      # doit rendre `up-to-date`, code 0
```

Sur PostgreSQL ou MySQL, la base d'essai se crée à côté (`CREATE DATABASE app_essai;`) et l'URL la
désigne. Le dialecte doit être le MÊME que celui du connecteur : viser une base d'un autre dialecte
est refusé — `NF_MIGRATE_URL_MISMATCH`, rien n'est appliqué. Ce refus est une protection, pas un
obstacle à contourner.

### b. Une COPIE de ta base — « s'applique-t-elle sur mes données ? »

C'est le décor qui compte pour une migration qui touche des lignes existantes : un champ
obligatoire ajouté à une table déjà remplie, un remplissage, une contrainte resserrée. Une base
neuve ne prouve RIEN de tout ça — elle est vide.

```bash
# sqlite : une copie du fichier. Le chemin par défaut du connecteur `default` est
# `var/databases/nodefony-drizzle.db` — `orm:migrate:status --json` le confirme.
cp var/databases/nodefony-drizzle.db /tmp/essai.sqlite
# PostgreSQL : CREATE DATABASE app_essai TEMPLATE app;  (ou une restauration de sauvegarde)

export NF_MIGRATE_DATABASE_URL="sqlite:/tmp/essai.sqlite"
npx nodefony orm:migrate --json
```

### Ce qui fait la PREUVE

Trois choses, et elles se montrent :

1. **Le verdict** : `orm:migrate:status --json` rend `up-to-date` et le code `0` sur la base
   d'essai.
2. **Ce que la base porte vraiment** — les tables et les colonnes attendues sont là. Un verdict
   `up-to-date` dit que l'historique est complet, pas que le schéma te convient.
3. **Que ta base n'a pas bougé.** Montre-le au lieu de l'affirmer : une empreinte avant et après
   (`shasum -a 256 var/databases/nodefony-drizzle.db`) doit être **identique**.

> Et si l'essai échoue, il échoue sur la base d'essai. C'est tout l'intérêt : on jette le fichier,
> on corrige la migration, on recommence. Rien à réparer, rien à réexpliquer.

🔴 **Quand l'essai est fini, RETIRE la variable** — `unset NF_MIGRATE_DATABASE_URL` (PowerShell :
`Remove-Item Env:NF_MIGRATE_DATABASE_URL`). Oubliée dans le terminal, elle détourne
silencieusement chaque commande de migration suivante vers la base d'essai : `orm:migrate` rend
« appliqué » et le code du succès, pendant que ta vraie base ne reçoit rien. Le seul symptôme
arrive plus tard, quand l'application démarre sur un schéma qui n'a pas bougé.

Tu n'as rien à interroger pour savoir où tu tapes : **chaque commande de migration annonce la base
qu'elle vise**. Quand une variable la détourne, l'en-tête de l'état le dit en toutes lettres —
« ⚠ NF_MIGRATE_DATABASE_URL détourne ce connecteur vers … » — et la charge utile `--json` porte le
même fait (`driver.target`). C'est le même chemin pour l'écran et pour la machine : les deux ne
peuvent pas diverger.

```bash
nodefony orm:migrate:status
```

> ⚠️ **`orm:migrate:baseline` n'est pas un outil d'essai.** Il sert à ADOPTER une base qui porte
> déjà les tables sans historique — une fois, à la reprise d'un existant. S'en servir pour se
> fabriquer un décor de départ écrit un historique faux dans la base visée : les migrations
> adoptées y sont marquées appliquées sans l'avoir été. Pour un décor de départ, c'est le §4 —
> une base d'essai, et rien d'autre.

## 5. Les refus, et le geste que chacun appelle

Un refus n'est pas une panne : c'est le produit qui s'arrête devant une décision qui t'appartient.
Le `code` est stable — **lis-le, il désigne le geste**.

| Code                               | Ce qui s'est passé                                          | Le geste                                                                                                             |
| ---------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `NF_MIGRATE_BASELINE_REQUIRED`     | la base porte déjà les tables, sans aucun historique        | `orm:migrate:baseline` (l'adopter)                                                                                   |
| `NF_GENERATE_DATABASE_NOT_ADOPTED` | aucune migration n'existe, et la base porte déjà ces tables | `orm:migrate:baseline --from-database`, PUIS regénérer                                                               |
| `NF_MIGRATE_BASELINE_NOT_EMPTY`    | `--from-database` demandé alors que des migrations existent | `orm:migrate:baseline` sans option                                                                                   |
| `NF_MIGRATE_FAILED_MARKER`         | une migration a échoué, ou n'a jamais fini                  | LIRE l'erreur, puis `orm:migrate:repair`                                                                             |
| `NF_MIGRATE_HASH_MISMATCH`         | un fichier déjà appliqué a été modifié                      | RÉTABLIR le fichier (1er geste) ; `--update-hashes` seulement si la modification était sans effet                    |
| `NF_MIGRATE_OUT_OF_ORDER`          | une migration en attente se range avant la dernière posée   | renommer la nouvelle après la dernière appliquée                                                                     |
| `NF_MIGRATE_MISSING_FILE`          | une migration appliquée n'a plus de fichier                 | rétablir le fichier — il fait partie de l'historique                                                                 |
| `NF_GENERATE_DATABASE_BEHIND`      | rien à écrire, et pourtant la base ne porte pas le schéma   | l'historique affirme une migration jamais exécutée : `orm:migrate:repair --forget <source>/<tag>` puis `orm:migrate` |
| `NF_MIGRATE_LOCK_TIMEOUT`          | un autre travail de migration tient le verrou               | ATTENDRE puis rejouer — ce n'est pas une panne, et le verbe est idempotent                                           |
| `NF_MIGRATE_DESTRUCTIVE`           | les migrations en attente SUPPRIMENT des données            | lire le SQL (`--dry-run`), puis assumer avec `--allow-destructive`                                                   |

Les codes exhaustifs, avec un exemple de charge utile pour chacun :
[`references/verdicts.md`](references/verdicts.md).

## 6. Les trois interdits

Chacun casse l'historique de façon irrattrapable, et aucun ne produit d'erreur au moment où on le
commet.

1. **Ne jamais modifier un fichier `.sql` déjà appliqué.** Son empreinte est enregistrée : le
   modifier fait basculer le verdict en dérive sur toutes les bases où il est passé. Une correction
   s'écrit dans une migration NEUVE.
2. **Ne jamais toucher à la table d'historique à la main.** Elle est le seul témoin de ce qui a été
   appliqué ; une ligne ajoutée ou retirée à la main fait mentir tous les verdicts suivants.
   L'interdit porte sur le client SQL, pas sur le produit : quand l'historique affirme une migration
   que la base n'a jamais reçue, le geste existe et il est borné —
   `orm:migrate:repair --forget <source>/<tag>` désinscrit UNE entrée nommée, pour qu'elle soit
   rejouée. Il ne touche pas la base ; si la migration avait bien été appliquée, son rejeu échouera.
3. **Ne jamais renuméroter ni renommer une migration publiée.** L'identité voyage : elle est
   enregistrée dans chaque base où la migration est passée.

Et un quatrième, qui n'est pas un interdit d'historique mais de méthode : **ne supprime pas une
base pour « repartir propre »**, et n'efface pas non plus son dossier de données. La commande qui
le fait (`orm:reset`) existe, refuse partout sauf en développement, et n'est jamais la réponse à
une migration qui refuse.

**Ce qu'il faut faire à la place** : migrer une base d'ESSAI — c'est le §4, et il couvre les deux
besoins qui poussent à détruire. « Je veux vérifier que ma migration part d'une base propre » →
décor (a), une base neuve. « Je veux la voir passer sur des données » → décor (b), une copie. Dans
les deux cas tu obtiens la même preuve, en gardant ta base ET son historique.

## 7. En production — les migrations passent AVANT les exemplaires

Le patron, et il n'a pas d'alternative raisonnable : **un travail dédié applique les migrations, et
se termine avant que le premier nouvel exemplaire ne démarre**. Les exemplaires, eux, ne fabriquent
jamais de schéma.

Une application générée avec une base SQL porte déjà cette recette dans `deploy/migrate-job.yaml`,
rendue à son nom. Ne la réécris pas : lis son en-tête, il porte le mode d'emploi.

Trois faits qui évitent trois faux diagnostics :

- **Un exemplaire dont la base est en retard répond `503` sur `/readyz`** (jamais sur `/livez`) et
  reste hors du répartiteur de charge. Ce n'est pas une panne : c'est la protection. Applique les
  migrations, les exemplaires se mettent en service **seuls**.
- **Le compte qui migre n'est pas celui qui sert.** `NF_MIGRATE_DATABASE_URL` remplace la connexion
  pour la commande de migration seulement — c'est le véhicule du moindre privilège, et elle doit
  désigner une connexion **directe** (un répartiteur de connexions en mode transaction casse le
  verrou).
- **Pendant un remplacement progressif, l'ancien et le nouveau code coexistent.** Une migration
  doit donc rester compatible avec la version précédente : on AJOUTE d'abord (colonne facultative,
  table, index), on retire dans une version ULTÉRIEURE.

## 8. Ce que tu n'as pas le droit de faire, et pourquoi ce n'est pas une consigne

En production, appliquer des migrations depuis un serveur qui sert le trafic est **refusé par le
produit**, pas déconseillé : le point d'application du plan d'administration refuse hors
développement, et le compte de base de données d'un exemplaire n'a pas le droit de modifier un
schéma. Un refus du moteur est bruyant ; ne cherche pas à le contourner, c'est le travail de
déploiement qui porte ce droit.

En développement, à l'inverse, appliquer est normal — c'est là que le cycle complet se joue.

## 9. Quand passer la main

| Le besoin                                                     | Où aller                                            |
| ------------------------------------------------------------- | --------------------------------------------------- |
| Créer une entité, un service CRUD, un controller de ressource | skill `nodefony-add-crud`                           |
| Comprendre la grammaire de champs et les index                | skill `nodefony-add-crud`                           |
| Le détail des codes de verdict, avec un exemple par code      | `references/verdicts.md`                            |
| Ce que le module publie sur les migrations                    | `node_modules/@nodefony/drizzle/docs/migrations.md` |
