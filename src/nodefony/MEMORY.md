# MEMORY.md — @nodefony/core workspace

> Pour IA uniquement. Ultra-concis. 0 redondance. Complémentaire au README.md.

---

## Service (`src/Service.ts`) — clé de voûte du framework

**Purpose** : Classe de base de tout service Nodefony. Kernel, Module, Controller, adapters ORM en héritent tous.

**Core Components**
- `name: string` — identifiant du service
- `container: Container | null` — DI container (injection)
- `kernel: IKernel | null` — récupéré depuis `container.get("kernel")`
- `syslog: Syslog | null` — logger structuré (auto-créé si absent du container)
- `#nc: Event | undefined` — EventEmitter privé (notificationsCenter)

**Constructeur**
```
Service(name, container?, notificationsCenter?, options?)
```
- `container` absent → `new Container()` créé automatiquement
- `notificationsCenter=false` → pas d'Event (mode silencieux)
- `notificationsCenter=null` → traité comme absent → nouveau Event créé
- `notificationsCenter=Event` → Event partagé (cross-services) → `#sharedNc=true`
- Syslog réutilisé depuis container si présent, sinon auto-créé (variable locale, pas champ)
- `options.events.nbListeners` → propagé dans les DEUX branches (partagé et auto-créé)
- `options.events` supprimé de `this.options` après construction
- `notificationsCenter` mis dans container seulement si PAS de kernel (intentionnel)

**Events — délégation vers `#nc` via getter privé `nc`**
- Getter privé `nc` : lance `Error: notificationsCenter not initialized` si `#nc undefined` — élimine le if/throw ×18
- Tous les EventEmitter standard : `on/off/once/emit/addListener/removeListener/removeAllListeners/prependListener/prependOnceListener/listeners/rawListeners/listenerCount/eventNames/setMaxListeners/getMaxListeners`
- `fire()` = alias `emit()` | `fireAsync()`/`emitAsync()` = async
- `listen(eventName, fn)` → bind le listener → pas traçable → non retiré à `clean()`
- `settingsToListen(opts, ctx)` → auto-wire clés `onFoo` comme listeners (non traçable)
- **Tracking** : `#trackedListeners: Map<event, listeners[]>` — tout ce qui passe par `on/once/addListener/prependListener/prependOnceListener` est tracé
- `off/removeListener` → détrace | `removeAllListeners` → vide la map
- **clean() avec Event partagé** : retire uniquement les listeners traçés de ce service → pas de fuite mémoire inter-services

**Logging**
- `log(pci, severity?, msgid?, msg?)` → `Pdu`
- `pdu.severity` = numérique (enum `SysLogSeverity`), `pdu.severityName` = string
- Severités : `EMERGENCY(0) ALERT(1) CRITIC(2) ERROR(3) WARNING(4) NOTICE(5) INFO(6) DEBUG(7) SPINNER(-1)`
- Attention : c'est "CRITIC" pas "CRITICAL"
- `spinlog(msg)` = `log(msg, "SPINNER")`
- `logger(pci)` = `console.debug` | `trace(pci)` = `console.trace`
- Fallback si `syslog null` : `new Pdu(pci, severity, this.name, msgid, msg)` — moduleName = nom du service

**Container delegation**
- `get<T>(name)` → `null` si container null (no throw)
- `set<T>(name, obj)` → **throw** si container null
- `has(name)` → `false` si container null (no throw)
- `getParameters(name)` → `null` si container null (no throw)
- `setParameters(name, val)` → **throw** si container null
- `remove(name)` → **toujours `false`** (bug connu — Container.remove() retourne true mais Service l'ignore)
- `remove()` appelle `clean()` sur les enfants `instanceof Service`

**Cycle de vie**
- `initSyslog(env, debug, options?)` → initialise le syslog (dev/prod/test)
- `clean(syslog=false)` → null toutes les refs. `clean(true)` appelle `syslog.reset()`
- `clean()` idempotent

**Héritage**
- Étendre avec `class MyService extends Service`
- `super(name, container, notificationsCenter, options)` dans le constructeur
- `remove()` appelle `clean()` sur toute sous-classe `instanceof Service`

**Deps** : `Container`, `Event` (node:events), `Syslog`, `Pdu`, `IService`, `IKernel`

**Gotchas**
- `Service.remove()` retourne `true` si trouvé/supprimé, `false` sinon (propagé depuis Container)
- `options.events.nbListeners` propagé dans les deux branches (partagé et auto-créé)
- `settingsToListen()` et `listen()` → listeners non traçés → PAS retirés à `clean()`
- `settingsToListen()` matche regex `^on(.*)$` — event name = la clé complète (`onFoo`)
- `pdu.severity` = number, `pdu.severityName` = string — ne pas confondre
- "CRITICAL" n'existe pas — c'est "CRITIC" dans SysLogSeverity
- NC dans container seulement si pas de kernel → intentionnel (kernel expose son propre NC)

---

## Container (`src/Container.ts`) — `implements IContainer`

**Purpose** : DI Container — registry de services + paramètres dot-notation + scopes hiérarchiques.

**Interfaces** : `src/types/IContainer.ts` — `IContainer` + `IScope`
- `Container implements IContainer`
- `Scope extends Container implements IScope`
- `IService.container` typé `IContainer | null` (pas la classe concrète)

**Core**
- `id: string` — uuid unique (public)
- `services: DynamicService | null` — map des services (hérite de `protoService.prototype`)
- `parameters: DynamicParam | null` — map dot-notation
- `scopes: Scopes` — scopes nommés, chacun indexé par id

**Services API**
- `set(name, obj)` — stocke dans `services[name]` ET `protoService.prototype[name]` (héritage scopes)
- `get<T>(name)` → `T | null` — utilise `name in this.services` (inclut prototype chain)
- `has(name)` → `boolean` — utilise `name in this.services` (pas `!!value` — supporte valeurs falsy)
- `remove(name)` → `true` si trouvé/supprimé — utilise `name in this.services` (pas `!!get()`)
  → propage récursivement aux scopes ouverts
- `keys()` / `entries()` — liste les services propres

**Paramètres**
- `setParameters(name, val)` — dot-notation, crée les nœuds intermédiaires automatiquement
- `getParameters(name)` → `DynamicParam | null`
- Erreur si name non-string, value undefined, ou descente dans un nœud non-objet

**Scopes**
- `addScope(name)` — déclare un scope (idempotent), retourne le dict existant si déjà créé
- `enterScope(name)` → `IScope` — crée une instance Scope héritant du proto du parent
- `leaveScope(scope: IScope)` — nettoie le scope, le retire du dict
- `removeScope(name)` — nettoie tous les sous-scopes d'un nom
- `Scope extends Container implements IScope` — `name: string` + `getParameters(name, merge=true, deep=true)`
- `Scope.getParameters(name, merge=true, deep=true)` — merge local + parent si les deux sont des objets

**Cycle de vie**
- `clean()` — `services=null`, `parameters=null`, nettoie tous les scopes
- `reset()` — `clean()` + recrée protoService/protoParameters → utilisable à nouveau

**Constructeur clone**
- `new Container(parent)` — shallow clone (services et params partagés via proto)
- `new Container(parent, true)` — deep clone des paramètres (`structuredClone` avec fallback)

**Gotchas**
- `has()` et `remove()` utilisent `name in services` (pas `!!value`) — valeurs falsy (0, false, "") correctement gérées
- `set()` après `clean()` → throw "Container bad argument name" (message trompeur — vraie cause : services=null)
- `get(name)` retourne `null` si value est `null` (null stocké → `services[name] = null` → retourne null comme "absent")
- Service ajouté au parent APRÈS `enterScope()` → visible dans le scope (late binding via proto)
- `remove()` dans parent → propagé aux scopes ouverts

---

## Event (`src/Event.ts`)

→ Étend `node:events` EventEmitter. Ajoute : `fire()`, `fireAsync()`, `emitAsync()`, `listen()`, `settingsToListen()`.

---

## Syslog

→ Voir [`src/syslog/MEMORY.md`](src/syslog/MEMORY.md)
