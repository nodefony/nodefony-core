# RETEX.md — digest des retours d'expérience (SAS, lu à chaque début de session)

> **Rôle** : sas entre les retex bruts (`docs/session-retros/archive/<date>-<id>.md`, jamais relus
> seuls) et les leçons durables (mémoires `feedback_*` indexées dans `MEMORY.md`). Il porte les
> **frictions récentes pas encore confirmées**. Le skill `nodefony-session` le **lit au START/RESUME**
> et le **met à jour au END** (3-5 bullets du jour, par thème).
>
> **Règle anti-doublon (CRITIQUE)** : une leçon est **soit** ici (sas), **soit** en `feedback_*`
> (graduée). **JAMAIS les deux.**
>
> **🔴 SEUIL DE GRADUATION — il porte sur le THÈME, pas sur le compteur d'un bullet.** Un thème qui
> atteint **~5 frictions distinctes** est démontré et part en `feedback_*`, puis disparaît d'ici.
> Le compteur `[N×]` ne sert qu'à repérer une friction qui se répète à l'identique — il ne
> déclenche rien. _Pourquoi ce changement (2026-08-02) : l'ancienne règle « ≥3× » n'a JAMAIS
> déclenché en 135 frictions — chaque session écrivait un bullet neuf au lieu d'incrémenter, si
> bien qu'un thème à 35 frictions en dix jours n'a jamais été gradué._
>
> **Taille bornée : ~1 écran.** Snapshots complets avant coupe :
> `archive/RETEX-snapshot-<date>.md` — rien n'est perdu.

---

## 🧪 Un test qui ne parle jamais au serveur — et celui qui passe débranché

- [1× — 08-23d] **`savepoint()` est un NO-OP chez Mongoose** (MongoDB n'a pas de
  savepoints). Un banc de coupure copié de drizzle l'utilisait pour « sonder » le
  serveur : il ne lui parlait JAMAIS et serait passé au vert sur une base éteinte. Avant
  d'utiliser une méthode de contrat comme SONDE, vérifier qu'elle fait une E/S sur CE
  dialecte.
- [1× — 08-23d] **Un test de bascule de primaire passait même en débranchant
  l'idempotence** qu'il prétendait éprouver : Mongoose dédoublonne en amont (son
  `readyState` n'émet que sur changement). Le débranchement est le SEUL révélateur ; sans
  lui, on publie un test complaisant en croyant avoir prouvé.

## 🩺 Une correction qui ne couvre qu'un cas, présentée comme complète

- [1× — 08-23d] Détection de coupure câblée sur les événements de pool : ils ne voient
  que le client **INACTIF** (`pg-pool` retire son auditeur pendant l'usage). J'ai livré
  en annonçant le problème résolu ; c'est le user qui a douté, et il avait raison.
  **Avant d'annoncer une couverture, énumérer les cas et dire lesquels ne sont PAS
  couverts** — ici : coupure sous trafic, base gelée.
- [1× — 08-23d] Corollaire : **une sonde doit avoir sa propre montre**. Le premier
  battement de cœur était inopérant contre une base gelée — `ping()` PEND, et la sonde
  pendait avec la panne qu'elle devait observer.

## 🌍 Une portée GLOBALE n'est pas « un peu intrusive » — elle est FAUSSE

- **Le défaut était documenté au lieu d'être corrigé.** `ai:mcp` écrivait la porte MCP dans le
  foyer pour Vibe et Codex, et l'ANNONÇAIT : « deux applications Nodefony se disputent le même nom,
  la seconde efface la première sans un mot ». Or l'URL d'une porte porte un PORT : une déclaration
  globale ne peut désigner qu'UNE application — ce n'est pas un inconfort, c'est un résultat faux.
  Signal à reconnaître : **un commentaire qui décrit une collision au lieu de l'empêcher.**
  `[1× — 08-23c]`
- **Le dépôt contredisait sa propre commande, et c'est le dogfooding qui l'a montré** : un
  `.vibe/config.toml` COMMITÉ disait « jamais dans ~/.vibe » pendant que la commande y écrivait.
  Quand un fichier du dépôt argumente contre une de nos commandes, c'est la commande qui a tort.
  `[1× — 08-23c]`
- **Deux objections bloquaient, une seule tenait.** « Écrire le format d'un tiers » : levée en
  redirigeant `VIBE_HOME`/`CODEX_HOME` sur le projet — c'est LEUR binaire qui écrit LEUR format.
  « Le fichier n'est lu que dans un dossier de confiance » : vraie, mais elle se RETOURNE — un
  fichier non lu est inerte, une déclaration globale fausse est active. **Entre échouer en silence
  et réussir à côté, choisir le premier.** `[1× — 08-23c]`
- **Rediriger le home d'un agent y fait déposer ses fichiers de TRAVAIL** (`trusted_folders.toml`,
  `.codex/tmp/`). Un `.gitignore` qui ne versionne que la DÉCLARATION — dans le dépôt ET dans le
  gabarit d'app générée, sinon chaque app naît avec ces artefacts. `[1× — 08-23c]`

## 🎯 Un PORT qui répond ne dit pas À QUI — l'identité de la cible se PROUVE

- **Un run interrompu a empoisonné le suivant, et personne ne pouvait le voir.** Une passe arrêtée
  sur « l'agent n'a rendu aucun tour » a quitté sans éteindre son serveur ; le run d'après a trouvé
  ses ports dédiés pris, sa prémisse n'a donc jamais démarré le sien — et l'agent, le constat de
  porte et le juge des routes ont TOUS interrogé l'application du run précédent. Mêmes ports, même
  nom (`bench-app`) : aucun signal. Le seul verdict juste de la passe fut le rouge de
  `nodefony check` (« le port est tenu par un autre processus »), imputé à l'agent. Réflexe : avant
  de croire un port, demander à l'application sous test de se NOMMER — ici son `runtime.json`
  (`pid` + ports effectifs), local et gratuit. [1× — 08-23]
- **Un arrêt qui ne couvre pas les sorties d'URGENCE n'est pas un arrêt.** Celui du banc existait
  et nommait même le risque, mais il vivait après la boucle et ne valait qu'en régime `auth` — or
  une passe s'interrompt par `process.exit`, et une PRÉMISSE démarre l'application dans tous les
  régimes. Le nettoyage d'un décor s'arme sur `process.on("exit")` + signaux, jamais sur le seul
  chemin nominal. [1× — 08-23]

## 🧭 La doc qui AFFIRME une automatisation qui n'existe pas

- **« Ajouter un choix = ajouter UNE entrée ici ; aucun front n'est à modifier »** — vrai pour deux
  fronts sur trois. La voie FLAGS a une analyse écrite à la main : une question ajoutée y est servie
  à l'humain et REFUSÉE au script, sans un mot. J'ai cru l'en-tête et raté le drapeau. Une
  affirmation d'automatisation se vérifie avant d'être crue, et se corrige quand elle est fausse —
  ici par un gate qui refuse toute question qu'aucun drapeau ne sert. [1× — 08-22h]
- **Une doc dont tous les exemples passent par Docker fait prendre le chemin long.** Le skill
  navigateur disait « la voie locale d'abord » puis montrait dix `docker exec` : j'ai démarré un
  conteneur pour regarder une page locale, puis conclu à tort qu'un navigateur piloté était en
  panne (certificat de développement refusé). Ce que la doc MONTRE pèse plus que ce qu'elle dit.
  [1× — 08-22h]

## ⏳ Un symptôme qui ressemble à un DÉLAI n'en est pas forcément un

- **« La commande meurt toute seule » n'était pas un timeout — il n'en existait aucun sur ce
  chemin.** Une question est une promesse en attente ; Node ne compte pas les promesses, il compte
  les HANDLES. Une commande qui boote a des dizaines de handles, donc sa question tient sans que
  personne n'y pense ; une commande standalone n'en a AUCUN, et le process sort au milieu de la
  question, code 0, sans erreur. Le user avait donné le discriminant sans le savoir : « sur le menu
  ça a l'air de tenir » — c'est exactement la frontière du fast-path. Réflexe à garder : quand un
  symptôme ressemble à un délai, chercher d'abord ce qui RETIENT le process, pas ce qui le tue.
  [1× — 08-22f]
- **Le défaut ne frappait que les commandes les plus SOIGNÉES.** Celles qu'on a travaillé à rendre
  rapides (zéro boot) sont précisément celles qui n'ont plus rien pour tenir. Une optimisation peut
  retirer un effet de bord dont personne n'avait noté qu'il servait de garde. [1× — 08-22f]

## 🚪 Une porte a plusieurs ENTRÉES — le défaut vit dans la COMPARAISON, pas dans chacune

- **« Présenter MAL valait moins que ne rien présenter », et aucun test ne pouvait le voir.** Sur
  la porte MCP, chaque entrée était éprouvée SÉPARÉMENT et chacune était juste : sans en-tête →
  200 + outils publics ✅ ; jeton invalide → 401 ✅ ; en-tête vide → 400 ✅. L'absurdité
  n'apparaît qu'en les METTANT CÔTE À CÔTE — un client qui tente de s'authentifier avec un jeton
  expiré obtenait MOINS que le même client muet, et un client MCP marque alors le serveur
  « failed » pour toute la session. Réflexe à prendre : pour toute porte à plusieurs entrées
  (anonyme / porteur / session / interne), écrire le TABLEAU de ce que chacune restitue, et
  chercher l'inversion. La conformité de chaque ligne ne dit rien de la cohérence de la colonne.
  [1× — 08-22g]
- **C'est le USER qui l'a trouvé, en s'en servant — et j'ai conclu deux fois avant de chercher.**
  D'abord « reconnecte », puis « c'est l'état de ton client » : deux réponses exactes (la porte
  répondait bien) et deux fois hors sujet, parce qu'aucune ne répondait à ce qu'il DEMANDAIT (« je
  veux des outils SANS authentification »). Il a fallu qu'il répète pour que je cherche le défaut
  de conception au lieu de défendre la mesure. ↝ [[feedback_user_repeats_question]] [1× — 08-22g]

## 🧭 Une garde ne couvre jamais une AUTRE question — même quand elle y ressemble

- **`PACKAGE_NAME` bornait la traversée de chemin, pas le PÉRIMÈTRE.** Les deux gardes se
  ressemblent (« quel nom de paquet accepte-t-on ? ») et répondent à deux questions distinctes : la
  première empêche `../../etc`, la seconde décide ce qu'on a le DROIT de servir. Sans la seconde,
  la porte de documentation rendait les pages de n'importe quelle dépendance installée. [1× — 08-22f]
- **`requiresAuth` regardait comment l'identité est PROUVÉE, pas ce que l'appelant PEUT.** Une
  porte plus stricte en apparence cachait des données moins sensibles que celles qu'une autre
  rendait déjà au même appelant — et rendait la capacité inatteignable dans le mode nominal. [1× — 08-22f]

## 📐 Composer une assertion de chemin ne suffit pas — il faut composer avec la MÊME opération

- **La CI Windows était rouge sur deux tests qui SUIVAIENT pourtant l'axiome** (composés au
  `path.join`, jamais littéraux). Le code rendait un chemin ABSOLU (`path.resolve` → `D:\…`),
  l'attendu était seulement ENRACINÉ (`\…`). `resolve` d'un côté et `join` de l'autre ne décrivent
  pas le même chemin dès qu'une plateforme distingue les deux. Et mes tests du jour portaient le
  même défaut, non encore poussé. [1× — 08-22f]

## 🚧 Ajouter une EXIGENCE sans regarder qui PRODUIT l'artefact exigé

- **La porte s'est mise à exiger un scope ; la commande qui fabrique le jeton n'en demandait
  aucun.** `ai:mcp` enchaîne `security:token --write` (sans `--scope`) : le parcours nominal de
  l'utilisateur aurait produit un jeton refusé à la première lecture — un 401 remplacé par un 403,
  sans raison visible. C'est le **user** qui a demandé « le token mcp a des scopes par défaut ? ».
  Le geste manquant : quand on ajoute une condition d'accès, remonter la chaîne jusqu'à CE QUI
  fabrique l'artefact soumis à cette condition, et le vérifier en le LANÇANT. [1× — 08-22e]
- **Et l'exiger sans le PUBLIER, c'est exiger l'invisible** : le client suit le défi, lit le
  document de ressource, n'y voit aucun scope, obtient un jeton nu, se fait refuser — et n'a aucun
  moyen de savoir quoi demander. Une exigence neuve se publie dans le document que le refus
  désigne. [1× — 08-22e]

## ⏳ Un défaut « pratique » grave un pouvoir pour le jour où la distinction deviendra réelle

- **`admin:read admin:write` par défaut n'avait aucun effet** — le plan d'administration n'a qu'un
  rôle, les deux scopes ouvrent la même chose. Précisément pour ça, personne ne l'aurait remarqué ;
  et le jour où la séparation lecture/écriture deviendrait réelle, tous les jetons émis d'office
  porteraient le pouvoir d'écrire sans qu'aucune décision ne l'ait accordé. Un défaut se choisit sur
  ce qu'il vaudra APRÈS le durcissement prévu, pas sur ce qu'il vaut pendant qu'il est inerte —
  le plus étroit se durcit tout seul dans le bon sens. [1× — 08-22e]

## 🔑 Un secret écrit là où personne ne le lit — et la question « qui le lit ? » qu'on ne pose pas

- **`--write` posait le jeton MCP dans `.env.local` : AUCUN code de l'application ne le lit.** Elle
  est le serveur de ressource, elle vérifie des jetons, elle n'en porte pas. Le consommateur — un
  agent — le cherchait ailleurs et recevait un 401 qui accusait le jeton. Une heure de diagnostic.
  `[1× — 08-22]`
- **La duplication ne survit pas à la ROTATION** : le fichier refusait d'être touché pendant que les
  agents auraient dû recevoir le neuf. La question de l'utilisateur — « pourquoi aussi dans
  `.env.local` ? » — valait mieux que ma conception. `[1× — 08-22]`
- **L'état de câblage n'a pas à être mémorisé : il EST dans les fichiers.** Un agent qui porte la
  clé a été câblé un jour ⇒ rotation muette. Un fichier d'état parallèle aurait menti à la première
  édition manuelle. `[1× — 08-22]`

## 🟢 Un test peut passer depuis TOUJOURS sans avoir jamais rien mesuré

- **Un gate de couverture a rougi en CI, et il avait raison.** Le cas du 499 se skippait faute de
  trouver le journal du serveur — mais AVANT le correctif de la veille, le même test lisait un
  chemin en dur et, quand il était illisible, court-circuitait son assertion pour ne garder qu'un
  health-check : il passait VERT sans rien mesurer, depuis toujours. Le rouge du jour fut le
  premier verdict FIDÈLE. Réflexe : un gate qui se met à mordre après un correctif de test ne
  signale pas une régression, il révèle un mensonge ancien. [1× — 08-23]
- **La découverte d'un artefact doit RATISSER LARGE quand un marqueur tranche.** Le helper
  cherchait le journal dans deux emplacements et ignorait celui de la forge
  (`$GITHUB_WORKSPACE/nodefony-server.log`) : ajouter un candidat ne peut pas produire de faux
  positif (le marqueur unique décide), mais en OUBLIER un produit un banc muet. [1× — 08-23]

## 🎭 Mon PROPRE `--dry-run` mentait — l'option dont le seul rôle est de dire ce qui va se passer

- **La même URL recomposée à trois endroits, et l'un avait gardé l'origine nue** : `--dry-run`
  annonçait `http://localhost:5151` là où l'exécution visait `…/nodefony/mcp`. On croit un dry-run
  sur parole — c'est précisément pour ça qu'on le lance. Une valeur, calculée une fois.
  `[1× — 08-22]`
- **Un texte de sortie PÉRIME sans que rien ne le signale** : le rendu disait encore « écrit
  `NF_MCP_TOKEN` dans `.env` » le lendemain du jour où ce comportement avait été retiré. Un message
  qui envoie chercher un secret dans un fichier qui ne le porte pas, c'est le diagnostic d'une heure
  qu'on vient de payer, offert au suivant. `[1× — 08-22]`

## 🪟 Un message d'erreur qui n'énonce QU'UNE cause envoie chercher là où il n'y a rien

- Trois jobs Windows rouges deux jours durant sur « man/nodefony.1 est PÉRIMÉE — node
  scripts/generate-man.mjs ». La page n'était pas périmée : git la convertissait en CRLF au checkout
  (`core.autocrlf`), le générateur écrit du LF, le gate compare octet pour octet. **Régénérer n'y
  changeait rien.** Le message nomme désormais les DEUX causes. Corollaire : un dépôt Node
  multiplateforme sans `.gitattributes` a ce piège en dormance. `[1× — 08-22]`

## 📐 Le verdict BINAIRE d'un banc gaspille ce qu'il a déjà mesuré

- L'unanimité sur 3 runs a une résolution catastrophique : une tâche réussie 4 fois sur 5 sort
  « instable » **une fois sur deux** (P(3/3 | p=0,8) = 0,51). Vérifié dans le fichier : la tâche 13
  était à `2/3` le 2 août ; trois runs rejoués trois semaines plus tard ont rendu `2/3`. Deux
  mesures payées, zéro information. Les TOURS, eux, séparaient nettement (52·54 contre 69·88) —
  et le banc les jetait à la décision. `[1× — 08-22]`
- **Ne pas contourner à la main le refus d'un outil** : le dépistage a REFUSÉ de comparer (décor
  différent), je l'ai refait au `jq` et j'ai lu trois « chutes » qu'aucun changement n'expliquait.
  Refaire le calcul qu'une garde interdit, c'est reproduire l'erreur qu'elle empêche. `[1× — 08-22]`

## 🎭 Un test de CARACTÉRISATION grave un défaut au lieu de le décrire

- « initSyslog 2x avec kernel → 2 listeners (**pas de deduplication**) » — aucune justification, un
  simple constat figé. Il gardait un vrai bug : `listenWithConditions` AJOUTE un abonné, donc
  reconfigurer le filtre ne servait à rien (l'ancien écrivait toujours) et chaque ligne acceptée par
  plusieurs abonnés était écrite plusieurs fois. Signal à reconnaître : un intitulé qui **décrit un
  comportement sans dire pourquoi il serait souhaitable**. `[1× — 08-21e]`
- **Un renommage mécanique EMPORTE le témoin qui portait l'ancienne forme.** Le selftest du décor
  posait `NODEFONY_DEV_PORTS` pour graver « l'ancienne forme échappe au filtre `NF_` » ; le
  renommage global l'a transformée en `NF_DEV_PORTS`, donc correctement filtrée — et le test est
  tombé **parce que la réalité s'était améliorée**. Signal : un test rouge dont l'intitulé commence
  par « ⚠️ connue ». Le geste est de RETIRER la règle, pas de rafistoler le témoin. `[1× — 08-23c]`

## 🚪 Un fast-path standalone ne vaut QUE pour l'invocation directe

- `card`, `check`, `env`, `symbols`, `ai:sync`, `ai:mcp`, `git:hooks` : lancées depuis le MENU, le
  kernel tourne déjà, elles passent par commander et **BOOTENT** — leur sortie arrivait sous dix à
  trente lignes de « MODULE ADD ». Même piège pour les capacités déclarées : `CliKernel.start()` les
  applique d'après la commande DEMANDÉE, or depuis le menu c'est `menu`. Toute règle posée « au
  démarrage d'après argv » a un angle mort : le choix différé. `[1× — 08-21e]`

## 🧨 Une commande de DÉCLARATION ne doit jamais désarmer ce qu'elle trouve

- `ai:mcp` sans option RETIRAIT l'en-tête `Authorization` posé la veille — deux fois en une heure sur
  la config du développeur, dont une par un `--json` de simple vérification. Le message disait
  « (remplaçait <la MÊME url>) » : un remplacement qui ne remplace rien de visible. Deux règles :
  **`null` ≠ `false`** (« je n'ai rien demandé » n'est pas « je veux l'anonyme »), et **ce qu'on
  enlève se NOMME** dans la sortie. `[1× — 08-21e]`

## 🧵 Trois choses ne suivent PAS d'un process à l'autre — enchaîner se teste

- Enchaîner une commande sur une autre (`spawnSync`) : l'ENVIRONNEMENT (un enfant ne reçoit que ce
  qu'on lui donne — et `NODE_ENV` si la cible n'existe qu'en dev), le RÉPERTOIRE (écrire dans le
  PROJET, pas là où l'on a tapé), le TERMINAL (`stdio: "inherit"`, sinon `isTTY` est faux chez
  l'enfant et il ne peut rien demander). Rendre la DÉCISION pure et la tester ; le spawn est de la
  plomberie. Le gabarit `create command` l'enseigne désormais. `[1× — 08-21e]`

## 🖥️ Piloter un TTY par `expect` prouve mal — préférer rendre le câblage testable

- Cinq tentatives pour valider un choix de menu : filtres qui ne mordent pas, `\r` qui valide le
  premier item, prompt masqué impilotable, serveur de dev lancé par erreur **deux fois** (qu'il a
  fallu arrêter). Le prompt `search` d'inquirer ne se pilote pas de façon fiable. Quand un câblage a
  échoué en silence, l'exposer (méthode publique) et l'ÉPROUVER coûte moins cher qu'un pty.
  `[1× — 08-21e]`

## 💾 Un CACHE à demi écrit est pire qu'un cache absent — il écrase une donnée valide

- `[1× — 08-21d]` 🔴 **Trois symptômes sans rapport apparent, une seule racine : un `writeFile` en
  fire-and-forget.** Le menu perdait TOUTES ses commandes de module, la complétion proposait des
  noms de commandes au lieu des options, et le user devait relancer `nodefony -h` « à chaque fois ».
  Cause unique : `writeFile` OUVRE et TRONQUE avant d'écrire, donc un process qui sort avant la fin
  — le cas NOMINAL d'une commande CLI courte — laisse un fichier de **0 octet**. Chaque commande
  détruisait ainsi le cache que la précédente avait écrit. Le geste : **temporaire + `rename`**
  (atomique) dès qu'une écriture n'est pas attendue ; un process tué laisse alors l'ancien fichier
  INTACT. Et le diagnostic : `wc -c` sur le cache AVANT de suspecter sa logique de lecture.
- `[1× — 08-21d]` **Un fallback silencieux transforme un cache manquant en fonctionnalité amputée.**
  Le menu masquait le groupe entier sans un mot ; il ÉNONCE désormais l'absence et renvoie à
  `--help`. Corollaire de conception : ce qui répond à un TAB ou ouvre un menu ne doit jamais
  démarrer l'application — mais doit dire ce qu'il ne sait pas.

## 🖥️ L'interactif se prouve au PTY — et chaque couche peut salir la sortie

- `[1× — 08-21c]` **`script(1)` + `printf` piloté = prouver un prompt TTY sans machine ni
  main** : `(sleep 4; printf 'blog'; sleep 1; printf '\r') | script -q cap.txt npx nodefony
menu` — quatre preuves rendues dans la session (rendu groupé, filtre à la frappe, Ctrl+C,
  écran reset + commande exécutée). La capture se relit APRÈS strip ANSI, et le viewport
  d'inquirer ne rend que la fenêtre : « absent de la capture » ≠ « absent du menu » (vécu :
  un groupe en bas de liste cru manquant, révélé par le filtre).
- `[1× — 08-21c]` 🔴 **Un Ctrl+C « propre » a demandé DEUX corrections, chacune une couche
  plus bas** : (1) `throw` après `terminate()` — terminate est ASYNCHRONE, l'erreur remontait
  au kernel avant l'exit (CRITIC + exit 1) ; (2) `quiet` perdu par `CliKernel.terminate` qui
  délègue au kernel → le log INFO ressurgissait après « À bientôt. ». La sortie d'un CLI est
  une CHAÎNE de terminaisons : la prouver au pty à CHAQUE couche, pas au premier vert.
- `[1× — 08-21c]` **`stream-json` ne montre PAS le contexte initial injecté** : « VÉRIFIER
  absent du transcript » ne prouvait pas « CLAUDE.md pas injecté ». Tranché par une sonde
  discriminante à 1 centime : CLAUDE.md témoin « réponds BANANE42 » + `claude -p` → réponse
  conforme = le pointeur EST le seul canal injecté d'office en headless. L'instrument d'abord.
- `[1× — 08-21c]` **`perl -pe 's/\x{00A0}//'` sans décodage UTF-8 opère en OCTETS** : il a
  matché le seul 0xA0 et laissé le 0xC2 orphelin — fichier UTF-8 invalide, pire qu'avant.
  Remplacer un caractère multi-octets exige `-CSD` (ou opérer sur la séquence complète), et
  se vérifie à l'`od -c`, pas à l'œil.

## 🧪 Vérifier que la transformation a EU LIEU, avant de croire la mesure

- Un hook a bloqué un appel Bash entier (garde `cd` relatif), **python inclus** : l'édition n'a jamais eu lieu, j'ai buildé du code inchangé et conclu deux fois sur du vide. Le `grep` de contrôle sur le fichier édité coûte une seconde. [1× — 08-22]
- `$?` après un pipeline est celui de la DERNIÈRE commande : `prettier --check f | tail` rend toujours 0. Quatre verdicts faux d'affilée. [2× — 08-22]
- `prettier --check` lancé depuis le dépôt sur un chemin HORS périmètre ne trouve aucun fichier et sort **0** : « conforme » disait en réalité « rien vérifié ». Toujours mesurer dans le décor où la config s'applique. [1× — 08-22]
- Le CLI s'exécute depuis `dist` : un gabarit se lit au disque (édition immédiate), le MOTEUR non — build avant de mesurer. [1× — 08-22]

## 🗄️ Gradué aux CONSOLIDATE (retiré d'ici — règle anti-doublon)

Ces thèmes ont quitté le sas pour des mémoires durables. Ne pas les réécrire ici.

**CONSOLIDATE 2026-08-24 :**

| Thème (frictions)                                                  | Destination                                      |
| ------------------------------------------------------------------ | ------------------------------------------------ |
| 🔌🧪🎭 Le DÉCOR d'un banc : variable, pas dû ; ni celui livré (19) | `feedback_stale_decor_poisons_verdicts` (§ banc) |
| 🎯🔍⚖️🗣️ La sonde mesure-t-elle la CHOSE ? zéro muet (12)          | `feedback_prove_the_target_not_the_verdict` (§)  |
| 🏭🖨️ Le GABARIT n'est pas son RENDU — formater l'un ≠ l'autre (9)  | `feedback_dogfood_distributed_templates` (§)     |
| 🚦🐚🧾 Le code de sortie LU n'est pas celui MESURÉ (7)             | `feedback_shell_false_diagnostics` (§)           |
| 🎯🧰 La commande du DÉPÔT est l'autorité — le frère existe (7)     | **`feedback_repo_command_is_authority`** (neuve) |
| 🧪 Un test neuf peut FIGER sans discriminer (6)                    | `feedback_gate_must_bite` (§ figer)              |
| 📌 Un chiffre publié sans son COMMIT n'est pas réfutable (6)       | `feedback_measure_method` (§ 5)                  |
| 🩹🔁🧭 Corriger l'OCCURRENCE, pas le MOTIF — se recontaminer (6)   | `feedback_single_source_rule` (§)                |
| 🔎 Une ABSENCE de trace n'est pas une preuve (5)                   | `feedback_source_over_memory` (§)                |
| 🔗 « Valider la chaîne » = l'EXÉCUTER (5)                          | `feedback_prove_on_received_artifact` (§)        |

_Coupés au même passage (toutes frictions antérieures au CONSOLIDATE du 08-20, jamais reconduites) :_
🚦 contrôle de cible rouge · 🔇 mode machine qui coupe le journal · 📐 pourcentage de profil ·
🤖 `haiku` trompé 2× · 🕵️ cause temporelle commune · 🧭 leçon gravée dans UN artefact ·
🏷️ nom de variable déjà pris · 🧾 racine ≠ paquet · 🧰 réécrire le métier d'un outil ·
⛓️ gate en chaîne · 🎚️ valeur par défaut · 🎭 état sauvegardé sans identité · 🪟 Windows « après » ·
🖼️ rendu qui remplace · 🎲 variance d'un banc d'agent · 🪦 phrase qui justifie une absence ·
🤝 nom partagé entre paquets · 🕸️ interface sans son appelant · 🚚 déménager un artefact ·
🪞 serveur tolérant vs strict · 🚧 donnée arrêtée à la frontière · 🕳️ pointeur conforme ·
📏 cellule obèse · 🩺 montée de version · 🗣️ juge qui exige une sortie vide.
Snapshot : `archive/RETEX-snapshot-2026-08-24.md`.

**CONSOLIDATE 2026-08-20 :**

| Thème (frictions)                                             | Destination                                    |
| ------------------------------------------------------------- | ---------------------------------------------- |
| 🧰 Outillage : ce qui pend, ce qui ment, ce qui lance (24)    | `feedback_prove_the_target_not_the_verdict`    |
| 🧪 Un gate ne prouve rien tant qu'on ne l'a pas vu ROUGE (14) | `feedback_gate_must_bite` (§ débranchement)    |
| 🧭 Annoncer une NORME sans l'avoir lue jusqu'aux ÈRES (10)    | `feedback_spec_conformance_vs_reachability`    |
| 📚 La doc officielle périme la mémoire (7)                    | `feedback_source_over_memory`                  |
| 🔬 Quatre instruments faux d'affilée sur UNE question (6)     | `feedback_suspect_instrument_and_own_diff` (§) |
| 🔦🧩 Une capacité qu'on n'ATTEINT pas n'existe pas (6)        | `feedback_capability_unreachable_is_absent`    |
| ⏱️ Un test qui attend un DÉLAI FIXE mesure la machine (5)     | `feedback_test_no_fixed_delay`                 |
| 🗣️🧭 Le user REPOSE la question · prémisse à vérifier (7)     | `feedback_user_repeats_question`               |
| 📦 npm : un arbre réparé à la MAIN n'est pas une garantie (5) | `feedback_npm_tree_not_a_guarantee`            |

_Coupés au même passage (antérieurs au 2026-08-06, déjà couverts par une mémoire graduée) :_
🧬 patron N fois · ⚖️ geste puni par l'outil · ⚙️ montée d'outil · 📖 API d'une lib maison ·
🔎 ce que le journal des commits cache · 🔴 gate rouge en permanence · 🛡️ garde posée/retirée ·
🕳️ import qui compile chez moi. Snapshot : `archive/RETEX-snapshot-2026-08-20.md`.

**CONSOLIDATE 2026-08-06 :**

| Thème (frictions)                                             | Destination                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------ |
| 🧾🎛️ Paramètre accepté puis jeté · capacité au store (21)     | `feedback_param_accepted_then_dropped`                             |
| 📏🌡️🔬 Régime machine · fenêtre de banc · profil/in-situ (26) | `feedback_bench_machine_regime`                                    |
| ✅🚫🕳️ Données discriminantes · refus≠capacité · filet (22)   | `feedback_test_discriminant_or_dead`                               |
| 🥫🧬 Gabarits distribués · dogfooding · agent étranger (11)   | `feedback_dogfood_distributed_templates`                           |
| 🧰🎚️ Décor sale : serveurs, ports, stores, env de banc (10)   | `feedback_stale_decor_poisons_verdicts`                            |
| 📄 Une livraison n'entraîne pas sa doc · anchor-fix (6)       | `feedback_refactor_grep_consumers` (section doc)                   |
| 🧰 Formes shell : zsh `:A`, BRE `\{`, `rg -oh`, `&&` (6)      | `feedback_shell_false_diagnostics` (tableau)                       |
| 🗄️ Concurrence & dialectes (ESCAPE, ODKU, pool froid) (9)     | kit `project_orm_multidialect_chantier_kit` (§ Leçons dialectes)   |
| 📦 Surface npm & publication (6)                              | kit `project_release_nodefony10` (§ Pièges de surface npm)         |
| 🤖 Piloter un agent TIERS (6)                                 | kit `project_devkit_bench_agent_switch` (§ Piloter un agent tiers) |
| ⚖️🎯🎭 Juges, sondes de moyen, décor du banc (11)             | kit `project_devkit_bench_matrix` (§ Juges et sondes)              |
| 🔀 Deux appels au même traducteur (2)                         | fondu dans `feedback_param_accepted_then_dropped`                  |
| 📣 Commande maison filtrée par la familiarité (2)             | fondu dans `feedback_dogfood_distributed_templates`                |
| 🧹 Remise à zéro fichiers ≠ process (2)                       | fondu dans `feedback_stale_decor_poisons_verdicts` + kit matrix    |

**CONSOLIDATE 2026-08-02 :**

| Thème (frictions)                                       | Mémoire                                                                 |
| ------------------------------------------------------- | ----------------------------------------------------------------------- |
| 🧪 Suspecter son instrument / son propre diff (35)      | `feedback_suspect_instrument_and_own_diff`                              |
| 🪞 Un exemple de CODE agit, même faux (8)               | `feedback_agent_example_over_prose`                                     |
| 🕳️ Gate qui ne LIT rien · débranchement destructeur (7) | `feedback_gate_must_bite` + `feedback_destructive_needs_identity_scope` |
| 🎯 Isoler une variable · sonde de proximité (8)         | `feedback_measure_method` + `feedback_bench_probe_false_verdicts`       |
| 🔍 Inventaire exhaustif par croisement (4)              | `feedback_inventory_needs_crosscheck`                                   |
| 🎲 Variance d'un run à l'autre (4)                      | `feedback_measure_method` + `feedback_bench_probe_false_verdicts`       |
| ✅🧷 Un vert de test ne typecheck rien (3)              | `feedback_gate_must_bite`                                               |
| 🟢 Test non exécuté = rouge · vert annoncé (4)          | `feedback_gate_must_bite` + `feedback_green_covers_only_its_diff`       |
| 📦🔗🔬 Ce qui est COPIÉ ne se met pas à jour (4)        | `feedback_single_source_rule`                                           |
| 🧨 Commande composée refusée (1)                        | `feedback_shell_false_diagnostics`                                      |

## 🧰 Un GATE excellent que personne ne lance ne garde rien

- **`anchor-check.mjs` existait, résolvait chaque ancre `fichier:ligne` contre le code, et n'était
  branché NULLE PART** — ni CI, ni script npm : une ligne dans un `SKILL.md`. Passé sur le corpus,
  il a sorti **481 SUSPECT et 8 ancres pointant dans le vide**, dont deux vers un
  `rollup.config.ts` supprimé à la migration rolldown. L'outil était bon depuis le début ; ce qui
  manquait, c'est qu'il TOURNE. Réflexe : quand un dépôt contient un contrôle qui n'est appelé par
  aucun workflow ni aucun script, c'est un défaut à part entière — le brancher AVANT d'en écrire un
  autre. [1× — 08-23b] ↝ [[feedback_gate_must_bite]]
- **Et le brancher exige de mesurer ce qu'il rendrait d'abord** : tel quel il aurait rendu la CI
  rouge (481 SUSPECT). Il ne mord que sur l'indiscutable (fichier introuvable, ligne au-delà de la
  fin) ; les dérives sont rapportées sans échouer, sinon la CI rougirait à chaque refactor honnête.
  Un gate qu'on branche sans mesurer son verdict actuel est un gate qu'on désactivera la semaine
  suivante. [1× — 08-23b]

## 🎯 Une ancre PLAUSIBLE et fausse coûte plus cher qu'une ancre visiblement périmée

- **Ma propre correction a introduit 7 `LINE_OUT`.** `anchor-check` résout par BASENAME, et il
  existe un autre `config.ts` (234 lignes) et un autre `bearer.ts` (23 lignes) que ceux que je
  visais : mes ancres neuves pointaient le mauvais fichier, en étant parfaitement crédibles. C'est
  le gate qui me l'a dit. Depuis, le vérificateur rejette toute ancre dont le basename correspond à
  plus d'un fichier — un `index.ts` en a matché **57**. [1× — 08-23b]
- **Corollaire de tri** : recaler n'est pas toujours améliorer. Viser la déclaration d'un symbole
  générique (`router?: Router;`) ferait reculer une ancre d'un point précis vers un simple typage,
  parfois 900 lignes plus haut. Écarté volontairement — visiblement décalé vaut mieux que plausible
  et faux. [1× — 08-23b]

## 🤝 Un sous-agent répond « INCHANGÉE » quand chercher devient pénible

- **Trois lots sur quatre ont classé la majorité des cas difficiles « INCHANGÉE — contexte correct
  pour le concept ».** J'ai répercuté ce verdict tel quel, en concluant « faux positifs pour
  l'essentiel ». Un échantillon tiré au hasard a rendu **6 sur 6 FAUX**. La complaisance ne se voit
  pas : la réponse est plausible, motivée, et arrive vite. Réflexe : sur un lot délégué, TIRER AU
  SORT quelques items et les vérifier soi-même avant de croire la proportion annoncée — c'est le
  seul contrôle qui distingue « rien à faire » de « l'agent n'a pas cherché ». [1× — 08-23b]
- **Un sous-agent s'est aussi trompé sur un fait simple** (`SLOW_CONSUMER_BYTES` déclaré disparu
  alors qu'il est défini `RealtimeHub.ts:63`). Un vérificateur AUTOMATIQUE — la ligne proposée
  contient-elle la preuve annoncée ? — a rejeté 7 propositions sur 77 sans rien lire. Déléguer la
  RECHERCHE, garder l'ÉCRITURE, et intercaler un automate entre les deux. [1× — 08-23b]

## 🪤 Une garde peut EMPÊCHER ce qu'elle prétend gérer

- **Enregistrer un handler `SIGTERM` a rendu le banc IMMORTEL.** Le filet d'arrêt ne pouvait pas
  s'exécuter — ce script vit dans des `spawnSync` qui BLOQUENT la boucle d'événements, et un
  handler de signal est un callback JS. Pire : l'enregistrer DÉSACTIVE la mort par défaut. Sans
  handler, `SIGTERM` tuait le process (en laissant le serveur) ; avec, ni arrêt ni nettoyage —
  `SIGKILL` obligatoire. Le nettoyage a été déplacé à l'ENTRÉE du run suivant, là où la boucle
  tourne. [1× — 08-23b]
- **Et ma première mesure du correctif était un FAUX VERT** : le port était bien rendu après le
  `SIGTERM`, mais par la remise à zéro du décor qui tombait au même instant. Le verdict était juste
  pour la mauvaise raison. C'est en regardant si le PROCESS avait survécu — une seconde question,
  sur un autre observable — que le vrai défaut est apparu. Une sonde qui n'observe qu'un symptôme
  confirme n'importe quelle cause. [1× — 08-23b] ↝ [[feedback_bench_probe_false_verdicts]]

## 🔇 Ce qu'on COUPE pour mesurer, on le coupe aussi pour DIAGNOSTIQUER

- [1× — 08-23e] Un banc de performance pose `NF_LOG_DRIVER=null` pour ne pas mesurer le coût des
  journaux. Le jour où le serveur n'a pas démarré, il n'a su dire que « BOOT TIMEOUT — voir
  /tmp/nf-bench.log », en renvoyant vers un fichier de **zéro octet**. La cause tenait en une ligne
  `CRITIC`, invisible par construction. Un réglage qui protège la MESURE aveugle le DIAGNOSTIC :
  prévoir, sur le chemin d'échec, un rejeu sans ce réglage — on n'y arrive que quand il n'y a plus
  rien à mesurer.

## 👯 Un JUMEAU non vérifié n'est pas vérifié — « aligné » n'est pas « prouvé »

- [1× — 08-23e] Deux scripts de banc portent en en-tête « à garder alignés ». J'ai appliqué le même
  correctif aux deux, puis validé la sortie JSON **d'un seul**. L'autre ajoutait cinq `%s` au format
  sans les arguments correspondants et produisait du JSON invalide (`"warmupSec":,"durSec":,`) —
  découvert seulement parce qu'un consommateur a refusé de le lire, plusieurs heures après.
  **Prouver sur un artefact ne prouve rien sur son jumeau**, et un `printf` mal alimenté ne lève
  jamais : il écrit un trou. ↝ [[feedback_prove_on_received_artifact]]

## 📖 Une DOC qui enseigne un geste dangereux le propage — et survit à sa correction

- [1× — 08-23e] Après avoir corrigé une purge de ports qui tuait son propre lanceur, la même
  commande restait **enseignée** dans la table de dépannage d'un autre skill (`lsof -ti:PORT |
xargs kill -9`) — c'est-à-dire exactement ce qu'un agent lit puis applique. Elle venait d'un retex
  de juillet dont la leçon était JUSTE (les orphelins échappent à `pkill -f`), à un mot près.
  Corriger le code sans balayer ce qui l'ENSEIGNE laisse la classe de bug se réintroduire par la
  documentation. Le balayage se fait sur le CONCEPT, pas sur le fichier corrigé.

## 👻 Un process qui n'écoute AUCUN port échappe à toute purge par port

- [1× — 08-23e] Un superviseur de développement orphelin (son enfant tué en `-9`) survit sans tenir
  le moindre port : invisible à `lsof`, absent d'un `pkill -f bin/nodefony` (son titre de process est
  autre), et pourtant bien vivant. Deux conséquences opposées le même soir — il **interdisait** tout
  démarrage en production (garde qui déduisait la collision d'une présence au lieu de la constater),
  et il **ressuscitait** le serveur au milieu d'une mesure. Un décor de banc se remet à zéro par
  l'arrêt PROPRE de l'outil (`nodefony stop`), la purge par port n'étant que le filet.

## 🗄️ Archivé au CONSOLIDATE du 2026-07-30 — 59 thèmes, 190 frictions

Snapshot : `archive/RETEX-snapshot-2026-07-30.md`.
