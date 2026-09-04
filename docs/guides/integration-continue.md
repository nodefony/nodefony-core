---
title: "Intégration continue — ce qui tourne, où, et comment le rejouer"
navTitle: Intégration continue
lang: fr
module: global
topic: ci-guide
audience: humain
tags: [ci, forge, tests, gates, decor, docker, couverture]
version: "doc"
status: stable
updated: 2026-09-01
source: "docs/guides/integration-continue.md"
related: vitest.gates.ts, docs/guides/persistence.md, .github/workflows/
---

# Intégration continue

> Ce que la forge exécute à chaque poussée, avec quel décor, et comment rejouer
> n'importe lequel de ces jobs sur sa propre machine.

Ce guide existe parce que le savoir qu'il porte n'était écrit que dans les
commentaires des fichiers `.github/workflows/*.yml` — soignés, mais introuvables
pour qui ignore que ces fichiers existent.

> ⚠️ **Ce guide documente la forge du DÉPÔT du framework**, pas celle d'une
> application. Les workflows, les chemins et les cibles d'infra décrits ici sont
> ceux de `nodefony-core` ; ils ne concernent pas une application créée avec
> `nodefony create app`. Ce qui doit atteindre l'auteur — ou l'agent — d'une
> **application** vit dans les gabarits du scaffold (`AGENTS.md` et documentation
> de l'app générée), et parle de SES tests à ELLE. Ne pas recopier ce guide
> là-bas : une app n'a ni `orm.yml`, ni `vitest.gates.ts`.
>
> Ce qui **traverse** la frontière, en revanche, c'est le principe du §1 — un
> test non exécuté n'est pas un test réussi. Une application gagne à le tenir
> aussi ; elle le tiendra avec ses propres moyens.

---

📍 [Documentation](../index.md) › [Guides](README.md) › **Intégration continue**

## Le modèle — le décor fait partie du test

Une suite de tests ne dit pas la vérité toute seule : elle la dit **dans un décor**. Sans base
PostgreSQL joignable, les tests qui en dépendent ne tombent pas — ils se sautent, et un saut
compte comme un succès. Une passe verte peut donc ne rien avoir prouvé.

Toute cette page découle de là. Le dépôt ne se contente pas de lancer des tests : il **déclare le
décor attendu** en un seul endroit (`vitest.gates.ts`) — une cible par base, `PG_GATE`
(`vitest.gates.ts:268`) et `MYSQL_GATE` (`vitest.gates.ts:285`), plus la liste des interrupteurs
optionnels `OPT_IN_SWITCHES` (`vitest.gates.ts:127`) —, vérifie que chaque décor déclaré a
réellement servi, et **fait échouer la passe** en intégration continue quand une cible annoncée
n'a pas été exercée. Une absence voulue s'énonce ; elle ne s'oublie pas.

## 1. La règle qui gouverne tout : un test non exécuté n'est pas un test réussi

Vitest compte un test sauté comme un test qui ne bloque pas. La suite finit
verte. C'est le comportement normal d'un lanceur de tests, et c'est un piège
redoutable dès qu'une partie des cas dépend d'un serveur :

- `@nodefony/drizzle` sans variables d'infra : **517 cas sautés sur 901**, dont
  les deux dialectes de production (PostgreSQL et MySQL) — et un code de sortie
  **0** ;
- une étape qui sélectionne par motif (`vitest -t "…"`) dont le motif ne mord
  plus après un renommage : **591 cas sautés**, code de sortie **0**, étape verte
  qui n'a rien prouvé.

Dans les deux cas le vert est sincère et ne veut rien dire. La parade est un
rapporteur de fin de suite — [`vitest.gates.ts`](../../vitest.gates.ts), à la
racine — qui confronte ce qui **devait** tourner à ce qui **a** tourné.

Sa sanction dépend de qui lit :

| Contexte                | Comportement                                           |
| ----------------------- | ------------------------------------------------------ |
| **Local** (`CI` absent) | avertissement en fin de suite, code de sortie inchangé |
| **Forge** (`CI` posé)   | **échec de la passe** : `process.exitCode = 1`         |

Travailler sur sqlite sans lever trois conteneurs est légitime — bloquer en
local serait une punition. Personne, en revanche, ne lit un avertissement jaune
dans un job vert.

> **Une absence VOULUE s'énonce.** Elle ne s'oublie pas et ne se découvre pas six
> mois plus tard : voir `NF_GATES_ALLOW` au §3.

---

## 2. Ce que la forge lance

Dix fichiers de workflow. Ceux qui éprouvent le code se déclenchent sur
**chaque poussée**, filtrés par des **chemins** — jamais par une branche :
réserver l'infra à `main`, c'est découvrir la casse après le merge. Les autres
(publication, site) partent d'un événement qui leur est propre.

<!-- prettier-ignore -->
| Workflow | Job | Ce qu'il prouve | Décor |
| --- | --- | --- | --- |
| `node.js.yml` | Vérifications | types, lint, audit des dépendances, conformité des skills | — |
| `node.js.yml` | Tests unit | suites unitaires, **3 systèmes × 2 versions de Node** | — |
| `node.js.yml` | Filet CLI | le binaire `nodefony` démarre vraiment (`NF_RUN_CLI_BOOT`) | — |
| `node.js.yml` | Tests intégration | pipeline HTTP/WS sur serveur réel, dont le câblage du 429 (backoff NIST) | serveur **dev ET production** |
| `orm.yml` | Stores | drizzle sur **sqlite + PostgreSQL + MySQL**, redis, orm-core | PostgreSQL, MariaDB, Redis |
| `orm.yml` | Socket distribuée | fan-out **cross-process** (IPC) et **cross-pod** (backplane Redis), attaques F83 | Redis, `NF_RUN_CLUSTER_E2E` |
| `memory.yml` | Charge, fuites et scopes | heap, fuites HTTP/WS, scopes d'injection sous charge, sessions, flux | serveur `--expose-gc` |
| `e2e-autonomes.yml` | Cluster · configuration · arrêt gracieux | fan-out entre process, sonde de pod, point de santé, surcharge par l'environnement | aucun (les scripts se montent) |
| `scaffold.yml` | Code généré | ce que `create` PRODUIT compile, se lint, se bâtit, se teste, répond en HTTP et démarre en production — **3 systèmes**, décor isolé (tarballs, hors dépôt) ; puis le même banc sur les **trois moteurs** (une application par moteur, ubuntu) | PostgreSQL, MySQL (job `dialectes`) |
| `codeql.yml` | Analyze | analyse statique de sécurité | — |
| `secrets.yml` | Aucun secret dans l'arbre | `gitleaks` sur l'arbre ET l'historique — le scanner se prouve d'abord sur un témoin planté | — |
| `release-smoke.yml` | Installation vierge | les tarballs s'installent et tiennent debout chez celui qui installe (`base`/`front`/`studio`) — manuel + hebdomadaire | conteneurs docker |
| `release-preflight.yml` | OIDC · outils · jeton · docker | les ACCÈS de publication existent avant d'en avoir besoin (identité, versions minimales, quota) | — |
| `pages.yml` | build · deploy | le site public (documentation + mesures) se rend depuis les sources versionnées | — |

### Le MODE du serveur est une dimension de la matrice, pas une propriété de branche

Le job d'intégration tourne en **trois variantes** — Node 24 en développement,
Node 26 en développement, Node 26 en **production**. Trois et pas quatre : le
mode éprouve le _gating_ du framework (modules `policy:"dev"` absents, clés de
chiffrement obligatoires, erreurs muettes, comptes seedés autrement), pas le
moteur JavaScript — que les deux versions croisent déjà en développement.

Le mode a dépendu de la branche : production sur `main`, développement ailleurs.
La casse propre au mode livré n'apparaissait alors qu'**après** la fusion, sur la
branche où plus personne ne peut la corriger sans un second aller-retour. C'est
le même défaut que « filtrer par branche » — corrigé pour l'infra, resté là.

Deux conséquences qui se lisent dans le workflow :

- **le banc crée son second compte lui-même** en production (`security:user:add`),
  parce que `provisionUsers` n'y seede que `admin` — les comptes de fixture ont
  un hash public. Neuf fichiers éprouvent ce qu'un compte NON-administrateur a le
  droit de faire ; les rendre muets en production aurait rejoué le silence qu'on
  passe son temps à supprimer ;
- **un cas propre à un mode a toujours sa contrepartie dans l'autre.** La stack
  d'erreur et le profil par frame n'existent qu'en développement ; la production
  reçoit donc les cas qui prouvent qu'ils ne fuient PAS, et que le pont RPC
  répond quand même. Le rapporteur exige, à chaque passe, les cas du mode qu'il
  a **constaté** (sonde `/livez`) — un `skipIf` qui partirait à l'envers
  éteindrait les deux côtés en silence.

**La forge est gratuite** tant que le dépôt est public : les runners standard
n'ont pas de quota de minutes. Le coût réel est la **durée** et la maintenance,
jamais l'argent. Ne pas passer à un runner « larger » : ceux-là sont facturés,
dépôt public ou non.

---

## 3. Les trois leviers du rapporteur

Tous les trois vivent dans [`vitest.gates.ts`](../../vitest.gates.ts) — source
unique. Aucun ne se recopie dans un workflow.

### `proof` — la preuve qu'un décor a SERVI

Une variable posée ne prouve que le décor. Une URL mal formée la laisse posée,
fait sauter les suites, et le vert revient. `proof` exige qu'**au moins un cas
soit PASSÉ** en portant le motif.

```ts
// src/packages/@nodefony/drizzle/vitest.config.ts
reporters: [
  "default",
  gateReporter([
    { gate: PG_GATE, proof: "(postgres)" },
    { gate: MYSQL_GATE, proof: "(mysql)" },
  ]),
],
```

Le motif est parenthésé parce que c'est la forme des `describe` gatés ; un
`describe` qui contient « postgres » mais tourne sans serveur ne prouverait rien.

### `NF_GATES_ALLOW` — l'absence énoncée

Liste de variables (séparées par des virgules) que **cette passe** renonce à
couvrir. Le rapport les nomme **même quand tout le reste est vert** : une
exemption invisible est une exemption qu'on n'ôte jamais.

```yaml
- name: Run unit tests (turbo)
  env:
    NF_GATES_ALLOW: NF_PG_URL,NF_MYSQL_URL,REDIS_URL,NF_REDIS_TEST_URL,NF_MONGO_TEST_URI
  run: npm test
```

Posé sur deux jobs seulement : les **tests unitaires** (trois systèmes
d'exploitation — on n'y montera pas trois bases) et la **passe de publication**.
Ces cibles sont exercées par `orm.yml` : elles ne sont pas perdues, elles sont
ailleurs.

### `NF_GATES_EXPECT` — l'attente d'une PASSE

Pour ce qui n'appartient pas au paquet mais à l'étape : une sélection par `-t`,
dont le motif peut cesser de mordre.

```yaml
env:
  NF_GATES_EXPECT: "backoff NIST,NIST PARTAGÉ"
run: npx vitest run --config vitest.integration.config.ts -t "(backoff NIST|NIST PARTAGÉ)"
```

Chaque porte est nommée séparément (plutôt qu'un total de « 2 cas ») : quand une
seule tombe, le rapport dit **laquelle**. La syntaxe `motif=N` permet d'exiger un
compte, mais le défaut — au moins un — est presque toujours le bon : un plancher
chiffré se périme au premier test ajouté.

---

### ⚠️ Le piège qui désarme les trois

`--reporter=…` en ligne de commande **remplace** `test.reporters` au lieu de s'y
ajouter. Une étape qui réclame un rapport JSON de cette façon retire la garde
qu'on vient de lui poser — silencieusement, et en restant verte.

C'est arrivé au workflow du gate mémoire le jour même où sa garde y a été
ajoutée : la variable était bien passée, le rapporteur n'était pas chargé, et
seul un contrôle du journal l'a montré. Un rapport supplémentaire se déclare donc
**dans la configuration** :

```ts
reporters: process.env.CI
  ? ["default", ["json", { outputFile: "rapport.json" }], gateReporter(gates)]
  : ["default", gateReporter(gates)],
```

> Vérifier qu'une garde est **chargée** ne se déduit pas d'un job vert : c'est
> précisément ce qu'un job vert ne dit pas. Chercher la ligne du rapporteur dans
> le journal.

---

## 4. Le décor, et ses deux pièges déjà payés

### Redis se monte par `docker run`, pas par `services:`

Le serveur du dépôt tourne en `requirepass`, comme en développement. Le bloc
`services:` de GitHub Actions ne sait pas passer d'argument à la commande du
conteneur (`--requirepass`) : la tentative sort en **exit 125**. D'où l'action
composite [`.github/actions/redis`](../../.github/actions/redis/action.yml).

### `--expose-gc` n'est pas un réglage de confort

La sonde mémoire du module de test lit le heap **après avoir forcé un ramassage**.
Sans `--expose-gc`, `global.gc` n'existe pas : la sonde devient un **no-op**, elle
mesure le déchet transitoire, et le gate accuse au hasard — il a déjà désigné un
crash synchrone pendant qu'un autre, synchrone lui aussi, passait tranquillement.
Le drapeau se pose par l'action composite
[`.github/actions/nodefony-server`](../../.github/actions/nodefony-server/action.yml) :

```yaml
- uses: ./.github/actions/nodefony-server
  with:
    node-args: --expose-gc
```

---

## 5. Rejouer un job sur sa machine

Les variables d'infra ne se retiennent pas : elles sont **dérivées du compose**
par `vitest.gates.ts`, et le rapporteur les affiche en fin de suite quand elles
manquent. La commande qu'il imprime est copiable telle quelle.

```bash
# Tout, avec le rapport de ce qui n'a PAS été testé
npm run test:all
npm run test:all -- --infra       # juste l'état de l'infra
npm run test:all -- --dialects    # + rejoue les suites ORM sur MySQL Community

# Job « Stores » d'orm.yml
docker compose -f docker/docker-compose.yml --profile postgres --profile mariadb up -d postgres mariadb
docker compose -f docker/docker-compose.yml up -d redis
cd src/packages/@nodefony/drizzle
NF_PG_URL=postgres://nodefony:nodefony-dev@127.0.0.1:5432/nodefony \
NF_MYSQL_URL=mysql://nodefony:nodefony-dev@127.0.0.1:3306/nodefony \
npm test

# Job « Socket distribuée » d'orm.yml
cd src/packages/@nodefony/realtime
NF_RUN_CLUSTER_E2E=1 \
REDIS_URL=redis://:nodefony-dev@127.0.0.1:6379 \
NF_REDIS_TEST_URL=redis://:nodefony-dev@127.0.0.1:6379/15 \
npm test

# Job « Charge et mémoire » (exige le serveur lancé avec --expose-gc)
bash .claude/skills/nodefony-start-server/start.sh
cd src/packages/@nodefony/http && npm run test:load

# Preuves e2e autonomes — aucun décor, elles montent leurs propres process
node .claude/skills/nodefony-load-test/scripts/cluster-realtime-e2e.mjs

# Job « Code généré » de scaffold.yml — EXIGE un checkout bâti (il pack depuis dist/)
npm run build
node .claude/skills/nodefony-devkit-bench/scripts/verify-generated.mjs
node .claude/skills/nodefony-devkit-bench/scripts/verify-generated.mjs --link  # boucle courte, verdict AMPUTÉ
```

> ⚠️ `--link` n'est **pas** ce que joue la forge, et la différence n'est pas de
> vitesse : le mode lié symlinke les paquets du dépôt, la résolution de modules
> de Node remonte alors au monorepo, et l'application témoin trouve des paquets
> qu'elle ne déclare pas. Toute la famille « dépendance manquante du gabarit »
> devient invisible — mesuré : l'étape production restait verte avec ET sans
> `@node-rs/argon2`, pendant qu'une application réellement installée mourait au
> boot. Pour la boucle courte, oui ; pour conclure, non.

> **Reproduire le régime de la forge** en local : préfixer par `CI=1`. C'est le
> seul moyen de voir échouer ce qui, sans lui, n'est qu'un avertissement.

---

## 6. Ce que la forge ne lance PAS — et pourquoi

Un choix énoncé n'est pas un oubli. Ce qui suit est délibérément dehors :

<!-- prettier-ignore -->
| Absent | Raison |
| --- | --- |
| Bancs de performance (`NF_RUN_PERF`) | une latence dépend du voisin de runner ; un seuil non déterministe est un futur rouge stérile |
| Sondes de rupture WebSocket (`NF_RUN_WS_RUPTURE`) | elles épuisent les ports éphémères de l'hôte |
| Loki, OpenSearch (`LogBackplaneE2E`) | décor à monter à la forge — et `test:all` n'importe pas leurs gates, donc même une machine qui FAIT tourner les deux conteneurs les saute en silence. Reporté APRÈS la release (décision 2026-07-27) |
| `idempotency-cluster-e2e` | tape sur le serveur de développement : sa place est avec les bancs à serveur partagé |
| Les preuves à décor opt-in (un serveur par plafond) | coût de montage disproportionné pour ce qu'elles ajoutent à chaque poussée |
| Banc reverse-proxy (`reverse-proxy.test.ts`) | décor à DEUX versants — conteneurs `--profile proxy`, serveur en `NF_BIND_ALL=1`, certificats dérivés, `nodefony.com` résolu côté client. Un montage automatique à moitié réussi rendrait le vert menteur qu'on passe ce guide à combattre : il se lance à la main (`PROXY_GATE`, mode d'emploi dans `docker/README.md`) |
| Les autres FRAMEWORKS de vue d'une application générée (`scaffold.yml`) | l'application témoin naît `--frontend vue`, et son front est bâti pour de bon (`frontend:build --force`) — mais un seul des quatre est couvert. Vue est retenu parce que son compilateur TRANSFORME le gabarit, là où Angular et JSX laissent la chaîne intacte |
| Le banc de DÉCOUVRABILITÉ (`bench-discoverability.mjs`) | il lance de vrais agents et coûte de l'argent. Seuls ses auto-contrôles tournent, dans `node.js.yml` — ce sont eux qui décident si un verdict de banc veut dire quelque chose |

**Perf dehors, mémoire dedans** : une latence dépend de la machine, une fuite
fuit quelle que soit la charge.

---

## 6 bis. La couverture — pourquoi ce nombre ne se lit pas comme une note

`npm run coverage` rejoue la couverture des seize modules qui en déclarent une.
Le pourcentage qui en sort est **utile pour repérer un module délaissé**, et
trompeur pour à peu près tout le reste. Trois raisons, que la commande affiche
elle-même en fin de passe plutôt que de les laisser à ce guide.

### Le taux est SURESTIMÉ par les suites qui n'éprouvent pas une fonction

Sur 573 fichiers de test, **24 sont des suites d'attaque** et 7 des bancs de
charge. Une suite d'attaque prouve qu'une intrusion **échoue** : elle traverse le
code — donc elle fait monter le taux — sans rien dire du chemin nominal, qui peut
rester entièrement non éprouvé derrière des lignes comptées « couvertes ». Un
banc de charge, lui, parcourt le pipeline des milliers de fois sans affirmer sa
correction : du volume, pas de la preuve. Seul un test unitaire vérifie un
contrat, et lui seul autorise à lire « couvert » comme « éprouvé ».

### Le taux est SOUS-ESTIMÉ par tout ce qui vit hors des modules

**136 scripts de banc** éprouvent le produit sans peser un gramme dans le
pourcentage : 47 pour la charge, la rupture et les preuves e2e sans navigateur,
56 pour les épreuves du scaffold, 12 pour le multi-pods, 21 d'outillage. Ils
lancent de vrais serveurs, de vraies bases, parfois de vrais agents. Un taux ne
connaît que les suites vitest d'un module ; ceux-là n'y sont pas.

### Un skip compte comme un succès, et ressort comme non couvert

C'est la règle n°1 de ce guide appliquée à la couverture. `npm run coverage` pose
donc le décor depuis `vitest.gates.ts` — mais **uniquement pour les services dont
le conteneur est sain**. Poser l'URL d'un service absent ne rend pas les suites
silencieuses : elle les fait **échouer**, et le rouge est alors imputé au produit.
La commande nomme en tête de passe les services absents et les variables qu'elle
n'a donc pas posées.

**Ce qu'on en fait** : lire les taux les uns à côté des autres pour repérer un
module qui décroche, jamais comme une note de qualité, et jamais entre deux
modules dont les suites n'ont pas la même nature. Le dépôt ne pose aucun plancher
de couverture, et la commande n'échoue que si un module sort en erreur — fixer un
seuil serait une décision de projet, pas un effet de bord d'un outil de mesure.

## 7. Ajouter une cible, une preuve, un workflow

1. **Une nouvelle cible d'infra** → une `EnvGate` dans `vitest.gates.ts`. Ses
   identifiants se **lisent dans le compose**, ils ne se retapent pas : une
   seconde source ment dès que quelqu'un change un port.
2. **La déclarer au paquet** → `gateReporter([{ gate: X_GATE, proof: "…" }])`
   dans son `vitest.config.ts`. Sans `proof`, on ne prouve que le décor.
3. **La monter dans le workflow** → un service compose ou une action composite.
4. **Vérifier que le gate MORD** : casser exprès (variable retirée, motif faux),
   confirmer le code de sortie 1 avec `CI=1`, remettre en état. Un gate qu'on n'a
   jamais vu échouer n'est pas un gate.
5. **Filtrer par chemin** dans le `on:` du workflow, jamais par branche.

> Toute étape qui sélectionne des cas par motif (`-t`) doit porter un
> `NF_GATES_EXPECT`. Sans lui, un renommage la rend décorative en silence.

## 📖 Lexique

| Terme                | Ce que c'est                                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Forge**            | L'intégration continue — ici GitHub Actions. Ce qui rejoue les contrôles à chaque poussée, sur une machine qui n'est pas la vôtre.     |
| **Décor**            | Ce qu'une suite exige pour s'exécuter vraiment : une base joignable, un cache, une variable posée. Déclaré dans `vitest.gates.ts:101`. |
| **Gate**             | Un contrôle bloquant : tant qu'il est rouge, la chaîne s'arrête.                                                                       |
| **Saut** (_skip_)    | Un test non exécuté faute de décor. Il ressort **vert** dans le rapport — c'est tout le problème que cette page traite.                |
| **Preuve** (`proof`) | La trace qu'un décor a réellement servi, et pas seulement été déclaré.                                                                 |
| **Absence énoncée**  | `NF_GATES_ALLOW` : dire explicitement qu'une cible ne sera pas exercée. Ce qui distingue un choix d'un oubli.                          |

## ⚠️ Pièges

- **Un vert n'est pas une preuve tant qu'on n'a pas lu les sauts.** C'est la raison d'être de tout
  le mécanisme décrit ici, et le piège dans lequel ce dépôt est déjà tombé.
- **Sélectionner des cas par motif (`-t`) sans `NF_GATES_EXPECT` rend l'étape décorative** dès le
  premier renommage : elle ne sélectionne plus rien, et ne s'en plaint pas.
- **Le décor de votre machine n'est pas celui de la forge.** Un banc lancé en local avec le
  rechargement à chaud ne mesure pas la même chose que le même banc lancé sans lui — et c'est le
  poste qui ment, pas la forge.
- **Le taux de couverture ne se lit pas comme une note** : la page l'explique dans les deux sens,
  surestimation et sous-estimation. Le lire comme un objectif conduit à écrire des tests qui
  n'éprouvent rien.
- **Un gate qu'on n'a jamais vu échouer n'est pas un gate.** Avant de le croire, le casser une
  fois exprès et vérifier qu'il rend bien un code de sortie non nul.

## 🧪 Tests & couverture

Ce guide décrit l'outillage qui exécute les tests ; ce sont donc les contrôles de cet outillage
lui-même qui le couvrent. Les chiffres exacts vivent dans la carte de l'aperçu.

<!-- prettier-ignore -->
| Type | Où | Ce qui est prouvé |
| --- | --- | --- |
| Unitaires (portabilité des bancs) | `nodefony` `bancsPortables.test.ts` | les bancs et scripts tournent sur les trois plateformes, sans littéral de chemin |
| Unitaires (CLI) | `nodefony` `Cli.test.ts` | codes de sortie et signaux — ce que la forge lit pour décider rouge ou vert |
| Intégration | `nodefony` `CliIntegration.test.ts` | l'exécution réelle des commandes que les workflows appellent |

> La déclaration du décor elle-même (`gateReporter()`, `vitest.gates.ts:544`) n'est pas couverte
> par un test unitaire : elle est éprouvée par l'usage, en étant lue à la fin de chaque passe. La
> seule façon de vérifier qu'un gate mord reste de le casser exprès.

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Guides](README.md) · [Toute la documentation](../index.md)
- 📦 **Ce qui se passe quand la forge publie** :
  [publier une release](./publier-une-release.md)
- 🗄️ **Le décor de base de données dont parlent les gates** :
  [`persistence.md`](./persistence.md)
- 🐳 **Le même code, mais en production** : [`docker-cloud-native.md`](./docker-cloud-native.md)
- 📖 [Lexique général](../lexique.md) du framework.
