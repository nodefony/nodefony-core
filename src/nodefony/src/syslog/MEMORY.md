# MEMORY.md — Syslog + Pdu

> Pour IA uniquement. Ultra-concis. Complémentaire au README.md.

---

## Pdu (`src/syslog/Pdu.ts`)

**Purpose** : Protocol Data Unit — entrée de log immuable créée à chaque `Syslog.log()`.

**Champs**
- `uid: number` — auto-incrémenté (module-global `guid`)
- `payload: Pci` (`unknown`) — le message brut
- `typePayload: string | null` — résultat de `fastTypeOf` (string/number/array/Error/Date/…)
- `severity: number` — valeur numérique (0–7, -1=SPINNER)
- `severityName: keyof SysLogSeverity` — reverse lookup O(1) via `severityNameMap`
- `timeStamp: number` — `Date.now()` par défaut (ms epoch)
- `moduleName: string` — origine du log
- `msgid: string` — identifiant du message
- `msg: string` — message complémentaire
- `status: Status` — `"NOTDEFINED" | "INVALID" | "ACCEPTED" | "DROPPED"`

**Sévérités** (`SysLogSeverity` enum)
```
EMERGENCY=0  ALERT=1  CRITIC=2  ERROR=3  WARNING=4  NOTICE=5  INFO=6  DEBUG=7  SPINNER=-1
```
**Attention** : c'est `CRITIC` pas `CRITICAL`. `SPINNER=-1` (animation CLI, non bufferisé).

**`translateSeverity(severity)`**
- string `"INFO"` → enum lookup `SysLogSeverity["INFO"] = 6`
- number `6` → `sysLogSeverity[6] = 6` (array validation 0–7)
- number `-1` → cas spécial SPINNER → retourne `-1` directement
- number invalide (ex: 99) → throw `Not a valid nodefony syslog severity`

**Gotchas**
- `pdu.severity` est le number, `pdu.severityName` est la string — ne pas confondre
- `severityNameMap` : Map précalculée `number → keyName` (O(1)) — utilisée dans le constructeur
- `sysLogSeverity` array : validator 0–7, index ≠ valeur pour SPINNER (index 8 = valeur -1)

---

## Syslog (`src/syslog/Syslog.ts`)

**Purpose** : Logger structuré avec buffer circulaire, filtrage conditionnel par événement, rate limiting.

**Étend** : `Event` (node:events)  
**Implémente** : `ISyslog`

**État**
- `_ring: CircularBuffer<Pdu>` — buffer FIFO O(1), capacité = `maxStack` (défaut 100)
- `settings: SyslogDefaultSettings` — merged avec `defaultSettings` au constructeur
- `valid/missed/invalid: number` — compteurs de logs
- `burstPrinted/start: number` — rate limiting courant

**`CircularBuffer<T>`** — interne
- `push(item)` : écrase le plus ancien si plein, avance `head`
- `last()` : O(1) dernier élément
- `toArray()` : FIFO (oldest first, newest last)
- `clear()` : reset head+size sans réallouer

**Logging API**
```typescript
syslog.log(payload, severity?, moduleName?, msg?)  // entrée principale → Pdu
syslog.error(data)                 // = log(data, "ERROR")
syslog.warn(data)                  // = log(data, "WARNING")
syslog.info(data)                  // = log(data, "INFO")
syslog.debug(data)                 // = log(data, "DEBUG")
syslog.trace(data)                 // = log(data, "NOTICE")
syslog.print(a, b, c)             // → Pdu, payload=[a,b,c] si >1 arg, defaultSeverity
syslog.logMultiple("ERROR", a, b) // → Pdu, payload=[a,b] si >1 arg, sévérité explicite
```

**Rate limiting** : `rateLimit: number (ms)` + `burstLimit: number`
- Si `burstPrinted >= burstLimit` dans la fenêtre `rateLimit` ms → `status = "DROPPED"`
- Reset automatique quand `now > start + rateLimit`

**Filtrage conditionnel**
- `listenWithConditions(conditions, callback)` = `filter(conditions, callback)`
- Attache un listener `onLog` wrappé par les conditions
- Opérateurs : `< > <= >= == === != RegExp`
- Conditions disponibles : `severity` | `msgid` | `date`
- Logique : `checkConditions: "&&" | "||"` (défaut `"&&"`)

**Condition `severity`** : après sanitize, `data` est `{ "INFO": 6, "WARNING": 4 }` (clé=nom, val=number)  
**Condition `msgid`** : après sanitize, `data` est soit `{ "NODEFONY": "||" }` (keys=msgids) soit une `RegExp`
- **⚠️ RegExp** : case spécial dans `conditionsObj.msgid` — `condition.data.test(pdu.msgid)` (pas de `for...in`)

**`getLogStack(start?, end?, condition?)`**
- Sans args → dernier Pdu (O(1) via `_ring.last()`)
- `(0, 10)` → `slice(0, 10)` (index dans le buffer trié FIFO)
- `(n, n)` → `stack[length - n - 1]` (indexation depuis la fin)

**`init(environment, debug?, options?)`**
- Attache le listener de sortie console via `conditionOptions(env, debug)`
- `conditionOptions("development", false)` → severity <= 6 (INFO)
- `conditionOptions("development", true)` → severity <= 7 (DEBUG)
- `conditionOptions(other, debug)` → severity <= 6 ou <= 7 selon debug

**Sortie console** : `Syslog.normalizeLog(pdu)` via `Syslog.wrapper(pdu)` → couleurs cli-color

**Cycle de vie**
- `reset()` / `clean()` → vide le ring + retire tous les listeners
- `clearLogStack()` → vide uniquement le ring

**Console Override**
- `overrideConsole: true` dans settings → active au constructeur
- `Syslog.overrideConsole(instance)` → `console.log/info/warn/error/debug` redirigés vers syslog
- `Syslog.restoreConsole()` → restore l'original (idempotent)
- Double appel → WARNING pdu, pas de crash
- `_nativeConsole` : méthodes console capturées au chargement de module — utilisées par `wrapper()` et `normalizeLog()` pour éviter la récursion infinie
- `console.log(a, b)` → `print(a, b)` → 1 Pdu, `payload=[a,b]`

**Transport Layer**
- `ITransport { name: string; send(pdu): Promise<void> }` — interface dans `types/ITransport.ts`
- `addTransport(t): this` / `removeTransport(t): this` — ajoute/retire un transport (deduplication par référence)
- Firing : fire-and-forget après `fire("onLog")`, uniquement si `pdu.status === "ACCEPTED"`
- Erreur transport → `fire("onTransportError", err, pdu)` (pas de crash)
- `ConsoleTransport` : wraps `Syslog.normalizeLog` — `new ConsoleTransport(pid?)`
- `FileTransport` : `appendFile` JSON ou text — `new FileTransport({ path, format? })`
- `HttpTransport` : POST JSON natif `node:http`/`node:https` — `new HttpTransport({ url, headers?, timeout? })`
- Exports : `transports/index.ts` + re-exportés depuis `index.ts` principal

**Deps** : `Event`, `Pdu`, `cli-color`, `extend` (Tools), `ISyslog`, `ITransport`

**Gotchas**
- `warnning` (avec double n) supprimé — utiliser `warn`
- `filter()` modifie `conditions` par référence via `extend(true, {}, conditions)` — deep clone
- `loadStack(stack, doEvent, beforeConditions)` : `beforeConditions` appelé AVANT `fire("onLog")`
- `logicCondition["&&"]` retourne `false` si l'objet de conditions est vide
- DROPPED pdu → transports **non** appelés (seuls les ACCEPTED passent)
