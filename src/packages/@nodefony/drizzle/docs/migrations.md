---
title: "Migrations de schéma — de la base de dev au déploiement sans interruption"
lang: fr
module: "@nodefony/drizzle"
topic: drizzle
section: "Persistance"
audience: [developer, devops]
tags:
  [
    migrations,
    schema,
    ddl,
    deploiement,
    kubernetes,
    production,
    sqlite,
    postgresql,
    mysql,
  ]
version: "doc"
status: stable
updated: 2026-08-28
source: "src/packages/@nodefony/drizzle/nodefony/src/migrator/"
---

📍 [Documentation](../../../../../docs/index.md) › [Drizzle — ORM SQL](index.md) › **Migrations de schéma**

> Une base de données ne se met pas à jour toute seule, et elle ne se remplace pas non plus. Une
> **migration** est un fichier de SQL versionné qui la fait passer d'une version du schéma à la
> suivante, en gardant la trace de son passage. Cette page dit comment Nodefony les produit, les
> applique et les surveille — et surtout comment déployer sans interrompre le service, ce qui est la
> seule question difficile du sujet.
>
> Deux lecteurs, deux moitiés. **En développement**, presque rien à faire : le schéma se répare tout
> seul, et la seule commande à retenir est `orm:reset`. **En exploitation**, tout se joue avant le
> déploiement : un travail d'orchestrateur applique les migrations pendant que l'ancienne version
> sert encore, avec un compte qui n'est pas celui du trafic.

## 📖 Lexique

| Terme                       | Ce que ça veut dire                                                                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **migration**               | un fichier de SQL versionné qui fait passer la base d'une version du schéma à la suivante, et qui garde trace de son passage                                   |
| **schéma**                  | la forme de la base : ses tables, ses colonnes, leurs types et leurs contraintes — pas les données qu'elle contient                                            |
| **DDL**                     | _Data Definition Language_ — la part du SQL qui crée et modifie le schéma (`CREATE TABLE`, `ALTER TABLE`), par opposition à celle qui lit et écrit les données |
| **source de migrations**    | un dossier de migrations livré par quelqu'un : le framework en a une, l'application une autre, un module tiers peut en apporter une                            |
| **historique**              | la table `nodefony_migrations` où l'applicateur écrit ce qu'il a posé, quand, et avec quelle empreinte                                                         |
| **empreinte**               | la somme de contrôle du contenu d'un fichier de migration — c'est elle qui détecte qu'un fichier déjà appliqué a été modifié après coup                        |
| **adoption (_baseline_)**   | déclarer qu'une base existante correspond déjà à certaines migrations, sans les exécuter                                                                       |
| **dérive**                  | un fichier de migration modifié APRÈS avoir été appliqué : l'historique et le disque ne disent plus la même chose                                              |
| **divergence**              | la base ne correspond plus au code, alors que l'historique est complet et que rien n'est en attente                                                            |
| **expansion / contraction** | la façon de changer un schéma en deux déploiements, pour qu'à aucun moment le code en service et la base ne soient incompatibles                               |

## Qu'est-ce qu'une migration, et pourquoi le développement n'en a pas besoin

En développement, Nodefony **dérive** le schéma du code : les entités que vous déclarez deviennent
des `CREATE TABLE IF NOT EXISTS` au démarrage. C'est immédiat et sans cérémonie — mais `IF NOT
EXISTS` ne fait évoluer aucune table qui existe déjà. Ajoutez un champ à une entité, et la table
gardera la forme qu'elle avait.

En production, cette dérivation serait pire qu'inutile : elle poserait des tables dont l'historique
ne garderait aucune trace, et personne ne saurait plus d'où elles viennent — exactement la
divergence que les migrations existent pour empêcher.

D'où **trois modes**, un par connecteur, réglés par la clé `ddl` :

| Mode      | Qui fabrique le schéma                                       | Où c'est le défaut                 |
| --------- | ------------------------------------------------------------ | ---------------------------------- |
| `auto`    | dérivé du code au démarrage, et **rattrapé** (voir plus bas) | développement, test                |
| `migrate` | les migrations, appliquées au démarrage sous verrou          | nulle part — jamais un défaut      |
| `none`    | personne ici : un travail extérieur s'en charge              | tout le reste, production comprise |

> [!IMPORTANT]
> `migrate` n'est le défaut d'aucun environnement, et c'est délibéré. Faire migrer le schéma par le
> processus qui sert le trafic, c'est accepter que N exemplaires démarrant ensemble se disputent la
> base. Le verrou les sérialise, mais le patron sain reste le travail d'orchestrateur décrit plus
> bas. `migrate` existe pour les déploiements sans orchestrateur — un serveur unique, une machine
> virtuelle.

## 🚀 Démarrage rapide

Cinq verbes, et un seul à retenir pour le quotidien du développement.

```bash
# Ce que la base a reçu, ce qui reste, et ce qu'il faut taper. N'écrit rien.
nodefony orm:migrate:status

# Applique ce qui est en attente (framework d'abord, application ensuite).
nodefony orm:migrate

# Écrire la migration qui aligne la base sur VOS entités.
nodefony orm:generate --name ajout_du_titre

# Voir le SQL sans l'appliquer — la même validation que la vraie.
nodefony orm:migrate --dry-run

# Adopter une base existante : marquer des migrations comme appliquées, sans les exécuter.
nodefony orm:migrate:baseline

# Effacer les marqueurs d'échec, APRÈS avoir regardé ce qui s'est passé.
nodefony orm:migrate:repair

# Développement seulement : supprime et recrée la base du connecteur.
nodefony orm:reset
```

Toutes acceptent `--connector <nom>` (défaut : `default`) et `--json`. Le flux `--json` est **pur** :
`nodefony orm:migrate:status --json | jq` ne casse sur aucune ligne de journal.

Les migrations du **framework** sont livrées dans le paquet : vous n'avez pas à les produire. Celles
de votre **application**, vous les écrivez avec `orm:generate` — voir la section suivante.

Côté configuration, il n'y a rien à écrire pour le cas courant : le mode se résout par
environnement. Ne le déclarer que pour s'en écarter — un serveur unique qui migre au démarrage :

```typescript
import { defineConfig, use } from "nodefony";

export default defineConfig(() => ({
  modules: [
    use("@nodefony/drizzle", {
      connectors: {
        // Le démarrage applique les migrations, sous verrou. À réserver aux
        // déploiements SANS orchestrateur — un serveur unique, une machine
        // virtuelle : ailleurs, c'est un travail dédié qui migre, et les
        // exemplaires restent en "none".
        default: { ddl: "migrate" },
      },
      migrations: {
        // Retenir la mise en service tant que le schéma est en retard (défaut),
        // et faire de la divergence une barrière plutôt qu'une observation.
        check: "fail",
        divergence: "fail",
      },
    }),
  ],
}));
```

## Écrire les migrations de votre application — `orm:generate`

Vous modifiez une entité, vous tapez un verbe, vous relisez le fichier produit :

```bash
nodefony orm:generate --name ajout_du_titre
```

Il n'y a **rien à installer ni à configurer**. La commande trouve vos entités là où le générateur
les écrit — `nodefony/entity/*.ts`, dans l'application et dans chacun de ses modules —, produit la
migration dans `migrations/<dialecte>/`, et vous dit ce qu'elle a écrit. L'outil qui calcule la
différence est piloté à l'intérieur ; vous n'avez ni sa configuration à tenir, ni son dossier de
sortie à connaître, ni son journal à comprendre.

Le dialecte est celui de votre connecteur : vos entités sont du Drizzle **natif**, donc écrites pour
un moteur. C'est ce qui vous laisse toute la puissance du moteur dans une entité — et ce qui fait
qu'une migration vaut pour lui seul.

### Ce que la commande refuse, et pourquoi c'est une bonne nouvelle

**Une migration est immuable dès qu'une base l'a reçue.** Une migration à laquelle il manque une
table ne se corrige donc pas : elle se remplace par une suivante, sur toutes les bases qui ont déjà
appliqué la première. C'est pour cela que trois situations arrêtent la commande avant qu'elle
n'écrive quoi que ce soit — chacune nomme ce qui cloche :

| Ce qui est refusé                                              | Ce que ça veut dire                                                                                                                                 |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| une entité enregistrée qu'aucun fichier ne fournit             | son fichier a été déplacé, renommé, ou ne s'importe pas seul — la migration serait écrite **sans sa table**                                         |
| un fichier de l'application qui exporte une table du framework | la migration porterait un second `CREATE TABLE` pour cette table : elle passerait sur une base vierge, et échouerait sur toute base **déjà migrée** |
| une migration qui **supprime** des données                     | à relire, puis à confirmer par `--allow-destructive` — les fichiers sont conservés, ce sont eux qu'il faut regarder                                 |

Le troisième cas mérite une précision : quand une colonne disparaît et qu'une autre apparaît, aucun
outil ne peut deviner s'il s'agit d'un **renommage** — les données suivent — ou d'une suppression
suivie d'un ajout — les données sont perdues. C'est une intention, pas une différence de schéma.
Rejouez alors la commande dans un terminal, et répondez à la question posée.

### Une entité qui pointe vers une table du framework

Déclarer une référence vers `User` dans votre entité est légitime, et ne pose aucun problème : ce
qui est refusé, c'est de **ré-exporter** cette table depuis vos fichiers. Les tables du framework
sont exclues du plan de votre application — elles ont leurs propres migrations, appliquées avant les
vôtres. Pour une vraie clé étrangère SQL, écrivez une migration libre.

### Ce qu'aucun schéma ne peut déduire — la migration libre

Une vue, un déclencheur, un index particulier, un remplissage de données ne se déduisent d'aucune
entité :

```bash
nodefony orm:generate --custom --name vue_des_ventes
```

Vous obtenez un fichier **vide**, déjà inscrit au journal, que vous écrivez à la main. Il est
appliqué comme les autres : une seule fois, dans l'ordre, et son empreinte est gravée.

## En développement — le schéma se répare tout seul

C'est le scénario de tous les jours d'une équipe : le back ajoute un champ à une entité, le front
tire la branche, et sa base locale date d'avant.

Au démarrage, en mode `auto`, la connexion se fait en **trois temps** — et l'ordre est ce qui compte :

1. les tables manquantes sont créées (`CREATE TABLE IF NOT EXISTS`) ;
2. le schéma déclaré est **comparé** à celui de la base, table par table
   (`compareSchema()`, `schemaDiff.ts:94`) ;
3. les index sont posés.

Entre les deux, ce qui se rattrape est rattrapé :

- **colonne manquante qui accepte le vide** → elle est ajoutée (`additiveSql()`,
  `schemaDiff.ts:153`) et journalisée en clair. Le front n'a rien à taper : il tire, le serveur
  redémarre, ça marche.
- **colonne manquante et obligatoire** → jamais posée. La créer exigerait d'inventer une valeur pour
  les lignes déjà présentes, ce qui est une décision métier, pas une décision d'outil. L'écart est
  publié, journalisé, avec le geste exact.
- **colonne en trop dans la base** → ignorée, toujours. Une application qui écrit des migrations
  libres (une vue, un déclencheur, une colonne ajoutée à une table d'entité) a une base
  légitimement différente du schéma déclaré, en permanence.

> [!NOTE]
> Ce troisième temps n'est pas cosmétique. Un index porte sur des colonnes : le poser sur une table
> à laquelle il en manque une échoue, et cet échec-là **tuait le démarrage** — le développeur
> recevait un `no such column` du pilote, sans nom de connecteur, sans geste, et sans serveur pour
> aller voir. Les index d'une table encore en écart sont donc sautés : l'écart, lui, a déjà été dit.

Quand le rattrapage ne suffit pas, une seule commande à retenir :

```bash
nodefony orm:reset --connector default
```

Elle **supprime et recrée** la base, et refuse dès que l'environnement n'est pas `development` —
liste blanche, pas liste noire : `staging` et tout environnement inconnu refusent aussi.

## En production — le patron de déploiement

### Le travail d'orchestrateur, AVANT le déploiement des pods

Le consensus cloud-native est solide, et Nodefony ne cherche pas à le remplacer : **les migrations
s'appliquent dans un travail dédié, qui se termine avant que le premier nouvel exemplaire ne
démarre**. Les pods, eux, tournent en `ddl: "none"`.

```yaml
# Kubernetes — le patron de référence. Le déploiement attend la fin du travail.
apiVersion: batch/v1
kind: Job
metadata:
  name: nodefony-migrate
spec:
  backoffLimit: 2
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: mon-application:1.4.0
          command: ["npx", "nodefony", "orm:migrate", "--json"]
          env:
            - name: NF_MIGRATE_DATABASE_URL
              valueFrom:
                secretKeyRef: { name: db-migrator, key: url }
```

Trois propriétés en découlent, et elles valent d'être nommées :

- **Le verrou rend les variantes sûres.** Si deux exemplaires du travail partent ensemble, le second
  attend : le verrou est natif au moteur — `lock()` (`postgresDriver.ts:178`) demande un
  `pg_advisory_lock` —, donc il s'auto-libère à la mort de la connexion. Une table de verrou maison laisserait un zombie à
  déverrouiller à la main.
- **Rien n'est appliqué deux fois.** L'historique (`nodefony_migrations`, `types.ts:23`) est écrit
  dans la même transaction que le DDL, là où le moteur le permet.
- **Un pod en retard ne reçoit pas de trafic.** En `none` comme en `migrate`, l'état du schéma est
  publié à la sonde de disponibilité (`#publishReadiness()`, `DrizzleService.ts:345`) : `/readyz`
  répond 503, l'orchestrateur sort l'exemplaire du répartiteur de charge, et l'ancien continue de
  servir. `/livez` n'est jamais touché — un schéma en retard n'est pas un processus malade, et le
  redémarrer ne réparerait rien. La vérification est rejouée toutes les 15 secondes : dès que le
  schéma est à jour, l'exemplaire redevient disponible **tout seul**, sans redéploiement.

### Les droits du compte qui migre ne sont pas ceux du trafic

Le compte qui applique une migration a besoin de modifier le schéma. Celui qui sert les requêtes,
non — et lui laisser ce pouvoir, c'est offrir un `DROP TABLE` à la première injection réussie.

`orm:migrate` lit donc `NF_MIGRATE_DATABASE_URL` **en priorité sur l'URL du connecteur**, et cette
variable n'est lue par personne d'autre : c'est le véhicule du moindre privilège.

```sql
-- PostgreSQL : le compte du TRAFIC ne peut que lire et écrire des données.
GRANT CONNECT ON DATABASE app TO app_runtime;
GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;

-- Le compte qui MIGRE possède le schéma, et ne sert jamais de requête applicative.
GRANT CREATE ON SCHEMA public TO app_migrator;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
```

> [!WARNING]
> `orm:reset` **n'est jamais** concerné : il ne lit pas `NF_MIGRATE_DATABASE_URL`. Une variable qui
> porte des droits de schéma ne doit pas pouvoir désigner la cible d'un effacement.

### Déployer sans interruption — expansion, puis contraction

Pendant un déploiement progressif, deux versions du code parlent à **une seule** base. La règle qui
en découle n'a rien d'optionnel : **toute migration doit être compatible avec la version encore en
service**. Un changement destructif se fait donc en deux déploiements.

Renommer une colonne `email` en `contact_email`, sans une seconde d'interruption :

| Étape           | Migration                         | Code déployé                         |
| --------------- | --------------------------------- | ------------------------------------ |
| 1 — expansion   | ajouter `contact_email`, nullable | écrit les DEUX colonnes, lit `email` |
| 2               | recopier les données existantes   | inchangé                             |
| 3               | —                                 | lit `contact_email`, écrit les deux  |
| 4 — contraction | supprimer `email`                 | ne connaît plus `email`              |

Chaque étape est déployable seule, et à aucun moment la base n'est incompatible avec ce qui tourne.
C'est plus long que le `ALTER TABLE … RENAME` d'un seul coup — et c'est la seule façon connue de ne
pas couper le service.

## Pourquoi il n'y a PAS de sauvegarde automatique

Aucune commande de Nodefony ne sauvegarde votre base avant d'agir. C'est une décision, pas un
manque, et **aucun outil de migration sérieux ne le fait** non plus.

Une sauvegarde automatique donnerait une assurance qui n'existe pas. Sur une base de production de
plusieurs centaines de gigaoctets, la prendre depuis le processus qui migre prendrait des heures,
saturerait le disque de l'exemplaire, et échouerait au pire moment. Sur une base répliquée, elle
ignorerait les réplicas. Et surtout : **une restauration est une décision d'exploitation**, avec sa
fenêtre d'indisponibilité, sa perte de données assumée entre deux points de reprise, et quelqu'un
qui la prend. Un outil qui prétendrait la préparer tout seul inviterait à ne pas y penser.

Ce que l'outil fait à la place, et qui vaut mieux :

- **il refuse d'appliquer sans que vous sachiez.** Le SQL en attente est examiné avant la moindre
  écriture (`scanDestructive()`, `destructive.ts:184`) : une suppression de données est refusée hors
  développement, en nommant l'instruction et ce qui disparaît. Il faut `--allow-destructive` pour
  passer outre, et **au démarrage il n'y a aucun drapeau pour lever le refus** — un exemplaire qui
  redémarre ne supprime jamais de colonne de lui-même, parce que personne ne regarde à ce
  moment-là ;
- **il vous apprend l'expansion/contraction au moment où elle sert**, c'est-à-dire quand vous lisez
  le refus.

La protection réelle contre la perte de données, c'est le patron ci-dessus et votre politique de
sauvegarde — pas un fichier `.bak` pris par un outil qui ne sait rien de votre infrastructure.

## La troisième source — le verdict `divergent`

Les outils de migration connaissent **deux** choses : les fichiers, et l'historique. Ils en
concluent « tout est appliqué ». Ils ne regardent jamais la base.

Nodefony croise une **troisième** source (`describeDivergence()`, `divergence.ts:72`), et rend un
constat qu'aucun outil ne produit en continu :

> l'historique est complet, aucune migration n'est en attente — **et pourtant la base ne correspond
> pas au code**.

Quelqu'un a passé un `ALTER` à la main un soir d'astreinte, un correctif d'urgence n'a jamais été
reporté, deux environnements ont divergé. Le verdict s'appelle `divergent`, il s'affiche dans
`orm:migrate:status`, il est publié par la sonde, et il obéit à trois règles :

- **il ne se paie que lorsque les deux autres sources n'ont plus rien à dire.** Tant qu'une
  migration attend, le verdict est déjà décidé : interroger la base coûterait une requête par table
  sans rien apprendre ;
- **il signale ce qui MANQUE, jamais ce qu'il trouve en trop.** Sans cette règle, toute application
  à migrations libres l'aurait allumé à vie — donc appris comme du bruit, donc mort ;
- **il ne fait pas tomber un déploiement — sauf quand une TABLE d'entité manque.** Le code de
  sortie reste `0` pour une colonne en écart : superviser n'est pas bloquer, et une application à
  migrations libres en a une en permanence. Mais aucune main légitime ne fait _disparaître_ une
  table que le code déclare comme entité : quand elle manque, le schéma applicatif n'a jamais été
  posé, l'application rendra 500 sur chacune de ses routes, et le processus **retient sa mise en
  service** (`/readyz` répond 503). Le seuil se règle :

```typescript
use("@nodefony/drizzle", {
  // "report" (défaut) — affiche tout écart, ne retient QUE sur une table absente
  // "fail"          — tout écart retient la mise en service
  // "off"           — rien n'est comparé, rien n'est publié
  migrations: { divergence: "fail" },
});
```

**La graduation est unique** (`divergenceIsBlocking()`, `explain.ts`) : la commande et la sonde de
disponibilité lisent la même règle, donc votre passe d'intégration continue et votre orchestrateur
ne peuvent pas se contredire.

### Il dit CE QUI diverge, pas seulement QU'IL diverge

Un verdict qui annonce un écart sans le nommer envoie ouvrir un client SQL et comparer table par
table, sur une base de production, au pire moment. La sortie porte donc les tables et les colonnes,
**séparées selon qu'elles se rattrapent ou non** — une colonne qui accepte le vide s'ajoute sans
rien inventer, une colonne obligatoire exige une décision métier :

```bash
nodefony orm:migrate:status --json | jq '.divergence'
```

```json
{
  "missingTables": ["webhook_endpoint"],
  "blocking": [
    { "table": "User", "column": "tenantId", "type": "text", "nullable": false }
  ],
  "additive": [
    {
      "table": "audit_event",
      "column": "metadata",
      "type": "jsonb",
      "nullable": true
    }
  ]
}
```

La clé vit au premier niveau, dans le cœur neutre — pas sous `driver` : un second ORM remplira la
même structure, et un `jq` écrit aujourd'hui ne doit pas graver le nom d'un pilote. **Sur une base
conforme, la clé est ABSENTE** (jamais un objet vide) : `.divergence == null` suffit à tester.

L'écran lisible en dit autant : le résumé nomme les trois premières entrées de chaque famille, et la
liste complète ne se déroule que lorsqu'elle ne tient plus dans la phrase.

Les gestes proposés suivent **l'environnement** : `orm:reset` efface, elle n'est acceptée qu'en
développement, et elle n'est donc proposée que là. Ailleurs, la sortie renvoie vers l'écriture d'une
migration correctrice (`orm:generate --custom`) puis son application.

Ils suivent aussi **ce qui manque**. Une table d'entité absente se rattrape par le générateur — il
sait la produire, puisque le code la déclare — et c'est `orm:generate --name …` qui est proposé, pas
`--custom` : envoyer écrire à la main ce que la commande d'à côté écrit seule serait un geste juste
pour une colonne et absurde pour une table.

## Codes de sortie et sortie `--json`

La grille est **figée, et ne sera jamais réaffectée** — des passes d'intégration continue s'y
adossent, et en changer le sens casserait des tests que nous ne voyons pas.

| Code | Ce que ça veut dire                                                                                             |
| ---- | --------------------------------------------------------------------------------------------------------------- |
| `0`  | à jour, ou appliqué avec succès                                                                                 |
| `1`  | une action humaine est requise : migrations en attente, dérive, échec, refus destructif, table d'entité absente |
| `2`  | la commande n'a pas pu travailler : base injoignable, verrou indisponible, usage invalide                       |

```bash
# Barrière d'intégration continue : la passe s'arrête si le schéma n'est pas à jour.
nodefony orm:migrate:status --json || exit 1

# Ce qu'un agent lit — jamais une phrase française.
nodefony orm:migrate:status --json | jq -r '.verdict, .nextActions[0].command'
```

Chaque sortie `--json` porte `formatVersion: 1` au premier niveau. Ajouter un champ est une version
mineure ; en retirer ou en renommer un est interdit sur la série majeure.

## ⚠️ Pièges

- **Un fichier de migration déjà appliqué ne se modifie pas.** L'empreinte le détecte et le verdict
  devient `drift`. Écrivez une migration correctrice — c'est plus long, et c'est ce qui garde
  l'historique honnête.
- **MySQL ne sait pas annuler un `CREATE TABLE`.** Son DDL valide implicitement : après un échec à
  mi-course, la reprise aveugle est interdite, et c'est `orm:migrate:repair` — après inspection
  humaine — qui tranche.
- **`orm:migrate:repair --update-hashes` réécrit les empreintes.** Il fait taire une dérive au lieu
  de la corriger. Ne l'utilisez qu'en sachant précisément pourquoi.
- **Une migration en attente qui se range AVANT la dernière appliquée est refusée** (deux branches
  fusionnées). `--out-of-order` l'assume, et il faut l'assumer sciemment : l'ordre d'application ne
  sera plus celui du journal.
- **En développement, une colonne obligatoire ajoutée à une entité ne se rattrape pas.** C'est le
  cas le plus fréquent après le cas nullable, et la seule issue est `orm:reset` — ou une vraie
  migration si la base porte des données auxquelles vous tenez.
- **Le rattrapage automatique n'existe qu'en mode `auto`.** En `migrate` et `none`, la comparaison
  constate et ne répare jamais.
- **Un tag et un nom de source sont SENSIBLES À LA CASSE.** `--up-to 0003_Audit` et `--source App`
  sont refusés, en nommant la bonne graphie. Ce n'est pas du zèle : sans point d'arrêt reconnu,
  l'adoption déclarerait à niveau **tout** l'historique — et une base ne reçoit jamais une migration
  qu'elle croit déjà avoir. Le refus sur `--source` évite l'autre moitié du piège : filtrer sur un
  nom inconnu ne touche rien et rend pourtant « rien à réparer ».
- **Un `.sql` peut être écrit avec une marque d'ordre des octets** (les éditeurs Windows et
  PowerShell la posent). Elle est retirée à la lecture, et ne compte ni dans le marqueur de format
  ni dans l'empreinte : un dépôt relu sous Windows ne fait donc pas diverger les empreintes posées
  par l'image Linux qui a migré la base d'équipe.
- **Une ligne qui commence par deux tirets À L'INTÉRIEUR d'une chaîne littérale reste de la
  donnée.** C'est le cas d'un remplissage textuel multi-ligne écrit avec `orm:generate --custom` :
  la retirer changerait silencieusement ce qui est inséré.
- **Le séparateur d'instructions écrit DANS un commentaire n'en est pas un.** `--> statement-breakpoint`
  commence lui-même par deux tirets : rien ne le distingue d'un commentaire à l'œil du moteur. Une
  ligne de commentaire qui le CITE — ce que fait le gabarit d'une migration libre — ne coupe donc
  rien.

## 🧪 Tests & couverture

| Ce qui est prouvé                                                                                                            | Où                                                            |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Applicateur : identité ensembliste, dérive, ordre, échec puis réparation, adoption, idempotence                              | `tests/integration/migrator-sqlite.test.ts`                   |
| Verrou entre process, absence de zombie, DDL non transactionnel                                                              | `migrator-postgres.e2e.test.ts`, `migrator-mysql.e2e.test.ts` |
| Les cinq verbes sur un **boot réel**, dans les trois modes                                                                   | `migrate-cli.e2e.test.ts` (`NF_RUN_CLI_BOOT=1`)               |
| Rattrapage additif, refus d'inventer, colonne en trop ignorée                                                                | `schema-reconcile.test.ts`                                    |
| Rattrapage sur **serveurs réels** (types, catalogue, index)                                                                  | `schema-reconcile-dialects.e2e.test.ts`                       |
| Verdict `divergent`, son absence quand un geste est déjà dû, et le DÉTAIL qu'il nomme                                        | `migrate-divergence.test.ts`                                  |
| Refus destructif : ce qui perd des données, ce qui n'en perd pas                                                             | `migrate-destructive.test.ts`                                 |
| Parité entre le schéma migré et le schéma dérivé, sur les 3 dialectes                                                        | `migrations-parity-*.test.ts`                                 |
| **Chaque réglage** sur son couple (refus sans lui, travail avec lui), 3 dialectes                                            | `migrate-reglages.test.ts`                                    |
| Lecture et empreinte d'un fichier : marque d'ordre des octets, CRLF, chaînes littérales                                      | `tests/unit/migrationFichiers.test.ts`                        |
| Le nom d'une migration, et l'invariant « une suggestion est toujours acceptable »                                            | `tests/unit/migrationName.test.ts`                            |
| Le cycle complet **dans une application générée** : génération, barrière de déploiement, `/readyz` 503, divergence provoquée | gabarit `tests/migrations.e2e.test.ts` de toute app à ORM     |
| Le découpage en instructions : séparateur dans un commentaire, séparateur collé en fin de ligne                              | `tests/unit/migratorContracts.test.ts`                        |

Les bancs PostgreSQL et MySQL/MariaDB exigent leurs serveurs :

```bash
docker compose -f docker/docker-compose.yml --profile postgres up -d postgres
docker compose -f docker/docker-compose.yml --profile mariadb up -d mariadb
NF_PG_URL=postgres://nodefony:nodefony-dev@127.0.0.1:5432/nodefony \
NF_MYSQL_URL=mysql://nodefony:nodefony-dev@127.0.0.1:3306/nodefony npm test
```

> [!CAUTION]
> Sans ces variables, les bancs se **skippent** — et un test skippé compte comme vert. La suite du
> module affiche en fin de passe ce qu'elle n'a PAS exercé : lisez ce bloc avant de conclure.

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [@nodefony/drizzle](index.md)
- [Configuration du module](index.md#configuration) — la clé `ddl` et le bloc `migrations`
- [Dialectes](index.md#dialectes--une-base-par-déploiement-un-seul-code) — porter ses entités sur
  PostgreSQL et MySQL
- [Les huit stores du framework](index.md#les-huit-stores-du-framework--la-persistance-clé-en-main) —
  ce que le paquet livre déjà, migrations comprises
