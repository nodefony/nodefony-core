---
adr: 26
title: Service gRPC — un point d'entrée déclaré par un module, servi par le pipeline
lang: fr
navTitle: Service gRPC
date: 2026-11-11
status: proposed
deciders: [Christophe CAMENSULI]
tags: [grpc, connect, http2, design, compatibility]
---

# ADR-0026 — Service gRPC : un point d'entrée déclaré par un module, servi par le pipeline

## Statut

Proposé (2026-11-11). Annoncé par [ADR-0021](0021-temps-reel-evenement-et-livraisons.md)
(« l'ADR de gRPC naîtra avec l'Epic #694 »). Instruit par le ticket #695 (Epic #694), décision
par décision ; chaque décision porte sa ligne datée. Jugé contre le catalogue
[`scenarios/grpc.md`](scenarios/grpc.md). La surface naît `@experimental`
([politique de compatibilité](../guides/compatibilite.md), « Surfaces expérimentales ») ; l'ADR
passe à « accepté » quand toutes ses décisions sont rendues.

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
  `requestGate` décide avant la lecture du corps.
- **Antériorités** : l'usage établi est une déclaration à nom figé, le contrat généré en argument,
  et l'autorisation déclarative par méthode appliquée à l'appel gRPC (relevé au catalogue, à
  confirmer aux sources avant acceptation).

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
   finit en `UNIMPLEMENTED` sans atteindre la méthode (S-grpc-9).
7. **Coût nul** pour une application qui ne déclare aucun service : adaptateur, runtime protobuf et
   code généré chargés au premier appel (prouvé par le POC #690).

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
    ├── controllers/…          les points d'entrée (D1)
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
   dur). La dérive existe déjà : le fichier du POC est généré par protoc-gen-es 2.16.0, la 2.17.0
   est installée.
4. **`edition = "2024"`** pour un contrat neuf ; `proto3` accepté (A2A, santé et réflexion le sont).
5. **Lint `STANDARD`** (dossier = paquet, paquet versionné `.v1`) et **`breaking FILE`**, la règle la
   plus stricte, qui inclut `WIRE_JSON` — Connect sert aussi du JSON.
6. **Outils** : `@bufbuild/buf` et `@bufbuild/protoc-gen-es` en dépendances de développement ; buf
   publie ses binaires pour les trois plateformes (Windows x64 et arm64 compris).
7. **Contrats tiers — essayés le 2026-11-11, code produit compilé en `strict`** :
   - santé et réflexion : `buf.build/grpc/grpc` (`--path grpc/health/v1/health.proto`,
     `--path grpc/reflection/v1/reflection.proto`) ; le framework les livre DÉJÀ générées (#697),
     l'application n'a rien à générer ;
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

Hors D2 : un générateur `nodefony create` pour un service gRPC et un script `grpc:generate` au
gabarit d'application (accord de l'auteur requis pour un `package.json`).

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
   illisible d'une autre origine. `requireConnectProtocolHeader` ajoute une couche (D4).
4. **h2c reste une activation explicite** (`kernelServers.ts#isH2cEnabled` : seul `enabled: true`
   l'allume) : déclarer un service n'ouvre jamais un port en clair ; h2c ne sert que derrière une
   passerelle de confiance (A2A §10 exige TLS en production).
5. **Restreindre les protocoles se fait pour l'application entière**, par une option de la section
   `grpc` de la configuration http, branchée sur les options `grpc` / `grpcWeb` / `connect` de
   l'adaptateur. Le grain « par service » attend un usage réel ; il s'ajoutera sans rupture.

Un client gRPC natif qui vise 5151 n'obtient pas un statut gRPC : le serveur HTTP/1.1 ne comprend
pas la préface HTTP/2 et la connexion échoue — le test exige qu'elle échoue franchement et vite.

### D4 — Les limites : taille, durée, flux

**Décision (tranchée sur délégation de l'auteur le 2026-11-11) :**

Deux faits du pipeline fondent la décision.

- **Le pipeline lit le corps d'un POST avant le contrôleur**
  (`http-kernel.ts#HttpKernel.serveHttpRequest` → `Request.ts#HttpRequest.initialize`), ce qui
  rendrait tout flux gRPC impossible. La route gRPC pose donc `bodyStream: true` (mécanisme
  existant, celui de `@Body({ stream: true })`). Conséquence : `http.maxBodySize` (1 Mio, 413) ne
  la borne plus, et seule reste la borne de l'adaptateur.
- **À l'expiration du délai de réponse, Nodefony écrit lui-même un 504/408**
  (`HttpContext.ts#HttpContext._onTimeout`). Sur une réponse que l'adaptateur possède, ce serait
  un second écrivain. Sur une route gRPC, le délai de Nodefony est donc désarmé, et l'échéance
  appartient à l'adaptateur : **un seul écrivain**.

1. **`readMaxBytes` = 4 Mio par message**, au-delà le statut 8 `RESOURCE_EXHAUSTED`
   (`grpc-statuscodes.md` : « Sent or received message was larger than configured limit »).
   - Le défaut de l'adaptateur vaut `0xffffffff` (`limit-io.js`), c'est-à-dire aucune borne.
   - La borne s'applique aussi à la décompression (`envelope.js` : `decompress(data, readMaxBytes)`) :
     sans elle, quelques Ko compressés peuvent devenir 4 Gio.
   - C'est la valeur que conseille `connect-node-server-plugins.md`.
2. **`writeMaxBytes` = 4 Mio** : l'erreur naît chez nous, journalisée, au lieu d'arriver chez un
   client qui refuse au-delà.
3. **Appel unaire : l'échéance vaut `min(échéance du client, responseTimeout)`**.
   - L'adaptateur pose l'en-tête d'échéance (`grpc-timeout` ou `connect-timeout-ms` selon le
     protocole) seulement quand le client n'en envoie pas, ou en envoie une plus longue.
   - À l'échéance, l'adaptateur rend le statut 4 `DEADLINE_EXCEEDED`, dans le format du protocole.
   - Le gestionnaire lit le temps restant par `ctx.timeoutMs()`, et `ctx.signal` interrompt le
     travail en cours.
   - Le client n'obtient jamais le 408 ou 504 générique, qu'il lirait comme `UNKNOWN`.
   - Aucune clé neuve : la valeur est celle de toute route.
4. **Flux (serveur, client, bidirectionnel) : aucune échéance par défaut**, comme le veut gRPC
   (un abonnement vit longtemps).
   - Le flux s'ouvre par `StreamLifecycle.ts#openStreamLifecycle`, comme SSE et les flux d'octets :
     - le délai d'inactivité est désarmé ;
     - le flux prend une place dans le budget de connexions longues par IP (`wsMaxConnectionsPerIp`) ;
     - `maxDuration` est désactivé ;
     - la fermeture est suivie.
   - Le client qui ne lit plus est coupé après le délai de blocage (30 s, la règle de
     `StreamLifecycle.armStall`). Comme l'adaptateur garde ses écritures, ce blocage s'observe par
     **un seul balayage paresseux** qui lit `writableNeedDrain` des flux ouverts, puis appelle
     `armStall` / `clearStall` : le seuil reste dans `StreamLifecycle` (une règle, une
     implémentation), et le coût par message est nul.
5. **`maxTimeoutMs` n'est pas posé** : il REFUSERAIT (`INVALID_ARGUMENT`) le client qui demande plus
   long (`connect-node-timeouts.md`). On rabote son échéance au lieu de la refuser.
6. **`requireConnectProtocolHeader` = `false`**, réglable dans la section `grpc` :
   - le CSRF est déjà fermé (D3, point 3) ;
   - exiger l'en-tête casse `curl` et le JSON écrit à la main ;
   - la norme dit « may reject » (`connect-protocol.md`).

**Coût, mesuré** (médiane de 7 passes d'un million d'itérations, Node du poste) :

| Geste                                                                 | Quand                                                      | Coût                                                                                                                                                     |
| --------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Comparaison de taille (`readMaxBytes`, `writeMaxBytes`)               | chaque message                                             | **0 de plus** : l'adaptateur la fait déjà avec son défaut (≈ 5 ns)                                                                                       |
| Minuteur d'échéance (`setTimeout` + `clearTimeout`)                   | chaque appel unaire                                        | ≈ 0,4 µs. En HTTP/2, il **remplace** celui que Nodefony arme déjà par flux (`HttpContext.setTimeout`), d'où 0 de plus. En HTTP/1.1, c'est 0,4 µs de plus |
| Pose de l'en-tête d'échéance (chaîne constante calculée au démarrage) | appel sans échéance                                        | ≤ 80 ns (borne haute : la mesure inclut un `delete`)                                                                                                     |
| Cycle de vie du flux                                                  | ouverture d'un flux                                        | celui de SSE, une fois par flux, jamais par message                                                                                                      |
| Balayage de blocage                                                   | un minuteur pour tous les flux, armé seulement s'il y en a | 0 par message                                                                                                                                            |

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
2. **Connect écrit le refus**, au format du client, par `requestGate`, la seule voie publique. Ses
   fonctions d'écriture internes (`protocol-grpc`, `protocol-connect`) sont marquées `@private`,
   sans garantie de version.
   - La route gRPC porte un champ optionnel ajouté au contrat `IResolvedRoute` de http (ajout sans
     rupture). `onError` le lit sur le chemin d'erreur seulement et confie le refus à
     l'adaptateur.
   - L'adaptateur rappelle Connect avec une porte qui lève le refus.
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
5. **Refus avant routage, laissés en HTTP.** Ils arrivent avant que Nodefony sache que la route est
   gRPC, et la norme les traduit avec le bon sens (`grpc-http-grpc-status-mapping.md`) :
   - la limite de débit (`HttpKernel`, 429 écrit d'emblée) devient `UNAVAILABLE`, c'est-à-dire
     « réessaie plus tard » ;
   - le chemin inconnu (404) devient `UNIMPLEMENTED`.

   Rien à coder.

**Constaté sur le fil** (essai jetable, `connectNodeAdapter` nu, porte qui lève 16, corps envoyé
incomplet puis complet ; implémentation appelée 0 fois) :

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

| Chemin        | Coût                                                                                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Appel accepté | une lecture de propriété dans la porte                                                                                                                          |
| Appel refusé  | une lecture d'identité, déjà en mémoire, puis l'écriture par Connect sans décodage, à la place du rendu HTML ou JSON. Le débit des refus reste à mesurer (#695) |

**La bibliothèque.** `@connectrpc/connect` et `@connectrpc/connect-node` 2.3.0, sous Apache-2.0
comme Nodefony.

- Aucune dépendance transitive : un seul pair, `@bufbuild/protobuf`, qui n'en a aucune non plus.
- Dépôt `connectrpc/connect-es`, créé par Buf (l'outil `buf` et `protobuf-es`, D2).
- Statut CNCF Sandbox relevé par la veille, à confirmer aux sources avant acceptation.
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
   - `contextValues` sert à Nodefony seul : il porte la fiche de l'appel (D8). Connect en alloue un
     par appel de toute façon (`implementation.js#createHandlerContext`) ; le nôtre le remplace.
   - Pour le passer, l'adaptateur compose les briques que connect-node publie pour les adaptateurs
     de framework (`universalRequestFromNodeRequest`, `universalResponseToNodeResponse`), au lieu de
     `connectNodeAdapter`.
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
     `UNAUTHENTICATED` : l'agent rafraîchit son jeton et se reconnecte.
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

1. **Une seule table HTTP → gRPC**, celle de `google-rpc-code.proto` (« HTTP Mapping »), servie par
   une seule fonction, que les refus du pipeline (D5) emploient aussi :

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
     l'absence de symptôme chez Connect.
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

1. **Une seule liste de flux longs, celle du noyau, pas une liste gRPC.** Il n'emploie pas
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
2. **À l'étape de la fermeture 1001 des WebSocket, chaque flux ouvert est interrompu avec 14
   `UNAVAILABLE`** (« réessaie, ailleurs ») par `ctx.abort(…)`.
   - Coopératif : `ctx.signal` prévient le gestionnaire, qui termine. La documentation le prescrit :
     passer `ctx.signal` à ses sources.
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

3. **Un appel unaire en vol n'est pas interrompu** : il finit pendant le drain, borné par son
   échéance (D4), comme l'arrêt gracieux de gRPC. Un appel neuf après le GOAWAY est refusé par
   HTTP/2, et le client réessaie.

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

Trois signalements amont à Connect sont rédigés (promesse qui ne se résout pas, `DOMException` par
appel, `shutdownSignal` linéaire), reproductions et mesures comprises ; un quatrième, chez Node
(coût linéaire d'`EventTarget`), est retenu : le cas courant y va bien, et le motif disparaît si
Connect corrige le sien. Brouillons : commentaire « Signalements amont » de #695. Envoi sur GO de
l'auteur.

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
2. **Le code se lit une fois, au `close`**, avant la ligne d'accès (`HttpKernel.teardownHttp`),
   là où D7 lit déjà `ctx.signal.reason` :

   | Motif d'interruption | `responseEnded` | Code                                         |
   | -------------------- | --------------- | -------------------------------------------- |
   | `ConnectError`       | —               | son code                                     |
   | `AbortError`, aucun  | vrai            | 0 `OK`                                       |
   | `AbortError`, aucun  | faux            | 1 `CANCELLED` : le client est parti          |
   | autre                | —               | 13 `INTERNAL`, la cause devient l'erreur (3) |
   - « Réponse finie » = `responseEnded.ts#responseEnded`, la règle unique du noyau, celle qui pose
     déjà 499 quand le client part (`HttpKernel.createHttpContext`). Elle sépare, en HTTP/2, la fin
     posée par le serveur de l'annulation du client (`RST_STREAM`), que `writableFinished` confond.
     Le code 1 et le statut 499 disent donc le même fait, comme la table de D7 (499 → 1).
   - Constaté sur le fil, avec cette règle : les 24 codes sont ceux que lit le client, sauf une
     course. En HTTP/1.1, quand l'échéance expire, le client coupe la connexion au même instant que
     le minuteur du serveur. Selon le premier arrivé, le serveur journalise 4 ou 1 ; les deux sont
     vus d'un passage à l'autre, et rien côté serveur ne permet de trancher.
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
| Segment `RPC : …` de la ligne d'accès | chaque appel                | ≈ +6 ns (64 → 70 ns pour la ligne)               |
| Champ `rpc` du contexte               | chaque requête HTTP         | un champ `null` (8 octets), un test au démontage |
| Champ `rpc` de la trace               | chaque requête, avec abonné | une écriture de champ                            |
| Message d'un flux                     | —                           | 0                                                |

### D11 à D13 — à rendre

- `@experimental` au grain du symbole.
- Dépendances paires facultatives.
- Interopérabilité contre les clients `@grpc/grpc-js` et `grpcurl`.

Détail : ticket #695.

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

## Conséquences

- `@nodefony/framework` gagne `GrpcController` et `@GrpcService` (marqués `@experimental`) ;
  `@nodefony/http` garde la primitive de transport.
- **Preuves exigées par #695** (tests vus rouges une fois) : refus `@IsGranted` en statut gRPC sur
  les trois protocoles ; chemin à casse modifiée → `UNIMPLEMENTED` sans appel ; garde au démarrage
  (décorateur sans effet, méthode manquante) ; `GET` refusé sur une méthode sans
  `NO_SIDE_EFFECTS` ; contexte de requête (ALS) visible dans un flux long ; aucune instance de
  contrôleur par appel.
- **Mesure exigée par #695** : surcoût du pipeline par appel unaire contre l'adaptateur nu sur
  `http2.createServer`, serveur en production, médiane de N passes, petite charge comprise.
