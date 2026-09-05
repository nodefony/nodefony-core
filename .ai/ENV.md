<!-- GÉNÉRÉ par scripts/env-snapshot.ts (npm run env:snapshot).
     NE PAS ÉDITER À LA MAIN.
     Les descriptions d'infra et d'interrupteurs viennent de vitest.gates.ts ;
     celles du décor de banc de scripts/env-catalog.ts. Éditer ici ferait
     diverger la copie de sa source, ce que ce fichier existe pour empêcher. -->

# Variables d'environnement du dépôt

> **La question utile est « absente ⇒ quoi ? »** — sur ce dépôt une variable
> manquante ne lève presque jamais : elle fait sauter des tests en silence,
> et un test sauté compte comme vert.

| Famille | Variables |
| --- | ---: |
| Infrastructure | 10 |
| Interrupteur de coût | 5 |
| Décor de banc | 36 |
| Runtime produit | 63 |

## Décor de banc

Lues UNIQUEMENT par du code de test ou de harnais. Leur absence ne casse
rien : elle change ce qui est EXÉCUTÉ.

### banc bcrypt

| Variable | Rôle | Valeurs | Absente ⇒ |
| --- | --- | --- | --- |
| `NF_BCRYPT_COST` | Coût bcrypt du banc de débit du hachage de mots de passe. | entier — défaut 12 | Le banc mesure au coût 12. |
| `NF_BCRYPT_N` | Nombre de hachages mesurés par le banc de débit bcrypt. | entier — défaut 32 | Le banc mesure 32 hachages. |

### banc cluster temps réel

| Variable | Rôle | Valeurs | Absente ⇒ |
| --- | --- | --- | --- |
| `NF_PERF_COUNT` | Nombre de messages publiés par la mesure de débit du banc cluster temps réel. | entier — défaut 5000 | La mesure porte sur 5000 messages. |
| `NF_RT_CHANNEL` | Canal temps réel sur lequel les exemplaires du banc cluster se parlent. | nom de canal — défaut `nodefony:rt:e2e` | Les exemplaires partagent le canal par défaut : deux bancs lancés en même temps se mélangent, et le verdict dépend du voisin. |

### banc d'adoption de base (migrations)

| Variable | Rôle | Valeurs | Absente ⇒ |
| --- | --- | --- | --- |
| `NF_ADOPT_FIXTURE` | Fait exporter au module `test` la table applicative que le banc d'adoption doit trouver. | `sqlite|postgres|mysql`, éventuellement suffixé `+slug`, `+paire`, `+orphelin` ou `+usurpe` | Le fichier d'entité s'importe et n'exporte AUCUNE table : l'adoption n'a rien à adopter, et une génération voit disparaître la table — ce qu'un outil de diff prend pour une suppression. |

### banc de la ligne de commande

| Variable | Rôle | Valeurs | Absente ⇒ |
| --- | --- | --- | --- |
| `NF_CLI_READY_TIMEOUT_MS` | Délai accordé au démarrage d'un kernel avant que le banc de la ligne de commande abandonne. | millisecondes — défaut 80 000 | Le banc attend 80 s ; sur une machine lente ou froide, c'est ce délai qui décide, pas le produit. |
| `NF_CLI_TIMEOUT_MS` | Délai total d'un cas du banc de la ligne de commande. | millisecondes — défaut 120 000 | Le banc borne chaque cas à 2 min. |

### banc MCP (devkit)

| Variable | Rôle | Valeurs | Absente ⇒ |
| --- | --- | --- | --- |
| `NF_MCP_TEST_BASE` | Origine de la porte MCP éprouvée par le banc. | URL — défaut `https://127.0.0.1:5152` | Le banc vise le serveur de développement en TLS local. |
| `NF_MCP_TEST_RESOURCE_BASE` | Origine attendue dans le document de ressource protégée (RFC 9728) — elle diffère de l'origine d'appel. | URL — défaut `http://localhost:5151` | Le banc attend l'origine en clair du serveur de développement. |

### banc navigateur (devkit)

| Variable | Rôle | Valeurs | Absente ⇒ |
| --- | --- | --- | --- |
| `NF_BROWSER_TEST_ACTION` | Sélecteur de l'élément sur lequel le banc navigateur doit cliquer. | sélecteur CSS | Le banc ne clique sur rien et se borne à constater l'affichage. |
| `NF_BROWSER_TEST_API` | Route de data plane que le banc navigateur interroge depuis la page. | chemin absolu — défaut `/nodefony/kernel/api/info` | Le banc interroge la route d'information du kernel. |
| `NF_BROWSER_TEST_BASE` | Origine que le pilote local ouvre. | URL — défaut `https://127.0.0.1:5152` | Le banc vise le serveur de développement en TLS local. |
| `NF_BROWSER_TEST_BASE_CONTENEUR` | Origine que le navigateur EN CONTENEUR doit ouvrir — elle diffère de l'origine locale, `127.0.0.1` n'y désignant pas l'hôte. | URL | Le banc en conteneur retombe sur l'origine par défaut du conteneur ; viser le mauvais hôte rend un échec qui ressemble à une panne du produit. |
| `NF_BROWSER_TEST_CHANNEL` | Canal temps réel auquel la page doit s'abonner avec succès. | nom de canal — défaut `nodefony:supervision` | Le banc éprouve le canal de supervision. |
| `NF_BROWSER_TEST_CHANNEL_REFUSE` | Canal dont l'abonnement doit être REFUSÉ — la moitié négative de la preuve. | nom de canal — défaut `nodefony:syslog` | Le banc éprouve le refus sur le canal du journal système. |
| `NF_BROWSER_TEST_CONTAINER` | Nom du conteneur qui porte le navigateur, quand la voie conteneur est choisie. | nom docker — défaut `nodefony-browser` | Le banc s'adresse au conteneur nommé `nodefony-browser`. |
| `NF_BROWSER_TEST_EXPECT` | Texte qui doit apparaître à l'écran pour que la page soit tenue pour peuplée. | texte — défaut « Santé du framework » | Le banc attend le titre par défaut ; mesurer avant que l'écran soit peuplé est l'erreur qui fait conclure faux. |
| `NF_BROWSER_TEST_LOGIN` | Chemin du formulaire d'authentification. | chemin absolu — défaut `/nodefony/login` | Le banc s'authentifie par l'écran d'administration. |
| `NF_BROWSER_TEST_PAGE` | Page authentifiée que le banc ouvre et mesure. | chemin absolu — défaut `/nodefony/supervision` | Le banc ouvre l'écran de supervision. |
| `NF_BROWSER_TEST_PAGE_PUBLIQUE` | Page atteignable SANS session, pour distinguer un refus d'autorisation d'une panne. | chemin absolu — défaut : la page d'authentification | Le banc prend la page d'authentification comme page publique. |
| `NF_BROWSER_TEST_PAGE_SOCKET` | Page depuis laquelle le socket est ouvert — il hérite de ses cookies et de son origine. | chemin absolu — défaut `/nodefony` | Le socket est ouvert depuis la racine de l'administration. |
| `NF_BROWSER_TEST_PASSWORD` | Mot de passe du compte qui doit être ACCEPTÉ. | chaîne — défaut `secret` | Le banc utilise le mot de passe de développement. |
| `NF_BROWSER_TEST_PASSWORD_REFUSE` | Mot de passe du compte dont l'accès doit être REFUSÉ. | chaîne — défaut `secret` | Le banc utilise le mot de passe de développement pour le cas négatif. |
| `NF_BROWSER_TEST_SOCKET` | Point d'entrée du socket temps réel éprouvé depuis la page. | chemin absolu — défaut `/nodefony/studio/api/realtime` | Le banc ouvre le socket de la console d'administration. |
| `NF_BROWSER_TEST_USER` | Identifiant du compte qui doit être ACCEPTÉ. | chaîne — défaut `admin` | Le banc s'authentifie en administrateur. |
| `NF_BROWSER_TEST_USER_REFUSE` | Identifiant du compte dont l'accès à la page protégée doit être REFUSÉ. | chaîne — défaut `user` | Le banc éprouve le refus avec un compte sans privilège. |

### bancs du module test

| Variable | Rôle | Valeurs | Absente ⇒ |
| --- | --- | --- | --- |
| `NF_BENCH_ORM` | Monte le décor du banc du cycle ORM dans le module `test` (routes, entités, amorçage). | `1` — toute autre valeur laisse le décor absent | Les routes du banc ORM n'existent pas : un banc lancé sans elle rend des 404 qu'on prend pour une régression de routage. |
| `NF_BENCH_WS_BACKPRESSURE` | Monte le point d'entrée WebSocket capable d'inonder une connexion, pour mesurer la contre-pression. | `1` — toute autre valeur laisse le point d'entrée absent | Le point d'entrée n'existe pas — c'est voulu : offert en permanence, il serait une amplification à la demande de qui la réclame. |
| `NF_BENCH_WS_BYTES` | Taille en octets de chaque trame émise par le banc de contre-pression WebSocket. | entier — défaut 16384 | Le banc émet des trames de 16 Kio. |
| `NF_BENCH_WS_FRAMES` | Nombre de trames émises d'un bloc par le banc de contre-pression WebSocket. | entier — défaut 400 | Le banc émet 400 trames. |

### coupure réelle de base

| Variable | Rôle | Valeurs | Absente ⇒ |
| --- | --- | --- | --- |
| `NF_DB_OUTAGE_MONGO_CONTAINER` | Nom du conteneur MongoDB que le banc a le droit d'ARRÊTER pour éprouver une coupure réelle. | nom docker | Le banc de coupure MongoDB est SAUTÉ — le produit n'est jamais mis à l'épreuve d'une base qui tombe. |
| `NF_DB_OUTAGE_MYSQL_CONTAINER` | Nom du conteneur MySQL que le banc a le droit d'ARRÊTER pour éprouver une coupure réelle. | nom docker | Le banc de coupure MySQL est SAUTÉ. |
| `NF_DB_OUTAGE_PG_CONTAINER` | Nom du conteneur PostgreSQL que le banc a le droit d'ARRÊTER pour éprouver une coupure réelle. | nom docker | Le banc de coupure PostgreSQL est SAUTÉ. |

### pare-feu — limitation de débit

| Variable | Rôle | Valeurs | Absente ⇒ |
| --- | --- | --- | --- |
| `NF__SECURITY__RATELIMIT__ENABLED` | Allume la limitation de débit du pare-feu pour les bancs qui l'attaquent. | `"true"` — toute autre valeur laisse la limitation éteinte | Les cas qui prouvent le throttling sont SAUTÉS ; la suite reste verte sans avoir exercé la limitation. |

### sonde de rupture WebSocket

| Variable | Rôle | Valeurs | Absente ⇒ |
| --- | --- | --- | --- |
| `NF_WS_RUPTURE_CAP` | Plafond de connexions simultanées que la sonde de rupture WebSocket s'autorise. | entier — défaut 8000 | La sonde s'arrête à 8000 : elle mesure alors SON plafond, pas celui du produit — le vrai plafond exige de relever cette borne. |
| `NF_WS_RUPTURE_STEP` | Pas d'augmentation des connexions entre deux paliers de la sonde de rupture. | entier — défaut 1000 | La sonde progresse par paliers de 1000 connexions. |

## Infrastructure

Décrites dans [`vitest.gates.ts`](../vitest.gates.ts), qui porte AUSSI la
commande docker et le rapporteur qui fait échouer la CI quand une cible
déclarée n'a pas été exercée.

| Variable | Cible |
| --- | --- |
| `NF_LOKI_TEST_URL` | Loki (serveur réel) |
| `NF_MONGO_TEST_URI` | MongoDB (replica set) |
| `NF_MYSQL_URL` | MySQL Community |
| `NF_OPENSEARCH_TEST_URL` | OpenSearch (serveur réel) |
| `NF_PG_URL` | PostgreSQL |
| `NF_PROXY_HAPROXY_TLS_URL` | Reverse-proxy réels (nginx + haproxy) |
| `NF_PROXY_HAPROXY_URL` | Reverse-proxy réels (nginx + haproxy) |
| `NF_PROXY_NGINX_URL` | Reverse-proxy réels (nginx + haproxy) |
| `NF_REDIS_TEST_URL` | Redis (serveur réel) |
| `NF_REDIS_URL` | Redis (serveur réel) |

## Interrupteurs de coût

| Variable | Ce qu'il ouvre |
| --- | --- |
| `NF_RUN_CLI_BOOT` | boots CLI réels (lents : un kernel par cas) |
| `NF_RUN_CLUSTER_E2E` | scénarios cluster multi-process |
| `NF_RUN_DB_OUTAGE` | coupures RÉELLES de base (arrête et relance un conteneur ; exige aussi NF_DB_OUTAGE_{PG,MYSQL,MONGO}_CONTAINER) |
| `NF_RUN_PERF` | micro-bancs de performance (seuils non déterministes) |
| `NF_RUN_WS_RUPTURE` | sondes de rupture WebSocket (épuisent les ports) |

## Runtime produit (63)

Lues par le produit : leur vérité est le TSDoc de leur site de lecture, et
c'est là qu'elle doit rester — la recopier ici en ferait une seconde vérité.
Ce relevé donne le premier site de lecture, pour y aller directement.

| Variable | Premier site |
| --- | --- |
| `NF__DEBUG` | `src/nodefony/src/kernel/Kernel.ts:2413` |
| `NF_BENCH_AUDIT_NOMINAL` | `src/packages/@nodefony/http/nodefony/service/http-kernel.ts:714` |
| `NF_BENCH_ROUTE` | `src/packages/@nodefony/framework/index.ts:461` |
| `NF_BOOT_TIMEOUT_MS` | `src/nodefony/src/kernel/Kernel.ts:2663` |
| `NF_BOOT_WARN_MS` | `src/nodefony/src/kernel/Kernel.ts:2675` |
| `NF_BROWSER_ACTION` | `src/packages/@nodefony/devkit/skills/nodefony-browser/scripts/socket.mjs:58` |
| `NF_BROWSER_ACTION_PARAMS` | `src/packages/@nodefony/devkit/skills/nodefony-browser/scripts/socket.mjs:44` |
| `NF_BROWSER_ACTIONS` | `src/packages/@nodefony/devkit/skills/nodefony-browser/scripts/inspect.mjs:89` |
| `NF_BROWSER_API` | `src/packages/@nodefony/devkit/skills/nodefony-browser/scripts/socket.mjs:60` |
| `NF_BROWSER_AXE` | `src/packages/@nodefony/devkit/skills/nodefony-browser/scripts/inspect.mjs:136` |
| `NF_BROWSER_BASE` | `src/packages/@nodefony/devkit/skills/nodefony-browser/scripts/lib/browser.mjs:66` |
| `NF_BROWSER_CATEGORIES` | `src/packages/@nodefony/devkit/skills/nodefony-browser/scripts/audit.mjs:122` |
| `NF_BROWSER_CHANNEL` | `src/packages/@nodefony/devkit/skills/nodefony-browser/scripts/socket.mjs:57` |
| `NF_BROWSER_COLOR_SCHEME` | `src/packages/@nodefony/devkit/skills/nodefony-browser/scripts/lib/browser.mjs:142` |
| `NF_BROWSER_ENGINE` | `src/packages/@nodefony/devkit/skills/nodefony-browser/scripts/lib/browser.mjs:75` |
| `NF_BROWSER_EXPECT` | `src/packages/@nodefony/devkit/skills/nodefony-browser/scripts/inspect.mjs:54` |
| `NF_BROWSER_FAMILIES` | `src/packages/@nodefony/devkit/skills/nodefony-browser/scripts/inspect.mjs:91` |
| `NF_BROWSER_FORMFACTOR` | `src/packages/@nodefony/devkit/skills/nodefony-browser/scripts/audit.mjs:39` |
| `NF_BROWSER_FULLPAGE` | `src/packages/@nodefony/devkit/skills/nodefony-browser/scripts/inspect.mjs:820` |
| `NF_BROWSER_LOGIN` | `src/packages/@nodefony/devkit/skills/nodefony-browser/scripts/lib/browser.mjs:96` |
| `NF_BROWSER_MAXFRAMES` | `src/packages/@nodefony/devkit/skills/nodefony-browser/scripts/watch.mjs:25` |
| `NF_BROWSER_OUT` | `src/packages/@nodefony/devkit/skills/nodefony-browser/scripts/lib/browser.mjs:67` |
| `NF_BROWSER_PAGE` | `src/packages/@nodefony/devkit/skills/nodefony-browser/scripts/audit.mjs:37` |
| `NF_BROWSER_PASSWORD` | `src/packages/@nodefony/devkit/skills/nodefony-browser/scripts/lib/browser.mjs:86` |
| `NF_BROWSER_PINGS` | `src/packages/@nodefony/devkit/skills/nodefony-browser/scripts/socket.mjs:62` |
| `NF_BROWSER_PROBES` | `src/packages/@nodefony/devkit/skills/nodefony-browser/scripts/inspect.mjs:116` |
| `NF_BROWSER_SEUIL_AUDIT` | `src/packages/@nodefony/devkit/skills/nodefony-browser/scripts/audit.mjs:38` |
| `NF_BROWSER_SEUIL_LENT` | `src/packages/@nodefony/devkit/skills/nodefony-browser/scripts/inspect.mjs:732` |
| `NF_BROWSER_SEUIL_LOURD` | `src/packages/@nodefony/devkit/skills/nodefony-browser/scripts/inspect.mjs:731` |
| `NF_BROWSER_SOCKET` | `src/packages/@nodefony/devkit/skills/nodefony-browser/scripts/socket.mjs:32` |
| `NF_BROWSER_SOCKET_WAIT` | `src/packages/@nodefony/devkit/skills/nodefony-browser/scripts/socket.mjs:61` |
| `NF_BROWSER_STORAGE` | `src/packages/@nodefony/devkit/skills/nodefony-browser/scripts/lib/browser.mjs:152` |
| `NF_BROWSER_UNTIL` | `src/packages/@nodefony/devkit/skills/nodefony-browser/scripts/watch.mjs:24` |
| `NF_BROWSER_USER` | `src/packages/@nodefony/devkit/skills/nodefony-browser/scripts/lib/browser.mjs:85` |
| `NF_BROWSER_WIDTHS` | `src/packages/@nodefony/devkit/skills/nodefony-browser/scripts/inspect.mjs:825` |
| `NF_CLUSTER` | `src/nodefony/src/service/cluster/clusterMaster.ts:51` |
| `NF_CLUSTER_PROBE` | `src/nodefony/src/service/cluster/clusterMaster.ts:56` |
| `NF_DATABASE_URL` | `src/modules/test/nodefony/entity/benchOrm.ts:53` |
| `NF_DEV_CHILD` | `src/nodefony/src/kernel/Kernel.ts:904` |
| `NF_DEV_PORTS` | `src/nodefony/src/service/dev/devProcess.ts:579` |
| `NF_ENV` | `src/nodefony/src/bin/nodefony.ts:91` |
| `NF_INSTANCE_ID` | `src/packages/@nodefony/framework/nodefony/controller/AdminApiController.ts:38` |
| `NF_KERNEL_TRACE_FILE` | `src/nodefony/src/kernel/Kernel.ts:636` |
| `NF_MODE_START` | `src/nodefony/src/kernel/commands/ClusterCommand.ts:62` |
| `NF_MONGODB_DEBUG` | `src/packages/@nodefony/mongoose/tests/unit/config.test.ts:132` |
| `NF_NO_TTY` | `src/nodefony/src/kernel/Kernel.ts:504` |
| `NF_ORM_FLOW` | `src/packages/@nodefony/orm-core/nodefony/src/ormWiring.ts:98` |
| `NF_ORM_HEARTBEAT_MS` | `src/packages/@nodefony/orm-core/nodefony/src/Orm.ts:22` |
| `NF_PERF_PROBE` | `src/packages/@nodefony/http/nodefony/service/http-kernel.ts:138` |
| `NF_POD_NAME` | `src/packages/@nodefony/realtime/nodefony/src/backplane/originId.ts:25` |
| `NF_PORT` | `src/nodefony/src/service/dev/devProcess.ts:591` |
| `NF_PORT_HTTPS` | `src/nodefony/src/service/dev/devProcess.ts:591` |
| `NF_REALTIME_BACKPLANE_NAMESPACE` | `src/packages/@nodefony/realtime/nodefony/config/defineModuleConfig.ts:56` |
| `NF_REALTIME_BACKPLANE_SECRET` | `src/packages/@nodefony/realtime/nodefony/config/defineModuleConfig.ts:50` |
| `NF_REALTIME_DRIVER` | `src/packages/@nodefony/realtime/nodefony/config/defineModuleConfig.ts:46` |
| `NF_REDIS_HOST` | `src/packages/@nodefony/realtime/nodefony/tests/integration/RedisBackplane.test.ts:21` |
| `NF_REDIS_PASSWORD` | `src/packages/@nodefony/realtime/nodefony/tests/integration/RedisBackplane.test.ts:20` |
| `NF_REDIS_PORT` | `src/packages/@nodefony/realtime/nodefony/tests/integration/RedisBackplane.test.ts:22` |
| `NF_RELEASE_REPO` | `scripts/release/pack-all.mjs:81` |
| `NF_START` | `src/nodefony/src/kernel/Kernel.ts:523` |
| `NF_TEST_ENV` | `src/packages/@nodefony/http/nodefony/tests/helpers/targetEnv.ts:16` |
| `NF_WORKERS` | `src/nodefony/src/service/cluster/topology.ts:87` |
| `NF_X` | `scripts/env-snapshot.ts:123` |

