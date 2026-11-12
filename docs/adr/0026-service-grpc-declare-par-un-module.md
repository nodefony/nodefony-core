---
adr: 26
title: Service gRPC — un point d'entrée déclaré par un module, servi par le pipeline
lang: fr
navTitle: Service gRPC
date: 2026-11-11
status: accepted
deciders: [Christophe CAMENSULI]
tags: [grpc, connect, http2, design, compatibility]
---

# ADR-0026 — Service gRPC : un point d'entrée déclaré par un module, servi par le pipeline

## Statut

Accepté (2026-11-11), décision par décision (D1 à D13) avec l'auteur, après une relecture côte à
côte avec ADR-0021 et ADR-0022 et un contradicteur indépendant (21 constats, corrigés ici).
Annoncé par [ADR-0021](0021-temps-reel-evenement-et-livraisons.md) (« l'ADR de gRPC naîtra avec
l'Epic #694 »). Instruit par le ticket #695 (Epic #694) ; chaque décision porte sa ligne datée.
Jugé contre le catalogue [`scenarios/grpc.md`](scenarios/grpc.md) : matrice en fin de document.
La surface naît `@experimental` ([politique de compatibilité](../guides/compatibilite.md),
« Surfaces expérimentales »).

**Précise deux ADR acceptés**, par une ligne datée dans chacun (accord de l'auteur, 2026-11-11) :

- [ADR-0021](0021-temps-reel-evenement-et-livraisons.md) : le transport se charge au démarrage
  quand un service est déclaré, et non au premier appel (D12) ; à l'arrêt, les flux longs (SSE,
  octets, gRPC) reçoivent une fin au lieu d'être détruits (D8) ; le pont #745 hérite d'une
  sérialisation par appel (« Contrôle de non-blocage », plus bas).
- [ADR-0022](0022-socket-temps-reel.md) : #694 n'amène protobuf qu'en pair facultatif de http et
  framework, jamais au client ; la preuve « poids de protobuf dans `nodefony/client` » ne lui
  revient pas (D12).

## Contexte

Le POC #690 a servi un service gRPC dans le pipeline HTTP/2, sans second serveur, par un
contrôleur écrit à la main (`src/modules/test/nodefony/poc/grpc/GrpcPocController.ts`) : une route
`bodyStream`, le délai par flux désarmé, l'adaptateur `@connectrpc/connect-node` chargé au premier
appel et appelé sur la requête et la réponse brutes de Node. Une application ne doit pas réécrire
ce geste : elle DÉCLARE un service, le framework le sert sur ses ports (5152 TLS, 5153 h2c ; 5151
pour gRPC-Web et Connect), sous le pare-feu.

ADR-0021 a déjà rangé les morceaux : le **transport** (adaptateur, corps en flux, délai désarmé,
statut dans les trailers) est une primitive de `@nodefony/http`, au rang de `SseStream` ; le
**pont vers le hub** vit dans `@nodefony/realtime` (#745).

## Normes et antériorités

Corpus hors ligne : `.claude/skills/nodefony-rfc/references/grpc/` (index `README.md`).

- **gRPC sur HTTP/2** (`grpc-PROTOCOL-HTTP2.md`) : `Path → ":path" "/" Service-Name "/" {method
name}` — la clé d'aiguillage d'un appel est dans l'URL, sensible à la casse ; le statut part
  toujours dans les trailers ; une erreur immédiate est une réponse Trailers-Only ; un
  `content-type` qui ne commence pas par `application/grpc` reçoit 415.
- **Protocole Connect** (`connect-protocol.md`) : unaire en `POST`, ou en `GET` pour les seules
  méthodes annotées `idempotency_level = NO_SIDE_EFFECTS`.
- **Correspondance HTTP → gRPC** (`grpc-http-grpc-status-mapping.md`) : un client qui reçoit un
  statut HTTP autre que 200 le traduit (401 → `UNAUTHENTICATED`, 403 → `PERMISSION_DENIED`) — un
  serveur conforme rend lui-même le statut gRPC.
- **Intercepteurs et porte d'entrée de connect-node** (`connect-node-interceptors.md`) :
  `requestGate` décide avant la lecture du corps. Écarté par D5 (point 2) : le pipeline de
  Nodefony décide déjà avant la lecture du corps, et un seul écrivain rend tous les refus.
- **Antériorités** (relues aux sources le 2026-11-11) : trois familles de frameworks serveur.
  Une ligne d'enregistrement explicite de la classe de service ; une annotation à nom figé sur la
  classe, en singleton, le contexte de requête actif pendant l'appel ; un contrôleur dont les
  méthodes portent un décorateur de méthode gRPC. Dans les trois, l'autorisation déclarative de la
  classe ou de la méthode, et les gardes des routes HTTP, s'appliquent à l'appel gRPC.
- **Bornes par défaut des implémentations de référence** : 4 Mio par message reçu, aucune borne à
  l'émission (grpc-go, `server.go` ; grpc-js, `constants.js`).

Le même critère range les autres protocoles du framework : la clé d'un appel MCP est dans le
corps JSON-RPC, sur une seule route (crochet de module `getMcpTools`, ADR-0017) ; celle d'une action
temps réel est dans la trame (`RealtimeController`). Celle d'un appel gRPC est dans le CHEMIN :
**une méthode gRPC est une route.**

## Décisions

### D1 — La forme de la déclaration

**Décision (validée par l'auteur le 2026-11-11, tranchée par délégation après recontrôle et un
contradicteur indépendant) :** le point d'entrée d'un service gRPC est un **contrôleur dédié**,
classe qui étend `GrpcController` (base fournie par `@nodefony/framework`, jumelle de
`RealtimeController`), marquée par le décorateur à nom figé `@GrpcService(Contrat)` (le descripteur
généré par `buf`), et déclarée par `@controllers([...])` comme tout point d'entrée du module. La
**logique métier** vit dans un service injectable, que le point d'entrée appelle — le découpage
déjà en usage pour HTTP et le temps réel.

```ts
@GrpcService(EchoService)
export class EchoController extends GrpcController {
  constructor(
    context: ContextType,
    @Inject("echo") private readonly echo: EchoBusiness,
  ) {
    super("EchoController", context);
  }

  @IsGranted("ROLE_ECHO")
  say(request: SayRequest, ctx: HandlerContext) {
    return this.echo.say(request.sentence);
  }
}

@controllers([EchoController])
class Echo extends Module {}
```

Ce que la forme engage :

1. **Une route littérale du Router par méthode du contrat**, `POST /<paquet.Service>/<Méthode>`, et
   `GET` en plus pour une méthode `NO_SIDE_EFFECTS` seulement. Le pare-feu, `@IsGranted`,
   `@RequireAuthentication`, `@Scope`, les hôtes virtuels, le profileur et la liste des routes
   s'appliquent sans code neuf — une seule implémentation de l'autorisation
   (`Resolver.ts#Resolver._enforceSecurity`), comme le pont `api.request` du temps réel
   (`RealtimeController.ts`, `executeActionGuarded`).
2. **Les gardes sont lues sur la méthode du contrat** (`say`), l'action exécutée est celle de la
   base, qui remet la requête brute à l'adaptateur ; l'adaptateur appelle la méthode avec
   `(request, HandlerContext)`.
3. **Singleton par défaut** (`Controller.scope`) : aucune instance par appel.
4. **Typage** : `@GrpcService(Contrat)` contraint la classe à respecter le contrat généré.
5. **Garde au démarrage** : un décorateur sans effet en gRPC (`@UseSession`, `@Csp`, `@Idempotent`,
   schéma de route…) posé sur une méthode du contrat interrompt le démarrage en la nommant
   (S-grpc-18) ; une méthode du contrat absente de la classe aussi.
6. **Casse** : le Router compare sans la casse, l'adaptateur avec ; un chemin à casse modifiée
   finit en `UNIMPLEMENTED` sans atteindre la méthode (S-grpc-9). Le 404 nu que l'adaptateur écrit
   par défaut ne le garantit que pour grpc-js et connect-es : grpc-go y lit `INTERNAL`. D'où le
   `fallback` fourni par Nodefony (D13, point 2).
7. **Rien de chargé** pour une application qui ne déclare aucun service : adaptateur, runtime
   protobuf et code généré ne sont jamais chargés (seul reste le champ `rpc`, `null`, de D10). Quand un service est déclaré, ils se chargent au démarrage,
   pas au premier appel (D12 point 4 : le contrôleur importe le code généré, et un pair manquant
   doit se voir au déploiement).

### D2 — Où vivent le contrat et le code généré

**Décision (validée par l'auteur le 2026-11-11) :** une **convention par défaut, jamais une
obligation** — Nodefony ne lit aucun de ces fichiers à l'exécution ; le contrôleur importe le code
généré par un import ordinaire. Identique dans une application (sa racine est un module) et dans un
module :

```
<application ou module>/
├── buf.yaml        modules: [proto, …], deps, lint STANDARD, breaking FILE
├── buf.gen.yaml    protoc-gen-es → out: nodefony/gen, target=ts
├── proto/<paquet>/v1/*.proto
└── nodefony/
    ├── controller/…           les points d'entrée (D1)
    └── gen/<paquet>/v1/*_pb.ts   GÉNÉRÉ, versionné, jamais édité
```

1. **`proto/`** à la racine, hors du bundler : le contrat public, lisible par les clients d'autres
   langages. Nom des guides protobuf-es et connect-node (`modules: - path: proto`). Plusieurs
   dossiers de contrats sont permis (`modules: [proto, vendor]`, essayé : `buf build` les réunit).
2. **`nodefony/gen/`** : nom de l'écosystème (`out: gen` chez connect-node, `src/gen` chez
   protobuf-es) ; pas `grpc/`, les messages protobuf servent au-delà de gRPC (codec, ADR-0022).
   Chaque fichier garde le suffixe imposé `*_pb.ts`, que les outils du dépôt excluent déjà
   (`.prettierignore`, `.oxlintrc.json`).
3. **Le développeur génère** (`npx buf generate`) après avoir modifié un contrat ; le code généré
   est **commité** ; Nodefony ne génère rien au build ni au démarrage. **La CI refuse la dérive** :
   elle régénère et échoue sur toute différence, en lisant `buf.gen.yaml` (aucun chemin codé en
   dur). La dérive existait : le fichier du POC venait de protoc-gen-es 2.16.0 quand la 2.17.0 était
   installée. Gate : `scripts/gates/check-generated-protobuf.mjs`. Il rejoue chaque
   `buf.gen.yaml` versionné dans un dossier jetable et signale tout fichier manquant, en trop ou
   différent.
4. **`edition = "2024"`** pour un contrat neuf ; `proto3` accepté (A2A, santé et réflexion le sont).
5. **Lint `STANDARD`** (dossier = paquet, paquet versionné `.v1`) et **`breaking FILE`**, la règle la
   plus stricte, qui inclut `WIRE_JSON` — Connect sert aussi du JSON.
6. **Outils** : `@bufbuild/buf` et `@bufbuild/protoc-gen-es` en dépendances de développement ; buf
   publie ses binaires pour les trois plateformes (Windows x64 et arm64 compris).
7. **Contrats tiers — essayés le 2026-11-11, code produit compilé en `strict`** :
   - santé et réflexion : `buf.build/grpc/grpc` (`--path grpc/health/v1/health.proto`,
     `--path grpc/reflection/v1/reflection.proto`) ; #697 les livrera générées dans le framework,
     l'application n'aura rien à générer ;
   - A2A n'est PAS publié sur le registre buf (`resource "a2aproject/a2a" was not found` — un
     `curl` qui rend 200 sur `buf.build/…` ne prouve rien, c'est une page générique). Il se génère
     depuis son dépôt, version épinglée, sans copie :
     `inputs: - git_repo: https://github.com/a2aproject/A2A.git, tag: v1.0.1, subdir: specification` ;
     ses imports `google/api/*` suivent par son propre `buf.lock` ;
   - `include_imports: true` est requis pour générer ces imports ; les types bien connus
     (`google/protobuf/*`) viennent de `@bufbuild/protobuf/wkt`, jamais régénérés.
8. **Dépendances npm** : le générateur (`@bufbuild/buf`, `@bufbuild/protoc-gen-es`) en
   `devDependencies` ; le runtime (`@bufbuild/protobuf`, `@connectrpc/connect`,
   `@connectrpc/connect-node`) en `dependencies` de l'application — une installation de
   production (`npm ci --omit=dev`) n'aurait sinon pas l'adaptateur (le POC les range tous en
   développement : module de test, jamais installé en production). Plages et pairs facultatifs : D12.

9. **En développement, le superviseur régénère** (validé par l'auteur le 2026-11-12, livré par
   #764). Aujourd'hui, modifier un `.proto` ne déclenche rien, pour deux raisons.
   `DevSupervisor.ts#isIgnoredWatchPath` ignore tout fichier qui n'est pas en `.ts`, et le
   `proto/` à la racine de l'application est hors de `DevSupervisor.ts#DEV_WATCH_PATHS` (celui
   d'un module local, sous `modules/`, y est déjà). Décision :
   - le superviseur surveille aussi les `.proto` de tout dossier qui porte un `buf.gen.yaml` ;
   - un changement lance `buf generate` dans ce dossier, depuis le superviseur lui-même. Le
     `.proto` ne déclenche donc pas de redémarrage par lui-même : c'est le `*_pb.ts` régénéré, déjà
     surveillé, qui provoque le redémarrage habituel, un seul ;
   - si `buf` échoue (erreur de syntaxe dans le contrat), sa sortie s'affiche et l'exemplaire en
     cours continue de servir l'ancien code. Si `buf` est absent, le message nomme
     `npm i -D @bufbuild/buf @bufbuild/protoc-gen-es`, jamais un échec muet ;
   - rien de tout cela en production, où le superviseur ne tourne pas : le code généré reste
     commité (point 3), et le gate de dérive en CI garde l'écart.

Hors D2 : la variante `nodefony create controller --kind grpc` (contrat, `buf.yaml`,
`buf.gen.yaml`, code généré, contrôleur, dépendances) et un script `grpc:generate` au gabarit
d'application (accord de l'auteur requis pour un `package.json`) — ticket #764, après #695.

### D3 — Sur quels ports, avec quels protocoles

**Décision (validée par l'auteur le 2026-11-11) :**

1. **Aucun serveur ni port neuf.** Une méthode gRPC étant une route (D1), elle répond sur tous les
   serveurs DÉJÀ actifs, chacun avec ce que son HTTP permet (`connect-node-server-plugins.md`,
   « HTTP/2, TLS, and gRPC ») : 5152 (HTTP/2 + TLS) sert navigateur, Connect, gRPC-Web et gRPC ;
   5153 (h2c) sert Connect, gRPC-Web et gRPC ; 5151 (HTTP/1.1) sert navigateur, Connect et
   gRPC-Web — jamais le gRPC natif, qui exige HTTP/2. Un service qui ne doit jamais passer en clair
   l'exige par le mécanisme existant (`Route.ts`, `requirements.scheme`), sans code neuf.
2. **Les trois protocoles ouverts par défaut** (gRPC, gRPC-Web, Connect) : défaut de l'adaptateur
   (`@connectrpc/connect`, `router.d.ts` : « The protocol is enabled by default »). Aucun coût par
   appel : l'adaptateur choisit le protocole au `content-type`, dans le même gestionnaire.
3. **Pas de faille CSRF ouverte par les navigateurs** : un POST Connect exige `application/json` ou
   `application/proto`, sinon 415 (`connect-protocol.md`) — un formulaire, un `text/plain` sont
   refusés ; un POST JSON d'une autre origine déclenche un contrôle préalable CORS, refusé tant que
   D9 ne l'autorise pas ; le `GET` n'existe que pour `NO_SIDE_EFFECTS` (D1) et sa réponse reste
   illisible d'une autre origine. `requireConnectProtocolHeader` peut ajouter une couche ; elle
   est désactivée par défaut, parce que ces trois défenses suffisent (D4, point 6).
4. **h2c reste une activation explicite** (`kernelServers.ts#isH2cEnabled` : seul `enabled: true`
   l'allume) : déclarer un service n'ouvre jamais un port en clair ; h2c ne sert que derrière une
   passerelle de confiance (A2A §10 exige TLS en production).
5. **Restreindre les protocoles se fait pour l'application entière**, par une option de la section
   `grpc` de la configuration http, branchée sur les options `grpc` / `grpcWeb` / `connect` de
   l'adaptateur. Le grain « par service » attend un usage réel ; il s'ajoutera sans rupture.
   Les méthodes s'inscrivent SANS option (`router.rpc(méthode, impl)`) : une option passée à
   l'inscription rallumerait gRPC et gRPC-Web coupés (connectrpc/connect-es#1835).
6. **Le JSON résout les types du contrat** (précision du 2026-11-12, lot 2, accord de l'auteur).
   Le mappage JSON de proto3 exige de résoudre le type emballé dans un `google.protobuf.Any` ; sans
   registre, Connect répond `INVALID_ARGUMENT` en Connect JSON et en gRPC-Web JSON (constaté aux
   trois ports), quand le binaire passe. L'adaptateur reçoit donc `jsonOptions.registry` : le
   fichier du contrat et tous ses imports, types bien connus compris, construit une fois, consulté
   par Connect pour `Any` en JSON seulement — aucun coût par appel. Un `Any` qui emballe un type
   hors du graphe d'imports du contrat ne se lit qu'en binaire.

Un client gRPC natif qui vise 5151 n'obtient pas un statut gRPC : le serveur HTTP/1.1 ne comprend
pas la préface HTTP/2 et la connexion échoue — le test exige qu'elle échoue franchement et vite.
Constaté (lot 2) : le client lit `ERR_HTTP2_ERROR: Protocol error` en une quinzaine de
millisecondes, que Connect classe 13 `INTERNAL` ; jamais une échéance atteinte.

### D4 — Les limites : taille, durée, flux

**Décision (tranchée sur délégation, validée par l'auteur le 2026-11-11) :**

Deux faits du pipeline fondent la décision.

- **Le pipeline lit le corps d'un POST avant le contrôleur**
  (`http-kernel.ts#HttpKernel.serveHttpRequest` → `Request.ts#HttpRequest.initialize`), ce qui
  rendrait tout flux gRPC impossible. La route gRPC pose donc `bodyStream: true` (mécanisme
  existant, celui de `@Body({ stream: true })`). Conséquence : `http.maxBodySize` (1 Mio, 413) ne
  la borne plus, et seule reste la borne de l'adaptateur.
- **À l'expiration du délai de réponse, Nodefony écrit lui-même un 504/408**
  (`HttpContext.ts#HttpContext._onTimeout`). Sur une réponse que l'adaptateur possède, ce serait
  un second écrivain. Sur une route gRPC, le délai de Nodefony n'écrit donc jamais : désarmé
  pour un flux, il termine un appel unaire par sa fiche (point 3), au format du protocole —
  **un seul écrivain**.

1. **`readMaxBytes` = 4 Mio par message**, au-delà le statut 8 `RESOURCE_EXHAUSTED`
   (`grpc-statuscodes.md` : « Sent or received message was larger than configured limit »).
   - Le défaut de l'adaptateur vaut `0xffffffff` (`limit-io.js`), c'est-à-dire aucune borne.
   - La borne s'applique aussi à la décompression (`envelope.js` : `decompress(data, readMaxBytes)`) :
     sans elle, quelques Ko compressés peuvent devenir 4 Gio.
   - C'est la valeur que conseille `connect-node-server-plugins.md`.
2. **`writeMaxBytes` = 4 Mio** : l'erreur naît chez nous, journalisée, au lieu d'arriver chez un
   client qui refuse au-delà. Les implémentations de référence ne bornent pas l'émission ; leurs
   clients, eux, refusent au-delà de 4 Mio par défaut.
   - **Les deux bornes se règlent** dans la section `grpc` de la configuration http : un framework
     borne par défaut, il n'interdit pas à une application d'échanger de plus gros messages.
3. **Appel unaire : l'échéance vaut `min(échéance du client, responseTimeout)`**.
   - L'échéance du client reste celle de l'adaptateur : il la lit dans son en-tête, abaisse
     `ctx.signal` et rend le statut 4 `DEADLINE_EXCEEDED` dans le format du protocole.
   - Le délai du serveur n'est **pas** écrit dans l'en-tête d'échéance. `ctx.timeoutMs()` rend
     l'échéance envoyée par le client, et elle seule. Poser l'en-tête faisait échouer 1 717 cas
     sur 4 932 de la suite de conformité de Connect (« server echoed back a timeout but none was
     expected »).
   - Le délai du serveur est celui que Nodefony arme déjà sur toute requête (`HttpContext.setTimeout`).
     Sur une route unaire, il reste armé ; seul un flux le désarme. À son expiration,
     `HttpContext._onTimeout` termine l'appel par sa fiche (`HttpContext.rpc`, D10) au lieu
     d'écrire un 408/504 : `GrpcCall.expire` abaisse `ctx.signal` (`ctx.abort`) et l'appel se
     termine en 4. Aucun minuteur de plus.
   - L'appel se termine même quand le gestionnaire ne lit pas son signal. L'adaptateur, lui,
     attend sans fin la promesse du gestionnaire
     (`invoke-implementation.js#invokeUnaryImplementation`).
   - Un gestionnaire synchrone n'est pas suivi.
   - `HttpContext.rpc` arrive donc dès ce lot, avec le seul membre dont il a besoin (`expire`) ;
     D10 y ajoute système, méthode et code.
   - Le client n'obtient jamais le 408 ou 504 générique, qu'il lirait comme `UNKNOWN`.
   - Aucune clé neuve : la valeur est celle de toute route.
4. **Flux (serveur, client, bidirectionnel) : aucune échéance par défaut**, comme le veut gRPC
   (un abonnement vit longtemps).
   - Le flux s'ouvre par `StreamLifecycle.ts#openStreamLifecycle`, comme SSE et les flux d'octets :
     - le délai d'inactivité est désarmé ;
     - le flux prend une place dans le budget de connexions longues par IP (`wsMaxConnectionsPerIp`) ;
     - `maxDuration` est désactivé ;
     - la fermeture est suivie.
   - Le client qui ne lit plus est coupé après le délai de blocage (30 s,
     `StreamLifecycle.ts#STREAM_STALL_TIMEOUT_MS`). Comme l'adaptateur garde ses écritures, ce
     blocage s'observe par **un seul balayage** (`StreamLifecycle.ts#StallSweep`), armé seulement
     s'il y a un flux, de période **la moitié du seuil** (15 s) :
     - un tour qui voit `writableNeedDrain` ouvre l'attente et pose un `drain` ; **seul ce
       `drain`** — un progrès réel — la ferme, jamais un tour qui verrait le tampon vide ;
     - une attente qui dure le seuil coupe le client : entre 30 et 45 s après la première
       contre-pression vue, **jamais avant le seuil** ;
     - le seuil reste dans `StreamLifecycle.sweepStall` (une règle, une implémentation), et le coût
       par message est nul.
   - Écartés, sur essai réel (h2c et HTTP/1.1, client bloqué, muet, lent, et bloqué à côté d'un
     voisin lu sur la même session) :
     - effacer l'attente quand un tour voit le tampon vide (la forme d'abord écrite ici) : un
       client LENT qui lit voit son tampon se remplir aussitôt, chaque tour le trouve plein, et il
       est coupé à tort ;
     - garder le délai d'inactivité que Node tient déjà sur le flux, sans minuteur de plus : en
       HTTP/2 il est repoussé tant que la SESSION avance (`internal/http2/core#callTimeout`, compteur
       de session) — un flux bloqué n'est jamais coupé si un voisin de la même connexion est lu,
       le cas même d'un client gRPC qui multiplexe tout sur une connexion ;
     - les autres minuteurs du noyau : `RevocationWatch` (passe asynchrone par entrée, anonymes
       exclus), `ReceiveDeadline` (échéance absolue d'un corps reçu), battements WS et SSE.
5. **`maxTimeoutMs` n'est pas posé** : il REFUSERAIT (`INVALID_ARGUMENT`) le client qui demande plus
   long (`connect-node-timeouts.md`). On rabote son échéance au lieu de la refuser.
6. **`requireConnectProtocolHeader` = `false`**, réglable dans la section `grpc` :
   - le CSRF est déjà fermé (D3, point 3) ;
   - exiger l'en-tête casse `curl` et le JSON écrit à la main ;
   - la norme dit « may reject » (`connect-protocol.md`).

**Coût, mesuré** (médiane de 7 passes d'un million d'itérations, Node du poste) :

| Geste                                                           | Quand                                                      | Coût                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Comparaison de taille (`readMaxBytes`, `writeMaxBytes`)         | chaque message                                             | **0 de plus** : l'adaptateur la fait déjà avec son défaut (≈ 5 ns)                                                                                                                                                                                                                    |
| Fin au délai du serveur (délai existant gardé, fiche accrochée) | chaque appel unaire                                        | **≈ 24 ns** : reconnaître le chemin unaire, accrocher la fiche. Écarté : désarmer puis tenir un anneau partagé, 97 ns en HTTP/2 et 174 ns en HTTP/1.1 keep-alive (réarmement de la socket à la requête suivante). Mesuré sur une vraie socket et un vrai flux, médiane de 9 × 200 000 |
| Cycle de vie du flux                                            | ouverture d'un flux                                        | celui de SSE, une fois par flux, jamais par message                                                                                                                                                                                                                                   |
| Balayage de blocage                                             | un minuteur pour tous les flux, armé seulement s'il y en a | 0 par message ; ~6 ns par flux et par tour (58 µs par tour à 10 000 flux, toutes les 15 s) ; ~60 ns pour inscrire puis retirer un flux, une fois. Mesuré sur 300 flux HTTP/2 réels, médiane de 9 passes                                                                               |

Ce que D4 ne décide pas, et qu'il faut mesurer : le **plancher par message** de l'adaptateur. Chaque
écriture crée une promesse et pose puis retire deux écouteurs
(`node-universal-handler.js#write`). Pour un framework de référence du temps réel, le débit d'un
flux serveur se compare à celui de la socket binaire, à charge utile égale (« Fini quand » de #695).

### D5 — Comment un refus atteint un client gRPC

**Décision (validée par l'auteur le 2026-11-11) :**

**Le constat.** Avant l'action, le pipeline refuse (`HttpKernel.onRequestEnd`) dans cet ordre :
provenance CSRF (`Firewall.enforceCsrf`, étape Fetch Metadata / `Origin`), session, zone du
pare-feu, puis `@IsGranted`. Ces refus lèvent un 401 ou un 403, que `HttpKernel.onError` rend en
HTML ou JSON. Un client gRPC y cherche un `grpc-status`, ne le trouve pas, et lit `UNKNOWN` : il
ne sait pas pourquoi l'appel a échoué.

1. **Nodefony décide, sans rien de neuf.** Les mêmes gardes que pour toute route, une seule
   autorisation (D1).
   - L'étape CSRF Fetch Metadata / `Origin` s'applique au POST gRPC : un appel cross-site est
     refusé. Un client natif n'envoie ni `Sec-Fetch-Site` ni `Origin`, et passe.
   - La redirection vers la page de connexion exige GET, `Accept: text/html` et
     `Sec-Fetch-Mode: navigate` (`entryPoint.ts`) : un client gRPC ne reçoit jamais de 302.
2. **Le noyau écrit le refus**, au format du client, par la fonction de refus de D13 (point 2) —
   la même que pour un chemin inconnu ou une méthode refusée. **Corrigé le 2026-11-12 (lot 3,
   accord de l'auteur)** : la première rédaction confiait l'écriture à Connect par `requestGate`.
   - Pourquoi l'abandon : D13 a ensuite imposé une fonction de http, sans Connect, qui écrit les
     refus en forme gRPC. Garder `requestGate` aurait fait deux écrivains pour le même refus, aux
     sorties différentes (Connect envoie en-têtes puis trailers, la fonction de D13 un
     _Trailers-Only_) et à la vidange du corps HTTP/1.1 faite deux fois, de deux façons.
   - Le corps non lu suit la seule règle du noyau (`HttpResponse.closeUnfinishedRequest`, D13
     point 1) ; un refus ne construit plus l'adaptateur.
   - `onError` reconnaît le protocole du client à ses en-têtes (`content-type`,
     `connect-protocol-version`), sur le chemin d'erreur seulement. La route gRPC porte un champ
     optionnel du contrat `IResolvedRoute` de http (`grpc`, ajout sans rupture), que lit la garde
     de D13 (point 3).
3. **Le code se choisit sur l'IDENTITÉ, pas sur le chiffre HTTP** :

   | Situation                                                                                                                   | Code                  |
   | --------------------------------------------------------------------------------------------------------------------------- | --------------------- |
   | refus, aucune identité authentifiée (`RequestContext.getAuthenticatedUser()` vaut `null`, un anonyme compte comme personne) | 16 `UNAUTHENTICATED`  |
   | refus, appelant identifié                                                                                                   | 7 `PERMISSION_DENIED` |

   Pourquoi ce choix :
   - `@IsGranted` répond 403 même sans identité (`Resolver.ts#Resolver._enforceSecurity`). Or la
     norme interdit `PERMISSION_DENIED` « if the caller can not be identified »
     (`grpc-statuscodes.md`).
   - L'enjeu est concret. Avec 16, un client sait qu'il doit présenter ou rafraîchir son jeton.
     Avec 7, il abandonne : un agent dont le jeton a expiré s'arrêterait au lieu de se reconnecter.
   - La correspondance des autres erreurs (400, 500…) relève de D7.

4. **Message envoyé au client : le libellé générique du code**, jamais le texte de l'erreur, qui
   nommait la zone refusée (même règle que `onError`). Le détail va au journal, avec le
   `requestId`.
5. **Refus avant routage — corrigé par D13.** La norme traduit un statut HTTP en code gRPC
   (`grpc-http-grpc-status-mapping.md`) : 429 en `UNAVAILABLE`, 404 en `UNIMPLEMENTED`. On en
   concluait « rien à coder ». C'est faux pour les clients de la famille grpc-go (`grpcurl`, tout
   client en Go) : ils lisent `INTERNAL` dès que le statut arrive avec un corps, ou sans que la trame
   d'en-têtes porte la fin du flux. Une requête gRPC refusée avant l'adaptateur s'écrit donc en forme
   gRPC, avec la correspondance des refus de transport (D13, point 2).

**Constaté sur le fil** (essai jetable de la première rédaction, `connectNodeAdapter` nu, porte qui
lève 16, corps envoyé incomplet puis complet ; implémentation appelée 0 fois). La forme des
protocoles reste celle-ci ; seul le gRPC natif part désormais en _Trailers-Only_ (D13, point 2) :

| Protocole                     | HTTP/2                                                     | HTTP/1.1        |
| ----------------------------- | ---------------------------------------------------------- | --------------- |
| gRPC unaire et bidirectionnel | `200`, en-têtes puis trailers `grpc-status: 16`            | sans objet (D3) |
| gRPC-Web                      | `200`, cadre de trailers `grpc-status: 16` dans le corps   | idem            |
| Connect unaire                | `401` + `{"code":"unauthenticated"}`                       | idem            |
| Connect en flux               | `200` + fin de flux `{"error":{"code":"unauthenticated"}}` | —               |

- **Ce n'est pas un _Trailers-Only_** : Connect envoie des en-têtes puis des trailers. Les deux
  formes sont valides (`grpc-PROTOCOL-HTTP2.md`), et le statut arrive bien au client.
- **HTTP/2** : le refus part sans attendre le corps. Connect coupe ensuite le flux avec `NO_ERROR`
  (`node-universal-handler.js#universalResponseToNodeResponse`).
- **HTTP/1.1** : Connect lit et jette le reste du corps, jusqu'à 256 Kio, AVANT de répondre (le
  geste du serveur HTTP de Go), pour garder la connexion réutilisable.
  - Au-delà de 256 Kio, il répond avec `connection: close` (essai : 1 Mio envoyé, réponse en 3 ms).
  - Un client qui n'envoie jamais la fin de son corps tient la connexion jusqu'à `requestTimeout`
    (30 s), comme sur toute route POST : l'exposition n'est pas nouvelle.

**Coût**

| Chemin        | Coût                                                                                                                                |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Appel accepté | 0 : aucune porte                                                                                                                    |
| Appel refusé  | deux lectures d'en-tête et une d'identité, déjà en mémoire, puis l'écriture du refus sans Connect, à la place du rendu HTML ou JSON |

**La bibliothèque.** `@connectrpc/connect` et `@connectrpc/connect-node` 2.3.0, sous Apache-2.0
comme Nodefony.

- Aucune dépendance transitive : un seul pair, `@bufbuild/protobuf`, qui n'en a aucune non plus.
- Dépôt `connectrpc/connect-es`, créé par Buf (l'outil `buf` et `protobuf-es`, D2).
- Projet CNCF au niveau Sandbox (`cncf/landscape`, entrée « Connect RPC », relu le 2026-11-11).
- Elle est retenue parce qu'elle est la seule à fournir une fonction `(requête, réponse)`, donc
  branchable dans une route. `@grpc/grpc-js`, l'implémentation officielle, ouvre son propre serveur
  (`bindAsync`) : ni pare-feu ni `@IsGranted`, et pas de gRPC-Web. C'est pourtant elle que le SDK
  A2A JS emploie : l'interopérabilité se prouve contre ses clients (D13).

### D6 — Le contexte de Nodefony dans un appel

**Décision (tranchée sur délégation, validée par l'auteur le 2026-11-11) :**

**Le constat.** L'appel s'exécute dans la bulle de la requête. `RequestContext` (ALS) et la portée
d'injection `request` sont ouverts par `HttpKernel`, et ne se referment qu'au `close` de la réponse
(`http-kernel.ts#HttpKernel.createHttpContext` → `HttpKernel.teardownHttp`), donc après le dernier
message d'un flux. En revanche, Connect écrit sur la réponse Node native
(`node-universal-handler.js#universalResponseToNodeResponse` → `writeHead`), alors que Nodefony
range ses en-têtes dans une réserve que seul `Response.ts#HttpResponse.writeHead` vide.

1. **Identité, ALS, portée : rien de neuf.** Le gestionnaire lit `this.user` (accesseur de
   `Controller`, soit `RequestContext.getAuthenticatedUser()`) et `RequestContext`, et résout ses
   services `request` comme toute action, pendant toute la durée du flux.
   - L'identité n'est PAS recopiée dans `contextValues` de Connect : ce serait une seconde source de
     vérité, et une écriture par appel pour rien quand le gestionnaire ne la lit pas.
   - `contextValues` sert à Nodefony seul : il porte la **fiche de l'appel**, que lisent la porte
     (D5), l'interruption (D8) et la ligne d'accès (D10). Connect en alloue un par appel de toute
     façon (`implementation.js#createHandlerContext`) ; le nôtre le remplace.
   - **Une seule composition** : `connectNodeAdapter`, avec deux de ses options publiques —
     `contextValues` (la fiche) et `fallback` (D13). `requestGate` n'est plus employé (D5,
     point 2). Recomposer soi-même `universalRequestFromNodeRequest` et
     `universalResponseToNodeResponse` n'apporterait rien, et exposerait à leur promesse qui ne se
     résout jamais (D7 point 4, signalé : connect-es#1876).
2. **Les en-têtes du pipeline passent sur la réponse gRPC.** Avant de confier la réponse à Connect,
   l'adaptateur la remet en état comme `HttpResponse.writeHead` le ferait :
   - la réserve (CORS, `Vary`, `Set-Cookie`), `X-Request-Id`, `traceparent` ;
   - la politique d'en-têtes de sécurité, choisie sur le type de la requête, pour un corps écrit
     par un tiers (comme un relais).

   Il les pose en en-têtes natifs. Node les fusionne avec ceux de Connect, qui l'emportent en cas
   de conflit (`content-type`). Sans cela, la corrélation client↔serveur et le CORS disparaissent
   en silence.
   - Antériorité : l'adaptateur Fastify officiel de Connect fait le même geste, pour la même raison
     (`connect-fastify/src/fastify-connect-plugin.ts`, recopie de `reply.getHeaders()` sur la
     réponse native avant de confier la réponse à Connect).
   - Constaté sur le fil (Connect réel, HTTP/2 et HTTP/1.1) : `x-request-id`, `vary` et
     `access-control-allow-origin` posés en natif reviennent sur la réponse ; un `content-type`
     posé avant est remplacé par celui de Connect. L'ALS est lu dans l'implémentation, à l'appel
     unaire comme au cinquième message d'un flux.

3. **Un flux ne survit pas à l'identité qui l'a ouvert**, l'invariant des sockets
   (`FirewallRealtimeAuthenticator.ts#FirewallRealtimeAuthenticator`).
   - Le flux s'ouvre par `openStreamLifecycle` (D4) : il est déjà inscrit dans la surveillance de
     révocation du noyau (`HttpKernel.watchStream`, fenêtre `REVOCATION_REVALIDATE_MS` de 30 s).
   - Mais la révocation ferme par `StreamLifecycle.close()`, qui appelle `context.close()` : sur une
     réponse que Connect possède, ce serait un second écrivain (S-grpc-27). `StreamLifecycle` reçoit
     donc une fermeture fournie par l'adaptateur, qui interrompt l'appel avec le statut 16
     `UNAUTHENTICATED` : l'agent rafraîchit son jeton et se reconnecte. Sans fermeture fournie, un
     flux dont un tiers tient les écritures est fermé en DÉTRUISANT son transport, jamais par
     `context.close()`.
   - L'interruption suit le mécanisme de D8 (point 2) : au plus le message déjà en vol part encore
     vers l'identité morte (constaté à l'essai), puis plus rien.
   - Un appel unaire n'est pas surveillé : il est autorisé à son début et borné par son échéance
     (D4).

**Coût**

| Geste                         | Quand                         | Coût                                                                  |
| ----------------------------- | ----------------------------- | --------------------------------------------------------------------- |
| ALS, portée, identité         | —                             | 0 : la bulle existe déjà                                              |
| `contextValues` de Nodefony   | chaque appel                  | 0 de plus : il remplace celui que Connect alloue                      |
| Remise en état des en-têtes   | chaque appel                  | le travail que `HttpResponse.writeHead` fait sur toute route, déplacé |
| Surveillance de la révocation | chaque flux, à chaque fenêtre | celle de SSE, déjà payée par D4 ; 0 par message                       |

### D7 — Les erreurs levées pendant un appel

**Décision (tranchée sur délégation, validée par l'auteur le 2026-11-11) :**

**Le constat** (lu dans Connect). Une exception qui n'est pas une `ConnectError` devient 13
`INTERNAL`, message « internal error ». Sa cause est gardée côté serveur et jamais envoyée
(`protocol-grpc/handler-factory.js#createHandler`, `transformCatchFinally`). La cause brute ne se
lit ailleurs que dans `ctx.signal.reason` (`context.abort(e)`). Une `ConnectError` part telle quelle.
Connect la reconnaît à sa forme (`name === "ConnectError"`) : une `HttpError` de Nodefony, levée par
un service partagé avec des routes HTTP, devient donc 13.

1. **Une table pour les erreurs de l'application**, celle de `google-rpc-code.proto` (« HTTP
   Mapping »), servie par une seule fonction. Elle ne sert pas aux refus de transport (chemin
   inconnu, limite de débit), qui ont leur propre correspondance normative (D13, point 2) ; les
   deux partagent seulement la règle d'identité de la ligne 401/403 (D5) :

   | HTTP      | gRPC                           |
   | --------- | ------------------------------ |
   | 400, 422  | 3 `INVALID_ARGUMENT`           |
   | 401, 403  | 16 ou 7, selon l'identité (D5) |
   | 404       | 5 `NOT_FOUND`                  |
   | 409       | 10 `ABORTED`                   |
   | 412       | 9 `FAILED_PRECONDITION`        |
   | 413, 429  | 8 `RESOURCE_EXHAUSTED`         |
   | 499       | 1 `CANCELLED`                  |
   | 501       | 12 `UNIMPLEMENTED`             |
   | 502, 503  | 14 `UNAVAILABLE`               |
   | 408, 504  | 4 `DEADLINE_EXCEEDED`          |
   | autre 5xx | 13 `INTERNAL`                  |
   | autre     | 2 `UNKNOWN`                    |
   - `code.proto` associe 409 à `ABORTED` et à `ALREADY_EXISTS`. `ABORTED` (conflit, réessayer plus
     haut) est le sens le plus large ; `ALREADY_EXISTS` se lève en `ConnectError` quand c'est le cas.
   - Chemin d'erreur seulement : un `switch`.

2. **Le message suit la règle d'`HttpKernel.onError`** (`error-renderer.ts`) : en production, un 5xx
   part avec un message générique ; sinon, le message de l'erreur. Les refus de D5 gardent leur
   libellé générique.
3. **Où la traduction s'applique.**
   - Appel unaire et flux client (une seule réponse) : à chaque erreur.
   - Flux serveur et bidirectionnel : aux erreurs levées AVANT le premier message (validation,
     entité introuvable, droit refusé), là où un service partagé lève. Après le premier message,
     l'erreur devient 13, et sa cause va au journal ; le code en cours de flux se choisit en levant
     une `ConnectError`.
   - Pourquoi cette borne : traduire en cours de flux impose une promesse par message, mesurée à
     **+45 ns par message** (+27 % sur un itérateur nu), pour un travail qui ne sert qu'en cas
     d'erreur.
4. **Journal.** À la fin de l'appel, l'adaptateur lit `ctx.signal.reason`. Une cause qui n'est pas
   une `ConnectError`, ou un code 2, 13 ou 15, part au journal en ERROR avec le `requestId` et la
   pile. Aucun écouteur de plus : la lecture se fait au `close` de la réponse, que le noyau écoute
   déjà (`HttpKernel.teardownHttp`). Ce journal est la ligne d'accès de l'appel (D10, point 3).
   - ⚠️ PAS à la fin de l'`await universalResponseToNodeResponse(…)` : cette promesse attend un
     événement `end` qu'une réponse Node n'émet jamais (`finish`, oui). Constaté à l'essai : elle
     ne se résout pas, en HTTP/1.1 comme en HTTP/2. `connectNodeAdapter` ne l'attend pas, d'où
     l'absence de symptôme chez Connect (signalé : connect-es#1876).
   - Essai : une exception banale porte sa cause brute dans `ctx.signal.reason` (« base
     injoignable… »), et le client reçoit 13 « internal error », sans la cause.
5. **Détails riches (`google.rpc.Status`, `ErrorInfo`) : aucun par défaut.**
   - `ConnectError` les porte déjà (`details`). Les types `google.rpc.*` s'engendrent par une entrée
     buf (D2), comme le fera le pont A2A (#745, A2A §10.6).
   - Ils voyagent dans le trailer `grpc-status-details-bin`, que les clients bornent avec les
     en-têtes (8 Kio courants, A2A#2433). La documentation le dit ; Nodefony ne le borne pas.

**Coût**

| Chemin              | Geste                                      | Coût                                            |
| ------------------- | ------------------------------------------ | ----------------------------------------------- |
| Appel unaire réussi | une promesse (`.then`) par appel           | ≈ 45 ns (mesuré sur le même geste, par message) |
| Flux réussi         | une promesse au premier message, 0 ensuite | ≈ 45 ns par flux, 0 par message                 |
| Fin d'appel         | lecture de `ctx.signal.reason`             | une lecture et un test de forme                 |
| Erreur              | `switch` + journal                         | chemin d'erreur seulement                       |

### D8 — L'arrêt du serveur

**Décision (tranchée sur délégation, validée par l'auteur le 2026-11-11) :**

**Le constat.** À `onTerminate`, la séquence existe (`HttpKernel.init`) : readyz passe à 503,
fermeture 1001 des WebSocket, drain HTTP (GOAWAY en deux temps), destruction à `shutdownTimeout`
(5 s). Un flux gRPC détruit sans statut laisse le client deviner.

Connect offre `shutdownSignal`, mais il y lie un écouteur par appel, unaire compris
(`signals.js#createLinkedAbortController`). Or l'ajout et le retrait d'un écouteur sur un
`AbortSignal` parcourent les écouteurs déjà posés : le coût de CHAQUE appel croît avec le nombre
d'appels ouverts (mesure ci-dessous).

1. **Une seule liste de flux longs, celle du noyau, pas une liste gRPC.** Nodefony n'emploie pas
   `shutdownSignal`.
   - Ce qui existe (relu au code) :
     - `HttpKernel.#streams`, un `RevocationWatch` dont le `Set` ne tient que les flux PORTEURS
       D'UNE IDENTITÉ (`StreamLifecycle` s'y inscrit seulement si `revalidate !== null`) ; un flux
       anonyme n'y est pas ;
     - `WsConnectionCounter`, des COMPTES par IP, et seulement si le plafond est armé ;
     - les `Set` de sockets et de sessions HTTP/2 de `serverShutdown.ts#createDrainTerminator`, des
       CONNEXIONS, pas des flux.
   - Aucun ne liste tous les flux ouverts, et aucun flux long (SSE, octets) ne reçoit de fin à
     l'arrêt aujourd'hui : il est détruit à `shutdownTimeout`.
   - Donc : le noyau gagne UN registre de tous les flux longs ouverts, rempli par
     `StreamLifecycle` à l'endroit même où il appelle déjà `watchStream` / `unwatchStream`. À l'arrêt,
     le noyau ferme chacun par `StreamLifecycle.close(cause)`. gRPC n'apporte que sa fermeture
     (D6 point 3) ; SSE et les flux d'octets en profitent aussi.
   - Le `RevocationWatch` reste réservé aux flux à identité : y mettre les anonymes ferait
     travailler chaque fenêtre de 30 s pour rien.
   - **Pour SSE, la fin à l'arrêt est une fermeture simple du flux** : `EventSource` se reconnecte,
     vers un autre exemplaire. Ce n'est jamais la fin d'un canal d'ADR-0021 S4 (le 204, qui dit de
     ne pas revenir). Changement de comportement d'une livraison gelée : précisé dans ADR-0021.
2. **À l'étape de la fermeture 1001 des WebSocket, chaque flux ouvert est interrompu avec 14
   `UNAVAILABLE`** (« réessaie, ailleurs ») par `ctx.abort(…)`.
   - Coopératif : `ctx.signal` prévient le gestionnaire, qui termine. La documentation le prescrit :
     passer `ctx.signal` à ses sources.
   - `abort` n'est pas sur le type `HandlerContext` que reçoit le gestionnaire. Il est déclaré par
     le type de retour de `createHandlerContext`, fonction PUBLIQUE de `@connectrpc/connect`
     (`index.d.ts`, sans marque `@private`), qui crée ce contexte. L'adaptateur l'atteint par un
     garde de type, jamais une conversion, et un test casse si Connect le retire. Sans lui,
     l'enrobage de l'itérateur (point suivant) arrête seul le gestionnaire qui produit.
   - Pour le gestionnaire sourd qui produit encore : l'itérateur de l'appel est enrobé. Après
     l'interruption, sa lecture et son écriture suivantes échouent avec ce statut, que Connect écrit
     en trailer. La révocation (D6) emprunte le même mécanisme.
   - Filet : un gestionnaire bloqué qui n'écoute pas son signal tombe à `shutdownTimeout` (connexion
     détruite, le client lit `UNAVAILABLE`) ; pour la révocation, à la fenêtre suivante (flux
     détruit).

   **Constaté sur le fil** (Connect 2.3.0 réel, flux bidirectionnel, interruption en 14) :

   | Gestionnaire                    | Sans enrobage                                | Avec enrobage                         |
   | ------------------------------- | -------------------------------------------- | ------------------------------------- |
   | écoute `ctx.signal`             | 14 en 14 ms, 0 message après                 | idem                                  |
   | sourd, produit toutes les 20 ms | **jamais fini, 19 messages après en 400 ms** | 14 en 17 ms, 1 message après (en vol) |
   | sourd et bloqué                 | ouvert                                       | ouvert, 0 message → filet             |

   La deuxième ligne vaut aussi pour `shutdownSignal` de Connect : il ne fait qu'abattre
   `ctx.signal`, et n'arrête pas un gestionnaire sourd.

3. **Un appel unaire en vol n'est pas interrompu** : il finit pendant le drain, comme l'arrêt
   gracieux de gRPC. Un appel neuf après le GOAWAY est refusé par HTTP/2, et le client réessaie.
   - Le drain dure `shutdownTimeout` (5 s), l'échéance par défaut d'un unaire 30 s (D4) : un appel
     plus long que le drain voit sa connexion détruite, et le client lit `UNAVAILABLE`, qu'il
     rejoue ailleurs. Ce statut vient du transport, pas de Nodefony : à prouver par S-grpc-35.
   - Une application aux appels longs règle `shutdownTimeout` au-dessus de son échéance.

**Coût, mesuré** (médiane de 7 passes, Node du poste) :

| Geste                               | Quand                                | Coût                                                                                                             |
| ----------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Registre du noyau : ajout + retrait | chaque flux long (SSE, octets, gRPC) | 44 à 77 ns, constant de 0 à 10 000 flux ouverts                                                                  |
| Enrobage de l'itérateur             | chaque message d'un flux             | +3 ns (123 → 126 ns), dans le bruit                                                                              |
| Appel unaire                        | —                                    | 0                                                                                                                |
| Interruption à l'arrêt              | une fois                             | proportionnel aux flux ouverts                                                                                   |
| **Écarté** : `shutdownSignal`       | CHAQUE appel, unaire compris         | mesuré sur `createHandlerContext` réel : +0,2 µs à vide, **+12 µs** à 1 000 appels ouverts, **+122 µs** à 10 000 |

Relevé en passant, hors décision : le contexte que Connect crée par appel (`createHandlerContext`,
signaux liés, puis un `abort()` final) coûte **7 à 12 µs par appel** selon la charge du poste,
mesuré sur la fonction réelle, sans `shutdownSignal`. L'essentiel vient de l'`abort()` SANS motif,
qui alloue une `DOMException` avec sa pile : 12,3 µs contre 4,8 µs avec un motif préalloué, soit
**≈ 7,5 µs évitables sur chaque appel**. C'est un plancher de la bibliothèque, pas un surcoût de
Nodefony ; il entre dans la mesure par appel de #695.

Trois signalements amont sont envoyés à Connect, reproductions et mesures comprises :
connect-es#1876 (promesse qui ne se résout pas), #1877 (`DOMException` par appel), #1878
(`shutdownSignal` linéaire). Un quatrième, chez Node (coût linéaire d'`EventTarget`), est retenu :
le cas courant y va bien, et le motif disparaît si Connect corrige le sien. Texte : commentaire
« Signalements amont » de #695.

### D9 — Les navigateurs d'une autre origine (CORS)

**Décision (tranchée sur délégation, validée par l'auteur le 2026-11-11) :**

**Le constat.** Le pare-feu répond au préflight `OPTIONS` en 204 AVANT le routage, avec la politique
unique de l'application (`firewall.ts#Firewall.handleCors`, `cors.ts#Cors`). Il pose les en-têtes
de la requête réelle dans la réserve de la réponse. L'étape CSRF accepte déjà une origine autorisée
par CORS (`csrf.ts#Csrf.enforce`, point 1). Connect publie les en-têtes que ses protocoles exigent
(`cors.allowedHeaders`, `cors.exposedHeaders`, `cors.allowedMethods`, `connect-cors.md`).

1. **Une seule politique CORS**, celle de l'application : aucune section CORS dans `grpc`.
2. **Préflight.** Dès qu'un service gRPC est déclaré et que le CORS est actif, la politique reçoit au
   démarrage l'union de ses listes avec celles de Connect (`grpc-timeout`,
   `connect-protocol-version`, `x-grpc-web`…, méthodes `POST` et `GET`). Le préflight ne connaît
   pas la route : l'union est la seule voie. Le démarrage l'annonce.
   - Nécessaire : la liste par défaut vaut `Authorization, Content-Type, X-Requested-With`
     (`security/…/config/config.ts`, `corsSchema`) ; un client gRPC-Web qui envoie `x-grpc-web` ou
     `grpc-timeout` serait refusé au préflight.
3. **Réponse réelle.** La remise en état des en-têtes (D6, point 2) y porte les en-têtes CORS. Sur
   une réponse gRPC seulement, `Access-Control-Expose-Headers` reçoit `grpc-status`,
   `grpc-message` et `grpc-status-details-bin` : sans eux, un client gRPC-Web ne lit pas le statut.
   Les autres routes n'en reçoivent rien.
4. **CSRF : rien à coder.** Une origine autorisée passe ; une autre est refusée en gRPC (D5).

**Coût** : 0 par appel ; listes calculées une fois au démarrage ; ≈ 70 octets de plus, sur une
réponse gRPC d'une autre origine seulement.

### D10 — Ce que voient la ligne d'accès et le traçage

**Décision (tranchée sur délégation, validée par l'auteur le 2026-11-11) :**

**Le constat.** Les trois journaux (`request-logger.ts#DefaultRequestLogger`,
`pretty-request-logger.ts#PrettyRequestLogger`, `audit-logger.ts#AuditLogEntry`) et le canal
`nodefony.http.request` (`requestTrace.ts#closeRequestTrace`) lisent `context.response.statusCode`.
Connect écrit sur la réponse native : ce statut reste 200. Constaté sur le fil (Connect 2.3.0,
24 cas, trois protocoles, HTTP/1.1 et HTTP/2) : en protocole Connect, une erreur part en 404 ou 500
natif, que Nodefony ne voit pas ; en gRPC et gRPC-Web, le résultat n'est que dans le trailer
`grpc-status`, que personne ne lit.

1. **Un enregistrement d'appel RPC sur le contexte, générique.** `HttpContext.rpc`, `null` par
   défaut comme `requestTrace` : le système (le protocole parlé sur le fil : `grpc`, `grpc-web`,
   `connect`), la méthode (`paquet.Service/Méthode`, connue de la route : jamais `_OTHER`), le code
   et son nom (`UNAVAILABLE`, tiré d'une table constante).
   - C'est la fiche d'appel de D6 qui le porte : aucune allocation de plus.
   - Le contrat vit dans http et ne nomme rien de Connect. Un appel JSON-RPC (porte MCP, A2A) pourra
     le remplir (`jsonrpc`, `-32602`) sans rupture.
2. **Le code se lit une fois, au `close`**, avant la ligne d'accès (`HttpKernel.settleRpc`,
   appelé par `HttpKernel.teardownHttp`), sur le motif d'interruption du contexte d'appel
   (`ctx.signal.reason`) :

   | Motif d'interruption                                     | `responseEnded` | Code                                                       |
   | -------------------------------------------------------- | --------------- | ---------------------------------------------------------- |
   | `ConnectError`                                           | vrai            | son code ; sa cause, une `Error`, devient l'erreur (3)     |
   | `ConnectError` d'une fin posée par le serveur (4, fiche) | faux            | son code : échéance 4, délai 4 ou identité révoquée 16     |
   | toute autre `ConnectError`                               | faux            | 1 `CANCELLED` : le client est parti, quel que soit son RST |
   | `AbortError`, aucun                                      | vrai            | 0 `OK`                                                     |
   | `AbortError`, aucun                                      | faux            | 1 `CANCELLED` : le client est parti                        |
   | autre                                                    | —               | 13 `INTERNAL`, la cause devient l'erreur (3)               |
   - **Le contexte d'appel est capté AVANT le corps**, par l'option `requestGate` de l'adaptateur
     prise en simple observateur (`GrpcEndpoint.ts#observeCall`) : elle ne refuse jamais, les refus
     gardent leur unique écrivain (D5 point 2). C'est le seul crochet de Connect qui voie les refus
     posés AVANT le gestionnaire — message trop grand ou bombe de décompression (8), encodage
     inconnu (12), en-tête d'échéance illisible —, Connect abaissant alors le signal sans jamais
     appeler le gestionnaire : capté par le gestionnaire seul, l'appel se lisait 0 `OK`. Les
     intercepteurs ne conviennent pas : ils s'exécutent après la lecture du premier message.
   - **Réponse non finie : 1, sauf une fin posée par le serveur.** Le signal relaie le `RST_STREAM`
     du client traduit en code (`node-error.js#connectErrorFromH2ResetCode`) : connect-node coupe à
     son échéance en `INTERNAL_ERROR`, que le serveur lisait 13 — une ligne `499 … INTERNAL` en
     gravité ERROR, pour un client simplement parti. Le code du RST est le fait du client ; le fait
     du serveur, c'est que la réponse n'a pas été terminée.
   - « Réponse finie » = `responseEnded.ts#responseEnded`, la règle unique du noyau, celle qui pose
     déjà 499 quand le client part (`HttpKernel.createHttpContext`). Elle sépare, en HTTP/2, la fin
     posée par le serveur de l'annulation du client (`RST_STREAM`), que `writableFinished` confond.
     Le code 1 et le statut 499 disent donc le même fait, comme la table de D7 (499 → 1).
   - Constaté sur le fil, avec cette règle : les 24 codes sont ceux que lit le client, sauf une
     course. Quand l'échéance du client expire, il coupe au même instant que le minuteur du
     serveur, en HTTP/1.1 comme en HTTP/2. Selon le premier arrivé, le serveur journalise 4 ou 1 ;
     les deux sont vus d'un passage à l'autre, et rien côté serveur ne permet de trancher.
   - « Aucun motif » arrive en HTTP/1.1 : l'écouteur `close` du noyau, posé à la création du
     contexte, passe avant celui de Connect.
   - **Le statut HTTP natif est recopié si la réponse est finie, et seulement alors.** C'est la
     règle du relais (`HttpContext.ts#HttpContext.logRequest`), tenue au même endroit pour toute
     réponse écrite par un tiers. Le relais, lui, recopie aujourd'hui sans condition : un client
     parti au milieu d'une requête relayée voit son 499 écrasé par le statut de l'amont (lu au
     code, pas encore vu sur le fil). La règle commune le corrige ; un test vu rouge le prouvera.

3. **Un appel en erreur = une ligne, comme une exception de route HTTP.** Une cause qui n'est pas
   une `ConnectError` devient `context.error` : la ligne d'accès la porte, le canal publie `error`.
   Précise D7 point 4 : « le journal » est cette ligne, jamais une seconde.
4. **Gravité selon la convention OpenTelemetry du serveur gRPC** : 0 → INFO ; 2, 4, 12, 13, 14, 15
   → ERROR (« SHOULD be considered errors ») ; les autres → WARNING. Une fonction, à côté de
   `severityFromStatus`, pour les trois journaux.
   - La ligne garde le statut HTTP et ajoute `RPC : <méthode> <NOM>`.
   - L'audit JSON reçoit un champ `rpc`, `null` hors RPC (forme stable).
5. **Canal de traçage.** `IRequestTrace` gagne `rpc` (`null` hors RPC) : un ajout, pas une rupture.
   `statusCode` reste le statut HTTP, vrai sur le fil (`http.response.status_code`).
   - Nodefony n'importe rien d'OpenTelemetry. La documentation donne la correspondance : nom du span
     = `rpc.method` ; `rpc.system.name` = `grpc` (convention stable) ou `connectrpc` (convention en
     développement, celle de l'implémentation), au choix de l'extension ; `rpc.status_code` = le
     nom ; `error.type` ; `rpc.server.call.duration` = `durationMs / 1000`.
   - Même horloge que le span, comme la norme l'exige. Un flux = un span, de l'ouverture au `close`.
6. **`traceparent` : rien à coder.** Les métadonnées gRPC sont des en-têtes HTTP : la propagation
   W3C existante les lit déjà.
7. **Rien par message** : ni trace ni ligne, comme pour les trames WebSocket.

**Normes** : conventions sémantiques OpenTelemetry, `docs/rpc/{rpc-spans,grpc,connect-rpc,rpc-metrics}.md`
(`open-telemetry/semantic-conventions@d0d92008`).

**Coût, mesuré** (médiane de 7 passes, Node du poste) :

| Geste                                 | Quand                       | Coût                                             |
| ------------------------------------- | --------------------------- | ------------------------------------------------ |
| Code lu au `close`                    | chaque appel                | ≈ 14 ns (lecture du motif déjà comptée par D7)   |
| Observateur `requestGate`             | chaque appel                | ≈ 55 à 95 ns isolé, invisible dans un appel (¹)  |
| Segment `RPC : …` de la ligne d'accès | chaque appel                | ≈ +6 ns (64 → 70 ns pour la ligne)               |
| Champ `rpc` du contexte               | chaque requête HTTP         | un champ `null` (8 octets), un test au démontage |
| Champ `rpc` de la trace               | chaque requête, avec abonné | une écriture de champ                            |
| Message d'un flux                     | —                           | 0                                                |

(¹) Connect écrit `await opt.requestGate(context)` : même pour une fonction synchrone qui rend
`undefined`, l'`await` suspend le gestionnaire et le reprend par une microtâche. L'appel lui-même
coûte ≈ 4 ns (un `instanceof`, une écriture de champ) ; la suspension, le reste. Ni allocation
retenue, ni entrée-sortie, ni tour de boucle : une microtâche, pas une latence réseau. Dans un appel
unaire Connect complet servi en process (≈ 36 µs), l'écart reste sous le bruit d'une mesure A/A
(± 0,6 µs). Le ramener à 0 relève de Connect — n'attendre que ce qui est une promesse —, pas de
Nodefony.

### D11 — Une surface expérimentale dans des paquets stables

**Décision (tranchée sur délégation, validée par l'auteur le 2026-11-11) :**

**Le constat.** La politique ne connaît que le paquet entier : la clé `nodefony.stability`, recopiée
à quatre endroits et gardée par `src/nodefony/src/tests/stability.test.ts`. Or la surface gRPC naît
dans deux paquets STABLES : la déclaration dans `@nodefony/framework` (D1), le transport dans
`@nodefony/http` (ADR-0021). Un paquet `@nodefony/grpc` à part suivrait le précédent de
`@nodefony/realtime`, mais rouvrirait D1 et ADR-0021, accepté et sous le gel du temps réel :
écarté. Le dépôt porte déjà une étiquette de symbole que la politique ignore :
`bundler/buildReport.ts#buildReportDevtools`, publiée par `nodefony/bundler`, est `@experimental`
sans être nommée nulle part. Le grain manque, et il a déjà dérivé une fois.

1. **La source est l'étiquette TSDoc `@experimental` sur le symbole**, ou sur le membre (un champ
   neuf d'une interface stable, comme `IRequestTrace.rpc`). C'est une étiquette standard de TSDoc
   (`StandardTags.experimental`, même sens que `@beta`), conservée dans le `.d.ts` publié :
   l'éditeur et l'agent de l'utilisateur la voient au survol.
2. **Tout symbole public, ou membre public, qu'ajoute #695 naît `@experimental`.** Cela vaut pour
   la déclaration (`GrpcController`, `@GrpcService`), le transport, le champ de route de D5, la
   fermeture fournie de D6, le contrat d'appel RPC de D10 (`IRpcCall`, `HttpContext.rpc`,
   `IRequestTrace.rpc`) et la section `grpc` de la configuration. Ce qui n'est pas exporté ne
   porte rien : ce n'est pas une surface (`docs/guides/compatibilite.md`, « la garantie porte sur
   `exports` »).
3. **Deux copies, gardées par le contrôle de stabilité**, étendu au symbole (il lit le `.d.ts` bâti,
   donc tourne après le build) :
   - la politique gagne un tableau « Symboles expérimentaux d'un paquet stable » (symbole, paquet,
     pourquoi). Le contrôle exige que l'ensemble des symboles étiquetés dans les paquets stables
     publiés soit EXACTEMENT celui du tableau, dans les deux sens ;
   - une page d'un paquet stable peut porter `status: experimental` si elle documente un symbole
     expérimental de son paquet, et seulement alors.
   - **Un seul lecteur de la surface** : `scripts/release/api-diff-core.mjs`, qui lit déjà le
     `.d.ts` publié de chaque entrée d'`exports`, membre par membre, avec un programme TypeScript
     (`readTypeDeclarations`). Il apprend à rendre l'étiquette (`ts.getJSDocTags`). Ce qu'il lit
     est l'artefact reçu, et seulement la surface publique. Jamais une expression régulière sur les
     sources : une étiquette sur un membre doit nommer le membre.
   - `buildReportDevtools` entre au tableau (« suit une option expérimentale de rolldown ») : le
     contrôle, vu rouge une fois, le signale avant toute correction.
4. **Mêmes règles que le paquet** : un symbole sort de l'expérimental en version mineure, en
   perdant son étiquette et sa ligne ; un symbole stable ne redevient jamais expérimental au cours
   d'une série ; chaque changement est annoncé au changelog. Aucun avertissement à l'exécution.
5. **Le changelog distingue une rupture d'un changement expérimental.** Aujourd'hui,
   `api-diff-core.mjs#apiDiffChangelogEntries` marque `rupture: true` tout retrait mesuré, sans
   regarder la stabilité (aucune mention de `stability` dans `scripts/release/`). Un retrait dans
   `@nodefony/ai`, paquet expérimental, sortirait donc en « rupture » dans une version mineure, ce
   que la politique permet sans rupture. Ce défaut existe déjà, avec ou sans gRPC.
   - Désormais, un changement qui touche un symbole étiqueté (lu dans la version publiée de
     référence, celle qui portait le symbole) ou un paquet `experimental` est écrit au changelog
     comme changement expérimental, toujours annoncé, jamais marqué rupture.

**Coût** : 0 à l'exécution (un commentaire) ; une lecture d'étiquette de plus dans un lecteur qui
tourne déjà à la publication.

### D12 — Comment Connect et protobuf arrivent dans une application

**Décision (tranchée sur délégation, validée par l'auteur le 2026-11-11) :**

**Le constat.**

- `@connectrpc/connect-node` 2.3.0 exige `@connectrpc/connect` **exactement** en 2.3.0, et
  `@bufbuild/protobuf` `^2.7.0`. `@bufbuild/protoc-gen-es` exige protobuf exactement à sa propre
  version : le générateur et le runtime de l'application vont donc ensemble (D2).
- **Coût du chargement**, mesuré avec un processus neuf par passe (médiane de 7) : importer
  `connect-node` et le code généré coûte **171 ms et 6,6 Mo de tas**, une fois par processus.
  `connect-node` tire les deux autres paquets, si bien que ce chiffre est le coût réel, pas une
  borne. Sur disque, l'installation pèse 4,7 Mo.
- **Les types.** Un `.d.ts` qui importe un paquet absent, même par `import type`, rend TS2307 à une
  application en `skipLibCheck: false` (constaté). Le gabarit le met à `true`, mais l'application
  reste libre de le changer.
- **Le bundler.** Les `rolldown.config.ts` de http et de framework listent leurs dépendances
  externes à la main : un paquet absent de cette liste serait recopié dans `dist`.
- **Le diagnostic.** `Kernel.ts#Kernel.bootRemediationHint` lit tout `ERR_MODULE_NOT_FOUND` comme
  un « dist périmé ». Or Node distingue les deux cas : `Cannot find package '<nom>'` pour un paquet
  absent, `Cannot find module '<chemin>'` pour un fichier absent.
- **Le « premier appel » du POC ne tient pas pour protobuf.** `@GrpcService(Contrat)` fait importer
  le code généré directement par le contrôleur, si bien que protobuf se charge au démarrage (D1
  point 7, écrit en conséquence).

1. **Pairs facultatifs**, jamais des `dependencies` :
   - `@nodefony/http` déclare les trois paquets (`peerDependencies` et
     `peerDependenciesMeta.optional`) ;
   - `@nodefony/framework` déclare `@bufbuild/protobuf` et `@connectrpc/connect`, pour les types ;
   - une application sans gRPC n'installe rien, ce qui suit le précédent `pg` (drizzle) et `argon2`
     (user) ;
   - l'application qui sert un service les déclare dans ses `dependencies` (D2 point 8).
2. **Plages de versions** :
   - `^2.3.0` pour les deux paquets Connect (la version éprouvée par D7 et D10) ;
   - `^2.7.0` pour protobuf (le plancher de Connect lui-même) ;
   - la majeure suivante est exclue, et l'élargir plus tard est un changement expérimental (D11),
     jamais une rupture ;
   - un test compare les plages déclarées par http et par framework, car la frontière entre les
     paquets impose deux copies. La règle est générale : un pair déclaré par plusieurs paquets
     publiés n'a qu'une plage (`scripts/release/peers.mjs#divergentPeerRanges`).
3. **Deux sous-chemins, `@nodefony/http/grpc` et `@nodefony/framework/grpc`**, sur le modèle de
   `nodefony/react` :
   - le point d'entrée principal ne cite ni Connect ni protobuf, même en type. `HttpContext.rpc`,
     `IRpcCall` et `IRequestTrace.rpc` restent dans le point d'entrée principal, puisqu'ils ne
     dépendent pas de Connect (D10) ;
   - la reconnaissance d'une `ConnectError` à la fermeture de la réponse (D10, point 2) vit dans le
     sous-chemin, où elle est posée dans la fiche d'appel. Elle peut se faire là grâce à
     `ConnectError[Symbol.hasInstance]` ;
   - les sources de chaque sous-chemin sont déjà prises par le bundler (`nodefonyInput`) et par
     `tsconfig.declarations.json` (`nodefony/**/*.ts`) ;
   - le contrôle de stabilité de D11 lit chaque entrée d'`exports`, donc aussi les deux nouvelles ;
   - deux contrôles de la chaîne de publication gardent la promesse, pour TOUT pair facultatif et
     non pour gRPC seul. Côté types, `scripts/release/dts-deps.mjs#reachableTypeImports` suit les
     imports relatifs depuis les types d'`exports["."]` : c'est ce que TypeScript charge, donc un
     pair facultatif atteint vaut TS2307. Côté exécution, `scripts/release/peers.mjs` importe le
     point d'entrée principal dans un processus neuf et relève les paquets résolus par
     `module.registerHooks`. Une application témoin compilée sans les pairs était envisagée ; elle
     est écartée, car dans le dépôt les pairs sont hissés dans `node_modules` et seraient trouvés
     quand même. Les deux contrôles ont été vus rouges sur un `import type` de protobuf et un import
     de Connect posés au fond du graphe de http, et le second a relevé aussi la contagion à
     framework.
4. **Chargement au démarrage, et seulement si un service est déclaré** (précise D1 point 7) :
   - le contrôleur importe le sous-chemin, qui importe Connect directement ;
   - une application sans service ne charge rien, ce qui garde la promesse « coût nul sans service » ;
   - un pair manquant se voit au déploiement, au lieu d'un exemplaire déclaré prêt qui échoue à
     chaque appel ;
   - les 171 ms ne tombent pas sur le premier appel ;
   - pas d'`import()` dynamique. Le démarrage s'arrête en production pour un module critique, le
     défaut (`Kernel.ts#Kernel.isBootErrorFatal`). Un module marqué `critical: false` démarre sans
     le service, avec un avertissement : c'est le choix explicite de l'application.
5. **Un pair absent est nommé.** `bootRemediationHint` distingue `Cannot find package '<nom>'` et
   rend `npm i <nom>` ; « dist périmé » ne vaut que pour un fichier absent. Ce défaut existe déjà,
   et le correctif vaut pour tout pair.
6. **Deux fichiers de configuration changent avec l'accord de l'auteur** :
   - `package.json` de http et de framework : les entrées `exports`, `peerDependencies` et
     `peerDependenciesMeta` ;
   - `rolldown.config.ts` de http et de framework : les trois paquets dans `external`.

**Coût**

| Chemin                        | Coût                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| Application sans service gRPC | rien d'installé, rien de chargé ; le champ `rpc` `null` de D10 (8 octets par contexte) |
| Démarrage avec un service     | 171 ms et 6,6 Mo de tas, une fois par processus (mesurés)                              |
| Appel, message                | 0                                                                                      |

### D13 — Interopérabilité avec `@grpc/grpc-js` et `grpcurl`

**Décision (tranchée sur délégation, validée par l'auteur le 2026-11-11) :**

**Le constat.** Deux sources d'essai :

- le POC du serveur de développement, interrogé en lecture seule (h2c 5153, TLS 5152, HTTP/1.1 5151) ;
- l'adaptateur nu sur `node:http2`.

Les clients éprouvés sont `@grpc/grpc-js` 1.14.7, `grpcurl` 1.9.4 (bâti sur grpc-go) et les trois
transports de connect-es.

- **Chemin nominal : conforme.** Sur les deux clients :
  - appel unaire, en h2c et en TLS (ALPN `h2`) ;
  - flux bidirectionnel réellement entrelacé ;
  - erreur métier (code et message) ;
  - échéance (`grpc-timeout` reçu, code 4) ;
  - métadonnées texte et binaires (`-bin`), dans les deux sens ;
  - compression gzip ;
  - requête de 5 Mio ;
  - battements de maintien (PING HTTP/2 toutes les 200 ms).
- **Refus : la forme décide du code, et elle n'est pas la même pour tous.** Essai sur trois formes
  de refus :
  - quand la trame d'en-têtes porte la fin du flux, les deux clients lisent `UNIMPLEMENTED`, que la
    réponse soit un 404 nu, un 404 `text/html` ou la forme gRPC (statut 200 et `grpc-status: 12`) ;
  - quand la fin arrive dans une trame DATA, grpc-go lit `INTERNAL`. C'est le cas d'un `writeHead`
    suivi de `end()` dans l'API de compatibilité : « server closed the stream without sending
    trailers ».
  - Le 404 JSON de Nodefony (chemin inconnu) et le 404 nu de l'adaptateur (méthode inconnue, casse
    modifiée) sont dans ce second cas. grpc-js et connect-es lisent tous deux `UNIMPLEMENTED`.
  - ⚠️ La forme gRPC écrite par l'API de compatibilité échoue aussi : grpc-js y lit `INTERNAL`
    (« RST_STREAM with code 0 »).
- **Un appel en flux vers un chemin inconnu reste bloqué.** `grpcurl list` tient 60 s, jusqu'à son
  échéance.
  - Cause : quand aucune route ne correspond, `http-kernel.ts#HttpKernel.serveHttpRequest` lit le
    corps jusqu'au bout avant le 404. Le client d'un flux attend une réponse avant de finir son
    envoi.
  - En HTTP/2, aucun délai ne bornait cette lecture : défaut général du transport, hors gRPC,
    constaté sur un POST nu (aucune réponse au bout de 40 s, alors que HTTP/1.1 coupe à 30 s).
    Corrigé par #765 (fermé) : 408 vers 31 s. Le point 1 reste nécessaire, un 404 n'a pas à
    attendre le corps.

1. **Ne pas lire le corps quand le routage a déjà échoué** (404, 405) :
   - l'ordre des gardes reste inchangé : en-têtes du schéma, domaine (421), crochet `beforeResolve`,
     puis le refus. Seule la lecture du corps est sautée, car un refus n'en a pas besoin ;
   - le corps non lu est traité par la règle de D5 : en HTTP/2, réponse puis `RST NO_ERROR` si
     le client ÉMET ENCORE ; en HTTP/1.1, vidange d'au plus 256 Kio. Une seule implémentation
     pour les deux usages (`HttpResponse.closeUnfinishedRequest`, surchargée par
     `Http2Response`) ;
     - **précisé le 2026-11-12 (lot 3)** : « émet encore » se décide après **une grâce d'un
       aller-retour** — un `PING` (RFC 9113 §6.7), puis l'état du flux
       (`stream.state.remoteClose`). Ce n'est PAS une garantie : §6.7 fait passer l'écho d'un
       `PING` avant les autres trames (« SHOULD be given higher priority »), une trame DATA
       encore en file chez le client peut donc arriver après lui ; le `RST_STREAM` reste alors
       conforme (§8.1 : le serveur PEUT couper, le client NE DOIT PAS jeter la réponse).
     - **Ce que font les autres** (sources lues) : grpc-go (`http2_server.go#WriteStatus`), Go
       `net/http2` (`server.go`, en citant §8.1) et nginx (`ngx_http_v2.c`, `!in_closed`)
       coupent AUSSITÔT si le client n'a pas fini d'émettre — sans `PING`. Le `PING` est un
       ajout de Nodefony, et son motif est mesuré : Node répond AVANT de lire les trames DATA
       déjà en route (les autres lisent la requête d'abord), si bien que la coupe immédiate
       frappait des clients qui finissaient d'émettre. Le client HTTP/2 de Go (connect-go,
       référence de la suite de conformité) lit ce `RST_STREAM` en erreur malgré §8.1
       (`stream error … NO_ERROR; received from peer`) : 4 cas `unexpected-uri` rouges, et 13
       cas du banc `grpc-refusal.test.ts` avec les clients Node et connect-es.
     - Bornes : un `PING` par refus au corps inachevé, chemin d'erreur seul ; Node plafonne à 10
       `PING` en vol par session (constaté), au-delà la coupe est immédiate — la règle des
       autres. Un client muet ou qui émet sans fin est coupé en un aller-retour (banc #765
       vert). `request.complete` ne sert pas : il ne passe à `true` qu'une fois le corps
       CONSOMMÉ ;
   - un 404 coûte moins qu'aujourd'hui.
2. **Une requête `application/grpc` (gRPC natif) refusée avant l'adaptateur s'écrit en forme gRPC**
   — statut 200, `content-type` gRPC, `grpc-status`, `grpc-message` générique (D5, point 4), et
   fin du flux portée par la trame d'en-têtes :
   - une seule fonction dans `@nodefony/http`, sans Connect, appelée à deux endroits :
     - par le rendu d'erreur du noyau (404, 405, 429, 421…) ;
     - comme `fallback` de `connectNodeAdapter` (méthode inconnue, casse modifiée) ;
   - le code est celui qu'un client conforme aurait déduit du statut HTTP : la **correspondance des
     refus de transport** (`grpc-http-grpc-status-mapping.md`), servie par une seule fonction,
     distincte de la table des erreurs de l'application (D7) :

     | HTTP               | gRPC                                                            |
     | ------------------ | --------------------------------------------------------------- |
     | 400                | 13 `INTERNAL`                                                   |
     | 401, 403           | 16 ou 7, selon l'identité (D5)                                  |
     | 404, 405           | 12 `UNIMPLEMENTED` (405 : aucune méthode gRPC à ce chemin)      |
     | 421                | 14 `UNAVAILABLE` (RFC 9110 : réessayer sur une autre connexion) |
     | 429, 502, 503, 504 | 14 `UNAVAILABLE`                                                |
     | autre              | 2 `UNKNOWN`                                                     |

     405 et 421 manquent à la table normative, qui les laisserait en `UNKNOWN` ; le motif de chacun
     est écrit dans la colonne ;

   - en HTTP/2, l'écriture passe par `stream.respond(en-têtes, { endStream: true })`, jamais par
     `writeHead` puis `end`. Cette seconde forme est constatée fausse chez les deux clients ;
   - le protocole Connect garde ses statuts HTTP : connect-es les lit correctement, et c'est ce
     que la spécification de Connect prescrit (précisé ci-dessous, avec la forme de gRPC-Web).
   - **Précision (2026-11-12, lot 2, accord de l'auteur) : le statut seul ne suffit pas, le
     CORPS aussi doit être celui du protocole.** Constaté par la suite de conformité officielle
     de Connect (`connectconformance` v1.0.7, 20 cas `unexpected-uri` / `unexpected-verb`) : le
     404 ou 405 du routeur porte le JSON générique de Nodefony (`"code": 404`, numérique), que le
     client de référence refuse.
     - Connect : corps absent, ou une `Error` à code TEXTE (`{"code":"unimplemented"}`) en
       `application/json` (`connect-protocol.md` §Unary-Response, table des codes) ;
     - gRPC-Web : une réponse au format gRPC-Web portant le statut gRPC de la table ci-dessus ;
     - la requête Connect se reconnaît à `connect-protocol-version` (ou `application/connect+*`),
       gRPC-Web à `application/grpc-web*` ; le JSON d'une API ordinaire reste inchangé ;
     - preuve : vider `src/modules/test/conformance/known-failing.txt` (lot 3).
   - **Précision (2026-11-12, lot 3, accord de l'auteur) : en Connect, le code est celui que le
     client DÉDUIT du statut HTTP**, par la table « HTTP to Error Code » de `connect-protocol.md`
     (405 et 421 → `unknown`), jamais par la table ci-dessus.
     - Pourquoi : en Connect le statut HTTP voyage avec la réponse, et la norme veut que le code de
       l'`Error` corresponde au statut (« HTTP-Status should match Error.code »). Les lignes 405 et
       421 de la table ci-dessus sont des ajouts de Nodefony pour le gRPC natif, où le statut HTTP
       vaut 200 et ne dit rien ; en Connect, elles contrediraient le statut qui part avec.
     - Constaté : la suite de conformité exige `405` + `unknown` en Connect
       (`connect_server_unexpected.yaml`, cas `unexpected-verb`), et accepte `UNIMPLEMENTED` pour
       la même requête en gRPC et en gRPC-Web.
     - La règle d'identité (D5) s'applique aussi : un refus sans identité part en
       `unauthenticated` avec le statut 401, un appelant identifié en `permission_denied` avec 403.
   - **Formes écrites**, par protocole :

     | Protocole                                   | Statut HTTP                   | Corps                                           |
     | ------------------------------------------- | ----------------------------- | ----------------------------------------------- |
     | gRPC (`application/grpc*`)                  | 200, _Trailers-Only_          | aucun                                           |
     | gRPC-Web (`application/grpc-web*`)          | 200, _Trailers-Only_          | aucun (`grpc-PROTOCOL-WEB.md`, point 4)         |
     | Connect unaire (`connect-protocol-version`) | celui du refus (401/403 : D5) | `{"code":"<code>"}`, `application/json`         |
     | Connect en flux (`application/connect+*`)   | 200                           | un message de fin `{"error":{"code":"<code>"}}` |

     En HTTP/2, toute réponse dont les en-têtes portent `grpc-status` se termine sur la trame
     d'en-têtes (`Http2Response.writeHead`) : c'est la définition du _Trailers-Only_, et la règle
     ne dépend d'aucun drapeau.
3. **Une requête gRPC native qui aboutit à une route qui n'est pas gRPC est refusée en 12
   `UNIMPLEMENTED`**, jamais servie. Le Router fusionne routes littérales et motifs par ordre
   d'insertion, les replis en dernier (`router.ts`, commentaire de l'index) : sous une route
   attrape-tout (page unique), une méthode inconnue n'échoue pas au routage, elle reçoit la page en
   200 ou un 405 (S-grpc-19). Coût : une comparaison de préfixe du `content-type`, sur une requête
   POST qui aboutit à une route non gRPC, et seulement quand un service est déclaré.
4. **Les preuves tournent sur les deux clients** :
   - `@grpc/grpc-js` et `@grpc/proto-loader` en dépendances de développement du banc ;
   - `grpcurl`, version figée, installé dans la CI Linux sur le patron de gitleaks
     (`.github/workflows/secrets.yml`), et déclaré dans `scripts/test/vitest/gates.ts` ;
   - le cas « `writeHead` puis `end` » est vu rouge une fois.
5. **Signalement amont à connect-es** : le 404 nu par défaut que grpc-go lit `INTERNAL`. Envoyé :
   connect-es#1882, remesuré sur le vrai `connectNodeAdapter` avant l'envoi.

**Coût**

| Chemin                           | Coût                                   |
| -------------------------------- | -------------------------------------- |
| Appel accepté, message d'un flux | 0                                      |
| Refus d'une requête gRPC         | une lecture d'en-tête (`content-type`) |
| 404 ou 405, tout protocole       | la lecture du corps en moins           |

## Alternatives écartées (D1)

- **Un service injectable servi hors du Router** (`@GrpcService` sur un `Service`, table privée
  dans http) : l'autorisation par méthode vit dans le Resolver du framework, que http ne peut pas
  importer — une seconde autorisation, ou un `@IsGranted` muet (S-grpc-1) ; hôtes virtuels et
  priorité face aux autres routes à réécrire (S-grpc-19) ; contredit le pipeline où tous les
  transports convergent vers `router.resolve` (`docs/architecture/pipeline-requete.md`).
- **Le même service, publié dans le Router par un pont** : une autorisation unique, mais aucun point
  d'entrée visible dans le module (S-grpc-12) — le développeur cherche ce que le module expose dans
  `nodefony/controller/` et `@controllers`.
- **Un crochet de module `getGrpcServices()`** (modèle MCP) : nul endroit pour une garde par
  méthode, injection à la main (S-grpc-1).
- **Une entrée de configuration** : la configuration porte des valeurs validées (Zod
  `strictObject`), pas des classes.
- **Deux formes de déclaration au choix** : deux pages, deux jeux de tests, et un agent qui hésite
  (S-grpc-12, S-grpc-14). Le « deux » existe déjà sous forme de couches : contrôleur pour
  l'entrée, service pour la logique.

Ailleurs dans l'ADR, les autres écarts sont écrits à leur décision : `shutdownSignal` (D8),
paquet `@nodefony/grpc` à part (D11), `maxTimeoutMs` (D4), recomposition de l'adaptateur (D6).

## Contrôle de non-blocage

Les tickets qui bâtissent sur cet adaptateur ne doivent pas exiger de rupture.

| Ticket                                        | Ce qu'il lui faut                                                        | Empêché ?                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #745, pont vers le hub (`@nodefony/realtime`) | un `ChannelSink` par abonné, refus avant le premier message, fin à motif | **non** : `realtime` dépend déjà de http et de framework ; D7 traduit les refus avant le premier message. **Contrainte** : Connect sérialise chaque message par appel (`serialization.js#createBinarySerialization`), sans voie publique pour des octets déjà encodés. La règle d'ADR-0021 (« jamais un réencodage par abonné ») se tient par un message à champ `bytes` portant les octets de `ChannelFrame` : une copie par abonné en binaire, un base64 par abonné en JSON (Connect, gRPC-Web JSON). Coût à mesurer et forme à trancher dans #745 ; ses pairs Connect s'ajoutent au test de parité des plages (D12, point 2). |
| #697, santé et réflexion                      | servies sans jeton, joignables par la sonde de Kubernetes                | **non**, mais trois choix sont ouverts et appartiennent à #697 : les sortir d'une zone de pare-feu qui couvre `/` (sinon D5 rend 16 à la sonde) ; leur paquet d'accueil (un `GrpcController` vit dans framework, que http ne peut pas importer) ; la sonde en clair face à h2c, activation explicite (D3, point 4).                                                                                                                                                                                                                                                                                                              |

## Conséquences

- **`@nodefony/framework`** gagne `GrpcController` et `@GrpcService`, et le sous-chemin
  `@nodefony/framework/grpc` ; **`@nodefony/http`** garde la primitive de transport, sous
  `@nodefony/http/grpc`. Connect et protobuf sont des pairs facultatifs des deux paquets (D12).
- **Le noyau change pour toutes les routes, gRPC ou non** :
  - un 404 ou un 405 ne lit plus le corps (D13, point 1) ;
  - un registre de tous les flux longs ferme SSE, octets et gRPC à l'arrêt (D8) ;
  - `HttpContext.rpc` et `IRequestTrace.rpc` existent, `null` hors RPC (D10) ;
  - le relais ne recopie plus le statut de l'amont quand le client est parti (D10, point 2) ;
  - `bootRemediationHint` distingue un paquet absent d'un `dist` périmé (D12, point 5).
- **Configuration** : une section `grpc` dans la configuration http (protocoles servis, bornes de
  taille, `requireConnectProtocolHeader`) ; la politique CORS reçoit au démarrage l'union avec les
  listes de Connect quand un service est déclaré (D9).
- **Politique de compatibilité** : contrôle de stabilité au grain du symbole, tableau des symboles
  expérimentaux d'un paquet stable, changelog qui distingue un changement expérimental d'une
  rupture (D11).
- **Preuves exigées par #695** (tests vus rouges une fois) : les critères de fin du ticket, 1 à 49
  et 51 à 54 (le 50 est passé à #764), dont l'interopérabilité en CI contre `@grpc/grpc-js` et
  `grpcurl` (D13).
- **Mesures exigées par #695** : surcoût du pipeline par appel unaire contre l'adaptateur nu sur
  `http2.createServer`, serveur en production, médiane de N passes, petite charge comprise ; débit
  d'un flux serveur contre la socket binaire, avec le plancher par message de l'adaptateur (D4) ;
  coût d'un unaire à 0, 1 000 et 10 000 flux ouverts (D8).

## Matrice des scénarios

Chaque scénario du catalogue, avec la décision qui le tient. « À prouver » : la décision le tient
sur le papier, un test de #695 doit le montrer.

| Scénario | Décision(s)             | Verdict                                                                      |
| -------- | ----------------------- | ---------------------------------------------------------------------------- |
| 1        | D1, D5                  | tient                                                                        |
| 2        | —                       | ouvert, appartient à #697 (contrôle de non-blocage)                          |
| 3        | —                       | ouvert, appartient à #745 (contrôle de non-blocage)                          |
| 4        | D1, D3                  | tient : chemins à la racine, h2c opt-in                                      |
| 5        | D1 point 3, D4          | tient ; mesure exigée                                                        |
| 6        | D4, D8                  | tient, sans `shutdownSignal`                                                 |
| 7        | D3                      | tient : aucun état partagé par le transport                                  |
| 8        | D11                     | tient                                                                        |
| 9        | D1 point 6, D4, D5, D13 | tient                                                                        |
| 10       | D2 point 6              | tient                                                                        |
| 11       | D1                      | tient                                                                        |
| 12       | D1, D2                  | tient                                                                        |
| 13       | D10                     | tient                                                                        |
| 14       | D1, D7, D8              | tient : une fonction par correspondance, un registre                         |
| 15       | D1                      | tient                                                                        |
| 16       | D11, D12                | tient                                                                        |
| 17       | D1                      | tient                                                                        |
| 18       | D1 point 5              | tient                                                                        |
| 19       | D1, D13 point 3         | tient ; à prouver sous une route attrape-tout                                |
| 20       | D2 point 3              | tient                                                                        |
| 21       | D2 point 1              | tient                                                                        |
| 22       | D3 point 3, D9          | tient                                                                        |
| 23       | D3                      | tient                                                                        |
| 24       | D4 point 1              | tient                                                                        |
| 25       | D4 point 4              | tient                                                                        |
| 26       | D4 point 3              | tient                                                                        |
| 27       | D4                      | tient                                                                        |
| 28       | D5 point 3              | tient                                                                        |
| 29       | D13 point 2             | tient                                                                        |
| 30       | D5                      | tient                                                                        |
| 31       | D6 point 1              | tient                                                                        |
| 32       | D6 point 2              | tient                                                                        |
| 33       | D6 point 3, D8 point 2  | tient                                                                        |
| 34       | D7                      | tient                                                                        |
| 35       | D8                      | tient pour les flux ; unaire plus long que le drain : à prouver (D8 point 3) |
| 36       | D8                      | tient ; mesure exigée                                                        |
| 37       | D9                      | tient                                                                        |
| 38       | D10                     | tient                                                                        |
| 39       | D10 point 2             | tient                                                                        |
| 40       | D10 point 5             | tient                                                                        |
| 41       | D11                     | tient                                                                        |
| 42       | D11 point 5             | tient                                                                        |
| 43       | D12 point 3             | tient                                                                        |
| 44       | D12 points 4 et 5       | tient                                                                        |
| 45       | D12 point 2             | tient                                                                        |
| 46       | D13 point 1             | tient ; à remesurer après #765                                               |
| 47       | D13 point 2             | tient                                                                        |
| 48       | D13 point 4             | tient                                                                        |
