---
adr: 30
title: Services portés par le superviseur de développement — un hôte par service, un plan déclaratif, des états poussés
lang: fr
date: 2026-11-23
status: accepted
deciders: [Christophe CAMENSULI]
tags: [dev, supervisor, ipc, vite, ai, performance, security, windows]
---

# ADR-0030 — Services portés par le superviseur de développement

## Statut

Accepté (#692). Complète l'ADR-0013 (§1 propriétaire unique du terminal, §6 canal `nf-dev`) et
réalise, pour le développement, le « lifecycle supervisé » de l'ADR-0004.

## Contexte

`nodefony development` relance le serveur enfant à chaque sauvegarde d'un fichier backend. Les
serveurs Vite sont lancés PAR l'enfant (`ViteProcessSupervisor.ts#ViteProcessSupervisor`, depuis
`FrontendService.ts#FrontendService.startFamily`), dans son groupe de process : `DevSupervisor.ts#DevSupervisor`
les tue avec lui. Coût : ~2,8 s par sauvegarde et un Vite froid. L'audit de #691 établit que rien
de ce que Vite lit ne dépend de l'enfant pour une modification backend.

Le même besoin reviendra plus fort : un modèle local (Ollama, `llama.cpp server`, vLLM — ADR-0004)
met des secondes à des dizaines de secondes à démarrer. Ce qui se construit ici n'est donc pas
« Vite dans le parent » : c'est **un service de longue durée porté par le superviseur**, dont Vite
est la première instance.

Aujourd'hui Vite est lancé par sa LIGNE DE COMMANDE, et son état se DEVINE en lisant sa sortie :
expressions sur des libellés anglais (`ViteProcessSupervisor.ts#isPortInUseMessage`,
`ViteProcessSupervisor.ts#ViteProcessSupervisor.waitReady`), qu'une version de Vite peut changer sans prévenir.

Contraintes qui tranchent :

- Le superviseur **n'importe jamais le code du noyau** (`devChannelBase.ts#DEV_CHILD_ENV`) ; or
  `ViteProcessSupervisor` importe le barrel `nodefony`.
- `--no-watch`, `start` et `production` gardent Vite possédé par le serveur.
- Le relais `/_vite/<famille>/` reste dans l'enfant (ports 5151/5152, pipeline HTTP) : le déplacer
  ferait booter le noyau au parent, contraire à l'ADR-0013.
- **Vite ne doit jamais pouvoir faire tomber, geler ou salir le superviseur**, propriétaire du terminal.

## Normes et antériorités

| Antériorité                                                                                                                                                                                                                 | Ce qu'on en prend                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vite 8, API JavaScript (`createServer`, `listen`, `resolvedUrls`, `customLogger`, `close`)                                                                                                                                  | « prêt » et port réel par l'API, jamais par la lecture d'une sortie                                                                                                                                                                       |
| Vite 8, `server.forwardConsole` (défaut : `true` si un agent IA est détecté par `std-env`), `clearScreen` (défaut `true`)                                                                                                   | défauts qui changent selon l'environnement ou écrivent dans NOTRE terminal → fixés par nous                                                                                                                                               |
| Vite 8.4 (bêta 1), verrou de commande (vitejs/vite#23624) : un second `vite` pour le même projet SORT en nommant le PID du premier ; verrou sous `cacheDir/lock`, posé par un greffon que SEULE la ligne de commande ajoute | la ligne de commande lancée à chaque relance se heurterait au verrou d'un Vite pas encore mort, ou d'un Vite tué net (vérifié par l'heure de démarrage du process : `ps`, PowerShell sous Windows) ; l'API JavaScript n'y est pas soumise |
| systemd `sd_notify(3)` (`READY=1`, `STATUS=`)                                                                                                                                                                               | le service ANNONCE qu'il est prêt ; le superviseur ne sonde pas à sa place                                                                                                                                                                |
| Docker Compose, étiquette `com.docker.compose.config-hash`                                                                                                                                                                  | `up` ne recrée QUE les services dont l'empreinte de config a changé                                                                                                                                                                       |
| Kubernetes, boucle de réconciliation                                                                                                                                                                                        | on déclare l'état voulu, le contrôleur converge : démarrer, remplacer, retirer                                                                                                                                                            |
| JSON-RPC 2.0                                                                                                                                                                                                                | requête corrélée par un `id` ; la réponse porte l'`id` de sa requête                                                                                                                                                                      |
| ADR-0013 §6 (`command-request`)                                                                                                                                                                                             | même forme de corrélation sur `nf-dev`, sens inverse                                                                                                                                                                                      |
| ADR-0004                                                                                                                                                                                                                    | backend d'inférence = sous-process supervisé sur le patron du superviseur Vite                                                                                                                                                            |

## Décisions

### D1 — Un service = un HÔTE : un process Node qui pilote le service par son API

Un module hôte, fourni par le paquet du service, est lancé par `fork` avec un canal IPC. Pour
Vite : un fichier de `@nodefony/frontend` qui appelle `createServer` de la Vite DE L'APPLICATION
(résolue depuis le `cwd`, comme `ViteProcessSupervisor.ts#resolveViteBin`), `listen()`, et annonce
`ready` avec le port lu dans `resolvedUrls`. Un hôte par famille : l'isolement des familles
(un greffon Angular qui plante n'emporte pas React) est conservé, et le nombre de process est
INCHANGÉ — l'hôte remplace le process de la ligne de commande de Vite.

Pourquoi : « prêt », port occupé (`listen` rejette, `strictPort` posé) et journaux
(`customLogger`) deviennent des évènements typés. Les expressions sur la sortie disparaissent, et
avec elles la dépendance aux libellés d'une version de Vite. La 8.4 le confirme : son verrou de
commande ne s'applique qu'à la ligne de commande — rester sur elle, c'était hériter d'une sortie
anticipée que nos expressions auraient lue comme un plantage, puis relancée en boucle.

Précisé à l'implémentation (source de Vite 8.3.8 et 8.4.0-beta.1, `httpServerStart`) : avec
`strictPort`, un port pris rejette `listen` par `new Error("Port N is already in use")` — un
texte, SANS code. L'hôte ne le lit donc pas : il SONDE le port lui-même par `node:net`
(`EADDRINUSE`, et `EACCES` sous Windows) avant `createServer`, et lit le port réel sur la socket
(`httpServer.address()`). Il charge le protocole par le sous-chemin `nodefony/held`, sans
importer le paquet `nodefony` entier (~1 ms contre ~330 ms, mesuré) : un hôte démarre à chaque
relance de son service.

### D2 — Un seul TENEUR d'hôte, pour tous les modes

La mécanique qui lance un hôte, attend son `ready`, le relance avec recul, sonde sa santé et
l'arrête est UNE classe du cœur (`service/dev/`, sans import du noyau — le superviseur peut donc
la charger). **1 règle = 1 implémentation** : le superviseur l'emploie en mode porté, l'enfant
l'emploie lui-même en `--no-watch`, `start` et `production`. Le même hôte tourne dans les deux cas ;
seul change le process qui le tient. `ViteProcessSupervisor` devient un adaptateur
`IViteSupervisor` mince sur ce teneur.

### D3 — L'enfant déclare un PLAN par propriétaire ; le superviseur réconcilie

À chaque démarrage, l'enfant envoie l'état voulu pour un propriétaire (`frontend`, demain `ai`) :
la liste complète de ses services, chacun `{ key, module, fingerprint, spec, cwd, env, tuning? }`
(`devChannel.ts#IHeldServiceDeclaration`). Clé neuve → démarrée ; empreinte changée → SEULE cette
instance remplacée, la nouvelle ne démarrant qu'après la mort de l'ancienne (même port) ;
identique → gardée, et relancée si elle était `errored` ; clé absente → arrêtée. Un plan plutôt
qu'un « assure ce service » unitaire : une famille retirée de la config resterait sinon vivante
pour toujours, puisque le nouvel enfant ne la connaît plus. `env` ne porte que les variables
AJOUTÉES à l'environnement du superviseur : l'enfant ne recopie pas le sien sur le canal. Une clé
tenue par un autre propriétaire est refusée. Le registre qui réconcilie :
`heldServices.ts#HeldServiceRegistry` ; il ne nomme aucun service et ne lit aucune `spec`.

Le plan part COMPLET, en un message : un propriétaire dont les services se préparent chacun de
son côté (une config Vite par famille, écrite de façon asynchrone) annonce d'abord ses clés
(`expect`), chaque service s'y déclare ou s'en retire, et le plan part quand plus aucune clé
n'est attendue (`heldServicesClient.ts#HeldServicesClient`). Envoyé par morceaux, chaque plan
partiel arrêterait les services que le suivant redemande.

Un propriétaire qui DISPARAÎT (module retiré de la configuration, front sans entrée) n'envoie
plus jamais de plan : rien ne lui ferait arrêter ses hôtes. Le serveur envoie donc, une fois par
démarrage et juste avant `onPostReady`, la liste des propriétaires qui se sont déclarés
(`held-owners`, `supervisorLink.ts#SupervisorLink.reportHeldOwners`) ; le superviseur arrête les
services de tout autre propriétaire (`HeldServiceRegistry.retainOwners`). Se déclarer, c'est
obtenir son client (`kernel.heldServices(owner)`) — de façon SYNCHRONE pendant
`onServersReady`, avant tout `await`. La liste ne démarre rien et ne touche pas aux services
d'un propriétaire qu'elle nomme : son plan peut arriver après elle.

### D4 — La relance se décide sur une EMPREINTE émise par l'enfant

`crypto.hash("sha256", …)` de ce qui exige un NOUVEL hôte : le module hôte, la `spec` (chemin
du `.mjs`, adresse, port demandé, mode), les variables ajoutées, le `cwd`, **et la version
installée de Vite et de chaque paquet de greffon de la famille** (lue une fois par démarrage de
l'enfant, depuis le `cwd`). Jamais la catégorie du fichier modifié : modifier le `index.ts` d'un
module peut changer ses entrées. Le parent compare deux chaînes ; une `spec` qui change sans
changer l'empreinte n'est pas relue.

Pourquoi les versions : quand Vite se relance lui-même, il réimporte sa config sous un nom neuf
(source 8.3.8, `loadConfigFromBundledFile` : fichier temporaire `…timestamp-<n>.mjs`), mais les
paquets de `node_modules` y restent EXTERNES (`bundleConfigFile`) — le chargeur ESM de Node les
garde en cache, sous la même URL. Après la mise à jour d'un greffon ou de Vite, une relance
interne garderait l'ancien code, sans un mot. Le texte du `.mjs` ne le révèle pas non plus (il ne
change pas) : seule la version le dit, et elle impose alors un process neuf.

**Symbiose avec Vite — le texte de `vite.config.generated.mjs` est HORS empreinte.** Vite
surveille son fichier de config et se relance lui-même, DANS son process, quand il change
(source 8.3.8 : `handleHMRUpdate` → `restartServerWithUrls` → `restartServer`) : même
`inlineConfig` (donc mêmes remparts et même port, `strictPort`), environnements précédents
repris (`previousEnvironments`), pile de middlewares conservée ; un échec garde l'ancien serveur
(« server restart failed »). Ajouter une entrée à une famille ne coûte donc ni `fork` ni
démarrage de Node (~60 ms), ni chargement de Vite (~111 ms, médiane de 7, Vite 8.3.8) : seule cette
famille se relance, et par Vite. L'hôte n'est remplacé que pour ce que Vite ne peut pas
reprendre seul. Le titre du process (`nodefony-vite[…]`), qui suit les entrées, reste hors
empreinte pour la même raison : il se met à jour au prochain remplacement.

Mettre le texte DANS l'empreinte ne serait pas seulement plus lent, ce serait faux : l'enfant
réécrit le `.mjs` avant d'envoyer son plan, Vite entame sa relance interne, puis le plan arrive
avec une empreinte neuve et le superviseur tue ce Vite EN PLEINE relance pour en forker un
autre — deux relances au lieu d'une, et une course entre elles.

### D5 — Les états sont POUSSÉS ; l'enfant lit un instantané

Le superviseur pousse `held-state { key, state, data }` à chaque changement, et rejoue l'état
courant de chaque clé à la réception d'un plan (nouvel enfant). L'enfant garde par clé un
instantané figé, remplacé en bloc. `status()` = lecture de champ : **zéro allocation, zéro IPC**.
C'est le chemin chaud : le relais lit `TemplateHelper.devTarget()` → `status()` à chaque requête
relayée, et une page en charge des centaines. Le plan porte un `id` entier croissant, acquitté par
`held-plan-ack` ; un plan refusé l'est en nommant la cause. L'acquittement est décidé de façon
SYNCHRONE ; démarrages et arrêts suivent, et leurs états partent par `held-state`. Une instance
remplacée ou retirée ne parle plus au propriétaire : il verrait sinon « arrêté » pour un service
qu'il vient de redemander.

Ce que l'IPC de Node impose (doc et source `lib/internal/child_process.js`, Node 26) :

- **Tout envoi porte un rappel** (`devChannel.ts`, `heldChannel.ts#IGNORE_SEND_ERROR`, partagé) :
  sans lui, un échec d'écriture (pair sorti) est émis en `'error'` au tick suivant — exception non
  rattrapée sans écouteur, et le superviseur n'en pose pas sur le serveur.
- **Sérialisation JSON** (`JSON.stringify` + `\n`, une ligne lue = un `JSONParse`, livraison par
  `nextTick`) : ~4 Ko par démarrage de l'enfant pour trois familles, loin du seuil de
  contre-pression (`send` rend `false` au-delà de 128 Kio en attente). La sérialisation
  `advanced` n'apporte rien à des objets JSON et n'est pas plus rapide (doc).
- **Un message reçu sans écouteur `'message'` est mis en file** (`kPendingMessages`) puis rejoué :
  un `held-state` n'est jamais perdu, mais la file n'a pas de borne — l'enfant écoute AVANT
  d'envoyer son premier plan.

### D6 — Vite ne peut ni faire tomber, ni geler, ni salir le superviseur

| Menace                                                                  | Rempart                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plantage de Vite ou d'un greffon                                        | process séparé ; l'hôte meurt seul, ses clés passent `crashed` ; son GROUPE est vidé à sa sortie (POSIX, `devProcess.ts#signalExitedGroup`) : un descendant ne garde pas le port de la relance                                                                                         |
| Hôte condamné qui tarde à sortir (échec, relance en vol)                | tué dès l'échec ; un nouvel hôte ne naît qu'après la MORT du précédent ; une décision prise sous une époque passée (`start`/`stop`/`kill` depuis) n'a plus lieu                                                                                                                        |
| Vite qui prend le clavier ou le terminal                                | `stdin` ignoré, aucun TTY ; `bindCLIShortcuts` jamais appelé                                                                                                                                                                                                                           |
| Vite qui efface l'écran                                                 | `clearScreen: false` posé par l'hôte, prioritaire sur la config ; et le terminal n'honore `ESC[2J` que venu du serveur — d'une autre source, la séquence est retirée                                                                                                                   |
| Vite qui déverse la console du navigateur (défaut changeant sous agent) | `server.forwardConsole` FIXÉ par l'hôte (désactivé ; la config inline prime, la config du module ne le rouvre pas)                                                                                                                                                                     |
| Déluge de journaux                                                      | par les tubes, jamais par l'IPC ; une ligne sans fin est livrée par morceaux de 64 Kio au plus ; ingestion assainie du superviseur (plafond global, puis par canal avec #903)                                                                                                          |
| Message IPC forgé ou démesuré                                           | garde unique, longueurs bornées (raison 4 096, donnée 16 Kio de JSON — sur `nf-held` ET dans l'instantané de `nf-dev`) ; seul l'hôte COURANT est lu, un `ready` hors de la phase qui l'a demandé (arrêt en cours) est refusé ; un hôte ne peut que RAPPORTER un état, jamais commander |
| Tempête de relances                                                     | recul exponentiel et plafond → `errored`, plus aucune relance avant le plan suivant                                                                                                                                                                                                    |
| Boucle d'évènements gelée dans l'hôte                                   | preuve de vie par `ping`/`pong` sur l'IPC (elle prouve la boucle, pas le service) → arbre tué, relance ; le kill est renvoyé tant que l'hôte ne sort pas ; les preuves manquées d'affilée sont publiées (`missedPongs`, `healthFailures` côté Vite) AVANT la mise à mort               |
| Superviseur tué net (`kill -9`)                                         | l'hôte écoute `disconnect` de son IPC → ferme Vite et sort : aucun orphelin. Limite : un hôte dont la boucle est GELÉE ne voit pas la perte du canal                                                                                                                                   |
| Héritage d'environnement                                                | l'hôte ne reçoit pas `NF_DEV_CHILD` (il se croirait l'enfant du superviseur)                                                                                                                                                                                                           |
| Ctrl-C au terminal qui atteint l'hôte (Windows, sans groupes)           | `serveHeldService` ignore `SIGINT` pour TOUT hôte : sa vie appartient au teneur, qui l'arrête par le canal                                                                                                                                                                             |
| Hôte invisible à `nodefony status` / `stop`                             | titre `nodefony-held[<clé>]` posé par `serveHeldService` au `start` (la clé voyage dans le message), affinable par le service (`nodefony-vite[…]`) ; rôle `held` ; tout hôte, détaché par son teneur, est une RACINE à l'arrêt (`devProcess.ts#rootProcesses`)                         |
| Hôte muet faute de se reconnaître point d'entrée                        | `serveHeldServiceIfMain(import.meta, …)` lit `import.meta.main`, jamais `argv[1]` comparé à l'URL du module — par un lien symbolique, cette comparaison échouait et l'hôte sortait sans servir ni rien dire                                                                            |

### D7 — Fin de session : le teneur tue SES arbres et attend leur mort

Ctrl-C → chaque hôte est arrêté par `devProcess.ts#signalProcessGroup` (seule implémentation,
qui sait l'absence de groupes sous Windows), puis le superviseur attend la mort effective
(`devProcess.ts#waitAllDead`) avant de rendre la main. L'attente est BORNÉE : un process qui
survit à SIGKILL est nommé dans `lastError`, il ne suspend pas la fin de session. Elle porte sur
le chef de groupe ; ses descendants reçoivent le signal du groupe (POSIX). Sous Windows,
`taskkill /T` ne part que d'un PID vivant : l'arbre d'un hôte déjà sorti y est inatteignable, et
c'est au service hôte de tuer ses propres enfants (`IHeldServiceImpl.stop`).

Le second Ctrl-C (sortie d'urgence) passe par `HostHolder.kill`, synchrone : le signal vise le
process VIVANT que le teneur tient, jamais le PID d'un instantané — rendu au système, celui-ci
peut désigner un étranger.

Sous `nodefony development`, l'hôte Vite est PORTÉ par le superviseur
(`HeldViteSupervisor.ts#HeldViteSupervisor`, choisi quand `kernel.heldServices("frontend")` rend
un client) : il relève de son registre, de sa preuve de vie et de cette fin de session. Un hôte
figé est tué par la preuve de vie, quel que soit l'état du serveur.

Tenu par le SERVEUR (`--no-watch`, `frontend:dev`, tout lancement sans superviseur :
`ViteProcessSupervisor.ts#ViteProcessSupervisor`), son hôte est détaché lui aussi (POSIX) :
il s'arrête avec le serveur — par son teneur, ou à la perte du canal. Un hôte FIGÉ à ce
moment-là survit au serveur ; `nodefony stop` le vise, puisqu'il est une racine.

### D8 — Journaux : par les tubes, jamais par l'IPC

La sortie de l'hôte (son `customLogger` écrit sur sa sortie standard) entre dans le terminal du
superviseur par ses tubes, source `held` (`devTranscript.ts#TranscriptSource`) : le superviseur
ne nomme aucun service, et chaque ligne porte déjà le sien (`[vite:<famille>]`). Hors rendu
humain, elle part telle quelle sur la sortie du superviseur, là où le serveur l'aurait écrite.
Le modèle en canaux de #903 la rangera dans `vite:<nom>` (la clé du service est déjà livrée avec
chaque lot de lignes) : seul l'appel d'ingestion changera.

### D9 — Comment un backend d'inférence s'y branche

`@nodefony/ai` fournit un module hôte qui lance le serveur d'inférence et annonce `ready` avec son
adresse. L'enfant déclare un plan pour le propriétaire `ai` :
`{ key: "llm:<modèle>", module: <module hôte>, fingerprint: hash(modèle, paramètres), spec, cwd, env }`. Le
modèle se charge une fois par session, survit à chaque sauvegarde, n'est relancé que si sa
configuration change. Rien du cœur n'est à ajouter.

## Types natifs et performance

| Structure                  | Type retenu                                                     | Pourquoi                                                                                       | Mesuré                                                         |
| -------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Hôtes tenus (parent)       | `Map<string, HeldEntry>` (teneur + propriétaire + empreinte)    | clé texte, ajouts ET retraits au fil des plans (`delete` fait passer un objet en dictionnaire) | non — hors chemin chaud                                        |
| `HostHolder`               | classe à champs déclarés au constructeur                        | forme stable                                                                                   | —                                                              |
| Plans en vol               | `Map<number, …>`, `id` entier croissant (smi)                   | retrait à chaque acquittement                                                                  | —                                                              |
| Instantané d'état (enfant) | objet figé remplacé en bloc                                     | lecture O(1) sans allocation sur le relais                                                     | non — `status()` rend le même objet entre deux états (éprouvé) |
| Empreinte                  | `crypto.hash` en un coup, une fois par famille et par démarrage | hors chemin chaud                                                                              | non                                                            |
| Démarrage de Vite          | API JavaScript au lieu de la ligne de commande                  | ni analyse d'arguments ni lecture ligne à ligne de la sortie                                   | **A/B** démarrage à froid, médiane de 7                        |
| Premier chargement         | `server.warmup.clientFiles` = les fichiers d'entrée déclarés    | transformés d'avance, sans cascade                                                             | **A/B** premier chargement ; retenu seulement s'il gagne       |

## Hors périmètre

La connexion HMR coupe encore à chaque redémarrage de l'enfant (le relais vit dans l'enfant) : la
page se recharge une fois. Le gain est ~2,8 s et un Vite chaud, pas un HMR ininterrompu.

## Fini quand

- Le contrat (`held-plan`, `held-plan-ack`, `held-state`) est typé dans `devChannel.ts#DevChannelMessage`,
  et l'ADR-0013 §6 y renvoie.
- `dev-restart-cycle.mjs <fichier-backend> 5` : PID des Vite identiques avant et après ; comparaison
  d'empreinte débranchée → les PID changent (garde vue mordre).
- Une entrée ajoutée à une famille → seule cette famille relancée, par Vite lui-même (PID de
  l'hôte inchangé) ; une famille retirée → arrêtée.
- Version de Vite ou d'un greffon changée → l'hôte de la famille est remplacé (PID neuf).
- Chaque rempart de D6 a un test vu rouge en débranchant la ligne qu'il garde.
- `--no-watch`, `start`, `production` : tests existants verts, Vite possédé par le serveur.
- Windows (job CI) : après Ctrl-C du superviseur, aucun process Vite ni hôte ne survit.
