---
title: "Flux d'événements serveur (SSE) — pousser au navigateur sur une réponse qui ne finit pas"
navTitle: Flux SSE
lang: fr
module: "@nodefony/http"
topic: sse
section: "Cœur runtime"
audience: [developer]
tags:
  [
    sse,
    server-sent-events,
    event-stream,
    eventsource,
    streaming,
    http2,
    temps-réel,
    mcp,
    last-event-id,
  ]
version: "doc"
status: stable
updated: 2026-10-08
source: "src/packages/@nodefony/http/docs/sse.md"
coverageModule: http
coverageFiles: context/http/SseStream.ts
---

📍 [Documentation](../../../../../docs/index.md) › [@nodefony/http](index.md) › **Flux SSE**

# Flux d'événements serveur (SSE) — pousser au navigateur sur une réponse qui ne finit pas

> Une **radio** plutôt qu'un **téléphone** : le serveur parle, le navigateur écoute, et la
> conversation ne va que dans un sens. Une action ouvre une réponse HTTP qu'elle ne referme pas, et y
> écrit des événements au fil de l'eau — la progression d'une tâche, la réponse d'un modèle de
> langage qui s'écrit mot à mot, une notification. Le même code sert HTTP/1.1 et HTTP/2. Chaque fait
> ci-dessous est ancré sur le code.

## 🧠 Le modèle mental — un FORMAT de réponse, pas une méthode

SSE n'est pas une route d'un genre particulier : c'est ce que l'action **décide de répondre**. La
route reste un `GET` ou un `POST` ordinaire ; à l'exécution, l'action appelle `this.renderSse()` au
lieu de rendre un objet, et la réponse devient un flux `text/event-stream`. Un même `POST` peut donc
répondre en JSON à un client classique et en flux à un client qui le demande par `Accept` — c'est
ce que fait une porte MCP.

## 📖 Lexique

- **SSE** — _Server-Sent Events_ : le format `text/event-stream` normalisé par le standard HTML
  (WHATWG §9.2). Il n'a pas de RFC.
- **Événement** — un bloc de lignes `event:`, `id:`, `data:` clos par une ligne vide.
- **`Last-Event-ID`** — l'en-tête qu'un client renvoie en se reconnectant, pour reprendre après le
  dernier identifiant reçu.
- **Battement de cœur** — un commentaire (`:`) envoyé à intervalle régulier : ignoré par le client,
  il empêche un proxy de couper une connexion qu'il croirait muette.

## Qu'est-ce qu'un flux SSE, et quand le préférer au WebSocket ?

| Besoin                                                        | Choisir                                    |
| ------------------------------------------------------------- | ------------------------------------------ |
| Le serveur pousse, le client écoute (progression, journal)    | **SSE**                                    |
| La réponse d'une requête arrive par morceaux (modèle, export) | **SSE** sur le `POST` de la requête        |
| Un réseau d'entreprise bloque WebSocket                       | **SSE** — c'est une réponse HTTP ordinaire |
| Échange dans les deux sens, canaux, temps réel partagé        | **WebSocket** (`NodefonySocket`)           |

> [!NOTE]
> En HTTP/1.1, un navigateur n'ouvre qu'environ six connexions par origine : six onglets chacun
> abonné à un flux, et les requêtes suivantes attendent leur tour (WHATWG §9.2.7). En HTTP/2, un
> flux SSE n'est qu'un flux du multiplexage de la connexion — servez les flux en HTTP/2.

## 🚀 Démarrage rapide

Dans une application générée par `nodefony create app`, une action pousse trois étapes puis ferme.

### 1. L'action

```ts
// modules/app/nodefony/controller/ProgressController.ts
import { Controller, controller, route } from "@nodefony/framework";
import type { Context } from "@nodefony/http";

@controller("/progress")
class ProgressController extends Controller {
  constructor(context: Context) {
    super("ProgressController", context);
  }

  @route("progress-run", { path: "/run" })
  async run() {
    const sse = await this.renderSse();
    for (const step of ["lecture", "calcul", "écriture"]) {
      await sse.send({ step }, { event: "step" });
    }
    return sse.close();
  }
}

export default ProgressController;
```

### 2. Le client

```ts
// frontend — la classe se lit comme EventSource
import { NodefonySse } from "nodefony/client";

const sse = new NodefonySse("/progress/run");
sse.addEventListener("step", (e) => {
  console.log(JSON.parse((e as MessageEvent<string>).data));
});
sse.addEventListener("error", () => sse.close()); // fin du flux : ne pas reconnecter
```

### 3. Observer

```bash
curl -sN -H 'Accept: text/event-stream' http://127.0.0.1:5151/progress/run
```

```text
event: step
data: {"step":"lecture"}

event: step
data: {"step":"calcul"}

event: step
data: {"step":"écriture"}
```

- Les en-têtes partent dès `renderSse()` : `Content-Type: text/event-stream; charset=utf-8`,
  `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no` (`openSseStream()`,
  `SseStream.ts:297`).
- `await sse.send()` freine l'action si le client lit lentement — c'est la contre-pression.

## ⚙️ Les deux bouts de l'API

### Côté serveur — `this.renderSse()` et l'objet `SseStream`

| Membre                          | Rôle                                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------- |
| `this.renderSse(options?)`      | ouvre le flux (`Controller.renderSse()`, `Controller.ts:665`) ; lève sur WebSocket                 |
| `this.acceptsSse()`             | le client a-t-il demandé `text/event-stream` ? (`Controller.acceptsSse()`, `Controller.ts:639`)    |
| `sse.send(data, { event, id })` | un événement ; texte tel quel, objet en JSON (`SseStream.send()`, `SseStream.ts:155`)              |
| `sse.comment(text)`             | un commentaire, ignoré par le client                                                               |
| `sse.retry(ms)`                 | impose le délai de reconnexion du client                                                           |
| `sse.onClose(fn)`               | appelé à la fermeture, quel que soit le bout qui ferme (`SseStream.onClose()`, `SseStream.ts:209`) |
| `sse.close()`                   | termine la requête, idempotent (`SseStream.close()`, `SseStream.ts:224`)                           |
| `sse.closed`                    | le flux est-il fermé — à tester dans une boucle longue                                             |

Options de `renderSse()` : `heartbeat` (ms, `false` pour l'éteindre — défaut 15 000,
`SSE_HEARTBEAT_MS`, `SseStream.ts:53`) et `retry` (délai `retry:` envoyé à l'ouverture).

### Même route, deux réponses — la négociation

```ts
@route("tasks-run", { path: "/tasks", requirements: { methods: ["POST"] } })
async runTask() {
  if (!this.acceptsSse()) return { status: "accepted" }; // JSON
  const sse = await this.renderSse();
  await sse.send({ status: "running" });
  return sse.close();
}
```

`acceptsEventStream()` (`SseStream.ts:269`) ne retient `text/event-stream` que **nommé** avec un
poids non nul : `*/*` ne suffit pas — un client qui ne nomme pas le flux ne sait pas le lire —, et
`q=0` est un refus (RFC 9110 §12.4.2).

### Côté client — `NodefonySse`

`NodefonySse` (`NodefonySse.ts:89`) reprend le vocabulaire d'`EventSource` — `onopen`,
`onmessage`, `onerror`, `addEventListener(type)`, `readyState`, `lastEventId`, `close()`,
reconnexion avec `Last-Event-ID` — et ajoute ce que le natif refuse : `method`, `headers` (un
`Authorization: Bearer`), `body`. Il est bâti sur `fetch`, donc tourne aussi sous Node, où
`EventSource` reste expérimental.

| Réponse du serveur                         | Ce que fait le client                                   |
| ------------------------------------------ | ------------------------------------------------------- |
| 200 `text/event-stream`                    | `OPEN`, événements                                      |
| fin du flux, coupure réseau                | `error`, puis reconnexion après le délai `retry:`       |
| autre statut (204 compris), autre type     | `error`, `CLOSED`, **sans** reconnexion (WHATWG §9.2.3) |
| événement au-delà de `maxEventSize` (4 Mi) | `CLOSED` sans reconnexion                               |

L'analyseur du format est `SseParser` (`SseParser.ts:61`), exporté par `nodefony/client` : c'est
le même qui relit le flux dans les tests du serveur.

## 🏗️ Architecture interne — ce que fait l'ouverture

1. **La réponse est prise** (`context.sended`) : plus rien ne peut répondre à la place du flux.
2. **La session est sauvée** s'il y en a une — ses cookies partent avec les en-têtes.
3. **Le transport se constate** : flux HTTP/2, ou réponse HTTP/1.1 ; ni l'un ni l'autre → 500,
   avant d'avoir rien écrit (`startSseStream()`, `SseStream.ts:340`).
4. **Les en-têtes partent** — `respond()` en HTTP/2, `flushHeaders()` en HTTP/1.1 — et le délai
   d'inactivité de la requête est **désarmé** : sans cela, le flux vivant prendrait un 408 au bout
   de 30 s.
5. **Le battement démarre** sur un minuteur `unref()`.

La fin, quel que soit le bout qui ferme, passe par **un seul** nettoyage (`SseStream.ts:242`) :
minuteur arrêté, écouteurs `close` et `drain` retirés, attente de `drain` libérée, puis les
écouteurs `onClose`.

## 🔐 Sécurité

- **Injection de flux** : `event` et `id` sont refusés s'ils contiennent CR, LF ou NUL
  (`singleLine()`, `SseStream.ts:71`) — une valeur venue d'un utilisateur ne peut pas clore
  l'événement pour en forger un autre. Les `data` sur plusieurs lignes sont découpés en autant de
  champs, jamais recopiés tels quels.
- **Client** : un serveur qui n'envoie jamais de fin de ligne ferait grossir la mémoire du client
  sans limite — `maxEventSize` (4 Mi par défaut) ferme la connexion.
- Le flux passe par le pipeline complet : pare-feu, CSRF et `@IsGranted` s'appliquent avant
  l'action, comme pour toute route.

## ⚠️ Pièges (symptôme → cause → correction)

| Symptôme                                          | Cause                                                                                         | Correction                                                                    |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Le flux n'apparaît qu'en entier, à la fin         | un proxy (nginx) le met en tampon                                                             | `X-Accel-Buffering: no` est posé ; vérifier un `proxy_buffering on` explicite |
| Le serveur ne voit jamais le client partir        | fermeture écoutée sur la REQUÊTE : en HTTP/1.1 elle a déjà émis `close` (corps lu, Node ≥ 16) | `sse.onClose()` — la fermeture est lue sur la RÉPONSE                         |
| `error` en boucle côté client après la fin voulue | une fin de flux est une coupure pour `EventSource` : il reconnecte                            | `close()` dans `onerror`, ou répondre 204 pour dire « fini »                  |
| Six onglets, et le site ne répond plus            | plafond de connexions HTTP/1.1 du navigateur                                                  | servir en HTTP/2                                                              |

## 🧪 Tests & couverture

| Type                 | Où                                                                                                                                                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unitaires — format   | `src/nodefony/src/tests/SseParser.test.ts` — une règle de WHATWG §9.2.5-9.2.6 par cas, borne de taille                                                                                                                            |
| Unitaires — client   | `src/nodefony/src/tests/NodefonySse.test.ts` — serveur `node:http` réel : ordre, `POST` + `Authorization`, reconnexion `Last-Event-ID`, 204, mauvais type, flux sans fin                                                          |
| Unitaires — `Accept` | `unit/acceptsEventStream.test.ts`                                                                                                                                                                                                 |
| Intégration          | `http/sse.test.ts` — serveur de développement, HTTP/1.1 ET HTTP/2 : événements dans l'ordre, en-têtes, départ du client vu (et pas avant) en `GET` et en `POST` avec corps, battement, négociation, `NodefonySse` de bout en bout |
| Mémoire              | `http/memory.test.ts` — flux fermés par le serveur et flux abandonnés par le client : pente du tas, scopes et contextes résiduels                                                                                                 |

Ces suites ont été vues échouer en débranchant le câblage : fin de ligne coupée entre deux morceaux,
`id` contenant NUL, `Last-Event-ID` retiré, 204 reconnecté, borne de taille ignorée, poids `q=0`
accepté, et fermeture écoutée sur la requête.

Ce qui **manque** : aucun banc de débit (événements par seconde) ; la contre-pression n'est pas
éprouvée sur un client réellement lent ; un flux en HTTP/3 n'existe pas (Node ne sert pas HTTP/3).

## 🔗 Pour aller plus loin

- ⬆️ **Retour au hub** : [@nodefony/http — vue du module](index.md) · [Toute la documentation](../../../../../docs/index.md)
- 🧭 **Pages sœurs** : [Serveurs](servers.md) — HTTP/2, TLS, délais ; [Proxy inverse](reverse-proxy.md).
