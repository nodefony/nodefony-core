# AGENTS.md — <%= it.appName %>

> **N'invente jamais du code Nodefony : génère-le, imite-le, vérifie-le.**
> Trois actes pour toute tâche : **LIRE** (ce fichier, puis la doc pointée) →
> **GÉNÉRER** (`npx nodefony create …` produit du vrai code, à imiter) →
> **VÉRIFIER** (`npm test` d'abord, puis `npm run typecheck`).
>
> **Le réflexe, avant d'écrire le MOINDRE fichier** : un générateur le
> produit-il ? Écrire à la main un CRUD, un controller, une entité ou un
> squelette de module, c'est le signal que tu as raté une commande de la
> table ci-dessous — arrête-toi et lance-la.
>
> **Tu SERS un fichier ?** Trois façades, jamais `createReadStream` à la main :
> `this.renderMediaStream(f)` pour un média qu'on parcourt (`Range` → 206),
> `this.streamFile(f)` pour le fichier entier, `this.renderFileDownload(f)` pour
> forcer le téléchargement. Le faire soi-même rend une réponse que le client ne
> peut pas lire — le détail, plus bas, est MESURÉ.

## Générateurs — appelle-les, ne recompose jamais leur sortie de mémoire

| Besoin | Commande |
| --- | --- |
| Module applicatif (workspace npm) | `npx nodefony create module <nom>` |
| Controller HTTP **et** WebSocket (même classe) | `npx nodefony create controller <nom> --kind hello\|rest\|realtime\|duplex\|example` |
| Ressource REST **complète** — entité + service + controller CRUD + tests (ne JAMAIS l'écrire à la main) | `npx nodefony create entity <Nom> --fields "sku:string! price:float"` |
| Service métier seul — la logique réutilisable, hors de tout controller | `npx nodefony create service <Nom> [--module <m>]` |
| Frontend Vite (React/Vue/Angular) | `npx nodefony create front <nom> [--module <m>]` |
| Commande CLI `nodefony <module>:<action>` | `npx nodefony create command <action> [--module <m>] [--phase onReady\|onRegister\|onPostReady]` |

**Ces dossiers ne s'écrivent JAMAIS à la main** — y déposer un fichier signifie
que tu as raté une commande de la table ci-dessus :

| Tu t'apprêtes à écrire dans… | Lance plutôt |
| --- | --- |
| `nodefony/entity/` | `npx nodefony create entity <Nom> --fields "…"` |
| `nodefony/controllers/` | `npx nodefony create controller <nom> --kind …` |
| `nodefony/service/` | `npx nodefony create service <Nom>` (ou `create entity`, qui en pose un) |
| `nodefony/command/` | `npx nodefony create command <action> [--module <m>]` |
| `modules/<nom>/` (module entier) | `npx nodefony create module <nom>` |

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

## Les commandes de l'app — demande la liste, ne la devine pas

```bash
npx nodefony --help              # TOUTES les commandes, celles des modules installés comprises
npx nodefony <commande> --help   # les options exactes de l'une d'elles
```

La liste **dépend des modules installés** : elle n'est pas la même d'une app à
l'autre, et elle s'allonge dès que tu en ajoutes un. C'est pour ça qu'elle se
demande au lieu de se retenir.

**Toujours `npx`, jamais `nodefony` nu.** Le binaire vit dans les `node_modules`
de CETTE app, pas dans ton PATH : la forme nue rend un code 127 tant que rien
n'est installé globalement. Une installation globale existe bien
(`npm i -g nodefony`) — elle sert à créer une app HORS projet — et, dans un
projet, elle passe la main au binaire local (le projet gagne, comme `gradlew`).
Mais elle peut être plus ANCIENNE que celle de l'app : `npx` prend directement la
version que cette application a choisie, sans dépendre de ce qui traîne sur la
machine.

Celles qu'on n'invente pas — faute de savoir qu'elles existent :

| Besoin | Commande |
| --- | --- |
| Mettre l'app derrière **nginx ou haproxy** | `npx nodefony proxy:generate <nginx\|haproxy> [-o <fichier>] [-b <hôte>] [-l <port>] [--reencrypt]` |
| Servir les fichiers statiques depuis un CDN | `npx nodefony assets:publish [-o <dossier>] [--clean] [--json]` |
| Certificat TLS de développement | `npx nodefony http:certificates [-f] [-j]` |
<% if (it.front) { %>| Construire le front pour la production | `npx nodefony frontend:build [-f]` |
| Où en est le serveur Vite | `npx nodefony frontend:status [-j]` |
<% } %><% if (it.hasSecurity) { %>| Clés de chiffrement du firewall | `npx nodefony security:secrets [-j] [-w]` |
| Créer un compte **administrateur** | `npx nodefony security:user:add <identifiant> --admin` |
<% } %>| Dépendances en retard (agrégées, pas le brut de npm) | `npx nodefony outdated [-j] [-a]` |
| Cohérence du projet (classe non câblée, route qui répondra 404) | `npx nodefony doctor [--json]` |
| Plusieurs processus, un cœur chacun | `npx nodefony production -w <n>` · `npx nodefony cluster -w <n>` |
| Complétion au TAB | `source <(nodefony completion zsh)` |

Ce tableau ne remplace pas `--help` : lui seul connaît les modules de CETTE app,
et il fait foi le jour où les deux divergent.

## Vérités du framework (anti-préjugés — ce que tu crois savoir est faux ici)

- **Un adaptateur de données ne remplace pas l'autre : ils se COMPLÈTENT.** Chacun
  déclare les _stores_ qu'il sait tenir (`nodefony.stores` de son `package.json`) —
  `drizzle` les huit (session, user, tokens, passkeys, totp, audit, webhooks,
  idempotency), `mongoose` cinq (ni `totp`, ni `audit`, ni `idempotency`), `redis`
  quatre. Ce n'est pas un retard de développement mais un CHOIX : un journal
  d'audit n'a rien à faire dans un moteur documentaire. Ne promets donc jamais une
  parité qui n'existe pas, et vérifie où atterrit chaque donnée :
  `npx nodefony inspect stores`. Le détail par brique :
  `node_modules/nodefony/docs/catalogue.md`.

- **Le cœur `nodefony` est ISOMORPHE** : le même paquet se charge côté Node
  ET navigateur. La porte client EXPLICITE est le subpath `nodefony/client`
  (`RealtimeClient`, notices, rôles — résolu à l'identique par Vite, Node et
  le typecheck) ; les hooks React vivent dans `nodefony/react`. Ne réécris
  JAMAIS un client WebSocket/JSON-RPC, ne duplique JAMAIS un type entre front
  et back : un seul contrat, vérifié par le compilateur des deux bouts.
- **Un service n'est pas une classe utilitaire.** Une classe à méthodes `static`,
  ou un objet exporté, COMPILE et marche — et reste invisible au framework. Un
  service Nodefony est une classe `@injectable()` qui `extends Service` : c'est
  de là que lui viennent sa config fusionnée, son journal (`this.log`), les
  événements, et sa place dans le conteneur. Il porte DEUX noms sans que ce soit
  une redondance : le décorateur nomme la CLASSE (ce qu'on écrit dans
  `@inject("…")`), le `super("nom", …)` nomme l'INSTANCE (sa clé pour
  `container.get("…")`). Ne l'écris pas de mémoire — `npx nodefony create service
  <Nom>` en pose un complet, commenté, à imiter ; la référence est dans
  `node_modules/nodefony/docs/service.md`.
- **Les violations de contrainte sont DÉJÀ traduites en HTTP — ne les rattrape pas.**
  Un doublon sur une colonne unique ressort en **409**, une donnée qui viole le
  schéma Zod en **422**, chacun avec son corps JSON : le rendu d'erreur lit le code
  du pilote (`23505` PostgreSQL, `ER_DUP_ENTRY` MySQL, `SQLITE_CONSTRAINT_UNIQUE`,
  `11000` MongoDB) et le mappe, quel que soit le moteur. N'écris donc JAMAIS un
  `throw … 409` dans un service pour un `sku` déjà pris. Le vérifier toi-même
  d'abord (« existe-t-il ? » puis insertion) est plus lent ET **faux sous
  concurrence** : deux requêtes simultanées passent toutes les deux le test avant
  que l'une n'écrive. La contrainte de la base est le seul arbitre exact — laisse-la
  lever, le pipeline traduit.
- **Un fichier ne se sert pas à la main.** Trois façades, et le choix se fait sur
  l'usage : `this.renderMediaStream(file)` implémente les **requêtes par plage**
  (`Range` → 206 + `Content-Range`, 416 hors plage) — c'est ce qu'exige un lecteur
  vidéo ou audio pour se déplacer ; `this.streamFile(file)` envoie le fichier
  ENTIER en flux, sans plage ; `this.renderFileDownload(file)` force le
  téléchargement. Recomposer ça avec `createReadStream` et `response.write`
  compile, passe les tests — et rend une réponse **incohérente** : un statut posé
  à la main n'atteint jamais la socket (le pipeline écrit statut et en-têtes à
  SON tour), donc le client reçoit **200 avec un corps partiel** et croit tenir le
  fichier complet. Mesuré au banc, pas supposé.
- **Le container DI est PROTOTYPAL** : les services vivent sur une chaîne de
  prototypes — un scope de requête VOIT tous les services du kernel sans
  aucune copie (coût d'un scope ≈ un `Object.create`), et ce qu'on `set()`
  dans un scope MEURT avec la requête. Ne fabrique donc ni cache de services
  par requête, ni singleton maison : `container.get("<nom>")` remonte la
  chaîne, c'est le mécanisme.
- **Le WS métier passe par la socket Nodefony** (`--kind realtime` : canaux
  pub/sub + actions RPC + policies). L'echo WS brut des exemples est une démo
  du pipeline partagé, pas un modèle à imiter.
<% if (it.hasSecurity) { %>- **Utilisateurs et droits : tout existe, n'improvise RIEN.** Quatre gestes
  couvrent l'essentiel, et chacun a sa doc installée (cf. table ci-dessous) :
  - **protéger une action** : le décorateur `@IsGranted("ROLE_ADMIN")` sur la
    méthode — il vaut pour TOUS les transports (HTTP et socket), et se pose
    **en plus** de la zone de firewall (le firewall AUTHENTIFIE, `@IsGranted`
    AUTORISE) ;
  - **lire l'utilisateur courant** : le paramètre décoré `@CurrentUser()`
    (typé `IUser` de `@nodefony/user`) — l'identité est ré-résolue à chaque
    requête, donc les rôles sont frais et une révocation prend effet tout de
    suite. N'écris pas ton propre lecteur de session ;
  - **déclarer qu'un rôle en implique un autre** : la clé `roleHierarchy` de
    la config du module de sécurité (`ROLE_ADMIN` hérite `ROLE_USER`). Elle
    est aplatie au boot ; n'écris pas de test d'appartenance à la main ;
  - **créer un compte** : la commande `npx nodefony security:user:add <identifiant>`.
    Ne fabrique pas d'utilisateur en insérant directement dans la base — le mot
    de passe passe par l'encodeur du framework.
  - Un droit **métier** qui ne se réduit pas à un rôle (« l'auteur peut éditer
    SON document ») s'écrit en **voter** et s'enregistre par
    `registerVoterFactory` ; `@IsGranted("doc.edit", { subject: "id" })` l'appelle.
    C'est le point d'extension prévu — il n'y a pas de table de permissions à
    inventer.<% } %>

## Où lire AVANT de coder (tâche → doc installée)

La référence est INSTALLÉE avec les paquets — lis CIBLÉ, jamais tout le dossier.

| Tâche | Doc |
| --- | --- |
| **Quel module installer pour tel besoin** (et lequel NE PAS installer) | `node_modules/nodefony/docs/catalogue.md` |
| **Variables d'environnement** : cascade des `.env`, précédence, `NF__` | `node_modules/nodefony/docs/environnement.md` |
| Kernel, cycle de vie, CLI | `node_modules/nodefony/docs/kernel.md` + `cli.md` |
| Service, DI, container, scopes | `node_modules/nodefony/docs/service.md` |
| Client isomorphe (navigateur), hooks React | `node_modules/nodefony/docs/client.md` + `react-hooks.md` |
| Serveurs, sessions, cookies, upload, rate-limit | `node_modules/@nodefony/http/docs/` |
| Routing, controllers, décorateurs, idempotence | `node_modules/@nodefony/framework/docs/` |
<% if (it.hasSecurity) { %>| Firewall, authenticators, CSRF, CORS, clés d'API | `node_modules/@nodefony/security/docs/firewall.md` |
| **Protéger une action par un RÔLE** (`@IsGranted`), voters, hiérarchie | `node_modules/@nodefony/security/docs/authorization.md` |
| **Utilisateurs** : contrat `IUser`, `UserService`, mot de passe | `node_modules/@nodefony/user/docs/index.md` |
<% } %><% if (it.hasOrm) { %>| Entités, repositories, requêtes (ORM) | `node_modules/@nodefony/orm-core/docs/` |
<% } %><% if (it.hasRealtime) { %>| Canaux temps réel, actions, protocole WS | `node_modules/@nodefony/realtime/docs/` |
<% } %><% if (it.front) { %>| Builder Vite, entries, HMR | `node_modules/@nodefony/frontend/docs/` |
<% } %><% if (it.hasStudio) { %>| Console d'admin Studio (dev) | `node_modules/@nodefony/studio/docs/` + http://127.0.0.1:5151/nodefony |
<% } %>
La config de l'app vit dans `nodefony.config.ts` (modules chargés) et `env.ts`
(variables d'environnement, seul lecteur de `process.env`) — pointe-les, ne les
recopie pas.

## Environnement : ne devine JAMAIS, demande

```bash
npx nodefony env          # cascade des .env, valeur EFFECTIVE de chaque variable, sa PROVENANCE
npx nodefony env --json   # même rapport, pour un script
```

**Encadre toute modification de configuration par cette commande** : une fois
AVANT, pour savoir ce qui s'applique aujourd'hui et d'où ça vient ; une fois
APRÈS, pour prouver que ta valeur est bien celle qui gagne. Ce n'est pas un
outil de dépannage qu'on sort quand ça casse — c'est le geste qui remplace la
déduction.

Elle répond aux quatre questions dont dépend toute configuration, et qu'aucune
lecture de fichier ne tranche : quels fichiers sont lus **et dans quel ordre**,
quelles variables l'app **déclare**, quelle valeur est **effective et d'où elle
vient**, et **ce qui est ignoré**. Lire les `.env` toi-même te donne des
contenus ; la précédence, elle, est un mécanisme — tu ne peux que la supposer,
et une supposition fausse ne se voit qu'en production. La commande ne boote
rien, donc elle répond aussi quand l'app ne démarre plus.

**Précédence, du plus FORT au plus faible** — le premier qui pose une valeur
gagne, les suivants sont ignorés en silence :

```
process.env  >  .env.<déploiement>.local  >  .env.<mode>.local  >  .env.local
             >  .env.<déploiement>        >  .env.<mode>        >  .env
```

`<mode>` = `NODE_ENV` (`development`/`production`). `<déploiement>` = `APP_ENV`
(`staging`, `canary`… — plus spécifique, donc plus fort). Les `*.local` ne sont
jamais committés : les secrets y vont, et nulle part ailleurs.

**Deux mécanismes à ne pas confondre** :

| Forme | Ce que c'est | Où c'est déclaré |
| --- | --- | --- |
| `NF_PORT=5151` | variable de l'APP, typée et validée | `env.ts` (`defineEnv`) — non déclarée = **sans effet** |
| `NF__HTTP__SERVERS__HTTPS__PORT=8443` | surcharge DIRECTE d'une clé de config d'un module | rien à déclarer — double `__` = séparateur |
| `NF_TOTP_KEY_FILE=/run/secrets/x` | la même variable, lue depuis un fichier (secret Docker/K8s) | idem `NF_TOTP_KEY` |

Une variable `NF_` mal orthographiée n'échoue pas : elle est **ignorée**, et le
défaut s'applique en silence. `npx nodefony env` est le seul endroit qui la montre
(avec la correction probable).

**Les clés de configuration d'un module, avec leurs défauts, sont LISIBLES :**
`node_modules/@nodefony/<module>/dist/nodefony/config/config.js` porte le schéma
Zod du module — chaque clé, son `.default(…)` et sa `.describe(…)`. C'est la
source, pas une copie : la lire évite d'inventer une option qui n'existe pas
(une clé inconnue est retirée en silence à la validation). Ne recopie jamais ces
valeurs dans la doc du projet ; elles bougeront sans toi.

Pour ce que le PROJET offre comme choix (connecteurs déclarés, entités déjà
créées, types de colonnes de ton moteur) :
`npx nodefony create entity --describe-json` — c'est la même source que le
formulaire de Studio, à jour par construction.

## Pièges qui coûtent cher — vécus, pas théoriques

Chacun a déjà fait perdre une heure et beaucoup d'allers-retours. Le symptôme ne
désigne jamais la cause : c'est ce qui les rend chers.

| Symptôme | Cause réelle | Le geste |
| --- | --- | --- |
| **Un test rouge en suite, VERT rejoué seul** | une ressource PARTAGÉE entre fichiers (serveur, table, état global) — pas une régression de ton diff | rejoue-le seul : l'isolation dit la vérité ; puis donne à chaque fichier sa propre ressource |
| **Le serveur lancé en arrière-plan a disparu** | `… &` reçoit SIGHUP et meurt ; et tuer le PID du port ne tue pas le superviseur, qui respawne | `npx nodefony production --detach --wait` pour démarrer, `npx nodefony stop` pour arrêter — jamais `&`, jamais un kill par le port |
| **Des dizaines de tests d'intégration rouges d'un coup** | ils FRAPPENT un serveur, ils ne le lancent pas : il est éteint (`ECONNREFUSED`) | `npx nodefony status` d'abord ; en e2e, laisse la commande gérer le cycle |
| **La route existe dans le code et répond 404** | le runtime charge `dist/`, pas tes sources | `npm run build` — et en cas de doute vérifie le `dist/` par son CONTENU (`grep` du symbole), jamais par sa date |
| **TOUT répond 404, même les routes du gabarit** | un AUTRE serveur tient les ports — ou LE TIEN a glissé sur d'autres ports, le port voulu étant pris | `npx nodefony status` : il montre les ports RÉELS, pas ceux que tu as configurés |
| **Ça marche en dev, c'est mort en production** | les modules `policy: dev` sont RETIRÉS en production — ce qu'ils portaient disparaît avec eux | avant de livrer, UN boot `npx nodefony production --detach --wait` et rejoue tes vérifications |
| **Un réglage de `nodefony.config.ts` ne change rien** | clé inconnue ou mal placée : retirée EN SILENCE à la validation | `npx nodefony inspect config --json` — la config effective et la provenance de chaque valeur |
| **Une variable d'environnement « ne prend pas »** | mal orthographiée (ignorée en silence) ou masquée par un rang supérieur | `npx nodefony env` — il montre la valeur EFFECTIVE et sa provenance |
| **Après un échec au milieu d'une chaîne `&&`, tout ment** | rien d'aval n'a tourné : tu mesures l'état d'AVANT | après tout échec, considère que la suite n'a pas eu lieu — revérifie que l'artefact mesuré a été régénéré |
| **Les tests passent, `npm run typecheck` échoue** | le runner efface les types : un test vert ne typecheck rien | lance les DEUX avant de conclure |
| **Suite verte, et le câblage est mort** | un test qui ne quitte pas la brique ne prouve que la brique | débranche le point de câblage : si rien ne tombe, il n'est pas testé |
| **Un test vert « prouve » une garantie de sécurité** | elle est vraie dans la fonction, fausse sur le trajet réel | frappe la route en anonyme et regarde si le code a tourné |
| **Un test qui n'a jamais échoué** | il ne garde rien — un test neuf est complaisant par défaut | casse-le exprès une fois, vérifie qu'il rougit |
| **« Tout est vert » alors qu'une suite ne s'est pas exécutée** | un test sauté compte comme réussi — et un fichier jamais COLLECTÉ (erreur de syntaxe, hors du glob) ne compte pas du tout | lis le NOMBRE de tests, pas la couleur |
| **`localhost` et `127.0.0.1` te jouent des tours** | ce sont deux ORIGINES distinctes : cookies, cache et passkeys ne les partagent pas | une seule origine en développement, partout — URL ouverte comme callbacks |
<% if (it.hasOrm) { %>| **La modif d'une entité « ne prend pas »** (erreur SQL au runtime) | le schéma de développement fait `CREATE TABLE IF NOT EXISTS` — une table existante n'est JAMAIS altérée | en dev, supprime la table (ou le fichier de base sous `var/`) et relance ; en production, une migration |
<% } %><% if (it.hasSecurity) { %>| **Les routes authentifiées plafonnent** quand le reste tient la charge | le stockage de session par défaut est SYNCHRONE : chaque reprise bloque la boucle d'événements | compare une route anonyme et une route authentifiée AVANT d'accuser TLS ou le pare-feu ; passe le stockage sur redis pour la charge |
<% } %><% if (it.front) { %>| **En production, la modif front n'apparaît jamais** | hors développement il n'y a PAS de rechargement à chaud, et le manifeste est lu AU BOOT | `npm run build` → **redémarre le serveur** → rechargement forcé |
| **Ta modif front n'apparaît pas (en dev)** | le navigateur sert son cache — et le rechargement à chaud ne remplace ni un singleton ni un composant qui gagne des hooks : le code neuf tourne sur du vieil état | rechargement forcé, et vérifie que Vite a bien recompilé |
| **Une route d'API répond du HTML** | un repli SPA générique avale les routes voisines — le premier motif qui correspond gagne | repli en préfixe LITTÉRAL ; `npx nodefony inspect routes --json` montre l'ordre réel |
| **Des utilisateurs « déconnectés au hasard »** | le traitement global « 401 = session expirée » frappe aussi les sondes d'authentification, où 401 est NORMAL — et détruit une session valide | exempte les sondes du traitement global |
<% } %>
**Ce qui coûte le plus de tokens** : enchaîner arrêt → construction → démarrage
après chaque petite modification. Regroupe TOUTES tes modifications serveur, puis
UN seul cycle. Le serveur de développement reconstruit tout seul<% if (it.front) { %>, et le front
passe en rechargement à chaud — zéro redémarrage<% } %>. Et ne lance **jamais** une
construction pendant qu'une suite de tests interroge le serveur : il redémarre au
milieu, et tu passes l'heure suivante sur des 404 fantômes.

## Modules du projet

<% if (it.modules.length === 0) { %>Aucun — `npx nodefony create module <nom>` en pose un (workspace npm sous `modules/`).
<% } else { %><% it.modules.forEach(function (m) { %>- `<%= m.dir %>/` — `<%= m.name %>` (son `AGENTS.md` local prime quand tu travailles dedans)
<% }) %><% } %>
## Gates — vérifier avant de dire « fait »

```bash
npm test              # 1ᵉʳ diagnostic — unitaires, rapides, zéro serveur
npm run typecheck     # le bundler ne type-check PAS : gate séparé, obligatoire
npm run test:e2e      # boot RÉEL de l'app + HTTP/WS (build inclus)
npm run check         # cohérence du projet (config, modules, wiring)
```

## Piloter le serveur — et l'ARRÊTER

```bash
npm run dev                          # développement : rechargement auto, Ctrl+C pour arrêter
npx nodefony development --no-watch      # développement SANS rechargement : un seul process, stable
npx nodefony status                      # que tourne-t-il ? ports, PID — ne boote rien
npx nodefony stop                        # arrêt PROPRE de tout runtime de cette app
npx nodefony production --detach --wait  # boot réel en arrière-plan ; rend la main ports OUVERTS
```

**Arrête ce que tu démarres.** Un serveur laissé derrière garde les ports : le run
suivant échoue sur une erreur qui ne parle jamais de lui (`EADDRINUSE`, ou pire, un
test qui interroge l'ANCIENNE version du code). `npx nodefony stop` est la sortie
propre, `npx nodefony status` dit ce qui reste.

**Pour faire tourner une suite contre un serveur, prends `--no-watch`.** Le mode
développement surveille les sources et relance le serveur dès qu'un fichier bouge —
ce qui est exactement ce qu'on veut en codant, et exactement ce qu'on ne veut pas
pendant un run : le redémarrage coupe les connexions sous les tests, et le rouge qui
en sort accuse le code alors que le fautif est le décor. `--no-watch` garde tout le
mode développement (mêmes modules, mêmes erreurs détaillées) et retire le seul
rechargement automatique.

⚠️ **Une suite lancée contre un serveur de PRODUCTION reçoit `404` sur tout.** Les
modules déclarés `policy: "dev"` n'y sont pas chargés — les routes que la suite
interroge n'existent tout simplement pas. C'est le rôle de cette politique, pas un
défaut à contourner. Si c'est bien le mode production que tu veux éprouver :

```bash
NF_WITH_DEV_MODULES=1 nodefony production --detach --wait   # dérogation explicite
NF_WITH_DEV_MODULES_TTL_MIN=120 …                            # campagne longue (charge)
```

Ce runtime **s'arrête tout seul** (30 min par défaut, réglable jusqu'à 4 h, jamais
désarmable), après un préavis. Ce n'est pas une gêne : c'est ce qui empêche une
variable oubliée dans une image ou un manifeste de laisser des routes de banc
ouvertes en production pendant des mois. Règle le délai AVANT une mesure longue — un
serveur qui tombe au milieu ne rend pas une mesure fausse, il en rend une qu'on
croira vraie.

## Demander à l'app, plutôt que déduire du code

```bash
npx nodefony inspect routes --json     # toutes les routes réelles (chemin, méthodes, controller)
npx nodefony inspect services --json   # services enregistrés, et le module qui les porte
npx nodefony inspect config --json     # config EFFECTIVE de chaque module (+ d'où vient chaque valeur)
npx nodefony inspect modules --json    # modules CHARGÉS — pas ceux que le manifeste déclare
npx nodefony inspect module http       # un module en détail
npx nodefony inspect entities --json   # entités déclarées à l'ORM
npx nodefony inspect stores --json     # où sont RÉELLEMENT écrites les données (sessions, cache…)
npx nodefony inspect graph --json      # graphe des entités et de leurs relations
```

Ces commandes bootent l'app **sans ouvrir un seul port** et rendent exactement ce
que sert la console d'administration — même code, deux portes. Préfère-les à la
lecture des sources : une route dépend de décorateurs, d'un manifeste et d'un
ordre de chargement ; la déduire, c'est se tromper un jour sur deux. `--json` est
un flux pur, `| jq` fonctionne.

**Ce que rend `inspect` ENGLOBE tes sources, et les dépasse de loin.** Les modules
installés — ceux du framework compris — montent leurs propres routes, services et
entités : une app qui ne définit qu'une poignée de routes en expose couramment plus
d'une centaine. Un écart d'un ordre de grandeur entre ce que tu lis dans tes
fichiers et `npx nodefony inspect routes --json | jq 'length'` n'est donc PAS une
anomalie de l'outil : c'est la différence entre ce que TU as écrit et ce que l'app
MONTE. Dès que la question porte sur l'app, le chiffre juste est celui d'`inspect` —
compter dans les sources répond à une autre question que celle posée.

**Si la commande te résiste, répare l'APPEL — ne te rabats pas sur les sources.**
C'est le réflexe qui coûte le plus cher, parce qu'il produit une réponse d'allure
normale : un shell qui manque un outil (`timeout` n'existe pas sur macOS), un `jq`
mal formé, et l'on se replie sur ce qu'on sait lire. Les fichiers répondront
toujours quelque chose — mais pas à la question posée. Relance sans le tube pour
voir la sortie brute, puis remets ton filtre.

N'invente pas d'attente : `--wait` ne rend la main qu'une fois les ports en écoute
— un `sleep` arbitraire est soit trop court (test rouge sans raison), soit du temps
perdu à chaque exécution. `npm run test:e2e` gère déjà ce cycle tout seul.

## Méthode de travail

1. **Budget tokens = une règle de conception** : lire ciblé via les tables
   ci-dessus ; ne jamais scanner le projet entier.
2. **Le poids du modèle est un CHOIX, et il est mesuré ici** (si ton outil sait
   déléguer à des sous-agents). Une tâche couverte par un **générateur** ne
   demande pas un gros modèle : c'est le générateur qui porte le savoir, pas le
   modèle. Mesuré sur ce framework, « ajoute une ressource REST » rend le MÊME
   résultat en modèle léger et en modèle fort — mêmes contrôles verts, écart
   d'étapes dans le bruit — pour **~3× moins cher**. À l'inverse, le socle SANS
   générateur (flux, session, cycle de vie) fait échouer le modèle léger environ
   une fois sur deux. Donc : **léger** pour appeler un générateur, inventorier,
   lire, vérifier un fait, appliquer un patron ; **fort** pour écrire du socle
   sans générateur et pour arbitrer une architecture. Le test qui tranche en une
   seconde : _la tâche a-t-elle une bonne réponse vérifiable ?_ Aucun nom de
   modèle ici — ils changent tous les trimestres ; raisonne en poids.
3. **Une règle = une source** : ce fichier POINTE la doc, il ne la recopie
   pas ; n'y recopie rien non plus.
4. **Batcher les modifs serveur** puis UN SEUL cycle build/restart ; le
   frontend passe en HMR, zéro restart.
5. **Vérifier avant de dire « fait »** : `npm test` + `npm run typecheck` ; un
   vert ne couvre que le diff qui l'a produit ; suspecte ton propre diff.
6. **La mémoire de l'app est ci-dessous** : accumule les leçons DURABLES dans
   la zone Notes — pas dans des commentaires éparpillés.

## Notes de cette app (zone préservée à la régénération)

Fichier 100 % généré (nodefony <%= it.nodefonyVersion %>) — régénéré par les
commandes `create`, il ne peut pas mentir. Tes leçons propres à CETTE app vont
dans la zone ci-dessous : elle survit à la régénération.

<!-- app-notes:start -->

_(vide — leçons, gotchas et conventions propres à cette app, au fil des sessions)_

<!-- app-notes:end -->
