# Des octets dans le temps réel — mode d'emploi complet

> Chargé depuis `SKILL.md` dès qu'une charge contient des octets (`Uint8Array`, `Buffer`, CBOR,
> `$bytes`). Tout ce qui suit se vérifie dans la documentation installée :
> `node_modules/@nodefony/realtime/docs/protocole.md` (section « Des octets dans la charge »),
> `node_modules/@nodefony/realtime/docs/configuration.md` (clé `codec`),
> `node_modules/nodefony/docs/client.md` (« Choisir le codec de trame »),
> `node_modules/nodefony/docs/cbor.md` (le codec lui-même).

## Sommaire

1. [Le modèle](#1-le-modèle--une-frame-comme-les-autres)
2. [Mise en place](#2-mise-en-place--deux-lignes-une-par-côté)
3. [Publier et recevoir](#3-publier-et-recevoir)
4. [Canal ou flux brut ?](#4-canal-ou-flux-brut-)
5. [Lire des octets sans se tromper](#5-lire-des-octets-sans-se-tromper)
6. [Plusieurs serveurs](#6-plusieurs-serveurs)
7. [Chaque message, sa cause, ton geste](#7-chaque-message-sa-cause-ton-geste)
8. [Ce qui arrive SANS message](#8-ce-qui-arrive-sans-message)
9. [Prouver que ça marche](#9-prouver-que-ça-marche)

## 1. Le modèle — une frame comme les autres

- Une trame qui porte des octets est une **notification JSON-RPC ordinaire** dont la charge est, ou
  contient, un `Uint8Array`. Il n'y a pas de seconde grammaire.
- Le **codec** ne dit que la forme sur le fil : en CBOR, les octets voyagent tels quels ; sur une
  connexion restée en texte, ils voyagent sous la convention `{"$bytes":"<base64url>"}`, que le
  client relit en `Uint8Array` sans rien importer.
- Le codec se **négocie** par connexion : le navigateur l'offre, le serveur choisit et l'annonce
  dans `realtime:welcome`. Un client qui ne l'offre pas reste en texte — rien ne casse.
- Parce que c'est la même frame, les octets d'un canal passent par **les mêmes gardes** que le
  texte : politique du canal, rôles, audit, sonde.

**N'invente jamais d'en-tête binaire maison** (`[n° de canal][charge]`) : il contournerait toutes
les gardes et serait à maintenir des deux côtés.

## 2. Mise en place — deux lignes, une par côté

Serveur (`nodefony.config.ts`) :

```ts
use("@nodefony/realtime", { codec: "cbor" });
```

Navigateur — à la **PREMIÈRE** création de la socket partagée (souvent le noyau client) :

```ts
import { NodefonySocket } from "nodefony/client";
import { CBOR_FRAME_CODEC } from "nodefony/cbor";

const socket = NodefonySocket.shared({
  url: "/api/room/realtime",
  codec: CBOR_FRAME_CODEC,
});
```

| Serveur                  | Navigateur offre CBOR | Fil retenu | Octets reçus en              |
| ------------------------ | --------------------- | ---------- | ---------------------------- |
| `codec: "cbor"`          | oui                   | CBOR       | `Uint8Array`                 |
| `codec: "cbor"`          | non                   | texte      | `Uint8Array` (via `$bytes`)  |
| `codec: "json"` (défaut) | oui ou non            | texte      | 🔴 objet déformé `{"0":1,…}` |

D'où la règle : **dès que des octets circulent, le serveur passe en `codec: "cbor"`**. Côté
navigateur, offrir CBOR est un gain (≈ 30× plus rapide à recevoir 4 Ko d'octets, ~25 % d'octets en
moins), pas une obligation. Ce gain ne vaut QUE pour des octets : sur des objets ordinaires, CBOR
encode plus lentement que JSON, natif au moteur, et ne décode pas plus vite. N'offre le codec que si
des octets circulent.

## 3. Publier et recevoir

```ts
// serveur — depuis un service, une tâche, un minuteur
import { getRealtimeHub } from "@nodefony/realtime";
getRealtimeHub().publish("capteur:raw", {
  seq: 42,
  frame: new Uint8Array([1, 2, 3]),
});
getRealtimeHub().publish("capteur:raw", new Uint8Array([1, 2, 3])); // charge = les octets seuls

// serveur — dans un RealtimeController, la fabrique du canal reçoit `publish`
// navigateur
socket.subscribe("capteur:raw");
socket.on("capteur:raw", (charge) => {
  /* charge.frame est un Uint8Array */
});
socket.publish("doc:42", { maj: new Uint8Array(update) }); // canal entrant déclaré côté serveur
```

- `subscribe(canal)` prend **un seul argument** ; le handler se pose par `on(canal, handler)`.
- Une charge est un objet, un tableau, des octets, ou absente — jamais un scalaire
  (`publish("c", 42)` lève une `TypeError` qui nomme le canal).
- Un `Buffer` de Node est un `Uint8Array` : il part en octets, jamais en `{type:"Buffer",data:[…]}`.
- Une `Date` revient en chaîne et un `bigint` est refusé — exactement comme en JSON.

## 4. Canal ou flux brut ?

| Besoin                                                  | Voie                                                                                      |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Des octets qui appartiennent à un canal (cas normal)    | `codec: "cbor"` + `publish` / `on(canal)`                                                 |
| Un protocole binaire entièrement propre à l'application | `onRealtimeBinary()` (serveur) / `onBinary()` (navigateur), connexion **texte** seulement |

🔴 **Le flux brut est HORS des gardes.** Une trame reçue par `onRealtimeBinary(data)` ne passe ni
par le verrou de frame ni par les politiques d'action et de canal. Seule la connexion a franchi
l'Origin, l'authentificateur et le pare-feu. Si tu l'emploies, **toute décision d'accès est à
toi** : lis l'identité par `RequestContext.getAuthenticatedUser()` et refuse explicitement.

🔴 **Le flux brut n'existe pas sur une connexion CBOR** : toute trame binaire y est une frame du
codec. `onRealtimeBinary()` n'y est jamais appelée, `sendBinaryToClient()` et `sendBinary()` rendent
`false`. Ne mélange pas les deux voies sur une même application sans le savoir.

Dans le doute, **préfère un canal + `Uint8Array`** (§3) : même politique, mêmes gardes, même bus
entre serveurs — le flux brut ne se justifie que pour un protocole binaire qui n'a pas de canal.

## 5. Lire des octets sans se tromper

- **`DataView` : passe la tranche entière.** `new DataView(data.buffer, data.byteOffset,
data.byteLength)`. Un `Buffer` de Node ne commence pas à 0 dans son tampon : `new
DataView(data.buffer)` lit des octets qui ne sont pas les tiens.
- Côté serveur, `onRealtimeBinary` reçoit un `Buffer` de `ws` typé `Uint8Array` : écris ton
  décodeur sur `Uint8Array`, il servira tel quel dans le navigateur.
- Si tu appelles toi-même `decodeCbor()` sur un tampon que tu réutilises ensuite, **copie** les
  octets décodés à garder (`slice()`) : ce sont des vues sur ce tampon.

### 🔴 Le piège du `$bytes` forgé

Quand le serveur a `codec: "cbor"` et qu'une connexion est restée en texte (la convention d'octets
y est armée), un objet de la forme **exacte** `{ $bytes: "<chaîne>" }` (seule clé, valeur chaîne)
est réservé aux octets. L'encodeur **refuse** d'en envoyer un qui ne vient pas
d'octets : un client texte le relirait en octets, un client CBOR en objet.

```ts
socket.publish("prix", { montant: { $bytes: "12 euros" } }); // 🔴 TypeError
socket.publish("prix", { montant: { $bytes: "12 euros", devise: "EUR" } }); // ✅ deux clés
socket.publish("prix", { montant: { raw: "12 euros" } }); // ✅ autre clé
```

- Navigateur : `emit` / `publish` **lèvent** à la ligne fautive.
- Serveur : la publication n'atteint pas les abonnés texte, une ligne `ERROR` par publication.
- Un tel objet **conservé** (état initial renvoyé à chaque nouvel abonné) est refusé **à chaque
  envoi**. Renomme la clé une fois pour toutes. Ne contourne pas en encodant toi-même en base64.
- Avec `codec: "json"`, `$bytes` est une clé comme une autre : la règle ne s'applique pas.

## 6. Plusieurs serveurs

Les octets traversent le bus entre exemplaires (`redis`, `cluster`) **intacts**, scellés comme le
texte si `backplane.secret` est posé : rien à configurer de plus. Un canal suivi à la fois par des
connexions CBOR et texte paie un encodage par codec, pas un par abonné.

## 7. Chaque message, sa cause, ton geste

Les textes entre guillemets sont recopiés du code ; `<…>` marque une partie variable.

| Où                                                 | Message                                                                                      | Cause                                                                                                                                | Geste                                                                            |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| exception (navigateur) / journal `ERROR` (serveur) | `codec JSON : objet {"$bytes": …} non issu d'octets`                                         | objet applicatif de la forme exacte du marqueur, vers une connexion texte                                                            | envoyer un vrai `Uint8Array`, ou renommer / ajouter une clé (§5)                 |
| journal `ERROR` serveur                            | `rpc <action> : réponse non encodable`                                                       | une `@RealtimeAction` a rendu une valeur que le codec refuse (`$bytes` forgé, cycle, `bigint`) ; le client reçoit `-32603` générique | corriger la valeur rendue                                                        |
| exception                                          | `Impossible d'encoder un BigInt — JSON.stringify le refuse aussi`                            | `bigint` dans la charge, sous CBOR                                                                                                   | convertir en chaîne ou en nombre                                                 |
| exception                                          | `Impossible d'encoder une structure circulaire — JSON.stringify la refuse aussi`             | cycle dans la charge                                                                                                                 | aplatir la donnée                                                                |
| notice navigateur (`-32700`)                       | `Trame binaire écartée : en JSON-RPC texte elle n'a pas de canal`                            | le serveur écrit du binaire brut sur une connexion texte sans `onBinary()`                                                           | lire par `onBinary()`, ou passer par un canal + CBOR                             |
| notice navigateur (`-32700`)                       | `Trame illisible écartée : elle ne se décode pas en <protocole>`                             | trame que le codec ne décode pas                                                                                                     | côté serveur : chercher qui écrit hors du codec                                  |
| notice navigateur                                  | `Codec « <protocole> » annoncé sans avoir été offert : la connexion reste en JSON-RPC texte` | serveur qui annonce un codec que ce client n'a pas offert                                                                            | mettre client et serveur à la même version                                       |
| notice navigateur                                  | `Flux binaire brut indisponible sous <protocole>`                                            | `onBinary()` / `sendBinary()` sur une connexion CBOR                                                                                 | publier les octets sur un canal (§4)                                             |
| journal `WARNING` serveur, une fois par connexion  | `WS realtime : trame binaire reçue et écartée`                                               | binaire brut reçu sur une connexion texte, sans `onRealtimeBinary()`                                                                 | passer par un canal + CBOR, ou surcharger `onRealtimeBinary()` (§4, hors gardes) |
| journal `WARNING` serveur, une fois par connexion  | `WS realtime : sendBinaryToClient refusé`                                                    | `sendBinaryToClient()` sur une connexion CBOR                                                                                        | publier les octets sur un canal                                                  |
| journal `WARNING` serveur, une fois par nature     | `WS realtime : trame binaire illisible pour <protocole> reçue et écartée`                    | trame CBOR malformée ou tronquée ; **aucune réponse** n'est renvoyée (pas d'oracle pour un fuzzer), connexion conservée              | côté client : chercher qui écrit hors du codec                                   |
| exception (`CborError`)                            | `CBOR refusé à l'octet <n> : <raison>`                                                       | `decodeCbor()` appelé par l'application sur des octets invalides ; `err.offset` dit où                                               | valider la source ; ne jamais faire confiance à des octets reçus                 |

## 8. Ce qui arrive SANS message

- **Serveur resté en `codec: "json"`** : un `Uint8Array` part en `{"0":1,"1":2,…}` — aucune erreur.
  C'est le piège n°1 : vérifier la clé `codec` avant tout autre diagnostic.
- **`codec` passé à un `shared()` qui n'est pas le premier** : l'instance existante revient,
  réglages compris ; la connexion reste en texte (un avertissement hors production seulement).
- **`sendBinary()` sur un transport fermé** : rend `false`, compté dans `framesUnsent`, sans notice.
- **Codec non annoncé par l'accueil** : le client reste en texte, sans notice — c'est le cas
  normal d'un serveur en `codec: "json"`.
- **Ne déduis jamais le codec de l'en-tête `Sec-WebSocket-Protocol`** renvoyé au handshake : la
  bibliothèque WebSocket le renvoie qu'elle parle le sous-protocole ou non. Seul `socket.codec`
  fait foi.

## 9. Prouver que ça marche

- `socket.codec` vaut `"nodefony.jsonrpc.cbor.v1"` une fois l'accueil reçu ; `"nodefony.jsonrpc.v1"`
  = texte.
- Compteurs côté navigateur : `socket.binaryFramesDiscarded`, `socket.malformedFramesDiscarded`
  doivent rester à 0.
- Un test qui le prouve publie un `Uint8Array` sur un canal et vérifie que l'abonné reçoit un
  `Uint8Array` **identique** (`instanceof Uint8Array` et mêmes octets) — sous CBOR ET sous texte.
- Pour lire le fil à l'œil dans l'inspecteur réseau : `NF_REALTIME_CODEC=json` remet le serveur en
  texte. Exception de débogage : la taille des trames et la contre-pression changent, aucune mesure
  prise ainsi ne vaut pour la production.
