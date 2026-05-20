---
module: "@nodefony/core"
topic: service
audience: [human, ai]
tags: [service, base-class, di, events, logging, lifecycle]
status: draft
last-updated: 2026-05-20
---

# Service — Classe de base de tout composant Nodefony

> `Service` est la brique fondamentale de Nodefony. Toutes les classes du framework (`Kernel`, `Module`, `Controller`, adapters ORM, services applicatifs) en héritent. Elle intègre dans **une seule classe de base** trois responsabilités cohérentes : accès au Container DI, EventEmitter, logging structuré.

## Vue d'ensemble

```
┌────────────────────────────────────────────────────┐
│                     Service                        │
│  ┌──────────────────────────────────────────────┐  │
│  │   container: Container | null                │  │  ← DI delegation
│  │   .get<T>(name) / .set / .has / .remove     │  │
│  │   .getParameters / .setParameters           │  │
│  └──────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────┐  │
│  │   #nc: Event | undefined  (notifications)    │  │  ← EventEmitter delegation
│  │   .on / .once / .off / .emit / .fire        │  │
│  │   .fireAsync / .listen / .settingsToListen  │  │
│  └──────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────┐  │
│  │   syslog: Syslog | null                      │  │  ← Logging structuré
│  │   .log(msg, severity, msgid?, payload?)     │  │
│  │   → Pdu instance                             │  │
│  └──────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────┘
```

## Constructeur

```typescript
new Service(
  name: string,
  container?: Container,
  notificationsCenter?: Event | false | null,
  options?: DefaultOptionsService
)
```

| Paramètre | Défaut | Effet |
|-----------|--------|-------|
| `name` | (obligatoire) | Identifiant — apparaît dans les logs comme `msgid` |
| `container` | `new Container()` | DI partagé ou auto-créé |
| `notificationsCenter` | `new Event()` | `false` → pas d'events ; instance `Event` → partagé cross-services |
| `options.events.nbListeners` | 20 | Limite EventEmitter (propagé au nc partagé OU auto-créé) |
| `options.syslog` | `{ moduleName: name }` | Config Syslog interne |

**Modes de notificationsCenter** :
- `undefined` / `null` → un nouveau `Event` est créé, propre au service
- `false` → service sans events (les méthodes events throw `notificationsCenter not initialized`)
- `Event` partagé → tous les services partageant le même Event reçoivent les mêmes events (utile pour bus inter-services)

## Délégation Container DI

```typescript
// Récupérer un service
const db = svc.get<Database>("database");        // T | null (no throw si absent)

// Stocker
svc.set("config", { port: 3000 });                // throw si container=null

// Tester
svc.has("database");                               // boolean (no throw)

// Paramètres dot-notation
svc.setParameters("kernel.environment", "dev");
svc.getParameters("kernel.environment");           // "dev"
svc.setParameters("kernel.log.format", "json");
svc.getParameters("kernel.log");                   // { format: "json" }

// Supprimer
svc.remove("config");                              // toujours false (bug connu)
```

## Délégation EventEmitter (via `#nc`)

```typescript
// Écouter
svc.on("ready", handler);
svc.once("boot", oneShot);
svc.prependListener("ready", first);              // exécuté en 1er

// Émettre
svc.emit("ready", payload);
svc.fire("ready", payload);                        // alias emit (sync)
await svc.fireAsync("ready", payload);             // async — attend tous les handlers

// Supprimer
svc.off("ready", handler);
svc.removeListener("ready", handler);
svc.removeAllListeners();
svc.removeAllListeners("ready");

// Auto-wire via options
svc.settingsToListen({ onReady: myHandler, onBoot: bootHandler }, ctx);
// → équivalent à svc.on("onReady", myHandler) + svc.on("onBoot", bootHandler)
```

**Tracking des listeners** :
- `#trackedListeners: Map<event, listeners[]>` — tout ce qui passe par `on/once/addListener/prependListener/prependOnceListener` est tracé
- `off()` / `removeListener()` → détrace
- `clean()` retire UNIQUEMENT les listeners tracés de ce service → **pas de fuite mémoire inter-services** quand le nc est partagé

**⚠️ Listeners non-traçables** :
- `listen(eventName, fn)` — bind via API custom, **non tracé**
- `settingsToListen(opts, ctx)` — auto-wire, **non tracé**

Ces deux méthodes sont des shortcuts pratiques mais leurs listeners ne sont **pas retirés à `clean()`**.

## Logging structuré

```typescript
// Niveaux (SysLogSeverity)
// EMERGENCY(0) ALERT(1) CRITIC(2) ERROR(3) WARNING(4) NOTICE(5) INFO(6) DEBUG(7) SPINNER(-1)

const pdu = svc.log("message", "INFO");
const pdu = svc.log(errorObj, "ERROR", "AUTH", "user login failed");
svc.spinlog("Chargement...");                      // severity SPINNER (animation CLI)
svc.logger("debug payload");                       // console.debug direct
svc.trace(error);                                  // console.trace direct

// Pdu structure
pdu.severity;       // 6 (numérique)
pdu.severityName;   // "INFO" (string)
pdu.payload;        // message original
pdu.msgid;          // name du service si non fourni
pdu.timeStamp;      // Date.now()
pdu.moduleName;     // nom du syslog parent
```

**⚠️ Pièges fréquents** :
- C'est `"CRITIC"` PAS `"CRITICAL"` dans `SysLogSeverity`
- `pdu.severity` = number (pour comparaisons rapides), `pdu.severityName` = string (pour affichage)
- Si `syslog` est `null` (`clean()` appelé), un `Pdu` standalone est créé en fallback — logs perdus

## Pattern d'extension typique

```typescript
import { Service, Container, IKernel } from "nodefony";

class DatabaseService extends Service {
  private connection: Connection | null = null;

  constructor(container: Container) {
    super("database", container);
  }

  async initialize(kernel: IKernel): Promise<void> {
    const config = this.getParameters("database.config");
    this.connection = await connectTo(config);
    this.log(`Connected to ${config.host}`, "INFO");
    this.fire("onConnect", this.connection);
  }

  async query<T>(sql: string): Promise<T[]> {
    if (!this.connection) throw new Error("not connected");
    return this.connection.query(sql);
  }

  override clean(syslog?: boolean): void {
    this.connection?.close();
    this.connection = null;
    super.clean(syslog);
  }
}
```

## Cycle de vie — `clean()`

```typescript
svc.clean();          // services=null, container=null, kernel=null, syslog=null, #nc=undefined
svc.clean(true);      // idem + syslog.reset() (vide le ring buffer)
svc.clean(false);     // idem sans reset syslog
```

**Comportement** :
- Idempotent — appels multiples OK
- Si nc partagé : retire **uniquement** les listeners tracés par CE service
- Si nc auto-créé : `removeAllListeners()` puis perd la référence
- Tous appels events ultérieurs → throw `notificationsCenter not initialized`

## Pattern type — partage Container

```typescript
const container = new Container();
const sA = new Service("svcA", container);
const sB = new Service("svcB", container);

sA.set("config", { port: 3000 });
sB.get("config");  // { port: 3000 } — partagé via container
```

## Pattern type — partage notificationsCenter

```typescript
const sharedNC = new Event();
const sA = new Service("sA", undefined, sharedNC);
const sB = new Service("sB", undefined, sharedNC);

sB.on("broadcast", handler);
sA.fire("broadcast", payload);  // sB.handler est appelé
```

Le tracking par service garantit qu'à `sA.clean()`, seuls les listeners de `sA` sont retirés du `sharedNC` — `sB` continue de fonctionner.

## API complète — IService

| Méthode | Retour | Description |
|---------|--------|-------------|
| `getName()` | `string` | Nom du service |
| `initSyslog(env, debug, opts?)` | `Syslog \| null` | Initialise syslog (dev/prod/test) |
| `clean(syslog?)` | `void` | Libère toutes les références |
| `log(pci, sev?, msgid?, msg?)` | `Pdu` | Log structuré |
| `spinlog(msg)` | `Pdu` | Log SPINNER (animation CLI) |
| `logger(...)` | `void` | console.debug |
| `trace(...)` | `void` | console.trace |
| `get<T>(name)` | `T \| null` | Récupère du container |
| `set<T>(name, obj)` | `void` | Stocke (throw si container=null) |
| `has(name)` | `boolean` | Vérifie dans le container |
| `remove(name)` | `boolean` | Supprime du container (toujours `false` — bug connu) |
| `getParameters(name)` | `DynamicParam \| null` | Lire dot-notation |
| `setParameters(name, val)` | `DynamicParam \| null` | Écrire dot-notation |
| `on/off/once/emit/fire/...` | `this \| boolean` | EventEmitter (délégation) |

## Gotchas

| Symptôme | Cause | Fix |
|----------|-------|-----|
| `notificationsCenter not initialized` | `nc=false` au constructor OU après `clean()` | Ne pas appeler events après clean. Pour services utilitaires sans events, garder `nc=false` et NE PAS appeler `on`/`fire` |
| `Container bad argument name` | `set()` après `clean()` | Vérifier le cycle de vie |
| `remove()` retourne toujours `false` | Bug connu — Container.remove() OK mais Service ignore le retour | Ne pas se fier au retour de `Service.remove()` |
| `"CRITICAL"` ne fonctionne pas | C'est `"CRITIC"` dans `SysLogSeverity` | Utiliser `"CRITIC"` (ou la constante `SysLogSeverity.CRITIC`) |
| Listeners pas retirés après `clean()` | Listener attaché via `listen()` ou `settingsToListen()` — non tracés | Pour cleanup garanti, utiliser uniquement `on`/`once`/`addListener` |
| `pdu.severity === "INFO"` est `false` | `severity` est numérique (`6`) | Comparer `pdu.severityName === "INFO"` |
| Service ne reçoit pas l'event d'un autre service | NC pas partagé entre les deux | Passer le même `Event` au constructeur des deux services |

## Internals

### Getter privé `nc`

Pour éliminer 18× le pattern `if (!this.#nc) throw new Error(...)` dans chaque méthode events :

```typescript
private get nc(): Event {
  if (this.#nc === undefined) {
    throw new Error("Service nc undefined : notificationsCenter not initialized");
  }
  return this.#nc;
}
```

Toutes les méthodes events font `this.nc.on(...)`, `this.nc.fire(...)`, etc.

### `#sharedNc` flag

`true` si le `Event` passé au constructeur est externe (donc partagé). À `clean()`, ne pas faire `removeAllListeners()` global, seulement retirer ceux tracés par ce service.

### Propagation `nbListeners`

`options.events.nbListeners` est appliqué dans les **deux** branches (NC partagé externe ET NC auto-créé) — corrigé récemment. Avant, seul le NC partagé recevait la config.

## Liens

- **Code source** : `src/nodefony/src/Service.ts`
- **Interface** : `src/nodefony/src/types/IService.ts`
- **MEMORY.md** : `src/nodefony/MEMORY.md` (section "Service")
- **Container** : [`container.md`](./container.md)
- **Kernel** (qui hérite de Service) : [`kernel.md`](./kernel.md)
- **Syslog** (utilisé pour log()) : [`syslog.md`](./syslog.md)
- **Graphe symbolique** : `jq '.symbols.Service' .ai/symbols.json`
