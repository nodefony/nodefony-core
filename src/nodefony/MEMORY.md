# MEMORY.md — @nodefony/core workspace

> Pour IA uniquement. Ultra-concis. 0 redondance. Complémentaire au README.md.

## Docs liées

- [`../../CLAUDE.md`](../../CLAUDE.md) — règles projet globales + index complet des MEMORY/CLAUDE
- Sous-modules core : [`src/syslog/MEMORY.md`](src/syslog/MEMORY.md) (Syslog/Pdu) | [`src/kernel/MEMORY.md`](src/kernel/MEMORY.md) (Kernel/Module/CliKernel) | [`src/kernel/injector/MEMORY.md`](src/kernel/injector/MEMORY.md) (DI) | [`src/cli/MEMORY.md`](src/cli/MEMORY.md) (Cli/Command) | [`src/finder/MEMORY.md`](src/finder/MEMORY.md) (FileClass/Finder)
- Consommateurs : [`../packages/@nodefony/http/MEMORY.md`](../packages/@nodefony/http/MEMORY.md) | [`../packages/@nodefony/framework/MEMORY.md`](../packages/@nodefony/framework/MEMORY.md)

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

## Nodefony (`src/Nodefony.ts`) — classe statique singleton

**Purpose** : Point d'entrée unique au kernel. Remplace l'ancien objet `nodefony` global.

```typescript
import { Nodefony } from "nodefony";
Nodefony.version           // string — depuis package.json
Nodefony.getKernel()       // Kernel | null — avant boot = null
Nodefony.setKernel(k)      // appelé dans Kernel constructor
Nodefony.generateId()      // uuidv4 string
Nodefony.generateV5Id(name, ns?) // uuidv5 string
```

**Règle** : `private constructor()` — jamais instancier. `#kernel` est un champ privé statique.

**Gotchas**
- `getKernel()` retourne `null` avant `Kernel.start()` — toujours utiliser `?.`
- Ancienne API supprimée : `nodefony.kernel`, `nodefony.generateId()`, default export

---

## index.ts — barrel ESM (`src/index.ts`)

**Règle** : zéro default export — tout est nommé. `import { X } from "nodefony"` uniquement.

**Exports clés** :
```typescript
// Classes
Nodefony, Kernel, Module, CliKernel, Service, Container, Event, Syslog, Pdu
// Erreurs
nodefonyError        // ← anciennement exporté comme "Error" (cassant)
// ORM
Orm, Entity, Connector
// DI
inject, injectable, services, entities, modules
// Utils
extend, typeOf, isArray, isPromise, isPlainObject, isFunction, isContainer
// Types (import type)
IKernel, IService, IContainer, IScope, IModule, ISyslog
DynamicParam, DynamicService, ProtoService, ProtoParameters
```

**Migration `nodefony` default → named** :
```typescript
// Avant (cassé)
import nodefony, { Kernel } from "nodefony";
nodefony.kernel  //  ← undefined
// Après
import { Nodefony, Kernel } from "nodefony";
Nodefony.getKernel()
```

**Types path** : `dist/types/src/index.d.ts` (après `npm run clean && npm run build` dans `src/nodefony`)

---

## Event (`src/Event.ts`)

→ Étend `node:events` EventEmitter. Ajoute : `fire()`, `fireAsync()`, `emitAsync()`, `listen()`, `settingsToListen()`.

---

## Syslog

→ Voir [`src/syslog/MEMORY.md`](src/syslog/MEMORY.md)

---

## Client isomorphe (`src/client/`) — subpaths navigateur

Build Rollup dédié (`createClientConfig`, `tsconfigClient.json` `types:[]`), shims `node:util/events/cli-color`, sortie `dist/client/`.

- **`nodefony`** (cond. `browser`) + **`nodefony/client`** : barrel browser (RealtimeClient, Pdu, Syslog, Tools…). Bundle ~25 KB gz. **Ne JAMAIS** réexporter sip/media/debugbar depuis `client/index.ts` (exploserait le barrel).
- **`nodefony/debugbar`** : subpath debug bar (entry Rollup séparée, RealtimeClient/Pdu **partagés** via preserveModules → 0 duplication). `mountDebugBar(opts?)` + `DebugBar`. Vanilla TS + **Shadow DOM**, 0 dep UI.
- **`nodefony/debugbar.js`** : bundle **standalone mono-fichier** (`createDebugbarStandaloneConfig` → `dist/client/debugbar.standalone.js`, deps inlinées) pour `<script type="module" src>` sur page rendue serveur (EJS/Twig, hors Vite).

### Debug bar — internals
- `debugbar/{DebugBar,model,format,hmr,index}.ts`. **model/format = purs** (testés `tests/DebugBar.test.ts`, 12). DOM = vérif navigateur.
- Données via `RealtimeClient` (canaux `dashboard:stats` + `syslog:stream`, endpoint défaut `/nodefony/studio/api/realtime`). Logs **réhydratés en `new Pdu()`** (champs `payload`/`moduleName`/`severity`, PAS `pci`/`msgid`).
- Pouls realtime = `client.framesReceived` (msg/s + VU). Sonde HMR Vite = `connectViteHmr` (2ᵉ client WS `vite-hmr`, dev). Sparklines = SVG maison (pas recharts).
- Env + branche git viennent du bloc `app` de `dashboard:stats` (poussé serveur, cf studio providers).
- Chrome persisté localStorage : `nf.debugbar.{visible,min,side}`. Handle global `window.__NODEFONY_DEBUGBAR__` (show/hide/minimize) → bridge app (Studio).
- Gotcha : le conteneur `.minbar` (chip réduit) n'a pas de `[data-el]` → ref stockée à la main (sinon barre réduite invisible).
