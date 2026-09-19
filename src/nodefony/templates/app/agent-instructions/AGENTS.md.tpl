# AGENTS.md — <%= it.appName %>

<!-- nodefony:start -->

> **N'invente jamais du code Nodefony : génère-le, imite-le, vérifie-le.**
> Trois actes pour toute tâche : **LIRE** (ce fichier, puis la doc pointée) →
> **GÉNÉRER** (`npx nodefony create …` produit du vrai code, à imiter) →
> **VÉRIFIER** (`npm run verify` — UNE commande : types + lint + tests + câblage).
>
> **Le réflexe, avant d'écrire le MOINDRE fichier** : un générateur le
> produit-il ? Écrire à la main un CRUD, un controller, une entité ou un
> squelette de module, c'est le signal que tu as raté une commande de la
> table ci-dessous — arrête-toi et lance-la.
>
> 🔴 **Charge le skill `nodefony-dev` AVANT ta première modification**, quelle
> que soit la tâche : il porte la conduite complète et dit quel skill
> spécialisé prendre. Et sache ceci dès maintenant — **la référence est
> INSTALLÉE, mais `rg` ne descend pas dans `node_modules`** : 70 pages
> paraissent absentes. Une commande les lit, avec la ligne exacte :
> `node node_modules/@nodefony/devkit/skills/nodefony-dev/scripts/docs.mjs <termes>`.
>
> **Tu RENDS une réponse ?** `return this.renderJson(obj)` pour du JSON ;
> `this.setContextHtml()` puis `return this.render(html)` pour une PAGE — le nonce
> CSP de la requête s'écrit **`this.context?.cspNonce`** (le `?.` n'est pas
> optionnel : `context` est `ContextType | undefined`, sans lui le code ne
> compile pas), à recopier dans tout `<script>` en ligne. Ne touche JAMAIS
> `this.response` à la main : poser `Content-Type` toi-même court-circuite la
> négociation, et un `this.response as any` est le signal que tu as raté la façade.
>
> **Tu LIS une liste ?** Elle se BORNE, toujours. Le service d'une entité hérite
> `findPage({ limit: 25 })` — il ne charge que `limit + 1` lignes et rend
> `{ items, hasNext }` ; sinon `find(criteria, { limit })`. Un `find` sans borne
> matérialise la table ENTIÈRE : indolore sur les quelques lignes du poste de
> développement, fatal sur les dizaines de milliers de la production. Il te faut
> une projection de colonnes, une CTE, une agrégation ? Descends au natif **avec
> son type** — `import type { DrizzleDb } from "@nodefony/drizzle"` puis
> `orm.getNativeConnection<DrizzleDb>()`. Sans le paramètre de type tu reçois
> `unknown`, et il ne te reste qu'un `as any` que le contrôle refuse.
>
> **Tu SERS un fichier ?** Trois façades, jamais `createReadStream` à la main :
> `this.renderMediaStream(f)` pour un média qu'on parcourt (`Range` → 206),
> `this.streamFile(f)` pour le fichier entier, `this.renderFileDownload(f)` pour
> forcer le téléchargement. Le faire soi-même rend une réponse que le client ne
> peut pas lire — le détail, plus bas, est MESURÉ.

## Générateurs — appelle-les, ne recompose jamais leur sortie de mémoire

| Besoin                                                                                                  | Commande                                                                                         |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Module applicatif (workspace npm)                                                                       | `npx nodefony create module <nom>`                                                               |
| Controller HTTP **et** WebSocket (même classe)                                                          | `npx nodefony create controller <nom> --kind hello\|rest\|realtime\|duplex\|example`             |
| Controller **réservé à une habilitation** — garde de classe + rôle déclaré dans la hiérarchie           | `npx nodefony create controller <nom> --role ROLE_X`                                             |
| Ressource REST **complète** — entité + service + controller CRUD + tests (ne JAMAIS l'écrire à la main) | `npx nodefony create entity <Nom> --fields "sku:string! price:float"`                            |
| Service métier seul — la logique réutilisable, hors de tout controller                                  | `npx nodefony create service <Nom> [--inject <AutreService>] [--module <m>]`                     |
| Frontend Vite — page, formulaire de connexion et temps réel LIVRÉS                                      | `npx nodefony create front <nom> --frontend <<%= it.frontendEngines %>> [--module <m>]`        |
| Commande CLI `nodefony <module>:<action>`                                                               | `npx nodefony create command <action> [--module <m>] [--phase onReady\|onRegister\|onPostReady]` |

**Ces dossiers ne s'écrivent JAMAIS à la main** — y déposer un fichier signifie
que tu as raté une commande de la table ci-dessus :

| Tu t'apprêtes à écrire dans…     | Lance plutôt                                                             |
| -------------------------------- | ------------------------------------------------------------------------ |
| `nodefony/entity/`               | `npx nodefony create entity <Nom> --fields "…"`                          |
| `nodefony/controllers/`          | `npx nodefony create controller <nom> --kind …`                          |
| `nodefony/service/`              | `npx nodefony create service <Nom>` (ou `create entity`, qui en pose un) |
| `nodefony/command/`              | `npx nodefony create command <action> [--module <m>]`                    |
| `modules/<nom>/` (module entier) | `npx nodefony create module <nom>`                                       |

Le code écrit à la main compile souvent — c'est tout le piège. Il diverge du
gabarit courant, et cette divergence ne se voit qu'à la première montée de
version. `npx nodefony create --help` liste les générateurs de CETTE version : la
liste s'allonge, ne te fie pas à ta mémoire.

Chaque commande se décrit à une machine : `--describe-json` (questions + options
en JSON), `--answers-json <fichier|->` (réponses en JSON), `--dry-run` (plan et
diffs, zéro écriture). Un refus n'écrit jamais rien (transaction).

Les champs d'une entité se déclarent en positionnels :
`npx nodefony create entity Post title:string! views:int=0 status:enum(draft,published) slug:string:index author:ref:User`.
Le `!` interdit le nul, le `?` l'autorise, `:index` pose l'index, `=<valeur>` fixe
la valeur par défaut, `enum(a,b)` borne les valeurs admises, et
`ref:<Entité>` crée la colonne de jointure **avec** son index. Les types portent
leur taille (`string(120)`, `char(2)`, `decimal(10,2)`). Un index de TABLE couvre
plusieurs colonnes et se répète : `--index "siteId,createdAt"`, `--unique "a,b"`.
Un `enum` rend la MÊME colonne sur les trois moteurs (pas de type SQL nommé, qui
exigerait une migration) : c'est le type TypeScript et le schéma Zod qui la
bornent — donc sur TOUS les transports, REST comme socket.

Si la table EXISTE DÉJÀ en base, trois options lui font épouser ses noms sans
rien renommer à la main : `--table <nom_sql>` (au lieu du pluriel),
`--column-case snake` (colonne `site_id`, propriété toujours `siteId`) et
`--id-name <colonne>` (clé primaire `website_id`, propriété toujours `id`). Le
code TypeScript ne change dans aucun des trois cas — seul le SQL suit.
`npx nodefony create entity --help` porte la grammaire de CETTE version — elle
s'enrichit, ta mémoire non.

## Vérités du framework (anti-préjugés — ce que tu crois savoir est faux ici)

- **Le cœur `nodefony` est ISOMORPHE** : le même paquet se charge côté Node
  ET navigateur. La porte client EXPLICITE est le subpath `nodefony/client`
  (`RealtimeClient`, notices, rôles — résolu à l'identique par Vite, Node et
  le typecheck)<% if (it.client) { %>, et le moteur front de CE projet a la sienne :
  `<%= it.client.subpath %>`<% } %>. Ne réécris
  JAMAIS un client WebSocket/JSON-RPC, ne duplique JAMAIS un type entre front
  et back : un seul contrat, vérifié par le compilateur des deux bouts.
<% if (it.client) { %>
<%~ it.client.snippet %>
<% } %>
- **Une commande ne tourne PAS dans le mode du serveur que tu as lancé — DEMANDE-le.**
  Chaque commande démarre son propre noyau. Sans `NODE_ENV` dans ton shell, elle
  part en `development` ; avec `NODE_ENV=production`, elle lit une AUTRE
  configuration et une AUTRE base de données — sans rien dire de plus. Ne le
  suppose jamais avant d'écrire ou de migrer quoi que ce soit :

  ```bash
  npx nodefony env              # le mode, et d'où vient chaque variable
  npx nodefony inspect config   # la configuration EFFECTIVE, et sa provenance
  ```

  Pour forcer : `NODE_ENV=production npx nodefony <commande>`. La règle complète
  (absent, posé, valeur non-moteur) est dans
  `node_modules/nodefony/docs/environnement.md`.

- **Une initialisation s'ACCROCHE à une phase du démarrage — il n'y a pas de
  `app.use()`.** Nodefony n'est pas un framework à middlewares chaînés : du code
  posé au chargement d'un fichier s'exécute AVANT que la configuration existe, et
  il n'y a rien à quoi « ajouter » un traitement global. Ce qui doit tourner au
  démarrage se déclare depuis un module ou un service :
  `this.module?.hookKernel("onBoot", async () => { … })` — l'étiquette porte alors
  le nom et la criticité du module, ce qu'un `kernel.once(…)` posé à la main
  perdrait. Les phases, dans l'ordre : `onRegister` (les modules se déclarent),
  `onBoot` (tout est chargé, les connexions s'ouvrent), `onReady` (juste AVANT que
  les serveurs se mettent à écouter), `onPostReady` (ils écoutent), `onTerminate`
  (fermeture). Une commande CLI se pose sur la
  même échelle : `npx nodefony create command <action> --phase onReady`.
  ⚠️ Si tu t'apprêtes à écrire `as any` sur le kernel pour atteindre une méthode,
  arrête-toi : c'est le signe que tu cherches une API d'un AUTRE framework. Les
  phases, le conteneur et les connecteurs sont typés — la référence est dans
  `node_modules/nodefony/docs/kernel.md`, et `npx nodefony inspect services`
  montre ce qui existe RÉELLEMENT dans cette application.

- **Un service n'est pas une classe utilitaire.** Une classe à méthodes `static`,
  ou un objet exporté, COMPILE et marche — et reste invisible au framework. Un
  service Nodefony est une classe `@injectable()` qui `extends Service` : c'est
  de là que lui viennent sa config fusionnée, son journal (`this.log`), les
  événements, et sa place dans le conteneur. Il porte DEUX noms sans que ce soit
  une redondance : le décorateur nomme la CLASSE (ce qu'on écrit dans
  `@inject("…")`), le `super("nom", …)` nomme l'INSTANCE (sa clé pour
  `container.get("…")`). Ne l'écris pas de mémoire :
  `npx nodefony create service <Nom>` en pose un complet, commenté, à imiter ;
  la référence est dans
  `node_modules/nodefony/docs/service.md`.
  **Un service qui en appelle un autre le déclare au CONSTRUCTEUR** :
  `npx nodefony create service <Nom> --inject <AutreService>` écrit le
  `@inject("AutreService")` et l'appel qui va avec. La dépendance est alors
  ordonnée par le conteneur et visible dans la signature — là où
  `container.get("…")` cherche à l'exécution et rend `undefined` en silence si
  le service n'est pas enregistré.

- **Le container DI est PROTOTYPAL** : les services vivent sur une chaîne de
  prototypes — un scope de requête VOIT tous les services du kernel sans
  aucune copie (coût d'un scope ≈ un `Object.create`), et ce qu'on `set()`
  dans un scope MEURT avec la requête. Ne fabrique donc ni cache de services
  par requête, ni singleton maison : `container.get("<nom>")` remonte la
  chaîne, c'est le mécanisme.

## Modules du projet

<% if (it.modules.length === 0) { %>Aucun — `npx nodefony create module <nom>` en pose un (workspace npm sous `modules/`).
<% } else { %><% it.modules.forEach(function (m) { %>- `<%= m.dir %>/` — `<%= m.name %>` (son `AGENTS.md` local prime quand tu travailles dedans)
<% }) %><% } %>
## Gates — vérifier avant de dire « fait »

```bash
npm run verify        # ⬅ LA commande. typecheck + lint + tests + doctor, dans cet ordre
```

**Une seule à retenir, et c'est délibéré.** Les gates ci-dessous existent séparément
pour qu'on puisse en relancer un ; tant qu'ils n'étaient QUE séparés, le premier oublié
était toujours le même — `typecheck`, que rien d'autre ne remplace : **le bundler ne
type-check pas**, ton code peut être bâti, servi, et ne pas compiler. `verify` s'arrête
au premier rouge, et ce rouge est ta tâche suivante.

```bash
npm run typecheck     # types — le seul gate que le build ne fait PAS à ta place
npm run lint          # style et pièges
npm test              # unitaires, rapides, zéro serveur
npm run doctor        # diagnostic : câblage, install, + BILAN du dernier démarrage
npm run test:e2e      # boot RÉEL + HTTP/WS (build inclus) — HORS `verify` : c'est le gate LENT
```

### `doctor` — le premier réflexe quand quelque chose ne va pas

**Avant de chercher, demande.** `npx nodefony doctor` (ou `npm run doctor`) LIT ton
app sans rien en exécuter — donc il répond même quand elle ne démarre plus — depuis
n'importe quel sous-dossier, et `--json` le rend exploitable par un script. `check`
en est un alias historique ; le nom à retenir est `doctor`.

Il imprime ses familles de contrôles, ce qu'il n'a **pas** contrôlé et le geste à taper
ensuite : lis sa sortie, ne la paraphrase pas. Il nomme la **classe que rien ne déclare**
(entité hors `@entities([…])`, controller hors `@controllers([…])`) — elle compile, ses
tests passent, et la panne n'arrive qu'au démarrage suivant — et relit le bilan du
**dernier démarrage** (`var/last-boot.json`), seule façon d'apprendre APRÈS COUP qu'une
app a démarré **amputée**. `--live` ajoute ce qui exige une app qui tourne, `--deep`
LANCE les gardes : sans eux, ces lignes sortent en « non demandé », pas en « bon ».

## Voir un écran toi-même — un navigateur, pas un `curl`

Un `curl` prouve qu'une route répond ; il ne dit pas si l'écran **se monte**. Le
devkit porte des sondes prêtes à l'emploi :

```bash
npm run see:setup
node node_modules/@nodefony/devkit/skills/nodefony-browser/scripts/inspect.mjs /
```

Tu obtiens un JSON : les **scripts réellement servis**, les erreurs de console, une
capture — et des **mesures** (contraste calculé, taille des éléments sondés) : la
différence entre « ça me paraît lisible » et « 7,39:1, donc AAA ».

🔴 **Le mode d'emploi est le skill `nodefony-browser`** — charge-le AVANT de conclure
quoi que ce soit d'un écran : il porte les autres sondes (temps réel, socket,
Lighthouse authentifié) et les pièges qui font conclure FAUX.

## Méthode de travail

1. **Budget tokens = une règle de conception** : lire ciblé via les tables
   ci-dessus ; ne jamais scanner le projet entier.
2. **Une règle = une source** : ce fichier POINTE la doc, il ne la recopie
   pas ; n'y recopie rien non plus.
3. **Batcher les modifs serveur** puis UN SEUL cycle build/restart ; le
   frontend passe en HMR, zéro restart.
4. **`npm run verify`, jamais `npm test` seul** — vitest n'inspecte AUCUN type,
   une app peut être verte et ne pas compiler ; suspecte ton propre diff.
5. **La mémoire de l'app est ci-dessous** : accumule les leçons DURABLES dans
   la zone Notes — pas dans des commentaires éparpillés.

## Demander à cette app — les verbes qui répondent SANS rien démarrer

```bash
npm run dev                          # développement (Ctrl+C pour arrêter)
npx nodefony status                  # que tourne-t-il ? ports, PID — ne boote rien
npx nodefony stop                    # arrêt PROPRE — jamais `… &`, qui meurt sur SIGHUP
npx nodefony production --detach --wait   # boot réel détaché, rend la main ports OUVERTS
npx nodefony card                    # qui répond, ce qui est chargé, où lire, quoi lancer
npx nodefony symbols <Nom>           # définition, TSDoc, parenté — en O(1)
npx nodefony inspect routes --json   # les routes MONTÉES (aussi : services, stores)
npx nodefony inspect config --json   # la config EFFECTIVE, et d'où vient chaque valeur
```

`card` et `symbols` répondent même sur une app pas construite, sans aucune variable
posée ; `inspect` boote sans ouvrir un port.

🔴 **Ce que rend `inspect` ENGLOBE tes sources et les dépasse** : les modules installés
montent leurs propres routes, une app qui en définit une poignée en expose plus d'une
centaine. Un **écart d'un ordre de grandeur** n'est donc PAS une anomalie — compter dans
les sources répond à une AUTRE question que celle posée.

🔴 **Si la commande résiste, répare l'APPEL — ne te rabats pas sur les sources** : les
fichiers répondront toujours quelque chose, mais pas à la question posée.

**Tes modules publient AUSSI leurs outils** — `npx nodefony ai:mcp` écrit `.mcp.json`, et
un module qui implémente `getMcpTools()` expose son métier, pas la plomberie (contrat,
scopes : `node_modules/@nodefony/devkit/docs/index.md`). C'est une ROUTE : démarre l'app
D'ABORD, ta session ENSUITE.

<% if (it.hasSecurity) { %>🔴 **La PROVENANCE d'une requête n'est pas une PREUVE D'INTENTION — une mutation exige
`@CsrfProtect`.** Le raisonnement qui vient, et qui est faux : « le firewall vérifie déjà
`Sec-Fetch-Site`, donc une écriture est protégée ». Ces en-têtes sont posés par un
NAVIGATEUR ; un programme qui parle en HTTP n'en envoie aucun, et la défense de provenance
le laisse alors passer — elle distingue les sites, pas les intentions. Mesuré : un
`POST /api/cart/items` sans jeton rend `201`, et l'app croit avoir une défense. Le jeton ne
se demande à AUCUN endpoint : un `GET` vers la route protégée sème le cookie `csrf-token`,
la mutation le rejoue dans `x-csrf-token` — sinon `403`. Une origine tierce refusée se
DÉCLARE (`csrf.trustedOrigins`) : `@CsrfExempt` ferait passer **n'importe quel** site.
🔴 **Et une URL DÉJÀ PUBLIÉE ne se déplace pas — c'est un contrat.** Quand on te demande
de protéger une adresse existante, la déménager sous la zone déjà réglée la fait répondre
`404` à celui-là même qu'on voulait servir : personne n'a prévenu le partenaire, et rien
dans l'app ne signale la rupture. **On adapte la ZONE à l'URL, jamais l'URL à la zone** —
étends son `pattern` : `^/api/(machine|partenaire)`.

Gestes complets (zones, rôles, voters, comptes) → skill `nodefony-protect-route`.

<% } %>🔴 **Les violations de contrainte sont DÉJÀ traduites en HTTP — ne les rattrape pas.**
Un doublon sur une colonne unique ressort en **409**, une donnée qui viole le schéma Zod
en **422** : le rendu d'erreur lit le code du pilote (`23505`, `ER_DUP_ENTRY`,
`SQLITE_CONSTRAINT_UNIQUE`, `11000`) et le mappe. N'écris JAMAIS un `throw … 409` pour un
identifiant déjà pris — le vérifier d'abord est plus lent ET **faux sous concurrence**.

Les CLÉS qu'un module accepte sont lisibles à la source :
`node_modules/@nodefony/<module>/dist/nodefony/config/config.js` porte son schéma Zod —
une clé inconnue est retirée EN SILENCE, ne l'invente pas.

**La référence de CHAQUE brique installée ici est dans `node_modules`** — que `rg`
lancé à la racine ne voit pas (git l'ignore, `rg` le suit) : le sujet paraît absent
alors qu'il occupe 70 pages. Trois issues, de la meilleure à la plus brute : l'outil
`nodefony_docs` (serveur démarré, il cherche dans TOUTE la doc chargée et rend des
extraits) ; **désigner le dossier** — `rg "terme" node_modules/@nodefony/*/docs/`,
l'exclusion ne valant que pour le PARCOURS ; ou `rg --no-ignore "terme"`.
⚠️ Si `node_modules/` n'existe pas, la doc n'est pas là : c'est `npm install` qui n'a
pas été lancé, pas « le sujet n'est pas documenté ». DIS-LE, et ne réécris jamais ce que
tu n'as pas pu lire.

- **Kernel, phases, CLI** — `node_modules/nodefony/docs/kernel.md` + `cli.md`
- **Service, injection, container** — `node_modules/nodefony/docs/service.md`
- **Client isomorphe (navigateur)** — `node_modules/nodefony/docs/client.md`
- **Serveurs, sessions, cookies, upload** — `node_modules/@nodefony/http/docs/`
- **Routing, controllers, décorateurs** — `node_modules/@nodefony/framework/docs/`
<% if (it.hasSecurity) { %>- **Firewall, CSRF, CORS, rôles, clés d'API** — `node_modules/@nodefony/security/docs/`
<% } %><% if (it.hasOrm) { %>- **Entités, repositories, migrations** — `node_modules/@nodefony/orm-core/docs/`
<% } %><% if (it.hasRealtime) { %>- **Canaux temps réel, actions, protocole WS** — `node_modules/@nodefony/realtime/docs/`
<% } %><% if (it.front) { %>- **Builder Vite, entries, HMR** — `node_modules/@nodefony/frontend/docs/`
<% } %>
## Les commandes de CETTE app — demande la liste, ne la devine pas

```bash
npx nodefony --help              # TOUTES les commandes, celles des modules installés comprises
npx nodefony <commande> --help   # les options exactes de l'une d'elles
```

La liste **dépend des modules installés** : elle s'allonge dès que tu en ajoutes un.
**Toujours `npx`, jamais `nodefony` nu** — le binaire vit dans les `node_modules` de
CETTE app ; une installation globale peut être plus ANCIENNE.

Celles qu'on n'invente pas, faute de savoir qu'elles existent :

- Derrière **nginx ou haproxy** — `npx nodefony proxy:generate <nginx|haproxy>`
- **Statiques vers un CDN** — `npx nodefony assets:publish [--clean]`
- **Certificat TLS de développement** — `npx nodefony http:certificates`
<% if (it.front) { %>- **Construire le front pour la production** — `npx nodefony frontend:build [-f]`
<% } %><% if (it.hasSecurity) { %>- **Clés de chiffrement du firewall** — `npx nodefony security:secrets [-w]`
- Créer un **administrateur** — `npx nodefony security:user:add <identifiant> --admin`
<% } %><% if (it.hasOrm) { %>- **Écrire les migrations** des entités modifiées — `npx nodefony orm:generate`
- **Appliquer les migrations** (verrou + historique) — `npx nodefony orm:migrate [-n]`
- **La base est-elle à jour ?** — `npx nodefony orm:migrate:status` — **0** = à jour,
  **1** = en retard : ta barrière de déploiement
- **Éprouver une migration SANS toucher à ta base** —
  `NF_MIGRATE_DATABASE_URL="sqlite:/tmp/essai.sqlite" npx nodefony orm:migrate` : elle
  migre AILLEURS. 🔴 C'est ainsi qu'on prouve qu'une migration s'applique — **jamais**
  en refaisant la base.
- `npx nodefony orm:reset` **DÉTRUIT les données** (refusé hors développement) : ce
  n'est ni la façon d'éprouver une migration — voir la ligne ci-dessus —, ni la
  réponse à une migration qui refuse. Avant tout geste sur un schéma déjà en base,
  charge le skill `nodefony-migrate-schema` : il porte les codes de refus et ce que
  chacun appelle.
<% } %>- **Dépendances en retard**, agrégées — `npx nodefony outdated`
- **Cohérence du projet** — `npx nodefony doctor [--json]`
- **Plusieurs processus** — `npx nodefony production -w <n|auto>` · `NF_WORKERS`
- **Construire l'image** — `docker build -t <%= it.appName %> .` — le `Dockerfile` est
  DÉJÀ là, ne le réécris pas
<% if (it.hasMigrateRecipe) { %>- **Migrer le schéma avant un déploiement** — `deploy/migrate-job.yaml` est DÉJÀ rendu
  au nom de cette app (travail Kubernetes, même image, secret DDL séparé) — son mode
  d'emploi est en tête du fichier
<% } %>- **Complétion au TAB** — `source <(nodefony completion zsh)`

Ce tableau ne remplace pas `--help` : lui seul connaît les modules de CETTE app, et il
fait foi le jour où les deux divergent.
<% if (!it.hasOrm || !it.hasSecurity || !it.hasRealtime || !it.front) { %>
## Ce que cette app n'a PAS — et le geste exact pour l'ajouter

Le framework porte ces briques ; CETTE application ne les a pas. N'en conclus pas
qu'elles n'existent pas, et n'en réécris aucune à la main.
<% if (!it.hasOrm) { %>
- **Base de données — cette app n'a PAS d'ORM.** Aucune entité, aucune migration :
  `create entity` n'aurait nulle part où écrire.
  `npm i @nodefony/orm-core @nodefony/drizzle drizzle-orm better-sqlite3`, puis
  ajoute `"@nodefony/drizzle"` aux `modules` de `nodefony.config.ts`. Sans
  `NF_DATABASE_URL`, c'est un **sqlite local** — aucun service à lancer.
<% } %><% if (!it.hasSecurity) { %>
- **Sécurité — cette app n'a PAS de firewall**, ni comptes, ni sessions : toute
  route est ouverte et `@IsGranted` n'a personne à qui refuser.
  `npm i @nodefony/security @nodefony/user @node-rs/argon2`, puis
  `npx nodefony security:secrets -w` et `npx nodefony security:user:add`.
  ⚠️ Elle ne s'ajoute pas seule : comptes et jetons se PERSISTENT — ces briques
  forment une grappe avec l'ORM, pose-les ensemble.
<% } %><% if (!it.hasRealtime) { %>
- **Temps réel — cette app n'a PAS de socket** : un client qui ouvre un WebSocket
  n'obtient rien. `npm i @nodefony/realtime`, puis
  `use("@nodefony/realtime", { backplane: { driver: "cluster" } })` — `cluster`
  reste intra-pod et n'ajoute aucune dépendance externe.
<% } %><% if (!it.front) { %>
- **Front — cette app n'a PAS d'interface à elle** : elle répond en JSON.
  `npx nodefony create front <nom>` pose le moteur ET câble `@nodefony/frontend`
  — ne compose pas ce câblage à la main.
<% } %>
Chaque brique ajoutée apporte AUSSI ses commandes, ses docs et parfois ses skills :
redemande `npx nodefony --help`, puis `npx nodefony ai:sync`.

<% } %>
## Le savoir-faire du framework vit dans les skills, pas dans ce fichier

Cette page ne porte que ce qui est propre à CETTE application. Tout le reste —
conduire une tâche, les pièges du serveur et du front, protéger une route, changer
un schéma, regarder un écran — vit dans les **skills** livrés par les paquets :
`ls .agents/skills/` les liste, et leur description dit quand chacun s'applique.

Ce sont des **pointeurs** vers `node_modules`, donc ils suivent la version du
framework de ce projet (`npx nodefony ai:sync` après un `npm update`). Rien n'est
copié ici : une page copiée se figerait au jour de sa création.

<!-- nodefony:end -->

## Notes de cette app

Cette section — et tout ce qui suit le marqueur ci-dessus — **t'appartient**.
Nodefony ne la réécrit jamais : il ne régénère que le bloc délimité plus haut.
Accumule ici les conventions de l'équipe, les décisions de domaine et les leçons
propres à ce projet.
