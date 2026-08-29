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
export NF_MIGRATE_DATABASE_URL="sqlite:$(mktemp -d)/essai.sqlite"

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

Aucun verdict n'annonce aujourd'hui la base visée : **c'est l'environnement qui te le dit**, et il
est le seul à le savoir.

```bash
env | grep NF_MIGRATE_DATABASE_URL   # vide = tu vises bien la base du connecteur
```

> ⚠️ **`orm:migrate:baseline` n'est pas un outil d'essai.** Il sert à ADOPTER une base qui porte
> déjà les tables sans historique — une fois, à la reprise d'un existant. S'en servir pour se
> fabriquer un décor de départ écrit un historique faux dans la base visée : les migrations
> adoptées y sont marquées appliquées sans l'avoir été. Pour un décor de départ, c'est le §4 —
> une base d'essai, et rien d'autre.

## 5. Les refus, et le geste que chacun appelle

Un refus n'est pas une panne : c'est le produit qui s'arrête devant une décision qui t'appartient.
Le `code` est stable — **lis-le, il désigne le geste**.

| Code                           | Ce qui s'est passé                                        | Le geste                                                 |
| ------------------------------ | --------------------------------------------------------- | -------------------------------------------------------- |
| `NF_MIGRATE_BASELINE_REQUIRED` | la base porte déjà les tables, sans aucun historique      | `orm:migrate:baseline` (l'adopter)                       |
| `NF_MIGRATE_FAILED_MARKER`     | une migration a échoué, ou n'a jamais fini                | LIRE l'erreur, puis `orm:migrate:repair`                 |
| `NF_MIGRATE_HASH_MISMATCH`     | un fichier déjà appliqué a été modifié                    | rétablir le fichier, ou écrire une migration correctrice |
| `NF_MIGRATE_OUT_OF_ORDER`      | une migration en attente se range avant la dernière posée | renommer la nouvelle après la dernière appliquée         |
| `NF_MIGRATE_MISSING_FILE`      | une migration appliquée n'a plus de fichier               | rétablir le fichier — il fait partie de l'historique     |

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
