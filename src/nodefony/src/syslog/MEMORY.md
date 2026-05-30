# MEMORY.md — Syslog + Pdu

> Pour IA uniquement. Ultra-concis. Complémentaire au README.md.

## Docs liées

- [`../../MEMORY.md`](../../MEMORY.md) — workspace core (Service consomme Syslog)
- [`../kernel/MEMORY.md`](../kernel/MEMORY.md) — Kernel.initializeLog() + CliKernel.initSyslog()
- [`../../../../CLAUDE.md`](../../../../CLAUDE.md) — règles projet

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
- `pid: number` — procid RFC 5424, capté 1× au load (const `PID`). Browser → 0.
- `requestId?: string` — ALS via `Pdu.requestIdProvider` (provider injectable, ajouté 2026-05-27)

**Provider injectable `Pdu.requestIdProvider`** (corrélation log↔requête)

- Type : `(() => string | undefined) | null`
- Node : branché dans `src/index.ts` sur `RequestContext.getRequestId`
- Browser/debugbar : **non branché** (reste `null`) → 0 lecture ALS, 0 alloc (provider null → 1 test de référence ~5 ns)
- Coût ajouté par Pdu côté Node : ~50-100 ns (ALS lookup + access)
- Slot toujours créé (`this.requestId = undefined` hors bulle) pour `parseJson` réhydratation ; JSON.stringify ignore `undefined` (0 verbosité)

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

**Sortie console** : `Syslog.normalizeLog(pdu)` (via `console.*`) OU `Syslog.rawLog(pdu)`
(write direct `process.stdout/stderr`, 0 overhead console). Le listener serveur (`CliKernel.initSyslog`)
utilise **`rawLog`**. Couleurs via `Syslog.wrapper(pdu)`.

**Bufférisation sortie (process-global, sink stdout)** — `Syslog.setOutputBuffering(mode)` / `flushOutput()`

- `mode` : `"auto"` (défaut, câblé par `Kernel.initializeLog` ← `config.log.buffered`) | `true` | `false`.
  `"auto"` = bufférise si stdout **n'est pas un TTY** (pipe/fichier) ; immédiat sur TTY.
- Bufférisé = coalesce les writes d'un même tick en 1 `write()` via `setImmediate` (+ cap 64 KB) ;
  flush sur `process.on("exit"/"beforeExit")`.
- **stderr (sévérité ≤ 3) TOUJOURS immédiat** (+ flush stdout d'abord → ordre causal `2>&1`).
- **SPINNER (-1) jamais bufférisé** (`_writeStdoutNow`, animation `\r`).
- **Isomorphe** : `setImmediate`/`process` via `globalThis` → navigateur = pas de scheduler ⇒ `_resolveBufferOn()=false` ⇒ jamais bufférisé (retombe sur `console.*`).
- ⚠️ **Perf** : sur un sink **local rapide (fichier)** le gain RPS est ~nul (writes cheap) — mesuré
  2026-05-30 : logging ON≈OFF≈bufférisé (~3550 RPS @C=20). Le bénéfice réel = sink **lent/backpressuré**
  (pipe prod → collecteur). Reste un nettoyage structurel (`rawLog` sans `util.format`/ligne).

**Driver de sink (LB.W — write enfichable)** — `Syslog.setLogSink(sink)` / `Syslog.logSinkName`

- Le sink FINAL (où partent les lignes APRÈS coalescing) est un `ILogSink { name, writeOut, writeErr, flushSync, close }`. Le ring/coalescing par tick (`writeOut`) reste DEVANT, inchangé.
- 3 drivers : `stdout` (défaut, isomorphe = comportement HISTORIQUE exact, 0 régression), `null` (`NULL_LOG_SINK`, noop = bench /dev/null), `file` (`FileSink`, **Node-only** `sinks/FileSink.ts`).
- **`FileSink`** : fd persistant ouvert en `"a"` (append), **un fd PAR worker** → 0 lock d'inode partagé (le goulet cluster). 2 modes :
  - **async** (défaut) : `fs.write` threadpool + buffer borné + drop anti-OOM (`get dropped`) + `#inFlight` (chunk non confirmé) ré-écrit SYNC au flush. Ne bloque jamais l'event loop (bon pour disque lent).
  - **`sync: true`** : `writeSync` direct (pas de buffer/threadpool/drop). Sur fd/worker le write local est µs ; durable (0 perte buffer).
- ⚠️ **Microbench isolé 2026-05-30 (`scripts/log-sink-contention.mjs`, 6 proc × 150k lignes, médiane/7) — verdict net qui CORRIGE l'A/B cluster bruité** :
  - **Le vrai levier = la COALESCENCE (nb de syscalls write), pas le fd-par-worker.** sync 1-write/ligne 1826 ms → sync **gros chunks** 96 ms = **×19**. Or le ring/tick (`_outChunks`+`setImmediate`) coalesce DÉJÀ en amont en non-TTY/cluster → le sink reçoit des chunks coalescés. **C'est ÇA le gros levier, déjà en place.**
  - **W2 (fd/worker) = garde-fou SECONDAIRE, pas le levier** : la contention d'inode coûte ×3.23 SEULEMENT en 1-write/ligne (shared 5891 → perworker 1826 ms) ; **en coalescé elle s'évapore** (shared-batch 89 ms ≈ perworker-batch 96 ms, ×0.93). fd-par-worker ne sauve que le cas pathologique « buffer tick OFF ».
  - **À coalescence égale, SYNC > async** : sync-batch 96 ms vs async 118 ms (×1.23, dans la variance). L'async ne « gagnait » l'A/B initial que parce qu'il coalesçait seul CONTRE un sync 1-ligne. → `sync:true` = bon défaut **fichier local** (chunk déjà coalescé par le tick, 0 overhead threadpool) ; async réservé **disque lent** (ne pas bloquer l'event loop).
  - **stdout fd1 hérité partagé, 1-write/ligne = 11131 ms** = le pire (goulet cluster historique). Caveat : bench en régime RAFALE (coalescence max) ; régime espacé réel coalesce moins/tick (à modéliser pour chiffrer où fd/worker redevient utile).
- Câblé par `Kernel.initializeLog` ← `config.log.driver` (`stdout`|`file`|`null`) + `config.log.file.path` (défaut `logs/nodefony-<pid>.log`). Défaut `stdout` → `setLogSink(null)` (no-op, 0 impact).
- **Flush de secours** : `exit`/`beforeExit` → `_flushOut()` + `_sink.flushSync()`. PAS de handler `SIGTERM`/`SIGINT`/`uncaughtException` (casserait Ctrl+C, masquerait les crashes) — le shutdown kernel sort via `process.exit` → `exit`.
- ⚠️ `_sink` = **process-global** (1/process) → en test, `Syslog.setLogSink(null)` en `afterEach` (anti-contamination, libère le fd).
- ⚠️ **Durabilité** : `writeOut` lance un write async ; un `close()`/`exit` AVANT le callback ré-écrit `#inFlight` en sync (sinon perte du chunk en vol — bug attrapé par `LogSink.test.ts`). Append → pas de corruption (doublon best-effort au pire). Plan [[project_log_backplane_vision]] phase LB.W.

**Cycle de vie**

- `reset()` / `clean()` → vide le ring + retire tous les listeners
- `clearLogStack()` → vide uniquement le ring

**Console Override**

- `overrideConsole: true` dans settings → active au constructeur
- `Syslog.overrideConsole(instance)` → redirige `console.log/info/warn/error/debug/table/dir` vers syslog
- `Syslog.restoreConsole()` → restore l'original (idempotent, restaure aussi `table`/`dir`)
- Double appel → WARNING pdu, pas de crash
- `_nativeConsole` : méthodes console capturées au chargement de module — utilisées par `wrapper()` et `normalizeLog()` pour éviter la récursion infinie
- `console.log(a, b)` → `print(a, b)` → 1 Pdu, `payload=[a,b]`
- `console.table(data)` → `logMultiple("INFO", data)` — payload = l'objet brut
- `console.dir(obj)` → `logMultiple("DEBUG", obj)` — payload = l'objet brut

**Transport Layer**

- `ITransport { name: string; send(pdu): Promise<void> }` — interface dans `types/ITransport.ts`
- `addTransport(t): this` / `removeTransport(t): this` — ajoute/retire un transport (deduplication par référence)
- Firing : fire-and-forget après `fire("onLog")`, uniquement si `pdu.status === "ACCEPTED"`
- Erreur transport → `fire("onTransportError", err, pdu)` (pas de crash)
- `ConsoleTransport` : wraps `Syslog.normalizeLog` — `new ConsoleTransport(pid?)`
- `FileTransport` : `appendFile` JSON ou text — `new FileTransport({ path, format? })`
- `HttpTransport` : POST JSON natif `node:http`/`node:https` — `new HttpTransport({ url, headers?, timeout? })`
- `SyslogTransport` : forward PDU vers un autre Syslog — `new SyslogTransport(targetSyslog)` — même objet Pdu, pas de copie
- Exports : `transports/index.ts` + re-exportés depuis `index.ts` principal

**Deps** : `Event`, `Pdu`, `cli-color`, `extend` (Tools), `ISyslog`, `ITransport`

**`fastTypeOf` — valeurs retournées**

- `null` → `null` (pas `"null"`)
- `string/number/boolean/function` → même nom lowercase
- `Array` → `"array"` | `Date` → `"date"` (lowercase) | `RegExp` → `"RegExp"` | `Error` → `"Error"` | `Buffer` → `"buffer"` | `object` → `"object"`

**Gotchas**

- `warnning` (avec double n) supprimé — utiliser `warn`
- `filter()` modifie `conditions` par référence via `extend(true, {}, conditions)` — deep clone
- `loadStack(stack, doEvent, beforeConditions)` : `beforeConditions` appelé AVANT `fire("onLog")`
- `logicCondition["&&"]` retourne `false` si l'objet de conditions est vide
- DROPPED pdu → transports **non** appelés (seuls les ACCEPTED passent)
