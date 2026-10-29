---
title: "Codec CBOR (nodefony/cbor)"
navTitle: "Codec CBOR"
lang: fr
module: "@nodefony/core"
topic: cbor
coverageModule: nodefony-core
coveragePackage: "nodefony (cœur)"
coverageFiles: "realtime/codec/encode.ts,realtime/codec/decode.ts,realtime/codec/float16.ts,realtime/codec/errors.ts"
section: "Temps réel"
audience: [developer]
tags:
  [cbor, rfc8949, binaire, websocket, temps-reel, isomorphe, json, performance]
version: "doc"
status: stable
updated: 2026-10-29
source: "src/nodefony/docs/cbor.md"
---

# Codec CBOR (`nodefony/cbor`)

> CBOR est un JSON **binaire** : les mêmes objets, tableaux, nombres et textes, en moins
> d'octets, et des octets bruts (une image, un son) sans les convertir en texte. Nodefony
> embarque son propre codec, **isomorphe** (navigateur et serveur, même code), sans dépendance,
> qui rend **exactement ce que JSON rendrait** — seuls les octets font exception. Ancré sur
> `src/nodefony/src/realtime/codec/`.

📍 [Documentation](../../../docs/index.md) › [@nodefony/core](index.md) › **Codec CBOR**

## 🧠 Le modèle mental — JSON, écrit autrement

Pense à un formulaire qu'on peut remplir de deux façons : **en toutes lettres** (JSON, lisible
par un humain) ou **en abrégé** (CBOR, lisible par une machine, plus court). Le formulaire est le
même ; seule l'écriture change.

C'est la promesse du codec, et elle est stricte : pour toute valeur `v`,

```text
decodeCbor(encodeCbor(v))   ≡   JSON.parse(JSON.stringify(v))
```

Une `Date` devient sa chaîne ISO, `NaN` devient `null`, une `Map` devient `{}` — **comme en
JSON**. Une seule exception : un `Uint8Array` voyage en octets et revient en `Uint8Array`, là où
JSON ne sait pas le porter.

## 📖 Lexique

- **CBOR** — _Concise Binary Object Representation_ (RFC 8949) : un format binaire normalisé par
  l'IETF, au modèle de données proche de JSON.
- **Sérialisation préférée** — la forme la plus courte qu'autorise la norme pour un nombre ou une
  longueur (RFC 8949 §4.1). Le codec n'émet qu'elle.
- **Isomorphe** — le même code tourne dans le navigateur et sur le serveur, sans adaptation.
- **Vue sans copie** — un `Uint8Array` qui regarde une portion d'un tampon existant au lieu d'en
  recopier les octets.

## Qu'est-ce qu'un codec binaire — et pourquoi il compte en temps réel

Une socket temps réel échange des milliers de petits messages. En JSON, chaque message est du
texte : des guillemets, des noms de clés répétés, des nombres écrits chiffre par chiffre. Et des
octets (une photo, un échantillon de capteur) doivent d'abord être convertis en base64 — un tiers
plus lourds, et un calcul à chaque message.

CBOR retire ce surcoût : un message ordinaire pèse **30 à 45 % de moins**, et des octets passent
tels quels. En échange, encoder un petit message prend plus de calcul qu'en JSON, que le moteur
JavaScript exécute en code natif. D'où la règle : **JSON reste le format par défaut** ; CBOR est
un choix, utile quand les messages portent du binaire ou quand la bande passante compte.

## La vision Nodefony

Trois engagements, décidés dans [l'ADR-0022](../../../docs/adr/0022-socket-temps-reel.md) :

1. **JSON est la référence.** Des clients JSON et CBOR peuvent écouter le même canal ; le relais
   entre serveurs parle JSON ; un type ne peut pas dépendre du fil. Tous reçoivent donc la même
   chose — ce que JSON rendrait.
2. **Rien en plus de la norme, rien en moins.** Le codec suit RFC 8949 à la lettre là où elle
   s'applique, et restreint explicitement ce qu'il accepte au modèle JSON plus les octets.
3. **Isomorphe et autonome.** Aucune dépendance, aucun `eval` (la politique de sécurité du
   contenu par défaut l'interdit), aucun `Buffer` : le même fichier sert le navigateur et Node.

## 🚀 Démarrage rapide

### Encoder et décoder

```ts
import { encodeCbor, decodeCbor, CborError } from "nodefony/cbor";

const bytes = encodeCbor({
  jsonrpc: "2.0",
  method: "capteur:mesures",
  params: { seq: 42, at: new Date(0), data: new Uint8Array([1, 2, 255]) },
});

const message = decodeCbor(bytes);
// → { jsonrpc: "2.0", method: "capteur:mesures",
//     params: { seq: 42, at: "1970-01-01T00:00:00.000Z", data: Uint8Array [1, 2, 255] } }

try {
  decodeCbor(new Uint8Array([0xc1, 0x00])); // une étiquette : hors du profil
} catch (error) {
  if (error instanceof CborError) console.log(error.message, error.position);
}
```

### Ce qu'on observe

- `at` revient en **chaîne** : c'est ce que `JSON.stringify` en ferait. Convertis-la
  explicitement (`new Date(message.params.at)`) — le type reçu le dit.
- `data` revient en **`Uint8Array`**, sans base64.
- Un message refusé lève une `CborError`, qui porte la **position** de l'octet fautif.

### Le même import, côté navigateur

`nodefony/cbor` est un sous-chemin à part : `nodefony/client` ne l'inclut pas, et seule
l'application qui l'importe le télécharge (environ 4,6 Ko compressé). Le code est identique côté
serveur et côté navigateur.

## Ce que fait l'encodeur — l'algorithme de `JSON.stringify`

`encodeCbor()` (`src/nodefony/src/realtime/codec/encode.ts#encodeCbor`) suit l'algorithme
`SerializeJSONProperty` d'ECMA-262, valeur par valeur :

| Valeur JavaScript                                | Ce qui est encodé                                 |
| ------------------------------------------------ | ------------------------------------------------- |
| objet avec une méthode `toJSON` (dont `Date`)    | le résultat de `toJSON()`                         |
| `Number`, `String`, `Boolean` en enveloppe       | la primitive                                      |
| `NaN`, `Infinity`, `-Infinity`                   | `null`                                            |
| `-0`                                             | `0`                                               |
| `undefined`, fonction, symbole dans un tableau   | `null`                                            |
| `undefined`, fonction, symbole dans un objet     | la clé est omise                                  |
| `Map`, `Set`, objet sans propriété énumérable    | `{}`                                              |
| `bigint`, structure circulaire                   | refus (`CborError`), comme JSON                   |
| `Uint8Array` (et `Buffer` sous Node)             | **chaîne d'octets** — la seule exception à JSON   |
| racine `undefined`, fonction ou symbole          | refus : un codec doit rendre une trame            |
| caractère UTF-16 isolé (substitut sans sa paire) | U+FFFD, comme un `TextEncoder` ou une trame texte |

L'ordre des clés est celui de `Object.keys`, jamais trié. Les nombres prennent la forme la plus
courte qui les conserve : entier sur 1 à 9 octets, flottant sur 16, 32 ou 64 bits.

Un `Buffer` Node est traité **avant** sa méthode `toJSON`, qui rendrait sinon
`{ type: "Buffer", data: [...] }` — précisément la déformation qu'un octet ne doit pas subir.

## Ce que fait le décodeur — le profil JSON + octets

`decodeCbor()` (`src/nodefony/src/realtime/codec/decode.ts#decodeCbor`) lit tout CBOR bien formé
qui reste dans le modèle, et refuse le reste :

| Reçu                                        | Résultat                                                   |
| ------------------------------------------- | ---------------------------------------------------------- |
| entiers, flottants 16/32/64 bits, textes    | les valeurs JavaScript correspondantes                     |
| chaîne d'octets                             | un `Uint8Array`, **vue sans copie** sur l'entrée           |
| tableaux et objets, définis ou indéfinis    | acceptés (§3.2 : un encodeur tiers peut écrire en flux)    |
| `NaN`, `±Infinity`                          | `null`                                                     |
| `undefined`                                 | `null` dans un tableau, clé omise dans un objet            |
| entier au-delà de `Number.MAX_SAFE_INTEGER` | le `Number` le plus proche, comme `JSON.parse`             |
| clé `__proto__`                             | propriété propre, comme `JSON.parse` — jamais le prototype |
| étiquette (type majeur 6)                   | refus                                                      |
| clé non textuelle, clé en double            | refus                                                      |
| texte UTF-8 invalide                        | refus (§5.3.1)                                             |
| octets en trop après la valeur              | refus                                                      |

### Les options

`ICborDecodeOptions` (`src/nodefony/src/realtime/codec/decode.ts#ICborDecodeOptions`) porte une
seule option aujourd'hui, `maxDepth` : la profondeur d'imbrication maximale, **64** par défaut,
un entier ≥ 1. Les options passent par un objet, pour en ajouter sans rupture.

### La vue sans copie — ce qu'elle t'engage

Un `Uint8Array` décodé regarde **le tampon que tu as passé** à `decodeCbor`. Si tu réutilises ce
tampon (un tampon de réception recyclé), copie d'abord les octets que tu gardes :
`new Uint8Array(message.params.data)`. C'est ce qui rend le décodage du binaire quasi gratuit :
une image de 1 Mo se décode en environ 1 µs.

## 🔐 Sécurité — un message hostile ne passe pas

Un décodeur reçoit des octets d'inconnus. Le codec applique les considérations de sécurité de la
RFC 8949 (§10) :

- **toute longueur annoncée est confrontée aux octets restants avant d'allouer** : un message de
  dix octets qui annonce un tableau de quatre milliards d'éléments est refusé sans rien réserver ;
- **profondeur bornée** (`maxDepth`) : pas d'épuisement de pile par imbrication ;
- **aucun prototype altéré** : `__proto__` reste une propriété ordinaire ;
- **profil restreint** : ni étiquette, ni valeur simple exotique — moins de surface, moins de cas.

Chaque refus lève une `CborError` (`src/nodefony/src/realtime/codec/errors.ts#CborError`), qui
étend `TypeError` — la classe que lèvent déjà `JSON.stringify` et un `TextDecoder` strict — et
porte la `position` de l'octet en cause.

## ⚡ Performance & mémoire

Mesuré sur une machine de développement (Node 26, médiane de sept mesures, deux passages) :

| Message               | JSON (octets)   | CBOR (octets) | Encodage CBOR | Décodage CBOR |
| --------------------- | --------------- | ------------- | ------------- | ------------- |
| court (3 champs)      | 91              | 68            | ~0,9 µs       | ~0,8 µs       |
| 50 objets de 6 champs | 4 754           | 3 250         | ~35 µs        | ~40 µs        |
| 500 nombres à virgule | 2 620           | 1 399         | ~16 µs        | ~17 µs        |
| binaire 64 Ko         | 87 445 (base64) | 65 587        | ~35 µs        | ~1 µs         |

À retenir : JSON natif reste plus rapide sur un petit message ordinaire ; CBOR gagne en octets
partout, et sur le binaire de très loin (aucune conversion en base64, décodage sans copie).

Côté mémoire :

- **rien n'est alloué au chargement** : l'arène d'encodage (32 Ko) et le cache de clés du
  décodage ne sont posés qu'au premier usage ;
- un résultat d'encodage court est une vue sur une arène qui **avance** et n'est jamais réécrite —
  tu peux le garder ou le mettre en file d'attente ; gardé longtemps, il retient son arène (32 Ko
  au plus) ;
- chaque résultat est indépendant du suivant : aucun appel ne modifie les octets d'un appel
  précédent.

Le banc qui produit ces chiffres se rejoue :
`node .claude/skills/nodefony-load-test/scripts/micro/micro-cbor-codec.mjs`.

## 📜 Normes appliquées

| Norme                            | Ce qu'on en applique                                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| RFC 8949 §3                      | encodage des types majeurs 0 à 5 et 7 ; longueurs indéfinies lues (§3.2)                                          |
| RFC 8949 §4.1                    | sérialisation préférée : la forme la plus courte, flottants compris                                               |
| RFC 8949 §5.3.1, §5.6            | UTF-8 valide exigé ; clés en double refusées                                                                      |
| RFC 8949 §10                     | bornes contre un message hostile                                                                                  |
| RFC 8949, appendices A et F      | tous les exemples applicables servent de tests, octet pour octet                                                  |
| ECMA-262 `SerializeJSONProperty` | l'algorithme que suit l'encodeur                                                                                  |
| RFC 6455 §1.9                    | `CBOR_PROTOCOL` (`src/nodefony/src/realtime/codec/index.ts#CBOR_PROTOCOL`) est le nom du sous-protocole WebSocket |

**Ce qui n'est pas visé** : l'encodage déterministe de la §4.2.1, qui trie les clés — il
changerait leur ordre, que JSON conserve.

## ⚠️ Pièges (symptôme → cause → correction)

- **Une `Date` revient en chaîne** → c'est la référence JSON → `new Date(valeur)` à la réception.
- **Des octets décodés changent tout seuls** → tu as réutilisé le tampon passé à `decodeCbor` →
  copie les octets à garder avant de réutiliser le tampon.
- **`CborError: étiquette (type majeur 6)`** → un encodeur tiers a émis une date ou un grand entier
  étiqueté → émettre un texte ou un nombre, ce que le profil accepte.
- **`CborError` sur un `bigint`** → JSON le refuse aussi → convertir en chaîne ou en nombre.
- **Une structure très profonde fait lever le moteur à l'encodage** (`RangeError`) → comme
  `JSON.stringify` → aplatir la donnée ; au décodage, c'est `maxDepth` qui la borne.

## 🧪 Tests & couverture

Familles présentes :

- **Conformité à la norme** (`src/nodefony/src/tests/cborRfc8949.test.ts`) : chaque exemple
  applicable de l'appendice A encodé et décodé octet pour octet, ceux hors profil refusés ; chaque
  exemple mal formé de l'appendice F refusé ; longueurs indéfinies ; bornes (profondeur, longueurs
  annoncées géantes, troncature à chaque position).
- **Alignement sur JSON** (`src/nodefony/src/tests/cborJson.test.ts`) : une table de valeurs
  piégées, des milliers de valeurs aléatoires à graine fixée comparées à
  `JSON.parse(JSON.stringify(v))`, des mutations d'octets qui ne doivent jamais faire planter
  autrement que par `CborError`, l'indépendance des résultats successifs.
- **Mémoire** (`src/nodefony/src/tests/cborLazy.test.ts`) : rien d'alloué au chargement du
  codec, l'arène posée au premier usage. Chaque garde du codec a été vue tomber
  en la débranchant.

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [@nodefony/core — vue d'ensemble](index.md) · [Toute la documentation](../../../docs/index.md)
- 🧭 **Pages sœurs** : [Client isomorphe](client.md) — la socket côté navigateur, que CBOR servira ·
  [Journalisation](syslog.md)
- Les décisions et leurs raisons → [ADR-0022 — la socket temps réel](../../../docs/adr/0022-socket-temps-reel.md)
  · [ADR-0021 — l'événement et ses livraisons](../../../docs/adr/0021-temps-reel-evenement-et-livraisons.md)
