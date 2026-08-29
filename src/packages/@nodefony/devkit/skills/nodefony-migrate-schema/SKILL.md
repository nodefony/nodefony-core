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
  "adopter une base existante", "réparer une migration en échec", "le pod ne devient pas prêt".
metadata:
  version: 1
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

## 4. Les refus, et le geste que chacun appelle

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

## 5. Les trois interdits

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
base pour « repartir propre »**. La commande qui le fait (`orm:reset`) existe, refuse partout sauf
en développement, et n'est jamais la réponse à une migration qui refuse.

## 6. En production — les migrations passent AVANT les exemplaires

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

## 7. Ce que tu n'as pas le droit de faire, et pourquoi ce n'est pas une consigne

En production, appliquer des migrations depuis un serveur qui sert le trafic est **refusé par le
produit**, pas déconseillé : le point d'application du plan d'administration refuse hors
développement, et le compte de base de données d'un exemplaire n'a pas le droit de modifier un
schéma. Un refus du moteur est bruyant ; ne cherche pas à le contourner, c'est le travail de
déploiement qui porte ce droit.

En développement, à l'inverse, appliquer est normal — c'est là que le cycle complet se joue.

## 8. Quand passer la main

| Le besoin                                                     | Où aller                                            |
| ------------------------------------------------------------- | --------------------------------------------------- |
| Créer une entité, un service CRUD, un controller de ressource | skill `nodefony-add-crud`                           |
| Comprendre la grammaire de champs et les index                | skill `nodefony-add-crud`                           |
| Le détail des codes de verdict, avec un exemple par code      | `references/verdicts.md`                            |
| Ce que le module publie sur les migrations                    | `node_modules/@nodefony/drizzle/docs/migrations.md` |
