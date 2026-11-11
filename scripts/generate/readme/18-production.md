## Production (cloud-native)

```bash
npm run build        # backend (rolldown)<% if (it.front) { %> + frontend (vite → public/dist, fingerprinté)<% } %>
npm start            # nodefony production — bind 0.0.0.0, logs stdout, probes /livez /readyz
```

**Plusieurs processus.** Par défaut, un seul process Node par pod : la mise à
l'échelle est le travail de l'orchestrateur. Sur une machine dédiée, trois voies
règlent le nombre de workers, de la plus forte à la plus faible :
`npx nodefony production --workers <n|auto>` (ou `npx nodefony cluster`) >
`NF_WORKERS=<n|auto>` (déclarée dans `env.ts`) >
`nodefony/config/cluster/cluster.config.ts`. Ce fichier n'est **pas généré** : sa
valeur serait le défaut (`workers: 1`), et chaque application porterait un
fichier qui ne dit rien. Crée-le si la topologie doit vivre en git :

```ts
// nodefony/config/cluster/cluster.config.ts — lu par le maître AVANT le boot,
// donc sans le moindre import du kernel.
import type { IClusterConfig } from "nodefony";
export default { workers: "auto" } satisfies IClusterConfig;
```

`auto` = un worker par cœur **alloué** (quota cgroup du conteneur), jamais
`os.cpus()`. `npm run dev` ignore ce réglage : le développement est toujours
mono-process.
<% if (it.front) { %>
> Le front de production est un build Vite figé (`public/dist/`), servi en
> statics par Nodefony — `npm run build` le produit (il chaîne
> `nodefony frontend:build`). Si tu lances `npm start` sans build, le boot le
> construit une fois pour toi quand Vite est installé (poste de dev) et le DIT
> dans les logs ; dans une image de production sans devDependencies, builde à
> l'image — sinon la page est servie sans interface et le boot le signale en
> ERROR.
<% } %>
### Image de container

`Dockerfile` et `.dockerignore` sont générés avec l'app ; la doctrine y est
commentée ligne à ligne (multi-stage, `USER 1000:1000`, sonde sur `/readyz`,
forme exec du `CMD`).

```bash
docker build -t <%= it.appName %> .
docker run -p 5151:5151 -v <%= it.appName %>-var:/app/var <%= it.appName %>
docker stop -t 20 <container>   # SIGTERM → drain → exit 0
```

> 🔴 **Le `-v` n'est pas optionnel si tu veux garder tes données.** L'app
> persiste par défaut en sqlite, dans `var/databases/` : sans volume, comptes,
> sessions, jetons et passkeys disparaissent au premier `docker rm`, **sans
> aucun message**. Le volume nommé les met hors du conteneur.
>
> Et tant que la base est sqlite, **une seule réplique** : c'est un fichier, pas
> un serveur. Deux conteneurs sur le même volume se corrompent mutuellement ;
> deux conteneurs sur deux volumes travaillent sur deux bases divergentes, ce
> que rien ne signale. Pour répliquer, passer à PostgreSQL ou MySQL — il suffit
> de poser `NF_DATABASE_URL`, l'ORM déduit le dialecte du scheme et rien d'autre
> ne change dans l'app.

> ⚠️ **La période de grâce doit rester au-dessus de `shutdownDeadline`** (15 s
> par défaut) : `docker stop` n'attend que 10 s sans `-t`, et k8s 30 s. En
> dessous, le drain est coupé par un SIGKILL et les requêtes en vol meurent —
> sans erreur ni trace, à chaque déploiement.

Le code de l'image appartient à `root` et le processus tourne en `1000:1000` :
l'application ne peut pas réécrire son propre `dist/`. Seuls `tmp/` et `var/`
lui appartiennent, ce qui est exactement ce dont elle a besoin pour écrire.

#### Sur quelle base l'image est construite

`gcr.io/distroless/nodejs24-debian13`, et c'est un choix **mesuré** — quatre candidates
construites avec un contenu identique, scannées, puis **démarrées** :

| Base                                                       | Image finale | Critiques | Hautes | Node                      | libc  | Shell dedans |
| ---------------------------------------------------------- | -----------: | --------: | -----: | ------------------------- | ----- | ------------ |
| **`gcr.io/distroless/nodejs24-debian13`**                  |   **416 Mo** |     **0** |  **0** | 24.22.2                   | glibc | **non**      |
| `node:24-alpine`                                           |       444 Mo |         1 |      7 | 24.22.2                   | musl  | oui (`sh`)   |
| `node:24-slim`                                             |       531 Mo |         0 |     13 | 24.22.2                   | glibc | oui (`bash`) |
| `gcr.io/distroless/nodejs24-debian12` — **ne démarre pas** |       404 Mo |         4 |     33 | 24.14.0, sous le plancher | glibc | **non**      |

Distroless ne porte que Node et les bibliothèques dont il a besoin : ni shell, ni gestionnaire de
paquets, ni npm. Les failles d'Alpine viennent de paquets que ton application n'emploie pas — zlib
et musl, que seule une nouvelle image Alpine corrige, et le npm qu'elle embarque. `debian12`, elle,
est restée figée en Node 24.14.0, sous le plancher du framework : elle se construit, puis ne démarre
pas.

**Ce que tu y perds**, et c'est le prix de ce zéro : pas de `docker exec … sh` pour diagnostiquer
(l'étiquette `:debug` de distroless ajoute un shell, le temps d'un diagnostic), pas de
`RUN apk add` dans l'image finale, et `node` n'est pas sur le PATH. Tout passe donc par Node
lui-même :

```bash
docker exec <conteneur> /nodejs/bin/node node_modules/.bin/nodefony orm:migrate:status
```

Pour la même raison, un lanceur qui change la commande la passe en **arguments** : `args:` en
Kubernetes (jamais `command:`, qui remplacerait le Node d'entrée de l'image), `command:` dans
compose, qui ne touche que les arguments.

**Pour en changer** — vers Alpine (`apk add` possible) ou `node:24-slim` (glibc, avec `bash`) —,
le `Dockerfile` le dit en tête, en quatre gestes : l'étage de construction et l'étage d'exécution
changent **ensemble** (les modules natifs sont compilés pour la libc de l'étage de construction, et
le symptôme d'un mélange est au DÉMARRAGE, pas à l'installation), le `RUN mkdir` des dossiers de
données revient, et la sonde appelle `node`.

#### Si tu PUBLIES cette image

L'image emporte `node_modules` élagué : la **publier** — sur un registre public,
ou en la livrant à un tiers — te rend distributeur du code de tes dépendances.
MIT, BSD, ISC et Apache-2.0 demandent alors que leur texte et leur copyright
accompagnent le code. C'est déjà le cas matériellement : chaque paquet porte son
propre fichier de licence dans `node_modules`, et l'image les emporte avec lui.

Ce qui manque, c'est l'inventaire — npm le produit sans rien installer :

```bash
npm sbom --sbom-format spdx --omit=dev > sbom.spdx.json
```

> Un **déploiement interne** (ton propre registre, ton cluster) n'est pas une
> distribution : ces obligations ne s'y appliquent pas. Et un inventaire écrit à
> la main serait faux dès le premier `npm install` — c'est pourquoi il se
> régénère plutôt qu'il ne se commite.

<% if (it.mongo) { %>### Schéma sur MongoDB — pas de migrations

Une base de documents n'a pas de schéma à migrer : une collection naît à la
première écriture, et les index que déclarent les entités sont posés à la
connexion. Ni `orm:generate`, ni `orm:migrate`, ni étape à passer avant le
premier exemplaire.

`npx nodefony create entity` y écrit une entité **document** — schéma Mongoose,
service CRUD, controller et tests — avec la même grammaire de champs qu'en SQL :

```bash
npx nodefony create entity Post "title:string(120)" "body:text?" author:ref:User
```

Une relation (`ref:`) est un `ObjectId` chargé par `?include=` ; MongoDB ne
tient pas de clé étrangère, donc supprimer un parent n'est pas refusé. L'entité
`User` s'étend, elle, dans `nodefony/entity/User.ts`.

<% } else if (it.db) { %>### Migrations de schéma

En développement, la base **suit le code** : les tables naissent au démarrage et
un champ facultatif ajouté est posé au boot suivant. Rien de tout cela n'a lieu
en production — le schéma s'y applique par des **migrations**, avant que le
premier exemplaire ne démarre.

Cette application **naît avec sa première migration**, sous `migrations/` : celle
qui crée sa table `User`. Elle est écrite à la création et entre dans le premier
commit, comme le lockfile — le schéma appartient au dépôt, jamais au
déploiement. Deux conséquences pratiques :

- **Si l'application a été créée sans installation** (`--no-install`, ou un build
  en échec), la migration n'a pas pu être écrite : lance
  `npx nodefony orm:generate --name init` avant ton premier déploiement, sinon
  rien ne créera la table et les exemplaires resteront en 503.
- **On n'écrit pas de migration en production** : `drizzle-kit` est une
  dépendance de développement, absente de l'image. Générer se fait ici,
  appliquer se fait là-bas.

```bash
npx nodefony orm:generate            # écrit les migrations des entités modifiées
npx nodefony orm:generate --apply    # dev : écrit ET applique, en un seul geste
npx nodefony orm:migrate --dry-run   # ce qui serait appliqué, sans rien écrire
npx nodefony orm:migrate             # applique (verrou + historique)
npx nodefony orm:migrate:status      # 0 = à jour · 1 = en retard — ta barrière de déploiement
```

`deploy/migrate-job.yaml` est le **travail Kubernetes** correspondant, déjà rendu
au nom de cette application : même image que le Deployment, secret DDL séparé du
compte qui sert le trafic, mode d'emploi en tête de fichier. Sans orchestrateur
(un seul exemplaire), `ddl: "migrate"` dans la config du connecteur applique les
migrations au démarrage — c'est le seul cas où c'est sûr.

> Les pods démarrent sans jamais fabriquer le schéma : un exemplaire dont la base
> est en retard répond **503 sur `/readyz`** (jamais sur `/livez`) et reste hors
> du répartiteur de charge, l'ancienne version continuant de servir. Lance le
> travail de migration : les pods deviennent disponibles **seuls**.

Le détail — droits SQL des deux comptes, règle N-1, dérive d'un schéma modifié à
la main : `node_modules/@nodefony/drizzle/docs/migrations.md`.

<% } %>Un process Node = un pod/container ; le scaling horizontal vient de
l'orchestrateur (k8s, Swarm, Cloud Run…).<% if (it.complete) { %> Studio est chargé en dev seulement
(`policy: "dev"`) — pour l'exposer en production, protège `/nodefony` par une
zone firewall puis passe la policy à `"mandatory"` (la recette est commentée
dans `nodefony.config.ts`).<% } %>
