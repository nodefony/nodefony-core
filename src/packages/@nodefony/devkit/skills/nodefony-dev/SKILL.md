---
name: nodefony-dev
description: >
  Conduit une tâche de développement de bout en bout dans une application Nodefony — comprendre
  le code en place, choisir la bonne façade, générer plutôt qu'écrire à la main, retrouver la
  référence installée qu'une recherche ordinaire ne voit pas, puis prouver que c'est fait — et se
  charge AVANT la première modification, quelle que soit la tâche.
  Les gestes spécialisés ont leur propre skill (ressource REST, service, canal temps réel, garde
  de route, migration de schéma, écran vu au navigateur) ; celui-ci porte la conduite commune,
  les pièges du serveur et du front, et dit lequel prendre.
  Déclencheurs : "je veux ajouter une fonctionnalité", "comment on code dans ce framework",
  "par où je commence", "où est la doc de ça", "comment ça marche ici", "avant de coder",
  "est-ce que j'écris ça à la main", "comment vérifier que c'est bon", "mon changement
  est-il fini", "je ne trouve rien sur ce sujet", "ce n'est pas documenté", "je touche au
  frontend", "mon composant charge des données", "mon écran n'affiche rien".
metadata:
  version: 1.2.0
---

# nodefony-dev — développer dans cette application sans rien inventer

> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; l'historique vit dans
> `git log`. Ce fichier n'a **pas** de `references/` — et c'est une décision mesurée, pas un
> oubli : sur 1020 transcripts d'agents lâchés dans une application générée, une page de
> `references/` a été ouverte **0 fois**, quand un script cité comme commande l'a été dans 80 %
> des cas. Ce qui doit atteindre un agent s'EXÉCUTE ou vit dans ce corps ; ce qu'on déporterait
> « pour alléger » n'atteindrait plus personne.

## Passer la main — TON PREMIER GESTE

🔴 **Ta tâche est dans cette table ? CHARGE ce skill MAINTENANT, avant d'écrire une ligne, avant
même d'ouvrir un fichier.** Ce n'est pas un conseil de lecture : c'est le premier geste de la
tâche. Reviens ici ensuite si tu en as encore besoin.

**Ce que coûte de ne pas le faire, mesuré au banc, six exécutions :** chaque agent qui a chargé le
skill de sa tâche a réussi ; **chacun de ceux qui ne l'ont pas chargé a échoué** — l'un en
cherchant la base de l'application au mauvais endroit puis en l'effaçant, l'autre en écrivant une
migration qu'il n'a jamais appliquée. Aucun ne manquait d'information : la table était sous leurs
yeux. Ils ont simplement continué sans elle.

Ces skills sont installés avec le framework et se chargent par leur nom. Chacun porte les pièges
de son geste, et ceux-là ne se devinent pas — ils se paient.

| Ce que tu t'apprêtes à faire                                         | Le skill                        |
| -------------------------------------------------------------------- | ------------------------------- |
| Une ressource : table, validation, service, REST et WebSocket        | `nodefony-add-crud`             |
| Une logique métier réutilisable, hors de tout controller             | `nodefony-add-service`          |
| Un flux temps réel, un canal, un abonnement client                   | `nodefony-add-realtime-channel` |
| Réserver une route, un rôle, une zone, ouvrir à un partenaire        | `nodefony-protect-route`        |
| Changer une entité déjà en base, ou déployer un schéma changé        | `nodefony-migrate-schema`       |
| Conclure quoi que ce soit d'un ÉCRAN — affichage, contraste, console | `nodefony-browser`              |

Aucune ligne ne correspond ? Alors seulement, continue ici. Et si ta tâche est EXACTEMENT celle
d'un spécialiste, va droit à lui : il n'y a pas à passer par cette page d'abord.

`ls .agents/skills/` liste ceux que TON projet a reçus ; `npx nodefony ai:sync` les remet à jour
après une montée de version. Ce sont des **pointeurs** : le contenu vit dans `node_modules` et
suit la version installée — les éditer ne servirait à rien.

## 1. La règle qui gouverne tout

**N'invente jamais du code Nodefony : génère-le, imite-le, vérifie-le.**

Ton `AGENTS.md` porte les trois actes et les tables qui vont avec — les générateurs, les
vérités du framework, les gates. **Ce skill ne les recopie pas** : une règle écrite à deux
endroits diverge au premier changement, et c'est alors la copie qu'on lit. Il porte ce qui n'y
tient pas : la **conduite** d'une tâche, les pièges qui coûtent une heure, et l'outil qui répond
à « où est-ce documenté ? ».

Le réflexe, avant d'écrire le moindre fichier : **un générateur le produit-il ?**
`npx nodefony create --help` liste ceux de TA version — la liste s'allonge, ta mémoire non.

## 2. Trouver la référence — ce que `rg` ne peut pas voir

C'est le trou le plus coûteux de ce framework, et il ne ressemble pas à un trou : **la
documentation est installée, complète, et invisible**. `rg "session"` lancé à la racine ne
descend pas dans `node_modules` (git l'ignore, `rg` le suit). Le sujet paraît absent alors qu'il
occupe quinze pages — mesuré sur une application générée : **70 pages, plus de 38 000 lignes**.

Conclure « ce n'est pas documenté » et réécrire à la main est l'erreur que ce script existe pour
empêcher :

```bash
D=node_modules/@nodefony/devkit/skills/nodefony-dev/scripts/docs.mjs

node $D session cookie          # les pages qui répondent — chemin, LIGNE, extrait
node $D --list                  # tout ce qui est installé, par module
node $D --open firewall         # le chemin d'une page, pour l'ouvrir
node $D upload --json           # pour rechaîner
```

Il ne stocke aucune documentation : il lit celle de TES paquets à l'exécution, et rend le chemin
**et la ligne**. Tu ouvres à l'endroit exact au lieu de relire une page entière. Classement par
titre, sujet, étiquettes puis corps — une ligne qui porte TOUS tes termes passe devant deux
lignes qui en portent un chacune ; les accents sont ignorés.

**Ses codes de sortie disent quoi faire**, et l'un d'eux compte plus que les autres :

| Code | Ce qu'il veut dire      | Le geste                                                      |
| ---: | ----------------------- | ------------------------------------------------------------- |
|    0 | trouvé                  | ouvrir le fichier à la ligne rendue                           |
|    1 | rien sur ces termes     | un seul mot, ou `--list` pour voir les sujets couverts        |
|   78 | **rien n'est installé** | `npm install` — ce n'est PAS « le sujet n'est pas documenté » |
|   64 | drapeau inconnu         | `--help`                                                      |

> 🔴 **`78` n'est pas une panne, c'est une information.** Un projet dont les dépendances ne sont
> pas installées n'a aucune documentation à lire. Le DIRE ; ne jamais réécrire de mémoire ce
> qu'on n'a pas pu lire.

Deux autres voies existent quand l'application **tourne** : l'outil MCP `nodefony_docs` (cherche
dans la doc chargée) et `nodefony_symbols` (rend la SIGNATURE réelle d'un symbole, que ce script
ne porte pas). Elles supposent un serveur démarré et la porte câblée (`npx nodefony ai:mcp`) ;
`docs.mjs`, lui, répond toujours.

## 3. Interroger l'application — elle répond mieux que ses sources

**Perdu ? La carte de visite dit qui répond, ce qui est chargé, où lire et quoi lancer :**

```bash
npx nodefony card                      # -j pour du JSON
```

Elle répond **toujours** — application pas encore construite, terminal sans aucune variable
d'environnement : elle ne lit que des fichiers. Elle le DIT alors (« modules installés », pas
« chargés ») et renvoie à `inspect modules` pour ce qui est vraiment monté.

```bash
npx nodefony inspect routes --json     # routes réelles (chemin MONTÉ, méthodes, controller)
npx nodefony inspect services --json   # services enregistrés, et le module qui les porte
npx nodefony inspect config --json     # config EFFECTIVE, et d'où vient chaque valeur
npx nodefony inspect schema http       # ce qu'on a le DROIT d'écrire : clés, type, défaut, description
npx nodefony inspect modules --json    # modules CHARGÉS — pas ceux que le manifeste déclare
npx nodefony inspect entities --json   # entités déclarées à l'ORM
npx nodefony inspect stores --json     # où sont RÉELLEMENT écrites les données (sessions, cache…)
npx nodefony inspect graph --json      # graphe des entités et de leurs relations
```

Ces commandes bootent l'application **sans ouvrir un seul port** et rendent exactement ce que sert
la console d'administration — même code, deux portes.

> **Ce que rend `inspect` ENGLOBE tes sources et les dépasse.** Les modules installés montent leurs
> propres routes : une application qui en définit une poignée en expose couramment plus d'une
> centaine. Un écart d'un ordre de grandeur entre tes fichiers et `inspect routes --json | jq
'length'` n'est PAS une anomalie de l'outil — c'est la différence entre ce que TU as écrit et ce
> que l'application MONTE.

**« Que fait cette classe, où est-elle définie, qu'étend-elle ? » — une commande, pas une fouille :**

```bash
npx nodefony symbols AbstractCrudService      # définition, TSDoc, parenté — en O(1)
npx nodefony symbols --module @nodefony/http  # toute la surface exportée d'un paquet
```

Le graphe symbolique de tout le framework est livré avec le paquet `nodefony` : la réponse ne
dépend ni d'un serveur, ni d'un build, ni de ta connexion. Va y chercher un symbole AVANT d'ouvrir
un `.d.ts` — et avant, surtout, d'inventer une signature.

**Si la commande te résiste, répare l'APPEL — ne te rabats pas sur les sources.** C'est le réflexe
le plus cher, parce qu'il produit une réponse d'allure normale : un shell qui manque un outil
(`timeout` n'existe pas sur macOS), un `jq` mal formé, et l'on se replie sur ce qu'on sait lire.
Les fichiers répondront toujours quelque chose — mais pas à la question posée. Relance sans le
tube, puis remets ton filtre.

**Tu préfères des OUTILS à des commandes ?** Cette application les expose en Model Context Protocol
(`npx nodefony ai:mcp` écrit `.mcp.json`) — mêmes réponses, et tes propres modules peuvent publier
les leurs. La porte est une ROUTE : elle n'existe que serveur démarré, et un client qui la trouve
éteinte la marque en échec pour toute sa session — démarre l'application D'ABORD, ta session
ENSUITE. Tout le reste (déclarer un outil métier, le réserver à des scopes, l'autorisation OAuth) :
`node_modules/@nodefony/devkit/docs/index.md`.

### L'environnement : ne devine JAMAIS, demande

```bash
npx nodefony env          # cascade des .env, valeur EFFECTIVE de chaque variable, sa PROVENANCE
```

**Encadre toute modification de configuration par cette commande** : une fois AVANT, pour savoir ce
qui s'applique et d'où ça vient ; une fois APRÈS, pour prouver que ta valeur est celle qui gagne.
Lire les `.env` toi-même donne des contenus ; la précédence est un mécanisme — tu ne peux que la
supposer, et une supposition fausse ne se voit qu'en production. La commande ne boote rien, donc
elle répond aussi quand l'application ne démarre plus.

**Précédence, du plus FORT au plus faible** — le premier qui pose une valeur gagne, les suivants
sont ignorés en silence :

```
process.env  >  .env.<déploiement>.local  >  .env.<mode>.local  >  .env.local
             >  .env.<déploiement>        >  .env.<mode>        >  .env
```

`<mode>` = `NODE_ENV` · `<déploiement>` = `APP_ENV` (plus spécifique, donc plus fort). Les `*.local`
ne sont jamais committés : les secrets y vont, et nulle part ailleurs.

| Forme                                 | Ce que c'est                                         | Où c'est déclaré                                       |
| ------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------ |
| `NF_PORT=5151`                        | variable de l'APP, typée et validée                  | `env.ts` (`defineEnv`) — non déclarée = **sans effet** |
| `NF__HTTP__SERVERS__HTTPS__PORT=8443` | surcharge DIRECTE d'une clé de config d'un module    | rien à déclarer — double `__` = séparateur             |
| `NF_TOTP_KEY_FILE=/run/secrets/x`     | la même variable, lue depuis un fichier (secret K8s) | idem `NF_TOTP_KEY`                                     |

Une variable `NF_` mal orthographiée n'échoue pas : elle est **ignorée**, et le défaut s'applique en
silence. `npx nodefony env` est le seul endroit qui la montre, avec la correction probable.

## 4. Les commandes — demande la liste, ne la devine pas

```bash
npx nodefony --help              # TOUTES les commandes, celles des modules installés comprises
npx nodefony <commande> --help   # les options exactes de l'une d'elles
```

La liste **dépend des modules installés** : elle n'est pas la même d'une application à l'autre, et
elle s'allonge dès que tu en ajoutes un. C'est pour ça qu'elle se demande au lieu de se retenir.

**Toujours `npx`, jamais `nodefony` nu.** Le binaire vit dans les `node_modules` de CETTE
application : la forme nue rend un code 127 tant que rien n'est installé globalement. Une
installation globale existe (elle sert à créer une application HORS projet) et, dans un projet, elle
passe la main au binaire local — mais elle peut être plus ANCIENNE. `npx` prend la version que cette
application a choisie, sans dépendre de ce qui traîne sur la machine.

Celles qu'on n'invente pas, faute de savoir qu'elles existent :

- Mettre l'application derrière **nginx ou haproxy** — `npx nodefony proxy:generate <nginx|haproxy>`
- **Servir les fichiers statiques depuis un CDN** — `npx nodefony assets:publish [--clean]`
- **Certificat TLS de développement** — `npx nodefony http:certificates`
- **Dépendances en retard**, agrégées et non le brut de npm — `npx nodefony outdated`
- **Cohérence du projet** (classe non câblée, route qui répondra 404) — `npx nodefony doctor`
- **Plusieurs processus, un cœur chacun** — `npx nodefony production -w <n|auto>` · `NF_WORKERS`
- **Complétion au TAB** — `source <(nodefony completion zsh)`

Ce tableau ne remplace pas `--help` : lui seul connaît les modules de CETTE application, et il fait
foi le jour où les deux divergent.

## 5. Piloter le serveur — et l'ARRÊTER

```bash
npm run dev                              # développement : rechargement auto, Ctrl+C pour arrêter
npx nodefony development --no-watch      # développement SANS rechargement : un process, stable
npx nodefony status                      # que tourne-t-il ? ports, PID — ne boote rien
npx nodefony stop                        # arrêt PROPRE de tout runtime de cette application
npx nodefony stop <nom|chemin>           # arrêter un AUTRE projet, sans changer de dossier
npx nodefony production --detach --wait   # boot réel en arrière-plan ; rend la main ports OUVERTS
```

**Arrête ce que tu démarres.** Un serveur laissé derrière garde les ports : le run suivant échoue
sur une erreur qui ne parle jamais de lui (`EADDRINUSE`) — ou pire, un test interroge l'ANCIENNE
version du code. Et **jamais `… &`** : le processus reçoit SIGHUP et meurt ; tuer le PID du port ne
tue pas le superviseur, qui respawne.

**Ces commandes ne voient QUE cette application.** Plusieurs projets Nodefony peuvent tourner sur la
même machine ; `status` ne compte jamais les processus du voisin comme les tiens, il les NOMME dans
une table à part — et ce nom est ce que `stop` accepte. Donc « aucune instance » veut dire « aucune
À MOI », pas « rien ne tourne » ; et une cible que `stop` ne peut pas désigner sans ambiguïté est
REFUSÉE, avec un code de sortie non nul et rien d'arrêté — **lis ce code**, un refus ressemble
sinon à un succès.

**Pour faire tourner une suite contre un serveur, prends `--no-watch`.** Le mode développement
relance le serveur dès qu'un fichier bouge : pendant un run, le redémarrage coupe les connexions
sous les tests, et le rouge qui en sort accuse le code alors que le fautif est le décor.

**N'invente pas d'attente** : `--wait` ne rend la main qu'une fois les ports en écoute — un `sleep`
arbitraire est soit trop court (test rouge sans raison), soit du temps perdu à chaque exécution.

## 6. Conduire une tâche — la séquence, et ses points d'arrêt

1. **Demande à l'application, ne déduis pas du code** (§3). Une route lue dans un fichier peut
   n'être montée nulle part ; l'inverse aussi. **Un argument RESTREINT la réponse** — `inspect
routes auth` ne rend que les routes dont le chemin, le nom, le contrôleur, l'action, le module
   ou les méthodes portent `auth`. Ne tronque JAMAIS une sortie d'inspection (`| head`) pour la
   faire tenir : ce qu'on cherche est presque toujours dans la partie coupée — c'est ainsi qu'on
   conclut « le framework ne fournit pas ça » et qu'on le réécrit à la main.
2. **Cherche la référence** (§2) avant de choisir une façade. Le framework en a presque toujours
   une, et la contourner compile — c'est tout le piège.
3. **Génère.** Si un générateur couvre le besoin, lance-le et **imite sa sortie** pour le reste.
   `--dry-run` montre le plan et les diffs sans rien écrire ; un refus n'écrit jamais rien.
4. **Édite le moins possible**, et regroupe : toutes les modifications serveur d'une même
   fonctionnalité, PUIS un seul cycle de reconstruction. Le frontend passe en HMR, zéro
   redémarrage.
5. **Prouve.** `npm run verify` — une seule commande : types, style, tests, câblage, dans cet
   ordre. Elle s'arrête au premier rouge, et **ce rouge est ta tâche suivante**.

**Le point d'arrêt qu'on rate** : `npm test` seul ne prouve pas que ça compile — vitest
n'inspecte aucun type. Une application peut être verte et ne pas compiler.

### Le poids du modèle est un CHOIX, et il est mesuré

Si ton outil sait déléguer à des sous-agents : une tâche couverte par un **générateur** ne demande
pas un gros modèle — c'est le générateur qui porte le savoir. Mesuré sur ce framework, « ajoute une
ressource REST » rend le MÊME résultat en modèle léger et en modèle fort (mêmes contrôles verts,
écart d'étapes dans le bruit) pour **~3× moins cher**. À l'inverse, le socle SANS générateur (flux,
session, cycle de vie) fait échouer le modèle léger environ une fois sur deux.

Donc : **léger** pour appeler un générateur, inventorier, lire, vérifier un fait, appliquer un
patron ; **fort** pour écrire du socle sans générateur et pour arbitrer une architecture. Le test
qui tranche en une seconde : _la tâche a-t-elle une bonne réponse vérifiable ?_ Aucun nom de modèle
ici — ils changent tous les trimestres ; raisonne en poids.

## 7. Les pièges du serveur

Chacun a déjà coûté au moins une heure à quelqu'un. Les quatre premiers sont les plus fréquents.

- **Ta route répond 404 alors qu'elle existe dans les sources.** Le runtime charge `dist/`, pas
  le source : `npm run build`. C'est la cause n°1.
- **Une classe que rien ne déclare compile, passe ses tests, et casse au démarrage suivant** —
  entité hors `@entities([…])`, controller hors `@controllers([…])`. Table jamais créée, route
  en 404. C'est le mode d'échec de la COPIE : on recopie le voisin au lieu d'appeler le
  générateur, qui, lui, déclare. `npx nodefony doctor` la NOMME.
- **Une clé de configuration mal orthographiée est retirée en silence.** `satisfies` sur le
  fragment n'est pas décoratif : sans lui, la faute compile, puis la validation écarte la clé et
  le module démarre sur son défaut. Personne ne le voit.
- **La config d'un module est FIGÉE après le démarrage** : l'écrire lève `TypeError`. Une variante
  par requête = `overlayConfig()` (clés de la liste blanche du module), lue par `useConfig()`.
- **Tu lis une liste sans la BORNER.** Un `find` sans limite matérialise la table entière —
  indolore sur les quelques lignes du poste de développement, fatal sur les dizaines de milliers
  de la production. Le service d'une entité hérite `findPage({ limit: 25 })`.

- **Des dizaines de tests d'intégration rouges d'un coup** (`ECONNREFUSED`) : ils FRAPPENT un
  serveur, ils ne le lancent pas — il est éteint. `npx nodefony status` d'abord ; en e2e, laisse
  la commande gérer le cycle.
- **Ta route NEUVE répond 404 et le `dist/` est à jour** : elle n'est pas montée où tu crois. Le
  chemin réel est le PRÉFIXE de son controller suivi du `path` de la route — une action
  `path: "/widget"` dans un controller `@controller("/api")` répond sur `/api/widget`.
  `npx nodefony inspect routes --json` donne le chemin MONTÉ.
- **TOUT répond 404, même les routes du gabarit** : un AUTRE serveur tient les ports — ou LE TIEN
  a glissé, le port voulu étant pris. `npx nodefony status` montre les ports RÉELS, pas ceux que
  tu as configurés, et NOMME le projet voisin.
- 🔴 **`nodefony <commande>` échoue là où `npm run dev` réussit, sur la MÊME application** : DEUX
  paquets `nodefony` tournent dans le processus — un binaire lié ailleurs (installation globale,
  `npm link`) exécute un noyau pendant que l'application importe le sien. Chaque copie a ses
  propres classes, son contexte de requête et ses registres d'injection : un module construit à la
  frontière perd son container SANS la moindre erreur — il figure dans la liste des modules et ne
  fait rien. ⚠️ Les deux copies peuvent être la MÊME version ; deux fichiers distincts suffisent,
  il n'y a aucune incohérence à repérer. `npm ls nodefony` liste les copies (« deduped » partout =
  une seule) ; `NF_CLI_DEBUG=1 nodefony --version` dit quel CLI s'exécute.
- **`localhost` et `127.0.0.1` te jouent des tours** : ce sont deux ORIGINES distinctes — cookies,
  cache et passkeys ne les partagent pas. Une seule origine en développement, partout, URL ouverte
  comme callbacks.

- **Les routes authentifiées plafonnent quand le reste tient la charge** : le stockage de session
  par défaut est SYNCHRONE — chaque reprise bloque la boucle d'événements. Compare une route
  anonyme et une route authentifiée AVANT d'accuser TLS ou le pare-feu ; passe le stockage sur
  redis pour la charge.

### Ce qui tue le processus, pas la requête

- 🔴 **Une promesse lancée sans `await` porte TOUJOURS un `.catch()`.** Audit, courriel,
  notification, nettoyage différé : un rejet non capté ne casse pas la requête, il tue le
  **processus entier** — donc toutes les requêtes en vol, pas seulement la tienne.
- 🔴 **Un handler ne bloque jamais la boucle d'événements.** Aucune API `*Sync`
  (`readFileSync`, `pbkdf2Sync`, `zlib`, `child_process`), aucun `JSON.parse` sur un corps non
  borné, aucune expression régulière à quantificateurs imbriqués sur une entrée utilisateur.
  Au-delà d'une milliseconde de calcul, passe par `worker_threads` : un seul handler lourd
  bloque **tous** les clients, pas seulement celui qui l'a déclenché.
- **Un `PATCH` au corps vide se refuse en `400`.** Le laisser passer produit un `updateOne({})`,
  qui finit en `500 « No values to set »` — une erreur serveur pour une faute de client.

### Quand ça ne va pas, et que le message ne suffit pas

- **Un test vert seul et rouge en suite accuse une RESSOURCE PARTAGÉE**, pas ton code : base ou
  index réutilisé, port, store jamais purgé, assertion `count === N` qui suppose une table
  vierge. Lance deux fichiers ENSEMBLE pour isoler la paire, puis cloisonne. **Ne sérialise
  jamais la suite** pour faire passer le rouge : tu masques la cause et tu paies la lenteur à
  chaque exécution.
- **Une suite lancée contre un serveur en `production` reçoit `404` partout** : les modules
  `policy:"dev"` n'y sont pas. `NF_WITH_DEV_MODULES=1` déroge pour 30 minutes
  (`NF_WITH_DEV_MODULES_TTL_MIN`, 4 h au plus), et le `CRITIC « arrêt automatique … dérogation »`
  du journal est cette garde qui se referme — pas une panne.
- **Ton application a démarré AMPUTÉE et tout a l'air sain** — base injoignable, module écarté
  par sa politique. Seul `npx nodefony doctor` le dit, en relisant `var/last-boot.json`.
  ⚠️ Ce bilan a un ÂGE : il décrit le **dernier démarrage**, et une commande console (`inspect`,
  une commande de module) ne l'écrase pas. C'est voulu — lis la date avant d'en conclure.
- **L'application ne démarre plus et le superviseur avale la sortie** :
  `NF_DEV_CHILD=1 npx nodefony development` lance l'enfant seul et montre le crash brut.

## 8. Données et fichiers — les façades qu'on ne recompose pas

- **Un cache ne remplace pas une base : ils se COMPLÈTENT.** Chaque adaptateur déclare les
  _stores_ qu'il sait tenir (`nodefony.stores` de son `package.json`) — `drizzle` et `mongoose` les
  huit, `redis` quatre (`session`, `tokens`, `passkeys`, `idempotency`) : un cache ne garde ni
  comptes ni journal d'audit. Ne promets jamais une parité qui n'existe pas — lis ce champ, et
  `npx nodefony inspect stores` dit où atterrit chaque donnée.
- **Les violations de contrainte sont DÉJÀ traduites en HTTP — ne les rattrape pas.** Un doublon
  sur une colonne unique ressort en **409**, une donnée qui viole le schéma Zod en **422**, chacun
  avec son corps JSON : le rendu d'erreur lit le code du pilote (`23505`, `ER_DUP_ENTRY`,
  `SQLITE_CONSTRAINT_UNIQUE`, `11000`) et le mappe, quel que soit le moteur. N'écris donc JAMAIS un
  `throw … 409` pour un identifiant déjà pris. Le vérifier toi-même d'abord (« existe-t-il ? » puis
  insertion) est plus lent ET **faux sous concurrence** : deux requêtes simultanées passent toutes
  les deux le test avant que l'une n'écrive. La contrainte de la base est le seul arbitre exact.
- **Un fichier ne se sert pas à la main.** Trois façades, choisies sur l'usage :
  `this.renderMediaStream(file)` implémente les **requêtes par plage** (`Range` → 206 +
  `Content-Range`, 416 hors plage) — ce qu'exige un lecteur vidéo ou audio pour se déplacer ;
  `this.streamFile(file)` envoie le fichier ENTIER en flux ; `this.renderFileDownload(file)` force
  le téléchargement. Recomposer ça avec `createReadStream` et `response.write` compile, passe les
  tests — et rend une réponse **incohérente** : un statut posé à la main n'atteint jamais la socket
  (le pipeline écrit statut et en-têtes à SON tour), donc le client reçoit **200 avec un corps
  partiel** et croit tenir le fichier complet. Mesuré au banc, pas supposé.
- **Un pod dont la base est en retard répond 503 sur `/readyz`** (jamais sur `/livez`) et reste
  hors du répartiteur : c'est voulu, ce n'est pas une panne. `npx nodefony orm:migrate:status` dit
  qui est en retard ; applique les migrations, les pods se mettent en service SEULS.

## 9. Les pièges du front

Ne concerne qu'une application qui a un frontend. Sauf mention, **vaut pour les quatre moteurs**
(React, Vue, Angular, Svelte) : le framework ne t'en impose aucun.

### Ce qui fuit, et ce qui s'injecte

- 🔴 **Toute donnée non maîtrisée se rend en nœud TEXTE.** Jamais `dangerouslySetInnerHTML`
  (React), `v-html` (Vue), `[innerHTML]` (Angular), `{@html}` (Svelte). Un Markdown se rend sans
  HTML brut.
- 🔴 **L'identité est un cookie `HttpOnly` que le navigateur joint seul.** Aucun jeton en
  `localStorage` ou `sessionStorage`, aucun en-tête `Authorization` écrit à la main. Un `401`
  est un ÉTAT (« pas connecté »), pas une erreur à journaliser.
- 🔴 **Le bundle front n'importe jamais un module serveur** — `@nodefony/http`,
  `@nodefony/security`, une entité ORM, `nodefony.config`, `.env`. Un type serveur passe par
  `import type` ou un miroir. Le test qui tranche : **si l'import tire un `node:*`, arrête-toi**
  — ce bundle est public.
- **Rien de secret ne part côté client.** Toute clé `VITE_*` est lue par le navigateur ; un
  `console.*` de données committé est une fuite. Le front AFFICHE ce qu'il reçoit — la rédaction
  des secrets est un travail de serveur.

### Charger des données sans casser l'écran

- **Un écran qui charge a quatre états EXCLUSIFS**, dans cet ordre de priorité : erreur (avec un
  « réessayer »), chargement (un squelette qui épouse la page), vide (qui dit POURQUOI), données.
  Un seul visible à la fois.
- **Tout chargement porte un jeton de génération** : une réponse arrivée après démontage, ou
  après un changement de paramètre, est IGNORÉE — sinon un écran affiche les données d'un autre.
  `loading` vaut `true` dès le montage, jamais après. Le framework ne fournit pas de hook de
  ressource : c'est à écrire, dans les quatre moteurs.
- **Au vrai changement de compte** (l'identifiant passe d'une valeur à une AUTRE), force
  `disconnect()` puis `connect()` sur la socket partagée et purge les caches propres à
  l'utilisateur. Jamais au démarrage ni au rechargement : tu couperais les requêtes en vol.

### Un écran qui se met à jour tout seul

- **Un widget temps réel est invisible tant qu'il ne se passe rien.** Format par paliers (jamais
  une valeur qui saute de millisecondes à secondes), `font-variant-numeric: tabular-nums` sur
  tout nombre qui change, aucune animation rejouée à chaque tick, `prefers-reduced-motion`
  respecté, et un contrôle pause/fréquence dès que ça bouge seul plus de 5 s (WCAG 2.2.2).
  **Le test** : fixe l'écran 30 secondes — rien ne doit bouger sans cause.
- **N'anime que `transform` et `opacity`** ; `contain: content` sur chaque widget vivant,
  `content-visibility: auto` sur les longues listes.
- **Accessibilité, le minimum qui se vérifie à l'œil** : un seul `<h1>` par page, `aria-label`
  sur tout bouton-icône, `aria-expanded` sur tout bascule, `aria-live` sur les zones qui changent
  seules, `role="img"` + `aria-label` sur un graphe SVG, jamais une information portée par la
  **couleur seule**, `rel="noopener noreferrer"` sur les liens externes.

- **Une route d'API répond du HTML** : un repli SPA générique avale les routes voisines — le
  premier motif qui correspond gagne. Repli en préfixe LITTÉRAL ; `npx nodefony inspect routes
--json` montre l'ordre réel.
- **Des utilisateurs « déconnectés au hasard »** : le traitement global « 401 = session expirée »
  frappe aussi les sondes d'authentification, où 401 est NORMAL — et détruit une session valide.
  Exempte les sondes du traitement global.
- **Ta page répond 200 et son script ne s'exécute pas** : la politique de contenu exige un `nonce`
  sur les scripts, et le navigateur refuse un `<script>` en ligne qui n'en porte pas (« Refused to
  execute inline script »). Un `curl` ne le voit JAMAIS, il ne lit que le corps. Signe le script
  (valeur `this.context?.cspNonce`) ou sors-le dans un fichier servi ; ne desserre PAS la politique.
- **En production, la modification front n'apparaît jamais** : hors développement il n'y a PAS de
  rechargement à chaud, et le manifeste est lu AU BOOT. `npm run build`, puis **redémarre le
  serveur**, puis rechargement forcé.

### Le piège qui fait croire à un bug de code

- **Vite affirme qu'un export n'existe pas** (`does not provide an export named …`) alors qu'il
  est bien dans le source — typiquement après un nouveau sous-chemin `nodefony/*`, une dépendance
  ajoutée, ou un `git pull`. C'est son cache : `rm -rf node_modules/.vite`, puis relance. Ne
  purge pas sans raison, ça coûte 5 à 20 s de ré-optimisation.

## 10. Avant de dire « fait »

```bash
npm run verify        # types + style + tests + câblage
npm run test:e2e      # boot réel + HTTP/WS — le gate LENT, hors `verify`
```

Puis, en une phrase : **nomme ce que tu n'as PAS lancé.** Un vert ne couvre que le diff qui l'a
produit, et un banc sauté faute de son décor compte comme vert. Dire « e2e non lancé » coûte
cinq mots ; le taire coûte la confiance dans tout le reste.

Quatre règles de plus, chacune payée par une conclusion fausse qu'on a crue. Elles ne parlent
pas de ce framework en particulier — elles parlent de la façon dont une preuve se fabrique.

- 🔴 **Ta preuve porte sur l'artefact qu'on REÇOIT, pas sur ce que tu viens d'écrire.** Le
  runtime charge `dist/`, une image embarque ce que le `Dockerfile` a copié, un paquet publié
  contient ce que `files` laisse passer. Et avant de mesurer, vérifie que la transformation a
  bien EU LIEU (date, empreinte) : dans une chaîne `a && b && c`, un maillon qui échoue laisse
  mesurer l'ancienne version — et « prouver » qu'un correctif ne change rien.
- 🔴 **Un test que tu n'as jamais vu ROUGE ne prouve rien.** Écris-le, puis casse exprès ce
  qu'il garde : retire le correctif, débranche le câblage. S'il reste vert, il ne mesure pas ce
  que tu crois. Remets, et alors seulement crois-le. Un test écrit face au code déjà corrigé est
  complaisant par construction.
- **Un décor SALE fabrique des verdicts faux** : un serveur resté ouvert sur le port, une base
  jamais purgée, une variable d'environnement absente. Avant d'accuser ton code, qualifie le
  rouge sur un décor NEUF — sinon tu corriges un problème qui n'existe pas, et tu laisses
  intact celui qui existe.
- **Suspecte ton instrument avant de suspecter le code.** Une commande qui rend « 0 résultat »,
  un compteur à zéro, un journal vide : demande-toi d'abord si l'outil regarde au bon endroit.
  Une sortie tronquée, un filtre trop étroit, un chemin qui n'existe plus ne s'annoncent jamais
  — ils rendent un silence qui ressemble à une réponse.
