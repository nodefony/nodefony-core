<div align="center">

<img src="https://raw.githubusercontent.com/nodefony/nodefony-core/claude-ts/docs/assets/nodefony-logo.png" alt="Nodefony" height="96">

# Nodefony

**Le framework Node.js fullstack : temps réel natif, développement agentic-ready, sur un socle TypeScript isomorphe.**

_Une action de contrôleur. Deux transports. La même session, la même sécurité, le même code._

[![Licence CeCILL-B](https://img.shields.io/badge/licence-CeCILL--B-blue.svg?style=flat-square)](https://github.com/nodefony/nodefony-core/blob/claude-ts/LICENSE.txt)
[![Node ≥ 24](https://img.shields.io/badge/Node.js-%E2%89%A5%2024-green?style=flat-square)](https://nodejs.org/)
[![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-blue?style=flat-square)](https://www.typescriptlang.org/)
[![ESM](https://img.shields.io/badge/ESM-only-orange?style=flat-square)](https://nodejs.org/api/esm.html)

</div>

---

> **Ce paquet est le CŒUR du framework** — noyau, injection de dépendances, modules, journalisation,
> interface en ligne de commande. Il s'installe rarement seul : une application le reçoit par
> `npm create nodefony@alpha`, et les autres paquets (`@nodefony/http`, `@nodefony/framework`,
> `@nodefony/security`…) le déclarent en dépendance de pair.

```bash
npm install nodefony@alpha
```

> Le dist-tag est OBLIGATOIRE tant que la série 10 est en préversion : `latest` sert encore la
> `7.0.2`, écrite en JavaScript, dont l'API n'a aucun rapport avec ce qui suit.

## Ce que c'est

Nodefony est un framework serveur fullstack pour Node.js, écrit en TypeScript strict et bâti
directement sur les modules natifs de la plateforme — `node:http`, `node:http2`, WebSocket. Il
apporte un noyau à injection de dépendances, un système de modules, un pare-feu applicatif, une
persistance portable, une console d'administration et la construction des frontends.

Sa particularité tient en une propriété : **le WebSocket n'y est pas un ajout.** C'est un transport
de première classe, servi par le même pipeline, la même table de routes et la même sécurité que le
HTTP. Une application temps réel s'y écrit comme une application web ordinaire.

Le socle est **isomorphe** : le même paquet s'importe côté serveur et côté navigateur. Le client
temps réel, les règles d'autorisation et les types d'une ressource sont écrits une fois et
s'exécutent là où ils servent — une règle corrigée l'est des deux côtés.

Nodefony est publié depuis **2017** en JavaScript et a mûri jusqu'à sa version 7. La série 10 est
une **réécriture complète en TypeScript** : même projet, mêmes concepts, repensés pour ce que
Node.js et TypeScript sont devenus.

## Une action, deux transports

Même classe, même session, mêmes règles d'accès — seul le transport déclaré change :

```typescript
import {
  route,
  controller,
  Controller,
  CurrentUser,
} from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";

@controller("/api/blog")
class BlogController extends Controller {
  constructor(context: ContextType) {
    super("blog", context);
  }

  @route("blog-index", { path: "", method: "GET" })
  async index(@CurrentUser() user?: { identifier?: string }) {
    return this.renderJson({
      hello: "blog",
      who: user?.identifier ?? "anonyme",
    });
  }

  @route("blog-echo", {
    path: "/echo",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async echo(message: string | Buffer | null) {
    if (!message) return this.renderJson({ handshake: true });
    return this.renderJson({ echo: message.toString() });
  }
}
```

La pseudo-méthode `WEBSOCKET` est traitée comme un verbe HTTP ordinaire : **une seule table de
routes** pour les deux transports, et la même bulle `AsyncLocalStorage` du handshake à la fermeture.
Une règle d'autorisation protège donc l'action quel que soit le transport, et la session ouverte en
HTTP est celle que voit la socket.

## Démarrer

```bash
npm create nodefony@alpha mon-app
```

Puis, dans le dossier créé : `npm run dev`.

Le générateur produit une application complète — configuration validée, base de données au choix,
frontend optionnel (React, Vue, Angular, Svelte), `Dockerfile`, et un `AGENTS.md` dérivé du projet.

## Les paquets de la série 10

| Paquet                                                             | Rôle                                                        |
| ------------------------------------------------------------------ | ----------------------------------------------------------- |
| **`nodefony`**                                                     | ce paquet — noyau, DI, modules, journalisation, CLI         |
| `@nodefony/http`                                                   | serveurs HTTP/1.1, HTTP/2 et WebSocket, contextes, sessions |
| `@nodefony/framework`                                              | routeur, contrôleurs, décorateurs de route                  |
| `@nodefony/security`                                               | pare-feu applicatif, authentification, autorisation         |
| `@nodefony/orm-core` · `@nodefony/drizzle` · `@nodefony/mongoose`  | persistance portable                                        |
| `@nodefony/user`                                                   | entité et service utilisateur                               |
| `@nodefony/realtime`                                               | canaux temps réel, diffusion multi-instances                |
| `@nodefony/frontend`                                               | pilotage de Vite, rechargement à chaud, construction        |
| `@nodefony/studio`                                                 | console d'administration                                    |
| `@nodefony/documentation` · `@nodefony/devkit` · `@nodefony/redis` | documentation, outillage agent, cache et bus                |

## Aller plus loin

- **Documentation** — <https://nodefony.github.io/nodefony-core/>
- **Dépôt et suivi** — <https://github.com/nodefony/nodefony-core>
- **Journal des versions** — <https://github.com/nodefony/nodefony-core/blob/claude-ts/CHANGELOG.md>

---

# API du cœur

Ce qui suit documente le paquet `nodefony` lui-même. Pour écrire une application — contrôleurs,
routes, sécurité —, se reporter à la documentation ci-dessus.

## Exports ESM

Le package `nodefony` est **ESM-only** — zéro `require()`, zéro default export.

```typescript
// Imports nommés uniquement
import {
  Nodefony,
  Kernel,
  Module,
  Service,
  Container,
  Event,
  Syslog,
  Pdu,
  nodefonyError,
  inject,
  injectable,
  services,
  entities,
  extend,
  typeOf,
  isArray,
} from "nodefony";

// Types (tree-shaken à la compilation)
import type {
  IKernel,
  IService,
  IContainer,
  IScope,
  DynamicParam,
} from "nodefony";
```

> `Error` n'est plus exporté — utiliser `nodefonyError`.

---

## Nodefony — Classe statique

Point d'accès au kernel depuis n'importe où dans l'application.

```typescript
import { Nodefony } from "nodefony";

Nodefony.version; // "10.0.0"
Nodefony.getKernel(); // Kernel | null (null avant boot)
Nodefony.generateId(); // UUID v4
Nodefony.generateV5Id(name); // UUID v5
```

---

## Service — Classe de base du framework

`Service` est la brique fondamentale de Nodefony. Toutes les classes du framework (Kernel, Module, Controller, adapters ORM, services applicatifs) en héritent.

Elle intègre trois responsabilités dans une seule classe de base :

- **DI Container** — accès et injection de dépendances
- **EventEmitter** — système de notifications (délégation vers un `Event` interne)
- **Logging structuré** — via `Syslog` / `Pdu`

### Usage minimal

```typescript
import { Service } from "nodefony";

const svc = new Service("myService");
svc.log("Hello Nodefony", "INFO");
svc.on("ready", () => console.log("ready!"));
svc.emit("ready");
```

### Constructeur

```typescript
new Service(
  name: string,
  container?: Container,
  notificationsCenter?: Event | false | null,
  options?: DefaultOptionsService
)
```

| Paramètre                    | Défaut                 | Effet                                          |
| ---------------------------- | ---------------------- | ---------------------------------------------- |
| `container`                  | `new Container()`      | Container DI partagé ou auto-créé              |
| `notificationsCenter`        | `new Event()`          | `false` = pas d'events ; `Event` = partagé     |
| `options.events.nbListeners` | 10                     | Nb max de listeners (propagé si Event partagé) |
| `options.syslog`             | `{ moduleName: name }` | Config du Syslog interne                       |

### Extension (pattern typique)

```typescript
import { Service, Container } from "nodefony";

class MyService extends Service {
  constructor(container: Container) {
    super("MyService", container);
  }

  async doWork(): Promise<void> {
    this.log("Starting work", "INFO");
    this.fire("onWork", { ts: Date.now() });
  }
}
```

### Container DI

```typescript
// Stocker / récupérer des services
svc.set("db", dbInstance);
const db = svc.get<Database>("db");
svc.has("db"); // true

// Paramètres (dot notation)
svc.setParameters("app.name", "myApp");
svc.getParameters("app.name"); // "myApp"
svc.setParameters("app.config.debug", true);
svc.getParameters("app.config.debug"); // true

// Supprimer (appelle clean() si Service)
svc.remove("db"); // retourne toujours false (comportement actuel)
```

> **Note** : `set()`, `setParameters()` lèvent une erreur si le container est null (après `clean()`).

### Events

```typescript
// Écouter
svc.on("myEvent", (data) => console.log(data));
svc.once("boot", () => console.log("booted once"));
svc.addListener("myEvent", handler);
svc.prependListener("myEvent", firstHandler); // exécuté avant les autres

// Émettre
svc.emit("myEvent", payload);
svc.fire("myEvent", payload); // alias emit
await svc.fireAsync("myEvent", data); // async, attend les handlers async
await svc.emitAsync("myEvent", data); // alias fireAsync

// Supprimer
svc.off("myEvent", handler);
svc.removeListener("myEvent", handler);
svc.removeAllListeners(); // vide tous les events
svc.removeAllListeners("myEvent"); // vide un event spécifique

// Introspection
svc.eventNames(); // ['myEvent', ...]
svc.listenerCount("myEvent"); // 2
svc.listeners("myEvent"); // [fn1, fn2]
svc.getMaxListeners(); // 10
svc.setMaxListeners(50);

// Auto-wire via options (clés onFoo)
svc.settingsToListen({ onReady: myHandler }, context);

// listen() — retourne une fonction fire
const fire = svc.listen("myEvent", handler);
fire(); // émet "myEvent"
```

> Toutes les méthodes events lèvent `Error: notificationsCenter not initialized` si `notificationsCenter=false` ou après `clean()`.

### Logging

```typescript
// Niveaux disponibles (SysLogSeverity)
// EMERGENCY(0) ALERT(1) CRITIC(2) ERROR(3) WARNING(4) NOTICE(5) INFO(6) DEBUG(7)

svc.log("message", "INFO");
svc.log("erreur", "ERROR", "MSGID", "détails");
svc.logger("debug payload"); // console.debug
svc.trace("trace payload"); // console.trace

// Pdu retourné
const pdu = svc.log("msg", "WARNING");
pdu.severityName; // "WARNING" (string)
pdu.severity; // 4 (numérique)
pdu.payload; // "msg"
pdu.msgid; // nom du service si msgid non fourni
pdu.timeStamp; // Date.now()

// Initialiser le syslog (filtres par env/debug)
svc.initSyslog("production", false);
svc.initSyslog("development", true);
```

> **Attention** : le niveau s'appelle `"CRITIC"`, pas `"CRITICAL"`.

### Cycle de vie

```typescript
svc.getName(); // "myService"

// Nettoyage complet
svc.clean(); // container=null, kernel=null, syslog=null, #nc=undefined
svc.clean(true); // idem + syslog.reset() (vide le ring buffer)
svc.clean(false); // idem sans reset syslog
```

### Partage de container (scénario framework)

```typescript
const container = new Container();
const sA = new Service("serviceA", container);
const sB = new Service("serviceB", container);

// sA et sB partagent le même DI
sA.set("config", { port: 3000 });
sB.get("config"); // { port: 3000 }

// Kernel partagé
container.set("kernel", kernel);
// tous les services créés avec ce container récupèrent kernel automatiquement
```

### Partage de notificationsCenter

```typescript
const sharedNC = new Event();
const sA = new Service("sA", undefined, sharedNC);
const sB = new Service("sB", undefined, sharedNC);

sA.on("broadcast", handler);
sB.on("broadcast", handler);
sharedNC.emit("broadcast"); // les deux services reçoivent
```

### API complète — IService

<!-- prettier-ignore -->
| Méthode | Retour | Description |
| --- | --- | --- |
| `getName()` | `string` | Nom du service |
| `initSyslog(env, debug, opts?)` | `Syslog \| null` | Initialise le syslog |
| `clean(syslog?)` | `void` | Libère toutes les références |
| `log(pci, sev?, msgid?, msg?)` | `Pdu` | Log structuré |
| `logger(pci, ...args)` | `void` | console.debug |
| `trace(pci, ...args)` | `void` | console.trace |
| `get<T>(name)` | `T \| null` | Récupère du container |
| `set<T>(name, obj)` | `void` | Stocke dans le container |
| `has(name)` | `boolean` | Vérifie dans le container |
| `remove(name)` | `boolean` | Supprime du container (toujours `false`) |
| `getParameters(name)` | `DynamicParam \| null` | Paramètre dot-notation |
| `setParameters(name, val)` | `DynamicParam \| null` | Définit paramètre |
| `on/off/once/emit/fire/...` | `this \| boolean` | Events (délégation EventEmitter) |

### Comportements à connaître (gotchas)

| Comportement                         | Détail                                                         |
| ------------------------------------ | -------------------------------------------------------------- |
| `remove()` retourne `false`          | Toujours, même si suppression réussie                          |
| `events.nbListeners` ignoré          | Seulement appliqué si Event partagé passé au constructeur      |
| `pdu.severity` vs `pdu.severityName` | Numérique vs string — utiliser `severityName` pour comparer    |
| `"CRITIC"` pas `"CRITICAL"`          | Nom exact dans l'enum SysLogSeverity                           |
| `removeAllListeners()`               | Corrigé — `(undefined)` ne vidait pas (bug `arguments.length`) |
| Events après `clean()`               | Tous throw `notificationsCenter not initialized`               |

---

## Syslog / Pdu

Voir [`src/syslog/`](https://github.com/nodefony/nodefony-core/tree/claude-ts/src/nodefony/src/syslog) — logger structuré RFC 5424 avec ring buffer O(1).
