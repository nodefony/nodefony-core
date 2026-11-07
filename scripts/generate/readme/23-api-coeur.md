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
  Inject,
  injectable,
  services,
  extend,
  typeOf,
  isArray,
} from "nodefony";

// Types (tree-shaken à la compilation)
import type { IKernel, IService, IContainer, IScope } from "nodefony";
```

> `Error` n'est plus exporté — utiliser `nodefonyError`.

---

## Nodefony — Classe statique

Point d'accès au kernel depuis n'importe où dans l'application.

```typescript
import { Nodefony } from "nodefony";

Nodefony.version; // version du paquet installé, ex. "10.0.0"
Nodefony.getKernel(); // Kernel | null (null avant boot)
Nodefony.generateId(); // UUID v4
Nodefony.generateSortableId(); // UUID v7 (ordonné dans le temps)
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
| `options.events.nbListeners` | 20                     | Nb max de listeners (propagé si Event partagé) |
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

// Supprimer : appelle clean() si c'est un Service, rend true si le service existait
svc.remove("db"); // true
```

> **Note** : `set()` lève une erreur si le container est null (après `clean()`).
>
> **Configuration** : le conteneur ne porte pas de configuration — chaque module lit la sienne dans
> `this.options`. À la fin de `onReady`, le kernel la fige en profondeur : elle est partagée par
> toutes les requêtes, et l'écrire lève alors une `TypeError`. Une config se complète au démarrage.

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
svc.getMaxListeners(); // 20 par défaut
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
| `remove(name)` | `boolean` | Supprime du container (appelle `clean()` si Service) — `true` si le service existait |
| `on/off/once/emit/fire/...` | `this \| boolean` | Events (délégation EventEmitter) |

### Comportements à connaître (gotchas)

| Comportement                         | Détail                                                         |
| ------------------------------------ | -------------------------------------------------------------- |
| `events.nbListeners` sur bus partagé | Relève le plafond d'un `Event` partagé, ne l'abaisse jamais    |
| `pdu.severity` vs `pdu.severityName` | Numérique vs string — utiliser `severityName` pour comparer    |
| `"CRITIC"` pas `"CRITICAL"`          | Nom exact dans l'enum SysLogSeverity                           |
| `removeAllListeners()`               | Corrigé — `(undefined)` ne vidait pas (bug `arguments.length`) |
| Events après `clean()`               | Tous throw `notificationsCenter not initialized`               |

---

## Syslog / Pdu

Voir [`src/syslog/`](https://github.com/nodefony/nodefony-core/tree/main/src/nodefony/src/syslog) — logger structuré RFC 5424 avec ring buffer O(1).
