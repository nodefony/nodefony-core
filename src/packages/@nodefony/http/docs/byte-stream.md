---
title: "Flux d'octets — servir la sortie d'un processus, un relais ou une archive à la volée"
navTitle: Flux d'octets
lang: fr
module: "@nodefony/http"
topic: byte-stream
section: "Cœur runtime"
audience: [developer]
tags:
  [
    streaming,
    flux,
    renderstream,
    openstream,
    ffmpeg,
    relais,
    fetch,
    http2,
    contre-pression,
  ]
version: "doc"
status: stable
updated: 2026-11-06
source: "src/packages/@nodefony/http/docs/byte-stream.md"
coverageModule: http
coverageFiles: context/http/ByteStream.ts,context/http/StreamLifecycle.ts
---

📍 [Documentation](../../../../../docs/index.md) › [@nodefony/http](index.md) › **Flux d'octets**

# Flux d'octets — servir la sortie d'un processus, un relais ou une archive à la volée

> Un **robinet** plutôt qu'une **bouteille** : la réponse ne se prépare pas en entier avant de
> partir, elle coule pendant que la source produit. La vidéo ré-emballée par ffmpeg, le corps d'un
> `fetch()` relayé depuis une caméra, une archive construite à la volée : toute source d'octets qui
> n'est pas un fichier du disque. Un `<video src>`, un `fetch()`, un téléchargement ou `curl` la
> lisent comme n'importe quelle réponse HTTP. Le même code sert HTTP/1.1, HTTP/2 chiffré et h2c.
> Chaque fait ci-dessous est ancré sur le code.

## 🧠 Le modèle mental — la réponse est PRISE à l'appel, les en-têtes partent au premier octet

`this.renderStream(source)` dit au framework : « cette requête, c'est moi qui la sers, avec ce flux ».
Dès l'appel, plus rien ne peut répondre à sa place. Mais les **en-têtes ne partent qu'au premier
morceau** de la source : tant que rien n'est sorti, une erreur de la source peut encore devenir une
vraie page d'erreur (500, 502…), visible dans le journal d'accès — et non une réponse 200 tronquée.

Le flux se termine pour l'une de cinq raisons, et la **source est toujours détruite** à la fin,
quelle que soit la raison. C'est ce qui libère un processus fils bloqué en écriture : un simple
`unpipe` le laisserait en pause, et ffmpeg ainsi bloqué ignore même `SIGTERM`.

## 📖 Lexique

- **Source** — ce qui produit les octets : un `Readable` Node (la sortie d'un processus, une archive)
  ou un `ReadableStream` web (le `body` d'un `fetch()`).
- **Contre-pression** — quand le client lit moins vite que la source produit, la source est mise en
  pause jusqu'à ce que le client rattrape : la mémoire du serveur reste bornée.
- **Source muette** — une source qui ne produit plus rien (processus figé, amont qui ne répond plus).
- **Coupure** — la fin d'une réponse sans fin propre : le client SAIT que le corps est tronqué
  (socket fermée en HTTP/1.1, `RST_STREAM` en HTTP/2).

## Quand un flux d'octets, quand autre chose ?

| Besoin                                                      | Choisir                                                     |
| ----------------------------------------------------------- | ----------------------------------------------------------- |
| Un fichier du disque, avec reprise (`Range`)                | `this.renderMediaStream()` / `this.renderFileDownload()`    |
| La sortie d'un processus, un relais, une archive construite | **`this.renderStream()`** — cette page                      |
| Des événements texte lus par `EventSource`                  | [`this.renderSse()`](sse.md)                                |
| UNE source diffusée à N lecteurs (un producteur par pod)    | un canal temps réel (`@nodefony/realtime`), pas une réponse |

`renderStream` sert **une réponse par consommateur** : dix spectateurs, dix flux, dix producteurs.

## 🚀 Démarrage rapide

Dans une application générée par `nodefony create app`, une action sert la sortie d'un processus.

### 1. L'action

```ts
// modules/app/nodefony/controller/ExportController.ts
import { spawn } from "node:child_process";
import { Controller, controller, route } from "@nodefony/framework";
import type { Context } from "@nodefony/http";

@controller("/export")
class ExportController extends Controller {
  constructor(context: Context) {
    super("ExportController", context);
  }

  @route("export-logs", { path: "/logs" })
  async logs() {
    const tar = spawn("tar", ["-cz", "-C", "var", "logs"], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    try {
      const { reason, bytes } = await this.renderStream(tar.stdout, {
        headers: {
          "content-type": "application/gzip",
          "content-disposition": 'attachment; filename="logs.tar.gz"',
        },
      });
      this.log(`export terminé : ${reason}, ${bytes} octets`, "INFO");
    } finally {
      tar.kill("SIGKILL"); // le flux est fini, quelle qu'en soit la raison
    }
  }
}

export default ExportController;
```

### 2. Observer

```bash
curl -sS -o logs.tar.gz -D - http://127.0.0.1:5151/export/logs
```

```text
HTTP/1.1 200 OK
content-type: application/gzip
cache-control: no-cache, no-transform
x-accel-buffering: no
transfer-encoding: chunked
```

- Aucun `Content-Length` n'est connu : HTTP/1.1 envoie par morceaux, HTTP/2 n'annonce rien.
- `Cache-Control: no-cache, no-transform` et `X-Accel-Buffering: no` sont posés **s'ils manquent** —
  ni dans `headers`, ni déjà sur la réponse : un proxy inverse ne met pas le flux en tampon, et ne le
  recompresse pas. Pour une source FINIE et rejouable (fichier, archive), `live: false` les retire.
- Couper `curl` en route : la promesse rend `reason: "client"`, la source est détruite, `tar` reçoit
  `EPIPE` et s'arrête.

## ⚙️ L'API

### `this.renderStream(source, options?)` — et `context.openStream()`

`Controller.renderStream()` (`Controller.ts#Controller.renderStream`) n'est que l'habillage de
`HttpContext.openStream()` (`HttpContext.ts#HttpContext.openStream`), comme `renderSse` l'est de
`openSse`. Un middleware ou un relais qui n'a pas de contrôleur appelle `context.openStream()`
directement — la requête est alors répondue : ne pas appeler la suite.

| Paramètre | Type                                       | Rôle                                                             |
| --------- | ------------------------------------------ | ---------------------------------------------------------------- |
| `source`  | `Readable` ou `ReadableStream<Uint8Array>` | ce qui produit les octets ; jamais en mode objet (`TypeError`)   |
| `options` | `IByteStreamOptions`                       | statut, en-têtes, délais, écouteur de fin (tableau suivant)      |
| rend      | `Promise<IByteStreamResult>`               | `{ reason, bytes }` à la fin — la promesse ne rejette **jamais** |

**La source appartient au flux dès l'appel.** Un appel qui LÈVE — réponse déjà prise (500), plafond
par IP atteint (429), option hors bornes (`RangeError`), source en mode objet (`TypeError`) —
détruit la source avant de lever (un flux web est annulé) : un relais `fetch` refusé ne garde pas sa
connexion amont, un producteur enfant ne reste pas bloqué en écriture.

| Option         | Rôle                                                                                                      | Défaut                                   |
| -------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `status`       | statut de la réponse, 200 à 599                                                                           | 200                                      |
| `headers`      | en-têtes, écrits au premier morceau ; `Content-Length` repris s'il est fourni, et TENU (ci-dessous)       | `Content-Type: application/octet-stream` |
| `live`         | flux vivant : `no-cache` et `X-Accel-Buffering: no` par défaut ; `false` pour un fichier, une archive     | `true`                                   |
| `idleTimeout`  | délai maximal sans un octet de la source, ms ; `0` le désarme ; coupure entre 1 et 1,25 × ce délai        | délai de réponse du serveur (30 s)       |
| `stallTimeout` | délai maximal d'une écriture bloquée (le client ne lit plus), ms ; `false` l'éteint                       | 30 000                                   |
| `maxDuration`  | durée de vie du flux, ms ; il est fermé ensuite                                                           | `false` — pas de borne                   |
| `onClose`      | `(reason) => void`, appelé une fois, AVANT la fin de la requête et la résolution ; lié à la requête (ALS) | aucun                                    |

**`Content-Length` est tenu.** Annoncé — dans `headers` ou déjà posé sur la réponse —, le corps
fait exactement cette longueur (RFC 9112 §6.3 ; en HTTP/2, RFC 9113 §8.1.1 : sinon la réponse est
malformée). Contredit dès le premier morceau : rien n'est parti, page d'erreur 500. Après : coupure,
jamais une fin propre — un client HTTP/1.1 attendrait sinon l'octet manquant, ou lirait l'excédent
comme le début de la réponse suivante. `HEAD` excepté : la longueur annoncée y est celle du GET.

Les raisons de fin (`ByteStreamEndReason`, `ByteStream.ts#ByteStreamEndReason`) :

| `reason`  | Ce qui s'est passé                                                             | Ce que voit le client     |
| --------- | ------------------------------------------------------------------------------ | ------------------------- |
| `end`     | la source est finie, ou le serveur a fermé le flux (`maxDuration`, révocation) | une fin propre            |
| `client`  | le client est parti                                                            | —                         |
| `error`   | la source a échoué                                                             | page d'erreur, ou coupure |
| `timeout` | la source est restée muette plus de `idleTimeout`                              | 504, ou coupure           |
| `stall`   | le client ne lisait plus depuis `stallTimeout`                                 | connexion coupée          |

L'union **peut s'agrandir** : un `switch` exhaustif sur `reason` garde une branche `default`.

### Relayer un autre service

```ts
@route("camera-live", { path: "/camera" })
async camera() {
  const r = await fetch("http://camera.local/stream", { signal: this.context.signal });
  if (!r.ok || r.body === null) throw new HttpError("Caméra injoignable", 502);
  return this.renderStream(r.body, {
    headers: { "content-type": r.headers.get("content-type") ?? "application/octet-stream" },
  });
}
```

- Le **signal** est lu AVANT l'appel : au départ du client, le flux l'interrompt, et `fetch` ferme
  la connexion amont (`Context._abortIfPending()`, appelé par la fin du flux).
- Ne recopier que `content-type` : `fetch` a déjà décompressé le corps, donc `content-encoding` et
  `content-length` de l'amont seraient faux.
- Une erreur levée **avant** l'appel (le `throw` ci-dessus) appartient à l'action : chemin d'erreur
  ordinaire.

### `Readable.from()` — passer `{ objectMode: false }`

`Readable.from([...])` crée un flux en **mode objet** par défaut, qui ne porte pas d'octets :
`renderStream` le refuse par un `TypeError` qui donne le correctif.

```ts
return this.renderStream(Readable.from([header, body], { objectMode: false }));
```

### Même source, deux sorties — HTTP et ligne de commande

`renderStream` exige une **réponse HTTP vivante** : une commande CLI n'en a pas, et n'y a donc pas
accès. Ce que les deux partagent, c'est la **source**. On écrit le producteur une fois, puis la route
le sert par `renderStream` et la commande le verse sur sa sortie par `pipeline` de `node:stream`, qui
apporte la même contre-pression et détruit la source en cas d'erreur (un `| head` qui ferme tôt
compris).

```ts
// modules/app/nodefony/src/exportLogs.ts — le producteur, écrit une fois
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

export function exportLogs(): ChildProcessByStdio<null, Readable, null> {
  return spawn("tar", ["-cz", "-C", "var", "logs"], {
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  });
}
```

```ts
// la route — GET /export/logs
const tar = exportLogs();
try {
  await this.renderStream(tar.stdout, {
    headers: { "content-type": "application/gzip" },
  });
} finally {
  tar.kill("SIGKILL");
}
```

```ts
// la commande — nodefony app:export > logs.tar.gz
import { pipeline } from "node:stream/promises";

override async generate(): Promise<this> {
  const tar = exportLogs();
  try {
    await pipeline(tar.stdout, process.stdout);
  } finally {
    tar.kill("SIGKILL");
  }
  return this;
}
```

Une commande de module s'accompagne d'un endpoint équivalent : c'est ce patron qui le rend gratuit.
Pour LIRE un flux d'octets, aucun client dédié n'est nécessaire — c'est une réponse HTTP
ordinaire : `curl -N`, `wget`, `fetch()` ou `| tar xz` le consomment tels quels.

## 🏗️ Architecture interne — ce que fait l'appel

Le flux d'octets repose sur la **brique de cycle de vie commune au SSE**
(`StreamLifecycle.ts#openStreamLifecycle`, non exportée) — une seule implémentation de la prise de
la réponse, de la session, de la fermeture et des gardes, jouée par la même table de parité sur les
deux types de flux.

1. **Les options sont contrôlées** et la source web convertie (`ByteStream.ts#fromWebStream`) — sa
   destruction ANNULE le flux web, c'est elle qui ferme l'amont d'un `fetch`.
2. **La réponse est prise** (`context.sended`), le transport constaté, l'écoute de la fermeture posée
   AVANT toute attente, la place du plafond par IP réservée, puis la session sauvée.
3. **Le délai d'inactivité de la requête est désarmé** : sous une réponse prise, il ne fermait rien et
   faussait le statut journalisé. Le flux tient son propre chien de garde — UN minuteur périodique
   `unref` par flux, qui passe tous les quarts de `idleTimeout` et compare le compteur d'octets.
   Aucun minuteur ni appel d'horloge par morceau : la coupure tombe entre `idleTimeout` et
   1,25 × `idleTimeout`.
4. **HEAD** : les en-têtes du GET, aucun corps, la source n'est jamais lue (toute route GET sert HEAD).
   Pour ne pas lancer un producteur coûteux (ffmpeg) pour rien, passer une source VIDE en mode
   octets : `Readable.from([])` seul est en mode objet, donc refusé (500).

   ```ts
   if (this.method === "HEAD") {
     return this.renderStream(Readable.from([], { objectMode: false }), {
       headers: { "content-type": "video/mp4" },
     });
   }
   ```

5. **Au premier morceau** : les en-têtes, puis le morceau. Sous contre-pression, la source est mise en
   pause et le minuteur `stallTimeout` armé ; il est désarmé au `drain`.
6. **La fin passe par un seul nettoyage** (`ByteStream.ts#openByteStream`, puis
   `StreamLifecycle.ts#StreamLifecycle.finish`) : source **détruite en premier**, écouteurs retirés,
   minuteurs arrêtés, signal de la requête interrompu (sauf fin propre), `onClose(reason)`, fin de la
   requête, puis résolution de la promesse.

**Une erreur de la source**, selon le moment :

| Moment                                    | Traitement                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| avant l'appel                             | elle appartient à l'action : chemin d'erreur ordinaire                                                        |
| avant le premier octet (rien n'est parti) | la réponse est ROUVERTE et l'erreur confiée à `HttpKernel.onError` — même statut, même page qu'une action     |
| après le premier octet                    | **coupure** : `destroy()` en HTTP/1.1, `RST_STREAM(INTERNAL_ERROR)` en HTTP/2 ; une entrée `ERROR` au journal |

**Le journal d'accès dit qui a coupé.** Après le premier octet, le statut parti sur le fil est 200 ;
le statut de la ligne d'accès, lui, est un fait INTERNE : **500** (ou le code d'une `HttpError`) quand
la source échoue, **504** quand elle se tait, **499** quand le client part. Sans lui, le noyau
journaliserait 499 (« client parti ») pour une coupure décidée par le serveur
(`HttpKernel.createHttpContext`).

En HTTP/2, la coupure passe par `stream.destroy(err)` et non `stream.close(INTERNAL_ERROR)` : ce
dernier ferme d'abord le côté écriture, et un client qui a déjà fermé le sien lit une **fin propre**
(mesuré : `rstCode` 0 au lieu de 2).

## 📈 Coût mesuré

Banc isolé (serveur Node seul, client `curl`, 256 Mo par passage, médiane de 21 passes alternées,
deux campagnes) : `renderStream` face au plancher `source.pipe(res)` écrit à la main.

| Morceaux | Débit           | CPU du serveur  |
| -------- | --------------- | --------------- |
| 64 Kio   | −1,7 % / −2,0 % | +1,6 % / +1,1 % |
| 4 Kio    | −2,4 % / −0,2 % | +2,5 % / +0,1 % |

Un fichier servi par `streamFile()` (`live: false`, longueur tenue) face à
`createReadStream().pipe(res)`, même banc : débit +1,4 %, CPU +2,3 % — dans le bruit, lui aussi.

Les écarts restent dans le bruit du banc. Deux choix les tiennent là : un écouteur `drain`
**permanent** (un `once` par épisode de contre-pression coûtait un enrobage par morceau, presque
chaque écriture de 64 Kio rendant `false` sur une socket rapide), et un minuteur de blocage
(`stallTimeout`) créé une fois puis réarmé au reste du délai, jamais un par épisode. La trace de
désoptimisation de V8 (`--trace-deopt`) ne cite pas `ByteStream`.

## 🔐 Sécurité

- **Les mêmes gardes qu'une socket WebSocket et qu'un flux SSE** : le flux compte dans
  `wsMaxConnectionsPerIp` (un seul budget, **429** avant d'écrire quoi que ce soit — désactivé par
  défaut), se coupe quand l'identité qui l'a ouvert est révoquée, et respecte `maxDuration`. Le
  plafond est PAR POD, et dépend de `trustProxy` pour lire la vraie IP derrière un proxy.
- **En-tête refusé** (fin de ligne dans une valeur) : il ne part qu'au premier morceau, depuis la
  source — l'échec rend une page 500 ordinaire, sans en-tête injecté, et ne peut pas abattre le
  processus.
- **`Range` est ignoré** : la réponse est un 200, et `Accept-Ranges` n'est jamais posé (RFC 9110
  §14.2) — un flux construit à la volée ne sait pas reprendre au milieu.
- Le flux passe par le pipeline complet : pare-feu, CSRF et `@IsGranted` s'appliquent avant l'action.

## ⚠️ Pièges (symptôme → cause → correction)

| Symptôme                                              | Cause                                                                                  | Correction                                                                 |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `TypeError : une source en mode objet`                | `Readable.from([...])` est en mode objet par défaut                                    | `Readable.from(chunks, { objectMode: false })`                             |
| Un processus fils survit à un crash du processus Node | la destruction de la source n'a jamais eu lieu : le processus Node est mort avant      | supervision de l'application (cgroup, `detached: false`, `kill` au signal) |
| Coupé au bout de 30 s alors que la source est lente   | `idleTimeout` (défaut 30 s) : la source n'a rien produit pendant ce délai              | relever `idleTimeout`, ou `0` pour une source légitimement silencieuse     |
| Coupé derrière nginx au bout de 60 s                  | `proxy_read_timeout` (60 s) plus court que le silence de la source                     | garder `idleTimeout` SOUS ce délai, ou l'allonger sur le proxy             |
| Le flux répond 429 sans avoir rien fait               | `wsMaxConnectionsPerIp` atteint — sockets, flux SSE et flux d'octets comptent ensemble | relever le plafond, ou fermer les connexions laissées ouvertes             |
| `content-encoding` faux sur un relais                 | en-têtes de l'amont recopiés, alors que `fetch` a décompressé                          | ne recopier que `content-type`                                             |

## 🧪 Tests & couverture

| Type                   | Où                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Parité du cycle de vie | `http/streamLifecycle.test.ts` — la MÊME table jouée sur le SSE et le flux d'octets : réponse prise, départ du client en HTTP/1.1, HTTP/2 et h2c, fin propre, session, double ouverture, client lent, durée de vie                                                                                                                                                                                     |
| Parité — unitaire      | `unit/streamLifecycleParity.test.ts` — client parti PENDANT la sauvegarde de session : flux né fermé, source détruite                                                                                                                                                                                                                                                                                  |
| Intégration            | `http/byteStream.test.ts` — HEAD (3 transports), coupure après le premier octet (3 transports), 500 / 502 avant, source muette 504 et coupure, `idleTimeout: 0`, source déjà finie, en-tête refusé, producteur bloqué libéré, relais `fetch` ; anneau du journal relu (une seule `ERROR`, aucun « onError on closed context », statut de la ligne d'accès) ; session sauvée deux fois, écrite une fois |
| Délais réels           | même fichier, derrière `NF_RUN_LONG_STREAM=1` (~80 s) — défaut d'`idleTimeout` (coupure entre 30 et 37,5 s, 504 au journal) et `idleTimeout: 0` tenu 40 s, au-delà du délai de socket du serveur                                                                                                                                                                                                       |
| Gardes                 | `http/sse-guards.attack.test.ts` — plafond par IP (429, place rendue, source refusée détruite), anonyme refusé (401) et révocation, joués sur le SSE ET le flux d'octets                                                                                                                                                                                                                               |
| Refus — unitaire       | `unit/byteStreamRefusal.test.ts` — un appel qui lève (500, 429, `RangeError`, `TypeError`) détruit la source, annule un flux web                                                                                                                                                                                                                                                                       |
| Mémoire                | `http/memory.test.ts` — flux finis par leur source et flux abandonnés par le client : pente du tas, scopes et contextes résiduels                                                                                                                                                                                                                                                                      |

Le cas du **producteur bloqué** lance un enfant `node -e` qui écrit sans fin par `fs.writeSync(1, …)`
— une écriture bloquante, comme ffmpeg — et vérifie qu'il sort en moins de 5 s après le départ du
client, **sans aucun `kill`** : seule la destruction de sa sortie le libère.

L'avertissement « réponse non envoyée » ne peut pas tomber après un `renderStream` : l'action rend
la promesse du résultat, un objet. Le banc qui relit le journal le garde comme filet, sans pouvoir le
faire rougir sur ce chemin.

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [@nodefony/http — vue du module](index.md) · [Toute la documentation](../../../../../docs/index.md)
- 🧭 **Pages sœurs** : [Flux SSE](sse.md) — événements texte, même cycle de vie ; [Serveurs](servers.md) — HTTP/2, TLS, délais ; [Proxy inverse](reverse-proxy.md).
