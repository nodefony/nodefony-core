---
adr: 22
title: Socket temps réel — un canal, une enveloppe, un contrat pour les deux bouts
lang: fr
navTitle: Socket temps réel
date: 2026-10-28
status: proposed
deciders: [Christophe CAMENSULI]
tags:
  [
    realtime,
    websocket,
    jsonrpc,
    cbor,
    protobuf,
    isomorphism,
    backpressure,
    design,
    compatibility,
  ]
---

# ADR-0022 — Socket temps réel : un canal, une enveloppe, un contrat pour les deux bouts

## Statut

Proposé (2026-10-28), brouillon soumis à l'auteur. Il recentre #627 sur la **socket**. Le socle
commun aux livraisons est [ADR-0021](0021-temps-reel-evenement-et-livraisons.md), dont les
décisions S1 à S9 font foi ici ; les webhooks sont [ADR-0023](0023-webhooks-evenements-et-abonnements.md).
Les huit décisions de gel de #630 sont **déjà prises** (commit `1df6614c1`) : reprises, jamais
rediscutées. Les tickets #618, #622, #623, #626, #628, #629 et #619 appliquent ce document. Le
média (capture, codec audio) relève de l'ADR demandé par #624 : rien ici ne le recouvre.

## Contexte

La socket de Nodefony est un pair JSON-RPC 2.0 **partagé** entre navigateur et serveur
(`src/nodefony/src/realtime/JsonRpcPeer.ts#JsonRpcPeer`), des canaux servis par un hub
(`src/packages/@nodefony/realtime/nodefony/src/server/RealtimeHub.ts#RealtimeHub`) et un client
dans le cœur (`src/nodefony/src/client/realtime/NodefonySocket.ts#NodefonySocket`). Elle sert une
discussion, un tableau de bord, un jeu, un éditeur partagé, des capteurs, des notifications, un
flux de média, et des agents — sans être taillée pour aucun. Chaque décision ci-dessous porte
trois usages hétérogènes, dont un sans agent ni IA et un sans média (règle de #621).

Cinq évolutions touchent son protocole dans le même jalon : binaire routé (#618), admission par
identité (#622), abonnés identifiables (#623), transcription (#626), voix (#619). Après 10.0, un
changement de ce qu'une application reçoit est une rupture même à types identiques
([politique de compatibilité](../guides/compatibilite.md)). Ce document décide ce qui fermerait
une porte s'il était décidé plus tard, et laisse additif tout le reste.

**Constaté au code** (lecture seule, aucun test lancé) : octets en `Uint8Array` des deux côtés
(`src/nodefony/src/realtime/IRealtimeTransport.ts#RealtimeFrameData`), `request` hors du contrat
commun (`src/nodefony/src/realtime/IRealtimeSocket.ts#IRealtimeSocket`), code partagé compilé sans
Node ni DOM (`src/nodefony/tsconfig.shared.json`). Aucun sous-protocole annoncé
(`src/nodefony/src/client/realtime/BrowserWsTransport.ts#BrowserWsTransport.connect`), aucun
codec, aucune notification `realtime:closed`, aucun curseur d'abonnement.

## Décision

### 1. Le canal, pas la room

**Décision (validée par l’auteur le 2026-10-28) :** l'unité de la socket est le **canal** : un flux nommé dont le producteur
est **partagé**, démarré au premier abonné et libéré au dernier
(`src/packages/@nodefony/realtime/nodefony/src/server/RealtimeHub.ts#RealtimeHub.subscribe`).
Une _room_ — une liste de diffusion tenue par le serveur, qui ne sait rien de ce qui produit —
s'obtient en ajoutant au canal une admission par identité (#622, un prédicat) et un abonnement
décidé par le serveur (#623). L'inverse ne se construit pas : une liste de diffusion n'a pas de
producteur. L'événement reste `(canal, charge)` nue (S1), sans identifiant du socle (S2), sans
propriétaire (S7).

- Usages : un tableau de bord (un producteur, N lecteurs), une partie de jeu (producteur partagé
  et membres), un flux de capteur (un producteur, aucun membre).
- Écarté : la room comme primitive ; un producteur par connexion (un seul usage connu, #621).
- **Rupture si différé après 10.0 : NON**, parce que #622 et #623 n'ajoutent qu'un membre
  optionnel et des notifications neuves (décisions 5 et 8 de #630).

### 2. L'enveloppe JSON-RPC 2.0 et ses codecs

**Décision (validée par l’auteur le 2026-10-29, en deux temps : le principe, puis le calendrier des codecs) :** une seule enveloppe, JSON-RPC 2.0, et des **codecs** qui n'en sont que la
sérialisation, choisie une fois par connexion. Repris de #630 : sans sous-protocole, le format est
celui d'aujourd'hui — JSON-RPC texte, nommé **`v1`** — pour toute la série 10 (décision 1) ; le
codec effectif se lit dans `realtime:welcome` par un champ optionnel (absent = texte), **jamais**
dans l'écho du handshake, et le défaut d'écho de `ws` ne change pas en 10.x (décision 2). Ajouté :

- **`IFrameCodec`** dans le code partagé : `encode(frame): string | Uint8Array`,
  `decode(data: string | Uint8Array): unknown`, un `protocol`. Par frame il remplace
  `JSON.stringify` / `JSON.parse` : aucun appel de plus ; le codec JSON **est** ces deux appels
  natifs. Un codec n'est éligible que s'il compile sous `tsconfig.shared.json` — ni `Buffer`, ni
  DOM — et borne longueur et profondeur d'une trame hostile (RFC 8949 §10).
- **Trois noms versionnés** : `nodefony.jsonrpc.v1`, `nodefony.jsonrpc.cbor.v1` (RFC 8949),
  `nodefony.jsonrpc.protobuf.v1`. Le client les offre (RFC 6455 §1.9), le serveur lit la liste
  au handshake (`src/packages/@nodefony/realtime/nodefony/interfaces/IRealtimeHandshake.ts#IRealtimeHandshake`)
  et annonce son choix dans l'accueil. Une enveloppe qui change = `v2` ajouté, `v1` gardé.
- **L'accueil est toujours une trame texte `v1`**, qui porte le codec choisi ; les frames
  suivantes l'emploient. Un serveur 10.0 n'émet pas ce champ, un client 10.2 reste donc en
  texte : le déploiement progressif tient malgré l'écho de `ws`, qui renvoie le premier
  sous-protocole offert (constaté dans #627 sur `ws` 8.22, la version qu'installent `nodefony`
  et `@nodefony/http`).
- **Protobuf** : une enveloppe `.proto` **fixe** fournie par Nodefony (`id`, `method`, `error`,
  `params: bytes`, `result: bytes`) ; la charge est encodée par le message que le contrat
  déclare pour **cette** méthode ; sans schéma, la charge passe en CBOR dans les `bytes`.
  Bibliothèque : `@bufbuild/protobuf`, la seule que le framework aurait si l'Epic gRPC #694
  aboutit. Elle n'est aujourd'hui dans l'arbre que par le module de test et l'outillage de build
  (`npm ls @bufbuild/protobuf`) : aucun paquet publié ne l'installe, l'ajouter serait une
  dépendance neuve pour chaque application.
- **Calendrier.** Les trois noms sont réservés dès 10.0. Aucun codec autre que JSON n'est dans le
  paquet de base : chacun est optionnel, chargé par la seule application qui l'active. **CBOR**
  est le premier livré, **dans la série 10.0** (décision de l'auteur, 2026-10-29), en sous-ticket
  de #618, après #622, #623, #628 et #629 — ceux-là fermeraient une porte, lui non. **Protobuf** n'arrive qu'avec l'Epic gRPC
  #694 : un seul usage connu d'ici là (règle de #621), et une dépendance que gRPC rendra de toute
  façon nécessaire ; son enveloppe ci-dessus est une intention, pas un engagement.
- **JSON est la référence de tous les codecs** (remplace la règle « refus à l'encodage »,
  décision de l'auteur du 2026-10-29, après le banc) : quel que soit le codec, on reçoit **ce que
  `JSON.stringify` puis `JSON.parse` rendraient** — une `Date` devient sa chaîne ISO, `NaN` devient
  `null`, `Map`/`Set` deviennent `{}`. Seule exception, les octets : un `Uint8Array` reste un
  `Uint8Array` (S8 ; base64 sous convention dans le codec JSON). Ainsi une connexion se rejoue en
  texte sans qu'une ligne métier bouge, et un client CBOR et un client JSON abonnés au même canal
  reçoivent la même chose — le relais entre exemplaires, en JSON (S6), l'imposait déjà.
  - **Le type le montre** : le contrat type la valeur REÇUE par un `Jsonify<T>` (à écrire, absent
    du dépôt) — `debut: Date` à l'émission devient `debut: string` à la réception, visible dans
    l'éditeur, sans coût d'exécution. Précédents : tRPC (sans transformateur), Hono
    (`JSONParsed<T>`).
  - **Chaque codec est aligné et le prouve** : un test par codec rend, pour chaque valeur du banc
    (`NaN`, `Infinity`, `undefined` en tableau, `Date`, `Map`, `Set`, `-0`, `bigint`), exactement ce
    que rend JSON — `bigint` compris, que JSON refuse. Protobuf suit sa correspondance JSON
    canonique.
  - **Le développement prévient** : une valeur que JSON transforme (`Date`, `NaN`, `Map`…) donne un
    avertissement UNE fois par méthode ou canal — presque toujours un oubli. Rien en production.
  - Écarté : **tout refuser** (un parcours par message, et une rupture pour les applications qui
    publient une `Date` aujourd'hui) ; **tout transporter** à la superjson (format maison que ni
    un client d'un autre langage ni le relais ne lisent). Précédent du modèle commun : WAMP, dont
    le routeur traduit entre clients JSON, CBOR et MessagePack.
- **Débogage par décodage à l'observation**, jamais en changeant le fil : le traceur WS
  (`src/packages/@nodefony/http/nodefony/src/context/websocket/wsLogContent.ts#formatWsLogContent`),
  Studio et la barre de debug affichent une trame binaire décodée ; coût nul en production, où
  le traceur est fermé. Un interrupteur de développement force `nodefony.jsonrpc.v1` pour lire le
  fil brut dans le navigateur — une exception, pas la voie normale, car passer en texte change
  les conditions (taille, contre-pression).

- Usages : une discussion (JSON, lisible), un document partagé (CBOR, octets sans base64), un
  jeu à état figé (protobuf, un schéma par message).
- Écarté : MessagePack au socle (pas une norme IETF ; enfichable si un écosystème le réclame) ;
  BSON (stockage) ; un schéma obligatoire pour l'enveloppe ; un décodeur CBOR maison avant le
  banc. La bibliothèque CBOR sort d'un banc contre `JSON.parse` natif — octets, µs par frame,
  poids dans `.size-budgets.json` — sur des critères écrits d'avance : objets ordinaires sans
  conversion par frame, aucun `Buffer` (le client est un navigateur), aucun module natif
  obligatoire (Windows), CBOR standard sans extension propriétaire (un pair d'un autre langage
  doit pouvoir lire), alignement sur la référence JSON. Candidats : `cbor-x`, `cborg`, et
  `@levischuck/tiny-cbor` en référence seulement — installé par `@nodefony/security`
  (`@simplewebauthn/server`), mais il ne rend que des `Map`, jamais un objet ordinaire, ce qui
  coûterait une conversion par frame. Une richesse de types (`Date`, `Set`, `bigint`) n'est pas
  un critère : la référence JSON ci-dessus la ramène à ce que JSON rend.
- **Banc fait (2026-10-29)** — Node 26.13, macOS x64, médiane de 5 ; 14 types (entiers, flottants,
  booléens, textes ASCII/unicode/8 Ko, tableaux, imbrications, binaire de 64 o à 1 Mo) et 9
  valeurs hors modèle. L'accélérateur C++ `cbor-extract` de `cbor-x` (vérifié actif) n'apporte
  rien, parfois moins (texte 8 Ko décodé 4,0 µs contre 2,6 µs). Sur un message ordinaire, JSON
  encode 2 à 4 fois plus vite que CBOR, qui gagne 30 à 45 % d'octets : **CBOR ne devient jamais
  le défaut**. Sur le binaire, CBOR décode une vue sans copie : 64 Ko en 1,2 µs contre 91 µs en
  JSON base64, 1 Mo en 1,2 µs contre 1,97 ms. Le banc a aussi révélé que le codec JSON transforme
  (`NaN` → `null`, `Date` → chaîne, `Map`/`Set` → `{}`) quand `cbor-x` garde tout : d'où la
  référence JSON ci-dessus.
- **Retenu : un codec CBOR propre à Nodefony** (décision de l'auteur, 2026-10-29), dans le code
  partagé `src/nodefony/src/realtime/codec/` — isomorphe, sans dépendance, sans `eval`. Aucune
  bibliothèque ne tenait les deux exigences à la fois :
  - `cbor-x` (la plus rapide) ne peut pas s'aligner sur JSON sans parcourir chaque message (aucun
    crochet sur les nombres ; une extension pour `Date` vaut pour tout le process), appelle
    `new Function('')` au chargement (violation sous notre CSP), et tire un module natif
    optionnel à script d'installation ;
  - `cborg` (stricte, alignable par ses `typeEncoders`) encode 4 à 5 fois plus lentement et copie
    chaque chaîne d'octets (1 Mo décodé en 545 µs contre 1,6 µs).

  Le prototype mesuré : **encodeur** qui suit l'algorithme de `JSON.stringify` (ECMA-262
  `SerializeJSONProperty`), donc aligné par construction (13/13 valeurs piégées), au niveau de
  `cbor-x` à l'encodage (50 objets : 51 µs contre 53 µs ; `cborg` 225 µs) ; **décodeur restreint au
  modèle** (JSON + octets ; étiquettes refusées), 10/10 messages hostiles refusés proprement,
  binaire en vue sans copie, à 1,2-1,5 fois de `cbor-x` sur les objets, 2 à 340 fois plus rapide
  que `cborg`. Exigences du codec livré : conformité RFC 8949 (sérialisation préférée §4.1,
  flottants au plus court, longueurs indéfinies acceptées au décodage, clés en double et UTF-8
  invalide refusés, bornes §10), vecteurs des appendices A et F en tests, chaque garde vue rouge.
  `cbor-x` et `cborg` ne sont que des références de banc (`micro-cbor-codec.mjs`), jamais des
  dépendances.

- **Rupture si différé après 10.0 : NON**, parce que les décisions 1 et 2 de #630 rendent tout
  codec additif. Ce qui serait une rupture, et qui est écrit : le nom `v1` et la lecture du codec
  dans l'accueil — un format renommé ou un codec déduit de l'écho changerait le fil d'un client
  déjà déployé.

### 3. Le binaire, routé par canal, par les mêmes portes que le texte

**Décision (validée par l’auteur le 2026-10-29) :** une trame binaire routée **n'est pas une seconde grammaire** : c'est une
notification JSON-RPC dont la charge est, ou contient, un `Uint8Array` (S8), et le codec dit
comment il la porte — chaîne d'octets native en CBOR (type majeur 2), `bytes` en protobuf, base64
sous une convention déclarée pour le codec JSON. Elle passe donc par **les mêmes portes** que le
texte, sans seconde implémentation : verrou de trame
(`src/packages/@nodefony/realtime/nodefony/src/server/RealtimeHub.ts#RealtimeHub.runAuthorizer`,
B1), politique de canal (`#RealtimeHub.probeChannel`, `#RealtimeHub.subscribeClient`, B2), audit
des refus (B3), sonde (`#RealtimeHub.recordInbound`, B4 — membres optionnels, décision 8 de #630,
vocabulaire S9). Le crochet brut
`src/packages/@nodefony/realtime/nodefony/src/server/RealtimeController.ts#RealtimeController.onRealtimeBinary`
reste hors du verrou pour toute la série, identité par `RequestContext` (décision 3 de #630) :
il sert un protocole binaire écrit par l'application, sans canal.

- Usages : un capteur qui pousse des mesures compactées, un document partagé qui diffuse ses
  deltas binaires, la voix (#626).
- Écarté : une trame binaire à en-tête maison sous le codec texte — une seconde grammaire, donc
  un second verrou et une seconde sonde, qui divergent en silence.
- Constaté (relevé de #618) : contre-pression sortante et `maxPayload` couvrent déjà le binaire
  (`src/packages/@nodefony/realtime/nodefony/src/transport/WsConnectionTransport.ts#WsConnectionTransport.sendBinary`,
  `src/packages/@nodefony/http/nodefony/config/config.ts#websocketSchema`) ; B1 à B4 sont
  contournés parce que le binaire va droit au crochet (`#RealtimeController.receiveBinary`). À
  prouver dans #618 : chaque porte vue rouge en la débranchant ; un `Uint8Array` intact par le
  pilote Redis, supposé corrompu (S8).
- **Rupture si différé après 10.0 : NON**, parce que le chemin routé n'existe pas en 10.0 et que
  le crochet brut est gelé par la décision 3.

### 4. L'isomorphisme — le transport l'est, le contrat doit l'être

**Décision proposée :** fermer les cinq trous de #627 §4, dont deux le sont déjà.

| Trou                                 | État constaté                                                                                                                                                                                                                                                 | Geste                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| (i) binaire asymétrique              | **fermé** (#630) : `Uint8Array` des deux côtés, vue sans copie                                                                                                                                                                                                | #618 : routage et codecs dans le pair **partagé**, jamais dans `RealtimeController` ni `NodefonySocket` |
| (ii) `request` promis sans être tenu | **fermé** (#630) : hors d'`IRealtimeSocket` ; `src/packages/@nodefony/realtime/nodefony/src/server/ServerRealtimeSocket.ts#ServerRealtimeSocket.request` reste, `@deprecated`, retrait en 11.0                                                                | rien                                                                                                    |
| (iii) réception serveur non typée    | ouvert : `src/packages/@nodefony/realtime/nodefony/interfaces/IRealtimeController.ts#RealtimeInboundHandler` prend `params: unknown` ; `RealtimeController<Emit, Actions>` sans `Listen`                                                                      | #628                                                                                                    |
| (iv) actions non vérifiées           | ouvert : `#RealtimeController.realtimeActions` rend `Record<string, RpcActionHandler>`, `#RealtimeController.realtimeChannels` rend `string[]`, `src/packages/@nodefony/realtime/nodefony/decorators/realtimeDecorators.ts#RealtimeAction` prend un nom libre | #628, surface **opt-in** (décision 6 de #630)                                                           |
| (v) inversion Emit/Listen à la main  | ouvert : la convention vit en commentaire (`src/nodefony/src/realtime/RealtimeEventMap.ts#EventsMap`)                                                                                                                                                         | #628                                                                                                    |

**Forme du contrat unique.** Contraintes : coût d'exécution nul (génériques effacés, JS bâti
identique) ; un générique ne s'ajoute qu'**en fin** et **avec défaut** (décision 6 de #630) ;
`NodefonySocket<Emit, Listen, Actions>`, `ServerRealtimeSocket<Emit, Listen, Actions>` et
`RealtimeController<Emit, Actions>` gardent leur ordre. Les deux options, vues de l'application.

**Option A — troisième générique `Listen` et types utilitaires.** Chaque côté dérive ses trois
cartes d'un contrat par des types nommés qui portent la direction.

```ts
interface ChatContract extends IRealtimeContract {
  // déclaré une fois, code partagé
  serverToClient: { "chat:room": { from: string; text: string } };
  clientToServer: { "chat:typing": { on: boolean } };
  actions: { "chat:send": { in: { text: string }; out: { id: string } } };
}
// navigateur
const socket = new NodefonySocket<
  ClientEmit<ChatContract>,
  ClientListen<ChatContract>,
  ContractActions<ChatContract>
>({ url });
// serveur — `Listen` ajouté en 3ᵉ, défaut `DefaultEventsMap`
class ChatRt extends RealtimeController<
  ServerEmit<ChatContract>,
  ContractActions<ChatContract>,
  ServerListen<ChatContract>
> {
  @RealtimeAction("chat:send") send(p: { text: string }): { id: string } {
    /* … */
  }
}
```

Ferme (iii). Ne ferme (iv) que si le décorateur connaît le contrat, ce qu'un `MethodDecorator`
ne peut pas : il ne voit pas les génériques de la classe. Ne ferme pas (v) : la direction est
encore écrite par l'application, à chaque site, dans le bon ordre.

**Option B — générique de contrat, par une fabrique.** Le contrat est déclaré une fois ; une
fabrique en dérive les deux classes **et** les décorateurs. La direction vit dans la fabrique.

```ts
const chat = defineRealtimeContract<ChatContract>(); // une allocation, au chargement
// navigateur
const socket = new chat.Socket({ url }); // NodefonySocket<ClientEmit, ClientListen, Actions>
socket.on("chat:room", (m) => m.text); // typé
// serveur
class ChatRt extends chat.Controller {
  // RealtimeController<ServerEmit, Actions, ServerListen>
  @chat.RealtimeAction("chat:send") // nom contraint, signature vérifiée
  send(p: { text: string }): { id: string } {
    /* … */
  }
  protected override realtimeInbound() {
    // clés et params contraints par clientToServer
    return {
      "chat:typing": (p, reply) => {
        /* p: { on: boolean } */
      },
    };
  }
}
```

Deux autres formes d'un générique de contrat sont écartées : un quatrième générique positionnel
(il obligerait à écrire les trois défauts devant lui) et une surcharge du **premier** générique
par un type conditionnel (elle réécrit toutes les signatures publiées, et un contrat passé sans
marque serait lu comme une carte de trois canaux).

**Recommandation : l'option B, bâtie sur les génériques de l'option A.** `Listen` s'ajoute en
troisième position de `RealtimeController` avec défaut (nécessaire aux deux options) ; les types
utilitaires existent déjà en partie (`src/nodefony/src/realtime/RealtimeEventMap.ts#ContractParams`,
`#TypedRpcActionHandler`) ; la fabrique est la surface opt-in que #630 réserve à la vérification
des actions, et la **seule** voie par laquelle un décorateur connaît les noms du contrat. Un
contrôleur non paramétré reste permissif sur les deux voies (cas « rétro-compat » de
`src/packages/@nodefony/realtime/nodefony/tests/unit/realtimeSharedContract.types.test.ts`, à
garder vert tel quel). Le pair reste rangé sous son contrat effacé sur la connexion et relu par
`src/nodefony/src/realtime/JsonRpcPeer.ts#JsonRpcPeer.requestAs` (#620) : la fabrique ne le
re-paramètre pas.

- Usages : une discussion (deux sens), un jeu (entrées client typées), un tableau de bord
  (canaux serveur seuls — `clientToServer` peut rester vide).
- **Rupture si différé après 10.0 : NON**, parce que tout est générique en fin avec défaut, ou
  fabrique opt-in. (ii) était la rupture, et elle est faite.

### 5. Contre-pression et bornes

**Décision proposée :** **une règle, trois endroits.** Sortante serveur :
`src/packages/@nodefony/http/nodefony/src/context/websocket/wsBackpressure.ts#decideSend` reste
l'unique arbitre — jeter au-delà du seuil, fermer `1013` sur un solde de refus — texte et binaire.
**C1**, sortante client : la **même** fonction sur `WebSocket.bufferedAmount` du navigateur ;
pure, elle **descend dans le code partagé** du cœur (`src/nodefony/src/realtime/`), et
`@nodefony/http` l'importe de là. **C2**, débit entrant par connexion : le patron du canal des
journaux (`src/packages/@nodefony/realtime/nodefony/src/server/syslogUplink.ts#SyslogUplinkHandlerOptions`
— fenêtre par connexion, compteur alloué paresseusement) généralisé au transport, dans
`@nodefony/http` à côté de `maxPayload` ; au-delà, trame **écartée et comptée**, puis fermeture
`1008` sur un solde, calqué sur `backpressureCloseAfterDrops`. Les deux naissent **désactivées**
en 10.x (décision 7 de #630).

- Usages : un tableau de bord diffusé à N lecteurs dont un lent, un jeu sur réseau mobile qui
  pousse ses coups (C1), un capteur qui émet trop vite (C2).
- Écarté : une copie de `decideSend` côté client gardée par un test de comparaison (le
  déplacement suffit) ; une fermeture immédiate pour C2 (un pic passager n'est pas une attaque).
- **Rupture si différé après 10.0 : NON**, parce que les bornes neuves naissent désactivées et
  que le déplacement est interne. Activer plus tard un défaut casserait un flux audio à
  50 trames/s : le défaut est écrit maintenant pour cette raison.

### 6. Les canaux privés

**Décision proposée :**

- **Admission par prédicat** (#622) : `admit?: (channel, token) => boolean`, membre optionnel de
  `src/packages/@nodefony/realtime/nodefony/interfaces/IChannelPolicy.ts#IChannelPolicy`, évalué
  dans `src/packages/@nodefony/security/nodefony/src/realtime/frameAuthorizer.ts#satisfies` après
  `authenticated` / `roles` / `scopes`, donc sur les trois chemins existants (abonnement, entrée
  client, annonce de l'accueil). Synchrone ; un prédicat qui lève = refus `forbidden`, détail hors
  production. Une liste de membres est **une** façon d'écrire un prédicat, pas une primitive (S7).
- **Abonnés identifiables** (#623) : le registre d'un canal associe chaque sink à sa connexion,
  alloué au `subscribe` seulement ; le fan-out reste une boucle sans allocation. API serveur,
  **locale au pod** : lister, éjecter, abonner d'office, fermer.
- **Abonnement imposé** : par la **même sonde** que l'accueil (`#RealtimeHub.probeChannel`) — la
  politique reste le plancher, le serveur décide qui.
- **Fermeture** : `realtime:closed { channel, reason }` (S4), motif **fermé** — `ended` (le canal
  est terminé) ou `evicted` (cette connexion en est retirée) — déclarée à côté de
  `src/nodefony/src/realtime/RealtimeEventMap.ts#IRealtimeDenied`. Le client retire l'abonnement
  et **ne le rejoue pas** ; `RealtimeDeniedReason` ne bouge pas (décision 5 de #630).
- **Ce qui traverse le backplane** : la publication `{ channel, payload, originId }` des seuls
  canaux déclarés diffusables (S6, `#RealtimeHub.markBroadcastChannel`) — ni membres, ni
  politiques, ni acquittements, ni fermeture. Un message venu du bus n'atteint que des abonnés
  **déjà admis** sur leur pod (constaté : l'ingress ne vérifie que le préfixe, puis sert local).
- **Cas `transcript:<id>` (#626) en multi-pod** : l'audio arrive sur un pod, l'abonné au texte
  peut être ailleurs. Décision : préfixe `transcript:` déclaré diffusable **et** prédicat `admit`
  sur le motif `transcript:*` — la charge traverse, l'admission se rejoue sur chaque pod.
  L'affinité de pod est une option de déploiement, pas une règle. La fermeture reste locale en
  10.x : qui doit clore sur tous les pods publie son signal de fin **dans** sa charge (S6). À
  prouver dans #623 : un éjecté sur le pod A, abonné sur le pod B, n'est pas servi par B.

- Usages : une notification `user:42` (sans média, sans agent), un salon fermé de jeu ou de
  collaboration, un appel (#619).
- Écarté : un propriétaire dans l'événement (S7) ; une appartenance sur le bus (elle étendrait
  l'enveloppe, S6) ; une seconde voie d'application du prédicat dans realtime — sans
  `@nodefony/security`, rien n'est refusé et un avertissement le dit
  (`src/packages/@nodefony/realtime/nodefony/tests/unit/realtimeUnenforcedPolicy.attack.test.ts`).
- **Rupture si différé après 10.0 : NON**, parce que membre optionnel, notification neuve et API
  neuve sont additifs. Écrire maintenant « appartenance et fermeture locales » évite qu'une
  application s'appuie sur une portée cluster qu'on ne tient pas (S5).

### 7. La reprise côté socket

**Décision proposée :** aujourd'hui, la reconnexion **rejoue** chaque abonnement au `welcome`
(`src/nodefony/src/client/realtime/NodefonySocket.ts#NodefonySocket.replaySubscriptions`), sans
curseur ; la fabrique est rejouée au premier abonné. Demain (10.2, S3) : `subscribe
{ channel, since? }`. Le curseur est **par abonné** alors que la fabrique est partagée et
appelée une fois : il l'atteint par un retour élargi — à côté du `dispose` d'aujourd'hui, un objet
`{ dispose, resume?(since, reply) }`, où `reply` ne pousse qu'à **cette** connexion. La fabrique
décide : la suite depuis le curseur, l'état courant, ou rien. Sans curseur, rien ne change.

- Constaté par lecture : un serveur 10.0 **ignore** un champ inconnu dans `params` d'un
  `subscribe` — `src/packages/@nodefony/realtime/nodefony/src/server/RealtimeController.ts#channelParam`
  ne lit que `channel`, `src/nodefony/src/jsonrpc/index.ts#classifyJsonRpcFrame` ne juge pas
  `params`, `src/packages/@nodefony/security/nodefony/src/realtime/frameAuthorizer.ts#authorizeChannel`
  ne lit que le canal. C'est la condition de S3 ; elle se **prouve** par le contrôle de
  compatibilité entre versions (section 10, #629).
- À écrire dans `src/packages/@nodefony/realtime/docs/protocole.md`, qui ne le dit pas : la
  reconnexion (rejeu au `welcome`, acquittement, curseur) et la fin de flux (`realtime:closed`).
- Usages : une discussion reprise au dernier message vu, une courbe au dernier point, des
  notifications manquées.
- Écarté : « l'instantané puis la suite » comme règle (un choix de protocole, S3) ; un curseur
  passé à la fabrique partagée par son premier appel (il ne servirait que le premier abonné).
- **Rupture si différé après 10.0 : NON**, parce que paramètre optionnel et retour élargi d'un
  rappel implémenté par l'application sont additifs.

### 8. La voix, au niveau transport seulement

**Décision proposée :** un flux binaire **à sens unique** va sur un canal binaire de la socket
(section 3) : la transcription (#626) y suffit, la latence y compte moins. Une conversation **dans
les deux sens** (#619) choisit entre WebSocket et WebRTC **par la mesure**, selon un critère nommé
une fois ici : latence de bout en bout mesurée, comportement sur réseau mobile, annulation d'écho
haut-parleur ouvert. Opus par WebCodecs sur la socket et les options Opus de WebRTC sont deux
couches distinctes. Capture, contraintes micro, codec audio, découpage en trames et détection de
parole appartiennent à l'ADR média (#624).

- Usages d'un flux binaire à sens unique : une dictée, la télémétrie d'un capteur, la
  synchronisation d'un document.
- Écarté : décider WebRTC ou WebSocket ici, sans mesure.
- **Rupture si différé après 10.0 : NON**, parce que tout vit sous des sous-chemins neufs.

### 9. La règle d'admission perf d'une évolution

**Décision proposée :** rien n'entre sur le chemin d'une frame sans trois preuves, dans l'ordre :
(1) le **JS bâti** du chemin chaud comparé à la référence `HEAD`, bâtie hors de l'arbre par
`git archive` — jamais en copiant le `dist` courant ; (2) le banc A/B
`.claude/skills/nodefony-load-test/scripts/micro/micro-realtime-frame-ab.mjs`, chemins `inbound`,
`notify`, `binary` (et `publish`, à ajouter avant #623), `--runs 15`, verdict sur **deux passages
de même signe** ; (3) le gate mémoire (`cd src/packages/@nodefony/http && npm run test:memory`,
ligne `[retention] WS JSON-RPC peer round-trips`, référence 0,29 Ko/itération après #620).
Chiffres dans le commit si l'écart dépasse 5 %. Un générique effacé ne paie rien ; une vue sans
copie, une allocation à l'abonnement, un codec remplaçant `JSON.parse` se mesurent.

- **Rupture si différé après 10.0 : NON** — une méthode, pas une surface.

### 10. Les garde-fous — condition d'admission de toute évolution

**Décision proposée :** les cinq contrôles de #627 §10, chacun vu **rouge** une fois.

| #   | Contrôle                                                                                                                                                                                                                                                       | État                                                                                                                                                                         | Qui le lance                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 1   | compilation **neutre** du code partagé (`lib: ["ES2022"]`, `types: []`)                                                                                                                                                                                        | **livré** (#630) : `src/nodefony/tsconfig.shared.json`, vu rouge sur `Blob` puis `Buffer`                                                                                    | `npm run typecheck` du cœur                           |
| 2   | contrat vérifié **dans les deux sens**                                                                                                                                                                                                                         | #628 : `realtimeSharedContract.types.test.ts` étendu — action manquante, forme fausse, entrée mal lue, canal hors `Emit`, inversion — chacune un `@ts-expect-error` qui mord | `npm run typecheck` du paquet (`tsconfig.tests.json`) |
| 3   | suite de conformité **unique** d'`IRealtimeSocket`, contre les deux implémentations                                                                                                                                                                            | #629, sur le banc en boucle `src/packages/@nodefony/realtime/nodefony/tests/integration/realtimeLoopback.e2e.test.ts`                                                        | `npm test` des paquets                                |
| 4   | fixtures d'octets **dorées** : accueil, requête, réponse, erreur, notification, trame à octets, par codec — **et l'enveloppe backplane**, trois champs plus sceau (`src/packages/@nodefony/realtime/nodefony/src/backplane/envelope.ts#sealBackplaneEnvelope`) | #629 ; relues dans Node **et** dans un vrai navigateur (#631) ; un octet changé = rupture de fil **déclarée**, fixtures régénérées dans le même commit                       | `npm test` ; navigateur par #631                      |
| 5   | compatibilité **entre versions** : client de la dernière version publiée ↔ serveur courant, et l'inverse                                                                                                                                                       | #629, à côté de `scripts/release/api-diff.mjs` (`npm run release:api-diff`) ; le serveur garde `v1` tant qu'il est annoncé                                                   | chaîne de release                                     |

Constaté et non gardé : `src/packages/@nodefony/realtime/tsconfig.json` compile le **serveur**
avec le DOM. Proposé, à l'accord de l'auteur (c'est un tsconfig) : un second projet neutre pour
`nodefony/src/**` du paquet, `lib: ["ES2022"]`, `types: ["node"]`, dans son `typecheck`. Une
rupture de fil suit la politique de l'API : majeure, et une version de sous-protocole de plus.

- **Rupture si différé après 10.0 : NON** — mais sans le contrôle 5 une rupture de fil ne se
  verrait pas, et le contrôle 4 fixe les octets que la série 10 promet.

### Normes

| Norme                        | Ce qu'elle tranche ici                                                                                                                                                                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RFC 6455 §1.9, §4.2.2, §11.5 | le serveur choisit **un** sous-protocole parmi ceux offerts, ou aucun ; un nom se préfixe par un domaine, enregistrable à l'IANA — d'où `nodefony.jsonrpc.*.v1`                                                                                             |
| RFC 6455 §4.1                | le client **doit** échouer si le serveur répond un sous-protocole non offert : l'écho de `ws` ne viole rien, et ne décide rien (section 2)                                                                                                                  |
| RFC 6455 §5.6, §7.4.1        | une trame binaire est « arbitrary binary data whose interpretation is solely up to the application layer » — le routage par canal est une décision applicative ; `1008` politique (C2), `1009` trop gros (`maxPayload`), `1013` réessayer (contre-pression) |
| JSON-RPC 2.0 §1, §4.1, §5.1  | « transport agnostic » : une enveloppe, trois codecs ; une notification est une requête sans `id` (le canal) ; codes réservés, plage serveur `-32000` à `-32099` (refus du verrou)                                                                          |
| RFC 8949 §3.1, §8, §10       | type majeur 2 = octets sans base64 ; la notation diagnostique « is not meant to be parsed » — observation, jamais le fil ; longueurs et imbrication hostiles : borner avant d'allouer                                                                       |

### Contrôle de non-blocage — A2A

Une liaison A2A **personnalisée** sur WebSocket peut-elle se bâtir sur la socket sans que la socket
la connaisse ? Lu dans A2A 1.0.1 §5.8 et §12 (figé hors ligne).

| Ce que la liaison doit fournir                            | Par quoi, sans rien ajouter à la socket                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| une URI versionnée par rupture (§5.8)                     | le sous-protocole versionné ou l'URL de l'endpoint — choix du contrôleur consommateur |
| opérations, résultats, erreurs équivalents (§12.1, §12.4) | des actions JSON-RPC d'un `RealtimeController` ; erreurs = objets JSON-RPC            |
| paramètres de service sans en-têtes (§12.3)               | un champ de `params`, nommé par la liaison                                            |
| flux, ordre, reconnexion, fin (§12.5)                     | canaux ; ordre S5 ; rejeu et curseur (section 7) ; `realtime:closed` (S4)             |
| authentification (§12.6)                                  | handshake, authentificateur, verrou de trame — déjà là                                |

**Pas empêché.** Seul écart, documentaire : `docs/protocole.md` doit écrire la reconnexion et la
fin de flux (section 7). Aucun vocabulaire d'A2A n'entre dans la socket.

## Alternatives écartées

- **Une room comme primitive** (1) : sans producteur, elle ne couvre pas le canal.
- **MessagePack, BSON, un décodeur maison avant le banc** (2).
- **Un format binaire à en-tête maison** (3) : une seconde grammaire, donc un second verrou.
- **Un quatrième générique positionnel, ou un premier générique surchargé** (4).
- **Deux copies de `decideSend`** (5) : deux règles qui divergent en silence.
- **L'appartenance sur le bus** (6) : elle étendrait l'enveloppe figée (S6).
- **Le curseur passé à la fabrique partagée** (7) : il ne servirait que le premier abonné.

## Conséquences

- Engagements de la série 10, au même titre que les décisions de gel de #630 : le nom `v1`, la
  lecture du codec dans l'accueil, l'accueil toujours en texte, le crochet brut hors verrou, les
  bornes neuves désactivées, l'appartenance et la fermeture locales au pod.
- #628 livre `Listen` en troisième générique de `RealtimeController` avec défaut, les types
  utilitaires et `defineRealtimeContract` ; #618 livre `IFrameCodec`, CBOR, les trois noms de
  sous-protocole et le binaire routé ; #622 et #623 les canaux privés ; #629 les contrôles 2 à 5.
- **Preuves à apporter** : B1 à B4 vus rouges en débranchant (#618) ; un `Uint8Array` intact par
  le pilote Redis (#618, S8) ; un champ inconnu dans `subscribe` ignoré par un serveur publié
  (#629, contrôle 5) ; un éjecté sur un pod non servi par un autre (#623) ; la bibliothèque CBOR
  choisie au banc (#618) ; le poids du moteur protobuf dans `nodefony/client` face à
  `.size-budgets.json` (#618).
- À l'accord de l'auteur : un tsconfig neutre pour le serveur du paquet realtime (section 10).
- `docs/protocole.md` écrit la reconnexion et la fin de flux avant qu'un protocole tiers s'y appuie.

## Références

- [ADR-0021](0021-temps-reel-evenement-et-livraisons.md) — le socle (S1 à S9) ·
  [ADR-0023](0023-webhooks-evenements-et-abonnements.md) — les webhooks ·
  [ADR-0007](0007-clientkernel-isomorphe-contrat-runtime-client.md) — le client isomorphe
- RFC 6455, The WebSocket Protocol — <https://www.rfc-editor.org/rfc/rfc6455>
- JSON-RPC 2.0 — <https://www.jsonrpc.org/specification>
- RFC 8949, CBOR — <https://www.rfc-editor.org/rfc/rfc8949>
- Protobuf, correspondance JSON canonique — <https://protobuf.dev/programming-guides/json/>
- A2A 1.0.1 — <https://a2a-protocol.org/v1.0.0/specification> (§5.8, §12)
- [Politique de compatibilité](../guides/compatibilite.md)
- Tickets : #621 (Epic), #627, #630 (décisions de gel, commit `1df6614c1`), #618, #620, #622,
  #623, #624, #626, #628, #629, #631, #619, #694
