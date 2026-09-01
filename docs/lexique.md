---
title: "Lexique général — anglicismes & sigles de Nodefony"
navTitle: Lexique général
lang: fr
module: "global"
topic: lexique
section: "Architecture"
audience: [developer]
tags: [lexique, glossaire, vocabulaire, vulgarisation, anglicismes]
status: stable
updated: 2026-07-20
source: "docs/lexique.md"
---

# Lexique général Nodefony

📍 [Documentation](index.md) › **Lexique général**

> Le vocabulaire technique du projet, hors sécurité. **Le style reste « caveman »** (terme anglais
> court dans le code, les commits, les échanges) — ce lexique est le filet : chaque anglicisme/sigle
> employé a son entrée ici, développé + expliqué en clair (avec une analogie quand ça aide). Les
> termes propres à la **sécurité** vivent dans le [lexique sécurité](../src/packages/@nodefony/security/docs/lexique.md).

## 🧭 Deux niveaux de vocabulaire

Le vocabulaire vit à **deux niveaux** (même logique que la doc : transverse → racine, spécifique → module) :

- **Ce fichier (`docs/lexique.md`) = le GLOBAL** : termes transverses employés partout (opt-in, lazy,
  hot path, gate, ESM, DI…) + l'index ci-dessous.
- **`<module>/docs/lexique.md` = par MODULE** : les termes PROPRES à un module. Modèle de référence =
  [`@nodefony/security`](../src/packages/@nodefony/security/docs/lexique.md) (BFF, JWT, voters, OAuth…).

Règle de répartition : terme employé dans ≥2 modules → ici (global) ; terme spécifique à un module →
son lexique. **Tout anglicisme/sigle employé DOIT avoir une entrée** au bon niveau (style caveman gardé).
Tout nouveau module naît avec un `docs/lexique.md` (scaffold `create-module`).

### Index des lexiques par module

<!-- prettier-ignore -->
| Module | Lexique | Termes propres |
| --- | --- | --- |
| `@nodefony/security` | [docs/lexique.md](../src/packages/@nodefony/security/docs/lexique.md) ✅ | BFF, Zero Trust, JWT, OAuth, CSRF, RBAC, voters, WebAuthn, mTLS… |
| `@nodefony/realtime` | _à créer au fil de l'eau_ | backplane, fan-out, AIMD, peer, hub, JSON-RPC, coalescing |
| `@nodefony/http` | _à créer au fil de l'eau_ | trust proxy, keep-alive, CSWSH, requestId, traceparent, Range |
| `@nodefony/framework` | _à créer au fil de l'eau_ | resolver, controller, route, forward, décorateurs |
| autres modules | _au fil des sessions_ | — |

> On NE crée PAS les lexiques modules vides d'un coup : chacun naît quand on travaille le module
> (ou via le scaffold pour les nouveaux). Le global suffit en attendant.

## 📖 Lexique

### Style de travail & communication

| Terme                | Origine                | En clair                                                                                                                                           |
| -------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **opt-in**           | « choisir d'entrer »   | Désactivé par défaut, activé SEULEMENT si on le demande explicitement. (La sécu de Nodefony est opt-in : pas de zone déclarée → firewall inactif.) |
| **opt-out**          | « choisir de sortir »  | L'inverse : activé par défaut, désactivable si on le veut.                                                                                         |
| **caveman**          | « homme des cavernes » | Mon style imposé : zéro politesse, zéro intro/conclusion, phrases ultra-courtes, droit au code/à l'erreur. Le contraire du blabla.                 |
| **convention-frère** | terme maison           | Copier la recette d'un module/fichier déjà équipé AVANT d'inventer (ex. faire l'aire data plane comme `test-secure`). Cohérence > créativité.      |
| **gate**             | « portail / vanne »    | Un contrôle bloquant à passer avant de continuer (build vert, tests verts, `memory.test`). Une gate rouge = on ne commit pas.                      |
| **smoke test**       | « test de fumée »      | Vérif minimale que « ça démarre et le basique marche » (serveur up + 1 route) — avant d'aller plus loin. Pas exhaustif, juste « pas en feu ».      |
| **garde-fou**        | —                      | Une règle/vérif qui empêche une erreur connue de se reproduire (ex. « vérité = commits, pas le journal »).                                         |
| **béton**            | image                  | Un plan/contexte tellement détaillé et vérifié qu'une autre session ne peut pas dériver (ancrages `fichier:ligne`, décisions tranchées).           |
| **retex / RETEX**    | RETour d'EXpérience    | Le bilan d'une session (ce qui a coûté, les leçons). Vit dans `docs/session-retros/`.                                                              |
| **SAS**              | image (sas d'écluse)   | Le fichier `RETEX.md` : zone tampon des leçons récentes pas encore « gravées » en règle durable.                                                   |
| **TLDR**             | Too Long; Didn't Read  | « En résumé » : la conclusion en une phrase, avant le détail.                                                                                      |

### Architecture & patterns

<!-- prettier-ignore -->
| Terme | Origine | En clair |
| --- | --- | --- |
| **data plane** | « plan de données » | Les routes qui servent les VRAIES données d'admin (`/nodefony/*/api/*` : config, modules, métriques). Par opposition à la VUE qui les affiche. |
| **control plane** | « plan de contrôle » | La couche qui pilote/configure (par opposition au data plane qui transporte). Vocabulaire réseau/cloud. |
| **SPA** | Single Page Application | « Application monopage » : un seul HTML chargé, le JS (React/Vue) réécrit le contenu côté client SANS recharger la page (Studio en est une). Le routing vit côté client → le serveur renvoie la même **coquille** HTML pour toute URL profonde (**SPA fallback**), à charge du front d'afficher la bonne vue. En sécu : la coquille reste PUBLIQUE (l'AuthGuard front redirige) — on protège les DONNÉES (data plane), pas la page. |
| **seam** | « couture » | Un point d'extension **posé à l'avance** pour qu'une AUTRE couche s'y branche plus tard sans refonte. En pratique : un hook `null` par défaut → tant que rien n'est branché c'est un **no-op** 0-coût ; un module l'active en s'enregistrant. Permet de livrer les couches **dans l'ordre, sans dépendance inverse** : `@nodefony/realtime` pose ses 5 seams (authenticator au handshake, verrou de frame, audit, origin check) en P13 **sans connaître** la sécu, puis `@nodefony/security` (P6) vient les remplir — le module bas ignore le module haut, donc **pas de cycle d'import**. C'est ce qui rend l'archi en couches possible. (Numérotés « Seam #1…#5 ».) |
| **broker** | « courtier » | Un intermédiaire qui reçoit d'un côté et redistribue de l'autre (l'`AdminBroker` monte les routes data plane ; le hub WS distribue les frames). |
| **hub** | « moyeu » | Le point central d'où tout rayonne (le `RealtimeHub` : un seul endroit gère toutes les connexions WS et le fan-out). |
| **peer** | « pair » | Un bout de connexion bidirectionnelle (le `JsonRpcPeer` : même code des deux côtés, client et serveur). |
| **façade** | — | Une classe simple qui cache une mécanique compliquée derrière quelques méthodes (`RealtimeService` = façade du hub). |
| **registry / registre de fabriques** | — | Un annuaire `nom → fonction qui construit l'objet`. Permet d'ajouter une impl par son nom sans toucher le cœur (authenticators, backplanes). |
| **DI / IoC** | Dependency Injection / Inversion of Control | On ne fait pas `new Truc()` soi-même : le Container fournit les dépendances. « Ne m'appelle pas, je t'appellerai. » |
| **scope** | « portée » | La durée de vie d'un service : singleton (1 pour tout), par-requête, etc. (Aussi : un scope OAuth = un droit accordé — voir lexique sécu.) |
| **barrel** | « tonneau » | Le fichier `index.ts` qui ré-exporte tout le public d'un module en un point. ⚠️ un import dans un barrel charge tout le barrel (pas de tree-shaking ESM runtime). |
| **isomorphe** | « même forme » | Le MÊME code tourne côté serveur ET navigateur (le client realtime, la debug bar). Le pari de Nodefony. |
| **subpath** | « sous-chemin » | Un point d'entrée secondaire d'un package (`nodefony/realtime`, `nodefony/debugbar`) — importable séparément du paquet principal. |
| **manifeste** | — | La liste ordonnée et déclarative (ici `config.modules`) qui dit QUOI charger et dans quel ordre. |
| **bucket** | « casier / seau » | Compartiment de stockage **nommé**. Sessions : chaque contexte (`contextSession`) = un casier ; une session n'est trouvée que dans SON casier (le cookie ne porte qu'un id, le serveur choisit le casier selon la zone visitée). Cloud : un _bucket_ S3 = conteneur de fichiers nommé. |

### Cycle de vie & exécution

<!-- prettier-ignore -->
| Terme | Origine | En clair |
| --- | --- | --- |
| **boot** | « amorçage » | Le démarrage du framework (charge config → modules → services → serveurs). Le « boot-time » = ce qui ne coûte qu'une fois au lancement. |
| **runtime** | « temps d'exécution » | Pendant que ça tourne, par opposition au boot ou au build. Un coût « runtime » est payé à chaque requête. |
| **pipeline** | « tuyauterie » | La chaîne d'étapes que traverse une requête (createContext → resolve → firewall → controller → response). |
| **hot path / cold path** | « chemin chaud / froid » | Hot path = code exécuté à CHAQUE requête (la moindre alloc compte). Cold path = code rare (boot, handshake) où on peut se permettre plus. |
| **hook** | « crochet » | Un point où on peut accrocher du code à un moment précis du cycle (`onBoot`, `beforeResolve`, `afterAuth`). |
| **lifecycle** | « cycle de vie » | La suite ordonnée des phases (boot → ready → requêtes → arrêt) avec ses événements. |
| **handshake** | « poignée de main » | La négociation d'ouverture d'une connexion (WS : la requête `upgrade` HTTP qui établit le canal avant les messages). |
| **lazy** | « paresseux » | On ne crée/charge QUE au premier usage réel, jamais « au cas où ». Lazy alloc, lazy init, lazy import. Économie mémoire #1 de Nodefony. |
| **eager** | « empressé » | L'inverse : tout de suite, dès le départ. Évité dans le hot path. |
| **no-op** | « no operation » | Un appel qui ne fait RIEN (volontairement) et retourne sans effet. Souvent un défaut sûr ou un bypass 0-coût : `Session.readOnly` → `save()` no-op ; `setFrameAuthorizer(null)` → le verrou WS ne contrôle plus ; `RequestContext.set()` hors d'un scope ALS = no-op ; backplane `Loopback` = no-op (aucun pair). |
| **idempotent** | « même effet si répété » | Rejouer l'opération N fois = même état qu'une fois (poser un handler 2× ne le double pas). Rend un boot/câblage rejouable sans dégât. |

### Performance & mémoire

| Terme                    | Origine               | En clair                                                                                                                           |
| ------------------------ | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **fail-closed**          | « échoue fermé »      | En cas de doute/erreur → on REFUSE (sécurité : config invalide → tout le trafic rejeté). Le défaut sûr.                            |
| **fail-open**            | « échoue ouvert »     | En cas d'erreur → on LAISSE PASSER. Dangereux en sécu, parfois voulu ailleurs (dégradation).                                       |
| **fail-soft**            | « échoue en douceur » | En cas d'erreur → on continue en mode dégradé (un module qui ne charge pas n'empêche pas le boot).                                 |
| **GC**                   | Garbage Collector     | Le ramasse-miettes de Node : libère la mémoire des objets inutilisés. Trop d'allocations = pression GC = latence p99 dégradée.     |
| **heap**                 | « tas »               | La mémoire où vivent les objets JS. `heap delta` = combien de Mo en plus après N requêtes (un seuil dépassé = fuite suspectée).    |
| **backpressure**         | « contre-pression »   | Quand le producteur va plus vite que le consommateur ne peut absorber → il faut ralentir/jeter, sinon la mémoire explose.          |
| **throttling / backoff** | « brider / reculer »  | Limiter le rythme (throttling) en augmentant le délai à chaque échec (backoff). Anti-DoS / anti-bruteforce sur le login.           |
| **coalescing**           | « fusion »            | Regrouper plusieurs petits événements en un seul envoi (le canal `nodefony:syslog` envoie `{logs:[…], dropped}`, pas log par log). |
| **fan-out**              | « éventail sortant »  | Un événement entrant → N livraisons (1 publish → tous les abonnés du canal).                                                       |
| **O(1)**                 | notation Big-O        | « Coût constant » quel que soit le volume (une lecture de Map). ≠ O(n) qui grossit avec la taille. On vise O(1) sur le hot path.   |

### Réseau / temps réel

| Terme         | Origine               | En clair                                                                                                                        |
| ------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **payload**   | « charge utile »      | Le contenu réel d'un message (hors enveloppe/en-têtes). Le `params` d'un appel, le corps d'une requête.                         |
| **frame**     | « trame »             | Une unité de message sur la socket WS (une frame JSON-RPC = un appel, une notif ou une réponse).                                |
| **pub/sub**   | publish / subscribe   | Modèle « je publie sur un canal, ceux qui se sont abonnés reçoivent ». Découple émetteur et récepteurs.                         |
| **RPC**       | Remote Procedure Call | « Appeler une fonction à distance comme si elle était locale » (`socket.request("/path")` → résultat). Nodefony = JSON-RPC 2.0. |
| **backplane** | « fond de panier »    | La couche qui relie plusieurs process/pods entre eux (Redis, IPC) pour que le pub/sub marche en cluster.                        |
| **vhost**     | virtual host          | Plusieurs domaines sur un même serveur ; une zone peut cibler un `host` précis (`admin.exemple.com`).                           |
| **upgrade**   | « montée en version » | La requête HTTP spéciale qui transforme une connexion HTTP en connexion WebSocket (le handshake WS).                            |
| **polling**   | « scrutation »        | Demander en boucle « du nouveau ? » (l'inverse du push temps réel). Évité au profit du WS.                                      |

### TypeScript / build / modules

| Terme                      | Origine                   | En clair                                                                                                                     |
| -------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **ESM**                    | ECMAScript Modules        | Le système de modules moderne (`import`/`export`). Nodefony = ESM only, jamais `require()`.                                  |
| **CommonJS**               | —                         | L'ancien système (`require`/`module.exports`). Banni du projet.                                                              |
| **bundler**                | « empaqueteur »           | L'outil qui compile/assemble le code (ici Rollup). Produit le `dist/`.                                                       |
| **tree-shaking**           | « secouer l'arbre »       | Le bundler élimine le code mort (non importé). ⚠️ N'existe PAS au runtime ESM : un import d'un barrel charge tout le barrel. |
| **dist**                   | distribution              | Le dossier compilé (`dist/`) chargé au runtime — jamais le `.ts` source. Un `dist` périmé = cause #1 d'échec de session.     |
| **transpile**              | translate + compile       | Convertir le TS en JS (et/ou une version moderne en plus ancienne). esbuild/Rollup le font.                                  |
| **`.d.ts`**                | declaration types         | Fichier qui décrit les types sans code. Généré par Rollup chez nous — jamais écrit à la main (il dérive sinon).              |
| **peerDep / devDep**       | peer / dev dependency     | peerDep = dép. attendue mais fournie par l'app (pas embarquée) ; devDep = utile au dev/build seulement, pas au runtime.      |
| **duck-typing**            | « si ça fait coin-coin… » | Juger un objet sur ce qu'il SAIT FAIRE, pas son type déclaré (framework appelle `authFlow.login` sans importer security).    |
| **structural typing**      | —                         | TS compare les FORMES, pas les noms : un objet qui a les bons champs « est » compatible (`IRealtimeToken` ⊂ `IToken`).       |
| **narrowing**              | « rétrécissement »        | Affiner un type par des tests (`if (typeof x === "string")`) pour éviter `any` et accéder aux bons champs.                   |
| **`any` / `unknown`**      | —                         | `any` = « débranche le compilateur » (INTERDIT) ; `unknown` = « je ne sais pas encore, force-moi à vérifier » (autorisé).    |
| **decorator / décorateur** | —                         | Annotation `@truc` qui ajoute un comportement à une classe/méthode (`@route`, `@injectable`, `@IsGranted`).                  |
| **monorepo / workspace**   | —                         | Un seul dépôt contenant N paquets (`workspaces` npm). Chaque `@nodefony/*` est un workspace.                                 |
| **turbo (cache)**          | Turborepo                 | L'outil qui ne rebuild que ce qui a changé (cache). ⚠️ peut servir un dist/log périmé → `--force` ou `clean` au besoin.      |

### Tests & qualité

| Terme                 | Origine                     | En clair                                                                                                         |
| --------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **mock / stub / spy** | —                           | Mock = faux objet complet ; stub = fausse réponse ponctuelle ; spy = espion qui enregistre les appels.           |
| **fixture**           | « montage »                 | Données/état de départ préparés pour un test (un user de test, une DB en mémoire).                               |
| **flaky / flake**     | « instable »                | Un test qui passe/échoue aléatoirement (souvent : contamination entre tests, timing). À isoler, pas à ignorer.   |
| **non-régression**    | —                           | Vérifier que ce qui marchait marche TOUJOURS après un changement (la suite `test:integration`).                  |
| **E2E**               | End-to-End                  | Test « bout en bout » sur le système réel (serveur lancé), par opposition à unitaire (une fonction isolée).      |
| **banc**              | terme maison (banc d'essai) | Un fichier/dispositif de test dédié à un scénario (le « banc test-secure » = le terrain de jeu de la zone sécu). |
| **coverage**          | « couverture »              | % du code exécuté par les tests. Provider v8 chez nous.                                                          |

### Cloud-native / déploiement

<!-- prettier-ignore -->
| Terme | Origine | En clair |
| --- | --- | --- |
| **cloud-native** | — | Conçu pour le cloud : 1 process = 1 pod/container, scaling par l'orchestrateur, logs sur stdout. (Nodefony post-PM2.) |
| **pod / container** | Kubernetes / Docker | L'unité déployée : une instance isolée de l'app. On en lance N pour scaler. |
| **orchestrateur** | — | Le chef d'orchestre des pods (Kubernetes, Docker Swarm…) : il démarre, surveille, redémarre, scale. |
| **HPA** | Horizontal Pod Autoscaler | Le mécanisme k8s qui ajoute/retire des pods selon la charge. |
| **liveness / readiness** | sondes k8s | liveness = « suis-je vivant ? » (sinon redémarre) ; readiness = « prêt à recevoir du trafic ? ». |
| **cluster** | « grappe » | Plusieurs process Node sur une même machine (`nodefony cluster -w N`), reliés par le backplane. |
| **worker** | « ouvrier » | Un process de travail dans un cluster (`-w 4` = 4 workers). |
| **stdout / stderr** | flux de sortie standard | Les sorties console (normale / erreur) → collectées par l'infra, pas écrites en fichier en prod. |

## ⚠️ Pièges — les faux-amis du vocabulaire

Un même mot recouvre parfois deux sens : les confondre coûte cher.

| Faux-ami                        | Les deux sens                                                                                                                                                                                                              |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **scope**                       | **DI** = durée de vie d'un service (singleton, par-requête). **OAuth** = un droit accordé à un jeton (`orders:read`, voir [lexique sécu](../src/packages/@nodefony/security/docs/lexique.md)). Deux axes sans rapport.     |
| **tree-shaking**                | S'applique au **build** (le bundler retire le code non importé), **jamais au runtime ESM** : à l'exécution, importer un barrel charge TOUT le barrel. Ne pas compter dessus pour alléger le hot path.                      |
| **fail-open / -closed / -soft** | Trois réactions distinctes à une erreur : **closed** = refuse (défaut sûr en sécu), **open** = laisse passer (dangereux en sécu), **soft** = continue en mode dégradé. Choisir explicitement, jamais par défaut implicite. |
| **`any` / `unknown`**           | `any` **débranche** le compilateur (INTERDIT dans Nodefony) ; `unknown` **force** à vérifier avant usage (autorisé). Un `unknown` mal relu ne devient pas un `any` — il refuse de compiler.                                |

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [Toute la documentation](index.md)
- 📖 [Lexique sécurité](../src/packages/@nodefony/security/docs/lexique.md) — BFF, JWT, OAuth, WebAuthn, voters, CSRF… (le niveau MODULE)
- 🧭 [Vue d'ensemble](architecture/vue-ensemble.md) — l'architecture où ces termes prennent place
- 🚀 [Démarrer](demarrer.md) — le parcours de prise en main
