---
name: nodefony-load-test
description: >
  Charge, stress et DIMENSIONNEMENT HTTP/WebSocket de Nodefony : suites Vitest versionnées
  (non-régression, sondes de rupture derrière un flag) et une trentaine de scripts autonomes
  (plafond de connexions WS, débit, RPS et percentiles, capacité d'un pod, e2e cluster).
  **À charger AVANT de lancer un de ces scripts** : le script produit un chiffre, c'est le protocole
  qui en fait une mesure — décor requis, médiane de N runs, et les pièges qui ont déjà produit des
  chiffres faux (mesurer sous rafale ne mesure pas la latence, une variance ×3 ne tranche rien).
  Déclencheurs : "test de charge", "stress", "benchmark", "combien de connexions", "jusqu'à la
  rupture", "RPS", "latence p99", "est-ce que ça tient la charge ?", "combien de pods ?",
  "c'est plus rapide ?", "quel est l'impact perf de ce changement ?", "mesurer avant/après",
  "dimensionner", "prouver que c'est plus rapide".
---

# load-test

Deux niveaux complémentaires. **Toujours s'assurer que le serveur dev tourne d'abord**
(`bash .claude/skills/nodefony-start-server/start.sh`). Le serveur écoute 5151 (http/ws)

- 5152 (https/wss). Les scripts ciblent **5152 (TLS, `rejectUnauthorized:false`)** par défaut.

## Niveau 1 — Suites vitest versionnées (non-régression)

Le « vrai » filet de sécurité, committé dans `@nodefony/http`, lancé via la config
**dédiée** `vitest.load.config.ts` (séparée de la non-régression rapide ; mocha SUPPRIMÉ
2026-06-05). Séquentielle (`fileParallelism:false`). Cas CI-stables

- sondes plafond/rupture **gated** derrière `NF_RUN_WS_RUPTURE=1` (épuisent les ports
  éphémères → disruptif, jamais en CI par défaut).

```bash
bash .claude/skills/nodefony-load-test/scripts/run.sh load             # WS load CI-stable
bash .claude/skills/nodefony-load-test/scripts/run.sh load --rupture   # + plafond/rupture
# ou directement : cd src/packages/@nodefony/http && npm run test:load
```

Fichiers couverts (cf `src/packages/@nodefony/http/CLAUDE.md` § « Suites séparées ») :

| Fichier                                  | Sujet                                                    |
| ---------------------------------------- | -------------------------------------------------------- |
| `tests/load/ws-connections-load.test.ts` | axe 1 — connexions concurrentes + churn (drain par poll) |
| `tests/load/ws-messages-load.test.ts`    | axe 2 — débit echo + broadcast fan-out                   |
| `tests/load/als-load.test.ts`            | leaks de scopes DI (BUG-001/003/004) sous charge WS      |
| `tests/http/memory.test.ts`              | deltas heap HTTP + WS (seuils blockers)                  |

Gate perf seul (avant tout commit touchant Kernel/pipeline/mémoire) :

```bash
cd src/packages/@nodefony/http && npm run test:memory
```

## Niveau 2 — Scripts client standalone (exploration)

Pour pousser **à la main** au-delà des seuils CI et trouver les vraies limites.
Node ESM purs (`ws` + builtins), **lancés depuis la racine du repo**, paramétrés par ENV.

> **📇 Les 31 scripts sont catalogués dans [`references/catalogue.md`](references/catalogue.md)** —
> ce que chacun prouve, son alias `run.sh`, ses variables. Le catalogue couvre **tout**, notamment
> la vingtaine de **preuves e2e sans navigateur** (idempotence distribuée, TOTP, webhooks,
> rate-limit, arrêt gracieux, cluster) qui vivent ici parce qu'elles exigent le même décor qu'un
> banc de charge.
>
> **Détail : [`references/protocoles-bancs-charge.md`](references/protocoles-bancs-charge.md)** —
> le protocole complet (décor, ENV, mesures de référence, pièges) des neuf bancs de charge les plus
> utilisés : Axe 1 (connexions WS), Axe 2 (messages/broadcast), charge HTTP, contre-pression WS,
> charge du hub realtime, stress combiné supervision, démo AIMD, cluster sans PM2, override de
> config par env.
>
> **Mesures hors requête** — deux bancs mesurent autre chose que le trafic, avec le même protocole
> (plusieurs runs, médiane, décor maîtrisé) :
>
> | Script                        | Ce qu'il mesure                                                                            |
> | ----------------------------- | ------------------------------------------------------------------------------------------ |
> | `scripts/boot-bench.mjs`      | temps de boot d'un mode, du spawn jusqu'à l'écoute des serveurs + nombre de `new Kernel()` |
> | `scripts/poc-hmr-perf.mjs`    | délai de bout en bout entre le `touch` d'un fichier surveillé et le rechargement Vite      |
> | `scripts/route-scan-cost.mjs` | ce que la résolution de route coûte à une app, et sa sensibilité au NOMBRE de routes       |
> | `scripts/db-backend-cost.mjs` | ce qu'un pilote de base coûte au serveur : latence, blocage de la boucle, plafond réel     |
>
> **Micro-bancs isolés — `scripts/micro/`** : ils mesurent UN mécanisme hors du serveur, pour
> convertir en nanosecondes un poste qu'un profil désigne en pourcentage. C'est le geste qui a
> évité trois chantiers ouverts pour rien (écart ×25-30 entre l'attribution d'un profil et le
> coût réel) — **tout % de profil se convertit en ns AVANT d'ouvrir un lot**. Ils mentent dans
> l'autre sens (tas froid, sites d'appel monomorphes) : l'arbitre reste la sonde in-situ.
>
> | Micro-banc                    | Ce qu'il isole                                                       |
> | ----------------------------- | -------------------------------------------------------------------- |
> | `micro/micro-enterscope.mjs`  | entrée/sortie d'une portée DI sur un conteneur peuplé (dist du cœur) |
> | `micro/micro-extend.mjs`      | le coût de `Tools.extend` face au spread et à une version mémoïsée   |
> | `micro/micro-route-scan.mjs`  | le scan des motifs sur la table RÉELLE de l'app (`NF_ROUTES_JSON`)   |
> | `micro/micro-route-scale.mjs` | la même chose à N croissant : la COURBE, de 136 à 2 400 routes       |
>
> **Rapport du dossier de performance** : `scripts/perf-dossier-report.mjs` rend en une page HTML
> autonome ce que `docs/performance/` établit en Markdown (graphes, schémas, calculateur de pods).
> Les données sont déclarées dans le script et embarquées dans la page.
>
> 🔴 **Un instrument ne vit jamais dans `tmp/`.** Le rapport est une photo — il s'écrit dans `tmp/`
> et se refabrique ; le script qui le produit est du CODE, et un ménage de `tmp/` emporterait la
> seule façon de le reproduire. Même règle pour les micro-bancs : ils ont été rapatriés ici après
> avoir failli disparaître avec le dossier qui les hébergeait.
>
> **`route-scan-cost.mjs` répond à une question qu'aucun banc de charge ne pose** : l'index de
> routes livré en juin (+15,3 % RPS) porte sur les routes **littérales** (Map par chemin exact) —
> la résolution est donc `O(dynamiques)`, pas `O(1)`. Les routes à variable ou wildcard restent
> scannées une à une à chaque requête. Ce banc chiffre ce résidu : invisible sur le dépôt
> (136 routes, 47 dynamiques → ~1 µs, 1,3 % d'un budget de requête), franchement cher sur une app
> qui déclare mille routes (~26 µs, 30 %). C'est la mesure qui dit si l'étape suivante
> (bucketisation des dynamiques) se justifie pour une application donnée. Trois sorties indépendantes : `--diagnostic` (le
> compte de `Route.match` par requête, exact et sans mesure), `--measure` (le coût en ns, médiane
> de N runs, avec refus sous variance), `--scale` (la courbe à 136 → 2400 routes).
>
> ```bash
> node .claude/skills/nodefony-load-test/scripts/route-scan-cost.mjs             # app courante
> node …/route-scan-cost.mjs --measure --target /nodefony/security/api/auth/me
> node …/route-scan-cost.mjs --scale                                            # la courbe
> ```
>
> ⚠️ Il recompile les motifs depuis `nodefony inspect routes --json` : ce n'est pas le motif de
> production, et il ne mesure que le scan (pas hostname/requirements, payés une fois sur la route
> qui matche). Le chiffre est une **borne basse**, le compte de `--diagnostic` est exact.

## Niveau 3 — A/B perf MONO PROD (coût du pipeline par requête)

Pour **chiffrer une optimisation du pipeline HTTP** (pas explorer une limite). Le RPS d'un
**1 process `production`** sous `wrk` est CPU-bound (~119 % CPU) → il reflète directement le
travail par requête. Le cluster est co-location-bound (ne montre PAS un gain CPU/req).

```bash
# A/B atomique — paires ALTERNÉES (annule la dérive thermique de la machine) :
S=.claude/skills/nodefony-load-test/scripts/bench-ab-mono.sh
bash $S old1 NF_BENCH_X=0 ; bash $S new1 NF_BENCH_X=1
bash $S old2 NF_BENCH_X=0 ; bash $S new2 NF_BENCH_X=1
# Comparer médianes old* vs new*. Garder le gain SSI il dépasse le bruit (±~3 %)
# ET les deux new > les deux old (séparation nette). Sinon = bruit → jeter.
```

Le script (`bench-ab-mono.sh`) : banc propre (kill ports + Vite, attend la libération) →
spawn mono `production` **detached** (`NODE_ENV=production`, `NF_LOG_DRIVER=null`,
`NF_BENCH_ROUTE=1` FORCÉS) → attend le boot → **vérifie que la cible répond 200** → cooldown
thermique pré-série + **warmup wrk NON compté** (JIT) → 3× `wrk` enchaînés (pause fixe 10 s —
jamais de longue pause intra-série : elle endort le serveur idle et le run suivant paie −13 %) →
**min/méd/max + REFUS si dispersion > 3 %** (le seuil de décision A/B ne peut trancher sous une
fenêtre plus bruyante que lui) → arrêt gracieux. Sortie : `.med` (médiane) + `.json` (détail
runs/dispersion/thermal pour le rapport). `bench-ab-mono.sh purge` entre deux lots — un `.med`
survivant entre dans une comparaison qui ne le concerne pas. Toggles A/B = env vars passées au
serveur (`KEY=VAL`), à lire **1× au boot** côté code (jamais `process.env` dans le hot path).

**Détail : [`references/ab-perf-mono-prod.md`](references/ab-perf-mono-prod.md)** — la cible de
banc dédiée (`/nodefony/kernel/bench`) et ce qu'il ne faut pas lui substituer, la méthode du diff
structurel sans toggle env, les pré-requis du banc, les résultats déjà engrangés, la matrice de
store memory vs sqlite, et le banc comparatif Nodefony vs Express/Fastify/nu.

## Repères empiriques (loopback, machine 32 GB) — pour situer un résultat

Détail : [`references/reperes-empiriques.md`](references/reperes-empiriques.md).

## 🚨 RÈGLE N°1 — aucun chiffre sans contrôle de validité

**Un banc qui ne vérifie pas que le travail a EU LIEU mesure la vitesse à laquelle on
échoue.** Ce n'est pas une hypothèse : sur un port fermé, `http-load.mjs` annonçait
**1626 RPS**, et le chiffre n'avait l'air de rien d'anormal. C'est ce qui le rend
dangereux — une erreur coûte moins cher qu'une vraie réponse, donc **échouer améliore
le score**.

Tout banc, ancien ou nouveau, doit :

1. **Prouver la cible AVANT de mesurer** — code HTTP attendu (`200`), payload attendu,
   ou volume attendu. Une cible fausse → sortir en erreur, jamais publier.
2. **Prouver le travail PENDANT la mesure** — `Non-2xx or 3xx responses` de wrk, octets
   réellement écrits, messages réellement reçus. Un run pollué est **invalide**, pas
   « un peu moins bon ».
3. **Ne compter que le succès** dans le débit ET dans les percentiles. Un `ECONNREFUSED`
   revient en ~0 ms : le laisser entrer _améliore_ le p50 tout en gonflant le RPS.
4. **Refuser de conclure sous la variance.** Deux mesures à 21 ms et 23 ms avec 27 % de
   variance ne se classent pas. `log-sink-contention.mjs` annonce désormais
   « DANS LE BRUIT » au lieu d'un ratio.
5. **Sortir en code ≠ 0** quand rien n'a été mesuré — un banc muet ne doit pas ressembler
   à un banc réussi. (⚠️ vérifier l'exit **sans pipe** : en zsh `$?` après un pipe est
   celui du dernier maillon.)

Contrôles en place : `http-load.mjs` (RPS servi + exit 1) · `bench-ab-mono.sh` et
`bench-frameworks/bench.sh` (cible 200 + non-2xx sous charge) · `log-sink-contention.mjs`
(octets écrits vs attendus) · `capacity.mjs` (statut vérifié en HTTP/1.1 ET HTTP/2 — ses
chiffres deviennent des constantes de dimensionnement de pod).

Reste à durcir (chiffres publiés, contrôle partiel ou absent) : `hub-load.mjs`,
`supervision-stress.mjs`, `cluster-ipc.mjs`, `aimd-demo.mjs`, `ws-connections.mjs`.

## 🚨 RÈGLE N°1 bis — LATENCE et BLOCAGE sont deux grandeurs ; une seule plafonne un process

Payé cher : **quatre instruments faux d'affilée** sur cette seule question, et **deux explications
successives réfutées**. Ce qui suit évite de le repayer.

**Le fait, prouvé** — on arme un rappel (`setImmediate`) JUSTE AVANT la requête et on regarde quand
il part. L'effet est à l'échelle de la centaine de millisecondes, donc insensible aux erreurs de
mesure fine :

| pilote                       | durée requête | retard du rappel | verdict              |
| ---------------------------- | ------------- | ---------------- | -------------------- |
| SQLite (`better-sqlite3`)    | 133 ms        | **134 ms**       | **bloque** la boucle |
| PostgreSQL (`pg_sleep(0.5)`) | 503 ms        | **0,22 ms**      | ne bloque **pas**    |

Un pilote **synchrone** exécute la requête sur le fil unique : sa latence EST son blocage, et c'est
ce blocage qui borne le débit d'un process (et fait exploser le p99 dès que la concurrence dépasse
ce qu'un fil sérialise — d'où les timeouts à c128 sur les bancs ORM). Un pilote **asynchrone** rend
la main : son attente ne coûte aucun débit tant qu'il reste du travail à servir.

**Les quatre instruments qui ont menti** — à ne pas réessayer :

1. `setInterval(2ms)` + `setTimeout(0)` entre les requêtes : Node borne un délai de 0 à ~1 ms → on
   mesure la granularité du minuteur. Verdict produit : « SQLite bloque 0,43 ms » pour une requête
   de 33 µs (**×13**).
2. `monitorEventLoopDelay` : résolution de l'ordre de la milliseconde → **aveugle** à un blocage de
   quelques dizaines de µs ; il rendait son propre plancher pour les DEUX pilotes.
3. Une colonne « bloque la boucle ? **non** » : une assertion **jamais mesurée** présentée comme un
   résultat. **Un banc qui n'a pas mesuré doit se taire, pas répondre « non ».**
4. `process.cpuUsage()` lu comme « CPU du fil principal » : il compte **tous** les fils (GC compris)
   — c'est un MAJORANT, jamais un plafond de débit. Sur une réponse volumineuse il a rendu 110 % du
   temps mural.

**🔴 Et le piège qui a réfuté deux explications de suite : sur macOS, le plafond mesuré n'est ni la
base ni le framework, c'est Docker Desktop.** Symptôme trompeur : le conteneur PostgreSQL à ~460 %
de CPU « concorde » avec un `EXPLAIN ANALYZE` à ~1 ms — coïncidence de deux erreurs (ce 1 ms est le
PREMIER plan d'une session neuve ; à chaud c'est 0,02–0,06 ms). Contre-mesures, toutes rapides :

```bash
docker info --format '{{.NCPU}}'          # combien de vCPU la VM a-t-elle VRAIMENT ?
sysctl -n hw.physicalcpu hw.logicalcpu    # et combien de cœurs PHYSIQUES dessous ?
# les backends attendent-ils le client (ClientRead) plutôt que de travailler ?
docker exec -i <pg> psql -U <u> -d <db> -c "SELECT state, wait_event FROM pg_stat_activity"
# la base est-elle vraiment au bout ? même requête, même mode protocole, DANS le conteneur :
docker exec -i <pg> pgbench -n -c 20 -j 4 -T 6 -M extended -f /tmp/q.sql <db> -U <u>
```

Mesuré ici : **16 222 tps dans le conteneur contre ~4 400 depuis l'hôte — facteur 3,7 pour le seul
chemin virtualisé** (VM ~685 % côté hôte, proxy `com.docker.backend` ~152 %, Node ~50 %, sur
6 cœurs physiques). **Conséquence : aucun ABSOLU mesuré derrière Docker Desktop n'est
transposable.** Les A/B intra-fenêtre restent valides (même décor des deux côtés) ; les comparaisons
entre moteurs, non.

## 🚨 RÈGLE N°2 — un banc e2e a un DÉCOR ; décor manquant ≠ échec

Les bancs de la famille 2 ne partagent PAS un décor unique. Les lancer en boucle naïve
sur le serveur dev standard fabrique des ÉCHECS FANTÔMES (vécu : 13/17 « KO », zéro vrai
bug de code). Trois pièges, tous du décor :

1. **Décor OPT-IN manquant** — `ratelimit` / `ws-handshake-ratelimit`
   (`NF__HTTP__RATELIMIT__ENABLED=true`), `ws-conn-cap` (`NF__HTTP__WSMAXCONNECTIONSPERIP=N`),
   `webhooks-dataplane` (`NF__SECURITY__WEBHOOKS__DENYPRIVATEIPS=true` — le dev est permissif,
   `169.254.169.254` passe en 201 au lieu de 422). Le banc le DIT en sortant (« relance avec
   `NF__…` ») → poser le décor, ne pas compter « KO ». **Tout décor opt-in se pose par env**
   (override module ADR-0006) : jamais d'édition de `nodefony.config.ts`, donc jamais de revert
   oublié. Table complète : `references/catalogue.md` § Décor requis.
2. **Bancs DESTRUCTEURS de serveur** — `graceful-shutdown` (SIGTERM) et les `cluster-*`
   (forkent / prennent les ports) ne vont JAMAIS dans un lot serveur-dépendant : ils tuent le
   serveur partagé → cascade `ECONNREFUSED` sur tous les suivants. Les isoler (ou relancer le
   serveur après).
3. **Store PERSISTANT** — sous drizzle/sqlite (défaut), un banc mort au milieu laisse des résidus
   (endpoints webhook…) qui font échouer le run suivant (« liste pas revenue à l'état initial »)
   → nettoyer, ou `NF_STORE=memory`, avant de rejouer.

Un `ECONNREFUSED` ou un « relance avec `NF__…` » = **décor**, pas régression. Un import de symbole
absent = banc **périmé** (refactor non répercuté), pas bug runtime : le symbole a le plus souvent
**changé de module** — le retrouver par `.ai/symbols.json` (`.symbols.X.module`) et rebrancher
l'import, plutôt que de conclure à une régression du runtime.

### Mesurer la PRODUCTION : les routes de banc n'y sont pas — et le runtime est MINUTÉ

Un serveur `production` ne charge pas les modules `policy:"dev"` : les routes qu'un banc
interroge (`/nodefony/test/*`) n'existent tout simplement pas là-bas, tout répond `404`. Pour
mesurer le mode production pour de vrai :

```bash
NF_WITH_DEV_MODULES=1 NF_WITH_DEV_MODULES_TTL_MIN=120 nodefony production --detach --wait
```

⚠️ **Règle le TTL AVANT de lancer une campagne.** Le runtime en dérogation s'arrête tout seul
(30 min par défaut, plafond 4 h, jamais désarmable) — c'est la garde qui empêche la variable de
survivre à un déploiement. Un serveur qui tombe au milieu d'une rafale ne rend pas une mesure
fausse : il rend une mesure qu'on croira vraie. L'échéance est annoncée au démarrage et un
préavis tombe 5 min avant ; un `CRITIC` qui parle de dérogation dans le journal du banc désigne
cette garde, pas une panne du framework.

Rappel de méthode : la **cible dédiée** `/nodefony/kernel/bench` (`NF_BENCH_ROUTE=1`) existe
justement pour mesurer sans traverser la zone d'administration — elle, ne dépend d'aucun module
de banc.

## Publier les résultats (HTML) — et la question à poser AVANT

Un banc produit une sortie console qui se perd, et deux runs ne s'y comparent pas. Pour
qu'un **humain décide**, générer un rapport HTML autonome :

```bash
# 1. le banc écrit ses données machine
JSON_OUT=tmp/sink.json node .claude/skills/nodefony-load-test/scripts/log-sink-contention.mjs
# 2. le rapport (graphes SVG, tableau triable, décor de la mesure, données embarquées)
node .claude/skills/nodefony-load-test/scripts/bench-report.mjs tmp/sink.json
open tmp/bench-report.html
```

`bench-report.mjs` s'appuie sur le skill **`nodefony-html-report`** (jamais de HTML écrit
à la main). Le rapport porte **le décor** (machine, Node, paramètres, nombre de runs) et
**le verdict de validité** de chaque variante — une mesure invalide y est affichée comme
telle, jamais moyennée en douce. Les données sources sont embarquées : le rapport se
rejoue et se compare.

> **Un rapport est une PHOTO** → `tmp/`, jamais commité, jamais dans `docs/`.
>
> **DEMANDER AVANT DE PUBLIER.** Si les résultats méritent d'entrer dans la documentation
> du framework (page de perf, ADR, README), c'est une décision de l'auteur — **poser la
> question explicitement et attendre le GO**, en précisant : quelle page, quel format
> (Markdown pour la doc versionnée, le HTML restant une photo), et quels chiffres
> exactement, avec leur décor. Publier des chiffres engage le framework : sans leur
> machine, leur version de Node et leur protocole, ils seront lus comme des promesses.

## Gotchas (vécus — ne pas réapprendre)

- **Ouvrir N centaines de WS en un seul `Promise.all` → `AggregateError`** (connect TLS
  loopback dual-stack `internalConnectMultiple`). Les scripts ouvrent **par batches**
  (`BATCH`) — garder ce pattern.
- **Toujours fermer/tracker les sockets** : un bench qui throw laisse des sockets ouvertes
  qui faussent la mesure suivante (et, en test, polluent la baseline scopes serveur).
- **Release de scope serveur lague le `close` client** → mesurer la propreté par **poll**
  de `/nodefony/test/als-test/scopes`, pas un `sleep` fixe (cf suites `tests/load/`).
- **TLS auto-signé** : `rejectUnauthorized:false` partout (déjà dans les scripts).
- **Sondes rupture vitest** : gated `NF_RUN_WS_RUPTURE=1` + `NF_WS_RUPTURE_CAP` — ne PAS les
  activer en CI (disruptif pour la machine hôte).
- Routes test utilisées : `/nodefony/test/ws/echo`, `/nodefony/test/ws/broadcast`,
  `/nodefony/test/memory` (heap), `/nodefony/test/als-test/scopes` (leaks). Fournies par
  `src/modules/test` → rebuild le module test si elles manquent (404).

## Références

- `references/catalogue.md` — les 31 scripts, ce que chacun prouve, alias et variables
- `references/protocoles-bancs-charge.md` — protocole détaillé des 9 bancs de charge les plus utilisés
- `references/ab-perf-mono-prod.md` — détail du Niveau 3 (cible dédiée, diff structurel, matrice store, comparatif frameworks)
- `references/reperes-empiriques.md` — chiffres de référence pour situer un résultat

## Liens

- `nodefony-start-server` — démarrer le serveur (prérequis)
- `nodefony-tail-error-logs` — corréler une rupture avec les logs serveur
- Mémoires IA : `project_ws_stress_studio_lag`, `feedback_load_tests_separation`, `feedback_perf_memory_rule`
