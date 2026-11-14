---
name: nodefony-add-realtime-binary
metadata:
  version: 1.0.0
description: >
  Fait passer des octets sur la socket Nodefony — mesures de capteurs, image, audio, état de
  jeu compact, document partagé — par le codec CBOR négocié et un `Uint8Array` dans la charge
  d'un canal, sous les mêmes gardes que le texte, au lieu de base64, d'un en-tête binaire maison
  ou d'un WebSocket brut. Dit QUAND le binaire gagne et quand il perd, chiffres mesurés à
  l'appui, comment représenter la donnée (tableau typé, bits tassés, réduction côté serveur), et
  ce qui rate sans un message. À charger AVANT de mettre des octets, un tableau typé ou un flux
  audio/vidéo dans un canal, ou de choisir un codec. Le canal lui-même relève de
  `nodefony-add-realtime-channel`.
  Déclencheurs : "envoyer des octets", "binaire", "données binaires", "CBOR",
  "Uint8Array", "Float32Array", "tableau typé", "base64", "envoyer une image", "audio sur la
  socket", "flux de capteurs", "trames trop grosses", "réduire la bande passante", "mes octets
  arrivent en objet", "$bytes", "codec", "onRealtimeBinary".
---

# add-realtime-binary — des octets dans un canal, sous les mêmes gardes

> 🧭 **Arrivé ici directement ? Charge aussi `nodefony-dev`** (la conduite commune) et
> `nodefony-add-realtime-channel` (le canal qui porte les octets). Cette page ne couvre QUE les
> octets.
>
> Pages installées — **exécute, puis lis** :
>
> ```bash
> node node_modules/@nodefony/devkit/skills/nodefony-dev/scripts/docs.mjs --open cbor
> node node_modules/@nodefony/devkit/skills/nodefony-dev/scripts/docs.mjs codec octets
> ```
>
> `nodefony/docs/cbor.md` (le codec, ses mesures), `nodefony/docs/client.md` (« Choisir le codec
> de trame »), `@nodefony/realtime/docs/protocole.md` (« Des octets dans la charge »),
> `@nodefony/realtime/docs/configuration.md` (clé `codec`).

> **Maintenance** : vérité courante, jamais un journal. Éditer en place ; historique = `git log`.
> Chaque bloc de code est un EXTRAIT d'un fichier exécuté — la démo binaire de l'application
> générée (marqueur `excerpt`) : un test refuse qu'il en diverge.

## 1. Quel besoin → quelle voie

| Tu veux faire passer…                                      | La voie                                                                                             |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| des octets qui appartiennent à un canal (le cas normal)    | `codec: "cbor"` côté serveur + `Uint8Array` dans la charge + `publish` / `on(canal)` (§3)           |
| des séries numériques denses (mesures, positions, spectre) | un tableau typé (`Float32Array`, `Int16Array`…) dans la charge — SI la mesure le donne gagnant (§2) |
| beaucoup de petites valeurs booléennes ou bornées          | des bits tassés dans un `Uint8Array` (§2)                                                           |
| un fichier, une image lourde, une pièce jointe             | une route HTTP (`POST` multipart, flux) — jamais la socket ; puis un message qui la cite            |
| un protocole binaire entièrement à toi, sans canal         | le flux brut `onRealtimeBinary()` / `onBinary()` — HORS des gardes (§6)                             |
| des objets ordinaires (texte, nombres, statuts)            | rien : reste en JSON, le défaut. CBOR y est plus lent (§2)                                          |

**N'invente jamais d'en-tête binaire maison** (`[n° de canal][charge]`), ni base64 dans une chaîne :
le premier contourne toutes les gardes et se maintient des deux côtés ; le second coûte un tiers
d'octets en plus et un décodage des milliers de fois plus lent (§2).

## 2. Décider avec les mesures — le binaire gagne SUR LES OCTETS, et seulement là

Mesures du framework sur trames réelles (Node 26, médiane de 7 séries, mêmes données en JSON avec
octets en base64 et en CBOR). Le détail, avec conditions et sources : [`references/mesures.md`](references/mesures.md).

| Charge                                  | Taille JSON → CBOR          | Décodage JSON → CBOR | Verdict               |
| --------------------------------------- | --------------------------- | -------------------- | --------------------- |
| 64 Ko d'octets                          | 87 452 o → 65 582 o (−25 %) | 541 µs → 0,9 µs      | **CBOR, sans débat**  |
| 1 Mo d'octets                           | 1,40 Mo → 1,05 Mo (−25 %)   | 9 488 µs → 1 µs      | **CBOR, sans débat**  |
| 4 Ko d'octets, réception navigateur     | −25 %                       | 26 454 ns → 792 ns   | **CBOR**              |
| objet de supervision (nombres, statuts) | 1 541 o → 1 172 o (−24 %)   | 7,9 µs → 11,1 µs     | CBOR plus LENT à lire |
| objet de santé d'une socket             | 1 526 o → 1 256 o (−18 %)   | 9,5 µs → 18,2 µs     | CBOR plus LENT à lire |

D'où les règles :

- **Le serveur passe en `codec: "cbor"` dès que des octets circulent** — sans lui, un `Uint8Array`
  part en `{"0":1,"1":2,…}` sans un message (§9). Le navigateur qui OFFRE le codec en profite ; celui
  qui ne l'offre pas reçoit quand même des `Uint8Array` (convention `$bytes` en texte).
- **N'offre le codec que si des octets circulent** : sur des objets ordinaires, `JSON.parse` est
  natif au moteur et plus rapide ; le codec pèse ~5,5 Ko compressés à télécharger. CBOR n'est
  jamais le défaut.
- **Un tableau typé n'est pas gagnant par nature — mesure ta donnée.** Un spectre de 1 024 compteurs
  en `Uint32Array` pèse 4 114 o en CBOR contre 3 128 o en JSON : de petits entiers s'écrivent court
  en texte, alors qu'un `u32` prend toujours 4 octets. Choisis le type le plus ÉTROIT qui tient
  la plage (`Uint16Array`, `Int16Array`), ou garde des nombres.
- **Tasse les booléens et les petites valeurs** : 1 000 tirs d'une mesure en bits tassés = 142 o,
  contre 2 025 o en JSON.
- **Réduis côté serveur avant de publier** : une fenêtre de capteur résumée (min, max, moyenne)
  par période = 176 o en CBOR contre 307 o en JSON — et c'est la cadence du serveur, pas celle du
  capteur, qui fixe le débit (`nodefony-add-realtime-channel`, « état ou événement »).

## 3. Le modèle — une trame comme les autres

- Une trame qui porte des octets est une **notification JSON-RPC ordinaire** dont la charge est, ou
  contient, un `Uint8Array`. Il n'y a pas de seconde grammaire.
- Le **codec** ne dit que la forme sur le fil : en CBOR, les octets voyagent tels quels ; sur une
  connexion restée en texte, sous la convention `{"$bytes":"<base64url>"}`, que le client relit en
  `Uint8Array` sans rien importer.
- Le codec se **négocie** par connexion : le navigateur l'offre, le serveur choisit et l'annonce
  dans `realtime:welcome`. Un client qui ne l'offre pas reste en texte — rien ne casse. Un canal
  suivi par des connexions CBOR et texte paie un encodage par codec, jamais un par abonné.
- Parce que c'est la même trame, les octets d'un canal passent par **les mêmes gardes** que le
  texte : politique du canal, rôles, audit, sonde.

## 4. Mise en place — une ligne par côté

Serveur (`nodefony.config.ts`) : `use("@nodefony/realtime", { codec: "cbor" })` — la variable
`NF_REALTIME_CODEC` le surcharge.

| Serveur                  | Navigateur offre CBOR | Fil retenu | Octets reçus en              |
| ------------------------ | --------------------- | ---------- | ---------------------------- |
| `codec: "cbor"`          | oui                   | CBOR       | `Uint8Array`                 |
| `codec: "cbor"`          | non                   | texte      | `Uint8Array` (via `$bytes`)  |
| `codec: "json"` (défaut) | oui ou non            | texte      | 🔴 objet déformé `{"0":1,…}` |

Navigateur — le codec est une **OFFRE**, faite à la création de la socket (`CBOR_FRAME_CODEC`, de
`nodefony/cbor`). La démo binaire ouvre ainsi la sienne :

<!-- excerpt: demo/front/frontend/src/binary/binaryClient.ts.tpl -->

```ts
export function openBinary(
  cbor: boolean,
  transport?: RealtimeTransportFactory,
) {
  return NodefonySocket.fromContract<BinaryContract>(
    {
      url: BINARY_SOCKET,
      autoReconnect: false,
      codec: cbor ? nodefonyCbor.CBOR_FRAME_CODEC : undefined,
    },
    transport,
  );
}
```

Avec `NodefonySocket.shared({ url, codec })`, l'offre ne compte qu'à la **PREMIÈRE** création pour
cette adresse : une seconde demande rend l'instance existante, réglages compris (§9). Importe le
codec depuis `nodefony/cbor` seulement dans les pages qui en ont besoin : il reste hors du paquet
client tant qu'on ne l'importe pas.

## 5. Publier et recevoir

Le serveur met un `Uint8Array` DANS la charge, et publie comme d'habitude — ici la fabrique d'un
canal de la démo, qui tourne au premier abonné et s'arrête au départ du dernier :

<!-- excerpt: demo/server/nodefony/controllers/BinaryController.ts.tpl -->

```ts
  @RealtimeChannel(VIBRATION_CHANNEL)
  vibrationChannel(
    _channel: string,
    publish: ContractRealtimePublish<BinaryContract>,
  ): () => void {
    let seq = 0;
    const timer = setInterval(() => {
      seq += 1;
      // Petit-boutiste écrit EXPLICITEMENT : la page lira de même, quelle
      // que soit la machine qui l'exécute.
      const samples = new Uint8Array(VIBRATION_SAMPLES * 2);
      const view = new DataView(samples.buffer);
```

Hors d'une fabrique (service, tâche, minuteur) : `getRealtimeHub().publish(canal, { seq, samples })`.
Côté navigateur, rien ne change : `socket.subscribe(canal)` puis `socket.on(canal, h)` — la charge
reçue porte un `Uint8Array`.

- `subscribe(canal)` prend **un seul argument** ; le handler se pose par `on(canal, handler)`.
- Une charge est un objet, un tableau, des octets, ou absente — jamais un scalaire
  (`publish("c", 42)` lève une `TypeError` qui nomme le canal).
- Un `Buffer` de Node est un `Uint8Array` : il part en octets, jamais en `{type:"Buffer",data:[…]}`.
- Une `Date` revient en chaîne et un `bigint` est refusé — exactement comme en JSON.
- **Écris l'ordre des octets EXPLICITEMENT** (`setInt16(i, v, true)` : petit-boutiste) : la page
  doit lire de même, quelle que soit la machine.

## 6. Lire des octets sans se tromper

- **`DataView` : passe la tranche entière.** Un `Buffer` de Node — et une vue décodée — ne commence
  pas à 0 dans son tampon : `new DataView(data.buffer)` lit des octets qui ne sont pas les tiens.

<!-- excerpt: demo/front/frontend/src/binary/binaryClient.ts.tpl -->

```ts
export function readSamples(bytes: Uint8Array): Int16Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Int16Array(bytes.byteLength / 2);
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = view.getInt16(i * 2, true);
  }
  return samples;
}
```

- Écris ton décodeur sur `Uint8Array` : il sert tel quel dans le navigateur et côté serveur.
- Si tu appelles toi-même `decodeCbor()` sur un tampon que tu réutilises ensuite, **copie** les
  octets décodés à garder (`slice()`) : ce sont des vues sur ce tampon.
- Ne fais jamais confiance à des octets reçus : borne les longueurs avant d'allouer.

## 7. Canal ou flux brut ?

🔴 **Le flux brut est HORS des gardes.** Une trame reçue par `onRealtimeBinary(data)` ne passe ni
par le verrou de frame ni par les politiques d'action et de canal : seule la connexion a franchi
l'origine, l'authentification et le pare-feu. Si tu l'emploies, **toute décision d'accès est à toi**
— lis l'identité par `RequestContext.getAuthenticatedUser()` et refuse explicitement.

🔴 **Le flux brut n'existe pas sur une connexion CBOR** : toute trame binaire y est une frame du
codec. `onRealtimeBinary()` n'y est jamais appelée, `sendBinaryToClient()` et `sendBinary()` rendent
`false`.

Il n'a plus de raison de performance : un canal CBOR décode 1 Mo en ~1 µs. **Préfère un canal +
`Uint8Array`** — même politique, mêmes gardes, même bus entre serveurs.

## 8. Le piège du `$bytes` forgé

Quand le serveur a `codec: "cbor"` et qu'une connexion est restée en texte, un objet de la forme
**exacte** `{ $bytes: "<chaîne>" }` (seule clé, valeur chaîne) est réservé aux octets. L'encodeur
**refuse** d'en envoyer un qui ne vient pas d'octets : un client texte le relirait en octets, un
client CBOR en objet. La démo le montre — seul, il lève une `TypeError` à la ligne fautive ; avec
une seconde clé, il part (et c'est le schéma du serveur qui refuse ce qui n'est pas un
`Uint8Array`) :

<!-- excerpt: demo/front/frontend/src/binary/binaryClient.ts.tpl -->

```ts
const forged = extraKey
  ? { $bytes: "AQID", note: "deux clés" }
  : { $bytes: "AQID" };
await socket.request("binary:digest", { bytes: forged });
```

- Navigateur : `emit` / `publish` / `request` **lèvent** à la ligne fautive.
- Serveur : la publication n'atteint pas les abonnés texte, une ligne `ERROR` par publication. Un
  tel objet **conservé** (état renvoyé à chaque abonné) est refusé à chaque envoi : renomme la clé.
- Avec `codec: "json"`, `$bytes` est une clé comme une autre : la règle ne s'applique pas.

## 9. Plusieurs serveurs, bornes, et ce qui arrive SANS message

- **Bus** : les octets traversent `redis` et `cluster` **intacts**, scellés comme le texte si
  `backplane.secret` est posé. Mesuré sur Redis, charge de 16 Ko : −25 % d'octets, +30 % de débit,
  −11 % de latence médiane — pour +15 à 30 % de CPU par message. Le bus IPC de `nodefony cluster`
  passe en sérialisation avancée tout seul (~1 µs par saut).
- **Taille d'une trame entrante** : bornée par `websocket.maxPayload` de `@nodefony/http` (1 Mio
  par défaut) ; au-delà, la socket se ferme en `1009`. Un besoin plus gros est un fichier : route
  HTTP. Ne relève la borne qu'en connaissance de cause (toute l'application en hérite).
- **Débit** : un flux audio (~50 trames/s) doit passer sous `maxFramesPerSecond` si tu l'actives.
- **Serveur resté en `codec: "json"`** : un `Uint8Array` part en `{"0":1,"1":2,…}` — aucune erreur.
  Le piège n°1 : vérifier la clé `codec` avant tout autre diagnostic.
- **`codec` passé à un `shared()` qui n'est pas le premier** : l'instance existante revient,
  réglages compris ; la connexion reste en texte (un avertissement hors production seulement).
- **`sendBinary()` sur un transport fermé** : rend `false`, compté dans `framesUnsent`, sans notice.
- **Ne déduis jamais le codec de l'en-tête `Sec-WebSocket-Protocol`** renvoyé au handshake : seule
  `socket.codec` fait foi.
- Un message d'erreur ou une notice qui parle d'octets : sa cause et ton geste sont dans
  [`references/messages.md`](references/messages.md).

## 10. Prouver

- `socket.codec` vaut `"nodefony.jsonrpc.cbor.v1"` une fois l'accueil reçu ;
  `"nodefony.jsonrpc.v1"` = texte.
- Compteurs côté navigateur : `socket.binaryFramesDiscarded`, `socket.malformedFramesDiscarded`
  doivent rester à 0.
- Un test publie un `Uint8Array` sur un canal et vérifie que l'abonné reçoit un `Uint8Array`
  **identique** (`instanceof Uint8Array` et mêmes octets) — sous CBOR ET sous texte.
- Une décision de représentation (tableau typé, bits tassés, réduction) se **mesure** sur TA donnée
  : compare la taille de la trame encodée par `encodeCbor` (`nodefony/cbor`) et par `JSON.stringify`
  — le spectre en `u32` a montré que l'intuition peut perdre.
- Pour lire le fil à l'œil dans l'inspecteur réseau : `NF_REALTIME_CODEC=json` remet le serveur en
  texte. Exception de débogage : la taille des trames et la contre-pression changent, aucune mesure
  prise ainsi ne vaut pour la production.

## 11. Voisins

| Besoin                                                | Skill                           |
| ----------------------------------------------------- | ------------------------------- |
| Le canal qui porte les octets : le créer, le protéger | `nodefony-add-realtime-channel` |
| Un fichier, une pièce jointe, un flux HTTP            | `nodefony-add-crud`             |
| Un service gRPC (protobuf, autre usage que la socket) | `nodefony-add-grpc-service`     |
| Voir l'écran, lire les trames depuis la page          | `nodefony-browser`              |
| Une trame qui n'arrive plus, une socket qui se ferme  | `nodefony-troubleshoot`         |
